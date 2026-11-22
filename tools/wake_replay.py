#!/usr/bin/python3 -I
from __future__ import annotations

"""The wake time, measured by replaying captured team traffic into a fresh copy (item 104, D33; docs/tools.md).

Usage: tools/wake_replay.py run --file FILE --out DIR [--code CHECKOUT]
       tools/wake_replay.py capture --db BACKUP.sqlite3 --from ISO --to ISO [--limit N] --out FILE

`capture` reads a backup of a live instance (never the live file) and writes the
traffic with no words: when each message to an agent was sent, by whom, in which
topic and to which agents, how long its wake took live, and each agent's turn
spans as the record keeps them (hosted turns; an agent woken through a broker has
none). People are named person-1, person-2, ...

`run` starts a copy from CHECKOUT's code (default: this checkout): a fresh
instance, the same people, agents and topics, and the real effects runner waking
each agent through the real wake broker into a stand-in queue
(tools/wake_standin.py). It posts each message at its offset; each wake that
reaches an agent is an event from that agent's stand-in, and the agent reads its
work (acknowledges it) once its next recorded turn has run, or at once without
one. Idle gaps, where no wake is in flight and no agent is in a turn, are cut to
REPLAY_IDLE_MAX_MS; turns are kept whole. When the schedule has run, each message
whose wake has not come is waited for while the copy still holds a wake due for
its agent, and is lost otherwise. The result, per agent, is the median time from
a message's commit to its wake reaching the agent, how many wakes, and the
offsets of any lost ones (replay.json). Nothing is waited for on a clock but the
file's own schedule, and every child is waited on by the PID it was started with.
"""

import argparse
import datetime
import heapq
import json
import os
from pathlib import Path
import select
import shutil
import signal
import sqlite3
import subprocess
import sys
import tempfile
import time
import uuid

# The copy runs another checkout's code; its modules must not leave caches in that checkout.
sys.dont_write_bytecode = True

REPLAY_IDLE_MAX_MS = 5000
REPO = Path(__file__).resolve().parents[1]
FILE = "tests/fixtures/replay/wake-2026-11-05.json"
STANDIN = Path(__file__).resolve().parent / "wake_standin.py"
INSTANCE = "wake-replay"


class ReplayError(Exception):
    """The replay could not measure: a child failed, or the copy stopped waking."""


# ---- the schedule and the measure: pure ----------------------------------------------------


def schedule(traffic):
    """The posts at their offsets with idle gaps cut, and each agent's turn lengths in order.

    Busy time is every recorded turn and every wake in flight (from a message to the latest of its live wakes);
    a gap longer than REPLAY_IDLE_MAX_MS between busy times is cut to that, and nothing inside a busy time moves."""
    messages = sorted(traffic["messages"], key=lambda message: message["at_ms"])
    busy = [(message["at_ms"], message["at_ms"] + max(list((message.get("woken") or {}).values()) + [0])) for message in messages]
    for spans in (traffic.get("turns") or {}).values():
        busy += [(span["start_ms"], span["end_ms"]) for span in spans]
    busy.sort()
    cuts, reach = [], None
    for start, end in busy:
        if reach is not None and start - reach > REPLAY_IDLE_MAX_MS:
            cuts.append((start, start - reach - REPLAY_IDLE_MAX_MS))
        reach = end if reach is None else max(reach, end)

    def moved(at):
        return at - sum(length for where, length in cuts if where <= at)
    first = moved(messages[0]["at_ms"]) if messages else 0
    posts = [dict(message, index=index, at=moved(message["at_ms"]) - first) for index, message in enumerate(messages)]
    turns = {agent: [span["end_ms"] - span["start_ms"] for span in sorted(spans, key=lambda span: span["start_ms"])]
             for agent, spans in (traffic.get("turns") or {}).items()}
    return {"posts": posts, "turns": turns}


def median(values):
    ordered = sorted(values)
    if not ordered:
        return None
    middle = len(ordered) // 2
    return ordered[middle] if len(ordered) % 2 else (ordered[middle - 1] + ordered[middle]) / 2.0


def measure(deliveries, wakes, agents):
    """Per agent: the median seconds from a message's commit to the first wake covering it, the wakes counted, and the
    offsets of messages whose wake never came. deliveries: [{agent, seq, sent_ms, at}]; wakes: [{agent, upto, ms}]."""
    result = {}
    for agent in agents:
        mine = [wake for wake in wakes if wake["agent"] == agent]
        delays, lost = [], []
        for delivery in (d for d in deliveries if d["agent"] == agent):
            reached = [wake["ms"] for wake in mine if wake["upto"] >= delivery["seq"] and wake["ms"] >= delivery["sent_ms"]]
            if reached:
                delays.append((min(reached) - delivery["sent_ms"]) / 1000.0)
            else:
                lost.append(delivery["at"])
        result[agent] = {"median": median(delays), "wakes": len(delays), "lost": sorted(lost), "delays": delays}
    return result


def replay(traffic, copy):
    """Play the schedule into the copy; returns measure(). The copy owns the clock: copy.now() and copy.wait(due_ms),
    which returns the next event (a wake, or None at due_ms; due_ms None waits for an event alone)."""
    plan = schedule(traffic)
    agents = sorted(traffic["routed"])
    start = copy.now()
    queue = [(start + post["at"], 0, index, ("post", post)) for index, post in enumerate(plan["posts"])]
    heapq.heapify(queue)
    serial, turn_of = len(queue), {agent: 0 for agent in agents}
    deliveries, wakes = [], []

    def woke(event):
        nonlocal serial
        wakes.append(event)
        turns = plan["turns"].get(event["agent"], [])
        length = turns[turn_of[event["agent"]]] if turn_of[event["agent"]] < len(turns) else 0
        turn_of[event["agent"]] += 1
        serial += 1
        heapq.heappush(queue, (event["ms"] + length, 1, serial, ("read", event)))

    def unreached():
        return [d for d in deliveries if not any(w["agent"] == d["agent"] and w["upto"] >= d["seq"] and w["ms"] >= d["sent_ms"] for w in wakes)]
    while True:
        while queue:
            event = copy.wait(queue[0][0])
            if event is not None:
                woke(event)
                continue
            _, _, _, (kind, item) = heapq.heappop(queue)
            if kind == "post":
                deliveries += [dict(delivery, at=item["at_ms"]) for delivery in copy.post(item)]
            else:
                copy.read(item["agent"], item["upto"])
        waiting = unreached()
        if not waiting or not any(copy.due(agent) for agent in {d["agent"] for d in waiting}):
            break
        woke(copy.wait(None))
    return measure(deliveries, wakes, agents)


# ---- the copy: a fresh instance from a checkout's code, its runner and the stand-in queues ----------------


def _people_and_agents(traffic):
    return list(traffic["people"]), list(traffic["agents"])


class Copy:
    """A fresh instance at DIR built and driven by CHECKOUT's own code (the serve child), with its real runner waking
    each agent through its real broker into a stand-in queue. Events come from the stand-ins' shared FIFO; the runner's
    stdout ending is a failure."""

    def __init__(self, traffic, code, directory):
        self.directory = Path(directory)
        self.events_path = self.directory / "wakes.fifo"
        os.mkfifo(str(self.events_path), 0o600)
        # Our own write end keeps the FIFO open between stand-ins, so a read never sees an end of file.
        self.events = os.open(str(self.events_path), os.O_RDONLY | os.O_NONBLOCK)
        self.keep = os.open(str(self.events_path), os.O_WRONLY)
        self.buffer, self.pending = b"", []
        standin = self.directory / "codex-standin"
        shutil.copyfile(str(STANDIN), str(standin))
        standin.chmod(0o700)
        plan = {"people": traffic["people"], "agents": traffic["agents"], "routed": traffic["routed"], "topics": traffic["topics"],
                "dir": str(self.directory),
                "standin": str(standin), "events": str(self.events_path)}
        (self.directory / "plan.json").write_text(json.dumps(plan))
        with open(str(self.directory / "serve.log"), "ab") as log:
            self.serve = subprocess.Popen(["/usr/bin/python3", "-I", "-B", str(Path(__file__).resolve()), "serve", "--code", str(code),
                                           "--plan", str(self.directory / "plan.json")], stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=log)
        self.serve_pid, self.runner = self.serve.pid, None

    def start(self, code):
        """Build the copy and start its runner, then wait for the runner's own word that it holds the guard."""
        ready = self.ask({"op": "ready"})
        with open(str(self.directory / "runner-stderr.log"), "ab") as log:
            self.runner = subprocess.Popen(["/usr/bin/python3", "-I", "-B", str(Path(code) / "bin" / "aim-next-runner"), "--profile",
                                            ready["runner_profile"], "--runner-id", "wake-replay", "--routes", ready["routes"]],
                                           stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=log)
        self.runner_pid = self.runner.pid
        self.runner_out, self.runner_lines = b"", []
        os.set_blocking(self.runner.stdout.fileno(), False)
        while not any(line.get("event") == "acquired" for line in self.runner_lines):
            self._read([self.runner.stdout.fileno()], None)

    def ask(self, request):
        self.serve.stdin.write((json.dumps(request) + "\n").encode("utf-8"))
        self.serve.stdin.flush()
        line = self.serve.stdout.readline()
        if not line:
            raise ReplayError("the copy's serve child ended (see serve.log)")
        answer = json.loads(line)
        if "error" in answer:
            raise ReplayError("the copy refused %s: %s" % (request["op"], answer["error"]))
        return answer

    def now(self):
        return int(time.time() * 1000)

    def _read(self, fds, timeout):
        ready = select.select(fds, [], [], timeout)[0]
        if self.runner.stdout.fileno() in ready:
            block = os.read(self.runner.stdout.fileno(), 65536)
            if not block:
                raise ReplayError("the runner stopped (exit %s); see runner-stderr.log" % self.runner.wait())
            self.runner_out += block
            while b"\n" in self.runner_out:
                line, self.runner_out = self.runner_out.split(b"\n", 1)
                event = json.loads(line)
                self.runner_lines.append(event)
                if event.get("event") in ("paused", "pause_unsaved", "idle_lease_lost"):
                    raise ReplayError("the runner stopped waking: %s" % event)
        if self.events in ready:
            self.buffer += os.read(self.events, 65536)
            while b"\n" in self.buffer:
                line, self.buffer = self.buffer.split(b"\n", 1)
                self.pending.append(json.loads(line))

    def wait(self, due_ms):
        while not self.pending:
            left = None if due_ms is None else (due_ms - self.now()) / 1000.0
            if left is not None and left <= 0:
                return None
            self._read([self.events, self.runner.stdout.fileno()], left)
        event = self.pending.pop(0)
        upto = self.ask({"op": "attempt", "id": event["attempt_id"]})["captured_seq"]
        return {"agent": event["agent"], "upto": upto, "ms": event["ms"]}

    def post(self, item):
        wake_id = item.get("wake_id")
        if wake_id is None:
            wake_id = item.get("id")
        if wake_id is None:
            wake_id = "replay-message-%d" % (item["index"] + 1)
        request = {"op": "post", "from": item["from"], "topic": item["topic"], "kind": item.get("kind", "post"),
                   "to": item.get("to", []), "index": item["index"], "wake_id": wake_id}
        if "divergence_reason" in item:
            request["divergence_reason"] = item["divergence_reason"]
        return self.ask(request)["deliveries"]

    def read(self, agent, upto):
        self.ask({"op": "read", "agent": agent, "upto": upto})

    def due(self, agent):
        return self.ask({"op": "due", "agent": agent})["due"]

    def close(self):
        if self.runner is not None:
            if self.runner.poll() is None:
                os.kill(self.runner_pid, signal.SIGTERM)
            # Its stdout ends when it exits; read to that end, then reap it by its PID.
            os.set_blocking(self.runner.stdout.fileno(), True)
            self.runner.stdout.read()
            self.runner.stdout.close()
            self.runner.wait()
        self.serve.stdin.close()
        self.serve.wait()
        self.serve.stdout.close()
        os.close(self.events)
        os.close(self.keep)


def serve(code, plan_path):
    """The copy's own side, run with CHECKOUT's code: build the instance, then answer the player's requests."""
    sys.path.insert(0, str(Path(code).resolve()))
    from aim_next import Store, initialize  # noqa: E402 (the checkout under test, not this one)
    from aim_next import codex_broker
    from aim_next.profile import write_profile
    plan = json.loads(Path(plan_path).read_text())
    root = Path(plan["dir"])
    people, agents, routed = plan["people"], plan["agents"], plan["routed"]
    db = root / "data.sqlite3"
    binding = initialize(db, INSTANCE, [{"id": people[0], "kind": "human"}] + [{"id": agent, "kind": "agent"} for agent in agents],
                         authority_path=root / "authority.json")["binding"]
    store = Store(db, INSTANCE, expected_binding=binding)
    for person in people[1:]:
        store.register_actor(person, "human", person)
    pin = {key: binding[key] for key in ("authority_id", "authority_epoch")}
    serial = [0]

    def act(actor, kind, target, args, expected=None):
        serial[0] += 1
        receipt = store.command(actor, {"v": 1, "instance_id": INSTANCE, "operation_id": "replay-%d" % serial[0], "kind": kind,
                                        "target": target, "args": args, "expected": dict(expected or {}, authority=dict(pin))})
        if receipt.get("status") != "committed":
            raise ReplayError("%s was not committed: %s" % (kind, receipt.get("error")))
        return receipt["result"]
    owner = people[0]
    act(owner, "workspace.create", {}, {"id": "w-replay", "title": "Wake replay", "purpose": "Replayed traffic", "team": agents + people[1:],
                                        "coordinator": agents[0]})
    for index, topic in enumerate(plan["topics"]):
        others = [actor for actor in topic["participants"] if actor != owner]
        act(owner, "opening.save", {"opening_id": "o-%d" % index}, {"workspace_id": "w-replay", "topic_id": "t-%d" % index,
                                                                    "title": "Topic %d" % (index + 1), "participants": others,
                                                                    "body": "Replayed topic", "attachments": []}, {"opening_revision": 0})
        act(owner, "opening.publish", {"opening_id": "o-%d" % index}, {}, {"opening_revision": 1})

    def connect():
        connection = sqlite3.connect(str(db))
        connection.row_factory = sqlite3.Row
        return connection

    def read(agent, upto):
        with connect() as connection:
            ids = [row[0] for row in connection.execute("SELECT id FROM deliveries WHERE recipient_id=? AND state='pending' AND seq<=? ORDER BY seq",
                                                        (agent, upto))]
        for delivery in ids:
            act(agent, "delivery.ack", {"delivery_id": delivery}, {})
        return len(ids)
    # The openings' own deliveries are read before the runner starts, so it wakes nobody for them.
    for agent in agents:
        read(agent, 2 ** 62)
    profiles = root / "profiles"
    profiles.mkdir()
    routes = {}
    for actor in people + agents:
        write_profile(profiles / (actor + ".json"), db, INSTANCE, actor, binding=binding)
    for agent in routed:
        home = root / "queues" / agent
        home.mkdir(parents=True, mode=0o700)
        (home / "standin.json").write_text(json.dumps({"agent": agent, "events": plan["events"],
                                                       "user_agent": "%s/%s (wake replay stand-in)" % (codex_broker.CLIENT, codex_broker.VERSION)}))
        destination = {"kind": "codex-queue-stdio", "protocol_version": 1, "codex_home": str(home.resolve()), "thread_id": str(uuid.uuid4())}
        config, route = root / (agent + ".broker.json"), root / (agent + ".route.json")
        config.write_text(json.dumps({"v": 1, "profile": str(profiles / (agent + ".json")), "codex_executable": plan["standin"],
                                      "destination": destination}))
        route.write_text(json.dumps({"v": 1, "profile": str(profiles / (agent + ".json")),
                                     "argv": [str(Path(code).resolve() / "bin" / "aim-next-codex-broker"), "--config", str(config)]}))
        for path in (config, route):
            path.chmod(0o600)
        with store.runner_guard("wake-replay") as guard:
            store.provision_route_pin(guard, agent, destination)
        routes[agent] = str(route)
    routes_path = root / "routes.json"
    routes_path.write_text(json.dumps({"v": 1, "routes": routes}))
    routes_path.chmod(0o600)

    def answer(value):
        sys.stdout.write(json.dumps(value) + "\n")
        sys.stdout.flush()
    for line in sys.stdin:
        request = json.loads(line)
        try:
            if request["op"] == "ready":
                answer({"runner_profile": str(profiles / (owner + ".json")), "routes": str(routes_path)})
            elif request["op"] == "post":
                reason = request.get("divergence_reason")
                if reason is None:
                    wake_id = request.get("wake_id")
                    if wake_id is None:
                        wake_id = "replay-message-%d" % (request["index"] + 1)
                    reason = "wake replay %s" % wake_id
                args = {"body": "Replayed message %d" % (request["index"] + 1), "divergence_reason": reason}
                to = [actor for actor in request["to"] if actor in agents]
                if request["kind"] in ("tell", "ask") and to:
                    args.update(addressees=to, intent=request["kind"])
                result = act(request["from"], "message.post", {"topic_id": "t-%d" % request["topic"]}, args)
                with connect() as connection:
                    sent = connection.execute("SELECT sent_ms FROM messages WHERE id=?", (result["message_id"],)).fetchone()[0]
                    rows = connection.execute("SELECT recipient_id,seq FROM deliveries WHERE message_id=? AND recipient_id IN (SELECT value FROM json_each(?))",
                                              (result["message_id"], json.dumps(routed))).fetchall()
                answer({"deliveries": [{"agent": row[0], "seq": row[1], "sent_ms": sent} for row in rows]})
            elif request["op"] == "attempt":
                with connect() as connection:
                    row = connection.execute("SELECT captured_seq FROM wake_attempts WHERE id=?", (request["id"],)).fetchone()
                answer({"captured_seq": row[0] if row and row[0] is not None else -1})
            elif request["op"] == "read":
                answer({"read": read(request["agent"], request["upto"])})
            elif request["op"] == "due":
                with connect() as connection:
                    row = connection.execute("SELECT enabled,pending_count,next_due_ms,claim_token FROM recipient_schedule WHERE recipient_id=?",
                                             (request["agent"],)).fetchone()
                answer({"due": bool(row and row["enabled"] and row["pending_count"] and (row["next_due_ms"] is not None or row["claim_token"]))})
            else:
                answer({"error": "unknown op %s" % request["op"]})
        except Exception as error:  # the player stops on any refusal and names it
            answer({"error": "%s: %s" % (type(error).__name__, error)})
    return 0


def run(file, out, code):
    traffic = json.loads(Path(file).read_text())
    out = Path(out)
    out.mkdir(parents=True, exist_ok=True)
    # The stand-in queue executable needs parents nobody else can write, which an evidence directory may not have.
    directory = Path(tempfile.mkdtemp(prefix="theseus-wake-replay-")).resolve()
    copy = None
    try:
        copy = Copy(traffic, code, directory)
        copy.start(code)
        result = replay(traffic, copy)
    finally:
        if copy is not None:
            copy.close()
        for name in ("serve.log", "runner-stderr.log"):
            if (directory / name).exists():
                shutil.copyfile(str(directory / name), str(out / name))
        shutil.rmtree(str(directory))
    (out / "replay.json").write_text(json.dumps({"file": str(file), "agents": result}, indent=1) + "\n")
    lost = sorted(agent for agent, values in result.items() if values["lost"])
    print(json.dumps({"agents": {agent: {key: values[key] for key in ("median", "wakes", "lost")} for agent, values in result.items()},
                      "lost": lost}))
    return 1 if lost else 0


# ---- capture ----------------------------------------------------------------------------------


def _ms(text):
    return int(datetime.datetime.fromisoformat(text).timestamp() * 1000)


def capture(db_path, start, end, out, limit=None):
    """The traffic to agents in [start, end) from a backup, with no words (D33)."""
    db = sqlite3.connect("file:%s?mode=ro" % Path(db_path).resolve(), uri=True)
    kinds = dict(db.execute("SELECT id,kind FROM actors").fetchall())
    rows = db.execute("SELECT m.id,m.topic_id,m.author_id,m.addressees,m.sent_ms FROM messages m WHERE m.sent_ms>=? AND m.sent_ms<? "
                      "AND EXISTS (SELECT 1 FROM deliveries d JOIN actors a ON a.id=d.recipient_id WHERE d.message_id=m.id AND a.kind='agent' "
                      "AND d.recipient_id<>m.author_id) ORDER BY m.sent_ms LIMIT ?", (_ms(start), _ms(end), limit or -1)).fetchall()
    if not rows:
        raise ReplayError("no message to an agent between %s and %s" % (start, end))
    first = rows[0][4]
    people, topics, messages, actors = {}, {}, [], set()

    def name(actor):
        if kinds.get(actor) == "agent":
            return actor
        return people.setdefault(actor, "person-%d" % (len(people) + 1))
    for message_id, topic_id, author, addressees, sent in rows:
        recipients = [row[0] for row in db.execute("SELECT d.recipient_id FROM deliveries d JOIN actors a ON a.id=d.recipient_id "
                                                   "WHERE d.message_id=? AND a.kind='agent' AND d.recipient_id<>?", (message_id, author))]
        woken = {}
        for recipient in recipients:
            seq = db.execute("SELECT seq FROM deliveries WHERE message_id=? AND recipient_id=?", (message_id, recipient)).fetchone()[0]
            reached = db.execute("SELECT min(r.finished_ms) FROM wake_attempts a JOIN wake_results r ON r.attempt_id=a.id WHERE a.recipient_id=? "
                                 "AND a.captured_seq>=? AND r.outcome IN ('accepted','queued') AND r.finished_ms>=?", (recipient, seq, sent)).fetchone()[0]
            if reached is not None:
                woken[recipient] = reached - sent
        index = topics.setdefault(topic_id, len(topics))
        actors.update([author] + recipients)
        addressed = [actor for actor in json.loads(addressees or "[]") if actor in recipients]
        messages.append({"at_ms": sent - first, "from": name(author), "topic": index, "kind": "tell" if addressed else "post",
                         "to": recipients, "woken": woken})
    participants = {index: set() for index in topics.values()}
    for message in messages:
        participants[message["topic"]].update([message["from"]] + message["to"])
    turns = {}
    for recipient, handed, finished in db.execute("SELECT recipient_id,handed_ms,finished_ms FROM hosted_turns WHERE mode='start' AND handed_ms>=? "
                                                  "AND handed_ms<? AND finished_ms IS NOT NULL ORDER BY handed_ms", (first, _ms(end))):
        turns.setdefault(recipient, []).append({"start_ms": handed - first, "end_ms": finished - first})
    agents = sorted(actor for actor in actors if kinds.get(actor) == "agent")
    # Only an agent with a route is woken (docs/agents.md); the copy routes the same ones.
    routed = sorted(agent for agent in agents if db.execute("SELECT 1 FROM wake_attempts WHERE recipient_id=? AND started_ms>=? AND started_ms<?",
                                                            (agent, first, _ms(end))).fetchone())
    context = {agent: {"median_s": median([m["woken"][agent] / 1000.0 for m in messages if agent in m["woken"]]),
                       "wakes": len([m for m in messages if agent in m["woken"]])} for agent in routed}
    traffic = {"captured": {"from": start, "to": end, "first_message_ms": first, "messages": len(messages)},
               "people": sorted(set(people.values()), key=lambda person: int(person.split("-")[1])), "agents": agents, "routed": routed,
               "topics": [{"participants": sorted(participants[index])} for index in range(len(topics))],
               "messages": messages, "turns": turns, "context": context}
    Path(out).write_text(json.dumps(traffic, indent=1) + "\n")
    return traffic


def main(argv=None):
    parser = argparse.ArgumentParser(prog="tools/wake_replay.py")
    verbs = parser.add_subparsers(dest="verb", required=True)
    running = verbs.add_parser("run")
    running.add_argument("--file", default=str(REPO / FILE))
    running.add_argument("--out", required=True)
    running.add_argument("--code", default=str(REPO))
    capturing = verbs.add_parser("capture")
    capturing.add_argument("--db", required=True)
    capturing.add_argument("--from", dest="start", required=True)
    capturing.add_argument("--to", dest="end", required=True)
    capturing.add_argument("--limit", type=int)
    capturing.add_argument("--out", required=True)
    serving = verbs.add_parser("serve")
    serving.add_argument("--code", required=True)
    serving.add_argument("--plan", required=True)
    options = parser.parse_args(argv)
    try:
        if options.verb == "run":
            return run(options.file, options.out, options.code)
        if options.verb == "capture":
            traffic = capture(options.db, options.start, options.end, options.out, options.limit)
            print(json.dumps({"messages": len(traffic["messages"]), "routed": traffic["routed"], "context": traffic["context"]}))
            return 0
        return serve(options.code, options.plan)
    except ReplayError as error:
        print("refused: %s" % error, file=sys.stderr)
        return 2


if __name__ == "__main__":
    sys.exit(main())

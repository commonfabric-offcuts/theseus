from __future__ import annotations

"""The Codex host against a scripted fake app-server, on isolated fixture instances.

Every runner here is a real `bin/aim-next-runner` process the test starts and
signals by its captured PID; its app-server children are the fake in
tests/fixtures, which runs the real Theseus CLI as the agent. Nothing calls
a model or the installed Codex.
"""

import errno
import json
import os
from pathlib import Path
import pwd
import select
import shutil
import signal
import sqlite3
import subprocess
import tempfile
import time
import unittest
from unittest import mock

from aim_next import Store, initialize
from aim_next import broker_routes, codex_host
from aim_next.health import FAILING_AFTER, WHY, why_words
from aim_next.profile import write_profile


ROOT = Path(__file__).resolve().parents[1]
FAKE = ROOT / "tests" / "fixtures" / "fake_codex_app_server.py"
INSTANCE = "hosted-fixture"
AGENT = "hosted-1"
# A failing test must not hang the suite: this bounds each wait for an event
# the test expects. It never decides an outcome; reaching it fails the test.
HANG_GUARD_SECONDS = 60


class Runner:
    """One real runner process; its stdout is the event stream the test waits on."""

    def __init__(self, case, *extra):
        self.case = case
        self.events = []
        with open(str(case.root / "runner-stderr.log"), "ab") as stderr:
            self.process = subprocess.Popen(
                ["/usr/bin/python3", "-I", str(ROOT / "bin" / "aim-next-runner"), "--profile", str(case.lead_profile),
                 "--runner-id", "host-fixture", "--routes", str(case.map),
                 *([] if getattr(case, "default_host_dir", False) else ["--host-dir", str(case.host_dir)]), *extra],
                stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=stderr)
        self.pid = self.process.pid
        self.buffer = b""
        self.closed = False
        os.set_blocking(self.process.stdout.fileno(), False)

    def _line(self, deadline):
        while b"\n" not in self.buffer:
            left = deadline - time.monotonic()
            if left <= 0:
                self.case.fail("hang guard: no runner event; seen %s" % self.events[-12:])
            if not select.select([self.process.stdout], [], [], left)[0]:
                continue
            block = os.read(self.process.stdout.fileno(), 65536)
            if not block:
                self.closed = True
                return None
            self.buffer += block
        line, self.buffer = self.buffer.split(b"\n", 1)
        event = json.loads(line)
        self.events.append(event)
        return event

    def until(self, predicate, what):
        deadline = time.monotonic() + HANG_GUARD_SECONDS
        while True:
            event = self._line(deadline)
            if event is None:
                self.case.fail("runner exited before %s; seen %s" % (what, self.events[-12:]))
            if predicate(event):
                return event

    def event(self, name, **fields):
        return self.until(lambda event: event.get("event") == name and all(event.get(k) == v for k, v in fields.items()),
                          "%s %s" % (name, fields))

    def stop(self, number=signal.SIGTERM):
        """Signal the captured PID once, then read to the end; returns (exit code, final status)."""
        os.kill(self.pid, number)
        return self.finish()

    def finish(self):
        deadline = time.monotonic() + HANG_GUARD_SECONDS
        while not self.closed:
            self._line(deadline)
        code = self.process.wait()
        self.process.stdout.close()
        return code, self.events[-1] if self.events else None

    def cleanup(self):
        if self.process.returncode is None:
            for number in (signal.SIGTERM, signal.SIGKILL):
                if self.process.poll() is None:
                    os.kill(self.pid, number)
                    try:
                        self.process.wait(timeout=HANG_GUARD_SECONDS / 4)
                    except subprocess.TimeoutExpired:
                        continue
        if not self.process.stdout.closed:
            self.process.stdout.close()


class HostCase(unittest.TestCase):
    turns = []
    script = {}

    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="theseus-codex-host-")
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name).resolve()
        data = self.root / "data"
        data.mkdir()
        self.db = data / "data.sqlite3"
        self.binding = initialize(self.db, INSTANCE, [{"id": "lead", "kind": "human"}, {"id": AGENT, "kind": "agent"}],
                                  authority_path=self.root / "control" / "authority.json")["binding"]
        self.pin = {key: self.binding[key] for key in ("authority_id", "authority_epoch")}
        self.store = Store(self.db, INSTANCE, expected_binding=self.binding)
        agents = self.root / "agents"
        agents.mkdir()
        self.lead_profile = agents / "lead.json"
        self.agent_profile = agents / (AGENT + ".json")
        write_profile(self.lead_profile, self.db, INSTANCE, "lead", binding=self.binding)
        write_profile(self.agent_profile, self.db, INSTANCE, AGENT, binding=self.binding)
        self.home = self.root / "codex-home"
        self.home.mkdir(mode=0o700)
        self.work = self.root / "work"
        self.work.mkdir()
        self.host_dir = self.root / "host"
        self.host_dir.mkdir(mode=0o700)
        self.codex = self.root / "codex"
        shutil.copyfile(str(FAKE), str(self.codex))
        self.codex.chmod(0o700)
        # The real CLI, through a launcher whose own location passes the
        # executable trust policy wherever this checkout lives.
        self.cli = self.root / "aim-next"
        self.cli.write_text("#!/usr/bin/python3 -I\nimport os,sys\nos.execv('/usr/bin/python3',['/usr/bin/python3','-I',%r]+sys.argv[1:])\n"
                            % str(ROOT / "bin" / "aim-next"))
        self.cli.chmod(0o700)
        self.config = self.root / "hosted-1.route.json"
        self.provisioned = self.provision()
        self.assertEqual(self.provisioned["status"], "provisioned", self.provisioned)
        self.thread = self.provisioned["thread_id"]
        self.map = self.root / "routes.json"
        self.map.write_text(json.dumps({"v": 1, "routes": {AGENT: str(self.config)}}))
        self.map.chmod(0o600)
        (self.home / "fake-script.json").write_text(json.dumps(dict(self.script, turns=self.turns)))
        self.serial = 0
        self.runners = []

    def provision(self, config=None, profile=None):
        done = subprocess.run(["/usr/bin/python3", "-I", str(ROOT / "bin" / "aim-next-runner"), "host-provision",
                               "--profile", str(self.lead_profile), "--runner-id", "host-fixture",
                               "--actor-profile", str(profile or self.agent_profile), "--codex-executable", str(self.codex),
                               "--codex-home", str(self.home), "--cli", str(self.cli), "--cwd", str(self.work),
                               "--config", str(config or self.config)], capture_output=True, text=True)
        lines = done.stdout.strip().splitlines()
        self.assertEqual(len(lines), 1, (done.stdout, done.stderr))
        return dict(json.loads(lines[0]), exit_code=done.returncode)

    def runner(self, *extra):
        runner = Runner(self, *extra)
        self.runners.append(runner)
        self.addCleanup(runner.cleanup)
        runner.event("acquired")
        return runner

    # Acts by the lead ----------------------------------------------------------

    def act(self, kind, args, target, expected=None):
        self.serial += 1
        receipt = self.store.command("lead", {"v": 1, "instance_id": INSTANCE, "operation_id": "op-%d" % self.serial,
                                              "kind": kind, "target": target, "args": args,
                                              "expected": dict(expected or {}, authority=dict(self.pin))})
        self.assertEqual(receipt["status"], "committed", receipt)
        return receipt["result"]

    def open_topic(self, body, topic="t1"):
        if self.serial == 0:
            self.act("workspace.create", {"id": "w1", "title": "Hosted proof", "purpose": "Exercise a hosted agent",
                                          "team": [AGENT], "coordinator": AGENT}, {})
        opening = "o-" + topic
        self.act("opening.save", {"workspace_id": "w1", "topic_id": topic, "title": "Count read-through tests",
                                  "participants": [AGENT], "body": body, "attachments": []},
                 {"opening_id": opening}, {"opening_revision": 0})
        return self.act("opening.publish", {}, {"opening_id": opening}, {"opening_revision": 1})

    def post(self, body, topic="t1"):
        return self.act("message.post", {"body": body}, {"topic_id": topic})

    # Observations ----------------------------------------------------------------

    def sql(self, statement, params=()):
        db = sqlite3.connect(str(self.db))
        try:
            return db.execute(statement, params).fetchall()
        finally:
            db.close()

    def pending(self):
        return self.sql("SELECT id FROM deliveries WHERE recipient_id=? AND state='pending' ORDER BY seq", (AGENT,))

    def replies(self):
        return [row[0] for row in self.sql("SELECT body FROM messages WHERE author_id=? ORDER BY seq", (AGENT,))]

    def turns_rows(self):
        db = sqlite3.connect(str(self.db))
        db.row_factory = sqlite3.Row
        try:
            return [dict(row) for row in db.execute("SELECT * FROM hosted_turns ORDER BY handed_ms,attempt_id")]
        finally:
            db.close()

    def wire(self):
        path = self.home / "fake-wire.jsonl"
        return [json.loads(line) for line in path.read_text().splitlines()] if path.exists() else []

    def host_events(self):
        return [json.loads(line) for line in (self.host_dir / "events.jsonl").read_text().splitlines()]

    def fake_state(self):
        return json.loads((self.home / "fake-state.json").read_text())

    def turn_rpcs(self):
        return [(entry["in"]["method"], entry["in"]["params"]["clientUserMessageId"]) for entry in self.wire()
                if "in" in entry and entry["in"].get("method") in ("turn/start", "turn/steer")]

    def second_agent(self, name="hosted-2"):
        self.store.register_actor(name, "agent", "Second hosted agent")
        profile = self.root / "agents" / (name + ".json")
        write_profile(profile, self.db, INSTANCE, name, binding=self.binding)
        return profile, self.root / "agents" / (name + ".outbox")

    def gated(self, name="gate"):
        """A FIFO the fake waits on; released at cleanup if a test stops before releasing it."""
        gate = self.home / name
        os.mkfifo(str(gate), 0o600)

        def release():
            try:
                fd = os.open(str(gate), os.O_WRONLY | os.O_NONBLOCK)
            except OSError as error:
                if error.errno != errno.ENXIO:
                    raise
                return
            os.close(fd)
        self.addCleanup(release)
        return gate

    def stopped_cleanly(self, runner):
        code, final = runner.stop()
        self.assertEqual((code, final["status"]), (0, "stopped"), runner.events[-8:])
        # Every child this runner started was reaped, and Core says so.
        children = self.sql("SELECT pid,exited_ms IS NOT NULL,cleanup FROM hosted_children "
                            "WHERE runner_token=(SELECT runner_token FROM runner_state)")
        self.assertTrue(children)
        self.assertEqual({(row[1], row[2]) for row in children}, {(1, "confirmed")}, children)
        return final


class HostedProofCase(HostCase):
    """Design §9.1, S1-S6, on one isolated instance."""

    turns = [
        # S1, steered by S2: one reply holding the table and the total.
        {"commands": 1, "hold": "steer", "reply": "tests/test_agent_loop.py 4\nTotal 4"},
        # S5: answered from the thread's own history.
        {"reply": "Earlier I reported: {history}"},
        # S6: the child is killed during the turn.
        {"hold": "die"},
        {"reply": "done"},
    ]

    def test_s1_to_s6(self):
        runner = self.runner()
        resumed = runner.event("host_resume", thread=self.thread)
        self.assertEqual(resumed["status"], "idle")

        # S1 and S2: the follow-up steers into the running turn.
        self.open_topic("List the test files under tests/ that mention read_through, with a count for each, and post the table.")
        started = runner.event("host_dispatch", outcome="handed", mode="start")
        self.post("Also give the total.")
        steered = runner.event("host_dispatch", outcome="handed", mode="steer")
        ended = runner.event("host_turn_end", status="completed")
        self.assertNotEqual(started["attempt"], steered["attempt"])
        # The steer names only what is newer than the seq already handed to this thread.
        steers = [entry["in"]["params"]["input"][0]["text"] for entry in self.wire()
                  if "in" in entry and entry["in"].get("method") == "turn/steer"]
        self.assertEqual([text.splitlines()[0] for text in steers], ["Theseus: 1 new delivery for %s." % AGENT])
        # S3: one reply holding the table and the total; both deliveries acked by the agent.
        self.assertEqual(self.replies(), ["tests/test_agent_loop.py 4\nTotal 4"])
        self.assertEqual(self.pending(), [])
        rows = self.turns_rows()
        self.assertEqual([row["mode"] for row in rows], ["start", "steer"])
        self.assertEqual({row["turn_id"] for row in rows}, {ended["turn"]})
        self.assertEqual({row["thread_id"] for row in rows}, {self.thread})
        self.assertTrue(all(row["seen_ms"] is not None and row["final_status"] == "completed" for row in rows), rows)
        self.assertEqual([row["client_id"] for row in rows], ["theseus:" + row["attempt_id"] for row in rows])
        # Usage once, on the start row: tokens from the turn and the two CLI calls (post, ack), not the grep.
        self.assertEqual((rows[0]["input_tokens"], rows[0]["cached_input_tokens"], rows[0]["output_tokens"],
                          rows[0]["reasoning_output_tokens"], rows[0]["cli_calls"]), (100, 20, 10, 5, 2))
        self.assertEqual((rows[1]["input_tokens"], rows[1]["cli_calls"]), (None, None))
        # Handed work that is done leaves the schedule quiet: no re-notice turn.
        self.assertEqual(self.sql("SELECT next_due_ms,handed_seq,pending_count FROM recipient_schedule WHERE recipient_id=?",
                                  (AGENT,)), [(None, None, 0)])
        self.assertEqual(self.sql("SELECT outcome FROM wake_results ORDER BY finished_ms"), [("handed",), ("handed",)])

        # S4: restart while idle; the same thread is resumed, none is created.
        self.stopped_cleanly(runner)
        runner = self.runner()
        runner.event("host_resume", thread=self.thread)
        state = self.fake_state()
        self.assertEqual(list(state["threads"]), [self.thread])
        self.assertEqual(state["threads"][self.thread]["resumes"], 2)

        # S5: memory across the restart, with no tool call beyond the CLI.
        self.post("What total did you report earlier?")
        memory = runner.event("host_turn_end", status="completed")
        self.assertEqual(self.replies()[-1], "Earlier I reported: tests/test_agent_loop.py 4\nTotal 4")
        self.assertEqual(memory["cli_calls"], 2)
        grep = [entry for entry in self.wire() if "out" in entry and entry["out"].get("method") == "item/completed"
                and entry["out"]["params"]["turnId"] == memory["turn"]
                and entry["out"]["params"]["item"]["type"] == "commandExecution"
                and "grep" in entry["out"]["params"]["item"]["command"]]
        self.assertEqual(grep, [])

        # S6: the child dies mid-turn; the turn is lost, re-armed, and a fresh child finishes it.
        self.post("Run `sleep 30` then reply 'done'")
        runner.event("host_dispatch", outcome="handed", mode="start")
        exited = runner.event("host_child_exit")
        self.assertEqual(exited["status"], -signal.SIGKILL)
        lost = runner.event("host_turn_end", status="lost")
        self.assertTrue(lost["rearmed"])
        respawned = runner.event("host_spawn")
        self.assertNotEqual(respawned["pid"], exited["pid"])
        runner.event("host_resume", thread=self.thread)
        runner.event("host_dispatch", outcome="handed", mode="start")
        runner.event("host_turn_end", status="completed")
        self.assertEqual(self.replies()[-1], "done")
        self.assertEqual(self.pending(), [])
        statuses = [row["final_status"] for row in self.turns_rows()]
        self.assertEqual(statuses, ["completed", "completed", "completed", "lost", "completed"])

        self.stopped_cleanly(runner)
        # The killed child and every other one are recorded by the PID captured at spawn.
        spawned = [entry["spawn"] for entry in self.wire() if "spawn" in entry]
        children = [row[0] for row in self.sql("SELECT pid FROM hosted_children ORDER BY spawned_ms")]
        self.assertEqual(children, spawned[1:], "every child after provisioning is recorded at spawn")
        for entry in self.wire():
            if "spawn" in entry:
                self.assertEqual(entry["argv"], ["app-server", "--listen", "stdio://"])
                self.assertEqual(entry["path"], "/usr/bin:/bin:/usr/sbin:/sbin")
        # The event log holds fixed fields only: no message bodies or reply text.
        log = (self.host_dir / "events.jsonl").read_text()
        for words in ("read_through", "Also give the total", "Earlier I reported", "sleep 30"):
            self.assertNotIn(words, log)
        # No server request went unanswered, and the host only ever spoke to the pinned thread.
        requests = [entry["in"] for entry in self.wire() if "in" in entry and "method" in entry["in"] and "threadId" in entry["in"].get("params", {})]
        self.assertTrue(requests)
        self.assertEqual({request["params"]["threadId"] for request in requests}, {self.thread})
        # Provisioning started the only thread; the runtime never starts one.
        self.assertEqual([entry["in"].get("method") for entry in self.wire() if "in" in entry].count("thread/start"), 1)


class SteerRaceCase(HostCase):
    turns = [{"hold": "steer", "steer": "race", "reply": "first"}, {"reply": "second"}]

    def test_a_steer_refused_because_the_turn_ended_falls_back_to_one_start(self):
        runner = self.runner()
        self.open_topic("First request")
        first = runner.event("host_dispatch", outcome="handed", mode="start")
        self.post("Follow-up")
        refused = runner.event("host_steer_refused")
        self.assertTrue(refused["turn_ended"])
        second = runner.event("host_dispatch", outcome="handed", mode="start")
        self.assertEqual(refused["attempt"], second["attempt"])
        runner.event("host_turn_end", status="completed")
        self.assertEqual(self.replies(), ["first", "second"])
        self.assertEqual(self.pending(), [])
        rows = self.turns_rows()
        self.assertEqual([row["mode"] for row in rows], ["start", "start"])
        self.assertNotEqual(rows[0]["turn_id"], rows[1]["turn_id"])
        sent = [entry["in"] for entry in self.wire() if "in" in entry and entry["in"].get("method", "").startswith("turn/")]
        self.assertEqual([message["method"] for message in sent], ["turn/start", "turn/steer", "turn/start"])
        self.assertEqual(sent[1]["params"]["expectedTurnId"], rows[0]["turn_id"])
        self.assertEqual(sent[1]["params"]["clientUserMessageId"], sent[2]["params"]["clientUserMessageId"])
        self.stopped_cleanly(runner)


class DroppedSteerCase(HostCase):
    turns = [{"hold": "steer", "steer": "drop", "reply": "first"}, {"reply": "again"}]

    def test_a_steer_that_never_surfaced_is_handed_back_and_rewoken(self):
        runner = self.runner()
        self.open_topic("First request")
        runner.event("host_dispatch", outcome="handed", mode="start")
        self.post("Follow-up that will be dropped")
        runner.event("host_dispatch", outcome="handed", mode="steer")
        ended = runner.event("host_turn_end", status="completed")
        self.assertTrue(ended["rearmed"])
        rows = self.turns_rows()
        self.assertEqual([(row["mode"], row["seen_ms"] is None) for row in rows], [("start", False), ("steer", True)])
        # The re-wake names the dropped delivery again, in a fresh turn.
        runner.event("host_dispatch", outcome="handed", mode="start")
        runner.event("host_turn_end", status="completed")
        self.assertEqual(self.replies(), ["first", "again"])
        self.assertEqual(self.pending(), [])
        starts = [entry["in"] for entry in self.wire() if "in" in entry and entry["in"].get("method") == "turn/start"]
        self.assertIn("Follow-up", json.dumps(starts[-1]["params"]["additionalContext"]))
        self.assertTrue(starts[-1]["params"]["input"][0]["text"].startswith("Theseus: 1 pending delivery"))
        self.stopped_cleanly(runner)


class FailedTurnCase(HostCase):
    turns = [{"fail": "usageLimitExceeded"}, {"reply": "recovered"}]

    def test_a_failed_turn_rearms_with_backoff_and_a_clean_turn_resets_it(self):
        runner = self.runner()
        self.open_topic("Please answer")
        failed = runner.event("host_turn_end", status="failed")
        self.assertEqual((failed["error_code"], failed["rearmed"]), ("usageLimitExceeded", True))
        self.assertEqual(self.sql("SELECT retry_count FROM recipient_schedule WHERE recipient_id=?", (AGENT,)), [(1,)])
        runner.event("host_turn_end", status="completed")
        self.assertEqual(self.replies(), ["recovered"])
        self.assertEqual([(row["final_status"], row["error_code"]) for row in self.turns_rows()],
                         [("failed", "usageLimitExceeded"), ("completed", None)])
        self.assertEqual(self.sql("SELECT retry_count,next_due_ms FROM recipient_schedule WHERE recipient_id=?", (AGENT,)), [(0, None)])
        self.stopped_cleanly(runner)


class ServerRequestCase(HostCase):
    turns = [{"server_request": "item/commandExecution/requestApproval", "reply": "one"},
             {"server_request": "attestation/generate", "reply": "two"}]

    def test_every_server_request_is_answered_at_once(self):
        runner = self.runner()
        self.open_topic("Try something outside")
        asked = runner.event("host_server_request")
        self.assertEqual((asked["method"], asked["answer"], asked["thread"]),
                         ("item/commandExecution/requestApproval", "decline", self.thread))
        runner.event("host_turn_end", status="completed")
        self.post("And again")
        asked = runner.event("host_server_request")
        self.assertEqual((asked["method"], asked["answer"]), ("attestation/generate", "unsupported"))
        runner.event("host_turn_end", status="completed")
        answers = {entry["in"]["id"]: entry["in"] for entry in self.wire() if "in" in entry and str(entry["in"].get("id", "")).startswith("srv-")}
        self.assertEqual(answers["srv-1"], {"id": "srv-1", "result": {"decision": "decline"}})
        self.assertEqual(answers["srv-1"].keys(), {"id", "result"})
        self.assertEqual(answers["srv-1"]["result"], {"decision": "decline"})
        second = [value for key, value in answers.items() if key != "srv-1"]
        self.assertEqual([value["error"]["code"] for value in second], [-32601])
        self.assertEqual(self.replies(), ["one", "two"])
        self.stopped_cleanly(runner)


class StopInterruptsCase(HostCase):
    turns = [{"hold": "interrupt"}]

    def test_a_stop_interrupts_the_live_turn_and_hands_its_work_back(self):
        runner = self.runner()
        self.open_topic("A long job")
        runner.event("host_dispatch", outcome="handed", mode="start")
        self.stopped_cleanly(runner)
        self.assertEqual([row["final_status"] for row in self.turns_rows()], ["interrupted"])
        self.assertEqual(len(self.pending()), 1)
        due, handed, retry = self.sql("SELECT next_due_ms,handed_seq,retry_count FROM recipient_schedule WHERE recipient_id=?", (AGENT,))[0]
        self.assertIsNotNone(due, "an interrupted turn's work is due again for the next run")
        self.assertEqual((handed, retry), (None, 1))
        interrupts = [entry["in"] for entry in self.wire() if "in" in entry and entry["in"].get("method") == "turn/interrupt"]
        self.assertEqual(len(interrupts), 1)


class StopEscalationCase(HostCase):
    turns = [{"hold": "interrupt"}]
    script = {"deaf": True}

    def test_a_second_stop_signal_terminates_the_captured_child(self):
        runner = self.runner()
        self.open_topic("A job that ignores interrupts")
        runner.event("host_dispatch", outcome="handed", mode="start")
        child = self.sql("SELECT pid FROM hosted_children")[0][0]
        os.kill(runner.pid, signal.SIGTERM)
        runner.event("host_interrupt")
        # The turn goes on; only a second signal escalates, to SIGTERM on the PID captured at spawn.
        os.kill(runner.pid, signal.SIGTERM)
        exited = runner.event("host_child_exit")
        self.assertEqual((exited["pid"], exited["status"]), (child, -signal.SIGTERM))
        lost = runner.event("host_turn_end", status="lost")
        self.assertTrue(lost["rearmed"])
        code, final = runner.finish()
        self.assertEqual((code, final["status"]), (0, "stopped"))
        self.assertEqual(self.sql("SELECT exited_ms IS NOT NULL,exit_status,cleanup FROM hosted_children"), [(1, -signal.SIGTERM, "confirmed")])


class BrokenChildCase(HostCase):
    turns = [{"garble": True}, {"reply": "recovered"}]

    def test_a_child_that_breaks_framing_settles_its_dispatch_at_once_and_is_replaced(self):
        runner = self.runner()
        self.open_topic("Please answer")
        broken = runner.event("host_protocol_error")
        self.assertEqual(broken["reason"], "invalid_json")
        # The claim is settled now, not left to its lease; the broken child is terminated by its captured PID.
        failed = runner.event("host_dispatch")
        self.assertEqual((failed["outcome"], failed["reason"]), ("error", "protocol_error"))
        exited = runner.event("host_child_exit")
        self.assertEqual((exited["pid"], exited["status"]), (broken["pid"], -signal.SIGTERM))
        runner.event("host_turn_end", status="completed")
        self.assertEqual(self.replies(), ["recovered"])
        self.assertEqual([row["final_status"] for row in self.turns_rows()], ["completed"])
        self.stopped_cleanly(runner)
        self.assertEqual([event["event"] for event in runner.events
                          if event.get("event") in ("host_dispatch_abandoned", "host_dispatch_late")], [])
        # The broken child's pending start fails when it exits, but its claim was settled once already.
        attempts = [event["attempt"] for event in runner.events if event.get("event") == "host_dispatch"]
        self.assertEqual((len(attempts), len(set(attempts))), (2, 2))


class TurnErrorCase(HostCase):
    turns = [{"fail": "contextWindowExceeded"}, {"fail": "contextWindowExceeded"}, {"fail": "unauthorized"}, {"reply": "back"}]

    def test_context_overflow_compacts_once_and_unauthorized_rechecks_the_account(self):
        runner = self.runner()
        self.open_topic("Big job")
        for code in ("contextWindowExceeded", "contextWindowExceeded"):
            failed = runner.event("host_turn_end", status="failed")
            self.assertEqual(failed["error_code"], code)
        runner.event("host_compact", thread=self.thread)
        runner.event("host_turn_end", status="failed", error_code="unauthorized")
        runner.event("host_auth_failed")
        runner.event("host_turn_end", status="completed")
        sent = [entry["in"]["method"] for entry in self.wire() if "in" in entry and entry["in"].get("method") in
                ("turn/start", "thread/compact/start", "account/read")]
        # account/read at provisioning and at startup, and again after the unauthorized turn;
        # one compaction, before the third turn only.
        self.assertEqual(sent, ["account/read", "account/read", "turn/start", "turn/start", "thread/compact/start", "turn/start",
                                "account/read", "turn/start"])
        self.assertEqual(self.replies(), ["back"])
        self.stopped_cleanly(runner)


class RefusedChildCase(HostCase):
    def check(self, reason):
        runner = self.runner()
        refused = runner.event("host_child_refused")
        self.assertEqual(refused["reason"], reason)
        runner.event("host_child_exit", pid=refused["pid"])
        self.open_topic("Anyone there?")
        runner.event("settled", outcome="unavailable")
        self.assertEqual(self.sql("SELECT outcome FROM wake_results"), [("unavailable",)])
        self.assertEqual(self.turns_rows(), [])
        self.assertEqual(len(self.pending()), 1)
        self.assertNotIn("turn/start", [entry["in"].get("method") for entry in self.wire() if "in" in entry])
        self.stopped_cleanly(runner)

    def test_another_codex_version_is_refused_naming_the_version_found_and_the_one_reviewed(self):
        (self.home / "fake-script.json").write_text(json.dumps({"version": "0.170.0"}))
        reason = "codex_version:0.170.0:0.167.0-alpha.3.2"
        self.check(reason)
        # Health keeps why, so it can say the app updated rather than ask whether it is open.
        self.assertEqual(self.sql("SELECT failed_reason FROM wake_facts"), [(reason,)])
        self.assertIn("0.170.0", why_words(reason))
        self.assertIn("0.167.0-alpha.3.2", why_words(reason))

    def test_a_malformed_user_agent_is_refused_as_a_protocol_refusal(self):
        (self.home / "fake-script.json").write_text(json.dumps({"version": "0.167.0-alpha.3.2\tfake"}))
        self.check("codex_protocol")

    def test_a_home_that_is_not_signed_in_is_refused(self):
        (self.home / "fake-script.json").write_text(json.dumps({"signed_in": False}))
        self.check("auth_missing")


class ResumeRefusalCase(HostCase):
    def test_a_missing_rollout_refuses_the_pin_and_preserves_work_without_replacement(self):
        self.open_topic("Keep this queued request when the pinned rollout is missing")
        state = self.fake_state()
        state["threads"][self.thread]["persisted"] = False
        (self.home / "fake-state.json").write_text(json.dumps(state))
        runner = Runner(self)
        self.addCleanup(runner.cleanup)
        code, final = runner.finish()
        self.assertEqual((code, final["status"], final.get("reason")), (2, "paused", "route_binding_changed"))
        self.assertTrue(any(event.get("event") == "host_resume_refused" for event in runner.events))
        self.assertEqual(self.sql("SELECT state,reason_code FROM runner_state"), [("paused", "route_binding_changed")])
        self.assertEqual(len(self.pending()), 1)
        self.assertEqual(set(self.fake_state()["threads"]), {self.thread})
        methods = [entry["in"].get("method") for entry in self.wire() if "in" in entry]
        self.assertEqual(methods.count("thread/start"), 1, "only original provisioning may create a thread")
        self.assertEqual(methods.count("turn/start"), 0, "missing context must not start a model turn")
        self.assertEqual(self.turns_rows(), [])
        self.assertEqual(self.sql("SELECT exited_ms IS NOT NULL,cleanup FROM hosted_children"), [(1, "confirmed")])

    def test_a_pinned_thread_the_child_does_not_know_pauses_the_runner(self):
        state = self.fake_state()
        state["threads"] = {}
        (self.home / "fake-state.json").write_text(json.dumps(state))
        runner = Runner(self)
        self.addCleanup(runner.cleanup)
        code, final = runner.finish()
        self.assertEqual((code, final["status"], final.get("reason")), (2, "paused", "route_binding_changed"))
        self.assertEqual(self.sql("SELECT state,reason_code FROM runner_state"), [("paused", "route_binding_changed")])
        # No replacement thread, and the child was reaped and recorded.
        self.assertEqual(self.fake_state()["threads"], {})
        self.assertEqual([entry["in"].get("method") for entry in self.wire() if "in" in entry].count("thread/start"), 1)
        self.assertEqual(self.sql("SELECT exited_ms IS NOT NULL,cleanup FROM hosted_children"), [(1, "confirmed")])


class CrashRecoveryCase(HostCase):
    turns = [{"hold": "interrupt"}, {"reply": "after the crash"}]

    def test_a_turn_left_open_by_a_dead_runner_is_settled_lost_on_restart(self):
        runner = self.runner()
        self.open_topic("Work that outlives its runner")
        runner.event("host_dispatch", outcome="handed", mode="start")
        code, final = runner.stop(signal.SIGKILL)
        self.assertEqual(code, -signal.SIGKILL)
        self.assertEqual([row["final_status"] for row in self.turns_rows()], [None])
        # The orphaned child reads end of input and exits by itself.
        # A fresh runner waits out the dead one's lease, resumes, and settles the open row as lost.
        runner = self.runner()
        lost = runner.event("host_turn_end", status="lost")
        self.assertTrue(lost["rearmed"])
        runner.event("host_resume", thread=self.thread)
        runner.event("host_turn_end", status="completed")
        self.assertEqual(self.replies(), ["after the crash"])
        self.assertEqual([row["final_status"] for row in self.turns_rows()], ["lost", "completed"])
        self.stopped_cleanly(runner)
        # Nobody reaped the dead runner's child, so its exit stays unrecorded rather than guessed.
        self.assertEqual(self.sql("SELECT count(*) FROM hosted_children WHERE exited_ms IS NULL"), [(1,)])


class AbandonedDispatchCase(HostCase):
    turns = [{"silent": True, "reply": "late but whole"}]

    def test_an_unanswered_start_is_bounded_by_the_claim_lease_and_the_thread_is_reread(self):
        runner = self.runner()
        self.open_topic("Anyone?")
        abandoned = runner.event("host_dispatch_abandoned")
        first = self.sql("SELECT id FROM wake_attempts ORDER BY started_ms")[0][0]
        self.assertEqual(abandoned["attempt"], first)
        # The next claim reads the thread's last turn first, finds it running, and steers into it.
        steered = runner.event("host_dispatch", outcome="handed", mode="steer")
        runner.event("host_turn_end", status="completed")
        self.assertEqual(self.sql("SELECT a.id,r.outcome FROM wake_attempts a JOIN wake_results r ON r.attempt_id=a.id "
                                  "ORDER BY a.started_ms"), [(first, "expired"), (steered["attempt"], "handed")])
        sent = [entry["in"]["method"] for entry in self.wire() if "in" in entry and entry["in"].get("method", "").startswith(("turn/", "thread/turns"))]
        self.assertEqual(sent, ["thread/turns/list", "turn/start", "thread/turns/list", "turn/steer"])
        self.assertEqual(self.replies(), ["late but whole"])
        self.assertEqual(self.pending(), [])
        # The unanswered start made the child suspect; its answered re-read cleared that, so it was kept.
        names = [event.get("event") for event in runner.events]
        self.assertLess(names.index("host_child_suspect"), names.index("host_child_recovered"))
        self.assertNotIn("host_child_unresponsive", names)
        self.assertEqual(names.count("host_spawn"), 1)
        self.stopped_cleanly(runner)


class StaleInProgressCase(HostCase):
    """The thread's history lists a turn in progress that its app-server no longer runs, and a steer into it
    is refused in words the host does not recognise."""
    turns = [{"vanish": True}, {"reply": "picked up"}]
    script = dict(HostCase.script, steer_refusal="nothing is running on this thread")

    def test_a_turn_believed_running_only_from_history_falls_back_to_a_start_on_any_steer_refusal(self):
        runner = self.runner()
        self.open_topic("Anyone?")
        runner.event("host_dispatch_abandoned")
        # The re-read finds the lost turn listed in progress; the steer into it is refused.
        refused = runner.event("host_steer_refused")
        self.assertFalse(refused["turn_ended"])
        started = runner.event("host_dispatch")
        self.assertEqual((started["outcome"], started.get("mode")), ("handed", "start"))
        self.assertEqual(refused["attempt"], started["attempt"])
        runner.event("host_turn_end", status="completed")
        self.assertEqual(self.replies(), ["picked up"])
        self.assertEqual(self.pending(), [])
        sent = [entry["in"]["method"] for entry in self.wire() if "in" in entry and entry["in"].get("method", "").startswith(("turn/", "thread/turns"))]
        self.assertEqual(sent, ["thread/turns/list", "turn/start", "thread/turns/list", "turn/steer", "turn/start"])
        self.stopped_cleanly(runner)


class LateSteerCase(HostCase):
    turns = [{"hold": "steer", "steer": "late", "reply": "first"}, {"reply": "second"}]

    def test_a_steer_answered_after_its_turn_ended_is_named_again_in_a_fresh_turn(self):
        runner = self.runner()
        self.open_topic("First request")
        runner.event("host_dispatch", outcome="handed", mode="start")
        self.post("Follow-up")
        # The turn ends before the steer's answer is read; the end finds only the start row.
        ended = runner.event("host_turn_end", status="completed")
        self.assertFalse(ended["rearmed"])
        runner.event("host_dispatch", outcome="handed", mode="steer")
        runner.event("host_dispatch", outcome="handed", mode="start")
        runner.event("host_turn_end", status="completed", rearmed=False)
        self.assertEqual(self.replies(), ["first", "second"])
        self.assertEqual(self.pending(), [])
        rows = self.turns_rows()
        self.assertEqual([(row["mode"], row["final_status"], row["seen_ms"] is None) for row in rows],
                         [("start", "completed", False), ("steer", "completed", True), ("start", "completed", False)])
        starts = [entry["in"] for entry in self.wire() if "in" in entry and entry["in"].get("method") == "turn/start"]
        self.assertTrue(starts[-1]["params"]["input"][0]["text"].startswith("Theseus: 1 pending delivery"))
        self.stopped_cleanly(runner)


class UntrackedLateSteerCase(HostCase):
    # The first start is never answered, so no row records its turn; the next claim steers into it.
    turns = [{"silent": True, "hold": "steer", "steer": "late"}, {"reply": "second"}]

    def test_a_late_steer_into_a_turn_core_never_recorded_is_ended_and_named_again(self):
        runner = self.runner()
        self.open_topic("First request")
        runner.event("host_dispatch_abandoned")
        runner.event("host_dispatch", outcome="handed", mode="steer")
        late = runner.event("host_steer_late")
        ended = runner.event("host_turn_end", turn=late["turn"], rearmed=True)
        self.assertEqual(ended["status"], "completed")
        runner.event("host_dispatch", outcome="handed", mode="start")
        runner.event("host_turn_end", status="completed", rearmed=False)
        self.assertEqual(self.replies(), ["second"])
        self.assertEqual(self.pending(), [])
        self.assertEqual([(row["mode"], row["final_status"]) for row in self.turns_rows()], [("steer", "completed"), ("start", "completed")])
        self.stopped_cleanly(runner)


class RaceFailCase(HostCase):
    turns = [{"hold": "steer", "steer": "race_fail", "fail": "httpConnectionFailed"}, {"reply": "second"}, {"reply": "third"}]

    def test_a_turn_failing_under_a_live_claim_has_its_work_named_again(self):
        runner = self.runner()
        self.open_topic("First request")
        runner.event("host_dispatch", outcome="handed", mode="start")
        self.post("Follow-up")
        failed = runner.event("host_turn_end", status="failed")
        self.assertTrue(failed["rearmed"])
        runner.event("host_steer_refused", turn_ended=True)
        # The fallback start carries the notice built at the claim: it names the follow-up only.
        runner.event("host_dispatch", outcome="handed", mode="start")
        runner.event("host_turn_end", status="completed")
        # The failed turn's delivery is named again in the next turn.
        runner.event("host_dispatch", outcome="handed", mode="start")
        runner.event("host_turn_end", status="completed")
        self.assertEqual(self.replies(), ["second", "third"])
        self.assertEqual(self.pending(), [])
        first, follow = [row[0] for row in self.sql("SELECT id FROM deliveries WHERE recipient_id=? ORDER BY seq", (AGENT,))]
        texts = [entry["in"]["params"]["input"][0]["text"] for entry in self.wire()
                 if "in" in entry and entry["in"].get("method") == "turn/start"]
        # The fallback start named the follow-up only; the turn after it names the failed turn's delivery again.
        self.assertEqual(texts[1].splitlines()[0], "Theseus: 1 new delivery for %s." % AGENT)
        self.assertNotIn("delivery " + first, texts[1])
        self.assertIn("delivery " + follow, texts[1])
        self.assertTrue(texts[-1].splitlines()[0].startswith("Theseus: "))
        self.assertIn("pending deliver", texts[-1].splitlines()[0])
        self.assertIn("delivery " + first, texts[-1])
        self.stopped_cleanly(runner)


class AbandonedDuringResumeCase(HostCase):
    script = {"gate_resume_once": True}
    turns = [{"reply": "once"}]

    def test_a_dispatch_abandoned_while_its_thread_attaches_sends_nothing_later(self):
        gate = self.gated()
        runner = self.runner()
        self.open_topic("Hello while the resume is slow")
        abandoned = runner.event("host_dispatch_abandoned")
        with open(str(gate), "w"):
            pass
        late = runner.event("host_dispatch_late", attempt=abandoned["attempt"])
        self.assertEqual(late["outcome"], "unavailable")
        handed = runner.event("host_dispatch", outcome="handed", mode="start")
        runner.event("host_turn_end", status="completed")
        # Only the live claim's turn was ever started: one message, one reply.
        self.assertEqual(self.turn_rpcs(), [("turn/start", "theseus:" + handed["attempt"])])
        self.assertEqual(self.replies(), ["once"])
        self.assertEqual(self.sql("SELECT attempt_id,outcome FROM wake_results ORDER BY finished_ms"),
                         [(abandoned["attempt"], "expired"), (handed["attempt"], "handed")])
        self.stopped_cleanly(runner)


class InputStallCase(HostCase):
    """A child that stops reading its input never blocks the loop that serves leases and stop signals."""
    script = {"gate_turns_list_once": True}
    turns = [{"reply": "after the stall"}]

    def flood(self):
        # Twenty deliveries, all pending before the runner starts, make its
        # first notice far larger than a pipe holds.
        self.act("workspace.create", {"id": "w1", "title": "Input stall", "purpose": "A notice larger than a pipe",
                                      "team": [AGENT], "coordinator": AGENT}, {})
        for n in range(20):
            opening = "o-%d" % n
            self.act("opening.save", {"workspace_id": "w1", "topic_id": "%d" % n + "\U0001F600" * 198, "title": "\x01" * 80,
                                      "participants": [AGENT], "body": "\x01" * 256, "attachments": []},
                     {"opening_id": opening}, {"opening_revision": 0})
            self.act("opening.publish", {}, {"opening_id": opening}, {"opening_revision": 1})

    def test_a_stop_ends_the_runner_while_its_child_reads_no_input(self):
        self.gated()
        self.flood()
        runner = self.runner()
        waiting = runner.event("host_input_waiting")
        self.assertGreater(waiting["unread"], 0)
        os.kill(runner.pid, signal.SIGTERM)
        os.kill(runner.pid, signal.SIGTERM)
        code, final = runner.finish()
        self.assertEqual((code, final["status"]), (0, "stopped"), runner.events[-8:])
        self.assertEqual({row[1:] for row in self.sql("SELECT pid,exited_ms IS NOT NULL,cleanup FROM hosted_children")}, {(1, "confirmed")})
        self.assertEqual(self.turn_rpcs(), [], "no turn reached the child that stopped reading")

    def test_a_child_that_reads_no_input_for_a_whole_lease_is_ended_and_the_work_goes_to_a_fresh_child(self):
        self.gated()
        self.flood()
        runner = self.runner()
        runner.event("host_input_waiting")
        abandoned = runner.event("host_dispatch_abandoned")
        stalled = runner.event("host_input_stalled")
        self.assertGreater(stalled["unread"], 0)
        runner.event("host_child_exit", pid=stalled["pid"])
        handed = runner.event("host_dispatch", outcome="handed", mode="start")
        runner.event("host_turn_end", status="completed")
        # The dead claim's turn never started: only the live claim's notice reached a child whole.
        self.assertEqual(self.turn_rpcs(), [("turn/start", "theseus:" + handed["attempt"])])
        self.assertEqual(self.sql("SELECT attempt_id,outcome FROM wake_results ORDER BY finished_ms"),
                         [(abandoned["attempt"], "expired"), (handed["attempt"], "handed")])
        self.stopped_cleanly(runner)

    def test_input_space_that_frees_after_the_lease_ends_never_delivers_the_dead_claims_input(self):
        gate = self.gated()
        self.flood()
        runner = self.runner()
        runner.event("host_input_waiting")
        expired = self.sql("SELECT id,lease_until_ms FROM wake_attempts ORDER BY started_ms DESC LIMIT 1")[0]
        # Held still, the runner cannot act until the child has room again and the lease has ended.
        os.kill(runner.pid, signal.SIGSTOP)
        self.addCleanup(lambda: runner.process.poll() is None and os.kill(runner.pid, signal.SIGCONT))
        with open(str(gate), "w"):
            pass
        # The only wait in this test: the runner is stopped, so nothing races the deadline.
        time.sleep(max(0.0, expired[1] / 1000 - time.time()) + 0.25)
        os.kill(runner.pid, signal.SIGCONT)
        abandoned = runner.event("host_dispatch_abandoned")
        self.assertEqual(abandoned["attempt"], expired[0])
        runner.event("host_input_stalled")
        handed = runner.event("host_dispatch", outcome="handed", mode="start")
        runner.event("host_turn_end", status="completed")
        self.assertEqual(self.turn_rpcs(), [("turn/start", "theseus:" + handed["attempt"])],
                         "the expired claim's turn/start never reached a child")
        self.stopped_cleanly(runner)

    def test_a_child_that_ignores_term_is_killed_on_its_deadline_before_another_claim_expires(self):
        self.gated()
        script = dict(self.script, ignore_term_once=True, turns=self.turns)
        (self.home / "fake-script.json").write_text(json.dumps(script))
        self.flood()
        runner = self.runner()
        first = runner.event("host_dispatch_abandoned")
        stalled = runner.event("host_input_stalled")
        runner.event("host_attach_waits", pid=stalled["pid"])
        # TERM has its own deadline: no further work or claim expiry is needed.
        runner.event("host_child_killed", pid=stalled["pid"])
        exit_event = runner.event("host_child_exit", pid=stalled["pid"])
        self.assertEqual(exit_event["status"], -signal.SIGKILL)
        handed = runner.event("host_dispatch", outcome="handed", mode="start")
        runner.event("host_turn_end", status="completed")
        self.assertEqual(self.sql("SELECT attempt_id,outcome FROM wake_results ORDER BY finished_ms"),
                         [(first["attempt"], "expired"), (handed["attempt"], "handed")])
        self.stopped_cleanly(runner)

    def test_a_claim_that_arrives_while_the_ended_child_is_still_exiting_goes_to_its_successor(self):
        self.gated()
        term = self.gated("term-gate")
        script = dict(self.script, linger_on_term=True, turns=self.turns)
        (self.home / "fake-script.json").write_text(json.dumps(script))
        self.flood()
        runner = self.runner()
        abandoned = runner.event("host_dispatch_abandoned")
        stalled = runner.event("host_input_stalled")
        # The next claim finds the ended child alive and waits for its successor.
        runner.event("host_attach_waits", pid=stalled["pid"])
        with open(str(term), "w"):
            pass
        runner.event("host_child_exit", pid=stalled["pid"])
        handed = runner.event("host_dispatch", outcome="handed", mode="start")
        runner.event("host_turn_end", status="completed")
        self.assertEqual(self.turn_rpcs(), [("turn/start", "theseus:" + handed["attempt"])])
        # No claim was answered unavailable while the replacement was under way.
        self.assertEqual(self.sql("SELECT attempt_id,outcome FROM wake_results ORDER BY finished_ms"),
                         [(abandoned["attempt"], "expired"), (handed["attempt"], "handed")])
        self.stopped_cleanly(runner)


class UnansweredRequestCase(HostCase):
    """A child that reads its input but answers nothing gets one recovery chance, then is ended."""
    script = {"mute_after_resume_once": True}
    turns = [{"reply": "after the silence"}]

    def test_a_child_that_answers_no_request_through_its_recovery_lease_is_ended(self):
        runner = self.runner()
        self.open_topic("Please process this work.")
        first = runner.event("host_dispatch_abandoned")
        suspect = runner.event("host_child_suspect")
        # The second claim re-reads the thread on the same child; no answer comes.
        second = runner.event("host_dispatch_abandoned")
        runner.event("host_child_unresponsive", pid=suspect["pid"])
        runner.event("host_child_exit", pid=suspect["pid"])
        handed = runner.event("host_dispatch", outcome="handed", mode="start")
        runner.event("host_turn_end", status="completed")
        self.assertEqual(self.replies(), ["after the silence"])
        self.assertEqual(self.sql("SELECT attempt_id,outcome FROM wake_results ORDER BY finished_ms"),
                         [(first["attempt"], "expired"), (second["attempt"], "expired"), (handed["attempt"], "handed")])
        self.assertNotIn("host_child_recovered", [event.get("event") for event in runner.events])
        self.stopped_cleanly(runner)


class EndBeforeAnswerCase(HostCase):
    """A turn that is seen and ends before turn/start is answered is recorded once its handed row exists."""
    turns = [{"end_first": True, "fail": "usageLimitExceeded"}, {"end_first": True, "reply": "done early"}]

    def turn(self):
        rows = self.turns_rows()
        self.assertEqual(len(rows), 1, rows)
        return rows[0]

    def test_a_failure_seen_before_the_start_answer_is_recorded_and_rearms(self):
        runner = self.runner()
        self.open_topic("Please process this work.")
        runner.event("host_dispatch", outcome="handed", mode="start")
        replayed = runner.event("host_turn_end", status="failed", replayed=True)
        self.assertTrue(replayed["rearmed"])
        row = self.turn()
        self.assertEqual((row["final_status"], row["error_code"], row["input_tokens"]), ("failed", "usageLimitExceeded", 100))
        self.assertIsNotNone(row["seen_ms"], "the seen marker that arrived first is kept")
        schedule = self.sql("SELECT handed_seq,next_due_ms FROM recipient_schedule WHERE recipient_id=?", (AGENT,))[0]
        self.assertIsNone(schedule[0])
        self.assertIsNotNone(schedule[1], "the failed turn's delivery is due again")
        self.stopped_cleanly(runner)

    def test_a_completion_seen_before_the_start_answer_settles_without_rearming(self):
        (self.home / "fake-script.json").write_text(json.dumps(dict(self.script, turns=self.turns[1:])))
        runner = self.runner()
        self.open_topic("Please process this work.")
        runner.event("host_dispatch", outcome="handed", mode="start")
        replayed = runner.event("host_turn_end", status="completed", replayed=True)
        self.assertFalse(replayed["rearmed"])
        row = self.turn()
        self.assertEqual(row["final_status"], "completed")
        self.assertIsNotNone(row["seen_ms"])
        self.assertEqual(self.replies(), ["done early"])
        self.assertEqual(self.pending(), [])
        self.stopped_cleanly(runner)


class BrokenAttachCase(HostCase):
    """A shape error in the resume or reconcile answer closes the child; the thread is attached afresh."""
    turns = [{"reply": "recovered"}]

    def check(self, script, reason):
        (self.home / "fake-script.json").write_text(json.dumps(dict(script, turns=self.turns)))
        runner = self.runner()
        broken = runner.event("host_protocol_error")
        self.assertEqual(broken["reason"], reason)
        runner.event("host_child_exit", pid=broken["pid"])
        self.open_topic("Anyone there?")
        outcome = runner.until(lambda event: event.get("event") in ("host_dispatch", "host_dispatch_abandoned"), "the dispatch")
        self.assertEqual((outcome["event"], outcome.get("outcome"), outcome.get("mode")), ("host_dispatch", "handed", "start"))
        runner.event("host_turn_end", status="completed")
        self.assertEqual(self.replies(), ["recovered"])
        self.stopped_cleanly(runner)

    def test_a_malformed_last_turn_at_reattach(self):
        self.check({"bad_turns_list_once": "queued"}, "invalid_turn")

    def test_a_last_turn_status_that_is_not_text(self):
        self.check({"bad_turns_list_once": ["inProgress"]}, "invalid_turn")

    def test_a_malformed_resume_answer(self):
        self.check({"bad_resume_once": True}, "invalid_resume")


class MalformedMessageCase(HostCase):
    """A child that sends a wrongly typed field is closed alone; the runner goes on."""

    def check(self, behaviour, reason):
        (self.home / "fake-script.json").write_text(json.dumps({"turns": [behaviour, {"reply": "recovered"}]}))
        runner = self.runner()
        self.open_topic("Hello")
        broken = runner.event("host_protocol_error")
        self.assertEqual(broken["reason"], reason)
        runner.event("host_child_exit", pid=broken["pid"])
        runner.event("host_turn_end", status="completed")
        self.assertEqual(self.replies(), ["recovered"])
        self.assertEqual(self.pending(), [])
        self.stopped_cleanly(runner)

    def test_a_notification_whose_thread_is_not_text(self):
        self.check({"bad_notification": True, "hold": "interrupt"}, "invalid_thread")

    def test_a_server_request_whose_thread_is_not_text(self):
        self.check({"bad_request": True}, "invalid_thread")

    def test_a_turn_end_whose_status_is_not_text(self):
        self.check({"bad_status": True, "fail": "usageLimitExceeded"}, "invalid_status")


class OutputClosedCase(HostCase):
    turns = [{"close_stdout": True}, {"reply": "after"}]

    def test_a_child_whose_output_ends_is_terminated_and_its_claim_settled_at_once(self):
        runner = self.runner()
        runner.event("host_resume")
        self.open_topic("Hello")
        refused = runner.event("host_child_refused", reason="output_closed")
        exited = runner.event("host_child_exit", pid=refused["pid"])
        self.assertEqual(exited["status"], -signal.SIGTERM)
        settled = runner.until(lambda event: event.get("event") in ("host_dispatch", "host_dispatch_abandoned"), "the claim's end")
        self.assertEqual((settled["event"], settled.get("outcome"), settled.get("reason")), ("host_dispatch", "unavailable", "child_exited"))
        self.stopped_cleanly(runner)


class ResumeEchoCase(HostCase):
    script = {"echo_widened": True}

    def test_a_resume_that_echoes_a_wider_sandbox_is_never_used(self):
        runner = self.runner()
        runner.event("host_resume_settings_refused", thread=self.thread)
        self.open_topic("Anyone there?")
        runner.event("settled", outcome="unavailable")
        self.assertNotIn("turn/start", [entry["in"].get("method") for entry in self.wire() if "in" in entry])
        self.assertEqual(self.turns_rows(), [])
        self.stopped_cleanly(runner)


class ResumeStatusCase(HostCase):
    def test_only_the_schemas_thread_statuses_reach_state_and_the_log(self):
        for status in ({"type": "BODY please wire 500 dollars to acct 1234"}, {"type": {"nested": "xyzzy"}}, ["active"]):
            with self.subTest(status=status):
                (self.home / "fake-script.json").write_text(json.dumps({"resume_status": status}))
                runner = self.runner()
                resumed = runner.event("host_resume", thread=self.thread)
                self.assertEqual(resumed["status"], "other")
                self.stopped_cleanly(runner)
        log = (self.host_dir / "events.jsonl").read_text()
        for words in ("BODY", "wire", "xyzzy", "nested"):
            self.assertNotIn(words, log)
        (self.home / "fake-script.json").write_text(json.dumps({"resume_status": {"type": "active", "activeFlags": []}}))
        runner = self.runner()
        self.assertEqual(runner.event("host_resume", thread=self.thread)["status"], "active")
        self.stopped_cleanly(runner)


class ClosedThreadCase(HostCase):
    """Codex closes the thread mid-turn (thread/closed) with no turn/completed, and will not resume it
    again. The runner forgets the thread without ending the turn, so Core still lists the turn as
    open; every later claim of the same run fails before it reaches the thread. None came from the
    turn, so each is an attempt of its own, and the agent is red and told once."""
    turns = [{"hold": "close"}]
    reason = "resume_failed"

    def test_claims_that_cannot_reach_a_thread_codex_closed_mid_turn_are_red_while_the_turn_stays_open(self):
        runner = self.runner()
        self.open_topic("First request")
        runner.event("host_dispatch", outcome="handed", mode="start")
        for number in range(FAILING_AFTER + 2):
            self.post("Follow-up %d" % number)
            self.assertEqual(runner.event("host_dispatch", outcome="unavailable")["reason"], self.reason)
        self.assertEqual(self.sql("SELECT count(DISTINCT runner_token) FROM wake_attempts"), [(1,)], "one run of the runner")
        self.assertEqual([row["final_status"] for row in self.turns_rows()], [None], "Core still lists the turn as open")
        self.assertEqual(self.store.view("lead", "health_light", {})["red"], ["failing:" + AGENT])
        self.assertEqual(self.sql("SELECT failed_wakes,failed_outcome,failed_reason FROM wake_facts WHERE recipient_id=?", (AGENT,)),
                         [(FAILING_AFTER + 2, "unavailable", self.reason)])
        notices = [row[0] for row in self.sql("SELECT body FROM messages WHERE author_id='theseus'")]
        self.assertEqual(len(notices), 1, notices)
        self.assertIn("Why: %s." % WHY[self.reason], notices[0])
        self.stopped_cleanly(runner)


class UnloadedThreadCase(ClosedThreadCase):
    """The same, with the thread's status changed to notLoaded, and Codex resuming it with a sandbox
    wider than asked, which the host never uses."""
    turns = [{"hold": "unload", "resume": "widened"}]
    reason = "settings_not_applied"


class ActedThenClosedCase(HostCase):
    """The reviewer's r5 order probe: the agent acts in its turn, then Codex closes the thread and
    every later claim fails before it reaches it. The runner then stops (a deploy): its Codex process
    exits and the host ends the turn lost. The turn got through when the agent acted, before the
    outage, so its end clears nothing: the team is not told the agent can be woken again."""
    turns = [{"hold": "close"}]

    def test_a_turn_the_agent_acted_in_ending_after_an_outage_began_clears_none_of_it(self):
        runner = self.runner()
        self.open_topic("First request")
        runner.event("host_dispatch", outcome="handed", mode="start")
        self.serial += 1
        receipt = self.store.command(AGENT, {"v": 1, "instance_id": INSTANCE, "operation_id": "op-agent-%d" % self.serial,
                                             "kind": "message.post", "target": {"topic_id": "t1"}, "args": {"body": "On it"},
                                             "expected": {"authority": dict(self.pin)}})
        self.assertEqual(receipt["status"], "committed", receipt)
        for number in range(FAILING_AFTER):
            self.post("Follow-up %d" % number)
            self.assertEqual(runner.event("host_dispatch", outcome="unavailable")["reason"], "resume_failed")
        facts = "SELECT failed_wakes,failed_outcome,failed_reason FROM wake_facts WHERE recipient_id=?"
        self.assertEqual(self.sql(facts, (AGENT,)), [(FAILING_AFTER, "unavailable", "resume_failed")])
        self.stopped_cleanly(runner)
        self.assertEqual([row["final_status"] for row in self.turns_rows()], ["lost"], "the process exited and the turn ended lost")
        self.assertEqual(self.sql(facts, (AGENT,)), [(FAILING_AFTER, "unavailable", "resume_failed")])
        notices = [row[0] for row in self.sql("SELECT body FROM messages WHERE author_id='theseus'")]
        self.assertEqual(len(notices), 1, notices)
        self.assertIn("can't be woken", notices[0])


class SteerIntoReviewTurnCase(HostCase):
    """The reviewer's P1, end to end: a message arrives while the agent's turn is one Codex cannot
    steer (a review), so three steers into it are refused as not steerable; the turn then completes.
    The host names the turn each refusal came from, so they join it: the turn ran and completed, and
    nothing is told."""
    turns = [{"hold": "steer", "steer": "busy", "refusals": FAILING_AFTER, "reply": "first"}, {"reply": "second"}]

    def test_steers_a_running_turn_refuses_as_not_steerable_join_it_and_tell_nothing(self):
        runner = self.runner()
        self.open_topic("First request")
        runner.event("host_dispatch", outcome="handed", mode="start")
        self.post("Second")
        for number in range(FAILING_AFTER):
            self.assertEqual(runner.event("host_dispatch", outcome="busy")["reason"], "not_steerable")
        runner.event("host_turn_end", status="completed")
        runner.event("host_dispatch", outcome="handed", mode="start")
        runner.event("host_turn_end", status="completed")
        self.assertEqual(self.sql("SELECT failed_wakes FROM wake_facts WHERE recipient_id=?", (AGENT,)), [(0,)])
        self.assertEqual(self.sql("SELECT body FROM messages WHERE author_id='theseus'"), [], "nothing is told")
        self.stopped_cleanly(runner)


class SteerRefusedCase(HostCase):
    """Codex refuses every steer into the running turn for a reason that does not say the turn runs
    (steer_failed): the host names no turn, so each counts, and the agent is red while the turn
    stays open in Core."""
    turns = [{"hold": "steer", "steer": "refuse"}]

    def test_steers_refused_without_saying_the_turn_runs_are_each_an_attempt(self):
        runner = self.runner()
        self.open_topic("First request")
        runner.event("host_dispatch", outcome="handed", mode="start")
        self.post("Second")
        for number in range(FAILING_AFTER):
            self.assertEqual(runner.event("host_dispatch", outcome="error")["reason"], "steer_failed")
        self.assertEqual([row["final_status"] for row in self.turns_rows()], [None], "the turn still runs")
        self.assertEqual(self.sql("SELECT failed_wakes,failed_reason FROM wake_facts WHERE recipient_id=?", (AGENT,)),
                         [(FAILING_AFTER, "steer_failed")])
        self.assertEqual(self.store.view("lead", "health_light", {})["red"], ["failing:" + AGENT])
        self.stopped_cleanly(runner)


class SteerInFlightDeathCase(HostCase):
    """The reviewer's P2, end to end: Codex's process dies with a steer in flight. The steer's claim
    settles child_exited naming the turn the process ran, and the host ends that turn lost: one
    fault, one attempt that did not get through."""
    turns = [{"hold": "steer", "steer": "die"}, {"reply": "again"}]

    def test_a_process_that_dies_with_a_steer_in_flight_is_one_attempt(self):
        runner = self.runner()
        self.open_topic("First request")
        runner.event("host_dispatch", outcome="handed", mode="start")
        self.post("Second")
        self.assertEqual(runner.event("host_dispatch", outcome="unavailable")["reason"], "child_exited")
        runner.event("host_turn_end", status="lost")
        self.assertEqual(self.sql("SELECT failed_wakes,failed_outcome FROM wake_facts WHERE recipient_id=?", (AGENT,)), [(1, "lost")])
        self.stopped_cleanly(runner)


class LostTurnCase(HostCase):
    """The reviewer's r5 and r6 lost-turn probes: Codex's app-server loses the turn it started (no
    turn/completed), so the host's next steer into it is refused and it starts a new turn, which
    completes. The new turn's start is when Core ends the lost one, lost, the same run, not when the
    process exits. Then Codex never answers turn/start, so every claim expires. No running turn
    refused them, so each is an attempt that did not get through: the agent is red and told once."""
    turns = [{"lose": True}, {"reply": "second"}] + [{"vanish": True}] * 8

    def test_claims_that_expire_while_a_lost_turn_stays_open_are_red_and_told(self):
        runner = self.runner()
        self.open_topic("First request")
        runner.event("host_dispatch", outcome="handed", mode="start")
        self.post("Second")
        runner.event("host_steer_refused")
        runner.event("host_dispatch", outcome="handed", mode="start")
        runner.event("host_turn_end", status="completed")
        self.assertEqual(self.replies(), ["second"])
        # The agent acknowledges the first request too, from its history, so nothing waits before the next.
        pending = self.store.view(AGENT, "deliveries", {})["items"]
        self.assertEqual(len(pending), 1, pending)
        self.serial += 1
        receipt = self.store.command(AGENT, {"v": 1, "instance_id": INSTANCE, "operation_id": "op-agent-%d" % self.serial,
                                             "kind": "delivery.ack", "target": {"delivery_id": pending[0]["id"]}, "args": {},
                                             "expected": {"authority": dict(self.pin)}})
        self.assertEqual(receipt["status"], "committed", receipt)
        lost, second = self.turns_rows()
        self.assertEqual((lost["final_status"], lost["finished_ms"], second["mode"], second["final_status"]),
                         ("lost", second["handed_ms"], "start", "completed"), "the lost turn ended when the new one started")
        self.post("Third")
        for number in range(FAILING_AFTER):
            runner.event("host_dispatch_abandoned")
        # The claim after the last abandoned one finds it expired.
        runner.until(lambda event: event.get("event") in ("host_dispatch", "host_dispatch_abandoned", "host_steer_refused"), "the next claim")
        self.assertEqual(self.sql("SELECT count(DISTINCT runner_token) FROM wake_attempts"), [(1,)], "one run of the runner")
        self.assertEqual(self.sql("SELECT failed_wakes,failed_outcome,failed_reason FROM wake_facts WHERE recipient_id=?", (AGENT,)),
                         [(FAILING_AFTER, "expired", "expired")])
        self.assertEqual(self.store.view("lead", "health_light", {})["red"], ["failing:" + AGENT])
        notices = [row[0] for row in self.sql("SELECT body FROM messages WHERE author_id='theseus'")]
        self.assertEqual(len(notices), 1, notices)
        self.stopped_cleanly(runner)


class ProvisionCase(HostCase):
    def test_provisioning_pins_the_thread_and_writes_an_exact_private_config(self):
        self.assertEqual(self.provisioned["exit_code"], 0)
        value = json.loads(self.config.read_text())
        self.assertEqual(self.config.stat().st_mode & 0o777, 0o600)
        self.assertEqual(value, {"v": 1, "kind": "codex-hosted-stdio", "actor_id": AGENT, "profile": str(self.agent_profile),
                                 "cli": str(self.cli), "codex_executable": str(self.codex), "codex_home": str(self.home),
                                 "thread_id": self.thread, "cwd": str(self.work), "model": None,
                                 "writable_roots": [str(self.db.parent), str(self.agent_profile.parent / (AGENT + ".outbox"))]})
        pin = self.store.read_route_pin(AGENT, {"kind": "codex-hosted-stdio", "protocol_version": 1,
                                                "codex_home": str(self.home), "thread_id": self.thread})
        self.assertEqual(pin["destination"]["thread_id"], self.thread)
        started = [entry["in"] for entry in self.wire() if "in" in entry and entry["in"].get("method") == "thread/start"]
        self.assertEqual(len(started), 1)
        params = started[0]["params"]
        self.assertEqual((params["approvalPolicy"], params["sandbox"], params["ephemeral"], params["cwd"]),
                         ("never", "workspace-write", False, str(self.work)))
        self.assertEqual(params["config"]["sandbox_workspace_write"]["writable_roots"], value["writable_roots"])
        self.assertFalse(params["config"]["sandbox_workspace_write"]["network_access"])
        self.assertIn("Your CLI: /usr/bin/python3 -I %s --profile %s" % (self.cli, self.agent_profile), params["developerInstructions"])
        # The provisioning child was reaped: its spawn has a matching end of input.
        self.assertEqual(len([entry for entry in self.wire() if "spawn" in entry]), 1)

    def test_a_second_thread_for_a_pinned_actor_is_refused_and_named(self):
        again = self.provision(config=self.root / "second.json")
        self.assertEqual((again["status"], again["reason"], again["exit_code"]), ("refused", "ROUTE_PIN_MISMATCH", 2))
        self.assertNotEqual(again["orphan_thread_id"], self.thread)
        self.assertFalse((self.root / "second.json").exists())

    def test_a_home_that_is_not_signed_in_provisions_nothing(self):
        (self.home / "fake-script.json").write_text(json.dumps({"signed_in": False}))
        profile, unused = self.second_agent()
        refused = self.provision(config=self.root / "second.json", profile=profile)
        self.assertEqual((refused["status"], refused["reason"]), ("refused", "auth_missing"))
        self.assertNotIn("orphan_thread_id", refused)
        self.assertFalse((self.root / "second.json").exists())
        self.assertEqual(len(self.fake_state()["threads"]), 1)

    def test_a_symlinked_outbox_is_refused_before_any_thread_starts(self):
        profile, outbox = self.second_agent()
        elsewhere = self.root / "elsewhere"
        elsewhere.mkdir(mode=0o700)
        os.symlink(str(elsewhere), str(outbox))
        spawns = len([entry for entry in self.wire() if "spawn" in entry])
        refused = self.provision(config=self.root / "second.json", profile=profile)
        self.assertEqual((refused["status"], refused["reason"]), ("refused", "invalid_writable_roots"))
        self.assertNotIn("orphan_thread_id", refused)
        # Refused before any child is spawned.
        self.assertEqual(len([entry for entry in self.wire() if "spawn" in entry]), spawns)
        self.assertEqual([entry["in"].get("method") for entry in self.wire() if "in" in entry].count("thread/start"), 1)
        self.assertFalse((self.root / "second.json").exists())
        self.assertTrue(outbox.is_symlink())

    def test_a_refused_provision_leaves_no_outbox_behind(self):
        profile, outbox = self.second_agent()
        existing = self.root / "taken.json"
        existing.write_text("{}")
        refused = self.provision(config=existing, profile=profile)
        self.assertEqual(refused["reason"], "invalid_config_path")
        self.assertFalse(os.path.lexists(str(outbox)))
        (self.home / "fake-script.json").write_text(json.dumps({"signed_in": False}))
        refused = self.provision(config=self.root / "second.json", profile=profile)
        self.assertEqual(refused["reason"], "auth_missing")
        self.assertFalse(os.path.lexists(str(outbox)))
        # A provision that starts its thread creates the outbox, private to the owner.
        (self.home / "fake-script.json").write_text(json.dumps({}))
        self.assertEqual(self.provision(config=self.root / "second.json", profile=profile)["status"], "provisioned")
        self.assertEqual(outbox.stat().st_mode & 0o777, 0o700)

    def test_an_echo_wider_than_the_settings_sent_is_refused_and_its_thread_named(self):
        profile, outbox = self.second_agent()
        for widened in ({"echo_widened": True},):
            (self.home / "fake-script.json").write_text(json.dumps(widened))
            refused = self.provision(config=self.root / "second.json", profile=profile)
            self.assertEqual((refused["status"], refused["reason"]), ("refused", "thread_settings_not_applied"))
            self.assertIn(refused["orphan_thread_id"], self.fake_state()["threads"])
        self.assertFalse((self.root / "second.json").exists())
        with self.assertRaises(Exception) as raised:
            self.store.read_route_pin("hosted-2", {"kind": "codex-hosted-stdio", "protocol_version": 1,
                                                   "codex_home": str(self.home), "thread_id": refused["orphan_thread_id"]})
        self.assertEqual(raised.exception.code, "ROUTE_PIN_MISSING")

    def test_the_owners_own_codex_home_is_never_a_hosted_home(self):
        profile, outbox = self.second_agent()
        desktop = self.root / "desktop-codex"
        inside = desktop / "nested"
        inside.mkdir(parents=True, mode=0o700)
        desktop.chmod(0o700)
        spawns = len([entry for entry in self.wire() if "spawn" in entry])
        arguments = dict(runner_profile=str(self.lead_profile), runner_id="host-fixture", actor_profile=str(profile),
                         codex_executable=str(self.codex), cli=str(self.cli), cwd=str(self.work), model=None)
        with mock.patch.object(broker_routes, "desktop_codex_home", return_value=str(desktop)):
            for home in (desktop, inside):
                with self.subTest(home=home):
                    with self.assertRaises(broker_routes.BrokerConfigError) as raised:
                        codex_host.provision(codex_home=str(home), config_path=str(self.root / "second.json"), **arguments)
                    self.assertEqual(raised.exception.code, "invalid_codex_home")
        with mock.patch.object(broker_routes, "desktop_codex_home", return_value=str(self.home)):
            with self.assertRaises(broker_routes.BrokerConfigError) as raised:
                broker_routes.load_hosted_config(str(self.config))
            self.assertEqual(raised.exception.code, "invalid_codex_home")
        # Nothing was spawned or created, and a home beside the desktop's is still accepted.
        self.assertEqual(len([entry for entry in self.wire() if "spawn" in entry]), spawns)
        self.assertFalse(os.path.lexists(str(outbox)))
        with mock.patch.object(broker_routes, "desktop_codex_home", return_value=str(desktop)):
            self.assertEqual(broker_routes.load_hosted_config(str(self.config)).destination["codex_home"], str(self.home))
        # The desktop home comes from the password database, so an altered HOME cannot move it.
        with mock.patch.dict(os.environ, {"HOME": str(self.root)}):
            self.assertEqual(broker_routes.desktop_codex_home(),
                             os.path.realpath(os.path.join(pwd.getpwuid(os.getuid()).pw_dir, ".codex")))
            self.assertFalse(broker_routes.desktop_codex_home().startswith(str(self.root)))


class FramingCase(unittest.TestCase):
    """The host's own JSON-RPC rules, below the process level."""

    def piped_child(self):
        reader, writer = os.pipe()
        self.addCleanup(lambda: os.close(reader))
        child = object.__new__(codex_host.Child)
        stdin = os.fdopen(writer, "wb", buffering=0)
        self.addCleanup(lambda: stdin.closed or stdin.close())
        child.popen = type("Popen", (), {"stdin": stdin, "returncode": 0})()
        child.input, child.outbox, child.write_watched, child.backlogged, child.signals = writer, bytearray(), False, False, set()
        os.set_blocking(writer, False)
        watched = []
        child.writable = lambda unused, on: watched.append(on)
        return child, reader, watched

    def test_input_the_pipe_cannot_take_waits_whole_and_drains_in_order(self):
        child, reader, watched = self.piped_child()
        big = {"method": "big", "params": {"text": "x" * 300000}}
        self.assertTrue(child.send(big))
        self.assertTrue(child.send({"method": "after"}))
        self.assertTrue(child.outbox, "the pipe took only part of it, and the send did not wait")
        self.assertEqual(watched, [True])
        received = bytearray()
        while child.outbox:
            received.extend(os.read(reader, 1 << 20))
            child.flush()
        self.assertEqual(watched, [True, False])
        os.set_blocking(reader, False)
        try:
            received.extend(os.read(reader, 1 << 20))
        except BlockingIOError:
            pass
        lines = bytes(received).split(b"\n")
        self.assertEqual([json.loads(line) for line in lines if line], [big, {"method": "after"}])

    def test_a_child_that_leaves_too_much_unread_is_closed_and_refused(self):
        child, reader, watched = self.piped_child()
        filler = {"method": "fill", "params": {"text": "x" * (codex_host.MAX_MESSAGE - 1000)}}
        self.assertTrue(child.send(filler))
        self.assertTrue(child.send(filler))
        self.assertFalse(child.send(filler))
        self.assertTrue(child.backlogged)
        self.assertFalse(child.open)
        self.assertEqual(child.outbox, bytearray())
        self.assertEqual(watched, [True, False], "unwatched before its descriptor closed")

    def test_answers_follow_the_design_table(self):
        label, response = codex_host.answer({"id": 9, "method": "item/tool/requestUserInput", "params": {}})
        self.assertEqual(label, "ask_in_theseus")
        self.assertNotIn("result", response, "no empty result may pretend a person answered")
        self.assertIn("post TOPIC --asks PERSON", response["error"]["message"])
        expected = {
            "item/commandExecution/requestApproval": {"decision": "decline"},
            "item/fileChange/requestApproval": {"decision": "decline"},
            "item/permissions/requestApproval": {"permissions": {}, "scope": "turn"},
            "mcpServer/elicitation/request": {"action": "decline", "content": None},
            "item/tool/call": {"contentItems": [{"type": "inputText", "text": "not available"}], "success": False},
        }
        for method, result in expected.items():
            with self.subTest(method=method):
                self.assertEqual(codex_host.answer({"id": 7, "method": method, "params": {}})[1], {"id": 7, "result": result})
        now = codex_host.answer({"id": "x", "method": "currentTime/read", "params": {"threadId": "t"}})[1]
        self.assertEqual(set(now["result"]), {"currentTimeAt"})
        self.assertLessEqual(abs(now["result"]["currentTimeAt"] - time.time()), 2)
        for method in ("account/chatgptAuthTokens/refresh", "attestation/generate", "applyPatchApproval",
                       "execCommandApproval", "something/new"):
            with self.subTest(method=method):
                self.assertEqual(codex_host.answer({"id": 3, "method": method})[1],
                                 {"id": 3, "error": {"code": -32601, "message": "not supported by theseus host"}})

    def test_message_kinds_are_exact(self):
        self.assertEqual(codex_host._kind({"id": 1, "method": "m", "params": {}}), "request")
        self.assertEqual(codex_host._kind({"id": "s", "method": "m"}), "request")
        self.assertEqual(codex_host._kind({"method": "m", "params": {}}), "notification")
        self.assertEqual(codex_host._kind({"id": 1, "result": None}), "response")
        self.assertEqual(codex_host._kind({"id": 1, "error": {"code": 1, "message": "x"}}), "response")
        for bad in ({"id": 1}, {"id": 1, "result": 1, "error": {"message": "x"}}, {"method": ""}, {"method": 5},
                    {"id": 1.5, "method": "m"}, {"id": 1, "error": {"code": 1}}, {"result": 1}, {"id": [1], "result": 1},
                    {"id": None, "result": 1}):
            with self.subTest(bad=bad), self.assertRaises(codex_host.ProtocolError):
                codex_host._kind(bad)

    def test_error_codes_are_keys_never_text(self):
        self.assertEqual(codex_host.error_code({"message": "m", "codexErrorInfo": "usageLimitExceeded"}), "usageLimitExceeded")
        self.assertEqual(codex_host.error_code({"codexErrorInfo": {"httpConnectionFailed": {"httpStatusCode": 502}}}), "httpConnectionFailed")
        for value in (None, {"message": "x"}, {"codexErrorInfo": "has space"}, {"codexErrorInfo": {"a": 1, "b": 2}},
                      {"codexErrorInfo": "x" * 65}):
            self.assertIsNone(codex_host.error_code(value))

    def test_reading_frames_lines_and_bounds_a_message(self):
        reader, writer = os.pipe()
        try:
            child = object.__new__(codex_host.Child)
            child.out, child.buffer, child.eof = reader, bytearray(), False
            os.set_blocking(reader, False)
            os.write(writer, b'{"method":"a"}\n{"meth')
            self.assertEqual(child.read(), [{"method": "a"}])
            os.write(writer, b'od":"b"}\n\n')
            self.assertEqual(child.read(), [{"method": "b"}])
            os.write(writer, b'{"a":1,"a":2}\n')
            with self.assertRaises(codex_host.ProtocolError):
                child.read()
            child.buffer = bytearray()
            os.write(writer, b"[1]\n")
            with self.assertRaises(codex_host.ProtocolError):
                child.read()
            child.buffer = bytearray(b"x" * codex_host.MAX_MESSAGE)
            os.write(writer, b"y")
            with self.assertRaises(codex_host.ProtocolError):
                child.read()
            os.close(writer)
            writer = None
            child.buffer = bytearray()
            self.assertEqual(child.read(), [])
            self.assertTrue(child.eof)
        finally:
            os.close(reader)
            if writer is not None:
                os.close(writer)


if __name__ == "__main__":
    unittest.main()

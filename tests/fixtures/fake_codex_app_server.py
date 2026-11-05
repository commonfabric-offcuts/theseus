#!/usr/bin/python3 -I
from __future__ import annotations

"""A scripted stand-in for `codex app-server --listen stdio://`.

It speaks the newline JSON-RPC subset the Theseus host uses, in the message
shapes of the installed app-server schema, and makes no model call. Its
"agent" runs the real Theseus CLI named in the thread's developer
instructions: it posts a reply in each delivery's topic and acknowledges the
deliveries its turns were given.

Everything lives under CODEX_HOME, which a test owns:
  fake-script.json  {"version", "signed_in", "turns": [behaviour, ...]}
  fake-state.json   threads, their turns and replies; survives restarts
  fake-wire.jsonl   every line in and out, each CLI exit, and each spawn

The script may also set:
  deaf                 turn/interrupt is answered but the turn goes on
  gate_resume_once     the first thread/resume waits until the test opens and
                       closes the FIFO CODEX_HOME/gate (an event, never a timer)
  bad_resume_once      the first thread/resume answers a thread that is not an object
  bad_turns_list_once  the first thread/turns/list answers a last turn with this status
  echo_widened         thread/start and thread/resume echo a sandbox wider than asked
  resume_status        the thread status thread/resume reports

A turn behaviour (consumed in order across restarts) may hold:
  reply      text posted in each topic ("{history}" is this thread's previous reply)
  commands   how many non-CLI commandExecution items to report first
  hold       "steer": stay active until one steer arrives; "die": SIGKILL itself
             once the turn's input is seen; "interrupt": stay active until interrupted
  steer      "race": on a steer, finish the turn first and refuse the steer as having
             no active turn; "race_fail": the same, but the turn fails; "late": finish
             the turn first, then accept the steer; "drop": accept the steer but never
             surface its input
  fail       a codexErrorInfo key: the turn fails without acting
  busy       refuse turn/start as activeTurnNotSteerable
  silent     start the turn but never answer turn/start or announce the turn
  garble     answer turn/start with a line that is not JSON, then wait
  server_request  a server request method sent mid-turn; the turn waits for its answer
  bad_notification  before answering turn/start, notify turn/started with a threadId that is a list
  bad_request  mid-turn, send a server request whose threadId is an object
  bad_status   complete the turn with a status that is a list
  close_stdout  on turn/start, close standard output and go on reading input
"""

import json
import os
import re
import signal
import subprocess
import sys
import uuid


HOME = os.environ["CODEX_HOME"]
VERSION = "0.163.0-alpha.10.2"
DELIVERY = re.compile(r"^\d+\. topic (\S+), from \S+, message (\S+) \(seq (\d+)\), delivery (\S+)$")


def _path(name):
    return os.path.join(HOME, name)


def _load(name, default):
    try:
        with open(_path(name)) as handle:
            return json.load(handle)
    except FileNotFoundError:
        return default


class Fake:
    def __init__(self):
        self.script = _load("fake-script.json", {})
        self.state = _load("fake-state.json", {"threads": {}, "turn_index": 0})
        self.loaded = {}
        self.active = {}
        self.asked = {}
        self.server_ids = 0
        self.wire({"spawn": os.getpid(), "argv": sys.argv[1:], "path": os.environ.get("PATH")})

    def wire(self, entry):
        with open(_path("fake-wire.jsonl"), "a") as handle:
            handle.write(json.dumps(dict(entry, pid=os.getpid())) + "\n")

    def save(self):
        temporary = _path("fake-state.json.tmp")
        with open(temporary, "w") as handle:
            json.dump(self.state, handle)
        os.replace(temporary, _path("fake-state.json"))

    def send(self, message):
        self.wire({"out": message})
        sys.stdout.write(json.dumps(message, separators=(",", ":")) + "\n")
        sys.stdout.flush()

    def notify(self, method, params):
        self.send({"method": method, "params": params})

    def error(self, request, code, message, data=None):
        error = {"code": code, "message": message}
        if data is not None:
            error["data"] = data
        self.send({"id": request["id"], "error": error})

    def run(self):
        while True:
            line = sys.stdin.readline()
            if not line:
                return 0
            message = json.loads(line)
            self.wire({"in": message})
            if "method" not in message:
                self.answered(message)
                continue
            handler = getattr(self, "on_" + re.sub(r"\W", "_", message["method"]), None)
            if "id" not in message:
                continue
            if handler is None:
                self.error(message, -32601, "method not found")
            else:
                handler(message, message.get("params") or {})

    # Handshake ---------------------------------------------------------------

    def on_initialize(self, request, params):
        name = params["clientInfo"]["name"]
        self.send({"id": request["id"], "result": {
            "userAgent": "%s/%s (fake app-server)" % (name, self.script.get("version", VERSION)),
            "codexHome": HOME, "platformFamily": "unix", "platformOs": "macos"}})

    def on_account_read(self, request, params):
        if self.script.get("signed_in", True):
            result = {"account": {"type": "chatgpt"}, "requiresOpenaiAuth": True}
        else:
            result = {"account": None, "requiresOpenaiAuth": True}
        self.send({"id": request["id"], "result": result})

    # Threads -------------------------------------------------------------------

    def thread(self, thread_id, status):
        record = self.state["threads"][thread_id]
        return {"id": thread_id, "cliVersion": VERSION, "createdAt": 0, "updatedAt": 0, "cwd": record["cwd"],
                "ephemeral": False, "modelProvider": "openai", "preview": "", "projectId": None,
                "sessionId": thread_id, "source": "appServer", "status": status, "turns": []}

    def settings(self, params, thread_id, status=None):
        record = self.state["threads"][thread_id]
        roots = params.get("config", {}).get("sandbox_workspace_write", {}).get("writable_roots", [])
        widened = self.script.get("echo_widened")
        return {"thread": self.thread(thread_id, status or {"type": "idle"}), "approvalPolicy": params.get("approvalPolicy", "on-request"),
                "approvalsReviewer": "user", "cwd": record["cwd"], "model": "fake-model", "modelProvider": "openai",
                "sandbox": {"type": "workspaceWrite", "writableRoots": ["/"] if widened else roots, "networkAccess": bool(widened),
                            "excludeSlashTmp": True, "excludeTmpdirEnvVar": True}}

    def once(self, key):
        """True the first time a once-only script setting applies, across restarts."""
        if not self.script.get(key) or self.state.get("used-" + key):
            return False
        self.state["used-" + key] = True
        self.save()
        return True

    def gate(self, what):
        self.wire({"gated": what})
        with open(_path("gate")) as handle:
            handle.read()

    def load(self, thread_id, instructions):
        for line in (instructions or "").splitlines():
            if line.startswith("Your CLI: "):
                self.loaded[thread_id] = line[len("Your CLI: "):].split()
                return
        self.loaded[thread_id] = None

    def on_thread_start(self, request, params):
        thread_id = str(uuid.uuid4())
        self.state["threads"][thread_id] = {"cwd": params.get("cwd"), "turns": [], "history": [],
                                            "instructions": params.get("developerInstructions")}
        self.save()
        self.load(thread_id, params.get("developerInstructions"))
        self.send({"id": request["id"], "result": self.settings(params, thread_id)})

    def on_thread_resume(self, request, params):
        thread_id = params["threadId"]
        if self.once("gate_resume_once"):
            self.gate("thread/resume")
        if self.once("bad_resume_once"):
            return self.send({"id": request["id"], "result": {"thread": "not-an-object"}})
        if thread_id not in self.state["threads"]:
            return self.error(request, -32600, "thread not found: " + thread_id)
        record = self.state["threads"][thread_id]
        record["resumes"] = record.get("resumes", 0) + 1
        self.save()
        self.load(thread_id, params.get("developerInstructions") or record["instructions"])
        self.send({"id": request["id"], "result": self.settings(params, thread_id, self.script.get("resume_status"))})

    def on_thread_turns_list(self, request, params):
        if self.once("bad_turns_list_once"):
            return self.send({"id": request["id"], "result": {"data": [{"id": "turn-x", "status": self.script["bad_turns_list_once"],
                                                                         "items": []}], "nextCursor": None}})
        turns = self.state["threads"][params["threadId"]]["turns"]
        data = [{"id": turn["id"], "status": turn["status"], "items": [], "error": turn.get("error")} for turn in turns[-1:]]
        self.send({"id": request["id"], "result": {"data": data, "nextCursor": None}})

    # Turns ---------------------------------------------------------------------

    def on_turn_start(self, request, params):
        thread_id = params["threadId"]
        if thread_id not in self.loaded:
            return self.error(request, -32600, "thread not loaded")
        if thread_id in self.active:
            return self.error(request, -32600, "a turn is already active")
        turns = self.script.get("turns", [])
        behaviour = turns[self.state["turn_index"]] if self.state["turn_index"] < len(turns) else {}
        self.state["turn_index"] += 1
        if behaviour.get("busy"):
            self.save()
            return self.error(request, -32600, "cannot start now",
                              {"codexErrorInfo": {"activeTurnNotSteerable": {"turnKind": "review"}}})
        turn = {"id": str(uuid.uuid4()), "status": "inProgress", "behaviour": behaviour, "deliveries": [], "steered": False}
        self.active[thread_id] = turn
        self.state["threads"][thread_id]["turns"].append({"id": turn["id"], "status": "inProgress"})
        self.save()
        if behaviour.get("silent"):
            return
        if behaviour.get("close_stdout"):
            self.wire({"closed_stdout": True})
            os.close(1)
            self.send = lambda message: self.wire({"dropped": message})
            return
        if behaviour.get("bad_notification"):
            self.notify("turn/started", {"threadId": ["not", "a", "string"], "turn": {"id": turn["id"], "status": "inProgress", "items": []}})
        if behaviour.get("garble"):
            self.wire({"out": "garbled"})
            sys.stdout.write("{not json\n")
            sys.stdout.flush()
            return
        self.send({"id": request["id"], "result": {"turn": {"id": turn["id"], "status": "inProgress", "items": []}}})
        self.notify("thread/status/changed", {"threadId": thread_id, "status": {"type": "active", "activeFlags": []}})
        self.notify("turn/started", {"threadId": thread_id, "turn": {"id": turn["id"], "status": "inProgress", "items": []}})
        self.accept(thread_id, turn, params)
        self.advance(thread_id)

    def on_turn_steer(self, request, params):
        thread_id = params["threadId"]
        turn = self.active.get(thread_id)
        if turn is None:
            return self.error(request, -32600, "no active turn to steer")
        if params["expectedTurnId"] != turn["id"]:
            return self.error(request, -32600, "expected turn id mismatch")
        mode = turn["behaviour"].get("steer")
        if mode in ("race", "race_fail"):
            # The turn ended a moment before the steer arrived.
            self.finish(thread_id, "completed" if mode == "race" else "failed")
            return self.error(request, -32600, "no active turn to steer")
        if mode == "late":
            # The turn ends first; the steer's answer follows, and its input is never seen.
            self.finish(thread_id, "completed")
            return self.send({"id": request["id"], "result": {"turnId": turn["id"]}})
        self.send({"id": request["id"], "result": {"turnId": turn["id"]}})
        turn["steered"] = True
        if mode != "drop":
            self.accept(thread_id, turn, params)
        self.advance(thread_id)

    def on_turn_interrupt(self, request, params):
        turn = self.active.get(params["threadId"])
        if turn is None or turn["id"] != params["turnId"]:
            return self.error(request, -32600, "no such active turn")
        self.send({"id": request["id"], "result": {}})
        if not self.script.get("deaf"):
            self.finish(params["threadId"], "interrupted")

    def on_thread_compact_start(self, request, params):
        self.send({"id": request["id"], "result": {}})

    def accept(self, thread_id, turn, params):
        for line in params["input"][0]["text"].splitlines():
            match = DELIVERY.match(line)
            if match:
                turn["deliveries"].append({"topic": match.group(1), "delivery": match.group(4)})
        self.notify("item/completed", {"threadId": thread_id, "turnId": turn["id"], "completedAtMs": 0,
                                       "item": {"type": "userMessage", "id": "item-" + uuid.uuid4().hex,
                                                "clientId": params.get("clientUserMessageId"), "content": params["input"]}})

    def answered(self, message):
        thread_id = self.asked.pop(message["id"], None)
        if thread_id is not None:
            self.advance(thread_id)

    def advance(self, thread_id):
        turn = self.active[thread_id]
        behaviour = turn["behaviour"]
        if behaviour.get("bad_request") and not turn.get("asked"):
            turn["asked"] = True
            self.server_ids += 1
            self.asked["srv-%d" % self.server_ids] = thread_id
            self.send({"id": "srv-%d" % self.server_ids, "method": "item/commandExecution/requestApproval",
                       "params": {"threadId": {"o": 1}, "turnId": turn["id"], "itemId": "item-approval", "startedAtMs": 0}})
            return
        if behaviour.get("server_request") and not turn.get("asked"):
            turn["asked"] = True
            self.server_ids += 1
            request_id = "srv-%d" % self.server_ids
            self.asked[request_id] = thread_id
            self.send({"id": request_id, "method": behaviour["server_request"],
                       "params": {"threadId": thread_id, "turnId": turn["id"], "itemId": "item-approval", "startedAtMs": 0,
                                  "command": "touch /etc/outside", "cwd": "/"}})
            return
        if turn.get("asked") and any(owner == thread_id for owner in self.asked.values()):
            return
        hold = behaviour.get("hold")
        if hold == "die":
            os.kill(os.getpid(), signal.SIGKILL)
        if hold == "interrupt" or (hold == "steer" and not turn["steered"]):
            return
        self.finish(thread_id, "failed" if behaviour.get("fail") else "completed")

    def command(self, thread_id, turn, command):
        self.notify("item/completed", {"threadId": thread_id, "turnId": turn["id"], "completedAtMs": 0, "item": {
            "type": "commandExecution", "id": "item-" + uuid.uuid4().hex, "command": command, "commandActions": [],
            "cwd": self.state["threads"][thread_id]["cwd"], "status": "completed", "exitCode": 0}})

    def cli(self, thread_id, turn, args, text=None):
        argv = self.loaded[thread_id] + args
        done = subprocess.run(argv, input=text, capture_output=True, text=True,
                              env={"PATH": "/usr/bin:/bin", "HOME": os.environ.get("HOME", "/")})
        self.wire({"cli": args[0], "code": done.returncode})
        self.command(thread_id, turn, " ".join(argv))

    def finish(self, thread_id, status):
        turn = self.active.pop(thread_id)
        behaviour = turn["behaviour"]
        record = self.state["threads"][thread_id]
        if status == "completed":
            for index in range(behaviour.get("commands", 0)):
                self.command(thread_id, turn, "grep -rl read_through tests")
            topics = []
            for item in turn["deliveries"]:
                if item["topic"] not in topics:
                    topics.append(item["topic"])
            reply = behaviour.get("reply", "ok").format(history=(record["history"] or [""])[-1])
            for topic in topics:
                self.cli(thread_id, turn, ["post", topic, "-"], reply)
            if turn["deliveries"]:
                self.cli(thread_id, turn, ["ack"] + [item["delivery"] for item in turn["deliveries"]])
            record["history"].append(reply)
        usage = {"inputTokens": 100, "cachedInputTokens": 20, "outputTokens": 10, "reasoningOutputTokens": 5, "totalTokens": 115}
        self.notify("thread/tokenUsage/updated", {"threadId": thread_id, "turnId": turn["id"],
                                                  "tokenUsage": {"last": usage, "total": usage}})
        error = {"message": "fake failure", "codexErrorInfo": behaviour["fail"]} if status == "failed" else None
        for stored in record["turns"]:
            if stored["id"] == turn["id"]:
                stored.update(status=status, error=error)
        self.save()
        self.notify("turn/completed", {"threadId": thread_id, "turn": {"id": turn["id"], "status": ["x"] if behaviour.get("bad_status") else status,
                                                                       "items": [], "error": error}})
        self.notify("thread/status/changed", {"threadId": thread_id, "status": {"type": "idle"}})


if __name__ == "__main__":
    raise SystemExit(Fake().run())

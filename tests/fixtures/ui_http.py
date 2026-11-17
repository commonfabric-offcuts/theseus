from __future__ import annotations

import contextlib
import fcntl
import hashlib
import io
import json
import os
from pathlib import Path
import sqlite3
import sys
import tempfile
import threading
import time
from types import SimpleNamespace
import zlib

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
from aim_next import Store, initialize
from aim_next import server as server_module
from aim_next.server import create_server, RequestError
from aim_next.stacks import KINDS as STACK_KINDS, current_acts


class FreshnessControls:
    """Private stdin controls around the real HTTP adapter and Store callbacks."""
    def __init__(self):
        self.lock = threading.Lock()
        self.local = threading.local()
        self.events = []
        self.holds = {}
        self.faults = []
        self.delay = None
        self.http_commands = 0
        self.http_delivery_acks = 0
        self.http_media_publications = 0
        self.legacy_number = 0
        self.fatal = []

    def record(self, value):
        with self.lock:
            self.events.append(dict(value, index=len(self.events) + 1))

    def event(self, event, name, **extra):
        ticket = getattr(self.local, "ticket", None)
        self.record(dict({"event": event, "at": time.monotonic(), "name": name,
                          "request_id": ticket.number if ticket is not None else None,
                          "read_class": ticket.read_class if ticket is not None else None,
                          "admission_mode": getattr(ticket, "mode", "partitioned") if ticket is not None else None}, **extra))

    def install(self, server, factory):
        if getattr(server, "read_admission", None) is not None:
            admission = server.read_admission
            admission.observer = self.record
            acquire, release = admission.acquire, admission.release

            def observed_acquire(*args, **kwargs):
                ticket = acquire(*args, **kwargs)
                self.local.ticket = ticket
                return ticket

            def observed_release(ticket):
                try:
                    return release(ticket)
                finally:
                    self.local.ticket = None
            admission.acquire, admission.release = observed_acquire, observed_release
        controls = self
        if getattr(server, "read_admission", None) is None:
            # Observation only: retain the original server's acquire/refuse/release
            # path and its default shared2 pool. A header here is a requested hint,
            # not a claim that the old server reserves separate classes.
            class ObservedLegacyHandler(server.RequestHandlerClass):
                def _store_call(self, callback, command=False, **options):
                    if command:
                        return super()._store_call(callback, command=True, **options)
                    values = self.headers.get_all("X-AIM-Read-Class", [])
                    read_class = ("foreground" if not values else values[0]
                                  if len(values) == 1 and values[0] in ("foreground", "background") else "invalid")
                    with controls.lock:
                        controls.legacy_number += 1
                        number = "legacy-%d" % controls.legacy_number
                    controls.local.ticket = SimpleNamespace(number=number, read_class=read_class,
                                                            mode="legacy-observation")
                    controls.event("legacy-read-enter", None)
                    try:
                        return super()._store_call(callback, command=False, **options)
                    finally:
                        controls.event("legacy-read-exit", None)
                        controls.local.ticket = None
            server.RequestHandlerClass = ObservedLegacyHandler

        class ObservedStore:
            def __init__(self):
                self.base = factory()
                self.name = None

            def __getattr__(self, name):
                return getattr(self.base, name)

            def view(self, actor, name, args):
                self.name = "bootstrap" if name == "capabilities" else name
                controls.event("callback-enter", self.name)
                try:
                    controls.wait_delay(self.name)
                    controls.wait_hold(self.name, "callback")
                    fault = controls.take_fault(self.name, args)
                    if fault is not None:
                        controls.event("fault-applied", self.name, status=fault["status"], body=fault["body"])
                        if fault["status"] == 200:
                            return fault["body"]
                        error = fault["body"].get("error", {})
                        raise RequestError(fault["status"], error.get("code", "FIXTURE_FAULT"),
                                           error.get("message", "Injected private fixture read fault"))
                    return self.base.view(actor, name, args)
                finally:
                    controls.event("callback-exit", self.name)

            def command(self, actor, envelope):
                with controls.lock:
                    controls.http_commands += 1
                    controls.http_delivery_acks += int(envelope.get("kind") == "delivery.ack")
                return self.base.command(actor, envelope)

            def publish_media(self, *args, **kwargs):
                with controls.lock:
                    controls.http_media_publications += 1
                return self.base.publish_media(*args, **kwargs)

            def close(self):
                if self.name is not None:
                    controls.event("close-enter", self.name)
                try:
                    try:
                        if self.name is not None:
                            controls.wait_hold(self.name, "close")
                    finally:
                        close = getattr(self.base, "close", None)
                        if callable(close):
                            close()
                finally:
                    if self.name is not None:
                        controls.event("close-exit", self.name)
        server.store_factory = ObservedStore

    def matches(self, rule, name):
        ticket = getattr(self.local, "ticket", None)
        return (rule["count"] > 0 and rule["name"] == name and
                (rule.get("read_class") is None or
                 (ticket is not None and rule["read_class"] == ticket.read_class)))

    def wait_hold(self, name, phase):
        selected = None
        with self.lock:
            for hold_id, hold in self.holds.items():
                if hold["phase"] == phase and self.matches(hold, name):
                    hold["count"] -= 1
                    selected = (hold_id, hold["release"], hold.get("timeout_ms", 15000) / 1000.0)
                    break
        if selected:
            hold_id, release, timeout = selected
            self.event("hold-enter", name, hold_id=hold_id, phase=phase)
            if not release.wait(timeout):
                with self.lock:
                    self.fatal.append(hold_id)
                self.event("hold-timeout", name, hold_id=hold_id, phase=phase)
                raise AssertionError("Private fixture hold timed out: " + hold_id)
            self.event("hold-exit", name, hold_id=hold_id, phase=phase)

    def take_fault(self, name, args=None):
        with self.lock:
            for rule in self.faults:
                if self.matches(rule, name) and ("source_ref" not in rule or
                        rule["source_ref"] == (args or {}).get("source_ref")):
                    rule["count"] -= 1
                    return dict(rule)
        return None

    def wait_delay(self, name):
        with self.lock:
            rule = dict(self.delay) if self.delay else None
        ticket = getattr(self.local, "ticket", None)
        if (rule is None or rule["ms"] == 0 or rule.get("name") not in (None, name) or
                rule.get("read_class") is not None and
                (ticket is None or ticket.read_class != rule["read_class"])):
            return
        self.event("delay-enter", name, delay_ms=rule["ms"])
        time.sleep(rule["ms"] / 1000.0)
        self.event("delay-exit", name, delay_ms=rule["ms"])

    def control(self, request, server):
        method = request["method"]
        if method == "read_delay":
            assert type(request.get("ms")) is int and 0 <= request["ms"] <= 500
            assert request.get("name") is None or isinstance(request["name"], str) and request["name"]
            assert request.get("read_class") in (None, "foreground", "background")
            with self.lock:
                self.delay = {key: request.get(key) for key in ("ms", "name", "read_class")}
                return dict(self.delay)
        if method == "read_hold":
            hold_id = request["hold_id"]  # request.id belongs to stdin correlation.
            assert request["phase"] in ("callback", "close")
            assert request.get("read_class") in (None, "foreground", "background")
            assert type(request.get("count", 1)) is int and request.get("count", 1) > 0
            assert type(request.get("timeout_ms", 15000)) is int and 0 < request.get("timeout_ms", 15000) <= 15000
            with self.lock:
                assert hold_id not in self.holds, "Hold identity is already in use"
                self.holds[hold_id] = dict(request, count=request.get("count", 1), release=threading.Event())
            return {"hold_id": hold_id, "armed": True}
        if method == "read_release":
            with self.lock:
                self.holds[request["hold_id"]]["release"].set()
            return {"hold_id": request["hold_id"], "released": True}
        if method == "read_cancel":
            with self.lock:
                hold = self.holds[request["hold_id"]]
                cancelled = hold["count"]
                assert cancelled > 0, "No unconsumed hold remains to cancel"
                hold["count"] = 0
            # Withdraw future matches only. An active callback still requires
            # its separate read_release; cancellation cannot fake that release.
            self.event("hold-cancel", hold["name"], hold_id=request["hold_id"], cancelled=cancelled)
            return {"hold_id": request["hold_id"], "cancelled": cancelled}
        if method == "read_fault":
            assert request["status"] in (200, 400, 401, 403, 409, 500, 503)
            assert type(request.get("count", 1)) is int and request.get("count", 1) > 0
            body = request["body"]
            if isinstance(body, dict) and "error" in body:
                error = body["error"]
                assert isinstance(error, dict) and isinstance(error.get("code"), str), "Typed fault needs a code"
                error = dict(error)
                error.setdefault("message", "Injected private fixture read refusal")
                error.setdefault("retryable", False)
                assert isinstance(error["message"], str) and type(error["retryable"]) is bool
                body = dict(body, instance_id=body.get("instance_id", server.instance_id), error=error)
            with self.lock:
                self.faults.append(dict(request, body=body, count=request.get("count", 1)))
            return {"armed": True}
        if method == "read_fault_clear":
            # Withdraws every fault not yet taken, so the server answers as itself again.
            with self.lock:
                withdrawn = sum(rule["count"] for rule in self.faults)
                for rule in self.faults:
                    rule["count"] = 0
            return {"withdrawn": withdrawn}
        if method == "admission_events":
            with self.lock:
                events = [dict(e) for e in self.events if e["index"] > request.get("after", 0)]
                next_index = len(self.events)
                fatal = list(self.fatal)
            return {"events": events, "next": next_index, "fatal": fatal,
                    "lanes": server.read_admission.snapshot() if getattr(server, "read_admission", None) else None}
        raise ValueError("Unknown admission control")

    def close(self):
        with self.lock:
            for hold_id, hold in self.holds.items():
                if hold["count"] > 0:
                    self.fatal.append("unconsumed:" + hold_id)
                hold["release"].set()

    def assert_healthy(self):
        with self.lock:
            assert not self.fatal, "Private fixture hold failure: " + ", ".join(self.fatal)


class CommandGate:
    """Every command the HTTP adapter takes through /api/command passes here,
    so a control can read and write drafts while no page's command runs.
    Media publication (/api/media/upload) and the live feed's own writes do
    not pass it; neither writes a draft.

    A page closed while its save was on the way leaves the server handling
    that save after the browser has gone. A control that reads a draft's
    revision and then writes at it (reset_drafts) would lose to that save
    landing in between, and be refused. The authority lock cannot keep it out:
    each Store open, command and view takes the lock shared and drops it on its
    own, so nothing holds it across a request. While a control holds this
    gate, it has waited for the commands under way to finish, and any command
    that comes in waits until the control is done. A save that waited is then
    refused at its old revision only if the control wrote that draft; a save
    to a draft the control left alone (reset_drafts skips an empty one) lands
    after it."""

    def __init__(self):
        self.changed = threading.Condition()
        self.running = 0
        self.held = False

    def command(self, store, actor, envelope):
        with self.changed:
            while self.held:
                self.changed.wait()
            self.running += 1
        try:
            return store.command(actor, envelope)
        finally:
            with self.changed:
                self.running -= 1
                self.changed.notify_all()

    @contextlib.contextmanager
    def hold(self):
        with self.changed:
            assert not self.held, "The command gate is already held"
            self.held = True
        try:
            with self.changed:
                while self.running:
                    self.changed.wait()
            yield
        finally:
            with self.changed:
                self.held = False
                self.changed.notify_all()


class GatedStore:
    """The server's Store for one request, its commands through the gate."""

    def __init__(self, base, gate):
        self.base, self.gate = base, gate

    def __getattr__(self, name):
        return getattr(self.base, name)

    def command(self, actor, envelope):
        return self.gate.command(self.base, actor, envelope)


# Isolated wiring fixture. Actual Store and HTTP; stdin is a private fixture
# control channel, never a product endpoint. EOF shuts down this server only.
def main():
    with tempfile.TemporaryDirectory(prefix="aim-ux-http-") as directory:
        root = Path(directory).resolve()
        path = root / "instance.sqlite3"
        instance, actor = "ux-http-fixture", "fixture-person"
        actors = [{"id": actor, "kind": "human"}]
        freshness = "--freshness" in sys.argv
        if "--images" in sys.argv or freshness:
            actors.append({"id": "fixture-notebook-agent", "kind": "agent"})
            actors.append({"id": "fixture-outside-agent", "kind": "agent"})
            # Agents a topic can wait on, so a waiting list can run long.
            actors.extend({"id": "fixture-%s-agent" % name, "kind": "agent"} for name in ("planning", "reviewing", "writing"))
        if "--agent-colors" in sys.argv:
            # The team's agents, each with its own color, and one the page
            # colors by its id alone.
            actors.extend({"id": name, "kind": "agent"} for name in ("aim-lead", "aim-ux", "fable", "aim-core", "aim-spec", "warp", "fixture-guest-agent"))
        if "--other-person" in sys.argv:
            # A second person, whose messages are neither the person's own nor an agent's.
            actors.append({"id": "fixture-other-person", "kind": "human"})
        binding = initialize(path, instance, actors,
                             authority_path=root / "control" / "authority.json")["binding"]

        # The skills and tools this instance knows (docs/skills-and-tools.md): none, until tools_seed
        # writes invented records here; never the checkout's own.
        tool_records = root / "tool-records"

        def store():
            # The runner's own load would put "The Mac is overloaded" above everything the
            # Health page is checked for, so the page reads a calm Mac.
            return Store(path, instance, expected_binding=dict(binding), machine=lambda: {"load": [0.5, 0.5, 0.5], "cpus": 8}, tools=tool_records)

        def command(kind, operation, args, target=None, expected=None, sender=None, refusable=False):
            envelope = {"v": 1, "instance_id": instance, "kind": kind,
                        "operation_id": operation, "target": target or {},
                        "expected": dict(expected or {}, authority={
                            key: binding[key] for key in ("authority_id", "authority_epoch")}),
                        "args": args}
            answer = store().command(sender or actor, envelope)
            assert refusable or answer["status"] == "committed", answer
            return answer

        command("workspace.create", "fixture-workspace", {
            "id": "w1", "title": "Isolated wiring", "team": []})
        media = []
        if "--media" in sys.argv:
            inputs = [
                ("passive.png", "image/png", (Path(__file__).parent / "media" / "screen.png").read_bytes()),
                ("document.html", "text/html", b"<!doctype html><title>Fixture HTML</title><p id='fixture-marker'>Download HTML marker</p>"),
                ("document.svg", "image/svg+xml", b"<svg xmlns='http://www.w3.org/2000/svg'><title>Fixture SVG</title><text id='fixture-marker' x='10' y='20'>Download SVG marker</text></svg>"),
            ]
            for number, (name, content_type, data) in enumerate(inputs):
                media_id, publish_id = "fixture-media-%d" % number, "fixture-publish-%d" % number
                command("media.begin", "fixture-media-begin-%d" % number, {
                    "name": name, "content_type": content_type, "size_bytes": len(data),
                    "sha256": hashlib.sha256(data).hexdigest(), "publish_operation_id": publish_id,
                }, {"media_id": media_id}, {"media_revision": 0})
                envelope = {"v": 1, "instance_id": instance, "kind": "media.publish", "operation_id": publish_id,
                            "target": {"media_id": media_id}, "args": {}, "expected": {"media_revision": 1,
                            "authority": {key: binding[key] for key in ("authority_id", "authority_epoch")}}}
                assert store().publish_media(actor, envelope, io.BytesIO(data))["status"] == "committed"
                media.append({"id": media_id, "name": name, "content_type": content_type,
                              "sha256": hashlib.sha256(data).hexdigest()})
        sources = []
        # Source 1 has one passage longer than any line the Reader draws, a few
        # lines down, so a passage that wraps is there to measure at every
        # width. The Reader grows with the window (item 400), and passages all
        # of one length can fill its lines whole, as at 72rem in a 1440 window.
        # Its words name none of the Reader's controls, which a Select All
        # check finds nowhere in the message.
        wrapping = ("Source 1 long passage runs on as one sentence past the end of any line it is drawn on, "
                    "stacked or side by side, at every window width, so that a passage that wraps onto a "
                    "second line is always there near the top to light, select and measure. ")
        for number in range(2):
            draft, generation = "seed-draft-%d" % number, "seed-generation-%d" % number
            source = ({"kind": "new_topic", "id": "fixture-opening", "workspace_id": "w1"}
                      if number == 0 else sources[0])
            passage = "Source %d exact passage. " % number
            args = {"source_ref": source, "topic_id": "t1", "generation": generation,
                    "body": passage * 100 if number == 0 else passage * 30 + wrapping + passage * 69}
            if media and number == 0:
                args["attachments"] = [{"id": item["id"]} for item in media]
            if number == 0:
                args["opening"] = {"workspace_id": "w1", "title": "Read here", "participants": []}
            command("draft.save", "seed-save-%d" % number, args,
                    {"draft_id": draft}, {"draft_revision": 0})
            command("submission.prepare", "seed-prepare-%d" % number,
                    {"draft_id": draft, "submission_id": "seed-submission-%d" % number,
                     "send_operation_id": "seed-send-%d" % number},
                    {"topic_id": "t1"}, {"draft_revision": 1})
            result = command("topic.create_and_send" if number == 0 else "message.send",
                             "seed-send-%d" % number,
                             {"submission_id": "seed-submission-%d" % number}, {"topic_id": "t1"})
            sources.append({"kind": "message", "id": result["result"]["message_id"]})

        if "--images" in sys.argv or freshness:
            topic_revision = store().view(actor, "topic", {"topic_id": "t1"})["topic"]["version"]
            command("participation.set", "fixture-notebook-participant", {"actor_id": "fixture-notebook-agent", "present": True}, {"topic_id": "t1"}, {"topic_revision": topic_revision})
            command("memory.create", "fixture-notebook", {"title": "Image Notebook", "body": "Notebook passage to quote.", "attachments": [], "references": []},
                    {"item_id": "fixture-notebook", "owner_scope": {"kind": "topic", "id": "t1"}}, {"item_revision": 0}, sender="fixture-notebook-agent")
        max_reads = 1 if "--legacy-read-admission" in sys.argv else 2
        # The server's own event lines (a runner gone, a lease that lapsed) are
        # kept for the checks to read, so stderr carries only what went wrong.
        server_events = []
        server_module._stderr = server_events.append
        controls = FreshnessControls() if freshness else None
        # One for the instance, kept across a server restart.
        gate = CommandGate()

        # Where an invited agent's sign-in file is written, as beside the server's own profile (docs/agents.md).
        sign_in = root / "sign-in"
        sign_in.mkdir(mode=0o700)

        def tools_seed(request):
            """Invented skills and tools (docs/skills-and-tools.md): "Kite club" (kites), with the fixture agent on
            its team and two open topics, homes Spool winder (a tool whose check passed, and one version that went
            back) and Knot guide (a skill with no check); w1 homes Wind meter, whose check has not run; and "Glider
            bench" (gliders), the agent's alone, homes Glide timer, whose page the person reads from outside. Once."""
            agent = "fixture-notebook-agent"
            if store().view(actor, "tools", {"workspace_id": "w1"})["own"]:
                return {"seeded": False}
            command("workspace.create", "tools-workspace", {"id": "kites", "title": "Kite club", "purpose": "Kites that fly in any wind", "team": [agent]})
            command("workspace.create", "tools-workspace-outside", {"id": "gliders", "title": "Glider bench", "purpose": "Gliders", "team": []}, sender=agent)
            for topic_id, title in (("kite-spools", "Faster spools"), ("kite-lines", "Tangled lines")):
                prefix = "tools-" + topic_id
                command("draft.save", prefix + "-save", {
                    "source_ref": {"kind": "new_topic", "id": prefix, "workspace_id": "kites"}, "topic_id": topic_id,
                    "generation": prefix + "-generation", "body": "Opening " + title,
                    "opening": {"workspace_id": "kites", "title": title, "participants": []}}, {"draft_id": prefix + "-draft"}, {"draft_revision": 0})
                command("submission.prepare", prefix + "-prepare", {"draft_id": prefix + "-draft", "submission_id": prefix + "-submission",
                                                                   "send_operation_id": prefix + "-send"}, {"topic_id": topic_id}, {"draft_revision": 1})
                command("topic.create_and_send", prefix + "-send", {"submission_id": prefix + "-submission"}, {"topic_id": topic_id})
            records = {
                "spool-winder": {"id": "spool-winder", "kind": "tool", "name": "Spool winder", "summary": "Winds a kite line back without a tangle",
                                 "home": "kites", "files": ["tools/spool.py", "tests/test_spool.py"], "check": {"python": "tests/test_spool.py"}},
                "knot-guide": {"id": "knot-guide", "kind": "skill", "name": "Knot guide", "summary": "How to tie a line to a kite's bridle",
                               "home": "kites", "files": ["skills/knot-guide/SKILL.md"], "check": None},
                "wind-meter": {"id": "wind-meter", "kind": "tool", "name": "Wind meter", "summary": "Reads the wind before a launch",
                               "home": "w1", "files": ["tools/wind.py", "tests/test_wind.py"], "check": {"python": "tests/test_wind.py"}},
                "glide-timer": {"id": "glide-timer", "kind": "tool", "name": "Glide timer", "summary": "Times a glide from launch to landing",
                                "home": "gliders", "files": ["tools/glide.py", "tests/glide.test.mjs"], "check": {"node": "tests/glide.test.mjs"}},
            }
            for record in records.values():
                for name in record["files"]:
                    (tool_records / name).parent.mkdir(parents=True, exist_ok=True)
                    (tool_records / name).write_text("# %s\n" % name, encoding="utf-8")
                (tool_records / "skills").mkdir(parents=True, exist_ok=True)
                (tool_records / "skills" / (record["id"] + ".json")).write_text(json.dumps(record), encoding="utf-8")
            live = store().view(actor, "tool", {"tool_id": "spool-winder"})["tool"]["content_id"]
            run = {"tool_id": "spool-winder", "name": "Spool winder", "check_path": "tests/test_spool.py", "failing_more": 0, "why": None,
                   "first_version": 0, "items_back": [], "failing": []}
            command("tool.record", "tools-run-back", {"run": dict(run, content_id="b" * 64, commit_sha="1" * 40, tree_sha="2" * 40, live_commit="3" * 40,
                    result="failed", passed=9, total=12, failing=["test_winds_back", "test_no_tangle", "test_line_end"], fate="back", items_back=[17])},
                    {"workspace_id": "kites"}, sender=agent)
            command("tool.record", "tools-run-live", {"run": dict(run, content_id=live, commit_sha="4" * 40, tree_sha="5" * 40, live_commit="3" * 40,
                    result="passed", passed=12, total=12, fate="live")}, {"workspace_id": "kites"}, sender=agent)
            return {"seeded": True}

        def serve(port=0, web=None):
            """The real server, with a session of its own: a restart (server_stop,
            then server_start) brings it back at the same address with a new one.
            web: the page's files to serve, as a deploy brings another build; the checkout's own by default."""
            server = create_server(store, instance, actor, Path(web) if web else Path(__file__).resolve().parents[2] / "web",
                                   max_reads=max_reads, port=port, sign_in_folder=sign_in,
                                   live=(path, (root / "control" / "authority.json",)) if "--live" in sys.argv else None)
            if "--live" in sys.argv:
                assert server.live_feed is not None, "The live fixture needs the native watch"
            else:
                assert server.live_feed is None
            if "--baseline-read-admission" in sys.argv:
                assert "--legacy-read-admission" not in sys.argv, "Baseline uses default shared2, never single-slot legacy"
                assert getattr(server, "read_admission", None) is None, "Baseline flag requires the actual old server"
            if controls is not None:
                controls.install(server, store)
            factory = server.store_factory
            server.store_factory = lambda: GatedStore(factory(), gate)
            return server
        server = serve()

        def on_team(operation):
            """The fixture's agent, a member of the outcome w1; adding a member already there changes nothing."""
            agent = "fixture-notebook-agent"
            version = store().view(actor, "workspace", {"workspace_id": "w1"})["workspace"]["version"]
            command("workspace.member_set", operation + "-member", {"actor_id": agent, "present": True},
                    {"workspace_id": "w1"}, {"workspace_revision": version})
            return agent

        def drawn_png(width, height):
            # A gradient, row by row, each row with PNG's filter byte 0, so its size is the one asked for.
            def chunk(kind, data):
                return len(data).to_bytes(4, "big") + kind + data + (zlib.crc32(kind + data) & 0xFFFFFFFF).to_bytes(4, "big")
            rows = b"".join(b"\0" + bytes(value for x in range(width) for value in (x * 255 // width, y * 255 // height, 160)) for y in range(height))
            head = width.to_bytes(4, "big") + height.to_bytes(4, "big") + bytes((8, 2, 0, 0, 0))
            return b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", head) + chunk(b"IDAT", zlib.compress(rows)) + chunk(b"IEND", b"")

        def published(operation, items, sender):
            # Attachments, each published by sender as an agent's CLI publishes one: {"name", "text"},
            # {"name", "image"}, an image from tests/fixtures/media by its file name, or {"name", "png": [width,
            # height]}, a PNG of that size drawn here. Each is OPERATION-media-N.
            attached = []
            for number, item in enumerate(items):
                media_id = "%s-media-%d" % (operation, number)
                if "png" in item:
                    data, kind = drawn_png(*item["png"]), "image/png"
                elif "image" in item:
                    data = (Path(__file__).parent / "media" / item["image"]).read_bytes()
                    kind = {".png": "image/png", ".jpg": "image/jpeg", ".gif": "image/gif", ".webp": "image/webp"}[Path(item["image"]).suffix]
                else:
                    data, kind = item["text"].encode(), "text/plain"
                command("media.begin", "%s-media-begin-%d" % (operation, number), {
                    "name": item["name"], "content_type": kind, "size_bytes": len(data),
                    "sha256": hashlib.sha256(data).hexdigest(), "publish_operation_id": "%s-publish-%d" % (operation, number),
                }, {"media_id": media_id}, {"media_revision": 0}, sender=sender)
                envelope = {"v": 1, "instance_id": instance, "kind": "media.publish", "operation_id": "%s-publish-%d" % (operation, number),
                            "target": {"media_id": media_id}, "args": {}, "expected": {"media_revision": 1,
                            "authority": {key: binding[key] for key in ("authority_id", "authority_epoch")}}}
                assert store().publish_media(sender, envelope, io.BytesIO(data))["status"] == "committed"
                attached.append({"id": media_id})
            return attached

        def agent_message(request):
            operation = request["operation_id"]
            # The person may write one too, so their own message is drawn, or
            # another agent of the fixture's.
            sender = actor if request.get("sender") == "person" else request.get("sender") or "fixture-notebook-agent"
            topic_id = request.get("topic_id", "t1")
            if request.get("join"):
                # The person brings the agent into a topic of theirs first.
                revision = store().view(actor, "topic", {"topic_id": topic_id})["topic"]["version"]
                command("participation.set", operation + "-join", {"actor_id": sender, "present": True},
                        {"topic_id": topic_id}, {"topic_revision": revision})
            if request.get("member"):
                # The person makes the agent one of the outcome's team, so it can
                # write in the topic without being one of its participants.
                workspace_id = store().view(actor, "topic", {"topic_id": topic_id})["topic"]["workspace_id"]
                revision = store().view(actor, "workspace", {"workspace_id": workspace_id})["workspace"]["version"]
                command("workspace.member_set", operation + "-member", {"actor_id": sender, "present": True},
                        {"workspace_id": workspace_id}, {"workspace_revision": revision})
            # With "read": true the person has read the whole topic since, as
            # reading it on screen would, so nothing there waits on them.
            def read(sent):
                if request.get("read"):
                    command("topic.read_through", operation + "-read", {"seq": 9223372036854775807}, {"topic_id": topic_id})
                return sent
            if request.get("whole_topic"):
                # A post to the whole topic, replying to no message: from the
                # person, it answers everything before it. "post_args" adds
                # message.post's own fields, such as an agent's ask for a
                # go-ahead ({"addressees", "intent": "ask", "go_ahead": true}).
                return read(command("message.post", operation, dict(request.get("post_args") or {}, body=request["body"]),
                                    {"topic_id": topic_id}, sender=sender))
            # Written from the person's first message, or with "source": "topic"
            # from the topic itself, for an agent that cannot read that message,
            # or with "reply_to" from that message, which it then answers.
            source = ({"kind": "message", "id": request["reply_to"]} if request.get("reply_to") else
                      {"kind": "topic", "id": topic_id} if request.get("source") == "topic" else sources[0])
            current = store().view(sender, "editor_state", {"source_ref": source, "topic_id": topic_id})
            assert not current.get("error"), current
            draft = current["draft"] or {"id": operation + "-draft", "generation": operation + "-generation", "revision": 0}
            # Optional attachments, each published by the agent (published()).
            attached = published(operation, request.get("attachments", []), sender)
            command("draft.save", operation + "-save", dict({
                "source_ref": source, "topic_id": topic_id, "generation": draft["generation"],
                "body": request["body"], "addressees": request.get("addressees", [])}, **({"attachments": attached} if attached else {}),
                # An agent's message to someone says ask or tell; a case that names
                # no intent tells. With "whisper": true it answers a whisper instead,
                # which says neither.
                **({"whisper": True} if request.get("whisper") else
                   {"intent": request.get("intent") or "tell"} if request.get("addressees") or request.get("intent") else {})),
                {"draft_id": draft["id"]}, {"draft_revision": draft["revision"]}, sender=sender)
            command("submission.prepare", operation + "-prepare", {
                "draft_id": draft["id"], "submission_id": operation + "-submission",
                "send_operation_id": operation}, {"topic_id": topic_id}, {"draft_revision": draft["revision"] + 1}, sender=sender)
            if request.get("unsent"):
                # With "unsent": true the reply is prepared and its send never
                # made, as a reply left in doubt for good (item 548): a
                # submission with a send operation id and no outcome.
                return {"submission_id": operation + "-submission", "send_operation_id": operation}
            return read(command("message.send", operation, {"submission_id": operation + "-submission"},
                                {"topic_id": topic_id}, sender=sender))

        seed_number = 0
        # The Health checks' runner: one guard this process holds across their
        # acts, as a running runner does, and the token its acquisition gave.
        health_runner = {}
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        try:
            for line in sys.stdin:
                request = json.loads(line)
                try:
                    if request["method"] == "ready":
                        answer = {"origin": server.origin, "token": server.session_token,
                                  "instance_id": instance, "actor": actor, "topic_id": "t1",
                                  "sources": sources, "media": media, "max_reads": max_reads,
                                  "admission_mode": "partitioned" if getattr(server, "read_admission", None) else "legacy-observation",
                                  "freshness": freshness, "agent": "fixture-notebook-agent" if freshness else None}
                    elif request["method"] == "counts":
                        with sqlite3.connect(str(path)) as db:
                            answer = {"media": db.execute("SELECT count(*) FROM media_intents").fetchone()[0]}
                            if freshness:
                                answer.update({"messages": db.execute("SELECT count(*) FROM messages").fetchone()[0],
                                               "operations": db.execute("SELECT count(*) FROM operations").fetchone()[0],
                                               "acknowledged_deliveries": db.execute("SELECT count(*) FROM deliveries WHERE state='acknowledged'").fetchone()[0],
                                               "marked": db.execute("SELECT count(*) FROM message_marks WHERE actor_id=? AND revision%2=1", (actor,)).fetchone()[0],
                                               "mark_operations": db.execute("SELECT count(*) FROM operations WHERE kind='message.mark'").fetchone()[0]})
                                reports = [json.loads(row[0]) for row in db.execute("SELECT outcome FROM operations WHERE kind='topic.read_through'")]
                                answer.update(commit_seq=int(db.execute("SELECT value FROM metadata WHERE key='commit_seq'").fetchone()[0]))
                                answer.update(read_through_operations=len(reports),
                                              read_through_acknowledged=sum((report.get("result") or {}).get("acknowledged", 0) for report in reports))
                                with controls.lock:
                                    answer.update(http_commands=controls.http_commands,
                                                  http_delivery_acks=controls.http_delivery_acks,
                                                  http_media_publications=controls.http_media_publications)
                    elif request["method"] == "mark":
                        # The person marks (or clears) messages elsewhere, as
                        # another tab or device would, each at its current revision.
                        answer = []
                        for message_id in request["message_ids"]:
                            with sqlite3.connect(str(path)) as db:
                                row = db.execute("SELECT revision FROM message_marks WHERE actor_id=? AND message_id=?",
                                                 (actor, message_id)).fetchone()
                            answer.append(command("message.mark", "%s-%s" % (request["operation_id"], message_id),
                                                  {"marked": request["marked"]}, {"message_id": message_id},
                                                  {"mark_revision": row[0] if row else 0})["result"])
                    elif request["method"] == "server_stop":
                        # As a deploy stops the server: its live streams end and
                        # the address refuses connections until server_start.
                        assert server is not None, "The server is already stopped"
                        port = server.server_address[1]
                        server.shutdown()
                        server.server_close()
                        thread.join(2)
                        assert not thread.is_alive(), "Owned HTTP fixture did not stop"
                        server = None
                        answer = {"stopped": True}
                    elif request["method"] == "server_start":
                        assert server is None, "Stop the server before starting it again"
                        server = serve(port, request.get("web"))
                        thread = threading.Thread(target=server.serve_forever, daemon=True)
                        thread.start()
                        answer = {"origin": server.origin, "token": server.session_token}
                    elif freshness and request["method"] in ("read_hold", "read_release", "read_cancel", "read_delay", "read_fault", "read_fault_clear", "admission_events"):
                        answer = controls.control(request, server)
                    elif freshness and request["method"] == "navigation_topics":
                        # Isolated fixture setup through real creation commands; each topic
                        # in w1, or in the outcome its "workspace_id" names.
                        created = []
                        for item in request["topics"]:
                            topic_id, workspace = item["id"], item.get("workspace_id", "w1")
                            prefix = "navigation-" + topic_id
                            draft_id = prefix + "-draft"
                            command("draft.save", prefix + "-save", {
                                "source_ref": {"kind": "new_topic", "id": prefix, "workspace_id": workspace},
                                "topic_id": topic_id, "generation": prefix + "-generation", "body": "Fixture conversation " + topic_id,
                                "opening": {"workspace_id": workspace, "title": item["title"], "participants": []}},
                                {"draft_id": draft_id}, {"draft_revision": 0})
                            command("submission.prepare", prefix + "-prepare", {
                                "draft_id": draft_id, "submission_id": prefix + "-submission", "send_operation_id": prefix + "-send"},
                                {"topic_id": topic_id}, {"draft_revision": 1})
                            created.append(command("topic.create_and_send", prefix + "-send", {"submission_id": prefix + "-submission"}, {"topic_id": topic_id}))
                        answer = created
                    elif freshness and request["method"] == "older_outcome":
                        # An outcome of the person's as version 27 left it, with no conversation
                        # (workspace.create starts one now), and one topic made through real commands.
                        workspace, topic_id = request["workspace_id"], request["topic_id"]
                        with sqlite3.connect(str(path)) as db:
                            db.execute("INSERT INTO workspaces VALUES (?,?,?,'',NULL,1)", (workspace, actor, request["title"]))
                            db.execute("INSERT INTO workspace_members VALUES (?,?)", (workspace, actor))
                        prefix = "older-" + topic_id
                        command("draft.save", prefix + "-save", {
                            "source_ref": {"kind": "new_topic", "id": prefix, "workspace_id": workspace},
                            "topic_id": topic_id, "generation": prefix + "-generation", "body": "Opening " + topic_id,
                            "opening": {"workspace_id": workspace, "title": request["topic_title"], "participants": []}},
                            {"draft_id": prefix + "-draft"}, {"draft_revision": 0})
                        command("submission.prepare", prefix + "-prepare", {
                            "draft_id": prefix + "-draft", "submission_id": prefix + "-submission", "send_operation_id": prefix + "-send"},
                            {"topic_id": topic_id}, {"draft_revision": 1})
                        answer = command("topic.create_and_send", prefix + "-send", {"submission_id": prefix + "-submission"}, {"topic_id": topic_id})
                    elif freshness and request["method"] == "order_as":
                        # The order one viewer keeps (outline_order.py): with "ids", placed
                        # through the real Store as them ("actor", the person by default), at
                        # the revision they hold; then read back as they read it.
                        who = request.get("actor") or actor
                        within = request.get("workspace_id")

                        def held():
                            if within:
                                return store().view(who, "workspace_topics", {"workspace_id": within, "limit": 1})["order"]
                            return store().view(who, "workspaces", {"limit": 1})["order"]
                        if "ids" in request:
                            command("outline.order_set", request["operation_id"], {"ids": request["ids"]},
                                    {"workspace_id": within} if within else {}, {"order_revision": held()["revision"]}, sender=who)
                        answer = held()
                    elif freshness and request["method"] == "navigation_workspaces":
                        answer = [command("workspace.create", "navigation-workspace-" + item["id"], item)
                                  for item in request["workspaces"]]
                    elif freshness and request["method"] == "actor_name":
                        # Fixture-only operator rename: the production picker must
                        # keep membership IDs while reading the registered name.
                        with sqlite3.connect(str(path)) as db:
                            changed = db.execute("UPDATE actors SET name=? WHERE id=?",
                                                 (request["name"], request["actor_id"]))
                            assert changed.rowcount == 1
                        answer = {"id": request["actor_id"], "name": request["name"]}
                    elif freshness and request["method"] == "light_outcome":
                        # Item 86's light: an outcome ("outcome", its id) of the person's with the fixture agent on
                        # its team, made through real commands. With "topic", the agent opens a
                        # topic in it with the person taking part, which is work the person sees.
                        agent, workspace = "fixture-notebook-agent", request["outcome"]
                        if not request.get("exists"):
                            command("workspace.create", "light-workspace-" + workspace,
                                    {"id": workspace, "title": request["title"], "purpose": "The outcome light", "team": [agent]})
                        answer = None
                        if request.get("topic"):
                            topic_id = request["topic"]["id"]
                            prefix = "light-" + topic_id
                            command("draft.save", prefix + "-save", {
                                "source_ref": {"kind": "new_topic", "id": prefix + "-opening", "workspace_id": workspace},
                                "topic_id": topic_id, "generation": prefix + "-generation", "body": "Opening " + topic_id,
                                "opening": {"workspace_id": workspace, "title": request["topic"]["title"], "participants": [actor]}},
                                {"draft_id": prefix + "-draft"}, {"draft_revision": 0}, sender=agent)
                            command("submission.prepare", prefix + "-prepare", {"draft_id": prefix + "-draft", "submission_id": prefix + "-submission",
                                                                               "send_operation_id": prefix + "-send"},
                                    {"topic_id": topic_id}, {"draft_revision": 1}, sender=agent)
                            answer = command("topic.create_and_send", prefix + "-send", {"submission_id": prefix + "-submission"},
                                             {"topic_id": topic_id}, sender=agent)
                    elif freshness and request["method"] == "tools_seed":
                        answer = tools_seed(request)
                    elif freshness and request["method"] == "agent_message":
                        answer = agent_message(request)
                    elif freshness and request["method"] == "agent_thumb":
                        # An agent's thumbs-up on a message, as its CLI's `thumb` gives it (docs/thumbs.md).
                        revision = store().view(request["sender"], "reactions", {"message_id": request["message_id"]})["reactions"]["thumb_revision"]
                        answer = command("message.thumb", request["operation_id"], {"thumbed": request.get("thumbed", True)},
                                         {"message_id": request["message_id"]}, {"thumb_revision": revision}, sender=request["sender"])
                    elif freshness and request["method"] == "stack_act":
                        # A star, a stack's short name, a join, a place or a dossier's cover, as another person or
                        # an agent makes it through Core (docs/reply-stacks.md, docs/dossier-covers.md), fenced on
                        # what they last read.
                        field = "cover_revision" if request["kind"] == "stack.cover" else STACK_KINDS[request["kind"]][1]
                        with sqlite3.connect(str(path)) as db:
                            db.row_factory = sqlite3.Row
                            revision = current_acts(db, request["sender"], [request["message_id"]]).get(request["message_id"], {}).get(field, 0)
                        answer = command(request["kind"], request["operation_id"], request["args"], {"message_id": request["message_id"]},
                                         {field: revision}, sender=request["sender"], refusable=True)
                    elif freshness and request["method"] == "acts_as":
                        # What another reader sees of a topic's acts and of their own stars.
                        answer = {"acts": store().view(request["reader"], "message_acts", {"topic_id": request["topic_id"]}),
                                  "stars": store().view(request["reader"], "stars", {})}
                    elif freshness and request["method"] == "agent_state":
                        # An agent says where a topic stands, as through its CLI; Core may refuse it.
                        topic_id, sender = request.get("topic_id", "t1"), request["sender"]
                        revision = store().view(actor, "topic", {"topic_id": topic_id})["topic"]["version"]
                        answer = command("topic.update", request["operation_id"], request["args"], {"topic_id": topic_id},
                                         {"topic_revision": revision}, sender=sender, refusable=True)
                    elif freshness and request["method"] == "deliveries_to":
                        # How many messages each actor was ever handed: what would wake them.
                        with sqlite3.connect(str(path)) as db:
                            answer = {who: db.execute("SELECT count(*) FROM deliveries WHERE recipient_id=?", (who,)).fetchone()[0]
                                      for who in request["actors"]}
                    elif freshness and request["method"] == "wakes":
                        # The fixture agent's wakes, through Core's own runner record:
                        # "route" gives it a pin here, "runner_live" takes the runner
                        # role (as this process, for a lease), "runner_killed" records
                        # that process's exit as a supervisor would. "park" sets the
                        # count three unanswered wakes leave, which takes three
                        # minutes of real claims; the units prove how it gets there.
                        agent, action = "fixture-notebook-agent", request["action"]
                        if action == "route":
                            home = root / "agent-home"
                            home.mkdir(mode=0o700, exist_ok=True)
                            with store().runner_guard("fixture-route") as guard:
                                answer = store().provision_route_pin(guard, agent, {
                                    "kind": "codex-queue-stdio", "protocol_version": 1, "codex_home": str(home),
                                    "thread_id": "12345678-1234-4234-8234-000000000001"})
                        elif action == "runner_live":
                            with store().runner_guard("fixture-runner") as guard:
                                # The longest lease a runner may take, so a slow browser start
                                # cannot let it lapse into "unrenewed" mid-check.
                                answer = store().acquire_runner(guard, lease_ms=120000)
                            answer = {"status": answer["status"], "lease_until_ms": answer.get("lease_until_ms")}
                        elif action == "runner_killed":
                            answer = store().record_runner_exit(os.getpid(), -9)
                        elif action == "park":
                            with sqlite3.connect(str(path)) as db:
                                db.execute("UPDATE recipient_schedule SET unanswered_wakes=3,unanswered_since_ms=? WHERE recipient_id=?",
                                           (int(time.time() * 1000), agent))
                            answer = {"parked": agent}
                        else:
                            raise ValueError("Unknown wakes action")
                    elif freshness and request["method"] == "hosted_cleanup":
                        # Only this isolated native fixture's hosted case. Clear
                        # its work through Core before restoring its prior route.
                        with sqlite3.connect(str(path)) as db:
                            pending = db.execute("SELECT id FROM deliveries WHERE recipient_id='fixture-outside-agent' AND topic_id='hosted-topic' AND state='pending'").fetchall()
                        for (identity,) in pending:
                            command("delivery.ack", "hosted-cleanup-" + identity, {}, {"delivery_id":identity}, sender="fixture-outside-agent")
                        with sqlite3.connect(str(path)) as db:
                            db.execute("DELETE FROM metadata WHERE key IN ('hosted_control.v1:fixture-outside-agent','hosted_activity.v1:fixture-outside-agent')")
                            db.execute("DELETE FROM metadata WHERE key LIKE 'route_pin.v1:%' AND json_extract(value,'$.binding.actor_id')='fixture-outside-agent'")
                        answer = {"restored":True}
                    elif freshness and request["method"] == "hosted_setup":
                        home = root / "hosted-controls-home"
                        home.mkdir(mode=0o700, exist_ok=True)
                        destination = {"kind":"codex-hosted-stdio", "protocol_version":1, "codex_home":str(home),
                                       "thread_id":"12345678-1234-4234-8234-000000000002"}
                        with store().runner_guard("fixture-hosted-controls") as guard:
                            answer = store().provision_route_pin(guard, "fixture-outside-agent", destination, owner_id=actor)
                        command("workspace.create", "hosted-controls-workspace", {"id":"hosted-workspace", "title":"Hosted controls", "team":["fixture-outside-agent"]})
                        command("opening.save", "hosted-controls-save", {"workspace_id":"hosted-workspace", "topic_id":"hosted-topic", "title":"Queued work", "participants":["fixture-outside-agent"], "body":"Keep this job until it is handled.", "attachments":[]}, {"opening_id":"hosted-opening"}, {"opening_revision":0})
                        command("opening.publish", "hosted-controls-publish", {}, {"opening_id":"hosted-opening"}, {"opening_revision":1})
                    elif freshness and request["method"] == "health":
                        # The fixture agent's wakes through Core's own runner acts, for
                        # the Health page (docs/health.md). "start" gives it a queue
                        # route and takes the runner role under a guard held across the
                        # checks; "fail" settles `count` claimed wakes as errors with the
                        # runner's fixed `reason`, and "through" settles one accepted, which
                        # the agent answers as a working agent does (a note in its topic, so
                        # its waiting work stays and it is not left with wakes unanswered). A
                        # wake waits out a backoff of seconds before it is due again;
                        # the fixture makes it due at once (next_due_ms), which is the
                        # one fact not reached through a runner act. "pause" pauses the
                        # runner as an operator; "resume" takes the role again with a
                        # fresh guard, as the supervisor's resume does. "renew" renews
                        # the role, a commit that changes nothing on the page; "hang"
                        # renews it for one second and then never again, as a hung
                        # runner whose process lives; "take" takes the role again
                        # after that with a fresh guard; "notices" reads what Theseus posted;
                        # "settled" reads the server's event lines, what Core last told the team
                        # and the moment it keeps for what is red or told to change.
                        agent, action = "fixture-notebook-agent", request["action"]
                        def claimed():
                            with sqlite3.connect(str(path)) as db:
                                db.execute("UPDATE recipient_schedule SET next_due_ms=? WHERE recipient_id=?", (int(time.time() * 1000), agent))
                            assert store().renew_runner(health_runner["guard"], health_runner["token"], 120000)["status"] == "renewed"
                            claims = store().claim_wakes(health_runner["guard"], health_runner["token"], [agent])["claims"]
                            assert len(claims) == 1, claims
                            return claims[0]["claim_token"]
                        if action == "start":
                            home = root / "agent-home"
                            home.mkdir(mode=0o700, exist_ok=True)
                            health_runner["guard"] = store().runner_guard("fixture-health")
                            health_runner["guard"].__enter__()
                            pinned = store().provision_route_pin(health_runner["guard"], agent, {
                                "kind": "codex-queue-stdio", "protocol_version": 1, "codex_home": str(home),
                                "thread_id": "12345678-1234-4234-8234-000000000001"})
                            acquired = store().acquire_runner(health_runner["guard"], lease_ms=120000)
                            health_runner["token"] = acquired.get("runner_token")
                            answer = {"route": pinned["status"], "runner": acquired["status"]}
                        elif action in ("fail", "through"):
                            for unused in range(request.get("count", 1)):
                                settled = store().finish_wake(health_runner["guard"], health_runner["token"], claimed(),
                                                              "error" if action == "fail" else "accepted",
                                                              reason=request.get("reason") if action == "fail" else None)
                                assert settled["status"] == "settled", settled
                                if action == "through":
                                    health_runner["answers"] = health_runner.get("answers", 0) + 1
                                    item = "health-answer-%d" % health_runner["answers"]
                                    command("memory.create", item, {"title": "Woken", "body": "Answered a wake.", "attachments": [], "references": []},
                                            {"item_id": item, "owner_scope": {"kind": "topic", "id": "t1"}}, {"item_revision": 0}, sender=agent)
                            answer = {"settled": request.get("count", 1)}
                        elif action in ("renew", "hang"):
                            answer = store().renew_runner(health_runner["guard"], health_runner["token"], 120000 if action == "renew" else 1000)
                        elif action == "take":
                            health_runner["guard"].close()
                            health_runner["guard"] = store().runner_guard("fixture-health-taken")
                            health_runner["guard"].__enter__()
                            answer = store().acquire_runner(health_runner["guard"], lease_ms=120000)
                            health_runner["token"] = answer.get("runner_token")
                            answer = {"status": answer["status"]}
                        elif action == "settled":
                            with sqlite3.connect(str(path)) as db:
                                row = db.execute("SELECT value FROM metadata WHERE key='health_announced'").fetchone()
                                due = db.execute("SELECT value FROM metadata WHERE key='health_due'").fetchone()
                            answer = {"events": list(server_events), "announced": sorted(json.loads(row[0])) if row else [],
                                      "due": int(due[0]) if due else None}
                        elif action == "notices":
                            with sqlite3.connect(str(path)) as db:
                                answer = [row[0] for row in db.execute("SELECT body FROM messages WHERE author_id='theseus' ORDER BY seq")]
                        elif action == "pause":
                            answer = store().pause_runner(health_runner["guard"], health_runner["token"], "operator_pause")
                        elif action == "resume":
                            health_runner["guard"].close()
                            health_runner["guard"] = store().runner_guard("fixture-health-again")
                            health_runner["guard"].__enter__()
                            answer = store().resume_runner(health_runner["guard"], request["version"], lease_ms=120000)
                            health_runner["token"] = answer.get("runner_token")
                            answer = {"status": answer["status"]}
                        else:
                            raise ValueError("Unknown health action")
                    elif freshness and request["method"] == "agent_topic":
                        # A topic in an outcome an agent owns, which the agent started
                        # with the reader in it: the reader takes part but is neither
                        # the outcome's owner nor the topic's creator.
                        # With "team": true the reader is on the outcome's team, and with
                        # "coordinator": true also its coordinator; with "watching": true
                        # (and "team") the reader only reads it.
                        agent, prefix = "fixture-notebook-agent", request["operation_id"]
                        workspace, topic_id = prefix + "-w", prefix + "-t"
                        command("workspace.create", prefix + "-workspace", dict(
                            {"id": workspace, "title": "The agent's outcome", "team": [actor] if request.get("team") or request.get("coordinator") else []},
                            **({"coordinator": actor} if request.get("coordinator") else {})), sender=agent)
                        command("draft.save", prefix + "-save", {
                            "source_ref": {"kind": "new_topic", "id": prefix + "-opening", "workspace_id": workspace},
                            "topic_id": topic_id, "generation": prefix + "-generation", "body": request["body"],
                            "opening": {"workspace_id": workspace, "title": request["title"], "participants": [actor]}},
                            {"draft_id": prefix + "-draft"}, {"draft_revision": 0}, sender=agent)
                        command("submission.prepare", prefix + "-prepare", {"draft_id": prefix + "-draft", "submission_id": prefix + "-submission",
                                                                           "send_operation_id": prefix + "-send"},
                                {"topic_id": topic_id}, {"draft_revision": 1}, sender=agent)
                        command("topic.create_and_send", prefix + "-send", {"submission_id": prefix + "-submission"}, {"topic_id": topic_id}, sender=agent)
                        if request.get("watching"):
                            # The agent takes the reader out of the topic: on the team, they still read
                            # it, but neither take part in it nor have written there, so they may not say
                            # where it stands.
                            revision = store().view(agent, "topic", {"topic_id": topic_id})["topic"]["version"]
                            command("participation.set", prefix + "-watching", {"actor_id": actor, "present": False},
                                    {"topic_id": topic_id}, {"topic_revision": revision}, sender=agent)
                        answer = {"topic_id": topic_id, "workspace_id": workspace}
                    elif freshness and request["method"] == "own_topic":
                        # A topic the reader starts, with the fixture's agent in it, in an outcome the
                        # agent owns and the reader is on the team of, and then steps out of: the reader
                        # owns the topic without taking part in it or owning its outcome.
                        agent, prefix = "fixture-notebook-agent", request["operation_id"]
                        workspace, topic_id = prefix + "-w", prefix + "-t"
                        command("workspace.create", prefix + "-workspace", {"id": workspace, "title": "The agent's outcome", "team": [actor]}, sender=agent)
                        command("draft.save", prefix + "-save", {
                            "source_ref": {"kind": "new_topic", "id": prefix + "-opening", "workspace_id": workspace},
                            "topic_id": topic_id, "generation": prefix + "-generation", "body": "Started by the reader",
                            "opening": {"workspace_id": workspace, "title": request["title"], "participants": [agent]}},
                            {"draft_id": prefix + "-draft"}, {"draft_revision": 0})
                        command("submission.prepare", prefix + "-prepare", {"draft_id": prefix + "-draft", "submission_id": prefix + "-submission",
                                                                           "send_operation_id": prefix + "-send"},
                                {"topic_id": topic_id}, {"draft_revision": 1})
                        command("topic.create_and_send", prefix + "-send", {"submission_id": prefix + "-submission"}, {"topic_id": topic_id})
                        revision = store().view(actor, "topic", {"topic_id": topic_id})["topic"]["version"]
                        command("participation.set", prefix + "-out", {"actor_id": actor, "present": False},
                                {"topic_id": topic_id}, {"topic_revision": revision})
                        answer = {"topic_id": topic_id, "workspace_id": workspace}
                    elif freshness and request["method"] == "agent_page":
                        # The fixture's agent starts a page in the Notebook of a topic it takes part in, with
                        # "attachments" of its own (published()), which a card's line names as attachment:OPERATION-media-N.
                        attached = published(request["operation_id"], request.get("attachments", []), "fixture-notebook-agent")
                        answer = command("memory.create", request["operation_id"], {
                            "title": request["title"], "body": request["body"], "attachments": attached, "references": []},
                            {"item_id": request["item_id"], "owner_scope": {"kind": "topic", "id": request["topic_id"]}},
                            {"item_revision": 0}, sender="fixture-notebook-agent")
                    elif freshness and request["method"] == "agent_view":
                        # What the fixture's agent (or {"actor": an agent}) is given by a view, as its CLI reads it.
                        answer = store().view(request.get("actor", "fixture-notebook-agent"), request["name"], request.get("args") or {})
                    elif freshness and request["method"] == "outcome_change":
                        # Someone who organises an outcome changes its record, as the CLI
                        # does: {"owner": id} hands it on, {"member": id, "present": bool}
                        # changes its team. Fenced on the version that sender reads.
                        sender, workspace = request["sender"], request["workspace_id"]
                        version = store().view(sender, "workspace", {"workspace_id": workspace})["workspace"]["version"]
                        if "owner" in request:
                            answer = command("workspace.owner_set", request["operation_id"], {"owner_id": request["owner"]},
                                             {"workspace_id": workspace}, {"workspace_revision": version}, sender=sender)
                        else:
                            answer = command("workspace.member_set", request["operation_id"], {"actor_id": request["member"], "present": request["present"]},
                                             {"workspace_id": workspace}, {"workspace_revision": version}, sender=sender)
                    elif freshness and request["method"] == "team_outcome":
                        # An outcome of the person's own, for the Team panel's cases: {"workspace_id", "title"}
                        # ("id" is this control's own), with {"team": [...]} on it; {"owner": id} then hands it to
                        # that member, so the person is one of its team who does not organise it.
                        answer = command("workspace.create", request["operation_id"], {"id": request["workspace_id"], "title": request["title"],
                                                                                     "team": request.get("team", [])})
                        if request.get("owner"):
                            command("workspace.owner_set", request["operation_id"] + "-owner", {"owner_id": request["owner"]},
                                    {"workspace_id": request["workspace_id"]}, {"workspace_revision": 1})
                    elif freshness and request["method"] == "sign_in_files":
                        # The sign-in files written, each with its permissions and who it binds, never its contents.
                        from aim_next.profile import read_binding
                        answer = []
                        for entry in sorted(sign_in.iterdir()):
                            info = entry.lstat()
                            answer.append({"name": entry.name, "mode": oct(info.st_mode & 0o777), "regular": entry.is_file() and not entry.is_symlink(),
                                           "mine": info.st_uid == os.getuid(), "actor": read_binding(entry).actor_id})
                    elif freshness and request["method"] == "sign_in_folder":
                        # {"writable": false} makes the folder refuse a new file, as a full or locked disk would; true restores it.
                        sign_in.chmod(0o700 if request["writable"] else 0o500)
                        answer = {"writable": request["writable"]}
                    elif freshness and request["method"] == "secrets":
                        # What a sign-in file holds that the page must never show.
                        answer = [binding["authority_id"], binding["authority_epoch"], binding["authority_path"]]
                    elif freshness and request["method"] == "coordinator":
                        # The owner chooses who answers in w1's conversation, bringing
                        # {"coordinator": id} and each of {"team": [...]} onto the team first.
                        for member in [request["coordinator"]] + request.get("team", []):
                            version = store().view(actor, "workspace", {"workspace_id": "w1"})["workspace"]["version"]
                            command("workspace.member_set", "%s-member-%s" % (request["operation_id"], member), {"actor_id": member, "present": True},
                                    {"workspace_id": "w1"}, {"workspace_revision": version})
                        version = store().view(actor, "workspace", {"workspace_id": "w1"})["workspace"]["version"]
                        command("workspace.coordinator_set", request["operation_id"], {"actor_id": request["coordinator"]},
                                {"workspace_id": "w1"}, {"workspace_revision": version})
                        answer = store().view(actor, "conversation", {"workspace_id": "w1"})["conversation"]
                    elif freshness and request["method"] == "lost_named_message":
                        # The reader is named in a message in another outcome's
                        # topic and then taken out of it: Core keeps exactly that
                        # message readable to them, and nothing else there.
                        agent, prefix = "fixture-notebook-agent", request["operation_id"]
                        workspace, topic_id = prefix + "-w", prefix + "-t"
                        command("workspace.create", prefix + "-workspace", {"id": workspace, "title": "Elsewhere", "team": []}, sender=agent)
                        # It carries one attachment, which the reader opens from the message.
                        data, media_id = b"The attached plan.", prefix + "-media"
                        command("media.begin", prefix + "-media-begin", {
                            "name": "plan.txt", "content_type": "text/plain", "size_bytes": len(data),
                            "sha256": hashlib.sha256(data).hexdigest(), "publish_operation_id": prefix + "-publish",
                        }, {"media_id": media_id}, {"media_revision": 0}, sender=agent)
                        envelope = {"v": 1, "instance_id": instance, "kind": "media.publish", "operation_id": prefix + "-publish",
                                    "target": {"media_id": media_id}, "args": {}, "expected": {"media_revision": 1,
                                    "authority": {key: binding[key] for key in ("authority_id", "authority_epoch")}}}
                        assert store().publish_media(agent, envelope, io.BytesIO(data))["status"] == "committed"
                        command("draft.save", prefix + "-save", {
                            "source_ref": {"kind": "new_topic", "id": prefix + "-opening", "workspace_id": workspace},
                            "topic_id": topic_id, "generation": prefix + "-generation", "body": request["body"],
                            "attachments": [{"id": media_id}],
                            "addressees": [actor], "intent": "tell", "opening": {"workspace_id": workspace, "title": "Elsewhere topic", "participants": [actor]}},
                            {"draft_id": prefix + "-draft"}, {"draft_revision": 0}, sender=agent)
                        command("submission.prepare", prefix + "-prepare", {"draft_id": prefix + "-draft", "submission_id": prefix + "-submission",
                                                                           "send_operation_id": prefix + "-send"},
                                {"topic_id": topic_id}, {"draft_revision": 1}, sender=agent)
                        answer = command("topic.create_and_send", prefix + "-send", {"submission_id": prefix + "-submission"}, {"topic_id": topic_id}, sender=agent)
                        revision = store().view(agent, "topic", {"topic_id": topic_id})["topic"]["version"]
                        command("participation.set", prefix + "-remove", {"actor_id": actor, "present": False},
                                {"topic_id": topic_id}, {"topic_revision": revision}, sender=agent)
                    elif freshness and request["method"] == "elsewhere_ask":
                        # An agent, through its CLI, starts a topic in an outcome of
                        # its own with the reader in it, and asks the reader there.
                        agent, prefix = "fixture-notebook-agent", request["operation_id"]
                        workspace, topic_id = prefix + "-w", prefix + "-t"
                        command("workspace.create", prefix + "-workspace", {"id": workspace, "title": request.get("title", "Elsewhere"), "team": []}, sender=agent)
                        command("draft.save", prefix + "-save", {
                            "source_ref": {"kind": "new_topic", "id": prefix + "-opening", "workspace_id": workspace},
                            "topic_id": topic_id, "generation": prefix + "-generation", "body": request["body"],
                            "addressees": [actor], "intent": "ask", "opening": {"workspace_id": workspace, "title": "Asked elsewhere", "participants": [actor]}},
                            {"draft_id": prefix + "-draft"}, {"draft_revision": 0}, sender=agent)
                        command("submission.prepare", prefix + "-prepare", {"draft_id": prefix + "-draft", "submission_id": prefix + "-submission",
                                                                           "send_operation_id": prefix + "-send"},
                                {"topic_id": topic_id}, {"draft_revision": 1}, sender=agent)
                        command("topic.create_and_send", prefix + "-send", {"submission_id": prefix + "-submission"}, {"topic_id": topic_id}, sender=agent)
                        answer = {"workspace_id": workspace, "topic_id": topic_id}
                    elif freshness and request["method"] == "opening_save":
                        # The person saves an opening of theirs elsewhere, as their CLI
                        # or another device would: the whole writing, at its revision.
                        current = store().view(actor, "opening", {"opening_id": request["opening_id"]})["opening"]
                        answer = command("opening.save", request["operation_id"], {
                            "workspace_id": current["workspace_id"], "topic_id": current["topic_id"], "title": request["title"],
                            "participants": current["participants"], "body": current["body"], "attachments": current["attachments"]},
                            {"opening_id": request["opening_id"]}, {"opening_revision": current["revision"]})
                    elif freshness and request["method"] == "private_writing":
                        # A private note or a saved reply on a message, as its writer's page, CLI or another
                        # device saves it, at the revision it stands at: the person's own ("sender": "person",
                        # the default) or another reader's, who with "join": true takes part in the topic first.
                        sender = actor if request.get("sender", "person") == "person" else request["sender"]
                        ref, topic_id, prefix = {"kind": "message", "id": request["message_id"]}, request.get("topic_id", "t1"), request["operation_id"]
                        if request.get("join"):
                            revision = store().view(actor, "topic", {"topic_id": topic_id})["topic"]["version"]
                            command("participation.set", prefix + "-join", {"actor_id": sender, "present": True},
                                    {"topic_id": topic_id}, {"topic_revision": revision})
                        current = store().view(sender, "editor_state", {"source_ref": ref, "topic_id": topic_id})
                        assert not current.get("error"), current
                        if request["kind"] == "note":
                            note = current["note"] or {"id": prefix + "-note", "revision": 0}
                            answer = command("note.save", prefix, {"source_ref": ref, "body": request["body"]},
                                             {"note_id": note["id"]}, {"note_revision": note["revision"]}, sender=sender)
                        else:
                            draft = current["draft"] or {"id": prefix + "-draft", "generation": prefix + "-generation", "revision": 0}
                            answer = command("draft.save", prefix, {"source_ref": ref, "topic_id": topic_id, "generation": draft["generation"],
                                                                    "body": request["body"]},
                                             {"draft_id": draft["id"]}, {"draft_revision": draft["revision"]}, sender=sender)
                    elif freshness and request["method"] == "topic_state":
                        # The person sets where a topic stands, as the state form does,
                        # after adding any participants it is to wait on.
                        for member in request.get("participants", []):
                            revision = store().view(actor, "topic", {"topic_id": request["topic_id"]})["topic"]["version"]
                            command("participation.set", request["operation_id"] + "-" + member, {"actor_id": member, "present": True},
                                    {"topic_id": request["topic_id"]}, {"topic_revision": revision})
                        revision = store().view(actor, "topic", {"topic_id": request["topic_id"]})["topic"]["version"]
                        answer = command("topic.update", request["operation_id"], request["args"],
                                         {"topic_id": request["topic_id"]}, {"topic_revision": revision})
                    elif freshness and request["method"] == "responsibility":
                        # A participant says what they do in a topic, as their own page or CLI does,
                        # fenced on the revision they read.
                        sender, topic_id = request.get("sender") or "fixture-notebook-agent", request.get("topic_id", "t1")
                        [revision] = [item["responsibility_revision"] for item in store().view(sender, "topic", {"topic_id": topic_id})["participants"]
                                      if item["actor_id"] == sender]
                        answer = command("responsibility.set", request["operation_id"], {"note": request["note"]},
                                         {"topic_id": topic_id}, {"responsibility_revision": revision}, sender=sender)
                    elif freshness and request["method"] == "source_start":
                        # An agent on the outcome's team starts a topic answering a message,
                        # as `start --from` does: it reads the topics already started from it
                        # and names them as seen.
                        agent, prefix = on_team(request["operation_id"]), request["operation_id"]
                        started = store().view(agent, "source_topics", {"message_id": request["message_id"]})
                        assert "error" not in started and started["next_cursor"] is None, started
                        command("opening.save", prefix + "-save", {
                            "workspace_id": "w1", "topic_id": prefix + "-topic", "title": request["title"], "participants": [],
                            "body": request["body"], "attachments": [], "source_message_id": request["message_id"]},
                            {"opening_id": prefix + "-opening"}, {"opening_revision": 0}, sender=agent)
                        answer = command("opening.publish", prefix + "-publish", {"seen": [item["id"] for item in started["items"]]},
                                         {"opening_id": prefix + "-opening"}, {"opening_revision": 1}, sender=agent)
                    elif freshness and request["method"] == "outcome_reference":
                        # An agent on the outcome's team writes to the outcome's
                        # own Notebook, which every topic in it stands on. With
                        # "workspace_id", the person writes in that outcome of theirs,
                        # marking the page a draft with "draft": true.
                        # "attachments" are the sender's own (published()), named in a card as attachment:OPERATION-media-N.
                        workspace = request.get("workspace_id", "w1")
                        sender = on_team(request["operation_id"]) if workspace == "w1" else actor
                        attached = published(request["operation_id"], request.get("attachments", []), sender)
                        answer = command("memory.create", request["operation_id"], dict({
                            "title": request["title"], "body": request["body"], "attachments": attached, "references": []},
                            **({"draft": True} if request.get("draft") else {})),
                            {"item_id": request["item_id"], "owner_scope": {"kind": "workspace", "id": workspace}},
                            {"item_revision": 0}, sender=sender)
                    elif freshness and request["method"] == "pipeline":
                        # Someone acts on an outcome's pipeline as their CLI does: a
                        # pipeline.* command fenced on the revision that sender reads
                        # now. "sender": "agent" is the fixture's agent, on w1's team;
                        # otherwise the person, w1's owner. With "ask", the sender
                        # first asks the person in t1, as an owner-gated stage needs.
                        kind, operation, target = request["kind"], request["operation_id"], request["target"]
                        assert kind.startswith("pipeline."), kind
                        sender = on_team(operation) if request.get("sender") == "agent" else actor
                        args, workspace = dict(request.get("args") or {}), request.get("workspace_id", "w1")
                        if request.get("ask"):
                            asked = agent_message({"operation_id": operation + "-ask", "sender": sender, "body": request["ask"],
                                                   "addressees": [actor], "intent": "ask"})
                            args["ask_message_id"] = asked["result"]["message_id"]
                        if kind in ("pipeline.configure", "pipeline.stages_set"):
                            current = store().view(sender, "pipeline", {"workspace_id": workspace, "limit": 1})["pipeline"]
                            expected = {"pipeline_revision": current["version"] if current else 0}
                        elif "number" in target:
                            expected = {"item_revision": store().view(sender, "pipeline_item", target)["item"]["version"]}
                        elif "piece_id" in target:
                            [piece] = [piece for piece in store().view(sender, "pipeline", {"workspace_id": workspace, "section": "now"})["pieces"]
                                       if piece["id"] == target["piece_id"]]
                            expected = {"piece_revision": piece["version"]}
                        else:
                            expected = {}
                        answer = command(kind, operation, args, target, expected, sender=sender, refusable=request.get("refusable", False))
                    elif freshness and request["method"] == "targets":
                        # Someone acts on an outcome's target, checks or kind as their CLI does
                        # (docs/targets.md), as the person, w1's owner, fenced on the revision
                        # they read now. "record_checks" writes a release check's run as the
                        # deploy does, "release" a release record, and "attach_judgment" the
                        # hosted judgment of a merged train's release, as the operator's admin verb does.
                        # {"sender": id} acts as someone else on the outcome's team (item 404: its owner when not the person).
                        kind, operation, workspace = request["kind"], request["operation_id"], request.get("workspace_id", "w1")
                        sender = request.get("sender", actor)
                        if kind == "record_checks":
                            answer = store().record_checks(dict(request["run"], outcome=workspace), sender)
                        elif kind == "release":
                            answer = store().record_release(request["record"])
                        elif kind == "attach_judgment":
                            answer = store().attach_judgment(request["release"], request["judgment"])
                        else:
                            assert kind.split(".")[0] in ("target", "check", "outcome", "problem"), kind
                            if kind.startswith("outcome."):
                                expected = {"workspace_revision": store().view(sender, "workspace", {"workspace_id": workspace})["workspace"]["version"]}
                            elif kind == "problem.file":
                                # Filing a problem is fenced on nothing: it only adds one.
                                expected = {}
                            else:
                                checks = store().view(sender, "outcome_checks", {"workspace_id": workspace})["relevant_versions"]["checks"]
                                expected = {"target_revision" if kind.startswith("target.") else "checks_revision": checks}
                            answer = command(kind, operation, request.get("args") or {}, dict({"workspace_id": workspace}, **(request.get("target") or {})),
                                             expected, sender=sender, refusable=request.get("refusable", False))
                    elif freshness and request["method"] == "memory_revise":
                        answer = command("memory.revise", request["operation_id"], {
                            "title": request["title"], "body": request["body"], "attachments": [], "references": []},
                            {"item_id": request["item_id"]}, {"item_revision": request["expected_revision"]},
                            sender="fixture-notebook-agent")
                    elif freshness and request["method"] == "seed":
                        seed_number += 1
                        prefix = "freshness-seed-%d" % seed_number
                        message_ids, item_ids = [], []
                        # In t1 unless "topic_id" names another, each written
                        # from the person's first message unless "source" says.
                        seed_topic = request.get("topic_id", "t1")
                        for n in range(request.get("messages", 0)):
                            result = agent_message({"operation_id": prefix + "-message-%d" % n, "topic_id": seed_topic,
                                                    "source": request.get("source"),
                                                    "body": "Incoming fixture message %d" % n})
                            message_ids.append(result["result"]["message_id"])
                        for n in range(request.get("memory_items", 0)):
                            item_id = prefix + "-item-%d" % n
                            command("memory.create", prefix + "-create-%d" % n, {
                                "title": "Fixture item %d" % n, "body": "Fixture Notebook body %d" % n,
                                "attachments": [], "references": []},
                                {"item_id": item_id, "owner_scope": {"kind": "topic", "id": seed_topic}},
                                {"item_revision": 0}, sender="fixture-notebook-agent")
                            item_ids.append(item_id)
                        # Query-scale fixture only: these are unrelated change
                        # records, not claimed agent commands/messages.
                        with sqlite3.connect(str(path)) as db:
                            db.executemany("INSERT INTO changes(scope_kind,scope_id,resource_kind,resource_id,version) VALUES ('actor','fixture-unrelated','draft',?,1)",
                                           [(prefix + "-unrelated-%d" % n,) for n in range(request.get("unrelated_records", 0))])
                            unrelated = db.execute("SELECT count(*) FROM changes WHERE scope_id='fixture-unrelated'").fetchone()[0]
                        answer = {"message_ids": message_ids, "item_ids": item_ids, "unrelated_changes": unrelated}
                    elif "--images" in sys.argv and request["method"] == "reset_drafts":
                        # Each image case starts from the seeded writing. Every
                        # draft the person left holding anything is emptied at its
                        # revision through the real Store. It keeps its generation,
                        # where a send would also start a new one. A save a closed
                        # page left on its way lands before the revisions are read,
                        # or waits for the reset (CommandGate): refused at its old
                        # revision if the reset emptied that draft, landing after
                        # the reset if it skipped the draft as already empty or
                        # the draft had no row yet (a first save inserts one).
                        with gate.hold():
                            with sqlite3.connect(str(path)) as db:
                                rows = db.execute("SELECT id,revision,generation,topic_id,payload FROM drafts WHERE actor_id=?", (actor,)).fetchall()
                            answer = []
                            for draft_id, revision, generation, topic_id, payload in rows:
                                payload = json.loads(payload)
                                if not payload["body"] and not payload["attachments"] and not payload["quotes"] and not payload["addressees"] and all(
                                        payload.get(name) is None for name in ("reply_to", "exchange_id", "opening", "caret")):
                                    continue
                                command("draft.save", "fixture-reset-%s-%d" % (draft_id, revision), {
                                    "source_ref": payload["source_ref"], "topic_id": topic_id,
                                    "generation": generation, "body": ""}, {"draft_id": draft_id}, {"draft_revision": revision})
                                answer.append(draft_id)
                    elif request["method"] == "epoch":
                        # Test-only controlled history boundary. No activation
                        # claim: the real runtime cutover is lead-owned.
                        anchor = Path(binding["authority_path"])
                        fd = os.open(str(anchor) + ".lock", os.O_RDWR)
                        try:
                            # Wait for requests that hold the authority shared;
                            # a non-blocking lock failed with EAGAIN whenever
                            # an autosave or cleanup read was in flight.
                            fcntl.flock(fd, fcntl.LOCK_EX)
                            record = json.loads(anchor.read_text())
                            record["epoch"] = request["epoch"]
                            record["recovery"] = {"history_complete": request.get("complete", False)}
                            with sqlite3.connect(str(path)) as db:
                                db.execute("UPDATE metadata SET value=? WHERE key='authority_epoch'", (record["epoch"],))
                                if request.get("drop_private"):
                                    db.execute("DELETE FROM drafts")
                                    db.execute("DELETE FROM notes")
                            anchor.write_text(json.dumps(record))
                            binding = dict(binding, authority_epoch=record["epoch"])
                        finally:
                            os.close(fd)
                        answer = store().view(actor, "capabilities", {})
                    elif request["method"] == "unanswered":
                        # A control left unanswered, as a lost one would be:
                        # the harness's bound fails it (tests/native-calls.mjs).
                        continue
                    else:
                        raise ValueError("Unknown private fixture control")
                    print(json.dumps({"id": request["id"], "answer": answer}), flush=True)
                except Exception as error:
                    print(json.dumps({"id": request["id"], "failure": str(error)}), flush=True)
        finally:
            if controls is not None:
                controls.close()
            if server is not None:
                server.shutdown()
                server.server_close()
                thread.join(2)
                assert not thread.is_alive(), "Owned HTTP fixture did not close"
            if controls is not None:
                controls.assert_healthy()


if __name__ == "__main__":
    main()

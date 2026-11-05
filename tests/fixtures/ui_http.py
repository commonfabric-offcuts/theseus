from __future__ import annotations

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

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
from aim_next import Store, initialize
from aim_next.server import create_server, RequestError


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
        binding = initialize(path, instance, actors,
                             authority_path=root / "control" / "authority.json")["binding"]

        def store():
            return Store(path, instance, expected_binding=dict(binding))

        def command(kind, operation, args, target=None, expected=None, sender=None):
            envelope = {"v": 1, "instance_id": instance, "kind": kind,
                        "operation_id": operation, "target": target or {},
                        "expected": dict(expected or {}, authority={
                            key: binding[key] for key in ("authority_id", "authority_epoch")}),
                        "args": args}
            answer = store().command(sender or actor, envelope)
            assert answer["status"] == "committed", answer
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
        for number in range(2):
            draft, generation = "seed-draft-%d" % number, "seed-generation-%d" % number
            source = ({"kind": "new_topic", "id": "fixture-opening", "workspace_id": "w1"}
                      if number == 0 else sources[0])
            args = {"source_ref": source, "topic_id": "t1", "generation": generation,
                    "body": ("Source %d exact passage. " % number) * 100}
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
        server = create_server(store, instance, actor, Path(__file__).resolve().parents[2] / "web",
                               max_reads=max_reads,
                               live=(path, (root / "control" / "authority.json",)) if "--live" in sys.argv else None)
        if "--live" in sys.argv:
            assert server.live_feed is not None, "The live fixture needs the native watch"
        else:
            assert server.live_feed is None
        if "--baseline-read-admission" in sys.argv:
            assert "--legacy-read-admission" not in sys.argv, "Baseline uses default shared2, never single-slot legacy"
            assert getattr(server, "read_admission", None) is None, "Baseline flag requires the actual old server"
        controls = FreshnessControls() if freshness else None
        if controls is not None:
            controls.install(server, store)

        def agent_message(request):
            operation = request["operation_id"]
            sender = "fixture-notebook-agent"
            topic_id = request.get("topic_id", "t1")
            current = store().view(sender, "editor_state", {"source_ref": sources[0], "topic_id": topic_id})
            assert not current.get("error"), current
            draft = current["draft"] or {"id": operation + "-draft", "generation": operation + "-generation", "revision": 0}
            command("draft.save", operation + "-save", {
                "source_ref": sources[0], "topic_id": topic_id, "generation": draft["generation"],
                "body": request["body"], "addressees": request.get("addressees", [])},
                {"draft_id": draft["id"]}, {"draft_revision": draft["revision"]}, sender=sender)
            command("submission.prepare", operation + "-prepare", {
                "draft_id": draft["id"], "submission_id": operation + "-submission",
                "send_operation_id": operation}, {"topic_id": topic_id}, {"draft_revision": draft["revision"] + 1}, sender=sender)
            return command("message.send", operation, {"submission_id": operation + "-submission"},
                           {"topic_id": topic_id}, sender=sender)

        seed_number = 0
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
                                               "acknowledged_deliveries": db.execute("SELECT count(*) FROM deliveries WHERE state='acknowledged'").fetchone()[0]})
                                with controls.lock:
                                    answer.update(http_commands=controls.http_commands,
                                                  http_delivery_acks=controls.http_delivery_acks,
                                                  http_media_publications=controls.http_media_publications)
                    elif freshness and request["method"] in ("read_hold", "read_release", "read_cancel", "read_delay", "read_fault", "admission_events"):
                        answer = controls.control(request, server)
                    elif freshness and request["method"] == "navigation_topics":
                        # Isolated fixture setup through real creation commands.
                        created = []
                        for item in request["topics"]:
                            topic_id = item["id"]
                            prefix = "navigation-" + topic_id
                            draft_id = prefix + "-draft"
                            command("draft.save", prefix + "-save", {
                                "source_ref": {"kind": "new_topic", "id": prefix, "workspace_id": "w1"},
                                "topic_id": topic_id, "generation": prefix + "-generation", "body": "Fixture conversation " + topic_id,
                                "opening": {"workspace_id": "w1", "title": item["title"], "participants": []}},
                                {"draft_id": draft_id}, {"draft_revision": 0})
                            command("submission.prepare", prefix + "-prepare", {
                                "draft_id": draft_id, "submission_id": prefix + "-submission", "send_operation_id": prefix + "-send"},
                                {"topic_id": topic_id}, {"draft_revision": 1})
                            created.append(command("topic.create_and_send", prefix + "-send", {"submission_id": prefix + "-submission"}, {"topic_id": topic_id}))
                        answer = created
                    elif freshness and request["method"] == "navigation_workspaces":
                        answer = [command("workspace.create", "navigation-workspace-" + item["id"], item)
                                  for item in request["workspaces"]]
                    elif freshness and request["method"] == "agent_message":
                        answer = agent_message(request)
                    elif freshness and request["method"] == "memory_revise":
                        answer = command("memory.revise", request["operation_id"], {
                            "title": request["title"], "body": request["body"], "attachments": [], "references": []},
                            {"item_id": request["item_id"]}, {"item_revision": request["expected_revision"]},
                            sender="fixture-notebook-agent")
                    elif freshness and request["method"] == "seed":
                        seed_number += 1
                        prefix = "freshness-seed-%d" % seed_number
                        message_ids, item_ids = [], []
                        for n in range(request.get("messages", 0)):
                            result = agent_message({"operation_id": prefix + "-message-%d" % n,
                                                    "body": "Incoming fixture message %d" % n})
                            message_ids.append(result["result"]["message_id"])
                        for n in range(request.get("memory_items", 0)):
                            item_id = prefix + "-item-%d" % n
                            command("memory.create", prefix + "-create-%d" % n, {
                                "title": "Fixture item %d" % n, "body": "Fixture Notebook body %d" % n,
                                "attachments": [], "references": []},
                                {"item_id": item_id, "owner_scope": {"kind": "topic", "id": "t1"}},
                                {"item_revision": 0}, sender="fixture-notebook-agent")
                            item_ids.append(item_id)
                        # Query-scale fixture only: these are unrelated change
                        # records, not claimed agent commands/messages.
                        with sqlite3.connect(str(path)) as db:
                            db.executemany("INSERT INTO changes(scope_kind,scope_id,resource_kind,resource_id,version) VALUES ('actor','fixture-unrelated','draft',?,1)",
                                           [(prefix + "-unrelated-%d" % n,) for n in range(request.get("unrelated_records", 0))])
                            unrelated = db.execute("SELECT count(*) FROM changes WHERE scope_id='fixture-unrelated'").fetchone()[0]
                        answer = {"message_ids": message_ids, "item_ids": item_ids, "unrelated_changes": unrelated}
                    elif request["method"] == "epoch":
                        # Test-only controlled history boundary. No activation
                        # claim: the real runtime cutover is lead-owned.
                        anchor = Path(binding["authority_path"])
                        fd = os.open(str(anchor) + ".lock", os.O_RDWR)
                        try:
                            fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
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
                    else:
                        raise ValueError("Unknown private fixture control")
                    print(json.dumps({"id": request["id"], "answer": answer}), flush=True)
                except Exception as error:
                    print(json.dumps({"id": request["id"], "failure": str(error)}), flush=True)
        finally:
            if controls is not None:
                controls.close()
            server.shutdown()
            server.server_close()
            thread.join(2)
            assert not thread.is_alive(), "Owned HTTP fixture did not close"
            if controls is not None:
                controls.assert_healthy()


if __name__ == "__main__":
    main()

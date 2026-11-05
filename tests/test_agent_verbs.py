from __future__ import annotations

"""The everyday CLI verbs, run against temporary profiles and records only."""

import io
import json
import os
from pathlib import Path
import selectors
import signal
import sqlite3
import subprocess
import sys
import types
import unittest
from unittest import mock

from aim_next import Store
from aim_next import cli
from aim_next.contract import StoreError
from aim_next.effects_watch import WatchError
from aim_next.profile import load_profile
import test_agent_cli


ROOT = Path(__file__).resolve().parents[1]


class AgentVerbCase(test_agent_cli.AgentCLIBase):
    def run_cli(self, *argv, actor="agent-a", stdin=b""):
        stdout, stderr = io.StringIO(), io.StringIO()
        code = cli.main(["--profile", str(self.profiles[actor])] + list(argv),
                        stdin=io.BytesIO(stdin), stdout=stdout, stderr=stderr)
        return code, stdout.getvalue(), stderr.getvalue()

    def outbox(self, actor="agent-a"):
        return Path(self.temp.name).resolve() / (actor + ".outbox")

    def saved(self, actor="agent-a"):
        directory = self.outbox(actor)
        return sorted(path.name for path in directory.iterdir()) if directory.exists() else []

    def latest(self, topic="t1"):
        return self.sql("SELECT id,seq,author_id,body,addressees,reply_to FROM messages WHERE topic_id=? ORDER BY seq DESC LIMIT 1", (topic,))[0]


class PostAndOutboxCase(AgentVerbCase):
    def test_post_saves_the_request_before_dispatch_and_the_receipt_after(self):
        seen = []
        original = Store.command

        def command(store, actor, envelope):
            # The request already sits in the outbox when Core receives it,
            # and no receipt exists yet.
            seen.append(self.saved())
            return original(store, actor, envelope)
        with mock.patch.object(Store, "command", command):
            code, out, err = self.run_cli("post", "t1", "--to", "owner", "Hello from the CLI")
        self.assertEqual((code, err), (0, ""))
        message = self.latest()
        self.assertEqual(message[2:5], ("agent-a", "Hello from the CLI", '["owner"]'))
        self.assertEqual(out, "posted %s in t1 (1 deliveries queued)\n" % message[0])
        [request] = seen[0]
        operation = request[:-len(".request.json")]
        self.assertTrue(request.endswith(".request.json"))
        self.assertEqual(self.saved(), [operation + ".receipt.json", request])
        saved = json.loads((self.outbox() / request).read_text())
        self.assertEqual(saved["binding"], self.captured)
        self.assertEqual(saved["command"]["kind"], "message.post")
        self.assertEqual(saved["command"]["args"], {"body": "Hello from the CLI", "addressees": ["owner"]})
        receipt = json.loads((self.outbox() / (operation + ".receipt.json")).read_text())
        self.assertEqual(receipt, self.store.view("agent-a", "operation", {"operation_id": operation}))
        # The saved request is also a valid legacy command request.
        self.assertEqual(self.invoke("command", request_path=self.outbox() / request, value=None)[:2], (0, receipt))

    def test_unrecorded_post_keeps_its_request_and_retry_sends_it_unchanged(self):
        blocker = sqlite3.connect(str(self.path), isolation_level=None)
        self.addCleanup(blocker.close)
        blocker.execute("BEGIN IMMEDIATE")
        code, out, err = self.run_cli("post", "t1", "-", stdin="Through stdin é\n".encode("utf-8"))
        self.assertEqual(code, 75)
        self.assertIn("DATABASE_BUSY", err)
        [request] = self.saved()
        operation = request[:-len(".request.json")]
        self.assertIn("retry " + operation, err)
        blocker.rollback()
        count = self.sql("SELECT count(*) FROM messages")[0][0]
        code, out, err = self.run_cli("retry", operation)
        self.assertEqual((code, err), (0, ""))
        self.assertEqual(out, "recorded %s (message.post)\n" % operation)
        self.assertEqual(self.latest()[3], "Through stdin é\n")
        code, out, _ = self.run_cli("--json", "retry", operation)
        self.assertEqual(code, 0)
        self.assertEqual(json.loads(out), self.store.view("agent-a", "operation", {"operation_id": operation}))
        self.assertEqual(self.sql("SELECT count(*) FROM messages")[0][0], count + 1)
        self.assertEqual(self.saved(), [operation + ".receipt.json", request])

    def test_refusals_are_recorded_and_reported_with_their_exit(self):
        code, out, err = self.run_cli("post", "t1", "--to", "outsider", "Nobody can reply")
        self.assertEqual((code, out), (2, ""))
        self.assertIn("rejected REPLY_PATH_UNAVAILABLE", err)
        self.assertEqual(len(self.saved()), 2)
        code, out, err = self.run_cli("retry", "../escape")
        self.assertEqual(code, 2)
        code, out, err = self.run_cli("retry", "cli-never-saved")
        self.assertEqual((code, out), (2, ""))
        self.assertIn("INVALID_REQUEST", err)
        code, out, err = self.run_cli("--json", "retry", "cli-never-saved")
        self.assertEqual((code, json.loads(out)["error"]["code"], err), (2, "INVALID_REQUEST", ""))
        code, out, err = self.run_cli("post", "t1", "--outbox", "relative", "x")
        self.assertEqual(code, 2)
        # The legacy verbs are unchanged and take none of the new options.
        self.assertEqual(self.run_cli("--json", "binding")[0], 2)
        self.assertEqual(json.loads(self.run_cli("binding")[1]), {"v": 1, "binding": self.captured})

    def test_a_final_unrecorded_refusal_is_not_offered_for_retry(self):
        code, out, err = self.run_cli("post", "t1", "--to", "x" * 201, "Never sendable")
        self.assertEqual((code, out), (2, ""))
        [request] = self.saved()
        operation = request[:-len(".request.json")]
        self.assertEqual(err, "not recorded INVALID_ARGUMENT: Invalid addressee (operation %s)\n" % operation)
        # A reply context that cannot exist is a recorded refusal.
        code, out, err = self.run_cli("post", "t1", "--reply-to", "m-missing", "Replying to nothing")
        self.assertEqual(code, 2)
        self.assertIn("rejected INVALID_REPLY", err)
        self.assertNotIn("retry", err)

    def test_an_unconfirmed_post_names_its_operation_for_retry(self):
        original = Store.command
        for failure, exit_code, prefix in ((KeyboardInterrupt(), 130, "CLI_INTERRUPTED"),
                                           (StoreError("lost"), 1, "CLI_REQUEST_UNCONFIRMED")):
            with self.subTest(failure=prefix):
                def command(store, actor, envelope):
                    original(store, actor, envelope)
                    raise failure
                body = "Hello once " + prefix
                with mock.patch.object(Store, "command", command):
                    code, out, err = self.run_cli("post", "t1", body)
                self.assertEqual((code, out), (exit_code, ""))
                [operation] = [name[:-len(".request.json")] for name in self.saved() if name.endswith(".request.json")
                               and json.loads((self.outbox() / name).read_text())["command"]["args"]["body"] == body]
                self.assertEqual(err, "%s: operation %s may be recorded; `retry %s` returns its outcome without sending it twice.\n" % (
                    prefix, operation, operation))
                code, out, err = self.run_cli("retry", operation)
                self.assertEqual((code, out, err), (0, "recorded %s (message.post)\n" % operation, ""))
                self.assertEqual(self.sql("SELECT count(*) FROM messages WHERE body=?", (body,)), [(1,)])

    def test_output_lost_after_the_receipt_names_its_operation(self):
        class Broken(io.StringIO):
            def write(self, text):
                raise OSError("closed")
        stderr = io.StringIO()
        code = cli.main(["--profile", str(self.profiles["agent-a"]), "post", "t1", "Printed nowhere"],
                        stdin=io.BytesIO(b""), stdout=Broken(), stderr=stderr)
        self.assertEqual(code, 1)
        [receipt] = [name for name in self.saved() if name.endswith(".receipt.json")]
        operation = receipt[:-len(".receipt.json")]
        self.assertEqual(stderr.getvalue(), "CLI_OUTPUT_UNCONFIRMED: operation %s may be recorded; "
                         "`retry %s` returns its outcome without sending it twice.\n" % (operation, operation))

    def test_retry_sends_only_a_request_saved_for_this_binding(self):
        blocker = sqlite3.connect(str(self.path), isolation_level=None)
        self.addCleanup(blocker.close)
        blocker.execute("BEGIN IMMEDIATE")
        self.assertEqual(self.run_cli("post", "t1", "Saved by agent-a")[0], 75)
        blocker.rollback()
        [request] = self.saved()
        operation = request[:-len(".request.json")]
        self.outbox("agent-b").mkdir(mode=0o700)
        (self.outbox("agent-b") / request).write_bytes((self.outbox() / request).read_bytes())
        before = self.records()
        code, out, err = self.run_cli("retry", operation, actor="agent-b")
        self.assertEqual((code, out), (2, ""))
        self.assertIn("BINDING_MISMATCH", err)
        self.assertEqual(self.records(), before)
        # --json reports the CLI's own refusal as a result line, not silence.
        code, out, err = self.run_cli("--json", "retry", operation, actor="agent-b")
        self.assertEqual((code, err), (2, ""))
        self.assertEqual(json.loads(out)["error"]["code"], "BINDING_MISMATCH")
        self.assertEqual(self.records(), before)

    def test_unwritable_outbox_sends_nothing(self):
        blocked = Path(self.temp.name) / "not-a-directory"
        blocked.write_text("")
        before = self.records()
        code, out, err = self.run_cli("--outbox", str(blocked), "post", "t1", "Never sent")
        self.assertEqual(code, 1)
        self.assertIn("CLI_OUTBOX_UNAVAILABLE", err)
        self.assertEqual(self.records(), before)


class ReadingVerbCase(AgentVerbCase):
    def post(self, actor, body, topic="t1", **args):
        receipt = self.store.command(actor, self.envelope("message.post", {"topic_id": topic}, dict(args, body=body)))
        return self.committed(receipt)["message_id"]

    def test_outcomes_topics_read_and_inbox(self):
        self.committed(self.command("opening.save", {"workspace_id": "w1", "topic_id": "t0", "title": "Older topic",
            "participants": ["agent-a"], "body": "Quiet", "attachments": []}, target={"opening_id": "o0"},
            expected={"opening_revision": 0}))
        self.committed(self.command("opening.publish", {}, target={"opening_id": "o0"}, expected={"opening_revision": 1}))
        long_body = "Line one\n" + "x" * 2000
        long_id = self.post("owner", long_body)
        code, out, _ = self.run_cli("outcomes")
        self.assertEqual((code, out), (0, "w1  Isolated test  (owner owner)\n"))
        code, out, _ = self.run_cli("topics", "w1")
        self.assertEqual(code, 0)
        self.assertEqual([line.split("  ")[0] for line in out.splitlines()], ["t1", "t0"])
        code, out, _ = self.run_cli("read", "t1")
        self.assertEqual(code, 0)
        seq = self.sql("SELECT seq FROM messages WHERE id=?", (long_id,))[0][0]
        self.assertIn("#%s %s owner\n  Line one\n  %s\n" % (seq, long_id, "x" * 2000), out)
        self.assertTrue(out.startswith("t1  Topic\n"))
        code, out, _ = self.run_cli("read", "t1", "--after", str(seq))
        self.assertEqual(out, "t1  Topic\nno messages after #%s\n" % seq)
        code, out, _ = self.run_cli("read", "t1", "--limit", "1")
        self.assertIn("more after #", out)
        code, out, _ = self.run_cli("inbox")
        self.assertEqual(code, 0)
        lines = out.splitlines()
        items = sorted(self.store.view("agent-a", "deliveries", {})["items"], key=lambda item: item["seq"])
        self.assertEqual(len(lines), len(items))
        self.assertTrue(lines[-1].startswith('delivery "Topic" #%s owner: Line one xxx' % seq), lines[-1])
        self.assertTrue(lines[-1].endswith("[%s in t1]" % items[-1]["id"]))
        code, out, _ = self.run_cli("--json", "inbox")
        self.assertEqual(json.loads(out.splitlines()[0])["items"][0]["topic"]["title"], items[0]["topic"]["title"])
        code, out, err = self.run_cli("read", "t-missing")
        self.assertEqual((code, out), (2, ""))
        self.assertIn("FORBIDDEN", err)

    def test_plain_output_escapes_control_characters_from_other_actors(self):
        body = "\x1b]0;owned\x07hello \x1b[2J\x9b31m\nsecond\r#9 m-fake owner\ttabbed"
        self.post("owner", body, addressees=["agent-a"])
        for verb in ("read", "inbox"):
            with self.subTest(verb=verb):
                code, out, _ = self.run_cli(*((verb, "t1") if verb == "read" else (verb,)))
                self.assertEqual(code, 0)
                for control in ("\x1b", "\x07", "\r", "\x9b"):
                    self.assertNotIn(control, out)
                self.assertIn("\\x1b]0;owned\\x07hello \\x1b[2J\\x9b31m", out)
        code, out, _ = self.run_cli("read", "t1")
        self.assertIn("\n  second\\x0d#9 m-fake owner\ttabbed\n", out)
        code, out, _ = self.run_cli("--json", "inbox")
        self.assertNotIn("\x9b", out)
        self.assertIn(body, [item["message"]["body"] for item in json.loads(out)["items"]])

    def test_start_names_its_opening_and_publish_finishes_it(self):
        blocker = sqlite3.connect(str(self.path), isolation_level=None)
        self.addCleanup(blocker.close)
        blocker.execute("BEGIN IMMEDIATE")
        code, out, err = self.run_cli("start", "w1", "--title", "Resumed", "--with", "agent-b", "Opening words")
        self.assertEqual((code, out), (75, ""))
        [request] = self.saved()
        saved = json.loads((self.outbox() / request).read_text())["command"]
        opening, topic = saved["target"]["opening_id"], saved["args"]["topic_id"]
        self.assertIn("retry %s" % saved["operation_id"], err)
        self.assertIn("start: opening %s will start topic %s; once its save is recorded, `publish %s` starts it." % (
            opening, topic, opening), err)
        blocker.rollback()
        self.assertEqual(self.run_cli("retry", saved["operation_id"])[0], 0)
        self.assertEqual(self.sql("SELECT count(*) FROM topics WHERE id=?", (topic,)), [(0,)])
        code, out, err = self.run_cli("publish", opening)
        self.assertEqual((code, err), (0, ""))
        message = self.sql("SELECT id FROM messages WHERE topic_id=?", (topic,))[0][0]
        self.assertEqual(out, 'started %s "Resumed" in w1 with %s\n' % (topic, message))
        self.assertEqual(self.sql("SELECT actor_id FROM topic_participants WHERE topic_id=? ORDER BY actor_id", (topic,)),
                         [("agent-a",), ("agent-b",)])
        self.assertEqual(self.run_cli("publish", opening), (0, "already published %s as %s with %s\n" % (opening, topic, message), ""))
        code, out, err = self.run_cli("publish", "o-unknown")
        self.assertEqual((code, out), (2, ""))
        self.assertIn("FORBIDDEN", err)

    def test_start_ack_and_read_through(self):
        code, out, err = self.run_cli("start", "w1", "--title", "Fresh topic", "--with", "agent-b, owner", "Opening words",
                                      actor="agent-a")
        self.assertEqual((code, err), (0, ""))
        topic = out.split()[1]
        self.assertEqual(self.sql("SELECT title,creator_id FROM topics WHERE id=?", (topic,)), [("Fresh topic", "agent-a")])
        self.assertEqual(self.sql("SELECT actor_id FROM topic_participants WHERE topic_id=? ORDER BY actor_id", (topic,)),
                         [("agent-a",), ("agent-b",), ("owner",)])
        self.assertEqual(len(self.saved()), 4)
        first = self.post("agent-b", "One", topic=topic)
        self.post("agent-b", "Two", topic=topic)
        pending = sorted(self.store.view("owner", "deliveries", {})["items"], key=lambda item: item["seq"])
        in_topic = [item for item in pending if item["message"]["topic_id"] == topic]
        self.assertEqual(len(in_topic), 3)
        first_seq = self.sql("SELECT seq FROM messages WHERE id=?", (first,))[0][0]
        self.profiles["owner"] = Path(self.temp.name).resolve() / "owner.json"
        test_agent_cli.write_profile(self.profiles["owner"], str(self.path.resolve()), "test-instance", "owner", binding=self.binding)
        code, out, _ = self.run_cli("read-through", topic, str(first_seq), actor="owner")
        self.assertEqual((code, out), (0, "read %s through #%s (2 acknowledged)\n" % (topic, first_seq)))
        remaining = self.store.view("owner", "deliveries", {})["items"]
        self.assertEqual([item["message"]["topic_id"] == topic for item in remaining].count(True), 1)
        other = [item["id"] for item in remaining]
        code, out, err = self.run_cli("ack", "d-missing", other[0], actor="owner")
        self.assertEqual(code, 2)
        self.assertEqual(out, "acknowledged %s\n" % other[0])
        self.assertIn("rejected FORBIDDEN", err)
        code, out, _ = self.run_cli("ack", other[0], actor="owner")
        self.assertEqual((code, out), (0, "already acknowledged %s\n" % other[0]))


class FakeWatch:
    """The watch's events, given in order; a stop is what a signal would set."""

    def __init__(self, *events):
        self.events, self.stopped, self.companion_moved = list(events), False, False

    def wait(self, timeout):
        return self.events.pop(0)


class WatchReadingCase(AgentVerbCase):
    def agent(self, actor="agent-b", as_json=False):
        self.stdout, self.stderr = io.StringIO(), io.StringIO()
        options = types.SimpleNamespace(profile=str(self.profiles[actor]), outbox=None, outbox_after=None)
        return cli.Agent(load_profile(self.profiles[actor]), options, None, cli.Lines(self.stdout, self.stderr, as_json))

    def test_a_stop_ends_the_watch_while_the_database_stays_locked(self):
        agent = self.agent()
        watch = FakeWatch(dict(dirty=True, stop=False))
        reads = []
        original = agent.store.view

        def view(actor, name, args):
            result = original(actor, name, args)
            reads.append(result.get("error", {}).get("code"))
            if result.get("error", {}).get("code") == "DATABASE_BUSY":
                watch.stopped = True  # SIGTERM arrives while the lock is held
            if reads.count("DATABASE_BUSY") > 3:
                raise AssertionError("the watch kept reading after it was stopped")
            return result
        agent.store.view = view
        blocker = sqlite3.connect(str(self.path), isolation_level=None)
        self.addCleanup(blocker.close)
        original_wait = watch.wait

        def wait(timeout):
            blocker.execute("BEGIN EXCLUSIVE")
            return original_wait(timeout)
        watch.wait = wait
        agent.watch_changes(watch)
        self.assertTrue(blocker.in_transaction, "the lock was never released")
        blocker.rollback()
        self.assertEqual(reads, [None, "DATABASE_BUSY"])
        self.assertEqual(self.stdout.getvalue(), "watching agent-b from change %s\n" % self.store.view(
            "agent-b", "changes", {"scope": {"kind": "actor", "id": "agent-b"}})["checkpoint"]["after_seq"])

    def delivery_change(self, agent, body, **args):
        cursor = agent.changes(FakeWatch(), None)["checkpoint"]
        self.run_cli("post", "t1", "--to", "agent-b", body, **args)
        [change] = [item for item in agent.changes(FakeWatch(), cursor)["items"] if item["resource_kind"] == "delivery"]
        return change

    def test_a_busy_delivery_read_still_prints_its_notice(self):
        agent = self.agent()
        change = self.delivery_change(agent, "Busy notice")
        original, busy = agent.store.view, []

        def view(actor, name, args):
            if name == "delivery" and not busy:
                busy.append(name)
                return {"instance_id": "test-instance", "error": {"code": "DATABASE_BUSY", "message": "Read is temporarily unavailable", "retryable": True}}
            return original(actor, name, args)
        agent.store.view = view
        agent.report(FakeWatch(), change)
        message = self.latest()
        self.assertEqual(busy, ["delivery"])
        self.assertEqual(self.stdout.getvalue(), 'delivery "Topic" #%s agent-a: Busy notice  [%s in t1]\n' % (message[1], change["resource_id"]))

    def test_an_unreadable_delivery_is_named_without_its_content(self):
        agent = self.agent()
        change = self.delivery_change(agent, "Gone before the watch read it")
        agent.store.view = lambda actor, name, args: {"instance_id": "test-instance",
                                                      "error": {"code": "FORBIDDEN", "message": "No readable delivery", "retryable": False}}
        agent.report(FakeWatch(), change)
        self.assertEqual(self.stdout.getvalue(), "delivery unavailable (FORBIDDEN)  [%s]\n" % change["resource_id"])

    def test_json_watch_refusals_are_result_lines(self):
        for patch, code in ((mock.patch.object(cli, "NativeWatch", side_effect=WatchError("watch_unavailable")), "WATCH_UNAVAILABLE"),
                            (mock.patch.object(cli.Agent, "watch_changes", side_effect=WatchError("watch_wait_failed")), "WATCH_FAILED")):
            with self.subTest(code=code):
                with patch:
                    result, out, err = self.run_cli("--json", "watch", actor="agent-b")
                self.assertEqual((result, err), (2, ""))
                self.assertEqual(json.loads(out)["error"]["code"], code)


class WatchVerbCase(AgentVerbCase):
    def readline(self, process, selector):
        # A guard against a hang only; the watch itself never waits on a timer.
        if not selector.select(30):
            self.fail("the watch printed nothing")
        return process.stdout.readline().decode("utf-8")

    def test_watch_prints_each_new_delivery_from_another_process(self):
        prefix = os.environ.get("PYTHONPYCACHEPREFIX")
        interpreter = [sys.executable, "-I"] + (["-X", "pycache_prefix=" + prefix] if prefix else [])
        process = subprocess.Popen(interpreter + [str(ROOT / "bin" / "aim-next"), "--profile", str(self.profiles["agent-b"]), "watch"],
                                   stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        stopped = False
        try:
            selector = selectors.DefaultSelector()
            self.addCleanup(selector.close)
            selector.register(process.stdout, selectors.EVENT_READ)
            self.assertTrue(self.readline(process, selector).startswith("watching agent-b from change "))
            code, out, _ = self.run_cli("post", "t1", "--to", "agent-b", "Watch for this\nsecond line")
            self.assertEqual(code, 0, out)
            message = self.latest()
            delivery = self.sql("SELECT id FROM deliveries WHERE message_id=? AND recipient_id='agent-b'", (message[0],))[0][0]
            self.assertEqual(self.readline(process, selector),
                             'delivery "Topic" #%s agent-a: Watch for this second line  [%s in t1]\n' % (message[1], delivery))
            # A write that is not this actor's change prints nothing; the next
            # line is the acknowledgment that follows it.
            self.run_cli("post", "t1", "Not for agent-b")
            self.assertEqual(self.run_cli("ack", delivery, actor="agent-b")[0], 0)
            self.assertEqual(self.readline(process, selector), "acknowledged %s\n" % delivery)
            process.send_signal(signal.SIGTERM)
            stopped = True
            self.assertEqual(process.wait(30), 0)
            self.assertEqual(process.stdout.read(), b"")
            self.assertEqual(process.stderr.read(), b"")
        finally:
            if not stopped:
                process.kill()
            process.wait()
            process.stdout.close()
            process.stderr.close()

    def test_watch_ends_with_the_refusal_when_the_authority_moves(self):
        prefix = os.environ.get("PYTHONPYCACHEPREFIX")
        interpreter = [sys.executable, "-I"] + (["-X", "pycache_prefix=" + prefix] if prefix else [])
        process = subprocess.Popen(interpreter + [str(ROOT / "bin" / "aim-next"), "--profile", str(self.profiles["agent-b"]), "watch"],
                                   stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        ended = False
        try:
            selector = selectors.DefaultSelector()
            self.addCleanup(selector.close)
            selector.register(process.stdout, selectors.EVENT_READ)
            self.assertTrue(self.readline(process, selector).startswith("watching agent-b from change "))
            # A recovery activation publishes a new epoch by replacing the
            # anchor, and never writes the old database again.
            anchor = Path(self.binding["authority_path"])
            record = json.loads(anchor.read_text())
            replacement = anchor.parent / ".replacement"
            fd = os.open(str(replacement), os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
            with os.fdopen(fd, "w") as stream:
                stream.write(json.dumps(dict(record, epoch="e-recovered")) + "\n")
            os.replace(str(replacement), str(anchor))
            self.assertEqual(self.run_cli("post", "t1", "--to", "agent-b", "Refused at the fence")[0], 2)
            self.assertEqual(process.wait(30), 2)
            ended = True
            self.assertEqual(process.stdout.read(), b"")
            self.assertIn(b"AUTHORITY_CHANGED", process.stderr.read())
        finally:
            if not ended:
                process.kill()
            process.wait()
            process.stdout.close()
            process.stderr.close()


if __name__ == "__main__":
    unittest.main()

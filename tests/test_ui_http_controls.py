from __future__ import annotations

import fcntl
import http.client
import json
import os
import select
import subprocess
import sys
import tempfile
import threading
import unittest
from pathlib import Path
from urllib.parse import urlsplit

FIXTURE = Path(__file__).resolve().parent / "fixtures" / "ui_http.py"

# Runs the fixture unchanged, and reports on a private pipe each time the
# fixture's own code enters and leaves an exclusive flock, with the inode of
# the file it locks, and each time the fixture's own code waits on a
# condition. The Store's locks and waits go through unreported. A command
# whose operation id starts "held-" (or a reset of the draft "held-draft") is
# reported as it reaches the Store and when it has been handled, and in
# between is held until a byte comes on the second pipe: a save the server, or
# the fixture, is still handling. One whose id starts "late-" is reported as it
# reaches the Store.
OBSERVED = """
import fcntl, os, runpy, sys, threading
from aim_next import store
marks, go, fixture = int(sys.argv[1]), int(sys.argv[2]), sys.argv[3]
command = store.Store.command
def held_command(self, actor, envelope):
    held = str(envelope.get("operation_id", "")).startswith(("held-", "fixture-reset-held-draft-"))
    if str(envelope.get("operation_id", "")).startswith("late-"):
        os.write(marks, b"reached\\n")
    if held:
        os.write(marks, b"held\\n")
        os.read(go, 1)
    try:
        return command(self, actor, envelope)
    finally:
        if held:
            os.write(marks, b"handled\\n")
store.Store.command = held_command
wait = threading.Condition.wait
def observed_wait(self, timeout=None):
    if sys._getframe(1).f_code.co_filename == fixture:
        os.write(marks, b"waiting\\n")
    return wait(self, timeout)
threading.Condition.wait = observed_wait
real = fcntl.flock
def flock(fd, operation):
    ours = sys._getframe(1).f_code.co_filename == fixture and operation & fcntl.LOCK_EX
    if ours:
        inode = os.fstat(fd if isinstance(fd, int) else fd.fileno()).st_ino
        os.write(marks, b"entered %d\\n" % inode)
    try:
        return real(fd, operation)
    finally:
        if ours:
            os.write(marks, b"returned\\n")
fcntl.flock = flock
sys.argv = [fixture] + sys.argv[4:]
runpy.run_path(fixture, run_name="__main__")
"""


class ImagesFixtureControls(unittest.TestCase):
    """The --images fixture's private controls, through its real stdin and HTTP."""

    ARGS = ("--images",)

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.stderr = open(Path(self.tmp.name) / "stderr.log", "w+")
        self.marks, write = os.pipe()
        held, self.go = os.pipe()
        # The fixture makes its instance under TMPDIR, so this test finds its
        # authority lock without the fixture having to publish a path.
        env = dict(os.environ, TMPDIR=self.tmp.name)
        self.process = subprocess.Popen(
            [sys.executable, "-c", OBSERVED, str(write), str(held), str(FIXTURE), *self.ARGS],
            stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=self.stderr, text=True, bufsize=1,
            pass_fds=(write, held), env=env, cwd=str(FIXTURE.parents[2]))
        os.close(write)
        os.close(held)
        self.counter = 0
        self.ready = self.control("ready")

    def tearDown(self):
        # Private stdin EOF closes the fixture's server and instance.
        self.process.stdin.close()
        self.process.wait(timeout=5)
        self.process.stdout.close()
        os.close(self.marks)
        os.close(self.go)
        self.stderr.seek(0)
        errors = self.stderr.read()
        self.stderr.close()
        self.assertEqual(self.process.returncode, 0, errors)
        self.assertEqual(errors, "")
        self.tmp.cleanup()

    def send(self, method, **args):
        self.counter += 1
        self.process.stdin.write(json.dumps(dict(args, method=method, id=self.counter)) + "\n")
        self.process.stdin.flush()

    def answer(self):
        self.assertTrue(select.select([self.process.stdout], [], [], 10)[0], "Fixture control did not answer")
        answer = json.loads(self.process.stdout.readline())
        self.assertEqual(answer["id"], self.counter)
        self.assertNotIn("failure", answer)
        return answer["answer"]

    def control(self, method, **args):
        self.send(method, **args)
        return self.answer()

    def mark(self):
        # Byte by byte, so one read never takes a later mark with it.
        line = b""
        while not line.endswith(b"\n"):
            self.assertTrue(select.select([self.marks], [], [], 10)[0], "The fixture never reached its lock")
            line += os.read(self.marks, 1)
        return line.decode().strip()

    def http(self, path, payload):
        url = urlsplit(self.ready["origin"])
        conn = http.client.HTTPConnection(url.hostname, url.port, timeout=3)
        try:
            conn.request("POST", path, json.dumps(payload), {
                "Authorization": "Bearer " + self.ready["token"], "Origin": self.ready["origin"],
                "Content-Type": "application/json", "X-AIM-Read-Class": "foreground"})
            response = conn.getresponse()
            return response.status, json.loads(response.read())
        finally:
            conn.close()

    def view(self, name, args):
        status, answer = self.http("/api/view", {"name": name, "args": args})
        self.assertEqual(status, 200, answer)
        return answer

    def authority(self):
        return self.view("capabilities", {})["authority"]

    def test_reset_empties_a_draft_that_holds_only_reply_fields(self):
        self.assertEqual(self.control("reset_drafts"), [], "the seeded drafts start empty")
        source = self.ready["sources"][1]
        draft_id, generation, revision = "controls-draft", "controls-generation", 0
        held = (("reply_to", source["id"]), ("exchange_id", "controls-exchange"),
                ("opening", {"workspace_id": "w1", "title": "Held opening", "participants": []}), ("caret", 0))
        for name, value in held:
            authority = self.authority()
            status, receipt = self.http("/api/command", {
                "v": 1, "instance_id": self.ready["instance_id"], "kind": "draft.save",
                "operation_id": "controls-save-%s" % name, "target": {"draft_id": draft_id},
                "expected": {"draft_revision": revision, "authority": {
                    key: authority[key] for key in ("authority_id", "authority_epoch")}},
                "args": {"source_ref": source, "topic_id": "t1", "generation": generation, "body": "", name: value}})
            self.assertEqual((status, receipt["status"]), (200, "committed"), receipt)
            draft = self.view("editor_state", {"source_ref": source, "topic_id": "t1"})["draft"]
            self.assertEqual(draft[name], value, "the draft holds only %s" % name)
            self.assertEqual(self.control("reset_drafts"), [draft_id], "a draft holding only %s is reset" % name)
            draft = self.view("editor_state", {"source_ref": source, "topic_id": "t1"})["draft"]
            self.assertNotIn(name, draft)
            self.assertEqual(draft["generation"], generation, "the reset keeps the draft's generation")
            revision = draft["revision"]
        self.assertEqual(self.control("reset_drafts"), [], "an empty draft is left as it is")

    def test_reset_waits_for_a_save_the_server_is_still_handling(self):
        # A save the server took and has not finished, as a page closed while
        # its save was on the way leaves behind. The reset reads no draft until
        # it has landed, then empties what it wrote.
        source = self.ready["sources"][1]
        authority = self.authority()
        saved = []
        sender = threading.Thread(target=lambda: saved.append(self.http("/api/command", {
            "v": 1, "instance_id": self.ready["instance_id"], "kind": "draft.save",
            "operation_id": "held-save", "target": {"draft_id": "in-flight-draft"},
            "expected": {"draft_revision": 0, "authority": {key: authority[key] for key in ("authority_id", "authority_epoch")}},
            "args": {"source_ref": source, "topic_id": "t1", "generation": "held-generation", "body": "Words a closed page saved"}})))
        sender.start()
        try:
            self.assertEqual(self.mark(), "held")
            self.send("reset_drafts")
            # Whichever comes first: the reset waiting, or its answer.
            ready = select.select([self.marks, self.process.stdout], [], [], 10)[0]
            self.assertEqual(ready, [self.marks], "the reset waited for the save in flight before reading the drafts")
            self.assertEqual(self.mark(), "waiting")
        finally:
            os.write(self.go, b"g")
            sender.join()
        self.assertEqual(self.mark(), "handled")
        self.assertEqual([(status, receipt["status"]) for status, receipt in saved], [(200, "committed")], saved)
        self.assertEqual(self.answer(), ["in-flight-draft"], "the reset emptied what the save wrote")
        draft = self.view("editor_state", {"source_ref": source, "topic_id": "t1"})["draft"]
        self.assertEqual((draft["id"], draft["body"], draft["revision"]), ("in-flight-draft", "", 2))
        # With nothing in flight it waits for nothing.
        self.assertEqual(self.control("reset_drafts"), [])

    def test_a_save_that_comes_in_during_a_reset_waits_and_meets_its_revision(self):
        # A page's save that reaches the server while the reset writes waits
        # for it, then is refused at the revision it read before the reset.
        source = self.ready["sources"][1]
        authority = {key: self.authority()[key] for key in ("authority_id", "authority_epoch")}
        def save(operation, revision, body):
            return self.http("/api/command", {
                "v": 1, "instance_id": self.ready["instance_id"], "kind": "draft.save",
                "operation_id": operation, "target": {"draft_id": "held-draft"},
                "expected": {"draft_revision": revision, "authority": authority},
                "args": {"source_ref": source, "topic_id": "t1", "generation": "held-generation", "body": body}})
        status, receipt = save("first-save", 0, "Words before the reset")
        self.assertEqual((status, receipt["status"]), (200, "committed"), receipt)
        self.send("reset_drafts")
        late = []
        sender = threading.Thread(target=lambda: late.append(save("late-save", 1, "Words after the reset")))
        try:
            self.assertEqual(self.mark(), "held", "the reset's own save reached the Store")
            sender.start()
            self.assertEqual(self.mark(), "waiting", "the page's save waits while the reset writes")
        finally:
            os.write(self.go, b"g")
        self.assertEqual(self.mark(), "handled")
        self.assertEqual(self.mark(), "reached", "the page's save reached the Store once the reset was done")
        self.assertEqual(self.answer(), ["held-draft"])
        sender.join()
        self.assertEqual([(status, receipt["status"], receipt["error"]["code"], receipt["error"]["current_versions"]) for status, receipt in late],
                         [(200, "rejected", "REVISION_CONFLICT", {"draft_revision": 2})], late)
        draft = self.view("editor_state", {"source_ref": source, "topic_id": "t1"})["draft"]
        self.assertEqual((draft["body"], draft["revision"]), ("", 2))

    def test_epoch_waits_for_a_request_holding_the_authority_shared(self):
        locks = list(Path(self.tmp.name).glob("aim-ux-http-*/control/authority.json.lock"))
        self.assertEqual(len(locks), 1, locks)
        anchor = Path(str(locks[0])[:-len(".lock")])
        before = json.loads(anchor.read_text())["epoch"]
        held = os.open(str(locks[0]), os.O_RDWR)
        try:
            # As a request in flight does: the authority held shared.
            fcntl.flock(held, fcntl.LOCK_SH)
            self.send("epoch", epoch="controls-epoch-2", complete=False)
            # The same file this test holds shared, so the lock can only be
            # granted once the test lets it go.
            self.assertEqual(self.mark(), "entered %d" % os.fstat(held).st_ino,
                             "the control reached its exclusive lock on the authority lock this test holds shared")
        finally:
            fcntl.flock(held, fcntl.LOCK_UN)
            os.close(held)
        self.assertEqual(self.mark(), "returned")
        capabilities = self.answer()
        self.assertEqual(capabilities["authority"]["authority_epoch"], "controls-epoch-2")
        self.assertNotEqual(before, "controls-epoch-2")
        self.assertEqual(json.loads(anchor.read_text())["epoch"], "controls-epoch-2")



class SourceFixtureControls(ImagesFixtureControls):
    """The live fixture's agent starting topics from a message, as the sources native mode drives it."""

    ARGS = ("--live", "--freshness", "--images", "--media")
    test_reset_empties_a_draft_that_holds_only_reply_fields = None
    test_epoch_waits_for_a_request_holding_the_authority_shared = None
    test_reset_waits_for_a_save_the_server_is_still_handling = None
    test_a_save_that_comes_in_during_a_reset_waits_and_meets_its_revision = None

    def test_the_agent_starts_from_a_message_naming_what_it_has_seen(self):
        message = self.control("agent_message", operation_id="controls-question", body="Which name?")["result"]["message_id"]
        first = self.control("source_start", operation_id="controls-a", message_id=message, title="Naming", body="First")
        second = self.control("source_start", operation_id="controls-b", message_id=message, title="Naming again", body="Second")
        self.assertEqual([first["result"]["topic"]["id"], second["result"]["topic"]["id"]], ["controls-a-topic", "controls-b-topic"])
        # The person sees both, and each names the message it answers.
        listed = self.view("source_topics", {"message_id": message})
        self.assertEqual([(item["id"], item["creator_id"]) for item in listed["items"]],
                         [("controls-a-topic", self.ready["agent"]), ("controls-b-topic", self.ready["agent"])])
        self.assertEqual(self.view("topic", {"topic_id": "controls-b-topic"})["topic"]["source_message_id"], message)
        # The agent joined the outcome once; a Notebook write after it finds it there.
        self.control("outcome_reference", operation_id="controls-reference", item_id="controls-item", title="Plan", body="Words")
        members = [item["actor_id"] for item in self.view("workspace_members", {"workspace_id": "w1"})["items"]]
        self.assertEqual(members.count(self.ready["agent"]), 1)


if __name__ == "__main__":
    unittest.main()

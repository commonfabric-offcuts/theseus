from __future__ import annotations

import fcntl
import http.client
import json
import os
import select
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from urllib.parse import urlsplit

FIXTURE = Path(__file__).resolve().parent / "fixtures" / "ui_http.py"

# Runs the fixture unchanged, and reports on a private pipe each time the
# fixture's own code enters and leaves an exclusive flock, with the inode of
# the file it locks. The Store's locks go through unreported.
OBSERVED = """
import fcntl, os, runpy, sys
marks, fixture = int(sys.argv[1]), sys.argv[2]
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
sys.argv = [fixture] + sys.argv[3:]
runpy.run_path(fixture, run_name="__main__")
"""


class ImagesFixtureControls(unittest.TestCase):
    """The --images fixture's private controls, through its real stdin and HTTP."""

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.stderr = open(Path(self.tmp.name) / "stderr.log", "w+")
        self.marks, write = os.pipe()
        # The fixture makes its instance under TMPDIR, so this test finds its
        # authority lock without the fixture having to publish a path.
        env = dict(os.environ, TMPDIR=self.tmp.name)
        self.process = subprocess.Popen(
            [sys.executable, "-c", OBSERVED, str(write), str(FIXTURE), "--images"],
            stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=self.stderr, text=True, bufsize=1,
            pass_fds=(write,), env=env, cwd=str(FIXTURE.parents[2]))
        os.close(write)
        self.counter = 0
        self.ready = self.control("ready")

    def tearDown(self):
        # Private stdin EOF closes the fixture's server and instance.
        self.process.stdin.close()
        self.process.wait(timeout=5)
        self.process.stdout.close()
        os.close(self.marks)
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


if __name__ == "__main__":
    unittest.main()

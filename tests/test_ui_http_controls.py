from __future__ import annotations

import http.client
import json
import select
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from urllib.parse import urlsplit

FIXTURE = Path(__file__).resolve().parent / "fixtures" / "ui_http.py"


class ImagesFixtureControls(unittest.TestCase):
    """The --images fixture's private controls, through its real stdin and HTTP."""

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.stderr = open(Path(self.tmp.name) / "stderr.log", "w+")
        self.process = subprocess.Popen(
            [sys.executable, str(FIXTURE), "--images"],
            stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=self.stderr, text=True, bufsize=1,
            cwd=str(FIXTURE.parents[2]))
        self.counter = 0
        self.ready = self.control("ready")

    def tearDown(self):
        # Private stdin EOF closes the fixture's server and instance.
        self.process.stdin.close()
        self.process.wait(timeout=5)
        self.process.stdout.close()
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


if __name__ == "__main__":
    unittest.main()

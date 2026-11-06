from __future__ import annotations

"""Agents see a message's attachments in `read`, and save one's bytes with `attachment`."""

import errno
import hashlib
import io
import json
import os
from pathlib import Path
from unittest import mock

from aim_next import cli
import test_agent_verbs


PNG = (Path(__file__).parent / "fixtures" / "media" / "screen.png").read_bytes()


class AttachmentCase(test_agent_verbs.AgentVerbCase):
    def setUp(self):
        super().setUp()
        # The owner posts a screenshot with no words, as from the page.
        self.media_id = "media-30e8c1d2a4b5"
        self.committed(self.command("media.begin", {
            "name": "image.png", "content_type": "image/png", "size_bytes": len(PNG),
            "sha256": hashlib.sha256(PNG).hexdigest(), "publish_operation_id": "publish-shot",
        }, target={"media_id": self.media_id}, expected={"media_revision": 0}))
        envelope = self.envelope("media.publish", {"media_id": self.media_id}, {}, {"media_revision": 1}, op="publish-shot")
        self.committed(self.store.publish_media("owner", envelope, io.BytesIO(PNG)))
        self.message_id = self.committed(self.command("message.post", {"body": "", "attachments": [{"id": self.media_id}]},
                                                      target={"topic_id": "t1"}))["message_id"]
        self.stored = json.loads(self.sql("SELECT attachments FROM messages WHERE id=?", (self.message_id,))[0][0])
        self.out = Path(self.temp.name).resolve() / "saved.png"

    def test_read_shows_each_attachment_in_plain_text_and_json(self):
        code, out, err = self.run_cli("read", "t1")
        self.assertEqual((code, err), (0, ""))
        seq = self.sql("SELECT seq FROM messages WHERE id=?", (self.message_id,))[0][0]
        self.assertIn("#%s %s owner\n  [image: image.png, image/png, %s bytes, id %s]\n" % (seq, self.message_id, len(PNG), self.media_id), out)
        code, out, _ = self.run_cli("--json", "read", "t1")
        self.assertEqual(code, 0)
        page = json.loads(out.splitlines()[1])
        [item] = [item for item in page["items"] if item["id"] == self.message_id]
        self.assertEqual(item["attachments"], self.stored)
        self.assertEqual(set(self.stored[0]), {"id", "name", "content_type", "size_bytes", "sha256", "inline"})
        # A message without attachments says so with an empty list.
        self.assertTrue(all(other["attachments"] == [] for other in page["items"] if other["id"] != self.message_id))

    def test_a_reader_of_the_topic_saves_the_exact_bytes(self):
        code, out, err = self.run_cli("attachment", self.media_id, "--message", self.message_id, "--out", str(self.out))
        self.assertEqual((code, err), (0, ""))
        self.assertEqual(self.out.read_bytes(), PNG)
        self.assertEqual(hashlib.sha256(self.out.read_bytes()).hexdigest(), self.stored[0]["sha256"])
        self.assertEqual(out, "saved image.png (image/png, %s bytes, sha256 %s) to %s\n" % (len(PNG), self.stored[0]["sha256"], self.out))
        second = self.out.with_name("again.png")
        code, out, _ = self.run_cli("--json", "attachment", self.media_id, "--message", self.message_id, "--out", str(second))
        self.assertEqual(code, 0)
        self.assertEqual(json.loads(out), {"attachment": self.stored[0], "message_id": self.message_id, "path": str(second)})
        self.assertEqual(second.read_bytes(), PNG)

    def test_a_non_reader_is_refused_and_no_file_is_written(self):
        code, out, err = self.run_cli("attachment", self.media_id, "--message", self.message_id, "--out", str(self.out), actor="outsider")
        self.assertEqual((code, out), (2, ""))
        self.assertIn("FORBIDDEN", err)
        self.assertFalse(self.out.exists())
        code, out, _ = self.run_cli("--json", "attachment", self.media_id, "--message", self.message_id, "--out", str(self.out), actor="outsider")
        self.assertEqual((code, json.loads(out)["error"]["code"]), (2, "FORBIDDEN"))
        self.assertFalse(self.out.exists())

    def test_an_attachment_is_read_only_through_a_message_that_carries_it(self):
        other = self.committed(self.command("message.post", {"body": "No picture"}, target={"topic_id": "t1"}))["message_id"]
        code, out, err = self.run_cli("attachment", self.media_id, "--message", other, "--out", str(self.out))
        self.assertEqual((code, out), (2, ""))
        self.assertIn("FORBIDDEN", err)
        self.assertFalse(self.out.exists())

    def test_an_existing_file_is_never_overwritten(self):
        self.out.write_bytes(b"keep me")
        code, out, err = self.run_cli("attachment", self.media_id, "--message", self.message_id, "--out", str(self.out))
        self.assertEqual((code, out), (2, ""))
        self.assertIn("OUT_EXISTS", err)
        self.assertEqual(self.out.read_bytes(), b"keep me")

    def test_a_failed_write_keeps_no_partial_file(self):
        def fail(fd):
            raise OSError(errno.ENOSPC, os.strerror(errno.ENOSPC))
        with mock.patch.object(cli.os, "fsync", fail):
            code, out, err = self.run_cli("attachment", self.media_id, "--message", self.message_id, "--out", str(self.out))
        self.assertEqual((code, out), (2, ""))
        self.assertIn("OUT_UNAVAILABLE", err)
        self.assertIn("nothing was kept", err)
        self.assertFalse(self.out.exists())

    def test_sizes_read_as_a_person_would_say_them(self):
        self.assertEqual([cli._size(n) for n in (0, 1023, 1024, 140 * 1024 + 300, 1024 * 1024 - 513, 1024 * 1024 - 1, 1024 * 1024, 1536 * 1024)],
                         ["0 bytes", "1023 bytes", "1 KB", "140 KB", "1023 KB", "1.0 MB", "1.0 MB", "1.5 MB"])


# Do not rerun the inherited cases.
for _base in AttachmentCase.__mro__[1:]:
    for _name in list(vars(_base)):
        if _name.startswith("test_") and _name not in AttachmentCase.__dict__:
            setattr(AttachmentCase, _name, None)

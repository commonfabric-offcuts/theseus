from __future__ import annotations

"""Agents attach files with --attach: `post`, `start` and the Notebook verbs upload each file
through media.begin and the verified byte stream, the store people's uploads use."""

import hashlib
import json
from pathlib import Path
from unittest import mock

from aim_next import Store
from aim_next import cli
from aim_next.contract import LIMITS, StoreError
import test_agent_verbs


FIXTURES = Path(__file__).parent / "fixtures" / "media"
PNG = (FIXTURES / "screen.png").read_bytes()
NOTES = b"Run 1: 12 passed\r\nRun 2: 11 passed, 1 failed\n"


class AttachCase(test_agent_verbs.AgentVerbCase):
    def setUp(self):
        super().setUp()
        self.dir = Path(self.temp.name).resolve() / "files"
        self.dir.mkdir()
        self.png = self.file("screen.png", PNG)
        self.notes = self.file("results.log", NOTES)

    def file(self, name, data):
        path = self.dir / name
        path.write_bytes(data)
        return str(path)

    def stored(self, message_id):
        return json.loads(self.sql("SELECT attachments FROM messages WHERE id=?", (message_id,))[0][0])

    def bytes_of(self, media_id, message_id, actor="agent-b"):
        with self.store.open_media(actor, {"media_id": media_id, "source_ref": {"kind": "message", "id": message_id}}) as resource:
            return b"".join(iter(lambda: resource.read(65536), b""))

    def nothing_sent(self, before):
        self.assertEqual(self.records(), before)
        self.assertEqual(self.saved(), [])

    def test_post_attaches_an_image_inline_and_a_file_as_a_named_download(self):
        code, out, err = self.run_cli("post", "t1", "--attach", self.png, "--attach", self.notes, "Screenshot and the log")
        self.assertEqual((code, err), (0, ""))
        message = self.latest()[0]
        image, log = self.stored(message)
        self.assertEqual((image["name"], image["content_type"], image["inline"], image["size_bytes"], image["sha256"]),
                         ("screen.png", "image/png", True, len(PNG), hashlib.sha256(PNG).hexdigest()))
        self.assertEqual((log["name"], log["content_type"], log["inline"], log["size_bytes"]), ("results.log", "text/plain", False, len(NOTES)))
        # The exact bytes, read back by another member through the message, as the page reads them.
        self.assertEqual((self.bytes_of(image["id"], message), self.bytes_of(log["id"], message)), (PNG, NOTES))
        # The same store as people's uploads: ready media owned by the agent.
        self.assertEqual(self.sql("SELECT actor_id,state FROM media_intents WHERE id IN (?,?) ORDER BY name", (image["id"], log["id"])),
                         [("agent-a", "ready"), ("agent-a", "ready")])
        self.assertEqual(out, "attached screen.png (image/png, %s, inline) as %s\nattached results.log (text/plain, %s) as %s\n"
                              "posted %s in t1 (1 deliveries queued)\n" % (cli._size(len(PNG)), image["id"], cli._size(len(NOTES)), log["id"], message))
        # The outbox holds what `retry` can finish: the post. The uploads only prepare it, so
        # they are not there for an agent to retry in its place.
        kinds = sorted(json.loads((self.outbox() / name).read_text())["command"]["kind"] for name in self.saved() if name.endswith(".request.json"))
        self.assertEqual(kinds, ["message.post"])

    def test_a_post_of_attachments_alone_and_a_start_with_one(self):
        code, out, err = self.run_cli("post", "t1", "--attach", self.png, "")
        self.assertEqual((code, err), (0, ""))
        message, body = self.latest()[0], self.latest()[3]
        self.assertEqual((body, [item["name"] for item in self.stored(message)]), ("", ["screen.png"]))
        code, out, err = self.run_cli("start", "w1", "--title", "Run results", "--attach", self.notes, "The log is attached.")
        self.assertEqual((code, err), (0, ""))
        topic = out.splitlines()[-1].split()[1]
        first = self.sql("SELECT id FROM messages WHERE topic_id=? ORDER BY seq LIMIT 1", (topic,))[0][0]
        attached = self.stored(first)
        self.assertEqual([item["name"] for item in attached], ["results.log"], "the topic's first message carries the file")
        self.assertEqual(self.bytes_of(attached[0]["id"], first), NOTES)

    def test_the_type_comes_from_the_bytes_for_images_and_the_name_for_files(self):
        unnamed = self.file("screenshot", PNG)
        fake = self.file("not-really.png", b"plain words, not a picture")
        markdown = self.file("report.md", b"# Report\n")
        self.assertEqual(self.run_cli("post", "t1", "--attach", unnamed, "--attach", fake, "--attach", markdown, "Three")[0], 0)
        found = [(item["name"], item["content_type"], item["inline"]) for item in self.stored(self.latest()[0])]
        self.assertEqual(found, [("screenshot", "image/png", True), ("not-really.png", "application/octet-stream", False),
                                 ("report.md", "text/markdown", False)])
        self.assertEqual([cli._media_type(name, data) for name, data in (
            ("a.jpg", (FIXTURES / "one.jpg").read_bytes()), ("a", (FIXTURES / "one.gif").read_bytes()),
            ("a.webp", (FIXTURES / "one.webp").read_bytes()), ("a.pdf", b"%PDF-1.4"), ("a.unknown-kind", b"x"))],
            ["image/jpeg", "image/gif", "image/webp", "application/pdf", "application/octet-stream"])

    def test_the_notebook_verbs_attach_and_a_revision_keeps_what_the_page_carried(self):
        page = self.file("page.md", b"Results")
        code, out, err = self.run_cli("note", "new", "w1", "--title", "Results", "--attach", self.png, page)
        self.assertEqual((code, err), (0, ""))
        item = out.splitlines()[-1].split()[1]
        code, out, err = self.run_cli("note", "revise", item, "--expected", "1", "--attach", self.notes, page)
        self.assertEqual((code, err), (0, ""))
        self.assertTrue(out.endswith('revised %s "Results" to revision 2; read back matches\n' % item), out)
        source = self.store.view("agent-b", "memory_current", {"item_id": item})
        self.assertEqual([attachment["name"] for attachment in source["attachments"]], ["screen.png", "results.log"])
        code, out, err = self.run_cli("note", "read", item, actor="agent-b")
        self.assertIn("\n  [image: screen.png, image/png, ", out)
        self.assertIn("\n  [file: results.log, text/plain, ", out)

    def test_more_than_the_limits_is_refused_before_anything_is_sent(self):
        before = self.records()
        many = []
        for index in range(LIMITS["attachment_count"] + 1):
            many += ["--attach", self.file("file-%d.txt" % index, b"x")]
        code, out, err = self.run_cli("post", "t1", *many, "Too many")
        self.assertEqual((code, out), (2, ""))
        self.assertIn("TOO_MANY_ATTACHMENTS", err)
        self.nothing_sent(before)
        with mock.patch.dict(LIMITS, {"image_bytes": len(PNG) - 1}):
            code, out, err = self.run_cli("post", "t1", "--attach", self.notes, "--attach", self.png, "Too big an image")
        self.assertEqual((code, out), (2, ""))
        self.assertIn("ATTACHMENT_TOO_LARGE: screen.png is larger than", err)
        self.nothing_sent(before)
        with mock.patch.dict(LIMITS, {"media_file_bytes": len(NOTES) - 1}):
            code, out, err = self.run_cli("post", "t1", "--attach", self.notes, "Too big a file")
        self.assertEqual((code, out), (2, ""))
        self.assertIn("ATTACHMENT_TOO_LARGE: results.log is larger than", err)
        self.nothing_sent(before)
        with mock.patch.dict(LIMITS, {"attachment_bytes": len(PNG) + len(NOTES) - 1}):
            code, out, err = self.run_cli("post", "t1", "--attach", self.notes, "--attach", self.png, "Too much together")
        self.assertEqual((code, out), (2, ""))
        self.assertIn("TOO_MANY_ATTACHMENTS", err)
        self.nothing_sent(before)
        code, out, err = self.run_cli("post", "t1", "--attach", str(self.dir / "missing.png"), "No file")
        self.assertEqual((code, out), (2, ""))
        self.assertIn("FILE_UNAVAILABLE", err)
        code, out, err = self.run_cli("post", "t1", "--attach", str(self.dir), "A directory")
        self.assertEqual((code, out), (2, ""))
        self.assertIn("FILE_UNAVAILABLE", err)
        self.nothing_sent(before)

    def test_a_revision_counts_what_the_page_already_carries(self):
        page = self.file("page.md", b"Results")
        files = []
        for index in range(LIMITS["attachment_count"]):
            files += ["--attach", self.file("kept-%d.txt" % index, b"k")]
        self.assertEqual(self.run_cli("note", "new", "w1", "--title", "Full", *files, page)[0], 0)
        item = self.sql("SELECT id FROM memory_items")[0][0]
        before = self.records()
        code, out, err = self.run_cli("note", "revise", item, "--expected", "1", "--attach", self.notes, page)
        self.assertEqual((code, out), (2, ""))
        self.assertIn("TOO_MANY_ATTACHMENTS", err)
        self.assertEqual(self.records(), before)

    def test_an_upload_that_fails_ends_the_verb_and_names_nothing_to_retry(self):
        """Retrying an upload cannot send the message or page it was for (and a
        publication cannot be retried without its bytes), so however an upload
        ends (refused, busy, unconfirmed, the store not answering, interrupted),
        the verb says the message or page was not sent and to run the command
        again: exit 2, or 130 when interrupted, with no operation to `retry`
        and nothing left in the outbox in its place."""
        command, publish = Store.command, Store.publish_media

        def answer(envelope, code, message, retryable=True, recorded=False):
            return {"instance_id": "test-instance", "operation_id": envelope["operation_id"], "status": "retryable" if retryable else "rejected",
                    "recorded": recorded, "error": {"code": code, "message": message, "retryable": retryable}}

        def on_begin(effect):
            return mock.patch.object(Store, "command", lambda store, actor, envelope: (
                effect(envelope) if envelope["kind"] == "media.begin" else command(store, actor, envelope)))

        def on_publish(effect):
            return mock.patch.object(Store, "publish_media", lambda store, actor, envelope, stream: effect(envelope))

        def raise_(error):
            raise error

        failures = [
            ("begin busy", on_begin(lambda envelope: answer(envelope, "DATABASE_BUSY", "The database is busy")), 2,
             "DATABASE_BUSY: The database is busy"),
            ("begin refused", on_begin(lambda envelope: answer(envelope, "MEDIA_INVALID", "Not this file", retryable=False, recorded=True)), 2,
             "MEDIA_INVALID: Not this file"),
            ("begin unanswered", on_begin(lambda envelope: raise_(StoreError("gone"))), 2, "the store did not answer"),
            ("publish unconfirmed", on_publish(lambda envelope: answer(envelope, "MEDIA_UNCONFIRMED", "Publication was not confirmed")), 2,
             "MEDIA_UNCONFIRMED: Publication was not confirmed"),
            ("publish unanswered", on_publish(lambda envelope: raise_(OSError("gone"))), 2, "the store did not answer"),
            ("publish interrupted", on_publish(lambda envelope: raise_(KeyboardInterrupt())), 130, "interrupted"),
        ]
        page = self.file("page.md", b"Results")
        self.assertEqual(self.run_cli("note", "new", "w1", "--title", "Kept", page)[0], 0)
        item = self.sql("SELECT id FROM memory_items")[0][0]
        verbs = [("post", ["post", "t1", "--attach", self.png, "Never posted"]),
                 ("start", ["start", "w1", "--title", "Never started", "--attach", self.png, "Never started"]),
                 ("note new", ["note", "new", "w1", "--title", "Never made", "--attach", self.png, page]),
                 ("note revise", ["note", "revise", item, "--expected", "1", "--attach", self.png, page]),
                 ("post --json", ["--json", "post", "t1", "--attach", self.png, "Never posted"])]

        def written():
            return self.sql("SELECT (SELECT count(*) FROM messages), (SELECT count(*) FROM openings), (SELECT count(*) FROM memory_revisions)")

        for failure, patch, exit_code, reason in failures:
            for verb, argv in verbs:
                with self.subTest(failure=failure, verb=verb):
                    before, outbox = written(), self.saved()
                    with patch:
                        code, out, err = self.run_cli(*argv)
                    self.assertEqual((code, err), (exit_code, "ATTACHMENT_NOT_SENT: screen.png was not attached (%s), so the message or page "
                                                              "was not sent; run the command again.\n" % reason))
                    if verb.endswith("--json"):
                        # The last line says it as well, retryable false: nothing is offered for `retry`.
                        self.assertEqual(json.loads(out.splitlines()[-1])["error"], {
                            "code": "ATTACHMENT_NOT_SENT", "retryable": False,
                            "message": "screen.png was not attached (%s), so the message or page was not sent; run the command again." % reason})
                    else:
                        self.assertEqual(out, "")
                    self.assertEqual(written(), before, "nothing the verb exists to write was written")
                    self.assertEqual(self.saved(), outbox, "no request is left for `retry` in the verb's place")
        # The guide's path for a retryable or unconfirmed answer, `retry` of the
        # operation sent, cannot end in exit 0 with nothing posted.
        sent = []
        with on_begin(lambda envelope: sent.append(envelope["operation_id"]) or answer(envelope, "DATABASE_BUSY", "The database is busy")):
            self.assertEqual(self.run_cli("post", "t1", "--attach", self.png, "Never posted")[0], 2)
        before = written()
        code, out, err = self.run_cli("retry", sent[0])
        self.assertEqual((code, out), (2, ""))
        self.assertNotIn("recorded", err)
        self.assertEqual(written(), before)
        # Run again, the command does what it says, once.
        before = written()[0][0]
        self.assertEqual(self.run_cli("post", "t1", "--attach", self.png, "Posted at last")[0], 0)
        self.assertEqual(written()[0][0], before + 1)
        self.assertEqual(self.latest()[3], "Posted at last")

for _base in AttachCase.__mro__[1:]:
    for _name in list(vars(_base)):
        if _name.startswith("test_") and _name not in AttachCase.__dict__:
            setattr(AttachCase, _name, None)
del _base, _name

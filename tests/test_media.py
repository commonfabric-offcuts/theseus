from __future__ import annotations

import concurrent.futures
import fcntl
import hashlib
import io
import os
from pathlib import Path
import sqlite3
import unittest
from unittest import mock

from aim_next.contract import Refusal
from aim_next import media as media_module
from reader_fixture import ReaderCase


class MediaCase(ReaderCase):
    def test_verified_png_receipt_status_and_snapshot_describe_the_same_inline_bytes(self):
        data = (Path(__file__).parent / "fixtures" / "media" / "one.png").read_bytes()
        _, receipt = self.ready(data=data, content_type="image/png")
        self.assertTrue(receipt["result"]["inline"], receipt)
        self.assertTrue(self.status()["inline"])
        with self.open({"media_id": "media-one"}) as resource:
            self.assertTrue(resource.descriptor["inline"])
            self.assertEqual(resource.descriptor["content_type"], "image/png")
            self.assertEqual(self.read_all(resource), data)

    def test_verified_other_passive_formats_return_exact_inline_bytes(self):
        for extension, content_type in (("jpg", "image/jpeg"), ("gif", "image/gif"), ("webp", "image/webp")):
            with self.subTest(content_type=content_type):
                data = (Path(__file__).parent / "fixtures" / "media" / ("one." + extension)).read_bytes()
                media_id = "inline-" + extension
                _, receipt = self.ready(media_id, data, content_type=content_type)
                self.assertTrue(receipt["result"]["inline"])
                with self.open({"media_id": media_id}) as resource:
                    self.assertTrue(resource.descriptor["inline"])
                    self.assertEqual(resource.descriptor["content_type"], content_type)
                    self.assertEqual(self.read_all(resource), data)

    def begin(self, media_id="media-one", data=b"original bytes", actor="owner", content_type="text/plain"):
        publish_id = "publish-" + media_id
        result = self.command("media.begin", {
            "name": "fixture.txt", "content_type": content_type, "size_bytes": len(data),
            "sha256": hashlib.sha256(data).hexdigest(), "publish_operation_id": publish_id,
        }, target={"media_id": media_id}, expected={"media_revision": 0}, actor=actor)
        self.committed(result)
        return self.envelope("media.publish", {"media_id": media_id}, {},
                             {"media_revision": 1}, op=publish_id)

    def publish(self, envelope, stream, actor="owner"):
        method = getattr(self.store, "publish_media", None)
        self.assertTrue(callable(method), "Core publish_media contract is not implemented")
        return method(actor, envelope, stream)

    def open(self, args, actor="owner"):
        method = getattr(self.store, "open_media", None)
        self.assertTrue(callable(method), "Core open_media contract is not implemented")
        return method(actor, args)

    def status(self, media_id="media-one", actor="owner", **extra):
        return self.store.view(actor, "media", dict(media_id=media_id, **extra))

    def ready(self, media_id="media-one", data=b"original bytes", actor="owner", content_type="text/plain"):
        envelope = self.begin(media_id, data, actor, content_type)
        receipt = self.publish(envelope, io.BytesIO(data), actor)
        result = self.committed(receipt)
        self.assertEqual(result["state"], "ready")
        self.assertEqual(result["sha256"], hashlib.sha256(data).hexdigest())
        return envelope, receipt

    def read_all(self, resource):
        chunks = []
        while True:
            value = resource.read(65536)
            self.assertIsInstance(value, bytes)
            self.assertLessEqual(len(value), 65536)
            if not value:
                return b"".join(chunks)
            chunks.append(value)

    def blob_with_bytes(self, data):
        # Test-owned root only. Public API must never return this local path.
        root = Path(str(self.path) + ".media")
        candidates = [path for path in root.rglob("*")
                      if path.is_file() and not path.is_symlink() and path.read_bytes() == data]
        self.assertEqual(len(candidates), 1, candidates)
        return candidates[0]

    def test_pending_intent_is_private_and_json_dispatch_cannot_consume_reserved_publication(self):
        before = self.public_state()
        envelope = self.begin()
        self.assertEqual(self.status()["state"], "pending")
        self.assertNotIn("path", self.status())
        for actor, media_id in (("agent-a", "media-one"), ("agent-a", "missing")):
            self.rejected(self.status(media_id, actor=actor), "FORBIDDEN")
        with self.assertRaises(Refusal) as error:
            self.open({"media_id": "media-one"})
        self.assertEqual(error.exception.code, "ATTACHMENT_NOT_READY")
        refused = self.store.command("owner", envelope)
        self.rejected(refused, "MEDIA_BYTES_REQUIRED")
        self.assertFalse(refused["recorded"])
        unrelated = dict(envelope, kind="workspace.create", target={}, expected={"authority": dict(self.pin)},
                         args={"id": "illegal", "title": "No"})
        refused = self.store.command("owner", unrelated)
        self.rejected(refused, "OPERATION_PAYLOAD_MISMATCH")
        self.assertFalse(refused["recorded"])
        self.assertEqual(self.store.view("owner", "operation", {"operation_id": envelope["operation_id"]})["status"], "unknown")
        self.assertEqual(self.public_state(), before)
        self.committed(self.publish(envelope, io.BytesIO(b"original bytes")))

    def test_duplicate_publication_returns_one_receipt_without_reading_retry_body(self):
        envelope, original = self.ready()
        before = self.records()
        class Unreadable:
            def read(self, size):
                raise AssertionError("An already recorded retry consumed bytes")
        self.assertEqual(self.publish(envelope, Unreadable()), original)
        self.assertEqual(self.records(), before)
        with self.open({"media_id": "media-one"}) as resource:
            descriptor = resource.descriptor
            self.assertEqual(descriptor["media_id"], "media-one")
            self.assertEqual(descriptor["size_bytes"], len(b"original bytes"))
            self.assertEqual(descriptor["instance_id"], "test-instance")
            self.assertFalse(descriptor["inline"])
            self.assertEqual(self.read_all(resource), b"original bytes")
            with self.assertRaises(TypeError):
                descriptor["size_bytes"] = 0
        resource.close()
        with self.assertRaises((Refusal, ValueError)):
            resource.read(1)
        self.assertEqual(self.records(), before)

    def test_stream_holds_no_transaction_or_authority_fence_and_abort_keeps_same_retry(self):
        envelope = self.begin()
        fixture = self
        checked = []
        class Interrupted:
            def read(self, size):
                fixture.assertGreater(size, 0)
                fixture.assertLessEqual(size, 65536)
                with sqlite3.connect(str(fixture.path), timeout=0, isolation_level=None) as db:
                    db.execute("BEGIN IMMEDIATE")
                    db.rollback()
                fd = os.open(fixture.binding["authority_path"] + ".lock", os.O_RDWR)
                try:
                    fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
                    checked.append(True)
                finally:
                    os.close(fd)
                raise OSError("Deliberate isolated stream interruption")
        try:
            result = self.publish(envelope, Interrupted())
        except OSError:
            result = None
        if result is not None:
            self.assertFalse(result["recorded"], result)
        self.assertEqual(checked, [True])
        self.assertEqual(self.status()["state"], "pending")
        self.assertEqual(self.store.view("owner", "operation", {"operation_id": envelope["operation_id"]})["status"], "unknown")
        self.committed(self.publish(envelope, io.BytesIO(b"original bytes")))

    def test_actual_size_digest_and_inline_type_must_match_before_ready(self):
        for index, (declared, actual, content_type) in enumerate((
                (b"right", b"wrong", "text/plain"),
                (b"longer", b"short", "text/plain"),
                (b"short", b"too many bytes", "text/plain"),
                (b"<svg></svg>", b"<svg></svg>", "image/png"))):
            with self.subTest(index=index):
                media_id = "bad-%s" % index
                envelope = self.begin(media_id, declared, content_type=content_type)
                result = self.publish(envelope, io.BytesIO(actual))
                self.assertNotEqual(result.get("status"), "committed", result)
                self.assertEqual(self.status(media_id)["state"], "pending")
                with self.assertRaises(Refusal):
                    self.open({"media_id": media_id})

    def test_verified_snapshot_survives_later_file_change_next_read_refuses_corruption(self):
        data = b"Snapshot whose exact bytes matter"
        self.ready(data=data)
        resource = self.open({"media_id": "media-one"})
        self.addCleanup(resource.close)
        path = self.blob_with_bytes(data)
        before = self.records()
        path.write_bytes(b"X" + data[1:])
        self.assertEqual(self.read_all(resource), data)
        with self.assertRaises(Refusal) as error:
            self.open({"media_id": "media-one"})
        self.assertEqual(error.exception.code, "MEDIA_UNAVAILABLE")
        self.assertEqual(self.records(), before)

    def test_exact_attached_source_grants_read_but_id_or_unattached_source_does_not(self):
        self.ready()
        self.participation("outsider", True)
        sent = self.send("Attached", ["outsider"], attachments=[{"id": "media-one"}])
        source = {"kind": "message", "id": sent["id"]}
        unrelated = self.send("Readable but unattached", ["outsider"])
        self.participation("outsider", False)
        unattached = {"kind": "message", "id": unrelated["id"]}
        self.assertEqual(self.source(unattached, actor="outsider")["attachments"], [])
        for args in ({"media_id": "media-one"}, {"media_id": "media-one", "source_ref": unattached}):
            with self.assertRaises(Refusal) as error:
                self.open(args, actor="outsider")
            self.assertEqual(error.exception.code, "FORBIDDEN")
        with self.open({"media_id": "media-one", "source_ref": source}, actor="outsider") as resource:
            self.assertEqual(self.read_all(resource), b"original bytes")
        # A shared attachment is readable without granting its uploader's
        # private status or allowing a new independent attachment by ID.
        self.rejected(self.status(actor="outsider"), "FORBIDDEN")

    def test_short_actual_length_is_refused_even_when_its_digest_matches(self):
        data = b"short with correct hash"
        self.committed(self.command("media.begin", {"name": "fixture", "content_type": "text/plain",
            "size_bytes": len(data) + 1, "sha256": hashlib.sha256(data).hexdigest(),
            "publish_operation_id": "publish-short"}, target={"media_id": "short"}, expected={"media_revision": 0}))
        envelope = self.envelope("media.publish", {"media_id": "short"}, {}, {"media_revision": 1}, op="publish-short")
        self.rejected(self.publish(envelope, io.BytesIO(data)), "MEDIA_INVALID")
        self.assertEqual(self.status("short")["state"], "pending")

    def test_pending_prepare_preserves_text_then_ready_A_cannot_erase_new_B_or_removed_attachment(self):
        envelope = self.begin()
        self.committed(self.command("draft.save", {
            "source_ref": self.opening, "topic_id": "t1", "generation": "gA", "body": "Pending A",
            "attachments": [{"id": "media-one"}], "quotes": [], "addressees": [],
        }, target={"draft_id": "attached"}, expected={"draft_revision": 0}))
        before = self.store.view("owner", "editor_state", {"source_ref": self.opening, "topic_id": "t1"})
        self.rejected(self.prepare("attached", "t1", submission="too-early", send_op="early-send"), "ATTACHMENT_NOT_READY")
        after = self.store.view("owner", "editor_state", {"source_ref": self.opening, "topic_id": "t1"})
        self.assertEqual(after["draft"], before["draft"])
        self.assertEqual(after["submissions"]["items"], [])
        self.committed(self.publish(envelope, io.BytesIO(b"original bytes")))
        prepared = self.committed(self.prepare("attached", "t1", submission="ready-A", send_op="ready-send"))
        self.committed(self.save_draft("attached", self.opening, "t1", "New B with attachment removed",
                                      revision=2, generation=prepared["next_draft"]["generation"]))
        receipt = self.command("message.send", {"submission_id": "ready-A"},
                               target={"topic_id": "t1"}, op="ready-send")
        result = self.committed(receipt)
        source = self.source({"kind": "message", "id": result["message_id"]})
        self.assertEqual(source["body"], "Pending A")
        self.assertEqual(len(source["attachments"]), 1)
        self.assertEqual(source["attachments"][0]["sha256"], hashlib.sha256(b"original bytes").hexdigest())
        draft = self.store.view("owner", "editor_state", {"source_ref": self.opening, "topic_id": "t1"})["draft"]
        self.assertEqual(draft["body"], "New B with attachment removed")
        self.assertEqual(draft["attachments"], [])

    def test_concurrent_same_intent_publishes_one_blob_and_one_ready_receipt(self):
        data = b"Concurrent publication"
        envelope = self.begin(data=data)
        with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
            receipts = list(pool.map(lambda _: self.publish(envelope, io.BytesIO(data)), range(2)))
        self.committed(receipts[0])
        self.assertEqual(receipts[0], receipts[1], repr(receipts))
        self.blob_with_bytes(data)
        self.assertEqual(self.store.view("owner", "operation", {"operation_id": envelope["operation_id"]}), receipts[0])

    def test_same_inode_link_cleanup_during_capture_does_not_change_verified_bytes(self):
        data = b"Concurrent hard-link identity sentinel"
        self.ready(data=data)
        path = self.blob_with_bytes(data)
        alias = path.parent / ".test-link"
        os.link(str(path), str(alias))
        original = os.read
        observed = []
        def reading(fd, count):
            value = original(fd, count)
            if value and not observed:
                before = os.fstat(fd)
                alias.unlink()
                after = os.fstat(fd)
                self.assertEqual((before.st_dev, before.st_ino, before.st_size, before.st_mtime_ns),
                                 (after.st_dev, after.st_ino, after.st_size, after.st_mtime_ns))
                self.assertNotEqual(before.st_nlink, after.st_nlink)
                observed.append(True)
            return value
        with mock.patch.object(media_module.os, "read", reading):
            with self.open({"media_id": "media-one"}) as resource:
                self.assertEqual(self.read_all(resource), data)
        self.assertEqual(observed, [True])

    def test_error_shaped_json_and_true_svg_are_exact_download_bytes(self):
        for media_id, content_type, data in (
                ("json-file", "application/json", b'{"error":{"code":"FORBIDDEN"}}'),
                ("svg-file", "image/svg+xml", b'<svg xmlns="http://www.w3.org/2000/svg"></svg>')):
            self.ready(media_id, data, content_type=content_type)
            with self.open({"media_id": media_id}) as resource:
                self.assertFalse(resource.descriptor["inline"])
                self.assertEqual(resource.descriptor["content_type"], content_type)
                self.assertEqual(self.read_all(resource), data)

    def test_foreign_and_unknown_media_have_same_refusal_for_every_source_shape(self):
        self.ready()
        for ref in (self.opening, {"kind": "unknown", "id": "x"},
                    {"kind": "message", "id": "missing"}, None):
            with self.subTest(ref=ref):
                known = self.status(actor="agent-a", source_ref=ref)
                missing = self.status("missing-media", actor="agent-a", source_ref=ref)
                self.assertEqual(known, missing)


del ReaderCase

if __name__ == "__main__":
    unittest.main()

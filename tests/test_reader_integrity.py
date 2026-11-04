from __future__ import annotations

import io
import os
import sqlite3
import unittest
from unittest import mock

from aim_next import StoreError
from aim_next.contract import LIMITS, Refusal
from aim_next import media as media_module
import test_command_pins as pin_fixture
from test_media import MediaCase


class ReaderIntegrityCase(MediaCase):
    controlled_epoch = pin_fixture.CommandPinCase.controlled_epoch

    def test_notebook_records_refuse_in_place_history_and_owner_changes(self):
        self.committed(self.memory())
        before = self.records()
        statements = (
            "UPDATE memory_revisions SET body='rewritten' WHERE item_id='memory-one'",
            "DELETE FROM memory_revisions WHERE item_id='memory-one'",
            "UPDATE memory_items SET creator_id='agent-b' WHERE id='memory-one'",
            "UPDATE memory_items SET scope_kind='workspace',scope_id='w1' WHERE id='memory-one'",
            "DELETE FROM memory_items WHERE id='memory-one'",
        )
        for sql in statements:
            with self.subTest(sql=sql), sqlite3.connect(str(self.path)) as db:
                with self.assertRaises(sqlite3.IntegrityError):
                    db.execute(sql)
        self.assertEqual(self.records(), before)

    def test_notebook_commit_failure_rolls_back_revision_pointer_list_change_and_receipt(self):
        self.committed(self.memory())
        self.send("Unrelated conversation changes do not change item CAS")
        self.committed(self.memory(revision=1, body="Second"))
        before = self.records()
        with mock.patch.object(self.store, "_advance_commit_seq", side_effect=StoreError("Injected commit identity failure")):
            with self.assertRaises(StoreError):
                self.memory(revision=2, body="Must roll back")
        self.assertEqual(self.records(), before)
        self.assertEqual(self.source(self.memory_ref(revision=2))["body"], "Second")
        self.assertEqual(self.source(self.memory_ref())["current_revision"], 2)

    def test_notebook_complete_arguments_reject_spoofing_and_bound_foreign_references(self):
        self.committed(self.memory())
        before = self.source(self.memory_ref())
        for args in ({"title": "Partial"}, {"title": "T", "body": "B", "attachments": [], "references": [], "author": "owner"}):
            result = self.command("memory.revise", args, target={"item_id": "memory-one"},
                                  expected={"item_revision": 1}, actor="agent-a")
            self.rejected(result, "INVALID_ARGUMENT")
        self.rejected(self.memory(revision=1, references=[self.opening] * 33), "INVALID_ARGUMENT")
        self.rejected(self.memory(revision=1, references=[{"kind": "message", "id": "unreadable"}]), "FORBIDDEN")
        self.assertEqual(self.source(self.memory_ref()), before)
        self.assertEqual(self.store.view("owner", "capabilities", {})["limits"]["memory_references"], 32)

    def test_media_pins_cannot_be_replaced_after_cutover_during_stream(self):
        self.cutover_publication("stream")

    def test_media_pins_cannot_adopt_old_final_file_after_cutover_before_commit(self):
        self.cutover_publication("commit")

    def cutover_publication(self, phase):
        data = b"Retain the original publication authority"
        envelope = self.begin(data=data)
        old_store = self.store
        fixture = self
        crossed = []
        class CrossingStream(io.BytesIO):
            def read(stream, count):
                if phase == "stream" and not crossed:
                    fixture.controlled_epoch()
                    crossed.append(True)
                return super().read(count)
        original = old_store._execute_command
        def execute(actor, act, **kwargs):
            if phase == "commit" and kwargs.get("effect") is not None:
                fixture.controlled_epoch()
                crossed.append(True)
            return original(actor, act, **kwargs)
        with mock.patch.object(old_store, "_execute_command", execute):
            result = old_store.publish_media("owner", envelope, CrossingStream(data))
        self.assertEqual(crossed, [True])
        self.rejected(result, "AUTHORITY_CHANGED")
        self.assertFalse(result["recorded"])
        self.assertEqual(self.status()["state"], "pending")
        before = self.records()
        repinned = dict(envelope, expected=dict(envelope["expected"], authority=self.pin))
        result = self.publish(repinned, io.BytesIO(data))
        self.rejected(result, "AUTHORITY_CHANGED")
        self.assertFalse(result["recorded"])
        self.assertEqual(self.records(), before)
        if phase == "commit":
            self.blob_with_bytes(data)  # Retained orphan is not adopted into E2.
        else:
            from pathlib import Path
            root = Path(str(self.path) + '.media')
            self.assertTrue(root.is_dir())
            self.assertEqual(list(root.iterdir()), [], 'Old epoch published a file after cutover')

    def test_replacement_truncation_and_symlink_refuse_before_returning_any_resource(self):
        for index, action in enumerate(("replacement", "truncation", "symlink")):
            with self.subTest(action=action):
                data = ("Protected file " + action).encode("ascii")
                media_id = "protected-%s" % index
                self.ready(media_id, data)
                path = self.blob_with_bytes(data)
                original_read = os.read
                changed = []
                if action == "symlink":
                    moved = path.with_name(path.name + "-original")
                    path.rename(moved)
                    path.symlink_to(moved)
                    changed.append(True)
                def reading(fd, count):
                    value = original_read(fd, count)
                    if value and not changed:
                        if action == "replacement":
                            path.unlink()
                            path.write_bytes(data)
                        else:
                            path.write_bytes(data[:3])
                        changed.append(True)
                    return value
                before = self.records()
                with mock.patch.object(media_module.os, "read", reading):
                    with self.assertRaises(Refusal) as error:
                        self.open({"media_id": media_id})
                self.assertEqual(error.exception.code, "MEDIA_UNAVAILABLE")
                self.assertEqual(changed, [True])
                self.assertEqual(self.records(), before)

    def test_replaced_staging_inode_is_not_published_as_the_file_that_was_synced(self):
        data = b"Same bytes in another inode are not the synced file"
        envelope = self.begin(data=data)
        original_link = os.link
        changed = []
        def linked(src, dst, *args, **kwargs):
            directory = kwargs["src_dir_fd"]
            original = os.stat(src, dir_fd=directory, follow_symlinks=False)
            os.unlink(src, dir_fd=directory)
            replacement = os.open(src, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600, dir_fd=directory)
            try:
                os.write(replacement, data)
                current = os.fstat(replacement)
                self.assertNotEqual((original.st_dev, original.st_ino), (current.st_dev, current.st_ino))
                changed.append(True)
            finally:
                os.close(replacement)
            return original_link(src, dst, *args, **kwargs)
        with mock.patch.object(media_module.os, "link", linked):
            result = self.publish(envelope, io.BytesIO(data))
        self.assertEqual(changed, [True])
        self.rejected(result, "MEDIA_UNAVAILABLE")
        self.assertFalse(result["recorded"])
        self.assertEqual(self.status()["state"], "pending")

    def test_failed_send_rolls_back_explicit_address_index_and_message_together(self):
        self.participation("other-reader", True)
        key = "rollback-send"
        self.committed(self.command("draft.save", {"source_ref": self.opening, "topic_id": "t1",
            "generation": "gA", "body": "No partial indexed message", "addressees": ["owner", "other-reader"]},
            target={"draft_id": key}, expected={"draft_revision": 0}))
        self.committed(self.prepare(key, "t1", submission=key, send_op=key))
        before = self.records()
        def fail_after_indexed_send(db):
            message = db.execute("SELECT id FROM messages WHERE operation_id=?", (key,)).fetchone()
            self.assertIsNotNone(message, "Fault must observe an actual send, not a refusal")
            self.assertEqual(db.execute("SELECT count(*) FROM message_addressees WHERE seq=(SELECT seq FROM messages WHERE id=?)", (message[0],)).fetchone()[0], 2)
            raise StoreError("Inject rollback after indexed send")
        with mock.patch.object(self.store, "_advance_commit_seq", side_effect=fail_after_indexed_send):
            with self.assertRaises(StoreError):
                self.command("message.send", {"submission_id": key}, target={"topic_id": "t1"}, op=key)
        self.assertEqual(self.records(), before)

    def test_ready_attachment_only_send_and_exact_notebook_retention_are_separate_permissions(self):
        self.ready("owner-image")
        sent = self.send("", attachments=[{"id": "owner-image"}])
        self.assertEqual(self.source({"kind": "message", "id": sent["id"]})["body"], "")
        self.ready("agent-file", actor="agent-a")
        self.ready("other-private-file", actor="agent-a")
        self.committed(self.memory(attachments=[{"id": "agent-file"}]))
        self.committed(self.command("participation.set", {"actor_id": "agent-b", "present": True}, target={"topic_id": "t1"}))
        self.committed(self.memory(actor="agent-b", revision=1, attachments=[{"id": "agent-file"}]))
        old = self.source(self.memory_ref())["attachments"]
        self.assertEqual(self.source(self.memory_ref(revision=2))["attachments"], old)
        self.rejected(self.memory(actor="agent-b", revision=2, attachments=[{"id": "other-private-file"}]), "FORBIDDEN")
        self.assertEqual(self.source(self.memory_ref(revision=2))["attachments"], old)

    def test_file_image_and_combined_attachment_caps_refuse_without_erasing_private_writing(self):
        with mock.patch.dict(LIMITS, {"image_bytes": 8, "media_file_bytes": 32, "attachment_bytes": 16}):
            for content_type, size in (("image/png", 9), ("application/octet-stream", 33)):
                receipt = self.command("media.begin", {"name": "bounded", "content_type": content_type,
                    "size_bytes": size, "sha256": "0" * 64, "publish_operation_id": "unused"},
                    target={"media_id": "oversize"}, expected={"media_revision": 0})
                self.rejected(receipt, "INVALID_ARGUMENT")
            self.begin("first", b"1234567890")
            self.begin("second", b"1234567890")
            self.committed(self.save_draft("retained", self.opening, "t1", "Keep this writing"))
            before = self.store.view("owner", "editor_state", {"source_ref": self.opening, "topic_id": "t1"})["draft"]
            for refs in ([{"id": "first"}, {"id": "second"}], [{"id": "first"}] * 9):
                result = self.command("draft.save", {"source_ref": self.opening, "topic_id": "t1", "generation": "gA",
                    "body": "Too much media", "attachments": refs}, target={"draft_id": "retained"}, expected={"draft_revision": 1})
                self.rejected(result, "TOO_MANY_ATTACHMENTS")
                self.assertEqual(self.store.view("owner", "editor_state", {"source_ref": self.opening, "topic_id": "t1"})["draft"], before)


for _name in list(MediaCase.__dict__):
    if _name.startswith("test_") and _name not in ReaderIntegrityCase.__dict__:
        setattr(ReaderIntegrityCase, _name, None)
del MediaCase

if __name__ == "__main__":
    unittest.main()

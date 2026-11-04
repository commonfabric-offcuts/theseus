from __future__ import annotations

import json
import os
from pathlib import Path
import sqlite3
import stat
import unittest
from unittest import mock

from aim_next import StoreError
from test_media import MediaCase


class MediaDurabilityCase(MediaCase):
    """Observe actual OS sync/link and the SQLite receipt commit boundary.

    A link is the selected stdlib no-overwrite publication primitive; no
    monkeypatch fabricates a successful write, sync or transaction.
    """

    def publication_probe(self, envelope, data, interrupt=None):
        events = []
        original_sync, original_link, original_connect = os.fsync, os.link, sqlite3.connect
        root = Path(str(self.path) + ".media")
        fixture = self
        published = []
        synced_files = set()

        def boundary(name):
            events.append(name)
            if name == interrupt:
                events.append("interrupted:" + name)
                raise OSError("Deliberate interruption after " + name)

        def synced(fd):
            identity = os.fstat(fd)
            result = original_sync(fd)
            if stat.S_ISREG(identity.st_mode):
                for path in root.rglob("*"):
                    observed = path.lstat()
                    if (observed.st_dev, observed.st_ino) == (identity.st_dev, identity.st_ino):
                        fixture.assertFalse(path.is_symlink())
                        fixture.assertEqual(path.read_bytes(), data)
                        synced_files.add((identity.st_dev, identity.st_ino))
                        events.append({"kind": "synced-file-identity", "dev": identity.st_dev,
                                       "ino": identity.st_ino})
                        boundary("file-sync")
                        break
            elif stat.S_ISDIR(identity.st_mode) and published:
                parent = published[-1].parent.stat()
                if (parent.st_dev, parent.st_ino) == (identity.st_dev, identity.st_ino):
                    fixture.assertEqual(published[-1].read_bytes(), data)
                    boundary("directory-sync")
            return result

        def linked(src, dst, *args, **kwargs):
            # Match the owned fixture's publication, not unrelated framework I/O.
            source_path, destination_path = Path(src), Path(dst)
            for name, path in (("src_dir_fd", source_path), ("dst_dir_fd", destination_path)):
                if not path.is_absolute() and kwargs.get(name) is not None:
                    held = os.fstat(kwargs[name])
                    named = root.stat()
                    fixture.assertEqual((held.st_dev, held.st_ino), (named.st_dev, named.st_ino))
            if not destination_path.is_absolute() and kwargs.get("dst_dir_fd") is not None:
                destination_path = root / destination_path
            if not source_path.is_absolute() and kwargs.get("src_dir_fd") is not None:
                source_path = root / source_path
            if root in destination_path.parents:
                fixture.assertFalse(destination_path.exists())
                source = source_path.lstat()
                fixture.assertTrue(stat.S_ISREG(source.st_mode))
                source_identity = (source.st_dev, source.st_ino)
                result = original_link(src, dst, *args, **kwargs)
                destination = destination_path.lstat()
                fixture.assertTrue(stat.S_ISREG(destination.st_mode))
                destination_identity = (destination.st_dev, destination.st_ino)
                # Equal bytes are insufficient: syncing A then publishing B
                # must fail even when both files contain exactly this payload.
                fixture.assertEqual(destination_identity, source_identity)
                fixture.assertIn(source_identity, synced_files,
                                 "Published inode was not the inode actually synced")
                events.append({"kind": "published-file-identity", "source": source_identity,
                               "destination": destination_identity})
                fixture.assertEqual(destination_path.read_bytes(), data)
                published.append(destination_path)
                boundary("publication")
                return result
            return original_link(src, dst, *args, **kwargs)

        class ObservedConnection(sqlite3.Connection):
            def commit(db):
                row = db.execute("SELECT outcome FROM operations WHERE actor_id='owner' AND id=?",
                                 (envelope["operation_id"],)).fetchone()
                committing_ready = bool(row and json.loads(row[0])["status"] == "committed")
                if committing_ready and interrupt == "before-ready-commit":
                    events.append("interrupted:before-ready-commit")
                    raise OSError("Deliberate interruption before ready commit")
                result = super().commit()
                if committing_ready:
                    boundary("ready-commit")
                return result

        def connected(*args, **kwargs):
            return original_connect(*args, factory=ObservedConnection, **kwargs)

        import io
        with mock.patch.object(os, "fsync", synced), mock.patch.object(os, "link", linked), \
                mock.patch.object(sqlite3, "connect", connected):
            try:
                receipt = self.publish(envelope, io.BytesIO(data))
            except (OSError, StoreError):
                if interrupt is None:
                    raise
                receipt = None
        return receipt, events

    def test_actual_sync_and_no_overwrite_publication_precede_ready_receipt_commit(self):
        data = b"Durability order sentinel"
        envelope = self.begin(data=data)
        receipt, events = self.publication_probe(envelope, data)
        self.committed(receipt)
        for name in ("file-sync", "publication", "directory-sync", "ready-commit"):
            self.assertIn(name, events, events)
        self.assertLess(events.index("file-sync"), events.index("publication"), events)
        self.assertLess(events.index("publication"), events.index("directory-sync"), events)
        self.assertLess(events.index("directory-sync"), events.index("ready-commit"), events)
        self.assertEqual(events.count("ready-commit"), 1, events)

    def test_interruption_at_each_publication_boundary_reconciles_the_original_operation(self):
        import io
        for index, interrupt in enumerate(("file-sync", "directory-sync", "before-ready-commit", "ready-commit")):
            with self.subTest(interrupt=interrupt):
                media_id = "interrupted-%s" % index
                data = ("Interrupted bytes " + interrupt).encode("ascii")
                envelope = self.begin(media_id, data)
                before = self.public_state()
                _, events = self.publication_probe(envelope, data, interrupt=interrupt)
                self.assertIn("interrupted:" + interrupt, events, events)
                lookup = self.store.view("owner", "operation", {"operation_id": envelope["operation_id"]})
                if interrupt == "ready-commit":
                    self.committed(lookup)
                    self.assertEqual(self.status(media_id)["state"], "ready")
                else:
                    self.assertEqual(lookup["status"], "unknown", lookup)
                    self.assertEqual(self.status(media_id)["state"], "pending")
                receipt = self.publish(envelope, io.BytesIO(data))
                self.committed(receipt)
                self.assertEqual(self.store.view("owner", "operation", {"operation_id": envelope["operation_id"]}), receipt)
                self.assertEqual(self.public_state(), before)
                self.blob_with_bytes(data)


# Reuse only fixture helpers; do not rerun the base media verdicts here.
for _name in list(MediaCase.__dict__):
    if _name.startswith("test_") and _name not in MediaDurabilityCase.__dict__:
        setattr(MediaDurabilityCase, _name, None)
del MediaCase

if __name__ == "__main__":
    unittest.main()

from __future__ import annotations

from contextlib import contextmanager
import hashlib
import io
import json
import os
from pathlib import Path
import re
import stat
from types import MappingProxyType
import uuid
import zlib

from .authority import AuthorityError
from .contract import LIMITS, Refusal, _identifier, _revision
from .message_edit import held_refusal


MEDIA_SCHEMA = [
    "CREATE TABLE media_intents (id TEXT PRIMARY KEY, actor_id TEXT NOT NULL REFERENCES actors(id), revision INTEGER NOT NULL, state TEXT NOT NULL, publish_operation_id TEXT NOT NULL, authority_id TEXT NOT NULL, authority_epoch TEXT NOT NULL, name TEXT NOT NULL, content_type TEXT NOT NULL, size_bytes INTEGER NOT NULL, sha256 TEXT NOT NULL, blob_key TEXT NOT NULL UNIQUE, inline INTEGER NOT NULL DEFAULT 0, UNIQUE(actor_id,publish_operation_id))",
    "CREATE INDEX owned_media ON media_intents(actor_id,id)",
    "CREATE TRIGGER immutable_media_intent BEFORE UPDATE ON media_intents WHEN OLD.state='ready' OR NEW.id!=OLD.id OR NEW.actor_id!=OLD.actor_id OR NEW.publish_operation_id!=OLD.publish_operation_id OR NEW.authority_id!=OLD.authority_id OR NEW.authority_epoch!=OLD.authority_epoch OR NEW.name!=OLD.name OR NEW.content_type!=OLD.content_type OR NEW.size_bytes!=OLD.size_bytes OR NEW.sha256!=OLD.sha256 OR NEW.blob_key!=OLD.blob_key BEGIN SELECT RAISE(ABORT, 'immutable media intent'); END",
    "CREATE TRIGGER immutable_media_delete BEFORE DELETE ON media_intents BEGIN SELECT RAISE(ABORT, 'immutable media intent'); END",
]
INLINE_TYPES = {"image/png", "image/jpeg", "image/gif", "image/webp"}


def _png_structure(data):
    if data[:8] != b"\x89PNG\r\n\x1a\n":
        return False
    offset, header, image = 8, False, False
    depths = {0: (1, 2, 4, 8, 16), 2: (8, 16), 3: (1, 2, 4, 8), 4: (8, 16), 6: (8, 16)}
    while offset + 12 <= len(data):
        size = int.from_bytes(data[offset:offset + 4], 'big')
        kind = bytes(data[offset + 4:offset + 8])
        end = offset + 12 + size
        if end > len(data) or not all(65 <= c <= 90 or 97 <= c <= 122 for c in kind):
            return False
        if zlib.crc32(data[offset + 4:end - 4]) & 0xffffffff != int.from_bytes(data[end - 4:end], 'big'):
            return False
        payload = data[offset + 8:end - 4]
        if kind == b'IHDR':
            if header or offset != 8 or size != 13:
                return False
            if (not int.from_bytes(payload[:4], 'big') or not int.from_bytes(payload[4:8], 'big')
                    or payload[8] not in depths.get(payload[9], ())
                    or payload[10] != 0 or payload[11] != 0 or payload[12] not in (0, 1)):
                return False
            header = True
        elif not header:
            return False
        elif kind == b'IDAT':
            image = True
        elif kind == b'IEND':
            return size == 0 and end == len(data) and image
        offset = end
    return False  # A complete, CRC-correct non-IEND chunk is not a terminator.


def _jpeg_structure(data):
    if data[:2] != b'\xff\xd8' or data[-2:] != b'\xff\xd9':
        return False
    offset, frame = 2, False
    while offset < len(data) - 2:
        if data[offset] != 0xff:
            return False
        while offset < len(data) and data[offset] == 0xff:
            offset += 1
        if offset >= len(data):
            return False
        marker = data[offset]
        offset += 1
        if marker == 0x01:  # Standalone TEM; no segment length.
            continue
        if marker == 0 or 0xd0 <= marker <= 0xd9 or offset + 2 > len(data) - 2:
            return False
        size = int.from_bytes(data[offset:offset + 2], 'big')
        end = offset + size
        if size < 2 or end > len(data) - 2:
            return False
        payload = data[offset + 2:end]
        if 0xc0 <= marker <= 0xcf and marker not in (0xc4, 0xc8, 0xcc):
            if (len(payload) < 6 or not payload[5] or len(payload) != 6 + 3 * payload[5]
                    or not int.from_bytes(payload[1:3], 'big') or not int.from_bytes(payload[3:5], 'big')):
                return False
            frame = True
        elif marker == 0xda:
            # Later scans, entropy bytes and appended MPF images remain opaque.
            return (frame and len(payload) >= 4 and payload[0] > 0
                    and len(payload) == 4 + 2 * payload[0] and end < len(data) - 2)
        offset = end
    return False


def _webp_image(kind, payload):
    if kind == b'VP8 ':
        return (len(payload) > 10 and payload[0] & 1 == 0 and payload[3:6] == b'\x9d\x01\x2a'
                and int.from_bytes(payload[6:8], 'little') & 0x3fff != 0
                and int.from_bytes(payload[8:10], 'little') & 0x3fff != 0)
    return len(payload) > 5 and payload[0] == 0x2f and payload[4] & 0xe0 == 0


def _webp_chunks(data, offset, end):
    """Yield flat bounded chunks; callers decide which payloads are images."""
    while offset + 8 <= end:
        kind = bytes(data[offset:offset + 4])
        size = int.from_bytes(data[offset + 4:offset + 8], 'little')
        stop = offset + 8 + size
        padded = stop + (size & 1)
        if padded > end or (size & 1 and data[stop] != 0):
            raise ValueError('Invalid WebP chunk bounds')
        payload = data[offset + 8:stop]
        yield offset, kind, payload
        offset = padded
    if offset != end:
        raise ValueError('Incomplete WebP chunk header')


def _webp_structure(data):
    if not (len(data) >= 20 and data[:4] == b'RIFF' and data[8:12] == b'WEBP'
            and int.from_bytes(data[4:8], 'little') + 8 == len(data)
            and data[12:16] in (b'VP8 ', b'VP8L', b'VP8X')):
        return False
    image = False
    try:
        for offset, kind, payload in _webp_chunks(data, 12, len(data)):
            if kind in (b'VP8 ', b'VP8L'):
                if not _webp_image(kind, payload):
                    return False
                image = True
            elif kind == b'VP8X':
                if offset != 12 or len(payload) != 10:
                    return False
            elif kind == b'ANMF':
                # Fixed frame header followed by flat image/alpha subchunks.
                # No recursion or interpretation of entropy/animation timing.
                if len(payload) < 16:
                    return False
                frame_image = False
                for _, subkind, encoded in _webp_chunks(payload, 16, len(payload)):
                    if subkind in (b'VP8X', b'ANMF'):
                        return False
                    if subkind in (b'VP8 ', b'VP8L'):
                        if not _webp_image(subkind, encoded):
                            return False
                        frame_image = True
                if not frame_image:
                    return False
                image = True
    except ValueError:
        return False
    return image


def _verified_inline(content_type, data):
    """Publication policy only: bounded structure/header checks, no pixel decode.

    PNG/JPEG/WebP encoded details remain opaque; GIF deliberately retains only
    its signature/trailer policy. Ready records keep this decision permanently.
    """
    if content_type not in INLINE_TYPES:
        return False
    data = memoryview(data)
    if content_type == 'image/png':
        valid = _png_structure(data)
    elif content_type == 'image/jpeg':
        valid = _jpeg_structure(data)
    elif content_type == 'image/webp':
        valid = _webp_structure(data)
    else:
        valid = len(data) >= 14 and data[:6] in (b'GIF87a', b'GIF89a') and data[-1:] == b';'
    if not valid:
        raise Refusal("MEDIA_INVALID", "The declared image type does not match its bytes", recorded=False)
    return True


def _identity(info):
    return info.st_dev, info.st_ino


class VerifiedMedia:
    def __init__(self, descriptor, data):
        self.descriptor = MappingProxyType(dict(descriptor))
        self._data, self._position = data, 0

    def read(self, max_bytes):
        if self._data is None:
            raise ValueError("Verified media is closed")
        if type(max_bytes) is not int or not 1 <= max_bytes <= 65536:
            raise ValueError("Read between 1 and 65536 bytes")
        data = self._data[self._position:self._position + max_bytes]
        self._position += len(data)
        return data

    def close(self):
        self._data = None

    def __enter__(self):
        return self

    def __exit__(self, *args):
        self.close()


class Media:
    def _media_owned(self, db, actor, media_id):
        row = db.execute("SELECT * FROM media_intents WHERE id=? AND actor_id=?", (_identifier(media_id, "media_id"), actor)).fetchone()
        if row is None:
            raise Refusal("FORBIDDEN", "No accessible media", recorded=False)
        return row

    def _check_media_reservation(self, db, actor, envelope):
        row = db.execute("SELECT * FROM media_intents WHERE actor_id=? AND publish_operation_id=?", (actor, envelope["operation_id"])).fetchone()
        if row is None and envelope["kind"] == "media.publish":
            row = self._media_owned(db, actor, envelope["target"].get("media_id"))
        if row is None:
            return
        if envelope["expected"]["authority"] != {"authority_id": row["authority_id"], "authority_epoch": row["authority_epoch"]}:
            raise AuthorityError("AUTHORITY_CHANGED", "This media publication belongs to its original authority epoch")
        if (envelope["operation_id"] != row["publish_operation_id"] or envelope["kind"] != "media.publish"
                or envelope["target"] != {"media_id": row["id"]} or envelope["args"] != {}
                or envelope["expected"] != {"authority": envelope["expected"]["authority"], "media_revision": 1}):
            raise Refusal("OPERATION_PAYLOAD_MISMATCH", "This operation is reserved for its exact media publication", recorded=False)

    def _command_media_begin(self, db, actor, envelope):
        args, target = envelope["args"], envelope["target"]
        if set(target) != {"media_id"} or set(args) != {"name", "content_type", "size_bytes", "sha256", "publish_operation_id"}:
            raise Refusal("INVALID_ARGUMENT", "Supply the complete media intent")
        media_id = _identifier(target["media_id"], "media_id")
        old = db.execute("SELECT revision FROM media_intents WHERE id=?", (media_id,)).fetchone()
        if old:
            self._media_owned(db, actor, media_id)
        _revision(envelope["expected"], "media_revision", old[0] if old else 0)
        if old:
            raise Refusal("REVISION_CONFLICT", "This media identity already exists")
        name, content_type, size, digest = (args[key] for key in ("name", "content_type", "size_bytes", "sha256"))
        if not isinstance(name, str) or not name or len(name.encode("utf-8")) > LIMITS["media_name_utf8_bytes"]:
            raise Refusal("INVALID_ARGUMENT", "Invalid media display name")
        if not isinstance(content_type, str) or len(content_type) > 127 or not re.fullmatch(r"[a-z0-9!#$&^_.+-]+/[a-z0-9!#$&^_.+-]+", content_type):
            raise Refusal("INVALID_ARGUMENT", "Use a bounded media type without parameters")
        cap = LIMITS["image_bytes"] if content_type.startswith("image/") else LIMITS["media_file_bytes"]
        if type(size) is not int or not 0 <= size <= cap:
            raise Refusal("INVALID_ARGUMENT", "Media exceeds the declared byte limit")
        if not isinstance(digest, str) or not re.fullmatch(r"[0-9a-f]{64}", digest):
            raise Refusal("INVALID_ARGUMENT", "Supply a SHA256 digest")
        publish_id = _identifier(args["publish_operation_id"], "publish_operation_id")
        if (publish_id == envelope["operation_id"]
                or db.execute("SELECT 1 FROM operations WHERE actor_id=? AND id=?", (actor, publish_id)).fetchone()
                or db.execute("SELECT 1 FROM submissions WHERE actor_id=? AND send_operation_id=?", (actor, publish_id)).fetchone()
                or db.execute("SELECT 1 FROM media_intents WHERE actor_id=? AND publish_operation_id=?", (actor, publish_id)).fetchone()):
            raise Refusal("OPERATION_PAYLOAD_MISMATCH", "Publication needs an unused reserved operation", recorded=False)
        pin = envelope["expected"]["authority"]
        db.execute("INSERT INTO media_intents(id,actor_id,revision,state,publish_operation_id,authority_id,authority_epoch,name,content_type,size_bytes,sha256,blob_key) VALUES (?,?,1,'pending',?,?,?,?,?,?,?,?)",
                   (media_id, actor, publish_id, pin["authority_id"], pin["authority_epoch"], name, content_type, size, digest, uuid.uuid4().hex))
        self._change(db, "actor", actor, "media", media_id, 1)
        return {"media_id": media_id, "media_revision": 1, "state": "pending"}, [{"kind": "media", "id": media_id, "version": 1}]

    def _command_media_publish(self, db, actor, envelope):
        raise Refusal("MEDIA_BYTES_REQUIRED", "Publish through the verified byte stream", recorded=False)

    def _publication_intent(self, db, actor, envelope):
        if envelope["kind"] != "media.publish":
            raise Refusal("INVALID_ARGUMENT", "The byte stream requires media.publish")
        row = self._media_owned(db, actor, envelope["target"]["media_id"])
        _revision(envelope["expected"], "media_revision", row["revision"])
        return dict(row)

    @contextmanager
    def _media_root(self, create=False):
        path = Path(str(self.path) + ".media")
        if create:
            try:
                path.mkdir(mode=0o700)
            except FileExistsError:
                pass
            else:
                parent = os.open(str(path.parent), os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
                try:
                    os.fsync(parent)
                finally:
                    os.close(parent)
        fd = os.open(str(path), os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW | os.O_NONBLOCK)
        try:
            held = os.fstat(fd)
            if held.st_uid != os.getuid() or held.st_mode & 0o077:
                raise Refusal("MEDIA_UNAVAILABLE", "Media storage is unavailable", recorded=False)
            self._verify_media_root(path, fd)
            yield path, fd
            self._verify_media_root(path, fd)
        finally:
            os.close(fd)

    def _verify_media_root(self, path, fd):
        current = path.lstat()
        if not stat.S_ISDIR(current.st_mode) or _identity(current) != _identity(os.fstat(fd)):
            raise Refusal("MEDIA_UNAVAILABLE", "Media storage changed", recorded=False)

    def _capture_media(self, root_fd, row, sync=False):
        fd = os.open(row["blob_key"], os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK, dir_fd=root_fd)
        try:
            before = os.fstat(fd)
            if (not stat.S_ISREG(before.st_mode) or before.st_uid != os.getuid() or before.st_mode & 0o077
                    or before.st_size != row["size_bytes"] or before.st_size > LIMITS["media_file_bytes"]):
                raise Refusal("MEDIA_UNAVAILABLE", "Media bytes are unavailable", recorded=False)
            output, digest, total = io.BytesIO(), hashlib.sha256(), 0
            while total <= row["size_bytes"]:
                chunk = os.read(fd, min(65536, row["size_bytes"] + 1 - total))
                if not chunk:
                    break
                output.write(chunk)
                digest.update(chunk)
                total += len(chunk)
            after = os.fstat(fd)
            named = os.stat(row["blob_key"], dir_fd=root_fd, follow_symlinks=False)
            if (total != row["size_bytes"] or digest.hexdigest() != row["sha256"]
                    or _identity(before) != _identity(named) or not stat.S_ISREG(named.st_mode)
                    or (before.st_size, before.st_mtime_ns, before.st_mode, before.st_uid) != (after.st_size, after.st_mtime_ns, after.st_mode, after.st_uid)):
                raise Refusal("MEDIA_UNAVAILABLE", "Media bytes changed or failed verification", recorded=False)
            data = output.getvalue()
            # Integrity binds the exact bytes to the intent. Re-running today's
            # publication policy would revoke already-ready records and parse
            # under the retry fence; neither belongs in a capture.
            if sync:
                os.fsync(fd)
            return data
        finally:
            os.close(fd)

    def _publish_bytes(self, row, byte_stream):
        with self._media_root(create=True) as (root, root_fd):
            stage = ".staging-" + uuid.uuid4().hex
            fd = os.open(stage, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600, dir_fd=root_fd)
            owned = _identity(os.fstat(fd))
            try:
                total, digest = 0, hashlib.sha256()
                image = bytearray() if row["content_type"] in INLINE_TYPES else None
                while total <= row["size_bytes"]:
                    request = min(65536, row["size_bytes"] + 1 - total)
                    chunk = byte_stream.read(request)
                    if not isinstance(chunk, bytes) or len(chunk) > request:
                        raise Refusal("MEDIA_INVALID", "The byte stream violated its read bound", recorded=False)
                    if not chunk:
                        break
                    total += len(chunk)
                    if total > row["size_bytes"]:
                        raise Refusal("MEDIA_INVALID", "Media length does not match its intent", recorded=False)
                    digest.update(chunk)
                    if image is not None:
                        image.extend(chunk)
                    view = memoryview(chunk)
                    while view:
                        written = os.write(fd, view)
                        if written <= 0:
                            raise OSError("Media write made no progress")
                        view = view[written:]
                if total != row["size_bytes"] or digest.hexdigest() != row["sha256"]:
                    raise Refusal("MEDIA_INVALID", "Media bytes do not match the declared length and digest", recorded=False)
                inline = _verified_inline(row["content_type"], image)
                os.fsync(fd)
                os.close(fd)
                fd = None
                # Publication, unlike streaming, is fenced against cutover. It
                # holds no SQLite transaction and never overwrites a final file.
                with self._authority.shared() as fence:
                    self._verify_media_root(root, root_fd)
                    try:
                        os.link(stage, row["blob_key"], src_dir_fd=root_fd, dst_dir_fd=root_fd, follow_symlinks=False)
                        final = os.stat(row["blob_key"], dir_fd=root_fd, follow_symlinks=False)
                        if not stat.S_ISREG(final.st_mode) or _identity(final) != owned:
                            raise Refusal("MEDIA_UNAVAILABLE", "The published file is not the verified staging inode", recorded=False)
                    except FileExistsError:
                        self._capture_media(root_fd, row, sync=True)
                    os.unlink(stage, dir_fd=root_fd)
                    os.fsync(root_fd)
                    fence.verify()
                return inline
            finally:
                if fd is not None:
                    os.close(fd)
                try:
                    if _identity(os.stat(stage, dir_fd=root_fd, follow_symlinks=False)) == owned:
                        os.unlink(stage, dir_fd=root_fd)
                except FileNotFoundError:
                    pass

    def publish_media(self, actor, envelope, byte_stream):
        prepared = self._execute_command(actor, envelope, preflight=self._publication_intent)
        if "blob_key" not in prepared:
            return prepared
        try:
            inline = self._publish_bytes(prepared, byte_stream)
        except AuthorityError as error:
            return self._receipt(envelope, "retryable" if error.retryable else "rejected", False,
                                 error={"code": error.code, "message": error.message, "retryable": error.retryable})
        except Refusal as error:
            return self._refusal(envelope, error)
        except OSError:
            return self._receipt(envelope, "retryable", False, error={"code": "MEDIA_UNCONFIRMED", "message": "Publication was not confirmed; retain and reconcile its operation", "retryable": True})
        def commit_ready(db, actor, envelope):
            row = self._media_owned(db, actor, envelope["target"]["media_id"])
            _revision(envelope["expected"], "media_revision", row["revision"])
            if dict(row) != prepared:
                raise Refusal("REVISION_CONFLICT", "The media intent changed")
            db.execute("UPDATE media_intents SET revision=2,state='ready',inline=? WHERE id=?", (int(inline), row["id"]))
            self._change(db, "actor", actor, "media", row["id"], 2)
            return dict(self._media_descriptor(row), inline=inline, media_revision=2, state="ready"), [{"kind": "media", "id": row["id"], "version": 2}]
        return self._execute_command(actor, envelope, effect=commit_ready)

    def _media_descriptor(self, row):
        return {"instance_id": self.instance_id, "media_id": row["id"], "name": row["name"],
                "content_type": row["content_type"], "size_bytes": row["size_bytes"],
                "sha256": row["sha256"], "inline": bool(row["inline"])}

    def _media_access(self, db, actor, args):
        media_id = _identifier(args.get("media_id"), "media_id")
        row = db.execute("SELECT * FROM media_intents WHERE id=?", (media_id,)).fetchone()
        if "source_ref" in args:
            source = self._source(db, actor, args["source_ref"])
            if source.get("withheld") and source["source_ref"].get("kind") == "message":
                # A message its author has open in Edit is held from agents, its attachments too (docs/message-edit.md).
                raise held_refusal(source["source_ref"]["id"])
            allowed = any(ref.get("id") == media_id for ref in source["attachments"])
        else:
            allowed = row is not None and row["actor_id"] == actor
        if row is None or not allowed:
            raise Refusal("FORBIDDEN", "No accessible media", recorded=False)
        return row

    def _view_media(self, db, actor, args):
        row = self._media_access(db, actor, args)
        return dict(self._media_descriptor(row), state=row["state"], media_revision=row["revision"])

    def open_media(self, actor, args):
        from .store import _connect
        from .validation import _view_arguments
        args = _view_arguments("media", args)
        with self._authority.shared() as fence:
            db, _ = _connect(self.path)
            try:
                db.execute("BEGIN")
                fence.verify()
                self._check_instance(db)
                self._actor(db, actor)
                row = dict(self._media_access(db, actor, args))
                if row["state"] != "ready":
                    raise Refusal("ATTACHMENT_NOT_READY", "Media is still pending", recorded=False)
            finally:
                db.close()
        try:
            with self._media_root() as (_, root_fd):
                data = self._capture_media(root_fd, row)
        except OSError as error:
            raise Refusal("MEDIA_UNAVAILABLE", "Media bytes are unavailable", recorded=False) from error
        return VerifiedMedia(self._media_descriptor(row), data)

    def _attachment_refs(self, db, actor, refs, ready=False, retained=()):
        if not isinstance(refs, list) or len(refs) > LIMITS["attachment_count"]:
            raise Refusal("TOO_MANY_ATTACHMENTS", "Attachment count exceeds the limit")
        result, size = [], 0
        for ref in refs:
            if not isinstance(ref, dict) or "id" not in ref:
                raise Refusal("INVALID_ARGUMENT", "An attachment must name its media intent")
            media_id = _identifier(ref["id"], "attachment.id")
            row = db.execute("SELECT * FROM media_intents WHERE id=?", (media_id,)).fetchone()
            if row is None or (row["actor_id"] != actor and media_id not in retained):
                raise Refusal("FORBIDDEN", "No accessible attachment")
            descriptor = self._media_descriptor(row)
            descriptor = {key: value for key, value in descriptor.items() if key not in ("instance_id", "media_id")}
            descriptor["id"] = media_id
            if ref != {"id": media_id} and ref != descriptor:
                raise Refusal("INVALID_ARGUMENT", "Attachment metadata cannot override its intent")
            if ready and row["state"] != "ready":
                raise Refusal("ATTACHMENT_NOT_READY", "Every attachment must be ready before preparing or publishing")
            size += row["size_bytes"]
            if size > LIMITS["attachment_bytes"]:
                raise Refusal("TOO_MANY_ATTACHMENTS", "Combined attachment bytes exceed the limit")
            result.append(descriptor if ready else {"id": media_id})
        return result

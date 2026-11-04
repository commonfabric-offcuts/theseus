from __future__ import annotations

import fcntl
import json
import os
from pathlib import Path
import stat
import uuid

from .contract import StoreError, _identifier, _json


class AuthorityError(StoreError):
    def __init__(self, code, message, retryable=False):
        self.code, self.message, self.retryable = code, message, retryable
        super().__init__(message)


class GuardBusy(AuthorityError):
    def __init__(self):
        self.holder = "unknown"
        super().__init__("blocked_by_guard", "An existing runner or owned child still holds the guard", retryable=True)


def _changed():
    return AuthorityError("AUTHORITY_CHANGED", "Binding changed: activate a recovery copy at a new path")


def _absolute(value, *, canonical=False):
    try:
        path = Path(value)
        if not path.is_absolute():
            raise ValueError("not absolute")
        resolved = path.resolve()
        if canonical and os.fspath(value) != str(resolved):
            raise ValueError("authority path is not canonical")
        return resolved
    except (ValueError, TypeError, OSError, RuntimeError):
        raise AuthorityError("INVALID_BINDING", "Use an explicit canonical authority path without symlink traversal")


def _private_parent(path):
    info = path.parent.stat()
    if not stat.S_ISDIR(info.st_mode) or info.st_uid != os.getuid() or info.st_mode & 0o077:
        raise AuthorityError("INVALID_BINDING", "Authority control files need a private directory owned by this user")


def _open_private(path, flags):
    _private_parent(path)
    fd = os.open(str(path), flags | os.O_NOFOLLOW | os.O_NONBLOCK)
    info = os.fstat(fd)
    if not stat.S_ISREG(info.st_mode) or info.st_uid != os.getuid() or info.st_mode & 0o077:
        os.close(fd)
        raise _changed()
    return fd


def _unique(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise _changed()
        result[key] = value
    return result


def _invalid_constant(value):
    raise _changed()


ANCHOR_FIELDS = {"v", "authority_id", "instance_id", "epoch", "state", "db_path", "db_device", "db_inode",
                 "lock_device", "lock_inode", "runner_lock_device", "runner_lock_inode"}


def _read_anchor(path):
    fd = None
    try:
        fd = _open_private(path, os.O_RDONLY)
        with os.fdopen(fd, "rb") as stream:
            fd = None
            data = stream.read(65537)
        if len(data) > 65536:
            raise _changed()
        result = json.loads(data.decode("utf-8"), object_pairs_hook=_unique, parse_constant=_invalid_constant)
        if not isinstance(result, dict) or type(result.get("v")) is not int or result["v"] != 1:
            raise _changed()
        if not ANCHOR_FIELDS <= set(result) or set(result) - ANCHOR_FIELDS - {"activation_id", "recovery"}:
            raise _changed()
        return result
    except (OSError, ValueError, UnicodeError, RecursionError):
        raise _changed()
    finally:
        if fd is not None:
            os.close(fd)


def prepare_authority(authority_path, db_path, instance_id):
    """Create stable lock inodes only. The authority is not active until publish."""
    anchor = _absolute(authority_path, canonical=True)
    anchor.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    _private_parent(anchor)
    if anchor.exists():
        raise AuthorityError("INVALID_BINDING", "An existing authority is never replaced by initialization")
    record = {"v": 1, "authority_id": "a-" + uuid.uuid4().hex, "instance_id": instance_id,
              "epoch": "e-" + uuid.uuid4().hex, "state": "active", "db_path": str(_absolute(db_path)),
              "recovery": {"kind": "initial", "history_complete": True}}
    for suffix, prefix in ((".lock", "lock"), (".runner.lock", "runner_lock")):
        fd = os.open(str(anchor) + suffix, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
        try:
            info = os.fstat(fd)
            record[prefix + "_device"], record[prefix + "_inode"] = info.st_dev, info.st_ino
            os.fsync(fd)
        finally:
            os.close(fd)
    info = os.stat(str(db_path), follow_symlinks=False)
    record.update(db_device=info.st_dev, db_inode=info.st_ino)
    binding = {"authority_path": str(anchor), "authority_id": record["authority_id"], "authority_epoch": record["epoch"]}
    return binding, record


def publish_initial(binding, record):
    """Publish the only initial binding after the new database is durable."""
    path = Path(binding["authority_path"])
    fd = os.open(str(path), os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
    with os.fdopen(fd, "wb") as stream:
        stream.write((_json(record) + "\n").encode("utf-8"))
        stream.flush()
        os.fsync(stream.fileno())
    directory = os.open(str(path.parent), os.O_RDONLY)
    try:
        os.fsync(directory)
    finally:
        os.close(directory)


class Authority:
    def __init__(self, db_path, instance_id, expected_binding):
        if not isinstance(expected_binding, dict) or set(expected_binding) != {"authority_path", "authority_id", "authority_epoch"}:
            raise AuthorityError("INVALID_BINDING", "Use the explicit authority binding returned by initialize")
        try:
            _identifier(expected_binding["authority_id"], "authority_id")
            _identifier(expected_binding["authority_epoch"], "authority_epoch")
        except Exception as error:
            raise AuthorityError("INVALID_BINDING", "Invalid authority identity") from error
        self.path = _absolute(expected_binding["authority_path"], canonical=True)
        self.db_path = _absolute(db_path)
        self.instance_id = instance_id
        self.binding = dict(expected_binding, authority_path=str(self.path))

    def shared(self):
        return AuthorityFence(self)

    def runner_guard(self, runner_id):
        return RunnerGuard(self, runner_id)

    def facts(self, validated_record):
        # These are display facts, never permission to replay an old-epoch act.
        # Missing metadata cannot establish the absence of a recovery gap.
        recovery = validated_record.get("recovery")
        continuity = "unknown"
        if isinstance(recovery, dict):
            if recovery.get("history_complete") is False:
                continuity = "incomplete"
            elif recovery.get("history_complete") is True:
                continuity = "initial" if recovery.get("kind") == "initial" else "complete"
        return {"authority_id": self.binding["authority_id"], "authority_epoch": self.binding["authority_epoch"],
                "continuity": continuity}

    def _verify_lock(self, fd, suffix, prefix, record):
        held = os.fstat(fd)
        current = os.stat(str(self.path) + suffix, follow_symlinks=False)
        if (not stat.S_ISREG(current.st_mode) or (held.st_dev, held.st_ino) != (current.st_dev, current.st_ino)
                or (held.st_dev, held.st_ino) != (record.get(prefix + "_device"), record.get(prefix + "_inode"))):
            raise _changed()

    def _validate(self, fd):
        record = _read_anchor(self.path)
        self._verify_lock(fd, ".lock", "lock", record)
        if (record.get("authority_id") != self.binding["authority_id"] or record.get("epoch") != self.binding["authority_epoch"]
                or record.get("instance_id") != self.instance_id or record.get("state") != "active"
                or record.get("db_path") != str(self.db_path)):
            raise _changed()
        info = os.stat(str(self.db_path), follow_symlinks=False)
        if (not stat.S_ISREG(info.st_mode) or info.st_uid != os.getuid() or info.st_mode & 0o077
                or (info.st_dev, info.st_ino) != (record.get("db_device"), record.get("db_inode"))):
            raise _changed()
        return record


class AuthorityFence:
    def __init__(self, authority):
        self.authority = authority
        self._fd = None
        self.record = None

    def __enter__(self):
        if self._fd is not None:
            raise AuthorityError("INVALID_BINDING", "A fence cannot be entered twice")
        try:
            self._fd = _open_private(Path(str(self.authority.path) + ".lock"), os.O_RDWR)
            try:
                fcntl.flock(self._fd, fcntl.LOCK_SH | fcntl.LOCK_NB)
            except BlockingIOError:
                raise AuthorityError("AUTHORITY_BUSY", "Authority is being changed; reconcile this attempt later", retryable=True)
            self.record = self.authority._validate(self._fd)
            return self
        except OSError as error:
            self.close()
            raise _changed() from error
        except BaseException:
            self.close()
            raise

    def close(self):
        if self._fd is not None:
            fd, self._fd = self._fd, None
            # Never LOCK_UN: a child may hold this same open-file description.
            os.close(fd)

    def verify(self):
        if self._fd is None:
            raise AuthorityError("INVALID_BINDING", "The authority fence is not held")
        try:
            self.record = self.authority._validate(self._fd)
        except OSError as error:
            raise _changed() from error

    def __exit__(self, *unused):
        self.close()


class RunnerGuard(AuthorityFence):
    def __init__(self, authority, runner_id):
        super().__init__(authority)
        self.runner_id = _identifier(runner_id, "runner_id")
        self._runner_fd = None

    def __enter__(self):
        super().__enter__()
        try:
            self._runner_fd = _open_private(Path(str(self.authority.path) + ".runner.lock"), os.O_RDWR)
            try:
                fcntl.flock(self._runner_fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
            except BlockingIOError:
                raise GuardBusy()
            self.authority._verify_lock(self._runner_fd, ".runner.lock", "runner_lock", self.record)
            return self
        except OSError as error:
            self.close()
            raise _changed() from error
        except BaseException:
            self.close()
            raise

    @property
    def pass_fds(self):
        self.verify()
        return (self._fd, self._runner_fd)

    @property
    def binding(self):
        return dict(self.authority.binding, instance_id=self.authority.instance_id, db_path=str(self.authority.db_path))

    def verify(self):
        if self._fd is None or self._runner_fd is None:
            raise AuthorityError("INVALID_BINDING", "The runner guard is not held")
        super().verify()
        try:
            self.authority._verify_lock(self._runner_fd, ".runner.lock", "runner_lock", self.record)
        except OSError as error:
            raise _changed() from error

    def close(self):
        if self._runner_fd is not None:
            fd, self._runner_fd = self._runner_fd, None
            os.close(fd)
        super().close()

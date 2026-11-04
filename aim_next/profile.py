from __future__ import annotations

from dataclasses import dataclass
import json
import os
from pathlib import Path
import stat

from aim_next.store import Store, StoreError


MAX_PROFILE_BYTES = 65536
BINDING_FIELDS = {"authority_path", "authority_id", "authority_epoch"}


class ProfileError(Exception):
    """An explicit local actor/instance binding cannot be used."""

    def __init__(self, message, *, code=None, retryable=False):
        super().__init__(message)
        self.code = code
        self.retryable = retryable


@dataclass(frozen=True)
class Profile:
    instance_id: str
    actor_id: str
    db_path: Path
    authority_path: Path
    authority_id: str
    authority_epoch: str

    @property
    def binding(self):
        # Return a copy; a caller cannot silently rebind an already loaded profile.
        return {"authority_path": str(self.authority_path), "authority_id": self.authority_id,
                "authority_epoch": self.authority_epoch}

    def store(self):
        return Store(self.db_path, self.instance_id, expected_binding=self.binding)


def _unique(pairs):
    value = {}
    for key, item in pairs:
        if key in value:
            raise ProfileError("Duplicate profile field")
        value[key] = item
    return value


def _identity(value):
    return isinstance(value, str) and 0 < len(value) <= 200 and all(ord(c) >= 32 for c in value)


def _absolute_path(value):
    return isinstance(value, str) and "\x00" not in value and Path(value).is_absolute()


def _canonical_authority_path(value):
    try:
        canonical = Path(value).resolve()
    except (OSError, RuntimeError, ValueError) as error:
        raise ProfileError("Use the explicit canonical authority path without symlink traversal") from error
    if str(canonical) != value:
        raise ProfileError("Use the explicit canonical authority path without symlink traversal")
    return canonical


def _validated(value):
    if (not isinstance(value, dict)
            or set(value) != {"v", "instance_id", "actor_id", "db_path"} | BINDING_FIELDS
            or type(value.get("v")) is not int or value["v"] != 2
            or not _identity(value.get("instance_id")) or not _identity(value.get("actor_id"))
            or not _identity(value.get("authority_id")) or not _identity(value.get("authority_epoch"))
            or not _absolute_path(value.get("db_path")) or not _absolute_path(value.get("authority_path"))):
        raise ProfileError("Use an explicit v2 profile with instance, actor, database and authority binding")
    profile = Profile(value["instance_id"], value["actor_id"], Path(value["db_path"]).resolve(),
                      _canonical_authority_path(value["authority_path"]),
                      value["authority_id"], value["authority_epoch"])
    try:
        capabilities = profile.store().view(profile.actor_id, "capabilities", {})
    except StoreError as error:
        raise ProfileError(str(error), code=getattr(error, "code", None),
                           retryable=getattr(error, "retryable", False)) from error
    except (OSError, ValueError) as error:
        raise ProfileError("The bound instance cannot be opened", code="STORE_OPEN_UNCONFIRMED") from error
    if capabilities.get("error"):
        error = capabilities["error"]
        raise ProfileError(error.get("message", "The bound instance cannot be opened"),
                           code=error.get("code"), retryable=error.get("retryable", False))
    if (capabilities.get("instance_id") != profile.instance_id
            or not isinstance(capabilities.get("limits"), dict)):
        raise ProfileError("The profile has no active actor binding in this instance")
    return profile


def load_profile(path):
    """No default search, actor override, creation or fallback to another store."""
    fd = None
    try:
        fd = os.open(str(path), os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
        info = os.fstat(fd)
        if (not stat.S_ISREG(info.st_mode) or info.st_uid != os.getuid()
                or info.st_mode & 0o077 or info.st_size > MAX_PROFILE_BYTES):
            raise ProfileError("Use a private regular profile owned by this user")
        with os.fdopen(fd, "rb") as source:
            fd = None
            raw = source.read(MAX_PROFILE_BYTES + 1)
        if len(raw) > MAX_PROFILE_BYTES:
            raise ProfileError("Profile exceeds its size limit")
        return _validated(json.loads(raw.decode("utf-8"), object_pairs_hook=_unique))
    except (OSError, ValueError, UnicodeError, RecursionError) as error:
        raise ProfileError("The explicit profile could not be read") from error
    finally:
        if fd is not None:
            os.close(fd)


def write_profile(path, db_path, instance_id, actor_id, *, binding):
    """Establish a new binding only; existing profiles are never overwritten."""
    if not isinstance(binding, dict) or set(binding) != BINDING_FIELDS:
        raise ProfileError("Provide the exact explicit authority binding returned by initialization or activation")
    value = dict(binding, v=2, instance_id=instance_id, actor_id=actor_id, db_path=str(db_path))
    profile = _validated(value)
    value["db_path"] = str(profile.db_path)
    payload = (json.dumps(value, ensure_ascii=False, separators=(",", ":")) + "\n").encode("utf-8")
    destination = Path(path)
    fd = None
    try:
        fd = os.open(str(destination), os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
        with os.fdopen(fd, "wb") as target:
            fd = None
            target.write(payload)
            target.flush()
            os.fsync(target.fileno())
        # Publish the directory entry durably too. A failed write remains an
        # explicit incomplete profile; never silently reuse or delete it.
        directory = os.open(str(destination.parent), os.O_RDONLY)
        try:
            os.fsync(directory)
        finally:
            os.close(directory)
    except OSError as error:
        raise ProfileError("The new profile could not be created; existing paths are preserved") from error
    finally:
        if fd is not None:
            os.close(fd)
    return profile

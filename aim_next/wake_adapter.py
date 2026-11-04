from __future__ import annotations

from dataclasses import dataclass
import json
import os
from pathlib import Path
import stat

from .authority import AuthorityError, RunnerGuard
from .profile import ProfileError, load_profile


MAX_ROUTE_BYTES = 65536
MAX_ARG_BYTES = 16384
MAX_STDIN_BYTES = 8192
BINDING_FIELDS = {"instance_id", "actor_id", "db_path", "authority_id", "authority_epoch"}
CLAIM_FIELDS = {"attempt_id", "claim_token", "recipient_id", "wake_generation",
                "captured_seq", "lease_until_ms", "route_binding"}


class RouteUnavailable(Exception):
    """A selected route cannot be used; the reason contains no local data."""

    def __init__(self, code):
        self.code = code
        super().__init__(code)


@dataclass(frozen=True)
class PreparedRoute:
    # Internal, ephemeral data, not a receipt or authorization to dispatch later.
    argv: tuple
    stdin: bytes
    executable: str


def _identity(value):
    return isinstance(value, str) and 0 < len(value) <= 200 and all(ord(c) >= 32 for c in value)


def _absolute(value):
    return isinstance(value, str) and "\x00" not in value and Path(value).is_absolute()


def _unique(pairs):
    value = {}
    for key, item in pairs:
        if key in value:
            raise RouteUnavailable("invalid_route")
        value[key] = item
    return value


def _constant(unused):
    raise RouteUnavailable("invalid_route")


def _read_route(path):
    fd = None
    try:
        if path is None or not _absolute(os.fspath(path)):
            raise RouteUnavailable("missing_route")
        fd = os.open(os.fspath(path), os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
        info = os.fstat(fd)
        if (not stat.S_ISREG(info.st_mode) or info.st_uid != os.getuid()
                or info.st_mode & 0o077 or info.st_size > MAX_ROUTE_BYTES):
            raise RouteUnavailable("invalid_route")
        with os.fdopen(fd, "rb") as source:
            fd = None
            raw = source.read(MAX_ROUTE_BYTES + 1)
        if len(raw) > MAX_ROUTE_BYTES:
            raise RouteUnavailable("invalid_route")
        return json.loads(raw.decode("utf-8"), object_pairs_hook=_unique, parse_constant=_constant)
    except (OSError, ValueError, UnicodeError, RecursionError) as error:
        raise RouteUnavailable("invalid_route") from error
    finally:
        if fd is not None:
            os.close(fd)


def _executable(value):
    try:
        executable = Path(value).resolve(strict=True)
        info = executable.stat()
        if (not stat.S_ISREG(info.st_mode) or not os.access(str(executable), os.X_OK)
                or info.st_uid not in (0, os.getuid()) or info.st_mode & 0o022):
            raise RouteUnavailable("invalid_executable")
        for parent in executable.parents:
            info = parent.stat()
            if (not stat.S_ISDIR(info.st_mode) or info.st_uid not in (0, os.getuid())
                    or info.st_mode & 0o022):
                raise RouteUnavailable("invalid_executable")
        return str(executable)
    except (OSError, ValueError, RuntimeError) as error:
        raise RouteUnavailable("invalid_executable") from error


def _claim(value):
    if not isinstance(value, dict) or set(value) != CLAIM_FIELDS:
        raise RouteUnavailable("invalid_claim")
    if any(not _identity(value[key]) for key in ("attempt_id", "claim_token", "recipient_id")):
        raise RouteUnavailable("invalid_claim")
    if any(type(value[key]) is not int or not 0 <= value[key] <= 9223372036854775807
           for key in ("wake_generation", "captured_seq", "lease_until_ms")):
        raise RouteUnavailable("invalid_claim")
    binding = value["route_binding"]
    if (not isinstance(binding, dict) or set(binding) != BINDING_FIELDS
            or any(not _identity(binding[key]) for key in BINDING_FIELDS - {"db_path"})
            or not _absolute(binding["db_path"]) or binding["actor_id"] != value["recipient_id"]):
        raise RouteUnavailable("invalid_claim")
    return binding


def prepare_route(route_path, claim, guard):
    """Validate one explicit route against a captured claim and a real held guard.

    This reads only; it neither starts a child nor proves a durable runner lease.
    The invocation layer must revalidate ownership, remaining time and this guard
    immediately before spawning. A PreparedRoute must never be kept as authority.
    """
    binding = _claim(claim)
    if not isinstance(guard, RunnerGuard):
        raise RouteUnavailable("invalid_guard")
    try:
        guard.verify()
        value = _read_route(route_path)
        if (not isinstance(value, dict) or set(value) != {"v", "profile", "argv"}
                or type(value["v"]) is not int or value["v"] != 1
                or not _absolute(value["profile"])):
            raise RouteUnavailable("invalid_route")
        argv = value["argv"]
        if (not isinstance(argv, list) or not 1 <= len(argv) <= 32
                or any(not isinstance(arg, str) or "\x00" in arg for arg in argv)
                or not _absolute(argv[0])):
            raise RouteUnavailable("invalid_route")
        if sum(len(arg.encode("utf-8")) + 1 for arg in argv) > MAX_ARG_BYTES:
            raise RouteUnavailable("invalid_route")
        profile = load_profile(value["profile"])
        actual = {"instance_id": profile.instance_id, "actor_id": profile.actor_id,
                  "db_path": str(profile.db_path), "authority_id": profile.authority_id,
                  "authority_epoch": profile.authority_epoch}
        if actual != binding:
            raise RouteUnavailable("binding_mismatch")
        if guard.binding != dict(profile.binding, instance_id=profile.instance_id, db_path=str(profile.db_path)):
            raise RouteUnavailable("guard_mismatch")
        executable = _executable(argv[0])
        payload = {"v": 1, "binding": dict(binding), "wake_generation": claim["wake_generation"],
                   "attempt_id": claim["attempt_id"]}
        encoded = (json.dumps(payload, ensure_ascii=False, separators=(",", ":")) + "\n").encode("utf-8")
        if len(encoded) > MAX_STDIN_BYTES:
            raise RouteUnavailable("invalid_claim")
        guard.verify()
        return PreparedRoute(tuple(argv), encoded, executable)
    except ProfileError as error:
        raise RouteUnavailable("profile_unavailable") from error
    except AuthorityError as error:
        raise RouteUnavailable("authority_unavailable") from error
    except UnicodeError as error:
        raise RouteUnavailable("invalid_route") from error

from __future__ import annotations

import json
import os
from pathlib import Path
import uuid

from .authority import AuthorityError, _absolute, _open_private, _private_parent, _read_anchor, _unique
from .contract import Refusal, _body, _identifier, _json


VERSION = "aim-next-initialization-1"


def marker_path(anchor):
    return Path(str(anchor) + ".initialization.json")


def incomplete():
    return AuthorityError("INITIALIZATION_INCOMPLETE", "Initialization did not complete. Preserve its artifacts and inspect the selected local paths; they will not be reused automatically")


def diagnose(anchor):
    # Presence is only a failure diagnostic, never authority or proof that the
    # named artifacts belong to us. Even a partially written marker is useful.
    marker = marker_path(anchor)
    if not os.path.lexists(marker):
        return
    try:
        fd = _open_private(marker, os.O_RDONLY)
        with os.fdopen(fd, "rb") as stream:
            record = json.loads(stream.read(65537).decode("utf-8"), object_pairs_hook=_unique)
        if isinstance(record, dict) and record.get("v") == VERSION and record.get("status") == "complete":
            return
    except (AuthorityError, OSError, ValueError, UnicodeError, RecursionError):
        pass
    raise incomplete()


def preflight(db_path, instance_id, actors, authority_path):
    """Validate all caller inputs and occupied paths without creating anything."""
    try:
        _identifier(instance_id, "instance_id").encode("utf-8")
        if not isinstance(actors, list) or not actors:
            raise ValueError("actors")
        normalized, seen = [], set()
        for actor in actors:
            if not isinstance(actor, dict) or set(actor) - {"id", "kind", "name"}:
                raise ValueError("actor")
            identity = _identifier(actor.get("id"), "actor_id")
            identity.encode("utf-8")
            kind = actor.get("kind", "agent")
            if kind not in ("human", "agent") or identity in seen:
                raise ValueError("actor")
            name = _body(actor.get("name", identity))
            normalized.append((identity, kind, name))
            seen.add(identity)
        path = _absolute(db_path)
        anchor = _absolute(authority_path, canonical=True)
        controls = [anchor, marker_path(anchor), Path(str(anchor) + ".lock"), Path(str(anchor) + ".runner.lock")]
        database_files = [path] + [Path(str(path) + suffix) for suffix in ("-journal", "-wal", "-shm")]
        if any(a == b or a in b.parents or b in a.parents for a in database_files for b in controls):
            raise ValueError("overlapping paths")
        # Detect a file in a parent position before writing the other tree.
        for selected in (path, anchor):
            for parent in selected.parents:
                if parent.exists() and not parent.is_dir():
                    raise ValueError("parent is not a directory")
        if anchor.parent.exists():
            _private_parent(anchor)
    except (Refusal, AuthorityError, ValueError, TypeError, OSError, RuntimeError) as error:
        raise AuthorityError("INVALID_INITIALIZATION", "Use valid actors, an absolute database path and a distinct canonical authority path in a private directory") from error

    # A published anchor wins over the informational marker. Initialization
    # still refuses to adopt it or synthesize a binding for the caller.
    if os.path.lexists(anchor):
        try:
            _read_anchor(anchor)
        except AuthorityError:
            diagnose(anchor)
        raise AuthorityError("ALREADY_INITIALIZED", "The authority path is occupied and will not be replaced")
    diagnose(anchor)
    if any(os.path.lexists(p) for p in controls + database_files + [Path(db_path)]):
        raise AuthorityError("INITIALIZATION_PATH_OCCUPIED", "Selected initialization paths are occupied and will not be adopted or replaced")
    return path, anchor, normalized


def _sync_directory(path):
    fd = os.open(str(path), os.O_RDONLY)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)


def _write_new(path, record):
    fd = os.open(str(path), os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
    with os.fdopen(fd, "wb") as stream:
        stream.write((_json(record) + "\n").encode("utf-8"))
        stream.flush()
        os.fsync(stream.fileno())
    _sync_directory(path.parent)


def begin(anchor, path, instance_id):
    anchor.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    _private_parent(anchor)
    record = {"v": VERSION, "attempt_id": uuid.uuid4().hex, "status": "incomplete",
              "instance_id": instance_id, "authority_path": str(anchor), "db_path": str(path)}
    _write_new(marker_path(anchor), record)
    return record


def complete(anchor, record):
    # Never rewrite the only diagnostic in place. A crash before replace leaves
    # it incomplete, and a valid anchor remains authoritative in either case.
    marker = marker_path(anchor)
    temporary = Path(str(marker) + "." + record["attempt_id"] + ".complete")
    _write_new(temporary, dict(record, status="complete"))
    os.replace(temporary, marker)
    _sync_directory(marker.parent)

from __future__ import annotations

import hashlib
import json
import os
from pathlib import Path
import sqlite3
import uuid

from .contract import Refusal, StoreError, _identifier, _json
from .runner_faults import busy


MAX_PIN_BYTES = 8192
BINDING_FIELDS = {"instance_id", "actor_id", "db_path", "authority_id", "authority_epoch"}
DESTINATION_FIELDS = {"kind", "protocol_version", "codex_home", "thread_id"}
QUEUE_KIND, HOSTED_KIND = "codex-queue-stdio", "codex-hosted-stdio"


class RoutePinError(StoreError):
    def __init__(self, code, message, retryable=False):
        self.code, self.retryable = code, retryable
        super().__init__(message)


def _path_string(value):
    if (not isinstance(value, str) or not value or "\x00" in value
            or len(value.encode("utf-8")) > MAX_PIN_BYTES or not Path(value).is_absolute()):
        raise ValueError("invalid absolute path")
    return value


def _destination(value, *, resolve_root):
    if (type(value) is not dict or set(value) != DESTINATION_FIELDS
            or value["kind"] not in (QUEUE_KIND, HOSTED_KIND)
            or type(value["protocol_version"]) is not int or value["protocol_version"] != 1
            or not isinstance(value["thread_id"], str)
            or str(uuid.UUID(value["thread_id"])) != value["thread_id"]):
        raise ValueError("invalid destination")
    root = _path_string(value["codex_home"])
    if resolve_root:
        if not os.path.isdir(root):
            raise ValueError("supplied root is not a directory")
        path = Path(root).resolve(strict=True)
        if not path.is_dir():
            raise ValueError("root is not a directory")
        root = str(path)
    elif root.startswith("//") or os.path.normpath(root) != root or str(Path(root)) != root:
        raise ValueError("stored root is not canonical")
    return dict(value, codex_home=root)


def _request(store, actor_id, destination):
    try:
        _identifier(actor_id, "actor_id")
        actor_id.encode("utf-8")
    except (Refusal, UnicodeError) as error:
        raise RoutePinError("INVALID_ARGUMENT", "Use a bounded actor identity") from error
    try:
        # Resolve only explicit input, before entering any SQLite transaction.
        destination = _destination(destination, resolve_root=True)
        binding = dict(instance_id=store.instance_id, actor_id=actor_id, db_path=str(store.path),
                       authority_id=store.binding["authority_id"], authority_epoch=store.binding["authority_epoch"])
        pin = dict(v=1, binding=binding, destination=destination)
        payload = _json(pin)
        if len(payload.encode("utf-8")) > MAX_PIN_BYTES:
            raise ValueError("pin exceeds byte limit")
        return _key(binding), pin, payload
    except (ValueError, TypeError, OSError, RuntimeError) as error:
        raise RoutePinError("INVALID_ROUTE_DESTINATION", "Use an explicit bounded stdio destination with an existing root and canonical thread UUID") from error


KEY_PREFIX = "route_pin.v1:"


def _key(binding):
    return KEY_PREFIX + hashlib.sha256(_json(binding).encode("utf-8")).hexdigest()


def _unique(pairs):
    value = {}
    for key, item in pairs:
        if key in value:
            raise ValueError("duplicate pin field")
        value[key] = item
    return value


def _invalid_constant(value):
    raise ValueError("nonfinite pin value")


def _stored(db, key, expected=None):
    # BLOB prefix bounds bytes crossing into Python, even if a malformed value
    # contains multibyte text or is enormous. Never enumerate other pins.
    row = db.execute("SELECT typeof(value),substr(CAST(value AS BLOB),1,?) FROM metadata WHERE key=?",
                     (MAX_PIN_BYTES + 1, key)).fetchone()
    if row is None:
        return None
    try:
        if row[0] != "text" or len(row[1]) > MAX_PIN_BYTES:
            raise ValueError("invalid stored pin bytes")
        pin = json.loads(row[1].decode("utf-8"), object_pairs_hook=_unique, parse_constant=_invalid_constant)
        if (type(pin) is not dict or set(pin) != {"v", "binding", "destination"}
                or type(pin["v"]) is not int or pin["v"] != 1
                or type(pin["binding"]) is not dict or set(pin["binding"]) != BINDING_FIELDS):
            raise ValueError("invalid pin schema")
        for field in BINDING_FIELDS - {"db_path"}:
            _identifier(pin["binding"][field], field).encode("utf-8")
        path = _path_string(pin["binding"]["db_path"])
        if path.startswith("//") or os.path.normpath(path) != path or str(Path(path)) != path:
            raise ValueError("invalid stored database path")
        _destination(pin["destination"], resolve_root=False)
    except (ValueError, TypeError, Refusal, RecursionError) as error:
        raise RoutePinError("ROUTE_PIN_INVALID", "The stored route pin is malformed; preserve it for inspection") from error
    # The key is not proof of context: compare every decoded field as well.
    if expected is not None and pin != expected:
        raise RoutePinError("ROUTE_PIN_MISMATCH", "The immutable route pin does not match this binding and destination")
    return pin


class RoutePins:
    def _hosted_thread(self, db, actor_id):
        """The thread of this actor's hosted pin, read in the caller's transaction; None if it has no hosted pin."""
        binding = dict(instance_id=self.instance_id, actor_id=actor_id, db_path=str(self.path),
                       authority_id=self.binding["authority_id"], authority_epoch=self.binding["authority_epoch"])
        pin = _stored(db, _key(binding))
        if pin is None or pin["binding"] != binding or pin["destination"]["kind"] != HOSTED_KIND:
            return None
        return pin["destination"]["thread_id"]

    def _pin_actor(self, db, actor_id):
        try:
            if db.execute("SELECT 1 FROM hosted_seats WHERE agent_id=? AND end_state IS NOT NULL", (actor_id,)).fetchone():
                raise RoutePinError("SEAT_ENDED", "This seat is ending or ended; its route cannot be adopted")
            self._actor(db, actor_id)
        except Refusal as error:
            raise RoutePinError(error.code, error.message) from error

    def provision_route_pin(self, guard, actor_id, destination, owner_id=None):
        """Explicit guard-held provisioning; never called by a runtime read."""
        key, expected, payload = _request(self, actor_id, destination)

        def action(db, now):
            self._pin_actor(db, actor_id)
            existing = _stored(db, key, expected)
            owner_added = False
            if owner_id is not None:
                if destination['kind'] != HOSTED_KIND:
                    raise RoutePinError('INVALID_ARGUMENT', 'Only a hosted seat has execution controls')
                owner_added = self._provision_hosted_owner(db, actor_id, owner_id, now)
            if existing is not None:
                return {"status": "existing", "pin": existing}, owner_added
            db.execute("INSERT INTO metadata(key,value) VALUES (?,?)", (key, payload))
            return {"status": "provisioned", "pin": expected}, True

        return self._effect(guard, action)

    def resolve_hosted_route(self, actor_id, destination):
        return self._read_route_pin(actor_id, destination, recovery=True)

    def read_route_pin(self, actor_id, destination):
        return self._read_route_pin(actor_id, destination)

    def _read_route_pin(self, actor_id, destination, recovery=False):
        """Compare one pin and close before returning; grants no dispatch lease.

        Use the returned stored codex_home string for the eventual child.
        This binds a path string, not the inode or contents at that path.
        """
        from .store import _connect
        key, expected, _ = _request(self, actor_id, destination)
        try:
            with self._authority.shared() as fence:
                try:
                    db, _ = _connect(self.path)
                except StoreError as error:
                    raise RoutePinError("ROUTE_PIN_STORAGE_ERROR", "Route pin setup could not be confirmed") from error
                except KeyboardInterrupt as error:
                    if error.__cause__ is not None:
                        raise RoutePinError("ROUTE_PIN_STORAGE_ERROR", "Route pin read could not be confirmed") from error
                    raise
                try:
                    db.execute("BEGIN")
                    fence.verify()
                    self._check_instance(db)
                    self._pin_actor(db, actor_id)
                    if expected['destination']['kind'] == QUEUE_KIND:
                        from .queue_hosted import queue_retired
                        if queue_retired(db, expected['binding']):
                            raise RoutePinError('QUEUE_PIN_RETIRED', 'This queue pin was retired by an explicit hosted conversion; retain its operation receipt')
                    pin = _stored(db, key, None if recovery else expected)
                    if recovery and pin != expected:
                        pin = self._resolve_recovered_pin(db, actor_id, expected, pin)
                    if pin is None:
                        raise RoutePinError("ROUTE_PIN_MISSING", "Explicit provisioning is required for this recipient binding")
                    return pin
                finally:
                    try:
                        db.close()
                    except (sqlite3.Error, OSError, KeyboardInterrupt) as error:
                        raise RoutePinError("ROUTE_PIN_STORAGE_ERROR", "Route pin connection cleanup could not be confirmed") from error
        except (sqlite3.Error, OSError) as error:
            if busy(error):
                raise RoutePinError("DATABASE_BUSY", "Route pin is busy; retry the read", retryable=True) from error
            raise RoutePinError("ROUTE_PIN_STORAGE_ERROR", "Route pin read could not be confirmed") from error

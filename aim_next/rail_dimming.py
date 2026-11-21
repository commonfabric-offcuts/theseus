from __future__ import annotations

"""One actor's two Dim views: Core authority, bounded IDs, monotonic revision."""

import json

from .contract import LIMITS, READABLE, Refusal, _identifier, _json


DIM_SCHEMA = [
    "CREATE TABLE rail_dimming (actor_id TEXT PRIMARY KEY REFERENCES actors(id), "
    "value TEXT NOT NULL, revision INTEGER NOT NULL CHECK(revision>0))",
]
DIM_DOWN = ("DROP TABLE rail_dimming",)
DIM_OCCUPIED = "SELECT EXISTS (SELECT 1 FROM rail_dimming)"


def fresh():
    return {"version": 1, "selected": 0,
            "sets": [{"focus": None, "outcomes": [], "topics": []},
                     {"focus": None, "outcomes": [], "topics": []}]}


def checked(value):
    if (not isinstance(value, dict) or set(value) != {"version", "selected", "sets"}
            or type(value["version"]) is not int or value["version"] != 1
            or type(value["selected"]) is not int or value["selected"] not in (0, 1, 2)
            or not isinstance(value["sets"], list) or len(value["sets"]) != 2):
        raise Refusal("INVALID_ARGUMENT", "Dim holds a level and two bounded views")
    for choice in value["sets"]:
        if not isinstance(choice, dict) or set(choice) != {"focus", "outcomes", "topics"}:
            raise Refusal("INVALID_ARGUMENT", "Each Dim view holds focus and outcome/topic choices")
        focus = choice["focus"]
        if focus is not None:
            if not isinstance(focus, list) or len(focus) != 2:
                raise Refusal("INVALID_ARGUMENT", "A Dim focus names an outcome and optional topic")
            _identifier(focus[0])
            if focus[1] is not None:
                _identifier(focus[1])
        for name, length in (("outcomes", 2), ("topics", 3)):
            rows, seen = choice[name], set()
            if not isinstance(rows, list) or len(rows) > LIMITS["rail_dim_choices"]:
                raise Refusal("INVALID_ARGUMENT", "Each Dim view holds at most %d %s" % (LIMITS["rail_dim_choices"], name))
            for row in rows:
                if not isinstance(row, list) or len(row) != length or type(row[-1]) is not bool:
                    raise Refusal("INVALID_ARGUMENT", "A Dim choice names its place and a boolean")
                for identifier in row[:-1]:
                    _identifier(identifier)
                key = tuple(row[:-1])
                if key in seen:
                    raise Refusal("INVALID_ARGUMENT", "A place occurs once in each Dim view")
                seen.add(key)
    return json.loads(_json(value))


class RailDimming:
    def _dim_row(self, db, actor):
        return db.execute("SELECT value,revision FROM rail_dimming WHERE actor_id=?", (actor,)).fetchone()

    def _dim_places(self, db, actor, value):
        """Bounded indexed joins over only this preference's explicitly named places."""
        outcomes, topics = set(), set()
        for choice in value["sets"]:
            if choice["focus"] is not None:
                workspace, topic = choice["focus"]
                outcomes.add(workspace)
                if topic is not None:
                    topics.add((workspace, topic))
            outcomes.update(row[0] for row in choice["outcomes"])
            for workspace, topic, _ in choice["topics"]:
                outcomes.add(workspace)
                topics.add((workspace, topic))
        allowed_outcomes = {row[0] for row in db.execute(
            "SELECT w.id FROM json_each(:ids) j JOIN workspaces w ON w.id=j.value "
            "WHERE w.owner_id=:actor OR EXISTS (SELECT 1 FROM workspace_members m "
            "WHERE m.workspace_id=w.id AND m.actor_id=:actor)", {"ids": _json(sorted(outcomes)), "actor": actor})}
        allowed_topics = {(row[0], row[1]) for row in db.execute(
            "SELECT t.workspace_id,t.id FROM json_each(:ids) j JOIN topics t "
            "ON t.id=json_extract(j.value,'$[1]') AND t.workspace_id=json_extract(j.value,'$[0]') "
            "JOIN workspaces w ON w.id=t.workspace_id WHERE " + READABLE,
            {"ids": _json(sorted(topics)), "actor": actor})}
        return outcomes, topics, allowed_outcomes, allowed_topics

    def _dim_readable(self, db, actor, value):
        value = json.loads(_json(value))
        _, _, outcomes, topics = self._dim_places(db, actor, value)
        for choice in value["sets"]:
            focus = choice["focus"]
            if focus is not None and (focus[0] not in outcomes or focus[1] is not None and tuple(focus) not in topics):
                choice["focus"] = None
            choice["outcomes"] = [r for r in choice["outcomes"] if r[0] in outcomes]
            choice["topics"] = [r for r in choice["topics"] if r[0] in outcomes and tuple(r[:2]) in topics]
        return value

    def _view_rail_dimming(self, db, actor, args):
        candidate = checked(args["candidate"]) if "candidate" in args else None
        row = self._dim_row(db, actor)
        if row is not None:
            return {"instance_id": self.instance_id, "value": self._dim_readable(db, actor, json.loads(row["value"])),
                    "dim_revision": row["revision"]}
        answer = {"instance_id": self.instance_id, "value": fresh(), "dim_revision": 0}
        if candidate is not None:
            answer["candidate"] = self._dim_readable(db, actor, candidate)
        return answer

    def _command_rail_dimming_set(self, db, actor, envelope):
        if envelope["target"] or set(envelope["args"]) != {"value"}:
            raise Refusal("INVALID_ARGUMENT", "Dim changes only the authenticated reader's views")
        value = checked(envelope["args"]["value"])
        row = self._dim_row(db, actor)
        revision = row["revision"] if row else 0
        if envelope["expected"].get("dim_revision") != revision:
            raise Refusal("REVISION_CONFLICT", "Dim changed on another device; read it again", {"dim_revision": revision})
        outcomes, topics, allowed_outcomes, allowed_topics = self._dim_places(db, actor, value)
        if outcomes != allowed_outcomes or topics != allowed_topics:
            raise Refusal("FORBIDDEN", "Dim choices must name places you can read")
        if row is not None and json.loads(row["value"]) == value:
            return {"value": value, "dim_revision": revision, "changed": False}, []
        # Even an explicit empty choice establishes Core authority over a legacy
        # device cache. Revision0 means absence, not a saved empty preference.
        revision += 1
        db.execute("INSERT INTO rail_dimming(actor_id,value,revision) VALUES (?,?,?) "
                   "ON CONFLICT(actor_id) DO UPDATE SET value=excluded.value,revision=excluded.revision",
                   (actor, _json(value), revision))
        self._change(db, "actor", actor, "rail_dimming", actor, revision)
        return {"value": value, "dim_revision": revision, "changed": True}, [{"kind": "rail_dimming", "id": actor, "version": revision}]

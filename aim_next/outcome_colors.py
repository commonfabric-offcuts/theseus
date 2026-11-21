from __future__ import annotations

"""A reader's outcome colors, separate from each outcome's shared record."""

from .colors import AGENT_COLORS, _offered
from .contract import Refusal, _identifier

OUTCOME_COLOR_SCHEMA = [
    "CREATE TABLE outcome_color_choices (actor_id TEXT NOT NULL REFERENCES actors(id), "
    "workspace_id TEXT NOT NULL REFERENCES workspaces(id), color TEXT, "
    "revision INTEGER NOT NULL CHECK(revision>0), PRIMARY KEY(actor_id,workspace_id))",
]
OUTCOME_COLOR_DOWN = ("DROP TABLE outcome_color_choices",)
# Reset rows preserve the revision fence, so they also prevent rollback.
OUTCOME_COLOR_OCCUPIED = "SELECT EXISTS (SELECT 1 FROM outcome_color_choices)"


class OutcomeColors:
    def _outcome_color(self, db, actor, workspace_id):
        row = db.execute("SELECT color,revision FROM outcome_color_choices WHERE actor_id=? AND workspace_id=?",
                         (actor, workspace_id)).fetchone()
        return {"color": _offered(row["color"]) if row else None, "color_revision": row["revision"] if row else 0}

    def _command_outcome_color_set(self, db, actor, envelope):
        target, args = envelope["target"], envelope["args"]
        if set(target) != {"workspace_id"} or set(args) != {"color"}:
            raise Refusal("INVALID_ARGUMENT", "Name one outcome and a palette color, or null for no color")
        color = args["color"]
        if color is not None and color not in AGENT_COLORS:
            raise Refusal("INVALID_ARGUMENT", "A color is one of the palette's: " + ", ".join(AGENT_COLORS))
        workspace_id = _identifier(target["workspace_id"], "workspace_id")
        self._workspace(db, actor, workspace_id)
        current = self._outcome_color(db, actor, workspace_id)
        revision = current["color_revision"]
        if envelope["expected"]["color_revision"] != revision:
            raise Refusal("REVISION_CONFLICT", "This color changed since it was read; nothing was changed",
                          {"color_revision": revision})
        result = {"workspace_id": workspace_id, "color": color, "color_revision": revision, "changed": False}
        if current["color"] == color:
            return result, []
        revision += 1
        db.execute("INSERT INTO outcome_color_choices(actor_id,workspace_id,color,revision) VALUES (?,?,?,?) "
                   "ON CONFLICT(actor_id,workspace_id) DO UPDATE SET color=excluded.color,revision=excluded.revision",
                   (actor, workspace_id, color, revision))
        self._change(db, "actor", actor, "outcome_color", workspace_id, revision)
        return dict(result, color_revision=revision, changed=True), [
            {"kind": "outcome_color", "id": workspace_id, "version": revision}]

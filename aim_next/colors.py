from __future__ import annotations

"""The color a person has chosen for an agent, for themselves alone.

An agent's messages wear a color on its name and across its cards
(docs/reading-colors.md). Each agent has one by default; a person may choose
another from the palette for themselves, and the choice follows them to every
page and device, since it is kept here rather than in a browser. A choice names
a palette color, or none, which is the agent's default again. Nobody else sees
it, and it changes no message, delivery or wake.

A choice belongs to one person and one agent. Its revision only grows and rows
are never deleted, so a revision is never reused and a late request never
undoes a newer choice. The person's own messages keep their own look, so there
is no choice for oneself.
"""

from .contract import Refusal, _bounded_page, _identifier, _page_size


# The palette a choice names, in the order a picker offers it. The browser
# draws each as a class in web/aim.css. Orchid was one until it was measured
# too close to violet and rose to tell apart (item 91b).
AGENT_COLORS = ("green", "blue", "indigo", "violet", "rose", "peach", "cyan", "olive")


def _offered(color):
    """A kept choice as it reads now: a color the palette no longer offers,
    such as orchid, is the agent's own again. Its row and revision stay, so the
    revision still only grows."""
    return color if color in AGENT_COLORS else None

COLOR_SCHEMA = [
    "CREATE TABLE color_choices (actor_id TEXT NOT NULL REFERENCES actors(id), subject_id TEXT NOT NULL REFERENCES actors(id), "
    "color TEXT, revision INTEGER NOT NULL CHECK(revision>0), PRIMARY KEY(actor_id,subject_id))",
]
COLOR_DOWN = ("DROP TABLE color_choices",)
# Any row, reset ones included: dropping a reset row would restart its
# revisions at 0, and a stale request could then bring back an older choice.
COLOR_OCCUPIED = "SELECT EXISTS (SELECT 1 FROM color_choices)"


class Colors:
    def _color_choice(self, db, actor, subject_id):
        row = db.execute("SELECT color,revision FROM color_choices WHERE actor_id=? AND subject_id=?",
                         (actor, subject_id)).fetchone()
        return (_offered(row["color"]), row["revision"]) if row else (None, 0)

    def _command_color_set(self, db, actor, envelope):
        target, args = envelope["target"], envelope["args"]
        if set(target) != {"actor_id"} or set(args) != {"color"}:
            raise Refusal("INVALID_ARGUMENT", "Name one agent and a palette color, or null for its own")
        color = args["color"]
        if color is not None and color not in AGENT_COLORS:
            raise Refusal("INVALID_ARGUMENT", "A color is one of the palette's: " + ", ".join(AGENT_COLORS))
        subject_id = _identifier(target["actor_id"], "actor_id")
        if subject_id == actor:
            raise Refusal("INVALID_ARGUMENT", "Your own messages keep their own look; choose a color for an agent")
        subject = db.execute("SELECT kind FROM actors WHERE id=?", (subject_id,)).fetchone()
        if subject is None or subject["kind"] != "agent":
            raise Refusal("INVALID_ARGUMENT", "A color is chosen for an agent")
        current, revision = self._color_choice(db, actor, subject_id)
        # Fenced on the revision its sender saw, so a late request never undoes
        # a newer choice made on another page or device.
        if envelope["expected"]["color_revision"] != revision:
            raise Refusal("REVISION_CONFLICT", "This color changed since it was read; nothing was changed",
                          {"color_revision": revision})
        result = {"actor_id": subject_id, "color": color}
        if color == current:
            return dict(result, color_revision=revision, changed=False), []
        revision += 1
        db.execute("INSERT INTO color_choices(actor_id,subject_id,color,revision) VALUES (?,?,?,?) "
                   "ON CONFLICT(actor_id,subject_id) DO UPDATE SET color=excluded.color,revision=excluded.revision",
                   (actor, subject_id, color, revision))
        self._change(db, "actor", actor, "color", subject_id, revision)
        return dict(result, color_revision=revision, changed=True), [
            {"kind": "color", "id": subject_id, "version": revision}]

    def _view_colors(self, db, actor, args):
        """The reader's color choices, reset ones included, in agent id order, and the palette."""
        limit = _page_size(args)
        rows = db.execute("SELECT subject_id,color,revision FROM color_choices WHERE actor_id=? AND subject_id>? "
                          "ORDER BY subject_id LIMIT ?", (actor, args.get("cursor", ""), limit + 1)).fetchall()
        return _bounded_page({"instance_id": self.instance_id, "palette": list(AGENT_COLORS)}, rows, limit,
                             lambda row: {"actor_id": row["subject_id"], "color": _offered(row["color"]),
                                          "color_revision": row["revision"]}, "actor_id")

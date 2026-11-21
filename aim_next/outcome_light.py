from __future__ import annotations

"""The reads behind the outcome light (item 86; docs/outcome-light.md).

Each read is bounded by what is open now or what happened in the last hour,
never by history: the reader's open questions (topic_waiting, by its reader
index), the outcome's open topics active within the work window (by its
activity-order index), the open topics that wait on anyone (rows exist only
while a wait holds), and, only when nothing is being worked on, a scan past
the window for when Theseus last saw something, which stops as soon as no
older topic can hold anything newer, or after LAST_SCAN_MAX topics.

The kind, Reached and the target word come from checks.py (_done_facts), and
who started the outcome from its start record (_created).
"""

import sqlite3

from .contract import READABLE, _prefix
from .delivery import _now_ms
from . import outcome_rules
from .work import WORK_WINDOW_MS, work_by_topic

_SCAN_PAGE = 25


class OutcomeLight:
    """Store mixin: the `light` on each `workspaces` item, and the `outcome_light` view."""

    def _light_asks(self, db, actor, workspace_id):
        rows = db.execute("SELECT t.id,t.kind,t.workspace_id,substr(CAST(t.title AS BLOB),1,1025) AS title_prefix,q.said,q.ask_message_id,q.state_ms,t.state_by "
                          "FROM topic_waiting q INDEXED BY reader_waiting CROSS JOIN topics t ON t.id=q.topic_id "
                          "JOIN workspaces w ON w.id=t.workspace_id "
                          "WHERE q.actor_id=:actor AND q.archived=0 AND t.workspace_id=:workspace AND " + READABLE,
                          {"actor": actor, "workspace": workspace_id}).fetchall()
        asks = []
        for row in rows:
            title, truncated = _prefix(row["title_prefix"])
            place = {"topic_id": row["id"], "title": title, "title_truncated": truncated}
            questions = self._waiting_asks(db, row, actor) if row["ask_message_id"] is not None else []
            asks.extend(dict(place, message_id=ask["message_id"], by=ask["by"], ms=ask["since_ms"]) for ask in questions)
            # A said wait keeps its old topic-only target only when no message asks.
            if row["said"] and not questions:
                asks.append(dict(place, by=row["state_by"], ms=row["state_ms"]))
        return sorted(asks, key=lambda ask: (-(ask["ms"] or 0), ask["topic_id"], ask.get("message_id", "")))

    def _light_topics(self, db, actor, rows):
        """[{topic_id, title, activity_ms, work}] for topic rows, with each one's work for this reader."""
        waits = self._waits_by_topic(db, [row["id"] for row in rows])
        work = work_by_topic(db, waits, actor)
        topics = []
        for row in rows:
            title, truncated = _prefix(row["title_prefix"])
            topics.append({"topic_id": row["id"], "title": title, "title_truncated": truncated,
                           "activity_ms": row["activity_ms"], "work": work[row["id"]]})
        return topics

    def _light_open_rows(self, db, workspace_id, after=None, limit=_SCAN_PAGE):
        return db.execute("SELECT id,activity_ms,substr(CAST(title AS BLOB),1,1025) AS title_prefix FROM topics "
                          "INDEXED BY workspace_topic_order WHERE workspace_id=? AND archived=0 AND (state='done')=0"
                          + (" AND (activity_ms,id)<(?,?)" if after else "") + " ORDER BY activity_ms DESC,id DESC LIMIT ?",
                          (workspace_id,) + (tuple(after) if after else ()) + (limit,)).fetchall()

    def _light_reads(self, db, actor, workspace, now):
        """(talk, waits, has_topics, last) for this reader."""
        workspace_id = workspace["id"]
        # The open topics active in the last hour, then on past the window only
        # while nothing is being worked on, for when something was last seen.
        talk, scanned, after, last, capped = [], 0, None, None, False
        while True:
            rows = self._light_open_rows(db, workspace_id, after)
            if not rows:
                break
            in_window = [row for row in rows if now - row["activity_ms"] <= WORK_WINDOW_MS]
            talk += self._light_topics(db, actor, in_window)
            if len(in_window) < len(rows):
                break
            after = (rows[-1]["activity_ms"], rows[-1]["id"])
        wait_rows = db.execute("SELECT t.id,t.activity_ms,substr(CAST(t.title AS BLOB),1,1025) AS title_prefix FROM topics t "
                               "WHERE t.id IN (SELECT DISTINCT q.topic_id FROM topic_waiting q CROSS JOIN topics w ON w.id=q.topic_id "
                               "WHERE w.workspace_id=? AND w.archived=0 AND w.state<>'done') ORDER BY t.activity_ms DESC,t.id DESC",
                               (workspace_id,)).fetchall()
        waits = self._light_topics(db, actor, wait_rows)
        # The outcome's conversation is not one of its topics: an outcome holding only that has none yet.
        has_topics = db.execute("SELECT EXISTS (SELECT 1 FROM topics INDEXED BY workspace_topics WHERE workspace_id=? AND kind='topic')",
                                (workspace_id,)).fetchone()[0] == 1

        def consider(topic):
            nonlocal last
            work = topic["work"]
            if work.get("seen_ms") is not None and (last is None or work["seen_ms"] > last["ms"]):
                last = {"by": work.get("by"), "how": work.get("how"), "topic_id": topic["topic_id"], "topic_title": topic["title"],
                        "title_truncated": topic["title_truncated"], "ms": work["seen_ms"]}

        if not any(topic["work"]["observed"] for topic in talk + waits):
            for topic in talk + waits:
                consider(topic)
            # activity_ms is never older than any post, turn or state change in a
            # topic, so a topic not newer than the best found holds nothing newer.
            after = (talk[-1]["activity_ms"], talk[-1]["topic_id"]) if talk else None
            stop = False
            while not stop:
                rows = self._light_open_rows(db, workspace_id, after)
                if not rows:
                    break
                for topic in self._light_topics(db, actor, rows):
                    if last is not None and topic["activity_ms"] <= last["ms"]:
                        stop = True
                        break
                    if scanned >= outcome_rules.LAST_SCAN_MAX:
                        capped = stop = True
                        break
                    scanned += 1
                    consider(topic)
                after = (rows[-1]["activity_ms"], rows[-1]["id"])
            # A scan that stopped on its cap may have missed something newer.
            if capped:
                last = None
        return talk, waits, has_topics, last

    def _pipeline_facts(self, db, actor, workspace_id):
        """None while the outcome's pipeline is off; else its Now items with their work (pipeline.py)."""
        return self._pipeline_light_facts(db, actor, workspace_id)

    def _outcome_stands(self, db, actor, workspace):
        """The whole of where the outcome stands for this reader: light, lead, facts and also."""
        now = _now_ms()
        # The questions are read first and alone, so a failure elsewhere never hides them; with them the
        # asks among them that hold a piece or a release (item 259), by the rule that clears every ask.
        asks = self._light_asks(db, actor, workspace["id"])
        blocking = self._blocking_on(db, actor, workspace["id"])
        try:
            pipeline = self._pipeline_facts(db, actor, workspace["id"])
            done_facts = self._done_facts(db, workspace["id"])
            talk, waits, has_topics, last = self._light_reads(db, actor, workspace, now)
        except sqlite3.OperationalError as error:
            if "locked" in str(error).lower() or "busy" in str(error).lower():
                raise
            return outcome_rules.unreadable(asks, blocking)
        except sqlite3.DatabaseError:
            return outcome_rules.unreadable(asks, blocking)
        return outcome_rules.stands(asks, pipeline, talk, waits, done_facts, has_topics, last, self._created(db, workspace), blocking)

    def _view_outcome_light(self, db, actor, args):
        workspace = self._workspace(db, actor, args.get("workspace_id"))
        answer = self._outcome_stands(db, actor, workspace)
        return {"instance_id": self.instance_id, "workspace_id": workspace["id"], **answer,
                "relevant_versions": {"workspace": workspace["version"]}}

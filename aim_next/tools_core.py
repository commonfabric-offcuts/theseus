from __future__ import annotations

"""Skills and tools in Core (item 17; docs/skills-and-tools.md): an outcome says it uses a tool (tool.use), a topic
is about a tool (tool.link), and what a tool's own check found in a release (tool.record), with the views a tool's
page, an outcome's page, the rails and Topic settings read.

The records themselves are not copied into Core: the process read skills/*.json from its own code once, when it
started (tool_records.Records), and a record it could not read makes every tool view and verb refuse
TOOL_RECORDS_UNREADABLE, naming the file, never "no tools". Each fact is an append-only table: its newest row is the
answer, and nothing updates or deletes one.
"""

import json
import uuid

from .contract import LIMITS, READABLE, Refusal, _identifier
from .delivery import _now_ms
from .outcome_kind import _clock
from . import tool_records, tool_words

TOOLS_SCHEMA = [
    "CREATE TABLE tool_uses (workspace_id TEXT NOT NULL REFERENCES workspaces(id), tool_id TEXT NOT NULL, seq INTEGER NOT NULL CHECK(seq>=1), "
    "used INTEGER NOT NULL CHECK(used IN (0,1)), said_by TEXT NOT NULL REFERENCES actors(id), said_ms INTEGER NOT NULL, "
    "PRIMARY KEY(workspace_id,tool_id,seq))",
    "CREATE INDEX tool_uses_by_tool ON tool_uses(tool_id,workspace_id,seq)",
    "CREATE TRIGGER tool_uses_stay_u BEFORE UPDATE ON tool_uses BEGIN SELECT RAISE(ABORT, 'a use keeps its past'); END",
    "CREATE TRIGGER tool_uses_stay_d BEFORE DELETE ON tool_uses BEGIN SELECT RAISE(ABORT, 'a use keeps its past'); END",
    "CREATE TABLE tool_links (topic_id TEXT NOT NULL REFERENCES topics(id), tool_id TEXT NOT NULL, seq INTEGER NOT NULL CHECK(seq>=1), "
    "linked INTEGER NOT NULL CHECK(linked IN (0,1)), said_by TEXT NOT NULL REFERENCES actors(id), said_ms INTEGER NOT NULL, "
    "PRIMARY KEY(topic_id,tool_id,seq))",
    "CREATE INDEX tool_links_by_tool ON tool_links(tool_id,topic_id,seq)",
    "CREATE TRIGGER tool_links_stay_u BEFORE UPDATE ON tool_links BEGIN SELECT RAISE(ABORT, 'a link keeps its past'); END",
    "CREATE TRIGGER tool_links_stay_d BEFORE DELETE ON tool_links BEGIN SELECT RAISE(ABORT, 'a link keeps its past'); END",
    "CREATE TABLE tool_runs (seq INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT NOT NULL UNIQUE, tool_id TEXT NOT NULL, name TEXT NOT NULL, "
    "home_workspace_id TEXT NOT NULL REFERENCES workspaces(id), content_id TEXT NOT NULL, commit_sha TEXT NOT NULL, tree_sha TEXT NOT NULL, "
    "live_commit TEXT NOT NULL, check_path TEXT NOT NULL, result TEXT NOT NULL CHECK(result IN ('passed','failed','counted_nothing')), "
    "passed INTEGER, total INTEGER, failing TEXT NOT NULL, failing_more INTEGER NOT NULL CHECK(failing_more>=0), why TEXT, "
    "fate TEXT NOT NULL CHECK(fate IN ('new','back','live')), first_version INTEGER NOT NULL CHECK(first_version IN (0,1)), "
    "items_back TEXT NOT NULL, topic_id TEXT REFERENCES topics(id), recorded_by TEXT NOT NULL REFERENCES actors(id), "
    "recorded_ms INTEGER NOT NULL, UNIQUE(tool_id,fate,tree_sha), "
    "CHECK((result='passed' AND total>=1 AND passed=total) OR (result='failed' AND total>=1 AND passed>=0 AND passed<total) "
    "OR (result='counted_nothing' AND passed IS NULL AND total IS NULL)), "
    "CHECK((fate='back') = (topic_id IS NOT NULL)), CHECK(fate='back' OR result='passed'))",
    "CREATE INDEX tool_runs_by_content ON tool_runs(tool_id,content_id,seq)",
    "CREATE INDEX tool_runs_by_fate ON tool_runs(tool_id,fate,seq)",
    "CREATE TRIGGER tool_runs_stay_u BEFORE UPDATE ON tool_runs BEGIN SELECT RAISE(ABORT, 'a run keeps what it found'); END",
    "CREATE TRIGGER tool_runs_stay_d BEFORE DELETE ON tool_runs BEGIN SELECT RAISE(ABORT, 'a run keeps what it found'); END",
]
TOOLS_DOWN = ("DROP TABLE tool_runs", "DROP TABLE tool_links", "DROP TABLE tool_uses")
TOOLS_OCCUPIED = ("SELECT EXISTS (SELECT 1 FROM tool_uses) OR EXISTS (SELECT 1 FROM tool_links) "
                  "OR EXISTS (SELECT 1 FROM tool_runs)")

RUN_FIELDS = ("tool_id", "name", "content_id", "commit_sha", "tree_sha", "live_commit", "check_path", "result", "passed", "total",
              "failing", "failing_more", "why", "fate", "first_version", "items_back")
FAILING_NAMES, FAILING_BYTES, WHY_BYTES = 5, 200, 300
NOT_FOUND = "That tool is not on this Theseus."
UNREADABLE = "The tools' records could not be read."
NOT_A_TOPIC = "The Conversation is not a topic, so it cannot be linked."
# The newest row of each (outcome, tool) and (topic, tool): the current answer.
CURRENT_USE = "u.seq=(SELECT max(seq) FROM tool_uses WHERE workspace_id=u.workspace_id AND tool_id=u.tool_id)"
CURRENT_LINK = "l.seq=(SELECT max(seq) FROM tool_links WHERE topic_id=l.topic_id AND tool_id=l.tool_id)"


def _hex(value, size):
    return isinstance(value, str) and len(value) == size and all(c in "0123456789abcdef" for c in value)


def _count(value):
    return isinstance(value, int) and not isinstance(value, bool) and 0 <= value <= 9223372036854775807


def _text(value, most_bytes):
    return (isinstance(value, str) and value.strip() == value and value and len(value.encode("utf-8")) <= most_bytes
            and not any(ord(c) < 32 or ord(c) == 127 for c in value))


def valid_run(run):
    """The run as Core keeps it, or Refusal INVALID_ARGUMENT naming the first field that is not as section 3 says."""
    def bad(field, why):
        raise Refusal("INVALID_ARGUMENT", "run.%s: %s" % (field, why))
    if not isinstance(run, dict):
        bad("run", "a run is an object")
    for field in sorted(set(run) - set(RUN_FIELDS)):
        bad(field, "not a field of a run")
    for field in RUN_FIELDS:
        if field not in run:
            bad(field, "missing")
    if not (isinstance(run["tool_id"], str) and len(run["tool_id"]) <= tool_records.ID_CHARACTERS and tool_records.ID.fullmatch(run["tool_id"])):
        bad("tool_id", "a record's id")
    if not tool_records._line(run["name"], tool_records.NAME_CHARACTERS):
        bad("name", "1 to %d characters on one line" % tool_records.NAME_CHARACTERS)
    if not _hex(run["content_id"], 64):
        bad("content_id", "a sha256 in hex")
    for field in ("commit_sha", "tree_sha", "live_commit"):
        if not _hex(run[field], 40):
            bad(field, "a full object name")
    if not (isinstance(run["check_path"], str) and any(rule.fullmatch(run["check_path"]) for rule in tool_records.CHECKS.values())):
        bad("check_path", "a unit module")
    result, passed, total = run["result"], run["passed"], run["total"]
    if result not in ("passed", "failed", "counted_nothing"):
        bad("result", "passed, failed or counted_nothing")
    if result == "counted_nothing":
        if passed is not None or total is not None:
            bad("total", "a run that counted nothing has no counts")
    elif not (_count(passed) and _count(total) and total >= 1):
        bad("total", "a count of at least one test")
    elif result == "passed" and passed != total:
        bad("passed", "a pass is every test passed")
    elif result == "failed" and not passed < total:
        bad("passed", "a failure is fewer than every test passed")
    failing = run["failing"]
    if not isinstance(failing, list) or len(failing) > FAILING_NAMES or not all(_text(name, FAILING_BYTES) for name in failing):
        bad("failing", "up to %d test names, each at most %d bytes" % (FAILING_NAMES, FAILING_BYTES))
    if not _count(run["failing_more"]):
        bad("failing_more", "how many more failed")
    if result != "failed" and (failing or run["failing_more"]):
        bad("failing", "only a failed run names failing tests")
    if result == "counted_nothing":
        if not _text(run["why"], WHY_BYTES):
            bad("why", "one line of at most %d bytes" % WHY_BYTES)
    elif run["why"] is not None:
        bad("why", "only a run that counted nothing says why")
    fate = run["fate"]
    if fate not in ("new", "back", "live"):
        bad("fate", "new, back or live")
    if fate != "back" and result != "passed":
        bad("fate", "only a version that went back did not pass")
    if run["first_version"] not in (0, 1) or isinstance(run["first_version"], bool):
        bad("first_version", "0 or 1")
    if fate == "live" and run["first_version"]:
        bad("first_version", "a live version is not a first version")
    items = run["items_back"]
    if not isinstance(items, list) or not all(_count(item) and item >= 1 for item in items) or len(set(items)) != len(items):
        bad("items_back", "distinct item numbers")
    if fate != "back" and items:
        bad("items_back", "only a version that went back takes items back")
    return dict(run)


class Tools:
    """Store mixin: tool.use, tool.link, tool.record and the tools, tool and topic_tools views."""

    def _tool_records(self):
        """The records this process read when it started, or TOOL_RECORDS_UNREADABLE naming the file."""
        records = self.tool_records
        if records.error is not None:
            raise Refusal("TOOL_RECORDS_UNREADABLE", "%s (%s)" % (UNREADABLE, records.error.path))
        return records

    def _live_tool(self, tool_id):
        records = self._tool_records()
        record = records.tools.get(tool_id) if isinstance(tool_id, str) else None
        if record is None:
            raise Refusal("TOOL_NOT_FOUND", NOT_FOUND)
        return record

    def _may_write_outcome(self, db, actor, workspace):
        return workspace["owner_id"] == actor or db.execute(
            "SELECT 1 FROM workspace_members WHERE workspace_id=? AND actor_id=?", (workspace["id"], actor)).fetchone() is not None

    def _refuse_if_reached(self, db, workspace):
        reached = db.execute("SELECT reached_ms FROM outcome_reached WHERE workspace_id=?", (workspace["id"],)).fetchone()
        if reached is not None:
            raise Refusal("OUTCOME_REACHED", "%s was reached on %s; its topics are kept to read." % (workspace["title"], _clock(reached[0])))

    def _command_tool_use(self, db, actor, envelope):
        target, args = envelope["target"], envelope["args"]
        if set(target) != {"workspace_id"} or set(args) != {"tool_id", "used"} or not isinstance(args["used"], bool):
            raise Refusal("INVALID_ARGUMENT", "Name one outcome, one tool and whether the outcome uses it")
        record = self._live_tool(args["tool_id"])
        workspace = db.execute("SELECT * FROM workspaces WHERE id=?", (_identifier(target["workspace_id"], "workspace_id"),)).fetchone()
        if workspace is None:
            raise Refusal("FORBIDDEN", "No permission for this workspace")
        if not self._may_write_outcome(db, actor, workspace):
            raise Refusal("FORBIDDEN", "Only someone on %s can say it uses a tool." % workspace["title"])
        self._refuse_if_reached(db, workspace)
        row = db.execute("SELECT seq,used FROM tool_uses WHERE workspace_id=? AND tool_id=? ORDER BY seq DESC LIMIT 1",
                         (workspace["id"], record["id"])).fetchone()
        used = 1 if args["used"] else 0
        result = {"workspace_id": workspace["id"], "tool_id": record["id"], "used": args["used"]}
        if (row["used"] if row else 0) == used:
            return dict(result, changed=False), []
        seq = (row["seq"] if row else 0) + 1
        db.execute("INSERT INTO tool_uses VALUES (?,?,?,?,?,?)", (workspace["id"], record["id"], seq, used, actor, _now_ms()))
        self._change(db, "workspace", workspace["id"], "tool_use", record["id"], seq)
        return dict(result, changed=True), [{"kind": "tool_use", "id": record["id"], "version": seq}]

    def _command_tool_link(self, db, actor, envelope):
        target, args = envelope["target"], envelope["args"]
        if set(target) != {"topic_id"} or set(args) != {"tool_id", "linked"} or not isinstance(args["linked"], bool):
            raise Refusal("INVALID_ARGUMENT", "Name one topic, one tool and whether the topic is about it")
        tool_id = args["tool_id"]
        if not (isinstance(tool_id, str) and tool_records.ID.fullmatch(tool_id)):
            raise Refusal("INVALID_ARGUMENT", "Name a tool by its id")
        topic = self._topic(db, actor, target["topic_id"])
        if args["linked"]:
            record = self._live_tool(tool_id)
            if topic["workspace_id"] != record["home"]:
                home = db.execute("SELECT * FROM workspaces WHERE id=?", (record["home"],)).fetchone()
                named = home is not None and self._may_write_outcome(db, actor, home)
                raise Refusal("TOPIC_NOT_IN_HOME", "A topic can be linked to a tool only in the tool's home%s." % (", " + home["title"] if named else ""))
            if topic["kind"] == "conversation":
                raise Refusal("NOT_A_TOPIC", NOT_A_TOPIC)
        else:
            # Unlinking goes wherever the topic is now, so no link is left where nobody can reach it.
            self._tool_records()
        row = db.execute("SELECT seq,linked FROM tool_links WHERE topic_id=? AND tool_id=? ORDER BY seq DESC LIMIT 1",
                         (topic["id"], tool_id)).fetchone()
        linked = 1 if args["linked"] else 0
        result = {"topic_id": topic["id"], "tool_id": tool_id, "linked": args["linked"]}
        if (row["linked"] if row else 0) == linked:
            return dict(result, changed=False), []
        seq = (row["seq"] if row else 0) + 1
        self._write_link(db, topic, tool_id, seq, linked, actor)
        return dict(result, changed=True), [{"kind": "tool_link", "id": tool_id, "version": seq}]

    def _write_link(self, db, topic, tool_id, seq, linked, actor):
        db.execute("INSERT INTO tool_links VALUES (?,?,?,?,?,?)", (topic["id"], tool_id, seq, linked, actor, _now_ms()))
        self._change(db, "topic", topic["id"], "tool_link", tool_id, seq)
        self._change(db, "workspace", topic["workspace_id"], "tool_link", tool_id, seq)

    def _command_tool_record(self, db, actor, envelope):
        target, args = envelope["target"], envelope["args"]
        if set(target) != {"workspace_id"} or set(args) != {"run"}:
            raise Refusal("INVALID_ARGUMENT", "Name the tool's home and give one run")
        workspace = db.execute("SELECT * FROM workspaces WHERE id=?", (_identifier(target["workspace_id"], "workspace_id"),)).fetchone()
        if workspace is None or self._actor(db, actor)["kind"] != "agent" or not self._may_write_outcome(db, actor, workspace):
            raise Refusal("FORBIDDEN", "Only an agent on the tool's home records what its check found")
        run = valid_run(args["run"])
        existing = db.execute("SELECT * FROM tool_runs WHERE tool_id=? AND fate=? AND tree_sha=?",
                              (run["tool_id"], run["fate"], run["tree_sha"])).fetchone()
        if existing is not None:
            if _stored(existing) != dict(run, home_workspace_id=workspace["id"]):
                raise Refusal("TOOL_RUN_EXISTS", "A different run of %s is already recorded as %s at that tree" % (run["tool_id"], run["fate"]))
            return {"recorded": False, "run": self._run_answer(db, actor, existing)}, []
        topic_id = self._open_back_topic(db, actor, workspace, run, envelope["operation_id"]) if run["fate"] == "back" else None
        run_id, ms = "tr-" + uuid.uuid4().hex, _now_ms()
        seq = db.execute("INSERT INTO tool_runs(id,tool_id,name,home_workspace_id,content_id,commit_sha,tree_sha,live_commit,check_path,result,"
                         "passed,total,failing,failing_more,why,fate,first_version,items_back,topic_id,recorded_by,recorded_ms) "
                         "VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
                         (run_id, run["tool_id"], run["name"], workspace["id"], run["content_id"], run["commit_sha"], run["tree_sha"],
                          run["live_commit"], run["check_path"], run["result"], run["passed"], run["total"], json.dumps(run["failing"]),
                          run["failing_more"], run["why"], run["fate"], run["first_version"], json.dumps(run["items_back"]), topic_id,
                          actor, ms)).lastrowid
        self._change(db, "workspace", workspace["id"], "tool_run", run["tool_id"], seq)
        row = db.execute("SELECT * FROM tool_runs WHERE seq=?", (seq,)).fetchone()
        return {"recorded": True, "run": self._run_answer(db, actor, row)}, [{"kind": "tool_run", "id": run_id, "version": 1}]

    def _open_back_topic(self, db, actor, workspace, run, operation_id):
        """A version that went back opens its topic in the home, in the recording's own transaction: addressed to the
        home's coordinator (its owner when it has none), by the recorder, linked to the tool. Its title and first
        message are built from the run's fields alone (tool_words)."""
        to = workspace["coordinator_id"] or workspace["owner_id"]
        topic_id = "t-" + uuid.uuid4().hex
        self._open_topic(db, actor, topic_id, workspace["id"], tool_words.topic_title(run), [to],
                         Refusal("INVALID_ARGUMENT", "A topic needs a title"))
        topic = db.execute("SELECT t.*,w.owner_id,w.coordinator_id FROM topics t JOIN workspaces w ON w.id=t.workspace_id WHERE t.id=?",
                           (topic_id,)).fetchone()
        self._write_link(db, topic, run["tool_id"], 1, 1, actor)
        self._publish(db, actor, operation_id, topic_id, self._writing({"body": tool_words.topic_message(run), "addressees": [to],
                                                                         "intent": "tell"}))
        return topic_id

    def _readable_topic(self, db, actor, topic_id):
        return db.execute("SELECT t.id,t.title,t.workspace_id,t.state,t.kind FROM topics t JOIN workspaces w ON w.id=t.workspace_id "
                          "WHERE t.id=:topic AND " + READABLE, {"topic": topic_id, "actor": actor}).fetchone()

    def _run_answer(self, db, actor, row):
        """A recorded run as a reader sees it: its topic named only when the reader can read it."""
        answer = _stored(row)
        topic = self._readable_topic(db, actor, row["topic_id"]) if row["topic_id"] else None
        answer.update({"id": row["id"], "recorded_ms": row["recorded_ms"], "recorded_by": row["recorded_by"],
                       "topic": {"topic_id": topic["id"], "title": topic["title"]} if topic else None,
                       "topic_hidden": bool(row["topic_id"]) and topic is None})
        if row["fate"] == "back":
            answer["words"] = tool_words.went_back_words(answer)
        return answer

    def _live_word(self, db, record, content_id):
        row = db.execute("SELECT * FROM tool_runs WHERE tool_id=? AND content_id=? ORDER BY seq DESC LIMIT 1",
                         (record["id"], content_id)).fetchone() if record.get("check") else None
        return tool_words.live_word(record, row)

    def _home(self, db, actor, workspace_id):
        row = db.execute("SELECT * FROM workspaces WHERE id=?", (workspace_id,)).fetchone()
        readable = row is not None and self._may_write_outcome(db, actor, row)
        return {"workspace_id": workspace_id, "title": row["title"] if readable else None, "readable": readable}

    def _tool_item(self, db, actor, records, record):
        path = tool_records.check_path(record)
        return {"tool_id": record["id"], "kind": record["kind"], "name": record["name"], "summary": record["summary"],
                "home": self._home(db, actor, record["home"]), "check": {"path": path} if path else None,
                "word": self._live_word(db, record, records.content[record["id"]])}

    def _used_here(self, db, workspace_id):
        return [row[0] for row in db.execute("SELECT u.tool_id FROM tool_uses u WHERE u.workspace_id=? AND u.used=1 AND " + CURRENT_USE,
                                             (workspace_id,))]

    def _view_tools(self, db, actor, args):
        records = self._tool_records()
        workspace = self._workspace(db, actor, args.get("workspace_id"))
        by_name = lambda record: (record["name"].casefold(), record["id"])
        own = sorted((record for record in records.tools.values() if record["home"] == workspace["id"]), key=by_name)
        used_ids = set(self._used_here(db, workspace["id"]))
        used = sorted((records.tools[tool_id] for tool_id in used_ids if tool_id in records.tools
                       and records.tools[tool_id]["home"] != workspace["id"]), key=by_name)
        reached = db.execute("SELECT 1 FROM outcome_reached WHERE workspace_id=?", (workspace["id"],)).fetchone() is not None
        may_use = not reached
        offer = sorted((record for record in records.tools.values() if record["home"] != workspace["id"] and record["id"] not in used_ids),
                       key=by_name) if may_use else []
        return {"instance_id": self.instance_id, "workspace_id": workspace["id"],
                "own": [self._tool_item(db, actor, records, record) for record in own],
                "used": [self._tool_item(db, actor, records, record) for record in used],
                "reader_may_use": may_use,
                "offer": [{"tool_id": record["id"], "kind": record["kind"], "name": record["name"]} for record in offer]}

    def _view_tool(self, db, actor, args):
        records = self._tool_records()
        record = self._live_tool(args.get("tool_id"))
        limit = args.get("limit", 5)
        if isinstance(limit, bool) or not isinstance(limit, int) or not 1 <= limit <= LIMITS["page_max"]:
            raise Refusal("INVALID_ARGUMENT", "Invalid page size")
        cursor = args.get("cursor")
        rows = db.execute("SELECT * FROM tool_runs WHERE tool_id=? AND fate='back' AND seq<? ORDER BY seq DESC LIMIT ?",
                          (record["id"], cursor if cursor is not None else 9223372036854775807, limit + 1)).fetchall()
        went_back = [self._run_answer(db, actor, row) for row in rows[:limit]]
        users = db.execute("SELECT u.workspace_id,w.title,w.owner_id FROM tool_uses u JOIN workspaces w ON w.id=u.workspace_id "
                           "WHERE u.tool_id=? AND u.used=1 AND " + CURRENT_USE + " ORDER BY w.title COLLATE NOCASE,u.workspace_id",
                           (record["id"],)).fetchall()
        used_by = [{"workspace_id": row["workspace_id"], "title": row["title"]} for row in users
                   if self._may_write_outcome(db, actor, {"id": row["workspace_id"], "owner_id": row["owner_id"]})]
        linked = [row[0] for row in db.execute("SELECT l.topic_id FROM tool_links l WHERE l.tool_id=? AND l.linked=1 AND " + CURRENT_LINK,
                                                (record["id"],))]
        topics = []
        for topic_id in linked:
            topic = self._readable_topic(db, actor, topic_id)
            if topic is not None:
                topics.append({"topic_id": topic["id"], "title": topic["title"], "workspace_id": topic["workspace_id"], "state": topic["state"],
                               "reader_may_unlink": True})
        topics.sort(key=lambda topic: (topic["title"].casefold(), topic["topic_id"]))
        home = self._home(db, actor, record["home"])
        path = tool_records.check_path(record)
        return {"instance_id": self.instance_id,
                "tool": {"tool_id": record["id"], "kind": record["kind"], "name": record["name"], "summary": record["summary"],
                         "home": home, "check": {"path": path} if path else None, "record_path": "skills/%s.json" % record["id"],
                         "files": [{"path": file, "check": file == path} for file in record["files"]],
                         "content_id": records.content[record["id"]], "word": self._live_word(db, record, records.content[record["id"]])},
                "went_back": {"items": went_back, "next_cursor": rows[limit - 1]["seq"] if len(rows) > limit else None},
                "used_by": used_by, "used_by_hidden": len(users) - len(used_by),
                "topics": topics, "topics_hidden": len(linked) - len(topics),
                "reader_may_link": home["readable"]}

    def _view_topic_tools(self, db, actor, args):
        records = self._tool_records()
        topic = self._topic(db, actor, args.get("topic_id"))
        linked = []
        for (tool_id,) in db.execute("SELECT l.tool_id FROM tool_links l WHERE l.topic_id=? AND l.linked=1 AND " + CURRENT_LINK + " ORDER BY l.tool_id",
                                     (topic["id"],)):
            record = records.tools.get(tool_id)
            if record is not None:
                linked.append({"tool_id": tool_id, "kind": record["kind"], "name": record["name"], "home_workspace_id": record["home"], "live": True})
            else:
                # A tool with no live record (a first version that did not ship, or one deleted since): named from what
                # its runs recorded, with no page to link to, so the link can still be taken off.
                run = db.execute("SELECT name,home_workspace_id FROM tool_runs WHERE tool_id=? ORDER BY seq DESC LIMIT 1", (tool_id,)).fetchone()
                linked.append({"tool_id": tool_id, "kind": None, "name": run["name"] if run else tool_id,
                               "home_workspace_id": run["home_workspace_id"] if run else None, "live": False})
        offered = [] if topic["kind"] == "conversation" else sorted(
            ({"tool_id": record["id"], "kind": record["kind"], "name": record["name"]}
             for record in records.tools.values() if record["home"] == topic["workspace_id"]), key=lambda tool: (tool["name"].casefold(), tool["tool_id"]))
        return {"instance_id": self.instance_id, "topic_id": topic["id"], "linked": sorted(linked, key=lambda tool: (tool["name"].casefold(), tool["tool_id"])),
                "offered": offered, "reader_may_link": topic["kind"] != "conversation"}


def _stored(row):
    """A tool_runs row's validated fields as tool.record takes them, and its home."""
    return {"tool_id": row["tool_id"], "name": row["name"], "content_id": row["content_id"], "commit_sha": row["commit_sha"],
            "tree_sha": row["tree_sha"], "live_commit": row["live_commit"], "check_path": row["check_path"], "result": row["result"],
            "passed": row["passed"], "total": row["total"], "failing": json.loads(row["failing"]), "failing_more": row["failing_more"],
            "why": row["why"], "fate": row["fate"], "first_version": row["first_version"], "items_back": json.loads(row["items_back"]),
            "home_workspace_id": row["home_workspace_id"]}

from __future__ import annotations

"""Skills and tools as agent verbs (item 17; docs/agent-cli.md, "Skills and tools").

A mixin of do_* methods for cli.Agent, and register(verb), which cli._parser calls to add their arguments. The words
are the server's (tool_words): the views carry them. Times are absolute local times.
"""

import json
from pathlib import Path
import time


def _at(ms):
    return time.strftime("%Y-%m-%d %H:%M", time.localtime(ms / 1000.0)) if isinstance(ms, int) else "(time unknown)"


def register(verb):
    tools = verb("tools")
    tools.add_argument("outcome")
    tool = verb("tool")
    tool.add_argument("tool")
    tool.add_argument("--went-back", dest="went_back", type=int, default=5)
    use = verb("tool-use")
    use.add_argument("tool")
    use.add_argument("outcome")
    use.add_argument("--off", action="store_true")
    link = verb("tool-link")
    link.add_argument("tool")
    link.add_argument("topic")
    link.add_argument("--off", action="store_true")
    record = verb("tool-record")
    record.add_argument("file")


def _word(word):
    return word["words"] + (" · " + _at(word["at_ms"]) if word.get("state") == "passed" else "")


class ToolVerbs:
    def _tool_line(self, item):
        home = item["home"]
        where = "" if home.get("readable") is not False else "  (home: an outcome you are not on)"
        return "  %s  %s  (%s)  %s%s" % (item["tool_id"], item["name"], item["kind"], _word(item["word"]), where)

    def do_tools(self):
        answer = self.view("tools", {"workspace_id": self.options.outcome})
        self.out.plain("Its own:" if answer["own"] else "Its own: none")
        for item in answer["own"]:
            self.out.plain(self._tool_line(item))
        self.out.plain("Used here:" if answer["used"] else "Used here: none")
        for item in answer["used"]:
            self.out.plain(self._tool_line(item))

    def do_tool(self):
        if not 1 <= self.options.went_back <= 100:
            self.refuse("INVALID_ARGUMENT", "--went-back is 1 to 100")
        answer = self.view("tool", {"tool_id": self.options.tool, "limit": self.options.went_back})
        tool = answer["tool"]
        self.out.plain("%s  (%s)  %s" % (tool["name"], tool["kind"].capitalize(), tool["summary"]))
        home = tool["home"]
        self.out.plain("Home: %s" % (home["title"] if home["readable"] else "an outcome you are not on (%s)" % home["workspace_id"]))
        self.out.plain("Its check: %s" % _word(tool["word"]))
        users = [user["title"] for user in answer["used_by"]]
        if answer["used_by_hidden"]:
            users.append("%d outcome%s you cannot open" % (answer["used_by_hidden"], "" if answer["used_by_hidden"] == 1 else "s"))
        self.out.plain("Used by: %s" % (", ".join(users) if users else "No outcome says it uses this yet."))
        for item in answer["went_back"]["items"]:
            topic = item.get("topic")
            self.out.plain("Went back %s: %s.%s" % (_at(item["recorded_ms"]), item["words"], " Topic: %s (%s)." % (topic["title"], topic["topic_id"]) if topic else ""))
        if answer["went_back"]["next_cursor"] is not None:
            self.out.plain("  (more went back; --went-back N shows more)")
        for topic in answer["topics"]:
            self.out.plain("Topic about it: %s  %s  [%s]" % (topic["topic_id"], topic["title"], topic["state"]))
        if answer["topics_hidden"]:
            self.out.plain("and %d topic%s you cannot open" % (answer["topics_hidden"], "" if answer["topics_hidden"] == 1 else "s"))
        self.out.plain("Files: %s" % tool["record_path"])
        for file in tool["files"]:
            self.out.plain("  %s%s" % (file["path"], "  (its check)" if file["check"] else ""))

    def do_tool_use(self):
        options = self.options
        result = self.command("tool.use", {"workspace_id": options.outcome}, {"tool_id": options.tool, "used": not options.off})
        self.out.plain("%s %s %s%s" % (options.outcome, "uses" if result["used"] else "does not use", options.tool,
                                       "" if result["changed"] else " (no change)"))

    def do_tool_link(self):
        options = self.options
        result = self.command("tool.link", {"topic_id": options.topic}, {"tool_id": options.tool, "linked": not options.off})
        self.out.plain("%s %s %s%s" % (options.topic, "is about" if result["linked"] else "is not about", options.tool,
                                       "" if result["changed"] else " (no change)"))

    def do_tool_record(self):
        """One run from a JSON file: the run's fields and its home_workspace_id, as tools/tool_check.py writes it."""
        try:
            run = json.loads(Path(self.options.file).read_text(encoding="utf-8"))
        except (OSError, ValueError) as error:
            self.refuse("INVALID_ARGUMENT", "the run could not be read from %s: %s" % (self.options.file, error))
        if not isinstance(run, dict) or not isinstance(run.get("home_workspace_id"), str):
            self.refuse("INVALID_ARGUMENT", "a run file names its home_workspace_id; nothing was sent")
        home = run.pop("home_workspace_id")
        result = self.command("tool.record", {"workspace_id": home}, {"run": run})
        topic = (result["run"].get("topic") or {}).get("topic_id")
        self.out.plain("%s %s %s%s" % (run.get("tool_id"), run.get("fate"), "recorded" if result["recorded"] else "was already recorded",
                                       " (topic %s)" % topic if topic else ""))

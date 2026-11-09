from __future__ import annotations

"""The pipeline's agent verbs (item 84; docs/agent-cli.md, "The pipeline").

A mixin of do_* methods for cli.Agent, and register(verb), which cli._parser
calls to add their arguments. Times are absolute local times.
"""

import json
from pathlib import Path
import time


def _at(ms):
    return time.strftime("%Y-%m-%d %H:%M", time.localtime(ms / 1000.0)) if isinstance(ms, int) else "(time unknown)"


def _numbers(value):
    return [int(part) for part in value.split(",") if part.strip()]


def _duration(ms):
    minutes = int(round(ms / 60000.0))
    hours, minutes = divmod(minutes, 60)
    return ("%d h %d min" % (hours, minutes) if minutes else "%d h" % hours) if hours else "%d min" % minutes


def register(verb):
    pipeline = verb("pipeline")
    pipeline.add_argument("outcome")
    pipeline.add_argument("--section", choices=("now", "next", "later", "candidates", "shipped", "dropped"))
    item = verb("item")
    item.add_argument("outcome")
    item.add_argument("number", type=int)
    on = verb("pipeline-on")
    on.add_argument("outcome")
    on.add_argument("--title")
    on.add_argument("--unit")
    on.add_argument("--unsized", action="store_true")
    on.add_argument("--releases", action="store_true")
    on.add_argument("--off", action="store_true")
    stages = verb("stages")
    stages.add_argument("outcome")
    stages.add_argument("--set", dest="stages_file")
    add = verb("add")
    add.add_argument("outcome")
    add.add_argument("--title", required=True)
    add.add_argument("--size")
    add.add_argument("--section", default="candidates")
    add.add_argument("--group", default="")
    add.add_argument("--from", dest="sources")
    add.add_argument("--note")
    add.add_argument("--raised-by")
    add.add_argument("--part", action="store_true")
    add.add_argument("text")
    source = verb("add-source")
    source.add_argument("outcome")
    source.add_argument("number", type=int)
    source.add_argument("--from", dest="sources")
    source.add_argument("--page")
    source.add_argument("--note")
    source.add_argument("--part", action="store_true")
    move = verb("move")
    move.add_argument("outcome")
    move.add_argument("number", type=int)
    move.add_argument("--above", type=int)
    move.add_argument("--below", type=int)
    move.add_argument("--to")
    move.add_argument("--undo", type=int)
    move.add_argument("--underway", action="store_true")
    move.add_argument("--because")
    piece = verb("piece")
    piece.add_argument("outcome")
    piece.add_argument("numbers")
    piece.add_argument("--topic", required=True)
    piece.add_argument("--stage", required=True)
    piece.add_argument("--size")
    piece.add_argument("--ask")
    piece.add_argument("--from-release", action="store_true")
    enter = verb("enter-stage")
    enter.add_argument("piece")
    enter.add_argument("stage")
    enter.add_argument("--round", type=int, default=1)
    enter.add_argument("--left", default="passed", choices=("approved", "sent-back", "passed", "held"))
    enter.add_argument("--note", default="")
    enter.add_argument("--left-note", default="")
    enter.add_argument("--ask")
    note = verb("stage-note")
    note.add_argument("piece")
    note.add_argument("text")
    note.add_argument("--progress")
    combine = verb("combine")
    combine.add_argument("outcome")
    combine.add_argument("--release", type=int)
    combine.add_argument("--pieces", required=True)
    combine.add_argument("--topic", required=True)
    combine.add_argument("--commit")
    combine.add_argument("--ask")
    verb("finish").add_argument("piece")


class PipelineVerbs:
    """cli.Agent's pipeline verbs (4.1 and 5.1 of the outcome-page plan)."""

    def _item_lines(self, item):
        state = item["glyph"].replace("building", "being built").replace("decide", "waiting on you").replace("idle", "not started")
        self.out.plain("%-4d %s  [%s · %s]" % (item["number"], item["title"], item["section"], state))
        who = ("raised by " + item["raised_by"]) if item.get("raised_by") else (item.get("raised_note") or "")
        line = " · ".join(part for part in (item.get("size"), who) if part)
        if line:
            self.out.plain("     " + line)
        stage = item.get("stage")
        if stage:
            words = "%s since %s" % (stage["name"], _at(stage["entered_ms"]))
            typical = stage.get("typical") or {}
            if "ms" in typical:
                words += " · past items took %s here (median of %d%s)" % (_duration(typical["ms"]), typical["of"], "; few" if typical["loose"] else "")
            self.out.plain("     " + words)
        sources = item.get("sources") or {}
        shown = []
        for source in sources.get("shown", [])[:6]:
            if source["kind"] == "message" and source.get("readable"):
                shown.append("%s #%s%s" % (source["topic_title"], source["seq"], " (%s)" % source["author"] if source["author"] == self.actor else ""))
            elif source["kind"] == "note":
                shown.append(source["text"])
            elif source["kind"] == "page":
                shown.append("page “%s”" % source["title"])
            else:
                shown.append("a message you can't open")
        if shown:
            more = sources.get("count", 0) - len(shown)
            self.out.plain("     from " + "; ".join(shown) + (" and %d more" % more if more > 0 else ""))
        for ask in item.get("asks") or []:
            self.out.plain("     %s asked you %s in %s: %s" % (ask["by"], _at(ask["since_ms"]), ask["topic_title"], ask["excerpt"][:120]))

    def do_pipeline(self):
        options = self.options
        sections = [options.section] if options.section else ["now", "next", "later", "candidates"]
        for section in sections:
            if section == "shipped":
                cursor = None
                while True:
                    page = self.view("pipeline", dict({"workspace_id": options.outcome, "section": section}, **({} if cursor is None else {"cursor": cursor})))
                    if page.get("pipeline") is None:
                        self.out.plain("%s has no pipeline" % options.outcome)
                        return
                    for group in page.get("groups") or []:
                        self.out.plain("%s · %d items" % (group["label"], len(group["items"])))
                        for item in group["items"]:
                            self.out.plain("  %-4d %s" % (item["number"], item["title"]))
                    cursor = page.get("next_cursor")
                    if cursor is None:
                        break
                continue
            items = self.pages("pipeline", {"workspace_id": options.outcome, "section": section})
            if self.last_page.get("pipeline") is None:
                self.out.plain("%s has no pipeline" % options.outcome)
                return
            self.out.plain(section.upper())
            for item in items:
                self._item_lines(item)

    def do_item(self):
        answer = self.view("pipeline_item", {"workspace_id": self.options.outcome, "number": self.options.number})
        item = answer["item"]
        self._item_lines(item)
        if item.get("description"):
            self.out.plain("     " + item["description"])
        for piece in item.get("pieces") or []:
            for entry in piece.get("stages_so_far") or []:
                self.out.plain("     %s: %s to %s%s" % (entry["name"], _at(entry["entered_ms"]), _at(entry["left_ms"]),
                                                       " · " + entry["left_outcome"] if entry.get("left_outcome") else ""))
        for event in item.get("events") or []:
            # A move made on the owner's word says so, with the message when the reader can open it.
            payload, because = event.get("payload") or {}, event.get("because") or {}
            word = (" on %s's word%s" % (payload["go_ahead"], " (%s)" % because["message_id"] if because.get("readable") else "")
                    if payload.get("go_ahead") else "")
            self.out.plain("     event %d: %s by %s %s%s" % (event["seq"], event["kind"], event["by"], _at(event["ms"]), word))

    def do_pipeline_on(self):
        options = self.options
        current = self.view("pipeline", {"workspace_id": options.outcome, "limit": 1}).get("pipeline")
        args = {"enabled": not options.off}
        if options.title:
            args["title"] = options.title
        if options.unit:
            one, _, many = options.unit.partition(",")
            args.update(unit_one=one, unit_many=many or one + "s")
        if options.unsized:
            args["sized"] = False
        if options.releases:
            args["ships_in_releases"] = True
        result = self.command("pipeline.configure", {"workspace_id": options.outcome}, args,
                              {"pipeline_revision": current["version"] if current else 0})
        self.out.plain("pipeline %s %s" % (options.outcome, "on" if result["enabled"] else "off"))

    def do_stages(self):
        options = self.options
        answer = self.view("pipeline", {"workspace_id": options.outcome, "limit": 1})
        if options.stages_file:
            stages = json.loads(Path(options.stages_file).read_text(encoding="utf-8"))
            self.command("pipeline.stages_set", {"workspace_id": options.outcome}, {"stages": stages},
                         {"pipeline_revision": answer["pipeline"]["version"]})
            answer = self.read_back("pipeline", {"workspace_id": options.outcome, "limit": 1}, {
                "what": "the stages of %s's pipeline were recorded" % options.outcome, "kind": "pipeline.stages_set", "it": "them"},
                "`stages %s` lists them" % options.outcome)
        for position, stage in enumerate((answer.get("pipeline") or {}).get("stages", []), 1):
            self.out.plain("%d %s (%s, %s): %s" % (position, stage["name"], stage["stage_id"], stage["rounds"], stage["done_when"]))

    def _sources(self):
        options = self.options
        sources = [{"message_id": message} for message in (options.sources or "").split(",") if message.strip()]
        if getattr(options, "page", None):
            sources.append({"memory_item_id": options.page})
        if options.note:
            sources.append({"note": options.note})
        return sources

    def do_add(self):
        options = self.options
        args = {"title": options.title, "description": self.text(), "section": options.section, "sources": self._sources()}
        if options.size:
            args["size"] = options.size
        if options.section == "candidates":
            args["candidate_group"] = options.group
        if options.raised_by:
            args["raised_by"] = options.raised_by
        if options.part:
            args["part"] = True
        result = self.command("pipeline.item_add", {"workspace_id": options.outcome}, args)
        self.out.plain("added %d to %s" % (result["number"], options.outcome))

    def do_add_source(self):
        options = self.options
        item = self.view("pipeline_item", {"workspace_id": options.outcome, "number": options.number})["item"]
        args = {"sources": self._sources()}
        if options.part:
            args["part"] = True
        self.command("pipeline.source_add", {"workspace_id": options.outcome, "number": options.number}, args, {"item_revision": item["version"]})
        self.out.plain("added %d source%s to %d" % (len(args["sources"]), "" if len(args["sources"]) == 1 else "s", options.number))

    def do_move(self):
        options = self.options
        item = self.view("pipeline_item", {"workspace_id": options.outcome, "number": options.number})["item"]
        args = {}
        if options.undo is not None:
            args["undo_of"] = options.undo
        else:
            if options.to:
                args["section"] = options.to
            if options.above is not None:
                args["above"] = options.above
            if options.below is not None:
                args["below"] = options.below
        if options.underway:
            args["underway_confirmed"] = True
        if options.because:
            args["because_message_id"] = options.because
        result = self.command("pipeline.item_move", {"workspace_id": options.outcome, "number": options.number}, args,
                              {"item_revision": item["version"]})
        self.out.plain("moved %d to %s (event %d)" % (options.number, result["section"], result["event"]))

    def do_piece(self):
        options = self.options
        args = {"numbers": _numbers(options.numbers), "topic_id": options.topic, "stage_id": options.stage}
        if options.size:
            args["size"] = options.size
        if options.ask:
            args["ask_message_id"] = options.ask
        if options.from_release:
            args["from_release"] = True
        result = self.command("pipeline.piece_start", {"workspace_id": options.outcome}, args)
        self.out.plain("started piece %s with %s in %s" % (result["piece_id"], ", ".join(map(str, result["numbers"])), result["stage_id"]))

    def do_enter_stage(self):
        options = self.options
        args = {"stage_id": options.stage, "round": options.round, "left_outcome": options.left.replace("-", " ")}
        if options.note:
            args["note"] = options.note
        if options.left_note:
            args["left_note"] = options.left_note
        if options.ask:
            args["ask_message_id"] = options.ask
        result = self.command("pipeline.stage_enter", {"piece_id": options.piece}, args)
        self.out.plain("%s entered %s, round %d" % (options.piece, result["stage_id"], result["round"]))

    def do_stage_note(self):
        options = self.options
        args = {"note": self.text()}
        if options.progress:
            args["progress"] = json.loads(Path(options.progress).read_text(encoding="utf-8"))
        self.command("pipeline.stage_note", {"piece_id": options.piece}, args)
        self.out.plain("noted on %s" % options.piece)

    def do_combine(self):
        options = self.options
        args = {"piece_ids": [part for part in options.pieces.split(",") if part], "topic_id": options.topic}
        if options.release is not None:
            args["release_number"] = options.release
        if options.commit:
            args["commit_sha"] = options.commit
        if options.ask:
            args["ask_message_id"] = options.ask
        result = self.command("pipeline.combine", {"workspace_id": options.outcome}, args)
        self.out.plain("release %d combined as %s with %s" % (result["release_number"], result["piece_id"], ", ".join(map(str, result["numbers"]))))

    def do_finish(self):
        self.command("pipeline.piece_finish", {"piece_id": self.options.piece}, {})
        self.out.plain("%s finished" % self.options.piece)

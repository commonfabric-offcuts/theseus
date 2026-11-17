#!/usr/bin/python3 -I
from __future__ import annotations

"""The start line: before a build starts, a one-line brief of what it will build, and the answer the cut reads.

Usage:
  tools/start_line.py open OUTCOME N --topic TOPIC --cli LIVE/bin/aim-next --profile /abs/agent.json --surface LIVE
      [--user-facing] [--every-feature] [--owner-decides] [--window MINUTES] [--now ISO] [--python P] -- WRITER [ARG...]
  tools/start_line.py cut OUTCOME N --cli LIVE/bin/aim-next --profile /abs/agent.json [--now ISO] [--python P]

A start line is a notice with a default, not a question (warp, codex #6643). Every line is posted with a window and,
under it, the sentence "a 👍, or nothing by H:MM, builds it as written; anything you write, I rewrite the line and post
it again", H:MM being that post's window end in Pacific time (15 minutes by default, rounded up to the minute).

`open` runs when a build slot opens for item N. WRITER is the headless brief-writer: it runs in the live checkout
(--surface) with a prompt on its stdin that holds the item's words and where they came from, reads the surface the
item touches as it is that minute, and prints one line. The line is posted in TOPIC, the piece's topic, about item N
(its subject), under one operation id per revision of the item's words: to the outcome's owner when the item is
theirs (they raised it, or a message it came from is theirs), when --owner-decides says the build holds a product
decision they own, or, with the --every-feature switch, when --user-facing says the build is a user-facing feature;
otherwise to nobody, kept with the item's work. A start line already recorded for that revision is answered as it
stands and the writer is not run again, so a retry never asks the owner twice. Then every reply of the owner's under a
start line of that revision, whatever its words, is a correction: the writer is given the newest line and the reply,
and its line is posted again as a reply to it, to the owner, with a new window, under one operation per (revision,
reply), so a retry never posts it twice.

`cut` reads the newest start line of the item's current words, from Theseus: the owner's 👍 on it, or its window
ending with nothing written under it, builds it as written. A reply not yet worked into a line, or a window still open,
refuses the cut. Nothing in the tool reads what a reply's words mean: every reply is the writer's to work in.

Each prints one JSON object. Exit 0: done; 1: refused, one line on stderr naming why, nothing posted; 2: Theseus
could not be read or did not record the post (never read as "nothing there"). docs/tools.md, "Start line".
"""

import argparse
from datetime import datetime, timedelta, timezone
import hashlib
import json
from pathlib import Path
import re
import subprocess
import sys
from zoneinfo import ZoneInfo

PYTHON = "/usr/bin/python3"
LINE_MAX = 300
NAME = re.compile(r"[A-Za-z0-9._@-]+")
PAGE = 100
# The window a start line stands open for by default: the 15 minutes after which a default the owner was told of
# stands on his standing rule for calls. --window changes it.
WINDOW = 15
PACIFIC = ZoneInfo("America/Los_Angeles")
SENTENCE = "a 👍, or nothing by %s, builds it as written; anything you write, I rewrite the line and post it again"
# The window's end as the line's own post records it, for the cut: its last words, an ISO time with its offset.
ENDS = re.compile(r" Its window ends (\d{4}-\d\d-\d\dT\d\d:\d\d[+-]\d\d:\d\d)\.\Z")


class Refused(Exception):
    """Exit 1: nothing was posted, or the cut cannot say what to build."""


class Unread(Exception):
    """Exit 2: Theseus could not be read, or did not record the post."""


class LiveCli:
    """The live release's agent CLI, run as the live code is; reads through its views, posts through its verbs."""

    def __init__(self, cli, profile, python=PYTHON):
        self.cli, self.profile, self.python = str(cli), str(profile), python
        self._binding = None

    def _run(self, argv, request=None, text=None):
        stdin = json.dumps(request) if request is not None else text
        answer = subprocess.run([self.python, "-I", "-B", self.cli, "--profile", self.profile] + argv, capture_output=True,
                                text=True, input=stdin, stdin=subprocess.DEVNULL if stdin is None else None)
        lines = [line for line in answer.stdout.splitlines() if line.startswith("{")]
        try:
            return answer.returncode, json.loads(lines[-1]) if lines else None, answer.stderr.strip()
        except ValueError:
            return answer.returncode, None, answer.stderr.strip()

    def binding(self):
        if self._binding is None:
            code, answer, said = self._run(["binding"])
            if code != 0 or not isinstance(answer, dict) or "binding" not in answer:
                raise Unread("the live CLI's binding could not be read (exit %s): %s" % (code, said))
            self._binding = answer["binding"]
        return self._binding

    def view(self, name, args):
        code, answer, said = self._run(["view", "-"], {"v": 1, "binding": self.binding(), "view": {"name": name, "args": args}})
        if not isinstance(answer, dict):
            raise Unread("the live CLI did not answer the %s view (exit %s): %s" % (name, code, said))
        # A recorded refusal is what the operation view found, not a refusal of the read.
        if answer.get("error") and not (name == "operation" and answer.get("recorded") is True):
            raise Unread("the %s view was refused: %s %s" % (name, answer["error"].get("code"), answer["error"].get("message")))
        return answer

    def post(self, topic, words, operation, number, to=None, reply_to=None):
        """One message.post under operation, about item number: its receipt, or the error it was refused with. It is
        sent as a request of its own, never saved in the CLI's outbox: a post Core refused leaves the operation free,
        and one Core recorded is found by the operation view, so nothing saved can stand between them."""
        binding = self.binding()
        args = {"body": words, "addressees": [to] if to else [], "subjects": [{"kind": "item", "ref": number}]}
        if to:
            args["intent"] = "tell"
        if reply_to:
            args["reply_to"] = reply_to
        envelope = {"v": 1, "instance_id": binding["instance_id"], "operation_id": operation, "kind": "message.post",
                    "target": {"topic_id": topic}, "args": args,
                    "expected": {"authority": {key: binding[key] for key in ("authority_id", "authority_epoch")}}}
        code, answer, said = self._run(["command", "-"], {"v": 1, "binding": binding, "command": envelope})
        if not isinstance(answer, dict):
            raise Unread("the live CLI did not answer the post (exit %s): %s" % (code, said))
        return answer


# The item and its revision ----------------------------------------------------------------------------------------

def read_item(cli, outcome, number):
    """(item, owner) as the pipeline_item view gives them."""
    answer = cli.view("pipeline_item", {"workspace_id": outcome, "number": number})
    return answer["item"], answer["pipeline"]["owner"]


def revision(item):
    """The revision of the item's words: its title, its words and where it came from. A move or a new place in its
    section is not a new revision, so it never asks again, and the cut finds the line it asked."""
    sources = [{key: source.get(key) for key in ("kind", "message_id", "memory_item_id", "text", "readable")}
               for source in item["sources"]["shown"]]
    words = json.dumps([item["title"], item["description"], sources], ensure_ascii=False, sort_keys=True)
    return hashlib.sha256(words.encode("utf-8")).hexdigest()[:12]


def operation_of(outcome, number, item):
    operation = "start-line-%s-%d-%s" % (outcome, number, revision(item))
    if not NAME.fullmatch(operation):
        raise Refused("outcome %r cannot name an operation (letters, digits, '.', '_', '@' and '-')" % outcome)
    return operation


def rewrite_operation(revision_operation, reply_id):
    """The operation of the line that works the owner's reply in: one per (revision, reply answered)."""
    operation = "%s-re-%s" % (revision_operation, reply_id)
    if not NAME.fullmatch(operation):
        raise Refused("reply %r cannot name an operation" % reply_id)
    return operation


def owners_item(item, owner):
    """The owner raised it, or a message it came from is the owner's."""
    return item.get("raised_by") == owner or any(
        source.get("kind") == "message" and source.get("readable") and source.get("author") == owner
        for source in item["sources"]["shown"])


def read_message(cli, message_id):
    """A message's source view, with its words. A message its author has open in Edit is held from agents and its
    words are left out: that is never read as a message with no words, so a correction being written is not a 👍
    and an ask being written is not an empty one."""
    source = cli.view("source", {"source_ref": {"kind": "message", "id": message_id}})
    if source.get("withheld"):
        raise Unread("%s has %s open in Edit; it is read once they save or leave the edit" % (source.get("author"), message_id))
    return source


def find(cli, revision_operation):
    """(operation, message): the start line recorded for this revision and its operation, or (the operation to post
    under, None) when none is. A post Theseus refused and recorded (a topic the poster may not write in) asked nobody
    and spent its operation, so the revision's next one is read: REV, then REV.2, REV.3 and on."""
    attempt = 1
    while True:
        operation = revision_operation if attempt == 1 else "%s.%d" % (revision_operation, attempt)
        found = cli.view("operation", {"operation_id": operation})
        if found.get("recorded") is not True:
            return operation, None
        if not found.get("error"):
            return operation, found["result"]["message_id"]
        attempt += 1


# The window ----------------------------------------------------------------------------------------------------

def window_end(now, minutes):
    """When a line posted at now stops standing open: now and the window, rounded up to the minute so the time it
    states is never earlier than the end, in Pacific time."""
    end = now + timedelta(minutes=minutes)
    if end.second or end.microsecond:
        end = end.replace(second=0, microsecond=0) + timedelta(minutes=1)
    return end.astimezone(PACIFIC)


def clock(end):
    """H:MM, as the sentence states it."""
    return "%d:%02d" % (end.hour % 12 or 12, end.minute)


def window_of(source, message_id):
    """The window end a start line's post recorded."""
    found = ENDS.search(source["body"])
    if not found:
        raise Refused("start line %s records no window end" % message_id)
    return datetime.fromisoformat(found.group(1))


def thread(cli, revision_operation, first, owner):
    """(lines, pending) for the revision whose first start line is first, (operation, message): its start lines,
    oldest first, each {operation_id, message_id}; and every reply of the owner's under any of them that no line works
    in yet, oldest first, each (reply, the operation its line is posted under). Read in the line's topic from the line
    on, page by page. Each reply is matched to its line by the operation it names, never by its words."""
    start = read_message(cli, first[1])
    lines, ids, awaited, pending = [{"operation_id": first[0], "message_id": first[1]}], {first[1]}, {}, []
    cursor = start["seq"]
    while cursor is not None:
        page = cli.view("topic_messages", {"topic_id": start["topic_id"], "cursor": cursor, "limit": PAGE})
        for message in page["items"]:
            if message["id"] in awaited:
                lines.append({"operation_id": awaited.pop(message["id"]), "message_id": message["id"]})
                ids.add(message["id"])
            elif message.get("reply_to") in ids and message.get("author_id") == owner:
                operation, line = find(cli, rewrite_operation(revision_operation, message["id"]))
                if line is None:
                    pending.append((message, operation))
                else:
                    awaited[line] = operation
        cursor = page.get("next_cursor")
    if awaited:
        raise Unread("the start line(s) %s are recorded but not in topic %s" % (", ".join(sorted(awaited)), start["topic_id"]))
    return lines, pending


# open ------------------------------------------------------------------------------------------------------------

def prompt(cli, outcome, number, item, rewrite=None):
    lines = []
    for source in item["sources"]["shown"]:
        if source["kind"] == "message" and source.get("readable"):
            words = read_message(cli, source["message_id"])["body"]
            lines.append('- %s wrote, in "%s":\n%s' % (source["author"], source["topic_title"], words.strip()))
        elif source["kind"] == "message":
            lines.append("- a message you can't open")
        elif source["kind"] == "page":
            lines.append('- the Notebook page "%s"' % source["title"])
        else:
            lines.append("- a note: %s" % source["text"])
    ask = ("Then print exactly one line, at most %d characters, and nothing else: what the build will change and where, "
           "against what is there now, in plain words a person reads at a glance." % LINE_MAX)
    if rewrite:
        written, owner, words = rewrite
        ask = ("The start line now reads:\n%s\n\n%s wrote under it:\n%s\n\nWhatever they wrote is a correction to the line. "
               "Print the line as it should now read, with what they wrote worked in: exactly one line, at most %d characters, "
               "and nothing else. If what they wrote changes nothing in what will be built, print the line as it is."
               % (written, owner, words.strip(), LINE_MAX))
    return ("You write the start line for item %d of %s: one line, said before its build starts, of what will be built.\n\n"
            "Read the item's words below, then read the surface it touches as it is now: your working directory is the live "
            "checkout, the code people are using this minute. Find the page, view, command or tool the item names and read how "
            "it behaves now. Change no file.\n\n%s\n\n"
            "Item %d: %s\n%s\n\nWhere it came from:\n%s\n"
            % (number, outcome, ask, number, item["title"], item["description"], "\n".join(lines) or "- nothing recorded"))


def write_brief(writer, surface, words):
    """The writer's one line; it runs in the live checkout with the prompt on its stdin."""
    try:
        answer = subprocess.run(writer, cwd=str(surface), input=words, capture_output=True, text=True)
    except OSError as error:
        raise Refused("the brief-writer could not be run: %s" % error)
    if answer.returncode != 0:
        raise Refused("the brief-writer exited %d: %s" % (answer.returncode, answer.stderr.strip()[-300:]))
    line = answer.stdout.strip()
    if not line:
        raise Refused("the brief-writer wrote nothing")
    if "\n" in line:
        raise Refused("the brief-writer wrote %d lines; a start line is one" % len(line.splitlines()))
    if len(line) > LINE_MAX:
        raise Refused("the brief-writer wrote %d characters; a start line is at most %d" % (len(line), LINE_MAX))
    return line


def body(line, number, item, to_owner, end):
    """The line, the sentence under it with its window's end, then what it is and the end as the cut reads it."""
    told = "" if to_owner else " Kept with the item's work; the owner is not told."
    return '%s\n\n%s\n\nStart line for %d, "%s": what its build will make.%s Its window ends %s.' % (
        line, SENTENCE % clock(end), number, item["title"], told, end.isoformat(timespec="minutes"))


def surface_commit(surface):
    answer = subprocess.run(["git", "-C", str(surface), "rev-parse", "HEAD"], capture_output=True, text=True, stdin=subprocess.DEVNULL)
    if answer.returncode != 0:
        raise Refused("the surface %s is not a git checkout: %s" % (surface, answer.stderr.strip()))
    return answer.stdout.strip()


def post_line(cli, topic, words, operation, revision_operation, number, to, reply_to=None):
    """(operation, message, posted): one line posted under operation, or the line another run recorded first."""
    answer = cli.post(topic, words, operation, number, to, reply_to)
    error = answer.get("error")
    if error and error.get("code") == "OPERATION_PAYLOAD_MISMATCH":
        # Another run of this revision recorded its line first: that line is the one asked, once.
        operation, message = find(cli, revision_operation)
        if message is None:
            raise Unread("the start line under %s is not recorded" % operation)
        return operation, message, False
    if error and error.get("retryable"):
        raise Unread("the start line was not recorded (%s: %s); open it again: nobody was asked"
                     % (error.get("code"), error.get("message")))
    if error:
        raise Refused("the start line was refused: %s %s; nobody was asked" % (error.get("code"), error.get("message")))
    return operation, answer["result"]["message_id"], True


def open_line(cli, outcome, number, topic, surface, writer, now, window=WINDOW, user_facing=False, every_feature=False,
              owner_decides=False):
    item, owner = read_item(cli, outcome, number)
    revision_operation = operation_of(outcome, number, item)
    theirs = owners_item(item, owner)
    to_owner = theirs or owner_decides or (every_feature and user_facing)
    result = {"item": number, "revision": revision_operation.rsplit("-", 1)[1], "owner": owner, "owners_item": theirs,
              "to_owner": to_owner, "posted": False, "rewrites": []}
    operation, message = find(cli, revision_operation)
    if message is None:
        commit = surface_commit(surface)
        line = write_brief(writer, surface, prompt(cli, outcome, number, item))
        words = body(line, number, item, to_owner, window_end(now, window))
        operation, message, posted = post_line(cli, topic, words, operation, revision_operation, number, owner if to_owner else None)
        if posted:
            result.update(posted=True, surface_commit=commit)
    lines, pending = thread(cli, revision_operation, (operation, message), owner)
    # Whatever the owner wrote is a correction: the writer works it into the newest line, which is posted again under
    # it with a new window. Which words change the line is the writer's to say, never this tool's.
    for reply, rewrite in pending:
        said = read_message(cli, reply["id"])["body"]
        newest = read_message(cli, lines[-1]["message_id"])
        commit = surface_commit(surface)
        line = write_brief(writer, surface, prompt(cli, outcome, number, item, (newest["body"].split("\n", 1)[0], owner, said)))
        words = body(line, number, item, True, window_end(now, window))
        rewrite, message, posted = post_line(cli, newest["topic_id"], words, rewrite,
                                             rewrite_operation(revision_operation, reply["id"]), number, owner, reply["id"])
        lines.append({"operation_id": rewrite, "message_id": message})
        result["rewrites"].append(dict({"reply": reply["id"], "message_id": message, "posted": posted},
                                       **({"surface_commit": commit} if posted else {})))
    newest = read_message(cli, lines[-1]["message_id"])
    result.update(operation_id=lines[-1]["operation_id"], message_id=lines[-1]["message_id"], topic_id=newest["topic_id"],
                  brief=newest["body"].split("\n", 1)[0], window_ends=window_of(newest, lines[-1]["message_id"]).isoformat(timespec="minutes"))
    return result


# cut -------------------------------------------------------------------------------------------------------------

def cut(cli, outcome, number, now):
    item, owner = read_item(cli, outcome, number)
    revision_operation = operation_of(outcome, number, item)
    operation, message = find(cli, revision_operation)
    if message is None:
        raise Refused("no start line for %d at its current words (operation %s): open one first" % (number, revision_operation))
    lines, pending = thread(cli, revision_operation, (operation, message), owner)
    if pending:
        raise Refused("%s wrote %s under the start line of %d, a correction no line works in yet: open posts the line again with it"
                      % (owner, pending[0][0]["id"], number))
    newest = lines[-1]
    start = read_message(cli, newest["message_id"])
    end = window_of(start, newest["message_id"])
    written = start["body"].split("\n", 1)[0]
    result = {"item": number, "revision": revision_operation.rsplit("-", 1)[1], "operation_id": newest["operation_id"],
              "message_id": newest["message_id"], "topic_id": start["topic_id"], "owner": owner, "brief": written,
              "lines": len(lines), "window_ends": end.isoformat(timespec="minutes")}
    # What Core records is read, never what words mean: the owner's 👍 on the newest line, or that line's window over.
    if any(thumb.get("actor_id") == owner for thumb in (start.get("reactions") or {}).get("thumbs", [])):
        result.update(answer="thumbs-up")
    elif now >= end:
        result.update(answer="window-ended")
    else:
        raise Refused("waiting until %s: start line %s of %d stands open for %s's 👍 or a word until then"
                      % (clock(end), newest["message_id"], number, owner))
    return result


# main ------------------------------------------------------------------------------------------------------------

def main(argv=None):
    argv = list(sys.argv[1:] if argv is None else argv)
    writer = []
    if "--" in argv:
        at = argv.index("--")
        argv, writer = argv[:at], argv[at + 1:]
    parser = argparse.ArgumentParser(prog="start_line.py")
    verbs = parser.add_subparsers(dest="verb", required=True)
    for name in ("open", "cut"):
        verb = verbs.add_parser(name)
        verb.add_argument("outcome")
        verb.add_argument("number", type=int)
        verb.add_argument("--cli", required=True)
        verb.add_argument("--profile", required=True)
        verb.add_argument("--python", default=PYTHON)
        verb.add_argument("--now", help="the time it is, ISO 8601 with its offset; the clock when left out")
        if name == "open":
            verb.add_argument("--window", type=int, default=WINDOW, help="minutes a line stands open (default %d)" % WINDOW)
            verb.add_argument("--topic", required=True)
            verb.add_argument("--surface", required=True)
            verb.add_argument("--user-facing", action="store_true")
            verb.add_argument("--every-feature", action="store_true")
            verb.add_argument("--owner-decides", action="store_true")
    options = parser.parse_args(argv)
    cli = LiveCli(options.cli, options.profile, options.python)
    try:
        try:
            now = datetime.now(timezone.utc) if options.now is None else datetime.fromisoformat(options.now)
        except ValueError:
            raise Refused("--now is an ISO 8601 time with its offset: %s" % options.now)
        if now.tzinfo is None:
            raise Refused("--now names its offset: %s" % options.now)
        if options.verb == "open":
            if options.window < 1:
                raise Refused("--window is a whole number of minutes, at least 1: %d" % options.window)
            if not writer:
                raise Refused("name the brief-writer after --: the command that prints the start line")
            surface = Path(options.surface)
            if not surface.is_absolute() or not surface.is_dir():
                raise Refused("--surface is the live checkout, an absolute directory: %s" % options.surface)
            result = open_line(cli, options.outcome, options.number, options.topic, surface, writer, now, options.window,
                               options.user_facing, options.every_feature, options.owner_decides)
        else:
            if writer:
                raise Refused("cut runs no writer")
            result = cut(cli, options.outcome, options.number, now)
    except Refused as why:
        print("refused: %s" % why, file=sys.stderr)
        return 1
    except Unread as why:
        print("could not read: %s" % why, file=sys.stderr)
        return 2
    print(json.dumps(result, ensure_ascii=False, sort_keys=True))
    return 0


if __name__ == "__main__":
    sys.exit(main())

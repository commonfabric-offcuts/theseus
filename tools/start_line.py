#!/usr/bin/python3 -I
from __future__ import annotations

"""The start line: before a build starts, a one-line brief of what it will build, and the answer the cut reads.

Usage:
  tools/start_line.py open OUTCOME N --topic TOPIC --cli LIVE/bin/aim-next --profile /abs/agent.json --surface LIVE
      [--user-facing] [--every-feature] [--owner-decides] [--python P] -- WRITER [ARG...]
  tools/start_line.py cut OUTCOME N --cli LIVE/bin/aim-next --profile /abs/agent.json [--python P]

`open` runs when a build slot opens for item N. WRITER is the headless brief-writer: it runs in the live checkout
(--surface) with a prompt on its stdin that holds the item's words and where they came from, reads the surface the
item touches as it is that minute, and prints one line. The line is posted in TOPIC, the piece's topic, about item N
(its subject), under one operation id per revision of the item's words: to the outcome's owner when the item is
theirs (they raised it, or a message it came from is theirs), when --owner-decides says the build holds a product
decision they own, or, with the --every-feature switch, when --user-facing says the build is a user-facing feature;
otherwise to nobody, kept with the item's work. A start line already recorded for that revision is answered as it
stands and the writer is not run again, so a retry never asks the owner twice.

`cut` reads the owner's answer to the start line of the item's current words, from Theseus: a reply of the owner's
in one line is a correction and becomes the brief; otherwise (their 👍, a reply with no words, or no answer) the
brief is the line as written. A reply of more than one line is not a brief: the cut refuses rather than build as
written.

Each prints one JSON object. Exit 0: done; 1: refused, one line on stderr naming why, nothing posted; 2: Theseus
could not be read or did not record the post (never read as "nothing there"). docs/tools.md, "Start line".
"""

import argparse
import hashlib
import json
from pathlib import Path
import re
import subprocess
import sys

PYTHON = "/usr/bin/python3"
LINE_MAX = 300
NAME = re.compile(r"[A-Za-z0-9._@-]+")
# A reply whose words hold no letter or digit (a 👍 typed as a reply) says yes; it changes nothing.
WORDED = re.compile(r"[^\W_]")
PAGE = 100


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

    def view(self, name, args):
        if self._binding is None:
            code, answer, said = self._run(["binding"])
            if code != 0 or not isinstance(answer, dict) or "binding" not in answer:
                raise Unread("the live CLI's binding could not be read (exit %s): %s" % (code, said))
            self._binding = answer["binding"]
        code, answer, said = self._run(["view", "-"], {"v": 1, "binding": self._binding, "view": {"name": name, "args": args}})
        if not isinstance(answer, dict):
            raise Unread("the live CLI did not answer the %s view (exit %s): %s" % (name, code, said))
        if answer.get("error"):
            raise Unread("the %s view was refused: %s %s" % (name, answer["error"].get("code"), answer["error"].get("message")))
        return answer

    def post(self, topic, words, operation, number, to=None):
        """One message.post under operation, about item number; its receipt, or the error it was refused with."""
        argv = ["--json", "post", topic, "--operation", operation, "--subject", "item:%d" % number]
        if to:
            argv += ["--tells", to]
        code, answer, said = self._run(argv + ["-"], text=words)
        if not isinstance(answer, dict):
            raise Unread("the live CLI did not answer the post (exit %s): %s" % (code, said))
        return answer

    def retry(self, operation):
        """Sends the request saved under operation again, unchanged: Core answers with what it recorded, or records it."""
        code, answer, said = self._run(["--json", "retry", operation])
        if not isinstance(answer, dict):
            raise Unread("the live CLI did not answer retry %s (exit %s): %s" % (operation, code, said))
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


def owners_item(item, owner):
    """The owner raised it, or a message it came from is the owner's."""
    return item.get("raised_by") == owner or any(
        source.get("kind") == "message" and source.get("readable") and source.get("author") == owner
        for source in item["sources"]["shown"])


def recorded(cli, operation):
    """The message a recorded start line posted under operation, or None when none is recorded."""
    found = cli.view("operation", {"operation_id": operation})
    if found.get("recorded") is not True:
        return None
    if found.get("error"):
        raise Refused("the start line's post %s was refused: %s %s" % (operation, found["error"].get("code"), found["error"].get("message")))
    return found["result"]["message_id"]


# open ------------------------------------------------------------------------------------------------------------

def prompt(cli, outcome, number, item):
    lines = []
    for source in item["sources"]["shown"]:
        if source["kind"] == "message" and source.get("readable"):
            words = cli.view("source", {"source_ref": {"kind": "message", "id": source["message_id"]}})["body"]
            lines.append('- %s wrote, in "%s":\n%s' % (source["author"], source["topic_title"], words.strip()))
        elif source["kind"] == "message":
            lines.append("- a message you can't open")
        elif source["kind"] == "page":
            lines.append('- the Notebook page "%s"' % source["title"])
        else:
            lines.append("- a note: %s" % source["text"])
    return ("You write the start line for item %d of %s: one line, said before its build starts, of what will be built.\n\n"
            "Read the item's words below, then read the surface it touches as it is now: your working directory is the live "
            "checkout, the code people are using this minute. Find the page, view, command or tool the item names and read how "
            "it behaves now. Change no file.\n\n"
            "Then print exactly one line, at most %d characters, and nothing else: what the build will change and where, "
            "against what is there now, in plain words a person reads at a glance.\n\n"
            "Item %d: %s\n%s\n\nWhere it came from:\n%s\n"
            % (number, outcome, LINE_MAX, number, item["title"], item["description"], "\n".join(lines) or "- nothing recorded"))


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


def body(line, number, item, to_owner):
    tail = ("👍 or no answer builds it as written; a reply of one line becomes what it builds." if to_owner
            else "Kept with the item's work; nobody is asked.")
    return '%s\n\nStart line for %d, "%s": what its build will make. %s' % (line, number, item["title"], tail)


def surface_commit(surface):
    answer = subprocess.run(["git", "-C", str(surface), "rev-parse", "HEAD"], capture_output=True, text=True, stdin=subprocess.DEVNULL)
    if answer.returncode != 0:
        raise Refused("the surface %s is not a git checkout: %s" % (surface, answer.stderr.strip()))
    return answer.stdout.strip()


def open_line(cli, outcome, number, topic, surface, writer, user_facing=False, every_feature=False, owner_decides=False):
    item, owner = read_item(cli, outcome, number)
    operation = operation_of(outcome, number, item)
    theirs = owners_item(item, owner)
    to_owner = theirs or owner_decides or (every_feature and user_facing)
    result = {"item": number, "revision": operation.rsplit("-", 1)[1], "operation_id": operation, "owner": owner,
              "owners_item": theirs, "to_owner": to_owner}
    message = recorded(cli, operation)
    if message is None:
        commit = surface_commit(surface)
        line = write_brief(writer, surface, prompt(cli, outcome, number, item))
        answer = cli.post(topic, body(line, number, item, to_owner), operation, number, owner if to_owner else None)
        if (answer.get("error") or {}).get("code") == "OPERATION_PAYLOAD_MISMATCH":
            # Another run of this revision got there first, or its request was saved and never recorded: Core
            # answers with what it holds, or the saved request goes, unchanged. Either way it is asked once.
            message = recorded(cli, operation)
            if message is None:
                cli.retry(operation)
                message = recorded(cli, operation)
        elif answer.get("error"):
            error = answer["error"]
            if error.get("retryable"):
                raise Unread("the start line was not recorded (%s: %s); run again: it is the same operation %s"
                             % (error.get("code"), error.get("message"), operation))
            raise Refused("the start line was refused: %s %s" % (error.get("code"), error.get("message")))
        else:
            message = answer["result"]["message_id"]
            result.update(posted=True, surface_commit=commit)
        if message is None:
            raise Unread("the start line under %s is not recorded" % operation)
    result.setdefault("posted", False)
    source = cli.view("source", {"source_ref": {"kind": "message", "id": message}})
    result.update(message_id=message, topic_id=source["topic_id"], brief=source["body"].split("\n", 1)[0])
    return result


# cut -------------------------------------------------------------------------------------------------------------

def replies(cli, start, owner):
    """The owner's replies to the start line, oldest first, read in its topic from the start line on."""
    found, cursor = [], start["seq"]
    while cursor is not None:
        page = cli.view("topic_messages", {"topic_id": start["topic_id"], "cursor": cursor, "limit": PAGE})
        for item in page["items"]:
            if item.get("reply_to") == start["source_ref"]["id"] and item.get("author_id") == owner:
                found.append(item)
        cursor = page.get("next_cursor")
    return found


def cut(cli, outcome, number):
    item, owner = read_item(cli, outcome, number)
    operation = operation_of(outcome, number, item)
    message = recorded(cli, operation)
    if message is None:
        raise Refused("no start line for %d at its current words (operation %s): open one first" % (number, operation))
    start = cli.view("source", {"source_ref": {"kind": "message", "id": message}})
    written = start["body"].split("\n", 1)[0]
    result = {"item": number, "revision": operation.rsplit("-", 1)[1], "operation_id": operation, "message_id": message,
              "topic_id": start["topic_id"], "owner": owner, "written": written, "brief": written}
    worded, acks = [], []
    for reply in replies(cli, start, owner):
        if reply.get("withheld"):
            raise Unread("%s is editing a reply to the start line (%s); the cut reads it once it is saved" % (owner, reply["id"]))
        words = cli.view("source", {"source_ref": {"kind": "message", "id": reply["id"]}})["body"].strip()
        (worded if WORDED.search(words) else acks).append((reply["id"], words))
    thumbed = any(thumb.get("actor_id") == owner for thumb in (start.get("reactions") or {}).get("thumbs", []))
    if worded:
        reply_id, words = worded[-1]
        if "\n" in words:
            raise Refused("%s's reply %s to the start line of %d is more than one line: read it and cut the brief by hand"
                          % (owner, reply_id, number))
        result.update(brief=words, answer="correction", answer_message_id=reply_id)
    elif thumbed or acks:
        result.update(answer="thumbs-up")
    else:
        result.update(answer="silence")
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
        if name == "open":
            verb.add_argument("--topic", required=True)
            verb.add_argument("--surface", required=True)
            verb.add_argument("--user-facing", action="store_true")
            verb.add_argument("--every-feature", action="store_true")
            verb.add_argument("--owner-decides", action="store_true")
    options = parser.parse_args(argv)
    cli = LiveCli(options.cli, options.profile, options.python)
    try:
        if options.verb == "open":
            if not writer:
                raise Refused("name the brief-writer after --: the command that prints the start line")
            surface = Path(options.surface)
            if not surface.is_absolute() or not surface.is_dir():
                raise Refused("--surface is the live checkout, an absolute directory: %s" % options.surface)
            result = open_line(cli, options.outcome, options.number, options.topic, surface, writer,
                               options.user_facing, options.every_feature, options.owner_decides)
        else:
            if writer:
                raise Refused("cut runs no writer")
            result = cut(cli, options.outcome, options.number)
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

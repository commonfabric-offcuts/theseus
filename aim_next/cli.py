from __future__ import annotations

"""Explicit local Store calls; transport success never acknowledges delivery."""

from .hosted_cli import BrokerFailure

import argparse
import hashlib
import io
import json
import mimetypes
import os
from pathlib import Path
import re
import stat
import sys
import time
import urllib.parse
import uuid

from .authority import AuthorityError
from .contract import LIMITS, Refusal, StoreError
from .effects_watch import NativeWatch, WatchError, WatchStopped
from .topic_state import STATES
from .profile import ProfileError, load_profile
from .store import StoreOpenError
from .health import report_lines


class InvalidRequest(ValueError):
    pass


class UsageError(ValueError):
    pass


from .cli_outcome import PipelineVerbs, _words as held_words, register as register_pipeline
from .cli_clock import ClockVerbs, register as register_clock
from .cli_targets import WORDS as TARGET_WORDS, TargetVerbs, register as register_targets
from .cli_tools import ToolVerbs, register as register_tools
from .cli_covers import CoverVerbs, register as register_covers
from .cli_links import LinkVerbs, register as register_links
from .cli_current_rule import CurrentRuleVerbs, register as register_current_rule


class Parser(argparse.ArgumentParser):
    def error(self, message):
        # Do not echo arbitrary arguments or request contents in diagnostics.
        raise UsageError()


def _binding(profile):
    return {"instance_id": profile.instance_id, "actor_id": profile.actor_id,
            "db_path": str(profile.db_path), "authority_id": profile.authority_id,
            "authority_epoch": profile.authority_epoch}


def _unique(pairs):
    value = {}
    for key, item in pairs:
        if key in value:
            raise InvalidRequest()
        value[key] = item
    return value


def _invalid_constant(value):
    raise InvalidRequest()


def _read(source):
    cap = LIMITS["http_envelope_bytes"] + 8192
    raw = bytearray()
    while len(raw) <= cap:
        chunk = source.read(min(65536, cap + 1 - len(raw)))
        if not isinstance(chunk, bytes):
            raise InvalidRequest()
        if not chunk:
            break
        raw.extend(chunk)
    if len(raw) > cap:
        raise InvalidRequest()
    try:
        value = json.loads(raw.decode("utf-8"), object_pairs_hook=_unique,
                           parse_constant=_invalid_constant)
        # Also rejects overflowed floats and escaped lone surrogates anywhere.
        json.dumps(value, ensure_ascii=False, allow_nan=False).encode("utf-8")
        return value
    except (ValueError, UnicodeError, RecursionError) as error:
        raise InvalidRequest() from error


def _input(path, stdin):
    if path == "-":
        return _read(stdin)
    fd = None
    try:
        fd = os.open(path, os.O_RDONLY | os.O_NONBLOCK)
        if not stat.S_ISREG(os.fstat(fd).st_mode):
            raise InvalidRequest()
        with os.fdopen(fd, "rb") as source:
            fd = None
            return _read(source)
    except OSError as error:
        raise InvalidRequest() from error
    finally:
        if fd is not None:
            os.close(fd)


def _request(value, verb):
    if (not isinstance(value, dict) or set(value) != {"v", "binding", verb}
            or type(value["v"]) is not int or value["v"] != 1):
        raise InvalidRequest()
    inner = value[verb]
    if not isinstance(inner, dict):
        raise InvalidRequest()
    if verb == "command":
        if (set(inner) != {"v", "instance_id", "operation_id", "kind", "target", "expected", "args"}
                or type(inner["v"]) is not int or inner["v"] != 1
                or any(not isinstance(inner[key], str) for key in ("instance_id", "operation_id", "kind"))
                or any(not isinstance(inner[key], dict) for key in ("target", "expected", "args"))):
            raise InvalidRequest()
    elif (set(inner) != {"name", "args"} or not isinstance(inner["name"], str)
          or not isinstance(inner["args"], dict)):
        raise InvalidRequest()
    return inner


def _attempt(code, message, retryable=False):
    return {"recorded": False, "error": {"code": code, "message": message, "retryable": retryable}}


def _exit_code(result, verb, inner):
    # A recorded refusal is a successful lookup of the original command.
    if verb == "view" and inner["name"] == "operation" and result.get("recorded") is True:
        return 0
    error = result.get("error")
    return (75 if error.get("retryable") else 2) if error else 0


def _quiesce_failed_stream(stream):
    if stream is not sys.stdout and stream is not sys.stderr:
        return
    # Shutdown retries buffered process streams. A second broken-pipe flush
    # must not replace the intended exit status with Python's exit 120.
    try:
        fd = os.open(os.devnull, os.O_WRONLY)
        try:
            os.dup2(fd, stream.fileno())
        finally:
            os.close(fd)
    except (OSError, ValueError):
        pass


def _diagnostic(stderr, message):
    try:
        stderr.write(message + "\n")
        stderr.flush()
    except (OSError, ValueError):
        _quiesce_failed_stream(stderr)


def _output(stdout, stderr, result, code):
    try:
        payload = json.dumps(result, ensure_ascii=False, allow_nan=False, separators=(",", ":")) + "\n"
        if stdout is sys.stdout:
            payload = payload.encode("utf-8")
            destination = stdout.buffer
        else:
            destination = stdout
        if destination.write(payload) != len(payload):
            raise OSError("Incomplete output")
        destination.flush()
    except (OSError, ValueError, UnicodeError):
        _diagnostic(stderr, "CLI_OUTPUT_UNCONFIRMED: reconcile the original operation before retrying.")
        _quiesce_failed_stream(stdout)
        return 1
    return code


LEGACY_VERBS = ("binding", "view", "command")
# What a held message shows in place of its words (docs/message-edit.md): its author has it open in Edit.
HELD_WORDS = "(held: its author is editing it)"
USAGE = ("usage: aim-next (--profile /absolute/profile.json | --broker /absolute/core.sock) [--json] [--outbox DIR] "
         "{binding | view FILE|- | command FILE|- | outcomes [--reached | --ended] | new-outcome --title TITLE [--kind reach|keep] [--purpose TEXT] [--team A,B] "
         "| owner OUTCOME ACTOR | coordinator OUTCOME ACTOR|--none | participant TOPIC ACTOR "
         "| seat-add OUTCOME NAME --role TEXT|- [--template ID] [--operation ID] | seat-retry OUTCOME SEAT_REQUEST [--template ID] [--operation ID] | seat-templates OUTCOME | seat-end OUTCOME SEAT_REQUEST [--operation ID] | seat-status OUTCOME [SEAT_REQUEST] "
         "| link-add OUTCOME URL [--title TITLE] | link-rename OUTCOME URL TITLE | link-remove OUTCOME URL "
         "| topics OUTCOME [--archived] | read TOPIC [--after SEQ] [--limit N] "
         "| inbox | reply MESSAGE [--asks A,B (--go-ahead|--no-go-ahead) | --tells A,B] [--part] [--ask-wait JSON] [--subject KIND:REF,...] [--blocks piece:P|release:N] [--quote TEXT | --quote-revision N --quote-start S --quote-end E | --without-quote REASON] [--operation ID] [--attach FILE]... TEXT|- "
         "| post TOPIC [--asks A,B (--go-ahead|--no-go-ahead) | --tells A,B] [--reply-to MESSAGE] [--divergence-reason TEXT] [--ask-wait JSON] [--subject KIND:REF,...] [--blocks piece:P|release:N] [--quote TEXT | --quote-revision N --quote-start S --quote-end E | --without-quote REASON] [--operation ID] [--attach FILE]... TEXT|- "
         "| thumb MESSAGE [--off] | withdraw MESSAGE [--operation ID] | mint MESSAGE [--expected N] WORDS|- | edit MESSAGE --expected N TEXT|- "
         "| cover MESSAGE [--refresh [--operation ID]] [--expected N] [--stands TEXT] [--waits TEXT --default TEXT]... [--no-waits] "
         "[--payload TEXT --from MESSAGE [--link URL] [--kind answer|decision|preview|page|release] [--done-by MESSAGE]] [--no-payload] "
         "| start OUTCOME --title TITLE [--with A,B] [--from MESSAGE [--seen T1,T2]] [--operation ID] [--attach FILE]... TEXT|- "
         "| state TOPIC active|waiting|review|done [--note TEXT] [--waiting-on A,B] | responsible TOPIC TEXT|- | rename TOPIC TITLE "
         "| archive TOPIC | unarchive TOPIC "
         "| publish OPENING [--seen T1,T2] | ack DELIVERY... | read-through TOPIC SEQ | watch [--once] | reconcile OPERATION | retry OPERATION | releases [--limit N] | health "
         "| attachment ATTACHMENT (--message MESSAGE | --page PAGE) --out FILE "
         "| notes SCOPE [--topic] | note new SCOPE [--topic] --title TITLE [--attach FILE]... FILE|- "
         "| note revise ITEM --expected N [--title TITLE] [--attach FILE]... FILE|- "
         "| note read ITEM [--revision N] | note link ITEM [--revision N] [--origin URL] "
         "| current-rule OUTCOME [--history JSON] | current-rule-update OUTCOME FILE|- --expected N --notebook-expected N [--operation ID] "
         "| work-context (--outcome OUTCOME | --piece PIECE | --topic TOPIC) "
         "| pipeline OUTCOME [--section S] | item OUTCOME N | item-edit OUTCOME N [--title T] [--size S] [--group G] [--words FILE|-] "
         "| clock PIECE | clock-record PIECE --expected N [--operation ID] FILE|- | predictions OUTCOME --pieces P,Q "
         "| clock-run PIECE --attempt ID --source MESSAGE --source-revision N --argv JSON [--phase test|command] [--timeout SECONDS] "
         "| pipeline-on OUTCOME [--title T] [--unit one,many] [--unsized] [--releases] [--off] "
         "| stages OUTCOME [--set FILE] | add OUTCOME --title T [--size S] [--section S] [--group G] [--from m-…] [--note TEXT] TEXT|- "
         "| add-source OUTCOME N (--from m-… | --page ID | --note TEXT) | move OUTCOME N (--above M | --below M | --to SECTION [--note TEXT] | --undo EVENT) "
         "| freeze PIECE --repo ABSOLUTE_REPO --base FULL_SHA --head FULL_SHA "
         "| piece OUTCOME N,M --topic TOPIC --stage S | enter-stage PIECE STAGE [--round N] [--left approved|sent-back|passed|held] "
         "| move-piece PIECE --topic TOPIC --expected N | stage-note PIECE TEXT | combine OUTCOME --release N --pieces P,Q --topic TOPIC [--ask MSG] | finish PIECE "
         "| checks OUTCOME [--readings] [--live COMMIT] | target OUTCOME [--origin NOTE] [--ask m-… | --ask-in TOPIC --ask-wait JSON] TEXT|- | target-settle OUTCOME REVISION accepted|declined "
         "| check-define OUTCOME FILE | check-report OUTCOME FILE | accept-worse OUTCOME CHECK RUN TEXT|- "
         "| problem OUTCOME --kind defect|design-miss (--from m-… | --note TEXT) TEXT|- | problem-cover OUTCOME PROBLEM [--item N] [--test T] TEXT|- "
         "| outcome-kind OUTCOME reach|keep | reached OUTCOME [--unmet] TEXT|- | outcome-end OUTCOME archived|completed|open "
         "| tools OUTCOME | tool ID [--went-back N] | tool-use ID OUTCOME [--off] | tool-link ID TOPIC [--off] | tool-record FILE}")
SAFE_NAME = re.compile(r"[A-Za-z0-9][A-Za-z0-9._@-]{0,199}")
# C0 controls other than tab, DEL and C1 controls: terminal instructions, not text.
CONTROL = re.compile("[\x00-\x08\x0a-\x1f\x7f-\x9f]")
C1 = re.compile("[\x7f-\x9f]")
# Images by their bytes, so a screenshot shows in place whatever it is called;
# Core checks each image's structure again before it is ready.
IMAGE_SIGNATURES = ((b"\x89PNG\r\n\x1a\n", "image/png"), (b"\xff\xd8\xff", "image/jpeg"),
                    (b"GIF87a", "image/gif"), (b"GIF89a", "image/gif"))
# Kinds of file agents send that the standard table (read without the system's files) lacks.
FILE_TYPES = {".md": "text/markdown", ".markdown": "text/markdown", ".log": "text/plain",
              ".diff": "text/x-diff", ".patch": "text/x-diff", ".jsonl": "application/x-ndjson"}
MEDIA_TYPE = re.compile(r"[a-z0-9!#$&^_.+-]+/[a-z0-9!#$&^_.+-]+")


def _media_type(name, data):
    """An attachment's type: an image's from its bytes, any other file's from its name.
    A name that claims an image the bytes are not is a plain file."""
    for signature, kind in IMAGE_SIGNATURES:
        if data.startswith(signature):
            return kind
    if data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return "image/webp"
    guessed = FILE_TYPES.get(os.path.splitext(name)[1].lower()) or mimetypes.MimeTypes().guess_type(name)[0] or ""
    guessed = guessed.lower()
    if not MEDIA_TYPE.fullmatch(guessed) or len(guessed) > 127 or guessed.startswith("image/"):
        return "application/octet-stream"
    return guessed


def self_quote_options(parser):
    parser.add_argument("--quote")
    parser.add_argument("--quote-revision", type=int)
    parser.add_argument("--quote-start", type=int)
    parser.add_argument("--quote-end", type=int)
    parser.add_argument("--without-quote")


def _parser():
    parser = Parser(prog="aim-next", add_help=False)
    transport = parser.add_mutually_exclusive_group(required=True)
    transport.add_argument("--profile")
    transport.add_argument("--broker")
    parser.add_argument("--json", action="store_true")
    parser.add_argument("--outbox")
    verbs = parser.add_subparsers(dest="verb", parser_class=Parser)
    verbs.required = True

    def verb(name):
        sub = verbs.add_parser(name, add_help=False)
        if name not in LEGACY_VERBS:
            # The same options are also accepted after the verb.
            sub.add_argument("--json", dest="json_after", action="store_true")
            sub.add_argument("--outbox", dest="outbox_after")
        return sub

    for name in LEGACY_VERBS:
        verb(name).add_argument("request", nargs="?")
    listing = verb("outcomes").add_mutually_exclusive_group()
    listing.add_argument("--reached", action="store_true")
    listing.add_argument("--ended", action="store_true")
    outcome = verb("new-outcome")
    outcome.add_argument("--title", required=True)
    outcome.add_argument("--kind", choices=("reach", "keep"))
    outcome.add_argument("--purpose", default="")
    outcome.add_argument("--team", default="")
    seat_add = verb("seat-add")
    seat_add.add_argument("outcome")
    seat_add.add_argument("name")
    seat_add.add_argument("--role", required=True)
    seat_add.add_argument("--template", help="template id from seat-templates")
    seat_add.add_argument("--operation")
    seat_retry = verb("seat-retry")
    seat_retry.add_argument("outcome")
    seat_retry.add_argument("seat_request")
    seat_retry.add_argument("--operation")
    seat_retry.add_argument("--template", help="named template for a refused, unplanned seat")
    seat_templates = verb("seat-templates")
    seat_templates.add_argument("outcome")
    seat_end = verb("seat-end")
    seat_end.add_argument("outcome")
    seat_end.add_argument("seat_request")
    seat_end.add_argument("--operation")
    seat_refresh = verb("seat-refresh")
    seat_refresh.add_argument("outcome")
    seat_refresh.add_argument("seats", nargs="+")
    seat_refresh.add_argument("--operation")
    seat_refresh.add_argument("--status", action="store_true")
    seat_status = verb("seat-status")
    seat_status.add_argument("outcome")
    seat_status.add_argument("seat_request", nargs="?")
    owner = verb("owner")
    owner.add_argument("outcome")
    owner.add_argument("owner")
    topics = verb("topics")
    topics.add_argument("outcome")
    topics.add_argument("--archived", action="store_true")
    read = verb("read")
    read.add_argument("topic")
    read.add_argument("--after", type=int, default=0)
    read.add_argument("--limit", type=int, default=LIMITS["page_default"])
    verb("inbox")
    for name in ("post", "reply"):
        post = verb(name)
        if name == "reply":
            post.add_argument("message")
            post.set_defaults(topic=None, reply_to=None)
        else:
            post.add_argument("topic")
            post.add_argument("--reply-to")
        # A message to someone asks or tells them; --to, which said neither, is refused by name.
        self_quote_options(post)
        post.add_argument("--divergence-reason")
        post.add_argument("--asks")
        post.add_argument("--ask-wait", help="literal ask_wait JSON; omitted agent asks use the last question line, or first line, with no choices/default")
        post.add_argument("--tells")
        post.add_argument("--to")
        post.add_argument("--part", action="store_true")
        # An Ask that offers its people ✅ (go ahead) and 🚫 (don't) (docs/thumbs.md).
        decision = post.add_mutually_exclusive_group()
        decision.add_argument("--go-ahead", dest="go_ahead", action="store_const", const=True, default=None)
        decision.add_argument("--no-go-ahead", dest="go_ahead", action="store_const", const=False)
        # --blocks piece:p-… | release:N: the one piece or release an ask holds until it is answered (item 259).
        post.add_argument("--blocks")
        # --operation ID: a retry sends the same saved request, not another message.
        post.add_argument("--operation")
        post.add_argument("--attach", action="append", default=[])
        post.add_argument("--subject")
        post.add_argument("text")
    withdraw = verb("withdraw")
    withdraw.add_argument("message")
    withdraw.add_argument("--operation")
    thumb = verb("thumb")
    thumb.add_argument("message")
    thumb.add_argument("--off", action="store_true")
    # mint MESSAGE [--expected N] WORDS: the name of the dossier MESSAGE is in, from the agent that names it (item 479).
    mint = verb("mint")
    mint.add_argument("message")
    mint.add_argument("--expected", type=int)
    mint.add_argument("text")
    # edit MESSAGE --expected N TEXT: new words for a message the actor wrote, fenced on the revision it read (item 614).
    edit = verb("edit")
    edit.add_argument("message")
    edit.add_argument("--expected", type=int, required=True)
    edit.add_argument("text")
    whisper = verb("whisper")
    whisper.add_argument("topic")
    whisper.add_argument("--to", required=True)
    whisper.add_argument("--reply-to")
    self_quote_options(whisper)
    whisper.add_argument("text")
    start = verb("start")
    start.add_argument("outcome")
    start.add_argument("--title", required=True)
    start.add_argument("--with", dest="participants", default="")
    # The message the topic answers, and the topics already started from it that the caller has seen.
    start.add_argument("--from", dest="source")
    start.add_argument("--seen")
    start.add_argument("--part", action="store_true")
    # --operation ID: the start's operation id; the opening, its topic and both writes are named from it, so starting
    # again with the same words returns the same topic.
    start.add_argument("--operation")
    start.add_argument("--attach", action="append", default=[])
    start.add_argument("text")
    coordinator = verb("coordinator")
    coordinator.add_argument("outcome")
    coordinator.add_argument("name", nargs="?")
    coordinator.add_argument("--none", action="store_true")
    participant = verb("participant")
    participant.add_argument("topic")
    participant.add_argument("name")
    conversation = verb("conversation")
    conversation.add_argument("outcome")
    conversation.add_argument("--new", action="store_true")
    conversation.add_argument("--limit", type=int, default=LIMITS["page_default"])
    state = verb("state")
    state.add_argument("topic")
    state.add_argument("state", choices=STATES)
    state.add_argument("--note")
    state.add_argument("--waiting-on")
    responsible = verb("responsible")
    responsible.add_argument("topic")
    responsible.add_argument("text")
    rename = verb("rename")
    rename.add_argument("topic")
    rename.add_argument("title")
    verb("archive").add_argument("topic")
    verb("unarchive").add_argument("topic")
    publish = verb("publish")
    publish.add_argument("opening")
    publish.add_argument("--seen")
    verb("ack").add_argument("deliveries", nargs="+")
    through = verb("read-through")
    through.add_argument("topic")
    through.add_argument("seq", type=int)
    verb("watch").add_argument("--once", action="store_true")
    verb("retry").add_argument("operation")
    verb("reconcile").add_argument("operation")
    verb("releases").add_argument("--limit", type=int)
    verb("health")
    attachment = verb("attachment")
    attachment.add_argument("attachment")
    attachment_source = attachment.add_mutually_exclusive_group(required=True)
    attachment_source.add_argument("--message")
    attachment_source.add_argument("--page")
    attachment.add_argument("--out", required=True)
    # Notebook pages (docs/agent-cli.md, "Notebook pages"). SCOPE is an outcome,
    # or with --topic a topic, whose Notebook holds the pages.
    notes = verb("notes")
    notes.add_argument("scope")
    notes.add_argument("--topic", action="store_true")
    note = verbs.add_parser("note", add_help=False)
    pages = note.add_subparsers(dest="note_verb", parser_class=Parser)
    pages.required = True

    def page_verb(name):
        sub = pages.add_parser(name, add_help=False)
        sub.add_argument("--json", dest="json_after", action="store_true")
        sub.add_argument("--outbox", dest="outbox_after")
        return sub
    new = page_verb("new")
    new.add_argument("scope")
    new.add_argument("--topic", action="store_true")
    new.add_argument("--title", required=True)
    new.add_argument("--attach", action="append", default=[])
    new.add_argument("file")
    revise = page_verb("revise")
    revise.add_argument("item")
    revise.add_argument("--expected", type=int, required=True)
    revise.add_argument("--title")
    revise.add_argument("--attach", action="append", default=[])
    revise.add_argument("file")
    page_read = page_verb("read")
    page_read.add_argument("item")
    page_read.add_argument("--revision", type=int)
    link = page_verb("link")
    link.add_argument("item")
    link.add_argument("--revision", type=int)
    link.add_argument("--origin")
    register_current_rule(verb)
    register_pipeline(verb)
    register_clock(verb)
    register_targets(verb)
    register_tools(verb)
    register_covers(verb)
    register_links(verb)
    return parser


def _names(value):
    return [name.strip() for name in value.split(",") if name.strip()]


def _since(ms):
    """When something began, in local time: "since 2026-11-05 22:10"."""
    return "since " + time.strftime("%Y-%m-%d %H:%M", time.localtime(ms / 1000.0)) if isinstance(ms, int) else "(time unknown)"


def _light_words(light):
    """Where an outcome stands, in the outcome light's words with absolute times (item 86)."""
    if not isinstance(light, dict):
        return ""
    if light.get("light") is None:
        return "couldn't check where it stands"
    short = light.get("short") or {}
    at = lambda ms: time.strftime("%Y-%m-%d %H:%M", time.localtime(ms / 1000.0)) if isinstance(ms, int) else None
    kind = short.get("kind")
    if kind == "asks":
        count = short.get("count", 0)
        if short.get("blocking") in ("release", "piece"):
            return "blocking a %s: waiting on you · %d question%s" % (short["blocking"], count, "" if count == 1 else "s")
        return "waiting on you · %d question%s" % (count, "" if count == 1 else "s")
    if kind == "seen":
        return "worked on at " + at(short.get("ms")) if at(short.get("ms")) else "being worked on"
    if kind == "checks_pass":
        return "done · all checks pass"
    if kind == "reached":
        return "done · reached " + (at(short.get("ms")) or "")
    if kind == "no_topics":
        return "no topics yet"
    if kind == "talk":
        since = at(short.get("since_ms"))
        return ("quiet since %s" % since if since else "quiet") + " · %s at %s" % (
            "work" if short.get("how") == "turn" else "a post", at(short.get("ms")))
    return "quiet since " + at(short.get("ms")) if at(short.get("ms")) else "quiet"


def _size(size_bytes):
    """A size as a person says it: "622 bytes", "137 KB", "1.5 MB"."""
    if size_bytes < 1024:
        return "%d bytes" % size_bytes
    if round(size_bytes / 1024.0) < 1024:
        return "%d KB" % round(size_bytes / 1024.0)
    return "%.1f MB" % (size_bytes / (1024.0 * 1024.0))


def _attachment_line(attachment):
    """One line per attachment under a message, with the whole id to save it by."""
    kind = "image" if attachment["content_type"].startswith("image/") else "file"
    return "  [%s: %s, %s, %s, id %s]" % (kind, attachment["name"], attachment["content_type"],
                                         _size(attachment["size_bytes"]), attachment["id"])


def _remove_partial(path, created):
    """Removes the partial file this command created at path, while path still names that file
    (created is its stat), and says what is left there."""
    try:
        if not os.path.samestat(os.stat(path, follow_symlinks=False), created):
            return "the file now at %s is not the one this wrote, so it was left alone" % path
        os.unlink(path)
    except FileNotFoundError:
        pass
    except OSError as error:
        return "a partial file may remain at %s (%s)" % (path, error.strerror)
    return "nothing was kept"


def _one_line(text, size=120):
    line = " ".join(text.split())
    return line if len(line) <= size else line[:size - 1] + "…"


def _shown(text):
    # Plain lines carry other actors' words to a terminal. Their control
    # characters are shown as escapes, so they cannot move the cursor,
    # retitle the window, write the clipboard or forge another line.
    return CONTROL.sub(lambda match: "\\x%02x" % ord(match.group()), text)


class OutputFailed(Exception):
    pass


class Lines:
    """Plain lines or one JSON document per line, each flushed as it is written."""

    def __init__(self, stdout, stderr, as_json):
        self.stdout, self.stderr, self.as_json = stdout, stderr, as_json

    def write(self, text):
        try:
            payload = text + "\n"
            destination = self.stdout
            if self.stdout is sys.stdout:
                payload, destination = payload.encode("utf-8"), self.stdout.buffer
            if destination.write(payload) != len(payload):
                raise OSError("Incomplete output")
            destination.flush()
        except (OSError, ValueError, UnicodeError) as error:
            raise OutputFailed() from error

    def problem(self, text):
        # Plain refusals go to stderr; --json already carried the raw result.
        if not self.as_json:
            _diagnostic(self.stderr, _shown(text))

    def raw(self, value):
        if self.as_json:
            # JSON escapes C0 controls itself; C1 controls are escaped too.
            self.write(C1.sub(lambda match: "\\u%04x" % ord(match.group()),
                              json.dumps(value, ensure_ascii=False, allow_nan=False, separators=(",", ":"))))

    def plain(self, text):
        if not self.as_json:
            self.write(_shown(text))


class Failed(Exception):
    """A result that ends this verb; it was already reported."""

    def __init__(self, code, recorded=False):
        self.code, self.recorded = code, recorded


class Agent(CurrentRuleVerbs, ClockVerbs, PipelineVerbs, TargetVerbs, ToolVerbs, CoverVerbs, LinkVerbs):
    """The everyday verbs: each builds its envelopes, saves each request before dispatch."""

    def __init__(self, profile, options, stdin, lines):
        self.profile, self.options, self.stdin, self.out = profile, options, stdin, lines
        self.actor = profile.actor_id
        self.binding = _binding(profile)
        self.store = profile.store()
        self.exit = 0
        # The saved request being sent, named by every unconfirmed outcome.
        self.operation = None
        # Deliveries a watch reported as already pending, so their creation is not reported again.
        self.shown = set()

    # Reads -----------------------------------------------------------------

    def view(self, name, args):
        result = self.store.view(self.actor, name, args)
        self.out.raw(result)
        if result.get("error"):
            self.fail(result["error"])
        return result

    def read_back(self, name, args, recorded, check):
        """A read that follows a write this verb has recorded. Its failure is not
        the write's: an error answer (busy, refused) or a store that does not
        answer ends the verb as READ_BACK_UNCONFIRMED, exit 1, naming what was
        recorded, its operation and how to read it, so an agent following the
        exit codes never sends the write again as a new command."""
        try:
            result = self.store.view(self.actor, name, args)
        except (StoreError, OSError):
            reason = "the store did not answer"
        else:
            error = result.get("error")
            if not error:
                self.out.raw(result)
                return result
            reason = "%s: %s" % (error.get("code"), error.get("message"))
        _diagnostic(self.out.stderr, "READ_BACK_UNCONFIRMED: %s (%s, operation %s), but reading %s back failed (%s); do not send %s again: %s." % (
            recorded["what"], recorded["kind"], self.operation, recorded["it"], _shown(reason), recorded["it"], check))
        raise Failed(1, recorded=True)

    def pages(self, name, args):
        cursor, items = None, []
        while True:
            page = self.view(name, dict(args, **({} if cursor is None else {"cursor": cursor})))
            self.last_page = page
            items.extend(page["items"])
            cursor = page.get("next_cursor")
            if cursor is None:
                return items

    def fail(self, error, code=None):
        self.out.problem("%s: %s" % (error.get("code"), error.get("message")))
        raise Failed(code or (75 if error.get("retryable") else 2))

    def refuse(self, code, message, retryable=False):
        """A refusal the CLI decides itself; --json gets it as one result line."""
        result = _attempt(code, message, retryable)
        self.out.raw(result)
        self.fail(result["error"])

    # Commands ----------------------------------------------------------------

    def outbox(self):
        chosen = self.options.outbox_after or self.options.outbox
        if chosen is None:
            if not SAFE_NAME.fullmatch(self.actor):
                raise UsageError()
            directory = (self.profile.outbox_path if self.options.broker else
                         Path(self.options.profile).parent / (self.actor + ".outbox"))
        elif not Path(chosen).is_absolute():
            raise UsageError()
        else:
            directory = Path(chosen)
        try:
            directory.mkdir(mode=0o700, exist_ok=True)
            if not stat.S_ISDIR(directory.lstat().st_mode):
                raise NotADirectoryError(str(directory))
        except OSError:
            self.unsent("the outbox directory is unavailable")
        return directory

    def unsent(self, why):
        # Nothing was sent unless this verb already sent an earlier request.
        _diagnostic(self.out.stderr, "CLI_OUTBOX_UNAVAILABLE: %s, so %s was sent." % (why, "nothing" if self.operation is None else "nothing more"))
        raise Failed(1)

    @staticmethod
    def _sync_directory(directory):
        fd = os.open(str(directory), os.O_RDONLY)
        try:
            os.fsync(fd)
        finally:
            os.close(fd)

    def _save_request(self, directory, operation_id, request):
        payload = (json.dumps(request, ensure_ascii=False, allow_nan=False, separators=(",", ":")) + "\n").encode("utf-8")
        fd = os.open(str(directory / (operation_id + ".request.json")), os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
        with os.fdopen(fd, "wb") as target:
            target.write(payload)
            target.flush()
            os.fsync(target.fileno())
        self._sync_directory(directory)

    def _save_receipt(self, directory, operation_id, receipt):
        payload = (json.dumps(receipt, ensure_ascii=False, allow_nan=False, separators=(",", ":")) + "\n").encode("utf-8")
        final = directory / (operation_id + ".receipt.json")
        partial = directory / (operation_id + ".receipt.partial")
        fd = os.open(str(partial), os.O_WRONLY | os.O_CREAT | os.O_TRUNC | os.O_NOFOLLOW, 0o600)
        with os.fdopen(fd, "wb") as target:
            target.write(payload)
            target.flush()
            os.fsync(target.fileno())
        os.replace(str(partial), str(final))
        self._sync_directory(directory)

    def dispatch(self, directory, request, send=None):
        envelope = request["command"]
        self.operation = envelope["operation_id"]
        receipt = (send or self.store.command)(self.actor, envelope)
        if receipt.get("recorded") is True:
            try:
                self._save_receipt(directory, envelope["operation_id"], receipt)
            except OSError:
                self.out.raw(receipt)
                _diagnostic(self.out.stderr, "CLI_RECEIPT_UNSAVED: operation %s was recorded; look it up with the operation view." % envelope["operation_id"])
                raise Failed(1, recorded=True)
        self.out.raw(receipt)
        error = receipt.get("error")
        if error:
            code = 75 if error.get("retryable") else 2
            if receipt.get("recorded") is True:
                self.out.problem("rejected %s: %s (operation %s)" % (error.get("code"), error.get("message"), envelope["operation_id"]))
            elif error.get("retryable"):
                self.out.problem("not recorded %s: %s; the request is saved, so `retry %s` sends it unchanged" % (
                    error.get("code"), error.get("message"), envelope["operation_id"]))
            else:
                # Sending the same request again would be refused again.
                self.out.problem("not recorded %s: %s (operation %s)" % (error.get("code"), error.get("message"), envelope["operation_id"]))
            raise Failed(code, recorded=receipt.get("recorded") is True)
        return receipt["result"]

    def envelope(self, kind, target, args, expected=None, operation=None):
        return {"v": 1, "instance_id": self.profile.instance_id, "operation_id": operation or "cli-" + uuid.uuid4().hex,
                "kind": kind, "target": target, "args": args,
                "expected": dict(expected or {}, authority={key: self.binding[key] for key in ("authority_id", "authority_epoch")})}

    def command(self, kind, target, args, expected=None, operation=None, send=None):
        """The verb's act: saved in the outbox, then sent. Every way it can end
        unrecorded names its operation, since `retry` of it finishes the verb. A
        caller's own operation id that is already saved is sent again when the
        request is the same (Core then answers with what it recorded), and
        refused when it is not."""
        directory = self.outbox()
        envelope = self.envelope(kind, target, args, expected, operation)
        request = {"v": 1, "binding": self.binding, "command": envelope}
        try:
            self._save_request(directory, envelope["operation_id"], request)
        except FileExistsError:
            try:
                saved = json.loads((directory / (envelope["operation_id"] + ".request.json")).read_text(encoding="utf-8"))
            except (OSError, ValueError):
                self.unsent("operation %s is saved, and its request could not be read" % envelope["operation_id"])
            if operation is None or saved != request:
                self.refuse("OPERATION_PAYLOAD_MISMATCH", "Operation %s already names a different request; nothing was sent" % envelope["operation_id"])
        except OSError:
            self.unsent("the request could not be saved")
        self.operation = envelope["operation_id"]
        return self.dispatch(directory, request, send)

    def operation_of(self, suffix=""):
        """The caller's --operation id with suffix, checked as a name; None when it gave none."""
        operation = getattr(self.options, "operation", None)
        if operation is None:
            return None
        if not SAFE_NAME.fullmatch(operation + suffix):
            self.refuse("INVALID_ARGUMENT", "--operation is a name of letters, digits, '.', '_', '@' and '-'; nothing was sent")
        if getattr(self.options, "attach", None):
            # A repeat answers with what the first run recorded only when it is the same request,
            # and --attach uploads its files afresh each run, so it never would be.
            self.refuse("INVALID_ARGUMENT", "--operation sends the same words again as the same write, and --attach uploads its files "
                        "afresh each time, so they do not go together; nothing was sent")
        return operation + suffix

    def text(self):
        if self.options.text != "-":
            return self.options.text
        return self.bounded_text(self.stdin)

    @staticmethod
    def bounded_text(source):
        """UTF-8 words read from a byte stream, at most the body limit."""
        cap = LIMITS["body_utf8_bytes"]
        raw = bytearray()
        while len(raw) <= cap:
            chunk = source.read(min(65536, cap + 1 - len(raw)))
            if not isinstance(chunk, bytes):
                raise InvalidRequest()
            if not chunk:
                break
            raw.extend(chunk)
        if len(raw) > cap:
            raise InvalidRequest()
        try:
            return raw.decode("utf-8")
        except UnicodeError as error:
            raise InvalidRequest() from error

    # Verbs -----------------------------------------------------------------

    def do_outcomes(self):
        reached = bool(getattr(self.options, "reached", False))
        ended = bool(getattr(self.options, "ended", False))
        items = self.pages("workspaces", {"reached": True} if reached else {"ended": True} if ended else {})
        for item in items:
            # An archived or completed outcome says when and by whom (item 404); any other, where it stands.
            end = item.get("end")
            words = ("%s %s by %s" % (end["state"], time.strftime("%b %-d", time.localtime(end["ms"] / 1000.0)), end["by"]) if end
                     else _light_words(item.get("light")))
            self.out.plain("%s  %s  (owner %s, to %s)%s" % (item["id"], _one_line(item["title"]), item["owner_id"], item.get("kind", "keep"),
                                                            "  " + words if words else ""))
        if not items:
            self.out.plain("no reached outcomes" if reached else "no archived or completed outcomes" if ended else "no outcomes")
        if not reached and not ended:
            count = (self.last_page or {}).get("reached_count") or 0
            if count:
                self.out.plain("reached (%d): outcomes --reached" % count)
            count = (self.last_page or {}).get("ended_count") or 0
            if count:
                self.out.plain("archived or completed (%d): outcomes --ended" % count)

    def do_new_outcome(self):
        options = self.options
        outcome = "w-" + uuid.uuid4().hex
        self.command("workspace.create", {}, {"id": outcome, "title": options.title, "purpose": options.purpose,
                                              "team": _names(options.team), **({"kind": options.kind} if options.kind else {})},
                     {"workspace_revision": 0})
        self.out.plain('created outcome %s "%s"' % (outcome, _one_line(options.title, 60)))

    def do_owner(self):
        """Hands the outcome to another member of its team; only its owner can."""
        workspace = self.view("workspace", {"workspace_id": self.options.outcome})["workspace"]
        result = self.command("workspace.owner_set", {"workspace_id": workspace["id"]}, {"owner_id": self.options.owner},
                              {"workspace_revision": workspace["version"]})
        if result["owner_id"] == result["previous_owner_id"]:
            self.out.plain("%s is already owned by %s" % (result["workspace_id"], result["owner_id"]))
        else:
            self.out.plain("%s is now owned by %s (was %s)" % (result["workspace_id"], result["owner_id"], result["previous_owner_id"]))

    def do_topics(self):
        # The server lists them latest activity first; done topics follow the rest, and
        # archived ones are listed only when asked for (docs/topic-list.md).
        args = {"workspace_id": self.options.outcome}
        if self.options.archived:
            items = self.pages("workspace_topics", dict(args, archived=True))
            self.topic_lines(items)
            if not items:
                self.out.plain("no archived topics")
            return
        found, summary = self.conversation_line(self.options.outcome)
        if found is not None:
            self.out.plain("conversation %s (%s)" % (found["topic_id"], summary))
        items = self.pages("workspace_topics", args)
        done = self.pages("workspace_topics", dict(args, done=True))
        self.topic_lines(items)
        if done:
            self.out.plain("done (%d):" % len(done))
            self.topic_lines(done)
        if not items and not done:
            self.out.plain("no topics")
        archived = self.last_page["groups"]["archived"]
        if archived:
            self.out.plain("archived (%d): topics %s --archived" % (archived, self.options.outcome))

    def do_seat_add(self):
        from .hosted_seats import KIND
        options = self.options
        role = self.bounded_text(self.stdin) if options.role == '-' else options.role
        args = {'name': options.name, 'role': role}
        if options.template is not None:
            args['template_id'] = options.template
        return self._seat_command(KIND, {'workspace_id': options.outcome}, args)

    def do_seat_retry(self):
        from .hosted_seats import RETRY_KIND
        args = {'template_id': self.options.template} if self.options.template is not None else {}
        return self._seat_command(RETRY_KIND, {'workspace_id': self.options.outcome,
                                  'seat_request_id': self.options.seat_request}, args)

    def do_seat_templates(self):
        answer = self.view('hosted_seat_templates', {'workspace_id': self.options.outcome})
        if not answer['available']:
            self.out.plain('host templates unavailable')
        for item in answer['items']:
            self.out.plain('%s  %s · %s · %s' % (item['id'], item['name'], item['model'], item['reasoning_effort']))

    def do_seat_end(self):
        from .hosted_seats import END_KIND
        return self._seat_command(END_KIND, {"workspace_id": self.options.outcome,
                                  "seat_request_id": self.options.seat_request}, {})

    def do_seat_refresh(self):
        options = self.options
        kind, target = 'workspace.hosted_seat_refresh', {'workspace_id': options.outcome}
        actors = list(options.seats)
        if options.status:
            if options.operation is not None:
                self.refuse('INVALID_ARGUMENT', 'Status is a read; omit --operation')
            state = self.view('hosted_seat_refresh', dict(target, actor_ids=actors))
            for seat in state['seats']:
                intent = seat.get('intent')
                if intent:
                    self._refresh_line(dict(intent, actor_id=seat['actor_id']))
                else:
                    self.out.plain('%s: no refresh recorded' % seat['actor_id'])
                if seat.get('error'):
                    self.out.plain('%s: %s' % (seat['actor_id'], seat['error']['message']))
            return
        operation, saved = self.operation_of(), None
        if operation is not None:
            directory = self.outbox()
            path = directory / (operation + '.request.json')
            if os.path.lexists(path):
                saved = _input(str(path), None)
                envelope = _request(saved, 'command')
                if saved['binding'] != self.binding:
                    self.refuse('BINDING_MISMATCH', 'This saved refresh belongs to another binding; nothing was sent')
                if (envelope['operation_id'] != operation or envelope['kind'] != kind
                        or envelope['target'] != target
                        or [s.get('actor_id') for s in envelope['args'].get('seats', [])] != actors):
                    self.refuse('OPERATION_PAYLOAD_MISMATCH', 'This operation already names another refresh; nothing was sent')
        if saved is not None:
            result = self.dispatch(directory, saved)
        else:
            state = self.view('hosted_seat_refresh', dict(target, actor_ids=actors))
            for seat in state['seats']:
                if seat.get('error'):
                    self.refuse(seat['error']['code'], seat['error']['message'])
            seats = [{k: seat[k] for k in ('actor_id', 'execution_revision', 'thread_id')}
                     for seat in state['seats']]
            result = self.command(kind, target, {'seats': seats},
                                  {'workspace_revision': state['workspace_revision']}, operation=operation)
        # The immutable receipt is the request's result even if activation or a
        # later distinct refresh wins before this status read.
        for intent in result['intents']:
            self._refresh_line(intent)

    def _refresh_line(self, intent):
        self.out.plain('%s: refresh %s · %s · old %s · new %s · requested %s · activated %s' % (
            intent['actor_id'], intent['id'], intent['phase'], intent['old']['thread_id'],
            intent['new']['thread_id'] if intent.get('new') else 'pending',
            intent.get('trigger', {}).get('requested_ms', intent['created_ms']),
            intent.get('committed_ms', 'pending')))

    def _seat_command(self, kind, target, args):
        options = self.options
        operation = self.operation_of()
        saved = None
        if operation is not None:
            directory = self.outbox()
            path = directory / (operation + '.request.json')
            if os.path.lexists(path):
                saved = _input(str(path), None)
                envelope = _request(saved, 'command')
                if saved['binding'] != self.binding:
                    self.refuse('BINDING_MISMATCH', 'This saved Add belongs to another binding; nothing was sent')
                if (envelope['operation_id'] != operation or envelope['kind'] != kind
                        or envelope['target'] != target or envelope['args'] != args):
                    self.refuse('OPERATION_PAYLOAD_MISMATCH', 'This operation already names different Add words or a different outcome; nothing was sent')
        if saved is not None:
            result = self.dispatch(directory, saved)
        else:
            if kind in ('workspace.hosted_seat_retry', 'workspace.hosted_seat_end'):
                seat = self.view('hosted_seat', target)['seat']
                expected = {'seat_revision': seat['version']}
            else:
                workspace = self.view('workspace', {'workspace_id': options.outcome})['workspace']
                expected = {'workspace_revision': workspace['version']}
            result = self.command(kind, target, args, expected, operation=operation)
        identity = result['seat_request_id']
        answer = self.read_back('hosted_seat', {'workspace_id': options.outcome, 'seat_request_id': identity},
            {'what': 'The seat request was recorded', 'kind': kind, 'it': identity},
            'seat-status %s %s' % (options.outcome, identity))
        seat = answer.get('seat') or {}
        if seat.get('id') != identity or seat.get('workspace_id') != options.outcome or seat.get('agent_id') != result['agent']['id']:
            _diagnostic(self.out.stderr, 'READ_BACK_UNCONFIRMED: invitation %s was recorded (operation %s); its returned seat identity did not match. Keep the original request.' % (identity, self.operation))
            raise Failed(1, recorded=True)
        self._seat_line(seat)

    def _seat_line(self, seat):
        reason = ' (%s)' % seat['reason'] if seat['reason'] else ''
        self.out.plain('%s: %s at %s%s [%s]' % (seat['agent_id'], seat['state'], seat['stage'], reason, seat['id']))
        if seat['first_message_id']:
            self.out.plain('first task in Conversation: %s' % seat['first_message_id'])

    def do_seat_status(self):
        options = self.options
        if options.seat_request:
            self._seat_line(self.view('hosted_seat', {'workspace_id': options.outcome, 'seat_request_id': options.seat_request})['seat'])
            return
        items = self.pages('hosted_seats', {'workspace_id': options.outcome})
        for seat in items:
            self._seat_line(seat)
        if not items:
            self.out.plain('no headless seats on this team')

    def conversation_line(self, outcome):
        """`conversation t-… in "TITLE": fable answers; 1 new`, or None when the outcome has none yet."""
        found = self.view("conversation", {"workspace_id": outcome})["conversation"]
        if found is None:
            return None, None
        coordinator = found["coordinator"]
        answers = "%s answers" % coordinator["actor_id"] if coordinator else "nobody answers yet"
        return found, "%s; %d new" % (answers, found["new_items"])

    def do_coordinator(self):
        options = self.options
        if options.none == (options.name is not None):
            self.refuse("INVALID_ARGUMENT", "Name the coordinator, or --none for nobody; nothing was changed")
        workspace = self.view("workspace", {"workspace_id": options.outcome})["workspace"]
        result = self.command("workspace.coordinator_set", {"workspace_id": workspace["id"]}, {"actor_id": options.name},
                              {"workspace_revision": workspace["version"]})
        self.out.plain("%s answers in the conversation of %s" % (result["coordinator_id"], result["workspace_id"])
                       if result["coordinator_id"] else "nobody answers in the conversation of %s yet" % result["workspace_id"])

    def do_participant(self):
        topic = self.view("topic", {"topic_id": self.options.topic})["topic"]
        result = self.command("participation.set", {"topic_id": topic["id"]},
                              {"actor_id": self.options.name, "present": True}, {"topic_revision": topic["version"]})
        self.out.plain("%s takes part in %s" % (result["actor_id"], result["topic_id"]))

    def do_conversation(self):
        options = self.options
        workspace = self.view("workspace", {"workspace_id": options.outcome})["workspace"]
        found, summary = self.conversation_line(workspace["id"])
        if found is None:
            self.out.plain('"%s" has no conversation yet' % _one_line(workspace["title"], 60))
            return
        self.out.plain('conversation %s in "%s": %s' % (found["topic_id"], _one_line(workspace["title"], 60), summary))
        args = {"topic_id": found["topic_id"], "direction": "before", "limit": options.limit}
        if options.new:
            args["items"] = "open"
        page = self.view("topic_messages", args)
        waits = found["waits"]
        for item in page["items"]:
            self.message_lines(found["topic_id"], item, waits)
        if not page["items"]:
            self.out.plain("no open items" if options.new else "no messages yet")

    def item_lines(self, item, waits):
        """The lines under a conversation message: what became of it, and who it waits on."""
        state = item.get("item")
        if state is not None:
            if state["state"] == "new" and not state["takes"]:
                self.out.plain("  [new] nothing taken yet")
            for take in state["takes"]:
                when = "%s, %s" % (take["actor_id"], _since(take["at_ms"])[len("since "):])
                part = " (part)" if take["part"] else ""
                if take["kind"] == "answer":
                    self.out.plain("  [answered] by %s (%s)%s" % (take["ref"] or "a message you can't open", when, part))
                elif take["kind"] == "topic":
                    self.out.plain('  [topic] %s "%s" (%s)%s' % (take["ref"], _one_line(take["title"] or "a topic you cannot open", 60), when, part))
                else:
                    self.out.plain("  [pipeline] %s %s (%s)%s" % ("added to" if take["added"] else "as",
                                                                 ", ".join(str(n) for n in take["numbers"]), when, part))
        for wait in waits:
            if wait["item_id"] == item["id"] or wait["ask_message_id"] == item["id"]:
                self.out.plain("  [waiting] on %s %s (ask %s): %s" % (wait["on"], _since(wait["since_ms"]), wait["ask_message_id"],
                                                                     held_words(wait, "excerpt")))

    def topic_lines(self, items):
        for item in items:
            stands = item.get("state", "active")
            if item.get("waiting_on"):
                stands += " on " + ", ".join(item["waiting_on"])
            for ask in item.get("asks") or ():
                stands += ", asked %s %s" % (ask["actor_id"], _since(ask["since_ms"]))
            if item.get("state_note"):
                stands += ": " + _one_line(item["state_note"], 80)
            self.out.plain("%s  %s  [%s]  (%s messages, latest #%s)" % (
                item["id"], _one_line(item["title"]), stands, item.get("message_count") or 0, item.get("latest_seq") or "-"))

    def do_releases(self):
        """Every release record, newest first, or only the newest --limit of them."""
        limit = self.options.limit
        items = self.view("releases", {"limit": limit})["items"] if limit is not None else self.pages("releases", {})
        for item in items:
            measured = item.get("measurements") or {}
            counts = [("python", (measured.get("python_units") or {}).get("tests")),
                      ("node", (measured.get("node_units") or {}).get("tests"))]
            native = measured.get("native") or {}
            shown = ["%s %s" % pair for pair in counts if isinstance(pair[1], int)]
            if isinstance(native.get("pass"), int) and isinstance(native.get("total"), int):
                shown.append("native %d/%d" % (native["pass"], native["total"]))
            self.out.plain("release %d  %s  %s  shipped %s%s%s" % (
                item["release"], item["commit"][:7], item["deployed_at"],
                ", ".join(str(n) for n in item["items"]) or "no pipeline item",
                "  (%s)" % ", ".join(shown) if shown else "", "  [recorded retroactively]" if item["source"] == "backfill" else ""))
        if not items:
            self.out.plain("no releases recorded")

    def do_health(self):
        """What is healthy and what is not, from Core's facts, in the Health page's words (docs/health.md)."""
        answer = self.view("health", {})
        for line in report_lines(answer, lambda ms: time.strftime("%Y-%m-%d %H:%M", time.localtime(ms / 1000.0))):
            self.out.plain(line)

    def update_topic(self, args):
        topic = self.view("topic", {"topic_id": self.options.topic})["topic"]
        return self.command("topic.update", {"topic_id": topic["id"]}, args, {"topic_revision": topic["version"]})

    def do_state(self):
        options = self.options
        args = {"state": options.state}
        if options.note is not None:
            args["note"] = options.note
        if options.waiting_on is not None:
            args["waiting_on"] = _names(options.waiting_on)
        result = self.update_topic(args)
        line = "%s is %s" % (result["topic_id"], result["state"])
        if result["waiting_on"]:
            line += " on " + ", ".join(result["waiting_on"])
        if result["note"]:
            line += ": " + _one_line(result["note"], 80)
        self.out.plain(line)

    def do_responsible(self):
        """Says what the actor is responsible for in a topic; empty text clears it."""
        note = self.text()
        # Fenced on the note as read; Core refuses someone not taking part.
        mine = [item["responsibility_revision"] for item in self.view("topic", {"topic_id": self.options.topic})["participants"]
                if item["actor_id"] == self.actor]
        result = self.command("responsibility.set", {"topic_id": self.options.topic}, {"note": note},
                              {"responsibility_revision": mine[0] if mine else 0})
        self.out.plain("%s in %s: %s" % (self.actor, result["topic_id"], _one_line(result["note"], 200)) if result["note"]
                       else "%s in %s: no note" % (self.actor, result["topic_id"]))

    def do_rename(self):
        result = self.update_topic({"title": self.options.title})
        self.out.plain('renamed %s "%s"' % (result["topic_id"], _one_line(result["title"], 60)))

    def do_archive(self):
        self.out.plain("archived %s" % self.update_topic({"archived": True})["topic_id"])

    def do_unarchive(self):
        self.out.plain("unarchived %s" % self.update_topic({"archived": False})["topic_id"])

    def do_read(self):
        options = self.options
        answer = self.view("topic", {"topic_id": options.topic})
        topic = answer["topic"]
        page = self.view("topic_messages", {"topic_id": options.topic, "cursor": options.after, "limit": options.limit})
        self.out.plain("%s  %s" % (topic["id"], _one_line(topic["title"])))
        # The outcome's target, closed, so an agent reads what done looks like with the conversation (D10).
        target = answer.get("outcome_target")
        if target:
            self.out.plain("  target (%s, %s): %s" % (TARGET_WORDS.get(target["word"], target["word"]), "to " + target["kind"],
                                                       _one_line(target["text"] or "no target written yet", 400)))
        # What each participant said they are responsible for, under the title.
        for item in answer["participants"]:
            if item.get("responsibility"):
                self.out.plain("  %s: %s" % (item["actor_id"], _one_line(item["responsibility"], 200)))
        waits = self.view("conversation", {"workspace_id": topic["workspace_id"]})["conversation"]["waits"] if topic.get("kind") == "conversation" else []
        for item in page["items"]:
            self.message_lines(options.topic, item, waits)
        if page["next_cursor"] is not None:
            self.out.plain("")
            self.out.plain("more after #%s: read %s --after %s" % (page["next_cursor"], options.topic, page["next_cursor"]))
        elif not page["items"]:
            self.out.plain("no messages after #%s" % options.after)

    def message_lines(self, topic_id, item, waits=()):
        """One message as `read` prints it, with a conversation item's lines under it."""
        body = item["body"]
        if item["preview"]:
            body = self.view("source", {"source_ref": {"kind": "message", "id": item["id"]}})["body"]
        heading = "#%s %s %s" % (item["seq"], item["id"], item["author_id"])
        if item.get("whisper"):
            heading += " whispers to " + item["private_to"]
        elif item["addressees"]:
            heading += {"ask": " asks ", "tell": " tells "}.get(item.get("intent"), " to ") + ", ".join(item["addressees"])
        if item["reply_to"]:
            heading += " replying to " + item["reply_to"]
        if item.get("revision", 1) > 1:
            heading += " (edited, revision %d)" % item["revision"]
        self.out.plain("")
        self.out.plain(heading)
        if item.get('removal'):
            self.out.plain('  (Retracted at %s by %s)' % (time.strftime('%Y-%m-%d %H:%M:%S', time.localtime(item['removal']['at_ms'] / 1000.0)), item['removal']['by']))
        if item.get("blocks"):
            self.out.plain("  (holds %s %s until it is answered)" % (item["blocks"]["kind"], item["blocks"]["ref"]))
        reactions = item.get("reactions") or {}
        if item.get("go_ahead") and not item.get('removal'):
            said = ", ".join("%s %s" % (answer["actor_id"], "✅ go ahead" if answer["answer"] == "yes" else "🚫 don't")
                             for answer in reactions.get("answers", []))
            self.out.plain("  (asks for a go-ahead%s)" % (": " + said if said else "; not answered yet"))
        if item.get("withdrawal"):
            self.out.plain("  (Question withdrawn)")
        if reactions.get("thumbs"):
            # A person's 👍 on an ask to them answers it yes (item 239): "(👍 tony (yes))".
            self.out.plain("  (👍 " + ", ".join(thumb["actor_id"] + (" (yes)" if thumb.get("answered") else "")
                                                for thumb in reactions["thumbs"]) + ")")
        about = item.get("about")
        if about and not about.get("hidden"):
            self.out.plain('  (about %s by %s in "%s")' % (about["message_id"], about["author_id"], _one_line(about["topic_title"], 60)))
        if item.get("withheld"):
            # Its author has it open in Edit: its words come back once they save or leave it (docs/message-edit.md).
            self.out.plain("  " + HELD_WORDS)
        # A message of attachments alone, such as a screenshot, has no words to print.
        for line in body.split("\n") if body else ():
            self.out.plain("  " + line)
        for attachment in item["attachments"]:
            self.out.plain(_attachment_line(attachment))
        if item.get("whisper"):
            other = item["private_to"] if item["author_id"] == self.actor else item["author_id"]
            answer = "Answer with a whisper: whisper %s --to %s --reply-to %s -." % (topic_id, other, item["id"])
            if item["author_id"] != self.actor and item.get("author_kind") == "human":
                # A person's whisper counts as their Tell (docs/whispers.md); only its words stay between the two.
                self.out.plain("  (A whisper: it counts as a Tell from %s: act on it. Only you and %s can read it; never repeat or "
                               "quote it where others can read it. %s)" % (other, other, answer))
            else:
                self.out.plain("  (A whisper: only you and %s can read it; it is never repeated where others can read it. %s)" % (other, answer))
        self.item_lines(item, waits)

    def do_attachment(self):
        """Save one attachment's bytes to a new file, through its message or current page.

        The same read as the web page's (open_media with the selected source):
        only someone who can read that source gets the bytes, which
        Core has checked against the attachment's size and sha256."""
        options = self.options
        page = options.page is not None
        source = {"kind": "message", "id": options.message}
        if page:
            status = self.store.view(self.actor, "memory_status", {"item_id": options.page})
            if status.get("error"):
                self.out.raw(status)
                self.fail(status["error"])
            source = status["source_ref"]
        try:
            with self.store.open_media(self.actor, {"media_id": options.attachment,
                                                    "source_ref": source}) as resource:
                descriptor = dict(resource.descriptor)
                data = b"".join(iter(lambda: resource.read(65536), b""))
        except Refusal as refusal:
            self.refuse(refusal.code, refusal.message)
        try:
            # A new file only: an agent's earlier file is never replaced.
            fd = os.open(options.out, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
            created = os.fstat(fd)
        except FileExistsError:
            self.refuse("OUT_EXISTS", "%s already exists; name a new file" % options.out)
        except OSError as error:
            self.refuse("OUT_UNAVAILABLE", "%s cannot be created (%s)" % (options.out, error.strerror))
        try:
            with os.fdopen(fd, "wb") as target:
                target.write(data)
                target.flush()
                os.fsync(target.fileno())
        except OSError as error:
            self.refuse("OUT_UNAVAILABLE", "%s could not be written (%s); %s" % (options.out, error.strerror, _remove_partial(options.out, created)))
        attachment = {key: descriptor[key] for key in ("name", "content_type", "size_bytes", "sha256", "inline")}
        self.out.raw({"attachment": dict(attachment, id=descriptor["media_id"]),
                      **({"page_id": options.page} if page else {"message_id": options.message}), "path": options.out})
        self.out.plain("saved %s (%s, %s bytes, sha256 %s) to %s" % (descriptor["name"], descriptor["content_type"],
                                                                    descriptor["size_bytes"], descriptor["sha256"], options.out))

    # Notebook pages ------------------------------------------------------------

    def notebook_scope(self):
        return {"kind": "topic" if self.options.topic else "workspace", "id": self.options.scope}

    @staticmethod
    def scope_words(scope):
        return ("topic " if scope["kind"] == "topic" else "outcome ") + scope["id"]

    def page_words(self):
        """A page's words from FILE, or from stdin for -, exactly as written."""
        path = self.options.file
        if path == "-":
            return self.bounded_text(self.stdin)
        return self.bounded_text(io.BytesIO(self.read_file(path, LIMITS["body_utf8_bytes"] + 1)))

    def read_file(self, path, cap):
        """At most cap bytes of the regular file at path, refused with nothing sent when it cannot be read."""
        try:
            fd = os.open(path, os.O_RDONLY | os.O_NONBLOCK)
        except OSError as error:
            self.refuse("FILE_UNAVAILABLE", "%s cannot be read (%s); nothing was sent" % (path, error.strerror))
        try:
            with os.fdopen(fd, "rb") as source:
                if not stat.S_ISREG(os.fstat(source.fileno()).st_mode):
                    self.refuse("FILE_UNAVAILABLE", "%s is not a regular file; nothing was sent" % path)
                return source.read(cap)
        except OSError as error:
            self.refuse("FILE_UNAVAILABLE", "%s cannot be read (%s); nothing was sent" % (path, error.strerror))

    def attach(self, kept=()):
        """Uploads each --attach file as people's uploads go (media.begin, then its
        bytes through the verified stream) and returns the attachments to send.
        Every file is read and held to the limits first, together with the ones
        kept, so nothing is sent when one is refused."""
        paths, files = self.options.attach, []
        if len(kept) + len(paths) > LIMITS["attachment_count"]:
            self.refuse("TOO_MANY_ATTACHMENTS", "At most %d attachments go with one message or page; nothing was sent" % LIMITS["attachment_count"])
        total = sum(item["size_bytes"] for item in kept)
        for path in paths:
            name = os.path.basename(path)
            try:
                encoded = name.encode("utf-8")
            except UnicodeError:
                self.refuse("INVALID_ARGUMENT", "An attachment's file name must be UTF-8; rename %s; nothing was sent" % path)
            if not encoded or len(encoded) > LIMITS["media_name_utf8_bytes"]:
                self.refuse("INVALID_ARGUMENT", "%s needs a file name of 1 to %d bytes; nothing was sent" % (path, LIMITS["media_name_utf8_bytes"]))
            # The larger cap first, so the type can be read from the bytes.
            data = self.read_file(path, LIMITS["media_file_bytes"] + 1)
            content_type = _media_type(name, data)
            image = content_type.startswith("image/")
            cap = LIMITS["image_bytes"] if image else LIMITS["media_file_bytes"]
            if len(data) > cap:
                self.refuse("ATTACHMENT_TOO_LARGE", "%s is larger than the %s an %s may be; nothing was sent" % (
                    name, _size(cap), "image" if image else "attached file"))
            total += len(data)
            if total > LIMITS["attachment_bytes"]:
                self.refuse("TOO_MANY_ATTACHMENTS", "The attachments come to more than %s together; nothing was sent" % _size(LIMITS["attachment_bytes"]))
            files.append((name, content_type, data))
        return [self.upload(name, content_type, data) for name, content_type, data in files]

    def upload(self, name, content_type, data):
        """One file, uploaded as people's uploads go: media.begin, then its bytes
        through the verified stream. An upload only prepares the verb's act:
        retrying it cannot send the message or page (and a publication cannot
        be retried without the bytes). So neither request goes through
        `command`, is saved in the outbox or is named for `retry`; however the
        upload ends, the verb ends here, saying the message or page was not
        sent and to run the command again, exit 2 (130 when interrupted)."""
        media, publication = "media-" + uuid.uuid4().hex, "cli-" + uuid.uuid4().hex
        steps = ((self.envelope("media.begin", {"media_id": media}, {
                     "name": name, "content_type": content_type, "size_bytes": len(data), "sha256": hashlib.sha256(data).hexdigest(),
                     "publish_operation_id": publication}, {"media_revision": 0}), self.store.command),
                 (self.envelope("media.publish", {"media_id": media}, {}, {"media_revision": 1}, publication),
                  lambda actor, envelope: self.store.publish_media(actor, envelope, io.BytesIO(data))))
        code = 2
        try:
            for envelope, send in steps:
                receipt = send(self.actor, envelope)
                error = receipt.get("error")
                if error:
                    reason = "%s: %s" % (error.get("code"), error.get("message"))
                    break
                self.out.raw(receipt)
            else:
                self.out.plain("attached %s (%s, %s%s) as %s" % (name, content_type, _size(len(data)),
                                                                  ", inline" if receipt["result"]["inline"] else "", media))
                return {"id": media}
        except (StoreError, OSError):
            reason = "the store did not answer"
        except OutputFailed:
            reason = "its result could not be written out"
        except KeyboardInterrupt:
            reason, code = "interrupted", 130
        message = "%s was not attached (%s), so the message or page was not sent; run the command again." % (name, reason)
        _diagnostic(self.out.stderr, _shown("ATTACHMENT_NOT_SENT: " + message))
        try:
            # --json gets it as its last line too; stderr has said it already,
            # so a line that cannot be written changes nothing.
            self.out.raw(_attempt("ATTACHMENT_NOT_SENT", message))
        except OutputFailed:
            pass
        raise Failed(code)

    def write_page(self, kind, target, expected, args):
        """Writes one revision, then reads it back: a page that does not read back
        as written fails loudly, naming the revision that was recorded."""
        result = self.command(kind, target, args, {"item_revision": expected})
        check = "read it with `note read %s --revision %d`" % (result["item_id"], result["revision"])
        source = self.read_back("source", {"source_ref": result["source_ref"]}, {
            "what": "revision %d of %s was recorded" % (result["revision"], result["item_id"]), "kind": kind, "it": "it"}, check)
        differs = [name for name, same in (
            ("title", source["title"] == args["title"]), ("body", source["body"] == args["body"]),
            ("attachments", [item["id"] for item in source["attachments"]] == [item["id"] for item in args["attachments"]]),
            ("evidence", source["references"] == args["references"]),
            ("revision", source["source_ref"] == result["source_ref"]), ("author", source["author"] == self.actor)) if not same]
        if differs:
            _diagnostic(self.out.stderr, "READ_BACK_MISMATCH: revision %d of %s was recorded, but it reads back with a different %s; "
                        "%s before writing again." % (result["revision"], result["item_id"], " and ".join(differs), check))
            raise Failed(1, recorded=True)
        return result

    def do_note(self):
        getattr(self, "note_" + self.options.note_verb)()

    def note_new(self):
        options = self.options
        scope = self.notebook_scope()
        args = {"title": options.title, "body": self.page_words(), "attachments": [], "references": []}
        args["attachments"] = self.attach()
        item = "n-" + uuid.uuid4().hex
        result = self.write_page("memory.create", {"item_id": item, "owner_scope": scope}, 0, args)
        self.out.plain('created %s "%s" in %s at revision %d; read back matches' % (
            item, _one_line(options.title, 60), self.scope_words(result["owner_scope"]), result["revision"]))

    def note_revise(self):
        """A new revision: the words given, keeping the title (unless --title),
        attachments and evidence of the page as it stands. Core refuses it unless
        --expected is the revision it stands at."""
        options = self.options
        body = self.page_words()
        current = self.view("memory_current", {"item_id": options.item})
        args = {"title": current["title"] if options.title is None else options.title, "body": body,
                "attachments": [{"id": item["id"]} for item in current["attachments"]] + self.attach(kept=current["attachments"]),
                "references": current["references"]}
        result = self.write_page("memory.revise", {"item_id": options.item}, options.expected, args)
        self.out.plain('revised %s "%s" to revision %d; read back matches' % (result["item_id"], _one_line(args["title"], 60), result["revision"]))

    def note_read(self):
        """One revision of a page, the latest unless --revision names one. Once it
        is printed, it records that the actor read that revision (memory.read,
        which only moves forward, so reading an older one moves nothing back), and
        `notes` stops marking the page changed."""
        options = self.options
        source = (self.view("memory_current", {"item_id": options.item}) if options.revision is None else
                  self.view("source", {"source_ref": {"kind": "memory", "id": options.item, "revision": options.revision}}))
        self.out.plain('%s  "%s"  revision %s of %s by %s  (%s)' % (
            source["source_ref"]["id"], _one_line(source["title"]), source["version"], source["current_revision"],
            source["author"], self.scope_words(source["owner_scope"])))
        self.out.plain("")
        if source.get("withheld"):
            # A draft page gives an agent its title alone (docs/notebook-pages.md, "A draft page").
            self.out.plain("This page is a draft: its writer keeps its words from agents until the draft mark is cleared.")
        for line in source["body"].split("\n") if source["body"] else ():
            self.out.plain(line)
        for attachment in source["attachments"]:
            self.out.plain(_attachment_line(attachment))
        for ref in source["references"]:
            self.out.plain("  [evidence: %s]" % ("message " + ref["id"] if ref["kind"] == "message" else
                                                 "page %s revision %s" % (ref["id"], ref["revision"])))
        item, revision = source["source_ref"]["id"], source["source_ref"]["revision"]
        try:
            self.command("memory.read", {"item_id": item}, {"revision": revision})
        except BaseException as stopped:
            # The page is shown either way; reading it again is harmless. A
            # final refusal is not offered for retry, as dispatch never does.
            sent = self.operation is not None and not (isinstance(stopped, Failed) and stopped.code == 2)
            _diagnostic(self.out.stderr, "READ_NOT_RECORDED: revision %s of %s is printed above, but that you read it was not confirmed, "
                        "so `notes` may still mark the page changed; %s records it." % (
                            revision, item, "`retry %s`" % self.operation if sent else "`note read %s --revision %s`" % (item, revision)))
            raise

    def note_link(self):
        """The address that opens a page (docs/links.md, "A Notebook page's link"):
        its Notebook's topic or outcome, the page, and the revision when one is
        named. --origin puts the instance's address in front. It records nothing."""
        options = self.options
        origin = options.origin
        if origin is not None:
            parts = urllib.parse.urlsplit(origin)
            if parts.scheme not in ("http", "https") or not parts.hostname or parts.path not in ("", "/") or parts.query or parts.fragment or "@" in parts.netloc:
                self.refuse("INVALID_ARGUMENT", "--origin is the instance's address alone, such as https://NAME.ts.net:PORT")
            origin = "%s://%s" % (parts.scheme, parts.netloc)
        source = (self.view("memory_current", {"item_id": options.item}) if options.revision is None else
                  self.view("source", {"source_ref": {"kind": "memory", "id": options.item, "revision": options.revision}}))
        scope = source["owner_scope"]
        params = [("topic" if scope["kind"] == "topic" else "workspace", scope["id"]), ("page", source["source_ref"]["id"])]
        if options.revision is not None:
            params.append(("revision", str(source["source_ref"]["revision"])))
        link = (origin + "/" if origin else "") + "?" + urllib.parse.urlencode(params, quote_via=urllib.parse.quote)
        self.out.raw({"link": link})
        self.out.plain(link)

    def do_notes(self):
        """A Notebook's pages, oldest first, each marked when it changed since the actor read it."""
        items = self.pages("memory_items", {"owner_scope": self.notebook_scope()})
        for item in items:
            line = '%s  "%s"  revision %s by %s' % (item["id"], _one_line(item["title"], 80), item["revision"], item["author"])
            if 0 < item["read_revision"] < item["revision"]:
                line += "  [changed since you read revision %s]" % item["read_revision"]
            if item.get("draft"):
                line += "  [draft: its writer keeps its words from agents]"
            self.out.plain(line)
        if not items:
            self.out.plain("no Notebook pages")

    @staticmethod
    def delivery_line(item):
        if item.get('retraction'):
            removed = item['retraction']
            return 'retraction "%s" %s retracted %s; it no longer asks, answers or holds a wait.  [%s in %s]' % (
                _one_line(item['topic']['title'], 60), removed['by'], removed['message_id'], item['id'], item['topic']['id'])
        if item.get('answer'):
            answer = item['answer']
            return 'answer "%s" %s from %s to question %s: %s%s  [%s in %s]' % (
                _one_line(item['topic']['title'], 60), answer['kind'], answer['actor_id'], answer['message_id'],
                answer['value'], '' if answer['stands'] else ' (no longer stands)', item['id'], item['topic']['id'])
        if item.get("request"):
            request = item["request"]
            return 'request "%s" %s from %s, source %s, dossier %s, observed revision %s: %s  [%s in %s]' % (
                _one_line(item["topic"]["title"], 60), request["kind"], request["requester_id"],
                request["message_id"], request["root_id"], request["observed_revision"],
                _one_line(request["body"], len(request["body"])), item["id"], request["topic_id"])
        message = item["message"]
        if item.get("correction"):
            # Its author edited a message this agent was sent: read it again, act on its latest words, then ack this line's id.
            return 'correction "%s" #%s %s edited %s to revision %s: %s  [%s in %s]' % (
                _one_line(item["topic"]["title"], 60), message["seq"], message["author_id"], message["id"], item["correction"]["revision"],
                _one_line(message["body"]), item["id"], message["topic_id"])
        return '%s "%s" #%s %s: %s  [%s in %s]%s' % (
            "whisper" if message.get("whisper") else "delivery",
            _one_line(item["topic"]["title"], 60), message["seq"], message["author_id"],
            _one_line(message["body"]), item["id"], message["topic_id"], Agent.name_it(item.get("name_it")))

    @staticmethod
    def name_it(found):
        """What tells an agent it names a dossier nobody has named (item 479): the mint to run, fenced on the name's
        revision as read, or nothing."""
        if not found:
            return ""
        return '  [you name its dossier: mint %s --expected %s "two to five words"]' % (found["root_id"], found["name_revision"])

    def do_inbox(self):
        items = sorted(self.pages("deliveries", {}), key=lambda item: item["seq"])
        self.context_deliveries = items
        to_name = set()
        for item in items:
            # Each dossier to name is said once, on its oldest delivery.
            if item.get("name_it"):
                if item["name_it"]["root_id"] in to_name:
                    item = {key: value for key, value in item.items() if key != "name_it"}
                else:
                    to_name.add(item["name_it"]["root_id"])
            self.out.plain(self.delivery_line(item))
        if not items:
            self.out.plain("inbox empty")

    def do_reply(self):
        if self.options.message.startswith("d-"):
            self.refuse("INVALID_REPLY", "reply takes a message id (m-...), not a delivery id (d-...); read the topic for its message id, never replace the prefix; nothing was sent")
        source = self.view("source", {"source_ref": {"kind": "message", "id": self.options.message}})
        if source.get("whisper"):
            self.refuse("WHISPER_STAYS_PRIVATE", "Answer a whisper with `whisper TOPIC --to NAME --reply-to MESSAGE -`; nothing was sent")
        self.options.topic = source["topic_id"]
        self.options.reply_to = self.options.message
        self.do_post()

    def reply_choice(self, args):
        options = self.options
        offsets = (options.quote_revision, options.quote_start, options.quote_end)
        if options.quote is not None:
            if not options.reply_to or not options.quote or options.without_quote is not None or any(value is not None for value in offsets):
                self.refuse("INVALID_REPLY_PASSAGE", "Choose nonempty --quote text with a reply target, without offsets or --without-quote")
            source = self.view("source", {"source_ref": {"kind": "message", "id": options.reply_to}})
            if source["withheld"]:
                self.refuse("MESSAGE_HELD", "Its author is editing this message; read it again before replying")
            start = source["body"].find(options.quote)
            if start < 0:
                self.refuse("INVALID_REPLY_PASSAGE", "That text isn't in the message you're replying to")
            args["reply_passage"] = {"source": dict(source["source_ref"], revision=source["revision"]),
                                     "start": start, "end": start + len(options.quote)}
        if any(value is not None for value in offsets):
            if not options.reply_to or any(value is None for value in offsets):
                self.refuse("INVALID_REPLY_PASSAGE", "A quoted reply needs its target, revision, start and end")
            args["reply_passage"] = {"source": {"kind": "message", "id": options.reply_to,
                "revision": options.quote_revision}, "start": options.quote_start, "end": options.quote_end}
        if options.without_quote is not None:
            args["reply_without_quote"] = options.without_quote

    def do_post(self):
        options = self.options
        if options.to is not None or (options.asks is not None and options.tells is not None):
            self.refuse("INTENT_REQUIRED", "A message to someone says whether it asks or tells: use --asks A,B or --tells A,B "
                        "(not --to, and not both); nothing was sent")
        if options.asks is not None and options.go_ahead is None:
            self.refuse("GO_AHEAD_REQUIRED", "An Ask explicitly chooses --go-ahead or --no-go-ahead; nothing was sent")
        if options.asks is None and options.go_ahead is not None:
            self.refuse("INVALID_ARGUMENT", "--go-ahead and --no-go-ahead belong to --asks; nothing was sent")
        named = options.asks if options.asks is not None else options.tells
        addressees = _names(named or "")
        if named is not None and not addressees:
            flag = "--asks" if options.asks is not None else "--tells"
            self.refuse("INVALID_ARGUMENT", "%s names who it is to (%s A,B), and these name nobody; nothing was sent" % (flag, flag))
        operation = self.operation_of()
        args = {"body": self.text(), "addressees": addressees}
        if options.ask_wait is not None:
            try:
                args["ask_wait"] = json.loads(options.ask_wait)
            except (ValueError, TypeError):
                self.refuse("INVALID_ARGUMENT", "--ask-wait needs a JSON object; nothing was sent")
        self.reply_choice(args)
        if options.attach and options.reply_to and self.view("capabilities", {})["actor_kind"] == "agent":
            # Refuse invalid passage requests before publishing attachment bytes.
            from . import reply_passages
            source = self.view("source", {"kind": "message", "id": options.reply_to})
            if source.get("whisper"):
                self.refuse("WHISPER_STAYS_PRIVATE", "Answer a whisper with whisper; nothing was uploaded or sent")
            if source["topic_id"] != options.topic:
                self.refuse("INVALID_REPLY", "Reply context must belong to the destination topic")
            try:
                reply_passages.select(source, dict(args, reply_to=options.reply_to))
            except Refusal as error:
                self.refuse(error.code, error.message)
        if options.attach:
            args["attachments"] = self.attach()
        if addressees:
            args["intent"] = "ask" if options.asks is not None else "tell"
        if getattr(options, "divergence_reason", None) is not None:
            args["divergence_reason"] = options.divergence_reason
        if options.reply_to:
            args["reply_to"] = options.reply_to
        if options.part:
            args["part"] = True
        if options.go_ahead is not None:
            args["go_ahead"] = options.go_ahead
        if options.subject:
            # --subject item:92,item:31: what the post is about, written with it.
            args["subjects"] = [dict(zip(("kind", "ref"), part.strip().split(":", 1))) for part in options.subject.split(",") if part.strip()]
        if options.blocks is not None:
            # --blocks release:44, or piece:p-…: Core checks it names this outcome's piece or release, and that the post asks.
            kind, _, ref = options.blocks.partition(":")
            args["blocks"] = {"kind": kind.strip(), "ref": ref.strip()}
        if options.asks is not None and options.ask_wait is None:
            self.default_ask_wait(args, operation)
        result = self.command("message.post", {"topic_id": options.topic}, args, operation=operation)
        held = result.get("blocks")
        self.out.plain("posted %s in %s (%s deliveries queued)%s" % (result["message_id"], result["topic"]["id"], result["delivery"]["queued"],
                                                                     "; it holds %s %s until it is answered" % (held["kind"], held["ref"]) if held else ""))
        if options.reply_to:
            self.namer_hint(result["message_id"])

    def default_ask_wait(self, args, operation):
        """Keep ordinary CLI asks usable without inventing choices or promises.

        The outbox pins derived cover metadata just as it pins the writing.
        Repeating --operation must not regenerate a now-stale cover fence.
        """
        if operation is not None:
            path = self.outbox() / (operation + ".request.json")
            if path.exists():
                saved = _input(str(path), None)
                envelope = _request(saved, "command")
                if saved["binding"] != self.binding or envelope["operation_id"] != operation:
                    self.refuse("BINDING_MISMATCH", "This saved request belongs to another binding or operation")
                previous = envelope["args"]
                if (envelope["kind"] != "message.post" or envelope["target"] != {"topic_id": self.options.topic}
                        or {key: value for key, value in previous.items() if key != "ask_wait"} != args):
                    self.refuse("OPERATION_PAYLOAD_MISMATCH", "Operation %s already names a different request; nothing was sent" % operation)
                if "ask_wait" in previous:
                    args["ask_wait"] = previous["ask_wait"]
                return
        if self.view("capabilities", {})["actor_kind"] != "agent":
            return
        named = set(args["addressees"]) - {self.actor}
        people = [person["id"] for person in self.pages("actors", {"kind": "human"}) if person["id"] in named]
        if not people:
            return
        root, revision = None, 0
        if args.get("reply_to"):
            cover = self.view("dossier_cover", {"message_id": args["reply_to"]})
            root, revision = cover["root_id"], cover["cover_revision"]
        first, question = None, None
        for line in args["body"].splitlines():
            # Agent replies often lead with @names and a quote of the person.
            # Use the agent's own words, not that addressing or quoted writing.
            line = re.sub(r"^(?:@[\w.-]+[,:]?(?:\s+|$))+", "", line.strip()).strip()
            if line and not line.startswith(">"):
                if first is None:
                    first = line
                if line.endswith("?"):
                    question = line
        text = question or first or "Please respond to this message."
        text = text if len(text) <= 300 else text[:299] + "…"
        args["ask_wait"] = {"root_id": root, "cover_revision": revision, "questions": [
            {"actor_id": person, "text": text, "options": [], "default": None,
             "reason": "No choices or default were supplied; waiting for your response."}
            for person in people]}

    def namer_hint(self, message_id):
        """After a reply: when this agent now names its dossier, which nobody has named (item 479), the mint to run.
        The reply is posted either way; a read that fails says so and leaves the mint to `mint`."""
        try:
            found = self.store.view(self.actor, "stack_namer", {"message_id": message_id})
        except (StoreError, OSError):
            found = {"error": {"code": "UNREAD"}}
        if found.get("error"):
            _diagnostic(self.out.stderr, "NAMER_UNREAD: the reply is posted; whether you name its dossier could not be read (%s). "
                        "`stack_namer` says it; `mint %s WORDS` names it if you do." % (found["error"]["code"], message_id))
        elif found["namer"] == self.actor:
            self.out.plain("its dossier has no name, and you name it:%s" % self.name_it({"root_id": found["root_id"], "name_revision": found["name_revision"]}))

    def do_mint(self):
        """The name of the dossier a message is in, minted by the agent that names it (docs/reply-stacks.md, "Minted
        names"): Core takes it on the dossier's first message, fenced on --expected (the name's revision when the agent
        was told to name it), or else on the revision read now, and refuses it once anyone has named the dossier."""
        options = self.options
        found = self.view("stack_namer", {"message_id": options.message})
        expected = found["name_revision"] if options.expected is None else options.expected
        result = self.command("stack.name", {"message_id": found["root_id"]}, {"name": self.text(), "minted": True}, {"name_revision": expected})
        self.out.plain('named the dossier of %s "%s"%s' % (result["message_id"], result["name"], "" if result["changed"] else " (already so)"))

    def do_edit(self):
        """New words for a message the actor wrote (docs/message-edit.md, item 614): one message.edit, fenced on
        --expected, the revision read (1 when never edited). A correction to one's own words is an edit of them, not a
        follow-up message. Core refuses another's message (FORBIDDEN), a stale revision (REVISION_CONFLICT, which names
        the current one) and the words already there (INVALID_ARGUMENT); every reader is told, each agent that was
        handed the old words is sent a correction, and each person who had read them sees them struck through, the
        message unread for them again."""
        options = self.options
        result = self.command("message.edit", {"message_id": options.message}, {"body": self.text()}, {"message_revision": options.expected})
        self.out.plain("edited %s to revision %s (corrections: %s; unread again: %s)" % (
            result["message_id"], result["revision"], result["corrections"], result.get("unread_again", 0)))

    def do_whisper(self):
        """A whisper: to one agent, or an agent's answer to the person who whispered to it (--reply-to)."""
        options = self.options
        args = {"body": self.text(), "addressees": _names(options.to), "whisper": True}
        if options.reply_to:
            args["reply_to"] = options.reply_to
        self.reply_choice(args)
        result = self.command("message.post", {"topic_id": options.topic}, args)
        self.out.plain("whispered %s to %s in %s" % (result["message_id"], ", ".join(args["addressees"]), result["topic"]["id"]))

    def started_from(self, source, seen):
        """Refuses, saving nothing, when topics were already started from source that seen does not name; lists them first."""
        unseen = [item for item in self.pages("source_topics", {"message_id": source}) if item["id"] not in seen]
        for item in unseen:
            self.out.plain('already started %s "%s" in %s by %s  [%s]  (%s messages)' % (
                item["id"], _one_line(item["title"], 60), item["workspace_id"], item["creator_id"], item["state"], item["message_count"]))
        if unseen:
            ids = ",".join(item["id"] for item in unseen)
            self.refuse("ALREADY_STARTED", "%s already started from %s (listed above): continue there, or start anyway with --seen %s; nothing was saved" % (
                "a topic was" if len(unseen) == 1 else "%d topics were" % len(unseen), source, ids))

    def seen(self):
        seen = _names(self.options.seen or "")
        if self.options.seen is not None and not seen:
            self.refuse("INVALID_ARGUMENT", "--seen names the topics already started that you have read (--seen T1,T2); nothing was sent")
        return seen

    def do_start(self):
        options = self.options
        named = self.operation_of()
        if named is None:
            opening, topic = "o-" + uuid.uuid4().hex, "t-" + uuid.uuid4().hex
        else:
            digest = hashlib.sha256(named.encode("utf-8")).hexdigest()[:32]
            opening, topic = "o-" + digest, "t-" + digest
        body = self.text()
        seen = self.seen()
        writing = {"workspace_id": options.outcome, "topic_id": topic, "title": options.title,
                   "participants": _names(options.participants), "body": body, "attachments": []}
        if options.source is not None:
            self.started_from(options.source, seen)
            writing["source_message_id"] = options.source
            if options.part:
                writing["part"] = True
        elif seen:
            self.refuse("INVALID_ARGUMENT", "--seen names topics started from the message --from names; nothing was sent")
        writing["attachments"] = self.attach()
        try:
            saved = self.command("opening.save", {"opening_id": opening}, writing, {"opening_revision": 0}, self.operation_of("-save"))
        except BaseException as stopped:
            # Once the save request is saved, any end but a final refusal may
            # leave the save recorded (or recordable by `retry`), so the
            # opening and its topic are named for `publish`.
            if self.operation is not None and not (isinstance(stopped, Failed) and stopped.code == 2):
                _diagnostic(self.out.stderr, "start: " + self.publish_hint(opening, topic))
            raise
        try:
            result = self.command("opening.publish", {"opening_id": opening}, {"seen": seen} if options.source is not None else {},
                                  {"opening_revision": saved["opening_revision"]}, self.operation_of("-publish"))
        except BaseException as stopped:
            # The save is recorded, so the opening stays whatever ends the publish.
            if isinstance(stopped, Failed) and stopped.code == 2:
                hint = "opening %s stays unpublished: Core refused its publish." % opening
                if options.source is not None:
                    hint += " If another topic started from %s meanwhile, read it; `publish %s --seen T1,T2` naming every one starts this anyway." % (
                        options.source, opening)
            elif isinstance(stopped, Failed) and stopped.recorded:
                hint = "the publish of opening %s was recorded; `publish %s` reports whether it started topic %s." % (opening, opening, topic)
            else:
                hint = self.publish_hint(opening, topic, recorded=True)
            _diagnostic(self.out.stderr, "start: " + hint)
            raise
        self.out.plain('started %s "%s" in %s with %s' % (topic, _one_line(options.title, 60), options.outcome, result["message_id"] or "no message yet"))

    @staticmethod
    def publish_hint(opening, topic, recorded=False):
        return "opening %s will start topic %s; %s`publish %s` starts it." % (
            opening, topic, "" if recorded else "once its save is recorded, ", opening)

    def do_publish(self):
        opening = self.view("opening", {"opening_id": self.options.opening})["opening"]
        if opening["state"] == "published":
            self.out.plain("already published %s as %s with %s" % (opening["id"], opening["topic_id"], opening["message_id"] or "no message yet"))
            return
        seen = self.seen()
        result = self.command("opening.publish", {"opening_id": opening["id"]}, {"seen": seen} if seen else {},
                              {"opening_revision": opening["revision"]})
        self.out.plain('started %s "%s" in %s with %s' % (opening["topic_id"], _one_line(opening.get("title", ""), 60),
                                                          opening["workspace_id"], result["message_id"] or "no message yet"))

    def do_withdraw(self):
        result = self.command("message.withdraw", {"message_id": self.options.message}, {}, operation=self.operation_of())
        self.out.plain("Question withdrawn: %s%s" % (result["message_id"], "" if result["changed"] else " (already so)"))

    def do_thumb(self):
        """A thumbs-up: read and understood, said without a message (docs/thumbs.md)."""
        message = self.options.message
        current = self.view("reactions", {"message_id": message})["reactions"]["thumb_revision"]
        result = self.command("message.thumb", {"message_id": message}, {"thumbed": not self.options.off}, {"thumb_revision": current})
        words = "thumbed up" if result["thumbed"] else "took back the thumbs-up on"
        self.out.plain("%s %s%s" % (words, result["message_id"], "" if result["changed"] else " (already so)"))

    def do_ack(self):
        for delivery in self.options.deliveries:
            try:
                result = self.command("delivery.ack", {"delivery_id": delivery}, {})
            except Failed as failed:
                if failed.code == 1:
                    raise
                # Each delivery is its own act; one refusal does not stop the rest.
                self.exit = max(self.exit, failed.code, key=lambda code: (0, 75, 2).index(code))
                continue
            state = ("already acknowledged" if result.get("already_acknowledged") else
                     "acknowledged" if result["acknowledged"] else "not pending")
            self.out.plain("%s %s" % (state, delivery))

    def do_read_through(self):
        result = self.command("topic.read_through", {"topic_id": self.options.topic}, {"seq": self.options.seq})
        self.out.plain("read %s through #%s (%s acknowledged)" % (result["topic_id"], result["seq"], result["acknowledged"]))

    def _saved_operation(self):
        operation = self.options.operation
        if not SAFE_NAME.fullmatch(operation):
            raise UsageError()
        directory = self.outbox()
        request = _input(str(directory / (operation + ".request.json")), None)
        envelope = _request(request, "command")
        if request["binding"] != self.binding or envelope["operation_id"] != operation:
            self.refuse("BINDING_MISMATCH", "This saved request belongs to another binding or operation")
        return directory, request, envelope

    def _reconcile_operation(self, directory, envelope):
        operation = envelope['operation_id']
        self.operation = operation
        from .validation import _command_envelope
        from .contract import _json
        fingerprint = hashlib.sha256(_json(_command_envelope(envelope)).encode('utf-8')).hexdigest()
        result = self.store.view(self.actor, 'operation', {'operation_id': operation, 'expected_fingerprint': fingerprint})
        if (type(result) is not dict or result.get('instance_id') != self.profile.instance_id
                or 'error' not in result and result.get('operation_id') != operation):
            self.refuse('RECOVERY_UNKNOWN', 'The original operation could not be reconciled; nothing was sent')
        if 'error' in result:
            error = result['error']
            if (type(error) is not dict or type(error.get('code')) is not str
                    or type(error.get('message')) is not str or type(error.get('retryable')) is not bool):
                self.refuse('RECOVERY_UNKNOWN', 'The original operation could not be reconciled; nothing was sent')
        if result.get('recorded') is not True and result.get('error'):
            # Preserve the actual bound refusal. It never authorizes replay.
            self.out.raw(result)
            self.fail(result['error'])
        if result.get('recorded') is True:
            if (result.get('kind') != envelope['kind'] or result.get('status') not in ('committed', 'rejected')
                    or 'result' not in result or type(result.get('affected')) is not list
                    or (result['status'] == 'rejected') != ('error' in result)):
                self.refuse('RECOVERY_UNKNOWN', 'The original operation could not be reconciled; nothing was sent')
            try:
                local = json.loads((directory / (operation + '.receipt.json')).read_text(encoding='utf-8'))
            except (OSError, ValueError):
                local = None
            return ('terminal' if local == result else 'committed_unseen'), result
        if result.get('recorded') is False and result.get('status') == 'unknown':
            return 'pending_intent', result
        self.refuse('RECOVERY_UNKNOWN', 'The original operation could not be reconciled; nothing was sent')

    def do_reconcile(self):
        directory, request, envelope = self._saved_operation()
        state, result = self._reconcile_operation(directory, envelope)
        self.out.raw({'instance_id': self.profile.instance_id, 'operation_id': envelope['operation_id'],
                      'recovery_state': state, 'result': result})
        self.out.plain('%s: %s; no request was sent' % (envelope['operation_id'], state))

    def do_retry(self):
        directory, request, envelope = self._saved_operation()
        state, receipt = self._reconcile_operation(directory, envelope)
        # Core's immutable result wins over a lost local receipt. Only an
        # absent result re-enters command(), with the exact saved identity.
        result = self.dispatch(directory, request, send=(lambda actor, command: receipt)
                               if state in ('committed_unseen', 'terminal') else None)
        operation = envelope['operation_id']
        self.out.plain("recorded %s (%s)" % (operation, envelope["kind"]))
        if envelope["kind"] == "opening.save":
            self.out.plain(self.publish_hint(envelope["target"].get("opening_id"), envelope["args"].get("topic_id"), recorded=True))
        return result

    def do_watch(self):
        if self.options.broker:
            self.refuse('WATCH_UNAVAILABLE', 'Hosted deliveries drive this route; use inbox for a bounded pending read')
        try:
            # The authority anchor is watched as well: a recovery activation
            # replaces it and never writes this database again.
            watch = NativeWatch(self.profile.db_path, companions=(self.profile.authority_path,))
        except WatchError as error:
            self.refuse("WATCH_UNAVAILABLE", "The native database watch is unavailable (%s)" % error)
        try:
            self.watch_changes(watch, once=self.options.once)
        except WatchStopped:
            # Stopped mid-notice: what the reader did not take is dropped, so
            # the exit cannot block on flushing it again.
            _quiesce_failed_stream(self.out.stdout)
        except WatchError as error:
            self.refuse("WATCH_FAILED", "The database watch stopped (%s)" % error)
        finally:
            watch.close()

    def notice(self, watch, value, line):
        """One watch notice. A stop ends it, even blocked on a reader that is not
        draining; refusals and results are written outside this, so a stop never
        hides one or its exit code."""
        with watch.stoppable():
            self.out.raw(value)
            self.out.plain(line)

    def read(self, watch, name, args):
        # A read that finds the database locked has already waited in SQLite's
        # lock handler; it waits there again, unless a stop was asked for.
        while True:
            result = self.store.view(self.actor, name, args)
            error = result.get("error")
            if not error or error.get("code") != "DATABASE_BUSY" or watch.stopped:
                return result

    def changes(self, watch, cursor):
        """The actor's next page of changes, or None when a stop came while the database was locked."""
        result = self.read(watch, "changes", dict({"scope": {"kind": "actor", "id": self.actor}},
                                                  **({} if cursor is None else {"cursor": cursor})))
        error = result.get("error")
        if error and error.get("code") == "DATABASE_BUSY":
            return None
        if error:
            self.out.raw(result)
            self.fail(error)
        return result

    def pending(self, watch):
        """The actor's pending deliveries, oldest first, or None when a stop came while the database was locked."""
        cursor, items = None, []
        while True:
            result = self.read(watch, "deliveries", {} if cursor is None else {"cursor": cursor})
            error = result.get("error")
            if error and error.get("code") == "DATABASE_BUSY":
                return None
            if error:
                self.out.raw(result)
                self.fail(error)
            items.extend(result["items"])
            cursor = result.get("next_cursor")
            if cursor is None:
                return sorted(items, key=lambda item: item["seq"])

    def watch_changes(self, watch, once=False):
        """Each delivery and change as a line, until a stop. With once, the
        oldest delivery waiting, or else the next pending one to arrive, then
        it returns; acknowledgments and other changes pass unprinted."""
        # The watch is armed before the baseline, so a write after the
        # checkpoint always produces another event.
        page = self.changes(watch, None)
        if page is None:
            return
        cursor = page["checkpoint"]
        # What is already waiting is reported first, so a watch restarted after
        # a gap names the deliveries made while it was down. The checkpoint was
        # taken before: a delivery made in between is also a change after it,
        # and is reported once. The watching line then means the watch is idle.
        pending = self.pending(watch)
        if pending is None:
            return
        if once and pending:
            pending = pending[:1]
        for item in pending:
            self.notice(watch, {"event": "delivery", "item": item}, self.delivery_line(item))
            self.shown.add(item["id"])
        if once and pending:
            return
        if not once:
            self.notice(watch, {"event": "watching", "actor_id": self.actor, "checkpoint": cursor},
                        "watching %s from change %s" % (self.actor, cursor["after_seq"]))
        while True:
            event = watch.wait(None)
            if event["stop"]:
                # A stop ends the watch, but never hides a moved authority: take
                # what else is queued, then check the fence once more.
                watch.wait(0)
                if watch.companion_moved:
                    raise WatchError("authority_anchor_replaced")
                self.changes(watch, cursor)
                return
            if not event["dirty"]:
                continue
            # Each read also checks the authority, so a replaced anchor ends
            # the watch with that refusal.
            while True:
                page = self.changes(watch, cursor)
                if page is None:
                    return
                if watch.companion_moved:
                    raise WatchError("authority_anchor_replaced")
                for change in page["items"]:
                    if once:
                        if self.arrived(watch, change):
                            return
                        continue
                    self.report(watch, change)
                if not page["has_more"]:
                    cursor = page["checkpoint"]
                    break
                cursor = page["continuation"]
            if watch.companion_moved:
                raise WatchError("authority_anchor_replaced")
            if watch.stopped:
                return

    def arrived(self, watch, change):
        """For watch --once: print this change if it is a delivery still
        pending, and say whether it was."""
        if change["resource_kind"] != "delivery":
            return False
        result = self.read(watch, "delivery", {"delivery_id": change["resource_id"]})
        error = result.get("error")
        if error and error.get("code") == "MESSAGE_HELD":
            # Its author opened Edit on it: it arrives as a delivery once they save or leave the edit.
            return False
        if error:
            self.notice(watch, {"event": "delivery", "change": change, "error": error},
                        "delivery unavailable (%s)  [%s]" % (error.get("code"), change["resource_id"]))
            return True
        if result["item"]["state"] != "pending":
            return False
        self.notice(watch, {"event": "delivery", "change": change, "item": result["item"]}, self.delivery_line(result["item"]))
        return True

    def report(self, watch, change):
        kind, identity, version = change["resource_kind"], change["resource_id"], change["version"]
        if kind == "whisper":
            # The whisper's own delivery says it; the change only names its topic.
            return
        if kind == "delivery" and version == 1:
            if identity in self.shown:
                self.shown.discard(identity)
                return
            result = self.read(watch, "delivery", {"delivery_id": identity})
            error = result.get("error")
            if error and error.get("code") == "MESSAGE_HELD":
                self.notice(watch, {"event": "delivery", "change": change, "error": error},
                            "delivery held while its author edits it  [%s]" % identity)
                return
            if error:
                # Still one notice for this delivery, without what could not be read.
                self.notice(watch, {"event": "delivery", "change": change, "error": error},
                            "delivery unavailable (%s)  [%s]" % (error.get("code"), identity))
                return
            item = result["item"]
            self.notice(watch, {"event": "delivery", "change": change, "item": item},
                        self.delivery_line(item) + ("" if item["state"] == "pending" else "  (%s)" % item["state"]))
            return
        self.notice(watch, {"event": "change", "change": change},
                    "acknowledged %s" % identity if kind == "delivery" and version == 2 else "change %s %s v%s" % (kind, identity, version))


PATH_OPTIONS = {"profile", "broker", "outbox", "outbox_after", "out", "file", "attach"}


def _utf8_arguments(options):
    """Text from argv is UTF-8; bytes that are not arrive as lone surrogates and are refused before anything is saved."""
    for name, value in vars(options).items():
        for item in (value if isinstance(value, list) else [value]):
            if name not in PATH_OPTIONS and isinstance(item, str):
                try:
                    item.encode("utf-8")
                except UnicodeError as error:
                    raise InvalidRequest() from error


def _selected_profile(options):
    if options.broker:
        from .hosted_cli import RemoteProfile
        return RemoteProfile.connect(options.broker)
    profile = load_profile(options.profile)
    profile.store().observe_cli(profile.actor_id)
    return profile


def _agent_verb(options, stdin, stdout, stderr):
    lines = Lines(stdout, stderr, options.json or options.json_after)
    agent = None

    def attempt(code, message, retryable=False):
        lines.raw(_attempt(code, message, retryable))
        lines.problem("%s: %s" % (code, message))
        return 75 if retryable else 2

    def unconfirmed(code):
        # The saved request is the way back: an exact retry returns its
        # recorded outcome, or sends it once if nothing was recorded.
        operation = agent and agent.operation
        _diagnostic(stderr, "%s: %s." % (code, "operation %s may be recorded; `retry %s` returns its outcome without sending it twice" % (
            operation, operation) if operation else "reconcile the original operation before retrying"))
    try:
        try:
            _utf8_arguments(options)
            agent = Agent(_selected_profile(options), options, stdin, lines)
            getattr(agent, "do_" + options.verb.replace("-", "_"))()
            agent.show_work_context()
            return agent.exit
        except BrokerFailure as error:
            if error.exit_code != 1:
                lines.raw(_attempt(error.code, error.message, error.retryable))
            lines.problem('%s: %s' % (error.code, error.message))
            if error.exit_code == 1 and agent is not None and agent.operation:
                unconfirmed(error.code)
            return error.exit_code
        except Refusal as error:
            return attempt(error.code, error.message)
        except InvalidRequest:
            return attempt("INVALID_REQUEST", "Use bounded UTF-8 text, or a saved request with an exact binding.")
        except (ProfileError, AuthorityError, StoreOpenError) as error:
            code = error.code or "PROFILE_UNAVAILABLE"
            message = str(error) if code == "SCHEMA_MISMATCH" else "The explicit profile or authority is unavailable; preserve the original binding."
            return attempt(code, message, error.retryable)
    except Failed as failed:
        return failed.code
    except OutputFailed:
        unconfirmed("CLI_OUTPUT_UNCONFIRMED")
        _quiesce_failed_stream(stdout)
        return 1
    except (StoreError, OSError):
        unconfirmed("CLI_REQUEST_UNCONFIRMED")
        return 1
    except KeyboardInterrupt:
        unconfirmed("CLI_INTERRUPTED")
        return 130


def main(argv=None, *, stdin=None, stdout=None, stderr=None):
    stdin = sys.stdin.buffer if stdin is None else stdin
    stdout = sys.stdout if stdout is None else stdout
    stderr = sys.stderr if stderr is None else stderr
    if (sys.argv[1:] if argv is None else list(argv)) == ['--hosted-activity-version']:
        stdout.write('1\n')
        return 0
    parser = _parser()
    try:
        options = parser.parse_args(argv)
        selected = options.broker if options.broker is not None else options.profile
        if not selected or not Path(selected).is_absolute():
            raise UsageError()
        if options.verb not in LEGACY_VERBS:
            return _agent_verb(options, stdin, stdout, stderr)
        if options.json or options.outbox is not None or (options.verb == "binding") != (options.request is None):
            raise UsageError()
        profile = _selected_profile(options)
        if options.verb == "binding":
            result, code = {"v": 1, "binding": _binding(profile)}, 0
        else:
            value = _input(options.request, stdin)
            inner = _request(value, options.verb)
            if value["binding"] != _binding(profile):
                result, code = _attempt("BINDING_MISMATCH", "Retain the original request and select its exact binding."), 2
            else:
                store = profile.store()
                if options.verb == "command":
                    result = store.command(profile.actor_id, inner)
                else:
                    result = store.view(profile.actor_id, inner["name"], inner["args"])
                code = _exit_code(result, options.verb, inner)
        return _output(stdout, stderr, result, code)
    except UsageError:
        _diagnostic(stderr, USAGE)
        return 2
    except InvalidRequest:
        return _output(stdout, stderr, _attempt("INVALID_REQUEST", "Use one bounded finite UTF-8 JSON request with an exact binding."), 2)
    except BrokerFailure as error:
        if error.exit_code == 1:
            _diagnostic(stderr, '%s: %s; retain the original operation for reconciliation.' % (error.code,error.message))
            return 1
        return _output(stdout, stderr, _attempt(error.code, error.message, error.retryable), error.exit_code)
    except (ProfileError, AuthorityError, StoreOpenError) as error:
        code = error.code or "PROFILE_UNAVAILABLE"
        message = str(error) if code == "SCHEMA_MISMATCH" else "The explicit profile or authority is unavailable; preserve the original binding."
        return _output(stdout, stderr, _attempt(code, message, error.retryable),
                       75 if error.retryable else 2)
    except (StoreError, OSError):
        _diagnostic(stderr, "CLI_REQUEST_UNCONFIRMED: reconcile the original operation before retrying.")
        return 1
    except KeyboardInterrupt:
        _diagnostic(stderr, "CLI_INTERRUPTED: reconcile the original operation before retrying.")
        return 130


if __name__ == "__main__":
    sys.exit(main())

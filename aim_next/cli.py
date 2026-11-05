from __future__ import annotations

"""Explicit local Store calls; transport success never acknowledges delivery."""

import argparse
import json
import os
from pathlib import Path
import re
import stat
import sys
import uuid

from .authority import AuthorityError
from .contract import LIMITS, StoreError
from .effects_watch import NativeWatch, WatchError, WatchStopped
from .profile import ProfileError, load_profile
from .store import StoreOpenError


class InvalidRequest(ValueError):
    pass


class UsageError(ValueError):
    pass


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
USAGE = ("usage: aim-next --profile /absolute/profile.json [--json] [--outbox DIR] "
         "{binding | view FILE|- | command FILE|- | outcomes | topics OUTCOME | read TOPIC [--after SEQ] [--limit N] "
         "| inbox | post TOPIC [--to A,B] [--reply-to MESSAGE] TEXT|- | start OUTCOME --title TITLE [--with A,B] TEXT|- "
         "| publish OPENING | ack DELIVERY... | read-through TOPIC SEQ | watch | retry OPERATION}")
SAFE_NAME = re.compile(r"[A-Za-z0-9][A-Za-z0-9._@-]{0,199}")
# C0 controls other than tab, DEL and C1 controls: terminal instructions, not text.
CONTROL = re.compile("[\x00-\x08\x0a-\x1f\x7f-\x9f]")
C1 = re.compile("[\x7f-\x9f]")


def _parser():
    parser = Parser(prog="aim-next", add_help=False)
    parser.add_argument("--profile", required=True)
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
    verb("outcomes")
    verb("topics").add_argument("outcome")
    read = verb("read")
    read.add_argument("topic")
    read.add_argument("--after", type=int, default=0)
    read.add_argument("--limit", type=int, default=LIMITS["page_default"])
    verb("inbox")
    post = verb("post")
    post.add_argument("topic")
    post.add_argument("--to", default="")
    post.add_argument("--reply-to")
    post.add_argument("text")
    start = verb("start")
    start.add_argument("outcome")
    start.add_argument("--title", required=True)
    start.add_argument("--with", dest="participants", default="")
    start.add_argument("text")
    verb("publish").add_argument("opening")
    verb("ack").add_argument("deliveries", nargs="+")
    through = verb("read-through")
    through.add_argument("topic")
    through.add_argument("seq", type=int)
    verb("watch")
    verb("retry").add_argument("operation")
    return parser


def _names(value):
    return [name.strip() for name in value.split(",") if name.strip()]


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


class Agent:
    """The everyday verbs: each builds its envelopes, saves each request before dispatch."""

    def __init__(self, profile, options, stdin, lines):
        self.profile, self.options, self.stdin, self.out = profile, options, stdin, lines
        self.actor = profile.actor_id
        self.binding = _binding(profile)
        self.store = profile.store()
        self.exit = 0
        # The saved request being sent, named by every unconfirmed outcome.
        self.operation = None

    # Reads -----------------------------------------------------------------

    def view(self, name, args):
        result = self.store.view(self.actor, name, args)
        self.out.raw(result)
        if result.get("error"):
            self.fail(result["error"])
        return result

    def pages(self, name, args):
        cursor, items = None, []
        while True:
            page = self.view(name, dict(args, **({} if cursor is None else {"cursor": cursor})))
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
            directory = Path(self.options.profile).parent / (self.actor + ".outbox")
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

    def dispatch(self, directory, request):
        envelope = request["command"]
        self.operation = envelope["operation_id"]
        receipt = self.store.command(self.actor, envelope)
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

    def command(self, kind, target, args, expected=None):
        directory = self.outbox()
        envelope = {"v": 1, "instance_id": self.profile.instance_id, "operation_id": "cli-" + uuid.uuid4().hex,
                    "kind": kind, "target": target, "args": args,
                    "expected": dict(expected or {}, authority={key: self.binding[key] for key in ("authority_id", "authority_epoch")})}
        request = {"v": 1, "binding": self.binding, "command": envelope}
        try:
            self._save_request(directory, envelope["operation_id"], request)
        except OSError:
            self.unsent("the request could not be saved")
        self.operation = envelope["operation_id"]
        return self.dispatch(directory, request)

    def text(self):
        if self.options.text != "-":
            return self.options.text
        cap = LIMITS["body_utf8_bytes"]
        raw = bytearray()
        while len(raw) <= cap:
            chunk = self.stdin.read(min(65536, cap + 1 - len(raw)))
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
        items = self.pages("workspaces", {})
        for item in items:
            self.out.plain("%s  %s  (owner %s)" % (item["id"], _one_line(item["title"]), item["owner_id"]))
        if not items:
            self.out.plain("no outcomes")

    def do_topics(self):
        items = self.pages("workspace_topics", {"workspace_id": self.options.outcome})
        items.sort(key=lambda item: (-(item.get("latest_seq") or 0), item["id"]))
        for item in items:
            self.out.plain("%s  %s  (%s messages, latest #%s)" % (
                item["id"], _one_line(item["title"]), item.get("message_count") or 0, item.get("latest_seq") or "-"))
        if not items:
            self.out.plain("no topics")

    def do_read(self):
        options = self.options
        topic = self.view("topic", {"topic_id": options.topic})["topic"]
        page = self.view("topic_messages", {"topic_id": options.topic, "cursor": options.after, "limit": options.limit})
        self.out.plain("%s  %s" % (topic["id"], _one_line(topic["title"])))
        for item in page["items"]:
            body = item["body"]
            if item["preview"]:
                body = self.view("source", {"source_ref": {"kind": "message", "id": item["id"]}})["body"]
            heading = "#%s %s %s" % (item["seq"], item["id"], item["author_id"])
            if item["addressees"]:
                heading += " to " + ", ".join(item["addressees"])
            if item["reply_to"]:
                heading += " replying to " + item["reply_to"]
            self.out.plain("")
            self.out.plain(heading)
            for line in body.split("\n"):
                self.out.plain("  " + line)
        if page["next_cursor"] is not None:
            self.out.plain("")
            self.out.plain("more after #%s: read %s --after %s" % (page["next_cursor"], options.topic, page["next_cursor"]))
        elif not page["items"]:
            self.out.plain("no messages after #%s" % options.after)

    @staticmethod
    def delivery_line(item):
        message = item["message"]
        return 'delivery "%s" #%s %s: %s  [%s in %s]' % (
            _one_line(item["topic"]["title"], 60), message["seq"], message["author_id"],
            _one_line(message["body"]), item["id"], message["topic_id"])

    def do_inbox(self):
        items = sorted(self.pages("deliveries", {}), key=lambda item: item["seq"])
        for item in items:
            self.out.plain(self.delivery_line(item))
        if not items:
            self.out.plain("inbox empty")

    def do_post(self):
        options = self.options
        args = {"body": self.text(), "addressees": _names(options.to)}
        if options.reply_to:
            args["reply_to"] = options.reply_to
        result = self.command("message.post", {"topic_id": options.topic}, args)
        self.out.plain("posted %s in %s (%s deliveries queued)" % (result["message_id"], result["topic"]["id"], result["delivery"]["queued"]))

    def do_start(self):
        options = self.options
        opening, topic = "o-" + uuid.uuid4().hex, "t-" + uuid.uuid4().hex
        body = self.text()
        try:
            saved = self.command("opening.save", {"opening_id": opening}, {
                "workspace_id": options.outcome, "topic_id": topic, "title": options.title,
                "participants": _names(options.participants), "body": body, "attachments": []},
                {"opening_revision": 0})
        except BaseException as stopped:
            # Once the save request is saved, any end but a final refusal may
            # leave the save recorded (or recordable by `retry`), so the
            # opening and its topic are named for `publish`.
            if self.operation is not None and not (isinstance(stopped, Failed) and stopped.code == 2):
                _diagnostic(self.out.stderr, "start: " + self.publish_hint(opening, topic))
            raise
        try:
            result = self.command("opening.publish", {"opening_id": opening}, {}, {"opening_revision": saved["opening_revision"]})
        except BaseException as stopped:
            # The save is recorded, so the opening stays whatever ends the publish.
            if isinstance(stopped, Failed) and stopped.code == 2:
                hint = "opening %s stays unpublished: Core refused its publish." % opening
            elif isinstance(stopped, Failed) and stopped.recorded:
                hint = "the publish of opening %s was recorded; `publish %s` reports whether it started topic %s." % (opening, opening, topic)
            else:
                hint = self.publish_hint(opening, topic, recorded=True)
            _diagnostic(self.out.stderr, "start: " + hint)
            raise
        self.out.plain('started %s "%s" in %s with %s' % (topic, _one_line(options.title, 60), options.outcome, result["message_id"]))

    @staticmethod
    def publish_hint(opening, topic, recorded=False):
        return "opening %s will start topic %s; %s`publish %s` starts it." % (
            opening, topic, "" if recorded else "once its save is recorded, ", opening)

    def do_publish(self):
        opening = self.view("opening", {"opening_id": self.options.opening})["opening"]
        if opening["state"] == "published":
            self.out.plain("already published %s as %s with %s" % (opening["id"], opening["topic_id"], opening["message_id"]))
            return
        result = self.command("opening.publish", {"opening_id": opening["id"]}, {}, {"opening_revision": opening["revision"]})
        self.out.plain('started %s "%s" in %s with %s' % (opening["topic_id"], _one_line(opening.get("title", ""), 60),
                                                          opening["workspace_id"], result["message_id"]))

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

    def do_retry(self):
        operation = self.options.operation
        if not SAFE_NAME.fullmatch(operation):
            raise UsageError()
        directory = self.outbox()
        request = _input(str(directory / (operation + ".request.json")), None)
        envelope = _request(request, "command")
        if request["binding"] != self.binding or envelope["operation_id"] != operation:
            self.refuse("BINDING_MISMATCH", "This saved request belongs to another binding or operation")
        result = self.dispatch(directory, request)
        self.out.plain("recorded %s (%s)" % (operation, envelope["kind"]))
        if envelope["kind"] == "opening.save":
            self.out.plain(self.publish_hint(envelope["target"].get("opening_id"), envelope["args"].get("topic_id"), recorded=True))
        return result

    def do_watch(self):
        try:
            # The authority anchor is watched as well: a recovery activation
            # replaces it and never writes this database again.
            watch = NativeWatch(self.profile.db_path, companions=(self.profile.authority_path,))
        except WatchError as error:
            self.refuse("WATCH_UNAVAILABLE", "The native database watch is unavailable (%s)" % error)
        try:
            self.watch_changes(watch)
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

    def watch_changes(self, watch):
        # The watch is armed before the baseline, so a write after the
        # checkpoint always produces another event.
        page = self.changes(watch, None)
        if page is None:
            return
        cursor = page["checkpoint"]
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
                    self.report(watch, change)
                if not page["has_more"]:
                    cursor = page["checkpoint"]
                    break
                cursor = page["continuation"]
            if watch.companion_moved:
                raise WatchError("authority_anchor_replaced")
            if watch.stopped:
                return

    def report(self, watch, change):
        kind, identity, version = change["resource_kind"], change["resource_id"], change["version"]
        if kind == "delivery" and version == 1:
            result = self.read(watch, "delivery", {"delivery_id": identity})
            error = result.get("error")
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


PATH_OPTIONS = {"profile", "outbox", "outbox_after"}


def _utf8_arguments(options):
    """Text from argv is UTF-8; bytes that are not arrive as lone surrogates and are refused before anything is saved."""
    for name, value in vars(options).items():
        for item in (value if isinstance(value, list) else [value]):
            if name not in PATH_OPTIONS and isinstance(item, str):
                try:
                    item.encode("utf-8")
                except UnicodeError as error:
                    raise InvalidRequest() from error


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
            agent = Agent(load_profile(options.profile), options, stdin, lines)
            getattr(agent, "do_" + options.verb.replace("-", "_"))()
            return agent.exit
        except InvalidRequest:
            return attempt("INVALID_REQUEST", "Use bounded UTF-8 text, or a saved request with an exact binding.")
        except (ProfileError, AuthorityError, StoreOpenError) as error:
            return attempt(error.code or "PROFILE_UNAVAILABLE",
                           "The explicit profile or authority is unavailable; preserve the original binding.", error.retryable)
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
    parser = _parser()
    try:
        options = parser.parse_args(argv)
        if not Path(options.profile).is_absolute():
            raise UsageError()
        if options.verb not in LEGACY_VERBS:
            return _agent_verb(options, stdin, stdout, stderr)
        if options.json or options.outbox is not None or (options.verb == "binding") != (options.request is None):
            raise UsageError()
        profile = load_profile(options.profile)
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

from __future__ import annotations

"""The host side of hosted Codex agents (design §2-§3, §5-§6).

The effects runner process owns one `codex app-server` child per CODEX_HOME,
talks newline-delimited JSON-RPC to it, answers every server request at once,
keeps each pinned thread's state from notifications, and turns each claim
into one `turn/start` or `turn/steer`. Nothing here waits on a timer: the
caller's kqueue reports child output and child exits, and every step resumes
from the response or notification it waits for.
"""

import argparse
from datetime import datetime, timezone
import errno
import json
import os
from pathlib import Path
import re
import select
import signal
import stat
import subprocess
import time
from dataclasses import replace

from . import broker_routes, hosted_notice
from .hosted_cli import HostedCLI
from .hosted_permissions import (permission_profile, validate_workspace, startup_overrides,
                                 proxy_configuration, proxy_probe, proxy_result)
from .codex_broker import handshake_refusal
from .profile import load_profile
from .route_pins import HOSTED_KIND
from .runner import CLIENT_PREFIX


CLIENT = "theseus_host"
MAX_MESSAGE = 8 * 1024 * 1024
# Bytes a child may leave unread on its input. Past this it has stopped
# reading, so nothing more can reach it and it is ended by its captured PID.
MAX_OUTBOX = 2 * MAX_MESSAGE
READ_BLOCK = 65536
STOP_GRACE_SECONDS = 5.0
TERM_GRACE_SECONDS = 5.0
SPAWN_PATH = "/usr/bin:/bin:/usr/sbin:/sbin"

# Choices that wait on a live probe (design §10). Each is the conservative
# option the design names; the probe that settles it is named beside it.
# P15: which methods need experimentalApi. On until shown unnecessary, so
# turn/steer, additionalContext and thread/turns/list are not refused.
EXPERIMENTAL_API = True
# Capability policy belongs to each pinned route, not the shared child.
SPAWN_OVERRIDES = ()
# P2: whether developerInstructions persist across an app-server restart.
RESEND_INSTRUCTIONS_ON_RESUME = True
# P4: the error text of a steer refused because no turn is active or the id is
# stale. A steer also counts as refused when the host has already seen the
# expected turn end. Either falls back to turn/start once.
STEER_REFUSAL = re.compile(r"no active turn|not active|no turn|expected ?turn|turn ?id|mismatch|stale", re.IGNORECASE)
# P8: an in-progress turn that a freshly spawned child lists for a thread it
# does not report active belongs to a process that is gone. It is recorded as
# lost, and Core re-arms its work.
ORPHANED_IN_PROGRESS = "lost"
LAST_TURN = {"limit": 1, "sortDirection": "desc"}
# P5(b): a steer answered after the host saw its turn end may have been
# dropped. Conservative until the probe runs: the steer is recorded, its turn's
# end is applied to it, and Core re-arms it as an unseen steer; the host never
# guesses a second turn/start for it.
LATE_STEER_REARMS = True
# P12: after this many consecutive contextWindowExceeded turns, the next
# dispatch compacts the thread once first.
COMPACT_AFTER = 2
# P12/§9.2: a turn's tokens are the `last` breakdown of its latest
# thread/tokenUsage/updated, as the design specifies.
OPT_OUT = ["item/agentMessage/delta", "item/reasoning/textDelta", "item/reasoning/summaryTextDelta",
           "item/commandExecution/outputDelta", "item/fileChange/outputDelta", "item/plan/delta",
           "command/exec/outputDelta", "process/outputDelta"]

# Server requests are answered at once, from the same loop (design §3.6).
ANSWERS = {
    "item/commandExecution/requestApproval": ("decline", {"decision": "decline"}),
    "item/fileChange/requestApproval": ("decline", {"decision": "decline"}),
    "item/permissions/requestApproval": ("grant_nothing", {"permissions": {}, "scope": "turn"}),
    "mcpServer/elicitation/request": ("decline", {"action": "decline", "content": None}),
    "item/tool/call": ("not_available", {"contentItems": [{"type": "inputText", "text": "not available"}], "success": False}),
}
KNOWN_REQUESTS = frozenset(ANSWERS) | {"item/tool/requestUserInput", "currentTime/read", "account/chatgptAuthTokens/refresh", "attestation/generate",
                                       "applyPatchApproval", "execCommandApproval"}
UNSUPPORTED = {"code": -32601, "message": "not supported by theseus host"}
TOKEN_FIELDS = (("inputTokens", "input_tokens"), ("cachedInputTokens", "cached_input_tokens"),
                ("outputTokens", "output_tokens"), ("reasoningOutputTokens", "reasoning_output_tokens"))
TURN_END = frozenset(("completed", "interrupted", "failed"))
# How a claim fails when the Codex process serving its thread ends: it exited, or was ended for an
# answer Theseus does not understand. Either way every turn that process ran ends lost.
PROCESS_ENDED = frozenset(("child_exited", "protocol_error"))
# The schema's ThreadStatus types; any other value is kept and logged only as "other".
THREAD_STATUSES = frozenset(("idle", "active", "systemError", "notLoaded"))
# The error a request gets when its child is gone before answering.
GONE = {"code": None, "message": "child gone", "gone": True}


class HostFault(Exception):
    """The runner must pause with this fixed reason; nothing of the child's text escapes."""

    def __init__(self, reason):
        self.reason = reason
        super().__init__(reason)


class ProtocolError(Exception):
    """The child broke the framing or a response shape; it is closed, never trusted again."""


def answer(request):
    """(label, response) for one server request; every request gets exactly one response."""
    method = request["method"]
    if method == "item/tool/requestUserInput":
        return "ask_in_theseus", {"id": request["id"], "error": {
            "code": -32601,
            "message": "No answer was supplied. Ask the person in Theseus using your bound CLI: post TOPIC --asks PERSON --reply-to MESSAGE --ask-wait JSON --quote-revision N --quote-start S --quote-end E -. Choose the actual raw-Markdown passage and current revision from source (offsets count Unicode code points), or use --without-quote REASON to explain its omission. Core inserts the quote or reason. Read `cover MESSAGE` first; JSON names root_id, cover_revision and questions [{actor_id,text,options,default,reason}]. Supply literal choices/default; explicitly use []/null with a reason when none are offered or promised. Read the post back, acknowledge the handled delivery separately, and finish this turn. Their reply arrives as a new delivery in this same saved thread. Never assume consent or an answer."}}
    if method in ANSWERS:
        label, result = ANSWERS[method]
        return label, {"id": request["id"], "result": result}
    if method == "currentTime/read":
        return "current_time", {"id": request["id"], "result": {"currentTimeAt": int(time.time())}}
    return "unsupported", {"id": request["id"], "error": dict(UNSUPPORTED)}


def error_code(error):
    """The codexErrorInfo key of a turn or RPC error, or None; never its message."""
    info = error.get("codexErrorInfo") if isinstance(error, dict) else None
    if isinstance(info, dict) and len(info) == 1:
        info = next(iter(info))
    if isinstance(info, str) and 0 < len(info) <= 64 and info.isascii() and info.replace("_", "").isalnum():
        return info
    return None


def _rpc_info(error):
    data = error.get("data") if isinstance(error, dict) else None
    return error_code(data) if isinstance(data, dict) else None


def _not_steerable(error):
    return _rpc_info(error) == "activeTurnNotSteerable" or error_code(error) == "activeTurnNotSteerable"


def _refuses_pin(error):
    """A resume refusal that means the pinned thread is not this one to continue (design §3.4)."""
    data = error.get("data")
    message = error.get("message")
    return ((isinstance(data, dict) and data.get("type") == "modelProviderMismatch")
            or (isinstance(message, str) and ("not found" in message.lower()
                or message.lower().startswith("no rollout found for thread id "))))


def _thread_status(status):
    """The closed set of thread status types; nothing else the child says reaches state or the log."""
    if status is None:
        return None
    kind = status.get("type") if type(status) is dict else None
    return kind if isinstance(kind, str) and kind in THREAD_STATUSES else "other"


def _string(value):
    if not isinstance(value, str) or not value or len(value) > 200 or any(ord(c) < 32 for c in value):
        raise ProtocolError("invalid_identifier")
    return value


def _now_iso():
    return datetime.now(timezone.utc).isoformat()


class HostLog:
    """The private JSON-lines event log (design §4.5): fixed fields only, no bodies or notification text."""

    def __init__(self, directory, emit=None):
        self.directory = _private_directory(directory)
        self.emit = emit or (lambda event: None)
        self.fd = _private_append(self.directory / "events.jsonl")
        self.stderr = _private_append(self.directory / "codex-stderr.log")

    def write(self, kind, **fields):
        line = dict(fields, event=kind, at_ms=int(time.time() * 1000))
        data = (json.dumps(line, separators=(",", ":"), sort_keys=True) + "\n").encode("utf-8")
        os.write(self.fd, data)
        self.emit(dict(fields, event="host_" + kind))

    def close(self):
        for fd in (self.fd, self.stderr):
            if fd is not None:
                os.close(fd)
        self.fd = self.stderr = None


def _private_directory(value):
    path = Path(value)
    if not path.is_absolute():
        raise broker_routes.BrokerConfigError("invalid_host_dir")
    try:
        info = os.lstat(str(path))
    except OSError as error:
        raise broker_routes.BrokerConfigError("invalid_host_dir") from error
    if not stat.S_ISDIR(info.st_mode) or info.st_uid != os.getuid() or info.st_mode & 0o077:
        raise broker_routes.BrokerConfigError("invalid_host_dir")
    return path


def _private_append(path):
    fd = os.open(str(path), os.O_WRONLY | os.O_APPEND | os.O_CREAT | os.O_NOFOLLOW | os.O_CLOEXEC, 0o600)
    info = os.fstat(fd)
    if not stat.S_ISREG(info.st_mode) or info.st_uid != os.getuid() or info.st_mode & 0o077:
        os.close(fd)
        raise broker_routes.BrokerConfigError("invalid_host_dir")
    return fd


class Child:
    """One app-server process and its framing. Its PID is captured at spawn and never looked up again."""

    def __init__(self, home, executable, stderr, writable=lambda child, on: None, *, inherited_fds=(), overrides=()):
        environment = {key: os.environ[key] for key in ("HOME", "LANG", "TMPDIR") if key in os.environ}
        environment.update(PATH=SPAWN_PATH, CODEX_HOME=home)
        self.home = home
        self.started_at = _now_iso()
        # No shell, the runner's own process group, no inherited descriptors.
        self.popen = subprocess.Popen([executable, "app-server", "--listen", "stdio://", *SPAWN_OVERRIDES, *overrides],
                                      stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=stderr, shell=False,
                                      env=environment, close_fds=True, pass_fds=inherited_fds, bufsize=0, start_new_session=False)
        self.pid = self.popen.pid
        self.out = self.popen.stdout.fileno()
        os.set_blocking(self.out, False)
        # Input is written as the child reads it: a child that stops reading
        # never blocks the loop that serves leases and stop signals.
        self.input = self.popen.stdin.fileno()
        os.set_blocking(self.input, False)
        self.outbox = bytearray()
        # writable(child, on) asks the caller's kqueue to report input space.
        self.writable, self.write_watched = writable, False
        self.buffer = bytearray()
        self.next_id = 0
        self.waiting = {}
        self.state = "initializing"
        self.child_id = None
        self.ready_waiters = []
        # Threads whose attach began after this child was ended; they attach to its successor.
        self.successors = []
        # Set when a lease ended with a request unanswered: the highest request ID
        # sent by then. A response to any later request is the child's recovery.
        self.suspect = None
        self.eof = False
        # Set once NOTE_EXIT is being handled: its end of output is the exit's, not a fault.
        self.exiting = False
        self.signals = set()
        self.kill_at = None
        self.backlogged = False

    @property
    def open(self):
        return self.popen.stdin is not None and not self.popen.stdin.closed

    def send(self, message):
        """Queue one whole message and write what the input takes now; False if it can never be delivered."""
        data = (json.dumps(message, separators=(",", ":"), ensure_ascii=False, allow_nan=False) + "\n").encode("utf-8")
        if len(data) > MAX_MESSAGE:
            raise ProtocolError("message_too_large")
        if not self.open:
            return False
        if len(self.outbox) + len(data) > MAX_OUTBOX:
            self.backlogged = True
            self.close_input()
            self.signal(signal.SIGTERM)
            return False
        self.outbox.extend(data)
        self.flush()
        return self.open

    def flush(self):
        """Write queued input until the pipe is full; a partial frame stays at the head, so framing holds."""
        while self.outbox and self.open:
            try:
                written = os.write(self.input, self.outbox)
            except (BlockingIOError, InterruptedError):
                break
            except (BrokenPipeError, ConnectionResetError):
                self.close_input()
                return
            del self.outbox[:written]
        wanted = bool(self.outbox) and self.open
        if wanted != self.write_watched:
            self.write_watched = wanted
            self.writable(self, wanted)

    def request(self, method, params, handler):
        """Send one request; handler(result, error) runs once with its response, or with GONE."""
        self.next_id += 1
        request_id = self.next_id
        self.waiting[request_id] = handler
        if not self.send({"id": request_id, "method": method, "params": params}):
            self.waiting.pop(request_id, None)
            handler(None, GONE)
        return request_id

    def notify(self, method, params):
        self.send({"method": method, "params": params})

    def close_input(self):
        if self.open:
            self.outbox.clear()
            if self.write_watched:
                # Unwatched before its descriptor closes.
                self.write_watched = False
                self.writable(self, False)
            try:
                self.popen.stdin.close()
            except OSError:
                pass

    def read(self):
        """Every complete message available now; sets eof when the stream ended."""
        messages = []
        while not self.eof:
            try:
                block = os.read(self.out, READ_BLOCK)
            except (BlockingIOError, InterruptedError):
                break
            if not block:
                self.eof = True
                break
            self.buffer.extend(block)
            while True:
                newline = self.buffer.find(b"\n")
                if newline < 0:
                    break
                raw = bytes(self.buffer[:newline])
                del self.buffer[:newline + 1]
                if raw.strip():
                    messages.append(_decode(raw))
            if len(self.buffer) > MAX_MESSAGE:
                raise ProtocolError("message_too_large")
        return messages

    def signal(self, number):
        # The child is un-reaped until its exit is handled, so its PID cannot
        # have been reused: this signals exactly the process this host started.
        if self.popen.returncode is None and number not in self.signals:
            self.signals.add(number)
            try:
                os.kill(self.pid, number)
            except ProcessLookupError:
                pass


def _decode(raw):
    if len(raw) > MAX_MESSAGE:
        raise ProtocolError("message_too_large")
    try:
        value = json.loads(raw.decode("utf-8"), object_pairs_hook=_unique, parse_constant=_constant)
    except (ValueError, UnicodeError, RecursionError) as error:
        raise ProtocolError("invalid_json") from error
    if type(value) is not dict:
        raise ProtocolError("invalid_message")
    return value


def _unique(pairs):
    value = {}
    for key, item in pairs:
        if key in value:
            raise ValueError("duplicate field")
        value[key] = item
    return value


def _constant(unused):
    raise ValueError("non-finite number")


def _kind(message):
    """'request', 'notification' or 'response', with its exact shape checked."""
    method, has_id = message.get("method"), "id" in message
    if method is not None:
        if not isinstance(method, str) or not method:
            raise ProtocolError("invalid_method")
        if has_id and (type(message["id"]) not in (int, str)):
            raise ProtocolError("invalid_id")
        return "request" if has_id else "notification"
    if not has_id or ("result" in message) == ("error" in message):
        raise ProtocolError("invalid_response")
    if type(message["id"]) not in (int, str):
        raise ProtocolError("invalid_id")
    if "error" in message and (type(message["error"]) is not dict or not isinstance(message["error"].get("message"), str)):
        raise ProtocolError("invalid_error")
    return "response"


def initialize_params():
    return {"clientInfo": {"name": CLIENT, "title": "Theseus host", "version": "1"},
            "capabilities": {"experimentalApi": EXPERIMENTAL_API, "optOutNotificationMethods": list(OPT_OUT)}}


def initialized_refusal(result, error, home):
    """Why a child's initialize answer is refused, or None: the broker's guard (codex_broker.handshake_refusal),
    this exact reviewed Codex version on the pinned home. The code it gives (another version, with the version
    found and the one reviewed; another home; a shape it does not accept) is the reason the claims on that home
    settle with, so Health says it; an error answer is "incompatible"."""
    return "incompatible" if error is not None else handshake_refusal(result, CLIENT, home)


def signed_in(result):
    return type(result) is dict and (result.get("requiresOpenaiAuth") is False or type(result.get("account")) is dict)


def _broker_endpoint(config, endpoint=None):
    if endpoint is not None:
        return endpoint
    # Provisioning creates no model turn. The first runtime resume replaces
    # this non-listening placeholder with its host-owned endpoint.
    import hashlib
    return '/private/tmp/theseus-provision-' + hashlib.sha256(config.profile_path.encode()).hexdigest()[:16] + '.sock'


def thread_settings(config, endpoint=None):
    """Thread-level settings, identical on thread/start (provisioning) and thread/resume (design §3.3-3.4)."""
    roots = list(config.writable_roots)
    settings = {"cwd": config.cwd, "approvalPolicy": "never", "approvalsReviewer": "user", "sandbox": "workspace-write",
                "config": {"sandbox_workspace_write": {"writable_roots": roots, "network_access": False,
                                                       "exclude_slash_tmp": True, "exclude_tmpdir_env_var": True},
                           "agents": {"enabled": False}},
                "developerInstructions": hosted_notice.developer_instructions(config.profile.actor_id, config.cli, config.profile_path)}
    if getattr(config, "permission_mode", "workspace") == "full":
        settings["sandbox"] = "danger-full-access"
        settings["config"] = {"agents": {"enabled": True}}
    else:
        endpoint = _broker_endpoint(config, endpoint)
        name, policy = permission_profile(config, endpoint)
        settings.pop('sandbox')
        settings['permissions'] = name
        settings['config'] = {'permissions': {name: policy}, 'features': {'network_proxy': True}, 'agents': {'enabled': False}}
        settings['developerInstructions'] = hosted_notice.developer_instructions(config.profile.actor_id, config.cli, config.profile_path, endpoint)
    effort = getattr(config, "reasoning_effort", None)
    if effort is not None:
        settings["config"]["model_reasoning_effort"] = effort
    instructions = getattr(config, "instructions", "")
    if instructions:
        settings["developerInstructions"] += "\n\nStanding role:\n" + instructions
    if config.model is not None:
        settings["model"] = config.model
    return settings


def settings_applied(result, cwd, roots, permission_mode="workspace", model=None, effort=None, permissions=None, proxy_verified=False):
    """Whether a thread/start or thread/resume answer echoes exactly the settings sent (design §3.3-3.4).

    Named profiles carry read carveouts that the legacy sandbox projection
    cannot express. Require the host-authored profile identity, its workspace
    parent and the exact outbox write-root projection observed on this version.
    """
    if type(result) is not dict:
        return False
    if model is not None and result.get("model") != model or effort is not None and result.get("reasoningEffort") != effort:
        return False
    sandbox = result.get("sandbox")
    if type(sandbox) is not dict:
        return False
    if permission_mode == "full":
        return result.get("approvalPolicy") == "never" and result.get("cwd") == cwd and sandbox.get("type") == "dangerFullAccess"
    echoed = sandbox.get("writableRoots")
    selected = result.get('activePermissionProfile')
    return (result.get("approvalPolicy") == "never" and result.get("cwd") == cwd and sandbox.get("type") == "workspaceWrite"
            and proxy_verified is True and permissions is not None and selected == {'id': permissions, 'extends': ':workspace'}
            and type(echoed) is list and all(isinstance(root, str) for root in echoed) and set(echoed) == {roots[-1]}
            and sandbox.get("networkAccess") is True and sandbox.get("excludeSlashTmp") is True
            and sandbox.get("excludeTmpdirEnvVar") is True)


def sandbox_policy(config):
    if getattr(config, "permission_mode", "workspace") != "full":
        raise ValueError('workspace_routes_require_named_permissions')
    return {"type": "dangerFullAccess"}


class HostedThread:
    """One pinned thread. Its state changes only from responses and notifications."""

    def __init__(self, actor, config):
        self.actor, self.config = actor, config
        self.id = config.destination["thread_id"]
        self.home = config.destination["codex_home"]
        self.bridge = None
        self.proxy_verified, self.applied_mode = False, None
        self.applied_permissions = None
        self.attached = self.attaching = False
        self.waiters = []
        self.status = None
        self.active_turn = None
        self.uncertain = False
        self.usage, self.cli_calls = {}, {}
        self.interrupted = set()
        # (turn_id, status, error_code) of the last turn/completed, for an answer that arrives after it.
        self.last_end = None
        # An end or a seen marker Core could not place because the answer that
        # records the turn's handed row had not arrived; replayed when it does.
        self.early_ends, self.early_seen = {}, set()
        # Consecutive turns that ended contextWindowExceeded (design §6.1).
        self.context_failures = 0
        self.control_stopped = False
        self.control_stop_at = None


class Dispatch:
    def __init__(self, claim, thread, notice, started):
        self.claim, self.thread, self.notice, self.started = claim, thread, notice, started
        self.fallback = self.resumed = self.abandoned = self.settled = False
        # The turn this dispatch steers into is known running only from the thread's history.
        self.from_history = False
        self.client_id = CLIENT_PREFIX + claim["attempt_id"]


class Host:
    """All hosted threads of one runner process; the effects loop drives it from its kqueue."""

    def __init__(self, configs, *, core, settle, watch, log, monotonic, protected_homes=()):
        # settle(outcome, turn, reason, from_turn) records the current claim's
        # result at once, so the handed row exists before any later message of
        # the same read refers to it.
        self.core, self.settle, self.watch, self.log, self.monotonic = core, settle, watch, log, monotonic
        self.threads = {}
        self.executables = {}
        self.protected_homes = tuple(sorted(set(protected_homes) | {config.destination['codex_home'] for config in configs.values()}))
        for actor, config in sorted(configs.items()):
            config = replace(config, protected_homes=self.protected_homes)
            thread = HostedThread(actor, config)
            if self.executables.setdefault(thread.home, config.codex_executable) != config.codex_executable:
                raise broker_routes.BrokerConfigError("conflicting_codex_executable")
            self.threads[thread.id] = thread
        self.children = {}
        self.by_fd, self.by_pid, self.by_input = {}, {}, {}
        # While a child this host ended is handled as exited: its home's
        # interrupted attaches go to the successor.
        self.replacing = None
        self.current = None
        self.stopping = False
        self.inputs_closed = False
        self.stop_started = None

    # Startup and dispatch --------------------------------------------------

    def start(self):
        """Startup reattach: spawn each home's child and resume each pinned thread (design §3.4, §6.4)."""
        for thread in self.threads.values():
            self.ensure_thread(thread, lambda: None, lambda reason: None)

    def add_seat(self, config):
        """Adopt a newly pinned full-mode seat without replacing a child or another thread."""
        config = replace(config, protected_homes=self.protected_homes)
        identity, home = config.destination['thread_id'], config.destination['codex_home']
        if (self.stopping or config.permission_mode != 'full' or home not in self.executables
                or self.executables[home] != config.codex_executable):
            raise HostFault('route_binding_changed')
        existing = self.threads.get(identity)
        if existing is not None:
            if existing.actor != config.profile.actor_id or existing.config != config:
                raise HostFault('route_binding_changed')
            return
        if any(thread.actor == config.profile.actor_id for thread in self.threads.values()):
            raise HostFault('route_binding_changed')
        self.threads[identity] = HostedThread(config.profile.actor_id, config)

    def dispatch(self, claim, config, notice):
        """Hand one claim's notice to its thread; `settle` receives its outcome, now or from a later event."""
        thread = self.threads.get(config.destination["thread_id"])
        if thread is None or thread.actor != claim["recipient_id"]:
            raise HostFault("route_binding_changed")
        thread.config = replace(config, protected_homes=self.protected_homes)
        work = Dispatch(claim, thread, notice, self.monotonic())
        self.current = work
        self.ensure_thread(thread, lambda: self._prepare(work), lambda reason: self._settle(work, "unavailable", None, reason))

    def abandon(self):
        """The claim's lease ended first; a late response is logged and its thread re-read before the next dispatch.

        Each lease end is also the clock for a child that misbehaves; no other
        timer exists. A child that still holds unread input from this dispatch
        stopped reading for a whole lease, and one that left a request
        unanswered through a second lease, after the re-read that was its
        recovery chance, stopped answering: either is ended, so the dead
        claim's turn is never delivered late, and the next claim starts a fresh
        child. One still alive a lease after its TERM is killed."""
        if self.current is not None:
            work, self.current = self.current, None
            work.abandoned = True
            work.thread.uncertain = True
            self.log.write("dispatch_abandoned", attempt=work.claim["attempt_id"])
            child = self.children.get(work.thread.home)
            if child is None:
                return
            if child.state == "stalled":
                self.log.write("child_killed", pid=child.pid)
                child.signal(signal.SIGKILL)
            elif child.outbox:
                self.log.write("input_stalled", pid=child.pid, unread=len(child.outbox))
                self._end_child(child)
            elif child.waiting and child.suspect is None:
                child.suspect = child.next_id
                self.log.write("child_suspect", pid=child.pid, unanswered=len(child.waiting))
            elif child.waiting:
                self.log.write("child_unresponsive", pid=child.pid, unanswered=len(child.waiting))
                self._end_child(child)

    def _end_child(self, child):
        self._fail_child(child, "stalled")
        self._terminate(child)

    def _terminate(self, child):
        child.signal(signal.SIGTERM)
        if child.kill_at is None and signal.SIGKILL not in child.signals:
            child.kill_at = self.monotonic() + TERM_GRACE_SECONDS

    def apply_controls(self, controls):
        for thread in self.threads.values():
            value = controls.get(thread.actor)
            stopped = value is not None and value['desired'] == 'stopped'
            if stopped != thread.control_stopped:
                thread.control_stopped = stopped
                thread.control_stop_at = self.monotonic() if stopped else None
                self.log.write('control', thread=thread.id, desired='stopped' if stopped else 'running')
            if stopped:
                self._interrupt_controlled(thread)

    def _interrupt_controlled(self, thread):
        child = self.children.get(thread.home)
        turn = thread.active_turn
        if child is not None and child.state == 'ready' and turn is not None and turn not in thread.interrupted:
            thread.interrupted.add(turn)
            self.log.write('interrupt', thread=thread.id, turn=turn)
            child.request('turn/interrupt', {'threadId':thread.id, 'turnId':turn},
                          lambda result, error: None)

    def _control_busy(self, thread):
        return thread.active_turn is not None or thread.attaching or (self.current is not None and self.current.thread is thread)

    def next_deadline(self):
        deadlines = [child.kill_at for child in self.children.values() if child.kill_at is not None]
        deadlines.extend(thread.control_stop_at + STOP_GRACE_SECONDS for thread in self.threads.values()
                         if thread.control_stop_at is not None and self._control_busy(thread)
                         and thread.home in self.children and signal.SIGTERM not in self.children[thread.home].signals)
        if self.stop_started is not None and any(signal.SIGTERM not in child.signals for child in self.children.values()):
            deadlines.append(self.stop_started + STOP_GRACE_SECONDS)
        return min(deadlines) if deadlines else None

    def advance_deadlines(self):
        now = self.monotonic()
        for thread in self.threads.values():
            if not thread.control_stopped: continue
            self._interrupt_controlled(thread)
            child = self.children.get(thread.home)
            if child is not None and self._control_busy(thread) and now >= thread.control_stop_at + STOP_GRACE_SECONDS and signal.SIGTERM not in child.signals:
                # One home shares one process. Record every affected turn lost;
                # other seats' pending work can then resume in its successor.
                self._end_child(child)
        for child in list(self.children.values()):
            if signal.SIGTERM in child.signals and signal.SIGKILL not in child.signals and child.kill_at is None:
                self._terminate(child)
            if self.stop_started is not None and now >= self.stop_started + STOP_GRACE_SECONDS and signal.SIGTERM not in child.signals:
                self._terminate(child)
            if child.kill_at is not None and now >= child.kill_at:
                self.log.write("child_killed", pid=child.pid)
                child.signal(signal.SIGKILL)
                child.kill_at = None

    def stale(self, attempt_id, thread_id):
        self.threads[thread_id].uncertain = True
        self.log.write("settlement_stale", attempt=attempt_id)

    def _settle(self, work, outcome, turn, reason, steered=None):
        """Settle the dispatch's claim once. One that failed names the running turn it came from, as
        Health counts it with that turn (health.py): the turn a steer was refused by because Codex
        said it cannot take more work (steered), or the turn the thread's Codex process was running
        when it exited or was ended for an answer Theseus does not understand, which ends that turn
        too. Any other failure never reached a running turn, so it names none."""
        if work.settled:
            return
        work.settled = True
        if self.current is work:
            self.current = None
        if work.abandoned:
            work.thread.uncertain = True
            self.log.write("dispatch_late", attempt=work.claim["attempt_id"], outcome=outcome)
            return
        running = steered if reason == "not_steerable" else work.thread.active_turn if reason in PROCESS_ENDED else None
        # Logged once Core holds the settlement, so the log never runs ahead of the record.
        self.settle(outcome, turn, reason, None if running is None else {"thread_id": work.thread.id, "turn_id": running})
        self.log.write("dispatch", attempt=work.claim["attempt_id"], outcome=outcome, reason=reason,
                       mode=turn["mode"] if turn else None, ms=int((self.monotonic() - work.started) * 1000))

    def _request(self, work, method, params, handler):
        """Every request a dispatch sends. Once Core's lease ended first, none is sent: the dispatch settles late."""
        if work.abandoned:
            return self._settle(work, "unavailable", None, "abandoned")
        child = self.children.get(work.thread.home)
        if child is None:
            return self._settle(work, "unavailable", None, "child_exited")
        child.request(method, params, handler)

    def _prepare(self, work):
        thread = work.thread
        if thread.status in ("systemError", "notLoaded") and not work.resumed:
            # One resume may recover the thread; a second failure is unavailable.
            work.resumed = True
            thread.attached = False
            return self.ensure_thread(thread, lambda: self._prepare(work), lambda reason: self._settle(work, "unavailable", None, reason))
        if thread.status in ("systemError", "notLoaded"):
            return self._settle(work, "unavailable", None, "thread_" + thread.status)
        if thread.context_failures >= COMPACT_AFTER and not work.abandoned:
            # P12 settles whether automatic compaction makes this moot. An
            # abandoned dispatch leaves the compaction to the next one.
            thread.context_failures = 0
            self.log.write("compact", thread=thread.id)
            return self._request(work, "thread/compact/start", {"threadId": thread.id},
                                 lambda result, error: self._settle(work, "unavailable", None, "child_exited")
                                 if error is GONE else self._prepare(work))
        if thread.uncertain:
            def learned(result, error):
                if error is GONE:
                    return self._settle(work, "unavailable", None, "child_exited")
                if error is None:
                    last = self._last_turn(thread, result)
                    work.from_history = last is not None and last["status"] == "inProgress"
                    thread.uncertain = False
                self._send(work)
            return self._request(work, "thread/turns/list", dict(LAST_TURN, threadId=thread.id), learned)
        self._send(work)

    def _last_turn(self, thread, result):
        if type(result) is not dict or type(result.get("data")) is not list:
            raise ProtocolError("invalid_turns")
        last = result["data"][0] if result["data"] else None
        if last is not None and (type(last) is not dict or not isinstance(last.get("status"), str)
                                 or last["status"] not in TURN_END | {"inProgress"}):
            raise ProtocolError("invalid_turn")
        if last is not None:
            _string(last.get("id"))
        if last is not None and last["status"] == "inProgress":
            thread.active_turn, thread.status = last["id"], "active"
        else:
            thread.active_turn = None
            if thread.status == "active":
                thread.status = "idle"
        return last

    def _send(self, work):
        controls = self.core('hosted_controls', [work.thread.actor]).get('controls')
        if controls is None:
            raise HostFault('runner_lease_lost')
        self.apply_controls({**{t.actor: {'desired':'stopped' if t.control_stopped else 'running'} for t in self.threads.values()}, **controls})
        if work.thread.control_stopped:
            return self._settle(work, 'busy', None, 'operator_stopped')
        thread, config, notice = work.thread, work.thread.config, work.notice
        if (config.permission_mode != thread.applied_mode or
                config.permission_mode == 'workspace' and (thread.bridge is None or not thread.proxy_verified)):
            return self._settle(work, 'unavailable', None, 'workspace_policy_not_attached')
        if config.permission_mode == 'workspace':
            try:
                selected = permission_profile(config, thread.bridge.path)[0]
            except ValueError:
                return self._settle(work, 'unavailable', None, 'invalid_cwd')
            if selected != thread.applied_permissions:
                return self._settle(work, 'unavailable', None, 'workspace_policy_not_attached')
        params = {"threadId": thread.id, "input": notice["input"], "clientUserMessageId": work.client_id}
        if notice["additionalContext"] is not None:
            params["additionalContext"] = notice["additionalContext"]
        if thread.status == "active" and thread.active_turn is not None and not work.fallback:
            expected = thread.active_turn
            params["expectedTurnId"] = expected
            self._request(work, "turn/steer", params, lambda result, error: self._steered(work, expected, result, error))
        else:
            # Sent on every start, so nothing depends on overrides persisting (P2).
            params.update(approvalPolicy="never")
            if config.permission_mode == 'full':
                params['sandboxPolicy'] = sandbox_policy(config)
            else:
                params['permissions'] = permission_profile(config, thread.bridge.path)[0]
            if config.reasoning_effort is not None:
                params["effort"] = config.reasoning_effort
            self._request(work, "turn/start", params, lambda result, error: self._started(work, result, error))

    def _handed(self, work, turn_id, mode):
        return {"thread_id": work.thread.id, "turn_id": turn_id, "mode": mode, "client_id": work.client_id,
                "announced_seq": work.notice["announced_seq"]}

    def _steered(self, work, expected, result, error):
        if error is GONE:
            return self._settle(work, "unavailable", None, "child_exited")
        if error is not None:
            if _not_steerable(error):
                return self._settle(work, "busy", None, "not_steerable", steered=expected)
            ended = work.thread.active_turn != expected
            # A turn the history lists in progress may be one its app-server lost:
            # any refusal of a steer into it means it is not running, so start one.
            if not work.fallback and (ended or work.from_history or STEER_REFUSAL.search(error["message"])):
                work.fallback = True
                self.log.write("steer_refused", attempt=work.claim["attempt_id"], turn_ended=ended)
                return self._send(work)
            return self._settle(work, "error", None, "steer_failed")
        if type(result) is not dict:
            raise ProtocolError("invalid_steer")
        thread, turn_id = work.thread, _string(result.get("turnId"))
        self._settle(work, "handed", self._handed(work, turn_id, "steer"), "steered")
        if work.abandoned:
            return
        late = LATE_STEER_REARMS and thread.active_turn != expected and thread.active_turn != turn_id
        if late:
            self.log.write("steer_late", attempt=work.claim["attempt_id"], thread=thread.id, turn=turn_id)
        if self._replay_early(thread, turn_id, work.client_id):
            return
        if late:
            # The steer was answered after the host saw its turn end, so its input
            # may have been dropped (P5). Core records a steer into a turn it knows
            # ended as finished and re-arms; this applies the end Core cannot know
            # of, for a turn no earlier hand recorded.
            ended = thread.last_end if thread.last_end is not None and thread.last_end[0] == turn_id else (turn_id, "lost", None)
            self._end_turn(thread, turn_id, ended[1], ended[2])

    def _started(self, work, result, error):
        if error is GONE:
            return self._settle(work, "unavailable", None, "child_exited")
        if error is not None:
            if _not_steerable(error):
                return self._settle(work, "busy", None, "not_steerable")
            return self._settle(work, "error", None, "start_failed")
        if type(result) is not dict or type(result.get("turn")) is not dict:
            raise ProtocolError("invalid_start")
        turn_id = _string(result["turn"].get("id"))
        thread = work.thread
        if turn_id not in thread.early_ends:
            # The turn is running from this answer on, whatever order its
            # turn/started notification arrives in, unless it already ended.
            thread.active_turn, thread.status = turn_id, "active"
        self._settle(work, "handed", self._handed(work, turn_id, "start"), "started")
        if not work.abandoned:
            self._replay_early(thread, turn_id, work.client_id)

    # Children and threads --------------------------------------------------

    def ensure_child(self, home, ready, failed):
        child = self.children.get(home)
        if child is None:
            if self.stopping:
                return failed("stopping")
            child = self._spawn(home)
            if child is None:
                return failed("spawn_failed")
        if child.state == "ready":
            return ready(child)
        if child.state == "initializing":
            child.ready_waiters.append((ready, failed))
            return None
        return failed(child.state)

    def _spawn(self, home):
        try:
            threads = [thread for thread in self.threads.values() if thread.home == home]
            profiles = {}
            # A shared full-access child keeps its original launch policy.
            # A workspace route there refuses at its configuration check.
            if all(thread.config.permission_mode == 'workspace' for thread in threads):
                for thread in threads:
                    try:
                        validate_workspace(thread.config)
                        if thread.bridge is None:
                            thread.bridge = HostedCLI(thread.config)
                        name, policy = permission_profile(thread.config, thread.bridge.path)
                        profiles[name] = policy
                    except ValueError:
                        continue
            child = Child(home, self.executables[home], self.log.stderr, self._input_space,
                          overrides=startup_overrides(profiles))
        except (OSError, ValueError, RuntimeError, subprocess.SubprocessError):
            self.log.write("spawn_failed")
            return None
        self.children[home] = child
        self.by_pid[child.pid] = child
        recorded = self.core("record_hosted_child", home, child.pid, child.started_at)
        child.child_id = recorded.get("child_id")
        self.log.write("spawn", pid=child.pid, child=child.child_id)
        self.by_fd[child.out] = child
        self.watch.watch_reader(child.out)
        if not self.watch.watch_process(child.pid) or child.popen.poll() is not None:
            # It exited before its exit could be watched; it is handled now.
            self._exited(child)
            return None
        if child.child_id is None:
            # Ownership was lost between claim and spawn: this child does no work.
            self._fail_child(child, "unowned")
            return child
        child.request("initialize", initialize_params(), lambda result, error: self._initialized(child, result, error))
        return child

    def _initialized(self, child, result, error):
        if error is GONE:
            return None
        refusal = initialized_refusal(result, error, child.home)
        if refusal is not None:
            return self._fail_child(child, refusal)
        child.notify("initialized", {})
        self.core("hosted_child_ready", child.child_id, result["userAgent"][:1024])
        child.request("account/read", {"refreshToken": False}, lambda value, problem: self._account(child, value, problem))

    def _account(self, child, result, error):
        if error is GONE:
            return None
        if error is not None or not signed_in(result):
            return self._fail_child(child, "auth_missing")
        child.state = "ready"
        self.log.write("initialized", pid=child.pid)
        waiters, child.ready_waiters = child.ready_waiters, []
        for ready, failed in waiters:
            ready(child)

    def _fail_child(self, child, state):
        """Close a child that cannot serve; every claim on its home is unavailable until it exits and respawns."""
        child.state = state
        self.log.write("child_refused", pid=child.pid, reason=state)
        child.close_input()
        waiters, child.ready_waiters = child.ready_waiters, []
        for ready, failed in waiters:
            failed(state)

    def ensure_thread(self, thread, ready, failed):
        if thread.attached and thread.home in self.children and self.children[thread.home].state == "ready":
            return ready()
        thread.waiters.append((ready, failed))
        if thread.attaching:
            return None
        thread.attaching = True
        child = self.children.get(thread.home)
        if child is not None and child.state == "stalled":
            # Ended and exiting: the claim waits for the successor rather than
            # answering unavailable for a replacement already under way.
            child.successors.append(thread)
            self.log.write("attach_waits", thread=thread.id, pid=child.pid)
            return None
        self._attach(thread)

    def _attach(self, thread):
        self.ensure_child(thread.home, lambda child: self._resume(child, thread), lambda reason: self._attach_failed(thread, reason))

    def _attach_failed(self, thread, reason):
        replacing = self.replacing
        if reason == "child_exited" and replacing is not None and replacing.home == thread.home:
            if thread not in replacing.successors:
                replacing.successors.append(thread)
            return
        thread.attaching = False
        waiters, thread.waiters = thread.waiters, []
        for ready, failed in waiters:
            failed(reason)

    def _resume(self, child, thread):
        config = thread.config
        thread.proxy_verified = False
        try:
            if config.permission_mode != 'full' and thread.bridge is None:
                validate_workspace(config)
                thread.bridge = HostedCLI(config)
            bridge = thread.bridge
            params = dict(thread_settings(config, bridge.path if bridge else None), threadId=thread.id, excludeTurns=True)
        except ValueError:
            return self._attach_failed(thread, 'invalid_cwd')
        except (OSError, RuntimeError):
            return self._attach_failed(thread, 'broker_unavailable')
        if not RESEND_INSTRUCTIONS_ON_RESUME:
            params.pop("developerInstructions")
        name = params.get('permissions')
        def resume(verified):
            context = (config, bridge, name, verified)
            child.request("thread/resume", params, lambda result, error: self._resumed(child, thread, result, error, context))
        if config.permission_mode == 'full':
            return resume(False)
        policy = params['config']['permissions'][name]
        def stale(error):
            if error is GONE:
                self._attach_failed(thread, 'child_exited')
                return True
            if thread.config != config or thread.bridge is not bridge:
                self._attach_failed(thread, 'route_configuration_changed')
                return True
            return False
        def checked(result, error):
            if stale(error):
                return
            if error is not None or not proxy_configuration(result, name, policy):
                return self._attach_failed(thread, 'proxy_unverified')
            def proved(result, error):
                if stale(error):
                    return
                if not proxy_result(result, error):
                    return self._attach_failed(thread, 'proxy_unverified')
                resume(True)
            child.request('command/exec', proxy_probe(name, config.cwd), proved)
        child.request('config/read', {'includeLayers': False, 'cwd': config.cwd}, checked)

    def _resumed(self, child, thread, result, error, context):
        if error is GONE:
            return self._attach_failed(thread, "child_exited")
        config, bridge, permissions, verified = context
        if thread.config != config or thread.bridge is not bridge:
            return self._attach_failed(thread, 'route_configuration_changed')
        if error is not None:
            if _refuses_pin(error):
                self.log.write("resume_refused", thread=thread.id)
                raise HostFault("route_binding_changed")
            self.log.write("resume_failed", thread=thread.id)
            return self._attach_failed(thread, "resume_failed")
        if type(result) is not dict or type(result.get("thread")) is not dict:
            raise ProtocolError("invalid_resume")
        if result["thread"].get("id") != thread.id:
            # Never a replacement thread: the pin names exactly one.
            self.log.write("resume_refused", thread=thread.id)
            raise HostFault("route_binding_changed")
        if not settings_applied(result, config.cwd, config.writable_roots, config.permission_mode,
                                config.model, config.reasoning_effort, permissions, verified):
            # A thread whose sandbox or policy is not what was sent is never used.
            self.log.write("resume_settings_refused", thread=thread.id)
            return self._attach_failed(thread, "settings_not_applied")
        thread.applied_mode, thread.applied_permissions = config.permission_mode, permissions
        thread.proxy_verified = verified
        thread.status = _thread_status(result["thread"].get("status"))
        thread.active_turn = None
        child.request("thread/turns/list", dict(LAST_TURN, threadId=thread.id),
                      lambda value, problem: self._reconciled(child, thread, value, problem))

    def _reconciled(self, child, thread, result, error):
        """Settle the rows a previous run left open from the thread's last turn (design §6.4)."""
        if error is GONE:
            return self._attach_failed(thread, "child_exited")
        resumed = thread.status
        last = self._last_turn(thread, result) if error is None else None
        # An in-progress last turn is live only if the resumed thread says it is active.
        live = last is not None and last["status"] == "inProgress" and resumed == "active"
        thread.status, thread.active_turn = resumed, last["id"] if live else None
        for row in self.core("open_hosted_turns", [thread.id]).get("turns", []):
            turn_id = row["turn_id"]
            if last is not None and last["id"] == turn_id and last["status"] in TURN_END:
                self._end_turn(thread, turn_id, last["status"], error_code(last.get("error")) if last["status"] != "completed" else None)
            elif not (live and last["id"] == turn_id):
                self._end_turn(thread, turn_id, ORPHANED_IN_PROGRESS, None)
        thread.attached, thread.attaching = True, False
        self.log.write("resume", thread=thread.id, status=thread.status)
        waiters, thread.waiters = thread.waiters, []
        for ready, failed in waiters:
            ready()

    def _replay_early(self, thread, turn_id, client_id):
        """Apply what arrived before this turn's handed row existed; True if its end was applied.

        One dispatch is outstanding at a time, so any other early record
        belongs to a turn no answer will ever record, and is dropped."""
        seen, thread.early_seen = client_id in thread.early_seen, set()
        ended, thread.early_ends = thread.early_ends.pop(turn_id, None), {}
        if seen:
            result = self.core("hosted_turn_seen", client_id)
            self.log.write("seen", thread=thread.id, status=result.get("status"), replayed=True)
        if ended is None:
            return False
        status, code, usage = ended
        result = self.core("end_hosted_turn", thread.id, turn_id, status, code, usage)
        self.log.write("turn_end", thread=thread.id, turn=turn_id, status=status, error_code=code, replayed=True,
                       rearmed=result.get("rearmed"))
        return True

    def _end_turn(self, thread, turn_id, status, code):
        usage = thread.usage.pop(turn_id, {})
        calls = thread.cli_calls.pop(turn_id, None)
        if calls is not None:
            usage = dict(usage, cli_calls=calls)
        thread.interrupted.discard(turn_id)
        result = self.core("end_hosted_turn", thread.id, turn_id, status, code, usage or None)
        if result.get("status") == "unknown":
            thread.early_ends[turn_id] = (status, code, usage or None)
        self.log.write("turn_end", thread=thread.id, turn=turn_id, status=status, error_code=code,
                       tokens={key: value for key, value in usage.items() if key != "cli_calls"} or None,
                       cli_calls=calls, rearmed=result.get("rearmed"))

    # Events from the loop's kqueue -----------------------------------------

    def _input_space(self, child, on):
        if on:
            self.log.write("input_waiting", pid=child.pid, unread=len(child.outbox))
            self.by_input[child.input] = child
            self.watch.watch_writer(child.input)
        elif self.by_input.pop(child.input, None) is not None:
            self.watch.unwatch_writer(child.input)

    def on_writable(self, fd):
        child = self.by_input.get(fd)
        if child is not None:
            child.flush()

    def on_readable(self, fd):
        child = self.by_fd.get(fd)
        if child is None:
            return
        try:
            messages = child.read()
        except ProtocolError as error:
            return self._broken(child, str(error))
        for message in messages:
            try:
                self._message(child, message)
            except ProtocolError as error:
                return self._broken(child, str(error))
        if child.eof:
            if not self.stopping and not child.exiting and child.state in ("initializing", "ready"):
                # Output ended while the process may live on: nothing it is asked
                # can be answered, so it is closed and terminated by its captured PID.
                self._fail_child(child, "output_closed")
                self._terminate(child)
            self._close_output(child)

    def on_exit(self, pid):
        child = self.by_pid.get(pid)
        if child is not None:
            self._exited(child)

    def _broken(self, child, reason):
        self.log.write("protocol_error", pid=child.pid, reason=reason)
        if self.current is not None and self.current.thread.home == child.home:
            # Its answer may have been the broken message: never trusted, never waited for.
            self._settle(self.current, "error", None, "protocol_error")
        self._fail_child(child, "broken")
        self._close_output(child)
        self._terminate(child)

    def _close_output(self, child):
        if self.by_fd.pop(child.out, None) is not None:
            self.watch.unwatch_reader(child.out)
            child.popen.stdout.close()

    def _exited(self, child):
        """NOTE_EXIT on the captured PID: drain, reap, record, and hand the lost work back (design §6.2)."""
        self.replacing = child if child.state == "stalled" else None
        try:
            self._handle_exit(child)
        finally:
            self.replacing = None

    def _handle_exit(self, child):
        child.exiting = True
        if child.out in self.by_fd:
            self.on_readable(child.out)
        self._close_output(child)
        child.close_input()
        status = child.popen.wait()
        self.by_pid.pop(child.pid, None)
        if self.children.get(child.home) is child:
            del self.children[child.home]
        previous, child.state = child.state, "exited"
        if child.child_id is not None:
            self.core("end_hosted_child", child.child_id, max(-255, min(255, status)), "confirmed")
        self.log.write("child_exit", pid=child.pid, status=status, state=previous)
        waiting, child.waiting = child.waiting, {}
        for handler in waiting.values():
            handler(None, GONE)
        waiters, child.ready_waiters = child.ready_waiters, []
        for ready, failed in waiters:
            failed("child_exited")
        threads = [thread for thread in self.threads.values() if thread.home == child.home]
        for thread in threads:
            thread.attached = False
            thread.status = thread.active_turn = None
            if thread.attaching and thread not in child.successors:
                # Its resume or reconcile handler may have failed after leaving
                # the child's waiting set: the waiters are settled now, and the
                # next claim spawns a fresh child.
                self._attach_failed(thread, "child_exited")
        if threads and child.child_id is not None:
            by_id = {thread.id: thread for thread in threads}
            for row in self.core("open_hosted_turns", sorted(by_id)).get("turns", []):
                self._end_turn(by_id[row["thread_id"]], row["turn_id"], "lost", None)
        successors, child.successors = child.successors, []
        for thread in successors:
            self._attach(thread)

    def _message(self, child, message):
        kind = _kind(message)
        if kind == "response":
            handler = child.waiting.pop(message["id"], None)
            if handler is None:
                self.log.write("unexpected_response", pid=child.pid)
                return
            if child.suspect is not None and message["id"] > child.suspect:
                child.suspect = None
                self.log.write("child_recovered", pid=child.pid)
            error = message.get("error")
            handler(message.get("result") if error is None else None, error)
        elif kind == "request":
            params = message.get("params")
            thread = params.get("threadId") if type(params) is dict else None
            if thread is not None and not isinstance(thread, str):
                raise ProtocolError("invalid_thread")
            label, response = answer(message)
            child.send(response)
            self.log.write("server_request", method=message["method"] if message["method"] in KNOWN_REQUESTS else "other",
                           answer=label, thread=thread if thread in self.threads else None)
        else:
            self._notification(child, message["method"], message.get("params"))

    def _notification(self, child, method, params):
        if type(params) is not dict:
            return
        if "threadId" in params and not isinstance(params["threadId"], str):
            raise ProtocolError("invalid_thread")
        thread = self.threads.get(params.get("threadId"))
        if thread is None or thread.home != child.home:
            return
        if method == "thread/status/changed":
            thread.status = _thread_status(params.get("status"))
        elif method == "turn/started" and type(params.get("turn")) is dict:
            thread.active_turn, thread.status = _string(params["turn"].get("id")), "active"
        elif method == "turn/completed" and type(params.get("turn")) is dict:
            turn = params["turn"]
            turn_id = _string(turn.get("id"))
            if not isinstance(turn.get("status"), str):
                raise ProtocolError("invalid_status")
            if thread.active_turn == turn_id:
                thread.active_turn = None
                thread.status = "idle"
            if turn["status"] in TURN_END:
                code = error_code(turn.get("error")) if turn["status"] != "completed" else None
                thread.last_end = (turn_id, turn["status"], code)
                thread.context_failures = thread.context_failures + 1 if code == "contextWindowExceeded" else 0
                self._end_turn(thread, turn_id, turn["status"], code)
                if code == "unauthorized" and child.state == "ready":
                    # Later claims on this home wait for account/read: unavailable until it recovers.
                    self.log.write("auth_failed", pid=child.pid)
                    child.state = "initializing"
                    child.request("account/read", {"refreshToken": False}, lambda value, problem: self._account(child, value, problem))
        elif method == "item/completed" and type(params.get("item")) is dict:
            item = params["item"]
            if item.get("type") == "userMessage" and isinstance(item.get("clientId"), str) and item["clientId"].startswith(CLIENT_PREFIX):
                seen = self.core("hosted_turn_seen", item["clientId"])
                if seen.get("status") == "unknown":
                    thread.early_seen.add(item["clientId"])
                self.log.write("seen", thread=thread.id, status=seen.get("status"))
            elif item.get("type") == "commandExecution" and isinstance(params.get("turnId"), str):
                if isinstance(item.get("command"), str) and thread.config.cli in item["command"]:
                    thread.cli_calls[params["turnId"]] = thread.cli_calls.get(params["turnId"], 0) + 1
        elif method == "thread/tokenUsage/updated" and isinstance(params.get("turnId"), str):
            usage = params.get("tokenUsage")
            last = usage.get("last") if type(usage) is dict else None
            if type(last) is dict:
                counts = {name: last[key] for key, name in TOKEN_FIELDS
                          if type(last.get(key)) is int and 0 <= last[key] <= 9223372036854775807}
                thread.usage[params["turnId"]] = counts
        elif method == "error":
            self.log.write("turn_error", thread=thread.id, will_retry=params.get("willRetry") is True,
                           error_code=error_code(params.get("error")))
        elif method == "thread/closed":
            thread.attached = False
            thread.status, thread.active_turn = "notLoaded", None

    # Stop ------------------------------------------------------------------

    def stop_step(self, stop_count):
        """One step of a graceful stop (design §6.3); True once every child has exited."""
        self.stopping = True
        if self.stop_started is None:
            self.stop_started = self.monotonic()
        live = list(self.children.values())
        if stop_count >= 3:
            for child in live:
                child.signal(signal.SIGKILL)
        elif stop_count >= 2:
            for child in live:
                self._terminate(child)
        if self.current is not None:
            return False
        active = [thread for thread in self.threads.values() if thread.active_turn is not None
                  and thread.home in self.children and self.children[thread.home].state == "ready"]
        for thread in active:
            if thread.active_turn not in thread.interrupted:
                thread.interrupted.add(thread.active_turn)
                turn = thread.active_turn
                self.log.write("interrupt", thread=thread.id, turn=turn)
                self.children[thread.home].request("turn/interrupt", {"threadId": thread.id, "turnId": turn},
                                                   lambda result, error, thread=thread, turn=turn: self._interrupt_answered(thread, turn, error))
        if not active and not self.inputs_closed:
            self.inputs_closed = True
            for child in live:
                child.close_input()
        return not self.children

    def _interrupt_answered(self, thread, turn, error):
        # A refused interrupt means no such turn is running; its open row is
        # settled from the thread's last turn by the next run.
        if error is not None and thread.active_turn == turn:
            thread.active_turn = None

    def close(self):
        """Close and reap owned children, escalating on deadlines without another delivery or signal."""
        recorded = False
        try:
            recorded = self._close_children()
        finally:
            for thread in self.threads.values():
                if thread.bridge is not None:
                    try:
                        thread.bridge.close()
                    except (OSError, RuntimeError):
                        self.log.write('broker_cleanup_failed', thread=thread.id)
                        recorded = False
        return recorded

    def _close_children(self):
        if not self.children:
            return True
        queue = select.kqueue()
        recorded = True
        if self.stop_started is None:
            self.stop_started = self.monotonic()
        try:
            queue.control([select.kevent(number, filter=select.KQ_FILTER_SIGNAL, flags=select.KQ_EV_ADD | select.KQ_EV_ENABLE)
                           for number in (signal.SIGINT, signal.SIGTERM)], 0, 0)
            exited = []
            for child in list(self.children.values()):
                child.close_input()
                # Closing the descriptor also drops any filter another queue holds on it.
                if self.by_fd.pop(child.out, None) is not None:
                    child.popen.stdout.close()
                try:
                    queue.control([select.kevent(child.pid, filter=select.KQ_FILTER_PROC,
                                                 flags=select.KQ_EV_ADD | select.KQ_EV_ONESHOT, fflags=select.KQ_NOTE_EXIT)], 0, 0)
                    if child.popen.poll() is not None:
                        exited.append(child)
                except OSError as error:
                    if error.errno != errno.ESRCH:
                        raise
                    exited.append(child)
            signals = 1
            while self.children:
                for child in exited:
                    recorded = self._reap_quietly(child) and recorded
                exited = []
                if not self.children:
                    break
                self.advance_deadlines()
                deadline = self.next_deadline()
                timeout = None if deadline is None else max(0, deadline - self.monotonic())
                for event in queue.control(None, 16, timeout):
                    if event.filter == select.KQ_FILTER_SIGNAL:
                        signals += max(1, event.data)
                        for child in self.children.values():
                            if signals >= 3:
                                child.signal(signal.SIGKILL)
                                child.kill_at = None
                            else:
                                self._terminate(child)
                    elif event.filter == select.KQ_FILTER_PROC and event.ident in self.by_pid:
                        if self.by_pid[event.ident] not in exited:
                            exited.append(self.by_pid[event.ident])
        finally:
            queue.close()
        return recorded

    def _reap_quietly(self, child):
        if child not in self.children.values():
            return True
        status = child.popen.wait()
        self.by_pid.pop(child.pid, None)
        self.children.pop(child.home, None)
        self.log.write("child_exit", pid=child.pid, status=status, state=child.state)
        if child.child_id is None:
            return True
        try:
            return self.core("end_hosted_child", child.child_id, max(-255, min(255, status)), "confirmed").get("status") in ("recorded", "already")
        except Exception:
            return False


# Operator provisioning (C7) -------------------------------------------------

class ProvisionError(Exception):
    def __init__(self, reason, thread_id=None):
        self.reason, self.thread_id = reason, thread_id
        super().__init__(reason)


class _Sync:
    """Blocking request/response on one child for the operator verb: waits on kqueue events, never a timer."""

    def __init__(self, child):
        self.child = child
        self.queue = select.kqueue()
        child.writable = self._input_space
        self.reading = True
        self.queue.control([select.kevent(child.out, filter=select.KQ_FILTER_READ, flags=select.KQ_EV_ADD | select.KQ_EV_ENABLE)], 0, 0)
        self.exited = False
        try:
            self.queue.control([select.kevent(child.pid, filter=select.KQ_FILTER_PROC,
                                              flags=select.KQ_EV_ADD | select.KQ_EV_ONESHOT, fflags=select.KQ_NOTE_EXIT)], 0, 0)
        except OSError as error:
            if error.errno != errno.ESRCH:
                raise
            self.exited = True

    def _input_space(self, child, on):
        self.queue.control([select.kevent(child.input, filter=select.KQ_FILTER_WRITE,
                                          flags=select.KQ_EV_ADD | select.KQ_EV_ENABLE if on else select.KQ_EV_DELETE)], 0, 0)

    def _step(self, timeout=None):
        """Wait for one batch of events, write what the input takes, and read what arrived."""
        for event in self.queue.control(None, 4, timeout):
            if event.filter == select.KQ_FILTER_PROC:
                self.exited = True
            elif event.filter == select.KQ_FILTER_WRITE:
                self.child.flush()
        messages = self.child.read() if self.reading else []
        if self.child.eof and self.reading:
            # End of stream stays readable; stop watching it and wait for the exit alone.
            self.reading = False
            self.queue.control([select.kevent(self.child.out, filter=select.KQ_FILTER_READ, flags=select.KQ_EV_DELETE)], 0, 0)
        return messages

    def call(self, method, params):
        box = []
        self.child.request(method, params, lambda result, error: box.append((result, error)))
        deadline = time.monotonic() + 45
        while not box:
            if not self.reading:
                raise ProvisionError("child_exited")
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                raise ProvisionError("request_timed_out")
            for message in self._step(remaining):
                kind = _kind(message)
                if kind == "request":
                    self.child.send(answer(message)[1])
                elif kind == "response":
                    handler = self.child.waiting.pop(message["id"], None)
                    if handler is not None:
                        handler(message.get("result") if "error" not in message else None, message.get("error"))
        return box[0]

    def close(self):
        """Close input and wait for the child's exit event; it is then reaped."""
        self.child.close_input()
        deadline = time.monotonic() + STOP_GRACE_SECONDS
        while not self.exited:
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                self.child.signal(signal.SIGKILL if signal.SIGTERM in self.child.signals else signal.SIGTERM)
                deadline = time.monotonic() + TERM_GRACE_SECONDS
            self._step(max(0, deadline - time.monotonic()))
        self.queue.close()
        self.child.popen.stdout.close()
        return self.child.popen.wait()


def provision(*, runner_profile, runner_id, actor_profile, codex_executable, codex_home, cli, cwd, model, config_path,
              permission_mode="workspace", reasoning_effort=None, instructions="", owner_id=None):
    """Start a thread for one agent, pin it and write its hosted route config; an operator act, never runtime."""
    runner = load_profile(runner_profile)
    broker_routes.hosted_options(permission_mode, reasoning_effort, instructions)
    actor = load_profile(actor_profile)
    if (actor.binding != runner.binding or actor.db_path != runner.db_path or actor.instance_id != runner.instance_id):
        raise broker_routes.BrokerBindingError()
    executable = broker_routes._codex_executable(codex_executable)
    try:
        cli = broker_routes._executable(cli)
    except broker_routes.BrokerConfigError as error:
        raise broker_routes.BrokerConfigError("invalid_cli") from error
    home = broker_routes.hosted_home(broker_routes._path(codex_home))
    info = os.lstat(home)
    if not stat.S_ISDIR(info.st_mode) or info.st_uid != os.getuid() or info.st_mode & 0o077:
        raise broker_routes.BrokerConfigError("invalid_codex_home")
    cwd = broker_routes._path(cwd)
    if not os.path.isdir(cwd):
        raise broker_routes.BrokerConfigError("invalid_cwd")
    if model is not None and not (0 < len(model) <= 200 and model.isprintable()):
        raise broker_routes.BrokerConfigError("invalid_model")
    profile_path = broker_routes._path(actor_profile)
    roots = broker_routes.writable_roots(profile_path, actor)
    outbox = roots[1]
    if os.path.lexists(outbox):
        # The same rule the runtime applies: a real directory at its own path.
        broker_routes.hosted_outbox(outbox)
    target = Path(config_path)
    if not target.is_absolute() or os.path.lexists(str(target)) or not target.parent.is_dir():
        raise broker_routes.BrokerConfigError("invalid_config_path")
    store = runner.store()
    settings = _ProvisionSettings(actor, profile_path, cli, cwd, model, roots)
    settings.destination = {'codex_home': home}
    settings.permission_mode, settings.reasoning_effort, settings.instructions = permission_mode, reasoning_effort, instructions
    params = dict(thread_settings(settings), ephemeral=False, serviceName="theseus")
    profiles = params['config'].get('permissions', {})
    with store.runner_guard(runner_id) as guard:
        child = Child(home, executable, subprocess.DEVNULL, overrides=startup_overrides(profiles))
        sync = _Sync(child)
        thread_id = None
        try:
            result, error = sync.call("initialize", initialize_params())
            if initialized_refusal(result, error, home) is not None:
                raise ProvisionError("incompatible")
            child.notify("initialized", {})
            result, error = sync.call("account/read", {"refreshToken": False})
            if error is not None or not signed_in(result):
                raise ProvisionError("auth_missing")
            # Created only once the home can serve, so a refusal leaves nothing
            # behind; mkdir refuses anything that appeared there since the check.
            if not os.path.lexists(outbox):
                try:
                    os.mkdir(outbox, 0o700)
                except OSError as failure:
                    raise broker_routes.BrokerConfigError("invalid_writable_roots") from failure
            verified = False
            if permission_mode != 'full':
                name = params['permissions']
                configured, problem = sync.call('config/read', {'includeLayers': False, 'cwd': cwd})
                if problem is not None or not proxy_configuration(configured, name, profiles[name]):
                    raise ProvisionError('proxy_unverified')
                proved, problem = sync.call('command/exec', proxy_probe(name, cwd))
                verified = proxy_result(proved, problem)
                if not verified:
                    raise ProvisionError('proxy_unverified')
            result, error = sync.call("thread/start", params)
            if error is not None or type(result) is not dict or type(result.get("thread")) is not dict:
                raise ProvisionError("thread_start_failed")
            thread_id = result["thread"].get("id")
            if not isinstance(thread_id, str) or not settings_applied(result, cwd, roots, permission_mode, model, reasoning_effort,
                                                                     params.get('permissions'), verified):
                raise ProvisionError("thread_settings_not_applied", thread_id if isinstance(thread_id, str) else None)
            # Native Codex keeps an empty thread in memory only. Persist an
            # explicit setup record before pinning its id, without a model
            # turn or fabricated agent answer. A fresh app-server can then
            # resume this same thread before its first work delivery.
            result, error = sync.call("thread/inject_items", {"threadId": thread_id, "items": [{
                "type": "message", "role": "developer", "content": [{"type": "input_text", "text":
                    "Theseus provisioned this standing agent. This is a setup record, not a work request or a human answer. Await Theseus deliveries."}]}]})
            if error is not None or result != {}:
                raise ProvisionError("thread_persistence_failed", thread_id)
            destination = {"kind": HOSTED_KIND, "protocol_version": 1, "codex_home": home, "thread_id": thread_id}
            try:
                store.provision_route_pin(guard, actor.actor_id, destination, owner_id=owner_id or runner.actor_id)
            except Exception as failure:
                raise ProvisionError(getattr(failure, "code", None) or "pin_refused", thread_id) from failure
            value = {"v": 1, "kind": HOSTED_KIND, "actor_id": actor.actor_id, "profile": profile_path, "cli": cli,
                     "codex_executable": executable, "codex_home": home, "thread_id": thread_id, "cwd": cwd,
                     "model": model, "writable_roots": list(roots)}
            if permission_mode != "workspace" or reasoning_effort is not None or instructions:
                value.update(v=2, permission_mode=permission_mode, reasoning_effort=reasoning_effort, instructions=instructions)
            payload = (json.dumps(value, indent=1) + "\n").encode("utf-8")
            try:
                fd = os.open(str(target), os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
                with os.fdopen(fd, "wb") as handle:
                    handle.write(payload)
                    handle.flush()
                    os.fsync(handle.fileno())
            except OSError as failure:
                raise ProvisionError("config_write_failed", thread_id) from failure
        finally:
            sync.close()
    return {"status": "provisioned", "actor_id": actor.actor_id, "thread_id": thread_id, "config": str(target)}


class _ProvisionSettings:
    """The fields thread_settings reads, before any config file exists."""

    def __init__(self, profile, profile_path, cli, cwd, model, roots):
        self.profile, self.profile_path, self.cli, self.cwd, self.model, self.writable_roots = profile, profile_path, cli, cwd, model, roots


def provision_main(argv):
    parser = argparse.ArgumentParser(prog="aim-next-runner host-provision",
                                     description="Start, pin and configure one hosted Codex thread for an agent")
    for name in ("--profile", "--runner-id", "--actor-profile", "--codex-executable", "--codex-home", "--cli", "--cwd", "--config"):
        parser.add_argument(name, required=True)
    parser.add_argument("--model")
    parser.add_argument("--owner", help="Human owner of Stop/Continue; defaults to the runner profile actor")
    parser.add_argument("--permission-mode", choices=("workspace", "full"), default="workspace")
    parser.add_argument("--reasoning-effort", choices=("low", "medium", "high", "xhigh"))
    parser.add_argument("--instructions", default="", help="Standing role instructions preserved on every resume")
    args = parser.parse_args(argv)
    try:
        result = provision(runner_profile=args.profile, runner_id=args.runner_id, actor_profile=args.actor_profile,
                           codex_executable=args.codex_executable, codex_home=args.codex_home, cli=args.cli, cwd=args.cwd,
                           model=args.model, config_path=args.config, permission_mode=args.permission_mode,
                           reasoning_effort=args.reasoning_effort, instructions=args.instructions, owner_id=args.owner)
    except ProvisionError as error:
        result = {"status": "refused", "reason": error.reason}
        if error.thread_id is not None:
            # An orphan thread is harmless; the operator sees its id.
            result["orphan_thread_id"] = error.thread_id
    except Exception as error:
        reason = getattr(error, "code", None)
        result = {"status": "refused", "reason": reason if isinstance(reason, str) and re.fullmatch("[A-Za-z_]{1,64}", reason) else None}
    print(json.dumps(result, separators=(",", ":")), flush=True)
    return 0 if result["status"] == "provisioned" else 2

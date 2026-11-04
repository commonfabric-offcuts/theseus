from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
import errno
import json
import os
from pathlib import Path
import select
import signal
import stat
import subprocess
import time

from .authority import AuthorityError, RunnerGuard
from .contract import StoreError
from .profile import ProfileError, load_profile


MAX_ROUTE_BYTES = 65536
MAX_ARG_BYTES = 16384
MAX_STDIN_BYTES = 8192
BINDING_FIELDS = {"instance_id", "actor_id", "db_path", "authority_id", "authority_epoch"}
CLAIM_FIELDS = {"attempt_id", "claim_token", "recipient_id", "wake_generation",
                "captured_seq", "lease_until_ms", "route_binding"}


class RouteUnavailable(Exception):
    """A selected route cannot be used; the reason contains no local data."""

    def __init__(self, code):
        self.code = code
        super().__init__(code)


@dataclass(frozen=True)
class PreparedRoute:
    # Internal, ephemeral data, not a receipt or authorization to dispatch later.
    argv: tuple
    stdin: bytes
    executable: str


@dataclass(frozen=True)
class RouteResult:
    outcome: str
    exit_code: int | None
    reason: str


class AdapterFault(Exception):
    """The caller must persist a pause; only fixed nonsecret codes escape."""


# Preserve ownership if cleanup cannot be confirmed. The dedicated runner must
# pause and exit, not invoke again. Inherited guards independently fence children.
_UNCONFIRMED_CHILDREN = []
_PS_LIMIT = 1048576


def _ticks():
    return time.clock_gettime_ns(time.CLOCK_MONOTONIC_RAW)


def _remaining(deadline):
    return max(0.0, (deadline - _ticks()) / 1000000000)


def _process_group(pid, deadline):
    """Bounded observation, never a killpg(0) existence test or broker reap."""
    end = min(deadline, _ticks() + 250000000)
    if not _remaining(end):
        raise AdapterFault("process_observation_failed")
    helper = subprocess.Popen(["/bin/ps", "-A", "-o", "pid=,pgid=,stat="],
                              stdin=subprocess.DEVNULL, stdout=subprocess.PIPE,
                              stderr=subprocess.DEVNULL, shell=False,
                              env={"PATH": "/usr/bin:/bin", "LC_ALL": "C"})
    raw = bytearray()
    try:
        os.set_blocking(helper.stdout.fileno(), False)
        while True:
            left = _remaining(end)
            if not left:
                raise AdapterFault("process_observation_failed")
            if not select.select([helper.stdout], [], [], left)[0]:
                raise AdapterFault("process_observation_failed")
            block = os.read(helper.stdout.fileno(), min(16384, _PS_LIMIT + 1 - len(raw)))
            if not block:
                break
            raw.extend(block)
            if len(raw) > _PS_LIMIT:
                raise AdapterFault("process_observation_failed")
        if helper.wait(timeout=_remaining(end)) != 0:
            raise AdapterFault("process_observation_failed")
        members = {}
        seen = set()
        for line in raw.decode("ascii").splitlines():
            parts = line.split()
            if (len(parts) != 3 or not parts[0].isdigit() or not parts[1].isdigit()
                    or not parts[2] or parts[2][0] not in "RSDITZUX?"):
                raise AdapterFault("process_observation_failed")
            row_pid, pgid = int(parts[0]), int(parts[1])
            if row_pid in seen:
                raise AdapterFault("process_observation_failed")
            seen.add(row_pid)
            if pgid == pid:
                members[row_pid] = parts[2]
        # A live or zombie direct child reserves this identity. An absent leader
        # is ambiguous (possibly an unrelated reaper), never permission to signal.
        if pid not in members:
            raise AdapterFault("leader_identity_unconfirmed")
        return members
    except (OSError, ValueError, subprocess.SubprocessError) as error:
        raise AdapterFault("process_observation_failed") from error
    finally:
        helper.stdout.close()
        # This is our separate, direct ps child. It has no descendants. Reaping
        # it has no bearing on the retained broker leader's process group.
        if helper.poll() is None:
            helper.kill()
            helper.wait(timeout=max(0.001, _remaining(deadline)))


def _cleanup_child(child):
    """Confirm no live group members, then and only then reap its leader."""
    deadline = _ticks() + 1000000000
    escalate = _ticks() + 400000000
    sent_term = sent_kill = False
    saw_descendant = False
    empty_observations = 0
    while _remaining(deadline):
        members = _process_group(child.pid, deadline)
        live = [pid for pid, state in members.items() if not state.startswith("Z")]
        saw_descendant = saw_descendant or any(pid != child.pid for pid in live)
        if not live:
            empty_observations += 1
            if empty_observations >= 2:
                return child.wait(timeout=_remaining(deadline)), saw_descendant
        else:
            empty_observations = 0
            next_signal = None
            if not sent_term:
                sent_term = True
                next_signal = signal.SIGTERM
            elif not sent_kill and _ticks() >= escalate:
                sent_kill = True
                next_signal = signal.SIGKILL
            if next_signal is not None:
                try:
                    os.killpg(child.pid, next_signal)
                except OSError as error:
                    # The retained leader still reserves this group. A member
                    # can exit between observation and signal; only a later
                    # observation may confirm cleanup. Do not reset escalation.
                    if error.errno not in (errno.EPERM, errno.ESRCH):
                        raise
        time.sleep(min(0.01, _remaining(deadline)))
    raise AdapterFault("cleanup_unconfirmed")


def _watch_exit(queue, child, deadline):
    try:
        events = queue.control([select.kevent(child.pid, filter=select.KQ_FILTER_PROC,
            flags=select.KQ_EV_ADD | select.KQ_EV_ENABLE | select.KQ_EV_ONESHOT,
            fflags=select.KQ_NOTE_EXIT)], 1, 0)
        for event in events:
            if event.flags & select.KQ_EV_ERROR:
                if event.data != errno.ESRCH:
                    raise AdapterFault("exit_observation_failed")
            elif event.ident == child.pid and event.fflags & select.KQ_NOTE_EXIT:
                return True
    except OSError as error:
        if error.errno != errno.ESRCH:
            raise AdapterFault("exit_observation_failed") from error
    # Includes exit before registration and a missing event for a zombie. A
    # process-list snapshot alone does not authorize signalling an absent PID.
    return _process_group(child.pid, deadline)[child.pid].startswith("Z")


def run_route(route_path, claim, guard, *, owner_lease_until_ms, record_child):
    """Invoke one trusted broker under the caller's actual held runner guard.

    This neither acknowledges work nor schedules another wake. Fixed faults
    require a durable pause by the caller. No generic child reaper may coexist.
    """
    if _UNCONFIRMED_CHILDREN:
        raise AdapterFault("cleanup_unconfirmed")
    try:
        prepared = prepare_route(route_path, claim, guard)
        pass_fds = guard.pass_fds
        if (signal.getsignal(signal.SIGCHLD) != signal.SIG_DFL
                or not hasattr(select, "kqueue")):
            return RouteResult("unavailable", None, "exit_observer_unavailable")
        _ticks()
        if (type(owner_lease_until_ms) is not int
                or owner_lease_until_ms > 9223372036854775807
                or owner_lease_until_ms < claim["lease_until_ms"]):
            return RouteResult("unavailable", None, "insufficient_lease")
        environment = {key: os.environ[key] for key in ("HOME", "LANG", "TMPDIR") if key in os.environ}
        environment["PATH"] = "/usr/bin:/bin"
        guard.verify()
        now = int(time.time() * 1000)
        if min(owner_lease_until_ms, claim["lease_until_ms"]) - now < 7000:
            return RouteResult("unavailable", None, "insufficient_lease")
        started_at = datetime.now(timezone.utc).isoformat()
        deadline = _ticks() + 5000000000
    except RouteUnavailable as error:
        if error.code in ("binding_mismatch", "guard_mismatch"):
            raise
        return RouteResult("unavailable", None, error.code)
    except (OSError, AttributeError, ValueError):
        return RouteResult("unavailable", None, "invocation_unavailable")

    child = queue = None
    fault = None
    timed_out = False
    unavailable = False
    launch_error = None
    originals = {}
    installed = []
    pending_signals = {}

    def defer_signal(number, frame):
        pending_signals.setdefault(number, frame)

    def restore_signals():
        for number in list(installed):
            signal.signal(number, originals[number])
            installed.remove(number)

    def drain_signals():
        restore_signals()
        first_error = None
        for number in (signal.SIGINT, signal.SIGTERM):
            if number not in pending_signals:
                continue
            frame = pending_signals.pop(number)
            handler = originals[number]
            try:
                if callable(handler):
                    handler(number, frame)
                elif handler != signal.SIG_IGN:
                    raise AdapterFault("invocation_interrupted")
            except BaseException as error:
                if first_error is None:
                    first_error = error
        if first_error is not None:
            raise first_error

    try:
        # Custom caught dispositions reset on child exec. Unlike blocking the
        # parent's signal mask, this leaves the child's TERM deliverable. The
        # dedicated caller already uses graceful stop flags after launch.
        originals = {number: signal.getsignal(number) for number in (signal.SIGINT, signal.SIGTERM)}
        for number, handler in originals.items():
            if handler != signal.SIG_IGN:
                signal.signal(number, defer_signal)
                installed.append(number)
        child = subprocess.Popen(prepared.argv, executable=prepared.executable,
            shell=False, start_new_session=True, pass_fds=pass_fds, env=environment,
            stdin=subprocess.PIPE, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        # Deliver only after ownership and restoration, within the managed try.
        drain_signals()
        registered = record_child(child.pid, started_at)
        if (not isinstance(registered, dict) or registered.get("status") != "recorded"
                or registered.get("instance_id") != claim["route_binding"]["instance_id"]
                or not _remaining(deadline)):
            raise AdapterFault("child_registration_failed")
        queue = select.kqueue()
        exited = _watch_exit(queue, child, deadline)
        os.set_blocking(child.stdin.fileno(), False)
        pending = memoryview(prepared.stdin)
        while not exited:
            left = _remaining(deadline)
            if (not left or int(time.time() * 1000) >= min(owner_lease_until_ms, claim["lease_until_ms"])):
                timed_out = True
                break
            if pending:
                try:
                    count = os.write(child.stdin.fileno(), pending)
                    if count <= 0:
                        raise AdapterFault("stdin_write_failed")
                    pending = pending[count:]
                except (BlockingIOError, InterruptedError):
                    pass
                except BrokenPipeError:
                    pending = pending[len(pending):]
            if not pending and not child.stdin.closed:
                child.stdin.close()
            events = queue.control(None, 1, min(left, 0.025))
            for event in events:
                if event.flags & select.KQ_EV_ERROR:
                    raise AdapterFault("exit_observation_failed")
                if event.ident == child.pid and event.fflags & select.KQ_NOTE_EXIT:
                    exited = True
    except BaseException as error:
        if child is None:
            launch_error = error
        if child is None and isinstance(error, (OSError, AttributeError, ValueError)):
            unavailable = True
        else:
            fault = error if isinstance(error, AdapterFault) else AdapterFault("invocation_fault")
    finally:
        try:
            drain_signals()
        except BaseException as error:
            fault = error if isinstance(error, AdapterFault) else AdapterFault("invocation_fault")
        for resource in (child.stdin if child is not None else None, queue):
            if resource is not None:
                try:
                    resource.close()
                except BaseException:
                    fault = AdapterFault("invocation_fault")

    if child is None:
        if unavailable and fault is None:
            return RouteResult("unavailable", None, "invocation_unavailable")
        raise (fault or AdapterFault("invocation_fault")) from launch_error
    try:
        exit_code, descendants = _cleanup_child(child)
    except BaseException as error:
        _UNCONFIRMED_CHILDREN.append(child)
        raise AdapterFault("cleanup_unconfirmed") from error
    if fault is not None:
        raise fault from None
    if timed_out:
        return RouteResult("error", exit_code, "deadline")
    if descendants:
        return RouteResult("error", exit_code, "surviving_descendant")
    if exit_code == 0:
        return RouteResult("accepted", 0, "accepted")
    if exit_code == 75:
        return RouteResult("busy", 75, "busy")
    return RouteResult("error", exit_code, "broker_exit")


def _identity(value):
    return isinstance(value, str) and 0 < len(value) <= 200 and all(ord(c) >= 32 for c in value)


def _absolute(value):
    return isinstance(value, str) and "\x00" not in value and Path(value).is_absolute()


def _unique(pairs):
    value = {}
    for key, item in pairs:
        if key in value:
            raise RouteUnavailable("invalid_route")
        value[key] = item
    return value


def _constant(unused):
    raise RouteUnavailable("invalid_route")


def _read_route(path):
    fd = None
    try:
        if path is None or not _absolute(os.fspath(path)):
            raise RouteUnavailable("missing_route")
        fd = os.open(os.fspath(path), os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
        info = os.fstat(fd)
        if (not stat.S_ISREG(info.st_mode) or info.st_uid != os.getuid()
                or info.st_mode & 0o077 or info.st_size > MAX_ROUTE_BYTES):
            raise RouteUnavailable("invalid_route")
        with os.fdopen(fd, "rb") as source:
            fd = None
            raw = source.read(MAX_ROUTE_BYTES + 1)
        if len(raw) > MAX_ROUTE_BYTES:
            raise RouteUnavailable("invalid_route")
        return json.loads(raw.decode("utf-8"), object_pairs_hook=_unique, parse_constant=_constant)
    except (OSError, ValueError, UnicodeError, RecursionError) as error:
        raise RouteUnavailable("invalid_route") from error
    finally:
        if fd is not None:
            os.close(fd)


def _executable(value):
    try:
        executable = Path(value).resolve(strict=True)
        info = executable.stat()
        if (not stat.S_ISREG(info.st_mode) or not os.access(str(executable), os.X_OK)
                or info.st_uid not in (0, os.getuid()) or info.st_mode & 0o022):
            raise RouteUnavailable("invalid_executable")
        for parent in executable.parents:
            info = parent.stat()
            if (not stat.S_ISDIR(info.st_mode) or info.st_uid not in (0, os.getuid())
                    or info.st_mode & 0o022):
                raise RouteUnavailable("invalid_executable")
        return str(executable)
    except (OSError, ValueError, RuntimeError) as error:
        raise RouteUnavailable("invalid_executable") from error


def _claim(value):
    if not isinstance(value, dict) or set(value) != CLAIM_FIELDS:
        raise RouteUnavailable("invalid_claim")
    if any(not _identity(value[key]) for key in ("attempt_id", "claim_token", "recipient_id")):
        raise RouteUnavailable("invalid_claim")
    if any(type(value[key]) is not int or not 0 <= value[key] <= 9223372036854775807
           for key in ("wake_generation", "captured_seq", "lease_until_ms")):
        raise RouteUnavailable("invalid_claim")
    binding = value["route_binding"]
    if (not isinstance(binding, dict) or set(binding) != BINDING_FIELDS
            or any(not _identity(binding[key]) for key in BINDING_FIELDS - {"db_path"})
            or not _absolute(binding["db_path"]) or binding["actor_id"] != value["recipient_id"]):
        raise RouteUnavailable("invalid_claim")
    return binding


def prepare_route(route_path, claim, guard):
    """Validate one explicit route against a captured claim and a real held guard.

    This reads only; it neither starts a child nor proves a durable runner lease.
    The invocation layer must revalidate ownership, remaining time and this guard
    immediately before spawning. A PreparedRoute must never be kept as authority.
    """
    binding = _claim(claim)
    if not isinstance(guard, RunnerGuard):
        raise RouteUnavailable("invalid_guard")
    try:
        guard.verify()
        value = _read_route(route_path)
        if (not isinstance(value, dict) or set(value) != {"v", "profile", "argv"}
                or type(value["v"]) is not int or value["v"] != 1
                or not _absolute(value["profile"])):
            raise RouteUnavailable("invalid_route")
        argv = value["argv"]
        if (not isinstance(argv, list) or not 1 <= len(argv) <= 32
                or any(not isinstance(arg, str) or "\x00" in arg for arg in argv)
                or not _absolute(argv[0])):
            raise RouteUnavailable("invalid_route")
        if sum(len(arg.encode("utf-8")) + 1 for arg in argv) > MAX_ARG_BYTES:
            raise RouteUnavailable("invalid_route")
        profile = load_profile(value["profile"])
        actual = {"instance_id": profile.instance_id, "actor_id": profile.actor_id,
                  "db_path": str(profile.db_path), "authority_id": profile.authority_id,
                  "authority_epoch": profile.authority_epoch}
        if actual != binding:
            raise RouteUnavailable("binding_mismatch")
        if guard.binding != dict(profile.binding, instance_id=profile.instance_id, db_path=str(profile.db_path)):
            raise RouteUnavailable("guard_mismatch")
        executable = _executable(argv[0])
        payload = {"v": 1, "binding": dict(binding), "wake_generation": claim["wake_generation"],
                   "attempt_id": claim["attempt_id"]}
        encoded = (json.dumps(payload, ensure_ascii=False, separators=(",", ":")) + "\n").encode("utf-8")
        if len(encoded) > MAX_STDIN_BYTES:
            raise RouteUnavailable("invalid_claim")
        guard.verify()
        return PreparedRoute(tuple(argv), encoded, executable)
    except ProfileError as error:
        # Storage and authority verdicts after a claim belong to the caller's
        # pause path, never an unavailable settlement or retry decision here.
        if error.code is not None or isinstance(error.__cause__, StoreError):
            raise
        raise RouteUnavailable("profile_unavailable") from error
    except UnicodeError as error:
        raise RouteUnavailable("invalid_route") from error

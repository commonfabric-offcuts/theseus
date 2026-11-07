from __future__ import annotations

"""Bring the agent runner back when it ends, where that is safe.

One supervisor process starts one runner process and waits on the kernel's
exit event for it; it never polls and keeps no timer. When the runner ends,
the supervisor tells Core how (`record_runner_exit`), which Core writes only
while that process still held the runner role. It starts the runner again
only when all of these hold:

- nobody asked the supervisor to stop (TERM or INT, which it passes to the
  runner, the one process it started);
- the runner did not stop itself cleanly (0) or refuse to run or pause (2);
- Core recorded the exit, so this runner still held the role when it ended:
  no other runner took over, nothing paused it, and it got as far as
  acquiring it;
- it has not ended within RUN_AT_START_S of starting RUNS_AT_START times in
  a row, which would only repeat a fault.

Before starting it again it waits for the runner guard to be free: a broker
child of the runner that ended inherits the guard and may still hold it.
Its own events go to stderr as JSON lines; the runner's own output passes
through untouched, so its last stdout line is still its result.

One pause it resumes on its own: cleanup_failed, saved by the runner it
started. That pause names the broker child whose process group the runner
could not confirm gone. Once the runner has exited, the supervisor waits on
that group's members' exit events until two process listings in a row find
no live member of it (re-listing after a short doubling pause only while a
member it cannot watch is part-way through exiting), then starts the runner
with the pause's exact version and the recorded reason cleanup_confirmed. It
never signals that group. If a listing fails, gone is not known: it stops
with not_restarting (child_group_unobserved) and a person decides. Any other
pause, or a pause another process saved, still needs a person.
"""

import argparse
import json
import os
from pathlib import Path
import select
import signal
import sys
import time

RUN_AT_START_S = 30
RUNS_AT_START = 3
STOP_SIGNALS = (signal.SIGTERM, signal.SIGINT)
# Exit statuses of the runner (effects_runner.main): a clean stop, and a refusal or pause.
STOPPED, REFUSED = 0, 2


class _Stop(Exception):
    """A stop arrived while no runner was running: start nothing more.

    Its argument names what the supervisor was waiting for."""


class Supervisor:
    def __init__(self, child_argv, record_exit, wait_for_guard, emit, *, clock=time.monotonic,
                 cleanup_pause=None, wait_group_gone=None):
        self.child_argv = list(child_argv)
        self.record_exit, self.wait_for_guard, self.emit, self.clock = record_exit, wait_for_guard, emit, clock
        # cleanup_pause(pid): the cleanup pause that runner saved, or None.
        # wait_group_gone(pgid): None once no live process is in that group,
        # or the code of the observation that failed.
        self.cleanup_pause, self.wait_group_gone = cleanup_pause, wait_group_gone
        self.child = None
        self.stopping = False
        # What it waits for between runs (a stop then ends the wait), or None.
        self.waiting = None

    def _signal(self, signum, frame):
        self.stopping = True
        if self.child is not None:
            os.kill(self.child, signum)
        elif self.waiting is not None:
            raise _Stop(self.waiting)

    def run(self):
        previous = {number: signal.signal(number, self._signal) for number in STOP_SIGNALS}
        try:
            return self._run()
        except _Stop as stop:
            self._event("stopped", **{"while": stop.args[0]})
            return STOPPED
        finally:
            for number, handler in previous.items():
                signal.signal(number, handler)

    def _event(self, name, **fields):
        self.emit(dict(event=name, **fields))

    def _run(self):
        at_start = 0
        extra = []
        while True:
            started = self.clock()
            pid = self._spawn(extra)
            if pid is None:
                self._event("stopped", **{"while": "starting"})
                return STOPPED
            code = self._wait(pid)
            ran = self.clock() - started
            record = self.record_exit(pid, code)
            self._event("runner_exited", pid=pid, exit=code, ran_s=round(ran, 3), record=record)
            at_start = at_start + 1 if ran < RUN_AT_START_S else 0
            why = self._why_not_again(code, record, at_start)
            pause = self._resumable(pid, why, at_start)
            if why is not None and pause is None:
                self._event("not_restarting", why=why)
                return code if code >= 0 else 128 - code
            extra = []
            try:
                if pause is not None:
                    self.waiting = "waiting_for_child_group"
                    if self.stopping:
                        raise _Stop(self.waiting)
                    child = dict(version=pause["version"], child_pid=pause["child_pid"],
                                 child_started_at=pause["child_started_at"])
                    self._event("awaiting_child_group", **child)
                    failed = self.wait_group_gone(pause["child_pid"])
                    if failed is not None:
                        self.waiting = None
                        self._event("not_restarting", why="child_group_unobserved", detail=failed, **child)
                        return code
                    self._event("resuming", reason="cleanup_confirmed", **child)
                    extra = ["--resume-version", str(pause["version"]), "--resume-reason", "cleanup_confirmed"]
                self.waiting = "waiting_for_guard"
                if self.stopping:
                    raise _Stop(self.waiting)
                if pause is None:
                    self._event("restarting", after="guard_free")
                self.wait_for_guard()
            finally:
                self.waiting = None

    def _resumable(self, pid, why, at_start):
        """The cleanup pause this runner saved, if the supervisor may wait it out."""
        if why != "refused_or_paused" or at_start >= RUNS_AT_START or self.cleanup_pause is None:
            return None
        return self.cleanup_pause(pid)

    def _why_not_again(self, code, record, at_start):
        if self.stopping:
            return "stopping"
        if code == STOPPED:
            return "stopped"
        if code == REFUSED:
            return "refused_or_paused"
        if record.get("status") != "recorded":
            return record.get("status") or "unrecorded"
        if at_start >= RUNS_AT_START:
            return "ending_at_start"
        return None

    def _spawn(self, extra=()):
        """Start the runner with no signal blocked, in its own group, so only the supervisor passes a terminal's ^C on."""
        argv = self.child_argv + list(extra)
        old = signal.pthread_sigmask(signal.SIG_BLOCK, STOP_SIGNALS)
        try:
            if self.stopping:
                return None
            # A stop that arrives now waits until self.child names the runner, then reaches it.
            self.child = os.posix_spawn(argv[0], argv, os.environ,
                                        setpgroup=0, setsigmask=(), setsigdef=STOP_SIGNALS)
            self._event("runner_started", pid=self.child)
            return self.child
        finally:
            signal.pthread_sigmask(signal.SIG_SETMASK, old)

    def _wait(self, pid):
        """Wait on the runner's exit event without reaping it, so a stop never signals a reaped pid."""
        kq = select.kqueue()
        try:
            try:
                kq.control([select.kevent(pid, select.KQ_FILTER_PROC, select.KQ_EV_ADD | select.KQ_EV_ONESHOT,
                                          select.KQ_NOTE_EXIT)], 0)
            except ProcessLookupError:
                pass  # It has already exited and waits to be reaped.
            else:
                kq.control(None, 1, None)
        finally:
            kq.close()
        old = signal.pthread_sigmask(signal.SIG_BLOCK, STOP_SIGNALS)
        try:
            _, status = os.waitpid(pid, 0)
            self.child = None
        finally:
            signal.pthread_sigmask(signal.SIG_SETMASK, old)
        return os.waitstatus_to_exitcode(status)


def core_hooks(profile_path):
    """Record an exit in, and wait for the runner guard of, the instance the runner profile names."""
    from .authority import AuthorityError
    from .contract import StoreError
    from .profile import ProfileError, load_profile
    from .runner import RunnerError
    known = (AuthorityError, StoreError, ProfileError, RunnerError)

    def record_exit(pid, code):
        try:
            return load_profile(profile_path).store().record_runner_exit(pid, code)
        except known as error:
            # Could not record is not "did not hold the role": say which.
            reason = getattr(error, "code", None)
            return {"status": "unrecorded", "code": reason if isinstance(reason, str) else type(error).__name__}

    def wait_for_guard():
        load_profile(profile_path).store().wait_for_runner_guard()

    return record_exit, wait_for_guard


def resume_hooks(profile_path):
    """Read, from Core, the cleanup pause a given runner saved; and wait for a process group to go."""
    from .authority import AuthorityError
    from .contract import StoreError
    from .profile import ProfileError, load_profile
    from .runner import RunnerError
    from .wake_adapter import wait_group_gone
    known = (AuthorityError, StoreError, ProfileError, RunnerError)

    def cleanup_pause(pid):
        try:
            status = load_profile(profile_path).store().runner_status()
        except known:
            # Could not read is not "no pause": either way a person decides.
            return None
        registered = status.get("holder") or status.get("last_registered") or {}
        child = registered.get("child_pid")
        if (status.get("state") != "paused" or status.get("reason_code") != "cleanup_failed"
                or registered.get("runner_pid") != pid or type(child) is not int or child <= 1
                or type(status.get("version")) is not int):
            return None
        return {"version": status["version"], "child_pid": child,
                "child_started_at": registered.get("child_started_at")}

    return {"cleanup_pause": cleanup_pause, "wait_group_gone": wait_group_gone}


def child_argv(argv):
    return [sys.executable, "-I", str(Path(__file__).resolve().parents[1] / "bin" / "aim-next-runner"), *argv]


def main(argv):
    """`aim-next-runner supervise <runner arguments>`: supervise this checkout's runner, run with the same arguments."""
    parser = argparse.ArgumentParser(prog="aim-next-runner supervise",
                                     description="Run the agent runner and start it again when that is safe")
    parser.add_argument("--profile", required=True)
    known, _ = parser.parse_known_args(argv)

    def report(event):
        print(json.dumps(event, separators=(",", ":")), file=sys.stderr, flush=True)
    return Supervisor(child_argv(argv), *core_hooks(known.profile), report, **resume_hooks(known.profile)).run()

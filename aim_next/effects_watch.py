from __future__ import annotations

import math
import os
from pathlib import Path
import select
import signal
import stat
import sys


# Darwin's SDK value; Python 3.9 does not export this open(2) flag.
O_EVTONLY = 0x00008000


class WatchError(Exception):
    """A fixed refusal: never follow or silently reopen a watched database."""


class NativeWatch:
    """One database descriptor and one wait for vnode and stop signals.

    Companion files (such as the authority anchor) are watched too: any event
    on one is reported as dirty, so the caller reads and checks its binding,
    and a companion that is replaced or removed sets companion_moved.

    The caller must finish every SQLite connection's cleanup before close().
    Event/identity failure leaves the descriptor open for that ordering.
    """

    def __init__(self, path, companions=()):
        self.path = Path(path)
        self.fd = None
        self.queue = None
        self.stopped = False
        self.companion_moved = False
        self.companion_fds = []
        self.original_signals = {}
        try:
            if sys.platform != 'darwin' or not hasattr(select, 'kqueue') or not self.path.is_absolute():
                raise WatchError('watch_unavailable')
            for number in (signal.SIGINT, signal.SIGTERM):
                original = signal.getsignal(number)
                signal.signal(number, self._stop_signal)
                self.original_signals[number] = original
            self.fd = os.open(self.path, O_EVTONLY | os.O_NOFOLLOW | os.O_CLOEXEC)
            os.set_inheritable(self.fd, False)
            info = os.fstat(self.fd)
            self.identity = (info.st_dev, info.st_ino)
            self.verify()
            for companion in companions:
                if not Path(companion).is_absolute():
                    raise WatchError('watch_unavailable')
                self.companion_fds.append(os.open(str(companion), O_EVTONLY | os.O_NOFOLLOW | os.O_CLOEXEC))
            self.queue = select.kqueue()
            self.queue.control([
                *[select.kevent(fd, filter=select.KQ_FILTER_VNODE,
                    flags=select.KQ_EV_ADD | select.KQ_EV_ENABLE | select.KQ_EV_CLEAR,
                    fflags=select.KQ_NOTE_WRITE | select.KQ_NOTE_DELETE | select.KQ_NOTE_RENAME | select.KQ_NOTE_REVOKE)
                  for fd in [self.fd] + self.companion_fds],
                *[select.kevent(number, filter=select.KQ_FILTER_SIGNAL,
                    flags=select.KQ_EV_ADD | select.KQ_EV_ENABLE | select.KQ_EV_CLEAR)
                  for number in self.original_signals]], 0, 0)
        except (OSError, ValueError, AttributeError, WatchError) as error:
            self.close()
            raise WatchError('watch_unavailable') from error

    def _stop_signal(self, number, frame):
        self.stopped = True

    def verify(self):
        try:
            current = self.path.lstat()
            opened = os.fstat(self.fd)
            if (not stat.S_ISREG(current.st_mode) or not stat.S_ISREG(opened.st_mode)
                    or (current.st_dev, current.st_ino) != self.identity
                    or (opened.st_dev, opened.st_ino) != self.identity):
                raise WatchError('watch_identity_changed')
        except OSError as error:
            raise WatchError('watch_identity_changed') from error

    def wait(self, timeout):
        """Wait for a database write or a stop signal; None waits for the event alone, with no timer."""
        if timeout is not None and (not isinstance(timeout, (int, float)) or not math.isfinite(timeout) or not 0 <= timeout <= 60):
            raise WatchError('invalid_wait')
        self.verify()
        try:
            events = self.queue.control(None, 8, 0 if self.stopped else timeout)
        except InterruptedError:
            events = []
        except OSError as error:
            raise WatchError('watch_wait_failed') from error
        dirty = False
        for event in events:
            if event.flags & select.KQ_EV_ERROR:
                raise WatchError('watch_wait_failed')
            if event.filter == select.KQ_FILTER_SIGNAL:
                self.stopped = True
            if event.filter == select.KQ_FILTER_VNODE and event.ident in self.companion_fds:
                dirty = True
                if event.fflags & (select.KQ_NOTE_DELETE | select.KQ_NOTE_RENAME | select.KQ_NOTE_REVOKE):
                    self.companion_moved = True
            elif event.filter == select.KQ_FILTER_VNODE:
                if event.fflags & (select.KQ_NOTE_DELETE | select.KQ_NOTE_RENAME | select.KQ_NOTE_REVOKE):
                    raise WatchError('watch_identity_changed')
                dirty = dirty or bool(event.fflags & select.KQ_NOTE_WRITE)
        self.verify()
        return dict(dirty=dirty, stop=self.stopped)

    def close(self):
        error = None
        if self.queue is not None:
            try:
                self.queue.close()
            except OSError as caught:
                error = caught
            self.queue = None
        for fd in [self.fd] + self.companion_fds:
            if fd is None:
                continue
            try:
                os.close(fd)
            except OSError as caught:
                error = error or caught
        self.fd = None
        self.companion_fds = []
        for number, original in self.original_signals.items():
            signal.signal(number, original)
        self.original_signals.clear()
        if error is not None:
            raise WatchError('watch_close_unconfirmed') from error

    def __enter__(self):
        return self

    def __exit__(self, *unused):
        self.close()

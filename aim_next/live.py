from __future__ import annotations

import json
import os
from pathlib import Path
import sqlite3
import threading

from .contract import StoreError
from .effects_watch import NativeWatch, WatchError
from . import delivery
from .store import _connect


# The longest busy wait SQLite takes (milliseconds): the feed's read waits out
# a writer's lock for as long as the writer holds it.
LOCK_WAIT_MS = 2 ** 31 - 1


class LiveFeed:
    """Announces each new commit to the browser streams that are open.

    One thread waits on the database file. The store runs in rollback-journal
    mode, so every commit writes that file under the writer's exclusive lock;
    after each write the thread reads commit_seq, which it can read only once
    that lock is released, and wakes every stream when the number moved. A
    stream carries only that number, and with it what is red at that commit
    (docs/health.md): what changed is read through the usual views, so the
    feed adds no new way to see records. Core keeps what is red with every
    commit, in the same transaction (metadata health_light, {red, seq}); the
    thread reads it in the same statement as the number, and the stream sends
    it only when its seq is that number, so it is never an answer from an
    older commit. Every page can read what is red (the health_light view), so
    this shows nobody anything new either.

    The thread's first act is to read the current number, so a writer that
    holds its lock while the server starts delays the first message rather
    than keeping the feed from starting; until then a stream waits.

    Each read waits for the lock in SQLite's own busy wait, on one
    connection, however long a writer holds it. Nothing ends that wait
    early (sqlite3_interrupt does not reach it), so stopping does not wait
    for it: the streams end at once, and the thread closes the watch and
    the stop pipe itself once the lock goes.

    The feed ends, and says why, when the database or the authority anchor is
    moved, when the commit number cannot be read, or when the server stops.

    With each read it also learns which process Core records as the running
    agent runner, and asks the kernel for that process's exit event. When the
    process ends, or is already gone when first seen, it calls runner_gone(pid)
    from this thread, so whoever must be told that wakes stopped is told at
    once, with no clock involved. Core decides whether that pid still held the
    role. An exit is acted on by the read that follows it, so a commit that
    came with it (the runner's own clean stop) is seen first. runner_gone
    returns whether Core answered; when it did not (a writer held the lock past
    the store's wait), the pid is forgotten, and the read after the next commit
    finds it still recorded as running, and gone, and says so again.

    Some changes to what is red come with no act and no commit: a hung
    runner's process lives, so it has no exit event, and its lease running
    out is the one sign; a stop that no runner follows is told once it has
    lasted (health.py). Core keeps the next such moment (metadata
    health_due), the same read learns it, and the thread's wait lasts no
    longer than that. When it comes with no commit first, it calls
    health_due(due_ms), and Core settles what is red on a commit of its own,
    so the team is told and every page reads it. Any act that moves the
    moment is a commit, so the read after it moves the wait with it.
    health_due returns Core's status, or None when Core could not be told;
    then, as with an exit, the read after the next commit asks again.
    "early" (this clock and Core's disagree by a moment) waits again for the
    same moment.
    """

    def __init__(self, db_path, companions=(), max_streams=8, runner_gone=None, health_due=None):
        self.db_path = Path(db_path)
        self.lock = threading.Lock()
        self.slots = threading.BoundedSemaphore(max_streams)
        self.wakers = {}  # each stream's read end: its write end
        self.seq = None  # until the thread's first read
        self.light = None  # what is red at self.seq, or None when Core kept none for it
        self.ended = None
        self.stopped = False
        self.reading = False  # the thread is in a read that may wait on a writer's lock
        self.detached = False  # stop() left the thread to close what it holds
        self.runner_gone = runner_gone
        self.runner_pid = None  # the runner process whose exit this feed asked the kernel for
        self.health_due = health_due
        self.due_told = None  # the moment Core has been asked to settle
        self.stop_read, self.stop_write = os.pipe()
        self.watch = None
        try:
            self.watch = NativeWatch(self.db_path, companions, signals=False)
            self.watch.watch_reader(self.stop_read)
        except BaseException:
            self._close_watch()
            self._close_pipe()
            raise
        self.thread = threading.Thread(target=self._run, name="theseus-live-feed", daemon=True)
        self.thread.start()

    def _read_seq(self):
        # A write event arrives while its writer still holds the lock; this
        # read waits for the commit to finish rather than see the old number.
        # The connection is the store's own (read-write, with its durability
        # settings), kept from SQL writes by query_only. It is not read-only:
        # Apple's SQLite fails a writer's lock with "disk I/O error" while a
        # read-only connection in the same process holds a shared lock. And it
        # may still write: if another process died mid-commit, the first reader
        # rolls its journal back, and does so with the store's full sync.
        db, _ = _connect(self.db_path, LOCK_WAIT_MS)
        try:
            db.execute("PRAGMA query_only=ON")
            # One statement, so the number and what is red with it are one snapshot.
            values = dict(db.execute("SELECT key,value FROM metadata WHERE key IN ('commit_seq','health_due','health_light')"))
            runner = db.execute("SELECT runner_pid FROM runner_state WHERE id=1 AND state='running'").fetchone()
        finally:
            db.close()
        row, due = values.get("commit_seq"), values.get("health_due")
        if not isinstance(row, str) or not row.isascii() or not row.isdigit():
            raise ValueError("commit_seq is unreadable")
        due = due if isinstance(due, str) and due.isascii() and due.isdigit() else None
        return int(row), runner[0] if runner else None, None if due is None else int(due), _light(values.get("health_light"), int(row))

    def _settled_seq(self):
        """The commit number, the running runner's pid and Core's next health moment once no writer holds the lock, or None if the feed is stopping.

        The read waits on the writer's lock for as long as it is held, so the
        feed never ends, or fails to start, because a commit was slow.
        Releasing a lock writes nothing to watch, so this read is what sees it go."""
        with self.lock:
            if self.stopped:
                return None
            self.reading = True
        try:
            read = self._read_seq()
        finally:
            with self.lock:
                self.reading = False
                stopped = self.stopped
        return None if stopped else read

    def _run(self):
        reason = "stopped"
        try:
            # The watch is open before this first read, so no commit falls between them.
            dirty, due = True, None
            while True:
                if dirty:
                    read = self._settled_seq()
                    if read is None:
                        break
                    seq, runner, due, light = read
                    with self.lock:
                        if seq != self.seq:
                            self.seq, self.light = seq, light
                            self._wake_all()
                    if not self._watch_runner(runner):
                        break
                    if self.health_due is None or due == self.due_told:
                        due = None
                result = self.watch.wait(self._until(due))
                if self.stop_read in result["readable"]:
                    break
                if self.watch.companion_moved:
                    reason = "binding_changed"
                    break
                exited = self.runner_pid in result["exited"]
                if exited:
                    self.runner_pid = None
                dirty = result["dirty"] or exited
                if not dirty and due is not None and delivery._now_ms() >= due:
                    told = self._due_came(due)
                    if told is False:
                        break
                    # Told, or Core could not be told: either way the read after
                    # the next commit decides (an act moves the moment on).
                    if told != "early":
                        due = None
        except WatchError:
            reason = "database_moved"
        except (sqlite3.Error, StoreError, ValueError, OSError):
            reason = "unconfirmed"
        finally:
            with self.lock:
                if self.ended is None:
                    self.ended = reason
                self._wake_all()
                detached = self.detached
            self._close_watch()
            if detached:
                self._close_pipe()

    def _watch_runner(self, pid):
        """Ask for the exit event of a runner process not yet watched; False if the feed is stopping.

        A runner no longer running (stopped, paused, or its end already
        recorded) is forgotten: its process's end says nothing new."""
        if self.runner_gone is None or pid == self.runner_pid:
            return True
        self.runner_pid = pid
        if pid is None:
            return True
        try:
            if self.watch.watch_process(pid):
                return True
        except WatchError:
            # The kernel will not report this process's exit (another user's
            # runner): its end is known when its lease runs out, as before.
            return True
        return self._runner_ended(pid)

    @staticmethod
    def _until(due):
        """How long the thread's wait may last: until Core's moment, within NativeWatch's bound; None waits with no end."""
        if due is None:
            return None
        return min(60, max(0, due - delivery._now_ms() + 1) / 1000.0)

    def _due_came(self, due):
        """Ask Core to settle what is red at its moment: Core's status, "untold" when it could not be told, False if the feed is stopping."""
        with self.lock:
            if self.stopped:
                return False
            self.reading = True
        try:
            status = self.health_due(due)
        finally:
            with self.lock:
                self.reading = False
                stopped = self.stopped
        if stopped:
            return False
        if status not in (None, "early"):
            self.due_told = due
        return status if status is not None else "untold"

    def _runner_ended(self, pid):
        """Say the runner process ended; False if the feed is stopping. The call may wait on a writer's lock."""
        with self.lock:
            if self.stopped:
                return False
            self.reading = True
        try:
            answered = self.runner_gone(pid)
        finally:
            with self.lock:
                self.reading = False
                stopped = self.stopped
        if not answered:
            self.runner_pid = None
        return not stopped

    def _wake_all(self):
        for waker in self.wakers.values():
            try:
                os.write(waker, b"!")
            except (BlockingIOError, BrokenPipeError):
                # A full pipe already wakes its stream; a closed one is leaving.
                pass

    def _close_watch(self):
        if self.watch is not None:
            watch, self.watch = self.watch, None
            watch.unwatch_reader(self.stop_read)
            watch.close()

    def _close_pipe(self):
        os.close(self.stop_read)
        os.close(self.stop_write)

    def state(self):
        """(latest commit number or None before the first read, why the feed ended or None)."""
        with self.lock:
            return self.seq, self.ended

    def snapshot(self):
        """(latest commit number, what is red at it or None, why the feed ended or None), read together."""
        with self.lock:
            return self.seq, self.light, self.ended

    def subscribe(self):
        """A descriptor that becomes readable on each new commit and when the feed ends,
        or None when every stream slot is taken."""
        if not self.slots.acquire(blocking=False):
            return None
        try:
            read, write = os.pipe()
        except OSError:
            self.slots.release()
            raise
        try:
            os.set_blocking(write, False)
        except OSError:
            os.close(read)
            os.close(write)
            self.slots.release()
            raise
        with self.lock:
            self.wakers[read] = write
            if self.ended is not None:
                os.write(write, b"!")
        return read

    def unsubscribe(self, read):
        with self.lock:
            write = self.wakers.pop(read)
        os.close(read)
        os.close(write)
        self.slots.release()

    def stop(self):
        """End the feed and every stream.

        The thread is joined, and the stop pipe stays open until it is, unless
        it is in a read that a writer's lock may hold: then the streams end
        now, and the thread closes the watch and the pipe when that read returns."""
        with self.lock:
            if self.stopped:
                return
            self.stopped = True
            self.detached = self.reading
            if self.detached:
                self.ended = "stopped"
                self._wake_all()
        if self.detached:
            return
        os.write(self.stop_write, b"!")
        self.thread.join()
        self._close_pipe()


def _light(text, seq):
    """What is red at commit seq, as {"red": [...], "seq": seq}, from Core's kept value; None when
    Core kept none for that commit (an older Core, or a commit that did not settle it)."""
    try:
        value = json.loads(text) if isinstance(text, str) else None
    except ValueError:
        return None
    if (not isinstance(value, dict) or type(value.get("seq")) is not int or value["seq"] != seq
            or not isinstance(value.get("red"), list) or not all(isinstance(key, str) for key in value["red"])):
        return None
    return {"red": value["red"], "seq": seq}

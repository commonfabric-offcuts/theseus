from __future__ import annotations

import os
from pathlib import Path
import sqlite3
import threading

from .contract import StoreError
from .effects_watch import NativeWatch, WatchError
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
    stream carries only that number: what changed is read through the usual
    views, so the feed adds no new way to see records.

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
    """

    def __init__(self, db_path, companions=(), max_streams=8):
        self.db_path = Path(db_path)
        self.lock = threading.Lock()
        self.slots = threading.BoundedSemaphore(max_streams)
        self.wakers = {}  # each stream's read end: its write end
        self.seq = None  # until the thread's first read
        self.ended = None
        self.stopped = False
        self.reading = False  # the thread is in a read that may wait on a writer's lock
        self.detached = False  # stop() left the thread to close what it holds
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
            row = db.execute("SELECT value FROM metadata WHERE key='commit_seq'").fetchone()
        finally:
            db.close()
        if row is None or not isinstance(row[0], str) or not row[0].isascii() or not row[0].isdigit():
            raise ValueError("commit_seq is unreadable")
        return int(row[0])

    def _settled_seq(self):
        """The commit number once no writer holds the lock, or None if the feed is stopping.

        The read waits on the writer's lock for as long as it is held, so the
        feed never ends, or fails to start, because a commit was slow.
        Releasing a lock writes nothing to watch, so this read is what sees it go."""
        with self.lock:
            if self.stopped:
                return None
            self.reading = True
        try:
            seq = self._read_seq()
        finally:
            with self.lock:
                self.reading = False
                stopped = self.stopped
        return None if stopped else seq

    def _run(self):
        reason = "stopped"
        try:
            # The watch is open before this first read, so no commit falls between them.
            dirty = True
            while True:
                if dirty:
                    seq = self._settled_seq()
                    if seq is None:
                        break
                    with self.lock:
                        if seq != self.seq:
                            self.seq = seq
                            self._wake_all()
                result = self.watch.wait(None)
                if self.stop_read in result["readable"]:
                    break
                if self.watch.companion_moved:
                    reason = "binding_changed"
                    break
                dirty = result["dirty"]
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

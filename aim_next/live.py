from __future__ import annotations

import os
import select
from pathlib import Path
import sqlite3
import threading

from .contract import StoreError
from .effects_watch import NativeWatch, WatchError
from .store import _connect


class LiveFeed:
    """Announces each new commit to the browser streams that are open.

    One thread waits on the database file. The store runs in rollback-journal
    mode, so every commit writes that file under the writer's exclusive lock;
    after each write the thread reads commit_seq, which it can read only once
    that lock is released, and wakes every stream when the number moved. A
    stream carries only that number: what changed is read through the usual
    views, so the feed adds no new way to see records.

    The feed ends, and says why, when the database or the authority anchor is
    moved, when the commit number cannot be read, or when the server stops.
    """

    def __init__(self, db_path, companions=(), max_streams=8):
        self.db_path = Path(db_path)
        self.lock = threading.Lock()
        self.slots = threading.BoundedSemaphore(max_streams)
        self.wakers = {}  # each stream's read end: its write end
        self.ended = None
        self.stopped = False
        self.stop_read, self.stop_write = os.pipe()
        self.watch = None
        try:
            self.watch = NativeWatch(self.db_path, companions, signals=False)
            self.watch.watch_reader(self.stop_read)
            self.seq = self._read_seq()
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
        db, _ = _connect(self.db_path)
        try:
            db.execute("PRAGMA query_only=ON")
            row = db.execute("SELECT value FROM metadata WHERE key='commit_seq'").fetchone()
        finally:
            db.close()
        if row is None or not isinstance(row[0], str) or not row[0].isascii() or not row[0].isdigit():
            raise ValueError("commit_seq is unreadable")
        return int(row[0])

    def _settled_seq(self):
        """The commit number once the writer that fired the event is done, or None if the feed is stopping.

        Each read waits on the writer's lock. A writer that holds it longer
        than one read waits is still writing, so the read is asked again; the
        feed never ends because a commit was slow."""
        while True:
            try:
                return self._read_seq()
            except sqlite3.OperationalError as error:
                if "locked" not in str(error).lower() and "busy" not in str(error).lower():
                    raise
            if self.stop_read in select.select([self.stop_read], [], [], 0)[0]:
                return None

    def _run(self):
        reason = "stopped"
        try:
            while True:
                result = self.watch.wait(None)
                if self.stop_read in result["readable"]:
                    break
                if self.watch.companion_moved:
                    reason = "binding_changed"
                    break
                if result["dirty"]:
                    seq = self._settled_seq()
                    if seq is None:
                        break
                    with self.lock:
                        if seq != self.seq:
                            self.seq = seq
                            self._wake_all()
        except WatchError:
            reason = "database_moved"
        except (sqlite3.Error, StoreError, ValueError, OSError):
            reason = "unconfirmed"
        finally:
            with self.lock:
                self.ended = reason
                self._wake_all()
            self._close_watch()

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
        """(latest commit number, why the feed ended or None)."""
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
        """End the feed and every stream; the stop pipe stays open until the thread is joined."""
        with self.lock:
            if self.stopped:
                return
            self.stopped = True
        os.write(self.stop_write, b"!")
        self.thread.join()
        self._close_pipe()

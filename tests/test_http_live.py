from __future__ import annotations

import hashlib
import http.client
import json
import os
import select
import socket
from pathlib import Path
import sqlite3
import subprocess
import sys
import tempfile
import textwrap
import threading
import unittest
from unittest import mock

from aim_next import initialize, Store
from aim_next import live as live_module
from aim_next import server as server_module
from aim_next.effects_watch import WatchError
from aim_next.server import create_server


class LiveClient:
    """The browser's side of the live WebSocket: masked frames out, plain frames in."""

    def __init__(self, connection):
        self.connection, self.buffer = connection, b""

    def exactly(self, size):
        while len(self.buffer) < size:
            data = self.connection.recv(4096)
            if not data:
                raise EOFError("the server closed the socket")
            self.buffer += data
        data, self.buffer = self.buffer[:size], self.buffer[size:]
        return data

    def until(self, marker):
        while marker not in self.buffer:
            data = self.connection.recv(4096)
            if not data:
                raise EOFError("the server closed the socket")
            self.buffer += data
        data, _, self.buffer = self.buffer.partition(marker)
        return data

    def frame(self):
        first, second = self.exactly(2)
        assert first & 0x80 and not second & 0x80, "a server frame is final and unmasked"
        size = second & 0x7F
        if size == 126:
            size = int.from_bytes(self.exactly(2), "big")
        return first & 0x0F, self.exactly(size)

    def send(self, opcode, payload=b"", masked=True):
        mask = b"\x01\x02\x03\x04"
        if masked:
            body = bytes([0x80 | opcode, 0x80 | len(payload)]) + mask + bytes(b ^ mask[i % 4] for i, b in enumerate(payload))
        else:
            body = bytes([0x80 | opcode, len(payload)]) + payload
        self.connection.sendall(body)


class LiveStreamTests(unittest.TestCase):
    """GET /api/live: a WebSocket message per new commit number, over real files and a real native watch."""

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name).resolve()
        self.db = self.root / "records.sqlite3"
        self.authority = self.root / "authority.json"
        self.binding = initialize(self.db, "isolated-test", [{"id": "test-human", "kind": "human"}],
                                  authority_path=self.authority)["binding"]
        self.pin = {key: self.binding[key] for key in ("authority_id", "authority_epoch")}
        self.store = Store(self.db, "isolated-test", expected_binding=self.binding)
        self.revision = 0
        self.connections = []
        self.start()

    def start(self, live=True, streams=8):
        self.server = create_server(lambda: Store(self.db, "isolated-test", expected_binding=self.binding),
                                    "isolated-test", "test-human", self.root, token="live-session",
                                    live=(self.db, (self.authority,), streams) if live else None)
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()

    def stop(self):
        self.server.shutdown()
        self.server.server_close()
        self.thread.join(5)
        self.assertFalse(self.thread.is_alive())

    def tearDown(self):
        for connection in self.connections:
            connection.close()
        if self.thread.is_alive():
            self.stop()
        self.tmp.cleanup()

    def open(self, token="live-session", origin=None, protocols=None, upgrade=True, headers=None):
        """A live WebSocket, or the JSON refusal (status, body) when the server refuses one.

        headers replaces or adds handshake headers; a None value leaves one out."""
        address = "%s:%d" % self.server.server_address
        connection = socket.create_connection(self.server.server_address, timeout=5)
        self.connections.append(connection)
        if protocols is None:
            protocols = "theseus-live.v1, bearer." + token
        fields = {"Host": address, "Origin": origin or self.server.origin, "Sec-WebSocket-Protocol": protocols,
                  "Sec-WebSocket-Version": "13", "Sec-WebSocket-Key": "dGhlIHNhbXBsZSBub25jZQ=="}
        if upgrade:
            fields.update({"Upgrade": "websocket", "Connection": "Upgrade"})
        fields.update(headers or {})
        lines = ["GET /api/live HTTP/1.1"] + ["%s: %s" % item for item in fields.items() if item[1] is not None]
        connection.sendall(("\r\n".join(lines) + "\r\n\r\n").encode())
        client = LiveClient(connection)
        head = client.until(b"\r\n\r\n").decode("latin-1").split("\r\n")
        status = int(head[0].split()[1])
        headers = dict(line.split(": ", 1) for line in head[1:] if line)
        if status != 101:
            return status, json.loads(client.exactly(int(headers["Content-Length"])))
        self.assertEqual(headers["Sec-WebSocket-Protocol"], "theseus-live.v1")
        # RFC 6455's own example key and answer.
        self.assertEqual(headers["Sec-WebSocket-Accept"], "s3pPLMBiTxaQ9kYGzzhZRbK+xOo=")
        return client

    def line(self, client):
        opcode, payload = client.frame()
        self.assertEqual(opcode, 1)
        return json.loads(payload)

    def closed(self, client):
        """The server's close frame, then nothing more."""
        self.assertEqual(client.frame(), (8, b"\x03\xe8"))
        self.assertEqual(client.connection.recv(1), b"")

    def commit(self, title="Live"):
        self.revision += 1
        result = self.store.command("test-human", {
            "v": 1, "instance_id": "isolated-test", "operation_id": "live-%d" % self.revision,
            "kind": "workspace.create", "target": {},
            "expected": {"authority": dict(self.pin), "workspace_revision": 0},
            "args": {"id": "w-live-%d" % self.revision, "title": title, "team": []}})
        self.assertTrue(result.get("recorded"), result)

    def seq(self):
        with sqlite3.connect(str(self.db)) as db:
            return int(db.execute("SELECT value FROM metadata WHERE key='commit_seq'").fetchone()[0])

    def bootstrap(self):
        connection = http.client.HTTPConnection(*self.server.server_address, timeout=5)
        try:
            connection.request("GET", "/api/bootstrap", headers={"Authorization": "Bearer live-session"})
            return json.loads(connection.getresponse().read())
        finally:
            connection.close()

    def test_a_stream_starts_at_the_current_commit_and_announces_each_new_one(self):
        client = self.open()
        self.assertEqual(self.line(client), {"seq": self.seq()})
        other = self.open()
        self.assertEqual(self.line(other), {"seq": self.seq()})
        for _ in range(3):
            self.commit()
            expected = {"seq": self.seq()}
            self.assertEqual(self.line(client), expected)
            self.assertEqual(self.line(other), expected)

    def test_the_feed_never_fails_a_writer_in_its_own_process(self):
        # The feed reads the commit number right after each write, inside the
        # process whose store writes; these commits land back to back with it.
        for n in range(200):
            self.commit("Back to back %d" % n)
        self.assertIsNone(self.server.live_feed.state()[1])

    def test_a_mark_made_over_http_is_announced_like_any_commit(self):
        # Other pages learn of a mark only from this announcement; a mark changes no topic version.
        pin = dict(self.pin)
        self.commit()
        for operation, kind, target, args, expected in (
                ("open-o1", "opening.save", {"opening_id": "o1"},
                 {"workspace_id": "w-live-1", "topic_id": "t1", "title": "Marks", "participants": [], "body": "Come back to this", "attachments": []},
                 {"opening_revision": 0}),
                ("open-o1-publish", "opening.publish", {"opening_id": "o1"}, {}, {"opening_revision": 1})):
            result = self.store.command("test-human", {"v": 1, "instance_id": "isolated-test", "operation_id": operation, "kind": kind,
                                                       "target": target, "expected": dict(expected, authority=pin), "args": args})
            self.assertEqual(result.get("status"), "committed", result)
        message = result["result"]["message_id"]
        client = self.open()
        # The stream may begin before the feed has read the commits above; it announces each in turn.
        start = self.seq()
        while self.line(client)["seq"] != start:
            pass
        connection = http.client.HTTPConnection(*self.server.server_address, timeout=5)
        try:
            connection.request("POST", "/api/command", body=json.dumps({
                "v": 1, "instance_id": "isolated-test", "operation_id": "mark-1", "kind": "message.mark",
                "target": {"message_id": message}, "expected": {"authority": pin, "mark_revision": 0},
                "args": {"marked": True}}).encode(), headers={
                "Authorization": "Bearer live-session", "Origin": self.server.origin, "Content-Type": "application/json"})
            receipt = json.loads(connection.getresponse().read())
        finally:
            connection.close()
        self.assertEqual((receipt["status"], receipt["result"]["mark_revision"]), ("committed", 1), receipt)
        self.assertEqual((self.line(client), self.seq()), ({"seq": start + 1}, start + 1))

    def runner_state(self):
        with sqlite3.connect(str(self.db)) as db:
            return db.execute("SELECT state,reason_code,runner_pid FROM runner_state").fetchone()

    def runner_process(self):
        """A stand-in runner process: it runs until this test ends it."""
        child = subprocess.Popen([sys.executable, "-I", "-c", "import sys; sys.stdin.read()"], stdin=subprocess.PIPE)
        self.addCleanup(lambda: (child.kill(), child.wait(), child.stdin.close()))
        return child

    def telling(self):
        """Serve again, keeping what the server says when a runner process ends; self.told_one is set at each."""
        told, self.told_one = [], threading.Event()
        def tell(event):
            told.append(event)
            self.told_one.set()
        self.stop()
        with mock.patch.object(server_module, "_stderr", tell):
            self.start()
        return told

    def take_runner(self, pid):
        """Take the runner role and record pid as its process, as the runner's own acquire records itself."""
        with self.store.runner_guard("live-runner") as guard:
            self.assertEqual(self.store.acquire_runner(guard)["status"], "acquired")
        with sqlite3.connect(str(self.db)) as db:
            db.execute("UPDATE runner_state SET runner_pid=? WHERE id=1", (pid,))

    def settled(self, client):
        """Commit twice and read up to the second: the feed has finished acting on everything before the first."""
        for _ in range(2):
            self.commit()
            seq = self.seq()
            while True:
                line = self.line(client)
                self.assertIn("seq", line, "the feed ended")
                if line["seq"] >= seq:
                    break

    def announced(self, client):
        """The stream's next line; the socket's timeout, which guards a hang, fails the test."""
        try:
            return self.line(client)
        except socket.timeout:
            self.fail("nothing more was announced; the runner is recorded as %r" % (self.runner_state(),))

    def until_runner(self, client, state, lines=4):
        """Read the stream's commits until the runner's recorded state is this one."""
        for _ in range(lines):
            if self.runner_state()[0] == state:
                return self.runner_state()
            self.assertIn("seq", self.announced(client), "the feed ended")
        return self.runner_state()

    def test_a_runner_process_that_ends_without_a_word_is_recorded_and_announced_at_once(self):
        told = self.telling()
        client = self.open()
        self.line(client)
        child = self.runner_process()
        self.take_runner(child.pid)
        self.settled(client)
        # The server learned of the runner from a commit; it learns of its end from the kernel, with no clock.
        child.kill()
        child.wait()
        # The next line every open page gets is the commit that records the end, and the feed goes on.
        line = self.announced(client)
        self.assertEqual((line, self.runner_state()), ({"seq": self.seq()}, ("exited", "ended", child.pid)))
        self.settled(client)
        view = self.store.view("test-human", "wakes", {})
        self.assertEqual((view["runner"]["state"], view["runner"]["reason"]), ("exited", "ended"))
        self.assertEqual([(event["event"], event["pid"], event["record"]["status"]) for event in told],
                         [("runner_gone", child.pid, "recorded")])

    def test_a_runner_process_already_gone_when_the_server_starts_is_recorded_at_once(self):
        self.stop()
        child = self.runner_process()
        child.kill()
        child.wait()
        self.take_runner(child.pid)
        self.start()
        client = self.open()
        self.assertEqual(self.until_runner(client, "exited"), ("exited", "ended", child.pid))

    def test_a_runner_process_the_kernel_will_not_watch_leaves_the_feed_running(self):
        """Another user's runner cannot be watched: its end is known from its lease, and every commit is still announced."""
        client = self.open()
        self.line(client)
        child = self.runner_process()
        refused = mock.patch.object(live_module.NativeWatch, "watch_process", side_effect=WatchError("watch_unavailable"))
        with refused as watch_process:
            self.take_runner(child.pid)
            self.settled(client)
        self.assertEqual(watch_process.call_args.args, (child.pid,))
        self.settled(client)
        self.assertEqual(self.runner_state(), ("running", None, child.pid))

    def test_a_runner_that_stopped_cleanly_is_not_said_to_have_ended_when_its_process_goes(self):
        told = self.telling()
        client = self.open()
        self.line(client)
        child = self.runner_process()
        with self.store.runner_guard("live-runner") as guard:
            token = self.store.acquire_runner(guard)["runner_token"]
            with sqlite3.connect(str(self.db)) as db:
                db.execute("UPDATE runner_state SET runner_pid=? WHERE id=1", (child.pid,))
            # The server watches this process now.
            self.settled(client)
            self.assertEqual(self.store.stop_runner(guard, token)["status"], "stopped")
        self.settled(client)
        child.kill()
        child.wait()
        self.settled(client)
        self.assertEqual(self.runner_state(), ("stopped", None, child.pid))
        self.assertEqual(told, [])

    def test_a_read_announces_nothing(self):
        client = self.open()
        start = self.line(client)["seq"]
        self.assertEqual(self.store.view("test-human", "workspaces", {}).get("error"), None)
        self.commit()
        # The next message is the commit's number, so the read sent none of its own.
        self.assertEqual(self.line(client), {"seq": start + 1})

    def test_bootstrap_offers_live_only_when_the_instance_has_it(self):
        self.assertEqual(self.bootstrap()["transport"]["live"], {"version": 2, "path": "/api/live", "protocol": "theseus-live.v1"})
        self.stop()
        self.start(live=False)
        self.assertNotIn("live", self.bootstrap().get("transport", {}))
        status, body = self.open()
        self.assertEqual((status, body["error"]["code"]), (503, "LIVE_UNAVAILABLE"))

    def test_a_stream_needs_the_page_origin_the_session_and_a_websocket(self):
        for kwargs, expected in (({"token": "wrong"}, (401, "SESSION_REQUIRED")),
                                 ({"protocols": "theseus-live.v1"}, (401, "SESSION_REQUIRED")),
                                 ({"protocols": "bearer.live-session"}, (401, "SESSION_REQUIRED")),
                                 ({"protocols": "theseus-live.v1, bearer.live-session, bearer.live-session"}, (401, "SESSION_REQUIRED")),
                                 ({"origin": "http://elsewhere.example"}, (403, "ORIGIN_REFUSED")),
                                 ({"upgrade": False}, (400, "WEBSOCKET_REQUIRED")),
                                 # Each WebSocket requirement on its own.
                                 ({"headers": {"Upgrade": None}}, (400, "WEBSOCKET_REQUIRED")),
                                 ({"headers": {"Connection": "keep-alive"}}, (400, "WEBSOCKET_REQUIRED")),
                                 ({"headers": {"Sec-WebSocket-Version": "8"}}, (400, "WEBSOCKET_REQUIRED")),
                                 ({"headers": {"Sec-WebSocket-Key": "c2hvcnQ="}}, (400, "WEBSOCKET_REQUIRED")),
                                 ({"headers": {"Sec-WebSocket-Key": None}}, (400, "WEBSOCKET_REQUIRED"))):
            with self.subTest(kwargs=kwargs):
                status, body = self.open(**kwargs)
                self.assertEqual((status, body["error"]["code"]), expected)
        # An ordinary request with the session header is not a stream either.
        connection = http.client.HTTPConnection(*self.server.server_address, timeout=5)
        try:
            connection.request("GET", "/api/live", headers={"Authorization": "Bearer live-session", "Origin": self.server.origin})
            response = connection.getresponse()
            self.assertEqual((response.status, json.loads(response.read())["error"]["code"]), (401, "SESSION_REQUIRED"))
        finally:
            connection.close()
        self.assertEqual(len(self.server.live_feed.wakers), 0)

    def test_a_ping_is_answered_and_a_close_is_echoed_and_frees_the_slot(self):
        self.stop()
        self.start(streams=1)
        client = self.open()
        self.line(client)
        client.send(9, b"hi")
        self.assertEqual(client.frame(), (10, b"hi"))
        self.commit()
        self.assertEqual(self.line(client), {"seq": self.seq()})
        client.send(8, b"\x03\xe8bye")
        self.assertEqual(client.frame(), (8, b"\x03\xe8"))
        self.assertEqual(client.connection.recv(1), b"")
        self.assertEqual(self.line(self.open()), {"seq": self.seq()})

    def test_anything_but_a_control_frame_ends_the_stream(self):
        for opcode, masked in ((1, True), (2, True), (9, False)):
            with self.subTest(opcode=opcode, masked=masked):
                client = self.open()
                self.line(client)
                client.send(opcode, b"{}", masked=masked)
                frames = []
                try:
                    while True:
                        frames.append(client.frame())
                except EOFError:
                    pass
                self.assertTrue(all(opcode == 8 for opcode, _ in frames), frames)
        self.assertEqual(len(self.server.live_feed.wakers), 0)

    def test_a_frame_that_is_not_a_plain_ping_ends_the_stream(self):
        mask = b"\x01\x02\x03\x04"
        hi = bytes(b ^ mask[i % 4] for i, b in enumerate(b"hi"))
        frames = {
            # A ping that is not final: control frames are never fragmented.
            "fragmented": bytes([0x09, 0x82]) + mask + hi,
            # A reserved bit set, with no extension agreed.
            "reserved bit": bytes([0xC9, 0x82]) + mask + hi,
            # Extended length: a control frame carries at most 125 bytes. The
            # last two bytes start another masked ping, so a reader that took
            # 126 as the length would wait for it rather than close.
            "extended length": bytes([0x89, 0xFE, 0x00, 0x7E]) + mask + b"x" * 124 + b"\x89\x85",
        }
        for name, raw in frames.items():
            with self.subTest(frame=name):
                client = self.open()
                self.line(client)
                client.connection.sendall(raw)
                self.assertEqual(client.frame(), (8, b""))
                self.assertEqual(client.connection.recv(1), b"")

    def test_a_client_that_pings_without_reading_has_one_answer_waiting_at_most(self):
        # Small buffers on both ends, so the server's answers back up after a
        # few kilobytes rather than after megabytes of kernel buffer.
        self.server.socket.setsockopt(socket.SOL_SOCKET, socket.SO_SNDBUF, 4096)
        client = self.open()
        client.connection.setsockopt(socket.SOL_SOCKET, socket.SO_RCVBUF, 4096)
        self.line(client)
        mask, count = b"\x01\x02\x03\x04", 4000
        def ping(n):
            payload = b"%06d" % n + b"x" * 119
            return bytes([0x89, 0x80 | len(payload)]) + mask + bytes(b ^ mask[i % 4] for i, b in enumerate(payload))
        client.connection.sendall(b"".join(ping(n) for n in range(count)))
        last, answers = b"%06d" % (count - 1), 0
        while True:
            opcode, payload = client.frame()
            self.assertEqual(opcode, 10)
            answers += 1
            if payload.startswith(last):
                break
        # The pings that arrived while an answer could not be written were
        # answered once, by the answer to the latest of them.
        self.assertLess(answers, count // 2)
        self.commit()
        self.assertEqual(self.line(client), {"seq": self.seq()})

    def test_streams_are_bounded_and_a_closed_stream_frees_its_slot(self):
        self.stop()
        self.start(streams=1)
        first = self.open()
        self.assertEqual(self.line(first), {"seq": self.seq()})
        status, body = self.open()
        self.assertEqual((status, body["error"]["code"]), (503, "SERVER_BUSY"))
        feed, released = self.server.live_feed, threading.Event()
        unsubscribe = feed.unsubscribe
        feed.unsubscribe = lambda stream: (unsubscribe(stream), released.set())
        first.connection.close()
        self.assertTrue(released.wait(5))
        self.assertEqual(self.line(self.open()), {"seq": self.seq()})

    def test_a_failed_subscription_gives_its_slot_back(self):
        self.stop()
        self.start(streams=1)
        pipe = live_module.os.pipe
        live_module.os.pipe = lambda: (_ for _ in ()).throw(OSError("out of descriptors"))
        try:
            with self.assertRaises(OSError):
                self.server.live_feed.subscribe()
        finally:
            live_module.os.pipe = pipe
        self.assertEqual(self.line(self.open()), {"seq": self.seq()})

    def test_stopping_the_server_ends_every_stream_with_a_reason(self):
        clients = [self.open(), self.open()]
        for client in clients:
            self.line(client)
        self.stop()
        for client in clients:
            self.assertEqual(self.line(client), {"end": "stopped"})
            self.closed(client)

    def test_a_replaced_authority_anchor_ends_the_stream(self):
        client = self.open()
        self.line(client)
        replacement = self.root / "authority.json.next"
        replacement.write_bytes(self.authority.read_bytes())
        os.replace(replacement, self.authority)
        self.assertEqual(self.line(client), {"end": "binding_changed"})
        self.closed(client)
        self.assertNotIn("live", self.bootstrap().get("transport", {}))

    def test_a_moved_database_ends_the_stream(self):
        client = self.open()
        self.line(client)
        os.replace(self.db, self.root / "moved.sqlite3")
        self.assertEqual(self.line(client), {"end": "database_moved"})

    def test_an_unreadable_commit_number_ends_the_stream_and_live_is_no_longer_offered(self):
        client = self.open()
        self.line(client)
        def unreadable():
            raise ValueError("commit_seq is unreadable")
        self.server.live_feed._read_seq = unreadable
        self.commit()
        self.assertEqual(self.line(client), {"end": "unconfirmed"})
        self.closed(client)
        self.assertNotIn("live", self.bootstrap().get("transport", {}))

    def count_opens(self):
        """Every connection the feed opens from now on, and an event set once it begins one."""
        opens, opened, connect = [], threading.Event(), live_module._connect
        def counted(*args, **kwargs):
            opens.append(1)
            opened.set()
            return connect(*args, **kwargs)
        live_module._connect = counted
        self.addCleanup(setattr, live_module, "_connect", connect)
        return opens, opened

    def outwait_a_store_read(self):
        """Returns once a read that waits more than twice the store's own busy wait has given up on the lock."""
        db = sqlite3.connect(str(self.db), isolation_level=None, timeout=0.6)
        try:
            with self.assertRaisesRegex(sqlite3.OperationalError, "locked"):
                db.execute("SELECT value FROM metadata WHERE key='commit_seq'").fetchone()
        finally:
            db.close()

    def spill_under_lock(self, client, settled=lambda: None):
        """Another connection that holds the writer's exclusive lock, having written pages into the file.

        The feed has read every earlier commit, and settled() has run, before the lock is taken."""
        holder = sqlite3.connect(str(self.db), isolation_level=None)
        holder.execute("BEGIN IMMEDIATE")
        holder.execute("CREATE TABLE spill(v TEXT)")
        holder.executemany("INSERT INTO spill VALUES (?)", [("x" * 200,)] * 5000)
        holder.execute("COMMIT")
        self.commit()
        self.assertEqual(self.line(client), {"seq": self.seq()})
        settled()
        opens, opened = self.count_opens()
        holder.execute("PRAGMA cache_size=2")
        holder.execute("PRAGMA cache_spill=1")
        holder.execute("BEGIN IMMEDIATE")
        holder.execute("UPDATE spill SET v = v || 'y'")
        return holder, opens, opened

    def test_a_writer_that_holds_its_lock_long_is_waited_for_on_one_connection(self):
        client = self.open()
        self.line(client)
        holder, opens, opened = self.spill_under_lock(client)
        try:
            self.assertTrue(opened.wait(5), "the feed never read after the writer's pages")
            self.outwait_a_store_read()
            self.assertEqual(len(opens), 1, "the feed's read was asked again while the lock was held")
        finally:
            holder.execute("ROLLBACK")
            holder.close()
        self.commit()
        self.assertEqual(self.line(client), {"seq": self.seq()})
        self.assertIsNone(self.server.live_feed.state()[1])

    def test_stopping_does_not_wait_for_a_writer_that_holds_its_lock(self):
        client = self.open()
        self.line(client)
        feed = self.server.live_feed
        holder, _, opened = self.spill_under_lock(client)
        stopper = None
        try:
            self.assertTrue(opened.wait(5), "the feed's read never met the lock")
            stopped = threading.Event()
            stopper = threading.Thread(target=lambda: (self.stop(), stopped.set()), daemon=True)
            stopper.start()
            self.assertTrue(stopped.wait(5), "stopping waited for the writer's lock")
            self.assertEqual(self.line(client), {"end": "stopped"})
        finally:
            holder.execute("ROLLBACK")
            holder.close()
            if stopper is not None:
                stopper.join()
        # The read the lock held ends when the lock goes, and the feed's thread
        # then closes its watch and its stop pipe.
        feed.thread.join()
        self.assertIsNone(feed.watch)
        for descriptor in (feed.stop_read, feed.stop_write):
            with self.assertRaises(OSError):
                os.fstat(descriptor)

    def test_a_feed_stopped_just_before_its_read_does_not_begin_it(self):
        # Stopping joins a thread that is not reading; that thread must not
        # then begin a read the writer's lock would hold.
        client = self.open()
        self.line(client)
        feed, entered, release = self.server.live_feed, threading.Event(), threading.Event()
        settled = feed._settled_seq
        def paused():
            entered.set()
            release.wait(5)
            return settled()
        holder, opens, _ = self.spill_under_lock(client, lambda: setattr(feed, "_settled_seq", paused))
        stopper = None
        try:
            self.assertTrue(entered.wait(5), "the feed never read after the writer's pages")
            stopped = threading.Event()
            stopper = threading.Thread(target=lambda: (self.stop(), stopped.set()), daemon=True)
            stopper.start()
            # The paused thread does not read its stop pipe; stop() has written it.
            self.assertEqual(select.select([feed.stop_read], [], [], 5)[0], [feed.stop_read])
            release.set()
            self.assertTrue(stopped.wait(5), "stopping waited for the writer's lock")
            self.assertEqual(opens, [])
        finally:
            release.set()
            holder.execute("ROLLBACK")
            holder.close()
            if stopper is not None:
                stopper.join()
        self.assertEqual(self.line(client), {"end": "stopped"})

    def test_a_writer_that_holds_its_lock_at_start_delays_the_feed_on_one_connection(self):
        self.stop()
        holder = sqlite3.connect(str(self.db), isolation_level=None)
        holder.execute("BEGIN EXCLUSIVE")
        opens, opened = self.count_opens()
        try:
            # Starting does not wait on the lock: the feed's thread does.
            self.start()
            self.assertIsNotNone(self.server.live_feed)
            client = self.open()
            self.assertTrue(opened.wait(5), "the feed's first read never began")
            self.outwait_a_store_read()
            self.assertEqual(len(opens), 1, "the feed's first read was asked again while the lock was held")
            self.assertEqual(self.server.live_feed.state(), (None, None))
        finally:
            holder.execute("ROLLBACK")
            holder.close()
        # Releasing a lock writes nothing; the waiting read sees it go.
        self.assertEqual(self.line(client), {"seq": self.seq()})
        self.assertIn("live", self.bootstrap()["transport"])
        self.commit()
        self.assertEqual(self.line(client), {"seq": self.seq()})

    def test_without_a_feed_a_stream_is_still_refused_its_session_and_origin_first(self):
        self.stop()
        self.start(live=False)
        for kwargs, expected in (({"token": "wrong"}, (401, "SESSION_REQUIRED")),
                                 ({"origin": "http://elsewhere.example"}, (403, "ORIGIN_REFUSED")),
                                 ({}, (503, "LIVE_UNAVAILABLE"))):
            with self.subTest(kwargs=kwargs):
                status, body = self.open(**kwargs)
                self.assertEqual((status, body["error"]["code"]), expected)

    def test_a_writer_that_died_mid_commit_is_rolled_back_and_the_feed_carries_on(self):
        client = self.open()
        start = self.line(client)["seq"]
        # Another process writes through the store's connection, spills pages
        # into the database file, and dies before it commits.
        child = textwrap.dedent("""
            import os, sys
            sys.path.insert(0, sys.argv[2])
            from aim_next.store import _connect
            db, _ = _connect(sys.argv[1])
            if sys.argv[3] == "grow":
                db.execute("BEGIN IMMEDIATE")
                db.execute("CREATE TABLE spill(v TEXT)")
                db.executemany("INSERT INTO spill VALUES (?)", [("x" * 200,)] * 5000)
                db.execute("COMMIT")
                sys.exit(0)
            db.execute("PRAGMA cache_size=2")
            db.execute("PRAGMA cache_spill=1")
            db.execute("BEGIN IMMEDIATE")
            db.execute("UPDATE spill SET v = v || 'y'")
            db.execute("UPDATE metadata SET value='999999' WHERE key='commit_seq'")
            os._exit(0)
            """)
        feed, entered, release, done = self.server.live_feed, threading.Event(), threading.Event(), threading.Event()
        settled = feed._settled_seq
        def held():
            # The feed thread waits here until the test has seen the dead writer's journal.
            entered.set()
            release.wait()
            try:
                return settled()
            finally:
                done.set()
        for step in ("grow", "die"):
            subprocess.run([sys.executable, "-I", "-c", child, str(self.db), str(Path(__file__).resolve().parents[1]), step], check=True)
            if step == "grow":
                before = hashlib.sha256(self.db.read_bytes()).digest()
                feed._settled_seq = held
        self.assertTrue(entered.wait(5))
        self.assertTrue(Path(str(self.db) + "-journal").exists())
        self.assertNotEqual(hashlib.sha256(self.db.read_bytes()).digest(), before)
        release.set()
        # The feed's read rolls the journal back rather than end the feed.
        self.assertTrue(done.wait(5))
        self.assertFalse(Path(str(self.db) + "-journal").exists())
        self.assertEqual(hashlib.sha256(self.db.read_bytes()).digest(), before)
        self.assertIsNone(feed.state()[1])
        self.commit()
        self.assertEqual(self.line(client), {"seq": start + 1})
        self.assertIsNone(self.server.live_feed.state()[1])

    def test_without_a_native_watch_the_instance_serves_and_leaks_nothing(self):
        self.stop()
        watch = live_module.NativeWatch
        def refused(*args, **kwargs):
            raise WatchError("no watch here")
        live_module.NativeWatch = refused
        try:
            before = len(os.listdir("/dev/fd"))
            self.start()
            self.assertIsNone(self.server.live_feed)
            self.assertEqual(len(os.listdir("/dev/fd")), before + 1, "only the listening socket is new")
        finally:
            live_module.NativeWatch = watch
        self.assertNotIn("live", self.bootstrap().get("transport", {}))
        status, body = self.open()
        self.assertEqual((status, body["error"]["code"]), (503, "LIVE_UNAVAILABLE"))

if __name__ == "__main__":
    unittest.main()

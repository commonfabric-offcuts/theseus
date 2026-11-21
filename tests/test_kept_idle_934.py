from __future__ import annotations

import http.client
import socket
import threading
import time
import unittest

import test_web_build as fixtures


class KeptIdleCase(unittest.TestCase):
    setUp = fixtures.ServedBuildTests.setUp
    stop = fixtures.ServedBuildTests.stop

    def connection(self):
        conn = http.client.HTTPConnection(*self.server.server_address, timeout=4)
        self.addCleanup(conn.close)
        return conn

    def static(self, conn):
        conn.request('GET', '/b/%s/app.mjs' % self.server.build.stamp)
        response = conn.getresponse()
        body = response.read()
        self.assertEqual(response.status, 200)
        self.assertEqual(body, b'export const ready = true;\n')
        return response

    def raw(self):
        sock = socket.create_connection(self.server.server_address, timeout=3)
        self.addCleanup(sock.close)
        return sock

    def request_bytes(self, extra=b'', path=b'/'):
        return b'GET ' + path + b' HTTP/1.1\r\nHost: ' + self.server.authority.encode() + b'\r\n' + extra + b'\r\n'

    def answer(self, sock):
        response = http.client.HTTPResponse(sock)
        response.begin()
        response.read()
        return response

    def until(self, predicate):
        end = time.monotonic() + 1
        while not predicate():
            self.assertLess(time.monotonic(), end, 'actual connection ownership did not settle')
            time.sleep(.005)

    def test_sixteen_idle_kept_sockets_leave_the_seventeenth_request_admitted(self):
        kept = [self.connection() for _ in range(16)]
        for conn in kept:
            self.assertFalse(self.static(conn).will_close)
        extra = self.connection()
        self.static(extra)
        # Original sockets still exist: the successful seventeenth was not
        # obtained by waiting for the default idle timeout to expire.
        for conn in kept:
            self.assertIsNotNone(conn.sock)

    def test_default_idle_close_is_about_two_seconds_and_hint_is_sent(self):
        conn = self.connection()
        response = self.static(conn)
        started = time.monotonic()
        conn.sock.settimeout(3.0)
        self.assertEqual(conn.sock.recv(1), b'', 'idle kept socket must actually close')
        elapsed = time.monotonic() - started
        self.assertGreaterEqual(elapsed, 1.7)
        self.assertLess(elapsed, 2.8)
        self.assertEqual(response.getheader('Keep-Alive'), 'timeout=2')

    def test_duplicate_lengths_transfer_encoding_and_later_close_field_never_keep(self):
        for extra in (b'Content-Length: 0\r\nContent-Length: 0\r\n',
                      b'Content-Length: 0\r\nContent-Length: 5\r\n',
                      b'Content-Length: 5\r\nContent-Length: 0\r\n',
                      b'Transfer-Encoding: \r\nTransfer-Encoding: chunked\r\n',
                      b'Connection: keep-alive\r\nConnection: Close\r\n'):
            with self.subTest(extra=extra):
                sock = self.raw()
                sock.sendall(self.request_bytes(extra))
                response = self.answer(sock)
                self.assertEqual(response.status, 200)
                self.assertTrue(response.will_close)
                sock.settimeout(.5)
                self.assertEqual(sock.recv(1), b'')

    def test_an_arrived_request_uses_the_original_deadline_not_the_idle_cutoff(self):
        self.server.request_timeout = 1.0
        self.server.keep_alive_timeout = .12
        conn = self.connection()
        self.static(conn)
        sock = conn.sock
        sock.sendall(b'G')
        time.sleep(.22)
        sock.sendall(self.request_bytes(b'Connection: close\r\n', b'/api/build')[1:])
        self.assertEqual(self.answer(sock).status, 200)

    def test_dripping_reused_request_does_not_renew_its_absolute_deadline(self):
        self.server.request_timeout = .30
        self.server.keep_alive_timeout = .20
        conn = self.connection()
        self.static(conn)
        sock = conn.sock
        started = time.monotonic()
        sock.sendall(b'G')
        for data in (b'E', b'T', b' ', b'/'):
            time.sleep(.085)
            try:
                sock.sendall(data)
            except (BrokenPipeError, ConnectionResetError):
                break
        sock.settimeout(.2)
        try:
            data = sock.recv(1)
        except ConnectionResetError:
            data = b''
        self.assertEqual(data, b'')
        self.assertLess(time.monotonic() - started, .55)

    def test_pipelined_static_then_api_keep_framing_and_release_ownership(self):
        sock = self.raw()
        sock.sendall(self.request_bytes() + self.request_bytes(path=b'/api/build'))
        wire = sock.makefile('rb')
        self.addCleanup(wire.close)
        for connection in ('keep-alive', 'close'):
            self.assertEqual(wire.readline(), b'HTTP/1.1 200 OK\r\n')
            headers = http.client.parse_headers(wire)
            length = int(headers['Content-Length'])
            self.assertEqual(len(wire.read(length)), length)
            self.assertEqual(headers['Connection'], connection)
        self.static(self.connection())

    def test_idle_pool_is_bounded_separately_and_overflow_closes(self):
        self.server.connection_slots = threading.BoundedSemaphore(1)
        self.server.idle_connection_slots = threading.BoundedSemaphore(1)
        one = self.connection()
        self.static(one)
        self.until(lambda: self.server.connection_slots._value == 1)
        two = self.connection()
        self.static(two)
        two.sock.settimeout(.5)
        self.assertEqual(two.sock.recv(1), b'', 'idle pool overflow closes rather than retaining another thread')
        self.until(lambda: self.server.connection_slots._value == 1)
        self.assertEqual(self.server.idle_connection_slots._value, 0, 'the first socket owns the one idle permit')

    def test_reuse_reacquires_active_admission_and_refusal_or_eof_recovers_permits(self):
        self.server.connection_slots = threading.BoundedSemaphore(1)
        conn = self.connection()
        self.static(conn)
        self.until(lambda: self.server.connection_slots._value == 1)
        active = self.raw()
        active.sendall(b'G')
        self.until(lambda: self.server.connection_slots._value == 0)
        conn.sock.sendall(self.request_bytes(path=b'/api/build'))
        response = self.answer(conn.sock)
        self.assertEqual(response.status, 503)
        self.assertTrue(response.will_close)
        active.close()
        self.until(lambda: self.server.connection_slots._value == 1)
        again = self.connection()
        self.static(again)
        again.close()
        self.until(lambda: self.server.connection_slots._value == 1)
        self.until(lambda: self.server.idle_connection_slots._value == 16)


if __name__ == '__main__':
    unittest.main()

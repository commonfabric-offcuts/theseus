from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
import socket
import tempfile
import threading
import unittest

from aim_next.server import create_server


class ListenQueue936Case(unittest.TestCase):
    def test_cold_load_burst_waits_in_listener_then_receives_every_document(self):
        burst = 12  # Beyond the old five, within the unchanged active-worker cap.
        with tempfile.TemporaryDirectory(prefix='listen-936-') as temporary:
            web = Path(temporary)
            (web / 'index.html').write_text('cold-load-document')
            def no_store():
                raise AssertionError('static listener check must not open Core')
            server = create_server(no_store, 'listen-936', 'fixture-reader', web)
            connections, thread = [], None
            try:
                ready = threading.Barrier(burst + 1)
                def connect():
                    connection = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
                    connections.append(connection)
                    connection.settimeout(1.5)
                    ready.wait(timeout=5)
                    try:
                        connection.connect(server.server_address)
                        return connection, None
                    except OSError as error:
                        connection.close()
                        return None, type(error).__name__
                # create_server has called listen; no accept can drain its queue
                # until all simultaneous connect attempts have finished.
                with ThreadPoolExecutor(max_workers=burst) as pool:
                    futures = [pool.submit(connect) for _ in range(burst)]
                    ready.wait(timeout=5)
                    results = [future.result(timeout=5) for future in futures]
                sockets = [connection for connection, _ in results if connection]
                failures = [error for _, error in results if error]
                self.assertEqual(len(sockets), burst, 'queued=%d/%d; failures=%r' % (len(sockets), burst, failures))
                self.assertEqual(server.request_queue_size, 128)
                thread = threading.Thread(target=server.serve_forever, daemon=True)
                thread.start()
                request = ('GET / HTTP/1.0\r\nHost: %s\r\n\r\n' % server.authority).encode()
                for connection in sockets:
                    connection.settimeout(3)
                    connection.sendall(request)
                for connection in sockets:
                    chunks = []
                    while True:
                        data = connection.recv(4096)
                        if not data:
                            break
                        chunks.append(data)
                    response = b''.join(chunks)
                    self.assertTrue(response.startswith(b'HTTP/1.0 200 OK\r\n'), response)
                    self.assertEqual(response.split(b'\r\n\r\n', 1)[1], b'cold-load-document')
            finally:
                for connection in connections:
                    connection.close()
                if thread is not None:
                    server.shutdown()
                server.server_close()
                if thread is not None:
                    thread.join(5)
                    self.assertFalse(thread.is_alive())


if __name__ == '__main__':
    unittest.main()

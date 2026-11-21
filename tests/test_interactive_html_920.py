from __future__ import annotations

import http.client
import threading
import unittest
from pathlib import Path

from aim_next.server import create_server


class InteractiveHTML920Case(unittest.TestCase):
    def test_isolated_document_has_no_data_capability_and_only_its_own_policy(self):
        calls = []
        def forbidden_store():
            calls.append(True)
            raise AssertionError('bootstrap must never open Core')
        server = create_server(forbidden_store, 'isolated-920', 'reader',
                               Path(__file__).resolve().parents[1] / 'web', token='never-in-frame')
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        def get(path):
            connection = http.client.HTTPConnection(*server.server_address, timeout=3)
            try:
                connection.request('GET', path)
                response = connection.getresponse()
                return response.status, dict(response.getheaders()), response.read()
            finally:
                connection.close()
        try:
            status, headers, body = get('/interactive-html')
            self.assertEqual(status, 200)
            self.assertEqual(headers['Cache-Control'], 'no-store')
            self.assertEqual(headers['Connection-Allowlist'], '(); report-to=html-sandbox')
            self.assertNotIn('Reporting-Endpoints', headers)
            self.assertEqual(headers['X-DNS-Prefetch-Control'], 'off')
            self.assertIn("frame-src about:", headers['Content-Security-Policy'])
            self.assertIn("connect-src 'none'", headers['Content-Security-Policy'])
            self.assertIn('sandbox allow-scripts', headers['Content-Security-Policy'])
            self.assertNotIn(b'never-in-frame', body)
            self.assertEqual(calls, [])
            for path in ('/', '/interactive-html.js'):
                _, ordinary, _ = get(path)
                self.assertEqual(ordinary['Content-Security-Policy'], server.csp)
                self.assertEqual(ordinary['X-Frame-Options'], 'DENY')
                self.assertNotIn('Connection-Allowlist', ordinary)
            self.assertNotIn("script-src 'unsafe-inline'", server.csp)
            self.assertEqual(get('/interactive-html/')[0], 404)
        finally:
            server.shutdown()
            server.server_close()
            thread.join(3)


if __name__ == '__main__':
    unittest.main()

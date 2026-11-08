from __future__ import annotations

import http.client
import json
from pathlib import Path
import socket
import tempfile
import threading
import unittest
from unittest.mock import patch

from aim_next.server import create_server
from test_http import FakeStore


ORIGIN = 'https://fixture.example.ts.net:5192'
HOST = 'fixture.example.ts.net:5192'


class TailnetHTTPTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.web = Path(self.tmp.name)
        (self.web / 'index.html').write_text('<meta content="__AIM_SESSION_TOKEN__">')
        (self.web / 'app.mjs').write_text('export const fixture = true;')
        self.store = FakeStore()

    def start(self, external=True):
        options = {'tailnet_origin': ORIGIN} if external else {}
        self.server = create_server(lambda: self.store, 'new-test', 'test-owner',
                                    self.web, token='fixture-session', **options)
        self.thread = threading.Thread(target=self.server.serve_forever,
                                       kwargs={'poll_interval': .01}, daemon=True)
        self.thread.start()
        self.addCleanup(self.stop)

    def stop(self):
        self.server.shutdown()
        self.server.server_close()
        self.thread.join(2)
        self.assertFalse(self.thread.is_alive())

    def request(self, path='/', host=HOST, origin=None, payload=None, token=True, extra=()):
        headers = [('Host', host)]
        if token:
            headers.append(('Authorization', 'Bearer fixture-session'))
        if origin is not None:
            headers.append(('Origin', origin))
        body = b'' if payload is None else json.dumps(payload).encode()
        if payload is not None:
            headers += [('Content-Type', 'application/json'), ('Content-Length', str(len(body)))]
        headers += list(extra)
        raw = ('%s %s HTTP/1.0\r\n' % ('GET' if payload is None else 'POST', path) +
               ''.join('%s: %s\r\n' % pair for pair in headers) + '\r\n').encode() + body
        with socket.create_connection(self.server.server_address, timeout=2) as sock:
            sock.sendall(raw)
            response = http.client.HTTPResponse(sock)
            response.begin()
            return response.status, dict(response.getheaders()), response.read()

    def command(self):
        return {'v': 1, 'instance_id': 'new-test', 'operation_id': 'tailnet-test',
                'kind': 'message.send', 'target': {'topic_id': 'fixture-topic'},
                'expected': {'authority': {k: self.store.authority[k]
                                          for k in ('authority_id', 'authority_epoch')}},
                'args': {'submission_id': 'fixture-submission'}}

    def test_both_addresses_serve_identical_shell_assets_and_bound_api(self):
        self.start()
        for path in ('/', '/index.html', '/app.mjs'):
            local = self.request(path, host=self.server.authority, token=False)
            remote = self.request(path, token=False)
            self.assertEqual((local[0], remote[0]), (200, 200))
            self.assertEqual(local[2], remote[2])
            self.assertEqual(local[1]['Content-Type'], remote[1]['Content-Type'])
            self.assertEqual(remote[1]['Cache-Control'], 'no-store')
        for host, origin in ((self.server.authority, self.server.origin), (HOST, ORIGIN)):
            with self.subTest(host=host):
                status, _, raw = self.request('/api/bootstrap', host=host)
                self.assertEqual(status, 200, raw)
                self.assertEqual(json.loads(raw)['actor'], 'test-owner')
                self.assertEqual(self.request('/api/view', host=host, origin=origin,
                                             payload={'name': 'topic', 'args': {}})[0], 200)
                status, _, raw = self.request('/api/command', host=host, origin=origin,
                                               payload=self.command())
                self.assertEqual(status, 200, raw)
                self.assertEqual(json.loads(raw)['status'], 'committed')
        self.assertTrue(all(call[1] == 'test-owner' for call in self.store.calls))

    def test_bootstrap_names_the_tailnet_address_a_copied_link_opens_on(self):
        # docs/links.md, "A message's link": a link copied on the Mac names the
        # address a phone reaches, from either address the page was opened on.
        self.start()
        for host in (self.server.authority, HOST):
            with self.subTest(host=host):
                status, _, raw = self.request('/api/bootstrap', host=host)
                self.assertEqual(status, 200, raw)
                self.assertEqual(json.loads(raw).get('links'), {'origin': ORIGIN})

    def test_without_a_tailnet_address_the_bootstrap_names_none_for_links(self):
        self.start(external=False)
        status, _, raw = self.request('/api/bootstrap', host=self.server.authority)
        self.assertEqual(status, 200, raw)
        self.assertNotIn('links', json.loads(raw))

    def test_default_remains_loopback_only(self):
        self.start(external=False)
        self.assertEqual(self.request()[0], 403)
        self.assertEqual(self.request(host=self.server.authority)[0], 200)

    def test_foreign_duplicate_and_forwarded_host_cannot_read_shell(self):
        self.start()
        for options in ({'host': 'evil.example'}, {'extra': [('Host', HOST)]},
                        {'host': 'evil.example', 'extra': [('X-Forwarded-Host', HOST),
                                                          ('Forwarded', 'host=' + HOST)]}):
            with self.subTest(options=options):
                status, _, raw = self.request(**options)
                self.assertEqual(status, 403, raw)
                self.assertNotIn(b'fixture-session', raw)
        self.assertEqual(self.store.calls, [])

    def test_origin_must_match_its_host_in_both_directions(self):
        self.start()
        for host, origin in ((HOST, self.server.origin), (self.server.authority, ORIGIN),
                             (HOST, 'https://evil.example'), (HOST, None)):
            with self.subTest(host=host, origin=origin):
                status, _, raw = self.request('/api/command', host=host, origin=origin,
                                               payload=self.command(),
                                               extra=[('X-Forwarded-Proto', 'https'),
                                                      ('X-Forwarded-Host', HOST)])
                self.assertEqual(status, 403, raw)
                self.assertEqual(json.loads(raw)['error']['code'], 'ORIGIN_REFUSED')
        self.assertEqual(self.store.calls, [])

    def test_duplicate_origin_and_missing_session_refuse_before_store(self):
        self.start()
        for options, expected in (({'extra': [('Origin', ORIGIN)]}, 403),
                                  ({'token': False}, 401),
                                  ({'extra': [('Authorization', 'Bearer fixture-session')]}, 401)):
            status, _, raw = self.request('/api/command', origin=ORIGIN,
                                           payload=self.command(), **options)
            self.assertEqual(status, expected, raw)
        self.assertEqual(self.store.calls, [])

    def test_get_api_with_present_wrong_origin_also_refuses(self):
        self.start()
        self.assertEqual(self.request('/api/bootstrap', origin=self.server.origin)[0], 403)
        self.assertEqual(self.store.calls, [])

    def test_bad_tailnet_configuration_refuses_before_listener(self):
        for value in ('', 'http://fixture.ts.net', 'https://fixture.example',
                      'https://fixture.ts.net/', 'https://fixture.ts.net?q=1',
                      'https://fixture.ts.net#x', 'https://user@fixture.ts.net',
                      'https://Fixture.ts.net', 'https://fixture.ts.net.',
                      'https://*.ts.net', 'https://fixture.ts.net:0',
                      'https://fixture.ts.net:65536', 'https://fixture.ts.net:443',
                      'https://fixture.ts.net:05192', 'https://fixture.ts.net\n',
                      'https://-bad.ts.net', 'https://fixture.ts.net:'):
            with self.subTest(value=value), patch('aim_next.server.AIMHTTPServer') as listener:
                with self.assertRaises(ValueError):
                    create_server(lambda: self.store, 'new-test', 'test-owner', self.web,
                                  tailnet_origin=value)
                listener.assert_not_called()


if __name__ == '__main__':
    unittest.main()

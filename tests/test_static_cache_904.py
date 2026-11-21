from __future__ import annotations

import http.client
import unittest

import test_web_build as fixtures


class CacheBuildCase(unittest.TestCase):
    setUp = fixtures.WebBuildTests.setUp

    def test_stylesheets_share_the_existing_module_build_stamp(self):
        build = fixtures.web_build.load(self.web)
        self.assertIn(('href="/b/%s/aim.css"' % build.stamp).encode(), build.index)
        self.assertNotIn(b'href="/aim.css"', build.index)


class CacheHTTPCase(unittest.TestCase):
    setUp = fixtures.ServedBuildTests.setUp
    stop = fixtures.ServedBuildTests.stop
    get = fixtures.ServedBuildTests.get

    def test_only_successful_stamped_assets_are_immutable(self):
        path = '/b/%s/app.mjs' % self.server.build.stamp
        status, headers, body = self.get(path)
        self.assertEqual(status, 200)
        self.assertEqual(headers['Cache-Control'], 'public, max-age=31536000, immutable')
        self.assertIn(b'export const ready', body)
        for path in ('/', '/index.html', '/app.mjs', '/api/build', '/b/old/app.mjs', '/b/%s/missing.mjs' % self.server.build.stamp):
            with self.subTest(path=path):
                _, headers, _ = self.get(path)
                self.assertEqual(headers['Cache-Control'], 'no-store')

    def test_http11_reuses_static_socket_then_closes_for_api(self):
        conn = http.client.HTTPConnection(*self.server.server_address, timeout=3)
        self.addCleanup(conn.close)
        conn.request('GET', '/')
        first = conn.getresponse(); first.read()
        self.assertEqual(first.version, 11)
        self.assertFalse(first.will_close)
        socket = conn.sock
        self.assertIsNotNone(socket)
        conn.request('GET', '/b/%s/app.mjs' % self.server.build.stamp)
        second = conn.getresponse(); second.read()
        self.assertFalse(second.will_close)
        self.assertIs(conn.sock, socket)
        conn.request('GET', '/api/build')
        api = conn.getresponse(); api.read()
        self.assertTrue(api.will_close)
        self.assertEqual(api.getheader('Cache-Control'), 'no-store')

    def test_explicit_close_and_http10_do_not_hold_connections(self):
        conn = http.client.HTTPConnection(*self.server.server_address, timeout=3)
        self.addCleanup(conn.close)
        conn.request('GET', '/b/%s/app.mjs' % self.server.build.stamp, headers={'Connection': 'close'})
        response = conn.getresponse(); response.read()
        self.assertTrue(response.will_close)
        conn = http.client.HTTPConnection(*self.server.server_address, timeout=3)
        self.addCleanup(conn.close)
        conn._http_vsn, conn._http_vsn_str = 10, 'HTTP/1.0'
        conn.request('GET', '/', headers={'Host': self.server.authority})
        response = conn.getresponse(); response.read()
        self.assertTrue(response.will_close)

    def test_static_get_with_unread_body_or_close_token_does_not_reuse_connection(self):
        for headers, body in (({'Connection': 'keep-alive, Close'}, None), ({}, b'not another request')):
            with self.subTest(headers=headers):
                conn = http.client.HTTPConnection(*self.server.server_address, timeout=3)
                self.addCleanup(conn.close)
                conn.request('GET', '/', body=body, headers=headers)
                response = conn.getresponse(); response.read()
                self.assertTrue(response.will_close)

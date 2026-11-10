from __future__ import annotations

from contextlib import contextmanager
import hashlib
import http.client
import io
import json
from pathlib import Path
import socket
import threading
import time
from types import SimpleNamespace
import unittest
from unittest import mock

from aim_next import Store
from aim_next.contract import LIMITS, Refusal
from aim_next.server import create_server, Handler, DeadlineInput
from aim_next import server as server_module
from reader_fixture import ReaderCase


class PacedClock:
    """The server's clock during an upload, moved only by the bytes Core has taken.

    Before each read Core makes of the upload, the clock is set to the
    request's start plus elapsed(bytes taken so far), and send(client, bytes
    taken) then does what the client does at that moment, from the server's
    thread, so every byte is sent before the read that takes it. A budget the
    server measures is then a fact about bytes and pace, never about how busy
    the machine is.
    """
    def __init__(self, elapsed, send):
        self.now = time.monotonic()
        self.elapsed, self.send = elapsed, send
        self.reads, self.expired = [], None
        self.client, self.opened = None, threading.Event()

    @contextmanager
    def serving(self):
        publish = Store.publish_media
        def paced(store, actor, value, stream):
            return publish(store, actor, value, SimpleNamespace(read=lambda size: self._read(stream, size)))
        with mock.patch.object(server_module, 'time', SimpleNamespace(monotonic=lambda: self.now)), \
                mock.patch.object(Store, 'publish_media', paced):
            yield self

    def upload(self, case, envelope, length, prefix=b''):
        try:
            self.client = case.raw_upload(envelope, length, prefix=prefix)
            self.client.settimeout(None)
        finally:
            self.opened.set()
        return case.raw_response(self.client)

    def _read(self, stream, size):
        consumed = stream.handler.body_consumed
        offset = self.elapsed(consumed)
        self.now = stream.handler.request_started + offset
        self.reads.append(offset)
        self.opened.wait()
        if self.client is not None:
            self.send(self.client, consumed)
        try:
            return stream.read(size)
        except socket.timeout:
            self.expired = offset
            raise


class MediaHTTPTests(ReaderCase):
    def setUp(self):
        super().setUp()
        self.factory = lambda: Store(self.path, 'test-instance', expected_binding=self.binding)
        self.server = create_server(self.factory, 'test-instance', 'owner', self.path.parent,
                                    token='isolated-media-session')
        self.server.request_timeout = 1.0
        self.thread = threading.Thread(target=self.server.serve_forever,
                                       kwargs={'poll_interval': 0.01}, daemon=True)
        self.thread.start()
        self.addCleanup(self.stop_server)

    def stop_server(self):
        self.server.shutdown()
        self.server.server_close()
        self.thread.join(2)
        self.assertFalse(self.thread.is_alive())

    def begin(self, media_id='blob-one', data=b'exact media bytes', content_type='text/plain', name='fixture.txt'):
        publish_id = 'publish-' + media_id
        self.committed(self.command('media.begin', {
            'name': name, 'content_type': content_type, 'size_bytes': len(data),
            'sha256': hashlib.sha256(data).hexdigest(), 'publish_operation_id': publish_id,
        }, target={'media_id': media_id}, expected={'media_revision': 0}))
        return self.envelope('media.publish', {'media_id': media_id}, {},
                             {'media_revision': 1}, op=publish_id)

    def request(self, path, body=b'', headers=None, method='POST'):
        connection = http.client.HTTPConnection(*self.server.server_address, timeout=3)
        actual = {'Authorization': 'Bearer isolated-media-session', 'Origin': self.server.origin,
                  'Content-Type': 'application/json'}
        actual.update(headers or {})
        try:
            connection.request(method, path, body=body, headers=actual)
            response = connection.getresponse()
            return response.status, dict(response.getheaders()), response.read()
        finally:
            connection.close()

    def upload(self, envelope, data, headers=None):
        actual = {'Content-Type': 'application/octet-stream', 'X-AIM-Command': json.dumps(envelope)}
        actual.update(headers or {})
        return self.request('/api/media/upload', data, actual)

    def read_media(self, media_id='blob-one', **args):
        return self.request('/api/media/read', json.dumps(dict(media_id=media_id, **args)).encode())

    def assert_error(self, response, code, status=None):
        actual, headers, raw = response
        self.assertGreaterEqual(actual, 400, raw)
        if status is not None:
            self.assertEqual(actual, status, raw)
        value = json.loads(raw)
        self.assertEqual(value['error']['code'], code, value)
        self.assertFalse(value['recorded'], value)
        self.assertNotIn('X-AIM-Media', headers)
        return value

    def ready(self, media_id='blob-one', data=b'exact media bytes', content_type='text/plain', name='fixture.txt'):
        envelope = self.begin(media_id, data, content_type, name)
        status, _, raw = self.upload(envelope, data)
        self.assertEqual(status, 200, raw)
        receipt = json.loads(raw)
        self.committed(receipt)
        self.assertEqual(receipt['result']['state'], 'ready')
        return envelope, receipt

    def test_round_trip_keeps_exact_receipt_bytes_and_public_records(self):
        before = self.public_state()
        data = b'preserved\x00\xfffile'
        envelope, receipt = self.ready(data=data)
        status, headers, raw = self.read_media()
        self.assertEqual(status, 200, raw)
        self.assertEqual(raw, data)
        descriptor = json.loads(headers['X-AIM-Media'])
        self.assertEqual(descriptor['instance_id'], 'test-instance')
        self.assertEqual(descriptor['media_id'], 'blob-one')
        self.assertEqual(descriptor['sha256'], hashlib.sha256(data).hexdigest())
        self.assertEqual(descriptor['size_bytes'], len(data))
        self.assertEqual(self.store.view('owner', 'operation', {'operation_id': envelope['operation_id']}), receipt)
        self.assertEqual(self.public_state(), before)
        self.assertEqual(headers['Cache-Control'], 'no-store')

    def test_attached_source_access_is_exact_and_established_actor_is_used(self):
        self.ready()
        sent = self.send('with attachment', attachments=[{'id': 'blob-one'}])
        source = {'kind': 'message', 'id': sent['id']}
        self.server.actor = 'agent-a'
        self.assert_error(self.read_media(), 'FORBIDDEN', 403)
        status, _, raw = self.read_media(source_ref=source)
        self.assertEqual((status, raw), (200, b'exact media bytes'))
        self.assert_error(self.read_media(source_ref=self.opening), 'FORBIDDEN', 403)
        self.server.actor = 'outsider'
        self.assert_error(self.read_media(source_ref=source), 'FORBIDDEN', 403)

    def test_original_operation_and_authority_are_not_replaced(self):
        envelope, receipt = self.ready()
        repeated = self.upload(envelope, b'exact media bytes')
        self.assertEqual((repeated[0], json.loads(repeated[2])), (200, receipt))
        altered = json.loads(json.dumps(envelope))
        altered['expected']['authority']['authority_epoch'] = 'stale-epoch'
        result = self.upload(altered, b'exact media bytes')
        self.assertEqual(json.loads(result[2]).get('error', {}).get('code'), 'AUTHORITY_CHANGED')
        self.assertEqual(self.store.view('owner', 'operation', {'operation_id': envelope['operation_id']}), receipt)
        missing = json.loads(json.dumps(envelope))
        del missing['expected']['authority']
        result = self.upload(missing, b'exact media bytes')
        self.assertEqual(json.loads(result[2]).get('error', {}).get('code'), 'INVALID_ARGUMENT')
        self.assertEqual(self.store.view('owner', 'operation', {'operation_id': envelope['operation_id']}), receipt)

    def test_auth_refusals_never_call_media_or_change_intent(self):
        envelope = self.begin()
        before = self.records()
        with mock.patch.object(Store, 'publish_media', side_effect=AssertionError('unauthorized effect')) as publish:
            for headers, code in (({'Origin': 'http://wrong.invalid'}, 'ORIGIN_REFUSED'),
                                  ({'Authorization': 'Bearer wrong'}, 'SESSION_REQUIRED'),
                                  ({'Host': 'wrong.invalid'}, 'HOST_REFUSED')):
                with self.subTest(code=code):
                    self.assert_error(self.upload(envelope, b'exact media bytes', headers), code)
            publish.assert_not_called()
        self.assertEqual(self.records(), before)

    def test_upload_framing_refuses_invalid_envelopes_before_core(self):
        envelope = self.begin()
        cases = [({'X-AIM-Command': ''}, 'INVALID_ENVELOPE'),
                 ({'X-AIM-Command': '[]'}, 'INVALID_ENVELOPE'),
                 ({'X-AIM-Command': '{"v":1,"v":2}'}, 'INVALID_ENVELOPE'),
                 ({'X-AIM-Command': '{"v":NaN}'}, 'INVALID_ENVELOPE'),
                 ({'X-AIM-Command': '{' + ' ' * 8193 + json.dumps(envelope)[1:]}, 'INVALID_ENVELOPE'),
                 ({'X-AIM-Command': json.dumps(dict(envelope, actor='agent-a'))}, 'INVALID_ENVELOPE'),
                 ({'X-AIM-Command': json.dumps(dict(envelope, kind='message.send'))}, 'INVALID_ENVELOPE'),
                 ({'Content-Type': 'text/plain'}, 'BINARY_REQUIRED'),
                 ({'Transfer-Encoding': 'chunked'}, 'INVALID_BODY'),
                 ({'Content-Length': str(LIMITS['media_file_bytes'] + 1)}, 'MEDIA_TOO_LARGE')]
        with mock.patch.object(Store, 'publish_media', side_effect=AssertionError('invalid framing effect')) as publish:
            for headers, code in cases:
                with self.subTest(code=code, headers=headers):
                    self.assert_error(self.upload(envelope, b'exact media bytes', headers), code)
            publish.assert_not_called()

    def test_read_refusal_is_not_error_shaped_file_content(self):
        data = b'{"recorded":false,"error":{"code":"FORBIDDEN"}}'
        self.ready(data=data, content_type='application/json')
        status, headers, raw = self.read_media()
        self.assertEqual((status, raw), (200, data))
        self.assertEqual(json.loads(headers['X-AIM-Media'])['content_type'], 'application/json')
        self.assertTrue(headers['Content-Disposition'].startswith('attachment;'))
        self.assertIn('sandbox', headers['Content-Security-Policy'])
        self.assert_error(self.read_media('unknown'), 'FORBIDDEN', 403)

    def test_inline_images_and_hostile_download_names_have_safe_headers(self):
        data = (Path(__file__).parent / 'fixtures/media/one.png').read_bytes()
        self.ready(data=data, content_type='image/png')
        status, headers, raw = self.read_media()
        self.assertEqual((status, raw), (200, data))
        self.assertEqual(headers['Content-Type'], 'image/png')
        self.assertTrue(headers['Content-Disposition'].startswith('inline;'))
        self.assertTrue(json.loads(headers['X-AIM-Media'])['inline'])
        hostile = '../x"\r\nInjected: yes—.svg'
        svg = b'<svg xmlns="http://www.w3.org/2000/svg"><script>bad()</script></svg>'
        self.ready('svg', svg, 'image/svg+xml', hostile)
        status, headers, raw = self.read_media('svg')
        self.assertEqual((status, raw), (200, svg))
        self.assertEqual(json.loads(headers['X-AIM-Media'])['name'], hostile)
        self.assertNotIn('Injected', headers)
        self.assertEqual(headers['X-Content-Type-Options'], 'nosniff')
        self.assertTrue(headers['Content-Disposition'].startswith('attachment;'))
        self.assertIn('sandbox', headers['Content-Security-Policy'])

    def test_bad_image_and_pending_or_corrupt_reads_do_not_expose_bytes(self):
        envelope = self.begin(data=b'<svg/>', content_type='image/png')
        status, _, raw = self.upload(envelope, b'<svg/>')
        self.assertEqual(json.loads(raw)['error']['code'], 'MEDIA_INVALID')
        self.assert_error(self.read_media(), 'ATTACHMENT_NOT_READY', 409)
        self.ready('good')
        root = Path(str(self.path) + '.media')
        paths = [p for p in root.iterdir() if p.is_file()]
        self.assertEqual(len(paths), 1)
        paths[0].write_bytes(b'wrong bytes')
        self.assert_error(self.read_media('good'), 'MEDIA_UNAVAILABLE')

    def test_partial_binary_failure_closes_resource_without_second_response(self):
        self.ready()
        actual_open = Store.open_media
        resources = []

        def broken(store, actor, args):
            resource = actual_open(store, actor, args)
            resources.append(resource)
            resource.read = mock.Mock(side_effect=RuntimeError('post-header failure'))
            return resource

        with mock.patch.object(Store, 'open_media', broken):
            connection = http.client.HTTPConnection(*self.server.server_address, timeout=3)
            try:
                connection.request('POST', '/api/media/read', json.dumps({'media_id': 'blob-one'}), headers={
                    'Authorization': 'Bearer isolated-media-session', 'Origin': self.server.origin,
                    'Content-Type': 'application/json'})
                response = connection.getresponse()
                self.assertEqual(response.status, 200)
                with self.assertRaises(http.client.IncompleteRead) as caught:
                    response.read()
                self.assertEqual(caught.exception.partial, b'')
            finally:
                connection.close()
        self.assertEqual(len(resources), 1)
        with self.assertRaises(ValueError):
            resources[0].read = type(resources[0]).read.__get__(resources[0])
            resources[0].read(1)
        self.assertEqual(self.read_media()[0], 200)

    def test_binary_media_methods_and_read_args_have_no_get_or_path_fallback(self):
        for path in ('/api/media/upload', '/api/media/read'):
            self.assert_error(self.request(path, method='GET'), 'METHOD_REFUSED', 405)
        self.assert_error(self.request('/api/media/read', b'{"path":"/etc/passwd"}'), 'INVALID_ARGUMENT', 400)

    def raw_upload(self, envelope, length, extra=(), prefix=b''):
        sock = socket.create_connection(self.server.server_address, timeout=3)
        self.addCleanup(sock.close)
        headers = [('Host', self.server.authority), ('Authorization', 'Bearer isolated-media-session'),
                   ('Origin', self.server.origin), ('Content-Type', 'application/octet-stream'),
                   ('Content-Length', str(length)), ('X-AIM-Command', json.dumps(envelope))]
        headers.extend(extra)
        request = 'POST /api/media/upload HTTP/1.1\r\n' + ''.join('%s: %s\r\n' % h for h in headers) + '\r\n'
        sock.sendall(request.encode('ascii') + prefix)
        return sock

    def raw_response(self, sock):
        response = http.client.HTTPResponse(sock)
        response.begin()
        return response.status, dict(response.getheaders()), response.read()

    def test_duplicate_headers_and_short_upload_never_become_ready(self):
        envelope = self.begin()
        for extra in ([('Content-Length', '16')], [('X-AIM-Command', json.dumps(envelope))]):
            sock = self.raw_upload(envelope, 16, extra, b'exact media bytes')
            self.assert_error(self.raw_response(sock), 'INVALID_BODY' if extra[0][0] == 'Content-Length' else 'INVALID_ENVELOPE')
            sock.close()
        sock = self.raw_upload(envelope, 16, prefix=b'exact')
        sock.shutdown(socket.SHUT_WR)
        response = self.raw_response(sock)
        self.assertNotEqual(json.loads(response[2]).get('status'), 'committed')
        self.assertEqual(self.store.view('owner', 'media', {'media_id': 'blob-one'})['state'], 'pending')

    def test_upload_slot_is_separate_from_read_and_foreground_lanes(self):
        self.ready('existing')
        data = b'x' * 65536
        envelope = self.begin('waiting', data)
        entered = threading.Event()
        actual = Store.publish_media

        def observed(store, actor, value, stream):
            if value['operation_id'] == envelope['operation_id']:
                entered.set()
            return actual(store, actor, value, stream)

        with mock.patch.object(Store, 'publish_media', observed):
            sock = self.raw_upload(envelope, len(data))
            self.assertTrue(entered.wait(1), 'first upload did not enter Core')
            self.assert_error(self.upload(envelope, data), 'SERVER_BUSY', 503)
            self.assertEqual(self.read_media('existing')[0], 200)
            view = self.request('/api/view', b'{"name":"topic","args":{"topic_id":"t1"}}')
            self.assertEqual(json.loads(view[2])['topic']['id'], 't1')
            command = self.envelope('workspace.create', {}, {'id': 'w2', 'title': 'Foreground'})
            self.committed(json.loads(self.request('/api/command', json.dumps(command).encode())[2]))
            sock.sendall(data)
            self.committed(json.loads(self.raw_response(sock)[2]))
        self.assertEqual(self.read_media('waiting')[2], data)
        self.ready('after-upload')

    def test_read_slot_released_after_output_and_independent_of_upload(self):
        self.ready()
        entered, release = threading.Event(), threading.Event()
        actual = Store.open_media
        failures = []
        answers = []
        opened = []

        def held(store, actor, args):
            resource = actual(store, actor, args)
            opened.append(resource)
            if len(opened) != 1:
                return resource
            original_read = resource.read
            def read(size):
                entered.set()
                if not release.wait(2):
                    raise AssertionError('fixture release not received')
                return original_read(size)
            resource.read = read
            return resource

        def client():
            try:
                answers.append(self.read_media())
            except BaseException as error:
                failures.append(error)

        with mock.patch.object(Store, 'open_media', held):
            worker = threading.Thread(target=client)
            worker.start()
            try:
                self.assertTrue(entered.wait(1), 'first read never reached byte output')
                self.assert_error(self.read_media(), 'SERVER_BUSY', 503)
                self.ready('parallel-upload')
            finally:
                release.set()
                worker.join(3)
        self.assertFalse(worker.is_alive())
        self.assertEqual(failures, [])
        self.assertEqual(answers[0][2], b'exact media bytes')
        self.assertEqual(self.read_media()[0], 200)

    def test_recorded_retry_releases_upload_before_unused_body_drain(self):
        envelope, receipt = self.ready()
        draining = threading.Event()
        observed = []
        original = Handler._discard_refused_upload

        def drain(handler):
            observed.append(handler.body_consumed)
            draining.set()
            return original(handler)

        with mock.patch.object(Handler, '_discard_refused_upload', drain):
            sock = self.raw_upload(envelope, len(b'exact media bytes'))
            response = self.raw_response(sock)
            self.assertEqual(json.loads(response[2]), receipt)
            self.assertTrue(draining.wait(1))
            self.assertEqual(observed[0], 0)
            self.ready('not-held-by-drain')
            sock.shutdown(socket.SHUT_WR)

    def test_partial_refusal_counts_consumed_prefix_and_releases_before_drain(self):
        envelope = self.begin()
        draining = threading.Event()
        observed = []
        original_drain = Handler._discard_refused_upload
        original_publish = Store.publish_media

        def reject_prefix(store, actor, value, stream):
            if value['operation_id'] == envelope['operation_id']:
                self.assertEqual(stream.read(3), b'exa')
                raise Refusal('MEDIA_INVALID', 'fixture refusal', recorded=False)
            return original_publish(store, actor, value, stream)

        def drain(handler):
            observed.append(handler.body_consumed)
            draining.set()
            return original_drain(handler)

        with mock.patch.object(Store, 'publish_media', reject_prefix), mock.patch.object(Handler, '_discard_refused_upload', drain):
            sock = self.raw_upload(envelope, 16, prefix=b'exa')
            self.assert_error(self.raw_response(sock), 'MEDIA_INVALID')
            self.assertTrue(draining.wait(1))
            self.assertEqual(observed[0], 3)
            self.ready('next')
            sock.shutdown(socket.SHUT_WR)

    def test_actual_input_deadline_includes_size_and_preserves_buffered_body(self):
        data = b'buffered bytes' * 10000
        envelope = self.begin(data=data)
        seen = []
        actual = Store.publish_media

        def observe(store, actor, value, stream):
            handler = stream.handler
            seen.append((handler.request_started, handler.deadline, handler.rfile.raw.deadline))
            return actual(store, actor, value, stream)

        with mock.patch.object(Store, 'publish_media', observe):
            self.committed(json.loads(self.upload(envelope, data)[2]))
        self.assertEqual(len(seen), 1)
        started, deadline, raw_deadline = seen[0]
        self.assertAlmostEqual(deadline - started, self.server.request_timeout + len(data) / 262144.0, places=6)
        self.assertEqual(deadline, raw_deadline)
        self.assertEqual(self.read_media()[2], data)

    def test_paced_upload_outlives_header_budget_but_not_absolute_body_budget(self):
        # The budgets are the behaviour here, so the server's clock is a
        # PacedClock. 8 MiB adds 32 s to the 1 s header budget, so the only
        # real wait (a socket read for bytes already sent) is never near a
        # deadline.
        header = self.server.request_timeout
        data = b'x' * (8 * 1024 * 1024)
        body = header + len(data) / 262144.0
        sent = [0]
        def paced(client, consumed):
            # The next 16 KiB once Core has taken everything sent so far.
            if consumed == sent[0] < len(data):
                piece = data[consumed:consumed + 16384]
                client.sendall(piece)
                sent[0] += len(piece)
        # A client that takes twice the header budget to send every byte.
        envelope = self.begin('paced', data)
        with PacedClock(lambda consumed: 2 * header * consumed / len(data), paced).serving() as clock:
            self.committed(json.loads(clock.upload(self, envelope, len(data))[2]))
        self.assertGreater(max(clock.reads), header, 'the upload must outlive the header budget')
        self.assertLess(max(clock.reads), body)
        self.assertIsNone(clock.expired)

        stalled = self.begin('stalled', data)
        # After the first byte, one byte at a third and at two thirds of the
        # body budget; the next read comes past the budget. The client then
        # ends its side, so a deadline that progress renewed would read the
        # end and refuse a short body instead.
        pace = {0: 0., 1: body / 3, 2: body * 2 / 3, 3: body * 4 / 3}
        def stalling(client, consumed):
            if consumed in (1, 2):
                client.sendall(b'x')
            elif consumed == 3:
                client.shutdown(socket.SHUT_WR)
        with PacedClock(lambda consumed: pace[min(consumed, 3)], stalling).serving() as clock:
            receipt = json.loads(clock.upload(self, stalled, len(data), prefix=b'x')[2])
        self.assertEqual(receipt['error']['code'], 'MEDIA_UNCONFIRMED', 'body progress renewed the absolute deadline')
        self.assertEqual(clock.reads, [pace[0], pace[1], pace[2], pace[3]])
        self.assertEqual(clock.expired, pace[3], 'only the read past the body budget may end the upload')
        self.assertEqual(self.store.view('owner', 'media', {'media_id': 'stalled'})['state'], 'pending')

    def test_verified_descriptor_bound_is_checked_before_headers_and_resource_closed(self):
        self.ready()
        actual = Store.open_media
        resources = []

        def oversized(store, actor, args):
            resource = actual(store, actor, args)
            resource.descriptor = dict(resource.descriptor, name='x' * 8192)
            resources.append(resource)
            return resource

        with mock.patch.object(Store, 'open_media', oversized):
            self.assert_error(self.read_media(), 'MEDIA_UNCONFIRMED', 500)
        with self.assertRaises(ValueError):
            resources[0].read(1)
        self.assertEqual(self.read_media()[0], 200)

    def test_lost_publication_response_reconciles_without_blob_overwrite(self):
        envelope = self.begin()
        actual = Handler._json_response
        observed = []

        def drop(handler, status, value):
            if value.get('operation_id') == envelope['operation_id'] and value.get('status') == 'committed':
                observed.append(value)
                handler.connection.shutdown(socket.SHUT_RDWR)
                handler.close_connection = True
                return
            return actual(handler, status, value)

        with mock.patch.object(Handler, '_json_response', drop):
            with self.assertRaises(http.client.RemoteDisconnected):
                self.upload(envelope, b'exact media bytes')
        self.assertEqual(len(observed), 1, 'response loss must occur after actual commit')
        operation = self.store.view('owner', 'operation', {'operation_id': envelope['operation_id']})
        self.assertEqual(operation, observed[0])
        root = Path(str(self.path) + '.media')
        blobs = [(p.name, p.stat().st_ino, p.read_bytes()) for p in root.iterdir()]
        response = self.upload(envelope, b'exact media bytes')
        self.assertEqual(json.loads(response[2]), operation)
        self.assertEqual([(p.name, p.stat().st_ino, p.read_bytes()) for p in root.iterdir()], blobs)

    def test_cutover_while_body_waits_keeps_original_pins_and_no_ready_receipt(self):
        data = b'exact media bytes'
        envelope = self.begin(data=data)
        entered = threading.Event()
        anchor = Path(self.binding['authority_path'])
        original = anchor.read_bytes()

        # The event must follow Core's preflight, not merely method entry.
        actual_publish_bytes = Store._publish_bytes
        def after_preflight(store, row, stream):
            entered.set()
            return actual_publish_bytes(store, row, stream)

        with mock.patch.object(Store, '_publish_bytes', after_preflight):
            sock = self.raw_upload(envelope, len(data))
            self.assertTrue(entered.wait(1))
            changed = json.loads(original)
            changed['epoch'] = 'new-fixture-authority'
            anchor.write_text(json.dumps(changed))
            try:
                sock.sendall(data)
                result = json.loads(self.raw_response(sock)[2])
                self.assertEqual(result['error']['code'], 'AUTHORITY_CHANGED')
                self.assertFalse(result['recorded'])
            finally:
                anchor.write_bytes(original)
        self.assertEqual(self.store.view('owner', 'media', {'media_id': 'blob-one'})['state'], 'pending')
        self.assertEqual(self.store.view('owner', 'operation', {'operation_id': envelope['operation_id']})['status'], 'unknown')

    def test_read_uses_verified_snapshot_without_reopening_mutated_path(self):
        self.ready()
        original_open = Store.open_media
        root = Path(str(self.path) + '.media')
        paths = list(root.iterdir())
        self.assertEqual(len(paths), 1)
        def change_after_capture(store, actor, args):
            resource = original_open(store, actor, args)
            paths[0].write_bytes(b'changed after verification')
            return resource
        with mock.patch.object(Store, 'open_media', change_after_capture):
            self.assertEqual(self.read_media()[2], b'exact media bytes')
        self.assert_error(self.read_media(), 'MEDIA_UNAVAILABLE')


class MediaOutputClockTests(unittest.TestCase):
    """Distinguish full-size allowance, header cost and non-renewal cheaply."""
    def output_fixture(self, size, header_cost=0., chunk_cost=0.):
        clock = [100.]
        timeouts, writes, headers = [], [], {}
        handler = Handler.__new__(Handler)
        handler.server = SimpleNamespace(request_timeout=10.)
        handler.binary_headers_started = False
        handler.send_response = lambda status: self.assertEqual(status, 200)
        handler.send_header = lambda key, value: headers.__setitem__(key, value)
        handler.connection = SimpleNamespace(settimeout=lambda value: timeouts.append(value))
        def end_headers():
            clock[0] += header_cost
        def write(data):
            writes.append(len(data))
            clock[0] += chunk_cost
        handler.end_headers = end_headers
        handler.wfile = SimpleNamespace(write=write)
        resource = SimpleNamespace(descriptor={'instance_id': 'test', 'media_id': 'one', 'name': 'safe',
            'content_type': 'application/octet-stream', 'size_bytes': size, 'inline': False,
            'sha256': '0' * 64}, read=lambda n: b'x' * n)
        return handler, resource, clock, timeouts, writes, headers

    def test_full_cap_output_formula_chunks_and_headers_share_one_clock(self):
        size = LIMITS['media_file_bytes']
        handler, resource, clock, timeouts, writes, headers = self.output_fixture(size, 1., .001)
        with mock.patch.object(server_module, 'time', SimpleNamespace(monotonic=lambda: clock[0])):
            handler._send_media(resource)
        self.assertEqual(timeouts[0], 10 + size / 262144.)
        self.assertEqual(timeouts[1], timeouts[0] - 1.)
        self.assertAlmostEqual(timeouts[-1], timeouts[1] - .001 * (len(writes) - 1), places=6)
        self.assertEqual(sum(writes), size)
        self.assertEqual(max(writes), 65536)
        self.assertEqual(len(writes), 1024)

    def test_successful_output_chunks_do_not_renew_deadline(self):
        handler, resource, clock, timeouts, writes, headers = self.output_fixture(65536 * 4, 1., 5.)
        with mock.patch.object(server_module, 'time', SimpleNamespace(monotonic=lambda: clock[0])):
            with self.assertRaises(socket.timeout):
                handler._send_media(resource)
        self.assertEqual(writes, [65536, 65536])
        self.assertEqual(timeouts, [11., 10., 5.])

    def test_slow_headers_consume_output_budget_before_any_media(self):
        handler, resource, clock, timeouts, writes, headers = self.output_fixture(1, 11.)
        with mock.patch.object(server_module, 'time', SimpleNamespace(monotonic=lambda: clock[0])):
            with self.assertRaises(socket.timeout):
                handler._send_media(resource)
        self.assertEqual(writes, [])
        self.assertTrue(handler.binary_headers_started)


if __name__ == '__main__':
    unittest.main()

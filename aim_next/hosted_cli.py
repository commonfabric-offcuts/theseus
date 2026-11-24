from __future__ import annotations

"""Actor-bound Core transport for sandboxed CLI processes (662).

Only bytes and Core requests cross this boundary. Client paths never do.
"""

import io
import json
import os
from pathlib import Path
import shutil
import socket
import socketserver
import struct
import tempfile
import threading
import time

from .contract import LIMITS, Refusal, StoreError
from .media import VerifiedMedia


HEADER_LIMIT = LIMITS['http_envelope_bytes'] + 8192
BODY_LIMIT = LIMITS['media_file_bytes']
DEADLINE = 10.0


class BrokerFailure(StoreError):
    def __init__(self, code, message, retryable=False, exit_code=None):
        self.code, self.message, self.retryable = code, message, retryable
        self.exit_code = (75 if retryable else 2) if exit_code is None else exit_code
        super().__init__(message)


def _read(sock, count, deadline):
    chunks = []
    while count:
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            raise OSError('broker deadline')
        sock.settimeout(remaining)
        part = sock.recv(min(count, 65536))
        if not part:
            raise OSError('broker response unavailable')
        chunks.append(part)
        count -= len(part)
    return b''.join(chunks)


def _receive(sock):
    deadline = time.monotonic() + DEADLINE
    size, body = struct.unpack('!IQ', _read(sock, 12, deadline))
    if size > HEADER_LIMIT or body > BODY_LIMIT:
        raise OSError('broker frame too large')
    header = json.loads(_read(sock, size, deadline).decode('utf-8'))
    if type(header) is not dict:
        raise OSError('invalid broker frame')
    return header, _read(sock, body, deadline)


def _discard(sock):
    """Drain one bounded request before refusing, without retaining its body."""
    deadline = time.monotonic() + DEADLINE
    size, body = struct.unpack('!IQ', _read(sock, 12, deadline))
    if size > HEADER_LIMIT or body > BODY_LIMIT:
        raise OSError('broker frame too large')
    remaining = size + body
    while remaining:
        remaining -= len(_read(sock, min(remaining, 65536), deadline))


def _send(sock, header, body=b''):
    data = json.dumps(header, ensure_ascii=False, allow_nan=False, separators=(',', ':')).encode('utf-8')
    if len(data) > HEADER_LIMIT or len(body) > BODY_LIMIT:
        raise Refusal('RESPONSE_TOO_LARGE', 'Use a smaller bounded page or media result')
    sock.settimeout(DEADLINE)
    sock.sendall(struct.pack('!IQ', len(data), len(body)) + data)
    if body:
        sock.sendall(body)


def exchange(path, request, data=b''):
    with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as sock:
        sock.settimeout(DEADLINE)
        try:
            sock.connect(path)
        except OSError as error:
            raise BrokerFailure('BROKER_UNAVAILABLE', 'Broker unavailable; nothing sent by this attempt', retryable=True) from error
        _send(sock, request, data)
        response, body = _receive(sock)
    if response.get('refusal'):
        refusal = response['refusal']
        raise Refusal(refusal['code'], refusal['message'])
    if response.get('failure'):
        raise BrokerFailure(**response['failure'])
    if set(response) != {'result'}:
        raise OSError('invalid broker response')
    return response['result'], body


def _binding(profile):
    return dict(instance_id=profile.instance_id, actor_id=profile.actor_id, db_path=str(profile.db_path),
                authority_id=profile.authority_id, authority_epoch=profile.authority_epoch)


class _Server(socketserver.ThreadingMixIn, socketserver.UnixStreamServer):
    daemon_threads = False
    block_on_close = True

    def process_request(self, request, address):
        if not self.owner.slots.acquire(blocking=False):
            try:
                # Closing with unread bytes can discard the busy reply or
                # break the client's send before it gets to read that reply.
                _discard(request)
                _send(request, {'failure':dict(code='BROKER_BUSY',message='Broker at capacity; retry the same saved request',
                                               retryable=True,exit_code=75)})
            finally:
                request.close()
            return
        with self.owner.lock:
            self.owner.connections.add(request)
        try:
            super().process_request(request, address)
        except Exception:
            self.owner.finished(request)
            raise

    def process_request_thread(self, request, address):
        try:
            super().process_request_thread(request, address)
        finally:
            self.owner.finished(request)

    def handle_error(self, request, address):
        # No request bodies, paths or Core diagnostics in a process traceback.
        pass


class _Handler(socketserver.BaseRequestHandler):
    def handle(self):
        request = {}
        try:
            request, data = _receive(self.request)
            response, body = self.server.owner._execute(request, data)
            _send(self.request, {'result': response}, body)
        except Refusal as error:
            if error.code == 'RESPONSE_TOO_LARGE' and request.get('method') in ('command', 'publish'):
                _send(self.request, {'failure': dict(code=error.code, message=error.message, retryable=False, exit_code=1)})
            else:
                _send(self.request, {'refusal': {'code': error.code, 'message': error.message}})
        except StoreError as error:
            code = getattr(error, 'code', None)
            retryable = getattr(error, 'retryable', False)
            uncertain = code is None and request.get('method') in ('command', 'publish')
            failure = dict(code=code or ('STORE_REQUEST_UNCONFIRMED' if uncertain else 'STORE_UNAVAILABLE'),
                           message=str(error), retryable=retryable, exit_code=(75 if retryable else 2) if code else 1)
            _send(self.request, {'failure': failure})
        except (OSError, ValueError, KeyError, TypeError):
            return


class HostedCLI:
    def __init__(self, config):
        self.profile, self.destination = config.profile, dict(config.destination)
        self.binding = _binding(self.profile)
        self.outbox = str(Path(config.profile_path).parent / (self.profile.actor_id + '.outbox'))
        self.lock, self.slots = threading.Lock(), threading.BoundedSemaphore(8)
        self.connections = set()
        self.directory = tempfile.mkdtemp(prefix='theseus-core-', dir='/private/tmp' if os.path.isdir('/private/tmp') else None)
        self.path = str(Path(self.directory) / 'core.sock')
        self.server = None
        try:
            self.server = _Server(self.path, _Handler)
            self.server.owner = self
            os.chmod(self.path, 0o600)
            self.worker = threading.Thread(target=lambda: self.server.serve_forever(poll_interval=0.05), name='theseus-core-broker')
            self.worker.start()
        except BaseException:
            if self.server is not None:
                self.server.server_close()
            shutil.rmtree(self.directory, ignore_errors=True)
            raise
        self.closed = False

    def finished(self, connection):
        with self.lock:
            self.connections.discard(connection)
        self.slots.release()

    def _execute(self, request, data):
        method = request.get('method')
        fields = {'binding': {'method'}, 'view': {'method', 'binding', 'name', 'args'},
                  'command': {'method', 'binding', 'envelope'}, 'publish': {'method', 'binding', 'envelope'},
                  'open_media': {'method', 'binding', 'args'}}
        if method not in fields or set(request) != fields[method] or data and method != 'publish':
            raise Refusal('INVALID_REQUEST', 'Use a bounded Core request, never a filesystem path')
        if method != 'binding' and request['binding'] != self.binding:
            raise Refusal('BINDING_MISMATCH', 'Retain the original actor and authority binding')
        # A route change/recovery invalidates the endpoint; never rebind it.
        store = self.profile.store()
        pin = store.read_route_pin(self.profile.actor_id, self.destination)
        if pin.get('destination') != self.destination:
            raise Refusal('ROUTE_PIN_MISMATCH', 'Route pin changed; nothing sent by this attempt; retain the original binding')
        store.observe_cli(self.profile.actor_id)
        if method == 'binding':
            return {'binding': self.binding, 'outbox': self.outbox}, b''
        if method == 'view':
            return store.view(self.profile.actor_id, request['name'], request['args']), b''
        if method == 'command':
            return store.command(self.profile.actor_id, request['envelope']), b''
        if method == 'publish':
            return store.publish_media(self.profile.actor_id, request['envelope'], io.BytesIO(data)), b''
        with store.open_media(self.profile.actor_id, request['args']) as resource:
            return dict(resource.descriptor), b''.join(iter(lambda: resource.read(65536), b''))

    def close(self):
        if self.closed:
            return
        self.closed = True
        self.server.shutdown()
        with self.lock:
            connections = list(self.connections)
        for connection in connections:
            try:
                connection.shutdown(socket.SHUT_RDWR)
            except OSError:
                pass
        self.server.server_close()
        self.worker.join()
        try:
            shutil.rmtree(self.directory)
        except FileNotFoundError:
            pass


class RemoteProfile:
    authority_path = None

    @classmethod
    def connect(cls, path):
        result, body = exchange(path, {'method': 'binding'})
        if body or set(result) != {'binding', 'outbox'}:
            raise OSError('invalid broker binding')
        self = cls()
        self.path, self.transport_binding = path, dict(result['binding'])
        for key in ('instance_id', 'actor_id', 'authority_id', 'authority_epoch'):
            setattr(self, key, self.transport_binding[key])
        self.db_path, self.outbox_path = Path(self.transport_binding['db_path']), Path(result['outbox'])
        return self

    def store(self):
        return RemoteStore(self)


class RemoteStore:
    def __init__(self, profile):
        self.profile = profile

    def _call(self, actor, method, values, data=b''):
        if actor != self.profile.actor_id:
            raise Refusal('BINDING_MISMATCH', 'Only the bound actor may use this endpoint')
        return exchange(self.profile.path, dict(method=method, binding=self.profile.transport_binding, **values), data)

    def view(self, actor, name, args):
        try:
            return self._call(actor, 'view', {'name': name, 'args': args})[0]
        except (Refusal, BrokerFailure) as error:
            return {'instance_id': self.profile.instance_id, 'error': self._error(error)}

    @staticmethod
    def _error(error):
        return dict(code=error.code, message=error.message, retryable=getattr(error,'retryable',False))

    def _command(self, actor, method, values, data=b''):
        try:
            return self._call(actor,method,values,data)[0]
        except (Refusal, BrokerFailure) as error:
            # An uncertain command remains a StoreError for the CLI's existing
            # saved-operation/attachment handlers. Known preflight attempts use
            # exactly the local Store's error-result contract.
            if isinstance(error,BrokerFailure) and error.exit_code == 1:
                raise
            envelope = values['envelope']
            return {'instance_id':self.profile.instance_id,'operation_id':envelope.get('operation_id'),
                    'kind':envelope.get('kind'),'status':'retryable' if getattr(error,'retryable',False) else 'rejected',
                    'recorded':False,'result':None,'affected':[],'error':self._error(error)}

    def command(self, actor, envelope):
        return self._command(actor, 'command', {'envelope': envelope})

    def publish_media(self, actor, envelope, stream):
        data = stream.read(BODY_LIMIT + 1)
        if len(data) > BODY_LIMIT:
            raise Refusal('MEDIA_TOO_LARGE', 'Keep the media within the existing file limit')
        return self._command(actor, 'publish', {'envelope': envelope}, data)

    def open_media(self, actor, args):
        descriptor, data = self._call(actor, 'open_media', {'args': args})
        return VerifiedMedia(descriptor, data)

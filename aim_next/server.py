from __future__ import annotations

import base64
import hashlib
import hmac
import html
import io
import json
import mimetypes
import os
import secrets
import re
import select
import socket
import sys
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any, Callable
from urllib.parse import quote, unquote, urlsplit

from .authority import AuthorityError
from .contract import LIMITS, Refusal
from .effects_watch import WatchError
from .live import LiveFeed
from .media import INLINE_TYPES


MEDIA_CHUNK = 65536
MEDIA_HEADER_BYTES = 8192
MEDIA_RATE = 256 * 1024
COMMAND_FIELDS = {"v", "instance_id", "operation_id", "kind", "target", "expected", "args"}


class RequestError(Exception):
    def __init__(self, status: int, code: str, message: str):
        self.status, self.code, self.message = status, code, message


class ReadTicket:
    def __init__(self, number, read_class, deadline, disconnected, event):
        self.number, self.read_class, self.deadline = number, read_class, deadline
        self.disconnected, self.event = disconnected, event
        self.state = "new"


class ReadAdmission:
    """Two fixed lanes; a grant belongs to its ticket until callback AND close finish."""
    def __init__(self, clock=time.monotonic):
        self.clock = clock
        self.event_factory = threading.Event
        self.lock = threading.Lock()
        self.number = 0
        self.observer = None  # Private fixture observation only; no retained request log.
        self.lanes = {
            "foreground": {"max_waiters": 8, "queue_timeout_ms": 5000, "active": None, "queue": []},
            "background": {"max_waiters": 2, "queue_timeout_ms": 500, "active": None, "queue": []},
        }

    def capability(self):
        return dict({"version": 1, "header": "X-AIM-Read-Class"}, **{
            name: {"slots": 1, "max_waiters": lane["max_waiters"],
                   "queue_timeout_ms": lane["queue_timeout_ms"]}
            for name, lane in self.lanes.items()})

    def _snapshot(self):
        return {name: {"active": int(lane["active"] is not None), "waiting": len(lane["queue"])}
                for name, lane in self.lanes.items()}

    def snapshot(self):
        with self.lock:
            return self._snapshot()

    def _emit(self, kind, ticket):
        if self.observer is not None:
            self.observer({"event": kind, "request_id": ticket.number,
                           "read_class": ticket.read_class, "state": ticket.state,
                           "at": self.clock(), "lanes": self._snapshot()})

    def _settle(self, ticket, state):
        ticket.state = state
        self._emit(state, ticket)
        ticket.event.set()

    def _grant(self, lane, ticket):
        lane["active"] = ticket
        self._settle(ticket, "granted")

    def _refuse(self, ticket):
        if ticket.state == "withdrawn":
            raise ConnectionResetError("Queued read disconnected")
        raise RequestError(503, "SERVER_BUSY", "This read could not enter its bounded lane.")

    def _advance(self, lane):
        # Expiry, withdrawal and grants share this lock. No timed-out waiter can
        # be granted later, and a granted waiter cannot lose ownership on waking.
        for ticket in list(lane["queue"]):
            state = ("withdrawn" if ticket.disconnected() else
                     "expired" if self.clock() >= ticket.deadline else None)
            if state:
                lane["queue"].remove(ticket)
                self._settle(ticket, state)
        if lane["active"] is None and lane["queue"]:
            self._grant(lane, lane["queue"].pop(0))

    def acquire(self, read_class, request_deadline, disconnected=lambda: False, arrived=None):
        """arrived (on this clock) starts the queue window; it defaults to now."""
        with self.lock:
            lane = self.lanes[read_class]
            now = self.clock()
            self.number += 1
            ticket = ReadTicket(self.number, read_class,
                                min(request_deadline, (now if arrived is None else arrived)
                                    + lane["queue_timeout_ms"] / 1000.0),
                                disconnected, self.event_factory())
            self._advance(lane)
            if disconnected():
                self._settle(ticket, "withdrawn")
            elif self.clock() >= ticket.deadline:
                self._settle(ticket, "expired")
            elif lane["active"] is None:
                self._grant(lane, ticket)
            elif len(lane["queue"]) >= lane["max_waiters"]:
                self._settle(ticket, "full")
            else:
                ticket.state = "waiting"
                lane["queue"].append(ticket)
                self._emit("queued", ticket)
        while True:
            with self.lock:
                # A grant already owns the permit, even after its queue deadline.
                if ticket.state == "granted":
                    return ticket
                if ticket.state != "waiting":
                    self._refuse(ticket)
                self._advance(lane)
                if ticket.state == "granted":
                    return ticket
                if ticket.state != "waiting":
                    self._refuse(ticket)
                remaining = ticket.deadline - self.clock()
            # The ticket's own event wakes the head promptly. Periodic observation
            # permits withdrawal on an observed socket reset without a monitor thread.
            ticket.event.wait(min(0.05, max(0.0, remaining)))

    def release(self, ticket):
        with self.lock:
            lane = self.lanes[ticket.read_class]
            if lane["active"] is not ticket or ticket.state != "granted":
                raise RuntimeError("Read permit is not owned by this ticket")
            lane["active"] = None
            self._settle(ticket, "released")
            self._advance(lane)


class SharedRead:
    def __init__(self, disconnected, arrived):
        self.done = threading.Event()
        self.arrived = arrived
        self.disconnected = (disconnected,)
        self.result = self.error = None
        self.began = False


class SharedReads:
    """Identical reads waiting for their lane share one read.

    The server reads for one actor, so the same view with the same arguments
    and read class answers the same for every page that asks. When a commit is
    announced, each open page asks for the same few views at once; sharing
    keeps that to one waiting place per view, however many pages are open,
    instead of one per page, which the lanes' bounded queues would refuse.

    A request joins a read only while that read still waits for its lane, so
    the answer it gets was read after it arrived. A read that has begun is
    never joined: it may not show a commit the request was asked for. The
    shared read is withdrawn only when every request in it has gone.

    Each request keeps its own queue window, counted from its arrival, so it
    joins only a read that was asked for no later than itself. If the lane
    refuses a shared read before it begins, it refused it for the requests it
    had weighed: the first one's window ran out, or every one had gone. A
    request that joined later asks for itself, within its own window.
    """
    def __init__(self):
        self.lock = threading.Lock()
        self.waiting = {}

    def read(self, key, run, disconnected, arrived=None):
        """run(begun, disconnected) reads, calling begun() once its lane is granted.

        arrived orders requests on the admission clock; None joins any read."""
        while True:
            with self.lock:
                shared = self.waiting.get(key)
                joined = shared is not None and (arrived is None or shared.arrived is None
                                                 or shared.arrived <= arrived)
                if joined:
                    shared.disconnected += (disconnected,)
                else:
                    # A read asked for later than this request may wait past its
                    # window; later requests join this one instead.
                    shared = self.waiting[key] = SharedRead(disconnected, arrived)
            if not joined:
                break
            shared.done.wait()
            if shared.began:
                if shared.error is not None:
                    raise shared.error
                return shared.result

        def leave():
            with self.lock:
                if self.waiting.get(key) is shared:
                    del self.waiting[key]

        def begun():
            shared.began = True
            leave()
        try:
            shared.result = run(begun, lambda: all(gone() for gone in shared.disconnected))
            return shared.result
        except BaseException as error:
            shared.error = error
            raise
        finally:
            leave()
            shared.done.set()


def _unique_object(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise ValueError("Duplicate JSON key")
        result[key] = value
    return result


def _invalid_constant(value):
    raise ValueError("Non-finite JSON number")


class DeadlineInput(io.RawIOBase):
    """A drip cannot renew the total time allowed for receiving a request."""
    def __init__(self, connection, deadline):
        self.connection, self.deadline = connection, deadline

    def readable(self):
        return True

    def readinto(self, buffer):
        remaining = self.deadline - time.monotonic()
        if remaining <= 0:
            raise socket.timeout("Request input deadline expired")
        self.connection.settimeout(remaining)
        return self.connection.recv_into(buffer)


class UploadInput:
    """An exact HTTP frame; Core cannot read into a following request."""
    def __init__(self, handler, length):
        self.handler, self.length = handler, length

    def read(self, size):
        if type(size) is not int or not 1 <= size <= MEDIA_CHUNK:
            raise ValueError("Media reads must be bounded")
        remaining = self.length - self.handler.body_consumed
        if remaining <= 0:
            return b""
        if time.monotonic() >= self.handler.deadline:
            raise socket.timeout("Upload deadline expired")
        data = self.handler.rfile.read1(min(size, remaining))
        self.handler.body_consumed += len(data)
        return data


class AIMHTTPServer(ThreadingHTTPServer):
    live_feed = None
    daemon_threads = False
    block_on_close = True
    allow_reuse_address = True

    def process_request(self, request, client_address):
        if not self.connection_slots.acquire(blocking=False):
            # Refuse this attempt, without assigning a verdict to its operation.
            body = b'{"recorded":false,"error":{"code":"SERVER_BUSY","retryable":true}}'
            try:
                request.settimeout(1)
                request.sendall(b"HTTP/1.0 503 Service Unavailable\r\nConnection: close\r\n"
                                b"Content-Type: application/json\r\nContent-Length: "
                                + str(len(body)).encode("ascii") + b"\r\n\r\n" + body)
            except OSError:
                pass
            finally:
                self.shutdown_request(request)
            return
        try:
            super().process_request(request, client_address)
        except BaseException:
            self.connection_slots.release()
            raise

    def process_request_thread(self, request, client_address):
        try:
            super().process_request_thread(request, client_address)
        finally:
            self.connection_slots.release()

    def server_close(self):
        # Live streams end before their threads are joined.
        if self.live_feed is not None:
            self.live_feed.stop()
        super().server_close()


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.0"
    default_request_version = "HTTP/1.0"
    server_version = "AIMNext"
    sys_version = ""

    def setup(self):
        super().setup()
        self.request_started = time.monotonic()
        self.deadline = self.request_started + self.server.request_timeout
        self.body_consumed = 0
        self.binary_headers_started = False
        self.rfile.close()
        self.rfile = io.BufferedReader(DeadlineInput(self.connection, self.deadline))

    def log_message(self, format, *args):
        # Request paths, bodies and authentication never enter an access log.
        pass

    def _send(self, status: int, body: bytes, content_type: str):
        self._headers(status, content_type, len(body))
        try:
            self.wfile.write(body)
        except (BrokenPipeError, ConnectionResetError):
            pass

    def _headers(self, status: int, content_type: str, length=None):
        self.close_connection = True
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        if length is not None:
            self.send_header("Content-Length", str(length))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("X-Frame-Options", "DENY")
        self.send_header("Referrer-Policy", "no-referrer")
        self.send_header("Connection", "close")
        self.send_header("Content-Security-Policy", "default-src 'self'; script-src 'self'; "
                         "style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; "
                         "connect-src 'self'; frame-ancestors 'none'; base-uri 'none'")
        self.end_headers()

    def _json_response(self, status: int, value: Any):
        body = json.dumps(value, ensure_ascii=False, allow_nan=False,
                          separators=(",", ":")).encode("utf-8")
        self._send(status, body, "application/json; charset=utf-8")

    def _error(self, status: int, code: str, message: str):
        self._json_response(status, {"recorded": False, "error": {
            "code": code, "message": message, "retryable": status in (408, 429, 503)}})
        self._discard_refused_upload()

    def send_error(self, code, message=None, explain=None):
        # Stdlib parser/method errors have the same unconfirmed JSON boundary.
        self._error(code, "HTTP_%d" % int(code), "This HTTP request was refused.")

    def _discard_refused_upload(self):
        # Deliver the refusal before consuming any more bytes. Read in constant
        # space up to 64 MiB and the ORIGINAL input deadline. Larger or slower
        # attempts can still end as transport uncertainty, never a stored result.
        try:
            self.connection.shutdown(socket.SHUT_WR)
            if not hasattr(self, "headers") or self.headers.get("Transfer-Encoding"):
                return
            lengths = self.headers.get_all("Content-Length", [])
            if len(lengths) != 1 or not re.fullmatch(r"[0-9]{1,20}", lengths[0]):
                return
            remaining = min(max(0, int(lengths[0]) - self.body_consumed), 64 * 1024 * 1024)
            while remaining and time.monotonic() < self.deadline:
                data = self.rfile.read(min(65536, remaining))
                if not data:
                    break
                remaining -= len(data)
        except (OSError, ValueError):
            pass

    def _host(self):
        hosts = self.headers.get_all("Host", [])
        if len(hosts) != 1 or hosts[0] not in self.server.origins_by_authority:
            raise RequestError(403, "HOST_REFUSED", "Use an explicitly configured instance address.")
        return self.server.origins_by_authority[hosts[0]]

    def _authorize(self, write=False):
        origin = self._host()
        authorizations = self.headers.get_all("Authorization", [])
        if len(authorizations) != 1:
            raise RequestError(401, "SESSION_REQUIRED", "Use exactly one instance session.")
        authorization = authorizations[0]
        if not hmac.compare_digest(authorization.encode("utf-8"),
                                   ("Bearer " + self.server.session_token).encode("utf-8")):
            raise RequestError(401, "SESSION_REQUIRED", "Open this instance to establish a session.")
        origins = self.headers.get_all("Origin", [])
        if (write or origins) and origins != [origin]:
            raise RequestError(403, "ORIGIN_REFUSED", "This request is not from the instance.")

    def _body(self):
        if self.headers.get("Transfer-Encoding"):
            raise RequestError(400, "INVALID_BODY", "A bounded JSON body is required.")
        lengths = self.headers.get_all("Content-Length", [])
        if len(lengths) != 1:
            raise RequestError(400, "INVALID_BODY", "One content length is required.")
        if not re.fullmatch(r"[0-9]{1,20}", lengths[0]):
            raise RequestError(400, "INVALID_BODY", "Invalid content length.")
        length = int(lengths[0])
        if length > self.server.max_json_bytes:
            raise RequestError(413, "ENVELOPE_TOO_LARGE", "The request exceeds this instance's limit.")
        if self.headers.get_content_type() != "application/json":
            raise RequestError(415, "JSON_REQUIRED", "Use application/json.")
        try:
            raw = self.rfile.read(length)
            self.body_consumed = len(raw)
            if len(raw) != length:
                raise ValueError("Incomplete body")
            value = json.loads(raw.decode("utf-8"), object_pairs_hook=_unique_object,
                               parse_constant=_invalid_constant)
            if not isinstance(value, dict):
                raise ValueError("Object required")
            return value
        except (ValueError, UnicodeError, RecursionError):
            raise RequestError(400, "INVALID_JSON", "A valid JSON object is required.")
        except socket.timeout:
            raise RequestError(408, "INCOMPLETE_BODY", "The request body did not finish.")

    def _read_class(self):
        values = self.headers.get_all("X-AIM-Read-Class", [])
        if not values:
            return "foreground"
        if len(values) != 1 or values[0] not in ("foreground", "background"):
            raise RequestError(400, "INVALID_READ_CLASS", "Use one foreground or background read class.")
        return values[0]

    def _read_disconnected(self):
        # A TCP read EOF alone is only a half-close: the peer may still read our
        # response. Observe a reset/error, otherwise let the original queue bound
        # expire. Never equate client cancellation with release of an active read.
        try:
            if self.connection.fileno() < 0 or self.connection.getsockopt(socket.SOL_SOCKET, socket.SO_ERROR):
                return True
            readable, _, _ = select.select([self.connection], [], [], 0)
            if readable:
                self.connection.recv(1, socket.MSG_PEEK | socket.MSG_DONTWAIT)
        except BlockingIOError:
            return False
        except OSError:
            return True
        return False

    def _store_call(self, callback: Callable, command=False, lane=None, begun=lambda: None,
                    disconnected=None, arrived=None):
        admission = None if command else self.server.read_admission
        ticket = None
        slots = lane or (self.server.command_slots if command else self.server.read_slots)
        read_class = None if command else self._read_class()
        if admission is not None:
            ticket = admission.acquire(read_class, self.deadline, disconnected or self._read_disconnected, arrived)
        elif not slots.acquire(blocking=False):
            raise RequestError(503, "SERVER_BUSY", "This request lane is busy; retain its operation.")
        begun()
        store = None
        try:
            store = self.server.store_factory()
            return callback(store)
        finally:
            try:
                if store is not None:
                    close = getattr(store, "close", None)
                    if callable(close):
                        close()
            finally:
                if ticket is not None:
                    admission.release(ticket)
                else:
                    slots.release()

    def _run(self, action):
        try:
            action()
        except RequestError as error:
            if self.binary_headers_started:
                self.close_connection = True
            else:
                self._error(error.status, error.code, error.message)
        except Refusal as error:
            if self.binary_headers_started:
                self.close_connection = True
            else:
                status = 403 if error.code == "FORBIDDEN" else (400 if error.code == "INVALID_ARGUMENT" else 409)
                self._error(status, error.code, error.message)
        except AuthorityError as error:
            # This attempt did not reach its bound authority. Keep the original
            # operation identity: an earlier attempt may already be recorded.
            if self.binary_headers_started:
                self.close_connection = True
            else:
                self._error(503 if error.retryable else 409, error.code, error.message)
        except (BrokenPipeError, ConnectionResetError, socket.timeout):
            self.close_connection = True
        except Exception:
            # A failure on this attempt cannot settle a possibly committed act.
            if self.binary_headers_started:
                self.close_connection = True
            else:
                self._error(500, "REQUEST_UNCONFIRMED", "The request could not be confirmed; reconcile its operation.")

    def do_POST(self):
        self._run(self._post)

    def _post(self):
        self._authorize(write=True)
        path = urlsplit(self.path).path
        if path == "/api/media/upload":
            return self._upload_media()
        if path == "/api/media/read":
            return self._read_media()
        if path not in ("/api/command", "/api/view"):
            raise RequestError(404, "NOT_FOUND", "No such endpoint.")
        value = self._body()
        if path == "/api/command":
            if set(value) != COMMAND_FIELDS:
                raise RequestError(400, "INVALID_ENVELOPE", "Use the shared command envelope without an actor override.")
            # A read-through report is background work with a lane of its own,
            # so it never takes a command slot that a send or a save needs.
            lane = self.server.read_through_slots if value["kind"] == "topic.read_through" else None
            result = self._store_call(lambda store: store.command(self.server.actor, value), command=True, lane=lane)
        else:
            if set(value) != {"name", "args"} or not isinstance(value["name"], str) or not isinstance(value["args"], dict):
                raise RequestError(400, "INVALID_VIEW", "A view name and argument object are required.")
            # Canonical JSON is the key: the same view and arguments in any key order.
            key = (self._read_class(), json.dumps(value, sort_keys=True, separators=(",", ":")))
            # A request keeps the queue window it started with, even when it
            # joins a shared read and then asks for itself.
            admission = self.server.read_admission
            arrived = None if admission is None else admission.clock()
            result = self.server.shared_reads.read(key, lambda begun, disconnected: self._store_call(
                lambda store: store.view(self.server.actor, value["name"], value["args"]),
                begun=begun, disconnected=disconnected, arrived=arrived), self._read_disconnected, arrived)
            if value["name"] == "health" and isinstance(result, dict) and "error" not in result:
                # The one line Core cannot know: this server, which answered the read.
                result = dict(result, server={"started_ms": self.server.started_ms, "pid": os.getpid(),
                                              "live_feed": self.server.live_feed is not None})
        self._json_response(200, result)

    def _upload_framing(self):
        lengths = self.headers.get_all("Content-Length", [])
        if (self.headers.get_all("Transfer-Encoding", []) or len(lengths) != 1
                or not re.fullmatch(r"[0-9]{1,20}", lengths[0])):
            raise RequestError(400, "INVALID_BODY", "One bounded content length is required.")
        length = int(lengths[0])
        if length > LIMITS["media_file_bytes"]:
            raise RequestError(413, "MEDIA_TOO_LARGE", "Media exceeds this instance's per-file limit.")
        if self.headers.get_all("Content-Type", []) != ["application/octet-stream"]:
            raise RequestError(415, "BINARY_REQUIRED", "Use application/octet-stream.")
        headers = self.headers.get_all("X-AIM-Command", [])
        try:
            if len(headers) != 1 or len(headers[0].encode("ascii")) > MEDIA_HEADER_BYTES:
                raise ValueError("One bounded command header is required")
            value = json.loads(headers[0], object_pairs_hook=_unique_object,
                               parse_constant=_invalid_constant)
            if not isinstance(value, dict) or set(value) != COMMAND_FIELDS or value["kind"] != "media.publish":
                raise ValueError("Media publication envelope required")
        except (ValueError, UnicodeError, RecursionError):
            raise RequestError(400, "INVALID_ENVELOPE", "Use one bounded ASCII JSON media.publish command header.")
        # Update the actual buffered input's raw reader, without discarding any
        # bytes already read alongside the headers. This is not a renewed clock.
        self.deadline = self.request_started + self.server.request_timeout + length / MEDIA_RATE
        self.rfile.raw.deadline = self.deadline
        return length, value

    def _media_call(self, slot, callback):
        if not slot.acquire(blocking=False):
            raise RequestError(503, "SERVER_BUSY", "This media lane is busy; retain its operation.")
        store = None
        try:
            store = self.server.store_factory()
            return callback(store)
        finally:
            try:
                if store is not None:
                    close = getattr(store, "close", None)
                    if callable(close):
                        close()
            finally:
                slot.release()

    def _upload_media(self):
        length, value = self._upload_framing()
        result = self._media_call(self.server.upload_slots,
            lambda store: store.publish_media(self.server.actor, value, UploadInput(self, length)))
        # The slot ends before receipt output or draining an unused retry body.
        self._json_response(200, result)
        if self.body_consumed < length:
            self._discard_refused_upload()

    def _read_media(self):
        args = self._body()
        def output(store):
            with store.open_media(self.server.actor, args) as resource:
                self._send_media(resource)
        return self._media_call(self.server.media_read_slots, output)

    def _send_media(self, resource):
        descriptor = dict(resource.descriptor)
        try:
            encoded = json.dumps(descriptor, ensure_ascii=True, allow_nan=False,
                                 separators=(",", ":"))
            size = descriptor["size_bytes"]
            content_type = descriptor["content_type"]
            name = descriptor["name"]
            if (len(encoded.encode("ascii")) > MEDIA_HEADER_BYTES or type(size) is not int
                    or not 0 <= size <= LIMITS["media_file_bytes"]
                    or not isinstance(name, str) or not isinstance(content_type, str)
                    or not re.fullmatch(r"[A-Za-z0-9!#$&^_.+\-]+/[A-Za-z0-9!#$&^_.+\-]+", content_type)):
                raise ValueError("Invalid descriptor")
        except (KeyError, ValueError, TypeError, UnicodeError):
            raise RequestError(500, "MEDIA_UNCONFIRMED", "Verified media metadata could not be represented.")
        inline = descriptor.get("inline") is True and content_type in INLINE_TYPES
        disposition = "inline" if inline else "attachment"
        filename = quote(name, safe="", encoding="utf-8", errors="strict")
        deadline = time.monotonic() + self.server.request_timeout + size / MEDIA_RATE

        def remaining_timeout():
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                raise socket.timeout("Media output deadline expired")
            self.connection.settimeout(remaining)

        self.close_connection = True
        self.send_response(200)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(size))
        self.send_header("X-AIM-Media", encoded)
        self.send_header("Content-Disposition", disposition + "; filename*=UTF-8''" + filename)
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("X-Frame-Options", "DENY")
        self.send_header("Referrer-Policy", "no-referrer")
        self.send_header("Content-Security-Policy", "default-src 'none'; sandbox; frame-ancestors 'none'; base-uri 'none'")
        self.send_header("Connection", "close")
        remaining_timeout()
        self.binary_headers_started = True
        self.end_headers()
        remaining = size
        while remaining:
            chunk = resource.read(min(MEDIA_CHUNK, remaining))
            if not isinstance(chunk, bytes) or not chunk or len(chunk) > min(MEDIA_CHUNK, remaining):
                raise ValueError("Verified media resource violated its size bound")
            remaining_timeout()
            self.wfile.write(chunk)
            remaining -= len(chunk)

    def do_GET(self):
        self._run(self._get)

    def _get(self):
        self._host()
        path = urlsplit(self.path).path
        if path == "/api/bootstrap":
            self._authorize()
            capabilities = self._store_call(lambda store: store.view(self.server.actor, "capabilities", {}))
            error = capabilities.get("error")
            if isinstance(error, dict) and error.get("code") in (
                    "AUTHORITY_BUSY", "AUTHORITY_CHANGED", "INVALID_BINDING"):
                raise AuthorityError(error["code"], error["message"],
                                     retryable=error.get("retryable") is True)
            if (capabilities.get("instance_id") != self.server.instance_id
                    or not isinstance(capabilities.get("limits"), dict)
                    or capabilities.get("error")):
                raise RequestError(503, "CAPABILITIES_UNAVAILABLE", "The instance binding could not be confirmed.")
            authority = capabilities.get("authority")
            if (not isinstance(authority, dict)
                    or set(authority) != {"authority_id", "authority_epoch", "continuity"}
                    or any(not isinstance(authority[key], str) or not authority[key]
                           for key in ("authority_id", "authority_epoch"))
                    or authority["continuity"] not in ("initial", "complete", "incomplete", "unknown")):
                raise RequestError(503, "CAPABILITIES_UNAVAILABLE", "The instance authority facts could not be confirmed.")
            # Whether the reader is a person or an agent: the page folds a message
            # between others only for a person, for whom alone it is never unread.
            if capabilities.get("actor_kind") not in ("human", "agent"):
                raise RequestError(503, "CAPABILITIES_UNAVAILABLE", "Whether the reader is a person or an agent could not be confirmed.")
            result = {"instance_id": self.server.instance_id, "actor": self.server.actor, "actor_kind": capabilities["actor_kind"],
                      "limits": capabilities["limits"], "authority": authority}
            # Where the page's attention starts: a delivery naming the reader
            # with a larger number arrived after the page opened.
            attention = capabilities.get("attention")
            if isinstance(attention, dict) and type(attention.get("after")) is int:
                result["attention"] = {"after": attention["after"]}
            # The origin a copied link names, so a link copied on the Mac opens
            # on a phone too (docs/links.md, "A message's link").
            if self.server.tailnet_origin is not None:
                result["links"] = {"origin": self.server.tailnet_origin}
            if self.server.read_admission is not None:
                result["transport"] = {"read_admission": self.server.read_admission.capability()}
            # Offered only while the feed runs: an ended feed would only say so.
            if self.server.live_feed is not None and self.server.live_feed.state()[1] is None:
                result.setdefault("transport", {})["live"] = {"version": 2, "path": "/api/live", "protocol": LIVE_PROTOCOL}
            self._json_response(200, result)
            return
        if path == "/api/live":
            self._live()
            return
        if path in ("/api/command", "/api/view", "/api/media/upload", "/api/media/read"):
            raise RequestError(405, "METHOD_REFUSED", "Use POST with the shared API contract.")
        if path.startswith("/api/"):
            raise RequestError(404, "NOT_FOUND", "No such endpoint.")
        try:
            requested = unquote(path).lstrip("/") or "index.html"
            candidate = (self.server.web_root / requested).resolve()
            candidate.relative_to(self.server.web_root)
            suffixes = {".js", ".mjs", ".css", ".svg", ".png", ".ico", ".woff", ".woff2"}
            if candidate.name != "index.html" and candidate.suffix not in suffixes:
                raise ValueError("Not a public asset")
            if not candidate.is_file():
                raise ValueError("Missing asset")
            body = candidate.read_bytes()
        except (ValueError, OSError):
            raise RequestError(404, "NOT_FOUND", "No such public asset.")
        if candidate.name == "index.html":
            body = body.replace(b"__AIM_SESSION_TOKEN__", html.escape(self.server.session_token, quote=True).encode())
        self._send(200, body, mimetypes.guess_type(str(candidate))[0] or "application/octet-stream")

    def _live_handshake(self):
        """Accept a WebSocket for the live feed, or refuse it with the usual JSON error.

        A browser cannot set Authorization on a WebSocket, so the session token
        travels as a second offered subprotocol, bearer.TOKEN, beside
        theseus-live.v1; the answer names only theseus-live.v1. The page's own
        Origin is required, as it is for every write.
        """
        origin = self._host()
        if self.headers.get_all("Origin", []) != [origin]:
            raise RequestError(403, "ORIGIN_REFUSED", "This request is not from the instance.")
        offered = [name.strip() for value in self.headers.get_all("Sec-WebSocket-Protocol", []) for name in value.split(",")]
        tokens = [name[len("bearer."):] for name in offered if name.startswith("bearer.")]
        if (LIVE_PROTOCOL not in offered or len(tokens) != 1
                or not hmac.compare_digest(tokens[0].encode("utf-8"), self.server.session_token.encode("utf-8"))):
            raise RequestError(401, "SESSION_REQUIRED", "Open this instance to establish a session.")
        keys = self.headers.get_all("Sec-WebSocket-Key", [])
        try:
            key_bytes = base64.b64decode(keys[0], validate=True) if len(keys) == 1 else b""
        except ValueError:
            key_bytes = b""
        upgrade = [value.strip().lower() for value in ",".join(self.headers.get_all("Connection", [])).split(",")]
        if (self.headers.get("Upgrade", "").lower() != "websocket" or "upgrade" not in upgrade
                or self.headers.get_all("Sec-WebSocket-Version", []) != ["13"] or len(key_bytes) != 16):
            raise RequestError(400, "WEBSOCKET_REQUIRED", "Live updates are a WebSocket at this address.")
        return base64.b64encode(hashlib.sha1((keys[0] + WEBSOCKET_GUID).encode("ascii")).digest()).decode("ascii")

    def _live(self):
        """One WebSocket text message per new commit number, until the feed ends or the client leaves.

        The first message is the current number. A last message {"end": reason}
        says the feed stopped, followed by a close; a client treats any close
        the same way, reads the views it shows, and reconnects. The stream is a
        WebSocket because a browser keeps those apart from its few HTTP
        connections per host, so open pages never queue their reads behind
        their streams. Writes never block: at most one frame is in flight; a
        later number replaces one not yet started, and a later ping replaces
        one not yet answered (RFC 6455 5.5.3), so a client that pings without
        reading holds one answer, not one per ping. A client that is not
        reading when the feed ends is simply closed.
        """
        # The session and Origin come first: a caller without them learns
        # nothing, not even whether this instance has a feed.
        accept = self._live_handshake()
        feed = self.server.live_feed
        if feed is None:
            raise RequestError(503, "LIVE_UNAVAILABLE", "This instance has no live updates; read the views instead.")
        stream = feed.subscribe()
        if stream is None:
            raise RequestError(503, "SERVER_BUSY", "Every live stream slot is taken.")
        try:
            self.close_connection = True
            self.binary_headers_started = True
            self.wfile.write(("HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n"
                              "Sec-WebSocket-Accept: %s\r\nSec-WebSocket-Protocol: %s\r\n\r\n" % (accept, LIVE_PROTOCOL)).encode("ascii"))
            self.wfile.flush()
            self.connection.setblocking(False)
            sent, pending, ping, received = None, b"", None, b""
            while True:
                seq, ended = feed.state()
                if not pending and ping is not None:
                    pending, ping = _ws_frame(ping, 10), None
                elif not pending and seq != sent:
                    pending, sent = _ws_frame(b'{"seq":%d}' % seq), seq
                if ended:
                    pending += _ws_frame(json.dumps({"end": ended}, separators=(",", ":")).encode("ascii")) + _ws_frame(b"\x03\xe8", 8)
                if pending:
                    try:
                        pending = pending[self.connection.send(pending):]
                    except BlockingIOError:
                        pass
                    except OSError:
                        return
                if ended:
                    return
                readable, _, _ = select.select([self.connection, stream], [self.connection] if pending else [], [])
                if self.connection in readable:
                    try:
                        data = self.connection.recv(4096)
                    except BlockingIOError:
                        data = None
                    except OSError:
                        return
                    if data == b"":
                        return
                    received += data or b""
                    # The client sends nothing but control frames: a ping is
                    # answered, and a close, data or an unreadable frame ends it.
                    while True:
                        frame = _ws_read(received)
                        if frame is None:
                            break
                        opcode, payload, received = frame
                        if opcode == 9:
                            ping = payload
                        elif opcode != 10:
                            if opcode == 8:
                                try:
                                    self.connection.send(_ws_frame(payload[:2], 8))
                                except OSError:
                                    pass
                            return
                    if len(received) > 4096:
                        return
                if stream in readable:
                    os.read(stream, 4096)
        finally:
            feed.unsubscribe(stream)

    def do_OPTIONS(self):
        self._error(405, "METHOD_REFUSED", "Cross-origin API access is not enabled.")

    do_PUT = do_OPTIONS
    do_DELETE = do_OPTIONS
    do_PATCH = do_OPTIONS
    do_HEAD = do_OPTIONS


LIVE_PROTOCOL = "theseus-live.v1"
WEBSOCKET_GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11"


def _ws_frame(payload, opcode=1):
    """One unmasked, final WebSocket frame from the server."""
    size = len(payload)
    if size < 126:
        head = bytes([0x80 | opcode, size])
    elif size < 65536:
        head = bytes([0x80 | opcode, 126]) + size.to_bytes(2, "big")
    else:
        head = bytes([0x80 | opcode, 127]) + size.to_bytes(8, "big")
    return head + payload


def _ws_read(data):
    """(opcode, payload, rest) for the first whole frame from a client, or None while it is incomplete.

    A client frame must be final, masked, small and have no reserved bit set,
    since no extension is agreed; anything else reads as a close."""
    if len(data) < 2:
        return None
    opcode, masked, size = data[0] & 0x0F, data[1] & 0x80, data[1] & 0x7F
    if not masked or size > 125 or data[0] & 0xF0 != 0x80:
        return 8, b"", b""
    if len(data) < 6 + size:
        return None
    mask = data[2:6]
    return opcode, bytes(byte ^ mask[index % 4] for index, byte in enumerate(data[6:6 + size])), data[6 + size:]


def tailnet_authority(origin):
    """Validate one explicit HTTPS address, never an inferred forwarded host."""
    if origin is None:
        return None
    label = r"[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?"
    match = re.fullmatch(r"https://((?:" + label + r"\.)+ts\.net)(?::([1-9][0-9]{0,4}))?",
                         origin) if isinstance(origin, str) else None
    if not match or len(match[1]) > 253 or (match[2] and (int(match[2]) > 65535 or int(match[2]) == 443)):
        raise ValueError("Use one canonical HTTPS .ts.net origin, without a path or credentials")
    return origin[len("https://"):]


def runner_gone(store_factory, emit):
    """What the live feed calls when the runner process it watched ends: tell Core at once, say what Core answered, and return whether it did."""
    from .runner import RunnerError
    from .contract import StoreError

    def gone(pid):
        try:
            record, answered = store_factory().record_runner_exit(pid, None), True
        except (AuthorityError, StoreError, RunnerError) as error:
            # Could not record is not "did not hold the role": say which.
            code = getattr(error, "code", None)
            record, answered = {"status": "unrecorded", "code": code if isinstance(code, str) else type(error).__name__}, False
        emit({"event": "runner_gone", "pid": pid, "record": record})
        return answered
    return gone


def health_due(store_factory, emit):
    """What the live feed calls when Core's next health moment comes with no act first (a lease that
    ended unrenewed, a stop that lasted): have Core settle what is red at once, say what Core
    answered, and return its status, or None when Core could not be told."""
    from .runner import RunnerError
    from .contract import StoreError

    def due(due_ms):
        try:
            record = store_factory().settle_health_due(due_ms)
            status = record["status"]
        except (AuthorityError, StoreError, RunnerError) as error:
            code = getattr(error, "code", None)
            record, status = {"status": "unsettled", "code": code if isinstance(code, str) else type(error).__name__}, None
        if status != "early":
            emit({"event": "health_due", "due_ms": due_ms, "record": record})
        return status
    return due


def _stderr(event):
    print(json.dumps(event, separators=(",", ":")), file=sys.stderr, flush=True)


def create_server(store_factory, instance_id, actor, web_root, *, host="127.0.0.1", port=0,
                  token=None, max_json_bytes=2 * 1024 * 1024, max_reads=2, tailnet_origin=None,
                  live=None):
    external_authority = tailnet_authority(tailnet_origin)
    if host != "127.0.0.1":
        raise ValueError("The first instance binds explicit IPv4 loopback only")
    if not instance_id or not actor:
        raise ValueError("An explicit instance and established actor are required")
    if max_reads < 1 or max_json_bytes < 1:
        raise ValueError("Positive request bounds are required")
    server = AIMHTTPServer((host, port), Handler)
    server.started_ms = int(time.time() * 1000)
    server.store_factory = store_factory
    server.instance_id = instance_id
    server.actor = actor
    server.web_root = Path(web_root).resolve()
    server.session_token = token or secrets.token_urlsafe(32)
    server.max_json_bytes = max_json_bytes
    server.request_timeout = 10.0
    server.read_slots = threading.BoundedSemaphore(max_reads)
    server.read_admission = ReadAdmission() if max_reads == 2 else None
    server.shared_reads = SharedReads()
    server.command_slots = threading.BoundedSemaphore(2)
    server.read_through_slots = threading.BoundedSemaphore(1)
    server.upload_slots = threading.BoundedSemaphore(1)
    server.media_read_slots = threading.BoundedSemaphore(1)
    server.connection_slots = threading.BoundedSemaphore(16)
    server.authority = "%s:%s" % server.server_address
    server.origin = "http://" + server.authority
    server.origins_by_authority = {server.authority: server.origin}
    server.tailnet_origin = tailnet_origin
    if external_authority is not None:
        server.origins_by_authority[external_authority] = tailnet_origin
    if live is not None:
        # live is (database path, companion paths). Without a native watch the
        # instance still serves; the browser reads on its own schedule. The
        # feed reads the commit number on its own thread, so a writer's lock
        # at start delays its first message and never disables it.
        try:
            server.live_feed = LiveFeed(*live, runner_gone=runner_gone(store_factory, _stderr),
                                        health_due=health_due(store_factory, _stderr))
        except (WatchError, OSError):
            server.live_feed = None
    return server

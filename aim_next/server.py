from __future__ import annotations

import hmac
import html
import io
import json
import mimetypes
import secrets
import re
import socket
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any, Callable
from urllib.parse import quote, unquote, urlsplit

from .authority import AuthorityError
from .contract import LIMITS, Refusal
from .media import INLINE_TYPES


MEDIA_CHUNK = 65536
MEDIA_HEADER_BYTES = 8192
MEDIA_RATE = 256 * 1024
COMMAND_FIELDS = {"v", "instance_id", "operation_id", "kind", "target", "expected", "args"}


class RequestError(Exception):
    def __init__(self, status: int, code: str, message: str):
        self.status, self.code, self.message = status, code, message


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
        self.close_connection = True
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("X-Frame-Options", "DENY")
        self.send_header("Referrer-Policy", "no-referrer")
        self.send_header("Connection", "close")
        self.send_header("Content-Security-Policy", "default-src 'self'; script-src 'self'; "
                         "style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; "
                         "connect-src 'self'; frame-ancestors 'none'; base-uri 'none'")
        self.end_headers()
        try:
            self.wfile.write(body)
        except (BrokenPipeError, ConnectionResetError):
            pass

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
        if self.headers.get_all("Host", []) != [self.server.authority]:
            raise RequestError(403, "HOST_REFUSED", "Use this instance's loopback address.")

    def _authorize(self, write=False):
        self._host()
        authorizations = self.headers.get_all("Authorization", [])
        if len(authorizations) != 1:
            raise RequestError(401, "SESSION_REQUIRED", "Use exactly one instance session.")
        authorization = authorizations[0]
        if not hmac.compare_digest(authorization.encode("utf-8"),
                                   ("Bearer " + self.server.session_token).encode("utf-8")):
            raise RequestError(401, "SESSION_REQUIRED", "Open this instance to establish a session.")
        origins = self.headers.get_all("Origin", [])
        if (write or origins) and origins != [self.server.origin]:
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

    def _store_call(self, callback: Callable, command=False):
        slots = self.server.command_slots if command else self.server.read_slots
        if not slots.acquire(blocking=False):
            raise RequestError(503, "SERVER_BUSY", "This request lane is busy; retain its operation.")
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
            result = self._store_call(lambda store: store.command(self.server.actor, value), command=True)
        else:
            if set(value) != {"name", "args"} or not isinstance(value["name"], str) or not isinstance(value["args"], dict):
                raise RequestError(400, "INVALID_VIEW", "A view name and argument object are required.")
            result = self._store_call(lambda store: store.view(self.server.actor, value["name"], value["args"]))
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
            self._json_response(200, {"instance_id": self.server.instance_id,
                                      "actor": self.server.actor, "limits": capabilities["limits"],
                                      "authority": authority})
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

    def do_OPTIONS(self):
        self._error(405, "METHOD_REFUSED", "Cross-origin API access is not enabled.")

    do_PUT = do_OPTIONS
    do_DELETE = do_OPTIONS
    do_PATCH = do_OPTIONS
    do_HEAD = do_OPTIONS


def create_server(store_factory, instance_id, actor, web_root, *, host="127.0.0.1", port=0,
                  token=None, max_json_bytes=2 * 1024 * 1024, max_reads=2):
    if host != "127.0.0.1":
        raise ValueError("The first instance binds explicit IPv4 loopback only")
    if not instance_id or not actor:
        raise ValueError("An explicit instance and established actor are required")
    if max_reads < 1 or max_json_bytes < 1:
        raise ValueError("Positive request bounds are required")
    server = AIMHTTPServer((host, port), Handler)
    server.store_factory = store_factory
    server.instance_id = instance_id
    server.actor = actor
    server.web_root = Path(web_root).resolve()
    server.session_token = token or secrets.token_urlsafe(32)
    server.max_json_bytes = max_json_bytes
    server.request_timeout = 10.0
    server.read_slots = threading.BoundedSemaphore(max_reads)
    server.command_slots = threading.BoundedSemaphore(2)
    server.upload_slots = threading.BoundedSemaphore(1)
    server.media_read_slots = threading.BoundedSemaphore(1)
    server.connection_slots = threading.BoundedSemaphore(16)
    server.authority = "%s:%s" % server.server_address
    server.origin = "http://" + server.authority
    return server

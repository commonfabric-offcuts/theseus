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
from urllib.parse import unquote, urlsplit


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
        self.deadline = time.monotonic() + self.server.request_timeout
        self.body_consumed = 0
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
            self._error(error.status, error.code, error.message)
        except (BrokenPipeError, ConnectionResetError, socket.timeout):
            self.close_connection = True
        except Exception:
            # A failure on this attempt cannot settle a possibly committed act.
            self._error(500, "REQUEST_UNCONFIRMED", "The request could not be confirmed; reconcile its operation.")

    def do_POST(self):
        self._run(self._post)

    def _post(self):
        self._authorize(write=True)
        path = urlsplit(self.path).path
        if path not in ("/api/command", "/api/view"):
            raise RequestError(404, "NOT_FOUND", "No such endpoint.")
        value = self._body()
        if path == "/api/command":
            required = {"v", "instance_id", "operation_id", "kind", "target", "expected", "args"}
            if set(value) != required:
                raise RequestError(400, "INVALID_ENVELOPE", "Use the shared command envelope without an actor override.")
            result = self._store_call(lambda store: store.command(self.server.actor, value), command=True)
        else:
            if set(value) != {"name", "args"} or not isinstance(value["name"], str) or not isinstance(value["args"], dict):
                raise RequestError(400, "INVALID_VIEW", "A view name and argument object are required.")
            result = self._store_call(lambda store: store.view(self.server.actor, value["name"], value["args"]))
        self._json_response(200, result)

    def do_GET(self):
        self._run(self._get)

    def _get(self):
        self._host()
        path = urlsplit(self.path).path
        if path == "/api/bootstrap":
            self._authorize()
            capabilities = self._store_call(lambda store: store.view(self.server.actor, "capabilities", {}))
            if (capabilities.get("instance_id") != self.server.instance_id
                    or not isinstance(capabilities.get("limits"), dict)
                    or capabilities.get("error")):
                raise RequestError(503, "CAPABILITIES_UNAVAILABLE", "The instance binding could not be confirmed.")
            self._json_response(200, {"instance_id": self.server.instance_id,
                                      "actor": self.server.actor, "limits": capabilities["limits"]})
            return
        if path in ("/api/command", "/api/view"):
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
    server.connection_slots = threading.BoundedSemaphore(16)
    server.authority = "%s:%s" % server.server_address
    server.origin = "http://" + server.authority
    return server

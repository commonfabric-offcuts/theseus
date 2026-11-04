from __future__ import annotations

"""Explicit local Store calls; transport success never acknowledges delivery."""

import argparse
import json
import os
from pathlib import Path
import stat
import sys

from .authority import AuthorityError
from .contract import LIMITS, StoreError
from .profile import ProfileError, load_profile


class InvalidRequest(ValueError):
    pass


class UsageError(ValueError):
    pass


class Parser(argparse.ArgumentParser):
    def error(self, message):
        # Do not echo arbitrary arguments or request contents in diagnostics.
        raise UsageError()


def _binding(profile):
    return {"instance_id": profile.instance_id, "actor_id": profile.actor_id,
            "db_path": str(profile.db_path), "authority_id": profile.authority_id,
            "authority_epoch": profile.authority_epoch}


def _unique(pairs):
    value = {}
    for key, item in pairs:
        if key in value:
            raise InvalidRequest()
        value[key] = item
    return value


def _invalid_constant(value):
    raise InvalidRequest()


def _read(source):
    cap = LIMITS["http_envelope_bytes"] + 8192
    raw = bytearray()
    while len(raw) <= cap:
        chunk = source.read(min(65536, cap + 1 - len(raw)))
        if not isinstance(chunk, bytes):
            raise InvalidRequest()
        if not chunk:
            break
        raw.extend(chunk)
    if len(raw) > cap:
        raise InvalidRequest()
    try:
        value = json.loads(raw.decode("utf-8"), object_pairs_hook=_unique,
                           parse_constant=_invalid_constant)
        # Also rejects overflowed floats and escaped lone surrogates anywhere.
        json.dumps(value, ensure_ascii=False, allow_nan=False).encode("utf-8")
        return value
    except (ValueError, UnicodeError, RecursionError) as error:
        raise InvalidRequest() from error


def _input(path, stdin):
    if path == "-":
        return _read(stdin)
    fd = None
    try:
        fd = os.open(path, os.O_RDONLY | os.O_NONBLOCK)
        if not stat.S_ISREG(os.fstat(fd).st_mode):
            raise InvalidRequest()
        with os.fdopen(fd, "rb") as source:
            fd = None
            return _read(source)
    except OSError as error:
        raise InvalidRequest() from error
    finally:
        if fd is not None:
            os.close(fd)


def _request(value, verb):
    if (not isinstance(value, dict) or set(value) != {"v", "binding", verb}
            or type(value["v"]) is not int or value["v"] != 1):
        raise InvalidRequest()
    inner = value[verb]
    if not isinstance(inner, dict):
        raise InvalidRequest()
    if verb == "command":
        if (set(inner) != {"v", "instance_id", "operation_id", "kind", "target", "expected", "args"}
                or type(inner["v"]) is not int or inner["v"] != 1
                or any(not isinstance(inner[key], str) for key in ("instance_id", "operation_id", "kind"))
                or any(not isinstance(inner[key], dict) for key in ("target", "expected", "args"))):
            raise InvalidRequest()
    elif (set(inner) != {"name", "args"} or not isinstance(inner["name"], str)
          or not isinstance(inner["args"], dict)):
        raise InvalidRequest()
    return inner


def _attempt(code, message, retryable=False):
    return {"recorded": False, "error": {"code": code, "message": message, "retryable": retryable}}


def _exit_code(result, verb, inner):
    # A recorded refusal is a successful lookup of the original command.
    if verb == "view" and inner["name"] == "operation" and result.get("recorded") is True:
        return 0
    error = result.get("error")
    return (75 if error.get("retryable") else 2) if error else 0


def _diagnostic(stderr, message):
    try:
        stderr.write(message + "\n")
        stderr.flush()
    except (OSError, ValueError):
        pass


def _output(stdout, stderr, result, code):
    try:
        payload = json.dumps(result, ensure_ascii=False, allow_nan=False, separators=(",", ":")) + "\n"
        if stdout.write(payload) != len(payload):
            raise OSError("Incomplete output")
        stdout.flush()
    except (OSError, ValueError, UnicodeError):
        _diagnostic(stderr, "CLI_OUTPUT_UNCONFIRMED: reconcile the original operation before retrying.")
        if stdout is sys.stdout:
            # Python retries buffered stdout at shutdown. A second broken-pipe
            # flush would replace our unconfirmed exit 1 with exit 120.
            try:
                fd = os.open(os.devnull, os.O_WRONLY)
                try:
                    os.dup2(fd, stdout.fileno())
                finally:
                    os.close(fd)
            except (OSError, ValueError):
                pass
        return 1
    return code


def main(argv=None, *, stdin=None, stdout=None, stderr=None):
    stdin = sys.stdin.buffer if stdin is None else stdin
    stdout = sys.stdout if stdout is None else stdout
    stderr = sys.stderr if stderr is None else stderr
    parser = Parser(prog="aim-next", add_help=False)
    parser.add_argument("--profile", required=True)
    parser.add_argument("verb", choices=("binding", "view", "command"))
    parser.add_argument("request", nargs="?")
    try:
        options = parser.parse_args(argv)
        if (not Path(options.profile).is_absolute()
                or (options.verb == "binding") != (options.request is None)):
            raise UsageError()
        profile = load_profile(options.profile)
        if options.verb == "binding":
            result, code = {"v": 1, "binding": _binding(profile)}, 0
        else:
            value = _input(options.request, stdin)
            inner = _request(value, options.verb)
            if value["binding"] != _binding(profile):
                result, code = _attempt("BINDING_MISMATCH", "Retain the original request and select its exact binding."), 2
            else:
                store = profile.store()
                if options.verb == "command":
                    result = store.command(profile.actor_id, inner)
                else:
                    result = store.view(profile.actor_id, inner["name"], inner["args"])
                code = _exit_code(result, options.verb, inner)
        return _output(stdout, stderr, result, code)
    except UsageError:
        _diagnostic(stderr, "usage: aim-next --profile /absolute/profile.json {binding | view FILE|- | command FILE|-}")
        return 2
    except InvalidRequest:
        return _output(stdout, stderr, _attempt("INVALID_REQUEST", "Use one bounded finite UTF-8 JSON request with an exact binding."), 2)
    except (ProfileError, AuthorityError) as error:
        code = error.code or "PROFILE_UNAVAILABLE"
        return _output(stdout, stderr, _attempt(code, "The explicit profile or authority is unavailable; preserve the original binding.", error.retryable),
                       75 if error.retryable else 2)
    except (StoreError, OSError):
        _diagnostic(stderr, "CLI_REQUEST_UNCONFIRMED: reconcile the original operation before retrying.")
        return 1
    except KeyboardInterrupt:
        _diagnostic(stderr, "CLI_INTERRUPTED: reconcile the original operation before retrying.")
        return 130


if __name__ == "__main__":
    sys.exit(main())

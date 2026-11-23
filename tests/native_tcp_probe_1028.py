from __future__ import annotations
import errno
import json
import os
import socket
import sys
from urllib.parse import urlparse


def probe_tcp(origin, timeout=0.2):
    parsed = urlparse(origin)
    try:
        with socket.socket() as connection:
            connection.settimeout(timeout)
            code = connection.connect_ex((parsed.hostname, parsed.port))
        return {"origin": origin, "event": "connect" if code == 0 else "error",
                "connect_ex": code, "errno_name": errno.errorcode.get(code),
                "message": os.strerror(code), "refused": code == errno.ECONNREFUSED}
    except OSError as error:
        return {"origin": origin, "event": "exception", "connect_ex": None,
                "errno": error.errno, "message": str(error), "refused": False}


if __name__ == "__main__":
    print(json.dumps(probe_tcp(sys.argv[1]), sort_keys=True))

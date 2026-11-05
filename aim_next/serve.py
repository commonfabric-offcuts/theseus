from __future__ import annotations

import argparse
import json
from pathlib import Path
import signal
import sys

from aim_next.profile import load_profile, ProfileError
from aim_next.server import create_server
from aim_next.store import StoreError


def server_for_profile(profile_path, port, web_root=None, *, tailnet_origin=None):
    if type(port) is not int or not 0 <= port <= 65535:
        raise ValueError("Choose an explicit loopback port from 0 through 65535")
    profile = load_profile(profile_path)
    web_root = Path(web_root) if web_root is not None else Path(__file__).resolve().parents[1] / "web"
    if not (web_root / "index.html").is_file():
        raise ValueError("The reader shell is not available in this checkout")
    capabilities = profile.store().view(profile.actor_id, "capabilities", {})
    if capabilities.get("error") or capabilities.get("instance_id") != profile.instance_id:
        raise ProfileError("The instance/actor binding could not be confirmed")
    return create_server(profile.store, profile.instance_id, profile.actor_id, web_root,
                         port=port, max_json_bytes=capabilities["limits"]["http_envelope_bytes"],
                         tailnet_origin=tailnet_origin)


def main(argv=None):
    parser = argparse.ArgumentParser(description="Serve one explicitly bound AIM Next instance on loopback.")
    parser.add_argument("--profile", required=True, help="Private actor/instance profile")
    parser.add_argument("--port", required=True, type=int, help="Explicit loopback port; 0 asks the OS for a free port")
    parser.add_argument("--tailnet-origin", help="One explicit HTTPS .ts.net origin served by Tailscale Serve")
    args = parser.parse_args(argv)
    try:
        server = server_for_profile(args.profile, args.port, tailnet_origin=args.tailnet_origin)
    except (ProfileError, StoreError, OSError, ValueError) as error:
        print("AIM Next did not start: %s%s" % ("%s: " % error.code if getattr(error, "code", None) else "", error),
              file=sys.stderr)
        return 2

    def stop(signum, frame):
        raise KeyboardInterrupt

    previous = signal.signal(signal.SIGTERM, stop)
    try:
        ready = {"status": "ready", "url": server.origin,
                 "instance_id": server.instance_id, "actor": server.actor}
        if server.tailnet_origin:
            ready["tailnet_url"] = server.tailnet_origin
        print(json.dumps(ready), flush=True)
        server.serve_forever(poll_interval=0.2)
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
        signal.signal(signal.SIGTERM, previous)
    return 0


if __name__ == "__main__":
    sys.exit(main())

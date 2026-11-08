#!/usr/bin/python3 -I
from __future__ import annotations

"""An agent's queue in a wake replay (tools/wake_replay.py), standing in for `codex app-server --listen stdio://`.

The wake broker (bin/aim-next-codex-broker) starts it with CODEX_HOME set to the
agent's queue. It answers the broker's initialize, `thread/queue/list` (the
agent has read everything, so the queue is empty) and `thread/queue/add`, and
for each add writes one line to the replay's event FIFO: the agent, the wake
attempt the hint names, and the moment it arrived. It makes no model call and
never runs the agent's CLI; the replay reads the agent's work on its schedule.
"""

import json
import os
import sys
import time
import uuid


def main():
    home = os.environ["CODEX_HOME"]
    with open(os.path.join(home, "standin.json")) as handle:
        config = json.load(handle)
    for line in sys.stdin:
        message = json.loads(line)
        method, request = message.get("method"), message.get("id")
        if request is None:
            continue
        params = message.get("params") or {}
        if method == "initialize":
            result = {"userAgent": config["user_agent"], "codexHome": home, "platformFamily": "unix", "platformOs": "macos"}
        elif method == "thread/queue/list":
            result = {"data": [], "nextCursor": None}
        elif method == "thread/queue/add":
            hint = json.loads(params["input"][0]["text"])
            arrived = {"agent": config["agent"], "attempt_id": hint["attempt_id"], "ms": int(time.time() * 1000)}
            # One line under PIPE_BUF is written whole, whichever agent's broker writes beside it.
            descriptor = os.open(config["events"], os.O_WRONLY | os.O_APPEND)
            try:
                os.write(descriptor, (json.dumps(arrived) + "\n").encode("utf-8"))
            finally:
                os.close(descriptor)
            result = {"queuedSubmission": {"id": "q-" + uuid.uuid4().hex, "clientUserMessageId": params["clientUserMessageId"],
                                           "input": params["input"]}}
        else:
            sys.stdout.write(json.dumps({"id": request, "error": {"code": -32601, "message": "method not found"}}) + "\n")
            sys.stdout.flush()
            continue
        sys.stdout.write(json.dumps({"id": request, "result": result}) + "\n")
        sys.stdout.flush()
    return 0


if __name__ == "__main__":
    sys.exit(main())

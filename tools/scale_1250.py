from __future__ import annotations

"""First1250 slice: verified seeds and one complete topic_messages view."""
import argparse
import contextlib
import json
from pathlib import Path
import subprocess
import sys
import threading
import time
from unittest import mock

REPO = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(REPO), str(REPO / "tests")]
from fixtures.scale_1250 import Seed, open_seed, verify
from aim_next import Store
from aim_next import store as core
from aim_next.server import create_server

ARGS = {"topic_id": "target", "direction": "before", "limit": 30}


def diagnostic(root):
    store, ledger = open_seed(root)
    original, steps, statements = core._connect, [0], []
    def connect(*args, **kwargs):
        db, runtime = original(*args, **kwargs)
        db.set_progress_handler(lambda: steps.__setitem__(0, steps[0] + 1) or 0, 1)
        db.set_trace_callback(lambda sql: statements.append({"sql": sql, "at_step": steps[0]}))
        return db, runtime
    with mock.patch.object(core, "_connect", connect):
        answer = store.view("reader", "topic_messages", ARGS)
    assert "error" not in answer, answer
    for n, statement in enumerate(statements):
        statement["vm_steps"] = (statements[n + 1]["at_step"] if n + 1 < len(statements) else steps[0]) - statement["at_step"]
    return {"view": "topic_messages", "args": ARGS, "target_count": ledger["count"], "vm_steps": steps[0],
            "statements": statements, "scope": "Instrumented diagnostic; not uninstrumented request latency"}


@contextlib.contextmanager
def served(root):
    store, ledger = open_seed(root)
    # The full ledger was verified before measurement. Request construction
    # uses the same fixed descriptor as the normal server, never the ledger.
    path, instance, binding = store.path, ledger["instance_id"], dict(ledger["binding"])
    factory = lambda: Store(path, instance, expected_binding=binding, tools=Path(root) / "empty-tools")
    server = create_server(factory, instance, "reader", REPO / "web", token="isolated-scale-1250")
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        yield {"origin": server.origin, "token": server.session_token, "instance_id": ledger["instance_id"]}
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=5)
        assert not thread.is_alive(), "Owned fixture server did not finish"


def run(root, node):
    root = Path(root).resolve()
    root.mkdir(parents=True, exist_ok=False)
    started = time.monotonic()
    small, large = Seed(root / "small", 100), Seed(root / "large", 30000)
    correctness = {name: verify(root / name) for name in ("small", "large")}
    setup_seconds = time.monotonic() - started
    diagnostics = {name: diagnostic(root / name) for name in ("small", "large")}
    (root / "diagnostics.json").write_text(json.dumps(diagnostics, indent=2))
    with served(small.root) as a, served(large.root) as b:
        config = {"small": a, "large": b, "args": ARGS, "stratum": "warm", "scope": "topic_messages/before30 only"}
        (root / "requests.json").write_text(json.dumps(config, indent=2))
        result = subprocess.run([node, str(REPO / "tools/scale_1250.mjs"), str(root / "requests.json"), str(root / "timing.json")])
    report = {"setup_seconds": setup_seconds, "correctness": correctness, "timing_exit": result.returncode,
              "scope": "Warm first-view slice. Other views, cold/clone strata, whole actions and native retention are separate successors."}
    (root / "report.json").write_text(json.dumps(report, indent=2))
    return result.returncode


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("mode", choices=["seed", "verify", "diagnose", "run"])
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument("--count", type=int, default=30000)
    parser.add_argument("--node", default="/opt/homebrew/bin/node")
    args = parser.parse_args()
    if args.mode == "run":
        return run(args.out, args.node)
    if args.mode == "seed":
        Seed(args.out, args.count)
    answer = diagnostic(args.out) if args.mode == "diagnose" else verify(args.out)
    print(json.dumps(answer, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

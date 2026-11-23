from __future__ import annotations

"""A requesting test that really aborts after an applied private runtime swap."""
import hashlib
import json
import os
from pathlib import Path
import select
import socket
import subprocess
import sys
import traceback
from urllib.parse import urlsplit
from urllib.request import Request, urlopen


def main():
    assert sys.version_info[:2] == (3, 9)
    assert sys.pycache_prefix == os.environ["PYTHONPYCACHEPREFIX"]
    method, phase, destination = sys.argv[1:]
    folder = Path(destination)
    folder.mkdir(parents=True, exist_ok=True)
    report = {"method": method, "phase": phase, "bodyCompleted": False,
              "bodyError": None, "cleanupErrors": [], "controls": []}
    command = [sys.executable, "tests/fixtures/ui_http.py", "--teardown-observations",
               str(folder / "fixture-teardown.jsonl")]
    if method == "reading_785_runtime":
        command.append("--item-785")
    env = dict(os.environ, PYTHONPYCACHEPREFIX=str(folder / "fixture-pycache"))
    report.update(command=command, cachePrefix=env["PYTHONPYCACHEPREFIX"])
    child = subprocess.Popen(command, stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                             stderr=subprocess.PIPE, text=True, env=env)
    report["fixturePid"] = child.pid
    serial = 0

    def control(method, **args):
        nonlocal serial
        serial += 1
        request = dict(args, id=serial, method=method)
        child.stdin.write(json.dumps(request) + "\n")
        child.stdin.flush()
        assert select.select([child.stdout], [], [], 30)[0], "Fixture control timed out"
        line = child.stdout.readline()
        assert line, "Fixture EOF before control response"
        answer = json.loads(line)
        report["controls"].append({"request": request, "response": answer, "raw": line})
        assert answer["id"] == serial and "failure" not in answer, answer
        return answer["answer"]

    try:
        ready = control("ready", runtime_evidence=True)
        report["runtimeEvidence"] = ready["runtime_evidence"]
        assert ready["runtime_evidence"]["pycache_prefix"] == env["PYTHONPYCACHEPREFIX"]
        report["origin"] = ready["origin"]
        report["candidate"] = control("item_783_runtime", phase="restored")
        selected = control(method, phase=phase)
        report["selected"] = selected
        assert selected["hashes"] != report["candidate"]["hashes"], "Real differing Build applied"
        changed = next(name for name, digest in selected["hashes"].items()
                       if digest != report["candidate"]["hashes"].get(name) and name != "index.html")
        url = ready["origin"] + "/b/" + selected["stamp"] + "/" + changed
        with urlopen(Request(url, headers={"Authorization": "Bearer " + ready["token"]}), timeout=5) as response:
            data = response.read()
            report["served"] = {"url": url, "sha256": hashlib.sha256(data).hexdigest(),
                                "csp": response.headers.get("Content-Security-Policy")}
        (folder / "served-source.bin").write_bytes(data)
        assert report["served"]["sha256"] == selected["hashes"][changed]
        raise RuntimeError("1089 requesting test aborted after applied " + method)
    except BaseException:
        report["bodyError"] = traceback.format_exc()
        (folder / "body-error.txt").write_text(report["bodyError"])
        raise
    finally:
        # EOF, not an explicit runtime restore: the fixture owns restoration.
        try:
            tail, errors = child.communicate(timeout=30)
            report.update(fixtureExit=child.returncode, fixtureStdoutTail=tail, fixtureStderr=errors,
                          fixtureEOF=True)
            (folder / "fixture.stdout").write_text("".join(r["raw"] for r in report["controls"]) + tail)
            (folder / "fixture.stderr").write_text(errors)
        except BaseException:
            report["cleanupErrors"].append(traceback.format_exc())
            if child.poll() is None:
                child.terminate()
                child.communicate(timeout=10)
        try:
            os.kill(child.pid, 0)
            report["fixturePidAbsent"] = False
        except ProcessLookupError:
            report["fixturePidAbsent"] = True
        if report.get("origin"):
            address = urlsplit(report["origin"])
            with socket.socket() as probe:
                probe.settimeout(1)
                report["tcpRefused"] = probe.connect_ex((address.hostname, address.port)) != 0
        (folder / "report.json").write_text(json.dumps(report, indent=2) + "\n")


if __name__ == "__main__":
    main()

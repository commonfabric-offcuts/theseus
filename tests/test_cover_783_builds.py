from __future__ import annotations

"""Focused source controls; each invocation is one phase with an effective fresh cache."""
import hashlib
import json
import os
from pathlib import Path
import sys
import subprocess
import tempfile
from types import SimpleNamespace

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(Path(__file__).resolve().parent / "fixtures"))
from aim_next.web_build import load
from item_783_builds import Builds783, hashes783


def qualify(build):
    reply = build.files["reply-stacks.mjs"]
    css = build.files["stack-look.css"]
    assert b"...(p.cover ? [p.cover] : []), head," in reply, "order"
    assert b"background:var(--stack-folder);box-shadow:var(--stack-cover-inset)" in css, "folder/inset"
    assert css.count(b"--stack-cover-inset:inset") == 2, "both themes"


def main(phase):
    assert sys.version_info[:2] == (3, 9)
    assert sys.pycache_prefix == os.environ["PYTHONPYCACHEPREFIX"]
    candidate = load(Path(__file__).resolve().parents[1] / "web")
    qualify(candidate)
    with tempfile.TemporaryDirectory(prefix="cover783-build-") as folder:
        server = SimpleNamespace(build=candidate, csp="default-src 'self';script-src " + " ".join(["'self'"] + ["'%s'" % h for h in candidate.script_hashes]) + ";style-src 'self';")
        builds = Builds783(server, Path(folder), load)
        receipt = builds.select(phase)
        if phase == "restored":
            qualify(server.build)
        else:
            assert server.build.stamp != candidate.stamp, "actual differing Build applied"
            try:
                qualify(server.build)
            except AssertionError as error:
                receipt["caught"] = str(error)
            else:
                raise AssertionError("source control failed to catch " + phase)
        # Execute the actual renderer of the selected complete Build and the same native oracle/comparator.
        subject = Path(folder) / "oracle-build"
        subject.mkdir()
        for name, data in server.build.files.items():
            target = subject / name
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(data)
        oracle = subprocess.run(["node", "tests/local_build_783.mjs", str(subject), phase], text=True, capture_output=True)
        print(oracle.stdout, end="")
        assert oracle.returncode == 0, oracle.stderr
        restored = builds.select("restored")
        assert hashes783(server.build) == hashes783(candidate)
        qualify(server.build)
        for name, data in server.build.files.items():
            target = subject / name
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(data)
        control = subprocess.run(["node", "tests/local_build_783.mjs", str(subject), "restored"], text=True, capture_output=True)
        print(control.stdout, end="")
        assert control.returncode == 0, control.stderr
        print(json.dumps({"phase":phase,"cache_prefix":sys.pycache_prefix,"receipt":receipt,"restoration":restored,"passed":True}))


if __name__ == "__main__":
    main(sys.argv[1])

from __future__ import annotations

"""Focused Build/control checks, without a server, browser, profile or real store."""
import hashlib
import importlib.util
from pathlib import Path
import sys
import tempfile
import unittest
from types import SimpleNamespace

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from aim_next.web_build import load

MODULE_PATH = ROOT / "tests/fixtures/reading_785_runtime.py"


def module_at(path):
    spec = importlib.util.spec_from_file_location("reading785_control", str(path))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def control(module, destination):
    Path(destination).mkdir(parents=True, exist_ok=True)
    candidate = load(ROOT / "web")
    original_csp = "default-src 'self';script-src 'self';img-src 'self';"
    server = SimpleNamespace(build=candidate, csp=original_csp)
    runtime = module.Reading785Runtime(server, destination, load)
    original_hashes = module.hashes(candidate)
    for phase, (name, old, new) in module.MUTATIONS.items():
        receipt = runtime.select(phase)
        assert not receipt["restored"] and receipt["stamp"] != candidate.stamp
        expected = candidate.files[name].replace(old.encode(), new.encode())
        assert server.build.files[name] == expected != candidate.files[name], "actual served mutant bytes"
        assert all(server.build.files[n] == data for n, data in candidate.files.items() if n != name), "unrelated Build bytes"
        assert ("/b/%s/app.mjs" % receipt["stamp"]).encode() in server.build.index, "generated page selects mutant Build"
        assert all(digest in server.csp for digest in server.build.script_hashes), "CSP binds generated Build"
        restored = runtime.select("restored")
        assert restored["hashes"] == original_hashes and server.build is candidate, "byte exact Build restoration"
        assert server.csp == original_csp, "CSP restoration"
        print({"phase": phase, "applied": receipt["hashes"][name], "restored": restored["hashes"][name],
               "stamp": receipt["stamp"], "control": True, "cache_prefix": sys.pycache_prefix}, flush=True)
    runtime.close()


class Reading785BuildCase(unittest.TestCase):
    def test_build_controls(self):
        with tempfile.TemporaryDirectory(prefix="reading785-build-") as destination:
            control(module_at(MODULE_PATH), destination)

    def test_unrestored_runtime_refuses_cleanup(self):
        with tempfile.TemporaryDirectory(prefix="reading785-close-") as destination:
            module = module_at(MODULE_PATH)
            server = SimpleNamespace(build=load(ROOT / "web"), csp="script-src 'self';")
            runtime = module.Reading785Runtime(server, destination, load)
            runtime.select("no-hold")
            with self.assertRaisesRegex(AssertionError, "not restored"):
                runtime.close()
            self.assertIs(server.build, runtime.candidate)

    def test_fixture_compiles(self):
        compile((ROOT / "tests/fixtures/ui_http.py").read_text(), "ui_http.py", "exec")


if __name__ == "__main__":
    # This narrow runner also verifies faults in the instrumentation itself. Each
    # invocation gets a separate effective CPython cache prefix from its caller.
    if len(sys.argv) == 2 and sys.argv[1] in ("mutant-write", "mutant-csp", "restored-write", "restored-csp"):
        phase = sys.argv.pop()
        original = MODULE_PATH.read_bytes()
        variant = original
        if phase == "mutant-write":
            old = b"path.write_bytes(changed if filename == name else data)"
            assert original.count(old) == 1
            variant = original.replace(old, b"path.write_bytes(data)")
        elif phase == "mutant-csp":
            old = b"self.server.build, self.server.csp = self.candidate, self.csp"
            assert original.count(old) == 1
            variant = original.replace(old, b"self.server.build = self.candidate")
        with tempfile.TemporaryDirectory(prefix="reading785-instrument-") as folder:
            path = Path(folder) / "runtime.py"
            path.write_bytes(variant)
            assert path.read_bytes() == variant
            print({"phase": phase, "original_sha256": hashlib.sha256(original).hexdigest(),
                   "applied_sha256": hashlib.sha256(variant).hexdigest(), "cache_prefix": sys.pycache_prefix}, flush=True)
            if phase.startswith("mutant"):
                assert variant != original
                try:
                    control(module_at(path), Path(folder) / "builds")
                except AssertionError as error:
                    expected = "copied public mutant changes Build stamp" if phase == "mutant-write" else "exact candidate Build and CSP restored"
                    assert str(error) == expected, (phase, str(error))
                    print({"caught": phase, "error": str(error)}, flush=True)
                else:
                    raise AssertionError("instrument mutant escaped")
                path.write_bytes(original)
                assert path.read_bytes() == original
                print({"byte_restored": hashlib.sha256(path.read_bytes()).hexdigest()}, flush=True)
            else:
                assert variant == original
                control(module_at(path), Path(folder) / "builds")
    else:
        unittest.main()

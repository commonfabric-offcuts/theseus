from __future__ import annotations

"""Focused applied/caught/restored controls. Run explicitly, never from a suite."""
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
import uuid

ROOT = Path(__file__).resolve().parents[1]


def run(out, core_only=False):
    out.mkdir(parents=True, exist_ok=True)
    phases = []
    py = ROOT / "aim_next/onboarding.py"
    js = ROOT / "web/onboarding.mjs"
    cases = [
        ("core-owner", py, [("if owner is None or owner[0] != actor:", "if owner is None:")], "test_owner_only_and_no_context_read_before_authorization"),
        ("core-scope", py, [("WHERE workspace_id=? AND archived=0", "WHERE ? IS NOT NULL AND archived=0")], "test_secret_canaries_refuse_without_echo_and_private_pages_are_never_read"),
        ("core-secret", py, [("if UNSAFE.search(value):", "if False and UNSAFE.search(value):")], "test_secret_canaries_refuse_without_echo_and_private_pages_are_never_read"),
        ("core-current", py, [
            ('        self._workspace(db, actor, workspace_id)', '        self._workspace(db, actor, workspace_id)\n        if hasattr(self, "_onboarding_cached"):\n            return self._onboarding_cached'),
            ('        return {"instance_id": self.instance_id, "workspace_id": workspace_id, "variant": variant, "prompt": "\\n".join(lines)}',
             '        self._onboarding_cached = {"instance_id": self.instance_id, "workspace_id": workspace_id, "variant": variant, "prompt": "\\n".join(lines)}\n        return self._onboarding_cached')], "test_current_state_and_owner_transfer"),
        ("node-owner", js, [("Boolean(workspace && workspace.owner_id === reader)", "Boolean(workspace)")], None),
        ("node-clipboard", js, [("} catch { return false; }", "} catch { return true; }")], None),
        ("node-current", js, [("this.retry.onclick = () => this.copy(this.variant);", "this.retry.onclick = () => Promise.resolve();")], None),
    ]
    for name, path, replacements, method in cases:
        if core_only and method is None:
            continue
        original = path.read_bytes()
        changed = original.decode()
        for before, after in replacements:
            assert changed.count(before) == 1, (name, before, changed.count(before))
            changed = changed.replace(before, after)
        assert changed.encode() != original
        try:
            path.write_text(changed)
            assert path.read_text() == changed, name + " mutation did not apply"
            for state in ("mutant", "restored"):
                if state == "restored":
                    path.write_bytes(original)
                assert path.read_bytes() == (changed.encode() if state == "mutant" else original)
                cache = out / (name + "-" + state + "-cache-" + uuid.uuid4().hex)
                if method:
                    code = ('import sys,unittest;from pathlib import Path;'
                            'assert sys.version_info[:2]==(3,9);assert sys.pycache_prefix==sys.argv[1];'
                            'print("effective_cache="+sys.pycache_prefix,flush=True);'
                            'sys.path[:0]=[str(Path.cwd()),str(Path.cwd()/"tests")];'
                            'unittest.main(module="test_onboarding_790",defaultTest="OnboardingCase.' + method + '",verbosity=2,argv=["focused"])')
                    cmd = ["/usr/bin/python3", "-I", "-X", "pycache_prefix=" + str(cache), "-c", code, str(cache)]
                else:
                    cmd = ["node", "--test", "--test-concurrency=1", "tests/ui_onboarding_790.test.mjs"]
                result = subprocess.run(cmd, cwd=str(ROOT), stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
                log = out / (name + "-" + state + ".log")
                log.write_text(result.stdout)
                phase = {"name": name, "phase": state, "exit": result.returncode,
                         "applied_sha256": hashlib.sha256(path.read_bytes()).hexdigest(),
                         "log": log.name, "log_sha256": hashlib.sha256(log.read_bytes()).hexdigest(),
                         "effective_cache": str(cache) if method else None}
                phases.append(phase)
                print(json.dumps(phase), flush=True)
                assert (result.returncode != 0) if state == "mutant" else (result.returncode == 0), (name, state, result.stdout)
        finally:
            path.write_bytes(original)
            assert path.read_bytes() == original
    (out / "mutations.json").write_text(json.dumps(phases, indent=2) + "\n")


if __name__ == "__main__":
    run(Path(sys.argv[1]).resolve(), core_only="--core-only" in sys.argv[2:])

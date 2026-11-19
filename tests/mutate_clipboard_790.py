from __future__ import annotations

"""Serial applied/caught/restored controls for the bounded diagnostic source."""
import hashlib
import json
from pathlib import Path
import subprocess
import sys
import uuid

ROOT = Path(__file__).resolve().parents[1]


def main():
    assert sys.version_info[:2] == (3, 9)
    assert sys.pycache_prefix
    out = ROOT / 'docs/evidence/onboarding-790-paste'
    diagnostic = ROOT / 'tests/clipboard_790_diagnostics.mjs'
    expression = ROOT / 'tests/onboarding_790_expressions.mjs'
    mutants = [
        ('viewport-crosses-1px', expression, 'overflow:d.scrollWidth-d.clientWidth', 'overflow:d.scrollWidth-d.clientWidth+2'),
        ('missing-observation', diagnostic, 'observations.push(record);', 'void record;'),
        ('length-instead-of-exact', diagnostic, 'record.exact=value===want;', 'record.exact=value.length===want.length;'),
        ('missing-native-command', diagnostic, "commands:['paste']", 'commands:[]'),
        ('missing-event-phases', diagnostic, 'record.events=await p.evaluate(phases790);', 'record.events=[];'),
    ]
    receipts = []
    for name, path, before, after in mutants:
        original = path.read_bytes()
        assert original.decode().count(before) == 1
        changed = original.decode().replace(before, after).encode()
        assert changed != original
        try:
            for phase, content in [('mutant', changed), ('restored', original)]:
                path.write_bytes(content)
                assert path.read_bytes() == content
                cache = out / ('cache-' + name + '-' + phase + '-' + uuid.uuid4().hex)
                code = ('import sys,subprocess;assert sys.version_info[:2]==(3,9);'
                        'assert sys.pycache_prefix==sys.argv[1];print("effective_cache="+sys.pycache_prefix,flush=True);'
                        'sys.exit(subprocess.call(["node","--test","--test-concurrency=1","tests/clipboard_790_diagnostics.test.mjs"]))')
                result = subprocess.run(['/usr/bin/python3', '-I', '-X', 'pycache_prefix=' + str(cache), '-c', code, str(cache)],
                                        cwd=str(ROOT), stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
                log = out / (name + '-' + phase + '.log')
                log.write_bytes(result.stdout)
                receipt = {'name': name, 'phase': phase, 'source': str(path.relative_to(ROOT)),
                           'original_sha256': hashlib.sha256(original).hexdigest(),
                           'applied_sha256': hashlib.sha256(content).hexdigest(), 'applied': path.read_bytes() == content,
                           'exit': result.returncode, 'effective_cache': str(cache), 'log': log.name,
                           'log_sha256': hashlib.sha256(result.stdout).hexdigest()}
                receipts.append(receipt)
                print(json.dumps(receipt), flush=True)
                assert (result.returncode != 0) if phase == 'mutant' else (result.returncode == 0)
        finally:
            path.write_bytes(original)
            assert path.read_bytes() == original
    (out / 'mutations.json').write_text(json.dumps({'orchestrator_effective_cache': sys.pycache_prefix, 'phases': receipts}, indent=2) + '\n')


if __name__ == '__main__':
    main()

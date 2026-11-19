from __future__ import annotations

"""Private native fixture: applied Core record/routing mutants, one child test process at a time."""
import hashlib
import os
from pathlib import Path
import re
import subprocess
import sys
import tempfile


def run():
    repo = Path(__file__).resolve().parents[2]
    cases = [
        ('record', 'aim_next/dossier_order.py', 'DO UPDATE SET key=excluded.key,entry_key=excluded.entry_key,tie=excluded.tie',
         'DO UPDATE SET key=dossier_order.key,entry_key=excluded.entry_key,tie=excluded.tie'),
        ('routing', 'aim_next/conversation.py', 'published(db, set(self._message_readers(db, positioned, actor)) | set(audience), positioned)',
         'None  # item 731 mutant: publication never routes dossier admission'),
        ('return', 'aim_next/dossier_order.py', 'edge(db, actor, topic, False) if key is None else key',
         'edge(db, actor, topic, True) if key is None else key'),
    ]
    proofs = []
    digest = lambda data: hashlib.sha256(data).hexdigest()
    with tempfile.TemporaryDirectory(prefix='item-731-mutants-') as directory:
        for label, filename, old, new in cases:
            path = repo / filename
            original = path.read_bytes()
            assert original.count(old.encode()) == 1, 'the exact source mutation must apply once'
            changed = original.replace(old.encode(), new.encode())
            cache_mutant = str(Path(directory) / (label + '-mutant-pyc'))
            cache_control = str(Path(directory) / (label + '-control-pyc'))
            def check(cache):
                env = dict(os.environ, PYTHONPYCACHEPREFIX=cache)
                return subprocess.run([sys.executable, '-m', 'unittest', 'discover', '-s', 'tests', '-p', 'test_dossier_order.py'],
                                      cwd=str(repo), env=env, text=True, stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
            try:
                path.write_bytes(changed)
                assert path.read_bytes() == changed and changed != original
                red = check(cache_mutant)
            finally:
                path.write_bytes(original)
            assert path.read_bytes() == original, 'source bytes restored before control'
            green = check(cache_control)
            proof = {'name': label, 'file': filename, 'old': old, 'new': new, 'applied': True,
                     'original_sha256': digest(original), 'mutated_sha256': digest(changed), 'restored_sha256': digest(path.read_bytes()),
                     'mutant_exit': red.returncode, 'mutant_log': red.stdout, 'control_exit': green.returncode, 'control_log': green.stdout,
                     'mutant_cache': cache_mutant, 'control_cache': cache_control}
            proofs.append(proof)
            assert red.returncode != 0 and re.search(r'^FAIL: test_item_731_', red.stdout, re.M), proof
            assert green.returncode == 0, proof
    return proofs

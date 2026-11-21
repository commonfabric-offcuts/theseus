from __future__ import annotations

# Only an isolated real Core/HTTP fixture. Record its temporary root for cleanup
# proof; no commands, app behavior, timing or production account are replaced.
import json
from pathlib import Path
import runpy
import sys
import tempfile

source, evidence = Path(sys.argv[1]).resolve(), Path(sys.argv[2]).resolve()
evidence.mkdir(parents=True, exist_ok=True)
roots = []
original = tempfile.TemporaryDirectory


class ObservedDirectory(original):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        roots.append(self.name)
        (evidence / 'scratch-roots.json').write_text(json.dumps(roots))


tempfile.TemporaryDirectory = ObservedDirectory
sys.path.insert(0, str(source))
sys.path.insert(0, str(source / 'tests' / 'fixtures'))
sys.argv = [str(source / 'tests' / 'fixtures' / 'ui_http.py'), '--freshness', '--live']
runpy.run_path(sys.argv[0], run_name='__main__')

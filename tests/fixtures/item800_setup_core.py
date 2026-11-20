from __future__ import annotations

# Below-browser proof only: execute the existing HTTP fixture's exact setup
# helpers/dispatch bodies, without importing main, creating a server or reading
# any identity/session. Each process owns one disposable real Core store.
import ast
import hashlib
import json
from pathlib import Path
import sqlite3
import sys
import tempfile

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
from aim_next import Store, initialize
from aim_next.stacks import KINDS as STACK_KINDS, current_acts

assert sys.version_info[:2] == (3, 9), sys.version
assert sys.pycache_prefix == sys.argv[1] and sys.pycache_prefix
source = Path('tests/fixtures/ui_http.py').read_bytes()
parsed = ast.parse(source)
main = next(n for n in parsed.body if isinstance(n, ast.FunctionDef) and n.name == 'main')
helpers = {}
for name in ('command', 'agent_message'):
    matches = [n for n in ast.walk(main) if isinstance(n, ast.FunctionDef) and n.name == name]
    assert len(matches) == 1, name
    helpers[name] = compile(ast.fix_missing_locations(ast.Module(body=matches, type_ignores=[])), str(Path('tests/fixtures/ui_http.py')), 'exec')
branches = {}
for method in ('navigation_topics', 'agent_message', 'stack_act', 'private_writing', 'agent_view'):
    matches = [n for n in ast.walk(main) if isinstance(n, ast.If) and
               any(isinstance(v, ast.Compare) and isinstance(v.left, ast.Subscript) and
                   isinstance(v.left.slice, ast.Constant) and v.left.slice.value == 'method' and
                   any(isinstance(c, ast.Constant) and c.value == method for c in v.comparators)
                   for v in ast.walk(n.test))]
    assert len(matches) == 1, (method, len(matches))
    branches[method] = compile(ast.fix_missing_locations(ast.Module(body=matches[0].body, type_ignores=[])), 'tests/fixtures/ui_http.py', 'exec')

def no_attachments(operation, items, sender):
    assert items == [], 'item800 setup publishes no attachments'
    return []

with tempfile.TemporaryDirectory(prefix='item800-setup-') as directory:
    root = Path(directory).resolve()
    path = root / 'data.sqlite3'
    instance, actor = 'ux-http-fixture', 'fixture-person'
    actors = [{'id': actor, 'kind': 'human'}] + [{'id': a, 'kind': 'agent'} for a in ('aim-core', 'aim-ux')]
    binding = initialize(path, instance, actors, authority_path=root / 'control' / 'authority.json')['binding']
    def store():
        return Store(path, instance, expected_binding=binding)
    namespace = dict(globals(), published=no_attachments)
    for code in helpers.values():
        exec(code, namespace)
    namespace['command']('workspace.create', 'fixture-workspace', {'id': 'w1', 'title': 'Isolated wiring', 'team': []})
    print(json.dumps({'ready': True, 'actor': actor, 'python': list(sys.version_info[:3]),
                      'effectiveCache': sys.pycache_prefix, 'fixtureSourceSha256': hashlib.sha256(source).hexdigest(),
                      'helpers': list(helpers), 'controls': list(branches)}), flush=True)
    for line in sys.stdin:
        request = json.loads(line)
        try:
            method = request['method']
            assert method in branches, 'only named setup controls are allowed'
            namespace['request'] = request
            exec(branches[method], namespace)
            reply = {'answer': namespace['answer']}
        except Exception as error:
            reply = {'failure': str(error)}
        print(json.dumps(dict(reply, id=request['id'])), flush=True)
assert not root.exists(), 'owned temporary Core fixture removed on EOF'
print(json.dumps({'cleanup': 'owned temporary Core fixture removed', 'removed': True}), flush=True)

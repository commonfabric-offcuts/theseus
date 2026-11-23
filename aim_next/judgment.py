from __future__ import annotations

"""One source policy for train/admission and Core's actual-diff freeze record."""
import ast
import hashlib
import json
import re
import subprocess
from pathlib import Path

# What an ordinary train may not change: the deploy tool and the modules it
# loads, the files GitHub's classifier pins to its event base, the controller,
# and schema changes without a qualified additive source witness.
# tests/test_tools_train.py derives the dependencies and
# pinned files from their real owners, so a newly loaded module must be guarded.
DEPLOY_TOOL = ("tools/deploy.py", "tools/release_check.py", "tools/unit_shards.py", "tools/known_reds.py", "tools/releases.py", "tools/train.py",
               "tools/checks.py", "tools/ci_known_reds.py", "tools/ci_input_reads.py", "tools/ci-input-reads.json",
               "tools/quarantine.py", "tools/steps_for.py", "tools/base_move.py", "tools/own_case_receipt.py", "tools/continuation_envelope.py",
               "tools/runner_runtime.py", "tools/gauntlet_admission.py", "aim_next/judgment.py")
CONTROLLER = ".github/"
MIGRATIONS = ("aim_next/migrations.py",)
SHA = re.compile(r"[0-9a-f]{40}")


class SourcePaths(list):
    """Paths plus the binder's immutable source witness; JSON remains a path list."""
    migration_sources = None


def guarded(paths, *, migration_sources=None, base=None, head=None):
    return classify_files(paths, migration_sources=migration_sources, base=base, head=head)[0]


def classify_files(paths, *, migration_sources=None, base=None, head=None):
    witness = migration_sources if migration_sources is not None else getattr(paths, 'migration_sources', None)
    classification = migration_classification(paths, witness, base=base, head=head) if witness is not None else None
    additive = classification is not None and classification['ordinary']
    schema = classification['guarded_paths'] if classification else []
    kept = [path for path in paths if path in DEPLOY_TOOL or path.startswith(CONTROLLER) or
            path in MIGRATIONS and not additive or path in schema]
    return kept, classification


def source_diff(repo, base, head, *, run=None, check_ancestry=True):
    """Read actual source outside Core's transaction. Deletions/renames keep both paths."""
    if not Path(repo).is_absolute() or any(not isinstance(s, str) or SHA.fullmatch(s) is None for s in (base, head)):
        raise ValueError("Name an absolute repository and full base/head commits")
    def git(*args):
        argv = ['git', '-C', str(repo)] + list(args)
        result = run(argv) if run is not None else subprocess.run(argv, capture_output=True)
        if result.returncode:
            error = result.stderr.decode('utf-8', 'replace') if isinstance(result.stderr, bytes) else result.stderr or ''
            raise ValueError("The frozen source could not be read: " + error[:300])
        return result.stdout
    if check_ancestry:
        git('merge-base', '--is-ancestor', base, head)
    # No external diff/filter, and no rename folding that could hide a guarded deletion.
    names = git('diff', '--no-ext-diff', '--no-renames', '--name-only', '-z', base, head)
    try:
        if isinstance(names, bytes):
            names = names.decode('utf-8')
        if not isinstance(names, str):
            raise ValueError("The changed source paths could not be read")
        paths = [name for name in names.split('\0') if name]
        return classify_paths(paths, base, head, lambda revision, path: git_source(git, revision, path))
    except UnicodeDecodeError:
        raise ValueError("Changed paths must be UTF-8")


class _Unsupported(ValueError):
    pass


def git_source(git, revision, path):
    """A regular immutable Git blob; no symlink/filter or checkout fallback."""
    entry = git('ls-tree', '-z', revision, '--', path)
    if isinstance(entry, bytes):
        entry = entry.decode('utf-8')
    rows = [r for r in entry.split('\0') if r]
    if len(rows) != 1:
        raise ValueError('Migration source is missing from Git')
    metadata, name = rows[0].split('\t', 1)
    mode, kind, oid = metadata.split()
    if mode not in ('100644', '100755') or kind != 'blob' or name != path:
        raise ValueError('Migration source is not a regular Git blob')
    return git('show', revision + ':' + path)


def _require(value):
    if not value:
        raise _Unsupported('Not a proved additive migration')


def _dump(node):
    return ast.dump(node, include_attributes=False)


def _literal_only(value):
    if not isinstance(value, tuple):
        return True
    return (not value or value[0] not in ('opaque-owner', 'python-owner')) and all(_literal_only(v) for v in value)


def _imports(module):
    result = []
    for node in module.body:
        if isinstance(node, ast.ImportFrom):
            result.extend((node.level, node.module, a.name, a.asname or a.name) for a in node.names)
        elif isinstance(node, ast.Import):
            result.extend((-1, '', a.name, a.asname or a.name.split('.')[0]) for a in node.names)
    return result


class _Declarations:
    """Read a bounded declarative slice, never import/eval candidate Python."""
    def __init__(self, read):
        self.read, self.modules, self.cache, self.active, self.entries, self.weights = read, {}, {}, set(), {}, {}

    def measure(self, value, depth=0):
        _require(depth < 80)
        key = id(value)
        if key in self.weights:
            return self.weights[key][1]
        size = 1
        if isinstance(value, tuple):
            for part in value:
                size += self.measure(part, depth+1)
                _require(size <= 4194304)
        elif isinstance(value, str):
            size = len(value.encode('utf-8'))
        _require(size <= 4194304)
        self.weights[key] = (value, size)
        return size

    def module(self, path):
        if path not in self.modules:
            text = self.read(path)
            _require(isinstance(text, str) and len(text.encode('utf-8')) <= 524288)
            self.modules[path] = ast.parse(text)
        return self.modules[path]

    def declarations(self, path):
        if path in self.entries:
            return self.entries[path]
        values = {}
        for node in self.module(path).body:
            if isinstance(node, ast.Assign):
                for target in node.targets:
                    if isinstance(target, ast.Name):
                        _require(target.id not in values)
                        values[target.id] = node.value
            elif isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
                values[node.name] = node
            elif isinstance(node, ast.ImportFrom) and node.module and (node.level == 1 or node.level == 0 and node.module.startswith('aim_next.')):
                for alias in node.names:
                    module = node.module if node.level == 0 else 'aim_next.' + node.module
                    values[alias.asname or alias.name] = ('import', module.replace('.', '/') + '.py', alias.name)
        self.entries[path] = values
        return values

    def symbol(self, path, name):
        key = (path, name)
        if key in self.cache:
            return self.cache[key]
        _require(key not in self.active and len(self.active) < 80)
        self.active.add(key)
        try:
            value = self.declarations(path)[name]
            if isinstance(value, tuple):
                result = self.symbol(value[1], value[2])
            elif isinstance(value, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
                # Historical callable backfills may remain, but never enter a new
                # ordinary step. Retaining the whole owner is conservative.
                result = ('python-owner', _dump(value) if path == 'aim_next/migrations.py' else
                          hashlib.sha256(self.read(path).encode('utf-8')).hexdigest())
            else:
                result = self.literal(path, value)
            self.measure(result)
            self.cache[key] = result
            return result
        finally:
            self.active.remove(key)

    def literal(self, path, node):
        if isinstance(node, ast.Constant) and type(node.value) in (str, int, bool, type(None)):
            _require(type(node.value) is not int or abs(node.value) < 10**20)
            return node.value
        if isinstance(node, (ast.List, ast.Tuple)):
            value = tuple(self.literal(path, x) for x in node.elts)
            self.measure(value)
            return value
        if isinstance(node, ast.Name):
            return self.symbol(path, node.id)
        if isinstance(node, ast.BinOp):
            a, b = self.literal(path, node.left), self.literal(path, node.right)
            if isinstance(node.op, ast.Add) and type(a) == type(b) and isinstance(a, (str, tuple, int)):
                if isinstance(a, int):
                    _require(abs(a) + abs(b) < 10**20)
                else:
                    _require(len(a) + len(b) <= (524288 if isinstance(a, str) else 4096))
                return a + b
            if isinstance(node.op, ast.Mod) and isinstance(a, str):
                self.measure(b)
                _require('%' not in a.replace('%s', '').replace('%%', '') and a.count('%s') <= 128)
                length = sum(len(str(x)) for x in b) if isinstance(b, tuple) else len(str(b))
                _require(len(a) + length <= 524288)
                return a % b
        if isinstance(node, ast.Call) and isinstance(node.func, ast.Name) and node.func.id in ('list', 'tuple', 'str', 'int') and len(node.args) == 1 and not node.keywords:
            _require(node.func.id not in self.declarations(path))
            value = self.literal(path, node.args[0])
            self.measure(value)
            _require(not isinstance(value, str) or len(value) <= (20 if node.func.id == 'int' else 524288))
            _require(not isinstance(value, int) or abs(value) < 10**20)
            return tuple(value) if node.func.id in ('list', 'tuple') else str(value) if node.func.id == 'str' else int(value)
        # Existing generated declarations need not be interpreted to append a
        # literal step. Pin their complete owner; a changed owner is judged.
        # This marker cannot be used as SQL in a new ordinary step.
        return ('opaque-owner', _dump(node), hashlib.sha256(self.read(path).encode('utf-8')).hexdigest())


def _tokens(sql):
    _require(isinstance(sql, str) and 0 < len(sql) <= 32768 and '\0' not in sql and '--' not in sql and '/*' not in sql)
    sql = sql.strip().removesuffix(';').strip()
    _require(';' not in sql)
    tokens = re.findall(r"'(?:[^']|'')*'|\"[A-Za-z_][A-Za-z_0-9]*\"|[A-Za-z_][A-Za-z_0-9]*|[-+]?[0-9]+(?:\.[0-9]+)?|[^\s]", sql)
    return [t if t.startswith("'") else t.strip('"').lower() for t in tokens]


def _occupied(sql, atoms):
    tokens = _tokens(sql)
    if not atoms:
        return tokens == ['select', '0']
    _require(tokens and tokens.pop(0) == 'select')
    atoms = [tuple(_tokens(a)[1:]) for a in atoms]
    used = []
    def factor(pos):
        if pos < len(tokens) and tokens[pos] == '(':
            pos = expression(pos + 1)
            _require(pos < len(tokens) and tokens[pos] == ')')
            return pos + 1
        for atom in atoms:
            if tuple(tokens[pos:pos+len(atom)]) == atom:
                used.append(atom)
                return pos + len(atom)
        raise _Unsupported('Occupied guard does not cover the added records')
    def expression(pos):
        pos = factor(pos)
        while pos < len(tokens) and tokens[pos] == 'or':
            pos = factor(pos + 1)
        return pos
    return expression(0) == len(tokens) and sorted(used) == sorted(atoms)


def _additive(step):
    old, new, up, down, occupied = step
    _require(isinstance(up, tuple) and isinstance(down, tuple) and 0 < len(up) <= 128 and len(down) <= 128)
    inverses, atoms, tables = [], [], set()
    for sql in up:
        t = _tokens(sql)
        identifier = lambda name: re.fullmatch('[a-z_][a-z_0-9]*', name) is not None
        if len(t) > 5 and t[:2] == ['create', 'table'] and identifier(t[2]) and t[3] == '(':
            _require(t[2] not in tables and 'select' not in t)
            tables.add(t[2]); inverses.append(['drop', 'table', t[2]])
            atoms.append('SELECT EXISTS (SELECT 1 FROM %s)' % t[2])
        elif len(t) > 6 and t[:2] == ['create', 'index'] and identifier(t[2]) and t[3] == 'on' and identifier(t[4]) and t[5] == '(':
            if t[4] not in tables:
                inverses.append(['drop', 'index', t[2]])
        elif len(t) >= 7 and t[:2] == ['alter', 'table'] and identifier(t[2]) and t[3] == 'add':
            tail = t[4:]
            if tail[0] == 'column':
                tail = tail[1:]
            _require(len(tail) >= 2 and identifier(tail[0]) and tail[1] in ('integer', 'real', 'text', 'blob', 'numeric'))
            column, rest = tail[0], tail[2:]
            required = rest[:2] == ['not', 'null']
            if required:
                rest = rest[2:]
            default = 'null'
            if rest:
                _require(len(rest) == 2 and rest[0] == 'default' and (rest[1] == 'null' or rest[1].startswith("'") or re.fullmatch(r'[-+]?[0-9]+(?:\.[0-9]+)?', rest[1])))
                default, rest = rest[1], []
            _require(not required or default != 'null')
            inverses.append(['alter', 'table', t[2], 'drop', 'column', column])
            atoms.append('SELECT EXISTS (SELECT 1 FROM %s WHERE %s IS NOT %s)' % (t[2], column, default))
        else:
            raise _Unsupported('Drop, rename, rewrite, constraint or unsupported migration')
    _require([_tokens(s) for s in down] == list(reversed(inverses)) and _occupied(occupied, atoms))
    return {'from': old, 'to': new, 'up': list(up), 'down': list(down), 'occupied': occupied}


def _coverage(files, before, after, start, finish, loses_records):
    """Require changed executable migration checks, not a test filename/label.

    This is source coverage, not a passing-test claim. The ordinary piece's
    normal tests/review still supply their recorded execution outcomes.
    """
    calls, asserts, loss, targets = 0, False, False, set()
    functions = [n for n in after.module('aim_next/migrations.py').body if isinstance(n, ast.FunctionDef) and n.name == 'migrate']
    _require(len(functions) == 1)
    parameters = [a.arg for a in functions[0].args.args]
    _require('target' in parameters)
    target_index = parameters.index('target')
    for path in files:
        if not path.startswith('tests/test_') or not path.endswith('.py'):
            continue
        try:
            old = {n.name: _dump(n) for n in ast.walk(before.module(path)) if isinstance(n, ast.FunctionDef)}
        except (KeyError, ValueError):
            old = {}
        for node in ast.walk(after.module(path)):
            if not isinstance(node, ast.FunctionDef) or not node.name.startswith('test_') or old.get(node.name) == _dump(node):
                continue
            found = list(ast.walk(node))
            names = [(n.func.id if isinstance(n.func, ast.Name) else n.func.attr if isinstance(n.func, ast.Attribute) else '')
                     for n in found if isinstance(n, ast.Call)]
            calls += sum(name in ('migrate', 'migrate_store') for name in names)
            for call in (n for n in found if isinstance(n, ast.Call)):
                name = call.func.id if isinstance(call.func, ast.Name) else call.func.attr if isinstance(call.func, ast.Attribute) else ''
                if name not in ('migrate', 'migrate_store'):
                    continue
                target = next((k.value for k in call.keywords if k.arg == 'target'),
                              call.args[target_index] if len(call.args) > target_index else ast.Constant(value=finish))
                try:
                    targets.add(after.literal(path, target))
                except (ValueError, KeyError, TypeError):
                    pass
            asserts = asserts or any(name in ('assertEqual', 'assertTrue', 'assertIsNone') for name in names)
            loss = loss or (any(name in ('assertRaises', 'assertRaisesRegex') for name in names) and
                            any(isinstance(n, ast.Constant) and n.value == 'RECORDS_WOULD_BE_LOST' for n in found))
    _require(calls >= 3 and asserts and (loss or not loses_records) and {start, finish} <= targets)


def _qualify(files, read_before, read_after, *, declarations=None):
    before, after = declarations or (_Declarations(read_before), _Declarations(read_after))
    path = 'aim_next/migrations.py'
    old, new = before.declarations(path), after.declarations(path)
    _require('STEPS' in old and 'STEPS' in new and isinstance(old['STEPS'], ast.Tuple) and isinstance(new['STEPS'], ast.Tuple))
    previous, proposed = old['STEPS'].elts, new['STEPS'].elts
    _require(0 < len(proposed) - len(previous) <= 32 and [_dump(n) for n in proposed[:len(previous)]] == [_dump(n) for n in previous])
    old_imports, new_imports = _imports(before.module(path)), _imports(after.module(path))
    remaining = iter(new_imports)
    _require(all(any(binding == current for current in remaining) for binding in old_imports))
    old_names = {b[3] for b in old_imports}
    for level, module, imported, name in new_imports:
        if (level, module, imported, name) not in old_imports:
            _require(name not in old_names and (level == 1 or level == 0 and module.startswith('aim_next.')))
            _require(_literal_only(after.symbol(path, name)))
    # No engine, old declaration or old imported value changes. New imports and
    # new constant declarations may only feed the appended steps.
    for name in old:
        if name != 'STEPS':
            _require(name in new and before.symbol(path, name) == after.symbol(path, name))
    for name, declaration in new.items():
        if name not in old and isinstance(declaration, ast.AST):
            _require(not isinstance(declaration, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)))
            _require(_literal_only(after.symbol(path, name)))  # New assignments cannot execute arbitrary code.
    def engine(module, declarations):
        return [_dump(n) for n in module.body if not isinstance(n, ast.ImportFrom) and not
                (isinstance(n, ast.Assign) and all(isinstance(t, ast.Name) and (t.id == 'STEPS' or t.id not in old) for t in n.targets))]
    _require(engine(before.module(path), old) == engine(after.module(path), new))
    prior_steps = before.symbol(path, 'STEPS')
    new_steps = after.symbol(path, 'STEPS')
    _require(new_steps[:len(prior_steps)] == prior_steps)
    start = before.symbol('aim_next/store.py', 'SCHEMA_VERSION')
    finish = after.symbol('aim_next/store.py', 'SCHEMA_VERSION')
    _require(prior_steps and prior_steps[-1][1] == start and isinstance(start, str) and len(start) <= 9 and start.isdigit())
    steps = []
    for step in new_steps[len(prior_steps):]:
        _require(len(step) == 5 and step[0] == start and step[1] == str(int(start) + 1))
        steps.append(_additive(step)); start = step[1]
    _require(start == finish)
    _coverage(files, before, after, before.symbol('aim_next/store.py', 'SCHEMA_VERSION'), finish,
              any(_tokens(s['occupied']) != ['select', '0'] for s in steps))
    return steps


def migration_classification(paths, witness, *, base=None, head=None):
    """Pure validation in Core; Git and suite execution stay outside its transaction.

    The authorized binder attests source bytes just as it attests changed paths.
    Train/admission independently reread Git, never trusting a caller's mark.
    The receipt keeps hashes and the derived SQL plan; no schema change is needed.
    """
    if (not isinstance(witness, dict) or set(witness) != {'v', 'base_commit', 'head_commit', 'files', 'sources'} or
            type(witness['v']) is not int or witness['v'] != 1 or
            any(not isinstance(witness[k], str) or SHA.fullmatch(witness[k]) is None for k in ('base_commit', 'head_commit')) or
            witness['files'] != sorted(paths) or (base is not None and witness['base_commit'] != base) or
            (head is not None and witness['head_commit'] != head)):
        raise ValueError('Migration source witness does not match the frozen base/head and paths')
    raw = witness['sources']
    if not isinstance(raw, dict) or set(raw) != {'base', 'head'} or not all(isinstance(v, dict) for v in raw.values()):
        raise ValueError('Migration source witness is incomplete')
    sources = {'base': dict(raw['base']), 'head': {}}
    for path, value in raw['head'].items():
        if isinstance(value, dict):
            if value != {'base': path} or path not in raw['base']:
                raise ValueError('Migration source reference is not the same base path')
            value = raw['base'][path]
        sources['head'][path] = value
    size = 0
    for side in sources.values():
        if not isinstance(side, dict) or len(side) > 128:
            raise ValueError('Migration source inputs are bounded')
        for path, text in side.items():
            if (not isinstance(path, str) or not re.fullmatch(r'(aim_next|tests)/[A-Za-z_0-9/]+\.py', path) or
                    text is not None and (not isinstance(text, str) or len(text.encode('utf-8')) > 524288)):
                raise ValueError('Migration source input is not bounded Python source')
            size += len(text.encode('utf-8')) if text is not None else 0
    if size > 4194304:
        raise ValueError('Migration source witness exceeds its bound')
    before, after = _Declarations(sources['base'].__getitem__), _Declarations(sources['head'].__getitem__)
    steps, changed = [], []
    def result():
        return {'base_commit': witness['base_commit'], 'head_commit': witness['head_commit'], 'steps': steps,
                'ordinary': bool(steps), 'guarded_paths': changed,
                'inputs': {side: {p: hashlib.sha256(t.encode('utf-8')).hexdigest() if t is not None else None
                                  for p, t in values.items()} for side, values in sources.items()}}
    try:
        old = before.symbol('aim_next/migrations.py', 'STEPS')
    except (ValueError, KeyError, TypeError, SyntaxError, RecursionError, IndexError):
        # An incomplete witness cannot grant an ordinary schema exception.
        if 'aim_next/migrations.py' in before.modules:
            changed = [p for p in paths if p.startswith('aim_next/') and p.endswith('.py')]
            return result()
        return None
    try:
        new = after.symbol('aim_next/migrations.py', 'STEPS')
        same = new[:len(old)] == old
    except (ValueError, KeyError, TypeError, SyntaxError, RecursionError, IndexError):
        same = False
    if not same:
        owners = set(before.modules) | set(after.modules)
        changed = [p for p in paths if p in owners]
    if any(p in MIGRATIONS for p in paths):
        try:
            steps = _qualify(paths, sources['base'].__getitem__, sources['head'].__getitem__, declarations=(before, after))
        except (ValueError, KeyError, TypeError, SyntaxError, RecursionError, IndexError):
            pass
    if not steps and 'aim_next/store.py' in paths:
        try:
            different = before.symbol('aim_next/store.py', 'SCHEMA_VERSION') != after.symbol('aim_next/store.py', 'SCHEMA_VERSION')
        except (ValueError, KeyError, TypeError, SyntaxError, RecursionError, IndexError):
            different = True
        if different and 'aim_next/store.py' not in changed:
            changed.append('aim_next/store.py')
    return result()


def classify_paths(paths, base, head, read):
    """Attach an immutable source witness only for a qualifying actual Git diff."""
    result = SourcePaths(paths)
    if not any(p.startswith('aim_next/') and p.endswith('.py') for p in paths):
        return result
    sources = {'base': {}, 'head': {}}
    def reader(side, revision):
        def get(path):
            if path not in sources[side]:
                try:
                    value = read(revision, path)
                except ValueError:
                    value = None
                try:
                    value = value.decode('utf-8') if isinstance(value, bytes) else value
                    if isinstance(value, str) and len(value.encode('utf-8')) > 524288:
                        value = None
                except UnicodeError:
                    value = None
                sources[side][path] = value
            return sources[side][path]
        return get
    try:
        before, after = reader('base', base), reader('head', head)
        _Declarations(before).symbol('aim_next/migrations.py', 'STEPS')
        try:
            _Declarations(after).symbol('aim_next/migrations.py', 'STEPS')
        except (ValueError, KeyError, TypeError, SyntaxError, RecursionError, IndexError):
            pass
        if any(p in MIGRATIONS for p in paths):
            try:
                _qualify(paths, before, after)
            except (ValueError, KeyError, TypeError, SyntaxError, RecursionError, IndexError):
                pass
        if 'aim_next/store.py' in paths:
            before('aim_next/store.py'); after('aim_next/store.py')
        # Share identical bodies without compression or a larger transport limit.
        compact = {'base': sources['base'], 'head': {
            p: {'base': p} if p in sources['base'] and text == sources['base'][p] else text
            for p, text in sources['head'].items()}}
        witness = {'v': 1, 'base_commit': base, 'head_commit': head, 'files': sorted(paths), 'sources': compact}
        decoded_bytes = sum(len(t.encode('utf-8')) for side in sources.values() for t in side.values() if isinstance(t, str))
        if decoded_bytes > 4194304 or len(json.dumps(witness).encode('utf-8')) > 1900000:
            # A large/unavailable proof must not grant the exception. Root-only
            # source attests an incomplete declaration slice and keeps it judged.
            witness['sources'] = {side: {p: values[p] for p in ('aim_next/migrations.py', 'aim_next/store.py') if p in values}
                                  for side, values in sources.items()}
        classification = migration_classification(paths, witness)
        if classification and (classification['ordinary'] or classification['guarded_paths']):
            result.migration_sources = witness
    except (ValueError, KeyError, TypeError, SyntaxError, RecursionError, IndexError):
        pass  # Unsupported or unreadable schema inputs keep their judged route.
    return result

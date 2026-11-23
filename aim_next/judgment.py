from __future__ import annotations

"""One path policy for the train guard and Core's actual-diff freeze record."""
import ast
import re
import subprocess
from pathlib import Path

# What an ordinary train may not change: the deploy tool and the modules it
# loads, the files GitHub's classifier pins to its event base, the controller,
# and every schema step. tests/test_tools_train.py derives the dependencies and
# pinned files from their real owners, so a newly loaded module must be guarded.
DEPLOY_TOOL = ("tools/deploy.py", "tools/release_check.py", "tools/unit_shards.py", "tools/known_reds.py", "tools/releases.py", "tools/train.py",
               "tools/checks.py", "tools/ci_known_reds.py", "tools/ci_input_reads.py", "tools/ci-input-reads.json",
               "tools/quarantine.py", "tools/steps_for.py", "tools/base_move.py", "tools/own_case_receipt.py", "tools/continuation_envelope.py",
               "tools/runner_runtime.py", "tools/gauntlet_admission.py", "aim_next/judgment.py")
CONTROLLER = ".github/"
MIGRATIONS = ("aim_next/migrations.py",)
SHA = re.compile(r"[0-9a-f]{40}")


def guarded(paths):
    return [path for path in paths if path in DEPLOY_TOOL or path in MIGRATIONS or path.startswith(CONTROLLER)]


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
        return [name for name in names.split('\0') if name]
    except UnicodeDecodeError:
        raise ValueError("Changed paths must be UTF-8")


TEST_BODY_BYTES = 256 * 1024
TEST_TOTAL_BYTES = 1024 * 1024


def python_test_paths(files):
    return [p for p in files if p.startswith('tests/') and p.endswith('.py')]


def source_test_bodies(repo, head, files):
    """Bind inert regular blobs to this exact head, outside Core's transaction."""
    bodies, total = {}, 0
    def git(*args):
        result = subprocess.run(['git', '-C', str(repo)] + list(args), capture_output=True)
        if result.returncode:
            raise ValueError('The frozen test source could not be read: ' + result.stderr.decode('utf-8', 'replace')[:300])
        return result.stdout
    for path in python_test_paths(files):
        entry = git('ls-tree', '-z', '--full-tree', head, '--', path)
        if not entry:
            bodies[path] = None
            continue
        fields, name = entry.rstrip(b'\0').split(b'\t', 1)
        mode, kind, oid = fields.split()
        if mode not in (b'100644', b'100755') or kind != b'blob' or name != path.encode('utf-8'):
            raise ValueError(path + ': frozen Python tests must be regular Git blobs')
        size = int(git('cat-file', '-s', oid.decode('ascii')))
        total += size
        if size > TEST_BODY_BYTES or total > TEST_TOTAL_BYTES:
            raise ValueError(path + ': frozen Python test source exceeds the bounded body limit')
        try:
            bodies[path] = git('cat-file', 'blob', oid.decode('ascii')).decode('utf-8')
        except UnicodeDecodeError:
            raise ValueError(path + ': frozen Python test source must be UTF-8')
    return bodies


def _version_literal(node):
    return isinstance(node, ast.Constant) and isinstance(node.value, str) and re.fullmatch(r'[0-9]+', node.value) is not None


def _metadata(node):
    return ((isinstance(node, ast.Name) and node.id == 'metadata') or
            (isinstance(node, ast.Attribute) and node.attr == 'metadata'))


def _step_reference(node):
    return any(isinstance(n, ast.Name) and (n.id in ('step', 'STEPS') or n.id.endswith('_step'))
               for n in ast.walk(node))


def _step_pair(node):
    return isinstance(node, (ast.Tuple, ast.List)) and len(node.elts) == 2 and all(_version_literal(n) for n in node.elts)


def _numbered_migration(tree):
    aliases = {'migrate'}
    for node in ast.walk(tree):
        if isinstance(node, ast.ImportFrom) and node.module == 'aim_next.migrations':
            aliases.update(n.asname or n.name for n in node.names if n.name == 'migrate')
    found = []
    for node in ast.walk(tree):
        bad = False
        if isinstance(node, ast.Call):
            name = node.func.id if isinstance(node.func, ast.Name) else getattr(node.func, 'attr', '')
            if name in aliases or isinstance(node.func, ast.Attribute) and name == 'migrate':
                targets = node.args[3:4] + [k.value for k in node.keywords if k.arg == 'target']
                bad = any(_version_literal(n) for n in targets)
            if name in ('assertEqual', 'assertSequenceEqual', 'assertTupleEqual', 'assertListEqual') and len(node.args) >= 2:
                a, b = node.args[:2]
                bad = bad or (_step_reference(a) and _step_pair(b)) or (_step_reference(b) and _step_pair(a))
            if isinstance(node.func, ast.Attribute) and node.func.attr == 'update' and _metadata(node.func.value):
                bad = bad or any(k.arg == 'schema_version' and _version_literal(k.value) for k in node.keywords)
                for mapping in node.args:
                    if isinstance(mapping, ast.Dict):
                        bad = bad or any(isinstance(key, ast.Constant) and key.value == 'schema_version'
                                         and _version_literal(value) for key, value in zip(mapping.keys, mapping.values))
            # SQL text remains data. SELECTs, unrelated tables and ordinary numbers are not migration writes.
            if node.args and isinstance(node.args[0], ast.Constant) and isinstance(node.args[0].value, str):
                sql = node.args[0].value
                writes_metadata = re.match(r'\s*(?:UPDATE\s+|INSERT\s+(?:OR\s+\w+\s+)?INTO\s+|REPLACE\s+INTO\s+)["`\[]?metadata\b', sql, re.I)
                params = list(ast.walk(node.args[1])) if len(node.args) > 1 else []
                schema_key = 'schema_version' in sql.lower() or any(isinstance(n, ast.Constant) and n.value == 'schema_version' for n in params)
                if writes_metadata and schema_key:
                    bad = bad or re.search(r'''['"]([0-9]+)['"]''', sql) is not None or any(_version_literal(n) for n in params)
        if isinstance(node, (ast.Assign, ast.AnnAssign)):
            targets = node.targets if isinstance(node, ast.Assign) else [node.target]
            for target in targets:
                field = (isinstance(target, ast.Subscript) and _metadata(target.value) and
                         isinstance(target.slice, ast.Constant) and target.slice.value == 'schema_version')
                field = field or (isinstance(target, ast.Attribute) and target.attr == 'schema_version' and _metadata(target.value))
                bad = bad or field and _version_literal(node.value)
        if isinstance(node, ast.Assert) and isinstance(node.test, ast.Compare):
            values = [node.test.left] + node.test.comparators
            bad = any(_step_reference(v) for v in values) and any(_step_pair(v) for v in values)
        if bad:
            found.append(node.lineno)
    return min(found) if found else None


def validate_test_sources(files, bodies):
    """Pure bounded source validation; called by Core before any freeze mutation."""
    from .contract import Refusal
    paths = python_test_paths(files)
    if not isinstance(bodies, dict) or set(bodies) != set(paths):
        raise Refusal('INVALID_ARGUMENT', 'A freeze supplies exact changed Python test bodies in test_sources (null for deleted paths)')
    total = 0
    for path in sorted(paths):
        body = bodies[path]
        if body is None:
            continue
        try:
            size = len(body.encode('utf-8')) if isinstance(body, str) else TEST_BODY_BYTES + 1
        except UnicodeEncodeError:
            raise Refusal('INVALID_ARGUMENT', path + ': frozen Python test source must be UTF-8')
        total += size
        if size > TEST_BODY_BYTES or total > TEST_TOTAL_BYTES:
            raise Refusal('INVALID_ARGUMENT', path + ': frozen Python test source exceeds the bounded body limit')
        try:
            tree = ast.parse(body, filename=path)
        except (SyntaxError, ValueError, RecursionError) as error:
            raise Refusal('INVALID_ARGUMENT', '%s:%s: frozen Python test source cannot be parsed' % (path, getattr(error, 'lineno', None) or 1))
        line = _numbered_migration(tree)
        if line is not None:
            raise Refusal('MIGRATION_TEST_LITERAL', '%s:%d: locate the schema step by its token '
                          '(next(step for step in STEPS if step[2] is X_SCHEMA)); use STEPS[-1][1] for latest' % (path, line),
                          details={'file': path, 'line': line})

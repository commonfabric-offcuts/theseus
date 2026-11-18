from __future__ import annotations

"""Conservative repository-input discovery; never imports or executes test code.

All test data is frozen. Literal references in read-bearing modules also pull
non-product repository files into the plan. Opaque filesystem expressions need
an explicit, reviewed declaration; new expressions fail with an author-facing
message rather than silently extending the old read boundary.
"""
import ast
from collections import defaultdict
import posixpath
import subprocess

from tools import steps_for
from functools import lru_cache
import hashlib
import json
from pathlib import PurePosixPath
import re

EXTERNAL = frozenset(('docs/tools.md', 'docs/agent-cli.md', 'docs/agent-guide.md',
                      'docs/team-assessments.md', 'bin/aim-next', 'bin/aim-next-admin',
                      'bin/aim-next-server', 'bin/aim-next-runner',
                      'bin/aim-next-codex-broker', 'bin/aim-next-assess'))
PRODUCT = ('aim_next/', 'web/')
# The authority policy is separately bound to its exact event-base bytes; a
# test's synthetic copy is not a recursively self-hashing fixture dependency.
AUTHORITY = '.github/check-baseline.json'
READ_NAMES = frozenset(('open', 'read', 'read_text', 'read_bytes', 'readline', 'readlines',
                        'readFile', 'readFileSync', 'openSync', 'createReadStream'))
JS_READ = re.compile(r'\b(?:readFileSync|readFile|openSync|createReadStream)\s*\(')
QUOTED = re.compile(r'''(["'`])((?:\\.|(?!\1)[^\\])*?)\1''', re.S)


@lru_cache(maxsize=4096)
def read_calls(path, text):
    """Return stable read-expression signatures and literal path components."""
    calls, literals = {}, set()
    if path.endswith('.py'):
        tree = ast.parse(text, filename=path)
        aliases = set(READ_NAMES)
        for node in ast.walk(tree):
            if isinstance(node, ast.ImportFrom):
                aliases.update(alias.asname or alias.name for alias in node.names if alias.name in READ_NAMES)
        for node in ast.walk(tree):
            if isinstance(node, ast.Constant) and isinstance(node.value, str):
                literals.add(node.value)
            if isinstance(node, ast.Call):
                name = node.func.attr if isinstance(node.func, ast.Attribute) else node.func.id if isinstance(node.func, ast.Name) else ''
                if name in aliases:
                    expression = ast.dump(node, include_attributes=False)
                    signature = hashlib.sha256(expression.encode()).hexdigest()
                    suffix = sum(key == signature or key.startswith(signature + ':') for key in calls)
                    calls[signature + (':' + str(suffix) if suffix else '')] = ast.get_source_segment(text, node) or expression
    elif path.endswith(('.mjs', '.js')):
        # Keep string spelling in the signature. Balanced calls are deliberately
        # conservative; source equivalence still independently checks all bytes.
        for match in QUOTED.finditer(text):
            literals.add(match[2])
        aliases = re.findall(r'\b(?:readFileSync|readFile|openSync|createReadStream)\s+(?:as\s+|:\s*)([A-Za-z_$][\w$]*)', text)
        pattern = re.compile(r'\b(?:readFileSync|readFile|openSync|createReadStream|' + '|'.join(re.escape(name) for name in aliases) + r')\s*\(') if aliases else JS_READ
        for match in pattern.finditer(text):
            start, cursor, depth, quote = match.start(), match.end(), 1, None
            while cursor < len(text) and depth:
                char = text[cursor]
                if quote:
                    if char == '\\': cursor += 1
                    elif char == quote: quote = None
                elif char in '\"\'`': quote = char
                elif char == '(': depth += 1
                elif char == ')': depth -= 1
                cursor += 1
            expression = text[start:cursor]
            signature = hashlib.sha256(expression.encode()).hexdigest()
            suffix = sum(key == signature or key.startswith(signature + ':') for key in calls)
            calls[signature + (':' + str(suffix) if suffix else '')] = expression
    return calls, literals


def referenced_paths(path, literals, tracked):
    """Over-approximate literal references, including root/'docs'/'name.md'."""
    found, spelled = set(), set()
    for literal in literals:
        if '\n' in literal or len(literal) > 1024:
            continue
        components = literal.split('/')
        for offset in range(len(components)):
            spelled.add('/'.join(components[offset:]))
        if literal.startswith(('./', '../')):
            pieces = []
            for part in (PurePosixPath(path).parent / literal).parts:
                if part == '..':
                    if pieces: pieces.pop()
                elif part != '.': pieces.append(part)
            spelled.add('/'.join(pieces))
    for candidate in tracked:
        if candidate.startswith(PRODUCT) or candidate == AUTHORITY:
            continue
        parts = PurePosixPath(candidate).parts
        if candidate in spelled or all(part in literals for part in parts):
            found.add(candidate)

    return found


def discover(files, declarations):
    """files is tracked path -> bytes; declarations come from trusted verifier.

    A declared opaque expression is a review obligation, not proof of arbitrary
    dynamic Python/JS behavior. New read expressions must name repository inputs
    or explicitly classify generated/system/product reads in the declaration.
    """
    frozen = {p for p in files if p.startswith(('tests/', 'tools/'))}
    frozen |= EXTERNAL & set(files)
    errors = []
    for path, data in files.items():
        if not path.startswith('tests/') or not path.endswith(('.py', '.mjs', '.js')):
            continue
        calls, literals = read_calls(path, data.decode('utf-8-sig'))
        if not calls:
            continue
        referenced = referenced_paths(path, literals, files)
        frozen |= referenced
        known = declarations.get(path, {})
        for signature, expression in calls.items():
            declaration = known.get(signature)
            if declaration is None:
                errors.append('%s: undeclared file read %s; declare its repository inputs or generated/system/product scope in tools/ci-input-reads.json' % (path, expression[:160]))
                continue
            if not isinstance(declaration, dict) or set(declaration) != {'scope', 'inputs'} or declaration['scope'] not in ('repository', 'generated/system/product'):
                errors.append(path + ': invalid read declaration')
                continue
            inputs = declaration['inputs']
            if not isinstance(inputs, list) or not all(isinstance(p, str) and p in files for p in inputs):
                errors.append(path + ': declared read input missing from tracked source')
                continue
            # Definition freezing and execution reachability are separate.
            # Product stays editable; the execution graph retains these real edges.
            frozen |= {p for p in inputs if p != AUTHORITY and not p.startswith(PRODUCT)}
    return frozenset(frozen), errors


# Complete execution input graph (item 734); distinct from definition freezing.
MANDATORY = ('python-units', 'node-units', 'deploy-refusals', 'wake-replay')
SCOPE_AUTHORITY = frozenset(('tools/forward_plan.py', 'tools/compose_forward.py', 'tools/compose_groups.py', 'tools/compose_inventory.cjs', 'tools/compose_instrument.cjs', 'tools/compose_deadline_775.mjs', 'tools/compose_worker_775.mjs', 'tools/run_compose_group.py', 'tools/ci-input-reads.json', 'tools/ci_input_reads.py',
                       'tools/steps_for.py', 'tools/release_check.py',
                       'tools/unit_shards.py', 'tools/train.py'))


class Refused(Exception):
    pass


def require(ok, message):
    if not ok:
        raise Refused(message)


def canonical(value):
    return json.dumps(value, sort_keys=True, separators=(',', ':')).encode()


def digest(data):
    return hashlib.sha256(data).hexdigest()


def git(root, *args, **kwargs):
    result = subprocess.run(['/usr/bin/git', '-C', str(root), '--no-replace-objects'] + list(args),
                            capture_output=True, **kwargs)
    require(result.returncode == 0, 'unreadable committed source: git ' + ' '.join(args))
    return result.stdout


def source_files(root, head):
    require(isinstance(head, str) and re.fullmatch('[0-9a-f]{40}', head), 'source needs an exact commit')
    require(git(root, 'rev-parse', '--verify', head + '^{commit}').decode().strip() == head, 'source is not a commit')
    rows = git(root, 'ls-tree', '-rz', '--full-tree', head).split(b'\0')
    entries = []
    for row in rows:
        if not row:
            continue
        info, path = row.split(b'\t', 1); mode, kind, oid = info.split()
        name = path.decode('utf-8')
        require(mode in (b'100644', b'100755') and kind == b'blob', 'unsupported source entry: ' + name)
        require(not name.startswith('/') and '..' not in PurePosixPath(name).parts, 'unsafe source path')
        entries.append((name, oid))
    raw = git(root, 'cat-file', '--batch', input=b''.join(oid + b'\n' for _, oid in entries))
    files, cursor = {}, 0
    for path, oid in entries:
        end = raw.index(b'\n', cursor); actual, kind, size = raw[cursor:end].split()
        require(actual == oid and kind == b'blob', 'source object differs')
        cursor = end + 1; data = raw[cursor:cursor + int(size)]; cursor += int(size) + 1
        require(hashlib.sha1(b'blob ' + str(len(data)).encode() + b'\0' + data).hexdigest().encode() == oid,
                'source bytes differ: ' + path)
        files[path] = data
    require(cursor == len(raw), 'unexpected source objects')
    return files


def _module(name, files):
    path = name.replace('.', '/')
    return next((p for p in (path + '.py', path + '/__init__.py') if p in files), None)


def python_files(files):
    """Import-free mirror of unit_shards.test_files, including package hooks."""
    result = set()
    for path in files:
        parts = PurePosixPath(path).parts
        if len(parts) < 2 or parts[0] != 'tests':
            continue
        parents = ['/'.join(parts[:n]) + '/__init__.py' for n in range(2, len(parts))]
        if not all(p in files for p in parents):
            continue
        name = parts[-1]
        if (name.startswith('test_') and re.fullmatch(r'[A-Za-z_][A-Za-z0-9_]*\.py', name)) or name == '__init__.py':
            result.add(path)
    return sorted(result)


def readers(files):
    require('tools/ci-input-reads.json' in files, 'missing read declarations')
    try:
        declarations = json.loads(files['tools/ci-input-reads.json'])
        require(isinstance(declarations, dict), 'invalid read declarations')
        _, errors = discover(files, declarations)
        require(not errors, 'input discovery incomplete: ' + '; '.join(errors))
        definitions = steps_for.read_steps(files['tools/release_check.py'].decode('utf-8-sig'))
    except (ValueError, KeyError, SyntaxError, UnicodeError) as error:
        raise Refused('unreadable discovery: %s' % error)
    required = list(MANDATORY) + ['native-' + s.name for s in definitions]
    require(len(required) == len(set(required)) and bool(definitions), 'invalid step discovery')
    reached, edges = defaultdict(set), defaultdict(set)
    product = {p for p in files if p.startswith(('aim_next/', 'web/', 'bin/'))}
    # Every native step drives the served product. Unit import/hooks, static
    # source assertions and replay also may read it. This broad edge is honest:
    # dynamic/generated product reads never establish product unreachability.
    for path in product:
        reached[path].update(required)
    python_roots = set(python_files(files))
    for path in files:
        if path in python_roots:
            reached[path].add('python-units')
            if path in ('tests/test_tools_deploy.py', 'tests/test_tools_train.py'):
                reached[path].add('deploy-refusals')
        if PurePosixPath(path).parent == PurePosixPath('tests') and path.endswith('.test.mjs'):
            reached[path].add('node-units')
        if path in SCOPE_AUTHORITY or path in ('tools/train.py', 'tools/deploy.py', 'tools/ci_known_reds.py',
                                              'tools/known_reds.py', 'tools/checks.py', 'tools/releases.py',
                                              'tools/native.py', 'tools/quarantine.py', 'tools/wake_replay.py',
                                              'tools/wake_standin.py') or path.startswith('.github/'):
            # Runner, declaration, policy, workflow and shared helper changes
            # cannot reduce their own coverage. Unknown tool inputs run all.
            reached[path].update(required)
    for step in definitions:
        require(step.harness in files, 'missing harness input: ' + step.harness)
        reached[step.harness].add('native-' + step.name)
    for path in ('tools/wake_replay.py', 'tools/wake_standin.py', 'tests/wake_replay.json'):
        if path in files:
            reached[path].add('wake-replay')
    # No branch-dependent pruning: an imported helper executes its top level
    # even if a particular export is never called by the selected mode.
    for path, data in files.items():
        if not path.startswith(('tests/', 'aim_next/', 'web/')) or not path.endswith(('.py', '.mjs', '.js')):
            continue
        text = data.decode('utf-8-sig')
        calls, literals = read_calls(path, text)
        edges[path].update(referenced_paths(path, literals, files))
        if path.startswith('tests/'):
            for signature in calls:
                declaration = declarations[path][signature]
                edges[path].update(declaration['inputs'])
                if declaration['scope'] == 'generated/system/product':
                    edges[path].update(product)
        if path.endswith('.py'):
            tree = ast.parse(text, filename=path)
            for node in ast.walk(tree):
                names = []
                if isinstance(node, ast.Import):
                    names = [a.name for a in node.names]
                elif isinstance(node, ast.ImportFrom):
                    prefix = node.module or ''
                    if node.level:
                        parts = path.split('/')[:-node.level]
                        prefix = '.'.join(parts + ([prefix] if prefix else []))
                    names = [prefix] + [prefix + '.' + a.name for a in node.names]
                for name in names:
                    target = _module(name, files)
                    # unittest adds tests/ to its module path.
                    target = target or _module('tests.' + name, files)
                    if target:
                        edges[path].add(target)
        else:
            tokens = steps_for.tokenize(text)[0]
            for index, token in enumerate(tokens[:-1]):
                if token.kind != 'id' or token.text not in ('import', 'from'):
                    continue
                following = tokens[index + 1]
                if following.text == '(':
                    following = tokens[index + 2]
                    if following.kind != 'str':
                        edges[path].update(files)
                        continue
                if following.kind != 'str':
                    continue
                specifier = steps_for.js_string(following)[0]
                if specifier.startswith('.'):
                    target = posixpath.normpath(posixpath.join(posixpath.dirname(path), specifier))
                    require(target in files, 'missing imported input: ' + target)
                    edges[path].add(target)
    pending = list(reached)
    while pending:
        path = pending.pop()
        for target in edges[path]:
            added = reached[path] - reached[target]
            if added:
                reached[target].update(added); pending.append(target)
    return required, reached


def scope_trees(before, after):
    old_required, old = readers(before)
    required, new = readers(after)
    require(set(old_required) == set(required), 'step inventory changed; full run required')
    changed = sorted(p for p in set(before) | set(after) if before.get(p) != after.get(p))
    require(bool(changed), 'no changed inputs')
    all_steps = any(p in SCOPE_AUTHORITY or p.startswith('.github/') for p in changed)
    affected, coverage = set(MANDATORY), {}
    for path in changed:
        require(bool(old[path] | new[path]), 'changed input has unknown readers: ' + path)
    for step in required:
        inputs = sorted(p for p in set(before) | set(after) if step in old[p] | new[p])
        touched = sorted(set(inputs) & set(changed))
        if all_steps:
            touched = sorted(set(touched) | {p for p in changed if p in SCOPE_AUTHORITY or p.startswith('.github/')})
        if touched:
            affected.add(step)
        coverage[step] = {'changed_inputs': touched, 'inputs_sha256': digest(canonical({
            p: [digest(before[p]) if p in before else None, digest(after[p]) if p in after else None] for p in inputs}))}
    return {'version': 2, 'changed': changed, 'steps': [s for s in required if s in affected],
            'not_run': [s for s in required if s not in affected], 'required': required, 'coverage': coverage}


def compute(root, base, head):
    result = scope_trees(source_files(root, base), source_files(root, head))
    # Include mode-only changes even when bytes match; they cannot authorize an
    # omission. Names come from Git, never the producer's supplied path list.
    names = git(root, 'diff', '--no-ext-diff', '--no-textconv', '--no-renames', '--name-only', '-z', base, head).decode().split('\0')
    require(set(filter(None, names)) == set(result['changed']), 'mode-only or unsupported changed input')
    result.update(live=base, source=head, tree=git(root, 'rev-parse', head + '^{tree}').decode().strip())
    return result


def pr_record(root, base, head):
    record = compute(root, base, head)
    record['selected'] = record['steps']
    record['steps'] = [s for s in record['selected'] if s.startswith('native-')]
    record['why'] = 'Complete committed input coverage; omitted steps have no changed inputs'
    return record

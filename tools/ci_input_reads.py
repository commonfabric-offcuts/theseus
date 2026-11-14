from __future__ import annotations

"""Conservative repository-input discovery; never imports or executes test code.

All test data is frozen. Literal references in read-bearing modules also pull
non-product repository files into the plan. Opaque filesystem expressions need
an explicit, reviewed declaration; new expressions fail with an author-facing
message rather than silently extending the old read boundary.
"""
import ast
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
    elif path.endswith('.mjs'):
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
        if not path.startswith('tests/') or not path.endswith(('.py', '.mjs')):
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
            frozen |= set(inputs) - {AUTHORITY}
    return frozenset(frozen), errors

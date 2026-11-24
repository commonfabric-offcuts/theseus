"""cause_compare.py CARRY_TAP LIVE_TAP
For every test failing on both trees, compare the cause of its failure, normalized, and name any that changed.
A test that fails on live for one reason and on the carry for another passes a comparison of names alone.

The cause is the failure's type, code, error name and message. Paths, line and column positions, durations,
timestamps, a quoted file's line number, long hex identifiers and the worktree's own name are removed; the stack is
not part of it.
Exit 0: every shared failure has the same cause. Exit 4: a cause changed (listed, with both). Exit 2: unreadable.
"""
import re
import sys

NOT_OK = re.compile(r'^(\s*)not ok \d+ - (.*?)\s*$')
FIELD = re.compile(r'^\s*(failureType|code|name): (.*)$')


def blocks(path):
    """Each failing case's name and its YAML diagnostic lines, as node's TAP reporter writes them."""
    lines = open(path, encoding='utf-8', errors='replace').read().split('\n')
    out = {}
    for index, line in enumerate(lines):
        match = NOT_OK.match(line)
        if not match:
            continue
        indent, name, body = len(match.group(1)), match.group(2), []
        for following in lines[index + 1:]:
            if following.strip() == '...' and len(following) - len(following.lstrip()) == indent + 2:
                break
            if NOT_OK.match(following) or re.match(r'^\s*ok \d+ - ', following):
                break
            body.append(following)
        out.setdefault(name, []).append(body)
    return out


def normalize(text):
    text = re.sub(r'file://\S+|/(?:Users|private|tmp|var)/\S+', '<path>', text)
    text = re.sub(r'warp-land-\d+|aim-worktrees/\S+', '<tree>', text)
    text = re.sub(r':\d+:\d+', '', text)
    # A source-reading test quotes file:line, and the line moves whenever the change edits that file.
    text = re.sub(r'(\.(?:mjs|js|py|css|html|md|json)):\d+\b', r'\1:<line>', text)
    text = re.sub(r'\d{4}-\d\d-\d\dT[\d:.]+(?:Z|[+-]\d\d:?\d\d)?', '<time>', text)
    text = re.sub(r'\b\d+\.\d+\s*(?:ms|s)\b|\b\d+\s*ms\b', '<duration>', text)
    text = re.sub(r'\b[0-9a-f]{8,}\b', '<hex>', text)
    return re.sub(r'\s+', ' ', text).strip()


def cause(body):
    fields, error, in_error = {}, [], False
    for line in body:
        stripped = line.strip()
        if re.match(r'^\s*error: ', line):
            in_error = True
            rest = stripped[len('error: '):]
            if rest not in ('|-', '|', '>-', '>'):
                error.append(rest)
            continue
        if in_error:
            if re.match(r'^\s*[a-zA-Z_]+: ', line) and len(line) - len(line.lstrip()) <= 2:
                in_error = False
            else:
                error.append(stripped)
                continue
        match = FIELD.match(line)
        if match and len(line) - len(line.lstrip()) <= 2:
            fields[match.group(1)] = match.group(2)
    return normalize(' | '.join([fields.get('failureType', ''), fields.get('code', ''), fields.get('name', ''), ' '.join(error)]))


def main(carry_path, live_path):
    try:
        carry, live = blocks(carry_path), blocks(live_path)
    except OSError as error:
        print('cannot read the TAP: %s' % error)
        return 2
    changed = []
    for name in sorted(set(carry) & set(live)):
        before = sorted(cause(b) for b in live[name])
        after = sorted(cause(b) for b in carry[name])
        if before != after:
            changed.append((name, before, after))
    shared = len(set(carry) & set(live))
    if changed:
        print('CHANGED CAUSE on the carry for %d of %d failures shared with live:' % (len(changed), shared))
        for name, before, after in changed:
            print('- %s\n  live:  %s\n  carry: %s' % (name, ' || '.join(before)[:600], ' || '.join(after)[:600]))
        return 4
    print('same cause for all %d failures shared with live' % shared)
    return 0


if __name__ == '__main__':
    sys.exit(main(*sys.argv[1:3]))

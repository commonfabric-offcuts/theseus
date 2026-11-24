#!/usr/bin/python3 -I
"""dossier_evidence.py ITEM DOSSIER ATTEMPT_DIR

The Evidence paragraph of an ordinary (page-only) landing, written from that landing's own receipts in ATTEMPT_DIR,
never kept from a draft: node-suite.out (node-suite-check.sh: each side's counts and its no-new-failure verdict, which
compares failing names), land.out (the deploy's 06-migrate record, read by migrate_record.py: a recognized no-step
shape only) and the approval of exactly the piece and head this landing's SPEC.json names (the folder holding
attempts/ATTEMPT_DIR), whose proof is the lane's, read in Review, and is named as that, not restated. Another piece's
approval, or one given before that head was frozen, is not this landing's.
The paragraph runs from the line starting "Evidence:" to the next blank line. Anything it cannot read refuses with
exit 2 and leaves the dossier unchanged; the draft's "Evidence: EVIDENCE_TO_FILL" then makes post-dossier.sh refuse."""
import json, re, subprocess, sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import config, decisions, migrate_record  # noqa: E402

item, dossier, attempt = sys.argv[1], Path(sys.argv[2]), Path(sys.argv[3])
AN = config.cli()


def refuse(why):
    print('REFUSED: %s' % why); sys.exit(2)


suite = (attempt / 'node-suite.out').read_text() if (attempt / 'node-suite.out').exists() else ''
side = {k: re.search(r'^%s: tests (\d+) pass (\d+) fail (\d+)' % k, suite, re.M) for k in ('carry', 'live')}
if not (side['carry'] and side['live'] and re.search(r'^no new node failure', suite, re.M)):
    refuse('node-suite.out lacks both sides or its no-new-failure verdict')
if (attempt / 'node-suite.exit').read_text().strip() != '0':
    refuse('node-suite.exit is not 0')
land = (attempt / 'land.out').read_text() if (attempt / 'land.out').exists() else ''
if not re.search(r'^DEPLOY EXIT0', land, re.M):
    refuse('land.out lacks DEPLOY EXIT0')
schema = migrate_record.read(land)
if schema is None:
    refuse('land.out has no single recognized 06-migrate record')
if schema[0] != schema[1]:
    refuse('an ordinary landing reports a database step')
if attempt.resolve().parent.name != 'attempts':
    refuse('%s is not an attempt inside a landing folder' % attempt)
spec = json.loads((attempt.resolve().parent.parent / 'SPEC.json').read_text())
if not (isinstance(spec.get('piece'), str) and isinstance(spec.get('approved_head'), str) and spec.get('items') == [int(item)]):
    refuse('SPEC.json does not name this item alone with its piece and approved head')
out = subprocess.run(AN + ['item', config.get('workspace'), item, '--json'], capture_output=True, text=True)
if out.returncode != 0 or not out.stdout.strip():
    refuse('item %s unreadable' % item)
record = json.loads(out.stdout.splitlines()[0]); record = record.get('item') or record
# The approval sits on the build piece (kind 'piece') this landing carries, given after its current freeze of the head
# the landing merges; the release piece carries none.
mine = [p for p in (record.get('pieces') or []) if p.get('id') == spec['piece']]
if len(mine) != 1 or mine[0].get('kind') != 'piece':
    refuse('item %s has no build piece %s' % (item, spec['piece']))


def board_read(read):
    """The message SPEC.json carry_read names, read back from the board, or None when it is not there."""
    if not (isinstance(read, dict) and isinstance(read.get('seq'), int) and read.get('topic') and read.get('id')):
        refuse('SPEC.json carry_read must name the topic, seq and id of fable\'s read of the carry')
    got = subprocess.run(AN + ['--json', 'read', read['topic'], '--after', str(read['seq'] - 1), '--limit', '1'],
                         capture_output=True, text=True)
    rows = [json.loads(x) for x in got.stdout.split('\n')[1:] if x.strip()]
    return next((m for r in rows for m in r.get('items') or [] if m.get('id') == read['id']), None) if got.returncode == 0 else None


frozen = (mine[0].get('freeze') or {}).get('head_commit')
try:
    proof = decisions.proof(spec, mine[0], board_read(spec['carry_read']) if 'carry_read' in spec and not frozen else None)
except ValueError as error:
    refuse(str(error))

c, l = (tuple(int(x) for x in side[k].groups()) for k in ('carry', 'live'))
parts = [proof,
         'the whole node suite on the carry: %d passes and %d failures, against %d and %d on live, with no new failing name'
         % (c[1], c[2], l[1], l[2])]
same = re.search(r'^same cause for all (\d+) failures shared with live', suite, re.M)
if same:
    parts.append('each of the %s failures it shares with live fails for the same cause' % same.group(1))
parts.append('no database step (schema %s)' % schema[1])
line = 'Evidence: ' + '; '.join(parts) + '.'
lines = dossier.read_text().split('\n')
start = next((i for i, x in enumerate(lines) if x.startswith('Evidence:')), None)
if start is None:
    refuse('the dossier has no Evidence: line')
end = start + 1
while end < len(lines) and lines[end].strip():
    end += 1
dossier.write_text('\n'.join(lines[:start] + [line] + lines[end:]))
print(line)

#!/usr/bin/python3 -I
"""dossier_evidence.py ITEM DOSSIER ATTEMPT_DIR

The Evidence paragraph uses the landing attempt's Node comparison, deployment output and exact Core approval.
A judged landing also supplies its train and audit. A judged migration requires the verified pre-merge backup
and successful rehearsal of the same schema step on that copy.
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


def receipt(path):
    try:
        data = json.loads(path.read_text())
    except (OSError, ValueError):
        refuse('%s is missing or unreadable' % path.name)
    if not isinstance(data, dict):
        refuse('%s does not contain a receipt object' % path.name)
    return data


def successful_release(folder, release, merge, spec, train):
    """Bind the train and its audit to the release actually recorded by the deploy."""
    deployed = receipt(folder / 'deploy' / '11-release.json')
    try:
        record, = [row for row in deployed['records'] if row['release'] == release]
        write, = [row for row in deployed['writes'] if row['release'] == release]
        answer = json.loads(write['stdout'])
        records = (record, answer['release'])
        valid = (
            type(write['exit']) is int and write['exit'] == 0 and answer['ok'] is True
            and all(row['release'] == release and row['commit'] == merge and row['previous'] == spec['base']
                    and row['items'] == spec['items'] for row in records)
            and all(all(row['measurements']['train'][key] == value for key, value in train.items()) for row in records)
        )
    except (AttributeError, KeyError, TypeError, ValueError):
        valid = False
    if not valid:
        refuse('11-release.json does not record this judged deploy and train')


def judged_evidence(attempt, folder, spec, land, schema):
    """Describe the exact train and the successful attempt's migration receipts."""
    merges = re.findall(r'^DEPLOY EXIT0 ([0-9a-f]{40})$', land, re.M)
    end = receipt(folder / 'DEPLOY-END.json')
    exit_record = attempt / 'land.exit'
    release = spec.get('release')
    if (not exit_record.is_file() or exit_record.read_text().strip() != '0' or merges != [end.get('merge')]
            or type(end.get('exit')) is not int or end['exit'] != 0 or type(release) is not int or end.get('release') != release):
        refuse('the successful deploy receipt does not name this judged release')
    train = receipt(folder / 'TRAIN.json')
    judgment = spec.get('judgment')
    if (train.get('kind') != 'judged-first' or train.get('merge_commit') != merges[0]
            or train.get('merged_tree') != spec.get('tree') or train.get('pr') != spec.get('pr')
            or train.get('items') != [{'item': spec['items'][0], 'approved_head': spec.get('source'), 'review': spec.get('review')}]
            or not isinstance(judgment, dict) or judgment.get('version') != 1131 or train.get('judgment') != judgment):
        refuse('TRAIN.json does not bind the exact judged release and carry')
    audit = judgment.get('audit')
    if (not isinstance(audit, dict) or not re.fullmatch('m-[0-9a-f]{32}', str(audit.get('message')))
            or type(audit.get('revision')) is not int or audit['revision'] < 1):
        refuse('the judged release lacks its audit message and revision')
    carry = judgment.get('carry')
    if not isinstance(carry, dict) or any(carry.get(key) != spec.get(field)
                                         for key, field in (('base', 'base'), ('head', 'source'), ('tree', 'tree'))):
        refuse('the judged release evidence names another carry')
    successful_release(folder, release, merges[0], spec, train)
    migration = receipt(folder / 'deploy' / '06-migrate.json')
    if migrate_record.read('06-migrate ' + json.dumps(migration)) != schema:
        refuse('06-migrate.json does not match the attempt schema record')
    parts = ['independent audit %s revision %s' % (audit['message'], audit['revision'])]
    if schema[0] == schema[1]:
        return parts + ['no database step (schema %s)' % schema[1]]

    backup = receipt(folder / 'PRE-MERGE-BACKUP.json')
    verified = receipt(folder / 'BACKUP-VERIFIED.json')
    bundle = verified.get('bundle_path')
    if (verified.get('verified') is not True or not isinstance(bundle, str) or not Path(bundle).is_absolute()
            or bundle != backup.get('bundle_path')
            or not re.fullmatch('[0-9a-f]{64}', str(verified.get('bundle_digest')))
            or verified['bundle_digest'] != backup.get('bundle_digest')):
        refuse('BACKUP-VERIFIED.json does not verify the pre-merge backup')
    rehearsal = receipt(folder / 'REHEARSAL.json')
    try:
        answer = json.loads(rehearsal['stdout'])
        path = Path(answer['result']).resolve()
        path.relative_to((folder / 'realdata').resolve())
        result = receipt(path)
        row = result['versions']['rehearse']
        valid = (
            type(rehearsal['exit']) is int and rehearsal['exit'] == 0 and answer['ok'] is True and result['backup'] == bundle
            and result['backup_identity']['manifest_sha256'] == verified['bundle_digest']
            and row['passed'] is True and row['head'] == spec['source'] and row['tree'] == spec['tree']
            and (row['before']['schema_version'], row['after']['schema_version']) == schema
        )
    except (KeyError, TypeError, ValueError):
        valid = False
    if not valid:
        refuse('the rehearsal does not establish this carry and schema on the verified backup')
    parts.append('verified pre-merge backup %s in BACKUP-VERIFIED.json and rehearsed schema %s → %s on its copy'
                 % (Path(bundle).name, *schema))
    parts.append('Live migrated from schema %s to %s' % schema)
    return parts


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
if attempt.resolve().parent.name != 'attempts':
    refuse('%s is not an attempt inside a landing folder' % attempt)
folder = attempt.resolve().parent.parent
spec = receipt(folder / 'SPEC.json')
if not (isinstance(spec.get('piece'), str) and isinstance(spec.get('approved_head'), str) and spec.get('items') == [int(item)]):
    refuse('SPEC.json does not name this item alone with its piece and approved head')
kind = spec.get('kind', 'ordinary')
if kind == 'judged-first':
    deploy_evidence = judged_evidence(attempt, folder, spec, land, schema)
elif kind == 'ordinary' and schema[0] == schema[1]:
    deploy_evidence = ['no database step (schema %s)' % schema[1]]
elif kind == 'ordinary':
    refuse('an ordinary landing reports a database step')
else:
    refuse('unrecognized landing kind')
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
    if got.returncode != 0:
        return None
    return decisions.message_from_read([json.loads(x) for x in got.stdout.split('\n') if x.strip()], read['id'])


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
ran = re.search(r'^every case that passed on live runs on the carry \((\d+) cases, (\d+) stopped with a named reason\)', suite, re.M)
if not ran:
    refuse('node-suite.out has no execution comparison line')
parts.append('every one of the %s cases that passed on live runs on the carry' % ran.group(1) if ran.group(2) == '0' else
             '%d of the %s cases that passed on live run on the carry, and %s stop for the reasons SPEC.json names'
             % (int(ran.group(1)) - int(ran.group(2)), ran.group(1), ran.group(2)))
parts.extend(deploy_evidence)
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

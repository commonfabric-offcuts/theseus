#!/usr/bin/python3 -I
"""drop_premerge_backup.py LANDING_FOLDER [--check]

After a landing whose deploy released its merge, deletes the landing's own pre-merge bundle (BACKUP-VERIFIED.json),
which the deploy's own backup, taken about a minute later, supersedes: each landing deletes its pre-merge backup once
the deploy's backup has verified. The deploy's bundle (deploy/04-backup.json) is first
verified with backup.inspect from the code that wrote it (the merge's first parent, the release that was live, exported
by git archive into a scratch folder, since inspect requires the bundle's schema to be its own) against the digest the
deploy printed; that read never writes.
Anything unexpected refuses with exit 2 and deletes nothing. --check verifies and prints the plan without deleting.
Writes PREMERGE-DROPPED.json in the folder, created exclusively, and keeps the bundle's manifest.json there as
PREMERGE-MANIFEST.json."""
import datetime, hashlib, json, os, re, shutil, subprocess, sys, tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import config  # noqa: E402

F = Path(sys.argv[1]).resolve(); CHECK = '--check' in sys.argv
B = str(Path(config.get('instance')) / 'backups'); LIVE = config.get('live')


def refuse(why):
    print(json.dumps({'refused': why, 'folder': str(F)})); sys.exit(2)


merge = json.loads((F / 'TRAIN.json').read_text())['merge_commit']
# The deploy that shipped the merge is the one whose records reach the release branch step: a rerun of the same merge
# (deploy-resume/) after a refused first attempt, otherwise the landing's own (deploy/).
shipped = [d for d in (F / 'deploy-resume', F / 'deploy') if (d / '12-release-branch.json').exists()]
if not shipped:
    refuse('no deploy of this landing reached its release branch step')
D = shipped[0]
released = json.loads((D / '11-release.json').read_text())['records']
if not (json.loads((D / '12-release-branch.json').read_text()).get('success') and [r['commit'] for r in released] == [merge]):
    refuse('the deploy did not release this merge')
record = json.loads((D / '04-backup.json').read_text())
printed = json.loads(record['stdout'])
if record.get('exit') != 0 or printed['bundle_path'] != record['path']:
    refuse('the deploy backup step did not complete')
deploy_path, deploy_digest = printed['bundle_path'], printed['bundle_digest']
parent = subprocess.run(['git', '-C', LIVE, 'rev-parse', merge + '^1'],
                        capture_output=True, text=True, check=True).stdout.strip()
code = Path(tempfile.mkdtemp(prefix='drop-premerge-', dir=config.get('scratch')))
try:
    archive = subprocess.run(['git', '-C', LIVE, 'archive', parent, 'aim_next'], capture_output=True, check=True).stdout
    subprocess.run(['tar', '-x', '-C', str(code)], input=archive, check=True)
    sys.path.insert(0, str(code))
    sys.dont_write_bytecode = True
    from aim_next import backup  # noqa: E402
    assert Path(backup.__file__).resolve().is_relative_to(code.resolve()), backup.__file__
    manifest = backup.inspect(deploy_path, expected_digest=deploy_digest)
finally:
    shutil.rmtree(code)
pre = json.loads((F / 'BACKUP-VERIFIED.json').read_text())['bundle_path']
rx = re.compile(r'^pre-merge-.+-(\d{8}T\d{6})$'); dx = re.compile(r'^pre-deploy-(\d{8}T\d{6})$')
pm, dm = rx.match(os.path.basename(pre)), dx.match(os.path.basename(deploy_path))
if not (pm and dm and os.path.dirname(pre) == B and os.path.dirname(deploy_path) == B and pre != deploy_path):
    refuse('unexpected bundle names or folders')
if not (os.path.isdir(pre) and not os.path.islink(pre)):
    refuse('the pre-merge bundle is not a plain folder (already dropped?)')
if not dm.group(1) > pm.group(1):
    refuse('the deploy backup is not later than the pre-merge one')
plan = {'at': datetime.datetime.now().astimezone().isoformat(), 'release': released[0]['release'], 'merge': merge,
        'deploy_records': D.name, 'deploy_bundle': deploy_path, 'deploy_digest': deploy_digest, 'deploy_inspected_with': parent,
        'deploy_media_rows': len(manifest['media']), 'dropped': pre, 'check_only': CHECK}
if CHECK:
    print(json.dumps(plan)); sys.exit(0)
fd = os.open(str(F / 'PREMERGE-DROPPED.json'), os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
# The bundle's manifest (its database hash and every media row's size and sha256) stays in the folder, so the record
# of what was dropped can be checked against the digest BACKUP-VERIFIED.json names after the bundle is gone.
kept = F / 'PREMERGE-MANIFEST.json'
shutil.copyfile(os.path.join(pre, 'manifest.json'), str(kept))
plan['manifest_kept'] = str(kept)
plan['manifest_sha256'] = hashlib.sha256(kept.read_bytes()).hexdigest()
# A cloned bundle shares its media blocks with the live media, so deleting it frees only what it held alone.
volume = os.statvfs(B); plan['free_bytes_before_drop'] = volume.f_bavail * volume.f_frsize
shutil.rmtree(pre)
plan['dropped_absent'] = not os.path.exists(pre)
volume = os.statvfs(B); plan['free_bytes_after_drop'] = volume.f_bavail * volume.f_frsize
with os.fdopen(fd, 'w') as out:
    out.write(json.dumps(plan, indent=1) + '\n')
print(json.dumps(plan))

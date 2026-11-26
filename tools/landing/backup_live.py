"""backup_live.py FOLDER: the verified backup of the live store a landing takes before it merges anything.

Refuses unless live is at the folder's SPEC base and the release record's last release is the one before this landing.
Writes PRE-MERGE-BACKUP.json, BACKUP-SPACE.json and, last, BACKUP-VERIFIED.json into FOLDER."""
from pathlib import Path
import sys, json, datetime, sqlite3, subprocess, os
sys.path.insert(0, str(Path(__file__).resolve().parent))
import config  # noqa: E402
OUT = Path(sys.argv[1]).resolve()
SETTINGS = config.load()
LIVE = SETTINGS['live']
sys.path.insert(0, LIVE)
from aim_next.profile import load_profile  # noqa: E402
from aim_next.backup import backup, inspect  # noqa: E402
deploy_config = json.loads((Path(SETTINGS['coordinator']) / 'deploy-trains.json').read_text())
instance = Path(deploy_config['instance'])
profile = load_profile(instance / deploy_config['server_profile'])
assert not (OUT / 'BACKUP-VERIFIED.json').exists()
SPEC = json.loads((OUT / 'SPEC.json').read_text()); BASE = SPEC['base']; PREV = SPEC['release'] - 1; ITEM = str(SPEC['items'][0])
assert subprocess.check_output(['git', '-C', LIVE, 'rev-parse', 'HEAD'], text=True).strip() == BASE
with sqlite3.connect('file:%s?mode=ro' % (Path(SETTINGS['instance']) / 'data.sqlite3'), uri=True) as db:
    assert db.execute('SELECT number,commit_sha FROM releases ORDER BY number DESC LIMIT 1').fetchone() == (PREV, BASE)
backups = instance / 'backups'
backups.mkdir(mode=0o700, exist_ok=True)
destination = str(backups / ('pre-merge-' + ITEM + '-' + datetime.datetime.now().strftime('%Y%m%dT%H%M%S')))


def free():
    s = os.statvfs(str(backups)); return s.f_bavail * s.f_frsize, datetime.datetime.now().astimezone().isoformat()


# The bundle's cost on disk is the volume's free space read just before and just after the write: a clone shares its
# blocks with the live media, so no per-file size shows it. Other writers on the volume add to the difference.
before = free()
result = backup(profile.db_path, profile.instance_id, expected_binding=profile.binding, bundle_path=destination)
after = free()
(OUT / 'PRE-MERGE-BACKUP.json').write_text(json.dumps(result, indent=2) + '\n')
manifest = inspect(result['bundle_path'], expected_digest=result['bundle_digest'])
database = os.stat(Path(result['bundle_path']) / 'data.sqlite3')
(OUT / 'BACKUP-SPACE.json').write_text(json.dumps({'bundle_path': result['bundle_path'], 'written_by_head': BASE,
    'free_bytes_before': before[0], 'read_before': before[1], 'free_bytes_after': after[0], 'read_after': after[1],
    'free_bytes_used': before[0] - after[0], 'database_bytes': database.st_size, 'database_allocated_bytes': database.st_blocks * 512,
    'media_files': len(manifest['media']), 'media_bytes': sum(row['size'] for row in manifest['media'])}, indent=2) + '\n')
result = {'verified': True, 'bundle_path': result['bundle_path'], 'bundle_digest': result['bundle_digest'], 'at': datetime.datetime.now().astimezone().isoformat()}
(OUT / 'BACKUP-VERIFIED.json').write_text(json.dumps(result, indent=2) + '\n')
print(json.dumps(result))

#!/usr/bin/python3 -I
"""realdata_proof.py BACKUP_DIR OUT_DIR --rehearse WORKTREE

The landing's rehearsal of its schema step and its new code's first reads, on a disposable copy of the verified
backup just taken, never on the live store: one copy, one upgrade through the public aim_next.migrations.migrate with
WORKTREE's code, then that code's first reads and a server start on the copy. Exit 0 only when it migrated (or found
the copy already at its version), left no broken reference that was not there before, kept every compared row, and
integrity_check reads ok.

A copy is bound to its own scratch authority before it is migrated: the backup's metadata names the live store's
authority, which a copy at another path cannot hold. That rebinding (three metadata rows) is the only change made to a
copy before its migration, and both bindings are recorded. Every copy and scratch authority is deleted at the end,
and the deletion is read back. The migration runs in its own process with WORKTREE's code on its path."""
import hashlib, json, os, shutil, sqlite3, subprocess, sys, time, traceback
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import config  # noqa: E402

if len(sys.argv) != 5 or sys.argv[3] != '--rehearse':
    raise SystemExit('usage: realdata_proof.py BACKUP_DIR OUT_DIR --rehearse WORKTREE')
BACKUP, OUT, REHEARSE = Path(sys.argv[1]), Path(sys.argv[2]), Path(sys.argv[4])
SCRATCH = Path(config.get('scratch')) / ('realdata-%d' % int(time.time()))
# The board's own landing seat reads the rehearsed copy; a board without a 'warp' actor has no binding for it.
ACTOR = config.get('seat') or 'warp'
# The topic whose newest root the stack read checks; unset, the newest root anywhere on the copy.
TOPIC = config.get('rehearsal_topic')


def exclusive(path, data, mode=0o600):
    """Creates the file or fails: no attempt's output is ever replaced, by a later attempt or by its own run."""
    fd = os.open(str(path), os.O_WRONLY | os.O_CREAT | os.O_EXCL, mode)
    with os.fdopen(fd, 'wb') as stream:
        stream.write(data)


# Every attempt writes to a directory of its own, made here; one that exists already refuses before anything runs.
try:
    OUT.mkdir(parents=True, exist_ok=False)
except FileExistsError:
    print(json.dumps({'ok': False, 'refused': 'the attempt directory %s exists; each attempt writes to a new one' % OUT}))
    sys.exit(2)
(OUT / 'runs').mkdir()
SELF = Path(__file__).read_bytes()
# Each result keeps the exact helper bytes that produced it, beside it.
exclusive(OUT / 'helper.py', SELF, 0o644)
RESULT = {'started_at_ms': int(time.time() * 1000), 'backup': str(BACKUP), 'scratch': str(SCRATCH),
          'script_sha256': hashlib.sha256(SELF).hexdigest(), 'helper': str(OUT / 'helper.py'), 'versions': {}}
# Each compared table with the order its rows are read in. A step that rebuilds a table (1060's memory_revisions:
# rename, copy every row, drop) may give the rows new rowids, so that table is read in its primary key's order.
TABLES = (('message_acts', 'rowid'), ('refresh_requests', 'rowid'), ('deliveries', 'rowid'),
          ('memory_items', 'rowid'), ('memory_revisions', 'item_id, revision'))


def sha_file(path):
    digest = hashlib.sha256()
    with open(path, 'rb') as stream:
        for block in iter(lambda: stream.read(1 << 20), b''):
            digest.update(block)
    return digest.hexdigest()


def git(wt, *args):
    return subprocess.run(['git', '-C', str(wt), *args], capture_output=True, text=True, check=True).stdout.strip()


def save(final=False):
    """Progress goes to RESULT.progress.json, which only this run writes; RESULT.json is written once, at the end."""
    raw = (json.dumps(RESULT, indent=1, sort_keys=True) + '\n').encode('utf-8')
    if final:
        exclusive(OUT / 'RESULT.json', raw, 0o644)
    else:
        (OUT / 'RESULT.progress.json').write_bytes(raw)


def pyc_count(root):
    return sum(1 for _ in Path(root).rglob('*.pyc'))


def snapshot(db_path, integrity=False, columns=None):
    """columns, a previous snapshot's 'columns', limits each table's row digest to the columns it had then, so a schema
    step that adds a column compares the rows it found; each added column is reported with its count of non-null
    values, which a step must leave at zero on rows it did not write."""
    db = sqlite3.connect('file:%s?mode=ro' % db_path, uri=True)
    try:
        meta = dict(db.execute("SELECT key,value FROM metadata WHERE key IN ('schema_version','commit_seq')"))
        rows, shape = {}, {}
        for table, order in TABLES:
            names = [r[1] for r in db.execute('PRAGMA table_info("%s")' % table)]
            kept = columns[table]['columns'] if columns else names
            digest, count = hashlib.sha256(), 0
            for row in db.execute('SELECT %s FROM "%s" ORDER BY %s' % (', '.join('"%s"' % c for c in kept), table, order)):
                digest.update(repr(row).encode('utf-8'))
                count += 1
            rows[table] = {'count': count, 'sha256': digest.hexdigest()}
            shape[table] = {'columns': names, 'added': {c: db.execute('SELECT COUNT(*) FROM "%s" WHERE "%s" IS NOT NULL' % (table, c)).fetchone()[0]
                                                        for c in names if c not in kept}}
        broken = db.execute('PRAGMA foreign_key_check').fetchall()
        value = {'schema_version': meta.get('schema_version'), 'commit_seq': meta.get('commit_seq'), 'rows': rows,
                 'acts_sequence': db.execute("SELECT COALESCE((SELECT seq FROM sqlite_sequence WHERE name='message_acts'), 0)").fetchone()[0],
                 'acts_table_sql_sha256': hashlib.sha256(db.execute(
                     "SELECT sql FROM sqlite_master WHERE name='message_acts'").fetchone()[0].encode()).hexdigest(),
                 'broken_references': len(broken), 'broken_sample': [list(r) for r in broken[:5]], 'columns': shape}
        if integrity:
            value['integrity_check'] = db.execute('PRAGMA integrity_check').fetchone()[0]
        return value
    finally:
        db.close()


# One process per migration, run with the version's own code; it prints one JSON line: the result, or the refusal
# with its code, retryable flag and the raw exception chain underneath it.
CHILD = r'''
import json, sys, traceback
from aim_next import migrations
db, instance, binding, target = sys.argv[1], sys.argv[2], json.loads(sys.argv[3]), (sys.argv[4] or None)
try:
    print(json.dumps({'ok': True, 'result': migrations.migrate(db, instance, binding, target)}))
except migrations.MigrationError as error:
    chain, cause = [], error.__cause__
    while cause is not None:
        chain.append({'type': type(cause).__module__ + '.' + type(cause).__name__, 'message': str(cause)})
        cause = cause.__cause__
    print(json.dumps({'ok': False, 'code': error.code, 'message': str(error), 'retryable': getattr(error, 'retryable', None),
                      'cause_chain': chain, 'traceback': traceback.format_exc()}))
'''

REBIND = r'''
import json, sqlite3, sys
from aim_next.authority import prepare_authority, publish_initial
db, instance, anchor = sys.argv[1], sys.argv[2], sys.argv[3]
binding, record = prepare_authority(anchor, db, instance)
publish_initial(binding, record)
with sqlite3.connect(db) as conn:
    before = dict(conn.execute("SELECT key,value FROM metadata WHERE key IN ('authority_path','authority_id','authority_epoch')"))
    for key, value in (('authority_path', binding['authority_path']), ('authority_id', binding['authority_id']),
                       ('authority_epoch', binding['authority_epoch'])):
        assert conn.execute('UPDATE metadata SET value=? WHERE key=?', (value, key)).rowcount == 1, key
print(json.dumps({'binding': binding, 'replaced': before}))
'''


READ = r'''
import json, sqlite3, sys
from aim_next.store import Store
db, instance, binding, actor, topic = sys.argv[1], sys.argv[2], json.loads(sys.argv[3]), sys.argv[4], sys.argv[5]
store = Store(db, instance, expected_binding=binding)
deliveries = store.view(actor, 'deliveries', {'limit': 50})
# The newest root in the chosen topic (or anywhere, when none is chosen) that this copy holds, whatever the backup's moment.
with sqlite3.connect('file:%s?mode=ro' % db, uri=True) as conn:
    if topic:
        row = conn.execute('SELECT id, topic_id FROM messages WHERE topic_id=? AND reply_to IS NULL ORDER BY rowid DESC LIMIT 1', (topic,)).fetchone()
    else:
        row = conn.execute('SELECT id, topic_id FROM messages WHERE reply_to IS NULL ORDER BY rowid DESC LIMIT 1').fetchone()
    root, topic = row
stack = store.view(actor, 'stack_positions', {'topic_id': topic, 'message_ids': [root]})
position = (stack.get('items') or [{}])[0].get('stack_position') or {}
print(json.dumps({'deliveries_ok': 'error' not in deliveries, 'deliveries_read': len(deliveries.get('items') or []),
                  'request_deliveries_read': sum(1 for item in deliveries.get('items') or [] if item.get('request')),
                  'stack_root': root, 'stack_error': (stack.get('error') or {}).get('code'),
                  'stack_ok': 'error' not in stack and 'level' in position, 'stack_keys': sorted(position)}))
'''


def child(wt, home, code, argv, tag):
    env = {'PATH': '/usr/bin:/bin:/usr/sbin:/sbin', 'HOME': str(home / 'home'), 'TMPDIR': str(home / 'tmp'),
           'PYTHONPATH': str(wt)}
    started = int(time.time() * 1000)
    # The cache location is named on the command line: -I would ignore PYTHONPYCACHEPREFIX, and -B only stops writes.
    head = ['/usr/bin/python3', '-B', '-X', 'pycache_prefix=' + str(home / 'pyc'), '-c']
    r = subprocess.run([*head, code, *argv], capture_output=True, text=True, env=env, cwd=str(home))
    exclusive(OUT / 'runs' / (tag + '.stdout'), r.stdout.encode())
    exclusive(OUT / 'runs' / (tag + '.stderr'), r.stderr.encode())
    record = {'tag': tag, 'worktree': str(wt), 'argv_head': head, 'code_sha256': hashlib.sha256(code.encode()).hexdigest(),
              'argv_tail': argv, 'exit': r.returncode, 'started_at_ms': started,
              'ended_at_ms': int(time.time() * 1000),
              'stdout': {'path': str(OUT / 'runs' / (tag + '.stdout')), 'sha256': hashlib.sha256(r.stdout.encode()).hexdigest()},
              'stderr': {'path': str(OUT / 'runs' / (tag + '.stderr')), 'sha256': hashlib.sha256(r.stderr.encode()).hexdigest()}}
    lines = [line for line in r.stdout.splitlines() if line.startswith('{')]
    record['answer'] = json.loads(lines[-1]) if r.returncode == 0 and lines else None
    return record


def serve(wt, home, copy, instance, binding):
    """The candidate's own server process on the upgraded copy, as 07-server and 10-verify meet it: started on a
    loopback port the OS picks, its ready line awaited, / and /api/bootstrap read, then stopped with SIGTERM. The
    server makes no outbound call. It runs as the configured seat through a profile bound to the copy's scratch authority."""
    import select, signal, urllib.error, urllib.request
    profile = home / 'serve-profile.json'
    fd = os.open(str(profile), os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(fd, 'w') as stream:
        json.dump({'v': 2, 'instance_id': instance, 'actor_id': ACTOR, 'db_path': str(copy),
                   'authority_path': binding['authority_path'], 'authority_id': binding['authority_id'],
                   'authority_epoch': binding['authority_epoch']}, stream)
    env = {'PATH': '/usr/bin:/bin:/usr/sbin:/sbin', 'HOME': str(home / 'home'), 'TMPDIR': str(home / 'tmp')}
    python = ['/usr/bin/python3', '-I', '-B', '-X', 'pycache_prefix=' + str(home / 'pyc')]
    server_argv = [*python, str(wt / 'bin' / 'aim-next-server'), '--profile', str(profile), '--port', '0']
    cli_argv = [*python, str(wt / 'bin' / 'aim-next'), '--profile', str(profile), 'binding']
    result = {'server_argv': server_argv, 'cli_argv': cli_argv, 'worktree_pyc_before': pyc_count(wt), 'ready': False}
    started = time.time()
    proc = subprocess.Popen(server_argv, stdout=subprocess.PIPE, stderr=subprocess.PIPE, env=env, cwd=str(home))
    result['pid'] = proc.pid
    try:
        ready, _, _ = select.select([proc.stdout], [], [], 120)
        raw_line = proc.stdout.readline() if ready else b''
        exclusive(OUT / 'runs' / 'rehearse-serve-ready.txt', raw_line)
        result['ready_line'] = {'path': str(OUT / 'runs' / 'rehearse-serve-ready.txt'), 'sha256': hashlib.sha256(raw_line).hexdigest()}
        line = raw_line.decode('utf-8', 'replace').strip()
        result['ready_line_keys'] = sorted(json.loads(line)) if line.startswith('{') else None
        result['ready'] = bool(line.startswith('{') and json.loads(line).get('status') == 'ready')
        result['ready_after_s'] = round(time.time() - started, 1)
        if result['ready']:
            origin = json.loads(line)['url']
            result['root_status'] = urllib.request.urlopen(origin + '/', timeout=60).status
            # 10-verify reads /api/bootstrap without a session and keeps whatever status it answers.
            try:
                result['bootstrap_status'] = urllib.request.urlopen(origin + '/api/bootstrap', timeout=60).status
            except urllib.error.HTTPError as error:
                result['bootstrap_status'] = error.code
            # 10-verify's CLI read, through the scratch profile.
            cli = subprocess.run(cli_argv, capture_output=True, env=env, cwd=str(home))
            for stream, data in (('stdout', cli.stdout), ('stderr', cli.stderr)):
                exclusive(OUT / 'runs' / ('rehearse-cli.' + stream), data)
                result['cli_' + stream] = {'path': str(OUT / 'runs' / ('rehearse-cli.' + stream)), 'sha256': hashlib.sha256(data).hexdigest()}
            result['cli_exit'] = cli.returncode
    except Exception as error:
        result['error'] = '%s: %s' % (type(error).__name__, error)
    finally:
        proc.send_signal(signal.SIGTERM)
        try:
            proc.wait(timeout=30)
        except subprocess.TimeoutExpired:
            proc.kill()
            proc.wait()
        result['exit'] = proc.returncode
        err = proc.stderr.read()
        exclusive(OUT / 'runs' / 'rehearse-serve.stderr', err)
        result['stderr'] = {'path': str(OUT / 'runs' / 'rehearse-serve.stderr'), 'sha256': hashlib.sha256(err).hexdigest()}
        result['stopped'] = proc.poll() is not None
        result['worktree_pyc_after'] = pyc_count(wt)
        result['pycache_prefix_files_after'] = sum(1 for p in (home / 'pyc').rglob('*') if p.is_file())
    return result


def prepare(name, wt):
    home = SCRATCH / name
    for sub in ('home', 'tmp', 'pyc', 'authority'):
        (home / sub).mkdir(parents=True, exist_ok=True)
    os.chmod(home / 'authority', 0o700)
    copy = home / 'copy.sqlite3'
    shutil.copyfile(BACKUP / 'data.sqlite3', copy)
    os.chmod(copy, 0o600)
    entry = {'worktree': str(wt), 'head': git(wt, 'rev-parse', 'HEAD'), 'tree': git(wt, 'rev-parse', 'HEAD^{tree}'),
             'clean': git(wt, 'status', '--porcelain') == '', 'copy': str(copy), 'copy_sha256_before_rebind': sha_file(copy)}
    assert entry['clean'], 'worktree is not clean: %s' % wt
    instance = dict(sqlite3.connect('file:%s?mode=ro' % copy, uri=True).execute(
        "SELECT key,value FROM metadata WHERE key='instance_id'"))['instance_id']
    rebind = child(wt, home, REBIND, [str(copy), instance, str(home / 'authority' / 'authority.json')], name + '-rebind')
    assert rebind['exit'] == 0 and rebind['answer'], ('rebind failed', rebind)
    entry.update(instance_id=instance, rebind=rebind)
    return home, copy, instance, rebind['answer']['binding'], entry


def migrate(name, wt, home, copy, instance, binding, target, step):
    run = child(wt, home, CHILD, [str(copy), instance, json.dumps(binding), target or ''], '%s-%s' % (name, step))
    return run


free_before = shutil.disk_usage(str(SCRATCH.parent)).free
manifest = json.loads((BACKUP / 'manifest.json').read_text())
RESULT['backup_identity'] = {'manifest_sha256': sha_file(BACKUP / 'manifest.json'),
                             'manifest_database': manifest['database'], 'database_sha256': sha_file(BACKUP / 'data.sqlite3')}
assert RESULT['backup_identity']['database_sha256'] == manifest['database']['sha256'], 'backup database differs from its manifest'
save()
ok = True
try:
    home, copy, instance, binding, entry = prepare('rehearse', REHEARSE)
    entry['before'] = snapshot(copy)
    entry['up'] = migrate('rehearse', REHEARSE, home, copy, instance, binding, None, 'up')
    entry['after'] = snapshot(copy, integrity=True, columns=entry['before']['columns'])
    # The new code opens the upgraded store as the server will and reads what 858 changed: request deliveries
    # (refresh_requests under message_acts) and a dossier's stack position (the level). Only counts and keys are
    # printed, never message words.
    entry['read'] = child(REHEARSE, home, READ, [str(copy), instance, json.dumps(binding), ACTOR, TOPIC or ''], 'rehearse-read')
    read = entry['read']['answer'] or {}
    entry['serve'] = serve(REHEARSE, home, copy, instance, binding)
    answer = entry['up']['answer'] or {}
    # A landing with no schema step finds the copy already at its version: nothing migrates, and that is a pass
    # only when the version it reports is the one it found and the one the copy holds after.
    result = answer.get('result') or {}
    settled = result.get('migrated') is True or (result.get('migrated') is False and result.get('from_version') is not None
                                                and result.get('from_version') == result.get('schema_version'))
    ok = (answer.get('ok') is True and settled and str(result.get('schema_version')) == str(entry['after'].get('schema_version'))
          and read.get('deliveries_ok') is True and read.get('stack_ok') is True
          and entry['serve'].get('ready') is True and entry['serve'].get('root_status') == 200
          and entry['serve'].get('cli_exit') == 0 and entry['serve'].get('bootstrap_status') in (200, 401)
          and entry['serve'].get('error') is None
          and entry['after']['broken_references'] <= entry['before']['broken_references']
          and entry['after']['rows'] == entry['before']['rows']
          and all(n == 0 for t in entry['after']['columns'].values() for n in t['added'].values())
          and entry['after']['acts_sequence'] == entry['before']['acts_sequence']
          and entry['after']['integrity_check'] == 'ok')
    entry['passed'] = ok
    RESULT['versions']['rehearse'] = entry
except Exception:
    RESULT['error'] = traceback.format_exc()
    ok = False
finally:
    if SCRATCH.exists():
        shutil.rmtree(SCRATCH)
    RESULT['cleanup'] = {'scratch_exists_after': SCRATCH.exists(), 'disk_free_before': free_before,
                         'disk_free_after': shutil.disk_usage(str(SCRATCH.parent)).free}
    RESULT['ended_at_ms'] = int(time.time() * 1000)
    save(final=True)
print(json.dumps({'ok': ok, 'result': str(OUT / 'RESULT.json')}))
sys.exit(0 if ok and 'error' not in RESULT else 1)

from __future__ import annotations

import fcntl
import errno
from contextlib import contextmanager
import hashlib
import importlib
import importlib.util
import json
import os
from pathlib import Path
import shutil
import sqlite3
import subprocess
import sys
import tempfile
import threading
import time
import unittest
import uuid
from unittest import mock

from aim_next import Store, StoreError, initialize
from aim_next.authority import Authority, AuthorityError


def digest(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


class RecoveryActivationCase(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='aim-next-recovery-')
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name).resolve()
        self.assertEqual(self.root.stat().st_dev, 16777229, 'allocated full-flush fixture volume')
        self.path = self.root / 'original' / 'data.sqlite3'
        self.anchor = self.root / 'control' / 'authority.json'
        self.info = initialize(self.path, 'recovery-fixture', [
            {'id': 'fixture-owner', 'kind': 'human'}, {'id': 'fixture-agent', 'kind': 'agent'}],
            authority_path=self.anchor)
        self.store = Store(self.path, 'recovery-fixture', expected_binding=self.info['binding'])
        self.create(self.store, 'first')

    def api(self):
        spec = importlib.util.find_spec('aim_next.recovery')
        self.assertIsNotNone(spec, 'explicit internal recovery API must exist')
        return importlib.import_module('aim_next.recovery')

    def io(self):
        return importlib.import_module('aim_next.recovery_io')

    def create(self, store, ident):
        result = store.command('fixture-owner', dict(v=1, instance_id=store.instance_id,
            operation_id=ident, kind='workspace.create', target={},
            expected={'authority': {k: store.binding[k] for k in ('authority_id', 'authority_epoch')}},
            args={'id': ident, 'title': 'Exact private writing ' + ident}))
        self.assertEqual(result['status'], 'committed', result)

    def sql(self, path, statement, args=()):
        db = sqlite3.connect(str(path))
        try:
            with db:
                return db.execute(statement, args).fetchall()
        finally:
            db.close()

    def backup(self, store=None, name='bundle'):
        store = store or self.store
        return self.api().backup(store.path, store.instance_id, expected_binding=store.binding,
                                 bundle_path=str(self.root / name))

    def request(self, backup=None, store=None, name='candidate', mode='normal', activation_id=None):
        store = store or self.store
        backup = backup or self.backup(store)
        return dict(authority_path=str(self.anchor), authority_id=store.binding['authority_id'],
                    instance_id=store.instance_id, expected_epoch=store.binding['authority_epoch'],
                    activation_id=activation_id or str(uuid.uuid4()), mode=mode,
                    bundle_path=backup['bundle_path'], bundle_digest=backup['bundle_digest'],
                    candidate_path=str(self.root / name / 'data.sqlite3'))

    def opened(self, result):
        binding = result['binding']
        return Store(binding['db_path'], binding['instance_id'], expected_binding={
            k: binding[k] for k in ('authority_path', 'authority_id', 'authority_epoch')})

    def refused(self, call, code):
        try:
            call()
        except StoreError as error:
            self.assertEqual(getattr(error, 'code', None), code, repr(error))
            return error
        except Exception as error:
            self.fail('expected typed %s, got %r' % (code, error))
        self.fail('expected refusal ' + code)

    def accepted(self, call):
        try:
            return call()
        except StoreError as error:
            self.fail('required successful recovery was refused: %s %s' % (getattr(error,'code',None),error))

    def control(self):
        return Path(str(self.anchor) + '.activations')

    def claim(self, request):
        return self.control() / request['activation_id']

    def records(self, path):
        db = sqlite3.connect(str(path))
        try:
            return {name: db.execute('SELECT * FROM "' + name + '" ORDER BY rowid').fetchall()
                    for name, in db.execute("SELECT name FROM sqlite_master WHERE type='table'")
                    if name != 'metadata'}
        finally:
            db.close()

    def ready_media(self):
        data = b'private attachment\x00exact bytes'
        media = Path(str(self.path) + '.media')
        media.mkdir(mode=0o700)
        blob = media / 'b-fixture-private'
        blob.write_bytes(data)
        blob.chmod(0o600)
        self.sql(self.path, 'INSERT INTO media_intents VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)',
                 ('private', 'fixture-owner', 1, 'ready', 'media-op', self.store.binding['authority_id'],
                  self.store.binding['authority_epoch'], 'private.bin', 'application/octet-stream',
                  len(data), hashlib.sha256(data).hexdigest(), blob.name, 0))
        return blob

    def prepared(self, request):
        api = self.api()
        with mock.patch.object(api, '_publish_anchor', side_effect=OSError('before publication')):
            self.refused(lambda: api.activate(request), 'RECOVERY_UNCONFIRMED')
        self.assertEqual(api.activation_readback(request)['status'], 'prepared')

    def test_backup_is_immutable_complete_and_copies_private_ready_bytes(self):
        blob = self.ready_media()
        result = self.backup()
        bundle = Path(result['bundle_path'])
        self.assertEqual((bundle/'media'/blob.name).stat().st_nlink,1,'backup is a private copy, not a hardlink')
        manifest = self.api().inspect(result['bundle_path'], expected_digest=result['bundle_digest'])
        self.assertEqual(manifest['metadata']['commit_seq'], '1')
        self.assertEqual(manifest['media'], [{'name': blob.name, 'size': blob.stat().st_size, 'sha256': digest(blob)}])
        self.assertTrue((bundle/'media'/blob.name).is_file(), 'ready private blob must be copied')
        self.assertEqual((bundle/'media'/blob.name).read_bytes(), blob.read_bytes())
        self.assertNotEqual((bundle/'media'/blob.name).stat().st_ino, blob.stat().st_ino)
        before = {str(p): digest(p) for p in bundle.rglob('*') if p.is_file()}
        request = self.request(result)
        activated = self.api().activate(request)
        self.assertTrue(activated['durability_confirmed'])
        self.assertGreater(activated['timings_seconds']['full_flush'], 0)
        print('RECOVERY_PHASES', json.dumps({'backup':result['timings_seconds'],
                                            'activation':activated['timings_seconds']}), flush=True)
        self.assertEqual(before, {str(p): digest(p) for p in bundle.rglob('*') if p.is_file()})
        copy = Path(request['candidate_path'] + '.media') / blob.name
        self.assertEqual(copy.read_bytes(), blob.read_bytes())
        self.assertEqual(copy.stat().st_mode & 0o777, 0o600)
        self.assertEqual(copy.stat().st_nlink, 1)
        self.assertNotEqual(copy.stat().st_ino, (bundle/'media'/blob.name).stat().st_ino)

    def test_staging_preserves_all_records_commit_identity_and_historical_routes(self):
        home = self.root/'explicit-home'
        home.mkdir()
        destination = dict(kind='codex-queue-stdio', protocol_version=1, codex_home=str(home),
                           thread_id='12345678-1234-4234-8234-123456789abc')
        with self.store.runner_guard('fixture-runner') as guard:
            self.store.provision_route_pin(guard, 'fixture-agent', destination)
        request = self.request()
        before = self.records(self.path)
        metadata = dict(self.sql(self.path, 'SELECT key,value FROM metadata'))
        result = self.api().activate(request)
        self.assertEqual(self.records(request['candidate_path']), before)
        after = dict(self.sql(request['candidate_path'], 'SELECT key,value FROM metadata'))
        self.assertEqual(after.pop('authority_epoch'), 'e-r-' + uuid.UUID(request['activation_id']).hex)
        metadata.pop('authority_epoch')
        self.assertEqual(after, metadata)
        new = self.opened(result)
        self.refused(lambda: new.read_route_pin('fixture-agent', destination), 'ROUTE_PIN_MISSING')
        self.refused(lambda: Store(self.path, self.store.instance_id, expected_binding=self.store.binding), 'AUTHORITY_CHANGED')
        self.assertEqual(self.api().activate(request)['binding'], result['binding'])

    def test_readback_table_no_claim_incomplete_prepared_published_mismatch_stale(self):
        api = self.api()
        request = self.request()
        before = set(self.root.rglob('*'))
        self.assertEqual(api.activation_readback(request)['status'], 'not_started')
        self.assertEqual(set(self.root.rglob('*')), before)
        self.prepared(request)
        mismatch = dict(request, mode='original_unavailable')
        self.assertEqual(api.activation_readback(mismatch)['status'], 'request_mismatch')
        self.refused(lambda: api.activate(mismatch), 'REQUEST_MISMATCH')
        result = api.activate(request)
        observed = api.activation_readback(request)
        self.assertEqual(observed['status'], 'published_observed')
        self.assertFalse(observed['durability_confirmed'])
        self.assertNotIn('binding', observed)
        self.assertEqual(observed['observed_binding'], result['binding'])
        current = self.opened(result)
        later = self.request(self.backup(current, 'bundle2'), current, name='candidate2')
        api.activate(later)
        self.refused(lambda: api.activate(request), 'STALE')
        self.assertEqual(api.activation_readback(request)['status'], 'stale')
        self.refused(lambda: api.activate(dict(request, expected_epoch='e-r-'+uuid.UUID(later['activation_id']).hex)), 'REQUEST_MISMATCH')

    def test_published_retry_readback_under_active_runner_without_original_or_bundle(self):
        api = self.api()
        request = self.request()
        result = api.activate(request)
        new = self.opened(result)
        self.create(new, 'after-cutover')
        self.path.unlink()
        shutil.rmtree(request['bundle_path'])
        with new.runner_guard('active-reader'):
            with mock.patch.object(api, '_bootstrap_control', side_effect=AssertionError('no EX bootstrap')):
                with mock.patch.object(self.io(), 'full_flush', side_effect=AssertionError('readback must not flush')):
                    observed = api.activation_readback(request)
                self.assertEqual(observed['status'], 'published_observed')
                real = self.io().full_flush
                flushed = []
                def flush(fd):
                    flushed.append((os.fstat(fd).st_dev, os.fstat(fd).st_ino))
                    return real(fd)
                with mock.patch.object(self.io(), 'full_flush', flush):
                    retried = self.accepted(lambda: api.activate(request))
                self.assertEqual(retried['binding'], result['binding'])
                for p in (self.anchor, self.anchor.parent):
                    self.assertIn((p.stat().st_dev, p.stat().st_ino), flushed)
                for fail_path in (self.anchor, self.anchor.parent):
                    ident = (fail_path.stat().st_dev, fail_path.stat().st_ino)
                    def failed(fd):
                        if (os.fstat(fd).st_dev, os.fstat(fd).st_ino) == ident:
                            raise OSError('confirmation failed')
                        return real(fd)
                    with self.subTest(path=str(fail_path)), mock.patch.object(self.io(), 'full_flush', failed):
                        self.refused(lambda: api.activate(request), 'RECOVERY_UNCONFIRMED')

    def test_original_unavailable_needs_explicit_mode_and_preserves_gap(self):
        api = self.api()
        request = self.request(mode='original_unavailable')
        self.path.unlink()
        result = self.accepted(lambda: api.activate(request))
        self.assertFalse(result['history_complete'])
        new = self.opened(result)
        later = self.request(self.backup(new, 'bundle2'), new, name='candidate2')
        self.assertFalse(api.activate(later)['history_complete'])
        self.refused(lambda: api.activate(request), 'STALE')
        self.assertFalse(self.path.exists())

    def test_available_original_refuses_unavailable_even_when_pair_differs(self):
        request = self.request(mode='original_unavailable')
        self.refused(lambda: self.api().activate(request), 'ORIGINAL_AVAILABLE')
        self.create(self.store, 'newer')
        self.refused(lambda: self.api().activate(request), 'ORIGINAL_AVAILABLE')

    def test_normal_missing_original_and_equal_counter_different_commit_refuse(self):
        request = self.request()
        self.sql(self.path, "UPDATE metadata SET value=? WHERE key='commit_id'", ('f'*32,))
        self.refused(lambda: self.api().activate(request), 'HISTORY_MISMATCH')
        self.path.unlink()
        self.refused(lambda: self.api().activate(request), 'ORIGINAL_UNAVAILABLE')

    def test_invalid_request_spelling_paths_types_have_no_side_effect(self):
        request = self.request(activation_id='abcdefab-1234-4234-8234-123456789abc')
        changes = [dict(activation_id=request['activation_id'].upper()), dict(activation_id='not-uuid'),
                   dict(candidate_path=str(self.root/'x/../candidate/data.sqlite3')),
                   dict(candidate_path='relative.sqlite3'), dict(mode='implicit'), dict(bundle_digest='x'),
                   dict(expected_epoch=4), dict(instance_id='other'), dict(authority_id='other')]
        for fields in changes:
            with self.subTest(fields=fields):
                before = self.anchor.read_bytes()
                try:
                    self.api().activate(dict(request, **fields))
                except StoreError:
                    pass
                else:
                    self.fail('invalid request was accepted')
                self.assertEqual(self.anchor.read_bytes(), before)
        self.assertFalse(Path(request['candidate_path']).exists())

    def test_missing_replaced_stable_locks_refuse_both_modes(self):
        for suffix in ('.lock', '.runner.lock'):
            for replace in (False, True):
                for mode in ('normal', 'original_unavailable'):
                    with self.subTest(suffix=suffix, replace=replace, mode=mode), self.isolated() as case:
                        request = case.request(mode=mode)
                        path = Path(str(case.anchor)+suffix)
                        saved = Path(str(path)+'.saved')
                        path.rename(saved)
                        try:
                            if replace:
                                path.write_bytes(b'')
                                path.chmod(0o600)
                            case.refused(lambda: case.api().activate(request), 'CONTROL_INVALID')
                            self.assertEqual(case.api().activation_readback(request)['status'], 'unconfirmed')
                        finally:
                            if path.exists():
                                path.unlink()
                            saved.rename(path)

    def test_inherited_guard_blocks_cutover_without_revoking_child(self):
        request = self.request()
        self.prepared(request)
        guard = self.store.runner_guard('inherited')
        guard.__enter__()
        child = subprocess.Popen([sys.executable, '-I', '-c', 'import sys; print("ready",flush=True); sys.stdin.read()'],
                                 pass_fds=guard.pass_fds, stdin=subprocess.PIPE, stdout=subprocess.PIPE)
        try:
            self.assertEqual(child.stdout.readline(), b'ready\n')
            guard.close()
            self.refused(lambda: self.api().activate(request), 'AUTHORITY_BUSY')
            self.assertIsNone(child.poll())
        finally:
            guard.close()
            child.communicate(timeout=5)
        self.assertTrue(self.api().activate(request)['durability_confirmed'])

    def test_claim_lock_serializes_same_id_and_candidate_path_never_adopted(self):
        request = self.request()
        self.prepared(request)
        lock = self.claim(request)/'lock'
        fd = os.open(str(lock), os.O_RDWR)
        try:
            fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
            self.refused(lambda: self.api().activate(request), 'CLAIM_BUSY')
            self.assertEqual(self.api().activation_readback(request)['status'], 'busy')
        finally:
            os.close(fd)
        other = dict(request, activation_id=str(uuid.uuid4()))
        self.refused(lambda: self.api().activate(other), 'CANDIDATE_OCCUPIED')
        self.assertEqual(self.api().activation_readback(other)['status'], 'preparation_incomplete')
        self.assertTrue(self.api().activate(request)['durability_confirmed'])

    def test_incomplete_claim_burns_only_its_id_and_missing_lock_is_not_recreated(self):
        api = self.api()
        request = self.request()
        real = api._write_record
        def fail(path, record):
            if Path(path).name.startswith('request.'):
                raise OSError('claim interrupted')
            return real(path, record)
        with mock.patch.object(api, '_write_record', fail):
            self.refused(lambda: api.activate(request), 'RECOVERY_UNCONFIRMED')
        self.assertEqual(api.activation_readback(request)['status'], 'preparation_incomplete')
        self.refused(lambda: api.activate(request), 'PREPARATION_INCOMPLETE')
        other = dict(request, activation_id=str(uuid.uuid4()), candidate_path=str(self.root/'other'/'data.sqlite3'))
        self.prepared(other)
        (self.claim(other)/'lock').unlink()
        self.refused(lambda: api.activate(other), 'CONTROL_INVALID')
        self.assertFalse((self.claim(other)/'lock').exists())

    def test_orphan_root_is_not_final_and_later_attempt_uses_own_complete_root(self):
        api = self.api()
        request = self.request()
        real = api._write_record
        def fail(path, record):
            if Path(path).name == 'header.json':
                raise OSError('before completed header')
            return real(path, record)
        with mock.patch.object(api, '_write_record', fail):
            self.refused(lambda: api.activate(request), 'RECOVERY_UNCONFIRMED')
        self.assertFalse(self.control().exists(), 'partial root must never occupy final name')
        orphans = list(self.anchor.parent.glob('*.preparing-*'))
        self.assertEqual(len(orphans), 1)
        self.assertTrue(api.activate(request)['durability_confirmed'])
        self.assertTrue(orphans[0].exists(), 'preserve interrupted sibling')

    def test_replaced_or_missing_published_control_root_never_reconstructed(self):
        request = self.request()
        self.api().activate(request)
        saved = Path(str(self.control())+'.saved')
        self.control().rename(saved)
        try:
            for replace in (False, True):
                if replace:
                    shutil.copytree(saved, self.control())
                with self.subTest(replace=replace):
                    self.refused(lambda: self.api().activate(request), 'CONTROL_INVALID')
                    self.assertEqual(self.api().activation_readback(request)['status'], 'unconfirmed')
            self.assertEqual(json.loads(self.anchor.read_text())['activation_id'], request['activation_id'])
        finally:
            if self.control().exists():
                shutil.rmtree(self.control())
            saved.rename(self.control())

    def test_interrupted_staging_refuses_retry_and_does_not_touch_bundle(self):
        request = self.request()
        manifest = Path(request['bundle_path'])/'manifest.json'
        before = digest(manifest)
        with mock.patch.object(self.api(), '_stage_epoch', side_effect=OSError('stage interrupted')):
            self.refused(lambda: self.api().activate(request), 'RECOVERY_UNCONFIRMED')
        self.assertEqual(self.api().activation_readback(request)['status'], 'preparation_incomplete')
        self.refused(lambda: self.api().activate(request), 'PREPARATION_INCOMPLETE')
        self.assertEqual(digest(manifest), before)

    def test_fault_after_replace_observed_but_only_fresh_flush_returns_binding(self):
        request = self.request()
        real = self.io().flush_path
        def fail(path, directory=False):
            if Path(path) == self.anchor.parent and json.loads(self.anchor.read_text()).get('activation_id'):
                raise OSError('post replace directory flush')
            return real(path, directory)
        with mock.patch.object(self.io(), 'flush_path', fail):
            self.refused(lambda: self.api().activate(request), 'RECOVERY_UNCONFIRMED')
        observed = self.api().activation_readback(request)
        self.assertEqual(observed['status'], 'published_observed')
        self.assertFalse(observed['durability_confirmed'])
        self.assertNotIn('binding', observed)
        self.assertTrue(self.api().activate(request)['durability_confirmed'])

    def test_request_lock_and_temp_anchor_are_flushed_before_markers(self):
        request = self.request()
        flushed = set()
        real_flush, real_replace = self.io().full_flush, os.replace
        def flush(fd):
            stat = os.fstat(fd)
            flushed.add((stat.st_dev, stat.st_ino))
            return real_flush(fd)
        def replace(source, dest):
            if Path(dest).name == 'request.complete.json':
                lock = Path(dest).parent/'lock'
                self.assertIn((lock.stat().st_dev, lock.stat().st_ino), flushed, 'lock durable before claim marker')
            if Path(dest) == self.anchor:
                stat = Path(source).stat()
                self.assertIn((stat.st_dev, stat.st_ino), flushed, 'temporary anchor durable before replace')
                for p in [Path(request['candidate_path']), Path(request['candidate_path']+'.media'),
                          Path(request['candidate_path']).parent, self.claim(request)/'staged.json',
                          self.claim(request)/'request.complete.json', self.control()/'header.json']:
                    self.assertIn((p.stat().st_dev, p.stat().st_ino), flushed, str(p))
            return real_replace(source, dest)
        with mock.patch.object(self.io(), 'full_flush', flush), mock.patch.object(os, 'replace', replace):
            self.api().activate(request)

    def test_prepublication_flush_failure_never_changes_anchor(self):
        request = self.request()
        before = self.anchor.read_bytes()
        real = self.io().flush_path
        def fail(path, directory=False):
            if Path(path) == Path(request['candidate_path']):
                raise OSError('candidate flush refused')
            return real(path, directory)
        with mock.patch.object(self.io(), 'flush_path', fail):
            self.refused(lambda: self.api().activate(request), 'RECOVERY_UNCONFIRMED')
        self.assertEqual(self.anchor.read_bytes(), before)

    def test_foreign_lineage_schema_path_epoch_refuse_both_modes(self):
        for key, value in [('instance_id', 'foreign'), ('schema_version', '999'),
                           ('authority_id', 'other'), ('authority_path', '/other/authority'), ('authority_epoch', 'other')]:
            for mode in ('normal', 'original_unavailable'):
                with self.subTest(key=key, mode=mode), self.isolated() as case:
                    result = case.backup(name='b-'+key+'-'+mode)
                    bundle = Path(result['bundle_path'])
                    case.sql(bundle/'data.sqlite3', 'UPDATE metadata SET value=? WHERE key=?', (value, key))
                    manifest = json.loads((bundle/'manifest.json').read_text())
                    manifest['database']['sha256'] = digest(bundle/'data.sqlite3')
                    manifest['metadata'][key] = value
                    (bundle/'manifest.json').write_text(json.dumps(manifest))
                    result['bundle_digest'] = digest(bundle/'manifest.json')
                    request = case.request(result, name='c-'+key+'-'+mode, mode=mode)
                    case.refused(lambda: case.api().activate(request), 'BUNDLE_INVALID')

    def test_prepared_candidate_swap_metadata_journal_mode_and_private_opener_checks(self):
        request = self.request()
        self.prepared(request)
        candidate = Path(request['candidate_path'])
        original = candidate.read_bytes()
        # Each attempt keeps the staged stat/hash checks; validate exact result,
        # then restore bytes and create a fresh request for subsequent controls.
        candidate.chmod(0o644)
        self.refused(lambda: self.api().activate(request), 'CANDIDATE_INVALID')
        candidate.chmod(0o600)
        saved = candidate.with_suffix('.saved')
        candidate.rename(saved)
        candidate.write_bytes(original)
        candidate.chmod(0o600)
        self.refused(lambda: self.api().activate(request), 'CANDIDATE_INVALID')
        candidate.unlink()
        saved.rename(candidate)
        self.sql(candidate, 'PRAGMA journal_mode=WAL')
        self.refused(lambda: self.api().activate(request), 'CANDIDATE_INVALID')
        self.sql(candidate, 'PRAGMA journal_mode=DELETE')

    def test_original_busy_never_counts_as_unavailable(self):
        request = self.request(mode='original_unavailable')
        db = sqlite3.connect(str(self.path), isolation_level=None)
        db.execute('BEGIN EXCLUSIVE')
        try:
            self.refused(lambda: self.api().activate(request), 'DATABASE_BUSY')
        finally:
            db.rollback()
            db.close()
        self.refused(lambda: self.api().activate(request), 'ORIGINAL_AVAILABLE')

    def test_long_preparation_has_no_exclusive_fence_and_publication_does_no_hashing(self):
        request = self.request()
        api, io = self.api(), self.io()
        real_stage, real_fence, real_hash = api._stage_epoch, api.RecoveryFence.__enter__, io.hash_file
        events = []
        def stage(*args, **kwargs):
            start = time.perf_counter()
            # Actual foreground write succeeds while candidate is prepared.
            self.create(self.store, 'foreground-during-preparation')
            events.append(('foreground', time.perf_counter()-start))
            return real_stage(*args, **kwargs)
        inside = []
        real_exit = api.RecoveryFence.__exit__
        def enter(fence):
            result = real_fence(fence)
            inside.append(fence.mode)
            return result
        def leave(fence, *args):
            inside.pop()
            return real_exit(fence, *args)
        def hashed(*args, **kwargs):
            self.assertNotIn('exclusive', inside, 'bulk verification outside exclusive fence')
            return real_hash(*args, **kwargs)
        with mock.patch.object(api, '_stage_epoch', stage), mock.patch.object(api.RecoveryFence, '__enter__', enter), \
                mock.patch.object(api.RecoveryFence, '__exit__', leave), mock.patch.object(io, 'hash_file', hashed):
            self.refused(lambda: api.activate(request), 'HISTORY_MISMATCH')
        self.assertEqual(len(events), 1)
        self.assertLess(events[0][1], 0.5)
        print('FOREGROUND_OBSERVATION', json.dumps(events), flush=True)

    def test_original_cleanup_failure_is_uncertainty_not_unavailable_history(self):
        for mode in ('normal','original_unavailable'):
            with self.subTest(mode=mode), self.isolated() as case:
                case.original_close_fault(mode)

    def original_close_fault(self, mode):
        request = self.request(mode=mode)
        io = self.io()
        real_connect = sqlite3.connect
        closed = []
        class CloseFault:
            def __init__(inner, db):
                inner.db = db
            def __getattr__(inner, name):
                return getattr(inner.db, name)
            def close(inner):
                inner.db.close()
                closed.append(inner.db)
                raise OSError('injected close uncertainty')
        def connect(path, *args, **kwargs):
            db = real_connect(path, *args, **kwargs)
            return CloseFault(db) if str(path).startswith(self.path.as_uri()+'?') else db
        before = self.anchor.read_bytes()
        with mock.patch.object(io.sqlite3, 'connect', connect):
            self.refused(lambda: self.api().activate(request), 'RECOVERY_UNCONFIRMED')
        self.assertEqual(self.anchor.read_bytes(), before)
        self.assertEqual(len(closed), 1)
        with self.assertRaises(sqlite3.ProgrammingError):
            closed[0].execute('SELECT 1')

    def test_interrupted_or_ambiguous_original_observation_cannot_publish(self):
        request = self.request(mode='original_unavailable')
        io = self.io()
        real = io.read_metadata
        for fault in (InterruptedError('interrupted read'), sqlite3.OperationalError('interrupted')):
            def read(path, *args, **kwargs):
                if Path(path) == self.path:
                    raise fault
                return real(path, *args, **kwargs)
            with self.subTest(fault=repr(fault)), mock.patch.object(io, 'read_metadata', read):
                self.refused(lambda: self.api().activate(request), 'RECOVERY_UNCONFIRMED')
        self.assertNotIn('activation_id', json.loads(self.anchor.read_text()))

    def test_prepared_readback_checks_candidate_binding_not_just_receipt_presence(self):
        request = self.request()
        self.prepared(request)
        self.sql(request['candidate_path'], "UPDATE metadata SET value='foreign' WHERE key='authority_epoch'")
        result = self.api().activation_readback(request)
        self.assertEqual(result['status'], 'unconfirmed')
        self.assertNotIn('binding', result)

    def test_full_flush_has_real_failure_control_and_no_weaker_fallback(self):
        self.api()
        io = self.io()
        fd = os.open(str(self.path), os.O_RDONLY)
        io.full_flush(fd)
        os.close(fd)
        with self.assertRaises(OSError):
            io.full_flush(fd)
        with mock.patch.object(io.fcntl, 'fcntl', side_effect=OSError('unsupported')), \
                mock.patch.object(io.os, 'fsync', side_effect=AssertionError('no weaker fallback')):
            with self.assertRaises(OSError):
                io.full_flush(-1)

    def test_bundle_missing_completion_or_corrupt_private_blob_is_not_accepted(self):
        blob = self.ready_media()
        result = self.backup()
        root = Path(result['bundle_path'])
        marker = root/'manifest.json'
        saved = marker.read_bytes()
        marker.unlink()
        self.refused(lambda: self.api().inspect(str(root)), 'BUNDLE_INVALID')
        marker.write_bytes(saved)
        marker.chmod(0o600)
        (root/'media'/blob.name).write_bytes(b'wrong')
        self.refused(lambda: self.api().inspect(str(root), expected_digest=result['bundle_digest']), 'BUNDLE_INVALID')

    def test_same_id_concurrent_attempt_cannot_enter_preparation(self):
        request = self.request()
        api = self.api()
        entered, release = threading.Event(), threading.Event()
        real = api._stage_epoch
        results = []
        def stage(*args):
            entered.set()
            if not release.wait(5):
                raise AssertionError('fixture release missing')
            return real(*args)
        def worker():
            try:
                results.append(api.activate(request))
            except BaseException as error:
                results.append(error)
        with mock.patch.object(api, '_stage_epoch', stage):
            thread = threading.Thread(target=worker)
            thread.start()
            try:
                self.assertTrue(entered.wait(5))
                self.refused(lambda: api.activate(request), 'CLAIM_BUSY')
            finally:
                release.set()
                thread.join(5)
                self.assertFalse(thread.is_alive())
        self.assertEqual(len(results), 1)
        self.assertIsInstance(results[0], dict, repr(results))
        self.assertTrue(results[0]['durability_confirmed'])

    @contextmanager
    def isolated(self):
        case = RecoveryActivationCase('runTest')
        try:
            case._callSetUp()
            yield case
        finally:
            case.doCleanups()

    def test_all_flush_and_marker_interruptions_preserve_observable_state(self):
        # Enumerate this exact call's primitive boundaries; interrupt before and
        # after each. These are exception/process-boundary controls, not power loss.
        api, io = self.api(), self.io()
        real_flush, real_rename, real_replace, real_write = io.full_flush, os.rename, os.replace, io.write_record
        def instrument(events, stop=None):
            def event(label, action, args, kwargs):
                events.append(label+':before')
                if stop == len(events)-1:
                    raise OSError('boundary before')
                value = action(*args, **kwargs)
                events.append(label+':after')
                if stop == len(events)-1:
                    raise OSError('boundary after')
                return value
            def flush(*args, **kwargs):
                return event('flush', real_flush, args, kwargs)
            def rename(*args, **kwargs):
                return event('root-rename', real_rename, args, kwargs)
            def replace(*args, **kwargs):
                dest = Path(args[1]).name
                label = 'anchor-replace' if dest == 'authority.json' else 'marker-'+dest
                return event(label, real_replace, args, kwargs)
            def write(*args, **kwargs):
                return event('record-write', real_write, args, kwargs)
            return (mock.patch.object(io,'full_flush',flush), mock.patch.object(os,'rename',rename),
                    mock.patch.object(os,'replace',replace), mock.patch.object(io,'write_record',write))
        with self.isolated() as case:
            request = case.request()
            events = []
            a,b,c,d = instrument(events)
            with a,b,c,d:
                case.api().activate(request)
        for stop in range(len(events)):
            with self.subTest(index=stop, boundary=events[stop]), self.isolated() as case:
                request = case.request()
                original = case.anchor.read_bytes()
                observed = []
                a,b,c,d = instrument(observed, stop)
                with a,b,c,d:
                    case.refused(lambda: api.activate(request), 'RECOVERY_UNCONFIRMED')
                self.assertEqual(observed[-1], events[stop])
                if 'anchor-replace:after' not in observed:
                    self.assertEqual(case.anchor.read_bytes(), original)
                else:
                    readback = api.activation_readback(request)
                    self.assertEqual(readback['status'], 'published_observed')
                    self.assertFalse(readback['durability_confirmed'])
                    self.assertTrue(api.activate(request)['durability_confirmed'])
                if 'root-rename:before' in observed and 'root-rename:after' not in observed:
                    self.assertFalse(case.control().exists())
        print('INTERRUPTION_BOUNDARIES', json.dumps(events), flush=True)

    def test_copied_receipt_binds_unstaged_database_before_epoch_write(self):
        request = self.request()
        api = self.api()
        real = api._stage_epoch
        def stage(path, req, manifest):
            marker = self.claim(req)/'copied.json'
            self.assertTrue(marker.exists(), 'copied ownership receipt precedes epoch staging')
            copied = json.loads(marker.read_text())
            self.assertEqual(copied['request_digest'], self.io().digest_record(req))
            self.assertEqual(copied['database'], manifest['database'])
            self.assertEqual(copied['database_stat'], self.io().facts(Path(path).stat()))
            return real(path, req, manifest)
        with mock.patch.object(api, '_stage_epoch', stage):
            api.activate(request)

    def test_actual_process_exit_before_and_after_publication_reconciles(self):
        request = self.request()
        root = str(Path(__file__).resolve().parents[1])
        code = '''import json,os,sys
sys.path.insert(0,sys.argv[1])
from aim_next import recovery
request=json.loads(sys.stdin.read())
if sys.argv[2]=='before':
    recovery._publish_anchor=lambda *args: os._exit(61)
else:
    real=recovery.os.replace
    def replace(source,dest):
        real(source,dest)
        if str(dest)==request['authority_path']: os._exit(62)
    recovery.os.replace=replace
recovery.activate(request)
'''
        child = subprocess.run([sys.executable, '-I', '-X', 'pycache_prefix='+str(Path(sys.pycache_prefix)/'before'),
                                '-c', code, root, 'before'], input=json.dumps(request).encode(),
                               stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=10)
        self.assertEqual(child.returncode, 61, child.stderr)
        self.assertEqual(self.api().activation_readback(request)['status'], 'prepared')
        child = subprocess.run([sys.executable, '-I', '-X', 'pycache_prefix='+str(Path(sys.pycache_prefix)/'after'),
                                '-c', code, root, 'after'], input=json.dumps(request).encode(),
                               stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=10)
        self.assertEqual(child.returncode, 62, child.stderr)
        self.assertEqual(self.api().activation_readback(request)['status'], 'published_observed')
        self.assertTrue(self.api().activate(request)['durability_confirmed'])
        print('PROCESS_EXIT_OBSERVATIONS', json.dumps({'before':61,'after_replace':62,'children_exited':True}), flush=True)

    def test_concurrent_control_publishers_preserve_one_complete_root(self):
        request = self.request()
        api = self.api()
        gate = threading.Barrier(2)
        real = api._write_record
        results = []
        def write(path, value):
            result = real(path, value)
            if Path(path).name == 'header.json':
                gate.wait(5)
            return result
        def worker():
            try:
                api._bootstrap_control(request, self.io().Timings())
                results.append('complete')
            except StoreError as error:
                results.append(error.code)
            except BaseException as error:
                results.append(repr(error))
        with mock.patch.object(api, '_write_record', write):
            workers = [threading.Thread(target=worker) for _ in range(2)]
            for worker_thread in workers:
                worker_thread.start()
            for worker_thread in workers:
                worker_thread.join(6)
                self.assertFalse(worker_thread.is_alive())
        self.assertIn('complete', results)
        self.assertTrue(set(results) <= {'complete','AUTHORITY_BUSY'}, results)
        header = (self.control()/'header.json').read_bytes()
        identity = self.io().identity(self.control().stat())
        api._bootstrap_control(request, self.io().Timings())
        self.assertEqual(self.io().identity(self.control().stat()), identity)
        self.assertEqual((self.control()/'header.json').read_bytes(), header)
        self.assertEqual(json.loads(header)['root_identity'], identity)

    def test_published_candidate_permissions_links_types_and_owner_are_checked(self):
        request = self.request()
        self.api().activate(request)
        path = Path(request['candidate_path'])
        for target in (path, path.parent, Path(str(path)+'.media')):
            original = target.stat().st_mode & 0o777
            try:
                target.chmod(0o755 if target.is_dir() else 0o644)
                self.assertEqual(self.api().activation_readback(request)['status'], 'unconfirmed')
            finally:
                target.chmod(original)
        hard = self.root/'hardlink'
        os.link(path, hard)
        try:
            self.assertEqual(self.api().activation_readback(request)['status'], 'unconfirmed')
        finally:
            hard.unlink()
        saved = path.with_suffix('.saved')
        path.rename(saved)
        try:
            path.symlink_to(saved)
            self.assertEqual(self.api().activation_readback(request)['status'], 'unconfirmed')
            path.unlink()
            path.mkdir(mode=0o700)
            self.assertEqual(self.api().activation_readback(request)['status'], 'unconfirmed')
            path.rmdir()
        finally:
            saved.rename(path)
        # Different-UID files cannot be created without privileges. Interpose
        # lstat/fstat ownership only for this exact inode; all other facts real.
        real_lstat, real_fstat = Path.lstat, os.fstat
        inode = path.stat().st_ino
        def owner(info):
            if info.st_ino != inode:
                return info
            class Info:
                st_uid = os.getuid()+1
                def __getattr__(self, key):
                    return getattr(info,key)
            return Info()
        with mock.patch.object(Path,'lstat',lambda *a,**k: owner(real_lstat(*a,**k))), \
                mock.patch.object(os,'fstat',lambda *a,**k: owner(real_fstat(*a,**k))):
            self.assertEqual(self.api().activation_readback(request)['status'], 'unconfirmed')
        self.assertEqual(self.api().activation_readback(request)['status'], 'published_observed')

    def test_post_open_identity_is_checked_before_fixed_metadata_is_read(self):
        request = self.request()
        self.prepared(request)
        io = self.io()
        path = Path(request['candidate_path'])
        saved = path.with_suffix('.saved')
        original_connect = sqlite3.connect
        queries = []
        def connect(value, *args, **kwargs):
            db = original_connect(value, *args, **kwargs)
            if str(value).startswith(path.as_uri()+'?'):
                db.set_trace_callback(queries.append)
                path.rename(saved)
                shutil.copy2(saved,path)
            return db
        try:
            with mock.patch.object(sqlite3,'connect',connect):
                self.assertEqual(self.api().activation_readback(request)['status'], 'unconfirmed')
            self.assertFalse(any('FROM metadata' in q for q in queries), queries)
        finally:
            if saved.exists():
                path.unlink()
                saved.rename(path)

    def test_published_runtime_metadata_and_journal_mode_are_validated(self):
        request = self.request()
        self.api().activate(request)
        path = Path(request['candidate_path'])
        before = dict(self.sql(path,'SELECT key,value FROM metadata'))
        for key, value in [('schema_version','999'),('authority_id','foreign'),('instance_id','foreign'),
                           ('authority_path','/wrong/path'),('authority_epoch','foreign'),('commit_id','not-a-commit')]:
            with self.subTest(key=key):
                try:
                    self.sql(path,'UPDATE metadata SET value=? WHERE key=?',(value,key))
                    self.assertEqual(self.api().activation_readback(request)['status'],'unconfirmed')
                finally:
                    self.sql(path,'UPDATE metadata SET value=? WHERE key=?',(before[key],key))
        writer = sqlite3.connect(str(path),isolation_level=None)
        try:
            writer.execute('PRAGMA journal_mode=WAL')
            writer.execute('SELECT value FROM metadata').fetchall()
            self.assertEqual(self.io().read_metadata(path,require_delete=False)['authority_epoch'],
                             'e-r-'+uuid.UUID(request['activation_id']).hex)
            self.assertEqual(self.api().activation_readback(request)['status'],'unconfirmed')
        finally:
            writer.close()
            self.sql(path,'PRAGMA journal_mode=DELETE')

    def test_invalid_file_type_is_rejected_before_sqlite_open(self):
        request = self.request()
        self.api().activate(request)
        path = Path(request['candidate_path'])
        saved = path.with_suffix('.saved')
        path.rename(saved)
        # A directory has nlink>1 and would be caught by the separate hardlink
        # guard. A FIFO has the same mode/owner/nlink as a private regular file.
        os.mkfifo(str(path),0o600)
        try:
            with mock.patch.object(sqlite3,'connect',side_effect=sqlite3.OperationalError('test forbids special-file open')) as connected:
                # Isolate the internal opener. Published readback also checks
                # the anchor inode and would reject any replacement FIFO.
                try:
                    with self.io().connection(path):
                        self.fail('special file was accepted')
                except StoreError as error:
                    self.assertEqual(error.code,'CANDIDATE_INVALID')
                except sqlite3.OperationalError:
                    pass
            self.assertEqual(connected.call_count,0, 'invalid file type must not reach SQLite')
        finally:
            path.unlink()
            saved.rename(path)

    def test_bundle_hash_rejects_changed_records_and_equal_length_media(self):
        blob = self.ready_media()
        result = self.backup()
        root = Path(result['bundle_path'])
        self.sql(root/'data.sqlite3',"UPDATE workspaces SET title='altered private record'")
        with self.subTest(kind='database'):
            self.refused(lambda: self.api().inspect(str(root),expected_digest=result['bundle_digest']),'BUNDLE_INVALID')
        # A separate valid snapshot isolates media digest checking from DB hash.
        result = self.backup(name='media-bundle')
        copied = Path(result['bundle_path'])/'media'/blob.name
        copied.write_bytes(b'x'*blob.stat().st_size)
        with self.subTest(kind='media'):
            self.refused(lambda: self.api().inspect(result['bundle_path'],expected_digest=result['bundle_digest']),'BUNDLE_INVALID')

    def test_initial_control_root_identity_cannot_be_replaced_before_first_claim(self):
        request = self.request()
        self.api()._bootstrap_control(request,self.io().Timings())
        saved = Path(str(self.control())+'.saved')
        self.control().rename(saved)
        try:
            shutil.copytree(saved,self.control())
            self.refused(lambda: self.api().activate(request),'CONTROL_INVALID')
            self.assertNotIn('activation_id',json.loads(self.anchor.read_text()))
        finally:
            shutil.rmtree(self.control())
            saved.rename(self.control())

    def test_root_rename_parent_flush_precedes_any_claim_creation(self):
        request = self.request()
        io = self.io()
        real_flush, real_rename, real_mkdir = io.full_flush, os.rename, Path.mkdir
        root_renamed = []
        confirmed = []
        parent_identity = io.identity(self.anchor.parent.stat())
        def rename(source,dest):
            value = real_rename(source,dest)
            if Path(dest) == self.control():
                root_renamed.append(True)
            return value
        def flush(fd):
            value = real_flush(fd)
            if root_renamed and io.identity(os.fstat(fd)) == parent_identity:
                confirmed.append(True)
            return value
        def mkdir(path,*args,**kwargs):
            if path == self.claim(request):
                self.assertTrue(confirmed,'root publication needs fresh parent flush before claims')
            return real_mkdir(path,*args,**kwargs)
        with mock.patch.object(io,'full_flush',flush), mock.patch.object(os,'rename',rename), \
                mock.patch.object(Path,'mkdir',mkdir):
            self.api().activate(request)

    def test_snapshot_old_hints_and_runner_generation_cannot_act_after_activation(self):
        import test_runner
        fixture = test_runner.RunnerCase('runTest')
        try:
            fixture._callSetUp()
            guard = fixture.guard('pre-backup')
            token = fixture.token(guard)
            claim = fixture.claim(guard,token)
            guard.close()
            root = fixture.path.parent.resolve()
            result = self.api().backup(fixture.path.resolve(),fixture.store.instance_id,expected_binding=fixture.binding,
                                       bundle_path=str(root/'recovery-bundle'))
            request = dict(authority_path=fixture.binding['authority_path'],authority_id=fixture.binding['authority_id'],
                           instance_id=fixture.store.instance_id,expected_epoch=fixture.binding['authority_epoch'],
                           activation_id=str(uuid.uuid4()),mode='normal',bundle_path=result['bundle_path'],
                           bundle_digest=result['bundle_digest'],candidate_path=str(root/'candidate'/'data.sqlite3'))
            activated = self.api().activate(request)
            new = self.opened(activated)
            before = self.records(new.path)
            with new.runner_guard('after-activation') as current:
                outcome = new.finish_wake(current,token,claim['claim_token'],'accepted')
            self.assertEqual(outcome['status'],'stale')
            self.assertEqual(self.records(new.path),before)
            self.assertEqual(claim['route_binding']['authority_epoch'],fixture.binding['authority_epoch'])
            self.assertNotEqual(claim['route_binding']['authority_epoch'],new.binding['authority_epoch'])
        finally:
            fixture.doCleanups()

    def test_blocked_root_publication_reports_exact_orphan_path(self):
        request = self.request()
        with self.store.runner_guard('block-root-publication'):
            error = self.refused(lambda: self.api().activate(request),'AUTHORITY_BUSY')
        orphans = list(self.anchor.parent.glob('*.preparing-*'))
        self.assertEqual(len(orphans),1)
        self.assertIn(str(orphans[0]),error.evidence.get('orphan_paths',[]))
        self.assertFalse(self.control().exists())
        self.assertTrue(self.api().activate(request)['durability_confirmed'])
        self.assertTrue(orphans[0].exists())

    def test_published_db_copy_at_same_path_does_not_match_anchor_inode(self):
        request = self.request()
        self.api().activate(request)
        path = Path(request['candidate_path'])
        saved = path.with_suffix('.saved')
        path.rename(saved)
        try:
            shutil.copy2(saved,path)
            self.assertNotEqual(path.stat().st_ino,saved.stat().st_ino)
            self.assertEqual(self.api().activation_readback(request)['status'],'unconfirmed')
        finally:
            path.unlink()
            saved.rename(path)

    def test_readable_original_in_wal_mode_still_refuses_unavailable_choice(self):
        request = self.request(mode='original_unavailable')
        self.create(self.store,'newer-than-bundle')
        writer = sqlite3.connect(str(self.path),isolation_level=None)
        try:
            writer.execute('PRAGMA journal_mode=WAL')
            writer.execute('SELECT value FROM metadata').fetchall()
            # Keep the WAL coordination files present. Without these Apple's
            # read-only SQLite refuses to open the DB; that is unconfirmed,
            # not the readable-original condition this control claims.
            self.assertEqual(self.io().read_metadata(self.path,require_delete=False)['commit_seq'],'2')
            self.refused(lambda: self.api().activate(request),'ORIGINAL_AVAILABLE')
        finally:
            writer.close()
            self.sql(self.path,'PRAGMA journal_mode=DELETE')

    def test_interrupted_backup_has_no_completion_marker_and_releases_source_fence(self):
        self.ready_media()
        before = self.path.read_bytes()
        self.api()
        with mock.patch.object(self.io(),'copy_file',side_effect=KeyboardInterrupt('cancel backup')):
            self.refused(lambda: self.backup(),'BACKUP_UNCONFIRMED')
        root = self.root/'bundle'
        self.assertTrue((root/'data.sqlite3').exists())
        self.assertFalse((root/'manifest.json').exists(),'incomplete media copy cannot publish completion')
        self.assertEqual(self.path.read_bytes(),before)
        self.refused(lambda: self.api().inspect(str(root)),'BUNDLE_INVALID')
        fd = os.open(str(self.anchor)+'.lock',os.O_RDWR)
        try:
            fcntl.flock(fd,fcntl.LOCK_EX|fcntl.LOCK_NB)
        finally:
            os.close(fd)


    def test_readable_original_operator_changes_never_authorize_gap(self):
        for change in ('mode0400', 'hardlink'):
            for newer in (False, True):
                for mode in ('normal', 'original_unavailable'):
                    with self.subTest(change=change, newer=newer, mode=mode), self.isolated() as case:
                        request = case.request(mode=mode)
                        if newer:
                            case.create(case.store, 'newer-than-snapshot')
                        if change == 'mode0400':
                            case.path.chmod(0o400)
                        else:
                            os.link(case.path, case.root/'original-hardlink')
                        before = case.anchor.read_bytes()
                        if mode == 'original_unavailable':
                            case.refused(lambda: case.api().activate(request), 'ORIGINAL_AVAILABLE')
                        elif newer:
                            case.refused(lambda: case.api().activate(request), 'HISTORY_MISMATCH')
                        else:
                            result = case.accepted(lambda: case.api().activate(request))
                            case.assertTrue(result['history_complete'])
                            continue
                        case.assertEqual(case.anchor.read_bytes(), before)

    def test_original_schema_is_checked_before_other_metadata(self):
        faults = {
            'newer-missing-commit': ("UPDATE metadata SET value='11' WHERE key='schema_version'",
                                     "DELETE FROM metadata WHERE key='commit_id'"),
            'older-missing-commit': ("UPDATE metadata SET value='7' WHERE key='schema_version'",
                                     "DELETE FROM metadata WHERE key='commit_id'"),
            'newer-blob-commit': ("UPDATE metadata SET value='11' WHERE key='schema_version'",
                                  "UPDATE metadata SET value=x'00' WHERE key='commit_id'"),
            'missing-version': ("DELETE FROM metadata WHERE key='schema_version'",),
            'blob-version': ("UPDATE metadata SET value=CAST(value AS BLOB) WHERE key='schema_version'",),
        }
        for fault, statements in faults.items():
            for mode in ('normal', 'original_unavailable'):
                with self.subTest(fault=fault, mode=mode), self.isolated() as case:
                    request = case.request(mode=mode)
                    before = case.anchor.read_bytes()
                    for statement in statements:
                        case.sql(case.path, statement)
                    observed = case.sql(case.path, "SELECT key,typeof(value),value FROM metadata "
                                        "WHERE key IN ('schema_version','commit_id') ORDER BY key")
                    print('SCHEMA_FAULT', fault, mode, repr(observed), flush=True)
                    case.refused(lambda: case.api().activate(request), 'RECOVERY_UNCONFIRMED')
                    case.assertEqual(case.anchor.read_bytes(), before, 'unknown schema cannot publish a gap')

    def test_schema_version_bytes_are_bounded_before_python_validation(self):
        for kind in ('text', 'blob'):
            for code in ('ORIGINAL_UNAVAILABLE', 'CANDIDATE_INVALID', 'BUNDLE_INVALID'):
                with self.subTest(kind=kind, code=code):
                    payload = '9' * (1024 * 1024)
                    value = payload if kind == 'text' else sqlite3.Binary(payload.encode('ascii'))
                    self.sql(self.path, "UPDATE metadata SET value=? WHERE key='schema_version'", (value,))
                    self.assertEqual(self.sql(self.path, "SELECT typeof(value),length(value) FROM metadata "
                                              "WHERE key='schema_version'"), [(kind, len(payload))])
                    returned = []
                    db = sqlite3.connect(str(self.path))
                    class ObservedCursor:
                        def __init__(self, cursor):
                            self.cursor = cursor
                        def fetchall(self):
                            rows = self.cursor.fetchall()
                            returned.extend(rows)
                            return rows
                    class ObservedDatabase:
                        def execute(self, statement, parameters=()):
                            return ObservedCursor(db.execute(statement, parameters))
                    try:
                        db.execute('BEGIN')
                        expected = 'RECOVERY_UNCONFIRMED' if code == 'ORIGINAL_UNAVAILABLE' else code
                        self.refused(lambda: self.io().metadata(ObservedDatabase(), code), expected)
                        sizes = [len(value) for row in returned for value in row if isinstance(value, (bytes, str))]
                        self.assertTrue(sizes, 'observe actual SQLite-returned values, not query spelling')
                        self.assertLessEqual(max(sizes), 4097, 'oversize version must be bounded before Python sees it')
                        self.assertEqual(db.total_changes, 0)
                    finally:
                        db.close()

    def test_original_observation_failure_never_authorizes_gap(self):
        for fault in ('mode000', 'owner', 'directory', 'eio', 'eperm', 'schema', 'runtime'):
            for mode in ('normal', 'original_unavailable'):
                with self.subTest(fault=fault, mode=mode), self.isolated() as case:
                    request = case.request(mode=mode)
                    before = case.anchor.read_bytes()
                    inode = case.path.stat().st_ino
                    real_lstat, real_connect = Path.lstat, sqlite3.connect
                    if fault == 'mode000':
                        case.assertNotEqual(os.getuid(), 0, 'actual permission fixture requires non-root')
                        case.path.chmod(0)
                    elif fault == 'directory':
                        case.path.rename(case.path.with_suffix('.saved'))
                        case.path.mkdir(mode=0o700)
                    elif fault == 'schema':
                        case.sql(case.path, "UPDATE metadata SET value='999' WHERE key='schema_version'")
                    def lstat(path, *args, **kwargs):
                        if path == case.path and fault == 'eio':
                            raise OSError(errno.EIO, 'uncertain read')
                        info = real_lstat(path, *args, **kwargs)
                        if fault == 'owner' and info.st_ino == inode:
                            class OtherOwner:
                                st_uid = os.getuid()+1
                                def __getattr__(self, key):
                                    return getattr(info, key)
                            return OtherOwner()
                        return info
                    def connect(path, *args, **kwargs):
                        if fault == 'eperm' and str(path).startswith(case.path.as_uri()+'?'):
                            raise PermissionError(errno.EPERM, 'uncertain permission')
                        db = real_connect(path, *args, **kwargs)
                        if fault == 'runtime' and str(path).startswith(case.path.as_uri()+'?'):
                            class RuntimeObservation:
                                def __getattr__(self, key):
                                    return getattr(db,key)
                                def execute(self, statement, *args):
                                    if statement == 'PRAGMA fullfsync':
                                        return mock.Mock(fetchone=lambda: (0,))
                                    return db.execute(statement,*args)
                            return RuntimeObservation()
                        return db
                    with mock.patch.object(Path, 'lstat', lstat), mock.patch.object(sqlite3, 'connect', connect):
                        case.refused(lambda: case.api().activate(request), 'RECOVERY_UNCONFIRMED')
                    case.assertEqual(case.anchor.read_bytes(), before, 'observation failure cannot publish a gap')
                    if fault == 'owner':
                        print('OWNER_CONTROL exact-inode Path.lstat interposition; no chown', inode, flush=True)

    def test_original_positive_gap_observations_remain_distinct(self):
        for observation in ('different-inode', 'corrupt', 'different-lineage'):
            with self.subTest(observation=observation), self.isolated() as case:
                request = case.request(mode='original_unavailable')
                if observation == 'different-inode':
                    case.path.rename(case.path.with_suffix('.saved'))
                    shutil.copy2(case.path.with_suffix('.saved'), case.path)
                elif observation == 'corrupt':
                    case.path.write_bytes(b'confirmed non-SQLite bytes')
                else:
                    case.sql(case.path, "UPDATE metadata SET value='another-instance' WHERE key='instance_id'")
                result = case.accepted(lambda: case.api().activate(request))
                case.assertFalse(result['history_complete'])

    def filesystem_aliases(self, path):
        value = str(path)
        choices = [value.replace('/Users/', '/USERS/', 1), '/System/Volumes/Data'+value]
        for alias in choices:
            other = Path(alias)
            actual = other.exists() and other != path and (other.stat().st_dev, other.stat().st_ino) == (path.stat().st_dev, path.stat().st_ino)
            print('FILESYSTEM_ALIAS', json.dumps(dict(path=value, alias=alias, actual=actual,
                  resolved=str(other.resolve()), identity=[path.stat().st_dev,path.stat().st_ino])), flush=True)
            if actual:
                yield alias

    def test_authority_alias_refuses_before_control_and_exact_request_still_works(self):
        for index in (0, 1):
            with self.subTest(alias=index), self.isolated() as case:
                request = case.request()
                aliases = list(case.filesystem_aliases(case.anchor))
                case.assertTrue(aliases, 'this allocated volume must demonstrate an actual alias')
                if index >= len(aliases):
                    continue
                alias = aliases[index]
                case.assertEqual(str(case.io().canonical(alias)), alias)
                case.refused(lambda: case.api().activate(dict(request, authority_path=alias)), 'BUNDLE_INVALID')
                case.assertFalse(case.control().exists(), 'pinned spelling checked before permanent control creation')
                case.assertFalse(Path(request['candidate_path']).parent.exists())
                case.assertTrue(case.api().activate(request)['durability_confirmed'])

    def test_control_header_alias_names_same_directory_not_a_copy(self):
        request = self.request()
        self.prepared(request)
        header_path = self.control()/'header.json'
        header = json.loads(header_path.read_text())
        aliases = list(self.filesystem_aliases(self.control()))
        self.assertTrue(aliases)
        header['path'] = aliases[0]
        header_path.write_text(json.dumps(header)+'\n')
        self.assertEqual(self.api().activation_readback(request)['status'], 'prepared')
        copied = self.root/'copied-control'
        shutil.copytree(self.control(), copied)
        header['path'] = str(copied)
        header_path.write_text(json.dumps(header)+'\n')
        self.assertEqual(self.api().activation_readback(request)['status'], 'unconfirmed', 'header must name the same inode')

    def test_typed_publication_failures_after_attempt_are_unconfirmed(self):
        for site in ('attempt-fails', 'replace', 'directory', 'identity', 'fence', 'close', 'before-attempt'):
            with self.subTest(site=site), self.isolated() as case:
                request = case.request()
                api, io = case.api(), case.io()
                fault = io.RecoveryError('CONTROL_INVALID')
                real_replace, real_flush, real_checked = os.replace, io.flush_path, io.checked
                real_verify, real_encode = api.RecoveryFence.verify, io.encode
                real_fdopen = os.fdopen
                fired = []
                def published():
                    return json.loads(case.anchor.read_text()).get('activation_id') == request['activation_id']
                def fail():
                    fired.append(site)
                    raise fault
                def replace(source, dest):
                    if site == 'attempt-fails' and Path(dest) == case.anchor:
                        fail()
                    result = real_replace(source, dest)
                    if site == 'replace' and Path(dest) == case.anchor:
                        fail()
                    return result
                def flush(path, directory=False):
                    if site == 'directory' and Path(path) == case.anchor.parent and published():
                        fail()
                    return real_flush(path, directory)
                def checked(path, *args, **kwargs):
                    if site == 'identity' and Path(path) == case.anchor and published():
                        fail()
                    return real_checked(path, *args, **kwargs)
                def verify(fence):
                    if site == 'fence' and published():
                        fail()
                    return real_verify(fence)
                def encode(value):
                    if site == 'before-attempt' and isinstance(value, dict) and value.get('activation_id') == request['activation_id'] and 'db_inode' in value:
                        fail()
                    return real_encode(value)
                def fdopen(fd, *args, **kwargs):
                    stream = real_fdopen(fd, *args, **kwargs)
                    if site != 'close' or not args or args[0] != 'wb':
                        return stream
                    class ClosingStream:
                        def __getattr__(self, name):
                            return getattr(stream,name)
                        def __enter__(self):
                            return self
                        def __exit__(self, *unused):
                            anchor_stream = published() and io.identity(os.fstat(stream.fileno())) == io.identity(case.anchor.stat())
                            stream.close()
                            if anchor_stream:
                                fail()
                    return ClosingStream()
                with mock.patch.object(os,'replace',replace), mock.patch.object(io,'flush_path',flush), \
                        mock.patch.object(io,'checked',checked), mock.patch.object(api.RecoveryFence,'verify',verify), \
                        mock.patch.object(io,'encode',encode), mock.patch.object(os,'fdopen',fdopen):
                    error = case.refused(lambda: api.activate(request), 'CONTROL_INVALID' if site == 'before-attempt' else 'RECOVERY_UNCONFIRMED')
                case.assertEqual(fired, [site])
                if site == 'before-attempt':
                    case.assertFalse(published())
                else:
                    case.assertIs(error.__cause__, fault, 'publication uncertainty preserves original typed cause')
                    case.assertEqual(api.activation_readback(request)['status'], 'prepared' if site == 'attempt-fails' else 'published_observed')
                    case.assertTrue(api.activate(request)['durability_confirmed'])

    def test_published_observation_tolerates_actual_commit_inside_open(self):
        request = self.request()
        result = self.api().activate(request)
        current = self.opened(result)
        path = Path(request['candidate_path'])
        with current.runner_guard('active-writer'):
            for operation in ('readback','retry'):
                before = dict(self.sql(path,'SELECT key,value FROM metadata'))
                real_connect = sqlite3.connect
                committed = []
                def connect(value, *args, **kwargs):
                    db = real_connect(value, *args, **kwargs)
                    if str(value).startswith(path.as_uri()+'?') and not committed:
                        committed.append(operation)
                        self.create(current, 'inside-open-'+operation)
                    return db
                with self.subTest(operation=operation), mock.patch.object(sqlite3,'connect',connect):
                    outcome = self.accepted(lambda: self.api().activate(request)) if operation == 'retry' else self.api().activation_readback(request)
                    self.assertEqual(outcome['status'], 'published' if operation == 'retry' else 'published_observed')
                after = dict(self.sql(path,'SELECT key,value FROM metadata'))
                self.assertEqual(committed, [operation])
                self.assertEqual(int(after['commit_seq']),int(before['commit_seq'])+1)
                self.assertNotEqual(after['commit_id'],before['commit_id'])
                print('LIVE_COMMIT', json.dumps(dict(operation=operation,before=before['commit_id'],after=after['commit_id'])),flush=True)

    def test_backup_tolerates_actual_source_commit_inside_open(self):
        real_connect = sqlite3.connect
        committed = []
        before = dict(self.sql(self.path,'SELECT key,value FROM metadata'))
        def connect(value, *args, **kwargs):
            db = real_connect(value, *args, **kwargs)
            if str(value).startswith(self.path.as_uri()+'?') and not committed:
                committed.append(True)
                self.create(self.store,'inside-backup-open')
            return db
        with mock.patch.object(sqlite3,'connect',connect):
            bundle = self.accepted(self.backup)
        manifest = self.api().inspect(bundle['bundle_path'])
        after = dict(self.sql(self.path,'SELECT key,value FROM metadata'))
        self.assertEqual(committed,[True])
        self.assertEqual(int(after['commit_seq']),int(before['commit_seq'])+1)
        self.assertEqual(manifest['metadata']['commit_id'],after['commit_id'])
        self.assertEqual(self.records(Path(bundle['bundle_path'])/'data.sqlite3'),self.records(self.path))

    def test_published_live_database_busy_withholds_binding(self):
        request = self.request()
        self.api().activate(request)
        writer = sqlite3.connect(request['candidate_path'],isolation_level=None)
        writer.execute('BEGIN EXCLUSIVE')
        try:
            started = time.perf_counter()
            error = self.refused(lambda:self.api().activate(request),'DATABASE_BUSY')
            self.assertTrue(error.retryable)
            self.assertLess(time.perf_counter()-started,2.0)
            result = self.api().activation_readback(request)
            self.assertEqual(result['status'],'unconfirmed')
            self.assertNotIn('binding',result)
            self.assertNotIn('observed_binding',result)
        finally:
            writer.rollback()
            writer.close()
        self.assertTrue(self.api().activate(request)['durability_confirmed'])

    def test_readback_cancellation_propagates_and_releases_ownership(self):
        request = self.request()
        self.prepared(request)
        api = self.api()
        with mock.patch.object(api,'_candidate_fixed',side_effect=KeyboardInterrupt('cancel observation')):
            with self.assertRaises(KeyboardInterrupt):
                api.activation_readback(request)
        with api._claim(request) as claim:
            self.assertIsNotNone(claim.fd)
            with api._fence(request,'exclusive',self.io().Timings()):
                pass
        self.assertEqual(api.activation_readback(request)['status'],'prepared')

    def test_exclusive_recovery_fence_requires_both_independent_locks(self):
        api = self.api()
        request = self.request()
        for suffix, operation in (('.lock',fcntl.LOCK_SH),('.runner.lock',fcntl.LOCK_EX)):
            fd = os.open(str(self.anchor)+suffix,os.O_RDWR)
            try:
                fcntl.flock(fd,operation|fcntl.LOCK_NB)
                def acquire():
                    with api._fence(request,'exclusive',self.io().Timings()):
                        pass
                with self.subTest(held=suffix):
                    self.refused(acquire,'AUTHORITY_BUSY')
            finally:
                os.close(fd)

    def test_request_digest_pin_rejects_other_valid_same_lineage_bundle(self):
        first = self.backup(name='first-bundle')
        self.create(self.store,'second-snapshot')
        second = self.backup(name='second-bundle')
        self.assertNotEqual(first['bundle_digest'],second['bundle_digest'])
        request = self.request(second)
        request['bundle_digest'] = first['bundle_digest']
        self.refused(lambda:self.api().activate(request),'BUNDLE_INVALID')
        self.assertFalse(self.control().exists())

    def test_normal_recovery_carries_complete_history_forward(self):
        first = self.api().activate(self.request())
        self.assertTrue(first['history_complete'],'initial complete history must remain complete')
        current = self.opened(first)
        second = self.api().activate(self.request(self.backup(current,'bundle2'),current,name='candidate2'))
        self.assertTrue(second['history_complete'],'normal recovery must carry true forward')

    def test_original_identity_swap_refuses_normal_recovery(self):
        for moment in ('before','during','after-read'):
            with self.subTest(moment=moment), self.isolated() as case:
                request = case.request()
                before = case.anchor.read_bytes()
                saved = case.path.with_suffix('.saved')
                swapped = []
                def swap():
                    case.path.rename(saved)
                    shutil.copy2(saved,case.path)
                    swapped.append([saved.stat().st_ino,case.path.stat().st_ino])
                if moment == 'before':
                    swap()
                real_connect = sqlite3.connect
                real_read = case.io().read_metadata
                def connect(value,*args,**kwargs):
                    db=real_connect(value,*args,**kwargs)
                    if moment == 'during' and str(value).startswith(case.path.as_uri()+'?') and not swapped:
                        swap()
                    return db
                def read(path,*args,**kwargs):
                    result=real_read(path,*args,**kwargs)
                    if moment == 'after-read' and Path(path)==case.path and not swapped:
                        swap()
                    return result
                with mock.patch.object(sqlite3,'connect',connect),mock.patch.object(case.io(),'read_metadata',read):
                    case.refused(lambda:case.api().activate(request),'ORIGINAL_UNAVAILABLE')
                case.assertEqual(len(swapped),1)
                case.assertNotEqual(*swapped[0])
                case.assertEqual(case.anchor.read_bytes(),before)

    def test_published_identity_swap_is_checked_before_metadata(self):
        request=self.request()
        self.api().activate(request)
        path=Path(request['candidate_path'])
        saved=path.with_suffix('.saved')
        real_connect=sqlite3.connect
        queries=[]
        def connect(value,*args,**kwargs):
            db=real_connect(value,*args,**kwargs)
            if str(value).startswith(path.as_uri()+'?'):
                db.set_trace_callback(queries.append)
                path.rename(saved)
                shutil.copy2(saved,path)
            return db
        with mock.patch.object(sqlite3,'connect',connect):
            self.assertEqual(self.api().activation_readback(request)['status'],'unconfirmed')
        self.assertFalse(any('FROM metadata' in statement for statement in queries),
                         'live inode mismatch must refuse before metadata SQL: '+repr(queries))

    def test_prepared_media_reverified_by_fresh_retry_process(self):
        blob = self.ready_media()
        request = self.request()
        self.prepared(request)
        candidate = Path(request['candidate_path']+'.media')/blob.name
        candidate.write_bytes(b'!'*candidate.stat().st_size)
        before = self.anchor.read_bytes()
        cache = self.root/'retry-pycache'
        script = ('import sys,json;sys.path.insert(0,sys.argv[2]);from aim_next.recovery import activate,RecoveryError\n'
                  'try:\n r=activate(json.loads(sys.argv[1]));r={"status":r["status"]}\n'
                  'except RecoveryError as e:\n r={"code":e.code}\n'
                  'r["cache"]=sys.pycache_prefix;print(json.dumps(r))\n')
        result = subprocess.run(['/usr/bin/python3','-I','-X','pycache_prefix='+str(cache),'-c',script,
                                 json.dumps(request),str(Path(__file__).resolve().parents[1])],
                                capture_output=True,text=True,timeout=15)
        self.assertEqual(result.returncode,0,result.stderr)
        observed=json.loads(result.stdout)
        self.assertEqual(observed['cache'],str(cache))
        self.assertEqual(observed.get('code'),'CANDIDATE_INVALID','fresh retry must hash staged media')
        self.assertEqual(self.anchor.read_bytes(),before)

    def test_ordered_candidate_and_control_flushes_precede_publication(self):
        for retry in (False,True):
            with self.subTest(retry=retry), self.isolated() as case:
                blob=case.ready_media()
                request=case.request()
                if retry:
                    case.prepared(request)
                api,io=case.api(),case.io()
                events=[]
                violations=[]
                real_stage,real_flush,real_replace=api._stage_epoch,io.full_flush,os.replace
                def stage(*args,**kwargs):
                    result=real_stage(*args,**kwargs)
                    events.append(('epoch-written',None))
                    return result
                def flush(fd):
                    result=real_flush(fd)
                    events.append(('flushed',io.identity(os.fstat(fd))))
                    return result
                def required(staged_marker=False):
                    path=Path(request['candidate_path'])
                    media=Path(str(path)+'.media')
                    claim=case.claim(request)
                    paths=[path,media/blob.name,media,path.parent,path.parent.parent,claim/'lock',
                           claim/'request.complete.json',claim,case.control()/'header.json',case.control(),case.control().parent]
                    if staged_marker:
                        paths.append(claim/'staged.json')
                    start=next((i for i,e in enumerate(events) if e[0]=='epoch-written'),-1)
                    successful=[e[1] for e in events[start+1:] if e[0]=='flushed']
                    for target in paths:
                        if io.identity(target.stat()) not in successful:
                            violations.append('missing successful post-stage prerequisite '+str(target))
                def replace(source,dest):
                    if Path(dest)==case.claim(request)/'staged.json':
                        required()
                    if Path(dest)==case.anchor:
                        required(True)
                        if io.identity(Path(source).stat()) not in [e[1] for e in events if e[0]=='flushed']:
                            violations.append('missing temporary-anchor flush')
                    result=real_replace(source,dest)
                    events.append(('replace',str(dest)))
                    return result
                with mock.patch.object(api,'_stage_epoch',stage),mock.patch.object(io,'full_flush',flush), \
                        mock.patch.object(os,'replace',replace):
                    case.assertTrue(api.activate(request)['durability_confirmed'])
                case.assertFalse(violations,'flush ordering violations: '+repr(violations))
                print('ORDERED_FLUSH_EVENTS',json.dumps(dict(retry=retry,events=events)),flush=True)


if __name__ == '__main__':
    unittest.main()

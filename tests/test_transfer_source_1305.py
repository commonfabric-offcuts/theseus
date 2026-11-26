from __future__ import annotations

import copy
import hashlib
import http.client
import importlib
import importlib.util
import json
import os
from pathlib import Path
import plistlib
import sqlite3
import subprocess
import sys
import tempfile
import threading
import unittest
import uuid
from unittest import mock

from aim_next import Store, StoreError, initialize
from aim_next import recovery_io as io


class SourceTransferCase(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='transfer1305-')
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name).resolve()
        self.root.chmod(0o700)
        self.path = self.root/'source'/'data.sqlite3'
        self.anchor = self.root/'control'/'authority.json'
        self.info = initialize(self.path, 'transfer-fixture', [
            {'id': 'fixture-owner', 'kind': 'human'}], authority_path=self.anchor)
        self.store = Store(self.path, 'transfer-fixture', expected_binding=self.info['binding'])
        self.create('positive-before-retirement')
        self.medium = self.root/'transport'
        self.medium.mkdir(mode=0o700)
        self.request = dict(v=1, handoff_id=str(uuid.uuid4()),
            source=dict(self.store.binding, instance_id=self.store.instance_id, db_path=str(self.path)),
            destination=dict(machine_id='destination-fixture', reservation_id=str(uuid.uuid4()),
                activation_id=str(uuid.uuid4()), authority_path='/private/destination/authority.json',
                candidate_path='/private/destination/new/data.sqlite3'),
            transport=dict(mount_path=str(self.medium), volume_uuid=str(uuid.uuid4()).upper()),
            bundle_path=str(self.medium/'bundle'))

    def api(self):
        self.assertIsNotNone(importlib.util.find_spec('aim_next.transfer'), 'fenced transfer owner exists')
        return importlib.import_module('aim_next.transfer')

    def command(self, name, store=None):
        store = store or self.store
        return store.command('fixture-owner', dict(v=1, instance_id=store.instance_id,
            operation_id=name, kind='workspace.create', target={},
            expected={'authority': {k: store.binding[k] for k in ('authority_id', 'authority_epoch')}},
            args={'id': name, 'title': name}))

    def create(self, name, store=None):
        result = self.command(name, store)
        self.assertEqual(result['status'], 'committed', result)

    def metadata(self):
        return io.read_metadata(self.path)

    def logical(self):
        db = sqlite3.connect(self.path.as_uri()+'?mode=ro', uri=True)
        try:
            return list(db.iterdump())
        finally:
            db.close()

    def medium_facts(self, request=None):
        return dict(mount_path=str(self.medium), volume_uuid=self.request['transport']['volume_uuid'],
                    device=self.medium.stat().st_dev, uid=os.getuid())

    def export(self, request=None):
        api = self.api()
        with mock.patch.object(api, 'probe_transport', side_effect=self.medium_facts):
            return api.export_source(request or self.request)

    def refused(self, call, code):
        with self.assertRaises(StoreError) as caught:
            call()
        self.assertEqual(caught.exception.code, code, str(caught.exception))
        return caught.exception

    def old_callers_refused(self):
        before = self.logical()
        pair = self.metadata()
        rejected = self.command('retained-old-caller')
        self.assertEqual(rejected['status'], 'rejected', rejected)
        self.assertIs(rejected['recorded'], False)
        self.assertEqual(rejected['error']['code'], 'AUTHORITY_CHANGED')
        self.refused(lambda: Store(self.path, self.store.instance_id,
                                  expected_binding=self.info['binding']), 'AUTHORITY_CHANGED')
        self.refused(lambda: self.store.runner_guard('retired-runner').__enter__(), 'AUTHORITY_CHANGED')
        self.assertEqual(self.metadata(), pair)
        self.assertEqual(self.logical(), before)

    def test_export_preserves_history_and_fences_retained_and_reopened_writers(self):
        before = self.logical()
        metadata = self.metadata()
        result = self.export()
        self.assertEqual(result['status'], 'retired')
        self.assertIs(result['durability_confirmed'], True)
        self.assertEqual(result['source_commit'], {k: metadata[k] for k in ('commit_seq', 'commit_id')})
        self.assertEqual(self.logical(), before)
        self.old_callers_refused()
        receipt, digest = io.read_record(Path(self.request['bundle_path'])/'handoff.json')
        self.assertEqual(receipt, result)
        self.assertEqual(digest, io.digest_record(result))
        api = self.api()
        observation = api.source_readback(self.request)
        self.assertEqual(observation['status'], 'retired_observed')
        self.assertIs(observation['durability_confirmed'], False)
        self.assertNotIn('binding', observation)

    def test_readback_not_started_is_read_only(self):
        before = sorted(str(p.relative_to(self.root)) for p in self.root.rglob('*'))
        self.assertEqual(self.api().source_readback(self.request)['status'], 'not_started')
        self.assertEqual(before, sorted(str(p.relative_to(self.root)) for p in self.root.rglob('*')))

    def test_same_request_retry_returns_exact_receipt(self):
        first = self.export()
        self.assertEqual(self.export(), first)
        self.old_callers_refused()

    def test_retirement_before_receipt_failure_keeps_source_fenced_and_recovers(self):
        api = self.api()
        with mock.patch.object(api, '_write_handoff', side_effect=OSError('receipt publication interrupted')):
            self.refused(self.export, 'TRANSFER_UNCONFIRMED')
        self.old_callers_refused()
        self.assertFalse((Path(self.request['bundle_path'])/'handoff.json').exists())
        self.assertEqual(api.source_readback(self.request)['status'], 'retired_observed')
        result = self.export()
        self.assertTrue(result['durability_confirmed'])
        self.old_callers_refused()

    def test_publication_failure_before_anchor_replace_leaves_source_active(self):
        api = self.api()
        with mock.patch.object(api, '_publish_retirement', side_effect=OSError('before replace')):
            self.refused(self.export, 'TRANSFER_UNCONFIRMED')
        self.assertEqual(io.read_record(self.anchor)[0]['state'], 'active')
        self.assertEqual(api.source_readback(self.request)['status'], 'prepared')
        self.assertTrue(self.export()['durability_confirmed'])

    def test_lost_response_after_anchor_replace_recovers_same_id(self):
        api = self.api()
        original = api._publish_retirement
        def interrupted(*args):
            original(*args)
            raise OSError('lost confirmation after publication')
        with mock.patch.object(api, '_publish_retirement', side_effect=interrupted):
            self.refused(self.export, 'TRANSFER_UNCONFIRMED')
        self.old_callers_refused()
        self.assertTrue(self.export()['durability_confirmed'])

    def test_changed_request_collision_never_changes_retirement(self):
        result = self.export()
        other = copy.deepcopy(self.request)
        other['destination']['machine_id'] = 'another-destination'
        self.refused(lambda: self.export(other), 'REQUEST_MISMATCH')
        self.assertEqual(self.export(), result)

    def test_racing_commit_survives_and_source_is_not_spuriously_retired(self):
        api = self.api()
        original = api.backup
        def racing(*args, **kwargs):
            result = original(*args, **kwargs)
            self.create('racing-commit-survives')
            return result
        with mock.patch.object(api, 'backup', side_effect=racing):
            self.refused(self.export, 'HISTORY_MISMATCH')
        self.assertEqual(self.metadata()['commit_seq'], '2')
        self.assertEqual(io.read_record(self.anchor)[0]['state'], 'active')
        self.create('positive-after-race-refusal')

    def test_runner_guard_is_a_busy_barrier(self):
        with self.store.runner_guard('fixture-runner'):
            self.refused(self.export, 'AUTHORITY_BUSY')
        self.assertEqual(io.read_record(self.anchor)[0]['state'], 'active')
        self.assertTrue(self.export()['durability_confirmed'])

    def test_wrong_source_binding_refuses_before_claim(self):
        request = copy.deepcopy(self.request)
        request['source']['authority_epoch'] = 'different-epoch'
        self.refused(lambda: self.export(request), 'SOURCE_MISMATCH')
        self.assertFalse(Path(str(self.anchor)+'.transfers').exists())

    def test_unencrypted_transport_refuses_before_claim(self):
        api = self.api()
        with mock.patch.object(api, 'probe_transport', side_effect=io.RecoveryError('TRANSPORT_INVALID')):
            self.refused(lambda: api.export_source(self.request), 'TRANSPORT_INVALID')
        self.assertFalse(Path(str(self.anchor)+'.transfers').exists())

    def test_invalid_and_symlink_paths_refuse_without_source_change(self):
        request = copy.deepcopy(self.request)
        link = self.root/'transport-alias'
        link.symlink_to(self.medium, target_is_directory=True)
        request['bundle_path'] = str(link/'bundle')
        self.refused(lambda: self.export(request), 'INVALID_REQUEST')
        request = copy.deepcopy(self.request)
        request['handoff_id'] = 'not-a-uuid'
        self.refused(lambda: self.export(request), 'INVALID_REQUEST')
        self.create('still-active')

    def test_incomplete_claim_is_retained_and_not_reconstructed(self):
        api = self.api()
        root = Path(str(self.anchor)+'.transfers')
        root.mkdir(mode=0o700)
        claim = root/self.request['handoff_id']
        claim.mkdir(mode=0o700)
        self.refused(self.export, 'PREPARATION_INCOMPLETE')
        self.assertTrue(claim.is_dir())
        self.assertEqual(api.source_readback(self.request)['status'], 'incomplete')

    def test_existing_history_gap_is_retained(self):
        record = io.read_record(self.anchor)[0]
        record['recovery']['history_complete'] = False
        self.anchor.write_bytes(io.encode(record))
        self.assertIs(self.export()['history_complete'], False)

    def test_legacy_recovery_and_subprocess_cannot_reopen_retired_source(self):
        self.export()
        from aim_next.recovery import _anchor
        self.refused(lambda: _anchor(self.anchor, self.info['binding']['authority_id'],
                                    self.store.instance_id), 'CONTROL_INVALID')
        script = ('import sys,json;sys.path.insert(0,sys.argv[1]);from aim_next import Store;'
                  'Store(sys.argv[2],sys.argv[3],expected_binding=json.loads(sys.argv[4]))')
        result = subprocess.run([sys.executable, '-I', '-c', script,
            str(Path(__file__).resolve().parents[1]), str(self.path), self.store.instance_id,
            json.dumps(self.info['binding'])], capture_output=True, text=True, timeout=10)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('Binding changed', result.stderr)

    def test_ready_private_media_is_preserved(self):
        media = Path(str(self.path)+'.media')
        media.mkdir(mode=0o700)
        blob = media/'private-fixture'
        data = b'private ready transfer bytes\x00'
        blob.write_bytes(data)
        blob.chmod(0o600)
        db = sqlite3.connect(str(self.path))
        try:
            db.execute('INSERT INTO media_intents VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)',
                ('private', 'fixture-owner', 1, 'ready', 'media-op', self.store.binding['authority_id'],
                 self.store.binding['authority_epoch'], 'private.bin', 'application/octet-stream',
                 len(data), hashlib.sha256(data).hexdigest(), blob.name, 0))
            db.commit()
        finally:
            db.close()
        self.export()
        target = Path(self.request['bundle_path'])/'media'/blob.name
        self.assertEqual(target.read_bytes(), data)
        self.assertEqual(target.stat().st_uid, os.getuid())
        self.assertNotEqual(target.stat().st_ino, blob.stat().st_ino)

    def test_actual_transport_parser_requires_encryption_ownership_and_matching_uuid(self):
        api = self.api()
        facts = dict(MountPoint=str(self.medium), VolumeUUID=self.request['transport']['volume_uuid'],
            FilesystemType='apfs', Internal=False, Encryption=True, EncryptionThisVolumeProper=True,
            Locked=False, GlobalPermissionsEnabled=True, WritableVolume=True)
        def probe(values):
            result = subprocess.CompletedProcess([], 0, plistlib.dumps(values), b'')
            with mock.patch.object(api.subprocess, 'run', return_value=result), \
                 mock.patch.object(api.os.path, 'ismount', return_value=True):
                return api.probe_transport(self.request)
        self.assertEqual(probe(facts)['device'], self.medium.stat().st_dev)
        for key in ('Encryption', 'EncryptionThisVolumeProper', 'GlobalPermissionsEnabled', 'WritableVolume'):
            self.refused(lambda key=key: probe(dict(facts, **{key: False})), 'TRANSPORT_INVALID')
        self.refused(lambda: probe(dict(facts, VolumeUUID='wrong-volume')), 'TRANSPORT_INVALID')

    def test_cli_readback_uses_private_request_and_does_not_create_claim(self):
        self.api()
        request_path = self.root/'request.json'
        io.write_record(request_path, self.request)
        tool = Path(__file__).resolve().parents[1]/'tools'/'transfer_board.py'
        result = subprocess.run([sys.executable, '-I', str(tool), 'source-readback', str(request_path)],
                                capture_output=True, text=True, timeout=10)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(json.loads(result.stdout)['status'], 'not_started')
        self.assertFalse(Path(str(self.anchor)+'.transfers').exists())

    def test_original_cli_profile_reads_then_refuses_after_retirement(self):
        self.api()
        from aim_next.profile import write_profile
        profile = self.root/'fixture.profile.json'
        write_profile(profile, self.path, self.store.instance_id, 'fixture-owner', binding=self.info['binding'])
        cli = Path(__file__).resolve().parents[1]/'bin'/'aim-next'
        argv = [sys.executable, '-I', str(cli), '--profile', str(profile), 'outcomes']
        positive = subprocess.run(argv, capture_output=True, text=True, timeout=10)
        self.assertEqual(positive.returncode, 0, positive.stderr)
        before = profile.read_bytes()
        self.export()
        rejected = subprocess.run(argv, capture_output=True, text=True, timeout=10)
        self.assertEqual(rejected.returncode, 2, rejected.stdout+rejected.stderr)
        self.assertIn('AUTHORITY_CHANGED', rejected.stdout+rejected.stderr)
        self.assertEqual(profile.read_bytes(), before)

    def test_running_http_writer_commits_then_refuses_without_record_changes(self):
        self.api()
        from aim_next.server import create_server
        web = self.root/'web'
        web.mkdir(mode=0o700)
        server = create_server(lambda: self.store, self.store.instance_id, 'fixture-owner', web,
                               port=0, token='isolated-transfer-session')
        thread = threading.Thread(target=server.serve_forever)
        thread.start()
        port = server.server_address[1]
        def command(name):
            payload = dict(v=1, instance_id=self.store.instance_id, operation_id=name,
                kind='workspace.create', target={}, expected={'authority': {
                    k: self.store.binding[k] for k in ('authority_id', 'authority_epoch')}},
                args={'id': name, 'title': name})
            connection = http.client.HTTPConnection('127.0.0.1', port, timeout=5)
            try:
                connection.request('POST', '/api/command', body=json.dumps(payload), headers={
                    'Origin': 'http://127.0.0.1:'+str(port), 'Content-Type': 'application/json',
                    'Authorization': 'Bearer isolated-transfer-session'})
                response = connection.getresponse()
                return response.status, json.loads(response.read())
            finally:
                connection.close()
        try:
            status, positive = command('positive-http-writer')
            self.assertEqual(status, 200, positive)
            self.assertEqual(positive['status'], 'committed')
            self.export()
            before = self.logical()
            status, rejected = command('refused-http-writer')
            self.assertEqual(status, 200, rejected)
            self.assertEqual(rejected['status'], 'rejected')
            self.assertEqual(rejected['error']['code'], 'AUTHORITY_CHANGED')
            self.assertFalse(rejected['recorded'])
            self.assertEqual(self.logical(), before)
        finally:
            server.shutdown()
            server.server_close()
            thread.join(2)
            self.assertFalse(thread.is_alive())

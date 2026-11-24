from __future__ import annotations

"""1200 Core/queue evidence in temporary authorities; these are not native checks."""

import concurrent.futures
import io
import json
import os
from pathlib import Path
import sqlite3
import subprocess
import sys
import unittest
from unittest.mock import patch

from aim_next import Store, cli
from aim_next.contract import Refusal
from aim_next.profile import write_profile
from aim_next import hosted_notice, migrations
import test_store as fixtures


A, B = 'a' * 40, 'b' * 40


class BrowserJobs1200(unittest.TestCase):
    setUp = fixtures.StoreCase.setUp
    command = fixtures.StoreCase.command
    workspace = fixtures.StoreCase.workspace
    sql = fixtures.StoreCase.sql
    save_draft = fixtures.StoreCase.save_draft
    prepare = fixtures.StoreCase.prepare
    create_topic = fixtures.StoreCase.create_topic

    def setup_jobs(self, configure=True, checks=None):
        self.source = self.create_topic()
        self.ok(self.command('pipeline.configure', {'enabled': True, 'ships_in_releases': True},
                             {'workspace_id': 'w1'}, {'pipeline_revision': 0}))
        if configure:
            self.configure(checks or [self.mapping()])

    def ok(self, answer):
        self.assertEqual(answer.get('status'), 'committed', answer)
        return answer['result']

    committed = ok

    def rejected(self, answer, code):
        self.assertEqual(answer.get('error', {}).get('code'), code, answer)
        return answer

    def mapping(self, check='hotkey-health', owner='agent-a', items=None):
        return dict(check_id=check, name='An isolated native obligation', owner_id=owner,
                    topic_id='t1', repository='https://example.test/retained.git',
                    ref='refs/heads/isolated-source', items=items or [])

    def configure(self, checks):
        current = self.store.view('owner', 'browser_catalog', {'workspace_id': 'w1'})
        self.assertNotIn('error', current, current)
        return self.ok(self.command('browser_catalog.set', {'checks': checks, 'source_message_id': self.source['id']},
                                   {'workspace_id': 'w1'}, {'catalog_revision': current['catalog']['revision']}))

    def record(self, number=398, head=A, items=None):
        record = dict(release=number, commit=head, deployed_at='2026-11-24T07:49:00-08:00',
                      items=[1160] if items is None else items, source='deploy')
        return record, self.store.record_release(record)

    def jobs(self, actor='owner', **args):
        answer = self.store.view(actor, 'browser_jobs', dict(workspace_id='w1', **args))
        self.assertNotIn('error', answer, answer)
        return answer

    def job(self, identity, actor='agent-a'):
        answer = self.store.view(actor, 'browser_job', {'id': identity})
        self.assertNotIn('error', answer, answer)
        return answer['job']

    def act(self, name, job, args=None, actor='agent-a', op=None):
        return self.command('browser_job.' + name, args or {}, {'browser_job_id': job['id']},
                            {'job_revision': job['version']}, actor=actor, op=op)

    def claim(self, job, op=None):
        return self.ok(self.act('claim', job, op=op))['job']

    def bind(self, job, pid=12345, started='synthetic isolated child identity'):
        return self.ok(self.act('child', job, {'attempt_id': job['attempt_id'], 'pid': pid, 'started_at': started}))['job']

    def finish_args(self, job, outcome='passed', **changes):
        child = job['child']
        terminal = (dict(pid=child['pid'], started_at=child['started_at'], status=0, cleanup='confirmed')
                    if child else {'not_started': True})
        return dict(attempt_id=job['attempt_id'], source_sha=job['source_sha'], outcome=outcome,
                    evidence='isolated evidence receipt', child_terminal=terminal, fix_piece_id=None, **changes)

    def job_deliveries(self, actor='agent-a'):
        answer = self.store.view(actor, 'deliveries', {})
        self.assertNotIn('error', answer, answer)
        return [item for item in answer['items'] if item.get('browser_job')]

    def test_release_record_creates_exact_jobs_and_retry_cannot_duplicate_them(self):
        self.setup_jobs(checks=[self.mapping(items=[1160]), self.mapping('clipboard-selection-feedback', items=[1190])])
        record, first = self.record()
        [job] = self.jobs()['items']
        self.assertEqual((job['release_number'], job['source_sha'], job['check_id'], job['state']),
                         (398, A, 'hotkey-health', 'pending'))
        self.assertTrue(job['unrun'])
        self.assertFalse(job['browser_verified'])
        deliveries = self.job_deliveries()
        self.assertEqual(len(deliveries), 1)
        self.assertEqual(self.store.record_release(record)['release'], first['release'])
        self.assertFalse(self.store.record_release(record)['recorded'])
        self.assertEqual(self.jobs()['items'], [job])
        self.assertEqual(self.job_deliveries(), deliveries)
        self.record(399, B, [1190])
        self.assertEqual({(j['release_number'], j['check_id']) for j in self.jobs()['items']},
                         {(398, 'hotkey-health'), (399, 'clipboard-selection-feedback')})

    def test_release_job_and_queue_roll_back_together_then_retry_creates_once(self):
        self.setup_jobs()
        original = self.store._queue_delivery
        def fail_after_queue(*args, **kwargs):
            result = original(*args, **kwargs)
            if kwargs.get('browser_job_id'):
                raise Refusal('ISOLATED_QUEUE_FAILURE', 'Applied fixture failure after the actual queue insert')
            return result
        with patch.object(self.store, '_queue_delivery', side_effect=fail_after_queue):
            with self.assertRaises(Refusal):
                self.record()
        self.assertEqual(self.sql('SELECT count(*) FROM releases'), [(0,)])
        self.assertEqual(self.sql('SELECT count(*) FROM browser_jobs'), [(0,)])
        self.assertEqual(self.job_deliveries(), [])
        self.record()
        self.assertEqual((len(self.jobs()['items']), len(self.job_deliveries())), (1, 1))

    def test_reopen_and_removed_worktree_preserve_job_and_exact_source_recovery(self):
        self.setup_jobs()
        self.record()
        [before] = self.jobs()['items']
        source = Path(self.temp.name) / 'finished-worktree'
        source.mkdir()
        (source / 'scratch').write_bytes(b'isolated source tree removed after its read')
        (source / 'scratch').unlink()
        source.rmdir()
        self.store = Store(self.path, 'test-instance', expected_binding=self.binding)
        self.assertEqual(self.job(before['id']), before)
        mapping = before['definition']['mapping']
        self.assertEqual((mapping['repository'], mapping['ref'], before['source_sha']),
                         ('https://example.test/retained.git', 'refs/heads/isolated-source', A))
        self.assertEqual(self.job_deliveries()[0]['browser_job']['id'], before['id'])
        self.assertEqual(self.sql('SELECT count(*) FROM browser_jobs'), [(1,)])

    def test_owner_missing_is_explicit_then_sourced_assignment_wakes_actual_owner(self):
        self.setup_jobs(checks=[self.mapping(owner=None)])
        self.record()
        [job] = self.jobs()['items']
        self.assertEqual((job['owner_id'], job['mapping_problem'], job['next_action']),
                         (None, 'unassigned_owner', 'assign_mapping'))
        self.rejected(self.act('claim', job), 'FORBIDDEN')
        self.configure([self.mapping(owner='agent-b')])
        assigned = self.ok(self.act('assign', job, actor='owner'))['job']
        self.assertEqual((assigned['owner_id'], assigned['mapping_problem']), ('agent-b', None))
        self.assertEqual(assigned['original_definition']['mapping']['owner_id'], None)
        self.assertEqual(self.job_deliveries('agent-a'), [])
        [delivery] = self.job_deliveries('agent-b')
        self.assertEqual(delivery['browser_job']['id'], job['id'])

    def test_required_native_definition_without_catalog_is_not_silently_dropped(self):
        self.setup_jobs(configure=False)
        current = self.store.view('owner', 'outcome_checks', {'workspace_id': 'w1'})
        revision = current['relevant_versions']['checks']
        self.ok(self.command('check.define', {'check': dict(check_id='native', name='Required native', group_name='Browser', kind='pass',
                                                           source='release-check:native', left_by_topic_id='t1')},
                             {'workspace_id': 'w1'}, {'checks_revision': revision}))
        self.record()
        [job] = self.jobs()['items']
        self.assertEqual((job['check_id'], job['owner_id'], job['mapping_problem']),
                         ('native', None, 'check_owner_mapping_unknown'))
        self.assertEqual(self.job_deliveries()[0]['browser_job']['id'], job['id'])

    def test_topic_only_owner_has_explicit_mapping_task_until_outcome_access_returns(self):
        self.setup_jobs(checks=[self.mapping(owner='agent-b')])
        self.ok(self.command('participation.set', {'actor_id': 'agent-b', 'present': True},
                             {'topic_id': 't1'}))
        self.sql('DELETE FROM workspace_members WHERE workspace_id=? AND actor_id=?', ('w1', 'agent-b'))
        self.assertNotIn('error', self.store.view('agent-b', 'topic', {'topic_id': 't1'}))
        self.assertEqual(self.store.view('agent-b', 'workspace', {'workspace_id': 'w1'})['error']['code'], 'FORBIDDEN')
        self.record()
        [job] = self.jobs()['items']
        self.assertEqual((job['owner_id'], job['recipient_id'], job['mapping_problem']),
                         ('agent-b', 'agent-a', 'owner_access_unavailable'))
        self.assertEqual(self.job_deliveries('agent-b'), [])
        self.assertEqual(self.job_deliveries('agent-a')[0]['browser_job']['id'], job['id'])
        self.sql('INSERT INTO workspace_members(workspace_id,actor_id) VALUES (?,?)', ('w1', 'agent-b'))
        assigned = self.ok(self.act('assign', job, actor='owner'))['job']
        self.assertEqual((assigned['owner_id'], assigned['recipient_id'], assigned['mapping_problem']),
                         ('agent-b', 'agent-b', None))
        self.assertEqual(self.job_deliveries('agent-a'), [])
        self.assertEqual(self.job_deliveries('agent-b')[0]['browser_job']['id'], job['id'])

    def test_malformed_repository_is_an_input_refusal_without_replacing_catalog(self):
        self.setup_jobs()
        before = self.store.view('owner', 'browser_catalog', {'workspace_id': 'w1'})['catalog']
        mapping = dict(self.mapping(), repository='https://[malformed')
        answer = self.command('browser_catalog.set', {'checks': [mapping], 'source_message_id': self.source['id']},
                              {'workspace_id': 'w1'}, {'catalog_revision': before['revision']}, op='malformed-repository')
        self.rejected(answer, 'INVALID_ARGUMENT')
        self.assertFalse(answer['recorded'])
        self.assertEqual(self.store.view('owner', 'operation', {'operation_id': 'malformed-repository'})['status'], 'unknown')
        self.assertEqual(self.store.view('owner', 'browser_catalog', {'workspace_id': 'w1'})['catalog'], before)

    def test_non_string_outcomes_refuse_without_changing_original_running_job(self):
        self.setup_jobs()
        self.record()
        job = self.bind(self.claim(self.jobs()['items'][0]))
        for value in ([], {}, None, 42, True):
            with self.subTest(outcome=value):
                answer = self.act('finish', job, self.finish_args(job, value))
                self.rejected(answer, 'INVALID_ARGUMENT')
                self.assertFalse(answer['recorded'])
                self.assertEqual(self.job(job['id']), job)

    def test_competing_claims_record_one_attempt(self):
        self.setup_jobs()
        self.record()
        [job] = self.jobs()['items']
        with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
            answers = list(pool.map(lambda op: self.act('claim', job, op=op), ['claim-left', 'claim-right']))
        self.assertEqual(sum(a['status'] == 'committed' for a in answers), 1, answers)
        self.assertEqual([a['error']['code'] for a in answers if a['status'] != 'committed'], ['REVISION_CONFLICT'])
        claimed = self.job(job['id'])
        self.assertEqual((claimed['state'], claimed['version']), ('running', 2))
        self.assertIsNotNone(claimed['attempt_id'])
        self.assertEqual(self.sql('SELECT count(DISTINCT attempt_id) FROM browser_jobs'), [(1,)])

    def test_lost_claim_answer_replays_original_operation_across_store_reopen(self):
        self.setup_jobs()
        self.record()
        [job] = self.jobs()['items']
        first = self.act('claim', job, op='original-claim')
        self.ok(first)
        self.store = Store(self.path, 'test-instance', expected_binding=self.binding)
        self.assertEqual(self.act('claim', job, op='original-claim'), first)
        current = self.job(job['id'])
        self.rejected(self.act('claim', current, op='replacement-claim'), 'BROWSER_ATTEMPT_EXISTS')
        self.rejected(self.act('claim', current, op='original-claim'), 'OPERATION_PAYLOAD_MISMATCH')
        self.assertEqual(self.store.view('agent-a', 'operation', {'operation_id': 'original-claim'}), first)

    def test_unknown_result_keeps_child_identity_and_forbids_a_new_spawn_claim(self):
        self.setup_jobs()
        self.record()
        job = self.bind(self.claim(self.jobs()['items'][0]))
        identity = job['child']
        args = self.finish_args(job, 'unknown')
        args['child_terminal'] = None
        unknown = self.ok(self.act('finish', job, args))['job']
        self.store = Store(self.path, 'test-instance', expected_binding=self.binding)
        recovered = self.job(job['id'])
        self.assertEqual((recovered['child'], recovered['attempt_id']), (identity, job['attempt_id']))
        self.assertEqual(recovered['next_action'], 'reconcile_original_child')
        self.assertFalse(recovered['browser_verified'])
        self.rejected(self.act('claim', recovered), 'BROWSER_ATTEMPT_EXISTS')
        self.rejected(self.command('delivery.ack', target={'delivery_id': self.job_deliveries()[0]['id']}, actor='agent-a'),
                      'BROWSER_JOB_UNFINISHED')
        self.assertEqual(self.job(job['id']), unknown)

    def test_wrong_source_attempt_or_cleanup_cannot_create_a_pass(self):
        self.setup_jobs()
        self.record()
        job = self.bind(self.claim(self.jobs()['items'][0]))
        for field, value, code in [('source_sha', B, 'BROWSER_RESULT_IDENTITY'),
                                   ('attempt_id', 'another-attempt', 'BROWSER_RESULT_IDENTITY'),
                                   ('child_terminal', None, 'BROWSER_CHILD_UNCONFIRMED')]:
            with self.subTest(field=field):
                args = self.finish_args(job)
                args[field] = value
                self.rejected(self.act('finish', job, args), code)
                self.assertEqual(self.job(job['id']), job)
        args = self.finish_args(job)
        args['child_terminal']['cleanup'] = 'unconfirmed'
        self.rejected(self.act('finish', job, args), 'BROWSER_CHILD_UNCONFIRMED')

    def test_physical_child_terminal_and_result_survive_lost_answer_without_duplicate(self):
        self.setup_jobs()
        self.record()
        job = self.claim(self.jobs()['items'][0])
        child = subprocess.Popen([sys.executable, '-I', '-c', 'import sys; sys.stdin.buffer.read()'],
                                 stdin=subprocess.PIPE, start_new_session=True)
        try:
            observation = subprocess.run(['ps', '-p', str(child.pid), '-o', 'lstart='], capture_output=True, text=True,
                                         check=True, timeout=5).stdout.strip()
            self.assertTrue(observation)
            job = self.bind(job, child.pid, observation)
            child.stdin.close()
            status = child.wait(timeout=5)
            self.assertEqual(status, 0)
            with self.assertRaises(ProcessLookupError):
                os.killpg(child.pid, 0)
            first = self.act('finish', job, self.finish_args(job), op='original-result')
            passed = self.ok(first)['job']
            self.store = Store(self.path, 'test-instance', expected_binding=self.binding)
            self.assertEqual(self.act('finish', job, self.finish_args(job), op='original-result'), first)
            self.assertEqual(self.job(job['id']), passed)
            self.assertTrue(passed['browser_verified'])
            self.assertEqual(passed['result']['evidence'], 'isolated evidence receipt')
            delivery = self.job_deliveries()[0]
            self.ok(self.command('delivery.ack', target={'delivery_id': delivery['id']}, actor='agent-a'))
            self.assertEqual(self.job_deliveries(), [])
            print(json.dumps(dict(case='1200 physical nonbrowser child', pid=child.pid, started_at=observation,
                                  direct_status=status, reaped=True, owned_group_empty=True)))
        finally:
            if child.stdin and not child.stdin.closed:
                child.stdin.close()
            try:
                child.wait(timeout=5)
            except subprocess.TimeoutExpired:
                child.kill()
                child.wait(timeout=5)

    def test_no_child_can_only_be_explicitly_unrun_and_ack_does_not_make_it_passed(self):
        self.setup_jobs()
        self.record()
        job = self.claim(self.jobs()['items'][0])
        self.rejected(self.act('finish', job, self.finish_args(job)), 'BROWSER_CHILD_UNCONFIRMED')
        unrun = self.ok(self.act('finish', job, self.finish_args(job, 'unrun')))['job']
        self.assertEqual((unrun['state'], unrun['unrun'], unrun['browser_verified']), ('unrun', True, False))
        self.ok(self.command('delivery.ack', target={'delivery_id': self.job_deliveries()[0]['id']}, actor='agent-a'))
        self.assertEqual(self.job(job['id'])['state'], 'unrun')

    def test_actual_stopped_control_survives_restart_and_job_delivery_stays_pending(self):
        self.setup_jobs()
        self.record()
        binding = dict(self.binding, instance_id='test-instance', actor_id='agent-a', db_path=str(self.path))
        control = dict(v=1, binding=binding, owner_id='owner', desired='stopped', revision=1, changed_ms=1)
        with sqlite3.connect(str(self.path)) as db:
            db.execute('INSERT INTO metadata(key,value) VALUES (?,?)', ('hosted_control.v1:agent-a', json.dumps(control)))
        self.store = Store(self.path, 'test-instance', expected_binding=self.binding)
        [job] = self.jobs()['items']
        self.rejected(self.act('claim', job), 'BROWSER_OWNER_STOPPED')
        self.assertEqual(len(self.job_deliveries()), 1)
        self.assertEqual(json.loads(self.sql('SELECT value FROM metadata WHERE key=?', ('hosted_control.v1:agent-a',))[0][0]), control)

    def test_delivery_notice_and_cli_expose_typed_job_without_forging_a_message(self):
        self.setup_jobs()
        self.record()
        [delivery] = self.job_deliveries()
        self.assertIsNone(delivery['message_id'])
        self.assertEqual(delivery['source_ref']['kind'], 'browser_job')
        notice = hosted_notice.notice([delivery], None, 'agent-a', 'isolated-attempt')
        text = notice['input'][0]['text']
        self.assertIn('aim-next browser-job ' + delivery['browser_job']['id'], text)
        self.assertIn(A, text)
        self.assertNotIn('from agent-a, message', text)
        self.assertEqual(self.sql('SELECT count(*) FROM messages'), [(1,)])
        profile = Path(self.temp.name) / 'agent.json'
        write_profile(profile, str(self.path), 'test-instance', 'agent-a', binding=self.binding)
        for args in [['browser-job', delivery['browser_job']['id']], ['browser-jobs', 'w1'], ['inbox']]:
            out, err = io.StringIO(), io.StringIO()
            self.assertEqual(cli.main(['--profile', str(profile)] + args, stdout=out, stderr=err), 0, err.getvalue())
            self.assertIn(delivery['browser_job']['id'], out.getvalue())

    def test_scoped_paging_and_unknown_mapping_never_grant_another_owner_execution(self):
        self.setup_jobs(checks=[self.mapping('one'), self.mapping('two'), self.mapping('three')])
        self.record()
        page = self.jobs(limit=2)
        self.assertEqual(len(page['items']), 2)
        tail = self.jobs(limit=2, cursor=page['next_cursor'])
        self.assertEqual(len(tail['items']), 1)
        self.assertIsNone(tail['next_cursor'])
        self.assertEqual(len({j['id'] for j in page['items'] + tail['items']}), 3)
        self.rejected(self.act('claim', page['items'][0], actor='agent-b'), 'FORBIDDEN')
        self.store.register_actor('outsider', 'agent', 'Isolated outsider')
        answer = self.store.view('outsider', 'browser_job', {'id': page['items'][0]['id']})
        self.assertEqual(answer['error']['code'], 'FORBIDDEN')

    def test_reconcile_old_release_is_explicit_and_keeps_the_immutable_release(self):
        self.setup_jobs(configure=False)
        record, original = self.record()
        self.assertEqual(self.jobs()['items'], [])
        self.configure([self.mapping()])
        first = self.ok(self.command('browser_jobs.reconcile', {'release': 398}, {'workspace_id': 'w1'}))
        self.assertEqual(len(first['created']), 1)
        second = self.ok(self.command('browser_jobs.reconcile', {'release': 398}, {'workspace_id': 'w1'}))
        self.assertEqual(second['created'], [])
        self.assertEqual(self.store.record_release(record)['release'], original['release'])

    def test_browser_identity_database_guards_and_occupied_downgrade(self):
        self.setup_jobs()
        self.record()
        [job] = self.jobs()['items']
        for statement, values in [('UPDATE browser_jobs SET source_sha=? WHERE id=?', (B, job['id'])),
                                  ('DELETE FROM browser_jobs WHERE id=?', (job['id'],))]:
            with self.subTest(statement=statement), self.assertRaises(sqlite3.IntegrityError):
                self.sql(statement, values)
        with self.assertRaises(migrations.MigrationError):
            migrations.migrate(self.path, 'test-instance', self.binding, target='69')
        self.assertEqual(self.job(job['id']), job)
        self.assertEqual(self.sql('PRAGMA foreign_key_check'), [])

    def test_failed_result_links_to_an_actual_fix_piece_after_the_failure(self):
        self.setup_jobs()
        self.record()
        job = self.bind(self.claim(self.jobs()['items'][0]))
        args = self.finish_args(job, 'failed')
        args['child_terminal']['status'] = 1
        failed = self.ok(self.act('finish', job, args))['job']
        pipeline = self.store.view('owner', 'pipeline', {'workspace_id': 'w1'})['pipeline']
        self.ok(self.command('pipeline.stages_set', {'stages': [{'stage_id': 'build', 'name': 'Build'}]},
                             {'workspace_id': 'w1'}, {'pipeline_revision': pipeline['version']}))
        number = self.ok(self.command('pipeline.item_add', {'title': 'Isolated fix', 'size': 'small', 'section': 'now',
                                                           'sources': [{'note': 'Failure of isolated browser job'}]},
                                      {'workspace_id': 'w1'}))['number']
        from test_build_topics import BuildTopicsCase
        BuildTopicsCase.topic(self, 'fix-topic')
        piece = self.ok(self.command('pipeline.piece_start', {'numbers': [number], 'topic_id': 'fix-topic', 'stage_id': 'build'},
                                    {'workspace_id': 'w1'}))['piece_id']
        linked = self.ok(self.act('fix', failed, {'fix_piece_id': piece}))['job']
        self.assertEqual((linked['fix_piece_id'], linked['state'], linked['result']), (piece, 'failed', failed['result']))
        self.assertFalse(linked['browser_verified'])

    def test_empty_job_migration_round_trip_preserves_ordinary_delivery_bytes(self):
        self.setup_jobs(configure=False)
        columns = 'seq,id,message_id,recipient_id,group_id,state,topic_id,revision,request_id,answer_id,retraction_id'
        before = self.sql('SELECT ' + columns + ' FROM deliveries ORDER BY seq')
        reasons = self.sql('SELECT * FROM delivery_reasons ORDER BY delivery_id,reason')
        migrations.migrate(self.path, 'test-instance', self.binding, target='69')
        self.assertEqual(self.sql('SELECT ' + columns + ' FROM deliveries ORDER BY seq'), before)
        self.assertEqual(self.sql('SELECT * FROM delivery_reasons ORDER BY delivery_id,reason'), reasons)
        migrations.migrate(self.path, 'test-instance', self.binding, target='70')
        self.assertEqual(self.sql('SELECT ' + columns + ' FROM deliveries ORDER BY seq'), before)
        self.assertEqual(self.sql('SELECT * FROM delivery_reasons ORDER BY delivery_id,reason'), reasons)
        self.assertEqual(self.sql('PRAGMA foreign_key_check'), [])
        self.assertEqual(self.jobs()['items'], [])

    def test_1201_migration_uses_the_actual_five_second_writer_connection(self):
        # Read the real selected SQLite setting, rather than a call-name assertion.
        from aim_next import store as store_module
        connect, observed = store_module._connect, []
        def inspect(*args, **kwargs):
            db, actual = connect(*args, **kwargs)
            observed.append((actual['busy_timeout'], db.execute('PRAGMA busy_timeout').fetchone()[0]))
            return db, actual
        with patch.object(store_module, '_connect', side_effect=inspect):
            migrations.migrate(self.path, 'test-instance', self.binding)
        self.assertTrue(observed)
        self.assertEqual(observed, [(5000, 5000)])


if __name__ == '__main__':
    unittest.main()

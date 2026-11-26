from __future__ import annotations

import copy
import fcntl
import importlib.util
import json
import os
from pathlib import Path
import sqlite3
import subprocess
import tempfile
import unittest
from unittest import mock

from aim_next import (Store, backup, broker_routes, destination_profiles as profiles,
                      profile, recovery_io as io, relocation, relocation_cutover as cutover,
                      relocation_publication as publication, relocation_stage as stage, route_pins)
from aim_next.authority import AuthorityError
import test_authority_relocation as fixture

AVAILABLE = importlib.util.find_spec('aim_next.destination_broker') is not None
if AVAILABLE: from aim_next import destination_broker as broker
EVIDENCE = {'preservation': [], 'staged': [], 'prohibited_outputs': [], 'shell': [], 'flush_faults': [], 'startup_refusals': []}
THREADS = {'queue-a':'11111111-2222-4333-8444-555555555555', 'queue-b':'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee'}


class Availability(unittest.TestCase):
    def test_cold_broker_api_exists(self):
        self.assertTrue(AVAILABLE, '1331 cold broker API is absent; not behavioral parity')


@unittest.skipUnless(AVAILABLE, '1331 absent; behavior bodies and targets are unreached')
class BrokerCase(unittest.TestCase):
    def new_case(self, label='A', same_destination=False):
        real=tempfile.TemporaryDirectory
        def temporary(*args,**kwargs):
            kwargs.update(prefix=".1331 "+label+" λ's $(printf no) `echo no`; [x]-",dir=str(Path(__file__).resolve().parents[1]))
            return real(*args,**kwargs)
        fx=fixture.RelocationCase('test_no_active_database_and_original_lost_response_outcome_remains_identical')
        self.addCleanup(fx.doCleanups)
        with mock.patch.object(tempfile,'TemporaryDirectory',side_effect=temporary):fx.setUp()
        old_profiles=fx.root/'old profiles';old_profiles.mkdir(mode=0o700)
        configs=fx.root/'old configs';configs.mkdir(mode=0o700)
        home=fx.root/'old home';home.mkdir(mode=0o700);cwd=fx.root/'old cwd';cwd.mkdir(mode=0o700)
        authority={k:fx.binding[k] for k in ('authority_id','authority_epoch')}
        def add(name,operation):
            with sqlite3.connect(str(fx.db)) as db:version=db.execute("SELECT version FROM workspaces WHERE id='private-work'").fetchone()[0]
            result=fx.store.command('fixture-owner',dict(v=1,instance_id=fx.store.instance_id,operation_id=operation,
                kind='workspace.hosted_seat_add',target={'workspace_id':'private-work'},expected={'authority':authority,'workspace_revision':version},
                args={'name':name,'role':'Keep exact old role λ.  '}))
            self.assertEqual(result['status'],'committed',result);return result['result']['agent']['id']
        managed=add('Preserved human seat','preserve-managed-seat')
        with fx.store.runner_guard('old-provision') as guard:
            fx.store.provision_route_pin(guard,managed,dict(kind='codex-hosted-stdio',protocol_version=1,
                codex_home=str(home),thread_id='99999999-2222-4333-8444-555555555555'),owner_id='fixture-owner')
        stopped=fx.store.command('fixture-owner',dict(v=1,instance_id=fx.store.instance_id,operation_id='keep-managed-stopped',
            kind='agent.execution',target={'actor_id':managed},expected={'authority':authority,'execution_revision':1},args={'desired':'stopped'}))
        self.assertEqual(stopped['status'],'committed',stopped)
        plan=dict(profile=str(old_profiles/'managed.profile.json'),config=str(configs/'managed.hosted.json'),cwd=str(cwd),cli='/retained/old CLI',
                  codex_home=str(home),codex_executable='/usr/bin/python3',model='retained-model',reasoning_effort='high',permission_mode='full')
        with fx.store.runner_guard('plan-fixture') as guard:
            token=fx.store.acquire_runner(guard)['runner_token'];seat=fx.store.hosted_seat_claim(guard,token)['seat']
            self.assertEqual(seat['agent_id'],managed)
            fx.store.hosted_seat_step(guard,token,seat['id'],seat['version'],'profile',{'plan':plan})
        io.write_record(configs/'managed-request.json',{'seat_id':seat['id'],'plan':plan})
        self.assertEqual(add('Queue a','queue-a-for-ending-fixture'),'queue-a')
        fx.store.register_actor('queue-b','agent','Queue b')
        source_rows=[];source_configs={}
        for actor in THREADS:
            thread=THREADS['queue-a'] if same_destination else THREADS[actor]
            destination=dict(kind='codex-queue-stdio',protocol_version=1,codex_home=str(home),thread_id=thread)
            with fx.store.runner_guard('old-queue-provision') as guard:fx.store.provision_route_pin(guard,actor,destination)
            old=old_profiles/(actor+'.profile.json');profile.write_profile(old,fx.db,fx.store.instance_id,actor,binding=fx.binding)
            outbox=old_profiles/(actor+'.outbox');outbox.mkdir(mode=0o700)
            io.write_record(outbox/'saved-request.json',{'operation_id':'old-opaque-'+actor,'binding':fx.binding,'exact':'preserve private original'})
            source_rows.append(dict(source_path=str(old),source_bytes=old.read_text(),outbox_parent=str(old_profiles)))
            config=configs/(actor+'.broker.json');route=configs/(actor+'.route.json')
            value=dict(v=1,profile=str(old),codex_executable='/usr/bin/python3' if actor=='queue-a' else '/bin/sh',destination=destination)
            io.write_record(config,value);io.write_record(route,dict(v=1,profile=str(old),argv=['/retained/old broker','--config',str(config)]))
            source_configs[actor]=dict(actor_id=actor,source_route_path=str(route),source_route_bytes=route.read_text(),
                                      source_config_path=str(config),source_config_bytes=config.read_text())
        fresh=backup.backup(fx.db,fx.store.instance_id,expected_binding=fx.binding,bundle_path=str(fx.root/'fresh bundle'))
        metadata=backup.inspect(fresh['bundle_path'])['metadata'];prep=copy.deepcopy(fx.request)
        prep.update(bundle_path=fresh['bundle_path'],bundle_digest=fresh['bundle_digest'],commit=dict(seq=metadata['commit_seq'],id=metadata['commit_id']))
        prep['owners']['destination_uid']=os.getuid();relocation.prepare(prep)
        intent_root=fx.root/'intents';intent_root.mkdir(mode=0o700)
        intent_request=dict(v=1,preparation=prep,journal_root=str(intent_root));intent=publication.prepare_publication_intent(intent_request)['intent']
        stage_root=fx.root/'stages';stage_root.mkdir(mode=0o700)
        stage_request=dict(v=1,intent_request=intent_request,intent_digest=io.digest_record(intent),journal_root=str(stage_root));staged=stage.stage_relocation(stage_request)
        cutovers=fx.root/'cutovers';cutovers.mkdir(mode=0o700)
        cutover_request=dict(v=1,stage_request=stage_request,stage_digest=io.digest_record(staged['stage']),journal_root=str(cutovers));receipt=cutover.publish_relocation(cutover_request);binding=receipt['binding']
        current=Store(binding['db_path'],binding['instance_id'],expected_binding={k:binding[k] for k in profile.BINDING_FIELDS});destination=Path(binding['db_path']).parent
        pr=dict(v=1,destination_root=str(destination),output_dir=str(destination/'profiles λ'),publication_digest=io.digest_record(receipt),profiles=source_rows)
        result=profiles.stage_destination_profiles(current,receipt,pr);raw=Path(result['manifest_path']).read_text()
        selected=fx.root/"explicit broker λ's $(printf bad) `echo bad`; [x]";log=fx.root/'argv.json';repo=str(Path(__file__).resolve().parents[1])
        selected.write_text('#!/usr/bin/python3 -I\nimport json,sys\nfrom pathlib import Path\n'
            +'sys.path.insert(0,'+repr(repo)+')\nfrom aim_next.profile import load_profile\n'
            +'config=json.loads(Path(sys.argv[2]).read_text())\np=load_profile(config["profile"])\n'
            +'v={"argv":sys.argv[1:],"config":config,"binding":dict(p.binding,actor_id=p.actor_id,instance_id=p.instance_id,db_path=str(p.db_path))}\n'
            +'Path('+repr(str(log))+').write_text(json.dumps(v))\nprint(json.dumps(v))\n');selected.chmod(0o700)
        rows=[dict(source_configs['queue-a'],broker_executable=str(selected))]
        request=dict(v=1,output_root=str(destination),output_dir=str(destination/"broker λ's $() [x]"),profiles_request=pr,
            profiles_result=result,profiles_manifest_bytes=raw,profiles_manifest_digest=__import__('hashlib').sha256(raw.encode()).hexdigest(),actors=rows)
        return dict(fx=fx,store=current,receipt=receipt,request=request,configs=source_configs,cli=selected,log=log,managed=managed)

    def use(self,case):
        self.case=case;self.store=case['store'];self.receipt=case['receipt'];self.request=case['request']

    def setUp(self):
        self.use(self.new_case())

    def output(self,request=None):return Path((request or self.request)['output_dir'])

    def call(self,request=None,receipt=None):
        result=broker.stage_destination_broker(self.store,receipt or self.receipt,request or self.request)
        EVIDENCE['staged'].append({'test':self.id(),'result':result});return result

    def rejected(self,request=None,receipt=None,code=None):
        request=request or self.request
        try:result=self.call(request,receipt)
        except (io.RecoveryError,AuthorityError,route_pins.RoutePinError) as error:
            if code:self.assertEqual(error.code,code)
            return error
        out=self.output(request);documents={p.name:json.loads(p.read_text()) for p in out.glob('*.broker.json')}
        EVIDENCE['prohibited_outputs'].append({'test':self.id(),'result':result,'output_exists':out.exists(),'documents':documents})
        self.fail('prohibited cold output actually staged: '+result['status'])

    def changed_config(self,**values):
        request=copy.deepcopy(self.request);value=json.loads(request['actors'][0]['source_config_bytes']);value.update(values)
        request['actors'][0]['source_config_bytes']=json.dumps(value,ensure_ascii=False);return request

    def preserved(self):
        fx=self.case['fx'];root=fx.root
        names=('original','control','old profiles','old configs','intents','staging','cutovers')
        return {n:fx.bytes(root/n) for n in names},self.store.path.read_bytes(),fx.bytes(Path(self.request['profiles_request']['output_dir']))

    def test_real_relocation_stages_exact_subset_preserving_all_other_settings_and_state(self):
        before=self.preserved();source=copy.deepcopy(self.request);result=self.call()
        self.assertEqual(result['status'],'cold_broker_staged');self.assertTrue(result['durability_confirmed'] and result['requires_adoption'])
        out=self.output();old=json.loads(self.request['actors'][0]['source_config_bytes']);value=json.loads((out/'queue-a.broker.json').read_text())
        manifest=json.loads(self.request['profiles_manifest_bytes']);entry=next(e for e in manifest['entries'] if e['actor_id']=='queue-a')
        new_profile=Path(self.request['profiles_request']['output_dir'])/entry['profile']
        self.assertEqual(value,dict(old,profile=str(new_profile)))
        self.assertEqual(json.loads((out/'queue-a.route.json').read_text()),dict(v=1,profile=str(new_profile),argv=[str(self.case['cli']),'--config',str(out/'queue-a.broker.json')]))
        self.assertEqual(json.loads((out/'routes.json').read_text()),{'v':1,'routes':{'queue-a':str(out/'queue-a.route.json')}})
        self.assertFalse((out/'queue-b.broker.json').exists());self.assertEqual(source,self.request);self.assertEqual(before,self.preserved())
        for path in out.iterdir():self.assertEqual(path.stat().st_mode&0o777,0o600)
        with sqlite3.connect(str(self.store.path)) as db:
            control=json.loads(db.execute("SELECT value FROM metadata WHERE key=?",('hosted_control.v1:'+self.case['managed'],)).fetchone()[0])
            plan=json.loads(db.execute('SELECT plan FROM hosted_seats WHERE agent_id=?',(self.case['managed'],)).fetchone()[0])
        self.assertEqual((control['owner_id'],control['desired'],control['revision']),('fixture-owner','stopped',2));self.assertEqual(plan['model'],'retained-model')
        EVIDENCE['preservation'].append({'whole_db_and_old_bytes_equal':True,'human_owner':control['owner_id'],'desired':control['desired'],'revision':control['revision'],'plan':plan})
        with self.assertRaises(AuthorityError):Store(self.case['fx'].db,self.store.instance_id,expected_binding=self.case['fx'].binding)

    def test_actor_equivalence_guard_rejects_enabled_b_with_a_profile_and_pin(self):
        self.use(self.new_case('same-valid-destination',same_destination=True))
        self.assertNotIn('error',self.store.view('queue-b','capabilities',{}))
        request=copy.deepcopy(self.request);request['actors']=[dict(self.case['configs']['queue-b'],actor_id='queue-a',broker_executable=str(self.case['cli']))]
        self.assertEqual(json.loads(request['actors'][0]['source_config_bytes'])['destination'],json.loads(self.request['actors'][0]['source_config_bytes'])['destination'])
        self.rejected(request,code='BROKER_ACTOR_MISMATCH');self.assertFalse(self.output().exists())

    def test_exact_retained_destination_guard_rejects_only_changed_wellformed_thread(self):
        value=json.loads(self.request['actors'][0]['source_config_bytes'])['destination'];value['thread_id']=THREADS['queue-b']
        self.rejected(self.changed_config(destination=value),code='BROKER_DESTINATION_MISMATCH');self.assertFalse(self.output().exists())

    def test_v1_and_two_actor_subset_are_serialized_without_version_upgrade(self):
        request=copy.deepcopy(self.request);request['actors'].append(dict(self.case['configs']['queue-b'],broker_executable=str(self.case['cli'])))
        self.call(request);self.assertEqual(json.loads((self.output()/'queue-b.broker.json').read_text())['v'],1)
        self.assertEqual(set(json.loads((self.output()/'routes.json').read_text())['routes']),{'queue-a','queue-b'})

    def test_relocated_startup_still_refuses_and_no_pin_or_control_adoption_occurs(self):
        self.call();before=self.store.path.read_bytes()
        with self.assertRaises(route_pins.RoutePinError) as caught:broker_routes.load_config(self.output()/'queue-a.broker.json')
        self.assertEqual(caught.exception.code,'ROUTE_PIN_MISSING');EVIDENCE['startup_refusals'].append({'code':caught.exception.code,'before_adoption':True})
        self.assertEqual(self.store.path.read_bytes(),before)

    def test_separate_already_current_pin_fixture_can_use_unchanged_config_and_map_loaders(self):
        destination=json.loads(self.request['actors'][0]['source_config_bytes'])['destination']
        with self.store.runner_guard('separately-provisioned-fixture-only') as guard:self.store.provision_route_pin(guard,'queue-a',destination)
        before=self.store.path.read_bytes();self.call();config=broker_routes.load_config(self.output()/'queue-a.broker.json')
        self.assertEqual(config.profile.actor_id,'queue-a');self.assertEqual(config.destination,destination)
        runner=profile.load_profile(config.profile_path)
        mapping,actors=broker_routes.load_route_table(self.output()/'routes.json',runner,selected_executable=str(self.case['cli']))
        self.assertEqual(actors,frozenset());self.assertEqual(mapping,{'queue-a':str(self.output()/'queue-a.route.json')})
        self.assertEqual(self.store.path.read_bytes(),before)

    def test_two_trusted_temporary_roots_run_exact_configured_cli_and_project_settings(self):
        for case in (self.case,self.new_case('B')):
            with self.subTest(root=str(case['fx'].root)):
                result=broker.stage_destination_broker(case['store'],case['receipt'],case['request']);out=Path(result['output_dir'])
                route=json.loads((out/'queue-a.route.json').read_text());config=json.loads((out/'queue-a.broker.json').read_text())
                self.assertEqual(broker_routes._executable(route['argv'][0]),str(case['cli']))
                child=subprocess.run(route['argv'],shell=False,capture_output=True,timeout=15)
                self.assertEqual(child.returncode,0,child.stderr.decode());seen=json.loads(case['log'].read_text())
                self.assertEqual(seen['argv'],['--config',str(out/'queue-a.broker.json')]);self.assertEqual(seen['config'],config)
                self.assertEqual(seen['binding']['actor_id'],'queue-a');self.assertEqual(seen['binding']['authority_epoch'],case['store'].binding['authority_epoch'])
                self.assertEqual(config['destination'],json.loads(case['request']['actors'][0]['source_config_bytes'])['destination'])
                EVIDENCE['shell'].append({'root':str(case['fx'].root),'argv':route['argv'],'observed':seen,'shell':False,'exit':child.returncode,'native_thread_started':False,
                    'selected_helper_source':case['cli'].read_text(),'selected_helper_mode':case['cli'].stat().st_mode&0o777})

    def test_old_private_paths_and_all_adoption_writers_are_unavailable_but_not_used(self):
        fx=self.case['fx']
        for name in ('original','control','old profiles','old configs','old home','old cwd','intents','cutovers'):
            path=fx.root/name;path.rename(fx.root/('retained-'+name))
        with mock.patch.object(Store,'provision_route_pin',side_effect=AssertionError('pin adoption')), \
             mock.patch.object(cutover,'publish_relocation',side_effect=AssertionError('old retry')), \
             mock.patch.object(cutover,'relocation_readback',side_effect=AssertionError('old readback')), \
             mock.patch.object(broker_routes,'load_route_table',side_effect=AssertionError('startup preflight')):
            self.assertEqual(self.call()['status'],'cold_broker_staged')

    def test_unconfirmed_profiles_or_wrong_manifest_receipt_are_refused_before_output(self):
        for change in ({'profiles_result':dict(self.request['profiles_result'],durability_confirmed=False)},
                       {'profiles_manifest_digest':'0'*64}):
            with self.subTest(change=change):self.rejected(dict(self.request,**change));self.assertFalse(self.output().exists())
        self.rejected(receipt=dict(self.receipt,move_id='foreign-move'));self.assertFalse(self.output().exists())

    def test_old_profile_reference_roots_home_and_unknown_fields_cannot_be_repaired(self):
        dest=json.loads(self.request['actors'][0]['source_config_bytes'])['destination']
        for index,change in enumerate(({'profile':'/foreign/profile'}, {'destination':dict(dest,codex_home='/foreign/home')},
                                       {'destination':dict(dest,kind='codex-hosted-stdio')}, {'unexpected':True}, {'v':True})):
            request=self.changed_config(**change);request['output_dir']=str(Path(self.request['output_root'])/('invalid-config-'+str(index)))
            with self.subTest(change=change):self.rejected(request);self.assertFalse(self.output(request).exists())
        for value in (['/old','--config','/foreign/config'],['/old','--config',self.request['actors'][0]['source_config_path'],'extra'],'shell string'):
            request=copy.deepcopy(self.request);row=request['actors'][0];route=json.loads(row['source_route_bytes']);route['argv']=value;row['source_route_bytes']=json.dumps(route)
            with self.subTest(argv=value):self.rejected(request);self.assertFalse(self.output().exists())

    def test_missing_or_malformed_predecessor_pin_is_held_without_scanning_or_new_pin(self):
        binding=dict(self.case['fx'].binding,instance_id=self.store.instance_id,actor_id='queue-a',db_path=str(self.case['fx'].db));binding.pop('authority_path')
        key=route_pins._key(binding)
        with sqlite3.connect(str(self.store.path)) as db:
            old=db.execute('SELECT value FROM metadata WHERE key=?',(key,)).fetchone()[0];db.execute('DELETE FROM metadata WHERE key=?',(key,))
        self.rejected(code='BROKER_PREDECESSOR_PIN_MISSING');self.assertFalse(self.output().exists())
        with sqlite3.connect(str(self.store.path)) as db:db.execute('INSERT INTO metadata VALUES (?,?)',(key,'{"v":true}'))
        self.rejected();self.assertFalse(self.output().exists())

    def test_disabled_actor_is_refused(self):
        with sqlite3.connect(str(self.store.path)) as db:db.execute("UPDATE actors SET enabled=0 WHERE id='queue-a'")
        self.rejected();self.assertFalse(self.output().exists())

    def test_current_ending_flag_refuses_generation(self):
        # Real current DB state, not a mocked pin/actor return.
        with sqlite3.connect(str(self.store.path)) as db:
            db.execute("UPDATE hosted_seats SET end_state='ending' WHERE agent_id='queue-a'")
        self.rejected(code='SEAT_ENDED');self.assertFalse(self.output().exists())

    def test_two_distinct_actors_cannot_claim_the_same_source_config_path(self):
        request=copy.deepcopy(self.request);row=dict(self.case['configs']['queue-b'],broker_executable=str(self.case['cli']))
        row['source_config_path']=request['actors'][0]['source_config_path'];request['actors'].append(row)
        self.rejected(request,code='BROKER_INVALID_REQUEST');self.assertFalse(self.output().exists())

    def test_new_current_commits_do_not_require_old_snapshot_commit_equality(self):
        command=dict(v=1,instance_id=self.store.instance_id,operation_id='later-current-write',kind='workspace.create',target={},
            expected={'authority':{k:self.store.binding[k] for k in ('authority_id','authority_epoch')}},args={'id':'later','title':'Keep current write'})
        self.assertEqual(self.store.command('fixture-owner',command)['status'],'committed')
        before=self.store.path.read_bytes();self.call();self.assertEqual(self.store.path.read_bytes(),before)

    def test_profile_output_changed_or_nonempty_outbox_is_held(self):
        parent=Path(self.request['profiles_request']['output_dir']);outbox=parent/'queue-a.outbox'
        io.write_record(outbox/'new-pending.json',{'operation':'retain'})
        self.rejected();self.assertFalse(self.output().exists())

    def test_existing_or_partial_output_is_not_repaired_or_replaced(self):
        self.output().mkdir(mode=0o700);(self.output()/'sentinel').write_bytes(b'exact prior bytes')
        self.rejected(code='BROKER_OUTPUT_OCCUPIED');self.assertEqual((self.output()/'sentinel').read_bytes(),b'exact prior bytes')
        self.assertEqual(broker.inspect_destination_broker(self.request)['status'],'broker_incomplete')

    def test_duplicate_actors_overlap_alias_and_unknown_request_fields_refuse(self):
        values=[dict(self.request,actors=self.request['actors']*2),dict(self.request,unexpected=True),dict(self.request,v=True),
                dict(self.request,output_dir=self.request['profiles_request']['output_dir'])]
        alias=self.case['fx'].root/'alias';alias.symlink_to(Path(self.request['output_root']))
        values.append(dict(self.request,output_root=str(alias),output_dir=str(alias/'new')))
        for request in values:
            with self.subTest(request=request):self.rejected(request);self.assertFalse(self.output().exists())

    def test_replaced_database_and_each_stable_lock_refuse(self):
        for path in (self.store.path,Path(str(self.store._authority.path)+'.lock'),Path(str(self.store._authority.path)+'.runner.lock')):
            saved=Path(str(path)+'.held');path.rename(saved);path.write_bytes(saved.read_bytes());path.chmod(0o600)
            try:self.rejected();self.assertFalse(self.output().exists())
            finally:path.unlink();saved.rename(path)

    def test_busy_authority_refuses_before_output(self):
        fd=os.open(str(self.store._authority.path)+'.lock',os.O_RDWR)
        try:
            fcntl.flock(fd,fcntl.LOCK_EX|fcntl.LOCK_NB);self.rejected(code='AUTHORITY_BUSY');self.assertFalse(self.output().exists())
        finally:os.close(fd)

    def test_inspector_is_read_only_and_observed_is_not_durability_or_adoption(self):
        with mock.patch.object(io,'full_flush',side_effect=AssertionError('inspection flushed')):
            self.assertEqual(broker.inspect_destination_broker(self.request)['status'],'not_started')
        self.call();before=self.preserved(),self.case['fx'].bytes(self.output())
        with mock.patch.object(io,'full_flush',side_effect=AssertionError('inspection flushed')):
            result=broker.inspect_destination_broker(self.request)
        self.assertEqual(result['status'],'cold_broker_observed');self.assertFalse(result['durability_confirmed']);self.assertTrue(result['requires_adoption'])
        self.assertEqual(before,(self.preserved(),self.case['fx'].bytes(self.output())))

    def test_changed_config_bytes_or_mode_are_refused_by_inspection(self):
        self.call();path=self.output()/'queue-a.broker.json';raw=path.read_bytes()
        path.write_bytes(raw+b' ')
        with self.assertRaises(io.RecoveryError):broker.inspect_destination_broker(self.request)
        path.write_bytes(raw);path.chmod(0o644)
        with self.assertRaises(io.RecoveryError):broker.inspect_destination_broker(self.request)

    def test_every_staging_full_flush_failure_is_unconfirmed_and_retains_artifacts(self):
        real=io.full_flush;seen=[]
        def observe(fd):seen.append(io.facts(os.fstat(fd)));return real(fd)
        with mock.patch.object(io,'full_flush',side_effect=observe):self.call()
        for index in range(len(seen)):
            request=dict(self.request,output_dir=str(Path(self.request['output_root'])/('flush-fault-'+str(index))));calls=[]
            def fail(fd):
                calls.append(io.facts(os.fstat(fd)))
                if len(calls)==index+1:raise OSError('injected full flush uncertainty')
                return real(fd)
            with self.subTest(index=index),mock.patch.object(io,'full_flush',side_effect=fail):self.rejected(request)
            self.assertEqual(len(calls),index+1);EVIDENCE['flush_faults'].append({'index':index,'reached':len(calls),'output_exists':self.output(request).exists()})

    def test_manifest_write_failure_retains_output_and_transactions_are_already_closed(self):
        real=io.write_record;seen=[];connections=[];connect=broker._connect
        def observe(path):
            answer=connect(path);connections.append(answer[0]);return answer
        def fail(path,value,*args):
            self.assertTrue(connections)
            for db in connections:
                with self.assertRaises(sqlite3.ProgrammingError):db.execute('SELECT 1')
            if Path(path).name=='manifest.json':
                seen.append(True);raise OSError('before final manifest')
            return real(path,value,*args)
        with mock.patch.object(io,'write_record',side_effect=fail),mock.patch.object(broker,'_connect',side_effect=observe):
            self.rejected(code='BROKER_UNCONFIRMED')
        self.assertEqual(seen,[True]);self.assertTrue(self.output().exists());self.assertFalse((self.output()/'manifest.json').exists())
        self.rejected(code='BROKER_OUTPUT_OCCUPIED')

    def test_authority_change_after_first_document_prevents_manifest_confirmation(self):
        real=io.write_record;hit=[]
        def change(path,value,*args):
            result=real(path,value,*args)
            if Path(path).name=='queue-a.broker.json' and not hit:
                hit.append(True);anchor=self.store._authority.path;record,_=io.read_record(anchor)
                anchor.write_bytes(io.encode(dict(record,epoch='changed-during-staging')))
            return result
        with mock.patch.object(io,'write_record',side_effect=change):self.rejected()
        self.assertEqual(hit,[True]);self.assertFalse((self.output()/'manifest.json').exists())

    def test_predecessor_pin_change_after_documents_is_not_confirmed(self):
        real=io.write_record;hit=[]
        binding={k:self.case['fx'].binding[k] for k in ('authority_id','authority_epoch')}
        binding.update(instance_id=self.store.instance_id,actor_id='queue-a',db_path=str(self.case['fx'].db));key=route_pins._key(binding)
        def change(path,value,*args):
            result=real(path,value,*args)
            if Path(path).name=='queue-a.broker.json' and not hit:
                hit.append(True)
                with sqlite3.connect(str(self.store.path)) as db:
                    pin=json.loads(db.execute('SELECT value FROM metadata WHERE key=?',(key,)).fetchone()[0])
                    pin['destination']['thread_id']=THREADS['queue-b'];db.execute('UPDATE metadata SET value=? WHERE key=?',(json.dumps(pin),key))
            return result
        with mock.patch.object(io,'write_record',side_effect=change):self.rejected(code='BROKER_INPUT_CHANGED')
        self.assertEqual(hit,[True]);self.assertFalse((self.output()/'manifest.json').exists())

    def test_final_directory_close_uncertainty_retains_observed_not_confirmed_artifacts(self):
        real=os.close;identity=io.identity(Path(self.request['output_root']).stat());hit=[]
        def fail(fd):
            same=io.identity(os.fstat(fd))==identity;real(fd)
            if same and not hit:hit.append(True);raise OSError('lost directory close result')
        with mock.patch.object(os,'close',side_effect=fail):self.rejected()
        self.assertEqual(hit,[True]);self.assertFalse(broker.inspect_destination_broker(self.request)['durability_confirmed'])

    def test_route_profile_schema_and_source_json_are_strict(self):
        for raw in ('{"v":1,"v":1}', '{"v":true}', '[]', 'NaN'):
            request=copy.deepcopy(self.request);request['actors'][0]['source_config_bytes']=raw
            with self.subTest(raw=raw):self.rejected(request);self.assertFalse(self.output().exists())
        for field,value in (('profile','/foreign/profile'),('argv',['/old','--config','/foreign/config'])):
            request=copy.deepcopy(self.request);row=request['actors'][0];route=json.loads(row['source_route_bytes']);route[field]=value;row['source_route_bytes']=json.dumps(route)
            request['output_dir']=str(Path(self.request['output_root'])/('invalid-wire-'+field))
            with self.subTest(field=field):self.rejected(request);self.assertFalse(self.output(request).exists())
        for request in (dict(self.request,actors=self.request['actors']*17),self.changed_config(codex_executable='/normalized/../alias')):
            self.rejected(request);self.assertFalse(self.output().exists())

    def test_new_explicit_broker_endpoint_must_remain_trusted(self):
        self.case['cli'].chmod(0o777);self.rejected();self.assertFalse(self.output().exists())

    def test_inspection_refuses_changed_saved_pin_binding_context(self):
        self.call();path=self.output()/'manifest.json';saved=json.loads(path.read_text());saved['pins']['queue-a']['binding']['actor_id']='queue-b'
        path.write_bytes(io.encode(saved))
        with self.assertRaises(io.RecoveryError):broker.inspect_destination_broker(self.request)


if __name__ == '__main__':unittest.main()

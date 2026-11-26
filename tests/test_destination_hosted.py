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

from aim_next import (Store, backup, broker_routes, codex_host, destination_profiles as profiles,
                      hosted_notice, profile, recovery_io as io, relocation, relocation_cutover as cutover,
                      relocation_publication as publication, relocation_stage as stage, route_pins)
from aim_next.authority import AuthorityError
import test_authority_relocation as fixture

AVAILABLE = importlib.util.find_spec('aim_next.destination_hosted') is not None
if AVAILABLE: from aim_next import destination_hosted as hosted
EVIDENCE = {'staged': [], 'prohibited_outputs': [], 'shell': [], 'flush_faults': [], 'startup_refusals': []}
THREADS = {'agent-a':'11111111-2222-4333-8444-555555555555', 'agent-b':'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee'}


class Availability(unittest.TestCase):
    def test_cold_hosted_api_exists(self):
        self.assertTrue(AVAILABLE, '1329 cold hosted API is absent; not behavioral parity')


@unittest.skipUnless(AVAILABLE, '1329 absent; behavior bodies and targets are unreached')
class HostedCase(unittest.TestCase):
    def new_case(self, label='A'):
        real=tempfile.TemporaryDirectory
        def temporary(*args,**kwargs):
            kwargs.update(prefix=".1329 "+label+" λ's $(printf no) `echo no`; [x]-",dir=str(Path(__file__).resolve().parents[1]))
            return real(*args,**kwargs)
        fx=fixture.RelocationCase('test_no_active_database_and_original_lost_response_outcome_remains_identical')
        self.addCleanup(fx.doCleanups)
        with mock.patch.object(tempfile,'TemporaryDirectory',side_effect=temporary):fx.setUp()
        old_profiles=fx.root/'old profiles';old_profiles.mkdir(mode=0o700)
        configs=fx.root/'old configs';configs.mkdir(mode=0o700)
        home=fx.root/'old home';home.mkdir(mode=0o700);cwd=fx.root/'old cwd';cwd.mkdir(mode=0o700)
        source_rows=[];source_configs={}
        oldpin={k:fx.binding[k] for k in ('authority_id','authority_epoch')}
        with sqlite3.connect(str(fx.db)) as db:version=db.execute("SELECT version FROM workspaces WHERE id='private-work'").fetchone()[0]
        added=fx.store.command('fixture-owner',dict(v=1,instance_id=fx.store.instance_id,operation_id='preserve-managed-seat',
            kind='workspace.hosted_seat_add',target={'workspace_id':'private-work'},expected={'authority':oldpin,'workspace_revision':version},
            args={'name':'Agent a','role':'Keep exact old role λ.  '}))
        self.assertEqual(added['status'],'committed',added)
        self.assertEqual(added['result']['agent']['id'],'agent-a')
        for actor in THREADS:
            if actor!='agent-a':fx.store.register_actor(actor,'agent',actor)
            with fx.store.runner_guard('old-provision') as guard:
                fx.store.provision_route_pin(guard,actor,dict(kind='codex-hosted-stdio',protocol_version=1,
                    codex_home=str(home),thread_id=THREADS[actor]),owner_id='fixture-owner')
            old=old_profiles/(actor+'.profile.json');profile.write_profile(old,fx.db,fx.store.instance_id,actor,binding=fx.binding)
            outbox=old_profiles/(actor+'.outbox');outbox.mkdir(mode=0o700)
            io.write_record(outbox/'saved-request.json',{'operation_id':'old-opaque-'+actor,'binding':fx.binding,'exact':'preserve private original'})
            source_rows.append(dict(source_path=str(old),source_bytes=old.read_text(),outbox_parent=str(old_profiles)))
            value=dict(v=2,kind='codex-hosted-stdio',actor_id=actor,profile=str(old),cli='/retained original/old CLI',
                codex_executable='/usr/bin/python3',codex_home=str(home),thread_id=THREADS[actor],cwd=str(cwd),
                model='fixture-model',writable_roots=[str(fx.db.parent),str(outbox)],permission_mode='full',
                reasoning_effort='high',instructions='Keep exact old role λ.  ')
            path=configs/(actor+'.hosted.json');io.write_record(path,value)
            source_configs[actor]=dict(actor_id=actor,source_path=str(path),source_bytes=path.read_text())
        stopped=fx.store.command('fixture-owner',dict(v=1,instance_id=fx.store.instance_id,operation_id='keep-agent-a-stopped',
            kind='agent.execution',target={'actor_id':'agent-a'},expected={'authority':oldpin,'execution_revision':1},args={'desired':'stopped'}))
        self.assertEqual(stopped['status'],'committed',stopped)
        with fx.store.runner_guard('plan-fixture') as guard:
            token=fx.store.acquire_runner(guard)['runner_token'];seat=fx.store.hosted_seat_claim(guard,token)['seat']
            fx.store.hosted_seat_step(guard,token,seat['id'],seat['version'],'profile',{'plan':{'profile':'/retained/private/managed-profile','revision':7}})
        fresh=backup.backup(fx.db,fx.store.instance_id,expected_binding=fx.binding,bundle_path=str(fx.root/'fresh bundle'))
        metadata=backup.inspect(fresh['bundle_path'])['metadata']
        prep=copy.deepcopy(fx.request);prep.update(bundle_path=fresh['bundle_path'],bundle_digest=fresh['bundle_digest'],
            commit=dict(seq=metadata['commit_seq'],id=metadata['commit_id']))
        prep['owners']['destination_uid']=os.getuid()
        relocation.prepare(prep)
        intent_root=fx.root/'intents';intent_root.mkdir(mode=0o700)
        intent_request=dict(v=1,preparation=prep,journal_root=str(intent_root))
        intent=publication.prepare_publication_intent(intent_request)['intent']
        stage_root=fx.root/'stages';stage_root.mkdir(mode=0o700)
        stage_request=dict(v=1,intent_request=intent_request,intent_digest=io.digest_record(intent),journal_root=str(stage_root))
        staged=stage.stage_relocation(stage_request)
        cutovers=fx.root/'cutovers';cutovers.mkdir(mode=0o700)
        cutover_request=dict(v=1,stage_request=stage_request,stage_digest=io.digest_record(staged['stage']),journal_root=str(cutovers))
        receipt=cutover.publish_relocation(cutover_request);binding=receipt['binding']
        current=Store(binding['db_path'],binding['instance_id'],expected_binding={k:binding[k] for k in profile.BINDING_FIELDS})
        destination=Path(binding['db_path']).parent
        pr=dict(v=1,destination_root=str(destination),output_dir=str(destination/'profiles λ'),
            publication_digest=io.digest_record(receipt),profiles=source_rows)
        result=profiles.stage_destination_profiles(current,receipt,pr)
        manifest_path=Path(result['manifest_path']);raw=manifest_path.read_text()
        cli=fx.root/"explicit CLI λ's $(printf bad) `echo bad`; [x]"
        log=fx.root/'argv.json';repo=str(Path(__file__).resolve().parents[1])
        cli.write_text('import json,sys\nfrom pathlib import Path\nPath('+repr(str(log))+').write_text(json.dumps(sys.argv[1:]))\n'
            +'sys.path.insert(0,'+repr(repo)+')\nfrom aim_next.cli import main\nraise SystemExit(main())\n');cli.chmod(0o700)
        rows=[dict(source_configs['agent-a'],cli=str(cli))]
        request=dict(v=1,output_root=str(destination),output_dir=str(destination/"hosted λ's $() [x]"),
            profiles_request=pr,profiles_result=result,profiles_manifest_bytes=raw,
            profiles_manifest_digest=__import__('hashlib').sha256(raw.encode()).hexdigest(),actors=rows)
        return dict(fx=fx,store=current,receipt=receipt,request=request,configs=source_configs,cli=cli,log=log)

    def setUp(self):
        self.case=self.new_case();self.store=self.case['store'];self.receipt=self.case['receipt'];self.request=self.case['request']

    def output(self,request=None):return Path((request or self.request)['output_dir'])

    def call(self,request=None,receipt=None):
        result=hosted.stage_destination_hosted(self.store,receipt or self.receipt,request or self.request)
        EVIDENCE['staged'].append({'test':self.id(),'result':result});return result

    def rejected(self,request=None,receipt=None,code=None):
        request=request or self.request
        try:result=self.call(request,receipt)
        except (io.RecoveryError,AuthorityError,route_pins.RoutePinError) as error:
            if code:self.assertEqual(error.code,code)
            return error
        out=self.output(request);documents={p.name:json.loads(p.read_text()) for p in out.glob('*.hosted.json')}
        EVIDENCE['prohibited_outputs'].append({'test':self.id(),'result':result,'output_exists':out.exists(),'documents':documents})
        self.fail('prohibited cold output actually staged: '+result['status'])

    def changed_config(self,**values):
        request=copy.deepcopy(self.request);value=json.loads(request['actors'][0]['source_bytes']);value.update(values)
        request['actors'][0]['source_bytes']=json.dumps(value,ensure_ascii=False);return request

    def preserved(self):
        fx=self.case['fx'];root=fx.root
        names=('original','control','old profiles','old configs','intents','staging','cutovers')
        return {n:fx.bytes(root/n) for n in names},self.store.path.read_bytes(),fx.bytes(Path(self.request['profiles_request']['output_dir']))

    def test_real_relocation_stages_exact_subset_preserving_all_other_settings_and_state(self):
        before=self.preserved();source=copy.deepcopy(self.request);result=self.call()
        self.assertEqual(result['status'],'cold_hosted_staged');self.assertTrue(result['durability_confirmed'] and result['requires_adoption'])
        out=self.output();old=json.loads(self.request['actors'][0]['source_bytes']);value=json.loads((out/'agent-a.hosted.json').read_text())
        manifest=json.loads(self.request['profiles_manifest_bytes']);entry=next(e for e in manifest['entries'] if e['actor_id']=='agent-a')
        new_profile=Path(self.request['profiles_request']['output_dir'])/entry['profile']
        expected=dict(old,profile=str(new_profile),cli=str(self.case['cli']),writable_roots=[str(self.store.path.parent),str(new_profile.parent/'agent-a.outbox')])
        self.assertEqual(value,expected);self.assertEqual(json.loads((out/'routes.json').read_text()),{'v':1,'routes':{'agent-a':str(out/'agent-a.hosted.json')}})
        self.assertFalse((out/'agent-b.hosted.json').exists());self.assertEqual(source,self.request);self.assertEqual(before,self.preserved())
        for path in out.iterdir():self.assertEqual(path.stat().st_mode&0o777,0o600)
        with self.assertRaises(AuthorityError):Store(self.case['fx'].db,self.store.instance_id,expected_binding=self.case['fx'].binding)

    def test_actor_equivalence_guard_rejects_enabled_b_with_a_profile_and_pin(self):
        self.assertNotIn('error',self.store.view('agent-b','capabilities',{}))
        self.rejected(self.changed_config(actor_id='agent-b'),code='HOSTED_ACTOR_MISMATCH');self.assertFalse(self.output().exists())

    def test_exact_retained_destination_guard_rejects_only_changed_wellformed_thread(self):
        self.rejected(self.changed_config(thread_id=THREADS['agent-b']),code='HOSTED_DESTINATION_MISMATCH');self.assertFalse(self.output().exists())

    def test_v1_and_two_actor_subset_are_serialized_without_version_upgrade(self):
        request=copy.deepcopy(self.request);row=dict(self.case['configs']['agent-b'],cli=str(self.case['cli']))
        value=json.loads(row['source_bytes']);value['v']=1
        for k in ('permission_mode','reasoning_effort','instructions'):value.pop(k)
        row['source_bytes']=json.dumps(value);request['actors'].append(row)
        self.call(request);self.assertEqual(json.loads((self.output()/'agent-b.hosted.json').read_text())['v'],1)
        self.assertEqual(set(json.loads((self.output()/'routes.json').read_text())['routes']),{'agent-a','agent-b'})

    def test_relocated_startup_still_refuses_and_no_pin_or_control_adoption_occurs(self):
        self.call();path=self.output()/'agent-a.hosted.json';before=self.store.path.read_bytes()
        with self.assertRaises(route_pins.RoutePinError) as caught:broker_routes.load_hosted_config(path)
        self.assertIn(caught.exception.code,('ROUTE_PIN_MISSING','ROUTE_PIN_MISMATCH','HOSTED_RECOVERY_BINDING_MISMATCH'))
        EVIDENCE['startup_refusals'].append({'code':caught.exception.code,'before_adoption':True})
        self.assertEqual(self.store.path.read_bytes(),before)

    def test_separate_already_current_pin_fixture_can_use_unchanged_config_and_map_loaders(self):
        destination=dict(kind='codex-hosted-stdio',protocol_version=1,codex_home=json.loads(self.request['actors'][0]['source_bytes'])['codex_home'],thread_id=THREADS['agent-a'])
        with self.store.runner_guard('separately-provisioned-fixture-only') as guard:self.store.provision_route_pin(guard,'agent-a',destination)
        before=self.store.path.read_bytes();self.call()
        config=broker_routes.load_hosted_config(self.output()/'agent-a.hosted.json')
        self.assertEqual(config.profile.actor_id,'agent-a');self.assertEqual(config.destination,destination)
        runner=profile.load_profile(config.profile_path)
        mapping,actors=broker_routes.load_route_table(self.output()/'routes.json',runner,selected_executable='/bin/sh')
        self.assertEqual(actors,frozenset({'agent-a'}));self.assertEqual(mapping,{'agent-a':str(self.output()/'agent-a.hosted.json')})
        self.assertEqual(self.store.path.read_bytes(),before)

    def test_two_trusted_temporary_roots_run_exact_configured_cli_and_project_settings(self):
        for case in (self.case,self.new_case('B')):
            with self.subTest(root=str(case['fx'].root)):
                result=hosted.stage_destination_hosted(case['store'],case['receipt'],case['request'])
                config=json.loads((Path(result['output_dir'])/'agent-a.hosted.json').read_text())
                self.assertEqual(broker_routes._executable(config['cli']),str(case['cli']))
                command=hosted_notice.cli_command(config['cli'],config['profile'])+' binding'
                child=subprocess.run(['/bin/sh','-c',command],capture_output=True,timeout=15)
                self.assertEqual(child.returncode,0,child.stderr.decode());argv=json.loads(case['log'].read_text())
                self.assertEqual(argv,['--profile',config['profile'],'binding'])
                self.assertEqual(json.loads(child.stdout)['binding']['actor_id'],'agent-a')
                self.assertEqual(json.loads(child.stdout)['binding']['authority_epoch'],case['store'].binding['authority_epoch'])
                loaded=profile.load_profile(config['profile'])
                projected=broker_routes.HostedConfig(str(Path(result['output_dir'])/'agent-a.hosted.json'),config['profile'],loaded,
                    config['cli'],config['codex_executable'],dict(kind=config['kind'],protocol_version=1,codex_home=config['codex_home'],thread_id=config['thread_id']),
                    config['cwd'],config['model'],tuple(config['writable_roots']),config['permission_mode'],config['reasoning_effort'],config['instructions'])
                settings=codex_host.thread_settings(projected)
                self.assertEqual(settings['cwd'],config['cwd']);self.assertEqual(settings['model'],config['model'])
                self.assertEqual(settings['config']['model_reasoning_effort'],config['reasoning_effort'])
                self.assertIn('Standing role:\n'+config['instructions'],settings['developerInstructions'])
                EVIDENCE['shell'].append({'root':str(case['fx'].root),'argv':argv,'exit':child.returncode,'settings':settings,'native_thread_started':False})

    def test_old_private_paths_and_all_adoption_writers_are_unavailable_but_not_used(self):
        fx=self.case['fx']
        for name in ('original','control','old profiles','old configs','old home','old cwd','intents','cutovers'):
            path=fx.root/name;path.rename(fx.root/('retained-'+name))
        with mock.patch.object(Store,'provision_route_pin',side_effect=AssertionError('pin adoption')), \
             mock.patch.object(cutover,'publish_relocation',side_effect=AssertionError('old retry')), \
             mock.patch.object(cutover,'relocation_readback',side_effect=AssertionError('old readback')), \
             mock.patch.object(broker_routes,'load_route_table',side_effect=AssertionError('startup preflight')):
            self.assertEqual(self.call()['status'],'cold_hosted_staged')

    def test_unconfirmed_profiles_or_wrong_manifest_receipt_are_refused_before_output(self):
        for change in ({'profiles_result':dict(self.request['profiles_result'],durability_confirmed=False)},
                       {'profiles_manifest_digest':'0'*64}):
            with self.subTest(change=change):self.rejected(dict(self.request,**change));self.assertFalse(self.output().exists())
        self.rejected(receipt=dict(self.receipt,move_id='foreign-move'));self.assertFalse(self.output().exists())

    def test_old_profile_reference_roots_home_and_unknown_fields_cannot_be_repaired(self):
        for index,change in enumerate(({'profile':'/foreign/profile'}, {'writable_roots':['/extra','/root']},
                       {'codex_home':'/foreign/home'}, {'kind':'codex-queue-stdio'}, {'unexpected':True})):
            request=self.changed_config(**change)
            request['output_dir']=str(Path(self.request['output_root'])/('invalid-config-'+str(index)))
            with self.subTest(change=change):self.rejected(request);self.assertFalse(self.output(request).exists())

    def test_missing_or_malformed_predecessor_pin_is_held_without_scanning_or_new_pin(self):
        binding=dict(self.case['fx'].binding,instance_id=self.store.instance_id,actor_id='agent-a',db_path=str(self.case['fx'].db));binding.pop('authority_path')
        key=route_pins._key(binding)
        with sqlite3.connect(str(self.store.path)) as db:
            old=db.execute('SELECT value FROM metadata WHERE key=?',(key,)).fetchone()[0];db.execute('DELETE FROM metadata WHERE key=?',(key,))
        self.rejected(code='HOSTED_PREDECESSOR_PIN_MISSING');self.assertFalse(self.output().exists())
        with sqlite3.connect(str(self.store.path)) as db:db.execute('INSERT INTO metadata VALUES (?,?)',(key,'{"v":true}'))
        self.rejected();self.assertFalse(self.output().exists())

    def test_disabled_actor_is_refused(self):
        with sqlite3.connect(str(self.store.path)) as db:db.execute("UPDATE actors SET enabled=0 WHERE id='agent-a'")
        self.rejected();self.assertFalse(self.output().exists())

    def test_current_ending_flag_refuses_generation(self):
        # Real current DB state, not a mocked pin/actor return.
        with sqlite3.connect(str(self.store.path)) as db:
            db.execute("UPDATE hosted_seats SET end_state='ending' WHERE agent_id='agent-a'")
        self.rejected(code='SEAT_ENDED');self.assertFalse(self.output().exists())

    def test_two_distinct_actors_cannot_claim_the_same_source_config_path(self):
        request=copy.deepcopy(self.request);row=dict(self.case['configs']['agent-b'],cli=str(self.case['cli']))
        row['source_path']=request['actors'][0]['source_path'];request['actors'].append(row)
        self.rejected(request,code='HOSTED_INVALID_REQUEST');self.assertFalse(self.output().exists())

    def test_new_current_commits_do_not_require_old_snapshot_commit_equality(self):
        command=dict(v=1,instance_id=self.store.instance_id,operation_id='later-current-write',kind='workspace.create',target={},
            expected={'authority':{k:self.store.binding[k] for k in ('authority_id','authority_epoch')}},args={'id':'later','title':'Keep current write'})
        self.assertEqual(self.store.command('fixture-owner',command)['status'],'committed')
        before=self.store.path.read_bytes();self.call();self.assertEqual(self.store.path.read_bytes(),before)

    def test_profile_output_changed_or_nonempty_outbox_is_held(self):
        parent=Path(self.request['profiles_request']['output_dir']);outbox=parent/'agent-a.outbox'
        io.write_record(outbox/'new-pending.json',{'operation':'retain'})
        self.rejected();self.assertFalse(self.output().exists())

    def test_existing_or_partial_output_is_not_repaired_or_replaced(self):
        self.output().mkdir(mode=0o700);(self.output()/'sentinel').write_bytes(b'exact prior bytes')
        self.rejected(code='HOSTED_OUTPUT_OCCUPIED');self.assertEqual((self.output()/'sentinel').read_bytes(),b'exact prior bytes')
        self.assertEqual(hosted.inspect_destination_hosted(self.request)['status'],'hosted_incomplete')

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
            self.assertEqual(hosted.inspect_destination_hosted(self.request)['status'],'not_started')
        self.call();before=self.preserved(),self.case['fx'].bytes(self.output())
        with mock.patch.object(io,'full_flush',side_effect=AssertionError('inspection flushed')):
            result=hosted.inspect_destination_hosted(self.request)
        self.assertEqual(result['status'],'cold_hosted_observed');self.assertFalse(result['durability_confirmed']);self.assertTrue(result['requires_adoption'])
        self.assertEqual(before,(self.preserved(),self.case['fx'].bytes(self.output())))

    def test_changed_config_bytes_or_mode_are_refused_by_inspection(self):
        self.call();path=self.output()/'agent-a.hosted.json';raw=path.read_bytes()
        path.write_bytes(raw+b' ')
        with self.assertRaises(io.RecoveryError):hosted.inspect_destination_hosted(self.request)
        path.write_bytes(raw);path.chmod(0o644)
        with self.assertRaises(io.RecoveryError):hosted.inspect_destination_hosted(self.request)

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
        real=io.write_record;seen=[];connections=[];connect=hosted._connect
        def observe(path):
            answer=connect(path);connections.append(answer[0]);return answer
        def fail(path,value,*args):
            self.assertTrue(connections)
            for db in connections:
                with self.assertRaises(sqlite3.ProgrammingError):db.execute('SELECT 1')
            if Path(path).name=='manifest.json':
                seen.append(True);raise OSError('before final manifest')
            return real(path,value,*args)
        with mock.patch.object(io,'write_record',side_effect=fail),mock.patch.object(hosted,'_connect',side_effect=observe):
            self.rejected(code='HOSTED_UNCONFIRMED')
        self.assertEqual(seen,[True]);self.assertTrue(self.output().exists());self.assertFalse((self.output()/'manifest.json').exists())
        self.rejected(code='HOSTED_OUTPUT_OCCUPIED')

    def test_authority_change_after_first_document_prevents_manifest_confirmation(self):
        real=io.write_record;hit=[]
        def change(path,value,*args):
            result=real(path,value,*args)
            if Path(path).name=='agent-a.hosted.json' and not hit:
                hit.append(True);anchor=self.store._authority.path;record,_=io.read_record(anchor)
                anchor.write_bytes(io.encode(dict(record,epoch='changed-during-staging')))
            return result
        with mock.patch.object(io,'write_record',side_effect=change):self.rejected()
        self.assertEqual(hit,[True]);self.assertFalse((self.output()/'manifest.json').exists())

    def test_predecessor_pin_change_after_documents_is_not_confirmed(self):
        real=io.write_record;hit=[]
        binding={k:self.case['fx'].binding[k] for k in ('authority_id','authority_epoch')}
        binding.update(instance_id=self.store.instance_id,actor_id='agent-a',db_path=str(self.case['fx'].db));key=route_pins._key(binding)
        def change(path,value,*args):
            result=real(path,value,*args)
            if Path(path).name=='agent-a.hosted.json' and not hit:
                hit.append(True)
                with sqlite3.connect(str(self.store.path)) as db:
                    pin=json.loads(db.execute('SELECT value FROM metadata WHERE key=?',(key,)).fetchone()[0])
                    pin['destination']['thread_id']=THREADS['agent-b'];db.execute('UPDATE metadata SET value=? WHERE key=?',(json.dumps(pin),key))
            return result
        with mock.patch.object(io,'write_record',side_effect=change):self.rejected(code='HOSTED_INPUT_CHANGED')
        self.assertEqual(hit,[True]);self.assertFalse((self.output()/'manifest.json').exists())

    def test_final_directory_close_uncertainty_retains_observed_not_confirmed_artifacts(self):
        real=os.close;identity=io.identity(Path(self.request['output_root']).stat());hit=[]
        def fail(fd):
            same=io.identity(os.fstat(fd))==identity;real(fd)
            if same and not hit:hit.append(True);raise OSError('lost directory close result')
        with mock.patch.object(os,'close',side_effect=fail):self.rejected()
        self.assertEqual(hit,[True]);self.assertFalse(hosted.inspect_destination_hosted(self.request)['durability_confirmed'])


if __name__ == '__main__':unittest.main()

from __future__ import annotations

import copy
import fcntl
import inspect
from contextlib import contextmanager
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import sqlite3
import tempfile
import unittest
from unittest import mock

from aim_next import Store, backup, profile, destination_profiles as profiles, destination_hosted as hosted, destination_broker as broker
from aim_next import relocation, relocation_publication as publication, relocation_stage as stage, relocation_cutover as cutover
from aim_next.contract import StoreError
from aim_next import recovery_io as io, broker_routes, route_pins, seat_host
from aim_next.authority import AuthorityError
import test_authority_relocation as fixture

AVAILABLE=importlib.util.find_spec('aim_next.destination_map') is not None
if AVAILABLE:from aim_next import destination_map as maps
EVIDENCE={'staged':[],'prohibited_outputs':[],'fixture_setup':[],'already_current_loaders':[],'current_mixed':[],'preservation':[],'flush_faults':[],'startup_refusals':[],'budget':[],'close_faults':[]}
THREADS={'managed-a':'11111111-2222-4333-8444-555555555555','managed-b':'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee'}
ROLE='Keep exact role λ.\nPreserve trailing spaces.  '

class Availability(unittest.TestCase):
    def test_cold_map_api_exists(self):self.assertTrue(AVAILABLE,'1333 API absent; not behavioral parity')

@unittest.skipUnless(AVAILABLE,'1333 absent; bodies/targets unreached')
class MapCase(unittest.TestCase):
    def new_case(self,label='A',omit=False,duplicate=False):
        ready=True;role_conflict=False;role_file=False;named_controller=True
        real=tempfile.TemporaryDirectory
        def temp(*args,**kwargs):
            kwargs.update(prefix=".1333 "+label+" λ's $(printf no) `echo no`; [x]-",dir=str(Path(__file__).resolve().parents[1]));return real(*args,**kwargs)
        fx=fixture.RelocationCase('test_no_active_database_and_original_lost_response_outcome_remains_identical');self.addCleanup(fx.doCleanups)
        with mock.patch.object(tempfile,'TemporaryDirectory',side_effect=temp):fx.setUp()
        controller='fixture-controller' if named_controller else 'fixture-owner'
        template='template-'+'a'*64
        if named_controller:
            fx.store.register_actor(controller,'human','Actual controller')
            fx.store.register_actor('fixture-template','agent','Named host template')
        oldroot=fx.root/'old seats';oldroot.mkdir(mode=0o700);home=fx.root/'old home';home.mkdir(mode=0o700)
        cli_root=fx.root/'new CLI';cli_root.mkdir(mode=0o700);(cli_root/'bin').mkdir(mode=0o700)
        cli=cli_root/'bin'/'aim-next';log=fx.root/'argv.json';repo=str(Path(__file__).resolve().parents[1])
        cli.write_text('import json,sys\nfrom pathlib import Path\nsys.dont_write_bytecode=True\n'
            +'sys.pycache_prefix='+repr(str(fx.root/'child-cache'))+'\nsys.path.insert(0,'+repr(repo)+')\n'
            +'from aim_next.profile import load_profile\np=load_profile(sys.argv[2])\n'
            +'v={"argv":sys.argv[1:],"actor_id":p.actor_id,"binding":p.binding}\nPath('+repr(str(log))+').write_text(json.dumps(v))\nprint(json.dumps(v))\n');cli.chmod(0o700)
        if role_file:
            folder=cli_root/'docs'/'seats';folder.mkdir(parents=True,mode=0o700);folder.parent.chmod(0o700)
            (folder/'managed-a.md').write_text('Retained repository role; recover current board work.')
        authority={k:fx.binding[k] for k in ('authority_id','authority_epoch')};sources=[];configs=[];records={}
        with fx.store.runner_guard('genuine-managed-fixture') as guard:
            token=fx.store.acquire_runner(guard)['runner_token']
            if named_controller:
                published=fx.store.hosted_seat_publish_templates(guard,token,[dict(id=template,actor_id='fixture-template',model='retained-model',reasoning_effort='high')])
                self.assertEqual(published['status'],'ok')
            for actor in ({'managed-a':THREADS['managed-a']} if duplicate else THREADS):
                with sqlite3.connect(str(fx.db)) as db:version=db.execute("SELECT version FROM workspaces WHERE id='private-work'").fetchone()[0]
                result=fx.store.command('fixture-owner',dict(v=1,instance_id=fx.store.instance_id,operation_id='add-'+actor,
                    kind='workspace.hosted_seat_add',target={'workspace_id':'private-work'},expected={'authority':authority,'workspace_revision':version},
                    args=dict({'name':actor.replace('-',' ').title(),'role':ROLE},**({'template_id':template} if named_controller else {}))))
                self.assertEqual(result['status'],'committed',result);identity=result['result']['seat_request_id'];self.assertEqual(result['result']['agent']['id'],actor)
                folder=oldroot/identity;folder.mkdir(mode=0o700);cwd=folder/'work';cwd.mkdir(mode=0o700)
                old_profile=folder/(actor+'.profile.json');profile.write_profile(old_profile,fx.db,fx.store.instance_id,actor,binding=fx.binding)
                outbox=folder/(actor+'.outbox');outbox.mkdir(mode=0o700);io.write_record(outbox/'saved-request.json',{'operation_id':'retain-'+actor,'exact':'old bound request','binding':fx.binding})
                plan=dict(profile=str(old_profile),config=str(folder/'route.json'),cwd=str(cwd),cli='/retained source CLI',codex_home=str(home),
                    codex_executable='/usr/bin/python3',model='retained-model',reasoning_effort='high',permission_mode='full')
                if named_controller:
                    plan['cli']=str(cli)
                    provisioned=fx.store.provision_route_pin(guard,actor,dict(kind='codex-hosted-stdio',protocol_version=1,codex_home=str(home),thread_id=THREADS[actor]),owner_id=controller)
                    self.assertEqual(provisioned['status'],'provisioned')
                io.write_record(folder/'request.json',dict(seat_id=identity,plan=plan))
                row=fx.store.hosted_seat_claim(guard,token)['seat'];self.assertEqual(row['id'],identity)
                row=fx.store.hosted_seat_step(guard,token,identity,row['version'],'profile',{'plan':plan})['seat']
                for phase in ('thread','starting','persist','persisting','pin','route','delivery')+ (('ready',) if ready else ()):
                    details={'thread_id':THREADS[actor]} if phase=='persist' else None
                    row=fx.store.hosted_seat_step(guard,token,identity,row['version'],phase,details)['seat']
                self.assertEqual((row['state'],row['stage']),('ready','ready') if ready else ('preparing','delivery'),row)
                stop=fx.store.command(controller,dict(v=1,instance_id=fx.store.instance_id,operation_id='stop-'+actor,kind='agent.execution',
                    target={'actor_id':actor},expected={'authority':authority,'execution_revision':1},args={'desired':'stopped'}));self.assertEqual(stop['status'],'committed',stop)
                config=dict(v=2,kind='codex-hosted-stdio',actor_id=actor,profile=str(old_profile),cli=plan['cli'],codex_executable=plan['codex_executable'],
                    codex_home=str(home),thread_id=THREADS[actor],cwd=str(cwd),model=plan['model'],writable_roots=[str(fx.db.parent),str(outbox)],
                    permission_mode='full',reasoning_effort='high',instructions='Conflicting role B.  ' if role_conflict and actor=='managed-a' else ROLE)
                io.write_record(folder/'route.json',config)
                if named_controller:
                    loaded=broker_routes.load_hosted_config(folder/'route.json')
                    controls=fx.store.hosted_controls(guard,token,[actor]);self.assertEqual(controls['status'],'ok')
                    control=controls['controls'][actor];self.assertEqual((control['owner_id'],control['desired'],control['revision']),(controller,'stopped',2))
                    EVIDENCE['already_current_loaders'].append({'test':self.id(),'actor':loaded.profile.actor_id,'binding':loaded.profile.binding,'destination':loaded.destination,'control':control,'native_consumer':False,'source':'Normal config loader/current Core pin and guard-held hosted_controls BEFORE relocation; generator not called after adoption.'})
                sources.append(dict(source_path=str(old_profile),source_bytes=old_profile.read_text(),outbox_parent=str(folder)))
                configs.append(dict(actor_id=actor,source_path=str(folder/'route.json'),source_bytes=(folder/'route.json').read_text(),cli=str(cli)))
                records[actor]=dict(id=identity,source_request_path=str(folder/'request.json'),source_request_bytes=(folder/'request.json').read_text())
                EVIDENCE['fixture_setup'].append({'actor':actor,'seat_id':identity,'state':row['state'],'stage':row['stage'],
                    'first_message_id':row['first_message_id'],'ready_seq':row['ready_seq'],'native_consumer':False,'stop_revision':stop['result']['execution_revision']})
        fx.store.register_actor('queue-a','agent','Queue A')
        qfolder=oldroot/'queue-a';qfolder.mkdir(mode=0o700);qprofile=qfolder/'queue-a.profile.json'
        profile.write_profile(qprofile,fx.db,fx.store.instance_id,'queue-a',binding=fx.binding)
        qoutbox=qfolder/'queue-a.outbox';qoutbox.mkdir(mode=0o700);io.write_record(qoutbox/'saved-request.json',{'operation_id':'retained-queue','binding':fx.binding})
        qdest=dict(kind='codex-queue-stdio',protocol_version=1,codex_home=str(home),thread_id=THREADS['managed-a'] if duplicate else '33333333-2222-4333-8444-555555555555')
        with fx.store.runner_guard('genuine-queue-pin') as guard:fx.store.provision_route_pin(guard,'queue-a',qdest)
        qconfig=qfolder/'queue.broker.json';qroute=qfolder/'queue.route.json'
        io.write_record(qconfig,dict(v=1,profile=str(qprofile),codex_executable='/usr/bin/python3',destination=qdest))
        io.write_record(qroute,dict(v=1,profile=str(qprofile),argv=[str(cli),'--config',str(qconfig)]))
        sources.append(dict(source_path=str(qprofile),source_bytes=qprofile.read_text(),outbox_parent=str(qfolder)))
        oldmap=oldroot/'routes.json';oldroutes={row['actor_id']:row['source_path'] for row in configs};oldroutes['queue-a']=str(qroute)
        io.write_record(oldmap,dict(v=1,routes=oldroutes))
        if not duplicate:
            loaded,kinds=broker_routes.load_route_table(oldmap,profile.load_profile(qprofile),selected_executable=str(cli))
            self.assertEqual(loaded,oldroutes);self.assertEqual(kinds,frozenset(THREADS))
            EVIDENCE['current_mixed'].append({'test':self.id(),'routes':loaded,'hosted':sorted(kinds),'native_consumer':False,'before_relocation':True})
        fresh=backup.backup(fx.db,fx.store.instance_id,expected_binding=fx.binding,bundle_path=str(fx.root/'fresh bundle'));metadata=backup.inspect(fresh['bundle_path'])['metadata']
        prep=copy.deepcopy(fx.request);prep.update(bundle_path=fresh['bundle_path'],bundle_digest=fresh['bundle_digest'],commit=dict(seq=metadata['commit_seq'],id=metadata['commit_id']));prep['owners']['destination_uid']=os.getuid();relocation.prepare(prep)
        ir=fx.root/'intents';ir.mkdir(mode=0o700);intent_request=dict(v=1,preparation=prep,journal_root=str(ir));intent=publication.prepare_publication_intent(intent_request)['intent']
        sr=fx.root/'stages';sr.mkdir(mode=0o700);stage_request=dict(v=1,intent_request=intent_request,intent_digest=io.digest_record(intent),journal_root=str(sr));staged=stage.stage_relocation(stage_request)
        cr=fx.root/'cutovers';cr.mkdir(mode=0o700);cutover_request=dict(v=1,stage_request=stage_request,stage_digest=io.digest_record(staged['stage']),journal_root=str(cr));receipt=cutover.publish_relocation(cutover_request);binding=receipt['binding']
        store=Store(binding['db_path'],binding['instance_id'],expected_binding={k:binding[k] for k in profile.BINDING_FIELDS});destination=Path(binding['db_path']).parent
        pr=dict(v=1,destination_root=str(destination),output_dir=str(destination/'profiles λ'),publication_digest=io.digest_record(receipt),profiles=sources)
        presult=profiles.stage_destination_profiles(store,receipt,pr);praw=Path(presult['manifest_path']).read_text()
        hr=dict(v=1,output_root=str(destination),output_dir=str(destination/'hosted λ'),profiles_request=pr,profiles_result=presult,
            profiles_manifest_bytes=praw,profiles_manifest_digest=hashlib.sha256(praw.encode()).hexdigest(),actors=configs[:1] if omit else configs)
        hresult=hosted.stage_destination_hosted(store,receipt,hr);hraw=Path(hresult['manifest_path']).read_text()
        br=dict(v=1,output_root=str(destination),output_dir=str(destination/'broker λ'),profiles_request=pr,profiles_result=presult,
            profiles_manifest_bytes=praw,profiles_manifest_digest=hashlib.sha256(praw.encode()).hexdigest(),actors=[dict(actor_id='queue-a',source_route_path=str(qroute),source_route_bytes=qroute.read_text(),source_config_path=str(qconfig),source_config_bytes=qconfig.read_text(),broker_executable=str(cli))])
        bresult=broker.stage_destination_broker(store,receipt,br);braw=Path(bresult['manifest_path']).read_text();mraw=oldmap.read_text()
        request=dict(v=1,output_root=str(destination),output_dir=str(destination/"cold mixed map λ's $() [x]"),source_map_path=str(oldmap),source_map_bytes=mraw,source_map_digest=hashlib.sha256(mraw.encode()).hexdigest(),
            hosted=dict(request=hr,result=hresult,manifest_bytes=hraw,manifest_digest=hashlib.sha256(hraw.encode()).hexdigest()),
            broker=dict(request=br,result=bresult,manifest_bytes=braw,manifest_digest=hashlib.sha256(braw.encode()).hexdigest()))
        return dict(fx=fx,store=store,receipt=receipt,request=request,cli=cli,log=log,role_file=False)

    def setUp(self):self.use(self.new_case())
    def use(self,case):self.case=case;self.store=case['store'];self.receipt=case['receipt'];self.request=case['request']
    def output(self,request=None):return Path((request or self.request)['output_dir'])
    def preserved(self):
        fx=self.case['fx'];r=self.request
        roots={name:fx.bytes(fx.root/name) for name in ('original','control','old seats','intents','cutovers')}
        roots.update({k:fx.bytes(Path(r[k]['request']['output_dir'])) for k in ('hosted','broker')})
        roots['profiles']=fx.bytes(Path(r['hosted']['request']['profiles_request']['output_dir']))
        return self.store.path.read_bytes(),roots
    def call(self,request=None):
        result=maps.stage_destination_map(self.store,self.receipt,request or self.request)
        EVIDENCE['staged'].append({'test':self.id(),'result':result});return result
    def rejected(self,request=None,code=None,preserve=True):
        request=request or self.request;before=self.preserved()
        try:result=self.call(request)
        except (StoreError,AuthorityError) as error:
            if code:self.assertEqual(error.code,code)
            if preserve:self.assertEqual(before,self.preserved())
            return error
        output=self.output(request);document=json.loads((output/'routes.json').read_text());manifest=json.loads((output/'manifest.json').read_text())
        configs={}
        for actor,entry in manifest['destinations'].items():configs[actor]=json.loads(Path(entry['config']).read_text())
        EVIDENCE['prohibited_outputs'].append({'test':self.id(),'result':result,'output_exists':output.exists(),'documents':{'routes.json':document},'manifest':manifest,'referenced_configs':configs})
        self.fail('prohibited mixed map actually staged: '+result['status'])

    def test_exact_mixed_map_and_genuine_template_controller_preservation(self):
        before=self.preserved();submitted=copy.deepcopy(self.request);result=self.call();out=self.output();manifest=json.loads((out/'manifest.json').read_text())
        routes=json.loads((out/'routes.json').read_text());self.assertEqual(set(routes['routes']),{'managed-a','managed-b','queue-a'})
        self.assertEqual(routes,{'v':1,'routes':result['routes']});self.assertTrue(result['durability_confirmed'] and result['requires_adoption'])
        self.assertEqual(before,self.preserved());self.assertEqual(submitted,self.request)
        self.assertEqual(set(p.name for p in out.iterdir()),{'routes.json','manifest.json'});self.assertEqual(out.stat().st_mode&0o777,0o700)
        self.assertEqual({p.stat().st_mode&0o777 for p in out.iterdir()},{0o600})
        with sqlite3.connect(str(self.store.path)) as db:
            db.row_factory=sqlite3.Row;row=dict(db.execute("SELECT * FROM hosted_seats WHERE agent_id='managed-a'").fetchone())
            raw=db.execute("SELECT value FROM metadata WHERE key='hosted_control.v1:managed-a'").fetchone()[0]
        control=json.loads(raw);self.assertEqual(row['template_id'],'template-'+'a'*64);self.assertEqual(row['role'],ROLE)
        self.assertEqual((row['state'],row['stage'],row['inviter_id'],row['owner_id']),('ready','ready','fixture-owner','fixture-owner'))
        self.assertTrue(row['first_message_id'] and row['ready_seq']>0)
        self.assertEqual((control['owner_id'],control['desired'],control['revision']),('fixture-controller','stopped',2))
        self.assertIsInstance(control['changed_ms'],int);self.assertEqual(control['binding']['authority_epoch'],self.case['fx'].binding['authority_epoch'])
        EVIDENCE['preservation'].append({'test':self.id(),'whole_bytes_equal':True,'row':row,'control_bytes':raw,'manifest':manifest,'routes':routes})

    def test_coverage_family_rejects_authentic_parent_subset_missing_third_actor(self):
        self.use(self.new_case('omitted',omit=True));self.assertEqual(len(self.request['hosted']['request']['actors']),1)
        self.assertEqual(len(json.loads(self.request['source_map_bytes'])['routes']),3)
        self.rejected(code='MAP_COVERAGE_MISMATCH');self.assertFalse(self.output().exists())

    def test_global_uniqueness_family_rejects_authentic_cross_kind_shared_tuple(self):
        self.use(self.new_case('duplicate',duplicate=True))
        # Both authentic parent batches have valid own tuples; only the joint queue/hosted tuple conflicts.
        h=json.loads(self.request['hosted']['request']['actors'][0]['source_bytes']);q=json.loads(self.request['broker']['request']['actors'][0]['source_config_bytes'])
        self.assertEqual((h['codex_home'],h['thread_id']),(q['destination']['codex_home'],q['destination']['thread_id']))
        self.rejected(code='MAP_DESTINATION_CONFLICT');self.assertFalse(self.output().exists())

    def test_wrong_prior_source_association_is_held(self):
        request=copy.deepcopy(self.request);value=json.loads(request['source_map_bytes']);a,b='managed-a','managed-b'
        value['routes'][a],value['routes'][b]=value['routes'][b],value['routes'][a]
        request['source_map_bytes']=json.dumps(value);request['source_map_digest']=hashlib.sha256(request['source_map_bytes'].encode()).hexdigest()
        self.rejected(request,'MAP_COVERAGE_MISMATCH');self.assertFalse(self.output().exists())

    def test_original_confirmed_results_not_observation_are_required(self):
        for kind in ('hosted','broker'):
            request=copy.deepcopy(self.request);request[kind]['result']['durability_confirmed']=False
            with self.subTest(kind=kind):self.rejected(request,'MAP_DEPENDENCY_UNCONFIRMED');self.assertFalse(self.output().exists())

    def test_both_parent_requests_must_share_exact_profile_evidence(self):
        request=copy.deepcopy(self.request);request['broker']['request']['profiles_manifest_bytes']+=' '
        with self.assertRaises(StoreError):self.call(request)
        self.assertFalse(self.output().exists())

    def test_changed_actual_parent_config_refuses_without_new_output(self):
        path=Path(self.request['hosted']['request']['output_dir'])/'managed-a.hosted.json';path.write_bytes(path.read_bytes()+b' ')
        self.rejected();self.assertFalse(self.output().exists())

    def test_parent_pin_change_is_not_recovered_or_adopted(self):
        with sqlite3.connect(str(self.store.path)) as db:
            key,raw=db.execute("SELECT key,value FROM metadata WHERE key LIKE 'route_pin.v1:%' LIMIT 1").fetchone();value=json.loads(raw)
            value['destination']['thread_id']='99999999-2222-4333-8444-555555555555';db.execute('UPDATE metadata SET value=? WHERE key=?',(json.dumps(value),key))
        self.rejected();self.assertFalse(self.output().exists())

    def test_genuine_current_end_holds_entire_map(self):
        with sqlite3.connect(str(self.store.path)) as db:
            identity,version=db.execute("SELECT id,version FROM hosted_seats WHERE agent_id='managed-a'").fetchone()
        expected={'authority':{k:self.store.binding[k] for k in ('authority_id','authority_epoch')},'seat_revision':version}
        result=self.store.command('fixture-owner',dict(v=1,instance_id=self.store.instance_id,operation_id='genuine-end',kind='workspace.hosted_seat_end',
            target={'workspace_id':'private-work','seat_request_id':identity},expected=expected,args={}))
        self.assertEqual(result['status'],'committed',result);self.rejected(code='SEAT_ENDED');self.assertFalse(self.output().exists())

    def test_inspector_is_readonly_and_never_grants_adoption_or_durability(self):
        self.assertEqual(maps.inspect_destination_map(self.request)['status'],'not_started');self.call();before=self.preserved(),self.case['fx'].bytes(self.output())
        result=maps.inspect_destination_map(self.request);self.assertEqual(result['status'],'cold_map_observed');self.assertFalse(result['durability_confirmed']);self.assertTrue(result['requires_adoption'])
        self.assertEqual(before,(self.preserved(),self.case['fx'].bytes(self.output())))

    def test_new_map_still_receives_typed_normal_relocated_startup_refusal(self):
        self.call();pr=self.request['hosted']['request']['profiles_request'];runner=profile.load_profile(Path(pr['output_dir'])/'managed-a.profile.json');before=self.preserved()
        with self.assertRaises(route_pins.RoutePinError) as caught:broker_routes.load_route_table(self.output()/'routes.json',runner,selected_executable=str(self.case['cli']))
        self.assertEqual(caught.exception.code,'ROUTE_PIN_MISMATCH');self.assertEqual(before,self.preserved())
        EVIDENCE['startup_refusals'].append({'test':self.id(),'type':type(caught.exception).__name__,'code':caught.exception.code,'native_consumer':False})

    def test_old_private_paths_and_adoption_writers_are_not_used(self):
        fx=self.case['fx']
        for name in ('original','control','old seats','old home','intents','cutovers'):(fx.root/name).rename(fx.root/('retained-'+name))
        with mock.patch.object(broker,'stage_destination_broker',side_effect=AssertionError('generator')),mock.patch.object(hosted,'stage_destination_hosted',side_effect=AssertionError('generator')), \
             mock.patch.object(Store,'provision_route_pin',side_effect=AssertionError('pin write')),mock.patch.object(Store,'_provision_hosted_owner',side_effect=AssertionError('control write')), \
             mock.patch.object(seat_host.SeatHost,'_profile',side_effect=AssertionError('plan write')),mock.patch.object(seat_host.SeatHost,'_adopt',side_effect=AssertionError('adoption')), \
             mock.patch.object(cutover,'publish_relocation',side_effect=AssertionError('retry')):self.call()

    def test_existing_partial_output_is_never_repaired_or_renamed(self):
        self.output().mkdir(mode=0o700);sentinel=self.output()/'sentinel';sentinel.write_bytes(b'exact partial')
        self.rejected(code='MAP_OUTPUT_OCCUPIED');self.assertEqual(sentinel.read_bytes(),b'exact partial')
        self.assertEqual(maps.inspect_destination_map(self.request)['status'],'map_incomplete')

    def test_joint_manifest_budget_precedes_mkdir_and_observed_descriptor_collection(self):
        with mock.patch.object(maps,'MANIFEST_LIMIT',maps.DESCRIPTOR_RESERVE),mock.patch.object(maps,'_descriptors',side_effect=AssertionError('future facts')):
            self.rejected(code='MAP_OUTPUT_TOO_LARGE')
        self.assertFalse(self.output().exists());EVIDENCE['budget'].append({'preoutput_immutable_plus_reserve_refused':True,'future_descriptors_not_called':True})

    def test_final_descriptor_and_encoded_manifest_budget_are_checked_again(self):
        real=maps._descriptors
        def oversized(*args):return dict(real(*args),extra='x'*maps.DESCRIPTOR_RESERVE)
        with mock.patch.object(maps,'_descriptors',side_effect=oversized):self.rejected(code='MAP_OUTPUT_TOO_LARGE')
        self.assertTrue((self.output()/'routes.json').exists());self.assertFalse((self.output()/'manifest.json').exists())

    def test_unknown_duplicate_nonfinite_and_bad_source_digest_refuse(self):
        requests=[dict(self.request,foreign=True),dict(self.request,v=True),dict(self.request,source_map_digest='0'*64)]
        for raw in ('{"v":1,"v":1,"routes":{}}','{"v":1,"routes":{},"x":NaN}'):
            requests.append(dict(self.request,source_map_bytes=raw,source_map_digest=hashlib.sha256(raw.encode()).hexdigest()))
        for request in requests:
            with self.subTest(keys=sorted(request),raw=request['source_map_bytes']):self.rejected(request)
        self.assertFalse(self.output().exists())

    def test_overflow_and_path_overlap_refuse_without_output(self):
        self.rejected(dict(self.request,source_map_bytes='x'*(maps.MAP_LIMIT+1)))
        request=dict(self.request,output_root=str(Path(self.request['hosted']['request']['output_dir'])),output_dir=str(Path(self.request['hosted']['request']['output_dir'])/'overlap'))
        self.rejected(request,'MAP_PATH_OVERLAP');self.assertFalse(self.output(request).exists())

    def test_changed_output_bytes_modes_and_extra_entries_are_refused(self):
        self.call();path=self.output()/'routes.json';raw=path.read_bytes();path.write_bytes(raw+b' ')
        with self.assertRaises(StoreError):maps.inspect_destination_map(self.request)
        path.write_bytes(raw);path.chmod(0o644)
        with self.assertRaises(StoreError):maps.inspect_destination_map(self.request)
        path.chmod(0o600);(self.output()/'extra').mkdir(mode=0o700)
        with self.assertRaises(StoreError):maps.inspect_destination_map(self.request)

    def test_every_flush_fault_is_unconfirmed_and_retains_partial_artifacts(self):
        real=io.full_flush;seen=[]
        def observe(fd):seen.append(io.facts(os.fstat(fd)));return real(fd)
        with mock.patch.object(io,'full_flush',side_effect=observe):self.call()
        for ordinal in range(len(seen)):
            calls=[];request=dict(self.request,output_dir=str(Path(self.request['output_root'])/('flush-'+str(ordinal))))
            def fail(fd):
                calls.append(io.facts(os.fstat(fd)))
                if len(calls)==ordinal+1:raise OSError('flush uncertainty')
                return real(fd)
            with self.subTest(ordinal=ordinal),mock.patch.object(io,'full_flush',side_effect=fail):self.rejected(request)
            self.assertEqual(len(calls),ordinal+1);EVIDENCE['flush_faults'].append({'ordinal':ordinal,'reached':len(calls),'output_exists':self.output(request).exists()})

    def test_parent_change_after_map_write_prevents_confirmation(self):
        real=io.write_record;hit=[]
        def changed(path,value,*args):
            result=real(path,value,*args)
            if Path(path)==self.output()/'routes.json':
                hit.append(True);parent=Path(self.request['hosted']['request']['output_dir'])/'managed-a.hosted.json';parent.write_bytes(parent.read_bytes()+b' ')
            return result
        with mock.patch.object(io,'write_record',side_effect=changed):self.rejected(preserve=False)
        self.assertEqual(hit,[True]);self.assertFalse((self.output()/'manifest.json').exists())

    def test_current_transactions_are_closed_before_any_output_write(self):
        from aim_next import store as store_module
        connect=store_module._connect;connections=[];write=io.write_record
        def traced(*args,**kwargs):answer=connect(*args,**kwargs);connections.append(answer[0]);return answer
        def checked(path,value,*args):
            for db in connections:
                with self.assertRaises(sqlite3.ProgrammingError):db.execute('SELECT 1')
            return write(path,value,*args)
        with mock.patch.object(hosted,'_connect',side_effect=traced),mock.patch.object(broker,'_connect',side_effect=traced),mock.patch.object(io,'write_record',side_effect=checked):self.call()
        self.assertTrue(connections)

    def test_nested_parent_root_close_uncertainty_after_visible_manifest(self):
        real=os.close;identity=io.identity(io.checked(Path(self.request['output_root']),True));hit=[]
        def fail(fd):
            context=[dict(function=f.function,file=f.filename,line=f.lineno) for f in inspect.stack(context=0)]
            same=io.identity(os.fstat(fd))==identity and (self.output()/'manifest.json').exists();real(fd)
            if same and not hit:
                hit.append(True);EVIDENCE['close_faults'].append({'test':self.id(),'kind':'nested parent close','fd':fd,'context':context,'manifest_exists':True})
                raise OSError('nested parent close uncertainty')
        with mock.patch.object(os,'close',side_effect=fail):self.rejected(code='RECOVERY_UNCONFIRMED')
        self.assertEqual(hit,[True]);observed=maps.inspect_destination_map(self.request);self.assertEqual(observed['status'],'cold_map_observed');self.assertFalse(observed['durability_confirmed'])
        self.assertIn('inspect_destination_profiles',[f['function'] for f in EVIDENCE['close_faults'][-1]['context']])

    def test_exact_outer_root_fd_final_close_is_unconfirmed_with_complete_artifacts(self):
        real_opened=io.opened;real_close=os.close;target=[];events=[];root=Path(self.request['output_root'])
        @contextmanager
        def opened(path,directory=False):
            with real_opened(path,directory) as fd:
                if not target and Path(path)==root and directory:
                    target.append(fd);events.append({'event':'outer root captured','fd':fd,'identity':io.identity(os.fstat(fd)),
                        'context':[dict(function=f.function,file=f.filename,line=f.lineno) for f in inspect.stack(context=0)]})
                yield fd
        def close(fd):
            if target and fd==target[0]:
                self.assertTrue((self.output()/'manifest.json').exists())
                context=[dict(function=f.function,file=f.filename,line=f.lineno) for f in inspect.stack(context=0)]
                self.assertNotIn('_artifacts',[f['function'] for f in context])
                self.assertNotIn('_observed',[f['function'] for f in context])
                self.assertIn('stage_destination_map',[f['function'] for f in context])
                events.append({'event':'exact outer root final close','fd':fd,'context':context,'manifest_exists':True})
                real_close(fd);raise OSError('exact outer root close uncertainty')
            return real_close(fd)
        before=self.preserved()
        with mock.patch.object(io,'opened',side_effect=opened),mock.patch.object(os,'close',side_effect=close):self.rejected(code='RECOVERY_UNCONFIRMED')
        self.assertEqual(len(target),1);self.assertEqual([e['event'] for e in events],['outer root captured','exact outer root final close'])
        self.assertEqual(events[0]['fd'],events[1]['fd']);self.assertEqual(before,self.preserved())
        self.assertEqual(set(p.name for p in self.output().iterdir()),{'routes.json','manifest.json'})
        observed=maps.inspect_destination_map(self.request);self.assertEqual(observed['status'],'cold_map_observed');self.assertFalse(observed['durability_confirmed'])
        EVIDENCE['close_faults'].append({'test':self.id(),'kind':'exact outer root final close','events':events,'observed':observed,
            'complete_artifacts':self.case['fx'].bytes(self.output()),'whole_bytes_preserved':True,'code':'RECOVERY_UNCONFIRMED'})

    def test_original_three_identity_replacement_and_busy_authority_are_refused(self):
        fx=self.case['fx'];paths=[self.store.path,Path(str(self.store._authority.path)+'.lock'),Path(str(self.store._authority.path)+'.runner.lock')]
        for path in paths:
            with self.subTest(path=str(path)):
                old=path.with_name(path.name+'.retained');path.rename(old);path.write_bytes(old.read_bytes());path.chmod(0o600)
                try:self.rejected()
                finally:path.unlink();old.rename(path)
        fd=os.open(str(self.store._authority.path)+'.lock',os.O_RDWR)
        try:
            fcntl.flock(fd,fcntl.LOCK_EX|fcntl.LOCK_NB);self.rejected(code='AUTHORITY_BUSY');self.assertFalse(self.output().exists())
        finally:os.close(fd)


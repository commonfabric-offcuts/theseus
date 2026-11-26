from __future__ import annotations

import copy
import fcntl
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import sqlite3
import subprocess
import tempfile
import unittest
from unittest import mock

from aim_next import (Store, backup, broker_routes, codex_host, destination_hosted as hosted,
                      destination_profiles as profiles, hosted_notice, profile, recovery_io as io,
                      relocation, relocation_cutover as cutover, relocation_publication as publication,
                      relocation_stage as stage, seat_host)
from aim_next.authority import AuthorityError
import test_authority_relocation as fixture

AVAILABLE = importlib.util.find_spec('aim_next.destination_seats') is not None
if AVAILABLE: from aim_next import destination_seats as seats
EVIDENCE = {'staged': [], 'prohibited_outputs': [], 'shell': [], 'flush_faults': [], 'preservation': [], 'startup_refusals': [], 'fixture_setup': []}
THREADS = {'managed-a':'11111111-2222-4333-8444-555555555555','managed-b':'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee'}
ROLE = 'Keep exact role λ.\nPreserve trailing spaces.  '


class Availability(unittest.TestCase):
    def test_ready_seat_api_exists(self):
        self.assertTrue(AVAILABLE,'1332 API absent; not behavioral parity')


@unittest.skipUnless(AVAILABLE,'1332 absent; behavior bodies and targets unreached')
class SeatCase(unittest.TestCase):
    def new_case(self,label='A',ready=True,role_conflict=False,role_file=False):
        real=tempfile.TemporaryDirectory
        def temp(*args,**kwargs):
            kwargs.update(prefix=".1332 "+label+" λ's $(printf no) `echo no`; [x]-",dir=str(Path(__file__).resolve().parents[1]));return real(*args,**kwargs)
        fx=fixture.RelocationCase('test_no_active_database_and_original_lost_response_outcome_remains_identical');self.addCleanup(fx.doCleanups)
        with mock.patch.object(tempfile,'TemporaryDirectory',side_effect=temp):fx.setUp()
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
            for actor in (THREADS if ready else {'managed-a':THREADS['managed-a']}):
                with sqlite3.connect(str(fx.db)) as db:version=db.execute("SELECT version FROM workspaces WHERE id='private-work'").fetchone()[0]
                result=fx.store.command('fixture-owner',dict(v=1,instance_id=fx.store.instance_id,operation_id='add-'+actor,
                    kind='workspace.hosted_seat_add',target={'workspace_id':'private-work'},expected={'authority':authority,'workspace_revision':version},
                    args={'name':actor.replace('-',' ').title(),'role':ROLE}))
                self.assertEqual(result['status'],'committed',result);identity=result['result']['seat_request_id'];self.assertEqual(result['result']['agent']['id'],actor)
                folder=oldroot/identity;folder.mkdir(mode=0o700);cwd=folder/'work';cwd.mkdir(mode=0o700)
                old_profile=folder/(actor+'.profile.json');profile.write_profile(old_profile,fx.db,fx.store.instance_id,actor,binding=fx.binding)
                outbox=folder/(actor+'.outbox');outbox.mkdir(mode=0o700);io.write_record(outbox/'saved-request.json',{'operation_id':'retain-'+actor,'exact':'old bound request','binding':fx.binding})
                plan=dict(profile=str(old_profile),config=str(folder/'route.json'),cwd=str(cwd),cli='/retained source CLI',codex_home=str(home),
                    codex_executable='/usr/bin/python3',model='retained-model',reasoning_effort='high',permission_mode='full')
                io.write_record(folder/'request.json',dict(seat_id=identity,plan=plan))
                row=fx.store.hosted_seat_claim(guard,token)['seat'];self.assertEqual(row['id'],identity)
                row=fx.store.hosted_seat_step(guard,token,identity,row['version'],'profile',{'plan':plan})['seat']
                for phase in ('thread','starting','persist','persisting','pin','route','delivery')+ (('ready',) if ready else ()):
                    details={'thread_id':THREADS[actor]} if phase=='persist' else None
                    row=fx.store.hosted_seat_step(guard,token,identity,row['version'],phase,details)['seat']
                self.assertEqual((row['state'],row['stage']),('ready','ready') if ready else ('preparing','delivery'),row)
                stop=fx.store.command('fixture-owner',dict(v=1,instance_id=fx.store.instance_id,operation_id='stop-'+actor,kind='agent.execution',
                    target={'actor_id':actor},expected={'authority':authority,'execution_revision':1},args={'desired':'stopped'}));self.assertEqual(stop['status'],'committed',stop)
                config=dict(v=2,kind='codex-hosted-stdio',actor_id=actor,profile=str(old_profile),cli=plan['cli'],codex_executable=plan['codex_executable'],
                    codex_home=str(home),thread_id=THREADS[actor],cwd=str(cwd),model=plan['model'],writable_roots=[str(fx.db.parent),str(outbox)],
                    permission_mode='full',reasoning_effort='high',instructions='Conflicting role B.  ' if role_conflict and actor=='managed-a' else ROLE)
                io.write_record(folder/'route.json',config)
                sources.append(dict(source_path=str(old_profile),source_bytes=old_profile.read_text(),outbox_parent=str(folder)))
                configs.append(dict(actor_id=actor,source_path=str(folder/'route.json'),source_bytes=(folder/'route.json').read_text(),cli=str(cli)))
                records[actor]=dict(id=identity,source_request_path=str(folder/'request.json'),source_request_bytes=(folder/'request.json').read_text())
                EVIDENCE['fixture_setup'].append({'actor':actor,'seat_id':identity,'state':row['state'],'stage':row['stage'],
                    'first_message_id':row['first_message_id'],'ready_seq':row['ready_seq'],'native_consumer':False,'stop_revision':stop['result']['execution_revision']})
        fresh=backup.backup(fx.db,fx.store.instance_id,expected_binding=fx.binding,bundle_path=str(fx.root/'fresh bundle'));metadata=backup.inspect(fresh['bundle_path'])['metadata']
        prep=copy.deepcopy(fx.request);prep.update(bundle_path=fresh['bundle_path'],bundle_digest=fresh['bundle_digest'],commit=dict(seq=metadata['commit_seq'],id=metadata['commit_id']));prep['owners']['destination_uid']=os.getuid();relocation.prepare(prep)
        ir=fx.root/'intents';ir.mkdir(mode=0o700);intent_request=dict(v=1,preparation=prep,journal_root=str(ir));intent=publication.prepare_publication_intent(intent_request)['intent']
        sr=fx.root/'stages';sr.mkdir(mode=0o700);stage_request=dict(v=1,intent_request=intent_request,intent_digest=io.digest_record(intent),journal_root=str(sr));staged=stage.stage_relocation(stage_request)
        cr=fx.root/'cutovers';cr.mkdir(mode=0o700);cutover_request=dict(v=1,stage_request=stage_request,stage_digest=io.digest_record(staged['stage']),journal_root=str(cr));receipt=cutover.publish_relocation(cutover_request);binding=receipt['binding']
        store=Store(binding['db_path'],binding['instance_id'],expected_binding={k:binding[k] for k in profile.BINDING_FIELDS});destination=Path(binding['db_path']).parent
        pr=dict(v=1,destination_root=str(destination),output_dir=str(destination/'profiles λ'),publication_digest=io.digest_record(receipt),profiles=sources)
        presult=profiles.stage_destination_profiles(store,receipt,pr);praw=Path(presult['manifest_path']).read_text()
        hr=dict(v=1,output_root=str(destination),output_dir=str(destination/'hosted λ'),profiles_request=pr,profiles_result=presult,
            profiles_manifest_bytes=praw,profiles_manifest_digest=hashlib.sha256(praw.encode()).hexdigest(),actors=configs)
        hresult=hosted.stage_destination_hosted(store,receipt,hr);hraw=Path(hresult['manifest_path']).read_text()
        entries=[]
        for actor,record in records.items():
            with sqlite3.connect(str(store.path)) as db:
                db.row_factory=sqlite3.Row;current=dict(db.execute('SELECT * FROM hosted_seats WHERE id=?',(record['id'],)).fetchone());plan_bytes=current.pop('plan')
                control=db.execute('SELECT value FROM metadata WHERE key=?',('hosted_control.v1:'+actor,)).fetchone()[0]
            entry=dict(seat_id=record['id'],expected_version=current['version'],seat_snapshot=current,seat_digest=io.digest_record(current),
                plan_bytes=plan_bytes,plan_digest=hashlib.sha256(plan_bytes.encode()).hexdigest(),control_bytes=control,control_digest=hashlib.sha256(control.encode()).hexdigest(),
                source_request_path=record['source_request_path'],source_request_bytes=record['source_request_bytes'],source_request_digest=hashlib.sha256(record['source_request_bytes'].encode()).hexdigest())
            entries.append(entry)
        request=dict(v=1,output_root=str(destination),output_dir=str(destination/"cold seat requests λ's $() [x]"),hosted_request=hr,hosted_result=hresult,
            hosted_manifest_bytes=hraw,hosted_manifest_digest=hashlib.sha256(hraw.encode()).hexdigest(),seats=entries[:1])
        return dict(fx=fx,store=store,receipt=receipt,request=request,entries=entries,cli=cli,log=log,role_file=role_file)

    def use(self,case):self.case=case;self.store=case['store'];self.receipt=case['receipt'];self.request=case['request']
    def setUp(self):self.use(self.new_case())
    def output(self,request=None):return Path((request or self.request)['output_dir'])
    def preserved(self):
        fx=self.case['fx'];hr=self.request['hosted_request']
        return self.store.path.read_bytes(),{n:fx.bytes(fx.root/n) for n in ('original','control','old seats','intents','cutovers')},fx.bytes(Path(hr['profiles_request']['output_dir'])),fx.bytes(Path(hr['output_dir']))
    def call(self,request=None):
        result=seats.stage_destination_seats(self.store,self.receipt,request or self.request);EVIDENCE['staged'].append({'test':self.id(),'result':result});return result
    def rejected(self,request=None,code=None,preserve=True):
        request=request or self.request;before=self.preserved()
        try:result=self.call(request)
        except (io.RecoveryError,AuthorityError,route_pins_error()) as error:
            if code:self.assertEqual(error.code,code)
            if preserve:self.assertEqual(before,self.preserved())
            return error
        out=self.output(request);manifest=json.loads((out/'manifest.json').read_text());docs={str(p.relative_to(out)):json.loads(p.read_text()) for p in out.glob('seats/*/request.json')}
        configs={k:v['config'] for k,v in manifest['projections'].items()};actual={k:json.loads(Path(v['plan']['config']).read_text()) for k,v in manifest['projections'].items()}
        EVIDENCE['prohibited_outputs'].append({'test':self.id(),'result':result,'output_exists':out.exists(),'documents':docs,'manifest':manifest,'referenced_configs':actual,'projections':configs})
        self.fail('prohibited projection actually staged: '+result['status'])

    def test_real_ready_projection_preserves_all_bytes_and_exact_references(self):
        before=self.preserved();request=copy.deepcopy(self.request);result=self.call();entry=self.request['seats'][0];sid=entry['seat_id']
        value=json.loads((self.output()/'seats'/sid/'request.json').read_text());old=json.loads(entry['plan_bytes']);cfg=json.loads((Path(self.request['hosted_request']['output_dir'])/'managed-a.hosted.json').read_text())
        self.assertEqual(value,{'seat_id':sid,'plan':dict(old,profile=cfg['profile'],config=str(Path(self.request['hosted_request']['output_dir'])/'managed-a.hosted.json'),cli=cfg['cli'])})
        manifest=json.loads((self.output()/'manifest.json').read_text());self.assertEqual(manifest['projections'][sid]['role'],ROLE)
        control=json.loads(manifest['observations'][sid]['control_bytes']);self.assertEqual((control['owner_id'],control['desired'],control['revision']),('fixture-owner','stopped',2))
        self.assertEqual(before,self.preserved());self.assertEqual(request,self.request);self.assertTrue(result['durability_confirmed'] and result['requires_adoption'])
        self.assertEqual(entry['seat_snapshot']['state'],'ready');self.assertIsNotNone(entry['seat_snapshot']['first_message_id'])
        EVIDENCE['preservation'].append({'whole_bytes_equal':True,'control':control,'plan':old,'snapshot':entry['seat_snapshot'],'source_request':entry['source_request_bytes']})

    def test_ready_eligibility_family_rejects_genuine_delivery_stage_with_complete_witnesses(self):
        self.use(self.new_case('delivery-only',ready=False));row=self.request['seats'][0]['seat_snapshot']
        self.assertEqual((row['state'],row['stage'],row['first_message_id'],row['ready_seq']),('preparing','delivery',None,None))
        self.rejected(code='SEATS_NOT_READY');self.assertFalse(self.output().exists())

    def test_role_settings_family_rejects_authentic_hosted_B_against_ready_Core_A(self):
        self.use(self.new_case('role-conflict',role_conflict=True));self.assertEqual(self.request['seats'][0]['seat_snapshot']['role'],ROLE)
        config=json.loads((Path(self.request['hosted_request']['output_dir'])/'managed-a.hosted.json').read_text());self.assertEqual(config['instructions'],'Conflicting role B.  ')
        self.rejected(code='SEATS_PROVENANCE_CONFLICT');self.assertFalse(self.output().exists())

    def test_two_seat_subset_uses_distinct_exclusive_requests(self):
        request=copy.deepcopy(self.request);request['seats']=self.case['entries'];self.call(request)
        self.assertEqual(len(list(self.output().glob('seats/*/request.json'))),2)

    def test_missing_stale_wrong_actor_row_and_raw_digests_hold_batch(self):
        entry=self.request['seats'][0]
        for change in ({'expected_version':entry['expected_version']+1},{'seat_digest':'0'*64},{'plan_digest':'0'*64},{'control_digest':'0'*64}):
            request=copy.deepcopy(self.request);request['seats'][0].update(change)
            with self.subTest(change=change):self.rejected(request);self.assertFalse(self.output().exists())
        with sqlite3.connect(str(self.store.path)) as db:db.execute('UPDATE hosted_seats SET version=version+1 WHERE id=?',(entry['seat_id'],))
        self.rejected(code='SEATS_SNAPSHOT_STALE');self.assertFalse(self.output().exists())

    def test_source_request_seat_and_plan_conflicts_are_not_repaired(self):
        for key,value in (('seat_id','seat-'+'f'*32),('plan',{})):
            request=copy.deepcopy(self.request);entry=request['seats'][0];old=json.loads(entry['source_request_bytes']);old[key]=value
            entry['source_request_bytes']=json.dumps(old);entry['source_request_digest']=hashlib.sha256(entry['source_request_bytes'].encode()).hexdigest()
            with self.subTest(key=key):self.rejected(request);self.assertFalse(self.output().exists())

    def test_ending_and_disabled_actors_are_held(self):
        entry=self.request['seats'][0]
        with sqlite3.connect(str(self.store.path)) as db:db.execute("UPDATE actors SET enabled=0 WHERE id='managed-a'")
        self.rejected();self.assertFalse(self.output().exists())
        with sqlite3.connect(str(self.store.path)) as db:
            db.execute("UPDATE actors SET enabled=1 WHERE id='managed-a'");db.execute("UPDATE hosted_seats SET end_state='ending' WHERE id=?",(entry['seat_id'],))
        self.rejected();self.assertFalse(self.output().exists())

    def test_fresh_control_overflow_and_all_column_SQL_bounds_before_decoding(self):
        # Oversized current control and plan are mutable only in this isolated fault fixture.
        entry=self.request['seats'][0]
        with sqlite3.connect(str(self.store.path)) as db:db.execute('UPDATE metadata SET value=? WHERE key=?',('x'*9000,'hosted_control.v1:managed-a'))
        self.rejected(code='SEATS_SNAPSHOT_STALE');self.assertFalse(self.output().exists())
        with sqlite3.connect(str(self.store.path)) as db:db.execute('UPDATE metadata SET value=? WHERE key=?',(entry['control_bytes'],'hosted_control.v1:managed-a'))
        statements=[];connect=seats._connect
        def traced(path):
            db,facts=connect(path);db.set_trace_callback(statements.append);return db,facts
        with mock.patch.object(seats,'_connect',side_effect=traced):self.call()
        self.assertTrue(any('substr(CAST(role AS BLOB)' in q for q in statements));self.assertTrue(any('substr(CAST(plan AS BLOB)' in q for q in statements))
        self.assertFalse(any(q.startswith(('INSERT','UPDATE','DELETE','BEGIN IMMEDIATE','COMMIT')) for q in statements))

    def test_control_owner_stop_revision_and_binding_conflicts_cannot_default(self):
        entry=self.request['seats'][0];raw=entry['control_bytes']
        with sqlite3.connect(str(self.store.path)) as db:
            value=json.loads(raw);value['desired']='running';db.execute('UPDATE metadata SET value=? WHERE key=?',(json.dumps(value),'hosted_control.v1:managed-a'))
        self.rejected(code='SEATS_CONTROL_CONFLICT');self.assertFalse(self.output().exists())

    def test_unconfirmed_hosted_and_wrong_manifest_receipt_refuse(self):
        for change in ({'hosted_result':dict(self.request['hosted_result'],durability_confirmed=False)},{'hosted_manifest_digest':'0'*64}):
            with self.subTest(change=change):self.rejected(dict(self.request,**change));self.assertFalse(self.output().exists())
        with self.assertRaises(io.RecoveryError):seats.stage_destination_seats(self.store,dict(self.receipt,move_id='foreign'),self.request)
        self.assertFalse(self.output().exists())

    def test_old_private_paths_and_all_adoption_paths_are_unavailable(self):
        fx=self.case['fx']
        for name in ('original','control','old seats','old home','intents','cutovers'):(fx.root/name).rename(fx.root/('retained-'+name))
        with mock.patch.object(Store,'provision_route_pin',side_effect=AssertionError('pin writer')),mock.patch.object(Store,'_provision_hosted_owner',side_effect=AssertionError('control writer')), \
             mock.patch.object(seat_host.SeatHost,'_profile',side_effect=AssertionError('provision replay')),mock.patch.object(seat_host.SeatHost,'_adopt',side_effect=AssertionError('install')), \
             mock.patch.object(cutover,'publish_relocation',side_effect=AssertionError('old retry')):
            self.call()

    def test_real_trusted_parent_cli_argv_and_present_missing_role_settings(self):
        for case in (self.case,self.new_case('B',role_file=True)):
            with self.subTest(root=str(case['fx'].root)):
                result=seats.stage_destination_seats(case['store'],case['receipt'],case['request']);sid=case['request']['seats'][0]['seat_id'];projection=result['seats'][sid]
                cfg=projection['config'];command=hosted_notice.cli_command(cfg['cli'],cfg['profile'])+' binding'
                child=subprocess.run(['/bin/sh','-c',command],shell=False,capture_output=True,timeout=15);self.assertEqual(child.returncode,0,child.stderr.decode());seen=json.loads(case['log'].read_text())
                self.assertEqual(seen['argv'],['--profile',cfg['profile'],'binding']);self.assertEqual(seen['actor_id'],'managed-a');self.assertEqual(seen['binding']['authority_epoch'],case['store'].binding['authority_epoch'])
                loaded=profile.load_profile(cfg['profile']);obj=broker_routes.HostedConfig(str(Path(case['request']['hosted_request']['output_dir'])/'managed-a.hosted.json'),cfg['profile'],loaded,cfg['cli'],cfg['codex_executable'],
                    dict(kind=cfg['kind'],protocol_version=1,codex_home=cfg['codex_home'],thread_id=cfg['thread_id']),cfg['cwd'],cfg['model'],tuple(cfg['writable_roots']),cfg['permission_mode'],cfg['reasoning_effort'],cfg['instructions'])
                settings=codex_host.thread_settings(obj);self.assertEqual(settings['cwd'],cfg['cwd']);self.assertEqual(settings['model'],cfg['model']);self.assertEqual(settings['config']['model_reasoning_effort'],'high')
                self.assertEqual('Standing role:\n'+ROLE in settings['developerInstructions'],not case['role_file'])
                EVIDENCE['shell'].append({'root':str(case['fx'].root),'observed':seen,'command':command,'shell_argument':False,'settings':settings,'repository_role_present':case['role_file'],'helper_source':case['cli'].read_text(),'native_consumer':False})

    def test_relocated_startup_still_refuses_without_adoption(self):
        self.call();path=Path(self.request['hosted_request']['output_dir'])/'managed-a.hosted.json';before=self.store.path.read_bytes()
        try:broker_routes.load_hosted_config(path)
        except Exception as error:EVIDENCE['startup_refusals'].append({'code':getattr(error,'code',type(error).__name__),'native_consumer':False})
        else:self.fail('unadopted route was accepted')
        self.assertEqual(before,self.store.path.read_bytes())

    def test_existing_partial_output_is_never_repaired_or_replaced(self):
        self.output().mkdir(mode=0o700);sentinel=self.output()/'sentinel';sentinel.write_bytes(b'prior exact bytes')
        self.rejected(code='SEATS_OUTPUT_OCCUPIED');self.assertEqual(sentinel.read_bytes(),b'prior exact bytes')
        self.assertEqual(seats.inspect_destination_seats(self.request)['status'],'seats_incomplete')

    def test_inspector_is_read_only_observed_and_adoption_remains_required(self):
        self.assertEqual(seats.inspect_destination_seats(self.request)['status'],'not_started');self.call();before=self.preserved(),self.case['fx'].bytes(self.output())
        with mock.patch.object(io,'full_flush',side_effect=AssertionError('inspection flushed')):result=seats.inspect_destination_seats(self.request)
        self.assertEqual(result['status'],'cold_seats_observed');self.assertFalse(result['durability_confirmed']);self.assertTrue(result['requires_adoption']);self.assertEqual(before,(self.preserved(),self.case['fx'].bytes(self.output())))

    def test_changed_request_file_mode_and_unexpected_directory_are_refused(self):
        self.call();sid=self.request['seats'][0]['seat_id'];path=self.output()/'seats'/sid/'request.json';raw=path.read_bytes();path.write_bytes(raw+b' ')
        with self.assertRaises(io.RecoveryError):seats.inspect_destination_seats(self.request)
        path.write_bytes(raw);path.chmod(0o644)
        with self.assertRaises(io.RecoveryError):seats.inspect_destination_seats(self.request)

    def test_every_full_flush_fault_remains_unconfirmed_with_artifacts(self):
        real=io.full_flush;seen=[]
        def observe(fd):seen.append(io.facts(os.fstat(fd)));return real(fd)
        with mock.patch.object(io,'full_flush',side_effect=observe):self.call()
        for index in range(len(seen)):
            request=dict(self.request,output_dir=str(Path(self.request['output_root'])/('flush-'+str(index))));calls=[]
            def fail(fd):
                calls.append(io.facts(os.fstat(fd)))
                if len(calls)==index+1:raise OSError('injected flush uncertainty')
                return real(fd)
            with self.subTest(index=index),mock.patch.object(io,'full_flush',side_effect=fail):self.rejected(request)
            self.assertEqual(len(calls),index+1);EVIDENCE['flush_faults'].append({'index':index,'reached':len(calls),'output_exists':self.output(request).exists()})

    def test_manifest_failure_confirms_connections_closed_and_retains_partial(self):
        connect=seats._connect;write=io.write_record;connections=[]
        def traced(path):answer=connect(path);connections.append(answer[0]);return answer
        def fail(path,value,*args):
            for db in connections:
                with self.assertRaises(sqlite3.ProgrammingError):db.execute('SELECT 1')
            if Path(path).name=='manifest.json':raise OSError('manifest failure')
            return write(path,value,*args)
        with mock.patch.object(seats,'_connect',side_effect=traced),mock.patch.object(io,'write_record',side_effect=fail):self.rejected(code='SEATS_UNCONFIRMED')
        self.assertTrue(connections);self.assertFalse((self.output()/'manifest.json').exists());self.assertTrue(self.output().exists())

    def test_current_control_change_after_first_request_prevents_confirmation(self):
        real=io.write_record;hit=[]
        def changed(path,value,*args):
            result=real(path,value,*args)
            if Path(path).name=='request.json' and not hit:
                hit.append(True)
                with sqlite3.connect(str(self.store.path)) as db:db.execute('UPDATE metadata SET value=? WHERE key=?',('{}','hosted_control.v1:managed-a'))
            return result
        with mock.patch.object(io,'write_record',side_effect=changed):self.rejected(preserve=False)
        self.assertEqual(hit,[True]);self.assertFalse((self.output()/'manifest.json').exists())

    def test_final_root_close_uncertainty_keeps_observed_not_confirmed(self):
        real=os.close;identity=io.identity(Path(self.request['output_root']).stat());hit=[]
        def fail(fd):
            same=io.identity(os.fstat(fd))==identity and (self.output()/'manifest.json').exists();real(fd)
            if same and not hit:hit.append(True);raise OSError('close uncertainty')
        with mock.patch.object(os,'close',side_effect=fail):self.rejected()
        self.assertEqual(hit,[True]);self.assertTrue((self.output()/'manifest.json').exists());self.assertFalse(seats.inspect_destination_seats(self.request)['durability_confirmed'])

    def test_duplicate_unknown_unsafe_and_overlapping_requests_refuse(self):
        for request in (dict(self.request,seats=self.request['seats']*2),dict(self.request,seats=self.request['seats']*9),dict(self.request,v=True),dict(self.request,unknown=True),dict(self.request,output_dir=self.request['hosted_request']['output_dir'])):
            with self.subTest():self.rejected(request);self.assertFalse(self.output().exists())

    def test_busy_and_replaced_original_pairs_refuse(self):
        fd=os.open(str(self.store._authority.path)+'.lock',os.O_RDWR)
        try:fcntl.flock(fd,fcntl.LOCK_EX|fcntl.LOCK_NB);self.rejected(code='AUTHORITY_BUSY')
        finally:os.close(fd)
        for path in (self.store.path,Path(str(self.store._authority.path)+'.lock'),Path(str(self.store._authority.path)+'.runner.lock')):
            saved=Path(str(path)+'.held');path.rename(saved);path.write_bytes(saved.read_bytes());path.chmod(0o600)
            try:self.rejected();self.assertFalse(self.output().exists())
            finally:path.unlink();saved.rename(path)


def route_pins_error():
    from aim_next.route_pins import RoutePinError
    return RoutePinError


if __name__=='__main__':unittest.main()

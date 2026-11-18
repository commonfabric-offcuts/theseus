from __future__ import annotations

"""Focused synthetic contracts only. No browser, server, external API or suite."""
import copy
import hashlib
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
from tools import compose_forward as f, compose_groups as c, train, base_move as b, forward_admission as admission

ROOT=Path(__file__).resolve().parents[1]


def fixture():
    source={'head':'a'*40,'tree':'b'*40,'parents':['c'*40]}
    inv={'rows':[{'phase':'run','engine':'chromium','name':'chromium exact case'}],'hashes':{'web/a.mjs':'e'*64}}
    group=f.f779_groups(inv,source)[0]
    engines=[{'engine':'chromium','version':'synthetic-only'}]
    facts=[{'origin':'http://127.0.0.1:10001','instance_id':'synthetic-one'}, {'origin':'http://127.0.0.1:10002','instance_id':'synthetic-two'}]
    producer={'compose_deadline_775.mjs':'1'*64,'compose_worker_775.mjs':'2'*64,'run_compose_group.py':'3'*64}
    run={'id':'7','attempt':'1','workflow_sha':'d'*40,'workflow_ref':'repo/.github/workflows/checks.yml@refs/pull/1/merge','repository':'repo','job':'check','job_name':group['id']}
    binding={'product':source,'checkout':'/synthetic/owned','checkout_head':source['head'],'checkout_tree':source['tree'],
        'checkout_parents':source['parents'],'enumeration_hashes':inv['hashes'],'original_harness_sha256':f.f779_hash(b'original'),
        'instrumented_harness_sha256':f.f779_hash(b'patched'),'instrument_sha256':producer['compose_deadline_775.mjs'],
        'supervisor_sha256':producer['compose_worker_775.mjs'],'wrapper_sha256':producer['run_compose_group.py'],
        'actual_runtime':{'source_checkout':'/synthetic/owned','fixture_observations':facts,'browser_engines':engines}}
    rows=[{'name':'chromium exact case','passed':True}]
    phase='run:chromium/group:'+group['id']
    report={'results':rows,'harnessCompleted':False,'browserClosed':True,'fixtureExitCode':0,'fixtureExitSignal':None,
        'fixtureErrors':'','shortFixture':{'exitCode':0,'exitSignal':None,'errors':''},'plannedPhases':[phase], 'completedPhases':[phase],
        'scope775':{'originalWholeCompleted':False,'groupCompleted':True,'group':group['id'],'source':source,
        'cases_sha256':group['cases_sha256'],'completedCases':['chromium exact case'],'fixtures':facts,'runtime':engines}}
    worker={'event':'exit','terminal':False,'code':0,'observed_at':'synthetic'}
    receipt={'source':source,'group':group['id'],'cases_sha256':group['cases_sha256'],'binding':binding,'worker':worker,
        'retirement':{'wrapper_wait_returncode':0,'source_restored':True,'git_status':''}, 'results':[dict(rows[0],phase='run',engine='chromium')],
        'planned_cases':group['cases'], 'planned_group':group,'complete':True,'cleanup':True,'passed':True,'exit':0,'workflow_run':run,'unrun':[]}
    return dict(group=group,receipt=receipt,report=report,binding=binding,worker=worker,log='1 passed, 0 failed\n',source=source,
                hashes=inv['hashes'],original=b'original',patched=b'patched',producer=producer,run=run)


class Forward779(unittest.TestCase):
    def test_genuine_body_contract_synthetic_green(self):
        rows=f.f779_job(**fixture())
        self.assertEqual(len(rows),1)

    def test_refuses_raw_false_rewritten_green(self):
        data=fixture();data['report']['results'][0].update(passed=False,error='raw assertion')
        with self.assertRaisesRegex(f.ForwardRefused,'raw false/body'):
            f.f779_job(**data)

    def test_raw_mutant_stays_false(self):
        data=fixture()
        data['report']['results'][0].update(passed=False,error='caught mutant',expectedFailure=True,mutationCaught=True)
        data['receipt']['results'][0].update(data['report']['results'][0])
        data['receipt'].update(passed=False,exit=1)
        data['worker']['code']=1;data['receipt']['retirement']['wrapper_wait_returncode']=1
        data['log']='0 passed, 1 failed\n'
        rows=f.f779_job(**data)
        union=f.f779_fold([data['group']],[data['receipt']])
        self.assertFalse(union['passed']);self.assertEqual(union['raw_false'],rows)

    def test_retirement_requires_parent_exit(self):
        data=fixture();data['worker']['terminal']=True
        with self.assertRaisesRegex(f.ForwardRefused,'retirement'):
            f.f779_job(**data)

    def test_restoration_requires_observation(self):
        data=fixture();data['receipt']['retirement']['git_status']=' M web/a.mjs'
        with self.assertRaisesRegex(f.ForwardRefused,'restoration'):
            f.f779_job(**data)

    def test_source_binding_refuses_wrong_tree(self):
        data=fixture();data['binding']['checkout_tree']='f'*40
        with self.assertRaisesRegex(f.ForwardRefused,'checkout/input'):
            f.f779_job(**data)

    def test_attempt_binding_refuses_other_run(self):
        data=fixture();data['receipt']['workflow_run']=dict(data['run'],id='8')
        with self.assertRaisesRegex(f.ForwardRefused,'wrong run'):
            f.f779_job(**data)

    def test_unrun_refuses(self):
        data=fixture();data['report']['results']=[]
        with self.assertRaisesRegex(f.ForwardRefused,'unrun'):
            f.f779_job(**data)

    def test_provenance_is_observed(self):
        data=fixture();data['report']['scope775']['fixtures'][1]['origin']='http://0.0.0.0:2'
        with self.assertRaisesRegex(f.ForwardRefused,'fixture identity'):
            f.f779_job(**data)

    def test_inventory_partition_exact_identity_and_bounded(self):
        inv={'rows':[{'phase':p,'engine':e,'name':e+' case '+p+str(i)} for p in ('run','runSending') for e in ('chromium','webkit') for i in range(30)]}
        source=fixture()['source']
        groups=f.f779_groups(inv,source)
        self.assertEqual(groups,c.partition(inv,source)['groups'])
        self.assertEqual([f.f779_identity(r) for g in groups for r in g['cases']],[f.f779_identity(r) for r in inv['rows']])
        self.assertTrue(all(g['case_budget_seconds']<=4400 for g in groups))

    def test_exact_union_missing_and_duplicate_refuse(self):
        data=fixture()
        for offered in ([],[data['receipt'],data['receipt']]):
            with self.assertRaises(f.ForwardRefused):f.f779_fold([data['group']],offered)

    def test_plan_ordinary_once(self):
        g=fixture()['group'];compact={'id':g['id'],'source':g['source']}
        plan=[{'name':g['id'],'steps':'native-compose','compose_group':compact},{'name':'node','steps':'node-units'}]
        f.f779_plan(plan,['native-compose','node-units'],[g])
        with self.assertRaisesRegex(f.ForwardRefused,'ordinary'):
            f.f779_plan(plan+[plan[1]],['native-compose','node-units'],[g])

    def test_landing_combiner_recomputes_group(self):
        d=fixture();g=d['group'];job={'name':g['id'],'steps':'native-compose','compose_group':{'id':g['id'],'source':g['source']}}
        docs=[{'required':['native-compose'],'compose_group':job['compose_group'],'steps':[{'name':'native-compose','compose_receipt':d['receipt']}]}]
        steps,*_=train.combine_scoped_units(docs,[job],[{'shard':{'name':g['id']}}])
        self.assertEqual(steps,[f.f779_step(f.f779_fold([g],[d['receipt']]))])
        docs[0]['steps'][0]['compose_receipt']['results'].clear()
        with self.assertRaises(train.ScopedRefused):train.combine_scoped_units(docs,[job],[{'shard':{'name':g['id']}}])

    def test_ordinary_duplicate_still_refuses(self):
        docs=[{'required':['native-reader'],'steps':[{'name':'native-reader'}]}]*2
        with self.assertRaisesRegex(train.ScopedRefused,'two shards'):
            train.combine_scoped_units(docs,[],[])

    def test_paginated_duplicate_refuses(self):
        class API:
            def get(self,path):return {'total_count':101,'artifacts':[{'id':i} for i in range(100)] if 'page=2' not in path else [{'id':1}]}
        with self.assertRaisesRegex(b.Refused,'duplicate API'):
            admission.listing(API(),'synthetic','artifacts')

    def test_embedded_controller_contract_same_behavior(self):
        spec=importlib.util.spec_from_file_location('controller779',ROOT/'integrations/controller719/ci_known_reds.py')
        mod=importlib.util.module_from_spec(spec);spec.loader.exec_module(mod)
        self.assertEqual(mod.f779_job(**fixture()),f.f779_job(**fixture()))
        data=fixture();data['receipt']['retirement']['source_restored']=False
        with self.assertRaises(mod.ForwardRefused):mod.f779_job(**data)


if __name__=='__main__':
    unittest.main()


class ConsumerRoutes779(unittest.TestCase):
    def controller(self):
        spec=importlib.util.spec_from_file_location('controller779route',ROOT/'integrations/controller719/ci_known_reds.py')
        mod=importlib.util.module_from_spec(spec);spec.loader.exec_module(mod)
        return mod

    def test_landing_calls_forward_authentication(self):
        d=fixture();source={'run':7,'attempt':1,'tested_merge':{'sha':'d'*40,'tree':'b'*40,'first_parent':'c'*40,'second_parent':'a'*40},
            'base_at_run':{'ref':'release/live','sha':'c'*40},'files':{},'inventory':{},'audit':{},'controller':{},'compose':{'path':'/synthetic/packet','sha256':'0'*64}}
        api=type('API',(),{'get':lambda self,p:{'id':7,'head_sha':'a'*40,'status':'completed','conclusion':'success','run_attempt':1,'path':'.github/workflows/checks.yml','event':'pull_request','name':'Checks'}})()
        class Reached(Exception):pass
        with patch.object(b,'parents',return_value=['c'*40,'a'*40]),patch.object(b,'tree',return_value='b'*40),patch.object(b,'controller_binding',return_value={}),patch.object(b,'document',return_value={'version':2}),patch.object(admission,'validate',side_effect=Reached('actual forward authentication reached')) as verifier:
            with self.assertRaisesRegex(Reached,'authentication reached'):
                b.full_source(source,{'producer_runs':[{'id':7,'conclusion':'success'}]},None,api,'repo','a'*40,None)
            self.assertEqual(verifier.call_count,1)

    def test_verdict_consumer_recomputes_and_refuses_forged_aggregate(self):
        mod=self.controller();d=fixture();g=d['group'];inv={'rows':[{'phase':'run','engine':'chromium','name':'chromium exact case'}],'phases':['run:chromium'],'hashes':d['hashes']};d['report']['originalPlannedPhases']=['run:chromium']
        compact={'id':g['id'],'source':g['source']};plan=[{'name':g['id'],'steps':'native-compose','compose_group':compact}]
        source=d['source'];merge={'sha':source['head'],'tree':source['tree'],'first_parent':'c'*40,'second_parent':'d'*40}
        base={'ref':'release/live','sha':'c'*40}
        run=dict(d['run'],workflow='Checks',event='pull_request');run.pop('job');run.pop('job_name')
        profile={k:'synthetic' for k in mod.PROFILE_FIELDS}
        profile.update(python='synthetic',node='synthetic',chrome='synthetic')
        tools={'release_check':mod.blob(b'release-tool'),'harnesses':{},'python':'synthetic','node':'synthetic','chrome':'synthetic'}
        step={'name':'native-compose','tool':'tools/run_compose_group.py','passed':True,'exit':0,'counts':{'tests':1,'failed':0},'compose_receipt':d['receipt']}
        raw={'tool':mod.TOOL,'commit':source['head'],'checkout':'/synthetic/owned','tree_unchanged':True,'tree_after':{'head':source['head'],'changes':''},'only':['native-compose'],'required':['native-compose'],'steps':[step],'passed':True,'compose_group':compact,'tools':tools}
        union=f.f779_step(f.f779_fold([g],[d['receipt']]))
        summary={k:v for k,v in raw.items() if k not in ('only','compose_group')};summary.update(steps=[union],failed=[],combined_from=['check-0/summary.json'])
        with tempfile.TemporaryDirectory(prefix='forward779-consumer-') as temp:
            folder=Path(temp);shards=folder/'shards';out=shards/'check-0';native=out/'native/compose';native.mkdir(parents=True)
            def write(name,value): (native/name).write_text(json.dumps(value))
            for name,value in [('group.json',g),('group-receipt.json',d['receipt']),('native.json',d['report']),('source-binding.json',d['binding']),('worker-exit.json',d['worker'])]:write(name,value)
            (native/'native-compose.log').write_text(d['log'])
            (out/'summary.json').write_text(json.dumps(raw))
            receipt={'run':run,'shard':{'name':g['id'],'steps':['native-compose']},'base':base,'merge':merge,'summary_sha256':hashlib.sha256((out/'summary.json').read_bytes()).hexdigest(),'profile':profile}
            (out/'run.json').write_text(json.dumps(receipt))
            entry={'artifact':'check-0','commit':source['head'],'tree_unchanged':True,'tools':tools,'steps':['native-compose'],'receipt':receipt}
            prov={'run':run,'base':base,'merge':merge,'checked':{'commit':source['head'],'tree_unchanged':True},'required':['native-compose'],'plan':plan,'shards':[entry]}
            (folder/'provenance.json').write_text(json.dumps(prov));(folder/'summary.json').write_text(json.dumps(summary))
            with patch.object(mod,'REQUIRED',('native-compose',)),patch.object(mod,'NATIVE',{'native-compose':object()}),patch.object(mod,'REPLAY_FILE',None),patch.object(mod,'harnesses',return_value=[]),patch.object(mod,'source',return_value=b'release-tool'),patch.object(mod,'F779_PRODUCER',d['producer']),patch.object(mod,'f779_source',return_value=source),patch.object(mod,'f779_inventory',return_value=inv),patch.object(mod,'f779_patch',return_value=b'patched'),patch.object(mod,'f779_git',side_effect=lambda root,*args: b'original' if str(args[-1]).endswith('reader_compose_native.mjs') else {'compose_deadline_775.mjs':b'x','compose_worker_775.mjs':b'y','run_compose_group.py':b'z'}[str(args[-1]).split('/')[-1]]):
                # The fixture uses real matching digests for the reviewed producer inputs.
                producer={n:hashlib.sha256(x).hexdigest() for n,x in [('compose_deadline_775.mjs',b'x'),('compose_worker_775.mjs',b'y'),('run_compose_group.py',b'z')]}
                mod.F779_PRODUCER=producer
                d['binding'].update(instrument_sha256=producer['compose_deadline_775.mjs'],supervisor_sha256=producer['compose_worker_775.mjs'],wrapper_sha256=producer['run_compose_group.py'])
                # Shared objects above are re-serialized after changing the fixture's exact package hashes.
                write('source-binding.json',d['binding']);write('group-receipt.json',d['receipt'])
                (out/'summary.json').write_text(json.dumps(raw));receipt['summary_sha256']=hashlib.sha256((out/'summary.json').read_bytes()).hexdigest();(out/'run.json').write_text(json.dumps(receipt))
                (folder/'provenance.json').write_text(json.dumps(prov));(folder/'summary.json').write_text(json.dumps(summary))
                observed, checked=mod._read_evidence(folder/'summary.json',folder/'provenance.json',shards,ROOT,source['head'],run,base,merge)
                self.assertEqual(observed[0][1],d['receipt']['results'])
                summary['steps'][0]['counts']['tests']=99;(folder/'summary.json').write_text(json.dumps(summary))
                with self.assertRaisesRegex(mod.Refused,'fresh compose aggregate'):
                    mod._read_evidence(folder/'summary.json',folder/'provenance.json',shards,ROOT,source['head'],run,base,merge)


class ProducerPlan779(unittest.TestCase):
    def test_new_plan_has_bounded_groups_and_all_ordinary_steps_once(self):
        from tools import forward_plan,release_check
        d=fixture();inv={'rows':[{'phase':'run','engine':e,'name':e+' exact '+str(i)} for e in ('chromium','webkit') for i in range(2000)]}
        head='860a6c08913ac5f678663be42c680c17bf1dce0e'
        with patch.object(c,'enumerate_source',return_value=inv):
            result=forward_plan.plan(ROOT,'push',{},head)
        jobs=result['shards'];groups=[j for j in jobs if j.get('compose_group')]
        self.assertGreater(len(groups),256)
        ordinary=[n for j in jobs if not j.get('compose_group') for n in j['steps'].split(',')]
        self.assertEqual(sorted(ordinary+['native-compose']),sorted(release_check.REQUIRED))
        self.assertEqual([j['index'] for j in jobs],list(range(len(jobs))))
        # All three outputs together, with UTF-16 accounting, stay under the job output ceiling.
        outputs=sum(len(json.dumps(x).encode('utf-16-le')) for x in (jobs,jobs[:256],jobs[256:]))
        self.assertLess(outputs,1024*1024)

    def test_producer_combiner_recomputes_original(self):
        from tools import forward_plan
        d=fixture();g=d['group'];job={'name':g['id'],'steps':'native-compose','compose_group':{'id':g['id'],'source':g['source']}}
        docs=[{'compose_group':job['compose_group'],'steps':[{'name':'native-compose','compose_receipt':d['receipt']}]}]
        result=forward_plan.combine(docs,[job],[{'shard':{'name':g['id']}}])
        self.assertEqual(result,[f.f779_step(f.f779_fold([g],[d['receipt']]))])
        docs[0]['steps'][0]['compose_receipt']['results'][0]['passed']=False
        result=forward_plan.combine(docs,[job],[{'shard':{'name':g['id']}}])
        self.assertFalse(result[0]['passed'])


class Archive779(unittest.TestCase):
    def test_original_digest_upload_and_retirement_authenticated(self):
        from tools import authenticate_forward as a
        import io,zipfile
        with tempfile.TemporaryDirectory(prefix='forward779-archives-') as temp:
            root=Path(temp);shards=root/'shards';out=shards/'check-0';out.mkdir(parents=True);aggregate=root/'release-check';aggregate.mkdir()
            (out/'summary.json').write_text('{"synthetic":true}')
            (aggregate/'summary.json').write_text('{"synthetic":true}')
            (aggregate/'provenance.json').write_text(json.dumps({'plan':[{'name':'synthetic-group'}]}))
            archives={}
            for name,folder in [('check-0',out),('release-check',aggregate)]:
                buf=io.BytesIO()
                with zipfile.ZipFile(buf,'w') as z:
                    for filename in (['summary.json'] if name=='check-0' else ['summary.json','provenance.json']):z.writestr(filename,(folder/filename).read_bytes())
                archives[name]=buf.getvalue()
            sha='a'*40;repository={'id':1,'full_name':'repo'}
            run={'id':7,'run_attempt':1,'head_sha':sha,'path':'.github/workflows/checks.yml','name':'Checks','event':'pull_request','status':'completed','conclusion':'success','repository':repository,'head_repository':repository}
            jobs=[{'id':i,'run_id':7,'run_attempt':1,'head_sha':sha,'name':name,'status':'completed','conclusion':'success','completed_at':'2026-11-18T21:02:00Z','steps':[{'name':upload,'status':'completed','conclusion':'success','started_at':'2026-11-18T21:00:00Z'}]} for i,name,upload in [(1,'synthetic-group','Keep the evidence'),(2,"the whole run's summary","Keep the whole run's summary")]]
            artifacts=[{'id':i,'name':name,'expired':False,'digest':'sha256:'+hashlib.sha256(raw).hexdigest(),'size_in_bytes':len(raw),'created_at':'2026-11-18T21:01:00Z','workflow_run':{'id':7,'head_sha':sha,'repository_id':1,'head_repository_id':1}} for i,(name,raw) in enumerate(archives.items(),1)]
            record={'producer':{'head_repository':'repo','run_id':'7','run_attempt':'1','head_sha':sha,'event':'pull_request'}}
            def api(endpoint,raw=False):
                if raw:return archives[artifacts[int(endpoint.split('/')[-2])-1]['name']]
                if '/jobs?' in endpoint:return {'total_count':2,'jobs':jobs}
                if '/artifacts?' in endpoint:return {'total_count':2,'artifacts':artifacts}
                return run
            with patch.object(a,'api',side_effect=api):
                good=a.authenticate(record,shards,aggregate,root/'originals-green')
                self.assertEqual(len(good['archives']),2)
                for kind in ('digest','source','retirement','upload'):
                    saved=copy.deepcopy((artifacts,jobs,run))
                    if kind=='digest':artifacts[0]['digest']='sha256:'+'0'*64
                    if kind=='source':run['head_sha']='b'*40
                    if kind=='retirement':jobs[0]['conclusion']='timed_out'
                    if kind=='upload':artifacts[0]['created_at']='2026-11-18T21:03:00Z'
                    with self.subTest(kind=kind),self.assertRaises(ValueError):a.authenticate(record,shards,aggregate,root/('originals-'+kind))
                    artifacts[:],jobs[:],restored=saved;run.clear();run.update(restored)

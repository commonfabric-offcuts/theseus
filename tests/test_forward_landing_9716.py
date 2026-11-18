from __future__ import annotations

"""Complete offline landing: real Git, inventory/compiler, validators and ZIPs.

Only GitHub is a fabricated read-only API. Nothing executes a native case.
"""
import copy
import io
from pathlib import Path
import subprocess
import tempfile
import unittest
import zipfile

from tools import base_move as b, compose_forward as f, forward_admission as a, grouped_admission as g, release_check

ROOT = Path(__file__).resolve().parents[1]
HARNESS = b"""import {writeFile} from 'node:fs/promises';
import path from 'node:path';
const [chrome, evidence, filter = ''] = process.argv.slice(2);
const results=[];
let browser,engine;
const playwright=null;
const world=()=>null;
const fixture={stdin:{end(){}}},shortFixture=fixture;
const fixtureExit=Promise.resolve({code:0,signal:null}),shortExit=fixtureExit;
const facts={origin:'http://127.0.0.1:10001',instance_id:'synthetic-one'},shortFacts={origin:'http://127.0.0.1:10002',instance_id:'synthetic-two'};
const seed=async()=>{};
async function check(name,action){const full=`${engine} ${name}`;await action();results.push({name:full,passed:true});}
async function run(){await check('synthetic exact case',async()=>{});}
const ENGINES=['chromium','webkit'];
const PHASES=[[run]];
const plannedPhases = PHASES.flatMap(([phase]) => ENGINES.map(name => `${phase.name}:${name}`)), completedPhases = [];
let browserClosed = true, harnessCompleted = false;
try {
 await seed();
 for(const [phase,before] of PHASES){
 if (before) await before();
 for (engine of ENGINES) {
 browserClosed=false;
 browser = engine === 'chromium' ? await playwright.chromium.launch({ executablePath: chrome, headless: true }) : await playwright.webkit.launch({ headless: true });
 try { await phase(); } finally { await browser.close(); browserClosed = true; }
 completedPhases.push(`${phase.name}:${engine}`);
 }}
 harnessCompleted = true;
} finally {
 fixture.stdin.end();shortFixture.stdin.end();
 await Promise.all([fixtureExit, shortExit]);
 await writeFile(path.join(evidence,'native.json'),JSON.stringify({results,browserClosed, harnessCompleted, plannedPhases, completedPhases, synthetic:true}));
}
"""


class LandingPacket:
    repo = 'synthetic/offline'

    def __init__(self, root):
        self.root = Path(root); self.serial = 0
        self.checkout = self.root/'source'; self.checkout.mkdir()
        self.git('init', '-q')
        for name in a.PRODUCER:
            target = self.checkout/'tools'/name; target.parent.mkdir(exist_ok=True)
            target.write_bytes((ROOT/'tools'/name).read_bytes())
        target = self.checkout/'tests/reader_compose_native.mjs'; target.parent.mkdir()
        target.write_bytes(HARNESS)
        target = self.checkout/'.github/workflows/checks.yml'; target.parent.mkdir(parents=True)
        target.write_bytes(b'name: Checks\non: pull_request\n')
        self.git('add', '.')
        self.git('-c', 'core.hooksPath=/dev/null', '-c', 'user.name=synthetic', '-c', 'user.email=synthetic@localhost',
                 'commit', '-qm', 'offline synthetic source')
        self.git('config','user.name','synthetic');self.git('config','user.email','synthetic@localhost')
        self.git('branch','synthetic-base')
        self.git('-c','core.hooksPath=/dev/null','commit','--allow-empty','-qm','synthetic feature head')
        self.run_head = self.git('rev-parse','HEAD').stdout.strip()
        self.git('checkout','-q','synthetic-base')
        self.git('-c','core.hooksPath=/dev/null','commit','--allow-empty','-qm','synthetic advanced base')
        self.git('-c','core.hooksPath=/dev/null','merge','--no-ff','-qm','synthetic tested merge',self.run_head)
        self.head = self.git('rev-parse', 'HEAD').stdout.strip()
        self.source = f.f779_source(self.checkout, self.head)
        self.inventory = f.f779_inventory(self.checkout, self.head)
        self.patched = f.f779_patch(HARNESS)
        self.groups = f.f779_groups(self.inventory, self.source)
        self.producer = {n:b.digest((ROOT/'tools'/n).read_bytes()) for n in a.PRODUCER}
        self.anchor = {'run':7, 'attempt':1, 'tested_merge':{'sha':self.head, 'tree':self.source['tree'],
                       'first_parent':self.source['parents'][0], 'second_parent':self.run_head}}
        self.package = dict(producer=self.producer, workflow_head=self.run_head,
                            workflow_sha256=b.digest((target).read_bytes()), instrumented_sha256=b.digest(self.patched))
        self.package['review'] = self.review(self.package, 'fresh-compose-package', 'synthetic-package')
        self.packet = dict(version=2, product=self.source, package=self.doc(self.package), archives=[])
        self.api_run = dict(id=7, run_attempt=1, head_sha=self.run_head, head_branch='synthetic', event='pull_request',
                            name='Checks', path='.github/workflows/checks.yml', status='completed', conclusion='success', workflow_id=99,
                            repository={'id':1,'full_name':self.repo}, head_repository={'id':1,'full_name':self.repo})
        self.jobs = []; self.artifacts = []; self.source_files = {}; self.members = {}; self.receipts = []
        self.plan = []
        workflow_ref = self.repo+'/.github/workflows/checks.yml@refs/pull/1/merge'
        for i, group in enumerate(self.groups):
            self.plan.append(dict(name=group['id'], steps='native-compose', compose_group={'id':group['id'],'source':self.source}))
            run = dict(id='7', attempt='1', workflow_sha=self.run_head, workflow_ref=workflow_ref, repository=self.repo, job='check', job_name=group['id'])
            fixtures = [dict(origin='http://127.0.0.1:'+str(10001+j), instance_id='synthetic-'+str(j)) for j in range(2)]
            engines = [dict(engine=group['engine'],version='synthetic-only')]
            binding = dict(product=self.source, checkout=str(self.checkout), checkout_head=self.head, checkout_tree=self.source['tree'],
                           checkout_parents=self.source['parents'], enumeration_hashes=self.inventory['hashes'],
                           original_harness_sha256=b.digest(HARNESS), instrumented_harness_sha256=b.digest(self.patched),
                           instrument_sha256=self.producer['compose_deadline_775.mjs'], supervisor_sha256=self.producer['compose_worker_775.mjs'],
                           wrapper_sha256=self.producer['run_compose_group.py'],
                           actual_runtime=dict(source_checkout=str(self.checkout),fixture_observations=fixtures,browser_engines=engines))
            rows = [dict(name=r['name'],passed=True) for r in group['cases']]
            phase = group['phase']+':'+group['engine']+'/group:'+group['id']
            report = dict(results=rows,harnessCompleted=False,browserClosed=True,fixtureExitCode=0,fixtureExitSignal=None,
                          fixtureErrors='',shortFixture=dict(exitCode=0,exitSignal=None,errors=''),plannedPhases=[phase],completedPhases=[phase],
                          originalPlannedPhases=self.inventory['phases'],hashes={'tests/reader_compose_native.mjs':b.digest(self.patched)},
                          scope775=dict(originalWholeCompleted=False,groupCompleted=True,group=group['id'],source=self.source,
                                        cases_sha256=group['cases_sha256'],completedCases=[r['name'] for r in rows],fixtures=fixtures,runtime=engines))
            worker = dict(event='exit',terminal=False,code=0,observed_at='synthetic')
            receipt = dict(source=self.source,group=group['id'],cases_sha256=group['cases_sha256'],binding=binding,worker=worker,
                           retirement=dict(wrapper_wait_returncode=0,source_restored=True,git_status=''),
                           results=[dict(r,phase=group['phase'],engine=group['engine']) for r in rows],planned_cases=group['cases'],
                           planned_group=group,complete=True,cleanup=True,passed=True,exit=0,workflow_run=run,unrun=[])
            self.receipts.append(receipt)
            members = {'run.json':b.canonical({'shard':{'name':group['id']}})}
            for name,value in [('group.json',group),('group-receipt.json',receipt),('native.json',report),('source-binding.json',binding),('worker-exit.json',worker)]:
                members['native/compose/'+name] = b.canonical(value)
            members['native/compose/native-compose.log'] = b'1 passed, 0 failed\n'
            self.add_archive('check-'+str(i),group['id'],'Keep the evidence',members)
        ordinary = ','.join(s for s in release_check.REQUIRED if s!='native-compose')
        self.plan.append(dict(name='ordinary',steps=ordinary))
        self.add_archive('check-'+str(len(self.groups)),'ordinary','Keep the evidence',{'run.json':b.canonical({'shard':{'name':'ordinary'}})})
        summary = dict(required=list(release_check.REQUIRED),steps=[f.f779_step(f.f779_fold(self.groups,self.receipts))])
        self.add_archive('release-check',"the whole run's summary","Keep the whole run's summary",
                         {'summary.json':b.canonical(summary),'provenance.json':b.canonical({'plan':self.plan,'run':{'workflow_ref':workflow_ref}})})

    def git(self,*args):
        return subprocess.run(['git','-C',str(self.checkout),*args],check=True,capture_output=True,text=True)

    def file(self,raw):
        self.serial += 1; p = self.root/('evidence-'+str(self.serial)); p.write_bytes(raw)
        return {'path':str(p),'sha256':b.digest(raw)}

    def doc(self,value): return self.file(b.canonical(value))

    def review(self,body,kind,record):
        return self.doc(dict(version=1,reviewer='auditor',record=record,kind=kind,body_sha256=b.digest(b.canonical(body))))

    def add_archive(self,name,job_name,upload,members):
        ident = len(self.artifacts)+1
        self.members[name] = members
        self.jobs.append(dict(id=ident,name=job_name,run_id=7,run_attempt=1,head_sha=self.run_head,status='completed',conclusion='success',
                              completed_at='2026-11-18T21:03:00Z',steps=[dict(name=upload,status='completed',conclusion='success',started_at='2026-11-18T21:01:00Z')]))
        self.artifacts.append(dict(id=ident,name=name,expired=False,created_at='2026-11-18T21:02:00Z',
                                   workflow_run=dict(id=7,head_sha=self.run_head,head_branch='synthetic',repository_id=1,head_repository_id=1)))
        self.packet['archives'].append(dict(run=7,attempt=1,run_head=self.run_head,workflow_head=self.run_head,event='pull_request',
                                            job=ident,job_name=job_name,id=ident,name=name,archive={}))
        self.repack(name)

    def repack(self,name):
        stream = io.BytesIO()
        with zipfile.ZipFile(stream,'w') as z:
            for key,raw in self.members[name].items(): z.writestr(key,raw)
        raw = stream.getvalue()
        next(x for x in self.packet['archives'] if x['name']==name)['archive'] = self.file(raw)
        next(x for x in self.artifacts if x['name']==name).update(size_in_bytes=len(raw),digest='sha256:'+b.digest(raw))
        for key in list(self.source_files):
            if key.startswith(name+'/'): del self.source_files[key]
        self.source_files.update({name+'/'+key:self.file(raw) for key,raw in self.members[name].items()})

    def get(self,path):
        prefix = 'repos/'+self.repo+'/actions/'
        if path==prefix+'runs/7': return copy.deepcopy(self.api_run)
        if path==prefix+'workflows/99': return dict(id=99,name='Checks',path='.github/workflows/checks.yml')
        if path==prefix+'runs/7/attempts/1/jobs?per_page=100': return dict(total_count=len(self.jobs),jobs=copy.deepcopy(self.jobs))
        if path==prefix+'runs/7/artifacts?per_page=100': return dict(total_count=len(self.artifacts),artifacts=copy.deepcopy(self.artifacts))
        for meta in self.artifacts:
            if path==prefix+'artifacts/'+str(meta['id']): return copy.deepcopy(meta)
        raise AssertionError('unexpected synthetic API read: '+path)

    def validate(self):
        packet = copy.deepcopy(self.packet)
        packet['review'] = self.review(packet,'fresh-compose-admission','synthetic-admission')
        return a.validate(self.doc(packet),{'audit':'synthetic-judgment'},self.git,self,self.repo,self.head,self.anchor,self.source_files)


class FreshLanding9716(unittest.TestCase):
    def setUp(self):
        temp = tempfile.TemporaryDirectory(prefix='landing9716-'); self.addCleanup(temp.cleanup)
        self.packet = LandingPacket(temp.name)

    def test_complete_packet_through_real_validator_and_archive(self):
        got = self.packet.validate()
        self.assertTrue(got['complete']); self.assertTrue(got['passed']); self.assertFalse(got['admitted'])
        self.assertEqual(len(got['collector']['results']),2)

    def test_wrong_upload_role_in_both_directions(self):
        p = self.packet
        for index,label in [(-1,'Keep the evidence'),(0,"Keep the whole run's summary")]:
            old = p.jobs[index]['steps'][0]['name']; p.jobs[index]['steps'][0]['name'] = label
            with self.subTest(index=index),self.assertRaisesRegex(b.Refused,'upload'): p.validate()
            p.jobs[index]['steps'][0]['name'] = old

    def test_wrong_summary_job(self):
        p = self.packet; p.jobs[-1]['name']='ordinary'
        p.packet['archives'][-1]['job_name']='ordinary'
        with self.assertRaisesRegex(b.Refused,'summary|aggregate'): p.validate()

    def test_archive_summary_role_binds_exact_job_and_artifact(self):
        p = self.packet
        for key,value in [('name','check-99'),('job_name','ordinary')]:
            binding=copy.deepcopy(p.packet['archives'][-1]);binding[key]=value
            with self.subTest(key=key),self.assertRaisesRegex(b.Refused,'summary'):
                list(g.archive(binding,p.git,p,p.repo,role='summary'))

    def test_summary_upload_is_unique(self):
        p = self.packet;p.jobs[-1]['steps'].append(copy.deepcopy(p.jobs[-1]['steps'][0]))
        with self.assertRaisesRegex(b.Refused,'upload'):p.validate()

    def test_missing_summary(self):
        p = self.packet; p.packet['archives'].pop()
        p.artifacts.pop();p.jobs.pop()
        p.source_files={k:v for k,v in p.source_files.items() if not k.startswith('release-check/')}
        with self.assertRaisesRegex(b.Refused,'summary'): p.validate()

    def test_duplicate_summary(self):
        p = self.packet; duplicate=copy.deepcopy(p.packet['archives'][-1]);duplicate['id']=99
        p.packet['archives'].append(duplicate)
        duplicate=copy.deepcopy(p.artifacts[-1]);duplicate['id']=99;p.artifacts.append(duplicate)
        with self.assertRaisesRegex(b.Refused,'summary'): p.validate()

    def test_original_digest_and_run(self):
        p = self.packet
        for index in (0,-1):
            old = p.artifacts[index]['digest']; p.artifacts[index]['digest']='sha256:'+'0'*64
            with self.subTest(index=index,kind='digest'),self.assertRaisesRegex(b.Refused,'provenance'): p.validate()
            p.artifacts[index]['digest']=old
            p.artifacts[index]['workflow_run']['id']=8
            with self.subTest(index=index,kind='run'),self.assertRaisesRegex(b.Refused,'provenance'): p.validate()
            p.artifacts[index]['workflow_run']['id']=7

    def test_time_window_attempt_head_and_registered_workflow(self):
        p = self.packet
        for obj,key,value in [(p.artifacts[-1],'created_at','2026-11-18T21:04:00Z'),
                              (p.jobs[-1],'run_attempt',2),(p.api_run,'head_sha','0'*40),(p.api_run,'path','other.yml')]:
            old = obj[key]; obj[key]=value
            with self.subTest(key=key),self.assertRaises(b.Refused): p.validate()
            obj[key]=old

    def test_repackaged_source_refuses(self):
        p = self.packet; p.source_files['release-check/summary.json']=p.file(b'{}')
        with self.assertRaisesRegex(b.Refused,'repackaged'): p.validate()

    def test_original_raw_false_cleanup_and_exact_case_guards(self):
        p = self.packet; name='check-0'; key='native/compose/native.json'; original=p.members[name][key]
        for kind in ('raw-false','cleanup','missing-case'):
            report=b.loads(original)
            if kind=='raw-false': report['results'][0].update(passed=False,error='synthetic raw red')
            if kind=='cleanup': report['browserClosed']=False
            if kind=='missing-case': report['results']=[]
            p.members[name][key]=b.canonical(report);p.repack(name)
            with self.subTest(kind=kind),self.assertRaises(f.ForwardRefused): p.validate()
        p.members[name][key]=original;p.repack(name)

    def test_ordinary_step_inventory_stays_exact(self):
        p = self.packet; key='provenance.json'
        provenance=b.loads(p.members['release-check'][key]);provenance['plan'][-1]['steps']+=',node-units'
        p.members['release-check'][key]=b.canonical(provenance);p.repack('release-check')
        with self.assertRaisesRegex(f.ForwardRefused,'ordinary'): p.validate()

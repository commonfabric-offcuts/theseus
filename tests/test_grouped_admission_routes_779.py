from __future__ import annotations

"""Focused legacy and route wiring controls, entirely synthetic/local.

Reuse fixture bytes only. No production defaults, profile creation/read, network,
GitHub, deploy, server, process inspection or signals. Local origin transfers
use fetch+update-ref; no push executable is ever invoked.
"""
import copy
import io
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch
from contextlib import ExitStack

ROOT=Path(__file__).resolve().parents[1]
fixture_root = None
sys.path[:0]=[str(ROOT),str(ROOT/'tests')]
import test_tools_deploy as td
import test_tools_train as tt
import test_tools_continuation_envelope as tc
import test_tools_base_move as tb
from tools import base_move as b, grouped_admission as g, deploy, train, ci_known_reds as ci
real_run=subprocess.run

def offline_run(argv, **kw):
    if not argv or argv[0]!='git': raise AssertionError('offline driver forbids external command '+repr(argv))
    assert '-C' in argv
    where=Path(argv[argv.index('-C')+1]).resolve()
    assert where==fixture_root or fixture_root in where.parents, ('unowned Git root',str(where))
    assert 'push' not in argv, 'no push executable permitted'
    return real_run(argv,**kw)

old_git=tt.Repositories.git

def local_git(self, where, *args):
    if args and args[0]=='push':
        target=args[-1]; src,dst=target.split(':',1)
        sha=old_git(self,where,'rev-parse',src)
        old_git(self,self.origin,'fetch','-q',str(where),sha)
        return old_git(self,self.origin,'update-ref',dst,sha)
    return old_git(self,where,*args)


def synthetic_setup(self):
    self.tmp=tempfile.TemporaryDirectory(prefix='fixture-',dir=str(fixture_root))
    base=Path(self.tmp.name); self.instance=base/'instance'; self.instance.mkdir()
    self.raw={'live':str(base/'live'),'instance':str(self.instance),'server_profile':'never-read.invalid',
              'port':5192,'runner_profile':'never-read-runner.invalid','runner_id':'synthetic','routes':'never-read-routes.invalid'}
    self.config_path=base/'config.json'; self.config_path.write_text(json.dumps(self.raw))
    self.config=deploy.load_config(self.config_path); self.evidence=base/'evidence'; self.kills=[]
    self.summary=base/'summary.json'; self.summary.write_text('{}')

class Routes(unittest.TestCase):
    def setUp(self):
        global fixture_root
        root = tempfile.TemporaryDirectory(prefix='offline-roots779-')
        self.addCleanup(root.cleanup)
        fixture_root = Path(root.name).resolve()
        stack = ExitStack()
        self.addCleanup(stack.close)
        stack.enter_context(patch.object(td.DeployCase, 'setUp', synthetic_setup))
        stack.enter_context(patch.object(tt.Repositories, 'git', local_git))
        stack.enter_context(patch.object(subprocess, 'run', offline_run))
        stack.enter_context(patch.object(deploy, 'deploy', side_effect=AssertionError('sentinel: deployment forbidden')))
        stack.enter_context(patch.object(train.GhCli, 'get', side_effect=AssertionError('sentinel: real GitHub forbidden')))

    def legacy(self):
        f=tc.Continuation('runTest'); f.setUp(); self.addCleanup(f.doCleanups); self.addCleanup(f.tearDown)
        return f

    def test_legacy_partial_truth_unchanged(self):
        f=self.legacy(); r=f.consume()
        self.assertTrue(r['complete']); self.assertFalse(r['passed']); self.assertEqual(r['red_count'],1)

    def test_legacy_source_mismatch_still_refuses(self):
        f=self.legacy(); f.payloads['check-1']['native/journal/source/'+ci.NATIVE[f.finished].harness]=b'changed'
        f.freeze_envelope()
        with self.assertRaisesRegex(b.Refused,'source hash/archive'): f.consume()

    def test_legacy_protected_controller_still_refuses_wrong_app(self):
        f=self.legacy(); f.api['repos/'+tt.REPOSITORY+'/check-runs/201']['app']['id']=1
        with self.assertRaisesRegex(b.Refused,'untrusted Verdict App'): f.consume()

    def test_normal_fullchecks_recomputes_775_aggregate_and_exact_group_assignment(self):
        f=tb.BaseMoveFixture('runTest');f.setUp();self.addCleanup(f.doCleanups);self.addCleanup(f.tearDown)
        source=f.evidence_body['source']
        raw=b.document(f.files['check-0/summary.json']); receipt=b.document(f.files['check-0/run.json'])
        summary=b.document(f.files['release-check/summary.json']);prov=b.document(f.files['release-check/provenance.json'])
        group_receipts=[]
        regular=[step for step in raw['steps'] if step['name']!='native-compose']
        newplan=[{'name':'regular','steps':','.join(step['name'] for step in regular)}]
        shards=[]
        def save_shard(index,steps,part):
            folder='check-%d'%index;doc=dict(raw,steps=steps,only=[step['name'] for step in steps],passed=all(x['passed'] for x in steps))
            f.files[folder+'/summary.json']=f.save(folder+'/summary.json',doc)
            rec=copy.deepcopy(receipt);rec.update(shard={'name':newplan[index]['name'],'steps':doc['only']},summary_sha256=f.files[folder+'/summary.json']['sha256'])
            f.files[folder+'/run.json']=f.save(folder+'/run.json',rec)
            shards.append({'artifact':folder,'receipt':rec,'refused':None,'commit':f.tested,'tree_unchanged':True,'tools':raw['tools'],'steps':doc['only']})
        save_shard(0,regular,None)
        for i,gid in enumerate(['synthetic-group-a','synthetic-group-b'],1):
            gr={'group':gid,'source':{'head':f.tested},'cases_sha256':'synthetic','complete':True,'cleanup':True,
                'results':[{'name':gid,'phase':'run','engine':'chromium','passed':True}],'exit':0,'passed':True}
            group_receipts.append(gr);newplan.append({'name':gid,'steps':'native-compose','compose_group':{'id':gid}})
            step={'name':'native-compose','tool':'tools/run_compose_group.py','passed':True,'exit':0,'counts':{'tests':1,'failed':0},'compose_receipt':gr}
            save_shard(i,[step],gr)
        union={'complete':True,'passed':True,'missing_groups':[],'results':[r for x in group_receipts for r in x['results']],
               'raw_false':[],'expected_mutants':[],'receipts':group_receipts,'admitted':False}
        step={'name':'native-compose','tool':'compose-group-union-775','passed':True,'exit':0,'counts':{'tests':2,'failed':0},'compose_union':union,'shards':group_receipts}
        summary.update(steps=regular+[step],combined_from=[x['artifact']+'/summary.json' for x in shards])
        prov.update(plan=newplan,shards=shards)
        f.files['release-check/summary.json']=f.save('fullchecks-summary.json',summary)
        f.files['release-check/provenance.json']=f.save('fullchecks-provenance.json',prov)
        source['compose']=f.save('fullchecks-compose.json',{'synthetic':'module authentication tested separately'})
        f.freeze_audit(); audit=b.document(source['audit']);audit['compose_sha256']=source['compose']['sha256'];source['audit']=f.save('fullchecks-audit.json',audit)
        judgment={'head':f.head,'producer_runs':[f.github.answers['repos/'+tt.REPOSITORY+'/actions/runs/101']],
                  'verdict_checks':[f.github.answers['repos/'+tt.REPOSITORY+'/check-runs/201']],'audit':'m-original-audit'}
        git=lambda *args: subprocess.run(['git','-C',str(f.live),*args],capture_output=True,text=True)
        proof={'collector':union,'passed':True}
        with patch.object(g,'validate',return_value=proof) as checked,patch.object(g,'record',side_effect=lambda p:p):
            got=b.full_source(source,judgment,git,f.github,tt.REPOSITORY,f.head,None)
            self.assertFalse(got['passed']);self.assertEqual(got['red_count'],1)
            self.assertEqual(checked.call_args.kwargs,{'mode':'fullChecks'})
            self.assertEqual(checked.call_args.args[-2],f.tested)
            # A forged aggregate cannot be accepted because the receipt union is authentic.
            summary['steps'][-1]['compose_union']['passed']=False
            f.files['release-check/summary.json']=f.save('forged-fullchecks.json',summary)
            with self.assertRaisesRegex(b.Refused,'genuine 775 collector'):b.full_source(source,judgment,git,f.github,tt.REPOSITORY,f.head,None)

    def test_train_fullchecks_route_binds_current_base_and_persists_evidence(self):
        f=self.legacy()
        f.api['repos/'+tt.REPOSITORY+'/actions/runs/101']['head_sha']=f.assembly
        f.api['repos/'+tt.REPOSITORY+'/check-runs/201']['head_sha']=f.assembly
        full={'compose':f.save('future-compose.json',{}),'base_at_run':{'ref':tt.BRANCH,'sha':f.L},'tested_merge':{'tree':f.tree(f.assembly)}}
        source_ref=f.save('future-fullchecks.json',full)
        data={'pr':31,'merge_commit':f.merged,'merged_tree':f.tree(f.merged),'kind':'judged-first',
              'items':[{'item':779,'approved_head':f.head,'review':'synthetic'}],'hosted_run':None,
              'judgment':{'producer_runs':[101],'verdict_checks':[201],'audit':'synthetic'},'full_checks':source_ref}
        path=Path(f.tmp.name)/'future-train.json';path.write_bytes(b.canonical(data))
        git=lambda *args:subprocess.run(['git','-C',str(f.live),*args],capture_output=True,text=True)
        observed={'controller':{'current_base':full['base_at_run']},'passed':False,'compose':{'complete':True,'passed':False}}
        with patch.object(b,'full_source',return_value=observed) as validate:
            result=train.judge(path,f.merged,f.L,tt.BRANCH,tt.REPOSITORY,git,f.github)
        self.assertEqual(result['full_checks'],{'evidence':source_ref,'observed':observed});validate.assert_called_once()
        self.assertEqual(validate.call_args.args[-2],f.assembly)
        self.assertEqual(deploy.releases.train_measurements(result)['train']['full_checks'],result['full_checks'])
        full['base_at_run']['sha']=f.old;data['full_checks']=f.save('stale-fullchecks.json',full);path.write_bytes(b.canonical(data))
        with patch.object(b,'full_source',side_effect=AssertionError('must refuse stale base before source validation')):
            with self.assertRaisesRegex(train.Refused,'stale source/base'):train.judge(path,f.merged,f.L,tt.BRANCH,tt.REPOSITORY,git,f.github)

    def test_v2_routes_only_the_compose_obligation_and_keeps_original_red(self):
        f=self.legacy()
        # Restore the previously missing light mode into its original complete
        # shard; the cut shard now lacks only compose. All other validators run.
        raw=b.loads(f.payloads['check-0']['summary.json'])
        compose=next(s for s in raw['steps'] if s['name']=='native-compose')
        raw['steps'].remove(compose)
        light=b.loads(f.payloads['completion/check-0']['summary.json'])['steps'][0]
        raw['steps'].append(light); raw['only']=[s['name'] for s in raw['steps']]
        raw['commit']=f.tested; raw['tree_after']={'head':f.tested,'changes':''}
        f.payloads['check-0'].pop('native/compose/native.json',None)
        f.payloads['check-0'].pop('native-compose.log',None)
        for key,value in f.payloads['completion/check-0'].items():
            if key=='native-light.log' or key.startswith('native/light/'):
                f.payloads['check-0'][key]=value
        f.payloads['check-0']['summary.json']=b.canonical(raw)
        receipt=b.loads(f.payloads['check-0']['run.json']); receipt['shard']['steps']=raw['only']; receipt['summary_sha256']=b.digest(b.canonical(raw))
        f.payloads['check-0']['run.json']=b.canonical(receipt)
        partial=b.loads(f.payloads['check-1']['run.json']); partial['shard']['steps']=[f.finished,'native-compose']
        f.payloads['check-1']['run.json']=b.canonical(partial)
        summary=b.loads(f.payloads['release-check']['summary.json'])
        summary['steps']=[s for s in summary['steps'] if s['name']!='native-compose']+[light]
        summary.update(missing=['native-compose'],failed=[f.finished,'native-compose'])
        f.payloads['release-check']['summary.json']=b.canonical(summary)
        prov=b.loads(f.payloads['release-check']['provenance.json']);prov['plan']=[{'name':'complete','steps':','.join(raw['only'])},{'name':'cut','steps':f.finished+',native-compose'}]
        f.payloads['release-check']['provenance.json']=b.canonical(prov)
        f.auth['plan']=[{'name':'compose-union-779','steps':['native-compose']}]
        f.env['version']=2
        f.payloads['completion/check-0']={'synthetic-group.json':b'{}'}
        f.refresh_provenance();f.freeze_envelope()
        ref=f.env['completion']['archives'][0]
        packet={'original_anchor':{'partial_dispatch':{'literal':'synthetic'}},'groups':[{'binding':dict(ref,run=103,attempt=1,workflow_head=f.wrapper)}],
                'package':f.save('synthetic-package.json',{'workflow_head':f.wrapper,'workflow':f.auth['workflow']})}
        f.env['compose']=f.save('synthetic-compose-packet.json',packet)
        f.evidence_body['source']['continuation']=f.save('continuation-v2.json',f.env)
        proof={'complete':True,'passed':False,'raw_false':[{'origin':'original','row':{'passed':False}}]}
        with patch.object(g,'validate',return_value=proof) as checked, patch.object(g,'record',side_effect=lambda p:p):
            r=f.consume()
        self.assertTrue(r['complete']);self.assertFalse(r['passed']);self.assertEqual(r['compose'],proof)
        self.assertEqual(r['red_count'],1);self.assertIn('native-compose',r['failed']);checked.assert_called_once()
        # The same v2 shape cannot route a second uncompleted logical step.
        prov['plan'][1]['steps']+=',native-live'
        f.payloads['release-check']['provenance.json']=b.canonical(prov)
        f.refresh_provenance();f.freeze_envelope()
        f.env['compose']=f.save('synthetic-compose-packet.json',packet)
        f.evidence_body['source']['continuation']=f.save('continuation-v2-bad.json',f.env)
        with patch.object(g,'validate',return_value=proof), patch.object(g,'record',side_effect=lambda p:p), self.assertRaises((b.Refused,ci.Refused)):
            f.consume()

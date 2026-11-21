from __future__ import annotations

from tests import own_receipt_fixtures as portable

"""Exact Git source and SYNTHETIC API/ZIP positives; archive parsing is REPLAY.

No browser, fixture, hosted request, installation or source admission is run.
"""
import copy
import hashlib
import json
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest import mock
import zipfile

from tests import test_tools_own_receipt_families as families
from tools import base_move as b, own_case_receipt as own
from tools import ci_known_reds as ci

FIX = json.loads((Path(__file__).parent / 'fixtures/own_profiles_8821.json').read_bytes())
EVIDENCE = portable.evidence()


class LiteralControls:
    @classmethod
    def setUpClass(cls):
        cls.head = FIX['train48']['head']
        cls.tree = FIX['train48']['tree']
        cls.wrapper = families.wrapper_for(cls.head, cls.step, cls.item)

    def setUp(self):
        self.building = True
        families.FamilyControls.setUp(self)
        self.building = False
        self.report['hashes'] = {p: FIX['train48']['sources'][p] for p in FIX['snapshots'][self.step]}
        names = FIX['cases'][self.item]
        self.report['results'] = [dict(name=n.replace('colors ', self.mode + ' ', 1) if self.item == '656' else n,
                                       passed=True, **({'engine':'webkit','ms':1} if self.webkit else {})) for n in names]
        self.f.expected = [('native-'+self.step,r['name'],None,self.engine) for r in self.report['results']]
        self.phases = {'started':1,'fixtureReady':2,'browserReady':3,'reportingStarted':1000,'reportingEnded':1001,
            'cases':[dict(name=r['name'],started=4+4*i,actionStarted=5+4*i,actionEnded=6+4*i,cleanupEnded=7+4*i)
                     for i,r in enumerate(self.report['results'])]}
        self.sync()

    archive = families.FamilyControls.archive
    source_change = families.FamilyControls.source_change

    def sync(self):
        families.FamilyControls.sync(self)
        if self.building or self.item != '656': return
        log = [json.loads(r) for r in self.members[self.log_member].splitlines()]
        out = []
        for i,r in enumerate(self.report['results']):
            if not self.webkit: out.append(log[2*i])
            if i == 0:
                o=FIX['oldhead']
                out.extend([dict(item=656,oldhead=o['head'],red_source=o['red_source'],fixed_source=o['fixed_source'],
                                 caught='permission rebuild restores the header title',exact_restoration=True),
                            dict(item=656,oldhead=o['head'],restored_control_passed=True)])
            elif i == 65: out.append(dict(item=656,base_screenshots='833d2a153f6fb98ff41c63f0736791f76a1188a8',restored=True))
            elif i >= 66 and i < 71:
                name,pins=FIX['mutants'][i-66]
                out.append(dict(item=656,mutation=name,failed_case='synthetic intended title failure'))
                out.extend(dict(item=656,mutation=name,file='/synthetic/'+p,before=before,mutated=mutated,
                                caught='synthetic intended title failure') for p,before,mutated in pins)
                out.append(dict(item=656,mutation=name,restored_control_passed=True))
            out.append(log[i] if self.webkit else log[2*i+1])
        self.members[self.log_member]= ('\n'.join(json.dumps(r) for r in out)+'\n').encode()
        self.archive()

    def log_change(self, change):
        rows=[json.loads(r) for r in self.members[self.log_member].splitlines()]
        change(rows)
        self.members[self.log_member]=('\n'.join(json.dumps(r) for r in rows)+'\n').encode()
        self.archive()

    def test_synthetic_exact_source_complete_inventory(self):
        keys,facts=self.f.consume()
        self.assertEqual(keys,self.f.expected)
        self.assertEqual(len(keys),128 if self.item=='649' else 71)
        self.assertEqual(facts['derived']['schema_binding'],dict(producer=self.head,tests_tree=FIX['train48']['tests_tree']))
        self.assertEqual(facts['derived']['source_sha256'],dict(FIX['train48']['sources'],**{own.WORKFLOW:own.SOURCES[own.WORKFLOW]}))
        self.assertEqual(facts['derived']['command']['harness'],self.harness)
        self.assertEqual(facts['derived']['command']['flags'],['--'+self.mode])

    def test_unknown_tree_refuses(self):
        original=b.ask
        def drift(git,*args):
            if args==('rev-parse','--verify',self.wrapper+':tests'):return '0'*40
            return original(git,*args)
        with mock.patch.object(b,'ask',side_effect=drift):self.f.refuses('independently bound tests schema')

    def test_wrong_family_refuses(self):
        other='656' if self.item=='649' else '649'
        self.source_change(own.SPEC,lambda raw:raw.replace(('item '+self.item).encode(),('item '+other).encode()),'step/filter')

    def test_wrong_step_refuses(self):
        self.source_change(own.SPEC,lambda raw:json.dumps(dict(json.loads(raw),step='rail')).encode(),'literal family step')

    def test_no_webkit_header(self):
        self.source_change(own.SPEC,lambda raw:json.dumps(dict(json.loads(raw),step='webkit-header')).encode(),'source/command|step/filter')

    def test_broad_or_union_filter_refuses(self):
        for value in ('item 64','item '+self.item+'|item 715','item '+self.item+'0'):
            with self.subTest(value=value):
                self.source_change(own.SPEC,lambda raw:json.dumps(dict(json.loads(raw),cases=[value])).encode(),'step/filter')

    def test_manifest_cannot_choose_source_schema(self):
        self.source_change(own.SPEC,lambda raw:json.dumps(dict(json.loads(raw),sources=FIX['train48']['sources'])).encode(),'invalid fields')

    def test_unknown_source_refuses(self):
        for p in (self.harness,'tests/topic_title_native.mjs','tests/topic_reading_native.mjs','tests/fixtures/ui_http.py',
                  'tests/native-calls.mjs','tests/fixtures/item_645_original_web.tar.gz','web/marks.mjs','tools/native.py'):
            with self.subTest(path=p):self.source_change(p,lambda raw:raw+b'\n','source/command')

    def test_required_snapshot_missing_refuses(self):
        del self.report['hashes'][self.harness]
        self.sync();self.f.refuses('literal snapshot inputs')

    def test_forged_snapshot_refuses(self):
        self.report['hashes'][self.harness]='0'*64
        self.sync();self.f.refuses('native source hash differs')

    def test_extra_source_claim_refuses(self):
        path='AGENTS.md'
        self.report['hashes'][path]=hashlib.sha256(subprocess.check_output(portable.git_command() + ['show',self.head+':'+path])).hexdigest()
        self.sync();self.f.refuses('literal snapshot inputs')

    def test_missing_reordered_duplicate_or_unknown_cases_refuse(self):
        original=copy.deepcopy(self.report['results'])
        variants=[original[:-1],[original[1],original[0]]+original[2:],original[:1]+original[:1]+original[2:],
                  [dict(original[0],name=original[0]['name']+' unknown')]+original[1:]]
        for rows in variants:
            with self.subTest(rows=len(rows)):
                self.report['results']=rows;self.sync();self.f.refuses('literal ordered cases')

    def test_red_row_refuses(self):
        self.report['results'][0]['passed']=False
        self.sync();self.f.refuses('raw case failed')

    def test_engine_phase_and_boolean_types_refuse(self):
        for key,value in [('phase','run'),('engine','chromium' if self.webkit else 'webkit')]:
            row=self.report['results'][0];old=dict(row);row[key]=value;self.sync()
            self.f.refuses('invalid fields|engine');row.clear();row.update(old)
        self.report['fixtureExitCode']=False;self.sync();self.f.refuses('phase or teardown')

    def test_counts_and_exit_refuse(self):
        self.step_record['counts']['pass']-=1
        self.members['c1.log']=(json.dumps(self.step_record)+'\n'+self.step+' exit 0 /Users/runner/work/_temp/pool/c1\n').encode()
        self.archive();self.f.refuses('raw count')
        self.sync();self.members['cases.json']=json.dumps([{'case':'item '+self.item,'exit':1}]).encode()
        self.archive();self.f.refuses('execution filter/exit')

    def test_duplicate_execution_refuses(self):
        self.members['cases.json']=json.dumps([{'case':'item '+self.item,'exit':0}]*2).encode()
        self.archive();self.f.refuses('single execution')

    def test_cleanup_refuses(self):
        self.report['browserClosed']=False;self.sync();self.f.refuses('phase or teardown')
        self.report['browserClosed']=True;self.report['fixtureErrors']='fixture failed';self.sync();self.f.refuses('phase or teardown')

    def test_ordered_log_and_cleanup_phase_refuse(self):
        self.log_change(lambda lines:lines.reverse());self.f.refuses('ordered|invalid fields')
        if not self.webkit:
            self.sync();self.phases['cases'][0]['cleanupEnded']=1001
            self.sync();self.f.refuses('case/cleanup phases')

    def test_wrong_api_identity_refuses(self):
        self.f.change_api('run',['id'],1);self.f.refuses('run identity')

    def test_wrong_archive_or_raw_bytes_refuse(self):
        self.f.receipt['report']=self.f.save('drift',b'{}');self.f.refuses('raw report differs')

    def test_independent_inventory_cannot_shrink_or_invent_phase(self):
        self.f.expected.pop();self.f.refuses('obligations differ')
        self.f.expected=[(s,n,'run',e) for s,n,_,e in self.f.expected];self.f.refuses('obligations differ')

    def test_mixed_canonical_source_refuses(self):
        self.f.tree='0'*40;self.f.refuses('literal canonical source')


class Reading649(LiteralControls,unittest.TestCase):item,step='649','reading'
class Webkit649(LiteralControls,unittest.TestCase):item,step='649','webkit-reading'


class TitleControls(LiteralControls):
    def test_diagnostic_drop_reorder_and_extra_refuse(self):
        saved=self.members[self.log_member]
        for change in (lambda rows:rows.pop(0 if self.webkit else 1),
                       lambda rows:rows.append(dict(item=656,restored=True)),
                       lambda rows:rows.append(None),
                       lambda rows:rows.reverse()):
            with self.subTest(change=change):
                self.members[self.log_member]=saved;self.log_change(change);self.f.refuses('invalid fields|ordered log')

    def test_survivor_and_missing_restore_refuse(self):
        def survivor(rows):next(r for r in rows if 'failed_case' in r)['failed_case']=None
        self.log_change(survivor);self.f.refuses('missing intended mutant failure')
        self.sync()
        def lost(rows):next(r for r in rows if 'restored_control_passed' in r)['restored_control_passed']=False
        self.log_change(lost);self.f.refuses('restored control missing')

    def test_wrong_mutant_source_refuses(self):
        def wrong(rows):next(r for r in rows if 'mutated' in r)['mutated']='0'*64
        self.log_change(wrong);self.f.refuses('applied mutation source')


class Colors656(TitleControls,unittest.TestCase):item,step='656','colors'
class WebkitColors656(TitleControls,unittest.TestCase):item,step='656','webkit-colors'
class Header656(TitleControls,unittest.TestCase):item,step='656','header'


class Final715Controls(families.FamilyControls):
    @classmethod
    def setUpClass(cls):
        cls.head,cls.tree=FIX['final715']['head'],FIX['final715']['tree']
        cls.wrapper=families.wrapper_for(cls.head,cls.step,cls.item)

    def test_final_literal_binding(self):
        keys,facts=self.f.consume()
        self.assertEqual(keys,self.f.expected)
        self.assertEqual(facts['derived']['schema_binding'],dict(producer=self.head,tests_tree=FIX['final715']['tests_tree']))
        self.assertEqual(facts['derived']['source_sha256'],dict(FIX['final715']['sources'],**{
            p:own.SOURCES[p] for p in (own.WORKFLOW,'tools/native.py','tools/release_check.py')}))

    def test_both_changed_sources_are_pinned(self):
        for p in ('tests/outline_stars_native.mjs','tests/webkit_native.mjs'):
            self.source_change(p,lambda raw:raw+b'\n','source/command')


class FinalRail715(Final715Controls,unittest.TestCase):item,step='715','rail'
class FinalWebkit715(Final715Controls,unittest.TestCase):item,step='715','webkit-rail'


class ArchiveReplay(unittest.TestCase):
    def test_retired47_fatal_openings_cannot_be_empty_green_inventory(self):
        raw=(EVIDENCE/'train47-full-44247579300/check-3/native/openings/native.json').read_bytes()
        self.assertEqual(hashlib.sha256(raw).hexdigest(),
                         '747c9ae099b40fe132aea2c228a61c583676d8838e8d0f1baa192243457998df')
        report=json.loads(raw)
        self.assertEqual(report['results'],[])
        self.assertEqual(report['fixtureExitCode'],1)
        self.assertIn("No module named 'item_735_runtime'",report['fixtureErrors'])
        with self.assertRaisesRegex(b.Refused,'reported teardown failure'):b.teardown(report)
        with tempfile.TemporaryDirectory(prefix='retired47-refusal-') as temp:
            out=Path(temp);folder=out/'native/openings';folder.mkdir(parents=True)
            (folder/'native.json').write_bytes(raw)
            with self.assertRaisesRegex(ci.Refused,'missing case results'):
                ci.cases({'name':'native-openings'},out,[])

    def test_originals_remain_red_and_genuine_webkit649_parser_replay(self):
        for item,folder in [('649','item649-bde3fe71'),('656','item656-cb111964')]:
            for engine in ('chromium','webkit'):
                with self.subTest(item=item,engine=engine):
                    members=portable.replay_members(item,engine)
                    mode='reading' if item=='649' else 'colors'
                    step=('webkit-' if engine=='webkit' else '')+mode
                    raw=members['c1/evidence/native.json'];report=json.loads(raw)
                    self.assertEqual(len(report['results']),128 if item=='649' else 71)
                    self.assertEqual(sum(r['passed'] for r in report['results']),128 if item=='649' and engine=='webkit' else 126 if item=='649' else 70)
                    contents={n:members[n] for n in ('c1/evidence/native.json','c1/native-'+step+'.log')}
                    if engine=='chromium':contents['c1/evidence/phases.json']=members['c1/evidence/phases.json']
                    expected=[('native-'+step,r['name'],None,engine) for r in report['results']]
                    record=dict(counts=dict(tests=len(expected),**{'pass':len(expected)},fail=0,failed=[],browser_closed=True))
                    if item=='649' and engine=='webkit':
                        self.assertEqual(own.family_results(contents,record,step,'item '+item,expected),expected)
                    else:
                        with self.assertRaisesRegex(b.Refused,'raw case failed'):
                            own.family_results(contents,record,step,'item '+item,expected)

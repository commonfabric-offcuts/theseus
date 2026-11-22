from __future__ import annotations

import copy
import hashlib
import io
import json
import math
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
import urllib.error
import zipfile
from contextlib import redirect_stdout, redirect_stderr
from unittest import mock

from tools import unit_shards as sh

ROOT = Path(__file__).resolve().parents[1]


def receipt(number=1, seconds=None, complete=True):
    seconds = seconds if seconds is not None else {'tests/test_a.py': 120, 'tests/test_b.py': 60}
    files = sorted(seconds)
    sha = ('%040x' % number)
    run = {'id': number, 'run_attempt': 1, 'event': 'push', 'status': 'completed',
           'conclusion': 'failure', 'head_sha': sha, 'created_at': '2026-11-%02dT00:00:00Z' % number,
           'path': '.github/workflows/checks.yml', 'repository': {'full_name': 'owner/repo'}}
    plan = [{'name': 'python units 1 of 1', 'steps': 'python-units', 'python_shard': '1/1', 'files': files}]
    part = {'index': 1, 'total': 1, 'files': files}
    summary = {'commit': sha, 'tree_unchanged': True, 'missing': [] if complete else ['python-units'],
               'missing_jobs': [] if complete else ['python units 1 of 1'], 'cancelled_shards': [],
               'required': ['python-units'], 'jobs': [{'name': plan[0]['name'], 'missing': not complete}],
               'steps': [{'name': 'python-units', 'passed': False, 'shards': [
                   {'partition': part, 'timing': {'files': seconds, 'wall_seconds': sum(seconds.values())}}]}]}
    provenance = {'run': {'id': str(number), 'attempt': '1', 'event': 'push', 'workflow': 'Checks',
                         'repository': 'owner/repo', 'workflow_sha': sha,
                         'workflow_ref': 'owner/repo/.github/workflows/checks.yml@refs/heads/release/test'},
                  'merge': {'sha': sha}, 'plan': plan, 'cancelled_shards': []}
    out = io.BytesIO()
    with zipfile.ZipFile(out, 'w') as archive:
        archive.writestr('summary.json', json.dumps(summary))
        archive.writestr('provenance.json', json.dumps(provenance))
    data = out.getvalue()
    artifact = {'id': 100 + number, 'name': 'release-check', 'expired': False,
                'size_in_bytes': len(data), 'digest': 'sha256:' + hashlib.sha256(data).hexdigest(),
                'workflow_run': {'id': number, 'head_sha': sha}}
    jobs = {'jobs': [{'name': plan[0]['name'], 'status': 'completed', 'conclusion': 'failure'}]}
    return run, artifact, data, jobs


class TimingSelection(unittest.TestCase):
    def test_completed_producer_with_an_empty_planned_part_still_supplies_times(self):
        run,artifact,data,jobs=receipt()
        with zipfile.ZipFile(io.BytesIO(data)) as archive:
            summary=json.loads(archive.read('summary.json'));provenance=json.loads(archive.read('provenance.json'))
        first=provenance['plan'][0];first.update(name='python units 1 of 2',python_shard='1/2')
        provenance['plan'].append(dict(first,name='python units 2 of 2',python_shard='2/2',files=[]))
        summary['steps'][0]['shards'][0]['partition']['total']=2
        summary['steps'][0]['shards'].append({'partition':{'index':2,'total':2,'files':[]},'timing':{'files':{}}})
        jobs['jobs']=[dict(jobs['jobs'][0],name=job['name']) for job in provenance['plan']]
        out=io.BytesIO()
        with zipfile.ZipFile(out,'w') as archive:
            archive.writestr('summary.json',json.dumps(summary));archive.writestr('provenance.json',json.dumps(provenance))
        data=out.getvalue();artifact.update(size_in_bytes=len(data),digest='sha256:'+hashlib.sha256(data).hexdigest())
        result=sh.timing_receipt(run,artifact,data,jobs,'owner/repo')
        self.assertEqual(result['minutes'],{'tests/test_a.py':2,'tests/test_b.py':1})
        self.assertEqual(result['planned_files'],['tests/test_a.py','tests/test_b.py'])

    def test_unsafe_or_duplicate_archive_entries_and_nonobject_json_are_rejected(self):
        for entries in ((('summary.json','{}'),('../provenance.json','{}')),
                        (('summary.json','{}'),('summary.json','{}'),('provenance.json','{}')),
                        (('summary.json','[]'),('provenance.json','{}')),
                        (('summary.json','{}'),('provenance.json','[]')),
                        (('summary.json','{"missing":[],"missing":["python-units"]}'),('provenance.json','{}'))):
            run,artifact,_,jobs=receipt();out=io.BytesIO()
            with zipfile.ZipFile(out,'w') as archive:
                for name,body in entries:archive.writestr(name,body)
            data=out.getvalue();artifact.update(size_in_bytes=len(data),digest='sha256:'+hashlib.sha256(data).hexdigest())
            with self.subTest(entries=entries),self.assertRaises(ValueError):
                sh.timing_receipt(run,artifact,data,jobs,'owner/repo')

    def test_github_authorization_is_not_forwarded_to_artifact_storage(self):
        class Response(io.BytesIO):
            pass
        opener=mock.Mock()
        opener.open.side_effect=urllib.error.HTTPError('https://api.github.com/example',302,'redirect',
            {'Location':'https://storage.example/timing.zip'},None)
        def lookup(repository,request):
            self.assertEqual(request('actions/artifacts/1/zip'),b'archive')
            return {'source':'read'}
        with mock.patch.dict(os.environ,{'GITHUB_TOKEN':'synthetic-token'}), \
                mock.patch.object(sh.urllib.request,'build_opener',return_value=opener), \
                mock.patch.object(sh.urllib.request,'urlopen',return_value=Response(b'archive')) as storage, \
                mock.patch.object(sh,'newest_timings',side_effect=lookup):
            self.assertEqual(sh._api_timings('owner/repo'),{'source':'read'})
        self.assertEqual(opener.open.call_args[0][0].get_header('Authorization'),'Bearer synthetic-token')
        self.assertEqual(storage.call_args[0],('https://storage.example/timing.zip',))
        self.assertEqual(set(storage.call_args[1]),{'timeout'})

    def test_completed_failing_receipt_supplies_real_seconds_without_becoming_passed(self):
        run, artifact, data, jobs = receipt()
        result = sh.timing_receipt(run, artifact, data, jobs, 'owner/repo')
        self.assertEqual(result['minutes'], {'tests/test_a.py': 2, 'tests/test_b.py': 1})
        self.assertEqual(result['source']['run_id'], 1)
        self.assertEqual(result['source']['artifact_sha256'], hashlib.sha256(data).hexdigest())
        self.assertEqual(result['source']['artifact_size_in_bytes'],len(data))

    def test_newest_complete_skips_newer_incomplete_and_unfinished_runs(self):
        rows = [receipt(1), receipt(2, complete=False), receipt(3)]
        rows[2][0]['status'] = 'in_progress'
        answers = {'actions/workflows/checks.yml/runs?event=push&per_page=20': {'workflow_runs': [r[0] for r in rows]}}
        for run, artifact, data, jobs in rows:
            answers['actions/runs/%d/artifacts?per_page=100' % run['id']] = {'artifacts': [artifact]}
            answers['actions/runs/%d/attempts/1/jobs?per_page=100' % run['id']] = jobs
            answers['actions/artifacts/%d/zip' % artifact['id']] = data
        result = sh.newest_timings('owner/repo', lambda path: answers[path])
        self.assertEqual(result['source']['run_id'], 1)
        self.assertEqual({r['run_id'] for r in result['source']['skipped']}, {2, 3})

    def test_digest_attempt_source_and_api_cancelled_job_cannot_supply_times(self):
        for change in ('digest', 'attempt', 'source', 'cancelled'):
            run, artifact, data, jobs = receipt()
            if change == 'digest': artifact['digest'] = 'sha256:' + '0' * 64
            if change == 'attempt': run['run_attempt'] = 2
            if change == 'source': run['head_sha'] = 'f' * 40
            if change == 'cancelled': jobs['jobs'][0]['conclusion'] = 'cancelled'
            with self.subTest(change=change), self.assertRaises(ValueError):
                sh.timing_receipt(run, artifact, data, jobs, 'owner/repo')

    def test_nonfinite_negative_bool_and_out_of_plan_timings_are_rejected(self):
        for bad in (-1, float('nan'), float('inf'), True):
            with self.subTest(bad=bad), self.assertRaises(ValueError):
                sh.timing_receipt(*receipt(seconds={'tests/test_a.py': bad}), 'owner/repo')
        run, artifact, data, jobs = receipt()
        with zipfile.ZipFile(io.BytesIO(data)) as archive:
            summary = json.loads(archive.read('summary.json'));provenance = archive.read('provenance.json')
        summary['steps'][0]['shards'][0]['timing']['files']['tests/not_planned.py'] = 1
        out = io.BytesIO()
        with zipfile.ZipFile(out, 'w') as archive:
            archive.writestr('summary.json', json.dumps(summary));archive.writestr('provenance.json', provenance)
        data = out.getvalue();artifact.update(size_in_bytes=len(data), digest='sha256:' + hashlib.sha256(data).hexdigest())
        with self.assertRaises(ValueError): sh.timing_receipt(run, artifact, data, jobs, 'owner/repo')


class PlanningWeights(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory();self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name);(self.root/'tests').mkdir()
        for name in ('a', 'b', 'new'):
            (self.root/'tests'/('test_'+name+'.py')).write_text('')
        self.weights = {'units': {'python_minutes': {'tests/test_a.py': 8, 'tests/test_b.py': 2},
                                  'python_shards': 2, 'setup_minutes': .5,
                                  'minutes': {'node-units': 1, 'deploy-refusals': 1}}}
        def remove_imports():
            sys.path[:] = [p for p in sys.path if p != str(self.root)]
            for name,module in list(sys.modules.items()):
                if str(getattr(module,'__file__','')).startswith(str(self.root)+os.sep):sys.modules.pop(name,None)
        self.addCleanup(remove_imports)
    def fresh(self):
        return {'minutes': {'tests/test_a.py': 2, 'tests/test_b.py': 1, 'tests/deleted.py': 99},
                'planned_files': ['tests/test_a.py', 'tests/test_b.py', 'tests/deleted.py'],
                'source': {'kind': 'checks_push', 'run_id': 9, 'artifact_sha256': 'd'*64}}

    def test_outer_assignment_is_consumed_before_nested_whole_and_partitioned_runners(self):
        outer=self.root/'outer';nested=self.root/'nested'
        (outer/'tests').mkdir(parents=True);(nested/'tests').mkdir(parents=True)
        for name in ('a','b'):
            (nested/'tests'/('test_'+name+'.py')).write_text(
                'from __future__ import annotations\nimport unittest\nclass Case(unittest.TestCase):\n'
                ' def test_one(self):pass\n def test_two(self):pass\n')
        script=str(ROOT/'tools/unit_shards.py')
        (outer/'tests/test_outer.py').write_text(f'''from __future__ import annotations
import json,subprocess,sys,unittest
from pathlib import Path
class NestedRunners(unittest.TestCase):
 def test_nested(self):
  docs=[]
  for index,extra in enumerate(([],['--shard','1/2'],['--shard','2/2'])):
   answer=subprocess.run([sys.executable,'-I','-X','pycache_prefix='+str(Path({str(self.root/'nested-caches')!r})/str(index)),
                          {script!r},'--root',{str(nested)!r}]+extra,capture_output=True,text=True)
   self.assertEqual(answer.returncode,0,answer.stderr)
   docs.append(json.loads(answer.stdout.splitlines()[-1]))
  self.assertEqual([d['tests'] for d in docs],[4,2,2])
  self.assertNotIn('python_shard',docs[0])
  self.assertEqual([d['python_shard']['index'] for d in docs[1:]],[1,2])
  self.assertTrue(all(d['python_shard']['total']==2 for d in docs[1:]))
  files=[p for d in docs[1:] for p in d['python_shard']['files']]
  self.assertEqual(sorted(files),['tests/test_a.py','tests/test_b.py'])
  self.assertEqual(len(files),len(set(files)))
  print(json.dumps({{'nested_run_evidence':docs}}),flush=True)
''')
        assignment=['tests/test_outer.py']
        env=dict(os.environ,AIM_PYTHON_SHARD_FILES=json.dumps(assignment))
        answer=subprocess.run([sys.executable,'-I','-X','pycache_prefix='+str(self.root/'outer-cache'),
                               script,'--root',str(outer),'--shard','1/4'],env=env,text=True,capture_output=True)
        self.assertEqual(answer.returncode,0,answer.stderr)
        rows=[json.loads(line) for line in answer.stdout.splitlines() if line.startswith('{')]
        nested_evidence=next(row['nested_run_evidence'] for row in rows if 'nested_run_evidence' in row)
        self.assertEqual([row['tests'] for row in nested_evidence],[4,2,2])
        evidence=rows[-1];self.assertEqual(evidence['tests'],1)
        self.assertEqual(evidence['python_shard'],{'index':1,'total':4,'files':assignment})
        print(json.dumps({'outer_assignment':evidence['python_shard'],'nested_counts':[row['tests'] for row in nested_evidence],
                          'nested_union':[p for row in nested_evidence[1:] for p in row['python_shard']['files']]}))

    def test_fresh_weights_cover_current_walk_and_report_unknown_and_deleted(self):
        result = sh.select_python_weights(self.root, self.weights, lookup=self.fresh)
        config = result['units'];self.assertEqual(set(config['python_minutes']), set(sh.test_files(self.root)))
        self.assertEqual(config['python_minutes']['tests/test_new.py'], 2)
        self.assertEqual(config['python_unmeasured'], {'tests/test_new.py': 'new_or_renamed'})
        self.assertEqual(config['weight_source']['unused_files'], ['tests/deleted.py'])
        self.assertEqual(config['weight_source']['run_id'], 9)
        self.assertEqual(self.weights['units']['python_minutes']['tests/test_a.py'], 8)

    def test_read_failure_uses_table_and_names_commit_and_skip_reason(self):
        with mock.patch.object(sh, 'table_commit', return_value='c'*40):
            result = sh.select_python_weights(self.root, self.weights, lookup=mock.Mock(side_effect=ValueError('lookup_timeout')))
        source = result['units']['weight_source']
        self.assertEqual(source['kind'], 'checked_in');self.assertEqual(source['commit'], 'c'*40)
        self.assertEqual(source['lookup_skip_reason'], 'lookup_timeout')
        self.assertEqual(result['units']['python_minutes']['tests/test_new.py'], 8)

    def test_a_planned_untimed_file_is_distinguished_from_a_new_name(self):
        fresh=self.fresh();del fresh['minutes']['tests/test_b.py']
        result=sh.select_python_weights(self.root,self.weights,lookup=lambda:fresh)
        self.assertEqual(result['units']['python_unmeasured'],
                         {'tests/test_b.py':'planned_untimed','tests/test_new.py':'new_or_renamed'})

    def test_invalid_fresh_weights_fall_back_and_invalid_count_or_empty_deal_refuses(self):
        fresh = self.fresh();fresh['minutes']['tests/test_a.py'] = float('nan')
        result = sh.select_python_weights(self.root, self.weights, lookup=lambda: fresh)
        self.assertEqual(result['units']['weight_source']['kind'], 'checked_in')
        for count in (None, 0, -1, True, 1.5):
            weights = copy.deepcopy(self.weights);weights['units']['python_shards'] = count
            with self.subTest(count=count), self.assertRaises(ValueError):
                sh.select_python_weights(self.root, weights, lookup=self.fresh)
        weights=copy.deepcopy(self.weights);weights['units']['python_shards']=4
        jobs=[j for j in sh.jobs(self.root,sh.select_python_weights(self.root,weights,lookup=self.fresh)) if j.get('python_shard')]
        self.assertEqual(len(jobs),4)
        empty=[j for j in jobs if not j['files']];self.assertEqual(len(empty),1)
        self.assertEqual(empty[0]['timeout'],math.ceil(.5*1.5))
        for path in (self.root/'tests').iterdir():path.unlink()
        selected=sh.select_python_weights(self.root,weights)
        self.assertEqual(selected['units']['weight_source']['lookup_skip_reason'],'empty_python_inventory')
        jobs=[j for j in sh.jobs(self.root,selected) if j.get('python_shard')]
        self.assertEqual(len(jobs),4);self.assertTrue(all(j['files']==[] for j in jobs))
        self.assertTrue(all(j['timeout']==math.ceil(.5*1.5) for j in jobs))
        with redirect_stdout(io.StringIO()),redirect_stderr(io.StringIO()):
            self.assertEqual(sh.run(self.root,'1/4',weights,assignment=[]),0)

    def test_caps_follow_selected_deal_and_preserve_exact_once_assignment(self):
        selected = sh.select_python_weights(self.root, self.weights, lookup=self.fresh)
        jobs = [j for j in sh.jobs(self.root, selected) if j.get('python_shard')]
        self.assertEqual(sorted(p for j in jobs for p in j['files']), sh.test_files(self.root))
        for job in jobs:
            minutes = sum(selected['units']['python_minutes'][p] for p in job['files'])
            self.assertEqual(job['timeout'], math.ceil((minutes+.5)*1.5))
            self.assertEqual(job['weight_source']['run_id'], 9)

    def test_bounded_lookup_kills_a_real_stalled_child_then_names_timeout(self):
        real_run = subprocess.run
        def stalled(argv, **kwargs):
            return real_run([sys.executable, '-c', 'import time;time.sleep(20)'], **kwargs)
        with mock.patch.object(subprocess, 'run', side_effect=stalled):
            with self.assertRaisesRegex(ValueError, 'lookup_timeout'):
                sh.bounded_timings('owner/repo', timeout=.1)

    def test_invalid_assignment_refuses_before_importing_any_test(self):
        marker = self.root/'imported'
        (self.root/'tests/test_a.py').write_text('from pathlib import Path\nPath(%r).touch()\n' % str(marker))
        for files in (['tests/test_a.py']*2, ['../outside.py'], ['tests/not_here.py']):
            with self.subTest(files=files), self.assertRaises(ValueError):
                sh.run(self.root, '1/2', self.weights, assignment=files)
        self.assertFalse(marker.exists())

    def test_empty_shared_part_runs_zero_and_combines_only_with_a_positive_union(self):
        for name in ('b','new'):(self.root/'tests'/('test_'+name+'.py')).unlink()
        (self.root/'tests/test_a.py').write_text('import unittest\nclass C(unittest.TestCase):\n def test_ok(self):pass\n')
        weights=copy.deepcopy(self.weights);weights['units']['python_shards']=4
        jobs=[j for j in sh.jobs(self.root,weights) if j.get('python_shard')];docs=[];receipts=[]
        for job in jobs:
            with redirect_stdout(io.StringIO()) as out,redirect_stderr(io.StringIO()):
                code=sh.run(self.root,job['python_shard'],weights,assignment=job['files'])
            evidence=json.loads(out.getvalue().splitlines()[-1]);self.assertEqual(code,0)
            self.assertEqual(evidence['tests'],int(bool(job['files'])))
            docs.append({'steps':[{'name':'python-units','passed':True,'exit':0,'counts':{'tests':evidence['tests'],'status':'OK'}}],
                         'python_shard':evidence['python_shard']})
            receipts.append({'shard':{'name':job['name']}})
        steps,_,_,missing_jobs,missing=sh.check.combine_unit_results(docs,jobs,receipts)
        self.assertEqual((missing_jobs,missing),([],[]));self.assertTrue(steps[0]['passed'])
        docs[0]['steps'][0]['counts']['tests']=0
        self.assertFalse(sh.check.combine_unit_results(docs,jobs,receipts)[0][0]['passed'])
        env=dict(os.environ,AIM_PYTHON_SHARD_FILES='[]')
        answer=subprocess.run([sys.executable,'-I','-X','pycache_prefix='+str(self.root/'empty-cli-cache'),
            str(ROOT/'tools/unit_shards.py'),'--root',str(self.root),'--shard','2/4'],env=env,text=True,capture_output=True)
        self.assertEqual(answer.returncode,0,answer.stderr)
        evidence=json.loads(answer.stdout.splitlines()[-1]);self.assertEqual(evidence['tests'],0)
        self.assertEqual(evidence['python_shard'],{'index':2,'total':4,'files':[]})

    def test_runner_uses_shared_assignment_instead_of_redealing_stale_table(self):
        for name in ('a','b','new'):
            (self.root/'tests'/('test_'+name+'.py')).write_text('import unittest\nclass C(unittest.TestCase):\n def test_ok(self):pass\n')
        with redirect_stdout(io.StringIO()) as out, redirect_stderr(io.StringIO()):
            result = sh.run(self.root, '1/2', self.weights, assignment=['tests/test_b.py'])
        self.assertEqual(result,0)
        evidence=json.loads(out.getvalue().splitlines()[-1])
        self.assertEqual(evidence['python_shard']['files'], ['tests/test_b.py'])
        self.assertEqual(evidence['tests'],1)

    def test_runner_cli_consumes_workflow_assignment_without_a_second_lookup(self):
        for name in ('a','b','new'):
            (self.root/'tests'/('test_'+name+'.py')).write_text('import unittest\nclass C(unittest.TestCase):\n def test_ok(self):pass\n')
        env=dict(os.environ,AIM_PYTHON_SHARD_FILES=json.dumps(['tests/test_b.py']))
        result=subprocess.run([sys.executable,'-I','-X','pycache_prefix='+str(self.root/'cache'),
                               str(ROOT/'tools/unit_shards.py'),'--root',str(self.root),'--shard','1/2'],
                              env=env,text=True,capture_output=True)
        self.assertEqual(result.returncode,0,result.stderr)
        evidence=json.loads(result.stdout.splitlines()[-1])
        self.assertEqual(evidence['python_shard']['files'],['tests/test_b.py'])
        self.assertEqual(evidence['tests'],1)
        workflow=(ROOT/'.github/workflows/checks.yml').read_text()
        step=workflow.split('      - name: Release check, ${{ matrix.steps }}\n',1)[1].split('      - name:',1)[0]
        self.assertIn('AIM_PYTHON_SHARD_FILES:',step)
        self.assertIn('toJSON(matrix.files)',step)

    def test_plan_cli_uses_default_fresh_selection_and_records_source_in_each_python_job(self):
        with mock.patch.object(sh,'bounded_timings',return_value=self.fresh()) as lookup, \
                redirect_stdout(io.StringIO()) as out:
            code=sh.plan_main(['--event-name','push','--head','a'*40])
        self.assertEqual(code,0)
        lookup.assert_called_once()
        plan=json.loads(out.getvalue())
        jobs=[job for job in plan['shards'] if job.get('python_shard')]
        self.assertEqual(len(jobs),4)
        self.assertTrue(all(job['weight_source']['run_id']==9 for job in jobs))
        self.assertEqual(sorted(p for job in jobs for p in job['files']),sh.test_files(ROOT))


class RetainedMeasurements(unittest.TestCase):
    def test_checked_in_table_is_refreshed_from_retained_complete_run(self):
        sample=json.loads((ROOT/'tests/fixtures/python-times-1067.json').read_text())
        config=json.loads((ROOT/'.github/check-weights.json').read_text())['units']
        current=set(sh.test_files(ROOT));errors=[]
        for name,seconds in sample['seconds'].items():
            if name in current and not math.isclose(config['python_minutes'].get(name,-1),seconds/60,abs_tol=1e-9):errors.append(name)
        self.assertEqual(errors, [], 'stored measurements must come from the retained source, not old hand weights')

    def test_actual_retained_times_predict_balanced_current_deal(self):
        sample=json.loads((ROOT/'tests/fixtures/python-times-1067.json').read_text())
        weights=json.loads((ROOT/'.github/check-weights.json').read_text())
        minutes={p:s/60 for p,s in sample['seconds'].items()};fallback=sorted(minutes.values())[len(minutes)//2]
        jobs=[j for j in sh.jobs(ROOT,weights) if j.get('python_shard')]
        loads=[sum(minutes.get(p,fallback) for p in j['files']) for j in jobs]
        print(json.dumps({'retained_run':sample['run_id'],'projected_minutes':loads}))
        self.assertLessEqual(max(loads)/min(loads),1.5)

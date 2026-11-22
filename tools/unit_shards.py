from __future__ import annotations

"""Whole-file unittest partitions, with wall time and slow-test evidence (665)."""
import argparse
import collections
import copy
import hashlib
import io
import json
import math
import os
from pathlib import Path
import re
import subprocess
import sys
import time
import unittest
import urllib.error
import urllib.parse
import urllib.request
import zipfile

ROOT = Path(__file__).resolve().parents[1]
LOOKUP_SECONDS = 10
MAX_TIMING_BYTES = 16 * 1024 * 1024


def _require(ok, reason):
    if not ok:
        raise ValueError(reason)


def _json(data):
    def unique(pairs):
        result = {}
        for key, value in pairs:
            _require(key not in result, 'duplicate_json_key')
            result[key] = value
        return result
    return json.loads(data, object_pairs_hook=unique)


def _minutes(values):
    _require(isinstance(values, dict), 'invalid_file_times')
    _require(all(isinstance(path, str) and type(value) in (int, float)
                 and math.isfinite(value) and value >= 0 for path, value in values.items()), 'invalid_file_times')
    return dict(values)


def timing_receipt(run, artifact, data, api_jobs, repository):
    """Read a completed failing or passing run as timing data, never approval."""
    _require(run.get('event') == 'push' and run.get('status') == 'completed'
             and run.get('conclusion') in ('success', 'failure'), 'run_not_complete')
    _require(run.get('path') == '.github/workflows/checks.yml'
             and (run.get('repository') or {}).get('full_name') == repository, 'wrong_producer')
    sha = run.get('head_sha');attempt = run.get('run_attempt')
    _require(isinstance(sha, str) and re.fullmatch('[0-9a-f]{40}', sha)
             and type(attempt) is int and attempt > 0, 'invalid_run_identity')
    _require(artifact.get('name') == 'release-check' and artifact.get('expired') is False
             and (artifact.get('workflow_run') or {}).get('id') == run['id']
             and artifact['workflow_run'].get('head_sha') == sha, 'wrong_artifact')
    digest = hashlib.sha256(data).hexdigest()
    _require(len(data) <= MAX_TIMING_BYTES and len(data) == artifact.get('size_in_bytes')
             and artifact.get('digest') == 'sha256:' + digest, 'artifact_digest_mismatch')
    try:
        with zipfile.ZipFile(io.BytesIO(data)) as archive:
            names = archive.namelist()
            _require(len(names) == len(set(names)) and set(names) == {'summary.json', 'provenance.json'}, 'invalid_timing_archive')
            _require(sum(i.file_size for i in archive.infolist()) <= MAX_TIMING_BYTES
                     and all(not i.is_dir() and not i.flag_bits & 1 for i in archive.infolist()), 'invalid_timing_archive')
            summary = _json(archive.read('summary.json'));provenance = _json(archive.read('provenance.json'))
    except (zipfile.BadZipFile, KeyError, UnicodeError, RuntimeError) as error:
        raise ValueError('invalid_timing_archive') from error
    _require(isinstance(summary, dict) and isinstance(provenance, dict), 'invalid_timing_json')
    identity = provenance.get('run') or {}
    _require(identity.get('id') == str(run['id']) and identity.get('attempt') == str(attempt)
             and identity.get('event') == 'push' and identity.get('workflow') == 'Checks'
             and identity.get('repository') == repository and identity.get('workflow_sha') == sha
             and (provenance.get('merge') or {}).get('sha') == sha
             and summary.get('commit') == sha and summary.get('tree_unchanged') is True, 'timing_source_mismatch')
    _require(summary.get('missing') == [] and summary.get('missing_jobs') == []
             and summary.get('cancelled_shards') == [] and provenance.get('cancelled_shards') == [], 'incomplete_producer')
    plan = provenance.get('plan');_require(isinstance(plan, list) and plan, 'missing_plan')
    names = [job['name'] for job in plan]
    _require(len(names) == len(set(names)), 'duplicate_plan_job')
    observed = api_jobs.get('jobs') or []
    for name in names:
        matches = [job for job in observed if job.get('name') == name]
        _require(len(matches) == 1 and matches[0].get('status') == 'completed'
                 and matches[0].get('conclusion') in ('success', 'failure'), 'job_not_complete')
    required = {name for job in plan for name in job['steps'].split(',')}
    _require(required == set(summary.get('required', []))
             and required == {step.get('name') for step in summary.get('steps', [])}, 'incomplete_steps')
    selected = [job for job in plan if job.get('python_shard')]
    _require(selected, 'missing_python_plan')
    total = len(selected);planned = []
    _require({job['python_shard'] for job in selected} == {'%d/%d' % (i, total) for i in range(1, total+1)}, 'incomplete_python_plan')
    python = [step for step in summary['steps'] if step['name'] == 'python-units']
    _require(len(python) == 1 and len(python[0].get('shards', [])) == total, 'incomplete_python_times')
    seconds = {}
    for job in selected:
        index, count = partition(job['python_shard']);files = job['files']
        _require(isinstance(files, list) and len(files) == len(set(files))
                 and all(isinstance(p, str) and p.startswith('tests/') and not Path(p).is_absolute()
                         and '..' not in Path(p).parts for p in files), 'invalid_planned_files')
        planned.extend(files)
        matches = [part for part in python[0]['shards'] if (part.get('partition') or {}).get('index') == index]
        _require(len(matches) == 1 and matches[0]['partition'] == {'index': index, 'total': count, 'files': sorted(files)}, 'python_assignment_mismatch')
        times = _minutes(matches[0].get('timing', {}).get('files'))
        _require(set(times) <= set(files) and not set(times) & set(seconds), 'out_of_plan_times')
        seconds.update(times)
    _require(len(planned) == len(set(planned)) and seconds, 'incomplete_python_times')
    return {'minutes': {p: value/60 for p, value in seconds.items()}, 'planned_files': sorted(planned),
            'source': {'kind': 'checks_push', 'run_id': run['id'], 'attempt': attempt, 'commit': sha,
                       'repository': repository, 'artifact_id': artifact['id'],
                       'artifact_size_in_bytes': len(data), 'artifact_sha256': digest}}


def newest_timings(repository, request):
    runs = request('actions/workflows/checks.yml/runs?event=push&per_page=20')['workflow_runs']
    skipped = []
    for run in sorted(runs, key=lambda row: (row['created_at'], row['id']), reverse=True):
        try:
            _require(run.get('event') == 'push' and run.get('status') == 'completed', 'run_not_complete')
            artifacts = request('actions/runs/%d/artifacts?per_page=100' % run['id'])['artifacts']
            matches = [a for a in artifacts if a.get('name') == 'release-check' and not a.get('expired')]
            _require(len(matches) == 1, 'no_retained_timing_artifact')
            jobs = request('actions/runs/%d/attempts/%d/jobs?per_page=100' % (run['id'], run['run_attempt']))
            result = timing_receipt(run, matches[0], request('actions/artifacts/%d/zip' % matches[0]['id']), jobs, repository)
            result['source']['skipped'] = skipped
            return result
        except (ValueError, KeyError, TypeError, AttributeError, OSError) as error:
            reason = str(error) if isinstance(error,ValueError) and re.fullmatch('[a-z_]+',str(error)) else 'unavailable'
            skipped.append({'run_id': run.get('id'), 'reason': reason})
    raise ValueError('no_complete_retained_run')


def _api_timings(repository):
    _require(re.fullmatch(r'[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+', repository) is not None, 'repository_unavailable')
    began = time.monotonic()
    token = os.environ.get('GITHUB_TOKEN') or os.environ.get('GH_TOKEN')
    class NoRedirect(urllib.request.HTTPRedirectHandler):
        def redirect_request(self, req, fp, code, msg, headers, newurl):
            return None
    opener = urllib.request.build_opener(NoRedirect)
    def request(path):
        remaining = max(.01, LOOKUP_SECONDS-(time.monotonic()-began))
        headers = {'Accept': 'application/vnd.github+json', 'User-Agent': 'theseus-python-shard-weights'}
        if token: headers['Authorization'] = 'Bearer ' + token
        req = urllib.request.Request('https://api.github.com/repos/'+repository+'/'+path, headers=headers)
        try:
            response = opener.open(req, timeout=remaining)
        except urllib.error.HTTPError as error:
            if error.code not in (301,302,303,307,308):raise
            location = error.headers.get('Location', '')
            _require(urllib.parse.urlsplit(location).scheme == 'https'
                     and not urllib.parse.urlsplit(location).username, 'invalid_artifact_redirect')
            # Signed artifact storage never receives the GitHub Authorization header.
            response = urllib.request.urlopen(location, timeout=remaining)
        with response:
            data = response.read(MAX_TIMING_BYTES+1)
        _require(len(data) <= MAX_TIMING_BYTES, 'oversized_timing_evidence')
        return data if path.endswith('/zip') else _json(data)
    return newest_timings(repository, request)


def bounded_timings(repository, timeout=LOOKUP_SECONDS):
    try:
        answer = subprocess.run([sys.executable, '-I', str(Path(__file__).resolve()), '--lookup-python-times', repository],
                                capture_output=True, text=True, timeout=timeout)
    except subprocess.TimeoutExpired as error:
        raise ValueError('lookup_timeout') from error
    if answer.returncode:
        try:reason = _json(answer.stdout).get('error')
        except (ValueError, TypeError, AttributeError):reason = None
        raise ValueError(reason if isinstance(reason,str) and re.fullmatch('[a-z_0-9]+',reason) else 'lookup_unavailable')
    try:return _json(answer.stdout)
    except (ValueError, TypeError) as error:raise ValueError('lookup_invalid') from error


def table_commit(root):
    answer = subprocess.run(['git','-C',str(root),'rev-parse','HEAD'], capture_output=True, text=True)
    return answer.stdout.strip() if answer.returncode == 0 else None


def select_python_weights(root, weights, lookup=None):
    """One bounded refresh, then a visible checked-in fallback (Warp16596)."""
    files = test_files(root);config = weights.get('units') or {}
    reason = None
    try:
        if not files and lookup is None:
            raise ValueError('empty_python_inventory')
        repository = os.environ.get('GITHUB_REPOSITORY') or (config.get('python_source') or {}).get('repository')
        raw = lookup() if lookup is not None else bounded_timings(repository or '')
        measured = _minutes(raw['minutes']);source = dict(raw['source']);planned = set(raw.get('planned_files') or measured)
        _require(source.get('kind') == 'checks_push', 'lookup_invalid')
        selected = _effective_weights(weights, files, measured, planned, source)
        jobs(root, selected)
        return selected
    except (OSError, ValueError, KeyError, TypeError, AttributeError) as error:
        reason = str(error) if isinstance(error, ValueError) and re.fullmatch('[a-z_0-9]+', str(error)) else 'lookup_unavailable'
    measured = _minutes(config.get('python_minutes'))
    unmeasured = config.get('python_unmeasured') or {}
    _require(isinstance(unmeasured,dict) and all(isinstance(p,str) and reason in ('planned_untimed','new_or_renamed')
                                               for p,reason in unmeasured.items()), 'invalid_unmeasured_files')
    measured = {p:v for p,v in measured.items() if p not in unmeasured}
    source = {'kind':'checked_in','commit':table_commit(root), 'lookup_skip_reason':reason,
              'table_sha256':hashlib.sha256(json.dumps(config,sort_keys=True,separators=(',',':')).encode()).hexdigest()}
    planned = set(config.get('python_minutes') or {}) - {p for p,reason in unmeasured.items() if reason == 'new_or_renamed'}
    selected = _effective_weights(weights, files, measured, planned, source)
    jobs(root, selected)
    return selected


def _effective_weights(weights, files, measured, planned, source):
    result = copy.deepcopy(weights);current = {p:v for p,v in measured.items() if p in files}
    known = sorted(current.values());fallback = known[len(known)//2] if known else 1.0
    result['units']['python_minutes'] = {p:current.get(p,fallback) for p in files}
    result['units']['python_unmeasured'] = {p:('planned_untimed' if p in planned else 'new_or_renamed') for p in files if p not in current}
    result['units']['weight_source'] = dict(source, unused_files=sorted(set(measured)-set(files)),
                                          fallback_minutes=fallback,
                                          inventory_sha256=hashlib.sha256(json.dumps(files).encode()).hexdigest())
    return result


def partition(value):
    try:
        index, total = map(int, value.split('/'))
    except (ValueError, AttributeError):
        raise ValueError('Python shard must be INDEX/TOTAL')
    if not 1 <= index <= total:
        raise ValueError('Python shard needs 1 <= INDEX <= TOTAL')
    return index, total


def deal(files, minutes, total):
    """Deterministic longest-first bins; new files take the measured median."""
    known = sorted(minutes.values())
    fallback = known[len(known) // 2] if known else 1.0
    bins = [{'minutes': 0.0, 'files': []} for _ in range(total)]
    for path in sorted(files, key=lambda p: (-minutes.get(p, fallback), p)):
        lightest = min(bins, key=lambda b: b['minutes'])
        lightest['files'].append(path)
        lightest['minutes'] += minutes.get(path, fallback)
    return bins


def test_files(root):
    """Import-free inventory of unittest's files and package initializers.

    Discovery enters only directories containing __init__.py, and accepts
    test_*.py only when unittest considers the filename a module name.
    Package hooks may choose their own suites; their initializer owns them.
    """
    def walk(directory):
        for path in sorted(directory.iterdir()):
            if path.is_file():
                if path.match('test_*.py') and unittest.loader.VALID_MODULE_NAME.match(path.name):
                    yield str(path.relative_to(root))
            elif path.is_dir() and (path / '__init__.py').is_file():
                yield str((path / '__init__.py').relative_to(root))
                yield from walk(path)
    return sorted(walk(root / 'tests'))


def jobs(root, weights):
    config = weights['units']
    files = test_files(root)
    count = config.get('python_shards')
    _require(type(count) is int and count > 0, 'no_complete_python_deal')
    minutes = _minutes(config['python_minutes'])
    _require(type(config.get('setup_minutes')) in (int, float) and math.isfinite(config['setup_minutes'])
             and config['setup_minutes'] >= 0, 'invalid_setup_minutes')
    bins = deal(files, minutes, count)
    source = config.get('weight_source') or {'kind':'checked_in','commit':table_commit(root),
                                            'lookup_skip_reason':'explicit_table_input'}
    result = []
    for i, bucket in enumerate(bins, 1):
        measured = bucket['minutes'] + config['setup_minutes']
        _require(math.isfinite(measured * 1.5), 'invalid_dealt_minutes')
        result.append({'name': 'python units %d of %d' % (i, len(bins)), 'steps': 'python-units',
                       'python_shard': '%d/%d' % (i, len(bins)), 'files': sorted(bucket['files']),
                       'minutes': bucket['minutes'], 'weight_source': source,
                       'unmeasured_files': {p:reason for p,reason in (config.get('python_unmeasured') or {}).items() if p in bucket['files']},
                       'timeout': math.ceil(measured * 1.5)})
    for name in ('node-units', 'deploy-refusals'):
        result.append({'name': name, 'steps': name,
                       'timeout': math.ceil((config['minutes'][name] + config['setup_minutes']) * 1.5)})
    return result


def leaves(suite):
    for test in suite:
        if isinstance(test, unittest.TestSuite):
            yield from leaves(test)
        else:
            yield test


class FileLoader(unittest.TestLoader):
    """Keep discovery's source path even for synthetic tests or custom ids."""

    def __init__(self, root):
        super().__init__()
        self.root, self.owners = root.absolute(), {}

    def _find_test_path(self, full_path, pattern, *args, **kwargs):
        suite, recurse = super()._find_test_path(full_path, pattern, *args, **kwargs)
        if suite is not None:
            path = Path(full_path)
            if path.is_dir():
                path /= '__init__.py'
            owner = str(path.relative_to(self.root))
            for test in leaves(suite):
                self.owners[id(test)] = owner
        return suite, recurse


class TimedResult(unittest.TextTestResult):
    def startTest(self, test):
        self.began = time.monotonic()
        super().startTest(test)

    def stopTest(self, test):
        self.times.append({'test': str(test), 'seconds': time.monotonic() - self.began})
        super().stopTest(test)

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.times = []


class TimedModule(unittest.TestSuite):
    def __init__(self, tests, path, times):
        super().__init__(tests)
        self.path, self.times = path, times

    def run(self, result, debug=False):
        began = time.monotonic()
        try:
            return super().run(result, debug)
        finally:
            self.times[self.path] = time.monotonic() - began


def run(root, shard=None, weights=None, assignment=None):
    began = time.monotonic()
    chosen = partition(shard) if shard else None
    files = test_files(root)
    if assignment is not None:
        _require(chosen is not None and isinstance(assignment,list)
                 and all(isinstance(p,str) for p in assignment), 'invalid_python_assignment')
        _require(len(assignment) == len(set(assignment)) and set(assignment) <= set(files), 'invalid_python_assignment')
        selected = set(assignment)
    else:
        bins = deal(files, (weights or {}).get('units', {}).get('python_minutes', {}), chosen[1] if chosen else 1)
        selected = set(bins[chosen[0]-1]['files'] if chosen else files)
    sys.path.insert(0, str(root))
    loader = FileLoader(root)
    suite = loader.discover(str(root / 'tests'), pattern='test_*.py')
    modules = collections.OrderedDict()
    for test in leaves(suite):
        path = loader.owners[id(test)]
        modules.setdefault(path, []).append(test)
    file_times = {}
    planned = unittest.TestSuite(TimedModule(tests, path, file_times) for path, tests in modules.items() if path in selected)
    # Initializers and hook-suppressed files can complete a partition without
    # tests; the combiner requires a positive count across all partitions.
    if not chosen and not planned.countTestCases():
        raise ValueError('Python shard selected no tests')
    result = unittest.TextTestRunner(verbosity=2, resultclass=TimedResult).run(planned)
    slowest = sorted(result.times, key=lambda t: (-t['seconds'], t['test']))[:25]
    wall = time.monotonic() - began
    print('\nWall time: %.3fs\nSlowest 25 tests:' % wall, file=sys.stderr)
    for row in slowest:
        print('%.3fs %s' % (row['seconds'], row['test']), file=sys.stderr)
    evidence = {'tests': result.testsRun, 'timing': {'wall_seconds': wall, 'slowest_tests': slowest,
                                                 'files': file_times}}
    if chosen:
        evidence['python_shard'] = {'index': chosen[0], 'total': chosen[1], 'files': sorted(selected)}
    print(json.dumps(dict({'unit_shards': 1}, **evidence)), flush=True)
    return 0 if result.wasSuccessful() else 1


def unit_main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--root', type=Path, default=ROOT)
    parser.add_argument('--shard')
    args = parser.parse_args(argv)
    try:
        # Validate before even importing the suite.
        if args.shard:
            partition(args.shard)
        weight_path = args.root / '.github/check-weights.json'
        weights = json.loads(weight_path.read_text()) if weight_path.exists() else {}
        raw_assignment = os.environ.pop('AIM_PYTHON_SHARD_FILES', None)
        assignment = _json(raw_assignment) if raw_assignment else None
        return run(args.root, args.shard, weights, assignment)
    except ValueError as error:
        print('refused: %s' % error, file=sys.stderr)
        return 2


# Item734 rehomes workflow planning without changing the actual97 unit runner.
import os
if __package__ in (None, ''):
    sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from tools import release_check as check, ci_input_reads


def scope_record(base, changed, chosen, notes):
    native = ['native-' + step.name for step in check.NATIVE_STEPS]
    if len(chosen) != len(set(chosen)) or not set(chosen) <= set(native):
        raise check.Refused('scope did not choose unique native steps')
    return {'steps': chosen, 'live': base, 'changed': changed,
            'not_run': [name for name in native if name not in chosen],
            'notes': notes[:20], 'why': check.scoped_words(base, chosen)}


def plan(root, event_name, event, head, browser_shards=4, measured=None, weights=None):
    """{shards, scoped, why}: PR scope when provable; otherwise every required step."""
    if browser_shards < 1:
        raise ValueError('at least one browser shard')
    scoped, why = None, 'only pull requests may scope their checks'
    if event_name == 'pull_request':
        try:
            base = event['pull_request']['base']['sha']
            pr_head = event['pull_request']['head']['sha']
            if not all(isinstance(sha, str) and check.COMMIT.fullmatch(sha) for sha in (base, pr_head, head)):
                raise check.Refused('event has no exact base, PR head and tested head')
            # On GitHub HEAD is the tested merge, whose first parent must be the
            # event base. A moving release branch requires a fresh PR event.
            if head != pr_head:
                parents = check.git(root, 'rev-list', '--parents', '-n', '1', head)
                if parents.returncode or parents.stdout.strip().split() != [head, base, pr_head]:
                    raise check.Refused('tested merge does not bind the event base and PR head')
            scoped = ci_input_reads.pr_record(root, base, head)
            why = scoped['why']
        except (check.Refused, ci_input_reads.Refused, OSError, ValueError, KeyError, TypeError, AttributeError, SyntaxError) as error:
            why = 'full run: scope unavailable: %s' % error
    native = scoped['steps'] if scoped is not None else ['native-' + step.name for step in check.NATIVE_STEPS]
    measured = measured or {}
    known = sorted(measured.values())
    median = known[len(known) // 2] if known else 1.0
    loads = [[0.0, []] for _ in range(browser_shards)]
    for name in sorted(native, key=lambda n: -measured.get(n, median)):
        lightest = min(loads, key=lambda b: b[0])
        lightest[0] += measured.get(name, median)
        lightest[1].append(name)
    # Item 666: derive the browser cap from the selected deal, including scoped PRs.
    longest = max(load for load, names in loads)
    timeout = math.ceil(longest * 1.5)
    shards = [{'name': 'browser %d of %d (about %.0f min)' % (i + 1, browser_shards, load), 'steps': ','.join(names),
               'minutes': round(load, 1), 'timeout_minutes': timeout,
               'timeout_source': 'ceil(longest dealt %.1f minutes * 1.5); .github/check-weights.json sources' % longest}
              for i, (load, names) in enumerate(loads) if names]
    if weights is None:
        weights = select_python_weights(root, json.loads((root / '.github/check-weights.json').read_text()))
    for job in jobs(root, weights):
        job['timeout_minutes'] = job.pop('timeout')
        shards.append(job)
    shards.append({'name': 'wake replay', 'steps': check.WAKE_REPLAY, 'timeout_minutes': 45})
    expected = set(check.REQUIRED) - set(scoped['not_run'] if scoped else [])
    ordinary = [s for shard in shards if not shard.get('python_shard') for s in shard['steps'].split(',')]
    assert sorted(ordinary + ['python-units']) == sorted(expected)
    return {'shards': shards, 'scoped': scoped, 'why': why}


def plan_main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--event-name', default=os.environ.get('GITHUB_EVENT_NAME', ''))
    parser.add_argument('--event', default=os.environ.get('GITHUB_EVENT_PATH'))
    parser.add_argument('--head', default=os.environ.get('GITHUB_SHA', ''))
    parser.add_argument('--browser-shards', type=int, default=int(os.environ.get('BROWSER_SHARDS', '4')))
    parser.add_argument('--github-output', action='store_true')
    args = parser.parse_args(argv)
    root = Path(__file__).resolve().parents[1]
    try:
        event = json.loads(Path(args.event).read_text()) if args.event else {}
    except (OSError, ValueError):
        event = {}
    weights = json.loads((root / '.github/check-weights.json').read_text())
    try:
        weights = select_python_weights(root, weights)
        result = plan(root, args.event_name, event, args.head, args.browser_shards, weights['minutes'], weights)
    except (ValueError, KeyError, TypeError) as error:
        print('refused: no complete Python deal (%s)' % error, file=sys.stderr)
        return 2
    if args.github_output:
        print('shards=' + json.dumps(result['shards']))
        print('scoped=' + json.dumps(result['scoped']))
        print(result['why'], file=sys.stderr)
    else:
        print(json.dumps(result, indent=2))
    return 0


def main(argv=None):
    argv = list(sys.argv[1:] if argv is None else argv)
    if argv[:1] == ['--lookup-python-times']:
        try:
            print(json.dumps(_api_timings(argv[1])))
            return 0
        except (OSError, ValueError, KeyError, TypeError, IndexError, urllib.error.URLError) as error:
            reason = ('api_http_%d' % error.code if isinstance(error,urllib.error.HTTPError) else
                      str(error) if isinstance(error,ValueError) and re.fullmatch('[a-z_0-9]+',str(error)) else 'lookup_unavailable')
            print(json.dumps({'error':reason}))
            return 1
    if argv[:1] == ['--plan']:
        return plan_main(argv[1:])
    return unit_main(argv)


if __name__ == '__main__':
    sys.exit(main())

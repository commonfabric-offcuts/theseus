from __future__ import annotations

"""Whole-file unittest partitions, with wall time and slow-test evidence (665)."""
import argparse
import collections
import json
import math
import datetime
import re
from pathlib import Path
import sys
import time
import unittest

ROOT = Path(__file__).resolve().parents[1]


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
    bins = deal(files, config['python_minutes'], config['python_shards'])
    result = []
    for i, bucket in enumerate(bins, 1):
        measured = bucket['minutes'] + config['setup_minutes']
        result.append({'name': 'python units %d of %d' % (i, len(bins)), 'steps': 'python-units',
                       'python_shard': '%d/%d' % (i, len(bins)), 'files': sorted(bucket['files']),
                       'timeout': 49, 'timeout_source': 'python-49m-partitions-v1',
                       'historical_estimated_minutes_including_setup': measured})
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


def run(root, shard=None, weights=None):
    began = time.monotonic()
    chosen = partition(shard) if shard else None
    sys.path.insert(0, str(root))
    loader = FileLoader(root)
    suite = loader.discover(str(root / 'tests'), pattern='test_*.py')
    modules = collections.OrderedDict()
    for test in leaves(suite):
        path = loader.owners[id(test)]
        modules.setdefault(path, []).append(test)
    files = test_files(root)
    bins = deal(files, (weights or {}).get('units', {}).get('python_minutes', {}), chosen[1] if chosen else 1)
    selected = set(bins[chosen[0] - 1]['files'] if chosen else files)
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
        return run(args.root, args.shard, weights)
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


def browser_identities(files):
    """Conservative item734 inputs bind case generators, product and runtime.

    Only timing metadata is excluded: it does not execute a native step. The
    workflow, policies, commands, imports, fixtures and source readers remain.
    """
    required, reached = ci_input_reads.readers(files)
    return {name: ci_input_reads.digest(ci_input_reads.canonical({
        path: ci_input_reads.digest(data) for path, data in files.items()
        if name in reached[path] and path != '.github/check-weights.json'}))
        for name in required if name.startswith('native-')}


def committed_browser_identities(root, head):
    try:
        return browser_identities(ci_input_reads.source_files(root, head))
    except ci_input_reads.Refused as error:
        raise check.Refused('browser measurement inventory unavailable: %s' % error)


def positive_number(value):
    return type(value) in (int, float) and math.isfinite(value) and value > 0


def sha256(value):
    return isinstance(value, str) and re.fullmatch('[0-9a-f]{64}', value) is not None


def browser_case_inventory(report):
    # Reader expected-failure/restored phases intentionally repeat a name.
    # Their existing (phase, name) identity must survive measurement intact.
    cases = [(row.get('phase', ''), row.get('name')) for row in report.get('results', [])]
    if (not cases or not all(isinstance(phase, str) and isinstance(name, str) and name
                             for phase, name in cases) or len(cases) != len(set(cases))):
        raise check.Refused('browser observation invalid named case inventory')
    return sorted(cases)


def browser_observation(summary, report, name, identity, evidence):
    """Timing only; a finished failed result stays failed in original evidence.

    Call with the final summary and report bytes from a retained, independently
    authenticated artifact and identity computed from summary.commit's source.
    This helper grants no acceptance or continuation authority.
    """
    selected = [s['name'] for s in summary.get('steps', [])]
    if (summary.get('tree_unchanged') is not True or len(selected) != len(set(selected))
            or summary.get('only', summary.get('required')) != selected or selected.count(name) != 1
            or not check.COMMIT.fullmatch(summary.get('commit', ''))):
        raise check.Refused('browser observation requires a complete clean summary: ' + name)
    step = summary['steps'][selected.index(name)]
    cases = browser_case_inventory(report)
    counts = step.get('counts') or {}
    if (counts.get('tests') != len(cases)
            or counts.get('browser_closed') is not True
            or not (report.get('closed') is True or report.get('browserClosed') is True)
            or report.get('fixtureExitCode', 0) != 0 or report.get('fixtureErrors')
            or report.get('teardown')):
        raise check.Refused('browser observation incomplete inventory or cleanup: ' + name)
    try:
        seconds = (datetime.datetime.fromisoformat(step['finished_at'].replace('Z', '+00:00'))
                   - datetime.datetime.fromisoformat(step['started_at'].replace('Z', '+00:00'))).total_seconds()
    except (KeyError, ValueError, TypeError) as error:
        raise check.Refused('browser observation missing wall time: %s: %s' % (name, error))
    if not positive_number(seconds) or (identity is not None and not sha256(identity)):
        raise check.Refused('browser observation invalid duration or source: ' + name)
    return {'step': name, 'source': summary['commit'], 'inputs_sha256': identity,
            'seconds': seconds, 'case_count': len(cases),
            'cases_sha256': ci_input_reads.digest(ci_input_reads.canonical(sorted(cases))),
            'complete': True, 'cleanup': True, 'evidence': evidence}


def replace_browser_observations(observations, fresh):
    """Refresh measured steps after a future run; archive old rows separately.

    The caller authenticates retained bytes and formats completed steps with
    browser_observation. This changes timing inputs only, never a raw verdict.
    """
    replaced = {row['step'] for row in fresh}
    return sorted([row for row in observations if row['step'] not in replaced] + list(fresh),
                  key=lambda row: ci_input_reads.canonical(row))


def browser_jobs(native, observations, identities, budget, initial_shards):
    """Warp9266: maximum by step name, full coverage, fit first.

    Retained partial elapsed times are planning lower bounds. Source/runtime
    mismatch never discards timing; acceptance and cleanup remain elsewhere.
    """
    if len(native) != len(set(native)):
        raise check.Refused('duplicate browser selection')
    capacity = budget.get('capacity_minutes')
    reserve = budget.get('setup_upload_minutes')
    factor = budget.get('duration_factor')
    if (budget.get('policy') != 'browser-120m-fit-first-v1'
            or type(capacity) is not int or capacity != 120
            or type(reserve) not in (int, float) or reserve != 5
            or type(factor) not in (int, float) or factor != 1.25
            or type(initial_shards) is not int or initial_shards < 1):
        raise check.Refused('invalid browser capacity policy')
    durations, proofs, isolated, blocked = {}, {}, set(), []
    for name in sorted(native):
        rows = [row for row in observations if row.get('step') == name]
        for row in rows:
            evidence = row.get('evidence') or {}
            partial = row.get('kind') == 'partial-lower-bound' and row.get('complete') is False
            if (not positive_number(row.get('seconds'))
                    or not check.COMMIT.fullmatch(row.get('source', ''))
                    or not evidence.get('run') or not evidence.get('artifact')
                    or (not partial and (row.get('complete') is not True
                        or row.get('cleanup') is not True
                        or type(row.get('case_count')) is not int or row['case_count'] < 1
                        or (row.get('kind') != 'completed-log-interval' and (
                            not sha256(row.get('cases_sha256'))
                            or not sha256(evidence.get('report_sha256'))))))
                    or (partial and not sha256(evidence.get('log_sha256')))
                    or (not sha256(evidence.get('summary_sha256'))
                        and not sha256(evidence.get('log_sha256')))):
                raise check.Refused('invalid browser timing observation: ' + name)
        proofs[name] = sorted(rows, key=lambda r: ci_input_reads.canonical(r))
        if not rows:
            durations[name] = None
            isolated.add(name)
            continue
        durations[name] = max(row['seconds'] for row in rows) / 60
        if (durations[name] > (capacity - reserve) / factor / 2
                or any(row.get('complete') is False for row in rows)):
            isolated.add(name)
        if durations[name] * factor + reserve > capacity:
            blocked.append(name + ': oversize %.3f measured * %.2f + %.3f reserve > %d minutes' % (
                durations[name], factor, reserve, capacity))
    if blocked:
        raise check.Refused('browser plan cannot fit observed steps; ' + '; '.join(blocked))
    known = [name for name in native if name not in isolated]
    bins = [{'minutes': 0.0, 'steps': []} for _ in range(min(initial_shards, len(known)))]
    for name in sorted(known, key=lambda n: (-durations[n], n)):
        bucket = min(bins, key=lambda b: b['minutes'])
        if (bucket['minutes'] + durations[name]) * factor + reserve > capacity:
            bucket = {'minutes': 0.0, 'steps': []}
            bins.append(bucket)
        bucket['steps'].append(name)
        bucket['minutes'] += durations[name]
    bins = [b for b in bins if b['steps']]
    for name in sorted(isolated, key=lambda n: (durations[n] is None, -(durations[n] or 0), n)):
        bins.append({'minutes': durations[name], 'steps': [name]})
    assigned = [n for b in bins for n in b['steps']]
    if sorted(assigned) != sorted(native):
        raise check.Refused('browser coverage differs from complete selection')
    result = []
    for i, bucket in enumerate(bins, 1):
        minutes = bucket['minutes']
        partial = any(row.get('complete') is False for n in bucket['steps'] for row in proofs[n])
        if minutes is not None and minutes * factor + reserve > capacity:
            raise check.Refused('overfilled browser bin')
        result.append({'name': 'browser %d of %d (capacity %d min)' % (i, len(bins), capacity),
                       'steps': ','.join(bucket['steps']), 'minutes': minutes,
                       'budget_minutes': math.ceil(minutes * factor + reserve) if minutes is not None else None,
                       'timeout_minutes': capacity, 'timeout_source': budget['policy'],
                       'timing_basis': ('unknown-first-run' if minutes is None else
                                        'includes-partial-lower-bound' if partial else 'retained-step-maximum'),
                       'measurements': {n: proofs[n] for n in bucket['steps']}})
    return result


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
    if weights is None:
        weights = json.loads((root / '.github/check-weights.json').read_text())
    # Timing is chosen by step name under warp9266. The item734 scope proof
    # above still binds the event/source; timing never grants acceptance.
    identities = {}
    ordinary_native = [name for name in native if name != 'native-compose']
    shards = browser_jobs(ordinary_native, weights.get('browser_observations', []), identities,
                          weights.get('browser_budget', {}), browser_shards)
    if 'native-compose' in native:
        from tools import compose_groups
        source = {'head': head, 'tree': check.git(root, 'rev-parse', head + '^{tree}').stdout.strip(),
                  'parents': check.git(root, 'rev-list', '--parents', '-n', '1', head).stdout.split()[1:]}
        compose = compose_groups.partition(compose_groups.enumerate_source(root, head), source)
        shards.extend(compose_groups.group_jobs(compose, weights.get('compose_group_observations', []), compact=True))
    for job in jobs(root, weights):
        job['timeout_minutes'] = job.pop('timeout')
        shards.append(job)
    shards.append({'name': 'wake replay', 'steps': check.WAKE_REPLAY, 'timeout_minutes': 45})
    expected = set(check.REQUIRED) - set(scoped['not_run'] if scoped else [])
    ordinary = [s for shard in shards if not shard.get('python_shard') and not shard.get('compose_group') for s in shard['steps'].split(',')]
    assert sorted(ordinary + ['python-units'] + (['native-compose'] if 'native-compose' in native else [])) == sorted(expected)
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
        result = plan(root, args.event_name, event, args.head, args.browser_shards, weights['minutes'], weights)
    except (check.Refused, ValueError) as error:
        print('refused: %s' % error, file=sys.stderr)
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
    if argv[:1] == ['--plan']:
        return plan_main(argv[1:])
    return unit_main(argv)


if __name__ == '__main__':
    sys.exit(main())

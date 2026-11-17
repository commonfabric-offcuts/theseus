from __future__ import annotations

"""Whole-file unittest partitions, with wall time and slow-test evidence (665)."""
import argparse
import collections
import json
import math
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


def jobs(root, weights):
    config = weights['units']
    files = sorted(str(p.relative_to(root)) for p in (root / 'tests').glob('test_*.py'))
    bins = deal(files, config['python_minutes'], config['python_shards'])
    result = []
    for i, bucket in enumerate(bins, 1):
        measured = bucket['minutes'] + config['setup_minutes']
        result.append({'name': 'python units %d of %d' % (i, len(bins)), 'steps': 'python-units',
                       'python_shard': '%d/%d' % (i, len(bins)), 'files': sorted(bucket['files']),
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
    suite = unittest.TestLoader().discover(str(root / 'tests'), pattern='test_*.py')
    modules = collections.OrderedDict()
    for test in leaves(suite):
        # Failed imports stay tests too; dropping one would turn an error green.
        module = test.id().rsplit('.', 2)[0]
        path = 'tests/' + module.replace('.', '/') + '.py'
        modules.setdefault(path, []).append(test)
    files = sorted(str(p.relative_to(root)) for p in (root / 'tests').glob('test_*.py'))
    bins = deal(files, (weights or {}).get('units', {}).get('python_minutes', {}), chosen[1] if chosen else 1)
    selected = set(bins[chosen[0] - 1]['files'] if chosen else files)
    # Unittest's synthetic failed-import id is not a source path. Keep it in one
    # shard so discovery can never silently lose its error.
    unknown = set(modules) - set(files)
    if unknown and (chosen is None or chosen[0] == 1):
        selected |= unknown
    file_times = {}
    planned = unittest.TestSuite(TimedModule(tests, path, file_times) for path, tests in modules.items() if path in selected)
    if not planned.countTestCases():
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


def main(argv=None):
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


if __name__ == '__main__':
    sys.exit(main())

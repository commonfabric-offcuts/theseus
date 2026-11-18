from __future__ import annotations

"""775: source-only compose partition, planning and exact raw receipt union.

No browser, store, profile, network, production workflow or dispatch entry point.
"""
from collections import Counter
import hashlib
import json
import math
from pathlib import Path
import subprocess
import tempfile


class Refused(ValueError):
    pass


def canonical(value):
    return json.dumps(value, sort_keys=True, separators=(',', ':'), ensure_ascii=False).encode()


def digest(value):
    return hashlib.sha256(canonical(value)).hexdigest()


def identity(row):
    return row['phase'], row['engine'], row['name']


def enumerate_source(root, head, node='node'):
    # Immutable Git reads only. Enumeration runs no case actions or fixtures.
    with tempfile.TemporaryDirectory(prefix='compose-inventory-775-') as folder:
        target = Path(folder) / 'inventory.json'
        result = subprocess.run([node, '--experimental-vm-modules',
                                 str(Path(__file__).with_name('compose_inventory.cjs')),
                                 head, str(target)], cwd=str(root), capture_output=True, text=True)
        if result.returncode:
            raise Refused('compose source enumeration refused: ' + result.stderr[-4000:])
        return json.loads(target.read_text())


def partition(inventory, source, retained=(), timings=()):
    rows = [dict(row, case_id=digest(identity(row))) for row in inventory['rows']]
    keys = [identity(r) for r in rows]
    if not keys or len(keys) != len(set(keys)):
        raise Refused('empty or duplicate compose inventory')
    phases = {r['phase'] + ':' + r['engine'] for r in rows}
    if not set(retained) <= phases:
        raise Refused('retained phase absent from source')
    # Successful-case durations exclude ending/reset and failed cases have no ms.
    # Use MAX, never a median; timing only informs a conservative policy limit.
    durations = [r['ms'] for r in timings if type(r.get('ms')) in (int, float) and r['ms'] > 0]
    maximum = max(durations) / 1000 if durations else None
    known_names = {r['name'] for r in timings if type(r.get('ms')) in (int, float) and r['ms'] > 0}
    measured_limit = math.ceil(maximum * 1.25) + 60 if maximum else 300
    groups, bucket = [], []
    def flush():
        if not bucket:
            return
        members = [dict(r, limit_seconds=(measured_limit if r['name'] in known_names else 300),
                        limit_basis=('retained-success-MAX-times-1.25-plus-60s-ending-reserve'
                                     if r['name'] in known_names else 'unknown-300s-policy-not-measurement'))
                   for r in bucket]
        total = sum(r['limit_seconds'] for r in members)
        key = digest(members)
        groups.append({'id': 'compose-' + key[:20], 'source': source,
                       'inventory_sha256': digest(rows), 'cases_sha256': digest(members),
                       'cases': members, 'phase': members[0]['phase'], 'engine': members[0]['engine'],
                       'case_budget_seconds': total, 'phase_seconds': total + 300,
                       'seed_seconds': 300, 'launch_seconds': 120, 'final_seconds': 120,
                       'wall_seconds': 5400, 'terminal_cleanup_seconds': 60, 'watchdog_grace_seconds': 5, 'worker_exit_seconds': 5,
                       'timeout_minutes': 120, 'minutes': None, 'budget_minutes': None,
                       'timing_basis': 'unknown-first-group-run',
                       'overlap': 'common seed and full helper setup; answering coordinator also seeded for sending; no case replay within union'})
        bucket.clear()
    for row in rows:
        if row['phase'] + ':' + row['engine'] in retained:
            continue
        cost = measured_limit if row['name'] in known_names else 300
        if cost > 4400:
            raise Refused('case limit cannot fit compose group: ' + row['name'])
        if bucket and (identity(bucket[-1])[:2] != identity(row)[:2]
                       or sum(measured_limit if r['name'] in known_names else 300 for r in bucket) + cost > 4400):
            flush()
        bucket.append(row)
    flush()
    completed = [r for r in rows if r['phase'] + ':' + r['engine'] in retained]
    union = completed + [r for g in groups for r in g['cases']]
    if Counter(identity(r) for r in union) != Counter(keys):
        raise Refused('compose partition union differs')
    return {'version': 1, 'source': source, 'inventory_sha256': digest(rows),
            'retained_phases': list(retained), 'retained_cases': completed, 'groups': groups,
            'limits': {'retained_max_success_seconds': maximum, 'successful_case_limit_seconds': measured_limit,
                       'unknown_case_seconds': 300, 'case_sum_ceiling_seconds': 4400,
                       'qualification': 'ms is successful action only; failed/unfinished cases unknown; no completed group timing'},
            'complete': False, 'native_executions': 0}


def group_jobs(partitioned, observations=(), compact=False):
    jobs = []
    for group in partitioned['groups']:
        observations_for_group = [r for r in observations if r.get('group') == group['id']
                                  and r.get('cases_sha256') == group['cases_sha256']]
        for row in observations_for_group:
            partial = row.get('kind') == 'partial-lower-bound' and row.get('complete') is False
            if (type(row.get('seconds')) not in (int, float) or not math.isfinite(row['seconds'])
                    or row['seconds'] <= 0 or not row.get('evidence_sha256')
                    or (not partial and (row.get('complete') is not True or row.get('cleanup') is not True))):
                raise Refused('invalid compose group timing')
        minutes = max(r['seconds'] for r in observations_for_group) / 60 if observations_for_group else None
        if minutes is not None and minutes * 1.25 + 5 > 120:
            raise Refused('compose group exceeds installed capacity: ' + group['id'])
        jobs.append({'name': group['id'], 'steps': 'native-compose', 'compose_group': ({k: v for k, v in group.items() if k != 'cases'} if compact else group),
                     'minutes': minutes, 'budget_minutes': math.ceil(minutes * 1.25 + 5) if minutes is not None else None,
                     'timeout_minutes': 120, 'timeout_source': 'browser-120m-fit-first-v1',
                     'timing_basis': ('includes-partial-lower-bound' if any(r.get('complete') is False for r in observations_for_group)
                                      else 'retained-group-maximum' if minutes is not None else 'unknown-first-run'),
                     'measurements': observations_for_group})
    if not jobs:
        raise Refused('empty compose group plan')
    return jobs


def collect(plan, receipts):
    """Raw union only; authentication and independent admission are separate."""
    if plan.get('retained_cases'):
        raise Refused('retained phase union needs the original authenticated evidence; group collector is not its admission path')
    groups = {g['id']: g for g in plan['groups']}
    if len(groups) != len(plan['groups']):
        raise Refused('duplicate planned compose group')
    seen, completed_groups, results = set(), set(), []
    for receipt in receipts:
        gid = receipt.get('group')
        if gid not in groups or gid in seen:
            raise Refused('unplanned or duplicate compose receipt')
        group = groups[gid]
        if receipt.get('source') != group['source'] or receipt.get('cases_sha256') != group['cases_sha256']:
            raise Refused('compose receipt source/inventory differs')
        # Partial outputs preserve every raw row but supply no completion.
        rows = receipt.get('results', [])
        planned = group.get('cases', receipt.get('planned_cases', []))
        if not planned or digest(planned) != group['cases_sha256']:
            raise Refused('compose receipt planned inventory digest differs')
        actual, expected = Counter(identity(r) for r in rows), Counter(identity(r) for r in planned)
        if any(v != 1 for v in actual.values()) or any(k not in expected for k in actual):
            raise Refused('compose receipt case union differs')
        if receipt.get('complete') is True and receipt.get('cleanup') is True:
            if actual != expected:
                raise Refused('compose receipt case union differs')
            completed_groups.add(gid)
        if any(type(r.get('passed')) is not bool for r in rows):
            raise Refused('compose result lacks literal verdict')
        seen.add(gid); results.extend(rows)
    missing = sorted(set(groups) - completed_groups)
    return {'complete': not missing, 'passed': not missing and bool(results) and all(r['passed'] for r in results)
            and all(r.get('passed') is True and type(r.get('exit')) is int and r['exit'] == 0 for r in receipts),
            'missing_groups': missing, 'results': results,
            'raw_false': [r for r in results if r['passed'] is False],
            'expected_mutants': [r for r in results if r.get('expectedFailure') and r.get('mutationCaught') is True],
            'receipts': list(receipts), 'admitted': False}


def observation(receipt, evidence_sha256):
    if (type(receipt.get('seconds')) not in (int, float) or receipt['seconds'] <= 0):
        raise Refused('group supplies no positive duration')
    return {'step': 'native-compose', 'group': receipt['group'],
            'cases_sha256': receipt['cases_sha256'], 'seconds': receipt['seconds'],
            'source': receipt['source'], 'complete': receipt['complete'] and receipt['cleanup'], 'cleanup': receipt['cleanup'],
            'original_complete': receipt['complete'], 'original_cleanup': receipt['cleanup'],
            'kind': 'complete-group-wall' if receipt['complete'] and receipt['cleanup'] else 'partial-lower-bound',
            'raw_passed': receipt['passed'], 'evidence_sha256': evidence_sha256}

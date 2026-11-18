from __future__ import annotations

"""779: authenticated compose coverage, never a product/own-case acceptance.

V1 checks remain in continuation_envelope. The extra retirement/job certificate
is deliberately required: existing 775 receipts alone cannot attest those facts.
"""
from collections import Counter
import difflib
import io
import re
from pathlib import Path
import subprocess
import tempfile
import zipfile
from urllib.parse import urlsplit

from tools import base_move as b, continuation_envelope as ce
from tools import compose_collector_775 as collector

HARNESS = 'tests/reader_compose_native.mjs'
PRODUCER = ('compose_inventory.cjs', 'compose_instrument.cjs', 'compose_deadline_775.mjs',
            'compose_worker_775.mjs', 'run_compose_group.py', 'compose_groups.py')


def same(left, right, why):
    b.require(b.canonical(left) == b.canonical(right), 'grouped ' + why)


def identities(rows):
    b.require(isinstance(rows, list) and bool(rows), 'grouped empty case inventory')
    keys = []
    for row in rows:
        b.require(isinstance(row, dict) and row.get('engine') in ('chromium', 'webkit')
                  and isinstance(row.get('phase'), str) and isinstance(row.get('name'), str)
                  and row['name'].startswith(row['engine'] + ' '), 'grouped phase/engine identity differs')
        keys.append((row['phase'], row['engine'], row['name']))
    b.require(len(keys) == len(set(keys)), 'grouped duplicate case identity')
    return keys


def enumerate_source(git, head, node='node'):
    # Script-relative verifier, never candidate tools. VM replaces check actions
    # and fixture I/O; complete input hashes are independently checked below.
    root = b.ask(git, 'rev-parse', '--show-toplevel').strip()
    with tempfile.TemporaryDirectory(prefix='admission779-inventory-') as temp:
        output = Path(temp) / 'inventory.json'
        run = subprocess.run([node, '--experimental-vm-modules',
                              str(Path(__file__).with_name('compose_inventory_779.cjs')),
                              head, str(output)], cwd=root, capture_output=True, text=True)
        b.require(run.returncode == 0, 'grouped independent source enumeration refused: ' + run.stderr[-1000:])
        return b.loads(output.read_bytes())


def review(ref, body, judgment, kind):
    data = b.fields(b.document(ref), 'version reviewer record body_sha256 kind')
    b.require(type(data['version']) is int and data['version'] == 1 and data['reviewer'] == 'auditor'
              and data['kind'] == kind and data['record'] != judgment['audit'], 'grouped independent review differs')
    b.words(data['record'])
    same(data['body_sha256'], b.digest(b.canonical(body)), 'review body differs')
    return data


def archive(binding, git, github, repository, facts=None, role='check'):
    b.fields(binding, 'run attempt run_head workflow_head event job job_name id name archive')
    b.require(role in ('check', 'summary'), 'grouped archive role differs')
    upload = 'Keep the evidence'
    if role == 'summary':
        b.require(binding['name'] == 'release-check' and binding['job_name'] == "the whole run's summary",
                  'grouped summary archive/job differs')
        upload = "Keep the whole run's summary"
    b.sha(binding['workflow_head']); b.sha(binding['run_head'])
    b.require(binding['event'] in ('pull_request', 'workflow_dispatch'), 'grouped event differs')
    key = (binding['run'], binding['attempt'], binding['run_head'], binding['event'])
    if facts is None:
        facts = {}
    if key not in facts:
        facts[key] = ce.run_fact(binding, github, repository, binding['run_head'], binding['event'], grouped=True)
    run, jobs = facts[key]
    b.require(binding['job'] in jobs and jobs[binding['job']]['name'] == binding['job_name'], 'grouped job assignment differs')
    job = jobs[binding['job']]
    raw = b.artifact(binding['archive'])
    meta = github.get('repos/%s/actions/artifacts/%d' % (repository, binding['id']))
    wr = meta.get('workflow_run') or {}
    b.require(type(binding['id']) is int and meta.get('id') == binding['id'] and meta.get('name') == binding['name']
              and meta.get('expired') is False and meta.get('size_in_bytes') == len(raw)
              and meta.get('digest') == 'sha256:' + b.digest(raw)
              and wr.get('id') == run['id'] and wr.get('head_sha') == run['head_sha']
              and wr.get('head_branch') == run['head_branch']
              and wr.get('repository_id') == run['repository']['id']
              and wr.get('head_repository_id') == run['head_repository']['id'], 'grouped artifact provenance differs')
    uploads = [s for s in job.get('steps', []) if s.get('name') == upload
               and s.get('status') == 'completed' and s.get('conclusion') == 'success']
    b.require(len(uploads) == 1 and ce.stamp(uploads[0]['started_at']) <= ce.stamp(meta['created_at'])
              <= ce.stamp(job['completed_at']), 'grouped artifact attempt/upload differs')
    # Read only named evidence, never run.json's profile or arbitrary files.
    with zipfile.ZipFile(io.BytesIO(raw)) as z:
        names = z.namelist()
        b.require(len(names) == len(set(names)), 'grouped duplicate ZIP member')
        for name in names:
            b.safe_path(name[:-1] if name.endswith('/') else name)
        def read(name):
            b.safe_path(name)
            b.require(name in names, 'grouped missing artifact member ' + name)
            return z.read(name)
        read.members = set(names)
        yield read, run, job


def certificate(read, binding, product, package, group, repository):
    cert = b.fields(b.loads(read('admission779.json')),
        'version run attempt workflow_head workflow_sha256 job group product package_sha256 command origins checkout source_restored producer_retired')
    b.require(type(cert['version']) is int and cert['version'] == 1, 'grouped certificate version differs')
    for key in ('run', 'attempt', 'workflow_head', 'job'):
        same(cert[key], binding[key], 'certificate ' + key + ' differs')
    same(cert['workflow_sha256'], package['workflow']['sha256'], 'workflow certificate differs')
    same(cert['group'], group['id'], 'certificate group differs')
    same(cert['product'], product, 'certificate product differs')
    same(cert['package_sha256'], b.digest(b.canonical(package)), 'certificate package differs')
    b.require(cert['source_restored'] is True and cert['producer_retired'] is True, 'grouped unretired producer')
    command = cert['command']
    b.require(isinstance(command, list) and command == package['commands'][group['id']], 'grouped command differs')
    b.require(isinstance(cert['checkout'], str) and Path(cert['checkout']).is_absolute(), 'grouped missing isolated checkout')
    origins = cert['origins']
    b.require(isinstance(origins, list) and len(origins) >= 2 and len(set(origins)) == len(origins)
              and all(isinstance(x, str) and x.startswith('http://127.0.0.1:') for x in origins), 'grouped fixture origins differ')
    for origin in origins:
        parsed = urlsplit(origin)
        b.require(parsed.scheme == 'http' and parsed.hostname == '127.0.0.1' and parsed.port is not None
                  and 0 < parsed.port < 65536 and not parsed.path and not parsed.query and not parsed.fragment
                  and parsed.username is None and parsed.password is None, 'grouped invalid fixture origin')
    return cert


def validate(ref, judgment, git, github, repository, head, anchor, mode='continuation'):
    packet = b.fields(b.document(ref),
        'version product original_anchor package partition inventory inventory_review originals groups collector dispositions review')
    b.require(type(packet['version']) is int and packet['version'] == 1, 'grouped packet version differs')
    b.require(mode in ('continuation', 'fullChecks'), 'grouped mode differs')
    if mode == 'fullChecks':
        b.require(anchor['tested_merge']['sha'] == head, 'grouped fullChecks tested source differs')
    same(packet['original_anchor'], anchor, 'original/controller anchor differs')
    product = b.fields(packet['product'], 'head tree parents')
    b.require(product == {'head': head, 'tree': b.tree(git, head), 'parents': b.parents(git, head)}, 'grouped product source differs')
    auth = review(packet['review'], {k: v for k, v in packet.items() if k != 'review'}, judgment, 'compose-admission')
    package = b.fields(b.document(packet['package']), 'product_harness patched_harness patch producer workflow workflow_head commands review')
    patch_review = review(package['review'], {k: v for k, v in package.items() if k != 'review'}, judgment, 'source-patch')
    b.require(auth['record'] != patch_review['record'], 'grouped separate patch review missing')
    original = ce.git_bytes(git, head, HARNESS)
    b.require(b.artifact(package['product_harness']) == original, 'grouped original harness differs')
    patched = b.artifact(package['patched_harness'])
    delta = ''.join(difflib.unified_diff(original.decode().splitlines(True), patched.decode().splitlines(True),
                                        fromfile='product/' + HARNESS, tofile='instrument/' + HARNESS)).encode()
    b.require(original != patched and b.artifact(package['patch']) == delta, 'grouped exact source patch differs')
    b.require(set(package['producer']) == set(PRODUCER), 'grouped producer inventory differs')
    for name, ref_file in package['producer'].items():
        b.require(bool(b.artifact(ref_file)), 'grouped empty producer')
    b.sha(package['workflow_head'])
    b.require(b.artifact(package['workflow']) == ce.git_bytes(git, package['workflow_head'], ce.WORKFLOW), 'grouped frozen workflow differs')
    inventory = b.document(packet['inventory'])
    actual = enumerate_source(git, head)
    same(inventory['rows'], actual['rows'], 'complete independently enumerated source case inventory differs')
    same(inventory['hashes'], actual['hashes'], 'enumeration input inventory differs')
    keys = identities(actual['rows'])
    b.require(len({r['name'] for r in actual['rows']}) == len(keys), 'grouped ambiguous original source name')
    for path, digest in actual['hashes'].items():
        b.require(b.digest(ce.git_bytes(git, head, path)) == digest, 'grouped input source differs')
    inv_review = review(packet['inventory_review'], {'product': product, 'inventory': packet['inventory']}, judgment, 'source-inventory')
    b.require(inv_review['record'] not in (auth['record'], patch_review['record']), 'grouped independent inventory review missing')
    plan = b.document(packet['partition'])
    same(plan['source'], product, 'partition product differs')
    source_rows = [dict(r, case_id=collector.digest(collector.identity(r))) for r in actual['rows']]
    same(plan['inventory_sha256'], collector.digest(source_rows), 'partition inventory differs')
    retained = plan['retained_cases']; groups = plan['groups']
    b.require(isinstance(groups, list) and bool(groups) and len({g['id'] for g in groups}) == len(groups), 'grouped duplicate/empty groups')
    coverage = list(retained)
    for group in groups:
        same(group['source'], product, 'group product differs')
        same(group['inventory_sha256'], plan['inventory_sha256'], 'group inventory differs')
        same(group['cases_sha256'], collector.digest(group['cases']), 'planned case digest differs')
        b.require(group['id'] == 'compose-' + group['cases_sha256'][:20], 'grouped case group ID differs')
        limits = [r.get('limit_seconds') for r in group['cases']]
        b.require(bool(limits) and all(type(n) is int and 0 < n <= 300 for n in limits)
                  and group.get('case_budget_seconds') == sum(limits) <= 4400
                  and group.get('phase_seconds') == sum(limits) + 300, 'grouped case deadline bound differs')
        for field, limit in (('wall_seconds', 5400), ('seed_seconds', 300), ('launch_seconds', 120),
                             ('final_seconds', 120), ('terminal_cleanup_seconds', 60), ('watchdog_grace_seconds', 5),
                             ('worker_exit_seconds', 5), ('timeout_minutes', 120)):
            b.require(type(group.get(field)) is int and group[field] == limit, 'grouped producer bound differs: ' + field)
        b.require(all(r['phase'] == group['phase'] and r['engine'] == group['engine'] for r in group['cases']), 'grouped wrong phase/engine')
        for row in group['cases']:
            same(row['case_id'], collector.digest(collector.identity(row)), 'case ID differs')
        coverage.extend(group['cases'])
    b.require(Counter(identities(coverage)) == Counter(keys), 'grouped exact remaining union differs')
    b.require(set(package['commands']) == {g['id'] for g in groups}, 'grouped command inventory differs')
    b.require(len(plan['retained_phases']) == len(set(plan['retained_phases'])), 'grouped duplicate retained phase')
    originals, retained_results, qualifications, all_false = [], [], [], []
    facts = {}
    b.require(len(packet['originals']) == (1 if mode == 'continuation' else 0), 'grouped original evidence inventory differs')
    if mode == 'fullChecks':
        b.require(not retained and not plan['retained_phases'], 'grouped fullChecks cannot retain partial phases')
    for entry in packet['originals']:
        b.fields(entry, 'binding progress phases log hashes dispatch retirement')
        for read, run, job in archive(entry['binding'], git, github, repository, facts):
            progress = [b.loads(line) for line in read(entry['progress']).splitlines()]
            b.require(bool(progress) and [r['name'] for r in progress] == [r['name'] for r in actual['rows'][:len(progress)]], 'grouped original prefix differs')
            b.require(all(type(r.get('passed')) is bool for r in progress), 'grouped original verdict differs')
            phases = b.loads(read(entry['phases']))
            phase_inventory = list(dict.fromkeys(r['phase'] + ':' + r['engine'] for r in actual['rows']))
            b.require(phases.get('browserClosed') is True and phases.get('harnessCompleted') is False and phases.get('plannedPhases') == phase_inventory,
                      'grouped original partial phase inventory differs')
            same(phases['completedPhases'], phase_inventory[:len(phases['completedPhases'])], 'original phase order differs')
            same(phases['completedPhases'], plan['retained_phases'], 'original phase boundaries differ')
            expected_retained = [r for r in actual['rows'] if r['phase'] + ':' + r['engine'] in plan['retained_phases']]
            same(retained, [dict(r, case_id=collector.digest(collector.identity(r))) for r in expected_retained], 'retained phase inventory differs')
            selected = {r['name'] for r in retained}
            kept = [r for r in progress if r['name'] in selected]
            b.require(len(kept) == len(retained), 'grouped incomplete retained phase')
            retained_results.extend(kept)
            dispatch = b.loads(read(entry['dispatch']))
            same(dispatch, anchor['partial_dispatch'], 'original dispatch relabelled')
            b.require(dispatch.get('original_run') == anchor['run'] and dispatch.get('original_attempt') == anchor['attempt']
                      and dispatch.get('release_base') == anchor['base_at_run']['sha'], 'grouped original producer/base differs')
            b.sha(dispatch.get('original_source'))
            b.require(type(dispatch.get('version')) is int and dispatch['version'] == 1
                      and dispatch.get('requested_source') == head and dispatch.get('parents') == product['parents']
                      and dispatch.get('workflow_sha') == entry['binding']['workflow_head']
                      and dispatch.get('workflow_ref') == repository + '/' + ce.WORKFLOW + '@refs/heads/' + run['head_branch'],
                      'grouped original source/workflow command differs')
            b.require(dispatch['checked_source'] == head and dispatch['checked_tree'] == product['tree']
                      and str(dispatch['run']) == str(run['id']) and str(dispatch['attempt']) == str(run['run_attempt'])
                      and dispatch['workflow_api_head'] == run['head_sha'], 'grouped original dispatch source differs')
            hashes = b.loads(read(entry['hashes']))
            b.require(set(actual['hashes']) <= set(hashes), 'grouped original source inputs absent')
            for path, digest in hashes.items():
                b.require(b.digest(ce.git_bytes(git, head, path)) == digest, 'grouped original source hash differs')
            raw_log = read(entry['log'])
            b.require(bool(raw_log), 'grouped original later log absent')
            qualifications.append({'archive': entry['binding']['archive'], 'phases': phases,
                                   'log_sha256': b.digest(raw_log), 'final_cleanup': False})
            originals.extend(progress)
            all_false.extend({'origin': 'original', 'row': r} for r in progress if r['passed'] is False)
        retirement = entry['retirement']
        b.fields(retirement, 'binding member')
        rb = retirement['binding']
        b.require(rb['workflow_head'] == package['workflow_head'] == rb['run_head'] and rb['event'] == 'workflow_dispatch'
                  and rb['job_name'] == 'retire-original-compose-779', 'grouped reviewed original retirement producer differs')
        for read, _, job in archive(rb, git, github, repository, facts):
            b.require(job.get('conclusion') in ('success', 'failure'), 'grouped unretired original retirement job')
            retired = b.fields(b.loads(read(retirement['member'])), 'original_archive_sha256 producer_retired browser_closed fixtures_closed source_restored')
            same(retired['original_archive_sha256'], entry['binding']['archive']['sha256'], 'retirement original differs')
            b.require(all(retired.get(k) is True for k in ('producer_retired', 'browser_closed', 'fixtures_closed', 'source_restored')), 'grouped original cleanup/unretired refusal')
    receipts, seen, origins, checkouts = [], set(), set(), set()
    planned = {g['id']: g for g in groups}
    for entry in packet['groups']:
        b.fields(entry, 'group binding')
        gid = entry['group']
        b.require(gid in planned and gid not in seen, 'grouped missing/duplicate/unknown group')
        seen.add(gid); group = planned[gid]; binding = entry['binding']
        b.require(binding['workflow_head'] == package['workflow_head'], 'grouped source workflow differs')
        if mode == 'fullChecks':
            b.require(binding['run'] == anchor['run'] and binding['attempt'] == anchor['attempt']
                      and binding['run_head'] == anchor['tested_merge']['second_parent']
                      and binding['event'] == 'pull_request' and package['workflow_head'] in
                      (head, anchor['tested_merge']['second_parent']), 'grouped fullChecks producer binding differs')
        else:
            b.require(binding['event'] == 'workflow_dispatch' and binding['run_head'] == binding['workflow_head'],
                      'grouped continuation workflow run differs')
        b.require(binding['job_name'] == gid, 'grouped source group workflow assignment differs')
        for read, run, job in archive(binding, git, github, repository, facts):
            b.require(job.get('conclusion') in ('success', 'failure') and 'group-timeout.json' not in read.members,
                      'grouped timed-out/unretired group refuses')
            cert = certificate(read, binding, product, package, group, repository)
            b.require(not origins.intersection(cert['origins']) and cert['checkout'] not in checkouts, 'grouped shared origin/checkout')
            origins.update(cert['origins']); checkouts.add(cert['checkout'])
            same(b.loads(read('group.json')), group, 'actual group differs')
            receipt = b.loads(read('group-receipt.json')); report = b.loads(read('native.json'))
            same(receipt['binding'], b.loads(read('source-binding.json')), 'source binding differs')
            bind = receipt['binding']
            same(bind['product'], product, 'running product differs')
            for field, expected in (('original_harness_sha256', b.digest(original)), ('instrumented_harness_sha256', b.digest(patched)),
                                    ('instrument_sha256', package['producer']['compose_deadline_775.mjs']['sha256']),
                                    ('supervisor_sha256', package['producer']['compose_worker_775.mjs']['sha256']),
                                    ('wrapper_sha256', package['producer']['run_compose_group.py']['sha256'])):
                same(bind[field], expected, 'running instrument/source differs')
            claims = ce.source_hashes(report)
            b.require(set(actual['hashes']) <= set(claims), 'grouped running source input hashes absent')
            for path, digest in claims.items():
                data = patched if path == HARNESS else ce.git_bytes(git, head, path)
                b.require(b.digest(data) == digest, 'grouped running source hash differs')
            scope = report.get('scope775') or {}
            same(report.get('originalPlannedPhases'), list(dict.fromkeys(r['phase'] + ':' + r['engine'] for r in actual['rows'])), 'original planned phase inventory differs')
            phase = group['phase'] + ':' + group['engine'] + '/group:' + gid
            b.require(report.get('harnessCompleted') is False and scope.get('originalWholeCompleted') is False
                      and scope.get('groupCompleted') is True and report.get('plannedPhases') == [phase]
                      and report.get('completedPhases') == [phase] and scope.get('group') == gid
                      and scope.get('source') == product and scope.get('cases_sha256') == group['cases_sha256'], 'grouped phase completion differs')
            runtime = bind.get('actual_runtime') or {}
            same(scope.get('origins'), cert['origins'], 'native fixture origin differs')
            same(runtime.get('fixture_origins'), cert['origins'], 'runtime fixture origin differs')
            same(runtime.get('source_checkout'), cert['checkout'], 'runtime source checkout differs')
            engines = runtime.get('browser_engines')
            b.require(isinstance(engines, list) and len(engines) == 1 and engines[0].get('engine') == group['engine']
                      and bool(engines[0].get('version')) and scope.get('runtime') == engines, 'grouped own engine unattested')
            rows = report.get('results')
            b.require(scope.get('completedCases') == [r['name'] for r in group['cases']], 'grouped completed source cases differ')
            b.require(isinstance(rows, list) and [r.get('name') for r in rows] == [r['name'] for r in group['cases']]
                      and all(type(r.get('passed')) is bool for r in rows), 'grouped raw case inventory differs')
            normalized = []
            for raw_row, expected in zip(rows, group['cases']):
                b.require(all(raw_row.get(k, expected[k]) == expected[k] for k in ('phase', 'engine')), 'grouped raw phase/engine differs')
                normalized.append(dict(raw_row, phase=expected['phase'], engine=expected['engine']))
            same(receipt['results'], normalized, 'receipt/raw body differs')
            same(receipt.get('planned_cases'), group['cases'], 'receipt planned cases differ')
            b.require(receipt.get('group') == gid and receipt.get('source') == product
                      and receipt.get('cases_sha256') == group['cases_sha256'], 'grouped receipt identity differs')
            b.require(report.get('browserClosed') is True and type(report.get('fixtureExitCode')) is int and report['fixtureExitCode'] == 0
                      and 'fixtureExitSignal' in report and report['fixtureExitSignal'] is None and not report.get('fixtureErrors')
                      and type(report.get('shortFixture', {}).get('exitCode')) is int and report['shortFixture']['exitCode'] == 0
                      and 'exitSignal' in report['shortFixture'] and report['shortFixture']['exitSignal'] is None
                      and not report['shortFixture'].get('errors') and not report.get('teardown')
                      and not report.get('instrumentError') and not report.get('pageErrors') and not report.get('left')
                      and receipt.get('complete') is True and receipt.get('cleanup') is True and not receipt.get('terminal'), 'grouped cleanup/unretired refusal')
            b.require(all(not r.get('expectedFailure') or r.get('mutationCaught') is True for r in normalized), 'grouped escaped mutation')
            b.require(all(r.get('passed') is True or isinstance(r.get('error'), str) and bool(r['error'].strip()) for r in normalized),
                      'grouped false row missing failure body')
            b.require(type(receipt.get('exit')) is int and receipt['exit'] == (0 if all(r['passed'] for r in normalized) else 1)
                      and receipt.get('passed') is (receipt['exit'] == 0 and all(r['passed'] for r in normalized)), 'grouped producer verdict differs')
            log = read('native-compose.log').decode()
            totals = re.findall(r'^(\d+) passed, (\d+) failed$', log, re.M)
            b.require(bool(totals) and tuple(map(int, totals[-1])) ==
                      (sum(r['passed'] for r in normalized), sum(not r['passed'] for r in normalized)), 'grouped raw log/count differs')
            receipts.append(receipt)
            all_false.extend({'origin': gid, 'row': r} for r in normalized if r['passed'] is False)
    b.require(seen == set(planned), 'grouped missing actual group receipts')
    # Exact unchanged 775 collector, with retained phases kept separately.
    collected = collector.collect({'groups': groups}, receipts)
    same(b.document(packet['collector']), collected, 'genuine 775 collector result differs')
    b.require(collected['complete'] is True, 'grouped incomplete collector')
    dispositions = b.document(packet['dispositions'])
    same(dispositions['false_rows'], all_false, 'original/group false rows or origins differ')
    b.require(isinstance(dispositions.get('records'), list) and len(dispositions['records']) == len(all_false), 'grouped missing independent red dispositions')
    for observed, record in zip(all_false, dispositions['records']):
        prior = b.document(record)
        b.require(prior.get('reviewer') == 'auditor' and prior.get('record') not in (judgment['audit'], auth['record'], patch_review['record']), 'grouped existing audit disposition missing')
        b.words(prior.get('record')); b.words(prior.get('ground'))
        same(prior['observed'], observed, 'red disposition body/origin differs')
        category = prior.get('category')
        b.require(category in ('expected-mutant', 'independently-placed-red'), 'grouped unsupported disposition')
        if category == 'expected-mutant':
            b.require(observed['row'].get('expectedFailure') is True and observed['row'].get('mutationCaught') is True, 'grouped forged expected mutant')
    return {'kind': 'authenticated-compose-union-779', 'complete': True,
            'passed': not all_false and collected['passed'], 'originals': originals,
            'retained_results': retained_results, 'replay_overlap': [r for r in originals if r not in retained_results],
            'raw_false': all_false, 'original_cleanup': qualifications, 'collector': collected,
            'review': packet['review'], 'evidence': ref, 'mode': mode, 'admitted': False}


def record(proof):
    # Bound storage record; the referenced packet retains every raw byte.
    return {k: proof[k] for k in ('kind', 'complete', 'passed', 'evidence', 'review', 'mode', 'admitted')} | {
        'original_rows': len(proof['originals']), 'retained_cases': len(proof['retained_results']),
        'replay_overlap': len(proof['replay_overlap']), 'raw_false_count': len(proof['raw_false']),
        'raw_false_sha256': b.digest(b.canonical(proof['raw_false'])),
        'collector_sha256': b.digest(b.canonical(proof['collector'])),
        'original_cleanup': proof['original_cleanup']}

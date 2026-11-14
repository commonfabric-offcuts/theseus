from __future__ import annotations

"""Classify complete CI evidence using policy from the event's exact base commit.

This tool never changes a raw verdict. See docs/ci-known-reds.md for the trust
boundary and admission contract. No third-party modules or candidate code run.
"""

import argparse
from collections import Counter
from functools import lru_cache
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import sys

# An absolute, script-relative import: the candidate working directory is not
# on sys.path, including when invoked with python3 -I.
ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from tools import known_reds, release_check

NATIVE = known_reds.NATIVE
PHASES = [phase + ':' + engine for phase in ('run', 'runAnswering', 'runSending')
          for engine in ('chromium', 'webkit')]
FRAME = re.compile(r'^\s*at (?:async )?(?:[^\s(]+ \()?(?:file://)?(\S*?/tests/[^\s():]+):(\d+):\d+\)?\s*$')
GENERATED_ID = re.compile(r'(?<![0-9A-Za-z])([mtpd])-[0-9a-f]{32}(?![0-9A-Za-z])')
SHA = re.compile(r'[0-9a-f]{40}')
DIGEST = re.compile(r'[0-9a-f]{64}')
PROFILE_FIELDS = ('runner_os', 'runner_arch', 'image_os', 'image_version', 'scroll_bars',
                  'reduce_motion', 'cpus', 'python', 'node', 'chrome', 'playwright')
UNITS = ('python-units', 'node-units', 'deploy-refusals')
PRODUCER_WORKFLOW = '.github/workflows/checks.yml'


class Refused(Exception):
    pass


def require(condition, message):
    if not condition:
        raise Refused(message)


def read_json(path):
    try:
        return json.loads(Path(path).read_text())
    except (OSError, ValueError) as error:
        raise Refused('unreadable JSON %s: %s' % (path, error))


def git(root, *args):
    answer = subprocess.run(['git', '-C', str(root)] + list(args), capture_output=True)
    require(answer.returncode == 0, 'cannot read verified source: git %s' % ' '.join(args))
    return answer.stdout


@lru_cache(maxsize=4096)
def source(root, commit, path):
    require(isinstance(commit, str) and SHA.fullmatch(commit), 'invalid source commit')
    require(isinstance(path, str) and path.startswith(('tests/', 'tools/', '.github/'))
            and '..' not in Path(path).parts, 'invalid source path')
    return git(root, 'show', commit + ':' + path)


def blob(data):
    return hashlib.sha1(b'blob ' + str(len(data)).encode() + b'\0' + data).hexdigest()


def clean_checkout(root, commit, tree=None):
    require(git(root, 'rev-parse', 'HEAD').decode().strip() == commit, 'wrong checkout commit')
    require(not git(root, 'status', '--porcelain', '--untracked-files=all').strip(), 'dirty source checkout')
    actual = git(root, 'rev-parse', 'HEAD^{tree}').decode().strip()
    require(tree is None or actual == tree, 'wrong checkout tree')
    return actual


def unique(values, what):
    require(isinstance(values, list), what + ' is not a list')
    require(len(values) == len(set(values)), 'duplicate ' + what)
    return set(values)


def identity(row):
    require(isinstance(row, dict) and isinstance(row.get('name'), str) and row['name'], 'unnamed case')
    return {'name': row['name'], 'phase': row.get('phase'), 'engine': row.get('engine'),
            'expectedFailure': row.get('expectedFailure', False)}


def key(row):
    return json.dumps(identity(row), sort_keys=True, separators=(',', ':'))


def normalize(values, checkout):
    require(isinstance(checkout, str) and checkout.startswith('/'), 'no verified checkout root')
    values = values.replace(checkout.rstrip('/') + '/', 'WT/')
    labels = {}
    return GENERATED_ID.sub(lambda m: '%s-ID%d' % (m[1], labels.setdefault(m[0], len(labels) + 1)), values)


def fingerprint(error, checkout, root, commit):
    require(isinstance(error, str) and error.strip(), 'missing assertion evidence')
    lines, chain, values = error.splitlines(), [], []
    for line in lines:
        if re.match(r'^\s+at \S', line):
            break
        values.append(line)
    for line in lines:
        match = FRAME.match(line)
        if not match:
            continue
        absolute, number = match[1], int(match[2])
        require(absolute.startswith(checkout.rstrip('/') + '/'), 'stack frame outside verified checkout')
        path = absolute[len(checkout.rstrip('/')) + 1:]
        text = source(root, commit, path).decode().splitlines()
        require(0 < number <= len(text), 'stack line absent from verified source')
        statement = text[number - 1].strip()
        require(bool(statement), 'empty source frame')
        occurrences = [n for n, item in enumerate(text, 1) if item.strip() == statement]
        chain.append({'path': path, 'text': statement, 'count': len(occurrences), 'index': occurrences.index(number)})
    require(bool(chain), 'no verified test source frames')
    # Keep every test frame, including runner/helper/call-site frames. Comparing
    # only the first throw would turn two unrelated timeout cases into one.
    return {'chain': chain, 'values': normalize('\n'.join(values).rstrip(), checkout)}


def compose_completed(report):
    return (report.get('browserClosed') is True and report.get('harnessCompleted') is True
            and type(report.get('fixtureExitCode')) is int and report['fixtureExitCode'] == 0
            and 'fixtureExitSignal' in report and report['fixtureExitSignal'] is None
            and report.get('plannedPhases') == PHASES and report.get('completedPhases') == PHASES)


def cases(step, out, expected):
    name = step['name']
    native = NATIVE[name]
    report = read_json(out / 'native' / native.name / native.results)
    rows = report.get('results')
    require(isinstance(rows, list) and bool(rows), name + ': missing case results')
    require(all(isinstance(r, dict) and type(r.get('passed')) is bool for r in rows), name + ': invalid result')
    actual = [key(r) for r in rows]
    require(len(actual) == len(set(actual)), name + ': duplicate case identity')
    require(set(actual) == {key(r) for r in expected}, name + ': case inventory differs from reviewed plan')
    counts, good = release_check.native_counts(native, out / 'native' / native.name)
    require(step.get('counts') == counts, name + ': summary counts disagree with report')
    require(counts['browser_closed'] is True, name + ': browser cleanup failed')
    log = (out / (name + '.log')).read_text()
    if native.harness == release_check.COMPOSE:
        require(compose_completed(report), name + ': phases or fixture cleanup unattested')
    elif native.results == 'results.json':
        final = known_reds._final_json(log)
        require(isinstance(final, dict) and final.get('closed') is True and final.get('results') == rows,
                name + ': missing final result log')
    else:
        require(type(report.get('fixtureExitCode')) is int and report['fixtureExitCode'] == 0,
                name + ': fixture cleanup failed')
        require(report.get('fixtureExitSignal') is None, name + ': fixture was signalled')
        if counts['fail']:
            require(known_reds.END_LINE in log.splitlines(), name + ': harness did not reach end')
    require(type(step.get('exit')) is int and step['exit'] == (0 if good else 1), name + ': abnormal harness exit')
    require(step.get('passed') is good, name + ': inconsistent raw verdict')
    for row in rows:
        if row.get('expectedFailure'):
            require(row.get('mutationCaught') is True, name + ': escaped mutation')
    return rows


def profile_identity(profile):
    require(isinstance(profile, dict) and bool(profile), 'missing execution profile')
    # Load samples and paths remain evidence, never an admission key. Require
    # every stable setting so an incomplete old receipt cannot match by omission.
    require(all(k in profile and profile[k] is not None and profile[k] != '' for k in PROFILE_FIELDS),
            'incomplete stable execution profile')
    return {k: profile[k] for k in PROFILE_FIELDS}


def definition_bytes(data, path):
    """Only leading blank/line-comment additions are a harmless line shift.

    Do not strip comments inside arbitrary JS: a template literal or regular
    expression can contain comment-looking text that changes the assertion.
    Everything after the first code line remains byte-for-byte reviewed.
    """
    if not path.startswith('tests/') or not path.endswith(('.mjs', '.py')) or data.startswith(b'\xef\xbb\xbf'):
        return data
    marker = b'//' if path.endswith('.mjs') else b'#'
    lines = data.splitlines(keepends=True)
    for line in lines:
        if not line.strip() or line.lstrip().startswith(marker):
            # Preserve interpreter/encoding directives, including an inactive
            # cookie that a shifted header could move into the first two lines.
            if line.lstrip().startswith(b'#!') or (path.endswith('.py') and re.match(br'^[ \t\f]*#.*?coding[:=][ \t]*[-\w.]+', line)):
                return data
        else:
            break
    while lines and (not lines[0].strip() or lines[0].lstrip().startswith(marker)):
        lines.pop(0)
    return b''.join(lines)


def reviewed_definitions(policy, root, commit, approved_base=None, retired_sources=()):
    planned, actual = definition_paths(root, policy['source_commit']), definition_paths(root, commit)
    require(planned == actual, 'reviewed test definition changed: source set is not a complete matching plan')
    if approved_base is not None:
        require(definition_paths(root, approved_base) - planned == set(retired_sources),
                'reviewed test definition changed: base source retirements differ from reviewed transition')
    for path in policy['source_hashes']:
        reviewed = source(root, policy['source_commit'], path)
        candidate = source(root, commit, path)
        require(definition_bytes(reviewed, path) == definition_bytes(candidate, path),
                'reviewed test definition changed: ' + path)


@lru_cache(maxsize=4096)
def definition_paths(root, commit):
    tests = git(root, 'ls-tree', '-r', '--name-only', commit, 'tests').decode().splitlines()
    tools = git(root, 'ls-tree', '-r', '--name-only', commit, 'tools').decode().splitlines()
    return frozenset({path for path in tests if path.endswith(('.mjs', '.py'))} | set(tools) | {PRODUCER_WORKFLOW})


def select_plan(policy, root, commit, approved_base=None):
    base = {k: v for k, v in policy.items() if k != 'transitions'}
    plans = [(base, None, [])] + [(row['plan'], row['review'], row.get('retired_sources', []))
                                for row in policy.get('transitions', [])]
    matched = []
    for plan, review, retired in plans:
        try:
            reviewed_definitions(plan, root, commit, approved_base, retired_sources=retired)
        except Refused:
            continue
        matched.append((plan, review))
    require(bool(matched), 'reviewed test definition changed: no complete matching plan')
    require(len(matched) == 1, 'ambiguous reviewed plans; do not combine source definitions')
    return matched[0]


def replay_evidence(step, out, traffic):
    routed = unique(traffic.get('routed'), 'reviewed routed actors')
    require(bool(routed), 'wake-replay: empty reviewed routed actor inventory')
    runs = step.get('runs')
    require(isinstance(runs, list) and bool(runs), 'wake-replay: missing runs')
    replay_runs = []
    for number, run in enumerate(runs, 1):
        counts, good = release_check.replay_counts(out / 'replay' / ('candidate-%d' % number))
        require(good and run.get('passed') is True and type(run.get('exit')) is int and run['exit'] == 0,
                'wake-replay: incomplete replay')
        require(set(counts) == routed, 'wake-replay: routed actor inventory differs')
        for agent in counts.values():
            require(isinstance(agent, dict) and type(agent.get('lost')) is list, 'wake-replay: missing explicit loss record')
            require(agent['lost'] == [] and type(agent.get('wakes')) is int and agent['wakes'] > 0
                    and len(agent.get('delays') or []) == agent['wakes'], 'wake-replay: lost or missing wakes')
        log = out / ('wake-replay-candidate-%d.log' % number)
        require(log.is_file() and bool(log.read_text().strip()), 'wake-replay: missing log')
        replay_runs.append(dict(run, counts=counts))
    recalculated = release_check.replay_step(replay_runs, step.get('started_at'))
    require(step.get('counts') == recalculated['counts'] and step.get('series') == recalculated['series'],
            'wake-replay: counts or series differ from evidence')


def unit_records(text, node=False):
    """Executed check identities and outcomes from verbose unittest or Node TAP.

    TAP includes nested checks: a child's identity includes its named parents,
    not its runner-assigned number. No test code is imported to discover a plan.
    """
    rows, pending, parents = [], None, {}
    for line in text.splitlines():
        if node:
            start = re.match(r'^( *)# Subtest: (.+)$', line)
            if start:
                indent = len(start[1])
                parents = {n: name for n, name in parents.items() if n < indent}
                parents[indent] = start[2]
                continue
            done = re.match(r'^( *)(ok|not ok) \d+ - (.+)$', line)
            if not done:
                continue
            indent, status, name = len(done[1]), done[2], done[3]
            directive = re.search(r'\s+#\s+(SKIP|TODO)(?:\s.*)?$', name, re.I)
            if directive:
                name, status = name[:directive.start()], directive[1].lower()
            require(parents.get(indent) == name, 'node-units: missing or mismatched Subtest identity')
            ancestry = [parents[n] for n in sorted(parents) if n < indent]
            rows.append(({'name': name, 'phase': json.dumps(ancestry) if ancestry else None}, status))
            parents = {n: value for n, value in parents.items() if n < indent}
        else:
            head = re.match(r'^(\S+ \([^)]+\))(?:\s+\.\.\.\s*(.*))?$', line)
            rest = line.strip()
            if head:
                require(pending is None, 'python-units: check outcome missing')
                pending, rest = head[1], head[2] or ''
            # unittest writes its result on stderr; a test's stdout may end
            # without a newline, leaving e.g. a JSON object immediately }ok.
            status = re.search(r'(?:^|[^A-Za-z0-9_])(ok|skipped .+|expected failure|unexpected success|FAIL|ERROR)$', rest)
            if pending and status:
                rows.append(({'name': pending}, status[1]))
                pending = None
    require(pending is None, 'python-units: final check outcome missing')
    return rows


def unit_evidence(step, out, expected):
    name = step['name']
    text = (out / (name + '.log')).read_text()
    counts, good = release_check.node_counts(text) if name == 'node-units' else release_check.python_counts(text)
    require(good and step.get('counts') == counts, 'non-browser log/count mismatch')
    require(not any(counts.get(k, 0) for k in ('skipped', 'todo', 'cancelled', 'expected failures', 'unexpected successes')),
            name + ': unapproved skipped, todo or incomplete checks')
    if name == 'node-units':
        require(counts.get('pass', 0) == counts['tests'] > 0, name + ': not every planned check passed')
    rows = unit_records(text, node=name == 'node-units')
    require(len(rows) == counts['tests'] and all(status == 'ok' for _, status in rows),
            name + ': unapproved skipped/todo or missing individual check outcomes')
    actual, plan = Counter(key(row) for row, _ in rows), Counter(key(row) for row in expected)
    require(all(actual[k] == count for k, count in plan.items())
            and all(count == plan.get(k, 1) for k, count in actual.items()),
            name + ': reviewed check inventory omitted or duplicated')


def load_policy(policy, base_root):
    require(isinstance(policy, dict) and policy.get('version') == 1, 'unsupported baseline schema')
    fields = {'version', 'source_commit', 'source_hashes', 'required', 'inventory', 'reds'}
    require(fields <= set(policy) <= fields | {'transitions'},
            'invalid baseline fields')
    require(unique(policy['required'], 'policy required steps') == set(release_check.REQUIRED), 'incomplete reviewed steps')
    require(set(policy['inventory']) == set(NATIVE) | set(UNITS), 'incomplete reviewed check inventory')
    for name, rows in policy['inventory'].items():
        require(isinstance(rows, list) and bool(rows), name + ': empty reviewed inventory')
        require(len({key(r) for r in rows}) == len(rows), name + ': duplicate reviewed identity')
    require(isinstance(policy['source_hashes'], dict) and bool(policy['source_hashes']), 'missing inventory source hashes')
    for path, digest in policy['source_hashes'].items():
        require(blob(source(base_root, policy['source_commit'], path)) == digest, 'inventory source hash differs: ' + path)
    require({s.harness for s in NATIVE.values()} <= set(policy['source_hashes']), 'inventory omits harness sources')
    require(definition_paths(base_root, policy['source_commit']) <= set(policy['source_hashes']),
            'reviewed source set omits test or producer definitions')
    require(isinstance(policy['reds'], list), 'invalid admissions')
    seen = set()
    for red in policy['reds']:
        fields = {'step', 'case', 'owner', 'why', 'review', 'observed_profile', 'target_profile',
                  'source_commit', 'evidence_sha256', 'fingerprint', 'completion'}
        require(isinstance(red, dict) and fields <= set(red) <= fields | {'runner_evidence_sha256'}, 'invalid admission fields')
        require(red['step'] in NATIVE, 'non-browser exception forbidden')
        pair = (red['step'], key(red['case']))
        require(pair not in seen, 'duplicate admission')
        seen.add(pair)
        require(pair[1] in {key(r) for r in policy['inventory'][red['step']]}, 'admitted case absent from inventory')
        require(not red['case'].get('expectedFailure'), 'mutations cannot be excepted')
        for field in ('owner', 'why', 'review'):
            require(isinstance(red[field], str) and bool(red[field].strip()), 'missing admission ' + field)
        require(isinstance(red['evidence_sha256'], str) and DIGEST.fullmatch(red['evidence_sha256']), 'missing evidence digest')
        observed, target = profile_identity(red['observed_profile']), profile_identity(red['target_profile'])
        if observed != target:
            require(isinstance(red.get('runner_evidence_sha256'), str)
                    and DIGEST.fullmatch(red['runner_evidence_sha256']), 'cross-profile admission lacks reviewed runner evidence')
        require(isinstance(red['source_commit'], str) and SHA.fullmatch(red['source_commit']), 'missing admission source')
        fp = red['fingerprint']
        require(isinstance(fp, dict) and set(fp) == {'chain', 'values'} and bool(fp['chain'])
                and isinstance(fp['values'], str) and bool(fp['values']), 'invalid admission fingerprint')
        for frame in fp['chain']:
            text = source(base_root, red['source_commit'], frame['path']).decode().splitlines()
            matches = [line.strip() for line in text].count(frame['text'])
            require(matches == frame['count'] and 0 <= frame['index'] < matches, 'unverified admission source frame')
        if NATIVE[red['step']].harness == release_check.COMPOSE:
            require(compose_completed(red['completion']), 'baseline Compose completion unattested')
        else:
            require(red['completion'] == {'browserClosed': True, 'fixtureExitCode': 0, 'ended': True},
                    'baseline completion unattested')
    transitions = policy.get('transitions', [])
    require(isinstance(transitions, list), 'invalid reviewed plan transitions')
    for row in transitions:
        require(isinstance(row, dict) and {'review', 'plan'} <= set(row) <= {'review', 'plan', 'retired_sources'}
                and isinstance(row['review'], str) and bool(row['review'].strip()), 'transition needs its separate review')
        retired = row.get('retired_sources', [])
        require(isinstance(retired, list) and all(isinstance(path, str) and bool(path) for path in retired)
                and len(set(retired)) == len(retired), 'invalid reviewed source retirements')
        require(isinstance(row['plan'], dict) and 'transitions' not in row['plan'], 'nested plan transitions forbidden')
        load_policy(row['plan'], base_root)
        approved = {json.dumps(red, sort_keys=True) for red in policy['reds']}
        require({json.dumps(red, sort_keys=True) for red in row['plan']['reds']} <= approved,
                'plan transition cannot add or change failure admissions')
    return policy


def classify(policy, observed, root, commit):
    """Only call after complete coverage, source, raw counts and cleanup checks."""
    expected = {(r['step'], key(r['case'])): r for r in policy['reds']}
    result = {'passed': True, 'expected': [], 'healed': [], 'unexpected': []}
    seen = set()
    for step, rows, profile, checkout in observed:
        for row in rows:
            pair = (step, key(row))
            seen.add(pair)
            red = expected.get(pair)
            item = {'step': step, 'case': identity(row), 'raw_passed': row['passed']}
            if row['passed'] or (row.get('expectedFailure') and row.get('mutationCaught') is True):
                if red:
                    # Passing a materially edited test is not proof the original
                    # failed case healed. Its reviewed harness must still apply.
                    harness = NATIVE[step].harness
                    require(definition_bytes(source(root, commit, harness), harness) ==
                            definition_bytes(source(root, policy['source_commit'], harness), harness),
                            'healed case has changed harness; review inventory first')
                    for path in {frame['path'] for frame in red['fingerprint']['chain']}:
                        require(definition_bytes(source(root, commit, path), path) ==
                                definition_bytes(source(root, red['source_commit'], path), path),
                                'healed case has changed helper/assertion source; review first')
                    result['healed'].append(item)
                continue
            reason = 'unlisted failure'
            if red:
                if profile_identity(profile) != profile_identity(red['target_profile']):
                    reason = 'unreviewed runner profile'
                else:
                    try:
                        match = fingerprint(row.get('error'), checkout, root, commit) == red['fingerprint']
                    except Refused:
                        match = False
                    if match:
                        item.update(owner=red['owner'], review=red['review'], evidence_sha256=red['evidence_sha256'])
                        result['expected'].append(item)
                        continue
                    reason = 'different assertion, values or source chain'
            item['reason'] = reason
            result['unexpected'].append(item)
    require(set(expected) <= seen, 'expected case disappeared')
    result['passed'] = not result['unexpected']
    return result


def event_binding(environ):
    event = read_json(environ.get('GITHUB_EVENT_PATH', ''))
    require(environ.get('GITHUB_EVENT_NAME') == 'pull_request', 'validator requires pull_request event')
    pr = event.get('pull_request') or {}
    base = pr.get('base') or {}
    require(isinstance(base.get('sha'), str) and SHA.fullmatch(base['sha']), 'no exact PR event base SHA')
    run = {'id': int(environ['GITHUB_RUN_ID']), 'attempt': int(environ['GITHUB_RUN_ATTEMPT']),
           'workflow': environ['GITHUB_WORKFLOW'], 'event': environ['GITHUB_EVENT_NAME'],
           'repository': environ['GITHUB_REPOSITORY']}
    merge_sha = environ['GITHUB_SHA']
    require(SHA.fullmatch(merge_sha), 'invalid tested merge SHA')
    return run, {'ref': base['ref'], 'sha': base['sha']}, merge_sha


def producer_binding(path, environ):
    """Bind protected API evidence to the workflow_run event, never to artifacts.

    The protected controller authenticates the API record and independently
    rebuilds its expected merge tree. This consumer verifies that exact record
    against the current controller context and all original producer evidence.
    """
    record = read_json(path)
    event = read_json(environ.get('GITHUB_EVENT_PATH', ''))
    require(environ.get('GITHUB_EVENT_NAME') == 'workflow_run' and event.get('action') == 'completed',
            '--producer requires a protected completed workflow_run controller')
    controller = record['controller']
    expected = {'run_id': environ['GITHUB_RUN_ID'], 'run_attempt': environ['GITHUB_RUN_ATTEMPT'],
                'workflow_sha': environ['GITHUB_WORKFLOW_SHA'], 'workflow_ref': environ['GITHUB_WORKFLOW_REF'],
                'sha': environ['GITHUB_SHA'], 'repository': environ['GITHUB_REPOSITORY']}
    require(all(str(controller.get(k)) == str(value) for k, value in expected.items()), 'wrong protected controller identity')
    repository = expected['repository']
    default = event['repository']['default_branch']
    require(controller['workflow_ref'].startswith(repository + '/.github/workflows/')
            and controller['workflow_ref'].endswith('@refs/heads/' + default), 'controller workflow is not on the default branch')
    for field in ('workflow_sha', 'sha'):
        require(isinstance(controller[field], str) and SHA.fullmatch(controller[field]), 'invalid controller source identity')
    producer, pr, observed = record['producer'], record['producer']['pull_request'], event['workflow_run']
    require(str(producer['run_id']) == str(observed['id'])
            and str(producer['run_attempt']) == str(observed['run_attempt']), 'producer is not the triggering run/attempt')
    require(int(producer['run_attempt']) == 1, 'protected controller refuses producer retries; request a fresh producer run')
    require(producer['event'] == observed['event'] == 'pull_request', 'producer event is not pull_request')
    require(producer['workflow_path'] == PRODUCER_WORKFLOW and producer['workflow_name'] == observed['name'],
            'unexpected producer workflow identity')
    if observed.get('path') is not None:
        require(observed['path'] == producer['workflow_path'], 'producer workflow path differs from trigger')
    require(producer['created_at'] == observed['created_at'] and producer['head_branch'] == observed['head_branch'],
            'producer run metadata differs from trigger')
    require(producer['head_sha'] == observed['head_sha'] == pr['head_sha'], 'producer PR head differs from API event')
    prs = [row for row in observed.get('pull_requests', []) if row.get('number') == pr['number']]
    require(len(prs) == 1 and prs[0]['head']['sha'] == pr['head_sha'] and prs[0]['base']['sha'] == pr['base_sha'],
            'producer PR base/head is not authenticated by controller event')
    require(producer['conclusion'] == observed['conclusion'] and producer['conclusion'] in ('success', 'failure'),
            'producer is cancelled, incomplete or has an unauthenticated conclusion')
    merge = record['merge']
    for value in (pr['head_sha'], pr['base_sha'], merge['sha'], merge['tree'], merge['first_parent'], merge['second_parent']):
        require(isinstance(value, str) and SHA.fullmatch(value), 'invalid producer source identity')
    require(merge['first_parent'] == pr['base_sha'] and merge['second_parent'] == pr['head_sha'],
            'merge parents differ from original API base/head; request a fresh producer run')
    require(merge.get('fetched') == merge['sha'] and merge.get('rebuilt') == merge['tree'],
            'producer merge lacks authenticated fetch/rebuilt-tree evidence')
    run = {'id': int(producer['run_id']), 'attempt': int(producer['run_attempt']),
           'workflow': producer['workflow_name'], 'event': producer['event'], 'repository': repository}
    return run, {'ref': pr['base_ref'], 'sha': pr['base_sha']}, merge['sha'], record


def producer_workflow(receipt, record, policy, root):
    data = receipt.get('run') or {}
    sha = data.get('workflow_sha', receipt.get('workflow_sha'))
    ref = data.get('workflow_ref', receipt.get('workflow_ref'))
    require(sha in (record['merge']['sha'], record['producer']['head_sha']), 'unbound producer workflow commit')
    expected_ref = '%s/%s@refs/pull/%s/merge' % (record['controller']['repository'], PRODUCER_WORKFLOW,
                                               record['producer']['pull_request']['number'])
    require(ref == expected_ref, 'unbound producer workflow reference')
    require(source(root, sha, PRODUCER_WORKFLOW) == source(root, policy['source_commit'], PRODUCER_WORKFLOW),
            'producer workflow blob differs from separately reviewed plan')


def same_run(actual, expected):
    require(isinstance(actual, dict), 'missing producer run receipt')
    require(all(str(actual.get(k)) == str(v) for k, v in expected.items()), 'wrong producer run or attempt')


def plan_steps(plan):
    require(isinstance(plan, list) and bool(plan), 'missing shard plan')
    result = []
    for shard in plan:
        steps = shard['steps']
        result.append(steps.split(',') if isinstance(steps, str) else steps)
    return result


def _validate_attempt(summary_path, provenance_path, shards, baseline, base_root, candidate_root, environ=None, producer=None):
    environ = os.environ if environ is None else environ
    binding = None
    if producer is None:
        run, base, commit = event_binding(environ)
    else:
        run, base, commit, binding = producer_binding(producer, environ)
    tree = clean_checkout(candidate_root, commit)
    expected_merge = {'sha': commit, 'tree': tree}
    if binding is not None:
        require(tree == binding['merge']['tree'], 'candidate tree differs from independently rebuilt producer tree')
        parents = git(candidate_root, 'rev-list', '--parents', '-n', '1', commit).decode().split()[1:]
        require(parents == [binding['merge']['first_parent'], binding['merge']['second_parent']], 'candidate is not the original producer merge')
        expected_merge.update(first_parent=parents[0], second_parent=parents[1])
    clean_checkout(base_root, base['sha'])
    baseline = Path(baseline).resolve()
    relative = str(baseline.relative_to(Path(base_root).resolve()))
    require(baseline.read_bytes() == source(base_root, base['sha'], relative), 'policy differs from event base')
    for path in ('tools/ci_known_reds.py', 'tools/known_reds.py', 'tools/release_check.py'):
        require((ROOT / path).read_bytes() == source(base_root, base['sha'], path), 'validator differs from event base: ' + path)
    known = load_policy(read_json(baseline), base_root)
    policy, transition_review = select_plan(known, candidate_root, commit, base['sha'])
    traffic_bytes = source(base_root, policy['source_commit'], release_check.REPLAY_FILE)
    require(source(candidate_root, commit, release_check.REPLAY_FILE) == traffic_bytes,
            'reviewed replay traffic changed')
    traffic = json.loads(traffic_bytes)
    provenance, summary = read_json(provenance_path), read_json(summary_path)
    if binding is None and isinstance(provenance.get('merge'), dict) and 'first_parent' in provenance['merge']:
        parents = git(candidate_root, 'rev-list', '--parents', '-n', '1', commit).decode().split()[1:]
        require(len(parents) == 2, 'producer merge needs two authenticated parents')
        expected_merge.update(first_parent=parents[0], second_parent=parents[1])
    same_run(provenance.get('run'), run)
    require(provenance.get('base') == base, 'wrong event base policy')
    require(provenance.get('merge') == expected_merge, 'wrong tested merge or tree')
    if binding is not None:
        require(provenance.get('head') == {'ref': binding['producer']['head_branch'], 'sha': binding['producer']['head_sha']},
                'combined head differs from authenticated producer')
    require(provenance.get('checked') == {'commit': commit, 'tree_unchanged': True}, 'dirty combined source')
    require(unique(provenance['required'], 'provenance steps') == set(policy['required']), 'incomplete provenance')
    require(summary.get('tool') == release_check.TOOL and summary.get('commit') == commit, 'wrong combined source')
    require(summary.get('tree_unchanged') is True and summary.get('tree_after') == {'head': commit, 'changes': ''}, 'dirty combined source')
    require('only' not in summary and not summary.get('skipped'), 'focused or skipped aggregate')
    require(unique(summary['required'], 'summary required steps') == set(policy['required']), 'incomplete summary plan')
    combined = summary['steps']
    require(unique([s['name'] for s in combined], 'combined steps') == set(policy['required']), 'missing required step')
    by_name = {s['name']: s for s in combined}
    plan = plan_steps(provenance['plan'])
    require(Counter(s for shard in plan for s in shard) == Counter(policy['required']), 'incomplete or duplicated shard plan')
    entries = provenance['shards']
    require(len(entries) == len(plan), 'missing shard provenance')
    artifacts = [s['artifact'] for s in entries]
    require(unique(artifacts, 'shard artifacts') == {'check-%d' % i for i in range(len(plan))}, 'unexpected artifact set')
    require(unique(summary.get('combined_from'), 'combined artifact summaries') ==
            {name + '/summary.json' for name in artifacts}, 'combined artifact inventory differs')
    require({p.name for p in Path(shards).iterdir()} == set(artifacts), 'missing or extra downloaded shard')
    observed, ran = [], []
    for entry in entries:
        artifact = entry['artifact']
        out = Path(shards) / artifact
        receipt, raw = read_json(out / 'run.json'), read_json(out / 'summary.json')
        require(not entry.get('refused') and entry.get('receipt') == receipt, 'missing or inconsistent producer receipt')
        same_run(receipt.get('run'), run)
        if binding is not None:
            require(receipt.get('head') == provenance['head'], 'shard head differs from authenticated producer')
            producer_workflow(receipt, binding, policy, candidate_root)
        require(receipt.get('base') == base and receipt.get('merge') == expected_merge, 'stale shard source or base')
        require(receipt.get('summary_sha256') == hashlib.sha256((out / 'summary.json').read_bytes()).hexdigest(),
                'original summary digest differs from producer receipt')
        require(raw.get('tool') == release_check.TOOL and raw.get('commit') == commit
                and raw.get('tree_unchanged') is True and raw.get('tree_after') == {'head': commit, 'changes': ''}, 'dirty or wrong shard source')
        index = int(artifact.split('-')[-1])
        steps = raw['steps']
        names = [s['name'] for s in steps]
        require(Counter(names) == Counter(plan[index]), 'shard does not cover its assigned steps')
        require(raw.get('only') == names and not raw.get('skipped'), 'invalid shard focus receipt')
        receipt_steps = receipt['shard']['steps']
        require((receipt_steps.split(',') if isinstance(receipt_steps, str) else receipt_steps) == plan[index], 'wrong producer shard assignment')
        require(entry.get('commit') == commit and entry.get('tree_unchanged') is True
                and entry.get('tools') == raw.get('tools') and entry.get('steps') == names, 'combined shard provenance differs')
        tools = raw['tools']
        require(blob(source(candidate_root, commit, 'tools/release_check.py')) == tools['release_check'], 'wrong release-check tool hash')
        for path in release_check.harnesses():
            require(blob(source(candidate_root, commit, path)) == tools['harnesses'].get(path), 'wrong harness hash: ' + path)
        profile = receipt['profile']
        profile_identity(profile)
        for runtime in ('python', 'node', 'chrome'):
            require(profile.get(runtime) == tools.get(runtime) and bool(profile.get(runtime)),
                    'producer profile differs from measured runtime: ' + runtime)
        require(raw.get('passed') is all(s.get('passed') is True for s in steps), 'inconsistent raw shard verdict')
        for step in steps:
            require(step == by_name[step['name']], 'aggregate step differs from original shard')
            ran.append(step['name'])
            if step['name'] in NATIVE:
                observed.append((step['name'], cases(step, out, policy['inventory'][step['name']]), profile, raw['checkout']))
            else:
                require(step.get('passed') is True and type(step.get('exit')) is int and step['exit'] == 0,
                        step['name'] + ': non-browser failure cannot be excepted')
                # Recompute unit/deploy verdicts from raw logs; a claimed green
                # summary alone does not establish that any checks ran.
                if step['name'] in ('python-units', 'deploy-refusals', 'node-units'):
                    unit_evidence(step, out, policy['inventory'][step['name']])
                elif step['name'] == 'wake-replay':
                    replay_evidence(step, out, traffic)
        require(raw['required'] == summary['required'], 'shard required plan differs')
    require(Counter(ran) == Counter(policy['required']), 'incomplete whole-run coverage')
    require(unique(summary.get('failed'), 'combined failures') ==
            {s['name'] for s in combined if s['passed'] is not True}, 'combined failure union differs')
    require(summary.get('passed') is all(s.get('passed') is True for s in combined), 'inconsistent raw aggregate verdict')
    result = classify(policy, observed, candidate_root, commit)
    if binding is not None:
        require(not summary['passed'] or binding['producer']['conclusion'] == 'success',
                'producer failed outside its reported checks')
        result.update(controller=binding['controller'], producer=binding['producer'], status_head_sha=binding['producer']['head_sha'])
    result.update(run=run, base=base, merge=expected_merge, raw_passed=summary['passed'],
                  policy_sha256=hashlib.sha256(baseline.read_bytes()).hexdigest(),
                  plan_source_commit=policy['source_commit'], transition_review=transition_review,
                  retired_base_sources=sorted(definition_paths(candidate_root, base['sha']) - definition_paths(candidate_root, policy['source_commit'])))
    return result


def history_path(folder, value):
    require(isinstance(value, str) and value and not Path(value).is_absolute(), 'invalid attempt history path')
    path = (folder / value).resolve()
    try:
        path.relative_to(folder.resolve())
    except ValueError:
        raise Refused('attempt history path escapes its evidence directory')
    return path


def validate(summary_path, provenance_path, shards, baseline, base_root, candidate_root, environ=None, history=None, producer=None):
    """Revalidate every attempt; a retry cannot erase an observed failure."""
    environ = dict(os.environ if environ is None else environ)
    require(producer is None or history is None, 'protected controller accepts only first-attempt producer evidence')
    current = _validate_attempt(summary_path, provenance_path, shards, baseline, base_root, candidate_root, environ, producer=producer)
    number = current['run']['attempt']
    require(type(number) is int and number >= 1, 'invalid producer attempt number')
    require(history is not None or number == 1, 'retry requires complete attempt history')
    attempts = []
    if history is not None:
        record = read_json(history)
        require(isinstance(record, dict), 'invalid attempt history manifest')
        same_run(record.get('run'), current['run'])
        require(record.get('base') == current['base'] and record.get('merge') == current['merge'],
                'attempt history has another event base or tested merge')
        entries = record.get('attempts')
        require(isinstance(entries, list) and all(isinstance(row, dict) and type(row.get('attempt')) is int for row in entries),
                'invalid attempt history entries')
        require(sorted(row['attempt'] for row in entries) == list(range(1, number)),
                'incomplete or duplicate attempt history')
        folder = Path(history).resolve().parent
        for row in sorted(entries, key=lambda item: item['attempt']):
            prior_env = dict(environ, GITHUB_RUN_ATTEMPT=str(row['attempt']))
            paths = [history_path(folder, row.get(name)) for name in ('summary', 'provenance', 'shards')]
            try:
                result = _validate_attempt(*paths, baseline, base_root, candidate_root, prior_env)
            except (Refused, OSError, ValueError, KeyError, TypeError, AttributeError) as error:
                result = {'passed': False, 'raw_passed': False, 'refused': str(error)}
            attempts.append(dict(result, attempt=row['attempt']))
    attempts.append(dict(current, attempt=number))
    result = dict(current, attempts=attempts,
                  passed=all(item['passed'] for item in attempts),
                  raw_passed=all(item['raw_passed'] for item in attempts))
    for field in ('expected', 'unexpected'):
        result[field] = [dict(case, attempt=item['attempt']) for item in attempts for case in item.get(field, [])]
    failed = {}
    for item in result['expected'] + result['unexpected']:
        failed.setdefault((item['step'], key(item['case'])), set()).add(item['attempt'])
    healed, retried = [], []
    for item in attempts:
        for case in item.get('healed', []):
            row = dict(case, attempt=item['attempt'])
            failed_at = failed.get((case['step'], key(case['case'])))
            if failed_at:
                retried.append(dict(row, failed_attempts=sorted(failed_at)))
            else:
                healed.append(row)
    result.update(healed=healed, passed_on_retry=retried)
    return result


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    for option in ('summary', 'provenance', 'shards', 'baseline', 'base-checkout', 'candidate-checkout', 'out'):
        parser.add_argument('--' + option, required=True, type=Path)
    parser.add_argument('--history', type=Path, help='trusted manifest of every earlier attempt; required on retries')
    parser.add_argument('--producer', type=Path, help='protected controller API/event binding; first producer attempt only')
    args = parser.parse_args(argv)
    try:
        result = validate(args.summary, args.provenance, args.shards, args.baseline, args.base_checkout, args.candidate_checkout,
                          history=args.history, producer=args.producer)
    except (Refused, OSError, ValueError, KeyError, TypeError, AttributeError) as error:
        result = {'passed': False, 'refused': str(error)}
    args.out.write_text(json.dumps(result, indent=2) + '\n')
    print(json.dumps(result, sort_keys=True))
    return 0 if result['passed'] else 1


if __name__ == '__main__':
    raise SystemExit(main())

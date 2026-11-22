from __future__ import annotations

"""Protected Verdict controller: bind complete head-tree evidence and compare recent base runs.

No code is loaded from the candidate or base checkouts. This file contains its
own evidence parsers; all executable non-stdlib code is the controller commit.
Raw verdicts remain raw. Mutation results are advisory on trains.
"""
import argparse
import ast
from contextlib import contextmanager
import datetime
from collections import Counter, namedtuple
from functools import lru_cache
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import sysconfig

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
PRODUCER_WORKFLOW = '.github/workflows/checks.yml'
TOOL = 'theseus-release-check'
COMPOSE = 'tests/reader_compose_native.mjs'
REPLAY_FILE = 'tests/fixtures/replay/wake-2026-11-05.json'
REPLAY_TOOL = 'tools/wake_replay.py'
WAKE_REPLAY = 'wake-replay'
END_LINE = 'AssertionError [ERR_ASSERTION]: see native.json for exact failing assertions'
PHASES = [phase + ':' + engine for phase in ('run', 'runAnswering', 'runSending') for engine in ('chromium', 'webkit')]
FRAME = re.compile(r'^\s*at (?:async )?(?:[^\s(]+ \()?(?:file://)?(\S*?/tests/[^\s():]+):(\d+):\d+\)?\s*$')
# A Python fixture's traceback frame, as the harness echoes it when the fixture's own exit check fails.
FIXTURE_FRAME = re.compile(r'^\s*File "(\S*?/tests/[^"]+)", line (\d+), in \S+')
GENERATED_ID = re.compile(r'(?<![0-9A-Za-z])([mtpd])-[0-9a-f]{32}(?![0-9A-Za-z])')
SHA = re.compile(r'[0-9a-f]{40}')
PROFILE_FIELDS = ('runner_os', 'runner_arch', 'image_os', 'image_version', 'scroll_bars', 'reduce_motion', 'cpus', 'python', 'node', 'chrome', 'playwright')
NativeStep = namedtuple('NativeStep', 'name harness flags results')
NATIVE_STEPS = tuple(
 [NativeStep(mode, 'tests/reader_persistence_native.mjs', ('--'+mode,), 'native.json') for mode in
 ('journal','connected','correction','cleanup','images','freshness','inline','navigation','live','colors','asks','whispers','work','light','list','notebook','duties','sources','wakes','header','rail','conversation','forms','pipeline','targets','health','reading')]
 + [NativeStep('openings','tests/reader_openings_native.mjs',(),'native.json'),NativeStep('reader','tests/reader_native.mjs',(),'results.json')]
 + [NativeStep('reader-'+mode,'tests/reader_native.mjs',('--'+mode,),'results.json') for mode in ('keyboard','review-gaps','anchor-control','mutations','finished')]
 + [NativeStep('webkit-'+mode,'tests/webkit_native.mjs',('--'+mode,),'native.json') for mode in ('colors','whispers','notebook','rail','pipeline','device','new-line','reading')]
 + [NativeStep('compose',COMPOSE,(),'native.json'),NativeStep('fence-copy','tests/fence_copy_native.mjs',(),'native.json')])
NATIVE = {'native-'+s.name:s for s in NATIVE_STEPS}
REQUIRED = ('python-units','node-units','deploy-refusals') + tuple(NATIVE) + ('wake-replay',)
def harnesses():
    return {s.harness for s in NATIVE_STEPS}


class Refused(Exception):
    pass

def require(condition, message):
    if not condition:
        raise Refused(message)

def read_json(path):
    try:
        return json.loads(Path(path).read_text())
    except (OSError, ValueError, RecursionError) as error:
        raise Refused('unreadable JSON %s: %s' % (path, error))


def evidence_log(path):
    try:
        return Path(path).read_text()
    except (OSError, UnicodeError) as error:
        raise Refused('unreadable evidence log %s: %s' % (path, error))

def git(root, *args):
    answer = subprocess.run(['git', '-C', str(root)] + list(args), capture_output=True)
    require(answer.returncode == 0, 'cannot read verified source: git %s' % ' '.join(args))
    return answer.stdout

def source(root, commit, path):
    require(isinstance(commit, str) and SHA.fullmatch(commit), 'invalid source commit')
    require(isinstance(path, str) and bool(path) and not Path(path).is_absolute()
            and '..' not in Path(path).parts and '.git' not in Path(path).parts, 'invalid source path')
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


def replay_refusal_text(value):
    """Only generated message IDs vary; keep other IDs, paths and words."""
    labels = {}
    return re.sub(r'(?<![0-9A-Za-z])m-[0-9a-f]{32}(?![0-9A-Za-z])',
                  lambda match: 'm-ID%d' % labels.setdefault(match[0], len(labels) + 1), value)

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

def _log_case_names(lines, prefix):
    names = []
    for line in lines:
        if not line.startswith(prefix):
            continue
        try:
            names.append(json.loads(line)['name' if prefix == '{"name":' else 'case'])
        except (ValueError, KeyError, TypeError):
            raise Refused('unreadable harness log line')
    return names

ERROR_HEADER = re.compile(r'^[A-Za-z]*Error( \[[A-Z_]+\])?: ')
# What a run that reached the fixture's own assertion writes after its last result and nothing else: Node's uncaught
# exception preamble, the harness's assertion header carrying the fixture's traceback, that traceback's frames and
# source lines, the fixture's own AssertionError, the harness's diff, its frames and the error's property block.
FIXTURE_TAIL = re.compile(r'^(\s*|node:internal/\S+|\s+triggerUncaughtException\(|\s+\^|\S.* !== \S.*|\s+at .*|[{}]|Node\.js v\d.*)$')
# The assertion error's property block: opened by its frame line ending in a brace, closed by a brace, holding only
# the fields Node prints for an AssertionError.
FIXTURE_PROPERTY = re.compile(r'^\s+(generatedMessage|code|actual|expected|operator|diff|message|name): .*$')

def fixture_exit_row(name, code, log, rows, harness, report, history):
    """The fixture failed its own end-of-run check after the harness ran the cases it had.

    The harness logs each case as it starts and again with its result, writes its report, and asserts the fixture's
    exit in its teardown, so the fixture's traceback is the last thing a run that got that far writes. The exit is
    then a failure the step carries: a row whose error is the fixture's own assertion, with its traceback frames as
    verified source frames, and whose message names the harness source and how many cases ran before it. The controls
    say whether that failure is known, and a control agrees only when the same harness ran the same number of cases
    to the same assertion; a harness that aborted between cases, or a changed harness, matches no control. A started
    case without its result, a log that disagrees with the report, or a traceback that is not terminal is refused.
    """
    lines = log.splitlines()
    started, finished = _log_case_names(lines, '{"case":'), _log_case_names(lines, '{"name":')
    require(started == finished and bool(finished), name + ': fixture died before the end')
    require(finished == [row.get('name') for row in rows], name + ': result log disagrees with report')
    # The harness attests that its body ran to its end; without that, balanced case lines prove only a prefix.
    # The controls predate the attestation and are held to the harness source, count and assertion instead.
    attested = [report[key] for key in ('bodyCompleted', 'harnessCompleted') if key in report]
    # A report that carries the attestation must say true, control or candidate; only a report written before the
    # attestation existed, with neither field, is read as a control by source, count and assertion.
    require(all(value is True for value in attested) if attested else history,
            name + ': harness did not finish its cases')
    last = max(n for n, line in enumerate(lines) if line.startswith('{"name":'))
    tail = lines[last + 1:]
    frames = [match for match in map(FIXTURE_FRAME.match, tail) if match]
    headers = [line.strip() for line in tail if ERROR_HEADER.match(line)]
    message = headers[1] if len(headers) >= 2 and headers[1].startswith('AssertionError: ') else None
    require(bool(frames) and message is not None and headers[0].startswith('AssertionError [ERR_ASSERTION]: Traceback'),
            name + ': fixture exit without its assertion')
    # A traceback frame's source line is admitted only right after its frame; every other line must be one of the
    # forms a run that reached the fixture's assertion writes.
    foreign, previous, in_block = [], None, False
    for line in tail:
        source = previous is not None and FIXTURE_FRAME.match(previous) and line.startswith('    ') and line.strip()
        prop = in_block and FIXTURE_PROPERTY.match(line)
        if not (source or prop or FIXTURE_FRAME.match(line) or FIXTURE_TAIL.match(line) or ERROR_HEADER.match(line)):
            foreign.append(line)
        if re.match(r'^\s+at .*\{$', line): in_block = True
        elif line.strip() == '}': in_block = False
        previous = line
    foreign += headers[2:]
    if foreign:
        raise Refused(name + ': fixture exit is not the last failure: ' + foreign[0].strip()[:200])
    require(isinstance(harness, str) and bool(harness), name + ': harness source unrecorded')
    message += ' | after %d cases of %s %s' % (len(rows), NATIVE[name].harness, harness)
    error = message + '\n' + '\n'.join('    at fixture (file://%s:%s:1)' % (match[1], match[2]) for match in frames)
    return {'name': 'fixture exit %d' % code, 'passed': False, 'error': error}

def cases(step, out, harness=None, history=False):
    name = step['name']
    native = NATIVE[name]
    report = read_json(out / 'native' / native.name / native.results)
    rows = report.get('results')
    require(isinstance(rows, list) and bool(rows), name + ': missing case results')
    require(all(isinstance(r, dict) and type(r.get('passed')) is bool for r in rows), name + ': invalid result')
    actual = [key(r) for r in rows]
    require(len(actual) == len(set(actual)), name + ': duplicate case identity')
    counts, good = native_counts(native, out / 'native' / native.name)
    require(step.get('counts') == counts, name + ': summary counts disagree with report')
    require(counts['browser_closed'] is True, name + ': browser cleanup failed')
    log = (out / (name + '.log')).read_text()
    if native.harness == COMPOSE:
        require(compose_completed(report), name + ': phases or fixture cleanup unattested')
    elif native.results == 'results.json':
        final = _final_json(log)
        require(isinstance(final, dict) and final.get('closed') is True and final.get('results') == rows,
                name + ': missing final result log')
    else:
        code = report.get('fixtureExitCode')
        require(type(code) is int, name + ': fixture exit unrecorded')
        require(report.get('fixtureExitSignal') is None, name + ': fixture was signalled')
        if code != 0:
            # The harness exits non-zero on the fixture's exit however its cases went.
            rows, good = rows + [fixture_exit_row(name, code, log, rows, harness, report, history)], False
        elif counts['fail']:
            require(END_LINE in log.splitlines(), name + ': harness did not reach end')
    require(type(step.get('exit')) is int and step['exit'] == (0 if good else 1), name + ': abnormal harness exit')
    require(step.get('passed') is good, name + ': inconsistent raw verdict')
    return rows

def profile_identity(profile):
    require(isinstance(profile, dict) and bool(profile), 'missing execution profile')
    # Load samples and paths remain evidence, never an admission key. Require
    # every stable setting so an incomplete old receipt cannot match by omission.
    require(all(k in profile and profile[k] is not None and profile[k] != '' for k in PROFILE_FIELDS),
            'incomplete stable execution profile')
    return {k: profile[k] for k in PROFILE_FIELDS}

def replay_evidence(step, out, traffic):
    routed = unique(traffic.get('routed'), 'head routed actors')
    require(bool(routed), 'wake-replay: empty head routed actor inventory')
    runs = step.get('runs')
    require(isinstance(runs, list) and bool(runs), 'wake-replay: missing runs')
    replay_runs = []
    for number, run in enumerate(runs, 1):
        counts, good = replay_counts(out / 'replay' / ('candidate-%d' % number))
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
    recalculated = replay_step(replay_runs, step.get('started_at'))
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
            if line.startswith(('FAILED (', 'OK (')):
                continue
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

def unit_results(step, out, allow_empty=False):
    """Complete individual outcomes, including failures; never a truncated prefix."""
    name = step['name']
    text = evidence_log(out / (name + '.log'))
    counts, _ = node_counts(text) if name == 'node-units' else python_counts(text, allow_empty=allow_empty)
    require(step.get('counts') == counts, 'non-browser log/count mismatch')
    if name != 'node-units':
        ran = re.findall(r'^Ran (\d+) tests? in ', text, re.M)
        require(len(ran) == 1 and int(ran[0]) == counts['tests'], 'non-browser log/count mismatch')
    require(not any(counts.get(k, 0) for k in ('skipped', 'todo', 'cancelled', 'expected failures', 'unexpected successes')),
            name + ': unapproved skipped, todo or incomplete checks')
    rows = unit_records(text, node=name == 'node-units')
    require(type(counts.get('tests')) is int and (counts['tests'] > 0 or allow_empty and counts['tests'] == 0)
            and len(rows) == counts['tests'], name + ': incomplete unit log')
    outcomes = Counter(status for _, status in rows)
    allowed = {'ok', 'not ok'} if name == 'node-units' else {'ok', 'FAIL', 'ERROR'}
    require(set(outcomes) <= allowed,
            name + ': unapproved skipped/todo or missing individual check outcomes')
    actual = Counter(key(row) for row, _ in rows)
    # Node permits distinct passing tests to use the same display name. They
    # supply no failure admission. Any failing occurrence must be unambiguous;
    # Python identities already include their module/class and stay unique.
    require(all(actual[key(row)] == 1 for row, status in rows if name != 'node-units' or status != 'ok'),
            name + ': duplicate executed identity')
    if name == 'node-units':
        require(counts.get('pass') == outcomes['ok'] and counts.get('fail') == outcomes['not ok']
                and counts['pass'] + counts['fail'] == counts['tests'], name + ': unit outcomes disagree with totals')
        terminal = list(re.finditer(r'^# tests \d+$', text, re.M))
        require(len(terminal) == 1 and all(re.fullmatch(r'# (?:tests|suites|pass|fail|cancelled|skipped|todo|duration_ms) [0-9.]+', line)
                for line in text[terminal[0].start():].splitlines() if line.strip()),
                name + ': incomplete or abnormal unit ending')
    else:
        require(counts.get('failures', 0) == outcomes['FAIL'] and counts.get('errors', 0) == outcomes['ERROR']
                and counts.get('status') == ('FAILED' if outcomes['FAIL'] or outcomes['ERROR'] else 'OK'),
                name + ': unit outcomes disagree with totals')
        endings = list(re.finditer(r'^(?:OK|FAILED)(?: \([^\n]*\))?$', text, re.M))
        require(len(endings) == 1, name + ': incomplete or abnormal unit ending')
        # unittest's stderr summary can precede buffered test stdout. Require
        # explicit completion and complete JSON diagnostics, not an exception,
        # fatal tail or a truncated record.
        tail = text[endings[0].end():].strip()
        while tail:
            try:
                record, end = json.JSONDecoder().raw_decode(tail)
            except (ValueError, RecursionError):
                raise Refused(name + ': incomplete or abnormal unit ending')
            require(isinstance(record, (dict, list)), name + ': unsupported buffered unit output')
            tail = tail[end:].strip()
    return [dict(row, passed=status == 'ok', unit_status=status, comparison='unit-identity') for row, status in rows]


def unit_evidence(step, out, allow_empty=False):
    rows = unit_results(step, out, allow_empty)
    require(all(row['passed'] for row in rows), step['name'] + ': not every planned check passed')

def producer_binding(path, environ):
    """Bind original PR or release-branch push evidence to the protected event."""
    record = read_json(path)
    event = read_json(environ.get('GITHUB_EVENT_PATH', ''))
    require(isinstance(record, dict) and all(isinstance(record.get(k), dict) for k in ('controller', 'producer', 'merge')),
            'missing or malformed original controller binding')
    require(isinstance(event, dict) and isinstance(event.get('workflow_run'), dict), 'missing controller event binding')
    require(environ.get('GITHUB_EVENT_NAME') == 'workflow_run' and event.get('action') == 'completed',
            '--producer requires a protected completed workflow_run controller')
    controller = record['controller']
    expected = {'run_id': environ['GITHUB_RUN_ID'], 'run_attempt': environ['GITHUB_RUN_ATTEMPT'],
                'workflow_sha': environ['GITHUB_WORKFLOW_SHA'], 'workflow_ref': environ['GITHUB_WORKFLOW_REF'],
                'sha': environ['GITHUB_SHA'], 'repository': environ['GITHUB_REPOSITORY']}
    require(all(str(controller.get(k)) == str(v) for k,v in expected.items()), 'wrong protected controller identity')
    repository = expected['repository']
    require(controller['workflow_ref'].startswith(repository+'/.github/workflows/')
            and controller['workflow_ref'].endswith('@refs/heads/'+event['repository']['default_branch']),
            'controller workflow is not on the default branch')
    for field in ('workflow_sha','sha'):
        require(isinstance(controller[field],str) and SHA.fullmatch(controller[field]), 'invalid controller source identity')
    p, observed, merge = record['producer'], event['workflow_run'], record['merge']
    require(set(('run_id', 'run_attempt', 'event', 'head_sha', 'head_branch', 'head_repository',
                 'created_at', 'conclusion', 'workflow_path', 'workflow_name')) <= set(p)
            and {'sha', 'tree', 'first_parent', 'second_parent'} <= set(merge), 'partial original producer binding')
    require(str(p['run_id']) == str(observed['id']) and str(p['run_attempt']) == str(observed['run_attempt']),
            'producer is not the triggering run/attempt')
    require(int(p['run_attempt']) == 1, 'protected controller refuses producer retries; request a fresh producer run')
    require(p['event'] == observed['event'] and p['event'] in ('pull_request','push'), 'unsupported producer event')
    require(p['workflow_path'] == PRODUCER_WORKFLOW and p['workflow_name'] == observed['name'], 'unexpected producer workflow identity')
    require(observed.get('path',PRODUCER_WORKFLOW) == PRODUCER_WORKFLOW, 'producer workflow path differs from trigger')
    require(p['head_repository'] == repository, 'producer head is in another repository')
    require(p['created_at'] == observed['created_at'] and p['head_branch'] == observed['head_branch'], 'producer metadata differs from trigger')
    require(p['head_sha'] == observed['head_sha'], 'producer head differs from API event')
    require(p['conclusion'] == observed['conclusion'] and p['conclusion'] in ('success','failure'), 'producer is cancelled or incomplete')
    if p['event'] == 'pull_request':
        pr = p.get('pull_request')
        require(isinstance(pr, dict) and {'number', 'head_sha', 'base_ref', 'base_sha'} <= set(pr), 'partial original PR binding')
        prs = [r for r in observed.get('pull_requests',[]) if r.get('number') == pr['number']]
        require(p['head_sha'] == pr['head_sha'] and len(prs) == 1 and prs[0]['head']['sha'] == pr['head_sha']
                and prs[0]['base']['sha'] == pr['base_sha'], 'PR base/head is not authenticated by controller event')
        tested_base = record.get('tested_base')
        base = {'ref':pr['base_ref'],'sha':pr['base_sha']}
        if tested_base is not None:
            require(isinstance(tested_base, dict) and tested_base.get('ref') == pr['base_ref'], 'wrong tested base branch')
            require(all(isinstance(tested_base.get(k), str) and SHA.fullmatch(tested_base[k]) for k in ('sha','branch_head')),
                    'invalid authenticated tested base')
            base = {'ref':tested_base['ref'],'sha':tested_base['sha']}
        comparison = record.get('base_comparison')
        require(isinstance(comparison, dict) and set(comparison) == {'at_run', 'current'}, 'missing or malformed base comparison')
        at_run, current = comparison['at_run'], comparison['current']
        require(isinstance(at_run, dict) and set(at_run) == {'sha', 'tree'}
                and isinstance(current, dict) and set(current) == {'number', 'head_sha', 'repository', 'ref', 'sha', 'tree'},
                'partial base comparison')
        require(all(isinstance(fact.get(k), str) and SHA.fullmatch(fact[k])
                    for fact in (at_run, current) for k in ('sha', 'tree')), 'invalid base commit/tree identity')
        require(isinstance(tested_base, dict) and at_run['sha'] == base['sha']
                and current['sha'] == tested_base['branch_head']
                and current['number'] == pr['number'] and current['head_sha'] == p['head_sha']
                and current['repository'] == repository and current['ref'] == pr['base_ref'], 'current PR base comparison binding differs')
        require(at_run['tree'] == current['tree'], 'base comparison has different trees')
        require(('receipt_base' in record) == ('base_at_run' in record), 'partial original base observation')
        if 'receipt_base' in record:
            original, observed_base = record['receipt_base'], record['base_at_run']
            require(isinstance(original, dict) and set(original) == {'ref', 'sha'}
                    and isinstance(original['ref'], str) and bool(original['ref'])
                    and isinstance(original['sha'], str) and SHA.fullmatch(original['sha']), 'invalid original receipt base')
            require(observed_base == {'ref': original['ref'], 'sha': base['sha']}, 'original base_at_run differs from tested parent')
            require(original == {'ref': pr['base_ref'], 'sha': pr['base_sha']} or original['sha'] == base['sha'],
                    'original receipt base is neither API base nor tested parent')
        require(merge['first_parent'] == base['sha'] and merge['second_parent'] == p['head_sha'], 'merge parents differ from API base/head')
    else:
        base = p['comparison_base']
        approved = environ.get('APPROVED_BASES','release/live72,codex/aim-next,release/live73').split(',')
        require(base['ref'] == p['head_branch'] and base['ref'] in approved, 'push is not on an approved comparison branch')
        require(merge['sha'] == p['head_sha'] and merge['first_parent'] == base['sha'], 'push head/comparison first parent differs')
    for value in (p['head_sha'],base['sha'],merge['sha'],merge['tree'],merge['first_parent']):
        require(isinstance(value,str) and SHA.fullmatch(value), 'invalid producer source identity')
    require(merge.get('second_parent') is None or isinstance(merge['second_parent'],str) and SHA.fullmatch(merge['second_parent']), 'invalid second parent')
    require(merge.get('fetched') == merge['sha'] and merge.get('rebuilt') == merge['tree'], 'producer lacks authenticated fetched/tree evidence')
    run = {'id':int(p['run_id']),'attempt':1,'workflow':p['workflow_name'],'event':p['event'],'repository':repository}
    return run,base,merge['sha'],record


def receipt_head(record):
    p = record['producer']
    return {'ref':('refs/heads/' if p['event'] == 'push' else '')+p['head_branch'],'sha':p['head_sha']}

def same_run(actual, expected):
    require(isinstance(actual, dict), 'missing producer run receipt')
    require(all(str(actual.get(k)) == str(v) for k, v in expected.items()), 'wrong producer run or attempt')

def plan_steps(plan):
    require(isinstance(plan, list) and bool(plan), 'missing shard plan')
    result = []
    for shard in plan:
        require(isinstance(shard, dict), 'invalid shard plan job')
        steps = shard.get('steps')
        steps = steps.split(',') if isinstance(steps, str) else steps
        require(isinstance(steps, list) and bool(steps) and
                all(isinstance(s, str) and s for s in steps), 'invalid shard plan steps')
        result.append(steps)
    return result


def python_source_files(root, commit):
    """Unittest's file/package discovery from Git names, without candidate imports."""
    # Display-form Git names C-quote Unicode/control bytes; only NUL is a path boundary.
    paths = set(os.fsdecode(git(root, 'ls-tree', '-r', '-z', '--name-only', commit, '--', 'tests')).split('\0')[:-1])
    result = set()
    for name in paths:
        path = Path(name)
        if not all(str(parent / '__init__.py') in paths for parent in path.parents
                   if str(parent) not in ('.', 'tests')):
            continue
        if (path.name == '__init__.py' and str(path.parent) != 'tests' or
                path.match('test_*.py') and re.match(r'[_a-z]\w*\.py$', path.name, re.I)):
            result.add(name)
    return result


def partition_plan(plan, required, root=None, commit=None, fresh=False):
    """One obligation per whole step, or the complete source-bound Python union."""
    assigned = plan_steps(plan)
    ordinary, parts, totals = [], {}, set()
    for index, (job, steps) in enumerate(zip(plan, assigned)):
        if job.get('compose_group'):
            require(fresh and steps == ['native-compose'] and 'python_shard' not in job,
                    'invalid compose/partition assignment')
            continue
        if 'python_shard' not in job:
            ordinary.extend(steps)
            continue
        value = job['python_shard']
        require(steps == ['python-units'] and isinstance(value, str) and
                re.fullmatch(r'[1-9][0-9]*/[1-9][0-9]*', value), 'invalid Python partition')
        number, total = map(int, value.split('/'))
        require(1 <= number <= total <= len(plan), 'unknown Python partition')
        files = job.get('files')
        require(isinstance(files, list) and all(isinstance(f, str) and f.startswith('tests/') and
                str(Path(f)) == f and '..' not in Path(f).parts for f in files), 'invalid partition files')
        unique(files, 'partition files')
        require(isinstance(job.get('name'), str) and bool(job['name']), 'unnamed Python partition')
        parts[index] = {'index': number, 'total': total, 'files': sorted(files)}
        totals.add(total)
    expected = set(required) - ({'native-compose'} if fresh else set())
    if parts:
        require(len(totals) == 1, 'inconsistent Python partition totals')
        total = next(iter(totals))
        require(len(parts) == total and {p['index'] for p in parts.values()} == set(range(1, total+1)),
                'missing or duplicate Python partition')
        require('python-units' in expected, 'unknown partitioned step')
        unique([plan[i]['name'] for i in parts], 'partition job names')
        files = [f for p in parts.values() for f in p['files']]
        unique(files, 'partition source files')
        if root is not None:
            require(set(files) == python_source_files(root, commit), 'incomplete or unknown Python source coverage')
        expected.remove('python-units')
    require(Counter(ordinary) == Counter(expected), 'incomplete or duplicated shard plan')
    return parts


def partition_aggregate(parts):
    """Recompute the producer's one Python receipt; keep each original part."""
    counts = {'tests': sum(p['counts']['tests'] for p in parts),
              'status': 'OK' if all(p['counts'].get('status') == 'OK' for p in parts) else 'FAILED'}
    for field in ('skipped', 'failures', 'errors', 'expected failures', 'unexpected successes'):
        if any(field in p['counts'] for p in parts):
            counts[field] = sum(p['counts'].get(field, 0) for p in parts)
    return {'name': 'python-units', 'tool': 'unittest', 'counts': counts,
            'exit': max(p['exit'] for p in parts),
            'passed': counts['tests'] > 0 and all(p['passed'] is True for p in parts), 'shards': parts}


def python_counts(text, allow_empty=False):
    ran = re.findall(r"^Ran (\d+) tests? in ", text, re.M)
    status = re.findall(r"^(OK|FAILED)(?: \((.*)\))?$", text, re.M)
    counts = {"tests": int(ran[-1]) if ran else 0, "status": status[-1][0] if status else None}
    for part in (status[-1][1].split(", ") if status and status[-1][1] else []):
        key, _, value = part.partition("=")
        counts[key] = int(value)
    passed = (counts["tests"] > 0 or allow_empty and bool(ran)) and counts["status"] == "OK"
    return counts, passed

def node_counts(text):
    counts = {key: int(value) for key, value in
              re.findall(r"^# (tests|pass|fail|cancelled|skipped|todo) (\d+)$", text, re.M)}
    passed = counts.get("tests", 0) > 0 and counts.get("fail") == 0 and counts.get("cancelled") == 0
    return counts, passed

def native_counts(step, evidence):
    """Counts from the harness's own results file; a missing or unreadable file is a failure."""
    path = evidence / step.results
    try:
        report = json.loads(path.read_text())
    except (OSError, ValueError) as error:
        return {"error": "no readable %s: %s" % (step.results, error)}, False
    results = report.get("results") or []
    if step.results == "results.json":
        good = [r for r in results if (r.get("mutationCaught") if r.get("expectedFailure") else r.get("passed"))]
        closed = report.get("closed") is True
    else:
        good = [r for r in results if r.get("passed") is True]
        closed = report.get("browserClosed") is True
    failed = [r.get("name") for r in results if r not in good]
    counts = {"tests": len(results), "pass": len(good), "fail": len(failed), "failed": failed,
              "browser_closed": closed}
    return counts, bool(results) and not failed and closed

def replay_counts(evidence):
    """One replay's result: {agent: {median, wakes, lost, delays}}; an unreadable result is a failure."""
    try:
        agents = json.loads((evidence / "replay.json").read_text())["agents"]
    except (OSError, ValueError, KeyError, TypeError) as error:
        return {"error": "no readable replay.json: %s" % error}, False
    return agents, isinstance(agents, dict) and bool(agents)

def median(values):
    ordered = sorted(values)
    if not ordered:
        return None
    middle = len(ordered) // 2
    return ordered[middle] if len(ordered) % 2 else (ordered[middle - 1] + ordered[middle]) / 2.0

def now():
    return datetime.datetime.now().astimezone().isoformat()


def replay_step(runs, started):
    """The wake-replay step from its runs: per agent the median of each run (D29's runs), the median over every wake,
    the wakes counted and the offsets lost in any run (3.5's series)."""
    series = {}
    for run in runs:
        for agent, values in ({} if "error" in run["counts"] else run["counts"]).items():
            entry = series.setdefault(agent, {"runs": [], "delays": [], "wakes": 0, "lost": []})
            entry["runs"].append(values.get("median"))
            entry["delays"] += values.get("delays") or []
            entry["wakes"] += values.get("wakes") or 0
            entry["lost"] = sorted(set(entry["lost"]) | set(values.get("lost") or []))
    for entry in series.values():
        entry["median"] = median(entry.pop("delays"))
    return {"name": WAKE_REPLAY, "tool": REPLAY_TOOL, "exit": max([run["exit"] for run in runs] or [1]),
            "passed": bool(runs) and all(run["passed"] for run in runs), "counts": {"tests": len(runs), "pass": sum(run["passed"] for run in runs)},
            "series": series, "runs": [{key: run[key] for key in ("exit", "passed", "log", "started_at", "finished_at")} for run in runs],
            "started_at": started, "finished_at": now()}

def _final_json(text):
    """The JSON object a log ends with, printed with two-space indents from a line holding only "{"; None otherwise."""
    lines = text.rstrip("\n").split("\n")
    starts = [index for index, line in enumerate(lines) if line == "{"]
    if not starts:
        return None
    try:
        return json.loads("\n".join(lines[starts[-1]:]))
    except ValueError:
        return None

def source_catalog(root, commit):
    """Interpret catalog data, never the source module's imports or statements."""
    try:
        tree = ast.parse(source(root,commit,'tools/release_check.py').decode())
    except SyntaxError as error:
        raise Refused('unreadable source catalog: '+str(error))
    definitions = {}
    for node in tree.body:
        if not isinstance(node,ast.Assign):
            continue
        for target in node.targets:
            if isinstance(target,ast.Name):
                definitions[target.id] = (node.value,None)
            elif isinstance(target,(ast.Tuple,ast.List)):
                for i,part in enumerate(target.elts):
                    if isinstance(part,ast.Name):
                        definitions[part.id] = (node.value,i)
    resolved, resolving = {}, set()
    def named(name):
        if name in resolved:
            return resolved[name]
        require(name in definitions and name not in resolving, 'unreadable catalog constant: '+name)
        resolving.add(name)
        expression,index = definitions[name]
        value = data(expression,{})
        if index is not None:
            value = value[index]
        resolving.remove(name)
        resolved[name] = value
        return value
    def data(node, scope):
        if isinstance(node,ast.Constant) and isinstance(node.value,(str,int,type(None))):
            return node.value
        if isinstance(node,ast.Name):
            return scope[node.id] if node.id in scope else named(node.id)
        if isinstance(node,(ast.Tuple,ast.List)):
            values = [data(n,scope) for n in node.elts]
            return tuple(values) if isinstance(node,ast.Tuple) else values
        if isinstance(node,ast.BinOp) and isinstance(node.op,ast.Add):
            return data(node.left,scope)+data(node.right,scope)
        if isinstance(node,ast.Attribute) and node.attr in NativeStep._fields:
            value = data(node.value,scope)
            require(isinstance(value,NativeStep),'catalog attribute is not NativeStep data')
            return getattr(value,node.attr)
        if isinstance(node,ast.Call) and isinstance(node.func,ast.Name):
            require(not any(k.arg is None for k in node.keywords),'catalog unpacking is unsupported')
            args,kwargs = [data(n,scope) for n in node.args],{k.arg:data(k.value,scope) for k in node.keywords}
            if node.func.id == 'tuple' and len(args) == 1 and not kwargs:
                return tuple(args[0])
            if node.func.id == 'NativeStep':
                return NativeStep(*args,**kwargs)
        if isinstance(node,(ast.ListComp,ast.GeneratorExp)):
            require(len(node.generators)==1,'catalog needs a single data comprehension')
            gen = node.generators[0]
            require(not gen.is_async and not gen.ifs and isinstance(gen.target,ast.Name),'unsupported catalog comprehension')
            values = data(gen.iter,scope)
            require(isinstance(values,(list,tuple)) and len(values)<=1024,'catalog data iteration is not bounded')
            return [data(node.elt,dict(scope,**{gen.target.id:value})) for value in values]
        raise Refused('catalog expression is not supported data: '+type(node).__name__)
    steps,required = tuple(named('NATIVE_STEPS')),tuple(named('REQUIRED'))
    require(0<len(steps)<=1024 and all(isinstance(s,NativeStep) for s in steps),'invalid head native catalog')
    for step in steps:
        require(all(isinstance(v,str) and v for v in (step.name,step.harness,step.results)), 'invalid native step fields')
        require(step.harness.startswith('tests/') and '..' not in Path(step.harness).parts and '/' not in step.results,'unsafe native catalog path')
        require(isinstance(step.flags,(tuple,list)) and all(isinstance(v,str) for v in step.flags),'invalid native flags')
    native = {'native-'+s.name:s for s in steps}
    require(len(native)==len(steps),'duplicate head native step')
    required_set = unique(list(required),'head required steps')
    minimum = set(native)|{'python-units','node-units'}
    require(minimum <= required_set <= minimum|{'deploy-refusals','wake-replay'},'head required catalog is incomplete')
    require('wake-replay' not in required_set or 'REPLAY_FILE' in definitions,'head replay traffic is undeclared')
    return {'NATIVE_STEPS':steps,'NATIVE':native,'REQUIRED':required,'COMPOSE':named('COMPOSE') if 'COMPOSE' in definitions else 'tests/reader_compose_native.mjs','REPLAY_FILE':named('REPLAY_FILE') if 'REPLAY_FILE' in definitions else None}


def base_at_run_format(provenance, receipts, expected):
    """Presence is part of the format: absent legacy observations never become null."""
    observed = 'base_at_run' in provenance
    if observed:
        require(provenance['base_at_run'] == expected, 'combined git-read base differs from tested merge')
    for receipt in receipts:
        require(isinstance(receipt, dict), 'invalid git-read base receipt')
        require(('base_at_run' in receipt) == observed, 'inconsistent git-read base receipt format')
        if observed:
            require(receipt['base_at_run'] == expected, 'shard git-read base differs from combined provenance')


def history_missing_steps(summary_path, provenance_path, root, api, base_ref, repository):
    """Only a well-formed, source-bound combined receipt can disclose omitted steps.

    Used after archive digest verification. Each selected step still undergoes
    raw read_evidence checks; this header cannot make a partial step whole.
    Candidate evidence never takes this history-only path.
    """
    commit = api['head_sha']
    require(isinstance(commit, str) and SHA.fullmatch(commit), 'invalid history source')
    summary, provenance = read_json(summary_path), read_json(provenance_path)
    require(isinstance(summary, dict) and isinstance(provenance, dict), 'history receipts must be objects')
    required = set(source_catalog(root, commit)['REQUIRED'])
    run = {'id':api['id'], 'attempt':1, 'workflow':'Checks', 'event':'push', 'repository':repository}
    same_run(provenance.get('run'), run)
    require(provenance['run'].get('workflow_sha') == commit and
            provenance['run'].get('workflow_ref') == '%s/%s@refs/heads/%s' % (repository, PRODUCER_WORKFLOW, base_ref),
            'history workflow source differs from API')
    base, head = {'ref':None, 'sha':None}, {'ref':'refs/heads/'+base_ref, 'sha':commit}
    parents = git(root, 'rev-list', '--parents', '-n', '1', commit).decode().split()[1:]
    merge = {'sha':commit, 'tree':git(root, 'rev-parse', commit+'^{tree}').decode().strip(),
             'first_parent':parents[0] if parents else None, 'second_parent':parents[1] if len(parents)>1 else None}
    require(provenance.get('base') == base and provenance.get('head') == head and provenance.get('merge') == merge,
            'history provenance source differs from API')
    cancelled = provenance.get('cancelled_shards') or []
    require(isinstance(cancelled, list) and cancelled == (summary.get('cancelled_shards') or []),
            'history cancellation receipts differ')
    unchanged = not bool(cancelled)
    require(provenance.get('checked') == {'commit':commit, 'tree_unchanged':unchanged}, 'dirty history provenance')
    require(unique(provenance['required'], 'history provenance steps') == required, 'incomplete history provenance plan')
    require(summary.get('tool') == TOOL and summary.get('commit') == commit,
            'wrong history combined source')
    require(summary.get('tree_unchanged') is unchanged and summary.get('tree_after') == {'head':commit, 'changes':''},
            'dirty history combined source')
    require('only' not in summary and not summary.get('skipped'), 'focused or skipped history aggregate')
    require(type(summary.get('passed')) is bool, 'history aggregate lacks raw verdict')
    require(unique(summary['required'], 'history required steps') == required,
            'history summary plan differs from source')
    require(isinstance(summary.get('steps'), list) and all(isinstance(step, dict) and
            isinstance(step.get('name'), str) and step['name'] for step in summary['steps']), 'invalid history steps')
    names = unique([step['name'] for step in summary['steps']], 'history combined steps')
    require(names <= required, 'history summary has unknown steps')
    plan = plan_steps(provenance['plan'])
    fresh = any(job.get('compose_group') for job in provenance['plan'])
    partition_plan(provenance['plan'], required, root, commit, fresh=fresh)
    cancelled_names = unique([row.get('shard') for row in cancelled if isinstance(row, dict)],
                             'history cancelled shards')
    require(len(cancelled_names) == len(cancelled) and all(isinstance(name, str) and name for name in cancelled_names),
            'invalid history cancelled shard')
    jobs = [job.get('name') for job in provenance['plan']]
    require(all(jobs.count(name) == 1 for name in cancelled_names), 'unknown history cancelled shard')
    cancelled_steps = {step for index, name in enumerate(jobs) if name in cancelled_names for step in plan[index]}
    entries = provenance.get('shards')
    require(isinstance(entries, list) and all(isinstance(entry, dict) for entry in entries), 'invalid history shard provenance')
    artifacts = [entry['artifact'] for entry in entries]
    require(unique(artifacts, 'history shard artifacts') <= {'check-%d' % i for i in range(len(plan))},
            'unknown history shard artifact')
    require(unique(summary.get('combined_from'), 'history combined artifacts') ==
            {name+'/summary.json' for name in artifacts}, 'history combined artifact inventory differs')
    base_at_run_format(provenance, [entry.get('receipt') for entry in entries], None)
    for entry in entries:
        receipt = entry.get('receipt')
        require(not entry.get('refused') and isinstance(receipt, dict), 'invalid history shard receipt')
        same_run(receipt.get('run'), run)
        require(receipt.get('base') == base and receipt.get('head') == head and receipt.get('merge') == merge,
                'history shard source differs from API')
    # Recovered stdout from a cancelled job is not a whole step, even if the
    # combined summary includes it. All parts/groups of that step must survive.
    return sorted((required - names) | cancelled_steps)


@contextmanager
def catalog_context(root,commit):
    catalog = source_catalog(root,commit)
    previous = {name:globals()[name] for name in catalog}
    globals().update(catalog)
    try:
        yield catalog
    finally:
        globals().update(previous)


def read_evidence(summary_path, provenance_path, shards, root, commit, run, base, expected_merge, binding=None, history=False, history_steps=None):
    with catalog_context(root,commit):
        return _read_evidence(summary_path,provenance_path,shards,root,commit,run,base,expected_merge,binding,history,history_steps)


def _read_evidence(summary_path, provenance_path, shards, root, commit, run, base, expected_merge, binding=None, history=False, history_steps=None):
    candidate_root = root
    traffic = json.loads(source(root,commit,REPLAY_FILE)) if 'wake-replay' in REQUIRED else None
    provenance, summary = read_json(provenance_path), read_json(summary_path)
    partial = history_steps is not None
    require(not partial or history, 'step selection is only for history')
    selected = unique(list(history_steps), 'selected history steps') if partial else set(REQUIRED)
    if partial:
        head = provenance.get('head') or {}
        ref = head.get('ref') or ''
        require(ref.startswith('refs/heads/'), 'history lacks push branch')
        missing = history_missing_steps(summary_path, provenance_path, root,
                                        {'id':run['id'], 'head_sha':commit}, ref[len('refs/heads/'):], run['repository'])
        require(bool(selected) and selected <= set(REQUIRED) - set(missing), 'selected history step is incomplete')
    else:
        require(not provenance.get('cancelled_shards') and not summary.get('cancelled_shards'),
                'cancelled shard evidence cannot cover the run')
    same_run(provenance.get('run'), run)
    require(provenance.get('base') == base, 'wrong API event base')
    require(provenance.get('merge') == expected_merge, 'wrong tested merge or tree')
    if binding is not None:
        require(provenance.get('head') == receipt_head(binding),
                'combined head differs from authenticated producer')
    if not partial:
        require(provenance.get('checked') == {'commit': commit, 'tree_unchanged': True}, 'dirty combined source')
    require(unique(provenance['required'], 'provenance steps') == set(REQUIRED), 'incomplete provenance')
    require(summary.get('tool') == TOOL and summary.get('commit') == commit, 'wrong combined source')
    if not partial:
        require(summary.get('tree_unchanged') is True and summary.get('tree_after') == {'head': commit, 'changes': ''}, 'dirty combined source')
    require('only' not in summary and not summary.get('skipped'), 'focused or skipped aggregate')
    require(unique(summary['required'], 'summary required steps') == set(REQUIRED), 'incomplete summary plan')
    combined = summary['steps']
    names = unique([s['name'] for s in combined], 'combined steps')
    require(selected <= names <= set(REQUIRED) if partial else names == set(REQUIRED), 'missing required step')
    by_name = {s['name']: s for s in combined}
    fresh = any(j.get('compose_group') for j in provenance['plan'])
    parts = partition_plan(provenance['plan'], REQUIRED, root, commit, fresh=fresh)
    forward_receipts = {}
    if fresh and 'native-compose' in selected:
        try:
            forward_receipts, forward_step = f779_validate(candidate_root,commit,provenance,shards,run,REQUIRED,F779_PRODUCER)
        except ForwardRefused as error:
            raise Refused(str(error))
        require(by_name.get('native-compose')==forward_step, 'fresh compose aggregate differs')
    plan = plan_steps(provenance['plan'])
    active = {i for i, steps in enumerate(plan) if set(steps) & selected}
    expected_steps = {step for i in active for step in plan[i]}
    entries = provenance['shards']
    if not partial:
        require(len(entries) == len(plan), 'missing shard provenance')
    observed_base = ({'ref':base['ref'], 'sha':expected_merge['first_parent']} if run['event'] == 'pull_request' else None)
    if binding is not None and 'base_at_run' in binding:
        observed_base = binding['base_at_run']
    base_at_run_format(provenance, [entry.get('receipt') for entry in entries], observed_base)
    if binding is not None and run['event'] == 'pull_request':
        require(('base_at_run' in provenance) == ('base_at_run' in binding), 'original base observation format differs from protected record')
    artifacts = [s['artifact'] for s in entries]
    found = unique(artifacts, 'shard artifacts')
    planned = {'check-%d' % i for i in range(len(plan))}
    needed = {'check-%d' % i for i in active}
    require(needed <= found <= planned if partial else found == planned, 'unexpected artifact set')
    require(unique(summary.get('combined_from'), 'combined artifact summaries') ==
            {name + '/summary.json' for name in artifacts}, 'combined artifact inventory differs')
    require({p.name for p in Path(shards).iterdir()} == set(artifacts), 'missing or extra downloaded shard')
    observed, ran, verified_parts, part_identities = [], [], {}, []
    for entry in entries:
        artifact = entry['artifact']
        if partial and artifact not in needed:
            continue
        out = Path(shards) / artifact
        receipt, raw = read_json(out / 'run.json'), read_json(out / 'summary.json')
        require(not entry.get('refused') and entry.get('receipt') == receipt, 'missing or inconsistent producer receipt')
        same_run(receipt.get('run'), run)
        if binding is not None:
            require(receipt.get('head') == provenance['head'], 'shard head differs from authenticated producer')
            producer_workflow(receipt, binding, candidate_root, commit)
        require(receipt.get('base') == base and receipt.get('merge') == expected_merge, 'stale shard source or base')
        require(receipt.get('summary_sha256') == hashlib.sha256((out / 'summary.json').read_bytes()).hexdigest(),
                'original summary digest differs from producer receipt')
        require(raw.get('tool') == TOOL and raw.get('commit') == commit
                and raw.get('tree_unchanged') is True and raw.get('tree_after') == {'head': commit, 'changes': ''}, 'dirty or wrong shard source')
        index = int(artifact.split('-')[-1])
        steps = raw['steps']
        names = [s['name'] for s in steps]
        require(Counter(names) == Counter(plan[index]), 'shard does not cover its assigned steps')
        require(raw.get('only') == names and not raw.get('skipped'), 'invalid shard focus receipt')
        receipt_steps = receipt['shard']['steps']
        require((receipt_steps.split(',') if isinstance(receipt_steps, str) else receipt_steps) == plan[index], 'wrong producer shard assignment')
        partition = parts.get(index)
        if partition is not None:
            require(receipt['shard'].get('name') == provenance['plan'][index]['name'], 'wrong Python partition job')
            metadata = [raw.get('python_shard'), steps[0].get('python_shard')]
            require(all(isinstance(p, dict) and type(p.get('index')) is int and type(p.get('total')) is int
                        and p == partition for p in metadata),
                    'Python partition evidence differs from plan')
        else:
            require('python_shard' not in raw and all('python_shard' not in s for s in steps),
                    'unplanned Python partition evidence')
        require(entry.get('commit') == commit and entry.get('tree_unchanged') is True
                and entry.get('tools') == raw.get('tools') and entry.get('steps') == names, 'combined shard provenance differs')
        tools = raw['tools']
        require(blob(source(candidate_root, commit, 'tools/release_check.py')) == tools['release_check'], 'wrong release-check tool hash')
        for path in harnesses():
            require(blob(source(candidate_root, commit, path)) == tools['harnesses'].get(path), 'wrong harness hash: ' + path)
        profile = receipt['profile']
        profile_identity(profile)
        for runtime in ('python', 'node', 'chrome'):
            require(profile.get(runtime) == tools.get(runtime) and bool(profile.get(runtime)),
                    'producer profile differs from measured runtime: ' + runtime)
        require(raw.get('passed') is all(s.get('passed') is True for s in steps), 'inconsistent raw shard verdict')
        for step in steps:
            if fresh and step['name']=='native-compose':
                verified=forward_receipts[artifact]
                require(step.get('compose_receipt')==verified and step.get('passed') is verified['passed']
                        and step.get('exit')==verified['exit'] and step.get('counts')=={'tests':len(verified['results']),'failed':sum(r['passed'] is False for r in verified['results'])}, 'fresh compose shard differs')
                observed.append(('native-compose',verified['results'],profile,raw['checkout']))
                ran.append('native-compose')
                continue
            if partition is not None:
                verified_parts[index] = dict(step, partition=raw['python_shard'])
            else:
                require(step == by_name[step['name']], 'aggregate step differs from original shard')
                ran.append(step['name'])
            if step['name'] in NATIVE:
                observed.append((step['name'], cases(step, out, (raw['tools'].get('harnesses') or {}).get(NATIVE[step['name']].harness), history),
                                 profile, raw['checkout']))
            else:
                if step.get('passed') is False:
                    rows = nonbrowser_failure_evidence(step, out, traffic)
                    observed.append((step['name'], rows, profile, raw['checkout']))
                else:
                    require(step.get('passed') is True and type(step.get('exit')) is int and step['exit'] == 0,
                            step['name'] + ': non-browser failure cannot be excepted')
                    # Recompute verdicts from raw logs, including each part.
                    if step['name'] in ('python-units', 'deploy-refusals', 'node-units'):
                        unit_evidence(step, out, allow_empty=partition is not None)
                    elif step['name'] == 'wake-replay':
                        replay_evidence(step, out, traffic)
                if partition is not None:
                    part_identities.extend(key(row) for row, _ in unit_records((out/'python-units.log').read_text()))
        require(raw['required'] == summary['required'], 'shard required plan differs')
    if parts and 'python-units' in selected:
        require(set(verified_parts) == set(parts), 'incomplete Python partition coverage')
        require(len(part_identities) == len(set(part_identities)), 'duplicate executed identity across Python partitions')
        aggregate = partition_aggregate([verified_parts[i] for i in sorted(parts)])
        require(aggregate['counts']['tests'] > 0, 'empty Python aggregate')
        require(by_name['python-units'] == aggregate, 'Python aggregate differs from verified parts')
        ran.append('python-units')
    require(Counter(s for s in ran if not (fresh and s=='native-compose')) == Counter(s for s in expected_steps if not (fresh and s=='native-compose')) and (not fresh or ran.count('native-compose')==len(forward_receipts)), 'incomplete whole-run coverage')
    if not partial:
        require(unique(summary.get('failed'), 'combined failures') ==
                {s['name'] for s in combined if s['passed'] is not True}, 'combined failure union differs')
        require(summary.get('passed') is all(s.get('passed') is True for s in combined), 'inconsistent raw aggregate verdict')
    else:
        missing = unique(summary.get('missing') or [], 'history missing steps')
        require(missing <= set(REQUIRED) and all(type(s.get('passed')) is bool for s in combined),
                'invalid partial history verdict')
        require(unique(summary.get('failed'), 'combined failures') ==
                {s['name'] for s in combined if s['passed'] is not True} | missing,
                'combined failure union differs')
        whole_pass = (all(s['passed'] for s in combined) and not missing
                      and not summary.get('missing_jobs') and not summary.get('cancelled_shards'))
        require(summary.get('passed') is whole_pass, 'inconsistent raw aggregate verdict')
    # The original failed aggregate is retained, never projected into a green
    # whole run. Only fully verified selected steps contribute known failures.
    observed = [item for item in observed if item[0] in selected]
    return observed, summary

def nonbrowser_failure_evidence(step, out, traffic=None):
    """Read failures for comparison, while retaining the original failed summary."""
    name = step['name']
    require(step.get('passed') is False, name + ': inconsistent failure verdict')
    if name in ('python-units', 'node-units', 'deploy-refusals'):
        require(type(step.get('exit')) is int and step['exit'] == 1, name + ': abnormal unit failure exit')
        rows = unit_results(step, out)
        require(any(not row['passed'] for row in rows), name + ': failing exit without failed check')
        return rows
    require(name == 'wake-replay', 'unknown non-browser base failure')
    runs = step.get('runs')
    require(isinstance(runs,list) and bool(runs), 'wake-replay: missing runs')
    routed = unique((traffic or {}).get('routed'), 'head routed actors')
    require(bool(routed), 'wake-replay: empty head routed actor inventory')
    replay_runs, rows = [], []
    for number, run in enumerate(runs, 1):
        folder = out/'replay'/('candidate-%d'%number)
        counts, good = replay_counts(folder)
        text = evidence_log(out/('wake-replay-candidate-%d.log'%number))
        code = run.get('exit')
        require(type(code) is int and code in (0, 2) and type(run.get('passed')) is bool,
                'wake-replay: abnormal run exit')
        if code == 0:
            require(good and run['passed'] is True and set(counts) == routed,
                    'wake-replay: incomplete successful report')
            for agent in counts.values():
                require(isinstance(agent, dict) and agent.get('lost') == []
                        and type(agent.get('wakes')) is int and agent['wakes'] > 0
                        and len(agent.get('delays') or []) == agent['wakes'], 'wake-replay: lost or missing wakes')
            require(bool(text.strip()), 'wake-replay: missing log')
        else:
            require(run['passed'] is False and not (folder/'replay.json').exists(),
                    'wake-replay: refusal contradicts report')
            # A typed CLI refusal is a terminal result, not a missing-report
            # exemption. Parse only literal data, never eval or candidate code.
            match = re.fullmatch(r'refused: the copy refused [^\n]+: ReplayError: (\S+) was not committed: (\{[^\n]+\})', text.strip())
            require(match is not None, 'wake-replay: missing complete terminal refusal')
            try:
                error = ast.literal_eval(match[2])
            except (ValueError, SyntaxError, RecursionError):
                raise Refused('wake-replay: malformed terminal refusal')
            require(isinstance(error, dict) and isinstance(error.get('code'), str)
                    and re.fullmatch(r'[A-Z][A-Z0-9_]*', error['code']) is not None
                    and isinstance(error.get('message'), str) and bool(error['message'])
                    and error.get('retryable') is False and isinstance(error.get('details'), dict),
                    'wake-replay: incomplete terminal refusal')
            rows.append({'name': match[1] + ' refusal ' + error['code'], 'passed': False,
                         'comparison': 'replay-refusal', 'refusal': {'code': error['code'], 'message': error['message']}})
        replay_runs.append(dict(run,counts=counts))
    recalculated = replay_step(replay_runs,step.get('started_at'))
    require(bool(rows) and step.get('exit') == recalculated['exit'] and type(step.get('exit')) is int
            and step.get('counts') == recalculated['counts'] and step.get('series') == recalculated['series'],
            'wake-replay: counts, series or exit differ from evidence')
    return rows


def producer_workflow(receipt, record, root, commit):
    data = receipt.get('run') or {}
    sha, ref = data.get('workflow_sha'), data.get('workflow_ref')
    require(sha in (commit, record['producer']['head_sha']), 'unbound producer workflow commit')
    p = record['producer']
    suffix = 'refs/heads/'+p['head_branch'] if p['event'] == 'push' else 'refs/pull/%s/merge'%p['pull_request']['number']
    expected = '%s/%s@%s' % (record['controller']['repository'], PRODUCER_WORKFLOW, suffix)
    require(ref == expected, 'unbound producer workflow reference')
    require(source(root, sha, PRODUCER_WORKFLOW) == source(root, commit, PRODUCER_WORKFLOW), 'producer workflow differs from judged tree')


def evidence_path(folder, value):
    require(isinstance(value, str) and bool(value) and not Path(value).is_absolute(), 'invalid evidence path')
    path = (folder / value).resolve()
    try:
        path.relative_to(folder.resolve())
    except ValueError:
        raise Refused('evidence path escapes its directory')
    return path


def contained_evidence(folder):
    require(folder.is_dir(), 'missing evidence directory')
    for path in folder.rglob('*'):
        try:
            path.resolve().relative_to(folder.resolve())
        except ValueError:
            raise Refused('artifact symlink escapes evidence directory')


def failure_records(observed, root, commit, run_id):
    failures, mutations = [], []
    for step, rows, profile, checkout in observed:
        for row in rows:
            item = {'step': step, 'case': identity(row), 'raw_passed': row['passed'], 'run_id': run_id}
            if row.get('expectedFailure'):
                mutations.append(dict(item, mutationCaught=row.get('mutationCaught') is True))
                continue
            if row['passed']:
                continue
            if row.get('comparison') in ('unit-identity', 'replay-refusal'):
                item['comparison'] = row['comparison']
                if row['comparison'] == 'unit-identity':
                    item['unit_status'] = row['unit_status']
                else:
                    item['refusal'] = dict(row['refusal'], message=replay_refusal_text(row['refusal']['message']))
                failures.append(item)
                continue
            try:
                fp = fingerprint(row.get('error'), checkout, root, commit)
                item.update(fingerprint=fp, profile=profile_identity(profile))
            except Refused as error:
                item['fingerprint_problem'] = str(error)
            failures.append(item)
    return failures, mutations


def compare_failures(failures, known, control_runs=None):
    expected, unexpected = [], []
    for item in failures:
        if item.get('comparison') in ('unit-identity', 'replay-refusal'):
            eligible = {r['id'] for r in (control_runs or [])
                        if item['step'] in r.get('verified_steps', [])}
            matches = [old for old in known if old.get('comparison') == item['comparison']
                       and old['run_id'] in eligible
                       and (old['step'], key(old['case'])) == (item['step'], key(item['case']))
                       and old.get('unit_status') == item.get('unit_status')
                       and (item['comparison'] != 'replay-refusal' or old['refusal'] == item['refusal'])]
            cleared = bool(eligible) and {r['run_id'] for r in matches} == eligible
            reason = 'not failed by every eligible control'
        else:
            matches = [old for old in known if 'fingerprint' in item and 'fingerprint' in old
                       and (old['step'], key(old['case']), old['fingerprint'], old['profile']) ==
                           (item['step'], key(item['case']), item['fingerprint'], item['profile'])]
            cleared = bool(matches)
            reason = item.get('fingerprint_problem') or 'not shown by recent base runs'
        if cleared:
            expected.append(dict(item, base_shown=True, cleared=True, matched_base_runs=sorted({r['run_id'] for r in matches})))
        else:
            unexpected.append(dict(item, base_shown=False, cleared=False, reason=reason))
    return {'passed': not unexpected, 'expected': expected, 'unexpected': unexpected, 'healed': []}


def test_definition_changes(root, base, commit):
    paths = git(root, 'diff', '--name-only', '--no-renames', '-z', base, commit).decode().split('\0')
    result = []
    for path in filter(None, paths):
        if not (path.startswith(('tests/', 'tools/')) or path == PRODUCER_WORKFLOW):
            continue
        def oid(sha):
            answer = subprocess.run(['git', '-C', str(root), 'rev-parse', '--verify', sha+':'+path], capture_output=True, text=True)
            return answer.stdout.strip() if answer.returncode == 0 else None
        result.append({'path': path, 'base_blob': oid(base), 'head_blob': oid(commit), 'review_required': True})
    return result


def known_base_failures(manifest_path, root, base, producer, required=None):
    manifest_path = Path(manifest_path).resolve()
    doc = read_json(manifest_path)
    require(doc.get('base_ref') == base['ref'], 'known runs belong to another base branch')
    head = doc.get('base_head')
    require(isinstance(head, str) and SHA.fullmatch(head), 'known runs lack base branch head')
    require(subprocess.run(['git','-C',str(root),'merge-base','--is-ancestor',base['sha'],head], capture_output=True).returncode == 0,
            'known-run branch head does not contain authenticated base')
    require(isinstance(doc.get('query'), str) and bool(doc['query']), 'known runs lack API query provenance')
    runs = doc.get('runs')
    step_runs = doc.get('step_runs')
    if step_runs is None:
        # Previously retained whole-run manifests retain their original checks.
        require(isinstance(runs, list) and len(runs) <= 3, 'known runs must be the last three or fewer')
        require(doc.get('fewer_than_three') is (len(runs) < 3), 'known-run count disclosure disagrees')
    else:
        target = unique(list(required if required is not None else source_catalog(root, base['sha'])['REQUIRED']),
                        'control required steps')
        require(isinstance(step_runs, dict) and set(step_runs) == target, 'known step controls differ from required plan')
        require(isinstance(runs, list) and len(runs) <= 3 * len(target), 'too many known step controls')
        for name, ids in step_runs.items():
            require(isinstance(ids, list) and len(ids) <= 3 and all(type(i) is int and i > 0 for i in ids)
                    and len(ids) == len(set(ids)), 'invalid known step control ids')
        for api in runs:
            steps = unique(api.get('steps'), 'known run selected steps')
            require(bool(steps) and steps <= target, 'unknown selected control step')
        require(step_runs == {name:[api['id'] for api in runs if name in api['steps']] for name in target},
                'known step controls disagree with selected runs')
        short = sorted(name for name in target if len(step_runs[name]) < 3)
        require(doc.get('fewer_than_three_steps') == short and doc.get('fewer_than_three') is bool(short),
                'known-step count disclosure disagrees')
    require(len({r['id'] for r in runs}) == len(runs), 'duplicate known run')
    require(runs == sorted(runs, key=lambda r:(r['created_at'],int(r['id'])), reverse=True), 'known runs not newest first')
    known, records = [], []
    for api in runs:
        run_id, sha = api['id'], api['head_sha']
        require(type(run_id) is int and run_id > 0 and api.get('run_attempt') == 1, 'known run is not a first attempt')
        require(api.get('event') == 'push' and api.get('head_branch') == base['ref'], 'known run is not a base push')
        require(api.get('conclusion') in (('success','failure') if step_runs is None else
                                         ('success','failure','cancelled','timed_out')), 'known run is cancelled or incomplete')
        if step_runs is not None:
            require(api.get('status') == 'completed', 'known step control is not completed')
        require(isinstance(api.get('created_at'), str) and api['created_at'] < producer['created_at'], 'known run is newer than judged producer')
        require(isinstance(sha,str) and SHA.fullmatch(sha), 'invalid known-run source')
        require(subprocess.run(['git','-C',str(root),'merge-base','--is-ancestor',sha,base['sha']], capture_output=True).returncode == 0,
                'known run is not from authenticated base history')
        folder = evidence_path(manifest_path.parent, api['dir'])
        contained_evidence(folder)
        provenance = read_json(folder/'release-check/provenance.json')
        require(provenance.get('head') == {'ref':'refs/heads/'+base['ref'],'sha':sha}, 'known-run provenance head differs from API')
        tree = git(root,'rev-parse',sha+'^{tree}').decode().strip()
        parents = git(root,'rev-list','--parents','-n','1',sha).decode().split()[1:]
        merge = {'sha':sha,'tree':tree,'first_parent':parents[0] if parents else None,'second_parent':parents[1] if len(parents)>1 else None}
        artifacts = api.get('artifacts')
        require(isinstance(artifacts,list) and bool(artifacts), 'known run lacks authenticated artifacts')
        names = unique([a['name'] for a in artifacts], 'known-run artifact names')
        required_artifacts = {'release-check'} | {r['artifact'] for r in provenance['shards']}
        require(required_artifacts <= names, 'known-run artifacts incomplete')
        require(all(type(a.get('id')) is int and a['id'] > 0 and type(a.get('size_in_bytes')) is int and a['size_in_bytes'] > 0 for a in artifacts), 'invalid known-run artifact identity')
        run = {'id':run_id,'attempt':1,'workflow':'Checks','event':'push','repository':producer['head_repository']}
        selected = api['steps'] if step_runs is not None else None
        observed, summary = read_evidence(folder/'release-check/summary.json', folder/'release-check/provenance.json', folder/'shards', root, sha, run, {'ref':None,'sha':None}, merge, history=True, history_steps=selected)
        for shard in provenance['shards']:
            receipt = shard['receipt']
            require(receipt.get('head') == provenance['head'], 'known shard head differs from API')
            data = receipt['run']
            require(data.get('workflow_sha') == sha and data.get('workflow_ref') == '%s/%s@refs/heads/%s' % (producer['head_repository'],PRODUCER_WORKFLOW,base['ref']), 'known shard workflow source differs from API')
        failures, mutations = failure_records(observed,root,sha,run_id)
        known.extend(failures)
        records.append({'id':run_id,'head_sha':sha,'created_at':api['created_at'],
                        'native_failures':sum('comparison' not in f for f in failures),
                        'nonbrowser_failures':sum('comparison' in f for f in failures),
                        'verified_steps':sorted(selected if selected is not None else summary['required']),
                        'raw_passed':summary['passed'],'artifacts':artifacts,'mutation_advisories':mutations,
                        **({'steps':sorted(selected)} if selected is not None else {})})
    return known, records


def tested_base_reached(root, base, binding):
    if binding.get('tested_base') is not None:
        require(subprocess.run(['git','-C',str(root),'merge-base','--is-ancestor',base['sha'],
                                binding['tested_base']['branch_head']], capture_output=True).returncode == 0,
                'tested base was not reached by authenticated base branch')
    if 'base_comparison' in binding:
        comparison = binding['base_comparison']
        for fact in comparison.values():
            require(git(root, 'cat-file', '-t', fact['sha']).strip() == b'commit', 'base identity is not a commit')
            require(git(root, 'rev-parse', fact['sha']+'^{tree}').decode().strip() == fact['tree'], 'base tree differs from Git')
        require(comparison['at_run']['tree'] == comparison['current']['tree'], 'Git base trees differ')
    if 'receipt_base' in binding:
        original = binding['receipt_base']
        require(subprocess.run(['git','check-ref-format','--branch',original['ref']], capture_output=True).returncode == 0,
                'invalid original base ref')
        require(subprocess.run(['git','-C',str(root),'merge-base','--is-ancestor',original['sha'],base['sha']],
                               capture_output=True).returncode == 0, 'original base is not reached by tested base')


def validate(summary_path, provenance_path, shards, base_root, candidate_root, producer_path, known_runs, environ=None):
    environ = os.environ if environ is None else environ
    run, base, commit, binding = producer_binding(producer_path, environ)
    controller_commit = binding['controller']['workflow_sha']
    require((ROOT/'tools/ci_known_reds.py').read_bytes() == source(ROOT,controller_commit,'tools/ci_known_reds.py'), 'validator is not controller commit code')
    tree = clean_checkout(candidate_root,commit,binding['merge']['tree'])
    clean_checkout(base_root,base['sha'])
    tested_base_reached(candidate_root, base, binding)
    parents = git(candidate_root,'rev-list','--parents','-n','1',commit).decode().split()[1:]
    require(parents == [p for p in (binding['merge']['first_parent'],binding['merge'].get('second_parent')) if p], 'tested parents differ from protected record')
    expected_merge = {'sha':commit,'tree':tree,'first_parent':parents[0],'second_parent':parents[1] if len(parents)>1 else None}
    contained_evidence(Path(shards))
    raw_base = ({'ref':None,'sha':None} if run['event'] == 'push' else
                {'ref':binding['producer']['pull_request']['base_ref'], 'sha':binding['producer']['pull_request']['base_sha']})
    if 'receipt_base' in binding:
        raw_base = binding['receipt_base']
    observed, summary = read_evidence(summary_path,provenance_path,shards,candidate_root,commit,run,raw_base,expected_merge,binding)
    known, base_runs = known_base_failures(known_runs,candidate_root,base,binding['producer'],summary['required'])
    failures, mutations = failure_records(observed,candidate_root,commit,run['id'])
    result = compare_failures(failures,known,base_runs)
    require(not summary['passed'] or binding['producer']['conclusion'] == 'success', 'producer failed outside reported checks')
    result.update(run=run,base=base,merge=expected_merge,raw_passed=summary['passed'],producer=binding['producer'],controller=binding['controller'],status_head_sha=binding['producer']['head_sha'],known_base_runs=base_runs,mutation_advisories=mutations,test_definition_changes=test_definition_changes(candidate_root,base['sha'],commit),runtime_code_paths=[str(Path(__file__).resolve())],known_policy='last-three-whole-base-push-runs-per-step',train=train_identity(candidate_root,commit,binding))
    return result


def loaded_modules():
    """Actual non-stdlib source paths; stdlib is the interpreter, not a helper checkout."""
    stdlib = Path(sysconfig.get_path('stdlib')).resolve()
    files = {str(Path(__file__).resolve())}
    for module in list(sys.modules.values()):
        name = getattr(module,'__file__',None)
        if not name or name.startswith('<'):
            continue
        path = Path(name).resolve()
        try:
            parts = path.relative_to(stdlib).parts
            if not any(p in ('site-packages','dist-packages') for p in parts):
                continue
        except ValueError:
            pass
        files.add(str(path))
    return sorted(files)


def train_identity(root,commit,binding):
    p = binding['producer']
    body = git(root,'show','-s','--format=%B',commit).decode()
    match = re.search(r'^Merge pull request #([1-9][0-9]*)\b',body,re.M)
    number = p['pull_request']['number'] if p['event'] == 'pull_request' else int(match[1]) if match else None
    base = binding['merge']['first_parent']
    item_head = p['head_sha'] if p['event'] == 'pull_request' else binding['merge'].get('second_parent') or commit
    messages = git(root,'log','--format=%H%x1f%B%x00',base+'..'+item_head).decode().split('\0')
    items, named_items, reverts = set(), [], []
    for entry in messages:
        if not entry.strip():
            continue
        sha,separator,message = entry.partition('\x1f')
        require(separator and SHA.fullmatch(sha.strip()),'unreadable train commit identity')
        for reference in re.findall(r'(?im)(?:\bThis reverts (?:commit |the content of )|^Reverts:\s*)([0-9a-f]{7,40})\b',message):
            matches = git(root,'rev-parse','--disambiguate='+reference).decode().splitlines()
            if len(matches)==1 and git(root,'cat-file','-t',matches[0]).strip()==b'commit':
                reverts.append({'commit':sha.strip(),'target_commit':matches[0]})
        trailers = subprocess.run(['git','interpret-trailers','--parse'],input=message,text=True,capture_output=True,check=True).stdout
        subject = message.splitlines()[0] if message.splitlines() else ''
        fallback = re.match(r'^Train [1-9][0-9]*: revert ([1-9][0-9]*(?:/[1-9][0-9]*)*)\b',subject,re.I)
        if fallback and not any(line.startswith('Train-Item:') for line in trailers.splitlines()):
            value = 'Revert '+fallback[1]
            if value not in named_items:
                named_items.append(value)
        for line in trailers.splitlines():
            if line.startswith('Train-Item:'):
                value = line.partition(':')[2].strip()
                if value and value not in named_items:
                    named_items.append(value)
            if line.startswith('Pipeline:'):
                items.update(int(n) for n in re.findall(r'(?<![A-Za-z0-9])[1-9][0-9]*(?![A-Za-z0-9])',line.partition(':')[2]))
    return {'pull_request':number,'items':sorted(items),'merge_commit':commit,'items_source':'Pipeline trailers in newly merged history','named_items':named_items,'display_items':named_items+[str(i) for i in sorted(items)],'reverts':reverts}


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    for option in ('summary','provenance','shards','base-checkout','candidate-checkout','producer','known-runs','out'):
        parser.add_argument('--'+option,required=True,type=Path)
    args = parser.parse_args(argv)
    try:
        result = validate(args.summary,args.provenance,args.shards,args.base_checkout,args.candidate_checkout,args.producer,args.known_runs)
    except (Refused,OSError,ValueError,KeyError,TypeError,AttributeError,RecursionError) as error:
        result = {'passed':False,'refused':str(error),'runtime_code_paths':[str(Path(__file__).resolve())]}
    result['loaded_modules'] = loaded_modules()
    args.out.write_text(json.dumps(result,indent=2)+'\n')
    print(json.dumps(result,sort_keys=True))
    return 0 if result['passed'] else 1


# Exact protected path-C implementation, embedded to retain the stdlib-only controller.


"""Protected path-C mechanics; all runtime claims come from original job output.

Stdlib only. The controller embeds these exact definitions in its protected
script. Inventory/compiler strings are frozen below, never candidate executables.
"""
import collections
import hashlib
import json
import pathlib
import subprocess
import tempfile
import re


class ForwardRefused(ValueError):
    pass


def f779_require(ok, why):
    if not ok:
        raise ForwardRefused('fresh compose: ' + why)


def f779_bytes(value):
    return json.dumps(value, sort_keys=True, separators=(',', ':'), ensure_ascii=False).encode()


def f779_hash(raw):
    return hashlib.sha256(raw).hexdigest()


def f779_digest(value):
    return f779_hash(f779_bytes(value))


def f779_identity(row):
    return row['phase'], row['engine'], row['name']


def f779_json(raw):
    def pairs(items):
        out = {}
        for k, v in items:
            f779_require(k not in out, 'duplicate JSON field')
            out[k] = v
        return out
    return json.loads(raw, object_pairs_hook=pairs)


def f779_git(root, *args):
    return subprocess.check_output(['git', '-C', str(root)] + list(args))


def f779_source(root, head):
    return {'head': head, 'tree': f779_git(root, 'rev-parse', head+'^{tree}').decode().strip(),
            'parents': f779_git(root, 'rev-list','--parents','-n','1',head).decode().split()[1:]}


def f779_inventory(root, head):
    with tempfile.TemporaryDirectory(prefix='forward779-enumerate-') as temp:
        script = pathlib.Path(temp)/'inventory.cjs'
        output = pathlib.Path(temp)/'inventory.json'
        script.write_text(F779_INVENTORY)
        result = subprocess.run(['node','--experimental-vm-modules',str(script),head,str(output)],
                                cwd=str(root), capture_output=True)
        f779_require(result.returncode == 0, 'independent inventory unavailable: '+result.stderr.decode()[-1000:])
        return f779_json(output.read_bytes())


def f779_patch(original):
    with tempfile.TemporaryDirectory(prefix='forward779-compile-') as temp:
        root = pathlib.Path(temp)
        (root/'instrument.cjs').write_text(F779_INSTRUMENT)
        (root/'original.mjs').write_bytes(original)
        subprocess.run(['node',str(root/'instrument.cjs'),str(root/'original.mjs'),str(root/'patched.mjs'),
                        '../tools/compose_deadline_775.mjs'],check=True,capture_output=True)
        return (root/'patched.mjs').read_bytes()


def f779_groups(inventory, source):
    # Exactly the reviewed 775 unknown-first-run policy, no historical timings.
    rows = [dict(r,case_id=f779_digest(f779_identity(r))) for r in inventory['rows']]
    keys = [f779_identity(r) for r in rows]
    f779_require(bool(keys) and len(set(keys)) == len(keys), 'duplicate/empty inventory')
    groups, bucket = [], []
    def flush():
        if not bucket:
            return
        cases = [dict(r,limit_seconds=300,limit_basis='unknown-300s-policy-not-measurement') for r in bucket]
        total = len(cases)*300
        groups.append({'id':'compose-'+f779_digest(cases)[:20], 'source':source,
            'inventory_sha256':f779_digest(rows),'cases_sha256':f779_digest(cases),'cases':cases,
            'phase':cases[0]['phase'],'engine':cases[0]['engine'], 'case_budget_seconds':total,
            'phase_seconds':total+300,'seed_seconds':300,'launch_seconds':120,'final_seconds':120,
            'wall_seconds':5400,'terminal_cleanup_seconds':60,'watchdog_grace_seconds':5,'worker_exit_seconds':5,
            'timeout_minutes':120,'minutes':None,'budget_minutes':None,'timing_basis':'unknown-first-group-run',
            'overlap':'common seed and full helper setup; answering coordinator also seeded for sending; no case replay within union'})
        bucket.clear()
    for row in rows:
        if bucket and (f779_identity(bucket[-1])[:2] != f779_identity(row)[:2] or (len(bucket)+1)*300>4400):
            flush()
        bucket.append(row)
    flush()
    f779_require(collections.Counter(f779_identity(r) for g in groups for r in g['cases']) == collections.Counter(keys), 'exact union differs')
    return groups


def f779_plan(plan, required, groups, root=None, commit=None):
    offered = [j['compose_group'] for j in plan if j.get('compose_group')]
    f779_require(offered == [{'id':g['id'],'source':g['source']} for g in groups], 'deterministic complete group plan differs')
    f779_require(all(j['steps']=='native-compose' and j['name']==j['compose_group']['id'] for j in plan if j.get('compose_group')), 'group assignment differs')
    try:
        partition_plan(plan, required, root, commit, fresh=True)
    except Refused as error:
        raise ForwardRefused('fresh compose: ' + str(error))


def f779_job(group, receipt, report, binding, worker, log, source, hashes, original, patched, producer, run, source_bytes=None):
    f779_require(receipt.get('source') == source == group['source'] and receipt.get('group')==group['id']
                  and receipt.get('cases_sha256') == group['cases_sha256'], 'source/group binding differs')
    f779_require(binding == receipt.get('binding') and binding.get('product') == source,
                  'receipt/raw source binding differs')
    f779_require(binding.get('checkout_head')==source['head'] and binding.get('checkout_tree')==source['tree']
                  and binding.get('checkout_parents')==source['parents'] and binding.get('enumeration_hashes')==hashes,
                  'checkout/input provenance differs')
    for key, value in (('original_harness_sha256',f779_hash(original)),('instrumented_harness_sha256',f779_hash(patched)),
                       ('instrument_sha256',producer['compose_deadline_775.mjs']),('supervisor_sha256',producer['compose_worker_775.mjs']),
                       ('wrapper_sha256',producer['run_compose_group.py'])):
        f779_require(binding.get(key)==value, 'reviewed harness/producer differs: '+key)
    actual = binding.get('actual_runtime') or {}
    checkout = binding.get('checkout')
    f779_require(isinstance(checkout,str) and pathlib.Path(checkout).is_absolute()
                  and actual.get('source_checkout')==checkout, 'actual checkout absent')
    fixtures = report.get('scope775',{}).get('fixtures')
    f779_require(isinstance(fixtures,list) and len(fixtures)==2 and fixtures==actual.get('fixture_observations'), 'actual fixture facts absent')
    f779_require(len({f['origin'] for f in fixtures})==2 and all(re.fullmatch(r'http://127\.0\.0\.1:[0-9]+',f.get('origin',''))
                  and isinstance(f.get('instance_id'),str) and f['instance_id'] for f in fixtures), 'fixture identity differs')
    scope = report.get('scope775') or {}
    phase = group['phase']+':'+group['engine']+'/group:'+group['id']
    f779_require(report.get('harnessCompleted') is False and scope.get('originalWholeCompleted') is False
                  and scope.get('groupCompleted') is True and scope.get('group')==group['id']
                  and scope.get('source')==source and scope.get('cases_sha256')==group['cases_sha256']
                  and report.get('plannedPhases')==[phase] and report.get('completedPhases')==[phase], 'scoped completion differs')
    f779_require(report.get('browserClosed') is True and report.get('fixtureExitCode')==0
                  and type(report.get('fixtureExitCode')) is int and report.get('fixtureExitSignal','missing') is None
                  and not report.get('fixtureErrors') and report.get('shortFixture',{}).get('exitCode')==0
                  and type(report.get('shortFixture',{}).get('exitCode')) is int
                  and report.get('shortFixture',{}).get('exitSignal','missing') is None
                  and not report.get('shortFixture',{}).get('errors'), 'browser/fixture retirement unproved')
    f779_require(not any(report.get(k) for k in ('teardown','instrumentError','pageErrors','left','harnessError')), 'teardown/infrastructure failure')
    f779_require(worker==receipt.get('worker') and worker.get('event')=='exit' and worker.get('terminal') is False
                  and type(worker.get('code')) is int and worker['code']==receipt.get('exit'), 'producer retirement unproved')
    restoration = receipt.get('retirement') or {}
    f779_require(restoration.get('wrapper_wait_returncode')==worker['code'] and restoration.get('source_restored') is True
                  and restoration.get('git_status')=='', 'source restoration unproved')
    rows = report.get('results')
    f779_require(isinstance(rows,list) and [r.get('name') for r in rows]==[r['name'] for r in group['cases']]
                  and scope.get('completedCases')==[r['name'] for r in group['cases']], 'unrun/duplicate/wrong case inventory')
    normalized = [dict(r,phase=e['phase'],engine=e['engine']) for r,e in zip(rows,group['cases'])]
    f779_require(receipt.get('results')==normalized and receipt.get('planned_cases')==group['cases'], 'raw false/body changed')
    f779_require(all(type(r.get('passed')) is bool and (r['passed'] or bool(r.get('error')))
                  and (not r.get('expectedFailure') or r.get('mutationCaught') is True)
                  and ('observedPassed' not in r or r['passed'] is r['observedPassed']) for r in rows), 'raw verdict/mutation missing')
    for field in ('hashes','sourceHashes'):
        for path, value in report.get(field,{}).items():
            f779_require(source_bytes is not None and path in source_bytes and value==f779_hash(patched if path=='tests/reader_compose_native.mjs' else source_bytes[path]), 'raw source hash differs')
    good = all(r['passed'] is True for r in rows)
    f779_require(receipt.get('complete') is True and receipt.get('cleanup') is True and not receipt.get('terminal')
                  and receipt.get('unrun')==[] and receipt.get('passed') is good and type(receipt.get('exit')) is int
                  and ((good and receipt['exit']==0) or (not good and receipt['exit']==1) or
                       (not good and receipt['exit']==0 and all(r['passed'] or (r.get('expectedFailure') is True and r.get('mutationCaught') is True) for r in rows))), 'false-to-green/partial producer')
    counts = re.findall(r'^(\d+) passed, (\d+) failed$',log,re.M)
    f779_require(bool(counts) and tuple(map(int,counts[-1]))==(sum(r.get('mutationCaught') is True if r.get('expectedFailure') and 'observedPassed' in r else r['passed'] for r in rows),
                       sum(not (r.get('mutationCaught') is True if r.get('expectedFailure') and 'observedPassed' in r else r['passed']) for r in rows)), 'raw log differs')
    engines = scope.get('runtime')
    f779_require(engines==actual.get('browser_engines') and isinstance(engines,list) and len(engines)==1
                  and engines[0].get('engine')==group['engine'] and bool(engines[0].get('version')), 'engine provenance absent')
    f779_require(receipt.get('workflow_run')==run, 'wrong run/attempt/workflow/job')
    return normalized


def f779_fold(groups, receipts):
    planned = {g['id']:g for g in groups}
    f779_require(len(planned)==len(groups) and len(receipts)==len(groups), 'missing group receipts')
    seen, results = set(), []
    for r in receipts:
        gid=r['group']
        f779_require(gid in planned and gid not in seen, 'duplicate/unknown group')
        seen.add(gid)
        g=planned[gid]
        f779_require(r.get('source')==g['source'] and r.get('cases_sha256')==g['cases_sha256']
                      and [f779_identity(x) for x in r['results']]==[f779_identity(x) for x in g['cases']]
                      and r.get('complete') is True and r.get('cleanup') is True, 'incomplete group union')
        results.extend(r['results'])
    return {'complete':True, 'passed':all(r.get('passed') is True and r.get('exit')==0 for r in receipts)
            and all(r.get('passed') is True for r in results), 'missing_groups':[], 'results':results,
            'raw_false':[r for r in results if r['passed'] is False],
            'expected_mutants':[r for r in results if r.get('expectedFailure') and r.get('mutationCaught') is True],
            'receipts':receipts, 'admitted':False}


def f779_step(union):
    return {'name':'native-compose','tool':'compose-group-union-775','passed':union['passed'],
            'exit':0 if union['passed'] else 1,'counts':{'tests':len(union['results']),'failed':len(union['raw_false'])},
            'compose_union':union,'shards':union['receipts']}


def f779_read_group(out, group, source, inventory, original, patched, producer, run, source_root):
    out=pathlib.Path(out)/'native/compose'
    read=lambda name:f779_json((out/name).read_bytes())
    f779_require(not (out/'group-timeout.json').exists(), 'terminal timeout')
    f779_require(read('group.json')==group, 'original job group differs')
    receipt=read('group-receipt.json')
    report=read('native.json')
    f779_require(report.get('originalPlannedPhases')==inventory['phases'], 'original full phase inventory differs')
    claims=set(report.get('hashes',{}))|set(report.get('sourceHashes',{}))
    f779_require(all(isinstance(p,str) and not p.startswith('/') and '..' not in pathlib.PurePosixPath(p).parts for p in claims), 'unsafe source claim')
    source_bytes={p:f779_git(source_root,'show',source['head']+':'+p) for p in claims}
    f779_job(group,receipt,report,read('source-binding.json'),read('worker-exit.json'),
              (out/'native-compose.log').read_text(),source,inventory['hashes'],original,patched,producer,run,source_bytes)
    return receipt

F779_INVENTORY = "// Browser-free source enumeration. All executable dependencies are confined to\n// vm modules; filesystem writes, process spawning, network and browser APIs are absent.\nconst vm = require('node:vm');\nconst fs = require('node:fs');\nconst path = require('node:path');\nconst cp = require('node:child_process');\nconst crypto = require('node:crypto');\nconst url = require('node:url');\nconst assert = require('node:assert/strict');\nconst acorn = {};\nnew Function('exports', 'module', process.binding('natives')['internal/deps/acorn/acorn/dist/acorn'])(acorn, {exports:acorn});\nconst ref = process.argv[2], output = process.argv[3];\nassert.match(ref, /^(input-train49|input-train50|input-train51|HEAD|[0-9a-f]{40})$/);\nconst root='/enumeration';\nconst hashes={}, transforms=[], setup=[], rows=[], phases=[];\nconst git=(rev,p)=>cp.execFileSync('git',['show',rev+':'+p]);\nconst read = (p,encoding) => {\n  p=p instanceof URL ? url.fileURLToPath(p) : p;\n  assert.ok(p.startsWith(root+'/'), 'source read outside virtual root: '+p);\n  p=p.slice(root.length+1);\n  const b=git(ref,p); hashes[p]=crypto.createHash('sha256').update(b).digest('hex');\n  return encoding ? b.toString(encoding) : b;\n};\nconst context=vm.createContext({ Buffer, URL, console: {log(){}}, __record: (phase,engine,name)=>{\n  assert.equal(typeof name,'string'); rows.push({phase,engine,name:`${engine} ${name}`});\n}, __phase: (phase,engine)=>phases.push(phase+':'+engine), __setup: x=>setup.push(x), process: {argv:['node','harness','/never-chrome','/evidence',''],env:{AIM_PLAYWRIGHT_CORE:'/never-playwright'}} });\nconst modules=new Map();\nconst fakeControl=async x=>{setup.push(x);return {status:'committed',agent:'fake-agent',actor:'fake-actor',origin:'http://enumeration.invalid',instance_id:'enumeration',result:{message_id:'fake-message'}}};\nfunction synthetic(id, values){return new vm.SyntheticModule(Object.keys(values), function(){for(const [k,v]of Object.entries(values))this.setExport(k,v)}, {context,identifier:id})}\nconst builtins={\n 'node:assert/strict':{default:assert}, 'node:path':{default:path},\n 'node:url':{fileURLToPath:url.fileURLToPath}, 'node:crypto':{createHash:crypto.createHash},\n 'node:fs/promises':{readFile:async(p,e)=>read(p,e),mkdir:async()=>{},writeFile:async()=>{},appendFile:async()=>{}},\n 'node:child_process':{spawn:()=>{throw Error('enumeration forbids spawn')}, execFileSync:(cmd,args,options)=>{\n   assert.equal(cmd,'git');\n   const hash=/^[0-9a-f]{40}$/;\n   const object=/^[0-9a-f]{40}(?:\\^\\{tree\\}|:web)$/;\n   if(args[0]==='rev-parse' && args.length===2 && args[1]==='HEAD')return cp.execFileSync('git',['rev-parse',ref],options?.encoding?{encoding:options.encoding}:{});\n   const allowed=(args[0]==='show' && args.length===2 && /^[0-9a-f^]+:[a-zA-Z0-9_./-]+$/.test(args[1])) ||\n     (args[0]==='ls-tree' && args.length===5 && args[1]==='-rz' && hash.test(args[2]) && args[3]==='--' && args[4]==='web/') ||\n     (args[0]==='rev-parse' && args.length===2 && object.test(args[1])) ||\n     (args[0]==='show' && args.length===4 && args[1]==='-s' && args[2]==='--format=%P' && hash.test(args[3]));\n   assert.ok(allowed,'enumeration refuses unreviewed Git read');\n   return cp.execFileSync('git',args,options?.encoding?{encoding:options.encoding}:{});\n }},\n 'node:vm':{default:{runInNewContext:()=>{throw Error('enumeration forbids nested VM execution')}}},\n 'node:module':{createRequire:()=>()=>{throw Error('enumeration forbids playwright load')}}\n};\nfunction edits(src,changes){for(const c of changes.sort((a,b)=>b.start-a.start)){transforms.push({start:c.start,end:c.end,reason:c.reason});src=src.slice(0,c.start)+c.text+src.slice(c.end)}return src}\nasync function load(id){\n if(modules.has(id)) return modules.get(id);\n if(builtins[id]){const m=synthetic(id,builtins[id]);modules.set(id,m);return m}\n if(id===root+'/tests/fixture_control.mjs'){\n   const m=synthetic(id,{fixtureControl:()=>({control:fakeControl,exit:Promise.resolve({code:0,signal:null}),errors:()=>''})}); modules.set(id,m);return m;\n }\n let src=read(id,'utf8');\n if(id===root+'/tests/reader_compose_native.mjs'){\n   const ast=acorn.parse(src,{ecmaVersion:'latest',sourceType:'module'}), changes=[];\n   for(const n of ast.body){\n     if(n.type==='VariableDeclaration'){\n       const name=n.declarations[0].id.name;\n       if(name==='playwright')changes.push({...n,text:'const playwright = null;',reason:'no browser dependency'});\n       if(name==='world')changes.push({...n,text:'const world = () => ({stdin:{end(){}},exitCode:null,signalCode:null});',reason:'no fixture process'});\n     }\n     if(n.type==='FunctionDeclaration' && n.id.name==='check')changes.push({...n,text:'async function check(name, action) { __record(activePhase, engine, name); }',reason:'record names, never invoke action'});\n     if(n.type==='TryStatement')changes.push({start:n.start,end:src.length,text:`let activePhase;\nawait seed();\nfor (const [phase, before] of PHASES) {\n activePhase=phase.name;\n if (before) await before();\n for (engine of ENGINES) { __phase(phase.name,engine); await phase(); }\n}`,reason:'enumerate loops only; no launch, close or pass assertion'});\n   }\n   assert.equal(changes.length,4); src=edits(src,changes);\n }\n const m=new vm.SourceTextModule(src,{context,identifier:id,initializeImportMeta(meta){meta.url=url.pathToFileURL(id).href}});\n modules.set(id,m);\n await m.link((spec,parent)=>load(spec.startsWith('.')?path.resolve(path.dirname(parent.identifier),spec):spec));\n return m;\n}\n(async()=>{const m=await load(root+'/tests/reader_compose_native.mjs'); await m.evaluate({timeout:30000});\n const keys=rows.map(x=>JSON.stringify([x.phase,x.engine,x.name]));assert.equal(new Set(keys).size,keys.length,'duplicate identity');\n fs.writeFileSync(output,JSON.stringify({parser:{node:process.version,acorn:acorn.version},kind:'enumeration-only-no-native-execution',ref,rows,phases,hashes,transforms,setup},null,2)+'\\n');console.log(JSON.stringify({ref,cases:rows.length,phases:Object.fromEntries([...new Set(rows.map(x=>x.phase+':'+x.engine))].map(p=>[p,rows.filter(x=>x.phase+':'+x.engine===p).length]))}));\n})().catch(e=>{console.error(e);process.exitCode=1});\n"
F779_INSTRUMENT = '// Preparation only: emit the explicit harness delta; never execute the harness.\nconst fs=require(\'node:fs\'),path=require(\'node:path\'),assert=require(\'node:assert/strict\');\nconst acorn={};new Function(\'exports\',\'module\',process.binding(\'natives\')[\'internal/deps/acorn/acorn/dist/acorn\'])(acorn,{exports:acorn});\nconst [source,target,deadlineModule]=process.argv.slice(2);\nlet src=fs.readFileSync(source,\'utf8\');\nconst ast=acorn.parse(src,{ecmaVersion:\'latest\',sourceType:\'module\'});\nconst edits=[];\nlet fullExpression;\nfor(const n of ast.body){\n if(n.type===\'FunctionDeclaration\' && n.id.name===\'check\'){\n  const full=n.body.body.find(x=>x.type===\'VariableDeclaration\'&&x.declarations[0].id.name===\'full\');\n  assert.ok(full,\'original full case identity absent\');\n  fullExpression=src.slice(full.declarations[0].init.start,full.declarations[0].init.end);\n  // Keep original action, native gestures, assertions and complete ending body.\n  edits.push({start:n.start,end:n.start+\'async function check\'.length,text:\'async function originalCheck775\'});\n }\n if(n.type===\'TryStatement\'){\n  let body=src.slice(n.start,n.end);\n  assert.ok(body.includes(\'await seed();\'));\n  const simple=\'try { await phase(); } finally { await browser.close(); browserClosed = true; }\';\n  const diagnostic=\'try { await phase(); } catch(error) { primary=error; }\';\n  assert.ok(body.includes(simple)||body.includes(diagnostic),\'unknown phase ending shape\');\n  body=body.replace(\'await seed();\',"await bounded775.guard({stage:\'seed\'}, group775.seed_seconds, () => seed()); fixtureObservations779.push({origin:facts.origin,instance_id:facts.instance_id},{origin:shortFacts.origin,instance_id:shortFacts.instance_id});");\n  body=body.replace(\'if (before) await before();\',"if (phase.name !== group775.phase) continue;\\n    activePhase775 = phase.name;\\n    if ([\'runSending\',\'runPencil\',\'runPencilMutants\'].includes(phase.name)) { const prerequisite = PHASES.find(([p]) => p.name === \'runAnswering\')?.[1]; if (prerequisite) await bounded775.guard({stage:\'inherited-answering-coordinator\'}, group775.seed_seconds, prerequisite); }\\n    if (before) await bounded775.guard({stage:\'phase-before\'}, group775.seed_seconds, before);");\n  body=body.replace(\'for (engine of ENGINES) {\',"for (engine of ENGINES) {\\n      if (engine !== group775.engine) continue;");\n  body=body.replace("browser = engine === \'chromium\' ? await playwright.chromium.launch({ executablePath: chrome, headless: true }) : await playwright.webkit.launch({ headless: true });", "browser = await bounded775.guard({stage:\'launch\'}, group775.launch_seconds, () => engine === \'chromium\' ? playwright.chromium.launch({ executablePath: chrome, headless: true }) : playwright.webkit.launch({ headless: true })); runtime775.push({engine,version:browser.version(),node:process.version,platform:process.platform,arch:process.arch});");\n  body=body.replace(\'try { await phase(); } finally { await browser.close(); browserClosed = true; }\', "try { await bounded775.guard({stage:\'phase-setup-and-cases\'}, group775.phase_seconds, () => phase()); } finally { await bounded775.guard({stage:\'browser-close\'}, group775.final_seconds, () => browser.close()); browserClosed = true; }");\n  if(body.includes(diagnostic)){\n    body=body.replace(diagnostic,"try { await bounded775.guard({stage:\'phase-setup-and-cases\'},group775.phase_seconds,()=>phase()); } catch(error) { primary=error; }");\n    body=body.replace(\'try { await browser.close(); browserClosed = true; } catch(error) { closing=error; }\',"try { await bounded775.guard({stage:\'browser-close\'},group775.final_seconds,()=>browser.close()); browserClosed = true; } catch(error) { closing=error; }");\n  }\n  assert.ok(body.includes(\'completedPhases.push(`${phase.name}:${engine}`);\') && body.includes(\'browserClosed, harnessCompleted, plannedPhases, completedPhases,\'), \'unknown phase/report shape\');\n  body=body.replace(\'completedPhases.push(`${phase.name}:${engine}`);\', \'completedPhases.push(`${phase.name}:${engine}/group:${group775.id}`);\');\n  body=body.replace(\'harnessCompleted = true;\', \'bounded775.finish();\\n  harnessCompleted = true;\');\n  body=body.replace(\'await Promise.all([fixtureExit, shortExit])\', "await bounded775.guard({stage:\'fixture-exit\'}, group775.final_seconds, () => Promise.all([fixtureExit, shortExit]))");\n  body=body.replace(\'browserClosed, harnessCompleted, plannedPhases, completedPhases,\', \'browserClosed, harnessCompleted: false, scope775: { fixtures: fixtureObservations779, runtime: runtime775, group: group775.id, source: group775.source, cases_sha256: group775.cases_sha256, completedCases: bounded775.completed.slice(), groupCompleted: harnessCompleted, originalWholeCompleted: false }, originalPlannedPhases: originalPlannedPhases775, plannedPhases, completedPhases,\');\n  edits.push({start:n.start,end:n.end,text:body});\n }\n if(n.type===\'VariableDeclaration\' && n.declarations[0].id.name===\'plannedPhases\'){\n  const old=src.slice(n.start,n.end);\n  edits.push({start:n.start,end:n.end,text:old.replace(\'const plannedPhases = PHASES.flatMap\', \'const originalPlannedPhases775 = PHASES.flatMap\').replace(\', completedPhases = [];\', ";\\nconst plannedPhases = [group775.phase + \':\' + group775.engine + \'/group:\' + group775.id], completedPhases = [];" )});\n }\n}\nassert.equal(edits.length,3,\'unknown compose source shape\');\nconst at=src.indexOf(\'let browserClosed = true, harnessCompleted = false\');assert.ok(at>0);\n// Initialized before all seeds and phases; closures read actual owned resources.\nconst injected=`\nlet activePhase775;\nconst group775 = JSON.parse(readFileSync775(process.env.AIM_COMPOSE_GROUP, \'utf8\'));\nconst runtime775 = [];\nconst fixtureObservations779 = [];\nconst selected775 = new Set(group775.cases.map(r=>r.name));\nconst bounded775 = new ComposeDeadline775({group:group775,evidence,\n snapshot:()=>({results:results.slice(),browserClosed,harnessCompleted:false,groupCompleted775:harnessCompleted,completedPhases:completedPhases.slice()}),\n retire:async()=>{\n   fixture.stdin.end(); shortFixture.stdin.end();\n   const closed=browser ? await browser.close().then(()=>true,()=>false) : true;\n   const exits=await Promise.all([fixtureExit,shortExit]);\n   return {browserClosed:closed,fixtures:exits};\n }});\nasync function check(name, action) {\n const full=${fullExpression};\n if(!selected775.has(full))return;\n const row=group775.cases.find(r=>r.name===full);\n if(row.phase!==activePhase775 || row.engine!==engine)throw Error(\'compose phase/engine differs\');\n await bounded775.check(row,()=>originalCheck775(name,action));\n}\n`;\n// group775 must exist before plannedPhases initialization.\nconst before=ast.body.find(n=>n.type===\'VariableDeclaration\'&&n.declarations[0].id.name===\'plannedPhases\').start;\nedits.push({start:before,end:before,text:injected});\nfor(const e of edits.sort((a,b)=>b.start-a.start))src=src.slice(0,e.start)+e.text+src.slice(e.end);\nsrc="import {readFileSync as readFileSync775} from \'node:fs\';\\nimport {ComposeDeadline as ComposeDeadline775} from "+JSON.stringify(deadlineModule)+";\\n"+src;\n// Original substring filter MUST be empty, including helper-level filtering.\nsrc=src.replace("const [chrome, evidence, filter = \'\'] = process.argv.slice(2);", "const [chrome, evidence] = process.argv.slice(2);\\nconst filter = \'\'; // exact selection is inside check; all helper setup retained");\n// Retain the observed assertion verdict; caught-mutant policy stays separate.\nassert.ok(src.split(\'r.passed=r.mutationCaught;\').length<=2,\'ambiguous mutant output\');\nsrc=src.replace(\'r.passed=r.mutationCaught;\',\'r.passed=r.observedPassed;\');\nfs.writeFileSync(target,src);\n'


def f779_validate(root, commit, provenance, shards, run, required, producer):
    source=f779_source(root,commit)
    inventory=f779_inventory(root,commit)
    groups=f779_groups(inventory,source)
    f779_plan(provenance['plan'],required,groups,root,commit)
    for name, expected in producer.items():
        f779_require(f779_hash(f779_git(root,'show',commit+':tools/'+name))==expected, 'unreviewed producer input: '+name)
    original=f779_git(root,'show',commit+':tests/reader_compose_native.mjs')
    patched=f779_patch(original)
    verified={}
    for i,job in enumerate(provenance['plan']):
        if not job.get('compose_group'):
            continue
        group=next(g for g in groups if g['id']==job['compose_group']['id'])
        expected={k:str(run[k]) for k in ('id','attempt')}
        expected.update(workflow_sha=provenance['run']['workflow_sha'],workflow_ref=provenance['run']['workflow_ref'],
                        repository=run['repository'],job=('check' if i<256 else 'check_more'),job_name=group['id'])
        verified['check-%d'%i]=f779_read_group(pathlib.Path(shards)/('check-%d'%i),group,source,inventory,original,patched,producer,expected,root)
    return verified, f779_step(f779_fold(groups,list(verified.values())))

F779_PRODUCER = {'forward_plan.py': '1d63c691ae83285cc112df8d1352e2f7599acdc9c10bff7e622fb5e129c80931', 'compose_forward.py': 'd02724fe65e60bf084b82fd532c14139fcec5323fa8f0a01f8f44aad4a3b4de3', 'compose_groups.py': '8de720f633adc74d55e60117ae67f596762167768ed8dd9fa8196c39716b504b', 'compose_inventory.cjs': '1906308eeb001a66d44655760c4136873ad462a26f2efe12d670eb0287319d95', 'compose_instrument.cjs': 'bc9e6a5c42fd124db65edd887e919293e7bca2a8ba40bb38df61c02b40970a2d', 'compose_deadline_775.mjs': '3a2ac81d7002b89ab22de1fbbd3017716ec951bda0e9f3984227cbfddb42ca45', 'compose_worker_775.mjs': '8f618de667df4f4a0be502cb4c4b39cd25b689ffcb8eaa3c1989dfb4eb40871f', 'run_compose_group.py': '9ee606169207bed5ddc121949d2d483719701f9779d603984781e5b6fd8301bb'}

if __name__ == '__main__':
    raise SystemExit(main())

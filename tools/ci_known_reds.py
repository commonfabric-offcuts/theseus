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

def cases(step, out):
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
        require(type(report.get('fixtureExitCode')) is int and report['fixtureExitCode'] == 0,
                name + ': fixture cleanup failed')
        require(report.get('fixtureExitSignal') is None, name + ': fixture was signalled')
        if counts['fail']:
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

def unit_evidence(step, out):
    name = step['name']
    text = (out / (name + '.log')).read_text()
    counts, good = node_counts(text) if name == 'node-units' else python_counts(text)
    require(good and step.get('counts') == counts, 'non-browser log/count mismatch')
    require(not any(counts.get(k, 0) for k in ('skipped', 'todo', 'cancelled', 'expected failures', 'unexpected successes')),
            name + ': unapproved skipped, todo or incomplete checks')
    if name == 'node-units':
        require(counts.get('pass', 0) == counts['tests'] > 0, name + ': not every planned check passed')
    rows = unit_records(text, node=name == 'node-units')
    require(len(rows) == counts['tests'] and all(status == 'ok' for _, status in rows),
            name + ': unapproved skipped/todo or missing individual check outcomes')
    actual = Counter(key(row) for row, _ in rows)
    require(all(n == 1 for n in actual.values()), name + ': duplicate executed identity')

def producer_binding(path, environ):
    """Bind original PR or release-branch push evidence to the protected event."""
    record = read_json(path)
    event = read_json(environ.get('GITHUB_EVENT_PATH', ''))
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
        pr = p['pull_request']
        prs = [r for r in observed.get('pull_requests',[]) if r.get('number') == pr['number']]
        require(p['head_sha'] == pr['head_sha'] and len(prs) == 1 and prs[0]['head']['sha'] == pr['head_sha']
                and prs[0]['base']['sha'] == pr['base_sha'], 'PR base/head is not authenticated by controller event')
        base = {'ref':pr['base_ref'],'sha':pr['base_sha']}
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
        steps = shard['steps']
        result.append(steps.split(',') if isinstance(steps, str) else steps)
    return result

def python_counts(text):
    ran = re.findall(r"^Ran (\d+) tests? in ", text, re.M)
    status = re.findall(r"^(OK|FAILED)(?: \((.*)\))?$", text, re.M)
    counts = {"tests": int(ran[-1]) if ran else 0, "status": status[-1][0] if status else None}
    for part in (status[-1][1].split(", ") if status and status[-1][1] else []):
        key, _, value = part.partition("=")
        counts[key] = int(value)
    passed = counts["tests"] > 0 and counts["status"] == "OK"
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


@contextmanager
def catalog_context(root,commit):
    catalog = source_catalog(root,commit)
    previous = {name:globals()[name] for name in catalog}
    globals().update(catalog)
    try:
        yield catalog
    finally:
        globals().update(previous)


def read_evidence(summary_path, provenance_path, shards, root, commit, run, base, expected_merge, binding=None, history=False):
    with catalog_context(root,commit):
        return _read_evidence(summary_path,provenance_path,shards,root,commit,run,base,expected_merge,binding,history)


def _read_evidence(summary_path, provenance_path, shards, root, commit, run, base, expected_merge, binding=None, history=False):
    candidate_root = root
    traffic = json.loads(source(root,commit,REPLAY_FILE)) if 'wake-replay' in REQUIRED else None
    provenance, summary = read_json(provenance_path), read_json(summary_path)
    same_run(provenance.get('run'), run)
    require(provenance.get('base') == base, 'wrong API event base')
    require(provenance.get('merge') == expected_merge, 'wrong tested merge or tree')
    if binding is not None:
        require(provenance.get('head') == receipt_head(binding),
                'combined head differs from authenticated producer')
    require(provenance.get('checked') == {'commit': commit, 'tree_unchanged': True}, 'dirty combined source')
    require(unique(provenance['required'], 'provenance steps') == set(REQUIRED), 'incomplete provenance')
    require(summary.get('tool') == TOOL and summary.get('commit') == commit, 'wrong combined source')
    require(summary.get('tree_unchanged') is True and summary.get('tree_after') == {'head': commit, 'changes': ''}, 'dirty combined source')
    require('only' not in summary and not summary.get('skipped'), 'focused or skipped aggregate')
    require(unique(summary['required'], 'summary required steps') == set(REQUIRED), 'incomplete summary plan')
    combined = summary['steps']
    require(unique([s['name'] for s in combined], 'combined steps') == set(REQUIRED), 'missing required step')
    by_name = {s['name']: s for s in combined}
    plan = plan_steps(provenance['plan'])
    require(Counter(s for shard in plan for s in shard) == Counter(REQUIRED), 'incomplete or duplicated shard plan')
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
            require(step == by_name[step['name']], 'aggregate step differs from original shard')
            ran.append(step['name'])
            if step['name'] in NATIVE:
                observed.append((step['name'], cases(step, out), profile, raw['checkout']))
            else:
                if history and step.get('passed') is False:
                    nonbrowser_failure_evidence(step, out)
                    continue
                require(step.get('passed') is True and type(step.get('exit')) is int and step['exit'] == 0,
                        step['name'] + ': non-browser failure cannot be excepted')
                # Recompute unit/deploy verdicts from raw logs; a claimed green
                # summary alone does not establish that any checks ran.
                if step['name'] in ('python-units', 'deploy-refusals', 'node-units'):
                    unit_evidence(step, out)
                elif step['name'] == 'wake-replay':
                    replay_evidence(step, out, traffic)
        require(raw['required'] == summary['required'], 'shard required plan differs')
    require(Counter(ran) == Counter(REQUIRED), 'incomplete whole-run coverage')
    require(unique(summary.get('failed'), 'combined failures') ==
            {s['name'] for s in combined if s['passed'] is not True}, 'combined failure union differs')
    require(summary.get('passed') is all(s.get('passed') is True for s in combined), 'inconsistent raw aggregate verdict')
    return observed, summary

def nonbrowser_failure_evidence(step, out):
    """A base run's unrelated unit/replay red never becomes a train exemption.

    Still verify that it is a complete raw failure, not a crashed/missing run.
    Candidate non-browser checks continue to require a pass.
    """
    name = step['name']
    require(type(step.get('exit')) is int and step['exit'] == 1, name + ': abnormal base failure exit')
    if name in ('python-units', 'node-units', 'deploy-refusals'):
        text = (out / (name+'.log')).read_text()
        counts, good = node_counts(text) if name == 'node-units' else python_counts(text)
        require(not good and counts == step.get('counts') and counts.get('tests',0) > 0, name + ': invalid base failure counts')
        rows = unit_records(text, node=name == 'node-units')
        require(len(rows) == counts['tests'], name + ': incomplete base unit log')
        return
    require(name == 'wake-replay', 'unknown non-browser base failure')
    runs = step.get('runs')
    require(isinstance(runs,list) and bool(runs), 'wake-replay: missing base runs')
    replay_runs = []
    for number, run in enumerate(runs, 1):
        counts, good = replay_counts(out/'replay'/('candidate-%d'%number))
        require(good and type(run.get('exit')) is int and run['exit'] in (0,1), 'wake-replay: incomplete base report')
        require((out/('wake-replay-candidate-%d.log'%number)).is_file(), 'wake-replay: missing base log')
        replay_runs.append(dict(run,counts=counts))
    recalculated = replay_step(replay_runs,step.get('started_at'))
    require(step.get('counts') == recalculated['counts'] and step.get('series') == recalculated['series'], 'wake-replay: base counts differ')


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
            try:
                fp = fingerprint(row.get('error'), checkout, root, commit)
                item.update(fingerprint=fp, profile=profile_identity(profile))
            except Refused as error:
                item['fingerprint_problem'] = str(error)
            failures.append(item)
    return failures, mutations


def compare_failures(failures, known):
    expected, unexpected = [], []
    for item in failures:
        matches = [old for old in known if 'fingerprint' in item and 'fingerprint' in old
                   and (old['step'], key(old['case']), old['fingerprint'], old['profile']) ==
                       (item['step'], key(item['case']), item['fingerprint'], item['profile'])]
        if matches:
            expected.append(dict(item, base_shown=True, cleared=True, matched_base_runs=sorted({r['run_id'] for r in matches})))
        else:
            unexpected.append(dict(item, base_shown=False, cleared=False, reason=item.get('fingerprint_problem') or 'not shown by recent base runs'))
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


def known_base_failures(manifest_path, root, base, producer):
    manifest_path = Path(manifest_path).resolve()
    doc = read_json(manifest_path)
    require(doc.get('base_ref') == base['ref'], 'known runs belong to another base branch')
    head = doc.get('base_head')
    require(isinstance(head, str) and SHA.fullmatch(head), 'known runs lack base branch head')
    require(subprocess.run(['git','-C',str(root),'merge-base','--is-ancestor',base['sha'],head], capture_output=True).returncode == 0,
            'known-run branch head does not contain authenticated base')
    require(isinstance(doc.get('query'), str) and bool(doc['query']), 'known runs lack API query provenance')
    runs = doc.get('runs')
    require(isinstance(runs, list) and len(runs) <= 3, 'known runs must be the last three or fewer')
    require(doc.get('fewer_than_three') is (len(runs) < 3), 'known-run count disclosure disagrees')
    require(len({r['id'] for r in runs}) == len(runs), 'duplicate known run')
    require(runs == sorted(runs, key=lambda r:(r['created_at'],int(r['id'])), reverse=True), 'known runs not newest first')
    known, records = [], []
    for api in runs:
        run_id, sha = api['id'], api['head_sha']
        require(type(run_id) is int and run_id > 0 and api.get('run_attempt') == 1, 'known run is not a first attempt')
        require(api.get('event') == 'push' and api.get('head_branch') == base['ref'], 'known run is not a base push')
        require(api.get('conclusion') in ('success','failure'), 'known run is cancelled or incomplete')
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
        observed, summary = read_evidence(folder/'release-check/summary.json', folder/'release-check/provenance.json', folder/'shards', root, sha, run, {'ref':None,'sha':None}, merge, history=True)
        for shard in provenance['shards']:
            receipt = shard['receipt']
            require(receipt.get('head') == provenance['head'], 'known shard head differs from API')
            data = receipt['run']
            require(data.get('workflow_sha') == sha and data.get('workflow_ref') == '%s/%s@refs/heads/%s' % (producer['head_repository'],PRODUCER_WORKFLOW,base['ref']), 'known shard workflow source differs from API')
        failures, mutations = failure_records(observed,root,sha,run_id)
        known.extend(failures)
        records.append({'id':run_id,'head_sha':sha,'created_at':api['created_at'],'native_failures':len(failures),'raw_passed':summary['passed'],'artifacts':artifacts,'mutation_advisories':mutations})
    return known, records


def validate(summary_path, provenance_path, shards, base_root, candidate_root, producer_path, known_runs, environ=None):
    environ = os.environ if environ is None else environ
    run, base, commit, binding = producer_binding(producer_path, environ)
    controller_commit = binding['controller']['workflow_sha']
    require((ROOT/'tools/ci_known_reds.py').read_bytes() == source(ROOT,controller_commit,'tools/ci_known_reds.py'), 'validator is not controller commit code')
    tree = clean_checkout(candidate_root,commit,binding['merge']['tree'])
    clean_checkout(base_root,base['sha'])
    parents = git(candidate_root,'rev-list','--parents','-n','1',commit).decode().split()[1:]
    require(parents == [p for p in (binding['merge']['first_parent'],binding['merge'].get('second_parent')) if p], 'tested parents differ from protected record')
    expected_merge = {'sha':commit,'tree':tree,'first_parent':parents[0],'second_parent':parents[1] if len(parents)>1 else None}
    contained_evidence(Path(shards))
    raw_base = {'ref':None,'sha':None} if run['event'] == 'push' else base
    observed, summary = read_evidence(summary_path,provenance_path,shards,candidate_root,commit,run,raw_base,expected_merge,binding)
    known, base_runs = known_base_failures(known_runs,candidate_root,base,binding['producer'])
    failures, mutations = failure_records(observed,candidate_root,commit,run['id'])
    result = compare_failures(failures,known)
    require(not summary['passed'] or binding['producer']['conclusion'] == 'success', 'producer failed outside reported checks')
    result.update(run=run,base=base,merge=expected_merge,raw_passed=summary['passed'],producer=binding['producer'],controller=binding['controller'],status_head_sha=binding['producer']['head_sha'],known_base_runs=base_runs,mutation_advisories=mutations,test_definition_changes=test_definition_changes(candidate_root,base['sha'],commit),runtime_code_paths=[str(Path(__file__).resolve())],known_policy='last-three-base-push-runs',train=train_identity(candidate_root,commit,binding))
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


if __name__ == '__main__':
    raise SystemExit(main())

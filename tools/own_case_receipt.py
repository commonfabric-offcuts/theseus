from __future__ import annotations

"""Read the known genuine Pool schema without executing candidate source.

Only exact reviewed source bytes authorize interpretation. Raw originals remain
Refs; command and neutral identities are explicitly derived, never raw fields.
"""
from collections import Counter
import io
from datetime import datetime
import re
import tarfile
import tempfile
from pathlib import Path
import zipfile

from tools import base_move as b, ci_known_reds as ci

WORKFLOW = '.github/workflows/pool.yml'
SPEC = '.github/pool-run.json'
# Reviewed original code at c4af1c6, not the installed validator or a manifest
# override. Any other command/harness convention needs a new reviewed adapter.
SOURCES = {
    WORKFLOW: 'f5cfaa27bccf2348d7024a5bbfdf00e4a724b281cd7680ea16ddd0a226fd9faa',
    'tools/native.py': '2aa3f4ea33eefd5e2e9c9bf81c112078f95d90817ad25a52d6224db36f5ea73e',
    'tools/release_check.py': 'f59a8689f461366e4582783cf553c0d826a9331ab41876ea33cd2934721ffef3',
    'tests/thumbnail_open_native.mjs': '77c7e28ae2288811115c191906ca20e253974c0098dae83a69bf2331169e5fa0',
    'tests/reader_compose_native.mjs': '5c2a6b88fb9068fe32adc4a199101a2ecd4e4bc622dcdf738bbf3c6457589cac',
}
MEMBERS = ('cases.json', 'c1.log', 'c1/native-compose.log', 'c1/evidence/native.json')
JOB_STEPS = ['Set up job', 'Run actions/checkout@v4', 'Run actions/setup-node@v4',
             "Chrome for Testing and Playwright's WebKit", 'The cases', 'Keep the evidence',
             'Post Run actions/setup-node@v4', 'Post Run actions/checkout@v4', 'Complete job']


def source_bytes(git, head, paths):
    with tempfile.TemporaryDirectory(prefix='own-receipt-source-') as temp:
        target = Path(temp) / 'source.tar'
        b.ask(git, 'archive', '--format=tar', '--output=' + str(target), head, '--', *paths)
        with tarfile.open(str(target)) as archive:
            result = {}
            for path in paths:
                member = archive.getmember(path)
                b.require(member.isfile(), 'Pool source is not a file')
                with archive.extractfile(member) as handle:
                    result[path] = handle.read()
            return result


def api_fact(binding, key, github, repository, path):
    saved = b.document(binding['api'][key])
    actual = github.get('repos/' + repository + '/' + path)
    b.require(b.canonical(saved) == b.canonical(actual), 'Pool retained API ' + key + ' differs')
    return saved


def validate(receipt, git, github, repository, assembly, assembly_tree, expected):
    b.fields(receipt, 'snapshot step report log pool')
    binding = b.fields(b.document(receipt['pool']), 'version run attempt wrapper artifact api record')
    b.require(type(binding['version']) is int and binding['version'] == 1, 'unknown Pool receipt version')
    b.number(binding['run']); b.number(binding['attempt']); b.sha(binding['wrapper'])
    b.fields(binding['artifact'], 'id archive'); b.number(binding['artifact']['id'])
    b.fields(binding['api'], 'run workflow jobs artifact')
    run_id, attempt, wrapper = binding['run'], binding['attempt'], binding['wrapper']
    run = api_fact(binding, 'run', github, repository, 'actions/runs/%d' % run_id)
    b.require(type(run.get('id')) is int and run['id'] == run_id
              and type(run.get('run_attempt')) is int and run['run_attempt'] == attempt
              and run.get('head_sha') == wrapper and run.get('name') == 'Pool'
              and run.get('path') == WORKFLOW and run.get('event') == 'push'
              and run.get('status') == 'completed' and run.get('conclusion') == 'success'
              and run.get('repository', {}).get('full_name') == repository
              and run.get('head_repository', {}).get('full_name') == repository, 'Pool run identity differs')
    b.number(run['workflow_id'])
    workflow = api_fact(binding, 'workflow', github, repository, 'actions/workflows/%d' % run['workflow_id'])
    b.require(workflow.get('id') == run['workflow_id'] and workflow.get('name') == 'Pool'
              and workflow.get('path') == WORKFLOW, 'Pool workflow identity differs')
    jobs = api_fact(binding, 'jobs', github, repository, 'actions/runs/%d/attempts/%d/jobs' % (run_id, attempt))
    b.require(type(jobs.get('total_count')) is int and jobs['total_count'] == 1
              and isinstance(jobs.get('jobs'), list) and len(jobs['jobs']) == 1, 'Pool job inventory differs')
    job = jobs['jobs'][0]; b.number(job['id'])
    b.require(job.get('run_id') == run_id and job.get('run_attempt') == attempt
              and job.get('head_sha') == wrapper and job.get('head_branch') == run['head_branch']
              and job.get('name') == run['head_branch'] and job.get('workflow_name') == 'Pool'
              and job.get('status') == 'completed' and job.get('conclusion') == 'success'
              and job.get('labels') == ['macos-26'], 'Pool job identity differs')
    steps = job.get('steps')
    b.require(isinstance(steps, list) and [s.get('name') for s in steps] == JOB_STEPS
              and all(s.get('status') == 'completed' and s.get('conclusion') == 'success' for s in steps),
              'Pool job steps incomplete')
    meta = api_fact(binding, 'artifact', github, repository, 'actions/artifacts/%d' % binding['artifact']['id'])
    raw_zip = b.artifact(binding['artifact']['archive'])
    upload = steps[5]
    created = datetime.fromisoformat(meta['created_at'].replace('Z', '+00:00'))
    started = datetime.fromisoformat(upload['started_at'].replace('Z', '+00:00'))
    finished = datetime.fromisoformat(upload['completed_at'].replace('Z', '+00:00'))
    b.require(started <= created <= finished, 'Pool artifact attempt/upload differs')
    b.require(meta.get('id') == binding['artifact']['id'] and meta.get('name') == 'pool'
              and meta.get('expired') is False and meta.get('digest') == 'sha256:' + b.digest(raw_zip)
              and meta.get('workflow_run', {}).get('id') == run_id
              and meta['workflow_run'].get('head_sha') == wrapper
              and meta['workflow_run'].get('head_branch') == run['head_branch']
              and meta['workflow_run'].get('repository_id') == run['repository']['id']
              and meta['workflow_run'].get('head_repository_id') == run['head_repository']['id'],
              'Pool artifact provenance differs')
    b.require(b.parents(git, wrapper) == [assembly], 'Pool wrapper parent differs')
    before, after = b.entries(git, assembly), b.entries(git, wrapper)
    changed = {p for p in set(before) | set(after) if before.get(p) != after.get(p)}
    b.require(changed == {WORKFLOW, SPEC} and WORKFLOW not in before and SPEC not in before
              and all(after[p].startswith('100644 blob ') for p in changed), 'Pool wrapper tree differs')
    sources = source_bytes(git, wrapper, list(SOURCES) + [SPEC])
    for path, expected_digest in SOURCES.items():
        b.require(b.digest(sources[path]) == expected_digest, 'Pool executed source/command differs: ' + path)
    spec = b.fields(b.loads(sources[SPEC]), 'step cases label snapshot')
    b.require(spec['snapshot'] == assembly and b.tree(git, assembly) == assembly_tree, 'Pool spec snapshot differs')
    b.require(spec['step'] == 'compose' and isinstance(spec['cases'], list) and len(spec['cases']) == 1
              and spec['cases'][0] == 'item 651'
              and isinstance(spec['label'], str) and re.fullmatch(r'[A-Za-z0-9._-]{1,80}', spec['label']),
              'Pool spec step/filter differs')
    case_filter = spec['cases'][0]
    b.require(run['head_branch'] == 'pool/%s-%s' % (spec['label'], assembly[:10]), 'Pool spec branch differs')
    record = b.fields(b.document(binding['record']),
                      'run branch pool_commit snapshot changed pushed_at run_created jobs')
    local_run = b.fields(record['run'], 'conclusion createdAt databaseId headBranch headSha status url workflowName')
    b.require(local_run == {'conclusion': run['conclusion'], 'createdAt': run['created_at'],
                           'databaseId': run_id, 'headBranch': run['head_branch'], 'headSha': wrapper,
                           'status': run['status'], 'url': run['html_url'], 'workflowName': 'Pool'}
              and record['branch'] == run['head_branch'] and record['pool_commit'] == wrapper
              and record['snapshot'] == assembly and record['changed'] == []
              and record['run_created'] == run['created_at']
              and record['jobs'] == [{'name': job['name'], 'started': job['started_at'],
                                      'completed': job['completed_at'], 'conclusion': 'success'}],
              'Pool original record differs')
    pushed = datetime.strptime(record['pushed_at'], '%Y-%m-%dT%H:%M:%S%z')
    b.require(pushed <= datetime.fromisoformat(run['created_at'].replace('Z', '+00:00')),
              'Pool original record time differs')
    snap = b.fields(b.document(receipt['snapshot']),
                    'commit checkout where tree_unchanged snapshot_changes tree_before tree_after')
    b.require(snap['commit'] == assembly and snap['where'] == 'pool' and snap['tree_unchanged'] is True
              and snap['snapshot_changes'] == [] and isinstance(snap['checkout'], str) and Path(snap['checkout']).is_absolute(),
              'Pool snapshot differs or dirty')
    for key in ('tree_before', 'tree_after'):
        b.fields(snap[key], 'head changes')
        b.require(snap[key] == {'head': assembly, 'changes': ''}, 'Pool snapshot differs or dirty')
    with zipfile.ZipFile(io.BytesIO(raw_zip)) as archive:
        names = archive.namelist()
        b.require(len(names) == len(set(names)), 'duplicate Pool archive member')
        for name in names:
            b.safe_path(name)
        b.require(all(n in names for n in MEMBERS)
                  and not any(re.match(r'c[0-9]+(?:/|\.log$)', n) and not n.startswith(('c1/', 'c1.log')) for n in names),
                  'Pool execution archive inventory differs')
        contents = {name: archive.read(name) for name in MEMBERS}
    for key, member in [('step', 'c1.log'), ('log', 'c1/native-compose.log'), ('report', 'c1/evidence/native.json')]:
        b.require(b.artifact(receipt[key]) == contents[member], 'Pool raw ' + key + ' differs from archive')
    executions = b.loads(contents['cases.json'])
    b.require(isinstance(executions, list) and len(executions) == 1, 'Pool single execution missing')
    b.fields(executions[0], 'case exit')
    b.require(executions[0]['case'] == case_filter and type(executions[0]['exit']) is int
              and executions[0]['exit'] == 0, 'Pool execution filter/exit differs')
    stdout = contents['c1.log'].decode().splitlines()
    b.require(len(stdout) == 2 and stdout[1] == 'compose exit 0 /Users/runner/work/_temp/pool/c1',
              'Pool native command/exit stdout differs')
    step = b.fields(b.loads(stdout[0]), 'name exit passed counts')
    b.require(step['name'] == 'native-compose' and type(step['exit']) is int and step['exit'] == 0
              and step['passed'] is True, 'Pool raw step/exit differs')
    report = b.fields(b.loads(contents['c1/evidence/native.json']),
                      'results browserClosed harnessCompleted plannedPhases completedPhases fixtureExitCode fixtureExitSignal fixtureErrors shortFixture measured shots')
    b.require(ci.compose_completed(report) and report['fixtureErrors'] == '', 'Pool phase or teardown differs')
    short = b.fields(report['shortFixture'], 'exitCode exitSignal errors')
    b.require(type(short['exitCode']) is int and short['exitCode'] == 0 and short['exitSignal'] is None
              and short['errors'] == '', 'Pool short fixture teardown differs')
    b.require(report['measured'] == [] and isinstance(report['shots'], list)
              and all(isinstance(s, str) for s in report['shots']), 'Pool unsupported measurement schema')
    rows = report['results']
    b.require(isinstance(rows, list) and bool(rows), 'Pool missing raw cases')
    for row in rows:
        b.fields(row, 'name passed ms')
        b.require(isinstance(row['name'], str) and bool(row['name']) and row['passed'] is True
                  and type(row['ms']) is int and row['ms'] >= 0, 'Pool raw case failed or invalid')
    counts = {'tests': len(rows), 'pass': len(rows), 'fail': 0, 'failed': [], 'browser_closed': True}
    b.require(b.canonical(step['counts']) == b.canonical(counts), 'Pool raw count differs')
    lines = contents['c1/native-compose.log'].decode().splitlines()
    wanted_lines = []
    mutation_names = ('no-new-tab', 'strip-not-forwarded', 'no-keyboard-open',
                      'first-touch-intercepted-mutant', 'thumbnail-edits-card')
    for row in rows:
        for engine in ('chromium', 'webkit'):
            for mutation in mutation_names:
                if row['name'] == '%s item 651 applied mutant %s and restored source' % (engine, mutation):
                    failure = ('the thumbnail does not edit its card' if mutation == 'thumbnail-edits-card' else
                               'thumbnail opens a new tab: browserContext.waitForEvent: Timeout 5000ms exceeded while waiting for event "page"')
                    wanted_lines.append('CAUGHT item 651 %s %s: %s' % (engine, mutation, failure))
        wanted_lines.append('PASS ' + row['name'])
    b.require(lines == wanted_lines + ['%d passed, 0 failed' % len(rows)],
              'Pool raw PASS lines/count differ')
    # Only now interpret the prefix, established by the exact executed harness
    # check(full = `${engine} ${name}`), ENGINES and completed browser phases.
    keys = []
    for row in rows:
        match = re.fullmatch(r'(chromium|webkit) (\S.*)', row['name'])
        b.require(match is not None, 'Pool unknown engine prefix')
        engine, name = match.groups()
        b.require(any(part in row['name'] for part in case_filter.split('|')), 'Pool case filter differs')
        keys.append(('native-compose', name, None, engine))
    b.require(len(keys) == len(set(keys)), 'duplicate Pool case identity')
    by_engine = {e: {k[1] for k in keys if k[3] == e} for e in ('chromium', 'webkit')}
    b.require(bool(by_engine['chromium']) and by_engine['chromium'] == by_engine['webkit'], 'Pool incomplete engine identities')
    selected = [k for k in expected if k[0] == 'native-compose']
    b.require(Counter(keys) == Counter(selected), 'Pool own-case obligations differ')
    inputs = {p: b.ask(git, 'rev-parse', '--verify', assembly + ':' + p).strip() for p in SOURCES if p != WORKFLOW}
    return keys, {'run': run_id, 'attempt': attempt, 'wrapper': wrapper, 'job': job['id'],
                  'artifact': binding['artifact'], 'api': binding['api'], 'record': binding['record'],
                  'originals': {k: receipt[k] for k in ('snapshot', 'step', 'report', 'log', 'pool')},
                  'raw': step,
                  'derived': {'schema': 'pool-compose-prefix-v1', 'snapshot': {'head': assembly, 'tree': assembly_tree, 'inputs': inputs},
                              'source_sha256': dict(SOURCES),
                              'command': {'driver': 'tools/native.py', 'step': 'compose', 'filter': case_filter,
                                          'harness': 'tests/reader_compose_native.mjs', 'flags': [],
                                          'dynamic_paths': 'node/chrome/playwright from workflow environment; output RUNNER_TEMP/pool/c1'},
                              'identity_rule': 'remove exact engine prefix; phase remains null',
                              'engine_counts': {e: len(by_engine[e]) for e in by_engine}}}

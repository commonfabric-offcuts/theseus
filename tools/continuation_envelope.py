from __future__ import annotations

"""Authenticate a cut train's original evidence plus authorized missing modes.

No candidate code is imported or executed. See docs/continuation-envelope.md.
Coverage, raw verdict, attribution and own acceptance are separate facts.
"""
from collections import Counter
from datetime import datetime
import io
from pathlib import Path
import re
import tarfile
import tempfile
import zipfile

from tools import base_move as b, ci_known_reds as ci, release_check as check

WORKFLOW = '.github/workflows/checks.yml'


def git_bytes(git, head, path):
    # Archive preserves bytes that a text-mode git adapter would normalize.
    b.safe_path(path)
    with tempfile.TemporaryDirectory(prefix='continuation-source-') as temp:
        target = Path(temp) / 'source.tar'
        b.ask(git, 'archive', '--format=tar', '--output=' + str(target), head, '--', path)
        with tarfile.open(str(target)) as archive:
            member = archive.getmember(path)
            b.require(member.isfile(), 'continuation source is not a file')
            with archive.extractfile(member) as handle:
                return handle.read()


def run_fact(binding, github, repository, head, event, grouped=False):
    b.number(binding['run']); b.number(binding['attempt'])
    run = github.get('repos/%s/actions/runs/%d' % (repository, binding['run']))
    b.require(type(run.get('id')) is int and run['id'] == binding['run']
              and type(run.get('run_attempt')) is int and run['run_attempt'] == binding['attempt']
              and run.get('head_sha') == head and run.get('event') == event
              and run.get('name') == 'Checks' and run.get('path') == WORKFLOW
              and run.get('repository', {}).get('full_name') == repository
              and run.get('head_repository', {}).get('full_name') == repository,
              'continuation run identity differs')
    b.require(run.get('status') == 'completed' and run.get('conclusion') in
              ('success', 'failure', 'cancelled', 'timed_out'), 'continuation pending or refused run')
    b.number(run['workflow_id'])
    workflow = github.get('repos/%s/actions/workflows/%d' % (repository, run['workflow_id']))
    b.require(workflow.get('id') == run['workflow_id'] and workflow.get('path') == WORKFLOW
              and workflow.get('name') == 'Checks', 'continuation workflow identity differs')
    jobs = github.get('repos/%s/actions/runs/%d/attempts/%d/jobs?per_page=100' %
                      (repository, binding['run'], binding['attempt']))
    if grouped:
        # Explicit bounded group route only. V1 still requires its single
        # complete page, exactly as before. Authenticate every subsequent page.
        total = jobs.get('total_count')
        b.require(type(total) is int and 0 < total <= 512 and isinstance(jobs.get('jobs'), list)
                  and len(jobs['jobs']) == min(total, 100), 'grouped incomplete first job page')
        complete = list(jobs['jobs'])
        for page in range(2, (total + 99) // 100 + 1):
            part = github.get('repos/%s/actions/runs/%d/attempts/%d/jobs?per_page=100&page=%d' %
                              (repository, binding['run'], binding['attempt'], page))
            b.require(type(part.get('total_count')) is int and part['total_count'] == total
                      and isinstance(part.get('jobs'), list)
                      and len(part['jobs']) == min(100, total - len(complete)), 'grouped incomplete subsequent job page')
            complete.extend(part['jobs'])
        jobs = {'total_count': total, 'jobs': complete}
    b.require(type(jobs.get('total_count')) is int and isinstance(jobs.get('jobs'), list)
              and jobs['total_count'] == len(jobs['jobs']), 'continuation incomplete job page')
    by_id = {}
    for job in jobs['jobs']:
        b.number(job['id'])
        b.require(job['id'] not in by_id and job.get('run_id') == binding['run']
                  and job.get('run_attempt') == binding['attempt'] and job.get('head_sha') == head
                  and job.get('status') == 'completed', 'continuation job identity differs')
        by_id[job['id']] = job
    return run, by_id


def stamp(value):
    return datetime.fromisoformat(value.replace('Z', '+00:00'))


def archives(binding, github, repository, run, jobs, prefix, root):
    b.require(isinstance(binding['archives'], list) and bool(binding['archives']), 'continuation missing archives')
    contents, placements, ids = {}, {}, set()
    for ref in binding['archives']:
        b.fields(ref, 'id name job archive'); b.number(ref['id'])
        name = ref['name']
        b.require(isinstance(name, str) and re.fullmatch(r'(check-[0-9]+|release-check)', name)
                  and name not in placements and ref['id'] not in ids, 'continuation duplicate or invalid archive')
        ids.add(ref['id']); placements[name] = ref['job']
        raw = b.artifact(ref['archive'])
        meta = github.get('repos/%s/actions/artifacts/%d' % (repository, ref['id']))
        wr = meta.get('workflow_run') or {}
        b.require(meta.get('id') == ref['id'] and meta.get('name') == name and meta.get('expired') is False
                  and meta.get('digest') == 'sha256:' + b.digest(raw)
                  and wr.get('id') == run['id'] and wr.get('head_sha') == run['head_sha']
                  and wr.get('head_branch') == run['head_branch']
                  and wr.get('repository_id') == run['repository']['id']
                  and wr.get('head_repository_id') == run['head_repository']['id'], 'continuation artifact provenance differs')
        if name == 'release-check':
            b.require(ref['job'] is None, 'continuation aggregate job differs')
            candidates = [j for j in jobs.values() if j.get('name') == "the whole run's summary"]
            b.require(len(candidates) == 1, 'continuation aggregate job missing')
            job = candidates[0]
        else:
            b.number(ref['job'])
            b.require(ref['job'] in jobs, 'continuation archive job missing')
            job = jobs[ref['job']]
        upload_name = "Keep the whole run's summary" if name == 'release-check' else 'Keep the evidence'
        uploads = [s for s in job.get('steps', []) if s.get('name') == upload_name
                   and s.get('status') == 'completed' and s.get('conclusion') == 'success']
        b.require(len(uploads) == 1 and stamp(uploads[0]['started_at']) <= stamp(meta['created_at'])
                  <= stamp(job['completed_at']), 'continuation artifact attempt/upload differs')
        with zipfile.ZipFile(io.BytesIO(raw)) as archive:
            names = archive.namelist()
            b.require(len(names) == len(set(names)), 'continuation duplicate ZIP member')
            for member in names:
                if member.endswith('/'):
                    b.safe_path(member[:-1]); continue
                b.safe_path(member)
                # Never extract ZIP paths, symlinks or executable candidate code.
                # Preserve named report/log/source bytes only; caches/images are opaque.
                if '/pyc/' in '/' + member or member.startswith('pyc/'):
                    continue
                if member.endswith(('.json', '.log')) or '/source/' in '/' + member:
                    key = prefix + name + '/' + member
                    value = archive.read(member)
                    contents[key] = value
                    target = root / key
                    target.parent.mkdir(parents=True, exist_ok=True)
                    target.write_bytes(value)
    return contents, placements


def clean_summary(raw, receipt, data, commit, git):
    steps = raw.get('steps')
    b.require(isinstance(steps, list) and bool(steps), 'continuation missing completed steps')
    selected = [s['name'] for s in steps]
    b.require(raw.get('tool') == check.TOOL and raw.get('commit') == commit
              and raw.get('tree_unchanged') is True and raw.get('tree_after') == {'head': commit, 'changes': ''}
              and raw.get('only') == selected == data and not raw.get('skipped') and not raw.get('scoped')
              and Counter(raw.get('required', [])) == Counter(check.REQUIRED), 'continuation dirty or partial summary')
    b.require(raw.get('passed') is all(s.get('passed') is True for s in steps), 'continuation raw verdict differs')
    tools = raw.get('tools') or {}
    b.require(tools.get('release_check') == b.ask(git, 'rev-parse', '--verify', commit + ':tools/release_check.py').strip(),
              'continuation release-check hash differs')
    for path in check.harnesses():
        b.require(tools.get('harnesses', {}).get(path) == b.ask(git, 'rev-parse', '--verify', commit + ':' + path).strip(),
                  'continuation harness hash differs')
    return steps


def report_assignment(contents, prefix, selected):
    present = {name for name, native in ci.NATIVE.items()
               if prefix + '/native/' + native.name + '/' + native.results in contents}
    b.require(present == {name for name in selected if name in ci.NATIVE},
              'continuation extra or missing native output')


def source_hashes(report):
    """Validate every declared claim; absent measurements stay absent."""
    claims = {}
    for field in ('hashes', 'sourceHashes'):
        if field not in report:
            continue
        values = report[field]
        b.require(isinstance(values, dict) and bool(values), 'continuation invalid source hashes')
        for path, value in values.items():
            b.safe_path(path); b.sha(value, 64)
            b.require(path not in claims or claims[path] == value, 'continuation conflicting source hashes')
            claims[path] = value
    return claims


def native_source_proof(report, partial, archived_bytes, input_bytes, head, tested):
    claims = source_hashes(report)
    if partial:
        b.require(bool(claims), 'continuation missing source hashes')
    for path, value in claims.items():
        original_bytes = input_bytes(head, path)
        b.require(b.digest(original_bytes) == value and original_bytes == input_bytes(tested, path),
                  'continuation source hash differs')
        if partial:
            archived = archived_bytes(path)
            b.require(b.digest(archived) == value and archived == original_bytes,
                      'continuation source hash/archive differs')


def manual_plan(workflow, authorized):
    """Only the frozen manual matrix convention; unknown YAML shapes refuse.

    This is a shape check, not a YAML evaluator. Independent review still reads
    the exact frozen command/binding body; an arbitrary dispatch is not a grant.
    """
    text = workflow.decode()
    trigger = re.search(r'^on:\n((?:[ \t].*\n|\n)+)', text, re.M)
    b.require(trigger is not None and re.findall(r'^  ([A-Za-z_]+):', trigger[1], re.M) == ['workflow_dispatch'],
              'continuation manual-only workflow differs')
    matrix = re.search(r'^      matrix:\n        include:\n((?:          .*\n|            .*\n)+)', text, re.M)
    b.require(matrix is not None, 'continuation unknown manual matrix')
    rows = re.findall(r'^          - name: ([A-Za-z0-9._-]+)\n            steps: ([a-z0-9,-]+)\n', matrix[1], re.M)
    b.require(bool(rows) and matrix[1] == ''.join('          - name: %s\n            steps: %s\n' % r for r in rows)
              and [{'name': name, 'steps': steps.split(',')} for name, steps in rows] == authorized,
              'continuation frozen workflow assignment differs')
    b.require('ref: ${{ inputs.source_head }}' in text and 'dispatch-source.json' in text
              and '--only "${{ matrix.steps }}"' in text, 'continuation unknown manual source command')


def validate(source, judgment, git, github, repository, head, merged_context):
    b.fields(source, 'run attempt tested_merge base_at_run files inventory audit controller continuation')
    b.number(source['run']); b.number(source['attempt'])
    env = b.document(source['continuation'])
    grouped = isinstance(env, dict) and type(env.get('version')) is int and env['version'] == 2
    b.fields(env, 'version authorization original completion compose' if grouped else 'version authorization original completion')
    b.require(type(env['version']) is int and env['version'] in (1, 2), 'unknown continuation version')
    auth = b.fields(b.document(env['authorization']), 'reviewer record source_head source_tree original_run original_attempt base_at_run pr original_workflow workflow_head workflow plan')
    b.words(auth['reviewer']); b.words(auth['record']); b.number(auth['pr'])
    b.number(auth['original_run']); b.number(auth['original_attempt'])
    b.require(auth['record'] != judgment['audit'], 'continuation independent authorization missing')
    b.sha(auth['workflow_head']); b.sha(auth['source_tree'])
    merge = b.fields(source['tested_merge'], 'sha tree first_parent second_parent')
    for value in merge.values():
        b.sha(value)
    b.base_fact(source['base_at_run'])
    b.require(merge['first_parent'] == source['base_at_run']['sha'] and merge['second_parent'] == head
              and b.parents(git, merge['sha']) == [merge['first_parent'], head]
              and b.tree(git, merge['sha']) == merge['tree'] == b.tree(git, head), 'continuation source/tree binding differs')
    b.require(auth['source_head'] == head and auth['source_tree'] == merge['tree']
              and auth['original_run'] == source['run'] and auth['original_attempt'] == source['attempt']
              and auth['base_at_run'] == source['base_at_run'], 'continuation authorization source binding differs')
    original = b.fields(env['original'], 'run attempt archives')
    completion = b.fields(env['completion'], 'run attempt workflow_head archives')
    b.require(original['run'] == source['run'] and original['attempt'] == source['attempt']
              and [r['id'] for r in judgment['producer_runs']] == [source['run']], 'continuation original run binding differs')
    b.require(completion['run'] != original['run'] and completion['workflow_head'] == auth['workflow_head'],
              'continuation workflow head differs')
    oldrun, oldjobs = run_fact(original, github, repository, head, 'pull_request')
    b.require(oldrun['conclusion'] == judgment['producer_runs'][0]['conclusion'], 'continuation original conclusion differs')
    prs = oldrun.get('pull_requests')
    b.require(isinstance(prs, list) and len(prs) == 1 and prs[0].get('number') == auth['pr']
              and prs[0].get('head', {}).get('sha') == head
              and {k: prs[0].get('base', {}).get(k) for k in ('ref', 'sha')} == source['base_at_run'],
              'continuation original PR/base differs')
    newrun, newjobs = run_fact(completion, github, repository, auth['workflow_head'], 'workflow_dispatch', grouped=grouped)
    b.require(newrun['conclusion'] in ('success', 'failure'), 'continuation pending or incomplete completion')
    b.require(b.parents(git, auth['workflow_head']) == [head], 'continuation workflow parent differs')
    before, after = b.entries(git, head), b.entries(git, auth['workflow_head'])
    b.require({p for p in set(before) | set(after) if before.get(p) != after.get(p)} == {WORKFLOW},
              'continuation workflow tree differs')
    workflow_bytes = b.artifact(auth['workflow'])
    b.require(b.artifact(auth['original_workflow']) == git_bytes(git, merge['sha'], WORKFLOW)
              and workflow_bytes == git_bytes(git, auth['workflow_head'], WORKFLOW),
              'continuation frozen workflow differs')
    if not grouped:
        manual_plan(workflow_bytes, auth['plan'])
    else:
        # V2's exact workflow, command, matrix and patched package are frozen
        # by the separate source-patch review and actual archive certificates.
        b.require(auth['plan'] == [{'name': 'compose-union-779', 'steps': ['native-compose']}],
                  'grouped continuation must replace only the compose obligation')
    controller = b.controller_binding(source, judgment, github, repository, head, merged_context)
    b.require(controller['producer']['pr'] == auth['pr'], 'continuation controller PR differs')
    compose_proof = None
    if grouped:
        from tools import grouped_admission
        packet = b.document(env['compose'])
        anchor = {k: source[k] for k in ('run', 'attempt', 'tested_merge', 'base_at_run', 'controller')}
        anchor['partial_dispatch'] = packet['original_anchor']['partial_dispatch']
        compose_proof = grouped_admission.validate(env['compose'], judgment, git, github, repository, head, anchor)
        package = b.document(packet['package'])
        b.require(package['workflow_head'] == auth['workflow_head'] and package['workflow'] == auth['workflow'],
                  'grouped continuation workflow/package differs')
    inventory = b.document(source['inventory'])
    b.require(isinstance(inventory, dict) and set(inventory) == set(check.REQUIRED), 'incomplete source inventory')
    for name, rows in inventory.items():
        if name != 'wake-replay':
            b.require(isinstance(rows, list) and bool(rows) and len({ci.key(r) for r in rows}) == len(rows),
                      'duplicate or empty source inventory')
    with tempfile.TemporaryDirectory(prefix='train-continuation-') as temp:
        root = Path(temp)
        old, placement = archives(original, github, repository, oldrun, oldjobs, '', root)
        new, newplacement = archives(completion, github, repository, newrun, newjobs, 'completion/', root)
        contents = dict(old, **new)
        used = set()
        def read_bytes(name):
            b.require(name in contents and name in source['files'], 'continuation missing source artifact ' + name)
            b.require(b.artifact(source['files'][name]) == contents[name], 'continuation local rewritten artifact ' + name)
            used.add(name)
            return contents[name]
        def read(name):
            return b.loads(read_bytes(name))
        # Every offered local file is authenticated; no local replacement summary.
        b.require(isinstance(source['files'], dict) and bool(source['files']), 'continuation missing files')
        for name in source['files']:
            read_bytes(name)
        summary = read('release-check/summary.json'); provenance = read('release-check/provenance.json')
        tested = merge['sha']
        expected = {'id': original['run'], 'attempt': original['attempt'], 'repository': repository,
                    'workflow': 'Checks', 'event': 'pull_request', 'workflow_sha': tested,
                    'workflow_ref': repository + '/' + WORKFLOW + '@refs/pull/%d/merge' % auth['pr']}
        ci.same_run(provenance.get('run'), expected)
        b.require(provenance.get('merge') == merge and provenance.get('base') == source['base_at_run']
                  and provenance.get('base_at_run') == source['base_at_run']
                  and provenance.get('checked') == {'commit': tested, 'tree_unchanged': False}
                  and provenance.get('head') == {'ref': oldrun['head_branch'], 'sha': head}, 'continuation original provenance differs')
        b.require(summary.get('tool') == check.TOOL and summary.get('commit') == tested
                  and not summary.get('only') and not summary.get('scoped') and not summary.get('skipped')
                  and Counter(summary.get('required', [])) == Counter(check.REQUIRED)
                  and Counter(provenance.get('required', [])) == Counter(check.REQUIRED), 'continuation original inventory differs')
        plan = provenance['plan']; assignments = ci.plan_steps(plan)
        # Only original, explicitly indexed Python partitions may repeat a step.
        flat = Counter(s for steps in assignments for s in steps)
        b.require(set(flat) == set(check.REQUIRED) and all(v == 1 or k == 'python-units' for k, v in flat.items()),
                  'continuation original plan duplicates or extras')
        b.require(set(placement) == {'release-check'} | {'check-%d' % i for i in range(len(plan))},
                  'continuation original archive inventory differs')
        aggregated = summary['steps']; aggregate = {s['name']: s for s in aggregated}
        b.require(len(aggregate) == len(aggregated) and set(aggregate) <= set(check.REQUIRED), 'continuation aggregate duplicate or extra step')
        shards = provenance.get('shards')
        b.require(isinstance(shards, list) and len({s['artifact'] for s in shards}) == len(shards),
                  'continuation duplicate shard provenance')
        complete_shards = {s['artifact']: s for s in shards}
        expected_complete = {name for name in placement if name != 'release-check' and name + '/summary.json' in contents}
        b.require(set(complete_shards) == expected_complete
                  and Counter(summary.get('combined_from', [])) == Counter(n + '/summary.json' for n in expected_complete),
                  'continuation original shard provenance inventory differs')
        executions, partials, missing, python_rows = [], [], [], []
        for index, assigned in enumerate(assignments):
            name = 'check-%d' % index; receipt = read(name + '/run.json')
            ci.same_run(receipt.get('run'), expected)
            b.require(receipt.get('merge') == merge and receipt.get('head') == provenance['head']
                      and receipt.get('base') == source['base_at_run'] and receipt.get('base_at_run') == source['base_at_run']
                      and receipt.get('shard', {}).get('steps') == assigned
                      and receipt['shard'].get('name') == plan[index]['name'], 'continuation original shard binding differs')
            job = oldjobs[placement[name]]
            b.require(job.get('name') == plan[index]['name'], 'continuation original assignment job differs')
            if name + '/summary.json' in contents:
                raw = read(name + '/summary.json')
                b.require(receipt.get('summary_sha256') == b.digest(contents[name + '/summary.json']), 'continuation summary digest differs')
                steps = clean_summary(raw, receipt, assigned, tested, git)
                shard = complete_shards[name]
                b.require(shard.get('receipt') == receipt and not shard.get('refused')
                          and shard.get('commit') == tested and shard.get('tree_unchanged') is True
                          and shard.get('tools') == raw.get('tools') and shard.get('steps') == assigned,
                          'continuation original shard provenance differs')
                if 'python_shard' in plan[index]:
                    b.require(assigned == ['python-units'] and len(steps) == 1, 'continuation Python assignment differs')
                    part = b.fields(steps[0].get('python_shard'), 'index total files')
                    b.require(type(part['index']) is int and type(part['total']) is int
                              and '%d/%d' % (part['index'], part['total']) == plan[index]['python_shard']
                              and part['files'] == plan[index]['files'] and b.canonical(raw.get('python_shard')) == b.canonical(part),
                              'continuation Python partition differs')
                    python_rows.append((part, steps[0], root / name))
            else:
                b.require(receipt.get('summary_sha256') is None and job.get('conclusion') in ('cancelled', 'timed_out')
                          and all(s in ci.NATIVE for s in assigned), 'continuation forged partial summary or nonnative cut')
                steps = [aggregate[s] for s in assigned if s in aggregate]
                b.require([s['name'] for s in steps] == assigned[:len(steps)] and len(steps) < len(assigned),
                          'continuation partial prefix differs')
                for step in steps:
                    b.require(step.get('result_source') == 'github-job-log' and step.get('github_job') == job['id']
                              and step.get('shard') == job['name'], 'continuation recovered step binding differs')
                missing.extend(assigned[len(steps):]); partials.append(name)
                for absent in assigned[len(steps):]:
                    native = ci.NATIVE[absent]
                    b.require(name + '/native/' + native.name + '/' + native.results not in contents,
                              'continuation omitted original completed report')
            for step in steps:
                executions.append((step, root / name, name, tested, 'original', 'python_shard' in plan[index]))
            report_assignment(contents, name, [s['name'] for s in steps])
        b.require(bool(partials) and bool(missing) and set(aggregate) == set(check.REQUIRED) - set(missing)
                  and Counter(summary.get('missing', [])) == Counter(missing)
                  and summary.get('tree_unchanged') is False and summary.get('passed') is False,
                  'continuation original partial truth differs')
        authorized = ci.plan_steps(auth['plan'])
        b.require(Counter(s for shard in authorized for s in shard) == Counter(missing)
                  and (grouped or set(newplacement) == {'check-%d' % i for i in range(len(authorized))}),
                  'continuation exact missing-only plan differs')
        if grouped:
            b.require(missing == ['native-compose'], 'grouped continuation has other missing logical steps')
            packet_groups = b.document(env['compose'])['groups']
            expected_refs = {r['id']: r for r in completion['archives']}
            b.require(len(expected_refs) == len(packet_groups), 'grouped completion archive count differs')
            for entry in packet_groups:
                binding = entry['binding']
                b.require(binding['run'] == completion['run'] and binding['attempt'] == completion['attempt']
                          and binding['workflow_head'] == completion['workflow_head'], 'grouped completion run identity differs')
                wanted = {k: binding[k] for k in ('id', 'name', 'job', 'archive')}
                b.require(expected_refs.get(binding['id']) == wanted, 'grouped completion archive identity differs')
            expected_archives = {r['binding']['name'] for r in packet_groups}
            b.require(set(newplacement) == expected_archives, 'grouped completion archive inventory differs')
        for index, assigned in enumerate([] if grouped else authorized):
            name = 'check-%d' % index; prefix = 'completion/' + name
            receipt = read(prefix + '/run.json'); raw = read(prefix + '/summary.json')
            dispatch = b.fields(read(prefix + '/dispatch-source.json'),
                'version requested_source checked_source checked_tree parents original_source original_run original_attempt release_base workflow_api_head workflow_sha workflow_ref run attempt event source_changes')
            wfref = repository + '/' + WORKFLOW + '@refs/heads/' + newrun['head_branch']
            wanted = {'version': 1, 'requested_source': head, 'checked_source': head, 'checked_tree': merge['tree'],
                      'parents': b.parents(git, head), 'original_source': head, 'original_run': original['run'],
                      'original_attempt': original['attempt'], 'release_base': source['base_at_run']['sha'],
                      'workflow_api_head': auth['workflow_head'], 'workflow_sha': auth['workflow_head'],
                      'workflow_ref': wfref, 'run': str(completion['run']), 'attempt': str(completion['attempt']),
                      'event': 'workflow_dispatch', 'source_changes': ''}
            b.require(b.canonical(dispatch) == b.canonical(wanted), 'continuation dispatch source binding differs')
            ci.same_run(receipt.get('run'), dict(expected, id=completion['run'], attempt=completion['attempt'],
                        event='workflow_dispatch', workflow_sha=auth['workflow_head'], workflow_ref=wfref))
            checked_parents = b.parents(git, head)
            b.require(receipt.get('summary_sha256') == b.digest(contents[prefix + '/summary.json'])
                      and receipt.get('head') == {'ref': 'refs/heads/' + newrun['head_branch'], 'sha': auth['workflow_head']}
                      and receipt.get('merge') == {'sha': head, 'tree': merge['tree'], 'first_parent': checked_parents[0] if checked_parents else None,
                                                   'second_parent': checked_parents[1] if len(checked_parents) > 1 else None}
                      and receipt.get('base') == {'ref': None, 'sha': None} and receipt.get('base_at_run') is None
                      and receipt.get('shard') == auth['plan'][index], 'continuation receipt binding differs')
            job = newjobs[newplacement[name]]
            release = [s for s in job.get('steps', []) if s.get('name') == 'Release check, ' + ','.join(assigned)]
            b.require(len(release) == 1 and release[0].get('status') == 'completed'
                      and release[0].get('conclusion') in ('success', 'failure'), 'continuation job assignment differs')
            steps = clean_summary(raw, receipt, assigned, head, git)
            report_assignment(contents, prefix, assigned)
            for step in steps:
                executions.append((step, root / prefix, prefix, head, 'completion', False))
        # Recompute every admitted execution from its raw log/report, before audit.
        reds, raw_steps, positions = [], [], []
        source_bytes = {}
        def input_bytes(commit, path):
            key = (commit, path)
            if key not in source_bytes:
                source_bytes[key] = git_bytes(git, commit, path)
            return source_bytes[key]
        partition_keys, partition_files, partition_indices = set(), set(), set()
        for part, step, out in python_rows:
            log = read_bytes(str(out.relative_to(root)) + '/python-units.log').decode()
            metadata = [b.loads(line) for line in log.splitlines() if line.startswith('{"unit_shards":')]
            b.require(len(metadata) == 1 and metadata[0].get('unit_shards') == 1
                      and b.canonical(metadata[0].get('python_shard')) == b.canonical(part)
                      and metadata[0].get('tests') == step.get('counts', {}).get('tests'),
                      'continuation Python log partition differs')
            rows = [row for row, _ in ci.unit_records(log.split('\n======================================================================\n', 1)[0], node=False)]
            keys = {ci.key(row) for row in rows}
            files = part['files']
            b.require(isinstance(files, list) and len(files) == len(set(files)) and not partition_files.intersection(files)
                      and not partition_keys.intersection(keys) and part['index'] not in partition_indices,
                      'continuation duplicate Python partition')
            partition_keys.update(keys); partition_files.update(files); partition_indices.add(part['index'])
        if python_rows:
            totals = {p['total'] for p, _, _ in python_rows}
            b.require(totals == {len(python_rows)} and partition_indices == set(range(1, len(python_rows) + 1))
                      and partition_keys == {ci.key(r) for r in inventory['python-units']}, 'continuation incomplete Python inventory')
        for step, out, folder, commit, origin, partitioned in executions:
            name = step['name']
            if name != 'wake-replay':
                read_bytes(folder + '/' + name + '.log')
            if name in ci.NATIVE:
                native = ci.NATIVE[name]
                report = read(folder + '/native/' + native.name + '/' + native.results)
                # The partial stdout has no argv. Its whole-mode command is a
                # derived fact of the frozen workflow and complete reviewed rows.
                b.require(folder in partials or check.ran_whole(step), 'continuation filtered native mode')
                rows = ci.cases(step, out, inventory[name]); b.teardown(report)
                # Only prefixes lack the exact clean ending/tool certificate
                # already authenticated above for original/completion shards.
                native_source_proof(report, folder in partials,
                    lambda path: read_bytes(folder + '/native/' + native.name + '/source/' + path),
                    input_bytes, head, tested)
                counts, good = check.native_counts(native, out / 'native' / native.name, (out / (name + '.log')).read_text())
                b.require(b.canonical(counts) == b.canonical(step['counts']) and good is step['passed'], 'continuation native log differs')
                for row in rows:
                    if row['passed'] is False and not (row.get('expectedFailure') and row.get('mutationCaught') is True):
                        b.words(row.get('error'))
                        reds.append({'step': name, 'case': ci.identity(row), 'observed': row})
            elif name in ci.UNITS:
                expected_rows = inventory[name]
                if partitioned:
                    text = (out / (name + '.log')).read_text().split('\n======================================================================\n', 1)[0]
                    keys = {ci.key(r) for r, _ in ci.unit_records(text, node=False)}
                    expected_rows = [r for r in expected_rows if ci.key(r) in keys]
                reds.extend({'step': name, 'case': ci.identity(row), 'observed': observed}
                            for row, observed in b.unit_results(step, out, expected_rows))
            else:
                for run_index, _ in enumerate(step['runs'], 1):
                    read_bytes(folder + '/replay/candidate-%d/replay.json' % run_index)
                    read_bytes(folder + '/wake-replay-candidate-%d.log' % run_index)
                reds.extend(b.replay_results(step, out, inventory[name]))
            positions.append({'step': name, 'origin': origin, 'artifact': folder})
            if not step['passed']:
                raw_steps.append({k: step[k] for k in ('name', 'passed', 'exit', 'counts')})
        coverage = Counter(p['step'] for p in positions)
        if python_rows:
            coverage['python-units'] -= len(python_rows) - 1
        if grouped:
            coverage['native-compose'] += 1
            positions.append({'step': 'native-compose', 'origin': 'authenticated-compose-union-779', 'artifact': env['compose']})
            if not compose_proof['passed']:
                raw_steps.append({'name': 'native-compose', 'passed': False, 'exit': 1,
                                  'counts': {'raw_false': len(compose_proof['raw_false'])}})
        b.require(coverage == Counter(check.REQUIRED), 'continuation incomplete or duplicate union')
        # Check the original aggregate did not drop/retype any raw verdict. Only
        # Python partitions are combined; their individual failures stay above.
        for name, aggregate_step in aggregate.items():
            originals = [s for s, _, _, _, origin, _ in executions if origin == 'original' and s['name'] == name]
            if len(originals) == 1:
                b.require(all(b.canonical(aggregate_step.get(k)) == b.canonical(originals[0].get(k))
                              for k in ('name', 'passed', 'exit', 'counts')), 'continuation omitted original red/result')
            else:
                b.require(name == 'python-units' and aggregate_step.get('passed') is all(s['passed'] for s in originals)
                          and aggregate_step.get('exit') == (0 if all(s['passed'] for s in originals) else 1)
                          and all(aggregate_step.get('counts', {}).get(k, 0) == sum(s['counts'].get(k, 0) for s in originals)
                                  for k in ('tests', 'failures', 'errors')), 'continuation original Python aggregate differs')
        b.require(Counter(summary.get('failed', [])) == Counter(missing + [n for n, s in aggregate.items() if not s['passed']]),
                  'continuation original failed inventory differs')
        b.audit_reds(source, judgment, head, reds)
        return {'kind': 'original-partial-plus-scoped-completion', 'complete': True,
                'passed': not raw_steps, 'run': source['run'], 'attempt': source['attempt'],
                'completion': {'run': completion['run'], 'attempt': completion['attempt'],
                               'workflow_head': auth['workflow_head'], 'conclusion': newrun['conclusion']},
                'partial_shards': partials, 'positions': positions,
                'failed': sorted({s['name'] for s in raw_steps}), 'steps': raw_steps,
                'red_count': len(reds), 'controller': controller,
                **({'compose': grouped_admission.record(compose_proof)} if grouped else {})}

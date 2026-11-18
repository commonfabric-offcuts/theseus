from __future__ import annotations

"""Consume frozen evidence for a reviewed base move; never run candidate code.

See docs/base-move-evidence.md. Attribution of independent review and selection
of affected own cases remain human judgments, explicitly bound to exact bytes.
"""
import hashlib
import json
import io
import zipfile
from pathlib import Path, PurePosixPath
import re
import tempfile
import tarfile
from collections import Counter

from tools import ci_known_reds as ci, release_check


class Refused(Exception):
    pass


def require(ok, why):
    if not ok:
        raise Refused('base move: ' + why)


def pairs(rows):
    result = {}
    for key, value in rows:
        require(key not in result, 'duplicate field ' + key)
        result[key] = value
    return result


def loads(data):
    return json.loads(data, object_pairs_hook=pairs,
                      parse_constant=lambda value: require(False, 'invalid JSON constant ' + value))


def fields(value, names):
    require(isinstance(value, dict) and set(value) == set(names.split()), 'invalid fields: expected ' + names)
    return value


def sha(value, size=40):
    require(isinstance(value, str) and re.fullmatch('[0-9a-f]{%d}' % size, value), 'invalid object digest')
    return value


def words(value):
    require(isinstance(value, str) and bool(value.strip()), 'missing review attribution')


def number(value):
    require(type(value) is int and value > 0, 'invalid positive number')


def digest(data):
    return hashlib.sha256(data).hexdigest()


def canonical(value):
    return json.dumps(value, sort_keys=True, separators=(',', ':')).encode()


def artifact(ref):
    fields(ref, 'path sha256')
    sha(ref['sha256'], 64)
    require(isinstance(ref['path'], str) and Path(ref['path']).is_absolute(), 'artifact path must be absolute')
    try:
        data = Path(ref['path']).read_bytes()
    except OSError as error:
        raise Refused('base move: unreadable artifact: %s' % error)
    require(digest(data) == ref['sha256'], 'artifact digest differs: ' + ref['path'])
    return data


def document(ref):
    return loads(artifact(ref))


def ask(git, *args):
    result = git(*args)
    require(result.returncode == 0, 'git facts unreadable: ' + ' '.join(args))
    return result.stdout


def ancestor(git, older, newer):
    require(git('merge-base', '--is-ancestor', older, newer).returncode == 0, 'unrelated heads or bases')


def entries(git, head):
    rows = ask(git, 'ls-tree', '-r', '-z', '--full-tree', head).split('\0')
    return {row.split('\t', 1)[1]: row.split('\t', 1)[0] for row in rows if row}


def tree(git, head):
    return ask(git, 'rev-parse', '--verify', head + '^{tree}').strip()


def parents(git, head):
    return ask(git, 'rev-list', '--parents', '-n', '1', head).split()[1:]


def snapshot(ref, git, head, expected_tree):
    data = fields(document(ref), 'head tree changes inputs')
    require(data['head'] == head and data['tree'] == expected_tree and data['changes'] == '', 'wrong or unclean snapshot')
    require(isinstance(data['inputs'], dict) and bool(data['inputs']), 'missing source input hashes')
    for path, value in data['inputs'].items():
        safe_path(path)
        sha(value)
        require(ask(git, 'rev-parse', '--verify', head + ':' + path).strip() == value, 'source input hash differs')
    return data


def safe_path(path):
    require(isinstance(path, str) and bool(path) and not PurePosixPath(path).is_absolute()
            and all(part not in ('', '.', '..', '.git') for part in path.split('/')),
            'unsafe source artifact path')


# The existing App identity, read independently from GitHub; never supplied by
# an untrusted manifest as an override.
VERDICT_APP = {'id': 5763648, 'slug': 'theseus-verdict'}


def base_fact(value):
    fields(value, 'ref sha'); sha(value['sha'])
    ref = value['ref']
    # Short branch syntax, matching git check-ref-format --branch restrictions.
    require(isinstance(ref, str) and bool(ref) and not ref.startswith(('-', 'refs/'))
            and ref != '@' and not any(c in ref for c in ('..', '@{', '//'))
            and not re.search(r'[\x00-\x20\x7f~^:?*\[\\]', ref)
            and not ref.endswith('.') and all(part and not part.startswith('.')
                and not part.endswith('.lock') for part in ref.split('/')), 'invalid base ref')
    return value


def controller_archive(ref, github, repository, controller, name):
    fields(ref, 'id archive'); number(ref['id'])
    raw = artifact(ref['archive'])
    meta = github.get('repos/%s/actions/artifacts/%d' % (repository, ref['id']))
    require(meta.get('id') == ref['id'] and meta.get('name') == name
            and meta.get('digest') == 'sha256:' + digest(raw)
            and meta.get('workflow_run', {}).get('id') == controller['id']
            and meta['workflow_run'].get('head_sha') == controller['head_sha'], 'controller artifact provenance differs')
    with zipfile.ZipFile(io.BytesIO(raw)) as archive:
        names = archive.namelist()
        require(len(names) == len(set(names)), 'duplicate controller artifact member')
        return {name: archive.read(name) for name in names}


def controller_binding(source, judgment, github, repository, head, merged_context):
    data = fields(source['controller'], 'run attempt current_base verdict_artifact published_artifact')
    current = base_fact(data['current_base'])
    original = base_fact(source.get('base_at_run'))
    require(source['tested_merge']['first_parent'] == original['sha']
            and source['tested_merge']['second_parent'] == head, 'controller original merge binding differs')
    number(data['run']); number(data['attempt'])
    require(data['run'] != source['run'], 'controller is not a separate run')
    run = github.get('repos/%s/actions/runs/%d' % (repository, data['run']))
    require(run.get('id') == data['run'] and run.get('run_attempt') == data['attempt']
            and run.get('name') == 'Verdict' and run.get('path') == '.github/workflows/verdict.yml'
            and run.get('event') == 'workflow_run' and run.get('status') == 'completed'
            and run.get('conclusion') in ('success', 'failure'), 'controller run identity differs')
    sha(run['head_sha'])
    suffix = '%d-%d-c%d' % (source['run'], source['attempt'], data['attempt'])
    verdict = controller_archive(data['verdict_artifact'], github, repository, run, 'verdict-' + suffix)
    published = controller_archive(data['published_artifact'], github, repository, run, 'published-' + suffix)
    binding = loads(verdict['producer.json']); check = loads(verdict['check-run.json'])
    pub = loads(published['published.json'])
    producer, controller = binding['producer'], binding['controller']
    ci.same_run({'id': producer.get('run_id'), 'attempt': producer.get('run_attempt')},
                {'id': source['run'], 'attempt': source['attempt']})
    require(producer.get('head_sha') == head and producer.get('head_repository') == repository
            and producer.get('event') == 'pull_request' and producer.get('workflow_name') == 'Checks'
            and producer.get('workflow_path') == '.github/workflows/checks.yml'
            and producer.get('conclusion') == judgment['producer_runs'][0]['conclusion'], 'controller producer binding differs')
    pr = producer['pull_request']
    require(pr.get('head_sha') == head and pr.get('base_sha') == current['sha']
            and pr.get('base_ref') == current['ref'], 'controller current PR binding differs')
    number(pr['number'])
    url = 'https://github.com/%s/actions/runs/%d' % (repository, data['run'])
    ci.same_run({'id': controller.get('run_id'), 'attempt': controller.get('run_attempt')},
                {'id': data['run'], 'attempt': data['attempt']})
    require(controller.get('repository') == repository and controller.get('url') == url
            and controller.get('sha') == controller.get('workflow_sha') == run['head_sha']
            and controller.get('ref') == 'refs/heads/' + run['head_branch']
            and controller.get('workflow_ref') == repository + '/.github/workflows/verdict.yml@' + controller['ref'],
            'protected controller identity differs')
    require(len(judgment['verdict_checks']) == 1, 'need exact published Verdict check')
    listed = judgment['verdict_checks'][0]
    raw = github.get('repos/%s/check-runs/%d' % (repository, listed['id']))
    prs = raw.get('pull_requests')
    if prs == []:
        # Context comes only from the reviewed two-edge Git chain in validate,
        # never from a manifest override or a missing/nonempty association.
        require(isinstance(merged_context, dict), 'empty check association needs merged train context')
        ctx = merged_context
        pull = ctx['pull']
        require(pull.get('number') == ctx['number'] == pr['number']
                and pull.get('merged') is True and pull.get('merge_commit_sha') == ctx['merge']
                and pull.get('head', {}).get('sha') == ctx['assembly']
                and pull.get('base', {}).get('sha') == ctx['live']
                and pull.get('base', {}).get('ref') == current['ref'] == ctx['release_branch']
                and original['sha'] == ctx['original_base']
                and current['sha'] in (ctx['original_base'], ctx['live'])
                and head == ctx['source_head'], 'empty check association merged PR binding differs')
    else:
        require(isinstance(prs, list) and len(prs) == 1 and prs[0].get('number') == pr['number']
                and prs[0].get('head', {}).get('sha') == head
                and prs[0].get('base', {}).get('ref') == current['ref']
                and prs[0].get('base', {}).get('sha') == current['sha'], 'archived check current PR binding differs')
    external = '%d-%d' % (source['run'], source['attempt'])
    # Plain early refusals require equal complete base facts and the exact
    # publication pair. Branch-named receipts also occur without a base move.
    # Both PR records above and all three names below must still agree.
    plain = current == original and (pub.get('name'), pub.get('base')) == ('Verdict', '')
    name = 'Verdict' if plain else 'Verdict for ' + current['ref']
    published_base = '' if plain else current['ref']
    require(pub.get('check_run_id') == listed['id'] == raw.get('id')
            and pub.get('head_sha') == head and pub.get('name') == name and pub.get('base') == published_base
            and pub.get('external_id') == external, 'published Verdict binding differs')
    for key, expected in (('controller_run', data['run']), ('controller_attempt', data['attempt']),
                          ('producer_run', source['run']), ('producer_attempt', source['attempt'])):
        require(str(pub.get(key)) == str(expected), 'published attempt binding differs')
    require(raw.get('app', {}).get('id') == VERDICT_APP['id']
            and raw.get('app', {}).get('slug') == VERDICT_APP['slug'], 'untrusted Verdict App')
    expected = {'name': name, 'head_sha': head, 'status': 'completed',
                'conclusion': listed['conclusion'], 'details_url': url, 'external_id': external}
    require(listed['conclusion'] in ('success', 'failure') and all(
        raw.get(k) == check.get(k) == v for k, v in expected.items()), 'source check binding differs')
    output = check['output']; api_output = raw.get('output') or {}
    summary = output['summary']
    appended = '\nPublished by controller run %d attempt %d.' % (data['run'], data['attempt'])
    require(api_output.get('title') == output.get('title')
            and api_output.get('summary') in (summary, summary + appended), 'Verdict output differs')
    refusal = verdict['refusals'].decode()
    if refusal.strip():
        require(output.get('title') == 'refused' and check['conclusion'] == 'failure'
                and summary.startswith('Refused:\n' + ''.join('- ' + line + '\n' for line in refusal.splitlines())),
                'Verdict refusal ground differs')
    return {'run': data['run'], 'attempt': data['attempt'], 'head': run['head_sha'],
            'check': listed['id'], 'current_base': current, 'output': output, 'refusals': refusal,
            'producer': {'head_ref': producer['head_branch'], 'pr': pr['number']}}


def unit_results(step, out, expected):
    """Complete raw units, including failures. Never classify a red as green."""
    name = step['name']; text = (out / (name + '.log')).read_text()
    node = name == 'node-units'
    counts, good = release_check.node_counts(text) if node else release_check.python_counts(text)
    require(canonical(step.get('counts')) == canonical(counts) and counts.get('tests', 0) > 0, 'source unit log/count mismatch')
    require(type(step.get('exit')) is int and step['exit'] == (0 if good else 1)
            and step.get('passed') is good, 'source unit exit/verdict differs')
    require(not any(counts.get(k, 0) for k in ('skipped', 'todo', 'cancelled', 'expected failures', 'unexpected successes')),
            'source unit incomplete checks')
    # Tracebacks can contain lines such as "+ (0, '')"; these are not tests.
    listing = text if node else text.split('\n======================================================================\n', 1)[0]
    rows = ci.unit_records(listing, node=node)
    require(len(rows) == counts['tests'] and all(status in (('ok', 'not ok') if node else ('ok', 'FAIL', 'ERROR'))
                                               for _, status in rows), 'source unit missing individual outcomes')
    require(Counter(ci.key(row) for row, _ in rows) == Counter(ci.key(row) for row in expected),
            'source unit case inventory differs')
    require(len({ci.key(r) for r, _ in rows}) == len(rows), 'duplicate source unit identity')
    if node:
        require(counts.get('pass') == sum(status == 'ok' for _, status in rows)
                and counts.get('fail') == sum(status == 'not ok' for _, status in rows), 'source TAP outcomes differ')
        return [(row, {'status': status, 'failure': text}) for row, status in rows if status != 'ok']
    # Preserve the exact block, including the producer's separator length.
    matches = list(re.finditer(r'^(FAIL|ERROR): ([^\n]+)\n-+\n(.*?)(?=\n[=-]{6,}\n)', text, re.M | re.S))
    errors = {(m[2], m[1]): m[0] for m in matches}
    failed = [(row, status) for row, status in rows if status != 'ok']
    require(len(errors) == len(matches) == len(failed)
            and set(errors) == {(row['name'], status) for row, status in failed}, 'source unit failure blocks differ')
    require(counts.get('failures', 0) == sum(status == 'FAIL' for _, status in failed)
            and counts.get('errors', 0) == sum(status == 'ERROR' for _, status in failed), 'source unittest outcomes differ')
    require(good is (not failed), 'source unit raw verdict differs')
    return [(row, {'status': status, 'failure': errors[(row['name'], status)]}) for row, status in failed]


def report_hashes(reports, git, tested):
    """Verify every hash actually claimed by an original native report.

    Some original producers omit this optional field. The mandatory tool and
    harness Git OIDs are checked separately; absent fields stay absent.
    """
    claims = {}
    for report in reports:
        if 'hashes' not in report:
            continue
        require(isinstance(report['hashes'], dict) and bool(report['hashes']), 'invalid native source hashes')
        for path, value in report['hashes'].items():
            safe_path(path); sha(value, 64)
            require(path not in claims or claims[path] == value, 'conflicting native source hashes')
            claims[path] = value
    if not claims:
        return
    # Git writes binary bytes directly; text-mode adapters cannot normalize
    # CRLF inside these inputs. No candidate code is imported or executed.
    with tempfile.TemporaryDirectory(prefix='train-native-sources-') as temp:
        path = Path(temp) / 'source.tar'
        ask(git, 'archive', '--format=tar', '--output=' + str(path), tested, '--', *sorted(claims))
        with tarfile.open(str(path)) as archive:
            for name, expected in claims.items():
                member = archive.getmember(name)
                require(member.isfile(), 'native source hash names a non-file')
                with archive.extractfile(member) as handle:
                    require(digest(handle.read()) == expected, 'native source hash differs: ' + name)


def teardown(report):
    require(not report.get('teardown') and not report.get('fixtureErrors'), 'reported teardown failure')


def replay_results(step, out, traffic):
    routed = ci.unique(traffic.get('routed'), 'reviewed routed actors')
    require(bool(routed) and isinstance(step.get('runs'), list) and bool(step['runs']), 'source replay missing runs')
    runs, reds = [], []
    for index, run in enumerate(step['runs'], 1):
        counts, complete = release_check.replay_counts(out / 'replay' / ('candidate-%d' % index))
        require(complete and set(counts) == routed, 'source replay missing actor results')
        for values in counts.values():
            require(isinstance(values, dict) and type(values.get('wakes')) is int and values['wakes'] > 0
                    and isinstance(values.get('lost'), list) and isinstance(values.get('delays'), list)
                    and len(values['delays']) == values['wakes'], 'source replay incomplete counts')
        log = out / ('wake-replay-candidate-%d.log' % index)
        require(log.is_file() and bool(log.read_text().strip()), 'source replay missing log')
        require(type(run.get('exit')) is int and run['exit'] in (0, 1)
                and run.get('passed') is (run['exit'] == 0), 'source replay abnormal exit')
        runs.append(dict(run, counts=counts))
        if not run['passed']:
            reds.append({'step': 'wake-replay', 'case': ci.identity({'name': 'candidate-%d' % index}),
                         'observed': {'exit': run['exit'], 'passed': run['passed'], 'counts': counts}})
    recalculated = release_check.replay_step(runs, step.get('started_at'))
    require(all(step.get(k) == recalculated[k] for k in ('counts', 'series', 'passed', 'exit')), 'source replay raw verdict differs')
    return reds


def audit_reds(source, judgment, head, reds):
    names = 'version reviewer record run attempt source_head tested_merge inventory files_sha256 summary_sha256 reds'
    if 'continuation' in source:
        names += ' continuation_sha256'
    if 'compose' in source:
        names += ' compose_sha256'
    audit = fields(document(source['audit']), names)
    if 'compose' in source:
        require(audit['compose_sha256'] == source['compose']['sha256'], 'source audit compose binding differs')
    if 'continuation' in source:
        require(audit['continuation_sha256'] == source['continuation']['sha256'], 'source audit continuation binding differs')
    require(type(audit['version']) is int and audit['version'] == 1, 'unknown source audit version')
    words(audit['reviewer']); words(audit['record'])
    require(audit['record'] == judgment['audit'] and type(audit['run']) is int and type(audit['attempt']) is int
            and audit['run'] == source['run'] and audit['attempt'] == source['attempt']
            and audit['source_head'] == head and audit['tested_merge'] == source['tested_merge']
            and audit['inventory'] == source['inventory']
            and audit['files_sha256'] == digest(canonical(source['files']))
            and audit['summary_sha256'] == source['files']['release-check/summary.json']['sha256'], 'source audit binding differs')
    require(isinstance(audit['reds'], list), 'source audit reds missing')
    actual = {(r['step'], ci.key(r['case'])): r['observed'] for r in reds}
    seen = set()
    for row in audit['reds']:
        fields(row, 'step case observed attribution ground evidence')
        fields(row['case'], 'name phase engine expectedFailure')
        key = (row['step'], ci.key(row['case']))
        require(key in actual and key not in seen and canonical(row['observed']) == canonical(actual[key]), 'source audit red identity/failure differs')
        seen.add(key); words(row['attribution']); words(row['ground'])
        require(isinstance(row['evidence'], list) and bool(row['evidence']), 'source audit red evidence missing')
        for ref in row['evidence']:
            require(bool(artifact(ref)), 'empty source audit red evidence')
    require(seen == set(actual), 'source audit missing original red')


def full_source(source, judgment, git, github, repository, head, merged_context):
    if isinstance(source, dict) and 'continuation' in source:
        from tools import continuation_envelope
        return continuation_envelope.validate(source, judgment, git, github, repository, head, merged_context)
    grouped = isinstance(source, dict) and 'compose' in source
    fields(source, 'run attempt tested_merge base_at_run files inventory audit controller compose' if grouped
           else 'run attempt tested_merge base_at_run files inventory audit controller')
    number(source['run']); number(source['attempt'])
    base_fact(source['base_at_run'])
    merge = fields(source['tested_merge'], 'sha tree first_parent second_parent')
    for value in merge.values():
        sha(value)
    tested = merge['sha']
    require(merge['first_parent'] == source['base_at_run']['sha'] and merge['second_parent'] == head
            and parents(git, tested) == [merge['first_parent'], head]
            and tree(git, tested) == merge['tree'], 'source merge binding differs')
    require([r['id'] for r in judgment['producer_runs']] == [source['run']], 'source run binding differs')
    run = github.get('repos/%s/actions/runs/%d' % (repository, source['run']))
    require(run.get('id') == source['run'] and run.get('head_sha') == head and run.get('status') == 'completed'
            and run.get('conclusion') == judgment['producer_runs'][0]['conclusion']
            and run.get('run_attempt') == source['attempt'] and run.get('path') == '.github/workflows/checks.yml'
            and run.get('event') == 'pull_request' and run.get('name') == 'Checks'
            and run.get('conclusion') in ('success', 'failure'), 'source run identity differs')
    controller = controller_binding(source, judgment, github, repository, head, merged_context)
    compose_proof = None
    if grouped:
        from tools import grouped_admission
        anchor = {k: source[k] for k in ('run', 'attempt', 'tested_merge', 'base_at_run', 'controller')}
        if document(source['compose']).get('version') == 2:
            from tools import forward_admission
            try:
                compose_proof = forward_admission.validate(source['compose'], judgment, git, github, repository, tested, anchor, source['files'])
            except forward_admission.f.ForwardRefused as error:
                raise Refused(str(error))
        else:
            compose_proof = grouped_admission.validate(source['compose'], judgment, git, github, repository, tested, anchor, mode='fullChecks')
    inventory = document(source['inventory'])
    require(isinstance(inventory, dict) and set(inventory) == set(release_check.REQUIRED), 'incomplete source inventory')
    for name, rows in inventory.items():
        if name != 'wake-replay':
            require(isinstance(rows, list) and bool(rows)
                    and len({ci.key(row) for row in rows}) == len(rows), 'duplicate or empty source inventory')
    files = source['files']
    require(isinstance(files, dict) and bool(files), 'missing source artifacts')
    # Materialise only digest-verified named artifacts, to reuse the existing raw
    # log/count/teardown validators. No candidate module is imported or executed.
    with tempfile.TemporaryDirectory(prefix='train-base-move-') as temp:
        root = Path(temp)
        for name, ref in files.items():
            safe_path(name)
            path = root / name
            path.parent.mkdir(parents=True, exist_ok=True)
            content = artifact(ref)
            if name.endswith('.json'):
                loads(content)  # reject duplicate fields in original raw reports too
            path.write_bytes(content)
        def read(name):
            require(name in files, 'missing source artifact ' + name)
            return loads((root / name).read_bytes())
        summary = read('release-check/summary.json')
        provenance = read('release-check/provenance.json')
        expected_run = {'id': source['run'], 'attempt': source['attempt'], 'repository': repository, 'workflow': 'Checks'}
        ci.same_run(provenance.get('run'), expected_run)
        require(provenance.get('merge') == merge and provenance.get('base') == source['base_at_run']
                and provenance.get('base_at_run') == source['base_at_run']
                and provenance.get('head') == {'ref': controller['producer']['head_ref'], 'sha': head}
                and provenance.get('checked') == {'commit': tested, 'tree_unchanged': True}, 'source merge binding differs')
        workflow = repository + '/.github/workflows/checks.yml@refs/pull/%d/merge' % controller['producer']['pr']
        expected_run.update(event='pull_request', workflow_sha=tested, workflow_ref=workflow)
        ci.same_run(provenance.get('run'), expected_run)
        require(summary.get('tool') == release_check.TOOL and summary.get('commit') == tested
                and summary.get('tree_unchanged') is True
                and summary.get('tree_after') == {'head': tested, 'changes': ''}, 'dirty or wrong complete source')
        require('only' not in summary and summary.get('skipped') is None and summary.get('scoped') is None,
                'partial complete source')
        required = list(release_check.REQUIRED)
        require(Counter(summary.get('required', [])) == Counter(required)
                and Counter(provenance.get('required', [])) == Counter(required)
                and Counter(s['name'] for s in summary['steps']) == Counter(required), 'incomplete complete source')
        require(Counter(summary.get('failed', [])) == Counter(s['name'] for s in summary['steps'] if s.get('passed') is not True),
                'source failed-step inventory differs')
        by_name = {s['name']: s for s in summary['steps']}
        shards = provenance['shards']
        names = [s['artifact'] for s in shards]
        require(bool(names) and len(names) == len(set(names))
                and all(re.fullmatch('check-[0-9]+', n) for n in names), 'invalid source shard inventory')
        require(Counter(summary.get('combined_from', [])) == Counter(n + '/summary.json' for n in names),
                'source shard inventory differs')
        plan = ci.plan_steps(provenance['plan'])
        coverage = Counter(s for shard in plan for s in shard)
        require(set(coverage) == set(required)
                and all(count == 1 or name == 'python-units' or (grouped and name == 'native-compose') for name, count in coverage.items())
                and set(names) == {'check-%d' % i for i in range(len(plan))}, 'source shard plan differs')
        if grouped:
            require(Counter(j.get('compose_group', {}).get('id') for j in provenance['plan'] if j.get('compose_group')) ==
                    Counter(r['group'] for r in compose_proof['collector']['receipts']), 'source grouped plan differs')
        partitioned = coverage['python-units'] > 1 or any('python_shard' in job for job in provenance['plan'])
        python_parts, python_keys, python_files, python_indices = [], set(), set(), set()
        expected_python, empty_python = {}, set()
        # Validate the original complete partitions before consuming any results.
        # The only authority for repeated steps is the original indexed plan.
        for index, job in enumerate(provenance['plan']):
            folder = 'check-%d' % index
            raw = read(folder + '/summary.json')
            if not partitioned or plan[index] != ['python-units']:
                require('python_shard' not in job and 'python_shard' not in raw
                        and all('python_shard' not in s for s in raw['steps']), 'source Python partition differs')
                continue
            require(len(raw['steps']) == 1 and raw['steps'][0]['name'] == 'python-units', 'source Python partition differs')
            step = raw['steps'][0]
            part = fields(step.get('python_shard'), 'index total files')
            require(type(part['index']) is int and type(part['total']) is int
                    and 1 <= part['index'] <= part['total']
                    and job.get('python_shard') == '%d/%d' % (part['index'], part['total'])
                    and canonical(job.get('files')) == canonical(part['files'])
                    and canonical(raw.get('python_shard')) == canonical(part), 'source Python partition differs')
            receipt = read(folder + '/run.json')
            require(canonical(receipt.get('shard')) == canonical({'name': job.get('name'), 'steps': ['python-units']})
                    and isinstance(job.get('name'), str) and bool(job['name']), 'source Python receipt differs')
            checkout = raw.get('checkout')
            require(isinstance(checkout, str) and Path(checkout).is_absolute()
                    and step.get('tool') == 'unittest' and isinstance(step.get('argv'), list)
                    and len(step['argv']) == 6 and isinstance(step['argv'][0], str) and bool(step['argv'][0])
                    and step['argv'][1:] == [checkout + '/tools/unit_shards.py', '--root', checkout,
                                            '--shard', job['python_shard']], 'source Python command differs')
            log = (root / folder / 'python-units.log').read_text()
            metadata = [loads(line) for line in log.splitlines() if line.startswith('{"unit_shards":')]
            require(len(metadata) == 1 and type(metadata[0].get('unit_shards')) is int
                    and metadata[0]['unit_shards'] == 1
                    and canonical(metadata[0].get('python_shard')) == canonical(part)
                    and type(metadata[0].get('tests')) is int
                    and canonical(metadata[0]['tests']) == canonical(step.get('counts', {}).get('tests')),
                    'source Python log partition differs')
            require(len(re.findall(r'^Ran (\d+) tests? in ', log, re.M)) == 1
                    and len(re.findall(r'^(OK|FAILED)(?: \((.*)\))?$', log, re.M)) == 1,
                    'source Python log result differs')
            require(canonical(metadata[0].get('timing')) == canonical(step.get('timing')),
                    'source Python timing differs')
            # The original producer permits completed empty file partitions,
            # but ordinary unpartitioned units still need positive outcomes.
            if metadata[0]['tests'] == 0:
                require(re.findall(r'^Ran (\d+) tests? in ', log, re.M) == ['0']
                        and re.findall(r'^(OK|FAILED)(?: \((.*)\))?$', log, re.M) == [('OK', '')]
                        and canonical(step.get('counts')) == canonical({'tests': 0, 'status': 'OK'})
                        and type(step.get('exit')) is int and step['exit'] == 0 and step.get('passed') is True,
                        'source empty Python partition differs')
                empty_python.add(folder)
            rows = [r for r, _ in ci.unit_records(log.split('\n======================================================================\n', 1)[0], node=False)]
            keys = {ci.key(r) for r in rows}
            paths = part['files']
            require(isinstance(paths, list) and all(isinstance(path, str) for path in paths), 'source Python files differ')
            for path in paths:
                safe_path(path)
            require(len(paths) == len(set(paths)) and not python_files.intersection(paths)
                    and not python_keys.intersection(keys) and part['index'] not in python_indices,
                    'source duplicate Python partition')
            python_files.update(paths); python_keys.update(keys); python_indices.add(part['index'])
            expected_python[folder] = [r for r in inventory['python-units'] if ci.key(r) in keys]
            python_parts.append(dict(step, partition=part))
        if partitioned:
            job_names = [job.get('name') for job in provenance['plan']]
            require(all(isinstance(name, str) and bool(name) for name in job_names)
                    and len(job_names) == len(set(job_names)), 'source Python receipt differs')
            require(len(python_parts) == coverage['python-units']
                    and {p['partition']['total'] for p in python_parts} == {len(python_parts)}
                    and python_indices == set(range(1, len(python_parts) + 1))
                    and python_keys == {ci.key(r) for r in inventory['python-units']}, 'source incomplete Python inventory')
            # Match the producer's import-free unittest discovery using immutable
            # Git paths, including package initializers and hook-suppressed files.
            source_entries = entries(git, tested)
            discovered = set()
            for path in source_entries:
                parts = path.split('/')
                if (parts[0] == 'tests' and len(parts) >= 2
                        and (re.fullmatch(r'test_\w*\.py', parts[-1])
                             or (len(parts) > 2 and parts[-1] == '__init__.py'))
                        and all('/'.join(parts[:i]) + '/__init__.py' in source_entries for i in range(2, len(parts)))):
                    discovered.add(path)
            require(python_files == discovered, 'source Python file inventory differs')
            counts = {'tests': sum(p['counts']['tests'] for p in python_parts),
                      'status': 'OK' if all(p['counts'].get('status') == 'OK' for p in python_parts) else 'FAILED'}
            for key in ('skipped', 'failures', 'errors', 'expected failures', 'unexpected successes'):
                if any(key in p['counts'] for p in python_parts):
                    counts[key] = sum(p['counts'].get(key, 0) for p in python_parts)
            combined_python = {'name': 'python-units', 'tool': 'unittest', 'counts': counts,
                               'exit': max(p.get('exit', 1) for p in python_parts),
                               'passed': counts['tests'] > 0 and all(p.get('passed') is True and p['counts'].get('tests', -1) >= 0
                                                                  for p in python_parts),
                               'shards': python_parts}
            require(canonical(by_name['python-units']) == canonical(combined_python), 'source Python aggregate differs')
        ran, reds, raw_steps, reports = [], [], [], []
        actual_groups779 = []
        for shard in shards:
            name = shard['artifact']; out = root / name
            raw = read(name + '/summary.json'); receipt = read(name + '/run.json')
            ci.same_run(receipt.get('run'), expected_run)
            require(shard.get('receipt') == receipt and not shard.get('refused')
                    and receipt.get('merge') == merge and receipt.get('base') == source['base_at_run']
                    and receipt.get('base_at_run') == source['base_at_run'] and receipt.get('head') == provenance['head'], 'source shard binding differs')
            require(receipt.get('summary_sha256') == files[name + '/summary.json']['sha256'], 'source summary digest differs')
            tools = raw.get('tools', {})
            require(tools.get('release_check') == ask(git, 'rev-parse', '--verify', tested + ':tools/release_check.py').strip(),
                    'source release-check input hash differs')
            for path in release_check.harnesses():
                require(tools.get('harnesses', {}).get(path) == ask(git, 'rev-parse', '--verify', tested + ':' + path).strip(),
                        'source harness input hash differs: ' + path)
            steps = raw['steps']; selected = [s['name'] for s in steps]
            require(raw.get('tool') == release_check.TOOL and raw.get('commit') == tested
                    and raw.get('tree_unchanged') is True and raw.get('tree_after') == summary['tree_after']
                    and raw.get('only') == selected and not raw.get('skipped') and not raw.get('scoped')
                    and (raw.get('required') == summary['required'] or (partitioned and raw.get('required') == required)),
                    'dirty or partial source shard')
            assignment = receipt.get('shard', {}).get('steps')
            if isinstance(assignment, str):
                assignment = assignment.split(',')
            require(assignment == selected == plan[int(name.split('-')[1])], 'source shard assignment differs')
            require(shard.get('commit') == tested and shard.get('tree_unchanged') is True
                    and shard.get('tools') == tools and shard.get('steps') == selected, 'source shard provenance differs')
            for step in steps:
                name = step['name']; ran.append(name)
                require((partitioned and name == 'python-units') or (grouped and name == 'native-compose') or by_name.get(name) == step,
                        'source aggregate step differs')
                require(isinstance(inventory[name], (list, dict)) and bool(inventory[name]), 'empty source inventory')
                if grouped and name == 'native-compose':
                    receipts775 = compose_proof['collector']['receipts']
                    require(step.get('compose_receipt') in receipts775, 'source actual group receipt differs')
                    actual_receipt = step['compose_receipt']
                    actual_groups779.append(actual_receipt['group'])
                    require(provenance['plan'][int(shard['artifact'].split('-')[1])].get('compose_group', {}).get('id') == actual_receipt['group'],
                            'source group assigned to wrong workflow job')
                    require(step.get('passed') is actual_receipt['passed'] and step.get('exit') == actual_receipt['exit']
                            and step.get('counts') == {'tests': len(actual_receipt['results']),
                                                       'failed': sum(r['passed'] is False for r in actual_receipt['results'])},
                            'source group summary verdict differs')
                    continue
                if name in ci.NATIVE:
                    require(release_check.ran_whole(step), 'partial source browser mode')
                    rows = ci.cases(step, out, inventory[name])
                    for row in rows:
                        if row['passed'] is False and not (row.get('expectedFailure') and row.get('mutationCaught') is True):
                            words(row.get('error'))
                            reds.append({'step': name, 'case': ci.identity(row), 'observed': row})
                    report = read(shard['artifact'] + '/native/' + ci.NATIVE[name].name + '/' + ci.NATIVE[name].results)
                    teardown(report); reports.append(report)
                    # Persistence also needs its ordered start/result log.
                    counts, good = release_check.native_counts(ci.NATIVE[name], out / 'native' / ci.NATIVE[name].name,
                                                               (out / (name + '.log')).read_text())
                    require(canonical(counts) == canonical(step['counts']) and good is step['passed'], 'source case log differs')
                else:
                    if name in ci.UNITS:
                        if shard['artifact'] in empty_python:
                            require(not ci.unit_records((out / (name + '.log')).read_text(), node=False),
                                    'source empty Python partition has outcomes')
                            continue
                        reds.extend({'step': name, 'case': ci.identity(r), 'observed': observed}
                                    for r, observed in unit_results(step, out, expected_python.get(shard['artifact'], inventory[name])))
                    else:
                        reds.extend(replay_results(step, out, inventory[name]))
                if step['passed'] is not True:
                    raw_steps.append({k: step[k] for k in ('name', 'passed', 'exit', 'counts')})
            require(raw.get('passed') is all(s['passed'] for s in steps), 'source raw verdict differs')
        if grouped:
            union775 = compose_proof['collector']
            require(Counter(actual_groups779) == Counter(r['group'] for r in union775['receipts']), 'source missing/duplicate actual group execution')
            expected_step = {'name': 'native-compose', 'tool': 'compose-group-union-775',
                             'passed': union775['passed'], 'exit': 0 if union775['passed'] else 1,
                             'counts': {'tests': len(union775['results']), 'failed': len(union775['raw_false'])},
                             'compose_union': union775, 'shards': union775['receipts']}
            require(canonical(by_name['native-compose']) == canonical(expected_step), 'source genuine 775 collector aggregate differs')
            ran = [n for n in ran if n != 'native-compose'] + ['native-compose']
            if compose_proof.get('mode') == 'fresh-one-run':
                for row in union775['raw_false']:
                    if not (row.get('expectedFailure') is True and row.get('mutationCaught') is True):
                        words(row.get('error'))
                        reds.append({'step':'native-compose','case':ci.identity(row),'observed':row})
            if not compose_proof['passed']:
                raw_steps.append({k: expected_step[k] for k in ('name', 'passed', 'exit', 'counts')})
        if partitioned:
            ran = [name for name in ran if name != 'python-units'] + ['python-units']
        require(Counter(ran) == Counter(required), 'incomplete source shard coverage')
        require(summary.get('passed') is all(s['passed'] for s in summary['steps']), 'source aggregate verdict differs')
        report_hashes(reports, git, tested)
        audit_reds(source, judgment, head, reds)
        return {'passed': summary['passed'], 'run': source['run'], 'attempt': source['attempt'],
                'failed': summary['failed'], 'steps': raw_steps, 'red_count': len(reds), 'controller': controller,
                **({'compose': grouped_admission.record(compose_proof)} if grouped else {})}


def legacy_own_receipt(receipt, git, assembly, assembly_tree, expected):
    measured_source = snapshot(receipt['snapshot'], git, assembly, assembly_tree)
    step = document(receipt['step']); report = document(receipt['report']); log = artifact(receipt['log']).decode()
    name = step['name']; require(name in ci.NATIVE, 'unknown receipt step')
    teardown(report)
    native = ci.NATIVE[name]
    argv = step.get('argv')
    require(isinstance(argv, list) and all(isinstance(arg, str) and bool(arg) for arg in argv)
            and len(argv) in (4 + len(native.flags), 5 + len(native.flags))
            and argv[1] == native.harness and argv[4:4 + len(native.flags)] == list(native.flags)
            and step.get('tool') == native.harness, 'own-case command/harness binding differs')
    if native.results != 'results.json':
        require('fixtureExitSignal' in report, 'fixture cleanup signal is absent')
    require(ci.NATIVE[name].harness in measured_source['inputs'], 'missing harness source input hash')
    rows = report.get('results')
    require(isinstance(rows, list) and bool(rows), 'missing receipt cases')
    keys = []
    for row in rows:
        require(isinstance(row, dict) and row.get('passed') is True and not row.get('expectedFailure'), 'own case did not pass')
        native = ci.NATIVE[name]
        engines = ('webkit',) if native.harness == release_check.WEBKIT else (
            ('chromium', 'webkit') if native.harness in (release_check.COMPOSE, release_check.FENCE_COPY, release_check.CARD_MARKS)
            else ('chromium',))
        require(row.get('engine') in engines, 'receipt engine differs from harness')
        key = (name, row['name'], row.get('phase'), row.get('engine'))
        require(key in expected, 'wrong own case or engine')
        keys.append(key)
    require(len(keys) == len(set(keys)), 'duplicate case in receipt')
    # Use the established harness validators, including end/fixture and
    # browser cleanup. Each receipt is its own native output folder.
    with tempfile.TemporaryDirectory(prefix='train-own-case-') as temp:
        out = Path(temp); native = ci.NATIVE[name]
        folder = out / 'native' / native.name; folder.mkdir(parents=True)
        (folder / native.results).write_bytes(artifact(receipt['report']))
        (out / (name + '.log')).write_text(log)
        ci.cases(step, out, rows)
        counts, good = release_check.native_counts(native, folder, log)
        require(good and step.get('passed') is True and type(step.get('exit')) is int and step['exit'] == 0
                and canonical(step.get('counts')) == canonical(counts), 'own-case counts/status differ')
    return keys


def own_receipt(receipt, git, github, repository, assembly, assembly_tree, expected):
    if isinstance(receipt, dict) and 'pool' in receipt:
        from tools import own_case_receipt
        return own_case_receipt.validate(receipt, git, github, repository, assembly, assembly_tree, expected)
    fields(receipt, 'snapshot step report log')
    return legacy_own_receipt(receipt, git, assembly, assembly_tree, expected), None


# Exact reviewed test bytes, not a manifest-selected path family or hash policy.
# This unit imports product code; product does not gain adaptation permission.
TEST_ADAPTATION_PATH = 'tests/ui_card_editor_652.test.mjs'
TEST_ADAPTATION_BLOBS = {
    'original_blob': None,
    'source_blob': '23f57444c36c5a163f76b35ef7810532ab3af46a',
    'live_blob': None,
    'assembly_blob': '8a18797a497672deefb66ba90cf42c15d3e2c4d9',
}
TEST_ADAPTATION_REASON = ('Preserve live item 644 pointer focus(preventScroll) without forced reveal '
                          'or scrolling on ordinary redraw at all four widths.')


TEST_ADAPTATIONS = {TEST_ADAPTATION_PATH: dict(TEST_ADAPTATION_BLOBS, reason=TEST_ADAPTATION_REASON),
    'tests/card_editor_652.mjs': {'original_blob': None, 'source_blob': '68f60f880e532186cc49b972b3208a46203e4dfe', 'live_blob': None, 'assembly_blob': 'cb188b6c11f8aee76f61332e32e302ea45522736', 'reason': 'Preserve native press/focus requirements, retain original causes, capture missing delivery/media/failure evidence and unique normal/mutant/restored geometry; unchanged456 identities and six phases.'},
    'tests/ui_card_editor_652_contract.test.mjs': {'original_blob': None, 'source_blob': None, 'live_blob': None, 'assembly_blob': 'b90dc6e506d7c474e27e6bb4009e4f3e168a6bfa', 'reason': 'New browser-free contract checks hold phone-width44px rule and truthful diagnostic/error/phase preservation.'},
    # Warp8778: exact document/test bytes only; no product adaptation permission.
    'docs/dossier-covers.md': {'original_blob': '405543b6bf11eb290f3276c7c82767a15d5d3327',
 'source_blob': 'dc2a2964d5a92f0e6cd4897f885b11001ff70e11',
 'live_blob': '405543b6bf11eb290f3276c7c82767a15d5d3327',
 'assembly_blob': 'd28833e622ce354a8aa134cfa1992f088970752b',
 'reason': 'Document the requested-width fit boundary with unchanged 2px tolerance, native Tab diagnostics and '
           'separate mutant/restored results; no product or key mapping change.'},
    'tests/dossier_promises_native.mjs': {'original_blob': None,
 'source_blob': 'bfa1b3e7ccedac3829910d591c3b07abbf0e1590',
 'live_blob': None,
 'assembly_blob': '3d5d3338854685301cec3e631166390d15b11c02',
 'reason': 'Bound fit to requested and actual viewports, observe native Tab delivery/calibration without changing '
           'acceptance, retain every mutant error and separate exact restored control, and snapshot eight '
           'additional actual sources; fourteen identities and 2px tolerance unchanged.'},
    'tests/outline_stars_native.mjs': {'original_blob': None, 'source_blob': '02fe0a1f2b9b4a0a868e59f686562b970cd6ca02', 'live_blob': None, 'assembly_blob': '80d840ed8e40beead225e8519bcbd3e368844bda', 'reason': 'Retain every original assertion and identity; add only35 state/reopen/readiness lines for the original visible, loaded, nonbusy dossier row after native phone drawer reopening, with bounded failure evidence.'},
    'tests/webkit_native.mjs': {'original_blob': 'da3db531d43497916f8108d207a7e1df9e87a279', 'source_blob': 'ec212d08a9d23f7e9230e20faea7acca6bd6227e', 'live_blob': 'da3db531d43497916f8108d207a7e1df9e87a279', 'assembly_blob': 'a3bacaba479930e26eccc3675d05074b9d39b55d', 'reason': 'Correct only the stale SKIPPED key to the exact offered picture-link Return name; retain HELD, its qualification and the missing-offer guard; no picture behavior pass.'},
}


def resolution_scope(git, old, head, live, assembly, review, adaptations):
    """Compare every Git entry; only the explicit reviewed test bytes may differ."""
    require(isinstance(adaptations, list), 'invalid test adaptations')
    listed = {}
    original, source, base, result = (entries(git, h) for h in (old, head, live, assembly))
    for row in adaptations:
        fields(row, 'path original_blob source_blob live_blob assembly_blob reason')
        path = row['path']
        require(isinstance(path, str) and path in TEST_ADAPTATIONS, 'unsupported test adaptation path')
        bound = TEST_ADAPTATIONS[path]
        require(path not in listed, 'duplicate test adaptation')
        require(row['reason'] == bound['reason'], 'test adaptation reason differs')
        require({k: row[k] for k in TEST_ADAPTATION_BLOBS} == {k: bound[k] for k in TEST_ADAPTATION_BLOBS},
                'test adaptation reviewed blobs differ')
        for key, actual in (('original_blob', original), ('source_blob', source),
                            ('live_blob', base), ('assembly_blob', result)):
            claimed = row[key]
            expected = None if claimed is None else '100644 blob ' + sha(claimed)
            require(actual.get(path) == expected, 'test adaptation Git entry differs: ' + key)
        listed[path] = row
    paths = set(original) | set(source) | set(base) | set(result)
    overlap, applied = [], set()
    for path in paths:
        own_changed = source.get(path) != original.get(path)
        base_changed = base.get(path) != original.get(path)
        if own_changed and base_changed:
            overlap.append(path)
        else:
            expected = base.get(path) if base_changed else source.get(path)
            if path in listed:
                require(result.get(path) != expected, 'inapplicable test adaptation')
                applied.add(path)
            else:
                require(result.get(path) == expected, 'scope widening or approved/base changes lost: ' + path)
    require(applied == set(listed), 'unapplied test adaptation')
    require(isinstance(review['conflict_paths'], list) and Counter(review['conflict_paths']) == Counter(overlap),
            'resolution path scope differs')


def validate(ref, judgment, git, github, repository, live, merge, items, merged_pull, pr_number, release_branch):
    """The verified record, including all artifact references and review, or refusal."""
    try:
        data = document(ref)
        names = 'version source_head original_base live_base live_release assembly_head assembly_tree source receipts review'
        fields(data, names + ' test_adaptations' if isinstance(data, dict) and 'test_adaptations' in data else names)
        adaptations = []
        if 'test_adaptations' in data:
            adaptations = data['test_adaptations']
            require(isinstance(adaptations, list) and bool(adaptations), 'empty or invalid test adaptations')
        require(type(data['version']) is int and data['version'] == 4, 'unknown version')
        for key in ('source_head', 'original_base', 'live_base', 'assembly_head', 'assembly_tree'):
            sha(data[key])
        number(data['live_release'])
        head, old, assembly = data['source_head'], data['original_base'], data['assembly_head']
        require(data['live_base'] == live and old != live, 'stale or unchanged live base')
        require(judgment['head'] == head, 'source judgment head differs')
        require(len({i['item'] for i in items}) == len(items), 'duplicate approved item')
        ancestor(git, old, head); ancestor(git, old, live)
        require(git('merge-base', '--is-ancestor', head, live).returncode == 1, 'source already in live base')
        require(ask(git, 'merge-base', head, live).strip() == old, 'original base is not the exact common base')
        require(parents(git, assembly) == [head, live], 'assembly parents differ')
        require(parents(git, merge) == [live, assembly], 'release merge parents differ')
        require(tree(git, assembly) == data['assembly_tree'] == tree(git, merge), 'assembly tree differs')
        for item in items:
            ancestor(git, item['approved_head'], head)
        review = fields(document(data['review']), 'reviewer record judgment_audit evidence_sha256 diff conflict_paths obligations')
        words(review['reviewer']); words(review['record'])
        require(review['record'] != judgment['audit'] and review['judgment_audit'] == judgment['audit'], 'independent resolution review missing')
        body = {k: v for k, v in data.items() if k != 'review'}
        require(review['evidence_sha256'] == digest(canonical(body)), 'review binding differs')
        # git's output file preserves arbitrary file bytes (text-mode subprocess
        # stdout would normalise CRLF inside the patch).
        with tempfile.TemporaryDirectory(prefix='train-resolution-') as temp:
            patch = Path(temp) / 'resolution.diff'
            ask(git, 'diff', '--binary', '--full-index', '--no-ext-diff', '--no-textconv',
                '--output=' + str(patch), head, assembly)
            actual_diff = patch.read_bytes()
        require(artifact(review['diff']) == actual_diff, 'reviewed resolution diff differs')
        resolution_scope(git, old, head, live, assembly, review, adaptations)
        merged_context = {'pull': merged_pull, 'number': pr_number, 'release_branch': release_branch,
                          'merge': merge, 'assembly': assembly, 'live': live,
                          'original_base': old, 'source_head': head}
        observed = full_source(data['source'], judgment, git, github, repository, head, merged_context)
        obligations = review['obligations']
        require(isinstance(obligations, list) and bool(obligations), 'missing own-case obligations')
        expected = []
        for row in obligations:
            fields(row, 'step case phase engine')
            require(row['step'] in ci.NATIVE and isinstance(row['case'], str) and bool(row['case'])
                    and row['engine'] in ('chromium', 'webkit') and (row['phase'] is None or isinstance(row['phase'], str)),
                    'invalid own-case obligation')
            expected.append((row['step'], row['case'], row['phase'], row['engine']))
        require(len(expected) == len(set(expected)), 'duplicate own-case obligation')
        for step, case, phase, engine in expected:
            require(all(any(c == case and p == phase and eng == e for _, c, p, eng in expected)
                        for e in ('chromium', 'webkit')), 'partial engine obligations')
        require(isinstance(data['receipts'], list) and bool(data['receipts']), 'missing own-case receipts')
        got, unique, derived_receipts = Counter(), set(), []
        for receipt in data['receipts']:
            require(isinstance(receipt, dict), 'invalid own-case receipt')
            fields(receipt, 'snapshot step report log pool' if 'pool' in receipt else 'snapshot step report log')
            identity = tuple(receipt[k]['sha256'] for k in ('snapshot', 'step', 'report', 'log'))
            require(identity not in unique, 'duplicate own-case receipt')
            unique.add(identity)
            keys, derived = own_receipt(receipt, git, github, repository, assembly, data['assembly_tree'], expected)
            if derived is not None:
                derived_receipts.append(derived)
            got.update(keys)
        require(got == Counter({key: 1 for key in expected}), 'need one passing receipt for every own case and engine')
        # Keep the complete frozen manifest by digest, rather than exceeding
        # Core's release-measurement size bound with all downloaded file paths.
        result = {k: data[k] for k in ('version', 'source_head', 'original_base', 'live_base', 'live_release',
                                      'assembly_head', 'assembly_tree', 'review')}
        result.update(evidence=ref, source_observed=observed,
                      source={k: data['source'][k] for k in ('run', 'attempt', 'tested_merge', 'base_at_run', 'inventory', 'audit')},
                      receipts={'artifacts_sha256': digest(canonical(data['receipts'])),
                                'count': len(data['receipts']), 'obligations': obligations})
        if derived_receipts:
            result['receipts']['pool'] = derived_receipts
        result['source'].update(summary=data['source']['files']['release-check/summary.json'],
                                provenance=data['source']['files']['release-check/provenance.json'],
                                artifacts_sha256=digest(canonical(data['source']['files'])))
        for evidence_kind in ('continuation', 'compose'):
            if evidence_kind in data['source']:
                result['source'][evidence_kind] = data['source'][evidence_kind]
        return result
    except (ci.Refused, OSError, ValueError, KeyError, TypeError, AttributeError, RecursionError, zipfile.BadZipFile, tarfile.TarError) as error:
        raise Refused('base move: invalid or incomplete evidence: %s' % error)

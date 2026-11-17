from __future__ import annotations

"""Consume frozen evidence for a reviewed base move; never run candidate code.

See docs/base-move-evidence.md. Attribution of independent review and selection
of affected own cases remain human judgments, explicitly bound to exact bytes.
"""
import hashlib
import json
from pathlib import Path, PurePosixPath
import re
import tempfile
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


def full_source(source, judgment, git, github, repository, head):
    fields(source, 'run attempt files inventory')
    number(source['run']); number(source['attempt'])
    require([r['id'] for r in judgment['producer_runs']] == [source['run']], 'source run binding differs')
    run = github.get('repos/%s/actions/runs/%d' % (repository, source['run']))
    require(run.get('head_sha') == head and run.get('status') == 'completed'
            and run.get('conclusion') == judgment['producer_runs'][0]['conclusion']
            and run.get('run_attempt') == source['attempt'] and run.get('path') == '.github/workflows/checks.yml'
            and run.get('name') == 'Checks' and run.get('conclusion') in ('success', 'failure'), 'source run identity differs')
    url = 'https://github.com/%s/actions/runs/%d' % (repository, source['run'])
    for check in judgment['verdict_checks']:
        raw = github.get('repos/%s/check-runs/%d' % (repository, check['id']))
        require(raw.get('head_sha') == head and raw.get('status') == 'completed'
                and raw.get('conclusion') == check['conclusion']
                and raw.get('conclusion') in ('success', 'failure'), 'incomplete source check verdict')
        details = raw.get('details_url')
        bound_urls = (url + '/attempts/%d' % source['attempt'],) + ((url,) if source['attempt'] == 1 else ())
        if details not in bound_urls:
            # GitHub job checks link to /job/ID. Bind those to the original
            # attempt's actual jobs, rather than trusting a URL prefix alone.
            job = re.fullmatch(re.escape(url) + r'/job/([1-9][0-9]*)(?:\?pr=[1-9][0-9]*)?', details or '')
            require(job is not None, 'source check binding differs')
            jobs, total, page = [], None, 1
            while total is None or len(jobs) < total:
                listed = github.get('repos/%s/actions/runs/%d/attempts/%d/jobs?per_page=100&page=%d' % (
                    repository, source['run'], source['attempt'], page))
                count, batch = listed.get('total_count'), listed.get('jobs')
                require(type(count) is int and 0 < count <= 1000 and (total is None or total == count)
                        and isinstance(batch, list) and 0 < len(batch) <= 100, 'source job inventory unreadable')
                total = count; jobs.extend(batch); page += 1
                require(len(jobs) <= total and len({j['id'] for j in jobs}) == len(jobs), 'source job inventory differs')
            check_url = 'https://api.github.com/repos/%s/check-runs/%d' % (repository, check['id'])
            require(any(j.get('id') == int(job[1]) and j.get('check_run_url') == check_url for j in jobs),
                    'source check binding differs from run attempt jobs')
    inventory = document(source['inventory'])
    require(isinstance(inventory, dict) and set(inventory) == set(release_check.REQUIRED), 'incomplete source inventory')
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
        source_parents = parents(git, head)
        expected_merge = {'sha': head, 'tree': tree(git, head),
                          'first_parent': source_parents[0] if source_parents else None,
                          'second_parent': source_parents[1] if len(source_parents) > 1 else None}
        require(len(source_parents) <= 2 and provenance.get('merge') == expected_merge, 'source merge binding differs')
        require(summary.get('tool') == release_check.TOOL and summary.get('commit') == head
                and summary.get('tree_unchanged') is True
                and summary.get('tree_after') == {'head': head, 'changes': ''}, 'dirty or wrong complete source')
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
        ran = []
        for shard in shards:
            name = shard['artifact']; out = root / name
            raw = read(name + '/summary.json'); receipt = read(name + '/run.json')
            ci.same_run(receipt.get('run'), expected_run)
            require(shard.get('receipt') == receipt and not shard.get('refused')
                    and receipt.get('merge') == provenance['merge'], 'source shard binding differs')
            require(receipt.get('summary_sha256') == files[name + '/summary.json']['sha256'], 'source summary digest differs')
            tools = raw.get('tools', {})
            require(tools.get('release_check') == ask(git, 'rev-parse', '--verify', head + ':tools/release_check.py').strip(),
                    'source release-check input hash differs')
            for path in release_check.harnesses():
                require(tools.get('harnesses', {}).get(path) == ask(git, 'rev-parse', '--verify', head + ':' + path).strip(),
                        'source harness input hash differs: ' + path)
            steps = raw['steps']; selected = [s['name'] for s in steps]
            require(raw.get('tool') == release_check.TOOL and raw.get('commit') == head
                    and raw.get('tree_unchanged') is True and raw.get('tree_after') == summary['tree_after']
                    and raw.get('only') == selected and not raw.get('skipped') and not raw.get('scoped')
                    and raw.get('required') == summary['required'], 'dirty or partial source shard')
            require(receipt.get('shard', {}).get('steps') == selected, 'source shard assignment differs')
            for step in steps:
                name = step['name']; ran.append(name)
                require(by_name.get(name) == step, 'source aggregate step differs')
                require(isinstance(inventory[name], (list, dict)) and bool(inventory[name]), 'empty source inventory')
                if name in ci.NATIVE:
                    require(release_check.ran_whole(step), 'partial source browser mode')
                    ci.cases(step, out, inventory[name])
                    # Persistence also needs its ordered start/result log.
                    counts, good = release_check.native_counts(ci.NATIVE[name], out / 'native' / ci.NATIVE[name].name,
                                                               (out / (name + '.log')).read_text())
                    require(counts == step['counts'] and good is step['passed'], 'source case log differs')
                else:
                    require(step.get('passed') is True and type(step.get('exit')) is int and step['exit'] == 0,
                            'source non-browser step did not pass')
                    if name in ci.UNITS:
                        ci.unit_evidence(step, out, inventory[name])
                    else:
                        ci.replay_evidence(step, out, inventory[name])
            require(raw.get('passed') is all(s['passed'] for s in steps), 'source raw verdict differs')
        require(Counter(ran) == Counter(required), 'incomplete source shard coverage')
        require(summary.get('passed') is all(s['passed'] for s in summary['steps']), 'source aggregate verdict differs')
        return {'passed': summary['passed'], 'run': source['run'], 'attempt': source['attempt']}


def validate(ref, judgment, git, github, repository, live, merge, items):
    """The verified record, including all artifact references and review, or refusal."""
    try:
        data = fields(document(ref), 'version source_head original_base live_base live_release assembly_head assembly_tree source receipts review')
        require(type(data['version']) is int and data['version'] == 1, 'unknown version')
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
        original, source, base, result = (entries(git, h) for h in (old, head, live, assembly))
        paths = set(original) | set(source) | set(base) | set(result)
        overlap = []
        for path in paths:
            own_changed = source.get(path) != original.get(path)
            base_changed = base.get(path) != original.get(path)
            if own_changed and base_changed:
                overlap.append(path)
            else:
                expected = base.get(path) if base_changed else source.get(path)
                require(result.get(path) == expected, 'scope widening or approved/base changes lost: ' + path)
        require(isinstance(review['conflict_paths'], list) and Counter(review['conflict_paths']) == Counter(overlap),
                'resolution path scope differs')
        observed = full_source(data['source'], judgment, git, github, repository, head)
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
        got, unique = Counter(), set()
        for receipt in data['receipts']:
            fields(receipt, 'snapshot step report log')
            identity = tuple(receipt[k]['sha256'] for k in ('snapshot', 'step', 'report', 'log'))
            require(identity not in unique, 'duplicate own-case receipt')
            unique.add(identity)
            measured_source = snapshot(receipt['snapshot'], git, assembly, data['assembly_tree'])
            step = document(receipt['step']); report = document(receipt['report']); log = artifact(receipt['log']).decode()
            name = step['name']; require(name in ci.NATIVE, 'unknown receipt step')
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
                        and step.get('counts') == counts, 'own-case counts/status differ')
            got.update(keys)
        require(got == Counter({key: 3 for key in expected}), 'need three passing receipts for every own case and engine')
        # Keep the complete frozen manifest by digest, rather than exceeding
        # Core's release-measurement size bound with all downloaded file paths.
        result = {k: data[k] for k in ('version', 'source_head', 'original_base', 'live_base', 'live_release',
                                      'assembly_head', 'assembly_tree', 'review')}
        result.update(evidence=ref, source_observed=observed,
                      source={k: data['source'][k] for k in ('run', 'attempt', 'inventory')},
                      receipts={'artifacts_sha256': digest(canonical(data['receipts'])),
                                'count': len(data['receipts']), 'obligations': obligations})
        result['source'].update(summary=data['source']['files']['release-check/summary.json'],
                                provenance=data['source']['files']['release-check/provenance.json'],
                                artifacts_sha256=digest(canonical(data['source']['files'])))
        return result
    except (ci.Refused, OSError, ValueError, KeyError, TypeError, AttributeError, RecursionError) as error:
        raise Refused('base move: invalid or incomplete evidence: %s' % error)

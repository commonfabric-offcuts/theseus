from __future__ import annotations

"""Read exact reviewed Pool schemas without executing candidate source.

Only exact reviewed source bytes authorize interpretation. Raw originals remain
Refs; command and neutral identities are explicitly derived, never raw fields.
"""
from collections import Counter
import io
from datetime import datetime, timedelta
import re
import tarfile
import tempfile
from pathlib import Path
import zipfile

from tools import base_move as b, ci_known_reds as ci
from tools import own_case_profiles_8821 as final_profiles

WORKFLOW = '.github/workflows/pool.yml'
SPEC = '.github/pool-run.json'
# Reviewed original code at c4af1c6, not the installed validator or a manifest
# override. The explicitly narrow 652 fallback below retains this 651 profile.
# Any other command/harness convention needs a new reviewed adapter.
SOURCES = {
    WORKFLOW: 'f5cfaa27bccf2348d7024a5bbfdf00e4a724b281cd7680ea16ddd0a226fd9faa',
    'tools/native.py': '2aa3f4ea33eefd5e2e9c9bf81c112078f95d90817ad25a52d6224db36f5ea73e',
    'tools/release_check.py': 'f59a8689f461366e4582783cf553c0d826a9331ab41876ea33cd2934721ffef3',
    'tests/thumbnail_open_native.mjs': '77c7e28ae2288811115c191906ca20e253974c0098dae83a69bf2331169e5fa0',
    'tests/reader_compose_native.mjs': '5c2a6b88fb9068fe32adc4a199101a2ecd4e4bc622dcdf738bbf3c6457589cac',
}
COMPOSE = 'tests/reader_compose_native.mjs'
# Reviewed at 10c4ca6ecfa8e77e0986b0b16838c60a5a9cacc4. These constants,
# never a spec/receipt claim, authorize the additional exact filter.
COMPOSE_652 = 'ee64a06f2626d5cd7c2893b65727168d03a240e87eb06b13a5094be5ea1f76ee'
HELPER_652 = {'tests/card_editor_652.mjs': '11b2e0570b7c6be12515a0551f75a49af593cd2c95cb84211e26b186f31716a6'}
# Exact8652 diagnostic correction; original profile remains separate and valid.
HELPER_652_CORRECTED = {'tests/card_editor_652.mjs': 'e400b065311cc5212a14ed8eeff5ab536dd2f6967b2bb7a0ed450d68d9e44c6d'}
# Narrow fallback: independent producer test trees bind all imports and fixtures.
FAMILIES = {'717': {'head': 'f31e319994ecc96c5565828a53fde75c01bd3386',
         'tests_tree': '4371130014b2cab2853e8831516c2d1f5cfb1f75',
         'sources': {'tests/reader_persistence_native.mjs': 'ff89beeadcaefd631ceaa273fcc22ddfdf0a6f28224ddc18eac6bf7b7aa8b608',
                     'tests/webkit_native.mjs': 'd3f7638a39a10ae26845def968b26da1c2ca4fdbae4d9c0a5c266956065d13f3',
                     'tests/native-calls.mjs': 'f3121cf9108a017a77224191b88615618dc152e464de9b42abb7f6c591f3633c',
                     'tests/native-page-cleanup.mjs': '1f087302cc6eaca7ffc304a6ec64204d8cb7b59745224ef533fb0fd0a2e14e99',
                     'tests/release-rule.mjs': 'b34d024358d9d98ce80434dd080c44eed590253a0ca021a0dafac91370c8268f',
                     'tests/press-fell.mjs': '1b8b2a2b779e76033b3d4502178fb87b102b0d21c77a387f53964a02d7e1ebd5',
                     'tests/fixtures/ui_http.py': '8b935a49acdf454148b8be960b46d2a5e3e2977a7ba27286115f2c8220b11a59',
                     'tests/topic_reading_native.mjs': '855831061528c1c02be140f02e0b8b49b8205f170f9e5b1398db94f87a961fac',
                     'tests/stack_native.mjs': 'ec82b0e865d17a6211f808f7be186623aca9eed1e722402a2b06402af8f550ed',
                     'tests/dossier_promises_native.mjs': 'e46e1d55452b278f917d82c8d13dab88fbbee3115008c90925a2be18c6e2b044'}},
 '715': {'head': '5903d8b8fac63b8b4e6d191dbc8d59db5094d9b0',
         'tests_tree': '144582b8de007234d4552ea81c2d4035c0cf7d28',
         'sources': {'tests/reader_persistence_native.mjs': 'b0e81544d9be87d6aa8e28187407296dec1705c7e438f97a01944e3855a54f2b',
                     'tests/webkit_native.mjs': '4db15fd3c3315c1fd0f47ec97263abda40cb42b3edaaa585ac4d43fe1a05e3ae',
                     'tests/native-calls.mjs': 'f3121cf9108a017a77224191b88615618dc152e464de9b42abb7f6c591f3633c',
                     'tests/native-page-cleanup.mjs': '1f087302cc6eaca7ffc304a6ec64204d8cb7b59745224ef533fb0fd0a2e14e99',
                     'tests/release-rule.mjs': 'b34d024358d9d98ce80434dd080c44eed590253a0ca021a0dafac91370c8268f',
                     'tests/press-fell.mjs': '1b8b2a2b779e76033b3d4502178fb87b102b0d21c77a387f53964a02d7e1ebd5',
                     'tests/fixtures/ui_http.py': 'ab614f015bce3dd0845e8e4e1070c66ad8b7858a62d101f13092be8ccea1b622',
                     'tests/outcome_rail_native.mjs': 'b5797308e822dfea0550830f1a91c30018b90e57664721a945cee38a25d952ef',
                     'tests/outline_stars_native.mjs': '6c196bb9fad58b3c506fed333cc4c5cafecc8efec70aeee391f10cdf967c0ee9',
                     'tests/outline_stars_oracle.mjs': 'f71cd4ac0d88755ea25a64224bb75cac61f208e8ed23ff5044e3ec3b3715bd16'}}}
# Independently reviewed assembly binding (warp8750); never receipt-supplied.
# Original FAMILIES and the copied e6 profile remain exact.
ASSEMBLY_717 = {'head': 'e6f6e5ec30b553511a839252d3aff73bbc12819d',
 'tests_tree': 'ed9493b450303989e6c12c560b38ee0c75101e52',
 'sources': {'tests/reader_persistence_native.mjs': 'ff89beeadcaefd631ceaa273fcc22ddfdf0a6f28224ddc18eac6bf7b7aa8b608',
             'tests/webkit_native.mjs': 'd3f7638a39a10ae26845def968b26da1c2ca4fdbae4d9c0a5c266956065d13f3',
             'tests/native-calls.mjs': 'f3121cf9108a017a77224191b88615618dc152e464de9b42abb7f6c591f3633c',
             'tests/native-page-cleanup.mjs': '1f087302cc6eaca7ffc304a6ec64204d8cb7b59745224ef533fb0fd0a2e14e99',
             'tests/release-rule.mjs': 'b34d024358d9d98ce80434dd080c44eed590253a0ca021a0dafac91370c8268f',
             'tests/press-fell.mjs': '1b8b2a2b779e76033b3d4502178fb87b102b0d21c77a387f53964a02d7e1ebd5',
             'tests/fixtures/ui_http.py': '8b935a49acdf454148b8be960b46d2a5e3e2977a7ba27286115f2c8220b11a59',
             'tests/topic_reading_native.mjs': '855831061528c1c02be140f02e0b8b49b8205f170f9e5b1398db94f87a961fac',
             'tests/stack_native.mjs': '55c328660130b03be5daa108187010780ec5fc716d7b0adfdc85962ab3c18b70',
             'tests/dossier_promises_native.mjs': 'e46e1d55452b278f917d82c8d13dab88fbbee3115008c90925a2be18c6e2b044'}}
# Actual sibling assembly literals (warp8775/8778); source-only, no native approval.
ASSEMBLY_715 = {'head': 'd9b93adfabed0e960a14febf9975de294429248b',
 'tests_tree': 'cc5a7e74dc16adf9c81fa633fd27b2047f40eb39',
 'sources': {'tests/reader_persistence_native.mjs': 'b0e81544d9be87d6aa8e28187407296dec1705c7e438f97a01944e3855a54f2b',
             'tests/webkit_native.mjs': '4db15fd3c3315c1fd0f47ec97263abda40cb42b3edaaa585ac4d43fe1a05e3ae',
             'tests/native-calls.mjs': 'f3121cf9108a017a77224191b88615618dc152e464de9b42abb7f6c591f3633c',
             'tests/native-page-cleanup.mjs': '1f087302cc6eaca7ffc304a6ec64204d8cb7b59745224ef533fb0fd0a2e14e99',
             'tests/release-rule.mjs': 'b34d024358d9d98ce80434dd080c44eed590253a0ca021a0dafac91370c8268f',
             'tests/press-fell.mjs': '1b8b2a2b779e76033b3d4502178fb87b102b0d21c77a387f53964a02d7e1ebd5',
             'tests/fixtures/ui_http.py': 'ab614f015bce3dd0845e8e4e1070c66ad8b7858a62d101f13092be8ccea1b622',
             'tests/outcome_rail_native.mjs': '5835f965cf4035e56524fe37c627e7f1abb1d4de63c834c0bf9494cb6c00b9b8',
             'tests/outline_stars_native.mjs': '6c196bb9fad58b3c506fed333cc4c5cafecc8efec70aeee391f10cdf967c0ee9',
             'tests/outline_stars_oracle.mjs': 'f71cd4ac0d88755ea25a64224bb75cac61f208e8ed23ff5044e3ec3b3715bd16'}}
FINAL_717 = {'head': 'dddf00e171fa3924f12e9a1c4f20cac5a6602d3c',
 'tests_tree': 'aa3a1417a26e171e33d89e778c34edd16dd24ef4',
 'sources': {'tests/reader_persistence_native.mjs': 'ff89beeadcaefd631ceaa273fcc22ddfdf0a6f28224ddc18eac6bf7b7aa8b608',
             'tests/webkit_native.mjs': 'd3f7638a39a10ae26845def968b26da1c2ca4fdbae4d9c0a5c266956065d13f3',
             'tests/native-calls.mjs': 'f3121cf9108a017a77224191b88615618dc152e464de9b42abb7f6c591f3633c',
             'tests/native-page-cleanup.mjs': '1f087302cc6eaca7ffc304a6ec64204d8cb7b59745224ef533fb0fd0a2e14e99',
             'tests/release-rule.mjs': 'b34d024358d9d98ce80434dd080c44eed590253a0ca021a0dafac91370c8268f',
             'tests/press-fell.mjs': '1b8b2a2b779e76033b3d4502178fb87b102b0d21c77a387f53964a02d7e1ebd5',
             'tests/fixtures/ui_http.py': '8b935a49acdf454148b8be960b46d2a5e3e2977a7ba27286115f2c8220b11a59',
             'tests/topic_reading_native.mjs': '855831061528c1c02be140f02e0b8b49b8205f170f9e5b1398db94f87a961fac',
             'tests/stack_native.mjs': '55c328660130b03be5daa108187010780ec5fc716d7b0adfdc85962ab3c18b70',
             'tests/dossier_promises_native.mjs': '1d2472157ec5f3cbeb4d3bb9c18c0336d08a1f7920fa1e52e5a669b14787b4a0'}}
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


def title_log_records(lines, rows, webkit):
    """Consume only the pinned656 reporter's diagnostics in their actual order.

    These are assertions inside a single native case, not extra executions.
    Original raw logs remain bound by their archive and Ref.
    """
    remaining = iter(lines)
    records = []

    def take(names):
        value = next(remaining, None)
        return b.fields(value, names)

    def caught(value):
        b.require(isinstance(value, str) and bool(value.strip())
                  and re.search(r'title|pencil|renam|focus|settings', value, re.I),
                  'Pool656 missing intended mutant failure')

    for i, row in enumerate(rows):
        if not webkit:
            records.append(take('case started'))
        if i == 0:
            old = final_profiles.OLDHEAD_656
            red = take('item oldhead red_source fixed_source caught exact_restoration')
            b.require(type(red['item']) is int and red['item'] == 656
                      and red['oldhead'] == old['head'] and red['red_source'] == old['red_source']
                      and red['fixed_source'] == old['fixed_source'] and red['exact_restoration'] is True
                      and isinstance(red['caught'], str)
                      and 'permission rebuild restores the header title' in red['caught'],
                      'Pool656 oldhead source/restoration differs')
            restored = take('item oldhead restored_control_passed')
            b.require(restored == {'item': 656, 'oldhead': old['head'], 'restored_control_passed': True}
                      and type(restored['item']) is int, 'Pool656 oldhead restored control missing')
        elif i == 65:
            base = take('item base_screenshots restored')
            b.require(base == {'item': 656, 'base_screenshots': '833d2a153f6fb98ff41c63f0736791f76a1188a8',
                               'restored': True} and type(base['item']) is int,
                      'Pool656 base comparison restoration differs')
        elif i >= 66:
            name, pins = final_profiles.MUTANTS_656[i - 66]
            failure = take('item mutation failed_case')
            b.require(type(failure['item']) is int and failure['item'] == 656
                      and failure['mutation'] == name, 'Pool656 mutation identity differs')
            caught(failure['failed_case'])
            for path, before, mutated in pins:
                trail = take('item mutation file before mutated caught')
                b.require(type(trail['item']) is int and trail['item'] == 656
                          and trail['mutation'] == name and isinstance(trail['file'], str)
                          and Path(trail['file']).is_absolute() and trail['file'].endswith('/' + path)
                          and trail['before'] == before and trail['mutated'] == mutated
                          and trail['caught'] == failure['failed_case'],
                          'Pool656 applied mutation source differs')
            restored = take('item mutation restored_control_passed')
            b.require(restored == {'item': 656, 'mutation': name, 'restored_control_passed': True}
                      and type(restored['item']) is int, 'Pool656 mutant restored control missing')
        records.append(take('name passed engine ms' if webkit else 'name passed started finished'))
    exhausted = object()
    b.require(next(remaining, exhausted) is exhausted, 'Pool656 extra ordered log record')
    return records


def family_results(contents, step, native_step, case_filter, expected, literal_item=None):
    """Interpret only the independently pinned reading/rail reporter families.

    This has no source evaluator. Callers must first verify FAMILIES and the
    shared Pool provenance. Standalone test calls prove parsing, not admission.
    """
    webkit = native_step.startswith('webkit-')
    mode = native_step.replace('webkit-', '')
    engine = 'webkit' if webkit else 'chromium'
    report = b.loads(contents['c1/evidence/native.json'])
    common = 'mode hashes results observations fixtureExitCode fixtureErrors browserClosed '
    b.fields(report, common + ('engine webkitVersion chromeArgumentIgnored qualifications skipped' if webkit else
                              'baseline legacyAdmission finalHealth teardown'))
    b.require(report['mode'] == '--' + mode and report['browserClosed'] is True
              and type(report['fixtureExitCode']) is int and report['fixtureExitCode'] == 0
              and report['fixtureErrors'] == '', 'Pool phase or teardown differs')
    b.require(isinstance(report['hashes'], dict) and bool(report['hashes'])
              and isinstance(report['observations'], list), 'Pool family report schema differs')
    if webkit:
        b.require(report['engine'] == engine and isinstance(report['webkitVersion'], str)
                  and bool(report['webkitVersion']) and isinstance(report['chromeArgumentIgnored'], str)
                  and isinstance(report['qualifications'], list)
                  and all(isinstance(q, str) for q in report['qualifications'])
                  and isinstance(report['skipped'], dict)
                  and all(isinstance(k, str) and isinstance(v, str) and case_filter not in k
                          for k, v in report['skipped'].items()), 'Pool WebKit engine/qualification differs')
    else:
        b.require(report['baseline'] is False and report['legacyAdmission'] is False and report['teardown'] == []
                  and isinstance(report['finalHealth'], dict) and report['finalHealth'].get('fatal') == [],
                  'Pool phase or teardown differs')
    if literal_item:
        wanted_hashes = {p: final_profiles.TRAIN48['sources'][p]
                         for p in final_profiles.SNAPSHOTS_48[native_step]}
        b.require(report['hashes'] == wanted_hashes, 'Pool literal snapshot inputs differ')
    rows = report['results']
    b.require(isinstance(rows, list) and bool(rows), 'Pool missing raw cases')
    b.require(all(isinstance(row, dict) and row.get('passed') is True for row in rows),
              'Pool raw case failed or invalid')
    if literal_item:
        mode_names = [n.replace('colors ', mode + ' ', 1) if literal_item == '656' else n
                      for n in final_profiles.CASES_48[literal_item]]
        b.require([r.get('name') for r in rows] == mode_names, 'Pool literal ordered cases differ')
    keys = []
    for row in rows:
        # A red row (including a caught/unrestored mutant) never becomes green.
        b.require(isinstance(row, dict) and row.get('passed') is True, 'Pool raw case failed or invalid')
        b.fields(row, 'name passed engine ms' if webkit else 'name passed')
        b.require(isinstance(row['name'], str) and (row['name'] == mode + ' ' + case_filter
                  or row['name'].startswith(mode + ' ' + case_filter + ' ')), 'Pool case filter boundary differs')
        if webkit:
            b.require(row['engine'] == engine and type(row['ms']) is int and row['ms'] >= 0,
                      'Pool raw engine or duration differs')
        keys.append(('native-' + native_step, row['name'], None, engine))
    b.require(len(keys) == len(set(keys)), 'duplicate Pool case identity')
    b.require(Counter(keys) == Counter(k for k in expected if k[0] == 'native-' + native_step),
              'Pool own-case obligations differ')
    counts = {'tests': len(rows), 'pass': len(rows), 'fail': 0, 'failed': [], 'browser_closed': True}
    b.require(b.canonical(step['counts']) == b.canonical(counts), 'Pool raw count differs')
    lines = [b.loads(line) for line in contents['c1/native-' + native_step + '.log'].decode().splitlines()]
    if literal_item == '656':
        lines = title_log_records(lines, rows, webkit)
    if webkit:
        b.require(b.canonical(lines) == b.canonical(rows), 'Pool ordered result log differs')
    else:
        b.require(len(lines) == 2 * len(rows), 'Pool ordered start/result log differs')
        for i, row in enumerate(rows):
            start = b.fields(lines[2 * i], 'case started')
            end = b.fields(lines[2 * i + 1], 'name passed started finished')
            b.require(start['case'] == row['name'] and end['name'] == row['name'] and end['passed'] is True
                      and end['started'] == start['started'], 'Pool ordered start/result log differs')
            for value in (start['started'], end['finished']):
                b.require(isinstance(value, str) and re.fullmatch(r'\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z', value),
                          'Pool case timestamp differs')
                datetime.fromisoformat(value.replace('Z', '+00:00'))
            b.require(end['finished'] >= start['started'], 'Pool case timestamp order differs')
        phases = b.fields(b.loads(contents['c1/evidence/phases.json']),
                          'started cases fixtureReady browserReady reportingStarted reportingEnded')
        clock = [phases[k] for k in ('started', 'fixtureReady', 'browserReady', 'reportingStarted', 'reportingEnded')]
        b.require(all(type(t) is int and t > 0 for t in clock) and clock == sorted(clock)
                  and isinstance(phases['cases'], list) and len(phases['cases']) == len(rows),
                  'Pool incomplete reporting phases')
        previous = phases['browserReady']
        for row, phase in zip(rows, phases['cases']):
            b.fields(phase, 'name started actionStarted actionEnded cleanupEnded')
            times = [phase[k] for k in ('started', 'actionStarted', 'actionEnded', 'cleanupEnded')]
            b.require(phase['name'] == row['name'] and all(type(t) is int and t > 0 for t in times)
                      and times == sorted(times) and previous <= times[0]
                      and times[-1] <= phases['reportingStarted'], 'Pool incomplete case/cleanup phases')
            previous = times[-1]
    return keys


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
    initial = source_bytes(git, wrapper, [SPEC])
    spec = b.fields(b.loads(initial[SPEC]), 'step cases label snapshot')
    family = None
    literal_item = None
    if spec['step'] in ('reading', 'webkit-reading', 'rail', 'webkit-rail', 'colors', 'webkit-colors', 'header'):
        tests_tree = b.ask(git, 'rev-parse', '--verify', wrapper + ':tests').strip()
        if tests_tree == final_profiles.TRAIN48['tests_tree']:
            item = '649' if spec['step'] in ('reading', 'webkit-reading') else '656'
            allowed_steps = ('reading', 'webkit-reading') if item == '649' else ('colors', 'webkit-colors', 'header')
            b.require(spec['step'] in allowed_steps, 'Pool literal family step differs')
            family, literal_item = final_profiles.TRAIN48, item
        else:
            b.require(spec['step'] in ('reading', 'webkit-reading', 'rail', 'webkit-rail'),
                      'Pool independently bound tests schema differs')
            item = '717' if spec['step'] in ('reading', 'webkit-reading') else '715'
            profiles = ((FAMILIES[item], ASSEMBLY_717, FINAL_717) if item == '717' else
                        (FAMILIES[item], ASSEMBLY_715, final_profiles.FINAL_715))
            family = next((profile for profile in profiles if profile['tests_tree'] == tests_tree), None)
            b.require(family is not None, 'Pool independently bound tests schema differs')
        if family is final_profiles.TRAIN48 or family is final_profiles.FINAL_715:
            b.require(assembly == family['head'] and assembly_tree == family['tree'],
                      'Pool literal canonical source differs')
        case_filter = 'item ' + item
        authorized = {p: SOURCES[p] for p in (WORKFLOW, 'tools/native.py', 'tools/release_check.py')}
        authorized.update(family['sources'])
        sources = source_bytes(git, wrapper, list(authorized))
    else:
        sources = source_bytes(git, wrapper, list(SOURCES))
        authorized = dict(SOURCES)
        case_filter = 'item 651'
        if b.digest(sources[COMPOSE]) == COMPOSE_652:
            authorized[COMPOSE] = COMPOSE_652
            authorized.update(HELPER_652)
            sources.update(source_bytes(git, wrapper, list(HELPER_652)))
            if all(b.digest(sources[p]) == value for p, value in HELPER_652_CORRECTED.items()):
                authorized.update(HELPER_652_CORRECTED)
            case_filter = 'item 652'
    for path, expected_digest in authorized.items():
        b.require(b.digest(sources[path]) == expected_digest, 'Pool executed source/command differs: ' + path)
    b.require(spec['snapshot'] == assembly and b.tree(git, assembly) == assembly_tree, 'Pool spec snapshot differs')
    b.require(spec['step'] in (('reading', 'webkit-reading', 'rail', 'webkit-rail', 'colors', 'webkit-colors', 'header') if family else ('compose',))
              and isinstance(spec['cases'], list) and len(spec['cases']) == 1 and spec['cases'][0] == case_filter
              and isinstance(spec['label'], str) and re.fullmatch(r'[A-Za-z0-9._-]{1,80}', spec['label']),
              'Pool spec step/filter differs')
    step_name = 'native-' + spec['step']
    log_member = 'c1/' + step_name + '.log'
    members = ('cases.json', 'c1.log', log_member, 'c1/evidence/native.json')
    if family and not spec['step'].startswith('webkit-'):
        members += ('c1/evidence/phases.json',)
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
        b.require(all(n in names for n in members)
                  and not any(re.match(r'c[0-9]+(?:/|\.log$)', n) and not n.startswith(('c1/', 'c1.log')) for n in names),
                  'Pool execution archive inventory differs')
        contents = {name: archive.read(name) for name in members}
    for key, member in [('step', 'c1.log'), ('log', log_member), ('report', 'c1/evidence/native.json')]:
        b.require(b.artifact(receipt[key]) == contents[member], 'Pool raw ' + key + ' differs from archive')
    executions = b.loads(contents['cases.json'])
    b.require(isinstance(executions, list) and len(executions) == 1, 'Pool single execution missing')
    b.fields(executions[0], 'case exit')
    b.require(executions[0]['case'] == case_filter and type(executions[0]['exit']) is int,
              'Pool execution filter/exit differs')
    if family:
        b.report_hashes([b.loads(contents['c1/evidence/native.json'])], git, assembly)
    # Publication can trail the successful upload step by at most two seconds.
    # All identity/source/archive/raw-byte bindings above apply first. These
    # are derived timing facts; never alter the retained API timestamps.
    upload = steps[5]
    try:
        raw_times = [meta['created_at'], upload['started_at'], upload['completed_at']]
        b.require(all(isinstance(value, str) for value in raw_times),
                  'Pool artifact attempt/upload timestamps invalid')
        created, started, finished = [datetime.fromisoformat(value.replace('Z', '+00:00')) for value in raw_times]
        b.require(all(value.utcoffset() is not None for value in (created, started, finished)),
                  'Pool artifact attempt/upload timestamps invalid')
        limit = finished + timedelta(seconds=2)
    except (KeyError, ValueError, TypeError, OverflowError):
        raise b.Refused('base move: Pool artifact attempt/upload timestamps invalid')
    b.require(started <= finished and started <= created <= limit, 'Pool artifact attempt/upload differs')
    publication = {'artifact_created_at': raw_times[0], 'upload_started_at': raw_times[1],
                   'upload_completed_at': raw_times[2], 'max_late_seconds': 2,
                   'not_before': raw_times[1], 'not_after': limit.isoformat(),
                   'seconds_after_upload_completed': (created - finished).total_seconds(),
                   'within_upload': created <= finished}
    b.require(executions[0]['exit'] == 0, 'Pool execution filter/exit differs')
    stdout = contents['c1.log'].decode().splitlines()
    b.require(len(stdout) == 2 and stdout[1] == spec['step'] + ' exit 0 /Users/runner/work/_temp/pool/c1',
              'Pool native command/exit stdout differs')
    step = b.fields(b.loads(stdout[0]), 'name exit passed counts')
    b.require(step['name'] == step_name and type(step['exit']) is int and step['exit'] == 0
              and step['passed'] is True, 'Pool raw step/exit differs')
    if family:
        keys = family_results(contents, step, spec['step'], case_filter, expected, literal_item)
        by_engine = {keys[0][3]: {k[1] for k in keys}}
        schema = 'pool-reading-rail-v1'
        harness = 'tests/webkit_native.mjs' if spec['step'].startswith('webkit-') else 'tests/reader_persistence_native.mjs'
        flags = ['--' + spec['step'].replace('webkit-', '')]
    else:
        keys, by_engine = compose_results(contents, step, case_filter, expected)
        schema, harness, flags = 'pool-compose-prefix-v1', COMPOSE, []
    inputs = {p: b.ask(git, 'rev-parse', '--verify', assembly + ':' + p).strip() for p in authorized if p != WORKFLOW}
    return keys, {'run': run_id, 'attempt': attempt, 'wrapper': wrapper, 'job': job['id'],
                  'artifact': binding['artifact'], 'api': binding['api'], 'record': binding['record'],
                  'originals': {k: receipt[k] for k in ('snapshot', 'step', 'report', 'log', 'pool')},
                  'raw': step,
                  'derived': {'schema': schema, 'publication': publication,
                              'snapshot': {'head': assembly, 'tree': assembly_tree, 'inputs': inputs},
                              'source_sha256': authorized,
                              'command': {'driver': 'tools/native.py', 'step': spec['step'], 'filter': case_filter,
                                          'harness': harness, 'flags': flags,
                                          'dynamic_paths': 'node/chrome/playwright from workflow environment; output RUNNER_TEMP/pool/c1'},
                              **({'schema_binding': {'producer': family['head'], 'tests_tree': family['tests_tree']}} if family else {}),
                              'identity_rule': ('neutral name; engine from exact entrypoint; phase remains null' if family else 'remove exact engine prefix; phase remains null'),
                              'engine_counts': {e: len(by_engine[e]) for e in by_engine}}}


def compose_results(contents, step, case_filter, expected):
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
        if case_filter == 'item 652':
            b.require(name == case_filter or name.startswith(case_filter + ' '), 'Pool case filter boundary differs')
        keys.append(('native-compose', name, None, engine))
    b.require(len(keys) == len(set(keys)), 'duplicate Pool case identity')
    by_engine = {e: {k[1] for k in keys if k[3] == e} for e in ('chromium', 'webkit')}
    b.require(bool(by_engine['chromium']) and by_engine['chromium'] == by_engine['webkit'], 'Pool incomplete engine identities')
    selected = [k for k in expected if k[0] == 'native-compose']
    b.require(Counter(keys) == Counter(selected), 'Pool own-case obligations differ')
    return keys, by_engine

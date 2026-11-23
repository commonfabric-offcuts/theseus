from __future__ import annotations

"""Read captured deterministic evidence; never execute the candidate or a browser.

Capture honesty, named-cohort selection and native browser attribution receive
an independent, bound read. See docs/deterministic-judged-admission-1131.md.
"""
from collections import Counter
import hashlib
import fnmatch
import json
from pathlib import Path
import re

from tools import base_move, ci_known_reds, release_check


class Refused(Exception):
    pass


def require(value, reason):
    if not value:
        raise Refused('deterministic admission: ' + reason)


def selected(value):
    return isinstance(value, dict) and value.get('version') == 1131


def fields(value, names, optional=()):
    expected = set(names.split())
    require(isinstance(value, dict) and expected <= set(value) <= expected | set(optional),
            'expected fields ' + names)
    return value


def full_sha(value):
    require(isinstance(value, str) and re.fullmatch('[0-9a-f]{40}', value), 'full Git identity required')
    return value


def words(value):
    require(isinstance(value, str) and bool(value.strip()), 'missing evidence identity')
    return value


def positive(value):
    require(type(value) is int and value > 0, 'positive run/attempt identity required')
    return value


def shape(value):
    fields(value, 'version carry node_comparison core_cohort browser_cells audit',
           ('verdicts', 'python_comparisons'))
    require(selected(value), 'judged work requires version1131 evidence')
    carry = fields(value['carry'], 'base head tree created_at_ms')
    for key in ('base', 'head', 'tree'):
        full_sha(carry[key])
    positive(carry['created_at_ms'])
    fields(value['audit'], 'message revision')
    require(isinstance(value['audit']['message'], str) and
            re.fullmatch('m-[0-9a-f]{32}', value['audit']['message']), 'audit names a Core message')
    positive(value['audit']['revision'])
    for key in ('browser_cells', 'verdicts', 'python_comparisons'):
        require(isinstance(value.get(key, []), list), key + ' must be a list')
    return value


def canonical(value):
    return json.dumps(value, sort_keys=True, separators=(',', ':'), ensure_ascii=False).encode('utf-8')


def evidence_digest(value):
    return hashlib.sha256(canonical({k: v for k, v in value.items() if k != 'audit'})).hexdigest()


def artifact(ref):
    fields(ref, 'path sha256')
    require(isinstance(ref['path'], str) and Path(ref['path']).is_absolute() and
            isinstance(ref['sha256'], str) and re.fullmatch('[0-9a-f]{64}', ref['sha256']),
            'raw artifact needs an absolute path and SHA256')
    try:
        raw = Path(ref['path']).read_bytes()
    except OSError as error:
        raise Refused('deterministic admission: unreadable raw artifact: ' + str(error))
    require(hashlib.sha256(raw).hexdigest() == ref['sha256'], 'raw artifact hash differs: ' + ref['path'])
    return raw


def document(ref):
    try:
        return base_move.loads(artifact(ref))
    except (ValueError, UnicodeError, base_move.Refused) as error:
        raise Refused('deterministic admission: malformed evidence JSON: ' + str(error))


def ask(git, *args):
    answer = git(*args)
    require(answer.returncode == 0, 'Git identity unavailable: ' + ' '.join(args))
    return answer.stdout


def entries(git, head):
    result = {}
    for line in ask(git, 'ls-tree', '-r', '-z', '--full-tree', head).split('\0'):
        if line:
            meta, path = line.split('\t', 1)
            mode, kind, digest = meta.split()
            require(kind == 'blob', 'captured input tree contains a non-blob entry')
            result[path] = digest
    return result


def snapshot(ref, git, head, tree):
    value = fields(document(ref), 'head tree changes inputs')
    require(value['head'] == head and value['tree'] == tree and value['changes'] == '',
            'captured input snapshot is dirty or names another head/tree')
    require(isinstance(value['inputs'], dict) and value['inputs'] == entries(git, head),
            'captured inputs omit or substitute tracked source')
    return value


def file_names(values):
    require(isinstance(values, list) and all(isinstance(v, str) and
            re.fullmatch(r'tests/test_[A-Za-z0-9_]+\.py', v) for v in values) and
            len(values) == len(set(values)), 'cohort names distinct root Python test files')
    return values


def command_files(argv, cwd, inputs, node):
    """Bind captured grouped/per-file invocations, including isolation flags."""
    require(isinstance(argv, list) and all(isinstance(a, str) for a in argv) and bool(argv),
            'unit command was not captured')
    args = list(argv)
    if Path(args[0]).name == 'nice':
        require(len(args) > 3 and args[1] == '-n' and re.fullmatch(r'-?\d+', args[2]), 'unknown command wrapper')
        args = args[3:]
    require(bool(args[0]), 'unit command names no executable')
    require(Path(args[0]).name == 'node' if node else
            re.fullmatch(r'python(?:3(?:\.[0-9]+)?)?', Path(args[0]).name),
            'unit command names the wrong runtime')
    args = args[1:]
    def path(value):
        selected = Path(value)
        if selected.is_absolute():
            require(isinstance(cwd, str) and Path(cwd).is_absolute(), 'absolute arguments need captured cwd')
            try:
                selected = selected.relative_to(cwd)
            except ValueError:
                raise Refused('deterministic admission: unit argument is outside captured cwd')
        name = selected.as_posix()
        require(name in inputs, 'unit argument is not a captured tracked file')
        return name
    if node:
        flags = [a for a in args if a.startswith('-')]
        require('--test' in flags and '--test-reporter=tap' in flags and
                len(flags) == len(set(flags)) and all(a in ('--test', '--test-reporter=tap') or
                re.fullmatch(r'--test-concurrency=[1-9][0-9]*', a) for a in flags),
                'Node command changes the captured whole-suite selection')
        names = [path(a) for a in args if not a.startswith('-')]
    else:
        while args and args[0] in ('-I', '-B', '-u'):
            args.pop(0)
        require(args[:2] == ['-m', 'unittest'], 'Python command is not the named unittest cohort')
        args = args[2:]
        if args and args[0] == 'discover':
            options = args[1:]; start, pattern = None, None
            require(options.count('-v') == 1, 'Python discovery needs verbose individual outcomes')
            while options:
                option = options.pop(0)
                if option == '-v':
                    continue
                require(option in ('-s', '-p') and bool(options), 'unknown unittest discovery selection')
                selected = options.pop(0)
                if option == '-s':
                    require(start is None, 'duplicate discovery directory'); start = selected
                else:
                    require(pattern is None, 'duplicate discovery pattern'); pattern = selected
            require(start in ('tests', str(Path(cwd or '')/'tests')) and isinstance(pattern, str) and
                    '/' not in pattern, 'discovery must name captured root tests and its pattern')
            names = [p for p in inputs if p.startswith('tests/') and p.count('/') == 1 and
                     fnmatch.fnmatchcase(Path(p).name, pattern)]
        else:
            require(args.count('-v') == 1 and not any(a.startswith('-') and a != '-v' for a in args),
                    'Python cohort command needs verbose complete results')
            names = [path(a) for a in args if a != '-v']
    require(bool(names) and len(names) == len(set(names)), 'unit command duplicates or omits its file selection')
    return set(names)


def outcomes(text, rows, counts, node):
    """Reconcile case distributions, excluding explicitly typed TAP suites."""
    details = [''] * len(rows)
    if node:
        ends = list(re.finditer(r'^( *)(?:ok|not ok) \d+ - .+$', text, re.M))
        require(len(ends) == len(rows), 'TAP outcome identity coverage differs')
        for index, done in enumerate(ends):
            rest = text[done.end():]
            following = re.search(r'^ *(?:# Subtest:|(?:ok|not ok) \d+ -)', rest, re.M)
            details[index] = rest[:following.start()] if following else rest
        suites = [bool(re.search(r"^ *type: ['\"]suite['\"] *$", d, re.M)) for d in details]
        printed = re.findall(r'^# suites (\d+)$', text, re.M)
        require(sum(suites) == (int(printed[-1]) if printed else 0), 'TAP suite summary coverage differs')
    else:
        suites = [False] * len(rows)
    measured = Counter(status if not status.startswith('skipped') else 'skip'
                       for (_, status), suite in zip(rows, suites) if not suite)
    require(sum(measured.values()) == counts['tests'], 'individual case coverage differs from raw counts')
    if node:
        require(set(measured) <= {'ok', 'not ok', 'skip'} and
                all(counts.get(k, 0) == measured[s] for k, s in
                    (('pass', 'ok'), ('fail', 'not ok'), ('skipped', 'skip'))),
                'Node pass/fail/skip counts differ from individual outcomes')
    else:
        require(set(measured) <= {'ok', 'FAIL', 'ERROR', 'skip'} and
                all(counts.get(k, 0) == measured[s] for k, s in
                    (('failures', 'FAIL'), ('errors', 'ERROR'), ('skipped', 'skip'))),
                'Python failure/error/skip counts differ from individual outcomes')
    return details


def origin(case, detail, paths, cwd, node):
    if len(paths) == 1:
        return next(iter(paths))
    if not node:
        qualified = re.search(r'\(([^)]+)\)', case['name'])
        names = qualified[1].split('.') if qualified else []
        matched = [p for p in paths if Path(p).stem in names]
    else:
        location = re.search(r"^ *location: ['\"]?(.+?):\d+(?::\d+)?['\"]? *$", detail, re.M)
        value = location[1] if location else case['name']
        value = value[7:] if value.startswith('file://') else value
        if Path(value).is_absolute():
            try:
                value = Path(value).relative_to(cwd).as_posix()
            except ValueError:
                value = ''
        matched = [p for p in paths if p == value]
    require(len(matched) == 1, 'grouped failing result has no unambiguous captured file identity')
    return matched[0]


def unit_run(ref, git, head, *, node, expected=None):
    data = fields(document(ref), 'run attempt head tree inputs_before inputs_after', ('files', 'grouped'))
    require(('files' in data) != ('grouped' in data), 'name captured per-file results or one actual grouped execution')
    words(data['run']); positive(data['attempt'])
    tree = ask(git, 'rev-parse', head + '^{tree}').strip()
    require(data['head'] == head and data['tree'] == tree, 'unit run names another head/tree')
    before = snapshot(data['inputs_before'], git, head, tree)
    require(before == snapshot(data['inputs_after'], git, head, tree), 'unit inputs changed during execution')
    all_inputs = before['inputs']
    expected = {p for p in all_inputs if re.fullmatch(r'tests/[^/]+\.test\.mjs', p)} if node else set(file_names(sorted(expected)))
    grouped = 'grouped' in data
    executions = [data['grouped']] if grouped else data['files']
    require(isinstance(executions, list) and bool(executions), 'unit run has no file results')
    seen, cases, failures, skipped, failed_files, totals = set(), Counter(), Counter(), Counter(), set(), Counter()
    for row in executions:
        if grouped:
            fields(row, 'files cwd argv exit stdout stderr counts')
            require(isinstance(row['cwd'], str) and Path(row['cwd']).is_absolute(), 'grouped execution needs captured cwd')
            require(isinstance(row['files'], list) and len(row['files']) == len(set(row['files'])),
                    'grouped execution duplicates file coverage')
            paths = set(row['files'])
        else:
            fields(row, 'file argv exit stdout stderr counts', ('cwd',))
            require(isinstance(row['file'], str), 'unit result names no file')
            paths = {row['file']}
        require(bool(paths) and paths <= expected and not paths & seen,
                'unit file omitted, duplicated or outside its declared cohort')
        require(command_files(row['argv'], row.get('cwd'), all_inputs, node) == paths,
                'captured command differs from its declared file coverage')
        seen.update(paths)
        require(type(row['exit']) is int and row['exit'] in (0, 1), 'unit process did not complete normally')
        try:
            stdout, stderr = artifact(row['stdout']).decode('utf-8'), artifact(row['stderr']).decode('utf-8')
            text = stdout if node else stdout + '\n' + stderr
            counts, good = release_check.node_counts(text) if node else release_check.python_counts(text)
            # The shared reader accepts arbitrary names before '(...)'. A
            # unittest terminal summary with failure/skip counts is not a case.
            individual = text if node else re.sub(r'^(?:OK|FAILED)(?: \([^\n]*\))?$', '', text, flags=re.M)
            rows = ci_known_reds.unit_records(individual, node=node)
        except (UnicodeError, ci_known_reds.Refused) as error:
            raise Refused('deterministic admission: unreadable unit result: ' + str(error))
        require(bool(counts) and counts == row['counts'] and counts.get('tests', 0) > 0,
                'raw unit counts are missing or differ')
        require(isinstance(row['counts'], dict) and all(
                isinstance(v, str) if k == 'status' else type(v) is int and v >= 0
                for k, v in row['counts'].items()), 'unit counts have invalid types')
        if node:
            require(set(counts) == {'tests', 'pass', 'fail', 'cancelled', 'skipped', 'todo'},
                    'Node result omits its complete outcome summary')
        require(not any(counts.get(k, 0) for k in ('cancelled', 'todo', 'expected failures', 'unexpected successes')),
                'unit run has incomplete or nonstandard outcomes')
        details = outcomes(text, rows, counts, node)
        file_failed = False
        for (case, status), detail in zip(rows, details):
            # Whole TAP does not identify the file of a passing case. Preserve
            # names/ancestry/multiplicity and separately bind every failing file
            # from its diagnostic location, never invent a successful location.
            identity = (None if node else origin(case, detail, paths, row.get('cwd'), False),
                        case.get('phase'), case['name'])
            cases[identity] += 1
            if status in ('not ok', 'FAIL', 'ERROR'):
                path = origin(case, detail, paths, row.get('cwd'), node)
                failures[(path, case.get('phase'), case['name'])] += 1
                failed_files.add(path); file_failed = True
            elif status != 'ok':
                skipped[identity] += 1
        if row['exit']:
            require(file_failed and not good, 'nonzero unit exit has no raw failing result')
        else:
            require(good and not file_failed, 'zero unit exit disagrees with raw result')
        totals.update({k: v for k, v in counts.items() if type(v) is int})
    require(seen == expected, 'whole suite/cohort omits files: ' + ', '.join(sorted(expected - seen)))
    return {'run': data['run'], 'attempt': data['attempt'], 'head': head, 'tree': tree,
            'files': seen, 'cases': cases, 'failures': failures, 'skipped': skipped,
            'failed_files': failed_files, 'counts': dict(totals)}


def comparison(ref, git, base, carry, *, node):
    data = fields(document(ref), 'base carry', () if node else ('files',))
    cohort = None if node else file_names(data.get('files'))
    old = unit_run(data['base'], git, base, node=node, expected=cohort)
    new = unit_run(data['carry'], git, carry, node=node, expected=cohort)
    require((old['run'], old['attempt']) != (new['run'], new['attempt']), 'base and carry substitute one run/attempt')
    require(old['files'] <= new['files'] and not old['cases'] - new['cases'], 'carry omits live file/case coverage')
    require(not new['failures'] - old['failures'] and not new['failed_files'] - old['failed_files'],
            'a deterministic case/file is newly failing on carry')
    require(not new['skipped'] - old['skipped'], 'carry adds skipped or incomplete cases')
    return {'base': {k: old[k] for k in ('run', 'attempt', 'head', 'tree', 'counts')},
            'carry': {k: new[k] for k in ('run', 'attempt', 'head', 'tree', 'counts')},
            'files': len(new['files']), 'cases': sum(new['cases'].values()), 'added_failures': []}


def validate(value, git, live, candidate):
    shape(value)
    carry = value['carry']
    require(carry['base'] == live, 'comparison base is not actual live')
    require(ask(git, 'merge-base', '--is-ancestor', live, carry['head']) == '', 'carry does not descend from live')
    require(ask(git, 'rev-parse', carry['head'] + '^{tree}').strip() == carry['tree'] ==
            ask(git, 'rev-parse', candidate + '^{tree}').strip(), 'carry or landing tree was substituted')
    if candidate != carry['head']:
        require(ask(git, 'rev-list', '--parents', '-n', '1', candidate).split()[1:] == [live, carry['head']],
                'landing is not the exact carry merged on actual live')
    stamp = ask(git, 'show', '-s', '--format=%ct', carry['head']).strip()
    require(stamp.isdigit(), 'carry has no readable declared Git timestamp')
    # Git timestamps are authored metadata, not an ordering witness. The bound
    # affirmative audit below explicitly accepts independently read carry order.
    node = comparison(value['node_comparison'], git, live, carry['head'], node=True)
    python_runs = []
    for ref in value.get('python_comparisons', []):
        comparison(ref, git, live, carry['head'], node=False)
        data = document(ref)
        paths = set(file_names(data['files']))
        # Retain the same validated case counters for migration coverage and
        # reconciliation below. Declared command filenames alone are not proof
        # that those files produced outcomes in a grouped execution.
        python_runs.append((paths,
            unit_run(data['base'], git, live, node=False, expected=paths),
            unit_run(data['carry'], git, carry['head'], node=False, expected=paths)))
    cohort = fields(document(value['core_cohort']), 'head tree pieces migration_tests run')
    require(cohort['head'] == carry['head'] and cohort['tree'] == carry['tree'], 'Core cohort has another carry')
    require(isinstance(cohort['pieces'], list) and bool(cohort['pieces']), 'missing named frozen Core cohorts')
    tests, pieces = set(), set()
    for row in cohort['pieces']:
        fields(row, 'piece_id head tests')
        words(row['piece_id']); full_sha(row['head']); file_names(row['tests'])
        require(row['piece_id'] not in pieces and bool(row['tests']), 'missing or duplicate piece cohort')
        pieces.add(row['piece_id']); tests.update(row['tests'])
    migrations = set(file_names(cohort['migration_tests']))
    changed = ask(git, 'diff', '--no-renames', '--name-only', '-z', live, carry['head']).split('\0')
    required_migrations = {'tests/test_migrations.py'} | {
        path for path in changed if re.fullmatch(r'tests/test_[^/]*(?:migration|migrate)[^/]*\.py', path)}
    require(required_migrations <= migrations, 'migration chain tests are missing')
    compared_files = set()
    for paths, old, new in python_runs:
        selected_migrations = migrations & paths
        require(selected_migrations <= {case[0] for case in old['cases']} &
                {case[0] for case in new['cases']},
                'migration comparison has a named file with no observed case')
        compared_files.update(selected_migrations)
    # Preserve an actual grouped command containing both pieces and migrations;
    # do not slice its raw log or relabel it as a different invocation.
    captured = document(cohort['run'])
    captured_files = set(file_names(captured['grouped']['files'] if 'grouped' in captured else
                                   [row['file'] for row in captured.get('files', [])]))
    require(tests <= captured_files <= tests | migrations, 'Core capture omits piece tests or names an unrelated file')
    units = unit_run(cohort['run'], git, carry['head'], node=False, expected=captured_files)
    observed = {case[0] for case in units['cases']}
    skipped_files = {case[0] for case in units['skipped']}
    require(tests <= observed and not tests & (units['failed_files'] | skipped_files),
            'Core piece cohort is not PASS')
    require(captured_files <= observed, 'Core capture has a named file with no observed case')
    passing_files = observed - units['failed_files'] - skipped_files
    for paths, old, _ in python_runs:
        selected_migrations = (migrations & captured_files & paths) - passing_files
        if not selected_migrations:
            continue
        def migration_cases(run, key):
            return Counter({case: count for case, count in run[key].items()
                            if case[0] in selected_migrations})
        require(not migration_cases(old, 'cases') - migration_cases(units, 'cases'),
                'Core migration capture omits live file/case coverage')
        require(not migration_cases(units, 'failures') - migration_cases(old, 'failures'),
                'a Core migration case/file is newly failing against live')
        require(not migration_cases(units, 'skipped') - migration_cases(old, 'skipped'),
                'Core migration capture adds skipped or incomplete cases')
    require(migrations <= passing_files | compared_files,
            'Migration cohort is not PASS and lacks a matching live comparison')
    passing_counts = {'tests': sum(count for case, count in units['cases'].items() if case[0] in passing_files)}
    cells, covered = [], set()
    for row in value['browser_cells']:
        fields(row, 'paths page cell head tree completed raw')
        require(isinstance(row['paths'], list) and bool(row['paths']) and all(p in changed and
                p.startswith('web/') for p in row['paths']), 'browser cell covers no changed web path')
        words(row['page']); words(row['cell'])
        require(row['head'] == carry['head'] and row['tree'] == carry['tree'] and row['completed'] is True,
                'browser case is incomplete or from another carry')
        raw = document(row['raw'])
        require(isinstance(raw, dict) and all(raw.get(k) == row[k] for k in ('page', 'cell', 'head', 'tree', 'completed'))
                and raw.get('driver') == 'real-browser' and raw.get('status') in ('pass', 'fail'),
                'browser raw record does not name the completed real-browser case')
        covered.update(row['paths']); cells.append(row['cell'])
    require({p for p in changed if p.startswith('web/')} <= covered, 'a changed web page lacks its completed browser cell')
    for row in value.get('verdicts', []):
        fields(row, 'run attempt check conclusion raw', ('comparisons',))
        positive(row['run']); positive(row['attempt']); positive(row['check']); words(row['conclusion'])
        artifact(row['raw'])  # Record the actual conclusion, including refusal.
        require(isinstance(row.get('comparisons', []), list), 'Verdict comparisons must be a list')
        for compared in row.get('comparisons', []):
            fields(compared, 'kind raw')
            require(compared['kind'] in ('python', 'node'), 'Verdict comparison names no deterministic unit kind')
            comparison(compared['raw'], git, live, carry['head'], node=compared['kind'] == 'node')
    return {'head': carry['head'], 'base': live, 'tree': carry['tree'], 'created_at_ms': carry['created_at_ms'],
            'node_comparison': node, 'core_cohort': {'run': units['run'], 'attempt': units['attempt'],
                'counts': passing_counts, 'captured_counts': units['counts'], 'result': 'PASS', 'pieces': cohort['pieces'],
                'migration_tests': sorted(migrations), 'migration_evidence': {
                    'passed_on_carry': sorted(migrations & passing_files),
                    'compared_against_live': sorted(migrations & compared_files)}},
            'browser_cells': cells, 'audit': value['audit'], 'evidence_sha256': evidence_digest(value),
            'verdicts': value.get('verdicts', []), 'git_committer_time_ms': int(stamp) * 1000}


def audit(value, source, reviewer):
    selected_audit = value['audit']
    require(isinstance(source, dict) and source.get('source_ref') == {'kind': 'message', 'id': selected_audit['message']}
            and source.get('revision') == selected_audit['revision'] and source.get('author') == reviewer and
            not any(source.get(k) for k in ('withheld', 'removal', 'withdrawal', 'struck', 'whisper')),
            'audit message is unavailable, stale or not the independent reviewer')
    prefix = '(codex) ' + reviewer.replace('-', '_') + ' —1131 '
    body = source.get('body') or ''
    require(body.startswith(prefix), 'audit needs its explicit1131 decision, not a quoted marker')
    try:
        decision = fields(base_move.loads(body[len(prefix):]),
                          'decision evidence_sha256 approval_before_carry carry_started_at_ms')
    except (ValueError, base_move.Refused) as error:
        raise Refused('deterministic admission: audit has no unambiguous decision: ' + str(error))
    require(decision['decision'] == 'accept' and decision['evidence_sha256'] == evidence_digest(value),
            'audit does not affirmatively accept these exact evidence bytes')
    require(decision['approval_before_carry'] is True and
            type(decision['carry_started_at_ms']) is int and
            decision['carry_started_at_ms'] == value['carry']['created_at_ms'],
            'audit has not accepted independently read approval-before-carry ordering')
    require(type(source.get('sent_ms')) is int and
            0 < decision['carry_started_at_ms'] <= source['sent_ms'],
            'carry ordering witness is future-dated relative to the Core audit record')

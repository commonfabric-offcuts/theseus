from __future__ import annotations

"""Read-only admission at each caller's effect boundary; not a reservation."""
import json
import datetime
import re
from pathlib import Path

from tools import train, releases
from aim_next.judgment import SHA, source_diff


class Refused(Exception):
    pass


def require(holds, words):
    if not holds:
        raise Refused(words)


def _json_call(run, argv, request=None):
    result = run(argv, **({'input': json.dumps(request)} if request is not None else {}))
    require(result.returncode == 0, 'The admission pipeline could not be read; no judged work is authorized')
    try:
        value = json.loads(result.stdout)
    except (ValueError, TypeError):
        raise Refused('The admission pipeline returned no complete JSON answer')
    require(isinstance(value, dict) and not value.get('error'), 'The admission pipeline refused its read')
    return value


def approved(config, run):
    outcome = getattr(config, 'pipeline_outcome', None)
    instance = getattr(config, 'pipeline_instance', None)
    broker = getattr(config, 'pipeline_broker', None)
    profile = getattr(config, 'pipeline_profile', None)
    require(outcome and instance and bool(broker) != bool(profile),
            'Judged admission needs pipeline_outcome, pipeline_instance and exactly one pipeline_broker or pipeline_profile')
    selected = broker or profile
    require(Path(selected).is_absolute(), 'The admission broker/profile path must be absolute')
    argv = [config.python, '-I', '-B', str(config.live / 'bin/aim-next'),
            '--broker' if broker else '--profile', str(selected)]
    binding = _json_call(run, argv + ['binding']).get('binding')
    require(isinstance(binding, dict) and binding.get('instance_id') == instance,
            'The admission binding belongs to another instance')
    cursor, seen, pieces, expected, waiting = 0, set(), {}, None, None
    unseen = object()
    open_release = unseen
    for _ in range(1000):
        request = {'v': 1, 'binding': binding, 'view': {'name': 'pipeline',
            'args': {'workspace_id': outcome, 'section': 'now', 'cursor': cursor, 'limit': 100}}}
        page = _json_call(run, argv + ['view', '-'], request)
        require(page.get('instance_id') == instance and page.get('workspace_id') == outcome,
                'The admission pipeline belongs to another instance or outcome')
        require(isinstance(page.get('pipeline'), dict) and page['pipeline'].get('enabled') is True and
                page['pipeline'].get('ships_in_releases') is True, 'Admission needs the enabled release pipeline')
        version = (page.get('relevant_versions') or {}).get('pipeline')
        require(type(version) is int and version > 0 and (expected is None or version == expected),
                'The admission pipeline changed while it was being read; read it afresh')
        expected = version
        facts = page.get('facts') or {}
        numbers = facts.get('approved_waiting')
        require(isinstance(numbers, list) and all(type(n) is int and n > 0 for n in numbers),
                'The admission pipeline omitted its approved/unshipped facts')
        require(waiting is None or set(numbers) == waiting, 'The admission pipeline has inconsistent approval facts')
        waiting = set(numbers)
        require('next_release' in facts, 'The admission pipeline omitted its open-release facts')
        next_release = facts['next_release']
        require(next_release is None or isinstance(next_release, dict) and
                type(next_release.get('release')) is int and next_release['release'] > 0 and
                isinstance(next_release.get('piece_id'), str) and bool(next_release['piece_id']) and
                isinstance(next_release.get('items'), list) and bool(next_release['items']) and
                all(type(n) is int and n > 0 for n in next_release['items']) and
                len(set(next_release['items'])) == len(next_release['items']) and
                isinstance(next_release.get('stage'), dict) and bool(next_release['stage'].get('stage_id')),
                'The admission pipeline has malformed open-release facts')
        require(open_release is unseen or open_release == next_release,
                'The admission pipeline changed its open release while paging')
        open_release = next_release
        require(isinstance(page.get('pieces'), list) and isinstance(page.get('items'), list) and 'next_cursor' in page,
                'The admission pipeline answer is incomplete')
        for piece in page['pieces']:
            require(isinstance(piece, dict) and isinstance(piece.get('id'), str) and isinstance(piece.get('items'), list) and
                    all(type(n) is int and n > 0 for n in piece['items']), 'The admission pipeline has a malformed piece')
            value = {'id': piece['id'], 'items': piece['items'], 'freeze': piece.get('freeze'),
                     'version': piece.get('version'), 'stage': (piece.get('stage') or {}).get('stage_id'),
                     'approval': piece.get('approval')}
            require(piece['id'] not in pieces or pieces[piece['id']] == value,
                    'The admission pipeline changed a piece while paging')
            pieces[piece['id']] = value
        if open_release is not None:
            release = page.get('release_piece')
            require(isinstance(release, dict) and release.get('kind') == 'release' and
                    release.get('id') == open_release['piece_id'] and release.get('items') == open_release['items'] and
                    release.get('release_number') == open_release['release'] and
                    release.get('stage') == open_release['stage'] and type(release.get('version')) is int,
                    'The admission pipeline omitted or changed its open-release owner')
            value = {'id': release['id'], 'items': release['items'], 'freeze': release.get('freeze'),
                     'version': release['version'], 'stage': release['stage']['stage_id'], 'release': open_release['release'],
                     'train_sources': release.get('train_sources'), 'train_candidate': release.get('train_candidate')}
            require(value['id'] not in pieces or pieces[value['id']] == value,
                    'The admission pipeline changed a release while paging')
            pieces[value['id']] = value
        else:
            require(page.get('release_piece') is None, 'The admission pipeline has an unaccounted open release')
        next_cursor = page['next_cursor']
        if next_cursor is None:
            pending = waiting | (set(open_release['items']) if open_release else set())
            require(pending <= {n for p in pieces.values() for n in p['items']},
                    'The admission pipeline omitted an approved piece')
            return list(pieces.values()), pending, expected
        require(type(next_cursor) is int and next_cursor > cursor and next_cursor not in seen,
                'The admission pipeline did not complete its pages')
        seen.add(cursor); cursor = next_cursor
    raise Refused('The admission pipeline exceeded its bounded read; no judged work is authorized')


def _freeze(piece):
    freeze = piece.get('freeze')
    if freeze is None:
        return None
    require(isinstance(freeze, dict), 'An approved piece has malformed freeze classification')
    source_version = freeze.get('source_piece_version') if piece.get('release') else piece.get('version')
    if piece.get('release'):
        require(isinstance(freeze.get('source_piece_id'), str) and bool(freeze['source_piece_id']) and
                freeze['source_piece_id'] != piece['id'], 'An open release has no source freeze owner')
    require(type(freeze.get('judged')) is bool and
            all(isinstance(freeze.get(k), str) and SHA.fullmatch(freeze[k]) for k in ('base_commit', 'head_commit')) and
            isinstance(freeze.get('files'), list) and all(isinstance(p, str) and p for p in freeze['files']) and
            type(freeze.get('piece_revision')) is int and type(source_version) is int and
            0 < freeze['piece_revision'] <= source_version and
            isinstance(freeze.get('by'), str) and bool(freeze['by']) and
            type(freeze.get('at_ms')) is int and freeze['at_ms'] > 0 and
            freeze['judged'] == bool(train.guarded(freeze['files'])),
            'An approved piece has malformed or inconsistent freeze classification')
    return freeze


def _approval(piece):
    value = piece.get('approval')
    require(isinstance(value, dict) and all(type(value.get(k)) is int and value[k] > 0 for k in ('at_ms', 'seq')),
            'The approved frozen source has no canonical approval timing')
    require(piece.get('freeze') is not None and value['at_ms'] >= piece['freeze']['at_ms'],
            'The approval predates the current frozen source')
    return value


def producer_selectors(value):
    """Omission is legacy; any explicit context has a complete positive tuple."""
    require(value is None or isinstance(value, dict) and set(value) == {'run', 'check', 'pr'} and
            all(type(n) is int and n > 0 for n in value.values()),
            'Producer selectors must give run, check and pr together as positive integers')
    return value


def _producer(config, candidate, base, git, selectors, github):
    repository, branch = getattr(config, 'repository', None), getattr(config, 'release_branch', None)
    require(isinstance(repository, str) and re.fullmatch(r'[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+', repository)
            and isinstance(branch, str) and bool(branch), 'Authenticated admission needs the repository and release branch')
    github = github or train.GhCli()
    prefix = 'repos/' + repository
    def get(path):
        try:
            value = github.get(prefix + path)
        except (train.Unreadable, OSError, ValueError) as error:
            raise Refused('The authenticated producer could not be read: ' + str(error))
        require(isinstance(value, dict), 'The authenticated producer read returned no object')
        return value
    run = get('/actions/runs/%d' % selectors['run'])
    head = run.get('head_sha')
    require(isinstance(head, str) and SHA.fullmatch(head), 'The producer names no complete source head')
    require(run.get('id') == selectors['run'] and type(run.get('run_attempt')) is int and run['run_attempt'] > 0 and
            run.get('event') == 'pull_request' and run.get('name') == 'Checks' and
            run.get('path') == '.github/workflows/checks.yml' and
            run.get('status') == 'completed' and run.get('conclusion') in ('success', 'failure') and
            (run.get('repository') or {}).get('full_name') == repository and
            (run.get('head_repository') or {}).get('full_name') == repository,
            'The producer is incomplete, cancelled or has a foreign source/workflow')
    for identity, path in ((run.get('workflow_id'), '.github/workflows/checks.yml'),):
        require(type(identity) is int and identity > 0, 'The producer workflow is not registered')
        registered = get('/actions/workflows/%d' % identity)
        require(registered.get('id') == identity and registered.get('path') == path,
                'The producer workflow registration differs')
    stamp = run.get('run_started_at')
    try:
        parsed = datetime.datetime.fromisoformat(stamp.replace('Z', '+00:00')) if isinstance(stamp, str) else None
        require(parsed is not None and parsed.utcoffset() is not None, 'The producer has no authenticated start time')
        started = int(parsed.timestamp() * 1000)
        require(started > 0, 'The producer has no authenticated start time')
    except (ValueError, OverflowError, OSError):
        raise Refused('The producer has no authenticated start time')
    pull = get('/pulls/%d' % selectors['pr'])
    def bound_pr(value):
        return isinstance(value, dict) and value.get('number') == selectors['pr'] and \
            (value.get('head') or {}).get('sha') == head and \
            (value.get('base') or {}).get('sha') == base and (value.get('base') or {}).get('ref') == branch
    require(bound_pr(pull) and (pull['head'].get('repo') or {}).get('full_name') == repository and
            (pull['base'].get('repo') or {}).get('full_name') == repository,
            'The producer PR source or current live base differs')
    check = get('/check-runs/%d' % selectors['check'])
    require(check.get('id') == selectors['check'] and check.get('head_sha') == head and
            check.get('status') == 'completed' and check.get('conclusion') == 'success' and
            check.get('name') in ('Verdict', 'Verdict for ' + branch) and
            all((check.get('app') or {}).get(k) == v for k, v in train.VERDICT_APP.items()) and
            check.get('external_id') == '%d-%d' % (selectors['run'], run['run_attempt']),
            'The exact producer attempt has no successful protected Verdict')
    for owner in (run, check):
        prs = owner.get('pull_requests')
        require(isinstance(prs, list) and len(prs) == 1 and bound_pr(prs[0]),
                'The producer/Verdict PR binding is missing or stale')
    url = check.get('details_url')
    match = re.fullmatch(re.escape('https://github.com/' + repository + '/actions/runs/') + r'([1-9][0-9]*)', url or '')
    require(match is not None and int(match[1]) != selectors['run'], 'The Verdict has no separate controller run')
    controller = get('/actions/runs/' + match[1])
    require(controller.get('id') == int(match[1]) and controller.get('event') == 'workflow_run' and
            controller.get('name') == 'Verdict' and controller.get('path') == '.github/workflows/verdict.yml' and
            controller.get('status') == 'completed' and controller.get('conclusion') in ('success', 'failure') and
            (controller.get('repository') or {}).get('full_name') == repository,
            'The protected Verdict controller is incomplete or foreign')
    identity = controller.get('workflow_id')
    require(type(identity) is int and identity > 0, 'The Verdict workflow is not registered')
    registered = get('/actions/workflows/%d' % identity)
    require(registered.get('id') == identity and registered.get('path') == '.github/workflows/verdict.yml',
            'The Verdict workflow registration differs')
    require(git('rev-parse', head + '^{tree}').strip() == git('rev-parse', candidate + '^{tree}').strip(),
            'The candidate tree differs from the authenticated judged source')
    if candidate != head:
        require(git('rev-list', '--parents', '-n', '1', candidate).split()[1:] == [base, head],
                'The landing is not the exact judged source merged onto current live')
    return dict(selectors, attempt=run['run_attempt'], head_commit=head, base_commit=base,
                tree=git('rev-parse', head + '^{tree}').strip(), started_at_ms=started,
                controller_run=controller['id'], producer_conclusion=run['conclusion'],
                verdict_conclusion=check['conclusion'], verdict_app=dict(train.VERDICT_APP))


def _sources(config, pieces, waiting, items, candidate, run, git, judged_head):
    selected = []
    for piece in pieces:
        own = set(piece['items']) & items
        if not own:
            continue
        require(set(piece['items']) <= items, 'A judged bundle omits items of its frozen piece')
        if piece.get('release'):
            require(piece.get('train_candidate') in (candidate, judged_head) and isinstance(piece.get('train_sources'), list),
                    'The open judged bundle has no exact candidate/source snapshot')
            selected.extend(piece['train_sources'])
        else:
            require(set(piece['items']) <= waiting, 'The judged bundle includes an unapproved source')
            selected.append(piece)
    seen, identities, result = set(), set(), []
    for piece in selected:
        require(isinstance(piece, dict) and isinstance(piece.get('id'), str) and piece['id'] not in identities and
                isinstance(piece.get('items'), list) and bool(piece['items']) and
                all(type(n) is int and n > 0 for n in piece['items']) and
                len(set(piece['items'])) == len(piece['items']) and not seen.intersection(piece['items']),
                'The judged bundle has duplicate or malformed source identities')
        identities.add(piece['id']); seen.update(piece['items'])
        freeze = _freeze(piece)
        require(freeze is not None and freeze['judged'], 'The judged bundle needs every approved judged freeze')
        approval = _approval(piece)
        git('merge-base', '--is-ancestor', freeze['head_commit'], candidate)
        try:
            paths = source_diff(config.live, freeze['base_commit'], freeze['head_commit'], run=run)
        except ValueError as error:
            raise Refused('The judged bundle frozen source could not be read: ' + str(error))
        require(sorted(paths) == sorted(freeze['files']), 'The judged bundle frozen files differ from actual source')
        result.append({'piece_id': piece['id'], 'items': piece['items'], 'freeze': freeze, 'approval': approval})
    require(seen == items, 'The judged bundle has missing or unapproved items')
    return sorted(result, key=lambda source: (source['approval']['at_ms'], source['approval']['seq']))


def admit(config, candidate, run, *, started_landing=False, producer=None, github=None):
    producer = producer_selectors(producer)
    require(isinstance(candidate, str) and SHA.fullmatch(candidate), 'Admission names the full candidate commit')
    def git(*args):
        answer = run(['git', '-C', str(config.live)] + list(args))
        require(answer.returncode == 0, 'The admission candidate is not a fast-forward of live' if args[0] == 'merge-base'
                else 'The admission candidate/base diff could not be read')
        return answer.stdout
    base = git('rev-parse', 'HEAD').strip()
    require(SHA.fullmatch(base), 'The admission release base is not a full commit')
    try:
        # Ordinary heads still do not consult the pipeline or start a gauntlet.
        # The binder checks ancestry here; admission keeps its judged check below.
        paths = source_diff(config.live, base, candidate, run=run, check_ancestry=False)
    except ValueError as error:
        raise Refused('The admission candidate/base diff could not be read: ' + str(error))
    guarded = train.guarded(paths)
    if not guarded:
        return {'judged': False, 'base_commit': base, 'head_commit': candidate, 'blocked': []}
    git('merge-base', '--is-ancestor', base, candidate)
    items = set()
    for line in git('log', '--format=%(trailers:key=Pipeline,valueonly,separator=%x1d)', base + '..' + candidate).splitlines():
        if line.strip():
            try:
                items.update(releases.trailer_items(line.strip()))
            except releases.Malformed as error:
                raise Refused(str(error))
    require(len(items) <= 1 or producer is not None,
            'A judged bundle needs its complete authenticated producer/Verdict context')
    pieces, waiting, version = approved(config, run)
    blocked = []
    for piece in pieces:
        pending = sorted(set(piece['items']) if piece.get('release') else (set(piece['items']) & waiting) - items)
        if not pending:
            continue
        freeze = _freeze(piece)
        if freeze is not None and freeze['judged']:
            continue
        blocked.append({'piece_id': piece['id'], 'items': pending, 'unclassified': freeze is None, 'piece': piece})
    context, sources, passed = None, [], []
    # Authenticate the new bundle/waiter exception when it is actually needed.
    # A single judged source with no blocker keeps the existing train contract.
    if producer is not None and (len(items) > 1 or blocked):
        try:
            context = _producer(config, candidate, base, git, producer, github)
        except (AttributeError, KeyError, IndexError, TypeError) as error:
            raise Refused('The authenticated producer context is malformed: ' + str(error))
    if len(items) > 1 or blocked and context is not None:
        sources = _sources(config, pieces, waiting, items, candidate, run, git, context['head_commit'])
        require(all(source['approval']['at_ms'] <= context['started_at_ms'] for source in sources),
                'The judged bundle contains a source approved after its producer began')
    if context is not None:
        remaining = []
        for row in blocked:
            piece = row['piece']
            try:
                approval = _approval(piece)
            except Refused:
                approval = None
            if not row['unclassified'] and not piece.get('release') and approval is not None and \
                    approval['at_ms'] > context['started_at_ms']:
                passed.append({'piece_id': piece['id'], 'items': row['items'], 'approved_at_ms': approval['at_ms']})
            else:
                remaining.append(row)
        blocked = remaining
    if blocked:
        names = '; '.join('%s (items %s%s)' % (p['piece_id'], ', '.join(map(str, p['items'])),
                         ', classification missing' if p['unclassified'] else '') for p in blocked)
        raise Refused('Approved, unshipped work is waiting: %s. Land ordinary heads first (classify unknown freezes), '
                      'then carry and rerun the judged head on live; nothing else waits on its gauntlet.' % names)
    return {'judged': True, 'base_commit': base, 'head_commit': candidate, 'guarded_paths': guarded,
            'items': sorted(items), 'pipeline_revision': version, 'blocked': [],
            'sources': sources, 'producer': context, 'passed_waiters': passed}

from __future__ import annotations

"""Read-only admission at each caller's effect boundary; not a reservation."""
import json
from pathlib import Path
import re

from tools import train, releases, deterministic_admission
from aim_next.judgment import SHA, source_diff


DEFAULT_AUDITOR = 'auditor'
# Match the safe actor names accepted by the bound CLI.
ACTOR_ID = re.compile(r'[A-Za-z0-9][A-Za-z0-9._@-]{0,199}')


class Refused(Exception):
    pass


def require(holds, words):
    if not holds:
        raise Refused(words)


def valid_auditor(value):
    return isinstance(value, str) and ACTOR_ID.fullmatch(value) is not None


def _json_call(run, argv, request=None):
    result = run(argv, **({'input': json.dumps(request)} if request is not None else {}))
    require(result.returncode == 0, 'The admission pipeline could not be read; no judged work is authorized')
    try:
        value = json.loads(result.stdout)
    except (ValueError, TypeError):
        raise Refused('The admission pipeline returned no complete JSON answer')
    require(isinstance(value, dict) and not value.get('error'), 'The admission pipeline refused its read')
    return value


def _admission_reader(config, run):
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

    def read(name, args):
        page = _json_call(run, argv + ['view', '-'], {'v': 1, 'binding': binding, 'view': {'name': name, 'args': args}})
        require(page.get('instance_id') == instance, 'The admission read belongs to another instance')
        return page

    return outcome, read


def approved(config, run):
    outcome, read = _admission_reader(config, run)
    cursor, seen, pieces, expected, waiting = 0, set(), {}, None, None
    unseen = object()
    open_release = unseen
    for _ in range(1000):
        page = read('pipeline', {'workspace_id': outcome, 'section': 'now', 'cursor': cursor, 'limit': 100})
        require(page.get('workspace_id') == outcome,
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


def _require_enabled_auditor(read, auditor):
    # The actor list is ordered and includes enabled identities only. Begin at
    # the ID's prefix, including an empty prefix for a one-letter actor ID.
    cursor = auditor[:-1]
    for _ in range(1000):
        page = read('actors', {'cursor': cursor, 'limit': 100})
        rows, following = page.get('items'), page.get('next_cursor')
        require(isinstance(rows, list) and 'next_cursor' in page and
                all(isinstance(row, dict) and isinstance(row.get('id'), str) for row in rows),
                'The admission actor list is incomplete')
        ids = [row['id'] for row in rows]
        require(ids == sorted(set(ids)) and all(id_ > cursor for id_ in ids),
                'The admission actor list is out of order')
        match = next((row for row in rows if row['id'] == auditor), None)
        if match is not None:
            require(match.get('seat_ended') is not True, 'The admission auditor seat has ended')
            return
        if following is None or ids and ids[-1] > auditor:
            break
        require(ids and following == ids[-1], 'The admission actor list has an invalid cursor')
        cursor = following
    raise Refused('The admission auditor is missing or disabled')


def _require_independent_auditor(read, outcome, auditor, sources, version):
    for source in sources:
        number = source['items'][0]
        page = read('pipeline_item', {'workspace_id': outcome, 'number': number})
        require(page.get('workspace_id') == outcome and (page.get('relevant_versions') or {}).get('pipeline') == version,
                'The admission pipeline changed while the auditor was checked')
        item = page.get('item') or {}
        require(isinstance(item, dict) and item.get('number') == number and isinstance(item.get('pieces'), list) and
                all(isinstance(piece, dict) for piece in item['pieces']),
                'The admission pipeline omitted the source piece history')
        matches = [piece for piece in item['pieces'] if piece.get('id') == source['piece_id']]
        # The item history still names its closed source after combine moves
        # its current membership to the release. The freeze must still match.
        require(len(matches) == 1 and matches[0].get('kind') == 'piece' and
                matches[0].get('freeze') == source['freeze'],
                'The admission pipeline omitted or changed the source build identity')
        piece = matches[0]
        topic_id = (piece.get('topic') or {}).get('id')
        stages = piece.get('stages_so_far')
        started_by = (piece.get('started') or {}).get('by')
        require(isinstance(topic_id, str) and topic_id and isinstance(started_by, str) and started_by and
                isinstance(stages, list) and all(isinstance(stage, dict) for stage in stages),
                'The admission pipeline did not identify the source builders')
        topic = read('topic', {'topic_id': topic_id}).get('topic') or {}
        creator = topic.get('creator_id')
        builders = [source['freeze']['by'], started_by, creator]
        builders.extend(stage.get('entered_by') for stage in stages if stage.get('stage_id') == 'build')
        require(topic.get('id') == topic_id and topic.get('workspace_id') == outcome and
                all(isinstance(actor, str) and actor for actor in builders),
                'The admission pipeline did not identify the source builders')
        require(auditor not in builders, 'The admission auditor must be independent of the source builders')


def _audit_source(config, run, audit, auditor, sources, version):
    outcome, read = _admission_reader(config, run)
    _require_enabled_auditor(read, auditor)
    _require_independent_auditor(read, outcome, auditor, sources, version)
    return read('source', {'source_ref': {'kind': 'message', 'id': audit['message']}})


def admit(config, candidate, run, *, started_landing=False, producer=None, github=None, judgment=None):
    # Legacy callers may still pass a selector, but no selector authorizes judged
    # work. Verdict is an attributed observation in the deterministic judgment.
    producer_selectors(producer)  # An optional legacy selector is never authority, but malformed input still refuses.
    require(isinstance(candidate, str) and SHA.fullmatch(candidate), 'Admission names the full candidate commit')
    def raw_git(*args):
        return run(['git', '-C', str(config.live)] + list(args))
    def git(*args):
        answer = raw_git(*args)
        require(answer.returncode == 0, 'The admission candidate/base Git fact could not be read')
        return answer.stdout
    base = git('rev-parse', 'HEAD').strip()
    require(SHA.fullmatch(base), 'The admission release base is not a full commit')
    try:
        paths = source_diff(config.live, base, candidate, run=run, check_ancestry=False)
    except ValueError as error:
        raise Refused('The admission candidate/base diff could not be read: ' + str(error))
    guarded = train.guarded(paths)
    if not guarded:
        return {'judged': False, 'base_commit': base, 'head_commit': candidate, 'blocked': []}
    auditor = getattr(config, 'admission_auditor', DEFAULT_AUDITOR)
    require(valid_auditor(auditor), 'admission_auditor must be a valid actor ID')
    git('merge-base', '--is-ancestor', base, candidate)
    items = set()
    for line in git('log', '--format=%(trailers:key=Pipeline,valueonly,separator=%x1d)', base + '..' + candidate).splitlines():
        if line.strip():
            try:
                items.update(releases.trailer_items(line.strip()))
            except releases.Malformed as error:
                raise Refused(str(error))
    # Warp18837, current revision1: judged trains carry three items at most.
    require(0 < len(items) <= 3, 'Warp18837: a judged carry names one to three Pipeline items')
    require(len(items) == 1 or deterministic_admission.selected(judgment),
            'A judged bundle requires version1131 deterministic evidence; producer selectors are not authority')
    pieces, waiting, version = approved(config, run)
    blocked = []
    for piece in pieces:
        pending = (set(piece['items']) & waiting) - items
        if not pending:
            continue
        freeze = _freeze(piece)
        if freeze is None or not freeze['judged']:
            blocked.append({'piece_id': piece['id'], 'items': sorted(pending), 'unclassified': freeze is None})
    require(not blocked, 'Approved, unshipped ordinary work is waiting; land ordinary heads first: ' +
            '; '.join('%s (items %s%s)' % (row['piece_id'], ', '.join(map(str, row['items'])),
                ', classification missing' if row['unclassified'] else '') for row in blocked))
    require(deterministic_admission.selected(judgment),
            'Judged admission requires version1131 deterministic evidence; Verdict is never required')
    try:
        context = deterministic_admission.validate(judgment, raw_git, base, candidate)
        sources = _sources(config, pieces, waiting, items, candidate, run, git, context['head'])
        require(all(source['approval']['at_ms'] <= context['created_at_ms'] for source in sources),
                'A frozen source was approved after the carry was created')
        named = context['core_cohort']['pieces']
        require({row['piece_id']: row['head'] for row in named} ==
                {row['piece_id']: row['freeze']['head_commit'] for row in sources},
                'Core cohort does not name every exact canonical frozen source')
        deterministic_admission.audit(judgment, _audit_source(config, run, judgment['audit'], auditor, sources, version),
                                      auditor)
    except deterministic_admission.Refused as error:
        raise Refused(str(error))
    return {'judged': True, 'base_commit': base, 'head_commit': candidate, 'guarded_paths': guarded,
            'items': sorted(items), 'pipeline_revision': version, 'blocked': [],
            'sources': sources, 'deterministic': context, 'producer': None, 'passed_waiters': []}

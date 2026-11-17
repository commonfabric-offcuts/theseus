#!/usr/bin/python3 -I
from __future__ import annotations

"""Deal the Checks workflow's shards, using the deploy's small-fix decision.

Reads committed Git data only. Any unavailable scope means a full run.
See docs/scoped-ci.md. --github-output writes the two workflow outputs.
"""

import argparse
import json
import os
from pathlib import Path
import sys

if __package__ in (None, ''):
    sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from tools import release_check as check, unit_shards


def scope_record(base, changed, chosen, notes):
    native = ['native-' + step.name for step in check.NATIVE_STEPS]
    if len(chosen) != len(set(chosen)) or not set(chosen) <= set(native):
        raise check.Refused('scope did not choose unique native steps')
    return {'steps': chosen, 'live': base, 'changed': changed,
            'not_run': [name for name in native if name not in chosen],
            'notes': notes[:20], 'why': check.scoped_words(base, chosen)}


def plan(root, event_name, event, head, browser_shards=3, measured=None, weights=None):
    """{shards, scoped, why}: PR scope when provable; otherwise every required step."""
    if browser_shards < 1:
        raise ValueError('at least one browser shard')
    scoped, why = None, 'only pull requests may scope their checks'
    if event_name == 'pull_request':
        try:
            base = event['pull_request']['base']['sha']
            pr_head = event['pull_request']['head']['sha']
            if not all(isinstance(sha, str) and check.COMMIT.fullmatch(sha) for sha in (base, pr_head, head)):
                raise check.Refused('event has no exact base, PR head and tested head')
            # On GitHub HEAD is the tested merge, whose first parent must be the
            # event base. A moving release branch requires a fresh PR event.
            if head != pr_head:
                parents = check.git(root, 'rev-list', '--parents', '-n', '1', head)
                if parents.returncode or parents.stdout.strip().split() != [head, base, pr_head]:
                    raise check.Refused('tested merge does not bind the event base and PR head')
            changed, chosen, notes = check.scope(root, base, head)
            problems = check.small_fix_problems(changed)
            if problems:
                raise check.Refused('; '.join(problems))
            scoped = scope_record(base, changed, chosen, notes)
            why = scoped['why']
        except (check.Refused, OSError, ValueError, KeyError, TypeError, AttributeError, SyntaxError) as error:
            why = 'full run: scope unavailable: %s' % error
    native = scoped['steps'] if scoped is not None else ['native-' + step.name for step in check.NATIVE_STEPS]
    measured = measured or {}
    known = sorted(measured.values())
    median = known[len(known) // 2] if known else 1.0
    loads = [[0.0, []] for _ in range(browser_shards)]
    for name in sorted(native, key=lambda n: -measured.get(n, median)):
        lightest = min(loads, key=lambda b: b[0])
        lightest[0] += measured.get(name, median)
        lightest[1].append(name)
    shards = [{'name': 'browser %d of %d (about %.0f min)' % (i + 1, browser_shards, load), 'steps': ','.join(names), 'timeout': 75}
              for i, (load, names) in enumerate(loads) if names]
    if weights is None:
        weights = json.loads((Path(__file__).resolve().parents[1] / '.github/check-weights.json').read_text())
    shards.extend(unit_shards.jobs(root, weights))
    shards.append({'name': 'wake replay', 'steps': check.WAKE_REPLAY, 'timeout': 45})
    expected = set(check.REQUIRED) - set(scoped['not_run'] if scoped else [])
    ordinary = [s for shard in shards if not shard.get('python_shard') for s in shard['steps'].split(',')]
    assert sorted(ordinary + ['python-units']) == sorted(expected)
    return {'shards': shards, 'scoped': scoped, 'why': why}


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--event-name', default=os.environ.get('GITHUB_EVENT_NAME', ''))
    parser.add_argument('--event', default=os.environ.get('GITHUB_EVENT_PATH'))
    parser.add_argument('--head', default=os.environ.get('GITHUB_SHA', ''))
    parser.add_argument('--browser-shards', type=int, default=int(os.environ.get('BROWSER_SHARDS', '3')))
    parser.add_argument('--github-output', action='store_true')
    args = parser.parse_args(argv)
    root = Path(__file__).resolve().parents[1]
    try:
        event = json.loads(Path(args.event).read_text()) if args.event else {}
    except (OSError, ValueError):
        event = {}
    weights = json.loads((root / '.github/check-weights.json').read_text())
    result = plan(root, args.event_name, event, args.head, args.browser_shards, weights['minutes'], weights)
    if args.github_output:
        print('shards=' + json.dumps(result['shards']))
        print('scoped=' + json.dumps(result['scoped']))
        print(result['why'], file=sys.stderr)
    else:
        print(json.dumps(result, indent=2))
    return 0


if __name__ == '__main__':
    sys.exit(main())

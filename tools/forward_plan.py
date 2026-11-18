#!/usr/bin/python3 -I
from __future__ import annotations

"""Deal the Checks workflow's shards using complete committed input coverage (734).

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

from tools import release_check as check, ci_input_reads


def scope_record(base, changed, chosen, notes):
    native = ['native-' + step.name for step in check.NATIVE_STEPS]
    if len(chosen) != len(set(chosen)) or not set(chosen) <= set(native):
        raise check.Refused('scope did not choose unique native steps')
    return {'steps': chosen, 'live': base, 'changed': changed,
            'not_run': [name for name in native if name not in chosen],
            'notes': notes[:20], 'why': check.scoped_words(base, chosen)}


def plan(root, event_name, event, head, browser_shards=3, measured=None):
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
            scoped = ci_input_reads.pr_record(root, base, head)
            why = scoped['why']
        except (check.Refused, ci_input_reads.Refused, OSError, ValueError, KeyError, TypeError, AttributeError, SyntaxError) as error:
            why = 'full run: scope unavailable: %s' % error
    native = scoped['steps'] if scoped is not None else ['native-' + step.name for step in check.NATIVE_STEPS]
    # Path C uses one fresh full obligation. No historical scope is retained.
    from tools import compose_groups
    scoped = None
    native = ['native-' + step.name for step in check.NATIVE_STEPS if step.name != 'compose']
    source = {'head':head, 'tree':check.git(root,'rev-parse',head+'^{tree}').stdout.strip(),
              'parents':check.git(root,'rev-list','--parents','-n','1',head).stdout.strip().split()[1:]}
    partitioned = compose_groups.partition(compose_groups.enumerate_source(root,head),source)
    compose_jobs = compose_groups.group_jobs(partitioned,compact=True)
    measured = measured or {}
    known = sorted(measured.values())
    median = known[len(known) // 2] if known else 1.0
    loads = [[0.0, []] for _ in range(browser_shards)]
    for name in sorted(native, key=lambda n: -measured.get(n, median)):
        lightest = min(loads, key=lambda b: b[0])
        lightest[0] += measured.get(name, median)
        lightest[1].append(name)
    shards = [{'name': 'browser %d of %d (about %.0f min)' % (i + 1, browser_shards, load), 'steps': ','.join(names)}
              for i, (load, names) in enumerate(loads) if names]
    shards.append({'name': 'units and deploy refusals', 'steps': ','.join(check.UNIT_STEPS + (check.DEPLOY_REFUSALS,))})
    shards.append({'name': 'wake replay', 'steps': check.WAKE_REPLAY})
    shards.extend(compose_jobs)
    expected = set(check.REQUIRED) - set(scoped['not_run'] if scoped else [])
    ordinary = [s for shard in shards if not shard.get('compose_group') for s in shard['steps'].split(',')]
    assert sorted(ordinary + ['native-compose']) == sorted(expected)
    for index, job in enumerate(shards):
        job['index']=index
    return {'shards': shards, 'scoped': scoped, 'why': why}


def plan_main(argv=None):
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
    measured = json.loads((root / '.github/check-weights.json').read_text())['minutes']
    result = plan(root, args.event_name, event, args.head, args.browser_shards, measured)
    if args.github_output:
        print('all_shards=' + json.dumps(result['shards']))
        print('shards=' + json.dumps(result['shards'][:256]))
        print('shards_more=' + json.dumps(result['shards'][256:]))
        print('has_more=' + ('true' if len(result['shards'])>256 else 'false'))
        print('scoped=' + json.dumps(result['scoped']))
        print(result['why'], file=sys.stderr)
    else:
        print(json.dumps(result, indent=2))
    return 0


def main(argv=None):
    argv = list(sys.argv[1:] if argv is None else argv)
    if argv[:1] != ['--plan']:
        raise SystemExit('use --plan; this installed-base composition does not run unit partitions')
    return plan_main(argv[1:])


def combine(docs, plan, receipts):
    from tools import compose_forward as f
    all_steps=[s for d in docs for s in d.get('steps',[])]
    offered=[];groups=[]
    for job in plan:
        matches=[(d,r) for d,r in zip(docs,receipts) if r.get('shard',{}).get('name')==job['name']]
        if len(matches)!=1:
            raise check.Refused('fresh plan missing/duplicate job')
        doc,_=matches[0]
        if [s['name'] for s in doc.get('steps',[])]!=job['steps'].split(','):
            raise check.Refused('fresh job assigned steps differ')
        if job.get('compose_group'):
            if doc.get('compose_group')!=job['compose_group'] or len(doc['steps'])!=1:
                raise check.Refused('fresh group descriptor differs')
            receipt=doc['steps'][0]['compose_receipt']; group=receipt['planned_group']
            if job['compose_group']!={'id':group['id'],'source':group['source']} or f.f779_digest(group['cases'])!=group['cases_sha256']:
                raise check.Refused('fresh group inventory differs')
            groups.append(group);offered.append(receipt)
    ordinary=[s for s in all_steps if s['name']!='native-compose']
    if len({s['name'] for s in ordinary})!=len(ordinary) or sum(s['name']=='native-compose' for s in all_steps)!=len(offered):
        raise check.Refused('fresh plan duplicates a step')
    return ordinary+[f.f779_step(f.f779_fold(groups,offered))]


if __name__ == '__main__':
    sys.exit(main())

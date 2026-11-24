"""execution_compare.py CARRY_EVENTS LIVE_EVENTS [SPEC]

Every case that passed on live must run on the carry: pass there, or fail (which the failing-name comparison names).
A case that passed on live and is skipped, marked todo, cancelled or gone on the carry has stopped running. Nothing
about the carry's diff explains that, since a skip can come from any file a test reads; a deliberate change is named
in SPEC.json's execution_changes, one entry per case, {"file", "names", "why"} with a non-empty why. The events are
node_reporter.mjs's lines: file, name path, occurrence and status.
Exit 0: every case that stopped running is named with its reason (listed). Exit 5: a case stopped running and SPEC
names no reason for it (listed). Exit 2: unreadable, or an entry without a reason.
"""
import json
import sys


def cases(path):
    out = {}
    with open(path, encoding='utf-8') as stream:
        for line in stream:
            if line.strip():
                event = json.loads(line)
                out[(event['file'], event['names'], event['occurrence'])] = event['status']
    return out


def main(carry_path, live_path, spec_path=None):
    try:
        carry, live = cases(carry_path), cases(live_path)
        named = json.load(open(spec_path, encoding='utf-8')).get('execution_changes') or [] if spec_path else []
        reasons = {(entry['file'], entry['names']): entry.get('why') for entry in named}
    except (OSError, ValueError, KeyError, TypeError, AttributeError) as error:
        print('execution comparison unreadable: %s' % error)
        return 2
    if not all(isinstance(why, str) and why.strip() for why in reasons.values()):
        print('execution comparison: an execution_changes entry in SPEC.json gives no reason')
        return 2
    if not live:
        print('execution comparison: live reported no case; not a run')
        return 2
    stopped = [(key, carry.get(key, 'gone')) for key, status in sorted(live.items())
               if status == 'pass' and carry.get(key) not in ('pass', 'fail')]
    explained = [(key, now) for key, now in stopped if key[:2] in reasons]
    vanished = [(key, now) for key, now in stopped if key[:2] not in reasons]
    for title, rows in (('named in SPEC.json execution_changes', explained), ('STOPPED RUNNING: passed on live, not run on the carry, and not named', vanished)):
        if rows:
            print('%s (%d):' % (title, len(rows)))
            for (file, names, occurrence), now in rows:
                why = reasons.get((file, names))
                print('  %s :: %s%s -> %s%s' % (file, names, ' #%d' % occurrence if occurrence > 1 else '', now, ' (%s)' % why if why else ''))
    if vanished:
        print('cases stopped running on the carry with no reason named: %d' % len(vanished))
        return 5
    print('every case that passed on live runs on the carry (%d cases, %d stopped with a named reason)'
          % (sum(1 for s in live.values() if s == 'pass'), len(explained)))
    return 0


if __name__ == '__main__':
    sys.exit(main(*sys.argv[1:4]))

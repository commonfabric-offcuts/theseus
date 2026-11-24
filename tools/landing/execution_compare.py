"""execution_compare.py CARRY_EVENTS LIVE_EVENTS CHANGED_FILES

Every case that passed on live must run on the carry: pass there, or fail (which the failing-name comparison names).
A case that passed on live and is skipped, marked todo, cancelled or gone on the carry has stopped running; that is
explained only when the carry changed the case's own test file (CHANGED_FILES, one path per line), and is listed
either way. The events are node_reporter.mjs's lines: file, name path, occurrence and status.
Exit 0: nothing stopped running, or each case that did is in a file the carry changed. Exit 5: a case stopped running
in a file the carry did not change (listed). Exit 2: unreadable.
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


def main(carry_path, live_path, changed_path):
    try:
        carry, live = cases(carry_path), cases(live_path)
        changed = {line.strip() for line in open(changed_path, encoding='utf-8') if line.strip()}
    except (OSError, ValueError, KeyError) as error:
        print('execution comparison unreadable: %s' % error)
        return 2
    if not live:
        print('execution comparison: live reported no case; not a run')
        return 2
    stopped = [(key, carry.get(key, 'gone')) for key, status in sorted(live.items())
               if status == 'pass' and carry.get(key) not in ('pass', 'fail')]
    explained = [(key, now) for key, now in stopped if key[0] in changed]
    vanished = [(key, now) for key, now in stopped if key[0] not in changed]
    for title, rows in (('explained: the carry changed its file', explained), ('VANISHED: passed on live, no longer runs on the carry', vanished)):
        if rows:
            print('%s (%d):' % (title, len(rows)))
            for (file, names, occurrence), now in rows:
                print('  %s :: %s%s -> %s' % (file, names, ' #%d' % occurrence if occurrence > 1 else '', now))
    print('every case that passed on live runs on the carry (%d cases, %d explained by the carry\'s own changes)'
          % (sum(1 for s in live.values() if s == 'pass'), len(explained)) if not vanished else
          'cases stopped running on the carry: %d' % len(vanished))
    return 5 if vanished else 0


if __name__ == '__main__':
    sys.exit(main(*sys.argv[1:4]))

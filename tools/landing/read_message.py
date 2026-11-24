"""read_message.py TOPIC MESSAGE_ID AFTER_SEQ: one message, whole, read from the board through the seat's CLI.

The CLI reads a topic in pages from a seq, and Core's answer to a post names no seq, so the topic is read from AFTER_SEQ
(0 for its start) page by page until the message appears, at most PAGES pages. Prints the message as JSON (id, topic_id,
seq, author_id, sent_ms, withheld, body; decisions.message_from_read). Exit 0: found. Exit 1: not in the pages read.
Exit 2: a read failed."""
import json, subprocess, sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import config  # noqa: E402
import decisions  # noqa: E402

PAGES, LIMIT = 100, 50


def find(topic, message_id, after):
    cli = config.cli() + ['--json']
    cursor = int(after)
    for _ in range(PAGES):
        got = subprocess.run(cli + ['read', topic, '--after', str(cursor), '--limit', str(LIMIT)], capture_output=True, text=True)
        if got.returncode != 0:
            raise RuntimeError('read %s after %d failed: %s' % (topic, cursor, (got.stdout + got.stderr)[-300:]))
        rows = [json.loads(line) for line in got.stdout.split('\n') if line.strip()]
        message = decisions.message_from_read(rows, message_id)
        if message:
            return message
        page = next((r for r in rows if 'items' in r), {})
        following = page.get('next_cursor')
        if not page.get('items') or following is None or following <= cursor:
            return None
        cursor = following
    return None


if __name__ == '__main__':
    try:
        found = find(*sys.argv[1:4])
    except (RuntimeError, ValueError) as error:
        print('STOP: %s' % error)
        sys.exit(2)
    if not found:
        print('STOP: %s is not in %s after seq %s' % (sys.argv[2], sys.argv[1], sys.argv[3]))
        sys.exit(1)
    print(json.dumps(found))

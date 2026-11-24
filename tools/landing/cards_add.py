"""cards_add.py ITEM RELEASE: puts <posts>/card-ITEM.md at the top of the Done section of the seat's cards page.

The card's "release NNN at TIME" is filled with RELEASE and the time the release record says it went live, so a
publication finished late still states when the release went live. The page is read, the card inserted under its
"## Done" heading, and the revision written with --expected the revision read, three tries when another writer moves
it in between. The page's scratch section (a heading holding SCRATCH) must come through byte for byte, or nothing is
written. A card whose title is already on the page is not added again."""
import datetime, re, subprocess, sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import config  # noqa: E402


def scratch(body):
    i = body.find('SCRATCH')
    if i < 0:
        return ''
    i = body.rfind('\n## ', 0, i) + 1
    j = body.find('\n## ', i + 1)
    return body[i:j if j >= 0 else len(body)]


def insert(body, card):
    """The page with the card at the top of its Done section; refuses a page without one or with a changed scratch."""
    i = body.find('## Done')
    if i < 0:
        raise SystemExit('REFUSED: the cards page has no "## Done" section')
    k = body.find('\n', i) + 1
    while body[k:k + 1] == '\n':
        k += 1
    new = body[:k] + card.rstrip('\n') + '\n\n' + body[k:]
    if scratch(new) != scratch(body):
        raise SystemExit('REFUSED: inserting the card would change the scratch section')
    return new


def live_time(releases, release):
    """When RELEASE went live, from the release record's listing (`releases`: "release N  COMMIT  ISO-TIME  shipped …")."""
    for line in releases.split('\n'):
        fields = line.split()
        if fields[:2] == ['release', str(release)] and len(fields) >= 4:
            return datetime.datetime.fromisoformat(fields[3]).strftime('%-I:%M %p')
    raise SystemExit('REFUSED: the release record does not list release %s' % release)


def main(item, release):
    posts, note = Path(config.get('posts')), config.get('cards_note')
    cli = config.cli()
    path = posts / ('card-%s.md' % item)
    record = subprocess.run(cli + ['releases', '--limit', '20'], capture_output=True, text=True).stdout
    card = re.sub(r'release (NNN|\d+) at (TIME|\d+:\d\d [AP]M)', 'release %s at %s' % (release, live_time(record, release)), path.read_text())
    path.write_text(card)
    title = card.split('\n')[0]
    for _ in range(3):
        read = subprocess.run(cli + ['note', 'read', note], capture_output=True, text=True)
        revision = re.search(r'revision (\d+)', read.stdout.split('\n')[0] if read.stdout else '')
        if read.returncode or not revision:
            raise SystemExit('REFUSED: the cards page %s did not read: %s' % (note, (read.stdout + read.stderr)[-300:]))
        body = '\n'.join(read.stdout.split('\n')[2:])
        if title in body:
            print('card %s on the page: already there at revision %s' % (item, revision.group(1)))
            return 0
        new = posts / 'cards.new.md'
        new.write_text(insert(body, card))
        out = subprocess.run(cli + ['note', 'revise', note, '--expected', revision.group(1), str(new)], capture_output=True, text=True)
        last = (out.stdout.strip().split('\n') or [''])[-1]
        if 'revised' in last:
            print('card %s on the page: %s' % (item, last))
            return 0
        print('cards (expected %s): %s' % (revision.group(1), last))
    return 1


if __name__ == '__main__':
    sys.exit(main(sys.argv[1], sys.argv[2]))

// The red "New" line in a topic: just below the oldest message the reader has
// not read (docs/attention.md, "The New line"). Messages are newest first, so
// the line sits under that message's card, with every message newer than it
// above.
const integer = n => Number.isSafeInteger(n) && n >= 1;

// What a topic_messages or topic_unread answer says of the line: {value, at},
// value the oldest unread message ({seq, id}, or null when everything is read)
// and at the commit the answer reflects; undefined from a server that does not say.
export function oldestUnreadOf(answer) {
  if (!Object.hasOwn(answer, 'oldest_unread')) return undefined;
  const value = answer.oldest_unread, at = answer.commit_seq;
  if (value !== null && !(value && integer(value.seq) && typeof value.id === 'string' && value.id) || !Number.isSafeInteger(at) || at < 0)
    throw Object.assign(Error('The oldest unread message is malformed.'), { code: 'INVALID_FRESHNESS_VIEW' });
  return { value, at };
}

// Puts the line just below the card of message seq, or takes it away when
// there is none. When that message is older than every loaded card, the line
// sits at the bottom of what is loaded, says "New · older below", and is a
// button that calls loadOlder; once the card is loaded, the line takes its
// place below it. loadOlder is null when nothing older is left to load; then
// no line promises older messages. A message among the loaded ones with no
// card here has no line. The line carries no data-seq or data-id, so nothing that looks cards
// up by them ever finds it.
export function placeNewLine(list, seq, doc = document, loadOlder) {
  const children = [...list.children];
  const found = children.filter(child => ['new', 'older'].includes(child.dataset?.line));
  const cards = children.filter(child => !found.includes(child));
  const card = seq ? cards.find(child => Number(child.dataset?.seq) === seq) : null;
  const oldest = cards.at(-1);
  const further = Boolean(seq && !card && oldest && seq < Number(oldest.dataset.seq));
  if (further && loadOlder !== null && typeof loadOlder !== 'function') throw Error('A New line for a message further back needs what loads the older messages.');
  const kind = card ? 'new' : further && loadOlder ? 'older' : null;
  let line = found.find(child => child.dataset.line === kind) ?? null;
  for (const stale of found) if (stale !== line) stale.remove();
  if (!kind) return null;
  if (!line && kind === 'new') {
    line = doc.createElement('div');
    line.className = 'new-line'; line.dataset.line = 'new'; line.textContent = 'New';
    line.title = 'Just above: the oldest message you have not read';
  } else if (!line) {
    line = doc.createElement('button');
    line.type = 'button'; line.className = 'new-line new-line-older'; line.dataset.line = 'older'; line.textContent = 'New · older below';
    line.title = 'The oldest message you have not read is further back: press to load it';
  }
  if (kind === 'older') line.onclick = () => loadOlder();
  const next = card ? cards[cards.indexOf(card) + 1] ?? null : null;
  const now = [...list.children];
  if (card ? now[now.indexOf(card) + 1] !== line : now.at(-1) !== line) list.insertBefore(line, next);
  return line;
}

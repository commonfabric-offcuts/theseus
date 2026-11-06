// The red New line in a topic ("New above"): just below the oldest message the reader has
// not replied to (docs/attention.md, "Not yet replied to"). Messages are
// newest first, so the line sits under that message's card, with every message
// it has not answered above it.
const integer = n => Number.isSafeInteger(n) && n >= 1;

// What a topic_messages answer says of the boundary: {seq, id}, null when the
// reader has replied to everything, or undefined from a server that does not say.
export function unansweredOf(answer) {
  if (!Object.hasOwn(answer, 'unanswered')) return undefined;
  const value = answer.unanswered;
  if (value !== null && !(value && integer(value.seq) && typeof value.id === 'string' && value.id))
    throw Object.assign(Error('The unanswered boundary is malformed.'), { code: 'INVALID_FRESHNESS_VIEW' });
  return value;
}

// The line's words, in an element of their own, apart from anything else the
// line shows.
function labelled(doc, line, words) {
  const label = doc.createElement('span');
  label.className = 'new-line-label'; label.textContent = words;
  line.append(label);
  return line;
}

// Puts the line just below the card of message seq, or takes it away when
// there is none. It says "New above": messages are newest first, so what the
// reader has not answered is above it. When that message is older than every
// loaded card, the line sits at the bottom of what is loaded, says "More new
// below", and is a button that calls loadOlder; once the card is loaded, the
// line takes its place below it. loadOlder is null when nothing older is left to load; then
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
    line.className = 'new-line'; line.dataset.line = 'new'; labelled(doc, line, 'New above');
    line.title = 'Above: the messages you have not replied to, the oldest just above this line';
  } else if (!line) {
    line = doc.createElement('button');
    line.type = 'button'; line.className = 'new-line new-line-older'; line.dataset.line = 'older'; labelled(doc, line, 'More new below');
    line.title = 'Messages you have not replied to are further back: press to load down to the oldest';
  }
  if (kind === 'older') line.onclick = () => loadOlder();
  const next = card ? cards[cards.indexOf(card) + 1] ?? null : null;
  const now = [...list.children];
  if (card ? now[now.indexOf(card) + 1] !== line : now.at(-1) !== line) list.insertBefore(line, next);
  return line;
}

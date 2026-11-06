// The red "New" line in a topic: just below the oldest message the reader has
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

// Puts the line just below the card of message seq, or takes it away when
// there is none or that card is not loaded. The line carries no data-seq or
// data-id, so nothing that looks cards up by them ever finds it.
export function placeNewLine(list, seq, doc = document) {
  const children = [...list.children];
  let line = children.find(child => child.dataset?.line === 'new') ?? null;
  const card = seq ? children.find(child => Number(child.dataset?.seq) === seq) : null;
  if (!card) { line?.remove(); return null; }
  if (!line) {
    line = doc.createElement('div');
    line.className = 'new-line'; line.dataset.line = 'new'; line.textContent = 'New';
    line.title = 'Just above: the oldest message you have not replied to';
  }
  const after = children.filter(child => child !== line);
  const next = after[after.indexOf(card) + 1] ?? null;
  if (children[children.indexOf(card) + 1] !== line) list.insertBefore(line, next);
  return line;
}

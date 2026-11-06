// The red "New" line in a topic: just below the oldest message the reader has
// not replied to (docs/attention.md, "Not yet replied to"). Messages are
// newest first, so the line sits under that message's card, with every message
// it has not answered above it.
import { datedTime, shownTime, timeNode } from './times.mjs';

const integer = n => Number.isSafeInteger(n) && n >= 1;

// What a topic_messages answer says of the boundary: {seq, id, sent_ms}, null
// when the reader has replied to everything, or undefined from a server that
// does not say. sent_ms is null for a message from before times were kept, and
// absent from a server that does not send it.
export function unansweredOf(answer) {
  if (!Object.hasOwn(answer, 'unanswered')) return undefined;
  const value = answer.unanswered;
  const sent = value?.sent_ms;
  if (value !== null && !(value && integer(value.seq) && typeof value.id === 'string' && value.id &&
    (sent === undefined || sent === null || Number.isSafeInteger(sent))))
    throw Object.assign(Error('The unanswered boundary is malformed.'), { code: 'INVALID_FRESHNESS_VIEW' });
  return value;
}

const LABELS = { new: 'New', older: 'New · older below' };
const TITLES = {
  new: sent => `Just above: the oldest message you have not replied to${sent}`,
  older: sent => `The oldest message you have not replied to is further back${sent}: press to load it`,
};

// Puts the line just below the card of message seq, or takes it away when
// there is none. When that message is older than every loaded card, the line
// sits at the bottom of what is loaded, says "New · older below", and is a
// button that calls loadOlder; once the card is loaded, the line takes its
// place below it. loadOlder is null when nothing older is left to load; then
// no line promises older messages. A message among the loaded ones with no
// card here has no line. The line carries no data-seq or data-id, so nothing that looks cards
// up by them ever finds it.
//
// sent is when that message was sent, or null: the line then says it after
// its label ("New · 4:40 AM", docs/times.md), the label and the time each in
// a span of their own, inside one span of words.
export function placeNewLine(list, seq, doc = document, loadOlder, sent = null) {
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
    line.className = 'new-line'; line.dataset.line = 'new';
  } else if (!line) {
    line = doc.createElement('button');
    line.type = 'button'; line.className = 'new-line new-line-older'; line.dataset.line = 'older';
  }
  paintWords(line, kind, Number.isSafeInteger(sent) ? sent : null, doc);
  if (kind === 'older') line.onclick = () => loadOlder();
  const next = card ? cards[cards.indexOf(card) + 1] ?? null : null;
  const now = [...list.children];
  if (card ? now[now.indexOf(card) + 1] !== line : now.at(-1) !== line) list.insertBefore(line, next);
  return line;
}

// The line's words: its label, then when its message was sent; its title
// keeps the date. Painted again only when they would change.
function paintWords(line, kind, sent, doc) {
  line.title = TITLES[kind](sent === null ? '' : ` (sent ${datedTime(sent)})`);
  const shows = JSON.stringify([kind, sent, sent === null ? null : shownTime(sent)]);
  if (line.dataset.shows === shows) return;
  line.dataset.shows = shows;
  const words = doc.createElement('span'), label = doc.createElement('span');
  words.className = 'new-line-words'; label.className = 'new-line-label'; label.textContent = LABELS[kind];
  words.append(label);
  if (sent !== null) {
    const at = doc.createElement('span');
    at.className = 'new-line-time'; at.append(' · ', timeNode(sent, doc));
    words.append(at);
  }
  line.replaceChildren(words);
}

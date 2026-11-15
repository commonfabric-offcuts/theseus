// The red New line in a topic ("New above"): just below the oldest message
// the reader has not read (docs/attention.md, "The New line"). Messages are
// newest first, so the line sits under that message's card, with every
// message newer than it above.
import { datedTime, shownTime, timeNode } from './times.mjs';

const integer = n => Number.isSafeInteger(n) && n >= 1;

// What a topic_messages or topic_unread answer says of the line: {value, at},
// value the oldest unread message ({seq, id, sent_ms}, or null when everything
// is read) and at the commit the answer reflects; undefined from a server that
// does not say. sent_ms is null for a message from before times were kept, and
// absent from a server that does not send it.
export function oldestUnreadOf(answer) {
  if (!Object.hasOwn(answer, 'oldest_unread')) return undefined;
  const value = answer.oldest_unread, at = answer.commit_seq, sent = value?.sent_ms;
  if (value !== null && !(value && integer(value.seq) && typeof value.id === 'string' && value.id &&
    (sent === undefined || sent === null || Number.isSafeInteger(sent))) || !Number.isSafeInteger(at) || at < 0)
    throw Object.assign(Error('The oldest unread message is malformed.'), { code: 'INVALID_FRESHNESS_VIEW' });
  return { value, at };
}

// The line's label sits in an element of its own (span.new-line-label), apart
// from the time the line shows after it.
const LABELS = { new: 'New above', older: 'More new below' };
const TITLES = {
  new: sent => `Above: the messages you have not read, the oldest just above this line${sent}`,
  older: sent => `Messages you have not read are further back${sent}: press to load down to the oldest`,
};

// Puts the line just below the card of message seq, or takes it away when
// there is none. It says "New above": messages are newest first, so what the
// reader has not read is above it. When that message is older than every
// loaded card, the line sits at the bottom of what is loaded, says "More new
// below", and is a button that calls loadOlder. The bottom is the end of the
// run the reader reads down: above More messages, where the dossiers put
// below More follow (item 426), never after them. Once the card is loaded, the
// line takes its place below it. loadOlder is null when nothing older is left to load; then
// no line promises older messages. A message among the loaded ones with no
// card here has no line. The line carries no data-seq or data-id, so nothing that looks cards
// up by them ever finds it.
//
// sent is when that message was sent, or null: the line then says it after
// its label ("New above · 4:40 AM", docs/times.md), the label and the time each in
// a span of their own, inside one span of words.
//
// held is false once nothing holds the line (TopicViews.held): the line stays
// in its place but fades out (.new-line-read, a CSS transition), and is inert
// meanwhile, so neither a pointer, Tab nor a screen reader finds it; held
// again, it fades back in wherever it is placed.
export function placeNewLine(list, seq, doc = document, loadOlder, sent = null, held = true) {
  const children = [...list.children];
  const found = children.filter(child => ['new', 'older'].includes(child.dataset?.line));
  const cards = children.filter(child => !found.includes(child));
  const card = seq ? cards.find(child => Number(child.dataset?.seq) === seq) : null;
  // More ends the run the line waits at the bottom of, and the oldest card is the last of that run: what follows
  // More is the dossiers put below it, each where its newest message sits.
  const more = cards.find(child => child.classList?.contains('stack-more')) ?? null;
  const oldest = (more ? cards.slice(0, cards.indexOf(more)) : cards).at(-1);
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
  line.classList.toggle('new-line-read', !held); line.inert = !held;
  if (kind === 'older') line.onclick = () => loadOlder();
  const next = card ? cards[cards.indexOf(card) + 1] ?? null : more;
  const now = [...list.children];
  if (card ? now[now.indexOf(card) + 1] !== line : !now.includes(line) || (now[now.indexOf(line) + 1] ?? null) !== next) list.insertBefore(line, next);
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

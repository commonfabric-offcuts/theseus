// A message between others (docs/attention.md, "Messages between others"):
// sent by name to others, by someone else, and not an answer to one of the
// viewer's messages. It is never unread for the person; the topic page shows
// it folded into one quiet line, a button that opens its card below it and
// folds it away again.
import { paintAuthor } from './marks.mjs';
import { linkWords } from './links.mjs';

// A message that names no addressees is for everyone in the topic. Only a
// person (kind 'human') has messages between others, as Core settles them only
// for a person: an agent's deliveries are its work, unread until handled.
export function betweenOthers(item, viewer, kind) {
  if (typeof viewer !== 'string' || !viewer || !['human', 'agent'].includes(kind)) throw Error('Whether a message is between others depends on who reads it.');
  const to = item.addressees ?? [];
  if (!Array.isArray(to)) throw Error('A message names its addressees in a list.');
  return kind === 'human' && to.length > 0 && !to.includes(viewer) && item.author_id !== viewer && item.reply_to_author !== viewer;
}

const lines = item => String(item.body ?? '').split('\n').map(line => line.trim()).filter(Boolean);
// What the line says after the author: whom the message is to, and its first words.
export function foldWords(item) {
  return ` to ${item.addressees.join(', ')}: ${lines(item)[0] ?? ''}`;
}
// Whether those first words may end where an excerpt was cut: the message is
// an excerpt and its first line is its last, so an address there may be cut short.
const cutShort = item => item.preview === true && lines(item).length < 2;

const folds = new WeakMap();

// The fold for card, which keeps its own place in the list: data-id and
// data-seq go on the fold, so what finds a message's place finds the fold.
export function foldCard(card, item, doc = document) {
  const fold = doc.createElement('div'), line = doc.createElement('button'), author = doc.createElement('span'), words = doc.createElement('span');
  fold.className = 'message-fold'; fold.dataset.id = item.id; fold.dataset.seq = item.seq;
  line.type = 'button'; line.className = 'fold-line';
  author.className = 'fold-author'; words.className = 'fold-words'; linkWords(words, foldWords(item), { partial: cutShort(item) });
  line.append(author, words);
  card.id = `card-${item.id}`; line.setAttribute('aria-controls', card.id);
  line.onclick = () => show(fold, card.hidden);
  fold.append(line, card);
  folds.set(fold, { line, author, words, card, name: item.author_id, item, open: false });
  show(fold, false);
  return fold;
}

// Opens (true) or folds (false) the card in fold.
export function show(fold, open) {
  const state = folds.get(fold), { line, card, item } = state;
  state.open = open;
  const ownNote = item.yours?.note === true;
  line.hidden = ownNote;
  card.hidden = !open && !ownNote; line.setAttribute('aria-expanded', String(open || ownNote));
}

// The card a list entry shows: a fold's card, or the entry itself.
export const cardIn = entry => folds.get(entry)?.card ?? entry;

// A fold's line says the message's latest words once it is edited (docs/message-edit.md).
export function paintFoldWords(entry, item) {
  const fold = folds.get(entry);
  if (fold) linkWords(fold.words, foldWords(item), { partial: cutShort(item) });
  paintOwnNoteFold(entry, item);
}

// Reader metadata can arrive after the card. Keep the requested fold for
// when its note is cleared; the note only overrides how it reads (800).
export function paintOwnNoteFold(entry, item) {
  const fold = folds.get(entry);
  if (!fold) return;
  fold.item = item;
  show(entry, fold.open);
}

// A fold's line carries the Unread pill of a message marked unread; any other entry has no line.
export function paintFold(entry, marked) {
  const fold = folds.get(entry);
  if (fold) paintAuthor(fold.author, fold.name, null, marked);
}

// The entry opened to show its card, and that card, to take the focus.
export function opened(entry) {
  if (folds.has(entry)) show(entry, true);
  return cardIn(entry);
}

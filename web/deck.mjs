// A deck of cards is a Notebook page (docs/decks.md). Each card is a ##
// heading and the words under it, up to the next ## heading; a heading inside
// a fenced block is not one. What comes before the first card is the deck's
// opening and stays where it is. A card's text, as a person writes it, is its
// title on the first line and its words below, so a line of theirs that
// starts with ## starts another card.
//
// An act gives a new deck from a deck. Only a card an act writes is written
// out again, so a card that only moves keeps its exact words, and a deck read
// and written back with nothing done to it is the page it came from. An act
// names its card by its text, near where it stood, so the same act can be
// made again on a newer revision of the page, and it answers the act that
// takes it back.

const FENCE = /^ {0,3}(`{3,}|~{3,})/, CARD = /^ {0,3}##(?:[ \t]+(.*?))?[ \t]*$/;

const write = card => (card.title ? `## ${card.title}` : '##') + (card.words ? `\n\n${card.words}` : '');
const words = text => text.replace(/^(?:[ \t]*\n)+/, '').replace(/\s+$/, '');

export const cardText = card => card.words ? `${card.title}\n${card.words}` : card.title;

// The fence a line leaves open: the one it opens, none when it closes the one
// open, or the one open still.
function fenceAfter(fence, line) {
  const open = FENCE.exec(line);
  if (fence) return open && open[1][0] === fence[0] && open[1].length >= fence.length && !/\S/.test(line.slice(open[0].length)) ? null : fence;
  return open ? open[1] : null;
}

// A card's reply stacks: each line of its words, outside a fenced block, that
// holds only a link stackOf(address) names, written bare or as
// [words](address). Gives the words without those lines, and what stackOf
// named for each line, in order.
const LINK_LINE = /^[ \t]*(?:\[[^\]\n]*\]\([ \t]*<?([^\s<>()]+)>?[ \t]*\)|<?(https?:\/\/[^\s<>]+)>?)[ \t]*$/;
export function cardStacks(text, stackOf) {
  const kept = [], stacks = [];
  let fence = null;
  for (const line of text.split('\n')) {
    const before = fence;
    fence = fenceAfter(fence, line);
    const link = !before && !fence && LINK_LINE.exec(line), stack = link && stackOf(link[1] ?? link[2]);
    if (stack) stacks.push(stack); else kept.push(line);
  }
  return { words: words(kept.join('\n')), stacks };
}
// The line that names a card's reply stack, as the deck writes it.
export const stackLine = address => `[Reply stack](${address})`;

// A card from the text a person wrote: the first line that is not blank is
// its title, any heading marks on it dropped; the rest are its words.
export function textCard(text) {
  const lines = text.replace(/\r\n?/g, '\n').split('\n'), first = lines.findIndex(line => /\S/.test(line));
  if (first < 0) return { title: '', words: '', written: true };
  return { title: lines[first].replace(/^ {0,3}#{1,6}(?:[ \t]+|$)/, '').trim(), words: words(lines.slice(first + 1).join('\n')), written: true };
}

export function parseDeck(body) {
  const lines = body.split('\n'), starts = [];
  let fence = null;
  for (let i = 0, offset = 0; i < lines.length; offset += lines[i].length + 1, i++) {
    const before = fence;
    fence = fenceAfter(fence, lines[i]);
    if (!before && !fence && CARD.test(lines[i])) starts.push(offset);
  }
  const cards = starts.map((start, at) => {
    const raw = body.slice(start, starts[at + 1] ?? body.length), end = raw.indexOf('\n');
    const title = (CARD.exec(end < 0 ? raw : raw.slice(0, end))[1] ?? '').replace(/(?:^|[ \t]+)#+$/, '').trim();
    return { raw, at, last: at === starts.length - 1, title, words: end < 0 ? '' : words(raw.slice(end + 1)) };
  });
  return { opening: body.slice(0, starts[0] ?? body.length), cards };
}

// The page's words for a deck. A card keeps its words exactly, and only where
// it now stands beside a card it did not stand beside before, or ends the
// page when it did not, is the space between them set: a blank line between
// cards, one line break at the end.
export function deckBody({ opening, cards }) {
  let body = opening && cards.length && cards[0].at !== 0 ? opening.replace(/\n*$/, '\n\n') : opening;
  cards.forEach((card, i) => {
    const next = cards[i + 1], text = card.written ? write(card) : card.raw;
    if (next) body += !card.written && next.at === card.at + 1 ? text : text.replace(/\n*$/, '\n\n');
    else body += !card.written && card.last ? text : text.replace(/\n*$/, '\n');
  });
  return body;
}

// The card whose text is this one, nearest to where it stood; -1 when none is.
export function findCard(deck, text, near = 0) {
  let found = -1;
  deck.cards.forEach((card, i) => {
    if (cardText(card) === text && (found < 0 || Math.abs(i - near) < Math.abs(found - near))) found = i;
  });
  return found;
}

// applyAct(deck, act) gives {deck, at, undo}: the deck after the act, the card
// it leaves picked and the act that takes it back; or null when there is
// nothing to do, because a card it names is gone, it would move or merge past
// either end, or an edit changes nothing.
//   {kind: 'move', text, step, near}       moves the card one place up (-1) or down (1)
//   {kind: 'merge', text, step, near}      the card and its neighbour become one under the upper
//                                          card's title, the lower card's title a ### heading in it
//   {kind: 'split', text, upper, lower, near}  a merged card becomes its two cards again
//   {kind: 'edit', text, to, near}         the card's text becomes `to`; no text removes the card
//   {kind: 'add', after, text, near}       a new card after the card `after` (null: first)
//   {kind: 'remove', text, near}
export function applyAct(deck, act) {
  const cards = deck.cards.slice(), i = act.kind === 'add' ? -1 : findCard(deck, act.text, act.near);
  const done = (at, undo) => ({ deck: { ...deck, cards }, at, undo });
  if (act.kind !== 'add' && i < 0) return null;
  switch (act.kind) {
    case 'move': {
      const j = i + act.step;
      if (j < 0 || j >= cards.length) return null;
      [cards[i], cards[j]] = [cards[j], cards[i]];
      return done(j, { kind: 'move', text: act.text, step: -act.step, near: j });
    }
    case 'merge': {
      const top = Math.min(i, i + act.step);
      if (top < 0 || top + 1 >= cards.length) return null;
      const [upper, lower] = cards.slice(top, top + 2);
      const merged = { title: upper.title, words: [upper.words, lower.title && `### ${lower.title}`, lower.words].filter(Boolean).join('\n\n'), written: true };
      cards.splice(top, 2, merged);
      return done(top, { kind: 'split', text: cardText(merged), upper: cardText(upper), lower: cardText(lower), near: top });
    }
    case 'split':
      cards.splice(i, 1, textCard(act.upper), textCard(act.lower));
      return done(i, { kind: 'merge', text: act.upper, step: 1, near: i });
    case 'edit': {
      if (act.to === act.text) return null;
      const card = textCard(act.to);
      if (!cardText(card)) return applyAct(deck, { kind: 'remove', text: act.text, near: i });
      if (cardText(card) === act.text) return null;
      cards[i] = card;
      return done(i, { kind: 'edit', text: cardText(card), to: act.text, near: i });
    }
    case 'add': {
      const card = textCard(act.text), anchor = act.after === null ? -1 : findCard(deck, act.after, act.near);
      if (!cardText(card)) return null;
      const at = act.after === null ? 0 : anchor >= 0 ? anchor + 1 : Math.min(Math.max(act.near + 1, 0), cards.length);
      cards.splice(at, 0, card);
      return done(at, { kind: 'remove', text: cardText(card), near: at });
    }
    case 'remove':
      cards.splice(i, 1);
      return done(Math.min(i, cards.length - 1), { kind: 'add', after: i > 0 ? cardText(deck.cards[i - 1]) : null, text: act.text, near: i - 1 });
    default:
      throw new Error(`No such act on a deck: ${act.kind}`);
  }
}

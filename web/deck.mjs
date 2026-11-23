import { cardDetails, withCardDetails, stripDetails, mergeDetails, detailsLine } from './card-details.mjs';
// A deck of cards is a Notebook page (docs/decks.md). Each card is a heading
// of two to six #s and the words under it, up to the next such heading; a
// heading inside a fenced block is not one. A card's depth is its #s past two,
// and the cards after it that are deeper are its children: a ## card is the
// deck's own, and a ### card under it is one of its children. What comes
// before the first card is the deck's opening and stays where it is. A card's
// text, as a person writes it, is its title on the first line and its words
// below, so a line of theirs that starts with ## starts another card.
//
// An act gives a new deck from a deck, and a card's children go where the act
// takes the card. Only a card an act writes is written out again, so a card
// that only moves keeps its exact words, and a deck read and written back with
// nothing done to it is the page it came from. An act names its card by its
// text, near where it stood, so the same act can be made again on a newer
// revision of the page, and it answers the act that takes it back.

import { fenceEnd, fenceOpen } from './fences.mjs';
import { isEscapable } from './characters.mjs';

const CARD = /^ {0,3}(#{2,6})(?:[ \t]+(.*?))?[ \t]*$/;
// The deepest a card can be, since a heading has at most six #s.
export const DEEPEST = 4;

const heading = depth => '#'.repeat(depth + 2);
const write = card => (card.title ? `${heading(card.depth)} ${card.title}` : heading(card.depth)) + (card.words ? `\n\n${card.words}` : '');
// The card at another depth: one read from the page keeps its words exactly, only its heading's #s changed.
const atDepth = (card, depth) => card.depth === depth ? card
  : card.written ? { ...card, depth } : { ...card, depth, raw: card.raw.replace(/^( {0,3})#{2,6}/, `$1${heading(depth)}`) };
const words = text => text.replace(/^(?:[ \t]*\n)+/, '').replace(/\s+$/, '');
const lineText = line => (line ?? '').replace(/\r$/, '');

export const cardText = card => card.words ? `${card.title}\n${card.words}` : card.title;

// The fence a line leaves open: the one it opens, none when it closes the one
// open, or the one open still.
function fenceAfter(fence, line, next = '') {
  // Detection normalizes CRLF; the deck's raw source and offsets stay intact.
  line = lineText(line); next = lineText(next);
  if (fence) return fenceEnd(line, fence) >= 0 ? null : fence;
  const open = fenceOpen(line, next);
  return open && open.end < 0 ? open : null;
}

// A card's reply stacks: each line of its words, outside a fenced block, that
// holds only a link stackOf(address) names, written bare or as
// [words](address). Gives the words without those lines, and what stackOf
// named for each line, in order.
const LINK_LINE = /^[ \t]*(?:\[[^\]\n]*\]\([ \t]*<?([^\s<>()]+)>?[ \t]*\)|<?(https?:\/\/[^\s<>]+)>?)[ \t]*$/;
export function cardStacks(text, stackOf) {
  const { words: kept, taken } = takeLines(text, line => { const link = LINK_LINE.exec(line); return link && stackOf(link[1] ?? link[2]); });
  return { words: kept, stacks: taken };
}
// The lines of a card's words, outside a fenced block, that take(line) names: the words without them, and what
// take named for each, in order.
function takeLines(text, take) {
  const kept = [], taken = [], lines = text.split('\n');
  let fence = null;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const before = fence;
    fence = fenceAfter(fence, line, lines[i + 1]);
    const named = !before && !fence && take(lineText(line));
    if (named) taken.push(named); else kept.push(line);
  }
  return { words: words(kept.join('\n')), taken };
}
// The line that names a card's reply stack, as the deck writes it.
export const stackLine = address => `[Reply stack](${address})`;

// A card's images (item 321): each line of its words, outside a fenced block, that holds only one of the page's
// attachments written as an image, ![name](attachment:ID). Gives the words without those lines, and each image's
// {name, id, line}, in order. The page's attachments hold the bytes; the line says which card shows them.
const IMAGE_LINE = /^[ \t]*!\[([^\]\n]*)\]\(attachment:([A-Za-z0-9._-]{1,200})\)[ \t]*$/;
export function cardImages(text) {
  const { words: kept, taken } = takeLines(text, line => { const image = IMAGE_LINE.exec(line); return image && { name: image[1], id: image[2], line: line.trim() }; });
  return { words: kept, images: taken };
}
// The image a line of a page names, {name, id}, when it holds only ![name](attachment:ID); null for any other line.
// Whether the line stands outside a fenced block is the reader's to know (cardImages, imageStandIns).
export function lineImage(line) {
  const image = IMAGE_LINE.exec(lineText(line));
  return image && { name: image[1], id: image[2] };
}
// Where a page's words show only as words (a Notebook card's excerpt, what changed in a page, an ask quoting a
// card), each image line reads as the image's name after an image glyph, never as its markup. partial: the words are
// an excerpt cut short, so their last line may be an image line cut inside its address, which reads the same way.
export const IMAGE_GLYPH = '🖼';
const standIn = name => `${IMAGE_GLYPH} ${name.trim() || 'Image'}`;
const CUT_LINE = /^[ \t]*!\[([^\]\n]*)\]\(([A-Za-z0-9._:-]*)$/;
export function imageStandIns(text, { partial = false } = {}) {
  const lines = stripDetails(String(text ?? ''), {partial}).split('\n');
  let fence = null;
  return lines.map((line, i) => {
    const before = fence;
    fence = fenceAfter(fence, line, lines[i + 1]);
    if (before || fence) return line;
    const image = lineImage(line), end = line.endsWith('\r') ? '\r' : '';
    if (image) return standIn(image.name) + end;
    const cut = partial && i === lines.length - 1 && CUT_LINE.exec(line);
    const address = cut && cut[2];
    return cut && (address.length <= 11 ? 'attachment:'.startsWith(address) : /^attachment:[A-Za-z0-9._-]*$/.test(address)) ? standIn(cut[1]) : line;
  }).join('\n');
}
// The line that puts one of the page's attachments in a card, as the deck writes it: brackets and line breaks in
// its name, which would end the line's words, are spaces.
export function imageLine(name, id) {
  if (!/^[A-Za-z0-9._-]{1,200}$/.test(id)) throw Error(`No image line names the attachment ${JSON.stringify(id)}`);
  return `![${name.replace(/[ \t]*[[\]\\\r\n]+[ \t]*/g, ' ').trim() || 'Image'}](attachment:${id})`;
}

// What a card box makes of its card: what is written, then the lines naming its images and its stacks under it. A
// new card holding only images is named for the first of them, so it is made with them; a card cleared of all its
// text is still removed, its images with it, and a new card with nothing in it is never made.
export function boxText({ written, images = [], stacks = [], details = [], fresh = false }) {
  const kept = [...images, ...stacks];
  if (!kept.length&&!details.length) return written;
  const restore = text => {
    if(!details.length)return text;
    const detail=cardDetails(details.join('\n')),restored=withCardDetails(text,detail);
    if(restored.startsWith(detailsLine(detail)+'\n\n')){
      // withCardDetails placed it before an open fence. Keep the editor's
      // first nonblank line as the title, and insert metadata just after it.
      const lines=text.split('\n'),first=lines.findIndex(line=>/\S/.test(line));
      lines.splice(first+1,0,'',detailsLine(detail),'');return lines.join('\n');
    }
    return restored;
  };
  if (/\S/.test(written)) return restore([written.trimEnd(),kept.join('\n')].filter(Boolean).join('\n\n'));
  if (!fresh || !images.length) return written;
  const [first] = cardImages(images[0]).images;
  return restore(`${first.name.replace(/\.[A-Za-z0-9]{1,5}$/, '').trim() || 'Image'}\n\n${kept.join('\n')}`);
}

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
    fence = fenceAfter(fence, lines[i], lines[i + 1]);
    if (!before && !fence && CARD.test(lineText(lines[i]))) starts.push(offset);
  }
  const cards = starts.map((start, at) => {
    const raw = body.slice(start, starts[at + 1] ?? body.length), end = raw.indexOf('\n');
    const [, marks, title = ''] = CARD.exec(lineText(end < 0 ? raw : raw.slice(0, end)));
    return { raw, at, last: at === starts.length - 1, depth: marks.length - 2, title: title.replace(/(?:^|[ \t]+)#+$/, '').trim(), words: end < 0 ? '' : words(raw.slice(end + 1)) };
  });
  return { opening: body.slice(0, starts[0] ?? body.length), cards };
}

// Where the card at i ends with its children: the index after the last of them.
export function groupEnd(cards, i) {
  let end = i + 1;
  while (end < cards.length && cards[end].depth > cards[i].depth) end++;
  return end;
}

// The card beside the one at i among its parent's children, a step up (-1) or down (1); -1 when none is.
function sibling(cards, i, step) {
  const depth = cards[i].depth;
  if (step > 0) { const next = groupEnd(cards, i); return next < cards.length && cards[next].depth === depth ? next : -1; }
  for (let j = i - 1; j >= 0; j--) if (cards[j].depth <= depth) return cards[j].depth === depth ? j : -1;
  return -1;
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

// Where a place in a card's words as shown falls in the words as written. The shown text leaves out the
// markup (`**`, a link's address, a quote's `>`) and spaces its blocks its own way, so the written words are
// walked beside it: each shown character is the next written one like it, close ahead, and what comes before
// that is markup. A space shown takes one written space, if one is next; a character not close ahead is the
// page's own and is passed over.
export function writtenAt(written, shown, at) {
  let i = 0;
  for (const character of shown.slice(0, at)) {
    if (/\s/.test(character)) { if (/\s/.test(written[i] ?? '')) i++; continue; }
    const found = written.indexOf(character, i);
    if (found >= 0 && found - i <= 300) i = found + 1;
  }
  return i;
}

// The card whose text is this one, nearest to where it stood; -1 when none is.
export function findCard(deck, text, near = 0) {
  let found = -1;
  const ids = cardDetails(text).ids;
  const visible = value => {
    const at=value.indexOf('\n'),title=at<0?value:value.slice(0,at),words=at<0?'':cardDetails(value.slice(at+1)).words;
    return words?title+'\n'+words:title;
  };
  deck.cards.forEach((card, i) => {
    if (ids.length && !cardDetails(card.words).ids.some(id=>ids.includes(id))) return;
    if (visible(cardText(card)).trimEnd() === visible(text).trimEnd() && (found < 0 || Math.abs(i - near) < Math.abs(found - near))) found = i;
  });
  return found;
}

// Ephemeral structural context for a region act, never a stored card identity.
// Body-only edits outside the region can coexist; a structural change requires
// a fresh gesture rather than guessing which identical occurrence survived.
export const cardRegionShape = deck => deck.cards.map(card => [card.depth, card.title, cardDetails(card.words).ids]);

// applyAct(deck, act) gives {deck, at, undo}: the deck after the act, the card
// it leaves picked and the act that takes it back; or null when there is
// nothing to do, because a card it names is gone, it would go past the end of
// its parent's children or deeper than DEEPEST, or an edit changes nothing.
// Every act takes a card's children with it.
//   {kind: 'move', text, step, near}       moves the card past the one beside it, up (-1) or down (1)
//   {kind: 'merge', text, step, near}      appends the picked card's plain title, words and children
//                                          to its neighbour, which keeps its title
//   {kind: 'split', text, upper, lower, keep, step, near}  restores the two cards and their child groups;
//                                          `keep` children belonged to the upper, `step` names the merge
//   {kind: 'edit', text, to, near}         the card's text becomes `to`; no text removes the card
//   {kind: 'add', after, text, depth, rest, near}  a new card right after the card `after` (null:
//                                          first), and the cards `rest`, each {text, depth}, after it
//   {kind: 'remove', text, near}
//   {kind: 'indent', text, near}           the card goes under the one above it, as its last child
//   {kind: 'outdent', text, near}          the card leaves its parent, to follow the parent's children
//   {kind: 'place', text, after, depth, near}  the card goes right after the card `after` (null:
//                                          first), at that depth
//   {kind: 'many', acts, text, near}       the acts one after another, each on the deck the last left,
//                                          leaving the card `text` picked; nothing if one can't be made
export function applyAct(deck, act) {
  // A card split replaces one exact source/children region as a single act.
  // Its inverse names the exact replacement: changed writing is never consumed
  // by an Undo, while unrelated cards outside the region remain untouched.
  if (act.kind === 'card-region') {
    const body = deckBody(deck);
    if (typeof act.from !== 'string' || !act.from || typeof act.to !== 'string' || act.from === act.to) return null;
    if (!Number.isInteger(act.index) || act.index < 0 || act.index >= deck.cards.length ||
        JSON.stringify(cardRegionShape(deck)) !== JSON.stringify(act.shape)) return null;
    const at = deck.opening.length + deck.cards.slice(0, act.index).reduce((sum, card) => sum + card.raw.length, 0);
    if (body.slice(at, at + act.from.length) !== act.from) return null;
    const next = parseDeck(body.slice(0, at) + act.to + body.slice(at + act.from.length));
    let offset = next.opening.length, picked = 0;
    next.cards.forEach((card, i) => { if (offset <= at + (act.focus ?? 0)) picked = i; offset += card.raw.length; });
    return { deck: next, at: picked, undo: { kind: 'card-region', from: act.to, to: act.from,
      near: at, focus: 0, index: act.index, shape: cardRegionShape(next) } };
  }
  if (act.kind === 'many') {
    let now = deck;
    const undos = [];
    for (const each of act.acts) {
      const done = applyAct(now, each);
      if (!done) return null;
      now = done.deck;
      undos.unshift(done.undo);
    }
    const at = findCard(now, act.text, act.near);
    return { deck: now, at: at >= 0 ? at : Math.min(act.near, now.cards.length - 1), undo: { kind: 'many', acts: undos, text: act.text, near: act.near } };
  }
  const cards = deck.cards.slice(), i = act.kind === 'add' ? -1 : findCard(deck, act.text, act.near);
  const done = (at, undo) => ({ deck: { ...deck, cards }, at, undo });
  if (act.kind !== 'add' && i < 0) return null;
  const end = i < 0 ? -1 : groupEnd(cards, i), depth = i < 0 ? 0 : cards[i].depth;
  switch (act.kind) {
    case 'move': {
      const j = sibling(cards, i, act.step);
      if (j < 0) return null;
      const [top, bottom] = act.step < 0 ? [j, i] : [i, j], lower = cards.splice(bottom, groupEnd(cards, bottom) - bottom);
      cards.splice(top, 0, ...lower);
      const at = act.step < 0 ? j : i + lower.length;
      return done(at, { kind: 'move', text: act.text, step: -act.step, near: at });
    }
    case 'merge': {
      const j = sibling(cards, i, act.step);
      if (j < 0) return null;
      const top = Math.min(i, j), bottom = Math.max(i, j), upper = cards[top], lower = cards[bottom];
      const target = cards[j], moved = cards[i], targetChildren = cards.slice(j + 1, groupEnd(cards, j)), movedChildren = cards.slice(i + 1, end);
      const plainTitle = [...moved.title].map(char => isEscapable(char) ? '\\' + char : char).join('');
      const targetDetails = cardDetails(target.words), movedDetails = cardDetails(moved.words);
      const merged = { title: target.title, depth, words: withCardDetails([targetDetails.words, plainTitle, movedDetails.words].filter(Boolean).join('\n\n'), mergeDetails(targetDetails, movedDetails)), written: true };
      cards.splice(top, groupEnd(cards, bottom) - top, merged, ...targetChildren, ...movedChildren);
      return done(top, { kind: 'split', text: cardText(merged), upper: cardText(upper), lower: cardText(lower), upperTitle: upper.title, lowerTitle: lower.title, keep: bottom - top - 1, step: act.step, near: top });
    }
    case 'split': {
      const keep = Math.min(act.keep ?? 0, end - i - 1);
      const children = cards.slice(i + 1, end), down = act.step > 0;
      const upperChildren = down ? children.slice(children.length - keep) : children.slice(0, keep);
      const lowerChildren = down ? children.slice(0, children.length - keep) : children.slice(keep);
      const upper = textCard(act.upper), lower = textCard(act.lower);
      // A link allocated after the merge belongs to its surviving target,
      // while the old moved identities return to the separated card.
      const target=down?lower:upper,original=cardDetails(target.words),merged=cardDetails(cards[i].words);
      const known=new Set([...cardDetails(upper.words).ids,...cardDetails(lower.words).ids]);
      const added=merged.ids.filter(id=>!known.has(id));
      if(added.length){
        const id=original.id??merged.id,aliases=[...new Set([...original.aliases,...added])].filter(each=>each!==id);
        target.words=withCardDetails(target.words,{id,aliases,color:merged.color});
      }
      // Titles are literal on a card, even when they begin with Markdown heading characters.
      cards.splice(i, end - i, { ...upper, title: act.upperTitle ?? upper.title, depth }, ...upperChildren,
        { ...lower, title: act.lowerTitle ?? lower.title, depth }, ...lowerChildren);
      const at = down ? i : i + 1 + keep;
      return done(at, { kind: 'merge', text: down ? act.upper : act.lower, step: down ? 1 : -1, near: at });
    }
    case 'details': {
      const before = cardDetails(cards[i].words);
      if (act.fromColor !== undefined && act.fromColor !== before.color) return null;
      const id = before.id ?? act.id ?? null, aliases = before.aliases.filter(each=>each!==id);
      const color = act.color === undefined ? before.color : act.color;
      const changed = withCardDetails(cards[i].words, {id, aliases, color});
      if (changed === cards[i].words) return null;
      cards[i] = {...cards[i], words: changed, written: true};
      return done(i, {kind: 'details', text: cardText(cards[i]), near: i, color: before.color, fromColor: color});
    }
    case 'edit': {
      if (act.to === act.text) return null;
      const card = textCard(act.to);
      if (!cardText(card)) return applyAct(deck, { kind: 'remove', text: act.text, near: i });
      if (cardText(card) === act.text) return null;
      const details = cardDetails(cards[i].words);
      let editedWords = card.words;
      if (details.ids.length) {
        // A heading typed into the body starts a new card. The old identity
        // belongs before that heading, on the card whose title was edited.
        const visible = cardDetails(editedWords).words, nested = parseDeck(visible);
        editedWords = withCardDetails(nested.opening, details) + (nested.cards.length ? '\n\n' + visible.slice(nested.opening.length) : '');
      }
      cards[i] = { ...card, words: editedWords, depth };
      return done(i, { kind: 'edit', text: cardText(cards[i]), to: cardText(deck.cards[i]), near: i });
    }
    case 'add': {
      const card = { ...textCard(act.text), depth: act.depth ?? 0 }, anchor = act.after === null ? -1 : findCard(deck, act.after, act.near);
      if (!cardText(card)) return null;
      const at = act.after === null ? 0 : anchor >= 0 ? anchor + 1 : Math.min(Math.max(act.near + 1, 0), cards.length);
      cards.splice(at, 0, card, ...(act.rest ?? []).map(({ text, depth: under }) => ({ ...textCard(text), depth: under })));
      return done(at, { kind: 'remove', text: cardText(card), near: at });
    }
    case 'remove': {
      const removed = cards.splice(i, end - i), rest = removed.slice(1).map(card => ({ text: cardText(card), depth: card.depth }));
      return done(Math.min(i, cards.length - 1), { kind: 'add', after: i > 0 ? cardText(deck.cards[i - 1]) : null, text: cardText(removed[0]), depth, rest, near: i - 1 });
    }
    case 'indent':
      if (sibling(cards, i, -1) < 0 || cards.slice(i, end).some(card => card.depth >= DEEPEST)) return null;
      return applyAct(deck, { kind: 'place', text: act.text, after: cardText(cards[i - 1]), depth: depth + 1, near: i });
    case 'outdent': {
      if (depth === 0) return null;
      let parent = i - 1;
      while (parent >= 0 && cards[parent].depth >= depth) parent--;
      const parentEnd = parent < 0 ? end : groupEnd(cards, parent);
      const after = parentEnd === end ? (i > 0 ? cardText(cards[i - 1]) : null) : cardText(cards[parentEnd - 1]);
      return applyAct(deck, { kind: 'place', text: act.text, after, depth: depth - 1, near: i });
    }
    case 'place': {
      const block = cards.splice(i, end - i), shift = act.depth - depth;
      if (block.some(card => card.depth + shift < 0 || card.depth + shift > DEEPEST)) return null;
      const anchor = act.after === null ? -1 : findCard({ cards }, act.after, i - 1);
      if (act.after !== null && anchor < 0) return null;
      if (anchor + 1 === i && shift === 0) return null;
      cards.splice(anchor + 1, 0, ...block.map(card => atDepth(card, card.depth + shift)));
      return done(anchor + 1, { kind: 'place', text: act.text, after: i > 0 ? cardText(deck.cards[i - 1]) : null, depth, near: anchor + 1 });
    }
    default:
      throw new Error(`No such act on a deck: ${act.kind}`);
  }
}

// groupAct(deck, picks, kind, {step, text, near}) gives the one act that makes an act on several cards, so
// that ⌘Z takes it back whole, leaving the card `text` picked; or null when it changes nothing. picks are
// the cards' indices, and a picked card under another picked card goes with that one. 'remove' takes them
// all away. For 'move', 'indent' and 'outdent' the top card leads and the others follow it as its
// neighbors, each with its children, at its depth and in their order: a move gathers them under the top
// card and then takes them all past the card beside them, a step up (-1) or down (1); an indent puts the top
// card under the card above it, and an outdent takes it out of its parent, the others following it there.
export function groupAct(deck, picks, kind, { step = 0, text, near } = {}) {
  const tops = [];
  for (const i of [...new Set(picks)].sort((a, b) => a - b)) if (!tops.length || i >= groupEnd(deck.cards, tops.at(-1))) tops.push(i);
  const acts = [];
  let now = deck;
  // Each act is made on the deck the last one left, which is where the next one finds its cards.
  const make = act => { const done = applyAct(now, act); if (done) { acts.push(act); now = done.deck; } return done; };
  if (kind === 'remove') for (const i of tops.reverse()) make({ kind: 'remove', text: cardText(deck.cards[i]), near: i });
  else if (tops.length) {
    let lead = tops[0];
    if (kind !== 'move') {
      const done = make({ kind, text: cardText(deck.cards[lead]), near: lead });
      if (!done) return null;
      lead = done.at;
    }
    const depth = now.cards[lead].depth;
    let last = lead;
    for (const i of tops.slice(1)) {
      const cards = now.cards, own = cardText(deck.cards[i]), at = findCard(now, own, i), end = groupEnd(cards, last);
      if (at === end && cards[at].depth === depth) { last = at; continue; }
      const done = make({ kind: 'place', text: own, after: cardText(cards[end - 1]), depth, near: at });
      if (!done) return null;
      last = done.at;
    }
    // The gathered cards go past the card beside them by that card going past them, the other way.
    if (kind === 'move') {
      const cards = now.cards, end = groupEnd(cards, last);
      const beside = step < 0 ? sibling(cards, lead, -1) : end < cards.length && cards[end].depth === depth ? end : -1;
      const after = step < 0 ? cardText(cards[end - 1]) : lead > 0 ? cardText(cards[lead - 1]) : null;
      if (beside >= 0) make({ kind: 'place', text: cardText(cards[beside]), after, depth, near: beside });
    }
  }
  return acts.length ? { kind: 'many', acts, text, near } : null;
}

// placeNew(deck, {after, near, depth}, act) gives where a new card not yet made goes when Tab ({kind: 'indent'}),
// ⇧Tab ({kind: 'outdent'}) or ⌘↑ ⌘↓ ({kind: 'move', step}) moves it, by the rules a made card moves by: {after,
// near, depth}, the card it then follows (null: first) with that card's index, and its depth; or null when there is
// nowhere to go. It stands right after the card `after` (null: first), found nearest `near`, at `depth`.
export function placeNew(deck, { after, near, depth }, act) {
  const anchor = after === null ? -1 : findCard(deck, after, near);
  if (after !== null && anchor < 0) return null;
  // The new card goes in for the move as a card whose text no other card has, so the move finds it again.
  let text = '\0';
  while (deck.cards.some(card => cardText(card) === text)) text += '\0';
  const cards = deck.cards.slice();
  cards.splice(anchor + 1, 0, { title: text, words: '', depth, written: true });
  const done = applyAct({ ...deck, cards }, { ...act, text, near: anchor + 1 });
  if (!done) return null;
  const before = done.deck.cards[done.at - 1];
  return { after: before ? cardText(before) : null, near: done.at - 1, depth: done.deck.cards[done.at].depth };
}

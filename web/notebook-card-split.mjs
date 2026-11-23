import { applyAct, boxText, cardImages, cardStacks, cardText, cardRegionShape, deckBody, findCard, groupEnd, parseDeck, textCard } from './deck.mjs';
import { cardDetails, detailRanges, withCardDetails } from './card-details.mjs';
import { fenceEnd, fenceOpen } from './fences.mjs';
import { messageOf } from './links.mjs';

const sliceMap = (map, start, end) => ({ text: map.text.slice(start, end), positions: map.positions.slice(start, end) });
function trimMap(map) {
  const start = map.text.match(/^(?:[ \t]*\n)+/)?.[0].length ?? 0;
  return sliceMap(map, start, start + map.text.slice(start).replace(/\s+$/, '').length);
}
function omitRanges(map, ranges) {
  let text = '', positions = [], at = 0;
  for (const { start, end } of ranges) {
    text += map.text.slice(at, Math.max(at, start));
    for (let i = at; i < Math.max(at, start); i++) positions.push(map.positions[i]);
    at = Math.max(at, end);
  }
  return { text: text + map.text.slice(at), positions: positions.concat(map.positions.slice(at)) };
}
// Mirror the existing line projection while retaining each kept character's
// source offset. A hidden line's own newline stays with that hidden line.
function projectLines(map, hidden) {
  const lines = map.text.split('\n'); let text = '', positions = [], fence = null, at = 0, previousEnd = null;
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i], line = raw.replace(/\r$/, ''), before = fence;
    if (fence) { if (fenceEnd(line, fence) >= 0) fence = null; }
    else { const open = fenceOpen(line, (lines[i + 1] ?? '').replace(/\r$/, '')); if (open && open.end < 0) fence = open; }
    if (before || fence || !hidden(line)) {
      if (previousEnd !== null) { text += '\n'; positions.push(map.positions[previousEnd]); }
      text += raw;
      for (let j = at; j < at + raw.length; j++) positions.push(map.positions[j]);
      previousEnd = at + raw.length;
    }
    at += raw.length + 1;
  }
  return trimMap({ text, positions });
}
function keptRawCard(current, { value, start, end }, remainder) {
  const meta = cardDetails(current.words), stacks = cardStacks(meta.words, messageOf), images = cardImages(stacks.words);
  if (!meta.lines.length && !stacks.stacks.length && !images.images.length) return undefined;
  const raw = current.written ? deckBody({ opening: '', cards: [current] }) : current.raw;
  const parsed = parseDeck(raw);
  if (parsed.opening || parsed.cards.length !== 1) return null;
  const card = parsed.cards[0], headingEnd = raw.indexOf('\n');
  const titleAt = /^ {0,3}#{2,6}[ \t]*/.exec(raw)?.[0].length;
  const wordsAt = card.words ? raw.indexOf(card.words, headingEnd + 1) : raw.length;
  if (titleAt === undefined || wordsAt < 0 || raw.slice(titleAt, titleAt + card.title.length) !== card.title) return null;
  let map = { text: card.words, positions: Array.from({ length: card.words.length }, (_, i) => wordsAt + i) };
  if (meta.lines.length) map = trimMap(omitRanges(map, detailRanges(card.words)));
  if (map.text !== meta.words) return null;
  map = projectLines(map, line => cardStacks(line, messageOf).stacks.length > 0);
  if (map.text !== stacks.words) return null;
  map = projectLines(map, line => cardImages(line).images.length > 0);
  if (map.text !== images.words) return null;
  const shown = cardText({ title: card.title, words: map.text });
  // The title/body join is an editor separator, not permission to remove the
  // card's structural heading newline. Whole-text moves retain its old title.
  const positions = Array.from({ length: card.title.length }, (_, i) => titleAt + i)
    .concat(map.text ? [null, ...map.positions] : []);
  let normalized = '', ranges = [];
  for (let i = 0; i < shown.length; i++) {
    let offsets = positions[i]; const char = shown[i];
    if (char === '\r' && shown[i + 1] === '\n') offsets = [offsets, positions[++i]];
    normalized += char === '\r' ? '\n' : char; ranges.push(offsets);
  }
  if (normalized !== value) return null;
  const whole = !/\S/.test(remainder), removed = new Set(ranges.slice(start, end).flat()
    .filter(at => Number.isInteger(at) && (!whole || at > headingEnd)));
  let kept = '';
  for (let i = 0; i < raw.length; i++) if (!removed.has(i)) kept += raw[i];
  const result = parseDeck(kept);
  if (result.opening || result.cards.length !== 1 || result.cards[0].depth !== card.depth) return null;
  return { ...result.cards[0], raw: kept, written: false, at: current.at, last: current.last };
}

// One in-memory model act, using existing card serialization. A fresh editor
// still owns its exact selected string; Core receives the ordinary normalized
// card body. No card identity or durable representation is introduced.
export function selectionCardSplit(deck, editing, at = findCard(deck, editing.text, editing.near)) {
  const { value, start, end } = editing;
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end <= start || end > value.length) return null;
  const selected = value.slice(start, end);
  if (!/\S/.test(selected)) return null;
  // The caller supplies the actual editor preview and its card occurrence.
  // Preparing it again would relocate hidden images in unchanged raw cards.
  const beforeDeck = deck;
  if (at < 0 || !beforeDeck.cards[at]) return null;
  const current = beforeDeck.cards[at];
  const remainder = value.slice(0, start) + value.slice(end);
  let source = keptRawCard(current, editing, remainder);
  if (source === null) return null;
  if (source === undefined) {
    // The ordinary no-hidden-line path keeps its existing title/empty rules.
    const kept = boxText({ ...editing, written: remainder });
    if (/\S/.test(remainder) && cardText(textCard(kept))) {
      const changed = applyAct(beforeDeck, { kind: 'edit', text: cardText(current), to: kept, near: at });
      source = changed?.deck.cards[at] ?? current;
    } else {
      source = { title: current.title, depth: current.depth, written: true,
        words: withCardDetails([...(editing.images ?? []), ...(editing.stacks ?? [])].join('\n'), cardDetails(current.words)) };
      if (cardText(source) === cardText(current)) source = current;
    }
  }
  const beforeCards = beforeDeck.cards.slice();
  const last = groupEnd(beforeCards, at), displayCards = beforeCards.slice();
  displayCards[at] = source;
  const moved = { ...textCard(selected), depth: source.depth };
  const afterCards = displayCards.slice(); afterCards.splice(last, 0, moved);
  const before = deckBody({ ...deck, cards: beforeCards }), display = deckBody({ ...deck, cards: displayCards });
  const after = deckBody({ ...deck, cards: afterCards });
  const tail = cards => deckBody({ opening: '', cards });
  const near = before.length - tail(beforeCards.slice(at)).length, suffix = tail(beforeCards.slice(last));
  const from = before.slice(near, before.length - suffix.length), to = after.slice(near, after.length - suffix.length);
  const prefix = before.slice(0, near);
  if (!after.startsWith(prefix) || !after.endsWith(suffix)) return null;
  const anchor = displayCards[last - 1], fresh = { text: '', shown: selected, fresh: true,
    after: cardText(anchor), near: last - 1, depth: source.depth, at: selected.length };
  // Use the same add preview the actual fresh editor will use. If card syntax
  // makes its anchor ambiguous, keep the original writing rather than move it
  // to a guessed position.
  const drawn = parseDeck(display), index = findCard(drawn, fresh.after, fresh.near);
  if (index < 0) return null;
  fresh.near = index;
  const original = parseDeck(before);
  let offset = original.opening.length;
  const sourceIndex = original.cards.findIndex(card => { const here = offset; offset += card.raw.length; return here === near; });
  if (sourceIndex < 0) return null;
  return { before, display, after, fresh, prefix, suffix,
    act: { kind: 'card-region', from, to, near, focus: display.length - suffix.length - near, index: sourceIndex, shape: cardRegionShape(original) } };
}

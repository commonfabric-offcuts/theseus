import { applyAct, boxText, cardText, cardRegionShape, deckBody, findCard, groupEnd, parseDeck, textCard } from './deck.mjs';
import { cardDetails, withCardDetails } from './card-details.mjs';

// One in-memory model act, using existing card serialization. A fresh editor
// still owns its exact selected string; Core receives the ordinary normalized
// card body. No card identity or durable representation is introduced.
export function selectionCardSplit(deck, editing) {
  const { value, start, end } = editing;
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end <= start || end > value.length) return null;
  const selected = value.slice(start, end);
  if (!/\S/.test(selected)) return null;
  // Use the actual editor preview owner, including its unchanged/raw and
  // metadata rules, rather than reserializing an unchanged source first.
  const text = boxText({ ...editing, written: value });
  const prepared = applyAct(deck, editing.fresh
    ? { kind: 'add', after: editing.after, text, depth: editing.depth, near: editing.near }
    : { kind: 'edit', text: editing.text, to: text, near: editing.near });
  const beforeDeck = prepared?.deck ?? deck;
  const at = prepared?.at ?? (editing.fresh ? -1 : findCard(deck, editing.text, editing.near));
  if (at < 0 || !beforeDeck.cards[at]) return null;
  const current = beforeDeck.cards[at];
  const remainder = value.slice(0, start) + value.slice(end);
  // A split never invokes empty-edit removal, including a whole-text move.
  const kept = boxText({ ...editing, written: remainder });
  let source;
  if (/\S/.test(remainder) && cardText(textCard(kept))) {
    const changed = applyAct(beforeDeck, { kind: 'edit', text: cardText(current), to: kept, near: at });
    source = changed?.deck.cards[at] ?? current;
  } else {
    source = { title: current.title, depth: current.depth, written: true,
      words: withCardDetails([...(editing.images ?? []), ...(editing.stacks ?? [])].join('\n'), cardDetails(current.words)) };
    if (cardText(source) === cardText(current)) source = current;
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

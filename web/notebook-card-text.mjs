import { parseDeck } from './deck.mjs';
import { cardDetails, detailsLine, stripDetails, mergeDetails } from './card-details.mjs';

export const cardTextValue = text => String(text ?? '').replace(/\r\n?/g, '\n');
const rowsOf = text => {
  const deck = parseDeck(text); let start = deck.opening.length;
  return deck.cards.map(card => { const row = { card, start, end: start + card.raw.length }; start = row.end; return row; });
};
const wordsOf = card => cardTextValue(cardDetails(card.words).words).trim();
const signature = card => JSON.stringify([card.title, wordsOf(card)]);
const idsOf = details => [...(details.id ? [details.id] : []), ...details.aliases];
const patch = (before, after) => {
  let start = 0, tail = 0;
  while (start < before.length && start < after.length && before[start] === after[start]) start++;
  while (tail < before.length - start && tail < after.length - start && before.at(-tail - 1) === after.at(-tail - 1)) tail++;
  return { start, removed: before.slice(start, before.length - tail), inserted: after.slice(start, after.length - tail) };
};
const applyPatch = (text, edit, undo = false) => text.slice(0, edit.start) + (undo ? edit.removed : edit.inserted) +
  text.slice(edit.start + (undo ? edit.inserted.length : edit.removed.length));
const containsWords = (whole, part) => part && ('\n' + whole + '\n').includes('\n' + part + '\n');
const shape = frame => JSON.stringify(frame);

// A visit's content identities, independent of the transient number/positions
// of parsed headings. A deleted heading can temporarily join cards, but their
// original identities remain available when their writing separates again.
export class CardTextProjection {
  constructor() { this.catalog = new Map(); this.serial = 0; this.history = []; this.cursor = 0; }
  add(card) {
    const key = this.serial++, detail = cardDetails(card.words);
    this.catalog.set(key, { title: card.title, words: wordsOf(card), details: { id: detail.id, aliases: detail.aliases, color: detail.color } });
    return key;
  }
  details(frame) {
    let detail = { ...this.catalog.get(frame.owner).details };
    for (const key of frame.members) if (key !== frame.owner) {
      const moved = this.catalog.get(key).details;
      detail = mergeDetails(detail, { ...moved, ids: idsOf(moved) });
    }
    return detail;
  }
  show(body) {
    const text = cardTextValue(stripDetails(body)), cards = parseDeck(body).cards;
    if (this.text !== text) {
      this.catalog.clear(); this.history = []; this.cursor = 0;
      this.frame = cards.map(card => { const owner = this.add(card); return { owner, members: [owner] }; });
      this.original = { body, text, frame: this.frame, details: cards.map(card => cardDetails(card.words)) };
    } else if (this.body !== body) {
      // A later Cards identity/color act updates the survivor, not all its
      // temporary merged members. Earlier Undo frames refer to that survivor.
      cards.forEach((card, i) => {
        const frame = this.frame[i], entry = this.catalog.get(frame.owner), before = this.details(frame), next = cardDetails(card.words);
        const otherIds = new Set(frame.members.filter(key => key !== frame.owner).flatMap(key => idsOf(this.catalog.get(key).details)));
        for (const key of ['id', 'color']) if (next[key] !== before[key]) entry.details[key] = next[key];
        if (JSON.stringify(next.aliases) !== JSON.stringify(before.aliases)) entry.details.aliases = next.aliases.filter(id => !otherIds.has(id));
      });
    }
    this.body = body; this.text = text; return text;
  }
  render(text, frame, written = text) {
    // An untouched textarea normalizes CRLF; that normalization is not an edit.
    // Undo to the original content also restores its exact bytes when possible.
    if (text === this.original.text && shape(frame) === shape(this.original.frame) && frame.every((row, i) => {
      const next = this.details(row), old = this.original.details[i];
      return ['id','aliases','color'].every(key => JSON.stringify(next[key]) === JSON.stringify(old[key]));
    })) return this.original.body;
    const rows = rowsOf(written); let body = written;
    for (let i = rows.length - 1; i >= 0; i--) {
      const detail = this.details(frame[i]); if (!idsOf(detail).length) continue;
      // Insert immediately after the heading, always outside any body fence.
      // stripDetails removes exactly these inserted bytes, preserving writing.
      const firstBreak = rows[i].card.raw.indexOf('\n');
      let at = rows[i].start + (firstBreak < 0 ? rows[i].card.raw.length : firstBreak);
      if (written[at - 1] === '\r') at--;
      const newline = written.includes('\r\n') ? '\r\n' : '\n';
      body = body.slice(0, at) + newline + newline + detailsLine(detail) + body.slice(at);
    }
    return body;
  }
  match(text, change) {
    const describe = rows => rows.map(row => ({ ...row, title: row.card.title, words: wordsOf(row.card), signature: signature(row.card) }));
    const before = describe(rowsOf(this.text)), after = describe(rowsOf(text)), chosen = new Map(), used = new Set();
    const positions = new Map(after.map((row, i) => [row.start, i]));
    // Unchanged surroundings break ties between truly identical cards. The
    // range never decides whether an identity lives or becomes a merge alias.
    let edit = patch(this.text, text);
    const start = change?.start, end = change?.end, inserted = text.length - this.text.length + (end - start);
    if (Number.isInteger(start) && Number.isInteger(end) && start <= end && inserted >= 0 &&
      this.text.slice(0, start) === text.slice(0, start) && this.text.slice(end) === text.slice(start + inserted))
      edit = { start, removed: this.text.slice(start, end), inserted: text.slice(start, start + inserted) };
    const endAt = edit.start + edit.removed.length, shift = edit.inserted.length - edit.removed.length;
    const choose = (i, key) => { chosen.set(i, key); used.add(key); };
    for (let j = 0; j < before.length; j++) {
      const row = before[j], at = row.end <= edit.start ? row.start : row.start >= endAt ? row.start + shift : -1;
      const i = positions.get(at);
      if (i !== undefined && after[i].signature === row.signature && !chosen.has(i)) choose(i, this.frame[j].owner);
    }
    const active = this.frame.map(row => row.owner), pool = [...new Set([...active, ...this.catalog.keys()])];
    const variants = new Map(pool.map(key => [key, [this.catalog.get(key)]]));
    before.forEach((row, i) => variants.get(this.frame[i].owner).push(row));
    const indexes = [new Map(), new Map(), new Map()];
    for (const key of pool) for (const entry of variants.get(key)) {
      const values = [JSON.stringify([entry.title, entry.words]), entry.words, entry.title];
      values.forEach((value, i) => {
        if (i === 2 && !value) return;
        const found = indexes[i].get(value) ?? [];
        if (found.at(-1) !== key) found.push(key);
        indexes[i].set(value, found);
      });
    }
    // Exact words and title first, then surviving words across a rename, then
    // a surviving title across word edits. Indexed passes avoid scanning the
    // whole catalog for each unchanged card on every textarea input.
    for (let pass = 0; pass < indexes.length; pass++) after.forEach((row, i) => {
      if (chosen.has(i)) return;
      const value = [row.signature, row.words, row.title][pass];
      const key = indexes[pass].get(value)?.find(key => !used.has(key));
      if (key !== undefined) choose(i, key);
    });
    after.forEach((row, i) => {
      if (chosen.has(i)) return;
      const key = pool.find(key => !used.has(key) && variants.get(key).some(entry => containsWords(row.words, entry.words)));
      if (key !== undefined) choose(i, key);
    });
    for (let i = 0; i < after.length; i++) if (!chosen.has(i)) choose(i, this.add(after[i].card));
    const previousMembers = [...new Set(this.frame.flatMap(row => row.members))], assigned = new Set(used);
    const frame = after.map((row, i) => ({ owner: chosen.get(i), members: [chosen.get(i)] }));
    // A joined card holds aliases for the writing it contains. The member's
    // own id/color remains in the catalog for a later heading or Undo split.
    for (const key of previousMembers) if (!assigned.has(key)) {
      const entry = this.catalog.get(key), candidates = after.flatMap((row, i) => containsWords(row.words, entry.words) ? [i] : []);
      if (candidates.length === 1) { frame[candidates[0]].members.push(key); assigned.add(key); }
    }
    this.learn(frame, after);
    return shape(frame) === shape(this.frame) ? this.frame : frame;
  }
  learn(frame, rows) {
    frame.forEach((row, i) => {
      const entry = this.catalog.get(row.owner); entry.title = rows[i].card.title;
      if (row.members.length === 1) entry.words = wordsOf(rows[i].card);
    });
  }
  edit(value, change) {
    const text = cardTextValue(value), direction = change?.inputType === 'historyUndo' ? -1 : change?.inputType === 'historyRedo' ? 1 : 0;
    if (direction) {
      let candidate = this.text, cursor = this.cursor;
      while (direction < 0 ? cursor > 0 : cursor < this.history.length) {
        const entry = this.history[direction < 0 ? --cursor : cursor++];
        candidate = applyPatch(candidate, entry, direction < 0);
        if (candidate === text) {
          this.cursor = cursor; this.frame = direction < 0 ? entry.before : entry.after;
          this.learn(this.frame, rowsOf(text));
          this.text = text; return this.body = this.render(text, this.frame, value);
        }
      }
    }
    if (text === this.text) return this.body;
    const before = this.frame, after = this.match(text, change), entry = { ...patch(this.text, text), before, after };
    this.history.splice(this.cursor); this.history.push(entry); this.cursor = this.history.length;
    this.frame = after; this.text = text; return this.body = this.render(text, after, value);
  }
}
export function keepCardDetails(body, text, change = null) {
  const projection = new CardTextProjection(); projection.show(body); return projection.edit(text, change);
}

import * as breakParagraphs from './text-display-break-paragraphs.mjs';

export const textDisplayRules = [breakParagraphs];

// The reading is data only. A rule cannot mutate an input block in place and
// then pass the identity shortcut below with changed words or protected spans.
function readonly(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) readonly(child);
  return Object.freeze(value);
}

// Compare mapped runs as well as words, so an equal string mapped to another
// source cannot pass. Paragraph boundaries may not cut a protected inline span.
function preservesParts(block, parts, sentenceOnly = false) {
  if (!Array.isArray(parts)) return false;
  const boundaries = sentenceOnly ? new Set(block.passages.map(part => part.to)) : null;
  let from = 0, protectedAt = 0;
  for (const part of parts) {
    if (!part || part.kind !== 'paragraph' || !part.words?.text.length) return false;
    const to = from + part.words.text.length;
    if (to > block.words.text.length || boundaries && !boundaries.has(to)) return false;
    while (protectedAt < block.protectedSpans.length && block.protectedSpans[protectedAt].end <= to) protectedAt++;
    if (protectedAt < block.protectedSpans.length && block.protectedSpans[protectedAt].start < to) return false;
    const expected = block.words.slice(from, to);
    if (part.words.text !== expected.text || part.words.left !== expected.left ||
        JSON.stringify(part.words.runs) !== JSON.stringify(expected.runs) ||
        part.start !== expected.left || part.end !== expected.end() ||
        part.passages.length !== 1 || part.passages[0].from !== 0 || part.passages[0].to !== to - from ||
        part.sentenceParagraph !== true || part.paragraphEnd !== (to === block.words.text.length)) return false;
    from = to;
  }
  return from === block.words.text.length;
}

const sameExcept = (before, after, except) => after &&
  Object.keys(before).filter(key => key !== except).every(key => before[key] === after[key]) &&
  Object.keys(after).every(key => key === except || Object.prototype.hasOwnProperty.call(before, key));

// Lists retain their container, item order and all item metadata, including the
// original mapped words. Only sentence paragraphs inside an item may be added.
function preservesList(before, after) {
  return sameExcept(before, after, 'items') && Array.isArray(after.items) && after.items.length === before.items.length &&
    before.items.every((item, k) => item === after.items[k] ||
      (!item.paragraphs && sameExcept(item, after.items[k], 'paragraphs') &&
       preservesParts(item, after.items[k].paragraphs, true)));
}

// Preview contract: protected paragraph partitions and list-item sentence
// partitions change layout only. All other block kinds stay intact.
function preservesPartitions(before, after) {
  let next = 0;
  for (const block of before) {
    if (after[next] === block) { next++; continue; }
    if (block.kind === 'list') {
      if (!preservesList(block, after[next++])) return false;
      continue;
    }
    if (block.kind !== 'paragraph') return false;
    const parts = [];
    let length = 0;
    do {
      const part = after[next++];
      if (!part?.words?.text.length) return false;
      parts.push(part); length += part.words.text.length;
    } while (length < block.words.text.length);
    if (!preservesParts(block, parts)) return false;
  }
  return next === after.length;
}

export function applyTextDisplayRules(blocks, enabled = []) {
  for (const rule of textDisplayRules) {
    if (!enabled.includes(rule.id)) continue;
    readonly(blocks);
    const result = rule.apply(blocks);
    if (!preservesPartitions(blocks, result)) throw new Error(`Text display rule did not preserve source: ${rule.id}`);
    blocks = result;
  }
  return blocks;
}

// These are screen preferences, separate from Core and writing. A denied
// storage write still leaves the choice usable for this page's life.
export class TextDisplayPreferences {
  constructor(instanceId, reader, storage) {
    this.storage = storage;
    this.keys = new Map(textDisplayRules.map(rule => [rule.id, JSON.stringify(['aim-next', instanceId, reader, 'text-display', rule.id])]));
    this.enabled = [];
    for (const [id, key] of this.keys) {
      try { if (storage?.getItem(key) === 'on') this.enabled.push(id); } catch { /* off by default */ }
    }
  }
  toggle(id) {
    if (!this.keys.has(id)) return;
    this.enabled = this.enabled.includes(id) ? this.enabled.filter(value => value !== id) : [...this.enabled, id];
    try { this.storage?.setItem(this.keys.get(id), this.enabled.includes(id) ? 'on' : 'off'); } catch { /* keep in memory */ }
  }
}

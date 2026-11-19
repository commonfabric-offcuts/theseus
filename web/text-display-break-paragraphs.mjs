import { charAt, isWord } from './characters.mjs';

export const id = 'break-out-paragraphs';
export const name = 'Break out paragraphs';
export const description = 'Break out sentences and inline enumerated items, keeping Markdown list items together.';

// These offsets are in mapped Markdown, not drawn text. Use the reading's
// actual spans both to protect a marker and to see a word inside a following
// emphasis, code span or named link.
function wordAt(block, at) {
  for (let span = block.inlineSpans[at]; span?.inner; span = block.inlineSpans[at]) at = span.inner[0];
  return isWord(charAt(block.words.text, at));
}

function paragraphPassages(block) {
  const text = block.words.text, enumerators = [], firstWord = text.search(/\S/u);
  const pattern = /(^|[\p{Zs}\t\n\f\r])((?:\p{N}+|\p{L})[.)]|\((?:\p{N}+|\p{L})\))([\p{Zs}\t\n\f\r]+)/gu;
  let protectedAt = 0;
  for (const match of text.matchAll(pattern)) {
    const from = match.index + match[1].length, to = match.index + match[0].length;
    while (protectedAt < block.protectedSpans.length && block.protectedSpans[protectedAt].end <= from) protectedAt++;
    const span = block.protectedSpans[protectedAt];
    if ((span && span.start < to) || !wordAt(block, to)) continue;
    enumerators.push({ from, to });
  }
  const boundaries = new Set([0, text.length]);
  // Segmenter may put a boundary after `i.` or `1.`. Keep the marker and
  // the following whitespace with the word, rather than drawing a bare number.
  let marker = 0;
  for (const { from } of block.passages) {
    while (marker < enumerators.length && enumerators[marker].to < from) marker++;
    const enumerator = enumerators[marker];
    if (!enumerator || from <= enumerator.from || from > enumerator.to) boundaries.add(from);
  }
  for (const { from } of enumerators) if (from > firstWord) boundaries.add(from);
  const ordered = [...boundaries].sort((a, b) => a - b);
  return ordered.slice(1).map((to, k) => ({ from: ordered[k], to }));
}

function partition(block, passages) {
  return passages.map(({ from, to }, index) => {
    const words = block.words.slice(from, to);
    return { kind: 'paragraph', words, start: words.left, end: words.end(),
      passages: [{ from: 0, to: words.text.length }], sentenceParagraph: true,
      paragraphEnd: index === passages.length - 1 };
  });
}

// The reading owns sentences and protected spans. Keep all mapped words, including
// the whitespace between sentences; layout adds room without inserting text.
export function apply(blocks) {
  return blocks.flatMap(block => {
    if (block.kind === 'list') {
      const items = block.items.map(item => item.paragraphs || item.passages.length < 2 ? item
        : { ...item, paragraphs: partition(item, item.passages) });
      return [items.every((item, k) => item === block.items[k]) ? block : { ...block, items }];
    }
    if (block.kind !== 'paragraph' || block.sentenceParagraph) return [block];
    const passages = paragraphPassages(block);
    return passages.length < 2 && block.passages.length < 2 ? [block] : partition(block, passages);
  });
}

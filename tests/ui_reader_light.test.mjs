import test from 'node:test';
import assert from 'node:assert/strict';
import { Reader } from '../web/reader.mjs';

// A source drawn as the reader draws it: one span per passage, each holding
// one text node, and a browser selection the test places by hand.
function fixture(passages) {
  const body = { children: [] };
  body.contains = node => { for (let at = node; at; at = at.parentElement) if (at === body) return true; return false; };
  let start = 0;
  for (const text of passages) {
    const span = { dataset: { start: String(start), end: String(start + text.length) }, textContent: text, parentElement: body, lit: false,
      classList: { toggle(name, on) { assert.equal(name, 'hover-quote'); span.lit = on; } } };
    span.closest = () => span;
    span.text = { parentElement: span };
    body.children.push(span);
    start += text.length;
  }
  const source = passages.join('');
  const selection = { ranges: [],
    get rangeCount() { return this.ranges.length; }, get isCollapsed() { return !this.ranges.length; }, getRangeAt(n) { return this.ranges[n]; },
    toString() { const [range] = this.ranges; return source.slice(Number(range.startContainer.parentElement.dataset.start) + range.startOffset, Number(range.endContainer.parentElement.dataset.start) + range.endOffset); },
    removeAllRanges() { this.ranges = []; } };
  const previous = globalThis.window;
  globalThis.window = { getSelection: () => selection };
  const reader = Object.assign(Object.create(Reader.prototype), { sourceBody: body, source: { body: source }, hover: null });
  const lit = () => body.children.filter(span => span.lit).map(span => span.textContent).join('');
  return { reader, spans: body.children, selection, lit, restore: () => { globalThis.window = previous; } };
}

test('a Shift-click after a drag lights from the dragged passage, and what lights is what quotes', t => {
  const f = fixture(['Alpha one. ', 'Beta two. ', 'Gamma three. ', 'Delta four.']);
  t.after(f.restore);
  // A drag from inside the first passage into the second: pointerdown lit the
  // first, and the browser selected the dragged text.
  f.reader.light(f.spans[0], false);
  f.selection.ranges = [{ startContainer: f.spans[0].text, startOffset: 6, endContainer: f.spans[1].text, endOffset: 4 }];
  assert.equal(f.reader.selectedPassage(), 'one. Beta');
  f.reader.light(f.spans[2], true);
  assert.equal(f.lit(), 'Alpha one. Beta two. Gamma three. ');
  assert.equal(f.reader.selectedPassage(), f.lit(), 'Return quotes the passages that light');
  assert.equal(f.selection.rangeCount, 0, 'the dragged selection gives way to the light');
});

test('a drag made backwards is extended from both of its ends, and a light that is not extended leaves the selection alone', t => {
  const f = fixture(['Alpha one. ', 'Beta two. ', 'Gamma three. ', 'Delta four.']);
  t.after(f.restore);
  // Dragged from the third passage back into the second: the light started on the third.
  f.reader.light(f.spans[2], false);
  f.selection.ranges = [{ startContainer: f.spans[1].text, startOffset: 5, endContainer: f.spans[2].text, endOffset: 3 }];
  f.reader.light(f.spans[3], true);
  assert.equal(f.reader.selectedPassage(), 'Beta two. Gamma three. Delta four.');
  assert.equal(f.lit(), f.reader.selectedPassage());

  // Dragged from the second passage into the fourth, then extended back to
  // the first: the light keeps all of the dragged fourth passage.
  f.reader.light(f.spans[1], false);
  f.selection.ranges = [{ startContainer: f.spans[1].text, startOffset: 2, endContainer: f.spans[3].text, endOffset: 2 }];
  f.reader.light(f.spans[0], true);
  assert.equal(f.reader.selectedPassage(), 'Alpha one. Beta two. Gamma three. Delta four.');
  assert.equal(f.lit(), f.reader.selectedPassage());

  f.selection.ranges = [{ startContainer: f.spans[0].text, startOffset: 0, endContainer: f.spans[0].text, endOffset: 5 }];
  f.reader.light(f.spans[3], false);
  assert.equal(f.selection.rangeCount, 1, 'a plain click or move keeps the browser\'s selection');
  assert.equal(f.reader.selectedPassage(), 'Alpha');
});

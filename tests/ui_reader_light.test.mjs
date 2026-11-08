import test from 'node:test';
import assert from 'node:assert/strict';
import { Reader } from '../web/reader.mjs';

// A source drawn as the reader draws it: one span per passage, holding its
// text nodes and, for a web address, an anchor with its own text node; and a
// browser selection the test places by hand. A passage is a string, or a list
// of strings and { link } pieces.
function fixture(passages) {
  const body = { children: [] };
  body.contains = node => { for (let at = node; at; at = at.parentElement) if (at === body) return true; return false; };
  let start = 0;
  // A string's own .link is a method, so a piece's words are read by its type.
  const words = piece => typeof piece === 'string' ? piece : piece.link;
  for (const passage of passages) {
    const pieces = typeof passage === 'string' ? [passage] : passage;
    const text = pieces.map(words).join('');
    const span = { nodeType: 1, dataset: { start: String(start), end: String(start + text.length) }, textContent: text, parentElement: body, lit: false,
      classList: { toggle(name, on) { assert.equal(name, 'hover-quote'); span.lit = on; } }, texts: [] };
    span.closest = () => span;
    // No piece here is a link showing a topic's name (data-words); links_native.mjs covers those.
    span.querySelectorAll = selector => { assert.equal(selector, 'a[data-words]'); return []; };
    for (const piece of pieces) {
      const linked = typeof piece !== 'string';
      const node = { nodeType: 3, data: words(piece), parentElement: linked ? { nodeType: 1, parentElement: span } : span };
      if (linked) span.link = node;
      span.texts.push(node);
    }
    span.text = span.texts[0];
    body.children.push(span);
    start += text.length;
  }
  const source = body.children.map(span => span.textContent).join('');
  const passageOf = node => { let at = node; while (at.parentElement !== body) at = at.parentElement; return at; };
  // Where a boundary falls, counted as the page counts it: the passage's start, then its text before the boundary.
  const at = (container, offset) => {
    const span = passageOf(container);
    if (container === span) return Number(span.dataset.start) + span.texts.slice(0, offset).reduce((n, node) => n + node.data.length, 0);
    const before = span.texts.slice(0, span.texts.indexOf(container)).reduce((n, node) => n + node.data.length, 0);
    return Number(span.dataset.start) + before + offset;
  };
  const selection = { ranges: [],
    get rangeCount() { return this.ranges.length; }, get isCollapsed() { return !this.ranges.length; }, getRangeAt(n) { return this.ranges[n]; },
    toString() { const [range] = this.ranges; return source.slice(at(range.startContainer, range.startOffset), at(range.endContainer, range.endOffset)); },
    removeAllRanges() { this.ranges = []; } };
  const previous = { window: globalThis.window, document: globalThis.document, Node: globalThis.Node };
  globalThis.window = { getSelection: () => selection };
  globalThis.Node = { ELEMENT_NODE: 1 };
  // A range from a passage's start to a boundary in it, as the reader measures one.
  globalThis.document = { createRange: () => ({ setStart(node, offset) { assert.equal(offset, 0); this.from = node; },
    setEnd(node, offset) { this.to = [node, offset]; }, toString() { return source.slice(Number(this.from.dataset.start), at(...this.to)); } }) };
  const reader = Object.assign(Object.create(Reader.prototype), { sourceBody: body, source: { body: source }, hover: null });
  const lit = () => body.children.filter(span => span.lit).map(span => span.textContent).join('');
  return { reader, spans: body.children, selection, lit, restore: () => Object.assign(globalThis, previous) };
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

test('a drag that starts or ends inside a link is extended from the passages it touches', t => {
  const f = fixture(['Alpha one. ', ['See ', { link: 'https://a.example/x' }, ' now. '], 'Gamma three. ', 'Delta four.']);
  t.after(f.restore);
  // Dragged from inside the link into the third passage, then extended to the fourth.
  f.reader.light(f.spans[1], false);
  f.selection.ranges = [{ startContainer: f.spans[1].link, startOffset: 8, endContainer: f.spans[2].text, endOffset: 5 }];
  f.reader.light(f.spans[3], true);
  assert.equal(f.lit(), 'See https://a.example/x now. Gamma three. Delta four.', 'the light grows from the dragged passages');
  assert.equal(f.reader.selectedPassage(), f.lit());
  assert.equal(f.selection.rangeCount, 0, 'the dragged selection gives way to the light');
  // Dragged backwards from the first passage to inside the link, then extended to the fourth.
  f.reader.light(f.spans[0], false);
  f.selection.ranges = [{ startContainer: f.spans[0].text, startOffset: 6, endContainer: f.spans[1].link, endOffset: 3 }];
  f.reader.light(f.spans[3], true);
  assert.equal(f.reader.selectedPassage(), 'Alpha one. See https://a.example/x now. Gamma three. Delta four.');
  // A boundary on the passage itself, after its last text node.
  f.reader.light(f.spans[2], false);
  f.selection.ranges = [{ startContainer: f.spans[1], startOffset: 3, endContainer: f.spans[2].text, endOffset: 2 }];
  f.reader.light(f.spans[3], true);
  assert.equal(f.reader.selectedPassage(), 'Gamma three. Delta four.', 'a boundary at a passage\'s end starts in the passage after it');
});

// The Reader's source as drawSource draws it, on a small document: each
// passage's start and end, its words, and the links among them.
function drawn(t, body) {
  const previous = globalThis.document;
  class Element {
    constructor(tag) { Object.assign(this, { tag, children: [], dataset: {}, textContent: '' }); }
    append(...nodes) { this.children.push(...nodes); }
    replaceChildren(...nodes) { this.children = nodes; }
    addEventListener() {}
    get text() { return this.children.length ? this.children.map(child => child.text).join('') : this.textContent; }
  }
  globalThis.document = { createElement: tag => new Element(tag), createTextNode: data => ({ text: data }) };
  t.after(() => { globalThis.document = previous; });
  const sourceBody = new Element('div');
  Object.assign(Object.create(Reader.prototype), { sourceBody }).drawSource(body);
  return sourceBody.children.map(span => ({ start: Number(span.dataset.start), end: Number(span.dataset.end), text: span.text,
    links: span.children.filter(child => child.tag === 'a').map(a => a.textContent) }));
}

test('the Reader never cuts a link between passages: the passages one spans are one', t => {
  // The sentence rules end a passage after the "?" and the "!" inside these addresses.
  const body = 'Look at https://example.com/search?Q=1 now. Then https://ex.com/#!/Path ok. Last one.';
  const parts = drawn(t, body);
  assert.deepEqual(parts.map(part => part.text), ['Look at https://example.com/search?Q=1 now. ', 'Then https://ex.com/#!/Path ok. ', 'Last one.']);
  assert.deepEqual(parts.map(part => part.links), [['https://example.com/search?Q=1'], ['https://ex.com/#!/Path'], []]);
  for (const part of parts) assert.equal(body.slice(part.start, part.end), part.text, 'each passage knows where its words lie in the source');
  assert.equal(parts.at(-1).end, body.length);
  // Without a link, the passages are the sentences, as before.
  assert.deepEqual(drawn(t, 'One? Two! Three.').map(part => part.text), ['One? ', 'Two! ', 'Three.']);
});

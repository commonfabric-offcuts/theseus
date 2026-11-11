import test from 'node:test';
import assert from 'node:assert/strict';
import { Reader } from '../web/reader.mjs';

// A source drawn as the reader draws it (drawPassages, on a small document
// whose nodes know their parents), and a browser selection the test places by
// hand. A passage is a string, or a list of strings and { link } pieces.
class Node0 {
  get parentElement() { return this.parentNode?.nodeType === 1 ? this.parentNode : null; }
}
class Text extends Node0 {
  constructor(data) { super(); Object.assign(this, { nodeType: 3, data: String(data), parentNode: null }); }
  get textContent() { return this.data; }
}
class Element extends Node0 {
  constructor(tag) {
    super();
    Object.assign(this, { nodeType: 1, tagName: tag.toUpperCase(), childNodes: [], parentNode: null, className: '', dataset: {}, href: '', target: '', rel: '', title: '' });
    this.style = { setProperty() {} };
  }
  get children() { return this.childNodes.filter(node => node.nodeType === 1); }
  get classList() {
    const names = () => this.className.split(' ').filter(Boolean);
    return { add: (...more) => { this.className = [...new Set([...names(), ...more])].join(' '); },
      toggle: (name, on) => { this.className = (on ? [...new Set([...names(), name])] : names().filter(n => n !== name)).join(' '); },
      contains: name => names().includes(name) };
  }
  append(...nodes) { for (let node of nodes) { if (typeof node === 'string') node = new Text(node); node.parentNode = this; this.childNodes.push(node); } }
  replaceChildren(...nodes) { this.childNodes = []; this.append(...nodes); }
  addEventListener() {}
  get textContent() { return this.childNodes.map(node => node.textContent).join(''); }
  set textContent(value) { this.childNodes = []; if (String(value)) this.append(new Text(value)); }
  closest(selector) { assert.equal(selector, '[data-start]'); for (let at = this; at; at = at.parentElement) if (at.dataset?.start !== undefined) return at; return null; }
  contains(node) { for (let at = node; at; at = at.parentNode) if (at === this) return true; return false; }
}
function fixture(passages) {
  const words = piece => typeof piece === 'string' ? piece : piece.link;
  const source = passages.map(passage => (typeof passage === 'string' ? [passage] : passage).map(words).join('')).join('');
  const previous = { window: globalThis.window, document: globalThis.document, Node: globalThis.Node };
  const selection = { ranges: [],
    get rangeCount() { return this.ranges.length; }, get isCollapsed() { return !this.ranges.length; }, getRangeAt(n) { return this.ranges[n]; },
    removeAllRanges() { this.ranges = []; } };
  globalThis.window = { getSelection: () => selection };
  globalThis.Node = { ELEMENT_NODE: 1 };
  globalThis.document = { createElement: tag => new Element(tag), createTextNode: data => new Text(data) };
  const body = new Element('div');
  // A laptop's Reader: no end line under the passages (placeEnd).
  const reader = Object.assign(Object.create(Reader.prototype), { sourceBody: body, source: { body: source }, hover: null, narrow: { matches: false } });
  reader.drawSource(source);
  assert.deepEqual(body.children.map(span => span.textContent), passages.map(passage => (typeof passage === 'string' ? [passage] : passage).map(words).join('')), 'drawn as the passages the test names');
  // Each passage's first text node, and the text of the link in it.
  const texts = node => node.nodeType === 3 ? [node] : node.childNodes.flatMap(texts);
  for (const span of body.children) { span.text = texts(span)[0]; span.link = texts(span).find(node => node.parentNode.tagName === 'A'); }
  const lit = () => body.children.filter(span => span.classList.contains('hover-quote')).map(span => span.textContent).join('');
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
  // A laptop's width: the message ends with no "↑ Previous · ↓ Next" line.
  Object.assign(Object.create(Reader.prototype), { sourceBody, narrow: { matches: false } }).drawSource(body);
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

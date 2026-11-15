// A Notebook card's image line outside the card that writes it (item 321, docs/decks.md "Images in a card"): where
// a page is read (the Reader's passages, a page opened in place) the line is the image, read through the page, or
// the image's name alone when the page does not carry it; where only words show (what changed in a page) it is the
// image's name after an image glyph. Never the line's markup, and a line that holds the same characters as words
// (in a code span, inside a fence or a quote, or an image from the web) stays words.
import test from 'node:test';
import assert from 'node:assert/strict';
import { drawPassages, linkedFenceNodes } from '../web/message-format.mjs';
import { paintChanges } from '../web/page-changes.mjs';
import { PageHere } from '../web/page-here.mjs';

class Text {
  constructor(data) { Object.assign(this, { nodeType: 3, nodeName: '#text', data: String(data), parentNode: null }); }
  get textContent() { return this.data; }
}
class Element {
  constructor(tag) {
    Object.assign(this, { nodeType: 1, tagName: tag.toUpperCase(), childNodes: [], parentNode: null, className: '', dataset: {}, attributes: {}, hidden: false, isConnected: true, style: { setProperty() {} } });
  }
  get classList() {
    const names = () => this.className.split(' ').filter(Boolean);
    return { add: (...more) => { this.className = [...new Set([...names(), ...more])].join(' '); }, remove: name => { this.className = names().filter(n => n !== name).join(' '); },
      contains: name => names().includes(name), toggle: (name, on) => (on ?? !names().includes(name)) ? this.classList.add(name) : this.classList.remove(name) };
  }
  get children() { return this.childNodes.filter(child => child.nodeType === 1); }
  get firstElementChild() { return this.children[0] ?? null; }
  append(...nodes) { for (let node of nodes) { if (typeof node === 'string') node = new Text(node); node.parentNode = this; this.childNodes.push(node); } }
  prepend(node) { node.parentNode = this; this.childNodes.unshift(node); }
  before(node) { const list = this.parentNode.childNodes; node.parentNode = this.parentNode; list.splice(list.indexOf(this), 0, node); }
  remove() { if (this.parentNode) this.parentNode.childNodes.splice(this.parentNode.childNodes.indexOf(this), 1); this.parentNode = null; }
  replaceChildren(...nodes) { this.childNodes = []; this.append(...nodes); }
  insertBefore(node, before) { node.parentNode = this; this.childNodes.splice(this.childNodes.indexOf(before), 0, node); }
  addEventListener() {}
  setAttribute(name, value) { this.attributes[name] = String(value); }
  focus() { doc.activeElement = this; }
  // Only what the image's thumbnail asks: the image already in a figure.
  querySelector(selector) { return selector === ':scope > img.image-thumb' ? this.children.find(child => child.tagName === 'IMG' && child.classList.contains('image-thumb')) ?? null : null; }
  get textContent() { return this.childNodes.map(child => child.textContent).join(''); }
  set textContent(value) { this.childNodes = []; if (String(value)) this.append(new Text(value)); }
  get ownerDocument() { return doc; }
}
const doc = { createElement: tag => new Element(tag), createElementNS: (_, tag) => new Element(tag), createTextNode: data => new Text(data), activeElement: null };
const walk = function* (node) { yield node; for (const child of node.childNodes ?? []) yield* walk(child); };
const all = (host, test) => [...walk(host)].filter(node => node.nodeType === 1 && test(node));
const named = (host, name) => all(host, node => node.classList.contains(name));

const BODY = '## Plan\n\nShip it.\n![chart.png](attachment:m-1)\n\n## Gone\n\n![gone.png](attachment:m-gone)\n\n## Words\n\n`![code.png](attachment:m-1)`\n![web.png](https://example.invalid/web.png)\n> ![quoted.png](attachment:m-1)\n```\n![fenced.png](attachment:m-1)\n```\n';
// A Notebook page's image lines, as the Reader names them: a line that holds only ![name](attachment:ID).
const LINE = /^[ \t]*!\[([^\]\n]*)\]\(attachment:([A-Za-z0-9._-]{1,200})\)[ \t]*$/;
const images = () => {
  const drawn = [];
  return { drawn, of: line => { const found = LINE.exec(line); return found && { name: found[1], id: found[2] }; },
    node: image => { drawn.push(image); const figure = doc.createElement('figure'); figure.className = 'drawn-image'; figure.append(image.name); return figure; } };
};

test('the Reader draws a Notebook page\'s image line as a passage of its own holding its image; every other line stays words, and the passages still cover the page', () => {
  const host = doc.createElement('div'), shown = images();
  drawPassages(host, BODY, doc, { copyFences: true, images: shown });
  assert.deepEqual(shown.drawn, [{ name: 'chart.png', id: 'm-1' }, { name: 'gone.png', id: 'm-gone' }], 'each image line, in order, and no other');
  const passages = host.children, figures = passages.filter(passage => passage.classList.contains('md-image'));
  assert.deepEqual(figures.map(passage => [passage.textContent, BODY.slice(Number(passage.dataset.start), Number(passage.dataset.end)).trim()]),
    [['chart.png', '![chart.png](attachment:m-1)'], ['gone.png', '![gone.png](attachment:m-gone)']], 'each a passage of its own, over its line');
  assert.equal(passages.find(passage => passage.textContent.startsWith('Ship it.')).textContent.trim(), 'Ship it.', 'the words before it are a passage without it');
  assert.equal(passages[0].dataset.start, '0'); assert.equal(passages.at(-1).dataset.end, String(BODY.length));
  for (let k = 1; k < passages.length; k++) assert.equal(passages[k].dataset.start, passages[k - 1].dataset.end, 'the passages cover the page');
  const text = host.textContent;
  assert.ok(!text.includes('![chart.png](') && !text.includes('![gone.png]('), text);
  // An image from the web is words, its address a link, as in any message.
  for (const words of ['![code.png](attachment:m-1)', '!web.png', '![quoted.png](attachment:m-1)', '![fenced.png](attachment:m-1)'])
    assert.ok(text.includes(words), `${words} stays words`);
  // Without images, as for a message, the line is words.
  const plain = doc.createElement('div');
  drawPassages(plain, BODY, doc, { copyFences: true });
  assert.ok(plain.textContent.includes('![chart.png](attachment:m-1)') && !named(plain, 'md-image').length);
});

test('a page opened in place draws its image lines as their images, the line break after each with it, and keeps every other line verbatim', () => {
  const shown = images(), host = doc.createElement('div'), plain = doc.createElement('div');
  host.append(...linkedFenceNodes(BODY, doc, shown));
  plain.append(...linkedFenceNodes(BODY, doc));
  assert.deepEqual(shown.drawn.map(image => image.id), ['m-1', 'm-gone']);
  assert.ok(plain.textContent.startsWith('## Plan\n\nShip it.\n![chart.png](attachment:m-1)\n\n## Gone\n\n![gone.png](attachment:m-gone)\n'), 'without images, the page is verbatim');
  assert.equal(host.textContent, plain.textContent.replace('![chart.png](attachment:m-1)\n', 'chart.png').replace('![gone.png](attachment:m-gone)\n', 'gone.png'));
  assert.equal(named(host, 'md-image').length, 2);
});

test('a page opened in place on its outcome\'s page shows its image read through the page, and an image it does not carry by name alone, reading nothing for it', async () => {
  const host = doc.createElement('section'), asked = [];
  const attachments = [{ id: 'm-1', name: 'chart.png', inline: true }];
  const read = ref => Promise.resolve({ source_ref: ref, title: 'Plan', body: BODY, attachments });
  const here = new PageHere({ host, read, doc, reads: { opened: async () => null }, media: async (attachment, ref) => { asked.push([attachment.id, ref.kind, ref.id, ref.revision]); return new Blob(['png'], { type: 'image/png' }); } });
  await here.open({ kind: 'memory', id: 'p1', revision: 3 }, doc.createElement('button'));
  const body = named(host, 'page-here-body')[0];
  assert.ok(!body.textContent.includes('![chart.png](') && !body.textContent.includes('![gone.png]('), body.textContent);
  assert.deepEqual(named(body, 'page-image').map(figure => [named(figure, 'page-image-name')[0].textContent, figure.dataset.state ?? null]),
    [['chart.png', null], ['gone.png · not on this page', 'missing']]);
  for (let turn = 0; turn < 5 && !asked.length; turn++) await new Promise(done => setImmediate(done));
  for (let turn = 0; turn < 5; turn++) await new Promise(done => setImmediate(done));
  assert.deepEqual(asked, [['m-1', 'memory', 'p1', 3]], 'only the image the page carries is read, through the page at its revision');
  const [img] = all(body, node => node.tagName === 'IMG');
  assert.ok(img && img.src && !img.hidden, 'its picture shows');
  assert.ok(body.textContent.includes('`![code.png](attachment:m-1)`\n![web.png](https://example.invalid/web.png)'), 'the lines that are words stay words');
});

test('what changed in a page names an image a card gained or lost after its glyph, never by its markup', () => {
  class Node {
    constructor(tag, text = '') { this.tagName = tag; this.children = []; this.text = text; this.className = ''; }
    append(...nodes) { this.children.push(...nodes); }
    replaceChildren(...nodes) { this.children = [...nodes]; }
    get textContent() { return this.tagName === '#text' ? this.text : this.children.map(child => child.textContent).join('') || this.text; }
    set textContent(value) { this.text = value; this.children = []; }
  }
  const small = { createElement: tag => new Node(tag), createTextNode: text => new Node('#text', text) }, host = new Node('div');
  paintChanges(host, '## Plan\n\nShip it.\n', '## Plan\n\nShip it.\n![chart.png](attachment:m-1)\n`![code.png](attachment:m-1)`\n', small);
  let text = host.textContent;
  assert.ok(text.includes('🖼 chart.png') && !text.includes('![chart.png]('), text);
  paintChanges(host, '## Plan\n\nShip it.\n![old.png](attachment:m-0)\n', '## Plan\n\nShip it.\n', small);
  assert.ok(host.textContent.includes('🖼 old.png') && !host.textContent.includes('](attachment:m-0)'), host.textContent);
  paintChanges(host, '## Plan\n\nShip it.\n', '## Plan\n\nShip it.\n![chart.png](attachment:m-1)\n`![code.png](attachment:m-1)`\n', small);
  text = host.textContent;
  assert.ok(text.includes('`![code.png](attachment:m-1)`'), 'a line in a code span stays words');
});

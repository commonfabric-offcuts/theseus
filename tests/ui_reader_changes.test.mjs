// What changed in a Notebook page belongs to that page alone: the Reader
// drops it when it shows another, painted by the real Reader.show and
// Reader.showChanges over stand-in nodes.
import test from 'node:test';
import assert from 'node:assert/strict';
import { Reader } from '../web/reader.mjs';

class Element {
  constructor(tag, text = '') { Object.assign(this, { tagName: tag, text, children: [], hidden: false, disabled: false, open: false, dataset: {}, className: '', value: '', attributes: new Map() }); }
  setAttribute(name, value) { this.attributes.set(name, String(value)); }
  getAttribute(name) { return this.attributes.get(name) ?? null; }
  hasAttribute(name) { return this.attributes.has(name); }
  removeAttribute(name) { this.attributes.delete(name); }
  toggleAttribute(name, force) {
    const present = force === undefined ? !this.hasAttribute(name) : Boolean(force);
    if (present) { if (!this.hasAttribute(name)) this.setAttribute(name, ''); }
    else this.removeAttribute(name);
    return present;
  }
  append(...nodes) { this.children.push(...nodes); }
  replaceChildren(...nodes) { this.children = [...nodes]; }
  get textContent() { return this.tagName === '#text' ? this.text : this.children.map(child => child.textContent).join('') || this.text; }
  set textContent(value) { this.text = value; this.children = []; }
}
globalThis.document ??= { createElement: tag => new Element(tag), createTextNode: text => new Element('#text', text) };

function reader() {
  const nodes = new Map();
  const $ = id => { if (!nodes.has(id)) nodes.set(id, new Element('div')); return nodes.get(id); };
  const shown = [];
  const r = Object.assign(Object.create(Reader.prototype), {
    // A Reader always has its callbacks; these offer no other destination.
    $, mode: 'reply', positions: new Map(), layoutInstance: 'i1', viewToken: 0, callbacks: {},
    dialog: { open: true }, sourceBody: { scrollTop: 0, focus() {} },
    notice() {}, disarm() {}, paintOrigin() {}, drawAttachments() {}, drawEditor() {}, paintPending() {}, applyLayout() {},
    drawSource: body => shown.push(body),
  });
  return { r, $, shown };
}
const sessions = { reply: { context: { instanceId: 'i1', topicId: 't1' } } };
const page = (id, revision, body) => ({ source_ref: { kind: 'memory', id, revision }, title: id, body, topic_id: 't1', attachments: [] });
const coverOpen = ($, expected) => {
  assert.equal($('reader-cover').hasAttribute('open'), expected, 'the cover open attribute follows its state');
  assert.equal($('reader-cover-line').getAttribute('aria-expanded'), String(expected), 'the disclosure announces the same state');
};

test('a page shown after one with changes shows none of them', () => {
  const { r, $, shown } = reader();
  r.show(page('p1', 3, 'Ship on Monday.'), sessions);
  coverOpen($, false);
  r.setCoverOpen(true);
  coverOpen($, true);
  r.showChanges(1, 'Ship on Friday.', 'Ship on Monday.');
  assert.equal($('source-changes').hidden, false, 'the first page shows what changed');
  assert.match($('source-changes-title').textContent, /revision 1/);
  r.show(page('p2', 1, 'A page never read.'), sessions);
  coverOpen($, false);
  assert.deepEqual(shown, ['Ship on Monday.', 'A page never read.']);
  assert.equal($('source-changes').hidden, true, 'the next page carries none of the first page’s changes');
});

test('a page\'s changes show open, even after the person closed the panel on the page before', () => {
  const { r, $ } = reader();
  r.show(page('p1', 3, 'Ship on Monday.'), sessions);
  r.showChanges(1, 'Ship on Friday.', 'Ship on Monday.');
  assert.equal($('source-changes').open, true, 'shown open');
  $('source-changes').open = false;
  r.setCoverOpen(true);
  coverOpen($, true);
  r.show(page('p2', 4, 'Ship on Tuesday.'), sessions);
  coverOpen($, false);
  r.showChanges(2, 'Ship on Monday.', 'Ship on Tuesday.');
  assert.equal($('source-changes').open, true, 'the next page\'s changes are open again');
});

// The Reader tells its composer whose writing it shows (compose-bar.mjs
// writes), once per show, by the message the reply answers, so a name typed
// in To stays with that reply: the same message shown again is the same
// writing, another message is another.
test('the Reader tells its composer whose writing each show is', () => {
  const { r, $ } = reader();
  const told = [];
  r.compose = { writes: key => told.push(key), fold() {} };
  r.show(page('p1', 3, 'Ship on Monday.'), sessions);
  r.setCoverOpen(true);
  r.show(page('p1', 3, 'Ship on Monday.'), sessions);
  coverOpen($, true);
  r.show(page('p2', 1, 'A page never read.'), sessions);
  coverOpen($, false);
  assert.equal(told.length, 3, 'told on every show');
  assert.equal(told[1], told[0], 'the same page again is the same writing');
  assert.notEqual(told[2], told[0], 'another page is another writing');
});

// What changed in a Notebook page belongs to that page alone: the Reader
// drops it when it shows another, painted by the real Reader.show and
// Reader.showChanges over stand-in nodes.
import test from 'node:test';
import assert from 'node:assert/strict';
import { Reader } from '../web/reader.mjs';

class Element {
  constructor(tag, text = '') { Object.assign(this, { tagName: tag, text, children: [], hidden: false, disabled: false, open: false, dataset: {}, className: '', value: '' }); }
  append(...nodes) { this.children.push(...nodes); }
  replaceChildren(...nodes) { this.children = [...nodes]; }
  get textContent() { return this.tagName === '#text' ? this.text : this.children.map(child => child.textContent).join('') || this.text; }
  set textContent(value) { this.text = value; this.children = []; }
}
globalThis.document ??= { createElement: tag => new Element(tag), createTextNode: text => new Element('#text', text) };
// Reader.show captures the page's position even when its full surface needs
// no scroll restoration. Supply that browser interface in this Node fixture.
globalThis.window = { scrollX: 0, scrollY: 0 };

function reader() {
  const nodes = new Map();
  const $ = id => { if (!nodes.has(id)) nodes.set(id, new Element('div')); return nodes.get(id); };
  const shown = [];
  const r = Object.assign(Object.create(Reader.prototype), {
    // A Reader always has its callbacks; these offer no other destination.
    $, mode: 'reply', positions: new Map(), layoutInstance: 'i1', viewToken: 0, callbacks: {},
    card: null, dialog: { open: true }, sourceBody: { scrollTop: 0, focus() {} },
    notice() {}, disarm() {}, paintOrigin() {}, drawAttachments() {}, drawEditor() {}, paintPending() {}, applyLayout() {},
    drawSource: body => shown.push(body),
  });
  return { r, $, shown };
}
const sessions = { reply: { context: { instanceId: 'i1', topicId: 't1' } } };
const page = (id, revision, body) => ({ source_ref: { kind: 'memory', id, revision }, title: id, body, topic_id: 't1', attachments: [] });

test('a page shown after one with changes shows none of them', () => {
  const { r, $, shown } = reader();
  r.show(page('p1', 3, 'Ship on Monday.'), sessions);
  r.showChanges(1, 'Ship on Friday.', 'Ship on Monday.');
  assert.equal($('source-changes').hidden, false, 'the first page shows what changed');
  assert.match($('source-changes-title').textContent, /revision 1/);
  r.show(page('p2', 1, 'A page never read.'), sessions);
  assert.deepEqual(shown, ['Ship on Monday.', 'A page never read.']);
  assert.equal($('source-changes').hidden, true, 'the next page carries none of the first page’s changes');
});

test('a page\'s changes show open, even after the person closed the panel on the page before', () => {
  const { r, $ } = reader();
  r.show(page('p1', 3, 'Ship on Monday.'), sessions);
  r.showChanges(1, 'Ship on Friday.', 'Ship on Monday.');
  assert.equal($('source-changes').open, true, 'shown open');
  $('source-changes').open = false;
  r.show(page('p2', 4, 'Ship on Tuesday.'), sessions);
  r.showChanges(2, 'Ship on Monday.', 'Ship on Tuesday.');
  assert.equal($('source-changes').open, true, 'the next page\'s changes are open again');
});

// The Reader tells its composer whose writing it shows (compose-bar.mjs
// writes), once per show, by the message the reply answers, so a name typed
// in To stays with that reply: the same message shown again is the same
// writing, another message is another.
test('the Reader tells its composer whose writing each show is', () => {
  const { r } = reader();
  const told = [];
  r.compose = { writes: key => told.push(key), fold() {} };
  r.show(page('p1', 3, 'Ship on Monday.'), sessions);
  r.show(page('p1', 3, 'Ship on Monday.'), sessions);
  r.show(page('p2', 1, 'A page never read.'), sessions);
  assert.equal(told.length, 3, 'told on every show');
  assert.equal(told[1], told[0], 'the same page again is the same writing');
  assert.notEqual(told[2], told[0], 'another page is another writing');
});

test('item 721 the real visibility fallback moves the same writing only when its card hides or disconnects', () => {
  for (const disconnected of [false, true]) {
    const { r } = reader();
    const sessions = r.sessions = { reply: { draft: { body: 'Exact retained writing' } } };
    const field = r.field = { value: 'Exact retained writing', focus() { this.focused = true; } };
    let shown = true, returned = 0;
    const card = r.card = { isConnected: true, removeAttribute() {}, setAttribute(name, value) { this[name] = value; } };
    r.presentation = { replyCard: card };
    r.dialog = { open: true, getClientRects: () => shown ? [{}] : [], close() { this.open = false; }, removeAttribute() {}, showModal() { this.open = true; this.modal = true; } };
    r.home = { parent: { insertBefore(dialog) { assert.equal(dialog, r.dialog); returned++; } }, next: null };
    r.keepReplyVisible();
    assert.equal(returned, 0, 'visible in-card writing stays where it is');
    if (disconnected) card.isConnected = false; else shown = false;
    r.keepReplyVisible();
    assert.equal(returned, 1); assert.equal(r.card, null); assert.equal(r.presentation.replyCard, null);
    assert.equal(r.dialog.modal, true); assert.equal(card.role, 'button');
    assert.equal(r.sessions, sessions); assert.equal(r.field, field); assert.equal(field.value, 'Exact retained writing');
    assert.equal(field.focused, true, 'the fallback keeps typing in that same field');
  }
});

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

function reader() {
  const nodes = new Map();
  const $ = id => { if (!nodes.has(id)) nodes.set(id, new Element('div')); return nodes.get(id); };
  const shown = [];
  const r = Object.assign(Object.create(Reader.prototype), {
    $, mode: 'reply', positions: new Map(), layoutInstance: 'i1', viewToken: 0,
    dialog: { open: true }, sourceBody: { scrollTop: 0, focus() {} },
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

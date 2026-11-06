import test from 'node:test';
import assert from 'node:assert/strict';
import { Reader } from '../web/reader.mjs';
import { Editor } from '../web/editor.mjs';

// The line above a Notebook page in the Reader, painted by the real
// Reader.paintStatus over stand-in nodes.
function reader(editor, shown) {
  const nodes = new Map();
  const $ = id => { if (!nodes.has(id)) nodes.set(id, { id, hidden: false, disabled: false, textContent: '', replaceChildren() {} }); return nodes.get(id); };
  const r = Object.assign(Object.create(Reader.prototype), {
    $, mode: 'reply', sessions: { reply: editor, note: editor }, source: { source_ref: shown }, presentation: {},
    field: { readOnly: false }, callbacks: {}, paintImages() {}, paintOffer() {}, paintAccess() {},
  });
  r.paintStatus();
  return $('source-update');
}
const context = { instanceId: 'i1', actor: 'tony', kind: 'reply', topicId: 't1', sourceRef: { kind: 'memory', id: 'pipeline', revision: 13 } };
const draft = (revision, body) => ({ id: 'd1', revision: 47, generation: 'g1', body, attachments: [], quotes: [], addressees: [],
  source_ref: { kind: 'memory', id: 'pipeline', revision } });

test('a reply with nothing written names no older revision above the page', () => {
  const line = reader(new Editor(context, draft(12, '')), context.sourceRef);
  assert.deepEqual([line.hidden, line.textContent], [true, '']);
});

test('writing started on an older revision says plainly that the page has changed since', () => {
  const line = reader(new Editor(context, draft(12, 'My unsent reply')), context.sourceRef);
  assert.equal(line.hidden, false);
  assert.equal(line.textContent, 'This page has changed since you started writing. Your writing refers to revision 12; you are reading revision 13.');
  const earlier = reader(new Editor(context, draft(12, 'My unsent reply')), { ...context.sourceRef, revision: 11 });
  assert.equal(earlier.textContent, 'You are reading an earlier revision than your writing. Your writing refers to revision 12; you are reading revision 11.');
  const same = reader(new Editor(context, draft(13, 'My unsent reply')), context.sourceRef);
  assert.deepEqual([same.hidden, same.textContent], [true, ''], 'writing about the revision shown needs no line');
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { Editor, editorKey, restoreEditor, keyAction } from '../web/editor.mjs';

const source = { kind: 'memory', id: 'n1', revision: 3 };
const context = { instanceId: 'new1', actor: 'ux-fixture', sourceRef: source, topicId: 't1', kind: 'reply' };
const draft = { id: 'd1', revision: 7, generation: 'gA', body: 'Reply A', attachments: [{ id: 'image-a' }], quotes: [{ source, excerpt: 'selected passage' }], addressees: ['fixture-agent'], caret: { start: 7, end: 7 } };
const fresh = () => new Editor(context, draft);
const ids = { prepareOperationId: 'prepare-A', sendOperationId: 'send-A', submissionId: 's1' };
const prepared = () => ({ instance_id: 'new1', operation_id: 'prepare-A', kind: 'submission.prepare', status: 'committed', recorded: true, result: { submission_id: 's1', send_operation_id: 'send-A', next_draft: { id: 'd1', revision: 8, generation: 'gB' } } });
const sent = () => ({ instance_id: 'new1', operation_id: 'send-A', kind: 'message.send', status: 'committed', recorded: true, result: { submission_id: 's1', message_id: 'm2' } });

test('a new Notebook revision finds the same editor without changing quote provenance', () => {
  assert.equal(editorKey(context), editorKey({ ...context, sourceRef: { ...source, revision: 4 } }));
  assert.notEqual(editorKey(context), editorKey({ ...context, topicId: 't2' }));
  assert.notEqual(editorKey(context), editorKey({ ...context, actor: 'other' }));
  assert.notEqual(editorKey(context), editorKey({ ...context, instanceId: 'old' }));
  assert.notEqual(editorKey(context), editorKey({ ...context, kind: 'note' }));
  const editor = fresh();
  assert.equal(editor.snapshot().sourceRef.revision, 3);
});

test('two topic-opening editors cannot share their writing', () => {
  const opening = { ...context, sourceRef: { kind: 'opening', id: 'opening-1' }, topicId: null };
  assert.notEqual(editorKey(opening), editorKey({ ...opening, sourceRef: { kind: 'opening', id: 'opening-2' } }));
  assert.equal(editorKey({ ...context, kind: 'note' }), editorKey({ ...context, kind: 'note', topicId: 'elsewhere' }));
});

test('slow preparation retains exact A while new keystrokes belong to independent B', () => {
  const editor = fresh();
  editor.beginPrepare(ids);
  editor.edit({ body: 'Next reply B', attachments: [], caret: { start: 12, end: 12 } });
  assert.equal(editor.submissions[0].snapshot.body, 'Reply A');
  assert.deepEqual(editor.submissions[0].snapshot.attachments, [{ id: 'image-a' }]);
  assert.equal(editor.canNavigateAfterSend, false);
  assert.equal(editor.acceptPreparation(prepared()), true);
  assert.equal(editor.canNavigateAfterSend, true);
  assert.equal(editor.draft.body, 'Next reply B');
  assert.equal(editor.draft.generation, 'gB');
  assert.equal(editor.draft.revision, 8);
  assert.equal(editor.acceptSend(sent()), true);
  assert.equal(editor.draft.body, 'Next reply B');
  assert.deepEqual(editor.draft.attachments, []);
});

test('double activation keeps one submission and its original operation', () => {
  const editor = fresh();
  editor.beginPrepare(ids);
  editor.beginPrepare({ prepareOperationId: 'new-prepare', sendOperationId: 'new-send', submissionId: 'new-submission' });
  assert.equal(editor.submissions.length, 1);
  assert.equal(editor.submissions[0].sendOperationId, 'send-A');
});

test('transport refusal and a different recorded operation cannot settle a pending send', () => {
  const editor = fresh();
  editor.beginPrepare(ids);
  editor.acceptPreparation(prepared());
  for (const receipt of [
    { ...sent(), recorded: false, status: 'rejected', error: { code: 'HTTP_TOO_LARGE' } },
    { ...sent(), recorded: false, status: 'retryable', error: { code: 'DATABASE_BUSY' } },
    { ...sent(), operation_id: 'another-send' },
    { ...sent(), instance_id: 'old-instance' },
    { ...sent(), kind: 'draft.save' },
  ]) assert.equal(editor.acceptSend(receipt), false);
  assert.equal(editor.submissions[0].status, 'prepared');
  assert.equal(editor.acceptSend(sent()), true);
  assert.equal(editor.submissions[0].status, 'confirmed');
});

test('definitive refusal preserves frozen A and the newer B without silent resend', () => {
  const editor = fresh();
  editor.beginPrepare(ids);
  editor.acceptPreparation(prepared());
  editor.edit({ body: 'B must survive' });
  editor.acceptSend({ ...sent(), status: 'rejected', result: {}, error: { code: 'INVALID_RECIPIENT', message: 'Choose another recipient.' } });
  assert.equal(editor.submissions[0].status, 'refused');
  assert.equal(editor.submissions[0].snapshot.body, 'Reply A');
  assert.equal(editor.draft.body, 'B must survive');
});

test('an old autosave acknowledgement does not mark newer writing as saved', () => {
  const editor = fresh();
  editor.edit({ body: 'First change' });
  const ticket = editor.saveTicket('save-1');
  editor.edit({ body: 'Second change' });
  editor.acceptSave(ticket, { instance_id: 'new1', operation_id: 'save-1', kind: 'draft.save', status: 'committed', recorded: true, result: { draft_id: 'd1', draft_revision: 8, generation: 'gA' } });
  assert.equal(editor.draft.body, 'Second change');
  assert.equal(editor.dirty, true);
  assert.equal(editor.draft.revision, 8);
});

test('saving a private note uses its own revision without a reply generation or send', () => {
  const note = new Editor({ ...context, kind: 'note' }, { id: 'note1', revision: 2, body: 'Private thought' });
  note.edit({ body: 'Private thought continued' });
  const ticket = note.saveTicket('save-note');
  assert.ok(ticket);
  assert.equal(note.acceptSave(ticket, { instance_id: 'new1', operation_id: 'save-note', kind: 'note.save', status: 'committed', recorded: true, result: { note_id: 'note1', note_revision: 3 } }), true);
  assert.equal(note.dirty, false);
  assert.throws(() => note.beginPrepare(ids), /cannot be sent/);
});

test('an A autosave arriving after rotation cannot replace B revision or generation', () => {
  const editor = fresh();
  editor.edit({ body: 'Reply A saved' });
  const ticket = editor.saveTicket('save-A');
  editor.beginPrepare(ids);
  editor.acceptPreparation(prepared());
  editor.edit({ body: 'B' });
  assert.equal(editor.acceptSave(ticket, { instance_id: 'new1', operation_id: 'save-A', kind: 'draft.save', status: 'committed', recorded: true, result: { draft_id: 'd1', draft_revision: 99, generation: 'gA' } }), false);
  assert.equal(editor.draft.generation, 'gB');
  assert.equal(editor.draft.revision, 8);
});

test('reload keeps unacknowledged text, caret, attachments and private note separation', () => {
  const editor = fresh();
  editor.edit({ body: 'Unsaved paragraph', caret: { start: 4, end: 9 } });
  const recovered = restoreEditor(context, draft, JSON.parse(JSON.stringify(editor.snapshot())));
  assert.equal(recovered.draft.body, 'Unsaved paragraph');
  assert.deepEqual(recovered.draft.caret, { start: 4, end: 9 });
  assert.deepEqual(recovered.draft.attachments, [{ id: 'image-a' }]);
  assert.equal(recovered.dirty, true);
  assert.throws(() => restoreEditor({ ...context, kind: 'note' }, draft, editor.snapshot()), /different editor/);
});

test('lost prepare response recovers A and binds local B without replacing new typing', () => {
  const editor = fresh();
  editor.beginPrepare(ids);
  editor.edit({ body: 'B typed before response' });
  const recovered = restoreEditor(context, { ...draft, revision: 8, generation: 'gB', body: '' }, editor.snapshot());
  assert.equal(recovered.draft.body, 'B typed before response');
  assert.equal(recovered.acceptPreparation(prepared()), true);
  assert.equal(recovered.draft.generation, 'gB');
  assert.equal(recovered.submissions[0].snapshot.body, 'Reply A');
});

test('a changed remote draft is an explicit conflict, not a silent overwrite of local writing', () => {
  const editor = fresh();
  editor.edit({ body: 'Local paragraph' });
  const recovered = restoreEditor(context, { ...draft, revision: 9, body: 'Other tab paragraph' }, editor.snapshot());
  assert.equal(recovered.draft.body, 'Local paragraph');
  assert.equal(recovered.conflict.remote.body, 'Other tab paragraph');
});

test('Return never sends, including after deleting all quotes or opening a topic', () => {
  for (const ctx of ['reply', 'opening', 'note']) {
    assert.equal(keyAction({ key: 'Enter' }, { context: ctx }), 'newline');
    assert.equal(keyAction({ key: 'Enter', shiftKey: true }, { context: ctx }), 'newline');
  }
  assert.equal(keyAction({ key: 'Enter', metaKey: true }, { context: 'reply' }), 'send-return');
  assert.equal(keyAction({ key: 'Enter', metaKey: true, shiftKey: true }, { context: 'reply' }), 'send-stay');
  assert.equal(keyAction({ key: 'Enter', altKey: true }, { context: 'reply' }), 'send-stay');
  assert.equal(keyAction({ key: 'Enter', metaKey: true }, { context: 'note' }), 'save-note');
  assert.equal(keyAction({ key: 'Enter', metaKey: true, isComposing: true }, { context: 'reply' }), 'native');
  assert.equal(keyAction({ key: 'Enter' }, { context: 'reply', menuActive: true, quoteArmed: true }), 'native');
  assert.equal(keyAction({ key: 'Enter' }, { context: 'reply', quoteArmed: true }), 'quote');
});

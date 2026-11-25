import test from 'node:test';
import assert from 'node:assert/strict';
import { Editor, noWriting } from '../web/editor.mjs';
import { EditorSession, RuntimeAuthority } from '../web/session.mjs';
import { RecoveryJournal } from '../web/journal.mjs';
import { InlineComposer } from '../web/inline-composer.mjs';
import { Reader } from '../web/reader.mjs';
import { EditorRegistry } from '../web/app-session.mjs';
import * as pendingSends from '../web/pending-sends.mjs';
import { drawnText } from '../web/message-format.mjs';
import { miniDocument } from './fixtures/mini_dom.mjs';
const copy = value => structuredClone(value);
const { paintPendingSends } = pendingSends;
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const context = { instanceId: 'send-1233', actor: 'fixture-person', sourceRef: { kind: 'topic', id: 'topic' }, topicId: 'topic', kind: 'reply' };
const makeEditor = () => new Editor(context, { id: 'draft', generation: 'A', revision: 0 });
const image = editor => {
  const cycle = editor.clientCycleId;
  editor.uploadState = { format: 2, revision: 1, client_cycle_id: cycle, submission_links: {}, entries: [{
    selection_id: 'selection-1', origin: 'retained-ref', retained_ref: { id: 'image-1' }, selected: true, version: 1,
    owner: { kind: 'cycle', id: cycle }, binding: { instance_id: context.instanceId, actor_id: context.actor,
      editor_key: editor.key, source_ref: context.sourceRef, topic_id: context.topicId, captured_cycle_id: cycle,
      authority: { authority_id: 'authority', authority_epoch: 'epoch' } }, bytes_state: 'released', bytes_ref: null, attempts: [],
    ready_descriptor: { media_id: 'image-1', media_revision: 2, state: 'ready' }, association: { media_id: 'image-1', cycle_id: cycle },
  }] };
  return editor;
};
const freeze = editor => editor.beginPrepare({ submissionId: 'submission', prepareOperationId: 'prepare', sendOperationId: 'send' });
test('1233 initial inline activity safely paints an unopened Reader without creating source writing', async () => {
  // Constructor-equivalent unopened state; actual Reader painter and registry
  // initialization/activity owners, with transport and editor registration modeled.
  let activity = 0, released = false, draws = 0;
  const reader = Object.assign(Object.create(Reader.prototype), { sessions: null, source: null, mode: 'reply', field: { value: '' },
    drawEditor() { draws++; } });
  const state = { instance_id: context.instanceId, source_ref: context.sourceRef, destination: { topic_id: 'topic' },
    source_available: true, destination_available: true, draft: null, note: null,
    submissions: { instance_id: context.instanceId, items: [], next_cursor: null } };
  const registry = new EditorRegistry({ api: { view: async () => copy(state) }, journal: {},
    bootstrap: { instance_id: context.instanceId, actor: context.actor,
      authority: { authority_id: 'authority', authority_epoch: 'epoch', continuity: 'initial' } },
    activity() { activity++; reader.paintStatus(); } });
  registry.cleanup.foreground = () => ({ read: work => work(), release() { released = true; } });
  registry.register = async () => makeEditor();
  const inline = await registry.initializeInline({ id: 'topic' });
  assert.equal(activity, 1); assert.equal(released, true);
  assert.equal(inline.surface, 'inline'); assert.equal(reader.editor, undefined);
  assert.equal(reader.source, null); assert.equal(reader.field.value, '');
  assert.equal(draws, 0, 'initial activity must not draw source writing in an unopened Reader');
});
test('1233 exact submitted words and images stay in a separate topic card through unknown and placement', t => {
  const doc = miniDocument(), host = doc.createElement('div'), editor = makeEditor(); host.ownerDocument = doc;
  const previous=globalThis.document;globalThis.document=doc;t.after(()=>{globalThis.document=previous;});
  const make=doc.createElement;doc.createElement=tag=>{const node=make(tag);node.ownerDocument=doc;
    Object.defineProperties(node,{parentElement:{get(){return this.parent;}},nextElementSibling:{get(){const list=this.parent?.children??[];return list[list.indexOf(this)+1]??null;}},childNodes:{get(){return this.children;}}});
    node.after=next=>node.parent.insertBefore(next,node.nextElementSibling);return node;};
  editor.edit({ body: 'Exact <words>\nsecond line', attachments: [{ id: 'image-1' }] }); image(editor); const item = freeze(editor);
  let placed = false, active = true, checks = 0;
  const paint = () => paintPendingSends(host, [editor], { topicId: 'topic', placed: () => placed, underway: () => active, check: () => checks++ });
  paint(); const card = host.querySelector('[data-pending-send]');
  assert.equal(drawnText(card.querySelector('.message-preview')), item.snapshot.body);
  assert.equal(card.dataset.id, undefined, 'pending is not a canonical message entry');
  assert.equal((pendingSends.pendingSendVisual?.(editor,item)?.attachments ?? item.snapshot.attachments)[0].id,'image-1');
  editor.edit({ body: 'New writing' }); active = false; item.status = 'prepared'; paint();
  assert.equal(host.querySelector('[data-pending-send]'), card, 'same pending card and exact snapshot');
  assert.match(card.querySelector('.pending-send-state').textContent, /unknown/);
  assert.equal(card.querySelector('button').hidden, false); card.querySelector('button').onclick(); assert.equal(checks, 1);
  item.status = 'confirmed'; item.receipt = { result: { message_id: 'real-message' } }; paint();
  assert.equal(host.querySelector('[data-pending-send]'), card, 'receipt alone does not retire pending writing');
  placed = true; paint(); assert.equal(host.querySelector('[data-pending-send]'), null);
  assert.equal(editor.draft.body, 'New writing');
});
test('1233 conclusive refusal restores only the unchanged empty successor, never unknown or later writing', () => {
  const editor = makeEditor(); editor.edit({ body: 'Keep exact A', attachments: [{ id: 'image-1' }] }); image(editor); const item = freeze(editor);
  assert.equal(editor.restoreRefused(item), false);
  item.status = 'refused'; assert.equal(editor.restoreRefused(item), true);
  assert.equal(editor.draft.body, item.snapshot.body); assert.deepEqual(editor.draft.attachments, item.snapshot.attachments);
  assert.equal(editor.dirty, true);
  const later = makeEditor(); later.edit({ body: 'A' }); const old = freeze(later); later.edit({ body: 'B' }); old.status = 'refused';
  assert.equal(later.restoreRefused(old), false); assert.equal(later.draft.body, 'B');
});
for (const changed of [false, true, 'unknown']) test(`1233 in-flight save ${changed === true ? 'cannot credit changed writing' : changed === 'unknown' ? 'retains unknown publication without replay' : 'satisfies identical effective frozen writing'}`, async () => {
  const editor = makeEditor(), rows = new Map(), gate = deferred(), entered = deferred(), calls = [], notices = [];
  const journal = new RecoveryJournal({ put: async row => rows.set(row.id, copy(row)), get: async id => copy(rows.get(id)) }, 'tab');
  const authority = { authority_id: 'authority', authority_epoch: 'epoch', continuity: 'initial' }; let serial = 0, revision = 0, first = true;
  const api = { command: async envelope => {
    calls.push(copy(envelope)); const saved = await journal.own(editor.key);
    assert.deepEqual(saved.snapshot.attempts.find(entry => entry.envelope.operation_id === envelope.operation_id).envelope, envelope);
    let result;
    if (envelope.kind === 'draft.save') { result = { draft_id: 'draft', generation: 'A', draft_revision: ++revision }; if (first) { first = false; entered.resolve(); await gate.promise; } }
    else if (envelope.kind === 'submission.prepare') result = { submission_id: envelope.args.submission_id, send_operation_id: envelope.args.send_operation_id, next_draft: { id: 'draft', generation: 'B', revision: revision + 1 } };
    else { if (changed === 'unknown') throw Error('lost send answer'); result = { submission_id: envelope.args.submission_id, message_id: 'message', topic: { version: 2 } }; }
    return { instance_id: 'send-1233', operation_id: envelope.operation_id, kind: envelope.kind, recorded: true, status: 'committed', result };
  }, bootstrap: async () => ({ instance_id: context.instanceId, authority }),
    view: async (_name, args) => ({ instance_id: context.instanceId, operation_id: args.operation_id, status: 'unknown', recorded: false }) };
  const runtime = new RuntimeAuthority({ api, instanceId: context.instanceId, authority });
  const session = new EditorSession(editor, { api, journal, authority, runtime, id: () => 'operation-' + ++serial, changed: () => notices.push(calls.length) });
  editor.edit({ body: 'A' }); const saving = session.save(); await entered.promise;
  editor.edit(changed === true ? { body: 'Different A' } : { whisper: false, intent: null });
  const sending = session.send(); editor.edit({ body: 'Successor B' }); gate.resolve(); await saving; const item = await sending;
  assert.equal(item.status, changed === 'unknown' ? 'prepared' : 'confirmed'); assert.equal(editor.draft.body, 'Successor B');
  if (changed === 'unknown') {
    const retained = await journal.own(editor.key);
    assert.equal(retained.snapshot.submissions[0].sendOperationId, item.sendOperationId);
    assert.equal(retained.snapshot.submissions[0].snapshot.body, 'A');
    assert.equal(retained.snapshot.draft.body, 'Successor B');
  }
  assert.equal(calls.filter(call => call.kind === 'draft.save').length, changed === true ? 2 : 1);
  assert.equal(calls.filter(call => call.kind === 'submission.prepare').length, 1);
  assert.equal(calls.filter(call => call.kind === 'message.send').length, 1);
  assert.equal(item.snapshot.body, changed === true ? 'Different A' : 'A');
});
test('1233 pencil closes after pending handoff before unresolved public confirmation', async () => {
  const editor = makeEditor(); editor.edit({ body: 'Exact pending words' }); const wait = deferred(); let closed = 0, shown = 0;
  const ui = { editor, presentation: {}, opening: Symbol(), kind: 'message', admits: () => true, state: () => ({ sendDisabled: false }), names: () => [], kindOf: () => null,
    bar: { holdSend: () => false, fold() {}, panel: null }, naming: { sheet: { open: false } }, field: { focus() {} },
    sheet: { open: true, close() { this.open = false; closed++; } }, drawEditor() {}, paintRecipients() {}, paintStatus() {}, paintChoice() {}, notice(error) { throw error; },
    callbacks: { send() { freeze(editor); return wait.promise; }, pending(_p, _editor, item) { assert.equal(item.snapshot.body, 'Exact pending words'); shown++; return true; } },
    finishSend: InlineComposer.prototype.finishSend };
  const done = InlineComposer.prototype.send.call(ui); assert.equal(shown, 1); assert.equal(closed, 1);
  assert.equal(editor.draft.body, ''); wait.resolve({ status: 'prepared' }); await done;
  assert.equal(editor.submissions[0].snapshot.body, 'Exact pending words');
});

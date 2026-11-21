import test from 'node:test';
import assert from 'node:assert/strict';
import { CardReplies } from '../web/card-replies.mjs';
import { miniDocument } from './fixtures/mini_dom.mjs';
import { noWriting } from '../web/editor.mjs';
import { Reader } from '../web/reader.mjs';
import { Editor } from '../web/editor.mjs';

function fixture({ fromCard = true } = {}) {
  let resolve;
  const pending = new Promise(r => { resolve = r; });
  const editor = new Editor({ instanceId: '941', actor: 'person', sourceRef: { kind: 'message', id: 'parent' }, topicId: 't', kind: 'reply' },
    { id: 'draft', generation: 'first', revision: 0, body: 'done', quotes: [{ source: { kind: 'message', id: 'parent', revision: 1 }, excerpt: 'The selected passage' }] });
  const p = { fromCardReply: fromCard, editors: { reply: editor } }, calls = [];
  const reader = Object.assign({ send: Reader.prototype.send, editor }, { sessions: p.editors, presentation: p, mode: 'reply', viewToken: 1,
    disarm() {}, admits: () => true, writes: () => true, names: () => [], kindOf: () => null, answering: () => ({}),
    compose: { holdSend: () => false, panel: null }, naming: { sheet: { open: false } },
    field: { focus() {} }, drawEditor() {}, callbacks: {
      send(e, options) { calls.push(['send', options]); e.beginPrepare({ submissionId: 'submission', prepareOperationId: 'prepare', sendOperationId: 'send' }); return pending; },
      sent(presentation, result, current) { calls.push(['sent', presentation, result, current()]); }, error(e) { throw e; },
    } });
  return { reader, editor, p, resolve, calls };
}

test('941 quoted inline-origin Reader waits for confirmed publication and finishes the card', async () => {
  const f = fixture(), sending = f.reader.send(false);
  assert.equal(f.calls[0][1].stay, true, 'preparation must retain the inline-origin Reader');
  assert.equal(f.calls.length, 1);
  assert.equal(f.editor.submissions[0].snapshot.quotes[0].excerpt, 'The selected passage');
  f.resolve({ status: 'confirmed' }); await sending;
  assert.equal(f.calls[1][0], 'sent'); assert.equal(f.calls[1][1], f.p); assert.equal(f.calls[1][3], true);
});
for (const status of ['preparing', 'prepared', 'refused', 'unknown']) test(`941 ${status} retains the inline-origin Reader`, async () => {
  const f = fixture(), sending = f.reader.send(false); f.resolve({ status }); await sending;
  assert.equal(f.calls[0][1].stay, true); assert.equal(f.calls.length, 1);
});
for (const [label, change] of Object.entries({
  writing: f => f.editor.edit({ body: 'New words' }),
  quote: f => f.editor.edit({ quotes: [{ excerpt: 'New quote' }] }),
  cycle: f => { f.editor.clientCycleId = 'newer'; },
  opening: f => { f.reader.viewToken++; },
  source: f => { f.reader.presentation = {}; },
  mode: f => { f.reader.mode = 'note'; },
  admission: f => { f.reader.admits = () => false; },
  image: f => { f.editor.imageReservation = {}; },
  picker: f => { f.reader.imagePicker = {}; },
  names: f => { f.reader.compose.panel = 'names'; },
  naming: f => { f.reader.naming.sheet.open = true; },
  notice: f => { f.reader.noticeVersion = 10; },
})) test(`941 late confirmation leaves ${label} alone`, async () => {
  const f = fixture(), sending = f.reader.send(false); change(f); f.resolve({ status: 'confirmed' }); await sending;
  assert.equal(f.calls.length, 1);
});
for (const [fromCard, stay] of [[false, false], [false, true], [true, true]]) test(`941 ordinary/stay Reader behavior (${fromCard}/${stay}) remains`, async () => {
  const f = fixture({ fromCard }), sending = f.reader.send(stay); f.resolve({ status: 'confirmed' }); await sending;
  assert.equal(f.calls[0][1].stay, stay); assert.equal(f.calls.length, 1);
});

test('941 images owned by the sent submission do not hold its empty successor open', async () => {
  const f = fixture(), sending = f.reader.send(false);
  f.editor.uploadState = { format: 2, revision: 1, client_cycle_id: f.editor.clientCycleId, submission_links: {}, entries: [
    { selection_id: 'image', origin: 'file', binding: {}, owner: { kind: 'submission', id: 'submission' }, selected: true, bytes_state: 'released', attempts: [] }] };
  f.resolve({ status: 'confirmed' }); await sending; assert.equal(f.calls[1][0], 'sent');
});
test('941 a selected successor image keeps the Reader', async () => {
  const f = fixture(), sending = f.reader.send(false);
  f.editor.uploadState = { entries: [{ owner: { kind: 'cycle', id: f.editor.clientCycleId }, selected: true }] };
  f.resolve({ status: 'confirmed' }); await sending; assert.equal(f.calls.length, 1);
});
function closing() {
  const doc = miniDocument(), root = doc.createElement('div'), opener = doc.createElement('article'), taller = doc.createElement('button');
  root.ownerDocument = doc; root.contains = el => el === root;
  const editor = { context: { kind: 'reply' }, submissions: [], draft: noWriting(), localVersion: 1, clientCycleId: 'successor' };
  const card = { editors: { reply: editor } }, p = { source: { source_ref: { id: 'parent' } }, editors: card.editors, fromCardReply: true, opener };
  const row = { p: card, card: opener, ui: { root, opening: Symbol(), $: () => taller, bar: { close() {} } } };
  let release; const kept = new Promise(r => { release = r; }), landed = [];
  const registry = { current: p, close: () => kept.then(result => { if (result) { registry.current = null; opener.focus(); } return result; }) };
  const owner = Object.assign(Object.create(CardReplies.prototype), { rows: new Map([['parent', row]]), registry, closed: new Set(), changed() {},
    callbacks: { sent: (_result, current) => landed.push(current) } });
  return { owner, row, p, editor, registry, release, landed, doc, opener };
}
test('941 returning from Reader closes the card after keeping and lands from its opener', async () => {
  const f = closing(), done = f.owner.readerSent(f.p, { status: 'confirmed' }, () => true);
  assert.equal(f.row.ui.root.hidden, false); f.release(true); await done;
  assert.equal(f.row.ui.root.hidden, true); assert.equal(f.landed.length, 1); assert.equal(f.landed[0](), true);
  f.doc.createElement('button').focus(); assert.equal(f.landed[0](), false, 'later focus owns the page');
});
for (const [label, change] of Object.entries({
  opening: f => { f.row.ui.opening = Symbol(); },
  writing: f => { f.editor.draft.body = 'New words'; f.editor.localVersion++; },
  cycle: f => { f.editor.clientCycleId = 'newer'; },
  navigation: f => { f.registry.pendingOpen = {}; },
  disposal: f => { f.registry.disposed = true; },
  retired: f => { f.owner.rows.delete('parent'); },
})) test(`941 close completion leaves newer ${label} alone`, async () => {
  const f = closing(), done = f.owner.readerSent(f.p, {}, () => true); change(f); f.release(true); await done;
  assert.equal(f.row.ui.root.hidden, false); assert.equal(f.landed.length, 0);
});
test('941 refused keeping leaves the Reader and card alone', async () => {
  const f = closing(), done = f.owner.readerSent(f.p, {}, () => true); f.release(false); await done;
  assert.equal(f.row.ui.root.hidden, false); assert.equal(f.landed.length, 0);
});

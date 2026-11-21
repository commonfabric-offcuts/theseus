import test from 'node:test';
import assert from 'node:assert/strict';
import { InlineComposer } from '../web/inline-composer.mjs';
import { noWriting } from '../web/editor.mjs';
import { CardReplies } from '../web/card-replies.mjs';
import { miniDocument } from './fixtures/mini_dom.mjs';

function sending() {
  let resolve; const answer = new Promise(r => { resolve = r; });
  const editor = { draft: { ...noWriting(), body: 'A reply' }, context: { kind: 'reply' },
    localVersion: 1, clientCycleId: 'first', edit(patch) { Object.assign(this.draft, patch); } };
  const finished = [], ui = {
    editor, send: InlineComposer.prototype.send, finishSend: InlineComposer.prototype.finishSend,
    published: InlineComposer.prototype.published,
    presentation: { editors: { reply: editor } }, cardReply: true, kind: 'message', opening: Symbol(),
    admits: () => true, state: () => ({ sendDisabled: false }), names: () => [], kindOf: () => null,
    field: { focus() {} }, bar: { holdSend: () => false, panel: null }, naming: { sheet: { open: false } },
    drawEditor() {}, paintRecipients() {}, paintStatus() {}, paintChoice() {}, notice(e) { throw e; },
    callbacks: { send() { editor.draft = noWriting(); editor.clientCycleId = 'successor'; return answer; },
      sent: (p, result) => finished.push({ p, result }) },
  };
  return { ui, editor, finished, resolve };
}

test('937 only confirmed publication closes the unchanged card reply opening', async () => {
  const f = sending(), done = f.ui.send();
  assert.equal(f.finished.length, 0, 'preparation alone is not publication');
  f.resolve({ status: 'confirmed' }); await done;
  assert.equal(f.finished.length, 1); assert.equal(f.finished[0].p, f.ui.presentation);
});
for (const status of ['preparing', 'prepared', 'refused', 'unknown']) test(`937 ${status} reply retains its controls`, async () => {
  const f = sending(), done = f.ui.send(); f.resolve({ status }); await done; assert.equal(f.finished.length, 0);
});
for (const [name, change] of Object.entries({
  writing: f => { ++f.editor.localVersion; f.editor.draft.body = 'New writing'; },
  cycle: f => { f.editor.clientCycleId = 'newer'; },
  reopened: f => { f.ui.opening = Symbol(); },
  source: f => { f.ui.admits = () => false; },
  image: f => { f.editor.imageReservation = {}; },
  picker: f => { f.ui.imagePicker = {}; },
  notice: f => { f.ui.noticeVersion = 2; },
  names: f => { f.ui.bar.panel = 'names'; },
})) test(`937 late confirmation preserves ${name}`, async () => {
  const f = sending(), done = f.ui.send(); change(f); f.resolve({ status: 'confirmed' }); await done;
  assert.equal(f.finished.length, 0);
});
test('937 composer at rest remains open after confirmed sending', async () => {
  const f = sending(); f.ui.cardReply = false;
  const done = f.ui.send(); f.resolve({ status: 'confirmed' }); await done; assert.equal(f.finished.length, 0);
});

async function reconciled() {
  const f = sending(), item = { id: 'one-publication', status: 'preparing' };
  f.editor.submissions = [item];
  const done = f.ui.send();
  item.status = 'prepared'; f.resolve(item); await done;
  assert.equal(f.finished.length, 0, 'losing the answer is not confirmation');
  return { ...f, item };
}
test('979 later confirmation finishes its original empty card opening once', async () => {
  const f = await reconciled();
  f.item.status = 'confirmed'; f.ui.published(f.item); await Promise.resolve();
  assert.equal(f.finished.length, 1);
  f.ui.published(f.item); assert.equal(f.finished.length, 1, 'a repeated confirmation cannot finish twice');
});
for (const [name, change] of Object.entries({
  writing: f => { ++f.editor.localVersion; f.editor.draft.body = 'New writing'; },
  cycle: f => { f.editor.clientCycleId = 'newer'; },
  reopened: f => { f.ui.opening = Symbol(); },
  source: f => { f.ui.admits = () => false; },
  image: f => { f.editor.imageReservation = {}; },
  picker: f => { f.ui.imagePicker = {}; },
  notice: f => { f.ui.noticeVersion = 2; },
  names: f => { f.ui.bar.panel = 'names'; },
  detached: f => { f.item.detached = true; },
  authority: f => { f.editor.authorityRecovery = { phase: 'review' }; },
})) test(`979 reconciled publication preserves ${name}`, async () => {
  const f = await reconciled(); change(f);
  f.item.status = 'confirmed'; f.ui.published(f.item); await Promise.resolve();
  assert.equal(f.finished.length, 0);
});
test('979 another submission cannot close the awaiting card opening', async () => {
  const f = await reconciled();
  f.ui.published({ id: 'another-publication', status: 'confirmed' });
  assert.equal(f.finished.length, 0);
});

function cardReply() {
  const doc = miniDocument(), root = doc.createElement('div'), field = doc.createElement('textarea'), taller = doc.createElement('button');
  root.ownerDocument = doc; root.contains = el => el === root || [...root.descendants()].includes(el);
  root.append(field, taller); root.setAttribute('data-tall', ''); field.focus();
  const p = { hidden: false, editors: { reply: { draft: noWriting() } } }, landed = [];
  const row = { p, card: doc.createElement('article'), ui: { root, opening: Symbol(), $: () => taller, bar: { close() {} } } };
  const owner = Object.assign(Object.create(CardReplies.prototype), { rows: new Map([['parent', row]]), closed: new Set(), registry: {},
    callbacks: { sent: (result, current) => landed.push({ result, current }) }, changed() {} });
  return { owner, row, p, root, field, doc, landed };
}
test('937 publication hides the old opening synchronously and resets its height without another save', () => {
  const f = cardReply(); f.owner.sent('parent', f.p, { status: 'confirmed' });
  assert.equal(f.p.hidden, true); assert.equal(f.root.hidden, true); assert.equal(f.root.getAttribute('data-tall'), null);
  assert.equal(f.owner.closed.has('parent'), true); assert.equal(f.landed.length, 1);
  assert.equal(f.landed[0].current(), true);
  f.row.ui.opening = Symbol(); assert.equal(f.landed[0].current(), false, 'later opening owns focus');
});
test('937 publication leaves new writing and focus elsewhere alone', () => {
  const f = cardReply(); f.p.editors.reply.draft.body = 'Later'; f.owner.sent('parent', f.p, {});
  assert.equal(f.p.hidden, false); assert.equal(f.landed.length, 0);
  f.p.editors.reply.draft = noWriting(); f.doc.createElement('button').focus(); f.owner.sent('parent', f.p, {});
  assert.equal(f.p.hidden, true); assert.equal(f.landed.length, 0, 'finishing a background send does not take focus');
});
test('937 a delayed sent-card read yields when another control or Reader takes focus', () => {
  const f = cardReply(); f.owner.sent('parent', f.p, {}); const current = f.landed[0].current;
  f.owner.registry.current = {}; assert.equal(current(), false); f.owner.registry.current = null;
  f.doc.createElement('button').focus(); assert.equal(current(), false);
});

// Actual owner functions with modeled ports. No native gesture/pixel claim.
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { ActionTimings, timingCall } from '../web/action-timing.mjs';
import { InlineComposer } from '../web/inline-composer.mjs';
import { Reader } from '../web/reader.mjs';
import { noWriting } from '../web/editor.mjs';
import { keepPendingSendPlace } from '../web/pending-sends.mjs';
const app = readFileSync(new URL('../web/app.mjs', import.meta.url), 'utf8');
const cut = (start, end) => { const a = app.indexOf(start), b = app.indexOf(end, a); assert.ok(a >= 0 && b > a); return app.slice(a, b); };
function fixture() {
  let serial = 0; const frames = [], traces = [];
  const recorder = new ActionTimings({ instanceId: 'fixture', build: 'fixture', now: () => 0, wall: () => 1,
    uuid: () => 'id-' + ++serial, frame: fn => { frames.push(fn); return frames.length; }, timers: { setTimeout: () => 1, clearTimeout() {} }, Observer: null });
  const beginTiming = kind => { const trace = recorder.begin(kind); traces.push(trace); return trace; };
  const field = { matches: () => true }, doc = { activeElement: field };
  const ctx = { beginTiming, timingCall, document: doc, opening: 0, cardReplyRequest: 0, retired: false, messageEntries: new Map(),
    reader: { dialog: { open: true, contains: node => node === field }, reply() {}, quoteFrom() {} }, marks: { capture: () => ({}) },
    registry: { current: { source: { source_ref: { id: 'message' } } }, disposed: false, isCurrent: () => true },
    openSource: async (_ref, _card, _act, _mode, _reply, options) => { ctx.openTiming = options.timing; },
    stackFeed: null, cardReplies: { open: async (_id, _card, options) => { options.timing.endpoint('reply_focused'); return {}; } },
    clearVisitNew() {}, opened: entry => entry, openedHere() {}, releaseTopArrivals() {} };
  ctx.marks.read = () => {};
  const functions = vm.runInNewContext(cut('async function replyMessage(', '// Reply and the first body click') + cut('async function replyInCard(', '// Every page of the person') + ';({ replyMessage, replyInCard });', ctx);
  return { ctx, functions, traces, frames, doc, field };
}
for (const path of ['Reply on message bar (modeled click/touch)', 'Return on lit card (modeled key route)', 'Quote selected passage (modeled selection route)'])
test('1234 '+path+' keeps its own Reader-open context through focus', async () => {
  const f = fixture(), card = {};
  await f.functions.replyMessage('message', card, path.startsWith('Quote') ? 'selected words' : null);
  const trace = f.traces[0]; assert.equal(f.ctx.openTiming, trace); assert.equal(trace.hasEndpoint('reply_focused'), true);
  assert.equal(trace.row.outcome, 'running'); f.frames.splice(0).forEach(fn => fn()); f.frames.splice(0).forEach(fn => fn()); assert.equal(trace.row.outcome, 'complete');
});
for (const path of ['first body press (modeled click/touch)', 'inline Reply menu (modeled key activation)'])
test('1234 '+path+' passes a separate context to the card composer', async () => {
  const f = fixture(), card = { isConnected: true, getClientRects: () => [1] };
  await f.functions.replyInCard('message', card); assert.equal(f.traces[0].hasEndpoint('reply_focused'), true);
});
test('1234 a superseded Reader open cannot claim focus from the newer source', async () => {
  const f = fixture(); f.ctx.registry.current.source.source_ref.id = 'newer';
  await f.functions.replyMessage('message', {}); assert.equal(f.traces[0].row.outcome, 'incomplete'); assert.equal(f.traces[0].hasEndpoint('reply_focused'), false);
});
for (const path of ['inline pencil Send click', 'inline pencil send key', 'card composer Send click', 'card composer send key'])
test('1234 '+path+' observes composer settlement after the actual owner redraw', async () => {
  const order = [], item = { status: 'preparing', id: 'submission' }, editor = { context: { kind: 'reply' }, draft: { ...noWriting(), body: 'writing' }, localVersion: 1, clientCycleId: 'cycle', edit(patch) { Object.assign(this.draft, patch); } };
  const ui = { editor, presentation: {}, opening: {}, kind: 'message', cardReply: path.startsWith('card'), admits: () => true, state: () => ({ sendDisabled: false }),
    names: () => [], kindOf: () => null, bar: { holdSend: () => false }, field: { focus: () => order.push('focus') }, drawEditor: () => order.push('draw'), paintRecipients() {}, paintStatus() {}, paintChoice() {},
    callbacks: { send: () => { editor.draft = noWriting(); editor.submissions = [item]; return Promise.resolve(item); }, settled: (owner, submission) => { assert.equal(owner, editor); assert.equal(submission, item); order.push('settled'); } },
    finishSend() {}, notice: error => { throw error; } };
  await InlineComposer.prototype.send.call(ui); assert.deepEqual(order, ['draw', 'focus', 'settled']);
});
for (const path of ['Reader Send click', 'Reader send key', 'Reader stay-and-send key'])
test('1234 '+path+' observes settlement after the actual Reader redraw', async () => {
  const order = [], item = { status: 'preparing', id: 'submission' }, editor = { context: { kind: 'reply' }, draft: { ...noWriting(), body: 'writing' }, submissions: [], localVersion: 1, clientCycleId: 'cycle', edit(patch) { Object.assign(this.draft, patch); } };
  const ui = { sessions: { reply: editor }, editor, admits: () => true, disarm() {}, names: () => [], kindOf: () => null, answering: () => ({}), mode: 'reply',
    presentation: {}, viewToken: 1, compose: { holdSend: () => false }, field: { focus: () => order.push('focus') }, drawEditor: () => order.push('draw'),
    callbacks: { send: () => { editor.draft = noWriting(); editor.submissions = [item]; return Promise.resolve(item); }, settled: (owner, submission) => { assert.equal(owner, editor); assert.equal(submission, item); order.push('settled'); }, error: error => { throw error; } } };
  await Reader.prototype.send.call(ui, path.includes('stay')); assert.deepEqual(order, ['draw', 'focus', 'settled']);
});
for (const path of ['card thumb click/touch', 'card thumb key activation', 'Reader thumb click/key'])
test('1234 '+path+' records acknowledgment after the actual named-card painter', () => {
  const f = fixture(), trace = f.ctx.beginTiming('thumb'), order = [];
  const entry = { isConnected: true }, contexts = { timingCall, messageEntries: new Map([['message', entry]]), feedMessages: () => new Map([['message', {}]]),
    pressHold: { down: false }, stackFeed: { paintFoldedThumb: () => order.push('DOM'), paintReactionReading() {} }, cardIn: x => x,
    menu: { paintMessage() {} }, paintCardReading() {}, keepListAnchor: job => job(), readerItem: () => ({ id: 'other' }), paintReaderThumb$() {} };
  const paint = vm.runInNewContext(cut('function paintThumbMessage(', '// A message the page shows') + ';paintThumbMessage;', contexts);
  const original = trace.endpoint.bind(trace); trace.endpoint = name => { order.push(name); original(name); };
  paint('message', true, trace, 'thumb_pending_dom'); paint('message', true, trace, 'thumb_confirmed_dom');
  assert.deepEqual(order, ['DOM', 'thumb_pending_dom', 'DOM', 'thumb_confirmed_dom']);
  assert.equal(trace.hasEndpoint('thumb_confirmed_dom'), true);
});
test('1234 actual pending-card and canonical-placement painters acknowledge only their own connected node', async () => {
  const f = fixture(), trace = f.ctx.beginTiming('send'), pending = { isConnected: true }, canonical = { isConnected: true };
  const item = { id: 'submission', presentPending: true, status: 'preparing', topicId: 'topic' }, editor = { submissions: [item] }, session = { editor, timingFor: () => trace };
  let painted = 0;
  const doc = { activeElement: null, defaultView: { innerHeight: 900, scrollBy() {} }, getSelection: () => ({ isCollapsed: true }) };
  const host = { ownerDocument: doc, querySelectorAll: () => [] };
  const ctx = { timingCall, keepPendingSendPlace, registry: { sessions: new Map([['editor', session]]), sessionFor: () => session, cleanup: {}, generation: 1, disposed: false },
    views: { messages: new Map([['canonical', {}]]) }, topic: { id: 'topic' }, retired: false, topicUnavailable: false, authorityReviewPending: () => false,
    pendingSendCard: () => item.status === 'preparing' ? pending : null, messageEntries: new Map([['canonical', canonical]]),
    paintPendingSends: () => { painted++; }, $: () => host, bootstrap: { actor_kind: 'human' }, displayActor() {}, displayRules: () => ({}), pendingSendTarget() {},
    listAccessEpoch: 1, submittedPlacements: new Map(), document: doc, window: doc.defaultView, roomy: null, drawn: () => true };
  const source = cut('function restorePendingSendPlace(', 'function pendingSendTarget(') + cut('function paintSubmittedWriting()', 'const submittedPlacements') + cut('function placeSubmittedWriting(', 'function paintReview');
  const functions = vm.runInNewContext(source + ';({ paintSubmittedWriting, placeSubmittedWriting });', ctx);
  functions.paintSubmittedWriting(); assert.equal(painted, 1); assert.equal(trace.hasEndpoint('send_pending_dom'), true);
  item.status = 'confirmed'; item.receipt = { result: { message_id: 'canonical' } };
  assert.equal(await functions.placeSubmittedWriting(editor, item), true); assert.equal(trace.hasEndpoint('send_canonical_dom'), true);
});

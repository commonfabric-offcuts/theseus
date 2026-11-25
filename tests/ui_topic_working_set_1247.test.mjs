import test from 'node:test';
import assert from 'node:assert/strict';
import { planTopicWindow, retainedRuns, boundMap } from '../web/topic-working-set.mjs';
import { TopicViews } from '../web/topic-views.mjs';
import { DossierHeads } from '../web/stack-order.mjs';
import { VisitNew } from '../web/visit-new.mjs';
import { CardReplies } from '../web/card-replies.mjs';
import { stackState, forgetStackMessages, drawn, arrangeStacks } from '../web/reply-stacks.mjs';
import { paintPendingSends, adoptPendingSend } from '../web/pending-sends.mjs';
import { renderer799 } from './fixtures/renderer799.mjs';
import { readFileSync } from 'node:fs';
import { miniDocument } from './fixtures/mini_dom.mjs';

const item = seq => ({ id: 'm' + seq, seq, topic_id: 't', author_id: 'person', body: 'Words ' + seq });
const records = count => new Map(Array.from({ length: count }, (_, n) => { const row = item(n + 1); return [row.id, row]; }));
const oneRun = messages => new Map([...messages.keys()].map(id => [id, 1]));
const page = (from, to, next = null) => ({ instance_id: 'i', items: Array.from({ length: to - from + 1 }, (_, n) => item(from + n)),
  next_cursor: next, relevant_versions: { topic: to } });

test('1247 budget counts supplemental originals with their replies', () => {
  const messages = records(900), roots = new Map([...messages.keys()].map(id => [id, 'root-' + id]));
  const plan = planTopicWindow(messages, oneRun(messages), { roots });
  assert.equal(plan.full.size, 300); assert.equal(plan.keep.size, 150); assert.equal(plan.roots.size, 150);
  assert.equal(plan.blocked, false); assert.ok(plan.runs.length <= 8);
});
test('1247 a huge unread open dossier keeps the anchor inside the same budget', () => {
  const messages = records(1500), roots = new Map([...messages.keys()].map(id => [id, 'original']));
  for (const row of messages.values()) row.unread = true;
  const plan = planTopicWindow(messages, oneRun(messages), { roots, anchor: 'm750', pins: ['m750', 'm749'] });
  assert.equal(plan.full.size, 300); assert.equal(plan.keep.size, 299);
  assert.ok(plan.keep.has('m750')); assert.ok(plan.keep.has('m749')); assert.ok(plan.keep.has('m1500'));
  assert.equal(plan.roots.size, 1); assert.ok(plan.evict.length > 1000);
});
test('1247 a focused supplemental original retains a member and its root inside the shared budget', () => {
  const messages = records(301), roots = new Map([...messages.keys()].map(id => [id, id])); roots.set('m1', 'old-root');
  const plan = planTopicWindow(messages, oneRun(messages), { roots, pins: ['old-root'] });
  assert.ok(plan.keep.has('m1')); assert.ok(plan.roots.has('old-root')); assert.ok(plan.full.has('old-root'));
  assert.equal(plan.full.size, 300); assert.equal(plan.blocked, false);
});
test('1247 eviction splits loaded intervals instead of claiming an unloaded hole is contiguous', () => {
  const messages = records(9), runs = oneRun(messages);
  assert.deepEqual(retainedRuns(messages, runs, new Set(['m1', 'm2', 'm5', 'm6', 'm9'])), [['m1', 'm2'], ['m5', 'm6'], ['m9']]);
  const sparse = new Map([['m1', item(1)], ['m9', item(9)]]);
  assert.deepEqual(retainedRuns(sparse, oneRun(sparse), new Set(sparse.keys())), [['m1', 'm9']], 'global seq gaps are not topic gaps');
});
test('1247 protected admission pressure is explicit and does not silently increase the budget', () => {
  const messages = records(10);
  const plan = planTopicWindow(messages, oneRun(messages), { budget: 2, pins: ['m1', 'm2', 'm3'], newest: 0 });
  assert.equal(plan.blocked, true); assert.deepEqual([...plan.rejectedPins], ['m3']); assert.equal(plan.full.size, 2);
});
test('1247 retained hints have a bounded lifetime', () => {
  const hints = new Map(Array.from({ length: 1000 }, (_, n) => ['m' + n, { seq: n, revision: 1 }]));
  boundMap(hints); assert.equal(hints.size, 256); assert.equal(hints.has('m0'), false); assert.equal(hints.has('m999'), true);
});
test('1247 actual TopicViews records plateau through sustained arrivals while a reading anchor survives', () => {
  const views = new TopicViews({ instanceId: 'i', topicId: 't', window: () => ({ pins: ['m1'], anchor: 'm1' }) });
  views.messagesPage(page(1, 30, 1), { initial: true });
  for (let n = 30; n < 1200; n += 30) {
    assert.equal(views.messagesPage(page(n + 1, n + 30), { live: true, cursor: n }), true);
    assert.ok(views.messages.size <= 300, `retained ${views.messages.size} after ${n + 30} arrivals`);
    assert.ok(views.messages.has('m1'));
  }
  assert.equal(views.newest, 1200);
});

test('1247 scrolls every page of a 30000-message Releases topic with bounded records and reconstructs a real gap', () => {
  let anchor = null;
  const views = new TopicViews({ instanceId: 'i', topicId: 't', window: () => ({ anchor }) });
  views.messagesPage(page(29971, 30000, 29971), { initial: true });
  let loaded = 30;
  for (let cursor = 29971; cursor > 1; cursor -= 30) {
    const from = Math.max(1, cursor - 30); anchor = 'm' + (cursor - 1);
    assert.equal(views.messagesPage(page(from, cursor - 1, from === 1 ? null : from), { cursor }), true);
    loaded += cursor - from;
    assert.ok(views.messages.size <= 300); assert.ok(views.windowHints.size <= 256);
    assert.ok(new Set(views.runs.values()).size <= 8);
    assert.equal(views.messages.has(anchor), true);
  }
  assert.equal(loaded, 30000); assert.equal(views.olderCursor, null); assert.equal(views.newest, 30000);
  const gap = views.windowGaps.at(-1); assert.ok(gap);
  const before = gap.before, from = before - 30; anchor = 'm' + (before - 1);
  assert.equal(views.messagesPage(page(from, before - 1, from), { anchored: true, contiguous: true, cursor: before }), true);
  assert.ok(views.messages.has(anchor)); assert.ok(views.messages.size <= 300);
  const run = views.runOf(anchor);
  assert.equal(views.runOf('m' + before), run, 'the actual cursor neighbor joins the reconstructed run');
});

test('1247 stale window pages cannot resurrect evicted records or change the frontier', () => {
  const views = new TopicViews({ instanceId: 'i', topicId: 't', window: () => ({ budget: 40 }) });
  views.messagesPage(page(1, 30, 1), { initial: true }); const windowEpoch = views.windowEpoch;
  views.messagesPage(page(31, 60), { live: true, cursor: 30 });
  const before = [...views.messages.keys()], newest = views.newest, cursor = views.olderCursor;
  assert.equal(views.messagesPage(page(1, 20), { anchored: true, cursor: 21, windowEpoch }), false);
  assert.deepEqual([...views.messages.keys()], before); assert.equal(views.newest, newest); assert.equal(views.olderCursor, cursor);
});

test('1247 gaps update even below the budget and disappear when an explicit page closes the interval', () => {
  const views = new TopicViews({ instanceId: 'i', topicId: 't', window: () => ({ budget: 30 }) });
  views.messagesPage(page(1, 3, 1), { initial: true });
  views.messagesPage(page(7, 9, 7), { anchored: true, cursor: 10 });
  assert.deepEqual(views.windowGaps, [{ before: 7, after: 3 }]);
  views.messagesPage(page(4, 6, 4), { anchored: true, contiguous: true, cursor: 7 });
  assert.deepEqual(views.windowGaps, []); assert.equal(new Set(views.runs.values()).size, 1);
  assert.equal(views.messages.size, 9); assert.equal(views.windowHints.size, 0);
});

test('1247 protected pressure refuses admission before advancing the live watermark and can resume', () => {
  let held = true; const paints = [];
  const views = new TopicViews({ instanceId: 'i', topicId: 't', paint: kind => paints.push(kind),
    window: () => ({ budget: 30, pins: held ? Array.from({ length: 30 }, (_, n) => 'm' + (n + 1)) : [] }) });
  views.messagesPage(page(1, 30, 1), { initial: true });
  assert.equal(views.messagesPage(page(31, 60), { live: true, cursor: 30 }), false);
  assert.equal(views.newest, 30); assert.equal(views.messages.size, 30); assert.ok(views.windowPressure.includes('m60'));
  assert.equal(paints.at(-1), 'window');
  held = false;
  assert.equal(views.messagesPage(page(31, 60), { live: true, cursor: 30 }), true);
  assert.equal(views.newest, 60); assert.equal(views.windowPressure, null);
});

test('1247 cold reconstruction keeps revisions, terminal removal, latest acts and stored unread truth', () => {
  const views = new TopicViews({ instanceId: 'i', topicId: 't', window: () => ({ budget: 30 }) });
  const first = page(1, 30); Object.assign(first.items[0], { revision: 3, body: 'Latest', unread: true });
  views.messagesPage(first, { initial: true });
  views.learnRemoval('m2', { kind: 'unsent' });
  views.messagesPage(page(31, 60), { live: true, cursor: 30 });
  assert.equal(views.messages.has('m1'), false);
  assert.throws(() => views.messagesPage(page(1, 30), { anchored: true, cursor: 31 }), { code: 'RESOURCE_NOT_CURRENT' });
  const later = page(1, 30); Object.assign(later.items[0], { revision: 4, body: 'Current', unread: false,
    acts: { version: 10, starred: true }, stack_position: { root_id: 'm1', at: { acts: 10 } } });
  assert.equal(views.messagesPage(later, { anchored: true, cursor: 31 }), true);
  assert.equal(views.messages.get('m1').body, 'Current'); assert.equal(views.messages.get('m1').unread, false);
  assert.equal(views.messages.get('m1').acts.starred, true); assert.equal(views.messages.has('m2'), false);
});

test('1247 actual supplemental-head owner shares 300 records and drops late retired reads', async () => {
  let resolve; const pending = new Promise(done => { resolve = done; });
  let calls = 0;
  const heads = new DossierHeads({ topicId: 't', read: async (_name, args) => {
    ++calls; if (calls === 1) await pending;
    return { items: args.message_ids.map((id, n) => ({ ...item(n + 1), id, stack_position: { root_id: id, at: { acts: 1 } } })) };
  } });
  const views = new TopicViews({ instanceId: 'i', topicId: 't', window: () => ({}) });
  const batch = (from, to) => { const answer = page(from, to); for (const row of answer.items) {
    row.reply_to = 'root-' + row.id; row.stack_position = { root_id: row.reply_to, at: { acts: 1 } };
  } return answer; };
  views.messagesPage(batch(1, 30), { initial: true }); heads.sync(views.messages); await Promise.resolve();
  for (let n = 30; n < 600; n += 30) { views.messagesPage(batch(n + 1, n + 30), { live: true, cursor: n }); heads.sync(views.messages); }
  assert.ok(heads.queued.size <= 150, 'retired heads do not accumulate a promise-chain backlog');
  resolve(); await heads.readTail;
  assert.equal(heads.records.has('root-m1'), false);
  assert.ok(views.messages.size + heads.records.size <= 300);
  assert.equal(heads.records.size, 150, 'real reply relationships require 150 actual supplemental originals');
  assert.equal(heads.messages(views.messages).size, 300);
});

test('1247 windowed starring never exhausts ordinary history; explicit rail links own cold navigation', async () => {
  const views = new TopicViews({ instanceId: 'i', topicId: 't', window: () => ({}) });
  views.olderCursor = 30000; views.resetStars(); let reads = 0;
  assert.equal(await views.readStarred(async () => { ++reads; throw Error('unexpected exhaustive read'); }, () => true), true);
  assert.equal(reads, 0); assert.equal(views.olderCursor, 30000); assert.equal(views.starredPending, false);
});

test('1247 settled sight reports compact without releasing the New line or reviving it after an act', async () => {
  const views = new TopicViews({ instanceId: 'i', topicId: 't', window: () => ({}) });
  views.line = { id: 'm1', seq: 1 }; views.oldestUnread = { id: 'm1', seq: 1 };
  for (let n = 1; n <= 1000; n++) views.sighted(n, n, Promise.resolve({ status: 'committed', result: { acknowledged: 1 } }));
  await Promise.resolve(); views.oldestUnread = null;
  assert.equal(views.sight.size, 0); assert.equal(views.held, true);
  let finish; views.sighted(1001, 1001, new Promise(resolve => { finish = resolve; }));
  views.acted(); finish({ status: 'committed', result: { acknowledged: 1 } }); await Promise.resolve();
  assert.equal(views.held, false); assert.equal(views.sightHeld, false);
});

test('1247 retirement prunes visit decoration without marking a stored message read', () => {
  const marks = new VisitNew('me'), rows = Array.from({ length: 1200 }, (_, n) => ({ ...item(n + 1), unread: true }));
  marks.arrive(rows); for (let n = 0; n < 600; n++) marks.clear(rows[n].id);
  marks.retain(new Set(rows.slice(-300).map(row => row.id)));
  assert.equal(marks.arrivals.size, 300); assert.equal(marks.handled.size, 0);
  assert.ok(rows.every(row => row.unread === true)); assert.equal(marks.has('m1'), false);
});

const app = readFileSync(new URL('../web/app.mjs', import.meta.url), 'utf8');
const readTracking = app.slice(app.indexOf('function observeReadEntry('), app.indexOf('function revokeMedia()'));
const appFunctions = (start, end, env, ports) => {
  env.seenEntries ??= new Map();
  return new Function(...Object.keys(env), readTracking + app.slice(app.indexOf(start), app.indexOf(end)) + '\nreturn ' + ports)(...Object.values(env));
};
test('1247 actual app retirement releases DOM, observers, stack/body owners but preserves original writing and operations', () => {
  const gone = { dataset: { id: 'm1', seq: '1' }, isConnected: true, remove() { this.isConnected = false; } };
  const kept = { dataset: { id: 'm2', seq: '2' }, isConnected: true };
  const writing = { draft: { body: 'Later B', attachments: [{ id: 'image-B' }] }, submissions: [{ id: 'op-A', envelope: { operation_id: 'original' }, status: 'unknown' }] };
  const original = structuredClone(writing), events = [], list = { addEventListener() {} };
  const state = stackState(list); state.stacks = [{ id: 'm1', head: item(1), replies: [item(2)] }]; state.sections.set('m1', gone); state.kept.add('m1');
  state.only = row => row.body === 'Words 1';
  assert.equal(drawn(list, 'm1'), true, 'the old drawn index holds the retiring body');
  const rows = new Map([['m1', { observer: { disconnect: () => events.push('reply-observer') }, ui: { dispose: () => events.push('reply-ui'), root: { remove() {} } } }]]);
  const replies = { rows, loads: new Map(), queue: new Map(), closed: new Set(['m1']), retire: CardReplies.prototype.retire };
  const env = { windowEvictions: new Set(), messageEntries: new Map([['m1', gone], ['m2', kept]]), newAbove: new Set(['m1']), coldArrivals: null,
    registry: { cards: new Map([['m1', { source: { body: 'retire me' } }]]), current: null, sessions: new Map([['original', { editor: writing }]]) },
    dropCardDocuments: () => events.push('documents'), dropCardImages: () => events.push('images'), cardScroll: { forget: id => events.push('scroll-' + id) }, cardIn: node => node,
    cardObserver: { unobserve: () => events.push('observer') }, middleObserver: { unobserve: () => events.push('middle') }, halfShown: new Set([1]), atMiddle: new Set([1]), openedIds: new Set(['m1']),
    cardReplies: replies, messageChanges: { hidden: new Map([['m1', 1]]) }, questionStates: { closed: new Map(), removed: new Set() },
    views: { messages: new Map([['m2', item(2)]]), windowRoots: new Set(), windowHints: new Map() },
    anchorHold: { arrivals: new Map([[gone, item(1)]]), cardSet: new Set([gone]), backward: new Set([gone]), held: [gone] },
    visitNew: new VisitNew('me'), reader: null, messageEdit: null, forgetStackMessages, $: () => list,
    stackFeed: { forgetMessages: ids => events.push(['feed', [...ids]]) } };
  const ports = appFunctions('function queueWindowEvictions', 'async function readWindowGap', env,
    '{ queueWindowEvictions, releaseWindowReferences, state: () => ({ coldArrivals, anchorHold }) }');
  ports.queueWindowEvictions(['m1']); ports.releaseWindowReferences();
  assert.equal(env.messageEntries.has('m1'), false); assert.equal(env.messageEntries.get('m2'), kept); assert.equal(gone.isConnected, false);
  assert.equal(env.registry.cards.size, 0); assert.equal(rows.size, 0); assert.equal(state.stacks.length, 0); assert.equal(state.kept.size, 0);
  for (const event of ['documents', 'images', 'scroll-m1', 'observer', 'middle', 'reply-observer', 'reply-ui']) assert.ok(events.includes(event), event);
  assert.equal(ports.state().anchorHold, null); assert.deepEqual(ports.state().coldArrivals, { before: 2, after: 0 });
  assert.equal(drawn(list, 'm1'), false, 'disposal immediately replaces the index before any arrange');
  assert.deepEqual(writing, original); assert.equal(env.registry.sessions.get('original').editor, writing);
});

test('1247 focus, edit, Reader, held press and exact placing receipt consume protection; old confirmed history does not', () => {
  const entry = { dataset: { seq: '1' }, contains: active => active === 'field' };
  const env = { windowTargets: new Set(['target']), document: { activeElement: 'field' }, messageEntries: new Map([['m1', entry]]), halfShown: new Set(), atMiddle: new Set(), pressHold: { down: false },
    reader: { source: { source_ref: { kind: 'message', id: 'reader' } } }, registry: { current: null, sessions: new Map([['reply', { editor: { submissions: [
      { id: 'placing', status: 'confirmed', receipt: { result: { message_id: 'placed' } } }, { id: 'old', status: 'confirmed', receipt: { result: { message_id: 'old-sent' } } }, { id: 'unknown', status: 'unknown' }] } }]]) },
    messageEdit: { id: 'edit' }, menu: null, views: { messages: new Map([['m1', item(1)]]) }, listActAnchor: null, anchorHold: null,
    pendingSendCard: id => id === 'placing' };
  const getOptions = appFunctions('function topicWindowOptions', 'function queueWindowEvictions', env, 'topicWindowOptions');
  const options = getOptions();
  assert.deepEqual([...options.pins], ['target', 'm1', 'reader', 'edit', 'placed']); assert.equal(options.budget, 298);
  assert.equal(options.pins.has('old-sent'), false);
  const other = { dataset: { id: 'm2', seq: '2' }, contains: () => false }; env.messageEntries.set('m2', other);
  env.pressHold.down = true; assert.ok(getOptions().pins.has('m2'), 'held pointer press protects its existing DOM');
  env.pressHold.down = false; env.document.getSelection = () => ({ isCollapsed: false, rangeCount: 1,
    getRangeAt: () => ({ intersectsNode: entry => entry === other }) });
  assert.ok(getOptions().pins.has('m2'), 'a dragged text range protects every intersected card');
});

test('1247 pending reply placement survives window pressure; actual adoption hands protection to focused canonical content', () => {
  const r = renderer799('person'), doc = r.list.ownerDocument;
  r.add([item(1), { ...item(2), reply_to: 'm1' }]);
  const submission = { id: 'local-A', sendOperationId: 'send-A', presentPending: true, topicId: 't', status: 'unknown',
    snapshot: { body: 'Exact A', reply_to: 'm2', attachments: [] } };
  const editor = { context: { instanceId: 'i', actor: 'person' }, submissions: [submission], draft: { body: 'Later B', attachments: ['image-B'] } };
  const oldDocument = globalThis.document; globalThis.document = doc;
  try {
    const parent = r.list.querySelector('[data-id=m2]');
    const destination = parent.closest('.reply-stack').querySelector(':scope > .stack-replies');
    paintPendingSends(r.list, [editor], { topicId: 't', target: () => destination });
    const local = r.list.querySelector('[data-pending-send]'), words = local.querySelector('.message-preview');
    assert.equal(local.parentElement, destination, 'local reply uses its retained dossier destination');
    const image = doc.createElement('img'); local.append(image);
    const entries = new Map([['m1', r.list.querySelector('[data-id=m1]')], ['m2', parent]]);
    const env = { windowTargets: new Set(), document: doc, messageEntries: entries, halfShown: new Set(), atMiddle: new Set(), pressHold: { down: false },
      reader: null, registry: { cards: new Map(), current: null, sessions: new Map([['writing', { editor }]]) }, messageEdit: null, menu: null,
      views: null, listActAnchor: null, anchorHold: null, pendingSendCard: id => r.list.querySelectorAll('[data-pending-send]').find(card => card.dataset.pendingSend === id) };
    Object.assign(env, { windowEvictions: new Set(), newAbove: new Set(), coldArrivals: null, halfShown: new Set(), atMiddle: new Set(), openedIds: new Set(),
      dropCardDocuments: entry => assert.notEqual(entry, local), dropCardImages: entry => assert.notEqual(entry, local), cardScroll: null, cardIn: entry => entry,
      cardObserver: null, middleObserver: null, cardReplies: null, messageChanges: null, questionStates: null, visitNew: null, forgetStackMessages, $: () => r.list, stackFeed: null });
    // The options closure reads its actual views owner; it is installed after construction.
    const views = new TopicViews({ instanceId: 'i', topicId: 't', window: () => options() }); env.views = views;
    const options = appFunctions('function topicWindowOptions', 'function queueWindowEvictions', env, 'topicWindowOptions');
    const retirement = appFunctions('function queueWindowEvictions', 'async function readWindowGap', env, '{ queueWindowEvictions, releaseWindowReferences }');
    views.evicted = ids => retirement.queueWindowEvictions(ids);
    const initial = page(1, 300); initial.items[1].reply_to = 'm1'; views.messagesPage(initial, { initial: true });
    assert.ok(options().pins.has('m2'), 'pending reply keeps its admitted placement parent and containing dossier');
    assert.ok(options().pins.has('m1'), 'pending reply also protects the actual displayed section head');
    views.messagesPage(page(301, 330), { live: true, cursor: 300 });
    retirement.releaseWindowReferences();
    assert.ok(views.messages.has('m2')); assert.ok(views.messages.has('m1')); assert.equal(views.messages.size, 300);
    assert.equal(local.isConnected, true); assert.equal(local.querySelector('.message-preview'), words); assert.equal(image.isConnected, true);
    submission.status = 'confirmed'; submission.receipt = { instance_id: 'i', operation_id: 'send-A', kind: 'message.send', status: 'committed', recorded: true,
      result: { message_id: 'm331', seq: 331 } };
    assert.ok(options().pins.has('m331'), 'receipt target is protected while its local card still owns placement');
    const canonical = item(331); views.messagesPage({ ...page(331, 331), items: [canonical] }, { live: true, cursor: 330 });
    words.focus();
    const adoption = adoptPendingSend(r.list, [editor], canonical, { topicId: 't' });
    assert.equal(adoption.card, local); assert.equal(adoption.active, words);
    local.dataset.id = canonical.id; local.dataset.seq = String(canonical.seq); entries.set(canonical.id, local);
    // Canonical placement moves the adopted card out of its old parent dossier.
    r.list.insertBefore(local, null);
    assert.equal(options().pins.has('m2'), false, 'settled history no longer pins the old placement parent');
    assert.ok(options().pins.has(canonical.id), 'focused adopted content uses the canonical focus owner');
    views.messagesPage(page(332, 660), { live: true, cursor: 331 });
    retirement.releaseWindowReferences();
    // Draw the actual admitted cards represented by this small DOM fixture.
    arrangeStacks(r.list, new Map([...views.messages].filter(([id]) => entries.has(id))), { doc, viewer: 'person' });
    assert.ok(views.messages.has(canonical.id)); assert.equal(views.messages.size, 300);
    assert.equal(local.querySelector('.message-preview'), words); assert.equal(image.isConnected, true); assert.equal(doc.activeElement, words);
    assert.deepEqual(editor.draft, { body: 'Later B', attachments: ['image-B'] }); assert.equal(submission.sendOperationId, 'send-A');
    doc.activeElement = null; views.trimWindow(); assert.equal(options().pins.has(canonical.id), false, 'old unfocused sent history is ordinary cache data');
  } finally { globalThis.document = oldDocument; }
});

test('1247 explicit gap navigation survives passive turnover; pointer, key, wheel and touch cancel late focus/admission', async () => {
  for (const gesture of [null, 'pointerdown', 'keydown', 'wheel', 'touchstart']) {
    const cancelled = gesture !== null;
    let answer, focused = null, applied = 0, released = 0;
    const views = new TopicViews({ instanceId: 'i', topicId: 't', window: () => ({ budget: 30 }) });
    views.messagesPage(page(61, 90, 61), { initial: true });
    const realPage = views.messagesPage.bind(views); views.messagesPage = (...args) => { ++applied; return realPage(...args); };
    const registry = { generation: 1, disposed: false, cleanup: { foreground: () => ({ read: act => act({}), release: () => { ++released; } }) } };
    const env = { retired: false, topicUnavailable: false, authorityReviewPending: () => false, views, topic: { id: 't' }, registry,
      windowReadSerial: 0, listAccessEpoch: 1, windowTargets: new Set(), bootstrap: { instance_id: 'i' }, checkedView: value => value,
      api: { view: (_name, args) => { assert.deepEqual(args, { topic_id: 't', audience: 'all', direction: 'before', cursor: 61, limit: 30 }); return new Promise(resolve => { answer = resolve; }); } },
      coldArrivals: null, landOn: id => ({ focus: () => { focused = id; } }), paintWindowGaps() {} };
    const ports = appFunctions('async function readWindowGap', 'function paintWindowGaps', env, '{ readWindowGap, gesture: () => ++windowReadSerial }');
    const loading = ports.readWindowGap({ before: 61, after: 0 });
    realPage(page(91, 120), { live: true, cursor: 90 });
    if (cancelled) ports.gesture();
    answer(page(31, 60, 31)); assert.equal(await loading, !cancelled);
    assert.equal(applied, cancelled ? 0 : 1); assert.equal(focused, cancelled ? null : 'm60'); assert.equal(released, 1);
    assert.equal(views.messages.has('m60'), !cancelled); assert.equal(env.windowTargets.size, 0);
  }
});

test('1247 gap buttons activate explicit reads and retain their nodes across unchanged paints', () => {
  const doc = miniDocument(), list = doc.byId('messages'), parent = doc.byId('main'), reads = [];
  const node = (tag, words) => {
    const value = doc.createElement(tag); value.textContent = words ?? '';
    Object.defineProperty(value, 'parentElement', { get: () => value.parent }); return value;
  };
  Object.defineProperty(list, 'parentElement', { get: () => list.parent }); parent.append(list); list.after = value => parent.append(value);
  const env = { views: { windowOptions() {}, windowGaps: [{ before: 61, after: 1 }], windowPressure: null }, windowGapHost: null,
    coldArrivals: null, node, $: () => list, topicUnavailable: false, run: act => act(), readWindowGap: gap => reads.push(gap) };
  const ports = appFunctions('function paintWindowGaps', 'const movedDossiers', env, '{ paintWindowGaps, host: () => windowGapHost }');
  ports.paintWindowGaps(); const host = ports.host(), button = host.children[0];
  assert.equal(button.type, 'button'); assert.equal(host.getAttribute('aria-label'), 'More topic messages');
  button.onclick(); assert.deepEqual(reads, [{ before: 61, after: 1 }]);
  ports.paintWindowGaps(); assert.equal(ports.host(), host); assert.equal(host.children[0], button); assert.equal(parent.children.length, 2);
});

test('1247 root reservations stop supplemental admission when newly split protected dossiers cannot all fit', async () => {
  let roots = false;
  const views = new TopicViews({ instanceId: 'i', topicId: 't', window: () => ({ budget: 30, pins: roots ? Array.from({ length: 30 }, (_, n) => 'm' + (n + 1)) : [] }) });
  views.messagesPage(page(1, 30), { initial: true }); roots = true;
  for (const row of views.messages.values()) {
    row.reply_to = 'root-' + row.id; row.stack_position = { root_id: row.reply_to, at: { acts: 1 } };
  }
  views.trimWindow(); assert.ok(views.windowPressure);
  let reads = 0; const heads = new DossierHeads({ topicId: 't', read: async () => { ++reads; throw Error('unreserved head'); } });
  heads.sync(views.messages, views.removals, views.windowRoots); await heads.readTail;
  assert.equal(reads, 0); assert.equal(heads.records.size, 0); assert.equal(views.messages.size, 30);
});

test('1247 compact terminal and revision knowledge shares 256 hints and fences reads after that knowledge expires', async () => {
  const views = new TopicViews({ instanceId: 'i', topicId: 't', window: () => ({ budget: 30 }) });
  views.messagesPage(page(1, 30), { initial: true });
  const windowReadStart = views.windowKnowledge;
  for (let n = 1000; n < 1600; n++) views.learnRemoval('gone' + n, { kind: 'unsent' });
  assert.equal(views.windowHints.size, 256); assert.equal(views.removals.size, 256);
  assert.equal(views.messagesPage(page(31, 60), { live: true, cursor: 30, windowReadStart }), false);
  assert.equal(views.newest, 30);
  await views.refresh('edit:m900', 4, () => { throw Error('an unloaded edit needs no full source cache'); });
  assert.throws(() => views.messagesPage(page(900, 900), { anchored: true, cursor: 901 }), { code: 'RESOURCE_NOT_CURRENT' });
  const answer = page(900, 900); Object.assign(answer.items[0], { revision: 4, body: 'Current cold words' });
  assert.equal(views.messagesPage(answer, { anchored: true, cursor: 901 }), true);
  for (const hint of views.windowHints.values()) assert.equal('body' in hint, false);
});

test('1247 acts refresh seeks retained runs and an old held source without walking 30000 unrelated acts', async () => {
  const views = new TopicViews({ instanceId: 'i', topicId: 't', window: () => ({}) });
  views.messagesPage(page(29971, 30000, 29971), { initial: true }); views.showAlone('m1', 1);
  const reads = [];
  assert.equal(await views.readActs(9, async (name, args) => {
    assert.equal(name, 'message_acts'); reads.push(args);
    const newest = Math.min(30000, (args.cursor ?? 30001) - 1), oldest = Math.max(1, newest - args.limit + 1);
    const items = Array.from({ length: newest - oldest + 1 }, (_, n) => ({ message_id: 'm' + (newest - n), seq: newest - n,
      acts: { star_revision: 9, starred: true } }));
    return { instance_id: 'i', topic_id: 't', version: 9, items, next_cursor: oldest === 1 ? null : oldest };
  }, () => true), true);
  assert.equal(reads.length, 2, 'one recent run plus one exact old held source');
  assert.deepEqual(reads.map(read => read.cursor), [30001, 2]);
  assert.equal(views.alone.acts.starred, true); assert.equal(views.messages.get('m29971').acts.starred, true);
});

test('1247 quoted revision and pending edit caches retire when their final loaded reply leaves', () => {
  const views = new TopicViews({ instanceId: 'i', topicId: 't', window: () => ({ budget: 30 }) });
  for (let n = 0; n < 40; n++) {
    const answer = page(n * 30 + 1, n * 30 + 30);
    answer.items[0].reply_to = 'parent-' + n; answer.items[0].reply_to_excerpt = 'Old';
    views.messagesPage(answer, n ? { live: true, cursor: n * 30 } : { initial: true });
    views.learnQuoted({ ...item(2000 + n), id: 'parent-' + n, revision: 2, body: 'New quoted words' });
    assert.equal(views.quoted.size, 1); assert.equal(views.edits.size, 1);
  }
  assert.equal(views.messages.get('m1171').reply_to_excerpt, 'New quoted words');
});

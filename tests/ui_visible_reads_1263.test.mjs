import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { seenRanges } from '../web/card-reading.mjs';
import { ReadThrough } from '../web/read-through.mjs';
import { TopicViews } from '../web/topic-views.mjs';

const app = readFileSync(new URL('../web/app.mjs', import.meta.url), 'utf8');
const cut = (start, end) => { const a = app.indexOf(start), b = app.indexOf(end, a); assert.ok(a >= 0 && b > a); return app.slice(a, b); };
const reading = cut('function readingAllowed()', 'function revokeMedia()');
const setup = cut('  readThrough = new ReadThrough(', "  document.addEventListener('visibilitychange', noteRead);");
const release = cut('function releaseWindowReferences()', 'async function readWindowGap(');
const registration = app.split('\n').findIndex(line => line.trim() === 'messageEntries.set(item.id, entry);');
assert.ok(registration > 0);
const register = app.split('\n').slice(registration, registration + 2).join('\n');
const dispose = cut("window.addEventListener('pagehide', () => { anchorWatch?.stop();", '// A start that fails');
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };

function fixture(count = 3) {
  const nodes = [], records = new Map(), entries = new Map(), observers = [], envelopes = [], sighted = [], opened = [], events = {};
  let walks = 0, visits = 0, geometry = 0, operations = 0;
  const list = { hidden: false }, main = { inert: false };
  const document = { visibilityState: 'visible', focused: true, hasFocus() { return this.focused; } };
  let receipt = { recorded: true, status: 'committed', result: { acknowledged: 1 } };
  const context = { retired: false, readingStopped: false, unreadLandingBusy: false, topicUnavailable: false, denied: false,
    laidOut: true, innerHeight: 800, halfShown: new Set(), atMiddle: new Set(), seenEntries: new Map(),
    bootstrap: { instance_id: 'fixture1263', actor: 'viewer', authority: { authority_id: 'a', authority_epoch: 'e' } },
    topic: { id: 't' }, registry: { disposed: false, cards: new Map(), current: null }, review: { open: false },
    authorityReviewPending: () => context.denied, document,
    $: () => list, entries: () => { walks++; return { *[Symbol.iterator]() { for (const entry of nodes) { visits++; yield entry; } } }; },
    messageEntries: entries, views: { messages: records, runOf: id => records.get(id)?.run ?? 'run',
      opened: seq => opened.push(seq), sighted: (...args) => sighted.push(args), windowRoots: new Set(), windowHints: new Map() },
    newAbove: new Set(), paintNewAbove() {}, openedHere: id => opened.push(id), seenRanges, ReadThrough,
    crypto: { randomUUID: () => 'operation-' + ++operations }, api: { command: async envelope => { envelopes.push(envelope); return receipt; } },
    IntersectionObserver: class { constructor(callback, options) { this.callback = callback; this.options = options; this.targets = new Set(); observers.push(this); }
      observe(entry) { this.targets.add(entry); } unobserve(entry) { this.targets.delete(entry); } disconnect() { this.targets.clear(); } },
    window: { addEventListener: (name, fn) => { events[name] = fn; } }, anchorWatch: null, live: null, unheard() {}, stackFeed: null, stopDays() {},
    windowEvictions: new Set(), coldArrivals: null, openedIds: new Set(), dropCardDocuments() {}, dropCardImages() {}, cardScroll: null,
    cardIn: x => x, cardReplies: null, messageChanges: null, questionStates: null, visitNew: null,
    reader: null, messageEdit: null, forgetStackMessages() {}, anchorHold: null,
  };
  context.$ = id => id === 'main' ? main : list;
  const actions = vm.runInNewContext(reading + setup + release + '\n' + dispose + '\n' +
    '({ noteRead, register: (item, entry) => {' + register + '}, releaseWindowReferences });', context);
  function add(id, seq, extra = {}) {
    const item = { id, seq, topic_id: 't', author_id: 'outside', ...extra }; records.set(id, item);
    const entry = { dataset: { id, seq: String(seq) }, isConnected: true, top: 20, height: 100, hidden: false,
      getBoundingClientRect() { geometry++; return this.hidden ? { top: 0, bottom: 0, height: 0 } : { top: this.top, bottom: this.top + this.height, height: this.height }; },
      remove() { this.isConnected = false; const index = nodes.indexOf(this); if (index >= 0) nodes.splice(index, 1); } };
    nodes.push(entry); actions.register(item, entry); return entry;
  }
  for (let n = 1; n <= count; n++) add('m' + n, n);
  const event = (target, on = true, ratio = on ? 0.5 : 0) => ({ target, isIntersecting: on, intersectionRatio: ratio });
  return { context, actions, nodes, records, entries, observers, envelopes, sighted, opened, list, main, document, add,
    half: (targets, on = true, ratio) => observers[0].callback(targets.map(target => event(target, on, ratio))),
    middle: (targets, on = true) => observers[1].callback(targets.map(target => event(target, on))),
    retire(id) { context.windowEvictions.add(id); records.delete(id); actions.releaseWindowReferences(); },
    dispose() { events.pagehide(); }, receipt(value) { receipt = value; },
    counts: () => ({ walks, visits, geometry }), async flush() { await new Promise(setImmediate); await new Promise(setImmediate); },
  };
}

for (const count of [1, 40, 300]) test(`1263 ${count} retained cards: observer/read processing visits only its current candidates`, async () => {
  const f = fixture(count); f.half([f.nodes[0]]); await f.flush();
  assert.deepEqual(f.counts(), { walks: 0, visits: 0, geometry: 1 });
  assert.deepEqual(f.envelopes.map(e => [e.args.from_seq, e.args.seq]), [[1, 1]]);
  assert.equal(f.observers.length, 2); assert.ok(f.observers.every(o => o.targets.size === count));
  console.log(JSON.stringify({ retained: count, ...f.counts() }));
});

test('1263 half-card and middle channels form a union and a departing channel keeps the other', async () => {
  const f = fixture(); f.half([f.nodes[0]]); f.middle([f.nodes[0]]); f.half([f.nodes[0]], false);
  assert.equal(f.context.seenEntries.size, 1); f.middle([f.nodes[0]], false);
  assert.equal(f.context.seenEntries.size, 0); await f.flush(); assert.equal(f.envelopes.length, 1);
});

test('1263 a tall card crossing the viewport middle is read without reaching half-card ratio', async () => {
  const f = fixture(); f.nodes[0].height = 2000; f.nodes[0].top = -600;
  f.half([f.nodes[0]], true, 0.4); assert.equal(f.sighted.length, 0);
  f.middle([f.nodes[0]]); await f.flush(); assert.equal(f.envelopes.length, 1);
});

test('1263 observer truth is remeasured after scroll, resize, hidden/fold and unrelated repaint', async () => {
  const f = fixture(); f.nodes[0].top = -200; f.half([f.nodes[0]]); assert.equal(f.sighted.length, 0);
  f.nodes[0].top = 20; f.nodes[0].hidden = true; f.actions.noteRead(); assert.equal(f.sighted.length, 0);
  f.nodes[0].hidden = false; f.actions.noteRead(); await f.flush(); assert.equal(f.envelopes.length, 1);
  const before = f.counts().geometry; f.nodes[0].top = 900; f.actions.noteRead();
  assert.equal(f.counts().geometry, before + 1); assert.equal(f.envelopes.length, 1);
});

for (const fault of ['layout', 'unfocused', 'hidden-document', 'inert', 'review', 'hidden-feed', 'landing', 'authority', 'unavailable', 'disposed', 'retired']) test('1263 reading gate: ' + fault, async () => {
  const f = fixture();
  if (fault === 'layout') f.context.laidOut = false;
  if (fault === 'unfocused') f.document.focused = false;
  if (fault === 'hidden-document') f.document.visibilityState = 'hidden';
  if (fault === 'inert') f.main.inert = true;
  if (fault === 'review') f.context.review.open = true;
  if (fault === 'hidden-feed') f.list.hidden = true;
  if (fault === 'landing') f.context.unreadLandingBusy = true;
  if (fault === 'authority') f.context.denied = true;
  if (fault === 'unavailable') f.context.topicUnavailable = true;
  if (fault === 'disposed') f.context.registry.disposed = true;
  if (fault === 'retired') f.context.retired = true;
  f.half([f.nodes[0]]); await f.flush(); assert.equal(f.envelopes.length, 0);
  assert.equal(f.counts().geometry, 0);
});

test('1263 modeled pointer/key/touch observations and focus/visibility return use the same immediate read path', async () => {
  for (const input of ['pointer', 'key', 'touch']) {
    const f = fixture(); f.document.focused = false; f.document.visibilityState = 'hidden'; f.half([f.nodes[0]]); await f.flush(); assert.equal(f.envelopes.length, 0, input);
    f.document.focused = true; f.actions.noteRead(); await f.flush(); assert.equal(f.envelopes.length, 0, input);
    f.document.visibilityState = 'visible'; f.actions.noteRead(); await f.flush(); assert.equal(f.envelopes.length, 1, input);
    assert.deepEqual(JSON.parse(JSON.stringify(f.envelopes[0].expected.authority)), { authority_id: 'a', authority_epoch: 'e' });
  }
});

test('1263 Reader owns its exact message and unavailable/foreign/Notebook sources read no feed card', async () => {
  for (const kind of ['message', 'unavailable', 'foreign', 'memory']) {
    const f = fixture(); const source = { source_ref: { kind: kind === 'memory' ? 'memory' : 'message', id: 'm2' }, topic_id: kind === 'foreign' ? 'other' : 't', author: 'outside', seq: 2 };
    f.context.registry.current = { source, sourceUnavailable: kind === 'unavailable' }; f.half([f.nodes[0]]); await f.flush();
    assert.deepEqual(f.envelopes.map(e => e.args.seq), kind === 'message' ? [2] : []);
    assert.equal(f.counts().geometry, 0);
  }
});

test('1263 loaded hidden messages and run gaps break read ranges; own messages do not bridge gaps', async () => {
  const f = fixture(5); f.records.get('m2').run = 'other'; f.records.get('m3').author_id = 'viewer';
  f.half([f.nodes[0], f.nodes[2], f.nodes[4]]); await f.flush();
  assert.deepEqual(f.envelopes.map(e => [e.args.from_seq, e.args.seq]), [[1, 1], [5, 5]]);
});

test('1263 stale connected replacement and wrong-topic/current-sequence entries cannot authorize reading', async () => {
  for (const fault of ['replacement', 'topic', 'sequence']) {
    const f = fixture(); f.document.focused = false; const old = f.nodes[0]; f.half([old]);
    if (fault === 'replacement') f.add('m1', 1);
    if (fault === 'topic') f.records.get('m1').topic_id = 'other';
    if (fault === 'sequence') f.records.get('m1').seq = 99;
    f.document.focused = true; f.actions.noteRead(); await f.flush(); assert.equal(f.envelopes.length, 0, fault);
  }
});

test('1263 eviction forgets both observations and candidates; late old callbacks do not enroll replacements', async () => {
  const f = fixture(); f.document.focused = false; const old = f.nodes[0]; f.half([old]); f.retire('m1');
  assert.equal(f.context.seenEntries.size, 0); assert.ok(f.observers.every(o => !o.targets.has(old)));
  const replacement = f.add('m1', 1); f.document.focused = true; f.half([old]); await f.flush();
  assert.equal(f.envelopes.length, 0); f.half([replacement]); await f.flush(); assert.equal(f.envelopes.length, 1);
});

test('1263 page disposal clears candidates, disconnects both observers and ignores late callbacks', async () => {
  const f = fixture(); f.document.focused = false; f.half([f.nodes[0]]); f.dispose();
  assert.equal(f.context.seenEntries.size, 0); assert.ok(f.observers.every(o => o.targets.size === 0));
  f.document.focused = true; f.half([f.nodes[0]]); f.actions.noteRead(); await f.flush();
  assert.equal(f.context.seenEntries.size, 0); assert.equal(f.envelopes.length, 0);
});

test('1263 repeated actual window retirement bounds candidate and observer references', () => {
  const f = fixture(2); f.document.focused = false;
  for (let seq = 3; seq <= 502; seq++) {
    const entry = f.add('m' + seq, seq); f.half([entry]);
    assert.equal(f.context.seenEntries.size, 1); f.retire('m' + seq);
    assert.equal(f.context.seenEntries.size, 0); assert.equal(f.context.halfShown.size, 0);
    assert.ok(f.observers.every(observer => observer.targets.size === 2));
    assert.equal(f.records.size, 2); assert.equal(f.entries.size, 2);
  }
});

test('1263 unknown reports retain actual New-line truth and only recorded receipts confirm ReadThrough', async () => {
  const f = fixture(); const views = new TopicViews({ instanceId: 'fixture1263', topicId: 't', reader: 'viewer', paint() {}, invalidate() {} });
  views.line = { id: 'm1', seq: 1 }; views.oldestUnread = { id: 'm1', seq: 1 }; views.sightHeld = false;
  f.context.views.sighted = (...args) => { f.sighted.push(args); views.sighted(...args); };
  f.receipt(undefined); f.half([f.nodes[0]]); await f.flush();
  assert.equal(f.context.readThrough.topics.get('t').confirmed.length, 0);
  assert.equal(views.sightHeld, true); assert.equal(views.held, true);
  f.receipt({ recorded: true, status: 'committed', result: { acknowledged: 1 } }); f.actions.noteRead(); await f.flush();
  assert.equal(f.context.readThrough.topics.get('t').confirmed.length, 1); assert.equal(views.held, true);
  views.oldestUnread = null; views.acted(); assert.equal(views.held, false);
});

test('1263 refused unrecorded report and an in-flight report preserve original operation and retry ownership', async () => {
  const f = fixture(); const gate = deferred(); f.receipt(gate.promise); f.half([f.nodes[0]]); await f.flush();
  f.half([f.nodes[0]]); await f.flush(); assert.equal(f.envelopes.length, 1);
  gate.resolve({ recorded: false, status: 'refused' }); await f.flush();
  f.receipt({ recorded: true, status: 'committed', result: { acknowledged: 0 } }); f.actions.noteRead(); await f.flush();
  assert.equal(f.envelopes.length, 2); assert.equal(f.context.readThrough.topics.get('t').confirmed.length, 1);
});

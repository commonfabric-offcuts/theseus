import test from 'node:test';
import assert from 'node:assert/strict';
import { ActionTimings, timingCall } from '../web/action-timing.mjs';
import { Api } from '../web/api.mjs';
import { RecoveryJournal, openJournal } from '../web/journal.mjs';
import { Editor } from '../web/editor.mjs';
import { Reactions } from '../web/reactions.mjs';
import { healthLines } from '../web/health.mjs';

const flush = async () => { for (let n = 0; n < 12; n++) await Promise.resolve(); };
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
function fixture(extra = {}) {
  let clock = 0, serial = 0;
  const timers = new Map(), frames = new Map(), sent = [];
  const owner = new ActionTimings({ instanceId: 'instance', build: 'loaded-build', uuid: () => `id-${++serial}`,
    now: () => clock, wall: () => 1000000 + clock, Observer: null,
    timers: { setTimeout: (fn, ms) => { const id = ++serial; timers.set(id, { fn, ms }); return id; }, clearTimeout: id => timers.delete(id) },
    frame: fn => { const id = ++serial; frames.set(id, fn); return id; }, cancelFrame: id => frames.delete(id),
    report: async (records, operation_id) => { sent.push({ records, operation_id }); return { instance_id: 'instance', kind: 'performance.record', operation_id, recorded: true, status: 'committed' }; },
    burden: () => ({ loaded_messages: 30, retained_messages: 300, rendered_cards: 24, window_limit: 300 }), ...extra });
  return { owner, timers, frames, sent, advance: ms => { clock += ms; }, frame: () => { const callbacks = [...frames.values()]; frames.clear(); callbacks.forEach(fn => fn()); } };
}

test('overlapping actions retain their operations, DOM endpoints and two later frame callbacks', async () => {
  const f = fixture(), a = f.owner.begin('thumb'), b = f.owner.begin('send');
  a.link('thumb-operation'); b.link('send-operation', 'submission');
  f.advance(12); a.endpoint('thumb_pending_dom'); b.endpoint('send_pending_dom'); a.finish();
  assert.equal(a.row.outcome, 'running'); assert.equal(b.row.outcome, 'running');
  f.advance(4); f.frame(); assert.equal(a.row.outcome, 'running');
  f.advance(4); f.frame(); assert.equal(a.row.outcome, 'complete'); assert.equal(b.row.outcome, 'running');
  assert.deepEqual(a.row.operations, ['thumb-operation']); assert.deepEqual(b.row.operations, ['send-operation']);
  assert.deepEqual(a.row.phases.filter(p => p.name.startsWith('frame')).map(p => [p.name, p.request, p.at_ms]), [['frame1', 'thumb_pending_dom', 16], ['frame2', 'thumb_pending_dom', 20]]);
  await f.owner.flush(); assert.equal(f.sent[0].records.length, 2);
  assert.equal(f.sent[0].records[1].build, 'loaded-build'); assert.equal(f.sent[0].records[1].burden.retained_messages, 300);
});

test('a synchronous report failure retries immutable payload and operation; later observations stay dirty', async () => {
  const calls = []; let fail = true;
  const f = fixture({ report: (records, operation_id) => { calls.push({ records, operation_id }); if (fail) throw Error('offline'); return { instance_id: 'instance', operation_id, kind: 'performance.record', recorded: true, status: 'committed' }; } });
  const a = f.owner.begin('send');
  assert.equal(await f.owner.flush(), false); assert.equal(f.owner.reporting, null);
  a.link('later-operation'); a.finish(); fail = false;
  assert.equal(await f.owner.flush(), true); assert.deepEqual(calls[1], calls[0]);
  assert.equal(f.owner.dirty.size, 1, 'newer sequence is still owed');
  await f.owner.flush(); assert.notEqual(calls[2].operation_id, calls[0].operation_id);
  assert.deepEqual(calls[2].records[0].operations, ['later-operation']); assert.equal(calls[2].records[0].report_failures, 1);
});

test('mismatched receipt is not reporting success and concurrent flush shares one flight', async () => {
  const gate = deferred(); let calls = 0;
  const f = fixture({ report: () => { calls++; return gate.promise; } });
  f.owner.begin('send'); const first = f.owner.flush(), second = f.owner.flush(); await flush(); assert.equal(calls, 1);
  gate.resolve({ instance_id: 'foreign', operation_id: f.owner.flight.id, kind: 'performance.record', recorded: true, status: 'committed' });
  assert.equal(await first, false); assert.equal(await second, false); assert.equal(f.owner.dirty.size, 1);
});

test('retirement cancels old frames and a missing frame times out rather than completing', () => {
  const f = fixture(), a = f.owner.begin('reply_open'); a.endpoint('reply_focused');
  const old = [...f.frames.values()][0]; a.retire(); old();
  assert.equal(a.row.outcome, 'incomplete'); assert.equal(a.row.failure, 'retired');
  assert.equal(a.row.phases.some(p => p.name === 'frame1'), false);
  const b = f.owner.begin('send'); b.endpoint('send_canonical_dom'); b.finish();
  const timeout = [...f.timers.values()].find(t => t.ms === 60000); timeout.fn();
  assert.equal(b.row.outcome, 'incomplete'); assert.equal(b.row.failure, 'timeout');
  f.frame(); f.frame(); assert.equal(b.row.outcome, 'incomplete', 'late frames cannot turn timeout into completion');
});

test('local cap, phase omission and batch cap are explicit and retain endpoints', async () => {
  const f = fixture(); for (let n = 0; n < 130; n++) f.owner.begin('thumb');
  assert.equal(f.owner.records.size, 128); assert.equal(f.owner.localDropped, 2);
  const trace = [...f.owner.records.values()].at(-1);
  for (let n = 0; n < 60; n++) trace.mark('response_decoded', { request: `request-${n}`, operation: `operation-${n}` });
  trace.endpoint('thumb_confirmed_dom'); trace.finish(); f.frame(); f.frame();
  const record = trace.snapshot(); assert.ok(record.dropped_phases > 0); assert.equal(record.lost_records, 2);
  assert.ok(record.phases.some(p => p.name === 'thumb_confirmed_dom')); assert.ok(Buffer.byteLength(JSON.stringify(record)) <= 4096);
  await f.owner.flush(); assert.equal(f.sent[0].records.length, 16);
});

test('idle windows and long tasks report support, gaps and overlap without CPU claims', () => {
  let observer;
  class Observer { constructor(callback) { this.callback = callback; observer = this; } observe() {} disconnect() {} }
  const f = fixture({ Observer }); f.owner.observe(); const a = f.owner.begin('send');
  f.advance(5500); const sample = [...f.timers.values()].find(t => t.ms === 5000); sample.fn();
  observer.callback({ getEntries: () => [{ startTime: 1, duration: 100 }] });
  assert.equal(a.row.support.long_tasks, true); assert.equal(a.row.long_tasks.count, 1); assert.equal(a.row.long_tasks.duration_ms, 100);
  const idle = [...f.owner.records.values()].find(t => t.row.kind === 'idle'); assert.equal(idle.row.idle.maximum_gap_ms, 500);
  assert.equal(idle.row.support.frames, true); assert.equal(Object.hasOwn(idle.row, 'cpu'), false);
});

test('observer and recorder failures cannot refuse an owner using timingCall', () => {
  assert.equal(timingCall({ mark() { throw Error('diagnostics'); } }, 'mark', 'input'), undefined);
  const f = fixture({ Observer: class { observe() { throw Error('unsupported'); } disconnect() {} } });
  f.owner.observe(); assert.equal(f.owner.support.long_tasks, false);
});

test('actual Api attempts preserve one operation through busy retry and separate each request and clock', async () => {
  const f = fixture(), trace = f.owner.begin('send'), calls = []; let serial = 0;
  const api = new Api('secret', async (url, options) => {
    calls.push({ url, body: JSON.parse(options.body) }); f.advance(5);
    return new Response(JSON.stringify(++serial === 1 ? { recorded: false, error: { code: 'SERVER_BUSY' } } : { recorded: true, status: 'committed' }), { headers: { 'Server-Timing': 'aim_admission;dur=1.5, aim_store;dur=3.25' } });
  }, async () => { f.advance(20); });
  const envelope = { operation_id: 'same-operation', kind: 'message.send', args: {} };
  await api.command(envelope, { timing: trace });
  assert.equal(calls.length, 2); assert.deepEqual(calls[0].body, calls[1].body); assert.notEqual(calls[0].url, calls[1].url);
  assert.deepEqual(trace.row.operations, ['same-operation']); assert.equal(trace.row.counts.requests, 2); assert.equal(trace.row.counts.retries, 1);
  assert.equal(trace.row.phases.filter(p => p.name === 'response_decoded').length, 2);
  assert.ok(trace.row.phases.some(p => p.name === 'server_store' && p.clock === 'server' && p.at_ms === 0 && p.duration_ms === 3.25));
  assert.ok(trace.row.phases.some(p => p.name === 'api_busy_wait' && p.duration_ms === 20));
  assert.doesNotMatch(JSON.stringify(trace.snapshot()), /secret|api\/command/);
});

test('journal queue wait ends at admission; skipped writes are not backend puts', async () => {
  const f = fixture(), a = f.owner.begin('send'), b = f.owner.begin('send'), gate = deferred(), rows = [];
  const journal = new RecoveryJournal({ put: async row => { rows.push(row); if (rows.length === 1) await gate.promise; } }, 'tab');
  const snapshot = { key: 'key', context: { instanceId: 'instance', actor: 'person' }, draft: {} };
  const first = journal.save(snapshot, () => false, a); await flush();
  const second = journal.save(snapshot, () => false, b); f.advance(30); await flush(); assert.equal(b.row.counts.backend_puts, 0);
  gate.resolve(); await first; await second;
  assert.equal(b.row.counts.backend_puts, 1); assert.ok(b.row.phases.some(p => p.name === 'journal_queue' && p.duration_ms === 30));
  await journal.save(snapshot, () => true, b); assert.equal(b.row.counts.backend_puts, 1);
  assert.doesNotMatch(JSON.stringify(rows), /elapsed_ms|overhead_ms/, 'diagnostics never enter durable editor writing');
});

test('actual IndexedDB put success is distinct from the transaction completion still awaited by save', async t => {
  const savedNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator'), savedIDB = globalThis.indexedDB;
  const holds = new Map();
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { locks: { request: (name, _options, callback) => { holds.set(name, true); return Promise.resolve(callback({ name })).finally(() => holds.delete(name)); }, query: async () => ({ held: [...holds.keys()].map(name => ({ name })) }) } } });
  let tx, write;
  globalThis.indexedDB = { open: () => { const request = {}; queueMicrotask(() => { request.result = { close() {}, transaction: () => {
    tx = { durability: 'strict', objectStore: () => ({ get: () => { const get = {}; queueMicrotask(() => get.onsuccess({ target: { result: undefined } })); return get; }, put: () => { write = {}; return write; } }), abort() { this.onabort(); } }; return tx;
  } }; request.onsuccess(); }); return request; } };
  t.after(() => { Object.defineProperty(globalThis, 'navigator', savedNavigator); globalThis.indexedDB = savedIDB; });
  const f = fixture(), trace = f.owner.begin('send');
  const journal = await openJournal({ instanceId: 'instance', actor: 'person', win: { addEventListener() {} } }); t.after(() => journal.close());
  const editor = new Editor({ instanceId: 'instance', actor: 'person', sourceRef: { kind: 'topic', id: 'topic' }, topicId: 'topic', kind: 'reply' }, { id: 'draft', generation: 'generation', revision: 0, body: 'private writing' });
  let settled = false; const saving = journal.save(editor.snapshot(), () => false, trace).then(() => { settled = true; }); await flush();
  assert.ok(write); assert.equal(trace.row.counts.journal_writes, 1); assert.equal(trace.row.counts.journal_transactions, 1);
  f.advance(10); write.onsuccess(); await flush(); assert.equal(settled, false);
  assert.ok(trace.row.phases.some(p => p.name === 'journal_put' && p.duration_ms === 10)); assert.equal(trace.row.phases.some(p => p.name === 'journal_transaction'), false);
  f.advance(5); tx.oncomplete(); await saving; assert.equal(settled, true);
  assert.ok(trace.row.phases.some(p => p.name === 'journal_transaction' && p.duration_ms === 15));
});

test('thumb pending and learned DOM owners get the same explicit context; failed read stays incomplete', async () => {
  for (const readFailed of [false, true]) {
    const f = fixture(), trace = f.owner.begin('thumb'), contexts = [];
    const reactions = new Reactions({ instanceId: 'instance', authority: () => ({ authority_id: 'authority', authority_epoch: 'epoch' }),
      api: { command: async (_envelope, options) => { contexts.push(options.timing); return { status: 'committed', result: {} }; }, view: async (_name, _args, options) => { contexts.push(options.timing); if (readFailed) throw Error('read failed'); return { instance_id: 'instance', message_id: 'message' }; } },
      changed: (_id, timing, endpoint) => { if (timing) timing.endpoint(endpoint); }, learned() {} });
    await reactions.thumb({ id: 'message', reactions: { version: 0, thumbs: [], answers: [], thumb_revision: 0, answer_revision: 0 } }, true, null, trace);
    f.frame(); f.frame(); assert.deepEqual(contexts, [trace, trace]);
    assert.equal(trace.row.outcome, readFailed ? 'incomplete' : 'complete');
    assert.equal(trace.hasEndpoint('thumb_confirmed_dom'), !readFailed);
  }
});

test('Health exposes incomplete and drop limits alongside own slowest observations', () => {
  const f = fixture(), trace = f.owner.begin('send'); trace.finish('incomplete', 'timeout');
  const row = trace.snapshot(), now = 1000000;
  const line = healthLines({ runner: {}, agents: [], tab_performance: { retained: 1, record_limit: 256, retention_ms: 3600000, window_start_ms: now, window_end_ms: now,
    counts: { complete: 0, failed: 0, incomplete: 1, running: 0 }, cap_dropped: 2, expired: 3, local_lost: 4, report_failures: 5, slowest: [row], unfinished: [row] } }, { now }).find(row => row.key === 'action-timing');
  assert.match(line.summary, /1 recorded/); assert.match(line.details.join(' '), /1 incomplete/); assert.match(line.details.join(' '), /at least 4 local drops/);
  assert.match(line.details.join(' '), /Frame callbacks do not prove pixels/); assert.match(line.details.join(' '), /loaded build loaded-build/);
});

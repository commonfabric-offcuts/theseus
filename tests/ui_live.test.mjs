import test from 'node:test';
import assert from 'node:assert/strict';
import { Live, liveOffered, reloader } from '../web/live.mjs';
import { Freshness } from '../web/freshness.mjs';

const tick = () => new Promise(resolve => setImmediate(resolve));
function clock() {
  let serial = 0;
  const jobs = new Map();
  return { jobs, setTimeout(fn, ms) { jobs.set(++serial, { fn, ms }); return serial; }, clearTimeout(id) { jobs.delete(id); },
    run() { const [[id, job]] = jobs; jobs.delete(id); job.fn(); return job.ms; } };
}
// A WebSocket the test drives: it opens, delivers messages, errors and closes.
function socket(url, protocols) {
  const s = { url, protocols, closed: false, onmessage: null, onclose: null, onerror: null,
    close() { s.closed = true; },
    send(value) { s.onmessage?.({ data: typeof value === 'string' ? value : JSON.stringify(value) }); },
    drop() { s.onclose?.({ code: 1006 }); },
    refuse() { s.onerror?.({}); s.onclose?.({ code: 1006 }); } };
  return s;
}
function fixture({ throws = 0 } = {}) {
  const sockets = [], events = [], times = clock();
  let refusals = throws;
  const live = new Live({ token: 'secret', origin: 'http://127.0.0.1:5192', timers: times, random: () => 0,
    socket: (url, protocols) => { if (refusals-- > 0) throw Error('blocked'); const s = socket(url, protocols); sockets.push(s); return s; } });
  live.listen(event => events.push(event));
  return { live, sockets, events, times };
}

test('only the advertised version 2 WebSocket is used', () => {
  assert.equal(liveOffered({ transport: { live: { version: 2, path: '/api/live', protocol: 'theseus-live.v1' } } }), true);
  for (const transport of [undefined, {}, { live: { version: 1, path: '/api/live' } }, { live: { version: 2, path: '/api/live' } },
    { live: { version: 2, path: '/elsewhere', protocol: 'theseus-live.v1' } }]) {
    assert.equal(liveOffered({ transport }), false);
  }
});

test('each new commit number is announced once, over the page origin, with the session token as a subprotocol', () => {
  const { live, sockets, events } = fixture();
  live.start();
  assert.equal(sockets[0].url, 'ws://127.0.0.1:5192/api/live');
  assert.deepEqual(sockets[0].protocols, ['theseus-live.v1', 'bearer.secret']);
  sockets[0].send({ seq: 4 });
  assert.equal(live.connected, true);
  sockets[0].send({ seq: 4 }); sockets[0].send({ seq: 5 }); sockets[0].send({ seq: 6 });
  assert.deepEqual(events, [{ kind: 'state', state: 'live' }, { kind: 'commit', seq: 4 }, { kind: 'commit', seq: 5 }, { kind: 'commit', seq: 6 }]);
  const secure = new Live({ token: 't', origin: 'https://box.tail.ts.net', socket: url => ({ url }), timers: clock() });
  secure.start();
  assert.equal(secure.current.socket.url, 'wss://box.tail.ts.net/api/live');
});

test('a server that stops reconnects after a second; a feed that ended for another reason backs off', () => {
  const { live, sockets, events, times } = fixture();
  live.start();
  sockets[0].send({ seq: 1 }); sockets[0].send({ end: 'stopped' });
  assert.equal(live.connected, false);
  assert.equal(sockets[0].closed, true);
  assert.deepEqual(events.slice(-1), [{ kind: 'state', state: 'down' }]);
  assert.equal(times.run(), 1000);
  sockets[1].send({ seq: 2 }); sockets[1].send({ end: 'database_moved' });
  assert.equal(times.run(), 1000);
  assert.deepEqual(events.filter(e => e.kind === 'commit').map(e => e.seq), [1, 2]);
});

test('a broken feed is not asked in a loop: each delivered-then-ended socket waits longer', () => {
  const { live, sockets, times } = fixture();
  const waits = [];
  live.start();
  for (let n = 0; n < 3; n++) {
    sockets[n].send({ seq: 3 }); sockets[n].send({ end: 'unconfirmed' });
    waits.push(times.run());
  }
  assert.deepEqual(waits, [1000, 2000, 4000]);
});

test('refused sockets back off to at most thirty seconds; a socket that delivered resets that', () => {
  const { live, sockets, times } = fixture({ throws: 1 });
  const waits = [];
  live.start();
  waits.push(times.run());
  for (let n = 0; n < 6; n++) { sockets[n].refuse(); waits.push(times.run()); }
  assert.deepEqual(waits, [1000, 2000, 4000, 8000, 16000, 30000, 30000]);
  sockets[6].send({ seq: 9 }); sockets[6].send({ seq: 10 }); sockets[6].drop();
  assert.equal(times.run(), 1000);
  // A socket that closes before any message is a refusal, even right after a clean one.
  sockets[7].drop();
  assert.equal(times.run(), 1000);
  sockets[8].drop();
  assert.equal(times.run(), 2000);
});

test('a feed that closes right after its first number backs off, as one that ends there does', () => {
  const { live, sockets, events, times } = fixture();
  const waits = [];
  live.start();
  for (let n = 0; n < 6; n++) { sockets[n].send({ seq: 5 }); sockets[n].drop(); waits.push(times.run()); }
  assert.deepEqual(waits, [1000, 2000, 4000, 8000, 16000, 30000]);
  assert.deepEqual(events.filter(e => e.kind === 'commit').map(e => e.seq), [5], 'the same number announces no commit');
  sockets[6].send({ seq: 5 }); sockets[6].send({ seq: 6 }); sockets[6].drop();
  assert.equal(times.run(), 1000, 'a socket that announced a commit and then closed reconnects after a second');
});

test('an unreadable or unknown message closes the socket and backs off', () => {
  for (const bad of ['not json', { seq: -1 }, { hello: 1 }, { seq: 1.5 }]) {
    const { live, sockets, times } = fixture();
    live.start();
    sockets[0].send({ seq: 1 }); sockets[0].send(bad);
    assert.equal(live.connected, false, JSON.stringify(bad));
    assert.equal(sockets[0].closed, true, 'the dropped socket is closed, not left open');
    assert.equal(times.run(), 1000);
    sockets[1].send(bad);
    assert.equal(times.run(), 2000, 'a second bad socket waits longer');
  }
});

test('stop closes the socket and schedules nothing', () => {
  const { live, sockets, times } = fixture();
  live.start();
  sockets[0].send({ seq: 1 });
  live.stop();
  assert.equal(sockets[0].closed, true);
  assert.equal(times.jobs.size, 0);
  sockets[0].drop?.();
  live.wake();
  assert.equal(sockets.length, 1);
});

test('wake reconnects at once only while down, and never opens a second socket', () => {
  const { live, sockets, times } = fixture();
  live.start();
  live.wake();
  assert.equal(sockets.length, 1, 'a socket still connecting is not doubled');
  sockets[0].send({ seq: 1 });
  live.wake();
  assert.equal(sockets.length, 1);
  sockets[0].drop();
  live.wake();
  assert.equal(sockets.length, 2);
  assert.equal(times.jobs.size, 0);
  assert.equal(live.opened, 2);
});

// Freshness with a live stream: no timer while it is up, a pass on each commit, the timer again when it drops.
const authority = { authority_id: 'a1', authority_epoch: 'e1', continuity: 'initial' };
const admission = { version: 1, header: 'X-AIM-Read-Class', foreground: { slots: 1, max_waiters: 8, queue_timeout_ms: 5000 }, background: { slots: 1, max_waiters: 2, queue_timeout_ms: 500 } };
const bootstrap = { instance_id: 'i1', actor: 'person', authority, transport: { read_admission: admission } };
const scope = { kind: 'topic', id: 't1' };
const cursor = seq => ({ v: 1, kind: 'checkpoint', instance_id: 'i1', actor_id: 'person', authority_id: 'a1', authority_epoch: 'e1', scope, after_seq: seq });
const page = seq => ({ instance_id: 'i1', scope, baseline: false, items: [], has_more: false, continuation: null, checkpoint: cursor(seq), covered_versions: { topic: 1, notebook: 0 } });
function freshness(live, view) {
  const calls = [], times = clock();
  const f = new Freshness({ api: { view: async (name, args) => { calls.push(name); return view ? view(name, args) : page(0); } }, bootstrap, topicId: 't1', checkpoint: cursor(0),
    timers: times, random: () => 0, read: action => action({ readClass: 'background' }), binding: () => bootstrap,
    keys: () => [], refresh: async () => true, status: () => {}, yieldRead: async () => {}, live });
  return { f, calls, times };
}

test('while the stream is up a finished pass leaves no timer, and each request reads once', async () => {
  const { f, calls, times } = freshness({ connected: true });
  await f.start();
  assert.equal(times.jobs.size, 0);
  assert.deepEqual(calls, ['changes']);
  await f.request();
  assert.deepEqual(calls, ['changes', 'changes']);
  assert.equal(times.jobs.size, 0);
});

test('without a stream, or with it down, a finished pass schedules the next', async () => {
  for (const live of [null, { connected: false }]) {
    const { f, times } = freshness(live);
    await f.start();
    assert.equal(times.jobs.size, 1);
    assert.equal([...times.jobs.values()][0].ms, 500);
  }
});

test('a failed pass keeps its retry timer even while the stream is up', async () => {
  let fail = true;
  const { f, times } = freshness({ connected: true }, () => {
    if (fail) { fail = false; throw Object.assign(Error('busy'), { status: 503, details: { error: { code: 'SERVER_BUSY', retryable: true } } }); }
    return page(0);
  });
  await f.start();
  assert.equal(times.jobs.size, 1);
  times.run(); await tick(); await tick();
  assert.equal(times.jobs.size, 0);
});

test('while the stream is up, a pass interrupted after a commit asked for it keeps its timer', async () => {
  let release;
  const { f, calls, times } = freshness({ connected: true }, name => name === 'changes' && calls.length === 1 ? new Promise(resolve => { release = () => resolve(page(0)); }) : page(0));
  const first = f.start();
  await tick();
  f.request();
  f.interrupt();
  release(); await first; await tick();
  assert.equal(times.jobs.size, 1, 'the interrupted pass leaves a timer');
  times.run(); await tick(); await tick();
  assert.equal(calls.filter(name => name === 'changes').length >= 2, true);
  assert.equal(times.jobs.size, 0, 'a settled pass leaves none');
});

test('while the stream is up, a resync whose re-read is busy keeps a retry timer', async () => {
  const busy = Object.assign(Error('busy'), { status: 503, details: { error: { code: 'SERVER_BUSY', retryable: true } } });
  const resync = Object.assign(Error('resync'), { status: 409, details: { error: { code: 'RESYNC_REQUIRED', retryable: false } } });
  let step = 0;
  const calls = [], times = clock();
  const f = new Freshness({ api: { view: async name => { calls.push(name); if (step++ === 0) throw resync; return page(0); }, bootstrap: async () => { calls.push('bootstrap'); throw busy; } },
    bootstrap, topicId: 't1', checkpoint: cursor(0), timers: times, random: () => 0, read: action => action({ readClass: 'background' }),
    binding: () => bootstrap, keys: () => [], refresh: async () => true, status: () => {}, yieldRead: async () => {}, live: { connected: true } });
  await f.start();
  assert.deepEqual(calls, ['changes', 'bootstrap']);
  assert.equal(times.jobs.size, 1, 'the promised retry is scheduled');
});

test('while the stream is up, work left dirty by an interruption keeps the timer', async () => {
  const { f, times } = freshness({ connected: true });
  await f.start();
  assert.equal(times.jobs.size, 0);
  f.invalidate('topic', 3);
  f.schedule();
  assert.equal(times.jobs.size, 1);
});

test('a commit during a list load asks for one more load, however many arrive', async () => {
  const releases = [];
  let loads = 0;
  const reload = reloader(() => { loads++; return new Promise(resolve => releases.push(resolve)); });
  const first = reload();
  assert.equal(loads, 1);
  assert.equal(reload(), first, 'an ask during a load joins it');
  reload(); reload();
  releases.shift()(); await tick();
  assert.equal(loads, 2, 'the asks made while it ran make exactly one more load');
  releases.shift()(); await first;
  assert.equal(loads, 2);
  reload();
  assert.equal(loads, 3, 'a later ask starts a new load');
  releases.shift()();
});

test('a socket that announced commits resets the back-off, so a later bad ending waits one second', () => {
  const { live, sockets, times } = fixture({ throws: 5 });
  live.start();
  for (let n = 0; n < 5; n++) times.run();
  for (let seq = 1; seq <= 100; seq++) sockets[0].send({ seq });
  sockets[0].send({ end: 'database_moved' });
  assert.equal(times.run(), 1000, 'the session worked, so the back-off starts again');
  sockets[1].send({ seq: 101 }); sockets[1].send({ end: 'unconfirmed' });
  assert.equal(times.run(), 2000, 'a socket that only gave its first number still counts as failing');
});

test('a load that fails does not cancel the one asked for during it, and the run settles as its last load', async () => {
  const releases = [];
  let loads = 0;
  const reload = reloader(() => { loads++; return new Promise((resolve, reject) => releases.push({ resolve, reject })); });
  const first = reload();
  reload();
  releases.shift().reject(Error('busy')); await tick();
  assert.equal(loads, 2, 'the ask made during the failed load still loads');
  releases.shift().resolve(); await first;
  const second = reload();
  releases.shift().reject(Error('offline'));
  await assert.rejects(second, /offline/);
});

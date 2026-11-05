import test from 'node:test';
import assert from 'node:assert/strict';
import { Live, liveOffered } from '../web/live.mjs';
import { Freshness } from '../web/freshness.mjs';

const tick = () => new Promise(resolve => setImmediate(resolve));
function clock() {
  let serial = 0;
  const jobs = new Map();
  return { jobs, setTimeout(fn, ms) { jobs.set(++serial, { fn, ms }); return serial; }, clearTimeout(id) { jobs.delete(id); },
    run() { const [[id, job]] = jobs; jobs.delete(id); job.fn(); return job.ms; } };
}
// A response whose body the test writes line by line, and closes.
function stream() {
  let controller;
  const body = new ReadableStream({ start(c) { controller = c; } });
  const encoder = new TextEncoder();
  return { response: new Response(body, { status: 200, headers: { 'Content-Type': 'application/x-ndjson' } }),
    send(value) { controller.enqueue(encoder.encode(typeof value === 'string' ? value : JSON.stringify(value) + '\n')); },
    close() { controller.close(); } };
}
function fixture(answers) {
  const calls = [], events = [], times = clock();
  const fetcher = async (url, options) => {
    calls.push({ url, options });
    const answer = answers.shift();
    if (answer instanceof Error) throw answer;
    return answer;
  };
  const live = new Live({ token: 'secret', fetcher, timers: times, random: () => 0 });
  live.listen(event => events.push(event));
  return { live, calls, events, times };
}

test('only the advertised version 1 stream is used', () => {
  assert.equal(liveOffered({ transport: { live: { version: 1, path: '/api/live' } } }), true);
  for (const transport of [undefined, {}, { live: { version: 2, path: '/api/live' } }, { live: { version: 1, path: '/elsewhere' } }]) {
    assert.equal(liveOffered({ transport }), false);
  }
});

test('each new commit number is announced once, with the session token, and nothing for a repeat', async () => {
  const s = stream(), { live, calls, events } = fixture([s.response]);
  live.start(); await tick();
  assert.equal(calls[0].url, '/api/live');
  assert.equal(calls[0].options.headers.Authorization, 'Bearer secret');
  s.send({ seq: 4 }); await tick();
  assert.equal(live.connected, true);
  s.send({ seq: 4 }); s.send('{"seq":5}\n{"se'); await tick();
  s.send('q":6}\n'); await tick();
  assert.deepEqual(events, [{ kind: 'state', state: 'live' }, { kind: 'commit', seq: 4 }, { kind: 'commit', seq: 5 }, { kind: 'commit', seq: 6 }]);
});

test('a server that stops reconnects after a second; a feed that ended for another reason backs off', async () => {
  const first = stream(), second = stream(), { live, events, times } = fixture([first.response, second.response]);
  live.start(); await tick();
  first.send({ seq: 1 }); first.send({ end: 'stopped' }); await tick(); await tick();
  assert.equal(live.connected, false);
  assert.deepEqual(events.slice(-1), [{ kind: 'state', state: 'down' }]);
  assert.equal(times.run(), 1000);
  await tick();
  second.send({ seq: 2 }); second.send({ end: 'database_moved' }); await tick(); await tick();
  assert.equal(times.run(), 1000);
  assert.deepEqual(events.filter(e => e.kind === 'commit').map(e => e.seq), [1, 2]);
});

test('a broken feed is not asked in a loop: each delivered-then-ended stream waits longer', async () => {
  const streams = [stream(), stream(), stream()], { live, times } = fixture(streams.map(s => s.response));
  const waits = [];
  live.start(); await tick();
  for (const s of streams) {
    s.send({ seq: 3 }); s.send({ end: 'unconfirmed' }); await tick(); await tick();
    waits.push(times.run()); await tick();
  }
  assert.deepEqual(waits, [1000, 2000, 4000]);
});

test('refused connections back off to at most thirty seconds; a clean stream resets that', async () => {
  const refused = () => new Response('{"error":{"code":"SERVER_BUSY"}}', { status: 503 });
  const answers = [...Array.from({ length: 7 }, refused)], s = stream();
  answers.push(s.response, refused());
  const { live, times } = fixture(answers);
  const waits = [];
  live.start(); await tick(); await tick();
  for (let n = 0; n < 7; n++) { waits.push(times.run()); await tick(); await tick(); }
  assert.deepEqual(waits, [1000, 2000, 4000, 8000, 16000, 30000, 30000]);
  // The seventh wait ended with the stream that now delivers.
  s.send({ seq: 9 }); s.close(); await tick(); await tick();
  assert.equal(times.run(), 1000);
  await tick(); await tick();
  assert.equal(times.run(), 1000);
});

test('an instance without live updates is asked once and never again', async () => {
  const { live, calls, events, times } = fixture([new Response('{"error":{"code":"LIVE_UNAVAILABLE"}}', { status: 503 })]);
  live.start(); await tick(); await tick();
  assert.deepEqual(events, [{ kind: 'state', state: 'unavailable' }]);
  assert.equal(times.jobs.size, 0);
  live.wake(); live.start(); await tick();
  assert.equal(calls.length, 1);
});

test('an unreadable line drops the stream and backs off', async () => {
  const s = stream(), { live, times } = fixture([s.response]);
  live.start(); await tick();
  s.send({ seq: 1 }); s.send('not json\n'); await tick(); await tick();
  assert.equal(live.connected, false);
  assert.equal(times.run(), 1000);
});

test('stop aborts the stream and schedules nothing', async () => {
  const s = stream(), { live, calls, times } = fixture([s.response]);
  live.start(); await tick();
  s.send({ seq: 1 }); await tick();
  live.stop(); await tick(); await tick();
  assert.equal(calls[0].options.signal.aborted, true);
  assert.equal(times.jobs.size, 0);
  live.wake(); await tick();
  assert.equal(calls.length, 1);
});

test('wake reconnects at once only while down', async () => {
  const first = stream(), second = stream(), { live, calls, times } = fixture([first.response, second.response]);
  live.start(); await tick();
  first.send({ seq: 1 }); await tick();
  live.wake(); await tick();
  assert.equal(calls.length, 1);
  first.close(); await tick(); await tick();
  live.wake(); await tick();
  assert.equal(calls.length, 2);
  assert.equal(times.jobs.size, 0);
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

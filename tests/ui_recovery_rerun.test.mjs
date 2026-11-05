import test from 'node:test';
import assert from 'node:assert/strict';
import { AttemptError } from '../web/api.mjs';
import { RecoveryCleanup, eligible } from '../web/cleanup.mjs';
import { editorKey } from '../web/editor.mjs';

// The rows whose check a foreground read deferred are checked again once no
// foreground read remains, and never sooner; rows deferred only by a busy
// server wait for the next foreground release rather than retrying on their
// own. Exactly the deferred rows are checked again, once.
const authority = { authority_id: 'a1', authority_epoch: 'e1', continuity: 'initial' };
const admission = { version: 1, header: 'X-AIM-Read-Class', foreground: { slots: 1, max_waiters: 8, queue_timeout_ms: 5000 }, background: { slots: 1, max_waiters: 2, queue_timeout_ms: 500 } };
const bootstrap = { instance_id: 'i1', actor: 'person', authority, transport: { read_admission: admission } };
const deferred = () => { let resolve; const promise = new Promise(a => { resolve = a; }); return { resolve, promise }; };
const tick = async () => { for (let i = 0; i < 8; i++) await new Promise(resolve => setImmediate(resolve)); };
const imageRow = { id: 'r1', availability: 'available', snapshot: { format: 2 } };
const context = { instanceId: 'i1', actor: 'person', sourceRef: { kind: 'topic', id: 't1' }, topicId: 't1', kind: 'reply' };
const key = editorKey(context);
// A saved copy that Core already acknowledged, which cleanup confirms and retires.
const acknowledgedRow = { id: JSON.stringify([key, 'w1']), availability: 'available', active: 1, writerId: 'w1', stamp: 's1',
  scope: JSON.stringify(['i1', 'person']), editorKey: key,
  snapshot: { format: 1, key, context, sourceRef: context.sourceRef, localVersion: 0, ackVersion: 0, activeAuthority: authority,
    draft: { id: 'd1', revision: 1, body: 'kept', attachments: [], quotes: [], addressees: [], generation: 'g1' }, attempts: [], submissions: [] } };
const busy = cleanup => cleanup.read(async () => { throw new AttemptError('busy', 503, { error: { code: 'SERVER_BUSY' } }); });

// `check` answers each journal call; a check that is not deferred retires its row.
function fixture({ check, stopped = () => false } = {}) {
  const rechecks = [], calls = [];
  const journal = {
    retireImageCandidate: async (key, row) => { calls.push(row.id); await check(cleanup, row); return { retired: true }; },
    retireAcknowledged: async (key, row) => { calls.push(row.id); await check(cleanup, row); return true; },
    own: async () => { calls.push('own'); await check(cleanup, null); return null; },
  };
  const cleanup = new RecoveryCleanup({ api: {}, bootstrap, journal, runtime: { readTimeoutMs: 5000 }, changed: () => {}, stopped });
  cleanup.resumeListeners.add((session, ids, page) => rechecks.push({ session, ids, kept: page.items.map(row => row.id) }));
  const session = { editor: { key, context } };
  return { cleanup, session, rechecks, calls };
}
// The first journal call of each row waits inside its read until released.
function held() {
  const hold = deferred(), entered = deferred(), seen = new Set();
  return { hold, entered, check: (cleanup, row) => {
    const first = !seen.has(row?.id ?? 'own'); seen.add(row?.id ?? 'own');
    return cleanup.read(async () => { if (first) { entered.resolve(); await hold.promise; } return null; });
  } };
}

test('a row a foreground read interrupts is checked again when that read is released, not before', async () => {
  const { hold, entered, check } = held();
  const { cleanup, session, rechecks, calls } = fixture({ check });
  const page = cleanup.candidates(session, { items: [imageRow], nextCursor: null });
  await entered.promise;
  const fg = cleanup.foreground();
  await fg.read(async () => 'opened');
  hold.resolve();
  assert.deepEqual((await page).items.map(row => row.id), ['r1']);
  await tick();
  assert.deepEqual(calls, ['r1']);
  fg.release();
  await tick();
  assert.deepEqual(calls, ['r1', 'r1']);
  assert.deepEqual(rechecks, [{ session, ids: ['r1'], kept: [] }]);
  const again = cleanup.foreground(); again.release(); await tick();
  assert.equal(rechecks.length, 1);
});

test('a row whose foreground read ended before the deferral settled is still checked again', async () => {
  const { hold, entered, check } = held();
  const { cleanup, session, rechecks } = fixture({ check });
  const page = cleanup.candidates(session, { items: [imageRow], nextCursor: null });
  await entered.promise;
  cleanup.foreground().release();
  hold.resolve(); await page; await tick();
  assert.deepEqual(rechecks, [{ session, ids: ['r1'], kept: [] }]);
});

test('the own copy deferred after a save is retired again on release', async () => {
  const { hold, entered, check } = held();
  const { cleanup, session, rechecks, calls } = fixture({ check });
  cleanup.request(session);
  await entered.promise;
  const fg = cleanup.foreground();
  hold.resolve(); await cleanup.idle(key); await tick();
  assert.deepEqual(calls, ['own']);
  fg.release(); await tick();
  assert.deepEqual(calls, ['own', 'own']);
  assert.deepEqual(rechecks, [], 'no listed row was deferred');
});

test('a busy server defers a row until the next foreground release, without retrying alone', async () => {
  let answer = busy;
  const { cleanup, session, rechecks, calls } = fixture({ check: cleanup => answer(cleanup) });
  await cleanup.candidates(session, { items: [imageRow], nextCursor: null });
  await tick();
  assert.deepEqual([calls, rechecks], [['r1'], []]);
  answer = cleanup => cleanup.read(async () => null);
  const fg = cleanup.foreground(); fg.release(); await tick();
  assert.deepEqual(rechecks, [{ session, ids: ['r1'], kept: [] }]);
});

test('nothing is checked again when nothing was deferred, or once cleanup has stopped', async () => {
  const quiet = fixture({ check: cleanup => cleanup.read(async () => null) });
  await quiet.cleanup.candidates(quiet.session, { items: [imageRow], nextCursor: null });
  const fg = quiet.cleanup.foreground(); fg.release(); await tick();
  assert.deepEqual([quiet.calls, quiet.rechecks], [['r1'], []]);
  let stop = false;
  const { hold, entered, check } = held();
  const ended = fixture({ check, stopped: () => stop });
  const page = ended.cleanup.candidates(ended.session, { items: [imageRow], nextCursor: null });
  await entered.promise;
  const reservation = ended.cleanup.foreground();
  hold.resolve(); await page; stop = true;
  reservation.release(); await tick();
  assert.deepEqual([ended.calls, ended.rechecks], [['r1'], []]);
});

test('a deferred check of an acknowledged copy runs again on release', async () => {
  assert.equal(eligible(acknowledgedRow, context), true);
  const { hold, entered, check } = held();
  const { cleanup, session, rechecks } = fixture({ check });
  const page = cleanup.candidates(session, { items: [acknowledgedRow], nextCursor: null });
  await entered.promise;
  const fg = cleanup.foreground();
  hold.resolve(); assert.deepEqual((await page).items.map(row => row.id), [acknowledgedRow.id]); await tick();
  assert.equal(rechecks.length, 0);
  fg.release(); await tick();
  assert.deepEqual(rechecks, [{ session, ids: [acknowledgedRow.id], kept: [] }]);
});

test('several rows deferred in one page are checked again together, once, after the page settles', async () => {
  const holds = { r1: deferred(), r2: deferred() }, entered = { r1: deferred(), r2: deferred() }, seen = new Set();
  const { cleanup, session, rechecks, calls } = fixture({ check: (cleanup, row) => {
    const first = !seen.has(row.id); seen.add(row.id);
    return cleanup.read(async () => { if (first) { entered[row.id].resolve(); await holds[row.id].promise; } return null; });
  } });
  const page = cleanup.candidates(session, { items: [imageRow, { ...imageRow, id: 'r2' }], nextCursor: null });
  await entered.r1.promise;
  cleanup.foreground().release();
  holds.r1.resolve(); await entered.r2.promise;
  cleanup.foreground().release();
  holds.r2.resolve(); await page; await tick();
  assert.deepEqual(calls, ['r1', 'r2', 'r1', 'r2']);
  assert.deepEqual(rechecks, [{ session, ids: ['r1', 'r2'], kept: [] }]);
});

test('a busy server answer later in the page keeps an earlier foreground deferral ready', async () => {
  const hold = deferred(), entered = deferred(); let n = 0;
  const { cleanup, session, rechecks } = fixture({ check: cleanup => {
    const call = n++;
    if (call === 0) return cleanup.read(async () => { entered.resolve(); await hold.promise; return null; });
    return call === 1 ? busy(cleanup) : cleanup.read(async () => null);
  } });
  const page = cleanup.candidates(session, { items: [imageRow, { ...imageRow, id: 'r2' }], nextCursor: null });
  await entered.promise;
  cleanup.foreground().release();
  hold.resolve(); await page; await tick();
  assert.deepEqual(rechecks, [{ session, ids: ['r1', 'r2'], kept: [] }]);
});

test('a later check of a deferred row answers for it, so it is not checked again', async () => {
  let answer = busy;
  const { cleanup, session, rechecks, calls } = fixture({ check: cleanup => answer(cleanup) });
  await cleanup.candidates(session, { items: [imageRow, { ...imageRow, id: 'r2' }], nextCursor: null });
  answer = cleanup => cleanup.read(async () => null);
  await cleanup.candidates(session, { items: [imageRow], nextCursor: null });
  const fg = cleanup.foreground(); fg.release(); await tick();
  assert.deepEqual(calls, ['r1', 'r2', 'r1', 'r2']);
  assert.deepEqual(rechecks, [{ session, ids: ['r2'], kept: [] }]);
});

test('a later retirement of the own copy answers for its deferral, so it is not retired again', async () => {
  let answer = busy;
  const { cleanup, session, calls } = fixture({ check: cleanup => answer(cleanup) });
  cleanup.request(session); await cleanup.idle(key);
  answer = cleanup => cleanup.read(async () => null);
  cleanup.request(session); await cleanup.idle(key);
  const fg = cleanup.foreground(); fg.release(); await tick();
  assert.deepEqual(calls, ['own', 'own']);
});

test('a row answered after a foreground deferral leaves a later busy deferral waiting for the next release', async () => {
  const hold = deferred(), entered = deferred(), seen = new Set();
  const { cleanup, session, rechecks, calls } = fixture({ check: (cleanup, row) => {
    const first = !seen.has(row.id); seen.add(row.id);
    if (row.id === 'r2' && first) return busy(cleanup);
    return cleanup.read(async () => { if (row.id === 'r1' && first) { entered.resolve(); await hold.promise; } return null; });
  } });
  const page = cleanup.candidates(session, { items: [imageRow], nextCursor: null });
  await entered.promise;
  const fg = cleanup.foreground();
  // Queued behind the held page: it answers for r1 and finds the server busy for r2.
  const next = cleanup.candidates(session, { items: [imageRow, { ...imageRow, id: 'r2' }], nextCursor: null });
  fg.release();
  hold.resolve(); await page; await next; await tick();
  assert.deepEqual([calls, rechecks], [['r1', 'r1', 'r2'], []]);
  cleanup.foreground().release(); await tick();
  assert.deepEqual(rechecks, [{ session, ids: ['r2'], kept: [] }]);
});

test('no recheck runs between discovery reading its page and checking it', async () => {
  const { hold, entered, check } = held();
  const { cleanup, session, rechecks, calls } = fixture({ check });
  const page = cleanup.candidates(session, { items: [imageRow], nextCursor: null });
  await entered.promise;
  cleanup.foreground().release();
  // r1 is deferred and ready once its read settles; discovery is queued first.
  const read = deferred(), reading = deferred();
  const found = cleanup.discover(session, async () => { reading.resolve(); await read.promise; calls.push('read'); return { items: [], nextCursor: null }; });
  hold.resolve(); await page;
  await reading.promise; await tick();
  assert.deepEqual(calls, ['r1', 'own']);
  read.resolve(); await found; await tick();
  assert.deepEqual(calls, ['r1', 'own', 'read', 'r1']);
  assert.deepEqual(rechecks, [{ session, ids: ['r1'], kept: [] }]);
});

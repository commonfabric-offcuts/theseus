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
// The journal holds every row it was asked about, unless `current` says otherwise.
function fixture({ check, stopped = () => false, paused = () => false, current, changed = () => {} } = {}) {
  const rechecks = [], calls = [], checked = [], held = new Map();
  const journal = {
    retireImageCandidate: async (key, row) => { calls.push(row.id); checked.push(row); held.set(row.id, row); await check(cleanup, row); return { retired: true }; },
    retireAcknowledged: async (key, row) => { calls.push(row.id); checked.push(row); held.set(row.id, row); await check(cleanup, row); return true; },
    own: async () => { calls.push('own'); await check(cleanup, null); return null; },
    current: async (key, ids) => current ? current(ids) : ids.map(id => held.get(id)).filter(Boolean),
  };
  const cleanup = new RecoveryCleanup({ api: {}, bootstrap, journal, runtime: { readTimeoutMs: 5000 }, changed: editor => changed(editor), stopped, paused });
  cleanup.resumeListeners.add((session, ids, page) => rechecks.push({ session, ids, kept: page.items.map(row => row.id) }));
  const session = { editor: { key, context } };
  return { cleanup, session, rechecks, calls, checked };
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

test('a deferred check is pending until its recheck has settled, and the editor is then reported changed with nothing pending', async () => {
  const { hold, entered, check } = held(), changes = [];
  const f = fixture({ check, changed: editor => changes.push([editor, f.cleanup.pending(key)]) }), { cleanup, session } = f;
  assert.equal(cleanup.pending(key), false, 'nothing deferred, nothing pending');
  const page = cleanup.candidates(session, { items: [imageRow], nextCursor: null });
  await entered.promise;
  const fg = cleanup.foreground();
  await fg.read(async () => 'opened');
  hold.resolve(); await page; await tick();
  assert.equal(cleanup.pending(key), true, 'deferred, its check is still to be made');
  let during;
  cleanup.resumeListeners.add(() => { during = cleanup.pending(key); });
  changes.length = 0;
  fg.release(); await tick();
  assert.equal(during, true, 'pending while the recheck is under way');
  assert.equal(cleanup.pending(key), false);
  assert.deepEqual(changes.at(-1), [session.editor, false], 'reported changed once nothing is pending');
  assert.equal(cleanup.pending(editorKey({ ...context, sourceRef: { kind: 'topic', id: 't2' }, topicId: 't2' })), false, 'another editor has nothing pending');
});

test('a recheck that a foreground read defers again keeps the editor pending until the recheck after it has settled', async () => {
  const later = deferred(), changes = []; let calls = 0, fg;
  const f = fixture({ changed: () => changes.push(f.cleanup.pending(key)), check: async cleanup => {
    calls++;
    // Discovery: a foreground read defers the check.
    if (calls === 1) { fg = cleanup.foreground(); return cleanup.read(async () => null); }
    // The first recheck: another foreground read defers it again, and ends before this recheck does.
    if (calls === 2) { const again = cleanup.foreground(); try { return await cleanup.read(async () => null); } finally { again.release(); } }
    await later.promise; return cleanup.read(async () => null);
  } }), { cleanup, session } = f;
  await cleanup.candidates(session, { items: [imageRow], nextCursor: null });
  fg.release(); await tick();
  assert.equal(calls, 3, 'the row deferred again is checked once more');
  assert.equal(cleanup.pending(key), true, 'the first recheck settling leaves the second pending');
  assert.ok(!changes.includes(false), 'and reports nothing quiet while it runs');
  later.resolve(); await tick();
  assert.equal(cleanup.pending(key), false);
  assert.equal(changes.at(-1), false, 'reported changed once nothing is pending');
});

test('what a recheck listener starts keeps the editor pending until it settles', async () => {
  const { hold, entered, check } = held(), settle = deferred(), changes = [];
  const f = fixture({ check, changed: () => changes.push(f.cleanup.pending(key)) }), { cleanup, session } = f;
  cleanup.resumeListeners.add(() => settle.promise);
  const page = cleanup.candidates(session, { items: [imageRow], nextCursor: null });
  await entered.promise;
  const fg = cleanup.foreground();
  await fg.read(async () => 'opened');
  hold.resolve(); await page;
  changes.length = 0; fg.release(); await tick();
  assert.equal(cleanup.pending(key), true, 'the recheck has settled, what its listener started has not');
  assert.ok(!changes.includes(false));
  settle.resolve(); await tick();
  assert.equal(cleanup.pending(key), false);
  assert.equal(changes.at(-1), false, 'reported changed once it settles');
});

test('a deferral that ends without a recheck reports the editor changed once nothing is pending', async () => {
  // Answered by a later check of the row.
  let answer = busy; const changes = [];
  const f = fixture({ check: cleanup => answer(cleanup), changed: () => changes.push(f.cleanup.pending(key)) });
  await f.cleanup.candidates(f.session, { items: [imageRow], nextCursor: null });
  assert.equal(f.cleanup.pending(key), true);
  answer = cleanup => cleanup.read(async () => null); changes.length = 0;
  await f.cleanup.candidates(f.session, { items: [imageRow], nextCursor: null });
  assert.equal(f.cleanup.pending(key), false);
  assert.ok(changes.includes(false), 'a later check that answers the row reports it');
  // Dropped because its session is no longer registered.
  let registered = true; answer = busy; const dropped = [];
  const g = fixture({ check: cleanup => answer(cleanup), changed: () => dropped.push(g.cleanup.pending(key)) });
  const session = { editor: { key, context }, registered: () => registered };
  await g.cleanup.candidates(session, { items: [imageRow], nextCursor: null });
  registered = false; dropped.length = 0;
  g.cleanup.foreground().release(); await tick();
  assert.equal(g.cleanup.pending(key), false);
  assert.deepEqual(dropped, [false], 'the dropped deferral reports it');
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

test('a recheck checks the row as the journal holds it now, and drops a row that left the journal', async () => {
  let answer = busy, now = new Map([['r1', { ...imageRow, stamp: 's2' }]]);
  const { cleanup, session, rechecks, calls, checked } = fixture({ check: cleanup => answer(cleanup), current: ids => ids.map(id => now.get(id)).filter(Boolean) });
  await cleanup.candidates(session, { items: [{ ...imageRow, stamp: 's1' }, { ...imageRow, id: 'r2' }], nextCursor: null });
  answer = cleanup => cleanup.read(async () => null);
  cleanup.foreground().release(); await tick();
  assert.deepEqual(calls, ['r1', 'r2', 'r1']);
  assert.equal(checked.at(-1).stamp, 's2', 'the changed row is checked at its current stamp');
  assert.deepEqual(rechecks, [{ session, ids: ['r1', 'r2'], kept: [] }], 'r2 left the journal, so the page omits it');
});

test('a journal that cannot read the deferred rows reports it and applies nothing', async () => {
  let answer = busy;
  const { cleanup, session, rechecks } = fixture({ check: cleanup => answer(cleanup), current: async () => { throw Error('closed'); } });
  await cleanup.candidates(session, { items: [imageRow], nextCursor: null });
  answer = cleanup => cleanup.read(async () => null);
  cleanup.foreground().release(); await tick();
  assert.deepEqual(rechecks, []);
  assert.match(session.editor.cleanupError, /could not finish/);
});

test('rows a replaced session deferred are never checked for the session that replaced it', async () => {
  let answer = busy;
  const { cleanup, session, rechecks, calls } = fixture({ check: cleanup => answer(cleanup) });
  await cleanup.candidates(session, { items: [imageRow], nextCursor: null });
  // The editor is replaced under the same key; the new session's own copy is deferred.
  const replaced = { editor: { key, context } };
  cleanup.request(replaced); await cleanup.idle(key);
  answer = cleanup => cleanup.read(async () => null);
  cleanup.foreground().release(); await tick();
  assert.deepEqual([calls, rechecks], [['r1', 'own', 'own'], []]);
});

test('a session that is no longer registered leaves nothing to check again', async () => {
  let answer = busy, registered = true;
  const { cleanup, rechecks, calls } = fixture({ check: cleanup => answer(cleanup) });
  const session = { editor: { key, context }, registered: () => registered };
  await cleanup.candidates(session, { items: [imageRow], nextCursor: null });
  registered = false; answer = cleanup => cleanup.read(async () => null);
  cleanup.foreground().release(); await tick();
  assert.deepEqual([calls, rechecks], [['r1'], []]);
  registered = true; cleanup.foreground().release(); await tick();
  assert.deepEqual(calls, ['r1'], 'the dropped deferral does not return');
});

test('a listener that fails is reported and the others still receive the recheck', async () => {
  let answer = busy;
  const { cleanup, session, rechecks } = fixture({ check: cleanup => answer(cleanup) });
  const first = new Set([() => { throw Error('listener failed'); }, ...cleanup.resumeListeners]);
  cleanup.resumeListeners.clear(); for (const listener of first) cleanup.resumeListeners.add(listener);
  await cleanup.candidates(session, { items: [imageRow], nextCursor: null });
  answer = cleanup => cleanup.read(async () => null);
  cleanup.foreground().release(); await tick();
  assert.deepEqual(rechecks, [{ session, ids: ['r1'], kept: [] }]);
  assert.match(session.editor.cleanupError, /could not finish/);
});

test('a reservation with two reads in flight holds background reads until both settle', async () => {
  const { cleanup } = fixture({ check: cleanup => cleanup.read(async () => null) });
  const fg = cleanup.foreground(), slow = deferred();
  const first = fg.read(async () => 'first'), second = fg.read(() => slow.promise);
  await first; fg.release(); await tick();
  await assert.rejects(cleanup.read(async () => 'background'), { code: 'CLEANUP_DEFERRED' });
  slow.resolve('second'); await second; await tick();
  assert.equal(await cleanup.read(async () => 'background'), 'background');
});

test('no recheck runs between discovery reading its page and checking it', async () => {
  const { hold, entered, check } = held();
  const { cleanup, session, rechecks, calls } = fixture({ check });
  const page = cleanup.candidates(session, { items: [imageRow], nextCursor: null });
  await entered.promise;
  cleanup.foreground().release();
  // r1 is deferred and ready once its read settles; discovery is queued first.
  const read = deferred(), reading = deferred();
  const found = cleanup.discover(session, async () => { reading.resolve(); await read.promise; calls.push('read'); return { items: [], nextCursor: null }; }, () => calls.push('applied'));
  hold.resolve(); await page;
  await reading.promise; await tick();
  assert.deepEqual(calls, ['r1', 'own']);
  read.resolve(); await found; await tick();
  assert.deepEqual(calls, ['r1', 'own', 'read', 'applied', 'r1']);
  assert.deepEqual(rechecks, [{ session, ids: ['r1'], kept: [] }]);
});

// A park (writing waiting on a review of a runtime change) stops the
// cleanup's own reads. What it defers waits for the park to end, whatever
// releases come meanwhile, and is then checked once: a check deferred by the
// park and checked again during it would only be deferred again, round and
// round for as long as the review lasts.
test('a park landing mid-check holds the deferred rows and the own copy until it ends, then checks each once', async () => {
  let parked = false, currents = 0, looks = 0;
  const rows = { r1: imageRow, [acknowledgedRow.id]: acknowledgedRow };
  // The caps end a recheck that would otherwise go round for as long as the
  // park lasts: the park lifts after 200 looks at it.
  const { cleanup, session, rechecks, calls } = fixture({ paused: () => parked && ++looks <= 200,
    current: ids => { if (++currents > 20) throw Error('rechecked 20 times during the park'); return ids.map(id => rows[id]); },
    check: cleanup => { if (calls.length === 1) parked = true; return cleanup.read(async () => null, true); } });
  const page = await cleanup.candidates(session, { items: [imageRow, acknowledgedRow], nextCursor: null });
  cleanup.request(session); await cleanup.idle(key); await tick();
  assert.deepEqual(page.items.map(row => row.id), ['r1', acknowledgedRow.id], 'both copies stay listed');
  assert.deepEqual([calls, currents, rechecks], [['r1'], 0, []], 'nothing is checked again during the park');
  cleanup.foreground().release(); await tick();
  assert.deepEqual([calls, currents], [['r1'], 0], 'a foreground release during the park checks nothing');
  parked = false; cleanup.foreground().release(); await tick();
  assert.deepEqual(calls, ['r1', 'own', 'r1', acknowledgedRow.id]);
  assert.deepEqual(rechecks, [{ session, ids: ['r1', acknowledgedRow.id], kept: [] }]);
  cleanup.foreground().release(); await tick();
  assert.equal(calls.length, 4, 'each is checked once');
});

test('a page checked during a park starts no row and lists every one, and the rows are checked once the park ends', async () => {
  let parked = true, currents = 0, looks = 0;
  const rows = { r1: imageRow, [acknowledgedRow.id]: acknowledgedRow };
  const { cleanup, session, rechecks, calls } = fixture({ paused: () => parked && ++looks <= 200, check: cleanup => cleanup.read(async () => null, true),
    current: ids => { if (++currents > 20) throw Error('rechecked 20 times during the park'); return ids.map(id => rows[id]); } });
  const page = await cleanup.candidates(session, { items: [imageRow, acknowledgedRow], nextCursor: null }); await tick();
  assert.deepEqual(page.items.map(row => row.id), ['r1', acknowledgedRow.id]);
  assert.deepEqual([calls, rechecks], [[], []], 'no journal retirement starts during the park');
  parked = false; cleanup.foreground().release(); await tick();
  assert.deepEqual(calls, ['r1', acknowledgedRow.id]);
  assert.deepEqual(rechecks, [{ session, ids: ['r1', acknowledgedRow.id], kept: [] }]);
});

test('a saved copy whose reply asks or tells is recognized; one holding any other intent is not', () => {
  const withIntent = intent => structuredClone({ ...acknowledgedRow, snapshot: { ...acknowledgedRow.snapshot,
    draft: { ...acknowledgedRow.snapshot.draft, addressees: ['tony'], intent } } });
  for (const intent of ['ask', 'tell', null]) assert.equal(eligible(withIntent(intent), context), true, String(intent));
  for (const intent of ['maybe', 1]) assert.equal(eligible(withIntent(intent), context), false, String(intent));
});

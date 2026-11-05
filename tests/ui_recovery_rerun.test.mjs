import test from 'node:test';
import assert from 'node:assert/strict';
import { AttemptError } from '../web/api.mjs';
import { RecoveryCleanup, eligible } from '../web/cleanup.mjs';
import { editorKey } from '../web/editor.mjs';

// A recovery check deferred by a foreground read runs again once no foreground
// read remains, and never sooner; one deferred only by a busy server waits for
// the next foreground release rather than retrying on its own.
const authority = { authority_id: 'a1', authority_epoch: 'e1', continuity: 'initial' };
const admission = { version: 1, header: 'X-AIM-Read-Class', foreground: { slots: 1, max_waiters: 8, queue_timeout_ms: 5000 }, background: { slots: 1, max_waiters: 2, queue_timeout_ms: 500 } };
const bootstrap = { instance_id: 'i1', actor: 'person', authority, transport: { read_admission: admission } };
const deferred = () => { let resolve; const promise = new Promise(a => { resolve = a; }); return { resolve, promise }; };
const tick = async () => { for (let i = 0; i < 5; i++) await new Promise(resolve => setImmediate(resolve)); };
const imageRow = { id: 'r1', availability: 'available', snapshot: { format: 2 } };
const context = { instanceId: 'i1', actor: 'person', sourceRef: { kind: 'topic', id: 't1' }, topicId: 't1', kind: 'reply' };
const key = editorKey(context);
// A saved copy that Core already acknowledged, which cleanup confirms and retires.
const acknowledgedRow = { id: JSON.stringify([key, 'w1']), availability: 'available', active: 1, writerId: 'w1', stamp: 's1',
  scope: JSON.stringify(['i1', 'person']), editorKey: key,
  snapshot: { format: 1, key, context, sourceRef: context.sourceRef, localVersion: 0, ackVersion: 0, activeAuthority: authority,
    draft: { id: 'd1', revision: 1, body: 'kept', attachments: [], quotes: [], addressees: [], generation: 'g1' }, attempts: [], submissions: [] } };

function fixture({ check, stopped = () => false } = {}) {
  const resumed = [];
  const journal = {
    retireImageCandidate: (key, row) => check(cleanup),
    own: () => check(cleanup),
    retireAcknowledged: () => check(cleanup),
  };
  const cleanup = new RecoveryCleanup({ api: {}, bootstrap, journal, runtime: { readTimeoutMs: 5000 }, changed: () => {}, stopped });
  cleanup.resumeListeners.add(session => resumed.push(session));
  const session = { editor: { key, context } };
  return { cleanup, session, resumed };
}
function held() {
  const hold = deferred(), entered = deferred();
  return { hold, entered, check: cleanup => cleanup.read(async () => { entered.resolve(); await hold.promise; return null; }) };
}

test('a check a foreground read interrupts runs again when that read is released, not before', async () => {
  const { hold, entered, check } = held();
  const { cleanup, session, resumed } = fixture({ check });
  const page = cleanup.candidates(session, { items: [imageRow], nextCursor: null });
  await entered.promise;
  const fg = cleanup.foreground();
  await fg.read(async () => 'opened');
  hold.resolve();
  assert.deepEqual((await page).items.map(row => row.id), ['r1']);
  await tick();
  assert.equal(resumed.length, 0);
  fg.release();
  await tick();
  assert.deepEqual(resumed, [session]);
  const again = cleanup.foreground(); again.release(); await tick();
  assert.equal(resumed.length, 1);
});

test('a check whose foreground read ended before the deferral settled still runs again', async () => {
  const { hold, entered, check } = held();
  const { cleanup, session, resumed } = fixture({ check });
  const page = cleanup.candidates(session, { items: [imageRow], nextCursor: null });
  await entered.promise;
  const fg = cleanup.foreground(); fg.release();
  hold.resolve(); await page; await tick();
  assert.deepEqual(resumed, [session]);
});

test('a check deferred after a save runs again on release', async () => {
  const { hold, entered, check } = held();
  const { cleanup, session, resumed } = fixture({ check });
  cleanup.request(session);
  await entered.promise;
  const fg = cleanup.foreground();
  hold.resolve(); await cleanup.idle(key); await tick();
  assert.equal(resumed.length, 0);
  fg.release(); await tick();
  assert.deepEqual(resumed, [session]);
});

test('a busy server defers the check until the next foreground release, without retrying alone', async () => {
  const { cleanup, session, resumed } = fixture({
    check: cleanup => cleanup.read(async () => { throw new AttemptError('busy', 503, { error: { code: 'SERVER_BUSY' } }); }),
  });
  await cleanup.candidates(session, { items: [imageRow], nextCursor: null });
  await tick();
  assert.equal(resumed.length, 0);
  const fg = cleanup.foreground(); fg.release(); await tick();
  assert.deepEqual(resumed, [session]);
});

test('nothing runs again when nothing was deferred, or once cleanup has stopped', async () => {
  const quiet = fixture({ check: cleanup => cleanup.read(async () => null) });
  await quiet.cleanup.candidates(quiet.session, { items: [imageRow], nextCursor: null });
  const fg = quiet.cleanup.foreground(); fg.release(); await tick();
  assert.equal(quiet.resumed.length, 0);
  let stop = false;
  const { hold, entered, check } = held();
  const ended = fixture({ check, stopped: () => stop });
  const page = ended.cleanup.candidates(ended.session, { items: [imageRow], nextCursor: null });
  await entered.promise;
  const held2 = ended.cleanup.foreground();
  hold.resolve(); await page; stop = true;
  held2.release(); await tick();
  assert.equal(ended.resumed.length, 0);
});

test('a deferred check of an acknowledged copy runs again on release', async () => {
  assert.equal(eligible(acknowledgedRow, context), true);
  const { hold, entered, check } = held();
  const { cleanup, session, resumed } = fixture({ check });
  const page = cleanup.candidates(session, { items: [acknowledgedRow], nextCursor: null });
  await entered.promise;
  const fg = cleanup.foreground();
  hold.resolve(); assert.deepEqual((await page).items.map(row => row.id), [acknowledgedRow.id]); await tick();
  assert.equal(resumed.length, 0);
  fg.release(); await tick();
  assert.deepEqual(resumed, [session]);
});

test('several checks deferred in one page run again once, after the page settles', async () => {
  const holds = [deferred(), deferred()], entered = [deferred(), deferred()]; let n = 0;
  const { cleanup, session, resumed } = fixture({ check: cleanup => {
    const i = n++; return cleanup.read(async () => { entered[i].resolve(); await holds[i].promise; return null; });
  } });
  const page = cleanup.candidates(session, { items: [imageRow, { ...imageRow, id: 'r2' }], nextCursor: null });
  await entered[0].promise;
  cleanup.foreground().release();
  holds[0].resolve(); await entered[1].promise;
  cleanup.foreground().release();
  holds[1].resolve(); await page; await tick();
  assert.deepEqual(resumed, [session]);
});

test('a busy server answer later in the page keeps an earlier foreground deferral ready', async () => {
  const hold = deferred(), entered = deferred(); let n = 0;
  const { cleanup, session, resumed } = fixture({ check: cleanup => n++ === 0
    ? cleanup.read(async () => { entered.resolve(); await hold.promise; return null; })
    : cleanup.read(async () => { throw new AttemptError('busy', 503, { error: { code: 'SERVER_BUSY' } }); }) });
  const page = cleanup.candidates(session, { items: [imageRow, { ...imageRow, id: 'r2' }], nextCursor: null });
  await entered.promise;
  cleanup.foreground().release();
  hold.resolve(); await page; await tick();
  assert.deepEqual(resumed, [session]);
});

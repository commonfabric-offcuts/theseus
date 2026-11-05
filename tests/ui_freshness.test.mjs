import test from 'node:test';
import assert from 'node:assert/strict';
import { Api, AttemptError } from '../web/api.mjs';
import { RecoveryCleanup } from '../web/cleanup.mjs';
import { Editor } from '../web/editor.mjs';
import { EditorSession, RuntimeAuthority } from '../web/session.mjs';

const fresh = await import('../web/freshness.mjs').catch(error => {
  if (error.code !== 'ERR_MODULE_NOT_FOUND') throw error;
  return {};
});
const copy = structuredClone;
const authority = { authority_id: 'a1', authority_epoch: 'e1', continuity: 'initial' };
const admission = { version: 1, header: 'X-AIM-Read-Class', foreground: { slots: 1, max_waiters: 8, queue_timeout_ms: 5000 }, background: { slots: 1, max_waiters: 2, queue_timeout_ms: 500 } };
const bootstrap = { instance_id: 'i1', actor: 'person', authority, transport: { read_admission: admission } };
const scope = { kind: 'topic', id: 't1' };
const cursor = (seq, kind = 'checkpoint', extra = {}) => ({ v: 1, kind, instance_id: 'i1', actor_id: 'person', authority_id: 'a1', authority_epoch: 'e1', scope, after_seq: seq, ...extra });
const page = (seq, items = [], extra = {}) => ({ instance_id: 'i1', scope, baseline: false, items, has_more: false, continuation: null, checkpoint: cursor(seq), covered_versions: { topic: 1, notebook: 0 }, ...extra });
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { resolve, reject, promise }; };
const tick = () => new Promise(resolve => setImmediate(resolve));
function clock() {
  let serial = 0;
  const jobs = new Map();
  return { jobs, setTimeout(fn, ms) { jobs.set(++serial, { fn, ms }); return serial; }, clearTimeout(id) { jobs.delete(id); } };
}
function fixture(overrides = {}) {
  const calls = [], paints = [], states = [], times = clock();
  const api = { view: async (name, args) => { calls.push({ name, args }); return page(0); }, bootstrap: async () => bootstrap };
  const f = new fresh.Freshness({ api, bootstrap, topicId: 't1', checkpoint: cursor(0), timers: times, random: () => 0,
    read: action => action({ readClass: 'background' }), binding: () => bootstrap,
    keys: item => [{ key: item.resource_kind + ':' + item.resource_id, version: item.version }],
    refresh: async (key, version) => { paints.push({ key, version }); return true; },
    status: state => states.push(state), ...overrides });
  return { f, calls, paints, states, times, api };
}

test('read class is explicit only on view/bootstrap; commands keep their own lane', async () => {
  const seen = [], api = new Api('token', async (url, options) => { seen.push({ url, options }); return new Response('{}'); });
  await api.view('changes', {}, { readClass: 'background' }); await api.bootstrap({ readClass: 'background' });
  await api.view('source'); await api.command({ operation_id: 'unchanged' });
  assert.equal(seen[0].options.headers['X-AIM-Read-Class'], 'background');
  assert.equal(seen[1].options.headers['X-AIM-Read-Class'], 'background');
  assert.equal(seen[2].options.headers['X-AIM-Read-Class'], undefined);
  assert.equal(seen[3].options.headers['X-AIM-Read-Class'], undefined);
});

test('capability requires exact supported fixed partition, not merely a version', () => {
  assert.equal(fresh.supportsAdmission(bootstrap), true);
  for (const value of [undefined, {}, { ...admission, header: 'Other' }, { ...admission, foreground: { ...admission.foreground, slots: 2 } }]) {
    assert.equal(fresh.supportsAdmission({ ...bootstrap, transport: { read_admission: value } }), false);
  }
});

test('baseline precedes every initial dependent view and unsupported server does not poll', async () => {
  const order = [], api = { view: async (name, args) => { order.push(name); assert.equal(Object.hasOwn(args, 'cursor'), false); return page(4, [], { baseline: true }); } };
  const saved = await fresh.initialViews({ api, bootstrap, topicId: 't1', load: async () => order.push('initial') });
  assert.deepEqual(order, ['changes', 'initial']); assert.deepEqual(saved, cursor(4));
  order.length = 0;
  assert.equal(await fresh.initialViews({ api, bootstrap: { ...bootstrap, transport: {} }, topicId: 't1', load: async () => order.push('initial') }), null);
  assert.deepEqual(order, ['initial']);
});

test('baseline failure keeps initial lists unclaimed instead of continuing as current', async () => {
  let loaded = false;
  await assert.rejects(fresh.initialViews({ api: { view: async () => ({ error: { code: 'SERVER_BUSY', retryable: true } }) }, bootstrap, topicId: 't1', load: async () => { loaded = true; } }));
  assert.equal(loaded, false);
});

test('read failure classification retains typed errors including bootstrap and catch-all retryable 5xx', () => {
  for (const code of ['AUTHORITY_CHANGED', 'INVALID_BINDING']) {
    assert.equal(fresh.readFailure({ error: { code } }).kind, 'authority');
    assert.equal(fresh.readFailure(new AttemptError('refused', 409, { error: { code } })).kind, 'authority');
  }
  for (const [status, code] of [[500, 'REQUEST_UNCONFIRMED'], [503, 'CAPABILITIES_UNAVAILABLE'], [503, 'SERVER_BUSY'], [502, 'FUTURE_RETRYABLE']]) {
    assert.equal(fresh.readFailure(new AttemptError('busy', status, { error: { code, retryable: true } })).kind, 'retry');
  }
  assert.equal(fresh.readFailure(new AttemptError('gone', 401, { error: { code: 'SESSION_REQUIRED' } })).kind, 'reconnect');
  assert.equal(fresh.readFailure({ error: { code: 'VIEW_TOO_LARGE' } }).kind, 'diagnostic');
  assert.equal(fresh.readFailure({ error: { code: 'FUTURE_NONRETRYABLE' } }).kind, 'diagnostic');
  assert.equal(fresh.readFailure(new AttemptError('unreadable', 200)).kind, 'diagnostic');
  assert.equal(fresh.readFailure(new AttemptError('offline')).kind, 'retry');
});

test('partial feed never advances checkpoint and resource reads alternate with draining', async () => {
  const continuation = cursor(1, 'continuation', { through_seq: 2, covered_versions: { topic: 2, notebook: 0 } });
  const sequence = [], gate = deferred(), second = deferred(); let reads = 0;
  const { f } = fixture({ api: { view: async (_n, args) => {
    sequence.push('feed');
    if (++reads === 1) return page(0, [{ seq: 1, resource_kind: 'topic', resource_id: 't1', version: 2 }], { has_more: true, checkpoint: null, continuation, covered_versions: null });
    // This is the terminal page of the same captured window. Its versions
    // must match the continuation, not the helper's unrelated default v1.
    assert.deepEqual(args.cursor, continuation); second.resolve(); await gate.promise;
    return page(2, [], { covered_versions: continuation.covered_versions });
  } }, refresh: async () => { sequence.push('resource'); return true; } });
  const run = f.request(); await second.promise;
  assert.deepEqual(f.checkpoint, cursor(0)); assert.deepEqual(sequence, ['feed', 'resource', 'feed']);
  gate.resolve(); await run; assert.deepEqual(f.checkpoint, cursor(2)); f.dispose();
});

test('completed checkpoint can advance while a failed dependent resource stays dirty', async () => {
  let fail = true;
  const { f, states } = fixture({ api: { view: async (_name, args) => page(3, args.cursor.after_seq < 3 ? [{ seq: 3, resource_kind: 'memory', resource_id: 'n1', version: 4 }] : []) }, refresh: async () => {
    if (fail) throw new AttemptError('busy', 503, { error: { code: 'SERVER_BUSY', retryable: true } }); return true;
  } });
  await f.request(); assert.deepEqual(f.checkpoint, cursor(3)); assert.equal(f.dirty.size, 1); assert.equal(states.at(-1).kind, 'retry');
  fail = false; await f.request(); assert.equal(f.dirty.size, 0); f.dispose();
});

test('repeated requests coalesce; invalidation during read retains one newest follow-up', async () => {
  const gate = deferred(), entered = deferred(), seen = []; let first = true;
  const { f } = fixture({ refresh: async (key, version) => { seen.push(version); if (first) { first = false; entered.resolve(); await gate.promise; } return true; } });
  f.invalidate('memory:n1', 2); const run = f.request(); await entered.promise;
  for (let i = 0; i < 10; ++i) { f.invalidate('memory:n1', 3); f.request(); }
  gate.resolve(); await run;
  assert.deepEqual(seen, [2, 3]); assert.equal(f.dirty.size, 0); f.dispose();
});

test('disposed or foreground-invalidated read cannot paint or advance its cursor', async () => {
  for (const dispose of [false, true]) {
    const gate = deferred(), { f, paints } = fixture({ api: { view: () => gate.promise } });
    const run = f.request(); await tick();
    if (dispose) f.dispose(); else f.interrupt();
    gate.resolve(page(1, [{ seq: 1, resource_kind: 'topic', resource_id: 't1', version: 2 }])); await run;
    assert.deepEqual(paints, []); assert.deepEqual(f.checkpoint, cursor(0)); f.dispose();
  }
});

test('hidden documents schedule no automatic work; becoming visible catches up once', async () => {
  const { f, times, calls } = fixture(); f.setVisible(false); f.start();
  assert.equal(times.jobs.size, 0); assert.equal(calls.length, 0);
  await f.setVisible(true); assert.equal(calls.length, 1); assert.equal(times.jobs.size, 1);
  f.setVisible(false); assert.equal(times.jobs.size, 0); f.dispose();
});

test('hidden transition during a live read cannot rearm the automatic timer on settlement', async () => {
  const gate = deferred(), entered = deferred();
  const { f, times } = fixture({ api: { view: async () => { entered.resolve(); await gate.promise; return page(0); } } });
  const run = f.request(); await entered.promise; f.setVisible(false);
  gate.resolve(); await run;
  assert.equal(times.jobs.size, 0); f.dispose();
});

test('hidden transition stops a held partial window before dependent and continuation reads', async () => {
  const gate = deferred(), entered = deferred(), calls = [];
  const continuation = cursor(1, 'continuation', { through_seq: 2, covered_versions: { topic: 2, notebook: 0 } });
  let first = true;
  const { f, paints, times } = fixture({ api: { view: async (name, args) => {
    calls.push({ name, args });
    if (first) { first = false; entered.resolve(); await gate.promise; }
    return args.cursor.kind === 'continuation' ? page(2, [], { covered_versions: continuation.covered_versions })
      : page(0, [{ seq: 1, resource_kind: 'topic', resource_id: 't1', version: 2 }], { has_more: true, checkpoint: null, continuation, covered_versions: null });
  } } });
  const run = f.request(); await entered.promise; f.setVisible(false); gate.resolve(); await run;
  assert.equal(calls.length, 1, 'no continuation is dispatched after hide');
  assert.deepEqual(paints, [], 'dependent work waits for visible return');
  assert.equal(times.jobs.size, 0);
  await f.setVisible(true);
  assert.deepEqual(f.checkpoint, cursor(2)); assert.equal(paints.length, 1);
  f.dispose();
});

test('authority refusal parks immediately without probing or replaying a command', async () => {
  let parks = 0, probes = 0;
  const { f, times } = fixture({ api: { view: async () => ({ error: { code: 'INVALID_BINDING' } }), bootstrap: async () => { probes++; } }, authorityLost: async () => { parks++; } });
  await f.request(); assert.equal(parks, 1); assert.equal(probes, 0); assert.equal(f.stopped, true); assert.equal(times.jobs.size, 0);
  await f.request(); assert.equal(parks, 1); f.dispose();
});

test('malformed continuation binding stops diagnostically without consuming keys', async () => {
  const bad = cursor(1, 'continuation', { through_seq: 2, covered_versions: { topic: 2, notebook: 0 } }); bad.actor_id = 'other';
  const { f, paints, states } = fixture({ api: { view: async () => page(0, [{ seq: 1, resource_kind: 'topic', resource_id: 't1', version: 2 }], { has_more: true, checkpoint: null, continuation: bad, covered_versions: null }) } });
  await f.request(); assert.equal(f.stopped, true); assert.deepEqual(paints, []); assert.equal(states.at(-1).kind, 'diagnostic'); f.dispose();
});

test('a continuation keeps its captured version window on partial and terminal pages', () => {
  const input = cursor(1, 'continuation', { through_seq: 3, covered_versions: { topic: 3, notebook: 2 } });
  for (const partial of [false, true]) {
    const answer = partial
      ? page(0, [{ seq: 2, resource_kind: 'topic', resource_id: 't1', version: 2 }], {
        checkpoint: null, covered_versions: null, has_more: true,
        continuation: cursor(2, 'continuation', { through_seq: 3, covered_versions: { topic: 4, notebook: 2 } }),
      }) : page(3, [], { covered_versions: { topic: 4, notebook: 2 } });
    assert.throws(() => fresh.changesPage(answer, bootstrap, 't1', input), /window|version/i);
  }
});

test('foreground cancellation during an availability recheck cannot stop the new read generation', async () => {
  const entered = deferred(), gate = deferred(); let denied = true;
  const { f, states } = fixture({
    api: { view: async () => denied ? { error: { code: 'FORBIDDEN' } } : page(0) },
    denied: async () => { entered.resolve(); await gate.promise; },
  });
  const checking = f.request(); await entered.promise;
  f.interrupt(); denied = false; gate.resolve(); await checking;
  assert.equal(f.stopped, false, 'an old permission completion cannot stop a superseding foreground lifetime');
  await f.request(); assert.equal(states.at(-1).kind, 'current'); f.dispose();
});

test('revision targets converge for loaded, current and pending items and discard irrelevant keys', () => {
  const targets = new fresh.RevisionTargets(); targets.retain(['loaded', 'opening']);
  targets.observe('opening', 4); targets.observe('unloaded', 9); targets.observe('loaded', 7);
  assert.equal(targets.offer({ kind: 'memory', id: 'opening', revision: 2 }, 3), 4);
  targets.observe('opening', 2); assert.equal(targets.offer({ kind: 'memory', id: 'opening', revision: 3 }, 3), 4);
  assert.equal(targets.offer({ kind: 'memory', id: 'opening', revision: 4 }, 4), null);
  assert.equal(targets.values.has('unloaded'), false); targets.retain(['loaded']); assert.equal(targets.values.has('opening'), false);
});

test('capable foreground cancels local background but never clears its active transport early', async () => {
  const hold = deferred(), entered = deferred(); let options;
  const cleanup = new RecoveryCleanup({ api: {}, bootstrap, journal: {}, runtime: { readTimeoutMs: 5000 }, changed: () => {} });
  const bg = cleanup.read(async value => { options = value; entered.resolve(); await hold.promise; return 1; });
  const rejected = assert.rejects(bg, e => e.code === 'CLEANUP_DEFERRED');
  await entered.promise; const active = cleanup.activeRead; const fg = cleanup.foreground();
  try {
    assert.equal(options.readClass, 'background'); assert.equal(options.signal.aborted, true); assert.equal(cleanup.activeRead, active);
    assert.equal(await fg.read(async () => 'opened'), 'opened'); assert.equal(cleanup.activeRead, active);
  } finally { fg.release(); hold.resolve(); await rejected; }
  assert.equal(cleanup.activeRead, null);
});

test('background 503 is cleanup deferral and older server retains conservative arbitration', async () => {
  const cleanup = new RecoveryCleanup({ api: {}, bootstrap, journal: {}, runtime: { readTimeoutMs: 5000 }, changed: () => {} });
  await assert.rejects(cleanup.read(async () => { throw new AttemptError('busy', 503, { error: { code: 'SERVER_BUSY' } }); }), e => e.code === 'CLEANUP_DEFERRED');
  const old = new RecoveryCleanup({ api: {}, bootstrap: { ...bootstrap, transport: {} }, journal: {}, runtime: { readTimeoutMs: 5000 }, changed: () => {} });
  const hold = deferred(), entered = deferred(); let signal, ran = false;
  const bg = old.read(async options => { signal = options.signal; entered.resolve(); await hold.promise; });
  await entered.promise; const fg = old.foreground(), opened = fg.read(async () => { ran = true; });
  await tick(); assert.equal(signal.aborted, false); assert.equal(ran, false);
  hold.resolve(); await bg; await opened; fg.release(); assert.equal(ran, true);
});

test('a list read leaves background reads running beside it, and an older server keeps the reservation', async () => {
  const cleanup = new RecoveryCleanup({ api: {}, bootstrap, journal: {}, runtime: { readTimeoutMs: 5000 }, changed: () => {} });
  let interrupted = 0, listed;
  cleanup.foregroundListeners.add(() => interrupted++);
  // A background read sent while a list read is out runs.
  const out = deferred(), listing = cleanup.list(async options => { listed = options; await out.promise; return 'rows'; });
  assert.equal(await cleanup.read(async () => 'beside'), 'beside');
  out.resolve(); assert.equal(await listing, 'rows'); assert.deepEqual(listed, { readClass: 'foreground' });
  // A background read already out when a list read starts is not stopped.
  const hold = deferred(), entered = deferred(); let signal;
  const bg = cleanup.read(async options => { signal = options.signal; entered.resolve(); await hold.promise; return 'background'; });
  await entered.promise;
  assert.equal(await cleanup.list(async () => 'rows'), 'rows');
  assert.equal(signal.aborted, false); assert.equal(interrupted, 0);
  hold.resolve(); assert.equal(await bg, 'background');
  const old = new RecoveryCleanup({ api: {}, bootstrap: { ...bootstrap, transport: {} }, journal: {}, runtime: { readTimeoutMs: 5000 }, changed: () => {} });
  const oldHold = deferred(), oldEntered = deferred(); let ran = false;
  const oldBg = old.read(async () => { oldEntered.resolve(); await oldHold.promise; });
  await oldEntered.promise; const oldListing = old.list(async () => { ran = true; });
  await tick(); assert.equal(ran, false, 'an older server\'s list read waits for the background read');
  await assert.rejects(old.read(async () => 'held back'), e => e.code === 'CLEANUP_DEFERRED');
  oldHold.resolve(); await oldBg; await oldListing; assert.equal(ran, true);
});

test('freshness sees the retryable server cause through cleanup deferral without losing backoff', async () => {
  const cleanup = new RecoveryCleanup({ api: {}, bootstrap, journal: {}, runtime: { readTimeoutMs: 5000 }, changed: () => {} });
  const { f, states, times } = fixture({ read: fn => cleanup.read(fn), api: { view: async () => {
    throw new AttemptError('busy', 503, { error: { code: 'SERVER_BUSY', retryable: true } });
  } } });
  await f.request(); assert.equal(states.at(-1).kind, 'retry'); assert.equal([...times.jobs.values()][0].ms, 500);
  await f.request(); assert.equal(states.at(-1).kind, 'retry'); assert.equal([...times.jobs.values()][0].ms, 1000);
  f.dispose();
});

test('park-only recovery persists exact writing, is retryable, and preserves a newer review', async () => {
  const calls = [], rows = [], next = { ...authority, authority_epoch: 'e2', continuity: 'complete' };
  const context = { instanceId: 'i1', actor: 'person', kind: 'note', sourceRef: { kind: 'message', id: 'm1' }, topicId: 't1' };
  const editor = new Editor(context, { id: 'note1', revision: 0 }); editor.edit({ body: 'Exact private writing' });
  const api = { bootstrap: async () => { calls.push('bootstrap'); return { ...bootstrap, authority: next }; }, view: async () => { calls.push('editor_state'); return { instance_id: 'i1', source_ref: context.sourceRef, source_available: true, note: null }; } };
  const session = new EditorSession(editor, { api, journal: { save: async row => { rows.push(copy(row)); } }, authority, runtime: new RuntimeAuthority({ api, instanceId: 'i1', authority }) });
  const pin = { authority_id: 'a1', authority_epoch: 'e1' };
  await session.parkAuthority(pin, 'INVALID_BINDING');
  assert.equal(session.recovery.phase, 'parked'); assert.deepEqual(calls, []); assert.equal(rows.at(-1).draft.body, 'Exact private writing');
  await session.retryAuthority(); assert.deepEqual(calls, ['bootstrap', 'editor_state']); assert.equal(session.recovery.phase, 'ready');
  const review = session.recovery; await session.parkAuthority(pin, 'AUTHORITY_CHANGED'); assert.equal(session.recovery, review);
  assert.equal(editor.draft.body, 'Exact private writing'); assert.equal(session.attempts.length, 0);
});

test('message live frontier fills a burst beyond thirty without resetting older-history cursor', async () => {
  const { TopicViews } = await import('../web/topic-views.mjs');
  const v = new TopicViews({ instanceId: 'i1', topicId: 't1' });
  const msg = seq => ({ id: 'm' + seq, seq, topic_id: 't1', body: 'body', author_id: 'agent' });
  const messages = (items, next_cursor = null) => ({ instance_id: 'i1', items, next_cursor, relevant_versions: { topic: 2 } });
  v.messagesPage(messages([msg(40)], 40), { initial: true });
  v.topic = { id: 't1', version: 2 }; v.messageTarget = 'm75';
  const calls = [], read = async (_name, args) => { calls.push(args); return messages(Array.from({ length: args.cursor === 40 ? 30 : 5 }, (_, i) => msg(args.cursor + i + 1))); };
  assert.equal(await v.refresh('messages', 2, read), false); assert.equal(await v.refresh('messages', 2, read), true);
  assert.equal(v.messages.size, 36); assert.equal(v.newest, 75); assert.equal(v.olderCursor, 40); assert.deepEqual(calls.map(x => x.cursor), [40, 70]);
  v.messagesPage(messages([msg(39)], 39), { cursor: 40 }); assert.equal(v.newest, 75); assert.equal(v.olderCursor, 39);
  v.messagesPage(messages([msg(38)], 38), { cursor: 40 }); assert.equal(v.olderCursor, 39); assert.equal(v.messages.has('m38'), false);
});

test('loaded Notebook key beyond twenty refreshes exactly, and racing More never downgrades revision', async () => {
  const { TopicViews } = await import('../web/topic-views.mjs');
  const v = new TopicViews({ instanceId: 'i1', topicId: 't1' });
  const item = (n, revision = 1) => ({ id: 'n' + n, seq: n, owner_scope: scope, revision, source_ref: { kind: 'memory', id: 'n' + n, revision }, body: 'body', title: 'title' });
  const memory = (items, next_cursor) => ({ instance_id: 'i1', items, next_cursor, relevant_versions: { notebook: 3 } });
  v.memoryPage(memory(Array.from({ length: 21 }, (_, i) => item(i + 1)), 21), { initial: true });
  const keys = v.keys({ resource_kind: 'memory', resource_id: 'n21', version: 3 }); assert.deepEqual(keys, [{ key: 'memory:n21', version: 3 }]);
  let requested;
  await v.refresh('memory:n21', 3, async (_name, args) => { requested = args; return memory([item(21, 3)], null); });
  assert.equal(requested.cursor, 20); assert.equal(requested.limit, 1); assert.equal(v.memoryCursor, 21);
  v.memoryPage(memory([item(21, 2), item(22)], null), { cursor: 20 });
  assert.equal(v.memory.has('n22'), false, 'late More answer with a superseded frontier is ignored');
  v.memoryPage(memory([item(22)], null), { cursor: 21 });
  assert.equal(v.memory.get('n21').revision, 3); assert.equal(v.memory.get('n22').revision, 1);
});

test('unloaded Notebook changes stay bounded and a mismatched keyed summary cannot paint', async () => {
  const { TopicViews } = await import('../web/topic-views.mjs');
  const v = new TopicViews({ instanceId: 'i1', topicId: 't1' }); v.memoryCursor = 20;
  for (let i = 0; i < 1000; ++i) assert.deepEqual(v.keys({ resource_kind: 'memory', resource_id: 'unloaded' + i, version: 2 }), []);
  assert.equal(v.unloadedChanged, true); assert.equal(v.revisions.values.size, 0);
  const item = { id: 'n1', seq: 1, owner_scope: scope, revision: 1, source_ref: { kind: 'memory', id: 'n1', revision: 1 }, body: 'kept' };
  v.memory.set('n1', item);
  await assert.rejects(v.refresh('memory:n1', 2, async () => ({ instance_id: 'i1', items: [{ ...item, id: 'other' }], next_cursor: null, relevant_versions: { notebook: 2 } })));
  assert.equal(v.memory.get('n1'), item);
});

test('topic denial rechecks exact active source through the coordinator before stopping', async () => {
  const seen = [];
  const { f } = fixture({ api: { view: async name => { seen.push(name); return name === 'changes' ? { error: { code: 'FORBIDDEN' } } : { instance_id: 'i1' }; } },
    denied: async read => { await read('source', { id: 'm1' }); await read('editor_state', { source_ref: { kind: 'message', id: 'm1' } }); } });
  await f.request(); assert.deepEqual(seen, ['changes', 'source', 'editor_state']); assert.equal(f.stopped, true);
});

test('cleanup deferral retains its journal row and does not surface a cleanup error', async () => {
  const snapshot = { format: 1, draft: { body: 'kept' } }, row = { snapshot }, editor = { key: 'k', cleanupError: null };
  let removed = false;
  const session = { editor, snapshot: () => snapshot };
  const cleanup = new RecoveryCleanup({ api: {}, bootstrap, runtime: { current: authority, readTimeoutMs: 5000 },
    journal: { own: async () => row, removeExact: async () => { removed = true; } }, changed: () => {} });
  cleanup.confirm = () => cleanup.read(async () => { throw new AttemptError('busy', 503, { error: { code: 'SERVER_BUSY' } }); });
  assert.equal(await cleanup.retireOwn(session), false); assert.equal(removed, false); assert.equal(editor.cleanupError, null);
});

test('source denial and authority refusal during permission recheck do not disappear into topic denial', async () => {
  const seen = []; let parked = 0;
  const { f, states } = fixture({ api: { view: async name => {
    seen.push(name); return { error: { code: name === 'changes' ? 'FORBIDDEN' : 'AUTHORITY_CHANGED' } };
  } }, denied: read => read('source', { id: 'm1' }), authorityLost: async () => { parked++; } });
  await f.request(); assert.equal(parked, 1); assert.equal(states.at(-1).kind, 'authority'); assert.equal(f.stopped, true);
});

test('bootstrap refusal during resync parks without needing a replacement authority pair', async () => {
  let parked = 0;
  const { f, states } = fixture({ api: { view: async () => ({ error: { code: 'RESYNC_REQUIRED' } }),
    bootstrap: async () => { throw new AttemptError('binding', 409, { error: { code: 'INVALID_BINDING' } }); } },
    authorityLost: async () => { parked++; } });
  await f.request(); assert.equal(parked, 1); assert.equal(states.at(-1).kind, 'authority'); assert.equal(f.stopped, true);
});

test('superseded resync bootstrap refusal cannot stop or report against the newer generation', async () => {
  const gate = deferred(), entered = deferred(); let first = true, parks = 0;
  const { f, states } = fixture({ api: {
    view: async () => first ? { error: { code: 'RESYNC_REQUIRED' } } : page(0),
    bootstrap: async () => { entered.resolve(); await gate.promise; throw new AttemptError('old refusal', 409, { error: { code: 'INVALID_BINDING' } }); },
  }, authorityLost: async () => { parks++; } });
  const run = f.request(); await entered.promise; f.interrupt(); first = false; gate.resolve(); await run;
  assert.deepEqual(states, [], 'the superseded resync produces no status');
  assert.equal(parks, 0); assert.equal(f.stopped, false);
  await f.request(); assert.equal(states.at(-1).kind, 'current'); f.dispose();
});

for (const where of ['baseline', 'rebuild']) test(`correction A ${where} denial during resync runs the source check before stopping`, async () => {
  const seen = []; let changes = 0, denials = 0;
  const { f, states, times } = fixture({ api: {
    bootstrap: async () => { seen.push('bootstrap'); return bootstrap; },
    view: async name => {
      seen.push(name);
      if (name !== 'changes') return { instance_id: 'i1' };
      if (++changes === 1) return { error: { code: 'RESYNC_REQUIRED' } };
      return where === 'baseline' ? { error: { code: 'FORBIDDEN' } } : page(4, [], { baseline: true });
    },
  }, rebuild: async () => { throw Object.assign(Error('refused rebuild'), { code: 'FORBIDDEN' }); },
  denied: async (read, current) => { denials++; assert.ok(current()); await read('source', { id: 'm1' }); await read('editor_state', {}); } });
  await f.request();
  assert.equal(denials, 1); assert.deepEqual(seen, ['changes', 'bootstrap', 'changes', 'source', 'editor_state']);
  assert.deepEqual(f.checkpoint, cursor(0)); assert.equal(states.at(-1).kind, 'forbidden');
  assert.equal(f.stopped, true); assert.equal(times.jobs.size, 0); f.dispose();
});

for (const resync of [false, true]) test(`correction A transient source check retains confirmed denial resync=${resync}`, async () => {
  let count = 0, rechecks = 0;
  const { f, states, times } = fixture({ api: { bootstrap: async () => bootstrap,
    view: async () => ({ error: { code: resync && count++ === 0 ? 'RESYNC_REQUIRED' : 'FORBIDDEN' } }) },
    denied: async () => { rechecks++; throw new AttemptError('temporary source failure', 503, { error: { code: 'DATABASE_BUSY' } }); } });
  await f.request(); assert.equal(rechecks, 1); assert.equal(states.at(-1).kind, 'forbidden'); assert.equal(states.at(-1).code, 'FORBIDDEN');
  assert.equal(f.stopped, true); assert.equal(times.jobs.size, 0); f.dispose();
});

for (const during of [false, true]) test(`correction C changed shared binding parks visibly once duringRead=${during}`, async () => {
  const gate = deferred(), entered = deferred(), parks = []; let binding = bootstrap, reads = 0;
  const { f, paints, states, times } = fixture({ binding: () => binding,
    api: { view: async () => { reads++; entered.resolve(); await gate.promise; return page(1, [{ seq: 1, resource_kind: 'topic', resource_id: 't1', version: 1 }]); } },
    authorityLost: async (...args) => parks.push(args) });
  const change = () => { binding = { ...bootstrap, authority: { ...authority, authority_epoch: 'e2' } }; };
  if (!during) change();
  const run = f.request();
  if (during) { await entered.promise; change(); }
  gate.resolve(); await run;
  assert.equal(f.stopped, true); assert.equal(times.jobs.size, 0); assert.equal(reads, during ? 1 : 0);
  assert.deepEqual(paints, []); assert.deepEqual(f.checkpoint, cursor(0));
  assert.equal(states.at(-1).kind, 'authority'); assert.equal(parks.length, 1);
  assert.deepEqual(parks[0][0], fresh.bindingOf(bootstrap));
  await f.request(); assert.equal(parks.length, 1); f.dispose();
});

test('correction C ordinary epoch cancellation is quiet and does not park', async () => {
  for (const action of ['interrupt', 'hide', 'dispose']) {
    const gate = deferred(), entered = deferred(); let parks = 0;
    const { f, states } = fixture({ api: { view: async () => { entered.resolve(); await gate.promise; return page(0); } }, authorityLost: async () => { parks++; } });
    const run = f.request(); await entered.promise;
    if (action === 'hide') f.setVisible(false); else f[action]();
    gate.resolve(); await run;
    assert.equal(parks, 0); assert.deepEqual(states, []); f.dispose();
  }
});

for (const status of [502, 503, 504, 200, 400, 418]) test(`correction D actual unreadable HTTP ${status} has bounded classification`, async () => {
  const api = new Api('fixture', async () => new Response('not JSON', { status }));
  const { f, states, times } = fixture({ api });
  await f.request(); await f.request();
  const retry = status >= 500;
  assert.equal(states.at(-1).kind, retry ? 'retry' : 'diagnostic'); assert.equal(f.stopped, !retry);
  assert.equal(times.jobs.size, retry ? 1 : 0);
  if (retry) assert.equal([...times.jobs.values()][0].ms, 1000);
  f.dispose();
});

test('correction D uncoded 5xx retries but explicit code precedence remains intact', () => {
  assert.equal(fresh.readFailure(new AttemptError('uncoded', 503, { error: { message: 'busy' } })).kind, 'retry');
  for (const [code, kind] of [['INVALID_BINDING','authority'], ['FORBIDDEN','forbidden'], ['SESSION_REQUIRED','reconnect'], ['INVALID_ARGUMENT','diagnostic'], ['UNKNOWN_NONRETRYABLE','diagnostic']]) {
    assert.equal(fresh.readFailure(new AttemptError('refused', 503, { error: { code, retryable: false } })).kind, kind);
  }
});

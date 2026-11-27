import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { recordedActionRefresh, RecordedActionChanges, recordedReads } from '../web/recorded-refresh.mjs';
import { OutcomeScope } from '../web/outcome-scope.mjs';
import { reloader } from '../web/live.mjs';
import { checkedView } from '../web/freshness.mjs';
import { Marks } from '../web/marks.mjs';
import { RecoveryCleanup } from '../web/cleanup.mjs';

const app = readFileSync(new URL('../web/app.mjs', import.meta.url), 'utf8');
const start = app.indexOf('function followCommits('), end = app.indexOf('// Retain the server', start);
const setupStart = app.indexOf('  commitReload = ', app.indexOf('// The open topic\'s marks'));
const setupEnd = app.indexOf("  $('review-versions')", setupStart);
assert.ok(start >= 0 && end > start && setupStart >= 0 && setupEnd > setupStart);
const marksStart = app.indexOf('  marks = new Marks('), marksEnd = app.indexOf('  marks.listen(', marksStart);
assert.ok(marksStart >= 0 && marksEnd > marksStart);
const source = app.slice(start, end) + '\n' + app.slice(setupStart, setupEnd) + '\n' + app.slice(marksStart, marksEnd) + '\n({reload:commitReload, marks});';
const admission = { version: 1, header: 'X-AIM-Read-Class', foreground: { slots: 1, max_waiters: 8, queue_timeout_ms: 5000 }, background: { slots: 1, max_waiters: 2, queue_timeout_ms: 500 } };
const offered = { instance_id: 'fixture1246', actor: 'reader', authority: { authority_id: 'a', authority_epoch: 'e' }, transport: { read_admission: admission } };
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const key = (scope, resource_kind, seq, resource_id = 't') => ({ scope, resource_kind, seq, resource_id, version: 1 });
function page(scope, cursor, seq, items = []) {
  return { instance_id: offered.instance_id, scope, baseline: !cursor, items, has_more: false, continuation: null,
    checkpoint: { v: 1, kind: 'checkpoint', instance_id: offered.instance_id, actor_id: offered.actor,
      authority_id: 'a', authority_epoch: 'e', scope, after_seq: seq },
    covered_versions: scope.kind === 'actor' ? {} : { [scope.kind]: 1, notebook: 0 } };
}

function fixture(bootstrap = offered) {
  let head = 0, changes = [], reject = null, held = null, failed = null;
  const loads = [], calls = [], listeners = [], pending = [], events = {}, state = { folded: true, serverCount: 3, shownCount: null };
  const load = name => async () => { loads.push(name); if (name === 'topics') state.shownCount = state.serverCount;
    if (held?.name === name) { const hold = held; held = null; await hold.promise; }
    return failed !== name; };
  const scope = Object.assign(Object.create(OutcomeScope.prototype), { sections: ['pipeline', 'topics'].map(name => ({ name, load: load(name) })) });
  const context = { bootstrap, topic: { id: 't', workspace_id: 'w' }, retired: false, denied: false, shell: { page: 1 }, thisRun: 1,
    registry: { disposed: false, current: null, runtime: { current: { ...offered.authority } } },
    attention: { refresh() {} }, Marks,
    authorityReviewPending: () => context.denied, reloader, recordedActionRefresh, checkedView, outcomeScope: scope,
    loadConversation: load('conversation'), loadMarks: load('marks'), loadUnread: load('unread'), loadReadState: load('read'),
    loadShownPage: load('shown'), wakeLights: { load: load('wakes') }, participantsPanel: { paint: () => loads.push('participants') },
    refreshSeatPeople: load('participants'),
    document: { visibilityState: 'visible', addEventListener: (name, fn) => { events[name] = fn; } },
    live: { listen: fn => listeners.push(fn) },
    api: { view: async (name, args, options) => {
      calls.push({ name, args: structuredClone(args), options }); if (reject) throw reject;
      const items = args.cursor ? changes.filter(x => x.scope === args.scope.kind && x.seq > args.cursor.after_seq).map(({ scope: _, ...item }) => item) : [];
      return page(args.scope, args.cursor, head, items);
    } },
    run: fn => { const work = Promise.resolve().then(fn); pending.push(work); return work; },
  };
  const cleanup = new RecoveryCleanup({ api: context.api, bootstrap, journal: {}, runtime: { readTimeoutMs: 1000 }, changed() {},
    stopped: () => context.retired, paused: () => context.denied });
  context.registry.cleanup = cleanup;
  const { reload, marks } = vm.runInNewContext(source, context);
  return { context, loads, calls, state, scope, reload, marks, cleanup,
    set(items, seq) { changes = items; head = seq; }, fail(name) { failed = name; }, reject(error) { reject = error; },
    block(name) { const gate = deferred(); held = { name, ...gate }; return gate; },
    shown(on) { context.registry.current = on ? { source: { source_ref: { kind: 'memory', id: 'external-page' } } } : null; },
    emit(event = { kind: 'commit', seq: head }) { for (const fn of listeners) fn(event); },
    visible() { events.visibilitychange?.(); },
    async flush() { for (let n = 0; n < 8; n++) { await new Promise(setImmediate); await Promise.all(pending.splice(0)); } },
  };
}
const all = [...recordedReads()].sort();
const sorted = values => [...values].sort();
async function ready(f) { await f.reload(); f.loads.length = 0; f.calls.length = 0; }

test('1246 supported initial load follows baseline and paints folded section counts immediately', async () => {
  const f = fixture(); await f.reload();
  assert.deepEqual(sorted(f.loads), all); assert.equal(f.state.shownCount, 3); assert.equal(f.state.folded, true);
  assert.equal(f.calls.filter(c => !c.args.cursor).length, 3);
  assert.ok(f.calls.every(c => c.options?.readClass === 'background'));
});

for (const capability of [undefined, { ...admission, header: 'unsupported' }]) test('1246 absent/unsupported capability keeps initial and subsequent full loads and folded cache/count selection: ' + String(capability?.header), async () => {
  const bootstrap = { ...offered, transport: { read_admission: capability } }, f = fixture(bootstrap);
  await ready(f); f.state.serverCount = 7; f.set([key('actor', 'draft', 1)], 1); await f.reload();
  assert.equal(f.calls.length, 0); assert.deepEqual(sorted(f.loads), all); assert.equal(f.state.shownCount, 7); assert.equal(f.state.folded, true);
});

test('1246 actual local recorded path and socket path leave private writing projections unread', async () => {
  const f = fixture(); await ready(f);
  f.set([key('actor', 'draft', 1), key('actor', 'submission', 2)], 2); await f.reload();
  assert.deepEqual(f.loads, []);
  f.set([key('actor', 'note', 3)], 3); f.emit(); await f.flush(); assert.deepEqual(f.loads, []);
  assert.equal(f.calls.length, 6);
});

test('1246 reaction-only does not reread marks but recorded mark/delivery consequences still refresh New and Conversation', async () => {
  const f = fixture(); await ready(f);
  f.set([key('actor', 'reaction', 1, 'm')], 1); await f.reload(); assert.deepEqual(f.loads, []);
  f.set([key('actor', 'mark', 2, 'm')], 2); await f.reload();
  assert.deepEqual(sorted(f.loads), ['conversation', 'marks', 'read', 'topics', 'unread']);
  f.loads.length = 0; f.state.serverCount = 0; f.set([key('actor', 'delivery', 3)], 3); f.emit(); await f.flush();
  assert.deepEqual(sorted(f.loads), ['conversation', 'marks', 'read', 'topics', 'unread', 'wakes']); assert.equal(f.state.shownCount, 0);
});

test('1246 topic access and unknown changes retain full/required owners, while memory read selects page state', async () => {
  const f = fixture(); await ready(f);
  f.set([key('actor', 'memory_read', 1, 'n')], 1); await f.reload(); assert.deepEqual(f.loads, ['read', 'shown']);
  f.loads.length = 0; f.set([key('actor', 'participation', 2)], 2); await f.reload(); assert.deepEqual(sorted(f.loads), all);
  f.loads.length = 0; f.set([key('workspace', 'unknown-future-resource', 3)], 3); await f.reload(); assert.deepEqual(sorted(f.loads), all);
});

test('1246 a shown Notebook outside the captured scopes keeps its current-revision read', async () => {
  const f = fixture(); await ready(f); f.shown(true);
  f.set([], 1); await f.reload(); assert.deepEqual(f.loads, ['shown']);
});

test('1246 local and socket requests coalesce without dropping a change arriving during selected reads', async () => {
  const f = fixture(); await ready(f); const gate = f.block('marks');
  f.set([key('actor', 'mark', 1)], 1); const first = f.reload();
  while (!f.loads.includes('marks')) await new Promise(setImmediate);
  f.set([key('actor', 'mark', 1), key('actor', 'memory_read', 2, 'n')], 2); f.emit(); await new Promise(setImmediate); gate.resolve();
  await first; await f.flush();
  assert.equal(f.loads.filter(x => x === 'marks').length, 1); assert.equal(f.loads.filter(x => x === 'read').length, 2);
  assert.equal(f.loads.filter(x => x === 'shown').length, 1); assert.equal(f.calls.length, 6);
});

test('1246 a failed selected owner leaves its authorized checkpoint owed for the next request', async () => {
  const f = fixture(); await ready(f); f.fail('marks'); f.set([key('actor', 'mark', 1)], 1); await f.reload();
  f.fail(null); f.loads.length = 0; await f.reload(); assert.ok(f.loads.includes('marks'));
  const actor = f.calls.filter(c => c.args.scope.kind === 'actor'); assert.deepEqual(actor.map(c => c.args.cursor.after_seq), [0, 0]);
});

test('1246 failed or resyncing windows fall back full without accepting the failed cursor', async () => {
  const f = fixture(); await ready(f); f.reject(Object.assign(Error('resync'), { code: 'RESYNC_REQUIRED' }));
  await f.reload(); assert.deepEqual(sorted(f.loads), all);
  f.reject(null); f.loads.length = 0; f.calls.length = 0; await f.reload();
  assert.deepEqual(sorted(f.loads), all); assert.equal(f.calls.filter(c => !c.args.cursor).length, 3);
});

test('1246 explicit full and visibility return retain the original full refresh owner', async () => {
  const f = fixture(); await ready(f); await f.reload(true); assert.deepEqual(sorted(f.loads), all);
  f.loads.length = 0; f.visible(); await f.flush(); assert.deepEqual(sorted(f.loads), all);
});

test('1246 retired page or authority review accepts no scoped checkpoint and performs no selected read', async () => {
  const f = fixture(); await ready(f); f.context.retired = true; f.set([key('actor', 'mark', 1)], 1); await f.reload();
  assert.deepEqual(f.loads, []); assert.deepEqual(f.calls, []);
  f.context.retired = false; f.context.denied = true; await f.reload(); assert.deepEqual(f.loads, []);
});

test('1246 selected OutcomeScope reads keep raw all-section callers compatible', async () => {
  const f = fixture(); await f.scope.load(new Set(['topics'])); assert.deepEqual(f.loads, ['topics']);
  f.loads.length = 0; await f.scope.load(); assert.deepEqual(sorted(f.loads), ['pipeline', 'topics']);
});

test('1246 foreign authorized window cannot advance an actual controller checkpoint', async () => {
  let foreign = false;
  const changes = new RecordedActionChanges({ bootstrap: offered, workspaceId: 'w', topicId: 't', current: () => true,
    read: async (_name, args) => { const answer = page(args.scope, args.cursor, args.cursor ? 1 : 0); if (foreign) answer.checkpoint.actor_id = 'other'; return answer; } });
  await changes.baseline(); foreign = true; await assert.rejects(changes.next(), /different binding or scope/);
  assert.ok(changes.cursors.every(cursor => cursor.after_seq === 0));
});

test('1246 a recorded mark refusal forces full confirmation without needing a new change key', async () => {
  const f = fixture(); await ready(f);
  f.marks.recorded({ status: 'committed' }); await f.flush(); assert.deepEqual(f.loads, []);
  f.marks.recorded({ status: 'refused', error: { code: 'REVISION_CONFLICT' } }); await f.flush();
  assert.deepEqual(sorted(f.loads), all);
});

test('1246 an advertised but unsupported change view keeps the full fallback', async () => {
  const f = fixture(); await ready(f); f.reject(Object.assign(Error('unsupported'), { code: 'UNKNOWN_VIEW' }));
  await f.reload(); assert.deepEqual(sorted(f.loads), all);
  f.loads.length = 0; await f.reload(); assert.deepEqual(sorted(f.loads), all);
});

test('1246 a returned socket with a changed commit refreshes full views from a new baseline', async () => {
  const f = fixture(); await ready(f); f.emit({ kind: 'state', state: 'down' }); f.emit({ kind: 'state', state: 'live' });
  f.set([key('actor', 'draft', 1)], 1); f.emit(); await f.flush();
  assert.deepEqual(sorted(f.loads), all); assert.equal(f.calls.filter(c => !c.args.cursor).length, 3);
});

test('1246 authority adoption rejects old acceptance and takes a new bound baseline before full reads', async () => {
  let binding = structuredClone(offered); const calls = [];
  const changes = new RecordedActionChanges({ bootstrap: offered, workspaceId: 'w', topicId: 't', current: () => true, binding: () => binding,
    read: async (_name, args) => { calls.push(args); const answer = page(args.scope, args.cursor, args.cursor ? 1 : 0);
      Object.assign(answer.checkpoint, { authority_id: binding.authority.authority_id, authority_epoch: binding.authority.authority_epoch }); return answer; } });
  await changes.baseline(); const pending = await changes.next();
  binding = { ...binding, authority: { authority_id: 'a2', authority_epoch: 'e2' } }; pending.accept();
  assert.ok(changes.cursors.every(cursor => cursor.after_seq === 0)); calls.length = 0;
  const fresh = await changes.next(); assert.equal(fresh.dirty, null);
  assert.ok(calls.every(call => !call.cursor)); assert.ok(changes.cursors.every(cursor => cursor.authority_id === 'a2'));
});

test('1246 actual foreground recovery ownership defers change reads without accepting or dropping consequences', async () => {
  const f = fixture(); await ready(f); const foreground = f.cleanup.foreground();
  f.set([key('actor', 'mark', 1)], 1); await f.reload(); assert.deepEqual(sorted(f.loads), all); assert.equal(f.calls.length, 0);
  foreground.release(); f.loads.length = 0; await f.reload();
  assert.deepEqual(sorted(f.loads), ['conversation', 'marks', 'read', 'topics', 'unread']);
  assert.ok(f.calls.every(call => call.args.cursor.after_seq === 0));
});

test('1246 a failed captured continuation retries the same complete window before acceptance', async () => {
  let broken = true;
  const changes = new RecordedActionChanges({ bootstrap: offered, workspaceId: 'w', topicId: 't', current: () => true,
    read: async (_name, args) => {
      if (!args.cursor) return page(args.scope, null, 0);
      if (args.scope.kind !== 'topic') return page(args.scope, args.cursor, 2);
      if (args.cursor.kind === 'continuation') {
        if (broken) throw Error('lost tail');
        return page(args.scope, args.cursor, 2, [{ seq: 2, resource_kind: 'memory', resource_id: 'n', version: 2 }]);
      }
      const first = page(args.scope, args.cursor, 1, [{ seq: 1, resource_kind: 'memory', resource_id: 'n', version: 1 }]);
      first.has_more = true; first.continuation = { ...first.checkpoint, kind: 'continuation', through_seq: 2, covered_versions: first.covered_versions };
      first.checkpoint = null; first.covered_versions = null; return first;
    } });
  await changes.baseline(); await assert.rejects(changes.next(), /lost tail/);
  assert.ok(changes.cursors.every(cursor => cursor.after_seq === 0)); broken = false;
  const batch = await changes.next(); assert.deepEqual(sorted(batch.dirty), ['read', 'shown']); batch.accept();
  assert.ok(changes.cursors.every(cursor => cursor.after_seq === 2));
});

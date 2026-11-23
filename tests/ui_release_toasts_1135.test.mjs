import test from 'node:test';
import assert from 'node:assert/strict';
import { miniDocument } from './fixtures/mini_dom.mjs';
import { ReleaseToasts, releaseToastsFor, RELEASES_TOPIC } from '../web/release-toasts.mjs';
import { HealthLight } from '../web/health-light.mjs';
import { openLinksWith } from '../web/links.mjs';
import { parseRoute } from '../web/topic-navigation.mjs';

const A = 'a'.repeat(40), B = 'b'.repeat(40), dossier = 'm-' + 'c'.repeat(32);
const starting = (more = {}) => ({ phase: 'starting', number: 364, commit: B, started_ms: 1000, ...more });
const live = (more = {}) => starting({ phase: 'live', live_ms: 2000, ...more });
const failed = (more = {}) => starting({ phase: 'failed', failed_ms: 2000, ...more });
const answer = (release, commit_seq = 10, more = {}) => ({ instance_id: 'fixture', red: [], commit_seq, ...(release === undefined ? {} : { release }), ...more });
const deferred = () => { let resolve, reject; const promise = new Promise((a,b) => { resolve=a; reject=b; }); return { promise, resolve, reject }; };
const tick = () => new Promise(resolve => setImmediate(resolve));
const memory = () => { const rows = new Map(); return { getItem: k => rows.get(k) ?? null, setItem: (k,v) => rows.set(k,v) }; };
function fixture(storage = memory()) {
  const doc = miniDocument(); doc.body = doc.byId('body');
  const owner = new ReleaseToasts({ doc, instanceId: 'fixture', actor: 'person', storage });
  return { doc, owner, storage, notices: () => doc.body.querySelectorAll('.release-toast') };
}

test('1135 actual shared health read paints Starting, confirmed Live, Releases fallback and in-place dossier upgrade', async t => {
  const f = fixture(); let served = answer(starting()), reads = 0;
  const focus = f.doc.createElement('textarea'); focus.value = 'newer writing'; f.doc.body.append(focus); focus.focus();
  const health = new HealthLight({ link: f.doc.createElement('a'), feed: () => 'live', observe: a => f.owner.observe(a), read: async () => { reads++; return served; } });
  await health.load();
  assert.equal(f.notices()[0].children[0].textContent, 'Release 364 is starting');
  served = answer(live(), 11); await health.heard({ kind: 'commit', seq: 11, health: { seq: 11, red: [] } });
  assert.equal(reads, 2, 'the release shares the existing background read even when the feed has red keys');
  const toast = f.notices()[0], link = toast.querySelector('a');
  assert.equal(link.textContent, 'Release 364 is live');
  assert.deepEqual(parseRoute(new URL(link.href, 'https://fixture')), { kind: 'topic', id: RELEASES_TOPIC });
  link.focus(); served = answer(live({ dossier }), 12); await health.heard({ kind: 'commit', seq: 12, health: { seq: 12, red: [] } });
  assert.equal(f.notices()[0], toast); assert.equal(toast.querySelector('a'), link); assert.equal(f.doc.activeElement, link);
  assert.equal(focus.value, 'newer writing');
  assert.deepEqual(parseRoute(new URL(link.href, 'https://fixture')), { kind: 'topic', id: RELEASES_TOPIC, message: dossier });
  const opened = []; openLinksWith(route => opened.push(route)); t.after(() => openLinksWith(null));
  let prevented = 0; link.listeners.click({ button: 0, preventDefault() { prevented++; }, stopPropagation() {} });
  assert.equal(prevented, 1); assert.equal(opened[0].message, dossier, 'the existing guarded in-app link owner gets the upgraded route');
});

test('1135 initial already-live, repeated observations and reconnect do not replay historical phases', async () => {
  const f = fixture(); f.owner.observe(answer(live()));
  f.owner.observe(answer(live(), 11)); f.owner.observe(answer(undefined, 12)); f.owner.observe(answer(live(), 13));
  assert.equal(f.notices().length, 0);
});

test('1135 absent initial object is quiet and a later live transition never fabricates Starting', () => {
  const f = fixture(); f.owner.observe(answer(undefined)); f.owner.observe(answer(live(), 11));
  assert.equal(f.notices().length, 1); assert.equal(f.notices()[0].querySelector('a').textContent, 'Release 364 is live');
});

test('1135 the same pending release survives an absent restarted-process sample and completes once', () => {
  const f = fixture(); f.owner.observe(answer(starting())); const toast = f.notices()[0];
  f.owner.observe(answer(starting(), 11)); assert.equal(f.notices()[0], toast);
  f.owner.observe(answer(undefined, 12)); f.owner.observe(answer(live(), 13)); const completed = f.notices()[0];
  f.owner.observe(answer(live(), 14)); assert.equal(f.notices()[0], completed);
  assert.equal(completed.querySelector('a').textContent, 'Release 364 is live');
});

test('1135 failed or restored-old state cannot become Live; a fresh retry can later complete', () => {
  const f = fixture(); f.owner.observe(answer(starting())); f.owner.observe(answer(failed(), 11));
  assert.equal(f.notices().length, 0);
  f.owner.observe(answer(live({ number: 363, commit: A, started_ms: 100, live_ms: 200 }), 12));
  f.owner.observe(answer(live(), 13)); assert.equal(f.notices().length, 0, 'a terminal failed attempt cannot be revived by an old live sample');
  f.owner.observe(answer(starting({ started_ms: 3000 }), 14)); assert.equal(f.notices().length, 0, 'Starting was already shown for this release');
  f.owner.observe(answer(live({ started_ms: 3000, live_ms: 4000 }), 15)); assert.equal(f.notices().length, 1);
});

test('1135 wrong-commit and older-sequence completion cannot complete the pending identity', () => {
  const f = fixture(); f.owner.observe(answer(starting(), 20));
  const toast = f.notices()[0]; f.owner.observe(answer(live({ commit: A }), 21));
  assert.equal(f.notices()[0], toast); assert.equal(toast.querySelector('a'), null);
  f.owner.observe(answer(live(), 19)); assert.equal(f.notices()[0], toast);
  f.owner.observe(answer(live(), 22)); assert.equal(f.notices()[0].querySelector('a').textContent, 'Release 364 is live');
});

test('1135 a newer target fences a late older deploy object even if the enclosing read is newer', () => {
  const f = fixture(); f.owner.observe(answer(starting()));
  f.owner.observe(answer(starting({ number: 365, commit: A, started_ms: 3000 }), 11));
  const toast = f.notices()[0]; f.owner.observe(answer(live(), 12));
  assert.equal(f.notices()[0], toast); assert.equal(toast.children[0].textContent, 'Release 365 is starting');
});

test('1135 malformed, wrong-instance, recovering and unverified objects create no success', () => {
  for (const a of [answer(live(), 10, { instance_id: 'another' }), answer(live({ live_ms: null })), answer(starting({ number: 0 })),
    answer(live({ phase: 'recovering' })), answer(live({ dossier: '<a>wrong</a>' })), answer(live({ commit: 'wrong' }))]) {
    const f = fixture(); f.owner.observe(answer(starting())); f.owner.observe({ ...a, commit_seq: 11 });
    assert.equal(f.notices()[0].querySelector('a'), null);
  }
});

test('1135 a read failure and a read from before the live-feed floor deliver no release observation', async () => {
  const f = fixture(); let feed = 'live', served = answer(starting(), 5), failure = false;
  const health = new HealthLight({ link: f.doc.createElement('a'), feed: () => feed, observe: a => f.owner.observe(a), read: async () => { if (failure) throw Error('offline'); return served; } });
  await health.heard({ kind: 'state', state: 'live', seq: 8, health: { red: [], seq: 8 } }); assert.equal(f.notices().length, 0);
  failure = true; await health.load(); assert.equal(f.notices().length, 0);
  failure = false; served = answer(starting(), 9); feed = 'down'; await health.load(); assert.equal(f.notices().length, 0);
});

test('1135 shared reads coalesce same-commit reconnect and preserve a later commit without a second poller', async () => {
  const f = fixture(), first = deferred(); let reads = 0;
  const health = new HealthLight({ link: f.doc.createElement('a'), feed: () => 'live', observe: a => f.owner.observe(a),
    read: () => ++reads === 1 ? first.promise : Promise.resolve(answer(live(), 11)) });
  const task = health.heard({ kind: 'state', state: 'live', seq: 10, health: { red: [], seq: 10 } });
  health.heard({ kind: 'commit', seq: 10, health: { red: [], seq: 10 } }); assert.equal(reads, 1);
  health.heard({ kind: 'commit', seq: 11, health: { red: [], seq: 11 } }); first.resolve(answer(starting(), 10)); await task;
  assert.equal(reads, 2); assert.equal(f.notices().length, 0, 'an unread older Starting is not replayed after the newer floor');
  await tick(); assert.equal(reads, 2, 'settling starts no recurring poll');
});

test('1135 per-tab pending cache completes after renewal; a new page on an already completed release stays quiet', () => {
  const storage = memory(), first = fixture(storage); first.owner.observe(answer(starting())); first.owner.dispose();
  const resumed = fixture(storage); resumed.owner.observe(answer(live(), 11)); assert.equal(resumed.notices().length, 1);
  resumed.owner.dispose(); const reopened = fixture(storage); reopened.owner.observe(answer(live(), 12)); assert.equal(reopened.notices().length, 0);
});

test('1135 denied device storage retains in-memory once-only behavior and actor/instance isolation', () => {
  const f = fixture({ getItem() { throw Error('blocked'); }, setItem() { throw Error('blocked'); } });
  f.owner.observe(answer(starting())); const toast = f.notices()[0]; f.owner.observe(answer(starting(), 11)); assert.equal(f.notices()[0], toast);
  const same = releaseToastsFor(f.doc, 'fixture', 'person'); assert.equal(releaseToastsFor(f.doc, 'fixture', 'person'), same);
  same.observe(answer(starting())); const other = releaseToastsFor(f.doc, 'fixture', 'other');
  assert.equal(same.disposed, true); other.observe(answer(live(), 12)); assert.equal(f.doc.body.querySelectorAll('a').length, 0);
});

test('1135 dismissal and disposal do not resurrect on dossier enrichment or a late shared read', async () => {
  const f = fixture(); f.owner.observe(answer(starting())); f.owner.observe(answer(live(), 11));
  f.notices()[0].querySelector('button').onclick(); f.owner.observe(answer(live({ dossier }), 12)); assert.equal(f.notices().length, 0);
  const read = deferred(); const health = new HealthLight({ link: f.doc.createElement('a'), read: () => read.promise, observe: a => f.owner.observe(a) });
  const task = health.load(); f.owner.dispose(); read.resolve(answer(starting({ number: 365, started_ms: 3000 }), 13)); await task;
  assert.equal(f.notices().length, 0);
});

test('1135 Starting to Live preserves the connected dismiss control a person may be using', () => {
  const f = fixture(); f.owner.observe(answer(starting()));
  const close = f.notices()[0].querySelector('button'); close.focus();
  f.owner.observe(answer(live(), 11));
  assert.equal(f.notices()[0].querySelector('button'), close);
  assert.equal(close.isConnected, true); assert.equal(f.doc.activeElement, close);
});

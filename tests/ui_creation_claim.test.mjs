// A new outcome form open in two tabs: the second waits on the first tab's
// lock, an event the browser gives when that tab closes, never a timer. The
// real intent journal runs over a model of IndexedDB and of Web Locks that
// grants each lock in the order it was asked for.
import test from 'node:test';
import assert from 'node:assert/strict';
import { OutcomeCreation } from '../web/creation.mjs';
import { CreateOutcomeView } from '../web/creation-view.mjs';
import { openIntentJournal } from '../web/intent-journal.mjs';
import { dom } from './fixtures/ui_dom.mjs';

const bootstrap = { instance_id: 'fixture', actor: 'person', authority: { authority_id: 'authority', authority_epoch: 'epoch', continuity: 'initial' },
  limits: { body_utf8_bytes: 1024, workspace_members: 4, http_envelope_bytes: 2048 } };
const READ_ONLY = 'Open in another tab — read-only until that tab closes';
const STARTING = 'This outcome form is being started in another tab. It opens here when that tab closes.';
const flush = async () => { for (let n = 0; n < 20; n++) await Promise.resolve(); await new Promise(setImmediate); };

// Web Locks, exclusive only: a lock is held until its callback's promise
// settles, then granted to the next request in the order they were made.
function webLocks() {
  const holders = new Set(), queues = new Map(), asked = [];
  const start = (name, entry) => {
    holders.add(name);
    const held = Promise.resolve().then(() => entry.callback({ name, mode: 'exclusive' }));
    held.then(entry.resolve, entry.reject);
    held.catch(() => {}).finally(() => { holders.delete(name); const next = queues.get(name)?.shift(); if (next) start(name, next); });
  };
  return { asked, request(name, options, callback) {
    asked.push({ name, ifAvailable: options.ifAvailable === true });
    return new Promise((resolve, reject) => {
      const entry = { callback, resolve, reject };
      if (!holders.has(name) && !queues.get(name)?.length) { start(name, entry); return; }
      if (options.ifAvailable) { Promise.resolve().then(() => callback(null)).then(resolve, reject); return; }
      if (!queues.has(name)) queues.set(name, []);
      queues.get(name).push(entry);
      options.signal?.addEventListener('abort', () => {
        const queue = queues.get(name), at = queue.indexOf(entry);
        if (at >= 0) { queue.splice(at, 1); reject(Object.assign(Error('aborted'), { name: 'AbortError' })); }
      });
    });
  } };
}

// One IndexedDB database the tabs share, with strict durability.
function intentDatabase() {
  const data = new Map(); let created = false;
  return { data, open() {
    const request = {};
    queueMicrotask(() => {
      const db = { createObjectStore() { return { createIndex() {} }; }, close() {},
        transaction(_store, mode, options) {
          const tx = { durability: options?.durability === 'strict' ? 'strict' : 'default', abort() { tx.aborted = true; queueMicrotask(() => tx.onabort?.()); } };
          tx.objectStore = () => ({
            get(key) { const r = {}; queueMicrotask(() => r.onsuccess?.({ target: { result: structuredClone(data.get(key)) } })); return r; },
            put(value) { data.set(value.key, structuredClone(value)); } });
          queueMicrotask(() => queueMicrotask(() => queueMicrotask(() => { if (!tx.aborted) tx.oncomplete?.(); })));
          return tx;
        } };
      request.result = db;
      if (!created) { created = true; request.onupgradeneeded?.(); }
      request.onsuccess?.();
    });
    return request;
  } };
}

function browser(t) {
  const locks = webLocks(), database = intentDatabase(), saved = { navigator: Object.getOwnPropertyDescriptor(globalThis, 'navigator'), indexedDB: globalThis.indexedDB, document: globalThis.document };
  Object.defineProperty(globalThis, 'navigator', { value: { locks }, configurable: true, writable: true });
  globalThis.indexedDB = database; globalThis.document = dom();
  t.after(() => {
    if (saved.navigator) Object.defineProperty(globalThis, 'navigator', saved.navigator); else delete globalThis.navigator;
    globalThis.indexedDB = saved.indexedDB; globalThis.document = saved.document;
  });
  // Nothing here may wait on a timer: every timer is held and never run.
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
  const tab = async () => {
    const journal = await openIntentJournal({ instanceId: 'fixture', actor: 'person' }), gets = [];
    const get = journal.get; journal.get = id => { gets.push(id); return get(id); };
    const creation = new OutcomeCreation({ api: { bootstrap: async () => bootstrap }, bootstrap, journal, intentId: 'intent' });
    return { journal, creation, gets };
  };
  return { locks, database, tab };
}

test('a second tab on a saved form is read-only, and becomes editable once, when the first tab closes', async t => {
  const b = browser(t), first = await b.tab();
  await first.creation.load(); await first.creation.edit({ title: 'Kept' });
  const second = await b.tab();
  await second.creation.load();
  const view = new CreateOutcomeView({ host: document.body, creation: second.creation, open() {}, confirmed() {} });
  assert.equal(second.creation.readOnly, true);
  assert.equal(view.saveState.textContent, READ_ONLY);
  const waiting = second.creation.waiting;
  assert.ok(waiting instanceof Promise, 'the second tab waits on the lock');
  assert.deepEqual(b.locks.asked.at(-1), { name: b.locks.asked[0].name, ifAvailable: false }, 'asked without ifAvailable, so it is granted when free');
  await flush();
  assert.equal(second.creation.readOnly, true, 'while the first tab keeps the form it stays read-only');
  assert.equal(second.gets.length, 1);
  first.journal.close(); await flush();
  assert.equal(await waiting, true);
  assert.equal(second.gets.length, 2, 'the form is loaded again exactly once');
  assert.equal(second.creation.writable, true); assert.equal(second.creation.readOnly, false);
  assert.equal(second.creation.row.form.title, 'Kept');
  view.paint(); assert.equal(view.saveState.textContent, 'Form saved on this browser');
  await second.creation.edit({ title: 'Mine now' });
  assert.equal([...b.database.data.values()][0].form.title, 'Mine now', 'the second tab now writes the form');
});

test('a second tab on a form not saved yet says so, and creates the form when the first tab closes', async t => {
  const b = browser(t), first = await b.tab();
  assert.equal(await first.journal.claim('intent'), true, 'the first tab holds the form but has not written it');
  const second = await b.tab();
  await assert.rejects(second.creation.load(), error => error.message === STARTING);
  const waiting = second.creation.waiting;
  assert.ok(waiting instanceof Promise, 'it waits even though nothing was saved to load');
  await flush();
  assert.equal(b.database.data.size, 0);
  first.journal.close(); await flush();
  assert.equal(await waiting, true);
  assert.equal(second.creation.writable, true);
  assert.equal(b.database.data.size, 1, 'the second tab created the form, as the first would have');
});

test('a tab that closes while it waits loads nothing', async t => {
  const b = browser(t), first = await b.tab();
  await first.creation.load(); await first.creation.edit({ title: 'Kept' });
  const second = await b.tab();
  await second.creation.load();
  const waiting = second.creation.waiting;
  second.journal.close();
  assert.equal(await waiting, false);
  assert.equal(second.gets.length, 1); assert.equal(second.creation.writable, false);
});

test('a lock granted while the first load is still reading still makes the form editable', async t => {
  const b = browser(t), first = await b.tab();
  await first.creation.load(); await first.creation.edit({ title: 'Kept' });
  const second = await b.tab();
  let release; const gate = new Promise(resolve => release = resolve), get = second.journal.get;
  second.journal.get = async id => { await gate; second.journal.get = get; return get(id); };
  const loading = second.creation.load(); await flush();
  const waiting = second.creation.waiting;
  first.journal.close(); await flush();
  release(); await loading;
  assert.equal(await waiting, true);
  assert.equal(second.creation.writable, true, 'the load the lock runs reads the form after the grant, not the one already under way');
});

test('Try saving again shows only after saving on this browser failed on a form this tab holds, and saves once', async t => {
  globalThis.document = dom(); const saved = globalThis.document; t.after(() => { if (globalThis.document === saved) delete globalThis.document; });
  let failing = false, puts = 0;
  const journal = { claim: async () => true, claimWhenFree: () => new Promise(() => {}), get: async () => null,
    put: async row => { puts++; if (failing) throw Error('Storage failed'); return row; } };
  const creation = new OutcomeCreation({ api: { bootstrap: async () => bootstrap }, bootstrap, journal, intentId: 'intent' });
  await creation.load();
  const view = new CreateOutcomeView({ host: document.body, creation, open() {}, confirmed() {} });
  assert.equal(view.saveAgain.hidden, true, 'nothing failed: no button');
  failing = true; await creation.edit({ title: 'Kept' }).catch(() => {});
  assert.equal(creation.storageError, 'Storage failed'); view.paint();
  assert.equal(view.saveAgain.hidden, false); assert.equal(view.saveAgain.id, 'save-outcome-form'); assert.equal(view.saveAgain.textContent, 'Try saving again');
  for (const [why, change, undo] of [['read-only', () => { creation.writable = false; }, () => { creation.writable = true; }],
    ['parked', () => { creation.parked = true; }, () => { creation.parked = false; }],
    ['sent', () => { creation.row.envelope = { kind: 'workspace.create' }; }, () => { creation.row.envelope = null; }]]) {
    change(); view.paint(); assert.equal(view.saveAgain.hidden, true, `no button on a ${why} form`); undo();
  }
  failing = false; const before = puts; view.paint();
  await view.saveAgain.onclick(); await flush();
  assert.equal(puts, before + 1, 'pressing it saves once');
  assert.equal(creation.storageError, null); view.paint();
  assert.equal(view.saveAgain.hidden, true, 'and the button goes once it saved');
});

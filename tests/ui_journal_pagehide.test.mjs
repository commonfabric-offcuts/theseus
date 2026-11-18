import test from 'node:test';
import assert from 'node:assert/strict';

// Item 67: another tab asks whether a saved copy's writer is still open by
// looking for that writer's Web Lock (journal.mjs, free()). A page that goes
// into the back/forward cache is hidden but not gone, and a lock it still
// holds there makes its saved copy read "open in another tab" for as long as
// the page sits in the cache. So the journal lets its locks go on every
// pagehide from the moment it holds one, not only once the page's start has
// got as far as registering its own pagehide handler, which a page hidden
// earlier, or one whose start failed, never reaches.

// Web Locks as a browser keeps them: one holder per name, query lists them.
function fakeLocks() {
  const held = new Map();
  return {
    held,
    request(name, options, callback) {
      if (held.has(name)) return Promise.resolve(callback(null));
      const lock = { name, mode: options.mode };
      held.set(name, lock);
      return Promise.resolve(callback(lock)).finally(() => held.delete(name));
    },
    query: async () => ({ held: [...held.values()] }),
  };
}
function fakeIndexedDB(transaction = () => { throw Error('no store in this check'); }) {
  return { open() {
    const request = {};
    queueMicrotask(() => { request.result = { close() {}, transaction }; request.onsuccess(); });
    return request;
  } };
}
// A window that can be hidden: pagehide, as a browser sends it on entering the cache.
function fakeWindow() {
  const listeners = [];
  return { addEventListener: (name, fn) => listeners.push([name, fn]),
    hide: persisted => { for (const [name, fn] of listeners) if (name === 'pagehide') fn({ type: 'pagehide', persisted }); } };
}

test('a page hidden before its start registers anything lets its writer lock go', async t => {
  const locks = fakeLocks(), saved = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { locks } });
  globalThis.indexedDB = fakeIndexedDB();
  t.after(() => { Object.defineProperty(globalThis, 'navigator', saved); delete globalThis.indexedDB; });
  const { openJournal } = await import('../web/journal.mjs');
  const win = fakeWindow();
  const journal = await openJournal({ instanceId: 'i1', actor: 'person', win });
  const name = 'aim-next-recovery-writer:' + JSON.stringify(['i1', 'person', journal.writerId]);
  assert.ok(locks.held.has(name), 'the open journal holds its writer lock');
  // The page goes into the back/forward cache; nothing else ran.
  win.hide(true);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal((await navigator.locks.query()).held.some(lock => lock.name === name), false,
    'once the page is hidden, another tab finds the writer free');
});

test('item 721 recovery retains the originating request error before transaction abort supplies one', async t => {
  const saved = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { locks: fakeLocks() } });
  const failure = new DOMException('The selected file could not be stored', 'UnknownError');
  let puts = 0;
  globalThis.indexedDB = fakeIndexedDB(() => {
    const tx = { durability: 'strict', error: null, objectStore: () => ({
      get() { const request = {}; queueMicrotask(() => request.onsuccess({ target: { result: undefined } })); return request; },
      put() { puts++; queueMicrotask(() => tx.onerror({ target: { error: failure } })); },
    }) };
    return tx;
  });
  t.after(() => { Object.defineProperty(globalThis, 'navigator', saved); delete globalThis.indexedDB; });
  const { openJournal } = await import('../web/journal.mjs'), { editorKey } = await import('../web/editor.mjs');
  const journal = await openJournal({ instanceId: 'i1', actor: 'person', win: fakeWindow() });
  t.after(() => journal.close());
  const context = { instanceId: 'i1', actor: 'person', kind: 'reply', sourceRef: { kind: 'message', id: 'source' }, topicId: 'topic' };
  await assert.rejects(journal.save({ context, key: editorKey(context) }), error => error === failure, 'the exact originating storage error is retained');
  assert.equal(puts, 1, 'the real journal reached the failed storage boundary');
});

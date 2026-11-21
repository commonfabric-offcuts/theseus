// Separate browser work queue; no schema change to editor/image/creation data.
const scopeOf = binding => JSON.stringify([binding.instanceId, binding.actor]);
// The operation and Core receipts are immutable. Concurrent tabs may add Undo,
// never erase one another's kept choice or demote a known result to unknown.
export function mergeTopicCloseRecord(old, next) {
  if (!old) return next;
  const immutable = ['id', 'instanceId', 'actor', 'authority', 'workspaceId', 'topic', 'envelope', 'origin'];
  if (immutable.some(key => JSON.stringify(old[key]) !== JSON.stringify(next[key]))) throw Error('The saved topic action identity changed.');
  const row = structuredClone(next);
  row.receipt = old.receipt ?? row.receipt;
  if (old.receipt && next.receipt && JSON.stringify(old.receipt) !== JSON.stringify(next.receipt)) throw Error('The recorded operation answer changed.');
  if (old.undo) {
    const proposed = row.undo?.id === old.undo.id ? row.undo : null;
    row.undo = { ...old.undo, envelope: old.undo.envelope ?? proposed?.envelope ?? null, receipt: old.undo.receipt ?? proposed?.receipt ?? null };
  }
  if (row.receipt?.status === 'rejected') { row.phase = 'rejected'; row.error = row.receipt.error?.message ?? null; }
  else if (row.undo?.receipt) { row.phase = row.undo.receipt.status === 'committed' ? 'undone' : 'committed'; row.error = row.undo.receipt.error?.message ?? null; }
  else if (row.receipt) row.phase = row.undo?.envelope ? 'undo_pending' : 'committed';
  else if (old.phase === 'uncertain') row.phase = 'uncertain';
  return row;
}
export async function openTopicCloseJournal(binding, idb = globalThis.indexedDB) {
  if (!binding.instanceId || !binding.actor || !binding.authority?.authority_id || !binding.authority?.authority_epoch) throw Error('Topic actions need a confirmed reader and runtime.');
  const scope = scopeOf(binding);
  const db = await new Promise((resolve, reject) => {
    const request = idb.open('theseus-topic-close', 1);
    request.onupgradeneeded = () => {
      const store = request.result.createObjectStore('actions', { keyPath: 'key' });
      store.createIndex('recent', ['scope', 'at', 'id']);
      store.createIndex('pending', ['scope', 'pending', 'at', 'id']);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(Error('Saved topic actions are open in another browser version.'));
  });
  let closed = false;
  const listeners = new Set(), channel = typeof BroadcastChannel === 'function' ? new BroadcastChannel('theseus-topic-close:' + scope) : null;
  if (channel) channel.onmessage = event => { if (typeof event.data?.id === 'string') for (const listener of listeners) listener(event.data.id); };
  const publicRow = row => { if (!row) return null; const {key, scope: ignored, pending, ...value} = row; return value; };
  db.onversionchange = () => { closed = true; db.close(); channel?.close(); listeners.clear(); };
  const valid = row => row?.format === 1 && row.scope === scope && row.key === JSON.stringify([scope, row.id]) &&
    row.instanceId === binding.instanceId && row.actor === binding.actor && row.envelope?.operation_id === row.id &&
    row.envelope?.instance_id === binding.instanceId && row.envelope?.kind === 'topic.update' && row.envelope?.target?.topic_id === row.topic?.id &&
    row.workspaceId === row.topic?.workspace_id && ['pending', 'uncertain', 'committed', 'rejected', 'undo_pending', 'undone'].includes(row.phase);
  const transact = (mode, job) => new Promise((resolve, reject) => {
    if (closed) { reject(Error('Saved topic actions are closed.')); return; }
    const tx = db.transaction('actions', mode, mode === 'readwrite' ? { durability: 'strict' } : undefined);
    let value, failure;
    const fail = error => { failure = error; try { tx.abort(); } catch { reject(error); } };
    tx.oncomplete = () => resolve(value);
    tx.onabort = tx.onerror = () => reject(failure ?? tx.error ?? Error('The topic action could not be kept on this device.'));
    try {
      if (mode === 'readwrite' && tx.durability !== 'strict') throw Error('Strict topic-action durability is unavailable.');
      job(tx.objectStore('actions'), result => { value = result; }, fail);
    } catch (error) { fail(error); }
  });
  return {
    put(row, fresh = false) {
      let stored = { ...structuredClone(row), scope, key: JSON.stringify([scope, row.id]), pending: ['pending', 'uncertain', 'undo_pending'].includes(row.phase) ? 1 : 0 };
      if (!valid(stored)) return Promise.reject(Error('This saved topic action does not match the reader and instance.'));
      return transact('readwrite', (store, finish, fail) => {
        store.get(stored.key).onsuccess = event => {
          const old = event.target.result;
          if (old && (!valid(old) || JSON.stringify(old.envelope) !== JSON.stringify(stored.envelope))) { fail(Error('The saved operation changed. It has been kept.')); return; }
          if (fresh && old) { fail(Error('This topic action was already kept.')); return; }
          try {
            stored = mergeTopicCloseRecord(old, stored);
            stored.pending = ['pending', 'uncertain', 'undo_pending'].includes(stored.phase) ? 1 : 0;
            store.put(stored); finish(publicRow(stored));
          } catch (error) { fail(error); }
        };
      }).then(value => { try { channel?.postMessage({id: value.id}); } catch { /* Notification is not admission; the strict keep already completed. */ } return value; });
    },
    get(id) {
      return transact('readonly', (store, finish, fail) => {
        store.get(JSON.stringify([scope, id])).onsuccess = event => {
          const row = event.target.result;
          if (row && !valid(row)) fail(Error('The saved topic action cannot be read safely.')); else finish(publicRow(row));
        };
      });
    },
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    list(pending = false, limit = 20, cursor = null) {
      if (!Number.isInteger(limit) || limit < 1 || limit > 20) throw Error('Invalid saved-action page.');
      return transact('readonly', (store, finish, fail) => {
        const prefix = pending ? [scope, 1] : [scope], rows = [];
        const range = IDBKeyRange.bound(cursor ? [...prefix, cursor.at, cursor.id] : [...prefix, 0, ''], [...prefix, Number.MAX_SAFE_INTEGER, []], cursor !== null);
        store.index(pending ? 'pending' : 'recent').openCursor(range, pending ? 'next' : 'prev').onsuccess = event => {
          const cursor = event.target.result;
          if (!cursor || rows.length === limit) { finish(rows); return; }
          if (!valid(cursor.value)) { fail(Error('A saved topic action cannot be read safely. It has been kept.')); return; }
          const { key, scope: ignored, pending: flag, ...row } = cursor.value;
          rows.push(row); cursor.continue();
        };
      });
    },
    close() { closed = true; db.close(); channel?.close(); listeners.clear(); },
  };
}

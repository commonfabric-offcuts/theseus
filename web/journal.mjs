import { editorKey as keyFor } from './editor.mjs';

// Unacknowledged browser work, never a replacement for AIM's canonical store.
export class RecoveryJournal {
  constructor(backend, writerId) {
    if (!writerId) throw new Error('Recovery needs a tab identity.');
    this.backend = backend;
    this.writerId = writerId;
    this.queues = new Map();
  }
  id(editorKey) { return JSON.stringify([editorKey, this.writerId]); }
  enqueue(editorKey, task) {
    const previous = this.queues.get(editorKey) ?? Promise.resolve();
    const next = previous.catch(() => {}).then(task);
    this.queues.set(editorKey, next);
    next.then(() => { if (this.queues.get(editorKey) === next) this.queues.delete(editorKey); }, () => { if (this.queues.get(editorKey) === next) this.queues.delete(editorKey); });
    return next;
  }
  save(snapshot) {
    const stamp = crypto.randomUUID();
    const row = { id: this.id(snapshot.key), editorKey: snapshot.key, writerId: this.writerId,
      scope: JSON.stringify([snapshot.context.instanceId, snapshot.context.actor]), active: 1, stamp, snapshot: structuredClone(snapshot) };
    return this.enqueue(snapshot.key, async () => { await this.backend.put(row); return stamp; });
  }
  own(editorKey) { return this.enqueue(editorKey, () => this.backend.get(this.id(editorKey))); }
  candidates(editorKey, options) { return this.backend.forEditor(editorKey, options); }
  history(editorKey, options) { return this.backend.history(editorKey, options); }
  adopt(editorKey, candidate) { return this.enqueue(editorKey, () => this.backend.adopt(editorKey, candidate)); }
  removeExact(editorKey, stamp) { return this.enqueue(editorKey, () => this.backend.removeExact(this.id(editorKey), stamp)); }
  close() { return this.backend.close?.(); }
}

export async function openJournal({ instanceId, actor } = {}) {
  if (!instanceId || !actor) throw Error('Recovery needs the confirmed instance and actor.');
  if (!navigator.locks?.request) throw Error('Recovery ownership is unavailable in this browser. Keep this page open.');
  const scope = JSON.stringify([instanceId, actor]), writerId = crypto.randomUUID();
  const held = new Map();
  let closed = false;
  const lockName = writer => 'aim-next-recovery-writer:' + JSON.stringify([instanceId, actor, writer]);
  const lock = (writer, retain) => new Promise((resolve, reject) => {
    if (closed) { reject(Error('Recovery storage is closed.')); return; }
    if (held.has(writer)) { resolve(true); return; }
    navigator.locks.request(lockName(writer), { mode: 'exclusive', ifAvailable: true }, granted => {
      if (!granted) { resolve(false); return; }
      if (closed) { resolve(false); return; }
      if (!retain) { resolve(true); return; }
      const lifetime = new Promise(release => held.set(writer, release));
      resolve(true); return lifetime;
    }).catch(reject);
  });
  if (!await lock(writerId, true)) throw Error('This document could not acquire recovery ownership.');
  const release = () => { closed = true; for (const end of held.values()) end(); held.clear(); };
  let database;
  try { database = await new Promise((resolve, reject) => {
    let failed = false;
    const request = indexedDB.open('aim-next-pending', 2);
    request.onupgradeneeded = () => {
      const store = request.result.objectStoreNames.contains('editors')
        ? request.transaction.objectStore('editors') : request.result.createObjectStore('editors', { keyPath: 'id' });
      if (!store.indexNames.contains('editorKey')) store.createIndex('editorKey', 'editorKey');
      if (!store.indexNames.contains('scope')) store.createIndex('scope', 'scope');
      store.createIndex('scopedActive', ['scope', 'editorKey', 'active', 'id']);
      // One schema upgrade retains v1 rows. Discovery below never scans the
      // origin: both current candidates and history use the scoped index.
      store.openCursor().onsuccess = event => {
        const cursor = event.target.result;
        if (cursor) { cursor.update({ ...cursor.value, active: cursor.value.superseded_by ? 0 : 1 }); cursor.continue(); }
      };
    };
    request.onsuccess = () => { if (failed) request.result.close(); else resolve(request.result); };
    request.onerror = () => { failed = true; reject(request.error); };
    request.onblocked = () => { failed = true; reject(new Error('Recovery storage is blocked by another tab.')); };
  }); } catch (error) { release(); throw error; }
  database.onversionchange = () => { database.close(); release(); };
  // A previous identity is only a hint. No path reads, adopts, or writes its
  // rows without the same scope checks and lifetime ownership as discovery.
  const hintKey = 'aim-next-recovery-hint:' + scope;
  let previousWriter = null;
  try { previousWriter = sessionStorage.getItem(hintKey); sessionStorage.setItem(hintKey, writerId); } catch { /* hints are optional */ }

  const scopedKey = key => {
    let parts; try { parts = JSON.parse(key); } catch { throw Error('Invalid recovery editor identity.'); }
    if (!Array.isArray(parts) || parts[0] !== instanceId || parts[1] !== actor) throw Error('Recovery editor belongs to a different actor or instance.');
    return key;
  };
  const valid = (row, key) => {
    try {
      return row?.scope === scope && row.editorKey === scopedKey(key) && row.snapshot?.format === 1 &&
        row.snapshot.key === key && row.snapshot.context.instanceId === instanceId && row.snapshot.context.actor === actor &&
        keyFor(row.snapshot.context) === key && ['reply', 'note'].includes(row.snapshot.context.kind) &&
        typeof row.writerId === 'string' && row.writerId.length > 0 && typeof row.stamp === 'string' &&
        row.id === JSON.stringify([key, row.writerId]);
    } catch { return false; }
  };
  const transact = (mode, operation) => new Promise((resolve, reject) => {
    if (closed) { reject(Error('Recovery storage is closed.')); return; }
    const tx = database.transaction('editors', mode, mode === 'readwrite' ? { durability: 'strict' } : undefined);
    const store = tx.objectStore('editors');
    let result, failure;
    tx.oncomplete = () => resolve(result ?? null);
    tx.onerror = () => reject(failure ?? tx.error ?? new Error('Recovery storage failed.'));
    tx.onabort = () => reject(failure ?? tx.error ?? new Error('Recovery storage was interrupted.'));
    const fail = error => { failure = error; try { tx.abort(); } catch { reject(error); } };
    const get = (id, action) => { store.get(id).onsuccess = event => { try { action(event.target.result); } catch (error) { fail(error); } }; };
    try {
      if (mode === 'readwrite' && tx.durability !== 'strict') throw Error('Strict recovery durability is unavailable. Keep this page open.');
      operation(store, value => { result = value; }, get, fail);
    } catch (error) { fail(error); }
  });
  const page = async (key, active, { limit = 20, cursor = null } = {}) => {
    scopedKey(key);
    if (!Number.isInteger(limit) || limit < 1 || limit > 50 || (cursor !== null && typeof cursor !== 'string')) throw Error('Invalid recovery page.');
    const rows = await transact('readonly', (store, finish) => {
      const range = IDBKeyRange.bound([scope, key, active, cursor ?? ''], [scope, key, active, []], cursor !== null);
      store.index('scopedActive').getAll(range, limit + 1).onsuccess = event => finish(event.target.result);
    });
    const selected = rows.slice(0, limit), items = [];
    for (const row of selected) {
      if (!valid(row, key) || (active === 1 && (row.superseded_by || row.writerId === writerId))) continue;
      if (active === 0 || await lock(row.writerId, false)) items.push({ ...row, availability: 'available' });
      else items.push({ id: row.id, editorKey: row.editorKey, writerId: row.writerId, stamp: row.stamp, availability: 'open-in-another-tab' });
    }
    return { items, nextCursor: rows.length > limit ? selected.at(-1).id : null };
  };
  const journal = new RecoveryJournal({
    put: row => transact('readwrite', (store, _finish, get) => {
      if (!valid(row, row.editorKey) || row.writerId !== writerId || !held.has(writerId)) throw Error('Recovery write identity does not match this document.');
      get(row.id, existing => {
        if (existing && (!valid(existing, row.editorKey) || existing.superseded_by)) throw Error('Existing recovery ownership does not match this document.');
        store.put(row);
      });
    }),
    get: id => transact('readonly', (_store, finish, get) => {
      const [key, writer] = JSON.parse(id); scopedKey(key);
      get(id, row => {
        if (row && (!valid(row, key) || writer !== writerId || row.superseded_by)) throw Error('Recovery identity does not match this document.');
        finish(row);
      });
    }),
    forEditor: (key, options) => page(key, 1, options),
    history: (key, options) => page(key, 0, options),
    adopt: async (key, { id, stamp }) => {
      scopedKey(key);
      const source = await transact('readonly', (_store, finish, get) => get(id, finish));
      if (!valid(source, key) || source.stamp !== stamp || source.superseded_by || source.writerId === writerId) throw Error('This recovery version changed. Review it again.');
      if (!await lock(source.writerId, true)) throw Error('Open in another tab. Close that tab before retrying recovery.');
      return transact('readwrite', (store, finish, get) => get(id, current => {
        if (!valid(current, key) || current.stamp !== stamp || current.superseded_by || current.writerId !== source.writerId) throw Error('This recovery version changed. Review it again.');
        const ownId = JSON.stringify([key, writerId]);
        get(ownId, target => {
          if (target) throw Error('This document already has writing. Keep both versions for now.');
          const adopted = { ...current, id: ownId, writerId, stamp: crypto.randomUUID(), active: 1 };
          store.put(adopted);
          store.put({ ...current, stamp: crypto.randomUUID(), active: 0, superseded_by: writerId });
          finish(adopted);
        });
      }));
    },
    removeExact: (id, stamp) => transact('readwrite', (store, finish, get) => {
      const [key, writer] = JSON.parse(id); scopedKey(key);
      get(id, row => {
        if (writer === writerId && valid(row, key) && !row.superseded_by && row.stamp === stamp) { store.delete(id); finish(true); }
        else finish(false);
      });
    }),
    close: () => { database.close(); release(); },
  }, writerId);
  journal.previousWriter = previousWriter;
  return journal;
}

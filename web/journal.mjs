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
      scope: JSON.stringify([snapshot.context.instanceId, snapshot.context.actor]), stamp, snapshot: structuredClone(snapshot) };
    return this.enqueue(snapshot.key, async () => { await this.backend.put(row); return stamp; });
  }
  own(editorKey) { return this.enqueue(editorKey, () => this.backend.get(this.id(editorKey))); }
  candidates(editorKey) { return this.backend.forEditor(editorKey); }
  removeExact(editorKey, stamp) { return this.enqueue(editorKey, () => this.backend.removeExact(this.id(editorKey), stamp)); }
}

export async function openJournal() {
  let writerId = sessionStorage.getItem('aim-next-recovery-tab');
  if (!writerId) {
    writerId = crypto.randomUUID();
    sessionStorage.setItem('aim-next-recovery-tab', writerId);
  }
  const database = await new Promise((resolve, reject) => {
    const request = indexedDB.open('aim-next-pending', 1);
    request.onupgradeneeded = () => {
      const store = request.result.createObjectStore('editors', { keyPath: 'id' });
      store.createIndex('editorKey', 'editorKey');
      store.createIndex('scope', 'scope');
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error('Recovery storage is blocked by another tab.'));
  });
  database.onversionchange = () => database.close();
  const transact = (mode, operation) => new Promise((resolve, reject) => {
    const tx = database.transaction('editors', mode);
    const store = tx.objectStore('editors');
    let result;
    tx.oncomplete = () => resolve(result ?? null);
    tx.onerror = () => reject(tx.error ?? new Error('Recovery storage failed.'));
    tx.onabort = () => reject(tx.error ?? new Error('Recovery storage was interrupted.'));
    operation(store, value => { result = value; });
  });
  return new RecoveryJournal({
    put: row => transact('readwrite', store => { store.put(row); }),
    get: id => transact('readonly', (store, finish) => { store.get(id).onsuccess = event => finish(event.target.result); }),
    forEditor: key => transact('readonly', (store, finish) => {
      // Bound recovery discovery to the selected editor, never all origin data.
      store.index('editorKey').getAll(IDBKeyRange.only(key), 32).onsuccess = event => finish(event.target.result);
    }),
    removeExact: (id, stamp) => transact('readwrite', store => {
      store.get(id).onsuccess = event => {
        if (event.target.result?.stamp === stamp) store.delete(id);
      };
    }),
  }, writerId);
}

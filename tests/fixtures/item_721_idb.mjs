// Scoped, transactional IndexedDB/Web Lock model for below-browser contracts.
// It clones persisted records and commits only at transaction completion.
// Engine durability, native gestures and actual IDB backing remain native work.
export function journalEnvironment(t) {
  const names = ['indexedDB', 'navigator', 'IDBKeyRange', 'sessionStorage'];
  const saved = new Map(names.map(n => [n, Object.getOwnPropertyDescriptor(globalThis, n)]));
  const rows = new Map(), held = new Map(), hints = new Map(), transactions = [];
  const locks = {
    request(name, _options, callback) {
      if (held.has(name)) return Promise.resolve(callback(null));
      const lock = { name }; held.set(name, lock);
      return Promise.resolve(callback(lock)).finally(() => { if (held.get(name) === lock) held.delete(name); });
    },
    query: async () => ({ held: [...held.values()] }),
  };
  const transaction = (_store, mode, options) => {
    const changes = new Map(); let pending = 0, aborted = false, completed = false;
    const tx = { durability: options?.durability, abort() { aborted = true; queueMicrotask(() => tx.onabort?.()); } };
    transactions.push({ mode, options });
    const schedule = action => {
      pending++;
      queueMicrotask(() => {
        if (!aborted) action();
        if (!--pending) queueMicrotask(() => {
          if (pending || aborted || completed) return;
          completed = true;
          for (const [id, row] of changes) row === undefined ? rows.delete(id) : rows.set(id, row);
          tx.oncomplete?.();
        });
      });
    };
    const result = value => {
      const request = {}; schedule(() => request.onsuccess?.({ target: { result: structuredClone(value()) } })); return request;
    };
    tx.objectStore = () => ({
      get: id => result(() => changes.has(id) ? changes.get(id) : rows.get(id)),
      put(row) { const cloned = structuredClone(row); schedule(() => changes.set(row.id, cloned)); return {}; },
      delete(id) { schedule(() => changes.set(id, undefined)); },
      index(name) {
        if (name !== 'scopedActive') throw Error('Unexpected index');
        return { getAll(range, limit) {
          const [scope, key, active, cursor] = range.lower;
          return result(() => [...rows.values()].filter(r => r.scope === scope && r.editorKey === key && r.active === active &&
            (range.lowerOpen ? r.id > cursor : r.id >= cursor)).sort((a, b) => a.id < b.id ? -1 : 1).slice(0, limit));
        } };
      },
    });
    return tx;
  };
  const values = {
    navigator: { locks }, IDBKeyRange: { bound: (lower, upper, lowerOpen) => ({ lower, upper, lowerOpen }) },
    sessionStorage: { getItem: key => hints.get(key) ?? null, setItem: (key, value) => hints.set(key, value) },
    indexedDB: { open() {
      const request = {};
      queueMicrotask(() => { request.result = { close() {}, transaction }; request.onsuccess(); });
      return request;
    } },
  };
  for (const name of names) Object.defineProperty(globalThis, name, { configurable: true, value: values[name] });
  t.after(() => { for (const name of names) saved.get(name) ? Object.defineProperty(globalThis, name, saved.get(name)) : delete globalThis[name]; });
  return { rows, transactions, win: { addEventListener() {} } };
}

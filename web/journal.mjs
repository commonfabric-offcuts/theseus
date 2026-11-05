import { editorKey as keyFor } from './editor.mjs';
import { ownsBytes, readableUploads } from './upload-state.mjs';
const containsBytes = (value, seen = new Set()) => {
  if (value instanceof Blob) return true;
  if (!value || typeof value !== 'object' || seen.has(value)) return false;
  seen.add(value);
  return (value instanceof Map ? [...value.keys(), ...value.values()] : value instanceof Set ? [...value] : Object.values(value)).some(v => containsBytes(v, seen));
};

// Unacknowledged browser work, never a replacement for AIM's canonical store.
export class RecoveryJournal {
  constructor(backend, writerId) {
    if (!writerId) throw new Error('Recovery needs a tab identity.');
    this.backend = backend;
    this.writerId = writerId;
    this.queues = new Map();
  }
  id(editorKey) { return JSON.stringify([editorKey, this.writerId]); }
  row(snapshot) {
    return { id: this.id(snapshot.key), editorKey: snapshot.key, writerId: this.writerId,
      scope: JSON.stringify([snapshot.context.instanceId, snapshot.context.actor]), active: 1,
      stamp: crypto.randomUUID(), snapshot: structuredClone(snapshot) };
  }
  enqueue(editorKey, task) {
    const previous = this.queues.get(editorKey) ?? Promise.resolve();
    const next = previous.catch(() => {}).then(task);
    this.queues.set(editorKey, next);
    next.then(() => { if (this.queues.get(editorKey) === next) this.queues.delete(editorKey); }, () => { if (this.queues.get(editorKey) === next) this.queues.delete(editorKey); });
    return next;
  }
  save(snapshot, alreadyAcknowledged = () => false) {
    const stamp = crypto.randomUUID();
    const row = { id: this.id(snapshot.key), editorKey: snapshot.key, writerId: this.writerId,
      scope: JSON.stringify([snapshot.context.instanceId, snapshot.context.actor]), active: 1, stamp, snapshot: structuredClone(snapshot) };
    return this.enqueue(snapshot.key, async () => {
      if (alreadyAcknowledged()) return null;
      await this.backend.put(row); return stamp;
    });
  }
  saveLatest(key, snapshot, guard = () => true, acknowledged = () => false) {
    return this.enqueue(key, async () => {
      if (!guard()) throw Error('This image editor was replaced.');
      if (acknowledged()) return null;
      const row = this.row(snapshot());
      await this.backend.put(row, guard); return row.stamp;
    });
  }
  transition(key, snapshot, mutate, guard = () => true) {
    return this.enqueue(key, async () => {
      if (!guard()) throw Error('This image editor was replaced.');
      mutate();
      const row = this.row(snapshot());
      await this.backend.put(row, guard); return row.stamp;
    });
  }
  capture(key, snapshot, bytes, entry, guard) {
    return this.enqueue(key, async () => {
      if (!guard()) throw Error('This image selection no longer belongs to this editor.');
      entry.bytes_ref = bytes.id; entry.bytes_state = 'durable';
      try { await this.backend.capture(this.row(snapshot()), bytes, guard); }
      catch (error) { entry.bytes_ref = null; entry.bytes_state = 'memory-only'; throw error; }
    });
  }
  readBytes(key, id) { return this.enqueue(key, () => this.backend.readBytes(this.id(key), id)); }
  releaseBytes(key, snapshot, ids, guard = () => true, committed = () => {}) {
    return this.enqueue(key, async () => {
      if (!guard()) return false;
      const old = await this.backend.get(this.id(key));
      if (!old) return false;
      const next = this.row(snapshot());
      const released = await this.backend.releaseBytes(next, old.stamp, ids, guard);
      if (released) committed(next);
      return released;
    });
  }
  releaseExact(row, next, ids, guard, committed = () => {}) {
    return this.enqueue(row.editorKey, async () => {
      if (!guard()) return false;
      const released = await this.backend.releaseBytes(next, row.stamp, ids, guard);
      if (released) committed();
      return released;
    });
  }
  own(editorKey) { return this.enqueue(editorKey, () => this.backend.get(this.id(editorKey))); }
  candidates(editorKey, options) { return this.backend.forEditor(editorKey, options); }
  current(editorKey, ids) { return this.backend.currentCandidates(editorKey, ids); }
  async inspectCandidate(editorKey, candidate) {
    const row = this.backend.inspectCandidate ? await this.backend.inspectCandidate(editorKey, candidate) : await this.backend.get(candidate.id);
    if (!row || row.id !== candidate.id || row.stamp !== candidate.stamp || row.editorKey !== editorKey) throw Error('This saved copy changed. Review it again.');
    return row;
  }
  history(editorKey, options) { return this.backend.history(editorKey, options); }
  adopt(editorKey, candidate, guard = () => true) { return this.enqueue(editorKey, () => {
    if (!guard()) throw Error('The current writing changed. Review both versions again.');
    return this.backend.adopt(editorKey, candidate, guard);
  }); }
  removeExact(editorKey, stamp, current = () => true, retired = () => {}) {
    return this.enqueue(editorKey, async () => {
      if (!current()) return false;
      const removed = await this.backend.removeExact(this.id(editorKey), stamp);
      if (removed) retired();
      return removed;
    });
  }
  retireAcknowledged(editorKey, candidate, confirm) { return this.backend.retireAcknowledged(editorKey, candidate, confirm); }
  retireImageCandidate(editorKey, candidate, prove) { return this.backend.retireImageCandidate?.(editorKey, candidate, prove); }
  changeCandidateImages(editorKey, candidate, action) { return this.backend.changeCandidateImages(editorKey, candidate, action); }
  close() { return this.backend.close?.(); }
}

export async function openJournal({ instanceId, actor } = {}) {
  if (!instanceId || !actor) throw Error('Recovery needs the confirmed instance and actor.');
  if (!navigator.locks?.request) throw Error('Recovery ownership is unavailable in this browser. Keep this page open.');
  const scope = JSON.stringify([instanceId, actor]), writerId = crypto.randomUUID();
  const held = new Map();
  let closed = false;
  const lockName = writer => 'aim-next-recovery-writer:' + JSON.stringify([instanceId, actor, writer]);
  // Take this writer's lock and hold it until the journal closes.
  const lock = writer => new Promise((resolve, reject) => {
    if (closed) { reject(Error('Recovery storage is closed.')); return; }
    if (held.has(writer)) { resolve(true); return; }
    navigator.locks.request(lockName(writer), { mode: 'exclusive', ifAvailable: true }, granted => {
      if (!granted) { resolve(false); return; }
      if (closed) { resolve(false); return; }
      const lifetime = new Promise(release => held.set(writer, release));
      resolve(true); return lifetime;
    }).catch(reject);
  });
  // Whether no document holds this writer now. It takes no lock, so probes of
  // one writer, in this tab or another, never see each other as its holder.
  const free = async writer => {
    if (closed) throw Error('Recovery storage is closed.');
    if (held.has(writer)) return true;
    const name = lockName(writer);
    return !(await navigator.locks.query()).held.some(lock => lock.name === name);
  };
  if (!await lock(writerId)) throw Error('This document could not acquire recovery ownership.');
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
      return row?.scope === scope && !containsBytes(row) && row.editorKey === scopedKey(key) && [1, 2].includes(row.snapshot?.format) &&
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
      const item = await listed(row, key, active);
      if (item) items.push(item);
    }
    return { items, nextCursor: rows.length > limit ? selected.at(-1).id : null };
  };
  // How a stored row is listed for an editor, or null when it is not listed.
  const listed = async (row, key, active) => {
    if (active === 1 && (row.superseded_by || row.writerId === writerId)) return null;
    if (!valid(row, key)) {
      if (row.snapshot?.context && (row.snapshot.context.instanceId !== instanceId || row.snapshot.context.actor !== actor)) return null;
      return { id: row.id, editorKey: key, stamp: row.stamp, availability: 'unreadable', uploadPresent: row.snapshot?.format === 2 };
    }
    if (active === 0 || await free(row.writerId)) return { ...row, availability: 'available' };
    return { id: row.id, editorKey: row.editorKey, writerId: row.writerId, stamp: row.stamp, availability: 'open-in-another-tab', uploadPresent: row.snapshot.format === 2 };
  };
  const validBytes = (bytes, row) => {
    if (!bytes || row.active !== 1 || row.superseded_by || bytes.kind !== 'upload-bytes-v1' ||
        bytes.scope !== scope || bytes.editorKey !== row.editorKey || Object.hasOwn(bytes, 'active') ||
        bytes.id !== JSON.stringify([row.editorKey, 'upload-bytes', bytes.selection_id]) || !(bytes.blob instanceof Blob)) return false;
    const owners = row.snapshot.uploadState?.entries?.filter(e => e.bytes_ref === bytes.id);
    if (owners?.length !== 1 || owners[0].selection_id !== bytes.selection_id) return false;
    const file = owners[0].file;
    return file && ['name', 'size', 'type', 'last_modified'].every(k => file[k] === bytes.metadata?.[k]) && bytes.blob.size === file.size;
  };
  const journal = new RecoveryJournal({
    put: (row, guard = () => true) => transact('readwrite', (store, _finish, get) => {
      if (!valid(row, row.editorKey) || row.writerId !== writerId || !held.has(writerId)) throw Error('Recovery write identity does not match this document.');
      get(row.id, existing => {
        if (existing && (!valid(existing, row.editorKey) || existing.superseded_by)) throw Error('Existing recovery ownership does not match this document.');
        if (!guard()) throw Error('This editor was replaced before its recovery write.');
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
    // The active candidates among these IDs, listed as a page lists them now.
    // A copy another document recovered is listed where it moved.
    currentCandidates: async (key, ids) => {
      scopedKey(key);
      if (!Array.isArray(ids) || ids.some(id => typeof id !== 'string')) throw Error('Invalid recovery IDs.');
      const rows = await transact('readonly', (store, finish) => {
        const found = [], seen = new Set();
        let left = 0;
        const read = id => {
          if (seen.has(id)) return;
          seen.add(id); left++;
          store.get(id).onsuccess = event => {
            const row = event.target.result;
            if (row?.scope === scope && row.editorKey === key && row.active === 0 && row.superseded_by) read(JSON.stringify([key, row.superseded_by]));
            else found.push(row);
            if (!--left) finish(found);
          };
        };
        for (const id of ids) read(id);
        if (!left) finish(found);
      });
      const items = [];
      for (const row of rows) {
        if (!row || row.scope !== scope || row.editorKey !== key || row.active !== 1) continue;
        const item = await listed(row, key, 1);
        if (item) items.push(item);
      }
      return items;
    },
    inspectCandidate: async (key, candidate) => {
      scopedKey(key);
      const row = await transact('readonly', (_store, finish, get) => get(candidate.id, finish));
      if (!row || row.scope !== scope || row.editorKey !== key || row.stamp !== candidate.stamp || row.active !== 1 || row.superseded_by ||
          row.id !== JSON.stringify([key, row.writerId]) || !await free(row.writerId)) throw Error('This saved copy changed or is open in another tab. Review it again.');
      return row;
    },
    history: (key, options) => page(key, 0, options),
    capture: (row, bytes, guard) => transact('readwrite', (store, _finish, get) => {
      if (!valid(row, row.editorKey) || row.writerId !== writerId || !held.has(writerId) || !guard()) throw Error('Image capture ownership changed.');
      get(row.id, existing => {
        if (existing && (!valid(existing, row.editorKey) || existing.superseded_by)) throw Error('Image capture ownership changed.');
        get(bytes.id, previous => {
          if (previous || !validBytes(bytes, row) || !guard()) throw Error('Image bytes cannot be replaced.');
          store.put(bytes); store.put(row);
        });
      });
    }),
    readBytes: (id, bytesId) => transact('readonly', (_store, finish, get) => get(id, row => {
      if (!row || !valid(row, row.editorKey) || row.writerId !== writerId || !held.has(writerId) || row.superseded_by) throw Error('Image recovery ownership changed.');
      get(bytesId, bytes => { if (!validBytes(bytes, row)) throw Error('The retained image bytes are unavailable.'); finish(bytes); });
    })),
    releaseBytes: (next, stamp, ids, guard) => transact('readwrite', (store, finish, get) => get(next.id, row => {
      if (!valid(row, next.editorKey) || row.stamp !== stamp || row.writerId !== writerId || !held.has(writerId) || row.superseded_by || !guard()) { finish(false); return; }
      let remaining = ids.length;
      if (!remaining) { finish(false); return; }
      for (const id of ids) get(id, bytes => {
        if (!validBytes(bytes, row) || !guard() || next.snapshot.uploadState?.entries.some(e => e.bytes_ref === id)) throw Error('Image release ownership changed.');
        store.delete(id);
        if (!--remaining) { store.put(next); finish(true); }
      });
    })),
    adopt: async (key, { id, stamp }, guard = () => true) => {
      scopedKey(key);
      const source = await transact('readonly', (_store, finish, get) => get(id, finish));
      if (!valid(source, key) || (source.snapshot.format === 2 && !readableUploads(source.snapshot)) || source.stamp !== stamp || source.superseded_by || source.writerId === writerId || !guard()) throw Error('This recovery version changed. Review it again.');
      if (!await lock(source.writerId)) throw Error('Open in another tab. Close that tab before retrying recovery.');
      return transact('readwrite', (store, finish, get) => get(id, current => {
        if (!valid(current, key) || current.stamp !== stamp || current.superseded_by || current.writerId !== source.writerId) throw Error('This recovery version changed. Review it again.');
        const ownId = JSON.stringify([key, writerId]);
        get(ownId, target => {
          if (target || !guard()) throw Error('This document already has writing. Keep both versions for now.');
          const adopted = { ...current, id: ownId, writerId, stamp: crypto.randomUUID(), active: 1 };
          const history = structuredClone(current);
          for (const entry of history.snapshot.uploadState?.entries ?? []) {
            if (entry.bytes_ref) { entry.bytes_ref = null; entry.bytes_state = 'moved'; entry.moved_to = ownId; }
          }
          store.put(adopted);
          store.put({ ...history, stamp: crypto.randomUUID(), active: 0, superseded_by: writerId });
          finish(adopted);
        });
      }));
    },
    removeExact: (id, stamp) => transact('readwrite', (store, finish, get) => {
      const [key, writer] = JSON.parse(id); scopedKey(key);
      get(id, row => {
        if (writer === writerId && held.has(writerId) && valid(row, key) && row.active === 1 && !row.superseded_by && row.stamp === stamp && !ownsBytes(row.snapshot)) { store.delete(id); finish(true); }
        else finish(false);
      });
    }),
    retireAcknowledged: async (key, candidate, confirm) => {
      scopedKey(key);
      const matches = row => valid(row, key) && row.active === 1 && !row.superseded_by && row.writerId !== writerId &&
        row.writerId === candidate.writerId && row.id === candidate.id && row.stamp === candidate.stamp;
      const source = await transact('readonly', (_store, finish, get) => get(candidate.id, finish));
      if (!matches(source) || !await lock(source.writerId)) return false;
      const captured = await transact('readonly', (_store, finish, get) => get(candidate.id, finish));
      if (!matches(captured) || !await confirm(structuredClone(captured))) return false;
      return transact('readwrite', (store, finish, get) => get(candidate.id, current => {
        if (matches(current) && held.has(current.writerId) && !ownsBytes(current.snapshot)) { store.delete(current.id); finish(true); }
        else finish(false);
      }));
    },
    retireImageCandidate: async (key, candidate, prove) => {
      scopedKey(key);
      const matches = row => valid(row, key) && row.snapshot.format === 2 && row.active === 1 && !row.superseded_by &&
        row.writerId !== writerId && row.writerId === candidate.writerId && row.id === candidate.id && row.stamp === candidate.stamp;
      const source = await transact('readonly', (_store, finish, get) => get(candidate.id, finish));
      if (!matches(source) || !await lock(source.writerId)) return null;
      const captured = await transact('readonly', (_store, finish, get) => get(candidate.id, finish));
      if (!matches(captured)) return null;
      const proof = await prove(structuredClone(captured));
      if (!proof) return null;
      return transact('readwrite', (store, finish, get) => get(candidate.id, current => {
        if (!matches(current) || !held.has(current.writerId)) { finish(null); return; }
        const complete = () => {
          if (proof.retire && !ownsBytes(proof.next.snapshot)) { store.delete(current.id); finish({ retired: true }); }
          else { if (proof.ids.length) store.put(proof.next); finish({ row: proof.next }); }
        };
        let remaining = proof.ids.length;
        if (!remaining) { complete(); return; }
        for (const id of proof.ids) get(id, bytes => {
          if (!validBytes(bytes, current) || proof.next.snapshot.uploadState.entries.some(e => e.bytes_ref === id)) throw Error('Retained image ownership changed.');
          store.delete(id); if (!--remaining) complete();
        });
      }));
    },
    changeCandidateImages: async (key, candidate, action) => {
      scopedKey(key);
      const matches = row => valid(row, key) && readableUploads(row.snapshot) && row.active === 1 && !row.superseded_by &&
        row.id === candidate.id && row.stamp === candidate.stamp && row.writerId !== writerId;
      const row = await transact('readonly', (_store, finish, get) => get(candidate.id, finish));
      if (!matches(row) || !await lock(row.writerId)) throw Error('This saved copy changed or is open in another tab. Review it again.');
      return transact('readwrite', (store, finish, get) => get(candidate.id, current => {
        if (!matches(current) || !held.has(current.writerId)) throw Error('This saved copy changed. Review it again.');
        const next = structuredClone(current), state = next.snapshot.uploadState;
        next.stamp = crypto.randomUUID(); state.revision++;
        if (action.kind === 'remove') {
          const removed = new Set();
          for (const e of state.entries) if (e.selected && e.owner.kind === 'cycle') {
            if (e.association?.media_id ?? e.retained_ref?.id) removed.add(e.association?.media_id ?? e.retained_ref.id);
            e.selected = false; e.association = null; e.version++;
          }
          if (next.snapshot.draft.attachments.some(r => removed.has(r.id))) {
            next.snapshot.draft.attachments = next.snapshot.draft.attachments.filter(r => !removed.has(r.id)); next.snapshot.localVersion++;
          }
          store.put(next); finish(next);
        } else if (action.kind === 'discard') {
          const e = state.entries.find(e => e.selection_id === action.selectionId);
          if (!e || e.selected && e.owner.kind === 'cycle' || !e.bytes_ref) throw Error('Remove the saved image selection before discarding its retained file.');
          const id = e.bytes_ref;
          get(id, bytes => {
            if (!validBytes(bytes, current)) throw Error('The retained byte ownership could not be confirmed.');
            e.bytes_ref = null; e.bytes_state = 'released'; e.discarded = true; e.version++;
            store.delete(id); store.put(next); finish(next);
          });
        } else throw Error('Unknown saved-image action.');
      }));
    },
    close: () => { database.close(); release(); },
  }, writerId);
  journal.previousWriter = previousWriter;
  return journal;
}

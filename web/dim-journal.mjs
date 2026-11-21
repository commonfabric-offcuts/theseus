// Independently keyed durable writers. A live tab owns its row with the same
// Web Locks primitive used by the editor/creation journals. Recovery copies
// abandoned rows before removing their exact keys; Core publication follows.
export async function openDimJournal({ storage, scope, id, validate = () => {}, locks = globalThis.navigator?.locks }) {
  if (!storage || !locks?.request) throw Error('This browser could not keep pending Dim changes safely.');
  const prefix = `aim-next.rail-dimming.pending.v1:${scope}:`, held = new Map();
  let writer = id();
  const keyFor = writer => prefix + writer;
  let closed = false;
  const close = () => { closed = true; for (const release of held.values()) release(); held.clear(); };
  const release = name => { held.get(name)?.(); held.delete(name); };
  const claim = name => new Promise((resolve,reject) => {
    locks.request('aim-next-dim-writer:'+keyFor(name),{mode:'exclusive',ifAvailable:true},lock=>{
      if (!lock || closed) { resolve(false); return; }
      const lifetime = new Promise(release=>held.set(name,release)); resolve(true); return lifetime;
    }).catch(reject);
  });
  try {
    if (!await claim(writer)) throw Error('The Dim journal identity could not be claimed.');
    const keys = [...new Set(Array.from({length:storage.length},(_,n)=>storage.key(n)))];
    const rows = [], sources = [];
    for (const key of keys) {
      if (typeof key !== 'string' || !key.startsWith(prefix) || key === keyFor(writer)) continue;
      const prior = key.slice(prefix.length);
      if (!prior || !await claim(prior)) continue; // Another live tab keeps its own queue.
      const raw = storage.getItem(key); if (raw === null) { release(prior); continue; }
      let row;
      try {
        row = JSON.parse(raw);
        if (row?.version !== 1 || row.scope !== scope || row.writer !== prior || !Number.isFinite(row.saved_ms) || !row.snapshot)
          throw Error('Unreadable or foreign Dim writer');
        validate(row.snapshot);
      } catch { release(prior); continue; } // Preserve this exact row; it cannot block other writers.
      rows.push(row); sources.push(key);
    }
    rows.sort((a,b)=>a.saved_ms-b.saved_ms || a.writer.localeCompare(b.writer));
    // Adopt the largest claimed row. Replacing its value is atomic and avoids
    // needing quota for a second full copy just to resume a single writer.
    // Other abandoned rows remain intact until the merged value is kept here.
    if (rows.length) writer = rows.reduce((a,b)=>JSON.stringify(a).length>=JSON.stringify(b).length?a:b).writer;
    const save = snapshot => {
      if (closed || !held.has(writer)) throw Error('The Dim journal owner changed.');
      if (!snapshot.intents.length && !snapshot.prepared.length) { storage.removeItem(keyFor(writer)); return; }
      storage.setItem(keyFor(writer),JSON.stringify({version:1,scope,writer,saved_ms:Date.now(),snapshot}));
    };
    return {
      writer, recovered:rows.map(row=>row.snapshot), save, close,
      completeRecovery(snapshot) {
        // A crash before this write leaves the old rows intact. A crash during
        // removal leaves copies whose intent/operation IDs are deduplicated on
        // the next recovery. No new Core operation has been published yet.
        save(snapshot);
        for (const key of sources) {
          if (key === keyFor(writer)) continue;
          storage.removeItem(key);
          if (storage.getItem(key) !== null) throw Error('An old Dim journal is still present; publication waits.');
        }
        for (const name of [...held.keys()]) if (name !== writer) { held.get(name)(); held.delete(name); }
      },
    };
  } catch (error) { close(); throw error; }
}

const copy = structuredClone;
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const content = source => ({ title: source.title, body: source.body ?? '',
  attachments: source.attachments.map(({ id }) => ({ id })), references: copy(source.references) });
const authority = bootstrap => ({ authority_id: bootstrap.authority.authority_id, authority_epoch: bootstrap.authority.authority_epoch });
const readOnly = new Set(['FORBIDDEN', 'OUTCOME_REACHED', 'AUTHORITY_CHANGED']);

// The one revision stream behind Text and Cards. The journal owns only local,
// unconfirmed writing. Core still owns the page and every confirmed revision.
export class NotebookWriting {
  constructor({ item, bootstrap, api, store, changed = () => {}, delay = 600 }) {
    Object.assign(this, { item, bootstrap, api, store, changed, delay });
    this.base = null; this.value = null; this.pending = null; this.conflict = null;
    this.error = null; this.readOnly = false; this.running = null; this.timer = null;
    this.active = false; this.closed = false; this.serial = Promise.resolve(); this.localVersion = 0; this.images = [];
    this.journalPending = 0; this.journalError = null;
  }
  get dirty() { return Boolean(this.value && !same(this.value, this.base?.content)); }
  get busy() { return Boolean(this.running || this.pending); }
  get binding() { return { instance_id: this.bootstrap.instance_id, actor_id: this.bootstrap.actor, item_id: this.item }; }
  snapshot() {
    return copy({ v: 1, binding: this.binding, base: this.base, value: this.value, pending: this.pending,
      conflict: this.conflict, localVersion: this.localVersion, images: this.images });
  }
  persist() {
    const snapshot = this.snapshot();
    this.journalPending++;
    const next = this.serial.catch(() => {}).then(() => this.store.put(snapshot))
      .then(result => {this.journalError=null;return result;}, error=>{this.journalError=error.message;throw error;})
      .finally(()=>{this.journalPending--;this.notify();});
    this.serial = next;
    return next;
  }
  notify() { this.changed(this); }
  async read() {
    const source = await this.api.view('memory_current', { item_id: this.item });
    if (source.instance_id !== this.bootstrap.instance_id || source.source_ref?.kind !== 'memory' ||
        source.source_ref.id !== this.item || !Number.isInteger(source.source_ref.revision)) throw Error('This is not the requested Notebook page.');
    return { revision: source.source_ref.revision, content: content(source), source };
  }
  async open() {
    const held = await this.store.get();
    if (held) {
      if (held.v !== 1 || !same(held.binding, this.binding)) throw Error('The saved writing belongs to a different Notebook page.');
      Object.assign(this, copy({ base: held.base, value: held.value, pending: held.pending,
        conflict: held.conflict, localVersion: held.localVersion, images: held.images ?? [] }));
    }
    if (this.pending) await this.flush();
    await this.refresh();
    if (this.dirty && !this.pending && !this.conflict && !this.readOnly) this.schedule();
    this.notify();
  }
  edit(patch) {
    if (!this.value || this.readOnly || this.closed) return false;
    const next = { ...this.value, ...copy(patch) };
    if (same(next, this.value)) return false;
    this.value = next; this.localVersion++; this.error = null;
    this.persist().then(() => this.schedule()).catch(error => { this.error = `Device copy unavailable: ${error.message}. Keep this page open.`; this.notify(); });
    this.notify(); return true;
  }
  schedule() {
    clearTimeout(this.timer);
    if (!this.dirty) this.dirtySince=null;
    if (!this.dirty || this.pending || this.conflict || this.readOnly || this.closed) return;
    this.dirtySince ??= Date.now();
    this.timer = setTimeout(() => { this.timer = null; this.flush(); }, Math.max(0,Math.min(this.delay,3000-(Date.now()-this.dirtySince))));
  }
  async refresh() {
    if (this.running || this.pending || this.closed) return false;
    try {
      const latest = await this.read();
      if (this.running || this.pending || this.closed || (this.base && latest.revision <= this.base.revision)) return true;
      if (this.base && (this.dirty || this.active)) {
        // Never replace an editor under someone's cursor, even between two
        // autosaves. Keep both versions until the person has seen the change.
        this.conflict = latest;
      } else {
        this.base = latest; this.value = copy(latest.content); this.conflict = null;
      }
      await this.persist(); this.error = null; this.notify(); return true;
    } catch (error) { this.error = `The page could not be read: ${error.message}`; this.notify(); return false; }
  }
  envelope() {
    return { v: 1, instance_id: this.bootstrap.instance_id, operation_id: crypto.randomUUID(), kind: 'memory.revise',
      target: { item_id: this.item }, expected: { authority: authority(this.bootstrap), item_revision: this.base.revision }, args: copy(this.value) };
  }
  flush() {
    clearTimeout(this.timer); this.timer = null;
    if (this.running) return this.running;
    if (this.closed || this.readOnly || this.conflict || !this.base || (!this.pending && !this.dirty)) return Promise.resolve(null);
    this.running = this.send().finally(() => { this.running = null; this.notify(); if (!this.error) this.schedule(); });
    this.notify(); return this.running;
  }
  async send() {
    try {
      this.pending ??= this.envelope();
      // The full frozen envelope is durable before any request leaves.
      await this.persist();
      const sent = copy(this.pending), receipt = await this.api.command(sent);
      if (receipt?.instance_id !== sent.instance_id || receipt.operation_id !== sent.operation_id || receipt.kind !== sent.kind ||
          !['committed', 'rejected', 'retryable'].includes(receipt.status)) throw Error('Save confirmation does not match the request.');
      if (receipt.status === 'retryable') throw Error(receipt.error?.message ?? 'Theseus is busy.');
      if (receipt.recorded !== true) throw Error(receipt.error?.message ?? 'Save confirmation is uncertain.');
      if (receipt.status === 'committed') {
        if (receipt.result?.item_id !== this.item || receipt.result.revision !== sent.expected.item_revision + 1 ||
            receipt.result.source_ref?.kind !== 'memory' || receipt.result.source_ref.id !== this.item ||
            receipt.result.source_ref.revision !== receipt.result.revision) throw Error('The saved revision does not match this page.');
        const source = { ...this.base.source, ...copy(sent.args), source_ref: copy(receipt.result.source_ref),
          attachments: sent.args.attachments.map(ref => this.base.source.attachments.find(a => a.id === ref.id) ?? ref) };
        this.base = { revision: receipt.result.revision, content: copy(sent.args), source };
        this.pending = null; this.error = null; this.dirtySince=null;
        await this.persist(); this.notify();
        return receipt;
      }
      this.pending = null;
      if (receipt.error?.code === 'REVISION_CONFLICT') this.conflict = await this.read();
      else {
        this.readOnly = readOnly.has(receipt.error?.code);
        this.error = receipt.error?.message ?? 'Theseus did not save the page.';
      }
      await this.persist(); this.notify(); return receipt;
    } catch (error) { this.error = `Not saved yet: ${error.message}`; this.notify(); return null; }
  }
  async resolve(useMine) {
    if (!this.conflict || this.pending || this.running || this.readOnly) return;
    this.base = this.conflict; this.conflict = null;
    if (!useMine) this.value = copy(this.base.content);
    this.error = null; this.localVersion++;
    await this.persist(); this.notify(); this.schedule();
  }
  close() { this.closed = true; clearTimeout(this.timer); this.timer = null; }
}

// A journal for this instance, person and page only. A Web Lock prevents a
// second tab from replacing this tab's unconfirmed request. Another device
// is still fenced by the expected Core revision.
export async function notebookStore(binding, win = globalThis) {
  if (!win.navigator?.locks || !win.indexedDB) throw Error('Safe Notebook writing needs device storage and tab ownership.');
  const key = JSON.stringify(binding);
  let release;
  const acquired = new Promise((resolve, reject) => {
    win.navigator.locks.request('theseus-notebook-writing:' + key, { ifAvailable: true }, async lock => {
      if (!lock) { resolve(false); return; }
      const lifetime = new Promise(done => { release = done; });
      resolve(true); await lifetime;
    }).catch(reject);
  });
  if (!await acquired) throw Error('This Notebook page is being written in another tab. Close that editor, then reload here.');
  let db;
  try {
    db = await new Promise((resolve, reject) => {
      const request = win.indexedDB.open('theseus-notebook-writing-v1', 1);
      request.onupgradeneeded = () => request.result.createObjectStore('writing');
      request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
    });
  } catch (error) { release(); throw error; }
  const run = (mode, act) => new Promise((resolve, reject) => {
    const tx = db.transaction('writing', mode), request = act(tx.objectStore('writing'));
    tx.oncomplete = () => resolve(request.result); tx.onerror = tx.onabort = () => reject(tx.error ?? Error('Device storage failed.'));
  });
  return { get: () => run('readonly', store => store.get(key)), put: value => run('readwrite', store => store.put(copy(value), key)),
    close: () => { db.close(); release(); } };
}

// Editing a message the person sent (docs/message-edit.md): the writing behind
// the Reader's edit mode (message-edit.mjs). Modelled on NotebookWriting
// (notebook-writing.mjs): the device keeps only writing Core has not
// confirmed, and Core owns the message and every revision of it.
//
// The base revision is fixed when Edit opens. The frozen envelope of a Save is
// journaled on the device, under a Web Lock, before it is sent; a retry, a
// Try again and a reload all send that same envelope, under its operation id,
// and Core answers with what it recorded for it. Only "Save mine" after a
// conflict makes a new operation, on the newer base.
import { isBusy, unconfirmed } from './api.mjs';

const copy = structuredClone;
const integer = n => Number.isSafeInteger(n) && n >= 1;
// The revision a message's item or source carries: 1 when never edited, and
// for an item from before revisions were kept, which never was.
export const revisionOf = item => (integer(item?.revision) ? item.revision : 1);
// Whether a message's words were changed after it was sent: Core says when.
export const wasEdited = item => Number.isSafeInteger(item?.edited_ms) || revisionOf(item) > 1;
// Who sees Edit: the author of the message, a person (agents correct with a
// follow-up, docs/agent-guide.md), in a topic they can read and whose outcome
// is not reached. Core decides again on every Save.
export function mayEdit(item, { actor, actorKind, unavailable = false, reached = false }) {
  return Boolean(item && typeof actor === 'string' && item.author_id === actor && actorKind === 'human' && !unavailable && !reached);
}
// What a refusal leaves: these say the person may not edit it now, so the
// words are kept and only Cancel is offered.
const READ_ONLY = new Set(['FORBIDDEN', 'OUTCOME_REACHED', 'AUTHORITY_CHANGED']);
// The states the edit mode paints (message-edit.mjs). The last four end it.
export const ENDED = new Set(['saved', 'unchanged', 'cancelled', 'discarded']);

export class MessageEditWriting {
  // message: { id, revision, body, attachments } as the Reader shows it.
  // read(): the message's latest saved words, { revision, body }.
  // authority(): the runtime authority the envelope is fenced on.
  constructor({ message, bootstrap, api, store, read, authority = () => bootstrap.authority, changed = () => {} }) {
    if (typeof message?.id !== 'string' || typeof message.body !== 'string') throw Error('Edit needs the message as the Reader shows it.');
    Object.assign(this, { message: copy(message), bootstrap, api, store, read, authority, changed });
    this.base = { revision: revisionOf(message), body: message.body };
    this.value = message.body; this.pending = null; this.conflict = null; this.result = null;
    this.state = 'editing'; this.error = null; this.readOnly = false; this.journalError = null;
    this.sending = null; this.closed = false; this.serial = Promise.resolve();
  }
  get binding() { return { instance_id: this.bootstrap.instance_id, actor_id: this.bootstrap.actor, message_id: this.message.id }; }
  // A message with images may lose its words; one without may not (EMPTY_MESSAGE).
  get empty() { return !this.value.trim() && !(this.message.attachments ?? []).length; }
  get dirty() { return this.value !== this.base.body; }
  notify() { this.changed(this); }
  snapshot() {
    return { v: 1, binding: this.binding, base: this.base, value: this.value, pending: this.pending, conflict: this.conflict };
  }
  // The device copy, one write after another. Nothing to keep clears it.
  persist() {
    const snapshot = copy(this.snapshot()), clear = !this.dirty && !this.pending && !this.conflict;
    const next = this.serial.catch(() => {}).then(() => (clear ? this.store.delete() : this.store.put(snapshot)))
      .then(() => { this.journalError = null; }, error => { this.journalError = error.message; throw error; });
    this.serial = next.catch(() => {});
    return next;
  }
  async open() { await this.load(); return this.resume(); }
  // The words kept from an earlier Edit, read before the field is shown, so
  // the field never shows other words first and nothing typed is replaced.
  async load() {
    const held = await this.store.get();
    if (held) {
      if (held.v !== 1 || JSON.stringify(held.binding) !== JSON.stringify(this.binding)) throw Error('The kept edit belongs to another message.');
      // Writing kept from an earlier Edit keeps the base it was written on: a
      // revision saved since then makes its Save a conflict, never an overwrite.
      Object.assign(this, copy({ base: held.base, value: held.value, pending: held.pending, conflict: held.conflict }));
      if (this.conflict) this.state = 'conflict';
    }
    this.notify();
  }
  // A Save whose answer never came (the page was closed or reloaded while
  // saving) goes again as it was made: Core is asked first, then sent.
  resume() {
    if (this.pending) { this.state = 'uncertain'; return this.retry(); }
    return null;
  }
  edit(body) {
    // A Save not yet confirmed goes again as it was made, so its words stay
    // as they are until Core answers it (Try again).
    if (this.closed || this.sending || this.pending || this.readOnly || this.state === 'saving' || typeof body !== 'string') return false;
    if (body === this.value) return false;
    this.value = body;
    if (!this.conflict && !this.pending) { this.state = 'editing'; this.error = null; }
    this.persist().catch(() => {}).finally(() => this.notify());
    this.notify();
    return true;
  }
  envelope() {
    const { authority_id, authority_epoch } = this.authority();
    return { v: 1, instance_id: this.bootstrap.instance_id, operation_id: crypto.randomUUID(), kind: 'message.edit',
      target: { message_id: this.message.id }, expected: { authority: { authority_id, authority_epoch }, message_revision: this.base.revision },
      args: { body: this.value } };
  }
  // Save (⌘Return). Blank words send nothing (Save is off), and so do words
  // the same as the saved ones: that ends the edit as Cancel would.
  async save() {
    if (this.closed || this.sending || this.readOnly || this.conflict) return null;
    if (this.pending) return this.retry();
    if (this.empty) return null;
    if (!this.dirty) { await this.end('unchanged'); return null; }
    this.pending = this.envelope();
    // The whole frozen envelope is on the device before any request leaves.
    try { await this.persist(); }
    catch (error) { this.pending = null; this.state = 'editing'; this.error = `Not saved: this device could not keep the edit (${error.message}).`; this.notify(); return null; }
    return this.send();
  }
  async send() {
    if (this.sending) return this.sending;
    this.state = 'saving'; this.error = null; this.notify();
    this.sending = (async () => {
      let receipt;
      try { receipt = await this.api.command(copy(this.pending)); }
      catch (error) { return this.unanswered(error); }
      return this.take(receipt);
    })().finally(() => { this.sending = null; this.notify(); });
    return this.sending;
  }
  unanswered(error) {
    // Busy: Theseus took nothing, and the same request goes again. No word
    // at all: it may have been saved, so Try again asks Core first.
    this.state = isBusy(error) ? 'busy' : unconfirmed(error) ? 'uncertain' : 'failed';
    this.error = this.state === 'failed' ? error.message : null;
    return null;
  }
  async take(receipt) {
    const sent = this.pending;
    if (receipt?.instance_id !== sent.instance_id || receipt.operation_id !== sent.operation_id || receipt.kind !== sent.kind ||
        !['committed', 'rejected', 'retryable'].includes(receipt.status)) { this.state = 'uncertain'; return null; }
    if (receipt.status === 'retryable') { this.state = 'busy'; return receipt; }
    if (receipt.status === 'committed') {
      const result = receipt.result;
      if (receipt.recorded !== true || result?.message_id !== this.message.id || result.revision !== sent.expected.message_revision + 1) {
        this.state = 'uncertain'; return null;
      }
      this.result = { revision: result.revision, edited_ms: result.edited_ms ?? null, body: sent.args.body };
      this.pending = null;
      await this.end('saved');
      return receipt;
    }
    this.pending = null;
    const code = receipt.error?.code;
    if (code === 'REVISION_CONFLICT') {
      // Someone saved another revision since Edit opened: the person chooses.
      let latest = null;
      try { latest = await this.read(); } catch { /* shown without the saved words */ }
      const revision = latest?.revision ?? receipt.error.current_versions?.message_revision ?? null;
      this.conflict = { revision, body: typeof latest?.body === 'string' ? latest.body : null };
      this.state = 'conflict';
    } else {
      this.state = 'refused';
      this.readOnly = READ_ONLY.has(code);
      // Too long or blank: the words stay in the field and on the device, and changed words go as a new
      // operation. Any other refusal says Core's own words.
      this.error = code === 'EMPTY_MESSAGE' ? 'Not saved: a message needs words.' : code === 'BODY_TOO_LARGE' ? 'Not saved: too long'
        : `Not saved: ${receipt.error?.message ?? 'Theseus refused the edit.'}`;
    }
    await this.persist().catch(() => {});
    return receipt;
  }
  // Try again: after no answer, Core is asked what it recorded for the
  // operation first, and only an operation it does not know is sent again;
  // after a busy answer the same request goes again.
  async retry() {
    if (this.closed || this.sending || !this.pending) return null;
    if (this.state === 'uncertain') {
      this.state = 'saving'; this.notify();
      let answer;
      try { answer = await this.api.view('operation', { operation_id: this.pending.operation_id }); }
      catch (error) { this.unanswered(error); if (this.state !== 'busy') this.state = 'uncertain'; this.notify(); return null; }
      if (answer?.recorded === true && answer.status !== 'unknown') { const taken = await this.take(answer); this.notify(); return taken; }
    }
    return this.send();
  }
  // The conflict's choice: "Save mine" saves these words on the newer
  // revision, as a new operation; "Use saved" lets them go.
  async resolve(mine) {
    if (this.state !== 'conflict' || !this.conflict || this.sending) return null;
    if (!Number.isSafeInteger(this.conflict.revision)) return null;
    this.base = { revision: this.conflict.revision, body: this.conflict.body ?? this.base.body };
    this.conflict = null;
    if (!mine) { this.value = this.base.body; await this.end('discarded'); return null; }
    this.state = 'editing';
    if (!this.dirty) { await this.end('unchanged'); return null; }
    return this.save();
  }
  // Cancel: the edit's writing goes, and the message stays as it was saved.
  async cancel() {
    if (this.sending) return false;
    this.value = this.base.body; this.pending = null; this.conflict = null;
    await this.end('cancelled');
    return true;
  }
  async end(state) {
    this.state = state; this.error = null;
    if (state !== 'saved') this.value = state === 'unchanged' ? this.value : this.base.body;
    this.pending = null; this.conflict = null;
    try { await this.serial; await this.store.delete(); } catch (error) { this.journalError = error.message; }
    this.notify();
  }
  // Escape, or the Reader closing: the edit mode goes and its writing stays
  // on the device, for the next Edit of this message.
  close() { this.closed = true; this.store.close?.(); }
}

// The device copy of one message's edit, for this instance and person only.
// A Web Lock keeps a second tab from replacing this tab's unconfirmed Save;
// another device is fenced by the base revision.
export async function messageEditStore(binding, win = globalThis) {
  if (!win.navigator?.locks || !win.indexedDB) throw Error('Editing a message needs device storage, which this browser does not offer here.');
  const key = JSON.stringify(binding);
  let release;
  const acquired = new Promise((resolve, reject) => {
    win.navigator.locks.request('theseus-message-edit:' + key, { ifAvailable: true }, async lock => {
      if (!lock) { resolve(false); return; }
      const lifetime = new Promise(done => { release = done; });
      resolve(true); await lifetime;
    }).catch(reject);
  });
  if (!await acquired) throw Error('This message is being edited in another tab. Finish there first.');
  let db;
  try {
    db = await new Promise((resolve, reject) => {
      const request = win.indexedDB.open('theseus-message-edit-v1', 1);
      request.onupgradeneeded = () => { if (!request.result.objectStoreNames.contains('writing')) request.result.createObjectStore('writing'); };
      request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
    });
  } catch (error) { release(); throw error; }
  const transaction = (mode, act) => new Promise((resolve, reject) => {
    const tx = db.transaction('writing', mode);
    let result;
    try { result = act(tx.objectStore('writing')); } catch (error) { tx.abort(); reject(error); return; }
    tx.oncomplete = () => resolve(typeof result === 'function' ? result() : result);
    tx.onerror = tx.onabort = () => reject(tx.error ?? Error('Device storage failed.'));
  });
  return {
    get: () => transaction('readonly', writing => { const request = writing.get(key); return () => request.result ?? null; }),
    put: value => transaction('readwrite', writing => { writing.put(value, key); }),
    delete: () => transaction('readwrite', writing => { writing.delete(key); }),
    close: () => { db.close(); release(); },
  };
}

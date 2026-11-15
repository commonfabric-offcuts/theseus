// Editing a message the person sent (docs/message-edit.md): the writing behind
// the Reader's edit mode (message-edit.mjs). Modelled on NotebookWriting
// (notebook-writing.mjs): the device keeps only writing Core has not
// confirmed, and Core owns the message, every revision of it, and the edit's
// draft.
//
// Opening Edit takes the message's one edit session in Core (message.edit_open),
// which holds the message from agents until this device saves it or leaves the
// edit, or the hold lapses. The draft is saved in Core as it is written
// (message.edit_draft), and each save renews the hold. Every ending sends one
// message.edit_close; Escape and unload send nothing, and the hold lapses.
//
// The frozen envelope of a Save is journaled on the device, under a Web Lock,
// before it is sent; a retry, a Try again and a reload all send that same
// envelope, under its operation id, and Core answers with what it recorded for
// it. Only "Save mine" after a conflict makes a new operation, on the newer base.
import { isBusy, unconfirmed } from './api.mjs';

const copy = structuredClone;
const integer = n => Number.isSafeInteger(n) && n >= 1;
const realTimers = { setTimeout: (fn, ms) => setTimeout(fn, ms), clearTimeout: id => clearTimeout(id), now: () => Date.now() };
const bytes = text => new TextEncoder().encode(text).length;
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
// How long Core holds the message after the last renewal, unless edit_open says (capabilities' limits.edit_hold_ms).
export const HOLD_MS = 120000;
// Edit could not start: what the Reader says, and the row on the device is left as it was.
const startFailure = words => Error(`Edit could not start: ${words}`);

export class MessageEditWriting {
  // message: { id, revision, body, attachments } as the Reader shows it.
  // read(): the message's latest saved words, { revision, body }.
  // authority(): the runtime authority each envelope is fenced on.
  // timers: setTimeout, clearTimeout and now, for the draft's debounce and the renewal's 30 seconds.
  constructor({ message, bootstrap, api, store, read, authority = () => bootstrap.authority, changed = () => {}, timers = realTimers,
    holdMs = HOLD_MS, saveDelayMs = 450, maxSaveDelayMs = 2000 }) {
    if (typeof message?.id !== 'string' || typeof message.body !== 'string') throw Error('Edit needs the message as the Reader shows it.');
    Object.assign(this, { message: copy(message), bootstrap, api, store, read, authority, changed, timers, holdMs, saveDelayMs, maxSaveDelayMs });
    this.base = { revision: revisionOf(message), body: message.body };
    this.value = message.body; this.pending = null; this.conflict = null; this.result = null;
    this.state = 'editing'; this.error = null; this.readOnly = false; this.journalError = null;
    this.sending = null; this.closed = false; this.serial = Promise.resolve();
    // The session: this device's holder, the session revision Core last confirmed, the words Core last confirmed
    // (kept), and the operation of a close that got no answer (closing).
    this.holder = null; this.sessionRevision = null; this.kept = null; this.closing = null;
    // fromDevice: the words came from the device row. started: edit_open committed. over: an ending began.
    this.fromDevice = false; this.started = false; this.over = false; this.resumed = false;
    // elsewhere: another device took the session. draftClosed: Core has no open session for draft saves.
    this.elsewhere = false; this.draftClosed = false; this.tooLong = null;
    // Draft saves: the debounce, the one chain they go through, the request in flight, and one that got no answer.
    this.timer = null; this.drafting = Promise.resolve(); this.draftRequest = null; this.lostDraft = null; this.lastRenewal = null;
    // Session commands in flight, whether one's outcome is unknown, and the highest edit_session change read meanwhile.
    this.inFlight = 0; this.unknown = false; this.seen = null;
  }
  get binding() { return { instance_id: this.bootstrap.instance_id, actor_id: this.bootstrap.actor, message_id: this.message.id }; }
  // A message with images may lose its words; one without may not (EMPTY_MESSAGE).
  get empty() { return !this.value.trim() && !(this.message.attachments ?? []).length; }
  get dirty() { return this.value !== this.base.body; }
  // Core has confirmed the words in the field.
  get confirmed() { return this.value === this.kept && !this.elsewhere && !this.draftClosed; }
  // Draft saves go while this device holds an open session it can write to.
  get live() {
    return this.started && !this.over && !this.closed && !this.elsewhere && !this.draftClosed && !this.readOnly &&
      typeof this.holder === 'string' && integer(this.sessionRevision);
  }
  notify() { this.changed(this); }
  snapshot() {
    return { v: 1, binding: this.binding, base: this.base, value: this.value, pending: this.pending, conflict: this.conflict,
      holder: this.holder, session_revision: this.sessionRevision, kept: this.kept, closing: null };
  }
  // The device copy, one write after another. It stays while the edit is unended, so a reload rejoins its session.
  persist(row = null) {
    const snapshot = copy(row ?? this.snapshot());
    const next = this.serial.catch(() => {}).then(() => this.store.put(snapshot))
      .then(() => { this.journalError = null; }, error => { this.journalError = error.message; throw error; });
    this.serial = next.catch(() => {});
    return next;
  }
  clearDevice() {
    const next = this.serial.catch(() => {}).then(() => this.store.delete());
    this.serial = next.catch(() => {});
    return next;
  }
  async open() { await this.load(); await this.start(); return this.resume(); }
  // The words kept from an earlier Edit, read before the field is shown, so
  // the field never shows other words first and nothing typed is replaced.
  async load() {
    const held = await this.store.get();
    if (held) {
      if (held.v !== 1 || JSON.stringify(held.binding) !== JSON.stringify(this.binding)) throw Error('The kept edit belongs to another message.');
      this.holder = typeof held.holder === 'string' ? held.holder : null;
      // A close that got no answer goes first (start). An abandoned Edit keeps its unconfirmed writing beside it.
      if (typeof held.closing === 'string') this.closing = held.closing;
      if (typeof held.value === 'string') {
        // Writing kept from an earlier Edit keeps the base it was written on: a
        // revision saved since then makes its Save a conflict, never an overwrite.
        // A row from before sessions has no holder and no kept words: its words are unconfirmed.
        Object.assign(this, copy({ base: held.base, value: held.value, pending: held.pending, conflict: held.conflict }));
        this.sessionRevision = integer(held.session_revision) ? held.session_revision : null;
        this.kept = typeof held.kept === 'string' ? held.kept : null;
        this.fromDevice = true;
        if (this.conflict) this.state = 'conflict';
      }
    }
    this.notify();
  }
  sessionEnvelope(kind, expected, args, operation_id = crypto.randomUUID()) {
    const { authority_id, authority_epoch } = this.authority();
    return { v: 1, instance_id: this.bootstrap.instance_id, operation_id, kind, target: { message_id: this.message.id },
      expected: { authority: { authority_id, authority_epoch }, ...expected }, args };
  }
  exact(receipt, sent) {
    return receipt?.instance_id === sent.instance_id && receipt.operation_id === sent.operation_id && receipt.kind === sent.kind &&
      ['committed', 'rejected', 'retryable'].includes(receipt.status);
  }
  // One message.edit_close of this holder: 'closed' or 'refused' (both end it here), or 'unanswered' with whether Theseus was busy.
  async sendClose(operationId) {
    const sent = this.sessionEnvelope('message.edit_close', {}, { holder: this.holder }, operationId);
    let receipt;
    try { receipt = await this.api.command(copy(sent)); } catch (error) { return { outcome: 'unanswered', busy: isBusy(error) }; }
    if (!this.exact(receipt, sent)) return { outcome: 'unanswered', busy: false };
    if (receipt.status === 'retryable') return { outcome: 'unanswered', busy: true };
    return { outcome: receipt.status === 'committed' ? 'closed' : 'refused' };
  }
  // Opening Edit takes the session. A close kept from an earlier Edit goes first, once, under its own operation;
  // then message.edit_open, and only its answer opens the edit mode. Throws what the Reader says when it cannot.
  async start() {
    if (this.closing) {
      const answer = await this.sendClose(this.closing);
      if (answer.outcome === 'unanswered') throw startFailure(answer.busy ? 'Theseus was busy' : 'Theseus did not answer');
      // Closed, or refused (another device holds it, or the close can never succeed): a fresh holder. The row is
      // written again below without the close, keeping any writing it carried (a journaled Save goes in resume).
      this.closing = null; this.holder = null;
    }
    if (!this.holder) {
      this.holder = crypto.randomUUID();
      await this.persist();
    }
    const sent = this.sessionEnvelope('message.edit_open', {}, { holder: this.holder });
    this.inFlight++;
    let receipt;
    try { receipt = await this.api.command(copy(sent)); }
    catch (error) { throw startFailure(isBusy(error) ? 'Theseus was busy' : 'Theseus did not answer'); }
    finally { this.inFlight--; }
    if (!this.exact(receipt, sent)) throw startFailure('Theseus did not answer');
    if (receipt.status === 'retryable') throw startFailure('Theseus was busy');
    if (receipt.status !== 'committed') throw startFailure(receipt.error?.message ?? 'Theseus refused it');
    const r = receipt.result;
    if (r?.message_id !== this.message.id || !integer(r.session_revision) || typeof r.draft !== 'string' || !integer(r.base_revision) ||
        typeof r.base_words !== 'string') throw startFailure('Theseus did not answer as it should');
    this.sessionRevision = r.session_revision; this.lastRenewal = this.timers.now();
    if (integer(r.hold_ms)) this.holdMs = r.hold_ms;
    this.started = true; this.elsewhere = false; this.draftClosed = false;
    // Words on this device that Core has not confirmed, or that differ from their base, open as they are, with
    // their base; otherwise the field opens on Core's draft and its base.
    const deviceWords = this.fromDevice && (Boolean(this.pending) || this.value !== this.kept || this.value !== this.base.body);
    if (!deviceWords) {
      this.base = { revision: r.base_revision, body: r.base_words }; this.value = r.draft; this.kept = r.draft;
      if (!this.conflict) this.state = 'editing';
    } else if (this.value === r.draft) this.kept = r.draft;
    await this.persist().catch(() => {});
    this.settle(r.session_revision);
    // Device words other than Core's draft become the draft at once (a journaled Save goes as it was made instead).
    if (deviceWords && !this.pending && this.value !== r.draft) this.flushDraft();
    this.notify();
  }
  // A Save whose answer never came (the page was closed or reloaded while
  // saving) goes again as it was made: Core is asked first, then sent.
  resume() {
    if (this.pending) { this.resumed = true; this.state = 'uncertain'; return this.retry(); }
    return null;
  }
  edit(body) {
    // A Save not yet confirmed goes again as it was made, so its words stay
    // as they are until Core answers it (Try again).
    if (this.closed || this.over || this.sending || this.pending || this.readOnly || this.state === 'saving' || typeof body !== 'string') return false;
    if (body === this.value) return false;
    this.value = body;
    // Words still too long for a draft save keep saying so; any other change starts editing again.
    const tooLong = this.tooLong !== null && bytes(body) >= this.tooLong;
    if (!this.conflict && !this.pending && !tooLong) { this.state = 'editing'; this.error = null; }
    this.persist().catch(() => {}).finally(() => this.notify());
    if (this.live) this.scheduleDraft();
    this.notify();
    return true;
  }
  // A touch of the field (input, a key, focus, a press): once a quarter of the hold has passed since Core last
  // renewed it, the current words are saved at once, which renews it. No timer runs: a field left alone lapses.
  touch() {
    if (!this.live || this.draftRequest || this.lastRenewal === null) return false;
    if (this.timers.now() - this.lastRenewal < this.holdMs / 4) return false;
    this.flushDraft();
    return true;
  }
  scheduleDraft() {
    const save = () => { this.flushDraft(); };
    if (!this.timer) this.timer = { maximum: this.timers.setTimeout(save, this.maxSaveDelayMs) };
    else this.timers.clearTimeout(this.timer.idle);
    this.timer.idle = this.timers.setTimeout(save, this.saveDelayMs);
  }
  cancelDraft() {
    if (!this.timer) return;
    this.timers.clearTimeout(this.timer.idle); this.timers.clearTimeout(this.timer.maximum); this.timer = null;
  }
  // Draft saves go one after another; a scheduled one is folded into this one.
  flushDraft() {
    this.cancelDraft();
    const next = this.drafting.then(() => this.draftOnce());
    this.drafting = next.catch(() => {});
    return next;
  }
  async draftOnce(again = false) {
    if (!this.live) return;
    // Too long: draft saves pause until the words are shorter than those Core refused.
    if (this.tooLong !== null && !this.lostDraft && bytes(this.value) >= this.tooLong) return;
    // One whose answer was lost goes again under its own operation, and Core answers with what it recorded.
    const sent = this.lostDraft ?? this.sessionEnvelope('message.edit_draft', { session_revision: this.sessionRevision },
      { holder: this.holder, body: this.value, base_revision: this.base.revision });
    this.lostDraft = null; this.inFlight++;
    const request = this.api.command(copy(sent));
    this.draftRequest = request.then(() => {}, () => {});
    let receipt = null;
    try { receipt = await request; }
    catch (error) { this.lostDraft = sent; this.unknown = unconfirmed(error); }
    finally { this.inFlight--; this.draftRequest = null; }
    if (receipt && !this.exact(receipt, sent)) { this.lostDraft = sent; this.unknown = true; receipt = null; }
    if (receipt?.status === 'retryable') { this.lostDraft = sent; this.unknown = false; receipt = null; }
    if (!receipt) { this.settle(null); this.notify(); return; }
    this.unknown = false;
    let revision = null;
    if (receipt.status === 'committed') {
      revision = receipt.result?.session_revision ?? null;
      // Taken at once, before the device write below: this save's own edit_session change may be read meanwhile.
      if (integer(revision) && revision > (this.sessionRevision ?? 0)) this.sessionRevision = revision;
      this.kept = sent.args.body; this.lastRenewal = this.timers.now(); this.tooLong = null;
      if (this.state === 'refused' && !this.readOnly && !this.pending) { this.state = 'editing'; this.error = null; }
      await this.persist().catch(() => {});
      // A resend carried the words of its first send: words typed since go as the next draft save.
      if (this.value !== this.kept && this.live && !this.timer) this.scheduleDraft();
    } else {
      const code = receipt.error?.code;
      if (code === 'EDIT_TAKEN') { this.goElsewhere(); return; }
      if (code === 'EDIT_CLOSED') this.draftClosed = true;
      else if (code === 'BODY_TOO_LARGE') { this.tooLong = bytes(sent.args.body); this.state = 'refused'; this.error = 'Not saved: too long'; }
      else if (READ_ONLY.has(code)) { this.readOnly = true; this.state = 'refused'; this.error = `Not saved: ${receipt.error?.message ?? 'Theseus refused the edit.'}`; }
      else if (code === 'REVISION_CONFLICT') {
        // Only this holder can have written (another meets EDIT_TAKEN first): the same words go once more.
        const current = receipt.error?.current_versions?.session_revision;
        if (integer(current)) this.sessionRevision = current;
        if (!again && integer(current)) { this.settle(null); return this.draftOnce(true); }
      }
    }
    this.settle(revision);
    this.notify();
  }
  // An actor-scope edit_session change of this message (freshness.mjs): above this page's own session revision,
  // with none of its session commands in flight, another device took the edit. One read while a command is out is
  // compared once it answers (settle).
  sessionChanged(version) {
    if (!integer(version) || !this.started || this.over || this.elsewhere) return;
    if (this.inFlight > 0 || this.unknown) { this.seen = Math.max(this.seen ?? 0, version); return; }
    if (version > this.sessionRevision) this.goElsewhere();
  }
  settle(revision) {
    if (integer(revision) && revision > (this.sessionRevision ?? 0)) this.sessionRevision = revision;
    if (this.inFlight > 0 || this.unknown) return;
    const seen = this.seen; this.seen = null;
    if (seen !== null && seen > this.sessionRevision && !this.over) this.goElsewhere();
  }
  goElsewhere() {
    this.elsewhere = true; this.cancelDraft(); this.notify();
  }
  // Edit here: this device takes the session back, and its words become the draft.
  async retake() {
    if (!this.elsewhere || this.over || this.closed || this.sending) return null;
    const sent = this.sessionEnvelope('message.edit_open', {}, { holder: this.holder });
    this.inFlight++;
    let receipt = null;
    try { receipt = await this.api.command(copy(sent)); } catch { /* the page stays elsewhere */ } finally { this.inFlight--; }
    if (!this.exact(receipt, sent) || receipt.status !== 'committed' || !integer(receipt.result?.session_revision)) {
      this.error = receipt?.status === 'rejected' ? receipt.error?.message ?? null : null; this.settle(null); this.notify(); return null;
    }
    this.elsewhere = false; this.draftClosed = false; this.error = null;
    this.sessionRevision = receipt.result.session_revision; this.lastRenewal = this.timers.now();
    this.settle(receipt.result.session_revision);
    this.notify();
    return this.flushDraft();
  }
  envelope() {
    const { authority_id, authority_epoch } = this.authority();
    return { v: 1, instance_id: this.bootstrap.instance_id, operation_id: crypto.randomUUID(), kind: 'message.edit',
      target: { message_id: this.message.id }, expected: { authority: { authority_id, authority_epoch }, message_revision: this.base.revision },
      args: typeof this.holder === 'string' ? { body: this.value, holder: this.holder } : { body: this.value } };
  }
  // Save (⌘Return). Blank words send nothing (Save is off), and so do words
  // the same as the saved ones: that ends the edit as Cancel would.
  async save() {
    if (this.closed || this.over || this.sending || this.readOnly || this.conflict) return null;
    if (this.pending) return this.retry();
    if (this.empty) return null;
    if (!this.dirty) { await this.end('unchanged'); return null; }
    // A Save never waits on the debounce.
    this.cancelDraft();
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
      // A draft save in flight is waited for until its request returns, with an answer or none.
      await this.draftRequest;
      let receipt;
      this.inFlight++;
      try { receipt = await this.api.command(copy(this.pending)); }
      catch (error) { this.inFlight--; this.unknown = unconfirmed(error) && !isBusy(error); return this.unanswered(error); }
      this.inFlight--;
      return this.take(receipt);
    })().finally(() => { this.sending = null; this.notify(); });
    return this.sending;
  }
  unanswered(error) {
    // Busy: Theseus took nothing, and the same request goes again. No word
    // at all: it may have been saved, so Try again asks Core first.
    this.state = isBusy(error) ? 'busy' : unconfirmed(error) ? 'uncertain' : 'failed';
    this.error = this.state === 'failed' ? error.message : null;
    this.settle(null);
    return null;
  }
  async take(receipt) {
    const sent = this.pending;
    if (!this.exact(receipt, sent)) { this.state = 'uncertain'; this.unknown = true; return null; }
    this.unknown = false;
    if (receipt.status === 'retryable') { this.state = 'busy'; this.settle(null); return receipt; }
    if (receipt.status === 'committed') {
      const result = receipt.result;
      if (receipt.recorded !== true || result?.message_id !== this.message.id || result.revision !== sent.expected.message_revision + 1) {
        this.state = 'uncertain'; this.unknown = true; return null;
      }
      this.result = { revision: result.revision, edited_ms: result.edited_ms ?? null, body: sent.args.body };
      this.pending = null;
      // The holder's Save closed the session in Core. Otherwise this page closes it, unless another device holds
      // it; a Save resumed from the device, or a receipt that does not say, closes it whatever it says.
      const said = typeof result.session_closed === 'boolean';
      if (result.session_closed === true && integer(result.session_revision)) this.sessionRevision = result.session_revision;
      await this.end('saved', { close: this.resumed || !said || (result.session_closed === false && !this.elsewhere) });
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
    this.settle(null);
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
    if (this.sending || this.over) return false;
    this.value = this.base.body; this.pending = null; this.conflict = null;
    await this.end('cancelled');
    return true;
  }
  // Every ending goes through here, and sends one message.edit_close of this holder, unless another device holds the
  // edit (close is false). Closed or refused, the device row goes; with no answer it keeps only the holder and the
  // close's operation, which the next Edit of this message sends again first.
  async end(state, { close = !this.elsewhere } = {}) {
    // Save and Cancel go off at once: the close may be slow to answer.
    this.over = true; this.cancelDraft(); this.notify();
    const value = state === 'saved' || state === 'unchanged' ? this.value : this.base.body;
    this.pending = null; this.conflict = null;
    let row = null;
    if (close && this.started && typeof this.holder === 'string') {
      const operation = crypto.randomUUID();
      if ((await this.sendClose(operation)).outcome === 'unanswered') row = { v: 1, binding: this.binding, holder: this.holder, closing: operation };
    }
    try { await (row ? this.persist(row) : this.clearDevice()); } catch (error) { this.journalError = error.message; }
    this.value = value; this.state = state; this.error = null;
    this.notify();
  }
  // The edit mode went before the person ended it (the Reader moved on, or a resumed Save threw) after edit_open
  // committed: the close goes once, as an ending's does, and words Core has not confirmed stay on the device.
  async abandon() {
    if (this.over) return;
    this.over = true; this.cancelDraft();
    const keep = Boolean(this.pending) || (this.dirty && this.value !== this.kept);
    let row = keep ? { ...this.snapshot(), holder: null, session_revision: null, kept: null } : null;
    if (this.started && typeof this.holder === 'string' && !this.elsewhere) {
      const operation = crypto.randomUUID();
      if ((await this.sendClose(operation)).outcome === 'unanswered') row = { ...(row ?? { v: 1, binding: this.binding }), holder: this.holder, closing: operation };
    }
    try { await (row ? this.persist(row) : this.clearDevice()); } catch (error) { this.journalError = error.message; }
  }
  // Escape, the Reader closing or the page going: the edit mode goes, nothing is sent to Core, and its writing
  // stays on the device for the next Edit of this message. The hold lapses edit_hold_ms after its last renewal.
  close() { this.closed = true; this.cancelDraft(); this.store.close?.(); }
}

// The device copy of one message's edit, for this instance and person only.
// A Web Lock keeps a second tab from replacing this tab's unconfirmed Save;
// another device is fenced by the base revision and the session's holder.
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

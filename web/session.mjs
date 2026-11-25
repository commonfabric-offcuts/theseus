import { timingCall } from './action-timing.mjs';
const actionContexts = new WeakMap();
// Private saves are serialized. Public send confirmation never holds that queue.
import { meaningfulSnapshot, same as sameSnapshot } from './cleanup.mjs';
import { holdsWriting, noWriting } from './editor.mjs';
import { uploadWork, currentImages } from './upload-state.mjs';
import { writingValue } from './writing-comparison.mjs';
import { sessionRefused, Deadline } from './api.mjs';
const copy = value => structuredClone(value);
// What an attempt that got no recorded answer holds. A session's refusal says
// retrying with that session cannot help; the page's next session can carry
// the act, so it stays retryable, as a lost connection is.
const attemptError = error => {
  const found = copy(error.details?.error ?? { code: 'CONNECTION_UNKNOWN', message: error.message });
  if (sessionRefused(error)) found.retryable = true;
  return found;
};
const writingFields = ['body', 'attachments', 'quotes', 'addressees', 'intent', 'whisper', 'caret', 'reply_to', 'exchange_id'];
const authorityPair = value => value && typeof value.authority_id === 'string' && value.authority_id &&
  typeof value.authority_epoch === 'string' && value.authority_epoch
  ? { authority_id: value.authority_id, authority_epoch: value.authority_epoch } : null;
const validAuthority = value => authorityPair(value) && Object.keys(value).length === 3 &&
  ['initial', 'complete', 'incomplete', 'unknown'].includes(value.continuity);
const sharedWriting = draft => {
  const value = writingValue(draft);
  // An implicit ordinary Tell becomes explicit when Send freezes it.
  if (value?.addressees.length && value.whisper !== true) { value.intent ??= 'tell'; value.whisper = false; }
  return value;
};
const same = (a, b) => {
  if (a === b) return true;
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object' || Array.isArray(a) !== Array.isArray(b)) return false;
  const keys = Object.keys(a);
  return keys.length === Object.keys(b).length && keys.every(key => Object.hasOwn(b, key) && same(a[key], b[key]));
};

export const PRIOR_PUBLICATION_NOTICE = 'The earlier reply may already have been sent in history this copy does not contain. Preparing it again creates a new public act.';

// One owner per running app instance, explicitly shared by all its editors.
// A failed probe is cached too: typing is never a reason to probe again.
export class RuntimeAuthority {
  constructor({ api, instanceId, authority, readTimeoutMs = 5000 }) {
    if (!instanceId || !validAuthority(authority)) throw new Error('A runtime needs valid bootstrap authority.');
    if (!Number.isFinite(readTimeoutMs) || readTimeoutMs <= 0) throw new Error('Recovery reads need a finite deadline.');
    this.api = api; this.instanceId = instanceId; this.current = copy(authority);
    this.readTimeoutMs = readTimeoutMs;
    this.probes = new Map(); this.inflight = null;
  }
  // Only reads use this deadline. A late read can settle its own promise but
  // cannot replace a later review or authorize a write.
  read(operation) {
    const deadline = new Deadline(this.readTimeoutMs, 'Recovery read timed out.', 'RECOVERY_READ_TIMEOUT');
    return deadline.bound(Promise.resolve().then(() => operation({ signal: deadline.signal })));
  }
  probe(failedPair, { retry = false } = {}) {
    if (this.inflight) return this.inflight;
    const key = JSON.stringify(authorityPair(failedPair));
    if (!retry && this.probes.has(key)) return this.probes.get(key);
    const request = this.read(options => this.api.bootstrap(options)).then(answer => {
      if (answer.instance_id !== this.instanceId || !validAuthority(answer.authority)) throw new Error('The current runtime authority could not be confirmed.');
      this.current = copy(answer.authority); return copy(answer.authority);
    });
    this.probes.set(key, request); this.inflight = request;
    const settled = () => { if (this.inflight === request) this.inflight = null; };
    request.then(settled, settled);
    return request;
  }
}

export class EditorSession {
  constructor(editor, { api, journal, snapshot = null, authority, runtime, id = () => crypto.randomUUID(), changed = () => {}, prepared = () => {}, published = () => {}, persisted = () => {} }) {
    if (!validAuthority(authority)) throw new Error('Establish valid bootstrap authority before opening an editor session.');
    if (!(runtime instanceof RuntimeAuthority) || runtime.instanceId !== editor.context.instanceId) throw new Error('Editors must share their instance runtime authority.');
    if (snapshot && snapshot.key !== editor.key) throw new Error('Recovery belongs to another editor.');
    this.editor = editor;
    this.api = api;
    this.journal = journal;
    this.id = id;
    this.changed = changed;
    this.prepared = prepared;
    this.published = published;
    this.persisted = persisted;
    this.acknowledgedSnapshot = null;
    this.runtime = runtime;
    this.authority = copy(snapshot?.activeAuthority ?? authority);
    this.recovery = copy(snapshot?.authorityRecovery ?? null);
    if (this.recovery?.phase === 'loading') {
      this.recovery.phase = 'error';
      this.recovery.error = 'RECOVERY_READ_INTERRUPTED';
      this.recovery.message = 'The recovery read was interrupted. Your writing is kept. Retry when ready.';
    }
    this.attempts = copy(snapshot?.attempts ?? []);
    this.queue = Promise.resolve();
    this.sends = new Map();
    this.preparingSends = new Set();
  }

  get recovery() { return this.editor.authorityRecovery; }
  set recovery(value) { this.editor.authorityRecovery = value; }

  // A shared Core draft may have been sent in another running document. Only
  // acknowledged writing with no local work can be retired by that receipt.
  sharedReplyFence() {
    const e = this.editor, images = currentImages(e);
    if (e.context.kind !== 'reply' || !e.draft.generation || !(e.draft.revision > 0) || e.dirty || e.conflict ||
        e.unavailable || this.recovery || uploadWork(e) || this.registered?.() === false ||
        images.some(image => !e.passiveImages || image.origin !== 'retained-ref' || image.bytes_ref || image.attempts.length) ||
        e.submissions.some(item => item.status !== 'confirmed' || item.detached) ||
        this.attempts.some(entry => entry.receipt?.status !== 'committed' || entry.detached) ||
        !['initial', 'complete'].includes(this.authority.continuity) || !['initial', 'complete'].includes(this.runtime.current.continuity) ||
        !same(authorityPair(this.authority), authorityPair(this.runtime.current))) return null;
    return { snapshot: meaningfulSnapshot(this.snapshot()), cycle: e.clientCycleId, authority: authorityPair(this.authority) };
  }

  acceptSharedSend(remote, submission, fence, current = () => true) {
    return this.enqueue(async () => {
      const e = this.editor, old = fence?.snapshot?.draft, receipt = submission?.send_receipt;
      if (!current() || !fence || !same(this.sharedReplyFence(), fence) || !remote || remote.id !== old.id ||
          remote.generation === old.generation || !(remote.revision > old.revision) ||
          !same(remote.source_ref, e.context.sourceRef) || submission?.instance_id !== e.context.instanceId ||
          !same(submission.source_ref, e.context.sourceRef) || submission.topic_id !== e.context.topicId ||
          submission.draft_id !== old.id || submission.draft_generation !== old.generation ||
          !same(sharedWriting(submission), sharedWriting(old)) ||
          !(submission.draft_revision >= old.revision) || !same(submission.authority, fence.authority) ||
          receipt?.instance_id !== e.context.instanceId || receipt.kind !== 'message.send' || receipt.status !== 'committed' ||
          receipt.operation_id !== submission.send_operation_id || receipt.result?.submission_id !== submission.id ||
          typeof receipt.result?.message_id !== 'string') return false;
      const prior = this.snapshot(), cycle = crypto.randomUUID(), version = e.localVersion + 1;
      e.draft = { body: '', attachments: [], quotes: [], addressees: [], caret: { start: 0, end: 0 }, ...copy(remote) };
      if (e.uploadState) {
        const ids = new Set(currentImages({ ...e, clientCycleId: fence.cycle }).map(image => image.selection_id));
        e.uploadState.entries = e.uploadState.entries.filter(image => !ids.has(image.selection_id));
        e.uploadState.client_cycle_id = cycle; e.uploadState.revision++;
      }
      e.clientCycleId = cycle; e.localVersion = version; e.ackVersion = version;
      this.uploads?.importRetained();
      const replacement = meaningfulSnapshot(this.snapshot());
      try { await this.persist(); }
      catch (error) {
        // Restore the old visible writing on a failed keep, but never replace
        // input that arrived while storage was answering.
        if (same(meaningfulSnapshot(this.snapshot()), replacement)) {
          for (const field of ['draft', 'localVersion', 'ackVersion', 'clientCycleId', 'uploadState']) {
            if (Object.hasOwn(prior, field)) e[field] = copy(prior[field]); else if (field === 'clientCycleId') e[field] = fence.cycle; else delete e[field];
          }
        }
        this.changed(e); throw error;
      }
      return current() && e.clientCycleId === cycle && e.localVersion === version && !e.dirty;
    });
  }

  enqueue(task, timing) {
    timingCall(timing, 'mark', 'session_queue');
    const admitted = timingCall(timing, 'span', 'session_queue');
    const next = this.queue.catch(() => {}).then(() => { admitted?.(); return task(); });
    this.queue = next;
    return next;
  }

  snapshot() {
    return { ...this.editor.snapshot(), attempts: copy(this.attempts),
      activeAuthority: copy(this.authority), authorityRecovery: copy(this.recovery) };
  }

  notify() {
    if (!this.sends.size) { this.changed(this.editor); return; }
    if (this.noticeTimer !== undefined) return;
    this.noticeTimer = setTimeout(() => { this.noticeTimer = undefined; this.changed(this.editor); }, 0);
  }

  async persist(timing) {
    const snapshot = this.snapshot(), meaningful = meaningfulSnapshot(snapshot);
    const sameAuthority = () => same(authorityPair(this.authority), authorityPair(this.runtime.current));
    if (!sameSnapshot(meaningful, this.acknowledgedSnapshot) || !sameAuthority()) this.acknowledgedSnapshot = null;
    try {
      const stamp = this.editor.uploadState
        ? await this.journal.saveLatest(this.editor.key, () => this.snapshot(), () => this.registered?.() !== false,
          () => sameAuthority() && sameSnapshot(meaningfulSnapshot(this.snapshot()), this.acknowledgedSnapshot), timing)
        : await this.journal.save(snapshot, () => sameAuthority() && sameSnapshot(meaningful, this.acknowledgedSnapshot), timing);
      this.editor.journalError = null;
      if (stamp) this.persisted(this, snapshot);
      return stamp;
    } catch (error) {
      this.editor.journalError = error.message;
      throw error;
    } finally { if (!this.preparingSends.size) this.notify(); }
  }

  envelope(kind, operationId, target, expected, args, authority = this.authority) {
    return { v: 1, instance_id: this.editor.context.instanceId, operation_id: operationId, kind, target,
      expected: { ...expected, authority: authorityPair(authority) }, args };
  }

  saveEnvelope(ticket, authority = this.authority) {
    const note = this.editor.context.kind === 'note';
    const args = { source_ref: copy(ticket.sourceRef) };
    for (const field of note ? ['body', 'caret'] : writingFields) {
      if (Object.hasOwn(ticket.draft, field)) args[field] = copy(ticket.draft[field]);
    }
    if (!note) Object.assign(args, { topic_id: this.editor.context.topicId, generation: ticket.draft.generation });
    return this.envelope(note ? 'note.save' : 'draft.save', ticket.operationId,
      note ? { note_id: ticket.draft.id } : { draft_id: ticket.draft.id },
      note ? { note_revision: ticket.draft.revision } : { draft_revision: ticket.draft.revision }, args, authority);
  }

  attempt(envelope, extra = {}) {
    const existing = this.attempts.find(item => item.envelope.operation_id === envelope.operation_id);
    if (existing) {
      if (JSON.stringify(existing.envelope) !== JSON.stringify(envelope)) throw new Error('An operation cannot change its contents.');
      return existing;
    }
    const entry = { envelope: copy(envelope), receipt: null, error: null, dispatched: false, ...copy(extra) };
    this.attempts.push(entry);
    return entry;
  }

  async readAuthority() {
    return this.runtime.probe(this.authority, { retry: true });
  }

  // `pinned` is the revision the writing is about: the editor's, or a refused
  // reply's when it is prepared again.
  validPrivateState(state, pinned = this.editor.sourceRef) {
    const context = this.editor.context;
    if (state?.instance_id !== context.instanceId || !same(state.source_ref, pinned) ||
        state.source_available !== true) return false;
    if (context.kind !== 'note' && (state.destination?.topic_id !== context.topicId || state.destination_available !== true)) return false;
    const remote = context.kind === 'note' ? state.note : state.draft;
    // A saved version with nothing in it holds no revision (Core's rule), so
    // it fits writing that has since begun on a later one.
    const fits = same(remote?.source_ref, pinned) || remote?.source_ref?.kind === 'memory' &&
      pinned.kind === 'memory' && remote.source_ref.id === pinned.id && !holdsWriting(remote);
    return remote == null || (typeof remote.id === 'string' && Number.isInteger(remote.revision) && remote.revision > 0 &&
      fits && (context.kind === 'note' || typeof remote.generation === 'string'));
  }

  async refreshRecovery(failedPair, retry = false) {
    const review = this.recovery = { id: this.id(), failedPair: copy(failedPair), phase: 'loading', authority: null, remote: null,
      message: 'The runtime changed. Your writing is kept while the current private version is read.' };
    await this.persist();
    if (this.recovery !== review) return null;
    try {
      const authority = await this.runtime.probe(failedPair, { retry });
      if (this.recovery !== review) return null;
      const state = await this.runtime.read(options => this.api.view('editor_state', { source_ref: this.editor.sourceRef, topic_id: this.editor.context.topicId }, options));
      if (this.recovery !== review) return null;
      review.authority = copy(authority);
      review.remote = copy((this.editor.context.kind === 'note' ? state.note : state.draft) ?? null);
      const unchanged = same(authorityPair(authority), authorityPair(failedPair));
      review.phase = !unchanged && this.validPrivateState(state) ? 'ready' : 'blocked';
      review.message = review.phase === 'ready'
        ? 'Review your current writing and the saved private version before choosing to save in this runtime.'
        : unchanged ? 'The runtime change is not confirmed yet. Your writing is kept. Retry when ready.'
        : 'The source or destination is unavailable or changed. Your writing is kept; saving is blocked.';
    } catch (error) {
      if (this.recovery !== review) return null;
      review.phase = 'error';
      review.message = 'Could not read the current runtime and private version. Your writing is kept. Retry when ready.';
      review.error = error.details?.error?.code ?? error.code ?? 'RECOVERY_READ_FAILED';
    }
    await this.persist();
    return this.recovery === review ? review : null;
  }

  async authorityChanged(entry) {
    if (entry.error?.code === 'AUTHORITY_CHANGED' && !this.recovery &&
        same(entry.envelope.expected?.authority, authorityPair(this.authority))) {
      await this.refreshRecovery(authorityPair(this.authority));
    }
  }

  parkAuthority(failedPair, code = 'AUTHORITY_CHANGED') {
    if (!['AUTHORITY_CHANGED', 'INVALID_BINDING', 'RESYNC_REQUIRED'].includes(code) ||
        !same(authorityPair(failedPair), authorityPair(this.authority)) || this.recovery) return Promise.resolve(this.recovery);
    this.recovery = { id: this.id(), failedPair: copy(authorityPair(failedPair)), phase: 'parked', authority: null,
      remote: null, error: code, message: 'The runtime changed. Your writing is kept. Review versions and Retry when ready.' };
    // The gate is synchronous. Persist does not probe or manufacture an attempt.
    return this.persist().then(() => this.recovery);
  }

  retryAuthority() {
    if (this.recovery?.phase === 'loading') return Promise.reject(new Error('The current recovery read is still in progress.'));
    return this.enqueue(() => {
      if (!this.recovery) throw new Error('There is no runtime change to review.');
      if (this.recovery.phase === 'loading') throw new Error('The current recovery read is still in progress.');
      return this.refreshRecovery(this.recovery.failedPair, true);
    });
  }

  resumePrivate(reviewed, localVersion) {
    const review = copy(reviewed);
    return this.enqueue(async () => {
      if (!review || review.phase !== 'ready' || !same(review, this.recovery) || this.editor.localVersion !== localVersion) {
        throw new Error('Review the current versions before saving.');
      }
      if (this.uploads?.current().length) throw new Error('Remove the selected images from the current reply before resuming private writing in this runtime. Their earlier history is kept.');
      // Read a fresh pair AND its remote snapshot together; never attach a new
      // authority to a revision that belonged to the earlier review.
      const refreshed = await this.refreshRecovery(review.failedPair, true);
      if (!refreshed || refreshed.phase !== 'ready' || !same(refreshed.authority, review.authority) || !same(refreshed.remote, review.remote) ||
          this.editor.localVersion !== localVersion) throw new Error('The runtime or writing changed. Review both versions again.');
      const remote = refreshed.remote, note = this.editor.context.kind === 'note';
      for (const entry of this.attempts) entry.detached = true;
      for (const item of this.editor.submissions) item.detached = true;
      this.authority = copy(refreshed.authority);
      this.editor.draft = { ...this.editor.draft, id: remote?.id ?? this.id(), revision: remote?.revision ?? 0,
        ...(note ? {} : { generation: remote?.generation ?? this.id() }) };
      this.editor.conflict = null;
      this.editor.ackVersion = Math.min(this.editor.ackVersion, this.editor.localVersion - 1);
      this.recovery = null;
      this.editor.clientCycleId = this.id();
      if (this.editor.uploadState) { this.editor.uploadState.client_cycle_id = this.editor.clientCycleId; this.editor.uploadState.revision++; }
      const ticket = this.editor.saveTicket(this.id());
      await this.persist();
      return this.dispatch(this.attempt(this.saveEnvelope(ticket), { ticket }));
    });
  }

  async permitsDispatch(entry) {
    // The exact journaled envelope is the authority binding. Metadata cannot
    // repair an old attempt. Core compares this pair atomically through COMMIT.
    const raw = entry.envelope.expected?.authority, pinned = authorityPair(raw);
    if (!pinned || Object.keys(raw).length !== 2 || !same(pinned, authorityPair(this.authority))) {
      entry.error = { code: 'RECOVERY_RECONCILIATION_REQUIRED', retryable: false,
        message: 'This attempt belongs to an earlier or unknown runtime. Check its original confirmation before continuing.' };
      await this.persist();
      return false;
    }
    return true;
  }

  async apply(entry, receipt, timing = actionContexts.get(entry)) {
    if (!this.editor.matches(receipt, entry.envelope.operation_id, entry.envelope.kind) ||
        !['committed', 'rejected'].includes(receipt.status)) return false;
    // Restored histories can reuse IDs, generations and revisions. Only the
    // captured authority/branch decides whether a receipt may touch live B.
    if (!same(entry.envelope.expected?.authority, authorityPair(this.authority))) {
      let accepted;
      if (entry.ticket) accepted = this.editor.acceptSave(entry.ticket, receipt, { bindDraft: false }) || receipt.status === 'rejected';
      else if (entry.envelope.kind === 'submission.prepare') accepted = this.editor.acceptPreparation(receipt, { bindDraft: false });
      else accepted = this.editor.acceptSend(receipt);
      if (!accepted) {
        entry.error = { code: 'RECEIPT_MISMATCH', message: 'The historical answer does not match the retained attempt.', retryable: false };
        await this.persist(timing); return false;
      }
      entry.receipt = copy(receipt); entry.error = null;
      await this.persist(timing); return true;
    }
    let accepted;
    if (entry.ticket) {
      accepted = this.editor.acceptSave(entry.ticket, receipt);
      const remote = this.editor.conflict?.remote;
      const note = entry.envelope.kind === 'note.save';
      if (accepted && remote && remote.id === entry.ticket.draft.id &&
          remote.revision === (note ? receipt.result.note_revision : receipt.result.draft_revision) &&
          (note || remote.generation === entry.ticket.draft.generation) &&
          same(remote.source_ref, entry.ticket.sourceRef) &&
          (note ? ['body', 'caret'] : writingFields).every(field => same(remote[field], entry.ticket.draft[field]))) {
        // The exact committed save explains this recovery conflict. A newer
        // remote revision or different writing still requires a human choice.
        this.editor.conflict = null;
      }
      // A recorded refusal deliberately sets a conflict instead of acknowledging.
      if (receipt.status === 'rejected') accepted = true;
    } else if (entry.envelope.kind === 'submission.prepare') {
      accepted = this.editor.acceptPreparation(receipt);
    } else accepted = this.editor.acceptSend(receipt);
    if (!accepted) {
      entry.error = { code: 'RECEIPT_MISMATCH', message: 'The recorded answer does not match this writing. Reconciliation is required.', retryable: false };
      return false;
    }
    entry.receipt = copy(receipt);
    entry.error = null;
    if (receipt.status === 'rejected' && !entry.ticket) {
      const item = this.editor.submissions.find(item => item.id === entry.submissionId);
      if (item && this.editor.restoreRefused(item)) {
        this.uploads?.importRetained();
        this.uploads?.validateRetained().catch(() => {});
      }
    }
    await this.persist(timing);
    // Reconciliation can confirm publication after the original Send ended
    // without its answer. Tell its surface only after keeping that exact fact.
    if (entry.envelope.kind === 'message.send' && receipt.status === 'committed' && !this.recovery &&
        same(authorityPair(this.authority), authorityPair(this.runtime.current))) {
      const item = this.editor.submissions.find(item => item.sendOperationId === entry.envelope.operation_id);
      if (item && !item.detached) this.published(this.editor, item, timing);
    }
    return true;
  }

  async dispatch(entry, { retries = 1, resumePreparation = false, timing = actionContexts.get(entry) } = {}) {
    if (timing) actionContexts.set(entry, timing);
    timingCall(timing, 'link', entry.envelope.operation_id, entry.submissionId);
    if (entry.receipt) return entry.receipt;
    if (entry.detached) return null;
    const privateWrite = ['draft.save', 'note.save'].includes(entry.envelope.kind) ||
      (resumePreparation && entry.envelope.kind === 'submission.prepare');
    if (entry.dispatched) {
      if (!privateWrite || entry.error?.retryable === false) return null;
      if (!await this.permitsDispatch(entry)) return null;
      // Retry only after reading the original identity. CAS plus the unchanged
      // operation fingerprint makes a repeated private save idempotent. Public
      // sends and recovery gaps remain parked for deliberate reconciliation.
      let answer;
      try { answer = await this.api.view('operation', { operation_id: entry.envelope.operation_id }, { timing }); }
      catch (error) {
        entry.error = attemptError(error);
        await this.persist(timing);
        return null;
      }
      if (await this.apply(entry, answer, timing)) return entry.receipt;
      if (answer.instance_id !== entry.envelope.instance_id || answer.operation_id !== entry.envelope.operation_id ||
          answer.status !== 'unknown' || answer.recorded !== false || answer.error) return null;
      entry.dispatched = false;
    }
    entry.dispatched = true;
    try { await this.persist(timing); } catch (error) { entry.dispatched = false; throw error; }
    // Validate the journaled act locally; no preflight read can replace Core's
    // atomic comparison if authority changes while this write is in flight.
    if (!await this.permitsDispatch(entry)) {
      entry.dispatched = false;
      await this.persist(timing);
      return null;
    }
    let receipt;
    try { receipt = await this.api.command(copy(entry.envelope), { timing }); }
    catch (error) {
      entry.error = attemptError(error);
      if (sessionRefused(error)) {
        // A refused session is refused before Core reads the request, so the
        // act is undelivered: it waits for the new session, as the same
        // session would only be refused again.
        entry.dispatched = false;
        await this.persist(timing);
        return null;
      }
      await this.persist(timing);
      await this.authorityChanged(entry);
      return retries > 0 ? this.dispatch(entry, { retries: retries - 1, resumePreparation, timing }) : null;
    }
    if (await this.apply(entry, receipt, timing)) return entry.receipt;
    entry.error = copy(receipt?.error ?? { code: 'RECEIPT_MISMATCH', message: 'No matching recorded outcome was returned.', retryable: false });
    await this.persist(timing);
    await this.authorityChanged(entry);
    return retries > 0 ? this.dispatch(entry, { retries: retries - 1, resumePreparation, timing }) : null;
  }

  unsettledSave() {
    return this.attempts.find(item => item.ticket && !item.receipt && !item.detached);
  }

  save() {
    return this.enqueue(async () => {
      await this.persist();
      if (this.recovery) return null;
      const prior = this.unsettledSave();
      if (prior) await this.dispatch(prior);
      if (this.unsettledSave() || !this.editor.dirty) return null;
      const ticket = this.editor.saveTicket(this.id());
      if (!ticket) return null;
      return this.dispatch(this.attempt(this.saveEnvelope(ticket), { ticket }));
    });
  }

  send(options = {}) {
    if (this.editor.context.kind === 'note') throw new Error('A private note cannot be sent.');
    if (this.recovery) throw new Error('Review the runtime change before sending. Your writing is kept.');
    if (this.uploads?.current().some(e => !this.uploads.pinned(e))) throw new Error('Review the runtime change before sending these images.');
    const previous = this.editor.submissions.find(item => item.status === 'preparing' && !item.detached);
    if (previous) {
      return this.sends.get(previous.id) ?? this.start(previous, options, true);
    }
    const item = this.editor.beginPrepare({ prepareOperationId: this.id(), sendOperationId: this.id(), submissionId: this.id(),
      replySource: options.replySource });
    item.authority = authorityPair(this.authority);
    // The page hears of the reply once it is under way, so it is never shown in doubt.
    const sending = this.start(item, options);
    return sending;
  }

  // Whether the reply with this id is on its way: being prepared, or sent and
  // not yet answered.
  underWay(id) { return this.sends.has(id); }

  // Holds a send as under way until it ends, then tells the page, with it no
  // longer under way: a reply whose send ended unconfirmed is now in doubt.
  // Returns the send.
  track(key, sending) {
    this.sends.set(key, sending);
    // Resuming the retained operation changes Review ownership too. Publish
    // that boundary before its private continuation suppresses status paints.
    this.changed(this.editor);
    const settled = () => { if (this.sends.get(key) === sending) this.sends.delete(key); this.changed(this.editor); };
    sending.then(settled, settled);
    return sending;
  }

  timingFor(item) { return actionContexts.get(item); }
  start(item, options, resume = false) {
    const timing = options.timing;
    if (timing) actionContexts.set(item, timing);
    timingCall(timing, 'link', item.prepareOperationId, item.id);
    timingCall(timing, 'link', item.sendOperationId, item.id);
    // Freeze at the person's act, before any queued save or network wait.
    this.preparingSends.add(item.id);
    const preparing = this.enqueue(async () => {
      try { return await this.prepare(item, resume, timing); }
      finally { this.preparingSends.delete(item.id); }
    }, timing);
    return this.track(item.id, preparing.then(async ready => {
      if (!ready || item.detached) { timingCall(timing, 'finish', 'incomplete', item.detached ? 'retired' : 'refused'); return item; }
      // prepare() persisted the successor and A before this navigation hook.
      this.prepared(this.editor, item, options);
      await this.sendPrepared(item);
      if (item.status !== 'confirmed') timingCall(timing, 'finish', 'incomplete', 'unknown');
      return item;
    }).catch(error => { timingCall(timing, 'finish', 'failed', 'unknown'); throw error; }));
  }

  // The page reaches Theseus again: its session renewed after a restart, its
  // live feed back, or a new document. Every reply the person sent that is not
  // yet published, and not under way, goes on under its own operations, as
  // they asked when they pressed Send, whatever held it. Whether each act may
  // go again is dispatch()'s rule alone: a private save or a resumed
  // preparation after its operation is looked up, a public send only if it
  // never reached Core, and nothing an error says no retry mends. Everything
  // waits while a runtime change is under review. Acts under way finish
  // first, so one held as the page reconnected is taken up too.
  async resumeHeld() {
    await Promise.allSettled([this.queue, ...this.sends.values()]);
    if (this.recovery) return [];
    return Promise.all(this.editor.submissions.flatMap(item => item.detached || this.sends.has(item.id) ? []
      : item.status === 'preparing' ? [this.start(item, { stay: true }, true)]
        : item.status === 'prepared' ? [this.track(item.id, this.sendPrepared(item).then(() => item))] : []));
  }

  async block(item, entry, conflict = null) {
    const error = conflict?.error ?? entry?.error;
    item.blocked = { phase: entry?.envelope.kind ?? 'draft.save', operationId: entry?.envelope.operation_id,
      code: error?.code, retryable: error?.retryable !== false,
      message: error?.message ?? 'This save is not confirmed. Check confirmation before continuing.' };
    await this.persist();
    return false;
  }

  async prepare(item, resume = false, timing = actionContexts.get(item)) {
    if (item.status !== 'preparing' || item.detached || this.recovery) return false;
    item.blocked = null;
    await this.persist(timing);
    const prior = this.unsettledSave();
    if (prior) await this.dispatch(prior, { timing });
    if (this.unsettledSave()) return this.block(item, this.unsettledSave());
    if (item.saveConflict) return this.block(item, null, item.saveConflict);
    // A click can make Tell/whisper defaults explicit without changing what
    // Core would publish. Credit only the exact committed slot/revision and
    // effective writing; a genuinely later edit still requires its own save.
    const saved = [...this.attempts].reverse().find(entry => entry.ticket && !entry.detached &&
      entry.receipt?.status === 'committed' && entry.ticket.draft.id === item.snapshot.id &&
      entry.ticket.draft.generation === item.snapshot.generation &&
      entry.receipt.result?.draft_revision === item.snapshot.revision &&
      same(entry.ticket.sourceRef, item.sourceRef) && same(sharedWriting(entry.ticket.draft), sharedWriting(item.snapshot)));
    if (saved) item.savedVersion = item.localVersion;
    if (item.savedVersion < item.localVersion || !item.snapshot.revision) {
      const ticket = { operationId: this.id(), key: this.editor.key, localVersion: item.localVersion,
        draft: copy(item.snapshot), sourceRef: copy(item.sourceRef) };
      const entry = this.attempt(this.saveEnvelope(ticket, item.authority), { ticket, submissionId: item.id });
      const receipt = await this.dispatch(entry, { timing });
      if (receipt?.status !== 'committed') return this.block(item, entry, item.saveConflict);
    }
    const envelope = this.envelope('submission.prepare', item.prepareOperationId,
      { topic_id: item.topicId }, { draft_revision: item.snapshot.revision },
      { draft_id: item.snapshot.id, submission_id: item.id, send_operation_id: item.sendOperationId }, item.authority);
    const entry = this.attempt(envelope, { submissionId: item.id });
    const receipt = await this.dispatch(entry, { resumePreparation: resume, timing });
    if (!receipt) return this.block(item, entry);
    if (receipt?.status === 'rejected' && receipt.error?.code === 'REVISION_CONFLICT') {
      // The refusal is already a fact. Persist the block before reading so a
      // crash or busy lane cannot restart B's autosave over unknown writing.
      const conflict = { attempted: copy(this.editor.draft), error: copy(receipt.error) };
      this.editor.conflict = conflict;
      await this.persist(timing); this.changed(this.editor);
      try {
        const state = await this.api.view('editor_state', { source_ref: item.sourceRef, topic_id: item.topicId }, { timing });
        if (state?.error) throw Object.assign(Error(state.error.message), { details: state });
        const d = state?.draft;
        if (state?.instance_id !== this.editor.context.instanceId || !same(state.source_ref, item.sourceRef) ||
            !same(state.destination, { topic_id: item.topicId ?? null }) ||
            !(d === null || d && typeof d.id === 'string' && Number.isInteger(d.revision) && d.revision > 0 &&
              typeof d.generation === 'string' && d.generation && same(d.source_ref, item.sourceRef))) throw Error('The saved writing identity could not be confirmed.');
        conflict.remote = copy(d);
      } catch (error) {
        conflict.readError = copy(error.details?.error ?? { code: 'READ_UNKNOWN', message: error.message });
      }
      await this.persist(timing);
    }
    return item.preparationConfirmed;
  }

  async sendPrepared(item) {
    const timing = actionContexts.get(item);
    if (!item.preparationConfirmed || item.status !== 'prepared' || item.detached) return null;
    return this.dispatch(this.attempt(this.envelope('message.send', item.sendOperationId,
      { topic_id: item.topicId }, {}, { submission_id: item.id }, item.authority), { submissionId: item.id }), { timing });
  }

  async originalPublication(item) {
    const failure = () => new Error('The original publication could not be confirmed. Reconcile its original confirmation before preparing another reply.');
    let receipt;
    try {
      receipt = await this.runtime.read(options => this.api.view('operation', { operation_id: item.sendOperationId }, options));
    } catch { throw failure(); }
    // Only this exact scoped answer means absent. An error or malformed answer
    // must never become permission to publish another copy of the same writing.
    if (same(receipt, { instance_id: this.editor.context.instanceId, operation_id: item.sendOperationId,
      status: 'unknown', recorded: false })) return 'unknown';
    const entry = this.attempts.find(attempt => attempt.envelope.operation_id === item.sendOperationId);
    const validOutcome = receipt?.status === 'committed' ? !Object.hasOwn(receipt, 'error') :
      receipt?.status === 'rejected' && typeof receipt.error?.code === 'string' && receipt.error.code.length > 0;
    // The existing acceptance path checks the receipt identity, preparation and
    // committed submission, and journals A without changing the current draft B.
    if (!validOutcome || !entry || entry.envelope.kind !== 'message.send' || !await this.apply(entry, receipt)) throw failure();
    return receipt.status;
  }

  correctPreparation(refused, reviewedRemote, reviewedLocalVersion, options = {}) {
    const marker = Symbol('correction');
    const sending = this.enqueue(async () => {
      const requireUnpublished = () => {
        const published = refused.status === 'confirmed' || (refused.receipt?.status === 'committed' && refused.receipt.kind === 'message.send');
        if (published) throw new Error('This reply is already confirmed as published. It cannot be prepared again.');
      };
      requireUnpublished();
      if (!this.editor.submissions.includes(refused) || (!refused.detached &&
          (refused.status !== 'refused' || refused.receipt?.kind !== 'submission.prepare'))) {
        throw new Error('Review a refused preparation or a retained historical reply before preparing it again.');
      }
      if (refused.correctedBy) return this.editor.submissions.find(item => item.id === refused.correctedBy);
      if (this.editor.submissions.some(item => item.status === 'preparing' && !item.detached) || this.unsettledSave()) {
        throw new Error('Reconcile the earlier attempt before correcting this preparation.');
      }
      if (this.recovery) throw new Error('Review the runtime change before preparing again.');
      const authority = await this.readAuthority();
      if (!same(authorityPair(authority), authorityPair(this.authority))) {
        await this.refreshRecovery(authorityPair(this.authority));
        throw new Error('The runtime changed. Review the current private writing before preparing again.');
      }
      const publication = await this.originalPublication(refused);
      requireUnpublished();
      if (publication === 'unknown' && (refused.detached || !same(refused.authority, authorityPair(this.authority))) && options.acknowledgePossiblePriorPublication !== true) {
        throw new Error(PRIOR_PUBLICATION_NOTICE);
      }
      const state = await this.api.view('editor_state', { source_ref: refused.sourceRef, topic_id: refused.topicId });
      requireUnpublished();
      // The slot holds the refused reply's revision, or nothing: an emptied
      // place may have followed a revised page since.
      if (!this.validPrivateState(state, refused.sourceRef) || !state.draft ||
          !same(state.draft, reviewedRemote) || this.editor.localVersion !== reviewedLocalVersion) {
        throw new Error('Writing changed since it was reviewed. Review both versions again.');
      }
      // This is an explicit correction after reviewing the remote draft, never
      // an automatic CAS retry. Keep the original refusal and current B intact.
      await this.uploads?.validateCorrection(refused);
      if (this.editor.localVersion !== reviewedLocalVersion) throw new Error('Writing changed while checking the earlier images. Review again.');
      // The correction puts the refused writing back in the slot, about the
      // revision it was written against, and the place goes back with it.
      // Writing begun about another revision, or an unsaved change to the
      // place, would be saved there about the refused writing's revision.
      const moved = !same(this.editor.sourceRef, refused.sourceRef);
      if (moved && (holdsWriting(this.editor.draft) || this.editor.dirty)) {
        throw new Error('Your current writing is about another revision of this page and is kept. Send it, or clear it and let it save, before preparing the earlier reply again.');
      }
      const item = { ...copy(refused), id: this.id(), prepareOperationId: this.id(), sendOperationId: this.id(),
        authority: authorityPair(this.authority),
        snapshot: { ...copy(refused.snapshot), id: state.draft.id, revision: state.draft.revision, generation: state.draft.generation },
        savedVersion: -1, saveConflict: null, status: 'preparing', preparationConfirmed: false, receipt: null };
      delete item.correctedBy;
      delete item.detached;
      delete item.restoredWriting;
      const restored = refused.restoredWriting && this.editor.restoredVersion === reviewedLocalVersion &&
        same(sharedWriting(this.editor.draft), sharedWriting(refused.snapshot));
      if (restored) item.localVersion = reviewedLocalVersion;
      refused.correctedBy = item.id;
      this.editor.submissions.push(item);
      // The corrected reply is on its way from here until the act ends.
      this.track(item.id, sending);
      if (this.editor.uploadState) {
        const link = this.editor.uploadState.submission_links[refused.id];
        if (link) this.editor.uploadState.submission_links[item.id] = copy(link);
        this.editor.uploadState.revision++;
      }
      this.editor.conflict = null;
      if (moved) this.editor.pin(refused.sourceRef);
      this.editor.draft.id = state.draft.id;
      this.editor.draft.revision = null;
      this.editor.draft.generation = null;
      // The server successor will be blank; even previously saved B must be
      // saved into that new generation after exact A has been prepared.
      if (this.editor.draft.body || this.editor.draft.attachments.length || this.editor.draft.quotes.length || this.editor.draft.addressees.length) {
        this.editor.ackVersion = Math.min(this.editor.ackVersion, this.editor.localVersion - 1);
      }
      if (!await this.prepare(item)) return null;
      // Preparing the exact restored A again consumes only that unchanged
      // visible copy. A later B, image choice or authority change keeps its
      // owner. The original submission's image links remain retained.
      if (restored && this.editor.localVersion === reviewedLocalVersion &&
          this.editor.restoredVersion === reviewedLocalVersion && !this.recovery &&
          !this.editor.imageReservation && !this.editor.imageBusy &&
          same(sharedWriting(this.editor.draft), sharedWriting(refused.snapshot))) {
        for (const image of currentImages(this.editor)) { image.selected = false; image.version++; }
        if (this.editor.uploadState) this.editor.uploadState.revision++;
        const { id, revision, generation } = this.editor.draft;
        this.editor.draft = { ...noWriting(), id, revision, generation };
        this.editor.ackVersion = this.editor.localVersion;
        delete this.editor.restoredVersion;
        this.editor.follow();
        await this.persist();
      }
      return item;
    }).then(async item => {
      if (item?.status === 'prepared') {
        this.prepared(this.editor, item, options);
        await this.sendPrepared(item);
      }
      return item;
    });
    // Track the entire act, including queued validation, without colliding with
    // start()'s submission keys or changing the promise returned to its caller.
    this.track(marker, sending);
    return sending;
  }

  reconcile() {
    return this.enqueue(async () => {
      for (const entry of this.attempts) {
        if (entry.receipt) continue;
        const receipt = await this.api.view('operation', { operation_id: entry.envelope.operation_id });
        await this.apply(entry, receipt);
      }
      // Checking confirmation is read-only at the authority. Unknown does not
      // authorize a fresh operation or a replay, including after restore.
      await this.persist();
    });
  }
}

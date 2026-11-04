// Private saves are serialized. Public send confirmation never holds that queue.
const copy = value => structuredClone(value);
const writingFields = ['body', 'attachments', 'quotes', 'addressees', 'caret', 'reply_to', 'exchange_id', 'opening'];
const authorityPair = value => value && typeof value.authority_id === 'string' && value.authority_id &&
  typeof value.authority_epoch === 'string' && value.authority_epoch
  ? { authority_id: value.authority_id, authority_epoch: value.authority_epoch } : null;
const validAuthority = value => authorityPair(value) && Object.keys(value).length === 3 &&
  ['initial', 'complete', 'incomplete', 'unknown'].includes(value.continuity);
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
  async read(operation) {
    let timer;
    const expired = new Promise((resolve, reject) => {
      timer = setTimeout(() => reject(Object.assign(new Error('Recovery read timed out.'), { code: 'RECOVERY_READ_TIMEOUT' })), this.readTimeoutMs);
    });
    // Only reads use this deadline. A late read can settle its own promise but
    // cannot replace a later review or authorize a write.
    try { return await Promise.race([Promise.resolve().then(operation), expired]); }
    finally { clearTimeout(timer); }
  }
  probe(failedPair, { retry = false } = {}) {
    if (this.inflight) return this.inflight;
    const key = JSON.stringify(authorityPair(failedPair));
    if (!retry && this.probes.has(key)) return this.probes.get(key);
    const request = this.read(() => this.api.bootstrap()).then(answer => {
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
  constructor(editor, { api, journal, snapshot = null, authority, runtime, id = () => crypto.randomUUID(), changed = () => {}, prepared = () => {} }) {
    if (!validAuthority(authority)) throw new Error('Establish valid bootstrap authority before opening an editor session.');
    if (!(runtime instanceof RuntimeAuthority) || runtime.instanceId !== editor.context.instanceId) throw new Error('Editors must share their instance runtime authority.');
    if (snapshot && snapshot.key !== editor.key) throw new Error('Recovery belongs to another editor.');
    this.editor = editor;
    this.api = api;
    this.journal = journal;
    this.id = id;
    this.changed = changed;
    this.prepared = prepared;
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
  }

  get recovery() { return this.editor.authorityRecovery; }
  set recovery(value) { this.editor.authorityRecovery = value; }

  enqueue(task) {
    const next = this.queue.catch(() => {}).then(task);
    this.queue = next;
    return next;
  }

  async persist() {
    const snapshot = { ...this.editor.snapshot(), attempts: copy(this.attempts),
      activeAuthority: copy(this.authority), authorityRecovery: copy(this.recovery) };
    try {
      const stamp = await this.journal.save(snapshot);
      this.editor.journalError = null;
      return stamp;
    } catch (error) {
      this.editor.journalError = error.message;
      throw error;
    } finally { this.changed(this.editor); }
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

  validPrivateState(state) {
    const context = this.editor.context;
    if (state?.instance_id !== context.instanceId || !same(state.source_ref, this.editor.sourceRef) ||
        state.source_available !== true) return false;
    if (context.kind !== 'note' && (state.destination?.topic_id !== context.topicId || state.destination_available !== true)) return false;
    const remote = context.kind === 'note' ? state.note : state.draft;
    return remote == null || (typeof remote.id === 'string' && Number.isInteger(remote.revision) && remote.revision > 0 &&
      same(remote.source_ref, this.editor.sourceRef) && (context.kind === 'note' || typeof remote.generation === 'string'));
  }

  async refreshRecovery(failedPair, retry = false) {
    const review = this.recovery = { id: this.id(), failedPair: copy(failedPair), phase: 'loading', authority: null, remote: null,
      message: 'The runtime changed. Your writing is kept while the current private version is read.' };
    await this.persist();
    if (this.recovery !== review) return null;
    try {
      const authority = await this.runtime.probe(failedPair, { retry });
      if (this.recovery !== review) return null;
      const state = await this.runtime.read(() => this.api.view('editor_state', { source_ref: this.editor.sourceRef, topic_id: this.editor.context.topicId }));
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

  async apply(entry, receipt) {
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
        await this.persist(); return false;
      }
      entry.receipt = copy(receipt); entry.error = null;
      await this.persist(); return true;
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
    await this.persist();
    return true;
  }

  async dispatch(entry, { retries = 1, resumePreparation = false } = {}) {
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
      try { answer = await this.api.view('operation', { operation_id: entry.envelope.operation_id }); }
      catch (error) {
        entry.error = copy(error.details?.error ?? { code: 'CONNECTION_UNKNOWN', message: error.message });
        await this.persist();
        return null;
      }
      if (await this.apply(entry, answer)) return entry.receipt;
      if (answer.instance_id !== entry.envelope.instance_id || answer.operation_id !== entry.envelope.operation_id ||
          answer.status !== 'unknown' || answer.recorded !== false || answer.error) return null;
      entry.dispatched = false;
    }
    entry.dispatched = true;
    try { await this.persist(); } catch (error) { entry.dispatched = false; throw error; }
    // Validate the journaled act locally; no preflight read can replace Core's
    // atomic comparison if authority changes while this write is in flight.
    if (!await this.permitsDispatch(entry)) {
      entry.dispatched = false;
      await this.persist();
      return null;
    }
    let receipt;
    try { receipt = await this.api.command(copy(entry.envelope)); }
    catch (error) {
      entry.error = copy(error.details?.error ?? { code: 'CONNECTION_UNKNOWN', message: error.message });
      await this.persist();
      await this.authorityChanged(entry);
      return retries > 0 ? this.dispatch(entry, { retries: retries - 1, resumePreparation }) : null;
    }
    if (await this.apply(entry, receipt)) return entry.receipt;
    entry.error = copy(receipt?.error ?? { code: 'RECEIPT_MISMATCH', message: 'No matching recorded outcome was returned.', retryable: false });
    await this.persist();
    await this.authorityChanged(entry);
    return retries > 0 ? this.dispatch(entry, { retries: retries - 1, resumePreparation }) : null;
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
    const previous = this.editor.submissions.find(item => item.status === 'preparing' && !item.detached);
    if (previous) return this.sends.get(previous.id) ?? this.start(previous, options, true);
    const item = this.editor.beginPrepare({ prepareOperationId: this.id(), sendOperationId: this.id(), submissionId: this.id() });
    item.authority = authorityPair(this.authority);
    this.changed(this.editor);
    return this.start(item, options);
  }

  start(item, options, resume = false) {
    // Freeze at the person's act, before any queued save or network wait.
    const preparing = this.enqueue(() => this.prepare(item, resume));
    const sending = preparing.then(async ready => {
      if (!ready || item.detached) return item;
      // prepare() persisted the successor and A before this navigation hook.
      this.prepared(this.editor, item, options);
      await this.sendPrepared(item);
      return item;
    });
    this.sends.set(item.id, sending);
    sending.then(() => this.sends.delete(item.id), () => this.sends.delete(item.id));
    return sending;
  }

  async block(item, entry, conflict = null) {
    const error = conflict?.error ?? entry?.error;
    item.blocked = { phase: entry?.envelope.kind ?? 'draft.save', operationId: entry?.envelope.operation_id,
      code: error?.code, retryable: error?.retryable !== false,
      message: error?.message ?? 'This save is not confirmed. Check confirmation before continuing.' };
    await this.persist();
    return false;
  }

  async prepare(item, resume = false) {
    if (item.status !== 'preparing' || item.detached || this.recovery) return false;
    item.blocked = null;
    await this.persist();
    const prior = this.unsettledSave();
    if (prior) await this.dispatch(prior);
    if (this.unsettledSave()) return this.block(item, this.unsettledSave());
    if (item.saveConflict) return this.block(item, null, item.saveConflict);
    if (item.savedVersion < item.localVersion || !item.snapshot.revision) {
      const ticket = { operationId: this.id(), key: this.editor.key, localVersion: item.localVersion,
        draft: copy(item.snapshot), sourceRef: copy(item.sourceRef) };
      const entry = this.attempt(this.saveEnvelope(ticket, item.authority), { ticket, submissionId: item.id });
      const receipt = await this.dispatch(entry);
      if (receipt?.status !== 'committed') return this.block(item, entry, item.saveConflict);
    }
    const envelope = this.envelope('submission.prepare', item.prepareOperationId,
      { topic_id: item.topicId }, { draft_revision: item.snapshot.revision },
      { draft_id: item.snapshot.id, submission_id: item.id, send_operation_id: item.sendOperationId }, item.authority);
    const entry = this.attempt(envelope, { submissionId: item.id });
    const receipt = await this.dispatch(entry, { resumePreparation: resume });
    if (!receipt) return this.block(item, entry);
    if (receipt?.status === 'rejected' && receipt.error?.code === 'REVISION_CONFLICT') {
      const state = await this.api.view('editor_state', { source_ref: item.sourceRef, topic_id: item.topicId });
      // Preserve other-device writing for explicit review; never clear a CAS
      // refusal by autosaving B over the server version we just learned about.
      this.editor.conflict = { attempted: copy(this.editor.draft), remote: copy(state.draft ?? null), error: copy(receipt.error) };
      await this.persist();
    }
    return item.preparationConfirmed;
  }

  async sendPrepared(item) {
    if (!item.preparationConfirmed || item.status !== 'prepared' || item.detached) return null;
    const kind = item.snapshot.opening ? 'topic.create_and_send' : 'message.send';
    return this.dispatch(this.attempt(this.envelope(kind, item.sendOperationId,
      { topic_id: item.topicId }, {}, { submission_id: item.id }, item.authority), { submissionId: item.id }));
  }

  async originalPublication(item) {
    const failure = () => new Error('The original publication could not be confirmed. Reconcile its original confirmation before preparing another reply.');
    let receipt;
    try {
      receipt = await this.runtime.read(() => this.api.view('operation', { operation_id: item.sendOperationId }));
    } catch { throw failure(); }
    // Only this exact scoped answer means absent. An error or malformed answer
    // must never become permission to publish another copy of the same writing.
    if (same(receipt, { instance_id: this.editor.context.instanceId, operation_id: item.sendOperationId,
      status: 'unknown', recorded: false })) return 'unknown';
    const kind = item.snapshot.opening ? 'topic.create_and_send' : 'message.send';
    const entry = this.attempts.find(attempt => attempt.envelope.operation_id === item.sendOperationId);
    const validOutcome = receipt?.status === 'committed' ? !Object.hasOwn(receipt, 'error') :
      receipt?.status === 'rejected' && typeof receipt.error?.code === 'string' && receipt.error.code.length > 0;
    // The existing acceptance path checks the receipt identity, preparation and
    // committed submission, and journals A without changing the current draft B.
    if (!validOutcome || !entry || entry.envelope.kind !== kind || !await this.apply(entry, receipt)) throw failure();
    return receipt.status;
  }

  correctPreparation(refused, reviewedRemote, reviewedLocalVersion, options = {}) {
    return this.enqueue(async () => {
      const requireUnpublished = () => {
        const published = refused.status === 'confirmed' || (refused.receipt?.status === 'committed' &&
          ['message.send', 'topic.create_and_send'].includes(refused.receipt.kind));
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
      if (!this.validPrivateState(state) || !state.draft ||
          !same(state.draft, reviewedRemote) || this.editor.localVersion !== reviewedLocalVersion ||
          !same(state.draft.source_ref, refused.sourceRef)) {
        throw new Error('Writing changed since it was reviewed. Review both versions again.');
      }
      // This is an explicit correction after reviewing the remote draft, never
      // an automatic CAS retry. Keep the original refusal and current B intact.
      const item = { ...copy(refused), id: this.id(), prepareOperationId: this.id(), sendOperationId: this.id(),
        authority: authorityPair(this.authority),
        snapshot: { ...copy(refused.snapshot), id: state.draft.id, revision: state.draft.revision, generation: state.draft.generation },
        savedVersion: -1, saveConflict: null, status: 'preparing', preparationConfirmed: false, receipt: null };
      delete item.correctedBy;
      delete item.detached;
      refused.correctedBy = item.id;
      this.editor.submissions.push(item);
      this.editor.conflict = null;
      this.editor.draft.id = state.draft.id;
      this.editor.draft.revision = null;
      this.editor.draft.generation = null;
      // The server successor will be blank; even previously saved B must be
      // saved into that new generation after exact A has been prepared.
      if (this.editor.draft.body || this.editor.draft.attachments.length || this.editor.draft.quotes.length || this.editor.draft.addressees.length) {
        this.editor.ackVersion = Math.min(this.editor.ackVersion, this.editor.localVersion - 1);
      }
      return await this.prepare(item) ? item : null;
    }).then(async item => {
      if (item?.status === 'prepared') {
        this.prepared(this.editor, item, options);
        await this.sendPrepared(item);
      }
      return item;
    });
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

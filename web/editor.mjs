// Private writing state. DOM, transport and persistence are separate owners.
const copy = value => structuredClone(value);
const emptyWriting = () => ({ body: '', attachments: [], quotes: [], addressees: [], caret: { start: 0, end: 0 } });

export function editorKey({ instanceId, actor, sourceRef, topicId, kind = 'reply' }) {
  if (!instanceId || !actor || !sourceRef?.kind || !sourceRef?.id) throw new Error('An editor needs its instance, actor and stable source identity.');
  return JSON.stringify([instanceId, actor, kind, sourceRef.kind, sourceRef.id, kind === 'note' ? null : topicId ?? null]);
}

export function keyAction(event, { context, menuActive = false, quoteArmed = false } = {}) {
  if (event.isComposing || event.keyCode === 229 || menuActive || event.key !== 'Enter') return 'native';
  if (event.repeat && (event.metaKey || event.altKey)) return 'native';
  if (context === 'note') return event.metaKey ? 'save-note' : 'newline';
  if (event.metaKey) return event.shiftKey ? 'send-stay' : 'send-return';
  if (event.altKey && context === 'reply') return 'send-stay';
  if (!event.shiftKey && quoteArmed && context === 'reader') return 'quote';
  return context === 'reader' ? 'native' : 'newline';
}

export class Editor {
  constructor(context, draft) {
    this.context = copy(context);
    this.key = editorKey(context);
    this.sourceRef = copy(draft?.source_ref ?? context.sourceRef);
    this.draft = { ...emptyWriting(), ...copy(draft ?? {}) };
    this.localVersion = 0;
    this.ackVersion = 0;
    this.submissions = [];
    this.conflict = null;
    this.journalError = null;
  }

  get dirty() { return this.localVersion > this.ackVersion; }
  get canNavigateAfterSend() {
    return this.submissions.length > 0 && this.submissions.at(-1).preparationConfirmed === true;
  }

  edit(patch) {
    // Only writing fields may be changed by user input, never its identity.
    for (const field of ['body', 'attachments', 'quotes', 'addressees', 'caret']) {
      if (Object.hasOwn(patch, field)) this.draft[field] = copy(patch[field]);
    }
    this.localVersion += 1;
  }

  saveTicket(operationId) {
    if ((this.context.kind !== 'note' && !this.draft.generation) || this.conflict) return null;
    return { operationId, key: this.key, localVersion: this.localVersion, draft: copy(this.draft), sourceRef: copy(this.sourceRef) };
  }

  matches(receipt, operationId, kind) {
    return receipt?.recorded === true && receipt.instance_id === this.context.instanceId && receipt.operation_id === operationId && receipt.kind === kind;
  }

  acceptSave(ticket, receipt) {
    if (!ticket || ticket.key !== this.key) return false;
    const kind = this.context.kind === 'note' ? 'note.save' : 'draft.save';
    if (!this.matches(receipt, ticket.operationId, kind)) return false;
    // Send may have opened local B while A's earlier autosave was in flight.
    // Only a still-preparing A may absorb that acknowledgement. Once its
    // preparation is recorded, its source revision is fixed and B owns saves.
    const pending = kind === 'draft.save' && this.submissions.find(item =>
      item.status === 'preparing' && item.snapshot.id === ticket.draft.id &&
      item.snapshot.generation === ticket.draft.generation);
    const target = pending ? pending.snapshot : this.draft;
    if (ticket.draft.id !== target.id || ticket.draft.generation !== target.generation) return false;
    if (receipt.status === 'rejected') {
      const conflict = { error: copy(receipt.error), attempted: copy(ticket.draft) };
      if (pending) pending.saveConflict = conflict;
      else this.conflict = conflict;
      return false;
    }
    if (receipt.status !== 'committed') return false;
    const result = receipt.result ?? {};
    const revision = kind === 'note.save' ? result.note_revision : result.draft_revision;
    if (!Number.isInteger(revision) || revision < (target.revision ?? 0)) return false;
    if (kind === 'draft.save' && (result.draft_id !== target.id || result.generation !== target.generation)) return false;
    if (kind === 'note.save' && result.note_id !== target.id) return false;
    target.revision = revision;
    if (pending) pending.savedVersion = Math.max(pending.savedVersion ?? -1, ticket.localVersion);
    else this.ackVersion = Math.max(this.ackVersion, ticket.localVersion);
    return true;
  }

  beginPrepare({ prepareOperationId, sendOperationId, submissionId }) {
    if (this.context.kind === 'note') throw new Error('A private note cannot be sent.');
    const active = this.submissions.find(item => item.status === 'preparing');
    if (active) return active;
    if (!this.draft.generation || this.conflict) throw new Error('Resolve the draft before preparing a send.');
    const submission = {
      id: submissionId, prepareOperationId, sendOperationId,
      sourceRef: copy(this.sourceRef), topicId: this.context.topicId,
      snapshot: copy(this.draft), localVersion: this.localVersion,
      savedVersion: this.ackVersion, saveConflict: null,
      status: 'preparing', preparationConfirmed: false, receipt: null,
    };
    this.submissions.push(submission);
    // A stays visible in submissions. New keystrokes have a separate local home
    // immediately, even before the server assigns the successor generation.
    this.draft = { ...emptyWriting(), id: this.draft.id, revision: null, generation: null };
    // Keep versions monotonic across writing cycles. A refused preparation
    // retains the server slot: a late A save can share B's generation, but
    // must never acknowledge edits made after this boundary.
    this.ackVersion = this.localVersion;
    return submission;
  }

  acceptPreparation(receipt) {
    const item = this.submissions.find(entry => this.matches(receipt, entry.prepareOperationId, 'submission.prepare'));
    if (!item || item.preparationConfirmed || item.status === 'refused') return false;
    if (receipt.status === 'rejected') {
      item.status = 'refused';
      item.receipt = copy(receipt);
      // No server rotation happened. A remains recoverable as a rejected
      // snapshot; B can now be saved into the existing slot explicitly.
      this.draft.id = item.snapshot.id;
      this.draft.revision = item.snapshot.revision;
      this.draft.generation = item.snapshot.generation;
      return true;
    }
    const next = receipt.result?.next_draft;
    if (receipt.status !== 'committed' || receipt.result?.submission_id !== item.id || receipt.result?.send_operation_id !== item.sendOperationId || !next?.id || !next.generation || !Number.isInteger(next.revision)) return false;
    item.preparationConfirmed = true;
    item.status = 'prepared';
    item.prepareReceipt = copy(receipt);
    // Bind the existing local B. Never replace its text with an empty server B.
    this.draft.id = next.id;
    this.draft.revision = next.revision;
    this.draft.generation = next.generation;
    return true;
  }

  acceptSend(receipt) {
    const item = this.submissions.find(entry => this.matches(receipt, entry.sendOperationId, 'message.send'));
    if (!item || !item.preparationConfirmed || !['committed', 'rejected'].includes(receipt.status)) return false;
    if (receipt.status === 'committed' && receipt.result?.submission_id !== item.id) return false;
    item.receipt = copy(receipt);
    item.status = receipt.status === 'committed' ? 'confirmed' : 'refused';
    // A's outcome has no authority over B's writing or its save state.
    return true;
  }

  snapshot() {
    return copy({ format: 1, key: this.key, context: this.context, sourceRef: this.sourceRef, draft: this.draft,
      localVersion: this.localVersion, ackVersion: this.ackVersion, submissions: this.submissions, conflict: this.conflict });
  }
}

export function restoreEditor(context, serverDraft, journal) {
  if (!journal) return new Editor(context, serverDraft);
  if (journal.format !== 1 || journal.key !== editorKey(context)) throw new Error('Recovery data belongs to a different editor.');
  const editor = new Editor(context, serverDraft);
  editor.submissions = copy(journal.submissions);
  const unsettled = journal.submissions.some(item => ['preparing', 'prepared'].includes(item.status));
  if (journal.localVersion > journal.ackVersion || unsettled || journal.conflict) {
    for (const field of ['sourceRef', 'draft', 'localVersion', 'ackVersion', 'submissions', 'conflict']) editor[field] = copy(journal[field]);
    // A successor whose prepare reply was lost must first reconcile preparation.
    // A different server revision in a known generation is a visible conflict.
    if (serverDraft && editor.draft.generation &&
        (serverDraft.generation !== editor.draft.generation || serverDraft.revision !== editor.draft.revision)) {
      editor.conflict = { remote: copy(serverDraft), attempted: copy(editor.draft) };
    }
  }
  return editor;
}

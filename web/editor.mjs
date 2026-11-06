import { imageBarrier, freezeImages, readableUploads, refusedAtDraft } from './upload-state.mjs';

// Private writing state. DOM, transport and persistence are separate owners.
const copy = value => structuredClone(value);
const emptyWriting = () => ({ body: '', attachments: [], quotes: [], addressees: [], caret: { start: 0, end: 0 } });

// Whether a reply or note holds anything the person wrote or chose. Core keeps
// the same rule: only writing holds on to the Notebook revision it is about.
export const holdsWriting = draft => Boolean(draft && (draft.body || draft.attachments?.length || draft.quotes?.length ||
  draft.addressees?.length || ['reply_to', 'exchange_id', 'opening'].some(name => draft[name] != null)));

function topicCompositionError(context, sourceRef, draft) {
  if (context.sourceRef?.kind !== 'topic') return null;
  const canonical = ref => ref?.kind === 'topic' && ref.id === context.topicId &&
    Object.keys(ref).length === 2 && typeof ref.id === 'string' && Boolean(ref.id);
  if (context.kind !== 'reply' || !canonical(context.sourceRef) || !canonical(sourceRef) ||
      Object.hasOwn(draft, 'source_ref') && !canonical(draft.source_ref) ||
      Object.hasOwn(draft, 'topic_id') && draft.topic_id !== context.topicId ||
      ['reply_to', 'exchange_id', 'opening'].some(field => Object.hasOwn(draft, field)) ||
      !Array.isArray(draft.quotes) || draft.quotes.length) {
    return 'This saved topic message has a different destination or reply fields. Its writing is kept; review it before continuing.';
  }
  return null;
}

export function editorKey({ instanceId, actor, sourceRef, topicId, kind = 'reply' }) {
  if (!instanceId || !actor || !sourceRef?.kind || !sourceRef?.id) throw new Error('An editor needs its instance, actor and stable source identity.');
  return JSON.stringify([instanceId, actor, kind, sourceRef.kind, sourceRef.id, kind === 'note' ? null : topicId ?? null]);
}

export function keyAction(event, { context, menuActive = false, quoteArmed = false, writingEmpty = false } = {}) {
  if (event.isComposing || event.keyCode === 229 || menuActive || event.key !== 'Enter') return 'native';
  if (event.repeat && (event.metaKey || event.altKey)) return 'native';
  if (context === 'note') return event.metaKey ? 'save-note' : 'newline';
  if (event.metaKey && event.shiftKey && writingEmpty && ['reader', 'reply'].includes(context)) return 'return-gallery';
  if (event.metaKey) return event.shiftKey ? 'send-stay' : 'send-return';
  if (event.altKey && context === 'reply') return 'send-stay';
  if (!event.shiftKey && quoteArmed && context === 'reader') return 'quote';
  return context === 'reader' ? 'native' : 'newline';
}

export class Editor {
  constructor(context, draft) {
    // New topics are server-owned openings (opening.mjs), never a prepared submission.
    if (context?.sourceRef?.kind === 'new_topic') throw new Error('A new topic is written as an opening, not in a reply editor.');
    this.context = copy(context);
    this.key = editorKey(context);
    this.sourceRef = copy(draft?.source_ref ?? context.sourceRef);
    this.draft = { ...emptyWriting(), ...copy(draft ?? {}) };
    this.clientCycleId = crypto.randomUUID();
    this.localVersion = 0;
    this.ackVersion = 0;
    this.submissions = [];
    this.conflict = null;
    this.journalError = null;
    this.validateComposition();
  }

  validateComposition() {
    const message = topicCompositionError(this.context, this.sourceRef, this.draft);
    if (message) this.conflict = { error: { code: 'INVALID_TOPIC_COMPOSITION', message }, attempted: copy(this.draft) };
    return !message;
  }

  get dirty() { return this.localVersion > this.ackVersion; }
  get canNavigateAfterSend() {
    const latest = this.submissions.at(-1);
    return Boolean(latest && !latest.detached && latest.preparationConfirmed === true);
  }

  // The Notebook revision the person is reading. Writing keeps the revision it
  // was started on. A reply or note with nothing in it, saved as it stands
  // (on opening, once an emptied one is saved, once a sent one's place is
  // empty), is about the revision in front of the person. A refused
  // preparation left its writing in Core's slot, so the slot keeps its
  // revision while it still holds that writing: until the refusal is prepared
  // again, or new writing is saved or sent in its place.
  read(ref) { this.reading = copy(ref); this.follow(); }
  follow() {
    const ref = this.reading, pinned = this.sourceRef;
    if (ref?.kind !== 'memory' || pinned?.kind !== 'memory' || ref.id !== pinned.id || ref.revision === pinned.revision) return;
    if (this.dirty || this.conflict || holdsWriting(this.draft) || this.imageReservation || this.imageBusy || this.uploadOpaque ||
        this.uploadState?.entries?.some(entry => entry.selected) ||
        this.submissions.some(item => item.status === 'preparing' && !item.detached || refusedAtDraft(item, this.draft))) return;
    this.pin(ref);
  }
  pin(ref) {
    this.sourceRef = copy(ref);
    if (Object.hasOwn(this.draft, 'source_ref')) this.draft.source_ref = copy(ref);
  }

  // Who a reply goes to unless the person says otherwise: the author of the
  // message it answers. They are offered while the reply holds nothing, become
  // its recipients with the first thing written, and are dropped when the
  // person removes them. Writing kept from before keeps its own recipients.
  offerAddressees(names) { this.offered = [...names]; }
  declineAddressee(name) { if (this.offered) this.offered = this.offered.filter(item => item !== name); }
  get offeredAddressees() {
    return holdsWriting(this.draft) ? [] : (this.offered ?? []).filter(name => !this.draft.addressees.includes(name));
  }

  edit(patch) {
    const offered = this.offeredAddressees;
    // Only writing fields may be changed by user input, never its identity.
    for (const field of ['body', 'attachments', 'quotes', 'addressees', 'caret']) {
      if (Object.hasOwn(patch, field)) this.draft[field] = copy(patch[field]);
    }
    if (offered.length && holdsWriting(this.draft)) {
      this.draft.addressees = [...offered, ...this.draft.addressees.filter(name => !offered.includes(name))];
    }
    this.localVersion += 1;
  }

  saveTicket(operationId) {
    if (!this.validateComposition()) return null;
    if ((this.context.kind !== 'note' && !this.draft.generation) || this.conflict) return null;
    return { operationId, key: this.key, localVersion: this.localVersion, draft: copy(this.draft), sourceRef: copy(this.sourceRef) };
  }

  matches(receipt, operationId, kind) {
    return receipt?.recorded === true && receipt.instance_id === this.context.instanceId && receipt.operation_id === operationId && receipt.kind === kind;
  }

  acceptSave(ticket, receipt, { bindDraft = true } = {}) {
    if (!ticket || ticket.key !== this.key) return false;
    const kind = this.context.kind === 'note' ? 'note.save' : 'draft.save';
    if (!this.matches(receipt, ticket.operationId, kind)) return false;
    // Send may have opened local B while A's earlier autosave was in flight.
    // Only a still-preparing A may absorb that acknowledgement. Once its
    // preparation is recorded, its source revision is fixed and B owns saves.
    const pending = bindDraft && kind === 'draft.save' && this.submissions.find(item =>
      item.status === 'preparing' && !item.detached && item.snapshot.id === ticket.draft.id &&
      item.snapshot.generation === ticket.draft.generation);
    const target = bindDraft ? (pending ? pending.snapshot : this.draft) : copy(ticket.draft);
    if (ticket.draft.id !== target.id || ticket.draft.generation !== target.generation) return false;
    if (receipt.status === 'rejected') {
      const conflict = { error: copy(receipt.error), attempted: copy(ticket.draft) };
      if (pending) pending.saveConflict = conflict;
      else if (bindDraft) this.conflict = conflict;
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
    else if (bindDraft) { this.ackVersion = Math.max(this.ackVersion, ticket.localVersion); this.follow(); }
    return true;
  }

  beginPrepare({ prepareOperationId, sendOperationId, submissionId }) {
    if (!this.validateComposition()) throw Error(this.conflict.error.message);
    if (this.context.kind === 'note') throw new Error('A private note cannot be sent.');
    const active = this.submissions.find(item => item.status === 'preparing' && !item.detached);
    if (active) return active;
    const barrier = imageBarrier(this);
    if (barrier) throw new Error(barrier);
    if (!this.draft.generation || this.conflict) throw new Error('Resolve the draft before preparing a send.');
    const submission = {
      id: submissionId, prepareOperationId, sendOperationId,
      sourceRef: copy(this.sourceRef), topicId: this.context.topicId,
      snapshot: copy(this.draft), localVersion: this.localVersion,
      savedVersion: this.ackVersion, saveConflict: null,
      status: 'preparing', preparationConfirmed: false, receipt: null,
    };
    freezeImages(this, submission);
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

  acceptPreparation(receipt, { bindDraft = true } = {}) {
    const item = this.submissions.find(entry => this.matches(receipt, entry.prepareOperationId, 'submission.prepare'));
    if (!item || item.preparationConfirmed || item.status === 'refused') return false;
    if (receipt.status === 'rejected') {
      item.status = 'refused';
      item.receipt = copy(receipt);
      // No server rotation happened. A remains recoverable as a rejected
      // snapshot; B can now be saved into the existing slot explicitly.
      if (bindDraft) {
        this.draft.id = item.snapshot.id;
        this.draft.revision = item.snapshot.revision;
        this.draft.generation = item.snapshot.generation;
      }
      return true;
    }
    const next = receipt.result?.next_draft;
    if (receipt.status !== 'committed' || receipt.result?.submission_id !== item.id || receipt.result?.send_operation_id !== item.sendOperationId || !next?.id || !next.generation || !Number.isInteger(next.revision)) return false;
    item.preparationConfirmed = true;
    item.status = 'prepared';
    item.prepareReceipt = copy(receipt);
    // Bind the existing local B. Never replace its text with an empty server B.
    if (bindDraft) {
      this.draft.id = next.id;
      this.draft.revision = next.revision;
      this.draft.generation = next.generation;
      this.follow();
    }
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
    return copy({ ...this.journalExtras, format: this.uploadState || this.uploadOpaque ? 2 : 1,
      ...(this.uploadState || this.uploadOpaque ? { clientCycleId: this.clientCycleId, uploadState: this.uploadState } : {}), key: this.key, context: this.context, sourceRef: this.sourceRef, draft: this.draft,
      localVersion: this.localVersion, ackVersion: this.ackVersion, submissions: this.submissions, conflict: this.conflict });
  }
}

export function restoreEditor(context, serverDraft, journal) {
  if (!journal) return new Editor(context, serverDraft);
  if (![1, 2].includes(journal.format) || journal.key !== editorKey(context)) throw new Error('Recovery data belongs to a different editor.');
  const editor = new Editor(context, serverDraft);
  editor.submissions = copy(journal.submissions);
  if (journal.format === 2) {
    editor.uploadOpaque = !readableUploads(journal);
    editor.clientCycleId = journal.clientCycleId;
    editor.uploadState = copy(journal.uploadState);
    editor.journalExtras = copy(journal);
    for (const field of ['format', 'key', 'context', 'sourceRef', 'draft', 'localVersion', 'ackVersion', 'submissions', 'conflict', 'clientCycleId', 'uploadState', 'attempts', 'activeAuthority', 'authorityRecovery']) delete editor.journalExtras[field];
  }
  const unsettled = journal.submissions.some(item => ['preparing', 'prepared'].includes(item.status) && !item.detached);
  if (journal.format === 2 || journal.localVersion > journal.ackVersion || unsettled || journal.conflict) {
    for (const field of ['sourceRef', 'draft', 'localVersion', 'ackVersion', 'submissions', 'conflict']) editor[field] = copy(journal[field]);
    // A successor whose prepare reply was lost must first reconcile preparation.
    // A different server revision in a known generation is a visible conflict.
    if (serverDraft && editor.draft.generation && !(journal.conflict && !Object.hasOwn(journal.conflict, 'remote')) &&
        (serverDraft.generation !== editor.draft.generation || serverDraft.revision !== editor.draft.revision ||
         journal.format === 2 && editor.submissions.some(item => refusedAtDraft(item, serverDraft)))) {
      editor.conflict = { remote: copy(serverDraft), attempted: copy(editor.draft) };
    }
  }
  editor.validateComposition();
  return editor;
}

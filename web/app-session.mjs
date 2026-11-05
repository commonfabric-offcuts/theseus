import { Editor, editorKey, restoreEditor } from './editor.mjs';
import { EditorSession, RuntimeAuthority } from './session.mjs';
import { RecoveryCleanup, eligible } from './cleanup.mjs';
import { Uploads } from './uploads.mjs';
import { uploadWork, readableUploads, copyNeedsImageReview, refusedCopyAtDraft, copyChoiceKey } from './upload-state.mjs';

const copy = value => structuredClone(value);
// A listed copy that holds the reply for image review until it is resolved.
const imageCopy = item => item.uploadPresent || item.snapshot?.format === 2 || item.availability === 'unreadable';
const same = (a, b) => {
  if (a === b) return true;
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object' || Array.isArray(a) !== Array.isArray(b)) return false;
  const keys = Object.keys(a);
  return keys.length === Object.keys(b).length && keys.every(key => Object.hasOwn(b, key) && same(a[key], b[key]));
};
const realTimers = { setTimeout: (fn, ms) => setTimeout(fn, ms), clearTimeout: id => clearTimeout(id), now: () => Date.now() };
const pairedReads = async reads => {
  const settled = await Promise.allSettled(reads);
  const failed = settled.find(result => result.status === 'rejected');
  if (failed) throw failed.reason;
  return settled.map(result => result.value);
};

// Composition owns presentations and scheduling; EditorSession remains the only
// owner of save/prepare/send envelopes and authority recovery.
export class EditorRegistry {
  constructor({ api, bootstrap, journal, present = () => {}, closed = () => {}, changed = () => {}, activity = () => {},
    saveDelayMs = 450, maxSaveDelayMs = 2000, pendingPageSize = 20, timers = realTimers }) {
    if (!bootstrap?.actor || !bootstrap.instance_id || bootstrap.error) throw Error('A confirmed instance and actor are required.');
    if (!(saveDelayMs > 0 && maxSaveDelayMs >= saveDelayMs)) throw Error('Saves need bounded idle and maximum delays.');
    Object.assign(this, { api, bootstrap: copy(bootstrap), journal, present, closed, changed, activity, saveDelayMs, maxSaveDelayMs, pendingPageSize, timers });
    this.runtime = new RuntimeAuthority({ api, instanceId: bootstrap.instance_id, authority: bootstrap.authority });
    this.sessions = new Map(); this.pages = new Map(); this.scheduled = new Map(); this.localWrites = new Map();
    this.pendingDetails = new Map(); this.pendingReceipts = new Map(); this.registering = new Map();
    this.current = null; this.inline = null; this.generation = 0; this.disposed = false;
    this.neighborGeneration = 0;
    this.cleanup = new RecoveryCleanup({ api, bootstrap: this.bootstrap, journal, runtime: this.runtime,
      changed: editor => this.changed(editor), stopped: () => this.disposed });
  }

  sessionFor(editor) {
    const session = this.sessions.get(editor.key);
    if (!session || session.editor !== editor) throw Error('This writing is not registered in this document.');
    return session;
  }

  get interactive() { return this.current ?? this.inline; }
  isCurrent(presentation, editor) {
    return Boolean(presentation && this.interactive === presentation && !this.pendingOpen && !this.disposed &&
      (presentation.surface !== 'inline' || presentation.initialized) &&
      (!editor || Object.values(presentation.editors).includes(editor) && this.sessions.get(editor.key)?.editor === editor));
  }
  isSourceCurrent(presentation) { return Boolean(presentation?.source && this.current?.source === presentation.source && !this.pendingOpen && !this.disposed); }

  async initializeInline(topic) {
    if (this.disposed || !topic?.id) throw Error('A confirmed topic is required before writing.');
    if (this.inline) {
      if (this.inline.topic.id !== topic.id) throw Error('This composer belongs to another topic.');
      return this.inline;
    }
    if (this.initializingInline) return this.initializingInline;
    const initialize = async () => {
      const foreground = this.cleanup.foreground(), sourceRef = { kind: 'topic', id: topic.id };
      try {
        const state = await foreground.read(options => this.api.view('editor_state', { source_ref: sourceRef, topic_id: topic.id, limit: this.pendingPageSize }, options));
        this.validateState(state, sourceRef, topic.id);
        if (state.note !== null) throw Error('A topic composer cannot hold a private note.');
        if (this.disposed) return null;
        const reply = await this.register({ instanceId: this.bootstrap.instance_id, actor: this.bootstrap.actor, sourceRef, topicId: topic.id, kind: 'reply' }, state.draft);
        if (this.disposed) return null;
        reply.unavailable = !state.source_available || !state.destination_available;
        this.pages.set(reply.key, copy(state.submissions));
        this.inline = { surface: 'inline', initialized: true, topic: copy(topic), editors: { reply }, mode: 'reply', destinationAvailable: !reply.unavailable };
        this.present(this.inline); this.activity(); return this.inline;
      } finally { foreground.release(); }
    };
    this.initializingInline = initialize();
    try { return await this.initializingInline; } finally { this.initializingInline = null; }
  }

  validateState(state, sourceRef, topicId) {
    if (state?.error || state?.instance_id !== this.bootstrap.instance_id || !same(state.source_ref, sourceRef) ||
        !same(state.destination, { topic_id: topicId ?? null })) throw Error('The source or destination identity could not be confirmed.');
    for (const remote of [state.draft, state.note]) {
      if (remote && (!remote.id || !Number.isInteger(remote.revision) || remote.revision < 1 ||
          remote.source_ref?.kind !== sourceRef.kind || remote.source_ref?.id !== sourceRef.id)) throw Error('The saved writing does not match this source.');
    }
    if (state.draft && !state.draft.generation) throw Error('The saved draft generation is missing.');
    // A mark is the person's own reminder on a message; a server without marks sends none.
    const mark = state.mark;
    if (mark !== undefined && mark !== null && !(typeof mark.marked === 'boolean' && Number.isSafeInteger(mark.mark_revision) &&
        mark.mark_revision >= 0 && mark.marked === (mark.mark_revision % 2 === 1))) throw Error('The mark could not be confirmed.');
    this.validatePage(state.submissions);
  }

  validatePage(page) {
    if (page?.instance_id !== this.bootstrap.instance_id || !Array.isArray(page.items) ||
        !(page.next_cursor === null || Number.isInteger(page.next_cursor))) throw Error('The pending reply page could not be confirmed.');
    return page;
  }

  async register(context, remote) {
    const key = editorKey(context);
    if (this.sessions.has(key)) return this.sessions.get(key).editor;
    if (this.registering.has(key)) return this.registering.get(key);
    const pending = this.createEditor(context, remote);
    this.registering.set(key, pending);
    try { return await pending; } finally { if (this.registering.get(key) === pending) this.registering.delete(key); }
  }

  async createEditor(context, remote) {
    const key = editorKey(context);
    const row = await this.journal.own(key);
    if (row && (row.scope !== JSON.stringify([context.instanceId, context.actor]) || row.editorKey !== key ||
        row.snapshot?.context?.instanceId !== context.instanceId || row.snapshot.context.actor !== context.actor ||
        editorKey(row.snapshot.context) !== key || row.snapshot.key !== key)) throw Error('Recovery identity does not match this actor and source.');
    const initial = remote ?? { id: crypto.randomUUID(), revision: 0,
      ...(context.kind === 'reply' ? { generation: crypto.randomUUID() } : {}) };
    const editor = row ? restoreEditor(context, initial, row.snapshot) : new Editor(context, initial);
    const session = new EditorSession(editor, { api: this.api, journal: this.journal, authority: this.runtime.current,
      runtime: this.runtime, snapshot: row?.snapshot,
      changed: current => this.changed(current),
      persisted: (saved, snapshot) => {
        const row = { id: this.journal.id(editor.key), writerId: this.journal.writerId, stamp: 'eligibility',
          active: 1, scope: JSON.stringify([context.instanceId, context.actor]), editorKey: editor.key, snapshot };
        if (eligible(row, context) || snapshot.format === 2) this.cleanup.request(saved);
      },
      prepared: (_editor, _item, options) => {
        if (editor.dirty && editor.draft.generation && !editor.conflict && !editor.authorityRecovery) this.schedule(editor);
        if (!options.stay && this.isCurrent(options.presentation)) {
          this.close(options.presentation).catch(error => { editor.journalError = error.message; this.changed(editor); });
        }
      } });
    this.sessions.set(key, session);
    session.registered = () => this.sessions.get(key) === session && !this.disposed;
    if (context.kind === 'reply') {
      editor.recoveryDiscovery = true;
      editor.recoveryServerDraft = copy(remote ?? null);
      session.uploads = new Uploads(session, this);
      session.uploads.importRetained();
      await this.recoveryCandidates(editor);
    }
    return editor;
  }

  async keepLocal(presentation) {
    if (!presentation) return;
    return this.keepEditorsLocal(Object.values(presentation.editors));
  }

  async keepEditorsLocal(editors) {
    await Promise.all(editors.filter(editor => uploadWork(editor) || editor.localVersion > 0 ||
      editor.submissions.length || this.sessionFor(editor).attempts.length).map(editor => this.persistLocal(editor)));
    if (editors.some(editor => editor.imageBusy || editor.imageReservation ||
        editor.uploadState?.entries.some(e => e.selected && ['memory-only', 'capturing'].includes(e.bytes_state)))) throw Error('Keep this page open until the selected image is saved or removed.');
  }

  async open(sourceRef, { topicId, opener } = {}) {
    const foreground = this.cleanup.foreground();
    const token = ++this.generation;
    this.pendingOpen = token;
    this.activity();
    try {
    await this.keepLocal(this.interactive);
    const [sourceAnswer, state] = await foreground.read(options => pairedReads([
      this.api.view('source', sourceRef, options),
      this.api.view('editor_state', { source_ref: sourceRef, topic_id: topicId ?? null, limit: this.pendingPageSize }, options),
    ]));
    this.validateState(state, sourceRef, topicId);
    const sourceUnavailable = sourceAnswer?.error?.code === 'FORBIDDEN' && state.source_available === false && Boolean(state.draft || state.note);
    if (!sourceUnavailable && (sourceAnswer?.error || sourceAnswer?.instance_id !== this.bootstrap.instance_id ||
        !same(sourceAnswer.source_ref, sourceRef))) throw Error('The full source identity could not be confirmed.');
    if (token !== this.generation || this.disposed) return null;
    const context = { instanceId: this.bootstrap.instance_id, actor: this.bootstrap.actor, sourceRef, topicId };
    const reply = await this.register({ ...context, kind: 'reply' }, state.draft);
    const note = await this.register({ ...context, kind: 'note' }, state.note);
    if (token !== this.generation || this.disposed) return null;
    reply.unavailable = sourceUnavailable || !state.destination_available;
    note.unavailable = sourceUnavailable;
    this.pages.set(reply.key, copy(state.submissions));
    const source = sourceUnavailable ? { instance_id: this.bootstrap.instance_id, source_ref: copy(sourceRef),
      topic_id: topicId ?? null, title: 'Source unavailable', body: '', attachments: [] } : sourceAnswer;
    const presentation = { token, source, sourceUnavailable, destinationAvailable: state.destination_available,
      editors: { reply, note }, mode: 'reply', opener, mark: state.mark ?? null };
    this.pendingOpen = null;
    this.current = presentation; this.present(presentation); return presentation;
    } catch (error) {
      if (token !== this.generation || this.disposed) return null;
      throw error;
    } finally { foreground.release(); if (this.pendingOpen === token) this.pendingOpen = null; this.activity(); }
  }

  // Escape before the Reader shows, or a page that is leaving: the open under
  // way is dropped, as a newer open would drop it.
  cancelOpen() {
    if (!this.pendingOpen) return false;
    ++this.generation; this.pendingOpen = null; this.activity(); return true;
  }

  persistLocal(editor) {
    const session = this.sessionFor(editor), marker = { version: editor.localVersion, pending: true };
    this.localWrites.set(editor.key, marker);
    // persist captures now; it does not wait behind a command or session queue.
    const saved = session.persist();
    this.changed(editor);
    const settled = () => { marker.pending = false; this.changed(editor); };
    saved.then(settled, settled);
    return saved;
  }

  edited(editor) {
    const saved = this.persistLocal(editor);
    if (!editor.authorityRecovery && !editor.conflict && !editor.unavailable) this.schedule(editor);
    return saved;
  }

  schedule(editor) {
    let pending = this.scheduled.get(editor.key);
    const save = () => { this.flush(editor).catch(error => { editor.journalError = error.message; this.changed(editor); }); };
    if (!pending) {
      pending = { maximum: this.timers.setTimeout(save, this.maxSaveDelayMs) };
      this.scheduled.set(editor.key, pending);
    }
    if (pending.idle !== undefined) this.timers.clearTimeout(pending.idle);
    pending.idle = this.timers.setTimeout(save, this.saveDelayMs);
  }

  cancelSave(editor) {
    const pending = this.scheduled.get(editor.key);
    if (!pending) return;
    this.timers.clearTimeout(pending.idle); this.timers.clearTimeout(pending.maximum);
    this.scheduled.delete(editor.key);
  }

  flush(editor) { this.cancelSave(editor); return editor.unavailable ? this.persistLocal(editor).then(() => null) : this.sessionFor(editor).save(); }
  send(editor, options = {}) {
    if (options.presentation && !this.isCurrent(options.presentation, editor)) throw Error('Return to this writing before sending.');
    if (editor.unavailable) throw Error('The source or destination is unavailable. Your writing is kept on this device.');
    this.cancelSave(editor);
    return this.sessionFor(editor).send({ ...options, presentation: options.presentation ?? this.interactive });
  }

  async close(presentation, { explicit = false } = {}) {
    if (presentation?.surface === 'inline') return false;
    if (explicit) {
      if (!presentation || this.current !== presentation || this.disposed) return false;
      ++this.generation;
      this.pendingOpen = null;
    }
    const requestGeneration = this.generation;
    if (!this.isCurrent(presentation)) return false;
    try { await this.keepLocal(presentation); }
    catch { return false; }
    if (!this.isCurrent(presentation) || requestGeneration !== this.generation) return false;
    this.current = null; ++this.generation; this.closed(presentation); this.activity(); return true;
  }

  setMode(mode) {
    if (!this.current || !['reply', 'note'].includes(mode)) return null;
    this.pendingOpen = null;
    this.current = { ...this.current, token: ++this.generation, mode };
    this.activity();
    return this.current;
  }

  async saveNote(editor, presentation = this.current) {
    if (editor.context.kind !== 'note') throw Error('Only a private note may use Save note.');
    if (editor.unavailable) throw Error('The source is unavailable. Your note is kept on this device.');
    const version = editor.localVersion;
    const receipt = await this.flush(editor);
    const confirmed = receipt?.status === 'committed' || (!receipt && editor.draft.revision > 0 &&
      !editor.authorityRecovery && !editor.conflict && !this.sessionFor(editor).unsettledSave());
    if (confirmed && editor.ackVersion >= version && !editor.dirty && this.isCurrent(presentation)) {
      return this.close(presentation);
    }
    return false;
  }

  checkConfirmation(editor) { return this.sessionFor(editor).reconcile(); }
  status(editor) {
    if (editor.journalError) return 'Recovery copy unavailable — keep this page open';
    if (this.localWrites.get(editor.key)?.pending) return 'Saving recovery copy';
    if (editor.unavailable) return 'Source or destination unavailable — writing kept on this device';
    if (editor.authorityRecovery) return 'Runtime changed — review saved version';
    if (editor.conflict) return 'Not saved — another version needs review';
    if (editor.cleanupError && !editor.dirty) return editor.cleanupError;
    return editor.dirty ? 'Saved on this device — not yet saved to Theseus' : 'Saved to Theseus';
  }

  async neighbors(presentation, { read } = {}) {
    const source = presentation.source;
    if (source.source_ref.kind !== 'message' || !Number.isInteger(source.seq) || presentation.sourceUnavailable) return { previous: null, next: null };
    const generation = ++this.neighborGeneration;
    const args = direction => ({ topic_id: source.topic_id, cursor: source.seq, audience: 'reader', direction, limit: 1 });
    let reads;
    if (read) reads = [await read('topic_messages', args('before')), await read('topic_messages', args('after'))];
    else {
      const foreground = this.cleanup.foreground();
      try { reads = await foreground.read(options => pairedReads(['before', 'after'].map(direction => this.api.view('topic_messages', args(direction), options)))); }
      finally { foreground.release(); }
    }
    if (generation !== this.neighborGeneration || read && !this.isSourceCurrent(presentation)) return null;
    const refs = reads.map(page => {
      this.validatePage(page);
      if (page.items.length > 1 || page.items.some(item => item.topic_id !== source.topic_id || typeof item.id !== 'string')) throw Error('The neighboring source identity could not be confirmed.');
      return page.items.length ? { kind: 'message', id: page.items[0].id } : null;
    });
    return { previous: refs[0], next: refs[1] };
  }

  parkAuthority(binding, code) {
    if (binding.instance_id !== this.bootstrap.instance_id || binding.actor_id !== this.bootstrap.actor) return Promise.resolve();
    const pair = { authority_id: binding.authority_id, authority_epoch: binding.authority_epoch };
    // Each call closes its write gate synchronously, before waiting on any IDB.
    return Promise.all([...this.sessions.values()].map(session => {
      this.cancelSave(session.editor); return session.parkAuthority(pair, code);
    }));
  }

  // `shown(page, continued)` receives the checked page inside the cleanup task
  // that read it, so a later recheck's patch always lands after it. A page
  // continues the list only from the list's own next cursor: one whose list a
  // fresh discovery replaced meanwhile changes nothing and is refused.
  async recoveryCandidates(editor, options, shown = () => {}) {
    const limit = options?.limit ?? 10;
    if (!Number.isInteger(limit) || limit < 1 || limit > 10) throw Error('Recovery cleanup reads one page of at most ten versions.');
    let stale = false;
    const result = await this.cleanup.discover(this.sessionFor(editor), async () => {
      const page = await this.journal.candidates(editor.key, { ...options, limit });
      return Array.isArray(page) ? { items: page, nextCursor: null } : page;
    }, page => {
      const continued = Boolean(options?.cursor);
      if (continued && options.cursor !== editor.candidatesNext) { stale = true; return; }
      editor.candidatesNext = page.nextCursor;
      if (editor.context.kind === 'reply') {
        if (!continued) editor.imageCopies = new Map();
        for (const item of page.items) if (imageCopy(item)) editor.imageCopies.set(item.id, item);
        editor.imageCopiesNext = page.nextCursor;
      }
      shown(page, continued);
    });
    if (stale) throw Error('These saved versions changed. Review versions again.');
    if (editor.context.kind === 'reply') await this.settleImageCopies(editor);
    return result;
  }

  // After the image copies change: a refusal among them is compared with the
  // server draft read now, then the barrier and retained images follow. Up to
  // its first read it runs at once, so the barrier is never lowered early.
  // Only the latest settle's answer counts, and every settle finishes when the
  // latest one has, so no caller acts while a newer read is out. A failure is
  // reported only to the latest settle's caller; one a later settle overtook
  // finishes quietly, with the barrier that settle left.
  async settleImageCopies(editor) {
    const settle = editor.imageSettle = (editor.imageSettle ?? 0) + 1;
    const own = this.settleOnce(editor, settle);
    if (editor.imageSettle === settle) editor.imageSettled = own;
    for (let latest = settle, done = own; ; latest = editor.imageSettle, done = editor.imageSettled) {
      try { await done; } catch (error) { if (latest === settle && editor.imageSettle === settle) throw error; }
      if (editor.imageSettle === latest) return;
    }
  }

  async settleOnce(editor, settle) {
    if ([...editor.imageCopies.values()].some(row => refusedCopyAtDraft(row, undefined))) {
      // Until this scoped read succeeds the old slot cannot dismiss a newly
      // discovered refusal. Retry can establish the exact revision later.
      editor.recoveryServerDraft = undefined;
      editor.recoveryDiscovery = true; this.changed(editor);
      const state = await this.api.view('editor_state', { source_ref: editor.context.sourceRef, topic_id: editor.context.topicId });
      if (editor.imageSettle !== settle) return;
      this.validateState(state, editor.context.sourceRef, editor.context.topicId);
      editor.recoveryServerDraft = copy(state.draft ?? null);
    }
    this.updateImageBarrier(editor);
    await this.sessionFor(editor).uploads.validateRetained();
  }

  // A recheck of deferred rows replaces just those rows among the editor's
  // image copies, at once, and adds where a recovered one moved; it returns
  // what settles the copies after that, or null when the editor is no longer
  // this registry's.
  applyRecheck(editor, ids, page) {
    if (this.disposed || this.sessions.get(editor.key)?.editor !== editor) return null;
    if (editor.context.kind !== 'reply' || !editor.imageCopies) return Promise.resolve();
    for (const id of ids) editor.imageCopies.delete(id);
    for (const item of page.items) if (imageCopy(item)) editor.imageCopies.set(item.id, item);
    return this.settleImageCopies(editor);
  }

  updateImageBarrier(editor) {
    editor.recoveryDiscovery = Boolean(editor.imageCopiesNext || [...(editor.imageCopies?.values() ?? [])].some(row => copyNeedsImageReview(row, editor) &&
      !editor.imageWaivers?.has(JSON.stringify([editor.key, editor.clientCycleId, row.id, row.stamp]))));
    this.changed(editor);
  }

  // Removing a copy's image selections or discarding one retained file runs in
  // the editor's cleanup queue, so a recheck either sees the changed row or has
  // already been applied.
  async changeCandidateImages(editor, candidate, action) {
    const session = this.sessionFor(editor);
    const row = await this.cleanup.enqueue(editor.key, async () => {
      const row = await this.journal.changeCandidateImages(editor.key, candidate, action);
      if (editor.imageCopies && this.sessions.get(editor.key) === session) {
        editor.imageCopies.set(row.id, { ...row, availability: 'available' });
        this.updateImageBarrier(editor);
      }
      return row;
    });
    await session.uploads.validateRetained();
    return row;
  }

  async waiveUnreadable(editor, candidate) {
    const row = editor.imageCopies?.get(candidate.id);
    if (!row || row.stamp !== candidate.stamp || row.availability === 'open-in-another-tab' ||
        (row.snapshot && readableUploads(row.snapshot))) throw Error('Recover or resolve this image copy before sending.');
    const cycle = editor.clientCycleId;
    await this.journal.inspectCandidate(editor.key, candidate);
    if (editor.clientCycleId !== cycle || this.sessions.get(editor.key)?.editor !== editor) throw Error('This writing changed. Review the saved copy again.');
    (editor.imageWaivers ??= new Set()).add(JSON.stringify([editor.key, editor.clientCycleId, row.id, row.stamp]));
    this.updateImageBarrier(editor);
    await this.sessionFor(editor).uploads.validateRetained();
  }

  async keepCurrentWriting(editor, candidate) {
    const session = this.sessionFor(editor), cycle = editor.clientCycleId;
    const row = editor.imageCopies?.get(candidate.id);
    if (!row || row.stamp !== candidate.stamp || !refusedCopyAtDraft(row, editor.recoveryServerDraft)) throw Error('This saved refusal changed. Review it again.');
    await this.journal.inspectCandidate(editor.key, candidate);
    if (this.sessions.get(editor.key) !== session || editor.clientCycleId !== cycle || editor.imageCopies?.get(row.id)?.stamp !== row.stamp) throw Error('This writing changed. Review the saved copy again.');
    (editor.refusedCopyChoices ??= new Set()).add(copyChoiceKey(editor, row));
    this.updateImageBarrier(editor);
    await session.uploads.validateRetained();
  }

  async adoptCandidate(editor, candidate, presentation) {
    const previous = this.sessionFor(editor);
    if (!this.isCurrent(presentation, editor) || editor.localVersion || previous.attempts.length || editor.submissions.length || uploadWork(editor)) throw Error('This page has current writing. Keep both versions and copy deliberately.');
    const revision = editor.uploadState?.revision;
    const current = () => this.sessions.get(editor.key) === previous && this.isCurrent(presentation, editor) && !editor.localVersion &&
      editor.uploadState?.revision === revision && !editor.imageReservation && !editor.imageBusy;
    editor.adopting = true; this.changed(editor);
    try {
      const state = await this.api.view('editor_state', { source_ref: editor.context.sourceRef, topic_id: editor.context.topicId });
      this.validateState(state, editor.context.sourceRef, editor.context.topicId);
      if (!current()) throw Error('The current writing changed. Review both versions again.');
      await this.journal.adopt(editor.key, { id: candidate.id, stamp: candidate.stamp }, current);
      this.sessions.delete(editor.key);
      const restored = await this.register(editor.context, editor.context.kind === 'note' ? state.note : state.draft);
      presentation.editors[editor.context.kind] = restored;
      if (this.isCurrent(presentation)) this.present(presentation);
      return restored;
    } finally { editor.adopting = false; this.changed(editor); }
  }

  async inspectPending(editor, id) {
    const item = this.pending(editor).items.find(item => item.id === id);
    if (!item) throw Error('This pending reply is not on the selected page.');
    const detail = await this.api.view('submission', { submission_id: id });
    if (detail?.error || detail.instance_id !== this.bootstrap.instance_id || detail.id !== id ||
        !same(detail.source_ref, item.source_ref) || detail.topic_id !== editor.context.topicId ||
        detail.source_ref?.kind !== editor.sourceRef.kind || detail.source_ref?.id !== editor.sourceRef.id ||
        detail.send_operation_id !== item.send_operation_id || detail.prepare_operation_id !== item.prepare_operation_id ||
        !same(detail.authority, item.authority)) throw Error('The pending source identity could not be confirmed.');
    this.pendingDetails.set(id, copy(detail));
    this.rememberPendingReceipt(editor, item, detail.send_receipt);
    return detail;
  }

  async checkPending(editor, id) {
    const local = editor.submissions.find(item => item.id === id);
    if (local) return this.checkConfirmation(editor);
    const item = this.pending(editor).items.find(item => item.id === id);
    if (!item) throw Error('This pending reply is not on the selected page.');
    const receipt = await this.api.view('operation', { operation_id: item.send_operation_id });
    if (receipt.instance_id !== this.bootstrap.instance_id || receipt.operation_id !== item.send_operation_id ||
        !['unknown', 'committed', 'rejected'].includes(receipt.status) ||
        (receipt.status !== 'unknown' && (!receipt.recorded || receipt.kind !== 'message.send')) ||
        (receipt.status === 'committed' && receipt.result?.submission_id !== id)) throw Error('The confirmation identity could not be established.');
    const page = this.pending(editor);
    this.rememberPendingReceipt(editor, item, receipt);
    this.pages.set(editor.key, { ...page, items: page.items.map(entry => entry.id === id ? { ...entry, send_status: receipt.status } : entry) });
    this.changed(editor); return receipt;
  }

  rememberPendingReceipt(editor, item, receipt) {
    const operation = item.send_operation_id;
    if (receipt?.recorded === true && receipt.instance_id === editor.context.instanceId && receipt.operation_id === operation &&
        receipt.kind === 'message.send' && receipt.status === 'rejected' && typeof receipt.error?.message === 'string' && receipt.error.message.trim()) {
      this.pendingReceipts.set(JSON.stringify([editor.key, item.id, operation]), copy(receipt));
    }
  }

  pendingReason(editor, item) {
    const receipt = item.receipt ?? this.pendingReceipts.get(JSON.stringify([editor.key, item.id, item.send_operation_id]));
    const correct = receipt?.kind === 'submission.prepare' ? receipt.operation_id === item.prepareOperationId
      : receipt?.kind === 'message.send' && receipt.operation_id === (item.sendOperationId ?? item.send_operation_id);
    return receipt?.recorded === true && correct && receipt.instance_id === editor.context.instanceId && receipt.status === 'rejected' &&
      typeof receipt.error?.message === 'string' && receipt.error.message.trim() ? receipt.error.message : null;
  }

  pending(editor) { return this.pages.get(editor.key) ?? { instance_id: this.bootstrap.instance_id, items: [], next_cursor: null }; }
  async morePending(editor) {
    const previous = this.pending(editor);
    if (previous.next_cursor === null) return previous;
    const page = this.validatePage(await this.api.view('submissions', { source_ref: editor.sourceRef,
      topic_id: editor.context.topicId, cursor: previous.next_cursor, limit: this.pendingPageSize }));
    // Another open/refresh can replace the page while this read is in flight.
    if (this.pages.get(editor.key) !== previous) return this.pending(editor);
    const ids = new Set(previous.items.map(item => item.id));
    const result = { ...page, items: [...previous.items, ...page.items.filter(item => !ids.has(item.id))] };
    this.pages.set(editor.key, result); this.changed(editor); return result;
  }

  get hasInFlightSend() { return [...this.sessions.values()].some(session => session.sends.size > 0); }
  get unconfirmedSends() {
    return [...this.sessions.values()].flatMap(session => {
      const editor = session.editor;
      return editor.submissions.filter(item => !item.detached && ['preparing', 'prepared'].includes(item.status))
        .map(item => ({ session, editor, item }));
    });
  }
  get hasUnprotectedWriting() {
    return this.hasInFlightSend || [...this.sessions.values()].some(({ editor }) => this.localWrites.get(editor.key)?.pending ||
      editor.imageBusy || editor.imageReservation || editor.imageStorageError || editor.uploadState?.entries.some(e => e.selected && ['memory-only', 'capturing'].includes(e.bytes_state)) ||
      (editor.journalError && (uploadWork(editor) || editor.dirty || editor.submissions.some(item => item.status !== 'confirmed'))));
  }
  dispose() {
    this.disposed = true; ++this.generation;
    for (const { editor } of this.sessions.values()) this.cancelSave(editor);
  }
}

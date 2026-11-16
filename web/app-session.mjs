import { Editor, editorKey, restoreEditor, holdsWriting, noWriting } from './editor.mjs';
import { EditorSession, RuntimeAuthority } from './session.mjs';
import { RecoveryCleanup, eligible } from './cleanup.mjs';
import { Uploads } from './uploads.mjs';
import { uploadWork, readableUploads, copyNeedsImageReview, refusedCopyAtDraft, copyChoiceKey, currentImages } from './upload-state.mjs';

const copy = value => structuredClone(value);
// Every field of a writing but where its caret sits, empty; and a reply's words as such a writing: its body, quotes
// and images, and who it goes to and how (a whisper stays a whisper to the same one, an ask an ask). A reply names
// each image by its whole description; a draft names it by its id alone, as Theseus keeps it and as an image the
// person chose goes in. Put back so, the draft saved is the draft Theseus holds, and the copy kept on this device is
// retired as soon as it is saved, so no later page holds it for review.
const emptyWriting = () => { const { caret, ...fields } = noWriting(); return fields; };
const writingOf = words => ({ ...Object.fromEntries(Object.entries(emptyWriting()).map(([field, empty]) => [field, copy(words[field] ?? empty)])),
  attachments: (words.attachments ?? []).map(({ id }) => ({ id })) });
// A listed copy that holds the reply for image review until it is resolved.
const imageCopy = item => item.uploadPresent || item.snapshot?.format === 2 || item.availability === 'unreadable';
const same = (a, b) => {
  if (a === b) return true;
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object' || Array.isArray(a) !== Array.isArray(b)) return false;
  const keys = Object.keys(a);
  return keys.length === Object.keys(b).length && keys.every(key => Object.hasOwn(b, key) && same(a[key], b[key]));
};
// The refusal while an image is being chosen or kept: it is already in plain
// words, unlike a device save that failed.
class ImageHeld extends Error {
  constructor() { super('Keep this page open until the selected image is saved or removed.'); }
}
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
    this.sessions = new Map(); this.pages = new Map(); this.scheduled = new Map(); this.localWrites = new Map(); this.serverSaves = new Map();
    // When this page last saw each writing kept on this device, and saved to Theseus.
    this.savedTimes = new Map();
    this.pendingDetails = new Map(); this.pendingReceipts = new Map(); this.registering = new Map();
    // The replies this page set aside (setAside), which are in doubt no more.
    this.asides = new Set();
    this.current = null; this.inline = null; this.generation = 0; this.disposed = false; this.leaving = null; this.closing = null;
    this.neighborGeneration = 0;
    this.cleanup = new RecoveryCleanup({ api, bootstrap: this.bootstrap, journal, runtime: this.runtime,
      changed: editor => this.changed(editor), stopped: () => this.disposed,
      paused: () => [...this.sessions.values()].some(session => session.recovery) });
  }

  sessionFor(editor) {
    const session = this.sessions.get(editor.key);
    if (!session || session.editor !== editor) throw Error('This writing is not registered in this document.');
    return session;
  }

  get interactive() { return this.current ?? this.inline; }
  // The presentation in front, holding this registered editor, whether or not
  // an open is under way.
  holds(presentation, editor) {
    return Boolean(presentation && this.interactive === presentation && !this.disposed &&
      (presentation.surface !== 'inline' || presentation.initialized) &&
      (!editor || Object.values(presentation.editors).includes(editor) && this.sessions.get(editor.key)?.editor === editor));
  }
  // Every act on the writing in front: sending, images, versions, quiet closes.
  // An open under way stops them before it keeps the writing it is leaving,
  // and a close stops them while it keeps the writing it is closing.
  isCurrent(presentation, editor) { return this.holds(presentation, editor) && !this.pendingOpen && !this.closing; }
  // Typing in the Reader goes on while a step to another source waits: each
  // change is kept on this device as it lands, and Close, Escape or Topic
  // cancel the step and keep it. Once the step has read its source it stops
  // the Reader's typing and keeps the writing one last time before replacing
  // it. The inline composer waits from the start, since the open replaces it
  // in front with the Reader. A close stops typing while it keeps the writing,
  // so what it keeps is all there is when the Reader goes.
  isWritable(presentation, editor) {
    return this.holds(presentation, editor) && !this.closing &&
      (!this.pendingOpen || presentation.surface !== 'inline' && this.leaving !== this.pendingOpen);
  }
  // A close under way is keeping this presentation's writing on this device.
  isClosing(presentation) { return Boolean(presentation && this.closing?.presentation === presentation); }
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
        const state = await foreground.read(options => this.api.view('editor_state', { source_ref: sourceRef, topic_id: topic.id, limit: this.pendingPageSize, unsent: true }, options));
        this.validateState(state, sourceRef, topic.id);
        if (state.note !== null) throw Error('A topic composer cannot hold a private note.');
        if (this.disposed) return null;
        const context = { instanceId: this.bootstrap.instance_id, actor: this.bootstrap.actor, sourceRef, topicId: topic.id, kind: 'reply' };
        this.setPending(editorKey(context), copy(state.submissions));
        const reply = await this.register(context, state.draft);
        if (this.disposed) return null;
        reply.unavailable = !state.source_available || !state.destination_available;
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
        !(page.next_cursor === null || Number.isInteger(page.next_cursor)) || !(page.through === undefined || Number.isSafeInteger(page.through)) ||
        !(page.aside === undefined || Array.isArray(page.aside) && page.aside.every(item => typeof item?.id === 'string' && typeof item.restored === 'boolean' &&
          typeof item.body === 'string' && Array.isArray(item.attachments)))) throw Error('The pending reply page could not be confirmed.');
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
    // From here this writing can be in doubt, so the page is told now, as
    // setPending tells it of every later list.
    this.changed(editor);
    if (context.kind === 'reply') {
      editor.recoveryDiscovery = true;
      editor.recoveryServerDraft = copy(remote ?? null);
      session.uploads = new Uploads(session, this);
      session.uploads.importRetained();
      await this.recoveryCandidates(editor);
      // A reply kept on this device that Theseus did not take, from a page
      // that was reloaded or lost its connection, goes on now that it answers.
      this.resumeSession(session);
    }
    return editor;
  }

  // The page reaches Theseus again: held replies go on (EditorSession.resumeHeld).
  resumeHeld() { return Promise.all([...this.sessions.values()].map(session => this.resumeSession(session))); }
  resumeSession(session) {
    return session.resumeHeld().catch(error => { session.editor.journalError = error.message; this.changed(session.editor); });
  }

  async keepLocal(presentation) {
    if (!presentation) return;
    return this.keepEditorsLocal(Object.values(presentation.editors));
  }

  // Writing in front is kept on this device before a step replaces it. When
  // the device cannot keep it, the step is refused in plain words and the
  // device's own error goes to the console; the image refusal already is plain.
  async keepBeforeStep(presentation) {
    try { await this.keepLocal(presentation); }
    catch (error) {
      if (error instanceof ImageHeld) throw error;
      console.warn('Step: this device could not keep the writing', error);
      throw Error('Not opened: this device could not keep your writing. It stays here; keep this page open.', { cause: error });
    }
  }

  async keepEditorsLocal(editors) {
    await Promise.all(editors.filter(editor => uploadWork(editor) || editor.localVersion > 0 ||
      editor.submissions.length || this.sessionFor(editor).attempts.length).map(editor => this.persistLocal(editor)));
    if (editors.some(editor => editor.imageBusy || editor.imageReservation ||
        editor.uploadState?.entries.some(e => e.selected && ['memory-only', 'capturing'].includes(e.bytes_state)))) throw new ImageHeld();
  }

  async open(sourceRef, { topicId, opener } = {}) {
    const foreground = this.cleanup.foreground();
    const token = ++this.generation;
    this.pendingOpen = token;
    this.activity();
    try {
    await this.keepBeforeStep(this.interactive);
    const [sourceAnswer, state] = await foreground.read(options => pairedReads([
      this.api.view('source', sourceRef, options),
      this.api.view('editor_state', { source_ref: sourceRef, topic_id: topicId ?? null, limit: this.pendingPageSize, unsent: true }, options),
    ]));
    // A message the person may not read, such as a whisper they are not in, is
    // refused exactly as one that is not there (docs/whispers.md): a link to
    // either opens nothing of it, and says so in plain words (docs/links.md).
    if (sourceAnswer?.error?.code === 'FORBIDDEN' && state?.error?.code === 'FORBIDDEN') throw Error('This message is not available to you.');
    this.validateState(state, sourceRef, topicId);
    const sourceUnavailable = sourceAnswer?.error?.code === 'FORBIDDEN' && state.source_available === false && Boolean(state.draft || state.note);
    if (!sourceUnavailable && (sourceAnswer?.error || sourceAnswer?.instance_id !== this.bootstrap.instance_id ||
        !same(sourceAnswer.source_ref, sourceRef))) throw Error('The full source identity could not be confirmed.');
    if (token !== this.generation || this.disposed) return null;
    const context = { instanceId: this.bootstrap.instance_id, actor: this.bootstrap.actor, sourceRef, topicId };
    // The fresh list stands even if this open is dropped below; the view is told.
    this.setPending(editorKey({ ...context, kind: 'reply' }), copy(state.submissions));
    const reply = await this.register({ ...context, kind: 'reply' }, state.draft);
    const note = await this.register({ ...context, kind: 'note' }, state.note);
    if (token !== this.generation || this.disposed) return null;
    // Writing typed while the step waited is kept on this device before the
    // step replaces it, or the step is refused and the writing stays in front.
    this.leaving = token; this.activity();
    await this.keepBeforeStep(this.interactive);
    if (token !== this.generation || this.disposed) return null;
    reply.unavailable = sourceUnavailable || !state.destination_available;
    note.unavailable = sourceUnavailable;
    // What the person now reads; writing not yet begun is about it.
    if (!sourceUnavailable) { reply.read(sourceRef); note.read(sourceRef); }
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
    saved.then(() => { this.savedAt(editor).device = this.timers.now(); settled(); }, settled);
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

  flush(editor) {
    this.cancelSave(editor);
    if (editor.unavailable) return this.persistLocal(editor).then(() => null);
    // Saves to Theseus under way, for the saving sign.
    const saved = this.sessionFor(editor).save();
    this.serverSaves.set(editor.key, (this.serverSaves.get(editor.key) ?? 0) + 1); this.changed(editor);
    saved.then(receipt => { if (receipt?.status === 'committed') this.savedAt(editor).theseus = this.timers.now(); }, () => {});
    const settled = () => {
      const left = this.serverSaves.get(editor.key) - 1;
      if (left) this.serverSaves.set(editor.key, left); else this.serverSaves.delete(editor.key);
      this.changed(editor);
    };
    saved.then(settled, settled);
    return saved;
  }
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
      // Close, Escape or × again: this close takes over from any under way.
      this.pendingOpen = null; this.closing = null;
    }
    const requestGeneration = this.generation;
    if (!this.isCurrent(presentation)) return false;
    // An image the person is choosing is theirs to finish: Close is refused at
    // once, so the choice is not stopped and dropped by the close.
    if (Object.values(presentation.editors).some(editor => editor.imageReservation)) {
      if (explicit) throw new ImageHeld();
      return false;
    }
    // Everything that can take this presentation out of front moves the
    // generation (an open, a mode change, another close, disposal), so while
    // it is unchanged the presentation is still current.
    // Typing and every act on the writing wait while it is kept on this
    // device, so the Reader never closes over writing the device did not keep.
    const stop = this.closing = { presentation };
    this.activity();
    try {
      // A refused explicit close says why to the person who asked for it,
      // while this is still the writing they asked to close; an automatic
      // close (a prepared send, a saved note) stays quietly open.
      try { await this.keepLocal(presentation); }
      catch (error) {
        if (explicit && requestGeneration === this.generation) throw this.closeRefusal(error);
        return false;
      }
      if (requestGeneration !== this.generation) return false;
      this.current = null; ++this.generation; this.closed(presentation); return true;
    } finally { if (this.closing === stop) this.closing = null; this.activity(); }
  }

  // A device save that failed is said in plain words, and the device's own
  // error goes to the console; the image refusal already is plain.
  closeRefusal(error) {
    if (error instanceof ImageHeld) return error;
    console.warn('Close: this device could not keep the writing', error);
    return Error('Not closed: this device could not keep your writing. It stays here; keep this page open.');
  }

  setMode(mode) {
    if (!this.current || !['reply', 'note'].includes(mode)) return null;
    this.pendingOpen = null;
    this.current = { ...this.current, token: ++this.generation, mode };
    this.activity();
    return this.current;
  }

  // Done's answer, for the Reader: true when Theseus holds the note as it is
  // written, and a note with nothing written is held as it is; false when
  // Theseus does not; null when the note is no longer in front, which leaves
  // nothing to say. A saved note leaves its Reader open, back on the reply.
  async saveNote(editor, presentation = this.current) {
    if (editor.context.kind !== 'note') throw Error('Only a private note may use Save note.');
    if (editor.unavailable) throw Error('The source is unavailable. Your note is kept on this device.');
    const version = editor.localVersion;
    const receipt = await this.flush(editor);
    if (!this.isCurrent(presentation)) return null;
    // No receipt: nothing was left to save, unless a save is unsettled or needs review.
    const held = receipt ? receipt.status === 'committed'
      : !editor.authorityRecovery && !editor.conflict && !this.sessionFor(editor).unsettledSave();
    return held && editor.ackVersion >= version && !editor.dirty;
  }

  savedAt(editor) {
    if (!this.savedTimes.has(editor.key)) this.savedTimes.set(editor.key, { device: null, theseus: null });
    return this.savedTimes.get(editor.key);
  }
  // When the save the saving sign speaks of was: saved to Theseus, or kept on
  // this device only; null for any other state, or before this page saw one.
  savedTime(editor) {
    const state = this.saveSign(editor).state, times = this.savedTimes.get(editor.key);
    return (state === 'saved' ? times?.theseus : state === 'device' ? times?.device : null) ?? null;
  }
  // The newest topic version this writing's own confirmed sends reached in
  // this runtime, which the page waits to see before it says it is current.
  // A send confirmed under an earlier runtime (a recovery copy from before
  // the database was restored, or one a runtime review set aside) names a
  // version this runtime may never reach, so it names none (item 54).
  localTopicVersion(editor) {
    const now = this.runtime.current;
    let newest = 0;
    for (const item of editor.submissions) {
      if (item.detached || item.authority?.authority_id !== now.authority_id || item.authority?.authority_epoch !== now.authority_epoch) continue;
      const version = item.status === 'confirmed' && item.receipt?.result?.topic?.version;
      if (Number.isInteger(version) && version > newest) newest = version;
    }
    return newest;
  }
  checkConfirmation(editor) { return this.sessionFor(editor).reconcile(); }
  status(editor) { return this.saveSign(editor).text; }
  // The saving sign beside the writing: its words, and its state (saving,
  // device, saved or attention) the page marks them with. It says whether
  // this device and Theseus each hold the writing yet, so the person knows
  // when it is safe to leave.
  saveSign(editor) {
    const sign = (state, text) => ({ state, text });
    if (editor.journalError) return sign('attention', 'Recovery copy unavailable — keep this page open');
    if (this.isClosing(this.current) && Object.values(this.current.editors).includes(editor)) return sign('saving', 'Closing — saving on this device…');
    if (this.localWrites.get(editor.key)?.pending) return sign('saving', 'Saving on this device…');
    if (editor.unavailable) return sign('device', 'Source or destination unavailable — writing kept on this device');
    if (editor.authorityRecovery) return sign('attention', 'Runtime changed — review saved version');
    if (editor.conflict) return sign('attention', 'Not saved — another version needs review');
    if (editor.cleanupError && !editor.dirty) return sign('', editor.cleanupError);
    if (!editor.dirty) return sign('saved', 'Saved to Theseus');
    return this.scheduled.has(editor.key) || this.serverSaves.has(editor.key)
      ? sign('saving', 'Saved on this device — saving to Theseus…') : sign('device', 'Saved on this device — not yet saved to Theseus');
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
      // Core's position for it says whether it sits below More, which the Reader's
      // one exit reads (stack-order.mjs, stepTarget) when the page has not loaded it.
      return page.items.length ? { kind: 'message', id: page.items[0].id, position: page.items[0].stack_position ?? null } : null;
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
    this.sessionFor(editor);
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
    this.setPending(editor.key, { ...page, items: page.items.map(entry => entry.id === id ? { ...entry, send_status: receipt.status } : entry) });
    return receipt;
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

  // Sets one of this writing's replies in doubt aside, or with aside false
  // puts it back in doubt (Undo). Core records it as the person's own
  // operation and leaves it out of the replies not sent from then on, here,
  // after a reload and on another device (docs/replies-in-doubt.md). Its words
  // are kept: with the writing empty they go back into it as its draft, every
  // field of it (restored), and Undo takes them out again while they are as
  // restored; otherwise Core lists the reply under aside, words and all, so its
  // line keeps them in reach. Core first records it kept on its line and only
  // then, once the words are in the writing, restored, so a failure between
  // leaves them in both places, never in neither.
  async setAside(editor, id, aside) {
    const session = this.sessionFor(editor);
    if (session.underWay(id) === true) throw Error('This reply is on its way. Wait for it to finish.');
    const local = editor.submissions.find(item => item.id === id);
    const words = aside ? copy(local?.snapshot ?? this.pendingDetails.get(id) ?? await this.inspectPending(editor, id)) : null;
    const record = async restored => {
      const { authority_id, authority_epoch } = this.runtime.current;
      const receipt = await this.api.command({ v: 1, instance_id: this.bootstrap.instance_id, operation_id: `aside:${id}:${crypto.randomUUID()}`,
        kind: 'submission.set_aside', target: {}, expected: { authority: { authority_id, authority_epoch } },
        args: { submission_id: id, aside, ...(restored ? { restored } : {}) } });
      if (receipt?.status !== 'committed' || receipt.instance_id !== this.bootstrap.instance_id || receipt.result?.submission_id !== id ||
          receipt.result.aside !== aside) throw Error(receipt?.error?.message ?? 'Theseus did not confirm this. Try again.');
    };
    try {
      await record(false);
      if (aside) this.asides.add(id); else this.asides.delete(id);
      const current = this.sessions.get(editor.key) === session;
      if (aside && current && !holdsWriting(editor.draft) && !currentImages(editor).length && !editor.uploadOpaque && !editor.imageBusy && !editor.imageReservation && !editor.unavailable && !editor.conflict && !editor.authorityRecovery) {
        // receive, not edit: a name only offered here that the reply does not name is declined, never added to it.
        editor.receive(writingOf(words));
        (this.restoredAsides ??= new Map()).set(id, { key: editor.key, version: editor.localVersion, media: (words.attachments ?? []).map(ref => ref.id) });
        this.edited(editor);
        // Each image comes back checked and kept on this device, as one the person chose does, so a reload
        // finds it ready to go and the departure guard does not hold it as an image still being saved.
        if (words.attachments?.length) {
          session.uploads.importRetained();
          const back = new Set(words.attachments.map(ref => ref.id));
          for (const entry of session.uploads.current().filter(entry => entry.origin === 'retained-ref' && back.has(entry.retained_ref?.id) && !entry.ready_descriptor)) {
            await session.uploads.checkRetained(entry);
          }
        }
        await record(true);
      }
      const kept = this.restoredAsides?.get(id);
      if (!aside && kept) {
        this.restoredAsides.delete(id);
        if (current && kept.key === editor.key && kept.version === editor.localVersion) {
          for (const entry of (editor.uploadState?.entries ?? []).filter(entry => entry.selected && kept.media.includes(entry.retained_ref?.id ?? entry.association?.media_id))) {
            await session.uploads.remove(entry.selection_id);
          }
          editor.edit(emptyWriting()); this.edited(editor);
        }
      }
    } finally { await this.readPending(editor); }
  }
  // This writing's replies set aside, as Core's list of replies not sent last
  // answered: each with its words and whether they went back into the writing.
  asidesOf(editor) {
    const session = this.sessions.get(editor.key);
    if (editor.context.kind !== 'reply' || session?.editor !== editor) return [];
    return this.pages.get(editor.key)?.aside ?? [];
  }
  // The Set aside chips: one for each registered writing with a reply set aside
  // whose words are kept only on its line, so they stay one press away.
  get keptAside() {
    return [...this.sessions.values()].map(({ editor }) => ({ editor, count: this.asidesOf(editor).filter(item => !item.restored).length }))
      .filter(entry => entry.count).map(entry => ({ ...entry, kept: true, label: `Set aside ${entry.count}` }));
  }
  // The first page of this writing's replies not sent, read again.
  async readPending(editor) {
    const page = this.validatePage(await this.api.view('submissions', { source_ref: editor.sourceRef,
      topic_id: editor.context.topicId, limit: this.pendingPageSize, unsent: true }));
    if (this.sessions.get(editor.key)?.editor === editor) this.setPending(editor.key, page);
    return page;
  }

  pending(editor) { return this.pages.get(editor.key) ?? { instance_id: this.bootstrap.instance_id, items: [], next_cursor: null }; }
  async morePending(editor) {
    this.sessionFor(editor);
    const previous = this.pending(editor);
    if (previous.next_cursor === null) return previous;
    const page = this.validatePage(await this.api.view('submissions', { source_ref: editor.sourceRef,
      topic_id: editor.context.topicId, cursor: previous.next_cursor, limit: this.pendingPageSize, unsent: true }));
    // Another open/refresh can replace the page while this read is in flight.
    if (this.pages.get(editor.key) !== previous) return this.pending(editor);
    const ids = new Set(previous.items.map(item => item.id));
    const result = { ...page, items: [...previous.items, ...page.items.filter(item => !ids.has(item.id))] };
    this.setPending(editor.key, result); return result;
  }
  // The only write of the server's list of a writing's replies not sent. The
  // page is told of every change, as it is of every registration (createEditor).
  setPending(key, page) {
    this.pages.set(key, page);
    const session = this.sessions.get(key); if (session) this.changed(session.editor);
  }

  // The one answer to which of this editor's replies are in doubt (each as
  // this device holds it, else as the server lists it), and the words of the
  // button that reviews them (null when none is). A reply is in doubt unless
  // it is known sent, is on its way, or was replaced by a correction this
  // device holds, which then answers in its place. Known sent is this device's
  // confirmation, the server's record of its send, or the server's list of
  // replies not sent read to its end without it, when that read could see it
  // (docs/replies-in-doubt.md). A list not read to its end, or not read at
  // all, is unread: more may be in doubt, so it is never an answer of none.
  // An editor not registered here has none: it answers for nothing.
  doubt(editor) {
    const session = this.sessions.get(editor.key);
    if (editor.context.kind !== 'reply' || session?.editor !== editor) return { ids: new Set(), items: [], unread: false, count: 0, label: null };
    const page = this.pages.get(editor.key), unread = page?.next_cursor !== null;
    const local = new Map(editor.submissions.map(item => [item.id, item])), listed = new Map((page?.items ?? []).map(item => [item.id, item]));
    const sent = id => local.get(id)?.status === 'confirmed' || listed.get(id)?.send_status === 'committed' ||
      !unread && !listed.has(id) && local.get(id)?.status === 'prepared' && local.get(id).prepareReceipt?.result?.seq <= page.through;
    const items = [...new Map([...listed, ...local]).values()].filter(({ id }) => !sent(id) &&
      !local.has(local.get(id)?.correctedBy) && session.underWay(id) !== true && !this.asides?.has(id)), ids = new Set(items.map(item => item.id));
    const count = unread ? (ids.size ? ids.size + '+' : 'more') : ids.size;
    return { ids, items, unread, count, label: ids.size || unread ? `Review ${count} ${count === 1 ? 'reply' : 'replies'}` : null };
  }
  // The Review buttons: one for each registered writing with a reply in
  // doubt, in the order the writings registered, with doubt()'s answer. It reads only what the
  // registry holds now (docs/replies-in-doubt.md).
  get inDoubt() {
    return [...this.sessions.values()].map(session => ({ session, editor: session.editor, ...this.doubt(session.editor) })).filter(entry => entry.label);
  }
  get hasInFlightSend() { return [...this.sessions.values()].some(session => session.sends.size > 0); }
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

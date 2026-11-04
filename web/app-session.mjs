import { Editor, editorKey, restoreEditor } from './editor.mjs';
import { EditorSession, RuntimeAuthority } from './session.mjs';

const copy = value => structuredClone(value);
const same = (a, b) => {
  if (a === b) return true;
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object' || Array.isArray(a) !== Array.isArray(b)) return false;
  const keys = Object.keys(a);
  return keys.length === Object.keys(b).length && keys.every(key => Object.hasOwn(b, key) && same(a[key], b[key]));
};
const realTimers = { setTimeout: (fn, ms) => setTimeout(fn, ms), clearTimeout: id => clearTimeout(id), now: () => Date.now() };

// Composition owns presentations and scheduling; EditorSession remains the only
// owner of save/prepare/send envelopes and authority recovery.
export class EditorRegistry {
  constructor({ api, bootstrap, journal, present = () => {}, closed = () => {}, changed = () => {},
    saveDelayMs = 450, maxSaveDelayMs = 2000, pendingPageSize = 20, timers = realTimers }) {
    if (!bootstrap?.actor || !bootstrap.instance_id || bootstrap.error) throw Error('A confirmed instance and actor are required.');
    if (!(saveDelayMs > 0 && maxSaveDelayMs >= saveDelayMs)) throw Error('Saves need bounded idle and maximum delays.');
    Object.assign(this, { api, bootstrap: copy(bootstrap), journal, present, closed, changed, saveDelayMs, maxSaveDelayMs, pendingPageSize, timers });
    this.runtime = new RuntimeAuthority({ api, instanceId: bootstrap.instance_id, authority: bootstrap.authority });
    this.sessions = new Map(); this.pages = new Map(); this.scheduled = new Map(); this.localWrites = new Map();
    this.pendingDetails = new Map(); this.registering = new Map();
    this.current = null; this.generation = 0; this.disposed = false;
  }

  sessionFor(editor) {
    const session = this.sessions.get(editor.key);
    if (!session || session.editor !== editor) throw Error('This writing is not registered in this document.');
    return session;
  }

  isCurrent(presentation) { return Boolean(presentation && this.current === presentation && !this.pendingOpen && !this.disposed); }
  isSourceCurrent(presentation) { return Boolean(presentation && this.current?.source === presentation.source && !this.pendingOpen && !this.disposed); }

  validateState(state, sourceRef, topicId) {
    if (state?.error || state?.instance_id !== this.bootstrap.instance_id || !same(state.source_ref, sourceRef) ||
        !same(state.destination, { topic_id: topicId ?? null })) throw Error('The source or destination identity could not be confirmed.');
    for (const remote of [state.draft, state.note]) {
      if (remote && (!remote.id || !Number.isInteger(remote.revision) || remote.revision < 1 ||
          remote.source_ref?.kind !== sourceRef.kind || remote.source_ref?.id !== sourceRef.id)) throw Error('The saved writing does not match this source.');
    }
    if (state.draft && !state.draft.generation) throw Error('The saved draft generation is missing.');
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
      prepared: (_editor, _item, options) => {
        if (editor.dirty && editor.draft.generation && !editor.conflict && !editor.authorityRecovery) this.schedule(editor);
        if (!options.stay && this.isCurrent(options.presentation)) {
          this.close(options.presentation).catch(error => { editor.journalError = error.message; this.changed(editor); });
        }
      } });
    this.sessions.set(key, session);
    return editor;
  }

  async keepLocal(presentation) {
    if (!presentation) return;
    await Promise.all(Object.values(presentation.editors).filter(editor => editor.localVersion > 0 ||
      editor.submissions.length || this.sessionFor(editor).attempts.length).map(editor => this.persistLocal(editor)));
  }

  async open(sourceRef, { topicId, opener } = {}) {
    const token = ++this.generation;
    this.pendingOpen = token;
    try {
    await this.keepLocal(this.current);
    const [sourceAnswer, state] = await Promise.all([
      this.api.view('source', sourceRef),
      this.api.view('editor_state', { source_ref: sourceRef, topic_id: topicId ?? null, limit: this.pendingPageSize }),
    ]);
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
      editors: { reply, note }, mode: 'reply', opener };
    this.pendingOpen = null;
    this.current = presentation; this.present(presentation); return presentation;
    } catch (error) {
      if (token !== this.generation || this.disposed) return null;
      throw error;
    } finally { if (this.pendingOpen === token) this.pendingOpen = null; }
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
    if (editor.unavailable) throw Error('The source or destination is unavailable. Your writing is kept on this device.');
    this.cancelSave(editor);
    return this.sessionFor(editor).send({ ...options, presentation: options.presentation ?? this.current });
  }

  async close(presentation, { explicit = false } = {}) {
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
    this.current = null; ++this.generation; this.closed(presentation); return true;
  }

  setMode(mode) {
    if (!this.current || !['reply', 'note'].includes(mode)) return null;
    this.pendingOpen = null;
    this.current = { ...this.current, token: ++this.generation, mode };
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
    return editor.dirty ? 'Saved on this device — not yet saved to Theseus' : 'Saved to Theseus';
  }

  async neighbors(presentation) {
    const source = presentation.source;
    if (source.source_ref.kind !== 'message' || !Number.isInteger(source.seq) || presentation.sourceUnavailable) return { previous: null, next: null };
    const reads = await Promise.all(['before', 'after'].map(direction => this.api.view('topic_messages', {
      topic_id: source.topic_id, cursor: source.seq, audience: 'reader', direction, limit: 1,
    })));
    const refs = reads.map(page => {
      this.validatePage(page);
      if (page.items.length > 1 || page.items.some(item => item.topic_id !== source.topic_id || typeof item.id !== 'string')) throw Error('The neighboring source identity could not be confirmed.');
      return page.items.length ? { kind: 'message', id: page.items[0].id } : null;
    });
    return { previous: refs[0], next: refs[1] };
  }

  async recoveryCandidates(editor, options) {
    const page = await this.journal.candidates(editor.key, options);
    return Array.isArray(page) ? { items: page, nextCursor: null } : page;
  }

  async adoptCandidate(editor, candidate, presentation) {
    const previous = this.sessionFor(editor);
    if (!this.isCurrent(presentation) || editor.localVersion || previous.attempts.length || editor.submissions.length) throw Error('This page has current writing. Keep both versions and copy deliberately.');
    editor.adopting = true; this.changed(editor);
    try {
      const state = await this.api.view('editor_state', { source_ref: editor.context.sourceRef, topic_id: editor.context.topicId });
      this.validateState(state, editor.context.sourceRef, editor.context.topicId);
      if (!this.isCurrent(presentation) || editor.localVersion) throw Error('The current writing changed. Review both versions again.');
      await this.journal.adopt(editor.key, { id: candidate.id, stamp: candidate.stamp });
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
    this.pendingDetails.set(id, copy(detail)); return detail;
  }

  async checkPending(editor, id) {
    if (editor.submissions.some(item => item.id === id)) return this.checkConfirmation(editor);
    const item = this.pending(editor).items.find(item => item.id === id);
    if (!item) throw Error('This pending reply is not on the selected page.');
    const receipt = await this.api.view('operation', { operation_id: item.send_operation_id });
    if (receipt.instance_id !== this.bootstrap.instance_id || receipt.operation_id !== item.send_operation_id ||
        !['unknown', 'committed', 'rejected'].includes(receipt.status) ||
        (receipt.status !== 'unknown' && (!receipt.recorded || !['message.send', 'topic.create_and_send'].includes(receipt.kind))) ||
        (receipt.status === 'committed' && receipt.result?.submission_id !== id)) throw Error('The confirmation identity could not be established.');
    const page = this.pending(editor);
    this.pages.set(editor.key, { ...page, items: page.items.map(entry => entry.id === id ? { ...entry, send_status: receipt.status } : entry) });
    this.changed(editor); return receipt;
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

  get hasUnprotectedWriting() {
    return [...this.sessions.values()].some(({ editor }) => this.localWrites.get(editor.key)?.pending ||
      (editor.journalError && (editor.dirty || editor.submissions.some(item => item.status !== 'confirmed'))));
  }
  dispose() {
    this.disposed = true; ++this.generation;
    for (const { editor } of this.sessions.values()) this.cancelSave(editor);
  }
}

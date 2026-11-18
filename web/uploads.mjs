import { currentImages, imageBarrier, imageTypes, pair, samePin, readableUploads } from './upload-state.mjs';
const copy = structuredClone;
const digest = async blob => [...new Uint8Array(await crypto.subtle.digest('SHA-256', await blob.arrayBuffer()))].map(b => b.toString(16).padStart(2, '0')).join('');
const newAttempt = (role, contentType) => ({ role, media_id: crypto.randomUUID(), begin_operation_id: crypto.randomUUID(),
  publish_operation_id: crypto.randomUUID(), content_type: contentType, phase: 'captured', begin_envelope: null,
  publish_envelope: null, begin_response: null, publish_response: null, last_attempt_error: null, ready_descriptor: null });

export class Uploads {
  constructor(session, registry) {
    this.session = session; this.editor = session.editor; this.registry = registry;
    this.api = session.api; this.journal = session.journal;
    this.memory = new Map(); this.running = new Map(); this.aborters = new Map();
  }
  valid() { return !this.registry.disposed && this.registry.sessions.get(this.editor.key) === this.session; }
  initialize() {
    return this.editor.uploadState ??= { format: 2, revision: 0, client_cycle_id: this.editor.clientCycleId, entries: [], submission_links: {} };
  }
  current() { return currentImages(this.editor); }
  find(id) { const e = this.editor.uploadState?.entries.find(e => e.selection_id === id); if (!e) throw Error('This image is not in this editor.'); return e; }
  pending() { return Boolean(imageBarrier(this.editor)); }
  notify() { this.registry.changed(this.editor); }
  selected(e) { return this.valid() && e.selected && e.owner.kind === 'cycle' && e.owner.id === this.editor.clientCycleId; }
  pinned(e) { return samePin(e.binding.authority, this.session.authority) && samePin(e.binding.authority, this.registry.runtime.current) && !this.editor.authorityRecovery; }
  status(id) {
    const e = this.find(id), a = e.attempts[e.choice];
    if (e.local_error) return e.local_error;
    if (e.origin === 'retained-ref' && !e.ready_descriptor) return 'Checking attachment';
    if (e.bytes_state === 'memory-only') return 'Bytes not saved on this device';
    if (!a && !e.ready_descriptor) return 'Choose Attach as download';
    if (e.ready_descriptor) return this.selected(e) && this.editor.draft.attachments.some(r => r.id === e.association?.media_id) ? 'Ready' : 'Upload confirmed, not attached';
    if (a.last_attempt_error?.code === 'SERVER_BUSY') return 'Server busy';
    return { captured: 'Preparing', prepared: 'Preparing', 'begin-unknown': 'Confirmation unknown', begun: 'Ready to continue upload',
      'publish-unknown': this.running.has(id) ? 'Uploading' : 'Confirmation unknown', refused: 'Could not attach',
      'authority-blocked': 'Runtime changed — review image' }[a.phase] ?? 'Image state needs review';
  }
  async transition(mutate) {
    if (!this.valid()) throw Error('This image editor was replaced.');
    this.editor.passiveImages = false;
    this.editor.imageBusy = (this.editor.imageBusy ?? 0) + 1; this.notify();
    try {
      const result = await this.journal.transition(this.editor.key, () => this.session.snapshot(), () => {
        mutate(); this.initialize().revision++;
      }, () => this.valid());
      this.editor.imageStorageError = null;
      return result;
    } catch (error) { this.editor.imageStorageError = error.message; throw error; }
    finally { this.editor.imageBusy--; this.notify(); }
  }
  reserve(presentation) {
    if (!this.valid() || this.editor.adopting || this.editor.recoveryDiscovery || this.editor.imageReservation || !this.registry.isCurrent(presentation, this.editor)) throw Error('Review saved images before selecting another file.');
    const token = { id: crypto.randomUUID(), cycle: this.editor.clientCycleId, presentation };
    this.editor.imageReservation = token; this.notify(); return token;
  }
  cancel(token) { if (this.editor.imageReservation === token) { this.editor.imageReservation = null; this.notify(); } }
  async choose(token, file) {
    const valid = this.valid() && this.editor.imageReservation === token && token.cycle === this.editor.clientCycleId && this.registry.isCurrent(token.presentation, this.editor) && !this.editor.adopting;
    this.cancel(token);
    if (!valid) throw Error('That image selection has expired. Choose it again in the current reply.');
    return file ? this.add(file) : null;
  }
  admit(file) {
    if (this.editor.unavailable) throw Error('The source or destination is unavailable. Your writing is kept; the image was not added.');
    if (!this.valid() || this.editor.adopting || this.editor.recoveryDiscovery) throw Error('Review the current image copies first.');
    if (!(file instanceof Blob) || !Number.isInteger(file.size) || file.size < 1) throw Error('An empty image cannot be attached.');
    const l = this.registry.bootstrap.limits;
    if (!file.name || new TextEncoder().encode(file.name).length > l.media_name_utf8_bytes) throw Error('The image name is too long or empty.');
    if (file.size > (imageTypes.has(file.type) ? l.image_bytes : l.media_file_bytes)) throw Error('This file exceeds the attachment size limit.');
    const selected = this.current();
    const size = e => e.file?.size ?? e.ready_descriptor?.size_bytes;
    if (selected.some(e => !Number.isInteger(size(e)))) throw Error('Check or remove the retained attachment before adding an image.');
    if (selected.length >= l.attachment_count || selected.reduce((n, e) => n + size(e), file.size) > l.attachment_bytes) throw Error('The selected attachments exceed the count or combined size limit.');
    const retained = (this.editor.uploadState?.entries ?? []).filter(e => e.bytes_ref || ['memory-only', 'capturing'].includes(e.bytes_state));
    if (retained.length >= l.attachment_count || retained.reduce((n, e) => n + (e.file?.size ?? 0), file.size) > l.attachment_bytes) throw Error('Local image storage is full for this reply. Check or discard retained files in Review versions.');
    if (!samePin(this.session.authority, this.registry.runtime.current) || this.editor.authorityRecovery) throw Error('Review the runtime change before adding an image.');
  }
  async add(file, { start = true } = {}) {
    this.admit(file);
    this.editor.passiveImages = false;
    const editor = this.editor, state = this.initialize(), selection_id = crypto.randomUUID();
    const entry = { selection_id, origin: 'file', binding: { instance_id: editor.context.instanceId, actor_id: editor.context.actor,
      editor_key: editor.key, source_ref: copy(editor.sourceRef), topic_id: editor.context.topicId, captured_cycle_id: editor.clientCycleId,
      authority: pair(this.session.authority), draft_at_selection: { id: editor.draft.id, generation: editor.draft.generation } },
      owner: { kind: 'cycle', id: editor.clientCycleId }, version: 1, selected: true,
      file: { name: file.name, size: file.size, type: file.type, last_modified: file.lastModified ?? 0, sha256: null },
      bytes_ref: null, bytes_state: 'capturing', choice: imageTypes.has(file.type) ? 0 : null,
      attempts: imageTypes.has(file.type) ? [newAttempt('image', file.type)] : [], ready_descriptor: null, association: null };
    state.entries.push(entry); state.revision++; this.memory.set(selection_id, file); this.notify();
    if (await this.capture(entry) && start && entry.choice !== null) await this.run(entry);
    return selection_id;
  }
  async capture(e) {
    const blob = this.memory.get(e.selection_id);
    if (!blob) { e.local_error = 'Bytes not saved on this device — remove and choose the file again'; this.notify(); return false; }
    const metadata = Object.fromEntries(['name', 'size', 'type', 'last_modified'].map(k => [k, e.file[k]]));
    const bytes = { id: JSON.stringify([this.editor.key, 'upload-bytes', e.selection_id]), kind: 'upload-bytes-v1',
      scope: JSON.stringify([this.editor.context.instanceId, this.editor.context.actor]), editorKey: this.editor.key,
      selection_id: e.selection_id, created_by_writer: this.journal.writerId, metadata, blob };
    try {
      await this.journal.capture(this.editor.key, () => this.session.snapshot(), bytes, e, () => this.selected(e));
      this.memory.delete(e.selection_id); e.local_error = null; this.notify(); return true;
    } catch (error) {
      if (!this.valid()) throw error;
      e.bytes_state = 'memory-only'; e.bytes_ref = null;
      await this.session.persist(); this.notify(); return false;
    }
  }
  async bytes(e) {
    if (!e.bytes_ref || e.bytes_state !== 'durable') throw Error('Retained image bytes are unavailable.');
    const row = await this.journal.readBytes(this.editor.key, e.bytes_ref);
    if (!this.valid() || row?.blob?.size !== e.file.size || ['name', 'size', 'type', 'last_modified'].some(k => row.metadata?.[k] !== e.file[k])) throw Error('Retained image bytes do not match this selection.');
    const hash = await digest(row.blob);
    if (e.file.sha256 && e.file.sha256 !== hash) throw Error('Retained image bytes do not match their digest.');
    return { blob: row.blob, hash };
  }
  // The image's bytes for its thumbnail (image-pick.mjs), without changing
  // anything: the file as chosen, else the copy saved on this device, else the
  // verified original read back from Theseus. Null when it is not an image.
  async preview(id) {
    const e = this.find(id), d = e.ready_descriptor;
    if (!imageTypes.has(e.file?.type ?? d?.content_type)) return null;
    const held = this.memory.get(id);
    if (held) return held;
    if (e.bytes_ref && e.bytes_state === 'durable') return (await this.bytes(e)).blob;
    if (!d) return null;
    const media = await this.api.media(this.editor.context.instanceId, { id: d.media_id, name: d.name, content_type: d.content_type, size_bytes: d.size_bytes, sha256: d.sha256, inline: d.inline });
    return media.inline ? media.blob : null;
  }
  async prepare(e, a) {
    const { blob, hash } = await this.bytes(e);
    await this.transition(() => {
      e.file.sha256 ??= hash;
      if (!a.begin_envelope) {
        a.begin_envelope = this.session.envelope('media.begin', a.begin_operation_id, { media_id: a.media_id }, { media_revision: 0 },
          { name: e.file.name, content_type: a.content_type, size_bytes: e.file.size, sha256: hash, publish_operation_id: a.publish_operation_id }, e.binding.authority);
        a.publish_envelope = this.session.envelope('media.publish', a.publish_operation_id, { media_id: a.media_id }, { media_revision: 1 }, {}, e.binding.authority);
        a.phase = 'prepared';
      }
    });
    return blob;
  }
  exact(r, a, kind) { return r?.instance_id === this.editor.context.instanceId && r.operation_id === a[kind + '_operation_id'] && r.kind === 'media.' + kind; }
  unknown(r, op) { return r?.instance_id === this.editor.context.instanceId && r.operation_id === op && r.recorded === false && r.status === 'unknown' && Object.keys(r).length === 4; }
  descriptor(r, e, a) {
    return r?.instance_id === this.editor.context.instanceId && r.media_id === a.media_id && r.state === 'ready' && r.media_revision === 2 &&
      r.name === e.file.name && r.content_type === a.content_type && r.size_bytes === e.file.size && r.sha256 === e.file.sha256 && typeof r.inline === 'boolean';
  }
  async accept(e, a, kind, response, { associate = true } = {}) {
    if (!this.exact(response, a, kind)) throw Error('Image confirmation does not match the original operation.');
    const committed = response.recorded === true && response.status === 'committed';
    if (committed && (kind === 'begin' ? response.result?.media_id !== a.media_id || response.result?.media_revision !== 1 || response.result?.state !== 'pending'
      : !this.descriptor(response.result, e, a))) throw Error('Image confirmation metadata does not match the selected file.');
    if (!committed && (!response.error?.code || !['rejected', 'retryable'].includes(response.status))) throw Error('Image confirmation is unreadable.');
    await this.transition(() => {
      if (a[kind + '_response']?.recorded !== true) a[kind + '_response'] = copy(response);
      a.last_attempt_error = null;
      a.phase = committed ? (kind === 'begin' ? 'begun' : 'ready') : response.error.code === 'AUTHORITY_CHANGED' ? 'authority-blocked' : 'refused';
      if (committed && kind === 'publish') {
        a.ready_descriptor = copy(response.result);
        if (e.attempts[e.choice] === a) e.ready_descriptor = copy(response.result);
        if (associate && e.attempts[e.choice] === a && this.selected(e) && this.pinned(e)) {
          e.association = { cycle_id: this.editor.clientCycleId, media_id: a.media_id };
          if (!this.editor.draft.attachments.some(r => r.id === a.media_id)) this.editor.edit({ attachments: [...this.editor.draft.attachments, { id: a.media_id }] });
        }
      }
      e.version++;
    });
    return committed;
  }
  async run(e, { retry = false } = {}) {
    if (this.running.has(e.selection_id)) return this.running.get(e.selection_id);
    const task = this.perform(e, retry);
    this.running.set(e.selection_id, task); this.notify();
    try { await task; } finally { this.running.delete(e.selection_id); this.aborters.delete(e.selection_id); this.notify(); }
  }
  async perform(e, retry) {
    const a = e.attempts[e.choice];
    if (!this.selected(e) || !this.pinned(e) || !a) throw Error('This image cannot upload in the current writing cycle.');
    if (['begin-unknown', 'publish-unknown'].includes(a.phase) && (!retry || !a.retry_allowed)) throw Error('Check the original image confirmation before retrying.');
    try {
      const blob = await this.prepare(e, a);
      if (!this.selected(e) || !this.pinned(e)) return;
      if (a.begin_response?.status !== 'committed' || a.begin_response.recorded !== true) {
        await this.transition(() => { a.phase = 'begin-unknown'; a.retry_allowed = false; });
        if (!this.selected(e) || !this.pinned(e)) return;
        if (!await this.accept(e, a, 'begin', await this.api.command(a.begin_envelope))) return;
      }
      if (!this.selected(e) || !this.pinned(e) || a.publish_response?.recorded === true) return;
      // One actual publication fetch per document. An aborted fetch owns its
      // slot until it settles; a second selection waits without changing IDs.
      const previous = this.registry.uploadTail ?? Promise.resolve();
      const transport = previous.catch(() => {}).then(async () => {
        if (!this.selected(e) || !this.pinned(e)) return;
        const checked = await this.bytes(e);
        await this.transition(() => { a.phase = 'publish-unknown'; a.retry_allowed = false; });
        if (!this.selected(e) || !this.pinned(e)) return;
        const abort = new AbortController(); this.aborters.set(e.selection_id, abort);
        await this.accept(e, a, 'publish', await this.api.upload(a.publish_envelope, checked.blob, { signal: abort.signal }));
      });
      this.registry.uploadTail = transport; await transport;
      if (this.selected(e) && e.association) this.registry.schedule(this.editor);
    } catch (error) {
      if (!this.valid()) throw error;
      await this.transition(() => {
        a.last_attempt_error = { message: error.message, code: error.details?.error?.code ?? 'CONFIRMATION_UNKNOWN' };
        if (!['begin-unknown', 'publish-unknown'].includes(a.phase)) e.local_error = error.message;
      });
    }
  }
  async check(id) {
    const e = this.find(id), a = e.attempts[e.choice];
    this.registry.cancelSave(this.editor);
    if (e.origin === 'retained-ref') return this.checkRetained(e);
    if (!a || this.running.has(id)) throw Error('Wait for this image attempt to finish.');
    await this.transition(() => { a.retry_allowed = false; });
    const publish = await this.api.view('operation', { operation_id: a.publish_operation_id });
    if (this.unknown(publish, a.publish_operation_id)) {
      const begin = await this.api.view('operation', { operation_id: a.begin_operation_id });
      if (this.unknown(begin, a.begin_operation_id)) await this.transition(() => { a.retry_allowed = true; });
      else { await this.accept(e, a, 'begin', begin, { associate: false }); await this.transition(() => { a.retry_allowed = true; }); }
    } else await this.accept(e, a, 'publish', publish);
  }
  async retry(id) {
    const e = this.find(id);
    if (e.bytes_state === 'memory-only' && !await this.capture(e)) return;
    if (e.choice === null) return;
    return this.run(e, { retry: true });
  }
  async asDownload(id) {
    const e = this.find(id), old = e.attempts[e.choice];
    if (!this.selected(e) || !this.pinned(e) || this.running.has(id) || e.local_error) throw Error('This retained file cannot be attached as a download.');
    if (old?.role === 'explicit-download') return this.retry(id);
    if (old && (old.phase !== 'refused' || old.publish_response?.error?.code !== 'MEDIA_INVALID')) throw Error('Check the original image result before choosing a download.');
    await this.bytes(e);
    await this.transition(() => { e.attempts.push(newAttempt('explicit-download', 'application/octet-stream')); e.choice = e.attempts.length - 1; });
    return this.run(e);
  }
  async remove(id) {
    const e = this.find(id);
    if (e.owner.kind !== 'cycle' || e.owner.id !== this.editor.clientCycleId) throw Error('An image frozen in an earlier reply cannot be removed.');
    await this.transition(() => {
      e.selected = false; e.version++;
      const media = e.association?.media_id ?? e.retained_ref?.id;
      if (media && this.editor.draft.attachments.some(r => r.id === media)) this.editor.edit({ attachments: this.editor.draft.attachments.filter(r => r.id !== media) });
      e.association = null;
      if (!e.bytes_ref) { e.bytes_state = 'released'; this.memory.delete(id); }
    });
    this.aborters.get(id)?.abort();
    this.registry.schedule(this.editor);
  }
  async discard(id) {
    const e = this.find(id);
    if (this.selected(e) || this.running.has(id) || e.bytes_state === 'capturing') throw Error('Remove the current image and wait for its attempt before discarding retained bytes.');
    if (!e.bytes_ref) return;
    const bytesRef = e.bytes_ref;
    // The guarded storage transaction deletes bytes and changes the pointer
    // together. Memory is updated only after the strict commit.
    const snapshot = () => { const s = this.session.snapshot(), target = s.uploadState.entries.find(x => x.selection_id === id);
      target.bytes_ref = null; target.bytes_state = 'released'; target.discarded = true; target.version++; s.uploadState.revision++; return s; };
    await this.journal.releaseBytes(this.editor.key, snapshot, [bytesRef], () => this.valid() && e.bytes_ref === bytesRef && !this.running.has(id) && !this.selected(e), () => {
      e.bytes_ref = null; e.bytes_state = 'released'; e.discarded = true; e.version++; this.editor.uploadState.revision++; this.notify();
    });
  }
  importRetained() {
    if (this.editor.uploadOpaque || !this.editor.draft.attachments.length) return;
    if (!this.editor.uploadState) this.editor.passiveImages = true;
    const state = this.initialize();
    for (const ref of this.editor.draft.attachments) {
      if (this.current().some(e => e.association?.media_id === ref.id || e.retained_ref?.id === ref.id)) continue;
      state.entries.push({ selection_id: crypto.randomUUID(), origin: 'retained-ref', retained_ref: copy(ref),
        binding: { instance_id: this.editor.context.instanceId, actor_id: this.editor.context.actor, editor_key: this.editor.key,
          source_ref: copy(this.editor.sourceRef), topic_id: this.editor.context.topicId, captured_cycle_id: this.editor.clientCycleId, authority: pair(this.session.authority) },
        owner: { kind: 'cycle', id: this.editor.clientCycleId }, selected: true, version: 1, bytes_ref: null, bytes_state: 'released', attempts: [],
        ready_descriptor: null, association: null });
    }
  }
  async validateRetained() {
    if (this.editor.recoveryDiscovery || this.editor.uploadOpaque) return;
    this.importRetained();
    for (const e of this.current().filter(e => e.origin === 'retained-ref' && !e.ready_descriptor && !e.local_error)) await this.checkRetained(e, { passive: true });
  }
  async checkRetained(e, { passive = false } = {}) {
    const version = e.version;
    let result;
    try { result = await this.api.view('media', { media_id: e.retained_ref.id }); }
    catch (error) { if (!passive) throw error; }
    const valid = result?.instance_id === this.editor.context.instanceId && result.media_id === e.retained_ref.id &&
      result.state === 'ready' && result.media_revision === 2 && typeof result.name === 'string' && typeof result.content_type === 'string' &&
      Number.isInteger(result.size_bytes) && result.size_bytes > 0 && /^[a-f0-9]{64}$/.test(result.sha256 ?? '') && typeof result.inline === 'boolean' &&
      Object.entries(e.retained_ref).every(([k, v]) => k === 'id' || result[k] === v);
    const accept = () => {
      if (!this.selected(e) || e.version !== version) return;
      if (!valid || !this.pinned(e)) { e.local_error = 'Retained attachment is unavailable — check or remove it'; return; }
      e.local_error = null; e.ready_descriptor = copy(result);
      if (this.selected(e)) e.association = { cycle_id: this.editor.clientCycleId, media_id: result.media_id };
    };
    // A read of an already-saved ref is derived state, not a new recovery copy.
    if (passive) { accept(); this.notify(); }
    else await this.transition(accept);
  }
  async validateCorrection(item) {
    for (const ref of item.snapshot.attachments) {
      const result = await this.api.view('media', { media_id: ref.id });
      const retained = this.editor.uploadState?.entries.find(e => e.ready_descriptor?.media_id === ref.id)?.ready_descriptor;
      const expected = retained ?? ref;
      if (result?.instance_id !== this.editor.context.instanceId || result.media_id !== ref.id || result.state !== 'ready' || result.media_revision !== 2 ||
          Object.entries(expected).some(([k, v]) => k !== 'id' && result[k] !== v)) throw Error('An image in the earlier reply is unavailable or changed. It has not been omitted.');
    }
    const current = await this.api.bootstrap();
    if (current.instance_id !== this.editor.context.instanceId || !samePin(current.authority, this.session.authority)) throw Error('The runtime changed while checking the earlier images.');
  }
}

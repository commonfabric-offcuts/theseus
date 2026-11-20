import { NotebookStart, notebookWriting } from './quick-create.mjs';
import { paintAddress } from './people.mjs';
import { recipientChoices, writingState, pasteImageError, namedPastedImage, imageChoices, paintSaveTime } from './writing-helpers.mjs';
import { paintImageRows } from './image-rows.mjs';
import { WritingInput } from './writing-input.mjs';
import { paintChoice, chosen, unnamed, sending } from './whisper-choice.mjs';
import { addressedTo } from './at-names.mjs';
import { ImagePick, clipboardHoldsImage, clipboardImage, readInTurn } from './image-pick.mjs';
import { showLine } from './lines.mjs';
import { ComposeBar } from './compose-bar.mjs';
import { holdPlace } from './sheet-holder.mjs';
import { currentImages, imageBarrier } from './upload-state.mjs';
import { composerWidth } from './composer-width.mjs';
import { ReaderLayout } from './layout.mjs';


// The inline DOM adapter shares the existing registry/session/upload owners.
// It has no source body, note editor, storage or retry scheduler of its own.
export class InlineComposer {
  constructor(callbacks) {
    this.callbacks = callbacks; this.root = document.querySelector('#inline-composer');
    this.field = this.$('writing-body');
    this.kind = this.defaultKind(); this.notebookJobs = new WeakMap();
    this.kinds = ['message', 'note-card'];
    for (const [index, kind] of this.kinds.entries()) {
      const button = this.$('kind-' + kind);
      button?.addEventListener('click', () => this.chooseKind(kind));
      button?.addEventListener('keydown', event => {
        if (event.isComposing || event.metaKey || event.ctrlKey || event.altKey) return;
        const next = event.key === 'Home' ? 0 : event.key === 'End' ? this.kinds.length - 1
          : ['ArrowRight', 'ArrowDown'].includes(event.key) ? (index + 1) % this.kinds.length
          : ['ArrowLeft', 'ArrowUp'].includes(event.key) ? (index + this.kinds.length - 1) % this.kinds.length : null;
        if (next === null) return;
        event.preventDefault(); event.stopPropagation();
        if (this.chooseKind(this.kinds[next])) this.$('kind-' + this.kinds[next]).focus();
      });
    }
    // The Reader's composer, with no message above it (docs/reader.md).
    // Naming someone on a phone: the who panel's named chips and + Someone,
    // then the naming sheet (docs/reader.md).
    this.naming = { opener: this.$('recipient-open'), sheet: this.$('recipient-sheet'), field: this.$('recipient-input'),
      back: [this.$('recipient-back'), this.$('recipient-done')], named: this.$('recipient-named'), add: name => this.addName(name),
      names: () => this.editor?.draft.addressees ?? [] };
    this.bar = new ComposeBar({ root: this.root, field: this.field, notice: this.$('notice'), panels: { who: this.$('who-panel'), plus: this.$('plus-panel') },
      openers: { who: this.$('who-chip'), plus: this.$('plus-button') }, taller: this.$('taller-field'), naming: this.naming });
    // New message at the top of a topic page pops this composer up on its
    // own, ready to type; Escape, ✕ or a press outside puts it back in its
    // place in the feed, just above More (reply-stacks.mjs), its writing kept. Shown only where the composer is
    // (aim.css), so it is never one more row of buttons.
    this.sheet = document.querySelector('#new-message-sheet');
    this.useLayout(callbacks.instanceId);
    this.syncWidthPlacement = composerWidth(this.sheet, () => this.layout);
    document.querySelector('#new-message')?.addEventListener('click', () => this.pop());
    // Put back by the person (✕, Escape, a press outside), the composer folds to its line while still up, so it
    // comes back into its place at the height its holder kept there, and no card behind it moves (item 589).
    const putBack = () => { if (this.sheet?.classList.contains('notebook-mode')) return; this.bar.fold(); this.sheet?.close(); };
    document.querySelector('#new-message-close')?.addEventListener('click', putBack);
    this.sheet?.addEventListener('cancel', event => { if (!event.defaultPrevented) this.bar.fold(); });
    // Every close of the sheet folds the composer back to its line. The focus
    // goes to New message only when the sheet closing is the one New message
    // popped up: a Notebook page in the sheet (notebook-sheet.mjs) gave the
    // focus back to what opened it as it closed, and this event, a frame
    // later, leaves it there, or wherever a key pressed since has moved it.
    this.sheet?.addEventListener('close', () => {
      const popped = this.popped; this.popped = false; this.opening = Symbol(); this.kind = this.defaultKind();
      this.paintStatus();
      this.bar.fold();
      if (popped) document.querySelector('#new-message')?.focus({ preventScroll: true });
    });
    // Only a press that starts and ends on the sheet's backdrop puts it back.
    let outside = false;
    this.sheet?.addEventListener('pointerdown', event => { outside = event.target === this.sheet; });
    this.sheet?.addEventListener('click', event => { if (outside && event.target === this.sheet) putBack(); outside = false; });
    this.input=new WritingInput({field:this.field,editor:()=>this.editor,admits:()=>this.admits(),readOnly:()=>this.state().readOnly,
      changed:editor=>{this.callbacks.edit(editor,this.presentation);this.paintStatus();this.paintChoice();this.images?.update();}});
    // #img lists the topic's recent images under the writing (image-pick.mjs).
    this.images = new ImagePick({ field: this.field, host: this.field,
      admits: () => this.admits() && !this.state().readOnly && Boolean(this.callbacks.images),
      load: () => this.callbacks.images(this.editor), thumb: item => this.callbacks.imageBytes(item),
      choose: item => this.pickImage(item) });
    this.field.addEventListener('focus', () => this.checkClipboard());
    window.addEventListener('focus', () => { if (!this.root.hidden) this.checkClipboard(); });
    this.field.addEventListener('keydown', event => {
      if(this.images.key(event)||this.input.writingKey(event))return;
      if (event.key === 'Enter' && event.metaKey && !event.isComposing && event.keyCode !== 229) {
        event.preventDefault(); if (!event.repeat) this.send();
      }
    });
    this.field.addEventListener('paste', event => this.paste(event));
    this.field.addEventListener('dragover', event => {
      if (this.admits() && !this.state().addDisabled && [...(event.dataTransfer?.items ?? [])].some(item => item.type.startsWith('image/'))) event.preventDefault();
    });
    this.field.addEventListener('drop', event => {
      const files = [...(event.dataTransfer?.files ?? [])].filter(file => file.type.startsWith('image/'));
      if (!files.length) return;
      event.preventDefault(); return this.addImages(files);
    });
    this.$('send').onclick = () => this.send();
    // Add image, or Paste image when the clipboard is known to hold one;
    // Choose file beside it then still opens the picker.
    this.$('add-image').onclick = async () => {
      if (!this.admits() || this.state().addDisabled) return;
      if (this.pasteReady) {
        const file = await clipboardImage();
        if (file) { await this.addImages([namedPastedImage(file)]); return; }
        this.pasteReady = false; this.paintStatus();
      }
      this.chooseFile();
    };
    this.$('choose-image').onclick = () => this.chooseFile();
    this.chooseFile = () => {
      const p = this.presentation, editor = this.editor;
      if (!this.admits(p, editor) || this.state().addDisabled) return;
      try {
        const uploads = this.callbacks.uploads(editor), token = uploads.reserve(p);
        this.imagePicker = { uploads, token, p, editor }; this.$('image-file').value = '';
        this.paintStatus(); this.$('image-file').click();
      } catch (error) { this.notice(error, p, editor); }
    };
    this.$('cancel-image').onclick = () => {
      if (!this.admits()) return;
      this.cancelPicker(); this.$('add-image').focus();
    };
    this.$('image-file').addEventListener('cancel', () => this.cancelPicker());
    this.$('image-file').onchange = async event => {
      const picker = this.imagePicker, file = event.target.files?.[0]; this.imagePicker = null;
      if (!picker) return;
      try { await picker.uploads.choose(picker.token, file); }
      catch (error) { this.notice(error, picker.p, picker.editor); }
      finally { this.paintStatus(); }
    };
    this.$('review-versions').onclick = () => { if (this.admits()) this.callbacks.review(this.editor, this.presentation, this.$('review-versions')); };
    this.$('retry').onclick = async () => {
      this.$('retry').disabled = true;
      try { await this.callbacks.retry(); } finally { this.$('retry').disabled = false; }
    };
  }
  $(name) { return this.root.querySelector(`#inline-${name}`); }
  get editor() { return this.presentation?.editors.reply; }
  admits(p = this.presentation, editor = this.editor) { return Boolean(editor && this.callbacks.admits(p, editor)); }
  pageJobs(editor = this.editor) { return this.notebookJobs.get(editor) ?? []; }
  pageBusy() { return this.pageJobs().some(job => job.busy); }
  state() {
    const note = this.kind !== 'message', busy = this.pageBusy();
    const state = writingState(this.editor, { active: this.admits(), note, status: this.callbacks.status, sign: this.callbacks.sign });
    const barrier = note && imageBarrier(this.editor);
    if (barrier) { state.sendDisabled = true; state.message = barrier; state.sign = ''; }
    state.sendDisabled ||= Boolean(busy || (note && (this.callbacks.notebook?.mayWrite !== true || state.readOnly || !this.editor.context.topicId || this.editor.submissions.some(s => s.status === 'preparing' && !s.detached))));
    state.readOnly ||= Boolean(busy); state.addDisabled ||= Boolean(busy);
    return state;
  }
  defaultKind() { return this.callbacks.notebook?.mayWrite === true ? 'note-card' : 'message'; }
  chooseKind(kind) {
    if (!this.callbacks.notebook || (kind !== 'message' && this.callbacks.notebook.mayWrite !== true) || !this.admits() || this.pageBusy() || !this.kinds.includes(kind)) return false;
    this.kind = kind; this.bar.close(); this.images?.close();
    this.paintStatus(); return true;
  }
  paintKind() {
    const note = this.kind !== 'message';
    this.$('kind').hidden = this.callbacks.notebook?.mayWrite !== true;
    for (const kind of this.kinds) {
      const button = this.$('kind-' + kind);
      button.setAttribute('aria-checked', String(kind === this.kind)); button.tabIndex = kind === this.kind ? 0 : -1;
      button.disabled = this.pageBusy() || (kind !== 'message' && this.callbacks.notebook?.mayWrite !== true);
    }
    this.$('who-chip').hidden = note;
    for (const name of ['plus-button', 'attachments']) this.$(name).hidden = false;
    if (note) for (const name of ['who-panel', 'writing-to']) this.$(name).hidden = true;
    this.$('writing-title').textContent = note ? 'New Notebook page' : 'New message';
    this.field.setAttribute('aria-label', note ? 'Note' : 'New message');
    if (note) this.$('send').querySelector('.send-word').textContent = 'Start page';
  }
  offerPages(error = null, p = this.presentation, editor = this.editor) {
    const jobs = this.pageJobs(editor).filter(job => job.id || job.starter.pending);
    if (!error && !jobs.length) return;
    const parts = [error ?? 'Earlier Notebook pages are kept below. Your writing is kept.'];
    for (const job of jobs) {
      const button = document.createElement('button'); button.type = 'button';
      button.textContent = job.id ? 'Open started page' : `Retry earlier page: ${job.title}`;
      button.setAttribute('aria-label', job.id ? `Open started page: ${job.title}` : button.textContent);
      button.disabled = job.busy;
      button.onclick = () => {
        if (this.editor !== editor || !this.admits() || this.pageBusy() || !this.pageJobs().includes(job)) return;
        if (job.id) return this.finishPage(job).catch(error => this.notice(error));
        if (this.callbacks.notebook?.mayWrite === true) return this.createPage(job, false);
      };
      parts.push(button);
    }
    this.notice(parts, p, editor);
  }
  async finishPage(job) {
    const p = this.presentation, editor = this.editor, opening = this.opening;
    if (job.editor !== editor || !this.admits(p, editor) || !job.id || job.busy) return;
    job.busy = true; this.paintStatus();
    try {
      if (this.pageUnchanged(job)) {
        let version;
        const clear = () => { editor.edit({ body: '', attachments: [], caret: { start: 0, end: 0, direction: 'none' } }); version = editor.localVersion; };
        if (job.images.length) {
          if (!await this.callbacks.uploads(editor).consume(job.images.map(image => image.selection), () => this.pageUnchanged(job), clear)) { this.offerPages(); return; }
        } else clear();
        await this.callbacks.edit(editor, p);
        if (!this.admits(p, editor)) return;
        if (this.opening !== opening || editor.localVersion !== version || editor.clientCycleId !== job.cycle) { this.offerPages(); return; }
        this.drawEditor();
      }
      this.bar.fold(); if (this.sheet.open) this.sheet.close();
      await this.callbacks.notebook.open(job.id, { mode: job.kind === 'note-card' ? 'cards' : 'text', beside: true, opener: document.querySelector('#new-message') });
      this.notebookJobs.set(editor, this.pageJobs(editor).filter(other => other !== job));
    } finally { job.busy = false; if (this.admits(p, editor)) this.paintStatus(); }
  }
  pageUnchanged(job) {
    const editor = job.editor;
    return editor.localVersion === job.version && editor.clientCycleId === job.cycle && editor.draft.body === job.body &&
      (editor.uploadState?.revision ?? 0) === job.uploadVersion && !editor.imageReservation && !editor.imageStorageError &&
      JSON.stringify(editor.draft.attachments) === JSON.stringify(job.attachments);
  }
  async startPage() {
    const editor = this.editor, kind = this.kind, body = editor.draft.body;
    const jobs = this.pageJobs(editor);
    if (this.pageBusy()) return;
    // Each changed writing gets its own creation owner. Earlier uncertain requests
    // keep their exact envelope; confirmed pages remain separate opening actions.
    const attachments = structuredClone(editor.draft.attachments), images = currentImages(editor).map(image => ({
      selection: image.selection_id, id: image.association.media_id, name: image.ready_descriptor.name }));
    let job = jobs.find(job => job.body === body && job.kind === kind && job.cycle === editor.clientCycleId && JSON.stringify(job.attachments) === JSON.stringify(attachments));
    if (job?.id) return this.finishPage(job);
    if (!job) {
      const writing = notebookWriting(body, kind, images);
      job = { editor, body, kind, attachments, images, title: writing.title, words: writing.body,
        starter: new NotebookStart({ ...this.callbacks.notebook, scope: { kind: 'topic', id: editor.context.topicId }, again: ' Choose Start page to try once more.' }) };
      this.notebookJobs.set(editor, [...jobs, job]);
    }
    Object.assign(job, { version: editor.localVersion, cycle: editor.clientCycleId, uploadVersion: editor.uploadState?.revision ?? 0 });
    return this.createPage(job, true);
  }
  async createPage(job, automatic) {
    const p = this.presentation, editor = this.editor, opening = this.opening;
    job.busy = true; this.paintStatus();
    try {
      job.id = await job.starter.create(job.title, job.words, job.attachments); job.busy = false;
      if (!this.admits(p, editor)) return;
      if (automatic && this.opening === opening && this.pageUnchanged(job)) await this.finishPage(job);
      else this.offerPages();
    } catch (error) {
      job.busy = false;
      if (!job.id && !job.starter.pending) this.notebookJobs.set(editor, this.pageJobs(editor).filter(other => other !== job));
      this.offerPages(error, p, editor);
    } finally { job.busy = false; if (this.admits(p, editor)) this.paintStatus(); }
  }
  caret() { return this.input.caret(); }
  useLayout(instanceId) {
    if (instanceId && this.layoutInstance !== instanceId) {
      this.layoutInstance = instanceId;
      this.layout = new ReaderLayout(instanceId);
    }
  }
  pop() {
    if (!this.sheet || this.sheet.open || this.root.hidden) return;
    // At rest it is among the dossiers (item 465): a holder keeps its place there, so the feed does not move behind it.
    holdPlace(this.sheet);
    this.sheet.showModal(); this.popped = true; this.opening = Symbol();
    this.chooseKind?.(this.defaultKind());
    this.syncWidthPlacement?.({ opening: true });
    // Start at one line and fit the writing at the sheet’s current width.
    this.bar.fit();
    this.field.focus();
    this.field.setSelectionRange(this.field.value.length, this.field.value.length);
  }
  show(p) {
    if (this.presentation !== p) { this.kind = this.defaultKind(); this.opening = Symbol(); }
    if (this.sheet?.open && this.presentation !== p) this.sheet.close();
    this.presentation = p; this.root.hidden = false;
    this.useLayout(p.editors.reply.context.instanceId);
    // A name typed in To stays with the new message of the topic it was typed in.
    this.bar.writes(p.topic.id);
    this.field.disabled = false; showLine(this.$('notice'), '');
    this.$('destination').textContent = `To ${p.topic.title}`;
    this.drawEditor(); this.paintRecipients(); this.paintStatus(); this.paintChoice();
    this.offerPages();
  }
  // The composer could not load: it says why until Retry composer loads it.
  fail(error) {
    this.root.hidden = false;
    this.field.disabled = true;
    for (const name of ['recipient-input', 'add-image', 'choose-image', 'send']) this.$(name).disabled = true;
    showLine(this.$('notice'), ['New message is unavailable.', error]);
    this.$('save-state').textContent = 'Writing is disabled until this composer can load.';
    this.$('retry').textContent = 'Retry composer'; this.$('retry').hidden = false;
  }
  drawEditor() {
    this.images?.close();
    this.field.value = this.editor.draft.body;
    const caret = this.editor.draft.caret; this.field.setSelectionRange(caret.start, caret.end);
  }
  // A failure goes to the notice as the error itself (lines.mjs).
  notice(what, p = this.presentation, editor = this.editor) {
    if (this.presentation !== p || this.editor !== editor || !this.admits(p, editor)) return;
    this.noticeVersion = (this.noticeVersion ?? 0) + 1;
    showLine(this.$('notice'), what);
  }
  cancelPicker() {
    const picker = this.imagePicker; this.imagePicker = null;
    picker?.uploads.cancel(picker.token); this.$('image-file').value = ''; this.paintStatus();
  }
  // The topic's people are names tapped once; the small field beside them names anyone else.
  paintRecipients() {
    const p = this.presentation, editor = this.editor;
    const off = name => this.removeName(name, p, editor);
    paintAddress(this.$('recipient-chips'), this.$('recipient-input'), { people: this.callbacks.addressable?.() ?? [],
      nameOf: this.callbacks.actorLabel,
      named: recipientChoices(editor.draft.addressees).map(({ name }) => name), reach: this.callbacks.reach, remove: off,
      toggle: (name, on) => on ? this.addName(name) : off(name), summary: { host: this.naming.named, opener: this.naming.opener } });
    this.callbacks.recipientsPainted?.(editor.draft.addressees);
    // Who is named may have changed: what Send said goes if no longer true.
    this.bar.settle();
  }
  get kindOf() { return name => this.callbacks.people?.().kindOf(name); }
  // Who the topic's messages can be sent to by name (app.mjs whisperPeople).
  members(editor = this.editor) { return this.callbacks.people?.().members?.(editor?.context?.topicId) ?? []; }
  // Who the message goes to: the members its leading @names name, else whom its
  // chips name (at-names.mjs, the rule Core records it by).
  names(editor = this.editor) { return editor ? addressedTo(editor.draft.body, this.members(editor), editor.draft.addressees) : []; }
  // Whisper, Tell or Ask (whisper-choice.mjs), and who will see it, above the writing.
  paintChoice(readOnly = this.state().readOnly) {
    const editor = this.editor;
    if (!editor) return;
    if (this.kind && this.kind !== 'message') { this.paintKind(); return; }
    paintChoice(this.$('intent-row'), { draft: editor.draft, names: this.names(editor), kindOf: this.kindOf,
      nameOf: this.callbacks.actorLabel,
      everyone: this.callbacks.people?.().everyone ?? [], send: this.$('send'), field: this.field, chip: this.$('who-chip'), lineHost: this.$('who-sentence'), readOnly,
      to: this.$('writing-to'), onChoose: choice => this.choose(choice) });
  }
  choose(choice) {
    const p = this.presentation, editor = this.editor;
    if (this.kind !== 'message' || !this.admits(p, editor) || this.state().readOnly) { this.paintChoice(); return; }
    editor.edit(chosen(choice)); this.callbacks.edit(editor, p); this.paintChoice();
  }
  // Names someone in the message (a name typed in the name field, compose-bar.mjs
  // takeName, or tapped once);
  // false when the writing cannot change now.
  addName(name) {
    const p = this.presentation, editor = this.editor;
    if (this.kind !== 'message' || !this.admits(p, editor) || this.state().readOnly) return false;
    if (!editor.draft.addressees.includes(name)) {
      // Named writing defaults to Ask; adding names holds no private choice (whisper-choice.mjs).
      editor.edit({ addressees: [...editor.draft.addressees, name] });
      this.callbacks.edit(editor, p); this.paintRecipients(); this.paintChoice();
    }
    return true;
  }
  removeName(name, p = this.presentation, editor = this.editor) {
    if (this.kind !== 'message' || !this.admits(p, editor) || this.state().readOnly) return;
    const rest = editor.draft.addressees.filter(value => value !== name);
    // A message to nobody neither asks, tells nor whispers.
    editor.edit({ addressees: rest, ...(rest.length ? {} : unnamed) });
    this.callbacks.edit(editor, p); this.paintRecipients(); this.paintChoice();
  }
  paintImages() {
    const p = this.presentation, editor = this.editor, uploads = this.callbacks.uploads(editor), host = this.$('attachments');
    const active = this.admits(p, editor) && !this.state().readOnly;
    paintImageRows(host, imageChoices(uploads, active), active, async (action, choice, control) => {
      try {
        if (!this.admits(p, editor) || this.state().readOnly) return;
        await uploads[action.method](choice.id);
        // Remove takes its own button away; focus lands in the writing only
        // if it was still there. Where the person has since put it, it stays.
        if (action.method === 'remove' && this.admits(p, editor) && [null, document.body, control].includes(document.activeElement)) this.field.focus();
      }
      catch (error) { this.notice(error, p, editor); }
      finally { if (control.isConnected) control.disabled = !this.admits(p, editor) || this.state().readOnly; this.paintStatus(); }
    }, id => uploads.preview(id));
  }
  paintStatus() {
    if (!this.editor) return;
    const state = this.state(), editor = this.editor, active = this.admits();
    this.root.inert = !active; this.field.readOnly = state.readOnly;
    this.$('save-state').textContent = this.presentation.availabilityUnconfirmed ? 'Topic access unconfirmed — writing kept on this device' : state.message;
    this.$('save-state').dataset.save = this.presentation.availabilityUnconfirmed ? '' : state.sign;
    if (this.callbacks.savedAt) paintSaveTime(this.$('save-state'), this.presentation.availabilityUnconfirmed || !state.sign ? null : this.callbacks.savedAt(editor));
    this.$('retry').textContent = 'Retry access';
    this.$('retry').hidden = Boolean(editor.authorityRecovery || this.presentation.availabilityChecking || !(this.presentation.availabilityUnconfirmed || editor.unavailable));
    this.$('send').disabled = state.sendDisabled;
    this.$('recipient-input').disabled = state.readOnly;
    this.paintChoice(state.readOnly);
    this.$('add-image').hidden = Boolean(editor.imageReservation); this.$('add-image').disabled = state.addDisabled;
    this.$('add-image').textContent = this.pasteReady ? 'Paste image' : 'Add image';
    this.$('choose-image').hidden = this.$('add-image').hidden || !this.pasteReady; this.$('choose-image').disabled = state.addDisabled;
    this.$('cancel-image').hidden = !editor.imageReservation;
    this.$('review-versions').hidden = !this.callbacks.needsReview(editor);
    // Status updates do not touch text or caret, even when uploads finish.
    this.paintImages(); this.callbacks.renderPending(this.$('pending'), editor, this.presentation);
    this.paintKind?.();
  }
  async paste(event) {
    const items = [...(event.clipboardData?.items ?? [])].filter(item => item.type.startsWith('image/'));
    if (!items.length) return;
    event.preventDefault();
    return this.addImages(items.map(item => item.getAsFile()));
  }
  // Whether the image button can say Paste image: asked when the writing or
  // the window takes focus, never by prompting (image-pick.mjs).
  async checkClipboard() {
    const ready = await clipboardHoldsImage();
    if (ready !== Boolean(this.pasteReady)) { this.pasteReady = ready; if (this.editor) this.paintStatus(); }
  }
  // An image picked from the #img list: the #img words, which the list has
  // selected, come out as one edit, and the image's verified bytes go in as a
  // pasted image does, a copy of its own in this message.
  async pickImage(item) {
    const p = this.presentation, editor = this.editor;
    if (!this.admits(p, editor) || this.state().readOnly) return;
    this.input.deleteSelection();
    let file;
    try {
      const blob = await readInTurn(() => this.callbacks.imageBytes(item), { first: true });
      file = new File([blob], item.attachment.name, { type: blob.type });
    } catch (error) { this.notice([`${item.attachment.name}:`, error], p, editor); return; }
    if (this.presentation === p && this.editor === editor) return this.addImages([file]);
  }
  // Images pasted, picked or read from the clipboard, each through the same
  // admission and byte owner as Add image.
  async addImages(files) {
    const p = this.presentation, editor = this.editor;
    try {
      const refusal = pasteImageError(editor, 'reply', !this.admits(p, editor) || this.state().readOnly);
      if (refusal) throw Error(refusal);
      if (files.some(file => !file)) throw Error('Could not read the pasted image. Try Add image to choose the file.');
      const uploads = this.callbacks.uploads(editor);
      const results = await Promise.allSettled(files.map(file => {
        try { return uploads.choose(uploads.reserve(p), namedPastedImage(file)); } catch (error) { return Promise.reject(error); }
      }));
      const errors = results.filter(result => result.status === 'rejected');
      if (errors.length) this.notice(errors.map(result => result.reason), p, editor);
    } catch (error) { this.notice(error, p, editor); }
    finally { this.paintStatus(); }
  }
  async send() {
    const p = this.presentation, editor = this.editor, opening = this.opening;
    if (!this.admits(p, editor) || this.state().sendDisabled) return;
    if (this.kind && this.kind !== 'message') return this.startPage();
    // A name typed in To and not named: Send waits, and says so (compose-bar.mjs).
    if (this.bar.holdSend()) return;
    // The writing goes as the choice shows: a whisper, or a tell or ask that says so, to
    // whom the line said; Core records a leading @name's members itself (addressing.py).
    editor.edit(sending(editor.draft, this.names(editor), this.kindOf));
    const draft = editor.draft;
    try {
      const sent = this.callbacks.send(editor, p);
      if (this.admits(p, editor) && editor.draft !== draft) { this.drawEditor(); this.paintRecipients(); this.paintStatus(); this.paintChoice(); this.field.focus(); }
      const version = editor.localVersion, cycle = editor.clientCycleId, noticeVersion = this.noticeVersion;
      const result = await sent;
      // Only confirmed publication closes this opening. An interrupted or refused
      // act keeps its recovery controls in front; a later opening or new writing
      // is never dismissed by an older answer.
      // Image selection/capture does not edit text. Only selections owned by
      // the successor count here; the sent submission owns its frozen images.
      if (result?.status === 'confirmed' && this.admits(p, editor) && this.popped &&
          this.opening === opening && editor.localVersion === version && editor.clientCycleId === cycle &&
          !currentImages(editor).length && !imageBarrier(editor) &&
          !this.imagePicker && !this.images?.open && !this.bar.panel && !this.naming.sheet.open &&
          this.noticeVersion === noticeVersion) {
        this.bar.fold(); this.sheet.close();
      }
    } catch (error) { this.notice(error, p, editor); }
  }
}

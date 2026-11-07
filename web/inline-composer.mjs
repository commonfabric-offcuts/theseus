import { paintAddress } from './people.mjs';
import { recipientChoices, writingState, pasteImageError, namedPastedImage, imageChoices } from './writing-helpers.mjs';
import { paintImageRows } from './image-rows.mjs';
import { WritingInput } from './writing-input.mjs';
import { paintChoice, chosen, naming, unnamed, sending } from './whisper-choice.mjs';

const node = (tag, text, className) => {
  const el = document.createElement(tag); if (text !== undefined) el.textContent = text;
  if (className) el.className = className; return el;
};

// The inline DOM adapter shares the existing registry/session/upload owners.
// It has no source body, note editor, storage or retry scheduler of its own.
export class InlineComposer {
  constructor(callbacks) {
    this.callbacks = callbacks; this.root = document.querySelector('#inline-composer');
    this.field = this.$('writing-body');
    this.input=new WritingInput({field:this.field,editor:()=>this.editor,admits:()=>this.admits(),readOnly:()=>this.state().readOnly,
      changed:editor=>{this.callbacks.edit(editor,this.presentation);this.paintStatus();this.paintChoice();}});
    this.field.addEventListener('keydown', event => {
      if(this.input.terminalKey(event))return;
      if (event.key === 'Enter' && event.metaKey && !event.isComposing && event.keyCode !== 229) {
        event.preventDefault(); if (!event.repeat) this.send();
      }
    });
    this.field.addEventListener('paste', event => this.paste(event));
    this.$('send').onclick = () => this.send();
    this.$('recipient-input').onkeydown = event => {
      if (event.key === 'Enter' && !event.isComposing) { event.preventDefault(); if (!event.repeat) this.addRecipient(); }
    };
    this.$('add-image').onclick = () => {
      const p = this.presentation, editor = this.editor;
      if (!this.admits(p, editor) || this.state().addDisabled) return;
      try {
        const uploads = this.callbacks.uploads(editor), token = uploads.reserve(p);
        this.imagePicker = { uploads, token, p, editor }; this.$('image-file').value = '';
        this.paintStatus(); this.$('image-file').click();
      } catch (error) { this.notice(error.message, p, editor); }
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
      catch (error) { this.notice(error.message, picker.p, picker.editor); }
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
  state() { return writingState(this.editor, { active: this.admits(), status: this.callbacks.status, sign: this.callbacks.sign }); }
  caret() { return this.input.caret(); }
  show(p) {
    this.presentation = p; this.root.hidden = false;
    this.field.disabled = false; this.$('notice').hidden = true;
    this.$('destination').textContent = `To ${p.topic.title}`;
    this.drawEditor(); this.paintRecipients(); this.paintStatus(); this.paintChoice();
  }
  fail(message) {
    this.root.hidden = false;
    this.field.disabled = true;
    for (const name of ['recipient-input', 'add-image', 'send']) this.$(name).disabled = true;
    this.$('notice').textContent = 'New message is unavailable. ' + message;
    this.$('notice').hidden = false;
    this.$('save-state').textContent = 'Writing is disabled until this composer can load.';
    this.$('retry').textContent = 'Retry composer'; this.$('retry').hidden = false;
  }
  drawEditor() {
    this.field.value = this.editor.draft.body;
    const caret = this.editor.draft.caret; this.field.setSelectionRange(caret.start, caret.end);
  }
  notice(text, p = this.presentation, editor = this.editor) {
    if (this.presentation !== p || this.editor !== editor || !this.admits(p, editor)) return;
    this.$('notice').textContent = text; this.$('notice').hidden = !text;
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
      named: recipientChoices(editor.draft.addressees).map(({ name }) => name), reach: this.callbacks.reach, remove: off,
      toggle: (name, on) => on ? this.addName(name) : off(name) });
    this.callbacks.recipientsPainted?.(editor.draft.addressees);
  }
  // In an outcome's conversation a message starts as a Tell, even to one agent (I3).
  get conversation() { return Boolean(this.callbacks.conversation?.()); }
  get kindOf() { return name => this.callbacks.people?.().kindOf(name); }
  // Whisper, Tell or Ask (whisper-choice.mjs), and who will see it, above the writing.
  paintChoice(readOnly = this.state().readOnly) {
    const editor = this.editor;
    if (!editor) return;
    paintChoice(this.$('intent-row'), { draft: editor.draft, names: editor.draft.addressees, kindOf: this.kindOf,
      everyone: this.callbacks.people?.().everyone ?? [], send: this.$('send'), field: this.field, readOnly,
      conversation: this.conversation, onChoose: choice => this.choose(choice) });
  }
  choose(choice) {
    const p = this.presentation, editor = this.editor;
    if (!this.admits(p, editor) || this.state().readOnly) { this.paintChoice(); return; }
    editor.edit(chosen(choice)); this.callbacks.edit(editor, p); this.paintChoice();
  }
  addRecipient() {
    const input = this.$('recipient-input'), name = input.value.trim().replace(/^@/, '');
    if (!name || !this.addName(name)) return;
    input.value = ''; input.focus();
  }
  // Names someone in the message (the field's Return, or a name tapped once);
  // false when the writing cannot change now.
  addName(name) {
    const p = this.presentation, editor = this.editor;
    if (!this.admits(p, editor) || this.state().readOnly) return false;
    if (!editor.draft.addressees.includes(name)) {
      editor.edit({ addressees: [...editor.draft.addressees, name], ...naming(editor.draft, editor.draft.addressees, this.kindOf, { conversation: this.conversation }) });
      this.callbacks.edit(editor, p); this.paintRecipients(); this.paintChoice();
    }
    return true;
  }
  removeName(name, p = this.presentation, editor = this.editor) {
    if (!this.admits(p, editor) || this.state().readOnly) return;
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
        // Remove takes its own button away; focus lands on Add image only if
        // it was still there. Where the person has since put it, it stays.
        if (action.method === 'remove' && this.admits(p, editor) && [null, document.body, control].includes(document.activeElement)) this.$('add-image').focus();
      }
      catch (error) { this.notice(error.message, p, editor); }
      finally { if (control.isConnected) control.disabled = !this.admits(p, editor) || this.state().readOnly; this.paintStatus(); }
    });
  }
  paintStatus() {
    if (!this.editor) return;
    const state = this.state(), editor = this.editor, active = this.admits();
    this.root.inert = !active; this.field.readOnly = state.readOnly;
    this.$('save-state').textContent = this.presentation.availabilityUnconfirmed ? 'Topic access unconfirmed — writing kept on this device' : state.message;
    this.$('save-state').dataset.save = this.presentation.availabilityUnconfirmed ? '' : state.sign;
    this.$('retry').textContent = 'Retry access';
    this.$('retry').hidden = Boolean(editor.authorityRecovery || this.presentation.availabilityChecking || !(this.presentation.availabilityUnconfirmed || editor.unavailable));
    this.$('send').disabled = state.sendDisabled;
    this.$('recipient-input').disabled = state.readOnly;
    this.paintChoice(state.readOnly);
    this.$('add-image').hidden = Boolean(editor.imageReservation); this.$('add-image').disabled = state.addDisabled;
    this.$('cancel-image').hidden = !editor.imageReservation;
    this.$('review-versions').hidden = !this.callbacks.needsReview(editor);
    // Status updates do not touch text or caret, even when uploads finish.
    this.paintImages(); this.callbacks.renderPending(this.$('pending'), editor, this.presentation);
  }
  async paste(event) {
    const items = [...(event.clipboardData?.items ?? [])].filter(item => item.type.startsWith('image/'));
    if (!items.length) return;
    event.preventDefault(); const p = this.presentation, editor = this.editor;
    try {
      const refusal = pasteImageError(editor, 'reply', !this.admits(p, editor) || this.state().readOnly);
      if (refusal) throw Error(refusal);
      const files = items.map(item => item.getAsFile());
      if (files.some(file => !file)) throw Error('Could not read the pasted image. Try Add image to choose the file.');
      const uploads = this.callbacks.uploads(editor);
      const results = await Promise.allSettled(files.map(file => {
        try { return uploads.choose(uploads.reserve(p), namedPastedImage(file)); } catch (error) { return Promise.reject(error); }
      }));
      const errors = results.filter(result => result.status === 'rejected');
      if (errors.length) this.notice([...new Set(errors.map(result => result.reason.message))].join(' '), p, editor);
    } catch (error) { this.notice(error.message, p, editor); }
    finally { this.paintStatus(); }
  }
  async send() {
    const p = this.presentation, editor = this.editor;
    if (!this.admits(p, editor) || this.state().sendDisabled) return;
    // The writing goes as the choice shows: a whisper, or a tell or ask that says so.
    editor.edit(sending(editor.draft, editor.draft.addressees, this.kindOf, { conversation: this.conversation }));
    const draft = editor.draft;
    try {
      const sent = this.callbacks.send(editor, p);
      if (this.admits(p, editor) && editor.draft !== draft) { this.drawEditor(); this.paintRecipients(); this.paintStatus(); this.paintChoice(); this.field.focus(); }
      await sent;
    } catch (error) { this.notice(error.message, p, editor); }
  }
}

import { recipientChoices, writingState, pasteImageError, namedPastedImage, imageChoices } from './writing-helpers.mjs';
import { WritingInput } from './writing-input.mjs';

const node = (tag, text, className) => {
  const el = document.createElement(tag); if (text !== undefined) el.textContent = text;
  if (className) el.className = className; return el;
};

// The inline DOM adapter shares the existing registry/session/upload owners.
// It has no source body, note editor, storage or retry scheduler of its own.
export class InlineComposer {
  constructor(callbacks, {root=document.querySelector('#inline-composer'), prefix='inline', destination=p=>`To ${p.topic.title}`, readOnly=()=>false} = {}) {
    Object.assign(this,{callbacks,root,prefix,destination,surfaceReadOnly:readOnly});
    this.field = this.$('writing-body');
    this.input=new WritingInput({field:this.field,editor:()=>this.editor,admits:()=>this.admits(),readOnly:()=>this.state().readOnly,
      changed:editor=>{this.callbacks.edit(editor,this.presentation);this.paintStatus();}});
    this.field.addEventListener('keydown', event => {
      if(this.input.terminalKey(event))return;
      if (event.key === 'Enter' && event.metaKey && !event.isComposing && event.keyCode !== 229) {
        event.preventDefault(); if (!event.repeat) this.send();
      }
    });
    this.field.addEventListener('paste', event => this.paste(event));
    this.$('send').onclick = () => this.send();
    this.$('add-recipient').onclick = () => this.addRecipient();
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
  $(name) { return this.root.querySelector(`#${this.prefix}-${name}`); }
  get editor() { return this.presentation?.editors.reply; }
  admits(p = this.presentation, editor = this.editor) { return Boolean(editor && this.callbacks.admits(p, editor)); }
  state() {
    const state = writingState(this.editor, { active: this.admits(), status: this.callbacks.status });
    const locked = this.surfaceReadOnly(this.presentation, this.editor);
    return {...state, readOnly:state.readOnly||locked, sendDisabled:state.sendDisabled||locked, addDisabled:state.addDisabled||locked};
  }
  caret() { return this.input.caret(); }
  show(p) {
    this.presentation = p; this.root.hidden = false;
    this.field.disabled = false; this.$('notice').hidden = true;
    this.$('destination').textContent = this.destination(p);
    this.drawEditor(); this.paintRecipients(); this.paintStatus();
  }
  fail(message) {
    this.root.hidden = false;
    this.field.disabled = true;
    for (const name of ['recipient-input', 'add-recipient', 'add-image', 'send']) this.$(name).disabled = true;
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
  paintRecipients() {
    const host = this.$('recipient-chips'), p = this.presentation, editor = this.editor;
    host.replaceChildren();
    for (const { name, removeLabel } of recipientChoices(editor.draft.addressees)) {
      const chip = node('span', name, 'chip'), remove = node('button', '×'); remove.type = 'button'; remove.setAttribute('aria-label', removeLabel);
      remove.onclick = () => {
        if (!this.admits(p, editor) || this.state().readOnly) return;
        editor.edit({ addressees: editor.draft.addressees.filter(value => value !== name) });
        this.callbacks.edit(editor, p); this.paintRecipients();
      };
      chip.append(remove); host.append(chip);
    }
  }
  addRecipient() {
    const p = this.presentation, editor = this.editor, input = this.$('recipient-input'), name = input.value.trim().replace(/^@/, '');
    if (!name || !this.admits(p, editor) || this.state().readOnly) return;
    if (!editor.draft.addressees.includes(name)) {
      editor.edit({ addressees: [...editor.draft.addressees, name] }); this.callbacks.edit(editor, p); this.paintRecipients();
    }
    input.value = ''; input.focus();
  }
  paintImages() {
    const p = this.presentation, editor = this.editor, uploads = this.callbacks.uploads(editor), host = this.$('attachments');
    const active = this.admits(p, editor) && !this.state().readOnly, choices = imageChoices(uploads, active), ids = new Set(choices.map(e => e.id));
    for (const row of [...host.children]) if (!ids.has(row.dataset.selection)) row.remove();
    for (const choice of choices) {
      let row = [...host.children].find(el => el.dataset.selection === choice.id);
      if (!row) { row = node('div', undefined, 'image-choice'); row.dataset.selection = choice.id; host.append(row); }
      if (row.dataset.view === choice.view) continue;
      row.dataset.view = choice.view; row.replaceChildren(node('span', choice.text));
      for (const action of choice.actions) {
        const control = node('button', action.label); control.type = 'button'; control.disabled = !active;
        control.onclick = async () => {
          if (!this.admits(p, editor) || this.state().readOnly) return;
          control.disabled = true;
          try { await uploads[action.method](choice.id); if (action.method === 'remove' && this.admits(p, editor)) this.$('add-image').focus(); }
          catch (error) { this.notice(error.message, p, editor); }
          finally { if (control.isConnected) control.disabled = !this.admits(p, editor) || this.state().readOnly; this.paintStatus(); }
        }; row.append(control);
      }
    }
  }
  paintStatus() {
    if (!this.editor) return;
    const state = this.state(), editor = this.editor, active = this.admits();
    this.root.inert = !active; this.field.readOnly = state.readOnly;
    this.$('save-state').textContent = this.presentation.availabilityUnconfirmed ? 'Topic access unconfirmed — writing kept on this device' : state.message;
    this.$('retry').textContent = 'Retry access';
    this.$('retry').hidden = Boolean(editor.authorityRecovery || this.presentation.availabilityChecking || !(this.presentation.availabilityUnconfirmed || editor.unavailable));
    this.$('send').disabled = state.sendDisabled;
    this.$('recipient-input').disabled = state.readOnly; this.$('add-recipient').disabled = state.readOnly;
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
    const draft = editor.draft;
    try {
      const sending = this.callbacks.send(editor, p);
      if (this.admits(p, editor) && editor.draft !== draft) { this.drawEditor(); this.paintRecipients(); this.paintStatus(); this.field.focus(); }
      await sending;
    } catch (error) { this.notice(error.message, p, editor); }
  }
}

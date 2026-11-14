// The Reader's edit mode (docs/message-edit.md): in place of the message's
// words, a field holding them, with Save (⌘Return) and Cancel under it. The
// reply beside it is left as it is. What the field says and which controls
// it offers follow the writing's state (message-edit-writing.mjs):
// - editing: the words, kept on this device as they are written;
// - saving: the field reads only, "Saving…";
// - conflict: "This message was edited elsewhere", the saved words, and
//   Save mine or Use saved;
// - uncertain: "Not known whether this was saved: Theseus did not confirm
//   it.", and Try again;
// - busy: "Not saved: Theseus was busy.", and Try again;
// - refused: what Core said, the words kept; Save is off when Core will not
//   take an edit of this message from this person now;
// - empty: Save is off while a message with no images is blank.
// Saved, Cancel, Use saved and words saved unchanged end it (done).
import { ENDED } from './message-edit-writing.mjs';

export const SAY = {
  saving: 'Saving…',
  conflict: 'This message was edited elsewhere',
  uncertain: 'Not known whether this was saved: Theseus did not confirm it.',
  busy: 'Not saved: Theseus was busy.',
  kept: 'Kept on this device',
};

export class MessageEdit {
  // host: the element the mode is drawn in. done(state): it ended, as saved,
  // unchanged, cancelled or discarded.
  constructor({ host, writing, done = () => {}, doc = globalThis.document }) {
    Object.assign(this, { host, writing, done, doc });
    const node = (tag, className, text) => { const el = doc.createElement(tag); if (className) el.className = className; if (text !== undefined) el.textContent = text; return el; };
    const control = (text, act, className = '') => { const el = node('button', className, text); el.type = 'button'; el.dataset.act = act; return el; };
    this.field = node('textarea', 'message-edit-field');
    this.field.id = 'message-edit-field';
    this.field.setAttribute('aria-label', 'Your message');
    this.field.value = writing.value;
    this.field.addEventListener('input', () => writing.edit(this.field.value));
    this.conflictBox = node('div', 'message-edit-conflict');
    this.conflictBox.setAttribute('role', 'group');
    this.conflictTitle = node('p', 'message-edit-conflict-title', SAY.conflict);
    this.savedWords = node('pre', 'message-edit-saved');
    this.mine = control('Save mine', 'mine'); this.useSaved = control('Use saved', 'saved');
    this.mine.title = 'Save your words over the newer revision'; this.useSaved.title = 'Let your words go and keep the saved message';
    this.mine.onclick = () => writing.resolve(true);
    this.useSaved.onclick = () => writing.resolve(false);
    this.conflictBox.append(this.conflictTitle, this.savedWords, this.mine, this.useSaved);
    this.status = node('span', 'message-edit-status');
    this.status.setAttribute('role', 'status');
    this.retry = control('Try again', 'retry');
    this.retry.onclick = () => writing.retry();
    this.cancel = control('Cancel', 'cancel');
    this.cancel.title = 'Cancel the edit: the message stays as it was';
    this.cancel.onclick = () => writing.cancel();
    this.save = control('', 'save', 'primary');
    const keys = node('span', 'message-edit-keys', '⌘↵'); keys.setAttribute('aria-hidden', 'true');
    this.save.append('Save', ' ', keys);
    this.save.setAttribute('aria-label', 'Save the edit');
    this.save.title = 'Save the edit (⌘ Return)';
    this.save.onclick = () => writing.save();
    const bar = node('div', 'message-edit-bar');
    bar.append(this.status, this.retry, this.cancel, this.save);
    host.replaceChildren(this.field, this.conflictBox, bar);
    this.ended = false;
    writing.changed = () => this.paint();
    this.paint();
  }
  paint() {
    const w = this.writing, state = w.state;
    if (ENDED.has(state)) { if (!this.ended) { this.ended = true; this.done(state); } return; }
    // The field follows the writing when the writing changed without it:
    // words kept from an earlier Edit, read after the cursor was put in the
    // field. While the person types the two are the same, so the caret stays.
    if (this.field.value !== w.value) {
      this.field.value = w.value;
      if (this.doc.activeElement === this.field) this.field.setSelectionRange?.(w.value.length, w.value.length);
    }
    this.field.readOnly = state === 'saving' || w.readOnly || Boolean(w.pending);
    this.conflictBox.hidden = state !== 'conflict';
    if (state === 'conflict') {
      this.savedWords.textContent = w.conflict?.body ?? 'The saved words could not be read. Use saved shows them.';
      this.mine.disabled = !Number.isSafeInteger(w.conflict?.revision); this.useSaved.disabled = this.mine.disabled;
    }
    const pendingAgain = state === 'uncertain' || state === 'busy' || state === 'failed';
    this.retry.hidden = !pendingAgain;
    this.status.textContent = state === 'saving' ? SAY.saving : state === 'uncertain' ? SAY.uncertain : state === 'busy' ? SAY.busy
      : state === 'failed' ? `Not saved: ${w.error}` : state === 'refused' ? w.error
      : w.journalError ? `This device could not keep the edit: ${w.journalError}` : state === 'editing' && w.dirty ? SAY.kept : '';
    this.status.dataset.state = state;
    // Save is the one way to send: off while sending, while the words are
    // blank, in a conflict (its own choices stand in), after a refusal that
    // will not change, and while a send waits for Try again.
    this.save.disabled = state === 'saving' || state === 'conflict' || pendingAgain || w.readOnly || w.empty;
    this.cancel.disabled = state === 'saving';
    this.host.dataset.state = state;
  }
}

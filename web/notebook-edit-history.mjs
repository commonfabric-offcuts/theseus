import { commandLetter, onMac } from './writing-input.mjs';

// Only the open Notebook card's field. Browser history groups replacements
// differently in WebKit and Chrome; these snapshots give both the same steps.
// Other writing surfaces keep their own history owners.
export const CARD_EDIT_HISTORY_LIMIT = 50;
const snapshot = field => ({ text: field.value,
  selection: [field.selectionStart, field.selectionEnd, field.selectionDirection ?? 'none'] });
const collapsed = state => state.selection[0] === state.selection[1];
const sameSelection = (a, b) => a.selection.every((value, i) => value === b.selection[i]);
const word = /^[\p{L}\p{N}\p{M}_]+$/u;

export class NotebookEditHistory {
  constructor({ field, readOnly = () => field.readOnly, mac = onMac(), limit = CARD_EDIT_HISTORY_LIMIT }) {
    Object.assign(this, { field, readOnly, mac, limit });
    this.entries = []; this.position = 0; this.current = snapshot(field);
    this.listeners = [];
    const listen = (type, fn) => { field.addEventListener(type, fn); this.listeners.push([type, fn]); };
    listen('beforeinput', event => {
      if (event.defaultPrevented || event.isComposing || this.composing) return;
      if (['historyUndo', 'historyRedo'].includes(event.inputType)) {
        event.preventDefault(); this.replay(event.inputType === 'historyUndo' ? -1 : 1); return;
      }
      // The final commit may follow compositionend before its microtask.
      if (this.composition) return;
      this.before = this.keyBefore ?? snapshot(field); this.inputType = event.inputType;
    });
    listen('input', event => {
      if (this.replaying || this.closed || this.readOnly()) return;
      if (this.composition) {
        this.before = null;
        if (!this.composing && !event.isComposing) this.flushComposition();
        return;
      }
      this.record(this.keyBefore ?? this.before ?? this.current, snapshot(field), event.inputType ?? this.inputType);
      this.before = null;
    });
    listen('compositionstart', () => {
      this.flushComposition(); this.breakTyping(); this.before = null;
      this.composing = true; this.composition = snapshot(field);
    });
    listen('compositionend', () => {
      this.composing = false;
      // Some engines deliver the final input after compositionend in this task.
      queueMicrotask(() => { if (!this.closed && !this.composing) this.flushComposition(); });
    });
    listen('blur', () => this.breakTyping());
    listen('cut', () => this.breakTyping());
    listen('paste', () => this.breakTyping());
  }
  breakTyping() { this.typing = false; }
  reset(state) {
    this.entries = []; this.position = 0; this.current = state; this.breakTyping();
  }
  record(before, after, inputType) {
    if (before.text !== this.current.text) this.reset(before);
    if (before.text === after.text) return;
    const at = before.selection[0], inserted = after.text.slice(at, after.selection[0]);
    const insertion = inputType === 'insertText' && collapsed(before) && collapsed(after) &&
      after.text === before.text.slice(0, at) + inserted + before.text.slice(at) && inserted.length > 0;
    const last = this.entries[this.position - 1];
    // A word and its trailing whitespace are one typing step. The next word,
    // punctuation, selection replacement and every deletion start a new step.
    const join = insertion && this.typing && last && this.position === this.entries.length &&
      sameSelection(before, last.after) && (word.test(inserted) || /^\s+$/u.test(inserted));
    this.entries.length = this.position;
    const entry = join ? last : { before, after };
    entry.after = after;
    if (!join) this.entries.push(entry);
    if (this.entries.length > this.limit) this.entries.splice(0, this.entries.length - this.limit);
    this.position = this.entries.length; this.current = after;
    this.typing = insertion && word.test(inserted);
  }
  flushComposition() {
    if (!this.composition || this.composing) return;
    const before = this.composition; this.composition = null;
    if (!this.readOnly()) this.record(before, snapshot(this.field), 'composition');
    this.breakTyping();
  }
  // Shared line keys set their replacement range before input, and their
  // final caret afterwards. Retain the person's original and final selection.
  aroundKey(event, act) {
    if (event.defaultPrevented || event.isComposing || event.keyCode === 229 || this.composing) return act();
    this.flushComposition();
    if (event.key.length !== 1 && !['Shift', 'Control', 'Meta', 'Alt'].includes(event.key)) this.breakTyping();
    this.keyBefore = snapshot(this.field);
    const position = this.position, last = this.entries[position - 1];
    try { return act(); }
    finally {
      this.keyBefore = null;
      if (!this.closed && (this.position !== position || this.entries[this.position - 1] !== last)) {
        const after = snapshot(this.field); this.entries[this.position - 1].after = after; this.current = after;
      }
    }
  }
  key(event) {
    if (event.defaultPrevented || event.isComposing || event.keyCode === 229 || this.composing) return false;
    const plain = { ...event, key: event.key, code: event.code, altKey: event.altKey,
      metaKey: event.metaKey, ctrlKey: event.ctrlKey, shiftKey: false };
    const undo = commandLetter(plain, 'z', this.mac);
    const redo = !this.mac && !event.shiftKey && commandLetter(event, 'y', false);
    if (!undo && !redo) return false;
    event.preventDefault(); this.replay(redo || event.shiftKey ? 1 : -1); return true;
  }
  replay(direction) {
    this.flushComposition(); this.before = null; this.breakTyping();
    if (this.closed || this.readOnly()) return;
    const field = this.field;
    if (field.value !== this.current.text) { this.reset(snapshot(field)); return; }
    const entry = this.entries[direction < 0 ? this.position - 1 : this.position];
    if (!entry) return;
    const next = direction < 0 ? entry.before : entry.after;
    this.position += direction; this.current = next; field.value = next.text;
    field.setSelectionRange(...next.selection);
    this.replaying = true;
    try {
      const Input = field.ownerDocument.defaultView.InputEvent;
      field.dispatchEvent(new Input('input', { bubbles: true, inputType: direction < 0 ? 'historyUndo' : 'historyRedo' }));
    } finally {
      this.replaying = false;
      // WritingInput's native line-move caret helper also sees this event;
      // the card history owns the exact snapshot selection being restored.
      field.setSelectionRange(...next.selection);
    }
  }
  close() {
    this.closed = true;
    for (const [type, fn] of this.listeners) this.field.removeEventListener(type, fn);
    this.listeners = []; this.entries = []; this.before = this.composition = this.keyBefore = null;
  }
}

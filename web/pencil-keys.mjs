// The topic's pencil owns these keys, including before a mode button's native
// Return activation. Sending still goes through InlineComposer's normal guards.
const textField = node => Boolean(node?.closest?.('input, textarea, select, [contenteditable]'));

// Only the main pencil field owns this short-lived input-method tail.
// Input capture corrects an exact residue before WritingInput sees its value.
export class PencilInput {
  constructor(composer, { now = () => performance.now() } = {}) {
    this.composer = composer; this.field = composer.field; this.doc = composer.root.ownerDocument; this.now = now;
    this.listeners = []; this.tail = null; this.resetting = false;
    const on = (node, name, fn) => { node.addEventListener(name, fn, true); this.listeners.push([node, name, fn]); };
    on(this.doc, 'pointerdown', () => this.clear());
    on(this.field, 'keydown', () => this.clear()); // Consumed chords stop at document capture.
    on(this.field, 'blur', () => { if (!this.resetting) this.clear(); });
    on(this.field, 'compositionstart', () => { if (this.eligible()) this.tail.composing = true; else this.clear(); });
    on(this.field, 'compositionend', () => {
      if (this.eligible()) { this.tail.composing = false; this.tail.until = this.now() + 500; } else this.clear();
    });
    on(this.field, 'input', event => this.input(event));
  }
  clear() { this.tail = null; }
  valid(t) {
    const c = this.composer;
    return Boolean(t && !c.disposed && !c.root.hidden && c.root.isConnected && !this.field.readOnly &&
      c.editor === t.editor && c.presentation === t.presentation && c.opening === t.opening);
  }
  current() { return this.valid(this.tail) && (this.resetting || this.doc.activeElement === this.field); }
  eligible() { return this.current() && (this.tail.composing || this.now() <= this.tail.until); }
  take() {
    const c = this.composer, f = this.field;
    if (this.doc.activeElement !== f || f.readOnly || c.disposed || c.root.hidden || !c.root.isConnected) return;
    this.tail = { editor: c.editor, presentation: c.presentation, opening: c.opening, value: f.value,
      start: f.selectionStart, end: f.selectionEnd, direction: f.selectionDirection, until: this.now() + 500, composing: false };
    const saved = this.tail;
    this.resetting = true;
    try {
      f.blur?.();
      if (!this.valid(saved) || ![f, this.doc.body, null].includes(this.doc.activeElement)) { this.clear(); return false; }
      const selection = f.value === saved.value ? saved : { start: f.selectionStart, end: f.selectionEnd, direction: f.selectionDirection };
      f.focus({ preventScroll: true }); f.setSelectionRange(selection.start, selection.end, selection.direction);
      if (!this.valid(saved)) { this.clear(); return false; }
      return true;
    } finally { this.resetting = false; }
  }
  input(event) {
    if (!this.eligible()) { this.clear(); return; }
    const glyph = event.data, f = this.field, t = this.tail;
    if (!['insertCompositionText', 'insertText'].includes(event.inputType) || !['\u02dc', '~', '\u0303', '\u00b5'].includes(glyph)) { this.clear(); return; }
    const caret = f.selectionStart;
    if (caret !== f.selectionEnd || f.value.slice(caret - 1, caret) !== glyph) { this.clear(); return; }
    const removed = f.value.slice(0, caret - 1) + f.value.slice(caret);
    const replaced = t.value.slice(0, t.start) + glyph + t.value.slice(t.end);
    if (removed !== t.value && !(f.value === replaced && caret === t.start + 1)) { this.clear(); return; }
    f.value = t.value; f.setSelectionRange(t.start, t.end, t.direction);
    if (!t.composing) this.clear();
  }
  dispose() {
    this.clear();
    for (const [node, name, fn] of this.listeners) node.removeEventListener(name, fn, true);
    this.listeners = [];
  }
}

export function pencilKey(event, composer) {
  const { root, sheet, field } = composer, doc = root.ownerDocument;
  const kind = event.altKey && !event.metaKey && !event.ctrlKey && !event.shiftKey
    ? { KeyN: 'note-card', KeyM: 'message' }[event.code] : null;
  const ownedText = node => root.contains(node) && textField(node);
  const consumed = Boolean(kind && (ownedText(event.target) || ownedText(doc.activeElement)));
  const ownsChord = Boolean(kind && (consumed || !(textField(event.target) || textField(doc.activeElement))));
  // Mac Option-N starts as Dead/229; Option-M can arrive while that input
  // method is composing. In pencil-owned text, prevent these physical chords
  // before composition is admitted, including a pop from outside writing.
  // Other text keeps its input-method owner.
  if (event.defaultPrevented || !ownsChord && (event.isComposing || event.keyCode === 229) || composer.cardReply ||
      composer.disposed || root.hidden || !root.isConnected) return false;
  let reset = false, lost = false;
  const cancelInput = () => { if (!reset) { const result = composer.pencilInput?.take(); reset = result === true; lost = result === false; } };
  const consume = () => { event.preventDefault(); event.stopPropagation(); if (kind) cancelInput(); };
  // A held mode change must not turn a recognized shortcut into typing in
  // this pencil's own fields (including its nested naming dialog).
  if (consumed) consume();
  if (lost) return true;
  if (!composer.admits() ||
      sheet?.classList.contains('notebook-mode') ||
      doc.querySelector('dialog[open]:not(#new-message-sheet):not(.notebook-docked)')) return consumed;
  if (kind) {
    if (composer.pageBusy() || kind === 'note-card' && composer.callbacks.notebook?.mayWrite !== true) return consumed;
    if (!consumed) consume();
    if (!event.repeat) {
      // pop starts at the writing's end for a pointer opening; these keys keep
      // the selection already being written, even across a modal opening.
      const start = field.selectionStart, end = field.selectionEnd, direction = field.selectionDirection, target = composer.noteTarget;
      if (!sheet?.open) { composer.pop(); composer.noteTarget = target; }
      if (composer.chooseKind(kind)) {
        field.focus({ preventScroll: true }); field.setSelectionRange(start, end, direction); cancelInput();
      }
    }
    return true;
  }
  const modePill = node => Boolean(node) && ['message', 'note-card'].some(kind => composer.$?.('kind-' + kind) === node);
  if (event.key !== 'Enter' || event.ctrlKey || event.altKey || event.shiftKey ||
      event.metaKey && !modePill(doc.activeElement) && !modePill(event.target) ||
      !(sheet?.open || root.contains(doc.activeElement)) || textField(doc.activeElement) || textField(event.target)) return false;
  consume();
  if (!event.repeat) composer.send();
  return true;
}

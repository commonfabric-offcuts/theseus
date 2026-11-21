// The topic's pencil owns these keys, including before a mode button's native
// Return activation. Sending still goes through InlineComposer's normal guards.
const textField = node => Boolean(node?.closest?.('input, textarea, select, [contenteditable]'));

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
  const consume = () => { event.preventDefault(); event.stopPropagation(); };
  // A held mode change must not turn a recognized shortcut into typing in
  // this pencil's own fields (including its nested naming dialog).
  if (consumed) consume();
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
        field.focus({ preventScroll: true }); field.setSelectionRange(start, end, direction);
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

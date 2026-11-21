// The topic's pencil owns these keys, including before a mode button's native
// Return activation. Sending still goes through InlineComposer's normal guards.
const textField = node => Boolean(node?.closest?.('input, textarea, select, [contenteditable]'));

export function pencilKey(event, composer) {
  const { root, sheet, field } = composer, doc = root.ownerDocument;
  if (event.defaultPrevented || event.isComposing || event.keyCode === 229 || composer.cardReply ||
      composer.disposed || root.hidden || !root.isConnected || !composer.admits() ||
      sheet?.classList.contains('notebook-mode') ||
      doc.querySelector('dialog[open]:not(#new-message-sheet):not(.notebook-docked)')) return false;
  const kind = event.altKey && !event.metaKey && !event.ctrlKey && !event.shiftKey
    ? { KeyN: 'note-card', KeyM: 'message' }[event.code] : null;
  if (kind) {
    if (composer.pageBusy() || kind === 'note-card' && composer.callbacks.notebook?.mayWrite !== true) return false;
    event.preventDefault(); event.stopPropagation();
    if (!event.repeat) {
      // pop starts at the writing's end for a pointer opening; these keys keep
      // the selection already being written, even across a modal opening.
      const start = field.selectionStart, end = field.selectionEnd, direction = field.selectionDirection, target = composer.noteTarget;
      if (kind === 'note-card' && !sheet?.open) { composer.pop(); composer.noteTarget = target; }
      if (composer.chooseKind(kind)) {
        field.focus({ preventScroll: true }); field.setSelectionRange(start, end, direction);
      }
    }
    return true;
  }
  if (event.key !== 'Enter' || event.metaKey || event.ctrlKey || event.altKey || event.shiftKey ||
      !(sheet?.open || root.contains(doc.activeElement)) || textField(doc.activeElement) || textField(event.target)) return false;
  event.preventDefault(); event.stopPropagation();
  if (!event.repeat) composer.send();
  return true;
}

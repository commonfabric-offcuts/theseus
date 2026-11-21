// The New message sheet (#new-message-sheet) at rest is in the feed, just above More (item 465), among the
// dossiers; up over the feed, as the New message composer (inline-composer.mjs), it leaves its place there.
// Notebook has its own dialog (notebook-sheet.mjs). A holder of its height keeps that place, so nothing behind the
// backdrop moves. Whether the holder is drawn is the browser's own word on the sheet, read by one rule (aim.css,
// `.sheet-holder:has(+dialog[open])`): drawn while the sheet just after it is open, and nothing the moment it
// closes, however it closes. Nothing here takes it away or puts it back on an event, so no listener, early or late,
// stands in for that rule: put down, the holder stays where it was, drawn as nothing.
const holders = new WeakMap();

// Before the sheet goes up: a holder of its height, with its margins (among the messages the sheet's top margin
// meets the card's above it and the two collapse into one, which a holder with no margin of its own would not do),
// just before the sheet. Nothing while it is up: it has left its place already, and the holder put there keeps it.
export function holdPlace(dialog) {
  if (dialog.open) return;
  const doc = dialog.ownerDocument, style = doc.defaultView.getComputedStyle(dialog);
  let holder = holders.get(dialog);
  if (!holder) {
    holder = doc.createElement('div'); holder.className = 'sheet-holder'; holder.setAttribute('aria-hidden', 'true');
    holders.set(dialog, holder);
  }
  Object.assign(holder.style, { height: `${dialog.getBoundingClientRect().height}px`, marginTop: style.marginTop, marginBottom: style.marginBottom });
  dialog.before(holder);
}

// The New message sheet (#new-message-sheet) at rest is in the feed, just above More (item 465), among the
// dossiers; up over the feed, as the New message composer (inline-composer.mjs) or a Notebook page
// (notebook-sheet.mjs), it leaves its place there. A holder of its height keeps that place, so nothing behind the
// backdrop moves. The holder is drawn only while the sheet just after it is open (aim.css), so it gives the place
// back the moment the sheet closes, however it closes, before any close event is heard.
const holders = new WeakMap();

// Before the sheet goes up: a holder of its height, with its margins (among the messages the sheet's top margin
// meets the card's above it and the two collapse into one, which a holder with no margin of its own would not do).
// Nothing while it is up: it has left its place already, and a holder put there earlier keeps it.
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

// The sheet is down: the holder goes, unless the sheet has gone up again since (a Notebook page opened over the
// popped composer closes the sheet and opens it again).
export function releasePlace(dialog) {
  if (!dialog.open) holders.get(dialog)?.remove();
}

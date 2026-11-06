// Topic settings: the dialog the gear beside a topic's title opens. It holds
// where the topic stands (the state word, the note, who set it and when) and,
// for those who may change it, the live form (topic-state.mjs
// TopicStatePanel), always open. It follows the live dialog conventions: the
// title takes the focus on opening, Escape and ✕ close it, the focus goes back
// to the gear, and Tab stays inside. A press on the backdrop also closes it;
// no other dialog closes that way.

// Whether a click on the dialog was a press on its backdrop: its target is
// the dialog element itself and its point lies outside the dialog's own box.
// A press on the dialog's own empty space is inside the box, so it never
// closes it; on a phone the dialog fills the screen, so nothing is outside.
export function onBackdrop(dialog, event) {
  if (event.target !== dialog) return false;
  const box = dialog.getBoundingClientRect();
  const { clientX: x, clientY: y } = event;
  return x < box.left || x > box.right || y < box.top || y > box.bottom;
}

// The dialog's Tab stops: its visible, enabled buttons, selects and inputs, in
// document order.
export function tabStops(dialog) {
  return [...dialog.querySelectorAll('button, select, input, textarea, a[href]')]
    .filter(node => !node.disabled && !node.hidden && node.getClientRects().length > 0);
}

export class TopicSettings {
  // dialog: <dialog id="topic-settings">; gear: the button that opens it;
  // heading: its h2, which takes the focus when it opens.
  constructor({ dialog, gear, heading, close }) {
    Object.assign(this, { dialog, gear, heading });
    gear.addEventListener('click', () => this.open());
    close.addEventListener('click', () => this.close());
    dialog.addEventListener('cancel', event => { event.preventDefault(); this.close(); });
    dialog.addEventListener('click', event => { if (onBackdrop(dialog, event)) this.close(); });
    dialog.addEventListener('keydown', event => this.keep(event));
  }

  open() {
    if (!this.dialog.open) this.dialog.showModal();
    this.heading.focus();
  }

  close() {
    if (this.dialog.open) this.dialog.close();
    if (this.gear.isConnected && !this.gear.hidden) this.gear.focus();
  }

  // Tab from the last stop goes to the first; Shift+Tab from the first stop
  // or from the title goes to the last.
  keep(event) {
    if (event.key !== 'Tab' || event.altKey || event.ctrlKey || event.metaKey) return;
    const stops = tabStops(this.dialog);
    if (!stops.length) { event.preventDefault(); return; }
    const first = stops[0], last = stops[stops.length - 1], at = document.activeElement;
    const outside = !stops.includes(at) && at !== this.heading;
    if (event.shiftKey && (at === first || at === this.heading || outside)) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && (at === last || outside)) { event.preventDefault(); first.focus(); }
  }
}

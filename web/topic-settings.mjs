// Topic settings: the dialog the gear beside a topic's title opens. It holds
// where the topic stands, set in place by those who may change it: chips that
// save on a tap and lines that save on Return (topic-state.mjs
// TopicStatePanel). It follows the live dialog conventions: the
// title takes the focus on opening, Escape and ✕ close it, the focus goes back
// to the gear, and Tab stays inside. A click outside it, on its backdrop,
// closes it as every pop-up does (dismiss.mjs); on a phone the dialog fills
// the screen, so nothing is outside.
import { closeOnOutsideClick } from './dismiss.mjs';

// The dialog's Tab stops: its visible, enabled buttons, selects and inputs, in
// document order.
export function tabStops(dialog) {
  return [...dialog.querySelectorAll('button, select, input, textarea, a[href]')]
    .filter(node => !node.disabled && !node.hidden && node.getClientRects().length > 0);
}

export class TopicSettings {
  // dialog: <dialog id="topic-settings">; gear: the button that opens it;
  // heading: its h2, which takes the focus when it opens.
  // opened: called each time it opens, so a line in it can read again.
  constructor({ dialog, gear, heading, close, win = window, opened = () => {} }) {
    Object.assign(this, { dialog, gear, heading, opened });
    gear.addEventListener('click', () => this.open());
    close.addEventListener('click', () => this.close());
    dialog.addEventListener('cancel', event => { event.preventDefault(); this.close(); });
    closeOnOutsideClick(dialog, () => this.close(), win);
    dialog.addEventListener('keydown', event => this.keep(event));
  }

  open() {
    if (!this.dialog.open) this.dialog.showModal();
    this.heading.focus();
    this.opened();
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

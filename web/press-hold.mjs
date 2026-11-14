// A press held down on the page, and the repaints that wait for it to end.
//
// A pointer pressed on a control picks its click's target where it lets go.
// A live repaint that lands while the press is held (a message arriving, a
// stack drawn again, a reaction line growing) can move what lies under the
// pointer, so the click lands on something else and the press is lost. Such a
// repaint waits here until the press ends; the page shows it the moment the
// pointer lets go, before the click is heard, whose target the release has
// already picked.
//
// A press is the primary button's or a finger's. It ends on its pointerup or
// pointercancel, and also where neither may come: a context menu opened by it,
// or the window losing the focus.
export class PressHold {
  constructor(doc = document) {
    this.down = false;
    // The waiting repaints by name, so a run of the same one during a press shows once.
    this.waiting = new Map();
    // Those waiting for the press and its click to be over (over()).
    this.overs = [];
    // It listens on the window, ahead of the document: a press the page is
    // kept from hearing (one begun on a reply still sliding in, stack-motion.mjs)
    // still holds the repaints, as any held press does. The page makes this
    // before StackMotion, so it is heard first.
    const win = doc.defaultView;
    win.addEventListener('pointerdown', event => { if (event.isPrimary && event.button === 0) this.down = true; }, true);
    const end = () => this.end();
    for (const name of ['pointerup', 'pointercancel', 'contextmenu']) win.addEventListener(name, end, true);
    win.addEventListener('blur', end);
  }
  // Runs paint now, or once the press held down ends.
  after(name, paint) {
    if (this.down) this.waiting.set(name, paint); else paint();
  }
  // Settles once no press is held and the events its release fires have been
  // heard: the click a press ends in is sent in the same task as its
  // pointerup, so it is heard before a message posted at the pointerup. A
  // redraw that replaces the very element pressed (a cut-off card's words read
  // whole, card-scroll.mjs) waits for this: the browser sends no click for a
  // press whose element went from under it before the release, so the press
  // would be lost, where a repaint that keeps its nodes (after) need not wait.
  over() {
    if (!this.down) return Promise.resolve();
    return new Promise(resolve => this.overs.push(resolve));
  }
  end() {
    this.down = false;
    const waiting = [...this.waiting.values()], overs = this.overs;
    this.waiting.clear(); this.overs = [];
    for (const paint of waiting) paint();
    if (!overs.length) return;
    const channel = new MessageChannel();
    channel.port1.onmessage = () => { channel.port1.close(); for (const resolve of overs) resolve(); };
    channel.port2.postMessage(null);
  }
}

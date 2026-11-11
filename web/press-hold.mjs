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
    doc.addEventListener('pointerdown', event => { if (event.isPrimary && event.button === 0) this.down = true; }, true);
    const end = () => this.end();
    for (const name of ['pointerup', 'pointercancel', 'contextmenu']) doc.addEventListener(name, end, true);
    doc.defaultView.addEventListener('blur', end);
  }
  // Runs paint now, or once the press held down ends.
  after(name, paint) {
    if (this.down) this.waiting.set(name, paint); else paint();
  }
  end() {
    this.down = false;
    const waiting = [...this.waiting.values()];
    this.waiting.clear();
    for (const paint of waiting) paint();
  }
}

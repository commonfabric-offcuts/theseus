// Scroll admission only. The page retains the cursor, read and placement owners.
export class OlderFeed {
  constructor({ feed, ready, load, failed, win = window, doc = document }) {
    Object.assign(this, { feed, ready, load, failed, win, doc });
    this.y = win.scrollY; this.intent = false; this.pending = false; this.disposed = false;
    this.listeners = [];
    const on = (name, fn) => { win.addEventListener(name, fn, { passive: true }); this.listeners.push([name, fn]); };
    on('pointerdown', () => { this.intent = false; });
    on('wheel', event => {
      if (event.deltaY >= 0) { this.intent = false; return; }
      this.up(event.target);
    });
    on('touchstart', event => { this.touching = true; this.touchY = event.touches.length === 1 ? event.touches[0].clientY : null; this.touchAsked = false; });
    on('touchend', () => { this.touching = false; });
    on('touchcancel', () => { this.touching = false; this.intent = false; });
    on('touchmove', event => {
      const y = event.touches.length === 1 ? event.touches[0].clientY : null;
      if (y !== null && this.touchY !== null && y > this.touchY && !this.touchAsked) this.touchAsked = this.up(event.target);
      if (y !== null && this.touchY !== null && y < this.touchY) this.intent = false;
      this.touchY = y;
    });
    on('keydown', event => {
      if (!event.defaultPrevented && !event.altKey && !event.metaKey && !event.ctrlKey && !event.shiftKey &&
          ['Home', 'PageUp', 'ArrowUp'].includes(event.key) && !event.target?.closest?.('button,a,[role=button],[role=menuitem]')) this.up(event.target);
      else this.intent = false;
    });
    on('scroll', () => {
      const y = win.scrollY, up = y < this.y;
      if (y > this.y) this.intent = false;
      this.y = y;
      if (up && this.intent && !this.pending && this.atTop()) this.request();
    });
  }
  atTop() {
    const box = this.feed.getBoundingClientRect();
    return this.feed.isConnected && !this.feed.hidden && box.height > 0 && box.top >= -1 && box.top < this.win.innerHeight;
  }
  pageOwns(target) {
    const region = this.feed.closest?.('main');
    if (region && target !== this.doc.body && target !== this.doc.documentElement && !region.contains(target)) return false;
    if (target?.closest?.('input,textarea,select,[contenteditable]')) return false;
    for (let node = target; node && node !== this.doc.body && node !== this.doc.documentElement; node = node.parentElement) {
      if (node.scrollHeight > node.clientHeight && /^(auto|scroll)$/.test(this.win.getComputedStyle(node).overflowY)) return false;
    }
    return true;
  }
  up(target) {
    if (this.disposed || this.pending || !this.pageOwns(target) || !this.ready()) return false;
    this.intent = true;
    return this.atTop() ? this.request() : false;
  }
  request() {
    this.intent = false;
    if (this.disposed || this.pending || !this.ready()) return false;
    if (this.touching) this.touchAsked = true;
    this.pending = true;
    Promise.resolve().then(() => { if (!this.disposed && this.ready()) return this.load(); })
      .catch(error => { if (!this.disposed) this.failed(error); })
      .finally(() => { this.pending = false; this.intent = false; this.y = this.win.scrollY; });
    return true;
  }
  dispose() {
    this.disposed = true; this.intent = false;
    for (const [name, fn] of this.listeners) this.win.removeEventListener(name, fn);
    this.listeners = [];
  }
}

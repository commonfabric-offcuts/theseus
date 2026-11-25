// The outline's visual fold, never a second topic list. TopicRail retains
// every link, its marks, order and navigation; the keyboard tree retains reach.
export const TOPICS_AT_REST = 7;

export class RailTopicFold {
  constructor({ area, host, footer, doc = area.ownerDocument }) {
    Object.assign(this, { area, host, footer, doc, win: doc?.defaultView });
    this.pending = null; this.frame = null; this.disposed = false; this.dirty = true;
    // Detached HTML documents have no browsing context. Leave their list
    // available; there is no viewport, pointer or animation frame to fold for.
    if (!this.win) return;
    this.down = event => {
      this.pending = null;
      if (event.pointerType !== 'touch' || !this.win.matchMedia('(max-width: 760px)').matches ||
          !area.hasAttribute('data-topic-fold') || area.hasAttribute('data-topic-revealed') ||
          area.hasAttribute('data-topic-current') || area.contains(doc.activeElement)) return;
      const link = event.target.closest('a[data-topic-id]');
      if (link?.dataset.railFold === 'peek') this.pending = link;
    };
    this.click = event => {
      const link = this.pending; this.pending = null;
      if (!link || event.detail === 0 || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey ||
          !link.contains(event.target)) return;
      event.preventDefault(); event.stopPropagation();
      link.focus({ preventScroll: true });
    };
    // Only movement near the measured fade reveals more. Once revealed,
    // leaving or scrolling cannot close it; the next page action does.
    this.revealMove = event => {
      if (event.pointerType === 'touch' || !this.win.matchMedia?.('(hover: hover)').matches ||
          !area.hasAttribute('data-topic-fold') || !this.revealZone || !Number.isFinite(event.clientY)) return;
      const y = event.clientY - host.getBoundingClientRect().top;
      if (y >= this.revealZone.start && y <= this.revealZone.end) area.setAttribute('data-topic-revealed', '');
    };
    this.closeReveal = () => area.removeAttribute('data-topic-revealed');
    area.addEventListener('pointermove', this.revealMove, { passive: true });
    // Window capture also precedes application handlers that stop document
    // capture, and includes both rails when their own handlers stop bubbling.
    // Never cancel the click/key whose action dismisses the pointer reveal.
    this.actionRoot = this.win.addEventListener ? this.win : doc;
    this.actionRoot.addEventListener?.('click', this.closeReveal, true);
    this.actionRoot.addEventListener?.('keydown', this.closeReveal, true);
    // A sideways trackpad swipe outside the list archives or folds a dossier with no click or key press, so it is a
    // page action too, as the archive shelf's menu treats it. Vertical scrolling, and anything inside the list, is not.
    this.swipe = event => {
      if (area.contains(event.target) || !(Math.abs(event.deltaX) > Math.abs(event.deltaY))) return;
      this.closeReveal();
    };
    this.actionRoot.addEventListener?.('wheel', this.swipe, true);
    area.addEventListener('pointerdown', this.down, true);
    area.addEventListener('click', this.click, true);
    this.invalidate = () => { if (!this.disposed) { this.dirty = true; this.soon(); } };
    this.changed = records => !records || records.some(record => record.type !== 'attributes' ||
      record.oldValue !== record.target.getAttribute(record.attributeName));
    // Paint notifications alone do not imply new geometry. Observe actual
    // words/rows/disclosure and CSS visibility owners; own fold writes are not
    // observed. Read queued records before a synchronous painted callback too.
    if (this.win.MutationObserver) {
      this.mutations = new this.win.MutationObserver(records => { if (this.changed(records)) this.invalidate(); });
      this.mutations.observe(area, { childList: true, subtree: true, attributes: true,
        characterData: true, attributeOldValue: true,
        attributeFilter: ['hidden', 'inert', 'open', 'aria-current', 'class', 'src'] });
      for (let parent = area.parentElement; parent; parent = parent.parentElement) {
        this.mutations.observe(parent, {attributes: true, attributeOldValue: true,
          attributeFilter: ['hidden', 'inert', 'open', 'class', 'data-only', 'style']});
      }
    }
    if (this.win.ResizeObserver) {
      this.sizes = new this.win.ResizeObserver(this.invalidate);
      this.sizes.observe(host); this.sizes.observe(footer);
    }
    this.win.addEventListener?.('resize', this.invalidate);
    area.addEventListener('load', this.invalidate, true);
    doc.fonts?.addEventListener?.('loadingdone', this.invalidate);
    this.soon();
  }
  soon() {
    const records = this.mutations?.takeRecords?.();
    if (records?.length && this.changed(records)) this.dirty = true;
    if (!this.dirty) return;
    if (this.disposed || this.frame !== null || !this.win?.requestAnimationFrame) return;
    this.frame = this.win.requestAnimationFrame(() => { this.frame = null; this.measure(); });
  }
  measure() {
    if (this.disposed || !this.win || !this.host.getBoundingClientRect || !this.area.style) return;
    this.dirty = false;
    this.revealZone = null;
    const current = this.area.querySelector('a[aria-current=page]');
    const group = current?.closest('details.topic-group');
    // A selected Done/Archived row must not remain behind its disclosure.
    if (group && !group.open) group.open = true;
    const all = [...this.host.children].filter(node => node.matches('a[data-topic-id]'));
    const boxes = new Map();
    const rows = all.filter(node => {
      if (!node.getClientRects().length) return false;
      const box = node.getBoundingClientRect(); boxes.set(node, box); return box.height > 0;
    });
    const keep = Boolean(current && (group || rows.indexOf(current) >= TOPICS_AT_REST));
    const peek = rows[TOPICS_AT_REST], origin = this.host.getBoundingClientRect();
    // Finish the current reads before any measured fold styles/markers change.
    const box = boxes.get(peek), full = this.host.scrollHeight, foot = this.footer.scrollHeight;
    const zoneStart = boxes.get(rows[TOPICS_AT_REST - 1])?.top - origin.top;
    for (const row of all) {
      const index = rows.indexOf(row), mark = index < TOPICS_AT_REST ? null : index === TOPICS_AT_REST ? 'peek' : 'past';
      if (mark === null) { if (row.dataset.railFold !== undefined) delete row.dataset.railFold; }
      else if (row.dataset.railFold !== mark) row.dataset.railFold = mark;
    }
    this.area.toggleAttribute('data-topic-current', keep);
    if (!peek || !Number.isFinite(origin.top)) { this.area.removeAttribute('data-topic-fold'); return; }
    const start = box.top - origin.top, end = start + box.height * .85;
    // A detached/hidden list cannot supply geometry. Keep the fail-open view.
    if (![zoneStart, start, end, full, foot].every(Number.isFinite) || start < 0 || end <= start || full < end) {
      this.area.removeAttribute('data-topic-fold'); return;
    }
    for (const [name, value] of Object.entries({ start, end, full, foot })) {
      const key = '--topic-fold-' + name, text = value + 'px';
      if (this.area.style.getPropertyValue(key) !== text) this.area.style.setProperty(key, text);
    }
    this.revealZone = { start: zoneStart, end };
    this.area.setAttribute('data-topic-fold', '');
  }
  dispose() {
    this.disposed = true;
    this.mutations?.disconnect(); this.sizes?.disconnect();
    this.win?.removeEventListener?.('resize', this.invalidate);
    this.area.removeEventListener('load', this.invalidate, true);
    this.doc.fonts?.removeEventListener?.('loadingdone', this.invalidate);
    if (this.frame !== null) this.win.cancelAnimationFrame(this.frame);
    this.frame = null;
    if (this.revealMove) this.area.removeEventListener('pointermove', this.revealMove);
    if (this.closeReveal) {
      this.actionRoot.removeEventListener?.('click', this.closeReveal, true);
      this.actionRoot.removeEventListener?.('keydown', this.closeReveal, true);
      this.actionRoot.removeEventListener?.('wheel', this.swipe, true);
      this.closeReveal();
    }
    if (this.down) this.area.removeEventListener('pointerdown', this.down, true);
    if (this.click) this.area.removeEventListener('click', this.click, true);
  }
}

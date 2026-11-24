// The outline's visual fold, never a second topic list. TopicRail retains
// every link, its marks, order and navigation; the keyboard tree retains reach.
export const TOPICS_AT_REST = 7;

export class RailTopicFold {
  constructor({ area, host, footer, doc = area.ownerDocument }) {
    Object.assign(this, { area, host, footer, doc, win: doc?.defaultView });
    this.pending = null; this.frame = null; this.disposed = false;
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
    area.addEventListener('pointerdown', this.down, true);
    area.addEventListener('click', this.click, true);
    // CSS filters, refreshed words, reordered rows and newly drawn stars all
    // change the same measured list. Style writes below are not observed.
    if (this.win.MutationObserver) {
      this.mutations = new this.win.MutationObserver(() => this.soon());
      this.mutations.observe(area, { childList: true, subtree: true, attributes: true,
        attributeFilter: ['hidden', 'open', 'aria-current', 'class'] });
    }
    if (this.win.ResizeObserver) {
      this.sizes = new this.win.ResizeObserver(() => this.soon());
      this.sizes.observe(host); this.sizes.observe(footer);
    }
    this.soon();
  }
  soon() {
    if (this.disposed || this.frame !== null || !this.win?.requestAnimationFrame) return;
    this.frame = this.win.requestAnimationFrame(() => { this.frame = null; this.measure(); });
  }
  measure() {
    if (this.disposed || !this.win || !this.host.getBoundingClientRect || !this.area.style) return;
    this.revealZone = null;
    const all = [...this.host.children].filter(node => node.matches('a[data-topic-id]'));
    const rows = all.filter(node => node.getClientRects().length && node.getBoundingClientRect().height > 0);
    for (const row of all) delete row.dataset.railFold;
    rows.forEach((row, index) => { if (index >= TOPICS_AT_REST) row.dataset.railFold = index === TOPICS_AT_REST ? 'peek' : 'past'; });
    const current = this.area.querySelector('a[aria-current=page]');
    const group = current?.closest('details.topic-group');
    // A selected Done/Archived row must not remain behind its disclosure.
    if (group && !group.open) group.open = true;
    const keep = Boolean(current && (group || rows.indexOf(current) >= TOPICS_AT_REST));
    this.area.toggleAttribute('data-topic-current', keep);
    const peek = rows[TOPICS_AT_REST], origin = this.host.getBoundingClientRect();
    if (!peek || !Number.isFinite(origin.top)) { this.area.removeAttribute('data-topic-fold'); return; }
    const box = peek.getBoundingClientRect(), start = box.top - origin.top, end = start + box.height * .85;
    const full = this.host.scrollHeight, foot = this.footer.scrollHeight;
    const zoneStart = rows[TOPICS_AT_REST - 1].getBoundingClientRect().top - origin.top;
    // A detached/hidden list cannot supply geometry. Keep the fail-open view.
    if (![zoneStart, start, end, full, foot].every(Number.isFinite) || start < 0 || end <= start || full < end) {
      this.area.removeAttribute('data-topic-fold'); return;
    }
    for (const [name, value] of Object.entries({ start, end, full, foot })) this.area.style.setProperty('--topic-fold-' + name, value + 'px');
    this.revealZone = { start: zoneStart, end };
    this.area.setAttribute('data-topic-fold', '');
  }
  dispose() {
    this.disposed = true;
    this.mutations?.disconnect(); this.sizes?.disconnect();
    if (this.frame !== null) this.win.cancelAnimationFrame(this.frame);
    this.frame = null;
    if (this.revealMove) this.area.removeEventListener('pointermove', this.revealMove);
    if (this.closeReveal) {
      this.actionRoot.removeEventListener?.('click', this.closeReveal, true);
      this.actionRoot.removeEventListener?.('keydown', this.closeReveal, true);
      this.closeReveal();
    }
    if (this.down) this.area.removeEventListener('pointerdown', this.down, true);
    if (this.click) this.area.removeEventListener('click', this.click, true);
  }
}

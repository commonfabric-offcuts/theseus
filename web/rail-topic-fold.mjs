// The outline's visual fold, never a second topic list. TopicRail retains
// every link, its marks, order and navigation; the keyboard tree retains reach.
export const TOPICS_AT_REST = 7;
const REST_MS = 250, REST_DISTANCE = 6;
const MODIFIERS = new Set(['Alt', 'Control', 'Meta', 'Shift']);
const addListener = (target, type, fn, options) => target?.addEventListener?.(type, fn, options);

export class RailTopicFold {
  constructor({ area, host, footer, doc = area.ownerDocument, listen = addListener }) {
    Object.assign(this, { area, host, footer, doc, win: doc?.defaultView });
    this.pending = null; this.frame = null; this.disposed = false; this.dirty = true;
    // Detached HTML documents have no browsing context. Leave their list
    // available; there is no viewport, pointer or animation frame to fold for.
    if (!this.win) return;
    const open = () => area.hasAttribute('data-topic-revealed') || area.hasAttribute('data-topic-keys');
    const folded = () => area.hasAttribute('data-topic-fold') && !open();
    const atPeek = event => {
      const link = event.target.closest?.('a[data-topic-id]');
      return link && area.contains(link) && (link.dataset.railFold === 'peek' ||
        (area.hasAttribute('data-topic-current') && link.getAttribute('aria-current') === 'page'));
    };
    const reveal = () => { this.cancelRest(); area.setAttribute('data-topic-revealed', ''); };
    this.down = event => {
      this.pending = null;
      if (event.button !== 0 || !folded() || !atPeek(event)) return;
      this.openingPress = true;
      if (event.pointerType === 'touch') this.pending = event.target.closest('a[data-topic-id]');
      reveal();
    };
    this.click = event => {
      const link = this.pending; this.pending = null;
      if (!link || event.detail === 0 || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey ||
          !link.contains(event.target)) return;
      event.preventDefault(); event.stopPropagation();
      link.focus({ preventScroll: true });
    };
    this.revealMove = event => {
      const zone = this.revealZone;
      const y = zone && event.clientY - host.getBoundingClientRect().top;
      if (!folded() || event.pointerType === 'touch' || !this.win.matchMedia?.('(hover: hover)').matches ||
          !zone || !atPeek(event) || !(y >= zone.start && y <= zone.end) || !Number.isFinite(event.clientX)) {
        this.cancelRest(); return;
      }
      if (this.rest && Math.hypot(event.clientX - this.rest.x, event.clientY - this.rest.y) < REST_DISTANCE) return;
      this.cancelRest();
      this.rest = { x: event.clientX, y: event.clientY };
      this.rest.timer = this.win.setTimeout(reveal, REST_MS);
    };
    this.cancelRest = () => {
      if (this.rest) this.win.clearTimeout(this.rest.timer);
      this.rest = null;
    };
    this.closeReveal = () => {
      this.cancelRest();
      area.removeAttribute('data-topic-revealed');
      area.removeAttribute('data-topic-keys');
    };
    this.press = event => {
      this.keyboard = false; this.openingPress = false;
      this.cancelRest();
      if (!area.contains(event.target)) area.removeAttribute('data-topic-keys');
    };
    this.dismissClick = event => {
      if (!this.openingPress || !area.contains(event.target)) this.closeReveal();
      this.openingPress = false;
    };
    this.key = event => {
      if (MODIFIERS.has(event.key)) {
        if (!area.contains(event.target)) this.closeReveal();
        return;
      }
      this.keyboard = true;
      if (area.contains(event.target)) area.setAttribute('data-topic-keys', '');
      else this.closeReveal();
    };
    this.focus = () => { if (this.keyboard) area.setAttribute('data-topic-keys', ''); };
    this.blur = event => { if (!area.contains(event.relatedTarget)) area.removeAttribute('data-topic-keys'); };
    this.swipe = event => {
      if (!area.contains(event.target) && Math.abs(event.deltaX) > Math.abs(event.deltaY)) this.closeReveal();
    };
    this.localEvents = [
      ['pointermove', this.revealMove, { passive: true }], ['pointerleave', this.cancelRest], ['pointercancel', this.cancelRest],
      ['pointerdown', this.down, true], ['click', this.click, true], ['focusin', this.focus], ['focusout', this.blur],
    ];
    for (const args of this.localEvents) area.addEventListener(...args);
    // These capture listeners belong to the persistent shell, including when
    // a page's capture handlers stop delivery or its navigation scope ends.
    this.actionRoot = this.win.addEventListener ? this.win : doc;
    this.actions = [
      ['pointerdown', this.press, true], ['click', this.dismissClick, true],
      ['keydown', this.key, true], ['wheel', this.swipe, true], ['scroll', this.cancelRest, true],
    ];
    for (const args of this.actions) listen(this.actionRoot, ...args);
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
    listen(this.win, 'resize', this.invalidate);
    area.addEventListener('load', this.invalidate, true);
    if (doc.fonts) listen(doc.fonts, 'loadingdone', this.invalidate);
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
    const previousZone = this.revealZone;
    this.revealZone = null;
    // Measure each row in its normal position, even when the selected row is
    // currently painted over the faded slot.
    this.area.removeAttribute('data-topic-current');
    const current = this.area.querySelector('a[aria-current=page]');
    const group = current?.closest('details.topic-group');
    // A selected Done/Archived row must not remain behind its disclosure.
    if (group && !group.open) group.open = true;
    const all = [...this.host.children].filter(node => node.matches('a[data-topic-id]'));
    const boxes = new Map();
    let count = 0;
    for (const row of all) {
      if (!row.getClientRects().length) continue;
      const box = row.getBoundingClientRect();
      if (box.height > 0) boxes.set(row, { box, index: count++ });
    }
    const keep = Boolean(current && (group || boxes.get(current)?.index > TOPICS_AT_REST));
    const origin = this.host.getBoundingClientRect();
    const peek = [...boxes.values()][TOPICS_AT_REST]?.box;
    const full = this.host.scrollHeight, foot = this.footer.scrollHeight;
    const currentTop = peek?.top - this.area.getBoundingClientRect().top;
    for (const row of all) {
      const index = boxes.get(row)?.index ?? -1;
      const mark = index < TOPICS_AT_REST ? null : index === TOPICS_AT_REST ? 'peek' : 'past';
      if (mark === null) { if (row.dataset.railFold !== undefined) delete row.dataset.railFold; }
      else if (row.dataset.railFold !== mark) row.dataset.railFold = mark;
    }
    if (!peek || !Number.isFinite(origin.top)) {
      this.cancelRest(); this.area.removeAttribute('data-topic-fold'); return;
    }
    const start = peek.top - origin.top, end = start + peek.height * .85;
    // A detached/hidden list cannot supply geometry. Keep the fail-open view.
    if (![start, end, full, foot, currentTop].every(Number.isFinite) || start < 0 || end <= start || full < end) {
      this.cancelRest(); this.area.removeAttribute('data-topic-fold'); return;
    }
    for (const [name, value] of Object.entries({ start, end, full, foot, 'current-top': currentTop, 'peek-height': end - start })) {
      const key = '--topic-fold-' + name, text = value + 'px';
      if (this.area.style.getPropertyValue(key) !== text) this.area.style.setProperty(key, text);
    }
    if (previousZone && (previousZone.start !== start || previousZone.end !== end)) this.cancelRest();
    this.revealZone = { start, end };
    this.area.toggleAttribute('data-topic-current', keep);
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
    for (const args of this.localEvents ?? []) this.area.removeEventListener(...args);
    for (const args of this.actions ?? []) this.actionRoot.removeEventListener?.(...args);
    this.closeReveal?.();
  }
}

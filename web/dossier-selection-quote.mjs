// Phone selection offers the Reader's own Quote pill on a dossier message.
// It captures only the selected card; opening, writing and quoting stay with
// replyMessage / Reader.quoteFrom (docs/dossier-selection-quote.md).
import { cardIn } from './fold.mjs';
import { drawnText, drawnRevision, sourcePosition } from './message-format.mjs';

const element = node => node?.nodeType === 1 ? node : node?.parentElement;
const CONTROLS = 'button,input,textarea,select,[contenteditable],[role=button],.struck-words';
const sameRange = (a, b) => a && b && a.startContainer === b.startContainer && a.startOffset === b.startOffset &&
  a.endContainer === b.endContainer && a.endOffset === b.endOffset;

export class DossierSelectionQuote {
  constructor({ host, template, entryOf, selected, eligible, quote }) {
    Object.assign(this, { host, entryOf, selected, eligible, quote });
    this.doc = host.ownerDocument; this.win = this.doc.defaultView;
    this.phone = this.win.matchMedia('(pointer: coarse)');
    // Clone the actual current pill, including its glyph, name and theme.
    // The Reader keeps its own node, handlers, focus and selection owners.
    this.pill = template.cloneNode(true);
    this.pill.id = 'dossier-quote-selection';
    this.pill.classList.add('dossier-quote-pill');
    this.pill.title = 'Quote selected text';
    this.pill.disabled = false;
    this.pill.hidden = true;
    this.doc.body.append(this.pill);
    this.current = null; this.held = null; this.invalid = null;

    this.doc.addEventListener('selectionchange', () => this.update());
    this.phone.addEventListener('change', () => this.update());
    this.doc.addEventListener('scroll', () => this.update(), { capture: true, passive: true });
    this.win.addEventListener('resize', () => this.update());
    this.win.visualViewport?.addEventListener('resize', () => this.update());
    this.win.visualViewport?.addEventListener('scroll', () => this.update());
    this.win.addEventListener('blur', () => this.clear());
    this.doc.addEventListener('visibilitychange', () => this.clear());
    this.doc.addEventListener('pointerdown', event => {
      if (!this.pill.contains(event.target)) { this.held = null; this.update(); return; }
      // Before focus or native selection collapse, exactly as the Reader does.
      this.held = this.capture();
      if (event.pointerType === 'mouse') event.preventDefault();
    }, true);
    this.doc.addEventListener('pointerup', event => {
      if (!this.held) return;
      const box = this.pill.getBoundingClientRect();
      if (!event.composedPath().includes(this.pill) || event.clientX < box.left || event.clientX > box.right ||
          event.clientY < box.top || event.clientY > box.bottom) { this.release(); return; }
    });
    this.pill.addEventListener('pointercancel', () => this.release());
    this.pill.addEventListener('pointerleave', event => { if (event.buttons) this.release(); });
    this.pill.addEventListener('keydown', event => {
      if (event.key === 'Enter' || event.key === ' ') this.held = this.capture();
      if (event.key === 'Escape') this.clear();
    });
    this.pill.onclick = event => {
      const chosen = this.held ?? (event.detail === 0 ? this.capture() : null);
      // Validate again after a held repaint has landed at pointerup. Never
      // fall back to a hover passage or to the dossier's first message.
      const valid = chosen && this.valid(chosen);
      this.clear();
      if (valid) {
        this.opening = true;
        Promise.resolve(this.quote(chosen.id, chosen.card, chosen.excerpt))
          .finally(() => { this.opening = false; this.update(); });
      }
    };
    // Selection-ending clicks must not open a card. Links and controls keep
    // their owners; nothing cancels pointer/touch selection or its menu.
    // Installed before MessageMenu's tap handler.
    host.addEventListener('click', event => {
      const selection = this.doc.getSelection();
      if (!this.phone.matches || selection?.isCollapsed !== false) return;
      const at = element(event.target), entry = this.entryOf(at), card = entry && cardIn(entry);
      const words = card?.querySelector(':scope > .message-preview');
      if (!words || !card.closest('.reply-stack') || at.closest('a,input,textarea,select,[contenteditable]')) return;
      if (at.closest('button,[role=button]') !== card) return;
      let touchesWords = false;
      for (let i = 0; i < selection.rangeCount; i++) if (selection.getRangeAt(i).intersectsNode(words)) touchesWords = true;
      if (!touchesWords) return;
      event.preventDefault(); event.stopImmediatePropagation();
    }, true);

    this.changes = new this.win.MutationObserver(records => {
      if (records.every(record => record.target === this.pill || this.pill.contains(record.target))) return;
      if (this.current && !this.valid(this.current)) {
        // A redraw can relocate a native Range onto other words. That range
        // is unusable until the person changes the selection again.
        const selection = this.doc.getSelection();
        this.invalid = selection?.rangeCount === 1 ? selection.getRangeAt(0).cloneRange() : null;
        this.clear();
      }
      this.update();
    });
    this.changes.observe(this.doc.body, { subtree: true, childList: true, characterData: true,
      attributes: true, attributeFilter: ['hidden', 'inert', 'open', 'data-folded', 'data-head-open', 'class'] });
    this.sizes = new this.win.ResizeObserver(() => this.update());
    this.sizes.observe(host);
    this.win.addEventListener('pagehide', () => {
      this.changes.disconnect(); this.sizes.disconnect(); this.clear(); this.pill.remove();
    });
  }

  available() {
    return !this.opening && this.phone.matches && this.host.isConnected && this.doc.visibilityState !== 'hidden' &&
      !this.host.closest('[hidden],[inert]') && !this.doc.querySelector('dialog[open],.message-menu-list');
  }
  viewport() {
    const view = this.win.visualViewport;
    const left = view?.offsetLeft ?? 0, top = view?.offsetTop ?? 0;
    return { left, top, right: left + (view?.width ?? this.doc.documentElement.clientWidth),
      bottom: top + (view?.height ?? this.win.innerHeight) };
  }
  capture() {
    if (!this.available()) return null;
    const selection = this.doc.getSelection();
    if (selection?.rangeCount !== 1 || selection.isCollapsed) { this.invalid = null; return null; }
    const range = selection.getRangeAt(0);
    if (sameRange(range, this.invalid)) return null;
    this.invalid = null;
    const entry = this.entryOf(range.startContainer), card = entry && cardIn(entry);
    const words = card?.querySelector(':scope > .message-preview');
    if (!words || !words.contains(range.startContainer) || !words.contains(range.endContainer) ||
        !card.closest('.reply-stack')) return null;
    // Use the same selection mapping as Return on the card, including whole
    // links and formatting marks, and the revision the card actually shows.
    const excerpt = this.selected(entry), revision = drawnRevision(words);
    if (!excerpt?.text.trim() || !Number.isInteger(revision) || revision < 1) return null;
    const chosen = { id: entry.dataset.id, entry, card, words, body: drawnText(words),
      range: range.cloneRange(), excerpt: { ...excerpt, revision } };
    return this.valid(chosen) ? chosen : null;
  }
  valid(chosen) {
    const { id, entry, card, words, body, range, excerpt } = chosen;
    return this.available() && this.eligible(id, entry) && this.host.contains(entry) &&
      cardIn(entry) === card && card.querySelector(':scope > .message-preview') === words &&
      Boolean(card.closest('.reply-stack')) && entry.dataset.id === id && card.dataset.id === id && !range.collapsed &&
      words.contains(range.startContainer) && words.contains(range.endContainer) &&
      typeof body === 'string' && drawnText(words) === body && drawnRevision(words) === excerpt.revision &&
      body.slice(excerpt.start, excerpt.end) === excerpt.text &&
      sourcePosition(range.startContainer, range.startOffset) === excerpt.start &&
      sourcePosition(range.endContainer, range.endOffset, true) === excerpt.end &&
      this.visibleWords(range, words);
  }
  // Inspect selected text nodes only, never other messages or loaded history.
  // Range boxes include clipped text, so intersect every clipping ancestor.
  visibleWords(range, words) {
    for (const control of words.querySelectorAll(CONTROLS)) if (range.intersectsNode(control)) return false;
    const walker = this.doc.createTreeWalker(words, 4), view = this.viewport();
    let found = false;
    for (let text = walker.nextNode(); text; text = walker.nextNode()) {
      if (!range.intersectsNode(text)) continue;
      const part = this.doc.createRange(); part.selectNodeContents(text);
      if (text === range.startContainer) part.setStart(text, range.startOffset);
      if (text === range.endContainer) part.setEnd(text, range.endOffset);
      if (!part.toString().trim()) continue;
      const clip = { ...view };
      for (let at = text.parentElement; at; at = at.parentElement) {
        if (at !== words.closest('.message-card') && at.matches(CONTROLS)) return false;
        const style = this.win.getComputedStyle(at);
        if (at.hidden || at.inert || at.getAttribute('aria-hidden') === 'true' || style.display === 'none' ||
            style.visibility !== 'visible' || Number(style.opacity) === 0) return false;
        const box = at.getBoundingClientRect();
        if (style.overflowX !== 'visible') {
          clip.left = Math.max(clip.left, box.left + at.clientLeft);
          clip.right = Math.min(clip.right, box.left + at.clientLeft + at.clientWidth);
        }
        if (style.overflowY !== 'visible') {
          clip.top = Math.max(clip.top, box.top + at.clientTop);
          clip.bottom = Math.min(clip.bottom, box.top + at.clientTop + at.clientHeight);
        }
      }
      const boxes = [...part.getClientRects()].filter(box => box.width > 0 && box.height > 0);
      if (!boxes.length || boxes.some(box => box.left < clip.left - 1 || box.right > clip.right + 1 ||
          box.top < clip.top - 1 || box.bottom > clip.bottom + 1)) return false;
      found = true;
    }
    return found;
  }
  clear() { this.current = this.held = null; if (!this.pill.hidden) this.pill.hidden = true; }
  release() { this.held = null; this.update(); }
  update() {
    const chosen = this.held ?? this.capture();
    if (!chosen || !this.valid(chosen)) { this.clear(); return; }
    this.current = chosen;
    if (this.pill.hidden) this.pill.hidden = false;
    // A finger already on the pill keeps its target through its release.
    if (this.held) return;
    const view = this.viewport();
    this.pill.style.maxWidth = `${Math.max(44, view.right - view.left - 16)}px`;
    const width = this.pill.offsetWidth, height = this.pill.offsetHeight;
    const left = Math.max(view.left + 8, view.right - width - 8);
    let top = view.bottom - height - 16;
    const words = chosen.range.getBoundingClientRect();
    if (words.right > left - 16 && words.bottom > top - 16) top = words.top - height - 20;
    top = Math.max(view.top + 8, Math.min(top, view.bottom - height - 8));
    this.pill.style.left = `${left}px`; this.pill.style.top = `${top}px`;
  }
}

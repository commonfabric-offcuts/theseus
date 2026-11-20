import { InlineComposer } from './inline-composer.mjs';
import { revealCardReply } from './compose-bar.mjs';
import { holdsWriting } from './editor.mjs';
import { uploadWork } from './upload-state.mjs';

// Keep the writing's bottom where it was when its image strip changes. Ignore
// an offscreen reply: an upload finishing there must not pull the page away.
export function holdReplyImages(field, delta, win = window) {
  if (!delta || !field.getClientRects().length) return;
  const rect = field.closest('.field-box').getBoundingClientRect(), vv = win.visualViewport;
  const top = vv?.offsetTop ?? 0, bottom = top + (vv?.height ?? win.innerHeight);
  const before = { top: rect.top - delta, bottom: rect.bottom - delta };
  if (before.bottom <= top || before.top >= bottom) return;
  const wanted = Math.max(top + Math.min(rect.height, bottom - top), Math.min(bottom, before.bottom));
  win.scrollBy({ top: rect.bottom - wanted, behavior: 'instant' });
}

export function replyNeedsWide(field, draft, win = window) {
  if (draft.quotes?.length || /^> /m.test(draft.body)) return true;
  if (!draft.body) return false;
  const style = win.getComputedStyle(field), line = parseFloat(style.lineHeight);
  const padding = (parseFloat(style.paddingTop) || 0) + (parseFloat(style.paddingBottom) || 0);
  if (!(line > 0)) return false;
  const { height, whiteSpace } = field.style, scroll = field.scrollTop;
  try { field.style.height = '0px'; field.style.whiteSpace = 'pre-wrap'; return field.scrollHeight > 4 * line + padding + 1; }
  finally { field.style.height = height; field.style.whiteSpace = whiteSpace; field.scrollTop = scroll; }
}

// Independent DOM adapters, one per message. All durable writing, uploads,
// uncertain sends and recovery still belong to the page's EditorRegistry.
export class CardReplies {
  constructor({ template, registry, topic, callbacks, offer, discover, say, changed = () => {} }) {
    Object.assign(this, { template: template.cloneNode(true), registry, topic, callbacks, offer, discover, say, changed });
    this.rows = new Map(); this.closed = new Set(); this.loads = new Map(); this.queue = new Map(); this.loading = 0;
  }
  surface(p) { return this.rows.get(p?.source?.source_ref?.id)?.ui; }
  dispose() { for (const row of this.rows.values()) row.observer?.disconnect(); this.queue.clear(); }
  shown(id) { const row = this.rows.get(id); return Boolean(row && !row.ui.root.hidden && row.card.isConnected); }
  sync(items, cardOf) {
    for (const item of items) {
      if (!this.rows.has(item.id) && (!item.yours?.reply || this.closed.has(item.id))) continue;
      const row = this.rows.get(item.id), card = cardOf(item.id);
      if (row && card && row.card !== card) { row.card = card; card.append(row.ui.root); }
      if (item.yours?.reply && card && !this.rows.has(item.id) && !this.closed.has(item.id)) this.queue.set(item.id, card);
    }
    this.drain();
  }
  drain() {
    while (this.loading < 2 && this.queue.size && !this.registry.disposed) {
      const [id, card] = this.queue.entries().next().value; this.queue.delete(id); ++this.loading;
      this.open(id, card, { focus: false }).catch(error => this.say(error)).finally(() => { --this.loading; this.drain(); });
    }
  }
  async open(id, card, { focus = true } = {}) {
    if (!card?.isConnected || this.registry.disposed) return null;
    let row = this.rows.get(id);
    if (!row) {
      let load = this.loads.get(id);
      if (!load) {
        load = this.registry.initializeCard({ kind: 'message', id }, this.topic()).then(async p => {
          if (!p || !card.isConnected || this.registry.disposed) return null;
          this.offer(p);
          const root = this.template.cloneNode(true), prefix = `reply-${id}-`;
          const ids = new Map([...root.querySelectorAll('[id]')].map(el => [el.id, el.id.replace(/^inline-/, prefix)]));
          root.id = `${prefix}composer`; root.classList.remove('inline-composer'); root.classList.add('card-reply-composer');
          for (const el of [root, ...root.querySelectorAll('*')]) {
            if (ids.has(el.id)) el.id = ids.get(el.id);
            for (const attr of ['for', 'aria-labelledby', 'aria-describedby', 'aria-controls']) {
              if (el.hasAttribute(attr)) el.setAttribute(attr, el.getAttribute(attr).split(' ').map(id => ids.get(id) ?? id).join(' '));
            }
          }
          root.querySelector('.sheet-close')?.remove();
          const ui = new InlineComposer({ ...this.callbacks, sent: (p, result) => this.sent(id, p, result) }, { root, prefix, cardReply: true });
          const preview = card.querySelector(':scope > .message-preview');
          const sourceHeight = preview?.clientHeight ? Math.max(24, Math.min(preview.clientHeight, card.clientHeight - (card.scrollHeight - preview.clientHeight))) : 240;
          row = { ui, card, p, sourceHeight }; this.rows.set(id, row); card.append(root);
          root.addEventListener('click', event => event.stopPropagation());
          root.addEventListener('keydown', event => {
            if (event.key !== 'Escape' || event.defaultPrevented || event.isComposing || ui.bar.panel || ui.naming.sheet.open) return;
            event.preventDefault(); event.stopPropagation(); this.close(id).catch(error => ui.notice(error));
          });
          const close = root.ownerDocument.createElement('button'); close.type = 'button'; close.className = 'card-reply-close';
          close.textContent = '×'; close.title = 'Close, keeping the writing'; close.setAttribute('aria-label', 'Close reply, keeping the writing');
          close.onclick = () => this.close(id).catch(error => ui.notice(error)); root.append(close);
          const taller = ui.$('taller-field'); root.insertBefore(taller, ui.$('plus-button'));
          taller.classList.add('reply-height'); taller.setAttribute('aria-label', 'Double reply height'); taller.title = 'Double reply height';
          const paintHeight = () => { const tall = root.hasAttribute('data-tall'); taller.firstElementChild.textContent = tall ? '⌄' : '⌃'; taller.title = tall ? 'Restore reply height' : 'Double reply height'; taller.setAttribute('aria-label', taller.title); };
          row.paintHeight = paintHeight; taller.addEventListener('click', paintHeight); paintHeight();
          ui.field.placeholder = 'Write a reply…'; ui.$('writing-to').hidden = true;
          ui.show(p); ui.bar.expand();
          const fieldBox = ui.field.closest('.field-box');
          let fieldTop = fieldBox.offsetTop;
          row.observer = new ResizeObserver(() => {
            // The strip entering the grid also introduces its row gap. Its
            // own height alone misses that part of the writing's movement.
            if (root.hidden || this.registry.current || p.hidden) { fieldTop = null; return; }
            const next = fieldBox.offsetTop, delta = fieldTop === null ? 0 : next - fieldTop; fieldTop = next;
            holdReplyImages(ui.field, delta);
          });
          row.observer.observe(ui.$('attachments'));
          this.discover(p, p.editors.reply); return row;
        }).finally(() => this.loads.delete(id));
        this.loads.set(id, load);
      }
      row = await load;
    }
    if (!row || this.registry.disposed) return null;
    if (focus) {
      row.ui.opening = Symbol();
      for (const [otherId, other] of this.rows) {
        const editor = other.p.editors.reply;
        if (other !== row && other.clickOpened && !other.p.hidden && !holdsWriting(editor.draft) &&
            !uploadWork(editor) && !editor.submissions?.length) await this.close(otherId, { focus: false });
      }
      row.clickOpened = true;
    }
    if (focus) this.closed.delete(id);
    if (this.closed.has(id)) return row.p;
    row.p.hidden = false; row.ui.root.hidden = Boolean(this.registry.current); this.paint();
    if (focus && !this.registry.current) {
      row.ui.bar.expand(); row.ui.field.focus({ preventScroll: true }); revealCardReply(row.ui.field);
    }
    this.changed(); return row.p;
  }
  async close(id, { focus = true } = {}) {
    const row = this.rows.get(id); if (!row || !await this.registry.hideCard(row.p)) return false;
    return this.hide(id, row, { focus });
  }
  hide(id, row, { focus = true } = {}) {
    row.p.hidden = true;
    this.closed.add(id); row.ui.bar.close(); row.ui.root.hidden = true; row.card.removeAttribute('data-card-reply');
    row.ui.root.removeAttribute('data-tall'); row.ui.$('taller-field').setAttribute('aria-pressed', 'false'); row.paintHeight?.();
    if (focus) row.card.focus({ preventScroll: true }); this.changed(); return true;
  }
  sent(id, p, result) {
    const row = this.rows.get(id);
    if (!row || row.p !== p || holdsWriting(p.editors.reply.draft)) return;
    // The session has already persisted publication and its empty successor.
    // Hide synchronously: no close/save await may swallow a later opening.
    const doc = row.ui.root.ownerDocument, focused = row.ui.root.contains(doc.activeElement), opening = row.ui.opening;
    this.hide(id, row, { focus: false });
    if (focused) return this.callbacks.sent?.(result, () => row.ui.opening === opening && p.hidden &&
      !this.registry.current && !this.registry.pendingOpen && !holdsWriting(p.editors.reply.draft) &&
      (!doc.activeElement || doc.activeElement === doc.body || row.ui.root.contains(doc.activeElement)));
  }
  from(id) {
    const row = this.rows.get(id);
    return row && this.shown(id) ? { wide: replyNeedsWide(row.ui.field, row.p.editors.reply.draft) } : false;
  }
  paint(editor = null) {
    for (const row of this.rows.values()) {
      if (editor && row.p.editors.reply !== editor) continue;
      const hidden = row.p.hidden || Boolean(this.registry.current);
      if (!hidden && !row.card.hasAttribute('data-card-reply')) {
        row.card.style.setProperty('--reply-message-height', `${row.sourceHeight}px`);
      }
      row.ui.root.hidden = hidden; row.card.toggleAttribute('data-card-reply', !hidden);
      if (!hidden && row.ui.field.value !== row.p.editors.reply.draft.body && row.ui.root.ownerDocument.activeElement !== row.ui.field) row.ui.drawEditor();
      row.ui.paintStatus(); if (!hidden) row.ui.bar.expand();
    }
  }
}

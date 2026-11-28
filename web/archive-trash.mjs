import { glyph } from './glyphs.mjs';
import { openMessageMenu } from './message-menu.mjs';
import { readFailure } from './freshness.mjs';
import { paintRemoval } from './message-removal.mjs';

const element = (doc, tag, className, text) => {
  const node = doc.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
};

// Trash has its own lifetime and cursor. A response is only for the open
// fold that asked for it, even if that fold closes and reopens meanwhile.
export class ArchiveTrash {
  constructor({ doc, read, afterRead, act = null, folded = () => {} }) {
    Object.assign(this, { doc, read, afterRead, act, folded });
    this.rows = new Map();
    this.records = new Map();
    this.removals = new Map();
    this.epoch = 0;
    this.confirmedEmpty = false;
    this.root = element(doc, 'details', 'archive-trash');
    this.summary = element(doc, 'summary');
    this.count = element(doc, 'span', 'archive-shelf-count');
    this.summary.append(glyph('chevron', doc, 14), element(doc, 'span', '', 'Trash'), this.count);
    this.list = element(doc, 'ul', 'archive-trash-rows');
    this.list.setAttribute('role', 'list');
    this.notice = element(doc, 'div', 'archive-shelf-notice');
    this.notice.setAttribute('role', 'status');
    this.more = element(doc, 'button', 'archive-shelf-more', 'Show more');
    this.more.type = 'button';
    this.more.onclick = () => this.load();
    this.root.append(this.summary, this.list, this.notice, this.more);
    this.root.ontoggle = () => {
      if (!this.root.open) {
        this.close();
        if (this.visible) this.folded();
      }
      else if (!this.loaded && !this.failed) return this.load();
    };
    this.clear();
  }

  show(visible) {
    if (visible === this.visible) return;
    this.visible = visible;
    if (!visible) {
      this.root.open = false;
      this.close();
    }
  }

  invalidate() {
    this.epoch++;
    this.confirmedEmpty = false;
  }

  reload() {
    if (!this.visible || !this.root.open) return;
    const focused = this.list.contains(this.doc.activeElement) || this.doc.activeElement === this.more;
    this.clear();
    if (focused) this.summary.focus({ preventScroll: true });
    return this.load();
  }

  learnStar({ message_id, starred, star_revision }) {
    const record = this.records.get(message_id);
    if (!record || record.star_revision > star_revision) return;
    Object.assign(record, { starred, star_revision });
  }

  menu(anchor, item, at = null) {
    if (!this.root.open || this.records.get(item.message_id) !== item) return;
    const { starred } = item;
    this.menuOwner = openMessageMenu({ anchor, at, label: 'Trashed dossier', sheet: true, doc: this.doc, win: this.doc.defaultView,
      items: [
        { label: 'Move out of trash', glyph: 'back', act: () => this.act(item, 'restore') },
        { label: starred ? 'Unstar' : 'Star', glyph: starred ? 'starred' : 'star', act: () => this.act(item, 'star') },
      ] });
  }

  close() {
    if (this.loaded && this.cursor === null && this.rows.size === 0 && this.loadedAt === this.epoch) {
      this.confirmedEmpty = true;
    }
    this.clear();
  }

  clear() {
    this.menuOwner?.close(false); this.menuOwner = null;
    this.attempt = null;
    this.cursor = null;
    this.loaded = false;
    this.loadedAt = null;
    this.failed = false;
    this.rows.clear(); this.records.clear();
    this.removals.clear();
    this.list.replaceChildren();
    this.paint();
  }

  learnRemoval(id, removal) {
    if (!this.visible || !this.root.open || !removal) return;
    this.removals.set(id, removal);
    const row = this.rows.get(id);
    if (removal.kind === 'unsent') {
      row?.remove();
      this.rows.delete(id); this.records.delete(id);
      if (this.menuOwner && row?.contains(this.menuOwner.anchor)) { this.menuOwner.close(false); this.menuOwner = null; }
    } else if (row) this.paintTerminal(row, removal);
    this.paint();
  }

  paintTerminal(row, removal) {
    const title = row.querySelector('.archive-trash-title');
    title.classList.toggle('retracted-words', removal?.kind === 'retracted' && title.dataset.sourceExcerpt === 'true');
    paintRemoval(row, { removal }, this.doc);
  }

  async load() {
    if (!this.visible || !this.root.open || this.attempt || this.loaded && this.cursor === null) return;
    const attempt = {}, focused = this.doc.activeElement === this.more;
    if (!this.loaded) {
      this.loadedAt = this.epoch;
      this.confirmedEmpty = false;
    }
    this.attempt = attempt;
    this.failed = false;
    this.paint();
    const current = () => this.visible && this.root.open && this.attempt === attempt;
    try {
      const page = await this.read(this.cursor);
      await this.afterRead();
      if (!current()) return;
      for (const item of page.items) {
        const removal = this.removals.get(item.message_id) ?? item.removal;
        if (item.withheld || removal?.kind === 'unsent' || this.rows.has(item.message_id)) continue;
        const name = item.name?.trim(), excerpt = item.excerpt?.split('\n', 1)[0].trim();
        const title = name || excerpt || 'Dossier';
        const row = element(this.doc, 'li');
        row.title = title;
        const words = element(this.doc, 'span', 'archive-trash-title', title);
        words.dataset.sourceExcerpt = String(!name && Boolean(excerpt));
        const icon = glyph('trash', this.doc, 13);
        if (this.act) {
          const action = element(this.doc, 'button', 'archive-trash-action');
          action.type = 'button';
          action.setAttribute('aria-haspopup', 'menu');
          action.setAttribute('aria-label', 'Actions for ' + title);
          const more = element(this.doc, 'span', 'archive-trash-more-symbol');
          more.setAttribute('aria-hidden', 'true');
          action.append(icon, words, more);
          row.append(action); row.dataset.id = item.message_id;
          this.records.set(item.message_id, item);
          action.onclick = () => this.menu(action, item);
          action.oncontextmenu = event => {
            event.preventDefault();
            this.menu(action, item, event.clientX || event.clientY ? { x: event.clientX, y: event.clientY } : null);
          };
          action.onkeydown = event => {
            if (!(event.key === 'ContextMenu' || event.shiftKey && event.key === 'F10') || event.ctrlKey || event.altKey || event.metaKey) return;
            event.preventDefault(); this.menu(action, item);
          };
        } else row.append(icon, words);
        this.paintTerminal(row, removal);
        this.rows.set(item.message_id, row);
        this.list.append(row);
      }
      this.cursor = page.next_cursor;
      this.loaded = true;
    } catch (error) {
      await this.afterRead();
      if (!current()) return;
      if (['forbidden', 'authority', 'reconnect'].includes(readFailure(error).kind)) {
        this.menuOwner?.close(false); this.menuOwner = null;
        this.rows.clear(); this.records.clear();
        this.list.replaceChildren();
        this.loaded = false;
        this.cursor = null;
      }
      this.failed = true;
    } finally {
      if (current()) {
        this.attempt = null;
        this.paint();
        if (focused && [this.more, this.doc.body].includes(this.doc.activeElement)) {
          (this.more.hidden ? this.summary : this.more).focus({ preventScroll: true });
        }
      }
    }
  }

  paint() {
    this.count.textContent = this.loaded && this.cursor === null ? String(this.rows.size) : '';
    this.notice.textContent = this.attempt ? 'Loading Trash…' : this.failed ? 'Could not load Trash.'
      : this.loaded && this.cursor === null && this.rows.size === 0 ? 'Trash is empty.' : '';
    this.more.hidden = this.cursor === null && !this.failed;
    this.more.disabled = this.attempt !== null;
    this.more.textContent = this.failed ? 'Retry Trash' : 'Show more';
    this.more.setAttribute('aria-label', this.failed ? 'Retry loading Trash' : 'Show more trashed dossiers');
  }
}

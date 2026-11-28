import { glyph } from './glyphs.mjs';
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
  constructor({ doc, read, afterRead, folded = () => {} }) {
    Object.assign(this, { doc, read, afterRead, folded });
    this.rows = new Map();
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

  close() {
    if (this.loaded && this.cursor === null && this.rows.size === 0 && this.loadedAt === this.epoch) {
      this.confirmedEmpty = true;
    }
    this.clear();
  }

  clear() {
    this.attempt = null;
    this.cursor = null;
    this.loaded = false;
    this.loadedAt = null;
    this.failed = false;
    this.rows.clear();
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
      this.rows.delete(id);
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
        row.append(glyph('trash', this.doc, 13), words);
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
        this.rows.clear();
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

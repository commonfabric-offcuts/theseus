import { glyph } from './glyphs.mjs';
import { readFailure } from './freshness.mjs';

const element = (doc, tag, className, text) => {
  const node = doc.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
};

// Trash has its own lifetime and cursor. A response is only for the open
// fold that asked for it, even if that fold closes and reopens meanwhile.
export class ArchiveTrash {
  constructor({ doc, read, afterRead }) {
    Object.assign(this, { doc, read, afterRead });
    this.rows = new Map();
    this.removed = new Set();
    this.root = element(doc, 'details', 'archive-trash');
    this.summary = element(doc, 'summary');
    this.summary.append(glyph('chevron', doc, 14), element(doc, 'span', '', 'Trash'));
    this.list = element(doc, 'ul', 'archive-trash-rows');
    this.list.setAttribute('role', 'list');
    this.notice = element(doc, 'div', 'archive-shelf-notice');
    this.notice.setAttribute('role', 'status');
    this.more = element(doc, 'button', 'archive-shelf-more', 'Show more');
    this.more.type = 'button';
    this.more.onclick = () => this.load();
    this.root.append(this.summary, this.list, this.notice, this.more);
    this.root.ontoggle = () => {
      if (!this.root.open) this.clear();
      else if (!this.loaded && !this.failed) return this.load();
    };
    this.clear();
  }

  show(visible) {
    if (visible === this.visible) return;
    this.visible = visible;
    if (!visible) {
      this.root.open = false;
      this.clear();
    }
  }

  clear() {
    this.attempt = null;
    this.cursor = null;
    this.loaded = false;
    this.failed = false;
    this.rows.clear();
    this.removed.clear();
    this.list.replaceChildren();
    this.paint();
  }

  forget(id) {
    if (!this.visible || !this.root.open) return;
    this.removed.add(id);
    this.rows.get(id)?.remove();
    this.rows.delete(id);
    this.paint();
  }

  async load() {
    if (!this.visible || !this.root.open || this.attempt || this.loaded && this.cursor === null) return;
    const attempt = {}, focused = this.doc.activeElement === this.more;
    this.attempt = attempt;
    this.failed = false;
    this.paint();
    const current = () => this.visible && this.root.open && this.attempt === attempt;
    try {
      const page = await this.read(this.cursor);
      await this.afterRead();
      if (!current()) return;
      for (const item of page.items) {
        if (item.withheld || this.removed.has(item.message_id) || this.rows.has(item.message_id)) continue;
        const title = item.name?.trim() || item.excerpt?.split('\n', 1)[0].trim() || 'Dossier';
        const row = element(this.doc, 'li', '', title);
        row.title = title;
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
    this.notice.textContent = this.attempt ? 'Loading Trash…' : this.failed ? 'Could not load Trash.'
      : this.loaded && this.cursor === null && this.rows.size === 0 ? 'Trash is empty.' : '';
    this.more.hidden = this.cursor === null && !this.failed;
    this.more.disabled = this.attempt !== null;
    this.more.textContent = this.failed ? 'Retry Trash' : 'Show more';
    this.more.setAttribute('aria-label', this.failed ? 'Retry loading Trash' : 'Show more trashed dossiers');
  }
}

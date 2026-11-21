import { messagePreview } from './message-preview.mjs';

// One explicit page at a time. Core supplies canonical roots and visibility;
// this list never infers a dossier from a partial reply chain.
export async function dossierPage(read, topicId, cursor = null) {
  const page = await read('topic_messages', { topic_id: topicId, direction: 'before', audience: 'all', limit: 30,
    ...(cursor === null ? {} : { cursor }) });
  if (!Array.isArray(page.items) || page.items.some(item => item.topic_id !== topicId || !item.stack_position?.root_id) ||
      !(page.next_cursor === null || page.items.length && Number.isSafeInteger(page.next_cursor) && page.next_cursor > 0 && (cursor === null || page.next_cursor < cursor)))
    throw Error('The dossiers could not be confirmed.');
  const roots = [...new Set([...page.items].reverse().map(item => item.stack_position.root_id))];
  const known = new Map(page.items.map(item => [item.id, item]));
  const missing = roots.filter(id => !known.has(id));
  if (missing.length) {
    const named = await read('topic_messages', { topic_id: topicId, message_ids: missing });
    if (!Array.isArray(named.items) || named.items.some(item => item.topic_id !== topicId || !missing.includes(item.id)) ||
        missing.some(id => !named.items.some(item => item.id === id))) throw Error('The dossier names could not be confirmed.');
    for (const item of named.items) known.set(item.id, item);
  }
  return { next: page.next_cursor, items: roots.map(id => {
    const root = known.get(id), name = root.stack_position?.name;
    if (root.stack_position?.root_id !== id) throw Error('A dossier changed while its name was read. Try again.');
    return { id, title: name?.text || (typeof name === 'string' ? name : '') || messagePreview(root) || 'Untitled dossier' };
  }) };
}

export class NotebookDossiers {
  constructor({ doc, host, anchor, read, topicId, choose }) {
    Object.assign(this, { doc, anchor, read, topicId, choose });
    const el = (tag, text, cls='') => Object.assign(doc.createElement(tag), { textContent:text, className:cls });
    this.root = el('section', '', 'notebook-dossier-picker'); this.root.hidden = true;
    this.root.setAttribute('aria-label', 'Dossiers in this topic');
    this.status = el('p', '', 'notice'); this.status.setAttribute('role', 'status');
    this.list = el('div', '', 'notebook-dossier-choices');
    this.more = el('button', 'More'); this.more.type = 'button'; this.more.onclick = () => this.load();
    this.retry = el('button', 'Retry'); this.retry.type = 'button'; this.retry.onclick = () => this.load();
    this.root.append(this.status, this.list, this.more, this.retry); host.insertBefore(this.root, host.querySelector('.notebook-sheet-pages'));
    this.serial = 0; this.showing = false;
    this.root.addEventListener('keydown', event => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); this.close(true); }
    });
  }
  toggle() {
    if (this.showing) { this.close(true); return; }
    this.serial++; this.showing = true; this.busy = false; this.next = null; this.seen = new Set();
    this.list.replaceChildren(); this.root.hidden = false; this.anchor.setAttribute('aria-expanded', 'true');
    return this.load();
  }
  close(focus=false) {
    this.serial++; this.showing = false; this.root.hidden = true; this.anchor.setAttribute('aria-expanded', 'false');
    if (focus) this.anchor.focus({ preventScroll:true });
  }
  async load() {
    if (!this.showing || this.busy) return;
    const serial = this.serial;
    this.busy = true; this.more.hidden = true; this.retry.hidden = true; this.status.textContent = 'Reading dossiers…';
    try {
      const page = await dossierPage(this.read, this.topicId, this.next);
      if (serial !== this.serial || !this.showing) return;
      for (const row of page.items) {
        if (this.seen.has(row.id)) continue;
        this.seen.add(row.id);
        const button = this.doc.createElement('button'); button.type = 'button'; button.textContent = row.title; button.title = row.title;
        button.onclick = () => { this.close(); this.choose(row.id); }; this.list.append(button);
      }
      this.next = page.next; this.more.hidden = page.next === null;
      this.status.textContent = this.seen.size ? '' : page.next === null ? 'No dossiers in this topic.' : 'More messages may contain other dossiers.';
    } catch (error) {
      if (serial !== this.serial || !this.showing) return;
      this.status.textContent = `The dossiers could not be read. ${error.message}`; this.retry.hidden = false;
    } finally { if (serial === this.serial) this.busy = false; }
  }
}

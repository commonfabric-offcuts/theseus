import { glyph } from './glyphs.mjs';

const storageHere = () => { try { return globalThis.localStorage; } catch { return null; } };
const valid = mode => mode === 'cards' || mode === 'text';

// A browser view preference only. Never a Notebook revision or Draft change.
export class NotebookViews {
  constructor({ instance_id, actor }, storage = storageHere()) {
    Object.assign(this, { instance: instance_id, actor, storage });
    this.local = new Map(); this.listeners = new Set();
  }
  key(id) { return 'aim-next.notebook-view.' + JSON.stringify([this.instance, this.actor, id]); }
  get(id) {
    if (this.local.has(id)) return this.local.get(id);
    try { const mode = this.storage?.getItem(this.key(id)); if (valid(mode)) return mode; } catch {}
    return 'cards';
  }
  set(id, mode) {
    if (!valid(mode)) return;
    const changed = this.get(id) !== mode;
    this.local.set(id, mode);
    try { this.storage?.setItem(this.key(id), mode); } catch {}
    if (changed) for (const listener of this.listeners) listener(id, mode);
  }
  listen(listener) { this.listeners.add(listener); return () => this.listeners.delete(listener); }
}

export function notebookDocument(mode, doc = globalThis.document) {
  const icon = doc.createElement('span'); icon.className = 'notebook-document'; icon.dataset.mode = mode; icon.setAttribute('aria-hidden', 'true');
  if (mode === 'cards') icon.append(glyph('stack', doc));
  else for (let i = 0; i < 4; i++) icon.append(doc.createElement('span'));
  return icon;
}

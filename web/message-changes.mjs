// A device-local presentation choice. Core alone supplies eligible changes.
export class MessageChanges {
  constructor(instance, actor, storage) {
    this.prefix = ['aim-next', instance, actor, 'message-changes'];
    this.storage = storage;
    this.hidden = new Map();
  }
  key(id) { return JSON.stringify([...this.prefix, id]); }
  shown(id, revision) {
    if (!this.hidden.has(id)) {
      let saved;
      try { saved = Number(this.storage?.getItem(this.key(id))); } catch { /* in-memory choice */ }
      this.hidden.set(id, saved || null);
    }
    return this.hidden.get(id) !== revision;
  }
  toggle(id, revision) {
    const hidden = this.shown(id, revision) ? revision : null;
    this.hidden.set(id, hidden);
    try {
      if (hidden === null) this.storage?.removeItem(this.key(id));
      else this.storage?.setItem(this.key(id), String(hidden));
    } catch { /* usable for this page's life */ }
  }
}

// Span button because a feed card is itself a button. Reader uses the same
// control. Stop the event before card/dossier activation or Return-to-quote.
export function editChangeMark(doc, edited, changes = null) {
  if (!edited) return null;
  const mark = doc.createElement('span');
  mark.className = 'message-edited'; mark.append('Edited');
  if (!changes?.struck) return mark;
  const toggle = doc.createElement('span');
  toggle.className = 'message-changes-toggle';
  toggle.setAttribute('role', 'button'); toggle.tabIndex = 0;
  const glyph = doc.createElement('span');
  glyph.className = 'message-changes-glyph';
  glyph.textContent = '✓';
  glyph.setAttribute('aria-hidden', 'true');
  toggle.append(glyph);
  const paint = () => {
    const accepted = !changes.shown();
    const label = accepted ? 'Show changes' : 'Accept changes';
    toggle.title = label;
    toggle.setAttribute('aria-label', label);
    toggle.setAttribute('aria-pressed', String(accepted));
  };
  const act = event => {
    event.preventDefault(); event.stopPropagation();
    changes.toggle(); paint();
  };
  toggle.onclick = act;
  toggle.onkeydown = event => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault(); event.stopPropagation();
    if (!event.repeat) { changes.toggle(); paint(); }
  };
  paint(); mark.append(' ', toggle);
  return mark;
}

// What an outcome is for, set in place on its page by whoever organises it (its
// owner or coordinator) after creating it with a title alone. A quiet "Add a
// purpose" (or "Edit purpose") opens a box a few sentences wide; Return saves
// it, Shift+Return starts a new line, Escape puts it back. Saving is
// workspace.update; a quiet "Saved" or the refusal in plain words says what
// became of it, and a refusal keeps the words.
import { glyph } from './glyphs.mjs';

const element = (tag, props = {}, ...children) => { const node = Object.assign(document.createElement(tag), props); node.append(...children); return node; };
const ANYONE = 'Choose a topic, or start a new one.';

export class PurposeLine {
  // save(purpose, workspace) resolves to the command's receipt.
  constructor({ host, description, save }) {
    Object.assign(this, { host, description, save });
    this.descriptionParent = description.parentNode; this.descriptionNext = description.nextSibling;
    this.wide = false;
    this.action = element('button', { type: 'button', className: 'text-action' });
    this.action.onclick = () => this.edit();
    this.box = element('textarea', { id: 'outcome-purpose-input', rows: 2, hidden: true, placeholder: 'What this outcome is for', spellcheck: true });
    this.box.setAttribute('aria-label', 'Purpose of this outcome');
    this.box.setAttribute('enterkeyhint', 'done');
    this.box.onkeydown = event => {
      if (event.isComposing || event.keyCode === 229) return;
      if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); if (!event.repeat) this.commit(); }
      else if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); this.close(); }
    };
    this.box.oninput = () => this.show('');
    this.state = element('p', { className: 'one-line-state', hidden: true });
    this.state.setAttribute('role', 'status');
    host.replaceChildren(this.box, this.action, this.state);
  }

  paint(workspace, owner) {
    this.workspace = workspace; this.owner = owner;
    const purpose = workspace.purpose || '';
    this.description.textContent = purpose || (owner ? '' : ANYONE);
    this.description.hidden = this.wide && !this.box.hidden || owner && !purpose;
    this.host.hidden = this.wide ? !owner && !purpose : !owner;
    this.action.hidden = !owner || !this.box.hidden;
    this.action.classList.toggle('purpose-pencil', this.wide && Boolean(purpose));
    this.action.textContent = purpose ? 'Edit purpose' : 'Add a purpose';
    this.action.setAttribute('aria-label', purpose ? 'Edit purpose' : 'Add a purpose');
    this.action.title = purpose ? 'Edit purpose' : 'Add a purpose';
    if (this.wide) {
      this.host.insertBefore(this.description, this.box);
      if (purpose && owner) {
        this.action.replaceChildren(glyph('pencil', this.host.ownerDocument ?? document, 16));
        this.description.append(this.action);
      } else this.host.insertBefore(this.action, this.state);
    }
    if (this.box.hidden) this.box.value = purpose;
  }

  edit() {
    if (!this.owner) return;
    this.box.value = this.workspace.purpose || ''; this.box.hidden = false; this.action.hidden = true; this.show('');
    if (this.wide) this.description.hidden = true;
    this.box.focus(); this.box.setSelectionRange(this.box.value.length, this.box.value.length);
  }

  close() { this.box.hidden = true; this.paint(this.workspace, this.owner); this.box.value = this.workspace?.purpose || ''; this.action.focus(); }

  layout(wide) {
    const restore = this.wide && !wide;
    this.wide = wide;
    // Only the wide layout borrows these nodes. Ordinary narrow paints keep
    // their original DOM contract, including before any media result arrives.
    if (restore) {
      if (this.descriptionParent) this.descriptionParent.insertBefore(this.description, this.descriptionNext?.parentNode === this.descriptionParent ? this.descriptionNext : null);
      else this.description.remove();
      this.host.insertBefore(this.action, this.state);
    }
    if (this.workspace) this.paint(this.workspace, this.owner);
  }

  show(text, quiet = false) { this.state.textContent = text; this.state.hidden = !text; this.state.classList.toggle('quiet', quiet); }

  async commit() {
    if (this.busy) return;
    const words = this.box.value;
    if (words === (this.workspace.purpose || '')) { this.close(); return; }
    this.busy = true; this.show('Saving…', true);
    let message = null;
    try {
      const receipt = await this.save(words, this.workspace);
      if (receipt?.status !== 'committed') message = receipt?.error?.message ?? 'The purpose was not confirmed. Press Return to try once more.';
    } catch (error) { message = error.message; }
    this.busy = false;
    if (message) { this.show(message); this.box.focus(); return; }
    this.workspace = { ...this.workspace, purpose: words };
    this.paint(this.workspace, this.owner); this.close(); this.show('Saved', true);
  }
}

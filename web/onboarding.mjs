// Interactive outcome handoff; Core alone authorizes and assembles context.
import { openMessageMenu } from './message-menu.mjs';

export const COPIED = 'Onboarding prompt copied.';
export const COPY_FAILED = 'Could not copy. The prompt is here to read and select. Use Copy or try Retry copy.';
export const READ_FAILED = 'The current onboarding prompt could not be read. Only the outcome’s owner can copy it. Try again.';
export const owns = (workspace, reader) => Boolean(workspace && workspace.owner_id === reader);

// Start the native clipboard operation in the click, before the network read settles.
// Safari accepts promised ClipboardItem data within that gesture. No execCommand or fake success.
export async function copyPrompt(text, nav = globalThis.navigator, env = globalThis) {
  try {
    if (typeof env.ClipboardItem === 'function' && typeof nav?.clipboard?.write === 'function') {
      const data = text.then(value => new env.Blob([value], { type: 'text/plain' }));
      // A permission refusal may precede the read; its rejected data still has an observer.
      data.catch(() => {});
      await nav.clipboard.write([new env.ClipboardItem({ 'text/plain': data })]);
    } else {
      await nav.clipboard.writeText(await text);
    }
    return true;
  } catch { return false; }
}
const el = (tag, props = {}, ...children) => {
  const node = Object.assign(document.createElement(tag), props); node.append(...children); return node;
};

export class OnboardingPrompt {
  constructor({ button, read, reader, copier = copyPrompt, menuItems = null }) {
    Object.assign(this, { button, read, reader, copier, menuItems });
    this.serial = 0; this.variant = null;
    this.dialog = el('dialog', { id: 'onboarding-sheet', className: 'onboarding-sheet' });
    this.dialog.setAttribute('aria-labelledby', 'onboarding-title');
    this.closeButton = el('button', { type: 'button', textContent: 'Close', id: 'onboarding-close' });
    this.closeButton.onclick = () => this.close();
    this.choices = el('div', { className: 'state-chips' });
    this.choices.setAttribute('role', 'group'); this.choices.setAttribute('aria-label', 'Choose your agent');
    for (const [variant, title] of [['codex', 'Codex'], ['claude', 'Claude']]) {
      const choice = el('button', { type: 'button', className: 'choice-chip', textContent: title, id: 'onboarding-' + variant });
      choice.onclick = () => this.copy(variant); this.choices.append(choice);
    }
    this.state = el('p', { id: 'onboarding-state' }); this.state.setAttribute('role', 'status');
    this.text = el('textarea', { id: 'onboarding-text', readOnly: true, hidden: true });
    this.text.setAttribute('aria-label', 'Onboarding prompt');
    this.retry = el('button', { id: 'onboarding-retry', type: 'button', textContent: 'Retry copy', hidden: true });
    this.retry.onclick = () => this.copy(this.variant);
    this.dialog.append(el('div', { className: 'onboarding-head' }, el('h2', { id: 'onboarding-title', textContent: 'Onboarding prompt' }), this.closeButton),
      this.choices, this.state, this.text, this.retry);
    this.toast = el('p', { id: 'onboarding-toast', className: 'onboarding-toast', hidden: true }); this.toast.setAttribute('role', 'status');
    this.dialog.append(this.toast); document.body.append(this.dialog);
    this.dialog.addEventListener('cancel', event => { event.preventDefault(); this.close(); });
    this.dialog.addEventListener('close', () => this.clear());
    this.dialog.addEventListener('pointerdown', event => { this.outside = event.target === this.dialog && this.outsideBox(event); });
    this.dialog.addEventListener('click', event => { if (this.outside && event.target === this.dialog && this.outsideBox(event)) this.close(); this.outside = false; });
    button.onclick = () => {
      if (menuItems ? !this.workspace : !owns(this.workspace, reader)) return;
      this.menu = openMessageMenu({ anchor: button, label: 'This outcome', sheet: true,
        items: menuItems ? menuItems(this.workspace) : [{ label: 'Onboarding prompt…', glyph: 'quote', act: () => this.open() }] });
    };
  }
  outsideBox(event) {
    const box = this.dialog.getBoundingClientRect();
    return event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom;
  }
  paint(workspace) {
    this.workspace = workspace; this.button.hidden = this.menuItems ? !workspace : !owns(workspace, this.reader);
    if (!owns(workspace, this.reader)) { this.menu?.close(false); this.menu = null; }
    if (this.dialog.open && !owns(workspace, this.reader)) this.close();
  }
  clear() {
    this.serial++; this.text.value = ''; this.text.hidden = true; this.state.textContent = '';
    this.retry.hidden = true; this.toast.hidden = true; this.variant = null;
  }
  close() { this.clear(); this.dialog.close(); this.button.focus(); }
  open() {
    if (!owns(this.workspace, this.reader)) return;
    this.clear(); this.state.textContent = 'Choose Codex or Claude to copy the current prompt.';
    this.dialog.showModal(); this.choices.children[0].focus();
  }
  async copy(variant) {
    if (!owns(this.workspace, this.reader) || !this.dialog.open || !['codex', 'claude'].includes(variant)) return;
    const serial = ++this.serial, workspace = this.workspace.id;
    this.variant = variant; this.toast.hidden = true; this.text.value = ''; this.text.hidden = true;
    this.retry.hidden = true; this.state.textContent = 'Reading the current prompt…';
    const current = () => serial === this.serial && this.dialog.open && owns(this.workspace, this.reader) && this.workspace.id === workspace;
    const text = Promise.resolve().then(() => this.read('onboarding_prompt', { workspace_id: workspace, variant })).then(answer => {
      if (!current() || answer?.workspace_id !== workspace || answer.variant !== variant || typeof answer.prompt !== 'string' || !answer.prompt) throw Error('Unavailable');
      return answer.prompt;
    });
    const copying = this.copier(text).catch(() => false);
    let prompt;
    try { prompt = await text; }
    catch {
      await copying;
      if (current()) { this.state.textContent = READ_FAILED; this.retry.textContent = 'Try again'; this.retry.hidden = false; }
      return;
    }
    if (!current()) return;
    this.text.value = prompt; this.text.hidden = false;
    this.state.textContent = 'Copying…';
    const copied = await copying;
    if (!current()) return;
    this.state.textContent = copied ? COPIED : COPY_FAILED;
    this.retry.textContent = copied ? 'Copy current prompt' : 'Retry copy'; this.retry.hidden = false;
    if (copied) { this.toast.textContent = COPIED; this.toast.hidden = false; }
    else { this.text.focus(); this.text.select(); }
  }
}

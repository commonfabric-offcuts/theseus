import { AGENT_PALETTE } from './author-colors.mjs';
import { outcomeColors } from './outcome-colors.mjs';

// The title's small, non-modal strip. The colors themselves come from Core's
// personal projection; this control owns only disclosure, focus and feedback.
export class OutcomeColorPicker {
  constructor({ title, api, bootstrap, workspaceId, current = () => true }) {
    Object.assign(this, { api, bootstrap, workspaceId, current });
    this.doc = title.ownerDocument; this.disposed = false; this.busy = false;
    outcomeColors.bind({ api, bootstrap });
    this.root = this.doc.createElement('span'); this.root.className = 'outcome-color-control'; this.root.hidden = true;
    this.trigger = this.doc.createElement('button'); this.trigger.type = 'button'; this.trigger.className = 'outcome-color-trigger';
    this.trigger.setAttribute('aria-label', 'Color for this outcome'); this.trigger.title = 'Color for this outcome';
    this.trigger.setAttribute('aria-haspopup', 'dialog'); this.trigger.setAttribute('aria-expanded', 'false');
    this.trigger.onclick = () => this.strip ? this.close(true) : this.open();
    this.root.append(this.trigger); title.after(this.root);
    this.unlisten = outcomeColors.listen(id => { if (id === workspaceId) this.paintChoice(); });
  }
  paint(workspace) {
    if (this.disposed) return;
    if (!workspace) { this.root.hidden = true; this.close(false); return; }
    if (workspace.id !== this.workspaceId) throw Error('The outcome color belongs to another outcome.');
    outcomeColors.accept(workspace); this.root.hidden = false; this.paintChoice();
  }
  paintChoice() {
    if (this.disposed) return;
    const choice = outcomeColors.get(this.workspaceId); if (!choice) return;
    this.trigger.dataset.color = choice.color ?? '';
    for (const button of this.buttons ?? []) button.setAttribute('aria-pressed', String((button.dataset.color || null) === choice.color));
  }
  open() {
    if (this.disposed || !this.current() || !outcomeColors.get(this.workspaceId)) return;
    const strip = this.strip = this.doc.createElement('span'); strip.className = 'outcome-color-strip';
    strip.setAttribute('role', 'dialog'); strip.setAttribute('aria-label', 'Outcome color');
    this.buttons = [null, ...AGENT_PALETTE].map(color => {
      const button = this.doc.createElement('button'); button.type = 'button'; button.dataset.color = color ?? '';
      const label = color ? color[0].toUpperCase() + color.slice(1) : 'No color';
      button.setAttribute('aria-label', label); button.title = label;
      // Safari gives a pointer press's focus to the page, not the button.
      // Keep it on the pressed swatch until click; cancel mousedown rather
      // than pointerdown so a touch still produces its native click.
      button.addEventListener('mousedown', event => { event.preventDefault(); button.focus({ preventScroll: true }); });
      button.onclick = () => this.choose(color); strip.append(button); return button;
    });
    this.notice = this.doc.createElement('span'); this.notice.className = 'outcome-color-notice'; this.notice.hidden = true;
    this.notice.setAttribute('role', 'status'); this.root.append(strip, this.notice);
    this.trigger.setAttribute('aria-expanded', 'true'); this.paintChoice();
    strip.addEventListener('keydown', event => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); this.close(true); return; }
      const step = { ArrowLeft: -1, ArrowUp: -1, ArrowRight: 1, ArrowDown: 1, Home: -Infinity, End: Infinity }[event.key];
      if (step === undefined) return;
      event.preventDefault(); event.stopPropagation();
      const at = this.buttons.indexOf(this.doc.activeElement);
      this.buttons[Math.max(0, Math.min(this.buttons.length - 1, at + step))].focus();
    });
    this.outside = event => { if (!this.root.contains(event.target)) this.close(false); };
    this.doc.addEventListener('pointerdown', this.outside, true);
    // During pointer focus transfer activeElement is briefly body. Wait for
    // the destination's focusin, so we never remove a swatch before its click.
    this.doc.addEventListener('focusin', this.outside, true);
    this.buttons.find(button => button.getAttribute('aria-pressed') === 'true')?.focus();
  }
  async choose(color) {
    if (this.busy || this.disposed || !this.current()) return;
    this.busy = true; const strip = this.strip; this.notice.hidden = true; strip?.setAttribute('aria-busy', 'true');
    try {
      const receipt = await outcomeColors.choose(this.workspaceId, color);
      if (this.disposed || !this.current()) return;
      if (receipt.status === 'committed') { if (this.strip === strip) this.close(true); return; }
      if (receipt.error?.code === 'REVISION_CONFLICT') {
        const answer = await this.api.view('workspace', { workspace_id: this.workspaceId }, { readClass: 'foreground' });
        if (this.disposed || !this.current()) return;
        if (answer?.instance_id !== this.bootstrap.instance_id || answer?.workspace?.id !== this.workspaceId) throw Error('The outcome could not be reread.');
        this.paint(answer.workspace);
      }
      if (receipt.error?.code === 'FORBIDDEN') this.paint(null);
      throw Error(receipt.error?.message ?? 'The color save was not confirmed. Try again.');
    } catch (error) {
      if (!this.disposed && this.current() && this.strip === strip) {
        this.notice.textContent = error.message; this.notice.hidden = false;
      }
    } finally { this.busy = false; strip?.removeAttribute('aria-busy'); }
  }
  close(restore) {
    this.doc.removeEventListener('pointerdown', this.outside, true);
    this.doc.removeEventListener('focusin', this.outside, true);
    this.strip?.remove(); this.notice?.remove(); this.strip = null; this.notice = null; this.buttons = [];
    this.trigger.setAttribute('aria-expanded', 'false');
    if (restore && !this.disposed && this.current()) this.trigger.focus();
  }
  dispose() { this.disposed = true; this.close(false); this.unlisten?.(); this.root.remove(); }
}

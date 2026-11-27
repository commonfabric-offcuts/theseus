// The existing Dim painter/gestures, with Core synchronization in1004.
import { DimChoices, valid } from './dim-choices.mjs';
import { DimmingSync } from './dimming-sync.mjs';

export class RailDimming {
  constructor({ host, storage, enabled = () => true, doc = host.ownerDocument }) {
    Object.assign(this, { host, doc, enabled }); this.choices = new DimChoices(storage); this.press = null;
    this.sync = new DimmingSync({ choices:this.choices, storage, visible:()=>this.doc.visibilityState!=='hidden', changed:()=>this.paint() });
    // Capture only Option name/topic presses. Command/Control and every
    // other control keep the existing browser or navigation/menu owner.
    host.addEventListener('pointerdown', event => {
      const row = this.target(event.target);
      this.press = row && event.button === 0 && event.altKey && !event.metaKey && !event.ctrlKey ? { ...row, done: false } : null;
    }, true);
    host.addEventListener('pointercancel', () => { this.press = null; }, true);
    host.addEventListener('keydown', () => { this.press = null; }, true);
    host.addEventListener('click', event => {
      if (event.button === 0 && event.detail > 0 && event.altKey && !event.metaKey && !event.ctrlKey) this.act(event);
    }, true);
    this.observer = new doc.defaultView.MutationObserver(() => {
      if (this.queued) return; this.queued = true;
      queueMicrotask(() => { this.queued = false; this.paintRows(); });
    });
    this.observer.observe(host, { childList: true, subtree: true, attributes: true, attributeFilter: ['aria-current','data-topic-id','data-workspace-id','data-only','data-waiting','data-cover-waiting','class'] });
    doc.defaultView.addEventListener?.('storage', event => {
      if (this.sync.key) return; // Core changes, not another tab's unconfirmed cache, drive this owner.
      if (this.choices.key && (event.key === this.choices.key || event.key === null)) { this.choices.refresh(); this.paint(); }
    });
    doc.defaultView.addEventListener?.('online',()=>{ if(this.sync.key)this.sync.retry(); });
    doc.defaultView.addEventListener?.('focus',()=>{ if(this.sync.key)this.sync.activate(); });
    doc.addEventListener?.('visibilitychange',()=>{ if(this.sync.key&&this.doc.visibilityState!=='hidden')this.sync.activate(); });
  }
  bind(instance, actor, handles = null) {
    if (handles?.api && handles.bootstrap?.authority) this.sync.connect(handles);
    else { this.sync.disconnect(); this.choices.bind(instance,actor); this.paint(); }
  }
  target(target) {
    const row = target?.closest?.('a.ol-name[data-workspace-id], a.nav-item[data-topic-id]');
    if (!row || !this.host.contains(row) || row.closest('[inert]')) return null;
    const workspace = row.closest('.ol-outcome')?.dataset.workspaceId;
    return valid(workspace) ? { row, workspace, topic: row.dataset.topicId ?? null } : null;
  }
  act(event) {
    const target = this.target(event.target);
    if (!target || !this.enabled() || !this.choices.key) return;
    event.preventDefault(); event.stopPropagation();
    if (this.press?.row === target.row && this.press.done) return;
    if (this.press?.row === target.row) this.press.done = true;
    this.toggle(target.row,event.shiftKey);
  }
  dimmed(row) {
    const target = this.target(row);
    return target && this.enabled() && this.choices.key ? this.choices.dimmed(target.workspace,target.topic) : null;
  }
  toggle(row, inverse = false) {
    const target = this.target(row);
    if (!target || !this.enabled() || !this.choices.key) return false;
    const changed = this.choices.toggle(target.workspace,target.topic,inverse); this.paint(); return changed;
  }
  paintRows() {
    if (!this.enabled() || !this.choices.key) return;
    const waiting = this.host.dataset.only === 'waiting';
    for (const li of this.host.querySelectorAll('.ol-outcome')) {
      const workspace = li.dataset.workspaceId;
      li.dataset.dimmed = String(this.choices.dimmed(workspace) || waiting && !li.hasAttribute('data-waiting'));
      for (const row of li.querySelectorAll('a.nav-item[data-topic-id]')) {
        const matches = row.hasAttribute('data-cover-waiting') || Boolean(row.querySelector('.topic-state.mine'));
        // A reader wait temporarily wakes a saved dim choice; clearing it restores that choice (1003).
        row.dataset.dimmed = String(!matches && (this.choices.dimmed(workspace,row.dataset.topicId) || waiting));
      }
    }
  }
  paint() {
    if (!this.enabled() || !this.choices.key) return;
    const foot = this.doc.getElementById('rail')?.querySelector('.rail-foot');
    if (foot) {
      let group = foot.querySelector('.rail-dim');
      if (!group) {
        group = this.doc.createElement('span'); group.className = 'rail-dim'; group.setAttribute('role','group'); group.setAttribute('aria-label','Dim view');
        const label = this.doc.createElement('span'); label.textContent = 'Dim'; group.append(label);
        for (const choice of [0,1,2]) {
          const button = this.doc.createElement('button'); button.type = 'button'; button.textContent = String(choice); button.dataset.dimSet = String(choice);
          button.setAttribute('aria-label', choice ? `Dim view ${choice}` : 'Show all rows');
          group.append(button);
        }
        const density = foot.querySelector('.rail-density'); if (density) density.after(group); else foot.append(group);
      }
      group.title = this.sync.key ? this.sync.status : this.choices.kept ? 'Dim views are kept in this browser' : 'This browser could not keep dim views; they last for this page';
      // In-place navigation restores listener-free footer copies (901).
      for (const button of group.querySelectorAll('button[data-dim-set]')) {
        const choice = Number(button.dataset.dimSet);
        button.onclick = () => { this.choices.select(choice); this.paint(); };
        button.setAttribute('aria-pressed',String(choice === this.choices.selected));
      }
      let retry = group.querySelector('.rail-dim-retry');
      if (this.sync.key && this.sync.error) {
        if (!retry) { retry=this.doc.createElement('button');retry.type='button';retry.className='rail-dim-retry';group.append(retry); }
        retry.textContent='Retry';retry.setAttribute('aria-label',this.sync.pending?'Retry Dim save':'Refresh Dim choices');
        retry.title=this.sync.status;retry.onclick=()=>this.sync.retry();
      } else retry?.remove();
    }
    this.paintRows();
  }
}

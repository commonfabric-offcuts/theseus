// Browser-local dim views (973). No topic read, Core write or timer.
const valid = id => typeof id === 'string' && id.length > 0 && [...id].length <= 200 && !/[\x00-\x1f]/.test(id);
const empty = () => ({ focus: null, outcomes: [], topics: [] });
const fresh = () => ({ version: 1, selected: 0, sets: [empty(), empty()] });
const LIMIT = 2048;
export const dimmingKey = (instance, actor) => `aim-next.rail-dimming.v1:${JSON.stringify([instance, actor])}`;
function decode(raw) {
  const value = JSON.parse(raw);
  if (!value || value.version !== 1 || ![0,1,2].includes(value.selected) || !Array.isArray(value.sets) || value.sets.length !== 2) throw Error('Invalid dim views');
  for (const set of value.sets) {
    if (!set || !(set.focus === null || Array.isArray(set.focus) && set.focus.length === 2 && valid(set.focus[0]) && (set.focus[1] === null || valid(set.focus[1])))) throw Error('Invalid focus');
    for (const [name, count] of [['outcomes',2],['topics',3]]) {
      const entries = set[name], ids = new Set();
      if (!Array.isArray(entries) || entries.length > LIMIT) throw Error('Invalid choices');
      for (const row of entries) {
        if (!Array.isArray(row) || row.length !== count || !row.slice(0,-1).every(valid) || typeof row.at(-1) !== 'boolean') throw Error('Invalid choice');
        const key = JSON.stringify(row.slice(0,-1)); if (ids.has(key)) throw Error('Repeated choice'); ids.add(key);
      }
    }
  }
  return value;
}
export class DimChoices {
  constructor(storage = null) { this.storage = storage; this.key = null; this.value = fresh(); this.kept = Boolean(storage); }
  get selected() { return this.value.selected; }
  bind(instance, actor) {
    if (!valid(instance) || !valid(actor)) { this.key = null; this.value = fresh(); return; }
    const key = dimmingKey(instance, actor);
    if (key === this.key) return;
    this.key = key; this.value = fresh(); this.refresh();
  }
  refresh() {
    if (!this.key) return;
    try { const raw = this.storage?.getItem(this.key); this.value = raw ? decode(raw) : fresh(); this.kept = Boolean(this.storage); }
    catch { this.value = fresh(); this.kept = false; }
  }
  keep() {
    try { if (!this.storage) throw Error('No storage'); this.storage.setItem(this.key, JSON.stringify(this.value)); this.kept = true; }
    catch { this.kept = false; }
  }
  select(choice) {
    if (!this.key || ![0,1,2].includes(choice)) return false;
    this.value.selected = choice; this.keep(); return true;
  }
  dimmed(workspace, topic = null) {
    if (!this.selected) return false;
    const set = this.value.sets[this.selected - 1];
    if (this.indexed !== set) {
      this.indexed = set; this.outcomes = new Map(set.outcomes); this.topics = new Map(set.topics.map(([w,t,on]) => [JSON.stringify([w,t]),on]));
    }
    if (topic !== null && this.topics.has(JSON.stringify([workspace,topic]))) return this.topics.get(JSON.stringify([workspace,topic]));
    if (this.outcomes.has(workspace)) return this.outcomes.get(workspace);
    return Boolean(set.focus && (workspace !== set.focus[0] || topic !== null && set.focus[1] !== null && topic !== set.focus[1]));
  }
  toggle(workspace, topic = null, inverse = false) {
    if (!this.key || !valid(workspace) || topic !== null && !valid(topic)) return false;
    if (!this.selected) this.value.selected = 1;
    const index = this.selected - 1, prior = this.value.sets[index];
    if (inverse) this.value.sets[index] = { focus: [workspace,topic], outcomes: [], topics: [] };
    else {
      const on = !this.dimmed(workspace,topic), next = { focus: prior.focus, outcomes: [...prior.outcomes], topics: [...prior.topics] };
      if (topic === null) {
        next.outcomes = next.outcomes.filter(([id]) => id !== workspace); next.outcomes.push([workspace,on]);
        next.topics = next.topics.filter(([id]) => id !== workspace);
      } else { next.topics = next.topics.filter(([w,t]) => w !== workspace || t !== topic); next.topics.push([workspace,topic,on]); }
      if (next.outcomes.length > LIMIT || next.topics.length > LIMIT) return false;
      this.value.sets[index] = next;
    }
    this.keep(); return true;
  }
}

export class RailDimming {
  constructor({ host, storage, enabled = () => true, doc = host.ownerDocument }) {
    Object.assign(this, { host, doc, enabled }); this.choices = new DimChoices(storage); this.press = null;
    // Capture only modified name/topic presses. Every other control and
    // ordinary link stays with its existing navigation/menu owner.
    host.addEventListener('pointerdown', event => {
      const row = this.target(event.target);
      this.press = row && event.button === 0 && !event.altKey && (event.metaKey || event.ctrlKey) ? { ...row, ctrl: event.ctrlKey, done: false } : null;
    }, true);
    host.addEventListener('pointercancel', () => { this.press = null; }, true);
    host.addEventListener('keydown', () => { this.press = null; }, true);
    host.addEventListener('click', event => {
      if (event.button === 0 && event.detail > 0 && (event.metaKey || event.ctrlKey) && !event.altKey) this.act(event);
    }, true);
    // macOS Control-click may be a contextmenu without a click. One native
    // press is one toggle, even in an engine which emits both events.
    host.addEventListener('contextmenu', event => { if (this.press?.ctrl) this.act(event); }, true);
    this.observer = new doc.defaultView.MutationObserver(() => {
      if (this.queued) return; this.queued = true;
      queueMicrotask(() => { this.queued = false; this.paintRows(); });
    });
    this.observer.observe(host, { childList: true, subtree: true, attributes: true, attributeFilter: ['aria-current','data-topic-id','data-workspace-id'] });
    doc.defaultView.addEventListener?.('storage', event => {
      if (this.choices.key && (event.key === this.choices.key || event.key === null)) { this.choices.refresh(); this.paint(); }
    });
  }
  bind(instance, actor) { this.choices.bind(instance,actor); this.paint(); }
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
    this.choices.toggle(target.workspace,target.topic,event.shiftKey); this.paint();
  }
  paintRows() {
    if (!this.enabled() || !this.choices.key) return;
    for (const li of this.host.querySelectorAll('.ol-outcome')) {
      const workspace = li.dataset.workspaceId; li.dataset.dimmed = String(this.choices.dimmed(workspace));
      for (const row of li.querySelectorAll('a.nav-item[data-topic-id]')) row.dataset.dimmed = String(this.choices.dimmed(workspace,row.dataset.topicId));
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
      group.title = this.choices.kept ? 'Dim views are kept in this browser' : 'This browser could not keep dim views; they last for this page';
      // In-place navigation restores listener-free footer copies (901).
      for (const button of group.querySelectorAll('button')) {
        const choice = Number(button.dataset.dimSet);
        button.onclick = () => { this.choices.select(choice); this.paint(); };
        button.setAttribute('aria-pressed',String(choice === this.choices.selected));
      }
    }
    this.paintRows();
  }
}

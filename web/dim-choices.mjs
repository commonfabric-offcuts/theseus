// Dim state and semantic edits (973/1004); no network or timers.
export const valid = id => typeof id === 'string' && id.length > 0 && [...id].length <= 200 && !/[\x00-\x1f]/.test(id);
const empty = () => ({ focus: null, outcomes: [], topics: [] });
export const freshDimming = () => ({ version: 1, selected: 0, sets: [empty(), empty()] });
// Only the retired browser-only973 format has a local default. Core mode uses
// the backend capability for decoding and every semantic edit.
const LEGACY_LIMIT = 2048;
export const dimmingKey = (instance, actor) => `aim-next.rail-dimming.v1:${JSON.stringify([instance, actor])}`;
export function decodeDimming(raw, limit = LEGACY_LIMIT) {
  const value = JSON.parse(raw);
  if (!value || Object.keys(value).length !== 3 || value.version !== 1 || ![0,1,2].includes(value.selected) || !Array.isArray(value.sets) || value.sets.length !== 2) throw Error('Invalid dim views');
  for (const set of value.sets) {
    if (!set || Object.keys(set).length !== 3 || !(set.focus === null || Array.isArray(set.focus) && set.focus.length === 2 && valid(set.focus[0]) && (set.focus[1] === null || valid(set.focus[1])))) throw Error('Invalid focus');
    for (const [name, count] of [['outcomes',2],['topics',3]]) {
      const entries = set[name], ids = new Set();
      if (!Array.isArray(entries) || entries.length > limit) throw Error('Invalid choices');
      for (const row of entries) {
        if (!Array.isArray(row) || row.length !== count || !row.slice(0,-1).every(valid) || typeof row.at(-1) !== 'boolean') throw Error('Invalid choice');
        const key = JSON.stringify(row.slice(0,-1)); if (ids.has(key)) throw Error('Repeated choice'); ids.add(key);
      }
    }
  }
  return value;
}
export class DimChoices {
  constructor(storage = null) { this.storage = storage; this.limit = LEGACY_LIMIT; this.key = null; this.value = freshDimming(); this.kept = Boolean(storage); }
  get selected() { return this.value.selected; }
  bind(instance, actor) {
    if (!valid(instance) || !valid(actor)) { this.key = null; this.value = freshDimming(); return; }
    const key = dimmingKey(instance, actor);
    if (key === this.key) return;
    this.key = key; this.value = freshDimming(); this.refresh();
  }
  refresh() {
    if (!this.key) return;
    try { const raw = this.storage?.getItem(this.key); this.value = raw ? decodeDimming(raw) : freshDimming(); this.kept = Boolean(this.storage); }
    catch { this.value = freshDimming(); this.kept = false; }
  }
  keep(intent) {
    if (this.syncEdit) { this.syncEdit(intent); return; }
    try { if (!this.storage) throw Error('No storage'); this.storage.setItem(this.key, JSON.stringify(this.value)); this.kept = true; }
    catch { this.kept = false; }
  }
  select(choice) {
    if (!this.key || ![0,1,2].includes(choice)) return false;
    const intent = { kind: 'select', selected: choice };
    this.value = applyDimIntent(this.value, intent, this.limit); this.keep(intent); return true;
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
    const intent = { kind: inverse ? 'inverse' : 'choice', set: this.selected || 1, workspace, topic,
      ...(inverse ? {} : { on: !this.dimmed(workspace, topic) }) };
    const next = applyDimIntent(this.value, intent, this.limit); if (!next) return false;
    this.value = next; this.keep(intent); return true;
  }
}

// Absolute edits replay over a newer Core snapshot without reverting other
// device choices. Inverse intentionally replaces only the selected view.
export function applyDimIntent(value, intent, limit = LEGACY_LIMIT) {
  if (!intent || typeof intent !== 'object') return null;
  if (intent.kind === 'select') return [0,1,2].includes(intent.selected) && Object.keys(intent).length === 2 ? { ...value, selected: intent.selected } : null;
  if (!['choice','inverse'].includes(intent.kind) || ![1,2].includes(intent.set) || !valid(intent.workspace) ||
      !(intent.topic === null || valid(intent.topic)) || Object.keys(intent).length !== (intent.kind === 'choice' ? 5 : 4) ||
      intent.kind === 'choice' && typeof intent.on !== 'boolean') return null;
  const prior = value.sets[intent.set - 1], { workspace, topic } = intent;
  let next;
  if (intent.kind === 'inverse') next = { focus: [workspace, topic], outcomes: [], topics: [] };
  else {
    next = { focus: prior.focus, outcomes: [...prior.outcomes], topics: [...prior.topics] };
    if (topic === null) {
      next.outcomes = next.outcomes.filter(([id]) => id !== workspace); next.outcomes.push([workspace, intent.on]);
      next.topics = next.topics.filter(([id]) => id !== workspace);
    } else { next.topics = next.topics.filter(([w,t]) => w !== workspace || t !== topic); next.topics.push([workspace, topic, intent.on]); }
    if (next.outcomes.length > limit || next.topics.length > limit) return null;
  }
  return { ...value, selected: intent.set, sets: value.sets.map((set, index) => index === intent.set - 1 ? next : set) };
}

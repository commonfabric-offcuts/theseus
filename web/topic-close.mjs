import { topicFieldFences, topicUpdateEnvelope } from './topic-state.mjs';
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
export const closesTopic = envelope => envelope?.kind === 'topic.update' && (envelope.args?.archived === true || envelope.args?.state === 'done');
const pending = row => ['pending', 'uncertain', 'undo_pending'].includes(row.phase);
export const TOPIC_CLOSE_UNDO_MS = 10 * 60 * 1000;
export class TopicCloseActions {
  constructor({ journal, binding, send, changed = () => {}, kept = () => {} }) {
    Object.assign(this, { journal, binding, send, changed, kept });
    this.rows = new Map(); this.flights = new Map(); this.changes = new Map();
  }
  current(row) { return row.instanceId === this.binding.instanceId && row.actor === this.binding.actor && same(row.authority, this.binding.authority); }
  canUndo(row, now = Date.now()) {
    if (!row || !this.current(row) || row.undo || !['pending', 'uncertain', 'committed'].includes(row.phase)) return false;
    // Legacy receipts never gain a fresh window just by being read again.
    const at = row.committedAt ?? row.at;
    return row.phase !== 'committed' || Number.isFinite(at) && now < at + TOPIC_CLOSE_UNDO_MS;
  }
  async load() {
    for (const row of [...await this.journal.list(), ...await this.journal.list(true)]) {
      this.rows.set(row.id, row); if (this.current(row)) this.changed(row);
    }
  }
  async sync(id) {
    const row = await this.journal.get(id);
    if (row) { this.rows.set(id, row); if (this.current(row)) this.changed(row); }
  }
  async remember(row, fresh = false) {
    const kept = await this.journal.put(row, fresh) ?? row; this.rows.set(kept.id, kept); this.changed(kept); return kept;
  }
  // Only a strictly completed local transaction admits drawing/departure/send.
  async act(topic, envelope, kept = this.kept, origin = null) {
    if (!closesTopic(envelope) || envelope.target.topic_id !== topic.id || topic.workspace_id == null ||
        envelope.instance_id !== this.binding.instanceId || !same(envelope.expected.authority, this.binding.authority)) throw Error('The topic action does not match this runtime.');
    const existing = [...this.rows.values()].find(row => this.current(row) && row.topic.id === topic.id && pending(row) && same(row.envelope.args, envelope.args));
    if (existing) { kept(existing); return this.drive(existing.id); }
    const row = { format: 1, id: envelope.operation_id, at: Date.now(), instanceId: this.binding.instanceId, actor: this.binding.actor,
      authority: structuredClone(this.binding.authority), workspaceId: topic.workspace_id, topic: structuredClone(topic),
      envelope: structuredClone(envelope), origin, phase: 'pending', receipt: null, undo: null, error: null };
    await this.remember(row, true); kept(row); return this.drive(row.id);
  }
  change(id, modify) {
    const task = (this.changes.get(id) ?? Promise.resolve()).catch(() => {}).then(async () => {
      const row = structuredClone(this.rows.get(id)); modify(row); return this.remember(row);
    });
    this.changes.set(id, task); task.finally(() => { if (this.changes.get(id) === task) this.changes.delete(id); }).catch(() => {}); return task;
  }
  async undo(id) {
    const row = this.rows.get(id);
    if (!row || !this.current(row) || ['rejected', 'undone'].includes(row.phase)) return;
    if (!row.undo && !this.canUndo(row)) return;
    await this.change(id, next => { next.undo ??= { id: crypto.randomUUID(), envelope: null, receipt: null }; });
    // A prior flight learns the kept Undo when its answer is processed.
    return this.drive(id);
  }
  drive(id) {
    if (this.flights.has(id)) return this.flights.get(id);
    const task = this.perform(id); this.flights.set(id, task);
    task.finally(() => this.flights.delete(id)).catch(() => {}); return task;
  }
  async perform(id) {
    let row = this.rows.get(id);
    if (!row || !this.current(row)) return null;
    if (['pending', 'uncertain'].includes(row.phase)) {
      const receipt = await this.attempt(row, row.envelope);
      if (!receipt) return null;
      await this.change(id, next => {
        next.receipt = receipt; next.phase = receipt.status === 'committed' ? 'committed' : 'rejected';
        if (receipt.status === 'committed') next.committedAt ??= Date.now();
        next.error = receipt.error?.message ?? null;
      });
    }
    row = this.rows.get(id);
    if (row.phase === 'committed' && row.undo && !row.undo.envelope) {
      const current = { ...row.topic, ...row.receipt.result, id: row.topic.id, state_note: row.receipt.result.note };
      const archived = row.envelope.args.archived === true;
      const args = archived ? { archived: row.topic.archived === true } :
        { state: row.topic.state, ...(row.topic.state === 'waiting' ? { waiting_on: row.topic.waiting_on ?? [] } : {}), keep_note: true };
      const bootstrap = { instance_id: row.instanceId, authority: row.authority };
      const fields = topicFieldFences(current, archived ? 'archived' : 'state');
      if (!archived && row.receipt.result.note !== (row.topic.state_note ?? '')) {
        args.note = row.topic.state_note ?? ''; delete args.keep_note; fields.note = row.receipt.result.note;
      }
      const envelope = topicUpdateEnvelope(bootstrap, current, args, fields, row.undo.id);
      await this.change(id, next => { next.undo.envelope = envelope; next.phase = 'undo_pending'; next.error = null; });
    }
    row = this.rows.get(id);
    if (row.phase === 'undo_pending') {
      const receipt = await this.attempt(row, row.undo.envelope);
      if (!receipt) return null;
      await this.change(id, next => { next.undo.receipt = receipt; next.phase = receipt.status === 'committed' ? 'undone' : 'committed'; next.error = receipt.error?.message ?? null; });
    }
    return this.rows.get(id).receipt;
  }
  async attempt(row, envelope) {
    try {
      const receipt = await this.send(envelope);
      if (receipt?.instance_id !== row.instanceId || receipt.operation_id !== envelope.operation_id || receipt.kind !== envelope.kind || receipt.recorded !== true ||
          !['committed', 'rejected'].includes(receipt.status) || receipt.status === 'committed' &&
          (receipt.result?.topic_id !== row.topic.id || !Number.isSafeInteger(receipt.result.version))) throw Error('The service did not confirm this topic action.');
      return receipt;
    } catch (error) {
      await this.change(row.id, next => { if (next.phase !== 'undo_pending') next.phase = 'uncertain'; next.error = error?.message ?? String(error); });
      return null;
    }
  }
  async resume() {
    const tried = new Set(); let cursor = null, batch;
    do {
      batch = await this.journal.list(true, 20, cursor);
      for (const row of batch) {
        if (tried.has(row.id)) throw Error('The saved-action page did not advance.');
        tried.add(row.id);
        if (!this.rows.has(row.id)) { this.rows.set(row.id, row); if (this.current(row)) this.changed(row); }
        if (this.current(row) && pending(this.rows.get(row.id))) await this.drive(row.id);
      }
      const last = batch.at(-1); if (last) cursor = { at: last.at, id: last.id };
    } while (batch.length === 20);
  }
}

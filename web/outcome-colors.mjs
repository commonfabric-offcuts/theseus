import { AGENT_PALETTE } from './author-colors.mjs';

// A visit's cache of the caller's choices, read with the existing outcome
// projections. Core owns the record; a late projection cannot undo a pick.
export function validOutcomeColor(row) {
  return Boolean(row && Number.isSafeInteger(row.color_revision) && row.color_revision >= 0 &&
    (row.color === null || AGENT_PALETTE.includes(row.color)));
}

export class OutcomeColors {
  constructor({ id = () => crypto.randomUUID() } = {}) {
    this.id = id; this.choices = new Map(); this.envelopes = new Map(); this.listeners = new Set(); this.key = null;
  }
  bind({ api, bootstrap }) {
    const { instance_id, actor, authority } = bootstrap;
    const key = JSON.stringify([instance_id, actor, authority?.authority_id, authority?.authority_epoch]);
    if (key !== this.key) { this.choices.clear(); this.envelopes.clear(); this.key = key; }
    this.api = api; this.bootstrap = bootstrap;
  }
  listen(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  emit(id) { for (const fn of [...this.listeners]) fn(id); }
  get(id) { return this.choices.get(id) ?? null; }
  accept(row, notify = false) {
    if (typeof row?.id !== 'string' || !validOutcomeColor(row)) throw Error('The outcome color could not be confirmed.');
    const old = this.get(row.id);
    if (old && old.color_revision > row.color_revision) return old;
    if (old && old.color_revision === row.color_revision && old.color !== row.color) throw Error('The outcome color revision disagrees.');
    const choice = { color: row.color, color_revision: row.color_revision };
    this.choices.set(row.id, choice);
    if (notify && (!old || old.color_revision !== choice.color_revision)) this.emit(row.id);
    return choice;
  }
  async choose(workspaceId, color) {
    if (!this.get(workspaceId) || !(color === null || AGENT_PALETTE.includes(color))) throw Error('Read the outcome color before choosing.');
    const session = this.key, { instance_id } = this.bootstrap;
    const { authority_id, authority_epoch } = this.bootstrap.authority;
    const name = JSON.stringify([workspaceId, color, this.get(workspaceId).color_revision]);
    if (!this.envelopes.has(name)) this.envelopes.set(name, {
      v: 1, instance_id, operation_id: this.id(), kind: 'outcome.color_set', target: { workspace_id: workspaceId },
      expected: { authority: { authority_id, authority_epoch }, color_revision: this.get(workspaceId).color_revision }, args: { color },
    });
    const envelope = structuredClone(this.envelopes.get(name)), receipt = await this.api.command(envelope);
    if (session !== this.key) throw Error('The outcome session changed. Read it again.');
    if (receipt?.instance_id !== instance_id || receipt.operation_id !== envelope.operation_id || receipt.kind !== envelope.kind)
      throw Error('The color save could not be confirmed. Try again.');
    if (receipt.status === 'committed') {
      const result = receipt.result;
      if (receipt.recorded !== true || result?.workspace_id !== workspaceId || result.color !== color || !validOutcomeColor(result) ||
          typeof result.changed !== 'boolean' || result.color_revision !== envelope.expected.color_revision + Number(result.changed)) throw Error('The color save could not be confirmed.');
      this.accept({ id: workspaceId, ...result }, true);
    }
    if (receipt.recorded === true) this.envelopes.delete(name);
    return receipt;
  }
}

export const outcomeColors = new OutcomeColors();

import { AGENT_PALETTE, agentColor } from './author-colors.mjs';

// The colors this reader chose for agents (docs/reading-colors.md, "Choosing
// an agent's color"), as Core keeps them: read with the colors view, changed
// with color.set. The page reads them when it opens and again whenever it is
// shown or focused, so a choice made on another device is there when the
// person comes back. Nothing here decides anything Core does not: a choice
// names a palette color or null, fenced on the revision last read.
const PAGE = 100;
const revision = value => Number.isSafeInteger(value) && value >= 0;

export class AgentColors {
  constructor({ api, instanceId, authority, id = () => crypto.randomUUID(), doc = globalThis.document, win = globalThis }) {
    if (!api || !instanceId || typeof authority !== 'function') throw Error('Agent colors need the instance and its authority.');
    Object.assign(this, { api, instanceId, authority, id });
    this.choices = new Map(); this.listeners = new Set(); this.palette = [...AGENT_PALETTE]; this.loaded = false; this.loading = null; this.again = false;
    const resume = () => { if (doc?.visibilityState !== 'hidden') this.load().catch(() => {}); };
    doc?.addEventListener?.('visibilitychange', resume); win?.addEventListener?.('focus', resume);
  }
  listen(listener) { this.listeners.add(listener); return () => this.listeners.delete(listener); }
  emit() { for (const listener of [...this.listeners]) listener(); }

  // The color an agent's cards wear for this reader: their choice, or the
  // agent's own.
  color(agentId) { return this.choices.get(agentId)?.color ?? agentColor(agentId); }
  chosen(agentId) { return this.choices.get(agentId)?.color ?? null; }

  // Every page of the reader's choices; a load asked for while one runs runs
  // once more after it. Rejects when the choices could not be read, and then
  // keeps what it had.
  load() {
    if (this.loading) { this.again = true; return this.loading; }
    this.loading = (async () => {
      do { this.again = false; await this.readAll(); } while (this.again);
    })().finally(() => { this.loading = null; });
    return this.loading;
  }
  async readAll() {
    const read = new Map();
    let cursor = null;
    do {
      const page = await this.api.view('colors', { limit: PAGE, ...(cursor === null ? {} : { cursor }) }, { readClass: 'background' });
      if (page?.instance_id !== this.instanceId || !Array.isArray(page.items) || !Array.isArray(page.palette) ||
          !(page.next_cursor === null || typeof page.next_cursor === 'string' && page.next_cursor > (cursor ?? ''))) throw Error('The agent colors could not be confirmed.');
      if (page.palette.some(name => !AGENT_PALETTE.includes(name))) throw Error('Core names a color this page cannot draw.');
      for (const item of page.items) {
        if (typeof item?.actor_id !== 'string' || !item.actor_id || !revision(item.color_revision) ||
            !(item.color === null || page.palette.includes(item.color))) throw Error('An agent color could not be confirmed.');
        read.set(item.actor_id, { color: item.color, revision: item.color_revision });
      }
      this.palette = [...page.palette];
      cursor = page.next_cursor;
    } while (cursor !== null);
    // A read may have been answered before a choice this page then committed:
    // each agent keeps the newer revision. Core never deletes a choice (the
    // agent's own is held as null), so an agent the read lacks is one it had
    // not seen yet.
    for (const [agent, choice] of read) if (!(this.choices.get(agent)?.revision > choice.revision)) this.choices.set(agent, choice);
    this.loaded = true;
    this.emit();
  }

  // Chooses color (a palette name, or null for the agent's own) for one agent.
  // Answers the receipt. A refusal for a stale revision means the choice
  // changed elsewhere: the page reads the choices again.
  async choose(agentId, color) {
    const { authority_id, authority_epoch } = this.authority() ?? {};
    const receipt = await this.api.command({ v: 1, instance_id: this.instanceId, operation_id: this.id(), kind: 'color.set',
      target: { actor_id: agentId }, expected: { authority: { authority_id, authority_epoch }, color_revision: this.choices.get(agentId)?.revision ?? 0 },
      args: { color } });
    if (receipt?.status === 'committed') {
      const result = receipt.result;
      this.choices.set(agentId, { color: result.color, revision: result.color_revision });
      this.emit();
    } else if (receipt?.error?.code === 'REVISION_CONFLICT') await this.load().catch(() => {});
    return receipt;
  }
}

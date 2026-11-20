// Read-only invalidation for the outcome page. Existing page/outline owners do
// the repaint; these cursors confer no authority and persist nowhere.
import { scopedChangesPage, supportsAdmission, readFailure } from './freshness.mjs';

export const outcomeReads = () => new Set(['workspace', 'team', 'standing', 'targets', 'tools', 'references', 'pipeline', 'outcomes', 'topics', 'stars', 'pages']);
export function outcomeInvalidation(workspace, actor) {
  const dirty = new Set(), add = (...names) => names.forEach(name => dirty.add(name));
  for (const item of workspace) {
    const kind = item.resource_kind;
    if (kind === 'workspace') return outcomeReads();
    if (kind === 'topic') add('topics', 'standing', 'targets', 'pipeline', 'outcomes');
    else if (kind === 'memory') add('references');
    else if (kind === 'checks') add('targets', 'standing');
    else if (kind === 'pipeline') add('pipeline', 'targets', 'topics', 'outcomes');
    else if (kind.startsWith('tool_')) add('tools');
    else return outcomeReads(); // A new public key is conservatively reread.
  }
  for (const item of actor) {
    const kind = item.resource_kind;
    if (kind === 'workspace' || kind === 'participation') return outcomeReads();
    if (['waiting', 'delivery', 'mark'].includes(kind)) add('outcomes', 'topics', 'standing');
    if (kind === 'outcome_order') add('outcomes');
    if (kind === 'topic_order') add('topics');
    if (['acts', 'dossier_move', 'edit'].includes(kind)) add('stars');
    if (kind === 'memory_star') add('pages');
    if (kind === 'memory_read') add('references', 'pages');
    // Drafts, preparations and other private writing do not change these lists.
  }
  return dirty;
}

export class OutcomeChanges {
  constructor({ api, bootstrap, workspaceId, current = () => true }) {
    Object.assign(this, { api, bootstrap, current });
    this.scopes = [{ kind: 'workspace', id: workspaceId }, { kind: 'actor', id: bootstrap.actor }];
    this.cursors = null; this.listeners = new Set();
    this.enabled = supportsAdmission(bootstrap);
  }
  listen(listener) { this.listeners.add(listener); return () => this.listeners.delete(listener); }
  async notify(dirty) { return (await Promise.all([...this.listeners].map(listener => listener(dirty)))).every(value => value !== false); }
  async read(scope, input = null) {
    return scopedChangesPage(await this.api.view('changes', { scope, limit: 50, ...(input ? { cursor: input } : {}) }, { readClass: 'foreground' }), this.bootstrap, scope, input);
  }
  async baseline() {
    if (!this.enabled) return false;
    const pages = await Promise.all(this.scopes.map(scope => this.read(scope)));
    if (!this.current()) return false;
    this.cursors = pages.map(page => structuredClone(page.checkpoint));
    return true;
  }
  // A completed window is accepted only after every affected view succeeded.
  // Failure keeps the prior checkpoints, so retry cannot skip a dirty list.
  async next() {
    if (!this.enabled) return { dirty: outcomeReads(), accept() {} };
    if (!this.cursors) { await this.baseline(); return { dirty: outcomeReads(), accept() {} }; }
    const cursors = [], items = [];
    try {
      for (const [index, scope] of this.scopes.entries()) {
        let input = this.cursors[index], keys = [], page;
        do {
          page = await this.read(scope, input);
          if (!this.current()) return { dirty: new Set(), accept() {} };
          keys.push(...page.items); input = page.continuation;
        } while (page.has_more);
        cursors.push(structuredClone(page.checkpoint)); items.push(keys);
      }
    } catch (error) {
      if (readFailure(error).kind === 'resync') this.cursors = null;
      throw error;
    }
    return { dirty: outcomeInvalidation(...items), accept: () => { if (this.current()) this.cursors = cursors; } };
  }
}

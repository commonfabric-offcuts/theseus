// Read-only sidebar invalidation. Every scope/page is still authorized by Core.
import { scopedChangesPage, supportsAdmission, readFailure } from './freshness.mjs';

const names = ['outcomes', 'topics', 'counts', 'stars', 'pages'];
// The existing reload coalescer unions categories. Keep their target sets too;
// an unscoped caller always wins over a narrower target set.
export function mergeSidebarDirty(pending, dirty) {
  for (const name of dirty) pending.add(name);
  pending.sidebar = (pending.sidebar ?? true) && Boolean(dirty.sidebar);
  for (const key of ['topicWorkspaces', 'starTopics', 'pageTopics']) {
    if (!Object.hasOwn(pending, key)) pending[key] = dirty[key] ? new Set(dirty[key]) : null;
    else if (!dirty[key]) pending[key] = null;
    else if (pending[key]) for (const id of dirty[key]) pending[key].add(id);
  }
  return pending;
}
export function sidebarInvalidation(windows, context) {
  const dirty = new Set(); dirty.sidebar = true;
  dirty.topicWorkspaces = new Set(); dirty.starTopics = new Set(); dirty.pageTopics = new Set();
  const all = () => { names.forEach(name => dirty.add(name)); dirty.topicWorkspaces = dirty.starTopics = dirty.pageTopics = null; return dirty; };
  const stars = topic => {
    const ids = topic ? [topic] : context.starredTopics;
    for (const id of ids) if (context.starredTopics.has(id)) { dirty.add('stars'); dirty.starTopics?.add(id); }
  };
  const topic = (id, workspace = context.topics.get(id)) => {
    dirty.add('topics'); dirty.add('counts');
    if (workspace) dirty.topicWorkspaces?.add(workspace); else dirty.topicWorkspaces = null;
    stars(id);
  };
  const page = id => {
    for (const [topicId, pages] of context.pages) if (pages.has(id)) { dirty.add('pages'); dirty.pageTopics?.add(topicId); }
  };
  for (const { scope, items } of windows) for (const item of items) {
    const kind = item.resource_kind, id = item.resource_id;
    if (scope.kind === 'actor') {
      if (['workspace', 'participation'].includes(kind)) return all();
      if (kind === 'outcome_order') dirty.add('outcomes');
      else if (kind === 'outcome_color') dirty.add('counts');
      else if (kind === 'topic_order') { dirty.add('topics'); dirty.topicWorkspaces?.add(id); }
      else if (['acts', 'dossier_move'].includes(kind)) { dirty.add('stars'); dirty.add('counts'); dirty.starTopics?.add(id); }
      else if (kind === 'memory_star') { dirty.add('pages'); dirty.pageTopics = null; }
      else if (kind === 'memory_read') page(id);
      else if (['delivery', 'waiting', 'mark', 'whisper'].includes(kind)) {
        dirty.add('counts'); topic(id); stars(context.topics.has(id) ? id : null);
      } else if (['source_cover', 'source_cover_read'].includes(kind)) { topic(id); stars(); }
      else if (['edit', 'withdrawal', 'removal', 'reaction', 'question'].includes(kind)) stars();
      else if (!['draft', 'note', 'submission', 'yours', 'edit_session', 'media', 'opening', 'color', 'assessment', 'rail_dimming', 'agent_execution', 'hosted_seat'].includes(kind)) return all();
      // Known private writing/session facts do not change outline projections.
    } else if (kind === 'workspace') return all();
    else if (kind === 'topic') topic(id, scope.kind === 'workspace' ? scope.id : context.topics.get(id));
    else if (kind === 'pipeline') { dirty.add('topics'); dirty.add('counts'); dirty.topicWorkspaces?.add(scope.id); }
    else if (kind === 'memory') page(id);
    else if (kind === 'checks') dirty.add('counts');
    else if (!kind.startsWith('tool_') && kind !== 'workspace_link' && kind !== 'hosted_seat') return all();
  }
  return dirty;
}

export class SidebarChanges {
  constructor({ bootstrap, read, current, context, outcomesKey = null }) {
    Object.assign(this, { bootstrap, readView: read, current, context, outcomesKey });
    this.enabled = supportsAdmission(bootstrap); this.cursors = new Map(); this.readOutcomesKey = outcomesKey;
  }
  observe(event) { if (typeof event.outcomes === 'string') this.outcomesKey = event.outcomes; }
  hasNewScopes() { return this.enabled && this.context().scopes.some(scope => !this.cursors.has(JSON.stringify(scope))); }
  async next() {
    if (!this.enabled) return { dirty: null, accept() {} };
    const context = this.context(), scopes = [{ kind: 'actor', id: this.bootstrap.actor }, ...context.scopes];
    const unique = [...new Map(scopes.map(scope => [JSON.stringify(scope), scope])).values()];
    const checkpoints = new Map(), windows = []; let baseline = false;
    try {
      for (const scope of unique) {
        const key = JSON.stringify(scope); let cursor = this.cursors.get(key), page; const items = [];
        baseline ||= !cursor;
        do {
          const answer = await this.readView('changes', { scope, limit: 50, ...(cursor ? { cursor } : {}) }, 'background');
          if (!this.current()) return { dirty: new Set(), accept() {} };
          page = scopedChangesPage(answer, this.bootstrap, scope, cursor ?? null);
          items.push(...page.items); cursor = page.continuation;
        } while (page.has_more);
        checkpoints.set(key, structuredClone(page.checkpoint)); windows.push({ scope, items });
      }
    } catch (error) {
      if (readFailure(error).kind === 'resync') this.cursors.clear();
      throw error;
    }
    const outcomesKey = this.outcomesKey, dirty = baseline ? null : sidebarInvalidation(windows, context);
    if (dirty && outcomesKey !== this.readOutcomesKey) dirty.add('outcomes');
    return { dirty, accept: () => { if (this.current()) { this.cursors = checkpoints; this.readOutcomesKey = outcomesKey; } } };
  }
}

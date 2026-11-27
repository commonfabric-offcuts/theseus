// Secondary topic projections. Resource keys are authorized by changes; a
// local command name never proves that another recorded consequence is absent.
import { scopedChangesPage, supportsAdmission, readFailure, bindingOf } from './freshness.mjs';

export const recordedReads = () => new Set(['pipeline', 'topics', 'conversation', 'marks', 'unread', 'read', 'shown', 'wakes', 'participants']);

export function recordedInvalidation(windows) {
  const dirty = new Set(), add = (...names) => names.forEach(name => dirty.add(name));
  const all = () => {
    const names = recordedReads();
    if (windows.some(({ items }) => items.some(item => item.resource_kind === 'hosted_seat'))) names.add('seatPeople');
    return names;
  };
  for (const { scope, items } of windows) for (const { resource_kind: kind } of items) {
    if (scope.kind === 'actor') {
      if (['workspace', 'participation'].includes(kind)) return all();
      if (['draft', 'submission', 'note', 'edit_session', 'yours', 'media', 'opening', 'color', 'assessment', 'rail_dimming', 'reaction', 'edit'].includes(kind)) continue;
      if (kind === 'memory_read') add('read', 'shown');
      else if (kind === 'memory_star' || kind === 'outcome_order' || kind === 'outcome_color') continue; // Shell owns these projections.
      else if (kind === 'topic_order') add('topics');
      else if (kind === 'mark') add('marks', 'unread', 'read', 'topics', 'conversation');
      else if (['delivery', 'waiting', 'whisper'].includes(kind)) add('marks', 'unread', 'read', 'topics', 'conversation', 'wakes');
      else if (['acts', 'dossier_move', 'source_cover', 'source_cover_read', 'question', 'withdrawal', 'removal'].includes(kind)) add('topics', 'conversation', 'unread', 'read', 'marks');
      else if (kind === 'hosted_seat') add('wakes', 'participants', 'seatPeople');
      else if (kind === 'agent_execution') add('wakes', 'participants');
      else return all();
    } else {
      if (kind === 'workspace') return all();
      if (kind === 'topic') add('pipeline', 'topics', 'conversation', 'unread', 'read', 'participants', 'wakes');
      else if (kind === 'memory') add('read', 'shown');
      else if (kind === 'pipeline' || kind === 'checks') add('pipeline', 'topics');
      else if (kind === 'hosted_seat') add('participants', 'seatPeople', 'wakes', 'topics');
      else if (kind === 'workspace_link' || kind.startsWith('tool_')) continue;
      else return all();
    }
  }
  return dirty;
}

export class RecordedActionChanges {
  constructor({ bootstrap, workspaceId, topicId, read, current, shown = () => false, binding = () => bootstrap }) {
    Object.assign(this, { bootstrap, readView: read, current, shown, binding });
    this.scopes = [{ kind: 'workspace', id: workspaceId }, { kind: 'topic', id: topicId }, { kind: 'actor', id: bootstrap.actor }];
    this.enabled = supportsAdmission(bootstrap); this.cursors = null; this.bindingKey = null;
  }
  // A returned stream with a changed commit goes through a fresh baseline
  // and full views. Quiet repeated state notices do not start a new producer.
  observe(event) { if (event.state === 'live') this.cursors = null; }
  identity() { return JSON.stringify(bindingOf(this.binding())); }
  async read(scope, cursor = null) {
    const binding = this.binding();
    return scopedChangesPage(await this.readView('changes', { scope, limit: 50, ...(cursor ? { cursor } : {}) }), binding, scope, cursor);
  }
  async baseline() {
    if (!this.enabled) return false;
    const identity = this.identity(), pages = await Promise.all(this.scopes.map(scope => this.read(scope)));
    if (!this.current() || identity !== this.identity()) return false;
    this.cursors = pages.map(page => structuredClone(page.checkpoint));
    this.bindingKey = identity;
    return true;
  }
  async next() {
    if (!this.enabled) return { dirty: null, accept() {} };
    if (this.bindingKey !== this.identity()) this.cursors = null;
    if (!this.cursors) { await this.baseline(); return { dirty: null, accept() {} }; }
    const identity = this.identity();
    const checkpoints = [], windows = [];
    try {
      for (const [index, scope] of this.scopes.entries()) {
        let cursor = this.cursors[index], page; const items = [];
        do {
          page = await this.read(scope, cursor);
          if (!this.current() || identity !== this.identity()) return { dirty: new Set(), accept() {} };
          items.push(...page.items); cursor = page.continuation;
        } while (page.has_more);
        checkpoints.push(structuredClone(page.checkpoint)); windows.push({ scope, items });
      }
    } catch (error) {
      if (readFailure(error).kind === 'resync') this.cursors = null;
      throw error;
    }
    const dirty = recordedInvalidation(windows);
    // A Reader source can live outside the open topic/outcome. Keep its
    // current-revision check rather than infer absence from these scopes.
    if (this.shown()) dirty.add('shown');
    return { dirty, accept: () => { if (this.current() && identity === this.identity()) this.cursors = checkpoints; } };
  }
}

export function recordedActionRefresh({ follow, bootstrap, workspaceId, topicId, read, current, shown, binding, owners }) {
  const changes = new RecordedActionChanges({ bootstrap, workspaceId, topicId, read, current, shown, binding });
  const before = changes.baseline().catch(() => false);
  const reload = follow(async dirty => {
    if (!current()) return false;
    const selected = dirty ?? recordedReads(), results = [];
    if (selected.has('pipeline') || selected.has('topics')) results.push(await owners.sections(dirty));
    for (const name of ['conversation', 'marks', 'unread', 'read', 'shown', 'wakes', 'participants']) {
      if (!current()) return false;
      if (selected.has(name)) results.push(await (name === 'participants'
        ? owners.participants(!dirty || selected.has('seatPeople')) : owners[name]()));
    }
    return current() && results.every(value => value !== false);
  }, changes, before);
  // Only local recorded notifications default to scoped. followCommits still
  // owns its full manual/visibility refresh and socket retry/coalescing path.
  return (all = false) => reload(all);
}

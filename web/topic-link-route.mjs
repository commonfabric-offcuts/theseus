// Resolve authored topic labels with existing scoped, paged metadata only.
import { TopicPages, WorkspacePages, readTopicList, listArgs, routeKey } from './topic-navigation.mjs';
import { checkedView } from './freshness.mjs';
const topicId = value => /^t-[0-9a-f]{32}$/.test(value);
export const topicLinkNeedsLookup = (route, currentTopicId = null) => route?.kind === 'topic' && route.id !== currentTopicId && !topicId(route.id);
const superseded = () => Object.assign(Error('This link was superseded.'), { code: 'LINK_SUPERSEDED' });
const invalid = () => Object.assign(Error('The destination could not be confirmed. Retry the link.'), { code: 'LINK_DESTINATION_UNCONFIRMED' });
const missing = error => ['FORBIDDEN', 'NOT_FOUND', 'TOPIC_NOT_FOUND'].includes(error?.details?.error?.code ?? error?.code);

export async function resolveTopicLink(route, { read, instanceId, workspaceId = null, ownerScope = null, limit = 20, current = () => true, confirm = false, currentTopicId = null }) {
  routeKey(route);
  const pageId = route.page ?? (route.kind === 'cards' ? route.id : null);
  if (!confirm && (route.kind !== 'topic' || topicId(route.id)) || confirm && route.kind !== 'topic' && !pageId) return route;
  const view = async (name, args) => {
    if (!current()) throw superseded();
    const answer = await read(name, args);
    if (!current()) throw superseded();
    return checkedView(answer, instanceId);
  };
  const record = async id => {
    const answer = await view('topic', { topic_id: id });
    if (answer.topic?.id !== id || typeof answer.topic.workspace_id !== 'string') throw invalid();
    return answer.topic;
  };
  try {
    // For a named page link the label cannot override its actual owner.
    if (pageId) {
      const page = confirm && route.revision
        ? await view('source', { source_ref: { kind: 'memory', id: pageId, revision: Number(route.revision) } })
        : await view('memory_current', { item_id: pageId }), scope = page.owner_scope;
      if (page.source_ref?.kind !== 'memory' || page.source_ref.id !== pageId || !['topic', 'workspace'].includes(scope?.kind) || typeof scope.id !== 'string' || confirm && route.revision && page.source_ref.revision !== Number(route.revision)) throw invalid();
      if (confirm && page.deleted) throw Object.assign(Error('Page deleted'), { code: 'PAGE_DELETED' });
      if (route.kind === 'cards') return route;
      const resolved = { ...route, kind: scope.kind, id: scope.id };
      try { routeKey(resolved); } catch (error) { if (confirm) throw invalid(); throw error; }
      return resolved;
    }
    // A canonical spelling is not evidence that an authored destination exists.
    // The already-open topic alone is known; its pages were checked above.
    if (confirm && route.id === currentTopicId) return route;
    if (confirm && topicId(route.id)) { await record(route.id); return route; }
    // Older readable ids remain addresses too; only an unavailable noncanonical
    // id is interpreted as a name. Canonical ids retain the existing path.
    try { await record(route.id); return route; } catch (error) { if (!missing(error)) throw error; }
    if (!workspaceId && ownerScope) workspaceId = ownerScope.kind === 'workspace' ? ownerScope.id : (await record(ownerScope.id)).workspace_id;
    const wanted = route.id.toLowerCase();
    const inOutcome = async id => {
      const matches = new Map(); let groups;
      for (const list of ['active', 'done', 'archived']) {
        if (list !== 'active' && groups?.[list] === 0) continue;
        const pages = new TopicPages(instanceId, id, null, list); let cursor = null;
        do {
          const args = { workspace_id: id, ...listArgs(list), limit, ...(cursor === null ? {} : { cursor }) };
          const answer = await readTopicList(view, args); pages.accept(answer, cursor); groups ??= answer.groups;
          for (let item of [...answer.items, ...(answer.conversation_topic ? [answer.conversation_topic] : [])]) {
            if (item.title_truncated) item = await record(item.id);
            if (typeof item.title !== 'string' || item.workspace_id !== id) throw invalid();
            if (item.title.toLowerCase() === wanted) matches.set(item.id, item);
          }
          cursor = pages.next;
        } while (cursor !== null);
      }
      return matches;
    };
    const choose = matches => {
      if (matches.size > 1) throw Object.assign(Error(`Two or more topics are named ${route.id}. Choose the topic from Outcomes.`), { code: 'TOPIC_NAME_AMBIGUOUS' });
      if (!matches.size) return null;
      const resolved = { ...route, id: matches.keys().next().value }; routeKey(resolved); return resolved;
    };
    if (workspaceId) {
      const local = choose(await inOutcome(workspaceId)); if (local) return local;
    }
    const workspaces = new WorkspacePages(instanceId), matches = new Map(); let cursor = null;
    do {
      const answer = await view('workspaces', { limit, ...(cursor === null ? {} : { cursor }) });
      workspaces.accept(answer, cursor);
      for (const workspace of answer.items) if (workspace.id !== workspaceId) {
        for (const [id, item] of await inOutcome(workspace.id)) matches.set(id, item);
        if (matches.size > 1) choose(matches);
      }
      cursor = workspaces.next;
    } while (cursor !== null);
    const found = choose(matches); if (found) return found;
    throw Object.assign(Error(`No topic is named ${route.id}. Choose the topic from Outcomes.`), { code: 'TOPIC_NAME_UNKNOWN' });
  } catch (error) {
    if (error.code === 'LINK_SUPERSEDED') return null;
    const code = error?.details?.error?.code ?? error?.code;
    if (confirm && (missing(error) || code === 'PAGE_DELETED')) throw Object.assign(
      Error(`This ${pageId ? 'page' : 'topic'} could not be found or is not available to you. Stayed here.`), { code: 'LINK_DESTINATION_UNAVAILABLE' });
    if (confirm && ['INVALID_ARGUMENT', 'INVALID_SOURCE', 'INVALID_FRESHNESS_VIEW'].includes(code)) throw invalid();
    throw error;
  }
}

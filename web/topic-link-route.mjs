// Resolve authored topic labels with existing scoped, paged metadata only.
import { TopicPages, WorkspacePages, readTopicList, listArgs, routeKey } from './topic-navigation.mjs';
import { checkedView } from './freshness.mjs';
const topicId = value => /^t-[0-9a-f]{32}$/.test(value);
export const topicLinkNeedsLookup = (route, currentTopicId = null) => route?.kind === 'topic' && route.id !== currentTopicId && !topicId(route.id);
const superseded = () => Object.assign(Error('This link was superseded.'), { code: 'LINK_SUPERSEDED' });
const invalid = () => Error('The destination could not be confirmed. Retry the link.');
const missing = error => ['FORBIDDEN', 'NOT_FOUND', 'TOPIC_NOT_FOUND'].includes(error?.details?.error?.code ?? error?.code);

export async function resolveTopicLink(route, { read, instanceId, workspaceId = null, ownerScope = null, limit = 20, current = () => true }) {
  routeKey(route);
  if (route.kind !== 'topic' || topicId(route.id)) return route;
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
    if (route.page) {
      const page = await view('memory_current', { item_id: route.page }), scope = page.owner_scope;
      if (page.source_ref?.kind !== 'memory' || page.source_ref.id !== route.page || !['topic', 'workspace'].includes(scope?.kind) || typeof scope.id !== 'string') throw invalid();
      const resolved = { ...route, kind: scope.kind, id: scope.id }; routeKey(resolved); return resolved;
    }
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
  } catch (error) { if (error.code === 'LINK_SUPERSEDED') return null; throw error; }
}

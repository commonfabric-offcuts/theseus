import { checkedView, RevisionTargets } from './freshness.mjs';
import { unansweredOf } from './unanswered.mjs';

const integer = n => Number.isSafeInteger(n) && n >= 0;
const invalid = message => Object.assign(Error(message), { code: 'INVALID_FRESHNESS_VIEW' });
const behind = () => Object.assign(Error('The requested version is not available yet.'), { code: 'RESOURCE_NOT_CURRENT' });
// A bounded cache of what this topic has actually loaded. Feed position and
// older-message/Notebook paging frontiers are deliberately independent.
export class TopicViews {
  constructor({ instanceId, topicId, paint = () => {}, invalidate = () => {} }) {
    Object.assign(this, { instanceId, topicId, paint, invalidate });
    this.scope = { kind: 'topic', id: topicId };
    this.messages = new Map(); this.memory = new Map(); this.revisions = new RevisionTargets();
    // Loaded messages form runs, each holding every topic message between its
    // oldest and newest; a gap between runs holds messages never loaded.
    this.runs = new Map(); this.runCount = 0;
    this.olderCursor = null; this.memoryCursor = null; this.newest = 0; this.memoryTail = 0;
    this.topic = null; this.messageTarget = null; this.unloadedChanged = false;
    // The oldest message the reader has not replied to, as the newest topic
    // version that said so had it; any page of the topic's messages says it.
    this.unanswered = null; this.unansweredVersion = -1;
    this.currentItem = null; this.openingItem = null;
  }
  retain(current = this.currentItem, opening = this.openingItem) {
    this.currentItem = current; this.openingItem = opening;
    this.revisions.retain([...this.memory.keys(), current, opening].filter(Boolean));
    for (const item of this.memory.values()) this.revisions.observe(item.id, item.revision);
  }
  keys(item) {
    if (item.resource_kind === 'topic') return [{ key: 'topic', version: item.version }];
    this.retain(); this.revisions.observe(item.resource_id, item.version); this.paint('offer');
    if (this.memory.has(item.resource_id)) return [{ key: 'memory:' + item.resource_id, version: item.version }];
    this.unloadedChanged = true;
    return this.memoryCursor === null ? [{ key: 'notebook', version: item.version }] : [];
  }
  refreshKeys() {
    return [{ key: 'topic', version: this.topic?.version ?? 0 },
      ...[...this.memory.values()].map(item => ({ key: 'memory:' + item.id, version: item.revision })),
      ...(this.memoryCursor === null ? [{ key: 'notebook', version: 0 }] : [])];
  }
  page(answer, versionKey) {
    checkedView(answer, this.instanceId);
    if (!Array.isArray(answer.items) || !(answer.next_cursor === null || integer(answer.next_cursor)) ||
        !integer(answer.relevant_versions?.[versionKey])) throw invalid('The list page is malformed.');
    return answer;
  }
  messagesPage(answer, { initial = false, cursor, live = false } = {}) {
    this.page(answer, 'topic');
    const unanswered = unansweredOf(answer), version = answer.relevant_versions.topic;
    if (unanswered !== undefined && version >= this.unansweredVersion) { this.unanswered = unanswered; this.unansweredVersion = version; }
    if (!initial && !live && cursor !== this.olderCursor || live && cursor !== this.newest) return false;
    let previous = -1;
    const ids = new Set();
    for (const item of answer.items) {
      if (!item || typeof item.id !== 'string' || !integer(item.seq) || item.seq < 1 || item.seq <= previous || ids.has(item.id) ||
          item.topic_id !== this.topicId || typeof item.body !== 'string' || typeof item.author_id !== 'string' ||
          live && item.seq <= cursor || !initial && !live && item.seq >= cursor) throw invalid('The message page belongs to another frontier.');
      previous = item.seq; ids.add(item.id);
      const known = this.messages.get(item.id);
      if (known && (known.seq !== item.seq || known.body !== item.body || known.author_id !== item.author_id)) throw invalid('An immutable message changed.');
    }
    // A page is contiguous in the topic. It extends the run it continues (the
    // newest message for a live page, the oldest for an older page) and joins
    // every run it overlaps; a page that does neither, such as a Refresh's
    // newest page, starts a run of its own.
    const joined = new Set(answer.items.map(item => this.runs.get(item.id)));
    if (!initial) for (const item of this.messages.values()) if (item.seq === cursor) joined.add(this.runs.get(item.id));
    joined.delete(undefined);
    const run = joined.size ? joined.values().next().value : ++this.runCount;
    for (const [id, other] of this.runs) if (joined.has(other)) this.runs.set(id, run);
    for (const item of answer.items) { this.messages.set(item.id, item); this.runs.set(item.id, run); }
    this.newest = Math.max(this.newest, ...answer.items.map(item => item.seq));
    if (!live) this.olderCursor = answer.next_cursor;
    this.paint('messages'); return true;
  }
  runOf(id) { return this.runs.get(id); }
  validMemory(item) {
    if (!item || typeof item.id !== 'string' || !integer(item.seq) || item.seq < 1 || !integer(item.revision) || item.revision < 1 ||
        item.owner_scope?.kind !== 'topic' || item.owner_scope.id !== this.topicId || item.source_ref?.kind !== 'memory' ||
        item.source_ref.id !== item.id || item.source_ref.revision !== item.revision || typeof item.body !== 'string') throw invalid('The Notebook summary has a different identity.');
    const old = this.memory.get(item.id);
    if (old && old.seq !== item.seq) throw invalid('The Notebook item moved to another sequence.');
  }
  memoryItem(item) {
    this.validMemory(item);
    const old = this.memory.get(item.id);
    if (!old || item.revision >= old.revision) this.memory.set(item.id, item);
    this.retain(); this.revisions.observe(item.id, item.revision);
  }
  memoryPage(answer, { initial = false, cursor, live = false } = {}) {
    this.page(answer, 'notebook');
    if (!initial && (live ? this.memoryCursor !== null || cursor !== this.memoryTail : cursor !== this.memoryCursor)) return false;
    let previous = initial ? 0 : cursor;
    for (const item of answer.items) { this.validMemory(item); if (item.seq <= previous) throw invalid('Notebook paging moved backwards.'); previous = item.seq; }
    for (const item of answer.items) this.memoryItem(item);
    this.memoryTail = Math.max(this.memoryTail, previous);
    if (!live) this.memoryCursor = answer.next_cursor;
    this.unloadedChanged = live ? answer.next_cursor !== null : this.unloadedChanged && answer.next_cursor !== null;
    this.paint('memory'); this.paint('offer'); return true;
  }
  async refresh(key, version, read, current = () => true) {
    if (key === 'topic') {
      const answer = checkedView(await read('topic', { topic_id: this.topicId }), this.instanceId);
      if (!current()) return false;
      if (answer.topic?.id !== this.topicId || !integer(answer.topic.version) || !Array.isArray(answer.participants) ||
          !answer.summary || answer.summary.topic_id !== this.topicId ||
          !(answer.summary.latest_message_id === null || typeof answer.summary.latest_message_id === 'string')) throw invalid('The topic summary is malformed.');
      if (answer.topic.version < Math.max(version, this.topic?.version ?? 0)) throw behind();
      this.topic = answer.topic; this.participants = answer.participants; this.messageTarget = answer.summary.latest_message_id;
      this.paint('topic');
      if (this.messageTarget && !this.messages.has(this.messageTarget)) this.invalidate('messages', answer.topic.version);
      this.invalidate('neighbors', answer.topic.version); return true;
    }
    if (key === 'messages') {
      if (!this.messageTarget || this.messages.has(this.messageTarget)) return true;
      const cursor = this.newest;
      const answer = await read('topic_messages', { topic_id: this.topicId, audience: 'all', direction: 'after', cursor, limit: 30 });
      if (!current()) return false;
      if (!this.messagesPage(answer, { live: true, cursor })) return false;
      if (!answer.items.length && !this.messages.has(this.messageTarget)) throw behind();
      return this.messages.has(this.messageTarget);
    }
    if (key === 'notebook') {
      if (this.memoryCursor !== null) { this.unloadedChanged = true; return true; }
      const cursor = this.memoryTail;
      const answer = await read('memory_items', { owner_scope: this.scope, cursor, limit: 20 });
      if (!current()) return false;
      if (!this.memoryPage(answer, { live: true, cursor })) return false;
      if (answer.next_cursor !== null && !answer.items.length) throw invalid('Notebook continuation made no progress.');
      return answer.next_cursor === null;
    }
    if (key.startsWith('memory:')) {
      const id = key.slice(7), old = this.memory.get(id);
      if (!old) return true;
      const answer = this.page(await read('memory_items', { owner_scope: this.scope, cursor: old.seq - 1, limit: 1 }), 'notebook');
      if (!current()) return false;
      const item = answer.items[0];
      if (answer.items.length !== 1 || item?.id !== id || item.seq !== old.seq) throw invalid('The requested Notebook item was not returned.');
      this.validMemory(item);
      if (item.revision < Math.max(version, this.memory.get(id)?.revision ?? 0)) throw behind();
      this.memoryItem(item); this.paint('memory'); this.paint('offer'); return true;
    }
    throw invalid('Unknown topic resource.');
  }
}

import { checkedView, RevisionTargets } from './freshness.mjs';
import { oldestUnreadOf } from './unanswered.mjs';

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
    // The oldest message the reader has not read, as the latest commit any
    // answer was read at had it: every page of the topic's messages says it,
    // and topic_unread, which the page reads again after each commit, since
    // reading, marks and replies move it without changing the topic.
    this.oldestUnread = null; this.unreadAt = -1;
    // The message the New line is drawn under. The first answer places it;
    // during the visit it moves only to show more unread, never up as the
    // person reads. placeAfresh (Refresh, an explicit Mark read) has the next
    // topic_unread read asked after it place the line wherever the oldest
    // unread message is: asked is how many reads were asked, and afreshFrom
    // the count when the line was last asked to be placed afresh.
    this.line = null; this.asked = 0; this.afreshFrom = null;
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
    const moved = this.learnUnread(answer);
    if (!initial && !live && cursor !== this.olderCursor || live && cursor !== this.newest) { if (moved) this.paint('line'); return false; }
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
  // Keeps what an answer says of the oldest unread message unless an answer
  // read at a later commit said otherwise, and moves the line: afresh, to the
  // oldest unread message the latest answer names, even when this answer is
  // older; else only when that shows more unread (there was no line, or the
  // message is further back). True when the line moves.
  learnUnread(answer, afresh = false) {
    const said = oldestUnreadOf(answer);
    if (said === undefined || said.at < this.unreadAt && !afresh) return false;
    if (said.at >= this.unreadAt) { this.oldestUnread = said.value; this.unreadAt = said.at; }
    const value = this.oldestUnread, more = value && (!this.line || value.seq < this.line.seq);
    const line = afresh || more ? value : this.line;
    const moved = this.line?.id !== line?.id;
    this.line = line;
    return moved;
  }
  placeAfresh() { this.afreshFrom = this.asked; }
  // Reads where the oldest unread message is now, and moves the line when it
  // moved. The first read asked after placeAfresh that answers places the line
  // afresh, so one that fails leaves that to the next.
  async readUnread(read, current = () => true) {
    const asked = ++this.asked;
    const answer = checkedView(await read('topic_unread', { topic_id: this.topicId }), this.instanceId);
    if (!current()) return false;
    if (answer.topic_id !== this.topicId || oldestUnreadOf(answer) === undefined) throw invalid('The oldest unread answer is for another topic or says nothing.');
    const afresh = this.afreshFrom !== null && asked > this.afreshFrom;
    if (afresh) this.afreshFrom = null;
    if (this.learnUnread(answer, afresh)) this.paint('line');
    return true;
  }
  runOf(id) { return this.runs.get(id); }
  validMemory(item) {
    if (!item || typeof item.id !== 'string' || !integer(item.seq) || item.seq < 1 || !integer(item.revision) || item.revision < 1 ||
        item.owner_scope?.kind !== 'topic' || item.owner_scope.id !== this.topicId || item.source_ref?.kind !== 'memory' ||
        item.source_ref.id !== item.id || item.source_ref.revision !== item.revision || typeof item.body !== 'string' ||
        item.read_revision !== undefined && !(integer(item.read_revision) && item.read_revision <= item.revision)) throw invalid('The Notebook summary has a different identity.');
    const old = this.memory.get(item.id);
    if (old && old.seq !== item.seq) throw invalid('The Notebook item moved to another sequence.');
  }
  memoryItem(item) {
    this.validMemory(item);
    const old = this.memory.get(item.id);
    // A read only moves forward, so an answer older than the one shown, at
    // the same revision, never relights a page the reader has read since.
    if (old && item.revision === old.revision && (old.read_revision ?? 0) > (item.read_revision ?? 0)) item = { ...item, read_revision: old.read_revision };
    if (!old || item.revision >= old.revision) this.memory.set(item.id, item);
    this.retain(); this.revisions.observe(item.id, item.revision);
  }
  // The reader's own read state of every loaded Notebook page, read again
  // from the start of the Notebook through the last page loaded, so a page
  // read since, here or on another device, loses its light. Pages not loaded
  // stay unloaded, and the Notebook's own paging is left where it was.
  async readState(read, pageMax = 20) {
    if (!this.memory.size) return true;
    const limit = Math.min(pageMax, Math.max(20, this.memory.size));
    let cursor = 0;
    do {
      const answer = this.page(await read('memory_items', { owner_scope: this.scope, cursor, limit }), 'notebook');
      let previous = cursor;
      for (const item of answer.items) { this.validMemory(item); if (item.seq <= previous) throw invalid('Notebook paging moved backwards.'); previous = item.seq; }
      for (const item of answer.items) if (this.memory.has(item.id)) this.memoryItem(item);
      if (answer.next_cursor !== null && answer.next_cursor <= cursor) throw invalid('Notebook continuation made no progress.');
      cursor = answer.next_cursor;
    } while (cursor !== null && cursor < this.memoryTail);
    this.paint('memory'); this.paint('offer'); return true;
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

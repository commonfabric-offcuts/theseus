import { checkedView, RevisionTargets } from './freshness.mjs';
import { oldestUnreadOf } from './unanswered.mjs';
import { learnReactions, reactionsOf } from './reactions.mjs';
import { laterActs } from './stack-order.mjs';

const integer = n => Number.isSafeInteger(n) && n >= 0;
const invalid = message => Object.assign(Error(message), { code: 'INVALID_FRESHNESS_VIEW' });
const behind = () => Object.assign(Error('The requested version is not available yet.'), { code: 'RESOURCE_NOT_CURRENT' });
// A bounded cache of what this topic has actually loaded. Feed position and
// older-message/Notebook paging frontiers are deliberately independent.
export class TopicViews {
  constructor({ instanceId, topicId, reader = null, paint = () => {}, invalidate = () => {} }) {
    Object.assign(this, { instanceId, topicId, reader, paint, invalidate });
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
    // person reads; once nothing holds it (held, below) it fades where it is.
    // placeAfresh (an explicit Mark read) has the next
    // topic_unread read asked after it place the line wherever the oldest
    // unread message is: asked is how many reads were asked, and afreshFrom
    // the count when the line was last asked to be placed afresh.
    this.line = null; this.asked = 0; this.afreshFrom = null;
    // What this page read on screen while the line held (held, below): one
    // entry for each range of cards it saw that reaches the line, kept until
    // the reader acts, unless its report is known to have settled nothing.
    this.sight = new Set();
    this.currentItem = null; this.openingItem = null;
    // The message the Reader shows that no loaded page holds (opened alone,
    // from a link to an older message): { id, seq, acts }, its acts read with
    // the loaded messages' (readActs), absent until first read.
    this.alone = null;
  }
  // The Reader shows message id, at seq in the topic: when no loaded page holds
  // it, its acts are kept as the loaded messages' are. True when that asks for
  // a read of the acts. The item, once its acts are read: aloneItem.
  showAlone(id, seq) {
    if (id === null || this.messages.has(id) || !integer(seq)) { this.alone = null; return false; }
    if (this.alone?.id === id) return false;
    this.alone = { id, seq }; return true;
  }
  aloneItem(id) { return this.alone?.id === id && this.alone.acts ? this.alone : null; }
  retain(current = this.currentItem, opening = this.openingItem) {
    this.currentItem = current; this.openingItem = opening;
    this.revisions.retain([...this.memory.keys(), current, opening].filter(Boolean));
    for (const item of this.memory.values()) this.revisions.observe(item.id, item.revision);
  }
  keys(item) {
    if (item.resource_kind === 'topic') return [{ key: 'topic', version: item.version }];
    // Its outcome's record changed (its team, owner or coordinator) and the topic's
    // version did not: the topic is read again for who may organise it now.
    if (item.resource_kind === 'workspace') return [{ key: 'topic', version: 0 }];
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
    // every run it overlaps; a page that does neither, such as the newest page
    // a commit reload reads after a gap, starts a run of its own.
    const joined = new Set(answer.items.map(item => this.runs.get(item.id)));
    if (!initial) for (const item of this.messages.values()) if (item.seq === cursor) joined.add(this.runs.get(item.id));
    joined.delete(undefined);
    const run = joined.size ? joined.values().next().value : ++this.runCount;
    for (const [id, other] of this.runs) if (joined.has(other)) this.runs.set(id, run);
    // A message read again keeps any act the page heard of after this page was read.
    for (const item of answer.items) {
      const known = this.messages.get(item.id);
      if (known?.acts) item.acts = laterActs(known.acts, item.acts);
      this.messages.set(item.id, item); this.runs.set(item.id, run);
    }
    // A message of the reader's own arriving is a reply, from this page or
    // another: an act, as below. The repaint of the messages places the line.
    if (live && this.reader !== null && answer.items.some(item => item.author_id === this.reader)) this.sight.clear();
    this.newest = Math.max(this.newest, ...answer.items.map(item => item.seq));
    if (!live) this.olderCursor = answer.next_cursor;
    this.paint('messages'); return true;
  }
  // Whether the line holds: a message at or above it (its own or a newer one)
  // is unread, as the answer that drives the counts and the Unread pills says,
  // or this page read one on screen while the line held. Reading on screen is
  // not reading for the line: it holds until the reader acts on what it marks
  // (acted, below: opening a message at or above it in the Reader, a reply,
  // Mark read). Read elsewhere, where this page did not see it, nothing holds
  // it, and it fades where it is. A faded line is gone for the reader: a
  // message that then arrives, or is marked unread, brings the line just
  // below it, as when there was none.
  get held() {
    const value = this.oldestUnread;
    return Boolean(this.line && (value && value.seq >= this.line.seq || this.sight.size));
  }
  // The page sees the cards of messages `from` through `through` on screen
  // now, and report is the promise of Core's receipt for reporting them
  // (ReadThrough.seen). While the line holds, a range that reaches it holds
  // it from this moment, so an act that follows (acted, below) releases it
  // however late the report goes out. Only cards seen on screen are sighted:
  // the Reader showing a message is an open, an act. A faded line is never
  // brought back by reading.
  sighted(from, through, report) {
    if (!this.held || through < this.line.seq) return;
    const entry = { from, through };
    this.sight.add(entry);
    report.then(receipt => this.seen(entry, receipt));
  }
  // Core's receipt for a sighted range (ReadThrough.seen). The range stops
  // holding only when its report is known to have settled nothing: Core
  // committed it and acknowledged no delivery (read already, here or
  // elsewhere), or the call reported nothing new (null: its cards were
  // reported already or wait to be). Any other answer keeps it, a failed
  // report among them: its answer may have been lost after Core recorded it,
  // and if Core did not record it, its cards are still unread anyway.
  seen(entry, receipt) {
    if (!this.sight.has(entry) || !(receipt === null || receipt?.status === 'committed' && receipt.result?.acknowledged === 0)) return;
    this.holding(() => this.sight.delete(entry));
  }
  // The reader acted on what the line marks: what they read on screen no
  // longer holds it, so it fades unless something at or above it is unread.
  acted() { this.holding(() => this.sight.clear()); }
  // The Reader shows message seq to the reader: at or above the line, an act.
  opened(seq) { if (this.line && seq >= this.line.seq) this.acted(); }
  holding(change) {
    const held = this.held;
    change();
    if (held !== this.held) this.paint('line');
  }
  // Keeps what an answer says of the oldest unread message unless an answer
  // read at a later commit said otherwise, and moves the line: afresh, to the
  // oldest unread message the latest answer names, even when this answer is
  // older (with none, the line stays where it is to fade); else only when that
  // shows more unread (there was no line or it had faded, or the message is
  // further back). True when the line moves, fades or comes back.
  learnUnread(answer, afresh = false) {
    const said = oldestUnreadOf(answer);
    if (said === undefined || said.at < this.unreadAt && !afresh) return false;
    const held = this.held;
    if (said.at >= this.unreadAt) { this.oldestUnread = said.value; this.unreadAt = said.at; }
    const value = this.oldestUnread, more = value && (!held || value.seq < this.line.seq);
    const line = afresh ? value ?? this.line : more ? value : this.line;
    const moved = this.line?.id !== line?.id;
    this.line = line;
    return moved || held !== this.held;
  }
  placeAfresh() { this.afreshFrom = this.asked; this.acted(); }
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
  // What people recorded about the loaded messages (docs/reply-stacks.md),
  // read again newest first down to the oldest message loaded: each loaded
  // message the answer names takes its acts as Core holds them. version: the
  // newest act the change named, which the answer must have reached.
  async readActs(version, read, current) {
    const alone = this.alone;
    if (!this.messages.size && !alone) return true;
    let oldest = alone?.seq ?? Infinity;
    for (const item of this.messages.values()) oldest = Math.min(oldest, item.seq);
    const found = new Map();
    let cursor = null, reached = null;
    do {
      const answer = checkedView(await read('message_acts', { topic_id: this.topicId, limit: 100, ...(cursor === null ? {} : { cursor }) }), this.instanceId);
      if (!current()) return false;
      if (answer.topic_id !== this.topicId || !Array.isArray(answer.items) || !integer(answer.version) || !(answer.next_cursor === null || integer(answer.next_cursor)) ||
          answer.items.some(item => typeof item?.message_id !== 'string' || !integer(item.seq) || !item.acts || typeof item.acts !== 'object')) throw invalid('The acts page is malformed.');
      if (cursor !== null && answer.next_cursor !== null && answer.next_cursor >= cursor) throw invalid('The acts paging made no progress.');
      reached ??= answer.version;
      for (const item of answer.items) found.set(item.message_id, item.acts);
      cursor = answer.items.length && answer.items.at(-1).seq < oldest ? null : answer.next_cursor;
    } while (cursor !== null);
    if (reached < version) throw behind();
    // Each act takes the later of what the page holds and the answer, by its
    // revision: an answer read before a commit the page has since heard of
    // puts back nothing (stack-order.mjs, laterActs).
    let changed = false;
    for (const [id, acts] of found) {
      const item = this.messages.get(id) ?? (alone?.id === id ? alone : null), later = item && laterActs(item.acts, acts);
      if (item && JSON.stringify(item.acts) !== JSON.stringify(later)) { item.acts = later; changed = true; }
    }
    // A message the answers never named has had no act made.
    if (alone && !alone.acts) { alone.acts = {}; changed = true; }
    if (changed) this.paint('acts');
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
    if (key.startsWith('whisper:')) {
      // A whisper moves nothing in the topic's own facts: its sequence is the target.
      const seq = Number(key.slice(8));
      if (this.newest >= seq) return true;
      const cursor = this.newest;
      const answer = await read('topic_messages', { topic_id: this.topicId, audience: 'all', direction: 'after', cursor, limit: 30 });
      if (!current()) return false;
      if (!this.messagesPage(answer, { live: true, cursor })) return false;
      return this.newest >= seq || !answer.items.length;
    }
    if (key.startsWith('reaction:')) {
      // Reactions on a message this page has not loaded come with it when it loads.
      const id = key.slice(9);
      if (!this.messages.has(id)) return true;
      const answer = checkedView(await read('reactions', { message_id: id }), this.instanceId);
      if (!current()) return false;
      if (answer.message_id !== id) throw invalid('The reactions answer is for another message.');
      if (reactionsOf(answer).version < version) throw behind();
      if (learnReactions(this.messages, answer)) this.paint('reactions');
      return true;
    }
    if (key === 'acts') return this.readActs(version, read, current);
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

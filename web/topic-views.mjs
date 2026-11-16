import { checkedView, RevisionTargets } from './freshness.mjs';
import { oldestUnreadOf } from './unanswered.mjs';
import { learnReactions, reactionsOf } from './reactions.mjs';
import { laterActs, laterPosition } from './stack-order.mjs';
import { revisionOf } from './message-edit-writing.mjs';
// The version of the person's own writing on a message (0 before any, or from an older server), and the marks it shows.
const yoursVersion = yours => (Number.isSafeInteger(yours?.version) ? yours.version : 0);
const carried = yours => [yours?.note === true, yours?.reply === true];

const integer = n => Number.isSafeInteger(n) && n >= 0;
// What places a dossier for the reader (docs/dossier-below-more.md): its first
// message, through, below and the revision of the act that set them, and the
// revision of the dossier's name, which every part of it shows (item 470). A
// position's snapshot (at) says only when it was read.
const PLACING = ['root_id', 'through', 'below', 'aside_revision', 'name_revision'];
const samePlace = (a, b) => (a ? b !== undefined && b !== null && PLACING.every(key => a[key] === b[key]) : !b);
const invalid = message => Object.assign(Error(message), { code: 'INVALID_FRESHNESS_VIEW' });
const behind = () => Object.assign(Error('The requested version is not available yet.'), { code: 'RESOURCE_NOT_CURRENT' });
// A reply's line reads how the message it answers begins: its first 120
// characters, as Core cuts it (aim_next/conversation.py, reply_to_excerpt).
const excerptOf = body => Array.from(body).slice(0, 120).join('');
// What else on the page holds messages' words (the conversation's own items,
// keyed by id) follows each edited message: its later revision, and the line
// of each reply to it that shows one. edits: id -> the message as read.
export function followEdits(items, edits) {
  for (const edited of edits.values()) {
    // Held at this revision or a later one, read since: what holds it, and the lines answering it, are as new.
    const held = items.get(edited.id);
    if (held && revisionOf(held) >= revisionOf(edited)) continue;
    if (held) {
      const { body, preview, revision, edited_ms } = edited;
      items.set(edited.id, { ...held, body, preview, revision, edited_ms });
    }
    for (const [id, other] of items) {
      if (other.reply_to === edited.id && typeof other.reply_to_excerpt === 'string') items.set(id, { ...other, reply_to_excerpt: excerptOf(edited.body) });
    }
  }
}
// A bounded cache of what this topic has actually loaded. Feed position and
// older-message/Notebook paging frontiers are deliberately independent.
export class TopicViews {
  // holds(id): whether something else on the page shows message id or a reply's line to it (followEdits).
  constructor({ instanceId, topicId, reader = null, paint = () => {}, invalidate = () => {}, holds = () => false }) {
    Object.assign(this, { instanceId, topicId, reader, paint, invalidate, holds });
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
    // Loaded messages whose words changed since they were painted: an edited
    // message, and each loaded reply whose line reads its words (takeRevised).
    // edits: each edited message as read since, loaded or not (takeEdits); quoted:
    // the latest revision read of each edited message only a loaded reply's line shows.
    this.revised = new Set(); this.edits = new Map(); this.quoted = new Map();
    // yours: the messages whose card's marks of the person's own note and saved reply changed (item 127).
    this.yours = new Set();
  }
  // The ids whose marks changed since the last call, once.
  takeYours() { const ids = this.yours; this.yours = new Set(); return ids; }
  // The later of two reads of the person's own writing on a message (yours, docs/topic-reading.md): each save raises
  // its version, so a read that answers late never puts back a note or a reply since saved or sent.
  laterYours(known, item) {
    const later = yoursVersion(item.yours) >= yoursVersion(known?.yours) ? item.yours : known.yours;
    if (known && JSON.stringify(carried(known.yours)) !== JSON.stringify(carried(later))) this.yours.add(item.id);
    return later;
  }
  // The ids repainted for an edit since the last call, once.
  takeRevised() { const ids = this.revised; this.revised = new Set(); return ids; }
  takeEdits() { const edits = this.edits; this.edits = new Map(); return edits; }
  // A loaded reply's line shows how message id begins.
  quotes(id) { for (const other of this.messages.values()) if (other.reply_to === id && typeof other.reply_to_excerpt === 'string') return true; return false; }
  // The reply line of each loaded reply to an edited message reads its latest words.
  requote(item) {
    this.edits.set(item.id, item);
    for (const other of this.messages.values()) {
      if (other.reply_to !== item.id || typeof other.reply_to_excerpt !== 'string') continue;
      other.reply_to_excerpt = excerptOf(item.body); this.revised.add(other.id);
    }
  }
  // A message's later revision replaces the one held (docs/message-edit.md),
  // and a loaded reply to it reads its new first words. An answer read before
  // the edit, at a lower revision, changes nothing. True when one was taken.
  learnRevision(item, known = this.messages.get(item.id)) {
    if (!known || revisionOf(item) <= revisionOf(known)) return false;
    if (known.acts) item.acts = laterActs(known.acts, item.acts);
    item.yours = this.laterYours(known, item);
    item.stack_position = laterPosition(known.stack_position, item.stack_position);
    this.messages.set(item.id, item); this.revised.add(item.id);
    this.requote(item);
    return true;
  }
  // An edited message no loaded page holds: the lines that show it read its words, unless a later revision was read.
  learnQuoted(item) {
    if (revisionOf(item) <= (this.quoted.get(item.id) ?? 1)) return false;
    this.quoted.set(item.id, revisionOf(item)); this.requote(item);
    return true;
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
      // What makes a message itself never changes. Its words change only by
      // an edit, which a later revision carries (docs/message-edit.md).
      if (known && (known.seq !== item.seq || known.author_id !== item.author_id ||
          revisionOf(known) === revisionOf(item) && known.body !== item.body)) throw invalid('An immutable message changed.');
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
    // A message read again keeps any act the page heard of after this page
    // was read, and the latest revision of its words the page has seen.
    for (const item of answer.items) {
      const known = this.messages.get(item.id);
      if (known && revisionOf(item) !== revisionOf(known)) {
        if (!this.learnRevision(item, known)) {
          if (known.acts || item.acts) known.acts = laterActs(known.acts, item.acts);
          known.yours = this.laterYours(known, item);
        }
        this.runs.set(item.id, run); continue;
      }
      if (known?.acts) item.acts = laterActs(known.acts, item.acts);
      item.yours = this.laterYours(known, item);
      item.stack_position = laterPosition(known?.stack_position, item.stack_position);
      this.messages.set(item.id, item); this.runs.set(item.id, run);
    }
    this.learnPositions(answer.items.map(item => ({ message_id: item.id, stack_position: item.stack_position })));
    // A message of the reader's own arriving is a reply, from this page or
    // another: an act, as below. The repaint of the messages places the line.
    if (live && this.reader !== null && answer.items.some(item => item.author_id === this.reader)) this.sight.clear();
    this.newest = Math.max(this.newest, ...answer.items.map(item => item.seq));
    if (!live) this.olderCursor = answer.next_cursor;
    this.paint('messages');
    if (this.revised.size) this.paint('edited');
    if (this.yours.size) this.paint('yours');
    return true;
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
    // What was learned is drawn even when reading the places after it fails
    // (superseded, or deferred behind the page's own reads): the next read
    // learns nothing new, so it would draw nothing.
    try { await this.readPositions(read, current); }
    finally { if (changed) this.paint('acts'); }
    return true;
  }
  // Keeps the later of each read position, for every loaded message of its
  // dossier. True when what places a dossier changed (samePlace): every act in
  // the topic raises a position's snapshot (at), and that alone draws nothing.
  // A row is the word on its own message: one sharing a root only by the
  // position a join or split made stale is read in the same answer, and its
  // own row places it (item 470).
  learnPositions(rows) {
    let changed = false;
    const read = new Set(rows.filter(row => row.stack_position).map(row => row.message_id));
    for (const row of rows) {
      if (!row.stack_position) continue;
      const item = this.messages.get(row.message_id);
      if (!item) continue;
      const position = laterPosition(item.stack_position, row.stack_position);
      if (!samePlace(position, item.stack_position)) changed = true;
      item.stack_position = position;
      for (const [id, other] of this.messages) {
        if (read.has(id) || other.stack_position?.root_id !== position.root_id) continue;
        const next = laterPosition(other.stack_position, position);
        if (!samePlace(next, other.stack_position)) changed = true;
        other.stack_position = next;
      }
    }
    return changed;
  }
  async readPositions(read, current = () => true) {
    // A cached pre-355 Core has no position contract; its ordinary act reads
    // remain usable until the page is reloaded onto the new release.
    if (![...this.messages.values()].some(item => item.stack_position)) return;
    const ids = [...this.messages.keys()]; let changed = false;
    // A page learned before a later one fails is drawn, as in readActs.
    try {
      for (let start = 0; start < ids.length; start += 100) {
        const answer = checkedView(await read('stack_positions', { topic_id: this.topicId, message_ids: ids.slice(start, start + 100) }), this.instanceId);
        if (!current()) return;
        if (answer.topic_id !== this.topicId || !Array.isArray(answer.items)) throw invalid('The dossier positions belong to another topic.');
        changed = this.learnPositions(answer.items) || changed;
      }
    } finally { if (changed) this.paint('acts'); }
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
  // One message of this topic read again, alone, in the shape of a page's item: the answer, or what refresh
  // returns without one. Refused (the reader can no longer read it, or the topic), as an answer or as the read's
  // error: true, so the card is left as it is and the page goes on; false when the read was superseded. Busy and
  // the like throw, to be read again.
  async named(id, read, current) {
    const refused = value => ['FORBIDDEN', 'INVALID_ARGUMENT'].includes((value?.details ?? value)?.error?.code);
    let named;
    try { named = await read('topic_messages', { topic_id: this.topicId, message_ids: [id] }); }
    catch (error) { if (refused(error)) return current() ? true : false; throw error; }
    if (!current()) return false;
    if (refused(named)) return true;
    return checkedView(named, this.instanceId);
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
    if (key.startsWith('edit:')) {
      // A message edited (an actor-scope change, docs/message-edit.md): one this page
      // shows, or whose words a loaded reply's line or another holder shows, is read
      // again, alone, in the shape of a page's item.
      const id = key.slice(5), known = this.messages.get(id);
      if (!known && !this.quotes(id) && !this.holds(id)) return true;
      const answer = await this.named(id, read, current);
      if (typeof answer === 'boolean') return answer;
      if (!Array.isArray(answer.items) || answer.items.length > 1 || answer.items.some(item => item?.id !== id || item.topic_id !== this.topicId ||
          typeof item.body !== 'string' || known && (item.seq !== known.seq || item.author_id !== known.author_id))) throw invalid('The edited message answer is for another message.');
      // No longer readable here: what is shown stays until the topic is read again.
      if (!answer.items.length) return true;
      if (revisionOf(answer.items[0]) < version) throw behind();
      if (known ? this.learnRevision(answer.items[0]) : this.learnQuoted(answer.items[0])) this.paint('edited');
      return true;
    }
    if (key.startsWith('yours:')) {
      // The person's own note or saved reply on a message changed (an actor-scope change, item 127): a card this
      // page shows reads it again, alone, in the shape of a page's item; one it does not show reads it as it loads.
      const id = key.slice(6), known = this.messages.get(id);
      if (!known) return true;
      const answer = await this.named(id, read, current);
      if (typeof answer === 'boolean') return answer;
      if (!Array.isArray(answer.items) || answer.items.length > 1 || answer.items.some(item => item?.id !== id || item.seq !== known.seq ||
          !integer(item.yours?.version))) throw invalid('The message answer is for another message.');
      if (!answer.items.length) return true;
      if (answer.items[0].yours.version < version) throw behind();
      const latest = this.messages.get(id);
      latest.yours = this.laterYours(latest, answer.items[0]);
      if (this.yours.size) this.paint('yours');
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

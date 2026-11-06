// The red New line: where the server says the oldest unread message is, the
// page draws the line under its card, and moves or removes it as answers read
// at later commits say.
import test from 'node:test';
import assert from 'node:assert/strict';
import { oldestUnreadOf, placeNewLine } from '../web/unanswered.mjs';
import { TopicViews } from '../web/topic-views.mjs';

class Element {
  constructor(tag = 'div') { Object.assign(this, { tag, children: [], dataset: {}, className: '', textContent: '', parent: null }); }
  insertBefore(child, before) {
    child.remove(); const index = before ? this.children.indexOf(before) : this.children.length;
    assert.ok(index >= 0, 'insertBefore names a child of this list');
    this.children.splice(index, 0, child); child.parent = this;
  }
  remove() { if (this.parent) { this.parent.children = this.parent.children.filter(node => node !== this); this.parent = null; } }
}
const doc = { createElement: tag => new Element(tag) };
const list = (...seqs) => {
  const host = new Element();
  for (const seq of seqs) { const card = new Element('button'); card.dataset.seq = String(seq); card.dataset.id = 'm' + seq; host.insertBefore(card, null); }
  return host;
};
const order = host => host.children.map(node => node.dataset.line ?? Number(node.dataset.seq));

test('the line sits just below the card of the oldest unread message, and moves with it', () => {
  const host = list(50, 40, 30, 20);
  const line = placeNewLine(host, 30, doc);
  assert.deepEqual(order(host), [50, 40, 30, 'new', 20]);
  assert.equal(line.textContent, 'New');
  assert.equal(line.className, 'new-line');
  assert.equal(line.dataset.seq, undefined, 'the line is never taken for a card');
  assert.equal(line.dataset.id, undefined);
  assert.equal(placeNewLine(host, 30, doc), line, 'placed again where it is, it stays');
  assert.deepEqual(order(host), [50, 40, 30, 'new', 20]);
  placeNewLine(host, 40, doc);
  assert.deepEqual(order(host), [50, 40, 'new', 30, 20], 'reading the oldest moves it up');
  placeNewLine(host, 20, doc);
  assert.deepEqual(order(host), [50, 40, 30, 20, 'new'], 'under the last loaded card');
  placeNewLine(host, null, doc);
  assert.deepEqual(order(host), [50, 40, 30, 20], 'everything read, it goes');
  placeNewLine(host, 35, doc);
  assert.deepEqual(order(host), [50, 40, 30, 20], 'a message among the loaded ones without a card here has no line');
});

// When the oldest unread message is further back than what is loaded, the
// line sits at the bottom of what is loaded, says so, and loads the older
// messages when activated; once its card is loaded, the line takes its place.
test('a line for a message not loaded yet sits at the bottom, says older below, and loads it when pressed', () => {
  const host = list(50, 40, 30, 20), loads = [];
  const load = () => loads.push('older');
  const marker = placeNewLine(host, 10, doc, load);
  assert.deepEqual(order(host), [50, 40, 30, 20, 'older'], 'at the bottom of what is loaded');
  assert.equal(marker.tag, 'button', 'a control the person can press, by pointer or keyboard');
  assert.equal(marker.type, 'button');
  assert.equal(marker.textContent, 'New · older below');
  assert.equal(marker.className, 'new-line new-line-older');
  assert.equal(marker.dataset.seq, undefined, 'never taken for a card');
  marker.onclick();
  assert.deepEqual(loads, ['older'], 'pressing it loads the older messages');
  assert.equal(placeNewLine(host, 10, doc, load), marker, 'placed again, it stays');
  const older = list(15); host.insertBefore(older.children[0], null);
  placeNewLine(host, 10, doc, load);
  assert.deepEqual(order(host), [50, 40, 30, 20, 15, 'older'], 'more loaded, still not reached: still at the bottom');
  const reached = list(10); host.insertBefore(reached.children[0], null);
  const line = placeNewLine(host, 10, doc, load);
  assert.deepEqual(order(host), [50, 40, 30, 20, 15, 10, 'new'], 'loaded: the line takes its true place, and the marker goes');
  assert.equal(line.textContent, 'New');
  assert.notEqual(line.tag, 'button', 'in its place the line is not a control');
  placeNewLine(host, 40, doc, load);
  assert.deepEqual(order(host), [50, 40, 'new', 30, 20, 15, 10]);
  assert.throws(() => placeNewLine(list(50, 40), 10, doc), /loads the older messages/, 'a line for a message further back needs a way to load it');
  // Nothing older to load (null): the line promises nothing, and one drawn
  // before goes.
  const top = list(50, 40);
  placeNewLine(top, 10, doc, load);
  assert.equal(placeNewLine(top, 10, doc, null), null);
  assert.deepEqual(order(top), [50, 40], 'no older line when nothing older can be loaded');
});

test('what an answer says of the oldest unread message is read strictly', () => {
  assert.equal(oldestUnreadOf({}), undefined, 'a server that does not say draws no line');
  assert.deepEqual(oldestUnreadOf({ oldest_unread: null, commit_seq: 3 }), { value: null, at: 3 });
  assert.deepEqual(oldestUnreadOf({ oldest_unread: { seq: 4, id: 'm4' }, commit_seq: 0 }), { value: { seq: 4, id: 'm4' }, at: 0 });
  for (const bad of [{ seq: 0, id: 'm' }, { seq: 4 }, { seq: '4', id: 'm4' }, { seq: 4, id: '' }, 4, 'm4'])
    assert.throws(() => oldestUnreadOf({ oldest_unread: bad, commit_seq: 3 }), /oldest unread message is malformed/);
  for (const at of [undefined, -1, 1.5, '3'])
    assert.throws(() => oldestUnreadOf({ oldest_unread: null, commit_seq: at }), /oldest unread message is malformed/, 'it says which commit it is as of');
});

test('the latest commit an answer was read at decides where the line is, from a page or from topic_unread', async () => {
  const paints = [];
  const views = new TopicViews({ instanceId: 'i', topicId: 't1', paint: kind => paints.push(kind) });
  const page = (version, at, oldest, items = []) => ({ instance_id: 'i', items, next_cursor: null, relevant_versions: { topic: version },
    ...(oldest === undefined ? {} : { oldest_unread: oldest, commit_seq: at }) });
  const item = seq => ({ id: 'm' + seq, seq, topic_id: 't1', body: 'b', author_id: 'a' });
  views.messagesPage(page(5, 10, { seq: 3, id: 'm3' }, [item(3), item(4)]), { initial: true });
  assert.deepEqual(views.oldestUnread, { seq: 3, id: 'm3' });
  // Reading changes no topic version: the commit orders the answers.
  const reads = [];
  const answer = (at, oldest, topic = 't1') => async (name, args) => { reads.push([name, args]); return { instance_id: 'i', topic_id: topic, oldest_unread: oldest, commit_seq: at }; };
  paints.length = 0;
  assert.equal(await views.readUnread(answer(12, { seq: 4, id: 'm4' })), true);
  assert.deepEqual(reads, [['topic_unread', { topic_id: 't1' }]]);
  assert.deepEqual(views.oldestUnread, { seq: 4, id: 'm4' }, 'reading the oldest moved it up');
  assert.deepEqual(views.line, { seq: 3, id: 'm3' }, 'the line, placed when the topic opened, holds while the person reads');
  assert.deepEqual(paints, [], 'so nothing is painted');
  views.messagesPage(page(5, 11, { seq: 3, id: 'm3' }, [item(2)]), { cursor: views.olderCursor ?? 3 });
  assert.deepEqual(views.oldestUnread, { seq: 4, id: 'm4' }, 'a page read at an earlier commit does not bring it back, though its topic version is the same');
  paints.length = 0;
  await views.readUnread(answer(12, { seq: 4, id: 'm4' }));
  assert.deepEqual(paints, [], 'the same answer again moves nothing');
  await views.readUnread(answer(11, null));
  assert.deepEqual(views.oldestUnread, { seq: 4, id: 'm4' }, 'nor does an earlier topic_unread');
  await views.readUnread(answer(13, null));
  assert.equal(views.oldestUnread, null, 'everything read: no line');
  views.messagesPage(page(6, 14, { seq: 6, id: 'm6' }, [item(6)]), { live: true, cursor: 4 });
  assert.deepEqual(views.oldestUnread, { seq: 6, id: 'm6' }, 'a message that arrived while caught up');
  views.messagesPage(page(7, undefined, undefined, []), { live: true, cursor: 6 });
  assert.deepEqual(views.oldestUnread, { seq: 6, id: 'm6' }, 'a page that does not say leaves it as it was');
  // A stale read (the topic was left meanwhile) changes nothing; another topic's answer is refused.
  assert.equal(await views.readUnread(answer(20, null), () => false), false);
  assert.deepEqual(views.oldestUnread, { seq: 6, id: 'm6' });
  await assert.rejects(views.readUnread(answer(21, null, 't2')), /another topic or says nothing/);
  await assert.rejects(views.readUnread(async () => ({ instance_id: 'i', topic_id: 't1' })), /another topic or says nothing/, 'an answer that does not say is refused');
});

test('a page for a frontier that moved on is not kept, yet what it says of the line is, and the line is placed', () => {
  const paints = [];
  const views = new TopicViews({ instanceId: 'i', topicId: 't1', paint: kind => paints.push(kind) });
  const item = seq => ({ id: 'm' + seq, seq, topic_id: 't1', body: 'b', author_id: 'a' });
  const page = (at, oldest, items, next = null) => ({ instance_id: 'i', items, next_cursor: next, relevant_versions: { topic: 5 }, oldest_unread: oldest, commit_seq: at });
  views.messagesPage(page(10, { seq: 6, id: 'm6' }, [item(6), item(7)], 6), { initial: true });
  assert.equal(views.olderCursor, 6);
  // An older page asked for from a cursor the page has since passed: its
  // messages are not kept, but it was read at a later commit, when a message
  // further back was marked unread.
  paints.length = 0;
  assert.equal(views.messagesPage(page(12, { seq: 2, id: 'm2' }, [item(2)]), { cursor: 4 }), false, 'the stale page is not kept');
  assert.equal(views.messages.has('m2'), false);
  assert.deepEqual(views.oldestUnread, { seq: 2, id: 'm2' });
  assert.deepEqual(paints, ['line'], 'the line is placed where that page says');
  paints.length = 0;
  assert.equal(views.messagesPage(page(13, { seq: 2, id: 'm2' }, []), { cursor: 4 }), false);
  assert.deepEqual(paints, [], 'a stale page that moves nothing paints nothing');
});

// The line is placed from the server's answer when the topic opens, and again
// on Refresh or an explicit Mark read; during the visit, reading never moves it
// up, so it does not vanish a second after a short topic opens. It moves only
// to show more unread: an arrival while nothing is unread, or a mark further back.
test('the line is placed when the topic opens, holds while the person reads, and moves only to show more', async () => {
  const paints = [];
  const views = new TopicViews({ instanceId: 'i', topicId: 't1', paint: kind => paints.push(kind) });
  const item = seq => ({ id: 'm' + seq, seq, topic_id: 't1', body: 'b', author_id: 'a' });
  views.messagesPage({ instance_id: 'i', items: [item(3), item(4), item(5)], next_cursor: null, relevant_versions: { topic: 5 },
    oldest_unread: { seq: 3, id: 'm3' }, commit_seq: 10 }, { initial: true });
  assert.deepEqual(views.line, { seq: 3, id: 'm3' }, 'placed from the server when the topic opens');
  const answer = (at, oldest) => async () => ({ instance_id: 'i', topic_id: 't1', oldest_unread: oldest, commit_seq: at });
  const step = async (at, oldest, options) => { paints.length = 0; await views.readUnread(answer(at, oldest), undefined, options); return [views.line, [...paints]]; };
  assert.deepEqual(await step(12, { seq: 4, id: 'm4' }), [{ seq: 3, id: 'm3' }, []], 'reading the oldest leaves the line where it is');
  assert.deepEqual(await step(13, null), [{ seq: 3, id: 'm3' }, []], 'reading everything leaves it too: it does not vanish');
  assert.deepEqual(await step(14, { seq: 6, id: 'm6' }), [{ seq: 3, id: 'm3' }, []], 'an arrival above the line is already shown as new');
  assert.deepEqual(await step(15, { seq: 2, id: 'm2' }), [{ seq: 2, id: 'm2' }, ['line']], 'a mark further back moves it down, to show more');
  assert.deepEqual(await step(16, { seq: 6, id: 'm6' }, { afresh: true }), [{ seq: 6, id: 'm6' }, ['line']], 'Refresh or an explicit Mark read places it afresh');
  assert.deepEqual(await step(17, null, { afresh: true }), [null, ['line']], 'afresh with nothing unread: no line');
  assert.deepEqual(await step(18, { seq: 7, id: 'm7' }), [{ seq: 7, id: 'm7' }, ['line']], 'caught up, an arrival brings the line');
  assert.deepEqual(await step(17, null, { afresh: true }), [{ seq: 7, id: 'm7' }, []], 'an afresh answer read at an earlier commit changes nothing');
  assert.deepEqual(views.oldestUnread, { seq: 7, id: 'm7' });
});

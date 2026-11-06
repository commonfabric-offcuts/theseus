// The red New line: where the server says the oldest unread message is, the
// page draws the line under its card, and moves or removes it as answers read
// at later commits say.
import test from 'node:test';
import assert from 'node:assert/strict';
import { oldestUnreadOf, placeNewLine } from '../web/unanswered.mjs';
import { TopicViews } from '../web/topic-views.mjs';
import { clock } from '../web/times.mjs';

// Every time is read at noon on Thursday 5 November 2026.
clock.now = () => new Date(2026, 10, 5, 12, 0).getTime();

class Element {
  constructor(tag = 'div') { Object.assign(this, { tag, children: [], dataset: {}, className: '', textContent: '', parent: null }); }
  insertBefore(child, before) {
    child.remove(); const index = before ? this.children.indexOf(before) : this.children.length;
    assert.ok(index >= 0, 'insertBefore names a child of this list');
    this.children.splice(index, 0, child); child.parent = this;
  }
  remove() { if (this.parent) { this.parent.children = this.parent.children.filter(node => node !== this); this.parent = null; } }
  append(...nodes) { for (const node of nodes) if (typeof node === 'string') this.children.push(node); else this.insertBefore(node, null); }
  replaceChildren(...nodes) { for (const node of [...this.children]) if (typeof node === 'string') this.children.splice(this.children.indexOf(node), 1); else node.remove(); this.append(...nodes); }
  // What it says: its own text, then its children's.
  get text() { return this.textContent + this.children.map(node => typeof node === 'string' ? node : node.text).join(''); }
  find(className) { for (const node of this.children) { if (typeof node !== 'object') continue; if (node.className === className) return node; const found = node.find(className); if (found) return found; } return null; }
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
  assert.equal(line.text, 'New');
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
  assert.equal(marker.text, 'New · older below');
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
  assert.equal(line.text, 'New');
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
  assert.deepEqual(oldestUnreadOf({ oldest_unread: { seq: 4, id: 'm4', sent_ms: 1762350240000 }, commit_seq: 3 }).value, { seq: 4, id: 'm4', sent_ms: 1762350240000 });
  assert.deepEqual(oldestUnreadOf({ oldest_unread: { seq: 4, id: 'm4', sent_ms: null }, commit_seq: 3 }).value, { seq: 4, id: 'm4', sent_ms: null }, 'a message from before times were kept');
  for (const bad of [{ seq: 0, id: 'm' }, { seq: 4 }, { seq: '4', id: 'm4' }, { seq: 4, id: '' }, 4, 'm4',
    { seq: 4, id: 'm4', sent_ms: '1762350240000' }, { seq: 4, id: 'm4', sent_ms: 1.5 }])
    assert.throws(() => oldestUnreadOf({ oldest_unread: bad, commit_seq: 3 }), /oldest unread message is malformed/);
  for (const at of [undefined, -1, 1.5, '3'])
    assert.throws(() => oldestUnreadOf({ oldest_unread: null, commit_seq: at }), /oldest unread message is malformed/, 'it says which commit it is as of');
});

// The line says when the oldest message the reader has not read was
// sent, as every time on the page does; the label and the time are separate
// spans, so either label composes with the time.
test('the line says when that message was sent, today\'s time alone, and its title keeps the date', () => {
  const host = list(50, 40, 30, 20), loads = [];
  const sent = new Date(2026, 10, 5, 4, 40).getTime(), yesterday = new Date(2026, 10, 4, 21, 12).getTime();
  const line = placeNewLine(host, 30, doc, undefined, sent);
  assert.equal(line.text, 'New · 4:40 AM');
  assert.deepEqual([line.find('new-line-label')?.text, line.find('new-line-time')?.text], ['New', ' · 4:40 AM'], 'the label and the time are separate spans');
  assert.equal(line.find('new-line-time').children[1].title, '4:40 AM Thu Nov 5', 'the time\'s title keeps the date');
  assert.match(line.title, /4:40 AM Thu Nov 5/, 'and so does the line\'s');
  // Placed again after midnight, the same line says it was yesterday.
  const now = clock.now;
  clock.now = () => new Date(2026, 10, 6, 0, 5).getTime();
  try { placeNewLine(host, 30, doc, undefined, sent); assert.equal(line.text, 'New · Yesterday 4:40 AM'); }
  finally { clock.now = now; }
  placeNewLine(host, 30, doc, undefined, sent);
  assert.equal(placeNewLine(host, 40, doc, undefined, yesterday), line, 'moved by an answer, it is the same line');
  assert.equal(line.text, 'New · Yesterday 9:12 PM', 'its time follows the message it sits under');
  placeNewLine(host, 40, doc, undefined, null);
  assert.equal(line.text, 'New', 'a message from before times were kept has none');
  assert.equal(line.find('new-line-time'), null);
  const marker = placeNewLine(host, 10, doc, () => loads.push('older'), new Date(2026, 10, 1, 7, 41).getTime());
  assert.equal(marker.text, 'New · older below · 7:41 AM Sun Nov 1', 'the line for a message further back says when, dated');
  assert.equal(marker.find('new-line-label').text, 'New · older below');
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
  assert.deepEqual(paints, ['line'], 'and the line is placed again');
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

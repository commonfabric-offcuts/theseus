// The red New line: where the server says the oldest unanswered message is,
// the page draws the line under its card, and moves or removes it as later
// answers say.
import test from 'node:test';
import assert from 'node:assert/strict';
import { unansweredOf, placeNewLine } from '../web/unanswered.mjs';
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

test('the line sits just below the card of the oldest unanswered message, and moves with it', () => {
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
  assert.deepEqual(order(host), [50, 40, 'new', 30, 20], 'a reply to the oldest moves it up');
  placeNewLine(host, 20, doc);
  assert.deepEqual(order(host), [50, 40, 30, 20, 'new'], 'under the last loaded card');
  placeNewLine(host, null, doc);
  assert.deepEqual(order(host), [50, 40, 30, 20], 'replied to everything, it goes');
  placeNewLine(host, 10, doc);
  assert.deepEqual(order(host), [50, 40, 30, 20], 'not drawn under a card not loaded yet');
});

test('the boundary a page carries is read strictly', () => {
  assert.equal(unansweredOf({}), undefined, 'a server that does not say draws no line');
  assert.equal(unansweredOf({ unanswered: null }), null);
  assert.deepEqual(unansweredOf({ unanswered: { seq: 4, id: 'm4' } }), { seq: 4, id: 'm4' });
  for (const bad of [{ seq: 0, id: 'm' }, { seq: 4 }, { seq: '4', id: 'm4' }, { seq: 4, id: '' }, 4, 'm4'])
    assert.throws(() => unansweredOf({ unanswered: bad }), /unanswered boundary is malformed/);
});

test('the newest topic version a page was read at decides where the line is', () => {
  const views = new TopicViews({ instanceId: 'i', topicId: 't1' });
  const page = (version, unanswered, items = []) => ({ instance_id: 'i', items, next_cursor: null, relevant_versions: { topic: version }, ...(unanswered === undefined ? {} : { unanswered }) });
  const item = seq => ({ id: 'm' + seq, seq, topic_id: 't1', body: 'b', author_id: 'a' });
  views.messagesPage(page(5, { seq: 3, id: 'm3' }, [item(3), item(4)]), { initial: true });
  assert.deepEqual(views.unanswered, { seq: 3, id: 'm3' });
  views.messagesPage(page(7, { seq: 4, id: 'm4' }, [item(6)]), { live: true, cursor: 4 });
  assert.deepEqual(views.unanswered, { seq: 4, id: 'm4' }, 'a live page after the reader replied moves it');
  views.messagesPage(page(6, { seq: 3, id: 'm3' }, [item(2)]), { cursor: views.olderCursor ?? 3 });
  assert.deepEqual(views.unanswered, { seq: 4, id: 'm4' }, 'a page read at an older version does not bring it back');
  views.messagesPage(page(8, null, []), { live: true, cursor: 6 });
  assert.equal(views.unanswered, null);
  views.messagesPage(page(9, undefined, []), { live: true, cursor: 6 });
  assert.equal(views.unanswered, null, 'a page that does not say leaves it as it was');
});

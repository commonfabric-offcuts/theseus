import test from 'node:test';
import assert from 'node:assert/strict';
import { VisitNew, visitNewFor } from '../web/visit-new.mjs';
import { TopicViews } from '../web/topic-views.mjs';
import { gather, rowsOf, newestNew } from '../web/stack-order.mjs';

const message = (seq, author_id = 'other', extra = {}) => ({ id: `m${seq}`, seq, author_id, topic_id: 'topic', body: `Message ${seq}`, ...extra });
const page = items => ({ instance_id: 'copy', items, next_cursor: null, relevant_versions: { topic: 1 } });

test('only live arrivals gain marks, including already-read messages, without changing their read facts', () => {
  const marks = new VisitNew('me');
  const views = new TopicViews({ instanceId: 'copy', topicId: 'topic', reader: 'me', arrived: items => marks.arrive(items) });
  views.messagesPage(page([message(2)]), { initial: true });
  assert.equal(marks.has('m2'), false, 'startup history is not new this visit');
  views.messagesPage(page([message(3, 'other', { unread: false }), message(4, 'me')]), { live: true, cursor: 2 });
  assert.equal(marks.has('m3'), true, 'already read elsewhere still arrived here');
  assert.equal(marks.has('m4'), false, 'own message is excluded');
  assert.equal(views.messages.get('m3').unread, false, 'stored read fact is untouched');
  views.messagesPage(page([message(1)]), { anchored: true, cursor: 2 });
  assert.equal(marks.has('m1'), false, 'older source discovery is not an arrival');
  marks.clear('m3'); marks.arrive([message(3)]);
  assert.equal(marks.has('m3'), false, 'a delayed/repeated read cannot resurrect it');
});

test('topic returns retain marks, but reload and identity changes begin fresh', () => {
  const doc = {}, scope = { instanceId: 'copy', actor: 'me', authority: { authority_id: 'a', authority_epoch: 'e' } };
  const marks = visitNewFor(doc, scope); marks.arrive([message(1)]);
  assert.equal(visitNewFor(doc, scope).has('m1'), true);
  assert.equal(visitNewFor({}, scope).has('m1'), false, 'new document after reload');
  assert.equal(visitNewFor(doc, { ...scope, actor: 'someone-else' }).has('m1'), false);
  assert.equal(visitNewFor(doc, scope).has('m1'), false, 'returning identity does not recover old marks');
  marks.clear('m2'); marks.arrive([message(2)]);
  assert.equal(marks.has('m2'), false, 'an action before the live answer counts');
});

test('folded counts and newest New include visit marks once, while opening a stack preserves them', () => {
  const marks = new VisitNew('me');
  const messages = [message(1, 'me'), message(2, 'other', { reply_to: 'm1', unread: true }), message(3, 'other', { reply_to: 'm1', unread: false })];
  marks.arrive(messages.slice(1));
  const stack = gather(messages)[0], unread = item => item.unread === true || marks.has(item.id);
  assert.equal(rowsOf(stack, { level: 'head', unread }).find(row => row.kind === 'fold').fresh, 2);
  assert.equal(newestNew(stack, unread).id, 'm3');
  rowsOf(stack, { level: 'open', unread });
  assert.equal(marks.has('m2') && marks.has('m3'), true);
  marks.clear('m3');
  assert.equal(newestNew(stack, unread).id, 'm2');
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { TopicRail, questionOf } from '../web/topic-navigation.mjs';
import { presses, QuestionPresses, questionTarget } from '../web/waiting-questions.mjs';

test('item 372 topic painting never advances and same-page presses reach both questions then wrap', () => {
  const item = { id: 'synthetic-372-a', asks: [
    { actor_id: 'reader', message_id: 'm-a2', since_ms: 20 },
    { actor_id: 'someone-else', message_id: 'm-private', since_ms: 0 },
    { actor_id: 'reader', message_id: 'm-a1', since_ms: 10 },
  ] };
  presses.last.delete('topic:' + item.id);
  const rail = { lists: [{ pages: { items: [item] } }], reader: 'reader' };
  for (let n = 0; n < 3; n++) assert.equal(questionOf(item, 'reader'), 'm-a1');
  assert.deepEqual([1, 2, 3].map(() => TopicRail.prototype.question.call(rail, item.id, true)), ['m-a1', 'm-a2', 'm-a1']);
  assert.equal(questionOf(item, 'reader'), 'm-a1');
  assert.equal(TopicRail.prototype.question.call(rail, item.id, true), 'm-a2');
  item.asks = item.asks.filter(q => q.message_id !== 'm-a2');
  assert.equal(TopicRail.prototype.question.call(rail, item.id, true), 'm-a1', 'removed last question wraps to the eligible sibling');
});

test('item 372 four count identities cycle once including second Conversation, wrap and remember per place', () => {
  const storage = new Map();
  const tab = { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value) };
  const asks = [
    { topic_id: 'c', message_id: 'c2', ms: 30 },
    { topic_id: 'a', message_id: 'a1', ms: 10 },
    { topic_id: 'c', message_id: 'c1', ms: 20 },
    { topic_id: 'b', message_id: 'b1', ms: 10 },
  ];
  const next = place => new QuestionPresses(() => tab).next(place, asks);
  assert.deepEqual(Array.from({ length: 5 }, () => questionTarget(next('outcome:372'))), [
    { kind: 'topic', id: 'a', message: 'a1' }, { kind: 'topic', id: 'b', message: 'b1' },
    { kind: 'topic', id: 'c', message: 'c1' }, { kind: 'topic', id: 'c', message: 'c2' },
    { kind: 'topic', id: 'a', message: 'a1' },
  ]);
  assert.equal(next('conversation:372').message_id, 'a1', 'a separate place starts independently');
  assert.equal(next('outcome:372').message_id, 'b1');
});

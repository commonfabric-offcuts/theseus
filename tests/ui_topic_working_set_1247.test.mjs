import test from 'node:test';
import assert from 'node:assert/strict';
import { planTopicWindow, retainedRuns, boundMap } from '../web/topic-working-set.mjs';
import { TopicViews } from '../web/topic-views.mjs';

const item = seq => ({ id: 'm' + seq, seq, topic_id: 't', author_id: 'person', body: 'Words ' + seq });
const records = count => new Map(Array.from({ length: count }, (_, n) => { const row = item(n + 1); return [row.id, row]; }));
const oneRun = messages => new Map([...messages.keys()].map(id => [id, 1]));
const page = (from, to, next = null) => ({ instance_id: 'i', items: Array.from({ length: to - from + 1 }, (_, n) => item(from + n)),
  next_cursor: next, relevant_versions: { topic: to } });

test('1247 budget counts supplemental originals with their replies', () => {
  const messages = records(900), roots = new Map([...messages.keys()].map(id => [id, 'root-' + id]));
  const plan = planTopicWindow(messages, oneRun(messages), { roots });
  assert.equal(plan.full.size, 300); assert.equal(plan.keep.size, 150); assert.equal(plan.roots.size, 150);
  assert.equal(plan.blocked, false); assert.ok(plan.runs.length <= 8);
});
test('1247 a huge unread open dossier keeps the anchor inside the same budget', () => {
  const messages = records(1500), roots = new Map([...messages.keys()].map(id => [id, 'original']));
  for (const row of messages.values()) row.unread = true;
  const plan = planTopicWindow(messages, oneRun(messages), { roots, anchor: 'm750', pins: ['m750', 'm749'] });
  assert.equal(plan.full.size, 300); assert.equal(plan.keep.size, 299);
  assert.ok(plan.keep.has('m750')); assert.ok(plan.keep.has('m749')); assert.ok(plan.keep.has('m1500'));
  assert.equal(plan.roots.size, 1); assert.ok(plan.evict.length > 1000);
});
test('1247 eviction splits loaded intervals instead of claiming an unloaded hole is contiguous', () => {
  const messages = records(9), runs = oneRun(messages);
  assert.deepEqual(retainedRuns(messages, runs, new Set(['m1', 'm2', 'm5', 'm6', 'm9'])), [['m1', 'm2'], ['m5', 'm6'], ['m9']]);
  const sparse = new Map([['m1', item(1)], ['m9', item(9)]]);
  assert.deepEqual(retainedRuns(sparse, oneRun(sparse), new Set(sparse.keys())), [['m1', 'm9']], 'global seq gaps are not topic gaps');
});
test('1247 protected admission pressure is explicit and does not silently increase the budget', () => {
  const messages = records(10);
  const plan = planTopicWindow(messages, oneRun(messages), { budget: 2, pins: ['m1', 'm2', 'm3'], newest: 0 });
  assert.equal(plan.blocked, true); assert.deepEqual([...plan.rejectedPins], ['m3']); assert.equal(plan.full.size, 2);
});
test('1247 retained hints have a bounded lifetime', () => {
  const hints = new Map(Array.from({ length: 1000 }, (_, n) => ['m' + n, { seq: n, revision: 1 }]));
  boundMap(hints); assert.equal(hints.size, 256); assert.equal(hints.has('m0'), false); assert.equal(hints.has('m999'), true);
});
test('1247 actual TopicViews records plateau through sustained arrivals while a reading anchor survives', () => {
  const views = new TopicViews({ instanceId: 'i', topicId: 't', window: () => ({ pins: ['m1'], anchor: 'm1' }) });
  views.messagesPage(page(1, 30, 1), { initial: true });
  for (let n = 30; n < 1200; n += 30) {
    assert.equal(views.messagesPage(page(n + 1, n + 30), { live: true, cursor: n }), true);
    assert.ok(views.messages.size <= 300, `retained ${views.messages.size} after ${n + 30} arrivals`);
    assert.ok(views.messages.has('m1'));
  }
  assert.equal(views.newest, 1200);
});

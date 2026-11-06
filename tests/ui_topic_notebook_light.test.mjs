// A topic's own Notebook carries the "changed since you read it" light as the
// outcome's pages in the sidebar do: the loaded pages' read state is read
// again after a commit, a stale answer never relights a page, and a malformed
// read state is refused.
import test from 'node:test';
import assert from 'node:assert/strict';
import { TopicViews } from '../web/topic-views.mjs';

const scope = { kind: 'topic', id: 't1' };
const item = (n, revision, read_revision) => ({ id: 'n' + n, seq: n, owner_scope: scope, revision, read_revision,
  source_ref: { kind: 'memory', id: 'n' + n, revision }, body: 'body', title: 'title' });
const answer = (items, next_cursor = null) => ({ instance_id: 'i1', items, next_cursor, relevant_versions: { notebook: 3 } });
function views(items, next_cursor = null) {
  const painted = [];
  const v = new TopicViews({ instanceId: 'i1', topicId: 't1', paint: kind => painted.push(kind) });
  v.memoryPage(answer(items, next_cursor), { initial: true });
  painted.length = 0;
  return { v, painted };
}
const reads = v => Object.fromEntries([...v.memory.values()].map(i => [i.id, [i.revision, i.read_revision]]));

test('the loaded pages\' read state is read again from the start of the Notebook through the last page loaded', async () => {
  const { v, painted } = views([item(1, 3, 1), item(2, 1, 1)], 2);
  const asked = [];
  const pages = [answer([item(1, 3, 3)], 1), answer([item(2, 2, 1)], 2)];
  assert.equal(await v.readState(async (name, args) => { asked.push([name, args]); return pages.shift() ?? answer([], null); }, 1), true);
  assert.deepEqual(asked, [['memory_items', { owner_scope: scope, cursor: 0, limit: 1 }], ['memory_items', { owner_scope: scope, cursor: 1, limit: 1 }]]);
  assert.deepEqual(reads(v), { n1: [3, 3], n2: [2, 1] }, 'read here or on another device, the light goes out; revised since, it comes on');
  assert.deepEqual(painted, ['memory', 'offer']);
  assert.equal(v.memoryCursor, 2, 'the Notebook\'s own paging is left where it was');
});

test('a page beyond those loaded is not added by reading the read state', async () => {
  const { v } = views([item(1, 1, 1)], 1);
  await v.readState(async () => answer([item(1, 1, 1), item(2, 1, 0)], null));
  assert.deepEqual(Object.keys(reads(v)), ['n1']);
});

test('a stale answer at the same revision never relights a page read since', async () => {
  const { v } = views([item(1, 3, 1)]);
  await v.readState(async () => answer([item(1, 3, 3)]));
  await v.readState(async () => answer([item(1, 3, 1)]));
  assert.deepEqual(reads(v), { n1: [3, 3] });
  v.memoryItem(item(1, 3, 2));
  assert.deepEqual(reads(v), { n1: [3, 3] }, 'nor does a late keyed refresh');
});

test('a read state that is not a revision of the page read is refused', async () => {
  for (const bad of [-1, 4, '2', 1.5]) {
    const { v } = views([item(1, 3, 1)]);
    await assert.rejects(v.readState(async () => answer([item(1, 3, bad)])), /Notebook summary/, String(bad));
    assert.deepEqual(reads(v), { n1: [3, 1] });
  }
  const { v } = views([item(1, 3, 1)]);
  await assert.rejects(v.readState(async () => answer([item(1, 3, 3), item(1, 3, 3)])), /moved backwards/);
});

test('nothing loaded, nothing read', async () => {
  const { v } = views([]);
  assert.equal(await v.readState(async () => { throw Error('not asked'); }), true);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { DossierHeads, gather, ordered, withDossierHeads } from '../web/stack-order.mjs';
import { TopicViews } from '../web/topic-views.mjs';
const root = { id: 'root', topic_id: 't', seq: 1, author_id: 'a', body: 'Actual original\nSecond line', stack_position: { root_id: 'root', at: { acts: 1, messages: 1501 } } };
const reply = { id: 'reply', topic_id: 't', seq: 1501, author_id: 'b', body: 'Loaded answer', reply_to: 'root', stack_position: { root_id: 'root', placed: 2000, place_revision: 1, at: { acts: 1, messages: 1501 } } };
const page = items => ({ instance_id: 'i', items, next_cursor: 1501, relevant_versions: { topic: 1 } });
const tick = () => new Promise(resolve => setImmediate(resolve));
function fixture(read) {
  let current = true, changes = 0;
  const heads = new DossierHeads({ topicId: 't', read, changed: () => changes++, current: () => current });
  const loaded = new Map([[reply.id, reply]]);
  return { heads, loaded, retire: () => current = false, changes: () => changes };
}
test('799 actual admitted head wraps the loaded reply without filling its 1500-message gap or changing placement', async () => {
  const asked = [], f = fixture(async (name, args) => { asked.push([name, args]); return page([root]); });
  const views = new TopicViews({ instanceId: 'i', topicId: 't' });
  views.messagesPage(page([reply]), { initial: true });
  const before = [views.olderCursor, views.newest, [...views.runs]];
  f.heads.sync(views.messages); assert.equal(f.heads.records.get('root').state, 'loading'); await tick();
  assert.deepEqual(asked, [['topic_messages', { topic_id: 't', message_ids: ['root'] }]]);
  const stacks = ordered(gather([...views.messages.values()]));
  const [shown] = withDossierHeads(stacks, f.heads.messages(views.messages));
  assert.equal(shown.head.body, root.body); assert.equal(shown.id, root.id);
  assert.deepEqual(shown.replies.map(item => item.id), ['reply']);
  assert.ok(shown.branches.has('reply'), 'the formerly gathered head remains visible');
  assert.deepEqual([shown.placed, shown.newest, shown.lifted], [2000, 1501, 1501]);
  assert.deepEqual([views.olderCursor, views.newest, [...views.runs]], before);
  assert.equal(views.messages.has('root'), false);
  views.messagesPage(page([root]), { cursor: 1501 }); f.heads.sync(views.messages);
  assert.equal([...f.heads.messages(views.messages)].filter(([id]) => id === 'root').length, 1);
});
test('799 loaded heads and standalone negatives retain the actual gather objects', () => {
  for (const items of [[root, reply], [root]]) {
    const stacks = gather(items);
    assert.equal(withDossierHeads(stacks, new Map())[0], stacks[0]);
  }
});
test('799 withheld and absent sources never become available bodies; errors and refusals remain distinct', async () => {
  for (const [read, expected] of [
    [async () => page([{ ...root, withheld: true, body: 'Secret' }]), 'refused'],
    [async () => page([]), 'missing'],
    [async () => { throw Error('offline'); }, 'error'],
    [async () => { throw { details: { error: { code: 'FORBIDDEN' } } }; }, 'refused'],
    [async () => page([{ ...root, id: 'foreign' }]), 'missing'],
    [async () => page([{ ...root, topic_id: 'foreign' }]), 'error']]) {
    const f = fixture(read); f.heads.sync(f.loaded); await tick();
    assert.equal(f.heads.records.get('root').state, expected);
    assert.equal(f.heads.messages(f.loaded).has('root'), false);
  }
});
test('799 revision/admission invalidation drops old words and refuses stale results and abandoned navigation', async () => {
  const pending = [], f = fixture(() => new Promise(resolve => pending.push(resolve)));
  f.heads.sync(f.loaded); await tick();
  f.heads.invalidate('root'); f.heads.sync(f.loaded); await tick();
  pending[0](page([root])); await tick();
  assert.equal(f.heads.records.get('root').state, 'loading');
  pending[1](page([{ ...root, revision: 2, body: 'Current first line' }])); await tick();
  assert.equal(f.heads.messages(f.loaded).get('root').body, 'Current first line');
  f.heads.invalidate('root'); assert.equal(f.heads.messages(f.loaded).has('root'), false);
  f.heads.sync(f.loaded); await tick(); f.retire(); pending[2](page([root])); await tick();
  assert.equal(f.heads.messages(f.loaded).has('root'), false);
});
test('799 a changed exact root abandons its older pending source', async () => {
  let finish;
  const f = fixture(() => new Promise(resolve => finish = resolve));
  f.heads.sync(f.loaded); await tick();
  f.heads.sync(new Map([[reply.id, { ...reply, stack_position: { root_id: 'another' } }]]));
  finish(page([root])); await tick();
  assert.equal(f.heads.records.has('root'), false);
});

test('799 More cards kept apart do not acquire a duplicate supplemental head', () => {
  const stacks = gather([reply, { ...reply, id: 'older', seq: 100 }], { apart: new Set(['older']) });
  const result = withDossierHeads(stacks, new Map([['root', { ...root, dossierSource: true }]]), { apart: new Set(['older']) });
  assert.deepEqual(result.map(stack => stack.id), ['root', 'older']);
});

import { fillFrom, stackState } from '../web/reply-stacks.mjs';
test('799 actual More fill frontier excludes a supplemental root', () => {
  const list = {}, state = stackState(list), source = { ...root, dossierSource: true };
  state.stacks = withDossierHeads(gather([reply]), new Map([['root', source]]));
  fillFrom(list);
  assert.equal(state.filling.below, 1501, 'the actual loaded reply remains the frontier');
  assert.deepEqual([...state.filling.known], ['reply']);
  assert.equal(state.filling.into, 'root');
});

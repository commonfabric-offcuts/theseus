import test from 'node:test';
import assert from 'node:assert/strict';
import { coordinationStack } from '../web/coordination-stacks.mjs';
import { agentTalk } from '../web/card-reading.mjs';
import { gather } from '../web/stack-order.mjs';
const kinds = new Map([['owner', 'human'], ['builder', 'agent'], ['reviewer', 'agent']]);
const quiet = item => agentTalk(item, 'owner', 'human', name => kinds.get(name));
const message = (id, extra = {}) => ({ id, author_id: 'builder', author_kind: 'agent', addressees: ['reviewer'], ...extra });
const stack = (head = message('a'), replies = [message('b', { reply_to: 'a', reply_to_author: 'builder' })]) => ({ head, replies });
test('coordination is an entirely known agent exchange, including every joined message', () => {
  assert.equal(coordinationStack(stack(), quiet), true);
  for (const change of [{ addressees: [] }, { addressees: ['owner'] }, { addressees: ['unknown'] },
    { author_id: 'owner', author_kind: 'human' }, { reply_to_author: 'owner' }]) {
    assert.equal(coordinationStack(stack(message('a', change)), quiet), false, JSON.stringify(change));
    assert.equal(coordinationStack(stack(message('a'), [message('b', change)]), quiet), false, 'reply ' + JSON.stringify(change));
  }
  assert.equal(coordinationStack(stack(message('a', { reply_to: 'missing', reply_to_author: 'builder' })), quiet), false, 'unloaded ancestry is uncertain');
  assert.equal(coordinationStack(stack(message('a'), [message('b', { reply_to: 'missing', reply_to_author: 'builder' })]), quiet), false, 'a joined orphan is uncertain too');
});
test('new agent replies stay quiet; room and human-directed replies bring a stack back', () => {
  const s = stack();
  s.replies.push(message('c', { reply_to: 'b', reply_to_author: 'builder' }));
  assert.equal(coordinationStack(s, quiet), true);
  s.replies.push(message('d', { reply_to: 'c', addressees: [] }));
  assert.equal(coordinationStack(s, quiet), false);
  s.replies.pop();
  s.replies.push(message('d', { reply_to: 'c', addressees: ['owner'] }));
  assert.equal(coordinationStack(s, quiet), false);
});
test('a joined fragment stays visible until its destination is loaded and known to be coordination', () => {
  const fragment = [
    message('a', { seq: 2, acts: { joined: { into: 'destination' } } }),
    message('b', { seq: 3, reply_to: 'a', reply_to_author: 'builder' }),
  ];
  const classify = rows => {
    const stacks = gather(rows, { viewer: 'owner' });
    assert.equal(stacks.length, 1);
    return coordinationStack(stacks[0], quiet);
  };
  assert.equal(classify(fragment), false, 'an unloaded join is uncertain ancestry');
  assert.equal(classify([message('destination', { seq: 1 }), ...fragment]), true,
    'loading an explicitly agent-only destination permits coordination');
  for (const audience of [{ author_id: 'owner', author_kind: 'human' }, { addressees: [] }]) {
    assert.equal(classify([message('destination', { seq: 1, ...audience }), ...fragment]), false,
      'loading a human or room destination keeps the joined stack visible');
  }
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { renderer799 } from './fixtures/renderer799.mjs';
import { StackFeed } from '../web/stack-feed.mjs';

test('1119 fresh Archive explicitly requests reading and leaves local New until confirmation', () => {
  const r = renderer799(), acts = [], undos = [];
  const position = { root_id: 'root', through: null, aside_revision: 0, order_key: 7,
    starred: [], below: false, at: { messages: 2, acts: 0 } };
  const state = r.add([{ id: 'root', seq: 1, topic_id: 't1', author_id: 'other', unread: true, stack_position: position },
    { id: 'child', seq: 2, topic_id: 't1', author_id: 'other', unread: true, reply_to: 'root', stack_position: position }]);
  const feed = Object.assign(Object.create(StackFeed.prototype), { list: r.list,
    messages: () => r.messages, standIns: new Map(), actsOf: id => r.messages.get(id)?.acts ?? {},
    act: (...args) => acts.push(args), archiveShelf: () => null, arrange() {}, remember: undo => undos.push(undo), focusOn() {}, say() {} });
  assert.equal(feed.setAside(state.stacks[0], true, { focus: false }), true);
  assert.deepEqual(acts[0][2], { through: 2, clear_new: true }, '1119 manual Archive must opt into guarded reading');
  assert.deepEqual(acts[0][4], { quiet: true }, 'no optimistic acted() reading before confirmation');
  assert.equal(r.messages.get('child').unread, true);
  assert.equal(undos.length, 1);
});

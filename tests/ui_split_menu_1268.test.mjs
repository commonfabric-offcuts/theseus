import test from 'node:test';
import assert from 'node:assert/strict';
import { stackMenuItems } from '../web/stack-menu-items.mjs';
import { StackFeed } from '../web/stack-feed.mjs';
import { renderer799 } from './fixtures/renderer799.mjs';

for (const phone of [false, true]) test(`1268 header and reply menu reach unloaded/folded joins; phone=${phone}`, () => {
  for (const head of [false, true]) {
    const menu = stackMenuItems({ found: true, head, hasReplies: true, splitSources: true, phone }, () => {});
    assert.ok(menu.first.some(item => item.key === 'split-sources'), 'a loaded joined head is not required');
  }
});

function fixture({ state = 'unloaded', loaded = false } = {}) {
  const r = renderer799('reader'), position = { root_id: 'destination', name: { text: 'Destination' }, name_revision: 1,
    placed: 8, place_revision: 2, cover: { stands: 'Kept destination cover' }, through: state === 'archive' ? 4 : null,
    below: state === 'archive', at: { acts: 8, messages: 4 } };
  const destination = { id: 'destination', seq: 1, topic_id: 'topic', author_id: 'reader', acts: {}, stack_position: position };
  const source = { id: 'source', seq: 2, topic_id: 'topic', author_id: 'reader', body: 'Source words',
    acts: { joined: { into: 'destination' }, join_revision: 3, name: { text: 'Tracking changes' }, cover: { stands: 'Kept source cover' } }, stack_position: position };
  const reply = { id: 'reply', seq: 4, topic_id: 'topic', author_id: 'reader', reply_to: 'source', acts: {}, stack_position: position };
  r.add([destination, ...(loaded ? [source] : []), reply]);
  if (state === 'folded') r.add([]).levels.set('destination', 'folded');
  if (state === 'only-new') r.add([]).only = item => item.id === 'reply';
  const calls = [], reads = [], focuses = [], notices = [], menus = [];
  const feed = Object.create(StackFeed.prototype);
  Object.assign(feed, { list: r.list, messages: () => r.messages, instanceId: 'instance', viewer: 'reader',
    authority: () => ({ authority_id: 'authority', authority_epoch: 'epoch' }), readNamed: async (name, args) => {
      reads.push([name, args]); return { instance_id: 'instance', ...(name === 'message_acts' ? { topic_id: 'topic' } : {}), version: 8, next_cursor: null,
        items: name === 'message_acts' ? [{ message_id: 'source', seq: 2, acts: source.acts }] : [structuredClone(source)] };
    }, pending: new Map(), doubts: new Map(), undos: [], standIns: new Map(), drawn: new Map(), made: new WeakMap(), makes: 0,
    chain: Promise.resolve(), notices: new Map(), reads: 0, noticeShown: '',
    clock: () => 8, acted() {}, listen() {}, reread() {}, redrawn() {}, press: { after: (_, fn) => fn() },
    line: () => null, say: words => notices.push(words), status: words => notices.push(String(words)),
    arrange: () => r.add([]), focusOn: id => { focuses.push(id); r.list.ownerDocument.activeElement = feed.entryFor(id); },
    commandOf: async envelope => { calls.push(envelope); return { status: 'committed', result: { into: envelope.args.into, join_revision: calls.length + 3 } }; },
    refreshPositions: async () => { const into = calls.at(-1)?.args.into; r.messages.get('reply').stack_position = into === null ? { ...position, root_id: 'source' } : position; } });
  const show = items => {
    assert.ok(!menus.at(-1)?.root.isConnected, 'menu replacement closes the existing anchor first');
    const menu = { items, root: { isConnected: true }, close(restore) { this.root.isConnected = false; this.restore = restore; } };
    menus.push(menu); return menu;
  };
  const start = async (id = 'destination', phone = false) => {
    const menu = feed.menuItems(r.messages.get(id), { phone, more: show });
    const action = menu.first.find(item => item.key === 'split-sources'); assert.ok(action); await action.act();
  };
  const select = async () => { const menu = menus.at(-1), action = menu.items.find(item => item.key === 'split:source'); assert.ok(action); menu.close(true); await action.act(); };
  return { ...r, feed, source, position, calls, reads, focuses, notices, menus, start, select };
}
for (const state of ['unloaded', 'folded', 'only-new', 'archive', 'older-page']) test('1268 real feed menu splits source in ' + state + ' state and preserves dossier facts', async () => {
  const f = fixture({ state }); const before = structuredClone(f.source);
  await f.start('reply', state === 'only-new'); await f.select(); await f.feed.chain;
  assert.equal(f.calls.length, 1); assert.equal(f.calls[0].kind, 'stack.join');
  assert.deepEqual(f.calls[0].target, { message_id: 'source' }); assert.deepEqual(f.calls[0].args, { into: null });
  assert.equal(f.calls[0].expected.join_revision, 3); assert.deepEqual(f.calls[0].expected.authority, { authority_id: 'authority', authority_epoch: 'epoch' });
  assert.equal(f.messages.has('source'), false); assert.deepEqual([...f.messages.keys()], ['destination', 'reply']);
  assert.equal(f.source.acts.name.text, before.acts.name.text); assert.deepEqual(f.source.acts.cover, before.acts.cover);
  assert.equal(f.position.placed, 8); assert.equal(f.position.name.text, 'Destination'); assert.equal(f.position.cover.stands, 'Kept destination cover');
  assert.equal(f.focuses[0], 'reply', 'unloaded source keeps a surviving visible anchor');
  f.feed.undo(); await f.feed.chain;
  assert.equal(f.calls.length, 2); assert.deepEqual(f.calls[1].args, { into: 'destination' }); assert.equal(f.calls[1].expected.join_revision, 4);
});
test('1268 existing loaded direct split and Undo still use the confirmed command owner', async () => {
  const f = fixture({ loaded: true }); f.feed.split(f.messages.get('source')); await f.feed.chain;
  assert.equal(f.calls.length, 1); assert.equal(f.calls[0].expected.join_revision, 3); f.feed.undo(); await f.feed.chain;
  assert.deepEqual(f.calls.map(x => x.args.into), [null, 'destination']);
});
test('1268 discovery supplies newer source revision to a stale loaded copy', async () => {
  const f = fixture({ loaded: true }); f.messages.get('source').acts = { joined: { into: 'destination' }, join_revision: 1 };
  await f.start(); await f.select(); await f.feed.chain; assert.equal(f.calls[0].expected.join_revision, 3);
});
test('1268 a newer admitted loaded join wins over the late chosen-source read without being split', async () => {
  const f = fixture({ loaded: true }); let resolve; const wait = new Promise(done => { resolve = done; });
  const read = f.feed.readNamed; let count = 0;
  f.feed.readNamed = (...args) => ++count === 3 ? wait : read(...args);
  await f.start(); const selected = f.select();
  f.messages.get('source').acts = { joined: { into: 'another-branch' }, join_revision: 4 };
  resolve({ instance_id: 'instance', items: [structuredClone(f.source)], next_cursor: null });
  await selected; await f.feed.chain; assert.equal(f.calls.length, 0); assert.ok(f.notices.some(word => word.includes('join changed')));
});
for (const pending of ['pending', 'uncertain']) test('1268 discovery cannot duplicate a ' + pending + ' join operation', async () => {
  const f = fixture();
  if (pending === 'pending') f.feed.pending.set('source', [{ joined: null }]);
  else f.feed.doubts.set('original-operation', { kind: 'stack.join', item: f.source });
  await f.start(); await f.select(); await f.feed.chain; assert.equal(f.calls.length, 0);
});
test('1268 unknown split keeps the same operation for retry through existing recovery', async () => {
  const f = fixture(); let first;
  f.feed.commandOf = async envelope => { f.calls.push(envelope); first ??= envelope; if (f.calls.length === 1) throw Error('connection lost');
    return { status: 'committed', result: { into: null, join_revision: 4 } }; };
  await f.start(); await f.select(); await f.feed.chain; await new Promise(resolve => setImmediate(resolve));
  const [doubt] = f.feed.doubts.values(); assert.ok(doubt); assert.equal(doubt.envelope.operation_id, first.operation_id);
  await f.feed.send(doubt.kind, doubt.item, doubt.args, doubt.envelope);
  assert.deepEqual(f.calls[1], f.calls[0]); assert.equal(f.calls[1].expected.join_revision, 3);
});
test('1268 a final Core refusal stays a refusal and is not queued for automatic resend', async () => {
  const f = fixture(); f.feed.commandOf = async envelope => { f.calls.push(envelope); return {
    status: 'refused', recorded: true, error: { code: 'FORBIDDEN', message: 'No permission for this message' } }; };
  await f.start(); await f.select(); await f.feed.chain; await new Promise(resolve => setImmediate(resolve));
  assert.equal(f.calls.length, 1); assert.equal(f.feed.doubts.size, 0); assert.ok(f.notices.length);
});
test('1268 missing feed/Reader context does not add the discovery action', () => {
  for (const flags of [{ reader: true, found: true }, { found: false }]) {
    const menu = stackMenuItems({ ...flags, splitSources: true }, () => {});
    assert.ok(!menu.first.some(item => item.key === 'split-sources'));
  }
});

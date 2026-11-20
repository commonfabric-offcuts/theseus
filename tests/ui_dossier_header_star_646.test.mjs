import test from 'node:test';
import assert from 'node:assert/strict';
import { StackFeed } from '../web/stack-feed.mjs';
import { miniDocument } from './fixtures/mini_dom.mjs';
const gate = () => { let resolve; const promise = new Promise(r => resolve = r); return { promise, resolve }; };
function fixture({ loaded = false, starred = false, read } = {}) {
  const first = { id: 'first', topic_id: 'topic', acts: { starred, star_revision: 7 }, stack_position: { root_id: 'first' } };
  const reply = { id: 'reply', topic_id: 'topic', acts: { starred: true, star_revision: 3 }, stack_position: { root_id: 'first', starred: starred ? ['first', 'reply'] : ['reply'] } };
  const messages = new Map([['reply', reply], ...(loaded ? [['first', { ...first, acts: { starred: !starred, star_revision: 6 } }]] : [])]);
  const calls = [], reads = [], notices = [], seen = [], doc = miniDocument(), feed = Object.create(StackFeed.prototype);
  const stack = { id: 'reply', dossier: 'first', head: reply, replies: [] };
  Object.assign(feed, { list: doc.createElement('div'), messages: () => messages, instanceId: 'instance', viewer: 'me',
    authority: () => ({ authority_id: 'authority', authority_epoch: 'epoch' }),
    readNamed: async (name, args) => { reads.push([name, args]); return read ? read(first) : { instance_id: 'instance', items: [first] }; },
    headerStars: new Set(), pending: new Map(), doubts: new Map(), standIns: new Map(), drawn: new Map(), made: new WeakMap(), makes: 0, chain: Promise.resolve(),
    hold: fn => fn(), entryFor: id => ({ dataset: { id } }), arrange() {}, say: text => notices.push(text), status: text => notices.push(String(text)),
    refreshPositions: async () => { reply.stack_position.starred = ['reply', ...(calls.at(-1)?.args.starred ? ['first'] : [])]; },
    line: () => null, clock: () => 1, starsChanged() {}, redrawn() {}, press: { after: (_, fn) => fn() },
    acted: id => seen.push(id), failed: (_, error) => notices.push(error.message), paintNotice() {},
    commandOf: async envelope => { calls.push(envelope); return { status: 'committed', result: { starred: envelope.args.starred, star_revision: 8 } }; } });
  feed.state.stacks = [stack];
  return { feed, stack, first, reply, messages, calls, reads, notices, seen };
}
for (const loaded of [false, true]) for (const starred of [false, true]) {
  test(`646 toggles actual first with confirmed revision; loaded=${loaded}, starred=${starred}`, async () => {
    const f = fixture({ loaded, starred }); await f.feed.starDossier(f.stack);
    assert.deepEqual(f.reads, [['topic_messages', { topic_id: 'topic', message_ids: ['first'] }]]);
    assert.equal(f.calls.length, 1);
    assert.equal(f.calls[0].kind, 'message.star'); assert.deepEqual(f.calls[0].target, { message_id: 'first' });
    assert.deepEqual(f.calls[0].args, { starred: !starred }); assert.equal(f.calls[0].expected.star_revision, 7);
    assert.deepEqual(f.seen, [], 'header toggle does not clear visit New marks');
    assert.equal(f.reply.acts.starred, true); assert.equal(f.feed.firstStarred(f.stack), !starred);
    assert.equal(f.messages.has('first'), loaded, 'named read does not insert a message into page pagination');
  });
}
for (const bad of ['foreign instance', 'wrong id', 'foreign topic', 'moved root', 'missing', 'withheld']) {
  test('646 rejects ' + bad + ' before any command', async () => {
    const f = fixture({ read: first => ({ instance_id: bad === 'foreign instance' ? 'other' : 'instance', items: bad === 'missing' ? [] : [{ ...first,
      ...(bad === 'wrong id' ? { id: 'reply' } : {}), ...(bad === 'foreign topic' ? { topic_id: 'other' } : {}),
      ...(bad === 'moved root' ? { stack_position: { root_id: 'other' } } : {}), ...(bad === 'withheld' ? { withheld: true } : {}) }] }) });
    await f.feed.starDossier(f.stack); assert.deepEqual(f.calls, []); assert.ok(f.notices.length);
  });
}
for (const change of ['visit retired', 'anchor moved']) {
  test('646 late lookup cannot act after ' + change, async () => {
    const wait = gate(), f = fixture({ read: () => wait.promise });
    const pending = f.feed.starDossier(f.stack);
    if (change === 'visit retired') f.feed.gone = true;
    else f.reply.stack_position.root_id = 'elsewhere';
    wait.resolve({ instance_id: 'instance', items: [f.first] }); await pending;
    assert.deepEqual(f.calls, []);
  });
}
test('646 repeated press while lookup or command is pending sends once', async () => {
  const wait = gate(), send = gate(), f = fixture({ read: () => wait.promise });
  f.feed.commandOf = async envelope => { f.calls.push(envelope); return send.promise; };
  const first = f.feed.starDossier(f.stack); await f.feed.starDossier(f.stack);
  assert.equal(f.reads.length, 1);
  wait.resolve({ instance_id: 'instance', items: [f.first] }); await new Promise(resolve => setImmediate(resolve));
  await f.feed.starDossier(f.stack); assert.equal(f.calls.length, 1);
  send.resolve({ status: 'committed', result: { starred: true, star_revision: 8 } }); await first;
  assert.equal(f.feed.headerStars.size, 0);
});
test('646 uncertain star uses existing recovery instead of a new operation', async () => {
  const f = fixture(); f.feed.doubts.set('old-op', { kind: 'message.star', item: f.first });
  await f.feed.starDossier(f.stack); assert.deepEqual(f.reads, []); assert.deepEqual(f.calls, []);
});
test('646 reply-only star is hollow, unloaded first uses named dossier membership', () => {
  const f = fixture(); assert.equal(f.feed.firstStarred(f.stack), false);
  f.reply.stack_position.starred.push('first'); assert.equal(f.feed.firstStarred(f.stack), true);
});

test('646 unloaded first follows fresh dossier membership after an external unstar', async () => {
  const f = fixture(); await f.feed.starDossier(f.stack); assert.equal(f.feed.firstStarred(f.stack), true);
  f.reply.stack_position.starred = ['reply']; assert.equal(f.feed.firstStarred(f.stack), false);
});

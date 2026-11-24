import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { StackFeed, stackActEnvelope } from '../web/stack-feed.mjs';
import { captureArchivedNew } from '../web/archive-new.mjs';
import { Marks } from '../web/marks.mjs';
import { VisitNew } from '../web/visit-new.mjs';

// Real reading/command owners, deterministic receipt transport. No DOM timing
// or native gesture claims; existing rail/key cohorts cover dispatch ownership.
const authority = () => ({ authority_id: 'authority', authority_epoch: 'epoch' });
function fixture() {
  const messages = new Map([
    ['root', { id: 'root', topic_id: 't1', seq: 1, author_id: 'other', revision: 1, unread: true, acts: { aside_revision: 0 }, stack_position: { root_id: 'root' } }],
    ['child', { id: 'child', topic_id: 't1', seq: 2, author_id: 'other', revision: 1, unread: true, stack_position: { root_id: 'root' } }],
    ['else', { id: 'else', topic_id: 't1', seq: 3, author_id: 'other', revision: 1, unread: true, stack_position: { root_id: 'else' } }],
    ['mine', { id: 'mine', topic_id: 't1', seq: 4, author_id: 'reader', revision: 1, unread: false, stack_position: { root_id: 'root' } }],
  ]);
  const marks = new Marks({ api: { command: () => assert.fail('Archive must not issue separate mark commands') }, instanceId: 'i', authority, doc: null, win: {} });
  for (const id of ['root', 'child', 'else']) marks.learn(id, 1, { topicId: 't1', seq: messages.get(id).seq });
  const visit = new VisitNew('reader'); visit.arrive([...messages.values()]);
  const calls = []; let current = true, captures = 0, changes = 0, refreshes = 0;
  const capture = () => { captures++; return captureArchivedNew({ root: 'root', through: 2, messages: () => messages,
    viewer: 'reader', marks, visit, revisionOf: item => item.revision, current: () => current, changed: () => { changes++; } }); };
  const request = stackActEnvelope({ instanceId: 'i', authority: authority(), kind: 'stack.aside', item: messages.get('root'), args: { through: 2, clear_new: true } });
  const committed = () => ({ status: 'committed', recorded: true, operation_id: request.operation_id,
    result: { message_id: 'root', topic_id: 't1', through: 2, aside_revision: 1, changed: true,
      cleared_new: { through: 2, deliveries: 2, marks: 2 } } });
  const feed = Object.assign(Object.create(StackFeed.prototype), { messages: () => messages, viewer: 'reader', instanceId: 'i', authority, clock: () => 1,
    captureArchive: capture, commandOf: async envelope => { calls.push(envelope); return committed(); },
    refreshPositions: async () => { refreshes++; } });
  const send = () => feed.send('stack.aside', messages.get('root'), request.args, request);
  return { messages, marks, visit, feed, request, committed, send, capture, calls,
    retire: () => { current = false; }, counts: () => ({ captures, changes, refreshes }) };
}

test('1119 matching confirmed receipt clears only captured dossier reading and repaints once', async () => {
  const f = fixture(); await f.send();
  for (const id of ['root', 'child']) {
    assert.equal(f.messages.get(id).unread, false); assert.equal(f.visit.has(id), false);
    assert.deepEqual(f.marks.state(id), { marked: false, mark_revision: 2 });
  }
  assert.equal(f.messages.get('else').unread, true); assert.equal(f.visit.has('else'), true);
  assert.equal(f.marks.state('else').marked, true); assert.equal(f.visit.has('mine'), false);
  assert.deepEqual(f.counts(), { captures: 1, changes: 1, refreshes: 1 });
});

test('1119 network uncertainty retains original operation and capture across explicit retry', async () => {
  const f = fixture(); let first = true;
  f.feed.commandOf = async envelope => { f.calls.push(envelope); if (first) { first = false; throw Error('lost receipt'); } return f.committed(); };
  await assert.rejects(f.send()); assert.equal(f.visit.has('child'), true); assert.equal(f.messages.get('child').unread, true);
  f.marks.learn('child', 3); await f.send();
  assert.deepEqual(f.calls, [f.request, f.request]); assert.equal(f.counts().captures, 1);
  assert.equal(f.marks.state('child').mark_revision, 3); assert.equal(f.marks.state('child').marked, true);
  assert.equal(f.marks.state('root').marked, false);
});

test('1119 recorded refusal settles the capture without reading any loaded message', async () => {
  const f = fixture(); f.feed.commandOf = async () => ({ status: 'rejected', recorded: true, operation_id: f.request.operation_id,
    error: { code: 'REVISION_CONFLICT', message: 'changed' } });
  await assert.rejects(f.send()); assert.equal(f.feed.archiveReads.size, 0);
  assert.equal(f.messages.get('child').unread, true); assert.equal(f.visit.has('child'), true); assert.equal(f.marks.state('child').marked, true);
});

const invalidReceipts = [
  ['unrecorded', r => { r.recorded = false; }],
  ['wrong operation', r => { r.operation_id = 'another'; }],
  ['wrong root', r => { r.result.message_id = 'else'; }],
  ['wrong topic', r => { r.result.topic_id = 't2'; }],
  ['wrong horizon', r => { r.result.through = 3; }],
  ['missing read summary', r => { delete r.result.cleared_new; }],
  ['negative count', r => { r.result.cleared_new.marks = -1; }],
];
for (const [label, mutate] of invalidReceipts) test('1119 ' + label + ' cannot authorize local reading', async () => {
  const f = fixture(), receipt = f.committed(); mutate(receipt); f.feed.commandOf = async () => receipt;
  await assert.rejects(f.send()); assert.equal(f.counts().changes, 0);
  assert.equal(f.messages.get('child').unread, true); assert.equal(f.marks.state('child').marked, true); assert.equal(f.visit.has('child'), true);
});

test('1119 later arrivals survive a receipt through the older observed boundary', async () => {
  const f = fixture(); const finish = f.capture();
  const later = { id: 'later', topic_id: 't1', seq: 5, author_id: 'other', revision: 1, unread: true, stack_position: { root_id: 'root' } };
  f.messages.set('later', later); f.visit.arrive([later]); f.marks.learn('later', 1);
  finish(); assert.equal(later.unread, true); assert.equal(f.visit.has('later'), true); assert.equal(f.marks.state('later').marked, true);
  assert.equal(f.messages.get('child').unread, false);
});

test('1119 edited removed or rejoined members keep their newer loaded state', () => {
  const f = fixture(), finish = f.capture();
  f.messages.get('root').revision = 2; f.messages.get('child').stack_position.root_id = 'else';
  finish(); assert.equal(f.messages.get('root').unread, true); assert.equal(f.visit.has('root'), true);
  assert.equal(f.messages.get('child').unread, true); assert.equal(f.marks.state('child').marked, true);
  const another = fixture(), after = another.capture(); another.messages.delete('child');
  assert.doesNotThrow(after); assert.equal(another.marks.state('child').marked, true);
});

test('1119 retired page and disposed feed reject late reading effects', async () => {
  const f = fixture(); f.feed.commandOf = async () => { f.retire(); return f.committed(); }; await f.send();
  assert.equal(f.counts().changes, 0); assert.equal(f.messages.get('child').unread, true);
  const gone = fixture(); gone.feed.commandOf = async () => { gone.feed.gone = true; return gone.committed(); }; await gone.send();
  assert.equal(gone.visit.has('child'), true);
});

test('1119 confirmed capture is one shot and does not clear a renewed mark on replay', () => {
  const f = fixture(), finish = f.capture(); assert.equal(finish(), true);
  f.marks.learn('child', 3); assert.equal(finish(), false); assert.equal(f.marks.state('child').marked, true);
  assert.equal(f.counts().changes, 1);
});

test('1119 positional Bring back sends no clear-New contract or separate reading', async () => {
  const f = fixture(); f.feed.commandOf = async envelope => ({ status: 'committed', recorded: true, operation_id: envelope.operation_id,
    result: { through: null, aside_revision: 2 } });
  await f.feed.send('stack.aside', f.messages.get('root'), { through: null });
  assert.equal(f.counts().captures, 0); assert.equal(f.messages.get('child').unread, true); assert.equal(f.marks.state('child').marked, true);
});

test('1119 app reading capture rejects changed topic epoch authority and pending review', () => {
  const source = readFileSync(new URL('../web/app.mjs', import.meta.url), 'utf8');
  const at = source.indexOf('function captureArchiveReading('), end = source.indexOf('function clearVisitNew(', at);
  assert.ok(at >= 0 && end > at);
  const setup = () => {
    let captured;
    const env = { listAccessEpoch: 1, topic: { id: 't1' }, bootstrap: { instance_id: 'i', actor: 'reader' },
      registry: { disposed: false, runtime: { current: authority() } }, retired: false, topicUnavailable: false,
      authorityReviewPending: () => false, captureArchivedNew: options => { captured = options; return () => {}; },
      feedMessages() {}, marks: {}, visitNew: {}, revisionOf() {}, keepListAnchor() {}, stackMessages() {}, paintCardReading() {},
      paintMessageUpdates() {}, attention: null, commitReload: null, run() {} };
    // Mutable bindings mirror one app run, without loading an app or browser.
    const make = new Function('env', 'with(env) {' + source.slice(at, end) + '; return captureArchiveReading; }');
    const capture = make(env); capture('root', 2); return { env, current: () => captured.current() };
  };
  for (const change of [f => { f.env.listAccessEpoch++; }, f => { f.env.topic.id = 't2'; },
    f => { f.env.registry.runtime.current.authority_epoch = 'next'; }, f => { f.env.registry.disposed = true; },
    f => { f.env.authorityReviewPending = () => true; }, f => { f.env.retired = true; }]) {
    const f = setup(); assert.equal(f.current(), true); change(f); assert.equal(f.current(), false);
  }
});

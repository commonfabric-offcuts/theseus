import test from 'node:test';
import assert from 'node:assert/strict';
import { laterActs, rowsOf } from '../web/stack-order.mjs';
import { StackFeed, stackActEnvelope } from '../web/stack-feed.mjs';
import { TopicViews } from '../web/topic-views.mjs';
import { arrangeStacks, stackState, levelOf, reveal } from '../web/reply-stacks.mjs';
import { miniDocument, Element } from './fixtures/mini_dom.mjs';
import { withReaderArchive } from './fixtures/reader_archive.mjs';

// The existing small renderer fixture supplies nodes/selectors, not layout,
// native input or timing. These adapters match ui_dossier_renderer_799.
const query = Element.prototype.querySelectorAll;
Element.prototype.querySelectorAll = function(selector) {
  if (selector === '*') return [...this.descendants()];
  if (selector.includes(', ')) return [...new Set(selector.split(', ').flatMap(part => this.querySelectorAll(part)))];
  const values = [...selector.matchAll(/\[data-([\w-]+)=([^\]]+)\]/g)];
  if (values.length) return this.querySelectorAll(selector.replace(/\[data-([\w-]+)=([^\]]+)\]/g, '[data-$1]'))
    .filter(e => values.every(([, key, value]) => e.dataset[key.replace(/-([a-z])/g, (_, c) => c.toUpperCase())] === value.replace(/[\"']/g, '')));
  const parts = selector.split(' > ');
  if (parts.length > 2) return query.call(this, parts.slice(0, 2).join(' > ')).flatMap(child => child.querySelectorAll(':scope > ' + parts.slice(2).join(' > ')));
  return query.call(this, selector);
};
Object.defineProperties(Element.prototype, {
  firstElementChild: { get() { return this.children[0] ?? null; } },
  nextElementSibling: { get() { return this.parent?.children[this.parent.children.indexOf(this) + 1] ?? null; } },
  parentElement: { get() { return this.parent; } },
  style: { get() { return { setProperty() {}, removeProperty() {} }; } },
});
Element.prototype.contains = function(node) { return node === this || [...this.descendants()].includes(node); };

const position = (level, revision, acts = revision) => ({
  root_id: 'root', level, level_revision: revision, through: null, below: false,
  aside_revision: 0, name: null, name_revision: 0, join_revision: 0,
  placed: null, place_revision: 0, starred: [], at: { messages: 0, acts },
});

test('858 a stale act answer cannot reverse the reader\'s newer saved choice', () => {
  const known = { level: 'folded', level_revision: 4, folded: true, fold_revision: 2 };
  assert.deepEqual(laterActs(known, { level: 'open', level_revision: 3 }), known);
  assert.deepEqual(laterActs(known, { starred: true, star_revision: 1 }), { ...known, starred: true, star_revision: 1 });
  assert.equal(laterActs(known, { level: null, level_revision: 5 }).level, null, 'clear is a newer choice too');
});

test('858 a remote level alone refreshes every loaded fragment without moving unrelated dossiers', () => {
  const views = new TopicViews({ instanceId: 'fixture', topicId: 'topic' });
  for (const id of ['a', 'b']) views.messages.set(id, { id, stack_position: position(null, 0) });
  views.messages.set('other', { id: 'other', stack_position: { ...position(null, 0), root_id: 'other' } });
  const folded = position('folded', 1);
  assert.equal(views.learnPositions([{ message_id: 'a', stack_position: folded }]), true);
  for (const id of ['a', 'b']) assert.deepEqual(views.messages.get(id).stack_position, folded);
  assert.equal(views.messages.get('other').stack_position.level, null);
  assert.equal(views.learnPositions([{ message_id: 'b', stack_position: position(null, 0) }]), false);
  assert.equal(views.learnPositions([{ message_id: 'b', stack_position: { ...folded, at: { messages: 0, acts: 2 } } }]), false,
    'a later watermark alone does not repaint');
});

test('858 a page of replies targets the unloaded canonical root with its exact level fence', () => {
  const place = position('folded', 7), reply = { id: 'reply', stack_position: place };
  const stack = { id: 'reply', dossier: 'root', head: reply, replies: [] };
  const feed = { state: { stacks: [stack] }, messages: () => new Map([['reply', reply]]), standIns: new Map() };
  const root = StackFeed.prototype.rootOf.call(feed, stack).item;
  assert.equal(root.id, 'root');
  assert.deepEqual({ level: root.acts.level, level_revision: root.acts.level_revision }, { level: 'folded', level_revision: 7 });
  const envelope = stackActEnvelope({ instanceId: 'fixture', authority: { authority_id: 'a', authority_epoch: 2 },
    kind: 'stack.level', item: root, args: { level: 'open' }, operationId: 'one-858-choice' });
  assert.deepEqual(envelope, { v: 1, instance_id: 'fixture', operation_id: 'one-858-choice', kind: 'stack.level',
    target: { message_id: 'root' }, expected: { level_revision: 7, authority: { authority_id: 'a', authority_epoch: 2 } }, args: { level: 'open' } });
});

function renderer(level = null, revision = 0) {
  const doc = withReaderArchive(miniDocument()), list = doc.createElement('div'); list.root = true; list.id = 'messages';
  const root = { id: 'root', topic_id: 'topic', seq: 1, author_id: 'writer', body: 'Dossier first message',
    acts: {}, stack_position: position(level, revision) };
  const messages = new Map([['root', root]]), cards = new Map();
  for (let n = 1; n <= 3; n++) messages.set('r' + n, { ...root, id: 'r' + n, seq: n + 1,
    body: 'Reply ' + n, reply_to: 'root', acts: n === 1 ? { folded: true, fold_revision: 1 } : {} });
  for (const item of messages.values()) {
    const card = doc.createElement('button'); card.className = 'message-card'; card.dataset.id = item.id; card.dataset.seq = String(item.seq);
    const author = doc.createElement('span'); author.className = 'message-author'; author.textContent = item.author_id;
    const body = doc.createElement('span'); body.className = 'message-preview'; body.textContent = item.body;
    card.append(author, body); list.append(card); cards.set(item.id, card);
  }
  const draw = () => arrangeStacks(list, messages, { doc, viewer: 'reader' });
  const update = (next, rev, acts = rev) => { for (const item of messages.values()) item.stack_position = position(next, rev, acts); };
  draw();
  return { list, messages, cards, draw, update, state: stackState(list) };
}

test('858 a fresh actual renderer honors the saved choice and preserves personal message folds', () => {
  const folded = renderer('folded', 1);
  assert.equal(levelOf(folded.state, 'root'), 'folded');
  assert.equal(folded.state.sections.get('root').dataset.fold, 'folded');
  assert.equal(folded.state.folded.has('r1'), true);
  const freshVisit = renderer('folded', 1);
  assert.equal(freshVisit.state.sections.get('root').dataset.fold, 'folded', 'a different list restores the Core preference');
  assert.equal(renderer(null, 0).state.sections.get('root').dataset.fold, 'open', 'ordinary default on actual336 is open');
  folded.update('open', 2); folded.draw();
  assert.equal(folded.state.sections.get('root').dataset.fold, 'open');
  assert.equal(folded.state.folded.has('r1'), true, 'opening the dossier never unfolds each message');
});

test('858 temporary link reveal survives unchanged reads but a later explicit Core choice takes effect', () => {
  const page = renderer('folded', 1);
  reveal(page.cards.get('r2'), { open: true });
  assert.equal(levelOf(page.state, 'root'), 'open');
  for (const item of page.messages.values()) assert.equal(item.stack_position.level, 'folded', 'reveal writes no preference');
  page.update('folded', 1, 2); page.draw();
  assert.equal(levelOf(page.state, 'root'), 'open', 'a read with the same preference preserves the temporary reveal');
  page.state.kept.add('r2');
  page.update('folded', 2, 3); page.draw();
  assert.equal(levelOf(page.state, 'root'), 'folded', 'a new explicit choice supersedes the temporary view');
  assert.equal(page.state.kept.has('r2'), true, 'remote projection does not release writing/reading holds');
});

test('858 the existing quiet-header fallback remains a default, outside the two explicit states', () => {
  const state = { levels: new Map(), coordination: new Set(['agents']) };
  assert.equal(levelOf(state, 'ordinary'), 'open');
  assert.equal(levelOf(state, 'agents'), 'head');
  state.levels.set('agents', 'open');
  assert.equal(levelOf(state, 'agents'), 'open');
  state.levels.set('ordinary', 'head');
  assert.equal(levelOf(state, 'ordinary'), 'folded');
});

function queuedFeed() {
  const doc = miniDocument(), feed = Object.create(StackFeed.prototype), calls = [], seen = [], notices = [], failures = [];
  const root = { id: 'root', topic_id: 'topic', acts: { level: null, level_revision: 0 } };
  const reply = { id: 'reply', topic_id: 'topic', acts: {}, stack_position: position(null, 0) };
  const messages = new Map([['reply', reply]]), stack = { id: 'reply', dossier: 'root', head: reply, replies: [] };
  Object.assign(feed, { list: doc.createElement('div'), messages: () => messages, standIns: new Map(), pending: new Map(),
    drawn: new Map(), made: new WeakMap(), makes: 0, chain: Promise.resolve(), undos: [],
    instanceId: 'fixture', authority: () => ({ authority_id: 'a', authority_epoch: 2 }), viewer: 'reader',
    clock: () => 1, acted: id => seen.push(id), say: text => notices.push(text), reread: () => notices.push('reread'),
    settled() {}, failed: (act, error) => failures.push({ act, error }),
    refreshPositions: async () => { const now = feed.standIns.get('root').acts;
      reply.stack_position = position(now.level, now.level_revision); },
    commandOf: async envelope => { calls.push(envelope); assert.equal(envelope.expected.level_revision, root.acts.level_revision);
      root.acts = { level: envelope.args.level, level_revision: root.acts.level_revision + 1 };
      return { status: 'committed', result: { ...root.acts } }; },
  });
  feed.state.stacks = [stack];
  feed.arrange = () => { const projected = feed.shownMessages().get('reply').stack_position;
    feed.state.savedLevels.set('reply', { level: projected.level, revision: projected.level_revision }); };
  return { feed, stack, root, reply, messages, calls, seen, notices, failures };
}

test('858 queued rapid choices and Undo use canonical root and successive receipt fences, including null', async () => {
  const f = queuedFeed();
  f.feed.setDossierLevel(f.stack, 'folded'); f.feed.arrange();
  assert.equal(levelOf(f.feed.state, 'reply'), 'folded', 'optimistic position shows before Core answers');
  f.feed.setDossierLevel(f.stack, 'open'); f.feed.arrange();
  f.feed.undo(); f.feed.arrange();
  await f.feed.chain;
  assert.deepEqual(f.calls.map(e => [e.target.message_id, e.args.level, e.expected.level_revision]),
    [['root', 'folded', 0], ['root', 'open', 1], ['root', 'folded', 2]]);
  assert.equal(new Set(f.calls.map(e => e.operation_id)).size, 3);
  f.feed.undo(); await f.feed.chain; f.feed.arrange();
  assert.deepEqual([f.calls.at(-1).args.level, f.calls.at(-1).expected.level_revision], [null, 3]);
  assert.equal(levelOf(f.feed.state, 'reply'), 'open', 'Undo restores the ordinary default, without manufacturing head');
  assert.deepEqual(f.seen, [], 'saving/Undo itself clears no loaded arrival mark');
  assert.deepEqual(f.failures, []);
});

test('858 a refused level leaves no optimistic or visit-only saved choice', async () => {
  const f = queuedFeed();
  f.feed.commandOf = async envelope => { f.calls.push(envelope); return { status: 'refused', error: { code: 'STACK_CHANGED' } }; };
  f.feed.setDossierLevel(f.stack, 'folded'); f.feed.arrange();
  assert.equal(levelOf(f.feed.state, 'reply'), 'folded');
  await f.feed.chain; f.feed.arrange();
  assert.equal(f.feed.pending.size, 0);
  assert.equal(levelOf(f.feed.state, 'reply'), 'open');
  assert.equal(f.failures.length, 1);
  assert.equal(f.failures[0].error.envelope.operation_id, f.calls[0].operation_id);
  assert.equal(f.root.acts.level_revision, 0);
});

test('858 an unanswered command retries its exact operation and cannot reverse a later Undo', async () => {
  const f = queuedFeed(), original = f.feed.commandOf;
  let lost;
  f.feed.commandOf = async envelope => { const receipt = await original(envelope); lost = receipt; throw Error('actual reply lost after simulated Core commit'); };
  const item = f.feed.rootOf(f.stack).item;
  let failure;
  try { await f.feed.send('stack.level', item, { level: 'folded' }); } catch (error) { failure = error; }
  assert.equal(f.root.acts.level_revision, 1, 'the simulated server actually committed');
  // Another session has since undone that choice at a newer revision.
  item.acts = { level: null, level_revision: 2 };
  f.feed.commandOf = async envelope => { f.calls.push(envelope); return lost; };
  await f.feed.send('stack.level', item, { level: 'folded' }, failure.envelope);
  assert.deepEqual(f.calls[1], f.calls[0], 'same operation, payload, authority and revision');
  assert.deepEqual(item.acts, { level: null, level_revision: 2 }, 'late receipt does not reverse later Undo');
});


test('858 open inline writing remains visible across a remote collapse and releases with its own composer', () => {
  const page = renderer('open', 1);
  page.cards.get('r2').setAttribute('data-card-reply', '');
  page.cards.get('root').setAttribute('data-card-reply', '');
  page.update('folded', 2); page.draw();
  assert.equal(page.state.sections.get('root').dataset.fold, 'folded');
  assert.equal(page.state.sections.get('root').dataset.headOpen, 'true', 'first-message writing remains open');
  assert.equal(page.cards.get('r2').hidden, false, 'reply writing remains visible');
  assert.equal(page.state.folded.has('r1'), true, 'another message keeps its own fold');
  page.cards.get('r2').removeAttribute('data-card-reply');
  page.cards.get('root').removeAttribute('data-card-reply'); page.draw();
  assert.equal(page.cards.get('r2').hidden, true, 'the writing hold ends when its owner closes it');
  assert.equal(page.state.sections.get('root').dataset.headOpen, 'false');
});

test('858 writing outside the newest seven and in quiet coordination stays whole without changing its stored fold', () => {
  const root = { id: 'root', seq: 1 }, replies = Array.from({ length: 9 }, (_, n) => ({ id: 'r' + n, seq: n + 2,
    acts: { folded: n === 0 } }));
  const stack = { head: root, replies, joins: new Map() }, writing = item => item.id === 'r0';
  for (const level of ['open', 'folded', 'head']) {
    const rows = rowsOf(stack, { level, writing });
    const row = rows.find(row => row.kind === 'reply' && row.item.id === 'r0');
    assert.ok(row, 'open composer remains drawn at ' + level);
    assert.equal(row.folded, false);
    assert.ok(!rows.some(row => row.kind === 'earlier' && row.items.some(item => item.id === 'r0')));
  }
  assert.equal(replies[0].acts.folded, true, 'writing presentation does not change Core message fold');
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveTopicLink, topicLinkNeedsLookup } from '../web/topic-link-route.mjs';
import { topicPosition, TopicNavigation } from '../web/topic-navigation.mjs';
const topic = (id, title, workspace_id = 'w1', extra = {}) => ({ id, title, workspace_id, list_position: 100, state: 'active', archived: false, ...extra });
const scope = (id, rows = []) => ({ id, rows, title: id, owner_id: 'reader', title_truncated: false, version: 1 });
function fixture(workspaces) {
  const calls = [], pages = new Map(), truncated = new Map();
  const read = async (name, args) => {
    calls.push({ name, args }); const answer = { instance_id: 'i' };
    if (name === 'memory_current') return { ...answer, ...pages.get(args.item_id) };
    if (name === 'topic') {
      const found = truncated.get(args.topic_id) ?? workspaces.flatMap(w => w.rows).find(t => t.id === args.topic_id);
      if (!found) throw Object.assign(Error('Unavailable'), { code: 'FORBIDDEN' }); return { ...answer, topic: found };
    }
    if (name === 'conversation') return { ...answer, conversation: null };
    if (name === 'workspaces') {
      const all = [...workspaces].sort((a,b) => a.id.localeCompare(b.id)), start = args.cursor ? all.findIndex(w => w.id === args.cursor) + 1 : 0;
      const items = all.slice(start, start + args.limit).map(({ rows, ...w }) => w);
      return { ...answer, items, next_cursor: start + items.length < all.length ? items.at(-1).id : null };
    }
    assert.equal(name, 'workspace_topics'); const w = workspaces.find(w => w.id === args.workspace_id); assert.ok(w);
    const all = w.rows.filter(t => args.archived ? t.archived : args.done ? !t.archived && t.state === 'done' : !t.archived && t.state !== 'done').sort((a,b) => b.list_position-a.list_position || b.id.localeCompare(a.id));
    const start = args.cursor ? all.findIndex(t => topicPosition(t) === args.cursor) + 1 : 0, items = all.slice(start, start + args.limit);
    return { ...answer, items, next_cursor: start + items.length < all.length ? topicPosition(items.at(-1)) : null };
  };
  return { calls, pages, truncated, read, resolve: (route, options = {}) => resolveTopicLink(route, { read, instanceId: 'i', workspaceId: 'w1', ...options }) };
}
const route = (id = 'Landing', extra = {}) => ({ kind: 'topic', id, ...extra });
test('864 canonical and readable legacy ids keep existing destinations', async () => {
  const f = fixture([scope('w1', [topic('t1', 'Old id')])]);
  const canonical = route('t-' + 'a'.repeat(32)); assert.equal(topicLinkNeedsLookup(canonical), false);
  assert.equal(await f.resolve(canonical), canonical); assert.deepEqual(f.calls, []);
  assert.deepEqual(await f.resolve(route('t1')), route('t1')); assert.equal(f.calls.length, 1);
  assert.deepEqual(await f.resolve({ kind: 'workspace', id: 'w1' }), { kind: 'workspace', id: 'w1' });
});
test('864 named page follows actual owner, including revision and stale label', async () => {
  const f = fixture([]); f.pages.set('n', { source_ref: { kind: 'memory', id: 'n', revision: 4 }, owner_scope: { kind: 'topic', id: 'actual' } });
  assert.deepEqual(await f.resolve(route('Wrong label', { page: 'n', revision: '3' })), route('actual', { page: 'n', revision: '3' }));
  assert.deepEqual(f.calls.map(x => x.name), ['memory_current']);
  f.pages.get('n').owner_scope = { kind: 'workspace', id: 'w2' };
  assert.deepEqual(await f.resolve(route('Any label', { page: 'n' })), { kind: 'workspace', id: 'w2', page: 'n' });
});
test('864 current outcome wins ignoring case even when other outcomes duplicate the name', async () => {
  const f = fixture([scope('w1', [topic('local', 'LANDING')]), scope('w2', [topic('other', 'Landing', 'w2')])]);
  assert.deepEqual(await f.resolve(route('landing')), route('local')); assert.equal(f.calls.some(x => x.name === 'workspaces'), false);
});
test('864 duplicate current names refuse instead of choosing another outcome', async () => {
  const f = fixture([scope('w1', [topic('a', 'Landing'), topic('b', 'landing')]), scope('w2', [topic('c', 'Landing', 'w2')])]);
  await assert.rejects(f.resolve(route()), /Two or more topics are named Landing/);
  assert.equal(f.calls.some(x => x.name === 'workspaces'), false);
});
test('864 missing and duplicate names in other outcomes stay refused', async () => {
  const f = fixture([scope('w1'), scope('w2', [topic('a', 'Landing', 'w2')]), scope('w3', [topic('b', 'LANDING', 'w3')])]);
  await assert.rejects(f.resolve(route()), /Two or more topics/);
  await assert.rejects(f.resolve(route('Unknown')), /No topic is named Unknown/);
});
test('864 complete paged metadata includes later active, done, archived and outcome pages', async () => {
  const f = fixture([scope('w1', [topic('first', 'Unrelated'), topic('later', 'Landing', 'w1', { list_position: 1 })]), scope('w2', [topic('done', 'Done name', 'w2', { state: 'done' }), topic('archived', 'Archived name', 'w2', { archived: true })])]);
  assert.deepEqual(await f.resolve(route(), { limit: 1 }), route('later'));
  assert.deepEqual(await f.resolve(route('Done name'), { limit: 1 }), route('done'));
  assert.deepEqual(await f.resolve(route('Archived name'), { limit: 1 }), route('archived'));
  assert.ok(f.calls.some(x => x.name === 'workspaces' && x.args.cursor === 'w1'));
});
test('864 truncated titles are confirmed and message/unread options survive resolution', async () => {
  const f = fixture([scope('w1', [topic('a', 'Land…', 'w1', { title_truncated: true })])]); f.truncated.set('a', topic('a', 'Landing'));
  assert.deepEqual(await f.resolve(route('Landing', { message: 'm', land: true })), route('a', { message: 'm', land: true }));
  assert.deepEqual(await f.resolve(route('Landing', { at: 'unread' })), route('a', { at: 'unread' }));
});
test('864 source identity, instance and ambiguous route errors never become guesses', async () => {
  const f = fixture([]); f.pages.set('n', { source_ref: { kind: 'memory', id: 'wrong' }, owner_scope: { kind: 'topic', id: 't' } });
  await assert.rejects(f.resolve(route('Landing', { page: 'n' })), /could not be confirmed/);
  await assert.rejects(resolveTopicLink(route('Landing', { page: 'n' }), { read: async () => ({ instance_id: 'other' }), instanceId: 'i' }), /another instance/);
  await assert.rejects(f.resolve(route('Landing', { page: 'n', message: 'm' })), /incomplete or ambiguous/);
});
test('864 a superseded lookup cannot return a destination', async () => {
  let release, current = true; const held = new Promise(r => { release = r; });
  const pending = resolveTopicLink(route('Landing', { page: 'n' }), { read: () => held, instanceId: 'i', current: () => current });
  current = false; release({ instance_id: 'i', source_ref: { kind: 'memory', id: 'n' }, owner_scope: { kind: 'topic', id: 't' } });
  assert.equal(await pending, null);
});
test('864 beginning name lookup cancels an older navigation without changing writing', async () => {
  let release; const held = new Promise(r => { release = r; }), moved = [];
  const navigation = new TopicNavigation({ current: { kind: 'topic', id: 'before' }, beforeLeave: () => held, navigateTarget: t => moved.push(t) });
  const pending = navigation.openTarget(route('older')); navigation.cancelPending(); release();
  assert.equal(await pending, false); assert.deepEqual(moved, []);
});

test('864 Conversation metadata participates without becoming a second list cursor', async () => {
  const calls = [], conversation = topic('conv', 'Conversation');
  const read = async (name, args) => {
    calls.push(name);
    if (name === 'topic' && args.topic_id === 'Conversation') throw Object.assign(Error('Unavailable'), { code: 'FORBIDDEN' });
    if (name === 'workspace_topics') return { instance_id: 'i', items: [], next_cursor: null, groups: { done: 0, archived: 0 } };
    if (name === 'conversation') return { instance_id: 'i', conversation: { topic_id: 'conv' } };
    if (name === 'topic') return { instance_id: 'i', topic: conversation };
    assert.fail(name);
  };
  assert.deepEqual(await resolveTopicLink(route('Conversation'), { read, instanceId: 'i', workspaceId: 'w1' }), route('conv'));
  assert.deepEqual(calls, ['topic', 'workspace_topics', 'conversation', 'topic']);
});
test('864 Cards owner supplies the current-outcome priority before global duplicates', async () => {
  const f = fixture([scope('w1', [topic('wrong', 'Landing')]), scope('w2', [topic('context', 'The Notebook owner', 'w2'), topic('right', 'Landing', 'w2')])]);
  assert.deepEqual(await f.resolve(route(), { workspaceId: null, ownerScope: { kind: 'topic', id: 'context' } }), route('right'));
  assert.equal(f.calls.some(x => x.name === 'workspaces'), false);
});
test('864 incomplete or interrupted lookup never reports an unknown name or uses a partial match', async () => {
  await assert.rejects(resolveTopicLink(route(), { read: async () => { throw Object.assign(Error('Connection interrupted'), { code: 'REQUEST_UNCONFIRMED' }); }, instanceId: 'i' }), /Connection interrupted/);
  const f = fixture([scope('w1', [topic('a', 'Landing'), topic('b', 'LANDING', 'w1', { list_position: 1 })])]);
  await assert.rejects(f.resolve(route(), { limit: 1 }), /Two or more topics/);
});

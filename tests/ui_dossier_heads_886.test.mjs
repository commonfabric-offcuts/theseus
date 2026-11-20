import test from 'node:test';
import assert from 'node:assert/strict';
import { DossierHeads } from '../web/stack-order.mjs';

// Real visit owner; only transport and paint notification are in-memory.
// No server, Core, store, browser or child-process adapter is imported.
const tick = () => new Promise(resolve => setImmediate(resolve));
const root = id => ({ id, topic_id: 'topic', seq: 1, body: `Words of ${id}`, stack_position: { root_id: id } });
const page = ids => ({ items: ids.map(root) });
const loaded = ids => new Map(ids.map((id, i) => [`reply-${id}`, { id: `reply-${id}`, seq: i + 100, reply_to: id, stack_position: { root_id: id } }]));
const refusal = code => Object.assign(Error('Core refused'), { details: { error: { code } } });
function fixture(read) {
  let current = true, paints = 0, inFlight = 0, maximum = 0;
  const calls = [];
  const heads = new DossierHeads({ topicId: 'topic', current: () => current, changed: () => paints++,
    read: async (name, args) => {
      calls.push([name, structuredClone(args)]); inFlight++; maximum = Math.max(maximum, inFlight);
      try { return await read(args.message_ids); } finally { inFlight--; }
    } });
  return { heads, calls, paints: () => paints, maximum: () => maximum, retire: () => { current = false; } };
}

test('886 four missing heads arrive in one bounded request and one repaint without changing the loaded page', async () => {
  const f = fixture(async ids => page(ids)), messages = loaded(['a', 'b', 'c', 'd']), original = [...messages];
  f.heads.sync(messages); f.heads.sync(messages); await f.heads.readTail;
  assert.deepEqual(f.calls, [['topic_messages', { topic_id: 'topic', message_ids: ['a', 'b', 'c', 'd'] }]]);
  assert.equal(f.paints(), 1); assert.equal(f.maximum(), 1); assert.deepEqual([...messages], original);
  for (const id of ['a', 'b', 'c', 'd']) assert.deepEqual(f.heads.messages(messages).get(id), { ...root(id), dossierSource: true });
});

test('886 more than100 heads use serial bounded batches, one repaint per batch', async () => {
  const held = [], f = fixture(ids => new Promise(resolve => held.push(() => resolve(page(ids)))));
  const ids = Array.from({ length: 201 }, (_, i) => `head-${i}`);
  f.heads.sync(loaded(ids)); await tick(); assert.equal(f.calls.length, 1); assert.equal(f.calls[0][1].message_ids.length, 100);
  held.shift()(); await tick(); assert.equal(f.calls.length, 2); assert.equal(f.calls[1][1].message_ids.length, 100); assert.equal(f.paints(), 1);
  held.shift()(); await tick(); assert.equal(f.calls.length, 3); assert.equal(f.calls[2][1].message_ids.length, 1); assert.equal(f.paints(), 2);
  held.shift()(); await f.heads.readTail;
  assert.equal(f.paints(), 3); assert.equal(f.maximum(), 1);
  assert.deepEqual(f.calls.flatMap(([, args]) => args.message_ids), ids);
});

for (const code of ['FORBIDDEN', 'SOURCE_UNAVAILABLE', 'NOT_FOUND', 'INVALID_ARGUMENT']) {
  test('886 refused batch ' + code + ' falls back per head serially and paints one mixed result', async () => {
    const f = fixture(async ids => { if (ids.length > 1 || ids[0] === 'b') throw refusal(code); return page(ids); });
    const messages = loaded(['a', 'b', 'c']); f.heads.sync(messages); await f.heads.readTail;
    assert.deepEqual(f.calls.map(([, args]) => args.message_ids), [['a', 'b', 'c'], ['a'], ['b'], ['c']]);
    assert.equal(f.paints(), 1); assert.equal(f.maximum(), 1);
    assert.deepEqual([...f.heads.records].map(([id, record]) => [id, record.state]), [['a', 'available'], ['b', 'refused'], ['c', 'available']]);
    assert.equal(f.heads.messages(messages).has('b'), false);
  });
}

test('886 a transport error never fans out to per-head requests and paints one error result', async () => {
  const f = fixture(async () => { throw Error('offline'); }); f.heads.sync(loaded(['a', 'b'])); await f.heads.readTail;
  assert.equal(f.calls.length, 1); assert.equal(f.paints(), 1);
  assert.deepEqual([...f.heads.records.values()].map(record => record.state), ['error', 'error']);
});

test('886 a successful batch independently admits exact roots, withheld, absent and wrong-identity rows', async () => {
  const f = fixture(async () => ({ items: [root('a'), { ...root('b'), withheld: true }, { ...root('c'), topic_id: 'foreign' }, { ...root('d'), stack_position: { root_id: 'foreign' } }, root('unrequested')] }));
  const messages = loaded(['a', 'b', 'c', 'd', 'e']); f.heads.sync(messages); await f.heads.readTail;
  assert.deepEqual([...f.heads.records.values()].map(record => record.state), ['available', 'refused', 'error', 'error', 'missing']);
  assert.equal(f.paints(), 1); assert.equal(f.calls.length, 1);
  assert.deepEqual([...f.heads.messages(new Map()).keys()], ['a'], 'no withheld, foreign or unrequested words admitted');
});

test('886 invalidated records cannot take an older batch answer; current siblings paint once', async () => {
  const held = [], f = fixture(ids => new Promise(resolve => held.push({ ids, resolve })));
  const messages = loaded(['a', 'b']); f.heads.sync(messages); await tick();
  f.heads.invalidate('a'); f.heads.sync(messages);
  held[0].resolve(page(held[0].ids)); await tick();
  assert.equal(f.heads.records.get('a').state, 'loading'); assert.equal(f.heads.records.get('b').state, 'available'); assert.equal(f.paints(), 1);
  assert.deepEqual(held[1].ids, ['a']); held[1].resolve({ items: [{ ...root('a'), body: 'Fresh words' }] }); await f.heads.readTail;
  assert.equal(f.heads.records.get('a').item.body, 'Fresh words'); assert.equal(f.paints(), 2);
});

test('886 a loaded or retired head is skipped while queued and no stale answer paints', async () => {
  let finish; const f = fixture(ids => new Promise(resolve => { finish = () => resolve(page(ids)); }));
  const messages = loaded(['a']); f.heads.sync(messages); await tick();
  messages.set('reply-b', loaded(['b']).get('reply-b')); f.heads.sync(messages);
  messages.set('b', root('b')); f.heads.sync(messages); f.retire(); finish(); await f.heads.readTail;
  assert.equal(f.calls.length, 1); assert.equal(f.paints(), 0); assert.equal(f.heads.messages(new Map()).size, 0);
});

test('886 invalidation during refused-batch fallback skips stale heads before their reads and repaint', async () => {
  let finish; const f = fixture(async ids => {
    if (ids.length > 1) throw refusal('FORBIDDEN');
    if (ids[0] === 'a') return new Promise(resolve => { finish = () => resolve(page(ids)); });
    return page(ids);
  });
  f.heads.sync(loaded(['a', 'b'])); await tick(); assert.deepEqual(f.calls.map(([, args]) => args.message_ids), [['a', 'b'], ['a']]);
  f.heads.invalidate('a'); f.heads.invalidate('b'); finish(); await f.heads.readTail;
  assert.equal(f.calls.length, 2); assert.equal(f.paints(), 0); assert.equal(f.heads.records.size, 0);
});

test('886 queued head loaded by history is never requested, while its current sibling may paint', async () => {
  let finish; const f = fixture(ids => new Promise(resolve => { finish = () => resolve(page(ids)); }));
  const messages = loaded(['a']); f.heads.sync(messages); await tick();
  messages.set('reply-b', loaded(['b']).get('reply-b')); f.heads.sync(messages);
  messages.set('b', root('b')); f.heads.sync(messages); finish(); await tick();
  assert.equal(f.calls.length, 1, 'the removed queued head is never requested'); await f.heads.readTail; assert.equal(f.paints(), 1); assert.equal(f.heads.records.has('b'), false);
});

test('886 malformed batch shape is one error result, with no retry storm', async () => {
  const f = fixture(async () => ({ items: null })); f.heads.sync(loaded(['a', 'b'])); await f.heads.readTail;
  assert.equal(f.calls.length, 1); assert.equal(f.paints(), 1);
  assert.deepEqual([...f.heads.records.values()].map(record => record.state), ['error', 'error']);
});

test('886 a single refused head is not retried as its own fallback', async () => {
  const f = fixture(async () => { throw refusal('FORBIDDEN'); }); f.heads.sync(loaded(['a'])); await f.heads.readTail;
  assert.equal(f.calls.length, 1); assert.equal(f.paints(), 1); assert.equal(f.heads.records.get('a').state, 'refused');
});

test('886 fallback results invalidated while a later sibling waits never trigger a stale repaint', async () => {
  let finish; const f = fixture(async ids => {
    if (ids.length > 1) throw refusal('FORBIDDEN');
    if (ids[0] === 'b') return new Promise(resolve => { finish = () => resolve(page(ids)); });
    return page(ids);
  });
  f.heads.sync(loaded(['a', 'b'])); await tick();
  assert.equal(f.heads.records.get('a').state, 'available');
  f.heads.invalidate('a'); f.heads.invalidate('b'); finish(); await f.heads.readTail;
  assert.equal(f.paints(), 0); assert.equal(f.heads.records.size, 0);
});

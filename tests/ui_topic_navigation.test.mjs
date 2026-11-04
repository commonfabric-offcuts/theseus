import test from 'node:test';
import assert from 'node:assert/strict';
import { TopicPages, TopicNavigation } from '../web/topic-navigation.mjs';

const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
const topic = (id, title = id) => ({ id, title, workspace_id: 'w1' });
const answer = (items, next_cursor = null) => ({ instance_id: 'i1', items, next_cursor });

test('topic pages preserve current identity and allow repeated titles without duplicate links', () => {
  const pages = new TopicPages('i1', 'w1', topic('z', 'Same title'));
  pages.accept(answer([topic('a', 'Same title'), topic('b')], 'b'), null);
  assert.deepEqual(pages.items.map(x => x.id), ['z', 'a', 'b']);
  pages.accept(answer([topic('z', 'Same title')]), 'b');
  assert.deepEqual(pages.items.map(x => x.id), ['a', 'b', 'z']); assert.equal(pages.next, null);
  pages.current = topic('z', 'Renamed'); assert.equal(pages.items.at(-1).title, 'Renamed');
});
test('topic pages reject foreign identity, repeated cursor and malformed rows without changing links', () => {
  const pages = new TopicPages('i1', 'w1', topic('z'));
  pages.accept(answer([topic('a')], 'a'), null); const before = structuredClone(pages.items);
  for (const invalid of [ { ...answer([topic('b')]), instance_id: 'other' }, answer([{ ...topic('b'), workspace_id: 'other' }]),
    answer([topic('b'), topic('b')]), answer([topic('b')], 'a'), answer([topic('b')], 'unrelated'), answer([{ ...topic('b'), title: null }]) ]) {
    assert.throws(() => pages.accept(invalid, 'a')); assert.deepEqual(pages.items, before);
  }
  assert.equal(pages.accept(answer([topic('c')]), 'stale'), false);
});
function fixture() {
  const editors = ['inline', 'reply', 'note'].map((key, i) => ({ key, localVersion: i + 1, ackVersion: 0,
    context: { kind: i === 2 ? 'note' : 'reply' }, get dirty() { return this.localVersion > this.ackVersion; } }));
  const inline = { editors: { reply: editors[0] } }, current = { editors: { reply: editors[1], note: editors[2] } };
  const sessions = new Map(editors.map(e => [e.key, { editor: e }])), saved = [], kept = [], visits = [];
  const registry = { inline, current, sessions, disposed: false, hasUnprotectedWriting: false,
    flush: async e => { saved.push(e.key); e.ackVersion = e.localVersion; return { recorded: true, status: 'committed' }; },
    keepLocal: async p => { kept.push(p); } };
  return { registry, editors, saved, kept, visits, navigation: new TopicNavigation({ registry, topicId: 'a', navigate: id => visits.push(id) }) };
}
test('topic navigation waits for inline and Reader saves before leaving inside the debounce window', async () => {
  const f = fixture(), gate = deferred(), save = f.registry.flush;
  f.registry.flush = async e => { if (e === f.editors[0]) await gate.promise; return save(e); };
  const leaving = f.navigation.open('b'); await Promise.resolve(); assert.deepEqual(f.visits, []);
  gate.resolve(); assert.equal(await leaving, true);
  assert.deepEqual(f.saved.sort(), ['inline', 'note', 'reply']); assert.deepEqual(f.visits, ['b']);
  assert.ok(f.kept.includes(f.registry.inline) && f.kept.includes(f.registry.current));
});
for (const failure of ['rejected', 'unknown', 'transport', 'unavailable']) test(`topic navigation stays and preserves local writing on ${failure} save`, async () => {
  const f = fixture();
  f.registry.flush = async e => { if (e === f.editors[0]) {
    if (failure === 'transport') throw Error('Offline');
    if (failure === 'unavailable') e.unavailable = true;
    return failure === 'unknown' || failure === 'unavailable' ? null : { recorded: true, status: 'rejected' };
  } e.ackVersion = e.localVersion; return { recorded: true, status: 'committed' }; };
  await assert.rejects(f.navigation.open('b'), /stay|stayed|save|saved/i);
  assert.deepEqual(f.visits, []); assert.ok(f.kept.includes(f.registry.inline)); assert.equal(f.editors[0].localVersion, 1);
});
test('topic navigation rejects new typing, replaced owners and unrelated unprotected work while saving', async () => {
  for (const change of [f => f.editors[0].localVersion++, f => f.registry.sessions.delete('inline'), f => { f.registry.hasUnprotectedWriting = true; }]) {
    const f = fixture(), gate = deferred(), save = f.registry.flush;
    f.registry.flush = async e => { const receipt = await save(e); if (e === f.editors[0]) await gate.promise; return receipt; };
    const pending = f.navigation.open('b'); await Promise.resolve(); change(f); gate.resolve();
    await assert.rejects(pending); assert.deepEqual(f.visits, []);
  }
});
test('newer topic choice wins, current topic does nothing, and clean editors need no receipt', async () => {
  const f = fixture(); for (const e of f.editors) e.ackVersion = e.localVersion;
  f.registry.flush = async () => { throw Error('Clean writing must not be saved again'); };
  assert.equal(await f.navigation.open('a'), false); assert.deepEqual(f.kept, []);
  const gate = deferred(); f.registry.keepLocal = async p => { f.kept.push(p); await gate.promise; };
  const first = f.navigation.open('b'), second = f.navigation.open('c'); gate.resolve();
  assert.equal(await first, false); assert.equal(await second, true); assert.deepEqual(f.visits, ['c']);
});

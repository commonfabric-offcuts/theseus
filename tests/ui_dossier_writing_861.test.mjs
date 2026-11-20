import test from 'node:test';
import assert from 'node:assert/strict';
import { EditorRegistry } from '../web/app-session.mjs';
import { Editor, noWriting, WRITING_FIELDS } from '../web/editor.mjs';

const copy = value => structuredClone(value);
const fields = editor => Object.fromEntries(WRITING_FIELDS.map(key => [key, copy(editor.draft[key])]));
const kindOf = name => name === 'fixture-agent' || name === 'fixture-other' ? 'agent' : 'human';
const link = 'https://fixture.invalid/topic/t-fixture/message/m-fixture';
const defer = () => { let resolve; const promise = new Promise(done => resolve = done); return { promise, resolve }; };
function fixture({ body = 'Already typed', whisper = false, reply = {}, target = {} } = {}) {
  const kept = [], closed = [], timers = new Map(); let timer = 0;
  const registry = new EditorRegistry({ api: {}, journal: {},
    bootstrap: { actor: 'fixture-human', instance_id: 'i-fixture', authority: { authority_id: 'a-fixture', authority_epoch: 'e-fixture', continuity: 'initial' } },
    closed: p => closed.push(p), timers: { now: () => 1, setTimeout: fn => { timers.set(++timer, fn); return timer; }, clearTimeout: id => timers.delete(id) } });
  const context = { instanceId: 'i-fixture', actor: 'fixture-human', topicId: 't-fixture', kind: 'reply' };
  const left = new Editor({ ...context, sourceRef: { kind: 'message', id: 'm-fixture' } }, noWriting());
  const there = new Editor({ ...context, sourceRef: { kind: 'topic', id: 't-fixture' } }, noWriting());
  left.edit({ body, addressees: ['fixture-agent'], ...reply });
  if (Object.keys(target).length) there.edit(target);
  const p = { source: { source_ref: { kind: 'message', id: 'm-fixture' }, topic_id: 't-fixture', author: 'fixture-agent',
    whisper, addressees: ['fixture-human'], body: 'Original first line\n\nSecond line' }, editors: { reply: left }, mode: 'reply' };
  registry.current = p;
  registry.inline = { surface: 'inline', initialized: true, topic: { id: 't-fixture' }, editors: { reply: there } };
  for (const editor of [left, there]) registry.sessions.set(editor.key, { editor, attempts: [], sends: new Map(),
    unsettledSave: () => null, persist: async () => { kept.push({ editor, writing: fields(editor) }); } });
  const start = options => registry.startDossier(p, { link, names: [...left.offeredAddressees, ...left.draft.addressees], kindOf, ...options });
  return { registry, left, there, p, kept, closed, start, timers };
}

test('Start a new dossier quotes the full message, keeps root identity and saves the copy before clearing the reply', async () => {
  const f = fixture({ reply: { quotes: [{ source: { kind: 'message', id: 'm-other', revision: 2 }, excerpt: 'quoted' }], intent: 'ask', whisper: false } });
  const identity = copy(f.there.context), original = fields(f.left);
  assert.equal(typeof f.registry.startDossier, 'function', 'the registry owns the move');
  assert.equal(await f.start(), true);
  assert.deepEqual(f.there.context, identity);
  assert.equal(f.there.validateComposition(), true);
  assert.equal(f.there.draft.body, '> Original first line\n> \n> Second line\n\n[Source message](' + link + ')\n\nAlready typed\n');
  assert.deepEqual(f.there.draft.addressees, ['fixture-agent']);
  assert.equal(f.there.draft.intent, 'ask');
  assert.deepEqual(f.there.draft.quotes, []);
  assert.deepEqual(fields(f.left), noWriting());
  assert.deepEqual(f.kept.map(row => [row.editor === f.left ? 'reply' : 'new', row.writing.body]),
    [['reply', original.body], ['new', f.there.draft.body], ['reply', '']]);
  assert.equal(f.closed.length, 1);
  assert.equal(f.registry.current, null);
});

test('Tell, default Ask, explicit and default Whisper, and typed leading recipients keep their effective audience', async () => {
  for (const [reply, whisper, expected] of [
    [{ intent: 'tell', whisper: false }, false, { intent: 'tell', whisper: false }],
    [{ intent: null, whisper: null }, false, { intent: 'ask', whisper: false }],
    [{ intent: null, whisper: true }, false, { intent: null, whisper: true }],
    [{ intent: null, whisper: null }, true, { intent: null, whisper: true }],
  ]) {
    const f = fixture({ reply, whisper }); await f.start();
    assert.deepEqual({ intent: f.there.draft.intent, whisper: f.there.draft.whisper }, expected);
  }
  const f = fixture({ body: '@fixture-other Please check' });
  await f.start({ names: ['fixture-other'] });
  assert.deepEqual(f.there.draft.addressees, ['fixture-other'], 'prefixing the quote must not lose leading @ recipients');
});

test('a private quote cannot become public or move to another recipient; feed use privately addresses its original partner', async () => {
  for (const reply of [{ intent: 'ask' }, { whisper: false, intent: 'tell' }, { addressees: ['fixture-other'] }]) {
    const f = fixture({ whisper: true, reply }), before = [fields(f.left), fields(f.there)];
    await assert.rejects(f.start(), /Keep this quote private/);
    assert.deepEqual([fields(f.left), fields(f.there)], before);
  }
  const f = fixture({ whisper: true }); await f.start({ moveReply: false });
  assert.equal(f.left.draft.body, 'Already typed', 'feed use leaves the saved reply alone');
  assert.equal(f.there.draft.body.includes('Already typed'), false);
  assert.deepEqual(f.there.draft.addressees, ['fixture-agent']); assert.equal(f.there.draft.whisper, true);
});

test('occupied, conflicted, busy, prepared and recovery drafts refuse without changing either writing', async () => {
  const cases = [
    f => f.there.edit({ body: 'New message already here' }),
    f => f.there.edit({ addressees: ['fixture-other'] }),
    f => f.there.edit({ intent: 'tell' }),
    ...['left', 'there'].flatMap(side => [
      f => { f[side].conflict = {}; }, f => { f[side].unavailable = true; },
      f => { f[side].authorityRecovery = {}; }, f => { f[side].journalError = 'Device failed'; },
      f => { f.registry.serverSaves.set(f[side].key, 1); },
      f => { f.registry.sessionFor(f[side]).sends.set('send', Promise.resolve()); },
      f => { f.registry.sessionFor(f[side]).unsettledSave = () => ({}); },
      f => { f[side].submissions.push({ status: 'prepared' }); },
      f => { f[side].submissions.push({ status: 'preparing' }); },
    ]),
  ];
  for (const change of cases) {
    const f = fixture(); change(f); const before = [fields(f.left), fields(f.there)];
    await assert.rejects(f.start(), /Finish/);
    assert.deepEqual([fields(f.left), fields(f.there)], before);
    assert.equal(f.closed.length, 0); assert.equal(f.kept.length, 0);
  }
});

test('every current image form on either draft refuses, while an image owned by a past submission is not moved', async () => {
  const images = [
    e => e.edit({ attachments: [{ id: 'media-fixture' }] }),
    ...['imageBusy', 'imageReservation', 'adopting', 'uploadOpaque'].map(key => e => { e[key] = true; }),
    e => { e.uploadState = {}; },
    ...['memory-only', 'capturing', 'saved', 'uploaded'].map(bytes_state => e => {
      e.uploadState = { entries: [{ selected: true, bytes_state, owner: { kind: 'draft' } }] };
    }),
  ];
  for (const side of ['left', 'there']) for (const image of images) {
    const f = fixture(); image(f[side]); const before = [fields(f.left), fields(f.there)];
    await assert.rejects(f.start(), /image in/);
    assert.deepEqual([fields(f.left), fields(f.there)], before);
  }
  const f = fixture(); f.left.uploadState = { entries: [{ selected: true, bytes_state: 'saved', owner: { kind: 'submission' } }] };
  assert.equal(await f.start(), true); assert.deepEqual(f.there.draft.attachments, []);
});

test('failed destination persistence keeps the source; no second press can duplicate a pending transfer', async () => {
  const f = fixture(), held = defer(), entered = defer();
  f.registry.sessionFor(f.there).persist = async () => { entered.resolve(); await held.promise; throw Error('fixture write failure'); };
  const moving = f.start(); await entered.promise;
  assert.equal(f.registry.isWritable(f.p, f.left), false);
  assert.equal(f.registry.isCurrent(f.p, f.left), false);
  assert.equal(await f.start(), false);
  assert.equal(f.left.draft.body, 'Already typed');
  held.resolve(); await assert.rejects(moving, /could not be kept.*reply stays/);
  assert.equal(f.left.draft.body, 'Already typed'); assert.equal(f.closed.length, 0);
  assert.equal(f.registry.isWritable(f.p, f.left), true);
});

test('a new generation or newer writing while the copy is kept cannot clear the reply or close a newer Reader', async () => {
  for (const supersede of [
    f => { ++f.registry.generation; },
    f => { f.left.edit({ body: 'Newer writing' }); },
    f => { f.there.edit({ body: 'New destination writing' }); },
    f => { f.registry.current = { ...f.p, source: { ...f.p.source } }; },
  ]) {
    const f = fixture(), held = defer(), entered = defer();
    f.registry.sessionFor(f.there).persist = async () => { entered.resolve(); await held.promise; };
    const moving = f.start(); await entered.promise; supersede(f); const before = f.left.draft.body;
    held.resolve(); assert.equal(await moving, false);
    assert.equal(f.left.draft.body, before); assert.equal(f.closed.length, 0);
  }
});

test('unavailable sources and another topic never start a dossier in this composer', async () => {
  for (const change of [f => { f.p.sourceUnavailable = true; }, f => { f.p.availabilityUnconfirmed = true; },
    f => { f.p.source.topic_id = 't-other'; }, f => { f.registry.inline.initialized = false; }]) {
    const f = fixture(); change(f);
    assert.equal(await f.start(), false); assert.equal(f.kept.length, 0);
  }
});

test('a source save failure changes neither draft; a failed clear still has the kept destination copy', async () => {
  const first = fixture(), before = [fields(first.left), fields(first.there)];
  first.registry.sessionFor(first.left).persist = async () => { throw Error('fixture device refusal'); };
  await assert.rejects(first.start(), /reply could not be kept/);
  assert.deepEqual([fields(first.left), fields(first.there)], before);
  const last = fixture(); let count = 0;
  last.registry.sessionFor(last.left).persist = async () => { if (++count === 2) throw Error('fixture clear refusal'); };
  await assert.rejects(last.start(), /New message holds your writing/);
  assert.equal(last.kept.length, 1); assert.equal(last.kept[0].editor, last.there);
  assert.ok(last.kept[0].writing.body.endsWith('Already typed\n')); assert.equal(last.closed.length, 0);
});

test('a conflict that arrives while keeping the copy leaves the original reply intact', async () => {
  const f = fixture(), held = defer(), entered = defer();
  f.registry.sessionFor(f.there).persist = async () => { entered.resolve(); await held.promise; };
  const moving = f.start(); await entered.promise; f.left.conflict = {};
  held.resolve(); await assert.rejects(moving, /Finish saving or reviewing the reply/);
  assert.equal(f.left.draft.body, 'Already typed'); assert.equal(f.closed.length, 0);
});

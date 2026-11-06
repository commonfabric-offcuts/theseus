// A Notebook page's revision and the person's writing about it, over the real
// HTTP adapter and Store (tests/fixtures/ui_http.py). Opening a page shows the
// revision opened; writing keeps the revision it was started on, and writing
// that has not started (an empty reply or note) is about the page being read.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { Api } from '../web/api.mjs';
import { RecoveryJournal } from '../web/journal.mjs';
import { EditorRegistry } from '../web/app-session.mjs';
import { Editor } from '../web/editor.mjs';
import { EditorSession, RuntimeAuthority } from '../web/session.mjs';

const copy = value => structuredClone(value);
const page = revision => ({ kind: 'memory', id: 'release-pipeline', revision });

async function fixture(t) {
  const child = spawn('/usr/bin/python3', ['tests/fixtures/ui_http.py', '--freshness'], { cwd: new URL('..', import.meta.url) });
  let serial = 0, errors = '';
  const pending = new Map(), rows = new Map(), registries = [];
  child.stderr.on('data', data => { errors += data; });
  createInterface({ input: child.stdout }).on('line', line => {
    const result = JSON.parse(line), waiter = pending.get(result.id);
    pending.delete(result.id);
    if (result.failure) waiter.reject(Error(result.failure)); else waiter.resolve(result.answer);
  });
  const exited = new Promise(resolve => child.once('exit', code => {
    for (const waiter of pending.values()) waiter.reject(Error(`HTTP fixture exited ${code}: ${errors}`));
    resolve(code);
  }));
  const control = data => new Promise((resolve, reject) => {
    const id = ++serial; pending.set(id, { resolve, reject });
    child.stdin.write(JSON.stringify({ ...data, id }) + '\n');
  });
  t.after(async () => {
    for (const registry of registries) registry.dispose();
    child.stdin.end();
    assert.equal(await exited, 0, errors);
  });
  const facts = await control({ method: 'ready' });
  const api = new Api(facts.token, (url, init) => fetch(new URL(url, facts.origin), { ...init, headers: { ...init.headers, Origin: facts.origin } }));
  // One device's recovery store, kept across a reload as IndexedDB is.
  const backend = {
    put: async row => { rows.set(row.id, copy(row)); },
    get: async id => copy(rows.get(id)),
    forEditor: async key => [...rows.values()].filter(row => row.editorKey === key).map(copy),
    currentCandidates: async (key, ids) => ids.map(id => rows.get(id)).filter(row => row?.editorKey === key).map(copy),
    removeExact: async (id, stamp) => rows.get(id)?.stamp === stamp ? rows.delete(id) : false,
  };
  let documents = 0;
  // A page load: a fresh registry over the same server and the same device store.
  const load = async () => {
    const registry = new EditorRegistry({ api, bootstrap: await api.bootstrap(), journal: new RecoveryJournal(backend, `document-${++documents}`),
      saveDelayMs: 30000, maxSaveDelayMs: 60000 });
    registries.push(registry); return registry;
  };
  // The outcome's Notebook as the page lists it: each row opens its current revision.
  const listed = async () => (await api.view('memory_items', { owner_scope: { kind: 'workspace', id: 'w1' } })).items
    .find(item => item.id === 'release-pipeline').source_ref;
  const saved = async () => api.view('editor_state', { source_ref: await listed(), topic_id: facts.topic_id });
  const revise = async (expected, body) => assert.equal((await control({ method: 'memory_revise', operation_id: `revise-${expected}`,
    item_id: 'release-pipeline', expected_revision: expected, title: 'Release pipeline', body })).status, 'committed');
  const write = async (registry, editor, body) => {
    editor.edit({ body }); await registry.edited(editor);
    const receipt = await registry.flush(editor);
    assert.equal(receipt?.status, 'committed', JSON.stringify(receipt));
  };
  await control({ method: 'outcome_reference', operation_id: 'release-pipeline', item_id: 'release-pipeline',
    title: 'Release pipeline', body: 'Revision one.' });
  return { facts, api, load, listed, saved, revise, write, topicId: facts.topic_id };
}

test('a reply sent from an older revision leaves no pin: the page opens current and new writing is about it', async t => {
  const f = await fixture(t);
  let registry = await f.load(), shown = await registry.open(await f.listed(), { topicId: f.topicId });
  let reply = shown.editors.reply;
  reply.edit({ body: 'A reply about revision one' }); await registry.edited(reply);
  assert.equal((await registry.send(reply, { stay: true })).status, 'confirmed');
  // The sent reply leaves an empty draft in its place, still naming revision one.
  const left = (await f.saved()).draft;
  assert.deepEqual([left.body, left.source_ref], ['', page(1)], 'the empty successor the server keeps');
  await f.revise(1, 'Revision two.');

  // The same page, then a reload: each open shows revision two, and the
  // empty reply and note are about revision two, so the Reader says nothing
  // of an older revision.
  for (const reload of [false, true]) {
    if (reload) { registry.dispose(); registry = await f.load(); }
    shown = await registry.open(await f.listed(), { topicId: f.topicId });
    reply = shown.editors.reply;
    assert.deepEqual([shown.source.source_ref, shown.source.body], [page(2), 'Revision two.'], `reload ${reload}: the page shows its current revision`);
    assert.deepEqual(reply.sourceRef, page(2), `reload ${reload}: an empty reply is about the revision shown`);
    assert.deepEqual(shown.editors.note.sourceRef, page(2), `reload ${reload}: an empty note is about the revision shown`);
  }
  await f.write(registry, reply, 'A reply about revision two');
  assert.deepEqual((await f.saved()).draft.source_ref, page(2), 'the saved writing names the revision it was written against');
  await f.write(registry, shown.editors.note, 'A note about revision two');
  assert.deepEqual((await f.saved()).note.source_ref, page(2));
});

test('writing started on an older revision keeps it while the page shows the current one', async t => {
  const f = await fixture(t);
  let registry = await f.load(), shown = await registry.open(await f.listed(), { topicId: f.topicId });
  await f.write(registry, shown.editors.reply, 'Unsent words about revision one');
  await f.revise(1, 'Revision two.');
  registry.dispose(); registry = await f.load();
  shown = await registry.open(await f.listed(), { topicId: f.topicId });
  const reply = shown.editors.reply;
  assert.deepEqual([shown.source.source_ref, shown.source.body], [page(2), 'Revision two.']);
  assert.deepEqual([reply.sourceRef, reply.draft.body], [page(1), 'Unsent words about revision one'], 'the writing and its revision are kept');
  await f.write(registry, reply, 'Unsent words about revision one, continued');
  assert.deepEqual((await f.saved()).draft.source_ref, page(1), 'more writing does not move it to another revision');

  // Sent, its place is empty again: the next reply is about the page shown.
  assert.equal((await registry.send(reply, { stay: true })).status, 'confirmed');
  assert.deepEqual(reply.sourceRef, page(2), 'the empty place left by a send is about the page shown');
  await f.write(registry, reply, 'The next reply');
  assert.deepEqual((await f.saved()).draft.source_ref, page(2));

  // Emptied by the person, it lets go of its revision as well.
  await f.revise(2, 'Revision three.');
  shown = await registry.open(await f.listed(), { topicId: f.topicId });
  assert.deepEqual([shown.source.source_ref, reply.sourceRef], [page(3), page(2)], 'still writing about revision two');
  await f.write(registry, reply, '');
  assert.deepEqual(reply.sourceRef, page(3), 'an emptied reply, once saved, is about the page shown');
  await f.write(registry, reply, 'Words about revision three');
  assert.deepEqual((await f.saved()).draft.source_ref, page(3));
});

test('a runtime review accepts a saved empty reply at an older revision as the same writing slot, and nothing else', () => {
  const authority = { authority_id: 'a1', authority_epoch: 'e1', continuity: 'initial' };
  const context = { instanceId: 'i1', actor: 'tony', kind: 'reply', topicId: 't1', sourceRef: page(13) };
  const saved = (ref, body) => ({ id: 'd1', revision: 47, generation: 'g1', source_ref: ref, body, attachments: [], quotes: [], addressees: [] });
  const editor = new Editor(context, saved(page(12), ''));
  // The reply now writes about the revision read, while Core still holds the empty slot at the older one.
  editor.sourceRef = page(13);
  const api = { bootstrap: async () => ({}), view: async () => ({}) };
  const session = new EditorSession(editor, { api, journal: { save: async () => {} }, authority, runtime: new RuntimeAuthority({ api, instanceId: 'i1', authority }) });
  const state = draft => ({ instance_id: 'i1', source_ref: page(13), destination: { topic_id: 't1' }, source_available: true, destination_available: true, draft });
  assert.equal(session.validPrivateState(state(saved(page(12), ''))), true, 'an empty slot names no revision of its own');
  assert.equal(session.validPrivateState(state(saved(page(13), 'Words'))), true);
  assert.equal(session.validPrivateState(state(saved(page(12), 'Words about twelve'))), false, 'writing at another revision is another version');
  assert.equal(session.validPrivateState(state(saved({ kind: 'memory', id: 'another-page', revision: 12 }, ''))), false, 'another page is another source');
});

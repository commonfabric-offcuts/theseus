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

// Core refuses the next `count` preparations (each names a draft Core does not
// hold) and keeps the reply's writing in its slot, unrotated. The returned
// function sets how many more are refused.
function refusePreparations(f, count) {
  const command = f.api.command.bind(f.api);
  f.api.command = async envelope => {
    if (envelope.kind !== 'submission.prepare' || count <= 0) return command(envelope);
    count -= 1;
    return command({ ...envelope, args: { ...envelope.args, draft_id: 'not-this-draft' } });
  };
  return next => { count = next; };
}

// A reply refused at preparation, with the composer left empty and the
// writing still in Core's slot at revision one.
async function refusedReply(f, registry) {
  const shown = await registry.open(await f.listed(), { topicId: f.topicId });
  const reply = shown.editors.reply;
  reply.edit({ body: 'A reply about revision one' }); await registry.edited(reply);
  const refused = await registry.send(reply, { stay: true });
  assert.deepEqual([refused.status, refused.receipt?.error?.code], ['refused', 'FORBIDDEN']);
  assert.deepEqual([(await f.saved()).draft.body, reply.draft.body], ['A reply about revision one', '']);
  return { reply, refused };
}

// The page revised to revision two and opened again, on the same page or
// after a reload: it shows revision two, and the reply's place, holding no
// writing in Core's slot, is about revision two and saves there.
async function opensCurrent(f, registry, reload, label) {
  if (reload) { registry.dispose(); registry = await f.load(); }
  const shown = await registry.open(await f.listed(), { topicId: f.topicId });
  const reply = shown.editors.reply;
  assert.deepEqual(shown.source.source_ref, page(2), `${label}: the page shows its current revision`);
  assert.deepEqual(reply.sourceRef, page(2), `${label}: the empty reply is about the revision shown`);
  await f.write(registry, reply, 'The next reply');
  assert.deepEqual((await f.saved()).draft.source_ref, page(2), `${label}: the next writing is saved about the revision shown`);
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

test('a refused reply still holds its revision: the page opens current and the reply can be prepared again as written', async t => {
  const f = await fixture(t);
  refusePreparations(f, 1);
  const registry = await f.load();
  let shown = await registry.open(await f.listed(), { topicId: f.topicId });
  const reply = shown.editors.reply;
  reply.edit({ body: 'A reply about revision one' }); await registry.edited(reply);
  const refused = await registry.send(reply, { stay: true });
  assert.deepEqual([refused.status, refused.receipt?.error?.code], ['refused', 'FORBIDDEN']);
  assert.deepEqual([(await f.saved()).draft.body, reply.draft.body], ['A reply about revision one', ''], 'the writing stays in its slot; the composer is empty');
  await f.revise(1, 'Revision two.');

  shown = await registry.open(await f.listed(), { topicId: f.topicId });
  assert.deepEqual(shown.source.source_ref, page(2), 'the page shows its current revision');
  assert.deepEqual(reply.sourceRef, page(1), 'the refused writing still names the revision it was written against');
  const state = await f.saved();
  const corrected = await registry.sessionFor(reply).correctPreparation(refused, state.draft, reply.localVersion,
    { stay: true, acknowledgePossiblePriorPublication: true });
  assert.equal(corrected.status, 'confirmed', 'the refused reply is prepared again as written');
  const sent = (await f.api.view('topic_messages', { topic_id: f.topicId })).items.at(-1);
  const prepared = await f.api.view('submission', { submission_id: corrected.id });
  assert.deepEqual([sent.body, prepared.body, prepared.source_ref], ['A reply about revision one', 'A reply about revision one', page(1)]);
  assert.deepEqual(reply.sourceRef, page(2), 'once its place is empty, the next reply is about the page shown');
});

for (const reload of [false, true]) {
  const where = reload ? 'after a reload' : 'on the same page';
  test(`a refused reply followed by a sent one leaves no pin ${where}`, async t => {
    const f = await fixture(t);
    refusePreparations(f, 1);
    const registry = await f.load();
    const { reply } = await refusedReply(f, registry);
    // New writing goes into the same slot, is sent and confirmed: the slot is
    // an empty new generation and the refusal's writing is no longer in it.
    reply.edit({ body: 'A second reply' }); await registry.edited(reply);
    assert.equal((await registry.send(reply, { stay: true })).status, 'confirmed');
    assert.deepEqual((await f.saved()).draft.body, '');
    await f.revise(1, 'Revision two.');
    await opensCurrent(f, registry, reload, where);
  });

  test(`a refused reply whose place the person emptied leaves no pin ${where}`, async t => {
    const f = await fixture(t);
    refusePreparations(f, 1);
    const registry = await f.load();
    const { reply } = await refusedReply(f, registry);
    // The person clears the reply: its empty composer is saved over the
    // refused writing, so Core's slot holds nothing.
    await f.write(registry, reply, '');
    assert.deepEqual((await f.saved()).draft.body, '');
    await f.revise(1, 'Revision two.');
    await opensCurrent(f, registry, reload, where);
  });
}

test('a refused reply can be prepared again after its emptied place followed a revised page, and not over writing about that page', async t => {
  const f = await fixture(t);
  refusePreparations(f, 1);
  const registry = await f.load();
  const { reply, refused } = await refusedReply(f, registry);
  await f.write(registry, reply, '');
  await f.revise(1, 'Revision two.');
  await registry.open(await f.listed(), { topicId: f.topicId });
  assert.deepEqual(reply.sourceRef, page(2));
  const correct = async () => {
    const state = await f.saved();
    return registry.sessionFor(reply).correctPreparation(refused, state.draft, reply.localVersion,
      { stay: true, acknowledgePossiblePriorPublication: true });
  };
  // Writing about revision two is in the place: preparing the refused reply
  // again would put writing about revision one over it.
  await f.write(registry, reply, 'Words about revision two');
  await assert.rejects(correct(), /Writing changed since it was reviewed/);
  // Emptied again, the place is saved about revision two and holds nothing:
  // the refused reply is prepared again as written, about revision one.
  await f.write(registry, reply, '');
  assert.deepEqual((await f.saved()).draft.source_ref, page(2));
  const corrected = await correct();
  assert.equal(corrected.status, 'confirmed', 'the refused reply is prepared again as written');
  const prepared = await f.api.view('submission', { submission_id: corrected.id });
  assert.deepEqual([prepared.body, prepared.source_ref], ['A reply about revision one', page(1)]);
  assert.deepEqual(reply.sourceRef, page(2), 'the next reply is about the page shown');
  await f.write(registry, reply, 'The next reply');
  assert.deepEqual((await f.saved()).draft.source_ref, page(2));
});

// A refused reply whose emptied place followed the page to revision two.
async function refusedThenFollowed(f, registry) {
  const { reply, refused } = await refusedReply(f, registry);
  await f.write(registry, reply, '');
  await f.revise(1, 'Revision two.');
  await registry.open(await f.listed(), { topicId: f.topicId });
  assert.deepEqual(reply.sourceRef, page(2));
  const correct = async () => {
    const state = await f.saved();
    return registry.sessionFor(reply).correctPreparation(refused, state.draft, reply.localVersion,
      { stay: true, acknowledgePossiblePriorPublication: true });
  };
  return { reply, correct };
}

for (const reload of [false, true]) {
  const where = reload ? 'after a reload' : 'on the same page';
  test(`a correction refused again over an emptied place holds the refused writing's revision ${where}`, async t => {
    const f = await fixture(t);
    refusePreparations(f, 2);
    let registry = await f.load();
    let { reply, correct } = await refusedThenFollowed(f, registry);
    // A refused correction resolves to nothing; it is the reply's latest submission.
    assert.equal(await correct(), null);
    const again = reply.submissions.at(-1);
    assert.deepEqual([again.status, again.receipt?.error?.code], ['refused', 'FORBIDDEN']);
    const slot = (await f.saved()).draft;
    assert.deepEqual([slot.body, slot.source_ref], ['A reply about revision one', page(1)], 'the slot holds the refused writing again');
    if (reload) {
      registry.dispose(); registry = await f.load();
      reply = (await registry.open(await f.listed(), { topicId: f.topicId })).editors.reply;
      assert.equal(reply.draft.body, 'A reply about revision one', `${where}: the composer shows the slot's writing`);
    }
    assert.deepEqual(reply.sourceRef, page(1), `${where}: the reply is about the refused writing's revision, as the slot is`);
    await f.revise(2, 'Revision three.');
    await registry.open(await f.listed(), { topicId: f.topicId });
    assert.deepEqual(reply.sourceRef, page(1), `${where}: a later revision does not move it`);
    await f.write(registry, reply, 'D');
    assert.deepEqual((await f.saved()).draft.source_ref, page(1), `${where}: new writing in that slot is saved about it`);
  });
}

test('a refused reply is not prepared again over unsaved writing about a revised page; sent, the writing frees the place', async t => {
  const f = await fixture(t);
  const refuse = refusePreparations(f, 1);
  const registry = await f.load();
  const { reply, correct } = await refusedThenFollowed(f, registry);
  // Each attempt below would be refused again by Core if it were made: the
  // slot would then hold the refused writing about revision one, and the
  // place's own change could not be saved.
  const attempt = () => correct().then(() => reply.submissions.at(-1).status, error => error.message);
  const flushed = async label => {
    const receipt = await registry.flush(reply);
    assert.equal(receipt?.status, 'committed', `${label}: ${JSON.stringify(receipt)}`);
    assert.deepEqual([reply.sourceRef, (await f.saved()).draft.source_ref], [page(2), page(2)], `${label}: saved about the page shown`);
  };
  refuse(1);
  // Emptied again and not yet saved, the place stays about the page shown.
  reply.edit({ body: '' }); await registry.edited(reply);
  let outcome = await attempt();
  await flushed('an unsaved emptied place');
  assert.match(outcome, /writing is about another revision/, 'the correction is refused before it touches the slot');
  reply.edit({ body: 'Words about revision two' }); await registry.edited(reply);
  outcome = await attempt();
  await flushed('unsaved writing');
  assert.equal(reply.draft.body, 'Words about revision two');
  assert.match(outcome, /writing is about another revision/, 'the correction is refused before it touches the slot');
  refuse(0);
  assert.equal((await registry.send(reply, { stay: true })).status, 'confirmed');
  const corrected = await correct();
  assert.equal(corrected.status, 'confirmed', 'with the place empty, the refused reply is prepared again as written');
  const prepared = await f.api.view('submission', { submission_id: corrected.id });
  assert.deepEqual([prepared.body, prepared.source_ref], ['A reply about revision one', page(1)]);
  assert.deepEqual(reply.sourceRef, page(2), 'the next reply is about the page shown');
});

test('a refused reply is not prepared again over saved writing about a revised page that another tab has since emptied', async t => {
  const f = await fixture(t);
  const refuse = refusePreparations(f, 1);
  const registry = await f.load();
  const { reply, correct } = await refusedThenFollowed(f, registry);
  await f.write(registry, reply, 'Words about revision two');
  // Another tab empties the place; this tab still shows its saved writing.
  const other = await f.load();
  const elsewhere = (await other.open(await f.listed(), { topicId: f.topicId })).editors.reply;
  await f.write(other, elsewhere, '');
  // Were it made, the correction would be refused again and leave the
  // refused writing about revision one under this tab's writing about two.
  refuse(1);
  const outcome = await correct().then(() => reply.submissions.at(-1).status, error => error.message);
  const slot = (await f.saved()).draft;
  assert.deepEqual([slot.body, slot.source_ref], ['', page(2)], 'the slot is left as the other tab saved it');
  assert.deepEqual([reply.sourceRef, reply.draft.body], [page(2), 'Words about revision two'], 'the writing and its revision are kept');
  assert.match(outcome, /writing is about another revision/);
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

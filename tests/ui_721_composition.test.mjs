import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { readFile } from 'node:fs/promises';
import { openJournal } from '../web/journal.mjs';
import { EditorRegistry } from '../web/app-session.mjs';
import { Api } from '../web/api.mjs';
import { journalEnvironment } from './fixtures/item_721_idb.mjs';
const live = 'c1ac9d303d07e305ce421a503681127a9382a9e3';
const original = execFileSync('git', ['show', `${live}:web/journal.mjs`], { encoding: 'utf8' });
const oldModule = original.replaceAll("'./editor.mjs'", JSON.stringify(new URL('../web/editor.mjs', import.meta.url).href))
  .replaceAll("'./upload-state.mjs'", JSON.stringify(new URL('../web/upload-state.mjs', import.meta.url).href));
const { openJournal: oldOpen } = await import('data:text/javascript;base64,' + Buffer.from(oldModule).toString('base64'));
// Revert uses the actual104 journal; upload behavior is identical to actual104.
assert.equal(execFileSync('git', ['show', `${live}:web/uploads.mjs`], { encoding: 'utf8' }), await readFile(new URL('../web/uploads.mjs', import.meta.url), 'utf8'));
const tick = () => new Promise(resolve => setImmediate(resolve));
async function fixture(t, firstOpen = openJournal) {
  assert.match(process.env.PYTHONPYCACHEPREFIX ?? '', /721-compose10162/);
  const env = journalEnvironment(t), child = spawn('/usr/bin/python3', ['tests/fixtures/ui_http.py']);
  const waiting = new Map(), registries = [], journals = [], calls = []; let serial = 0, errors = '';
  child.stderr.on('data', bytes => { errors += bytes; });
  createInterface({ input: child.stdout }).on('line', line => {
    const response = JSON.parse(line), waiter = waiting.get(response.id); waiting.delete(response.id);
    response.failure ? waiter.reject(Error(response.failure)) : waiter.resolve(response.answer);
  });
  const exited = new Promise(resolve => child.once('exit', code => {
    for (const waiter of waiting.values()) waiter.reject(Error(`Fixture exit ${code}: ${errors}`)); resolve(code);
  }));
  t.after(async () => {
    for (const registry of registries) registry.dispose(); for (const journal of journals) journal.close();
    child.stdin.end(); assert.equal(await exited, 0, errors);
  });
  const control = data => new Promise((resolve, reject) => { const id = ++serial; waiting.set(id, { resolve, reject }); child.stdin.write(JSON.stringify({ ...data, id }) + '\n'); });
  const facts = await control({ method: 'ready' });
  const api = new Api(facts.token, (url, init) => {
    calls.push({ url, body: url === '/api/command' ? JSON.parse(init.body) : null });
    return fetch(new URL(url, facts.origin), { ...init, headers: { ...init.headers, Origin: facts.origin } });
  });
  const bootstrap = await api.bootstrap(), ref = facts.sources[1];
  const open = async factory => { const j = await factory({ instanceId: facts.instance_id, actor: facts.actor, win: env.win }); journals.push(j); return j; };
  const registryFor = journal => { const r = new EditorRegistry({ api, bootstrap, journal, saveDelayMs: 30000, maxSaveDelayMs: 60000 }); registries.push(r); return r; };
  const journal = await open(firstOpen), registry = registryFor(journal), card = { fixturePlacement: 'one card' };
  const p = await registry.open(ref, { topicId: facts.topic_id, replyCard: card });
  const editor = p.editors.reply, session = registry.sessionFor(editor), u = session.uploads;
  editor.edit({ body: 'Exact writing\nwith destination and image', caret: { start: 2, end: 8 }, reply_to: ref.id });
  await registry.flush(editor); // Establish the canonical draft before the image capture/reload boundary.
  const image = new File([await readFile(new URL('./fixtures/media/screen.png', import.meta.url))], 'composition.png', { type: 'image/png', lastModified: 1234 });
  const reload = async factory => {
    await session.persist(); const candidate = await journal.own(editor.key);
    registry.dispose(); journal.close(); await tick();
    const nextJournal = await open(factory);
    await nextJournal.adopt(editor.key, candidate);
    const nextRegistry = registryFor(nextJournal), next = await nextRegistry.open(ref, { topicId: facts.topic_id });
    const e = next.editors.reply, s = nextRegistry.sessionFor(e);
    assert.equal(e.key, editor.key); assert.deepEqual(e.context, editor.context);
    assert.equal(e.draft.body, editor.draft.body); assert.deepEqual(e.draft.caret, editor.draft.caret);
    assert.deepEqual(e.sourceRef, editor.sourceRef); assert.deepEqual(e.draft.attachments, editor.draft.attachments);
    return { journal: nextJournal, registry: nextRegistry, p: next, editor: e, session: s, u: s.uploads };
  };
  return { ...env, facts, api, control, journal, registry, p, editor, session, u, image, calls, reload, open };
}
const exact = async (blob, image) => assert.deepEqual(Buffer.from(await blob.arrayBuffer()), Buffer.from(await image.arrayBuffer()));
test('721 composition actual104 Blob capture upgrades through real adoption and Uploads read', async t => {
  const f = await fixture(t, oldOpen), id = await f.u.add(f.image, { start: false }), entry = f.u.find(id);
  assert.ok(f.rows.get(entry.bytes_ref).blob instanceof Blob);
  const next = await f.reload(openJournal);
  await exact((await next.u.bytes(next.u.find(id))).blob, f.image);
  await exact(await next.u.preview(id), f.image);
});
test('721 composition buffer capture survives reload with exact bytes; duplicate and wrong ownership refuse', async t => {
  const f = await fixture(t), id = await f.u.add(f.image, { start: false }), entry = f.u.find(id), bytesId = entry.bytes_ref;
  const stored = f.rows.get(bytesId); assert.ok(stored.data instanceof ArrayBuffer); assert.equal(stored.blob, undefined);
  await exact((await f.u.bytes(entry)).blob, f.image);
  const next = await f.reload(openJournal); await exact((await next.u.bytes(next.u.find(id))).blob, f.image);
  const before = structuredClone(f.rows);
  const bytes = { ...stored, blob: f.image }; delete bytes.data;
  await assert.rejects(next.journal.capture(next.editor.key, () => next.session.snapshot(), bytes, next.u.find(id), () => true), /cannot be replaced/);
  assert.deepEqual(f.rows, before, 'duplicate capture commits nothing');
  // Failed capture changes the in-memory entry; the durable exact row still owns the bytes.
  Object.assign(next.u.find(id), before.get(next.journal.id(next.editor.key)).snapshot.uploadState.entries[0]);
  for (const change of [r => { r.scope = 'foreign'; }, r => { r.editorKey = 'foreign'; }, r => { r.metadata.size++; }, r => { r.data = new ArrayBuffer(1); }, r => { r.selection_id = 'foreign'; }]) {
    const bad = structuredClone(stored); change(bad); f.rows.set(bytesId, bad);
    await assert.rejects(next.u.bytes(next.u.find(id)), /unavailable/);
  }
  f.rows.set(bytesId, stored); await exact((await next.u.bytes(next.u.find(id))).blob, f.image);
  await assert.rejects(next.journal.save({ ...next.session.snapshot(), hidden: new Uint8Array([1]) }), /identity/);
  const other = await f.open(openJournal);
  await assert.rejects(other.readBytes(next.editor.key, bytesId), /ownership/);
});
test('721 composition interrupted buffer serialization commits no capture and preserves writing', async t => {
  const f = await fixture(t); await f.session.persist(); const before = structuredClone(f.rows);
  let entered, finish; const reached = new Promise(r => { entered = r; }), release = new Promise(r => { finish = r; });
  const image = f.image, arrayBuffer = image.arrayBuffer.bind(image);
  image.arrayBuffer = async () => { entered(); await release; return arrayBuffer(); };
  const task = f.u.add(image, { start: false }); await reached;
  f.registry.dispose(); f.journal.close(); finish();
  await assert.rejects(task, /closed/); assert.deepEqual(f.rows, before);
  assert.equal(f.editor.draft.body, 'Exact writing\nwith destination and image');
});
test('721 composition actual104 revert cannot recover buffered draft image through preview or publication; writing survives', async t => {
  const f = await fixture(t), id = await f.u.add(f.image, { start: false }), bytesId = f.u.find(id).bytes_ref;
  assert.equal(f.u.memory.size, 0, 'capture releases chooser memory');
  const old = await f.reload(oldOpen), entry = old.u.find(id);
  await assert.rejects(old.u.bytes(entry), /retained image bytes are unavailable/);
  await assert.rejects(old.u.preview(id), /retained image bytes are unavailable/);
  await old.u.run(entry);
  assert.match(entry.local_error, /retained image bytes are unavailable/);
  assert.equal((await f.control({ method: 'counts' })).media, 0, 'no alternate server image exists');
  assert.throws(() => old.editor.beginPrepare({ prepareOperationId: 'no', sendOperationId: 'no', submissionId: 'no' }), /image|attachment/i);
  assert.ok(f.rows.has(bytesId), 'revert does not erase the buffer; upgrading can recover it');
  await old.u.remove(id);
  await assert.rejects(old.u.discard(id), /Image release ownership changed/);
  assert.ok(f.rows.has(bytesId), 'old104 cannot discard the buffered row either');
  const sent = await old.registry.send(old.editor, { stay: true, presentation: old.p }); assert.equal(sent.status, 'confirmed');
  const source = await f.api.view('source', { kind: 'message', id: sent.receipt.result.message_id });
  assert.equal(source.body, f.editor.draft.body); assert.deepEqual(source.attachments, []); assert.equal(source.reply_to, f.facts.sources[1].id);
  const candidate = await old.journal.own(old.editor.key);
  old.registry.dispose(); old.journal.close(); await tick();
  const upgraded = await f.open(openJournal); await upgraded.adopt(old.editor.key, candidate);
  await exact((await upgraded.readBytes(old.editor.key, bytesId)).blob, f.image);
});
test('721 composition actual104 revert retains published image and submits once despite unavailable local buffered thumbnail', async t => {
  const f = await fixture(t), id = await f.u.add(f.image), entry = f.u.find(id);
  assert.ok(entry.ready_descriptor); const bytesId = entry.bytes_ref; assert.ok(f.rows.has(bytesId));
  const old = await f.reload(oldOpen);
  await assert.rejects(old.u.preview(id), /retained image bytes are unavailable/);
  const attachment = old.editor.draft.attachments[0]; assert.ok(attachment);
  await exact((await f.api.media(f.facts.instance_id, { ...entry.ready_descriptor, id: attachment.id })).blob, f.image);
  const sent = await old.registry.send(old.editor, { stay: true, presentation: old.p }); assert.equal(sent.status, 'confirmed');
  const source = await f.api.view('source', { kind: 'message', id: sent.receipt.result.message_id });
  assert.equal(source.body, f.editor.draft.body); assert.equal(source.attachments.length, 1);
  await exact((await f.api.media(f.facts.instance_id, source.attachments[0], { kind: 'message', id: source.source_ref.id })).blob, f.image);
  await old.registry.checkConfirmation(old.editor);
  assert.equal((await f.control({ method: 'counts' })).media, 1);
  assert.equal(f.calls.filter(c => c.body?.kind === 'message.send').length, 1);
});

test('721 composition actual104 revert retains frozen submission image after a lost committed send answer', async t => {
  const f = await fixture(t); await f.u.add(f.image);
  const command = f.api.command.bind(f.api); let receipt;
  f.api.command = async envelope => {
    const answer = await command(envelope);
    if (envelope.kind === 'message.send') { receipt = answer; throw Error('Lost answer after actual Core commit'); }
    return answer;
  };
  const sent = await f.registry.send(f.editor, { stay: true, presentation: f.p });
  assert.equal(receipt.status, 'committed'); assert.equal(sent.snapshot.attachments.length, 1);
  const frozen = structuredClone(sent.snapshot), sendId = sent.sendOperationId;
  f.editor.edit({ body: 'Newer B after unknown image send', caret: { start: 3, end: 4 } });
  const old = await f.reload(oldOpen);
  await old.registry.checkConfirmation(old.editor);
  const retained = old.editor.submissions.find(s => s.sendOperationId === sendId);
  assert.ok(retained); assert.deepEqual(retained.snapshot, frozen); assert.equal(retained.status, 'confirmed');
  assert.equal(old.editor.draft.body, 'Newer B after unknown image send');
  const source = await f.api.view('source', { kind: 'message', id: receipt.result.message_id });
  assert.equal(source.body, frozen.body); assert.equal(source.attachments.length, 1);
  await exact((await f.api.media(f.facts.instance_id, source.attachments[0], source.source_ref)).blob, f.image);
  assert.equal(f.calls.filter(c => c.body?.kind === 'message.send').length, 1);
});

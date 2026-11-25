import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { Editor, restoreEditor } from '../web/editor.mjs';
import { EditorRegistry } from '../web/app-session.mjs';
import { RecoveryJournal } from '../web/journal.mjs';
import { Api } from '../web/api.mjs';

const copy = structuredClone;
const context = { instanceId: 'image-model', actor: 'fixture-person', kind: 'reply', sourceRef: { kind: 'message', id: 'source' }, topicId: 'topic' };
const pin = { authority_id: 'authority', authority_epoch: 'epoch' };
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
const draft = () => ({ id: 'draft', revision: 1, generation: 'g1', body: 'A reply that could send without its image' });
function entry(editor, { ready = false, selected = true } = {}) {
  return { selection_id: 'selection', origin: 'file', binding: { instance_id: context.instanceId, actor_id: context.actor,
    editor_key: editor.key, source_ref: context.sourceRef, topic_id: context.topicId, captured_cycle_id: editor.clientCycleId, authority: pin },
    owner: { kind: 'cycle', id: editor.clientCycleId }, version: 1, selected, file: { name: 'image.png', size: 5, type: 'image/png', last_modified: 0, sha256: 'a'.repeat(64) },
    bytes_ref: 'bytes', bytes_state: 'durable', choice: 0, attempts: [],
    ready_descriptor: ready ? { media_id: 'media', state: 'ready', media_revision: 2 } : null,
    association: ready ? { cycle_id: editor.clientCycleId, media_id: 'media' } : null };
}
function withImage(options) {
  const e = new Editor(context, draft());
  e.clientCycleId ??= 'initial-cycle';
  e.uploadState = { format: 2, revision: 1, client_cycle_id: e.clientCycleId, entries: [entry(e, options)], submission_links: {} };
  return e;
}
const prepare = e => e.beginPrepare({ prepareOperationId: 'prepare', sendOperationId: 'send', submissionId: 'submission' });

test('selected pending bytes absent from refs prevent an otherwise sendable reply from preparing', () => {
  const e = withImage();
  assert.throws(() => prepare(e), /image|attachment/i);
  assert.equal(e.submissions.length, 0);
  assert.equal(e.draft.body, draft().body);
});
test('reverse gate rejects a canonical ready ref whose selection was removed', () => {
  const e = withImage({ ready: true, selected: false }); e.draft.attachments = [{ id: 'media' }];
  assert.throws(() => prepare(e), /image|attachment/i);
});
test('frozen A keeps its image when refused preparation assigns the same generation to B', () => {
  const e = withImage({ ready: true }); e.draft.attachments = [{ id: 'media' }];
  const oldCycle = e.clientCycleId, a = prepare(e);
  assert.deepEqual(e.uploadState.entries[0].owner, { kind: 'submission', id: a.id });
  assert.notEqual(e.clientCycleId, oldCycle);
  e.edit({ body: 'B remains separate' });
  e.acceptPreparation({ recorded: true, instance_id: context.instanceId, operation_id: 'prepare', kind: 'submission.prepare', status: 'rejected', error: { code: 'REFUSED' } });
  assert.equal(e.draft.generation, 'g1'); assert.deepEqual(e.draft.attachments, []);
  assert.deepEqual(e.uploadState.entries[0].owner, { kind: 'submission', id: a.id });
});
test('clean image-only journal restores its cycle and bytes association', () => {
  const e = withImage(); e.draft.body = '';
  const snapshot = { ...e.snapshot(), format: 2, uploadState: copy(e.uploadState), clientCycleId: e.clientCycleId };
  const restored = restoreEditor(context, { ...draft(), body: 'different saved version' }, snapshot);
  assert.equal(restored.draft.body, ''); assert.deepEqual(restored.uploadState, e.uploadState);
  assert.equal(restored.clientCycleId, e.clientCycleId);
});

function countBlobs(value, seen = new Set()) {
  if (value instanceof Blob) return value.size;
  if (!value || typeof value !== 'object' || seen.has(value)) return 0;
  seen.add(value);
  return (value instanceof Map ? [...value.keys(), ...value.values()] : value instanceof Set ? [...value] : Object.values(value))
    .reduce((n, child) => n + countBlobs(child, seen), 0);
}
export function memoryBackend(writerId = 'fixture-writer', rows = new Map()) {
  const puts = [], backend = {
    put: async (row, guard = () => true) => { assert.ok(guard()); puts.push({ kind: row.kind, bytes: countBlobs(row) }); rows.set(row.id, copy(row)); },
    get: async id => copy(rows.get(id)),
    keepCandidate: async (key, candidate, choice, guard) => {
      const row = rows.get(candidate.id);
      if (backend.failChoice || !guard() || row?.stamp !== candidate.stamp || row.editorKey !== key) throw Error('Choice not saved');
      const stamp = crypto.randomUUID(), next = { ...copy(row), stamp, reviewChoice: { ...copy(choice), stamp } };
      rows.set(row.id, copy(next)); return next;
    },
    forEditor: async key => ({ items: [...rows.values()].filter(r => r.editorKey === key && r.active === 1 && r.writerId !== writerId).map(r => ({ ...copy(r), availability: 'available' })), nextCursor: null }),
    currentCandidates: async (key, ids) => ids.map(id => rows.get(id)).filter(r => r?.editorKey === key && r.active === 1 && r.writerId !== writerId).map(r => ({ ...copy(r), availability: 'available' })),
    history: async () => ({ items: [], nextCursor: null }),
    capture: async (row, bytes, guard) => { assert.ok(guard()); if (backend.failCapture) throw Error('Byte quota'); assert.ok(!rows.has(bytes.id)); await backend.put(bytes); await backend.put(row); },
    readBytes: async (editorId, id) => { const row = rows.get(editorId); assert.ok(row?.snapshot.uploadState.entries.some(e => e.bytes_ref === id)); return copy(rows.get(id)); },
    releaseBytes: async (row, stamp, ids, guard) => {
      if (!guard() || rows.get(row.id)?.stamp !== stamp) return false;
      for (const id of ids) rows.delete(id); await backend.put(row); return true;
    },
    removeExact: async (id, stamp) => {
      const row = rows.get(id); if (row?.stamp !== stamp || row.snapshot.uploadState?.entries.some(e => e.bytes_ref)) return false;
      return rows.delete(id);
    },
  };
  return { backend, rows, puts };
}
async function fixture(t) {
  const child = spawn('/usr/bin/python3', ['tests/fixtures/ui_http.py'], { cwd: new URL('..', import.meta.url) });
  const waiting = new Map(); let serial = 0, errors = '';
  child.stderr.on('data', bytes => { errors += bytes; });
  createInterface({ input: child.stdout }).on('line', line => { const r = JSON.parse(line), w = waiting.get(r.id); waiting.delete(r.id); r.failure ? w.reject(Error(r.failure)) : w.resolve(r.answer); });
  const exited = new Promise(resolve => child.once('exit', resolve));
  const control = data => new Promise((resolve, reject) => { const id = ++serial; waiting.set(id, { resolve, reject }); child.stdin.write(JSON.stringify({ ...data, id }) + '\n'); });
  const facts = await control({ method: 'ready' }), calls = [];
  const api = new Api(facts.token, (url, init) => { calls.push({ url, body: init.body }); return fetch(new URL(url, facts.origin), { ...init, headers: { ...init.headers, Origin: facts.origin } }); });
  const { backend, rows, puts } = memoryBackend();
  const journal = new RecoveryJournal(backend, 'fixture-writer'), bootstrap = await api.bootstrap();
  const registry = new EditorRegistry({ api, journal, bootstrap, saveDelayMs: 30000, maxSaveDelayMs: 60000 });
  t.after(async () => { registry.dispose(); child.stdin.end(); assert.equal(await exited, 0, errors); });
  const p = await registry.open(facts.sources[1], { topicId: facts.topic_id });
  const editor = p.editors.reply, session = registry.sessionFor(editor);
  assert.ok(session.uploads, 'registered reply needs its upload controller');
  const image = new File([await readFile(new URL('./fixtures/media/screen.png', import.meta.url))], 'image.png', { type: 'image/png' });
  return { facts, calls, api, backend, rows, puts, journal, registry, editor, session, u: session.uploads, image, control };
}
test('capture owns one byte row; typing and caret persistence carry no Blob bytes', async t => {
  const f = await fixture(t), id = await f.u.add(f.image, { start: false });
  assert.ok(id); const before = f.puts.length;
  for (let i = 0; i < 4; i++) { f.editor.edit({ body: `Typing ${i}` }); await f.registry.edited(f.editor); }
  assert.ok(f.puts.slice(before).every(p => p.bytes === 0));
  assert.equal(f.puts.filter(p => p.bytes).length, 1);
  assert.ok(f.puts.filter(p => p.bytes).every(p => p.kind === 'upload-bytes-v1'));
  assert.equal([...f.rows.values()].filter(r => r.kind === 'upload-bytes-v1').length, 1);
});

test('every-put instrument rejects bytes hidden in metadata, independent of sibling count', () => {
  const row = { snapshot: { nested: { memory: new Blob(['wrong place']) } } };
  assert.equal(countBlobs(row), 11);
  assert.notEqual(countBlobs(row), 0, 'the instrument must see the original B3 defect');
});
test('capture failure keeps text savable, dispatches nothing and Remove does not retry bytes', async t => {
  const f = await fixture(t); f.editor.edit({ body: 'Protected before image' }); await f.registry.edited(f.editor);
  f.backend.failCapture = true; const before = f.calls.length;
  const id = await f.u.add(f.image, { start: false });
  assert.match(f.u.status(id), /not saved/i); assert.equal(f.calls.length, before);
  f.editor.edit({ body: 'New text after byte failure' }); await f.registry.edited(f.editor);
  assert.equal((await f.journal.own(f.editor.key)).snapshot.draft.body, f.editor.draft.body);
  assert.equal([...f.rows.values()].filter(r => r.kind === 'upload-bytes-v1').length, 0);
  await f.u.remove(id); assert.equal(f.u.pending(), false);
});
test('normal publication attaches exact bytes and removal invalidates a held older save', async t => {
  const f = await fixture(t); f.editor.edit({ body: 'Send without removed image' });
  const id = await f.u.add(f.image); assert.equal(f.editor.draft.attachments.length, 1);
  const original = f.api.command.bind(f.api), entered = deferred(), release = deferred(); let held = false;
  f.api.command = async e => { const r = await original(e); if (e.kind === 'draft.save' && !held) { held = true; entered.resolve(); await release.promise; } return r; };
  t.after(() => release.resolve());
  const saving = f.registry.flush(f.editor); await entered.promise;
  await f.u.remove(id); const sending = f.registry.send(f.editor, { stay: true }); release.resolve();
  await saving; const a = await sending;
  assert.equal(a.status, 'confirmed');
  const source = await f.api.view('source', { kind: 'message', id: a.receipt.result.message_id });
  assert.deepEqual(source.attachments, []);
});
test('Check recovers a lost ready receipt without a command; next Send includes the image', async t => {
  const f = await fixture(t), upload = f.api.upload.bind(f.api); f.editor.edit({ body: 'Confirmed image belongs here' }); await f.registry.flush(f.editor);
  f.api.upload = async (...args) => { await upload(...args); throw Error('Lost committed response'); };
  const id = await f.u.add(f.image); assert.equal(f.editor.draft.attachments.length, 0);
  assert.equal(f.editor.dirty, false, 'text was acknowledged before the recovered attachment');
  const before = f.calls.length; await f.u.check(id);
  assert.ok(f.calls.slice(before).every(c => c.url === '/api/view'));
  assert.equal(f.editor.draft.attachments.length, 1); assert.ok(f.editor.dirty);
  const a = await f.registry.send(f.editor, { stay: true }); assert.equal(a.status, 'confirmed');
  const source = await f.api.view('source', { kind: 'message', id: a.receipt.result.message_id });
  assert.equal(source.attachments.length, 1);
  assert.equal((await f.control({ method: 'counts' })).media, 1);
});
test('unknown Check writes nothing; explicit Retry preserves the original media identity', async t => {
  const f = await fixture(t), upload = f.api.upload.bind(f.api);
  f.api.upload = async () => { throw Error('Dropped before Store'); };
  const id = await f.u.add(f.image), before = f.calls.length;
  await f.u.check(id); assert.ok(f.calls.slice(before).every(c => c.url === '/api/view'));
  f.api.upload = upload; await f.u.retry(id);
  assert.equal(f.editor.draft.attachments.length, 1);
  assert.equal((await f.control({ method: 'counts' })).media, 1);
});
test('Remove during publication prevents late association and preserves newer text', async t => {
  const f = await fixture(t), upload = f.api.upload.bind(f.api), entered = deferred(), release = deferred();
  f.api.upload = async (...args) => { const r = await upload(...args); entered.resolve(); await release.promise; return r; };
  t.after(() => release.resolve());
  const adding = f.u.add(f.image); await entered.promise;
  const id = f.u.current()[0].selection_id; await f.u.remove(id);
  f.editor.edit({ body: 'Newer text' }); await f.registry.edited(f.editor);
  release.resolve(); await adding;
  assert.deepEqual(f.editor.draft.attachments, []); assert.equal(f.editor.draft.body, 'Newer text');
});
test('malformed image requires explicit download with exactly one additional intent', async t => {
  const f = await fixture(t), id = await f.u.add(new File(['not a png'], 'bad.png', { type: 'image/png' }));
  assert.equal(f.editor.draft.attachments.length, 0); assert.match(f.u.status(id), /could not attach/i);
  await f.u.asDownload(id); assert.equal(f.editor.draft.attachments.length, 1);
  assert.equal((await f.control({ method: 'counts' })).media, 2);
  const entry = f.u.find(id); assert.equal(entry.attempts.length, 2);
  assert.equal(entry.attempts[0].publish_response.recorded, false);
  assert.notEqual(entry.attempts[0].media_id, entry.attempts[1].media_id);
});
test('zero bytes are refused before capture or command', async t => {
  const f = await fixture(t), before = f.calls.length;
  await assert.rejects(f.u.add(new File([], 'empty.png', { type: 'image/png' })), /empty|zero/i);
  assert.equal(f.calls.length, before); assert.equal(f.rows.size, 0);
});

test('ready bytes retire only after a canonical private save; caret does not recreate them', async t => {
  const f = await fixture(t); f.editor.edit({ body: 'Saved with its image' });
  const id = await f.u.add(f.image); assert.equal([...f.rows.values()].filter(r => r.kind === 'upload-bytes-v1').length, 1);
  await f.registry.flush(f.editor); await f.registry.cleanup.own(f.session);
  assert.equal([...f.rows.values()].filter(r => r.kind === 'upload-bytes-v1').length, 0);
  assert.equal(f.u.find(id).bytes_ref, null);
  assert.equal(await f.journal.own(f.editor.key), undefined);
  f.editor.draft.caret = { start: 2, end: 2 }; await f.session.persist();
  assert.equal(f.rows.size, 0);
});
test('acknowledged text never retires a selected pending image; explicit removed discard deletes bytes with pointer', async t => {
  const f = await fixture(t); f.editor.edit({ body: 'Acknowledged text' }); await f.registry.flush(f.editor);
  const id = await f.u.add(f.image, { start: false });
  await f.session.persist(); // settle the post-capture status before exercising the retirement proof
  await f.registry.cleanup.own(f.session);
  assert.equal([...f.rows.values()].filter(r => r.kind === 'upload-bytes-v1').length, 1);
  await f.u.remove(id); await f.u.discard(id);
  assert.equal([...f.rows.values()].filter(r => r.kind === 'upload-bytes-v1').length, 0);
  assert.equal((await f.journal.own(f.editor.key)).snapshot.uploadState.entries[0].bytes_ref, null);
});
test('a removed entry never becomes ready through late confirmation or admits frozen Remove', async t => {
  const f = await fixture(t); f.editor.edit({ body: 'A' });
  const id = await f.u.add(f.image), a = prepare(f.editor);
  await assert.rejects(f.u.remove(id), /earlier reply|frozen/i);
  assert.deepEqual(a.snapshot.attachments.map(r => r.id), [f.u.find(id).association.media_id]);
  assert.deepEqual(f.u.current(), []); assert.deepEqual(f.editor.draft.attachments, []);
});
test('unreadable image waiver is bound to exact row stamp and writing cycle', async t => {
  const f = await fixture(t), row = { id: 'opaque', editorKey: f.editor.key, stamp: 'v1', availability: 'unreadable', uploadPresent: true };
  f.rows.set(row.id, copy(row));
  f.editor.imageCopies = new Map([[row.id, row]]); f.registry.updateImageBarrier(f.editor);
  assert.equal(f.u.pending(), false, 'an alternate stays advisory');
  await f.registry.waiveUnreadable(f.editor, row); assert.equal(f.editor.recoveryDiscovery, false);
  f.editor.imageCopies.set(row.id, { ...row, stamp: 'v2' }); f.registry.updateImageBarrier(f.editor);
  assert.equal(f.u.pending(), false, 'an alternate stays advisory');
  f.rows.set(row.id, { ...row, stamp: 'v2' });
  await f.registry.waiveUnreadable(f.editor, { ...row, stamp: 'v2' });
  prepare(f.editor);
  f.registry.updateImageBarrier(f.editor); assert.equal(f.editor.recoveryDiscovery, true, 'new cycle offers the copy again');
  assert.equal(f.u.pending(), false, 'the saved copy never gates the new writing');
});
test('recorded pending refusal reason is bound to its editor, submission and original operation', async t => {
  const f = await fixture(t);
  assert.equal(typeof f.registry.pendingReason, 'function');
  const local = { id: 'a', prepareOperationId: 'p', sendOperationId: 's', snapshot: {}, receipt: {
    instance_id: f.editor.context.instanceId, recorded: true, operation_id: 'p', kind: 'submission.prepare', status: 'rejected', error: { message: 'Add a participant before sending.' } } };
  assert.equal(f.registry.pendingReason(f.editor, local), 'Add a participant before sending.');
  local.receipt.operation_id = 'another'; assert.equal(f.registry.pendingReason(f.editor, local), null);
});

test('a ready image from another runtime blocks before A is created', async t => {
  const f = await fixture(t); f.editor.edit({ body: 'Must stay private' }); await f.u.add(f.image);
  f.registry.runtime.current = { ...f.registry.runtime.current, authority_epoch: 'changed-runtime' };
  let error;
  try { await f.registry.send(f.editor, { stay: true }); } catch (caught) { error = caught; }
  assert.match(error?.message ?? '', /runtime|authority/i);
  assert.equal(f.editor.submissions.length, 0);
});
test('unreadable waiver re-reads the row before trusting the displayed stamp', async t => {
  const f = await fixture(t), row = { id: JSON.stringify([f.editor.key, 'old-writer']), editorKey: f.editor.key, writerId: 'old-writer',
    scope: JSON.stringify([f.editor.context.instanceId, f.editor.context.actor]), stamp: 'v1', active: 1, availability: 'unreadable', uploadPresent: true };
  f.editor.imageCopies = new Map([[row.id, row]]); f.rows.set(row.id, { ...row, stamp: 'v2' });
  await assert.rejects(async () => f.registry.waiveUnreadable(f.editor, row), /changed|review/i);
  assert.equal(f.editor.imageWaivers?.size ?? 0, 0);
});
test('format2 restore keeps refused A as a comparison rather than mistaking its shared slot for B', () => {
  const e = withImage({ ready: true }); e.draft.attachments = [{ id: 'media' }];
  const a = prepare(e);
  e.acceptPreparation({ recorded: true, instance_id: context.instanceId, operation_id: 'prepare', kind: 'submission.prepare', status: 'rejected', error: { code: 'REFUSED' } });
  const restored = restoreEditor(context, a.snapshot, e.snapshot());
  assert.equal(restored.draft.body, ''); assert.deepEqual(restored.draft.attachments, []);
  assert.equal(restored.conflict?.remote.body, a.snapshot.body);
});

for (const status of ['committed', 'rejected']) test(`B image belongs to B through ${status} preparation and a null server generation`, async t => {
  const f = await fixture(t); f.editor.edit({ body: 'Frozen A' });
  const first = await f.u.add(f.image), a = f.editor.beginPrepare({ prepareOperationId: 'p-cycle', sendOperationId: 's-cycle', submissionId: 'a-cycle' });
  const bCycle = f.editor.clientCycleId; assert.equal(f.editor.draft.generation, null);
  const second = await f.u.add(f.image);
  const mediaB = f.u.find(second).ready_descriptor.media_id;
  f.editor.acceptPreparation({ recorded: true, instance_id: f.facts.instance_id, operation_id: 'p-cycle', kind: 'submission.prepare', status,
    ...(status === 'rejected' ? { error: { code: 'REFUSED' } } : { result: { submission_id: a.id, send_operation_id: a.sendOperationId, next_draft: { id: a.snapshot.id, revision: 2, generation: 'new-generation' } } }) });
  assert.equal(f.editor.clientCycleId, bCycle); assert.deepEqual(f.editor.draft.attachments, [{ id: mediaB }]);
  assert.deepEqual(f.u.current().map(e => e.selection_id), [second]);
  assert.deepEqual(f.u.find(first).owner, { kind: 'submission', id: a.id });
});

test('failed removal keeps Send and page-close protection until its metadata is durable', async t => {
  const f = await fixture(t); const id = await f.u.add(f.image, { start: false });
  const put = f.backend.put; f.backend.put = async () => { throw Error('Metadata unavailable'); };
  await assert.rejects(f.u.remove(id), /Metadata unavailable/);
  assert.equal(f.u.pending(), true);
  assert.equal(f.registry.hasUnprotectedWriting, true);
  f.backend.put = put; await f.u.transition(() => {});
  assert.equal(f.u.pending(), false);
});

test('unrecognized upload lifecycle is preserved without authorizing Send', () => {
  const e = withImage({ ready: true }); e.draft.attachments = [{ id: 'media' }];
  e.uploadState.entries[0].future_policy = { keep: true };
  const snapshot = e.snapshot(), restored = restoreEditor(context, draft(), snapshot);
  assert.deepEqual(restored.snapshot().uploadState, snapshot.uploadState);
  assert.throws(() => prepare(restored), /saved image state/i);
});

test('admission limits refuse before any byte or media write', async t => {
  const f = await fixture(t), limits = f.registry.bootstrap.limits;
  for (const [key, value, file] of [
    ['image_bytes', 1, f.image], ['attachment_bytes', 1, f.image],
    ['attachment_count', 0, f.image], ['media_name_utf8_bytes', 1, f.image],
  ]) {
    const old = limits[key], calls = f.calls.length, puts = f.puts.length; limits[key] = value;
    await assert.rejects(f.u.add(file), /limit|name|count/i);
    limits[key] = old; assert.equal(f.calls.length, calls); assert.equal(f.puts.length, puts);
  }
});

test('fallback Retry keeps the second identity and unsupported files use only one intent', async t => {
  const f = await fixture(t), upload = f.api.upload.bind(f.api);
  const id = await f.u.add(new File(['bad png'], 'bad.png', { type: 'image/png' }));
  f.api.upload = async () => { throw Error('Dropped fallback'); };
  await f.u.asDownload(id); const second = copy(f.u.find(id).attempts[1]);
  await f.u.check(id); f.api.upload = upload; await f.u.retry(id);
  assert.equal(f.u.find(id).attempts.length, 2); assert.equal(f.u.find(id).attempts[1].media_id, second.media_id);
  assert.equal((await f.control({ method: 'counts' })).media, 2);
  const unsupported = await f.u.add(new File(['download only'], 'data.txt', { type: 'text/plain' }));
  assert.equal((await f.control({ method: 'counts' })).media, 2, 'unsupported type has no implicit begin');
  await f.u.asDownload(unsupported); assert.equal((await f.control({ method: 'counts' })).media, 3);
});

test('changed retained bytes and malformed confirmation cannot authorize Retry or download', async t => {
  const f = await fixture(t); f.api.upload = async () => { throw Error('Lost publication'); };
  const id = await f.u.add(f.image), e = f.u.find(id);
  await f.u.check(id); assert.equal(e.attempts[0].retry_allowed, true);
  const view = f.api.view.bind(f.api);
  f.api.view = async (name, args) => name === 'operation' ? { error: { code: 'UNAVAILABLE' } } : view(name, args);
  await assert.rejects(f.u.check(id), /match|unreadable/i);
  assert.equal(e.attempts[0].retry_allowed, false);
  f.api.view = view; await f.u.check(id);
  const row = f.rows.get(e.bytes_ref); row.blob = new Blob([new Uint8Array(f.image.size)]);
  const before = f.calls.length; await f.u.retry(id);
  assert.match(f.u.status(id), /digest/i); assert.equal(f.calls.length, before);
  await assert.rejects(f.u.asDownload(id), /cannot/i);
});

test('server busy remains an attempt cause until explicit Check then Retry', async t => {
  const f = await fixture(t); let uploads = 0;
  f.api.upload = async () => { uploads++; const error = Error('Server busy'); error.details = { error: { code: 'SERVER_BUSY' } }; throw error; };
  const id = await f.u.add(f.image); assert.equal(f.u.status(id), 'Server busy');
  await f.registry.edited(f.editor); assert.equal(uploads, 1);
  await assert.rejects(f.u.retry(id), /Check/i); assert.equal(uploads, 1);
  await f.u.check(id); assert.equal(uploads, 1); await f.u.retry(id); assert.equal(uploads, 2);
});

test('picker reservation, late chooser and held adoption respect presentation ownership', async t => {
  const f = await fixture(t), p = f.registry.current, token = f.u.reserve(p);
  await assert.rejects(f.registry.adoptCandidate(f.editor, {}, p), /current writing/i);
  f.u.cancel(token); const before = f.puts.length;
  await assert.rejects(f.u.choose(token, f.image), /expired/i); assert.equal(f.puts.length, before);
  const entered = deferred(), release = deferred(), view = f.api.view.bind(f.api);
  f.api.view = async (name, args) => { const answer = await view(name, args); if (name === 'editor_state') { entered.resolve(); await release.promise; } return answer; };
  t.after(() => release.resolve());
  const adopting = f.registry.adoptCandidate(f.editor, {}, p); await entered.promise;
  assert.throws(() => f.u.reserve(p), /review/i); await assert.rejects(f.u.add(f.image), /review/i);
  f.registry.setMode('note'); release.resolve(); await assert.rejects(adopting, /changed/i);
  assert.equal(f.puts.length, before); assert.equal(f.editor.adopting, false);
});

for (const surface of ['inline', 'modal']) test(`late chooser refuses new capture after access loss in ${surface}`, async t => {
  const f = await fixture(t);
  let p = f.registry.current;
  if (surface === 'inline') {
    const topic = (await f.api.view('topic', { topic_id: f.facts.topic_id })).topic;
    await f.registry.initializeInline(topic); await f.registry.close(p, { explicit: true }); p = f.registry.inline;
  }
  const editor = p.editors.reply, uploads = f.registry.sessionFor(editor).uploads;
  editor.edit({ body: 'Writing remains through access loss', caret: { start: 7, end: 7 } });
  const before = copy(editor.draft), token = uploads.reserve(p), putCount = f.puts.length;
  const writes = () => f.calls.filter(c => ['/api/command', '/api/media/upload'].includes(c.url)).length;
  const commands = writes(); editor.unavailable = true;
  await assert.rejects(uploads.choose(token, f.image), /unavailable/i);
  assert.equal(f.puts.length, putCount, 'the returned chooser file never enters byte or metadata capture');
  assert.equal(writes(), commands, 'the refused choice dispatches no command');
  assert.deepEqual(editor.draft, before); assert.equal(editor.imageReservation, null);
  editor.unavailable = false;
  assert.equal(f.puts.length, putCount); assert.equal(writes(), commands, 'regrant does not replay the choice');
  if (surface !== 'inline') return;
  // Positive boundary: bytes accepted before denial may finish on that owner.
  const entered = deferred(), release = deferred(), upload = f.api.upload.bind(f.api);
  t.after(() => release.resolve());
  f.api.upload = async (...args) => { const answer = await upload(...args); entered.resolve(); await release.promise; return answer; };
  const admitted = uploads.choose(uploads.reserve(p), f.image); await entered.promise;
  editor.unavailable = true; release.resolve(); const id = await admitted;
  assert.equal(uploads.valid(), true); assert.equal(uploads.status(id), 'Ready');
  assert.equal(editor.draft.body, before.body); assert.deepEqual(editor.draft.caret, before.caret);
  assert.equal(editor.draft.attachments.length, 1, 'already-admitted completion keeps its original draft association');
});

test('queued old-session persistence cannot write after its registration is replaced', async t => {
  const f = await fixture(t); await f.u.add(f.image, { start: false });
  const release = deferred(), entered = deferred();
  const hold = f.journal.enqueue(f.editor.key, async () => { entered.resolve(); await release.promise; }); await entered.promise;
  t.after(() => release.resolve());
  f.editor.edit({ body: 'Old session must not persist this' }); const before = f.puts.length, pending = f.session.persist();
  f.registry.sessions.delete(f.editor.key); release.resolve(); await hold;
  await assert.rejects(pending, /replaced/i); assert.equal(f.puts.length, before);
});

test('a recheck replaces only its rows among saved image copies and keeps what other pages loaded', async t => {
  const f = await fixture(t); f.editor.edit({ body: 'Otherwise sendable' });
  const kept = { id: 'u2', editorKey: f.editor.key, stamp: 'v1', availability: 'unreadable', uploadPresent: true };
  const locked = { id: 'r2', stamp: '1', availability: 'open-in-another-tab', uploadPresent: true };
  f.rows.set(kept.id, copy(kept));
  f.editor.imageCopies = new Map([[kept.id, kept], [locked.id, locked]]); f.registry.updateImageBarrier(f.editor);
  const stale = { ...f.editor, imageCopies: new Map(f.editor.imageCopies) };
  assert.equal(f.registry.applyRecheck(stale, [locked.id], { items: [] }), null);
  assert.deepEqual([...stale.imageCopies.keys()], ['u2', 'r2'], 'an editor the registry does not hold is left as it is');
  const validate = f.u.validateRetained.bind(f.u); let validations = 0;
  f.u.validateRetained = () => { validations++; return validate(); };
  await f.registry.applyRecheck(f.editor, [locked.id], { items: [] });
  assert.equal(validations, 1, 'retained images are validated again after a recheck');
  assert.deepEqual([...f.editor.imageCopies.keys()], ['u2']);
  await f.registry.applyRecheck(f.editor, [kept.id], { items: [kept] });
  assert.deepEqual([...f.editor.imageCopies.keys()], ['u2'], 'a rechecked row that is still retained stays');
  assert.equal(f.u.pending(), false, 'the alternative does not gate current writing');
  await f.registry.waiveUnreadable(f.editor, kept);
  prepare(f.editor);
  f.registry.dispose();
  assert.equal(f.registry.applyRecheck(f.editor, [kept.id], { items: [] }), null);
  assert.deepEqual([...f.editor.imageCopies.keys()], ['u2'], 'a disposed registry changes nothing');
});
test('continuation and locked saved-image copies stay recoverable without gating current writing', async t => {
  const f = await fixture(t); f.editor.edit({ body: 'Otherwise sendable' });
  f.editor.imageCopiesNext = 'page-eleven';
  assert.equal(f.u.pending(), false, 'the alternative does not gate current writing');
  f.editor.imageCopiesNext = null;
  f.editor.imageCopies = new Map([['locked', { id: 'locked', stamp: '1', availability: 'open-in-another-tab', uploadPresent: true }]]);
  assert.equal(f.u.pending(), false, 'the alternative does not gate current writing');
  await assert.rejects(f.registry.waiveUnreadable(f.editor, f.editor.imageCopies.get('locked')), /recover|resolve/i);
});

for (const restored of [false, true]) test(restored
  ? 'correcting unchanged restored A consumes its visible words and image once'
  : 'correcting exact A reuses its media while B keeps its own cycle and image', async t => {
  const f = await fixture(t); f.editor.edit({ body: 'A with an image' });
  const idA = await f.u.add(f.image); await f.registry.flush(f.editor);
  const current = f.editor.draft;
  const changed = await f.api.command(f.session.envelope('draft.save', crypto.randomUUID(), { draft_id: current.id }, { draft_revision: current.revision },
    { source_ref: f.editor.sourceRef, topic_id: f.editor.context.topicId, generation: current.generation, body: 'Remote competing private text', attachments: current.attachments }));
  assert.equal(changed.status, 'committed');
  const a = await f.registry.send(f.editor, { stay: true }); assert.equal(a.status, 'refused');
  assert.equal(f.editor.draft.body, 'A with an image');
  assert.deepEqual(f.editor.draft.attachments, a.snapshot.attachments, '1233 restores the refused image with its writing');
  // The person starts a distinct B, explicitly removing the restored A image.
  // Merely replacing words keeps a visible selected image in the same writing.
  const restoredA = f.u.current().find(entry => entry.retained_ref?.id === a.snapshot.attachments[0].id);
  assert.ok(restoredA);
  let idB;
  if (!restored) {
    await f.u.remove(restoredA.selection_id);
    f.editor.edit({ body: 'B remains private' }); idB = await f.u.add(f.image);
  }
  const cycleB = f.editor.clientCycleId;
  const bytePuts = f.puts.filter(p => p.bytes).length;
  const remote = (await f.api.view('editor_state', { source_ref: f.editor.sourceRef, topic_id: f.editor.context.topicId })).draft;
  const corrected = await f.session.correctPreparation(a, remote, f.editor.localVersion, { stay: true });
  assert.equal(corrected.status, 'confirmed');
  const sent = await f.api.view('source', { kind: 'message', id: corrected.receipt.result.message_id });
  assert.equal(sent.body, 'A with an image'); assert.deepEqual(sent.attachments.map(x => x.id), [f.u.find(idA).ready_descriptor.media_id]);
  assert.equal(f.editor.draft.body, restored ? '' : 'B remains private'); assert.equal(f.editor.clientCycleId, cycleB);
  assert.deepEqual(f.editor.draft.attachments, restored ? [] : [{ id: f.u.find(idB).ready_descriptor.media_id }]);
  if (restored) assert.equal(f.u.current().length, 0, 'the submitted restored image is not left selected for a second message');
  assert.equal((await f.control({ method: 'counts' })).media, restored ? 1 : 2); assert.equal(f.puts.filter(p => p.bytes).length, bytePuts);
});

test('private runtime recovery requires explicit image removal and creates a new cycle', async t => {
  const f = await fixture(t); f.editor.edit({ body: 'Private writing across a runtime change' });
  const id = await f.u.add(f.image), originalCycle = f.editor.clientCycleId, original = copy(f.u.find(id));
  await f.control({ method: 'epoch', epoch: 'image-epoch-two' }); await f.registry.flush(f.editor);
  assert.equal(f.session.recovery.phase, 'ready');
  await assert.rejects(f.session.resumePrivate(copy(f.session.recovery), f.editor.localVersion), /Remove the selected images/);
  assert.equal(f.editor.clientCycleId, originalCycle); assert.equal(f.u.current().length, 1);
  await f.u.remove(id); f.registry.cancelSave(f.editor);
  await f.session.resumePrivate(copy(f.session.recovery), f.editor.localVersion);
  assert.notEqual(f.editor.clientCycleId, originalCycle); assert.equal(f.editor.draft.body, 'Private writing across a runtime change');
  assert.deepEqual(f.editor.draft.attachments, []); assert.deepEqual(f.u.find(id).attempts, original.attempts);
  assert.deepEqual(f.u.find(id).binding.authority, original.binding.authority);
  assert.equal((await f.control({ method: 'counts' })).media, 1);
});

// Independent review X1-X3: recovery must preserve both the act and its escape.
test('X1 canonical refs without a manifest cannot prepare', () => {
  const e = new Editor(context, { ...draft(), attachments: [{ id: 'unreviewed' }] });
  assert.throws(() => prepare(e), /attachment|image/i);
});
test('X1 current canonical refs validate while an alternate copy stays retained', async t => {
  const f = await fixture(t); await f.u.add(f.image); await f.registry.flush(f.editor);
  const remote = (await f.api.view('editor_state', { source_ref: f.editor.sourceRef, topic_id: f.editor.context.topicId })).draft;
  const old = new Editor(f.editor.context, remote); old.uploadState = { format: 2, revision: 1, client_cycle_id: old.clientCycleId, entries: [entry(old)], submission_links: {} };
  const row = { ...f.journal.row(old.snapshot()), id: 'old-copy', writerId: 'old-writer', stamp: 'copy-one', availability: 'available' };
  f.backend.forEditor = async () => ({ items: [copy(row)], nextCursor: null });
  f.backend.changeCandidateImages = async () => { row.snapshot.uploadState.entries[0].selected = false; row.stamp = 'copy-two'; return copy(row); };
  f.rows.delete(f.journal.id(f.editor.key)); f.registry.cancelSave(f.editor); f.registry.sessions.delete(f.editor.key);
  const original = f.api.view.bind(f.api), entered = deferred(), release = deferred(); t.after(() => release.resolve());
  f.api.view = async (name, args) => { if (name === 'media') { entered.resolve(); await release.promise; } return original(name, args); };
  const registering = f.registry.register(f.editor.context, remote); registering.catch(() => {}); await entered.promise;
  const e = f.registry.sessions.get(f.editor.key).editor, u = f.registry.sessionFor(e).uploads;
  assert.equal(e.recoveryDiscovery, true); assert.equal(u.current().length, 1);
  assert.equal(u.current()[0].retained_ref.id, remote.attachments[0].id);
  assert.throws(() => prepare(e), /image|attachment/i, 'current canonical refs cannot send before validation');
  release.resolve(); await registering;
  assert.equal(u.pending(), false, 'a validated current image is independent of the retained alternative');
  assert.equal(e.recoveryDiscovery, true); assert.equal(row.snapshot.uploadState.entries[0].selected, true);
  await f.registry.changeCandidateImages(e, row, { kind: 'remove' });
  assert.equal(await f.journal.own(e.key), undefined, 'passive validation is not user writing');
  await u.remove(u.current()[0].selection_id); assert.deepEqual(e.draft.attachments, []);
});
test('X1 passive retained validation permits untouched ordinary-copy adoption', async t => {
  const f = await fixture(t); await f.u.add(f.image); await f.registry.flush(f.editor);
  const remote = (await f.api.view('editor_state', { source_ref: f.editor.sourceRef, topic_id: f.editor.context.topicId })).draft;
  f.rows.delete(f.journal.id(f.editor.key)); f.registry.cancelSave(f.editor); f.registry.sessions.delete(f.editor.key);
  const e = await f.registry.register(f.editor.context, remote); f.registry.current.editors.reply = e;
  assert.equal(await f.journal.own(e.key), undefined, 'automatic Check cannot occupy the adoption target');
  const ordinary = new Editor(e.context, remote); ordinary.edit({ body: 'Ordinary abandoned text copy' });
  const row = { ...f.journal.row(ordinary.snapshot()), id: 'ordinary', stamp: 'ordinary-v1' };
  f.backend.adopt = async (key, candidate, guard) => { assert.ok(guard()); assert.equal(f.rows.has(f.journal.id(key)), false); f.rows.set(f.journal.id(key), { ...row, id: f.journal.id(key) }); };
  const restored = await f.registry.adoptCandidate(e, row, f.registry.current);
  assert.equal(restored.draft.body, ordinary.draft.body);
});
function refusedCopy(e, server = e.draft) {
  const snapshot = e.snapshot(); snapshot.format = 2; snapshot.clientCycleId = e.clientCycleId;
  snapshot.uploadState = { format: 2, revision: 1, client_cycle_id: e.clientCycleId, entries: [], submission_links: {} };
  snapshot.submissions = [{ id: 'refused-a', status: 'refused', snapshot: copy(server), receipt: { kind: 'submission.prepare' } }];
  return { id: 'refused-copy', stamp: 'refused-v1', editorKey: e.key, availability: 'available', snapshot };
}
test('X2 corrected and superseded refused preparations do not block current writing', async t => {
  const f = await fixture(t); f.editor.recoveryServerDraft = copy(f.editor.draft);
  const row = refusedCopy(f.editor); row.snapshot.submissions[0].correctedBy = 'corrected-a';
  f.editor.imageCopies = new Map([[row.id, row]]); f.registry.updateImageBarrier(f.editor);
  assert.equal(f.u.pending(), false, 'corrected refusal is history');
  delete row.snapshot.submissions[0].correctedBy; row.snapshot.submissions[0].snapshot.revision--;
  f.registry.updateImageBarrier(f.editor); assert.equal(f.u.pending(), false, 'older revision is not the current server slot');
});
test('X2 Keep current writing preserves refused history and is scoped to stamp cycle and selected images', async t => {
  const f = await fixture(t); f.editor.recoveryServerDraft = copy(f.editor.draft); f.editor.edit({ body: 'Current B only' });
  let row = refusedCopy(f.editor, f.editor.recoveryServerDraft); f.rows.set(row.id, copy(row));
  f.editor.imageCopies = new Map([[row.id, row]]); f.registry.updateImageBarrier(f.editor);
  assert.equal(f.u.pending(), false);
  const original = copy(row.snapshot); row = await f.registry.keepCurrentWriting(f.editor, row);
  assert.equal(f.u.pending(), false); assert.deepEqual(f.rows.get(row.id).snapshot, original); assert.equal(f.editor.draft.body, 'Current B only');
  row.stamp = 'refused-v2'; f.rows.set(row.id, copy(row)); f.registry.updateImageBarrier(f.editor);
  assert.equal(f.u.pending(), false); await assert.rejects(f.registry.keepCurrentWriting(f.editor, { ...row, stamp: 'refused-v1' }), /changed|review/i);
  row = await f.registry.keepCurrentWriting(f.editor, row); f.editor.clientCycleId = 'next-cycle'; f.registry.updateImageBarrier(f.editor);
  assert.equal(f.u.pending(), false);
  row.snapshot.uploadState.entries.push(entry(f.editor)); f.rows.set(row.id, copy(row));
  await f.registry.keepCurrentWriting(f.editor, row); assert.equal(f.u.pending(), false, 'selected images in an alternative stay advisory');
  f.u.initialize().entries.push(entry(f.editor)); assert.equal(f.u.pending(), true, 'a current selected image still owns its guard');
});
test('X2 B saved in a later revision does not restore a false refused-A conflict', () => {
  const e = withImage({ ready: true }); e.draft.attachments = [{ id: 'media' }]; prepare(e);
  e.acceptPreparation({ recorded: true, instance_id: context.instanceId, operation_id: 'prepare', kind: 'submission.prepare', status: 'rejected', error: { code: 'REFUSED' } });
  e.edit({ body: 'Saved B' }); e.draft.revision++; e.ackVersion = e.localVersion;
  assert.equal(restoreEditor(context, e.draft, e.snapshot()).conflict, null);
});
test('X1 late passive validation cannot attach after removal or session replacement', async t => {
  const f = await fixture(t); f.editor.draft.attachments = [{ id: 'retained' }]; f.u.importRetained();
  const e = f.u.current()[0], entered = deferred(), release = deferred(); t.after(() => release.resolve());
  f.api.view = async () => { entered.resolve(); await release.promise; return { instance_id: f.editor.context.instanceId, media_id: 'retained', state: 'ready', media_revision: 2, name: 'retained.png', content_type: 'image/png', size_bytes: 8, sha256: 'a'.repeat(64), inline: true }; };
  const checking = f.u.validateRetained(); await entered.promise;
  e.selected = false; e.version++; f.editor.draft.attachments = [];
  f.registry.sessions.delete(f.editor.key); release.resolve(); await checking;
  assert.equal(e.ready_descriptor, null); assert.equal(e.association, null); assert.deepEqual(f.editor.draft.attachments, []);
  assert.equal(f.puts.length, 0);
});
test('X2 Keep current writing rereads the durable candidate and rejects changes during inspection', async t => {
  const f = await fixture(t); f.editor.recoveryServerDraft = copy(f.editor.draft); const row = refusedCopy(f.editor);
  f.editor.imageCopies = new Map([[row.id, row]]); f.rows.set(row.id, { ...copy(row), stamp: 'durably-changed' });
  await assert.rejects(f.registry.keepCurrentWriting(f.editor, row), /changed|review/i);
  f.rows.set(row.id, copy(row)); const entered = deferred(), release = deferred(); t.after(() => release.resolve());
  const inspect = f.journal.inspectCandidate.bind(f.journal);
  f.journal.inspectCandidate = async (...args) => { const result = await inspect(...args); entered.resolve(); await release.promise; return result; };
  const choosing = f.registry.keepCurrentWriting(f.editor, row); await entered.promise; f.editor.clientCycleId = 'changed-during-inspection'; release.resolve();
  await assert.rejects(choosing, /changed|review/i); assert.equal(f.editor.refusedCopyChoices?.size ?? 0, 0);
});
for (const failure of ['transport', 'typed-error', 'wrong-scope', 'success', 'confirmed-none']) test(`X4 refused prepare keeps a durable blocking comparison through ${failure} follow-up read`, async t => {
  const f = await fixture(t); f.editor.edit({ body: 'Frozen A' }); await f.registry.flush(f.editor);
  const d = copy(f.editor.draft);
  await f.api.command(f.session.envelope('draft.save', crypto.randomUUID(), { draft_id: d.id }, { draft_revision: d.revision },
    { source_ref: f.editor.sourceRef, topic_id: f.editor.context.topicId, generation: d.generation, body: 'Other device writing' }));
  await f.registry.cleanup.idle(f.editor.key); const reservation = f.registry.cleanup.foreground(); t.after(() => reservation.release());
  const original = f.api.view.bind(f.api), entered = deferred(), release = deferred(); t.after(() => release.resolve());
  f.api.view = async (name, args) => {
    if (name !== 'editor_state') return original(name, args);
    entered.resolve(); await release.promise;
    if (failure === 'transport') throw Object.assign(Error('This request lane is busy'), { details: { error: { code: 'SERVER_BUSY', message: 'This request lane is busy' } } });
    if (failure === 'typed-error') return { error: { code: 'SERVER_BUSY', message: 'Typed busy read' } };
    const state = await original(name, args); return failure === 'wrong-scope' ? { ...state, destination: { topic_id: 'wrong' } } : failure === 'confirmed-none' ? { ...state, draft: null } : state;
  };
  const sending = f.registry.send(f.editor, { stay: true }).then(value => ({ value }), error => ({ error }));
  f.editor.edit({ body: 'Current B stays private' }); await entered.promise;
  const midread = (await f.journal.own(f.editor.key)).snapshot;
  try {
    assert.ok(midread.conflict, 'block is durable before the read starts');
    assert.equal(midread.conflict.attempted.body, 'Current B stays private');
    assert.equal(Object.hasOwn(midread.conflict, 'remote'), false, 'unknown is key-absent');
    for (const format of [1, 2]) {
      const saved = copy(midread);
      if (format === 2) { saved.format = 2; saved.clientCycleId = 'restored-cycle'; saved.uploadState = { format: 2, revision: 0, client_cycle_id: saved.clientCycleId, entries: [], submission_links: {} }; }
      const restored = restoreEditor(f.editor.context, d, saved);
      assert.equal(Object.hasOwn(restored.conflict, 'remote'), false); assert.equal(restored.saveTicket('must-not-autosave'), null);
    }
  } finally { release.resolve(); }
  const result = await sending; assert.equal(result.error, undefined); assert.equal(result.value.status, 'refused');
  const kept = (await f.journal.own(f.editor.key)).snapshot;
  assert.equal(kept.draft.body, 'Current B stays private');
  if (failure === 'success') assert.equal(kept.conflict.remote.body, 'Other device writing');
  else if (failure === 'confirmed-none') { assert.equal(Object.hasOwn(kept.conflict, 'remote'), true); assert.equal(kept.conflict.remote, null); }
  else { assert.equal(Object.hasOwn(kept.conflict, 'remote'), false); assert.ok(kept.conflict.readError); }
  assert.equal(f.editor.saveTicket('blocked-save'), null);
  assert.equal(f.calls.filter(c => c.body && JSON.parse(c.body).kind === 'message.send').length, 0);
});
test('X2 a failed current-slot read keeps refused history reachable without gating other writing', async t => {
  const f = await fixture(t); const row = refusedCopy(f.editor); row.snapshot.submissions[0].snapshot.revision++;
  f.backend.forEditor = async () => ({ items: [copy(row)], nextCursor: null });
  f.api.view = async () => { throw Error('Current slot unavailable'); };
  await assert.rejects(f.registry.recoveryCandidates(f.editor), /unavailable/);
  assert.equal(f.u.pending(), false); assert.equal(f.editor.recoveryDiscovery, true, 'unknown history stays reachable');
  assert.equal(f.editor.recoveryServerDraft, undefined); assert.equal(f.editor.imageCopies.get(row.id).snapshot.submissions[0].status, 'refused');
});

test('931 a kept refusal survives a new writer only for the same canonical writing and authority', async t => {
  const f = await fixture(t); f.editor.recoveryServerDraft = copy(f.editor.draft); f.editor.edit({ body: 'Chosen B' });
  const row = refusedCopy(f.editor, { ...f.editor.recoveryServerDraft, body: 'Frozen A' }); f.rows.set(row.id, copy(row));
  f.editor.imageCopies = new Map([[row.id, row]]); f.registry.updateImageBarrier(f.editor);
  const kept = await f.registry.keepCurrentWriting(f.editor, row);
  const { keptCopy } = await import('../web/writing-comparison.mjs');
  const restored = new Editor(f.editor.context, copy(f.editor.draft));
  restored.reviewWriterId = 'new-document'; restored.reviewAuthority = copy(f.session.authority);
  assert.equal(keptCopy(restored, kept), true);
  restored.draft.body += ' changed elsewhere'; assert.equal(keptCopy(restored, kept), false);
  restored.draft.body = 'Chosen B'; restored.reviewAuthority.authority_epoch = 'other-runtime'; assert.equal(keptCopy(restored, kept), false);
  assert.deepEqual(f.rows.get(row.id).snapshot, row.snapshot, 'choice changes no frozen writing or send history');
});
test('931 a failed choice write leaves the refusal reachable and the source intact', async t => {
  const f = await fixture(t); f.editor.recoveryServerDraft = copy(f.editor.draft);
  const row = refusedCopy(f.editor); f.rows.set(row.id, copy(row)); f.editor.imageCopies = new Map([[row.id, row]]);
  f.registry.updateImageBarrier(f.editor); f.backend.failChoice = true;
  await assert.rejects(f.registry.keepCurrentWriting(f.editor, row), /not saved/);
  assert.equal(f.u.pending(), false); assert.equal(f.editor.recoveryDiscovery, true); assert.deepEqual(f.rows.get(row.id), row);
  assert.equal(f.editor.refusedCopyChoices?.size ?? 0, 0);
});

 test('1044 successful adoption retires scheduled callbacks of the replaced editor', async t => {
  const f = await fixture(t), old = f.editor, callbacks = new Map(); let serial = 0;
  f.registry.timers = { now: () => 0, setTimeout: fn => { callbacks.set(++serial, fn); return serial; }, clearTimeout: id => callbacks.delete(id) };
  f.registry.schedule(old);
  assert.equal(callbacks.size, 2, 'real idle and maximum save callbacks are queued');
  const saved = new Editor(old.context, old.draft); saved.edit({ body: 'Explicitly adopted writing' });
  const row = { ...f.journal.row(saved.snapshot()), id: 'adopt-timer1044', stamp: 'timer1044' };
  f.backend.adopt = async (key, candidate, guard) => { assert.ok(guard()); f.rows.set(f.journal.id(key), { ...row, id: f.journal.id(key) }); };
  const adopted = await f.registry.adoptCandidate(old, row, f.registry.current);
  assert.notEqual(adopted, old);
  assert.doesNotThrow(() => { for (const [id, run] of [...callbacks]) { callbacks.delete(id); run(); } }, 'advancing past both save deadlines cannot flush an unregistered editor');
  assert.equal(f.registry.sessionFor(adopted).editor, adopted);
  assert.equal(adopted.draft.body, 'Explicitly adopted writing');
});

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
    forEditor: async key => ({ items: [...rows.values()].filter(r => r.editorKey === key && r.active === 1 && r.writerId !== writerId).map(r => ({ ...copy(r), availability: 'available' })), nextCursor: null }),
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
  assert.throws(() => prepare(f.editor), /saved image/);
  await f.registry.waiveUnreadable(f.editor, row); assert.equal(f.editor.recoveryDiscovery, false);
  f.editor.imageCopies.set(row.id, { ...row, stamp: 'v2' }); f.registry.updateImageBarrier(f.editor);
  assert.throws(() => prepare(f.editor), /saved image/);
  f.rows.set(row.id, { ...row, stamp: 'v2' });
  await f.registry.waiveUnreadable(f.editor, { ...row, stamp: 'v2' });
  prepare(f.editor);
  assert.equal(f.u.pending(), true, 'new B must review that copy again');
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

test('queued old-session persistence cannot write after its registration is replaced', async t => {
  const f = await fixture(t); await f.u.add(f.image, { start: false });
  const release = deferred(), entered = deferred();
  const hold = f.journal.enqueue(f.editor.key, async () => { entered.resolve(); await release.promise; }); await entered.promise;
  t.after(() => release.resolve());
  f.editor.edit({ body: 'Old session must not persist this' }); const before = f.puts.length, pending = f.session.persist();
  f.registry.sessions.delete(f.editor.key); release.resolve(); await hold;
  await assert.rejects(pending, /replaced/i); assert.equal(f.puts.length, before);
});

test('continuation and locked saved-image copies are barriers even without visible file refs', async t => {
  const f = await fixture(t); f.editor.edit({ body: 'Otherwise sendable' });
  f.editor.imageCopiesNext = 'page-eleven';
  assert.throws(() => prepare(f.editor), /saved image/i);
  f.editor.imageCopiesNext = null;
  f.editor.imageCopies = new Map([['locked', { id: 'locked', stamp: '1', availability: 'open-in-another-tab', uploadPresent: true }]]);
  assert.throws(() => prepare(f.editor), /saved image/i);
  await assert.rejects(f.registry.waiveUnreadable(f.editor, f.editor.imageCopies.get('locked')), /recover|resolve/i);
});

test('correcting exact A reuses its media while B keeps its own cycle and image', async t => {
  const f = await fixture(t); f.editor.edit({ body: 'A with an image' });
  const idA = await f.u.add(f.image); await f.registry.flush(f.editor);
  const current = f.editor.draft;
  const changed = await f.api.command(f.session.envelope('draft.save', crypto.randomUUID(), { draft_id: current.id }, { draft_revision: current.revision },
    { source_ref: f.editor.sourceRef, topic_id: f.editor.context.topicId, generation: current.generation, body: 'Remote competing private text', attachments: current.attachments }));
  assert.equal(changed.status, 'committed');
  const a = await f.registry.send(f.editor, { stay: true }); assert.equal(a.status, 'refused');
  f.editor.edit({ body: 'B remains private' }); const idB = await f.u.add(f.image), cycleB = f.editor.clientCycleId;
  const bytePuts = f.puts.filter(p => p.bytes).length;
  const remote = (await f.api.view('editor_state', { source_ref: f.editor.sourceRef, topic_id: f.editor.context.topicId })).draft;
  const corrected = await f.session.correctPreparation(a, remote, f.editor.localVersion, { stay: true });
  assert.equal(corrected.status, 'confirmed');
  const sent = await f.api.view('source', { kind: 'message', id: corrected.receipt.result.message_id });
  assert.equal(sent.body, 'A with an image'); assert.deepEqual(sent.attachments.map(x => x.id), [f.u.find(idA).ready_descriptor.media_id]);
  assert.equal(f.editor.draft.body, 'B remains private'); assert.equal(f.editor.clientCycleId, cycleB);
  assert.deepEqual(f.editor.draft.attachments, [{ id: f.u.find(idB).ready_descriptor.media_id }]);
  assert.equal((await f.control({ method: 'counts' })).media, 2); assert.equal(f.puts.filter(p => p.bytes).length, bytePuts);
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

import test from 'node:test';
import assert from 'node:assert/strict';
import { Api, AttemptError } from '../web/api.mjs';
import { RecoveryJournal } from '../web/journal.mjs';
import { createServer } from 'node:http';

test('cleanup API abort reaches a real stalled HTTP response body for bootstrap and view', async () => {
  for (const method of ['bootstrap', 'view']) {
    let entered;
    const ready = new Promise(resolve => { entered = resolve; });
    const server = createServer((_request, response) => {
      response.writeHead(200, { 'Content-Type': 'application/json' }); response.write('{"unfinished":'); entered();
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const origin = 'http://127.0.0.1:' + server.address().port;
    const api = new Api('fixture', (url, options) => fetch(new URL(url, origin), options));
    const controller = new AbortController();
    const request = method === 'bootstrap' ? api.bootstrap({ signal: controller.signal }) : api.view('editor_state', {}, { signal: controller.signal });
    const completed = request.then(value => ({ value }), error => ({ error }));
    let timer;
    try {
      await ready; controller.abort();
      const result = await Promise.race([completed, new Promise(resolve => { timer = setTimeout(() => resolve({ timeout: true }), 250); })]);
      assert.equal(result.timeout, undefined, method + ' forwards abort to the real transport');
      assert.ok(result.error instanceof AttemptError);
    } finally {
      clearTimeout(timer); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); await completed;
    }
  }
});

test('download Blobs keep exact bytes and descriptor but not an active MIME type', async () => {
  for (const [type, inline, expected] of [
    ['text/html', false, 'application/octet-stream'],
    ['image/svg+xml', true, 'application/octet-stream'],
    ['image/png', false, 'application/octet-stream'],
    ['image/png', true, 'image/png'],
  ]) {
    const bytes = new TextEncoder().encode('exact transport fixture bytes');
    const sha256 = Buffer.from(await crypto.subtle.digest('SHA-256', bytes)).toString('hex');
    const attachment = { id: 'mime-fixture', name: 'exact-name', content_type: type, inline, size_bytes: bytes.length, sha256 };
    const descriptor = { ...attachment, media_id: attachment.id, instance_id: 'new1' }; delete descriptor.id;
    const api = new Api('fixture-token', async () => new Response(bytes,
      { status: 200, headers: { 'X-AIM-Media': JSON.stringify(descriptor) } }));
    const media = await api.media('new1', attachment, { kind: 'message', id: 'm1' });
    assert.equal(media.blob.type, expected);
    assert.deepEqual(media.descriptor, descriptor);
    assert.deepEqual(new Uint8Array(await media.blob.arrayBuffer()), bytes);
    assert.equal(media.inline, expected === 'image/png');
  }
});

test('API sends the unchanged command and bearer token, with no actor override', async () => {
  let captured;
  const receipt = { instance_id: 'new1', recorded: true, status: 'committed' };
  const api = new Api('session-token', async (path, options) => {
    captured = { path, options };
    return { ok: true, status: 200, json: async () => receipt };
  });
  const command = { v: 1, instance_id: 'new1', operation_id: 'send-A', kind: 'message.send', target: { topic_id: 't1' }, expected: {}, args: { submission_id: 's1' } };
  assert.deepEqual(await api.command(command), receipt);
  assert.equal(captured.path, '/api/command');
  assert.equal(captured.options.headers.Authorization, 'Bearer session-token');
  assert.deepEqual(JSON.parse(captured.options.body), command);
  assert.equal(captured.options.credentials, 'same-origin');
});

test('HTTP refusal and lost transport do not manufacture an operation outcome', async () => {
  const api = new Api('token', async () => ({ ok: false, status: 413, json: async () => ({ error: { code: 'REQUEST_TOO_LARGE' } }) }));
  await assert.rejects(api.command({ operation_id: 'same-send' }), error => error instanceof AttemptError && error.recorded === false && error.status === 413);
  const lost = new Api('token', async () => { throw new TypeError('network failed'); });
  await assert.rejects(lost.command({ operation_id: 'same-send' }), error => error instanceof AttemptError && error.recorded === false);
});

test('media keeps JSON-looking file bytes and binds the verified descriptor to source and instance', async () => {
  const bytes = new TextEncoder().encode('{"error":"this is a file"}');
  const sha256 = Buffer.from(await crypto.subtle.digest('SHA-256', bytes)).toString('hex');
  const attachment = { id: 'media-1', name: 'readme.json', content_type: 'application/json', size_bytes: bytes.length, sha256, inline: false };
  const descriptor = { ...attachment, media_id: attachment.id, instance_id: 'new1' }; delete descriptor.id;
  let request;
  const api = new Api('token', async (url, options) => {
    request = { url, options };
    return new Response(bytes, { status: 200, headers: { 'X-AIM-Media': JSON.stringify(descriptor) } });
  });
  assert.equal(typeof api.media, 'function');
  const media = await api.media('new1', attachment, { kind: 'message', id: 'm1' });
  assert.equal(await media.blob.text(), '{"error":"this is a file"}');
  assert.deepEqual(JSON.parse(request.options.body), { media_id: 'media-1', source_ref: { kind: 'message', id: 'm1' } });
  descriptor.instance_id = 'other';
  await assert.rejects(api.media('new1', attachment, { kind: 'message', id: 'm1' }), /identity|descriptor|match/i);
});

test('media cannot trust an inline flag for active content or mismatched bytes', async () => {
  const bytes = new TextEncoder().encode('<svg onload="oops"/>');
  const sha256 = Buffer.from(await crypto.subtle.digest('SHA-256', bytes)).toString('hex');
  const attachment = { id: 'media-2', name: 'image.svg', content_type: 'image/svg+xml', size_bytes: bytes.length, sha256, inline: true };
  const descriptor = { ...attachment, media_id: attachment.id, instance_id: 'new1' }; delete descriptor.id;
  const api = new Api('token', async () => new Response(bytes, { headers: { 'X-AIM-Media': JSON.stringify(descriptor) } }));
  assert.equal(typeof api.media, 'function');
  assert.equal((await api.media('new1', attachment)).inline, false);
  descriptor.sha256 = attachment.sha256 = '0'.repeat(64);
  await assert.rejects(api.media('new1', attachment), /bytes|digest|match/i);
});

const memory = () => {
  const rows = new Map();
  return {
    rows,
    async put(row) { rows.set(row.id, structuredClone(row)); },
    async get(id) { return structuredClone(rows.get(id) ?? null); },
    async forEditor(key) { return [...rows.values()].filter(row => row.editorKey === key).map(row => structuredClone(row)); },
    async removeExact(id, stamp) { if (rows.get(id)?.stamp === stamp) rows.delete(id); },
  };
};
const snapshot = body => ({ key: 'editor-key', context: { instanceId: 'new1', actor: 'fixture' }, draft: { body, generation: 'g1' }, localVersion: 1, ackVersion: 0, submissions: [] });

test('late acknowledgement cannot delete a more recent journal record', async () => {
  const backend = memory();
  const journal = new RecoveryJournal(backend, 'tab-1');
  const first = await journal.save(snapshot('A'));
  const second = await journal.save(snapshot('B'));
  await journal.removeExact('editor-key', first);
  assert.equal((await journal.own('editor-key')).snapshot.draft.body, 'B');
  await journal.removeExact('editor-key', second);
  assert.equal(await journal.own('editor-key'), null);
});

test('two tabs keep both unacknowledged drafts, and cleanup touches only the acknowledged writer', async () => {
  const backend = memory();
  const a = new RecoveryJournal(backend, 'tab-A');
  const b = new RecoveryJournal(backend, 'tab-B');
  const stamp = await a.save(snapshot('A'));
  await b.save(snapshot('B'));
  assert.equal((await a.candidates('editor-key')).length, 2);
  await a.removeExact('editor-key', stamp);
  assert.equal((await b.own('editor-key')).snapshot.draft.body, 'B');
});

test('journal failure remains a failure and does not poison subsequent saves', async () => {
  const backend = memory();
  const put = backend.put.bind(backend);
  let fail = true;
  backend.put = async row => { if (fail) throw new Error('quota exceeded'); return put(row); };
  const journal = new RecoveryJournal(backend, 'tab');
  await assert.rejects(journal.save(snapshot('Keep this')), /quota/);
  fail = false;
  await journal.save(snapshot('Keep this too'));
  assert.equal((await journal.own('editor-key')).snapshot.draft.body, 'Keep this too');
});

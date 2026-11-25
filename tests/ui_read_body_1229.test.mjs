// 1229: real client headers/body boundaries through the existing read owners.
// No browser, live instance, product patch or substituted JSON parser is used.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { connect } from 'node:net';
import { Api, AttemptError } from '../web/api.mjs';
import { RecoveryCleanup } from '../web/cleanup.mjs';
import { Freshness, readFailure } from '../web/freshness.mjs';

const authority = { authority_id: 'a1229', authority_epoch: 'e1229', continuity: 'initial' };
const admission = { version: 1, header: 'X-AIM-Read-Class',
  foreground: { slots: 1, max_waiters: 8, queue_timeout_ms: 5000 },
  background: { slots: 1, max_waiters: 2, queue_timeout_ms: 500 } };
const bootstrap = { instance_id: 'isolated1229', actor: 'reader1229', authority, transport: { read_admission: admission } };
const scope = { kind: 'topic', id: 'topic1229' };
const cursor = seq => ({ v: 1, kind: 'checkpoint', instance_id: bootstrap.instance_id, actor_id: bootstrap.actor,
  authority_id: authority.authority_id, authority_epoch: authority.authority_epoch, scope, after_seq: seq });
const page = (seq = 0, items = []) => ({ instance_id: bootstrap.instance_id, scope, baseline: false, items,
  has_more: false, continuation: null, checkpoint: cursor(seq), covered_versions: { topic: seq, notebook: 0 } });
const answer = value => ({ instance_id: bootstrap.instance_id, ...value });
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const caught = promise => promise.then(value => ({ value }), error => ({ error }));
const tick = () => new Promise(resolve => setImmediate(resolve));
async function within(promise, label, ms = 3000) {
  let timer;
  try { return await Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(Error(label + ' did not settle')), ms); })]); }
  finally { clearTimeout(timer); }
}
function write(response, value, status = 200) {
  response.writeHead(status, { 'Content-Type': 'application/json' }); response.end(JSON.stringify(value));
}
function stalled(response) {
  response.writeHead(200, { 'Content-Type': 'application/json' }); response.write('{"instance_id":"isolated1229",');
}
function clock() {
  let id = 0; const jobs = new Map();
  return { jobs, setTimeout(fn, ms) { jobs.set(++id, { fn, ms }); return id; }, clearTimeout(id) { jobs.delete(id); } };
}

async function transport(t, respond, { ignoreAbort = () => false } = {}) {
  console.log('1229-body-entry ' + t.name);
  const requests = [], clients = [], waiting = new Map(), sockets = new Set(), pauses = [];
  const server = createServer(async (request, response) => {
    const parts = []; for await (const part of request) parts.push(part);
    const bytes = Buffer.concat(parts), raw = bytes.toString();
    const payload = request.url === '/api/view' || request.url === '/api/command' ? JSON.parse(raw) : null;
    const record = { path: request.url, payload, raw, bytes, command: request.headers['x-aim-command'] ?? null, response };
    requests.push(record); respond(record, response);
  });
  server.on('connection', socket => { sockets.add(socket); socket.once('close', () => sockets.delete(socket)); });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port, origin = 'http://127.0.0.1:' + port;
  const api = new Api('isolated-fixture-token', async (path, options) => {
    const tag = path === '/api/view' ? JSON.parse(options.body).name : path;
    const record = { tag, signal: options.signal, headers: deferred(), jsonEntered: deferred(), settled: false, bodyError: null };
    const index = clients.filter(client => client.tag === tag).length;
    clients.push(record); waiting.get(tag + ':' + index)?.resolve(record);
    // The ignoring case still uses a real HTTP body; only abort forwarding is
    // deliberately withheld to prove occupancy/epoch fencing until settlement.
    const selected = ignoreAbort(tag) ? { ...options, signal: undefined } : options;
    const response = await fetch(new URL(path, origin), selected);
    record.status = response.status; record.headers.resolve();
    const json = response.json.bind(response);
    response.json = () => {
      const body = json(); record.jsonReading = true; record.jsonEntered.resolve();
      body.then(() => { record.settled = true; }, error => { record.settled = true; record.bodyError = error; });
      return body;
    };
    return response;
  }, async ms => { pauses.push(ms); });
  async function client(tag, index = 0) {
    let record = clients.filter(client => client.tag === tag)[index];
    if (!record) {
      const key = tag + ':' + index; if (!waiting.has(key)) waiting.set(key, deferred());
      record = await within(waiting.get(key).promise, 'client request ' + key);
    }
    await within(record.headers.promise, 'client HTTP headers ' + tag);
    await within(record.jsonEntered.promise, 'real pending JSON read ' + tag);
    return record;
  }
  t.after(async () => {
    const closed = new Promise(resolve => server.close(resolve)); server.closeAllConnections();
    await within(closed, 'owned server close'); await tick(); await tick();
    const refused = await new Promise(resolve => {
      const socket = connect({ host: '127.0.0.1', port });
      socket.once('connect', () => { socket.destroy(); resolve(false); });
      socket.once('error', error => { socket.destroy(); resolve(error.code === 'ECONNREFUSED'); });
    });
    assert.equal(sockets.size, 0, 'all owned HTTP sockets closed'); assert.equal(refused, true, 'owned listener is absent');
    console.log('1229-body-cleanup ' + JSON.stringify({ test: t.name, port, sockets: sockets.size, tcpRefused: refused,
      clients: clients.map(client => ({ tag: client.tag, status: client.status ?? null, jsonEntered: client.jsonReading === true,
        settled: client.settled, aborted: client.signal?.aborted ?? false, bodyError: client.bodyError?.name ?? null })) }));
  });
  return { api, requests, clients, client, pauses };
}

function reader(api, timeout = 500) {
  return new RecoveryCleanup({ api, bootstrap, journal: {}, runtime: { readTimeoutMs: timeout }, changed: () => {} });
}
function freshness(t, api, cleanup, refresh = async () => true) {
  const states = [], timers = clock();
  const f = new Freshness({ api, bootstrap, topicId: scope.id, checkpoint: cursor(0), timers, random: () => 0,
    read: operation => cleanup.read(operation), keys: item => [{ key: item.resource_kind, version: item.version }],
    refresh, status: state => states.push(state) });
  t.after(() => f.dispose()); return { f, states, timers };
}

test('1229 client-confirmed200 pending body: owned deadline retries and Freshness recovers the dirty resource', async t => {
  let topicReads = 0, changesReads = 0;
  const http = await transport(t, (request, response) => {
    if (request.payload?.name === 'changes') return write(response, page(1, ++changesReads === 1
      ? [{ seq: 1, resource_kind: 'topic', resource_id: scope.id, version: 1 }] : []));
    if (request.payload?.name === 'topic' && ++topicReads === 1) return stalled(response);
    write(response, answer({ topic: { id: scope.id, version: 1 } }));
  });
  const cleanup = reader(http.api), paints = [];
  const { f, states, timers } = freshness(t, http.api, cleanup, async (_key, _version, read, current) => {
    const result = await read('topic', { topic_id: scope.id });
    if (current()) paints.push(result.topic); return true;
  });
  const run = f.request();
  const body = await http.client('topic');
  assert.equal(body.status, 200); assert.equal(body.settled, false); assert.equal(body.signal.aborted, false);
  const epoch = cleanup.readEpoch, active = cleanup.activeRead;
  let abortObservation;
  body.signal.addEventListener('abort', () => { abortObservation = { active: cleanup.activeRead === active,
    pending: !body.settled, epoch: cleanup.readEpoch }; }, { once: true });
  await within(run, 'owned timeout/Freshness pass');
  assert.deepEqual(abortObservation, { active: true, pending: true, epoch }, 'the actual deadline owns the abort while transport is occupied');
  assert.equal(body.settled, true); assert.equal(cleanup.activeRead, null); assert.deepEqual(paints, []);
  assert.equal(f.checkpoint.after_seq, 1); assert.equal(f.dirty.has('topic'), true, 'failed resource is still owed');
  assert.equal(f.stopped, false, 'owned body abort must not become a diagnostic stop');
  assert.equal(timers.jobs.size, 1); assert.deepEqual(states, [], 'first retry remains quiet');
  const [id, retry] = [...timers.jobs][0]; assert.equal(retry.ms, 500); timers.jobs.delete(id); retry.fn();
  await within(f.running, 'automatic retained-resource retry');
  assert.equal(topicReads, 2); assert.equal(f.dirty.size, 0); assert.equal(f.settled, true);
  assert.deepEqual(paints, [{ id: scope.id, version: 1 }]); assert.equal(states.at(-1).kind, 'current');
});

test('1229 bootstrap200 pending body through Cleanup uses retry classification after its own deadline', async t => {
  const http = await transport(t, (_request, response) => stalled(response));
  const cleanup = reader(http.api), run = caught(cleanup.read(options => http.api.bootstrap(options)));
  const body = await http.client('/api/bootstrap'); assert.equal(body.status, 200); assert.equal(body.settled, false);
  const result = await within(run, 'bootstrap deadline body settlement');
  assert.ok(result.error instanceof AttemptError); assert.equal(body.signal.aborted, true);
  assert.equal(body.settled, true); assert.equal(cleanup.activeRead, null);
  assert.equal(readFailure(result.error).kind, 'retry', 'body interruption is not malformed200');
});

test('1229 a before-header owned deadline is a separate retry boundary', async t => {
  const reached = deferred();
  const http = await transport(t, () => reached.resolve());
  const cleanup = reader(http.api), run = caught(cleanup.read(options => http.api.view('before-headers', {}, options)));
  await within(reached.promise, 'request reaching the server without headers');
  const result = await within(run, 'before-header deadline settlement');
  assert.equal(http.clients[0].status, undefined); assert.equal(http.clients[0].settled, false, 'JSON body was never entered');
  assert.ok(result.error instanceof AttemptError); assert.equal(result.error.status, 0);
  assert.equal(readFailure(result.error).kind, 'retry'); assert.equal(cleanup.activeRead, null);
});

test('1229 foreground cancellation after client200 remains epoch deferral rather than diagnostic', async t => {
  const http = await transport(t, (request, response) => request.payload?.name === 'background'
    ? stalled(response) : write(response, answer({ foreground: true })));
  const cleanup = reader(http.api, 5000), run = caught(cleanup.read(options => http.api.view('background', {}, options)));
  const body = await http.client('background'); assert.equal(body.status, 200); assert.equal(body.settled, false);
  const epoch = cleanup.readEpoch, foreground = cleanup.foreground();
  try {
    const value = await foreground.read(options => http.api.view('foreground', {}, options));
    assert.equal(value.foreground, true); assert.equal(cleanup.readEpoch, epoch + 1);
    assert.equal((await within(run, 'superseded real body')).error.code, 'CLEANUP_DEFERRED');
  } finally { foreground.release(); }
  assert.equal(body.signal.aborted, true); assert.equal(body.settled, true); assert.equal(cleanup.activeRead, null);
});

test('1229 late abort-ignoring real body occupies the read tail and cannot publish into a newer epoch', async t => {
  let late;
  const http = await transport(t, (request, response) => {
    if (request.payload?.name === 'late') { late = response; return stalled(response); }
    write(response, answer({ foreground: true }));
  }, { ignoreAbort: tag => tag === 'late' });
  const cleanup = reader(http.api, 5000), paints = [];
  const run = caught(cleanup.read(options => http.api.view('late', {}, options)).then(value => paints.push(value)));
  const body = await http.client('late'), active = cleanup.activeRead;
  const queued = caught(cleanup.read(options => http.api.view('must-not-dispatch', {}, options)));
  const foreground = cleanup.foreground();
  try { assert.equal((await foreground.read(options => http.api.view('foreground', {}, options))).foreground, true); }
  finally { foreground.release(); }
  assert.equal(body.signal.aborted, true); assert.equal(body.settled, false); assert.equal(cleanup.activeRead, active);
  assert.equal(http.requests.some(request => request.payload?.name === 'must-not-dispatch'), false);
  late.end('"late":true}');
  const result = await within(run, 'late real body settlement');
  assert.equal(result.error.code, 'CLEANUP_DEFERRED'); assert.equal((await queued).error.code, 'CLEANUP_DEFERRED');
  assert.equal(body.settled, true); assert.equal(cleanup.activeRead, null); assert.deepEqual(paints, []);
  assert.equal(http.requests.some(request => request.payload?.name === 'must-not-dispatch'), false);
});

test('1229 genuine malformed200 without an owned abort still stops Freshness diagnostically', async t => {
  const http = await transport(t, (_request, response) => {
    response.writeHead(200, { 'Content-Type': 'application/json' }); response.end('not JSON');
  });
  const cleanup = reader(http.api, 5000), { f, states, timers } = freshness(t, http.api, cleanup);
  await within(f.request(), 'genuine malformed response');
  const body = await http.client('changes');
  assert.equal(body.signal.aborted, false); assert.equal(body.bodyError.name, 'SyntaxError');
  assert.equal(f.stopped, true); assert.equal(states.at(-1).kind, 'diagnostic'); assert.equal(timers.jobs.size, 0);
});

for (const [code, status, kind] of [['AUTHORITY_CHANGED', 503, 'authority'], ['FORBIDDEN', 503, 'forbidden'],
  ['SESSION_REQUIRED', 401, 'reconnect'], ['INVALID_ARGUMENT', 503, 'diagnostic']]) {
  test(`1229 structured ${code} retains precedence through real transport/Cleanup/Freshness`, async t => {
    const http = await transport(t, (_request, response) => write(response, { error: { code, retryable: false } }, status));
    const cleanup = reader(http.api, 5000), { f, states, timers } = freshness(t, http.api, cleanup);
    await within(f.request(), code + ' pass');
    assert.equal(states.at(-1).kind, kind); assert.equal(states.at(-1).code, code);
    assert.equal(f.stopped, true); assert.equal(timers.jobs.size, 0);
  });
}

for (const mode of ['command', 'upload']) {
  test(`1229 ${mode} unknown body keeps the original operation and does not automatically resend`, async t => {
    const http = await transport(t, (_request, response) => stalled(response));
    const original = { v: 1, instance_id: bootstrap.instance_id, operation_id: 'unchanged-' + mode,
      kind: 'message.post', target: { topic_id: scope.id }, expected: { authority }, args: { body: 'Exact original writing' } };
    const frozen = structuredClone(original), controller = new AbortController(), blob = new Blob(['exact isolated bytes']);
    const run = caught(mode === 'command' ? http.api.command(original, { signal: controller.signal })
      : http.api.upload(original, blob, { signal: controller.signal }));
    const body = await http.client(mode === 'command' ? '/api/command' : '/api/media/upload');
    assert.equal(body.status, 200); assert.equal(body.settled, false);
    original.args.body = 'A newer caller edit'; controller.abort();
    const result = await within(run, mode + ' unknown body settlement');
    assert.ok(result.error instanceof AttemptError); assert.equal(result.error.details, null, 'there is no Core outcome');
    assert.equal(body.settled, true); await tick(); assert.equal(http.requests.length, 1); assert.deepEqual(http.pauses, []);
    assert.deepEqual(mode === 'command' ? http.requests[0].payload : JSON.parse(http.requests[0].command), frozen);
    if (mode === 'upload') assert.deepEqual(http.requests[0].bytes, Buffer.from(await blob.arrayBuffer()));
  });
}

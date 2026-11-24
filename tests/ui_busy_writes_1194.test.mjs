import test from 'node:test';
import assert from 'node:assert/strict';
import { Api, isBusy } from '../web/api.mjs';
import { Editor } from '../web/editor.mjs';
import { EditorSession, RuntimeAuthority } from '../web/session.mjs';
import { RecoveryJournal } from '../web/journal.mjs';
import { healthLines } from '../web/health.mjs';

const busy = { status: 'retryable', recorded: false, error: { code: 'DATABASE_BUSY', retryable: true } };
const envelope = () => ({ v: 1, instance_id: 'busy1194', operation_id: 'post-once', kind: 'message.send',
  target: { topic_id: 'topic' }, expected: { authority: { authority_id: 'scratch', authority_epoch: 'epoch' } },
  args: { submission_id: 'submission', body: 'Original writing' } });
const committed = value => ({ instance_id: value.instance_id, operation_id: value.operation_id, kind: value.kind,
  status: 'committed', recorded: true, result: { submission_id: 'submission', message_id: 'sent' } });
const response = (value, status = 200) => ({ ok: status < 400, status, json: async () => structuredClone(value) });
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
function journal() {
  const rows = new Map();
  return new RecoveryJournal({ put: async row => rows.set(row.id, structuredClone(row)),
    get: async id => structuredClone(rows.get(id)),
    forEditor: async key => [...rows.values()].filter(row => row.editorKey === key).map(row => structuredClone(row)),
    currentCandidates: async (key, ids) => ids.map(id => rows.get(id)).filter(row => row?.editorKey === key).map(row => structuredClone(row)),
    removeExact: async (id, stamp) => { if (rows.get(id)?.stamp === stamp) rows.delete(id); } }, 'scratch-tab');
}

test('a busy public send stays pending in its real editor session, then commits the same operation', async () => {
  const waiting = deferred(), release = deferred(), calls = [], original = envelope();
  const api = new Api('scratch', async (path, options) => {
    calls.push(JSON.parse(options.body));
    return calls.length === 1 ? response(busy, 503) : response(committed(original));
  }, async ms => { assert.equal(ms, 250); waiting.resolve('backoff'); await release.promise; });
  const authority = { ...original.expected.authority, continuity: 'initial' };
  const editor = new Editor({ instanceId: 'busy1194', actor: 'person', sourceRef: { kind: 'message', id: 'source' }, topicId: 'topic', kind: 'reply' },
    { id: 'draft', revision: 0, generation: 'g', body: 'newer private writing' });
  editor.submissions.push({ id: 'submission', sendOperationId: original.operation_id, preparationConfirmed: true, status: 'prepared' });
  const storage = journal(), runtime = new RuntimeAuthority({ api, instanceId: 'busy1194', authority });
  const session = new EditorSession(editor, { api, journal: storage, runtime, authority });
  const entry = session.attempt(original);
  const sending = session.dispatch(entry, { retries: 0 });
  const outcome = sending.then(() => 'settled', () => 'settled');
  try {
    assert.equal(await Promise.race([waiting.promise, outcome]), 'backoff');
    assert.equal(entry.dispatched, true);
    assert.equal(entry.error, null);
    assert.equal(entry.receipt, null);
    assert.equal(editor.submissions[0].status, 'prepared');
    assert.equal((await storage.own(editor.key)).snapshot.attempts[0].error, null);
    assert.equal(calls.length, 1);
  } finally { release.resolve(); }
  assert.equal((await sending).status, 'committed');
  assert.deepEqual(calls, [original, original]);
  assert.equal(editor.submissions[0].status, 'confirmed');
  assert.equal(editor.draft.body, 'newer private writing');
});

test('snapshot survives caller edits while an unrecorded busy receipt waits', async () => {
  const value = envelope(), original = structuredClone(value), calls = [], waits = [];
  const api = new Api('scratch', async (_path, options) => {
    calls.push(options.body); return response(calls.length === 1 ? busy : committed(original));
  }, async ms => { waits.push(ms); value.operation_id = 'replacement'; value.args.body = 'changed'; });
  assert.equal((await api.command(value)).status, 'committed');
  assert.deepEqual(calls, [JSON.stringify(original), JSON.stringify(original)]);
  assert.deepEqual(waits, [250]);
});

test('exhausted busy replies settle after exactly four attempts and three backoffs', async () => {
  let calls = 0; const waits = [];
  const api = new Api('scratch', async () => { calls++; return response(busy); }, async ms => waits.push(ms));
  assert.deepEqual(await api.command(envelope()), busy);
  assert.equal(calls, 4); assert.deepEqual(waits, [250, 750, 1500]);
});

test('exhausted HTTP busy error remains a usable busy failure', async () => {
  let calls = 0;
  const api = new Api('scratch', async () => { calls++; return response(busy, 503); }, async () => {});
  await assert.rejects(api.command(envelope()), isBusy);
  assert.equal(calls, 4);
});

test('recorded, conflict, lost, unreadable and refused-session outcomes do not retry', async () => {
  const cases = [response({ ...busy, recorded: true, status: 'rejected' }),
    response({ recorded: true, status: 'rejected', error: { code: 'REVISION_CONFLICT' } }),
    response({ recorded: false, error: { code: 'SESSION_REFUSED' } }, 401),
    { ok: true, status: 200, json: async () => { throw Error('unreadable'); } }, null];
  for (const answer of cases) {
    let calls = 0;
    const api = new Api('scratch', async () => { calls++; if (!answer) throw Error('lost'); return answer; },
      async () => assert.fail('not definite retry authority'));
    await api.command(envelope()).catch(() => {});
    assert.equal(calls, 1);
  }
});

test('uploads retry the identical command and bytes; reads do not retry', async () => {
  const value = envelope(), original = structuredClone(value), blob = new Blob(['scratch image']), calls = [];
  const api = new Api('scratch', async (_path, options) => {
    calls.push(options); return calls.length === 1 ? response(busy, 503) : response(committed(original));
  }, async () => { value.args.body = 'changed'; });
  assert.equal((await api.upload(value, blob)).status, 'committed');
  assert.deepEqual(calls.map(call => JSON.parse(call.headers['X-AIM-Command'])), [original, original]);
  assert.ok(calls.every(call => call.body === blob));
  let reads = 0;
  const reader = new Api('scratch', async () => { reads++; return response(busy, 503); }, async () => assert.fail());
  await assert.rejects(reader.view('topic'), isBusy); assert.equal(reads, 1);
});

test('cancellation during a busy backoff prevents the next mutation', async () => {
  const controller = new AbortController(), reached = deferred(); let calls = 0;
  const api = new Api('scratch', async () => { calls++; reached.resolve(); return response(busy, 503); });
  const pending = api.command(envelope(), { signal: controller.signal });
  await reached.promise; controller.abort();
  await assert.rejects(pending); assert.equal(calls, 1);
});

test('Health names database-busy replies in the last minute without a new red lamp', () => {
  const now = Date.now(), lines = healthLines({ red: [], runner: { live: true, state: 'running', since_ms: now }, agents: [],
    server: { started_ms: now, live_feed: true, database_busy_last_minute: 7 }, schema_version: 69, read_ms: now }, { now });
  const server = lines.find(line => line.key === 'server');
  assert.match(server.details.join(' '), /7 database-busy replies in the last minute/);
  assert.equal(server.bad, false);
});

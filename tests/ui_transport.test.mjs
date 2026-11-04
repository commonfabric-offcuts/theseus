import test from 'node:test';
import assert from 'node:assert/strict';
import { Api, AttemptError } from '../web/api.mjs';
import { RecoveryJournal } from '../web/journal.mjs';

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

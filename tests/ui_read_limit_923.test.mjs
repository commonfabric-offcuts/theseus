import test from 'node:test';
import assert from 'node:assert/strict';
import { Api } from '../web/api.mjs';

const turn = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };
const held = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const answer = value => ({ ok: true, json: async () => value });

test('923 foreground reads across API instances stop at four until actual answers complete', async () => {
  const sent = [], gates = [], fetcher = (_path, options) => {
    const gate = held(); gates.push(gate); sent.push(JSON.parse(options.body).args.id);
    return gate.promise;
  };
  const first = new Api('fixture', fetcher), second = new Api('fixture', fetcher);
  const jobs = Array.from({ length: 14 }, (_, id) => (id % 2 ? first : second).view('workspace', { id }, { readClass: 'foreground' }));
  await turn();
  const initial = sent.length;
  // Release all real fetches even when the baseline assertion is red.
  for (let i = 0; i < jobs.length; i++) { await turn(); gates[i]?.resolve(answer({ id: sent[i] })); }
  const values = await Promise.all(jobs);
  assert.equal(initial, 4, 'the fifth foreground request waits outside the server lane');
  assert.deepEqual(sent, Array.from({ length: 14 }, (_, id) => id));
  assert.deepEqual(values.map(value => value.id), sent);
});

test('923 commands and background reads keep their lanes while foreground is full', async () => {
  const sent = [], gates = [];
  const api = new Api('fixture', async (path, options) => {
    sent.push([path, options.headers['X-AIM-Read-Class']]);
    if (path === '/api/command' || options.headers['X-AIM-Read-Class'] === 'background') return answer({ ok: true });
    const gate = held(); gates.push(gate); return gate.promise;
  });
  const foreground = Array.from({ length: 10 }, () => api.view('workspace'));
  await turn();
  await Promise.all([api.command({ kind: 'fixture' }), api.view('colors', {}, { readClass: 'background' })]);
  const before = sent.slice();
  for (let i = 0; i < 10; i++) { await turn(); gates[i]?.resolve(answer({})); }
  await Promise.all(foreground);
  assert.equal(before.filter(([path, lane]) => path === '/api/view' && lane !== 'background').length, 4);
  assert.equal(before.some(([path]) => path === '/api/command'), true);
  assert.equal(before.some(([, lane]) => lane === 'background'), true);
});

test('923 a queued cancellation is unsent and a refused answer releases capacity', async () => {
  const gates = [], ids = [];
  const api = new Api('fixture', (_path, options) => {
    const id = JSON.parse(options.body).args.id, gate = held(); ids.push(id); gates.push(gate); return gate.promise;
  });
  const first = Array.from({ length: 4 }, (_, id) => api.view('workspace', { id }).catch(error => error));
  await turn();
  const cancelled = new AbortController();
  const fifth = api.view('workspace', { id: 'cancelled' }, { signal: cancelled.signal }).catch(error => error);
  await turn(); cancelled.abort();
  const sixth = api.view('workspace', { id: 'next' });
  await turn();
  gates[0].resolve({ ok: false, status: 503, json: async () => ({ error: { code: 'SERVER_BUSY', message: 'Busy' } }) });
  await turn();
  assert.deepEqual(ids, [0, 1, 2, 3, 'next']);
  for (let index = 1; index < gates.length; index++) gates[index].resolve(answer({}));
  const settled = await Promise.all([...first, fifth, sixth]);
  assert.equal(settled[0].details.error.code, 'SERVER_BUSY');
  assert.equal(settled[4].name, 'AbortError');
});

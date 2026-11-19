import test from 'node:test';
import assert from 'node:assert/strict';
import { staticResponseCache } from './static_response_cache.mjs';

const response = (status, text) => ({ status: () => status, body: async () => Buffer.from(text), headers: () => ({ 'content-type': 'text/javascript' }) });

test('static cache bounds cold fetch concurrency and coalesces the same original bytes', async () => {
  const cache = staticResponseCache();
  let release, entered, active = 0, peak = 0, calls = 0;
  const held = new Promise(resolve => { release = resolve; });
  const started = new Promise(resolve => { entered = resolve; });
  const fetch = async () => {
    calls++; active++; peak = Math.max(peak, active); entered();
    await held; active--; return response(200, 'original module');
  };
  const first = cache.response('/first.mjs', fetch);
  const duplicate = cache.response('/first.mjs', fetch);
  const second = cache.response('/second.mjs', fetch);
  await started; release();
  const [a, b, c] = await Promise.all([first, duplicate, second]);
  assert.equal(peak, 1, 'cold static requests enter the bounded fixture serially');
  assert.equal(calls, 2, 'duplicate cold URL fetches once');
  assert.equal(a, b, 'the same successful original response is reused');
  assert.equal(a.hits, 2);
  assert.equal(c.body.toString(), 'original module');
});

test('static cache passes through refused bytes without storing or laundering them', async () => {
  const cache = staticResponseCache();
  const refused = await cache.response('/module.mjs', async () => response(503, 'busy original response'));
  assert.equal(refused.status, 503);
  assert.equal(refused.body.toString(), 'busy original response');
  assert.equal(cache.entries.size, 0);
  const original = await cache.response('/module.mjs', async () => response(200, 'original module'));
  assert.equal(original.status, 200);
  assert.equal(original.body.toString(), 'original module');
});

test('a failed static fetch releases its queue without hiding the error', async () => {
  const cache = staticResponseCache();
  await assert.rejects(cache.response('/bad.mjs', async () => { throw Error('fetch failed'); }), /fetch failed/);
  assert.equal((await cache.response('/good.mjs', async () => response(200, 'good'))).body.toString(), 'good');
});

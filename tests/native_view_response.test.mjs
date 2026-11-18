import test from 'node:test';
import assert from 'node:assert/strict';
import { readNativeViewResponse } from './native-view-response.mjs';

const reply = (status, body) => ({ status, ok: status >= 200 && status < 300,
  text: async () => body, json: async () => JSON.parse(body) });
for (const [label, status, body, reason] of [
  ['refused', 403, '{"recorded":false,"error":{"code":"FORBIDDEN","message":"No access"}}', 'HTTP'],
  ['failed', 503, '{"error":{"code":"SERVER_BUSY","retryable":true}}', 'HTTP'],
  ['malformed', 200, '<html>not JSON</html>', 'JSON'],
  ['wrong envelope', 200, '{"error":{"code":"REFUSED"}}', 'error'],
  ['missing items', 200, '{"topic_id":"isolated"}', 'items'],
  ['non-array items', 200, '{"items":{}}', 'items'],
  ['non-object', 200, 'null', 'object'],
]) test(`view boundary retains ${label} response before callers dereference items`, async () => {
  const observations = [];
  await assert.rejects(async () => {
    const found = await readNativeViewResponse(reply(status, body), 'message_acts', observations);
    found.items.find(() => false);
  }, error => {
    assert.equal(error.name, 'AssertionError');
    assert.match(error.message, new RegExp(reason, 'i'));
    assert.equal(error.evidence.status, status);
    assert.equal(error.evidence.body, body);
    assert.deepEqual(observations, [error.evidence]);
    assert.ok(error.message.includes(body));
    return true;
  });
});
test('valid empty and populated pages pass through exactly', async () => {
  for (const value of [{ items: [], cursor: null }, { items: [{ message_id: 'isolated', acts: { placed: 2 } }] }]) {
    const observations = [];
    assert.deepEqual(await readNativeViewResponse(reply(200, JSON.stringify(value)), 'message_acts', observations), value);
    assert.deepEqual(observations, []);
  }
  assert.deepEqual(await readNativeViewResponse(reply(200, '{"topic_id":"isolated"}'), 'conversation', []), { topic_id: 'isolated' });
});
test('failure evidence bounds body and redacts credentials before retention', async () => {
  const observations = [], secret = 'synthetic-credential-value';
  const body = JSON.stringify({ error: { message: 'Bearer ' + secret }, token: secret, detail: 'x'.repeat(6000) });
  await assert.rejects(readNativeViewResponse(reply(403, body), 'message_acts', observations, [secret]), error => {
    assert.equal(error.evidence.truncated, true);
    assert.equal(error.evidence.bodyLimit, 2048);
    assert.ok(error.evidence.body.length <= 2048);
    assert.ok(!JSON.stringify(error.evidence).includes(secret));
    assert.ok(!error.message.includes(secret));
    assert.ok(error.evidence.body.includes('[redacted]'));
    return true;
  });
});
test('body read failure retains observed HTTP status without inventing a body', async () => {
  const observations = [];
  await assert.rejects(readNativeViewResponse({ status: 502, ok: false, text: async () => { throw Error('stream ended'); } }, 'message_acts', observations), error => {
    assert.equal(error.evidence.status, 502);
    assert.equal(error.evidence.body, null);
    assert.equal(error.evidence.readError, 'stream ended');
    return true;
  });
});
test('HTTP failure with a success-shaped body is still refused', async () => {
  const observations = [], body = '{"items":[]}';
  await assert.rejects(readNativeViewResponse(reply(503, body), 'message_acts', observations), error => {
    assert.equal(error.evidence.status, 503);
    assert.equal(error.evidence.body, body);
    return true;
  });
});

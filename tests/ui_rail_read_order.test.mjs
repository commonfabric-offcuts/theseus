import assert from 'node:assert/strict';
import { test } from 'node:test';
import { RailReadOrder } from '../web/rail-read-order.mjs';

const pending = () => {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
};
const turn = () => new Promise(resolve => setImmediate(resolve));

test('visible sections run before the recorded-action and dimming requests from the same commit', async () => {
  const order = new RailReadOrder(), calls = [];
  const later = order.defer(() => calls.push('recorded action'));
  const dim = order.defer(() => calls.push('dimming'));
  const rail = order.whileVisible(() => { calls.push('Notebook', 'Links'); });
  await Promise.all([later, dim, rail]);
  assert.deepEqual(calls, ['Notebook', 'Links', 'recorded action', 'dimming']);
});

test('visible pagination gaps retain priority while a pass is open', async () => {
  const order = new RailReadOrder(), calls = [], next = pending();
  const rail = order.whileVisible(async () => {
    calls.push('Links page 1');
    await next.promise;
    calls.push('Links page 2');
  });
  const secondary = order.defer(() => calls.push('dimming'));
  await turn();
  assert.deepEqual(calls, ['Links page 1']);
  next.resolve();
  await Promise.all([rail, secondary]);
  assert.deepEqual(calls, ['Links page 1', 'Links page 2', 'dimming']);
});

test('the rail starts with a secondary in flight and a refused rail pass releases queued work', async () => {
  const order = new RailReadOrder(), calls = [], first = pending(), visible = pending();
  const deferred = order.defer(async () => { calls.push('recorded action'); await first.promise; });
  await turn();
  const second = order.defer(() => calls.push('dimming'));
  const rail = order.whileVisible(async () => { calls.push('Pipeline'); await visible.promise; throw Error('unavailable'); });
  const refused = assert.rejects(rail, /unavailable/);
  await turn();
  assert.deepEqual(calls, ['recorded action', 'Pipeline']);
  first.resolve();
  await deferred;
  await turn();
  assert.deepEqual(calls, ['recorded action', 'Pipeline']);
  visible.resolve();
  await Promise.all([deferred, second, refused]);
  assert.deepEqual(calls, ['recorded action', 'Pipeline', 'dimming']);
});

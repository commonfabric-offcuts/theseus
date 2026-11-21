// Browser-free controls for the owned native interception lifecycle.
import test from 'node:test';
import assert from 'node:assert/strict';
import { commandRoutes704, undecidedWhisper704 } from './whisper_outline_native.mjs';

const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
for (const state of ['saving', 'refused', 'exception']) test(`704 ${state}: release and await every continuation and response before unroute`, async () => {
  const events = [], continued = deferred(), response = deferred(), finished = deferred();
  let handler;
  const page = { route: async (_, h) => { handler = h; }, unroute: async (_, h) => { assert.equal(h, handler); events.push('unroute'); } };
  const routes = commandRoutes704(page), gate = routes.hold();
  await routes.route(async route => { await gate.wait; await route.continue(); });
  const request = { response: async () => { events.push('response'); await response.promise; return { finished: async () => { await finished.promise; events.push('finished'); return null; } }; } };
  const work = handler({ request: () => request, continue: async () => { events.push('continue'); await continued.promise; if (state === 'exception') throw Error('actual continuation failure'); } });
  const done = routes.finish();
  // Install the rejection observer before making the continuation fail.
  const observed = done.then(() => null, error => error);
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(events, ['continue']);
  continued.resolve();
  await new Promise(resolve => setImmediate(resolve));
  {
    assert.deepEqual(events, ['continue', 'response']);
    response.resolve();
    await new Promise(resolve => setImmediate(resolve));
    assert.ok(!events.includes('unroute'), 'the response body is still unfinished');
    finished.resolve();
  }
  await work;
  const error = await observed;
  assert.deepEqual(events, ['continue', 'response', 'finished', 'unroute']);
  if (state === 'exception') {
    assert.ok(error instanceof AggregateError);
    assert.match(error.errors[0].message, /actual continuation failure/);
  } else assert.equal(error, null);
});

test('704 undecided contract accepts absent/null and rejects an explicit public choice or a second recipient', () => {
  for (const whisper of [undefined, null]) undecidedWhisper704({ whisper, addressees: ['fixture-agent'] }, 'fixture-agent');
  assert.throws(() => undecidedWhisper704({ whisper: false, addressees: ['fixture-agent'] }, 'fixture-agent'), /no explicit privacy choice/);
  assert.throws(() => undecidedWhisper704({ addressees: ['fixture-agent', 'other'] }, 'fixture-agent'), /reply-to-whisper default/);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fixtureControl } from './fixture_control.mjs';

// The channel against a real child that speaks the fixture's protocol: it answers `answers` requests, doubling each
// one's n, then reads one more without answering, and exits.
const child = answers => spawn('/usr/bin/python3', ['-I', '-c', `
import json, sys
for _ in range(${answers}):
    request = json.loads(sys.stdin.readline())
    print(json.dumps({"id": request["id"], "answer": request["n"] * 2}), flush=True)
sys.stdin.readline()
`]);
// How a promise has already settled, without waiting on it: a refusal is settled the moment it is made, and race
// takes an already-settled promise before the PENDING placed after it.
const PENDING = Symbol('pending');
const settled = promise => Promise.race([promise, Promise.resolve(PENDING)]).then(answer => ({ answer }), error => ({ error }));

test('a live fixture answers each request', async () => {
  const fixture = child(2), { control, exit } = fixtureControl(fixture);
  assert.equal(await control({ n: 1 }), 2);
  assert.equal(await control({ n: 4 }), 8);
  fixture.stdin.end();
  assert.deepEqual(await exit, { code: 0, signal: null });
});

test('a request open when the fixture exits is refused with how it ended', async () => {
  const fixture = child(0), { control, exit } = fixtureControl(fixture);
  const open = control({ n: 1 });
  await assert.rejects(open, /^Error: Fixture exited 0: $/);
  assert.deepEqual(await exit, { code: 0, signal: null });
});

test('a request after the fixture died is refused at once, not left waiting', async () => {
  const fixture = child(1), { control, exit } = fixtureControl(fixture);
  assert.equal(await control({ n: 3 }), 6);
  fixture.kill('SIGTERM');
  assert.deepEqual(await exit, { code: null, signal: 'SIGTERM' });
  const outcome = await settled(control({ n: 5 }));
  assert.notEqual(outcome.answer, PENDING, 'a request to a dead fixture is never answered, so it must be refused');
  assert.match(outcome.error.message, /^Fixture exited SIGTERM: /);
});

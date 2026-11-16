import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, open, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import * as calls from './native-calls.mjs';

// The native harness's calls (tests/native-calls.mjs), driven with a stand-in
// browser that answers only what a test tells it to, and a stand-in clock
// whose bounds fire only when a test fires them. The navigation step's harness
// case does the same on a real page that stops answering.

function standInClock() {
  const armed = new Map();
  let next = 0;
  return {
    armed,
    set: (fire, ms) => { const timer = ++next; armed.set(timer, { fire, ms }); return timer; },
    clear: timer => { armed.delete(timer); },
    fire: timer => { const bound = armed.get(timer); armed.delete(timer); bound.fire(); },
  };
}

function standInBrowser() {
  const sent = [];
  let up = true;
  return { sent, send: text => sent.push(JSON.parse(text)), open: () => up, goes: () => { up = false; } };
}

const pages = { S1: 'creation-departure' };
function connect() {
  const clock = standInClock(), browser = standInBrowser();
  const connection = calls.protocol({ send: browser.send, open: browser.open, pageOf: session => pages[session] ?? null, timers: clock });
  return { clock, browser, connection };
}

// What a promise has done so far, read without waiting on it: a call that
// never settles leaves the test's assertions to fail, never the test to hang.
function watch(promise) {
  const seen = { state: 'pending' };
  promise.then(value => Object.assign(seen, { state: 'resolved', value }), error => Object.assign(seen, { state: 'rejected', error }));
  return seen;
}
const settle = () => new Promise(resolve => setImmediate(resolve));

test('every browser command goes with a bound, a screenshot with its own, longer one', () => {
  const { clock, browser, connection } = connect();
  const methods = ['Target.createTarget', 'Runtime.evaluate', 'Input.dispatchMouseEvent', 'Fetch.failRequest', 'Fetch.continueResponse', 'Target.closeTarget', 'Page.captureScreenshot'];
  for (const method of methods) connection.call(method, {}, 'S1').catch(() => {});
  assert.deepEqual(browser.sent.map(packet => packet.method), methods);
  const bounds = [...clock.armed.values()].map(bound => bound.ms);
  assert.equal(bounds.length, methods.length, 'every command, the screenshot too, has its bound armed');
  assert.deepEqual(bounds.slice(0, -1), Array(methods.length - 1).fill(calls.CALL_BOUND_MS));
  assert.equal(bounds.at(-1), calls.FRAME_BOUND_MS, 'a screenshot waits for its frame, up to its own bound');
  assert.ok(Number.isFinite(calls.FRAME_BOUND_MS) && calls.FRAME_BOUND_MS >= 30000 && calls.FRAME_BOUND_MS > calls.CALL_BOUND_MS,
    'well above a GPU stall a screenshot outlives on a busy runner');
});

test('a page that stops answering a screenshot fails that call at its bound, naming the call and the page', async () => {
  const { clock, connection } = connect();
  const shot = watch(connection.call('Page.captureScreenshot', { format: 'png' }, 'S1'));
  await settle();
  assert.equal(shot.state, 'pending', 'nothing fails before the bound');
  const [timer] = clock.armed.keys();
  assert.notEqual(timer, undefined, 'a bound is armed for the screenshot');
  clock.fire(timer);
  await settle();
  assert.equal(shot.state, 'rejected');
  assert.equal(shot.error.message, 'CDP timed out: Page.captureScreenshot on page creation-departure, no answer in 60 s');
});

test('a held answer fails only its own call; its late answer is dropped and the next call is answered', async () => {
  const { clock, browser, connection } = connect();
  const answered = watch(connection.call('Runtime.evaluate', { expression: '1' }, 'S1'));
  const held = watch(connection.call('Runtime.evaluate', { expression: '2' }, 'S1'));
  connection.answer({ id: browser.sent[0].id, result: { result: { value: 1 } } });
  await settle();
  assert.deepEqual([answered.state, held.state], ['resolved', 'pending']);
  assert.equal(clock.armed.size, 1, "an answered call's bound is cleared");
  clock.fire([...clock.armed.keys()][0]);
  await settle();
  assert.equal(held.state, 'rejected');
  assert.equal(held.error.message, 'CDP timed out: Runtime.evaluate on page creation-departure, no answer in 10 s');
  connection.answer({ id: browser.sent[1].id, result: { result: { value: 2 } } });
  await settle();
  assert.equal(held.state, 'rejected', 'an answer after the bound changes nothing');
  const close = watch(connection.call('Target.closeTarget', { targetId: 'T1' }));
  connection.answer({ id: browser.sent[2].id, result: { success: true } });
  await settle();
  assert.deepEqual([close.state, clock.armed.size], ['resolved', 0], 'the harness goes on: the next call is sent and answered');
});

test('a browser command on no page names none when it gets no answer', async () => {
  const { clock, connection } = connect();
  const dispose = watch(connection.call('Target.disposeBrowserContext', { browserContextId: 'B1' }));
  clock.fire([...clock.armed.keys()][0]);
  await settle();
  assert.equal(dispose.error?.message, 'CDP timed out: Target.disposeBrowserContext, no answer in 10 s');
});

test('the browser going away rejects every unanswered call by name and refuses a new one at once', async () => {
  const { clock, browser, connection } = connect();
  const shot = watch(connection.call('Page.captureScreenshot', {}, 'S1'));
  const evaluate = watch(connection.call('Runtime.evaluate', {}, 'S1'));
  browser.goes();
  connection.closed();
  const after = watch(connection.call('Runtime.evaluate', {}, 'S1'));
  await settle();
  assert.deepEqual([shot, evaluate, after].map(seen => seen.error?.message),
    ['CDP connection closed: Page.captureScreenshot', 'CDP connection closed: Runtime.evaluate', 'CDP connection closed: Runtime.evaluate']);
  assert.equal(clock.armed.size, 0, 'no bound is left armed');
  assert.equal(browser.sent.length, 2, 'nothing is sent on a closed connection');
});

test('a fixture control or view that never answers fails at its bound, naming it; one that answers clears its bound', async () => {
  const clock = standInClock();
  let given = 0;
  const never = watch(calls.bounded(new Promise(() => {}), 'fixture control mark', { timers: clock, onTimeout: () => { given++; } }));
  const [timer] = clock.armed.keys();
  assert.notEqual(timer, undefined, 'a bound is armed for the fixture call');
  assert.equal(clock.armed.get(timer).ms, calls.FIXTURE_BOUND_MS);
  assert.ok(Number.isFinite(calls.FIXTURE_BOUND_MS) && calls.FIXTURE_BOUND_MS > 15000, 'above the longest hold the fixture keeps');
  await settle();
  assert.equal(never.state, 'pending', 'nothing fails before the bound');
  clock.fire(timer);
  await settle();
  assert.equal(never.state, 'rejected');
  assert.equal(never.error.message, 'Timed out: fixture control mark, no answer in 60 s');
  assert.equal(given, 1, 'the caller is told, once, so it can drop the late answer');
  const answered = watch(calls.bounded(Promise.resolve(7), 'view operation', { timers: clock, onTimeout: () => { given++; } }));
  await settle();
  assert.deepEqual([answered.state, answered.value, clock.armed.size, given], ['resolved', 7, 0, 1]);
});

test('each case writes a line when it starts, and one with its result and both times once its cleanup is done', () => {
  const lines = [];
  let now = Date.parse('2026-11-15T05:57:00.000Z');
  const stamp = calls.stamps({ write: line => lines.push(line), now: () => new Date(now) });
  const name = 'navigation creation actual pending departure unknown return and a read-only tab a commit reaches';
  const started = stamp.started(name);
  assert.deepEqual(lines.map(line => JSON.parse(line)), [{ case: name, started: '2026-11-15T05:57:00.000Z' }], 'the start is on the record before the case runs');
  now += 4200;
  stamp.finished({ name, passed: true }, started);
  assert.deepEqual(JSON.parse(lines[1]), { name, passed: true, started: '2026-11-15T05:57:00.000Z', finished: '2026-11-15T05:57:04.200Z' });
  assert.ok(lines.every(line => line.endsWith('\n') && !line.slice(0, -1).includes('\n')), 'one line each');
});

test('a run cancelled mid-case leaves that case started on the record, with no result', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'native-calls-'));
  try {
    const log = path.join(dir, 'step.log'), out = await open(log, 'w');
    // A step's log is a file (tools/release_check.py run_step); the case is
    // killed as a cancelled job is, with no chance to write anything more.
    const child = spawn(process.execPath, ['--input-type=module', '-e', `
      import { stamps } from ${JSON.stringify(new URL('./native-calls.mjs', import.meta.url).href)};
      const stamp = stamps();
      stamp.finished({ name: 'the case before', passed: true }, stamp.started('the case before'));
      stamp.started('the case that never ends');
      process.send('running');
      setInterval(() => {}, 1 << 30);`], { stdio: ['ignore', out.fd, 'inherit', 'ipc'] });
    await out.close();
    const exited = new Promise(resolve => child.once('exit', (code, signal) => resolve(signal)));
    await new Promise(resolve => child.once('message', resolve));
    child.kill('SIGKILL');
    assert.equal(await exited, 'SIGKILL');
    const lines = (await readFile(log, 'utf8')).trim().split('\n').map(line => JSON.parse(line));
    assert.deepEqual(lines.map(line => [line.case ?? line.name, line.started ? 'started' : null, 'passed' in line ? 'result' : null]),
      [['the case before', 'started', null], ['the case before', 'started', 'result'], ['the case that never ends', 'started', null]]);
    assert.ok(lines.every(line => !Number.isNaN(Date.parse(line.started))), 'each start says when');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('a wait outside the browser takes the bound in force when it is made; lowering it for one call leaves the rest at their minute', async () => {
  const clock = standInClock();
  const before = watch(calls.bounded(new Promise(() => {}), 'view before', { timers: clock }));
  calls.fixtureBound.ms = 3000;
  const lowered = watch(calls.bounded(new Promise(() => {}), 'fixture control unanswered', { timers: clock }));
  calls.fixtureBound.ms = calls.FIXTURE_BOUND_MS;
  const after = watch(calls.bounded(new Promise(() => {}), 'view after', { timers: clock }));
  assert.deepEqual([...clock.armed.values()].map(bound => bound.ms), [calls.FIXTURE_BOUND_MS, 3000, calls.FIXTURE_BOUND_MS]);
  clock.fire([...clock.armed.keys()][1]);
  await settle();
  assert.deepEqual([before.state, lowered.state, after.state], ['pending', 'rejected', 'pending']);
  assert.equal(lowered.error.message, 'Timed out: fixture control unanswered, no answer in 3 s');
});

test("what each case wrote is kept in order, the same lines the log has, so a running case finds its own start line last", () => {
  const lines = [];
  const stamp = calls.stamps({ write: line => lines.push(line), now: () => new Date(0) });
  stamp.finished({ name: 'before', passed: true }, stamp.started('before'));
  stamp.started('running');
  assert.deepEqual(stamp.written, lines);
  assert.deepEqual(JSON.parse(stamp.written.at(-1)), { case: 'running', started: '1970-01-01T00:00:00.000Z' });
});

test('a page or context that will not close fails its case by name, unless the case arranged that refusal', () => {
  const ghost = 'closing page ghost-page: {"code":-32602,"message":"No target with given id found"}';
  const context = "disposing the case's browser context: {\"code\":-32602,\"message\":\"Failed to find context with id ghost\"}";
  const passed = { name: 'c', passed: true };
  assert.equal(calls.cleanupVerdict(passed, []), passed, 'a cleanup that closes everything changes nothing');
  assert.deepEqual(calls.cleanupVerdict(passed, [ghost, context]),
    { name: 'c', passed: false, instrumentError: `cleanup: ${ghost}; ${context}` }, 'a refusal no one arranged fails the case, naming it');
  assert.deepEqual(calls.cleanupVerdict({ name: 'c', passed: false, instrumentError: 'trace' }, [ghost]),
    { name: 'c', passed: false, instrumentError: `trace\ncleanup: ${ghost}` }, 'beside what already failed it');
  assert.deepEqual(calls.cleanupVerdict(passed, [ghost, context], [/^closing page ghost-page: /, /^disposing the case's browser context: /]),
    { name: 'c', passed: true, cleanupRefused: [ghost, context] }, 'refusals the case arranged are kept on its record');
  assert.deepEqual(calls.cleanupVerdict(passed, [ghost, context], [/^closing page ghost-page: /]),
    { name: 'c', passed: false, instrumentError: `cleanup: ${context}` }, 'one it did not arrange still fails it');
  assert.deepEqual(calls.cleanupVerdict(passed, [], [/^closing page ghost-page: /]),
    { name: 'c', passed: false, instrumentError: 'cleanup: no refusal matching /^closing page ghost-page: / came' }, 'an arranged refusal that never came fails it');
});

function standInEnd({ chromeExits = true, fixtureExits = true, closes = true } = {}) {
  const done = [];
  let fixtureRunning = true, exitChrome, exitFixture;
  const browser = {
    close: async () => { done.push('Browser.close'); if (!closes) throw Error('CDP timed out: Browser.close, no answer in 10 s'); if (chromeExits) exitChrome(0); },
    exit: new Promise(resolve => { exitChrome = resolve; }),
    disconnect: () => done.push('disconnect'),
  };
  const fixture = {
    health: async () => { done.push('health'); return { fatal: [] }; },
    end: () => { done.push('end'); if (fixtureExits) { fixtureRunning = false; exitFixture(0); } },
    exit: new Promise(resolve => { exitFixture = resolve; }),
    running: () => fixtureRunning,
    stop: () => done.push('stop'),
  };
  return { done, browser, fixture };
}

test('the end of a run closes the browser and the fixture and waits for both to exit, stopping nothing that exited', async () => {
  const clock = standInClock(), { done, browser, fixture } = standInEnd();
  const end = watch(calls.closeAll({ browser, fixture, timers: clock }));
  await settle(); await settle();
  assert.equal(end.state, 'resolved');
  assert.deepEqual(end.value, { failed: [], health: { fatal: [] }, exitCode: 0 });
  assert.deepEqual(done, ['Browser.close', 'disconnect', 'health', 'end']);
  assert.equal(clock.armed.size, 0, 'no bound is left armed');
});

test("a Chrome that does not exit after Browser.close is named at its bound, and the fixture is still closed", async () => {
  const clock = standInClock(), { done, browser, fixture } = standInEnd({ chromeExits: false });
  const end = watch(calls.closeAll({ browser, fixture, timers: clock }));
  await settle();
  assert.equal(end.state, 'pending', 'nothing fails before the bound');
  assert.equal(clock.armed.size, 1, "Chrome's exit has its bound armed");
  const [[timer, bound]] = clock.armed;
  assert.equal(bound.ms, calls.FIXTURE_BOUND_MS, "Chrome's exit has its bound");
  clock.fire(timer);
  await settle(); await settle();
  assert.equal(end.state, 'resolved');
  assert.deepEqual(end.value.failed, ['Chrome exiting: Timed out: Chrome exiting after Browser.close, no answer in 60 s']);
  assert.deepEqual(done, ['Browser.close', 'disconnect', 'health', 'end'], 'the rest of the teardown still runs');
});

test('a fixture that does not exit once its input ends is named at its bound and stopped by its handle', async () => {
  const clock = standInClock(), { done, browser, fixture } = standInEnd({ fixtureExits: false, closes: false });
  const end = watch(calls.closeAll({ browser, fixture, timers: clock }));
  await settle();
  assert.equal(clock.armed.size, 1, "Chrome's exit has its bound armed");
  const [[timer]] = clock.armed;
  clock.fire(timer);
  await settle();
  assert.equal(end.state, 'pending');
  assert.equal(clock.armed.size, 1, "the fixture's exit has its bound armed");
  const [[fixtureTimer, bound]] = clock.armed;
  assert.equal(bound.ms, calls.FIXTURE_BOUND_MS, "the fixture's exit has its bound");
  clock.fire(fixtureTimer);
  await settle(); await settle();
  assert.equal(end.state, 'resolved');
  assert.deepEqual(end.value.failed, ['Browser.close: CDP timed out: Browser.close, no answer in 10 s',
    'Chrome exiting: Timed out: Chrome exiting after Browser.close, no answer in 60 s',
    'the fixture exiting: Timed out: the fixture exiting once its input ended, no answer in 60 s']);
  assert.equal(end.value.exitCode, undefined, 'its exit stays unknown');
  assert.deepEqual(done, ['Browser.close', 'disconnect', 'health', 'end', 'stop']);
});

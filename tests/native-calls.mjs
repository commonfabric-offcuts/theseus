// The native harness's calls to the browser and to its fixture, and the lines
// it writes for each case (tests/reader_persistence_native.mjs).
//
// Every call has a bound, set here and nowhere else, so a page, a browser or
// a fixture that stops answering fails the case it is in, naming the call and
// its method, and the step goes on to its next case and still writes its
// native.json. A bound is never a retry: the call is not sent again, and an
// answer that comes after its bound is dropped.
import { writeSync } from 'node:fs';

// Every browser command but a screenshot: far above any ordinary answer,
// which comes in milliseconds.
export const CALL_BOUND_MS = 10000;
// A screenshot is answered once the browser has drawn the page's next frame,
// which waits on the GPU process. On a busy hosted runner that has stalled
// for longer than ten seconds and the frame still came (12 s reproduces it),
// so a screenshot has its own bound, six times the others. A frame that never
// comes, from a page that stopped answering, fails the case at this bound
// instead of holding the step until the job's own limit cancels everything.
export const FRAME_BOUND_MS = 60000;
// The fixture's controls, the views read from its server and its exit answer
// in milliseconds; the longest hold the fixture keeps is 15 s
// (tests/fixtures/ui_http.py).
export const FIXTURE_BOUND_MS = 60000;
// The bound a wait outside the browser gets when it is made: FIXTURE_BOUND_MS,
// which a harness case lowers around one call of its own, and puts back at
// once, to see that call fail at its bound in seconds rather than a minute.
export const fixtureBound = { ms: FIXTURE_BOUND_MS };

const clock = { set: (fire, ms) => setTimeout(fire, ms), clear: timer => clearTimeout(timer) };
const seconds = ms => `${ms / 1000} s`;
export const boundFor = method => method === 'Page.captureScreenshot' ? FRAME_BOUND_MS : CALL_BOUND_MS;

// The connection to the browser: call() sends one command and settles when its
// answer comes, or fails at its bound naming the method and the page it was
// sent to (pageOf names a page by its session); answer() takes each packet
// that answers a command; closed() rejects whatever is unanswered when the
// browser goes away.
export function protocol({ send, open, pageOf = () => null, timers = clock }) {
  let serial = 0;
  const waiting = new Map();
  const call = (method, params = {}, sessionId) => new Promise((resolve, reject) => {
    if (!open()) { reject(Error(`CDP connection closed: ${method}`)); return; }
    const id = ++serial, bound = boundFor(method);
    const page = sessionId ? pageOf(sessionId) : null;
    const where = page ? ` on page ${page}` : sessionId ? ` on session ${sessionId}` : '';
    const timer = timers.set(() => { waiting.delete(id); reject(Error(`CDP timed out: ${method}${where}, no answer in ${seconds(bound)}`)); }, bound);
    waiting.set(id, { resolve, reject, timer, method });
    send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
  });
  const answer = packet => {
    const waiter = waiting.get(packet.id); waiting.delete(packet.id);
    if (!waiter) return;
    timers.clear(waiter.timer);
    if (packet.error) waiter.reject(Object.assign(Error(JSON.stringify(packet.error)), { cdp: packet.error })); else waiter.resolve(packet.result);
  };
  const closed = () => {
    for (const [id, waiter] of waiting) { waiting.delete(id); timers.clear(waiter.timer); waiter.reject(Error(`CDP connection closed: ${waiter.method}`)); }
  };
  return { call, answer, closed };
}

// A wait on anything else outside the harness (a fixture control, a view read
// over HTTP, a process's exit): it fails at its bound, naming `what`, and
// onTimeout lets the caller drop an answer that comes later.
export function bounded(promise, what, { ms = fixtureBound.ms, timers = clock, onTimeout = () => {} } = {}) {
  let timer;
  const limit = new Promise((_, reject) => {
    timer = timers.set(() => { onTimeout(); reject(Error(`Timed out: ${what}, no answer in ${seconds(ms)}`)); }, ms);
  });
  return Promise.race([promise, limit]).finally(() => timers.clear(timer));
}

// Each case's two lines: one when it starts, written at once (a synchronous
// write, so a run cancelled mid-case still shows which case was running and
// since when), and one with its result and both times once its cleanup is done.
// written holds every line in the order it went out, so a case can see its own
// start line already there while it runs; the release check reads the step's
// log for both lines of every case (tools/release_check.py case_lines).
export function stamps({ write = line => writeSync(1, line), now = () => new Date() } = {}) {
  const written = [];
  const out = line => { write(line); written.push(line); };
  return {
    written,
    started: name => { const started = now().toISOString(); out(JSON.stringify({ case: name, started }) + '\n'); return started; },
    finished: (result, started) => out(JSON.stringify({ ...result, started, finished: now().toISOString() }) + '\n'),
  };
}

// A case's result once its cleanup has run. unclosed names each page or
// context that would not close; expected lists the refusals a case arranged
// on purpose (a pattern each). A refusal no one expected, or an expected one
// that never came, fails the case by name; refusals that were all expected
// are kept on its record as cleanupRefused, and it keeps its result.
export function cleanupVerdict(result, unclosed, expected = []) {
  const unexpected = unclosed.filter(line => !expected.some(pattern => pattern.test(line)));
  const missing = expected.filter(pattern => !unclosed.some(line => pattern.test(line)));
  if (!unexpected.length && !missing.length) return unclosed.length ? { ...result, cleanupRefused: unclosed } : result;
  const said = [...(unexpected.length ? [`cleanup: ${unexpected.join('; ')}`] : []),
    ...missing.map(pattern => `cleanup: no refusal matching ${pattern} came`)];
  return { ...result, passed: false, instrumentError: [result.instrumentError, ...said].filter(Boolean).join('\n') };
}

// The end of a run, each step bounded and each run whatever the step before it
// did: the browser closed and Chrome's exit awaited; the fixture's last health
// read; its input ended and its exit awaited, and a fixture that has not
// exited stopped by its handle. A step that fails is named in failed.
// browser: { close, exit, disconnect } or null when it is already gone;
// fixture: { health (or null), end, exit, running, stop }.
export async function closeAll({ browser, fixture, timers = clock }) {
  const failed = [];
  const step = async (what, act) => { try { return await act(); } catch (error) { failed.push(`${what}: ${error.message}`); } };
  if (browser) {
    await step('Browser.close', browser.close);
    await step('Chrome exiting', () => bounded(browser.exit, 'Chrome exiting after Browser.close', { timers }));
    browser.disconnect();
  }
  const health = fixture.health ? await step('final fixture health', fixture.health) : undefined;
  fixture.end();
  const exitCode = await step('the fixture exiting', () => bounded(fixture.exit, 'the fixture exiting once its input ended', { timers }));
  if (fixture.running()) fixture.stop();
  return { failed, health, exitCode };
}

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
export function bounded(promise, what, { ms = FIXTURE_BOUND_MS, timers = clock, onTimeout = () => {} } = {}) {
  let timer;
  const limit = new Promise((_, reject) => {
    timer = timers.set(() => { onTimeout(); reject(Error(`Timed out: ${what}, no answer in ${seconds(ms)}`)); }, ms);
  });
  return Promise.race([promise, limit]).finally(() => timers.clear(timer));
}

// Each case's two lines: one when it starts, written at once (a synchronous
// write, so a run cancelled mid-case still shows which case was running and
// since when), and one with its result and both times once its cleanup is done.
export function stamps({ write = line => writeSync(1, line), now = () => new Date() } = {}) {
  return {
    started: name => { const started = now().toISOString(); write(JSON.stringify({ case: name, started }) + '\n'); return started; },
    finished: (result, started) => write(JSON.stringify({ ...result, started, finished: now().toISOString() }) + '\n'),
  };
}

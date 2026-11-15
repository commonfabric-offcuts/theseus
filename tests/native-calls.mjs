// The native harness's calls to the browser and to its fixture, and the line
// it writes for each case (tests/reader_persistence_native.mjs).
import { writeSync } from 'node:fs';

// Every browser command fails after ten seconds without an answer, but a
// screenshot waits for its answer: it comes once the browser has drawn the
// page's next frame, and on a busy runner the GPU can stall for longer than
// ten seconds and the frame still comes.
export const CALL_BOUND_MS = 10000;
const clock = { set: (fire, ms) => setTimeout(fire, ms), clear: timer => clearTimeout(timer) };

// The connection to the browser: call() sends one command and settles when its
// answer comes; answer() takes each packet that answers a command; closed()
// rejects whatever is unanswered when the browser goes away.
export function protocol({ send, open, timers = clock }) {
  let serial = 0;
  const waiting = new Map();
  const call = (method, params = {}, sessionId) => new Promise((resolve, reject) => {
    if (!open()) { reject(Error(`CDP connection closed: ${method}`)); return; }
    const id = ++serial;
    const timer = method === 'Page.captureScreenshot' ? undefined : timers.set(() => { waiting.delete(id); reject(Error(`CDP timed out: ${method}`)); }, CALL_BOUND_MS);
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

// A wait on the fixture (a control, a view read over HTTP, its exit): the
// harness waits for the answer.
export function bounded(promise) {
  return promise;
}

// Each case's line, written once the case and its cleanup are done.
export function stamps({ write = line => writeSync(1, line) } = {}) {
  return {
    started: () => null,
    finished: result => write(JSON.stringify(result) + '\n'),
  };
}

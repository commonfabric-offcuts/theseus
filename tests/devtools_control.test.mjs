import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { createInterface } from 'node:readline';
import { devtoolsControl, closeBrowser, endRun } from './devtools_control.mjs';

// Accepts a WebSocket upgrade on wire and hands each frame the client sends to frame(opcode, payload).
function accept(request, wire, frame) {
  const key = createHash('sha1').update(request.headers['sec-websocket-key'] + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
  wire.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${key}\r\n\r\n`);
  let buffer = Buffer.alloc(0);
  wire.on('data', chunk => {
    buffer = Buffer.concat([buffer, chunk]);
    // A client's frames are masked.
    for (;;) {
      if (buffer.length < 2) return;
      let length = buffer[1] & 0x7f, at = 2;
      if (length === 126) { if (buffer.length < 4) return; length = buffer.readUInt16BE(2); at = 4; }
      if (buffer.length < at + 4 + length) return;
      const mask = buffer.subarray(at, at + 4), payload = Buffer.from(buffer.subarray(at + 4, at + 4 + length));
      for (let i = 0; i < payload.length; i++) payload[i] ^= mask[i % 4];
      const opcode = buffer[0] & 0x0f;
      buffer = buffer.subarray(at + 4 + length);
      frame(opcode, payload);
    }
  });
}

// A DevTools endpoint the test controls: a local WebSocket server that hands the test each command the channel sends
// and answers only when told to, or closes the connection.
async function endpoint(t) {
  const server = createServer(), commands = [], arrivals = [];
  let connection, taken = 0;
  server.on('upgrade', (request, wire) => {
    connection = wire;
    // A command is one text frame.
    accept(request, wire, (opcode, payload) => {
      if (opcode === 1) { commands.push(JSON.parse(payload)); if (arrivals.length) arrivals.shift()(commands[taken++]); }
    });
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const socket = new WebSocket(`ws://127.0.0.1:${server.address().port}/devtools/browser/fake`);
  await new Promise((resolve, reject) => { socket.addEventListener('open', resolve, { once: true }); socket.addEventListener('error', reject, { once: true }); });
  const frame = (opcode, body) => {
    const payload = Buffer.from(body);
    const head = payload.length < 126 ? Buffer.from([0x80 | opcode, payload.length]) : Buffer.from([0x80 | opcode, 126, payload.length >> 8, payload.length & 0xff]);
    connection.write(Buffer.concat([head, payload]));
  };
  t.after(() => { socket.close(); connection?.destroy(); server.closeAllConnections(); server.close(); });
  return {
    socket,
    // The next command the channel sends, once it arrives.
    next: () => new Promise(resolve => { if (taken < commands.length) resolve(commands[taken++]); else arrivals.push(resolve); }),
    commands,
    send: packet => frame(1, JSON.stringify(packet)),
    // A close frame, as Chrome sends when its browser goes.
    close: () => { frame(8, ''); connection.end(); },
  };
}

// How a promise has already settled, without waiting on it: race takes an already-settled promise before the
// PENDING placed after it.
const PENDING = Symbol('pending');
const settled = promise => Promise.race([promise, Promise.resolve(PENDING)]).then(answer => ({ answer }), error => ({ error }));
const timers = () => process.getActiveResourcesInfo().filter(kind => kind === 'Timeout').length;

test('a command whose reply never comes is refused within its bound, naming its method', { timeout: 5000 }, async t => {
  const fake = await endpoint(t), { cdp } = devtoolsControl(fake.socket, { bound: 50 });
  const started = Date.now();
  const open = cdp('Runtime.evaluate', { expression: '1' }, 'S');
  assert.deepEqual((await fake.next()).method, 'Runtime.evaluate');
  await assert.rejects(open, /^Error: CDP timed out: Runtime\.evaluate$/);
  assert.ok(Date.now() - started < 2000, 'refused at its bound, not later');
});

test('a reply that comes resolves its command, clears its bound, and leaves the others open', { timeout: 5000 }, async t => {
  const fake = await endpoint(t), { cdp } = devtoolsControl(fake.socket, { bound: 300 });
  const before = timers();
  const first = cdp('Browser.getVersion'), second = cdp('Target.getTargets');
  const [asked] = [await fake.next(), await fake.next()];
  assert.equal(timers(), before + 2, 'each open command holds its bound');
  fake.send({ id: asked.id, result: { product: 'Chrome/1' } });
  assert.deepEqual(await first, { product: 'Chrome/1' });
  assert.equal(timers(), before + 1, 'the answered command\'s bound is cleared');
  assert.equal((await settled(second)).answer, PENDING, 'an answer to one command settles no other');
  // A reply after its command was refused by the bound is dropped, and refuses nothing more.
  await assert.rejects(second, /CDP timed out: Target\.getTargets/);
  const third = cdp('Target.getTargets');
  const later = await fake.next();
  fake.send({ id: fake.commands[1].id, result: {} });
  fake.send({ id: later.id, error: { code: -32000, message: 'No target' } });
  await assert.rejects(third, /"No target"/);
  assert.equal(timers(), before, 'no bound is left behind');
});

test('closing the socket refuses every open command at once, and every later one as it is sent', { timeout: 5000 }, async t => {
  const fake = await endpoint(t), { cdp } = devtoolsControl(fake.socket, { bound: 3000 });
  const open = [cdp('Runtime.evaluate', {}, 'S'), cdp('Browser.close')];
  await fake.next(); await fake.next();
  const before = timers();
  await new Promise(resolve => { fake.socket.addEventListener('close', resolve, { once: true }); fake.close(); });
  for (const command of open) {
    const outcome = await settled(command);
    assert.notEqual(outcome.answer, PENDING, 'a command open when the socket closed is never answered, so it must be refused');
    assert.match(outcome.error.message, /refused: the DevTools socket closed$/);
  }
  assert.equal(timers(), before - 2, 'the refused commands\' bounds are cleared');
  assert.match((await settled(cdp('Page.enable', {}, 'S'))).error?.message ?? 'pending', /^CDP Page\.enable refused: the DevTools socket closed$/);
});

test('the browser\'s exit refuses every open command at once', { timeout: 5000 }, async t => {
  const fake = await endpoint(t), { cdp, end } = devtoolsControl(fake.socket, { bound: 3000 });
  const open = [cdp('Runtime.evaluate', {}, 'S'), cdp('Target.getTargets')];
  await fake.next(); await fake.next();
  end('Chrome exited 0');
  for (const command of open) assert.match((await settled(command)).error?.message ?? 'pending', /refused: Chrome exited 0$/);
  assert.match((await settled(cdp('Browser.close'))).error?.message ?? 'pending', /^CDP Browser\.close refused: Chrome exited 0$/);
});

test('a page that crashes or detaches refuses the commands sent on its session at once, and only those', { timeout: 5000 }, async t => {
  const fake = await endpoint(t), events = [], { cdp } = devtoolsControl(fake.socket, { bound: 3000, event: packet => events.push(packet.method) });
  for (const [label, packet] of [['crash', { method: 'Inspector.targetCrashed', params: {}, sessionId: 'S' }],
    ['inspector detach', { method: 'Inspector.detached', params: { reason: 'Render process gone.' }, sessionId: 'S' }],
    ['session detach', { method: 'Target.detachedFromTarget', params: { sessionId: 'S', targetId: 'T' } }]]) {
    const page = cdp('Runtime.evaluate', {}, 'S'), other = cdp('Runtime.evaluate', {}, 'R'), browser = cdp('Target.getTargets');
    const [, , asked] = [await fake.next(), await fake.next(), await fake.next()];
    await new Promise(resolve => { fake.socket.addEventListener('message', resolve, { once: true }); fake.send(packet); });
    assert.match((await settled(page)).error?.message ?? 'pending', /^CDP Runtime\.evaluate refused: /, `${label}: the page's open command is refused`);
    assert.equal((await settled(other)).answer, PENDING, `${label}: another page's command stays open`);
    assert.equal((await settled(browser)).answer, PENDING, `${label}: the browser's own command stays open`);
    fake.send({ id: asked.id, result: { targetInfos: [] } });
    assert.deepEqual(await browser, { targetInfos: [] });
    fake.send({ id: asked.id - 1, result: {} });
    assert.deepEqual(await other, {});
  }
  assert.deepEqual(events, ['Inspector.targetCrashed', 'Inspector.detached', 'Target.detachedFromTarget'], 'the harness still hears every event');
});

// A stand-in browser: it prints "ready" once it is listening and exits 0 linger seconds after its stdin closes (its
// "Browser.close"). It is never signalled by the code under test; one a test leaves running is ended after that test
// by this file, which started it, so the file still ends.
const browser = (t, linger = 0) => {
  const child = spawn('/usr/bin/python3', ['-I', '-c', `import sys, time\nprint("ready", flush=True)\nsys.stdin.read()\ntime.sleep(${linger})`],
    { stdio: ['pipe', 'pipe', 'inherit'] });
  const exited = new Promise(resolve => child.once('exit', (code, signal) => resolve({ code, signal })));
  const ready = new Promise(resolve => createInterface({ input: child.stdout }).once('line', resolve));
  t.after(() => { if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL'); });
  return { child, exited, ready };
};

test('a browser that exits on Browser.close is closed, and nothing is left', { timeout: 10000 }, async t => {
  const { child, exited, ready } = browser(t);
  await ready;
  assert.deepEqual(await closeBrowser(child, exited, async () => { child.stdin.end(); }, 3000), { closed: true, left: false });
  assert.deepEqual(await exited, { code: 0, signal: null });
});

// The reader closes with closeBrowser's own grace; a browser that takes a moment to go after Browser.close is closed.
test('a browser that exits a second after Browser.close is closed within the default grace', { timeout: 10000 }, async t => {
  const { child, exited, ready } = browser(t, 1);
  await ready;
  assert.deepEqual(await closeBrowser(child, exited, async () => { child.stdin.end(); }), { closed: true, left: false });
});

test('a browser already gone before the close is not closed, and nothing is left', { timeout: 10000 }, async t => {
  const { child, exited, ready } = browser(t);
  await ready;
  child.stdin.end();
  await exited;
  assert.deepEqual(await closeBrowser(child, exited, async () => { throw Error('CDP Browser.close refused: Chrome exited 0'); }, 200),
    { closed: false, left: false });
});

// A DevTools endpoint as a wedged Chrome holds it: it takes the connection and records what the client sends, and never
// answers anything, its close frame included, nor closes the connection itself.
async function wedged(t) {
  const server = createServer(), wires = [], sent = [];
  server.on('upgrade', (request, wire) => {
    wires.push(wire);
    wire.on('error', () => {});
    accept(request, wire, (opcode, payload) => sent.push(opcode === 1 ? JSON.parse(payload).method : opcode === 8 ? 'close' : opcode));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => { for (const wire of wires) wire.destroy(); server.close(); });
  return { port: server.address().port, sent };
}

// Runs script in a Node process of its own, as a native harness runs, and returns how it ended and the JSON lines it
// printed. Its first line names the stand-in browser it started, so a run that never ends (what these cases catch)
// leaves nothing behind: the run, and a stand-in it did not report closed, are killed when the case ends.
async function runAlone(t, script, stderr = 'inherit') {
  const run = spawn(process.execPath, ['--input-type=module', '-e', script], { stdio: ['ignore', 'pipe', stderr] });
  let out = '';
  run.stdout.on('data', chunk => { out += chunk; });
  const lines = () => out.split('\n').slice(0, -1).map(line => JSON.parse(line));
  t.after(() => {
    if (run.exitCode === null && run.signalCode === null) run.kill('SIGKILL');
    // Whatever else the run printed, its first line names its stand-in.
    const [first, ...rest] = out.split('\n');
    let named;
    try { named = JSON.parse(first).pid; } catch { /* it ended before naming one */ }
    if (named !== undefined && !rest.some(line => line.includes('"closed":true'))) { try { process.kill(named, 'SIGKILL'); } catch { /* already gone */ } }
  });
  const ended = await new Promise(resolve => run.once('exit', (code, signal) => resolve({ code, signal })));
  return { ended, lines: lines() };
}

const control = JSON.stringify(new URL('./devtools_control.mjs', import.meta.url).href);
// A last line longer than a pipe holds at once, as a reader's results are, so one cut short at the exit shows.
const LONG = 1 << 20;

// The case the GitHub runner hung on: a browser that outlives Browser.close and still holds its DevTools socket, never
// answering the close. The run (endRun, as reader_native.mjs ends) must still end, report the browser left, and leave
// it running: never signalled.
test('a run whose browser outlives Browser.close and holds its socket still ends, leaving the browser running, never signalled', { timeout: 10000 }, async t => {
  const devtools = await wedged(t);
  const { ended, lines } = await runAlone(t, `
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { devtoolsControl, endRun } from ${control};
const child = spawn('/usr/bin/python3', ['-I', '-c', 'import signal\\nsignal.pause()'], { stdio: 'ignore' });
const exited = new Promise(resolve => child.once('exit', (code, signal) => resolve({ code, signal })));
await new Promise(resolve => child.once('spawn', resolve));
console.log(JSON.stringify({ pid: child.pid }));
const socket = new WebSocket('ws://127.0.0.1:${devtools.port}/devtools/browser/wedged');
await new Promise((resolve, reject) => { socket.addEventListener('open', resolve, { once: true }); socket.addEventListener('error', reject, { once: true }); });
const { cdp } = devtoolsControl(socket, { bound: 200 });
const server = createServer();
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
await endRun({ child, exited, close: () => cdp('Browser.close'), socket, server, grace: 200 }, async outcome => {
  if (!outcome.closed) process.exitCode = 1;
  return JSON.stringify({ outcome, results: 'r'.repeat(${LONG}) });
});
`);
  assert.deepEqual(ended, { code: 1, signal: null }, 'the run ends, failed, although its browser and its socket did not');
  const [{ pid }, { outcome, results }] = lines;
  assert.deepEqual(outcome, { closed: false, left: true });
  assert.equal(results.length, LONG, 'its last line is out whole before it exits');
  assert.deepEqual(devtools.sent, ['Browser.close', 'close'], 'the run asked the browser to close and closed its socket, unanswered');
  assert.doesNotThrow(() => process.kill(pid, 0), 'the browser is still running: nothing signalled it');
});

// The other side: a run whose browser closed is not cut short; it ends on its own, after its last line, as before.
test('a run whose browser closed ends on its own, not cut short', { timeout: 10000 }, async t => {
  const { ended, lines } = await runAlone(t, `
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { endRun } from ${control};
const child = spawn('/usr/bin/python3', ['-I', '-c', 'import sys\\nsys.stdin.read()'], { stdio: ['pipe', 'ignore', 'inherit'] });
const exited = new Promise(resolve => child.once('exit', (code, signal) => resolve({ code, signal })));
await new Promise(resolve => child.once('spawn', resolve));
console.log(JSON.stringify({ pid: child.pid }));
const server = createServer();
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
await endRun({ child, exited, close: async () => { child.stdin.end(); }, server, grace: 3000 }, async outcome => JSON.stringify({ outcome }));
setTimeout(() => console.log(JSON.stringify({ after: true })), 100);
`);
  assert.deepEqual(ended, { code: 0, signal: null });
  assert.deepEqual(lines.slice(1), [{ outcome: { closed: true, left: false } }, { after: true }], 'the run went on past its last line');
});

// A run whose cases threw ends through the error, after its finally; its last line is still out whole.
test('a run that ends by throwing still prints its whole last line', { timeout: 10000 }, async t => {
  const { ended, lines } = await runAlone(t, `
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { endRun } from ${control};
const child = spawn('/usr/bin/python3', ['-I', '-c', 'import sys\\nsys.stdin.read()'], { stdio: ['pipe', 'ignore', 'ignore'] });
const exited = new Promise(resolve => child.once('exit', (code, signal) => resolve({ code, signal })));
await new Promise(resolve => child.once('spawn', resolve));
console.log(JSON.stringify({ pid: child.pid }));
const server = createServer();
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
try {
  throw Error('a case failed');
} finally {
  await endRun({ child, exited, close: async () => { child.stdin.end(); }, server, grace: 3000 }, async outcome => JSON.stringify({ outcome, results: 'r'.repeat(${LONG}) }));
}
`, 'ignore');
  assert.deepEqual(ended, { code: 1, signal: null });
  const [, { outcome, results }] = lines;
  assert.deepEqual(outcome, { closed: true, left: false });
  assert.equal(results.length, LONG, 'its last line is out whole before the error ends it');
});

test('a browser whose DevTools never came up is left at once, never signalled', { timeout: 10000 }, async t => {
  const { child, ready } = browser(t);
  await ready;
  assert.deepEqual(await closeBrowser(child, new Promise(() => {}), null, 5000), { closed: false, left: true });
  assert.deepEqual([child.exitCode, child.signalCode, child.killed], [null, null, false], 'nothing signalled it');
});

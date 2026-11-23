import test from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import { EventEmitter } from 'node:events';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { isTcpRefusal, probeTcp } from './native_tcp_refusal_1028.mjs';

test('1028 cleanup probes distinguish an actual listener from exact refusal in Node and Python', async () => {
  const server = net.createServer(socket => socket.end());
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const python = () => JSON.parse(execFileSync('/usr/bin/python3', ['-I',
    fileURLToPath(new URL('./native_tcp_probe_1028.py', import.meta.url)), origin], { encoding: 'utf8' }));
  try {
    const node = await probeTcp(origin), py = python();
    assert.equal(node.event, 'connect'); assert.equal(node.refused, false);
    assert.equal(py.connect_ex, 0); assert.equal(py.refused, false);
  } finally { await new Promise(resolve => server.close(resolve)); }
  const node = await probeTcp(origin), py = python();
  assert.equal(node.code, 'ECONNREFUSED'); assert.equal(node.refused, true);
  assert.equal(py.errno_name, 'ECONNREFUSED'); assert.equal(py.refused, true);
});

test('1028 refusal requires the exact error event and code', () => {
  assert.equal(isTcpRefusal({ event: 'error', code: 'ECONNREFUSED' }), true);
  for (const code of ['ETIMEDOUT', 'EHOSTUNREACH', 'ENETUNREACH', 'ECONNRESET', 'EACCES', null])
    assert.equal(isTcpRefusal({ event: 'error', code }), false, String(code));
  for (const event of ['connect', 'timeout', 'exception', undefined])
    assert.equal(isTcpRefusal({ event, code: 'ECONNREFUSED' }), false, String(event));
});

test('1028 timeout and other socket errors retain their raw outcome without claiming refusal', async () => {
  for (const kind of ['timeout', 'other-error']) {
    const socket = new EventEmitter(); let destroyed = false;
    socket.destroy = () => { destroyed = true; };
    socket.setTimeout = (_delay, callback) => queueMicrotask(() => kind === 'timeout' ? callback() :
      socket.emit('error', Object.assign(Error('fixture unreachable'), { code: 'EHOSTUNREACH', errno: -65, syscall: 'connect' })));
    const outcome = await probeTcp('http://127.0.0.1:1', { connect: () => socket });
    assert.equal(outcome.refused, false); assert.equal(destroyed, true);
    assert.equal(outcome.code, kind === 'timeout' ? 'ETIMEDOUT' : 'EHOSTUNREACH');
    assert.equal(outcome.event, kind === 'timeout' ? 'timeout' : 'error');
  }
});

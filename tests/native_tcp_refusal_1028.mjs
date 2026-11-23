import net from 'node:net';

export const isTcpRefusal = outcome => outcome?.event === 'error' && outcome.code === 'ECONNREFUSED';

// A timeout, a connected listener, or another socket error is an unresolved
// cleanup boundary. Keep the actual event/code instead of treating all errors
// as evidence that the fixture stopped listening.
export function probeTcp(origin, { timeoutMs = 500, connect = net.createConnection } = {}) {
  const { hostname: host, port: rawPort } = new URL(origin), port = Number(rawPort);
  return new Promise(resolve => {
    let finished = false;
    const socket = connect({ host, port });
    const finish = outcome => {
      if (finished) return;
      finished = true; socket.destroy();
      resolve({ origin, host, port, ...outcome, refused: isTcpRefusal(outcome) });
    };
    socket.once('connect', () => finish({ event: 'connect', code: null }));
    socket.once('error', error => finish({ event: 'error', code: error.code ?? null,
      errno: error.errno ?? null, syscall: error.syscall ?? null, message: error.message }));
    socket.setTimeout(timeoutMs, () => finish({ event: 'timeout', code: 'ETIMEDOUT', timeoutMs }));
  });
}

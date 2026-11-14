// A native harness's channel to the Chrome it started, over that Chrome's DevTools WebSocket: one command out, its
// reply matched by id. A command whose reply has not come within its bound (10 s) is refused naming its method. Every
// command still open is refused at once when the socket closes or fails, or when the harness says the browser has
// gone (end, called on Chrome's exit), and every later command is refused as it is sent; the commands sent on a page's
// session are refused at once when that page crashes or its session detaches. So a harness whose browser stopped
// answering fails its step, closes what it started and writes its evidence, instead of waiting forever on a reply
// nobody will send.
export function devtoolsControl(socket, { bound = 10000, event = () => {} } = {}) {
  let serial = 0, ended = null;
  const waiting = new Map();
  // Refuses the open commands sent on session, or every open command when no session is named.
  const refuse = (why, session) => {
    for (const [id, waiter] of waiting) {
      if (session !== undefined && waiter.sessionId !== session) continue;
      waiting.delete(id); clearTimeout(waiter.timer);
      waiter.reject(Error(`CDP ${waiter.method} refused: ${why}`));
    }
  };
  const end = why => { ended ??= why; refuse(why); };
  socket.addEventListener('message', message => {
    const packet = JSON.parse(message.data);
    if (packet.id === undefined) {
      if (packet.method === 'Target.detachedFromTarget') refuse('its target detached', packet.params.sessionId);
      // Sent on the page's session once Inspector is enabled there; on the browser's own, it is the whole browser.
      if (packet.method === 'Inspector.targetCrashed' || packet.method === 'Inspector.detached') refuse(packet.method, packet.sessionId);
      event(packet); return;
    }
    // A reply after its command was refused (timed out, or its page gone) has no one waiting.
    const waiter = waiting.get(packet.id);
    if (!waiter) return;
    waiting.delete(packet.id); clearTimeout(waiter.timer);
    if (packet.error) waiter.reject(Error(JSON.stringify(packet.error))); else waiter.resolve(packet.result);
  });
  socket.addEventListener('close', () => end('the DevTools socket closed'));
  socket.addEventListener('error', () => end('the DevTools socket failed'));
  const cdp = (method, params = {}, sessionId) => new Promise((resolve, reject) => {
    if (ended) { reject(Error(`CDP ${method} refused: ${ended}`)); return; }
    const id = ++serial;
    const timer = setTimeout(() => { waiting.delete(id); reject(Error(`CDP timed out: ${method}`)); }, bound);
    waiting.set(id, { method, sessionId, resolve, reject, timer });
    socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
  });
  return { cdp, end };
}

// Resolves true once exited has settled, or false when grace ms passed first.
const within = (exited, grace) => new Promise(resolve => {
  const timer = setTimeout(resolve, grace, false);
  exited.then(() => { clearTimeout(timer); resolve(true); });
});

// Closes the browser this run started, through Browser.close and never a signal (AGENTS.md): close() (refused or
// not, since the reply can be lost as the browser goes), then its exit, held from its launch, for up to grace ms. A
// browser still running then is left, and left says so: the run does not wait on it (endRun), and it stays running
// past the run. With no close (its DevTools never came up) there is nothing to wait for, so it is left at once. closed
// is true only when the browser was running at close() and exited after it.
export async function closeBrowser(child, exited, close, grace = 5000) {
  const running = child.pid !== undefined && child.exitCode === null && child.signalCode === null;
  if (close) { try { await close(); } catch { /* the exit below says whether the browser went */ } }
  if (!running) return { closed: false, left: false };
  if (await within(exited, close ? grace : 0)) return { closed: Boolean(close), left: false };
  return { closed: false, left: true };
}

// Ends a run: closes its browser (closeBrowser; child is absent when none was started), its DevTools socket and its
// page server, has record write the run's evidence and give its last line, and returns once that line is out, so a
// run that ends by throwing still prints all of it. A run whose browser was left exits then, rather than wait on that
// browser's process or on the socket it can hold open by never answering its close (Node's WebSocket puts no bound on
// the close); any other run ends on its own.
export async function endRun({ child, exited, close, socket, server, grace }, record) {
  const { closed, left } = child ? await closeBrowser(child, exited, close, grace) : { closed: false, left: false };
  if (socket) socket.close();
  server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
  const line = await record({ closed, left });
  await new Promise(resolve => process.stdout.write(`${line}\n`, resolve));
  if (left) process.exit();
}

// One WebSocket from the server that names each new commit number as soon as
// it is saved. It carries no records: whoever listens reads the views it shows.
// While it is down, listeners fall back to their own schedule. A WebSocket
// rather than a streamed fetch, because the browser keeps WebSockets apart from
// its few HTTP connections per host: open pages never queue reads behind it.
const timers = { setTimeout: (f, ms) => setTimeout(f, ms), clearTimeout: t => clearTimeout(t) };
const PROTOCOL = 'theseus-live.v1';
const LONGEST_WAIT = 30000;

export function liveOffered(bootstrap) {
  const live = bootstrap?.transport?.live;
  return live?.version === 2 && live.path === '/api/live' && live.protocol === PROTOCOL;
}

export class Live {
  constructor({ token, socket = (url, protocols) => new WebSocket(url, protocols), origin = globalThis.location?.origin,
    timers: clock = timers, random = Math.random, now = () => Date.now() }) {
    Object.assign(this, { token, socket, origin, timers: clock, random, now });
    this.listeners = new Set();
    this.connected = false; this.seq = null; this.state = 'idle';
    this.failures = 0; this.timer = null; this.current = null; this.stopped = false; this.opened = 0;
  }
  // listener({ kind: 'commit', seq }) on each new number, and
  // listener({ kind: 'state', state }) with 'live' or 'down', and
  // listener({ kind: 'refused' }) when a socket ends before its first number.
  listen(listener) { this.listeners.add(listener); return () => this.listeners.delete(listener); }
  emit(event) { for (const listener of [...this.listeners]) listener(event); }
  setState(state) {
    this.connected = state === 'live';
    if (state !== this.state) { this.state = state; this.emit({ kind: 'state', state }); }
  }
  start() {
    if (this.stopped || this.current) return;
    if (this.timer !== null) { this.timers.clearTimeout(this.timer); this.timer = null; }
    const url = new URL('/api/live', this.origin); url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
    let socket;
    try { socket = this.socket(url.href, [PROTOCOL, `bearer.${this.token}`]); }
    catch { this.retry(false); return; }
    this.opened++;
    // clean: the socket said the server stopped, as a restart does, or closed
    // after announcing a commit or after staying up as long as the longest
    // wait (a quiet instance announces nothing after the first number).
    // Anything else (refused, unreadable, the feed ended for another reason,
    // or closed soon after only its first number) backs off, so a broken feed
    // is not asked in a loop.
    const attempt = this.current = { socket, lines: 0, clean: false, done: false, started: this.now() };
    const finish = () => {
      if (attempt.done) return;
      attempt.done = true;
      if (this.current === attempt) this.current = null;
      socket.onmessage = socket.onclose = socket.onerror = null;
      // Leave nothing open behind a socket this page has stopped listening to.
      try { socket.close(); } catch { /* already closing */ }
      if (this.stopped) return;
      this.retry(attempt.clean);
      // Ended before its first number: refused, or the server is not there.
      // A restarted server refuses the page's old session, so whoever holds
      // the session hears it and may renew it (then wake() tries at once).
      if (!attempt.lines) this.emit({ kind: 'refused' });
    };
    socket.onmessage = event => {
      let message = null;
      try { message = typeof event.data === 'string' ? JSON.parse(event.data) : null; } catch { /* unreadable: below */ }
      if (Number.isSafeInteger(message?.seq) && message.seq >= 0) {
        // A socket that went on to announce a commit has worked, so a later
        // ending backs off from one second again. One that ends after only its
        // first number keeps counting, so a broken feed is not asked in a loop.
        if (++attempt.lines === 2) this.failures = 0;
        this.setState('live');
        if (message.seq !== this.seq) { this.seq = message.seq; this.emit({ kind: 'commit', seq: message.seq }); }
      } else {
        attempt.clean = attempt.lines > 0 && message?.end === 'stopped';
        finish();
      }
    };
    // A close after a commit, or after a long quiet spell, is a restart or a
    // network change. A close before any number is a refusal, and one soon
    // after the first is a feed that cannot stay up.
    socket.onclose = () => {
      attempt.clean = attempt.lines > 1 || (attempt.lines > 0 && this.now() - attempt.started >= LONGEST_WAIT);
      finish();
    };
    socket.onerror = () => finish();
  }
  retry(clean) {
    this.setState('down');
    if (clean) this.failures = 0;
    const delay = clean ? 1000 : Math.min(LONGEST_WAIT, 1000 * 2 ** Math.min(this.failures++, 5));
    this.timer = this.timers.setTimeout(() => { this.timer = null; this.start(); }, delay + Math.floor(this.random() * 250));
  }
  stop() {
    this.stopped = true;
    if (this.timer !== null) this.timers.clearTimeout(this.timer);
    this.timer = null;
    const socket = this.current?.socket; this.current = null;
    if (socket) { socket.onmessage = socket.onclose = socket.onerror = null; try { socket.close(); } catch { /* closing */ } }
    this.setState('down');
  }
  // A page that becomes visible or comes back online tries at once.
  wake() { if (!this.stopped && this.state !== 'live' && !this.current) this.start(); }
}

// A load asked for while one runs is run once more after it, so a commit that
// lands during a load is still read; any number of such asks make one more.
// A load that fails does not cancel the one asked for after it; the run
// settles as its last load did.
export function reloader(load) {
  let running = null, again = false;
  return () => {
    if (running) { again = true; return running; }
    running = (async () => {
      let failed = false, failure = null;
      do {
        again = false; failed = false;
        try { await load(); } catch (error) { failed = true; failure = error; }
      } while (again);
      if (failed) throw failure;
    })().finally(() => { running = null; });
    return running;
  };
}

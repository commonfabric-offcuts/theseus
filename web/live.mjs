// One stream from the server that names each new commit number as soon as it
// is saved. It carries no records: whoever listens reads the views it shows.
// While the stream is down, listeners fall back to their own schedule.
const timers = { setTimeout: (f, ms) => setTimeout(f, ms), clearTimeout: t => clearTimeout(t) };

export function liveOffered(bootstrap) {
  const live = bootstrap?.transport?.live;
  return live?.version === 1 && live.path === '/api/live';
}

export class Live {
  constructor({ token, fetcher = globalThis.fetch.bind(globalThis), timers: clock = timers, random = Math.random }) {
    Object.assign(this, { token, fetcher, timers: clock, random });
    this.listeners = new Set();
    this.connected = false; this.seq = null; this.state = 'idle';
    this.failures = 0; this.timer = null; this.controller = null; this.running = null; this.stopped = false;
  }
  // listener({ kind: 'commit', seq }) on each new number, and
  // listener({ kind: 'state', state }) with 'live', 'down' or 'unavailable'.
  listen(listener) { this.listeners.add(listener); return () => this.listeners.delete(listener); }
  emit(event) { for (const listener of [...this.listeners]) listener(event); }
  setState(state) {
    this.connected = state === 'live';
    if (state !== this.state) { this.state = state; this.emit({ kind: 'state', state }); }
  }
  start() {
    if (this.stopped || this.running || this.state === 'unavailable') return this.running;
    if (this.timer !== null) { this.timers.clearTimeout(this.timer); this.timer = null; }
    this.running = this.run().finally(() => { this.running = null; });
    return this.running;
  }
  stop() {
    this.stopped = true;
    if (this.timer !== null) this.timers.clearTimeout(this.timer);
    this.timer = null; this.controller?.abort(); this.setState('down');
  }
  async run() {
    const controller = this.controller = new AbortController();
    // clean: the stream delivered and then closed or said the server stopped,
    // as a restart does. Anything else (refused, unreadable, the feed ended
    // for another reason) backs off, so a broken feed is not asked in a loop.
    let lines = 0, clean = false;
    try {
      const response = await this.fetcher('/api/live', { method: 'GET', credentials: 'same-origin', cache: 'no-store',
        headers: { Authorization: `Bearer ${this.token}` }, signal: controller.signal });
      if (!response.ok) {
        let code = null;
        try { code = (await response.json())?.error?.code ?? null; } catch { /* the status still decides */ }
        // An instance without live updates says so; asking again cannot change that.
        if (code === 'LIVE_UNAVAILABLE') { this.setState('unavailable'); return; }
        throw Error(`Live updates were refused (${response.status}).`);
      }
      const reader = response.body.getReader(), decoder = new TextDecoder();
      let buffered = '';
      stream: for (;;) {
        const { value, done } = await reader.read();
        if (done) { clean = lines > 0; break; }
        buffered += decoder.decode(value, { stream: true });
        let end;
        while ((end = buffered.indexOf('\n')) >= 0) {
          const line = JSON.parse(buffered.slice(0, end));
          buffered = buffered.slice(end + 1);
          if (Number.isSafeInteger(line?.seq) && line.seq >= 0) {
            lines++; this.setState('live');
            if (line.seq !== this.seq) { this.seq = line.seq; this.emit({ kind: 'commit', seq: line.seq }); }
          } else if (typeof line?.end === 'string') {
            clean = lines > 0 && line.end === 'stopped';
            controller.abort();
            break stream;
          } else break stream;
        }
      }
    } catch {
      // A refused connection, a dropped stream or an unreadable line: below.
    } finally {
      if (this.controller === controller) this.controller = null;
    }
    if (this.stopped || this.state === 'unavailable') return;
    this.setState('down');
    if (clean) this.failures = 0;
    const delay = clean ? 1000 : Math.min(30000, 1000 * 2 ** Math.min(this.failures++, 5));
    this.timer = this.timers.setTimeout(() => { this.timer = null; this.start(); }, delay + Math.floor(this.random() * 250));
  }
  // A page that becomes visible or comes back online tries at once.
  wake() { if (!this.stopped && this.state === 'down' && !this.running) this.start(); }
}

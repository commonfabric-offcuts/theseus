// Own-action observations. No ambient "last action", writing, or awaited report.
const copy = value => structuredClone(value);
const realTimers = { setTimeout: (fn, ms) => setTimeout(fn, ms), clearTimeout: id => clearTimeout(id) };
const finite = value => Number.isFinite(value) && value >= 0 ? Math.min(value, 3600000) : 0;
const burdenKeys = ['loaded_messages', 'retained_messages', 'rendered_cards', 'window_limit'];
const id = () => crypto.randomUUID();
const endpointPhase = name => name.endsWith('_dom') || ['input', 'reply_focused', 'composer_settled', 'action_end', 'frame1', 'frame2'].includes(name);

export function timingCall(timing, method, ...args) {
  try { return timing?.[method]?.(...args); } catch { return undefined; }
}

export class ActionTimings {
  constructor({ instanceId, build, report, burden = () => ({}), now = () => performance.now(), wall = () => Date.now(),
    frame = globalThis.requestAnimationFrame?.bind(globalThis), cancelFrame = globalThis.cancelAnimationFrame?.bind(globalThis),
    timers = realTimers, uuid = id, Observer = globalThis.PerformanceObserver, flushDelayMs = 10000, actionTimeoutMs = 60000 } = {}) {
    Object.assign(this, { instanceId, build, report, burden, now, wall, frame, cancelFrame, timers, uuid, Observer, flushDelayMs, actionTimeoutMs });
    this.tab = uuid(); this.records = new Map(); this.dirty = new Set(); this.localDropped = 0; this.failedReports = 0;
    this.support = { long_tasks: false, resource_timing: Boolean(globalThis.performance?.getEntriesByName), frames: Boolean(frame) };
    this.disposed = false; this.flight = null; this.reporting = null;
  }

  begin(kind, event = null) {
    if (this.disposed) return null;
    const start = this.now(), values = this.burden() ?? {};
    const row = { v: 1, id: this.uuid(), tab: this.tab, sequence: 1, kind, build: this.build, started_ms: this.wall(),
      elapsed_ms: 0, outcome: 'running', operations: [], submission: null,
      burden: Object.fromEntries(burdenKeys.map(key => [key, Math.max(0, Math.min(10000000, Number.isSafeInteger(values[key]) ? values[key] : 0))])),
      phases: [], support: { ...this.support }, overhead_ms: 0, dropped_phases: 0, lost_records: this.localDropped,
      report_failures: this.failedReports, counts: { backend_puts: 0, journal_writes: 0, journal_transactions: 0, requests: 0, retries: 0 }, long_tasks: { count: 0, duration_ms: 0 }, idle: { samples: 0, maximum_gap_ms: null }, failure: null };
    const trace = new ActionTrace(this, row, start);
    this.records.set(row.id, trace); this.dirty.add(row.id);
    if (kind !== 'idle') trace.timeout = this.timers.setTimeout(() => trace.finish('incomplete', 'timeout'), this.actionTimeoutMs);
    if (kind !== 'idle') trace.mark('input');
    while (this.records.size > 128) {
      const oldest = this.records.keys().next().value, gone = this.records.get(oldest);
      gone.retire(false); this.records.delete(oldest); this.dirty.delete(oldest); this.localDropped++;
    }
    this.schedule();
    row.overhead_ms += finite(this.now() - start);
    return trace;
  }

  schedule() {
    if (this.disposed || this.flushTimer !== undefined || !this.dirty.size && !this.flight) return;
    this.flushTimer = this.timers.setTimeout(() => { this.flushTimer = undefined; void this.flush(); }, this.flushDelayMs);
  }

  async flush() {
    if (this.reporting) return this.reporting;
    if (!this.flight) {
      const traces = [...this.dirty].map(key => this.records.get(key)).filter(Boolean).slice(0, 16);
      if (!traces.length) return false;
      const began = this.now(), records = traces.map(trace => trace.snapshot());
      const overhead = finite(this.now() - began) / records.length;
      for (const row of records) row.overhead_ms = finite(row.overhead_ms + overhead);
      this.flight = { id: this.uuid(), records };
    }
    const batch = this.flight;
    const work = async () => {
      try {
        const answer = await this.report(copy(batch.records), batch.id);
        if (answer?.instance_id !== this.instanceId || answer.operation_id !== batch.id || answer.kind !== 'performance.record' ||
            answer.recorded !== true || answer.status !== 'committed') throw Error('Observation not confirmed');
        for (const row of batch.records) if (this.records.get(row.id)?.row.sequence === row.sequence) this.dirty.delete(row.id);
        if (this.flight === batch) this.flight = null;
        return true;
      } catch { this.failedReports++; return false; }
      finally { this.reporting = null; this.schedule(); }
    };
    this.reporting = Promise.resolve().then(work);
    return this.reporting;
  }

  observe() {
    if (this.disposed || this.observing) return;
    this.observing = true;
    if (this.Observer) {
      try {
        this.observer = new this.Observer(list => {
          const began = this.now();
          for (const entry of list.getEntries()) for (const trace of this.records.values()) {
            const end = trace.row.outcome === 'running' ? this.now() : trace.start + trace.row.elapsed_ms;
            const overlap = Math.min(end, entry.startTime + entry.duration) - Math.max(trace.start, entry.startTime);
            if (trace.retired || !(overlap > 0)) continue;
            trace.change(() => { trace.row.long_tasks.count++; trace.row.long_tasks.duration_ms += finite(overlap); });
          }
          const overhead = finite(this.now() - began);
          for (const trace of this.records.values()) if (!trace.retired && trace.row.outcome === 'running') trace.row.overhead_ms += overhead;
        });
        this.observer.observe({ type: 'longtask', buffered: false }); this.support.long_tasks = true;
      } catch { this.observer?.disconnect(); this.observer = null; }
    }
    let last = this.now(), window = this.begin('idle');
    const sample = () => {
      if (this.disposed) return;
      const now = this.now(), gap = finite(Math.max(0, now - last - 5000)); last = now;
      window?.change(() => { window.row.idle.samples++; window.row.idle.maximum_gap_ms = Math.max(window.row.idle.maximum_gap_ms ?? 0, gap); });
      if (window && now - window.start >= 60000) { window.finish('complete'); window = this.begin('idle'); }
      this.idleTimer = this.timers.setTimeout(sample, 5000);
    };
    this.idleTimer = this.timers.setTimeout(sample, 5000);
  }

  dispose() {
    if (this.disposed) return;
    for (const trace of this.records.values()) if (trace.row.outcome === 'running') trace.retire();
    this.disposed = true; this.observer?.disconnect();
    this.timers.clearTimeout(this.idleTimer); this.timers.clearTimeout(this.flushTimer); this.flushTimer = undefined;
    void this.flush(); // Best effort only; page departure is not a receipt.
  }
}

class ActionTrace {
  constructor(owner, row, start) { Object.assign(this, { owner, row, start, frames: new Set(), endpoints: new Set(), retired: false, desired: null }); }
  change(work) {
    if (this.retired || !this.owner.records.has(this.row.id)) return;
    const began = this.owner.now();
    try { work(); this.row.sequence++; this.row.elapsed_ms = finite(this.owner.now() - this.start); this.owner.dirty.add(this.row.id); this.owner.schedule(); }
    finally { this.row.overhead_ms = finite(this.row.overhead_ms + finite(this.owner.now() - began)); }
  }
  mark(name, { at_ms = finite(this.owner.now() - this.start), duration_ms = null, request = null, operation = null, clock = 'browser' } = {}) {
    this.change(() => {
      if (this.row.phases.length >= 32) {
        this.row.dropped_phases++;
        if (!endpointPhase(name)) return;
        const index = this.row.phases.findIndex(phase => !endpointPhase(phase.name));
        if (index < 0) return;
        this.row.phases.splice(index, 1);
      }
      this.row.phases.push({ name, at_ms: finite(at_ms), duration_ms: duration_ms === null ? null : finite(duration_ms), request, operation, clock });
    });
  }
  span(name, fields = {}) {
    const start = this.owner.now(), at_ms = finite(start - this.start); let ended = false;
    return () => { if (!ended) { ended = true; this.mark(name, { ...fields, at_ms, duration_ms: finite(this.owner.now() - start) }); } };
  }
  link(operation, submission = null) {
    this.change(() => {
      if (operation && !this.row.operations.includes(operation) && this.row.operations.length < 8) this.row.operations.push(operation);
      if (submission) this.row.submission = submission;
    });
  }
  requestId() { return this.owner.uuid(); }
  count(name) { this.change(() => { if (Object.hasOwn(this.row.counts, name)) this.row.counts[name]++; }); }
  hasEndpoint(name) { return this.endpoints.has(name); }
  endpoint(name) {
    if (this.endpoints.has(name) || this.retired) return;
    this.endpoints.add(name);
    this.mark(name);
    if (!this.owner.frame || this.retired) return;
    const schedule = (phase, next) => {
      const token = this.owner.frame(() => {
        this.frames.delete(token);
        if (this.retired) return;
        this.mark(phase, { request: name });
        if (next) next(); else this.settle();
      });
      this.frames.add(token);
    };
    schedule('frame1', () => schedule('frame2'));
  }
  finish(outcome = 'complete', failure = null) {
    this.desired = outcome;
    this.change(() => { this.row.failure = failure; this.row.outcome = outcome === 'complete' && this.frames.size ? 'running' : outcome; });
    this.mark('action_end');
    if (outcome !== 'complete' || !this.frames.size) this.owner.timers.clearTimeout(this.timeout);
  }
  settle() { if (!this.frames.size && this.desired === 'complete') { this.change(() => { this.row.outcome = 'complete'; }); this.owner.timers.clearTimeout(this.timeout); } }
  retire(report = true) {
    if (this.retired) return;
    if (report && this.row.outcome === 'running') this.finish('incomplete', 'retired');
    this.retired = true; this.owner.timers.clearTimeout(this.timeout);
    for (const token of this.frames) this.owner.cancelFrame?.(token);
    this.frames.clear();
  }
  snapshot() {
    const row = copy(this.row); row.lost_records = this.owner.localDropped; row.report_failures = this.owner.failedReports;
    while (new TextEncoder().encode(JSON.stringify(row)).length > 4096 && row.phases.length) {
      const index = row.phases.findIndex(phase => !endpointPhase(phase.name));
      row.phases.splice(index < 0 ? 0 : index, 1); row.dropped_phases++;
    }
    return row;
  }
}

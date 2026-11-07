// Scoped read state only. This module owns no editor, operation or delivery.
const copy = structuredClone;
const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const integer = x => Number.isSafeInteger(x) && x >= 0;
const diagnostic = message => Object.assign(Error(message), { code: 'INVALID_FRESHNESS_VIEW' });
export const bindingOf = b => ({ instance_id: b?.instance_id, actor_id: b?.actor,
  authority_id: b?.authority?.authority_id, authority_epoch: b?.authority?.authority_epoch });
const sameBinding = (a, b) => Object.keys(a).every(k => a[k] === b[k]);

export function supportsAdmission(bootstrap) {
  const a = bootstrap?.transport?.read_admission;
  return a?.version === 1 && a.header === 'X-AIM-Read-Class' &&
    a.foreground?.slots === 1 && a.foreground.max_waiters === 8 && a.foreground.queue_timeout_ms === 5000 &&
    a.background?.slots === 1 && a.background.max_waiters === 2 && a.background.queue_timeout_ms === 500;
}

export function readFailure(value) {
  const error = value?.details?.error ?? value?.error ?? value;
  const code = error?.code, status = value?.status ?? 0;
  const result = kind => ({ kind, code: code ?? 'READ_FAILED', message: error?.message ?? value?.message ?? 'The view could not be read.' });
  if (['AUTHORITY_CHANGED', 'INVALID_BINDING'].includes(code)) return result('authority');
  if (code === 'CLEANUP_DEFERRED') return result('defer');
  if (code === 'RESYNC_REQUIRED') return result('resync');
  if (code === 'FORBIDDEN') return result('forbidden');
  if (status === 401 || status === 403 || ['SESSION_REQUIRED', 'ORIGIN_REFUSED'].includes(code)) return result('reconnect');
  if (['VIEW_TOO_LARGE', 'INVALID_ARGUMENT', 'INVALID_READ_CLASS', 'INVALID_FRESHNESS_VIEW'].includes(code)) return result('diagnostic');
  if (['SERVER_BUSY', 'AUTHORITY_BUSY', 'DATABASE_BUSY', 'RESOURCE_NOT_CURRENT'].includes(code) || error?.retryable === true ||
      status >= 500 && ['REQUEST_UNCONFIRMED', 'CAPABILITIES_UNAVAILABLE'].includes(code)) return result('retry');
  if (!code && status >= 500 && status < 600) return result('retry');
  if (!code && (value?.name === 'AbortError' || value?.name === 'AttemptError' && status === 0 || value instanceof TypeError)) return result('retry');
  return result('diagnostic');
}

export function checkedView(answer, instance) {
  if (answer?.error) throw Object.assign(Error(answer.error.message ?? answer.error.code), { details: answer });
  if (!answer || answer.instance_id !== instance) throw diagnostic('The view belongs to another instance or is malformed.');
  return answer;
}

function validateCursor(value, bootstrap, scope, kind) {
  const identity = bindingOf(bootstrap);
  if (!value || value.v !== 1 || value.kind !== kind || !integer(value.after_seq) ||
      !sameBinding(identity, value) || !equal(value.scope, scope)) throw diagnostic('The changes cursor has a different binding or scope.');
  const keys = ['v', 'kind', ...Object.keys(identity), 'scope', 'after_seq', ...(kind === 'continuation' ? ['through_seq', 'covered_versions'] : [])];
  if (Object.keys(value).length !== keys.length || keys.some(key => !Object.hasOwn(value, key))) throw diagnostic('The changes cursor fields are malformed.');
  if (kind === 'continuation' && (!integer(value.through_seq) || value.through_seq < value.after_seq || !versions(value.covered_versions))) throw diagnostic('The changes window is malformed.');
}
const versions = v => v && Object.keys(v).length === 2 && integer(v.topic) && integer(v.notebook);
export function changesPage(answer, bootstrap, topicId, input = null) {
  checkedView(answer, bootstrap.instance_id);
  const scope = { kind: 'topic', id: topicId };
  if (!equal(answer.scope, scope) || answer.baseline !== (input === null) || !Array.isArray(answer.items) || answer.items.length > 50 ||
      typeof answer.has_more !== 'boolean') throw diagnostic('The changes page is malformed.');
  const end = answer.has_more ? answer.continuation : answer.checkpoint;
  validateCursor(end, bootstrap, scope, answer.has_more ? 'continuation' : 'checkpoint');
  if (answer.has_more ? answer.checkpoint !== null || answer.covered_versions !== null || !answer.items.length
    : answer.continuation !== null || !versions(answer.covered_versions)) throw diagnostic('A partial changes page cannot be a checkpoint.');
  if (input === null && (answer.items.length || answer.has_more)) throw diagnostic('The baseline must precede view loading.');
  let previous = input?.after_seq ?? 0;
  const upper = answer.has_more ? end.through_seq : end.after_seq;
  if (upper < previous || input?.kind === 'continuation' && upper !== input.through_seq) throw diagnostic('The changes window moved backwards or changed.');
  const covered = answer.has_more ? end.covered_versions : answer.covered_versions;
  if (input?.kind === 'continuation' && ['topic', 'notebook'].some(key => covered[key] !== input.covered_versions[key])) {
    throw diagnostic('The captured changes version window changed.');
  }
  for (const item of answer.items) {
    if (!integer(item.seq) || item.seq <= previous || item.seq > upper || !integer(item.version) || item.version < 1 ||
        typeof item.resource_id !== 'string' || !item.resource_id || !['topic', 'memory', 'workspace'].includes(item.resource_kind) ||
        item.resource_kind === 'topic' && item.resource_id !== topicId) throw diagnostic('The change key is malformed or outside this topic.');
    previous = item.seq;
  }
  if (answer.has_more && end.after_seq !== previous) throw diagnostic('The continuation does not follow its keys.');
  return answer;
}

export async function initialViews({ api, bootstrap, topicId, load }) {
  let checkpoint = null;
  if (supportsAdmission(bootstrap)) {
    const answer = changesPage(await api.view('changes', { scope: { kind: 'topic', id: topicId }, limit: 50 }), bootstrap, topicId);
    checkpoint = copy(answer.checkpoint);
  }
  await load();
  return checkpoint;
}

export class RevisionTargets {
  constructor() { this.values = new Map(); this.relevant = new Set(); }
  retain(ids) {
    this.relevant = new Set(ids);
    for (const id of this.values.keys()) if (!this.relevant.has(id)) this.values.delete(id);
  }
  observe(id, revision) {
    if (this.relevant.has(id) && integer(revision)) this.values.set(id, Math.max(this.values.get(id) ?? 0, revision));
  }
  offer(ref, currentRevision) {
    if (ref?.kind !== 'memory') return null;
    this.observe(ref.id, currentRevision);
    const target = Math.max(this.values.get(ref.id) ?? 0, ref.revision);
    return target > ref.revision ? target : null;
  }
}

const timers = { setTimeout: (f, ms) => setTimeout(f, ms), clearTimeout: t => clearTimeout(t) };
export class Freshness {
  constructor({ api, bootstrap, topicId, checkpoint, read, keys, refresh, binding = () => bootstrap,
    status = () => {}, authorityLost = async () => {}, denied = async () => {}, rebuild = async () => {},
    refreshKeys = () => [], timers: clock = timers, random = Math.random, yieldRead = () => new Promise(resolve => setTimeout(resolve, 0)),
    live = null }) {
    Object.assign(this, { api, bootstrap: copy(bootstrap), topicId, read, keys, refresh, binding, status, authorityLost, denied, rebuild, refreshKeys, timers: clock, random, yieldRead, live });
    // settled: the last pass ran to its end and found nothing left to read.
    this.settled = false;
    this.checkpoint = copy(checkpoint); this.continuation = null;
    this.dirty = new Map(); this.serial = 0; this.epoch = 0; this.visible = true;
    this.enabled = supportsAdmission(bootstrap) && Boolean(checkpoint);
    this.disposed = false; this.stopped = false; this.requested = false; this.running = null; this.timer = null; this.failures = 0;
  }
  invalidate(key, version = 0, force = false) {
    const old = this.dirty.get(key);
    if (!old || force || version > old.version) this.dirty.set(key, { version: Math.max(version, old?.version ?? 0), serial: ++this.serial });
  }
  clearTimer() { if (this.timer !== null) this.timers.clearTimeout(this.timer); this.timer = null; }
  schedule(delay = 500) {
    this.clearTimer();
    // While the live stream is up, each new commit asks for a pass, so no timer
    // is needed once a pass has settled with nothing asked for since. Every
    // other ending (a failure, a retry, an interrupted or superseded pass, work
    // left over) keeps the timer.
    if (this.live?.connected && this.settled && !this.requested && !this.dirty.size && !this.continuation) return;
    if (this.enabled && this.visible && !this.stopped && !this.disposed) this.timer = this.timers.setTimeout(() => { this.timer = null; this.request(); }, delay);
  }
  start() { if (this.visible) return this.request(); }
  setVisible(visible) { this.visible = visible; this.clearTimer(); if (!visible) this.interrupt(); else return this.request(); }
  interrupt() { ++this.epoch; }
  dispose() { this.disposed = true; this.interrupt(); this.clearTimer(); }
  bindingMatches() { return sameBinding(bindingOf(this.bootstrap), bindingOf(this.binding())); }
  current(epoch) { return !this.disposed && !this.stopped && epoch === this.epoch && this.bindingMatches(); }
  async stopAuthority(failure) {
    this.stopped = true; this.interrupt(); this.clearTimer();
    const parked = this.authorityLost(bindingOf(this.bootstrap), failure);
    this.status(failure); await parked;
  }
  async stopDenied(failure, read, current) {
    this.clearTimer();
    let result = failure;
    try { await this.denied(read, current); if (!current()) return; }
    catch (error) {
      if (!current()) return;
      const recheck = readFailure(error);
      // The topic denial is confirmed even when source access cannot yet be
      // checked. A stopped controller must not promise an automatic retry.
      result = ['retry', 'defer'].includes(recheck.kind) ? { ...failure, cause: recheck } : { ...recheck, cause: failure };
      if (result.kind === 'authority') { await this.stopAuthority(result); return; }
    }
    this.stopped = true; this.status(result);
  }
  async readAt(epoch, name, args) {
    if (!this.current(epoch)) throw Object.assign(Error('Freshness read was superseded.'), { code: 'CLEANUP_DEFERRED' });
    let answer;
    try { answer = await this.read(options => name === 'bootstrap' ? this.api.bootstrap(options) : this.api.view(name, args, options)); }
    catch (error) {
      // Cleanup retains its normal deferral semantics. This read-only consumer
      // still needs the server refusal for visible delay and bounded backoff.
      throw error.code === 'CLEANUP_DEFERRED' && error.cause ? error.cause : error;
    }
    if (!this.current(epoch)) throw Object.assign(Error('Freshness read was superseded.'), { code: 'CLEANUP_DEFERRED' });
    return checkedView(answer, this.bootstrap.instance_id);
  }
  request({ refresh = false, retry = false } = {}) {
    if (!this.enabled || !this.visible || this.disposed || this.stopped && !retry) return Promise.resolve();
    if (retry) { this.stopped = false; this.failures = 0; }
    if (refresh) for (const { key, version } of this.refreshKeys()) this.invalidate(key, version, true);
    this.requested = true; this.clearTimer();
    if (!this.running) {
      this.running = this.drain().finally(() => { this.running = null; this.schedule(this.delay ?? 500); });
    }
    this.schedule(this.delay ?? 500);
    return this.running;
  }
  async drain() {
    const epoch = this.epoch;
    const read = (name, args) => this.readAt(epoch, name, args);
    const current = () => this.current(epoch);
    this.delay = 500; this.settled = false;
    try {
      while (current() && (this.requested || this.continuation || this.dirty.size)) {
        if (this.requested || this.continuation) {
          this.requested = false;
          const input = this.continuation ?? this.checkpoint;
          const answer = changesPage(await read('changes', { scope: { kind: 'topic', id: this.topicId }, limit: 50, cursor: input }), this.bootstrap, this.topicId, input);
          for (const item of answer.items) for (const entry of this.keys(item)) this.invalidate(entry.key, entry.version);
          // Recording every invalidation precedes checkpoint progress; resource
          // success is independent and failures remain in the dirty map.
          if (answer.has_more) this.continuation = copy(answer.continuation);
          else { this.checkpoint = copy(answer.checkpoint); this.continuation = null; }
          await this.yieldRead();
        }
        if (!current()) return;
        const entry = this.dirty.entries().next().value;
        if (entry) {
          const [key, captured] = entry;
          const complete = await this.refresh(key, captured.version, read, current);
          if (!current()) return;
          if (this.dirty.get(key) === captured) {
            this.dirty.delete(key);
            if (complete === false) this.dirty.set(key, captured);
          }
          await this.yieldRead();
        }
      }
      if (current()) { this.failures = 0; this.settled = true; this.status({ kind: 'current', message: '' }); }
    } catch (error) {
      if (!current()) return;
      const failure = readFailure(error);
      if (failure.kind === 'authority') {
        await this.stopAuthority(failure);
      } else if (failure.kind === 'resync') {
        try {
          const b = await read('bootstrap');
          if (!sameBinding(bindingOf(b), bindingOf(this.bootstrap))) {
            await this.stopAuthority({ ...failure, kind: 'authority' }); return;
          }
          if (!supportsAdmission(b)) { this.stopped = true; this.status({ kind: 'diagnostic', message: 'Automatic updates need the updated server. Reload this page to see newer messages.' }); return; }
          const baseline = changesPage(await read('changes', { scope: { kind: 'topic', id: this.topicId }, limit: 50 }), this.bootstrap, this.topicId);
          await this.rebuild(read, current);
          if (!current()) return;
          this.checkpoint = copy(baseline.checkpoint); this.continuation = null; this.requested = true;
          this.status({ kind: 'retry', message: 'Refreshing this topic after a history change.' });
        } catch (resyncError) {
          if (!current()) return;
          const result = readFailure(resyncError);
          if (result.kind === 'forbidden') { await this.stopDenied(result, read, current); return; }
          if (result.kind === 'authority') { await this.stopAuthority(result); return; }
          else if (!['retry', 'defer'].includes(result.kind)) this.stopped = true;
          this.status(result);
        }
      } else if (failure.kind === 'forbidden') {
        await this.stopDenied(failure, read, current);
      } else if (['retry', 'defer'].includes(failure.kind)) {
        this.delay = failure.kind === 'defer' ? 500 : Math.min(5000, 500 * 2 ** Math.min(this.failures++, 4) + Math.floor(this.random() * 100));
        this.status(failure);
      } else { this.stopped = true; this.clearTimer(); this.status(failure); }
    } finally {
      // A command/recovery probe may have learned the new authority first.
      // Epoch cancellation stays quiet; an actual changed binding does not.
      if (!this.disposed && !this.stopped && !this.bindingMatches()) {
        await this.stopAuthority({ kind: 'authority', code: 'AUTHORITY_CHANGED', message: 'The runtime authority changed.' });
      }
    }
  }
}

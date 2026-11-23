//1135 consumes only the optional release object of the existing health_light
// read. It never polls, declares a deployment successful, or reloads the page.
import { linkNode } from './links.mjs';
import { routeHref } from './topic-navigation.mjs';

export const RELEASES_TOPIC = 't-9e76576dce8d4e6082f163ddb3697490';
const phases = new Set(['starting', 'live', 'failed']);
const positive = n => Number.isSafeInteger(n) && n > 0;
const identity = r => `${r.number}:${r.commit}`;
const storageFor = doc => { try { return doc.defaultView?.sessionStorage ?? null; } catch { return null; } };
const owners = new WeakMap();

export function releaseObservation(value) {
  if (!value || !phases.has(value.phase) || !positive(value.number) ||
      !/^[0-9a-f]{40}$/.test(value.commit ?? '') || !positive(value.started_ms)) return null;
  if (value.phase === 'live' && (!positive(value.live_ms) || value.live_ms < value.started_ms) ||
      value.phase === 'failed' && (!positive(value.failed_ms) || value.failed_ms < value.started_ms)) return null;
  if (value.dossier != null && !/^m-[0-9a-f]{32}$/.test(value.dossier)) return null;
  return { phase: value.phase, number: value.number, commit: value.commit, started_ms: value.started_ms,
    ...(value.phase === 'live' ? { live_ms: value.live_ms } : {}),
    ...(value.phase === 'failed' ? { failed_ms: value.failed_ms } : {}),
    ...(value.dossier ? { dossier: value.dossier } : {}) };
}

export class ReleaseToasts {
  constructor({ doc, instanceId, actor, storage = storageFor(doc) }) {
    Object.assign(this, { doc, instanceId, actor, storage });
    this.key = 'theseus.release-toasts.v1:' + JSON.stringify([instanceId, actor]);
    this.seen = new Map(); this.current = null; this.seq = -1; this.initial = true;
    try {
      const saved = JSON.parse(storage?.getItem(this.key) ?? 'null');
      if (saved?.v === 1 && Array.isArray(saved.seen) && saved.seen.length <= 32) {
        for (const [key, said] of saved.seen) {
          if (/^[1-9][0-9]*:[0-9a-f]{40}$/.test(key) && Array.isArray(said) && said.every(p => phases.has(p)))
            this.seen.set(key, new Set(said));
        }
        this.current = releaseObservation(saved.current);
      }
    } catch { /* Device observation storage is optional; server facts remain authoritative. */ }
  }

  remember() {
    while (this.seen.size > 32) this.seen.delete(this.seen.keys().next().value);
    try { this.storage?.setItem(this.key, JSON.stringify({ v: 1, seen: [...this.seen].map(([k, v]) => [k, [...v]]), current: this.current })); }
    catch { /* This page still deduplicates in memory. */ }
  }

  observe(answer) {
    if (this.disposed || answer?.instance_id !== this.instanceId || !Number.isSafeInteger(answer.commit_seq) ||
        answer.commit_seq < 0 || answer.commit_seq < this.seq) return false;
    this.seq = answer.commit_seq;
    // An absent object says nothing ran on this serving process. It cannot
    // complete or erase a release the page observed before the restart.
    if (answer.release == null) { this.initial = false; return false; }
    const next = releaseObservation(answer.release);
    if (!next) return false;
    const key = identity(next), previous = this.current;
    if (previous && (next.number < previous.number || next.started_ms < previous.started_ms ||
        next.started_ms === previous.started_ms && identity(previous) !== key)) return false;
    const sameAttempt = previous && next.started_ms === previous.started_ms && identity(previous) === key;
    if (sameAttempt && (previous.phase === 'failed' && next.phase !== 'failed' || previous.phase === 'live' && next.phase === 'starting')) return false;
    const said = this.seen.get(key) ?? new Set();
    const wasInitial = this.initial; this.initial = false;
    // Never downgrade an exact dossier link while its enrichment catches up.
    if (sameAttempt && next.phase === 'live' && previous.dossier && !next.dossier) next.dossier = previous.dossier;
    this.current = next;
    if (next.phase === 'failed') {
      if (this.shown?.key === key) this.dismiss();
    } else if (!said.has(next.phase)) {
      if (next.phase === 'starting' || !wasInitial || said.has('starting')) this.show(next);
    } else if (next.phase === 'live' && this.shown?.key === key && this.shown.phase === 'live') {
      this.upgrade(next);
    }
    said.add(next.phase); this.seen.set(key, said); this.remember();
    return true;
  }

  show(release) {
    let host = this.host;
    if (!host) {
      host = this.doc.createElement('div'); host.className = 'release-toast';
      host.setAttribute('role', 'status'); host.setAttribute('aria-live', 'polite'); host.setAttribute('aria-atomic', 'true');
      const close = this.doc.createElement('button'); close.type = 'button'; close.textContent = '×';
      close.setAttribute('aria-label', 'Dismiss release notice'); close.onclick = () => this.dismiss();
      host.append(close); this.close = close; this.host = host; this.doc.body.append(host);
    }
    const previous = this.link ?? this.words;
    this.shown = { key: identity(release), phase: release.phase };
    let content;
    if (release.phase === 'live') {
      if (this.link) {
        this.target.route = this.route(release); this.link.href = routeHref(this.target.route);
        this.link.textContent = `Release ${release.number} is live`;
      } else {
        this.target = { written: true, route: this.route(release) };
        this.link = linkNode(this.doc, `Release ${release.number} is live`, this.target);
      }
      content = this.link; this.words = null;
    } else {
      this.words ??= this.doc.createElement('span'); this.words.textContent = `Release ${release.number} is starting`;
      content = this.words; this.link = null; this.target = null;
    }
    // Keep the dismiss control attached across a phase transition; replacing
    // the whole notice would remove a control the person may have focused.
    if (content !== previous) { host.insertBefore(content, this.close); previous?.remove(); }
  }

  route(release) { return { kind: 'topic', id: RELEASES_TOPIC, ...(release.dossier ? { message: release.dossier } : {}) }; }
  upgrade(release) {
    if (!this.link || !release.dossier) return;
    this.target.route = this.route(release); this.link.href = routeHref(this.target.route);
  }
  dismiss() { this.host?.remove(); this.host = null; this.link = null; this.target = null; this.words = null; this.close = null; this.shown = null; }
  dispose() { this.disposed = true; this.dismiss(); }
}

// One observation owner survives in-place page navigation and session renewal.
// A new actor/instance gets a different cache; no unrelated storage is cleared.
export function releaseToastsFor(doc, instanceId, actor) {
  let owner = owners.get(doc);
  if (!owner || owner.disposed || owner.instanceId !== instanceId || owner.actor !== actor) {
    owner?.dispose(); owner = new ReleaseToasts({ doc, instanceId, actor }); owners.set(doc, owner);
  }
  return owner;
}

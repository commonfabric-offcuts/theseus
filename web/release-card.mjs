// Core owns release truth; this component retains its displayed revision.
const owners = new WeakMap();
const states = new Set(['going_out', 'live', 'measured', 'failed', 'unknown']);
const positive = value => Number.isSafeInteger(value) && value > 0;
const contains = (host, node) => Boolean(node && (host === node || host.contains?.(node)));

export function releaseCardObservation(item) {
  const value = item?.release_card, payload = value?.payload;
  const id = item?.id ?? item?.source_ref?.id;
  const revision = item?.revision ?? item?.version ?? item?.source_ref?.revision ?? item?.current_revision ?? 1;
  if (!value || value.format !== 'release-card-v1' || value.message_id !== id ||
      !positive(value.revision) || value.revision !== revision || !positive(payload?.release) ||
      !states.has(payload.state) || !/^[0-9a-f]{40}$/.test(payload.commit ?? '')) return null;
  if (['live', 'measured'].includes(payload.state) && (!positive(value.deployed_ms) ||
      typeof value.deployed_at !== 'string' || Date.parse(value.deployed_at) !== value.deployed_ms)) return null;
  return value;
}

export function releaseReadingProtected(host) {
  const doc = host.ownerDocument;
  if (contains(host, doc?.activeElement)) return true;
  const selection = doc?.getSelection?.();
  return Boolean(selection && !selection.isCollapsed &&
    (contains(host, selection.anchorNode) || contains(host, selection.focusNode)));
}

function label(value) {
  const payload = value.payload;
  const phase = ({ going_out: 'Going out', failed: 'Failed', unknown: 'Unconfirmed' })[payload.state];
  return `Release ${payload.release} · ${phase ?? `${payload.state === 'measured' ? 'Measured · live' : 'Live'} at ${value.deployed_at}`}`;
}

export function disposeReleaseCard(host) {
  const held = owners.get(host);
  if (!held) return;
  held.pending = null; held.disposed = true; held.root.remove(); owners.delete(host);
}

function owner(host, item, options = {}) {
  const observation = releaseCardObservation(item);
  let held = owners.get(host);
  if (!observation) return null;
  if (held && held.value.message_id !== observation.message_id) {
    disposeReleaseCard(host); held = null;
  }
  if (!held) {
    const doc = host.ownerDocument;
    const root = doc.createElement('div'); root.className = 'release-card-state';
    const words = doc.createElement('span'); words.className = 'muted';
    const update = doc.createElement('button'); update.type = 'button'; update.hidden = true;
    root.append(words, update);
    held = { root, words, update, value: observation, pending: null, options };
    update.addEventListener('click', event => {
      event.preventDefault(); event.stopPropagation();
      const pending = held.pending;
      if (held.disposed || owners.get(host) !== held || !pending || pending.current?.() === false || !host.isConnected) return;
      held.pending = null; update.hidden = true;
      pending.apply(); host.focus?.({ preventScroll: true });
    });
    // The button owns its keys; Return must not quote or open its parent card.
    update.addEventListener('keydown', event => {
      if (event.key === 'Enter' || event.key === ' ') event.stopPropagation();
    });
    (options.mount ?? (node => host.append(node)))(root);
    owners.set(host, held);
  }
  return held;
}

export function paintReleaseCard(host, item, options = {}) {
  const observation = releaseCardObservation(item);
  if (!observation) {
    disposeReleaseCard(host); return null;
  }
  const held = owner(host, item, options);
  if (observation.revision < held.value.revision) return held.root;
  held.value = observation; held.options = options;
  const text = label(observation);
  if (held.words.textContent !== text) held.words.textContent = text;
  if (!held.pending || held.pending.revision <= observation.revision) {
    held.pending = null; held.update.hidden = true;
  }
  return held.root;
}

// True means retain the existing displayed words. The normal source painter
// applies unprotected revisions, so their maps and quotes keep one owner.
export function deferReleaseCard(host, item, apply, options = {}) {
  if (!item?.release_card) return false;
  const observation = releaseCardObservation(item);
  if (!observation) return true;
  const held = owner(host, item, options);
  if (observation.revision < held.value.revision ||
      held.pending && observation.revision < held.pending.revision) return true;
  if (observation.revision === held.value.revision && !held.pending) return false;
  if (options.force || !(options.protect?.() || releaseReadingProtected(host))) return false;
  held.pending = { revision: observation.revision, apply, current: options.current };
  held.update.textContent = `Show release update ${observation.revision}`;
  held.update.hidden = false;
  return true;
}

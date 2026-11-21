// Local, durably kept work; Core's records/maps/cursors are never changed.
const documents = new WeakMap();
const ownerKey = owner => JSON.stringify([owner.instanceId, owner.actor, owner.authority]);
export function closingTopics(doc = globalThis.document) {
  if (!doc || typeof doc !== 'object') return null;
  if (documents.has(doc)) return documents.get(doc);
  let owner = null, key = null;
  const rows = new Map(), listeners = new Set();
  const notify = row => {
    for (const entry of [...listeners]) {
      const rail = entry.owner.deref();
      if (!rail || entry.connected && rail.host?.isConnected === false) { listeners.delete(entry); continue; }
      entry.connected ||= rail.host?.isConnected === true;
      entry.changed(rail, row);
    }
  };
  const prune = () => {
    for (const entry of [...listeners]) {
      const rail = entry.owner.deref();
      if (!rail || entry.connected && rail.host?.isConnected === false) listeners.delete(entry);
      else entry.connected ||= rail.host?.isConnected === true;
    }
  };
  // Persistent outline rails survive app runs; retired page rails do not.
  // Weak owners and document-scoped removal observation cover both lifetimes.
  if (doc.documentElement && typeof MutationObserver === 'function') {
    const observer = new MutationObserver(prune);
    observer.observe(doc.documentElement, { childList: true, subtree: true });
    doc.defaultView?.addEventListener('pagehide', event => { if (event.isTrusted) observer.disconnect(); });
  }
  const projection = {
    configure(value) {
      const next = ownerKey(value);
      if (key === next) return;
      const before = [...rows.values()]; rows.clear(); owner = structuredClone(value); key = next;
      for (const row of before) notify(row);
    },
    set(row) {
      if (!owner || row.instanceId !== owner.instanceId || row.actor !== owner.actor || JSON.stringify(row.authority) !== JSON.stringify(owner.authority)) return;
      const id = row.id;
      if (['rejected', 'undone'].includes(row.phase)) rows.delete(id); else rows.set(id, structuredClone(row));
      notify(row);
    },
    project(instanceId, workspaceId, items) {
      if (owner?.instanceId !== instanceId) return items;
      return items.filter(item => {
        const relevant = [...rows.values()].filter(row => row.workspaceId === workspaceId && row.topic.id === item.id);
        return relevant.every(row => {
        if (row.phase !== 'committed') return false;
        const result = row.receipt?.result;
        // A later authoritative change always wins. A read showing this
        // receipt may display the topic in its real Done/Archived group.
        if (Number.isSafeInteger(item.version) && item.version > result.version) return true;
        return row.envelope.args.archived === true ? item.archived === true : item.state === 'done';
        });
      });
    },
    subscribe(rail, changed) {
      const entry = { owner: typeof WeakRef === 'function' ? new WeakRef(rail) : { deref: () => rail }, changed, connected: rail.host?.isConnected === true };
      listeners.add(entry); return () => listeners.delete(entry);
    },
  };
  documents.set(doc, projection); return projection;
}
export const projectClosingTopics = (instanceId, workspaceId, items, doc = globalThis.document) =>
  closingTopics(doc)?.project(instanceId, workspaceId, items) ?? items;

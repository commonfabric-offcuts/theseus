// Messages that arrived during this document's visit, not a second read state.
// Shared modules survive in-place topic navigation; a reload gets a new document.
const visits = new WeakMap();
export function visitNewFor(doc, { instanceId, actor, authority }) {
  const key = JSON.stringify([instanceId, actor, authority?.authority_id, authority?.authority_epoch]);
  let visit = visits.get(doc);
  if (visit?.key !== key) { visit = { key, marks: new VisitNew(actor) }; visits.set(doc, visit); }
  return visit.marks;
}

export class VisitNew {
  constructor(reader) { this.reader = reader; this.arrivals = new Set(); this.handled = new Set(); }
  has(id) { return this.arrivals.has(id); }
  // Only accepted live pages call this; startup, older history and moved dossiers
  // are not arrivals. A repeated answer never restores a mark the person cleared.
  arrive(items) {
    for (const item of items) if (item.author_id !== this.reader && !this.handled.has(item.id)) this.arrivals.add(item.id);
  }
  clear(id) {
    this.handled.add(id);
    return this.arrivals.delete(id);
  }
}

export function paintVisitNew(entry, host, marked) {
  const [previous, ...duplicates] = entry.querySelectorAll('.message-visit-new');
  for (const duplicate of duplicates) duplicate.remove();
  if (!marked || !host) { previous?.remove(); return; }
  const label = previous ?? host.ownerDocument.createElement('span');
  if (!previous) { label.className = 'message-visit-new'; label.textContent = 'new'; }
  if (label.parentElement !== host) host.append(label);
}

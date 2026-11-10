// The order a person keeps their outcomes in, and each outcome's topics
// (docs/outline-order.md). Core keeps it for them alone (outline.order_set)
// and hands it back on every outcome list and topic list (`order`). What the
// outline shows is worked out here, from what Core lists and what the person
// placed:
//
// - what they placed keeps their order;
// - what they never placed goes where it goes today relative to the rest:
//   right after whatever Core lists just before it (or first, when nothing
//   is), so a new outcome or topic never moves the placed ones around;
// - what Core no longer lists (gone, left, archived out of the list) simply
//   drops out, and an id this page does not know is passed over.
//
// Nothing else moves a row: only the person's own move changes the order.

// Ids in the order to show: saved ones first in their order, each unplaced
// one right after the one listed before it.
export function placeIn(listed, saved = []) {
  const present = new Set(listed), seen = new Set(), out = [];
  for (const id of saved) if (present.has(id) && !seen.has(id)) { out.push(id); seen.add(id); }
  if (!out.length) return [...listed];
  let previous = null;
  for (const id of listed) {
    if (!seen.has(id)) { out.splice(previous === null ? 0 : out.indexOf(previous) + 1, 0, id); seen.add(id); }
    previous = id;
  }
  return out;
}

// Items (each with an id) in the order to show.
export function arrangeItems(items, saved) {
  const byId = new Map(items.map(item => [item.id, item]));
  return placeIn(items.map(item => item.id), saved).map(id => byId.get(id));
}

// The order shown after moving id one place (delta -1 up, +1 down), or null
// when it cannot move that way. visible: the ids on screen, when some are not
// (only what is new is shown, say): id then trades places with the next one
// on screen, and those out of sight between stay where they are.
export function moved(shown, id, delta, visible = null) {
  const at = shown.indexOf(id);
  if (at < 0 || ![-1, 1].includes(delta)) return null;
  let to = at + delta;
  while (visible && to >= 0 && to < shown.length && !visible.has(shown[to])) to += delta;
  if (to < 0 || to >= shown.length) return null;
  const next = [...shown];
  [next[at], next[to]] = [next[to], next[at]];
  return next;
}

// What to save once the person has placed what is shown: everything shown,
// in its order, and what an earlier save placed that is not shown here (a
// page not loaded on this device, say) kept after the place it had, at most
// max places in all.
export function toSave(previous, shown, max = 500) {
  const kept = new Set(shown), listed = [...previous, ...shown.filter(id => !previous.includes(id))];
  const whole = placeIn(listed, shown);
  // Over the bound, what this page does not show goes first, then the end of the list.
  return whole.length <= max ? whole : [...whole.filter(id => kept.has(id)), ...whole.filter(id => !kept.has(id))].slice(0, max);
}

// The order Core sent, or null when it sent none (an older Core). A shape
// with more than it knows is read for what it knows; one it cannot read is
// refused, as the rest of the list would be.
export function orderOf(answer) {
  if (!answer || !Object.hasOwn(answer, 'order')) return null;
  const order = answer.order;
  if (!order || typeof order !== 'object' || !Array.isArray(order.ids) || !order.ids.every(id => typeof id === 'string' && id) ||
      !Number.isSafeInteger(order.revision) || order.revision < 0) throw Error('The saved order could not be confirmed.');
  return { ids: [...order.ids], revision: order.revision };
}

// Where a row went, in words a screen reader says.
export const movedWords = (title, at, of) => `${title} moved to ${at} of ${of}`;

const OUTCOMES = 'outcomes';
export const scopeOf = (workspaceId = null) => workspaceId === null ? OUTCOMES : `topics:${workspaceId}`;

// The orders this page knows, one per scope (the outcomes, or one outcome's
// topics), as Core last said or as the person just moved them. One book for
// the whole visit: the page's own topic list and the outline's read the same
// one, so a move shows wherever that list is drawn. A move shows at once and
// is sent in the background, one request per scope at a time; moves made
// while one is out go together in the next, fenced on the revision the one
// before it got.
export class OrderBook {
  constructor() { this.scopes = new Map(); this.listeners = new Set(); this.undos = []; }
  entry(scope) {
    if (!this.scopes.has(scope)) this.scopes.set(scope, { ids: [], revision: 0, pending: null, sending: null, envelopes: new Map() });
    return this.scopes.get(scope);
  }
  ids(scope) { const entry = this.scopes.get(scope); return entry ? entry.pending ?? entry.ids : []; }
  // A listener hears every change: (scope) => void. host: a part of the page;
  // once it has left the page its listener goes.
  listen(listener, host = null) { const held = { listener, host }; this.listeners.add(held); return () => this.listeners.delete(held); }
  emit(scope) {
    for (const held of [...this.listeners]) {
      if (held.host && !held.host.isConnected) { this.listeners.delete(held); continue; }
      held.listener(scope);
    }
  }
  // What a read said. A newer revision replaces what was known; a move not
  // yet confirmed stays shown over it.
  learn(scope, order) {
    if (!order) return false;
    const entry = this.entry(scope);
    if (order.revision < entry.revision || (order.revision === entry.revision && JSON.stringify(order.ids) === JSON.stringify(entry.ids))) return false;
    entry.ids = [...order.ids]; entry.revision = order.revision;
    this.emit(scope);
    return true;
  }
  // The person moved a row: shown is the order on screen after the move, and
  // before the order on screen before it, which Undo puts back (null: no
  // Undo, as for an Undo itself). send({ ids, revision, operation }, scope)
  // answers Core's receipt, through the run that is up. Settles with what
  // happened: { saved }, { conflict }, or { failed: error }.
  place(scope, shown, send, before = null) {
    const entry = this.entry(scope);
    entry.pending = toSave(this.ids(scope), shown);
    if (before) this.undos.push({ scope, ids: [...before] });
    this.emit(scope);
    entry.sending ??= this.flush(scope, send);
    return entry.sending;
  }
  // The last move put back, as a move of its own: { scope, ids } or null.
  undo() { return this.undos.pop() ?? null; }
  forget() { this.undos = []; }
  async flush(scope, send) {
    const entry = this.entry(scope);
    let outcome = { saved: true };
    // Whatever send does, it does once place has kept this flush as the one under way.
    await null;
    try {
      while (entry.pending && JSON.stringify(entry.pending) !== JSON.stringify(entry.ids)) {
        const ids = entry.pending, name = JSON.stringify([ids, entry.revision]);
        // The same order at the same revision is the same request, so one sent
        // again after a lost answer is answered with what Core recorded.
        if (!entry.envelopes.has(name)) entry.envelopes.set(name, { ids, revision: entry.revision, operation: crypto.randomUUID() });
        const receipt = await send(entry.envelopes.get(name), scope);
        if (receipt?.status === 'committed') {
          entry.envelopes.delete(name);
          entry.ids = [...receipt.result.ids]; entry.revision = receipt.result.order_revision;
          if (JSON.stringify(entry.pending) === JSON.stringify(entry.ids)) entry.pending = null;
          continue;
        }
        // Changed on another device since it was read: what shows goes back to
        // what this page last knew, and the caller reads the order again.
        entry.pending = null;
        outcome = receipt?.error?.code === 'REVISION_CONFLICT' ? { conflict: true } : { failed: Error(receipt?.error?.message ?? 'Theseus did not confirm the order.') };
      }
      entry.pending = null;
    } catch (error) { entry.pending = null; outcome = { failed: error }; }
    finally { entry.sending = null; this.emit(scope); }
    return outcome;
  }
}

// The one book for the whole visit (modules load once; docs/rails.md).
export const book = new OrderBook();

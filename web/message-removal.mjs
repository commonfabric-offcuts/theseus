import { timeNode } from './times.mjs';
const paintedRemovals = new WeakMap();

export async function readRemoval(read, id) {
  let source;
  try { source = await read('source', { kind: 'message', id }); }
  catch (error) {
    if ((error?.details?.error ?? error?.error ?? error)?.code === 'FORBIDDEN') return { kind: 'unsent' };
    throw error;
  }
  if (source?.error?.code === 'FORBIDDEN') return { kind: 'unsent' };
  if (!source?.removal) throw Error('The message removal has not arrived yet.');
  return source.removal;
}

// Core chooses the irreversible act from its exposure record. A menu never
// guesses from unread state, delivery state or what this device has loaded.
export function removalItem(item, rights, remove) {
  if (!item || item.removal || item.author_id !== rights.actor || rights.actorKind !== 'human' ||
      rights.unavailable || rights.reached || !['unsend', 'retract'].includes(item.removal_action)) return null;
  return { label: item.removal_action === 'unsend' ? 'Unsend' : 'Retract', glyph: 'undo', act: () => remove(item) };
}

export function paintRemoval(line, item, doc = line.ownerDocument, first = false) {
  let label = line.querySelector('.message-retracted');
  if (item?.removal?.kind !== 'retracted') { label?.remove(); return; }
  if (!label) { label = doc.createElement('span'); label.className = 'message-retracted'; }
  const key = JSON.stringify([item.removal.at_ms, first]);
  if (paintedRemovals.get(label) === key && label.parentElement === line) return;
  paintedRemovals.set(label, key);
  label.replaceChildren(first ? 'Retracted · ' : ' · Retracted · ', timeNode(item.removal.at_ms, doc), first ? ' · ' : '');
  if (first) line.prepend(label); else line.append(label);
}

export class Removals {
  constructor({ api, instanceId, authority, learned = () => {}, say = () => {}, current = () => true, recorded = () => {}, refresh = () => {} }) {
    Object.assign(this, { api, instanceId, authority, learned, say, current, recorded, refresh });
    this.pending = new Map(); this.busy = new Set();
  }
  async remove(item) {
    if (!this.current() || this.busy.has(item.id)) return null;
    let request = this.pending.get(item.id);
    if (!request) {
      if (!['unsend', 'retract'].includes(item.removal_action) || item.removal) return null;
      const { authority_id, authority_epoch } = this.authority();
      request = { v: 1, instance_id: this.instanceId, operation_id: crypto.randomUUID(), kind: 'message.' + item.removal_action,
        target: { message_id: item.id }, expected: { authority: { authority_id, authority_epoch } }, args: {} };
      this.pending.set(item.id, request);
    }
    const label = request.kind === 'message.unsend' ? 'Unsend' : 'Retract';
    this.busy.add(item.id); this.say(label === 'Unsend' ? 'Unsending…' : 'Retracting…', item);
    try {
      const receipt = await this.api.command(request);
      if (receipt?.status === 'committed' && receipt.result?.message_id === item.id && receipt.result.removal) {
        this.pending.delete(item.id);
        if (this.current()) { this.learned(receipt.result); this.say(label === 'Unsend' ? 'Message unsent.' : 'Message retracted.', item); this.recorded(receipt); }
        return receipt;
      }
      if (receipt?.recorded === true || receipt?.error?.code === 'MESSAGE_SEEN') this.pending.delete(item.id);
      if (this.current()) {
        if (receipt?.error?.code === 'MESSAGE_SEEN') { item.removal_action = 'retract'; this.refresh(item); }
        this.say(receipt?.error?.message ?? `Whether the message was removed is unknown. Press ${label} again.`, item);
      }
      return null;
    } catch {
      if (this.current()) this.say(`Whether the message was removed is unknown. Press ${label} again.`, item);
      return null;
    } finally { this.busy.delete(item.id); }
  }
}

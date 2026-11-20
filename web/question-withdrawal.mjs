// Item 366: a separate act on one's own question, in the existing message menus.
export function withdrawalItem(item, rights, withdraw) {
  if (!item || item.intent !== 'ask' || item.whisper || item.withdrawal || item.removal || item.author_id !== rights.actor || rights.unavailable || rights.reached) return null;
  return { label: 'Withdraw question', glyph: 'undo', act: () => withdraw(item) };
}
export function paintWithdrawal(line, item, doc = line.ownerDocument, first = false) {
  let mark = line.querySelector('.question-withdrawn');
  if (!item?.withdrawal) { mark?.remove(); return; }
  if (!mark) { mark = doc.createElement('span'); mark.className = 'question-withdrawn'; mark.textContent = first ? 'Question withdrawn · ' : ' · Question withdrawn'; if (first) line.prepend(mark); else line.append(mark); }
}
// Withdrawal is permanent: an earlier read never puts the ask back.
export function learnWithdrawal(item, value) {
  if (item && value) item.withdrawal = value;
}

export class Withdrawals {
  constructor({ api, instanceId, authority, learned = () => {}, say = () => {}, current = () => true, recorded = () => {} }) {
    Object.assign(this, { api, instanceId, authority, learned, say, current, recorded });
    this.pending = new Map(); this.busy = new Set();
  }
  async withdraw(item) {
    if (!this.current() || this.busy.has(item.id)) return null;
    let request = this.pending.get(item.id);
    if (!request) {
      const { authority_id, authority_epoch } = this.authority();
      request = { v: 1, instance_id: this.instanceId, operation_id: crypto.randomUUID(), kind: 'message.withdraw',
        target: { message_id: item.id }, expected: { authority: { authority_id, authority_epoch } }, args: {} };
      this.pending.set(item.id, request);
    }
    this.busy.add(item.id); this.say('Withdrawing question…', item);
    try {
      const receipt = await this.api.command(request);
      if (receipt?.status === 'committed' && receipt.result?.message_id === item.id && receipt.result.withdrawal) {
        this.pending.delete(item.id);
        if (this.current()) { this.learned(receipt.result); this.say('Question withdrawn.', item); this.recorded(receipt); }
        return receipt;
      }
      if (receipt?.recorded === true) this.pending.delete(item.id);
      if (this.current()) this.say(receipt?.error?.message ?? 'Whether the question was withdrawn is unknown. Press Withdraw question again.', item);
      return null;
    } catch {
      if (this.current()) this.say('Whether the question was withdrawn is unknown. Press Withdraw question again.', item);
      return null;
    } finally { this.busy.delete(item.id); }
  }
}

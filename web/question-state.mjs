// Core owns the question. Terminal facts survive older cover/source reads.
import { linkNode } from './links.mjs';
import { timeNode } from './times.mjs';

export const terminalQuestion = value => ['resolved', 'superseded', 'withdrawn'].includes(value?.state);
export class QuestionStates {
  constructor() { this.closed = new Map(); }
  learn(id, value) {
    if (id && terminalQuestion(value) && !this.closed.has(id)) this.closed.set(id, value);
    return this.closed.get(id) ?? value;
  }
  of(item) {
    const id = item?.id ?? item?.source_ref?.id;
    return this.learn(id, item?.withdrawal ? { state: 'withdrawn', waiting_on: [], may_resolve: false, ...item.withdrawal } : item?.question);
  }
  cover(cover) {
    if (!cover?.waiting?.some(wait => this.closed.has(wait.ask_id ?? wait.message_id))) return cover;
    return { ...cover, waiting: cover.waiting.filter(wait => !this.closed.has(wait.ask_id ?? wait.message_id)) };
  }
}
let states = null;
export const configureQuestionStates = value => { states = value; };
export const questionOf = item => states?.of(item) ?? item?.question;
export const currentQuestionCover = cover => states?.cover(cover) ?? cover;

export function questionPill(doc, item, { nameOf = id => id, resolve = null, busy = false } = {}) {
  const question = questionOf(item);
  if (!question || question.state === 'withdrawn' || question.state === 'answered') return null;
  const node = doc.createElement(question.state === 'waiting' && question.may_resolve && resolve ? 'button' : 'span');
  node.className = 'question-state';
  if (question.state === 'waiting') {
    node.className += ' row-pill pill-waits';
    node.textContent = `Waiting on ${question.waiting_on.map(nameOf).join(', ')}`;
    if (question.may_resolve && resolve) {
      node.type = 'button'; node.disabled = busy;
      node.title = 'Mark this question resolved'; node.setAttribute('aria-label', `${node.textContent}. Mark resolved`);
      node.onclick = () => resolve(item.id ?? item.source_ref.id);
    }
  } else if (question.state === 'resolved') {
    node.append(`Resolved · by ${nameOf(question.by)} · `, timeNode(question.at_ms, doc));
  } else if (question.state === 'superseded') {
    node.append(linkNode(doc, 'Superseded by a later question', { route: { kind: 'topic', id: item.topic_id, message: question.superseded_by }, written: true }));
  }
  return node;
}

export class Resolutions {
  constructor({ api, instanceId, authority, learned = () => {}, say = () => {}, current = () => true, recorded = () => {} }) {
    Object.assign(this, { api, instanceId, authority, learned, say, current, recorded });
    this.pending = new Map(); this.busy = new Set();
  }
  async resolve(id) {
    if (!this.current() || this.busy.has(id)) return null;
    let request = this.pending.get(id);
    if (!request) {
      const { authority_id, authority_epoch } = this.authority();
      request = { v: 1, instance_id: this.instanceId, operation_id: crypto.randomUUID(), kind: 'message.resolve',
        target: { message_id: id }, expected: { authority: { authority_id, authority_epoch } }, args: {} };
      this.pending.set(id, request);
    }
    this.busy.add(id); this.say('Resolving question…', id);
    try {
      const receipt = await this.api.command(request);
      if (receipt?.instance_id === this.instanceId && receipt.status === 'committed' && receipt.result?.message_id === id && receipt.result.question?.state === 'resolved') {
        this.pending.delete(id);
        if (this.current()) { this.learned(receipt.result); this.say('Question resolved.', id); this.recorded(receipt); }
        return receipt;
      }
      if (receipt?.instance_id === this.instanceId && receipt.recorded === true) this.pending.delete(id);
      if (this.current()) this.say(receipt?.error?.message ?? 'Resolution is unconfirmed. Press the Waiting on pill again to retry.', id);
      return null;
    } catch {
      if (this.current()) this.say('Resolution is unconfirmed. Press the Waiting on pill again to retry.', id);
      return null;
    } finally { this.busy.delete(id); }
  }
}

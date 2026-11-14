// Thumbs-up and go-ahead answers on a message (docs/thumbs.md).
//
// A thumbs-up says "I read it and I understand", never "do it". An Ask an
// agent marks as asking for a go-ahead offers the people it asks ✅ (go ahead)
// and 🚫 (don't), one tap each. Core keeps every one on the message; this
// module keeps what the page has read of them, sends the person's own, and
// paints the small line each card carries.

const EMPTY = Object.freeze({ version: 0, thumbs: [], answers: [], thumb_revision: 0, answer_revision: 0 });
const integer = n => Number.isSafeInteger(n) && n >= 0;
const node = (doc, tag, text, className) => {
  const element = doc.createElement(tag); if (text !== undefined) element.textContent = text;
  if (className) element.className = className; return element;
};
export const ANSWER_WORDS = { yes: '✅ Go ahead', no: "🚫 Don't" };

// What a message's reactions say for one reader, from its item or source.
export function reactionsOf(item) {
  const value = item?.reactions;
  if (value === undefined) return EMPTY;
  if (!value || !integer(value.version) || !Array.isArray(value.thumbs) || !Array.isArray(value.answers) ||
      !integer(value.thumb_revision) || !integer(value.answer_revision)) throw Error('The reactions on this message are malformed.');
  return value;
}
// Whether the reader may thumb it: anyone's message but their own.
export const mayThumb = (item, viewer) => Boolean(item) && item.author_id !== viewer;
// Whether the reader may answer it: a person it asks for a go-ahead.
export const mayAnswer = (item, viewer, kind) => item?.go_ahead === true && kind === 'human' &&
  Array.isArray(item.addressees) && item.addressees.includes(viewer);
export const thumbed = (item, viewer) => reactionsOf(item).thumbs.some(thumb => thumb.actor_id === viewer);
export const answerOf = (item, viewer) => reactionsOf(item).answers.find(answer => answer.actor_id === viewer)?.answer ?? null;

// The card's own line: a count of thumbs-up with their names on hover (where
// nothing hovers, a phone, the lit card's count reads the names instead), and
// for a go-ahead ask, the answers given and, for a person it asks, the two
// choices. Each part is a word inside the card, never a control of its own
// (a card is a button); a press on one is taken by MessageMenu, which also
// offers every act as a real button in the bar over the lit card.
export function paintReactions(card, item, viewer, kind, doc = card.ownerDocument) {
  const value = reactionsOf(item), answerable = mayAnswer(item, viewer, kind);
  const key = JSON.stringify([value.version, item.go_ahead === true, answerable, value.thumbs.map(t => t.actor_id)]);
  let line = card.querySelector(':scope > .message-reactions');
  if (line?.dataset.key === key) return;
  const empty = !value.thumbs.length && !item.go_ahead;
  if (empty) { line?.remove(); return; }
  if (!line) { line = node(doc, 'span', undefined, 'message-reactions'); card.append(line); }
  line.dataset.key = key; line.replaceChildren();
  if (value.thumbs.length) {
    const names = value.thumbs.map(thumb => thumb.actor_id === viewer ? 'you' : thumb.actor_id);
    const count = node(doc, 'span', '👍 ', 'reaction-count');
    count.append(node(doc, 'span', String(value.thumbs.length), 'reaction-number'), node(doc, 'span', names.join(', '), 'reaction-who'));
    count.title = `👍 ${names.join(', ')}: read and understood`;
    if (mayThumb(item, viewer)) count.dataset.react = 'thumb';
    count.classList.toggle('mine', thumbed(item, viewer));
    line.append(count);
  }
  if (item.go_ahead) {
    const mine = answerOf(item, viewer);
    if (answerable) {
      for (const answer of ['yes', 'no']) {
        const choice = node(doc, 'span', ANSWER_WORDS[answer], 'reaction-choice');
        choice.dataset.react = answer; choice.classList.toggle('mine', mine === answer);
        line.append(choice);
      }
    }
    const others = value.answers.filter(answer => answer.actor_id !== viewer || !answerable);
    if (others.length) line.append(node(doc, 'span', others.map(a => `${a.answer === 'yes' ? '✅' : '🚫'} ${a.actor_id === viewer ? 'you' : a.actor_id}`).join(' · '), 'reaction-said'));
    else if (!answerable && !value.answers.length) line.append(node(doc, 'span', 'Asks for a go-ahead', 'reaction-said'));
  }
}

// The Reader's 👍 beside Send, for the message it shows.
export function paintReaderThumb(button, item, viewer, busy = false) {
  const can = Boolean(item) && mayThumb(item, viewer);
  button.hidden = !can;
  if (!can) return;
  const on = thumbed(item, viewer);
  // This is the reader's own action; the message carries the shared count.
  button.textContent = '👍';
  button.setAttribute('aria-pressed', String(on)); button.disabled = busy;
  button.title = on ? 'You said you read and understood it. Press to take it back.' : 'Thumbs-up: read and understood';
  button.setAttribute('aria-label', button.title);
}

// The Reader's quiet line under the message it shows: how many thumbed it up
// and who, whether or not a loaded page holds its card (item 406); its 👍
// beside Send is the reader's own.
export function paintReaderReactions(line, item, viewer) {
  const thumbs = item ? reactionsOf(item).thumbs : [];
  line.hidden = !thumbs.length;
  if (!thumbs.length) { line.replaceChildren(); line.removeAttribute('title'); return; }
  const names = thumbs.map(thumb => thumb.actor_id === viewer ? 'you' : thumb.actor_id).join(', ');
  line.textContent = `👍 ${thumbs.length} ${names}`;
  line.title = `👍 ${names}: read and understood`;
}

// What Core answered of one message's reactions, kept on its loaded item.
export function learnReactions(messages, answer) {
  const item = messages.get(answer.message_id);
  if (!item || (item.reactions?.version ?? 0) > answer.reactions.version) return false;
  const next = { ...item, reactions: answer.reactions };
  if (answer.go_ahead) next.go_ahead = true; else delete next.go_ahead;
  messages.set(item.id, next);
  return true;
}

// Sends the person's own thumbs-up and answers, one at a time per message,
// and reads a message's reactions again after each answer from Core, so the
// page shows what Core holds, whoever else reacted meanwhile. A 👍 given or an
// answer reads its message in Core, clearing the person's mark on it too
// (docs/thumbs.md); a result that cleared one carries the mark's new revision,
// handed to cleared(result) before the card is painted, so it reads at once.
export class Reactions {
  constructor({ api, instanceId, authority, learned = () => {}, recorded = () => {}, cleared = () => {} }) {
    Object.assign(this, { api, instanceId, authority, learned, recorded, cleared });
    this.busy = new Set();
  }
  async read(id) {
    const answer = await this.api.view('reactions', { message_id: id });
    if (answer?.error) throw Error(answer.error.message);
    if (answer?.instance_id !== this.instanceId || answer.message_id !== id) throw Error('The reactions answer is for another message.');
    reactionsOf(answer);
    return answer;
  }
  async send(kind, item, args, expected) {
    if (this.busy.has(item.id)) return null;
    this.busy.add(item.id);
    try {
      const { authority_id, authority_epoch } = this.authority();
      let receipt;
      try {
        receipt = await this.api.command({ v: 1, instance_id: this.instanceId, operation_id: crypto.randomUUID(), kind,
          target: { message_id: item.id }, expected: { ...expected, authority: { authority_id, authority_epoch } }, args });
      } catch (error) { throw Error('Connection interrupted; whether that was saved is unknown. Press again: Core keeps one of each.', { cause: error }); }
      const result = receipt?.status === 'committed' ? receipt.result : null;
      if (result?.message_id === item.id && Number.isSafeInteger(result.mark_revision)) this.cleared(result);
      // Whatever the answer, the message's reactions as Core holds them now.
      try { this.learned(await this.read(item.id)); } catch { /* the next commit reads them again */ }
      if (receipt?.status === 'committed') { this.recorded(receipt); return receipt; }
      if (receipt?.error?.code === 'REVISION_CONFLICT') throw Error('This changed on another tab or device; the message now shows what was saved. Nothing was changed.');
      throw Error(receipt?.error?.message ?? 'That was not confirmed. Press again.');
    } finally { this.busy.delete(item.id); }
  }
  thumb(item, on) {
    return this.send('message.thumb', item, { thumbed: on }, { thumb_revision: reactionsOf(item).thumb_revision });
  }
  answer(item, answer) {
    if (!(answer in ANSWER_WORDS)) throw Error('A go-ahead is answered yes or no.');
    return this.send('message.answer', item, { answer }, { answer_revision: reactionsOf(item).answer_revision });
  }
}

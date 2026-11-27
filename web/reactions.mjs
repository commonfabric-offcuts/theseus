import { timingCall } from './action-timing.mjs';
import { questionOf, terminalQuestion } from './question-state.mjs';
import { revisionOf } from './message-edit-writing.mjs';
// Thumbs-up and go-ahead answers on a message (docs/thumbs.md).
//
// A thumbs-up says "I read it and I understand", never "do it". An Ask an
// agent marks as asking for a go-ahead offers the people it asks ✅ (go ahead)
// and 🚫 (don't), one tap each. Core keeps every one on the message; this
// module keeps what the page has read of them, sends the person's own, and
// paints the small line each card carries.
import { notTaken, NOT_TAKEN } from './api.mjs';

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
export const mayAnswer = (item, viewer, kind) => item?.go_ahead === true && !item.withdrawal && !item.removal && !terminalQuestion(questionOf(item)) && kind === 'human' &&
  Array.isArray(item.addressees) && item.addressees.includes(viewer);
const beforeEdit = (item, thumb) => integer(item?.edited_ms) && integer(thumb.at_ms) && thumb.at_ms < item.edited_ms;
export const currentThumbs = item => reactionsOf(item).thumbs.filter(thumb => !beforeEdit(item, thumb));
const earlierThumbs = item => reactionsOf(item).thumbs.filter(thumb => beforeEdit(item, thumb));
export const thumbed = (item, viewer) => currentThumbs(item).some(thumb => thumb.actor_id === viewer);
export const answerOf = (item, viewer) => reactionsOf(item).answers.find(answer => answer.actor_id === viewer)?.answer ?? null;
const thumbNames = (thumbs, viewer) => thumbs.map(thumb => thumb.actor_id === viewer ? 'you' : thumb.actor_id);

function earlierThumbChip(doc, item, thumbs, viewer, { repeat = null, busy = false } = {}) {
  const mine = mayThumb(item, viewer) && thumbs.some(thumb => thumb.actor_id === viewer);
  const chip = node(doc, mine && repeat ? 'button' : 'span', undefined, 'reaction-count reaction-stale');
  chip.append(node(doc, 'span', '👍', 'reaction-stale-emoji'), doc.createTextNode(' ' + thumbs.length));
  chip.title = 'Thumbed before the latest edit: ' + thumbNames(thumbs, viewer).join(', ');
  chip.setAttribute('aria-label', chip.title);
  if (mine) {
    chip.setAttribute('aria-pressed', 'false');
    if (repeat) {
      chip.type = 'button'; chip.disabled = busy; chip.onclick = repeat;
    } else {
      chip.setAttribute('role', 'button'); chip.tabIndex = 0;
      chip.dataset.react = 'thumb-again';
      // Lighting the card widens its current thumb count on touch. Keep the
      // pointer press on this chip until the click chooses its action.
      chip.onmousedown = event => event.preventDefault();
      chip.onkeydown = event => {
        if (event.key !== 'Enter' && event.key !== ' ') return;
        event.preventDefault(); event.stopPropagation(); chip.click();
      };
    }
  }
  return chip;
}

// The card's own line: a count of thumbs-up with their names on hover (where
// nothing hovers, a phone, the lit card's count reads the names instead), and
// for a go-ahead ask, the answers given and, for a person it asks, the two
// choices. Each part is a word inside the card, never a control of its own
// (a card is a button); a press on one is taken by MessageMenu, which also
// offers every act as a real button in the bar over the lit card.
export function paintReactions(card, item, viewer, kind, doc = card.ownerDocument, pending = null) {
  const value = reactionsOf(item), answerable = mayAnswer(item, viewer, kind);
  const key = JSON.stringify([value.version, item.edited_ms, item.go_ahead === true, Boolean(item.withdrawal), Boolean(item.removal), questionOf(item)?.state, answerable, value.thumbs.map(t => t.actor_id), pending]);
  let line = card.querySelector(':scope > .message-reactions');
  if (line?.dataset.key === key) return;
  const empty = !value.thumbs.length && !item.go_ahead && pending === null;
  if (empty) { line?.remove(); return; }
  if (!line) { line = node(doc, 'span', undefined, 'message-reactions'); card.insertBefore(line, card.querySelector(':scope > .note-corner')); }
  line.dataset.key = key; line.replaceChildren();
  const current = currentThumbs(item), earlier = earlierThumbs(item);
  if (current.length) {
    const names = thumbNames(current, viewer);
    const count = node(doc, 'span', '👍 ', 'reaction-count');
    count.append(node(doc, 'span', String(current.length), 'reaction-number'), node(doc, 'span', names.join(', '), 'reaction-who'));
    count.title = `👍 ${names.join(', ')}: read and understood`;
    if (mayThumb(item, viewer)) count.dataset.react = 'thumb';
    count.classList.toggle('mine', thumbed(item, viewer));
    line.append(count);
  }
  if (earlier.length) line.append(earlierThumbChip(doc, item, earlier, viewer));
  line.append(...answerParts(doc, item, viewer, kind));
  if (pending !== null) {
    const saving = node(doc, 'span', pending ? '👍 Saving…' : '👍 Removing…', 'reaction-pending');
    saving.setAttribute('aria-label', thumbPendingWords(pending));
    saving.setAttribute('role', 'status'); line.append(saving);
  }
}

export const thumbPendingWords = on => on ? 'Saving thumbs-up…' : 'Removing thumbs-up…';
// Pending is distinct from aria-pressed, which always describes recorded truth.
export function paintThumbPending(button, pending = null) {
  if (!button) return;
  if (pending === null) { button.removeAttribute('aria-busy'); delete button.dataset.thumbPending; return; }
  button.setAttribute('aria-busy', 'true'); button.dataset.thumbPending = String(pending);
  button.title = thumbPendingWords(pending); button.setAttribute('aria-label', button.title);
}

// One owner of the decision words, eligibility and recorded answers. A card
// needs spans inside its button; the Reader offers buttons of their own.
function answerParts(doc, item, viewer, kind, { buttons = false, busy = false, answer = () => {}, prior = [] } = {}) {
  if (!item?.go_ahead || item.removal) return [];
  const value = reactionsOf(item), answerable = mayAnswer(item, viewer, kind), mine = answerOf(item, viewer), parts = [];
  if (answerable) for (const name of ['yes', 'no']) {
    // Keep the Reader's controls in place through pending/result repaints.
    const choice = (buttons && prior.find(part => part.dataset.react === name && part.dataset.messageId === item.id))
      || node(doc, buttons ? 'button' : 'span', ANSWER_WORDS[name], 'reaction-choice');
    choice.dataset.react = name; choice.classList.toggle('mine', mine === name);
    if (buttons) {
      choice.type = 'button'; choice.dataset.messageId = item.id;
      choice.setAttribute('aria-pressed', String(mine === name)); choice.disabled = busy;
      choice.onclick = () => answer(item.id, name);
    }
    parts.push(choice);
  }
  const others = value.answers.filter(answer => answer.actor_id !== viewer || !answerable);
  if (others.length) parts.push(node(doc, 'span', others.map(a => `${a.answer === 'yes' ? '✅' : '🚫'} ${a.actor_id === viewer ? 'you' : a.actor_id}`).join(' · '), 'reaction-said'));
  else if (!item.withdrawal && !terminalQuestion(questionOf(item)) && !answerable && !value.answers.length) parts.push(node(doc, 'span', 'Asks for a go-ahead', 'reaction-said'));
  return parts;
}

// The Reader's 👍 beside Send, for the message it shows.
export function paintReaderThumb(button, item, viewer, busy = false, pending = null) {
  const can = Boolean(item) && mayThumb(item, viewer);
  button.hidden = !can;
  if (!can) return;
  const on = thumbed(item, viewer);
  // This is the reader's own action; the message carries the shared count.
  button.textContent = '👍';
  button.setAttribute('aria-pressed', String(on)); button.disabled = busy;
  button.title = on ? 'You said you read and understood it. Press to take it back.' : 'Thumbs-up: read and understood';
  button.setAttribute('aria-label', button.title);
  paintThumbPending(button, pending);
  if (pending !== null) button.textContent = '👍 …';
}

// The Reader's line below the message shares its card's decisions. The
// separate 👍 beside Send remains the reader's own thumbs-up action.
export function paintReaderReactions(line, item, viewer, kind, { busy = false, answer = () => {}, repeat = null } = {}) {
  const doc = line.ownerDocument, thumbs = currentThumbs(item), earlier = earlierThumbs(item), parts = [];
  if (thumbs.length) {
    const names = thumbNames(thumbs, viewer).join(', ');
    parts.push(node(doc, 'span', `👍 ${thumbs.length} ${names}`));
    line.title = `👍 ${names}: read and understood`;
  } else line.removeAttribute('title');
  if (earlier.length) parts.push(earlierThumbChip(doc, item, earlier, viewer, { busy, repeat }));
  parts.push(...answerParts(doc, item, viewer, kind, { buttons: true, busy, answer, prior: [...line.children] }));
  // Reuse a decision button while it still answers this exact source. A
  // result or an unrelated repaint must not replace a control under a press.
  for (const child of [...line.children]) if (!parts.includes(child)) child.remove();
  for (const [index, part] of parts.entries()) if (line.children[index] !== part) line.insertBefore(part, line.children[index] ?? null);
  line.hidden = !parts.length;
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
// reading(id): a read of the message's reactions begins; the function it
// returns is called once it has landed (stack-feed.mjs reading).
export class Reactions {
  constructor({ api, instanceId, viewer, authority, learned = () => {}, recorded = () => {}, cleared = () => {}, reading = () => () => {}, changed = () => {}, current = () => true }) {
    Object.assign(this, { api, instanceId, viewer, authority, learned, recorded, cleared, reading, changed, current });
    this.busy = new Set(); this.pending = new Map();
  }
  async read(id, timing) {
    const landed = this.reading(id);
    const answer = await this.api.view('reactions', { message_id: id }, { timing });
    if (answer?.error) throw Error(answer.error.message);
    if (answer?.instance_id !== this.instanceId || answer.message_id !== id) throw Error('The reactions answer is for another message.');
    reactionsOf(answer);
    landed();
    return answer;
  }
  // said(failure): who says an answer of Theseus's that took nothing (a card's
  // status line), told before the reactions are read again, so that read, begun
  // after it was said, ends it. Without one, or for a failure that reached no
  // Theseus, the failure is thrown, in words of the page's own.
  async send(kind, item, args, expected, said = null, timing = null) {
    if (this.busy.has(item.id)) return null;
    this.busy.add(item.id);
    let current = () => this.current(), learnedConfirmed = false, observation = 'incomplete', observationFailure = 'unknown';
    try {
      const { authority_id, authority_epoch } = this.authority();
      current = () => this.current() && this.authority()?.authority_id === authority_id && this.authority()?.authority_epoch === authority_epoch;
      if (kind === 'message.thumb') { this.pending.set(item.id, args.thumbed); this.changed(item.id, timing, 'thumb_pending_dom'); }
      const operation = crypto.randomUUID();
      timingCall(timing, 'link', operation);
      let receipt = null, failure = null;
      try {
        receipt = await this.api.command({ v: 1, instance_id: this.instanceId, operation_id: operation, kind,
          target: { message_id: item.id }, expected: { ...expected, authority: { authority_id, authority_epoch } }, args }, { timing });
      } catch (error) { failure = { error }; }
      const committed = receipt?.status === 'committed', result = committed ? receipt.result : null;
      if (current() && result?.message_id === item.id && Number.isSafeInteger(result.mark_revision)) this.cleared(result, kind);
      if (!failure && !committed) failure = { receipt };
      const answer = failure && notTaken(failure);
      const thrown = failure && (!said || answer.kind === 'unreached' ? unsaved(failure, answer) : (current() && said(failure), null));
      // Whatever the answer, the message's reactions as Core holds them now.
      try { const value = await this.read(item.id, timing); if (current()) { this.learned(value, kind, timing); learnedConfirmed = committed; } } catch { /* the next commit reads them again */ }
      if (thrown) { observation = 'failed'; observationFailure = 'transport'; throw thrown; }
      if (committed && current()) { this.recorded(receipt); observation = 'complete'; observationFailure = null; return receipt; }
      observation = 'failed'; observationFailure = 'refused';
      return null;
    } finally {
      this.busy.delete(item.id);
      if (this.pending.delete(item.id) && current()) this.changed(item.id, timing, learnedConfirmed ? 'thumb_confirmed_dom' : null);
      if (!current()) timingCall(timing, 'retire');
      else timingCall(timing, 'finish', observation === 'complete' && !timingCall(timing, 'hasEndpoint', 'thumb_confirmed_dom') ? 'incomplete' : observation, observationFailure);
    }
  }
  thumb(item, on, said = null, timing = null) {
    const expected = { thumb_revision: reactionsOf(item).thumb_revision };
    if (on && earlierThumbs(item).some(thumb => thumb.actor_id === this.viewer)) expected.message_revision = revisionOf(item);
    return this.send('message.thumb', item, { thumbed: on }, expected, said, timing);
  }
  answer(item, answer, said = null) {
    if (!(answer in ANSWER_WORDS)) throw Error('A go-ahead is answered yes or no.');
    return this.send('message.answer', item, { answer }, { answer_revision: reactionsOf(item).answer_revision }, said);
  }
}
// A thumbs-up or an answer that did not commit, in the page's own words (api.mjs
// notTaken): a lost connection only when no Theseus answered (lines.mjs says
// that while it lasts), else what Theseus answered.
function unsaved(failure, { kind, why }) {
  const cause = failure.error ?? undefined;
  if (kind === 'unreached') return Error('Connection interrupted; whether that was saved is unknown. Press again: Core keeps one of each.', { cause });
  if (kind === 'conflict') return Error('This changed on another tab or device; the message now shows what was saved. Nothing was changed.', { cause });
  if (kind === 'unconfirmed') return Error(`Not known whether that was saved: ${NOT_TAKEN.unconfirmed}. Press again: Core keeps one of each.`, { cause });
  if (kind === 'refused') return Error(why ? `${why}.` : 'That was not confirmed. Press again.', { cause });
  return Error(`That was not saved: ${NOT_TAKEN[kind]}. Press again: Core keeps one of each.`, { cause });
}

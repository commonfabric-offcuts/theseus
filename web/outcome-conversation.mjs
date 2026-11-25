// Shared reply destinations, asks and saved writing. The conversation is an
// ordinary topic page (835); Core still owns its coordinator and routing rules.
import { WRITING_FIELDS, noWriting } from './editor.mjs';
import { terminalQuestion } from './question-state.mjs';

const element = (doc, tag, props = {}, ...children) => {
  const node = doc.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (key === 'dataset') Object.assign(node.dataset, value); else node[key] = value;
  }
  node.append(...children.filter(child => child !== null && child !== undefined && child !== false));
  return node;
};
// The page paints a card's About line again on every read. A link replaced as the person
// presses it, or while it holds the focus, is lost under them, so a paint
// that would draw the same leaves the row as it is (shows), and its links
// follow with the newest open (follows).
const follows = new WeakMap();
const shows = (host, open, drawn) => {
  follows.set(host, open);
  if (host.dataset.shows === drawn) return true;
  host.dataset.shows = drawn;
  return false;
};
// A link inside a card is a span the card's own click passes over.
const itemLink = (doc, host, words, kind, id) => {
  const link = element(doc, 'span', { className: 'item-link', textContent: words, tabIndex: 0, role: 'link' });
  const follow = event => { event.stopPropagation(); event.preventDefault(); follows.get(host)(kind, id); };
  link.onclick = follow;
  link.onkeydown = event => { if (event.key === 'Enter') follow(event); };
  return link;
};

// Three dots pulsing in turn, in the card's own ink, for an item that waits for
// an answer (item 389): still under reduced motion (aim.css), and named for a
// screen reader and the pointer by words. A topic page draws the same dots on
// the reader's own message until someone replies (item 475, card-reading.mjs).
export function waitingDots(doc, words) {
  const dots = element(doc, 'span', { className: 'item-waiting', title: words }, element(doc, 'span'), element(doc, 'span'), element(doc, 'span'));
  dots.setAttribute('role', 'img'); dots.setAttribute('aria-label', words);
  return dots;
}

// "About fable's message in Agent loop and Codex hosting", above a message
// sent here from another topic, linking back for whoever can open it (I7).
export function paintAbout(card, message, reader, open, doc = document) {
  let line = card.querySelector(':scope > .about-line');
  const about = message?.about;
  if (!about || about.hidden) { line?.remove(); return; }
  if (!line) { line = element(doc, 'span', { className: 'about-line' }); card.prepend(line); }
  const mine = about.author_id === reader;
  if (shows(line, open, JSON.stringify([about, mine]))) return;
  line.replaceChildren(`About ${mine ? 'your' : `${about.author_id}'s`} message in `, itemLink(doc, line, about.topic_title, 'message', about.message_id));
}

// The small "Asks you" label after the author's name, on a card whose ask waits on the reader.
export function paintAsksYou(author, message, waits, reader, doc = document) {
  const previous = author.querySelector(':scope > .asks-you');
  if (message?.withdrawal || message?.removal || terminalQuestion(message?.question) ||
      !(waits ?? []).some(wait => wait.on === reader && wait.ask_message_id === message?.id)) { previous?.remove(); return; }
  if (previous) return;
  const label = element(doc, 'span', { className: 'topic-state mine asks-you', textContent: 'Asks you' });
  author.insertBefore(label, author.querySelector(':scope > .message-time'));
}

// The words for where a reply goes when it is sent from a topic to its
// outcome's conversation: "Tell fable · in the conversation".
export const PLACE = 'the conversation';
// The Reader's To choice on a message in an ordinary topic: this topic, or the outcome's conversation.
export const CONVERSATION_NOTE = coordinator => coordinator
  ? `Goes to the outcome's conversation with a link to this message. ${coordinator} answers there; nobody in this topic is woken.`
  : 'Goes to the outcome\'s conversation with a link to this message; nobody in this topic is woken.';
// Two chips tapped once, "This topic" and "Conversation", each naming its
// place in full on hover; the one the reply goes to now is pressed. The Reader
// follows a tap (reader.mjs). Painted again, chips for the same two places are
// kept and only their pressed state and words change, so the chip just
// chosen keeps the focus.
export function conversationDestination(host, { topic, conversation, outcome, chosen, doc = document }) {
  const at = chosen === conversation ? conversation : topic.id;
  const places = [[topic.id, 'This topic', `This topic: ${topic.title}`], [conversation, 'Conversation', `${outcome} conversation`]];
  const chips = [...host.children];
  if (chips.length !== places.length || places.some(([value], i) => chips[i].dataset?.destination !== value)) {
    host.replaceChildren(...places.map(([value]) => element(doc, 'button', { type: 'button', className: 'choice-chip', dataset: { destination: value } })));
  }
  places.forEach(([value, label, title], i) => {
    const button = host.children[i];
    button.textContent = label; button.title = title;
    button.setAttribute('aria-pressed', String(value === at));
  });
}

// Switching the Reader's To never merges two drafts. The writing is every
// field the editor takes as writing (WRITING_FIELDS) and any image chosen for
// it. When the place left holds writing and the other place holds none, the
// writing moves there whole, as one unit: kept in the other draft first, and
// only then is the draft left emptied, so an interrupted switch leaves it
// where it was. Otherwise nothing moves: the other place's draft opens as it
// is, the writing left stays in its own draft, and the result is true so the
// Reader says so. Images belong to the place they were chosen for, in every
// state (attached, uploading, failed or refused, kept on this device but never
// sent, or an image action under way), so writing with one never moves. An
// image sent with an earlier message belongs to that message, and one removed
// to nobody. keep(editor) keeps an editor's writing on this device.
//
// Writing moves as the Reader showed it, so it is the same message where it
// arrives: the author a reply is offered to counts as named, and a choice of
// the person's goes with it. With no choice the default is a Tell in both
// places (whisper-choice.mjs), and a whisper is never offered the switch, so
// nothing is written down for it.
const NONE = noWriting();
const chosenImage = entry => entry?.selected !== false && entry?.owner?.kind !== 'submission';
const imageIn = editor => Boolean(editor.draft.attachments?.length || editor.imageBusy || editor.imageReservation || editor.adopting ||
  editor.uploadOpaque || editor.uploadState && !(Array.isArray(editor.uploadState.entries) && !editor.uploadState.entries.some(chosenImage)));
const writingIn = editor => imageIn(editor) ||
  WRITING_FIELDS.some(name => name !== 'caret' && JSON.stringify(editor.draft[name] ?? NONE[name]) !== JSON.stringify(NONE[name]));
export const switchWriting = async (left, there, keep) => {
  if (!writingIn(left)) return false;
  if (imageIn(left) || writingIn(there) || there.unavailable || there.conflict || there.authorityRecovery) return true;
  const writing = Object.fromEntries(WRITING_FIELDS.map(name => [name, left.draft[name] ?? NONE[name]]));
  writing.addressees = [...left.offeredAddressees, ...writing.addressees];
  there.receive(writing);
  await keep(there);
  left.edit(noWriting());
  await keep(left);
  return false;
};

// "Answered by": the coordinator, then the rest of the team, each a name
// tapped once. With nobody named the coordinator answers, so theirs is pressed
// and a tap on it changes nothing; a tap on anyone else names them, and a
// second tap takes them off. The reader is not offered to themselves.
export function answererChoices({ coordinator, members, names, reader }) {
  const ids = [...new Set([coordinator, ...members])].filter(id => typeof id === 'string' && id && id !== reader);
  return ids.map(id => {
    const fallback = id === coordinator && names.length === 0;
    return { id, pressed: fallback || names.includes(id), fallback };
  });
}
// Paints those choices into host; toggle(id, on) names or unnames someone,
// and refuses quietly when the writing cannot change now.
// A chip that held focus hands it to the same person's new chip. Returns the
// ids shown, whose plain recipient chips the row then leaves out.
export function paintAnswerers(host, { coordinator, members, names, reader, toggle, doc = document, nameOf = id => id }) {
  const held = doc.activeElement?.parentElement === host ? doc.activeElement.dataset.answerer : undefined;
  const choices = answererChoices({ coordinator, members, names, reader });
  host.replaceChildren(...choices.map(({ id, pressed, fallback }) => {
    const button = element(doc, 'button', { type: 'button', className: 'choice-chip', textContent: nameOf(id), dataset: { answerer: id } });
    button.setAttribute('aria-pressed', String(pressed));
    if (fallback) button.title = `${nameOf(id)} answers when you name nobody`;
    button.onclick = () => { if (!fallback) toggle(id, !pressed); };
    return button;
  }));
  if (held !== undefined) [...host.children].find(button => button.dataset.answerer === held)?.focus();
  return choices.map(choice => choice.id);
}

// An outcome's conversation (docs/conversation.md): the page at
// ?conversation=OUTCOME, which is a topic page like any other (messages
// newest first, the writing box below them), its row in the side rail and on
// the outcome's page, and the small tags on each card that say what became of
// the thing posted. Theseus writes every one of those tags; nothing here
// decides one. New is a plain count the coordinator clears, never a light
// (D5); only Waiting on you lights.
import { timeNode } from './times.mjs';
import { workNote } from './topic-state.mjs';

const element = (doc, tag, props = {}, ...children) => {
  const node = doc.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (key === 'dataset') Object.assign(node.dataset, value); else node[key] = value;
  }
  node.append(...children.filter(child => child !== null && child !== undefined && child !== false));
  return node;
};
const named = (id, reader) => id === reader ? 'you' : id;

export const TITLE = 'Conversation';
export const ROW_WORDS = 'Status, friction, requests';
// The words under the heading: what it is for, and who answers.
export function subtitle(coordinator) {
  return coordinator
    ? `Ask where things stand, or raise a friction or a request. ${coordinator} answers here; others answer only when you name them.`
    : `Ask where things stand, or raise a friction or a request. ${NOBODY_ANSWERS}`;
}
// The writing box, as in any topic, says where the writing goes.
export const placeholder = outcome => `Write to ${outcome}…`;
export const NOBODY_ANSWERS = 'Nobody answers here yet. The outcome\'s owner chooses who does.';

// "a", "a and b", "a, b and c".
const listed = items => items.length < 2 ? items.join('') : `${items.slice(0, -1).join(', ')} and ${items.at(-1)}`;
// The ask's own words (I8), short enough to sit in a tag.
const clipped = (text, max = 60) => typeof text === 'string' && text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text ?? '';

// The waits on the reader, from the conversation view.
export const waitsOnReader = (view, reader) => (view?.waits ?? []).filter(wait => wait.on === reader);

// The small tags at the foot of a card: what became of the thing posted, one
// tag each, with its link and time beside it. Each part is a string, a {time}
// or a {link, topic|message}, and paintItemTags turns them into nodes.
export function itemTags(message, waits, reader) {
  const tags = [];
  const item = message?.item;
  if (item) {
    const takes = Array.isArray(item.takes) ? item.takes : [];
    // Still New: nothing has settled it, though a take may have used part of it.
    if (item.state === 'new') tags.push({ tag: 'New', parts: takes.length ? ['part taken so far'] : [] });
    for (const take of takes) {
      const by = named(take.actor_id, reader);
      if (take.kind === 'answer') {
        tags.push({ tag: 'Answered', parts: [{ link: `${by === 'you' ? 'your' : `${by}'s`} reply`, message: take.ref }, ' · ', { time: take.at_ms }] });
      } else if (take.kind === 'topic') {
        const title = take.readable && typeof take.title === 'string' ? { link: take.title, topic: take.ref } : 'a topic you cannot open';
        tags.push({ tag: 'Taken into a topic', parts: [title, ` · ${by}, `, { time: take.at_ms }] });
      } else if (take.kind === 'pipeline') {
        const numbers = (take.numbers ?? []).map(String);
        tags.push({ tag: 'On the pipeline', parts: [`${take.added ? 'added to' : 'as'} ${listed(numbers)} · ${by}, `, { time: take.at_ms }] });
      }
    }
  }
  // An item can be settled and waiting at once: each wait on it sits beside its takes.
  for (const wait of waits ?? []) {
    if (wait.item_id !== message?.id) continue;
    tags.push({ tag: wait.on === reader ? 'Waiting on you' : `Waiting on ${wait.on}`, mine: wait.on === reader,
      parts: [`${named(wait.by, reader)} asked: `, { link: clipped(wait.excerpt), message: wait.ask_message_id }, ' · ', { time: wait.since_ms }] });
  }
  return tags;
}

// Paints the tags at the foot of one card into its .item-tags row; open(kind, id) follows a link.
export function paintItemTags(card, message, waits, reader, open, doc = document) {
  let host = card.querySelector(':scope > .item-tags');
  const tags = itemTags(message, waits, reader);
  if (!tags.length) { host?.remove(); return; }
  if (!host) { host = element(doc, 'span', { className: 'item-tags' }); card.append(host); }
  host.replaceChildren(...tags.map(tag => element(doc, 'span', { className: 'item-tag-group' },
    element(doc, 'span', { className: tag.mine ? 'item-tag mine' : 'item-tag', textContent: tag.tag }),
    ...(tag.parts.length ? [element(doc, 'span', { className: 'item-detail' }, ...tag.parts.map(part => {
      if (typeof part === 'string') return part;
      if (part.time !== undefined) return Number.isSafeInteger(part.time) ? timeNode(part.time, doc) : '';
      // A link inside a card is a span the card's own click passes over.
      const link = element(doc, 'span', { className: 'item-link', textContent: part.link, tabIndex: 0, role: 'link' });
      const follow = event => { event.stopPropagation(); event.preventDefault(); open(part.topic ? 'topic' : 'message', part.topic ?? part.message); };
      link.onclick = follow;
      link.onkeydown = event => { if (event.key === 'Enter') follow(event); };
      return link;
    }))] : []))));
}

// "About fable's message in Agent loop and Codex hosting", above a message
// sent here from another topic, linking back for whoever can open it (I7).
export function paintAbout(card, message, reader, open, doc = document) {
  let line = card.querySelector(':scope > .about-line');
  const about = message?.about;
  if (!about || about.hidden) { line?.remove(); return; }
  if (!line) { line = element(doc, 'span', { className: 'about-line' }); card.prepend(line); }
  const link = element(doc, 'span', { className: 'item-link', textContent: about.topic_title, tabIndex: 0, role: 'link' });
  const follow = event => { event.stopPropagation(); event.preventDefault(); open('message', about.message_id); };
  link.onclick = follow; link.onkeydown = event => { if (event.key === 'Enter') follow(event); };
  line.replaceChildren(`About ${about.author_id === reader ? 'your' : `${about.author_id}'s`} message in `, link);
}

// The small "Asks you" label after the author's name, on a card whose ask waits on the reader.
export function paintAsksYou(author, message, waits, reader, doc = document) {
  author.querySelector(':scope > .asks-you')?.remove();
  if (!(waits ?? []).some(wait => wait.on === reader && wait.ask_message_id === message?.id)) return;
  const label = element(doc, 'span', { className: 'topic-state mine asks-you', textContent: 'Asks you' });
  author.insertBefore(label, author.querySelector(':scope > .message-time'));
}

// One filter chip above the messages, "Only new (N)": pressed, it leaves out
// every card but the items nothing has settled. It shows only while there is
// something new or it is pressed.
export function paintOnlyNew(host, { view, onlyNew, show, doc = document }) {
  const count = view?.new_items ?? 0;
  let chip = host.querySelector('button');
  if (!chip) { chip = element(doc, 'button', { type: 'button', className: 'filter-chip' }); host.replaceChildren(chip); }
  chip.onclick = () => show(!onlyNew);
  chip.textContent = `Only new (${count})`;
  chip.setAttribute('aria-pressed', String(onlyNew));
  host.hidden = !onlyNew && count === 0;
}

// The empty conversation: what it is for, and the topics it replaced.
export function paintEmpty(host, { view, doc = document }) {
  const coordinator = view?.coordinator?.actor_id;
  const replaced = (view?.replaced ?? []).map(topic => topic.title);
  host.replaceChildren(element(doc, 'p', { textContent: 'Nothing here yet.' }),
    element(doc, 'p', { className: 'muted', textContent: coordinator
      ? `Write below to ask where things stand, or to raise a friction or a request. ${coordinator} answers each one here or takes it into a topic, and the card says which.`
      : `Write below to ask where things stand, or to raise a friction or a request. ${NOBODY_ANSWERS}` }),
    ...(replaced.length ? [element(doc, 'p', { className: 'muted', textContent: replacedWords(replaced) })] : []));
}
// "Friction log was closed …", or "What's live and what's next, and Friction
// log, were closed …": the commas keep titles that hold an "and" apart.
function replacedWords(titles) {
  if (titles.length === 1) return `${titles[0]} was closed when this conversation started. It stays readable under Archived topics.`;
  return `${titles.slice(0, -1).join(', ')}, and ${titles.at(-1)}, were closed when this conversation started. ` +
    `${titles.length === 2 ? 'Both stay' : 'They stay'} readable under Archived topics.`;
}

// The conversation's one row: the outcome's title, its unread count (in the
// addressed style when something was sent by name), "Waiting on you" when a
// wait is on the reader, the work ring, and "Status, friction, requests".
// It paints no New light (D5).
export function paintConversationRow(container, { view, title, reader, current = false, href, open, doc = document }) {
  if (!view) { container.replaceChildren(); return false; }
  const link = element(doc, 'a', { className: 'nav-item conversation-row', href });
  if (current) link.setAttribute('aria-current', 'page');
  const name = element(doc, 'span', { className: 'conversation-name', textContent: title });
  if (view.unread) name.append(element(doc, 'span', { className: view.addressed ? 'unread-count addressed' : 'unread-count', textContent: String(view.unread) }));
  if (view.work?.observed) name.append(element(doc, 'span', { className: 'topic-work', ariaHidden: 'true' }));
  link.append(name);
  if (waitsOnReader(view, reader).length) link.append(element(doc, 'span', { className: 'topic-state mine', dataset: { state: 'waiting' }, textContent: 'Waiting on you' }));
  link.append(element(doc, 'small', { textContent: ROW_WORDS }));
  link.title = workNote(view.work, reader, waitsOnReader(view, reader).length ? 'Waiting on you' : '') || ROW_WORDS;
  link.onclick = event => {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault(); open();
  };
  container.replaceChildren(link);
  return true;
}

// The Reader's To choice on a message in an ordinary topic: this topic, or the outcome's conversation.
export const CONVERSATION_NOTE = coordinator => coordinator
  ? `Goes to the outcome's conversation with a link to this message. ${coordinator} answers there; nobody in this topic is woken.`
  : 'Goes to the outcome\'s conversation with a link to this message; nobody in this topic is woken.';
// Two chips tapped once, "This topic" and "Conversation", each naming its
// place in full on hover; the one the reply goes to now is pressed. The Reader
// follows a tap (reader.mjs).
export function conversationDestination(host, { topic, conversation, outcome, chosen, doc = document }) {
  const at = chosen === conversation ? conversation : topic.id;
  const chip = (value, label, title) => {
    const button = element(doc, 'button', { type: 'button', className: 'choice-chip', textContent: label, title, dataset: { destination: value } });
    button.setAttribute('aria-pressed', String(value === at));
    return button;
  };
  host.replaceChildren(chip(topic.id, 'This topic', `This topic: ${topic.title}`), chip(conversation, 'Conversation', `${outcome} conversation`));
}

// Switching the Reader's To moves the writing: it is carried into the other
// destination's draft first, and the draft it leaves is emptied after, so the
// writing lives in one place and every word goes with each switch. Returns
// the writing for the destination's draft, or null when there is nothing to
// carry. Writing the destination already holds is never lost: words it holds
// that the carried writing does not already contain stay first, and the
// quotes of both are kept once each.
const holdsWords = draft => Boolean(draft?.body?.trim() || draft?.quotes?.length);
// Images belong to the place they were chosen for, so writing with images
// does not move: the switch is refused, saying why, and nothing changes.
export const imagesStay = draft => draft?.attachments?.length
  ? 'Images go where they were chosen. Send or remove them before choosing another place.' : null;
export function carriedWriting(from, to) {
  if (!holdsWords(from)) return null;
  const kept = holdsWords(to) ? to : { body: '', quotes: [] };
  const body = from.body.includes(kept.body) ? from.body : kept.body.includes(from.body) ? kept.body : `${kept.body.trimEnd()}\n\n${from.body}`;
  const quotes = [...kept.quotes ?? []];
  for (const quote of from.quotes ?? []) if (!quotes.some(held => JSON.stringify(held) === JSON.stringify(quote))) quotes.push(quote);
  const caret = body === from.body && from.caret ? { ...from.caret } : { start: body.length, end: body.length };
  return { body, quotes, caret };
}

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
export function paintAnswerers(host, { coordinator, members, names, reader, toggle, doc = document }) {
  const held = doc.activeElement?.parentElement === host ? doc.activeElement.dataset.answerer : undefined;
  const choices = answererChoices({ coordinator, members, names, reader });
  host.replaceChildren(...choices.map(({ id, pressed, fallback }) => {
    const button = element(doc, 'button', { type: 'button', className: 'choice-chip', textContent: id, dataset: { answerer: id } });
    button.setAttribute('aria-pressed', String(pressed));
    if (fallback) button.title = `${id} answers when you name nobody`;
    button.onclick = () => { if (!fallback) toggle(id, !pressed); };
    return button;
  }));
  if (held !== undefined) [...host.children].find(button => button.dataset.answerer === held)?.focus();
  return choices.map(choice => choice.id);
}

// An outcome's conversation (docs/conversation.md): the page at
// ?conversation=OUTCOME, its row in the side rail and on the outcome's page,
// and the lines under each item that say what became of it. Theseus writes
// every one of those lines; nothing here decides one. New is a plain count
// the coordinator clears, never a light (D5); only Waiting on you lights.
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
// The words under the heading. Without a pipeline nothing is put on one.
export function lede(pipeline = false) {
  return pipeline
    ? 'Ask where things stand, or drop in a friction or a request. Each one is taken into a topic, put on the Release pipeline, or answered here, and says which.'
    : 'Ask where things stand, or drop in a friction or a request. Each one is taken into a topic or answered here, and says which.';
}
export const PLACEHOLDER = 'A friction, a request, or ask where things stand…';
export const NOBODY_ANSWERS = 'Nobody answers here yet. The outcome\'s owner chooses who does.';

// "a", "a and b", "a, b and c".
const listed = items => items.length < 2 ? items.join('') : `${items.slice(0, -1).join(', ')} and ${items.at(-1)}`;

// The waits on the reader, from the conversation view.
export const waitsOnReader = (view, reader) => (view?.waits ?? []).filter(wait => wait.on === reader);

// One line under an item: its outlined tag, then plain words and links.
// Each part is a string, a {time} or a {link, to}, and lines() turns them into nodes.
export function itemLines(message, waits, reader) {
  const lines = [];
  const item = message?.item;
  if (item) {
    const takes = Array.isArray(item.takes) ? item.takes : [];
    if (item.state === 'new' && !takes.length) lines.push({ tag: 'New', parts: ['Nothing taken from it yet'] });
    else if (item.state === 'new') {
      const who = [...new Set(takes.map(take => named(take.actor_id, reader)))];
      lines.push({ tag: 'New', parts: [`${listed(who)} ${who.length === 1 && who[0] === 'you' ? 'have' : 'has'} taken parts of it so far:`] });
    }
    for (const take of takes) {
      const by = named(take.actor_id, reader);
      if (take.kind === 'answer') {
        lines.push({ tag: 'Answered', parts: [{ link: `${by === 'you' ? 'your' : `${by}'s`} reply`, message: take.ref }, ' · ', { time: take.at_ms }] });
      } else if (take.kind === 'topic') {
        const title = take.readable && typeof take.title === 'string' ? { link: take.title, topic: take.ref } : 'a topic you cannot open';
        lines.push({ tag: 'Taken into a topic', parts: [title, ` · ${by}, `, { time: take.at_ms }] });
      } else if (take.kind === 'pipeline') {
        const numbers = (take.numbers ?? []).map(String);
        lines.push({ tag: 'On the pipeline', parts: [`${take.added ? 'added to' : 'as'} ${listed(numbers)} · ${by}, `, { time: take.at_ms }] });
      }
    }
  }
  // An item can be settled and waiting at once: each wait on it sits beside its takes.
  for (const wait of waits ?? []) {
    if (wait.item_id !== message?.id) continue;
    const on = wait.on === reader ? 'you' : wait.on;
    lines.push({ tag: wait.on === reader ? 'Waiting on you' : `Waiting on ${wait.on}`, mine: wait.on === reader,
      parts: [`${named(wait.by, reader)} asked ${on}: `, { link: wait.excerpt, message: wait.ask_message_id }, ' · ', { time: wait.since_ms }] });
  }
  return lines;
}

// Paints the lines under one card into its .item-lines block; open(kind, id) follows a link.
export function paintItemLines(card, message, waits, reader, open, doc = document) {
  let host = card.querySelector(':scope > .item-lines');
  const lines = itemLines(message, waits, reader);
  if (!lines.length) { host?.remove(); return; }
  if (!host) { host = element(doc, 'span', { className: 'item-lines' }); card.append(host); }
  host.replaceChildren(...lines.map(line => element(doc, 'span', { className: 'item-line' },
    element(doc, 'span', { className: line.mine ? 'item-tag mine' : 'item-tag', textContent: line.tag }), ' ',
    ...line.parts.map(part => {
      if (typeof part === 'string') return part;
      if (part.time !== undefined) return Number.isSafeInteger(part.time) ? timeNode(part.time, doc) : '';
      // A link inside a card is a span the card's own click passes over.
      const link = element(doc, 'span', { className: 'item-link', textContent: part.link, tabIndex: 0, role: 'link' });
      const follow = event => { event.stopPropagation(); event.preventDefault(); open(part.topic ? 'topic' : 'message', part.topic ?? part.message); };
      link.onclick = follow;
      link.onkeydown = event => { if (event.key === 'Enter') follow(event); };
      return link;
    }))));
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

// The top of the conversation page: who answers, the facts, what waits on the
// reader, and the Show choice. view is the `conversation` view's object.
export function paintConversationHead(host, { view, reader, outcome, openMessage, doc = document }) {
  const coordinator = view?.coordinator?.actor_id;
  const answers = coordinator
    ? element(doc, 'p', { className: 'answers-here' }, element(doc, 'span', { className: 'muted', textContent: 'Answers here: ' }),
      element(doc, 'span', { className: 'chip answerer' }, element(doc, 'strong', { textContent: coordinator }), ' coordinator'),
      element(doc, 'span', { className: 'muted', textContent: ' Others answer only when you name them.' }))
    : element(doc, 'p', { className: 'answers-here muted', textContent: NOBODY_ANSWERS });
  const facts = element(doc, 'p', { className: 'conversation-facts' });
  if (view?.live && Number.isSafeInteger(view.live.release)) {
    facts.append(element(doc, 'strong', { textContent: 'Live:' }), ` release ${view.live.release}`);
    if (Number.isSafeInteger(view.live.deployed_ms)) facts.append(', since ', timeNode(view.live.deployed_ms, doc));
    facts.append(element(doc, 'span', { className: 'fact-gap' }));
  }
  facts.append(element(doc, 'strong', { textContent: 'New here:' }), ` ${view?.new_items ?? 0}`, element(doc, 'span', { className: 'fact-gap' }));
  const mine = waitsOnReader(view, reader);
  // The live topic's activity words, with the reader's waits as its asks.
  const pill = mine.length ? 'Waiting on you' : '';
  facts.append(workNote(view?.work ? { ...view.work, waits: view.work.waits || mine.length > 0 } : null, reader, pill));
  const waiting = mine.length ? element(doc, 'section', { className: 'waiting-on-you', ariaLabel: 'Waiting on you' },
    element(doc, 'h2', { textContent: `Waiting on you (${mine.length})` }),
    element(doc, 'ul', { className: 'waiting-list' }, ...mine.map(wait => {
      const link = element(doc, 'a', { href: '#' + wait.ask_message_id, textContent: `${outcome} conversation` });
      link.onclick = event => { event.preventDefault(); openMessage(wait.ask_message_id); };
      return element(doc, 'li', {}, link, element(doc, 'span', { className: 'muted' }, ` — ${named(wait.by, reader)} asked at `, timeNode(wait.since_ms, doc),
        `: ${wait.excerpt}`));
    }))) : null;
  host.replaceChildren(answers, facts, ...(waiting ? [waiting] : []));
  host.hidden = false;
}

// "Show [Everything] [Only new (N)]": only new hides every card but the items nothing has settled.
export function paintShow(host, { view, onlyNew, show, doc = document }) {
  const words = [[false, 'Everything'], [true, `Only new (${view?.new_items ?? 0})`]];
  if (!host.querySelector('button')) {
    host.replaceChildren(element(doc, 'span', { className: 'muted', textContent: 'Show' }),
      ...words.map(([value]) => { const button = element(doc, 'button', { type: 'button' }); button.onclick = () => show(value); return button; }));
    host.setAttribute('role', 'group'); host.setAttribute('aria-label', 'Show');
  }
  host.querySelectorAll('button').forEach((button, index) => {
    button.textContent = words[index][1]; button.setAttribute('aria-pressed', String(onlyNew === words[index][0]));
  });
  host.hidden = false;
}

// The empty conversation: what it is for, and the topics it replaced.
export function paintEmpty(host, { view, doc = document }) {
  const coordinator = view?.coordinator?.actor_id;
  const replaced = (view?.replaced ?? []).map(topic => topic.title);
  host.replaceChildren(element(doc, 'p', { textContent: 'Nothing here yet.' }),
    element(doc, 'p', { className: 'muted', textContent: coordinator
      ? `Ask where things stand, or drop in a friction or a request. ${coordinator} takes each one into a topic, or answers it here.`
      : lede(false) }),
    ...(replaced.length ? [element(doc, 'p', { className: 'muted',
      textContent: `${listed(replaced)}, ${replaced.length === 1 ? 'was' : 'were'} closed when this conversation started. ${replaced.length === 1 ? 'It stays' : 'Both stay'} readable under Archived topics.` })] : []));
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
export function conversationDestination(select, { topic, conversation, outcome, chosen }) {
  select.replaceChildren(element(document, 'option', { value: topic.id, textContent: `This topic: ${topic.title}` }),
    element(document, 'option', { value: conversation, textContent: `${outcome} conversation` }));
  select.value = chosen === conversation ? conversation : topic.id;
}

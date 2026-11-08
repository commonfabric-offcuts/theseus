// Web addresses in a message's words become links (docs/links.md). The words
// are drawn as text nodes and anchors, never as markup, and only an http or
// https address is ever a link. A link to a place in this Theseus opens here,
// through the page's own navigation; any other opens in a new tab. Clicking a
// link is only that: the card, fold or passage around it is not pressed.
// A topic's id in the words (t-…) is a link too, and a link to a topic or to a
// message in one shows the topic's name once the page knows it.
import { parseRoute, routeHref } from './topic-navigation.mjs';

// An address runs from its scheme to the first space, angle bracket, quote
// mark or ellipsis; what it ends with is then trimmed (see trimmed).
const ADDRESS = /https?:\/\/[^\s<>"'`“”‘’…]+/giu;
// A topic's id as Theseus makes them: t- and 32 lowercase hex digits.
const TOPIC_ID = /t-[0-9a-f]{32}/g;
const WORD = /[\p{L}\p{N}_]/u;
const CLOSERS = { ')': '(', ']': '[', '}': '{' };
const IN_APP = new Set(['root', 'topic', 'workspace', 'conversation', 'pipeline', 'item']);

let opener = null, namer = () => null, shareOrigin = null;
// open(route, title, link): how the page opens one of its own places. Without
// it an in-app link navigates this tab.
export function openLinksWith(open) { opener = open; }
// name(topicId): the topic's name, null when it is unknown or cannot be read,
// or a promise of either.
export function nameTopicsWith(name) { namer = name; }
// The origin a copied link names: the instance's tailnet address when it has
// one, so a link copied on the Mac opens on a phone too. A link naming it is
// one of this Theseus's own places wherever the page is open.
export function shareLinksFrom(origin) { shareOrigin = typeof origin === 'string' && origin ? origin : null; }
// The link that opens one message in the Reader, from any device that reaches the instance.
export function messageLink(topicId, messageId) {
  return new URL(routeHref({ kind: 'topic', id: topicId, message: messageId }), shareOrigin ?? globalThis.location.origin).href;
}

const count = (text, char) => text.split(char).length - 1;
// Sentence punctuation after an address stays outside it, and so does a
// closing bracket the address did not open: "(see https://a.example/x)".
function trimmed(address) {
  for (;;) {
    const last = address.at(-1), pair = CLOSERS[last];
    if ('.,;:!?*'.includes(last) || (pair && count(address, last) > count(address, pair))) address = address.slice(0, -1);
    else return address;
  }
}

// One of this Theseus's own places, or null for anywhere else.
function ownPlace(url) {
  const here = globalThis.location;
  if (!here || ![here.origin, shareOrigin].includes(url.origin) || url.pathname !== '/') return null;
  try { const route = parseRoute(url); return IN_APP.has(route.kind) ? route : null; } catch { return null; }
}

// The links in text as { start, end, href, route } in order. partial: the text
// is an excerpt, so an address that runs to its end, or to an ellipsis that
// ends it, may have been cut and is left as words.
export function webLinks(text, { partial = false } = {}) {
  const found = [];
  text = String(text ?? '');
  for (const match of text.matchAll(ADDRESS)) {
    if (match.index > 0 && WORD.test(text[match.index - 1])) continue;
    const address = trimmed(match[0]), end = match.index + address.length;
    if (partial && ['', '…'].includes(text.slice(match.index + match[0].length).trimEnd())) continue;
    let url;
    try { url = new URL(address); } catch { continue; }
    if (!['http:', 'https:'].includes(url.protocol) || !url.hostname) continue;
    found.push({ start: match.index, end, href: url.href, route: ownPlace(url) });
  }
  // A topic's id standing on its own: not inside an address or a longer word.
  for (const match of text.matchAll(TOPIC_ID)) {
    const start = match.index, end = start + match[0].length;
    if (start > 0 && (WORD.test(text[start - 1]) || text[start - 1] === '-') || end < text.length && (WORD.test(text[end]) || text[end] === '-')) continue;
    if (found.some(link => link.start < end && start < link.end)) continue;
    const route = { kind: 'topic', id: match[0] };
    found.push({ start, end, href: routeHref(route), route, bare: true });
  }
  return found.sort((a, b) => a.start - b.start);
}

// What a link to a topic, or to a message in one, shows given the topic's name.
const shown = (route, name) => route.message ? `Message in ${name}` : name;
// Whether a link shows its topic's name: a topic's id or address, or a message's.
const named = link => link.route?.kind === 'topic';

function anchor(doc, words, link) {
  const a = doc.createElement('a');
  a.textContent = words; a.className = 'words-link';
  if (link.route) {
    a.href = routeHref(link.route);
    a.addEventListener('click', event => {
      event.stopPropagation();
      if (!opener || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      event.preventDefault(); opener(link.route, a.textContent, a);
    });
  } else {
    a.href = link.href; a.target = '_blank'; a.rel = 'noopener noreferrer';
    a.addEventListener('click', event => event.stopPropagation());
  }
  return a;
}
// The link shows its topic's name in place of the words it stands for, which
// stay its title; data-words keeps their length, so a selection in the Reader
// still counts the words the source holds.
function showName(a, words, link, name) {
  if (typeof name !== 'string' || !name) return false;
  a.textContent = shown(link.route, name); a.title = words; a.dataset.words = String(words.length);
  return true;
}
// A topic's id or address as a link with the topic's name. A bare id the page
// cannot name stays words: as a link it would show only the id; once a read
// names it, it becomes one. An address stays a link either way.
function topicLink(doc, words, link) {
  let name;
  try { name = namer(link.route.id); } catch { name = null; }
  const pending = name && typeof name.then === 'function';
  if (!pending) {
    if (link.bare && !(typeof name === 'string' && name)) return doc.createTextNode(words);
    const a = anchor(doc, words, link); showName(a, words, link, name); return a;
  }
  const a = anchor(doc, words, link), held = link.bare ? doc.createTextNode(words) : a;
  name.then(title => {
    if (!showName(a, words, link, title) || held === a || !held.parentNode) return;
    held.parentNode.replaceChild(a, held);
  }, () => {});
  return held;
}

// text as nodes: its words, with each link an anchor.
export function wordNodes(text, { doc = globalThis.document, partial = false } = {}) {
  text = String(text ?? '');
  const nodes = [];
  let at = 0;
  for (const link of webLinks(text, { partial })) {
    if (link.start > at) nodes.push(doc.createTextNode(text.slice(at, link.start)));
    const words = text.slice(link.start, link.end);
    nodes.push(named(link) ? topicLink(doc, words, link) : anchor(doc, words, link));
    at = link.end;
  }
  if (at < text.length || !nodes.length) nodes.push(doc.createTextNode(text.slice(at)));
  return nodes;
}

// Puts text, with its links, in host in place of what host held.
export function linkWords(host, text, options = {}) {
  host.replaceChildren(...wordNodes(text, { doc: host.ownerDocument ?? globalThis.document, ...options }));
  return host;
}

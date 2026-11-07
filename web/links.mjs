// Web addresses in a message's words become links (docs/links.md). The words
// are drawn as text nodes and anchors, never as markup, and only an http or
// https address is ever a link. A link to a place in this Theseus opens here,
// through the page's own navigation; any other opens in a new tab. Clicking a
// link is only that: the card, fold or passage around it is not pressed.
import { parseRoute, routeHref } from './topic-navigation.mjs';

// An address runs from its scheme to the first space, angle bracket, quote
// mark or ellipsis; what it ends with is then trimmed (see trimmed).
const ADDRESS = /https?:\/\/[^\s<>"'`“”‘’…]+/giu;
const WORD = /[\p{L}\p{N}_]/u;
const CLOSERS = { ')': '(', ']': '[', '}': '{' };
const IN_APP = new Set(['root', 'topic', 'workspace']);

let opener = null;
// open(route, title): how the page opens one of its own places. Without it an
// in-app link navigates this tab.
export function openLinksWith(open) { opener = open; }

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
  if (!here || url.origin !== here.origin || url.pathname !== '/') return null;
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
  return found;
}

function anchor(doc, words, link) {
  const a = doc.createElement('a');
  a.textContent = words; a.className = 'words-link';
  if (link.route) {
    a.href = routeHref(link.route);
    a.addEventListener('click', event => {
      event.stopPropagation();
      if (!opener || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      event.preventDefault(); opener(link.route, words);
    });
  } else {
    a.href = link.href; a.target = '_blank'; a.rel = 'noopener noreferrer';
    a.addEventListener('click', event => event.stopPropagation());
  }
  return a;
}

// text as nodes: its words, with each link an anchor.
export function wordNodes(text, { doc = globalThis.document, partial = false } = {}) {
  text = String(text ?? '');
  const nodes = [];
  let at = 0;
  for (const link of webLinks(text, { partial })) {
    if (link.start > at) nodes.push(doc.createTextNode(text.slice(at, link.start)));
    nodes.push(anchor(doc, text.slice(link.start, link.end), link));
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

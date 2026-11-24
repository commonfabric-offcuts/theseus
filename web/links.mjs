// Web addresses in a message's words become links (docs/links.md). The words
// are drawn as text nodes and anchors, never as markup. Bare links require
// http(s); authored query links may name an existing place in this instance.
// A link to a place in this Theseus opens here,
// through the page's own navigation; any other opens in a new tab. Clicking a
// link is only that: the card, fold or passage around it is not pressed.
// A topic's id in the words (t-…) is a link too, and a link to a topic or to a
// message in one shows the topic's name once the page knows it.
import { parseRoute, routeHref } from './topic-navigation.mjs';
import { charBefore, isSpace, isWord } from './characters.mjs';

// Where an address may start: its scheme. Where one does start, and where it
// ends, is addressAt's to say.
const SCHEME = /https?:\/\//gi;
// What ends an address's run of characters, besides whitespace: an angle
// bracket, a quote mark or an ellipsis.
const STOPS = new Set('<>"\'`“”‘’…');
// A topic's id as Theseus makes them: t- and 32 lowercase hex digits.
const TOPIC_ID = /t-[0-9a-f]{32}/g;
// What an address does not end with: sentence punctuation and the marks a line reads.
const TRAILING = '.,;:!?*_~';
const CLOSERS = { ')': '(', ']': '[', '}': '{' };
const IN_APP = new Set(['root', 'topic', 'workspace', 'conversation', 'pipeline', 'item', 'cards', 'image']);
const tick = (meter, steps) => { if (meter) meter.steps += steps; };

let opener = null, namer = () => null, shareOrigin = null;
// open(route, title, link, writtenQuery): how the page opens one of its own places. Without
// it an in-app link navigates this tab.
export function openLinksWith(open) { opener = open; }
// name(topicId): the topic's name, null when it is unknown or cannot be read,
// or a promise of either.
export function nameTopicsWith(name) { namer = name; }
// The origin a copied link names: the instance's tailnet address when it has
// one, so a link copied on the Mac opens on a phone too. A link naming it is
// one of this Theseus's own places wherever the page is open.
export function shareLinksFrom(origin) { shareOrigin = typeof origin === 'string' && origin ? origin : null; }
// The link to one of this Theseus's places, from any device that reaches the instance.
export const placeLink = route => new URL(routeHref(route), shareOrigin ?? globalThis.location.origin).href;
// The link that opens one message in the Reader.
export const messageLink = (topicId, messageId) => placeLink({ kind: 'topic', id: topicId, message: messageId });
// The message a link names when it is one of this Theseus's own: {topicId, messageId}, or null.
export function messageOf(address) {
  const url = webAddress(String(address), null), route = url && ownPlace(url);
  return route?.kind === 'topic' && route.message ? { topicId: route.id, messageId: route.message } : null;
}
// The link that opens one Notebook page: in the Reader on its topic's page, or
// in place on its outcome's page. scope: the page's owner_scope; revision: a
// number to name that revision, or none for the page as it stands.
export function pageLink(scope, itemId, revision = null) {
  if (!['topic', 'workspace'].includes(scope?.kind)) throw Error('A Notebook page belongs to a topic or an outcome.');
  return placeLink({ kind: scope.kind, id: scope.id, page: itemId, ...(revision === null ? {} : { revision: String(revision) }) });
}

// Sentence punctuation and a mark's closer after an address stay outside it,
// and so does a closing bracket the address did not open: "(see
// https://a.example/x)", "~~see https://a.example/x~~", as GFM's autolinks
// leave them. The brackets are counted once and the counts kept as the end
// moves back.
function trimmed(address, meter) {
  const counts = {};
  for (const char of address) if (char in CLOSERS || '([{'.includes(char)) counts[char] = (counts[char] ?? 0) + 1;
  let end = address.length;
  tick(meter, end);
  for (;;) {
    const last = address[end - 1], pair = CLOSERS[last];
    if (end && (TRAILING.includes(last) || (pair && counts[last] > (counts[pair] ?? 0)))) { if (pair) counts[last]--; end--; }
    else return address.slice(0, end);
  }
}

// address as a web address a link may go to, or null: only http and https,
// with a host. Reading it is counted on meter, a step a character: every
// address a message holds is read here.
function webAddress(address, meter) {
  tick(meter, address.length);
  let url;
  try { url = new URL(address); } catch { return null; }
  return ['http:', 'https:'].includes(url.protocol) && url.hostname ? url : null;
}

// One of this Theseus's own places, or null for anywhere else.
function ownPlace(url) {
  const here = globalThis.location;
  if (!here || ![here.origin, shareOrigin].includes(url.origin) || url.pathname !== '/') return null;
  try { const route = parseRoute(url); return IN_APP.has(route.kind) ? route : null; } catch { return null; }
}

// Where an address could start in text, in order: each place its scheme is written.
export const addressStarts = text => Array.from(String(text ?? '').matchAll(SCHEME), match => match.index);
// Where a topic's id could start in text, in order.
export const topicStarts = text => Array.from(String(text ?? '').matchAll(TOPIC_ID), match => match.index);
// The index of text's last character that is not whitespace, or -1.
export function lastWords(text) {
  let k = text.length - 1;
  while (k >= 0 && isSpace(text[k])) k--;
  return k;
}

// The address whose scheme is at start in text. null when a word runs on
// into it (a letter or digit straight before it), and otherwise {run, link}:
// run, where its run of characters ends, so no address starts again before
// it; link, {start, end, href, route}, or null when the run holds no web
// address. The run ends at whitespace, a stop (STOPS) or the first k for
// which ends(k) is true: a reader of a line's own syntax ends it at what it
// reads there (message-format.mjs). What the run ends with is trimmed (trimmed).
// partial: the text is an excerpt, so an address that runs to its end, or to
// an ellipsis that ends it, may have been cut and is no link; last is the
// text's last character that is not whitespace (lastWords).
export function addressAt(text, start, { ends = () => false, partial = false, last = -1, meter } = {}) {
  if (isWord(charBefore(text, start))) return null;
  let run = start;
  while (run < text.length && !isSpace(text[run]) && !STOPS.has(text[run]) && !ends(run)) run++;
  tick(meter, run - start);
  if (partial && (run > last || (run === last && text[run] === '…'))) return { run, link: null };
  const address = trimmed(text.slice(start, run), meter), url = webAddress(address, meter);
  return { run, link: url ? { start, end: start + address.length, href: url.href, route: ownPlace(url) } : null };
}

// The link a topic's id at start in text stands for, or null: an id stands on
// its own, not run into a word, a number or a dash on either side.
export function topicAt(text, start) {
  const end = start + 34, joins = char => isWord(char) || char === '-';
  if (joins(charBefore(text, start)) || joins(text[end])) return null;
  const route = { kind: 'topic', id: text.slice(start, end) };
  return { start, end, href: routeHref(route), route, bare: true };
}

// The links in text as { start, end, href, route } in order: its addresses
// and its topics' ids, where the text is words, not Markdown (message-format.mjs
// reads those). partial: the text is an excerpt (addressAt).
// meter: counts the work done, in characters read ({steps}).
export function webLinks(text, { partial = false, meter } = {}) {
  const found = [];
  text = String(text ?? '');
  tick(meter, text.length);
  const last = lastWords(text);
  let after = 0;
  for (const start of addressStarts(text)) {
    if (start < after) continue;
    const read = addressAt(text, start, { partial, last, meter });
    if (!read) continue;
    after = read.run;
    if (read.link) found.push(read.link);
  }
  // A topic's id standing on its own, not inside an address. The addresses
  // are in order, so one place in them moves forward with the ids.
  const addresses = found.length;
  let address = 0;
  for (const start of topicStarts(text)) {
    while (address < addresses && found[address].end <= start) address++;
    if (address < addresses && found[address].start < start + 34) continue;
    const link = topicAt(text, start);
    if (link) found.push(link);
  }
  return found.sort((a, b) => a.start - b.start);
}

// What a link to a topic, or to a message or a Notebook page in one, shows given the topic's name.
const shown = (route, name) => route.message ? `Message in ${name}` : route.page ? `Notebook page in ${name}` : name;
// Whether a link shows its topic's name: a topic's id or address, or a
// message's, unless its author wrote its words.
const named = link => !link.written && link.route?.kind === 'topic';

function anchor(doc, words, link) {
  const a = doc.createElement('a');
  a.textContent = words; a.className = 'words-link';
  if (link.route) {
    a.href = routeHref(link.route);
    a.addEventListener('click', event => {
      event.stopPropagation();
      if (!opener || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      event.preventDefault(); opener(link.route, a.textContent, a, link.writtenQuery === true);
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
function topicLink(doc, words, link, place) {
  let name;
  try { name = namer(link.route.id); } catch { name = null; }
  const pending = name && typeof name.then === 'function';
  if (!pending) {
    if (link.bare && !(typeof name === 'string' && name)) return place(doc.createTextNode(words));
    const a = place(anchor(doc, words, link)); showName(a, words, link, name); return a;
  }
  const a = place(anchor(doc, words, link)), held = link.bare ? place(doc.createTextNode(words)) : a;
  name.then(title => {
    if (!showName(a, words, link, title) || held === a || !held.parentNode) return;
    held.parentNode.replaceChild(a, held);
  }, () => {});
  return held;
}

// The link its author wrote as [words](target), as { href, route, written },
// or null when the target is neither a full http(s) address nor a query
// naming one of this instance’s existing places. Explicit angle destinations
// may also opt into an inert local { reference, written } instead. An address
// goes to the target as written, whole: none of a bare address's endings
// apply, and a link to a topic keeps its words rather than showing the
// topic's name. Where such a link starts and ends is Markdown's to say
// (message-format.mjs).
export function writtenLink(target, { meter, localReference = false } = {}) {
  // Only an explicitly angle-wrapped destination may be a local reference.
  // It is display text with a title, never an address the browser can open.
  if (localReference && /^(?:\/|~|file:)/i.test(target)) {
    tick(meter, target.length);
    return { reference: target, written: true };
  }
  if (target.startsWith('?')) {
    tick(meter, target.length);
    let url; try { url = new URL(target, globalThis.location.origin + '/'); } catch { return null; }
    const route = ownPlace(url);
    return route ? { href: url.href, route, written: true, writtenQuery: true } : null;
  }
  const url = /^https?:\/\//i.test(target) ? webAddress(target, meter) : null;
  return url ? { href: url.href, route: ownPlace(url), written: true } : null;
}

// One link as a node: an anchor showing words or a topic's name, or an inert
// local reference whose title keeps the author's destination.
// mark(node): told of each node that stands for the words, an anchor that
// takes a bare id's place once its topic is named among them.
export function linkNode(doc, words, link, mark = node => node) {
  if (link.reference !== undefined) {
    const reference = doc.createElement('span');
    reference.textContent = words; reference.className = 'words-link words-reference';
    reference.title = link.reference;
    // Preserve native text selection while keeping the surrounding card's
    // fold, edit and modifier-selection handlers out of this press.
    for (const type of ['mousedown', 'click']) reference.addEventListener(type, event => event.stopPropagation());
    return mark(reference);
  }
  return named(link) ? topicLink(doc, words, link, mark) : mark(anchor(doc, words, link));
}

// text as nodes: its words, with each link an anchor. place(node, start,
// end): told which characters of text each node stands for, an anchor that
// takes a bare id's place once its topic is named among them.
export function wordNodes(text, { doc = globalThis.document, partial = false, place = null } = {}) {
  text = String(text ?? '');
  const nodes = [];
  let at = 0;
  const placed = (start, end) => node => { place?.(node, start, end); return node; };
  for (const link of webLinks(text, { partial })) {
    if (link.start > at) nodes.push(placed(at, link.start)(doc.createTextNode(text.slice(at, link.start))));
    nodes.push(linkNode(doc, text.slice(link.start, link.end), link, placed(link.start, link.end)));
    at = link.end;
  }
  if (at < text.length || !nodes.length) nodes.push(placed(at, text.length)(doc.createTextNode(text.slice(at))));
  return nodes;
}

// Puts text, with its links, in host in place of what host held.
export function linkWords(host, text, options = {}) {
  host.replaceChildren(...wordNodes(text, { doc: host.ownerDocument ?? globalThis.document, ...options }));
  return host;
}

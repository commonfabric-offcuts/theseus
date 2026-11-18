// A dossier's cover (item 624, docs/dossier-covers.md): the folder's first
// sheet, right under its tab, saying where the dossier stands, what waits on
// the outcome's owner (each with the default that holds if they say nothing),
// and its payload, proposed until the owner's own 👍 on the payload's message,
// or their reply to it that the cover names as the word, makes it done, said
// with how it was given.
// Core keeps the cover on the dossier's first message (acts.cover) and works
// out Done; this module only draws what Core holds. A message on its own takes
// no cover: what its cover says shows as small pills under who wrote it.
//
// Its look is web/stack-look.css's, from the page's semantic tokens.
import { glyph } from './glyphs.mjs';
import { linkNode, writtenLink } from './links.mjs';
import { timeNode } from './times.mjs';

const element = (doc, tag, className, text) => {
  const node = doc.createElement(tag); if (className) node.className = className; if (text !== undefined) node.textContent = text; return node;
};
const PAYLOAD_LABELS = { answer: 'Payload · answer', decision: 'Payload · decision', preview: 'Payload · preview', page: 'Payload · page', release: 'Payload · release' };

// The cover a message carries, or null: only a dossier's first message carries one.
export const coverOf = item => item?.acts?.cover ?? null;

// Who a cover's line names, as the reader reads it: "you" for the reader.
const whom = (id, { viewer, nameOf }) => (id === viewer ? 'you' : nameOf(id));

// How the payload got done, in the pill's words: "done · your 👍 at 6:06 AM",
// "done · Ana's word at 9:29 PM"; or "payload proposed" until the owner gives it.
export function doneWords(done, context) {
  if (!done) return 'payload proposed';
  const who = done.by === context.viewer ? 'your' : `${context.nameOf(done.by)}'s`;
  return `done · ${who} ${done.how === 'thumb' ? '👍' : 'word'}`;
}

const proposedTitle = ([whose, theirs]) => `Proposed: done by ${whose} thumbs up on its message, or a reply of ${theirs} to it named as the word`;

// The payload's pill: a box while proposed, a tick once done, with how and when.
export function payloadPill(doc, payload, context) {
  const done = payload.done ?? null;
  const pill = element(doc, 'span', 'row-pill pill-payload');
  pill.dataset.state = done ? 'done' : 'proposed';
  const words = element(doc, 'span', 'pill-words', doneWords(done, context));
  if (done && Number.isSafeInteger(done.at_ms)) words.append(' at ', timeNode(done.at_ms, doc));
  pill.append(glyph(done ? 'kept' : 'payload', doc, 15), words);
  pill.title = done ? (done.how === 'thumb' ? 'Done: the owner gave its message a thumbs up' : 'Done: the owner replied to its message')
    : proposedTitle(context.owner === context.viewer ? ['your', 'yours'] : Array(2).fill(`${context.nameOf(context.owner)}'s`));
  return pill;
}

// A message of the dossier, cited by its number, a link that opens it.
function cite(doc, topicId, messageId, seq, title) {
  const node = linkNode(doc, `#${seq}`, { route: { kind: 'topic', id: topicId, message: messageId }, written: true });
  node.className = 'words-link cover-src';
  node.title = title;
  return node;
}

function waitsLabel(doc, owner, context) {
  const mine = owner === context.viewer;
  const label = element(doc, 'span', mine ? 'topic-state mine asks-you' : 'topic-state', mine ? 'Waits on you' : `Waits on ${context.nameOf(owner)}`);
  return label;
}

// Core's recorded clock label is stable across devices and later timezone rule changes.
function promiseTime(doc, due) {
  if (!due) return element(doc, 'span', 'promise-time', 'No time given');
  const node = element(doc, 'time', 'promise-time', due.label);
  node.dateTime = new Date(due.at_ms).toISOString();
  node.title = due.label;
  return node;
}

function promiseSource(doc, promise, context) {
  const node = cite(doc, context.topicId, promise.message_id, promise.seq,
    `Promise by ${context.nameOf(promise.source_author)} · source revision ${promise.source_revision}`);
  node.setAttribute('aria-label', `Promise source #${promise.seq}, revision ${promise.source_revision}, by ${context.nameOf(promise.source_author)}`);
  return node;
}

function promiseRow(doc, promise, context) {
  const row = element(doc, 'div', 'cover-line cover-promise');
  row.dataset.state = promise.state;
  const current = element(doc, 'span', 'cover-note promise-current');
  row.append(element(doc, 'span', 'cover-label', 'Promise'), ' ', element(doc, 'span', 'cover-words promise-words', promise.text), ' ',
    promiseSource(doc, promise, context), current);
  current.append(promiseTime(doc, promise.due), ' · ', element(doc, 'span', 'promise-state', promise.state));
  for (const prior of promise.history ?? []) {
    const old = element(doc, 'div', 'cover-note promise-history');
    old.append(element(doc, 'span', 'promise-words', prior.text), ' · ');
    const changedTime = JSON.stringify(prior.due) !== JSON.stringify(promise.due);
    const time = changedTime ? element(doc, 's', 'promise-prior') : element(doc, 'span', 'promise-prior-same');
    time.append(promiseTime(doc, prior.due));
    old.append(time, ` · ${prior.state} · `, promiseSource(doc, prior, context),
      ` · recorded by ${context.nameOf(prior.by)}`, ' at ', timeNode(prior.at_ms, doc));
    row.append(old);
  }
  return row;
}

// The cover as its sheet: where it stands; the payload, with its label, words,
// link and pill and the message it came from; then each thing waiting on the
// outcome's owner, with its default. context: { viewer, nameOf, topicId }.
export function coverSheet(doc, cover, context) {
  const ctx = { ...context, owner: cover.owner };
  const sheet = element(doc, 'div', 'dossier-cover');
  sheet.setAttribute('role', 'note'); sheet.setAttribute('aria-label', 'Dossier cover');
  const line = className => { const node = element(doc, 'div', `cover-line ${className}`); sheet.append(node); return node; };
  if (cover.stands) line('cover-stands').append(element(doc, 'span', 'cover-words', cover.stands));
  const payload = cover.payload;
  if (payload) {
    const row = line('cover-payload'), words = element(doc, 'span', 'cover-words');
    words.append(element(doc, 'span', 'cover-label', PAYLOAD_LABELS[payload.kind] ?? 'Payload'), ' ', payload.text);
    const link = payload.link ? writtenLink(payload.link) : null;
    if (link) {
      let shown = payload.link;
      try { shown = new URL(payload.link).host; } catch { /* the address as written */ }
      const anchor = linkNode(doc, shown, link); anchor.title = payload.link; words.append(' ', anchor);
    }
    words.append(' ', payloadPill(doc, payload, ctx));
    row.append(words);
    if (Number.isSafeInteger(payload.seq)) row.append(cite(doc, ctx.topicId, payload.message_id, payload.seq, 'The message that delivered it'));
    const done = payload.done;
    if (done?.how === 'word' && done.message_id && Number.isSafeInteger(done.seq)) row.append(cite(doc, ctx.topicId, done.message_id, done.seq, 'The word that made it done'));
  }
  for (const wait of cover.waiting ?? []) {
    const row = line('cover-wait');
    row.append(waitsLabel(doc, cover.owner, ctx), ' ', element(doc, 'span', 'cover-words', wait.text), element(doc, 'span', 'cover-note', `Default: ${wait.default}.`));
  }
  for (const promise of cover.promises ?? []) sheet.append(promiseRow(doc, promise, ctx));
  sheet.dataset.done = String(Boolean(payload?.done) && !(cover.waiting ?? []).length);
  return sheet;
}

// What a cover on a message on its own shows instead: its payload's pill and
// one pill for what waits on the owner, under who wrote it. Null with neither.
export function coverPills(doc, cover, context) {
  const ctx = { ...context, owner: cover.owner };
  const pills = element(doc, 'span', 'row-pills');
  if (cover.payload) pills.append(payloadPill(doc, cover.payload, ctx));
  if ((cover.waiting ?? []).length) {
    const pill = element(doc, 'span', 'row-pill pill-waits'); pill.dataset.state = 'waiting';
    const count = cover.waiting.length;
    pill.append(glyph('waits', doc, 15), element(doc, 'span', 'pill-words', `${count === 1 ? 'waits' : `${count} wait`} on ${whom(cover.owner, ctx)}`));
    pill.title = cover.waiting.map(wait => `${wait.text} Default: ${wait.default}.`).join('\n');
    pills.append(pill);
  }
  for (const promise of cover.promises ?? []) {
    const pill = element(doc, 'span', 'row-pill pill-promise'); pill.dataset.state = promise.state;
    pill.append(element(doc, 'span', 'pill-words', `${promise.text} · ${promise.due?.label ?? 'No time given'} · ${promise.state}`));
    pill.title = `Promise · ${context.nameOf(promise.source_author)} · #${promise.seq}, revision ${promise.source_revision}`;
    pills.append(pill);
  }
  if (!pills.children.length) return null;
  if (cover.stands) pills.title = cover.stands;
  return pills;
}

// A key for what a cover shows a reader, so a sheet is drawn again only when it changes.
export const coverKey = (cover, context) => (cover ? JSON.stringify([cover.stands, cover.waiting, cover.payload, cover.promises, cover.owner, context.viewer, context.topicId]) : '');

const pillRows = new WeakMap();
// The pills of a message on its own that carries a cover, set under its
// author line; none takes them away.
export function paintCoverPills(card, cover, context) {
  const kept = pillRows.get(card);
  const key = coverKey(cover, context);
  if (kept?.key === key && (key === '' || kept.node?.isConnected)) return;
  kept?.node?.remove();
  const node = cover ? coverPills(card.ownerDocument, cover, context) : null;
  if (node) (card.querySelector(':scope > .message-author') ?? card.firstElementChild)?.after(node);
  pillRows.set(card, { key, node });
  card.dataset.covered = String(Boolean(node));
}

import { currentQuestionCover } from './question-state.mjs';
// A dossier's cover (item 624, docs/dossier-covers.md): first in the folder,
// right under its tab and above its messages, saying where it stands, what
// waits on the outcome's owner (each with the default that holds if they say nothing),
// and its payload, proposed until the owner's own 👍 on the payload's message,
// or their reply to it that the cover names as the word, makes it done, said
// with how it was given.
// Core keeps the cover on the dossier's first message (acts.cover) and works
// out Done; this module only draws what Core holds. A message on its own takes
// no cover: what its cover says shows as small pills under who wrote it.
//
// Its look is web/stack-look.css's, from the page's semantic tokens.
import { refreshControl, coverRequestLine } from './cover-refresh.mjs';
import { coverAnswers } from './cover-answers.mjs';
import { glyph } from './glyphs.mjs';
import { linkNode, writtenLink } from './links.mjs';
import { timeNode } from './times.mjs';
import { inlineNodes, parseBlocks, formatNodes } from './message-format.mjs';
import { literalHTMLNodes } from './interactive-html.mjs';

const element = (doc, tag, className, text) => {
  const node = doc.createElement(tag); if (className) node.className = className; if (text !== undefined) node.textContent = text; return node;
};
const PAYLOAD_LABELS = { answer: 'Payload · answer', decision: 'Payload · decision', preview: 'Payload · preview', page: 'Payload · page', release: 'Payload · release' };

// The cover a message carries, or null: only a dossier's first message carries one.
export const coverOf = item => currentQuestionCover(item?.acts?.cover ?? null);

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

// A wait keeps the message it came from. Older/source-free waits open the
// actual dossier root, including when only a reply is loaded as its tab.
function waitLink(doc, words, wait, context) {
  const message = wait?.message_id ?? wait?.ask_id ?? context.rootId;
  return message ? linkNode(doc, words, { route: { kind: 'topic', id: context.topicId, message }, written: true })
    : element(doc, 'span', '', words);
}

function waitsLabel(doc, owner, wait, context) {
  const mine = owner === context.viewer;
  const label = waitLink(doc, mine ? 'Waits on you' : `Waits on ${context.nameOf(owner)}`, wait, context);
  label.className = mine ? 'topic-state mine asks-you' : 'topic-state';
  return label;
}

// The cover as its sheet: where it stands; the payload, with its label, words,
// link and pill and the message it came from; then each thing waiting on the
// outcome's owner, with its default. context: { viewer, nameOf, topicId }.
export function waitWords(wait) {
  if (!(wait.options?.length) && wait.default == null) return 'Waiting for your answer.';
  const details = [];
  if ('options' in wait) details.push(wait.options.length ? `Options: ${wait.options.join(' | ')}` : 'No choices');
  details.push(wait.default == null ? 'No default promised' : `Default: ${wait.default}.`);
  if (wait.reason) details.push(wait.reason);
  return details.join(' · ');
}

function revisionLine(doc, cover, context) {
  if (!cover.by || !Number.isSafeInteger(cover.at_ms)) return null;
  const line = element(doc, 'span', 'cover-revision-line');
  line.append(`${context.nameOf(cover.by)} refreshed the cover · `, timeNode(cover.at_ms, doc));
  return line;
}

export function coverSheet(doc, cover, context) {
  cover = currentQuestionCover(cover);
  const ctx = { ...context, owner: cover.owner };
  const sheet = element(doc, 'div', 'dossier-cover');
  sheet.setAttribute('role', 'note'); sheet.setAttribute('aria-label', 'Dossier cover');
  const line = className => { const node = element(doc, 'div', `cover-line ${className}`); sheet.append(node); return node; };
  if (cover.stands) {
    const words = element(doc, 'span', 'cover-words cover-stands');
    const nodes = literalHTMLNodes(cover.stands, doc);
    // Complete HTML covers retain their existing isolated fence contract.
    // Plain paragraphs retain their literal node and pixels, including LF.
    if (!nodes.some(node => node.className === 'html-block' || node.className === 'html-source')) {
      const inline = inlineNodes(cover.stands, { doc });
      const plain = inline.every(node => node.nodeType === 3) &&
        inline.map(node => node.textContent).join('') === cover.stands &&
        parseBlocks(cover.stands).every(block => block.kind === 'paragraph');
      if (plain) words.textContent = cover.stands;
      else {
        words.classList.add('formatted');
        words.append(...formatNodes(cover.stands, { doc }));
      }
    }
    else words.append(...nodes);
    line('cover-heading').append(words);
  }
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
  for (const item of cover.items ?? []) line('cover-item').append(itemRow(doc, item));
  for (const wait of cover.waiting ?? []) {
    const row = line('cover-wait');
    const words = element(doc, 'span', 'cover-words');
    words.append(...inlineNodes(wait.text, { doc }));
    row.append(waitsLabel(doc, wait.actor_id ?? cover.owner, wait, ctx), ' ', words, element(doc, 'span', 'cover-note', waitWords(wait)));
    const answers = coverAnswers(doc, wait, ctx); if (answers) row.append(answers);
  }
  const refresh = refreshControl(doc, cover, ctx);
  if (refresh) {
    // The final content row owns the corner; no heading or extra row is needed.
    refresh.style.gridRow = String(Math.max(1, sheet.children.length));
    sheet.append(refresh);
  }
  const request = coverRequestLine(doc, cover, ctx);
  if (request) sheet.append(request);
  const revised = revisionLine(doc, cover, ctx);
  if (revised) sheet.append(revised);
  sheet.dataset.done = String(Boolean(payload?.done) && !(cover.waiting ?? []).length);
  return sheet;
}

// One generated row per actual item, beside the manual fields.
export function itemRow(doc, item) {
  const row = element(doc, 'span', 'cover-words');
  row.append(linkNode(doc, item.title, { route: { kind: 'item', id: item.workspace_id, item: String(item.number) }, written: true }),
    ' · ', element(doc, 'span', 'cover-item-state', item.state));
  return row;
}

export const coverSummary = cover => cover.stands || cover.payload?.text ||
  (cover.items?.length ? cover.items.map(item => `${item.title} · ${item.state}`).join('; ') : null);

// What a cover on a message on its own shows instead: its payload's pill and
// one pill for what waits on the owner, under who wrote it. Null with neither.
export function coverPills(doc, cover, context) {
  cover = currentQuestionCover(cover);
  const ctx = { ...context, owner: cover.owner };
  const pills = element(doc, 'span', 'row-pills');
  if (cover.payload) pills.append(payloadPill(doc, cover.payload, ctx));
  for (const item of cover.items ?? []) {
    const row = element(doc, 'span', 'cover-item'); row.append(itemRow(doc, item)); pills.append(row);
  }
  if ((cover.waiting ?? []).length) {
    const pill = waitLink(doc, '', cover.waiting[0], ctx); pill.className = 'row-pill pill-waits'; pill.dataset.state = 'waiting';
    const count = cover.waiting.length;
    pill.append(glyph('waits', doc, 15), element(doc, 'span', 'pill-words', `${count === 1 ? 'waits' : `${count} wait`} on ${[...new Set(cover.waiting.map(wait => whom(wait.actor_id ?? cover.owner, ctx)))].join(', ')}`));
    pill.title = cover.waiting.map(wait => `${wait.text} ${waitWords(wait)}`).join('\n');
    pills.append(pill);
    for (const wait of cover.waiting) { const answers = coverAnswers(doc, wait, ctx); if (answers) pills.append(answers); }
  }
  const refresh = refreshControl(doc, cover, ctx); if (refresh) pills.append(refresh);
  const request = coverRequestLine(doc, cover, ctx); if (request) pills.append(request);
  if (!pills.children.length) return null;
  const revised = revisionLine(doc, cover, ctx); if (revised) pills.append(revised);
  if (cover.stands) pills.title = cover.stands;
  return pills;
}

// A key for what a cover shows a reader, so a sheet is drawn again only when it changes.
export const coverKey = (cover, context) => ((cover = currentQuestionCover(cover)) ? JSON.stringify([cover.stands, cover.waiting, cover.payload, cover.items, cover.by, cover.at_ms, cover.owner, cover.root_id, cover.revision, cover.writer, cover.refresh, cover.refresh_revision, context.viewer, context.topicId, context.rootId]) : '');

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

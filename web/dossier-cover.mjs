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
import { composeFormattedWords, formatNodes, inlineNodes, literalWords, parseBlocks } from './message-format.mjs';
import { literalHTMLNodes } from './interactive-html.mjs';
import { coverSectionNodes, coverDisclosure } from './cover-sections.mjs';

const element = (doc, tag, className, text) => {
  const node = doc.createElement(tag); if (className) node.className = className; if (text !== undefined) node.textContent = text; return node;
};
const PAYLOAD_LABELS = { answer: 'Payload · answer', decision: 'Payload · decision', preview: 'Payload · preview', page: 'Payload · page', release: 'Payload · release' };
const SECTION_LABELS = { why: 'Why', what: 'What', how: 'How', when: 'When', who: 'Who', where: 'Where', log: 'Log' };
const NATURE_LABELS = new Map([['question', 'Question'], ['decision', 'Decision'], ['research', 'Research'], ['feature', 'Feature'], ['tracking', 'Tracking']]);
const PHASES = ['Open', 'Working', 'Delivered', 'Accepted'];

function writtenSections(cover) {
  const sections = new Map((cover.sections ?? []).map(({ key, text }) => [key, text]));
  return Object.entries(SECTION_LABELS).flatMap(([key, label]) => {
    const text = sections.get(key);
    return text?.trim() ? [{ key, label, text }] : [];
  });
}

export function structuredCover(cover) {
  return Boolean(cover && (cover.birth || cover.sections?.length || cover.owner_name));
}

function firstLine(text, doc) {
  return inlineNodes(text.trim().split('\n', 1)[0], { doc }).map(node => node.textContent).join('');
}

function presentation(cover, sections, doc) {
  const writtenNature = cover.birth?.nature?.trim();
  const matched = writtenNature?.toLowerCase();
  const nature = NATURE_LABELS.has(matched) ? matched : 'other';
  const label = NATURE_LABELS.get(nature) ?? (writtenNature && matched !== 'none' && matched !== 'other' ? writtenNature : 'Other');
  const when = sections.find(section => section.key === 'when');
  const next = nature === 'tracking' && when ? `next ${firstLine(when.text, doc)}` : null;
  const phase = nature === 'other' || nature === 'tracking' ? null
    : cover.payload?.done ? 3 : cover.payload ? 2 : sections.length ? 1 : 0;
  return { label, nature, next, phase };
}

export function coverStatus(doc, cover) {
  const { label, next, phase } = presentation(cover, writtenSections(cover), doc);
  return { label, status: next ?? PHASES[phase] };
}

function coverHeader(doc, cover, view, context) {
  const header = element(doc, 'div', 'cover-header-content');
  header.append(element(doc, 'span', 'cover-nature', view.label));
  if (view.phase !== null) {
    const status = element(doc, 'span', 'cover-status');
    const bars = element(doc, 'span', 'cover-phase-bars');
    bars.setAttribute('aria-hidden', 'true');
    for (const [index] of PHASES.entries()) {
      const bar = element(doc, 'span');
      bar.dataset.step = index < view.phase ? 'past' : index === view.phase ? 'current' : 'future';
      bars.append(bar);
    }
    status.append(bars, element(doc, 'span', 'cover-phase', PHASES[view.phase]));
    header.append(status);
  }
  if (view.next) header.append(element(doc, 'span', 'cover-next', view.next));
  const keeper = cover.writer ?? cover.by;
  if (keeper) header.append(element(doc, 'span', 'cover-keeper', context.nameOf(keeper)));
  return header;
}

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
  if (context.ownerName) {
    pill.classList.add('cover-acceptance');
    const name = done ? context.acceptedByName ?? context.ownerName : context.ownerName;
    const words = element(doc, 'span', 'pill-words', done ? `${name} accepted` : `Waiting on ${name}'s ok`);
    if (done) {
      pill.append(glyph('kept', doc, 15));
      if (Number.isSafeInteger(done.at_ms)) pill.title = `${words.textContent} at ${timeNode(done.at_ms, doc).textContent}`;
    } else pill.title = words.textContent;
    pill.append(words);
    return pill;
  }
  const words = element(doc, 'span', 'pill-words', doneWords(done, context));
  if (done && Number.isSafeInteger(done.at_ms)) words.append(' at ', timeNode(done.at_ms, doc));
  pill.append(glyph(done ? 'kept' : 'payload', doc, 15), words);
  pill.title = done ? (done.how === 'thumb' ? 'Done: the owner gave its message a thumbs up' : 'Done: the owner replied to its message')
    : proposedTitle(context.owner === context.viewer ? ['your', 'yours'] : Array(2).fill(`${context.nameOf(context.owner)}'s`));
  return pill;
}

export function coverPreview(doc, cover, context) {
  const sections = writtenSections(cover);
  const { label, next, phase } = presentation(cover, sections, doc);
  const preview = element(doc, 'span', 'stack-cover-preview');
  preview.append(element(doc, 'span', 'cover-nature', label));
  const lead = cover.stands ?? sections[0]?.text ?? cover.payload?.text;
  if (lead?.trim()) {
    const words = firstLine(lead, doc);
    const snippet = element(doc, 'span', 'stack-cover-lead', words);
    snippet.title = words;
    preview.append(snippet);
  }
  if (cover.payload && !cover.payload.done && cover.owner_name) {
    preview.append(payloadPill(doc, cover.payload, { ...context, ownerName: cover.owner_name }));
  } else if (next || phase !== null) {
    preview.append(element(doc, 'span', 'stack-cover-status', next ?? PHASES[phase]));
  }
  return preview;
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
export function waitWords(wait, context = {}) {
  if (!(wait.options?.length) && wait.default == null) {
    const actor = wait.actor_id ?? context.owner;
    const mine = typeof context.viewer === 'string' && context.viewer.length > 0 && actor === context.viewer;
    return mine ? 'Waiting for your answer.' : 'Waiting for an answer.';
  }
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

const sheetRows = new WeakMap();
export const copyOfCover = sheet => sheetRows.get(sheet)?.copy;
export function coverQuoteSource(words) {
  const part = words?.dataset.coverQuotePart;
  const ref = part && sheetRows.get(words.closest('.dossier-cover'))?.quote;
  return ref ? { ...ref, part } : null;
}


function coverCopyWords(cover, context) {
  const payload = cover.payload;
  const delivery = payload && `Payload: ${payload.text}${payload.link ? ` <${payload.link}>` : ''}`;
  const structured = structuredCover(cover);
  const parts = [cover.stands];
  if (structured) {
    parts.unshift(delivery);
    for (const { label, text } of writtenSections(cover)) parts.push(`${label}\n${text}`);
  }
  for (const wait of cover.waiting ?? []) {
    const name = context.nameOf(wait.actor_id ?? cover.owner);
    parts.push(`Waits on ${name}: ${wait.text}${wait.default == null ? '' : ` (default: ${wait.default})`}`);
  }
  if (!structured) parts.push(delivery);
  return parts.filter(Boolean).join('\n\n');
}
function linkedItems(doc, items, context, previous) {
  if (!items?.length) return null;
  const group = previous ?? (() => {
    const label = element(doc, 'span', 'cover-items-count');
    const disclosure = coverDisclosure(label, { doc, ...context, sectionId: JSON.stringify(['linked-items']), initiallyOpen: false });
    disclosure.section.classList.add('cover-linked-items');
    const row = element(doc, 'div', 'cover-line cover-items'); row.append(disclosure.section);
    return { ...disclosure, row, label, rows: new Map() };
  })();
  const states = new Map(), occurrences = new Map(), desired = new Map();
  for (const item of items) {
    const state = String(item.state ?? '').split(' · ')[0].trim().toLowerCase() || 'unknown';
    states.set(state, (states.get(state) ?? 0) + 1);
    const identity = JSON.stringify([item.workspace_id, item.number]);
    const occurrence = occurrences.get(identity) ?? 0; occurrences.set(identity, occurrence + 1);
    const key = JSON.stringify([identity, occurrence]);
    const record = group.rows.get(key) ?? { node: element(doc, 'div', 'cover-line cover-item'), item: null };
    if (!record.item) record.node.append(itemRow(doc, item));
    else {
      if (record.item.title !== item.title) record.node.querySelector('a').textContent = item.title;
      if (record.item.state !== item.state) record.node.querySelector('.cover-item-state').textContent = item.state;
    }
    desired.set(key, { node: record.node, item: { title: item.title, state: item.state } });
  }
  let removedFocus = false;
  for (const [key, record] of group.rows) if (!desired.has(key)) {
    removedFocus ||= Boolean(record.node.contains?.(doc.activeElement)); record.node.remove();
  }
  let index = 0;
  for (const { node } of desired.values()) {
    const next = group.body.children[index++] ?? null;
    if (node !== next) group.body.insertBefore(node, next);
  }
  group.rows = desired;
  const words = `${items.length} ${items.length === 1 ? 'item' : 'items'}: ${[...states].map(([state, count]) => `${count} ${state}`).join(', ')}`;
  if (group.label.textContent !== words) group.label.textContent = words;
  if (removedFocus) group.summary.focus({ preventScroll: true });
  return group;
}
export function coverSheet(doc, cover, context, previous = null) {
  cover = currentQuestionCover(cover);
  const ctx = { ...context, rootId: cover.root_id ?? context.rootId, owner: cover.owner,
    ownerName: cover.owner_name, acceptedByName: cover.accepted_by_name };
  const sheet = element(doc, 'div', 'dossier-cover');
  const copy = () => coverCopyWords(cover, ctx);
  const quote = typeof doc.getSelection === 'function' && ctx.rootId && Number.isSafeInteger(cover.revision) && cover.revision > 0
    ? { kind: 'cover', id: ctx.rootId, revision: cover.revision } : null;
  const quotable = (words, part, body) => {
    if (quote) {
      words.dataset.coverQuotePart = part;
      composeFormattedWords(words, body, cover.revision, []);
    }
    return words;
  };
  sheet.setAttribute('role', 'note'); sheet.setAttribute('aria-label', 'Dossier cover');
  const rows = new Map(), scope = JSON.stringify([ctx.viewer, ctx.topicId, ctx.rootId]);
  const kept = sheetRows.get(previous), sameScope = kept?.scope === scope;
  const preferred = new Map();
  const remember = (node, key) => { rows.set(node, JSON.stringify(key)); return node; };
  const line = (className, value) => {
    const node = remember(element(doc, 'div', `cover-line ${className}`), [className, value]);
    sheet.append(node); return node;
  };
  const payload = cover.payload;
  const drawPayload = () => {
    const row = line('cover-payload', [payload, cover.owner, ctx.ownerName, ctx.acceptedByName]);
    const words = element(doc, 'span', 'cover-words');
    const text = quote ? quotable(literalWords(element(doc, 'span'), payload.text, cover.revision), 'payload', payload.text) : payload.text;
    words.append(element(doc, 'span', 'cover-label', PAYLOAD_LABELS[payload.kind] ?? 'Payload'), ' ', text);
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
  };
  const structured = structuredCover(cover);
  const sections = writtenSections(cover);
  const view = structured ? presentation(cover, sections, doc) : null;
  if (view) {
    sheet.dataset.coverLayout = view.nature;
    line('cover-header', [view, cover.writer ?? cover.by]).append(coverHeader(doc, cover, view, ctx));
    if (payload) drawPayload();
  }
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
      if (plain) {
        if (quote) literalWords(words, cover.stands, cover.revision);
        else words.textContent = cover.stands;
      } else {
        words.classList.add('formatted');
        words.append(...coverSectionNodes(cover.stands, { doc, ...ctx, rootId: cover.root_id ?? ctx.rootId }));
      }
    }
    else words.append(...nodes);
    quotable(words, 'stands', cover.stands);
    const row = line('cover-heading', [cover.stands, view?.nature]);
    if (view?.nature === 'research') row.append(element(doc, 'span', 'cover-label', 'Finding'));
    row.append(words);
  }
  if (payload && !structured) drawPayload();
  if (cover.birth?.done_when?.trim()) {
    const label = view.nature === 'question' ? 'Answered when' : 'Done when';
    const text = cover.birth.done_when;
    line('cover-criterion', [label, text]).append(element(doc, 'span', 'cover-label', label), ' ', ...inlineNodes(text, { doc }));
  }
  for (const { key, label, text } of sections) {
    const title = element(doc, 'span', 'cover-section-label', label);
    const { section, summary, body } = coverDisclosure(title, { ...ctx, doc, sectionId: JSON.stringify(['structured', key]), initiallyOpen: false });
    section.classList.add('cover-structured-section');
    summary.append(element(doc, 'span', 'cover-section-peek', firstLine(text, doc)));
    body.append(...formatNodes(text, { doc }));
    line('cover-field', [key, text]).append(section);
  }
  const items = linkedItems(doc, cover.items, { ...ctx, rootId: cover.root_id ?? ctx.rootId }, sameScope ? kept.items : null);
  if (items) {
    const placeholder = line('cover-items', cover.items);
    if (sameScope && items === kept.items) preferred.set(placeholder, items.row);
    else { placeholder.append(items.section); items.row = placeholder; }
  }
  for (const [visibleIndex, wait] of (cover.waiting ?? []).entries()) {
    const index = cover.quote_wait_indices?.[visibleIndex] ?? visibleIndex;
    const row = line('cover-wait', quote ? [wait, cover.owner, index] : [wait, cover.owner]);
    const words = element(doc, 'span', 'cover-words');
    words.append(...inlineNodes(wait.text, { doc }));
    const detail = waitWords(wait, ctx), note = element(doc, 'span', 'cover-note');
    if (!quote || wait.default == null) note.textContent = detail;
    else {
      const options = 'options' in wait ? (wait.options.length ? `Options: ${wait.options.join(' | ')} · ` : 'No choices · ') : '';
      const at = options.length + 'Default: '.length;
      const value = literalWords(element(doc, 'span'), wait.default, cover.revision);
      note.append(detail.slice(0, at), quotable(value, `default.${index}`, wait.default), detail.slice(at + wait.default.length));
    }
    row.append(waitsLabel(doc, wait.actor_id ?? cover.owner, wait, ctx), ' ', quotable(words, `wait.${index}`, wait.text), note);
    const answers = coverAnswers(doc, wait, ctx); if (answers) row.append(answers);
  }
  const refresh = refreshControl(doc, cover, ctx);
  if (refresh) {
    // The final content row owns the corner; no heading or extra row is needed.
    refresh.style.gridRow = String(Math.max(1, sheet.children.length));
    sheet.append(remember(refresh, ['control', coverKey(cover, context)]));
  }
  const request = coverRequestLine(doc, cover, ctx);
  if (request) sheet.append(remember(request, ['request', coverKey(cover, context)]));
  const revised = revisionLine(doc, cover, ctx);
  if (revised) sheet.append(remember(revised, ['revision', cover.by, cover.at_ms]));
  sheet.dataset.done = String(Boolean(payload?.done) && !(cover.waiting ?? []).length);
  if (sameScope) {
    // A revision is not removal. Keep the reading sheet and unchanged rows,
    // including their text ranges, selection, focus and live control state.
    const available = new Map();
    for (const [node, key] of kept.rows) {
      if (!available.has(key)) available.set(key, []);
      available.get(key).push(node);
    }
    const desired = new Map([...rows].map(([node, key]) => [preferred.get(node) ?? available.get(key)?.shift() ?? node, key]));
    for (const node of [...previous.children]) if (!desired.has(node)) node.remove();
    let index = 0;
    for (const node of desired.keys()) {
      const next = previous.children[index++] ?? null;
      if (node !== next) previous.insertBefore(node, next);
    }
    previous.dataset.done = sheet.dataset.done;
    if (view) previous.dataset.coverLayout = sheet.dataset.coverLayout;
    else delete previous.dataset.coverLayout;
    sheetRows.set(previous, { scope, rows: desired, items, copy, quote });
    return previous;
  }
  sheetRows.set(sheet, { scope, rows, items, copy, quote });
  return sheet;
}

// One generated row per actual item, beside the manual fields.
export function itemRow(doc, item) {
  const row = element(doc, 'span', 'cover-words');
  row.append(linkNode(doc, item.title, { route: { kind: 'item', id: item.workspace_id, item: String(item.number) }, written: true }),
    ' · ', element(doc, 'span', 'cover-item-state', item.state));
  return row;
}

export const coverSummary = cover => (structuredCover(cover) && cover.payload?.text) || cover.stands || cover.payload?.text ||
  writtenSections(cover)[0]?.text.trim().split('\n', 1)[0] ||
  (cover.items?.length ? cover.items.map(item => `${item.title} · ${item.state}`).join('; ') : null);

// What a cover on a message on its own shows instead: its payload's pill and
// one pill for what waits on the owner, under who wrote it. Null with neither.
export function coverPills(doc, cover, context) {
  cover = currentQuestionCover(cover);
  const ctx = { ...context, owner: cover.owner, ownerName: cover.owner_name, acceptedByName: cover.accepted_by_name };
  const pills = element(doc, 'span', 'row-pills');
  if (cover.payload) pills.append(payloadPill(doc, cover.payload, ctx));
  for (const item of cover.items ?? []) {
    const row = element(doc, 'span', 'cover-item'); row.append(itemRow(doc, item)); pills.append(row);
  }
  if ((cover.waiting ?? []).length) {
    const pill = waitLink(doc, '', cover.waiting[0], ctx); pill.className = 'row-pill pill-waits'; pill.dataset.state = 'waiting';
    const count = cover.waiting.length;
    pill.append(glyph('waits', doc, 15), element(doc, 'span', 'pill-words', `${count === 1 ? 'waits' : `${count} wait`} on ${[...new Set(cover.waiting.map(wait => whom(wait.actor_id ?? cover.owner, ctx)))].join(', ')}`));
    pill.title = cover.waiting.map(wait => `${wait.text} ${waitWords(wait, ctx)}`).join('\n');
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
export const coverKey = (cover, context) => ((cover = currentQuestionCover(cover)) ? JSON.stringify([
  cover.stands, cover.waiting, cover.quote_wait_indices, cover.payload, cover.items, cover.sections, cover.birth,
  cover.by, cover.at_ms, cover.owner, cover.owner_name, cover.accepted_by_name, cover.root_id, cover.revision,
  cover.writer, cover.refresh, cover.refresh_revision, context.viewer, context.topicId, context.rootId,
]) : '');

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

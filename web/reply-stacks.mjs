// Replies gathered into stacks (docs/reply-stacks.md). A message and every
// loaded reply to it, and to those replies, read as one stack, with any stack
// someone joined to it: the message it starts with on top as its head, one
// compact row, and its replies under it oldest first, as a chat reads. The
// stacks keep the topic newest on top unless the reader placed one
// (stack-order.mjs decides all of that; this module draws it).
//
// Every message keeps its own entry (a card, or a fold of a message between
// others, fold.mjs), with its data-id and data-seq, inside the stack, so what
// finds a message finds it there; a reply folded away is its entry hidden in
// its place. A stack carries the data-seq of its newest message and the id of
// its head in data-stack. What a stack looks like is web/stack-look.css's
// alone: this module sets only the class names and data attributes it
// documents. How far each stack is folded, and which head shows its full
// message, are this page's own and never recorded. A message the reader
// folded is their own act, kept in Core (stack-feed.mjs): wherever it shows
// it is one row, who wrote it and its first words, with a cue that it is
// folded; a stack's folded first message is its head row alone.
import { cardIn, opened } from './fold.mjs';
import { gather, ordered, rowsOf, headOf, lineUnder, rowFolded, LEVELS } from './stack-order.mjs';
import { firstLine } from './pipeline-words.mjs';
import { shownTime } from './times.mjs';

const ENTRIES = ':scope > [data-id], :scope > .reply-stack > [data-id], :scope > .reply-stack > .stack-replies > [data-id]';
const states = new WeakMap();
const parts = new WeakMap();
const headRows = new WeakMap();
const foldedRows = new WeakMap();

// Every message entry in the list, in the page's order: each stack's head,
// then its replies, folded ones included.
export const entries = list => [...list.querySelectorAll(ENTRIES)];

// The message entry a target is in, on its own or in a stack: the card, or
// the fold holding it. Null for anything else in the list, a stack's lines included.
export function entryOf(list, target) {
  let at = target?.nodeType === 1 ? target : target?.parentElement;
  for (; at && at !== list; at = at.parentElement) {
    const parent = at.parentElement;
    if (!at.dataset?.id) continue;
    if (parent === list) return at;
    const stack = parent?.classList.contains('stack-replies') ? parent.parentElement : parent;
    if (stack?.classList.contains('reply-stack') && stack.parentElement === list) return at;
  }
  return null;
}

// The list's own child that holds entry: its stack, or the entry itself.
export function topOf(list, entry) {
  let at = entry;
  while (at && at.parentElement !== list) at = at.parentElement;
  return at;
}

// What the page keeps for a list's stacks: each stack's level ('head',
// 'folded', 'open'), replies kept in view once kept, folded messages opened
// for this view (peeked), the stack being renamed, the stacks as last drawn,
// and the messages last drawn as their folded row (folded).
export function stackState(list) {
  if (!states.has(list)) states.set(list, { levels: new Map(), kept: new Set(), peeked: new Set(), renaming: null,
    stacks: [], sections: new Map(), folded: new Set(), viewer: null, again: () => {} });
  return states.get(list);
}

// An explicit choice starts a fresh partial view. Replies that were unread
// when drawn stay put while read, until the person changes the stack state.
// A message opened for that view folds to its row again; the reader's folds
// themselves are theirs in Core, and no state choice changes them.
export function setLevel(state, stack, level) {
  state.levels.set(stack.id, level);
  state.peeked.delete(stack.id);
  for (const item of stack.replies) { state.kept.delete(item.id); state.peeked.delete(item.id); }
}

// The stack an entry is in, as last drawn: { stack, section (null for a
// message on its own), head: whether the entry is its head, index }.
export function stackOf(list, entry) {
  const state = stackState(list), id = entry?.dataset?.id;
  const index = state.stacks.findIndex(stack => stack.id === id || stack.replies.some(item => item.id === id));
  if (index < 0) return null;
  const stack = state.stacks[index];
  return { stack, index, head: stack.id === id, section: state.sections.get(stack.id) ?? null };
}

// Where the New line goes for message seq: under the lowest stack holding
// anything new since it (stack-order.mjs, lineUnder), so the line never cuts a
// stack in two. The seq itself when no loaded stack holds it.
export function lineSeq(list, seq) {
  const state = states.get(list);
  if (!seq || !state) return seq;
  const at = lineUnder(state.stacks, seq, state.viewer);
  return at === null ? seq : state.stacks[at].newest;
}

// Opens the stack that folds entry away, so the entry can be shown or take
// the focus; full: a head shows its full message too. A message the reader
// folded opens from its row for this view (a link, search, Starred), and its
// fold stays theirs in Core: nothing is written.
export function reveal(entry, { full = false } = {}) {
  const section = entry?.closest?.('.reply-stack');
  const list = section ? section.parentElement : entry?.parentElement;
  if (!list || !states.has(list)) return entry;
  const state = stackState(list), id = section?.dataset.stack, own = entry.dataset.id;
  let changed = false;
  if (section && entry.hidden) { state.levels.set(id, 'open'); changed = true; }
  if (section && full && own === id && state.levels.get(id) !== 'open') { state.levels.set(id, 'open'); changed = true; }
  if (state.folded.has(own)) { state.peeked.add(own); changed = true; }
  if (changed) state.again();
  return entry;
}

// A click on a message drawn as its folded row unfolds it (its head row's
// click does, for a stack's first message: headClick). Answers whether the
// click was the row's.
export function foldedClick(list, entry) {
  if (!entry) return false;
  const state = stackState(list), id = entry.dataset.id;
  if (cardIn(entry).dataset.folded !== 'true' || !state.folded.has(id)) return false;
  state.on?.unfold?.(id);
  return true;
}

// A click on a stack's head row: a press on its name or ✎ renames it, on
// "Hide the full message" hides it; anywhere else on the row shows the full
// message, or hides it again. On the row of a folded first message it unfolds
// that message and opens the stack, so the message shows. Answers whether the
// click was the row's; a click on the full message's words is not, and opens
// it as any card's does.
export function headClick(list, entry, event) {
  const found = stackOf(list, entry), state = stackState(list);
  if (!found?.head || !found.section || !found.stack.replies.length) return false;
  const { stack } = found, act = event?.target?.closest?.('.stack-act')?.dataset.stackAct;
  if (act === 'rename') { state.on?.rename?.(stack); return true; }
  if (state.folded.has(stack.id)) {
    if (state.levels.get(stack.id) !== 'open') setLevel(state, stack, 'open');
    state.on?.unfold?.(stack.id);
    return true;
  }
  const open = state.levels.get(stack.id) === 'open';
  if (act === 'hide' || (open && event?.target?.closest?.('.stack-head'))) {
    setLevel(state, stack, 'folded'); state.again();
    return true;
  }
  if (!open) { setLevel(state, stack, 'open'); state.again(); return true; }
  return false;
}

// Lets go of the replies kept in view in the stacks where pick(section)
// holds, so they fold as they now would (a stack dealt with, read elsewhere),
// and of the full message a head was showing.
export function unkeep(list, pick) {
  const state = stackState(list);
  let changed = false;
  for (const stack of state.stacks) {
    const section = state.sections.get(stack.id);
    if (!section || !pick(section)) continue;
    for (const item of stack.replies) changed = state.kept.delete(item.id) || changed;
    if (state.levels.get(stack.id) === 'open') { setLevel(state, stack, 'folded'); changed = true; }
  }
  if (changed) state.again();
}

// Puts each node of desired, in order, among parent's children that count,
// moving only what is out of place.
function reconcile(parent, desired, counts = () => true) {
  const next = node => { while (node && !counts(node)) node = node.nextElementSibling; return node; };
  let ref = next(parent.firstElementChild);
  for (const node of desired) {
    if (node === ref) { ref = next(ref.nextElementSibling); continue; }
    carry(node, () => parent.insertBefore(node, ref));
  }
}

// Moves a node, keeping where everything in it was scrolled: a browser puts a
// box it takes out of the page back at its start, so a table scrolled
// sideways, or a long message scrolled in its card, would jump back when a
// join, a move or a new reply carries its card into another place.
function carry(node, move) {
  const kept = [];
  if (node.isConnected) {
    for (const box of [node, ...node.querySelectorAll('*')]) if (box.scrollLeft || box.scrollTop) kept.push([box, box.scrollLeft, box.scrollTop]);
  }
  move();
  for (const [box, left, top] of kept) { box.scrollLeft = left; box.scrollTop = top; }
}

const element = (doc, tag, className, text) => {
  const node = doc.createElement(tag); if (className) node.className = className; if (text !== undefined) node.textContent = text; return node;
};

function makeStack(doc, id) {
  const section = element(doc, 'div', 'reply-stack'), replies = element(doc, 'div', 'stack-replies');
  const toggle = element(doc, 'button', 'stack-toggle'); toggle.type = 'button';
  replies.id = `stack-replies-${id}`; toggle.setAttribute('aria-controls', replies.id);
  section.dataset.stack = id; section.setAttribute('role', 'group');
  parts.set(section, { replies, toggle, lines: new Map(), placed: null, rename: null });
  return section;
}

// A line of the stack's (a fold line, a join line), kept across repaints by
// key, so one holding the focus keeps it.
function line(section, key, make) {
  const { lines } = parts.get(section);
  if (!lines.has(key)) lines.set(key, make());
  return lines.get(key);
}

const replies = n => (n === 1 ? 'reply' : 'replies');
// The head's row, set into its card: its short name (renamed in place), who
// started the stack, how many replied and who, what is new, and whether its
// first message is folded.
function paintHead(card, stack, { open, starred, state, unread, nameOf, doc }) {
  let row = headRows.get(card);
  if (!row) { row = element(doc, 'span', 'stack-head'); headRows.set(card, row); }
  if (card.firstElementChild !== row) card.prepend(row);
  card.classList.add('stack-head-card');
  const head = headOf(stack, { firstLine, unread, peeked: item => state.peeked.has(item.id) });
  const act = (name, className, text, title) => {
    const span = element(doc, 'span', `stack-act ${className}`, text); span.dataset.stackAct = name;
    if (title) span.title = title; return span;
  };
  const name = act('rename', 'stack-name', head.name, head.typed ? `Named by ${nameOf(head.typed.by)} for everyone here. Click to rename.` : 'Click to give it a short name everyone here sees');
  const pen = act('rename', 'stack-pen', '', 'Rename'); pen.setAttribute('aria-hidden', 'true');
  // Use the same pencil and direction as the page's New message control.
  const pencil = doc.getElementById('new-message')?.querySelector('svg')?.cloneNode(true);
  if (pencil) pen.append(pencil);
  const meta = element(doc, 'span', 'stack-meta', `${head.count} ${replies(head.count)}`);
  if (head.repliers.length) meta.append(element(doc, 'span', 'stack-repliers', ` · ${head.repliers.map(nameOf).join(', ')}`));
  if (head.fresh) meta.append(element(doc, 'span', 'stack-fresh', ` · ${head.fresh} new`));
  row.replaceChildren(name, pen, element(doc, 'span', 'stack-who', nameOf(stack.head.author_id)),
    ...(head.headNew ? [element(doc, 'span', 'stack-new', 'New')] : []),
    ...(starred ? [element(doc, 'span', 'stack-star', '★ Starred')] : []),
    ...(head.folded ? [element(doc, 'span', 'stack-folded', 'Folded')] : []),
    meta, ...(open ? [act('hide', 'stack-hide', 'Show latest and unread replies')] : []));
  row.dataset.renaming = String(state.renaming === stack.id);
  return head;
}

// A message that no longer heads a stack is a card again.
function unhead(entry) {
  const card = cardIn(entry);
  card.classList.remove('stack-head-card');
  headRows.get(card)?.remove();
}

// A message the reader folded, as one row set into its card: who wrote it,
// its first words, and that it is folded (stack-look.css hides the rest of the
// card). folded false takes the row away and the card reads whole.
function paintFolded(entry, item, folded, { nameOf, doc }) {
  const card = cardIn(entry);
  if (!folded) { foldedRows.get(card)?.remove(); if (card.dataset.folded) card.dataset.folded = 'false'; return; }
  let row = foldedRows.get(card);
  if (!row) {
    row = element(doc, 'span', 'message-folded');
    row.append(element(doc, 'span', 'folded-author'), element(doc, 'span', 'folded-words'), element(doc, 'span', 'folded-cue', 'Folded'));
    foldedRows.set(card, row);
  }
  const [author, words] = row.children;
  author.textContent = nameOf(item.author_id);
  words.textContent = firstLine(item.body);
  if (card.firstElementChild !== row) card.prepend(row);
  card.dataset.folded = 'true';
}

function renameField(section, stack, head, { state, doc }) {
  const p = parts.get(section);
  if (state.renaming !== stack.id) { p.rename?.remove(); p.rename = null; return null; }
  if (p.rename) return p.rename;
  const field = element(doc, 'div', 'stack-rename'), input = element(doc, 'input', 'stack-rename-input'), hint = element(doc, 'span', 'stack-rename-hint', 'Return saves · Esc cancels');
  input.type = 'text'; input.value = head.name; input.maxLength = 200;
  input.setAttribute('aria-label', 'Short name for this stack, for everyone here; empty gives back its first line');
  let done = false;
  const finish = save => { if (done) return; done = true; state.renaming = null; p.rename = null; field.remove(); save ? state.on?.renamed?.(stack, input.value) : state.on?.cancelled?.(stack); };
  input.addEventListener('keydown', event => {
    if (event.key === 'Enter') { event.preventDefault(); event.stopPropagation(); finish(true); }
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); finish(false); }
  });
  input.addEventListener('blur', () => finish(true));
  field.append(input, hint);
  p.rename = field; p.input = input;
  return field;
}

// The rename field of the stack headed by id, while it is open.
export function renameInput(list, id) {
  const section = stackState(list).sections.get(id);
  return section ? parts.get(section).input ?? null : null;
}

function paintStack(section, stack, byId, context) {
  const { state, keep, unread, nameOf, doc } = context;
  const p = parts.get(section), head = byId.get(stack.id), single = !stack.replies.length;
  const level = single ? 'open' : state.levels.get(stack.id) ?? 'folded';
  // A folded first message is its head row alone, at every level.
  const starred = Boolean(stack.head.acts?.starred), open = !single && level === 'open' && !state.folded.has(stack.id);
  const kept = item => {
    if (state.kept.has(item.id)) return true;
    if (!unread(item)) return false;
    state.kept.add(item.id); return true;
  };
  head.hidden = false;
  if (!single) opened(head);
  const shown = single ? { name: firstLine(stack.head.body) } : paintHead(cardIn(head), stack, { open, starred, state, unread, nameOf, doc });
  p.toggle.dataset.state = level;
  p.toggle.setAttribute('aria-expanded', String(level !== 'head'));
  p.toggle.setAttribute('aria-label', `${{ head: 'Closed; show latest and unread replies', folded: 'Latest and unread replies; show all messages', open: 'All messages; close stack' }[level]}: ${shown.name}`);
  p.toggle.onclick = () => { setLevel(state, stack, LEVELS[(LEVELS.indexOf(level) + 1) % LEVELS.length]); state.on?.folded?.(stack, level); state.again(); };
  const desired = [];
  const rows = single ? [] : rowsOf(stack, { level, kept, unread, peeked: item => state.peeked.has(item.id) });
  for (const row of rows) {
    if (row.kind === 'reply') { const entry = byId.get(row.item.id); entry.hidden = false; desired.push(entry); continue; }
    if (row.kind === 'join') {
      const join = line(section, `join:${row.item.id}`, () => {
        const node = element(doc, 'div', 'stack-join-line'), words = element(doc, 'span', 'stack-join-words'), split = element(doc, 'button', 'stack-split', 'Split back out');
        split.type = 'button'; node.append(words, split); node.dataset.join = row.item.id; Object.assign(node, { words, split });
        return node;
      });
      join.words.textContent = `Joined from its own stack by ${nameOf(row.join.by)}${Number.isSafeInteger(row.join.at_ms) ? `, ${shownTime(row.join.at_ms)}` : ''}`;
      join.split.onclick = () => state.on?.split?.(row.item);
      desired.push(join); continue;
    }
    // Folded runs need no repeated count or control between the messages:
    // the header already gives the count, and its chevron opens every run.
    for (const item of row.items ?? []) { const entry = byId.get(item.id); entry.hidden = true; desired.push(entry); }
  }
  const used = new Set(desired);
  for (const [key, node] of p.lines) if (!used.has(node)) { node.remove(); p.lines.delete(key); }
  reconcile(p.replies, desired);
  if (stack.placed !== null && !p.placed) {
    p.placed = element(doc, 'p', 'stack-placed-line');
    const words = element(doc, 'span', 'stack-placed-words', 'Placed here by you'), free = element(doc, 'button', 'stack-unplace', 'Let new replies move it');
    free.type = 'button'; p.placed.append(words, free); p.free = free;
  }
  if (p.placed) p.free.onclick = () => state.on?.unplace?.(stack);
  const rename = single ? null : renameField(section, stack, shown, context);
  reconcile(section, [head, ...(rename ? [rename] : single ? [] : [p.toggle]), p.replies, ...(stack.placed !== null ? [p.placed] : [])]);
  if (single || rename) p.toggle.remove();
  if (stack.placed === null) p.placed?.remove();
  Object.assign(section.dataset, { seq: String(stack.newest), fold: level, headOpen: String(open), placed: String(stack.placed !== null),
    single: String(single), renaming: String(state.renaming === stack.id) });
  section.setAttribute('aria-label', single ? 'Placed message' : `Reply stack: ${shown.name}`);
}

// Gathers the list's entries into stacks and draws them, on every topic page
// alike. messages: the loaded messages by id. keep(item): a reply the usual
// fold keeps in view; once kept it stays kept, so a reply the person is
// reading is never folded away under them. unread(item): counted as new on a
// fold line and the head. viewer: who reads. nameOf(actor): a person's name
// as the page shows it. on: what the stack's own controls do (stack-feed.mjs).
export function arrangeStacks(list, messages, options = {}) {
  const { keep = () => false, unread = () => false, viewer = null, nameOf = id => id, on = null, doc = list.ownerDocument } = options;
  const state = stackState(list);
  Object.assign(state, { viewer, again: () => arrangeStacks(list, messages, options) });
  if (on) state.on = on;
  const active = list.contains(doc.activeElement) ? doc.activeElement : null;
  const byId = new Map(entries(list).map(entry => [entry.dataset.id, entry]));
  const loaded = [...byId.keys()].map(id => messages.get(id)).filter(Boolean);
  const stacks = ordered(gather(loaded, { viewer }));
  state.stacks = stacks;
  state.folded = new Set(loaded.filter(item => rowFolded(item, { peeked: each => state.peeked.has(each.id) })).map(item => item.id));
  const top = [], live = new Set(), context = { state, keep, unread, nameOf, doc };
  for (const stack of stacks) {
    const head = byId.get(stack.id);
    if (!stack.replies.length && stack.placed === null) { head.hidden = false; top.push(head); continue; }
    live.add(stack.id);
    if (!state.sections.has(stack.id)) state.sections.set(stack.id, makeStack(doc, stack.id));
    const section = state.sections.get(stack.id);
    paintStack(section, stack, byId, context);
    top.push(section);
  }
  // Entries the page has that Core's messages do not name stay where they are.
  reconcile(list, top, node => !node.dataset.line && (!node.dataset.id || messages.has(node.dataset.id)));
  for (const [id, section] of state.sections) if (!live.has(id)) { section.remove(); state.sections.delete(id); }
  for (const entry of byId.values()) if (entry.parentElement === list) entry.hidden = false;
  // Only a stack's head carries its row: a message that headed one before a
  // join, or before its replies went, is a card again.
  const heads = new Set(stacks.filter(stack => stack.replies.length).map(stack => stack.id));
  for (const [id, entry] of byId) if (!heads.has(id)) unhead(entry);
  // Every other message the reader folded is its one-line row, in a stack or on its own.
  for (const [id, entry] of byId) if (messages.get(id)) paintFolded(entry, messages.get(id), state.folded.has(id) && !heads.has(id), { nameOf, doc });
  // A star shows on its card wherever it is (stack-look.css).
  for (const [id, entry] of byId) { const starred = String(Boolean(messages.get(id)?.acts?.starred)); if (cardIn(entry).dataset.starred !== starred) cardIn(entry).dataset.starred = starred; }
  if (active?.isConnected && doc.activeElement !== active) active.focus({ preventScroll: true });
}

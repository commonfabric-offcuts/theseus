// Replies gathered into stacks (docs/topic-reading.md, "Reply stacks"). A
// message and every loaded reply to it, and to those replies, read as one
// stack: the message on top, its replies under it, newest first. The stack
// sits in the topic where its newest message would, so the topic still reads
// newest on top, as an inbox does, and a reply brings its stack up with it.
// Folded, a stack shows its newest reply and any the person has not read, and
// one line says how many more there are; the line opens them in place.
//
// Every message keeps its own entry (a card, or a fold of a message between
// others, fold.mjs), with its data-id and data-seq, inside the stack, so what
// finds a message finds it there. A stack carries the data-seq of its newest
// message, and no data-id. Nothing here reads or writes a record: the replies
// are what Core says each message answers (reply_to).

const ENTRIES = ':scope > [data-id], :scope > .reply-stack > [data-id], :scope > .reply-stack > .stack-replies > [data-id]';
const stacksOf = new WeakMap();
const parts = new WeakMap();

// Every message entry in the list, newest first in each place, stacks opened up.
export const entries = list => [...list.querySelectorAll(ENTRIES)];

// The message entry a target is in, on its own or in a stack: the card, or
// the fold holding it. Null for anything else in the list, a stack's line
// included.
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

// Where the New line goes for message seq: under the list's own child that
// holds its entry, so the line never cuts a stack in two.
export function lineSeq(list, seq) {
  if (!seq) return seq;
  const entry = entries(list).find(child => Number(child.dataset.seq) === seq);
  const top = entry && topOf(list, entry);
  return top ? Number(top.dataset.seq) : seq;
}

// Opens the stack that folds entry away, so the entry can be shown or take the focus.
export function reveal(entry) {
  const stack = entry?.closest?.('.reply-stack');
  if (stack && entry.hidden) { stack.dataset.open = 'true'; fold(stack); }
  return entry;
}

// The message a stack is gathered under: the oldest loaded message up the
// chain of replies. A message whose parent is not loaded (or not visible to
// this reader) heads its own stack.
function rootOf(item, messages, has) {
  const seen = new Set();
  let at = item;
  while (at.reply_to && messages.has(at.reply_to) && has(at.reply_to) && !seen.has(at.id)) { seen.add(at.id); at = messages.get(at.reply_to); }
  return at;
}

// Puts each node of desired, in order, among parent's children that count,
// moving only what is out of place.
function reconcile(parent, desired, counts = () => true) {
  const next = node => { while (node && !counts(node)) node = node.nextElementSibling; return node; };
  let ref = next(parent.firstElementChild);
  for (const node of desired) {
    if (node === ref) { ref = next(ref.nextElementSibling); continue; }
    parent.insertBefore(node, ref);
  }
}

function makeStack(doc) {
  const stack = doc.createElement('div'), replies = doc.createElement('div'), toggle = doc.createElement('button');
  stack.className = 'reply-stack'; replies.className = 'stack-replies';
  toggle.type = 'button'; toggle.className = 'stack-toggle';
  toggle.onclick = () => { stack.dataset.open = String(stack.dataset.open !== 'true'); fold(stack); };
  stack.append(replies);
  parts.set(stack, { replies, toggle, rest: [] });
  return stack;
}

const count = n => `${n} earlier ${n === 1 ? 'reply' : 'replies'}`;
// Shows or folds a stack's earlier replies, those kept in view excepted.
function fold(stack) {
  const { toggle, rest } = parts.get(stack), open = stack.dataset.open === 'true';
  let folded = 0;
  for (const entry of rest) { const show = open || entry.dataset.kept === 'true'; entry.hidden = !show; if (entry.dataset.kept !== 'true') folded++; }
  toggle.hidden = folded === 0;
  toggle.textContent = open ? `Fold ${count(folded)}` : count(folded);
  toggle.setAttribute('aria-expanded', String(open));
}

// Gathers the list's entries into stacks. messages: the loaded messages by id.
// enabled false leaves every message on its own. keep(item): a reply that
// stays in view while its stack is folded; once kept it stays kept, so a
// reply the person is reading is never folded away under them.
export function arrangeStacks(list, messages, { enabled = true, keep = () => false, doc = list.ownerDocument } = {}) {
  const active = list.contains(doc.activeElement) ? doc.activeElement : null;
  const byId = new Map(entries(list).map(entry => [entry.dataset.id, entry]));
  const groups = new Map();
  for (const id of byId.keys()) {
    const item = messages.get(id);
    if (!item) continue;
    const root = enabled ? rootOf(item, messages, other => byId.has(other)) : item;
    if (!groups.has(root.id)) groups.set(root.id, []);
    groups.get(root.id).push(item);
  }
  if (!stacksOf.has(list)) stacksOf.set(list, new Map());
  const known = stacksOf.get(list), top = [];
  for (const [rootId, members] of groups) {
    members.sort((a, b) => b.seq - a.seq);
    if (members.length === 1) { top.push({ node: byId.get(rootId), seq: members[0].seq }); continue; }
    const stack = known.get(rootId) ?? makeStack(doc);
    known.set(rootId, stack);
    const { replies, toggle } = parts.get(stack), head = byId.get(rootId);
    const answers = members.filter(item => item.id !== rootId).map(item => byId.get(item.id));
    for (const entry of answers.slice(1)) if (keep(messages.get(entry.dataset.id))) entry.dataset.kept = 'true';
    answers[0].hidden = false;
    reconcile(stack, [head, replies]);
    reconcile(replies, [answers[0], toggle, ...answers.slice(1)]);
    head.hidden = false;
    parts.get(stack).rest = answers.slice(1);
    stack.dataset.seq = String(members[0].seq);
    fold(stack);
    top.push({ node: stack, seq: members[0].seq });
  }
  top.sort((a, b) => b.seq - a.seq);
  reconcile(list, top.map(entry => entry.node), node => !node.dataset.line);
  for (const [rootId, stack] of known) {
    if (groups.get(rootId)?.length > 1) continue;
    stack.remove(); known.delete(rootId);
  }
  // A message on its own is never left folded away by a stack it has left.
  for (const entry of byId.values()) if (entry.parentElement === list) { entry.hidden = false; delete entry.dataset.kept; }
  if (active?.isConnected && doc.activeElement !== active) active.focus({ preventScroll: true });
}

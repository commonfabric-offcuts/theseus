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
// folded; a stack's first message too, under its head row, which stays the
// dossier's title (item 471). An open
// dossier of more than seven messages shows its newest seven and one row for
// the earlier ones, which shows them as rows for this visit (item 476): a way
// of showing it, kept by the page alone, never recorded.
import { cardIn, opened } from './fold.mjs';
import { gather, dossiersOf, reheaded, ordered, rowsOf, headOf, lineUnder, rowFolded, LEVELS, positionOf, placeOf, shownOrder, drawnBelow, pageOf, shown, earlierOf, stackCover, starredDossiers, dossierOf } from './stack-order.mjs';
import { messagePreview } from './message-preview.mjs';
import { shownTime } from './times.mjs';
import { coordinationStack } from './coordination-stacks.mjs';
import { carriesNode, carriesOf } from './marks.mjs';
import { coverKey, coverSheet, paintCoverPills } from './dossier-cover.mjs';
import { AGENT_PALETTE } from './author-colors.mjs';
import { showGlyph } from './glyphs.mjs';

const ENTRIES = ':scope > [data-id], :scope > .reply-stack > [data-id], :scope > .reply-stack > .stack-replies > [data-id]';
const states = new WeakMap();
const parts = new WeakMap();
const headRows = new WeakMap();
const foldedRows = new WeakMap();
const earlierRows = new WeakMap();

// Every message entry in the list, in the page's order: each stack's head,
// then its replies, folded ones included.
export const entries = list => [...list.querySelectorAll(ENTRIES)];

// An open dossier has two distinct stops: its header control, then its
// original message. Folded dossiers already use the head entry as their
// header. Hidden messages and controls never enter the arrow-key order.
export function navigationStops(list) {
  const stops = [];
  for (const entry of entries(list)) {
    // What the page draws is what the keys reach: a card laid out is a stop.
    if (!entry.getClientRects().length) continue;
    const section = entry.closest('.reply-stack');
    if (section?.dataset.stack === entry.dataset.id && section.dataset.headOpen === 'true') {
      const toggle = section.querySelector(':scope > .stack-toggle');
      if (toggle?.getClientRects().length) stops.push(toggle);
    }
    stops.push(entry);
  }
  return stops;
}

// What a stop shows as selected, which the keys bring into view whole
// (reveal.mjs): a dossier's chevron, or its compact header standing for it,
// is the whole dossier, its header and whatever of its body shows; anything
// else, a message on its own included, is itself.
export function shownSelected(stop) {
  const section = stop?.closest?.('.reply-stack');
  if (!section || section.dataset.single === 'true') return stop;
  const head = stop.parentElement === section && (stop.classList.contains('stack-toggle') || (stop.dataset.id === section.dataset.stack && section.dataset.headOpen === 'false'));
  return head ? section : stop;
}

// The stop among stops that a focused element in the list stands for. A
// dossier's chevron is its own stop while the dossier is fully expanded, and
// otherwise stands for the dossier's head entry, its compact header; anything
// else stands for the message entry it is in. Null when that is no stop.
export function stopAt(list, target, stops = navigationStops(list)) {
  if (stops.includes(target)) return target;
  const toggle = target?.closest?.('.stack-toggle');
  const entry = toggle ? toggle.parentElement.querySelector(':scope > [data-id]') : entryOf(list, target);
  return stops.includes(entry) ? entry : null;
}

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

// What the page keeps for a list's stacks: each stack's level ('folded',
// 'open', or 'head' for a quiet agent dossier not yet opened), replies kept in
// view once kept, folded messages opened for this view (peeked), messages a
// link, search or Starred drew where their dossier sits though it is put below
// More, each with the place Core held the dossier at then (here;
// stack-order.mjs, drawnBelow), the stack being renamed, the stacks as last
// drawn, the messages last drawn as their folded row (folded), and the stacks
// last drawn below More messages, by id (below). Item 476: the open dossiers
// whose earlier-messages row was opened this visit (earlier), the messages
// among those earlier ones shown whole this visit (whole), the messages
// last drawn as an earlier one's row (earlierRows), and, for each dossier drawn
// open, the first message it showed then (held; stack-order.mjs, earlierOf),
// so a message arriving hides nothing. Item 550: what More messages was
// pressed with (filling, fillFrom), the older messages it filled the stack
// shown last above it with (filled), and those it showed as cards of their
// own (apart; stack-order.mjs, gather). None is ever recorded.
export function stackState(list) {
  if (!states.has(list)) states.set(list, { levels: new Map(), kept: new Set(), peeked: new Set(), here: new Map(), renaming: null,
    stacks: [], sections: new Map(), folded: new Set(), coordination: new Set(), showCoordination: true, below: new Set(), viewer: null, again: () => {},
    checking: new Map(), earlier: new Set(), whole: new Set(), earlierRows: new Set(), held: new Map(), starred: new Set(), filling: null, filled: new Set(), apart: new Set() });
  return states.get(list);
}

// Item 550: More messages, pressed, shows what it loads where its button was
// (docs/experience-guidelines.md, "Your place holds"). Of the older messages
// it loads, each of a dossier the page draws (stack-order.mjs, dossiersOf)
// shows there whole: at the end of the stack shown last above the button where
// it is of that stack's dossier and that stack is the dossier's own (filled),
// and as a card of its own otherwise (apart), so no stack drawn higher up
// takes it or another head, and nothing shown moves (gather). A card of its
// own that an earlier press showed (apart) is no dossier's stack: its
// dossier's stack sits higher up, so what the next press loads of that
// dossier shows as cards of their own below it, never at that stack's end.
// Older messages of a dossier the page does not draw are its stack there, as
// ever. Records the dossier whose own stack is that last one (null for a card
// of its own), the dossiers drawn, what was loaded when it was pressed and the
// oldest of it; arrangeStacks sorts the older page as it draws it (fill).
export function fillFrom(list) {
  const state = stackState(list), view = shownView(state);
  const known = new Set();
  let below = Infinity;
  for (const stack of state.stacks) for (const item of [stack.head, ...stack.replies]) { known.add(item.id); below = Math.min(below, item.seq); }
  const last = shownStacks(state).filter(stack => !view.below(stack)).at(-1);
  state.filling = { into: last && !state.apart.has(last.id) ? last.dossier : null, drawn: new Set(state.stacks.map(stack => stack.dossier)), known, below };
}

// Each message this drawing is the first to hold, older than everything
// loaded when More was pressed, of a dossier drawn then (fillFrom), joins
// state.filled or state.apart.
function fill(state, loaded) {
  const filling = state.filling;
  if (!filling) return;
  const dossier = dossiersOf(loaded, { filled: state.filled, apart: state.apart });
  for (const item of loaded) {
    const of = dossier.get(item.id);
    if (!filling.known.has(item.id) && item.seq < filling.below && filling.drawn.has(of)) (of === filling.into ? state.filled : state.apart).add(item.id);
    filling.known.add(item.id);
  }
}

// Agent-only dossiers begin as one quiet title row; a person's explicit
// expansion always wins. A new human-directed reply gets the normal partial view.
// The header alone is only ever an agent-only dossier's (item 394): any other
// stack left there (one that stopped being agent-only, say, after ⌘Z took it
// back to its row) shows latest plus unread.
export function levelOf(state, id) {
  const level = state.levels.get(id) ?? 'head';
  return level === 'head' && !state.coordination.has(id) ? 'folded' : level;
}

// An explicit choice starts a fresh partial view. Replies that were unread or
// starred when drawn stay put while read or unstarred, until the person
// changes the stack state.
// A message opened for that view folds to its row again; the reader's folds
// themselves are theirs in Core, and no state choice changes them. A dossier
// a link drew where it sits stays drawn there (here). Its earlier-messages row
// closes again, and what it showed whole folds back to rows (item 476).
export function setLevel(state, stack, level) {
  state.levels.set(stack.id, level);
  state.peeked.delete(stack.id);
  for (const item of stack.replies) { state.kept.delete(item.id); state.peeked.delete(item.id); }
  state.earlier.delete(stack.id); for (const item of [stack.head, ...stack.replies]) state.whole.delete(item.id);
}

// How the page shows its stacks as last drawn (stack-order.mjs, shownOrder):
// which it drew below More messages, and which it drew but does not show (below
// More while it is closed, agent coordination while Show agent coordination is
// off). The stacks themselves stay in their own order for finding a message or
// revealing one (stackOf, reveal), so a link or search still reaches a dossier
// put aside. The Conversation's Only new (state.only, the messages it draws)
// is its own view: More's button goes, every New item shows wherever it sits,
// put aside or not, and hidden agent coordination stays hidden (aim.css,
// stack-look.css).
export function shownView(state) {
  const only = state.only ?? null, asideShown = Boolean(state.moreOpen || only);
  return { below: stack => state.below.has(stack.id), only, asideShown,
    hidden: stack => (state.below.has(stack.id) && !asideShown) || (!state.showCoordination && state.coordination.has(stack.id)) };
}
export const shownStacks = state => shownOrder(state.stacks, shownView(state));
// Whether the page draws message id, by its one view: its stack on show
// (shownView, which a dossier a link drew where it sits is), and in it, under
// Only new, the New items alone, else its head and the replies its level
// shows. Every decision about what is drawn asks this (the keys' focus, the
// card a redraw holds), never the DOM. A message no stack holds (one Core's
// messages do not name) is drawn as Only new draws it.
export function drawn(list, id) {
  const state = stackState(list), view = shownView(state);
  const stack = state.stacks.find(each => each.id === id || each.replies.some(item => item.id === id));
  if (stack && view.hidden(stack)) return false;
  const item = !stack ? { id } : stack.id === id ? stack.head : stack.replies.find(each => each.id === id);
  if (view.only) return Boolean(view.only(item));
  return !stack || item === stack.head || shown(stack, item, { level: levelOf(state, stack.id), kept: each => state.kept.has(each.id), earlier: state.earlier.has(stack.id), held: state.held.get(stack.id) ?? null });
}
// The page as stepping reads it (stack-order.mjs, pageOf and stepTarget).
export const stackPage = state => pageOf(state.stacks, shownView(state));

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
// stack in two. The seq itself when no loaded stack holds it. When that stack
// is not on show (below a closed More), the line takes the first place shown
// after it, under the nearest stack shown above it, rather than sitting below
// More; with none shown above it there is no line.
export function lineSeq(list, seq) {
  const state = states.get(list);
  if (!seq || !state) return seq;
  const at = lineUnder(state.stacks, seq, state.viewer);
  if (at === null) return seq;
  const view = shownView(state);
  if (!view.hidden(state.stacks[at])) return state.stacks[at].newest;
  const above = state.stacks.slice(0, at).findLast(stack => !view.below(stack) && !view.hidden(stack));
  return above ? above.newest : null;
}

// Opens the stack that folds entry away, so the entry can be shown or take
// the focus; full: a head shows its full message too. A message the reader
// folded opens from its row for this view (a link, search, Starred), and its
// fold stays theirs in Core: nothing is written; one in a dossier put below
// More is drawn where the dossier sits (here) while Core holds the dossier at
// the place it held when the link was followed, until a Move below More or
// Bring back on any device. The page may not yet have heard of a move Core
// made before then (item 426): until the page has read Core's place again,
// the dossier is drawn where it sits wherever Core holds it (pending), and
// that read's place is the one it holds to (stack-feed.mjs, landedBelow).
// One among an open dossier's earlier messages opens their row and shows
// whole (item 476), for this visit; its first message only when full is asked.
// open: the dossier is drawn open whatever its level, as a topic's unread
// count lands on a message (item 613), so the row is expanded as far as it.
export function reveal(entry, { full = false, open = false } = {}) {
  const feed = entry?.closest?.('#messages');
  if (feed && states.has(feed)) {
    const state = stackState(feed);
    if (!state.showCoordination && (entry.dataset.coordination === 'agents' || entry.closest('[data-coordination=agents]'))) {
      state.showCoordination = true; state.on?.coordinationShown?.(true); state.again();
    }
  }
  const section = entry?.closest?.('.reply-stack');
  const list = section ? section.parentElement : entry?.parentElement;
  if (!list || !states.has(list)) return entry;
  const state = stackState(list), id = section?.dataset.stack, own = entry.dataset.id;
  let changed = false;
  if (section && levelOf(state, id) === 'head') { state.levels.set(id, 'open'); changed = true; }
  if (section && entry.hidden) { state.levels.set(id, 'open'); changed = true; }
  if (section && full && own === id && state.levels.get(id) !== 'open') { state.levels.set(id, 'open'); changed = true; }
  if (section && open && state.levels.get(id) !== 'open') { state.levels.set(id, 'open'); changed = true; }
  const stack = state.stacks.find(each => each.id === own || each.replies.some(item => item.id === own));
  if (section && stack && (own !== id || full) && earlierOf(stack, levelOf(state, id), { held: state.held.get(id) ?? null }).some(item => item.id === own)) {
    if (!state.earlier.has(id)) { state.earlier.add(id); changed = true; }
    if (!state.whole.has(own)) { state.whole.add(own); changed = true; }
  }
  if (state.folded.has(own)) { state.peeked.add(own); changed = true; }
  if (stack && positionOf(stack)?.below) {
    const mark = { place: placeOf(positionOf(stack)), pending: true };
    state.here.set(own, mark); state.on?.landedBelow?.(own, mark); changed = true;
  }
  if (changed) state.again();
  return entry;
}

// Whether a press at target falls on an earlier message's row as the page
// draws it (item 476): the card is drawn as that row, the press is not on a
// first message's tab above it, and Only new, which draws the card whole with
// no row in it, is off. Anywhere else the card acts as any card does.
export function onEarlierRow(entry, target) {
  const card = cardIn(entry);
  return card.dataset.earlier === 'true' && !target?.closest?.('.stack-head') && !card.closest('.only-new');
}

// A click on a message drawn as its folded row unfolds it (its head row's
// click does, for a stack's first message: headClick). One drawn as an
// earlier message's row shows whole in place, for this visit, recording
// nothing (item 476). Answers whether the click was the row's.
export function foldedClick(list, entry, event) {
  if (!entry) return false;
  const state = stackState(list), id = entry.dataset.id;
  if (onEarlierRow(entry, event?.target) && state.earlierRows.has(id)) { state.whole.add(id); state.again(); return true; }
  if (cardIn(entry).dataset.folded !== 'true' || !state.folded.has(id)) return false;
  state.on?.unfold?.(id);
  return true;
}

// A click on a stack's head row: a press on its name or ✎ renames it, on
// "Hide the full message" hides it; anywhere else on the row shows the full
// message, or hides it again. The row is the dossier's title whether its first
// message is folded or not (item 471). Answers whether the click was the
// row's; a click on the full message, its folded row included, is not, and
// does what it does on any card: so too on a head a folded stack shows whole
// (a gathered stack's, item 550, paintStack).
export function headClick(list, entry, event) {
  const found = stackOf(list, entry), state = stackState(list);
  if (!found?.head || !found.section || !found.stack.replies.length) return false;
  const { stack } = found, act = event?.target?.closest?.('.stack-act')?.dataset.stackAct;
  if (act === 'new') { state.on?.newest?.(stack, event.target.closest('.stack-new-action')); return true; }
  if (act === 'rename') { state.on?.rename?.(stack); return true; }
  // The first message drawn as an earlier one's row, under the tab: a press
  // there shows it whole, for this visit (item 476); the tab acts as before.
  if (state.earlierRows.has(stack.id) && onEarlierRow(entry, event?.target)) { state.whole.add(stack.id); state.again(); return true; }
  const open = state.levels.get(stack.id) === 'open', row = Boolean(event?.target?.closest?.('.stack-head'));
  if (act === 'hide' || (open && row)) {
    setLevel(state, stack, 'folded'); state.again();
    return true;
  }
  if (!open && (row || found.section.dataset.headOpen !== 'true')) { setLevel(state, stack, 'open'); state.again(); return true; }
  return false;
}

// A click on the header of a message a dossier shows whole (who wrote it and
// when) folds it, for the reader alone (item 471); its words, its bar and
// Return open the Reader. A control in the header (the star, the reply arrow)
// answers its own press. Answers whether the click was the header's.
export function headerClick(list, entry, event) {
  const card = entry && cardIn(entry), header = event?.target?.closest?.('.message-author');
  if (!header || header.parentElement !== card || card.dataset.folded === 'true') return false;
  const control = event.target.closest('a, button, [role=button], input, textarea, select');
  if (control && control !== card) return false;
  const section = entry.closest('.reply-stack');
  if (section?.dataset.single !== 'false' || section.closest('.only-new')) return false;
  stackState(list).on?.fold?.(entry.dataset.id);
  return true;
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
  parts.set(section, { replies, toggle, tools: makeTools(doc), lines: new Map(), placed: null, rename: null, cover: null, coverKey: '' });
  return section;
}

// The title bar's glyphs (item 473), at the right of the dossier's title bar:
// Reply to its first message, Move below More (Bring back above More once it
// is there) and ⋯, the menu a right-click on its first message opens. Each is
// a button of its own beside the head's card, never inside it (a card is
// itself a button), so Tab reaches it; it is named, with that name as its
// tooltip. stack-look.css shows them while the dossier is under the pointer,
// selected or holds the focus, and keeps their place while they are hidden.
function makeTools(doc) {
  const tools = element(doc, 'div', 'stack-tools');
  tools.setAttribute('role', 'group');
  for (const name of ['reply', 'aside', 'menu']) {
    const button = element(doc, 'button', 'stack-tool'); button.type = 'button'; button.dataset.tool = name;
    tools.append(button);
  }
  const menu = tools.querySelector('[data-tool=menu]');
  menu.setAttribute('aria-haspopup', 'menu'); menu.setAttribute('aria-expanded', 'false');
  return tools;
}

// Names a title bar glyph: its accessible name and its tooltip are the same words.
function nameTool(button, words) {
  if (button.getAttribute('aria-label') !== words) button.setAttribute('aria-label', words);
  if (button.title !== words) button.title = words;
}

function paintTools(tools, stack, shown, { state, doc }) {
  const [reply, aside, menu] = tools.children, position = positionOf(stack);
  tools.setAttribute('aria-label', `Dossier: ${shown.name}`);
  nameTool(reply, 'Reply to the first message'); showGlyph(reply, 'reply', doc);
  reply.onclick = () => state.on?.reply?.(stack);
  // Core sends where a dossier sits with its messages; a page from a Core without positions has nowhere to move it.
  aside.hidden = !position;
  nameTool(aside, position?.below ? 'Bring back above More' : 'Move below More'); showGlyph(aside, position?.below ? 'back' : 'aside', doc);
  aside.onclick = () => state.on?.aside?.(stack, !positionOf(stack)?.below);
  nameTool(menu, 'More for this dossier');
  if (menu.textContent !== '⋯') menu.textContent = '⋯';
  // On a phone stack-look.css folds Reply and Move below More into ⋯: its menu then offers them first, by their names,
  // each with the glyph of the button that does the same (item 602): Reply the title bar's own, Move below More the
  // Reader's archive tray (item 601) and Bring back above More the tray with an arrow out.
  menu.onclick = () => {
    const folded = !reply.getClientRects().length, below = positionOf(stack)?.below;
    state.on?.menu?.(stack, menu, folded ? [{ label: reply.getAttribute('aria-label'), glyph: 'reply', act: () => state.on?.reply?.(stack) },
      ...(positionOf(stack) ? [{ label: aside.getAttribute('aria-label'), glyph: below ? 'back' : 'archive', act: () => state.on?.aside?.(stack, !below) }] : [])] : []);
  };
}

// A dossier's folder and title bar wear the colour of the agent who posted its
// first message (item 477), across their whole face, as that agent's cards
// do: the reader's own choice of colour for it, or its own. A dossier a
// person began, the reader's own included, keeps the neutral folder.
function paintFolderColor(section, stack, colorOf) {
  const color = colorOf(stack.head) ?? null;
  if (color !== null && !AGENT_PALETTE.includes(color)) throw Error(`A folder colour must be one of the palette's, not ${color}.`);
  for (const name of AGENT_PALETTE) section.classList.toggle(`agent-${name}`, name === color);
  const shown = color === null ? '' : 'agent';
  if (section.dataset.color !== shown) section.dataset.color = shown;
}

// Each drawn dossier's folder in the colour the reader now sees its first
// poster in, after they chose another colour for an agent: nothing else is
// drawn again, so nothing moves and no card loses what marks it.
export function paintFolderColors(list) {
  const state = states.get(list);
  if (!state) return;
  for (const stack of state.stacks ?? []) {
    const section = state.sections.get(stack.id);
    if (section) paintFolderColor(section, stack, stack.replies.length ? state.colorOf : () => null);
  }
}

// Item 550: a dossier whose stack another head now heads (stack-order.mjs,
// reheaded) keeps what the page holds of it for this visit, from its head
// before (from) to its head now (to): how far it is open, the first of the
// seven it shows, and whether its earlier-messages row was opened.
function rehead(state, from, to) {
  for (const kept of [state.levels, state.held]) {
    if (kept.has(from)) kept.set(to, kept.get(from)); else kept.delete(to);
    kept.delete(from);
  }
  if (state.earlier.delete(from)) state.earlier.add(to); else state.earlier.delete(to);
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
// started the stack and the marks of what that first message carries (an
// image, the reader's own note and saved reply: marks.mjs, item 127), how many
// replied and who, and what is new. starred: the reader starred a message of
// the dossier, any of them (item 635, starredDossiers), not only its first.
function paintHead(card, stack, { open, starred, state, unread, nameOf, doc }) {
  let row = headRows.get(card);
  if (!row) { row = element(doc, 'span', 'stack-head'); headRows.set(card, row); }
  if (card.firstElementChild !== row) card.prepend(row);
  card.classList.add('stack-head-card');
  const head = headOf(stack, { preview: messagePreview, unread });
  const act = (name, className, text, title) => {
    const span = element(doc, 'span', `stack-act ${className}`, text); span.dataset.stackAct = name;
    if (title) span.title = title; return span;
  };
  const name = act('rename', 'stack-name', head.name, head.typed ? `Named by ${nameOf(head.typed.by)}${head.mintedBy ? ' when the first reply landed' : ''} for everyone here. Click to rename.` : 'Click to give it a short name everyone here sees');
  const pen = act('rename', 'stack-pen', '', 'Rename'); pen.setAttribute('aria-hidden', 'true');
  // Use the same pencil and direction as the page's New message control.
  const pencil = doc.getElementById('new-message')?.querySelector('svg')?.cloneNode(true);
  if (pencil) pen.append(pencil);
  // The count in a part of its own, which never gives way on a narrow tab (stack-look.css); who replied and what is new may.
  const meta = element(doc, 'span', 'stack-meta');
  meta.append(element(doc, 'span', 'stack-count', `${head.count} ${replies(head.count)}`));
  if (head.repliers.length) meta.append(element(doc, 'span', 'stack-repliers', ` · ${head.repliers.map(nameOf).join(', ')}`));
  const checking = state.checking.get(stack.id);
  const newMark = (className, words) => {
    if (checking) return checking.node;
    const mark = act('new', className + ' stack-new-action', words, 'Open and read the newest new message');
    mark.setAttribute('role', 'button'); mark.tabIndex = 0;
    mark.setAttribute('aria-label', checking ? 'Checked; no new messages' : 'Open and read the newest new message');
    mark.onkeydown = event => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      event.preventDefault(); event.stopPropagation(); state.on?.newest?.(stack, mark);
    };
    return mark;
  };
  if (checking?.kind === 'fresh' || (!checking && head.fresh)) meta.append(newMark('stack-fresh', checking ? '✓' : ' · ' + head.fresh + ' new'));
  // A minted name says who named it, in the row (item 479); a typed one says so in its tooltip.
  const minted = head.mintedBy ? element(doc, 'span', 'stack-named', `Named by ${nameOf(head.mintedBy)}`) : null;
  if (minted) minted.title = `Named by ${nameOf(head.mintedBy)} when the first reply landed; a name anyone types replaces it`;
  // Who began it gives way last on a narrow tab (stack-look.css), cut short: its whole name is its tooltip.
  const who = element(doc, 'span', 'stack-who', nameOf(stack.head.author_id)); who.title = who.textContent;
  const carried = carriesNode(doc, carriesOf(stack.head));
  // The first message's marks stand beside who began it (paintHeadCarries puts them back there), then a minted name's mark.
  row.replaceChildren(name, pen, who, ...(carried ? [carried] : []),
    ...(minted ? [minted] : []),
    ...(checking?.kind === 'head' || (!checking && head.headNew) ? [newMark('stack-new', checking ? '✓' : 'New')] : []),
    ...(starred ? [element(doc, 'span', 'stack-star', '★ Starred')] : []),
    meta, ...(open ? [act('hide', 'stack-hide', 'Show latest and unread replies')] : []));
  row.dataset.renaming = String(state.renaming === stack.id);
  return head;
}

// A stale rendered mark confirms the explicit check, then redraws from the
// current unread predicate. Keep it through a repaint, including new arrivals.
export async function checkDossierNew(list, stack, pressed) {
  const state = stackState(list);
  if (state.checking.has(stack.id)) return;
  state.checking.set(stack.id, { kind: pressed.classList.contains('stack-fresh') ? 'fresh' : 'head', node: pressed });
  pressed.textContent = '✓'; pressed.setAttribute('aria-label', 'Checked; no new messages');
  state.again();
  const mark = state.sections.get(stack.id)?.querySelector('.stack-new-action');
  if (mark) {
    mark.textContent = '✓';
    const animation = mark.animate([{ opacity: 1, transform: 'scale(.8)' }, { opacity: 1, transform: 'scale(1)', offset: .4 },
      { opacity: 0, transform: 'scale(1)' }], { duration: 280, easing: 'ease-out', fill: 'forwards' });
    await animation.finished.catch(() => {});
  }
  state.checking.delete(stack.id); state.again();
}

// The marks alone on the row of the stack a message heads, when only what that message
// carries changed (item 127): the row's other parts, the stacks' order and the New line
// stay as they are, so nothing is arranged again. A card heading no stack has no row.
export function paintHeadCarries(card, item, doc = card.ownerDocument) {
  const row = headRows.get(card), who = row?.parentNode === card ? row.querySelector(':scope > .stack-who') : null;
  if (!who) return;
  row.querySelector(':scope > .card-carries')?.remove();
  const carried = carriesNode(doc, carriesOf(item));
  if (carried) who.after(carried);
}

// A message that no longer heads a stack is a card again.
function unhead(entry) {
  const card = cardIn(entry);
  card.classList.remove('stack-head-card');
  headRows.get(card)?.remove();
}

// A message the reader folded, as one row set into its card: who wrote it,
// its first words, and that it is folded (stack-look.css hides the rest of the
// card). folded false takes the row away and the card reads whole. A head's
// row goes after its title row, which stays first.
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
  words.textContent = messagePreview(item);
  const title = card.querySelector(':scope > .stack-head'), at = title ? title.nextElementSibling : card.firstElementChild;
  if (at !== row) card.insertBefore(row, at);
  card.dataset.folded = 'true';
}

// Item 645: consecutive drawn folded rows share one visible sender name.
// Keep each row's attribution in the accessibility tree. Work from the drawn
// structure, with no layout reads and no grouping across a dossier or a line.
export function paintFoldedNames(list, messages, state = stackState(list)) {
  const visit = nodes => {
    let previous = null;
    for (const entry of nodes) {
      if (entry.hidden || (!state.showCoordination && entry.dataset.coordination === 'agents')) continue;
      if (entry.classList.contains('reply-stack')) {
        const head = entry.querySelector(':scope > [data-id]');
        visit([...(state.only || entry.dataset.headOpen === 'true' ? [head] : []), ...entry.querySelector(':scope > .stack-replies').children]);
        previous = null;
        continue;
      }
      const item = messages.get(entry.dataset.id);
      // Only new hides settled cards and separator rows through CSS. Its
      // predicate, rather than stale data-item attributes, owns this decision.
      if (state.only && (!item || !state.only(item))) continue;
      const card = cardIn(entry), author = card.querySelector(':scope > .message-folded > .folded-author');
      const folded = item && !card.hidden && state.folded.has(item.id) && !state.earlierRows.has(item.id);
      if (author) author.classList.toggle('sr-only', Boolean(folded && previous === item.author_id));
      previous = folded ? item.author_id : null;
    }
  };
  visit(list.children);
}

// One of an open dossier's earlier messages, shown as one row set into its
// card for this visit (item 476): who wrote it and its line, as a folded row
// reads, with nothing saying it is folded, since it is not. A first message's
// row comes after its tab. on false takes the row away.
function paintEarlier(entry, item, on, { nameOf, doc }) {
  const card = cardIn(entry);
  if (!on) { earlierRows.get(card)?.remove(); if (card.dataset.earlier) card.dataset.earlier = 'false'; return; }
  let row = earlierRows.get(card);
  if (!row) { row = element(doc, 'span', 'message-earlier'); row.append(element(doc, 'span', 'folded-author'), element(doc, 'span', 'folded-words')); earlierRows.set(card, row); }
  const [author, said] = row.children;
  author.textContent = nameOf(item.author_id);
  said.textContent = messagePreview(item);
  const tab = headRows.get(card)?.parentElement === card ? headRows.get(card) : null;
  if (tab ? tab.nextElementSibling !== row : card.firstElementChild !== row) { if (tab) tab.after(row); else card.prepend(row); }
  card.dataset.earlier = 'true';
}

function renameField(section, stack, head, { state, doc }) {
  const p = parts.get(section);
  if (state.renaming !== stack.id) { p.rename?.remove(); p.rename = null; return null; }
  if (p.rename) return p.rename;
  const field = element(doc, 'div', 'stack-rename'), input = element(doc, 'input', 'stack-rename-input'), hint = element(doc, 'span', 'stack-rename-hint', 'Return saves · Esc cancels');
  input.type = 'text'; input.value = head.name; input.maxLength = 200;
  input.setAttribute('aria-label', 'Short name for this stack, for everyone here; empty gives back its first line');
  // edited: the person typed in it, so what it saves is theirs, though it
  // read the same when it opened (item 470).
  let done = false, edited = false;
  input.addEventListener('input', () => { edited = true; });
  const finish = save => { if (done) return; done = true; state.renaming = null; p.rename = null; field.remove(); save ? state.on?.renamed?.(stack, input.value, { edited }) : state.on?.cancelled?.(stack); };
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
  const { state, keep, unread, nameOf, colorOf, doc } = context;
  const p = parts.get(section), head = byId.get(stack.id), single = !stack.replies.length;
  const level = single ? 'open' : levelOf(state, stack.id);
  const coordination = state.coordination.has(stack.id);
  // Fully open, the first message shows as any message does: whole, or its
  // folded row (item 471). Open, with more than seven messages, the earlier
  // ones wait behind one row until it is opened (item 476): a first message
  // among them is its tab alone till then, and after that a row under the tab
  // (its folded row, if the reader folded it), until a press shows it whole.
  // The seven are counted when it is first drawn open, and the first of them is
  // held, so a message arriving joins them below and hides nothing; any other
  // level lets go of it, so the next opening counts again.
  const drawnOpen = !single && level === 'open';
  if (!drawnOpen) state.held.delete(stack.id);
  const before = drawnOpen ? earlierOf(stack, level, { held: state.held.get(stack.id) ?? null }) : [], earlierOpen = state.earlier.has(stack.id), headBefore = before.includes(stack.head);
  if (drawnOpen) state.held.set(stack.id, [stack.head, ...stack.replies][before.length].id);
  const held = state.held.get(stack.id) ?? null;
  const starred = Boolean(stack.head.acts?.starred), open = !single && level === 'open' && (!headBefore || earlierOpen);
  // The title bar shows the reader's star when any message of the dossier is starred by them (item 635).
  const marked = state.starred.has(dossierOf(stack));
  // Item 550: a stack gathered under a first message the page has not loaded
  // (stack-order.mjs, gather) is headed by one of its replies, a card of its
  // own before 550: folded, it shows whole, as each reply kept in view does,
  // never as its tab alone.
  const whole = open || (!single && level === 'folded' && stack.dossier !== stack.id);
  if (open && headBefore && !starred && !state.folded.has(stack.id) && !state.whole.has(stack.id)) state.earlierRows.add(stack.id);
  const kept = item => {
    if (state.kept.has(item.id)) return true;
    if (!unread(item)) return false;
    state.kept.add(item.id); return true;
  };
  head.hidden = false;
  if (!single) opened(head);
  const shown = single ? { name: messagePreview(stack.head) } : paintHead(cardIn(head), stack, { open, starred: marked, state, unread, nameOf, doc });
  p.toggle.dataset.state = level;
  Object.assign(section.dataset, { coordination: coordination ? 'agents' : '', compact: String(coordination && level === 'head' && state.renaming !== stack.id) });
  p.toggle.setAttribute('aria-expanded', String(level !== 'head'));
  p.toggle.setAttribute('aria-label', `${{ head: 'Closed; show latest and unread replies', folded: 'Latest and unread replies; show all messages', open: 'All messages; show latest and unread replies' }[level]}: ${shown.name}`);
  p.toggle.onclick = () => { setLevel(state, stack, LEVELS[(LEVELS.indexOf(level) + 1) % LEVELS.length]); state.on?.folded?.(stack, level); state.again(); };
  const desired = [];
  const rows = single ? [] : rowsOf(stack, { level, kept, unread, peeked: item => state.peeked.has(item.id), earlier: earlierOpen, held });
  // A reply drawn starred stays as an unread one does: its star taken off, here or elsewhere, never folds it away under the reader (item 413).
  for (const row of rows) if (row.kind === 'reply' && row.item.acts?.starred === true) state.kept.add(row.item.id);
  for (const row of rows) {
    if (row.kind === 'reply') {
      const entry = byId.get(row.item.id); entry.hidden = false; desired.push(entry);
      // An earlier message reads as its row; one the reader folded keeps that row, a starred one stays whole.
      if (row.earlier && !row.folded && row.item.acts?.starred !== true && !state.whole.has(row.item.id)) state.earlierRows.add(row.item.id);
      continue;
    }
    if (row.kind === 'earlier') {
      // One row for the earlier messages, at the top of the folder (item 476):
      // a press shows them all as rows, for this visit, and moves nothing
      // below More. The keys go on to the first of them when they were on it
      // and the press was not a finger's: on a phone the focus would light that
      // message, and a tap lights nothing but the message it lands on.
      const button = line(section, 'earlier', () => { const node = element(doc, 'button', 'stack-earlier'); node.type = 'button'; return node; });
      button.replaceChildren(element(doc, 'span', 'stack-earlier-words', row.words), ...(row.fresh ? [element(doc, 'span', 'stack-fresh', ` · ${row.fresh} new`)] : []));
      button.title = `Show ${row.items.length === 1 ? 'it' : `all ${row.items.length}`} as rows, for this visit`;
      button.onclick = event => {
        const focused = doc.activeElement === button && event?.pointerType !== 'touch';
        state.earlier.add(stack.id); state.again(); state.on?.earlier?.(stack, row.items.length);
        const first = entries(section.parentElement ?? section).find(each => each.dataset.id === row.items[0].id);
        if (focused && first) cardIn(first).focus({ preventScroll: true });
      };
      desired.push(button);
      for (const item of row.items) if (item !== stack.head) { const entry = byId.get(item.id); desired.push(entry); entry.hidden = !state.only?.(item); }
      continue;
    }
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
    // Only new draws a New item wherever it sits, a folded one included.
    for (const item of row.items ?? []) { const entry = byId.get(item.id); entry.hidden = !state.only?.(item); desired.push(entry); }
  }
  const used = new Set(desired);
  for (const [key, node] of p.lines) if (!used.has(node)) { node.remove(); p.lines.delete(key); }
  reconcile(p.replies, desired);
  // Presentation only: overlap adjacent visible faces, never a provenance
  // line. Hidden replies neither consume an edge nor separate two faces.
  // Item 550: what More messages filled the stack with (stack.filled) is a
  // run of whole cards a sheet gap apart, below the faces it showed: none
  // overlaps another or covers the face above it, so nothing above moves
  // and each card follows the one before as the first follows the last.
  for (const entry of [head, ...desired]) if (entry.dataset.id) {
    entry.dataset.stackOverlap = 'false'; entry.dataset.stackCovered = 'false';
    entry.dataset.stackFilled = String(Boolean(stack.filled?.has(entry.dataset.id)));
  }
  // The dossier's cover (item 624, dossier-cover.mjs): the folder's first sheet, right after the head's entry, whose
  // tab stands above the folder, and before the chevron and the replies; never inside the head's card, which closed
  // shows its tab alone. Headed by a reply, its first message above the loaded page, the folder takes it from its
  // place (stackCover). Drawn again only when what it says changes. A card with no folder takes pills instead.
  const cover = single ? null : stackCover(stack), coverContext = { viewer: state.viewer, nameOf, topicId: stack.head.topic_id };
  const key = coverKey(cover, coverContext);
  if (key !== p.coverKey) { p.cover?.remove(); p.cover = cover ? coverSheet(doc, cover, coverContext) : null; p.coverKey = key; }
  // A cover stands between the first message and the replies, so the first reply overlaps no face of the head's.
  let previousFace = whole && !p.cover ? head : null;
  for (const entry of desired) {
    if (entry.hidden) continue;
    if (!entry.dataset.id || entry.dataset.stackFilled === 'true') { previousFace = null; continue; }
    entry.dataset.stackOverlap = String(Boolean(previousFace));
    if (previousFace) previousFace.dataset.stackCovered = 'true';
    previousFace = entry;
  }
  if (stack.placed !== null && !p.placed) {
    p.placed = element(doc, 'p', 'stack-placed-line');
    const words = element(doc, 'span', 'stack-placed-words', 'Placed here by you'), free = element(doc, 'button', 'stack-unplace', 'Let new replies move it');
    free.type = 'button'; p.placed.append(words, free); p.free = free;
  }
  if (p.placed) p.free.onclick = () => state.on?.unplace?.(stack);
  const rename = single ? null : renameField(section, stack, shown, context);
  if (!single) paintTools(p.tools, stack, shown, context);
  paintFolderColor(section, stack, single ? () => null : colorOf);
  reconcile(section, [head, ...(p.cover ? [p.cover] : []), ...(rename ? [rename] : single ? [] : [p.toggle, p.tools]), p.replies, ...(stack.placed !== null ? [p.placed] : [])]);
  if (single || rename) { p.toggle.remove(); p.tools.remove(); }
  if (stack.placed === null) p.placed?.remove();
  Object.assign(section.dataset, { seq: String(stack.newest), fold: level, headOpen: String(whole), placed: String(stack.placed !== null),
    single: String(single), renaming: String(state.renaming === stack.id), covered: String(Boolean(p.cover)) });
  section.setAttribute('aria-label', single ? 'Placed message' : `Reply stack: ${shown.name}`);
}

// Gathers the list's entries into stacks and draws them, on every topic page
// alike. messages: the loaded messages by id. keep(item): a reply the usual
// fold keeps in view; once kept it stays kept, so a reply the person is
// reading is never folded away under them. unread(item): counted as new on a
// fold line and the head. viewer: who reads. nameOf(actor): a person's name
// as the page shows it. colorOf(item): the palette colour the reader sees the
// item's author in when that is an agent other than them, else null; a
// dossier's folder wears its first message's. on: what the stack's own
// controls do (stack-feed.mjs).
// home: the page's New message composer at rest (#new-message-sheet, item
// 465), drawn just above More, under the last dossier shown above it; it is
// never moved while it is up over the page, and goes to its place when next
// drawn after it is put back. While the list is hidden it rests after it, at
// the page's end.
export function arrangeStacks(list, messages, options = {}) {
  const { keep = () => false, unread = () => false, quiet = () => false, viewer = null, nameOf = id => id, colorOf = () => null, on = null, home = null, doc = list.ownerDocument } = options;
  const state = stackState(list);
  Object.assign(state, { viewer, colorOf, again: () => arrangeStacks(list, messages, options) });
  if (on) state.on = on;
  const active = list.contains(doc.activeElement) ? doc.activeElement : null;
  const byId = new Map(entries(list).map(entry => [entry.dataset.id, entry]));
  const loaded = [...byId.keys()].map(id => messages.get(id)).filter(Boolean);
  fill(state, loaded);
  const stacks = ordered(gather(loaded, { viewer, filled: state.filled, apart: state.apart }));
  for (const [from, to] of reheaded(state.stacks, stacks)) rehead(state, from, to);
  state.stacks = stacks;
  // The dossiers whose title bar shows the reader's star, and which Move below More refuses (item 635).
  state.starred = starredDossiers(stacks, id => messages.has(id));
  state.earlierRows = new Set();
  state.folded = new Set(loaded.filter(item => rowFolded(item, { peeked: each => state.peeked.has(each.id) })).map(item => item.id));
  state.coordination = new Set(stacks.filter(stack => coordinationStack(stack, quiet)).map(stack => stack.id));
  list.dataset.showCoordination = String(state.showCoordination);
  state.on?.coordinationCount?.(state.coordination.size);
  const top = [], aside = [], live = new Set(), context = { state, keep, unread, nameOf, colorOf, doc };
  state.below = new Set();
  for (const stack of stacks) {
    const head = byId.get(stack.id);
    head.dataset.coordination = state.coordination.has(stack.id) ? 'agents' : '';
    // An agent coordination dossier moves below More like any other.
    const below = drawnBelow(stack, item => { const mark = state.here.get(item.id); return mark?.pending ? placeOf(positionOf(stack)) : mark?.place ?? null; });
    if (below) state.below.add(stack.id);
    const destination = below ? aside : top;
    if (!stack.replies.length && stack.placed === null) { head.hidden = false; destination.push(head); continue; }
    live.add(stack.id);
    if (!state.sections.has(stack.id)) state.sections.set(stack.id, makeStack(doc, stack.id));
    const section = state.sections.get(stack.id);
    paintStack(section, stack, byId, context);
    destination.push(section);
  }
  // More counts the dossiers it would show: with Show agent coordination off,
  // agent coordination put aside stays hidden below More too and is not counted.
  const shownAside = aside.filter(node => state.showCoordination || node.dataset.coordination !== 'agents').length;
  state.belowCount = shownAside;
  if (shownAside && !state.more) {
    state.more = element(doc, 'button', 'stack-more'); state.more.type = 'button';
    state.more.onclick = () => { state.moreOpen = !state.moreOpen; state.again(); state.on?.more?.(); };
  }
  // Where the feed is not drawn (app.mjs drawFeed), the composer at rest goes
  // to the page's end instead, as a dialog in a box not drawn shows nothing.
  const resting = home && !home.open && !list.hidden;
  if (resting) top.push(home);
  else if (home && !home.open && home.parentElement === list) list.parentElement.append(home);
  if (shownAside) {
    state.more.textContent = `${state.moreOpen ? 'Hide' : 'More'} messages · ${shownAside} put aside`;
    state.more.setAttribute('aria-expanded', String(Boolean(state.moreOpen)));
    top.push(state.more, ...aside);
  } else { state.more?.remove(); top.push(...aside); }
  // Entries the page has that Core's messages do not name stay where they are,
  // and so does anything else that is not a dossier, More or the composer at
  // rest (a line, or what holds the composer's place while it is up).
  reconcile(list, top, node => (node === home ? resting : node.dataset.id ? messages.has(node.dataset.id) : !node.dataset.line && (node === state.more || node.classList.contains('reply-stack'))));
  for (const [id, section] of state.sections) if (!live.has(id)) { section.remove(); state.sections.delete(id); }
  for (const entry of byId.values()) if (entry.parentElement === list) entry.hidden = false;
  // Only a stack's head carries its row: a message that headed one before a
  // join, or before its replies went, is a card again.
  const heads = new Set(stacks.filter(stack => stack.replies.length).map(stack => stack.id));
  for (const [id, entry] of byId) if (!heads.has(id)) unhead(entry);
  // Every message the reader folded is its one-line row, in a stack or on its own, a stack's first message too.
  for (const [id, entry] of byId) if (messages.get(id)) paintFolded(entry, messages.get(id), state.folded.has(id), { nameOf, doc });
  // An open dossier's earlier messages, once their row is opened, read as rows (item 476).
  for (const [id, entry] of byId) if (messages.get(id)) paintEarlier(entry, messages.get(id), state.earlierRows.has(id), { nameOf, doc });
  // A card with no folder whose cover says something shows it as pills under who wrote it (item 624): a message on
  // its own, or a dossier's one reply loaded while its first message is above the page, which takes its dossier's
  // cover from its place (stackCover). A card More kept apart belongs to the dossier already drawn above it,
  // not a lone loaded message: it repeats neither that dossier's sheet nor its pills, even on a later press
  // that loads the first message itself. Any other message shows none: a folder has its cover as its sheet instead.
  const lone = new Map(stacks.filter(stack => !stack.replies.length && !state.apart.has(stack.id)).map(stack => [stack.id, stack]));
  for (const [id, entry] of byId) paintCoverPills(cardIn(entry), lone.has(id) ? stackCover(lone.get(id), { alone: true }) : null, { viewer, nameOf, topicId: messages.get(id)?.topic_id });
  // A star shows on its card wherever it is (stack-look.css).
  for (const [id, entry] of byId) { const starred = String(Boolean(messages.get(id)?.acts?.starred)); if (cardIn(entry).dataset.starred !== starred) cardIn(entry).dataset.starred = starred; }
  // What is hidden here is what shownView says is hidden: below a closed More,
  // unless Only new draws the New items there.
  const { asideShown } = shownView(state);
  for (const node of top) if (node !== state.more && node !== home) node.hidden = aside.includes(node) && !asideShown;
  if (active?.isConnected && doc.activeElement !== active) active.focus({ preventScroll: true });
  state.on?.arranged?.();
  paintFoldedNames(list, messages, state);
}

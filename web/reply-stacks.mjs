import { detailText, detailChildren } from './card-detail-dom.mjs';
import { keepOnEscape } from './keep-on-escape.mjs';
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
// documents. Explicit dossier folded/open choices are personal Core acts;
// temporary reveals and which head shows its full message stay on this page. A message the reader
// folded is their own act, kept in Core (stack-feed.mjs): wherever it shows
// it is one row, who wrote it and its first words, with a cue that it is
// folded; a stack's first message too, under its head row, which stays the
// dossier's title (item 471). An open
// dossier of more than seven messages shows its newest seven and one row for
// the earlier ones, which shows them as rows for this visit (item 476): a way
// of showing it, kept by the page alone, never recorded.
import { cardIn, opened } from './fold.mjs';
import { archiveOrder, gather, visibleStacks, withDossierHeads, dossiersOf, reheaded, ordered, rowsOf, headOf, lineUnder, rowFolded, LEVELS, positionOf, placeOf, shownOrder, drawnBelow, pageOf, shown, earlierOf, stackCover, starredDossiers, dossierOf } from './stack-order.mjs';
import { ownWithdrawnQuestion } from './question-withdrawal.mjs';
import { messagePreview } from './message-preview.mjs';
import { paintRemoval } from './message-removal.mjs';
import { shownTime } from './times.mjs';
import { coordinationStack } from './coordination-stacks.mjs';
import { carriesNode, carriesOf } from './marks.mjs';
import { coverKey, coverPreview, coverSheet, paintCoverPills, structuredCover } from './dossier-cover.mjs';
import { AGENT_PALETTE } from './author-colors.mjs';
import { showGlyph } from './glyphs.mjs';
import { firstCoverTarget, firstCoverControl, refreshLine } from './cover-refresh.mjs';

const ENTRIES = ':scope > [data-id], :scope > .reply-stack > [data-id], :scope > .reply-stack > .stack-replies > [data-id]';
const states = new WeakMap(), drawnIndexes = new WeakMap();
// Replacement is the boundary shared by arrange and bounded-record disposal.
// The index refers only to that current stack snapshot, never evicted bodies.
function indexedStacks(state, initial) {
  let stacks;
  Object.defineProperty(state, 'stacks', { enumerable: true,
    get: () => stacks,
    set: next => {
      stacks = next;
      const index = new Map();
      for (const stack of next) {
        if (!index.has(stack.id)) index.set(stack.id, { stack, item: stack.head });
        for (const item of stack.replies) if (!index.has(item.id)) index.set(item.id, { stack, item });
      }
      drawnIndexes.set(state, index);
    },
  });
  state.stacks = initial;
}
const parts = new WeakMap();
const headRows = new WeakMap();
const foldedRows = new WeakMap();
const earlierRows = new WeakMap();
const foldHeaders = new WeakMap();
const coverTools = new WeakMap();

// Retiring a passive window releases layout references as well as card DOM.
// Canonical fold/place facts return with their records; this makes no act.
export function forgetStackMessages(list, retained) {
  const state = states.get(list); if (!state) return;
  readingFrames.delete(list);
  for (const name of ['kept', 'unreadKept', 'newOpen', 'peeked', 'earlier', 'whole', 'waiting', 'filled', 'revealedFilled', 'apart', 'sourceRoots', 'writing', 'folded', 'starred', 'coordination', 'coordinationHere', 'below', 'earlierRows', 'contextRows']) {
    const set = state[name]; if (set) for (const id of set) if (!retained.has(id)) set.delete(id);
  }
  // Sections still own their DOM until arrange moves surviving children and
  // removes obsolete sections. Dropping this map entry first strands the DOM.
  for (const name of ['levels', 'savedLevels', 'here', 'checking', 'held']) {
    const map = state[name]; if (map) for (const id of map.keys()) if (!retained.has(id)) map.delete(id);
  }
  for (const node of state.scrolled.keys()) if (!node.isConnected) state.scrolled.delete(node);
  state.stacks = state.stacks.filter(stack => retained.has(stack.head.id)).map(stack => ({ ...stack,
    replies: stack.replies.filter(item => retained.has(item.id)) }));
  state.filling = null;
}

// Every message entry in the list, in the page's order: each stack's head,
// then its replies, folded ones included.
export const entries = list => [...list.querySelectorAll(ENTRIES)];

// An open dossier has two distinct stops: its header control, then its
// original message. A folded dossier's compact head is followed by its
// chevron, then the replies it shows (564). Hidden messages and controls never
// enter the arrow-key order.
export function navigationStops(list) {
  const stops = [];
  for (const entry of entries(list)) {
    // What the page draws is what the keys reach: a card laid out is a stop.
    if (!entry.getClientRects().length) continue;
    const section = entry.closest('.reply-stack');
    const toggle = section?.dataset.stack === entry.dataset.id ? section.querySelector(':scope > .stack-toggle') : null;
    const header = toggle?.getClientRects().length ? toggle : null;
    if (header && section.dataset.headOpen === 'true') stops.push(header);
    stops.push(entry);
    if (header && section.dataset.headOpen === 'false') stops.push(header);
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
// dossier's visible chevron is its own stop; anything else stands for the
// message entry it is in. Null when that is no stop.
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

// What the page keeps for a list's stacks: temporary level overrides ('folded',
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
// own (apart; stack-order.mjs, gather). These holds are never recorded;
// savedLevels is only the current Core projection, separate from visit overrides.
export function stackState(list) {
  if (!states.has(list)) {
    // Scroll events do not bubble. Capture the box's own offsets when it
    // scrolls, so carrying a card never reads layout after another move.
    const scrolled = new Map();
    list.addEventListener('scroll', event => {
      const box = event.target, left = box.scrollLeft, top = box.scrollTop;
      if (left || top) scrolled.set(box, { left, top });
      else scrolled.delete(box);
    }, { capture: true, passive: true });
    const state = { scrolled, levels: new Map(), savedLevels: new Map(), kept: new Set(), unreadKept: new Set(), newOpen: new Set(), contextRows: new Set(), peeked: new Set(), here: new Map(), renaming: null,
    stacks: [], sections: new Map(), folded: new Set(), coordination: new Set(), showCoordination: false, coordinationHere: new Set(), below: new Set(), viewer: null, again: () => {}, waiting: new Set(),
    checking: new Map(), earlier: new Set(), whole: new Set(), earlierRows: new Set(), held: new Map(), starred: new Set(), filling: null, filled: new Set(), revealedFilled: new Set(), apart: new Set() };
    indexedStacks(state, state.stacks);
    states.set(list, state);
  }
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
  for (const stack of state.stacks) for (const item of [stack.head, ...stack.replies]) { if (!item.dossierSource) { known.add(item.id); below = Math.min(below, item.seq); } }
  const last = shownStacks(state).filter(stack => !view.below(stack)).at(-1);
  state.filling = { into: last && !state.apart.has(last.id) ? last.dossier : null, drawn: new Set(state.stacks.map(stack => stack.dossier)), recollapsed: new Set(), known, below };
}

// Each message this drawing is the first to hold, older than everything
// loaded when More was pressed, of a dossier drawn then (fillFrom), joins
// the existing dossier as state.filled, wherever that dossier is drawn.
function fill(state, loaded) {
  const filling = state.filling;
  if (!filling) return;
  const dossier = dossiersOf(loaded, { filled: state.filled, apart: state.apart });
  for (const item of loaded) {
    if (state.sourceRoots?.has(item.id)) continue;
    const of = dossier.get(item.id);
    if (!filling.known.has(item.id) && item.seq < filling.below && filling.drawn.has(of)) {
      state.filled.add(item.id);
      if (!filling.recollapsed.has(of)) state.revealedFilled.add(item.id);
    }
    filling.known.add(item.id);
  }
}

// Ordinary dossiers begin open; agent-only dossiers begin as one quiet title
// row. A person's explicit level always wins.
// The header alone is only ever an agent-only dossier's (item 394): any other
// stack left there (one that stopped being agent-only, say, after ⌘Z took it
// back to its row) shows latest plus unread.
export function levelOf(state, id) {
  const level = state.levels.get(id) ?? state.savedLevels?.get(id)?.level ?? (state.coordination.has(id) ? 'head' : 'open');
  return level === 'head' && !state.coordination.has(id) ? 'folded' : level;
}

// An explicit choice starts a fresh partial view. Replies that were unread or
// starred when drawn stay put while read or unstarred, until the person
// changes the stack state.
// A message opened for that view folds to its row again; the reader's folds
// themselves are theirs in Core, and no state choice changes them. A dossier
// a link drew where it sits stays drawn there (here). Its earlier-messages row
// closes again, and what it showed whole folds back to rows (item 476).
export function setLevel(state, stack, level, { save = false } = {}) {
  state.levels.set(stack.id, level);
  state.newOpen?.delete(stack.id);
  state.peeked.delete(stack.id);
  for (const item of stack.replies) { state.kept.delete(item.id); state.unreadKept.delete(item.id); state.peeked.delete(item.id); }
  if (level !== 'open') {
    state.filling?.recollapsed.add(stack.dossier);
    for (const item of [stack.head, ...stack.replies]) state.revealedFilled?.delete(item.id);
  }
  state.earlier.delete(stack.id); for (const item of [stack.head, ...stack.replies]) state.whole.delete(item.id);
  if (save) state.on?.level?.(stack, level);
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
const archivedStarred = (state, stack) => state.starred?.has(dossierOf(stack)) === true;
const coordinationRevealed = (state, stack) => [stack.head, ...stack.replies].some(item => state.coordinationHere.has(item.id) || item.yours?.note === true);
export function shownView(state) {
  // shelved: the archive shelf is drawn beside the page, holding what More would show, so More does not open the feed.
  const only = state.only ?? null, shelved = Boolean(state.shelved), asideShown = Boolean(state.moreOpen && !shelved || only);
  return { below: stack => state.below.has(stack.id), archivedStarred: stack => archivedStarred(state, stack), only, asideShown, shelved,
    hidden: stack => (state.below.has(stack.id) && !asideShown) || (!state.showCoordination && state.coordination.has(stack.id) && !coordinationRevealed(state, stack)) };
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
  if (state.waiting.has(id)) return false;
  const found = drawnIndexes.get(state).get(id), stack = found?.stack;
  if (stack && view.hidden(stack)) return false;
  const item = found?.item ?? { id };
  if (view.only) return Boolean(view.only(item));
  return !stack || item === stack.head || shown(stack, item, { level: levelOf(state, stack.id), kept: each => state.kept.has(each.id), writing: each => state.writing?.has(each.id), newReply: each => state.unreadKept.has(each.id), newOpen: state.newOpen?.has(stack.id) ?? null, revealed: each => state.revealedFilled.has(each.id), earlier: state.earlier.has(stack.id), held: state.held.get(stack.id) ?? null });
}
// The page as stepping reads it (stack-order.mjs, pageOf and stepTarget).
export const stackPage = (state, messages = null) => pageOf(state.stacks, shownView(state), { known: messages?.values() ?? [], viewer: state.viewer });

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
  if (at === null) return entries(list).some(entry => state.waiting.has(entry.dataset.id) && Number(entry.dataset.seq) === seq) ? null : seq;
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
// the place it held when the link was followed, until an Archive or
// Bring back on any device. The page may not yet have heard of a move Core
// made before then (item 426): until the page has read Core's place again,
// the dossier is drawn where it sits wherever Core holds it (pending), and
// that read's place is the one it holds to (stack-feed.mjs, landedBelow).
// An earlier reply opens their row and shows whole for this visit (476).
// A full landing on the first message shows it whole without opening the
// earlier replies (875); an already-opened row stays as the reader left it.
// open: the dossier is drawn open whatever its level, as a topic's unread
// count lands on a message (item 613), so the row is expanded as far as it.
export function reveal(entry, { full = false, open = false } = {}) {
  const feed = entry?.closest?.('#messages');
  if (feed && states.has(feed)) {
    const state = stackState(feed);
    const stack = state.stacks.find(each => each.id === entry.dataset.id || each.replies.some(item => item.id === entry.dataset.id));
    if (!state.showCoordination && stack && state.coordination.has(stack.id)) {
      state.coordinationHere.add(entry.dataset.id); state.again();
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
    if (own !== id && !state.earlier.has(id)) { state.earlier.add(id); changed = true; }
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
  if (state.contextRows.has(id)) { state.peeked.add(id); state.again(); return true; }
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
  const open = levelOf(state, stack.id) === 'open', row = Boolean(event?.target?.closest?.('.stack-head'));
  if (act === 'hide' || (open && row)) {
    state.on?.acted?.(stack.id);
    setLevel(state, stack, 'folded', { save: true }); state.again();
    return true;
  }
  if (!open && (row || found.section.dataset.headOpen !== 'true')) { setLevel(state, stack, 'open', { save: true }); state.again(); return true; }
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
  if (!foldHeaderContext(entry)) return false;
  stackState(list).on?.fold?.(entry.dataset.id);
  return true;
}

// The same dossier context owns the header's act and its visual affordance.
function foldHeaderContext(entry) {
  const section = entry?.closest('.reply-stack');
  return section?.dataset.single === 'false' && !section.closest('.only-new');
}

// One drawn, noninteractive chevron lives in the card's padding, outside its
// author fragments and folded row. Reusing it lets CSS turn it when the saved
// fold changes; no new focus stop, listener or fold state is introduced (1167).
function paintFoldHeader(entry, doc) {
  const card = cardIn(entry), header = card.querySelector(':scope > .message-author');
  const eligible = Boolean(header && foldHeaderContext(entry)), prior = foldHeaders.get(card);
  card.classList.toggle('message-header-foldable', eligible);
  if (prior?.header !== header || !eligible) prior?.header.classList.remove('message-fold-header');
  if (!eligible) { prior?.chevron.remove(); foldHeaders.delete(card); return; }
  header.classList.add('message-fold-header');
  let chevron = prior?.chevron;
  if (!chevron) {
    const ns = 'http://www.w3.org/2000/svg';
    chevron = doc.createElementNS(ns, 'svg');
    chevron.classList.add('message-header-chevron');
    for (const [key, value] of Object.entries({ viewBox: '0 0 16 16', width: '14', height: '14', 'aria-hidden': 'true', focusable: 'false' })) chevron.setAttribute(key, value);
    const path = doc.createElementNS(ns, 'path');
    for (const [key, value] of Object.entries({ d: 'M4.5 6.5L8 10l3.5-3.5', fill: 'none', stroke: 'currentColor', 'stroke-width': '1.8', 'stroke-linecap': 'round', 'stroke-linejoin': 'round' })) path.setAttribute(key, value);
    chevron.append(path);
  }
  if (chevron.parentElement !== card) card.append(chevron);
  foldHeaders.set(card, { header, chevron });
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
    for (const item of stack.replies) { changed = state.kept.delete(item.id) || changed; changed = state.unreadKept.delete(item.id) || changed; }
    if (state.levels.get(stack.id) === 'open') { setLevel(state, stack, 'folded'); changed = true; }
  }
  if (changed) state.again();
}

// Snapshot endpoints as identities, not a cloned Range: clones retarget too.
// The live clone is instead a witness of DOM-only retargeting. A replacement
// Selection Range or a direct edit of its boundaries must win over our restore.
function keepRangeDuringMove(parent, node, ref) {
  const doc = parent.ownerDocument, selection = doc?.getSelection?.();
  const range = selection?.rangeCount === 1 && !selection.isCollapsed ? selection.getRangeAt(0) : null;
  if (!range || !node.isConnected || !selection.setBaseAndExtent ||
      ![selection.anchorNode, selection.focusNode].some(end => node.contains(end))) {
    parent.insertBefore(node, ref); return;
  }
  const endpoint = (node, offset) => ({ node, offset, data: node.data,
    before: node.childNodes?.[offset - 1], after: node.childNodes?.[offset] });
  const anchor = endpoint(selection.anchorNode, selection.anchorOffset), focus = endpoint(selection.focusNode, selection.focusOffset);
  const witness = range.cloneRange(), active = doc.activeElement;
  let chosen = false;
  const choice = event => { if (event.type !== 'focusin' || event.target !== active) chosen = true; };
  const choices = ['focusin', 'pointerdown', 'keydown', 'beforeinput', 'selectstart'];
  for (const type of choices) doc.addEventListener?.(type, choice, true);
  const valid = end => end.node.isConnected && (end.data !== undefined ? end.node.data === end.data && end.offset <= end.data.length :
    end.offset <= end.node.childNodes.length && end.node.childNodes[end.offset - 1] === end.before && end.node.childNodes[end.offset] === end.after);
  try {
    parent.insertBefore(node, ref);
    if (chosen || doc.getSelection() !== selection || selection.rangeCount !== 1 || selection.getRangeAt(0) !== range ||
        !['startContainer', 'startOffset', 'endContainer', 'endOffset'].every(key => range[key] === witness[key]) ||
        !valid(anchor) || !valid(focus) ||
        doc.activeElement !== active && doc.activeElement && doc.activeElement !== doc.body) return;
    if (selection.anchorNode !== anchor.node || selection.anchorOffset !== anchor.offset ||
        selection.focusNode !== focus.node || selection.focusOffset !== focus.offset) {
      selection.setBaseAndExtent(anchor.node, anchor.offset, focus.node, focus.offset);
    }
  } finally {
    for (const type of choices) doc.removeEventListener?.(type, choice, true);
    witness.detach?.();
  }
}

// Detachment can send focus to the body. A real focus/input choice made by
// a caller during painting wins, including a deliberate choice of the body.
function keepArrangementFocus(doc, active) {
  let changed = false;
  const chosen = event => { if (event.type !== 'focusin' || event.target !== active) changed = true; };
  const types = ['focusin', 'pointerdown', 'keydown', 'beforeinput', 'selectstart'];
  if (active) for (const type of types) doc.addEventListener?.(type, chosen, true);
  return () => {
    if (active) for (const type of types) doc.removeEventListener?.(type, chosen, true);
    if (!changed && active?.isConnected && doc.activeElement !== active && (!doc.activeElement || doc.activeElement === doc.body)) active.focus({ preventScroll: true });
  };
}

// Puts each node of desired, in order, among parent's children that count,
// moving only what is out of place.
function reconcile(parent, desired, moved, counts = () => true) {
  const next = node => { while (node && !counts(node)) node = node.nextElementSibling; return node; };
  let ref = next(parent.firstElementChild);
  for (const node of desired) {
    if (node === ref) { ref = next(ref.nextElementSibling); continue; }
    keepRangeDuringMove(parent, node, ref);
    moved.push(node);
  }
}

const element = (doc, tag, className, text) => {
  const node = doc.createElement(tag); if (className) node.className = className; if (text !== undefined) node.textContent = text; return node;
};

function makeStack(doc, id) {
  const section = element(doc, 'div', 'reply-stack'), replies = element(doc, 'div', 'stack-replies');
  const toggle = element(doc, 'button', 'stack-toggle'); toggle.type = 'button';
  replies.id = `stack-replies-${id}`; toggle.setAttribute('aria-controls', replies.id);
  section.dataset.stack = id; section.setAttribute('role', 'group');
  parts.set(section, { replies, toggle, tools: makeTools(doc), header: element(doc, 'div', 'stack-frame-head'), lines: new Map(), placed: null, rename: null, cover: null, coverKey: '' });
  return section;
}

// The title bar's glyphs (item 473), at the right of the dossier's title bar:
// Reply to its first message, Archive (Bring back once it
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

function paintTools(tools, stack, shown, { state, doc, nameOf }) {
  const reply = tools.querySelector('[data-tool=reply]'), aside = tools.querySelector('[data-tool=aside]'),
    menu = tools.querySelector('[data-tool=menu]'), position = positionOf(stack);
  const target = firstCoverTarget(stack), key = JSON.stringify([target, target?.refresh?.recipient ? nameOf(target.refresh.recipient) : null]);
  let kept = coverTools.get(tools);
  if (!kept || kept.key !== key) {
    const focused = kept?.node?.contains(doc.activeElement);
    kept?.node?.remove();
    const node = firstCoverControl(doc, stack, { nameOf, topicId: stack.head.topic_id });
    if (node) { node.dataset.tool = 'cover'; node.classList.add('stack-cover-request'); tools.prepend(node); }
    kept = { key, node }; coverTools.set(tools, kept);
    if (focused) node?.querySelector('.cover-refresh-glyph')?.focus({ preventScroll: true });
  }
  // Dossier settings still belong to the original; Reply belongs to the
  // latest loaded message, including in a gathered stack (907).
  const original = stack.id === stack.dossier;
  reply.disabled = false; menu.disabled = !original;
  tools.setAttribute('aria-label', `Dossier: ${shown.name}`);
  nameTool(reply, 'Reply to the latest message'); showGlyph(reply, 'reply', doc);
  reply.onclick = () => state.on?.reply?.(stack);
  // Core sends where a dossier sits with its messages; a page from a Core without positions has nowhere to move it.
  aside.hidden = !position;
  nameTool(aside, position?.below ? 'Bring back' : 'Archive'); showGlyph(aside, position?.below ? 'back' : 'archive', doc);
  aside.onclick = () => state.on?.aside?.(stack, !positionOf(stack)?.below);
  nameTool(menu, original ? 'More for this dossier' : 'First message not shown');
  if (menu.textContent !== '⋯') menu.textContent = '⋯';
  // On a phone stack-look.css folds Reply and Archive into ⋯: its menu then offers them first, by their names,
  // each with the glyph of the button that does the same (item 602): Reply the title bar's own, Archive the
  // Reader's archive tray (item 601) and Bring back the tray with an arrow out.
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
  const color = stack.id === stack.dossier ? colorOf(stack.head) ?? null : null;
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
    if (!section) continue;
    paintFolderColor(section, stack, state.colorOf);
    for (const control of parts.get(section).lines.values()) if (echoParts.has(control)) paintEchoColor(control, state.colorOf);
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
  for (const visible of [state.earlier, state.newOpen]) {
    if (visible.delete(from)) visible.add(to); else visible.delete(to);
  }
}

// A line of the stack's (a fold line, a join line), kept across repaints by
// key, so one holding the focus keeps it.
function line(section, key, make) {
  const { lines } = parts.get(section);
  if (!lines.has(key)) lines.set(key, make());
  return lines.get(key);
}

const echoParts = new WeakMap();

function paintEchoColor(echo, colorOf) {
  const parent = echoParts.get(echo).parent;
  const color = parent ? colorOf(parent) : null;
  for (const name of AGENT_PALETTE) echo.classList.toggle(`agent-${name}`, name === color);
  echo.dataset.color = color ? 'agent' : '';
}

function paintReplyEcho(section, entry, previous, { state, messages, nameOf, colorOf, doc }, visible) {
  const card = cardIn(entry), item = messages.get(entry.dataset.id), id = item.reply_to;
  const parent = id ? messages.get(id) : null;
  const show = visible && id && id !== previous?.dataset.id && item.reply_to_author &&
    !item.withheld && !item.removal && !item.withdrawal && !item.reply_to_withheld && !parent?.withheld;
  if (!show) {
    delete card.dataset.replyEcho;
    return null;
  }

  const echo = line(section, `reply-echo:${item.id}`, () => {
    const button = element(doc, 'button', 'reply-echo');
    button.type = 'button';
    const heading = element(doc, 'span', 'reply-echo-heading');
    const author = element(doc, 'span', 'reply-echo-author');
    const detail = element(doc, 'span', 'reply-echo-detail');
    const excerpt = element(doc, 'span', 'reply-echo-excerpt');
    heading.setAttribute('aria-hidden', 'true');
    excerpt.setAttribute('aria-hidden', 'true');
    heading.append(author, detail);
    button.append(heading, excerpt);
    echoParts.set(button, { author, detail, excerpt });
    return button;
  });
  const parts = echoParts.get(echo);
  const name = nameOf(item.reply_to_author);
  const sent = parent?.sent_ms ?? item.reply_to_sent_ms;
  const time = Number.isSafeInteger(sent) ? shownTime(sent) : '';
  const removal = parent?.removal ?? item.reply_to_removal;
  const withdrawn = Boolean(parent?.withdrawal || item.reply_to_withdrawn || removal);
  const words = withdrawn ? '' : messagePreview(parent ?? { body: item.reply_to_excerpt, preview: true });
  parts.parent = parent ?? { author_id: item.reply_to_author, author_kind: item.reply_to_author_kind };
  parts.author.dataset.words = name;
  parts.detail.dataset.words = `${time ? ` · ${time}` : ''}${withdrawn ? ' · withdrawn' : ''}`;
  parts.excerpt.dataset.words = words;
  paintEchoColor(echo, colorOf);
  const source = `${name === 'You' ? 'your' : `${name}'s`} message${time ? ` from ${time}` : ''}`;
  echo.setAttribute('aria-label', removal?.kind === 'unsent' ? `Go to the dossier for ${source}` : `Go to ${source}`);
  const description = [withdrawn ? 'Withdrawn' : words, item.reply_cover_section && `Replying to the cover · ${item.reply_cover_section}`].filter(Boolean).join('. ');
  if (description) echo.setAttribute('aria-description', description);
  else echo.removeAttribute('aria-description');
  echo.onclick = () => {
    if (removal?.kind !== 'unsent') return state.on?.landReply?.(id);
    // Core has removed the original's card and source. Its dossier is the
    // place still available from this reply.
    section.tabIndex = -1;
    section.scrollIntoView({ block: 'nearest' });
    section.focus({ preventScroll: true });
  };
  card.dataset.replyEcho = '';
  return echo;
}

const replies = n => (n === 1 ? 'reply' : 'replies');
// The head's row, set into its card: its short name (renamed in place), who
// started the stack and the marks of what that first message carries (an
// image, the reader's own note and saved reply: marks.mjs, item 127), how many
// replied and who, and what is new. The 646 star toggles its actual first message.
const headDetails = new WeakMap();
function paintHead(card, stack, { open, state, unread, nameOf, doc, separate = false, discloseNew = false, preview = null }) {
  let row = headRows.get(card);
  if (!row) { row = element(doc, 'span', 'stack-head'); headRows.set(card, row); }
  if (card.firstElementChild !== row) card.prepend(row);
  card.classList.add('stack-head-card');
  let kept = headDetails.get(row);
  if (!kept) { kept = new Map(); headDetails.set(row, kept); }
  const piece = (key, make) => { if (!kept.has(key)) kept.set(key, make()); return kept.get(key); };
  const original = stack.id === stack.dossier;
  const current = target => row.isConnected && row.contains(target) &&
    row.closest('.reply-stack')?.dataset.stack === stack.id && drawnIndexes.get(state)?.get(stack.id)?.stack.id === stack.id;
  card.dataset.dossierHead = String(original);
  const head = headOf(stack, { preview: original ? messagePreview : () => 'Dossier', unread });
  if (!original) {
    head.count += 1;
    head.repliers = [...new Set([stack.head.author_id, ...head.repliers])];
    head.headNew = false;
    head.fresh = [stack.head, ...stack.replies].filter(unread).length;
  }
  const act = (name, className, text, title) => {
    const span = element(doc, 'span', `stack-act ${className}`, text); span.dataset.stackAct = name;
    if (title) span.title = title; return span;
  };
  const name = piece('name', () => act('rename', 'stack-name'));
  detailText(name, head.name);
  name.classList.toggle('retracted-words', original && !head.typed && stack.head.removal?.kind === 'retracted');
  name.title = head.typed ? `Named by ${nameOf(head.typed.by)}${head.mintedBy ? ' when the first reply landed' : ''} for everyone here. Click to rename.` : 'Click to give it a short name everyone here sees';
  if (separate) {
    name.setAttribute('role', 'button'); name.tabIndex = -1;
    name.setAttribute('aria-label', `Rename dossier: ${head.name}`);
    const rename = event => {
      if (!current(name)) return;
      event.preventDefault(); event.stopPropagation(); state.on?.rename?.(stack);
    };
    row.onclick = rename;
    name.onkeydown = event => { if (event.key === 'Enter' || event.key === ' ') rename(event); };
  } else {
    row.onclick = null; name.onkeydown = null;
    name.removeAttribute('role'); name.removeAttribute('aria-label'); name.removeAttribute('tabindex');
  }
  const pen = piece('pen', () => {
    const node = act('rename', 'stack-pen', '', 'Rename'); node.setAttribute('aria-hidden', 'true');
    const pencil = doc.getElementById('new-message')?.querySelector('svg')?.cloneNode(true);
    if (pencil) node.append(pencil);
    return node;
  });
  const meta = piece('meta', () => element(doc, 'span', 'stack-meta'));
  const count = piece('count', () => element(doc, 'span', 'stack-count'));
  detailText(count, `${head.count} ${replies(head.count)}`);
  const repliers = head.repliers.length ? piece('repliers', () => element(doc, 'span', 'stack-repliers')) : null;
  if (repliers) detailText(repliers, ` · ${head.repliers.map(nameOf).join(', ')}`);
  const checking = state.checking.get(stack.id);
  const newMark = (className, words) => {
    const mark = checking?.node ?? piece(className, () => act('new', className + ' stack-new-action', undefined, 'Open and read the newest new message'));
    detailText(mark, words);
    mark.setAttribute('role', 'button'); mark.tabIndex = 0;
    mark.setAttribute('aria-label', checking ? 'Checked; no new messages' : 'Open and read the newest new message');
    // Binding is refreshed independently of DOM identity. Retired controls
    // cannot act, and current owners still decide permission/refusal.
    mark.onkeydown = event => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      if (!current(mark)) return;
      event.preventDefault(); event.stopPropagation(); state.on?.newest?.(stack, mark);
    };
    return mark;
  };
  const fresh = checking?.kind === 'fresh' || (!checking && !discloseNew && head.fresh) ? newMark('stack-fresh', checking ? '✓' : ' · ' + head.fresh + ' new') : null;
  detailChildren(meta, [count, ...(repliers ? [repliers] : []), ...(fresh ? [fresh] : [])]);
  const minted = head.mintedBy ? piece('minted', () => element(doc, 'span', 'stack-named')) : null;
  if (minted) {
    detailText(minted, `Named by ${nameOf(head.mintedBy)}`);
    minted.title = `Named by ${nameOf(head.mintedBy)} when the first reply landed; a name anyone types replaces it`;
  }
  const who = piece('who', () => element(doc, 'span', 'stack-who'));
  detailText(who, original ? nameOf(stack.head.author_id) : 'First message not shown'); who.title = who.textContent;
  const carried = headCarries(row, original ? carriesOf(stack.head) : null, doc);
  const star = piece('star', () => {
    const node = element(doc, 'span', 'stack-act stack-star'); node.setAttribute('role', 'button'); node.tabIndex = 0; node.dataset.stackAct = 'star';
    node.onmousedown = event => event.preventDefault();
    node.onkeydown = event => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      event.preventDefault(); event.stopPropagation(); node.click();
    };
    return node;
  });
  star.onclick = event => {
    if (!current(star)) return;
    event.preventDefault(); event.stopPropagation(); state.on?.star?.(stack);
  };
  const firstStarred = state.on?.firstStarred?.(stack) ?? (original ? Boolean(stack.head.acts?.starred) : Boolean(positionOf(stack)?.starred?.includes(dossierOf(stack))));
  const isStarred = archivedStarred(state, stack);
  const archiveStarred = state.below?.has(stack.id) === true && isStarred;
  const replyStar = isStarred && !firstStarred ? piece('reply-star', () => {
    const mark = element(doc, 'span', 'dossier-reply-star', '★\uFE0E');
    mark.setAttribute('role', 'img'); mark.setAttribute('aria-label', 'Starred dossier');
    return mark;
  }) : null;
  replyStar?.classList.toggle('archive-title-star', archiveStarred);
  star.classList.toggle('archive-title-star', archiveStarred && firstStarred);
  const starWords = firstStarred ? 'Unstar' : replyStar ? 'Star first message' : 'Star for me';
  detailText(star, firstStarred ? '★\uFE0E' : '☆\uFE0E');
  star.setAttribute('aria-label', starWords); star.title = starWords;
  star.setAttribute('aria-pressed', String(firstStarred));
  const newHead = checking?.kind === 'head' || (!checking && head.headNew) ? newMark('stack-new', checking ? '✓' : 'New') : null;
  const hide = open ? piece('hide', () => act('hide', 'stack-hide', 'Show latest and unread replies')) : null;
  paintRemoval(row, original ? stack.head : null, doc);
  const removal = row.querySelector('.message-retracted');
  detailChildren(row, [...(replyStar ? [replyStar] : []), name, pen, ...(preview ? [preview] : []), who, ...(carried ? [carried] : []), ...(minted ? [minted] : []),
    ...(newHead ? [newHead] : []), star, meta, ...(hide ? [hide] : []), ...(removal ? [removal] : [])]);
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

// One changed card's dossier reads its current confirmed New state without
// arranging the feed. Use the existing header owner, including head-New to
// unread-replies transitions, while retaining the stack's presentation.
export function paintHeadReading(card, messages, unread, nameOf) {
  const section = card.closest('.reply-stack'), list = section?.parentElement;
  if (!list) return;
  const state = states.get(list), stack = state?.stacks?.find(stack => stack.id === section.dataset.stack);
  if (!stack || state.checking.has(stack.id)) return;
  const row = section.querySelector('.stack-head');
  if (!row) return;
  const current = { ...stack, head: messages.get(stack.head.id) ?? stack.head,
    replies: stack.replies.map(item => messages.get(item.id) ?? item) };
  const host = row.parentElement;
  const discloseNew = levelOf(state, stack.id) === 'folded' && !state.only;
  paintHead(host, current, { state, unread, nameOf, doc: card.ownerDocument,
    open: Boolean(row.querySelector('.stack-hide')), separate: host.classList.contains('stack-frame-head'), discloseNew });
  if (discloseNew) {
    const button = parts.get(section)?.lines.get('new-replies');
    if (button) paintUnreadDisclosure(button, current.replies.filter(unread).length, state.newOpen.has(stack.id));
  }
}

// The marks alone on the row of the stack a message heads, when only what that message
// carries changed (item 127): the row's other parts, the stacks' order and the New line
// stay as they are, so nothing is arranged again. A card heading no stack has no row.
function headCarries(row, carries, doc) {
  const kept = headDetails.get(row), key = JSON.stringify(carries);
  if (kept.get('carries-key') !== key) {
    kept.set('carries-key', key); kept.set('carries', carries ? carriesNode(doc, carries) : null);
  }
  return kept.get('carries');
}

export function paintHeadCarries(card, item, doc = card.ownerDocument) {
  const section = card.closest('.reply-stack');
  if (section?.dataset.stack !== item.id) return;
  card = section.querySelector(':scope > .stack-frame-head') ?? card;
  if (card.dataset.dossierHead !== 'true') return;
  const row = headRows.get(card), who = row?.parentElement === card ? row.querySelector(':scope > .stack-who') : null;
  if (!who) return;
  const carried = headCarries(row, carriesOf(item), doc), previous = row.querySelector(':scope > .card-carries');
  if (previous !== carried) previous?.remove();
  if (carried && carried.parentElement !== row) who.after(carried);
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
function paintFolded(entry, item, folded, { nameOf, doc, context }) {
  if (context) entry.dataset.stackContext = 'true';
  else delete entry.dataset.stackContext;
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
  words.classList.toggle('retracted-words', item.removal?.kind === 'retracted');
  paintRemoval(row, item, doc);
  const title = card.querySelector(':scope > .stack-head'), at = title ? title.nextElementSibling : card.firstElementChild;
  if (at !== row) card.insertBefore(row, at);
  card.dataset.folded = 'true';
}

// Item 645: consecutive drawn folded rows share one visible sender name.
// Keep each row's attribution in the accessibility tree. Work from the drawn
// structure, with no layout reads and no grouping across a dossier or a line.
export function paintFoldedNames(list, messages, state = stackState(list), roots = list.children) {
  const visit = nodes => {
    let previous = null;
    for (const entry of nodes) {
      if (!entry || entry.hidden || (!state.showCoordination && entry.dataset.coordination === 'agents' && entry.dataset.coordinationRevealed !== 'true')) continue;
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
  visit(roots);
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
  said.classList.toggle('retracted-words', item.removal?.kind === 'retracted');
  paintRemoval(row, item, doc);
  const tab = headRows.get(card)?.parentElement === card ? headRows.get(card) : null;
  if (tab ? tab.nextElementSibling !== row : card.firstElementChild !== row) { if (tab) tab.after(row); else card.prepend(row); }
  card.dataset.earlier = 'true';
}

function renameField(section, stack, head, { state, doc }) {
  const p = parts.get(section);
  if (state.renaming !== stack.id) { p.rename?.remove(); p.rename = null; return null; }
  if (p.rename) return p.rename;
  const field = element(doc, 'div', 'stack-rename'), input = element(doc, 'input', 'stack-rename-input'), hint = element(doc, 'span', 'stack-rename-hint', 'Return or Esc saves');
  input.type = 'text'; input.value = head.name; input.maxLength = 200;
  input.setAttribute('aria-label', 'Short name for this stack, for everyone here; empty Escape keeps its name, empty Return gives back its first line');
  // edited: the person typed in it, so what it saves is theirs, though it
  // read the same when it opened (item 470).
  let done = false, saving = false, edited = false;
  input.addEventListener('input', () => { edited = true; });
  const finish = async save => {
    if (done || saving) return;
    saving = true; input.readOnly = true;
    try {
      if (save) { const saved = state.on?.renamed?.(stack, input.value, { edited }); if (saved?.then) await saved; }
      if (p.rename !== field || state.renaming !== stack.id) return;
      done = true; state.renaming = null; p.rename = null; field.remove();
      if (save) state.on?.renameFinished?.(stack); else state.on?.cancelled?.(stack);
    } catch (error) { if (p.rename === field && state.renaming === stack.id) { hint.textContent = error.message; input.focus(); } }
    finally { saving = false; input.readOnly = false; }
  };
  input.addEventListener('keydown', event => {
    if (event.isComposing || event.keyCode === 229) return;
    if (keepOnEscape(event, { value: input.value, save: () => finish(true), close: () => finish(false) })) return;
    if (event.key === 'Enter') { event.preventDefault(); event.stopPropagation(); finish(true); }
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

function paintUnreadDisclosure(button, count, open) {
  detailText(button, open && !count ? 'Hide new replies' : `${count} new`);
  button.hidden = !open && !count;
  button.setAttribute('aria-expanded', String(open));
}

function paintStack(section, stack, byId, context) {
  const { state, keep, unread, nameOf, colorOf, doc, moved } = context;
  const p = parts.get(section), head = byId.get(stack.id), single = !stack.replies.length;
  const level = single ? 'open' : levelOf(state, stack.id);
  const coordination = state.coordination.has(stack.id);
  // Fully open, the first message shows as any message does: whole, or its
  // folded row (item 471). Open, with more than seven messages, the earlier
  // ones wait behind one row until it is opened (item 476): a first message
  // among them is its tab alone till then. Once shown, its personal fold
  // alone chooses its row or whole message, as its Fold menu does (1101).
  // The seven are counted when it is first drawn open, and the first of them is
  // held, so a message arriving joins them below and hides nothing; any other
  // level lets go of it, so the next opening counts again.
  const drawnOpen = !single && level === 'open';
  if (!drawnOpen) state.held.delete(stack.id);
  const before = drawnOpen ? earlierOf(stack, level, { held: state.held.get(stack.id) ?? null }) : [], earlierOpen = state.earlier.has(stack.id), headBefore = before.includes(stack.head);
  if (drawnOpen) state.held.set(stack.id, [stack.head, ...stack.replies][before.length].id);
  const held = state.held.get(stack.id) ?? null;
  const open = !single && level === 'open' && (!headBefore || earlierOpen || state.whole.has(stack.id));
  // Item 550: a stack gathered under a first message the page has not loaded
  // (stack-order.mjs, gather) is headed by one of its replies, a card of its
  // own before 550: folded, it shows whole, as each reply kept in view does,
  // never as its tab alone.
  const whole = single || open || stack.dossier !== stack.id || stack.head.yours?.note === true || state.writing.has(stack.head.id);
  const kept = item => {
    if (state.kept.has(item.id)) return true;
    if (!unread(item)) return false;
    state.kept.add(item.id); return true;
  };
  head.hidden = false;
  if (!single) opened(head);
  const separate = single || Boolean(state.only);
  if (separate) unhead(head);
  const cover = state.apart.has(stack.id) ? null : stackCover(stack, { alone: true, provenance: true });
  const coverContext = { viewer: state.viewer, nameOf, topicId: stack.head.topic_id, rootId: dossierOf(stack) };
  const key = coverKey(cover, coverContext);
  const coverClosed = level === 'head' && !whole && !separate && structuredCover(cover);
  if (coverClosed && p.previewKey !== key) {
    p.preview = coverPreview(doc, cover, coverContext);
    p.previewKey = key;
  }
  const shown = paintHead(separate ? p.header : cardIn(head), stack, { open: open && !separate, state, unread, nameOf, doc, separate,
    discloseNew: level === 'folded' && !state.only, preview: coverClosed ? p.preview : null });
  section.dataset.coverClosed = String(coverClosed);
  p.toggle.dataset.state = level;
  Object.assign(section.dataset, { coordination: coordination ? 'agents' : '', compact: String(!separate && !whole && coordination && level === 'head' && state.renaming !== stack.id && !stack.replies.some(item => item.yours?.note === true || state.writing.has(item.id))) });
  p.toggle.setAttribute('aria-expanded', String(level !== 'head'));
  p.toggle.setAttribute('aria-label', `${{ head: 'Closed; show latest and unread replies', folded: 'Closed replies; show all messages', open: 'All messages; show latest and unread replies' }[level]}: ${shown.name}`);
  p.toggle.onclick = () => { setLevel(state, stack, LEVELS[(LEVELS.indexOf(level) + 1) % LEVELS.length], { save: true }); state.on?.folded?.(stack, level); state.again(); };
  const desired = [];
  const newReply = item => {
    if (unread(item)) state.unreadKept.add(item.id);
    return state.unreadKept.has(item.id);
  };
  const newOpen = state.newOpen.has(stack.id);
  if (level === 'folded' && !state.only) {
    const fresh = stack.replies.filter(unread);
    if (fresh.length || newOpen) {
      const button = line(section, 'new-replies', () => {
        const node = element(doc, 'button', 'stack-earlier stack-unread-disclosure');
        node.type = 'button'; return node;
      });
      paintUnreadDisclosure(button, fresh.length, newOpen);
      button.setAttribute('aria-controls', p.replies.id);
      button.onclick = () => {
        if (newOpen) {
          state.newOpen.delete(stack.id);
          for (const item of stack.replies) {
            state.unreadKept.delete(item.id);
            if (state.contextRows.has(item.id)) state.peeked.delete(item.id);
          }
        } else state.newOpen.add(stack.id);
        state.again();
        if (!button.isConnected) p.toggle.focus({ preventScroll: true });
      };
      desired.push(button);
    }
  }
  const rows = single ? [] : rowsOf(stack, { level, kept, writing: item => state.writing.has(item.id), unread, newReply, revealed: item => state.revealedFilled.has(item.id), peeked: item => state.peeked.has(item.id), earlier: earlierOpen, held, headWhole: open, newOpen: state.only ? null : newOpen });
  // A reply drawn starred stays as an unread one does: its star taken off, here or elsewhere, never folds it away under the reader (item 413).
  for (const row of rows) if (row.kind === 'reply' && row.item.acts?.starred === true) state.kept.add(row.item.id);
  for (const row of rows) {
    if (row.kind === 'reply') {
      const entry = byId.get(row.item.id); entry.hidden = false; desired.push(entry);
      if (row.context && row.folded) { state.contextRows.add(row.item.id); state.folded.add(row.item.id); }
      // An earlier message reads as its row; one the reader folded keeps that row, a starred one stays whole.
      if (row.earlier && !row.folded && !state.writing.has(row.item.id) && row.item.yours?.note !== true && row.item.acts?.starred !== true && !state.whole.has(row.item.id)) state.earlierRows.add(row.item.id);
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
      button.title = `Show ${row.items.length === 1 ? 'it' : `all ${row.items.length}`}, for this visit`;
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
  const headVisible = state.only ? state.only(stack.head) : whole;
  const headEcho = paintReplyEcho(section, head, null, context, headVisible);
  let previous = headVisible ? head : null;
  const withEchoes = [];
  for (const entry of desired) {
    if (entry.dataset.id) {
      const echo = paintReplyEcho(section, entry, previous, context, !entry.hidden);
      if (echo) withEchoes.push(echo);
    }
    if (!entry.hidden) previous = entry.dataset.id ? entry : null;
    withEchoes.push(entry);
  }
  const used = new Set([...withEchoes, headEcho]);
  for (const [key, node] of p.lines) if (!used.has(node)) { node.remove(); p.lines.delete(key); }
  reconcile(p.replies, withEchoes, moved);
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
  // The cover is first in the folder under its tab, before any message face.
  // A reply-headed or singleton folder takes the same cover from its dossier.
  // Drawn again only when what it says changes; never duplicated as card pills.
  if (key !== p.coverKey) {
    const previous = p.cover;
    p.cover = cover ? coverSheet(doc, cover, coverContext, previous) : null;
    if (previous !== p.cover) previous?.remove();
    p.coverKey = key;
  }
  // The cover precedes every message; adjacent message faces overlap as usual.
  let previousFace = whole ? head : null;
  for (const entry of withEchoes) {
    if (entry.hidden) continue;
    if (!entry.dataset.id || entry.dataset.stackFilled === 'true') { previousFace = null; continue; }
    entry.dataset.stackOverlap = String(Boolean(previousFace));
    if (previousFace) previousFace.dataset.stackCovered = 'true';
    previousFace = entry;
  }
  if (stack.placed !== null && !p.placed) {
    p.placed = element(doc, 'p', 'stack-placed-line');
    const words = element(doc, 'span', 'stack-placed-words', 'Placed here by you'), free = element(doc, 'button', 'stack-unplace', 'Reset position');
    free.type = 'button'; p.placed.append(words, free); p.free = free;
  }
  if (p.placed) p.free.onclick = () => state.on?.unplace?.(stack);
  const rename = renameField(section, stack, shown, context);
  paintTools(p.tools, stack, shown, context);
  p.requestLine?.remove();
  const firstTarget = firstCoverTarget(stack);
  p.requestLine = !p.cover && firstTarget ? refreshLine(doc, firstTarget, coverContext) : null;
  section.dataset.askCover = String(Boolean(coverTools.get(p.tools)?.node));
  paintFolderColor(section, stack, colorOf);
  reconcile(section, [...(separate ? [p.header] : []), ...(p.cover ? [p.cover] : []), ...(p.requestLine ? [p.requestLine] : []), ...(headEcho ? [headEcho] : []), head, ...(rename ? [rename] : [...(separate ? [] : [p.toggle]), p.tools]), p.replies, ...(stack.placed !== null ? [p.placed] : [])], moved);
  if (!separate) p.header.remove();
  if (separate || rename) p.toggle.remove();
  if (rename) p.tools.remove();
  if (stack.placed === null) p.placed?.remove();
  Object.assign(section.dataset, { seq: String(stack.newest), fold: level, headOpen: String(whole), placed: String(stack.placed !== null),
    single: String(single), dossier: stack.dossier, empty: String(Boolean(state.only && ![stack.head, ...stack.replies].some(state.only))),
    renaming: String(state.renaming === stack.id), covered: String(Boolean(p.cover)) });
  section.setAttribute('aria-label', `Dossier: ${shown.name}`);
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
// A read changes presentation, never Core position/structure. Snapshot those
// facts as bytes: shared message objects may be mutated in place later. Body,
// names and covers are presentation, not grouping/order inputs. Keep position's
// observation clock: changing which position wins can change the effective key.
const readingFrames = new WeakMap();
function readingProjection(item) {
  const { unread, reactions, replied, awaiting_reply, body, acts, stack_position, ...other } = item;
  const structural = value => {
    if (!value) return value;
    const { name, name_revision, cover, cover_revision, cover_read_seq, cover_refresh, cover_refresh_revision, ...facts } = value;
    return facts;
  };
  return JSON.stringify([other, structural(acts), structural(stack_position)]);
}
function readingMode(state) {
  return JSON.stringify([state.viewer, state.showCoordination, state.moreOpen,
    state.shelved, state.renaming]);
}
function rememberReadingFrame(list, messages, byId, state, options) {
  readingFrames.set(list, { entries: new Map(byId), options, only: state.only, mode: readingMode(state),
    shapes: new Map([...new Set([...byId.keys(), ...state.stacks.flatMap(stack => [stack.dossier,
      ...(stack.sourceStack ? [stack.sourceStack.head.id, ...stack.sourceStack.replies.map(item => item.id)] : [])])])]
      .filter(id => messages.get(id)).map(id => [id, readingProjection(messages.get(id))])),
    levels: new Map(state.stacks.map(stack => [stack.id, levelOf(state, stack.id)])) });
}

// Repaint existing affected folders without gathering, sorting or reconciling
// the outer list. False asks the caller to use the ordinary arrangement owner.
// Preflight every affected folder before making any presentation change.
export function repaintStackReading(list, ids, messages) {
  const state = states.get(list), frame = readingFrames.get(list);
  if (!state || !frame || frame.only !== state.only || frame.mode !== readingMode(state)) return false;
  const index = drawnIndexes.get(state), affected = new Set();
  for (const id of ids) {
    const found = index.get(id);
    if (found) affected.add(found.stack);
    else if (messages.has(id)) return false;
  }
  const ready = [];
  for (const stack of affected) {
    const section = state.sections.get(stack.id);
    if (!section?.isConnected || section.parentElement !== list || frame.levels.get(stack.id) !== levelOf(state, stack.id)) return false;
    const members = [stack.head, ...stack.replies].map(item => messages.get(item.id));
    const source = stack.sourceStack, references = [...new Set([stack.dossier,
      ...(source ? [source.head.id, ...source.replies.map(item => item.id)] : [])])];
    if (members.some(item => !item || frame.shapes.get(item.id) !== readingProjection(item)) ||
        references.some(id => frame.shapes.has(id) && (!messages.get(id) || frame.shapes.get(id) !== readingProjection(messages.get(id))))) return false;
    const byId = new Map();
    for (const item of members) {
      const entry = frame.entries.get(item.id);
      if (!entry?.isConnected || entry.closest('.reply-stack') !== section ||
          (cardIn(entry).getAttribute('data-card-reply') != null) !== state.writing.has(item.id)) return false;
      byId.set(item.id, entry);
    }
    ready.push({ before: stack, stack: { ...stack, head: members[0], replies: members.slice(1),
      ...(source ? { sourceStack: { ...source, head: messages.get(source.head.id), replies: source.replies.map(item => messages.get(item.id)) } } : {}) }, section, byId });
  }
  const { keep = () => false, unread = () => false, nameOf = id => id, colorOf = () => null, doc = list.ownerDocument } = frame.options;
  const active = list.contains(doc.activeElement) ? doc.activeElement : null, moved = [];
  const restoreFocus = keepArrangementFocus(doc, active);
  try {
  for (const { before, stack, section, byId } of ready) {
    state.stacks[state.stacks.indexOf(before)] = stack;
    for (const item of [stack.head, ...stack.replies]) {
      index.set(item.id, { stack, item });
      state.earlierRows.delete(item.id); state.contextRows.delete(item.id);
      if (!state.writing.has(item.id) && rowFolded(item, { peeked: each => state.peeked.has(each.id) })) state.folded.add(item.id);
      else state.folded.delete(item.id);
    }
    paintStack(section, stack, byId, { state, messages, keep, unread, nameOf, colorOf, doc, moved });
    const heads = stack.replies.length && !state.only;
    for (const [id, entry] of byId) {
      const item = messages.get(id);
      if (!heads || id !== stack.id) unhead(entry);
      paintFolded(entry, item, state.folded.has(id), { nameOf, doc, context: state.contextRows.has(id) });
      paintEarlier(entry, item, state.earlierRows.has(id), { nameOf, doc });
      paintFoldHeader(entry, doc);
    }
    paintFoldedNames(list, messages, state, [section]);
  }
  if (!ready.length) return true;
  const coordinationNews = state.stacks.some(stack => state.coordination.has(stack.id) && [stack.head, ...stack.replies].some(unread));
  state.on?.coordinationCount?.(state.coordination.size, coordinationNews);
  if (ready.some(({ stack }) => state.below.has(stack.id))) state.on?.archived?.(state.stacks
    .filter(stack => state.below.has(stack.id) && (state.showCoordination || !state.coordination.has(stack.id)))
    .map(stack => ({ stack, section: state.sections.get(stack.id), starred: archivedStarred(state, stack) })));
  for (const [box, position] of state.scrolled) {
    if (!list.contains(box)) { state.scrolled.delete(box); continue; }
    if (!moved.some(node => node.contains(box))) continue;
    box.scrollLeft = position.left; box.scrollTop = position.top; state.scrolled.delete(box);
  }
  state.on?.arranged?.();
  return true;
  } finally { restoreFocus(); }
}

export function arrangeStacks(list, messages, options = {}) {
  const { keep = () => false, unread = () => false, quiet = () => false, viewer = null, nameOf = id => id, colorOf = () => null, on = null, home = null, coordinationHost = null, doc = list.ownerDocument } = options;
  const state = stackState(list);
  Object.assign(state, { viewer, colorOf, again: on?.arrange ?? (() => arrangeStacks(list, messages, options)) });
  if (on) state.on = on;
  const active = list.contains(doc.activeElement) ? doc.activeElement : null;
  const restoreFocus = keepArrangementFocus(doc, active);
  try {
  const byId = new Map(entries(list).map(entry => [entry.dataset.id, entry]));
  // At document top New above stands for arrivals not drawn yet. Keep their
  // actual cards connected, without admitting them to dossier layout. Their
  // records remain in messages; this changes neither unread nor order keys.
  const waiting = [];
  for (const id of state.waiting) {
    const entry = byId.get(id);
    if (!entry || !messages.has(id)) { state.waiting.delete(id); continue; }
    entry.hidden = true;
    waiting.push(entry); byId.delete(id);
  }
  const loaded = [...byId.keys()].map(id => messages.get(id)).filter(Boolean);
  // Keep structural entries connected for later arrangements, but outside
  // every visible stack and every folded/earlier row painter. No saved hide
  // choice: each arrangement derives it from the current withdrawal fact.
  const withdrawn = new Map();
  for (const item of loaded) if (ownWithdrawnQuestion(item, viewer)) {
    withdrawn.set(item.id, byId.get(item.id)); byId.delete(item.id);
  }
  state.sourceRoots ??= new Set();
  for (const item of loaded) if (item.dossierSource) state.sourceRoots.add(item.id);
  for (const id of state.sourceRoots) { state.filled.delete(id); state.revealedFilled.delete(id); state.apart.delete(id); }
  // A root already displayed as a source keeps the same loaded branch anchor
  // when More reaches it. Otherwise an earlier own branch could jump above
  // the formerly gathered head. The root's actual item now owns its bytes.
  // Stars never change this presentation-only boundary or the ordinary
  // filled/apart classification: neither act may rehead or reorder a dossier.
  const sourceRoots = state.sourceRoots;
  const descendants = loaded.filter(item => !sourceRoots.has(item.id));
  const dossiers = new Set(dossiersOf(descendants).values());
  const paged = loaded.filter(item => !sourceRoots.has(item.id) || !dossiers.has(item.id));
  fill(state, paged);
  const gathered = withDossierHeads(ordered(gather(paged, { viewer, filled: state.filled, apart: state.apart })), messages, { apart: state.apart, sourceRoots });
  const stacks = visibleStacks(gathered, viewer);
  for (const [from, to] of reheaded(state.stacks, stacks)) rehead(state, from, to);
  state.stacks = stacks;
  // Hydrate the existing Core projection without performing an explicit gesture:
  // remote choices must not release writing/reading holds. An unchanged read
  // preserves a temporary link reveal; a new choice or canonical root replaces it.
  for (const stack of stacks) {
    const position = positionOf(stack);
    if (!position || !('level_revision' in position)) continue;
    const next = { root: position.root_id, level: position.level, revision: position.level_revision };
    const before = state.savedLevels.get(stack.id);
    if (before && (before.root !== next.root || before.revision !== next.revision || before.level !== next.level)) state.levels.delete(stack.id);
    state.savedLevels.set(stack.id, next);
  }
  // The dossiers whose title bar shows the reader's star, and which Archive refuses (item 635).
  // The inline-composer owner marks its open cards. This is a local reading
  // hold, not a Core preference: a remote collapse cannot hide active writing.
  state.writing = new Set(loaded.filter(item => cardIn(byId.get(item.id))?.getAttribute('data-card-reply') != null).map(item => item.id));
  state.starred = starredDossiers(gathered, id => messages.has(id));
  state.earlierRows = new Set(); state.contextRows = new Set();
  state.folded = new Set(loaded.filter(item => !state.writing.has(item.id) && rowFolded(item, { peeked: each => state.peeked.has(each.id) })).map(item => item.id));
  state.coordination = new Set(stacks.filter(stack => coordinationStack(stack, quiet)).map(stack => stack.id));
  list.dataset.showCoordination = String(state.showCoordination);
  const coordinationNews = stacks.some(stack => state.coordination.has(stack.id) && [stack.head, ...stack.replies].some(unread));
  state.on?.coordinationCount?.(state.coordination.size, coordinationNews);
  const top = [...waiting, ...withdrawn.values()], archived = [], live = new Set(), moved = [], context = { state, messages, keep, unread, nameOf, colorOf, doc, moved };
  state.below = new Set();
  for (const stack of stacks) {
    const head = byId.get(stack.id);
    head.dataset.coordination = state.coordination.has(stack.id) ? 'agents' : '';
    // An agent coordination dossier moves below More like any other.
    const below = drawnBelow(stack, item => { const mark = state.here.get(item.id); return mark?.pending ? placeOf(positionOf(stack)) : mark?.place ?? null; });
    if (below) state.below.add(stack.id);
    live.add(stack.id);
    if (!state.sections.has(stack.id)) state.sections.set(stack.id, makeStack(doc, stack.id));
    const section = state.sections.get(stack.id);
    paintStack(section, stack, byId, context);
    section.dataset.coordinationRevealed = String(coordinationRevealed(state, stack));
    if (below) archived.push(stack); else top.push(section);
  }
  const aside = archiveOrder(archived, stack => archivedStarred(state, stack)).map(stack => state.sections.get(stack.id));
  // More counts the dossiers it would show: with Show agent coordination off,
  // agent coordination put aside stays hidden below More too and is not counted.
  const shownAside = aside.filter(node => state.showCoordination || node.dataset.coordination !== 'agents').length;
  state.belowCount = shownAside;
  if (shownAside && !state.more) {
    state.more = element(doc, 'button', 'stack-more'); state.more.type = 'button';
    state.more.onclick = () => { state.on?.navigate?.(); state.moreOpen = !state.moreOpen; state.again(); state.on?.more?.(); };
  }
  // Where the feed is not drawn (app.mjs drawFeed), the composer at rest goes
  // to the page's end instead, as a dialog in a box not drawn shows nothing.
  const resting = home && !home.open && !list.hidden;
  if (resting) top.push(home);
  else if (home && !home.open && home.parentElement === list) list.parentElement.append(home);
  if (shownAside) {
    state.more.textContent = `Archived (${shownAside})`;
    state.more.setAttribute('aria-expanded', String(Boolean(state.moreOpen)));
  } else state.more?.remove();
  if (shownAside || coordinationHost && state.coordination.size) {
    state.controls ??= element(doc, 'div', 'stack-controls');
    if (shownAside) state.controls.append(state.more);
    if (coordinationHost) state.controls.append(coordinationHost);
    top.push(state.controls);
  } else state.controls?.remove();
  top.push(...aside);
  // Entries the page has that Core's messages do not name stay where they are,
  // and so does anything else that is not a dossier, More or the composer at
  // rest (a line, or what holds the composer's place while it is up).
  reconcile(list, top, moved, node => (node === home ? resting : node.dataset.id ? messages.has(node.dataset.id) : !node.dataset.line && (node === state.controls || node === state.more || node.classList.contains('reply-stack'))));
  for (const [id, section] of state.sections) if (!live.has(id)) { section.remove(); state.sections.delete(id); }
  // The archive shelf: the dossiers below More, in their order, for the right rail's foot; after reconcile, so the
  // sections it reads its replicas' look from are on the page.
  state.on?.archived?.(stacks.filter(stack => state.below.has(stack.id) && (state.showCoordination || !state.coordination.has(stack.id))).map(stack => ({ stack, section: state.sections.get(stack.id), starred: archivedStarred(state, stack) })));
  for (const entry of byId.values()) if (entry.parentElement === list) entry.hidden = false;
  // Only a stack's head carries its row: a message that headed one before a
  // join, or before its replies went, is a card again.
  const heads = new Set(stacks.filter(stack => stack.replies.length && !state.only).map(stack => stack.id));
  for (const [id, entry] of byId) if (!heads.has(id)) unhead(entry);
  // Every message the reader folded is its one-line row, in a stack or on its own, a stack's first message too.
  for (const [id, entry] of byId) if (messages.get(id)) paintFolded(entry, messages.get(id), state.folded.has(id), { nameOf, doc, context: state.contextRows.has(id) });
  // An open dossier's earlier messages, once their row is opened, read as rows (item 476).
  for (const [id, entry] of byId) if (messages.get(id)) paintEarlier(entry, messages.get(id), state.earlierRows.has(id), { nameOf, doc });
  for (const entry of byId.values()) paintFoldHeader(entry, doc);
  // Every admitted entry now has a folder and its cover sheet. Clear any
  // pills left from the former standalone rendering, including apart cards.
  for (const [id, entry] of byId) paintCoverPills(cardIn(entry), null, { viewer, nameOf, topicId: messages.get(id)?.topic_id });
  // A star shows on its card wherever it is (stack-look.css).
  for (const [id, entry] of byId) { const starred = String(Boolean(messages.get(id)?.acts?.starred)); if (cardIn(entry).dataset.starred !== starred) cardIn(entry).dataset.starred = starred; }
  // What is hidden here is what shownView says is hidden: below a closed More,
  // unless Only new draws the New items there.
  const { asideShown } = shownView(state);
  for (const node of top) if (node !== state.controls && node !== home) node.hidden = withdrawn.has(node.dataset.id) || state.waiting.has(node.dataset.id) || aside.includes(node) && !asideShown;
  // Detaching a card can reset its table or long-message scroll. Restore
  // only boxes known from their scroll events inside a node actually moved,
  // after every nested/outer move, without reading positions or descendants.
  // Consume the attempt even when a hidden box cannot take the write: only
  // a fresh scroll event may record another restore (item 896).
  for (const [box, { left, top }] of state.scrolled) {
    if (!list.contains(box)) { state.scrolled.delete(box); continue; }
    if (!moved.some(node => node.contains(box))) continue;
    box.scrollLeft = left; box.scrollTop = top;
    state.scrolled.delete(box);
  }
  state.on?.arranged?.();
  paintFoldedNames(list, messages, state);
  rememberReadingFrame(list, messages, byId, state, options);
  } finally { restoreFocus(); }
}

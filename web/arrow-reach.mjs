// The arrows always land somewhere (item 301; docs/interaction.md, "The
// arrows everywhere"). An arrow that nothing on the page used, from anywhere
// outside writing, moves the focus to the nearest control that way on screen,
// as a person looking at the page would go: down to what is below, right to
// what is beside. So no arrow loses the focus to the page or leaves it stuck
// where something lies that way, and everything a click reaches the arrows
// reach too.
//
// The panes keep their own keys (pane-keys.mjs): the outline's and the right
// rail's trees (key-tree.mjs), the messages and the buttons at the top of the
// feed (panes.mjs), a deck's cards (deck-page.mjs), menus, chips and pickers
// all answer their arrows first, and say so (preventDefault); this hears only
// what is left, on the window, after them. Where a pane's own keys end at an
// edge with more of the page beyond it (the outline's first and last rows, the
// right rail's first section, the last message), the pane hands the key on
// here (reach), within its own column.
//
// Never in writing: in a field the arrows are the writing's, but for ↑ and ↓
// in a one-line field or an empty box, which have no other line to go to. A focused box that
// can still scroll that way (a message's text in the Reader) scrolls, and once
// at its end the arrows go on. While a pop-up is open the arrows move only
// through it. With nothing focused, ↓ goes to the first control in view from
// the top, ↑ to the last, → to the first from the left and ← from the right.
import { revealSelection } from './reveal.mjs';

export const WAYS = { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right' };
const FIELD = 'input, textarea, select, [contenteditable=""], [contenteditable="true"]';
// What takes the focus: the controls a click or Tab reaches, and a roving tree's one stop.
const CONTROL = 'a[href], button, summary, input:not([type=hidden]), select, textarea, [tabindex], [contenteditable=""], [contenteditable="true"]';
// Widgets whose arrows are their own (a radio group, a slider, a menu's items, a list's options).
const OWNS = '[role=slider], [role=spinbutton], [role=radio], [role=tab], [role=option], [role=menuitem], [role=menuitemradio], [role=menuitemcheckbox], [role=gridcell], [role=treeitem], input[type=range]';

// The nearest of candidates ({ el, box }) the way named from the box `from`
// (each box { top, bottom, left, right }), or null. A candidate lies that way
// when its middle is past the from's middle and both its edges lie further
// that way than the from's (so what holds the from is never that way of it).
// Nearest is the gap that way plus twice the gap across, so what is straight
// below wins over what is a little nearer but off to the side; ← and → keep to
// the row (a candidate beside it, overlapping it up and down) where there is one.
export function nearest(from, candidates, way) {
  const vertical = way === 'up' || way === 'down', sign = way === 'down' || way === 'right' ? 1 : -1;
  const [lo, hi, crossLo, crossHi] = vertical ? ['top', 'bottom', 'left', 'right'] : ['left', 'right', 'top', 'bottom'];
  const mid = b => (b[lo] + b[hi]) / 2, crossMid = b => (b[crossLo] + b[crossHi]) / 2;
  const beyond = candidates.filter(({ box }) => sign * (mid(box) - mid(from)) > 0.5 && (sign > 0 ? box[lo] > from[lo] && box[hi] > from[hi] : box[hi] < from[hi] && box[lo] < from[lo]));
  const across = box => Math.max(0, box[crossLo] - from[crossHi], from[crossLo] - box[crossHi]);
  const inRow = vertical ? [] : beyond.filter(({ box }) => across(box) === 0);
  let best = null, score = Infinity;
  for (const each of inRow.length ? inRow : beyond) {
    const { box } = each, gap = Math.max(0, sign > 0 ? box[lo] - from[hi] : from[lo] - box[hi]);
    const value = gap + 2 * across(box) + Math.abs(crossMid(box) - crossMid(from)) / 1000;
    if (value < score) { score = value; best = each; }
  }
  return best?.el ?? null;
}

const shown = el => el.isConnected && (typeof el.checkVisibility === 'function' ? el.checkVisibility({ visibilityProperty: true }) : el.getClientRects().length > 0);
// A tree's rows are one Tab stop (key-tree.mjs), but every row it shows is a
// place an arrow from beside the tree can land; the row it lands on becomes
// the stop.
function usable(el) {
  if ((el.tabIndex < 0 && el.getAttribute('role') !== 'treeitem') || el.disabled || el.closest('[inert], [aria-hidden="true"]') || !shown(el)) return false;
  const box = el.getBoundingClientRect();
  return box.width > 0 && box.height > 0;
}
// The controls the arrows can land on inside scope.
export function controls(scope) {
  return [...scope.querySelectorAll(CONTROL)].filter(usable);
}
// What the arrows move through: the pop-up open on top (a modal dialog, else
// the dialog, sheet or menu the focus is in), else the whole page.
export function layerOf(doc, at) {
  const modal = [...doc.querySelectorAll('dialog[open]')].filter(each => each.matches(':modal'));
  if (modal.length) return modal.at(-1);
  return at?.closest?.('dialog[open], [role=dialog]:not([hidden]), [role=menu]:not([hidden])') ?? doc.body;
}
// With nothing focused, a line along the window's edge the arrow comes in from.
function edge(doc, way) {
  const view = doc.defaultView, w = view.innerWidth, h = view.innerHeight;
  return { down: { top: -2, bottom: -1, left: 0, right: w }, up: { top: h + 1, bottom: h + 2, left: 0, right: w },
    right: { top: 0, bottom: h, left: -2, right: -1 }, left: { top: 0, bottom: h, left: w + 1, right: w + 2 } }[way];
}
// Whether the focus is on the page itself: nothing, the page, main, or its heading.
export function onNothing(at, doc) {
  return !at || at === doc.body || at === doc.documentElement || at.id === 'main' || Boolean(at.matches?.('#main h1'));
}

const scrolling = (style, vertical) => /^(auto|scroll|overlay)$/.test(vertical ? style.overflowY : style.overflowX);
// Whether a box can still scroll the way named.
function room(el, way) {
  if (way === 'up' || way === 'down') return way === 'down' ? el.scrollTop + el.clientHeight < el.scrollHeight - 1 : el.scrollTop > 0;
  return way === 'right' ? el.scrollLeft + el.clientWidth < el.scrollWidth - 1 : el.scrollLeft > 0;
}
// Whether anything around el (its scrolling boxes, then the page) can still scroll the way named.
function canScroll(el, way, doc) {
  const view = doc.defaultView, vertical = way === 'up' || way === 'down';
  for (let at = el?.parentElement; at && at !== doc.body && at !== doc.documentElement; at = at.parentElement) {
    if (scrolling(view.getComputedStyle(at), vertical) && room(at, way)) return true;
  }
  return Boolean(doc.scrollingElement && room(doc.scrollingElement, way));
}
// Whether some of el shows: inside the window and every scrolling box around it.
function inSight(el, doc) {
  const view = doc.defaultView, box = el.getBoundingClientRect();
  let area = { top: 0, left: 0, bottom: view.innerHeight, right: view.innerWidth };
  for (let at = el.parentElement; at && at !== doc.body && at !== doc.documentElement; at = at.parentElement) {
    const style = view.getComputedStyle(at);
    if (style.overflowY === 'visible' && style.overflowX === 'visible') continue;
    const clip = at.getBoundingClientRect();
    area = { top: Math.max(area.top, clip.top), left: Math.max(area.left, clip.left), bottom: Math.min(area.bottom, clip.bottom), right: Math.min(area.right, clip.right) };
  }
  return box.bottom > area.top && box.top < area.bottom && box.right > area.left && box.left < area.right;
}

// Moves the focus from `from` (null for the page itself) to the nearest
// control the way named, within `within` (an element, else the layer the focus
// is in), and brings it into view by the one rule (reveal.mjs). While that
// control is out of sight and the page (or the box the focus is in) can still
// scroll that way, the arrow scrolls instead, as it always has, so words
// between two controls are read on the way. Answers whether the focus moved.
export function reach(from, way, { within = null, doc = from?.ownerDocument ?? globalThis.document } = {}) {
  const nothing = onNothing(from, doc), scope = within ?? layerOf(doc, nothing ? null : from);
  const list = controls(scope).filter(el => nothing || (el !== from && !el.contains(from) && !from.contains(el)));
  const next = nearest(nothing ? edge(doc, way) : from.getBoundingClientRect(), list.map(el => ({ el, box: el.getBoundingClientRect() })), way);
  // Out of sight while the page can still scroll toward it, the press scrolls
  // instead; from a field, whose arrows scroll nothing, it goes there.
  if (!next || (!inSight(next, doc) && !from?.matches?.(FIELD) && canScroll(nothing ? null : from, way, doc))) return false;
  next.focus({ preventScroll: true });
  revealSelection(next);
  return true;
}

// Whether a focused box can still scroll the way named, which it then does.
function scrollsOn(el, way, view) {
  if (!el?.isConnected || el === el.ownerDocument.body || el === el.ownerDocument.documentElement) return false;
  return scrolling(view.getComputedStyle(el), way === 'up' || way === 'down') && room(el, way);
}

// A one-line field has no line above or below its own, and an empty box has
// no line at all: ↑ and ↓ there go on to the control that way, so a field the
// arrows land in never holds them. ← and → stay the writing's, and so do ↑ and
// ↓ in a box with words in it, and in a field that offers a list of
// suggestions (a datalist, a combobox), where they choose among them.
const ONE_LINE = new Set(['text', 'search', 'email', 'url', 'tel', 'password']);
function leavesLine(at, way) {
  if ((way !== 'up' && way !== 'down') || at.matches('[role=combobox], [aria-autocomplete]')) return false;
  if (at.tagName === 'INPUT') return ONE_LINE.has(at.type) && !at.list;
  return at.tagName === 'TEXTAREA' && at.value === '';
}

// The arrows' last say, on the window. managed(at): whether a pane's own keys
// decide for the focus there (they hand on what they want moved, through
// reach). region(at): the part of the page the focus moves within first, or
// null; beyond(at, way): what to do when nothing lies that way in it.
// listen(target, type, listener): how the listener is added (the shell's own,
// kept across moves in place).
export function arrowReach(doc, { managed = () => false, region = () => null, beyond = () => false,
  listen = (target, type, listener) => target.addEventListener(type, listener) } = {}) {
  const view = doc.defaultView;
  listen(view, 'keydown', event => {
    const way = WAYS[event.key];
    if (!way || event.defaultPrevented || event.isComposing || event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return;
    const at = doc.activeElement;
    if ((at?.closest?.(FIELD) && !leavesLine(at, way)) || at?.closest?.(OWNS) || managed(at, way) || scrollsOn(at, way, view)) return;
    const nothing = onNothing(at, doc), within = nothing ? null : region(at);
    const moved = within ? reach(at, way, { within, doc }) || beyond(at, way) : reach(nothing ? null : at, way, { doc });
    if (moved) event.preventDefault();
  });
}

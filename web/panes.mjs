// The three panes of a topic and a Conversation, left to right: the outline,
// the messages and the right rail (docs/interaction.md, "Keys across the
// panes"). → and ← move between them as in Finder's column view, and each
// pane keeps its own place, so going there and back never loses it. A pane
// not on screen (the outline behind "☰ Outcomes" on a phone, the right rail
// behind "Pipeline & pages" below 1181px) is passed over: the keys never open
// a drawer or a sheet. A pane open over the page is closed as the keys leave
// it, so they never land on what it covers. Above the messages are the
// buttons at the top of the feed (headerKey), and ⌘Return anywhere outside
// writing starts a new message (write).
import { cardIn } from './fold.mjs';
import { navigationStops, shownSelected, stopAt } from './reply-stacks.mjs';
import { keyAction, writing, pageItself, readingMovement } from './pane-keys.mjs';
import { revealSelection } from './reveal.mjs';
import { reach as reachOn } from './arrow-reach.mjs';

const shown = el => Boolean(el?.isConnected) && (typeof el.checkVisibility === 'function' ? el.checkVisibility() : el.getClientRects().length > 0);
// On screen: shown, inside the window, and not behind an open drawer.
export function onScreen(el) {
  if (!shown(el) || el.closest('[inert]')) return false;
  const box = el.getBoundingClientRect(), view = el.ownerDocument.defaultView;
  return box.width > 0 && box.height > 0 && box.right > 0 && box.left < view.innerWidth && box.bottom > 0 && box.top < view.innerHeight;
}

// The message the keys land on in the feed: the one last lit there, else the
// oldest one not read yet (just above the New line), else the first in view;
// its card, or its folded line.
export function feedStop(doc, { first = false } = {}) {
  const list = doc.getElementById('messages');
  if (!list || !shown(list)) return null;
  const all = navigationStops(list).filter(shown);
  let entry = first ? all[0] : all.find(each => each.classList.contains('lit'));
  entry ??= all.find(each => each.dataset.id === list.dataset.lastMessage);
  if (!entry) {
    const above = list.querySelector(':scope > [data-line="new"]:not(.new-line-read)')?.previousElementSibling;
    entry = above ? all.find(each => each === above || above.contains(each)) : null;
  }
  entry ??= all.find(each => each.getBoundingClientRect().bottom > 0) ?? all[0];
  if (!entry) return null;
  const card = cardIn(entry);
  return card.hidden ? entry.querySelector('.fold-line') : card;
}

// The buttons at the top of the feed, in rows top down, each row's in their
// order, those shown: the topic's or the Conversation's header, with Topic
// settings, New message and the rest drawn there; on a phone the line under it
// saying what is new in the other outcomes (outline-rail.mjs), a row of its
// own; then the row of view filters just over the messages ("Read it", Only
// new, Show agent coordination). A row with none shown is left out. The
// filters were once nobody's, so the keys on one, reached by Tab or a click,
// moved nothing (item 403); as a row of these the keys leave them like any
// other: ↑ and ↓ go from row to row, and pass over none of them (item 301).
export function headerRows(doc) {
  const usable = el => !el.disabled && shown(el) && !el.closest('[inert]');
  return [['#main > .topic-header', 'button, a[href]'], ['#main > #outline-elsewhere', null], ['#main > .feed-filters', 'button']].map(([row, each]) => {
    const host = doc.querySelector(row);
    return { host, buttons: !host ? [] : (each ? [...host.querySelectorAll(each)] : [host]).filter(usable) };
  }).filter(row => row.buttons.length);
}
// Whether the keys are on the first message of the feed, the one at its top.
function atTop(doc) {
  const list = doc.getElementById('messages'), at = doc.activeElement;
  if (!list?.contains(at)) return false;
  const stops = navigationStops(list).filter(shown), first = stops[0];
  if (!first || stopAt(list, at, stops) !== first) return false;
  return at.matches('.stack-toggle') || at === cardIn(first) || at === first.querySelector('.fold-line');
}
const reach = (el, navigate = () => {}) => {
  el.focus({ preventScroll: true });
  if (el.ownerDocument.activeElement !== el) return false;
  navigate();
  revealSelection(el);
  return true;
};

export const panes = {
  // Set by rails.mjs: each rail's { host, focus(), leave()? }, leave closing it when it is open over the page;
  // write(target, title), a new message in the place named, or in the page's own (in-place-navigation.mjs).
  outline: null, things: null, write: null,
  // The button the keys were last on in each row of the buttons at the top of
  // the feed, by the row's element, so coming back to the row finds it.
  button: new WeakMap(),
  feed(doc, options, navigate = () => {}) {
    const stop = feedStop(doc, options) ?? doc.getElementById('main');
    if (!stop || stop.closest('[inert]')) return false;
    stop.focus({ preventScroll: true });
    if (doc.activeElement === stop) navigate();
    if (stop !== doc.getElementById('main')) revealSelection(shownSelected(stop.matches('.stack-toggle') ? stop : stop.closest('[data-id]')));
    return true;
  },
  // From the pane named, one step: 'left' or 'right'. Answers whether the keys moved.
  step(from, way, doc, navigate = () => {}) {
    const order = ['outline', 'feed', 'things'], at = order.indexOf(from) + (way === 'right' ? 1 : -1);
    const to = order[at];
    if (!to) return false;
    this[from]?.leave?.();
    if (to === 'feed') return onScreen(doc.getElementById('main')) && this.feed(doc, undefined, navigate);
    const rail = this[to];
    // Back from the messages, the outline takes the keys to the place being read.
    const moved = Boolean(rail && onScreen(rail.host) && rail.focus({ reading: from === 'feed' }));
    // The rail owns its row choice and can refuse focus even with its host shown.
    // Its own reveal has run; only an actual landing authorizes materialization.
    if (moved && rail.host.contains(doc.activeElement)) navigate();
    return moved;
  },
};

// Whether an element is among the messages: in their list, but not in the New message sheet, which rests there just
// above More (item 465) and whose controls are no message's, so the arrows go on from them as off the panes' keys.
export const inMessages = (at, doc) => Boolean(doc.getElementById('messages')?.contains(at)) && !at.closest('#new-message-sheet');
// Whether ← and → from `at` are the messages' own: everywhere among them but on a dossier's title bar glyphs (item 473),
// which stand in a row with the dossier's chevron, as a message's bar's buttons do with each other. There ← and → go
// along that row to the nearest control that way (arrow-reach.mjs): from ⋯ to Move below More, Reply and the chevron;
// past its end, on to the pane beside, as from the messages.
export const onTitleBar = at => Boolean(at?.closest?.('.reply-stack > .stack-tools'));
export const messagesSideways = (at, doc) => inMessages(at, doc) && !onTitleBar(at);

// Whether the keys are in the feed: on a message, or on the page itself (pane-keys.mjs).
export function inFeed(doc) {
  const at = doc.activeElement;
  if (pageItself(at, doc)) return true;
  return inMessages(at, doc);
}

// The button the keys land on in a row they come to: the one they were last on
// there, else its first.
const landing = row => { const last = panes.button.get(row.host); return row.buttons.includes(last) ? last : row.buttons[0]; };

// The keys on the buttons at the top of the feed, in row r: ← and → along its
// buttons, and past either end on to the outline or the right rail as from the
// messages; ↑ to the row above; ↓ to the row below, and from the last on to the
// first message, or with none, on down the column. Return and Space are the
// button's own. Answers whether the keys moved: what they leave unmoved (↑
// from the top row, ← or → past an end with no rail on screen that way) goes
// on to the nearest control that way in the column (arrow-reach.mjs, by
// rails.mjs), so on a phone ↑ from Topic settings reaches the right rail's button above it.
function headerKey(action, rows, r, doc, navigate) {
  const buttons = rows[r].buttons, at = buttons.indexOf(doc.activeElement);
  if (action === 'up') return r > 0 && reach(landing(rows[r - 1]), navigate);
  if (action === 'down' && r < rows.length - 1) return reach(landing(rows[r + 1]), navigate);
  // With no message to go to (a Conversation not yet written in), on down the column: the reply.
  if (action === 'down') {
    if (feedStop(doc, { first: true }) && panes.feed(doc, { first: true }, navigate)) return true;
    // Share MessageMenu's actual focus/scroll check; reach can report true
    // even when the control refused focus.
    const within = doc.getElementById('main'), movement = readingMovement(doc, within);
    const moved = reachOn(doc.activeElement, 'down', { within, doc });
    if (moved && movement()) navigate();
    return moved;
  }
  if (action === 'left') return at > 0 ? reach(buttons[at - 1], navigate) : panes.step('feed', 'left', doc, navigate);
  if (action === 'right') return at < buttons.length - 1 ? reach(buttons[at + 1], navigate) : panes.step('feed', 'right', doc, navigate);
  return false;
}

// The feed's keys: → and ← to the right rail and back to the outline, ↑ from
// the message at its top onto the row of buttons just above it, and on those headerKey;
// ⌘Return, from anywhere outside writing, a new message in this page's place.
// Nothing in writing or while a pop-up is open; the feed's ⌘ arrows stay its own.
export function feedKey(event, doc, navigate = () => {}) {
  const action = keyAction(event);
  if (!action || doc.querySelector('dialog[open]') || writing(doc.activeElement) ||
      doc.activeElement?.closest?.('input, textarea, select, [contenteditable]') ||
      event.target?.closest?.('input, textarea, select, [contenteditable]')) return false;
  // Focus can collapse a selection: retain the guard from before the move.
  const selecting = doc.getSelection?.()?.isCollapsed === false;
  const readingDestination = () => { if (!selecting) navigate(); };
  let moved = false;
  if (action === 'write') moved = Boolean(panes.write?.(null));
  else {
    const rows = headerRows(doc), r = rows.findIndex(row => row.buttons.includes(doc.activeElement));
    if (r >= 0) {
      panes.button.set(rows[r].host, doc.activeElement); moved = headerKey(action, rows, r, doc, readingDestination);
    }
    else if (!inFeed(doc)) return false;
    // ← and → from the messages, or the page itself, go on to the pane beside; on a title bar's glyphs, along its row.
    else if (action === 'left' || action === 'right') moved = !onTitleBar(doc.activeElement) && panes.step('feed', action, doc, readingDestination);
    else if (action === 'up' && rows.length && atTop(doc)) moved = reach(landing(rows[rows.length - 1]), readingDestination);
  }
  if (!moved) return false;
  event.preventDefault();
  return true;
}

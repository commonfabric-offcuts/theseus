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
import { navigationStops, entryOf } from './reply-stacks.mjs';
import { keyAction, writing, pageItself } from './pane-keys.mjs';

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

// The buttons at the top of the feed, in their order, those shown: the topic's
// or the Conversation's header, with Topic settings, New message and the rest
// drawn there.
export function headerButtons(doc) {
  const header = doc.querySelector('#main > .topic-header');
  return header ? [...header.querySelectorAll('button, a[href]')].filter(el => !el.disabled && shown(el) && !el.closest('[inert]')) : [];
}
// Whether the keys are on the first message of the feed, the one at its top.
function atTop(doc) {
  const list = doc.getElementById('messages'), at = doc.activeElement;
  if (!list?.contains(at)) return false;
  const first = navigationStops(list).find(shown);
  if (first?.matches('.stack-toggle')) return at === first;
  return Boolean(first) && entryOf(list, at) === first && (at === cardIn(first) || at === first.querySelector('.fold-line'));
}
const reach = el => { el.focus({ preventScroll: true }); el.scrollIntoView({ block: 'nearest' }); return true; };

export const panes = {
  // Set by rails.mjs: each rail's { host, focus(), leave()? }, leave closing it when it is open over the page;
  // write(target, title), a new message in the place named, or in the page's own (in-place-navigation.mjs).
  outline: null, things: null, write: null,
  // The header's button the keys were last on, so coming back up finds it.
  button: null,
  feed(doc, options) {
    const stop = feedStop(doc, options) ?? doc.getElementById('main');
    if (!stop || stop.closest('[inert]')) return false;
    stop.focus({ preventScroll: true });
    if (stop !== doc.getElementById('main')) stop.closest('[data-id]')?.scrollIntoView({ block: 'nearest' });
    return true;
  },
  // From the pane named, one step: 'left' or 'right'. Answers whether the keys moved.
  step(from, way, doc) {
    const order = ['outline', 'feed', 'things'], at = order.indexOf(from) + (way === 'right' ? 1 : -1);
    const to = order[at];
    if (!to) return false;
    this[from]?.leave?.();
    if (to === 'feed') return onScreen(doc.getElementById('main')) && this.feed(doc);
    const rail = this[to];
    // Back from the messages, the outline takes the keys to the place being read.
    return Boolean(rail && onScreen(rail.host) && rail.focus({ reading: from === 'feed' }));
  },
};

// Whether the keys are in the feed: on a message, or on the page itself (pane-keys.mjs).
export function inFeed(doc) {
  const at = doc.activeElement;
  if (pageItself(at, doc)) return true;
  return Boolean(doc.getElementById('messages')?.contains(at));
}

// The keys on the header's buttons: ← and → along them, and past either end
// on to the outline or the right rail as from the messages; ↓ back to the
// first message. Return and Space are the button's own. Answers
// whether the keys moved.
function headerKey(action, buttons, at, doc) {
  if (action === 'down') return panes.feed(doc, { first: true });
  if (action === 'left') return at > 0 ? reach(buttons[at - 1]) : panes.step('feed', 'left', doc);
  if (action === 'right') return at < buttons.length - 1 ? reach(buttons[at + 1]) : panes.step('feed', 'right', doc);
  return false;
}

// The feed's keys: → and ← to the right rail and back to the outline, ↑ from
// the message at its top onto the header's buttons, and on those headerKey;
// ⌘Return, from anywhere outside writing, a new message in this page's place.
// Nothing in writing or while a pop-up is open; the feed's ⌘ arrows stay its own.
export function feedKey(event, doc) {
  const action = keyAction(event);
  if (!action || doc.querySelector('dialog[open]') || writing(doc.activeElement)) return false;
  let moved = false;
  if (action === 'write') moved = Boolean(panes.write?.(null));
  else {
    const buttons = headerButtons(doc), at = buttons.indexOf(doc.activeElement);
    if (at >= 0) { panes.button = buttons[at]; moved = headerKey(action, buttons, at, doc); }
    else if (!inFeed(doc)) return false;
    else if (action === 'left' || action === 'right') moved = panes.step('feed', action, doc);
    else if (action === 'up' && buttons.length && atTop(doc)) moved = reach(buttons.includes(panes.button) ? panes.button : buttons[0]);
  }
  if (!moved) return false;
  event.preventDefault();
  return true;
}

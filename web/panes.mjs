// The three panes of a topic and a Conversation, left to right: the outline,
// the messages and the right rail (docs/interaction.md, "Keys across the
// panes"). → and ← move between them as in Finder's column view, and each
// pane keeps its own place, so going there and back never loses it. A pane
// not on screen (the outline behind "☰ Outcomes" on a phone, the right rail
// behind "Pipeline & pages" below 1181px) is passed over: the keys never open
// a drawer or a sheet.
import { cardIn } from './fold.mjs';
import { entries } from './reply-stacks.mjs';
import { keyAction, writing } from './pane-keys.mjs';

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
export function feedStop(doc) {
  const list = doc.getElementById('messages');
  if (!list || !shown(list)) return null;
  const all = entries(list).filter(shown);
  let entry = all.find(each => each.classList.contains('lit'));
  if (!entry) {
    const above = list.querySelector(':scope > [data-line="new"]:not(.new-line-read)')?.previousElementSibling;
    entry = above ? all.find(each => each === above || above.contains(each)) : null;
  }
  entry ??= all.find(each => each.getBoundingClientRect().bottom > 0) ?? all[0];
  if (!entry) return null;
  const card = cardIn(entry);
  return card.hidden ? entry.querySelector('.fold-line') : card;
}

export const panes = {
  // Set by rails.mjs: each rail's { host, focus() }.
  outline: null, things: null,
  feed(doc) {
    const stop = feedStop(doc) ?? doc.getElementById('main');
    if (!stop || stop.closest('[inert]')) return false;
    stop.focus({ preventScroll: true });
    if (stop !== doc.getElementById('main')) stop.closest('[data-id]')?.scrollIntoView({ block: 'nearest' });
    return true;
  },
  // From the pane named, one step: 'left' or 'right'. Answers whether the keys moved.
  step(from, way, doc) {
    const order = ['outline', 'feed', 'things'], at = order.indexOf(from) + (way === 'right' ? 1 : -1);
    const to = order[at];
    if (to === 'feed') return onScreen(doc.getElementById('main')) && this.feed(doc);
    const rail = this[to];
    // Back from the messages, the outline takes the keys to the place being read.
    return Boolean(rail && onScreen(rail.host) && rail.focus({ reading: from === 'feed' }));
  },
};

// Whether the keys are in the feed: on a message, on the page itself, or on nothing.
export function inFeed(doc) {
  const at = doc.activeElement, main = doc.getElementById('main');
  if (!at || at === doc.body || at === main) return true;
  return Boolean(doc.getElementById('messages')?.contains(at));
}

// → and ← in the feed: to the right rail, back to the outline. Nothing in
// writing or while a pop-up is open; the feed's ⌘ arrows stay its own.
export function feedKey(event, doc) {
  const action = keyAction(event);
  if (!['left', 'right'].includes(action) || doc.querySelector('dialog[open]') || !inFeed(doc) || writing(doc.activeElement)) return false;
  if (!panes.step('feed', action, doc)) return false;
  event.preventDefault();
  return true;
}

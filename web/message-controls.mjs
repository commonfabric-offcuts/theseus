// One source-order list and focus rule for controls in a message (Tab and arrows).
import { feedControl, feedFence } from './feed-fence-copy.mjs';
import { revealSelection } from './reveal.mjs';

// External Copy buttons take the place of their fences among a card's links.
export function inlineStops(card) {
  const stops = [];
  for (const node of card.querySelectorAll('a[href],button,[tabindex],.feed-fence-anchor')) {
    if (!node.getClientRects().length) continue;
    const external = feedControl(node);
    if (external) stops.push(external);
    else if (node.tabIndex >= 0 && !node.disabled) stops.push(node);
  }
  return stops;
}

export function focusStop(target) {
  const anchor = feedFence(target);
  if (anchor) {
    const card = anchor.closest('.message-card').getBoundingClientRect();
    const top = anchor.getBoundingClientRect().top;
    const win = anchor.ownerDocument.defaultView;
    const height = parseFloat(win.getComputedStyle(anchor).paddingTop);
    // The Copy button occupies the top lane. 'nearest' may leave that lane
    // clipped when the fence spans both edges of an inner scrolling card.
    if (top < Math.max(0, card.top) || top + height > Math.min(win.innerHeight, card.bottom)) {
      anchor.scrollIntoView({ block: 'start', inline: 'nearest', behavior: 'instant' });
    }
    target.hidden = false;
  }
  target.focus({ preventScroll: true });
}

// Horizontal reading inside a feed card (564). The stack's own open/fold
// listener has already had its turn. Only the words, not the author or the
// toolbar, are entered; external Copy buttons keep their fence's position.
export function messageWordsKey(at, way) {
  const anchor = feedFence(at) ?? at, card = anchor?.closest?.('.message-card');
  if (!card?.closest('#messages') || card.closest('[inert]')) return false;
  const words = card.querySelector(':scope > .message-preview');
  if (!words || (at !== card && !words.contains(anchor))) return false;
  const stops = inlineStops(words).filter(el => {
    const shown = feedFence(el) ?? el;
    return !shown.closest('[inert], [aria-hidden="true"]') &&
      (typeof shown.checkVisibility !== 'function' || shown.checkVisibility({ visibilityProperty: true }));
  });
  const index = stops.indexOf(at);
  const next = at === card ? (way === 'right' ? stops[0] : null)
    : index < 0 ? null : way === 'left' ? stops[index - 1] ?? card : stops[index + 1];
  if (!next) return false;
  focusStop(next);
  if (card.ownerDocument.activeElement !== next) return false;
  revealSelection(next);
  return true;
}

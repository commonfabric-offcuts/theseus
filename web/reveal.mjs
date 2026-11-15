// What the keys moved to, brought fully into view (item 379).
// scrollIntoView({ block: 'nearest' }) leaves the selection touching the edge,
// or, for something taller than the window, shows only the part it reached;
// this brings the whole of it into view with a buffer of MARGIN of the
// scrolling area's height on the side it comes in from, and puts the top of
// something too tall to fit that buffer below the area's top.
//
// Only where the keys move the selection: a pointer's click selects what it
// can already see, and the page stays where it is.
export const MARGIN = 0.1;

// The nearest box between el and the document that scrolls up and down; null
// for the document itself. A box that stays put on the screen (a fixed one,
// such as a drawer, or a sticky one that scrolls, such as a side rail) is
// where its rows scroll even while they all fit in it: scrolling the page
// under it would move nothing of it.
function scrollerOf(el) {
  const doc = el.ownerDocument, view = doc.defaultView;
  for (let at = el.parentElement; at && at !== doc.body && at !== doc.documentElement; at = at.parentElement) {
    const style = view.getComputedStyle(at);
    if (style.position === 'fixed') return at;
    if (/^(auto|scroll|overlay)$/.test(style.overflowY) && (at.scrollHeight > at.clientHeight || style.position === 'sticky')) return at;
  }
  return null;
}

// How far to scroll (positive: down) to bring a selection from top to bottom
// into the area from area.top to area.bottom, room being MARGIN of its height:
// - one that fits: the least scroll that shows all of it with room beyond the
//   edge it was nearest to or past (less room where only less is left over);
//   none when it already stands that far inside, or already shows whole
//   inside the room at both edges;
// - one taller than the area: its top one room below the area's top.
export function revealBy(selection, area, margin = MARGIN) {
  const height = area.bottom - area.top, size = selection.bottom - selection.top;
  if (height <= 0) return 0;
  if (size > height) return selection.top - (area.top + height * margin);
  const room = Math.min(height * margin, height - size);
  const low = selection.bottom > area.bottom - room, high = selection.top < area.top + room;
  // Inside the room at both edges, it already shows whole with what room is left over.
  if (low && high) return 0;
  if (low) return selection.bottom - (area.bottom - room);
  if (high) return selection.top - (area.top + room);
  return 0;
}

// A box's scroll-padding on one side, in pixels: how much of its edge a bar
// that stays put there (sticky or fixed) covers, as the page declares it.
function padding(style, side) {
  const value = parseFloat(style[`scrollPadding${side}`]);
  return Number.isFinite(value) ? value : 0;
}

// Scrolls el's nearest scrolling box, at once, by revealBy. The area is what
// of that box shows in the window, less its scroll-padding.
export function revealSelection(el, { margin = MARGIN } = {}) {
  if (!el?.getBoundingClientRect || !el.isConnected) return;
  const doc = el.ownerDocument, view = doc.defaultView, box = scrollerOf(el);
  const shown = box ? box.getBoundingClientRect() : { top: 0, bottom: view.innerHeight };
  const style = view.getComputedStyle(box ?? doc.documentElement);
  const area = { top: Math.max(shown.top, 0) + padding(style, 'Top'), bottom: Math.min(shown.bottom, view.innerHeight) - padding(style, 'Bottom') };
  const by = Math.round(revealBy(el.getBoundingClientRect(), area, margin));
  if (!by) return;
  if (box) box.scrollBy({ top: by, behavior: 'instant' });
  else view.scrollBy({ top: by, behavior: 'instant' });
}

// Folding in motion (1019, designer's prototype for Tony): a message folding to its
// one-line row closes up like a sheet tucked away, and the messages under it
// slide up into the room it leaves; unfolding, the message opens down out of
// its row and the messages under it make room. Nothing about what folds
// changes: the page is drawn as before, and this moves it from where it was.
// Where the page lays a node out, or null for one it does not draw (or a page that does not lay out: no motion there).
const box = node => node?.isConnected && typeof node.getClientRects === 'function' && node.getClientRects().length ? node.getBoundingClientRect() : null;
const FOLD = 260, UNFOLD = 300, EASE = 'cubic-bezier(.3,.7,.2,1)';

// What stands under an entry, on the screen: the entries after it in its dossier, then the dossiers after its
// dossier, as far as the window's foot.
const under = (entry, view) => {
  const out = [], foot = view.innerHeight + 40;
  for (let node = entry; node && node !== node.ownerDocument.body; node = node.parentElement) {
    if (node.matches?.('#messages, .stack-feed')) break;
    for (let next = node.nextElementSibling; next; next = next.nextElementSibling) {
      const at = box(next); if (!at) continue;
      if (at.top > foot) break;
      out.push([next, at.top]);
    }
    if (node.matches?.('.reply-stack')) break;
  }
  // The dossiers after this one in the feed.
  const section = entry.closest?.('.reply-stack');
  for (let next = section?.nextElementSibling; next; next = next.nextElementSibling) {
    const at = box(next); if (!at) continue;
    if (at.top > foot) break;
    out.push([next, at.top]);
  }
  return out;
};

// change() redraws the page; entryOf() finds the message's entry before and after.
export function foldInMotion(doc, entryOf, change, folding) {
  const view = doc.defaultView, entry = entryOf(), from = box(entry);
  if (!view || !from || typeof entry.animate !== 'function' || view.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return change();
  const below = under(entry, view);
  // Folding, a still copy of the message as it was closes up over its new row.
  const ghost = folding ? entry.cloneNode(true) : null;
  const result = change();
  const after = entryOf(), to = box(after);
  if (!to || typeof after.animate !== 'function') return result;
  for (const [node, top] of below) {
    const now = box(node); if (!now) continue;
    const dy = top - now.top;
    if (Math.abs(dy) > 0.5) node.animate([{ transform: `translateY(${dy}px)` }, { transform: 'translateY(0)' }], { duration: folding ? FOLD : UNFOLD, easing: EASE });
  }
  if (folding) {
    for (const part of [ghost, ...ghost.querySelectorAll('[id]')]) part.removeAttribute('id');
    Object.assign(ghost.style, { position: 'fixed', left: `${from.left}px`, top: `${from.top}px`, width: `${from.width}px`, height: `${from.height}px`,
      margin: '0', zIndex: '30', pointerEvents: 'none', overflow: 'hidden', boxSizing: 'border-box' });
    ghost.classList.add('fold-ghost'); ghost.setAttribute('aria-hidden', 'true'); ghost.inert = true;
    doc.body.append(ghost);
    const shut = Math.max(0, from.height - to.height);
    ghost.animate([{ clipPath: 'inset(0 0 0 0 round 10px)', opacity: 1 }, { clipPath: `inset(0 0 ${shut}px 0 round 10px)`, opacity: 0 }],
      { duration: FOLD, easing: EASE, fill: 'forwards' }).finished.catch(() => {}).finally(() => ghost.remove());
    after.animate([{ opacity: 0 }, { opacity: 0, offset: .35 }, { opacity: 1 }], { duration: FOLD, easing: 'ease-out' });
  } else {
    const open = Math.max(0, to.height - from.height);
    after.animate([{ clipPath: `inset(0 0 ${open}px 0 round 10px)` }, { clipPath: 'inset(0 0 0 0 round 10px)' }], { duration: UNFOLD, easing: EASE });
    // The words come in as it opens.
    const card = after.querySelector?.('.message-card') ?? after;
    card.animate([{ opacity: .25 }, { opacity: 1 }], { duration: UNFOLD, easing: 'ease-out' });
  }
  return result;
}

// The feed closing up where a dossier left it, or opening where one comes back (1054, Tony: "no sense of a void").
// Archived, its place stays empty for a beat after it lifts away, then the dossiers under it slide up together into
// it; brought back, they slide down at once to make its room. change() redraws the feed.
export const CLOSE_HOLD = 140, CLOSE_SLIDE = 260, CLOSE_EASE = 'cubic-bezier(.3,.7,.2,1)';
export function closeUp(list, change) {
  const view = list?.ownerDocument?.defaultView;
  if (!view || typeof list?.animate !== 'function' || view.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return change();
  const foot = view.innerHeight + 40;
  const was = [...list.children].map(node => [node, box(node)?.top]).filter(([, top]) => top !== undefined && top < foot);
  const result = change();
  for (const [node, top] of was) {
    const now = box(node); if (!now) continue;
    const dy = top - now.top;
    if (Math.abs(dy) <= 0.5) continue;
    // Up into a void: held, then slid. Down to make room: slid at once.
    const up = dy > 0, hold = up ? CLOSE_HOLD / (CLOSE_HOLD + CLOSE_SLIDE) : 0;
    node.animate([{ transform: `translateY(${dy}px)` }, ...(up ? [{ transform: `translateY(${dy}px)`, offset: hold }] : []), { transform: 'translateY(0)' }],
      { duration: up ? CLOSE_HOLD + CLOSE_SLIDE : CLOSE_SLIDE, easing: CLOSE_EASE });
  }
  return result;
}

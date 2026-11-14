// A feed card is a native button. Its Copy buttons live outside it and point
// back to the fence that owns their text, geometry and place in the tab order.
const controls = new WeakMap();
const fences = new WeakMap();
let nextAnchor = 0;

export const feedFence = control => fences.get(control);
export const feedControl = anchor => controls.get(anchor);

export function pairFeedFence(anchor, control) {
  const name = '--feed-fence-' + ++nextAnchor;
  anchor.id = 'feed-fence-' + nextAnchor;
  control.setAttribute('aria-controls', anchor.id);
  anchor.style.setProperty('anchor-name', name);
  anchor.classList.add('feed-fence-anchor');
  control.style.setProperty('position-anchor', name);
  control.classList.add('feed-fence-copy');
  control.tabIndex = -1; // MessageMenu inserts it at the fence's source position.
  controls.set(anchor, control);
  fences.set(control, anchor);
}

export function mountFeedFences(host) {
  const doc = host?.ownerDocument, win = doc?.defaultView;
  if (!win?.MutationObserver || !win.ResizeObserver) return;
  const layer = doc.createElement('div');
  layer.className = 'feed-fence-controls';
  host.after(layer);
  const active = new Map(), observedCards = new Set();
  const cssAnchors = win.CSS?.supports('anchor-name', '--fence') && win.CSS.supports('top', 'anchor(top)');
  let frame = 0;
  function position() {
    frame = 0;
    for (const [anchor, control] of active) {
      const card = anchor.closest('.message-card');
      if (!card) continue;
      const r = anchor.getBoundingClientRect();
      const clip = card.getBoundingClientRect();
      const preview = anchor.closest('.message-preview');
      const previewClip = win.getComputedStyle(preview).overflowY === 'hidden' ? preview.getBoundingClientRect() : clip;
      const size = parseFloat(win.getComputedStyle(anchor).paddingTop);
      // Only the reserved top corner belongs to Copy. A tall fence can still
      // be on screen after its control has scrolled out of its card.
      control.hidden = !r.width || !size || r.top < Math.max(clip.top, previewClip.top) - 1 ||
        r.top + size > Math.min(clip.bottom, previewClip.bottom) + 1 ||
        r.right <= clip.left || r.left >= clip.right;
      if (control.hidden) continue;
      // Chromium can resolve a fixed anchor against the wrong scroll origin.
      // Use the anchor coordinates natively when they match; otherwise pin this
      // control to the measured corner for the rest of its lifetime.
      const gap = parseFloat(win.getComputedStyle(control).marginRight) || 0;
      const actual = control.getBoundingClientRect();
      if (!cssAnchors || control.hasAttribute('data-measured') ||
          Math.abs(actual.right - r.right + gap) > 1 || Math.abs(actual.top - r.top) > 1) {
        control.setAttribute('data-measured', '');
        control.style.top = r.top + 'px'; control.style.left = r.right + 'px';
      }
    }
  }
  const schedule = () => { if (!frame) frame = win.requestAnimationFrame(position); };
  const resize = new win.ResizeObserver(schedule);
  function reconcile() {
    const seen = new Set(), cards = new Set();
    for (const anchor of host.querySelectorAll('.feed-fence-anchor')) {
      const control = controls.get(anchor);
      if (!control) continue;
      const card = anchor.closest('.message-card');
      cards.add(card);
      seen.add(anchor);
      if (!active.has(anchor)) {
        control.dataset.message = card.dataset.id;
        layer.append(control); active.set(anchor, control); resize.observe(anchor);
      }
    }
    for (const [anchor, control] of active) if (!seen.has(anchor)) {
      resize.unobserve(anchor); control.remove(); active.delete(anchor);
    }
    for (const card of observedCards) if (!cards.has(card)) { resize.unobserve(card); observedCards.delete(card); }
    for (const card of cards) if (!observedCards.has(card)) { resize.observe(card); observedCards.add(card); }
    schedule();
  }
  function hover(event, on) {
    const anchor = event.target.closest?.('.feed-fence-anchor') ?? fences.get(event.target.closest?.('.feed-fence-copy'));
    if (!anchor) return;
    const control = controls.get(anchor);
    if (!on && (anchor.contains(event.relatedTarget) || control.contains(event.relatedTarget))) return;
    control.toggleAttribute('data-hover', on);
  }
  const mutation = new win.MutationObserver(reconcile);
  mutation.observe(host, { childList: true, subtree: true, attributes: true, attributeFilter: ['hidden','class','data-folded','data-head-open'] });
  resize.observe(host);
  doc.addEventListener('scroll', schedule, true); win.addEventListener('resize', schedule);
  for (const el of [host, layer]) {
    el.addEventListener('pointerover', e => hover(e, true));
    el.addEventListener('pointerout', e => hover(e, false));
  }
  reconcile();
  win.addEventListener('pageshow', schedule);
  win.addEventListener('pagehide', event => {
    if (event.persisted) return;
    mutation.disconnect(); resize.disconnect(); win.cancelAnimationFrame(frame);
    doc.removeEventListener('scroll', schedule, true); win.removeEventListener('resize', schedule); win.removeEventListener('pageshow', schedule); layer.remove();
  });
}

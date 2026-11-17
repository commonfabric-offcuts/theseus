// Presentation only: the two outer edges of a floating composer share a centre.
// No writing, storage, destination, source or send state belongs here.
export function edgeWidth(width, delta, side, minimum, maximum) {
  if (![width, delta, minimum, maximum].every(Number.isFinite) || !['left', 'right'].includes(side)) return width;
  return Math.max(minimum, Math.min(maximum, width + 2 * delta * (side === 'left' ? -1 : 1)));
}

export function composerWidth(dialog) {
  if (!dialog) return;
  const doc = dialog.ownerDocument, win = doc.defaultView;
  const active = () => dialog.open && !dialog.classList.contains('notebook-mode');
  const bounds = () => {
    const phone = win.innerWidth <= 760;
    const widest = parseFloat(win.getComputedStyle(dialog).getPropertyValue('--widest')) * parseFloat(win.getComputedStyle(doc.documentElement).fontSize);
    const maximum = phone ? win.innerWidth : Math.min(widest, win.innerWidth - 48);
    return { maximum, minimum: Math.min(maximum, phone ? 280 : 760) };
  };
  let drag = null;
  const edges = ['left', 'right'].map(side => {
    const edge = doc.createElement('div');
    edge.className = 'composer-edge'; edge.dataset.edge = side; edge.tabIndex = 0;
    edge.setAttribute('role', 'separator'); edge.setAttribute('aria-orientation', 'vertical');
    edge.setAttribute('aria-label', `Resize composer from ${side}`);
    edge.setAttribute('aria-controls', dialog.id); edge.title = `Drag the ${side} edge to resize composer`;
    edge.addEventListener('pointerdown', event => {
      if (!active() || event.button !== 0 || event.isPrimary === false || drag) return;
      event.preventDefault(); event.stopPropagation();
      drag = { id: event.pointerId, x: event.clientX, width: dialog.getBoundingClientRect().width, side, edge };
      dialog.dataset.widthDragging = ''; edge.setPointerCapture(event.pointerId);
    });
    edge.addEventListener('pointermove', event => {
      if (!active() || drag?.id !== event.pointerId || drag.edge !== edge) return;
      const delta = event.clientX - drag.x;
      if (Math.abs(delta) < 1) return;
      const { minimum, maximum } = bounds();
      dialog.style.setProperty('--composer-width', `${edgeWidth(drag.width, delta, drag.side, minimum, maximum)}px`);
    });
    const end = event => {
      if (drag?.id !== event.pointerId || drag.edge !== edge) return;
      drag = null; delete dialog.dataset.widthDragging;
      if (edge.hasPointerCapture(event.pointerId)) edge.releasePointerCapture(event.pointerId);
    };
    for (const name of ['pointerup', 'pointercancel', 'lostpointercapture']) edge.addEventListener(name, end);
    // A released drag, even beyond the dialog, is never a backdrop press.
    edge.addEventListener('click', event => { event.preventDefault(); event.stopPropagation(); });
    edge.addEventListener('keydown', event => {
      if (!active() || !['ArrowLeft', 'ArrowRight'].includes(event.key) || event.metaKey || event.ctrlKey || event.altKey) return;
      event.preventDefault(); event.stopPropagation();
      const { minimum, maximum } = bounds();
      const delta = event.key === 'ArrowLeft' ? -16 : 16;
      dialog.style.setProperty('--composer-width', `${edgeWidth(dialog.getBoundingClientRect().width, delta, side, minimum, maximum)}px`);
    });
    dialog.append(edge); return edge;
  });
  dialog.dataset.widthEdges = '';
  dialog.addEventListener('close', () => {
    const held = drag; drag = null; delete dialog.dataset.widthDragging;
    if (held?.edge.hasPointerCapture(held.id)) held.edge.releasePointerCapture(held.id);
  });
  // This one open surface supplies the separator's current accessible value;
  // no feed row is measured and no layout value is written by the observer.
  new win.ResizeObserver(() => {
    if (!active()) return;
    const { minimum, maximum } = bounds(), width = Math.round(dialog.getBoundingClientRect().width);
    for (const edge of edges) {
      edge.setAttribute('aria-valuemin', String(minimum)); edge.setAttribute('aria-valuemax', String(maximum));
      edge.setAttribute('aria-valuenow', String(width)); edge.setAttribute('aria-valuetext', `${width} pixels wide`);
    }
  }).observe(dialog);
}

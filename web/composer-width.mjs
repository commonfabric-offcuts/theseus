// Presentation only: the two outer edges of a floating composer share a centre.
// No writing, storage, destination, source or send state belongs here.
export function edgeWidth(width, delta, side, minimum, maximum) {
  if (![width, delta, minimum, maximum].every(Number.isFinite) || !['left', 'right'].includes(side)) return width;
  return Math.max(minimum, Math.min(maximum, width + 2 * delta * (side === 'left' ? -1 : 1)));
}

export function composerWidth(dialog) {
  if (!dialog) return;
  const doc = dialog.ownerDocument, win = doc.defaultView;
  const active = () => dialog.open && dialog.dataset.cardReply === undefined && !dialog.classList.contains('notebook-mode');
  // Choices belong to this element's lifetime. CSS selects the Reader's
  // current layout; New message has its own element and single choice.
  const widthProperty = () => dialog.id === 'reader'
    ? `--composer-width-${dialog.dataset.layout === 'wide' ? 'wide' : 'stacked'}` : '--composer-width';
  const setWidth = width => dialog.style.setProperty(widthProperty(), `${width}px`);
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
      // Every held position is relative to pointerdown, including a return to
      // its origin. A dead zone here would leave an earlier width in place.
      const { minimum, maximum } = bounds();
      setWidth(edgeWidth(drag.width, delta, drag.side, minimum, maximum));
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
      setWidth(edgeWidth(dialog.getBoundingClientRect().width, delta, side, minimum, maximum));
    });
    dialog.append(edge); return edge;
  });
  // The same Reader moves into its source card. Floating choices stay with
  // the element while the card owns its width and offers no resize controls.
  const syncPlacement = () => {
    const embedded = dialog.dataset.cardReply !== undefined;
    for (const edge of edges) { edge.hidden = embedded; edge.tabIndex = embedded ? -1 : 0; }
  };
  syncPlacement();
  dialog.dataset.widthEdges = '';
  dialog.addEventListener('close', () => {
    const held = drag; drag = null; delete dialog.dataset.widthDragging;
    if (held?.edge.hasPointerCapture(held.id)) held.edge.releasePointerCapture(held.id);
  });
  const reading = dialog.id === 'reader' ? dialog.querySelector('.reading-pane') : null;
  // On a phone, writing can grow past the middle of the dialog. The reading
  // pane owns the grips, so neither target can cover the composer's + button.
  // Observe that pane too: its size changes even when the dialog does not.
  const observer = new win.ResizeObserver(() => {
    if (!active()) return;
    const pane = reading && win.innerWidth <= 760 ? reading.getBoundingClientRect() : null;
    const top = pane ? Math.min(pane.top + (pane.height - 44) / 2, pane.bottom - 44)
      - dialog.getBoundingClientRect().top - dialog.clientTop : null;
    const { minimum, maximum } = bounds(), width = Math.round(dialog.getBoundingClientRect().width);
    for (const edge of edges) {
      edge.style.top = top === null ? '' : `${top}px`;
      edge.setAttribute('aria-valuemin', String(minimum)); edge.setAttribute('aria-valuemax', String(maximum));
      edge.setAttribute('aria-valuenow', String(width)); edge.setAttribute('aria-valuetext', `${width} pixels wide`);
    }
  });
  observer.observe(dialog);
  if (reading) observer.observe(reading);
  return syncPlacement;
}

// Paper flights (designer's prototype for Tony): a sheet of paper with words on
// it flies from where something was to where it goes, and what it lands on
// glows once. Send from the pencil sheet, inline or as its sheet, goes in two
// stages with the Notebook shut: the paper goes onto the new page's row in the
// right rail, and the Notebook then opens out of that row; with the Notebook
// open, the paper flies into it and the new page shows only as it lands
// (inline-composer.mjs); closing the Notebook flies its page back to its own
// row in the right rail (notebook-sheet.mjs). The paper is the Notebook's own, in Bookends or Paper.
// Where the page lays a node out, or null for one it does not draw (or a page that does not lay out: no motion there).
const box = node => node?.isConnected && typeof node.getClientRects === 'function' && node.getClientRects().length ? node.getBoundingClientRect() : null;
const all = (root, selector) => [...(root?.querySelectorAll?.(selector) ?? [])];
const DURATION = 380;

// The writing as it stands, held where it is while its page is made and the Notebook opens: a sheet of paper
// with its words over the place it leaves, so the composer folding and the sheet closing are not seen as a jump.
// Holding (Send), the Notebook's pages are not drawn until the paper lands in them (body.paper-sending).
export function departing(node, words, { holding = false } = {}) {
  const doc = node?.ownerDocument, view = doc?.defaultView, rect = box(node);
  if (!rect || !rect.height || typeof node.animate !== 'function' || view?.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return null;
  const [title, ...rest] = String(words ?? '').trim().split('\n');
  const ghost = doc.createElement('div'), head = doc.createElement('strong'), body = doc.createElement('span');
  head.textContent = title || 'New page'; body.textContent = rest.join(' ').trim();
  ghost.append(head, body);
  Object.assign(ghost.style, { left: `${rect.left}px`, top: `${rect.top}px`, width: `${rect.width}px`, height: `${rect.height}px` });
  ghost.className = 'paper-ghost'; ghost.setAttribute('aria-hidden', 'true'); ghost.inert = true;
  doc.body.append(ghost);
  if (holding) doc.body.classList.add('paper-sending');
  return { doc, rect, ghost };
}

// Where the right rail lists a Notebook page: its own row, brought into view in the rail if the rail had
// scrolled past it; else the Notebook's heading; else, where the rail is not drawn (a narrow window), the
// window's upper right corner.
export function railRowFor(doc, id) {
  const view = doc.defaultView, things = doc.getElementById?.('things');
  const inView = node => { const at = box(node); return at && at.top >= 0 && at.bottom <= (view?.innerHeight ?? 0) && at.right <= (view?.innerWidth ?? 0) + 1 ? node : null; };
  const row = id ? all(things, '#things-notebook-body a.row').find(a => new URLSearchParams((a.getAttribute('href') ?? '').split('?')[1] ?? '').get('page') === id) : null;
  if (row && box(row) && !inView(row)) row.scrollIntoView({ block: 'nearest', behavior: 'instant' });
  return inView(row) ?? inView(things?.querySelector('#things-notebook-body')?.closest('details')?.querySelector('summary'))
    ?? (view ? { left: view.innerWidth - 120, top: 12, width: 100, height: 28 } : null);
}

// The first stage's landing: the new page's row in the right rail, as soon as the rail draws it (Core's word of
// the new page reaches the rail on its own); a page already listed, its row at once. Where the rail is not drawn,
// or has not drawn the row within a second, the Notebook's heading or the window's upper right corner.
export function rowAppears(doc, id) {
  const things = doc.getElementById?.('things');
  const rowOf = () => all(things, '#things-notebook-body a.row').find(a => new URLSearchParams((a.getAttribute('href') ?? '').split('?')[1] ?? '').get('page') === id);
  if (!things || !box(things) || rowOf()) return Promise.resolve(railRowFor(doc, id));
  return new Promise(resolve => {
    const done = () => { watch.disconnect(); clearTimeout(late); resolve(railRowFor(doc, id)); };
    // A new page's row is not drawn until the paper is down on it (land): hidden as the rail puts it in, before
    // the page paints.
    const watch = new MutationObserver(() => { const row = rowOf(); if (row) { row.classList.add('paper-landing'); done(); } });
    watch.observe(things, { childList: true, subtree: true, attributes: true, attributeFilter: ['href'] });
    const late = setTimeout(done, 1000);
  });
}

// A beat on the shelf: the row the paper went onto takes it in, a small press and settle, before the Notebook opens.
export function settle(row) {
  if (typeof row?.animate !== 'function' || row.ownerDocument.defaultView?.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return Promise.resolve();
  return row.animate([{ transform: 'scale(1)' }, { transform: 'scale(.97)', offset: .35 }, { transform: 'scale(1.015)', offset: .7 }, { transform: 'scale(1)' }],
    { duration: 300, easing: 'ease-out' }).finished.catch(() => {});
}

// Where a page's row sits in the right rail, if the rail shows it now (not brought into view): an opening grows
// from it.
export function rowRect(doc, id) {
  const view = doc.defaultView, row = id ? all(doc, '#things-notebook-body a.row').find(a => new URLSearchParams((a.getAttribute('href') ?? '').split('?')[1] ?? '').get('page') === id) : null;
  const at = box(row);
  return at && at.top >= 0 && at.bottom <= (view?.innerHeight ?? 0) && at.right <= (view?.innerWidth ?? 0) + 1 ? at : null;
}

// Opening: every Notebook page opened while its row shows in the right rail grows out of that row into its
// place (notebook-sheet.mjs), Send's second stage included.
export function openFrom(doc, row) {
  const view = doc.defaultView, sheet = doc.getElementById?.('notebook-sheet-dialog'), from = row?.getBoundingClientRect ? box(row) : row, to = box(sheet);
  if (!from || !to || !to.width || !to.height || typeof sheet.animate !== 'function' || view?.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
  const dx = from.left - to.left, dy = from.top - to.top, sx = from.width / to.width, sy = from.height / to.height;
  sheet.animate([
    // Its edge drawn in the accent while it grows, so a black Notebook over the black rail (Bookends) is seen to open.
    { transformOrigin: '0 0', transform: `translate(${dx}px,${dy}px) scale(${sx},${sy})`, boxShadow: '0 0 0 1.5px color-mix(in srgb, var(--accent) 80%, transparent)' },
    { transformOrigin: '0 0', transform: 'translate(0,0) scale(1,1)', boxShadow: '0 0 0 1.5px color-mix(in srgb, var(--accent) 0%, transparent)' },
  ], { duration: 320, easing: 'cubic-bezier(.2,.7,.2,1)' });
  const parts = sheet.querySelector('.notebook-sheet');
  parts?.animate([{ opacity: 0 }, { opacity: 0, offset: .45 }, { opacity: 1 }], { duration: 320, easing: 'ease-out' });
}

// Where the Notebook shows what was made: the card it opened on, else the page's opening words, else the page.
export function landingIn(doc, card = null) {
  const sheet = doc.getElementById?.('notebook-sheet-dialog');
  if (!sheet?.open) return null;
  const page = all(sheet, '.notebook-sheet-page').find(node => box(node)) ?? null;
  const picked = card ? page?.querySelector('.deck-cards [aria-current="true"], .deck-cards [aria-selected="true"], .deck-cards .selected') : null;
  return [picked, card ? page?.querySelector('.deck-cards > li:last-child') : null, page?.querySelector('.deck-opening'), page, sheet].find(node => box(node)) ?? null;
}

// The flight: the copy shrinks along a short arc into where it lands, fading as it goes in; nothing to land
// on (the Notebook did not open), it fades where it is.
export function land(flight, target) {
  if (!flight) return Promise.resolve();
  const { doc, rect, ghost } = flight, node = target?.getBoundingClientRect ? target : null, to = node ? box(node) : target;
  const shown = () => { doc.body.classList.remove('paper-sending'); };
  if (!to) { shown(); node?.classList.remove('paper-landing'); return ghost.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 180 }).finished.catch(() => {}).finally(() => ghost.remove()); }
  const dx = to.left - rect.left, dy = to.top - rect.top, sx = to.width / rect.width, sy = Math.min(to.height, rect.height) / rect.height;
  return ghost.animate([
    { transform: 'translate(0,0) scale(1,1)', opacity: 1 },
    { transform: `translate(${dx * 0.45}px,${dy * 0.2 - 24}px) scale(${0.7 + sx * 0.25},${0.7 + sy * 0.25})`, opacity: 0.97, offset: 0.45 },
    { transform: `translate(${dx}px,${dy}px) scale(${sx},${sy})`, opacity: 0.6 },
  ], { duration: DURATION, easing: 'cubic-bezier(.45,0,.25,1)', fill: 'forwards' }).finished.catch(() => {}).finally(() => {
    ghost.remove(); shown(); node?.classList.remove('paper-landing');
    if (typeof node?.animate === 'function') node.animate([{ boxShadow: '0 0 0 0 transparent' }, { boxShadow: '0 0 0 3px color-mix(in srgb, var(--accent) 70%, transparent)', offset: 0.35 }, { boxShadow: '0 0 0 0 transparent' }],
      { duration: 520, easing: 'ease-out' });
  });
}

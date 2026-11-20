import assert from 'node:assert/strict';

// Kept serializable so the exact oracle also runs inside the native page.
export function accessibleControl(node) {
  if (!node || !node.isConnected || node.disabled || node.getAttribute('aria-disabled') === 'true' || node.closest('[hidden], [inert]')) return false;
  const dialog = node.closest('dialog');
  if (dialog && !dialog.open) return false;
  const style = node.ownerDocument.defaultView.getComputedStyle(node);
  return style.display !== 'none' && style.visibility !== 'hidden' && Number(style.opacity) > 0 && node.getClientRects().length > 0;
}

export function textEdgeGeometry({ text, pencil, viewport, controls, flowRight = viewport.right, pencilMarginPx = 0, wrapped = false }) {
  const edgeTolerancePx = 1, adjacencyMaxPx = 12, lineTolerancePx = 1;
  assert.ok(text.length, 'rendered title has actual text fragments');
  const last = text.at(-1), gap = pencil.left - last.right;
  const sameLine = Math.abs((pencil.top + pencil.bottom) / 2 - (last.top + last.bottom) / 2) <= (last.bottom - last.top) / 2 + lineTolerancePx;
  const nextLine = wrapped && last.right + pencil.width + pencilMarginPx > flowRight - edgeTolerancePx && pencil.top >= last.bottom - lineTolerancePx && pencil.top <= last.bottom + (last.bottom - last.top) + lineTolerancePx;
  assert.ok((sameLine && gap >= -edgeTolerancePx && gap <= adjacencyMaxPx + edgeTolerancePx) || nextLine,
    `pencil follows actual text edge (edge ${edgeTolerancePx}px, gap 0..${adjacencyMaxPx}px, line ${lineTolerancePx}px)`);
  for (const box of [...text, pencil, ...controls]) assert.ok(box.left >= viewport.left - edgeTolerancePx && box.right <= viewport.right + edgeTolerancePx,
    `title and controls in reach (edge tolerance ${edgeTolerancePx}px)`);
}

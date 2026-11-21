import assert from 'node:assert/strict';

// Shared by the native case and its focused assertion-instrument controls.
// 1.5 CSS px accommodates subpixel engine rounding; a 10px overflow fails.
export const COVER_EDGE_TOLERANCE_PX = 1.5;
export const COVER_SIZE_TOLERANCE_PX = 0.5;
export function assertCoverBounds(rect, viewport, context) {
  assert.ok(rect && Object.values(rect).every(Number.isFinite), context + ': finite measured cover rectangle');
  assert.ok(rect.width > COVER_SIZE_TOLERANCE_PX && rect.height > COVER_SIZE_TOLERANCE_PX, context + ': visible cover has positive size');
  assert.ok(rect.left >= -COVER_EDGE_TOLERANCE_PX && rect.right <= viewport.width + COVER_EDGE_TOLERANCE_PX,
    context + ': cover fits viewport horizontally (1.5px edge tolerance)');
  assert.ok(rect.top >= -COVER_EDGE_TOLERANCE_PX && rect.bottom <= viewport.height + COVER_EDGE_TOLERANCE_PX,
    context + ': cover fits viewport vertically (1.5px edge tolerance)');
}

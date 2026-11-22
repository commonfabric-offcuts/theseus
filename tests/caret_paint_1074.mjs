// Test instrumentation only. A coloured fragment at a clip edge cannot tell
// us where the complete native caret ends. Even a genuinely full caret that
// touches that edge stays uncertain until independently measured.
export function classifyCaretPaint(bounds, clip, lineHeight) {
  if (!bounds) return { status: 'uncertain', reason: 'Native caret paint absent; blink/paint extent unresolved', fragment: null };
  const height = bounds.bottom - bounds.top, width = bounds.right - bounds.left;
  if (!(width > 0 && width <= 3 && height >= 8 && height <= lineHeight * 1.7))
    return { status: 'uncertain', reason: 'Ambiguous native caret paint size', fragment: bounds };
  // Two raster pixels of clearance also reject antialiased boundary paint.
  if (bounds.top <= clip.y + 2 || bounds.bottom >= clip.y + clip.height - 2)
    return { status: 'uncertain', reason: 'Caret paint reaches vertical clip edge; full extent unresolved', fragment: bounds };
  return { status: 'measured', caret: bounds };
}

export function assessCaretScroll(prior, after) {
  if (prior.paint.status !== 'measured' || after.paint.status !== 'measured')
    return { status: 'uncertain', leastPassed: null, visiblePassed: null, reason: 'A visible fragment cannot establish complete caret extent' };
  const delta = after.pageTop - prior.pageTop, caret = after.paint.caret;
  const withoutScroll = { top: caret.top + delta, bottom: caret.bottom + delta }, area = prior.exposed;
  const minimum = withoutScroll.top < area.top ? withoutScroll.top - area.top : withoutScroll.bottom > area.bottom ? withoutScroll.bottom - area.bottom : 0;
  return { status: 'measured', delta, minimum, withoutScroll, area,
    leastPassed: Math.abs(delta - minimum) <= 2,
    visiblePassed: caret.top >= after.exposed.top - 1 && caret.bottom <= after.exposed.bottom + 1 };
}

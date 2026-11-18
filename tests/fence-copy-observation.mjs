// Evaluated by Playwright only in isolated fence fixtures. No mutation, storage,
// screenshot or clipboard read. All geometry is in viewport CSS pixels.
export function fenceBoundarySnapshot({ cardSelector, controlSelector, point = null }) {
  const geometryTolerancePx = 1, overlapTolerancePx = 0.5;
  const rect = el => { if (!el) return null; const r = el.getBoundingClientRect();
    return { x: r.x, y: r.y, top: r.top, right: r.right, bottom: r.bottom, left: r.left, width: r.width, height: r.height }; };
  const identity = el => el ? { tag: el.tagName, id: el.id, class: String(el.className).slice(0, 120),
    role: el.getAttribute('role'), label: el.getAttribute('aria-label')?.slice(0, 120) ?? null,
    message: el.closest('[data-id]')?.dataset.id ?? null } : null;
  const card = document.querySelector(cardSelector), control = document.querySelector(controlSelector);
  const box = rect(control), hitPoint = point ?? (box ? { x: box.x + box.width / 2, y: box.y + box.height / 2 } : null);
  const hit = hitPoint && document.elementFromPoint(hitPoint.x, hitPoint.y);
  const intendedTarget = point ? card : control;
  const selection = getSelection(), field = document.querySelector('#inline-writing-body');
  const notice = document.querySelector('.fence-copy-announcement:not(.sr-only)');
  const noticeBox = rect(notice);
  const controls = [...document.querySelectorAll('button,textarea,input,a[href],[role=button],[role=group][data-card-reply]')];
  return { tolerances: { geometryTolerancePx, overlapTolerancePx },
    viewport: { width: innerWidth, height: innerHeight, scrollX, scrollY, dpr: devicePixelRatio,
      visual: visualViewport ? { width: visualViewport.width, height: visualViewport.height, offsetTop: visualViewport.offsetTop, offsetLeft: visualViewport.offsetLeft, scale: visualViewport.scale } : null },
    card: { identity: identity(card), rect: rect(card) }, control: { identity: identity(control), rect: box },
    notice: { identity: identity(notice), rect: noticeBox }, hitPoint, hitTarget: identity(hit),
    intendedTarget: identity(intendedTarget),
    occludingTarget: intendedTarget && hit && !intendedTarget.contains(hit) ? identity(hit) : null,
    controlRects: controls.slice(0, 64).map(el => { const r = rect(el);
      const overlapsNotice = Boolean(noticeBox &&
        Math.min(r.right, noticeBox.right) - Math.max(r.left, noticeBox.left) > overlapTolerancePx &&
        Math.min(r.bottom, noticeBox.bottom) - Math.max(r.top, noticeBox.top) > overlapTolerancePx);
      const overlapPoint = overlapsNotice ? { x: (Math.max(r.left, noticeBox.left) + Math.min(r.right, noticeBox.right)) / 2, y: (Math.max(r.top, noticeBox.top) + Math.min(r.bottom, noticeBox.bottom)) / 2 } : null;
      return { identity: identity(el), rect: r, overlapPoint, overlapHit: overlapPoint ? identity(document.elementFromPoint(overlapPoint.x, overlapPoint.y)) : null, overlapsNotice }; }),
    controlsTruncated: controls.length > 64,
    selection: { text: selection.toString().slice(0, 256), truncated: selection.toString().length > 256,
      anchor: identity(selection.anchorNode?.parentElement), anchorOffset: selection.anchorOffset,
      focus: identity(selection.focusNode?.parentElement), focusOffset: selection.focusOffset, ranges: selection.rangeCount },
    fieldSelection: field ? { start: field.selectionStart, end: field.selectionEnd, direction: field.selectionDirection,
      selected: field.value.slice(field.selectionStart, field.selectionEnd).slice(0, 256) } : null,
    active: identity(document.activeElement), readerOpen: document.querySelector('#reader')?.open ?? false,
    menuOpen: Boolean(document.querySelector('.message-menu-list')) };
}

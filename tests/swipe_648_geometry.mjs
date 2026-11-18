// Diagnostics only: retain the measured boxes, clipping ancestors and words
// before an assertion fails. No styles, viewport or tolerances are changed.
export const geometry648 = () => {
  const box = e => {
    const b = e.getBoundingClientRect(), s = getComputedStyle(e);
    return { tag: e.tagName, id: e.id, classes: String(e.className), left: b.left,
      right: b.right, top: b.top, bottom: b.bottom, width: b.width, height: b.height,
      clientWidth: e.clientWidth, scrollWidth: e.scrollWidth, overflowX: s.overflowX,
      position: s.position, minWidth: s.minWidth, whiteSpace: s.whiteSpace };
  };
  const outliers = [...document.querySelectorAll('body *')].filter(e => {
    const b = e.getBoundingClientRect();
    return e.getClientRects().length && b.width > 0 && (b.right > innerWidth + 2 || b.left < -2);
  }).map(e => ({ ...box(e), words: e.textContent.slice(0, 180),
    ancestors: [...(function* () { for (let at = e.parentElement; at; at = at.parentElement) yield box(at); })()] }));
  return { width: innerWidth, scrollX, overflow: document.documentElement.scrollWidth - innerWidth,
    dialog: box(document.querySelector('#reader')), outliers };
};

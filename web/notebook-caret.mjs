// Typing reveals the caret, never the whole (possibly very tall) card.
// Unlike the card-selection rule this has no margin while the caret is visible.
export function caretRevealBy(caret, area, top, maximum) {
  const values = [caret?.top, caret?.bottom, area?.top, area?.bottom, top, maximum];
  if (!values.every(Number.isFinite) || area.bottom <= area.top ||
      caret.bottom < caret.top || caret.bottom - caret.top > area.bottom - area.top || maximum < 0) return 0;
  const deficit = caret.top < area.top ? caret.top - area.top : caret.bottom > area.bottom ? caret.bottom - area.bottom : 0;
  if (!deficit) return 0;
  return Math.max(0, Math.min(maximum, top + deficit)) - top;
}

// A textarea exposes its selection offsets but no caret rectangle. Lay out
// the same text/font/width in an inert, hidden projection. The native producer
// independently checks the result against actual painted textarea carets.
function caretRect(field) {
  const doc = field.ownerDocument, view = doc.defaultView, style = view.getComputedStyle(field);
  const mirror = doc.createElement('div'), suffix = doc.createElement('span');
  mirror.setAttribute('aria-hidden', 'true'); mirror.inert = true;
  mirror.style.cssText = 'all:initial;position:fixed;left:-10000px;top:0;visibility:hidden;pointer-events:none;white-space:pre-wrap;overflow-wrap:break-word';
  for (const property of ['font', 'fontFamily', 'fontSize', 'fontWeight', 'fontStyle', 'fontStretch',
    'fontVariant', 'lineHeight', 'letterSpacing', 'wordSpacing', 'tabSize', 'textIndent', 'textTransform',
    'textAlign', 'direction', 'wordBreak', 'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft',
    'borderTopWidth', 'borderRightWidth', 'borderBottomWidth', 'borderLeftWidth', 'borderStyle', 'boxSizing'])
    mirror.style[property] = style[property];
  const fieldRect = field.getBoundingClientRect(); mirror.style.width = `${fieldRect.width}px`;
  const at = field.selectionDirection === 'backward' ? field.selectionStart : field.selectionEnd;
  mirror.append(doc.createTextNode(field.value.slice(0, at)));
  suffix.textContent = field.value.slice(at) || '\u200b'; mirror.append(suffix); doc.body.append(mirror);
  try {
    // A collapsed Range before a newline has an empty rectangle in Chromium.
    // The suffix's first inline fragment still identifies that caret line.
    const caret = suffix.getClientRects()[0], origin = mirror.getBoundingClientRect();
    if (!(caret?.height > 0)) return null;
    // WebKit paints the caret from the line's content area, rather than the
    // DOM glyph fragment. Its line origin is inside the textarea's padding.
    // Keep that metric distinction explicit; native paint checks cover both.
    if (/Apple/.test(view.navigator?.vendor ?? '')) {
      const height = parseFloat(style.lineHeight), leading = (height - caret.height) / 2;
      const top = fieldRect.top + caret.top - origin.top - parseFloat(style.paddingTop) - leading - field.scrollTop;
      return { top, bottom: top + height };
    }
    return { top: fieldRect.top + caret.top - origin.top - field.scrollTop,
      bottom: fieldRect.top + caret.bottom - origin.top - field.scrollTop };
  } finally { mirror.remove(); }
}

function reveal(field, host) {
  const doc = field.ownerDocument, view = doc.defaultView, caret = caretRect(field);
  if (!caret) return;
  let scroller = null;
  for (let at = host; at && at !== doc.body && at !== doc.documentElement; at = at.parentElement)
    if (/^(auto|scroll|overlay)$/.test(view.getComputedStyle(at).overflowY)) { scroller = at; break; }
  const visual = view.visualViewport;
  const area = { top: visual?.offsetTop ?? 0, bottom: (visual?.offsetTop ?? 0) + (visual?.height ?? view.innerHeight) };
  if (scroller) for (let at = scroller; at; at = at.parentElement) {
    if (!/(auto|scroll|overlay|hidden|clip)/.test(view.getComputedStyle(at).overflowY)) continue;
    const rect = at.getBoundingClientRect();
    area.top = Math.max(area.top, rect.top + at.clientTop);
    area.bottom = Math.min(area.bottom, rect.top + at.clientTop + at.clientHeight);
  }
  const owner = scroller ?? doc.scrollingElement;
  if (!owner) return;
  const by = caretRevealBy(caret, area, owner.scrollTop, Math.max(0, owner.scrollHeight - owner.clientHeight));
  if (by) owner.scrollTop += by;
}

// One editor opening owns these listeners and its pending frame. Read the
// final selection after WritingInput's line gestures and existing Undo finish.
export function watchNotebookCaret(field, host) {
  const view = field.ownerDocument.defaultView;
  if (!view?.requestAnimationFrame) return () => {};
  const listening = new view.AbortController(), options = { signal: listening.signal };
  let before = null, frame = null;
  const cancel = () => { if (frame !== null) view.cancelAnimationFrame(frame); frame = null; before = null; };
  field.addEventListener('beforeinput', () => {
    // Several inputs can arrive before their reveal frame. Preserve the first
    // position: a later beforeinput may already see the browser's caret jump.
    if (before !== null) return;
    before = [];
    for (let at = host; at; at = at.parentElement) before.push([at, at.scrollTop]);
  }, options);
  field.addEventListener('input', () => {
    if (frame !== null) view.cancelAnimationFrame(frame);
    frame = view.requestAnimationFrame(() => {
      frame = null;
      const places = before; before = null;
      if (!field.isConnected || field.ownerDocument.activeElement !== field) return;
      for (const [at, top] of places ?? []) if (at.scrollTop !== top) at.scrollTop = top;
      reveal(field, host);
    });
  }, options);
  for (const type of ['wheel', 'pointerdown', 'touchstart']) host.addEventListener(type, cancel, options);
  return () => { cancel(); listening.abort(); };
}

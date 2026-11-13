// One observer for the document, including scroll areas created by navigation
// or opened later. Native scrolling, gutter sizes and event propagation stay
// with the browser; this only changes the thumb's colour.
const installed = new WeakMap();
export function quietScrollbars(doc = document) {
  if (installed.has(doc)) return installed.get(doc);
  const win = doc.defaultView, active = new Map();
  const clear = element => {
    const state = active.get(element);
    if (!state) return;
    win.clearTimeout(state.timer);
    state.fade?.cancel();
    element.removeAttribute('data-scrolling');
    active.delete(element);
  };
  const scrolling = event => {
    const element = event.target === doc ? doc.scrollingElement : event.target;
    if (!element?.setAttribute || (element.scrollHeight <= element.clientHeight + 1 && element.scrollWidth <= element.clientWidth + 1)) return;
    clear(element);
    element.setAttribute('data-scrolling', '');
    const state = {};
    active.set(element, state);
    state.timer = win.setTimeout(() => {
      const color = win.getComputedStyle(element).getPropertyValue('--quiet-scrollbar-thumb');
      element.removeAttribute('data-scrolling');
      // The registered colour belongs to the scroller, so WebKit invalidates
      // its thumb too. Animate only that property, preserving other effects.
      if (element.isConnected && color && element.animate &&
          !win.matchMedia('(prefers-reduced-motion: reduce)').matches) {
        state.fade = element.animate([{ '--quiet-scrollbar-thumb': color }, { '--quiet-scrollbar-thumb': 'transparent' }], { duration: 180 });
        state.fade.onfinish = () => { if (active.get(element) === state) clear(element); };
      } else clear(element);
    }, 700);
  };
  const settle = () => { for (const element of active.keys()) clear(element); };
  const dispose = () => {
    settle();
    doc.removeEventListener('scroll', scrolling, true);
    win.removeEventListener('pagehide', settle);
    doc.documentElement.removeAttribute('data-quiet-scrollbars');
    installed.delete(doc);
  };
  doc.documentElement.setAttribute('data-quiet-scrollbars', '');
  doc.addEventListener('scroll', scrolling, { capture: true, passive: true });
  win.addEventListener('pagehide', settle);
  installed.set(doc, dispose);
  return dispose;
}

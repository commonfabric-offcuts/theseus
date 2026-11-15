// One observer for the document, including scroll areas created by navigation
// or opened later. Native scrolling, gutter sizes and event propagation stay
// with the browser; this only changes the thumb's colour.
//
// Where the platform draws its bars over the content (macOS with a trackpad,
// every phone), they already show only while scrolling and take no room, so
// the page leaves them alone. Where it shows them always and gives them room
// (a mouse, or "Show scroll bars: Always"), the page draws its own at that same
// width, so nothing moves, and quiets their thumbs between scrolls.
const installed = new WeakMap();
const nothing = () => {};

// The room the platform's own bars take: 0 for overlay bars.
export function platformGutter(doc = document) {
  const probe = doc.createElement('div');
  probe.style.cssText = 'position:absolute;top:0;left:0;width:100px;height:100px;overflow:scroll;visibility:hidden';
  doc.documentElement.append(probe);
  const width = probe.offsetWidth - probe.clientWidth;
  probe.remove();
  return width;
}

export function quietScrollbars(doc = document) {
  if (installed.has(doc)) return installed.get(doc);
  const gutter = platformGutter(doc);
  if (!(gutter > 0)) { installed.set(doc, nothing); return nothing; }
  const win = doc.defaultView, active = new Map(), root = doc.documentElement;
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
    root.removeAttribute('data-quiet-scrollbars');
    root.style.removeProperty('--quiet-scrollbar-size');
    installed.delete(doc);
  };
  root.style.setProperty('--quiet-scrollbar-size', gutter + 'px');
  root.setAttribute('data-quiet-scrollbars', '');
  doc.addEventListener('scroll', scrolling, { capture: true, passive: true });
  win.addEventListener('pagehide', settle);
  installed.set(doc, dispose);
  return dispose;
}

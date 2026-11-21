// This device's pointer passage preference. Outlines, keyboard focus and the
// browser's actual text selection have their own owners and are not gated.
export const pointerLight = (doc = globalThis.document) => doc?.documentElement?.dataset.pointerLight !== 'off';

// A switch can turn an already painted passage off without another move.
// The root survives the rail foot's in-place replacement.
export function observePointerLight(doc, clear) {
  const root = doc?.documentElement, Observer = doc?.defaultView?.MutationObserver;
  if (!root || !Observer) return null;
  const observer = new Observer(() => { if (!pointerLight(doc)) clear(); });
  observer.observe(root, { attributes: true, attributeFilter: ['data-pointer-light'] });
  // The shell sends the retiring run its scoped pagehide. A page kept in
  // the browser's back/forward cache can return with this observer intact.
  doc.defaultView.addEventListener?.('pagehide', event => {
    clear();
    if (!event.persisted) observer.disconnect();
  });
  return observer;
}

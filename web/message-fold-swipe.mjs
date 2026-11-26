// A right swipe over the Reader's message is its existing Fold message act.
// The dossier's thresholds and natural trackpad direction (stack-feed.mjs).
const ACROSS = 80, VERTICAL = 40, GAP = 250, SIDEWAYS_SLACK = 2;
const CONTROL = 'a,button,input,textarea,select,[role=button],.reader-end';
function sideways(target, surface) {
  for (let at = target; at && at !== surface; at = at.parentElement) {
    if (at.scrollWidth - at.clientWidth > SIDEWAYS_SLACK && /^(auto|scroll)$/.test(surface.ownerDocument.defaultView.getComputedStyle(at).overflowX)) return true;
  }
  return false;
}

// One wheel stream can reach the feed after the Reader closes. Keep its
// consumed state on that document until a quiet gap starts a new gesture.
const bursts = new WeakMap();
export function wheelSwipe(surface, event, prepare, accepts = () => true) {
  const doc = surface.ownerDocument;
  const unitX = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? surface.clientWidth : 1;
  const unitY = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? doc.defaultView.innerHeight : 1;
  const x = event.deltaX * unitX, y = event.deltaY * unitY;
  let burst = bursts.get(doc);
  if (burst && event.timeStamp - burst.last >= GAP) {
    bursts.delete(doc);
    burst = null;
  }
  if (event.ctrlKey || event.metaKey) return;
  if (Math.abs(y) > Math.abs(x)) {
    if (burst?.done) burst.last = event.timeStamp;
    else bursts.delete(doc);
    return;
  }
  if (burst?.done) {
    burst.last = event.timeStamp;
    event.preventDefault();
    return;
  }
  if (!burst || burst.surface !== surface) {
    burst = { surface, x: 0, y: 0, act: prepare(event.target), done: false };
    bursts.set(doc, burst);
  }
  burst.last = event.timeStamp;
  burst.x += x;
  burst.y += y;
  if (!burst.act || !accepts(burst.x) || Math.abs(burst.x) <= Math.abs(burst.y)) return;
  event.preventDefault();
  if (Math.abs(burst.x) < ACROSS) return;
  const act = burst.act;
  burst.done = true; burst.act = null; burst.surface = null;
  act(burst.x, event.altKey);
}

export function messageFoldSwipe(surface, prepare) {
  let finger = null;
  const start = target => target?.closest?.(CONTROL) || sideways(target, surface) || window.getSelection()?.isCollapsed === false ? null : prepare();
  surface.addEventListener('touchstart', event => {
    const touch = event.touches?.length === 1 ? event.touches[0] : null;
    finger = touch ? { id: touch.identifier, x: touch.clientX, y: touch.clientY, act: start(event.target) } : null;
  }, { passive: true });
  surface.addEventListener('touchcancel', () => { finger = null; }, { passive: true });
  surface.addEventListener('touchend', event => {
    const began = finger; finger = null;
    const touch = [...(event.changedTouches ?? [])].find(each => each.identifier === began?.id);
    if (!began?.act || !touch || touch.clientX - began.x < ACROSS || Math.abs(touch.clientY - began.y) > VERTICAL) return;
    if (window.getSelection()?.isCollapsed !== false) { event.preventDefault(); began.act(); }
  }, { passive: false });
  surface.addEventListener('wheel', event => wheelSwipe(surface, event, start, across => across < 0), { passive: false });
}

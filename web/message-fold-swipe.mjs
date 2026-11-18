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

export function messageFoldSwipe(surface, prepare) {
  let finger = null, wheel = null;
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
    if (window.getSelection()?.isCollapsed !== false) began.act();
  }, { passive: true });
  surface.addEventListener('wheel', event => {
    if (event.ctrlKey || event.metaKey) { wheel = null; return; }
    const unitX = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? surface.clientWidth : 1;
    const unitY = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? surface.ownerDocument.defaultView.innerHeight : 1;
    const x = event.deltaX * unitX, y = event.deltaY * unitY;
    if (Math.abs(y) > Math.abs(x)) { wheel = null; return; }
    if (!wheel || event.timeStamp - wheel.last >= GAP) wheel = { x: 0, y: 0, act: start(event.target), done: false };
    wheel.last = event.timeStamp; wheel.x += x; wheel.y += y;
    if (!wheel.act || wheel.x >= 0 || Math.abs(wheel.x) <= Math.abs(wheel.y)) return;
    event.preventDefault();
    if (wheel.done || -wheel.x < ACROSS) return;
    wheel.done = true; wheel.act();
  }, { passive: false });
}

// The side rail's density and width on this device (designer prototype; rail-dense.css).
// "Compact | Roomy" at the rail's foot says which is on; the rail's right edge drags to a
// width, and a double click on it puts the width back. Both are kept in localStorage;
// with no storage they hold for the page.
const ROOMY = 'theseus-rail-roomy', WIDTH = 'theseus-rail-width';
const MIN = 200, MAX = 480;
const root = document.documentElement;
const get = key => { try { return localStorage.getItem(key); } catch (_) { return null; } };
const set = (key, value) => { try { value === null ? localStorage.removeItem(key) : localStorage.setItem(key, value); } catch (_) {} };

let roomy = get(ROOMY) === '1';
const applyDensity = () => root.toggleAttribute('data-rail-roomy', roomy);
applyDensity();

const savedWidth = Number(get(WIDTH));
let width = Number.isFinite(savedWidth) && savedWidth > 0 ? Math.max(MIN, Math.min(MAX, Math.round(savedWidth))) : null;
const applyWidth = () => {
  if (width) { root.style.setProperty('--rail-w', width + 'px'); root.setAttribute('data-rail-w', ''); }
  else { root.style.removeProperty('--rail-w'); root.removeAttribute('data-rail-w'); }
};
applyWidth();

function density() {
  const foot = document.querySelector('.rail-foot');
  if (!foot) return;
  const group = foot.querySelector('.rail-density') ?? document.createElement('span');
  group.className = 'rail-density'; group.setAttribute('role', 'group'); group.setAttribute('aria-label', 'Rail spacing');
  const choice = (label, isRoomy, tip) => {
    const button = [...group.children].find(child => child.textContent === label) ?? document.createElement('button');
    button.type = 'button'; button.textContent = label; button.title = tip;
    button.onclick = () => { roomy = isRoomy; set(ROOMY, roomy ? '1' : '0'); applyDensity(); paint(); resizer(); };
    return button;
  };
  const compact = choice('Compact', false, 'One line per outcome and topic'), spacious = choice('Roomy', true, "Today's larger spacing");
  const paint = () => { compact.setAttribute('aria-pressed', String(!roomy)); spacious.setAttribute('aria-pressed', String(roomy)); };
  paint();
  if (!group.children.length) group.append(compact, spacious);
  if (!group.isConnected) foot.append(group);
}

function resizer() {
  const rail = document.getElementById('rail'), layout = rail?.parentElement;
  if (!rail || !layout) return;
  const handle = layout.querySelector(':scope > .rail-resize') ?? document.createElement('div');
  handle.className = 'rail-resize'; handle.tabIndex = 0;
  handle.setAttribute('role', 'separator'); handle.setAttribute('aria-orientation', 'vertical');
  handle.setAttribute('aria-label', 'Rail width'); handle.title = 'Drag to change the rail’s width; double-click to reset';
  const say = () => { handle.setAttribute('aria-valuenow', String(Math.round(rail.getBoundingClientRect().width))); handle.setAttribute('aria-valuemin', String(MIN)); handle.setAttribute('aria-valuemax', String(MAX)); };
  const to = px => { width = Math.max(MIN, Math.min(MAX, Math.round(px))); applyWidth(); say(); };
  handle.onpointerdown = event => {
    if (event.button !== 0 || !event.isPrimary) return;
    event.preventDefault(); handle.setPointerCapture(event.pointerId);
    const left = rail.getBoundingClientRect().left;
    handle.dataset.dragging = ''; document.body.classList.add('rail-resizing');
    const move = e => { if (e.pointerId === event.pointerId) to(e.clientX - left); };
    const up = e => {
      if (e.pointerId !== event.pointerId) return;
      for (const name of ['pointerup', 'pointercancel', 'lostpointercapture']) handle.removeEventListener(name, up);
      handle.removeEventListener('pointermove', move); delete handle.dataset.dragging; document.body.classList.remove('rail-resizing');
      set(WIDTH, width ? String(width) : null);
    };
    handle.addEventListener('pointermove', move);
    for (const name of ['pointerup', 'pointercancel', 'lostpointercapture']) handle.addEventListener(name, up);
  };
  handle.ondblclick = () => { width = null; applyWidth(); set(WIDTH, null); say(); };
  handle.onkeydown = event => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    event.preventDefault(); event.stopPropagation();
    to(rail.getBoundingClientRect().width + (event.key === 'ArrowRight' ? 16 : -16)); set(WIDTH, String(width));
  };
  if (!handle.isConnected) rail.after(handle); say();
}

//901 restores these controls from listener-free copies on each move.
export function railDensity() { applyDensity(); applyWidth(); density(); resizer(); }

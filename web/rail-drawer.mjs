// On a phone the side rail gets out of the topic's way: the topic comes
// first, and "☰ Topics" at its top opens the rail as a drawer over it. The
// rail's notices stay above the topic while it is closed. Anything in the
// rail that goes somewhere (a topic, a Notebook page, "← Outcomes", the logo,
// New topic) closes the drawer as it goes; so do a tap on the dimmed page
// beside it and Escape. At desktop width the rail stays beside the topic and
// the control is not shown (aim.css), so the drawer is never open there.

const GOES = 'a[href], .nav-item, #new-topic';

export function railDrawer(doc = document, win = doc.defaultView) {
  const rail = doc.getElementById('rail'), control = doc.getElementById('rail-open');
  const backdrop = doc.getElementById('rail-backdrop'), main = doc.getElementById('main');
  if (!rail || !control || !backdrop || !main) throw Error('The phone rail needs its rail, its control, its backdrop and the page.');
  const phone = win.matchMedia('(max-width: 760px)');
  const isOpen = () => rail.classList.contains('open');
  const set = (open, restore = false) => {
    if (open === isOpen()) return;
    const inside = rail.contains(doc.activeElement);
    rail.classList.toggle('open', open);
    backdrop.hidden = !open;
    main.inert = open;
    control.setAttribute('aria-expanded', String(open));
    if (open) (rail.querySelector('a[aria-current="page"]') ?? rail.querySelector('a[href], button:not([disabled])'))?.focus();
    else if (restore || inside) control.focus({ preventScroll: true });
  };
  control.addEventListener('click', () => set(!isOpen()));
  backdrop.addEventListener('click', () => set(false, true));
  rail.addEventListener('click', event => { if (isOpen() && event.target.closest?.(GOES)) set(false); });
  doc.addEventListener('keydown', event => {
    if (event.key === 'Escape' && isOpen() && !event.defaultPrevented) { event.preventDefault(); set(false, true); }
  });
  phone.addEventListener('change', () => { if (!phone.matches) set(false); });
  return { open: () => set(true), close: () => set(false), isOpen };
}

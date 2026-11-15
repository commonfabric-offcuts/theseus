// On a phone the side rail gets out of the topic's way: the topic comes
// first, and "☰ Outcomes" at its top opens the rail as a drawer over it. The
// rail's notices stay above the topic while it is closed. It opens on the
// open topic, in the middle of the drawer, so a lit topic beside it shows
// whole. Anything in the rail that goes somewhere (a topic, a Notebook page,
// "← Outcomes", the logo) closes the drawer as it goes; so do a tap on the
// dimmed page beside it and Escape. What opens in the drawer itself (New
// topic's title line, More topics, Retry, the Done group) leaves it open, so
// what the tap opened shows, with the focus on it. At desktop width the rail
// stays beside the topic and the control is not shown (aim.css), so the
// drawer is never open there. Inside a topic or a Conversation the drawer
// holds the outline, which says where it opens (place): on the row the keys
// or a press chose there, ringed, else on the open topic.

// Where a tap goes somewhere: a link or a row.
const GOES = 'a[href], .nav-item';
// Whether a tap on el, in the open drawer, closes it.
export const closesDrawer = el => Boolean(el?.closest?.(GOES));
// What opens and closes it: "☰ Outcomes" at the top of the page, and on a
// phone the line under it that says what is new elsewhere.
const OPENS = '#rail-open, [data-opens-rail]';

// The drawer stays across moves in place (in-place-navigation.mjs): the
// control and the page are found each time, since a move puts back fresh
// ones, and the listeners are added by listen, which the shell gives so they
// stay with it.
// place(): puts the focus on the row the rail's own keys keep, answering
// whether it did; while none does, the drawer opens on the open topic.
export function railDrawer(doc = document, win = doc.defaultView, listen = (target, type, listener) => target.addEventListener(type, listener), place = () => false) {
  const rail = doc.getElementById('rail'), backdrop = doc.getElementById('rail-backdrop');
  const control = () => doc.getElementById('rail-open'), main = () => doc.getElementById('main');
  if (!rail || !control() || !backdrop || !main()) throw Error('The phone rail needs its rail, its control, its backdrop and the page.');
  const phone = win.matchMedia('(max-width: 760px)');
  const isOpen = () => rail.classList.contains('open');
  const set = (open, restore = false) => {
    if (open === isOpen()) return;
    const inside = rail.contains(doc.activeElement);
    rail.classList.toggle('open', open);
    backdrop.hidden = !open;
    const page = main();
    if (page) page.inert = open;
    control()?.setAttribute('aria-expanded', String(open));
    if (open) {
      const placed = place() && rail.contains(doc.activeElement) ? doc.activeElement : null;
      const here = placed ?? rail.querySelector('a[aria-current="page"]') ?? rail.querySelector('a[href], button:not([disabled])');
      if (!placed) here?.focus({ preventScroll: true });
      here?.scrollIntoView({ block: 'center' });
    } else if (restore || inside) control()?.focus({ preventScroll: true });
  };
  listen(doc, 'click', event => { if (event.target?.closest?.(OPENS)) set(!isOpen()); });
  listen(backdrop, 'click', () => set(false, true));
  listen(rail, 'click', event => { if (isOpen() && closesDrawer(event.target)) set(false); });
  listen(doc, 'keydown', event => {
    if (event.key === 'Escape' && isOpen() && !event.defaultPrevented) { event.preventDefault(); set(false, true); }
  });
  listen(phone, 'change', () => { if (!phone.matches) set(false); });
  return { open: () => set(true), close: () => set(false), isOpen };
}

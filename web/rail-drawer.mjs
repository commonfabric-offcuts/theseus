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
// drawer is never open there.

// Where a tap goes somewhere: a link or a row.
const GOES = 'a[href], .nav-item';
// What opens and closes it: "☰ Outcomes" at the top of the page, and on a
// phone the line under it that says what is new elsewhere.
const OPENS = '#rail-open, [data-opens-rail]';

// The drawer stays across moves in place (in-place-navigation.mjs): the
// control and the page are found each time, since a move puts back fresh
// ones, and the listeners are added by listen, which the shell gives so they
// stay with it.
export function railDrawer(doc = document, win = doc.defaultView, listen = (target, type, listener) => target.addEventListener(type, listener)) {
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
      // Of what is live and shown: a copy of the open topic in a list not drawn (the topic list the
      // outline stands in for) or kept inert while a run draws its own (outline-rail.mjs) takes no focus.
      const shown = el => typeof el.checkVisibility === 'function' ? el.checkVisibility() : el.getClientRects().length > 0;
      const live = selector => [...rail.querySelectorAll(selector)].find(el => !el.closest('[inert]') && shown(el)) ?? null;
      const here = live('a[aria-current="page"]') ?? live('a[href], button:not([disabled])');
      here?.focus({ preventScroll: true }); here?.scrollIntoView({ block: 'center' });
    } else if (restore || inside) control()?.focus({ preventScroll: true });
  };
  listen(doc, 'click', event => { if (event.target?.closest?.(OPENS)) set(!isOpen()); });
  listen(backdrop, 'click', () => set(false, true));
  listen(rail, 'click', event => { if (isOpen() && event.target.closest?.(GOES)) set(false); });
  listen(doc, 'keydown', event => {
    if (event.key === 'Escape' && isOpen() && !event.defaultPrevented) { event.preventDefault(); set(false, true); }
  });
  listen(phone, 'change', () => { if (!phone.matches) set(false); });
  return { open: () => set(true), close: () => set(false), isOpen };
}

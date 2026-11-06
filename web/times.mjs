// Every time the page shows, in one form (docs/times.md), by the viewer's own
// calendar day: today's as the time ("4:40 AM"), yesterday's as
// "Yesterday 9:12 PM", and anything earlier dated ("7:41 AM Thu Nov 5"). A
// title or screen-reader text keeps the dated form, so it says the day
// whenever it is read.

// The page's clock. A check fixes now, so no result depends on the day it runs.
export const clock = { now: () => Date.now(), setTimeout: (fn, ms) => setTimeout(fn, ms), clearTimeout: id => clearTimeout(id) };

const hours = when => when.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });

// The local midnight that begins the day holding ms, and the one that ends
// it. Both are built from the calendar date, so a day of 23 or 25 hours ends
// at its own midnight.
export function dayStart(ms) {
  const when = new Date(ms);
  return new Date(when.getFullYear(), when.getMonth(), when.getDate()).getTime();
}
export function nextDayStart(ms) {
  const when = new Date(ms);
  return new Date(when.getFullYear(), when.getMonth(), when.getDate() + 1).getTime();
}

// "7:41 AM Thu Nov 5", in the reader's own time zone, whatever the day.
export function datedTime(ms) {
  const when = new Date(ms);
  const day = when.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }).replace(',', '');
  return `${hours(when)} ${day}`;
}

// The time as shown on the page: "4:40 AM" today, "Yesterday 9:12 PM", and
// the dated form for any other day, a later one included.
export function shownTime(ms, now = clock.now()) {
  const today = dayStart(now);
  if (dayStart(ms) === today) return hours(new Date(ms));
  if (nextDayStart(ms) === today) return `Yesterday ${hours(new Date(ms))}`;
  return datedTime(ms);
}

// A shown time as a <time> element: its words follow the day (repaintTimes),
// its title keeps the date.
export function timeNode(ms, doc) {
  const node = doc.createElement('time');
  node.dataset.ms = String(ms);
  node.dateTime = new Date(ms).toISOString();
  node.title = datedTime(ms);
  node.textContent = shownTime(ms);
  return node;
}

// Every shown time on the page, in the words for the day it now is.
export function repaintTimes(doc) {
  for (const node of doc.querySelectorAll('time[data-ms]')) {
    const words = shownTime(Number(node.dataset.ms));
    if (node.textContent !== words) node.textContent = words;
  }
}

// Calls repaint when the viewer's day changes while the page is open. One
// timer is set for the next local midnight, the instant the words change,
// and set again when it fires; nothing checks in between. A machine asleep
// at midnight runs that timer late, and the clock or the zone can change
// under it, so the page also looks again when it comes back into view or
// focus. Returns what stops it.
export function watchDays({ doc, win, repaint = () => repaintTimes(doc), timers = clock }) {
  let day = dayStart(timers.now()), timer = null;
  const check = () => {
    const now = timers.now();
    if (dayStart(now) !== day) { day = dayStart(now); repaint(); }
    if (timer !== null) timers.clearTimeout(timer);
    timer = timers.setTimeout(check, nextDayStart(now) - now);
  };
  const shown = () => { if (doc.visibilityState === 'visible') check(); };
  doc.addEventListener('visibilitychange', shown);
  win.addEventListener('focus', check);
  win.addEventListener('pageshow', check);
  check();
  return () => {
    if (timer !== null) timers.clearTimeout(timer);
    timer = null;
    doc.removeEventListener('visibilitychange', shown);
    win.removeEventListener('focus', check);
    win.removeEventListener('pageshow', check);
  };
}

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
    // A time said out loud keeps its form (spokenNode).
    const words = node.dataset.form ? spokenTime(Number(node.dataset.ms), node.dataset.form) : shownTime(Number(node.dataset.ms));
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

// A time said out loud, as the outcome light says it (item 86), by the
// reader's calendar day, on the same day boundaries and 12-hour clock as
// shownTime. Forms:
//   at     after a verb:    "at 6:45 AM", "yesterday at 9:40 PM", "Tuesday at 4:10 PM", "on Nov 3 at 4:10 PM"
//   since  after "since":   "1:48 AM", "yesterday at 3:15 PM", "Tuesday at 4:10 PM", "Nov 3 at 4:10 PM"
//   short  in a rail row:   "6:40 AM", "yesterday 3:15 PM", "Tue 4:10 PM", "Nov 3 4:10 PM"
//   day                     "5:10 AM", "yesterday", "Tuesday", "Nov 3"
//   dayShort                "5:10 AM", "yesterday", "Tue", "Nov 3"
//   part   talk in the hour "this morning", "this afternoon", "this evening", "yesterday", else as day
//   commaSince, dayAt       as since and day, but today's time with "at"
// A year other than this one is added ("Nov 3, 2025").
export function spokenTime(ms, form, now = clock.now()) {
  const when = new Date(ms), clockWords = hours(when);
  const days = Math.round((dayStart(now) - dayStart(ms)) / 86400000);
  const sameYear = when.getFullYear() === new Date(now).getFullYear();
  const date = when.toLocaleDateString('en-US', sameYear ? { month: 'short', day: 'numeric' } : { month: 'short', day: 'numeric', year: 'numeric' });
  const weekday = when.toLocaleDateString('en-US', { weekday: 'long' }), weekdayShort = when.toLocaleDateString('en-US', { weekday: 'short' });
  const kind = days === 0 ? 'today' : days === 1 ? 'yesterday' : days >= 2 && days <= 6 ? 'week' : 'older';
  if (form === 'part' && kind === 'today') {
    const hour = when.getHours();
    return hour < 12 ? 'this morning' : hour < 18 ? 'this afternoon' : 'this evening';
  }
  const words = {
    at: { today: `at ${clockWords}`, yesterday: `yesterday at ${clockWords}`, week: `${weekday} at ${clockWords}`, older: `on ${date} at ${clockWords}` },
    since: { today: clockWords, yesterday: `yesterday at ${clockWords}`, week: `${weekday} at ${clockWords}`, older: `${date} at ${clockWords}` },
    short: { today: clockWords, yesterday: `yesterday ${clockWords}`, week: `${weekdayShort} ${clockWords}`, older: `${date} ${clockWords}` },
    day: { today: clockWords, yesterday: 'yesterday', week: weekday, older: date },
    dayShort: { today: clockWords, yesterday: 'yesterday', week: weekdayShort, older: date },
  };
  // After a sentence or a comma: today's time with "at", any other day as since says it.
  words.commaSince = { ...words.since, today: words.at.today };
  // "reached yesterday", or today "reached at 5:10 AM".
  words.dayAt = { ...words.day, today: words.at.today };
  return (words[form] ?? words.day)[kind];
}

// A time said out loud as a <time> element: its words follow the day
// (repaintTimes keeps its form), its title keeps the date.
export function spokenNode(ms, form, doc) {
  const node = timeNode(ms, doc);
  node.dataset.form = form;
  node.textContent = spokenTime(ms, form);
  return node;
}

// Every time the page shows follows the viewer's calendar day: the time alone
// today, "Yesterday" and the time the day before, dated before that; and a
// time painted before midnight changes its words at midnight.
import test from 'node:test';
import assert from 'node:assert/strict';
import { clock, dayStart, nextDayStart, datedTime, shownTime, timeNode, repaintTimes, watchDays } from '../web/times.mjs';

// One zone with daylight saving, whatever the machine's: 8 March 2026 has 23
// hours there and 1 November 2026 has 25.
process.env.TZ = 'America/Los_Angeles';
const at = (...parts) => new Date(...parts).getTime();

test('a time today shows alone, yesterday\'s says so, and any other day keeps the dated form', () => {
  const now = at(2026, 10, 5, 12, 0);
  assert.equal(shownTime(at(2026, 10, 5, 4, 40), now), '4:40 AM');
  assert.equal(shownTime(at(2026, 10, 5, 0, 0), now), '12:00 AM', 'the first instant of today is today');
  assert.equal(shownTime(at(2026, 10, 5, 23, 59), now), '11:59 PM', 'later today is still today');
  assert.equal(shownTime(at(2026, 10, 4, 21, 12), now), 'Yesterday 9:12 PM');
  assert.equal(shownTime(at(2026, 10, 4, 0, 0), now), 'Yesterday 12:00 AM');
  assert.equal(shownTime(at(2026, 10, 3, 23, 59), now), '11:59 PM Tue Nov 3', 'the day before yesterday is dated');
  assert.equal(shownTime(at(2026, 10, 6, 0, 1), now), '12:01 AM Fri Nov 6', 'a later day is dated, never taken for today');
  assert.equal(shownTime(at(2025, 10, 5, 7, 41), now), '7:41 AM Wed Nov 5', 'the same date a year back is not today');
  assert.equal(datedTime(at(2026, 10, 5, 17, 4)), '5:04 PM Thu Nov 5');
});

test('today and yesterday are calendar days, also across a change of the clocks', () => {
  // 9 March, half past midnight: yesterday was 23 hours long.
  const spring = at(2026, 2, 9, 0, 30);
  assert.equal(shownTime(at(2026, 2, 9, 0, 0), spring), '12:00 AM');
  assert.equal(shownTime(at(2026, 2, 8, 10, 0), spring), 'Yesterday 10:00 AM');
  assert.equal(shownTime(at(2026, 2, 8, 0, 0), spring), 'Yesterday 12:00 AM');
  assert.equal(shownTime(at(2026, 2, 7, 23, 30), spring), '11:30 PM Sat Mar 7', 'twenty-four hours back is the day before yesterday');
  // 2 November, half past eleven at night: yesterday was 25 hours long.
  const autumn = at(2026, 10, 2, 23, 30);
  assert.equal(shownTime(at(2026, 10, 1, 0, 10), autumn), 'Yesterday 12:10 AM');
  assert.equal(shownTime(at(2026, 10, 1, 23, 50), autumn), 'Yesterday 11:50 PM');
  assert.equal(shownTime(at(2026, 9, 31, 23, 50), autumn), '11:50 PM Sat Oct 31');
  assert.equal(nextDayStart(at(2026, 2, 8, 0, 30)) - at(2026, 2, 8, 0, 30), 22.5 * 3600e3, 'the short day ends at its own midnight');
  assert.equal(nextDayStart(at(2026, 10, 1, 0, 30)) - at(2026, 10, 1, 0, 30), 24.5 * 3600e3, 'the long day too');
  assert.equal(dayStart(at(2026, 10, 1, 23, 59)), at(2026, 10, 1));
});

// A small page: elements with dataset, attributes and children, and the
// querySelectorAll the repaint uses.
class Node {
  constructor(tag) { Object.assign(this, { tag, dataset: {}, children: [], textContent: '' }); }
  append(...nodes) { this.children.push(...nodes); }
  all() { return this.children.flatMap(node => typeof node === 'object' ? [node, ...node.all()] : []); }
}
function page() {
  const body = new Node('body'), handlers = { doc: {}, win: {} };
  const listen = side => ({ addEventListener: (name, fn) => { handlers[side][name] = fn; }, removeEventListener: (name, fn) => { if (handlers[side][name] === fn) delete handlers[side][name]; } });
  const doc = { ...listen('doc'), body, visibilityState: 'visible', createElement: tag => new Node(tag),
    querySelectorAll: selector => { assert.equal(selector, 'time[data-ms]'); return body.all().filter(node => node.tag === 'time' && 'ms' in node.dataset); } };
  return { doc, win: listen('win'), handlers };
}
// Timers that run only when the check says so, at the instant it names.
function timers(start) {
  const pending = new Map();
  let now = start, serial = 0;
  return {
    now: () => now, set: value => { now = value; }, pending,
    setTimeout: (fn, ms) => { pending.set(++serial, { fn, due: now + ms }); return serial; },
    clearTimeout: id => { pending.delete(id); },
    // Moves the clock to the one pending timer's instant and runs it.
    fire(late = 0) { assert.equal(pending.size, 1, 'one timer is pending'); const [[id, { fn, due }]] = pending; pending.delete(id); now = due + late; fn(); },
  };
}

test('a shown time is a <time> whose words follow the day and whose title keeps the date', t => {
  const now = clock.now; t.after(() => { clock.now = now; });
  const { doc } = page(), sent = at(2026, 10, 5, 16, 40);
  clock.now = () => at(2026, 10, 5, 20, 0);
  const node = timeNode(sent, doc);
  doc.body.append(node, new Node('time'));
  assert.deepEqual([node.tag, node.textContent, node.title, node.dateTime, node.dataset.ms], ['time', '4:40 PM', '4:40 PM Thu Nov 5', new Date(sent).toISOString(), String(sent)]);
  clock.now = () => at(2026, 10, 6, 0, 0);
  repaintTimes(doc);
  assert.equal(node.textContent, 'Yesterday 4:40 PM');
  assert.equal(node.title, '4:40 PM Thu Nov 5');
  clock.now = () => at(2026, 10, 7, 0, 0);
  repaintTimes(doc);
  assert.equal(node.textContent, '4:40 PM Thu Nov 5');
});

test('a time painted before midnight changes its words at midnight, by one timer set for that instant', t => {
  const now = clock.now; t.after(() => { clock.now = now; });
  const clockOf = timers(at(2026, 10, 5, 23, 59, 30));
  clock.now = clockOf.now;
  const { doc, win } = page();
  const node = timeNode(at(2026, 10, 5, 16, 40), doc); doc.body.append(node);
  const stop = watchDays({ doc, win, timers: clockOf });
  assert.equal(node.textContent, '4:40 PM');
  assert.deepEqual([...clockOf.pending.values()].map(timer => timer.due), [at(2026, 10, 6)], 'one timer, for the next midnight');
  clockOf.fire();
  assert.equal(node.textContent, 'Yesterday 4:40 PM', 'at midnight the bare time says it was yesterday');
  assert.deepEqual([...clockOf.pending.values()].map(timer => timer.due), [at(2026, 10, 7)], 'and one timer for the midnight after');
  clockOf.fire();
  assert.equal(node.textContent, '4:40 PM Thu Nov 5');
  stop();
  assert.equal(clockOf.pending.size, 0, 'stopped, nothing is left to run');
});

test('the watch repaints only when the day has changed, and sets its timer by the calendar on a short day', () => {
  const clockOf = timers(at(2026, 2, 8, 0, 30)), { doc, win } = page();
  let repaints = 0;
  watchDays({ doc, win, timers: clockOf, repaint: () => { repaints++; } });
  assert.equal(repaints, 0, 'starting paints nothing again');
  assert.deepEqual([...clockOf.pending.values()].map(timer => timer.due), [at(2026, 2, 9)], 'the 23-hour day ends at its own midnight');
  // A timer that runs a moment early (the wall clock was set back) repaints nothing and waits for midnight again.
  const [[id, early]] = clockOf.pending; clockOf.pending.delete(id); clockOf.set(early.due - 1); early.fn();
  assert.equal(repaints, 0);
  assert.deepEqual([...clockOf.pending.values()].map(timer => timer.due), [at(2026, 2, 9)]);
  clockOf.fire();
  assert.equal(repaints, 1);
});

test('a page back in view or focus after the machine slept through midnight repaints at once', () => {
  const clockOf = timers(at(2026, 10, 5, 22, 0)), { doc, win, handlers } = page();
  let repaints = 0;
  const stop = watchDays({ doc, win, timers: clockOf, repaint: () => { repaints++; } });
  // Asleep from ten at night to eight in the morning: the timer has not run yet.
  clockOf.set(at(2026, 10, 6, 8, 0));
  doc.visibilityState = 'hidden'; handlers.doc.visibilitychange();
  assert.equal(repaints, 0, 'a page going out of view repaints nothing');
  doc.visibilityState = 'visible'; handlers.doc.visibilitychange();
  assert.equal(repaints, 1, 'back in view, its times say the new day');
  assert.deepEqual([...clockOf.pending.values()].map(timer => timer.due), [at(2026, 10, 7)], 'the one timer now waits for the next midnight');
  handlers.win.focus(); handlers.win.pageshow();
  assert.equal(repaints, 1, 'the same day again repaints nothing');
  clockOf.set(at(2026, 10, 7, 9, 0)); handlers.win.focus();
  assert.equal(repaints, 2, 'focus after another midnight repaints');
  clockOf.set(at(2026, 10, 8, 9, 0)); handlers.win.pageshow();
  assert.equal(repaints, 3, 'and so does a page shown again');
  assert.equal(clockOf.pending.size, 1, 'never more than one timer');
  stop();
  assert.deepEqual([Object.keys(handlers.doc), Object.keys(handlers.win), clockOf.pending.size], [[], [], 0], 'stopped, it listens for nothing');
});

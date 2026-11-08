import { unreached, unanswered, attemptOf, heard } from './api.mjs';

// The lines the page writes what went wrong into: its status line, the
// Reader's notice, the composer's and the navigation line. A writer hands a
// line the failure itself (an error, or a receipt's error), words of the
// page's own (a string), or a list of these, with at most a control the line
// offers. A writer that puts a failure into words of its own makes them an
// error whose cause is the failure.
//
// A connection line is one whose every failure was about reaching Theseus
// (api.mjs unreached), with no control of its own. Whether it shows is worked
// out here, from what the page knows now (api.mjs contact), never by its
// writer and never from when the page last reconnected: it shows only while
// the page is not connected and nothing has answered since its latest failure
// (api.mjs unanswered). Words beside such a failure say what it stopped, and
// the page does that again or the person asks again. Words with no failure, a
// failure Theseus answered, or a control the line offers stay as written.
const parts = what => [what].flat().filter(part => part !== '' && part !== null && part !== undefined);
const failure = part => typeof part?.message === 'string';
const words = part => typeof part === 'string' || failure(part);

export const lineText = what => [...new Set(parts(what).filter(words).map(part => failure(part) ? part.message : part))].join(' ');

// Each connection line showing now, with when its latest failure was. What the
// page knows only grows, so a line that stops showing never shows again.
const connection = new Map();
const paint = (element, given) => {
  const controls = given.filter(part => !words(part));
  element.textContent = lineText(given);
  if (controls.length) element.append(' ', ...controls);
  element.hidden = !given.length;
};
const clear = element => { connection.delete(element); paint(element, []); delete element.dataset.unreached; };
heard(() => { for (const [element, at] of connection) if (!unanswered(at)) clear(element); });

export function showLine(element, what) {
  const given = parts(what), failures = given.filter(failure);
  const at = failures.length && given.every(words) && failures.every(unreached) ? Math.max(...failures.map(part => attemptOf(part).at)) : null;
  if (at !== null && !unanswered(at)) { clear(element); return; }
  paint(element, given);
  if (at === null) { connection.delete(element); delete element.dataset.unreached; }
  else { connection.set(element, at); element.dataset.unreached = ''; }
}

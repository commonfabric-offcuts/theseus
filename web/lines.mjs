import { unreached, unanswered, answeredAfter, attemptOf, heard } from './api.mjs';

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
// (api.mjs unanswered). One hidden while the page is connected shows again if
// the connection goes before anything answers; once something has answered
// since its failure it is gone for good. Words beside such a failure say what
// it stopped, and the page does that again or the person asks again. Words
// with no failure, a failure Theseus answered, or a control the line offers
// stay as written.
const parts = what => [what].flat().filter(part => part !== '' && part !== null && part !== undefined);
const failure = part => typeof part?.message === 'string';
const words = part => typeof part === 'string' || failure(part);

export const lineText = what => [...new Set(parts(what).filter(words).map(part => failure(part) ? part.message : part))].join(' ');

// Each connection line until something answers after its latest failure: what
// it says, and when that failure was.
const connection = new Map();
const paint = (element, given) => {
  const controls = given.filter(part => !words(part));
  element.textContent = lineText(given);
  if (controls.length) element.append(' ', ...controls);
  element.hidden = !given.length;
};
const settle = (element, { given, at }) => {
  if (answeredAfter(at)) connection.delete(element);
  const shows = unanswered(at);
  paint(element, shows ? given : []);
  if (shows) element.dataset.unreached = ''; else delete element.dataset.unreached;
};
heard(() => { for (const [element, line] of connection) settle(element, line); });

export function showLine(element, what) {
  const given = parts(what), failures = given.filter(failure);
  if (failures.length && given.every(words) && failures.every(unreached)) {
    const line = { given, at: Math.max(...failures.map(part => attemptOf(part).at)) };
    connection.set(element, line);
    settle(element, line);
  } else {
    connection.delete(element);
    paint(element, given);
    delete element.dataset.unreached;
  }
}

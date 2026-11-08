import { unreached, overtaken } from './api.mjs';

// The lines the page writes what went wrong into: its status line, the
// Reader's notice and the composer's. A writer hands a line the failure itself
// (an error, or a receipt's error), words of the page's own (a string), or a
// list of these, with at most a control the line offers. A writer that puts a
// failure into words of its own makes them an error whose cause is the failure.
//
// Whether a line is about reaching Theseus is worked out here, from the
// failures it shows (api.mjs unreached), never by its writer. A line whose
// every failure was about reaching Theseus is over once the page reaches it
// again (clearUnreached): words beside a failure say what it stopped, and the
// page does that again or the person asks again. Words with no failure, a
// failure Theseus answered, or a control the line offers stay. Such a line
// written after the page has reached Theseus again, for attempts that began
// before it did (api.mjs overtaken), is over as it is written: nothing later
// would clear it, since a quiet live feed says nothing more.
const parts = what => [what].flat().filter(part => part !== '' && part !== null && part !== undefined);
const failure = part => typeof part?.message === 'string';
const words = part => typeof part === 'string' || failure(part);

export const lineText = what => [...new Set(parts(what).filter(words).map(part => failure(part) ? part.message : part))].join(' ');

export function showLine(element, what) {
  const given = parts(what), controls = given.filter(part => !words(part)), failures = given.filter(failure);
  const reaching = failures.length > 0 && !controls.length && failures.every(unreached);
  const shown = reaching && failures.every(overtaken) ? [] : given;
  element.textContent = lineText(shown);
  if (controls.length) element.append(' ', ...controls);
  element.hidden = !shown.length;
  if (reaching && shown.length) element.dataset.unreached = '';
  else delete element.dataset.unreached;
}

// The page reaches Theseus again: every line that said only that it could not goes.
export function clearUnreached(doc) {
  for (const element of doc.querySelectorAll('[data-unreached]')) showLine(element, '');
}

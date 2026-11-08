import { unreached } from './api.mjs';

// The lines the page writes what went wrong into: its status line, the
// Reader's notice and the composer's. A writer hands a line the failure itself
// (an error, or a receipt's error), words of the page's own (a string), or a
// list of these, with at most a control the line offers.
//
// Whether a line is about reaching Theseus is worked out here, from the
// failures it shows (api.mjs unreached), never by its writer. A line that
// says nothing else is over once the page reaches Theseus again
// (clearUnreached). Words of the page's own, or a control, say what the page
// could not do or offers instead, which reaching Theseus does not undo.
const parts = what => [what].flat().filter(part => part !== '' && part !== null && part !== undefined);
const failure = part => typeof part?.message === 'string';
const words = part => typeof part === 'string' || failure(part);

export const lineText = what => [...new Set(parts(what).filter(words).map(part => failure(part) ? part.message : part))].join(' ');

export function showLine(element, what) {
  const shown = parts(what), controls = shown.filter(part => !words(part));
  element.textContent = lineText(shown);
  if (controls.length) element.append(' ', ...controls);
  element.hidden = !shown.length;
  if (shown.length && shown.every(unreached)) element.dataset.unreached = '';
  else delete element.dataset.unreached;
}

// The page reaches Theseus again: every line that said only that it could not goes.
export function clearUnreached(doc) {
  for (const element of doc.querySelectorAll('[data-unreached]')) showLine(element, '');
}

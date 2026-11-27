// A cover selection opens the existing reply under the dossier's root.
import { DossierSelectionQuote } from './dossier-selection-quote.mjs';
import { coverQuoteSource } from './dossier-cover.mjs';
import { drawnText, sourcePosition } from './message-format.mjs';

const FIELD = '[data-cover-quote-part]';
const CONTROL = 'button,input,textarea,select,[contenteditable],[role=button]';
const RETURN_CONTROL = CONTROL + ',summary,a[href]';
const element = node => node?.nodeType === 1 ? node : node?.parentElement;
const fieldNames = { stands: 'Where it stands', wait: 'Waiting', default: 'Default', payload: 'Payload' };

function selectionSection(words, range) {
  const section = element(range.commonAncestorContainer)?.closest('.cover-section');
  const heading = section && words.contains(section) ? section.querySelector(':scope > summary')?.textContent.trim() : '';
  const name = heading?.replace(/\s+/g, ' ') || fieldNames[words.dataset.coverQuotePart.split('.')[0]];
  return Array.from(name).slice(0, 160).join('').trimEnd();
}

function selected(words, doc) {
  const selection = doc.getSelection();
  if (selection?.rangeCount !== 1 || selection.isCollapsed) return null;
  const range = selection.getRangeAt(0);
  if (!words.contains(range.startContainer) || !words.contains(range.endContainer) ||
      [...words.querySelectorAll(CONTROL)].some(control => range.intersectsNode(control))) return null;
  const body = drawnText(words), start = sourcePosition(range.startContainer, range.startOffset);
  const end = sourcePosition(range.endContainer, range.endOffset, true);
  if (typeof body !== 'string' || !Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end > body.length || end <= start) return null;
  const text = body.slice(start, end);
  return text.trim() ? { start, end, text, section: selectionSection(words, range) } : null;
}

export function installCoverQuote({ host, template, available, quote }) {
  const doc = host.ownerDocument, win = doc.defaultView;
  const entryOf = node => element(node)?.closest(FIELD);
  const uncovered = () => !doc.querySelector('dialog[open],.message-menu-list');
  const choose = (words, excerpt) => {
    const source = coverQuoteSource(words), body = drawnText(words);
    if (!source || !available(source) || !host.contains(words) || typeof body !== 'string' ||
        body.slice(excerpt.start, excerpt.end) !== excerpt.text ||
        excerpt.revision !== undefined && source.revision !== excerpt.revision) return;
    // JavaScript selections count UTF-16 units. Core slices Unicode code points.
    const start = Array.from(body.slice(0, excerpt.start)).length;
    const end = start + Array.from(excerpt.text).length;
    doc.getSelection()?.removeAllRanges();
    return quote({ source, start, end, excerpt: excerpt.text, section: excerpt.section });
  };

  new DossierSelectionQuote({ host, template, entryOf, selected: words => selected(words, doc),
    eligible: (_id, words) => {
      const source = coverQuoteSource(words);
      return source && available(source);
    },
    quote: (_id, words, excerpt) => choose(words, excerpt),
    surface: {
      pillId: 'cover-quote-selection', cardOf: words => words, wordsOf: words => words,
      idOf: words => coverQuoteSource(words)?.id, revisionOf: words => coverQuoteSource(words)?.revision,
      accepts: words => Boolean(coverQuoteSource(words)), uncovered,
    } });

  doc.addEventListener('keydown', event => {
    if (event.key !== 'Enter' || event.defaultPrevented || event.isComposing || event.repeat ||
        event.ctrlKey || event.metaKey || event.altKey || event.shiftKey ||
        !available() || !uncovered() || element(event.target)?.closest(RETURN_CONTROL)) return;
    const words = entryOf(doc.getSelection()?.anchorNode);
    if (!words || !host.contains(words) || !coverQuoteSource(words)) return;
    event.preventDefault(); event.stopImmediatePropagation();
    const excerpt = selected(words, doc);
    if (excerpt) choose(words, excerpt);
  }, { capture: true });
}

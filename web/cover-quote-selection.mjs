// A cover selection opens the existing reply under the dossier's root.
import { DossierSelectionQuote } from './dossier-selection-quote.mjs';
import { coverPeekSpan, coverQuoteSource } from './dossier-cover.mjs';
import { passageAt } from './feed-passages.mjs';
import { drawnText, rangeOf, sourcePosition } from './message-format.mjs';
import { LightTableRows } from './light-table-rows.mjs';
import { observePointerLight, pointerLight } from './pointer-light.mjs';
import { copyKey, onMac } from './writing-input.mjs';

const FIELD = '[data-cover-quote-part]';
const PEEK = '[data-cover-peek-part]';
const LIGHT = 'cover-lit-passage';
const CONTROL = 'button,input,textarea,select,[contenteditable],[role=button]';
const RETURN_CONTROL = CONTROL + ',summary,a[href]';
const element = node => node?.nodeType === 1 ? node : node?.parentElement;
const fieldNames = { stands: 'Where it stands', wait: 'Waiting', default: 'Default', payload: 'Payload' };

function selectionSection(words, range) {
  const label = words.closest('.cover-structured-section')?.querySelector('summary > .cover-section-label') ??
    words.closest('.cover-criterion')?.querySelector('.cover-label');
  if (label) return label.textContent;
  const section = element(range.commonAncestorContainer)?.closest('.cover-section');
  const heading = section && words.contains(section) ? section.querySelector(':scope > summary')?.textContent.trim() : '';
  const name = heading?.replace(/\s+/g, ' ') || fieldNames[words.dataset.coverQuotePart?.split('.')[0]];
  return Array.from(name).slice(0, 160).join('').trimEnd();
}

function pointed(words, target, doc, x, y) {
  if (target.closest(CONTROL + ',a[href]')) return null;
  const span = coverPeekSpan(words);
  if (span) {
    const range = doc.createRange();
    range.selectNodeContents(words);
    return [...range.getClientRects()].some(box => x >= box.left && x <= box.right && y >= box.top && y <= box.bottom)
      ? { span, range } : null;
  }
  if (target.closest('summary')) return null;
  const hit = passageAt(words, doc, x, y, target);
  return hit && ![...words.querySelectorAll(CONTROL + ',summary')].some(control => hit.range.intersectsNode(control)) ? hit : null;
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

export function installCoverQuote({ host, template, available, quote, copy }) {
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

  const highlights = win.CSS?.highlights;
  const mac = onMac(win.navigator);
  let lit = null;
  const tableLight = new LightTableRows();
  const changes = new win.MutationObserver(() => clear());
  function clear() {
    if (!lit) return;
    lit = null;
    highlights.delete(LIGHT);
    tableLight.clear();
    changes.disconnect();
  }
  observePointerLight(doc, clear);
  doc.addEventListener('pointermove', event => {
    const target = element(event.target), words = target?.closest(FIELD + ',' + PEEK);
    if (!words || !host.contains(words)) { clear(); return; }
    if (event.pointerType === 'touch' || event.buttons || !pointerLight(doc) ||
        !highlights || typeof win.Highlight !== 'function' || !uncovered() ||
        doc.getSelection()?.isCollapsed === false) { clear(); return; }
    const cover = words.closest('.dossier-cover'), source = coverQuoteSource(words);
    if (!source || !available(source)) { clear(); return; }
    const hit = pointed(words, target, doc, event.clientX, event.clientY);
    if (!hit) { clear(); return; }
    const row = hit.span.row;
    const anchor = event.shiftKey && row && lit?.words === words &&
      lit.anchor.row?.closest('.md-table') === row.closest('.md-table') ? lit.anchor : hit.span;
    const start = Math.min(anchor.start, hit.span.start), end = Math.max(anchor.end, hit.span.end);
    const body = drawnText(words), selection = body.slice(start, end);
    const text = row ? selection : selection.trimEnd();
    if (!text.trim()) { clear(); return; }
    if (lit?.words === words && lit.excerpt.start === start && lit.excerpt.end === start + text.length &&
        lit.excerpt.revision === source.revision && lit.anchor.start === anchor.start) return;
    const range = anchor === hit.span ? hit.range : rangeOf(words, start, end);
    if (!range) { clear(); return; }
    clear();
    lit = { words, anchor, range, excerpt: { start, end: start + text.length, text,
      revision: source.revision, section: selectionSection(words, range) } };
    tableLight.paint(words, lit.excerpt);
    highlights.set(LIGHT, new win.Highlight(range));
    changes.observe(cover, { subtree: true, childList: true, attributes: true, attributeFilter: ['open', 'data-cover-quote-revision'] });
    changes.observe(cover.parentElement, { childList: true, attributes: true, attributeFilter: ['data-cover-closed', 'hidden', 'inert'] });
  }, { passive: true });
  doc.addEventListener('pointerdown', clear, true);
  doc.addEventListener('pointerleave', clear);
  doc.addEventListener('focusin', clear);
  doc.addEventListener('scroll', clear, { capture: true, passive: true });
  doc.addEventListener('visibilitychange', clear);
  doc.addEventListener('selectionchange', () => { if (doc.getSelection()?.isCollapsed === false) clear(); });
  win.addEventListener('blur', clear);
  win.addEventListener('resize', clear);

  doc.addEventListener('keydown', event => {
    const returning = event.key === 'Enter' && !event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey;
    const copying = copyKey(event, mac);
    if ((!returning && !copying) || event.defaultPrevented || event.isComposing || event.repeat ||
        !available() || !uncovered() || element(event.target)?.closest(RETURN_CONTROL)) return;
    const selection = doc.getSelection(), words = entryOf(selection?.anchorNode);
    const field = returning && words && host.contains(words) && coverQuoteSource(words);
    const picked = field && selected(words, doc);
    const source = lit && coverQuoteSource(lit.words);
    const hover = lit && selection?.isCollapsed !== false && pointerLight(doc) && source?.revision === lit.excerpt.revision &&
      available(source) && host.contains(lit.words) && lit.range.getClientRects().length ? lit : null;
    if (!field && !hover) return;
    event.preventDefault(); event.stopImmediatePropagation();
    if (picked) choose(words, picked);
    else if (hover && returning) { clear(); choose(hover.words, hover.excerpt); }
    else if (hover && copying) copy(tableLight.copied() ?? hover.excerpt.text);
  }, { capture: true });
}

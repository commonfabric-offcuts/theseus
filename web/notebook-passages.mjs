// Notebook display is a surface of the message passage owners, not another
// selection implementation. The page supplies its saved source and eligibility.
import { FeedPassages } from './feed-passages.mjs';
import { DossierSelectionQuote } from './dossier-selection-quote.mjs';
import { drawnText, drawnRevision } from './message-format.mjs';
import { copyText } from './message-menu.mjs';
import { copyKey, onMac } from './writing-input.mjs';

const WORDS = '.notebook-reading-words';
const writing = at => at?.closest?.('input,textarea,select,[contenteditable]');
const element = node => node?.nodeType === 1 ? node : node?.parentElement;

// Locate the selected display in its actual card region, not an earlier
// identical phrase elsewhere on the page. Removed image/detail lines can
// make a display selection noncontiguous; then no source highlight is guessed.
function notebookSourcePositions(body, shown, bounds) {
  let next = bounds.start;
  const positions = [];
  for (const [i, line] of shown.split('\n').entries()) {
    if (i) positions.push(next - 1);
    const at = body.indexOf(line, next);
    if (at < next || at + line.length > bounds.end) return null;
    for (let k = 0; k < line.length; k++) positions.push(at + k);
    next = at + line.length + 1;
  }
  return positions;
}
export function notebookSourceSpan(body, shown, excerpt, bounds = { start: 0, end: body.length }) {
  const positions = notebookSourcePositions(body, shown, bounds) ?? [];
  const start = positions[excerpt.start], end = positions[excerpt.end - 1] + 1;
  return Number.isInteger(start) && body.slice(start, end) === excerpt.text ? { start, end } : { start: -1, end: -1 };
}
export function notebookSourceParts(body, shown, excerpt, bounds = { start: 0, end: body.length }) {
  const positions = notebookSourcePositions(body, shown, bounds);
  if (!positions || shown.slice(excerpt.start, excerpt.end) !== excerpt.text) return [];
  const parts = []; let start = excerpt.start;
  for (let at = start; at < excerpt.end; at++) {
    if (body[positions[at]] !== shown[at]) return [];
    if (at + 1 === excerpt.end || positions[at + 1] !== positions[at] + 1) {
      parts.push(body.slice(positions[start], positions[at] + 1)); start = at + 1;
    }
  }
  return parts;
}

export class NotebookPassages {
  constructor({ doc = document, template, quote }) {
    Object.assign(this, { doc, quote });
    const mac = onMac(doc.defaultView.navigator);
    this.records = new WeakMap(); this.current = null;
    this.passages = new FeedPassages({ host: doc.body, doc,
      entryOf: node => this.entryOf(node), wordsOf: entry => entry, fieldOf: words => words,
      highlight: 'notebook-lit-passage', lights: () => this.returns(this.current) });
    this.selection = new DossierSelectionQuote({ host: doc.body, template,
      entryOf: node => this.entryOf(node), selected: entry => this.passages.selected(entry),
      eligible: (id, entry) => this.valid(entry) && this.records.get(entry).source.source_ref.id === id,
      quote: (id, entry, excerpt) => this.open(entry, excerpt),
      surface: { cardOf: entry => entry, wordsOf: entry => entry,
        accepts: entry => this.valid(entry), pillId: 'notebook-quote-selection',
        placePill: (pill, chosen) => {
          const parent = chosen.entry.closest('dialog:modal') ?? doc.body;
          if (pill.parentElement !== parent) parent.append(pill);
        },
        uncovered: () => {
          const modal = doc.querySelector('dialog:modal');
          // Native touch/Tab can collapse the selection when the offered
          // pill takes focus. Its existing held capture still names the page.
          const entry = this.entryOf(doc.getSelection()?.anchorNode) ??
            this.selection?.held?.entry ?? this.selection?.current?.entry;
          return !doc.querySelector('.message-menu-list') && (!modal || Boolean(entry && modal.contains(entry)));
        } } });
    let pointer = null;
    doc.addEventListener('pointerdown', event => {
      pointer = event.pointerType === 'touch' ? null : { x: event.screenX, y: event.screenY };
    }, true);
    doc.addEventListener('pointermove', event => {
      if (event.pointerType === 'touch') return;
      const still = pointer && pointer.x === event.screenX && pointer.y === event.screenY;
      pointer = { x: event.screenX, y: event.screenY };
      if (still || event.buttons) return;
      const entry = this.entryOf(event.target);
      if (!entry || !this.valid(entry)) { this.clear(); return; }
      if (writing(doc.activeElement) || doc.activeElement?.closest?.('.composer,[role=menu]')) { this.clear(); return; }
      this.current = entry;
      // Like a message card, the pointer's reading place owns Return only
      // while no writing or actual control has its focus.
      if (doc.getSelection()?.isCollapsed !== false) entry.focus({ preventScroll: true });
      this.passages.follow(entry); this.passages.point(event, entry);
    });
    doc.addEventListener('keydown', event => {
      if (event.defaultPrevented || event.isComposing || event.keyCode === 229 || writing(event.target)) return;
      const selected = doc.getSelection(), entry = selected?.isCollapsed === false
        ? this.entryOf(selected.anchorNode) : this.current;
      if (!this.returns(entry)) return;
      const chosen = this.passages.chosen(entry);
      if (event.key === 'Enter' && !event.metaKey && !event.ctrlKey && !event.altKey && !event.shiftKey && chosen) {
        event.preventDefault(); this.open(entry, chosen);
      } else if (copyKey(event, mac) && selected?.isCollapsed !== false) {
        const words = this.passages.copied(entry);
        if (words) { event.preventDefault(); copyText(words); }
      }
    }, true);
    doc.addEventListener('focusin', () => { if (!this.returns(this.current)) this.clear(); });
    this.changes = new doc.defaultView.MutationObserver(() => {
      if (this.current && !this.valid(this.current)) this.clear();
    });
    this.changes.observe(doc.body, { subtree: true, childList: true, attributes: true,
      attributeFilter: ['hidden', 'inert', 'open', 'class'] });
    doc.defaultView.addEventListener('pagehide', () => { this.clear(); this.changes.disconnect(); });
  }
  bind(entry, { source, current, bounds }) {
    if (!entry || drawnText(entry) === undefined || !source?.source_ref?.revision) return;
    const previous = this.records.get(entry), ref = source.source_ref;
    if (previous && previous.source.source_ref.revision !== ref.revision && this.current === entry) this.clear();
    entry.classList.add('notebook-reading-words'); entry.tabIndex = -1;
    entry.dataset.id = ref.id;
    this.records.set(entry, { source, current, bounds, text: drawnText(entry), revision: drawnRevision(entry) });
  }
  entryOf(node) {
    const entry = element(node)?.closest?.(WORDS);
    return entry && this.records.has(entry) ? entry : null;
  }
  valid(entry) {
    const record = entry && this.records.get(entry);
    if (!record || !entry.isConnected || !record.current() || entry.closest('[hidden],[inert],.deck-writing,.deck-asking')) return false;
    const modal = this.doc.querySelector('dialog:modal');
    if (modal && !modal.contains(entry) || this.doc.querySelector('.message-menu-list')) return false;
    const style = this.doc.defaultView.getComputedStyle(entry);
    return style.visibility === 'visible' && style.display !== 'none' && Boolean(entry.getClientRects().length) &&
      record.text === drawnText(entry) && record.revision === drawnRevision(entry);
  }
  returns(entry) {
    if (!this.valid(entry)) return false;
    const at = this.doc.activeElement;
    if (writing(at) || at?.closest?.('button,a[href],[role=button]')) return false;
    return at === this.doc.body || at === entry || at?.matches?.('.deck-card') && at.contains(entry);
  }
  async open(entry, excerpt) {
    if (!this.valid(entry) || !excerpt?.text?.trim()) return;
    const { source, text, bounds } = this.records.get(entry);
    const chosen = { source: structuredClone(source.source_ref), owner_scope: { ...source.owner_scope },
      // The selected display can omit a card's hidden details/image lines.
      // Its exact Markdown excerpt is still from this immutable page revision.
      text: excerpt.text, parts: notebookSourceParts(source.body, text, excerpt, bounds),
      ...notebookSourceSpan(source.body, text, excerpt, bounds) };
    this.clear(); this.selection.clear();
    await this.quote(chosen, entry);
  }
  clear() { this.current = null; this.passages.clear(); }
}

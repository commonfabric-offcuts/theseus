// A card's passages light under the pointer as the Reader's do
// (docs/interaction.md, "The light"): a sentence of a paragraph, or a heading,
// a list item, a quote, a code block or a table, read as the Reader reads them
// (message-format.mjs, passageSpans), on a topic's card and a dossier's alike.
// Moving with Shift held, or a Shift-click, lights from the passage lit first
// to the one under the pointer, growing from words dragged over when there are
// some. What lights is what Return quotes and what ⌘C copies on the lit
// message (message-menu.mjs), so a hover never promises a quote Return would
// not make. The light is painted as a highlight over the card's own words
// (CSS.highlights), so the card's nodes and what it stores stay as they are.
import { drawnText, passageSpans, rangeOf, sourcePosition } from './message-format.mjs';
import { cardIn } from './fold.mjs';

const NAME = 'lit-passage';
const WORDS = ':scope > .message-preview';

export class FeedPassages {
  // host: the list of messages. lights(): whether Return on the lit message
  // would answer it now, so a passage may light (message-menu.mjs, returns).
  // entryOf(target): the entry a target is in.
  constructor({ host, lights, entryOf, doc = globalThis.document }) {
    Object.assign(this, { host, lights, entryOf, doc });
    this.win = doc.defaultView;
    this.lit = null; this.pointer = null; this.shifted = false;
    // A card drawn again under its light (the whole of a cut-off message
    // arriving, an edit) is lit again on its new words.
    this.redrawn = new this.win.MutationObserver(() => this.paint());
    // A Shift-click lights, as a Shift-move does, and opens nothing; the
    // browser's own selection is kept from growing beside it, so what lights
    // is what quotes.
    host.addEventListener('pointerdown', event => {
      this.shifted = false;
      if (!event.shiftKey || event.button !== 0 || event.pointerType === 'touch') return;
      const entry = this.entryOf(event.target), hit = entry && this.lights() && this.at(event.clientX, event.clientY, entry);
      if (!hit) return;
      this.shifted = true;
      this.light(entry, hit, true);
    }, true);
    host.addEventListener('mousedown', event => { if (this.shifted) event.preventDefault(); }, true);
    host.addEventListener('click', event => {
      if (!this.shifted) return;
      this.shifted = false;
      event.preventDefault(); event.stopPropagation();
    }, true);
  }
  get supported() { return typeof this.win.Highlight === 'function' && Boolean(this.win.CSS?.highlights); }

  // The pointer moved over a lit entry, with no button held: the passage
  // under it lights, or with Shift held the light grows to it. Off the words
  // (between lines, beside a short one, on the author's line) the light
  // stays as it was, as in the Reader.
  point(event, entry) {
    if (!this.supported || event.pointerType === 'touch' || event.buttons) return;
    if (!this.lights()) { this.clear(); return; }
    const now = { x: event.clientX, y: event.clientY };
    if (this.pointer && Math.hypot(now.x - this.pointer.x, now.y - this.pointer.y) < 2) return;
    this.pointer = now;
    const hit = this.at(now.x, now.y, entry);
    if (hit) this.light(entry, hit, event.shiftKey);
  }

  // The card's words and the passage of them under a point, or null when
  // the point is not on them.
  at(x, y, entry) {
    const card = cardIn(entry), words = card?.querySelector(WORDS), text = words && drawnText(words);
    if (text === undefined || !words.getClientRects().length) return null;
    const caret = this.doc.caretPositionFromPoint?.(x, y), range = caret ? null : this.doc.caretRangeFromPoint?.(x, y);
    const node = caret ? caret.offsetNode : range?.startContainer, offset = caret ? caret.offset : range?.startOffset;
    if (!node || node.nodeType !== 3 || !words.contains(node)) return null;
    const position = sourcePosition(node, offset);
    if (position === null) return null;
    // A caret falls between two characters: the passage is the one whose
    // words are under the point, of those either side of it.
    const spans = passageSpans(text, this.doc).filter(span => span.start <= position && position <= span.end);
    const under = spans.find(span => {
      const shown = rangeOf(words, span.start, span.end);
      return shown && [...shown.getClientRects()].some(box => x >= box.left && x <= box.right && y >= box.top && y <= box.bottom);
    });
    return under ? { words, span: under } : null;
  }

  // Lights a passage of an entry's words; extend grows the light from what
  // is lit there, or from the passages words dragged over in it touch.
  light(entry, { words, span }, extend = false) {
    if (extend) this.adopt(entry, words);
    const anchor = extend && this.lit?.words === words ? this.lit.anchor : span;
    this.lit = { entry, words, anchor, start: Math.min(anchor.start, span.start), end: Math.max(anchor.end, span.end) };
    this.paint();
  }
  // Words dragged over in the entry become the light's anchor, the passages
  // they touch, and the selection gives way to it.
  adopt(entry, words) {
    const chosen = this.selected(entry);
    if (!chosen) return;
    const touched = passageSpans(drawnText(words), this.doc).filter(span => span.start < chosen.end && span.end > chosen.start);
    if (!touched.length) return;
    const anchor = { start: touched[0].start, end: touched.at(-1).end };
    this.lit = { entry, words, anchor, ...anchor };
    this.doc.getSelection()?.removeAllRanges();
  }

  paint() {
    const lit = this.lit;
    if (!lit) return;
    const range = lit.words.isConnected && drawnText(lit.words) !== undefined ? rangeOf(lit.words, lit.start, lit.end) : null;
    if (!range) { this.clear(); return; }
    this.win.CSS.highlights.set(NAME, new this.win.Highlight(range));
    this.redrawn.disconnect();
    this.redrawn.observe(lit.words, { childList: true, subtree: true });
  }
  clear() {
    this.lit = null; this.pointer = null;
    this.redrawn.disconnect();
    if (this.supported) this.win.CSS.highlights.delete(NAME);
  }
  // The light follows the message's: lighting another message, or none, puts it out.
  follow(entry) { if (this.lit && this.lit.entry !== entry) this.clear(); }

  // Words selected wholly inside the entry's words: {start, end, text}, the
  // author's own words for them (as the Reader quotes a selection), or null.
  selected(entry) {
    const words = cardIn(entry)?.querySelector(WORDS), text = words && drawnText(words), selection = this.doc.getSelection();
    if (text === undefined || !selection?.rangeCount || selection.isCollapsed) return null;
    const range = selection.getRangeAt(0);
    if (!words.contains(range.startContainer) || !words.contains(range.endContainer)) return null;
    const start = sourcePosition(range.startContainer, range.startOffset), end = sourcePosition(range.endContainer, range.endOffset, true);
    return start === null || end === null || end <= start ? null : { start, end, text: text.slice(start, end) };
  }
  // What Return quotes on the lit entry: the words selected in it, else its
  // lit passages; null when neither, and Return replies with nothing quoted.
  chosen(entry) {
    if (!entry) return null;
    const selected = this.selected(entry);
    if (selected) return selected;
    const lit = this.lit;
    if (!lit || lit.entry !== entry || !lit.words.isConnected) return null;
    const text = drawnText(lit.words);
    return text === undefined ? null : { start: lit.start, end: lit.end, text: text.slice(lit.start, lit.end) };
  }
  // What ⌘C copies with no words selected: the lit passages' words, without
  // the whitespace at their end, which is no words (docs/topic-reading.md).
  copied(entry) {
    const lit = this.lit;
    if (!entry || !lit || lit.entry !== entry || !lit.words.isConnected) return null;
    const text = drawnText(lit.words);
    return text === undefined ? null : text.slice(lit.start, lit.end).trimEnd() || null;
  }
}

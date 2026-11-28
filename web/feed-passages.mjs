// A card's passages light under the pointer as the Reader's do
// (docs/interaction.md, "The light"): a sentence of a paragraph, or a heading,
// a list item, a quote, a code block or a table, read as the Reader reads them
// (message-format.mjs, passageSpans), on a topic's card and a dossier's alike.
// Moving with Shift held, or a Shift-click, lights from the passage lit first
// to the one under the pointer, growing from words dragged over when there are
// some; a Shift-click on a link is the browser's, and opens it. What lights
// is what Return quotes and what ⌘C copies on the lit message
// (message-menu.mjs), so a hover never promises a quote Return would not make:
// it lights only while Return would quote it, and goes out as the focus moves
// where Return does something else, or as the card is drawn again with other
// words. The light is painted as a highlight over the card's own words
// (CSS.highlights), so the card's nodes and what it stores stay as they are.
// A highlight paints only its words' own height, so the rest of the dark field,
// as tall line by line as the Reader's (lit-field.mjs), is painted behind the
// words on the background of the box they show in (the card, or a code block,
// a table or an excerpt that clips them), which moves nothing on the card and
// is clipped and scrolled with the words.
import { drawnDisplayRules, drawnRevision, drawnText, passageSpans, rangeOf, sourcePosition } from './message-format.mjs';
import { cardIn } from './fold.mjs';
import { fieldLayers, readerField, wordLines } from './lit-field.mjs';
import { pointerLight, observePointerLight } from './pointer-light.mjs';

const NAME = 'lit-passage';
const WORDS = ':scope > .message-preview';

// A caret falls between characters. Use the range's geometry to choose the
// actual passage under the pointer, including at a wrapped sentence boundary.
export function passageAt(words, doc, x, y) {
  const text = words && drawnText(words);
  if (text === undefined || !words || !words.getClientRects().length) return null;
  const caret = doc.caretPositionFromPoint?.(x, y), range = caret ? null : doc.caretRangeFromPoint?.(x, y);
  const node = caret ? caret.offsetNode : range?.startContainer, offset = caret ? caret.offset : range?.startOffset;
  if (!node || node.nodeType !== 3 || !words.contains(node)) return null;
  const position = sourcePosition(node, offset);
  if (position === null) return null;
  for (const span of passageSpans(text, doc, drawnDisplayRules(words))) {
    if (span.start > position || position > span.end) continue;
    const shown = rangeOf(words, span.start, span.end);
    if (shown && [...shown.getClientRects()].some(box => x >= box.left && x <= box.right && y >= box.top && y <= box.bottom)) {
      return { words, span, range: shown };
    }
  }
  return null;
}

export class FeedPassages {
  // host: the list of messages. lights(): whether Return on the lit message
  // would answer it now, so a passage may light (message-menu.mjs, returns).
  // entryOf(target): the entry a target is in.
  constructor({ host, lights, entryOf, doc = globalThis.document, wordsOf = entry => cardIn(entry)?.querySelector(WORDS), highlight = NAME, fieldOf = words => words.parentElement }) {
    Object.assign(this, { host, lights, entryOf, doc, wordsOf, highlight, fieldOf });
    this.win = doc.defaultView;
    this.lit = null; this.pointer = null; this.shifted = false; this.fielded = [];
    // An edit puts the light out: its old offsets cannot stand for other
    // words. Loading the rest of the same revision can keep a complete
    // passage already in its unchanged excerpt, rebuilding the highlight on
    // the new word nodes. A passage cut at the excerpt's end needs a fresh
    // pointer choice from the whole sentence. No refresh takes Return from
    // writing or turns Light back on.
    this.redrawn = new this.win.MutationObserver(() => {
      const lit = this.lit, text = lit && drawnText(lit.words);
      if (lit && text !== lit.text) {
        if (typeof text !== 'string' || !Number.isSafeInteger(lit.revision) || lit.revision < 1 || drawnRevision(lit.words) !== lit.revision ||
            text.length <= lit.text.length || !text.startsWith(lit.text) || lit.end >= lit.text.length ||
            !pointerLight(this.doc) || !this.lights()) { this.clear(); return; }
        lit.text = text;
      }
      this.paint();
    });
    // The words wrapping anew (the window or the card resized, the card
    // growing to its whole message) move the lines the field lies behind.
    this.sized = new this.win.ResizeObserver(() => this.field());
    this.lightSetting = observePointerLight(doc, () => this.clear());
    // A Shift-click lights, as a Shift-move does, and opens nothing; the
    // browser's own selection is kept from growing beside it, so what lights
    // is what quotes.
    host.addEventListener('pointerdown', event => {
      this.shifted = false;
      if (!pointerLight(this.doc)) return;
      if (!event.shiftKey || event.button !== 0 || event.pointerType === 'touch') return;
      // A link is only a link, as in the Reader: a Shift-click on one is the
      // browser's, which opens it in a new window, and lights nothing.
      if (event.target.closest?.('a')) return;
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
    // The focus moving where Return does something else (a control of the
    // message or its bar, writing, a pop-up, the Reader) puts the light out,
    // as it goes out in the Reader: what lights is what Return would quote.
    doc.addEventListener('focusin', () => { if (this.lit && !this.lights()) this.clear(); });
  }
  get supported() { return typeof this.win.Highlight === 'function' && Boolean(this.win.CSS?.highlights); }

  // The pointer moved over a lit entry, with no button held: the passage
  // under it lights, or with Shift held the light grows to it. Off the words
  // (between lines, beside a short one, on the author's line) the light
  // stays as it was, as in the Reader.
  point(event, entry) {
    if (!pointerLight(this.doc)) { this.clear(); return; }
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
    return passageAt(this.wordsOf(entry), this.doc, x, y);
  }

  // Lights a passage of an entry's words; extend grows the light from what
  // is lit there, or from the passages words dragged over in it touch.
  light(entry, { words, span }, extend = false) {
    if (!pointerLight(this.doc)) { this.clear(); return; }
    if (extend) this.adopt(entry, words);
    const anchor = extend && this.lit?.words === words ? this.lit.anchor : span;
    this.lit = { entry, words, text: drawnText(words), revision: drawnRevision(words), anchor, start: Math.min(anchor.start, span.start), end: Math.max(anchor.end, span.end) };
    this.paint();
  }
  // Words dragged over in the entry become the light's anchor, the passages
  // they touch, and the selection gives way to it.
  adopt(entry, words) {
    const chosen = this.selected(entry);
    if (!chosen) return;
    const touched = passageSpans(drawnText(words), this.doc, drawnDisplayRules(words)).filter(span => span.start < chosen.end && span.end > chosen.start);
    if (!touched.length) return;
    const anchor = { start: touched[0].start, end: touched.at(-1).end };
    this.lit = { entry, words, anchor, ...anchor };
    this.doc.getSelection()?.removeAllRanges();
  }

  // The lit words' range as they are drawn now, or null.
  range(lit = this.lit) {
    return lit?.words.isConnected && drawnText(lit.words) !== undefined ? rangeOf(lit.words, lit.start, lit.end) : null;
  }
  paint() {
    const lit = this.lit;
    if (!lit) return;
    const range = this.range(lit);
    if (!range) { this.clear(); return; }
    this.win.CSS.highlights.set(this.highlight, new this.win.Highlight(range));
    this.field(range);
    this.redrawn.disconnect();
    this.redrawn.observe(lit.words, { childList: true, subtree: true });
    if (this.sizing !== lit.words) {
      this.sized.disconnect();
      this.sized.observe(lit.words); this.sized.observe(lit.words.parentElement);
      this.sizing = lit.words;
    }
  }
  // The dark field behind the lit words, one layer a line: as tall as the
  // Reader's field for the same words (lit-field.mjs), on the background of the
  // box each line shows in (clipBox), so it shows only where its words do and
  // scrolls with them.
  field(range = this.range()) {
    this.unfield();
    const card = this.lit?.words && this.fieldOf(this.lit.words), lines = range && card ? wordLines(range, card) : [];
    const height = lines.length && readerField(this.doc);
    if (!height) return;
    const boxes = new Map();
    for (const line of lines) boxes.set(line.box, [...(boxes.get(line.box) ?? []), line]);
    for (const [box, its] of boxes) {
      const layers = fieldLayers(box, its, height);
      Object.assign(box.style, {
        backgroundImage: layers.map(() => 'linear-gradient(var(--pointer-lit-field,var(--lit-field)),var(--pointer-lit-field,var(--lit-field)))').join(','),
        backgroundPosition: layers.map(layer => `${layer.x}px ${layer.y}px`).join(','),
        backgroundSize: layers.map(layer => `${layer.width}px ${layer.height}px`).join(','),
        backgroundRepeat: 'no-repeat', backgroundAttachment: 'local',
      });
      this.fielded.push(box);
    }
  }
  unfield() {
    for (const box of this.fielded.splice(0)) for (const name of ['background-image', 'background-position', 'background-size', 'background-repeat', 'background-attachment']) box.style.removeProperty(name);
  }
  clear() {
    this.lit = null; this.pointer = null;
    this.redrawn.disconnect(); this.sized.disconnect(); this.sizing = null;
    this.unfield();
    if (this.supported) this.win.CSS.highlights.delete(this.highlight);
  }
  // The light follows the message's: lighting another message, or none, puts it out.
  follow(entry) { if (this.lit && this.lit.entry !== entry) this.clear(); }

  // Words selected wholly inside the entry's words: {start, end, text}, the
  // author's own words for them (as the Reader quotes a selection), or null.
  selected(entry) {
    const words = this.wordsOf(entry), text = words && drawnText(words), selection = this.doc.getSelection();
    if (text === undefined || !selection?.rangeCount || selection.isCollapsed) return null;
    const range = selection.getRangeAt(0);
    if (!words.contains(range.startContainer) || !words.contains(range.endContainer)) return null;
    const start = sourcePosition(range.startContainer, range.startOffset), end = sourcePosition(range.endContainer, range.endOffset, true);
    return start === null || end === null || end <= start ? null : { start, end, text: text.slice(start, end) };
  }
  // What Return quotes on the lit entry: the words selected in it, else its
  // lit passages; null when neither, and Return replies with nothing quoted.
  // revision: the revision of the message the card's words are, which the
  // quote names, since its words come from the card (docs/message-edit.md).
  chosen(entry) {
    if (!entry) return null;
    const words = this.wordsOf(entry), revision = words ? drawnRevision(words) : undefined;
    const selected = this.selected(entry);
    if (selected) return { ...selected, revision };
    if (!pointerLight(this.doc)) return null;
    const lit = this.lit;
    if (!lit || lit.entry !== entry || !lit.words.isConnected) return null;
    const text = drawnText(lit.words);
    return text === undefined ? null : { start: lit.start, end: lit.end, text: text.slice(lit.start, lit.end), revision };
  }
  // What ⌘C copies with no words selected: the lit passages' words, without
  // the whitespace at their end, which is no words (docs/topic-reading.md).
  copied(entry) {
    if (!pointerLight(this.doc)) return null;
    const lit = this.lit;
    if (!entry || !lit || lit.entry !== entry || !lit.words.isConnected) return null;
    const text = drawnText(lit.words);
    return text === undefined ? null : text.slice(lit.start, lit.end).trimEnd() || null;
  }
}

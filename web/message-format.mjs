import { pairFeedFence } from './feed-fence-copy.mjs';
// A message's words as they were written to be read: headings, lists and task
// lists, tables (with a dash row, as an agent types them without one, or drawn
// in box lines), quotes holding blocks, code and rules, with bold, italics,
// struck words, inline code and links in the lines (docs/topic-reading.md,
// "Formatted words"). A message body is plain text in Core; this reads its
// Markdown on the page and builds nodes, never markup, so nothing in a message
// can become HTML. Web addresses become links as everywhere else (links.mjs).
//
// Every node drawn knows which characters of the message it shows, so the
// Reader quotes the author's own words for whatever is selected
// (sourcePosition). Reading is linear in the message's length: each pass
// moves forward, and every search for where a mark or code closes remembers
// where it stopped.
import { addressAt, addressStarts, lastWords, linkNode, topicAt, topicStarts, wordNodes, writtenLink } from './links.mjs';
import { deferFencePaint, fenceCopyButton } from './fence-copy.mjs';
import { fenceEnd, fenceOpen } from './fences.mjs';
import { charAt, charBefore, isEscapable, isPunctuation, isSpace } from './characters.mjs';

// ---- Words and where each of their characters is in the message

// Text read from a message, with the place in the message of each character.
// Characters the reading drops (a quote's "> ", a CR before a line end, an
// escaping backslash, a list's carried-on indent) belong to the character
// after them, so a boundary before a character is just after the one before.
// runs: [textIndex, messageIndex] where a run of verbatim characters starts.
class Mapped {
  constructor(text, runs, left) { this.text = text; this.runs = runs; this.left = left; }

  // A message's body as lines without the CR of a CR LF.
  static of(body) {
    const runs = [[0, 0]];
    let text = '', from = 0;
    for (let cr = body.indexOf('\r\n'); cr >= 0; cr = body.indexOf('\r\n', from)) {
      text += body.slice(from, cr); from = cr + 1;
      if (runs.at(-1)[0] === text.length) runs.pop();
      runs.push([text.length, from]);
    }
    return new Mapped(text + body.slice(from), runs, 0);
  }

  static join(parts) {
    let text = '';
    const runs = [];
    for (const part of parts) {
      for (const [t, s] of part.runs) {
        if (t >= part.text.length) break;
        const at = text.length + t, prev = runs.at(-1);
        if (prev && prev[0] === at) runs.pop();
        else if (prev && prev[1] + at - prev[0] === s) continue;
        runs.push([at, s]);
      }
      text += part.text;
    }
    return new Mapped(text, runs.length ? runs : [[0, parts[0].left]], parts[0].left);
  }

  // The run holding character k.
  run(k) {
    const runs = this.runs;
    let lo = 0, hi = runs.length - 1;
    while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (runs[mid][0] <= k) lo = mid; else hi = mid - 1; }
    return lo;
  }
  pos(k) { const [t, s] = this.runs[this.run(k)]; return s + k - t; }
  // Where the boundary before character k falls in the message.
  at(k) { return k <= 0 ? this.left : this.pos(Math.min(k, this.text.length) - 1) + 1; }
  end() { return this.at(this.text.length); }

  slice(a, b = this.text.length) {
    a = Math.max(0, Math.min(a, this.text.length)); b = Math.max(a, Math.min(b, this.text.length));
    const left = this.at(a);
    if (a === b) return new Mapped('', [[0, left]], left);
    const runs = [[0, this.pos(a)]];
    for (let r = this.run(a) + 1; r < this.runs.length && this.runs[r][0] < b; r++) runs.push([this.runs[r][0] - a, this.runs[r][1]]);
    return new Mapped(this.text.slice(a, b), runs, left);
  }

  trim() {
    let a = 0, b = this.text.length;
    while (a < b && /\s/.test(this.text[a])) a++;
    while (b > a && /\s/.test(this.text[b - 1])) b--;
    return this.slice(a, b);
  }
}

// What each drawn node shows of the message: {words} for a text node,
// {start, end} for an element or a glyph (a list's bullet, a passage's line
// break), with link: true on an anchor and atomic: true where its words are
// not the message's (a [named](link)).
const SOURCE = new WeakMap();
const placed = (node, span) => { SOURCE.set(node, span); return node; };
const tick = (meter, steps = 1) => { if (meter) meter.steps += steps; };

// A boundary at the edge of a node's words is at the edge of every element
// it starts or ends, so a selection of a whole bold word, list item or table
// quotes its marks too.
function outerEdge(node, side) {
  let at = node, found = null;
  for (;;) {
    const parent = at.parentNode, span = parent ? SOURCE.get(parent) : null;
    if (!span || span.link) break;
    const kids = parent.childNodes;
    if (kids[side === 'start' ? 0 : kids.length - 1] !== at) break;
    at = parent; found = span;
  }
  return found ? found[side] : null;
}

function linkPosition(a, span, offset, length, end) {
  if (offset <= 0) return outerEdge(a, 'start') ?? span.start;
  if (offset >= length) return outerEdge(a, 'end') ?? span.end;
  // A link that shows other words than the message's (a topic's name, a
  // [named](link)) is taken whole; an address shows its own.
  if (span.atomic || a.dataset?.words !== undefined) return end ? span.end : span.start;
  return span.start + offset;
}

// The text nodes under node, in order.
function textsIn(node, found = []) {
  for (const child of node.childNodes ?? []) { if (child.nodeType === 3) found.push(child); else textsIn(child, found); }
  return found;
}

const startOf = node => (node.nodeType === 3 ? sourcePosition(node, 0) : SOURCE.get(node)?.start ?? sourcePosition(node, 0));
const endOf = node => (node.nodeType === 3 ? sourcePosition(node, node.data.length, true) : SOURCE.get(node)?.end ?? sourcePosition(node, node.childNodes.length, true));

// Where a selection boundary (a node and an offset in it, as a Range gives
// them) falls in the message's text, or null for a node this did not draw.
// end: the boundary ends the selection, so a link it falls inside is taken
// to its end.
export function sourcePosition(node, offset, end = false) {
  const span = SOURCE.get(node);
  if (node.nodeType === 3) {
    if (!span) {
      // Words drawn inside a link (a [named](link)'s marks among them) are the link's.
      let a = node.parentNode;
      while (a && !SOURCE.has(a)) a = a.parentNode;
      const link = a ? SOURCE.get(a) : null;
      if (!link?.link) return null;
      let before = 0;
      for (const words of textsIn(a)) { if (words === node) break; before += words.data.length; }
      return linkPosition(a, link, before + offset, a.textContent.length, end);
    }
    const length = node.data.length;
    if (offset <= 0 || offset >= length) {
      const edge = outerEdge(node, offset <= 0 ? 'start' : 'end');
      if (edge !== null) return edge;
    }
    if (span.words) return span.words.at(offset);
    return offset <= 0 ? span.start : offset >= length || end ? span.end : span.start;
  }
  if (span?.link) return linkPosition(node, span, offset, node.childNodes.length, end);
  const kids = node.childNodes ?? [];
  if (offset < kids.length) return startOf(kids[offset]);
  if (kids.length) return endOf(kids[kids.length - 1]);
  return span ? (end ? span.end : span.start) : null;
}

// ---- Blocks

const HEADING = /^ {0,3}(#{1,6})[ \t]+/;
const RULE = /^ {0,3}([-*_])(?:[ \t]*\1){2,}[ \t]*$/;
const ITEM = /^([ \t]*)([-*+]|\d{1,9}[.)])[ \t]+(.*)$/;
const TASK = /^\[([ xX])\][ \t]+/;
const QUOTE = /^ {0,3}>[ \t]?(.*)$/;
const BOX = /^[ \t]*[─-╿]/;
const DASHES = /^:?-+:?$/;
// A quote in a quote nests this deep; deeper, its words are a paragraph.
const MAX_QUOTE_DEPTH = 8;

// A table row's cells, without the outer bars; an escaped bar stays in its cell.
function cellsOf(row) {
  const text = row.text;
  let a = 0, b = text.length;
  while (a < b && /\s/.test(text[a])) a++;
  while (b > a && /\s/.test(text[b - 1])) b--;
  if (text[a] === '|') a++;
  if (b > a && text[b - 1] === '|' && text[b - 2] !== '\\') b--;
  const found = [];
  let parts = [], from = a;
  for (let i = a; i < b; i++) {
    if (text[i] === '\\' && text[i + 1] === '|') { parts.push(row.slice(from, i)); from = i + 1; i++; }
    else if (text[i] === '|') { parts.push(row.slice(from, i)); found.push(Mapped.join(parts).trim()); parts = []; from = i + 1; }
  }
  parts.push(row.slice(from, b));
  found.push(Mapped.join(parts).trim());
  return found;
}
export const cells = line => cellsOf(Mapped.of(String(line))).map(cell => cell.text);
const isDelimiter = text => text.includes('-') && cells(text).every(cell => DASHES.test(cell));
const alignOf = cell => (cell.startsWith(':') && cell.endsWith(':') ? 'center' : cell.endsWith(':') ? 'right' : cell.startsWith(':') ? 'left' : '');

// The lines of m, each with its text, where it is in m and in the message.
function linesOf(m, meter) {
  const lines = [], text = m.text;
  tick(meter, text.length + 1);
  for (let s = 0; ;) {
    const e = text.indexOf('\n', s), end = e < 0 ? text.length : e;
    lines.push({ text: text.slice(s, end), s, e: end, start: m.at(s), end: m.at(end) });
    if (e < 0) return lines;
    s = e + 1;
  }
}

const blank = line => !line.text.trim();
const tableStart = (lines, i) => lines[i].text.includes('|') && i + 1 < lines.length && isDelimiter(lines[i + 1].text) &&
  cells(lines[i + 1].text).length === cells(lines[i].text).length;
const boxStart = (lines, i) => i + 2 < lines.length && BOX.test(lines[i].text) && BOX.test(lines[i + 1].text) && BOX.test(lines[i + 2].text);
// How many cells a row of an agent's table without a dash row has: three or
// more, split by bars; anything else is 0, a sentence with a bar in it.
function looseWidth(line) {
  if (blank(line) || !line.text.includes('|') || isDelimiter(line.text)) return 0;
  const found = cells(line.text);
  return found.length >= 3 && !found.every(cell => DASHES.test(cell)) ? found.length : 0;
}
// The row after row i in the same table: the next line, or the one after a single blank line.
const nextRow = (lines, i, width) => {
  const k = i + 1 < lines.length && blank(lines[i + 1]) ? i + 2 : i + 1;
  return k < lines.length && looseWidth(lines[k]) === width ? k : -1;
};
const looseStart = (lines, i) => { const width = looseWidth(lines[i]); return width > 0 && nextRow(lines, i, width) >= 0; };
const startsBlock = (lines, i, images = null) => fenceOpen(lines[i].text, lines[i + 1]?.text) || HEADING.test(lines[i].text) || RULE.test(lines[i].text) || ITEM.test(lines[i].text) ||
  QUOTE.test(lines[i].text) || tableStart(lines, i) || boxStart(lines, i) || looseStart(lines, i) || Boolean(images?.of(lines[i].text));

// A heading's words, without its marks or a closing run of #s.
function headingWords(line, opening) {
  const text = line.text;
  let b = text.length;
  while (b > opening && /[ \t]/.test(text[b - 1])) b--;
  let k = b;
  while (k > opening && text[k - 1] === '#') k--;
  if (k < b && (k === opening || /[ \t]/.test(text[k - 1]))) { b = k; while (b > opening && /[ \t]/.test(text[b - 1])) b--; }
  return { a: opening, b };
}

// The blocks of m, in order, each with the span of the message it was read
// from ({kind, start, end, ...}). Blank lines only separate. partial: the
// text is an excerpt cut short, so a table's last row may be cut and is left
// as words. depth: how many quotes hold m. images, for a Notebook page's words: images.of(line) names the image a
// line outside a fenced block puts there ({name, id}, docs/decks.md "Images in a card"), or null; such a line is a
// block of its own ({kind: 'image', image}), at the top only, never inside a quote.
function blocksOf(m, partial, depth, meter, images = null) {
  const lines = linesOf(m, meter), blocks = [], n = lines.length;
  const words = (a, b) => (a <= b ? m.slice(lines[a].s, lines[b].e) : m.slice(lines[a - 1].e, lines[a - 1].e));
  const newline = k => m.slice(lines[k].e, lines[k].e + 1);
  const span = (a, b) => ({ start: lines[a].start, end: lines[b].end });
  let i = 0;
  while (i < n) {
    const line = lines[i];
    tick(meter, line.text.length + 1);
    if (blank(line)) { i++; continue; }
    const fence = fenceOpen(line.text, lines[i + 1]?.text);
    if (fence) {
      if (fence.end >= 0) {
        blocks.push({ kind: 'code', fenced: true, complete: !partial || i < n - 1, lang: '', ...span(i, i), words: m.slice(line.s + fence.after, line.s + fence.end) });
        i++; continue;
      }
      let j = i + 1;
      let end = -1;
      while (j < n) {
        tick(meter, lines[j].text.length + 1);
        end = fenceEnd(lines[j].text, fence);
        if (end >= 0) break;
        j++;
      }
      const ownLine = end >= 0 && !lines[j].text.slice(0, end).trim();
      // With no payload line, opening text is the payload: ```words\n```.
      // A blank payload line still keeps conventional info: ```py\n\n```.
      const payloadAt = fence.payloadAt ?? (ownLine && j === i + 1 && fence.info ? fence.after : null);
      const from = payloadAt !== null ? line.s + payloadAt : (lines[i + 1]?.s ?? line.e);
      const to = end < 0 ? m.text.length : ownLine ? lines[j - 1].e : lines[j].s + end;
      blocks.push({ kind: 'code', fenced: true, complete: !partial || j < n - 1, lang: payloadAt !== null ? '' : fence.lang, ...span(i, Math.min(j, n - 1)), words: m.slice(from, to) });
      i = j + 1; continue;
    }
    const image = images?.of(line.text);
    if (image) { blocks.push({ kind: 'image', image, ...span(i, i) }); i++; continue; }
    if (boxStart(lines, i)) {
      // A table a terminal drew, kept as drawn: monospace, without the indent it was pasted with.
      let j = i;
      while (j < n && BOX.test(lines[j].text)) tick(meter, lines[j++].text.length + 1);
      let pad = Infinity;
      for (let k = i; k < j; k++) pad = Math.min(pad, /^[ \t]*/.exec(lines[k].text)[0].length);
      const parts = [];
      for (let k = i; k < j; k++) {
        if (k > i) parts.push(newline(k - 1));
        parts.push(m.slice(lines[k].s + pad, lines[k].s + lines[k].text.trimEnd().length));
      }
      blocks.push({ kind: 'code', box: true, ...span(i, j - 1), words: Mapped.join(parts) });
      i = j; continue;
    }
    const heading = HEADING.exec(line.text);
    if (heading) {
      const { a, b } = headingWords(line, heading[0].length);
      blocks.push({ kind: 'heading', level: heading[1].length, words: m.slice(line.s + a, line.s + b), ...span(i, i) });
      i++; continue;
    }
    if (RULE.test(line.text)) { blocks.push({ kind: 'rule', ...span(i, i) }); i++; continue; }
    if (tableStart(lines, i)) {
      const aligns = cells(lines[i + 1].text).map(alignOf), rows = [];
      let j = i + 2;
      while (j < n && !blank(lines[j]) && lines[j].text.includes('|')) tick(meter, lines[j++].text.length + 1);
      let end = j;
      // An excerpt's last row may be cut: it stays as words after the table.
      if (partial && end === n && end > i + 2) end--;
      for (let k = i + 2; k < end; k++) rows.push({ cells: cellsOf(words(k, k)), ...span(k, k) });
      blocks.push({ kind: 'table', head: { cells: cellsOf(words(i, i)), ...span(i, i) }, aligns, rows, ...span(i, end - 1) });
      if (end < j) blocks.push({ kind: 'paragraph', words: words(end, end), ...span(end, end) });
      i = j; continue;
    }
    if (ITEM.test(line.text)) {
      const items = [];
      let j = i;
      while (j < n && !blank(lines[j])) {
        const text = lines[j].text, item = ITEM.exec(text);
        tick(meter, text.length + 1);
        if (item) {
          const task = TASK.exec(item[3]), at = lines[j].s + text.length - item[3].length + (task ? task[0].length : 0);
          items.push({ depth: Math.floor(item[1].replace(/\t/g, '  ').length / 2), marker: item[2], task: task ? (task[1] === ' ' ? 'open' : 'done') : null,
            parts: [m.slice(at, lines[j].e)], ...span(j, j) });
        } else if (/^[ \t]/.test(text) && !startsBlock(lines, j, images)) {
          // A line carried on under an item joins it, without its indent.
          const last = items.at(-1), lead = /^[ \t]*/.exec(text)[0].length;
          last.parts.push(newline(j - 1), m.slice(lines[j].s + lead, lines[j].s + text.trimEnd().length));
          last.end = lines[j].end;
        } else break;
        j++;
      }
      for (const item of items) { item.words = Mapped.join(item.parts); delete item.parts; }
      blocks.push({ kind: 'list', ordered: /\d/.test(items[0].marker), items, ...span(i, j - 1) });
      i = j; continue;
    }
    if (QUOTE.test(line.text)) {
      const parts = [];
      let j = i;
      for (let quote; j < n && (quote = QUOTE.exec(lines[j].text)); j++) {
        tick(meter, lines[j].text.length + 1);
        if (j > i) parts.push(newline(j - 1));
        parts.push(m.slice(lines[j].e - quote[1].length, lines[j].e));
      }
      const inner = Mapped.join(parts);
      blocks.push({ kind: 'quote', words: inner, blocks: depth < MAX_QUOTE_DEPTH ? blocksOf(inner, partial && j === n, depth + 1, meter) : null, ...span(i, j - 1) });
      i = j; continue;
    }
    if (looseStart(lines, i)) {
      // An agent's table: rows of bars of one width, at most one blank line between them.
      const width = looseWidth(lines[i]), at = [i];
      for (let k = nextRow(lines, i, width); k >= 0; k = nextRow(lines, k, width)) { tick(meter, lines[k].text.length + 1); at.push(k); }
      // An excerpt's last row may be cut: it stays as words.
      const cut = partial && at.at(-1) === n - 1 ? at.pop() : -1;
      if (at.length >= 2) {
        const [head, ...rows] = at.map(k => ({ cells: cellsOf(words(k, k)), ...span(k, k) }));
        blocks.push({ kind: 'table', head, aligns: [], rows, ...span(i, at.at(-1)) });
        if (cut >= 0) blocks.push({ kind: 'paragraph', words: words(cut, cut), ...span(cut, cut) });
        i = (cut >= 0 ? cut : at.at(-1)) + 1; continue;
      }
    }
    let j = i + 1;
    while (j < n && !blank(lines[j]) && !startsBlock(lines, j, images)) tick(meter, lines[j++].text.length + 1);
    blocks.push({ kind: 'paragraph', words: words(i, j - 1), ...span(i, j - 1) });
    i = j;
  }
  return blocks;
}

// The blocks of text, in order, each with the span of the text it was read from.
export function parseBlocks(text, { partial = false, meter, images = null } = {}) {
  return blocksOf(Mapped.of(String(text ?? '')), partial, 0, meter, images);
}

// ---- Inline: `code`, **bold** and __bold__, *italics* and _italics_,
// ~~struck~~, \-escaped marks, [words](https://…), bare addresses and topics'
// ids (links.mjs). Anything else is words.
//
// A line's words (a paragraph, a heading, a list item, a table cell) are read
// once, from the left, as CommonMark reads inlines: an escape is read first,
// then `code`, then [words](https://…), a bare address (GFM's autolinks) or a
// topic's id, and the runs of *, _ and ~~ that may open or close marks.
// Whether a [ opens a link is known before anything after it is read: one
// pass before the reading matches brackets as CommonMark finds a link's
// words, past escapes and code, which bind tighter, and finds the ] that
// closes each [ and whether (target) follows it. A [ that opens a link is
// read with its words; any other [ and every ] are words. The line's own
// syntax, not the address, says where an address ends: at an escape or code.
// It holds marks and brackets, inside a [ that is words as anywhere else.
// Which runs pair is CommonMark's
// delimiter algorithm ("process emphasis"), with its rules for where a run may
// open and close: left- and right-flanking by Unicode whitespace and
// punctuation (characters.mjs), _ opening or closing nothing inside a word,
// and the rule of three. ~~ is GFM's strikethrough, of exactly two tildes. A
// [named](link)'s words are read again as words of their own, with no link in
// them; links never hold links.
//
// What the reading finds is a set of spans that nest, each a thing that is
// words whole (an escape, code, a link) or a pair of marks around words. Each
// pass moves forward and every search remembers where it stopped, so reading
// is linear in the words' length. What the line holds at its top ({start,
// end, node}, in order) is what a passage may not cut.

// A link's target with its escapes read: \) is ).
const unescaped = target => target.replace(/\\([!-/:-@[-`{-~])/g, '$1');

function readLine(m, { doc = globalThis.document, partial = false, meter } = {}) {
  const text = m.text, n = text.length;
  const escapes = k => text[k] === '\\' && isEscapable(text[k + 1]);
  // Each run of backticks, by its length: where code that opens with a run of
  // that length may close.
  const runs = new Map();
  for (let k = 0; k < n; k++) {
    if (text[k] !== '`') continue;
    let len = 1;
    while (text[k + len] === '`') len++;
    if (!runs.has(len)) runs.set(len, []);
    runs.get(len).push(k);
    k += len - 1;
  }
  tick(meter, n);
  // A reader of code's closing runs that remembers where it stopped, for a
  // reading that moves forward: closing(k, len, to) is the first run of
  // exactly len backticks at or after k that ends by to, or -1.
  const closer = () => {
    const seen = new Map();
    return (k, len, to) => {
      const at = runs.get(len);
      if (!at) return -1;
      let r = seen.get(len);
      if (r === undefined) { let lo = 0, hi = at.length; while (lo < hi) { const mid = (lo + hi) >> 1; if (at[mid] < k) lo = mid + 1; else hi = mid; } r = lo; }
      while (r < at.length && at[r] < k) { tick(meter); r++; }
      seen.set(len, r);
      return r < at.length && at[r] + len <= to ? at[r] : -1;
    };
  };
  // closes[q]: where the bracket opened at q closes, with no space between, so
  // a [named](target) keeps the brackets its target holds; -1 when it does not.
  // An escaped bracket is the bracket as written, neither opening nor closing:
  // escapes are read from the left here as the line reads them. The line asks
  // only at a ( straight after a ], which no escape here can hold, so from
  // there on both readings agree.
  const closes = new Int32Array(n + 1).fill(-1);
  {
    const open = [];
    for (let k = 0; k < n; k++) {
      if (escapes(k)) k++;
      else if (isSpace(text[k])) open.length = 0;
      else if (text[k] === '(') open.push(k);
      else if (text[k] === ')' && open.length) closes[open.pop()] = k;
    }
    tick(meter, n);
  }
  // named[q]: the [named](link) the [ at q opens, {words: where its words end,
  // end, link}; undefined for a [ that is words. One pass matches brackets as
  // CommonMark does, reading escapes and code: each ] closes the latest open
  // [, which opens a link when (target) follows with an http(s) address and
  // no link is among its words. Links never hold links, so every [ open
  // around a link is words. A target is read once: what a link's target holds
  // is passed over, and a ] inside a target that is no address closes no [.
  const named = new Array(n);
  {
    const open = [], closing = closer();
    let failedUntil = -1;
    for (let k = 0; k < n; k++) {
      const c = text[k];
      if (escapes(k)) k++;
      else if (c === '`') {
        let len = 1;
        while (text[k + len] === '`') len++;
        const close = closing(k + len, len, n);
        k = (close >= 0 ? close + len : k + len) - 1;
      } else if (k < failedUntil) continue;
      else if (c === '[') open.push({ at: k, holdsLink: false });
      else if (c === ']' && open.length) {
        const opener = open.pop(), u = k > opener.at + 1 && text[k + 1] === '(' ? closes[k + 1] : -1;
        const link = u > 0 && !opener.holdsLink ? writtenLink(unescaped(text.slice(k + 2, u)), { meter }) : null;
        if (link) {
          named[opener.at] = { words: k, end: u + 1, link };
          // Those open around it hold it; the ones below the first that already did, too.
          for (let o = open.length - 1; o >= 0 && !open[o].holdsLink; o--) { tick(meter); open[o].holdsLink = true; }
          k = u;
        } else if (u > 0) failedUntil = u;
      }
    }
    tick(meter, n);
  }
  const addresses = addressStarts(text), topics = topicStarts(text), last = lastWords(text);

  // spans[start]: what starts there, {start, end, kind, inner, link}; inner is
  // the part of it drawn as words of their own: a mark's words, a link's.
  const spans = new Array(n);
  const record = span => { spans[span.start] = span; };

  // CommonMark's "process emphasis" over the runs one reading found, in order.
  // A run that finds no opener sets a floor for its kind, so no search reads
  // the same runs twice.
  const pairMarks = list => {
    list.forEach((run, k) => { run.prev = list[k - 1] ?? null; run.next = list[k + 1] ?? null; });
    const unlink = run => { if (run.prev) run.prev.next = run.next; if (run.next) run.next.prev = run.prev; };
    const floors = new Map();
    for (let closer = list[0] ?? null; closer;) {
      tick(meter);
      if (!closer.canClose) { closer = closer.next; continue; }
      const kind = closer.char === '~' ? '~' : `${closer.char}${closer.canOpen ? 1 : 0}${closer.len % 3}`, floor = floors.get(kind) ?? -1;
      let opener = closer.prev;
      // The rule of three: where either run may both open and close, runs
      // whose lengths add to a multiple of three pair only when both lengths are.
      const pairs = run => run.char === closer.char && run.canOpen &&
        !(closer.char !== '~' && (run.canClose || closer.canOpen) && (run.len + closer.len) % 3 === 0 && (run.len % 3 || closer.len % 3));
      while (opener && opener.pos > floor && !pairs(opener)) { tick(meter); opener = opener.prev; }
      if (opener && opener.pos > floor) {
        const width = closer.char === '~' || (opener.count >= 2 && closer.count >= 2) ? 2 : 1;
        opener.count -= width;
        // An opener gives the characters at the end of what is left of its run;
        // a closer, those at the start.
        const start = opener.from + opener.count, end = closer.from + width;
        closer.from = end; closer.count -= width;
        record({ start, end, kind: closer.char === '~' ? 's' : width === 2 ? 'strong' : 'em', inner: [start + width, end - width] });
        // The runs between them pair with nothing now.
        opener.next = closer; closer.prev = opener;
        if (!opener.count) unlink(opener);
        if (!closer.count) { unlink(closer); closer = closer.next; }
      } else {
        floors.set(kind, closer.prev ? closer.prev.pos : -1);
        const next = closer.next;
        if (!closer.canOpen) unlink(closer);
        closer = next;
      }
    }
  };

  // Reads from..to, recording what it finds. links: addresses, ids and
  // [named](link)s are read too, as they are but in a link's own words.
  const read = (from, to, links) => {
    const marks = [], closing = closer();
    let address = 0, topic = 0, noAddressBefore = 0;
    // What the line reads at k other than words: an escape, code, a run of
    // marks or a [ that opens a link; null for words.
    const syntaxAt = k => {
      const c = text[k];
      if (c === '\\') return escapes(k) ? 'escape' : null;
      if (c === '`') return 'code';
      if (c === '*' || c === '_' || c === '~') return 'mark';
      return c === '[' && named[k] ? 'link' : null;
    };
    // An address runs over what it holds and ends at anything else the line
    // reads: it holds marks, as GFM's addresses do (its end leaves trailing
    // ones out), and brackets, a [ that opens a link among them, as GFM's do.
    const endsAddress = k => {
      const kind = syntaxAt(k);
      return kind === 'escape' || kind === 'code';
    };
    for (let i = from; i < to;) {
      tick(meter);
      const c = text[i], kind = syntaxAt(i);
      if (kind === 'escape') { record({ start: i, end: i + 2, kind: 'escape' }); i += 2; continue; }
      if (kind === 'code') {
        let len = 1;
        while (i + len < to && text[i + len] === '`') len++;
        // A run that no run of its length closes is words.
        const close = closing(i + len, len, to);
        if (close >= 0) { record({ start: i, end: close + len, kind: 'code', inner: [i + len, close] }); i = close + len; } else i += len;
        continue;
      }
      if (kind === 'mark') {
        let len = 1;
        while (i + len < to && text[i + len] === c) len++;
        if (c !== '~' || len === 2) {
          const before = charBefore(text, i), after = charAt(text, i + len);
          const left = !isSpace(after) && (!isPunctuation(after) || isSpace(before) || isPunctuation(before));
          const right = !isSpace(before) && (!isPunctuation(before) || isSpace(after) || isPunctuation(after));
          const canOpen = c === '_' ? left && (!right || isPunctuation(before)) : left;
          const canClose = c === '_' ? right && (!left || isPunctuation(after)) : right;
          if (canOpen || canClose) marks.push({ char: c, pos: i, len, count: len, from: i, canOpen, canClose });
        }
        i += len;
        continue;
      }
      if (kind === 'link') {
        // Its words are read as words of their own, with no link in them.
        const { words, end, link } = named[i];
        read(i + 1, words, false);
        record({ start: i, end, kind: 'link', link, inner: [i + 1, words] });
        i = end;
        continue;
      }
      if (links) {
        while (address < addresses.length && addresses[address] < i) address++;
        if (addresses[address] === i && i >= noAddressBefore) {
          const found = addressAt(text, i, { ends: endsAddress, partial, last, meter });
          if (found) noAddressBefore = found.run;
          if (found?.link) { record({ start: i, end: found.link.end, kind: 'link', link: found.link }); i = found.link.end; continue; }
        }
        while (topic < topics.length && topics[topic] < i) topic++;
        const id = topics[topic] === i ? topicAt(text, i) : null;
        if (id) { record({ start: i, end: id.end, kind: 'link', link: id }); i = id.end; continue; }
      }
      i++;
    }
    pairMarks(marks);
  };
  read(0, n, true);

  const element = (tag, className, start, end) => { const node = doc.createElement(tag); if (className) node.className = className; return placed(node, { start: m.at(start), end: m.at(end) }); };
  const textNode = words => placed(doc.createTextNode(words.text), { words });
  const unplaced = node => { SOURCE.delete(node); for (const child of node.childNodes ?? []) unplaced(child); return node; };
  // Code's words as CommonMark gives them: line ends as spaces, and one space
  // off each end when both have one and it is not all spaces.
  const codeWords = ([a, b]) => {
    const words = text.slice(a, b).replace(/\n/g, ' ');
    if (words.length >= 2 && words[0] === ' ' && words.at(-1) === ' ' && /[^ ]/.test(words)) { a++; b--; }
    const kept = m.slice(a, b);
    return new Mapped(kept.text.replace(/\n/g, ' '), kept.runs, kept.left);
  };
  // What from..to holds at its top, in order, each with its node.
  const held = (from, to) => {
    const items = [];
    for (let i = from; i < to;) {
      tick(meter);
      const span = spans[i];
      if (span && span.end <= to) { items.push({ start: i, end: span.end, node: nodeOf(span) }); i = span.end; } else i++;
    }
    return items;
  };
  // The nodes for from..to, given what it holds at its top.
  const draw = (items, from, to) => {
    const nodes = [];
    let at = from;
    for (const { start, end, node } of items) { if (start > at) nodes.push(textNode(m.slice(at, start))); nodes.push(node); at = end; }
    if (to > at) nodes.push(textNode(m.slice(at, to)));
    return nodes;
  };
  const words = ([a, b]) => draw(held(a, b), a, b);
  const TAGS = { em: 'em', strong: 'strong', s: 's' };
  function nodeOf({ start, end, kind, inner, link }) {
    if (kind === 'escape') return placed(doc.createTextNode(text[start + 1]), { words: new Mapped(text[start + 1], [[0, m.pos(start + 1)]], m.at(start)) });
    if (kind === 'code') { const node = element('code', 'md-code', start, end); node.append(textNode(codeWords(inner))); return node; }
    if (kind in TAGS) { const node = element(TAGS[kind], '', start, end); for (const child of words(inner)) node.append(child); return node; }
    // A bare address or id shows its own words.
    if (!inner) return linkNode(doc, text.slice(start, end), link, node => placed(node, node.nodeType === 3 ? { words: m.slice(start, end) } : { start: m.at(start), end: m.at(end), link: true }));
    // A [named](link) shows other words than the message's, so it is quoted
    // whole (atomic), and what is drawn inside it maps to it.
    const a = linkNode(doc, text.slice(...inner), link, node => placed(node, { start: m.at(start), end: m.at(end), link: true, atomic: true }));
    a.textContent = '';
    for (const child of words(inner)) a.append(unplaced(child));
    return a;
  }
  return { items: held(0, n), draw };
}

export function inlineNodes(input, options = {}) {
  const m = input instanceof Mapped ? input : Mapped.of(String(input ?? ''));
  const line = readLine(m, options);
  return line.draw(line.items, 0, m.text.length);
}

// ---- Nodes

function el(doc, tag, className, children = [], span = null) {
  const node = doc.createElement(tag);
  if (className) node.className = className;
  for (const child of children) node.append(child);
  return span ? placed(node, span) : node;
}

// A box that scrolls sideways fades at each edge with more beyond it, so a
// phone, which hides scrollbars, shows that a table goes on. It is repainted
// when the box scrolls and when it or what it holds changes size.
let sizes = null;
function paintEdges(box) {
  const more = box.scrollWidth - box.clientWidth;
  box.classList.toggle('md-more-left', more > 1 && box.scrollLeft > 1);
  box.classList.toggle('md-more-right', more > 1 && box.scrollLeft < more - 1);
}
function edgeFades(box, held) {
  box.addEventListener('scroll', () => paintEdges(box), { passive: true });
  if (typeof globalThis.ResizeObserver !== 'function') return;
  sizes ??= new globalThis.ResizeObserver(entries => {
    for (const { target } of entries) {
      if (!target.isConnected) { sizes.unobserve(target); continue; }
      paintEdges(target.classList.contains('md-scrolls') ? target : target.parentNode);
    }
  });
  box.classList.add('md-scrolls');
  sizes.observe(box);
  if (held) sizes.observe(held);
}

const MARKS = { open: '☐', done: '☑' };

// One block as nodes. Inside a card (a button), every block is a span shown
// as a block, but for a table, which needs its own elements. cut: the block
// ends an excerpt, so its last words may be cut.
function blockNode(block, doc, cut, meter, copyFences = false) {
  const inline = (words, last = cut) => inlineNodes(words, { doc, partial: last, meter });
  const span = { start: block.start, end: block.end };
  if (block.kind === 'heading') return el(doc, 'span', `md-block md-heading md-h${Math.min(block.level, 4)}`, inline(block.words), span);
  if (block.kind === 'rule') return el(doc, 'span', 'md-block md-rule', [], span);
  if (block.kind === 'code') {
    const code = el(doc, 'span', block.box ? 'md-block md-pre md-box' : 'md-block md-pre', [], span);
    if (block.lang) code.dataset.lang = block.lang;
    if (block.words.text) code.append(placed(doc.createTextNode(block.words.text), { words: block.words }));
    if (block.box) edgeFades(code);
    if (!copyFences || !block.fenced) return code;
    const wrap = el(doc, 'span', 'md-block md-fence', [code], span);
    if (block.complete) {
      const control = fenceCopyButton(doc, block.words.text);
      if (copyFences === 'feed' && wrap.style?.setProperty) pairFeedFence(wrap, control);
      else wrap.append(placed(control, { start: span.end, end: span.end }));
    }
    else {
      const cue = el(doc, 'span', 'fence-copy-unavailable');
      cue.setAttribute('role', 'note');
      cue.setAttribute('aria-label', 'Open message to copy');
      wrap.append(placed(cue, { start: span.end, end: span.end }));
    }
    return wrap;
  }
  if (block.kind === 'quote') {
    const inner = block.blocks ? block.blocks.map((b, k) => blockNode(b, doc, cut && k === block.blocks.length - 1, meter, copyFences)) : inline(block.words);
    return el(doc, 'span', 'md-block md-quote', inner, span);
  }
  if (block.kind === 'list') {
    return el(doc, 'span', 'md-block md-list', block.items.map((item, n) => {
      const glyph = item.task ? MARKS[item.task] : /\d/.test(item.marker) ? item.marker : '•';
      const marker = el(doc, 'span', 'md-marker', [placed(doc.createTextNode(glyph), { start: item.start, end: item.words.left })], { start: item.start, end: item.words.left });
      const words = el(doc, 'span', 'md-item-words', inline(item.words, cut && n === block.items.length - 1), { start: item.words.left, end: item.words.end() });
      const row = el(doc, 'span', `md-item${item.task ? ' md-task' : ''}${item.task === 'done' ? ' md-done' : ''}`, [marker, words], { start: item.start, end: item.end });
      row.style.setProperty('--md-depth', String(Math.min(item.depth, 6)));
      return row;
    }), span);
  }
  if (block.kind === 'table') return tableNode(block, doc, meter);
  return el(doc, 'span', 'md-block md-p', inline(block.words), span);
}

// A table scrolls inside its own box, so a wide one never widens the card or the page.
// A row draws the cells it was written with, and a row with fewer than the
// widest one cell more, empty, across the rest: what a table draws grows with
// what was written, never with its rows times its columns.
function tableNode(block, doc, meter) {
  const width = block.rows.reduce((most, row) => Math.max(most, row.cells.length), block.head.cells.length);
  const cell = (tag, line, n) => {
    const words = line.cells[n];
    // Each cell's words keep their width up to a measure, so a wide table scrolls rather than crushing to a word a line.
    const cellSpan = words ? { start: words.left, end: words.end() } : { start: line.end, end: line.end };
    const node = el(doc, tag, '', [el(doc, 'span', 'md-cell', words ? inlineNodes(words, { doc, meter }) : [], cellSpan)], cellSpan);
    if (block.aligns[n]) node.style.textAlign = block.aligns[n];
    return node;
  };
  const tr = (tag, line) => {
    const cells = line.cells.map((_, n) => cell(tag, line, n)), written = cells.length;
    if (written < width) { const rest = cell(tag, line, written); rest.colSpan = width - written; cells.push(rest); }
    tick(meter, cells.length);
    return el(doc, 'tr', '', cells, { start: line.start, end: line.end });
  };
  const head = el(doc, 'thead', '', [tr('th', block.head)], { start: block.head.start, end: block.head.end });
  const body = el(doc, 'tbody', '', block.rows.map(line => tr('td', line)), block.rows.length ? { start: block.rows[0].start, end: block.rows.at(-1).end } : null);
  const table = el(doc, 'table', 'md-table', [head, body], { start: block.start, end: block.end });
  const wrap = el(doc, 'span', 'md-block md-table-wrap', [table], { start: block.start, end: block.end });
  edgeFades(wrap, table);
  return wrap;
}

// text as nodes for a card or any other place that shows a message's words.
export function formatNodes(text, { doc = globalThis.document, partial = false, meter, copyFences = false } = {}) {
  const blocks = parseBlocks(text, { partial, meter });
  if (!blocks.length) return wordNodes(String(text ?? ''), { doc, partial });
  return blocks.map((block, n) => blockNode(block, doc, partial && n === blocks.length - 1, meter, copyFences));
}

// A Notebook revision opened in place shows its source verbatim, with links.
// Replace only fence lines, and, given images ({of, node}, as for drawPassages), each image line, by
// images.node(image), the line break after it with it. Raw gaps keep even quote prefixes and CRLFs.
export function linkedFenceNodes(text, doc, images = null) {
  const nodes = [];
  let at = 0;
  const emit = blocks => {
    for (const block of blocks) {
      if (block.fenced) {
        // A quoted block may start after its opening line's quote prefix.
        const start = text.lastIndexOf('\n', block.start - 1) + 1;
        if (at < start) nodes.push(...wordNodes(text.slice(at, start), { doc }));
        nodes.push(blockNode(block, doc, false, undefined, true));
        at = block.end;
      } else if (block.kind === 'image') {
        if (at < block.start) nodes.push(...wordNodes(text.slice(at, block.start), { doc }));
        nodes.push(el(doc, 'span', 'md-image', [images.node(block.image, doc)], { start: block.start, end: block.end }));
        at = block.end + (text[block.end] === '\n' ? 1 : 0);
      } else if (block.blocks) emit(block.blocks);
    }
  };
  emit(parseBlocks(text, { images }));
  if (at < text.length || !nodes.length) nodes.push(...wordNodes(text.slice(at), { doc }));
  return nodes;
}

// Puts text, formatted, in host in place of what host held. struck: words the
// reader had read that the text no longer holds, struck through where they stood (strike).
export function formatWords(host, text, options = {}) {
  if (deferFencePaint(host, () => formatWords(host, text, options))) return host;
  host.replaceChildren();
  for (const node of formatNodes(text, { doc: host.ownerDocument ?? globalThis.document, ...options })) host.append(node);
  strike(host, options.struck);
  host.classList.add('formatted');
  DRAWN.set(host, String(text ?? ''));
  if (options.revision === undefined) REVISIONS.delete(host); else REVISIONS.set(host, options.revision);
  return host;
}

// The text a host's words were drawn from (formatWords, drawPassages), which
// the positions its nodes know are positions in; undefined for a host neither drew.
const DRAWN = new WeakMap();
export const drawnText = host => DRAWN.get(host);
// The revision of a message those words are (formatWords' revision), when the
// one who drew them said: a quote of them names it (docs/message-edit.md).
const REVISIONS = new WeakMap();
export const drawnRevision = host => REVISIONS.get(host);

// The Reader's source as passages (reader.mjs): every child of host is one
// passage with the span of the text it shows (data-start, data-end), and the
// passages cover the whole text, so what lights is what Return quotes, from
// the message's own words. A paragraph's passages are its sentences, as
// before; a heading, a list item, a quote, a code block and a table are each
// one passage, shown as a block. A passage never cuts a link, code or a
// mark: the sentences one spans join, as the line's own reading says. images, for a Notebook page: images.of(line)
// names the image a line puts there, and that line is a passage of its own holding images.node(image, doc).
export function drawPassages(host, body, doc = globalThis.document, { meter, copyFences = false, images = null, struck = null } = {}) {
  if (deferFencePaint(host, () => drawPassages(host, body, doc, { meter, copyFences, images, struck }))) return;
  body = String(body ?? '');
  host.replaceChildren();
  const blocks = blocksOf(Mapped.of(body), false, 0, meter, images), drawn = [];
  blocks.forEach((block, n) => {
    const next = blocks[n + 1];
    if (block.kind === 'paragraph') {
      const words = block.words, text = words.text;
      const segments = typeof Intl.Segmenter === 'function'
        ? new Intl.Segmenter(undefined, { granularity: 'sentence' }).segment(text)
        : [...text.matchAll(/[^\n]+(?:\n+|$)|\n+/g)].map(match => ({ segment: match[0], index: match.index }));
      // A sentence end inside a link, code or a mark joins the sentences around it.
      const line = readLine(words, { doc, meter }), items = line.items, parts = [];
      let item = 0;
      for (const { segment, index } of segments) {
        tick(meter, segment.length);
        while (item < items.length && items[item].end <= index) item++;
        const last = parts.at(-1);
        if (last && item < items.length && items[item].start < index) last.segment += segment;
        else parts.push({ segment, index });
      }
      item = 0;
      parts.forEach((part, k) => {
        const final = k === parts.length - 1, from = part.index, to = from + (final ? part.segment.trimEnd() : part.segment).length;
        const held = [];
        while (item < items.length && items[item].end <= to) held.push(items[item++]);
        const span = doc.createElement('span');
        for (const node of line.draw(held, from, to)) span.append(node);
        // The paragraph's last sentence keeps a blank line before a following paragraph.
        const tail = final ? (next?.kind === 'paragraph' ? '\n\n' : next ? '\n' : '') : '';
        drawn.push({ node: span, start: words.at(from), tail: tail ? doc.createTextNode(tail) : null, from: words.at(to) });
      });
      return;
    }
    if (block.kind === 'image') {
      drawn.push({ node: el(doc, 'span', 'md-block md-image', [images.node(block.image, doc)], { start: block.start, end: block.end }), start: block.start });
      return;
    }
    if (block.kind === 'list') {
      block.items.forEach((item, k) => {
        const node = blockNode({ kind: 'list', items: [item], start: item.start, end: item.end }, doc, false, meter);
        node.classList.add('md-list-passage');
        if (k < block.items.length - 1) node.classList.add('md-list-more');
        drawn.push({ node, start: item.start });
      });
      return;
    }
    drawn.push({ node: blockNode(block, doc, false, meter, copyFences), start: block.start });
  });
  drawn.forEach(({ node, start, tail, from }, k) => {
    const end = k + 1 < drawn.length ? drawn[k + 1].start : body.length;
    node.dataset.start = String(k ? start : 0); node.dataset.end = String(end);
    // A sentence's span runs on to the next passage, over its line break.
    if (tail) node.append(placed(tail, { start: from, end }));
    if (!SOURCE.has(node)) placed(node, { start, end });
    host.append(node);
  });
  strike(host, struck);
  DRAWN.set(host, body);
}

// Words a person had read that its agent author's edit took away (item 614,
// docs/message-edit.md), struck through where they stood among the words host
// drew: cuts [{at, words}], at a place in the drawn text (as Core counts it, in
// UTF-16 units, which a string's indices are). Each is a <del> whose words map to that
// one place, with a space either side where a word would touch it, so a
// selection or a quote over it takes none of its words and every position the
// drawn words know stays as it was. A place no drawn words reach (inside a
// link's marks, past the end) takes the first drawn words after it, else the end.
export function strike(host, cuts) {
  if (!Array.isArray(cuts) || !cuts.length) return host;
  const doc = host.ownerDocument;
  // From the last place back, so each split leaves the places before it where they were.
  for (const { at, words } of [...cuts].sort((a, b) => b.at - a.at)) {
    const texts = textsIn(host), i = texts.findIndex(node => SOURCE.get(node)?.words && SOURCE.get(node).words.end() >= at);
    const found = texts[i];
    // Where the struck words go: after anchor, before it, or at the end of host; and the words either side of them.
    let anchor = texts.at(-1) ?? null, side = anchor ? 'after' : 'append', before = anchor, after = null;
    if (found) {
      const mapped = SOURCE.get(found).words, length = mapped.text.length;
      let k = 0;
      while (k < length && mapped.at(k) < at) k++;
      if (k > 0 && k < length) {
        found.after(placed(doc.createTextNode(mapped.text.slice(k)), { words: mapped.slice(k) }));
        found.data = mapped.text.slice(0, k);
        SOURCE.set(found, { words: mapped.slice(0, k) });
      }
      if (k > 0) { anchor = found; side = 'after'; before = found; after = k < length ? found.nextSibling : texts[i + 1] ?? null; }
      else { anchor = found; side = 'before'; before = texts[i - 1] ?? null; after = found; }
    }
    const del = doc.createElement('del');
    del.className = 'struck-words';
    del.title = 'Words you read before the author changed them';
    del.append(placed(doc.createTextNode(words), { start: at, end: at }));
    const gap = () => placed(doc.createTextNode(' '), { start: at, end: at });
    const touches = (node, last) => { const text = node?.data ?? ''; return Boolean(text) && !/\s/.test(last ? text.at(-1) : text[0]); };
    const nodes = [...(touches(before, true) ? [gap()] : []), del, ...(touches(after, false) ? [gap()] : [])];
    if (side === 'after') anchor.after(...nodes);
    else if (side === 'before') anchor.before(...nodes);
    else host.append(...nodes);
  }
  return host;
}

// The passages of a text, as the Reader draws them (drawPassages): each
// {start, end}, in order, covering the whole text. A card shows a message's
// words as blocks, not passages, so what lights on it is read from here.
// Drawn once into a node no page holds, and kept for the few texts read last.
const SPANS = new Map();
export function passageSpans(text, doc = globalThis.document) {
  text = String(text ?? '');
  let spans = SPANS.get(text);
  if (!spans) {
    const host = doc.createElement('div');
    drawPassages(host, text, doc);
    spans = [...host.childNodes].map(part => ({ start: Number(part.dataset.start), end: Number(part.dataset.end) }));
    if (SPANS.size >= 32) SPANS.delete(SPANS.keys().next().value);
  }
  SPANS.delete(text); SPANS.set(text, spans);
  return spans;
}

// The drawn words that show the characters from to `to` of the text a host
// drew, as a Range: from the first drawn character at or after from, to the
// end of the last before to; null when none of them is drawn. sourcePosition
// read backwards, so a range made here selects back to the same characters.
export function rangeOf(host, from, to) {
  const doc = host.ownerDocument, walker = doc.createTreeWalker(host, 4);
  let start = null, end = null;
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const a = sourcePosition(node, 0), b = sourcePosition(node, node.data.length, true);
    if (a === null || b === null || b <= a) continue;
    if (!start && b > from) start = [node, offsetAt(node, from, false)];
    if (a < to) end = [node, offsetAt(node, to, true)];
  }
  if (!start || !end) return null;
  const range = doc.createRange();
  range.setStart(...start); range.setEnd(...end);
  return range.collapsed ? null : range;
}
// In a text node: the first offset at or after the character at (a start),
// or the last offset whose boundary is at or before it (an end).
function offsetAt(node, at, end) {
  let lo = 0, hi = node.data.length;
  if (!end) {
    while (lo < hi) { const mid = (lo + hi) >> 1; if (sourcePosition(node, mid) >= at) hi = mid; else lo = mid + 1; }
    return lo;
  }
  while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (sourcePosition(node, mid, true) <= at) lo = mid; else hi = mid - 1; }
  return lo;
}

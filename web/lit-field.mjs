// The dark field behind a lit passage (docs/reading-colors.md): as tall, line
// by line, on a topic's or a dossier's card as in the Reader.
//
// The Reader paints a passage with an inline background, which covers its
// words' own height (the glyph box), and extends it over and under each line by
// overhang, so the field covers the line as a selection does. A card's words
// light through a CSS highlight, which can paint only the glyph box, so a card
// paints the rest of the field behind its words itself (FeedPassages).

// How far the Reader's field reaches over and under a line's words: half the
// line's height beyond its words', to a whole pixel, since a selection paints
// every pixel its line box touches, at whatever fraction of a pixel the line
// starts.
export const overhang = (glyph, line) => Math.ceil(Math.max(0, line - glyph) / 2);

// The Reader's field for a line of its plain words, as tall as it paints it at
// this width: its words' height with overhang over and under them. Read from a
// hidden copy of the Reader's text box (aim.css, .passage-probe), so a card
// knows it before the Reader first opens, at the size the Reader's words take
// on a phone as on a laptop. null where nothing can be measured.
export function readerField(doc) {
  let probe = doc.body.querySelector(':scope > .passage-probe');
  if (!probe) {
    probe = doc.createElement('div');
    probe.className = 'reading-pane passage-probe';
    probe.setAttribute('aria-hidden', 'true');
    const article = doc.createElement('article'), words = doc.createElement('span');
    words.textContent = 'x';
    article.append(words); probe.append(article);
    doc.body.append(probe);
  }
  const article = probe.firstElementChild, glyph = article.firstElementChild.getClientRects()[0]?.height;
  const line = parseFloat(doc.defaultView.getComputedStyle(article).lineHeight);
  return glyph > 0 && Number.isFinite(line) ? glyph + 2 * overhang(glyph, line) : null;
}

// The box a text node's words show in, below stop (the card, which holds
// them): the nearest element holding them that clips what overflows it (a code
// block or a table that scrolls sideways, an excerpt cut off at a height), else
// stop. A field painted on that box's background is clipped where its words
// are and scrolls with them (background-attachment: local), as the Reader's
// inline field is clipped and scrolled with the words it lies behind.
export function clipBox(node, stop) {
  if (!stop.contains(node) || node === stop) throw Error('clipBox: the words are not inside the box they are painted on');
  const win = stop.ownerDocument.defaultView;
  for (let box = node.parentElement; box !== stop; box = box.parentElement) {
    const style = win.getComputedStyle(box);
    if (style.overflowX !== 'visible' || style.overflowY !== 'visible') return box;
  }
  return stop;
}

// The block a text node's words flow in: the nearest element holding them that
// is not laid out inline (a paragraph, a list item, a table's cell, a code
// block). Its words on one line run on from each other, as the Reader's field
// runs on behind them; a table's cells side by side are blocks apart, with no
// words between them.
const blockOf = node => {
  const win = node.ownerDocument.defaultView;
  let block = node.parentElement;
  while (['inline', 'contents'].includes(win.getComputedStyle(block).display)) block = block.parentElement;
  return block;
};

// The lines a range's words are drawn on, each the box of its characters (left,
// right, top and bottom on screen), the boxes on one line of one block joined,
// and the box they show in (clipBox, below stop): what a field is painted
// behind, and on. Elements a range holds whole give boxes of their own (a
// paragraph's spans every line it has), so only characters are read.
export function wordLines(range, stop) {
  const doc = range.startContainer.ownerDocument, common = range.commonAncestorContainer;
  const walk = doc.createTreeWalker(common.nodeType === 1 ? common : common.parentNode, 4), boxes = [];
  for (let node = walk.nextNode(); node; node = walk.nextNode()) {
    if (!range.intersectsNode(node) || !node.data.trim()) continue;
    const part = doc.createRange(), box = clipBox(node, stop), block = blockOf(node);
    part.selectNodeContents(node);
    if (node === range.startContainer) part.setStart(node, range.startOffset);
    if (node === range.endContainer) part.setEnd(node, range.endOffset);
    for (const rect of part.getClientRects()) if (rect.width > 0 && rect.height > 0) boxes.push({ left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom, box, block });
  }
  boxes.sort((a, b) => a.top - b.top);
  const lines = [];
  for (const rect of boxes) {
    const line = lines.find(other => other.block === rect.block && Math.min(other.bottom, rect.bottom) - Math.max(other.top, rect.top) > (rect.bottom - rect.top) / 2);
    if (line) Object.assign(line, { left: Math.min(line.left, rect.left), right: Math.max(line.right, rect.right), top: Math.min(line.top, rect.top), bottom: Math.max(line.bottom, rect.bottom) });
    else lines.push(rect);
  }
  return lines;
}

// The field's layers on host (an element holding the words, scrolled with them
// or not): one per line, the Reader's height (height) centred on the line's
// words, and never shorter than they are, its top on a whole pixel of the
// screen as the Reader's is. Positions are in host's background area,
// scrolled with its content (background-attachment: local).
export function fieldLayers(host, lines, height) {
  const box = host.getBoundingClientRect();
  const left = box.left + host.clientLeft - host.scrollLeft, top = box.top + host.clientTop - host.scrollTop;
  return lines.map(line => {
    const words = line.bottom - line.top, tall = Math.max(height, words);
    const at = Math.round(line.top - (tall - words) / 2);
    return { x: line.left - left, y: at - top, width: line.right - line.left, height: Math.round(tall) };
  });
}

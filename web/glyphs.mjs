// The small drawn glyphs a dossier's title bar and a message's bar show in
// place of words (docs/reply-stacks.md, "The title bar and the message bar"):
// each a line drawing in the text's own colour, silent to a screen reader,
// which hears the button's name instead. Drawn, not typed, so every engine
// shows the same shape and none turns one into a coloured emoji.
const PATHS = {
  // Reply: an arrow turning back to the left.
  reply: 'M9.5 7 4.5 12l5 5 M5 12h9.5a5 5 0 0 1 5 5v1',
  // Move below More: a tray with an arrow going down into it.
  aside: 'M4 14v4.5h16V14 M12 4v10 M8 10l4 4 4-4',
  // Bring back above More: the same tray, the arrow coming up out of it.
  back: 'M4 14v4.5h16V14 M12 14V4 M8 8l4-4 4 4',
  // Show full message: two arrows pointing out, up and down.
  full: 'M12 3v18 M8 7l4-4 4 4 M8 17l4 4 4-4',
  // Fold: two arrows pointing in to a line.
  fold: 'M12 2.5v7 M8.5 6.5l3.5 3.5 3.5-3.5 M5 12h14 M12 21.5v-7 M8.5 17.5l3.5-3.5 3.5 3.5',
  // Unfold: the line opening, arrows pointing out.
  unfold: 'M12 10V3 M8.5 6l3.5-3.5L15.5 6 M5 12h14 M12 14v7 M8.5 18l3.5 3.5 3.5-3.5',
};

// The glyph called name, as an svg element of doc.
export function glyph(name, doc = globalThis.document) {
  if (!Object.hasOwn(PATHS, name)) throw Error(`No glyph called ${name}.`);
  const ns = 'http://www.w3.org/2000/svg', svg = doc.createElementNS(ns, 'svg'), path = doc.createElementNS(ns, 'path');
  for (const [key, value] of Object.entries({ viewBox: '0 0 24 24', width: '18', height: '18', 'aria-hidden': 'true', focusable: 'false', class: 'glyph' })) svg.setAttribute(key, value);
  for (const [key, value] of Object.entries({ d: PATHS[name], fill: 'none', stroke: 'currentColor', 'stroke-width': '1.8', 'stroke-linecap': 'round', 'stroke-linejoin': 'round' })) path.setAttribute(key, value);
  svg.append(path);
  svg.dataset.glyph = name;
  return svg;
}

// Puts glyph name in button, unless it already shows it.
export function showGlyph(button, name, doc = button.ownerDocument) {
  if (button.firstElementChild?.dataset?.glyph === name && button.childNodes.length === 1) return;
  button.replaceChildren(glyph(name, doc));
}

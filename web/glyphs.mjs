// The small glyphs a menu's items show beside their words (items 602 and 601,
// docs/links.md, "A message's menu"): each a line drawing in the text's own
// colour, silent to a screen reader, which hears the item's words instead.
// Drawn, not typed, so every engine shows the same shape and none turns one
// into a coloured emoji.
//
// One meaning keeps one glyph wherever it shows. A glyph a control on the
// page already draws is that control's own drawing (BORROWED), never a copy
// of it: Edit, Rename and Edit page take the pencil of the topic's New
// message, and Move below More the tray of the Reader's archive button. The
// rest are drawn here once, on the 24-unit grid the pencil is drawn on.
//
// A dossier's title bar and a message's bar (item 473, docs/reply-stacks.md,
// "The title bar and the message bar") show glyphs in place of words, the
// button's name its tooltip: Reply, Show full message, Fold, Unfold and Bring
// back above More take the drawings below, and Move below More the one of
// BAR, which no menu item shows. On a phone the title bar's ⋯ offers its
// Reply and Move below More as items, and they take a menu's glyphs: Reply the
// title bar's own Reply, Move below More the Reader's tray.
const DRAWN = {
  // Ask for a new cover; the same drawing turns while Core awaits it.
  refresh: { d: 'M20 10a8 8 0 1 0-1.8 7 M20 4v6h-6' },
  // Reply, and Reply to the first message: an arrow turning back to the left.
  reply: { d: 'M9.5 7 4.5 12l5 5 M5 12h9.5a5 5 0 0 1 5 5v1' },
  // Bring back above More: a tray, an arrow coming up out of it.
  back: { d: 'M4 14v4.5h16V14 M12 14V4 M8 8l4-4 4 4' },
  // Show full message: two arrows pointing out, up and down.
  full: { d: 'M12 3v18 M8 7l4-4 4 4 M8 17l4 4 4-4' },
  // Fold: two arrows pointing in to a line.
  fold: { d: 'M12 2.5v7 M8.5 6.5l3.5 3.5 3.5-3.5 M5 12h14 M12 21.5v-7 M8.5 17.5l3.5-3.5 3.5 3.5' },
  // Unfold: the line opening, arrows pointing out.
  unfold: { d: 'M12 10V3 M8.5 6l3.5-3.5L15.5 6 M5 12h14 M12 14v7 M8.5 18l3.5 3.5 3.5-3.5' },
  // Star for me, the star beside a message's time; Unstar, the same star filled.
  star: { d: 'M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8-4.3-4.1 5.9-.9z' },
  starred: { d: 'M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8-4.3-4.1 5.9-.9z', fill: true },
  // Open its record: a box with an arrow out of it, as the Notebook sheet's Open as a full page.
  openpage: { d: 'M11.5 3.5h5v5M16.5 3.5l-6 6M8.5 4.5h-4v11h11v-4', vb: '0 0 20 20', sw: '1.7' },
  // Fold its stack and Open its stack: the dossier's chevron, closed and open.
  chevron: { d: 'M9 6l6 6-6 6' },
  chevdown: { d: 'M6 9l6 6 6-6' },
  // Show all messages: three full lines; Show latest and unread replies: two of them short.
  all: { d: 'M4 6h16 M4 12h16 M4 18h16' },
  latest: { d: 'M4 6h7 M4 12h7 M4 18h16' },
  // Copy Link: two links of a chain.
  link: { d: 'M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1 M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1' },
  // Mark unread: a dot; Mark read: a ring.
  unread: { d: 'M12 12m-4 0a4 4 0 1 0 8 0a4 4 0 1 0-8 0', fill: true },
  read: { d: 'M12 12m-4 0a4 4 0 1 0 8 0a4 4 0 1 0-8 0' },
  // Split back out: a branch turning out.
  split: { d: 'M6 4v6a4 4 0 0 0 4 4h8 M14 10l4 4-4 4 M6 20v-4' },
  // Move up and Move down: an arrow up to a line, an arrow down to one.
  up: { d: 'M5 4h14 M12 20V8 M7 13l5-5 5 5' },
  down: { d: 'M5 20h14 M12 4v12 M7 11l5 5 5-5' },
  // Join the stack above and below: two lines meeting, upward and downward.
  joinup: { d: 'M7 20v-5l5-5 5 5v5 M12 10V3 M9 6l3-3 3 3' },
  joindown: { d: 'M7 4v5l5 5 5-5V4 M12 14v7 M9 18l3 3 3-3' },
  // Let new replies move it: a pin, struck.
  unpin: { d: 'M9 4h6 M10 4v5l-3 4h10l-3-4V4 M12 13v7 M4 4l16 16' },
  // Undo: an arrow curving back.
  undo: { d: 'M9 14 4 9l5-5 M4 9h10.5a5.5 5.5 0 0 1 0 11H11' },
  // Move or join…: four arrows.
  move: { d: 'M12 3v18 M3 12h18 M9 6l3-3 3 3 M9 18l3 3 3-3 M6 9l-3 3 3 3 M18 9l3 3-3 3' },
  // Start a topic from this: a speech bubble with a plus.
  topic: { d: 'M4 5h16v11H9l-5 4z M12 8v5 M9.5 10.5h5' },
  // Add to pipeline: a list with a plus.
  pipeline: { d: 'M4 6h10 M4 11h10 M4 16h6 M17 13v7 M13.5 16.5h7' },
  // Wide layout and Stacked layout: two panes.
  layout: { d: 'M3.5 5h17v14h-17z M12 5v14' },
  // Move to a section, and Set aside to Later…: an arrow into a box.
  moveto: { d: 'M3 12h11 M10 8l4 4-4 4 M14 4h6v16h-6' },
  // Drop…: a circle with a cross.
  drop: { d: 'M12 12m-8 0a8 8 0 1 0 16 0a8 8 0 1 0-16 0 M9 9l6 6 M15 9l-6 6' },
  // A dossier's cover (item 624, its approved design page): a payload proposed, a box; done, a tick; what waits on
  // the outcome's owner, a question in a circle.
  payload: { d: 'M4 8l8-4 8 4v8l-8 4-8-4z M4 8l8 4 8-4 M12 12v8' },
  kept: { d: 'M5 12.5l4.5 4.5L19 7.5' },
  waits: { d: 'M12 12m-8 0a8 8 0 1 0 16 0a8 8 0 1 0-16 0 M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .8-1 1.5 M12 16.5v.01' },
};
// The bars' own glyphs (item 473), drawn as DRAWN's are, outside GLYPH_NAMES, which names a menu's.
const BAR = {
  // Move below More: a tray with an arrow going down into it.
  aside: { d: 'M4 14v4.5h16V14 M12 4v10 M8 10l4 4 4-4' },
};
// Glyphs another control of the page draws (index.html), by that control's id: its own drawing, cloned.
const BORROWED = { pencil: 'new-message', archive: 'reader-aside' };
// Glyphs that are a character, as the Reader's Quote pill shows ❝. The character is drawn by the
// stylesheet from data-text (aim.css), so the item's words, its textContent, stay its words alone.
const TYPED = { quote: '❝' };

// The glyphs a menu's items show.
export const GLYPH_NAMES = Object.freeze([...Object.keys(DRAWN), ...Object.keys(BORROWED), ...Object.keys(TYPED)]);

// The glyph called name, as an element of doc, size pixels square. An unknown
// name, or a borrowed glyph whose control the page does not have, is refused.
export function glyph(name, doc = globalThis.document, size = 18) {
  const ns = 'http://www.w3.org/2000/svg';
  let node;
  if (Object.hasOwn(DRAWN, name) || Object.hasOwn(BAR, name)) {
    const { d, vb = '0 0 24 24', sw = '1.8', fill = false } = Object.hasOwn(DRAWN, name) ? DRAWN[name] : BAR[name];
    node = doc.createElementNS(ns, 'svg');
    node.setAttribute('viewBox', vb);
    const path = doc.createElementNS(ns, 'path');
    for (const [key, value] of Object.entries({ d, fill: fill ? 'currentColor' : 'none', stroke: 'currentColor', 'stroke-width': sw, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' })) path.setAttribute(key, value);
    node.append(path);
  } else if (Object.hasOwn(BORROWED, name)) {
    const drawing = doc.getElementById?.(BORROWED[name])?.querySelector('svg');
    if (!drawing) throw Error(`The page has no #${BORROWED[name]} to draw the ${name} glyph from.`);
    node = drawing.cloneNode(true);
  } else if (Object.hasOwn(TYPED, name)) {
    node = doc.createElement('span');
    node.setAttribute('data-text', TYPED[name]);
  } else throw Error(`No glyph called ${name}.`);
  if (!Object.hasOwn(TYPED, name)) for (const [key, value] of Object.entries({ width: String(size), height: String(size), focusable: 'false' })) node.setAttribute(key, value);
  for (const [key, value] of Object.entries({ 'aria-hidden': 'true', class: 'glyph', 'data-glyph': name })) node.setAttribute(key, value);
  return node;
}

// Puts glyph name in button, unless it already shows it (the bars, item 473).
export function showGlyph(button, name, doc = button.ownerDocument) {
  if (button.firstElementChild?.dataset?.glyph === name && button.childNodes.length === 1) return;
  button.replaceChildren(glyph(name, doc));
}

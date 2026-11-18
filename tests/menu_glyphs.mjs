// The glyph each menu item carries (items 602 and 601; docs/links.md, "A
// message's menu"), by the item's words: the design page's inventory, item by
// item, as it was approved. Written out here, not read from the page's code,
// so a glyph dropped from an item or two items' glyphs swapped fail the checks
// that read it, and so does each glyph's drawing (APPROVED, FROM): a drawing
// changed, a borrowed glyph cloned from another control, or a character that
// draws nothing. They are read by tests/ui_menu_glyphs.test.mjs below the
// browser, and in the browser by tests/stack_native.mjs (a message's ⋯, a
// dossier's menu, a right-click, the phone's sheets and a dossier's title bar ⋯ on a phone),
// tests/reader_compose_native.mjs (the Reader's ⋯), tests/pipeline_native.mjs
// (a pipeline item's ⋯) and tests/notebook_pages_native.mjs (the Reader's ⋯ on
// a Notebook page).
export const GLYPH_OF = Object.freeze({
  'Star for me': 'star', Unstar: 'starred', Rename: 'pencil', 'Show all messages': 'all', 'Show latest and unread replies': 'latest',
  Fold: 'fold', Unfold: 'unfold', 'Fold message': 'fold', 'Unfold message': 'unfold', 'Split back out': 'split',
  // A dossier's title bar ⋯ on a phone (item 473): Reply to the first message takes the title bar's own Reply.
  'Reply to the first message': 'reply',
  'Copy Link': 'link', 'Show full message': 'full', Edit: 'pencil', 'Edit page': 'pencil', 'Mark unread': 'unread', 'Mark read': 'read',
  // Item 601: an archive act shows the Reader's archive tray, in every menu.
  'Move below More': 'archive', 'Bring back above More': 'back',
  'Move its stack up': 'up', 'Move its stack down': 'down', 'Fold its stack': 'chevron', 'Open its stack': 'chevdown',
  'Join the stack above': 'joinup', 'Join the stack below': 'joindown', 'Let new replies move it': 'unpin', Undo: 'undo',
  'Move or join…': 'move', 'Quote selection': 'quote', 'Start a topic from this': 'topic', 'Add to pipeline': 'pipeline',
  'Wide layout': 'layout', 'Stacked layout': 'layout',
  'Move up': 'up', 'Move down': 'down', 'Open its record': 'openpage', 'Drop…': 'drop',
});
// Items whose words carry a number or a section's name.
const NAMED = [[/^Copy Link to Revision \d+$/, 'link'], [/^Move to \S.*$/, 'moveto'], [/^Set aside to \S.*…$/, 'moveto']];

// The glyph the item with these words carries, or null for words no menu offers.
export const glyphOf = label => (Object.hasOwn(GLYPH_OF, label) ? GLYPH_OF[label] : NAMED.find(([words]) => words.test(label))?.[1] ?? null);

// Each glyph as the approved design page draws it (item 602's design pass), by name: a line drawing on a 24-unit
// grid (vb, its viewBox, where it differs), stroked in the text's colour, sw wide, filled where fill; or a character,
// text. Written out here, not read from web/glyphs.mjs, so a drawing blanked, swapped with another or redrawn there
// fails the checks that read it (misdrawn below).
export const APPROVED = Object.freeze({
  // Item 738's approved cover refresh drawing, frozen independently of its implementation.
  refresh: { d: 'M20 10a8 8 0 1 0-1.8 7 M20 4v6h-6' },
  archive: { vb: '0 0 20 20', sw: '1.6', d: 'M2.5 3.5h15V7h-15zM3.75 7v9.5h12.5V7M8 10.5h4' },
  reply: { d: 'M9.5 7 4.5 12l5 5 M5 12h9.5a5 5 0 0 1 5 5v1' },
  back: { d: 'M4 14v4.5h16V14 M12 14V4 M8 8l4-4 4 4' },
  full: { d: 'M12 3v18 M8 7l4-4 4 4 M8 17l4 4 4-4' },
  fold: { d: 'M12 2.5v7 M8.5 6.5l3.5 3.5 3.5-3.5 M5 12h14 M12 21.5v-7 M8.5 17.5l3.5-3.5 3.5 3.5' },
  unfold: { d: 'M12 10V3 M8.5 6l3.5-3.5L15.5 6 M5 12h14 M12 14v7 M8.5 18l3.5 3.5 3.5-3.5' },
  star: { d: 'M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8-4.3-4.1 5.9-.9z' },
  starred: { d: 'M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8-4.3-4.1 5.9-.9z', fill: true },
  pencil: { d: 'M4 20h4L19 9a2.1 2.1 0 0 0-4-4L4 16z M13.5 6.5l4 4' },
  quote: { text: '❝' },
  openpage: { vb: '0 0 20 20', sw: '1.7', d: 'M11.5 3.5h5v5M16.5 3.5l-6 6M8.5 4.5h-4v11h11v-4' },
  chevron: { d: 'M9 6l6 6-6 6' },
  chevdown: { d: 'M6 9l6 6 6-6' },
  all: { d: 'M4 6h16 M4 12h16 M4 18h16' },
  latest: { d: 'M4 6h7 M4 12h7 M4 18h16' },
  link: { d: 'M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1 M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1' },
  unread: { d: 'M12 12m-4 0a4 4 0 1 0 8 0a4 4 0 1 0-8 0', fill: true },
  read: { d: 'M12 12m-4 0a4 4 0 1 0 8 0a4 4 0 1 0-8 0' },
  split: { d: 'M6 4v6a4 4 0 0 0 4 4h8 M14 10l4 4-4 4 M6 20v-4' },
  up: { d: 'M5 4h14 M12 20V8 M7 13l5-5 5 5' },
  down: { d: 'M5 20h14 M12 4v12 M7 11l5 5 5-5' },
  joinup: { d: 'M7 20v-5l5-5 5 5v5 M12 10V3 M9 6l3-3 3 3' },
  joindown: { d: 'M7 4v5l5 5 5-5V4 M12 14v7 M9 18l3 3 3-3' },
  unpin: { d: 'M9 4h6 M10 4v5l-3 4h10l-3-4V4 M12 13v7 M4 4l16 16' },
  undo: { d: 'M9 14 4 9l5-5 M4 9h10.5a5.5 5.5 0 0 1 0 11H11' },
  move: { d: 'M12 3v18 M3 12h18 M9 6l3-3 3 3 M9 18l3 3 3-3 M6 9l-3 3 3 3 M18 9l3 3-3 3' },
  topic: { d: 'M4 5h16v11H9l-5 4z M12 8v5 M9.5 10.5h5' },
  pipeline: { d: 'M4 6h10 M4 11h10 M4 16h6 M17 13v7 M13.5 16.5h7' },
  layout: { d: 'M3.5 5h17v14h-17z M12 5v14' },
  moveto: { d: 'M3 12h11 M10 8l4 4-4 4 M14 4h6v16h-6' },
  drop: { d: 'M12 12m-8 0a8 8 0 1 0 16 0a8 8 0 1 0-16 0 M9 9l6 6 M15 9l-6 6' },
  // A dossier's cover's pills, as item 624's approved design page draws them.
  payload: { d: 'M4 8l8-4 8 4v8l-8 4-8-4z M4 8l8 4 8-4 M12 12v8' },
  kept: { d: 'M5 12.5l4.5 4.5L19 7.5' },
  waits: { d: 'M12 12m-8 0a8 8 0 1 0 16 0a8 8 0 1 0-16 0 M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .8-1 1.5 M12 16.5v.01' },
});
// The glyphs a control of the page already draws, by the control the design page names: a menu item's pencil is the
// topic's New message button's own drawing, and its tray the Reader's archive button's, whatever either draws.
export const FROM = Object.freeze({ pencil: '#new-message', archive: '#reader-aside' });

// A drawing as one line of text, the same in the page and below it: its viewBox, then each shape inside it by tag
// and attributes, the attributes by name and their spaces collapsed.
export function signature(box, shapes) {
  const tidy = value => String(value ?? '').trim().replace(/\s+/g, ' ');
  return tidy(box) + '|' + shapes.map(([tag, attributes]) => tag + '(' + attributes.map(([name, value]) => name + '=' + tidy(value))
    .sort().join(';') + ')').join('');
}
// The approved drawing of the glyph called name, as signature() writes it; a character as text:… .
export function approved(name) {
  if (!Object.hasOwn(APPROVED, name)) return null;
  const { vb = '0 0 24 24', sw = '1.8', d, fill = false, text } = APPROVED[name];
  if (text) return 'text:' + text;
  return signature(vb, [['path', [['d', d], ['fill', fill ? 'currentColor' : 'none'], ['stroke', 'currentColor'], ['stroke-width', sw],
    ['stroke-linecap', 'round'], ['stroke-linejoin', 'round']]]]);
}

// Every row of every open menu on the page, as an expression for a page's evaluate: the menu's name, the item's
// words (its text without its keys), its keys, the glyphs it carries by name, where its glyph and its words sit,
// what its glyph draws (drawing, as signature() writes it) and whether that leaves any ink (draws), and what each
// control in FROM draws on the page at that moment (sources). A character's drawing is what the stylesheet puts
// before it, as computed; it draws when that character has ink at the computed size, in a colour that shows.
export const ROWS = `(()=>{const signature=${signature.toString()};const FROM=${JSON.stringify(FROM)};
  const paints=c=>Boolean(c)&&c!=='none'&&c!=='transparent'&&!/^rgba\\([^)]*,\\s*0\\)$/.test(c);
  const drawing=g=>{if(!g)return null;
    if(g.localName==='svg')return signature(g.getAttribute('viewBox'),[...g.querySelectorAll('*')].map(s=>[s.localName,[...s.attributes].map(a=>[a.name,a.value])]));
    const before=getComputedStyle(g,'::before'),said=before.content.replace(/^attr\\(([\\w-]+)\\)$/,(_,name)=>JSON.stringify(g.getAttribute(name)??''));
    return 'text:'+(/^(["']).*\\1$/.test(said)?said.slice(1,-1):'')};
  const draws=g=>{if(!g)return false;
    if(g.localName==='svg')return [...g.querySelectorAll('*')].some(s=>{const c=getComputedStyle(s),r=s.getBoundingClientRect();
      return c.display!=='none'&&c.visibility!=='hidden'&&Number(c.opacity)>0&&(r.width>0||r.height>0)&&((paints(c.stroke)&&parseFloat(c.strokeWidth)>0)||paints(c.fill))});
    const before=getComputedStyle(g,'::before'),text=drawing(g).slice(5);
    if(!text||before.display==='none'||before.visibility==='hidden'||!paints(before.color)||!(parseFloat(before.fontSize)>=9))return false;
    const pen=document.createElement('canvas').getContext('2d');pen.font=[before.fontStyle,before.fontWeight,before.fontSize,before.fontFamily].join(' ');
    const m=pen.measureText(text);return m.width>0&&m.actualBoundingBoxAscent+m.actualBoundingBoxDescent>0};
  const sources=Object.fromEntries(Object.entries(FROM).map(([name,at])=>[name,drawing(document.querySelector(at+' svg'))]));
  return [...document.querySelectorAll('[role=menu] [role=menuitem]')].filter(b=>b.getClientRects().length).map(b=>{
  const glyphs=[...b.querySelectorAll('[data-glyph]')],keys=b.querySelector('.menu-keys, kbd');
  const words=[...b.childNodes].filter(n=>!(n.nodeType===1&&n.matches('.menu-keys, kbd, [data-glyph]')));
  const range=document.createRange();if(words.length){range.setStartBefore(words[0]);range.setEndAfter(words.at(-1))}
  const box=r=>r?{left:r.left,right:r.right,top:r.top,bottom:r.bottom,width:r.width,height:r.height}:null;
  const g=glyphs[0],seen=g&&g.getClientRects().length>0&&getComputedStyle(g).visibility!=='hidden'&&Number(getComputedStyle(g).opacity)>0;
  return {menu:b.closest('[role=menu]').getAttribute('aria-label'),label:words.map(n=>n.textContent).join(''),keys:keys?.textContent??null,text:b.textContent,
    glyphs:glyphs.map(e=>e.dataset.glyph),seen:Boolean(seen),hidden:g?g.getAttribute('aria-hidden'):null,
    glyph:box(g?.getBoundingClientRect()),words:words.length?box(range.getBoundingClientRect()):null,row:box(b.getBoundingClientRect()),
    colour:g?getComputedStyle(g,g.localName==='svg'?null:'::before').color:null,ink:getComputedStyle(b).color,
    drawing:drawing(g),draws:draws(g),sources}})})()`;

// Each row that does not carry exactly its glyph, as "words: has [..], wants name"; none when every row does.
export const misglyphed = rows => rows.filter(row => row.glyphs.length !== 1 || row.glyphs[0] !== glyphOf(row.label))
  .map(row => `${row.menu} / ${row.label}: has [${row.glyphs.join(', ')}], wants ${glyphOf(row.label)}`);

// Each row whose glyph does not draw what its meaning draws, as "words: what is wrong"; none when every row does. The
// glyph of the item's words (glyphOf) must draw the approved drawing, leave ink, and, where a control of the page
// draws it (FROM), be that control's own drawing as the page shows it then, and the control must still draw it. A
// name carried right with a drawing wrong is caught here, not by misglyphed.
export const misdrawn = rows => rows.flatMap(row => {
  const name = glyphOf(row.label), want = approved(name), wrong = [];
  if (!want) return [`${row.menu} / ${row.label}: no approved glyph for these words`];
  if (row.drawing !== want) wrong.push(`draws ${row.drawing}, not the approved ${name} ${want}`);
  if (!row.draws) wrong.push('leaves no ink');
  if (Object.hasOwn(FROM, name)) {
    const source = row.sources?.[name];
    if (row.drawing !== source) wrong.push(`is not the drawing of ${FROM[name]}, which draws ${source}`);
    if (source !== want) wrong.push(`${FROM[name]} no longer draws the approved ${name}: ${source}`);
  }
  return wrong.length ? [`${row.menu} / ${row.label}: ${wrong.join('; ')}`] : [];
});

// Each row whose glyph is not drawn as the design page draws it: shown, silent to a screen reader, 18px square, before
// the item's words with a 6 to 14px gap, its middle on the words' middle, inside its row, and in the row's own colour.
export const misplaced = rows => rows.flatMap(row => {
  const { glyph: g, words: w, row: r } = row, wrong = [];
  if (!g || !w) return [`${row.menu} / ${row.label}: no glyph or no words to measure`];
  if (!row.seen) wrong.push('not shown');
  if (row.hidden !== 'true') wrong.push('heard by a screen reader');
  if (Math.abs(g.width - 18) > 0.5 || Math.abs(g.height - 18) > 0.5) wrong.push(`${g.width}x${g.height}, not 18px square`);
  const gap = w.left - g.right;
  if (gap < 6 || gap > 14) wrong.push(`${gap.toFixed(1)}px before its words`);
  if (Math.abs((g.top + g.bottom) / 2 - (w.top + w.bottom) / 2) > 2) wrong.push(`its middle ${((g.top + g.bottom) / 2 - (w.top + w.bottom) / 2).toFixed(1)}px off its words'`);
  if (g.left < r.left || g.right > r.right || g.top < r.top - 0.5 || g.bottom > r.bottom + 0.5) wrong.push('outside its row');
  if (row.colour !== row.ink) wrong.push(`in ${row.colour}, not its row's ${row.ink}`);
  return wrong.length ? [`${row.menu} / ${row.label}: ${wrong.join('; ')}`] : [];
});

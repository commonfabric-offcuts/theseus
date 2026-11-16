// The glyph each menu item carries (items 602 and 601; docs/links.md, "A
// message's menu"), by the item's words: the design page's inventory, item by
// item, as it was approved. Written out here, not read from the page's code,
// so a glyph dropped from an item or two items' glyphs swapped fail the checks
// that read it: tests/ui_menu_glyphs.test.mjs below the browser, and in the
// browser tests/stack_native.mjs (a message's ⋯, a dossier's menu, a
// right-click, the phone's sheets and the Reader's ⋯), tests/pipeline_native.mjs
// (a pipeline item's ⋯) and tests/notebook_pages_native.mjs (the Reader's ⋯ on
// a Notebook page).
export const GLYPH_OF = Object.freeze({
  'Star for me': 'star', Unstar: 'starred', Rename: 'pencil', 'Show all messages': 'all', 'Show latest and unread replies': 'latest',
  Fold: 'fold', Unfold: 'unfold', 'Fold message': 'fold', 'Unfold message': 'unfold', 'Split back out': 'split',
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

// Every row of every open menu on the page, as an expression for a page's evaluate: the menu's name, the item's
// words (its text without its keys), its keys, the glyphs it carries by name, and where its glyph and its words sit.
export const ROWS = `[...document.querySelectorAll('[role=menu] [role=menuitem]')].filter(b=>b.getClientRects().length).map(b=>{
  const glyphs=[...b.querySelectorAll('[data-glyph]')],keys=b.querySelector('.menu-keys, kbd');
  const words=[...b.childNodes].filter(n=>!(n.nodeType===1&&n.matches('.menu-keys, kbd, [data-glyph]')));
  const range=document.createRange();if(words.length){range.setStartBefore(words[0]);range.setEndAfter(words.at(-1))}
  const box=r=>r?{left:r.left,right:r.right,top:r.top,bottom:r.bottom,width:r.width,height:r.height}:null;
  const g=glyphs[0],seen=g&&g.getClientRects().length>0&&getComputedStyle(g).visibility!=='hidden'&&Number(getComputedStyle(g).opacity)>0;
  return {menu:b.closest('[role=menu]').getAttribute('aria-label'),label:words.map(n=>n.textContent).join(''),keys:keys?.textContent??null,text:b.textContent,
    glyphs:glyphs.map(e=>e.dataset.glyph),seen:Boolean(seen),hidden:g?g.getAttribute('aria-hidden'):null,
    glyph:box(g?.getBoundingClientRect()),words:words.length?box(range.getBoundingClientRect()):null,row:box(b.getBoundingClientRect()),
    colour:g?getComputedStyle(g).color:null,ink:getComputedStyle(b).color}})`;

// Each row that does not carry exactly its glyph, as "words: has [..], wants name"; none when every row does.
export const misglyphed = rows => rows.filter(row => row.glyphs.length !== 1 || row.glyphs[0] !== glyphOf(row.label))
  .map(row => `${row.menu} / ${row.label}: has [${row.glyphs.join(', ')}], wants ${glyphOf(row.label)}`);

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

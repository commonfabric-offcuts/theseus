// Where a press note shows (web/press-note.mjs, item 635), from each branch of
// its placing: under what it is said beside, over it where the window has no
// room below, under it again where there is room on neither side, kept 16px in
// from the window's sides, and nowhere when what it is said beside is out of
// the window. The native cases (tests/stack_native.mjs, "reading stacks star")
// hold the same in Chrome and Safari's engine at each width; this holds the
// arithmetic of every branch, the one a window too short for either side too.
import test from 'node:test';
import assert from 'node:assert/strict';
import { noteAt, clearNote } from '../web/press-note.mjs';

// A window of width × height scrolled down by scrollY, whose notes measure noteWidth × noteHeight.
const windowOf = ({ width = 390, height = 844, scrollY = 0, noteWidth = 300, noteHeight = 54 } = {}) => {
  const listeners = new Map();
  const node = () => ({
    style: {}, attributes: {}, children: [], parent: null, offsetWidth: noteWidth, offsetHeight: noteHeight,
    setAttribute(name, value) { this.attributes[name] = String(value); },
    append(child) { child.parent = this; this.children.push(child); },
    remove() { if (this.parent) this.parent.children = this.parent.children.filter(each => each !== this); this.parent = null; },
    // A note's box before it is placed: the origin of the page it scrolls with.
    getBoundingClientRect: () => ({ left: 0, top: -scrollY }),
  });
  const doc = {
    defaultView: { innerWidth: width, innerHeight: height },
    createElement: node, body: node(),
    addEventListener: (type, listener) => listeners.set(type, listener),
    removeEventListener: (type, listener) => { if (listeners.get(type) === listener) listeners.delete(type); },
  };
  return { doc, listeners, note: () => doc.body.children[0] ?? null };
};
// What a note is said beside, at a box in the window's terms.
const anchorAt = (doc, { left = 40, top, height = 24, width = 120 }) => ({
  isConnected: true, ownerDocument: doc, getClientRects: () => [{}],
  getBoundingClientRect: () => ({ left, top, right: left + width, bottom: top + height, width, height }),
  closest: () => null,
});
// Where the note shows, in the window's terms.
const placed = ({ note }, scrollY = 0) => ({ left: parseFloat(note().style.left), top: parseFloat(note().style.top) - scrollY });

test('a note shows 6px under what it is said beside where the window has room below, at its left edge', () => {
  const page = windowOf();
  assert.equal(noteAt(anchorAt(page.doc, { top: 300 }), 'Why'), true);
  assert.deepEqual(placed(page), { left: 40, top: 300 + 24 + 6 });
  assert.equal(page.note().textContent, 'Why');
  assert.equal(page.note().attributes.role, 'status');
  // The last place with room below: its bottom 16px in from the window's.
  clearNote(page.doc);
  noteAt(anchorAt(page.doc, { top: 844 - 16 - 54 - 6 - 24 }), 'Why');
  assert.equal(placed(page).top, 844 - 16 - 54, 'still under, its bottom at the gutter');
});

test('a note shows 6px over what it is said beside where the window has no room below, as at the bottom of a phone screen', () => {
  const page = windowOf();
  noteAt(anchorAt(page.doc, { top: 844 - 16 - 54 - 6 - 24 + 1 }), 'Why');
  assert.equal(placed(page).top, 844 - 16 - 54 - 6 - 24 + 1 - 6 - 54, 'a pixel short of room below, it is over');
  clearNote(page.doc);
  noteAt(anchorAt(page.doc, { top: 800 }), 'Why');
  assert.equal(placed(page).top, 800 - 6 - 54);
  // In a page scrolled down, placed in the page's terms so it shows there in the window's.
  const scrolled = windowOf({ scrollY: 1200 });
  noteAt(anchorAt(scrolled.doc, { top: 800 }), 'Why');
  assert.deepEqual(placed(scrolled, 1200), { left: 40, top: 800 - 6 - 54 });
});

test('a note shows under what it is said beside where the window has room on neither side', () => {
  const page = windowOf({ height: 120 });
  noteAt(anchorAt(page.doc, { top: 40, height: 30 }), 'Why');
  assert.equal(placed(page).top, 40 + 30 + 6, 'over it would start above the window, so under it is');
});

test('a note keeps 16px in from the window\'s sides', () => {
  const page = windowOf({ width: 320, noteWidth: 200 });
  noteAt(anchorAt(page.doc, { left: 200, top: 300 }), 'Why');
  assert.equal(placed(page).left, 320 - 16 - 200, 'pulled in from the right');
  noteAt(anchorAt(page.doc, { left: 0, top: 300 }), 'Why');
  assert.equal(placed(page).left, 16, 'pushed in from the left');
});

test('nothing shows for what is out of the window, gone from the page or not given, and the note before goes', () => {
  const page = windowOf();
  noteAt(anchorAt(page.doc, { top: 300 }), 'Before');
  for (const anchor of [anchorAt(page.doc, { top: -24 }), anchorAt(page.doc, { top: 844 }), { ...anchorAt(page.doc, { top: 300 }), isConnected: false },
    { ...anchorAt(page.doc, { top: 300 }), getClientRects: () => [] }]) {
    assert.equal(noteAt(anchor, 'Why'), false);
    assert.equal(page.note(), null, 'nothing shows, and the note before is gone');
  }
  assert.equal(noteAt(null, 'Why'), false);
  assert.equal(noteAt(null, 'Why', page.doc), false);
  assert.equal(page.note(), null);
});

test('one note at a time, in an open dialog when it is said there, gone at the next press or key', () => {
  const page = windowOf();
  noteAt(anchorAt(page.doc, { top: 300 }), 'First');
  noteAt(anchorAt(page.doc, { top: 400 }), 'Second');
  assert.deepEqual(page.doc.body.children.map(each => each.textContent), ['Second']);
  const dialog = page.doc.createElement('dialog');
  noteAt({ ...anchorAt(page.doc, { top: 100 }), closest: selector => (selector === 'dialog[open]' ? dialog : null) }, 'In the Reader');
  assert.deepEqual([page.doc.body.children.length, dialog.children.map(each => each.textContent)], [0, ['In the Reader']]);
  for (const type of ['pointerdown', 'keydown']) {
    noteAt(anchorAt(page.doc, { top: 300 }), 'Why');
    page.listeners.get(type)();
    assert.equal(page.note(), null, `a ${type} takes it away`);
    assert.equal(page.listeners.size, 0, 'and stops listening');
  }
});

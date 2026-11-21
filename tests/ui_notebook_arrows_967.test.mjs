import test from 'node:test';
import assert from 'node:assert/strict';
import { panes } from '../web/panes.mjs';
import { DeckPage } from '../web/deck-page.mjs';
import { NotebookPage } from '../web/notebook-page.mjs';
import { parseDeck } from '../web/deck.mjs';
import { notebookFixture } from './fixtures/notebook_sheet_dom.mjs';

// Owner checks exercise routing/lifecycle, not browser geometry or gestures.
function fixture(t) {
  const previous = { notebook: panes.notebook, feed: panes.feed, things: panes.things };
  const f = notebookFixture(t);
  t.after(() => Object.assign(panes, previous));
  Object.assign(f.doc.defaultView, { innerWidth: 1400, innerHeight: 1000 });
  f.sheet.dialog.checkVisibility = () => f.sheet.dialog.open;
  const main = f.doc.createElement('main'); main.id = 'main'; main.checkVisibility = () => true;
  const message = f.doc.createElement('button'); main.append(message); f.doc.body.append(main);
  panes.feed = () => { message.focus(); return true; };
  const things = f.doc.createElement('aside'), row = f.doc.createElement('button');
  things.append(row); f.doc.body.append(things); things.checkVisibility = () => true;
  panes.things = { host: things, focus: () => { row.focus(); return true; } };
  return { ...f, message, railRow: row };
}

test('967 shown dock replaces right rail; returning restores feed and picked card', async t => {
  const f = fixture(t); await f.sheet.open('p');
  const card = f.doc.createElement('button'); f.page.host.append(card);
  f.page.show = () => card.focus();
  f.message.focus(); let landed = 0;
  assert.equal(panes.step('feed', 'right', f.doc, () => landed++), true);
  assert.equal(f.doc.activeElement, card); assert.equal(landed, 1);
  assert.equal(f.page.leavePane('left'), true); assert.equal(f.doc.activeElement, f.message);
  assert.equal(panes.step('feed', 'right', f.doc), true); assert.equal(f.doc.activeElement, card);
});

test('967 entry resumes an editor without altering its writing or selection', async t => {
  const f = fixture(t); await f.sheet.open('p');
  const field = f.doc.createElement('textarea');
  Object.assign(field, { value: 'Exact writing', selectionStart: 3, selectionEnd: 8 });
  f.page.host.append(field); f.page.editing = { field };
  assert.equal(panes.step('feed', 'right', f.doc), true); assert.equal(f.doc.activeElement, field);
  assert.deepEqual([field.value, field.selectionStart, field.selectionEnd], ['Exact writing', 3, 8]);
});

test('967 closed/modal/retired Notebook cannot replace or exit to the feed', async t => {
  const f = fixture(t); await f.sheet.open('p');
  f.sheet.close(); assert.equal(panes.step('feed', 'right', f.doc), true); assert.equal(f.doc.activeElement, f.railRow);
  assert.equal(f.page.leavePane('left'), false);
  await f.sheet.open('p'); f.sheet.setDocked(false);
  assert.equal(f.sheet.pane.active(), false); assert.equal(f.sheet.pane.focus(), false);
  assert.equal(f.page.leavePane('left'), false);
  f.sheet.retire(); assert.equal(panes.notebook, null);
});

test('967 empty displayed page has a control to receive focus', async t => {
  const f = fixture(t); await f.sheet.open('p'); f.message.focus();
  assert.equal(panes.step('feed', 'right', f.doc), true);
  assert.equal(f.doc.activeElement, f.page.more);
});

test('967 card tree folds and selects parents before an unmodified outward Left', () => {
  const page = Object.assign(Object.create(DeckPage.prototype), {
    deck: parseDeck('## Parent\n\nWords.\n\n### Child\n\nWords.\n\n## Last\n\nWords.\n'),
    picked: 1, folded: new Set(), exits: [],
    pick(i) { this.picked = i; }, fold(i) { this.folded.add(this.deck.cards[i].title); },
    leavePane(way) { this.exits.push(way); },
  });
  page.tree(true, false); assert.equal(page.picked, 0); assert.deepEqual(page.exits, []);
  page.tree(true, false); assert.equal(page.folded.has('Parent'), true); assert.deepEqual(page.exits, []);
  page.tree(true, true); assert.deepEqual(page.exits, [], 'command-Left stays the tree/browser guard');
  page.tree(true, false); assert.deepEqual(page.exits, ['left']);
  page.picked = 2; page.tree(true, false); assert.deepEqual(page.exits, ['left', 'left']);
  delete page.leavePane; assert.doesNotThrow(() => page.tree(true, false), 'standalone deck has no pane handoff');
});

test('967 unused caret arrows never reach spatial navigation, including empty editors', () => {
  for (const mode of ['cards', 'text']) for (const value of ['', 'Exact words']) {
    const field = { value, selectionStart: 0, selectionEnd: 0, closest: () => null };
    const input = { writingKey: () => false, indentKey: () => false };
    const page = Object.assign(Object.create(NotebookPage.prototype), {
      host: { hidden: false }, mode, text: field, textInput: input,
      editing: mode === 'cards' ? { field, input } : null,
      writeBeside: () => false, foldWriting: () => false,
    });
    for (const key of ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown']) {
      const event = { key, target: field, stopPropagation() { this.stopped = true; }, preventDefault() { this.defaultPrevented = true; } };
      page.key(event);
      assert.equal(event.stopped, true, `${mode}/${JSON.stringify(value)}/${key}`);
      assert.notEqual(event.defaultPrevented, true, 'native caret action remains available');
      assert.equal(field.value, value);
    }
  }
});

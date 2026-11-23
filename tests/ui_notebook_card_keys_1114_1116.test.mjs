import test from 'node:test';
import assert from 'node:assert/strict';
import { NotebookPage } from '../web/notebook-page.mjs';
import { NotebookSheet } from '../web/notebook-sheet.mjs';
import { WritingInput } from '../web/writing-input.mjs';
import { NotebookEditHistory } from '../web/notebook-edit-history.mjs';
import { cardText, deckBody, parseDeck } from '../web/deck.mjs';
import { miniDocument } from './fixtures/mini_dom.mjs';

class Field extends EventTarget {
  constructor(value) { super(); this.value = value; this.setSelectionRange(value.length, value.length); }
  setSelectionRange(start, end) { this.selectionStart = start; this.selectionEnd = end; }
}
// Actual Notebook/Deck key, edit/start, finish, act and save owners. The field,
// painting and writing transport are ports: this does not prove native input.
function page(body = '## First\n\nkept words\n\n## Last\n\nneighbor\n') {
  const p = Object.assign(Object.create(NotebookPage.prototype), {
    host: {}, mode: 'cards', doc: { body: {} },
    list: { contains: () => true, querySelector: () => null },
    base: { body }, deck: parseDeck(body), picked: 0, selected: new Set(),
    folded: new Set(), acts: [], undos: [], readOnly: false,
    header: { description: {} }, paint() {}, show() {}, keepFolds() {},
    holdPage: () => () => {}, say(words) { this.notice = words; },
  });
  p.writes = [];
  p.writing = { value: { body }, edit(patch, seen, mode, acts) {
    if (patch.body === this.value.body) return false;
    p.writes.push(structuredClone({ patch, seen, mode, acts }));
    this.value = { ...this.value, ...patch }; return true;
  } };
  p.cardsSeen = { revision: 1, content: { body } };
  p.open = editing => {
    const field = new Field(editing.shown ?? editing.text);
    p.editing = { ...editing, field, input: new WritingInput({ field, mac: true }),
      history: new NotebookEditHistory({ field, mac: true }) };
  };
  return p;
}
function enter(p, extra = {}) {
  const event = { key: 'Enter', target: p.editing?.field ?? p.list,
    preventDefault() { this.defaultPrevented = true; }, ...extra };
  p.key(event); return event;
}

for (const modifier of ['metaKey', 'ctrlKey']) test('1114 ' + modifier + ' Return toggles both ways and saves only the edited card', () => {
  const p = page(), before = deckBody(p.deck);
  assert.equal(enter(p, { [modifier]: true }).defaultPrevented, true);
  assert.equal(p.editing.fresh, false); assert.equal(p.editing.field.value, 'First\nkept words');
  p.editing.field.value += ' revised'; p.editing.field.setSelectionRange(0, 0);
  assert.equal(enter(p, { [modifier]: true }).defaultPrevented, true);
  assert.equal(p.editing, null); assert.equal(p.deck.cards.length, 2);
  assert.equal(p.deck.cards[0].words, 'kept words revised');
  assert.equal(p.deck.cards[1].words, 'neighbor');
  assert.equal(p.writing.value.body, deckBody(p.deck)); assert.equal(p.writes.length, 1);
  p.undo(); assert.equal(deckBody(p.deck), before);
});

test('1114 whitespace-only selection finishes; nonblank selection keeps the 1075 split', () => {
  const p = page('## First\n\nleft   payload right\n\n## Last\n\nneighbor\n');
  p.edit(); const f = p.editing.field, start = f.value.indexOf('   ');
  f.setSelectionRange(start, start + 3); enter(p, { metaKey: true });
  assert.equal(p.editing, null); assert.equal(p.writes.length, 0);
  p.edit(); const source = p.editing.field, at = source.value.indexOf('payload');
  source.setSelectionRange(at, at + 7); enter(p, { metaKey: true });
  assert.equal(p.editing.field.value, 'payload'); assert.equal(p.editing.fresh, true);
  assert.equal(p.deck.cards[0].words, 'left    right');
  assert.equal(p.writes.length, 1); assert.equal(p.writes[0].acts[0].kind, 'card-region');
});

test('1115 plain Return starts below the selected card and remains native in its editor', () => {
  const p = page(), before = deckBody(p.deck);
  assert.equal(enter(p).defaultPrevented, true);
  assert.equal(p.editing.fresh, true); assert.equal(p.editing.after, 'First\nkept words');
  assert.equal(p.editing.field.value, ''); assert.equal(p.writes.length, 0);
  const field = p.editing.field;
  assert.notEqual(enter(p).defaultPrevented, true); assert.equal(p.editing.field, field);
  field.value = 'New\nexact writing'; p.save(); p.finish();
  assert.deepEqual(p.deck.cards.map(c => c.title), ['First', 'New', 'Last']);
  assert.equal(p.writing.value.body, deckBody(p.deck));
  p.undo(); assert.equal(deckBody(p.deck), before);
});

test('1115 insertion preserves the selected parent group and card depth', () => {
  const p = page('## Parent\n\nwords\n\n### Child\n\nchild\n\n## Last\n\nneighbor\n');
  enter(p); assert.equal(p.editing.after, 'Child\nchild'); assert.equal(p.editing.depth, 0);
  p.editing.field.value = 'New'; p.finish();
  assert.deepEqual(p.deck.cards.map(c => [c.title, c.depth]), [['Parent', 0], ['Child', 1], ['New', 0], ['Last', 0]]);
});

for (const extra of [{ isComposing: true }, { keyCode: 229 }, { defaultPrevented: true }, { target: {} }])
  test('1114 composition, consumed and foreign-field keys keep the same editor: ' + JSON.stringify(extra), () => {
    const p = page(); p.edit(); const editor = p.editing, before = deckBody(p.deck);
    enter(p, { metaKey: true, ...extra });
    assert.equal(p.editing, editor); assert.equal(deckBody(p.deck), before); assert.equal(p.writes.length, 0);
  });

for (const guard of ['page read-only', 'field read-only', 'closed', 'pending', 'unavailable'])
  test('1114 no-selection toggle respects writing guard: ' + guard, () => {
    const p = page(); p.edit(); const editor = p.editing;
    if (guard === 'page read-only') p.readOnly = true;
    if (guard === 'field read-only') editor.field.readOnly = true;
    if (guard === 'closed') p.writing.closed = true;
    if (guard === 'pending') p.writing.actionPending = {};
    if (guard === 'unavailable') p.unavailable = 'Other tab owns this page';
    enter(p, { metaKey: true }); assert.equal(p.editing, editor); assert.equal(p.writes.length, 0);
  });

test('1116 the sheet/dock diff starts closed while retaining the summary and changes', async () => {
  const doc = miniDocument(); doc.visibilityState = 'visible'; doc.hasFocus = () => true;
  const source = { source_ref: { kind: 'memory', id: 'fixture', revision: 2 }, body: 'Monday' };
  const p = { changes: doc.createElement('div'), writing: { base: { source } } };
  const sheet = Object.assign(Object.create(NotebookSheet.prototype), { doc, current: p, serial: 1, showing: true,
    reads: () => ({ opened: async () => 1 }), source: async () => ({ body: 'Friday' }),
    node(tag, className, words) { const n = doc.createElement(tag); n.className = className ?? ''; if (words !== undefined) n.textContent = words; return n; } });
  await sheet.readPage(p, 1);
  const disclosure = p.changes.children[0];
  assert.equal(disclosure.tagName, 'DETAILS'); assert.equal(disclosure.open, false);
  assert.equal(p.changes.hidden, false); assert.match(disclosure.children[0].textContent, /revision 1/);
  assert.match(disclosure.text, /Friday/); assert.match(disclosure.text, /Monday/);
  disclosure.open = true; assert.equal(disclosure.open, true, 'the ordinary disclosure remains available');
});

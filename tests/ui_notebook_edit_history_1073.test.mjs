import test from 'node:test';
import assert from 'node:assert/strict';
import { NotebookEditHistory, CARD_EDIT_HISTORY_LIMIT } from '../web/notebook-edit-history.mjs';
import { NotebookPage } from '../web/notebook-page.mjs';
import { WritingInput } from '../web/writing-input.mjs';
import { parseDeck, cardText } from '../web/deck.mjs';

// Real history, WritingInput and NotebookPage methods with a deterministic
// field adapter. These are semantic checks; native gestures/Core stay separate.
class Input extends Event {
  constructor(type, options = {}) { super(type, { cancelable: true, ...options }); Object.assign(this, { inputType: options.inputType, isComposing: options.isComposing ?? false }); }
}
class Field extends EventTarget {
  constructor(text = '') {
    super(); this.value = text; this.setSelectionRange(text.length, text.length);
    this.ownerDocument = { defaultView: { InputEvent: Input }, execCommand: (command, _ui, text) => {
      this.edit(command === 'delete' ? '' : text, command === 'delete' ? 'deleteContentBackward' : 'insertText'); return true;
    } };
    this.style = { setProperty() {} }; this.readOnly = false;
  }
  setAttribute() {}
  closest() { return null; }
  setSelectionRange(start, end, direction = 'none') { this.selectionStart = start; this.selectionEnd = end; this.selectionDirection = direction; }
  edit(text, inputType = 'insertText', isComposing = false) {
    if (!this.dispatchEvent(new Input('beforeinput', { inputType, isComposing }))) return;
    const start = this.selectionStart;
    this.value = this.value.slice(0, start) + text + this.value.slice(this.selectionEnd);
    this.setSelectionRange(start + text.length, start + text.length);
    this.dispatchEvent(new Input('input', { inputType, isComposing }));
  }
}
const state = f => [f.value, f.selectionStart, f.selectionEnd, f.selectionDirection];
const key = (name, extra = {}) => ({ key: name, preventDefault() { this.defaultPrevented = true; }, ...extra });
function fixture(text = 'Alpha beta gamma.', options = {}) {
  const field = new Field(text), saves = [], input = new WritingInput({ field, mac: true });
  const history = new NotebookEditHistory({ field, mac: true, ...options });
  field.addEventListener('input', event => saves.push({ state: state(field), type: event.inputType }));
  return { field, history, input, saves, undo: () => history.key(key('z', { metaKey: true })), redo: () => history.key(key('Z', { metaKey: true, shiftKey: true })) };
}

test('1073 typing words and trailing spaces coalesce, punctuation and caret navigation divide steps', () => {
  const f = fixture('');
  for (const char of 'one two') f.field.edit(char);
  f.undo(); assert.equal(f.field.value, 'one '); f.undo(); assert.equal(f.field.value, '');
  f.redo(); f.redo(); assert.equal(f.field.value, 'one two');
  f.field.edit('.'); f.undo(); assert.equal(f.field.value, 'one two'); f.redo();
  f.history.aroundKey(key('ArrowLeft'), () => {}); f.field.edit('more');
  f.undo(); assert.equal(f.field.value, 'one two.');
});
for (const [action, type, insertion] of [['cut', 'deleteByCut', ''], ['paste', 'insertFromPaste', 'Alpha'], ['delete', 'deleteContentBackward', '']])
  test(`1073 ${action} restores exact selection before typing is undone, then redoes both`, () => {
    const f = fixture(), initial = state(f.field); f.field.edit(' typed'); const typed = state(f.field);
    f.field.setSelectionRange(6, 10, 'backward'); const before = state(f.field);
    f.field.edit(insertion, type); const after = state(f.field);
    f.undo(); assert.deepEqual(state(f.field), before);
    f.undo(); assert.deepEqual(state(f.field), initial);
    f.redo(); assert.deepEqual(state(f.field), typed);
    f.redo(); assert.deepEqual(state(f.field), after);
    assert.equal(f.saves.at(-1).type, 'historyRedo');
  });
test('1073 Copy and unchanged input preserve the redo branch; a changed input replaces it', () => {
  const f = fixture(); f.field.edit(' typed'); f.undo();
  f.field.setSelectionRange(0, 5); f.field.dispatchEvent(new Event('copy'));
  f.field.edit('Alpha', 'insertFromPaste'); f.redo(); assert.equal(f.field.value, 'Alpha beta gamma. typed');
  f.undo(); f.field.setSelectionRange(0, 5); f.field.edit('New', 'insertFromPaste');
  const kept = state(f.field); f.redo(); assert.deepEqual(state(f.field), kept);
});
test('1073 repeated deletions are distinct steps, even at the same caret', () => {
  const f = fixture('abc'); f.field.setSelectionRange(2, 3); f.field.edit('', 'deleteContentBackward');
  f.field.setSelectionRange(1, 2); f.field.edit('', 'deleteContentBackward');
  f.undo(); assert.deepEqual(state(f.field), ['ab', 1, 2, 'none']);
  f.undo(); assert.deepEqual(state(f.field), ['abc', 2, 3, 'none']);
});
test('1073 the native editing-menu history events use the same stack and consume empty Undo', () => {
  const f = fixture(); f.field.edit(' typed');
  const menu = way => { const event = new Input('beforeinput', { inputType: way }); f.field.dispatchEvent(event); assert.equal(event.defaultPrevented, true); };
  menu('historyUndo'); assert.equal(f.field.value, 'Alpha beta gamma.');
  menu('historyUndo'); assert.equal(f.field.value, 'Alpha beta gamma.');
  menu('historyRedo'); assert.equal(f.field.value, 'Alpha beta gamma. typed');
});
test('1073 composition commits one step, with both compositionend/final-input orderings', async () => {
  for (const finalAfterEnd of [false, true]) {
    const f = fixture('kept '), before = state(f.field); f.field.dispatchEvent(new Event('compositionstart'));
    f.field.edit('仮', 'insertCompositionText', true);
    assert.equal(f.history.key(key('z', { metaKey: true, isComposing: true })), false);
    assert.equal(f.history.key(key('z', { metaKey: true, keyCode: 229 })), false);
    if (finalAfterEnd) f.field.dispatchEvent(new Event('compositionend'));
    f.field.setSelectionRange(5, 6); f.field.edit('確定', 'insertFromComposition', !finalAfterEnd);
    if (!finalAfterEnd) f.field.dispatchEvent(new Event('compositionend'));
    await Promise.resolve(); const after = state(f.field);
    assert.equal(f.history.entries.length, 1); f.undo(); assert.deepEqual(state(f.field), before);
    f.redo(); assert.deepEqual(state(f.field), after);
  }
});
test('1073 unchanged/cancelled composition keeps the preceding edit and redo', async () => {
  const f = fixture('kept'); f.field.edit(' typed'); f.undo();
  f.field.dispatchEvent(new Event('compositionstart')); f.field.dispatchEvent(new Event('compositionend')); await Promise.resolve();
  f.redo(); assert.equal(f.field.value, 'kept typed');
});
test('1073 history is bounded at50 steps and save observers do not reset it', () => {
  const f = fixture('');
  for (let i = 0; i < CARD_EDIT_HISTORY_LIMIT + 9; i++) f.field.edit('x', 'insertFromPaste');
  for (let i = 0; i < CARD_EDIT_HISTORY_LIMIT + 1; i++) f.undo();
  assert.equal(f.field.value, 'x'.repeat(9)); assert.equal(f.history.entries.length, 50);
  for (let i = 0; i < 50; i++) f.redo(); assert.equal(f.field.value, 'x'.repeat(59));
});
test('1073 readonly, modifier/IME guards, close and unexpected replacement never replay stale text', () => {
  const f = fixture(); f.field.edit(' typed'); const after = state(f.field);
  f.field.readOnly = true; f.undo(); assert.deepEqual(state(f.field), after); f.field.readOnly = false;
  for (const extra of [{ altKey: true }, { ctrlKey: true }, { isComposing: true }, { keyCode: 229 }, { defaultPrevented: true }])
    assert.equal(f.history.key(key('z', { metaKey: true, ...extra })), false);
  f.field.value = 'incoming'; f.undo(); assert.equal(f.field.value, 'incoming');
  f.field.edit(' own'); f.history.close(); f.field.edit(' later'); f.undo(); assert.equal(f.field.value, 'incoming own later');
});
test('1073 non-Mac Ctrl-Z/Shift-Ctrl-Z/Ctrl-Y and non-Latin layout fallback', () => {
  const f = fixture('', { mac: false }); f.field.edit('one');
  f.history.key(key('я', { code: 'KeyZ', ctrlKey: true })); assert.equal(f.field.value, '');
  f.history.key(key('y', { ctrlKey: true })); assert.equal(f.field.value, 'one');
  f.history.key(key('z', { ctrlKey: true })); f.history.key(key('Z', { ctrlKey: true, shiftKey: true })); assert.equal(f.field.value, 'one');
});
for (const [name, nameKey, modifiers, start, end] of [
  ['move line', 'ArrowUp', { altKey: true }, 6, 10], ['indent', 'Tab', {}, 6, 10],
  ['delete to line start', 'u', { ctrlKey: true }, 8, 8], ['delete word', 'w', { ctrlKey: true }, 10, 10],
  ['delete to line end', 'k', { ctrlKey: true }, 6, 6],
]) test(`1073 actual shared ${name} retains its original and final caret`, () => {
  const f = fixture('first\nlast words'); f.field.setSelectionRange(start, end, 'backward'); const before = state(f.field), event = key(nameKey, modifiers);
  f.history.aroundKey(event, () => f.input.writingKey(event) || f.input.indentKey(event)); const after = state(f.field);
  assert.notEqual(after[0], before[0]); f.undo(); assert.deepEqual(state(f.field), before); f.redo(); assert.deepEqual(state(f.field), after);
});
test('1073 actual Notebook open/key/save/finish lifecycle routes only the card editor', () => {
  const body = '## Heading\n\nAlpha beta gamma.\n\n## Neighbor\n\nKeep me.\n', writes = [];
  const page = Object.assign(Object.create(NotebookPage.prototype), {
    host: { hidden: false }, mode: 'cards', deck: parseDeck(body), acts: [], undos: [], readOnly: false, keyed: false,
    cardsSeen: { revision: 1, content: { body } }, writing: { closed: false, edit(patch, seen, mode) { writes.push({ patch, seen, mode }); return true; } },
    node: () => new Field(), paint() {}, fit() {}, holdPage: () => () => {}, imagePicker: () => ({ close() {} }),
    show() {}, keepNamed() {}, act() { return false; },
  });
  page.open({ text: cardText(page.deck.cards[0]), near: 0 }); const field = page.editing.field, history = page.editing.history;
  field.edit(' typed'); const event = key('z', { target: field, metaKey: true }); page.key(event);
  assert.equal(event.defaultPrevented, true); assert.equal(cardText(parseDeck(writes.at(-1).patch.body).cards[0]), 'Heading\nAlpha beta gamma.');
  assert.equal(cardText(parseDeck(writes.at(-1).patch.body).cards[1]), 'Neighbor\nKeep me.');
  assert.equal(writes.at(-1).mode, 'cards'); assert.equal(page.editing.history, history);
  // A key routed to a different field never calls this history.
  page.key(key('z', { target: new Field('composer'), metaKey: true })); assert.equal(history.position, 0);
  page.finish(); assert.equal(history.closed, true); assert.equal(page.editing, null);
  page.open({ text: cardText(page.deck.cards[0]), near: 0 }); assert.notEqual(page.editing.history, history); assert.equal(page.editing.history.entries.length, 0);
  page.finish({ discard: true });
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { lineMove } from '../web/line-move.mjs';
import { WritingInput } from '../web/writing-input.mjs';

// The text after a move, and where the cursor or selection then is.
const moved = (value, start, end, dir) => {
  const move = lineMove(value, start, end, dir);
  if (!move) return null;
  return { value: value.slice(0, move.from) + move.text + value.slice(move.to), start: move.start, end: move.end };
};
const at = (value, words) => value.indexOf(words);

test('Option-Up on "b) two" in a lettered list puts it above "a) one", as the item says', () => {
  const value = 'a) one\nb) two\nc) three', caret = at(value, 'two');
  assert.deepEqual(moved(value, caret, caret, -1), { value: 'b) two\na) one\nc) three', start: at('b) two\na) one\nc) three', 'two'), end: at('b) two\na) one\nc) three', 'two') });
});

test('an item carries the lines indented under it, and moves only past an item at its own depth', () => {
  const value = '- one\n  more of one\n- two\n  - two a\n  - two b\n- three';
  assert.equal(moved(value, at(value, 'more'), at(value, 'more'), 1)?.value, '- two\n  - two a\n  - two b\n- one\n  more of one\n- three');
  // A nested item moves within its own list, and past its end nothing moves.
  assert.equal(moved(value, at(value, 'two b'), at(value, 'two b'), -1)?.value, '- one\n  more of one\n- two\n  - two b\n  - two a\n- three');
  assert.equal(moved(value, at(value, 'two b'), at(value, 'two b'), 1), null);
  assert.equal(moved(value, at(value, 'two a'), at(value, 'two a'), -1), null);
  // The first item has nothing above it in its list.
  assert.equal(moved(value, 1, 1, -1), null);
});

test('a plain line moves past the line next to it in its paragraph, and not out of it', () => {
  const value = 'first\nsecond\nthird\n\nafter';
  assert.equal(moved(value, at(value, 'second'), at(value, 'second'), -1)?.value, 'second\nfirst\nthird\n\nafter');
  assert.equal(moved(value, at(value, 'third'), at(value, 'third'), 1), null, 'the paragraph ends at the blank line');
  assert.equal(moved(value, 0, 0, -1), null, 'nothing above the first line');
});

test('a paragraph wholly the cursor\'s moves past the next paragraph, the blank lines staying put', () => {
  const value = 'one\n\ntwo\n\n\nthree';
  assert.equal(moved(value, at(value, 'two'), at(value, 'two'), 1)?.value, 'one\n\nthree\n\n\ntwo');
  assert.equal(moved(value, at(value, 'two'), at(value, 'two'), -1)?.value, 'two\n\none\n\n\nthree');
  // Every line of a longer paragraph selected moves it whole.
  const long = 'a\nb\n\nc';
  assert.equal(moved(long, 0, 3, 1)?.value, 'c\n\na\nb');
  assert.equal(moved(long, 0, 3, 1).start, 3);
});

test('a selection moves the blocks it touches together, and nothing when they are of two kinds', () => {
  const value = '- a\n- b\n- c\n- d';
  assert.equal(moved(value, at(value, 'b'), at(value, 'c'), -1)?.value, '- b\n- c\n- a\n- d');
  const mixed = 'words\n- item';
  assert.equal(moved(mixed, 0, mixed.length, 1), null);
  assert.equal(moved(mixed, 0, 0, 1), null, 'a line does not move past an item');
});

test('moving back undoes a move exactly, and a bad input fails loudly', () => {
  for (const [value, words, dir] of [['a) one\nb) two\nc) three', 'two', -1], ['x\ny\nz', 'y', 1], ['p\n\nq', 'q', -1]]) {
    const caret = at(value, words), there = moved(value, caret, caret, dir), back = moved(there.value, there.start, there.end, -dir);
    assert.deepEqual(back, { value, start: caret, end: caret });
  }
  assert.throws(() => lineMove('x', 2, 1, 1), TypeError);
  assert.throws(() => lineMove('x', 0, 0, 0), TypeError);
});

// The key in a field: one edit through the browser's insertText (so its Undo
// takes the move back), the cursor moved with the line, and Undo puts the
// cursor back where it was.
function field(value) {
  const handlers = [], editor = { draft: { body: value }, submissions: [], edit(patch) { Object.assign(this.draft, patch); } };
  const node = { value, selectionStart: 0, selectionEnd: 0, readOnly: false,
    addEventListener: (name, fn) => handlers.push([name, fn]),
    setSelectionRange(start, end) { this.selectionStart = start; this.selectionEnd = end; },
    fire(event) { for (const [name, fn] of handlers) if (name === event.type) fn(event); },
    commands: [],
    ownerDocument: { execCommand(command, _ui, text) {
      node.commands.push(command);
      node.value = node.value.slice(0, node.selectionStart) + text + node.value.slice(node.selectionEnd);
      node.setSelectionRange(node.selectionStart + text.length, node.selectionStart + text.length);
      node.fire({ type: 'input', inputType: 'insertText' }); return true;
    } } };
  const input = new WritingInput({ field: node, mac: true, editor: () => editor, admits: () => true });
  const key = (name, extra = {}) => { const event = { key: name, altKey: true, prevented: false, preventDefault() { this.prevented = true; }, ...extra }; return { taken: input.writingKey(event), event }; };
  return { node, editor, key };
}

test('Option-Up in a field moves the line as one insertText edit, and Undo puts the cursor back', () => {
  const f = field('a) one\nb) two\nc) three'), caret = 9;
  f.node.setSelectionRange(caret, caret);
  const { taken, event } = f.key('ArrowUp');
  assert.equal(taken, true); assert.equal(event.prevented, true);
  assert.equal(f.node.value, 'b) two\na) one\nc) three'); assert.deepEqual(f.node.commands, ['insertText']);
  assert.equal(f.editor.draft.body, 'b) two\na) one\nc) three', 'the writing keeps what the field says');
  assert.deepEqual([f.node.selectionStart, f.node.selectionEnd], [2, 2]);
  assert.deepEqual(f.editor.draft.caret, { start: 2, end: 2 });
  // The browser's Undo restores the text and selects the replaced range; the cursor goes back.
  f.node.value = 'a) one\nb) two\nc) three'; f.node.setSelectionRange(0, 22);
  f.node.fire({ type: 'input', inputType: 'historyUndo' });
  assert.deepEqual([f.node.selectionStart, f.node.selectionEnd], [caret, caret]);
});

test('where nothing can move, or another modifier is held, the key stays the browser\'s', () => {
  for (const [value, caret, name, extra] of [['a) one\nb) two', 1, 'ArrowUp', {}], ['only', 1, 'ArrowDown', {}],
    ['x\ny', 2, 'ArrowUp', { shiftKey: true }], ['x\ny', 2, 'ArrowUp', { metaKey: true }], ['x\ny', 2, 'ArrowUp', { isComposing: true }],
    ['x\ny', 2, 'ArrowUp', { altKey: false }], ['x\ny', 2, 'ArrowLeft', {}]]) {
    const f = field(value); f.node.setSelectionRange(caret, caret);
    const { taken, event } = f.key(name, extra);
    assert.equal(taken, false, JSON.stringify([value, name, extra])); assert.equal(event.prevented, false); assert.equal(f.node.value, value);
    assert.deepEqual(f.node.commands, []);
  }
});

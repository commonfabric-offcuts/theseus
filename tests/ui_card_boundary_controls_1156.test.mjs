import test from 'node:test';
import assert from 'node:assert/strict';
import { boundaryPage, outline, state, retained, deckBody } from './fixtures/card_boundary_1156.mjs';

for (const edge of ['start', 'end']) for (const gesture of ['Tab', 'Shift-Tab', 'Cmd-Up', 'Cmd-Down'])
  test(`1156 ${gesture} at ${edge} retains writing and uses the Display placement`, async t => {
    const { p, w, edit, press } = await boundaryPage(t), field = edit(1, edge), editor = p.editing;
    const before = state(field);
    const keys = { Tab: ['Tab', {}], 'Shift-Tab': ['Tab', { shiftKey: true }],
      'Cmd-Up': ['ArrowUp', { metaKey: true }], 'Cmd-Down': ['ArrowDown', { metaKey: true }] };
    // Outdent needs a parent; make that state with the existing card act.
    if (gesture === 'Shift-Tab') p.moveWriting({ kind: 'indent' });
    press(...keys[gesture]); retained(p, editor, before);
    const expected = gesture === 'Tab' ? [['A', 0], ['B', 1], ['B child', 2], ['C', 0]]
      : gesture === 'Shift-Tab' ? [['A', 0], ['B', 0], ['B child', 1], ['C', 0]]
      : gesture === 'Cmd-Up' ? [['B', 0], ['B child', 1], ['A', 0], ['C', 0]]
      : [['A', 0], ['C', 0], ['B', 0], ['B child', 1]];
    assert.deepEqual(outline(p), expected); assert.equal(w.value.body, p.previewBody());
  });

test('1156 blocked boundary Tab retains exact writing without a line-indent fallback', async t => {
  for (const edge of ['start', 'end']) for (const blocked of ['first', 'top-level', 'deepest']) {
    const body = blocked === 'deepest' ? '## A\n\n## B\n\n###### Deep\n' : undefined;
    const { p, w, edit, press } = await boundaryPage(t, body);
    const field = edit(blocked === 'first' ? 0 : 1, edge), editor = p.editing;
    const before = state(field), original = deckBody(p.deck), writing = w.value.body;
    const event = press('Tab', { shiftKey: blocked === 'top-level' });
    assert.equal(event.defaultPrevented, true); retained(p, editor, before);
    assert.equal(deckBody(p.deck), original); assert.equal(w.value.body, writing); assert.equal(p.undos.length, 0);
  }
});

test('1156 empty fresh editor uses the boundary without saving a blank card', async t => {
  const { p, w, press } = await boundaryPage(t), before = w.value.body;
  p.picked = 1; p.start(); const editor = p.editing, field = editor.field;
  assert.equal(field.value, ''); press('Tab');
  assert.equal(editor.depth, 1); retained(p, editor, ['', 0, 0, 'none']);
  assert.equal(w.value.body, before); assert.equal(p.deck.cards.length, 4);
});

test('1156 fresh words at the end save at their indented placement on finish', async t => {
  const { p, w, press } = await boundaryPage(t);
  p.picked = 1; p.start(); const editor = p.editing, field = editor.field;
  field.replace('Fresh\nkept words'); const before = state(field); press('Tab');
  retained(p, editor, before); assert.equal(editor.depth, 1); press('Escape');
  assert.equal(p.editing, null);
  assert.deepEqual(outline(p), [['A', 0], ['B', 0], ['B child', 1], ['Fresh', 1], ['C', 0]]);
  assert.equal(w.value.body, deckBody(p.deck));
});

test('1156 a nonempty selection touching either end keeps line indentation and history', async t => {
  for (const selection of [[0, 1], [3, 9], [0, 9]]) {
    const { p, edit, press } = await boundaryPage(t, '## A\n\n## B\n\n  words\n');
    const field = edit(), editor = p.editing;
    field.setSelectionRange(...selection, 'backward'); const before = state(field);
    const original = deckBody(p.deck); press('Tab');
    assert.equal(deckBody(p.deck), original); assert.equal(p.editing, editor);
    assert.equal(editor.history.entries.length, 1);
    press('z', { metaKey: true }); assert.deepEqual(state(field), before);
    press('Z', { metaKey: true, shiftKey: true }); assert.notEqual(field.value, before[0]);
  }
});

test('1156 interior Tab and Shift-Tab keep shared line editing and exact Undo Redo', async t => {
  const { p, edit, press } = await boundaryPage(t), field = edit(), editor = p.editing;
  field.setSelectionRange(4, 4); const before = state(field), original = deckBody(p.deck);
  press('Tab'); const indented = state(field); assert.equal(field.value, 'B\n  B words');
  assert.equal(deckBody(p.deck), original); press('z', { metaKey: true }); assert.deepEqual(state(field), before);
  press('Z', { metaKey: true, shiftKey: true }); assert.deepEqual(state(field), indented);
  press('Tab', { shiftKey: true }); assert.deepEqual(state(field), before); assert.equal(p.editing, editor);
});

test('1156 boundary Tab preserves the Command Control Option exclusions and writing guards', async t => {
  for (const guard of ['metaKey', 'ctrlKey', 'altKey', 'page-readonly', 'field-readonly', 'surface-readonly', 'missing-base', 'unavailable']) {
    const { p, edit, press } = await boundaryPage(t), field = edit(), editor = p.editing;
    const before = state(field), original = deckBody(p.deck), extra = {};
    if (guard.endsWith('Key')) extra[guard] = true;
    if (guard === 'page-readonly') p.readOnly = true;
    if (guard === 'field-readonly') field.readOnly = true;
    if (guard === 'surface-readonly') editor.input.surfaceReadOnly = () => true;
    if (guard === 'missing-base') p.base = null;
    if (guard === 'unavailable') p.unavailable = 'Other tab owns writing';
    press('Tab', extra); retained(p, editor, before); assert.equal(deckBody(p.deck), original);
  }
});

test('1156 composition consumed foreign and hidden Tab events keep their existing owners', async t => {
  for (const guard of ['isComposing', '229', 'consumed', 'foreign', 'hidden']) {
    const { p, edit, press } = await boundaryPage(t), field = edit(), editor = p.editing;
    const before = state(field), original = deckBody(p.deck), extra = {};
    if (guard === 'isComposing') extra.isComposing = true;
    if (guard === '229') extra.keyCode = 229;
    if (guard === 'consumed') extra.defaultPrevented = true;
    if (guard === 'foreign') extra.target = {};
    if (guard === 'hidden') p.host.hidden = true;
    press('Tab', extra); retained(p, editor, before); assert.equal(deckBody(p.deck), original);
  }
});

test('1156 actual Unicode whitespace and trailing newline offsets define the end', async t => {
  for (const suffix of [' 😀', '  ', '\n']) {
    const { p, edit, press } = await boundaryPage(t), field = edit(), editor = p.editing;
    field.replace(suffix); const before = state(field); press('Tab');
    retained(p, editor, before); assert.deepEqual(outline(p), [['A', 0], ['B', 1], ['B child', 2], ['C', 0]]);
  }
});

test('1156 changed draft and its text Undo survive end indentation and exact placement Undo', async t => {
  const { p, w, edit, press } = await boundaryPage(t), original = deckBody(p.deck), field = edit(), editor = p.editing;
  const unchanged = state(field); field.replace(' kept'); const changed = state(field), history = editor.history;
  press('Tab'); retained(p, editor, changed); assert.equal(editor.history, history);
  press('z', { metaKey: true }); assert.deepEqual(state(field), unchanged);
  press('Z', { metaKey: true, shiftKey: true }); assert.deepEqual(state(field), changed);
  press('Escape'); p.undo(); p.undo(); assert.equal(deckBody(p.deck), original); assert.equal(w.value.body, original);
});

test('1156 interior Command moves and Shift-Command selection exclusions stay unchanged', async t => {
  for (const modifiers of [{ metaKey: true }, { ctrlKey: true }]) {
    const { p, edit, press } = await boundaryPage(t), field = edit(), editor = p.editing;
    field.setSelectionRange(3, 5, 'backward'); const before = state(field);
    press('ArrowUp', { ...modifiers, shiftKey: true }); retained(p, editor, before);
    assert.deepEqual(outline(p), [['A', 0], ['B', 0], ['B child', 1], ['C', 0]]);
    field.setSelectionRange(4, 4); const caret = state(field); press('ArrowUp', modifiers);
    retained(p, editor, caret); assert.deepEqual(outline(p), [['B', 0], ['B child', 1], ['A', 0], ['C', 0]]);
  }
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { boundaryPage, outline, state, retained } from './fixtures/card_boundary_1156.mjs';

test('1156 Tab at the text end indents the card and children without editing its line', async t => {
  const { p, w, edit, press } = await boundaryPage(t), field = edit(), editor = p.editing;
  const before = state(field), history = editor.history;
  assert.equal(press('Tab').defaultPrevented, true);
  assert.deepEqual(outline(p), [['A', 0], ['B', 1], ['B child', 2], ['C', 0]],
    '1156 end Tab moves the whole card instead of inserting line spaces');
  retained(p, editor, before); assert.equal(editor.history, history);
  assert.equal(history.entries.length, 0, 'placement adds no text-history step');
  assert.equal(w.value.body, p.previewBody(), 'the real Notebook writer receives the moved outline');
});

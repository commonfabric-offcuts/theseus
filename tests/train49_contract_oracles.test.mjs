import test from 'node:test';
import assert from 'node:assert/strict';
import { assertFeedCard, assertCardDrag, assertInlineReply } from './train49-contract-oracles.mjs';
test('card oracle retains keyboard focusability and rejects old button and inaccessible DIV', () => {
  assertFeedCard({ tag: 'DIV', role: 'button', tabIndex: 0 });
  for (const state of [{ tag: 'BUTTON', role: null, tabIndex: 0 }, { tag: 'DIV', role: null, tabIndex: 0 }, { tag: 'DIV', role: 'button', tabIndex: -1 }])
    assert.throws(() => assertFeedCard(state), assert.AssertionError);
});
test('drag oracle requires exact native selection and no accidental Reader opening', () => {
  assertCardDrag({ selection: 'last', reader: false });
  assert.throws(() => assertCardDrag({ selection: '', reader: false }), assert.AssertionError);
  assert.throws(() => assertCardDrag({ selection: 'last', reader: true }), assert.AssertionError);
});
test('inline Reply oracle rejects a floating Reader, wrong owner and lost focus', () => {
  const valid = { open: true, sourceId: 'isolated-card', role: 'group', focus: 'writing-body' };
  assertInlineReply(valid, 'isolated-card');
  for (const delta of [{ sourceId: null }, { sourceId: 'other-card' }, { role: 'button' }, { focus: 'source-body' }, { open: false }])
    assert.throws(() => assertInlineReply({ ...valid, ...delta }, 'isolated-card'), assert.AssertionError);
});

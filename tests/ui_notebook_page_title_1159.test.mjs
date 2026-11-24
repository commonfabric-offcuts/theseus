import test from 'node:test';
import assert from 'node:assert/strict';
import { titlePage, BODY } from './fixtures/page_title_1159.mjs';

test('1159 Escape saves the page title and enters the first card at offset zero', async t => {
  const { p, w, calls, open, complete } = await titlePage(t);
  p.picked = 1; open(); await complete();
  assert.equal(w.value.title, 'Renamed page', '1159 Escape saves the title instead of cancelling it');
  assert.equal(p.editing?.near, 0);
  assert.equal(p.editing?.field.value, 'First\nFirst words');
  assert.equal(p.doc.activeElement, p.editing.field);
  assert.deepEqual([p.editing.field.selectionStart, p.editing.field.selectionEnd], [0, 0]);
  assert.equal(w.value.body, BODY);
  assert.equal(calls.length, 1); assert.equal(calls[0].args.title, 'Renamed page');
});

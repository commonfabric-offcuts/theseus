// Retained review source SHA256 129f1236867d9ecd5bda8d33737d1e565b854a25c083f68e9138dbaefe0e6cf7; adaptations: docs/card-text-review-867.json.
import test from 'node:test';
import assert from 'node:assert/strict';
import { text867, card, details, A, B, C, metaOf, parseDeck, CardTextProjection, stripDetails } from './fixtures/card_text_867.mjs';
const show = rows => rows.map(r => `${r.title}:${r.id ? r.id.slice(2, 3) : '-'}/${r.color ?? '-'}`).join('  ');
const dupes = rows => { const ids = rows.map(r => r.id).filter(Boolean); return ids.length !== new Set(ids).size; };
test('LP1 twins [S,S]: rename the first (unsaved), then paste a new identical twin at the end', async t => {
  const h = await text867(t, card('Same', 'same', details(A)) + card('Same', 'same', details(B, 'rose')));
  let rows = h.input(3, 7, 'Other'); console.log('LP1 renamed', show(rows)); assert.deepEqual(rows.map(r => r.id), [A, B]);
  const v = h.p.text.value; rows = h.input(v.length, v.length, '## Same\n\nsame\n\n', 'insertFromPaste');
  console.log('LP1 pasted ', show(rows), dupes(rows) ? 'DUPLICATE ID' : '');
  assert.deepEqual(rows.map(r => r.id), [A, B, null]);
});
test('LP2 twins [S,S,S]: edit the words of the last (unsaved), then paste a new identical twin at the top', async t => {
  const h = await text867(t, card('Same', 'same', details(A)) + card('Same', 'same', details(B, 'rose')) + card('Same', 'same', details(C, 'green')));
  const x = h.p.text.value.lastIndexOf('same') + 4; let rows = h.input(x, x, '!'); assert.deepEqual(rows.map(r => r.id), [A, B, C]);
  rows = h.input(0, 0, '## Same\n\nsame\n\n', 'insertFromPaste');
  console.log('LP2 pasted ', show(rows), dupes(rows) ? 'DUPLICATE ID' : '');
  assert.deepEqual(rows.map(r => r.id), [null, A, B, C]);
});
test('LP3 twins [S,S,S]: type into twin 3 then twin 2 (two unsaved edits), then rename twin 1', async t => {
  const h = await text867(t, card('Same', 'same', details(A)) + card('Same', 'same', details(B, 'rose')) + card('Same', 'same', details(C, 'green')));
  let v = h.p.text.value, x = v.lastIndexOf('same') + 4; h.input(x, x, '!');
  v = h.p.text.value; x = v.indexOf('same', v.indexOf('same') + 1) + 4; h.input(x, x, '!');
  let rows = h.input(3, 7, 'Other');
  console.log('LP3 renamed', show(rows), dupes(rows) ? 'DUPLICATE ID' : '');
  assert.deepEqual(rows.map(r => r.id), [A, B, C]);
});
test('LP4 twins [S,S,S,S!,S!] with the two ! edits unsaved: paste a new S between the two S!', async t => {
  const one = card('Same', 'same', details(A)), raw = one + card('Same', 'same', details(B)) + card('Same', 'same', details(C)) + card('Same', 'same', details('c-44444444444444444444444444444444')) + card('Same', 'same', details('c-55555555555555555555555555555555'));
  const h = await text867(t, raw); let v = h.p.text.value;
  let x = v.lastIndexOf('same') + 4; h.input(x, x, '!'); v = h.p.text.value; x = v.lastIndexOf('same\n', v.lastIndexOf('same!') - 1) + 4; h.input(x, x, '!');
  v = h.p.text.value; const at = v.lastIndexOf('## Same');
  const rows = h.input(at, at, '## Same\n\nsame\n\n', 'insertFromPaste');
  console.log('LP4 pasted ', show(rows), dupes(rows) ? 'DUPLICATE ID' : '');
  assert.equal(dupes(rows), false, 'no two cards may carry the same id');
});
test('LP5 pure module: preferred anchor (1,1) versus a later signature match to base 0', () => {
  const p = new CardTextProjection(); const text = p.show(card('Same', 'same', details(A)) + card('Same', 'same', details(B, 'rose')));
  const renamed = text.replace('## Same', '## Other'); p.edit(renamed, { start: 3, end: 7 });
  console.log('LP5 pairs after rename', p.body);
  const out = p.edit(renamed + '## Same\n\nsame\n\n', { start: renamed.length, end: renamed.length });
  console.log('LP5 pairs after paste ', p.body, show(metaOf(out)));
  assert.deepEqual(metaOf(out).map(r => r.id), [A, B, null]);
});

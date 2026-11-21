// Retained review source SHA256 7c80fc38635e27ef91e4faba166bb1575e7b711114e55afedece4dcb0f86209c; adaptations: docs/card-text-review-867.json.
import test from 'node:test';
import assert from 'node:assert/strict';
import { text867, card, details, A, B, C, metaOf, parseDeck } from './fixtures/card_text_867.mjs';
const show = rows => rows.map(r => `${r.title}:${r.id ? r.id.slice(2, 3) : '-'}/${r.color ?? '-'}`).join('  ');
const page = () => card('One', 'one', details(A)) + card('Two', 'two', details(B, 'rose')) + card('Three', 'three', details(C, 'green'));
for (const saved of [false, true]) test('RM1 rename Two, ' + (saved ? 'save confirms, ' : '') + 'then cut Two and paste it at the end', async t => {
  const h = await text867(t, page());
  let v = h.p.text.value, s = v.indexOf('## Two'); h.input(s + 3, s + 6, 'Deux');
  if (saved) await h.w.flush();
  v = h.p.text.value; s = v.indexOf('## Deux'); const e = v.indexOf('## Three'), clip = v.slice(s, e);
  h.input(s, e, '', 'deleteByCut'); v = h.p.text.value;
  const rows = h.input(v.length, v.length, clip, 'insertFromPaste');
  console.log('RM1 saved=' + saved, show(rows));
  assert.deepEqual(rows.map(r => r.id), [A, C, B]);
});
for (const saved of [false, true]) test('RM2 cut Two, paste at the end, ' + (saved ? 'save confirms, ' : '') + 'then rename it', async t => {
  const h = await text867(t, page());
  let v = h.p.text.value, s = v.indexOf('## Two'); const e = v.indexOf('## Three'), clip = v.slice(s, e);
  h.input(s, e, '', 'deleteByCut'); v = h.p.text.value; h.input(v.length, v.length, clip, 'insertFromPaste');
  if (saved) await h.w.flush();
  v = h.p.text.value; s = v.indexOf('## Two');
  const rows = h.input(s + 3, s + 6, 'Deux');
  console.log('RM2 saved=' + saved, show(rows));
  assert.deepEqual(rows.map(r => r.id), [A, C, B]);
});
for (const saved of [false, true]) test('RM3 edit Two words, ' + (saved ? 'save confirms, ' : '') + 'then Option-move it down past Three (whole-card move as one edit)', async t => {
  const h = await text867(t, page());
  let v = h.p.text.value, x = v.indexOf('two'); h.input(x + 3, x + 3, '!');
  if (saved) await h.w.flush();
  v = h.p.text.value; const s = v.indexOf('## Two'), e = v.indexOf('## Three');
  const rows = h.input(s, v.length, v.slice(e) + v.slice(s, e), 'insertText');
  console.log('RM3 saved=' + saved, show(rows));
  assert.deepEqual(rows.map(r => r.id), [A, C, B]);
});

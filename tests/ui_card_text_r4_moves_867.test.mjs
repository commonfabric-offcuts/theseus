// Retained review source SHA256 9d17a6e1d625139e5ec10f2960d355b3584daf296e3c27f8b60c868284af0080; adaptations: docs/card-text-review-867.json.
import test from 'node:test';
import assert from 'node:assert/strict';
import { text867, card, details, hidden, A, B, C, metaOf, parseDeck, cardDetails, stripDetails, CardTextProjection } from './fixtures/card_text_867.mjs';
const ID = n => 'c-' + String(n).repeat(32);
const D = ID(4), E = ID(5);
const show = rows => rows.map(r => `${r.title}:${r.id ? r.id.slice(2, 3) : '-'}/${r.aliases.map(a => a.slice(2, 3)).join('')}/${r.color ?? '-'}`).join('  ');
const page = () => card('Alpha', 'alpha', details(A)) + card('Beta', 'beta', details(B, 'rose')) + card('Gamma', 'gamma', details(C, 'green')) + card('Delta', 'delta', details(D)) + card('Eps', 'eps', details(E, 'blue'));
const parts = h => parseDeck(h.p.text.value).cards.map(c => c.raw);

test('R4-M1 move two adjacent cards (Delta+Eps) to the top in one paste, then type in Beta, save, type again', async t => {
  const h = await text867(t, page()); const q = parts(h);
  let rows = h.input(0, h.p.text.value.length, q[3] + q[4] + q[0] + q[1] + q[2], 'insertFromPaste');
  console.log('R4-M1 paste', show(rows)); assert.deepEqual(rows.map(r => r.id), [D, E, A, B, C]);
  const x = h.p.text.value.indexOf('beta') + 4; rows = h.input(x, x, '!');
  console.log('R4-M1 type ', show(rows)); assert.deepEqual(rows.map(r => r.id), [D, E, A, B, C]);
  await h.w.flush();
  const y = h.p.text.value.indexOf('gamma') + 5; rows = h.input(y, y, '!');
  console.log('R4-M1 after save', show(rows)); assert.deepEqual(rows.map(r => r.id), [D, E, A, B, C]);
});

test('R4-M2 move two NON-adjacent cards (Beta, Delta) to the end in one paste', async t => {
  const h = await text867(t, page()); const q = parts(h);
  const rows = h.input(0, h.p.text.value.length, q[0] + q[2] + q[4] + q[1] + q[3], 'insertFromPaste');
  console.log('R4-M2', show(rows)); assert.deepEqual(rows.map(r => r.id), [A, C, E, B, D]);
});

test('R4-M3 cut two cards, paste them at the top (two real steps), then edit one of the passed cards', async t => {
  const h = await text867(t, page()); let v = h.p.text.value;
  const s = v.indexOf('## Delta'), clip = v.slice(s);
  h.input(s, v.length, '', 'deleteByCut');
  let rows = h.input(0, 0, clip, 'insertFromPaste');
  console.log('R4-M3 paste', show(rows)); assert.deepEqual(rows.map(r => r.id), [D, E, A, B, C]);
  v = h.p.text.value; const x = v.indexOf('alpha') + 5; rows = h.input(x, x, '!');
  console.log('R4-M3 type ', show(rows)); assert.deepEqual(rows.map(r => r.id), [D, E, A, B, C]);
});

test('R4-M4 one paste: move Eps to the top AND rename Gamma', async t => {
  const h = await text867(t, page()); const q = parts(h);
  const rows = h.input(0, h.p.text.value.length, q[4] + q[0] + q[1] + q[2].replace('## Gamma', '## Gamma renamed') + q[3], 'insertFromPaste');
  console.log('R4-M4', show(rows)); assert.deepEqual(rows.map(r => r.id), [E, A, B, null, D]);
});

test('R4-M5 one paste: move Beta to the end AND rename it', async t => {
  const h = await text867(t, page()); const q = parts(h);
  const rows = h.input(0, h.p.text.value.length, q[0] + q[2] + q[3] + q[4] + q[1].replace('## Beta', '## Zeta'), 'insertFromPaste');
  console.log('R4-M5 (move+rename of the same card: words pair in the gap)', show(rows));
  assert.deepEqual(rows.map(r => r.id), [A, C, D, E, null]);
});

test('R4-M6 one paste: move Beta to the end AND edit its words (title kept)', async t => {
  const h = await text867(t, page()); const q = parts(h);
  const rows = h.input(0, h.p.text.value.length, q[0] + q[2] + q[3] + q[4] + q[1].replace('beta', 'beta edited'), 'insertFromPaste');
  console.log('R4-M6', show(rows));
  assert.deepEqual(rows.map(r => r.id), [A, C, D, E, null]);
});

test('R4-M7 move Alpha down past two, then save, then move it back up (round trip keeps all)', async t => {
  const h = await text867(t, page()); let q = parts(h);
  let rows = h.input(0, h.p.text.value.length, q[1] + q[2] + q[0] + q[3] + q[4], 'insertFromPaste');
  assert.deepEqual(rows.map(r => r.id), [B, C, A, D, E]);
  await h.w.flush(); q = parts(h);
  rows = h.input(0, h.p.text.value.length, q[2] + q[0] + q[1] + q[3] + q[4], 'insertFromPaste');
  console.log('R4-M7', show(rows)); assert.deepEqual(rows.map(r => r.id), [A, B, C, D, E]);
  await h.w.flush(); assert.equal(h.w.base.content.body, h.w.value.body);
});

test('R4-M8 swap two adjacent twins-by-title with different words, then edit one', async t => {
  const h = await text867(t, card('Notes', 'first notes', details(A)) + card('Notes', 'second notes', details(B, 'rose')) + card('Other', 'other', details(C)));
  const q = parts(h);
  let rows = h.input(0, h.p.text.value.length, q[1] + q[0] + q[2], 'insertFromPaste');
  console.log('R4-M8 swap', show(rows)); assert.deepEqual(rows.map(r => r.id), [B, A, C]);
  const x = h.p.text.value.indexOf('first notes') + 11; rows = h.input(x, x, '!');
  console.log('R4-M8 edit', show(rows)); assert.deepEqual(rows.map(r => r.id), [B, A, C]);
});

test('R4-M9 reverse the whole page order in one paste', async t => {
  const h = await text867(t, page()); const q = parts(h);
  const rows = h.input(0, h.p.text.value.length, q[4] + q[3] + q[2] + q[1] + q[0], 'insertFromPaste');
  console.log('R4-M9', show(rows)); assert.deepEqual(rows.map(r => r.id), [E, D, C, B, A]);
});

test('R4-M10 pure module: move + edit words of a passed card (LIS must keep the three unchanged)', () => {
  const p = new CardTextProjection(); const text = p.show(page());
  const q = parseDeck(text).cards.map(c => c.raw);
  const out = p.edit(q[4] + q[0] + q[1].replace('beta', 'beta!') + q[2] + q[3], { start: 0, end: text.length });
  console.log('R4-M10', show(metaOf(out))); assert.deepEqual(metaOf(out).map(r => r.id), [E, A, null, C, D]);
});

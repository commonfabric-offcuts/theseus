// Retained review source SHA256 ba30b935c8ca992f36ede8b5a8d7d94db590be7a21d09375991cfdad8f3fbf65; adaptations: docs/card-text-review-867.json.
import test from 'node:test';
import assert from 'node:assert/strict';
import { text867, card, details, hidden, A, B, C, metaOf, parseDeck, cardDetails, stripDetails, CardTextProjection } from './fixtures/card_text_867.mjs';
const crlf = s => s.replaceAll('\n', '\r\n');
const show = rows => rows.map(r => `${r.title}:${r.id ? r.id.slice(2, 3) : '-'}/${r.color ?? '-'}`).join('  ');
const endings = body => ({ crlf: (body.match(/\r\n/g) ?? []).length, lf: (body.match(/(?<!\r)\n/g) ?? []).length });

for (const shape of ['idless+identified', 'all idless', 'all identified']) test('R4-X1 CRLF page: type one char, native Undo back to untouched: ' + shape, async t => {
  const cards = shape === 'all idless' ? card('Old', 'no id', null) + card('Two', 'two', null)
    : shape === 'all identified' ? card('Old', 'no id', details(A)) + card('Two', 'two', details(B, 'rose'))
    : card('Old', 'no id', null) + card('Two', 'two', details(B, 'rose'));
  const raw = crlf('# Page\n\nopening\n\n' + cards);
  const h = await text867(t, raw); const at = h.p.text.value.indexOf('no id') + 5;
  h.input(at, at, '!');
  console.log(shape, 'typed:', JSON.stringify(endings(h.w.value.body)));
  h.input(at, at + 1, '', 'historyUndo');
  const after = h.w.value.body;
  console.log(shape, 'undone: dirty', h.w.dirty, 'endings', JSON.stringify(endings(after)), JSON.stringify(after));
  await h.w.flush();
  console.log(shape, 'saves written after undo-to-untouched:', h.calls.length);
  assert.equal(after, raw, 'undo back to the untouched page restores the exact base body');
  assert.equal(h.calls.length, 0, 'no revision for a page the person left as it was');
});

test('R4-X2 LF control: type one char, native Undo: nothing written', async t => {
  const raw = '# Page\n\nopening\n\n' + card('Old', 'no id', null) + card('Two', 'two', details(B, 'rose'));
  const h = await text867(t, raw); const at = h.p.text.value.indexOf('no id') + 5;
  h.input(at, at, '!'); h.input(at, at + 1, '', 'historyUndo'); await h.w.flush();
  assert.equal(h.w.value.body, raw); assert.equal(h.calls.length, 0);
});

test('R4-X3 CRLF page: one keystroke in an identified card: which cards lose CRLF?', async t => {
  const raw = crlf('# Page\n\nopening\n\n' + card('One', 'one', details(A)) + card('Idless', 'plain', null) + card('Two', 'two', details(B, 'rose')));
  const h = await text867(t, raw); const at = h.p.text.value.indexOf('two') + 3;
  h.input(at, at, '!');
  const body = h.w.value.body;
  console.log('R4-X3 opening CRLF?', body.startsWith('# Page\r\n'), '| One CRLF?', body.includes('## One\r\n'), '| Idless CRLF?', body.includes('## Idless\r\n'), '| Two (edited) CRLF?', body.includes('## Two\r\n'));
  console.log('R4-X3', JSON.stringify(body));
  assert.equal(stripDetails(body).replace(/\r\n/g, '\n'), h.p.text.value);
  assert.deepEqual(metaOf(body).map(r => r.id), [A, null, B]);
});

test('R4-X4 pure module: edit then edit back to the base text on a CRLF body with an id-less card', () => {
  const raw = crlf(card('Old', 'no id', null) + card('Two', 'two', details(B, 'rose')));
  const p = new CardTextProjection(); const text = p.show(raw); const at = text.indexOf('no id') + 5;
  p.edit(text.slice(0, at) + '!' + text.slice(at), { start: at, end: at });
  const back = p.edit(text, { start: at, end: at + 1 });
  console.log('R4-X4 back equals base?', back === raw, JSON.stringify(back));
  assert.equal(back, raw);
});

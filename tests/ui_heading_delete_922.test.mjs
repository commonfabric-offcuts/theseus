import test from 'node:test';
import assert from 'node:assert/strict';
import { CardTextProjection } from '../web/notebook-card-text.mjs';
import { applyAct, cardText, parseDeck } from '../web/deck.mjs';
import { cardDetails, detailLines, stripDetails } from '../web/card-details.mjs';
import { A, B, C, card, details, text867 } from './fixtures/card_text_867.mjs';

function remove(p, start, end) {
  const visible = p.text.slice(0, start) + p.text.slice(end);
  p.edit(visible, { start, end, inputType: 'deleteContentBackward', selection: [start, start] });
  assert.equal(p.text, visible, 'the exact visible deletion is preserved');
}
function mergedLine(raw) {
  const deck = parseDeck(raw);
  const result = applyAct(deck, { kind: 'merge', text: cardText(deck.cards[1]), step: -1, near: 1 });
  assert.ok(result, 'the real Cards merge supplies the metadata representation');
  return cardDetails(result.deck.cards[0].words).lines[0];
}
function checkMerged(body, expectedLine, third) {
  const deck = parseDeck(body);
  assert.equal(deck.cards.length, 2);
  const first = deck.cards[0];
  assert.equal(detailLines(first.words).length, 1, 'one hidden line in the merged card');
  assert.equal(cardDetails(first.words).lines[0], expectedLine, 'same metadata bytes as Cards');
  assert.ok(first.raw.trimEnd().endsWith(expectedLine), 'hidden line follows all merged words');
  assert.equal(deck.cards[1].raw, third, 'the following card keeps its exact bytes');
}

for (const nl of ['\n', '\r\n']) for (const upper of [details(A, 'blue'), null]) {
  const label = `${nl === '\n' ? 'LF' : 'CRLF'}, ${upper ? 'identified' : 'id-less'} survivor`;
  const third = card('Third', 'gamma', details(C)).replaceAll('\n', nl);
  const raw = (card('First', 'alpha', upper) + card('Second', 'beta', details(B, 'rose'))).replaceAll('\n', nl) + third;
  const expectedLine = mergedLine(raw);
  test(`922 selecting only the heading merges, with exact Undo/Redo (${label})`, () => {
    const p = new CardTextProjection(); p.show(raw);
    const at = p.text.indexOf('## Second');
    remove(p, at, at + '## Second'.length);
    checkMerged(p.body, expectedLine, third);
    const merged = p.body;
    assert.equal(p.undo().body, raw);
    assert.equal(p.undo(1).body, merged);
  });
  test(`922 Backspace through the heading merges and every Undo is exact (${label})`, () => {
    const p = new CardTextProjection(); p.show(raw);
    const at = p.text.indexOf('## Second'), snapshots = [raw];
    for (let n = '## Second'.length; n > 0; n--) {
      remove(p, at + n - 1, at + n);
      snapshots.push(p.body);
      if (n > 2) {
        assert.equal(parseDeck(p.body).cards.length, 3, 'a remaining ## heading is still its own card');
        assert.equal(cardDetails(parseDeck(p.body).cards[1].words).id, B);
      } else checkMerged(p.body, expectedLine, third);
    }
    for (let i = snapshots.length - 2; i >= 0; i--) assert.equal(p.undo().body, snapshots[i]);
    for (let i = 1; i < snapshots.length; i++) assert.equal(p.undo(1).body, snapshots[i]);
  });
}

test('922 deleting a heading with its newline still merges; whole-card deletion creates no alias', () => {
  const raw = card('First', 'alpha', details(A)) + card('Second', 'beta', details(B, 'rose')) + card('Third', 'gamma', details(C));
  const p = new CardTextProjection(); p.show(raw);
  const at = p.text.indexOf('## Second');
  remove(p, at, at + '## Second\n'.length);
  checkMerged(p.body, mergedLine(raw), parseDeck(raw).cards[2].raw);
  p.undo();
  remove(p, at, p.text.indexOf('## Third'));
  assert.deepEqual(parseDeck(p.body).cards.map(c => cardDetails(c.words).ids), [[A], [C]]);
  assert.equal(p.undo().body, raw);
});

test('922 removing one heading mark preserves a valid deeper heading', () => {
  const raw = card('First', 'alpha', details(A)) + card('Second', 'beta', details(B)).replace('## Second', '### Second');
  const p = new CardTextProjection(); p.show(raw);
  const at = p.text.indexOf('### Second');
  remove(p, at, at + 1);
  assert.deepEqual(parseDeck(p.body).cards.map(c => cardDetails(c.words).ids), [[A], [B]]);
  assert.equal(p.undo().body, raw);
});

test('922 real Notebook input saves one merged line and history restores both original cards', async t => {
  const raw = card('First', 'alpha', details(A)) + card('Second', 'beta', details(B, 'rose'));
  const h = await text867(t, raw), at = h.p.text.value.indexOf('## Second');
  h.input(at, at + '## Second'.length, '', 'deleteContentBackward');
  const merged = h.w.value.body;
  assert.equal(detailLines(merged).length, 1);
  assert.equal(detailLines(merged)[0].line, mergedLine(raw));
  assert.equal(h.p.text.value, stripDetails(merged));
  await h.w.flush();
  assert.equal(h.source().body, merged, 'the real writer persists the merged body');
  h.input(at, at, '', 'historyUndo');
  assert.equal(h.w.value.body, raw);
  await h.w.flush();
  assert.equal(h.source().body, raw, 'Undo persists both exact original cards');
  h.input(at, at, '', 'historyRedo');
  assert.equal(h.w.value.body, merged);
});

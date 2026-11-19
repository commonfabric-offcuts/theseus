import assert from 'node:assert/strict';

// Only measured values get a tolerance; card count, order and identity stay exact.
export function assertPencilPlace(before, after, positionTolerancePx) {
  assert.deepEqual(after.cards.map(([id]) => id), before.cards.map(([id]) => id), 'opening preserves the exact card identities and order');
  assert.ok(Math.abs(after.scroll - before.scroll) <= positionTolerancePx, 'opening preserves page scroll within the named position tolerance');
  for (let i = 0; i < before.cards.length; i++)
    assert.ok(Math.abs(after.cards[i][1] - before.cards[i][1]) <= positionTolerancePx, 'opening moves no feed card beyond the named position tolerance');
}

// Where an arrow nothing else used lands (item 301; docs/interaction.md, "The
// arrows everywhere"): the nearest control that way, by the geometry of what
// shows. The native checks (tests/outcome_rail_native.mjs, "arrows …") press
// the real keys on every screen.
import test from 'node:test';
import assert from 'node:assert/strict';
import { nearest, WAYS } from '../web/arrow-reach.mjs';

const box = (left, top, width = 40, height = 20) => ({ left, top, right: left + width, bottom: top + height });
const at = (name, ...where) => ({ el: name, box: box(...where) });

test('each arrow names one way, and only the four arrows do', () => {
  assert.deepEqual(WAYS, { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right' });
});

test('↓ and ↑ go to what is straight below or above before what is nearer but off to the side', () => {
  const from = box(100, 100);
  const list = [at('below', 100, 200), at('nearer-aside', 400, 130), at('above', 105, 20), at('same-row', 200, 100)];
  assert.equal(nearest(from, list, 'down'), 'below');
  assert.equal(nearest(from, list, 'up'), 'above');
  // Of two straight below, the nearer.
  assert.equal(nearest(from, [at('far', 100, 400), at('near', 90, 150)], 'down'), 'near');
  // Nothing that way: none, never what lies the other way or beside.
  assert.equal(nearest(from, [at('above', 100, 0), at('same-row', 200, 100)], 'down'), null);
  assert.equal(nearest(from, [], 'up'), null);
});

test('← and → keep to the row where something is beside, else go to the nearest that way', () => {
  const from = box(100, 100);
  const list = [at('beside', 300, 105), at('closer-below-right', 160, 160), at('left', 10, 100)];
  assert.equal(nearest(from, list, 'right'), 'beside', 'in the row, though another is nearer below');
  assert.equal(nearest(from, list, 'left'), 'left');
  // A row with nothing further right: the nearest to the right, in another row.
  assert.equal(nearest(from, [at('below-right', 200, 300), at('far-below-right', 600, 500)], 'right'), 'below-right');
  assert.equal(nearest(from, [at('left-only', 0, 100)], 'right'), null);
});

test('what holds the box, or lies inside it reaching no further that way, is never that way', () => {
  const from = box(100, 100, 200, 100);
  // A control drawn inside the card, below its middle, reaches no further down than the card.
  assert.equal(nearest(from, [at('inside', 120, 160, 40, 20)], 'down'), null);
  // A box around it (its section) neither.
  assert.equal(nearest(from, [at('around', 50, 50, 400, 300)], 'down'), null);
  // One overlapping its lower edge and reaching past it is below.
  assert.equal(nearest(from, [at('overlapping', 120, 190, 40, 30)], 'down'), 'overlapping');
});

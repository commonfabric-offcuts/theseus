import test from 'node:test';
import assert from 'node:assert/strict';
import { edgeWidth } from '../web/composer-width.mjs';

test('either edge follows its pointer by the same distance on both sides of the centre', () => {
  for (const [side, inward] of [['left', 16], ['right', -16]]) {
    const start = 1152, smaller = edgeWidth(start, inward, side, 760, 1232);
    assert.equal(smaller, 1120, `${side}: two sides shrink by 16`);
    assert.equal(edgeWidth(smaller, -inward, side, 760, 1232), start, `${side}: two sides grow by 16`);
    assert.equal(edgeWidth(start, 0, side, 760, 1232), start, 'no horizontal movement changes no width');
  }
});

test('width stays inside the phone and laptop bounds, including an outward drag beyond the screen', () => {
  for (const [start, min, max] of [[320, 280, 320], [375, 280, 375], [390, 280, 390], [1152, 760, 1152]]) {
    assert.equal(edgeWidth(start, 10000, 'left', min, max), min);
    assert.equal(edgeWidth(start, -10000, 'left', min, max), max);
    assert.equal(edgeWidth(start, -10000, 'right', min, max), min);
    assert.equal(edgeWidth(start, 10000, 'right', min, max), max);
  }
});

test('an invalid pointer or edge cannot set an invalid CSS width', () => {
  for (const [delta, side, min, max] of [[NaN, 'left', 280, 390], [Infinity, 'right', 280, 390], [16, 'top', 280, 390], [16, 'right', NaN, 390]]) {
    assert.equal(edgeWidth(320, delta, side, min, max), 320);
  }
});

import assert from 'node:assert/strict';
import test from 'node:test';
import { sameNotebookButtons } from './notebook_button_geometry.mjs';

const boxes = (y = 0) => [
  {words:'Text', x:995.0625, y, width:53.984375, height:36},
  {words:'Cards', x:1053.046875, y, width:66.515625, height:36},
  {words:'Draft', x:1123.5625, y, width:59.4375, height:36},
];
const copy = b => b.map(row => ({...row}));

// Actual original-layout controls in Checks 44147041641, retained at
// auditor/evidence/wake6613/train36-check-2/native/webkit-notebook/native.json.
for (const [name, from, to] of [
  ['laptop status column', 36.38232421875, 36.21875],
  ['phone status shares chips row', 66.469970703125, 66.390625],
  ['status width cap', 36.4559326171875, 36.3048095703125],
]) test(`item 642 comparison accepts recorded ${name} y drift`, () => {
  const before = boxes(from), after = boxes(to);
  if (name.startsWith('phone')) for (const rows of [before, after]) {
    rows.forEach((row, i) => {row.x = [16, 73.984375, 144.5][i]; row.height = 44;});
  }
  assert.equal(sameNotebookButtons(before, after), true);
  assert.equal(sameNotebookButtons(after, before), true);
});

test('item 642 comparison accepts identical two- and three-button controls', () => {
  for (const b of [boxes(), boxes().slice(0, 2)]) assert.equal(sameNotebookButtons(b, copy(b)), true);
});

test('item 642 comparison boundary accepts 0.17 and rejects above it in every dimension and direction', () => {
  for (const key of ['x', 'y', 'width', 'height']) for (const direction of [-1, 1]) {
    const before = boxes(); before[1][key] = 0.34;
    for (const [delta, expected] of [[0.17, true], [0.170001, false], [1, false]]) {
      const after = copy(before); after[1][key] += direction * delta;
      // A negative size is invalid as well as being outside the movement bound.
      assert.equal(sameNotebookButtons(before, after), expected, `${key} ${direction * delta}`);
    }
  }
});

test('item 642 comparison rejects missing, extra, reordered or relabelled buttons and wrong shapes', () => {
  const before = boxes();
  const wrong = [null, {}, [], boxes().slice(1), [...boxes(), {...boxes()[0]}], boxes().reverse(),
    boxes().map(b => ({...b, words:'Other'})), boxes().map(({height, ...b}) => b),
    boxes().map(b => ({...b, extra:1}))];
  for (const after of wrong) {
    assert.equal(sameNotebookButtons(before, after), false);
    assert.equal(sameNotebookButtons(after, before), false);
    assert.equal(sameNotebookButtons(after, after), false, 'equally malformed shapes also fail');
  }
  assert.equal(sameNotebookButtons(before, before.slice(0, 2)), false);
  const sparse = boxes(); delete sparse[1];
  assert.equal(sameNotebookButtons(sparse, sparse), false);
});

test('item 642 comparison rejects invalid numeric geometry on either side, even when identical', () => {
  for (const key of ['x', 'y', 'width', 'height']) {
    for (const value of [NaN, Infinity, -Infinity, undefined, null, '0', true]) {
      const invalid = boxes(); invalid[1][key] = value;
      assert.equal(sameNotebookButtons(invalid, boxes()), false, `${key}: ${String(value)}`);
      assert.equal(sameNotebookButtons(boxes(), invalid), false, `${key}: ${String(value)}`);
      assert.equal(sameNotebookButtons(invalid, invalid), false, `${key}: identical ${String(value)}`);
    }
  }
  for (const key of ['width', 'height']) for (const value of [0, -1]) {
    const invalid = boxes(); invalid[1][key] = value;
    assert.equal(sameNotebookButtons(invalid, invalid), false);
  }
});

test('item 642 frame sampler uses the same comparison when serialized into a browser', () => {
  const inBrowser = Function(`return (${sameNotebookButtons.toString()})`)();
  assert.equal(inBrowser(boxes(36.38232421875), boxes(36.21875)), true);
  assert.equal(inBrowser(boxes(), boxes(0.170001)), false);
  const invalid = boxes(); invalid[0].x = NaN;
  assert.equal(inBrowser(invalid, invalid), false);
});

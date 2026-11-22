import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyCaretPaint, assessCaretScroll } from './caret_paint_1074.mjs';

// Static oracle counterexamples only: no browser, caret or product red claim.
const clip = { x: 0, y: 0, width: 100, height: 100 }, exposed = { top: 0, bottom: 100 };
const bounds = (top, bottom) => ({ left: 20, right: 21, top, bottom });
const sample = fragment => ({ pageTop: 0, exposed, paint: classifyCaretPaint(fragment, clip, 20) });
for (const [name, fragment] of [['bottom [90,110] clipped to [90,100]', bounds(90, 100)], ['top [-10,10] clipped to [0,10]', bounds(0, 10)]])
  test('1074 oracle refuses full-visibility/least-scroll green from ' + name, () => {
    const after = sample(fragment), result = assessCaretScroll(sample(bounds(40, 60)), after);
    assert.equal(after.paint.status, 'uncertain'); assert.match(after.paint.reason, /clip edge/);
    assert.equal(result.status, 'uncertain'); assert.equal(result.leastPassed, null); assert.equal(result.visiblePassed, null);
  });
test('1074 a fully painted caret touching either clip edge remains conservatively uncertain', () => {
  for (const fragment of [bounds(0, 20), bounds(80, 100), bounds(1, 21), bounds(79, 99)])
    assert.equal(sample(fragment).paint.status, 'uncertain');
});
test('1074 interior native-paint bounds permit the visible/no-scroll control', () => {
  const result = assessCaretScroll(sample(bounds(30, 50)), sample(bounds(50, 70)));
  assert.equal(result.status, 'measured'); assert.equal(result.minimum, 0);
  assert.equal(result.leastPassed, true); assert.equal(result.visiblePassed, true);
});
test('1074 absent or ambiguous paint never supplies a visibility/minimum pass', () => {
  for (const fragment of [null, bounds(40, 44), { ...bounds(40, 60), right: 28 }]) {
    const result = assessCaretScroll(sample(bounds(20, 40)), sample(fragment));
    assert.equal(result.status, 'uncertain'); assert.equal(result.leastPassed, null); assert.equal(result.visiblePassed, null);
  }
});

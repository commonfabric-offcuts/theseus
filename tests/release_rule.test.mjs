import test from 'node:test';
import assert from 'node:assert/strict';
import { ReleaseRule } from './release-rule.mjs';

// The native harness's release rule, on the CDP events Chrome sends. The
// navigation harness case proves the wiring on real requests; these hold
// every outcome of the rule.
const REFUSED = 'Invalid InterceptionId';
const sent = (requestId, loaderId) => ({ method: 'Network.requestWillBeSent', params: { requestId, loaderId } });
const navigated = (loaderId, parentId) => ({ method: 'Page.frameNavigated', params: { frame: { loaderId, ...(parentId ? { parentId } : {}) } } });
const response = requestId => ({ method: 'Network.responseReceived', params: { requestId } });
const finished = requestId => ({ method: 'Network.loadingFinished', params: { requestId } });
const failed = (requestId, canceled) => ({ method: 'Network.loadingFailed', params: { requestId, canceled } });
const failure = networkId => ({ message: REFUSED, networkId });

function rule(...events) {
  const errors = [], r = new ReleaseRule({ failed: f => errors.push(f) });
  r.observe(navigated('L1'));
  for (const event of events) r.observe(event);
  return { r, errors, outcome: id => ({ excused: r.excused.filter(f => f.networkId === id).map(f => f.reason), failed: r.failed.filter(f => f.networkId === id).length, unsettled: r.unsettled.has(id) }) };
}

test('a refusal for a request the page cancelled is excused, and one for a request that failed otherwise is not', () => {
  const f = rule(sent('a', 'L1'), failed('a', true), sent('b', 'L1'), failed('b', false));
  f.r.refused(failure('a'), REFUSED); f.r.refused(failure('b'), REFUSED);
  assert.deepEqual(f.outcome('a'), { excused: ['cancelled'], failed: 0, unsettled: false });
  assert.deepEqual(f.outcome('b'), { excused: [], failed: 1, unsettled: false }, 'a failed load reached the page');
  assert.deepEqual(f.errors.map(e => e.networkId), ['b']);
});

test('a refusal for a request whose document was already replaced is excused at once', () => {
  const f = rule(sent('a', 'L1'), navigated('L2'));
  f.r.refused(failure('a'), REFUSED);
  assert.deepEqual(f.outcome('a'), { excused: ['document replaced'], failed: 0, unsettled: false });
  assert.deepEqual(f.errors, []);
});

test('a refusal nothing explains yet waits, and the page\'s next report on it settles it either way', () => {
  for (const [later, outcome] of [
    [navigated('L2'), { excused: ['document replaced'], failed: 0, unsettled: false }],
    [failed('a', true), { excused: ['cancelled'], failed: 0, unsettled: false }],
    [response('a'), { excused: [], failed: 1, unsettled: false }],
    [finished('a'), { excused: [], failed: 1, unsettled: false }],
    [failed('a', false), { excused: [], failed: 1, unsettled: false }],
  ]) {
    const f = rule(sent('a', 'L1'));
    f.r.refused(failure('a'), REFUSED);
    assert.deepEqual(f.outcome('a'), { excused: [], failed: 0, unsettled: true }, 'not yet explained');
    f.r.observe(later);
    assert.deepEqual(f.outcome('a'), outcome, later.method);
    assert.equal(f.errors.length, outcome.failed);
  }
});

test('a request whose response reached the page is a failure, even once its document is replaced or it is cancelled', () => {
  const f = rule(sent('a', 'L1'), response('a'), navigated('L2'), sent('b', 'L2'), response('b'), failed('b', true));
  f.r.refused(failure('a'), REFUSED); f.r.refused(failure('b'), REFUSED);
  assert.deepEqual(f.outcome('a'), { excused: [], failed: 1, unsettled: false });
  assert.deepEqual(f.outcome('b'), { excused: [], failed: 1, unsettled: false });
});

test('only a replaced main-frame document excuses: not a subframe, not the document now shown, not an unknown loader', () => {
  const f = rule(sent('frame', 'F1'), sent('next', 'L2'), sent('unknown'), navigated('F2', 'main'), navigated('L2'));
  for (const id of ['frame', 'next', 'unknown']) f.r.refused(failure(id), REFUSED);
  for (const id of ['frame', 'next', 'unknown']) assert.deepEqual(f.outcome(id), { excused: [], failed: 0, unsettled: true }, id);
  f.r.observe(navigated('L2'));
  assert.equal(f.outcome('next').unsettled, true, 'the same document navigated again is not replaced');
  assert.deepEqual(f.errors, []);
});

test('a subframe navigating does not replace the main document its requests came from', () => {
  const f = rule(sent('a', 'L1'));
  f.r.refused(failure('a'), REFUSED);
  f.r.observe(navigated('F2', 'L1'));
  assert.deepEqual(f.outcome('a'), { excused: [], failed: 0, unsettled: true }, 'the main document is still L1');
  f.r.observe(navigated('L2'));
  assert.deepEqual(f.outcome('a'), { excused: ['document replaced'], failed: 0, unsettled: false });
});

test('any other refused release is a failure at once', () => {
  const f = rule(sent('a', 'L1'), navigated('L2'));
  f.r.refused(failure('a'), 'Some other protocol error');
  f.r.refused({ message: REFUSED }, REFUSED);
  assert.equal(f.r.failed.length, 2); assert.equal(f.errors.length, 2);
  assert.deepEqual([f.r.excused, f.r.unsettled.size], [[], 0]);
});

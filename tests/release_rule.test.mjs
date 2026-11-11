import test from 'node:test';
import assert from 'node:assert/strict';
import { ReleaseRule } from './release-rule.mjs';

// The native harness's release rule, on the CDP events Chrome sends. The
// navigation harness case proves the wiring on real requests; these hold
// every outcome of the rule.
const REFUSED = 'Invalid InterceptionId';
const sent = (requestId, loaderId) => ({ method: 'Network.requestWillBeSent', params: { requestId, loaderId } });
const navigated = (loaderId, parentId) => ({ method: 'Page.frameNavigated', params: { frame: { id: parentId ? 'sub' : 'main', loaderId, ...(parentId ? { parentId } : {}) } } });
// A response paused with no networkId, as Chrome pauses one while the main-frame document is being replaced.
const paused = (requestId, { frameId = 'main', resourceType = 'XHR' } = {}) => ({ method: 'Fetch.requestPaused', params: { requestId, frameId, resourceType, responseStatusCode: 503 } });
const unnamed = requestId => ({ message: REFUSED, requestId, networkId: undefined });
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

test('a refusal for a pause with no networkId is excused once the main-frame document it paused under is replaced, before or after the refusal', () => {
  // Chrome's order: the reload starts, the old document's response pauses with no networkId, the new document commits, the release is refused.
  const after = rule(paused('job-1'), navigated('L2'));
  after.r.refused(unnamed('job-1'), REFUSED);
  assert.deepEqual([after.r.excused.map(f => [f.requestId, f.reason]), after.r.failed.length, after.r.unsettled.size], [[['job-1', 'document replaced']], 0, 0]);
  const before = rule(paused('job-1'));
  before.r.refused(unnamed('job-1'), REFUSED);
  assert.deepEqual([before.r.excused, before.r.failed.length, before.r.unsettled.has('job-1')], [[], 0, true], 'not yet explained');
  before.r.observe(navigated('L1'));
  assert.equal(before.r.unsettled.has('job-1'), true, 'the same document navigating again does not replace it');
  before.r.observe(response('job-1')); before.r.observe(finished('job-1'));
  assert.equal(before.r.unsettled.has('job-1'), true, 'a network report under the same id is no report on a pause Chrome named no request for');
  before.r.observe(navigated('L2'));
  assert.deepEqual([before.r.excused.map(f => f.reason), before.r.failed.length, before.r.unsettled.size, before.errors], [['document replaced'], 0, 0, []]);
});

test('a refusal for a pause with no networkId is not excused when it paused under the document now shown, in a subframe, for a navigation, or unseen', () => {
  const f = rule(navigated('L2'), paused('now'), paused('other'), paused('frame', { frameId: 'sub' }), paused('navigation', { resourceType: 'Document' }));
  f.r.refused(unnamed('now'), REFUSED);
  assert.deepEqual([f.r.excused, f.r.unsettled.has('now')], [[], true], 'paused under L2, which is still shown');
  for (const id of ['frame', 'navigation', 'unseen']) f.r.refused(unnamed(id), REFUSED);
  assert.deepEqual(f.errors.map(e => e.requestId), ['frame', 'navigation', 'unseen'], 'failures at once');
  f.r.refused(unnamed('other'), 'Some other protocol error');
  assert.deepEqual(f.errors.map(e => e.requestId), ['frame', 'navigation', 'unseen', 'other'], 'any other refusal of a noted pause fails at once');
  f.r.observe(navigated('L3'));
  assert.deepEqual(f.r.excused.map(e => [e.requestId, e.reason]), [['now', 'document replaced']], 'only the refusal waiting on L2 settles when L2 is replaced');
});

test('a pause before any main-frame document is known excuses nothing', () => {
  const r = new ReleaseRule(), errors = [];
  r.onFailed = f => errors.push(f);
  r.observe(paused('early'));
  r.observe(navigated('L1')); r.observe(navigated('L2'));
  r.refused(unnamed('early'), REFUSED);
  assert.deepEqual([r.excused, errors.map(e => e.requestId)], [[], ['early']]);
});

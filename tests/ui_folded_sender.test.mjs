// Source contract only. Actual painting and native gestures belong to native-compose.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('item 793 lets only the folded sender shrink and ellipsize, keeping the cue whole', async () => {
  const css = await readFile(new URL('../web/stack-look.css', import.meta.url), 'utf8');
  const selector = '.message-card[data-folded=true]>.message-folded>.folded-author';
  const rule = css.slice(css.indexOf(selector)).split('}')[0];
  assert.ok(css.includes(selector), 'a narrowly scoped folded sender rule exists');
  for (const declaration of ['flex:0 1 auto', 'min-width:0', 'overflow:hidden', 'text-overflow:ellipsis'])
    assert.ok(rule.includes(declaration), `folded sender keeps ${declaration}`);
  assert.ok(css.includes('.folded-author{flex:none;'), 'earlier-row sender keeps its existing rule');
  assert.ok(css.includes('.folded-cue{flex:none;'), 'Folded keeps its room');
});

import { assertGeometry648, assertRestored793, inspect648 } from './compose_swipe_648.mjs';
const good = () => ({ width: 320, overflow: 0, targets: [{ id: 'reader-close', width: 44, height: 44 }],
  folded793: { row: { left: 35, right: 285, width: 250 },
    author: { left: 35, right: 205, width: 170, text: 'fixture-notebook-agent', textOverflow: 'ellipsis', overflowX: 'hidden', minWidth: '0px', flexShrink: '1' },
    cue: { left: 222, right: 285, width: 63, text: 'Folded', flexShrink: '0', whiteSpace: 'nowrap' } } });
const options = { touch: true, sender: 'fixture-notebook-agent' };

test('item 793 retains the original 3px red and the 2px geometry boundary', () => {
  assertGeometry648(good(), options);
  const original = good(); original.overflow = 3; original.folded793.cue.right = 322.921875;
  assert.throws(() => assertGeometry648(original, options), /page overflow <= 2px, got 3/);
  const cue = good(); cue.folded793.cue.right += 3;
  assert.throws(() => assertGeometry648(cue, options), /EDGE_TOLERANCE_PX=2/);
  const small = good(); small.targets[0].height = 42;
  assert.throws(() => assertGeometry648(small, options), /named 1px tolerance/);
});

test('item 793 restoration uses its named half-pixel tolerance', () => {
  assertRestored793(good(), good());
  const changed = good(); changed.folded793.cue.width += 1;
  assert.throws(() => assertRestored793(good(), changed), /RESTORE_TOLERANCE_PX=0.5/);
});

test('item 793 primary geometry survives independent layout and screenshot capture failures', async () => {
  const layout = good(); layout.overflow = 3;
  let receipt, attempts = [];
  await assert.rejects(() => inspect648({ measure: async () => layout, validate: m => assertGeometry648(m, options),
    layoutFile: async () => { attempts.push('layout'); throw Error('JSON capture injected'); },
    picture: async () => { attempts.push('picture'); throw Error('screenshot injected'); }, resultFile: async r => { receipt = r; } }),
  error => { assert.match(error.message, /page overflow <= 2px, got 3/); assert.equal(error.captureErrors.length, 2); return true; });
  assert.deepEqual(attempts, ['layout', 'picture']);
  assert.match(receipt.primaryError, /page overflow <= 2px, got 3/);
  assert.deepEqual(receipt.captureErrors.map(e => e.capture), ['layout', 'picture']);
});

test('item 793 capture failure alone fails a passing layout; restored captures pass', async () => {
  const io = { measure: async () => good(), validate: m => assertGeometry648(m, options), layoutFile: async () => {}, picture: async () => {}, resultFile: async () => {} };
  await assert.rejects(() => inspect648({ ...io, picture: async () => { throw Error('screenshot injected'); } }), /Geometry captures failed/);
  assert.deepEqual(await inspect648(io), good());
  await assert.rejects(() => inspect648({ ...io, measure: async () => { throw Error('measurement injected'); }, resultFile: async () => { throw Error('result write injected'); } }),
    error => { assert.equal(error.message, 'measurement injected'); assert.equal(error.captureErrors[0].capture, 'result'); return true; });
});

// Evidence-source checks only: no browser, product handler, or fixture server.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { stackChecks } from './stack_native.mjs';

test('item 655 evidence receipts include every changed runtime input in both engines', () => {
  for (const harness of ['reader_persistence_native', 'webkit_native']) {
    const declaration = readFileSync(new URL(`./${harness}.mjs`, import.meta.url), 'utf8').split('hashes[filename] =')[0];
    for (const input of ['web/app.mjs', 'web/app-session.mjs', 'web/reader.mjs', 'web/things-rail.mjs', 'web/topic-views.mjs', 'aim_next/stacks.py', 'tests/stack_native.mjs'])
      assert.ok(declaration.includes(`'${input}'`), `${harness} receipt omits ${input}`);
  }
});

test('item 655 touch measurement accepts subpixel jitter and rejects a moved target', () => {
  const source = readFileSync(new URL('./topic_reading_native.mjs', import.meta.url), 'utf8');
  const expression = source.match(/same=(.*),\n      look=/)[1];
  const same = vm.runInNewContext(`(${expression})`, { tapStableTolerancePx: 0.5 });
  const box = { x: 12, y: 20, width: 44, height: 44 };
  assert.equal(same(box, { ...box, y: 20.25 }), true, 'tapStableTolerancePx admits 0.25px engine rounding');
  assert.equal(same(box, { ...box, y: 22 }), false, 'a 2px moving-target mutant still fails');
  assert.equal(same(null, box), false);
});

test('item 655 native state proof includes membership late answers abandonment and refused departure', () => {
  const source = readFileSync(new URL('./stack_native.mjs', import.meta.url), 'utf8');
  for (const state of ['B1-loaded', 'B2-late', 'B3-abandoned', 'B3-recovered', 'B4-dismissed', 'B4-refused'])
    assert.ok(source.includes(`'${state}'`), `${state} has no native state observation/assertion`);
});

test('item 655 selection retains all 44 own cases per engine without executing a browser', async () => {
  for (const engine of ['chrome', 'webkit']) {
    const names = [];
    await stackChecks({ engine, facts: { actor: 'fixture-person' }, observations: [], check: async name => { if (name.includes('item 655')) names.push(name); } }, {});
    assert.equal(names.length, 44, engine + ': original 16 plus 28 review cases');
    for (const width of [320, 375, 390, 1280]) assert.equal(names.filter(name => name.includes(`at ${width}:`)).length, 11, engine + ': complete width ' + width);
  }
});

test('item 655 capture refuses an actual unfinished animation and translucent endpoint', async () => {
  const { qualifyDialogCapture655 } = await import('./stack_native.mjs');
  const settled = { open: true, animations: [], opacity: 1 };
  assert.equal(qualifyDialogCapture655(settled), true);
  assert.equal(qualifyDialogCapture655({ ...settled, animations: ['paused'] }), false, 'paused appear control cannot qualify');
  assert.equal(qualifyDialogCapture655({ ...settled, animations: ['running'] }), false, 'still fading control cannot qualify');
  assert.equal(qualifyDialogCapture655({ ...settled, opacity: .4 }), false, 'a translucent surface cannot qualify');
  const source = readFileSync(new URL('./stack_native.mjs', import.meta.url), 'utf8');
  assert.match(source, /await animation\.finished/, 'wait for actual animation completion');
  assert.match(source, /const settled = await settleCapture655\(p\);[\s\S]*?await shot\(p, image\)/, 'all qualifying item captures use the settlement barrier');
});

test('item 655 capture waits for completion rather than a timer or an opaque intermediate frame', async () => {
  const { settleDialogCapture655 } = await import('./stack_native.mjs');
  let complete;
  const animation = { playState: 'running', finished: new Promise(resolve => { complete = resolve; }) };
  const dialog = { open: true, getAnimations: () => [animation] };
  let frames = 0, done = false;
  const p = { evaluate: code => vm.runInNewContext(code, {
    document: { querySelector: () => dialog },
    getComputedStyle: () => ({ opacity: '1' }),
    requestAnimationFrame: resolve => { frames++; resolve(); },
  }) };
  const waiting = settleDialogCapture655(p).then(() => { done = true; });
  await Promise.resolve();
  assert.equal(done, false, 'opaque but still animating cannot qualify');
  assert.equal(frames, 0, 'frame qualification follows animation.finished');
  animation.playState = 'finished'; complete();
  await waiting;
  assert.equal(done, true);
  assert.equal(frames, 1);
});

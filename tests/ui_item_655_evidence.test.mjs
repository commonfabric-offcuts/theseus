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

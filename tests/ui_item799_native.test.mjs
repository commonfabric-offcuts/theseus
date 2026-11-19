import test from 'node:test';
import assert from 'node:assert/strict';
import { readingChecks } from './topic_reading_native.mjs';
import { assertDossier799Geometry } from './stack_native.mjs';

test('799 dry-enumerates actual reading entrypoint to exactly eight device/theme cases per engine', async () => {
  for (const engine of ['chrome', 'webkit']) {
    const names = [];
    await readingChecks({ engine, facts: { actor: 'fixture-person' }, observations: [],
      check: async name => { if (/^reading item 799/.test(name)) names.push(name); } });
    assert.equal(names.length, 8);
    for (const device of ['phone-320', 'phone-375', 'phone', 'laptop']) for (const theme of ['light', 'dark'])
      assert.ok(names.some(name => name.endsWith(`at ${device} ${theme}`)));
    console.log(JSON.stringify({ engine, selector: '^reading item 799', count: names.length, cases: names }));
  }
});
test('799 native enclosure predicate admits rounding but rejects each crossing axis and overflow', () => {
  const at = { folder: { left: 12, right: 310 }, head: { bottom: 70 }, reply: { left: 11.5, right: 310.5, top: 69.5 }, pageRight: 320.5, width: 320 };
  assertDossier799Geometry(at);
  for (const bad of [
    { ...at, reply: { ...at.reply, left: 0 } },
    { ...at, reply: { ...at.reply, right: 350 } },
    { ...at, reply: { ...at.reply, top: 50 } },
    { ...at, pageRight: 340 }]) assert.throws(() => assertDossier799Geometry(bad), { name: 'AssertionError' });
});

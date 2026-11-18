import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
function restart(which, control, facts) {
  const s = readFileSync(new URL('./whisper_outline_native.mjs', import.meta.url), 'utf8');
  const begin = s.indexOf('  const restart = async () => {', s.indexOf(`export async function whisperOutline${which}(`));
  const end = s.indexOf('\n  };', begin) + '\n  };'.length;
  assert.ok(begin > 0 && end > begin);
  return new Function('assert', 'control', 'facts', `${s.slice(begin, end)};return restart;`)(assert, control, facts);
}
for (const which of ['Reading', 'Compose']) {
  test(`${which} restart retains returned metadata in the adapters' existing mutable facts`, async () => {
    const facts = { origin: 'https://isolated.invalid', token: 'synthetic-old' }, calls = [];
    const control = async ({ method }) => { calls.push(method); return { origin: facts.origin, token: 'synthetic-new' }; };
    await restart(which, control, facts)();
    assert.deepEqual(calls, ['server_stop', 'server_start']);
    assert.equal(facts.token, 'synthetic-new');
  });
  test(`${which} rejects wrong origin and absent metadata before changing facts`, async () => {
    for (const response of [{ origin: 'https://other.invalid', token: 'synthetic-new' }, { origin: 'https://isolated.invalid' }]) {
      const facts = { origin: 'https://isolated.invalid', token: 'synthetic-old' };
      await assert.rejects(restart(which, async () => response, facts)(), assert.AssertionError);
      assert.equal(facts.token, 'synthetic-old');
    }
  });
}

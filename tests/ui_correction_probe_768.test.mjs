// Execute the actual --correction probe below the browser. CDP replies are a
// bounded protocol peer; this tests target ownership/cleanup, not URL reachability.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
const source = readFileSync(new URL('./reader_persistence_native.mjs', import.meta.url), 'utf8');
const start = source.indexOf('      const readable = async (p, url) => {');
const end = source.indexOf('\n      // Source 1 answers Source 0', start);
assert.ok(start >= 0 && end > start, 'extract the actual correction probe');
const declaration = source.slice(start, end);
for (const outcome of [true, false, 'failure']) {
  test(`item 768 actual correction probe cleans up its target on ${outcome}`, async () => {
    const calls = [], pages = new Set();
    const cdp = async (method, args, session) => {
      calls.push({method, args, session});
      if (method === 'Target.createTarget') return {targetId:'owned-probe'};
      if (method === 'Target.attachToTarget') return {sessionId:'probe-session'};
      if (method === 'Runtime.evaluate') {
        if (args.expression.startsWith('fetch(')) {
          if (outcome === 'failure') throw Error('probe fetch failed');
          return {result:{value:outcome}};
        }
        return {result:{value:true}};
      }
      return {};
    };
    const context = vm.createContext({cdp, pages, facts:{origin:'https://isolated.invalid'}, until:async probe => {
      assert.equal(await probe(), true); return true;
    }});
    const readable = vm.runInContext(declaration + '\nreadable', context);
    if (outcome === 'failure') await assert.rejects(readable(null,'blob:fixture'), /probe fetch failed/);
    else assert.equal(await readable(null,'blob:fixture'), outcome);
    assert.equal(pages.size,0,'owned probe removed from cleanup ledger');
    assert.deepEqual(calls.filter(call=>call.method==='Target.closeTarget').map(call=>({...call.args})),[{targetId:'owned-probe'}]);
    assert.equal(calls.filter(call=>call.method==='Target.disposeBrowserContext').length,0,'probe owns no context');
  });
}

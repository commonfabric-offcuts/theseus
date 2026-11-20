// Actual HTTP adapter/build graph, isolated stores and Chrome for Testing.
// Usage: node FILE CHROME PLAYWRIGHT BEFORE_SOURCE AFTER_SOURCE OUTPUT
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { createInterface } from 'node:readline';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const [chrome, playwright, before, after, out] = process.argv.slice(2);
assert.ok(chrome?.endsWith('/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing'));
for (const value of [playwright, before, after, out]) assert.ok(path.isAbsolute(value));
const { chromium } = createRequire(import.meta.url)(playwright);
await mkdir(out, { recursive: true });
const fixture = fileURLToPath(new URL('./fixtures/static_cache_904.py', import.meta.url));
const results = [], runtimes = [];
let browser;

async function world(source, name) {
  const argv = ['-I', '-X', `pycache_prefix=${path.join(out, `cache-${name}`)}`, fixture, source];
  const child = spawn('/usr/bin/python3', argv, { stdio: ['pipe', 'pipe', 'pipe'] });
  let stderr = ''; child.stderr.on('data', bytes => { stderr += bytes; });
  const exit = new Promise(resolve => child.once('exit', (code, signal) => resolve({ code, signal })));
  const lines = createInterface({ input: child.stdout })[Symbol.asyncIterator]();
  const read = async () => {
    const value = await lines.next(); assert.equal(value.done, false, stderr); return JSON.parse(value.value);
  };
  const ready = await read(); runtimes.push({ name, argv: ['/usr/bin/python3', ...argv], ...ready });
  let id = 0;
  return { ...ready,
    async call(method) { child.stdin.write(JSON.stringify({ id: ++id, method }) + '\n'); const value = await read(); assert.equal(value.id, id); return value.answer; },
    async close() { child.stdin.end(); const result = await exit; await writeFile(path.join(out, `${name}-fixture-stderr.log`), stderr); assert.deepEqual(result, { code: 0, signal: null }); }
  };
}

try {
  browser = await chromium.launch({ executablePath: chrome, headless: true });
  for (const [name, source] of [['before', before], ['after', after]]) {
    const fixture = await world(source, name), context = await browser.newContext();
    try {
      for (const phase of name === 'after' ? ['cold', 'warm', 'changed'] : ['cold', 'warm']) {
        if (phase === 'changed') await fixture.call('revision');
        await fixture.call('reset');
        const page = await context.newPage(), errors = [];
        page.setDefaultTimeout(15000);
        page.on('pageerror', error => errors.push(error.message));
        const start = performance.now();
        await page.goto(fixture.origin, { waitUntil: 'load' });
        await page.waitForFunction(() => document.body.dataset.ready === 'true');
        const readyMs = performance.now() - start;
        // Keep the ready time separate from the settled request inventory.
        await page.waitForLoadState('networkidle');
        const performanceEntries = await page.evaluate(() => ({ navigation: performance.getEntriesByType('navigation').map(x => x.toJSON()), resources: performance.getEntriesByType('resource').map(x => x.toJSON()) }));
        const answer = await fixture.call('requests');
        const api = answer.requests.filter(r => r.path.startsWith('/api/'));
        const assets = answer.requests.filter(r => !r.path.startsWith('/api/') && /\.(mjs|js|css)(?:\?|$)/.test(r.path));
        const observation = { name, phase, readyMs, ...answer, apiCount: api.length, assetCount: assets.length, errors, performance: performanceEntries };
        results.push(observation);
        await writeFile(path.join(out, `${name}-${phase}.json`), JSON.stringify(observation, null, 2));
        console.log(JSON.stringify({ name, phase, readyMs, requests: answer.requests.length, apiCount: api.length, assetCount: assets.length }));
        assert.deepEqual(errors, []);
        assert.ok(answer.requests.some(r => r.path === '/' && r.status === 200), 'fresh index');
        if (name === 'after' && phase === 'warm') assert.equal(assets.length, 0, 'same build uses cached modules and CSS');
        else assert.ok(assets.length > 0, 'cold/old/changed build actually fetches code');
        if (phase === 'changed') {
          const old = results.find(r => r.name === 'after' && r.phase === 'cold');
          assert.notEqual(answer.stamp, old.stamp);
          assert.ok(assets.every(r => r.path.startsWith(`/b/${answer.stamp}/`)), 'new graph has new URLs');
          assert.equal(await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--cache-904-revision').trim()), 'second');
        }
        await page.close();
      }
    } finally { await context.close(); await fixture.close(); }
  }
} finally {
  if (browser) await browser.close(); // Browser.close, never a signal.
  await writeFile(path.join(out, 'results.json'), JSON.stringify({ chrome, playwright, runtimes, results }, null, 2));
}

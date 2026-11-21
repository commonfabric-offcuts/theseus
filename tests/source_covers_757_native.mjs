// Retained 757 cases, current native gestures, strict engine/source and cleanup proof.
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, writeFile, rm, access } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import net from 'node:net';
import { fixtureControl } from './fixture_control.mjs';
import { readingItem757Checks } from './reading_item_757_native.mjs';

const playwright = await import(process.env.AIM_PLAYWRIGHT_CORE);
const engine = process.env.AIM_ENGINE ?? 'chromium', evidence = process.argv[2];
await mkdir(evidence, { recursive: true });
const fixture = spawn('/usr/bin/python3', ['-B', 'tests/fixtures/ui_http.py', '--freshness', '--live', '--other-person', '--agent-colors']);
const { control, exit, errors } = fixtureControl(fixture);
const owned = new Set(), fixtureOwned = new Set([fixture.pid]), contexts = new Set();
const results = [], observations = [], cleanup = {}, hashes = {};
const ps = () => execFileSync('/bin/ps', ['-axo', 'pid=,ppid=,command='], { encoding: 'utf8' }).trim().split('\n').map(line => {
  const [, pid, ppid, command] = line.match(/^\s*(\d+)\s+(\d+)\s+(.*)$/); return { pid: +pid, ppid: +ppid, command };
});
function descendants(set) {
  const list = ps();
  for (let changed = true; changed;) {
    changed = false;
    for (const p of list) if (set.has(p.ppid) && !set.has(p.pid)) { set.add(p.pid); changed = true; }
  }
}
const until = async (probe, words) => {
  const deadline = Date.now() + 6500;
  while (Date.now() < deadline) { const answer = await probe(); if (answer) return answer; await new Promise(r => setTimeout(r, 25)); }
  throw Error('Timed out: ' + words);
};
let browser, profile, origin, fatal;
try {
  const facts = await control({ method: 'ready' }); origin = facts.origin; descendants(fixtureOwned);
  for (const file of ['aim_next/source_item_covers.py', 'aim_next/stacks.py', 'aim_next/store.py', 'aim_next/migrations.py',
    'web/dossier-cover.mjs', 'web/stack-order.mjs', 'web/reader.mjs', 'web/stack-feed.mjs']) {
    hashes[file] = createHash('sha256').update(await readFile(file)).digest('hex');
  }
  profile = await mkdtemp(evidence + '/' + engine + '-profile-');
  const persistent = await playwright[engine].launchPersistentContext(profile, { headless: true,
    ...(engine === 'chromium' ? { executablePath: process.env.AIM_CHROME } : {}) });
  browser = persistent.browser();
  cleanup.engine = browser.browserType().name(); cleanup.version = browser.version(); assert.equal(cleanup.engine, engine);
  for (const p of ps()) if (p.command.includes(profile)) owned.add(p.pid);
  descendants(owned); assert.ok(owned.size);
  await writeFile(evidence + '/owned-start.json', JSON.stringify({ engine, profile, pids: [...owned], fixturePid: fixture.pid, origin }));
  const card = id => `#messages .message-card[data-id="${id}"]`;
  const centre = (p, selector) => p.native.locator(selector).scrollIntoViewIfNeeded();
  const press = (p, device, selector) => device === 'laptop' ? p.native.locator(selector).click() : p.native.locator(selector).tap();
  const view = async (name, args) => {
    const response = await fetch(origin + '/api/view', { method: 'POST', headers: {
      Authorization: 'Bearer ' + facts.token, Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify({ name, args }) });
    assert.equal(response.status, 200); const answer = await response.json(); assert.ok(!answer.error, JSON.stringify(answer.error)); return answer;
  };
  const open = async (key, device, topic, first, init, query, before) => {
    const context = await browser.newContext({ viewport: { width: device === 'laptop' ? 1280 : 390, height: 844 },
      hasTouch: device !== 'laptop', isMobile: device !== 'laptop' }); contexts.add(context);
    await context.addInitScript(init); const page = await context.newPage(); page.setDefaultTimeout(6500);
    const p = { native: page, errors: [], evaluate: expression => page.evaluate(expression),
      send: async (method, args) => {
        if (method === 'Emulation.setDeviceMetricsOverride') return page.setViewportSize({ width: args.width, height: args.height });
        if (method === 'Emulation.setEmulatedMedia') return page.emulateMedia({ colorScheme: args.features[0].value });
        throw Error('Unsupported native adapter call: ' + method);
      },
      close: async () => { descendants(owned); await context.close(); contexts.delete(context); } };
    page.on('pageerror', error => p.errors.push(error.message));
    if (before) await before(p);
    await page.goto(origin + (query ?? '/?topic=' + topic));
    await page.waitForFunction(() => document.body.dataset.ready === 'true');
    await page.locator(card(first)).waitFor();
    const app = await page.evaluate(() => [...document.scripts].find(s => s.src.includes('/app.mjs')).src);
    for (const file of ['dossier-cover.mjs', 'stack-order.mjs', 'reader.mjs', 'stack-feed.mjs']) {
      assert.deepEqual(await (await page.request.get(new URL('./' + file, app).href)).body(), await readFile('web/' + file), 'exact served ' + file);
    }
    return p;
  };
  const openReader = async (p, device, id, starts) => {
    const words = card(id) + ' > .message-preview';
    // Current cards use their first native press for inline writing; another
    // press opens the full Reader. No handler or product object is invoked.
    for (let attempt = 0; attempt < 2 && !await p.native.locator('#reader').evaluate(n => n.open); attempt++) await press(p, device, words);
    await p.native.locator('#reader[open]').waitFor();
    await until(() => p.native.locator('#source-body').textContent().then(text => text.startsWith(starts)), 'actual source in Reader');
  };
  const closeReader = async (p, device) => { await press(p, device, '#reader-close'); await until(() => p.native.locator('#reader').evaluate(n => !n.open), 'Reader closes'); };
  const shot = (p, key) => p.native.screenshot({ path: evidence + '/' + key + '.png' });
  const check = async (name, action) => {
    if (process.env.AIM_757_FILTER && !name.includes(process.env.AIM_757_FILTER)) return;
    let error; try { await action(); } catch (e) { error = e.stack; }
    for (const context of contexts) { descendants(owned); await context.close(); } contexts.clear();
    results.push({ name, error: error ?? null });
    await writeFile(evidence + '/observations.json', JSON.stringify({ results, observations }, null, 2));
  };
  await readingItem757Checks({ check, until, control, view, facts, shot, observations, engine: cleanup.engine },
    { open, centre, press, openReader, closeReader, card });
} catch (error) { fatal = error; }
finally {
  if (browser) { descendants(owned); await browser.close(); cleanup.browserClosed = !browser.isConnected(); }
  cleanup.ownedPids = [...owned]; cleanup.remainingOwned = ps().filter(p => owned.has(p.pid));
  cleanup.profileProcesses = profile ? ps().filter(p => p.command.includes(profile)) : [];
  if (profile && cleanup.browserClosed && !cleanup.remainingOwned.length && !cleanup.profileProcesses.length) {
    await rm(profile, { recursive: true }); cleanup.profileRemoved = await access(profile).then(() => false, () => true);
  }
  descendants(fixtureOwned); fixture.stdin.end(); cleanup.fixtureExit = await exit; cleanup.fixtureErrors = errors();
  cleanup.fixturePid = fixture.pid; cleanup.fixtureOwnedPids = [...fixtureOwned]; cleanup.remainingFixtureOwned = ps().filter(p => fixtureOwned.has(p.pid));
  if (origin) cleanup.portClosed = await new Promise(resolve => { const u = new URL(origin), socket = net.createConnection({ host: u.hostname, port: +u.port });
    socket.once('connect', () => { socket.destroy(); resolve(false); }); socket.once('error', () => resolve(true)); });
  await writeFile(evidence + '/results.json', JSON.stringify({ engine, filter: process.env.AIM_757_FILTER ?? null, hashes,
    results, observations, cleanup, fatal: fatal?.stack ?? null }, null, 2));
}
const fail = results.filter(r => r.error);
process.stdout.write(JSON.stringify({ engine, pass: results.length - fail.length, fail: fail.length, failures: fail,
  fatal: fatal?.stack ?? null, cleanup }, null, 2) + '\n');
if (fatal || fail.length || !cleanup.browserClosed || cleanup.remainingOwned.length || cleanup.profileProcesses.length ||
  !cleanup.profileRemoved || cleanup.fixtureExit.code !== 0 || cleanup.fixtureErrors || cleanup.remainingFixtureOwned.length || !cleanup.portClosed) process.exitCode = 1;

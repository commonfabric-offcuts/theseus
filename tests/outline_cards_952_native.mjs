// The pictured warm-home adoption, real loaded styles and native route clicks.
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { access, appendFile, cp, mkdir, writeFile } from 'node:fs/promises';
import net from 'node:net';
import { fixtureControl } from './fixture_control.mjs';
const { chromium } = await import(process.env.AIM_PLAYWRIGHT_CORE);
const evidence = process.argv[2]; await mkdir(evidence, { recursive: true });
const child = spawn('/usr/bin/python3', ['tests/fixtures/ui_http.py', '--freshness'], { cwd: process.env.AIM_952_ROOT ?? process.cwd() });
const { control, exit } = fixtureControl(child);
const records = [], failures = [], errors = [], marker = `theseus-952-${process.pid}`;
let browser, page, facts, profile;
const check = (key, name, act) => { try { act(); records.push({ key, name, pass: true }); } catch (error) { failures.push({ key, name, error: error.stack }); } };
const settled = () => page.waitForFunction(() => document.body.dataset.ready === 'true' && !document.documentElement.hasAttribute('data-rails-reading'));
const snapshot = () => {
  const box = el => { const r = el.getBoundingClientRect(), s = getComputedStyle(el); return { text: el.textContent, width: r.width, height: r.height, background: s.backgroundColor, radius: s.borderRadius, padding: s.padding, fontSize: s.fontSize, classes: el.className }; };
  const style = el => { let rules = 0, error = null; try { rules = el.sheet?.cssRules.length ?? 0; } catch (failure) { error = failure.name; } return { href: el.href, loaded: rules > 0, rules, error }; };
  return { url: location.href, styles: [...document.querySelectorAll('link[rel=stylesheet]')].map(style),
    outlineCards: [...document.querySelectorAll('#outline .outcome-topic-card')].map(box),
    mainCards: [...document.querySelectorAll('#outcome-page .outcome-topic-card')].map(box),
    railRows: [...document.querySelectorAll('#outline a.nav-item[data-topic-id]')].filter(el => el.getClientRects().length).map(box),
    topicParts: [...document.querySelectorAll('[id="topic-navigation"]')].map(el => ({ inOutline: !!el.closest('#outline'), parent: el.parentElement.className, listed: el.dataset.listed, classes: el.className })),
    feed: [...document.querySelectorAll('#messages .message-card:not([data-folded=true]):not([data-earlier=true])')].filter(el => el.getClientRects().length).map(box) };
};
const openOutcome = async () => {
  const disclosure = page.locator('.ol-outcome[data-workspace-id="w1"] .ol-disclosure'); await disclosure.waitFor();
  if (await disclosure.getAttribute('aria-expanded') !== 'true') await disclosure.click();
};
try {
  facts = await control({ method: 'ready' });
  await control({ method: 'navigation_topics', topics: [{ id: 't952a', title: 'Redesign pencil sheet' }, { id: 't952b', title: 'Notebook redesign' }] });
  browser = await chromium.launch({ executablePath: process.env.AIM_CHROME, headless: true, args: ['--enable-automation', `--${marker}`] });
  const cdp = await browser.newBrowserCDPSession(); profile = (await cdp.send('Browser.getBrowserCommandLine')).arguments.find(x => x.startsWith('--user-data-dir='))?.slice(16); assert.ok(profile); await cdp.detach();
  for (const look of ['Bookends', 'Paper']) {
    const key = `1280-dark-${look}`, responses = [];
    const context = await browser.newContext({ viewport: { width: 1280, height: 1000 }, colorScheme: 'dark' });
    page = await context.newPage(); page.setDefaultTimeout(10000); page.on('pageerror', error => errors.push({ key, error: error.message }));
    page.on('response', response => { if (/\.css(?:$|\?)/.test(response.url())) responses.push({ url: response.url(), status: response.status() }); });
    await page.goto(facts.origin + '/?workspace=w1'); await settled();
    await page.getByRole('button', { name: look, exact: true }).click(); await openOutcome();
    await page.locator('#outline a.nav-item[data-topic-id="t1"]').first().waitFor();
    await page.locator('#outcome-page .outcome-topic-card').first().waitFor();
    const cold = await page.evaluate(snapshot); records.push({ key, phase: 'cold-home', state: cold });
    check(key, 'normal direct home has real rail rows and all six styles', () => {
      assert.equal(cold.styles.length, 6); assert.ok(cold.styles.every(s => s.loaded && s.rules > 0));
      assert.equal(cold.outlineCards.length, 0); assert.ok(cold.mainCards.length >= 3); assert.ok(cold.railRows.length >= 3);
      assert.ok(cold.railRows.every(r => r.height <= 60));
    });
    await page.locator('#outline a.nav-item[data-topic-id="t1"]').first().click();
    await page.waitForFunction(() => new URL(location.href).searchParams.get('topic') === 't1' && document.body.dataset.ready === 'true'); await settled();
    const topic = await page.evaluate(snapshot); records.push({ key, phase: 'topic', state: topic });
    await page.locator('.ol-outcome[data-workspace-id="w1"] .ol-name').click();
    await page.waitForFunction(() => new URL(location.href).searchParams.get('workspace') === 'w1' && document.body.dataset.ready === 'true'); await settled();
    // Wait for either projection to populate, so an empty loading frame cannot pass.
    await page.waitForFunction(() => document.querySelectorAll('.outcome-topic-card').length >= 3);
    const warm = await page.evaluate(snapshot); records.push({ key, phase: 'warm-home', state: warm, cssResponses: responses });
    check(key, 'warm home keeps home cards out of the outline', () => {
      assert.ok(warm.styles.every(s => s.loaded && s.rules > 0)); assert.ok(responses.every(r => r.status === 200));
      assert.equal(warm.outlineCards.length, 0); assert.ok(warm.railRows.length >= 3); assert.ok(warm.mainCards.length >= 3);
      assert.ok(warm.railRows.every(r => r.height <= 60));
    });
    await page.screenshot({ path: `${evidence}/${key}-warm.png`, fullPage: true });
    await page.reload(); await settled(); await openOutcome(); await page.locator('#outline a.nav-item[data-topic-id="t1"]').first().waitFor();
    const reloaded = await page.evaluate(snapshot); records.push({ key, phase: 'reloaded', state: reloaded });
    check(key, 'reload is a normal rail and home-card presentation', () => { assert.equal(reloaded.outlineCards.length, 0); assert.ok(reloaded.railRows.length >= 3); assert.ok(reloaded.mainCards.length >= 3); });
    await page.locator('#outline a.nav-item[data-topic-id="t1"]').first().click();
    await page.waitForFunction(() => new URL(location.href).searchParams.get('topic') === 't1' && document.body.dataset.ready === 'true'); await settled();
    const again = await page.evaluate(snapshot); records.push({ key, phase: 'feed-control', state: again });
    check(key, 'feed dossiers keep full cards instead of rail-row treatment', () => {
      assert.ok(topic.feed.length && again.feed.length); const a = topic.feed.at(-1), b = again.feed.at(-1);
      assert.ok(b.height > 60); assert.equal(a.radius, b.radius); assert.equal(a.padding, b.padding); assert.equal(a.fontSize, b.fontSize);
    });
    await context.close();
  }
  if (process.argv.includes('--restart')) {
    const key = 'cold-load-across-real-restart', nextWeb = `${evidence}/restart-web`;
    await cp(new URL('../web', import.meta.url), nextWeb, { recursive: true });
    await appendFile(`${nextWeb}/rail-dense.css`, '\n/* Isolated952 next-build marker. */\n');
    const context = await browser.newContext({ viewport: { width: 1280, height: 1000 }, colorScheme: 'dark' });
    await context.addInitScript(() => { sessionStorage.loads952 = String(Number(sessionStorage.loads952 || 0) + 1); });
    page = await context.newPage(); page.setDefaultTimeout(15000);
    let holding = true, releaseReady, timer;
    const held = [], ready = new Promise(resolve => { releaseReady = resolve; });
    await page.route('**/b/**', route => {
      if (!holding) return route.continue();
      held.push(route);
      if (held.some(r => /\/app\.mjs$/.test(r.request().url())) && held.some(r => /\.css$/.test(r.request().url()))) releaseReady();
    });
    await page.goto(facts.origin + '/?workspace=w1', { waitUntil: 'commit' });
    try { await Promise.race([ready, new Promise((_, reject) => { timer = setTimeout(() => reject(Error('No held module/style graph')), 10000); })]); }
    finally { clearTimeout(timer); }
    const oldRequests = held.map(r => r.request().url()), oldBuild = /\/b\/([^/]+)\//.exec(oldRequests[0])[1];
    await control({ method: 'server_stop' });
    const restarted = await control({ method: 'server_start', web: nextWeb }); assert.equal(restarted.origin, facts.origin);
    const served = await (await fetch(facts.origin + '/api/build', { headers: { Authorization: `Bearer ${restarted.token}` } })).json();
    assert.ok(typeof served.build === 'string' && served.build);
    assert.notEqual(served.build, oldBuild);
    holding = false; await Promise.allSettled(held.map(r => r.continue()));
    await settled(); await openOutcome(); await page.locator('#outline a.nav-item[data-topic-id="t1"]').first().waitFor();
    const state = await page.evaluate(snapshot), loads = await page.evaluate(() => Number(sessionStorage.loads952));
    records.push({ key, state, oldRequests, oldBuild, servedBuild: served.build, loads });
    check(key, 'real restart recovers on one current build with styled rail rows', () => {
      assert.equal(loads, 2); assert.equal(state.outlineCards.length, 0); assert.ok(state.railRows.length >= 3);
      assert.ok(state.styles.every(s => s.loaded && s.rules > 0 && s.href.includes(`/b/${served.build}/`)));
    });
    await context.close();
    const partial = await browser.newContext({ viewport: { width: 1280, height: 1000 }, colorScheme: 'dark' });
    page = await partial.newPage(); page.setDefaultTimeout(10000); let lose = true;
    await page.route('**/rail-dense.css', route => { if (lose) { lose = false; return route.abort('connectionrefused'); } return route.continue(); });
    await page.goto(facts.origin + '/?workspace=w1'); await settled(); await openOutcome();
    await page.locator('#outline a.nav-item[data-topic-id="t1"]').first().waitFor();
    await page.locator('#outline a.nav-item[data-topic-id="t1"]').first().click();
    await page.waitForFunction(() => new URL(location.href).searchParams.get('topic') === 't1' && document.body.dataset.ready === 'true'); await settled();
    await page.locator('.ol-outcome[data-workspace-id="w1"] .ol-name').click();
    await page.waitForFunction(() => new URL(location.href).searchParams.get('workspace') === 'w1' && document.body.dataset.ready === 'true'); await settled();
    const missing = await page.evaluate(snapshot); records.push({ key: 'missing-density-sheet', state: missing });
    check('missing-density-sheet', 'missing density CSS alone does not reproduce the black-card DOM', () => {
      assert.equal(missing.styles.filter(s => !s.loaded).length, 1); assert.equal(missing.outlineCards.length, 0);
      assert.ok(missing.railRows.length >= 3 && missing.railRows.every(r => r.height <= 60));
    });
    await page.reload(); await settled(); await openOutcome();
    const recovered = await page.evaluate(snapshot); records.push({ key: 'missing-density-reload', state: recovered });
    check('missing-density-reload', 'reload restores the missing stylesheet and keeps rail ownership', () => {
      assert.ok(recovered.styles.every(s => s.loaded && s.rules > 0)); assert.equal(recovered.outlineCards.length, 0); assert.ok(recovered.railRows.length >= 3);
    });
    await partial.close();
  }
  assert.deepEqual(errors, []);
} catch (error) { failures.push({ fatal: error.stack }); if (page && !page.isClosed()) await page.screenshot({ path: `${evidence}/failure.png`, fullPage: true }).catch(() => {}); }
finally {
  if (browser) {
    const rows = execFileSync('ps', ['-axo', 'pid=,ppid=,command='], { encoding: 'utf8' }).split('\n').map(line => { const m = /^\s*(\d+)\s+(\d+)\s+(.*)$/.exec(line); return m && { pid: +m[1], parent: +m[2], command: m[3] }; }).filter(Boolean);
    const owned = new Set(rows.filter(r => r.command.includes(marker) || profile && r.command.includes(profile)).map(r => r.pid));
    for (let n = 0; n < rows.length; n++) for (const r of rows) if (owned.has(r.parent)) owned.add(r.pid);
    await browser.close(); const live = new Set(execFileSync('ps', ['-axo', 'pid='], { encoding: 'utf8' }).trim().split(/\s+/).map(Number)); const remaining = [...owned].filter(pid => live.has(pid));
    const profileAbsent = await access(profile).then(() => false, error => { if (error.code === 'ENOENT') return true; throw error; });
    records.push({ browserClosed: !browser.isConnected(), profile, profileAbsent, ownedPids: [...owned], remaining }); assert.deepEqual(remaining, []); assert.equal(profileAbsent, true);
  }
  child.stdin.end(); const ended = await exit;
  let absent = false; try { process.kill(child.pid, 0); } catch (error) { absent = error.code === 'ESRCH'; }
  const portClosed = !facts || await new Promise(resolve => { const s = net.connect(new URL(facts.origin).port, '127.0.0.1'); s.on('connect', () => { s.destroy(); resolve(false); }); s.on('error', () => resolve(true)); s.setTimeout(1000, () => { s.destroy(); resolve(false); }); });
  records.push({ fixture: ended, fixturePid: child.pid, absent, port: facts && new URL(facts.origin).port, portClosed, errors, failures });
  await writeFile(`${evidence}/results.json`, JSON.stringify(records, null, 2)); assert.deepEqual(ended, { code: 0, signal: null }); assert.equal(absent, true); assert.equal(portClosed, true);
}
if (failures.length) { process.stderr.write(JSON.stringify(failures, null, 2) + '\n'); process.exitCode = 1; }

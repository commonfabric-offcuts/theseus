// Real reply arrival and native unfold in an isolated HTTP/Core instance.
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, writeFile, rm, access } from 'node:fs/promises';
import net from 'node:net';
import { fixtureControl } from './fixture_control.mjs';
const playwright = await import(process.env.AIM_PLAYWRIGHT_CORE), engine = process.env.AIM_ENGINE ?? 'chromium';
const evidence = process.argv[2], baseline = process.env.AIM_965_BASELINE === '1';
await mkdir(evidence, { recursive: true });
const fixture = spawn('/usr/bin/python3', ['-B', 'tests/fixtures/ui_http.py', '--freshness']);
const { control, exit, errors } = fixtureControl(fixture);
const ps = () => execFileSync('/bin/ps', ['-axo', 'pid=,ppid=,command='], { encoding: 'utf8' }).trim().split('\n').map(line => {
  const [, pid, ppid, command] = line.match(/^\s*(\d+)\s+(\d+)\s+(.*)$/); return { pid: +pid, ppid: +ppid, command };
});
const results = [], cleanup = {}, owned = new Set(); let browser, profile, origin, failure;
function retainChildren() {
  const list = ps(); for (let changed = true; changed;) { changed = false;
    for (const p of list) if (owned.has(p.ppid) && !owned.has(p.pid)) { owned.add(p.pid); changed = true; }
  }
}
const snapshot = page => page.evaluate(() => ({ active: document.activeElement?.id, activeTag: document.activeElement?.tagName,
  choice: [...document.querySelectorAll('#inline-kind [role=radio]')].map(el => [el.id, el.getAttribute('aria-checked'), el.tabIndex]),
  sheet: document.querySelector('#new-message-sheet')?.open, words: document.querySelector('#inline-writing-body')?.value }));
try {
  const facts = await control({ method: 'ready' }); origin = facts.origin;
  profile = await mkdtemp(`${evidence}/${engine}-profile-`);
  const persistent = await playwright[engine].launchPersistentContext(profile, { headless: true,
    ...(engine === 'chromium' ? { executablePath: process.env.AIM_CHROME } : {}) });
  browser = persistent.browser(); for (const p of ps()) if (p.command.includes(profile)) owned.add(p.pid); retainChildren(); assert.ok(owned.size);
  for (const width of baseline ? [1280] : [1280, 390]) for (const colorScheme of baseline ? ['light'] : ['light', 'dark']) {
    const context = await browser.newContext({ viewport: { width, height: 900 }, hasTouch: width === 390, isMobile: width === 390, colorScheme });
    const page = await context.newPage(), pageErrors = [];
    page.setDefaultTimeout(5000); page.on('pageerror', e => pageErrors.push(e.message));
    await page.goto(`${origin}/?topic=t1`); await page.locator('body[data-ready=true]').waitFor();
    const message = page.locator('#inline-kind-message'), note = page.locator('#inline-kind-note-card'), field = page.locator('#inline-writing-body');
    await field.fill('965 kept writing');
    const pick = async kind => { const el = kind === 'message' ? message : note; if (width === 390) await el.tap(); else await el.click(); };
    const checked = async kind => { assert.equal(await (kind === 'message' ? message : note).getAttribute('aria-checked'), 'true'); };
    async function check(name, act) {
      let error; const before = await snapshot(page);
      try { await act(); assert.deepEqual(pageErrors, []); } catch (caught) { error = caught.stack; }
      const after = await snapshot(page); assert.equal(after.words, '965 kept writing');
      results.push({ key: `${engine}-${width}-${colorScheme}-${name}`, before, after, error: error ?? null });
      if (error) await page.screenshot({ path: `${evidence}/${engine}-${width}-${colorScheme}-${name}.png` });
      await writeFile(`${evidence}/observations.json`, JSON.stringify(results, null, 2));
    }
    await check('single-right-at-note-stops', async () => { await pick('note'); await page.keyboard.press('ArrowRight'); await checked('note'); assert.equal((await snapshot(page)).active, 'inline-kind-note-card'); });
    await check('single-step-pointer-and-ends', async () => {
      await pick('message'); await page.keyboard.press('ArrowRight'); await checked('note');
      assert.equal((await snapshot(page)).active, 'inline-kind-note-card');
      await page.keyboard.press('ArrowLeft'); await checked('message');
      await page.keyboard.press('ArrowLeft'); await checked('message');
      await page.keyboard.press('End'); await checked('note'); await page.keyboard.press('Home'); await checked('message');
      await pick('note'); await checked('note'); await pick('message'); await checked('message');
    });
    for (const key of ['ArrowUp', 'ArrowDown', 'Tab', 'Escape']) await check(`${key}-leaves`, async () => {
      await pick('message'); await page.keyboard.press(key); await checked('message');
      assert.equal((await page.evaluate(() => Boolean(document.activeElement?.closest('#inline-kind')))), false, `${key} leaves the switch`);
      assert.notEqual((await snapshot(page)).activeTag, 'BODY', `${key} lands on a control`);
    });
    await check('held-key-does-not-cycle', async () => {
      await pick('message'); await page.keyboard.down('ArrowRight'); await checked('note');
      await page.keyboard.down('ArrowRight'); await page.keyboard.up('ArrowRight'); await checked('note');
    });
    await check('feed-vertical-and-words-route', async () => {
      await page.locator('#topic-title').click();
      const cards = page.locator('.message-card'); assert.ok(await cards.count() >= 2);
      await cards.first().focus(); const first = await page.evaluate(() => document.activeElement?.dataset.id);
      await page.keyboard.press('ArrowDown'); const second = await page.evaluate(() => document.activeElement?.dataset.id);
      assert.ok(first && second && first !== second, 'Down reaches another feed message');
      await page.keyboard.press('ArrowUp'); assert.equal(await page.evaluate(() => document.activeElement?.dataset.id), first);
      await page.keyboard.press('ArrowRight'); assert.ok(await page.evaluate(() => Boolean(document.activeElement?.closest('#things')) || Boolean(document.activeElement?.closest('.message-card'))), 'existing message/right-pane arrow route remains reachable');
    });
    await check('sheet-escape-keeps-dismissal', async () => {
      await page.locator('#new-message').click(); await pick('message'); await page.keyboard.press('Escape');
      assert.equal((await snapshot(page)).sheet, false);
      assert.equal((await snapshot(page)).active, 'new-message');
    });
    await context.close();
  }
} catch (caught) { failure = caught; }
finally {
  if (browser) { retainChildren(); await browser.close(); cleanup.browserClosed = !browser.isConnected(); }
  const after = ps(); cleanup.ownedPids = [...owned]; cleanup.remainingOwned = after.filter(p => owned.has(p.pid));
  cleanup.profileProcesses = profile ? after.filter(p => p.command.includes(profile)) : [];
  if (profile && cleanup.browserClosed && !cleanup.remainingOwned.length && !cleanup.profileProcesses.length) {
    await rm(profile, { recursive: true }); cleanup.profileRemoved = await access(profile).then(() => false, () => true);
  }
  fixture.stdin.end(); cleanup.fixtureExit = await exit; cleanup.fixtureErrors = errors(); cleanup.fixturePid = fixture.pid;
  cleanup.fixtureAbsent = !ps().some(p => p.pid === fixture.pid);
  if (origin) cleanup.portClosed = await new Promise(resolve => {
    const url = new URL(origin), socket = net.createConnection({ host: url.hostname, port: +url.port });
    socket.once('connect', () => { socket.destroy(); resolve(false); }); socket.once('error', () => resolve(true));
  });
  await writeFile(`${evidence}/results.json`, JSON.stringify({ results, cleanup, failure: failure?.stack ?? null }, null, 2));
}
assert.equal(cleanup.fixtureExit.code, 0); assert.equal(cleanup.fixtureAbsent, true); assert.equal(cleanup.portClosed, true);
if (failure) throw failure;
assert.equal(cleanup.browserClosed, true); assert.deepEqual(cleanup.remainingOwned, []); assert.deepEqual(cleanup.profileProcesses, []);
assert.ok(results.length && results.every(result => !result.error), '965 native keys and retained routes pass; inspect evidence');
console.log(JSON.stringify({ passed: results.length, cleanup }));

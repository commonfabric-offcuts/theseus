// Personal outcome color through the real page, rail, HTTP adapter and Core.
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, writeFile, readFile, rm, access } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import net from 'node:net';
import { fixtureControl } from './fixture_control.mjs';
const engines = await import(process.env.AIM_PLAYWRIGHT_CORE), engine = process.env.AIM_BROWSER ?? 'chromium';
const evidence = process.argv[2]; await mkdir(evidence, { recursive: true });
const filter = new RegExp(process.argv[3] ?? '');
const sourceFiles = ['aim_next/outcome_colors.py', 'aim_next/store.py', 'aim_next/migrations.py', 'aim_next/validation.py',
  'aim_next/outcome_kind.py', 'web/app.mjs', 'web/index.html', 'web/outcome-color-picker.mjs', 'web/outcome-colors.mjs',
  'web/outcome-colors.css', 'web/outcome-refresh.mjs', 'web/outline-rail.mjs', 'tests/outcome_colors_957_native.mjs'];
const hashes = Object.fromEntries(await Promise.all(sourceFiles.map(async path => [path, createHash('sha256').update(await readFile(path)).digest('hex')])));
await writeFile(`${evidence}/source.json`, JSON.stringify({ base: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(), hashes }, null, 2));
const child = spawn('/usr/bin/python3', ['-B', 'tests/fixtures/ui_http.py', '--freshness']);
const { control, exit, errors } = fixtureControl(child);
const results = [], cleanup = {}; let browser, origin, profile, activePage, failure;
const owned = new Set();
const processes = () => execFileSync('/bin/ps', ['-axo', 'pid=,ppid=,command='], { encoding: 'utf8' }).trim().split('\n').map(line => {
  const [, pid, ppid, command] = line.match(/^\s*(\d+)\s+(\d+)\s+(.*)$/); return { pid: +pid, ppid: +ppid, command };
});
function retainChildren() {
  const list = processes(); for (let changed = true; changed;) { changed = false;
    for (const p of list) if ((owned.has(p.ppid) || profile && p.command.includes(profile)) && !owned.has(p.pid)) { owned.add(p.pid); changed = true; }
  }
}
const drawing = page => page.evaluate(() => {
  const row = document.querySelector('.ol-outcome[data-workspace-id="w1"]');
  const title = row.querySelector('.ol-title'), hair = getComputedStyle(row.querySelector('.ol-topics'), '::before');
  return { color: getComputedStyle(title).color, weight: getComputedStyle(title).fontWeight, size: getComputedStyle(title).fontSize,
    hair: hair.backgroundColor, hairOpacity: hair.opacity, hairContent: hair.content,
    topics: [...row.querySelectorAll('a[data-topic-id]')].map(a => ({ id: a.dataset.topicId, color: getComputedStyle(a).color, weight: getComputedStyle(a).fontWeight })),
    other: getComputedStyle(document.querySelector('.ol-outcome[data-workspace-id="neutral957"] .ol-title')).color,
    pageTitle: getComputedStyle(document.querySelector('#topic-title')).color };
});
const pick = async (page, color) => {
  const trigger = page.getByRole('button', { name: 'Color for this outcome', exact: true }); await trigger.click();
  const response = page.waitForResponse(r => { try { return r.request().postDataJSON()?.kind === 'outcome.color_set'; } catch { return false; } });
  await page.getByRole('dialog', { name: 'Outcome color', exact: true }).getByRole('button', { name: color, exact: true }).click();
  const receipt = await (await response).json(); assert.equal(receipt.status, 'committed', JSON.stringify(receipt));
  await page.getByRole('dialog', { name: 'Outcome color', exact: true }).waitFor({ state: 'hidden' }); return receipt;
};
try {
  const facts = await control({ method: 'ready' }); origin = facts.origin;
  await control({ method: 'navigation_workspaces', workspaces: [{ id: 'neutral957', title: 'Uncolored neighbor' }] });
  await control({ method: 'outcome_change', workspace_id: 'w1', sender: facts.actor, member: facts.agent, present: true, operation_id: '957-member' });
  profile = await mkdtemp(`${evidence}/${engine}-profile-`);
  const persistent = await engines[engine].launchPersistentContext(profile, { headless: true,
    ...(engine === 'chromium' ? { executablePath: process.env.AIM_CHROME } : {}) });
  browser = persistent.browser(); retainChildren(); assert.ok(owned.size);
  for (const width of [1280, 390]) for (const colorScheme of ['light', 'dark']) {
    const key = `${width}-${colorScheme}`; if (!filter.test(key)) continue;
    const context = await browser.newContext({ viewport: { width, height: 900 }, colorScheme, hasTouch: width === 390 });
    const page = await context.newPage(); activePage = page; page.setDefaultTimeout(6000);
    const pageErrors = []; page.on('pageerror', error => pageErrors.push(error.message));
    await page.goto(origin + '/?workspace=w1'); await page.locator('body[data-ready=true]').waitFor();
    await page.evaluate(() => {
      window.colorEvents957 = [];
      for (const type of ['pointerdown', 'mousedown', 'mouseup', 'click', 'focusin', 'focusout']) document.addEventListener(type, event => {
        if (event.target.closest?.('.topic-title-area')) window.colorEvents957.push({ type, target: event.target.outerHTML?.slice(0, 200), active: document.activeElement?.outerHTML?.slice(0, 200) });
      }, true);
    });
    await page.locator('#topic-title').waitFor();
    const picker = page.getByRole('button', { name: 'Color for this outcome', exact: true });
    await page.screenshot({ path: `${evidence}/${key}-before.png`, fullPage: true });
    assert.equal(await picker.count(), 1, '957: real outcome title offers its personal color ring');
    const disclosure = page.locator('.ol-outcome[data-workspace-id="w1"] .ol-disclosure');
    if (width > 760 && await disclosure.getAttribute('aria-expanded') === 'false') await disclosure.click();
    await page.locator('.ol-outcome[data-workspace-id="w1"] a[data-topic-id="t1"]').waitFor({ state: 'attached' });
    const plain = await drawing(page);
    await picker.click();
    const strip = page.getByRole('dialog', { name: 'Outcome color', exact: true });
    await strip.waitFor();
    const choices = await strip.getByRole('button').evaluateAll(nodes => nodes.map(node => node.getAttribute('aria-label')));
    assert.deepEqual(choices, ['No color', 'Green', 'Blue', 'Indigo', 'Violet', 'Rose', 'Peach', 'Cyan', 'Olive']);
    await page.keyboard.press('ArrowRight');
    assert.equal(await page.evaluate(() => document.activeElement?.getAttribute('aria-label')), 'Green');
    await page.keyboard.press('Escape'); await strip.waitFor({ state: 'hidden' });
    assert.equal(await picker.evaluate(el => el === document.activeElement), true);
    await page.keyboard.press('Space'); await strip.waitFor();
    await page.keyboard.press('End'); await page.keyboard.press('Tab'); await strip.waitFor({ state: 'hidden' });
    await picker.click();
    await page.screenshot({ path: `${evidence}/${key}-palette.png`, fullPage: true });
    const response = page.waitForResponse(r => { try { return r.request().postDataJSON()?.kind === 'outcome.color_set'; } catch { return false; } });
    if (width === 390) await strip.getByRole('button', { name: 'Blue', exact: true }).tap(); else await strip.getByRole('button', { name: 'Blue', exact: true }).click();
    const http = await response, receipt = await http.json(); assert.equal(receipt.status, 'committed', JSON.stringify(receipt));
    assert.equal(receipt.result.workspace_id, 'w1'); assert.equal(receipt.result.color, 'blue');
    await strip.waitFor({ state: 'hidden' });
    const stored = await control({ method: 'agent_view', actor: facts.actor, name: 'workspace', args: { workspace_id: 'w1' } });
    assert.equal(stored.workspace.color, 'blue');
    await page.waitForFunction(() => document.querySelector('.ol-outcome[data-workspace-id="w1"]')?.dataset.color === 'blue');
    const blue = await drawing(page);
    const expected = width > 760 || colorScheme === 'dark' ? 'rgb(141, 184, 236)' : 'rgb(58, 111, 176)';
    assert.equal(blue.color, expected); assert.equal(blue.other, plain.other); assert.equal(blue.pageTitle, plain.pageTitle);
    assert.deepEqual(blue.topics, plain.topics); assert.equal(blue.weight, plain.weight); assert.equal(blue.size, plain.size);
    if (width > 760) { assert.equal(blue.hair, expected); assert.equal(blue.hairOpacity, '0.45'); }
    const anotherContext = await browser.newContext({ viewport: { width, height: 900 }, colorScheme });
    const anotherPage = await anotherContext.newPage(); await anotherPage.goto(origin + '/?workspace=w1');
    await anotherPage.locator('body[data-ready=true]').waitFor();
    assert.equal(await anotherPage.getByRole('button', { name: 'Color for this outcome' }).getAttribute('data-color'), 'blue', 'another session reads the Core choice without local storage');
    await anotherContext.close();
    await page.reload(); await page.locator('body[data-ready=true]').waitFor();
    assert.equal(await picker.getAttribute('data-color'), 'blue');
    await page.screenshot({ path: `${evidence}/${key}-chosen.png`, fullPage: true });
    await picker.click();
    const reset = page.waitForResponse(r => { try { return r.request().postDataJSON()?.kind === 'outcome.color_set'; } catch { return false; } });
    await strip.getByRole('button', { name: 'No color', exact: true }).click();
    assert.equal((await (await reset).json()).result.color, null);
    await strip.waitFor({ state: 'hidden' });
    await page.waitForFunction(() => !document.querySelector('.ol-outcome[data-workspace-id="w1"]')?.hasAttribute('data-color'));
    assert.deepEqual(await drawing(page), plain, 'no color restores the original name, hairline and topic typography');
    if (width > 760) {
      await page.getByRole('button', { name: 'Paper', exact: true }).click();
      const paperPlain = await drawing(page); await pick(page, 'Blue'); const paperBlue = await drawing(page);
      assert.equal(paperBlue.color, colorScheme === 'dark' ? 'rgb(141, 184, 236)' : 'rgb(58, 111, 176)');
      assert.deepEqual(paperBlue.topics, paperPlain.topics); await pick(page, 'No color');
      await page.getByRole('button', { name: 'Roomy', exact: true }).click();
      const roomyPlain = await drawing(page); await pick(page, 'Blue'); const roomyBlue = await drawing(page);
      assert.equal(roomyBlue.weight, roomyPlain.weight); assert.equal(roomyBlue.size, roomyPlain.size);
      assert.equal(roomyBlue.hairContent, roomyPlain.hairContent); assert.deepEqual(roomyBlue.topics, roomyPlain.topics);
      await pick(page, 'No color');
    }
    assert.deepEqual(pageErrors, []);
    results.push({ width, colorScheme, choices, receipt, plain, blue, reset: true, keyboardExit: true, secondSession: true });
    retainChildren(); await context.close();
  }
  assert.ok(results.length);
  // A second reader of the same outcome starts uncolored and keeps their own
  // choice. Real server sessions use separate browser contexts, same Core.
  let context = await browser.newContext(), page = await context.newPage(); activePage = page;
  await page.goto(origin + '/?workspace=w1'); await page.locator('body[data-ready=true]').waitFor(); await pick(page, 'Blue'); await context.close();
  await control({ method: 'server_stop' }); await control({ method: 'server_start', as_actor: facts.agent });
  context = await browser.newContext(); page = await context.newPage(); activePage = page;
  await page.goto(origin + '/?workspace=w1'); await page.locator('body[data-ready=true]').waitFor();
  assert.equal(await page.getByRole('button', { name: 'Color for this outcome' }).getAttribute('data-color'), '');
  await pick(page, 'Green');
  const one = await control({ method: 'agent_view', actor: facts.actor, name: 'workspace', args: { workspace_id: 'w1' } });
  const two = await control({ method: 'agent_view', actor: facts.agent, name: 'workspace', args: { workspace_id: 'w1' } });
  assert.equal(one.workspace.color, 'blue'); assert.equal(two.workspace.color, 'green'); await context.close();
  await control({ method: 'server_stop' }); await control({ method: 'server_start', as_actor: facts.actor });
  context = await browser.newContext(); page = await context.newPage(); activePage = page;
  await page.goto(origin + '/?topic=t1'); await page.locator('body[data-ready=true]').waitFor();
  assert.equal(await page.getByRole('button', { name: 'Color for this outcome' }).count(), 0, 'topic pages have no outcome picker');
  await page.waitForFunction(() => document.querySelector('.ol-outcome[data-workspace-id="w1"]')?.dataset.color === 'blue');
  results.push({ separateReaders: true, first: one.workspace.color, second: two.workspace.color, topicPage: true });
  retainChildren(); await context.close();
} catch (error) {
  failure = error;
  if (activePage && !activePage.isClosed()) {
    await activePage.screenshot({ path: `${evidence}/failure.png`, fullPage: true });
    await writeFile(`${evidence}/failure.html`, await activePage.content());
    await writeFile(`${evidence}/events.json`, JSON.stringify(await activePage.evaluate(() => window.colorEvents957), null, 2));
  }
} finally {
  if (browser) { retainChildren(); await browser.close(); cleanup.disconnected = !browser.isConnected(); }
  child.stdin.end(); cleanup.fixtureExit = await exit; cleanup.fixtureErrors = errors();
  const ps = processes();
  cleanup.fixturePid = child.pid; cleanup.fixtureAbsent = !ps.some(p => p.pid === child.pid);
  cleanup.ownedPids = [...owned]; cleanup.remainingOwned = ps.filter(p => owned.has(p.pid));
  cleanup.profile = profile; cleanup.profileProcesses = profile ? ps.filter(p => p.command.includes(profile)) : [];
  if (profile && cleanup.disconnected && !cleanup.remainingOwned.length && !cleanup.profileProcesses.length) await rm(profile, { recursive: true });
  cleanup.profileAbsent = profile ? await access(profile).then(() => false, () => true) : null;
  if (origin) cleanup.portClosed = await new Promise(resolve => { const url = new URL(origin), socket = net.createConnection({ host: url.hostname, port: Number(url.port) });
    socket.once('connect', () => { socket.destroy(); resolve(false); }); socket.once('error', () => resolve(true)); });
  await writeFile(`${evidence}/results.json`, JSON.stringify({ engine, results, cleanup, failure: failure?.stack ?? null }, null, 2));
}
assert.equal(cleanup.disconnected, true); assert.equal(cleanup.fixtureExit.code, 0); assert.equal(cleanup.fixtureErrors, '');
assert.equal(cleanup.fixtureAbsent, true); assert.equal(cleanup.portClosed, true);
assert.deepEqual(cleanup.remainingOwned, []); assert.deepEqual(cleanup.profileProcesses, []); assert.equal(cleanup.profileAbsent, true);
if (failure) throw failure;
console.log(JSON.stringify({ passed: results.length, cleanup }));

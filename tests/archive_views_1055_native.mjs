// The archive shelf's views (1055) in an isolated HTTP/Core instance: Auto shows the replicas as a grid up to 18
// archived dossiers and as a list from 19; a press on Grid or List overrides Auto and is kept for the viewer.
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, writeFile, rm } from 'node:fs/promises';
import { fixtureControl } from './fixture_control.mjs';
import { readingSeed } from './topic_reading_native.mjs';
const playwright = await import(process.env.AIM_PLAYWRIGHT_CORE), engine = process.env.AIM_ENGINE ?? 'chromium';
const evidence = process.argv[2];
await mkdir(evidence, { recursive: true });
const fixture = spawn('/usr/bin/python3', ['-B', 'tests/fixtures/ui_http.py', '--freshness', '--agent-colors']);
const { control, exit, errors } = fixtureControl(fixture);
const ps = () => execFileSync('/bin/ps', ['-axo', 'pid=,ppid=,command='], { encoding: 'utf8' }).trim().split('\n').map(line => {
  const [, pid, ppid, command] = line.match(/^\s*(\d+)\s+(\d+)\s+(.*)$/); return { pid: +pid, ppid: +ppid, command };
});
const results = [], owned = new Set(); let browser, profile, failure;
const KEY = 'theseus-archive-view';
// What the page draws of the shelf's views.
const drawn = page => page.evaluate(KEY => {
  const shelf = [...document.querySelectorAll('#things .archive-shelf')].find(s => !s.hidden) ?? null;
  const button = value => shelf?.querySelector(`.shelf-view[data-value="${value}"]`);
  let stored = null; try { stored = localStorage.getItem(KEY); } catch { stored = 'unreadable'; }
  return { shown: Boolean(shelf?.getClientRects().length), view: shelf?.dataset.view ?? null,
    replicas: shelf ? shelf.querySelectorAll('.shelf-dossier').length : 0, ghosts: document.querySelectorAll('.shelf-ghost').length,
    pressed: ['auto', 'grid', 'list'].filter(v => button(v)?.getAttribute('aria-pressed') === 'true'),
    current: ['auto', 'grid', 'list'].filter(v => button(v)?.dataset.current === 'true'),
    sizes: shelf ? Object.fromEntries([...shelf.querySelectorAll('.shelf-dossier')].map(r => [r.dataset.id, r.querySelector('.shelf-size')?.textContent ?? null])) : {},
    rowHeight: shelf?.querySelector('.shelf-dossier')?.getBoundingClientRect().height ?? 0, stored };
}, KEY);
try {
  const facts = await control({ method: 'ready' });
  const seed = readingSeed(control), said = (key, more) => [key, { sender: 'aim-core', addressees: [facts.actor], read: true, divergence_reason: 'Views source ' + key, ...more }];
  profile = await mkdtemp(`${evidence}/${engine}-profile-`);
  const persistent = await playwright[engine].launchPersistentContext(profile, { headless: true, ...(engine === 'chromium' ? { executablePath: process.env.AIM_CHROME } : {}) });
  browser = persistent.browser(); for (const p of ps()) if (p.command.includes(profile)) owned.add(p.pid); assert.ok(owned.size);
  const key = `${engine}-laptop-dark`, topic = 'views-1055';
  // Twenty dossiers, the first with a reply (two messages), the rest single.
  const ids = await seed(topic, [said('d0', { join: true, body: 'Dossier 0, with a reply.' }), said('r0', { reply_to: 'd0', reply_without_quote: 'A reply.', body: 'The reply in dossier 0.' }),
    ...Array.from({ length: 19 }, (_, n) => said('d' + (n + 1), { join: true, body: `Dossier ${n + 1}.` }))]);
  const order = Array.from({ length: 20 }, (_, n) => ids['d' + n]);
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, colorScheme: 'dark' });
  const page = await context.newPage(), pageErrors = []; page.on('pageerror', e => pageErrors.push(e.message)); page.setDefaultTimeout(5000);
  const seen = []; let error;
  const becomes = async (test, why) => { const end = Date.now() + 5000;
    for (let d; Date.now() < end;) { d = await drawn(page); if (test(d)) return d; await page.waitForTimeout(40); } throw Error(why + ': ' + JSON.stringify(await drawn(page))); };
  const section = id => `#messages .reply-stack[data-stack="${id}"]`;
  const archive = async id => { await page.locator(section(id)).first().scrollIntoViewIfNeeded(); await page.locator(section(id)).first().hover();
    await page.locator(`${section(id)} [aria-label="Archive"]`).first().click(); };
  const press = value => page.locator(`#things .shelf-view[data-value="${value}"]`).click();
  try {
    await page.goto(`${facts.origin}/?topic=${topic}`); await page.locator('body[data-ready=true]').waitFor();
    for (const [n, id] of order.slice(0, 18).entries()) { await archive(id); await becomes(d => d.replicas === n + 1 && d.ghosts === 0, `archive ${n + 1} lands`); }
    let d = await drawn(page);
    assert.equal(d.stored, null, 'nothing chosen yet: nothing stored');
    assert.deepEqual([d.view, d.pressed, d.current], ['grid', ['auto'], ['grid']], 'Auto at 18: the grid, Auto pressed, the grid glyph marked as its choice');
    assert.equal(d.sizes[ids.d0], '1', 'a dossier of two messages shows its reply count');
    assert.equal(Object.entries(d.sizes).filter(([id]) => id !== ids.d0).every(([, size]) => size === ''), true, 'a single message shows no count: ' + JSON.stringify(d.sizes));
    seen.push('auto at 18: grid');
    await archive(order[18]); d = await becomes(d => d.replicas === 19 && d.ghosts === 0, 'archive 19 lands');
    assert.deepEqual([d.view, d.pressed, d.current], ['list', ['auto'], ['list']], 'Auto at 19: the list, the list glyph marked as its choice');
    assert.ok(d.rowHeight > 0 && d.rowHeight <= 26, 'a list row is a rail row\'s height, not a replica\'s: ' + d.rowHeight);
    seen.push('auto at 19: list');
    // Chosen from the keyboard: Tab from Auto reaches Grid, and Enter presses it.
    await page.locator('#things .shelf-view[data-value="auto"]').focus(); await page.keyboard.press('Tab');
    assert.equal(await page.evaluate(() => document.activeElement?.dataset?.value ?? null), 'grid', 'Tab from Auto reaches Grid');
    await page.keyboard.press('Enter'); d = await becomes(d => d.view === 'grid', 'Grid chosen by Enter');
    assert.deepEqual([d.pressed, d.current, d.stored], [['grid'], [], 'grid'], 'Grid overrides Auto at 19, is kept, and no glyph is marked as Auto\'s choice');
    seen.push('chosen from the keyboard');
    await page.reload(); await page.locator('body[data-ready=true]').waitFor();
    d = await becomes(d => d.shown && d.replicas === 19, 'the shelf after a reload');
    assert.deepEqual([d.view, d.pressed], ['grid', ['grid']], 'the choice of Grid survives a reload');
    await press('list'); d = await becomes(d => d.view === 'list', 'List pressed');
    assert.deepEqual([d.pressed, d.stored], [['list'], 'list'], 'List is kept');
    // Under a chosen List the shelf stays a list when it shrinks below Auto's threshold.
    await page.locator(`.shelf-dossier[data-id="${order[18]}"]`).click(); await page.locator(`.shelf-dossier[data-id="${order[17]}"]`).click();
    d = await becomes(d => d.replicas === 17 && d.ghosts === 0, 'two brought back');
    assert.equal(d.view, 'list', 'a chosen List does not follow the count');
    seen.push('Grid and List override and persist');
    await press('auto'); d = await becomes(d => d.pressed.includes('auto'), 'Auto pressed');
    assert.deepEqual([d.view, d.current, d.stored], ['grid', ['grid'], 'auto'], 'back on Auto at 17: the grid again');
    seen.push('auto again: grid at 17');
    await page.screenshot({ path: `${evidence}/${key}.png` });
    assert.deepEqual(pageErrors, []);
  } catch (e) { error = e; await page.screenshot({ path: `${evidence}/${key}-failed.png` }).catch(() => {}); }
  results.push({ key, seen, error: error ? String(error.stack ?? error) : null }); await context.close();
  // On a coarse pointer the switch and the list's rows are finger-sized; a fine pointer keeps them small (above).
  {
    const key = `${engine}-touch-dark`, touchTopic = 'views-1055-touch', seen = []; let error;
    const touchIds = await seed(touchTopic, [said('t0', { join: true, body: 'A touch dossier.' }), said('t1', { join: true, body: 'Another touch dossier.' })]);
    const touch = await browser.newContext({ viewport: { width: 1280, height: 900 }, colorScheme: 'dark', hasTouch: true });
    const tp = await touch.newPage(), touchErrors = []; tp.on('pageerror', e => touchErrors.push(e.message)); tp.setDefaultTimeout(5000);
    try {
      await tp.goto(`${facts.origin}/?topic=${touchTopic}`); await tp.locator('body[data-ready=true]').waitFor();
      assert.equal(await tp.evaluate(() => matchMedia('(pointer: coarse)').matches), true, 'the touch context is a coarse pointer');
      const at = `#messages .reply-stack[data-stack="${touchIds.t0}"]`;
      // The dossier's own Archive (its tools show on hover, which a touch screen does not have).
      await tp.locator(at).first().waitFor(); await tp.evaluate(at => document.querySelector(`${at} [aria-label="Archive"]`).click(), at);
      const sizes = () => tp.evaluate(() => { const box = n => n?.getBoundingClientRect(); const shelf = document.querySelector('#things .archive-shelf:not([hidden])');
        return { buttons: [...(shelf?.querySelectorAll('.shelf-view') ?? [])].map(b => [Math.round(box(b).width), Math.round(box(b).height)]),
          row: Math.round(box(shelf?.querySelector('.shelf-dossier'))?.height ?? 0), view: shelf?.dataset.view ?? null, ghosts: document.querySelectorAll('.shelf-ghost').length,
          // The replica that just landed grows into place: measured once it has stopped moving.
          moving: shelf ? shelf.getAnimations({ subtree: true }).length : 0 }; });
      const end = Date.now() + 5000; let s = await sizes();
      while ((s.buttons.length !== 3 || s.ghosts || s.moving) && Date.now() < end) { await tp.waitForTimeout(40); s = await sizes(); }
      assert.equal(s.buttons.length, 3, 'the switch is drawn on the touch shelf');
      assert.ok(s.buttons.every(([w, h]) => w >= 44 && h >= 44), 'each of Auto, Grid and List is at least 44 px square: ' + JSON.stringify(s.buttons));
      await tp.locator('#things .shelf-view[data-value="list"]').click();
      const end2 = Date.now() + 5000; s = await sizes(); while ((s.view !== 'list' || s.moving) && Date.now() < end2) { await tp.waitForTimeout(40); s = await sizes(); }
      assert.ok(s.view === 'list' && s.row >= 44, 'a list row is at least 44 px tall on touch: ' + JSON.stringify(s));
      seen.push('touch targets 44 px');
      assert.deepEqual(touchErrors, []);
    } catch (e) { error = e; await tp.screenshot({ path: `${evidence}/${key}-failed.png` }).catch(() => {}); }
    results.push({ key, seen, error: error ? String(error.stack ?? error) : null }); await touch.close();
  }
} catch (e) { failure = String(e.stack ?? e); }
finally {
  await browser?.close(); fixture.kill('SIGTERM'); await exit; if (profile) await rm(profile, { recursive: true, force: true });
  await writeFile(`${evidence}/results.json`, JSON.stringify({ results, failure, fixtureErrors: errors }, null, 2));
}
const passed = results.filter(r => !r.error).length;
console.log(JSON.stringify({ passed, failed: results.length - passed, failure: failure?.split('\n')[0] ?? null }));
for (const r of results) if (r.error) console.log(r.key, r.error.split('\n')[0]);
process.exit(failure || passed !== results.length ? 1 : 0);

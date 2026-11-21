// Native archive shelf in an isolated HTTP/Core instance: archived dossiers sit
// at the foot of the right rail as replicas of themselves, and the feed never shows them.
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
const retainChildren = () => { const list = ps(); for (let changed = true; changed;) { changed = false;
  for (const p of list) if (owned.has(p.ppid) && !owned.has(p.pid)) { owned.add(p.pid); changed = true; } } };
// What the page draws of the shelf and the feed.
const drawn = page => page.evaluate(() => {
  const shown = node => Boolean(node && node.getClientRects().length && getComputedStyle(node).visibility !== 'hidden');
  const shelves = [...document.querySelectorAll('#things .archive-shelf')];
  const shelf = shelves.find(s => !s.hidden) ?? null;
  return { shelves: shelves.length, shelfShown: shown(shelf),
    replicas: shelf ? [...shelf.querySelectorAll('.shelf-dossier')].map(r => ({ id: r.dataset.id, title: r.querySelector('.shelf-title').textContent,
      folder: r.dataset.folder, sheets: r.dataset.sheets })) : [],
    feed: [...document.querySelectorAll('#messages .reply-stack')].filter(shown).map(s => s.dataset.stack),
    more: [...document.querySelectorAll('#messages .stack-more')].some(shown), ghosts: document.querySelectorAll('.shelf-ghost').length,
    focused: document.activeElement?.closest?.('.shelf-dossier')?.dataset.id ?? null };
});
try {
  const facts = await control({ method: 'ready' });
  const seed = readingSeed(control), said = (key, more) => [key, { sender: 'aim-core', addressees: [facts.actor], read: true, divergence_reason: 'Shelf source ' + key, ...more }];
  profile = await mkdtemp(`${evidence}/${engine}-profile-`);
  const persistent = await playwright[engine].launchPersistentContext(profile, { headless: true, ...(engine === 'chromium' ? { executablePath: process.env.AIM_CHROME } : {}) });
  browser = persistent.browser(); for (const p of ps()) if (p.command.includes(profile)) owned.add(p.pid); retainChildren(); assert.ok(owned.size);
  for (const scheme of ['dark', 'light']) {
    const key = `${engine}-laptop-${scheme}`, here = `shelf-${scheme}`, there = `shelf-${scheme}-other`;
    const ids = await seed(here, [said('one', { join: true, body: 'The first dossier, archived and brought back.' }),
      said('two', { join: true, body: 'The second dossier, never archived.' }),
      said('three', { join: true, body: 'The third dossier, with a reply.' }),
      said('reply', { reply_to: 'three', reply_without_quote: 'A reply in the third.', body: 'The reply in the third dossier.' })]);
    const away = await seed(there, [said('elsewhere', { join: true, body: 'Another topic, nothing archived.' })]);
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, colorScheme: scheme });
    const page = await context.newPage(), pageErrors = []; page.on('pageerror', e => pageErrors.push(e.message)); page.setDefaultTimeout(5000);
    const seen = []; let error;
    const becomes = async (test, why) => { await page.waitForFunction(() => true); const end = Date.now() + 5000;
      for (let d; Date.now() < end;) { d = await drawn(page); if (test(d)) return d; await page.waitForTimeout(40); } throw Error(why + ': ' + JSON.stringify(await drawn(page))); };
    const section = id => `#messages .reply-stack[data-stack="${id}"]`;
    const nameOf = id => page.locator(`${section(id)} .stack-name`).first().textContent();
    const archive = async id => { const tool = page.locator(`${section(id)} [aria-label="Archive"]`).first();
      await page.locator(section(id)).first().hover(); await tool.click(); };
    try {
      await page.goto(`${facts.origin}/?topic=${here}`); await page.locator('body[data-ready=true]').waitFor();
      let d = await becomes(d => d.feed.includes(ids.one) && d.feed.includes(ids.three), 'the feed draws its dossiers');
      assert.equal(d.shelfShown, false, 'nothing archived: no shelf'); seen.push('no shelf before archiving');
      const one = (await nameOf(ids.one)).trim(), three = (await nameOf(ids.three)).trim();
      await archive(ids.one);
      d = await becomes(d => d.replicas.length === 1 && !d.feed.includes(ids.one) && d.ghosts === 0, 'the dossier lands on the shelf');
      assert.deepEqual(d.replicas.map(r => [r.id, r.title, r.folder, r.sheets]), [[ids.one, one, 'false', '1']], 'its replica: its title, one sheet, no folder');
      assert.equal(d.focused, ids.one, 'the focus goes with it to its replica: ' + await page.evaluate(() => { const a = document.activeElement; return a ? `${a.tagName}#${a.id}.${a.className}` : 'none'; }));
      assert.ok(d.feed.includes(ids.two) && d.feed.includes(ids.three), 'the other dossiers stay in the feed');
      assert.equal(d.more, false, 'the feed draws no Archived (N)'); seen.push('archived: replica, focus, feed');
      await archive(ids.three);
      d = await becomes(d => d.replicas.length === 2 && !d.feed.includes(ids.three) && d.ghosts === 0, 'a second dossier lands');
      assert.deepEqual(d.replicas.find(r => r.id === ids.three), { id: ids.three, title: three, folder: 'true', sheets: '2' }, 'a dossier of two messages: a folder, two sheets');
      assert.deepEqual(d.replicas.map(r => r.id), [ids.three, ids.one], 'latest on top: the one just archived goes first on the shelf'); seen.push('latest on top');
      await page.reload(); await page.locator('body[data-ready=true]').waitFor();
      d = await becomes(d => d.replicas.length === 2 && d.feed.includes(ids.two), 'after a reload, Core holds both archived');
      assert.deepEqual(d.feed.filter(id => id === ids.one || id === ids.three), [], 'the feed never shows an archived dossier'); seen.push('reload keeps the shelf');
      await page.locator(`.shelf-dossier[data-id="${ids.one}"]`).click({ button: 'right' });
      assert.deepEqual(await page.locator('.message-menu-list [role^=menuitem]').allTextContents(), ['Bring back'], 'the right-click menu: Bring back alone');
      await page.keyboard.press('Escape');
      d = await drawn(page); assert.equal(d.replicas.length, 2, 'opening the menu brings nothing back');
      // The menu goes away with any other action (1027): a wheel or trackpad swipe over the feed, the window losing focus.
      const menuOpen = () => page.locator('.message-menu-list[aria-label="Archived dossier"]').count();
      await page.locator(`.shelf-dossier[data-id="${ids.one}"]`).click({ button: 'right' }); assert.equal(await menuOpen(), 1, 'the menu opens');
      await page.mouse.move(400, 400); await page.mouse.wheel(0, 120);
      await page.waitForFunction(() => !document.querySelector('.message-menu-list[aria-label="Archived dossier"]')).catch(() => {});
      assert.equal(await menuOpen(), 0, 'a wheel over the feed closes the menu');
      await page.locator(`.shelf-dossier[data-id="${ids.one}"]`).click({ button: 'right' }); assert.equal(await menuOpen(), 1, 'the menu opens again');
      await page.evaluate(() => window.dispatchEvent(new Event('blur')));
      assert.equal(await menuOpen(), 0, 'the window losing focus closes the menu');
      d = await drawn(page); assert.equal(d.replicas.length, 2, 'closing the menu brings nothing back'); seen.push('menu closes on other actions');
      await page.locator(`.shelf-dossier[data-id="${ids.one}"]`).click();
      d = await becomes(d => d.feed.includes(ids.one) && d.replicas.length === 1 && d.ghosts === 0, 'a click brings it back to the feed');
      assert.deepEqual(d.replicas.map(r => r.id), [ids.three]); seen.push('click brings back');
      // A window too short for the rail: the shelf keeps its heading and a row in view, and the dossier lands on its
      // replica there, never below the window.
      await page.setViewportSize({ width: 1280, height: 380 });
      // A Notebook long enough to fill the rail (a stand-in for many pages, ahead of the shelf in the rail's order).
      await page.evaluate(() => { const long = document.createElement('div'); long.id = 'long-notebook-stand-in'; long.style.cssText = 'height:900px;flex:none';
        document.getElementById('things').prepend(long); });
      // Where the flight is aimed: the paper's box moved by its last keyframe, read as it starts.
      await page.evaluate(() => { window.landed = null; new MutationObserver((records, watcher) => { for (const r of records) for (const g of r.addedNodes) {
        if (!g.classList?.contains('shelf-ghost')) continue; const last = g.getAnimations()[0]?.effect.getKeyframes().at(-1);
        const m = /translate\(([-\d.e]+)px, ?([-\d.e]+)px\) scale\(([-\d.e]+), ?([-\d.e]+)\)/.exec(last?.transform ?? ''); if (!m) continue;
        const [x, y, sx, sy] = m.slice(1).map(Number), w = parseFloat(g.style.width), h = parseFloat(g.style.height);
        window.landed = { left: parseFloat(g.style.left) + x, top: parseFloat(g.style.top) + y, width: w * sx, height: h * sy }; watcher.disconnect(); } }).observe(document.body, { childList: true }); });
      await archive(ids.two);
      d = await becomes(d => d.replicas.length === 2 && !d.feed.includes(ids.two) && d.ghosts === 0, 'it lands in a short window');
      assert.equal(d.replicas[0].id, ids.two, 'the one just archived is first');
      // Measured once its landing pop (a scale) has finished.
      await page.waitForFunction(id => document.querySelector(`.shelf-dossier[data-id="${id}"]`)?.getAnimations().length === 0, ids.two);
      const at = await page.evaluate(id => { const r = document.querySelector(`.shelf-dossier[data-id="${id}"]`).getBoundingClientRect(); return { left: r.left, top: r.top, width: r.width, bottom: r.bottom, height: innerHeight }; }, ids.two);
      assert.ok(at.top >= 0 && at.bottom <= at.height + 1, 'its replica is in the window: ' + JSON.stringify(at));
      const landed = await page.evaluate(() => window.landed);
      assert.ok(landed && Math.abs(landed.left - at.left) < 3 && Math.abs(landed.top - at.top) < 3 && Math.abs(landed.width - at.width) < 3, `the flight ends on its replica: ${JSON.stringify(landed)} at ${JSON.stringify(at)}`);
      await page.locator(`.shelf-dossier[data-id="${ids.two}"]`).click();
      d = await becomes(d => d.feed.includes(ids.two) && d.replicas.length === 1 && d.ghosts === 0, 'brought back from the short window');
      await page.evaluate(() => document.getElementById('long-notebook-stand-in').remove());
      await page.setViewportSize({ width: 1280, height: 900 }); seen.push('lands in view in a short window');
      for (const [to, wants] of [[there, 0], [here, 1], [there, 0], [here, 1]]) {
        await page.evaluate(id => document.querySelector(`#rail a[href$="topic=${id}"]`).click(), to);
        d = await becomes(d => d.replicas.length === wants && d.feed.includes(wants ? ids.two : away.elsewhere) && !d.feed.includes(wants ? away.elsewhere : ids.two), `moved in place to ${to}`);
        assert.equal(d.shelves <= 1, true, `one shelf in the rail after moving to ${to}, not ${d.shelves}`);
      }
      seen.push('one shelf across in-place moves');
      await page.screenshot({ path: `${evidence}/${key}.png` });
      assert.deepEqual(pageErrors, []);
    } catch (e) { error = e; await page.screenshot({ path: `${evidence}/${key}-failed.png` }).catch(() => {}); }
    results.push({ key, seen, error: error ? String(error.stack ?? error) : null }); await context.close();
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

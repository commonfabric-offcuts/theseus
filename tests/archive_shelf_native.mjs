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
      folder: r.dataset.folder, sheets: r.dataset.sheets, card: r.style.getPropertyValue('--replica-card'), popup: r.getAttribute('aria-haspopup') })) : [],
    feed: [...document.querySelectorAll('#messages .reply-stack')].filter(shown).map(s => s.dataset.stack),
    more: [...document.querySelectorAll('#messages .stack-more')].some(shown), ghosts: document.querySelectorAll('.shelf-ghost').length,
    focused: document.activeElement?.closest?.('.shelf-dossier')?.dataset.id ?? null,
    focusedMore: Boolean(document.activeElement?.classList?.contains('stack-more')),
    focusedStack: document.activeElement?.closest?.('#messages .reply-stack')?.dataset.stack ?? null,
    earlier: shown(document.getElementById('more-messages')) };
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
    // A topic longer than the page first loads, for Earlier messages beside the shelf.
    const long = `shelf-${scheme}-long`, older = await seed(long, Array.from({ length: 34 }, (_, n) => said('m' + n, { join: true, read: n === 33, body: `Older check ${n}.` })));
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, colorScheme: scheme });
    // Each replica's card colour as it first reaches the page, before any later redraw can repair it.
    // And every flight: how many copies flew, and the most in the air at once.
    // And any ResizeObserver loop the page reports (the shelf turning on or off resizes the rail it watches).
    await context.addInitScript(() => { window.roLoops = []; addEventListener('error', e => { if (/ResizeObserver loop/.test(e.message)) window.roLoops.push(e.message); }); });
    await context.addInitScript(() => { window.firstCards = []; window.flights = 0; window.mostInAir = 0; new MutationObserver(records => { for (const r of records) for (const n of r.addedNodes) {
      const replica = n.querySelector?.('.shelf-dossier'); if (replica) window.firstCards.push(replica.style.getPropertyValue('--replica-card'));
      if (n.classList?.contains('shelf-ghost')) { window.flights += 1; window.mostInAir = Math.max(window.mostInAir, document.querySelectorAll('.shelf-ghost').length); } } })
      .observe(document, { childList: true, subtree: true }); });
    const page = await context.newPage(), pageErrors = []; page.on('pageerror', e => pageErrors.push(e.message));
    page.on('console', m => { if (/ResizeObserver loop/.test(m.text())) pageErrors.push('console: ' + m.text()); }); page.setDefaultTimeout(5000);
    const seen = []; let error;
    const becomes = async (test, why) => { await page.waitForFunction(() => true); const end = Date.now() + 5000;
      for (let d; Date.now() < end;) { d = await drawn(page); if (test(d)) return d; await page.waitForTimeout(40); } throw Error(why + ': ' + JSON.stringify(await drawn(page))); };
    const section = id => `#messages .reply-stack[data-stack="${id}"]`;
    const nameOf = id => page.locator(`${section(id)} .stack-name`).first().textContent();
    const archive = async (id, on = page) => { const tool = on.locator(`${section(id)} [aria-label="Archive"]`).first();
      await on.locator(section(id)).first().hover(); await tool.click(); };
    try {
      await page.goto(`${facts.origin}/?topic=${here}`); await page.locator('body[data-ready=true]').waitFor();
      let d = await becomes(d => d.feed.includes(ids.one) && d.feed.includes(ids.three), 'the feed draws its dossiers');
      assert.equal(d.shelfShown, false, 'nothing archived: no shelf'); seen.push('no shelf before archiving');
      const one = (await nameOf(ids.one)).trim(), three = (await nameOf(ids.three)).trim();
      await archive(ids.one);
      d = await becomes(d => d.replicas.length === 1 && !d.feed.includes(ids.one) && d.ghosts === 0, 'the dossier lands on the shelf');
      assert.deepEqual(d.replicas.map(r => [r.id, r.title, r.folder, r.sheets]), [[ids.one, one, 'false', '1']], 'its replica: its title, one sheet, no folder');
      assert.ok(await page.evaluate(() => window.flights) >= 1, 'the first archive into an empty shelf flies');
      assert.equal(d.focused, ids.one, 'the focus goes with it to its replica: ' + await page.evaluate(() => { const a = document.activeElement; return a ? `${a.tagName}#${a.id}.${a.className}` : 'none'; }));
      assert.ok(d.feed.includes(ids.two) && d.feed.includes(ids.three), 'the other dossiers stay in the feed');
      assert.equal(d.more, false, 'the feed draws no Archived (N)'); seen.push('archived: replica, focus, feed');
      // The one-key undo works where the focus went: on the replica.
      await page.keyboard.press('Meta+z');
      d = await becomes(d => d.replicas.length === 0 && d.feed.includes(ids.one), 'Cmd-Z at the replica puts the dossier back');
      await page.waitForFunction(() => !document.querySelector('.shelf-ghost'));
      await archive(ids.one);
      d = await becomes(d => d.replicas.length === 1 && !d.feed.includes(ids.one) && d.ghosts === 0, 'archived again'); seen.push('Cmd-Z at the replica undoes');
      // Undone while it still flies: its flight goes with its replica, and only the flight back is in the air.
      await page.keyboard.press('Meta+z'); d = await becomes(d => d.replicas.length === 0 && d.feed.includes(ids.one) && d.ghosts === 0, 'undone');
      await page.evaluate(() => { window.mostInAir = 0; window.flights = 0; });
      await page.evaluate(id => { document.querySelector(`#messages .reply-stack[data-stack="${id}"] [aria-label="Archive"]`).click();
        document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', metaKey: true, bubbles: true, cancelable: true })); }, ids.one);
      d = await becomes(d => d.replicas.length === 0 && d.feed.includes(ids.one) && d.ghosts === 0, 'undone mid-flight');
      assert.equal(await page.evaluate(() => window.mostInAir), 1, 'undone mid-flight: one copy in the air at a time');
      // The shelf emptied: the next archive flies again.
      await page.evaluate(() => { window.flights = 0; }); await archive(ids.one);
      d = await becomes(d => d.replicas.length === 1 && !d.feed.includes(ids.one) && d.ghosts === 0, 'archived into the emptied shelf');
      assert.ok(await page.evaluate(() => window.flights) >= 1, 'an archive into a shelf emptied again flies'); seen.push('undo mid-flight, first archive flies');
      await archive(ids.three);
      d = await becomes(d => d.replicas.length === 2 && !d.feed.includes(ids.three) && d.ghosts === 0, 'a second dossier lands');
      assert.deepEqual(d.replicas.filter(r => r.id === ids.three).map(r => [r.id, r.title, r.folder, r.sheets]), [[ids.three, three, 'true', '2']], 'a dossier of two messages: a folder, two sheets');
      assert.deepEqual(d.replicas.map(r => r.id), [ids.three, ids.one], 'latest on top: the one just archived goes first on the shelf'); seen.push('latest on top');
      // Archived elsewhere (another tab, as another device would), it arrives by a live update and keeps Core's
      // order after this page's own archives: not first, as if just put away here.
      const elsewhere = await context.newPage(); elsewhere.on('pageerror', e => pageErrors.push('elsewhere: ' + e.message)); elsewhere.setDefaultTimeout(5000);
      await elsewhere.goto(`${facts.origin}/?topic=${here}`); await elsewhere.locator('body[data-ready=true]').waitFor();
      await elsewhere.locator(section(ids.two)).first().waitFor(); await archive(ids.two, elsewhere);
      d = await becomes(d => d.replicas.length === 3, 'the dossier archived in another tab reaches the shelf');
      assert.deepEqual(d.replicas.map(r => r.id), [ids.three, ids.one, ids.two], 'archived elsewhere: after this page\'s own archives');
      await elsewhere.close();
      await page.locator(`.shelf-dossier[data-id="${ids.two}"]`).click();
      d = await becomes(d => d.replicas.length === 2 && d.feed.includes(ids.two) && d.ghosts === 0, 'brought back'); seen.push('archived elsewhere keeps Core order');
      await page.reload(); await page.locator('body[data-ready=true]').waitFor();
      d = await becomes(d => d.replicas.length === 2 && d.feed.includes(ids.two), 'after a reload, Core holds both archived');
      assert.deepEqual(d.feed.filter(id => id === ids.one || id === ids.three), [], 'the feed never shows an archived dossier'); seen.push('reload keeps the shelf');
      const firstCards = await page.evaluate(() => window.firstCards);
      assert.ok(firstCards.length >= 2 && firstCards.every(card => card && card !== 'rgba(0, 0, 0, 0)'), 'on the first drawing each replica takes its card\'s colour: ' + JSON.stringify(firstCards)); seen.push('replica colours on first drawing');
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
      // A replica is a button that brings its dossier back; its menu is the right-click's, so it announces no menu.
      assert.deepEqual(d.replicas.map(r => r.popup), [null, null], 'a replica announces no menu');
      // Brought back elsewhere while its menu is open here: the menu goes, and the keys go to the shelf, not the page's body.
      await page.locator(`.shelf-dossier[data-id="${ids.one}"]`).click({ button: 'right' }); assert.equal(await menuOpen(), 1, 'the menu opens once more');
      assert.equal(await page.evaluate(() => Boolean(document.activeElement?.closest('.message-menu-list'))), true, 'the menu holds the keys');
      const tab = await context.newPage(); tab.on('pageerror', e => pageErrors.push('tab: ' + e.message)); tab.setDefaultTimeout(5000);
      await tab.goto(`${facts.origin}/?topic=${here}`); await tab.locator('body[data-ready=true]').waitFor();
      await tab.locator(`.shelf-dossier[data-id="${ids.one}"]`).click(); await tab.close();
      d = await becomes(d => d.replicas.length === 1 && d.feed.includes(ids.one), 'brought back in another tab');
      assert.equal(await menuOpen(), 0, 'its menu went with it');
      assert.equal(await page.evaluate(() => document.activeElement?.closest('.shelf-dossier')?.dataset.id ?? document.activeElement?.tagName), ids.three, 'the keys went to the shelf');
      await archive(ids.one); d = await becomes(d => d.replicas.length === 2 && d.ghosts === 0, 'archived again');
      await page.locator(`.shelf-dossier[data-id="${ids.three}"]`).focus(); seen.push('menu removed under the keys');
      // A double-click brings back the one replica pressed, not the next one closing up under the second click.
      // The first on the shelf, so the next one closes up under the pointer.
      const [first, other] = d.replicas.map(r => r.id);
      await page.locator(`.shelf-dossier[data-id="${first}"]`).dblclick();
      d = await becomes(d => d.feed.includes(first) && d.replicas.length === 1 && d.ghosts === 0, 'a click brings it back to the feed');
      await page.waitForTimeout(300); d = await drawn(page);
      assert.deepEqual(d.replicas.map(r => r.id), [other], 'a double-click brings back one dossier');
      // On with the third alone on the shelf, the first in the feed.
      if (first === ids.three) {
        await page.locator(`.shelf-dossier[data-id="${ids.one}"]`).click(); await becomes(d => d.feed.includes(ids.one) && d.ghosts === 0, 'the first brought back');
        await archive(ids.three); await becomes(d => d.replicas.length === 1 && d.replicas[0].id === ids.three && d.ghosts === 0, 'the third archived again');
      }
      seen.push('one dossier per double-click');
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
      assert.equal(d.focusedStack, ids.two, 'brought back by a click, the dossier keeps the keys'); seen.push('focus on the dossier brought back');
      await page.evaluate(() => document.getElementById('long-notebook-stand-in').remove());
      await page.setViewportSize({ width: 1280, height: 900 }); seen.push('lands in view in a short window');
      // Two archived at once: the first flight turns toward where its replica stands once the second goes first.
      const aims = await page.evaluate(([a, b]) => {
        const press = id => document.querySelector(`#messages .reply-stack[data-stack="${id}"] [aria-label="Archive"]`).click();
        press(a); press(b);
        const ghosts = [...document.querySelectorAll('.shelf-ghost')].map(g => { const last = g.getAnimations()[0]?.effect.getKeyframes().at(-1);
          const m = /translate\(([-\d.e]+)px, ?([-\d.e]+)px\)/.exec(last?.transform ?? ''); return m ? { left: parseFloat(g.style.left) + +m[1], top: parseFloat(g.style.top) + +m[2] } : null; });
        const at = id => { const r = document.querySelector(`.shelf-dossier[data-id="${id}"]`).getBoundingClientRect(); return { left: r.left, top: r.top }; };
        return { ghosts, first: at(a), second: at(b) };
      }, [ids.two, ids.one]);
      assert.ok(aims.ghosts.length === 2 && aims.ghosts.every(Boolean), 'two flights: ' + JSON.stringify(aims));
      for (const [ghost, at] of [[aims.ghosts[0], aims.first], [aims.ghosts[1], aims.second]]) assert.ok(Math.abs(ghost.left - at.left) < 3 && Math.abs(ghost.top - at.top) < 3, 'each flight ends on its own replica: ' + JSON.stringify(aims));
      d = await becomes(d => d.replicas.length === 3 && d.ghosts === 0, 'both land');
      assert.deepEqual(d.replicas.map(r => r.id), [ids.one, ids.two, ids.three]); seen.push('two flights at once land on their own replicas');
      // Where the rail is not beside the page, the shelf is not drawn: the feed keeps Archived (N) and the focus after
      // Archive goes to More, as before the shelf. Back beside the page, the shelf is drawn again.
      const notBeside = async (why, enter, leave) => {
        await enter();
        d = await becomes(d => !d.shelfShown && d.more, `${why}: the feed keeps Archived (N)`);
        await page.locator('#messages .stack-more').click();
        d = await becomes(d => d.feed.includes(ids.one) && d.feed.includes(ids.three), `${why}: Archived (N) opens in the feed`);
        await page.locator('#messages .stack-more').click();
        await leave();
        d = await becomes(d => d.shelfShown && !d.more && d.replicas.length === 3 && !d.feed.includes(ids.one), `${why}, then beside again: the shelf, no Archived (N)`);
      };
      await notBeside('a 1000px window', () => page.setViewportSize({ width: 1000, height: 900 }), () => page.setViewportSize({ width: 1280, height: 900 }));
      await notBeside('the Notebook docked', () => page.evaluate(() => document.body.classList.add('notebook-docked')), () => page.evaluate(() => document.body.classList.remove('notebook-docked')));
      await notBeside('the rail hidden', () => page.evaluate(() => { document.getElementById('things').hidden = true; }), () => page.evaluate(() => { document.getElementById('things').hidden = false; }));
      // Archive at 1000px: no flight into the corner, the focus on More.
      await page.locator(`.shelf-dossier[data-id="${ids.two}"]`).click(); await becomes(d => d.feed.includes(ids.two) && d.ghosts === 0, 'brought back to archive at 1000px');
      await page.setViewportSize({ width: 1000, height: 900 }); await becomes(d => !d.shelfShown && d.more, 'at 1000px');
      await page.evaluate(() => { window.flew = 0; new MutationObserver(r => { for (const x of r) for (const g of x.addedNodes) if (g.classList?.contains('shelf-ghost')) window.flew += 1; }).observe(document.body, { childList: true }); });
      await archive(ids.two);
      d = await becomes(d => d.focusedMore, 'archived at 1000px: the focus on More');
      assert.equal(await page.evaluate(() => window.flew), 0, 'nothing flies where the shelf is not drawn');
      // Opened at that width, Archived (N) stays out of the feed once the shelf is drawn beside it.
      await page.locator('#messages .stack-more').click(); await becomes(d => d.feed.includes(ids.one), 'opened at 1000px');
      await page.setViewportSize({ width: 1280, height: 900 });
      d = await becomes(d => d.shelfShown && !d.feed.includes(ids.one) && !d.feed.includes(ids.two), 'widened: on the shelf alone, not in the feed too'); seen.push('rail not beside: Archived (N), focus on More, no flight');
      // The phone's Pipeline & pages sheet is the phone's, whatever the shelf holds.
      await page.setViewportSize({ width: 390, height: 844 });
      await page.locator('#things-open').click();
      const sheet = await page.evaluate(() => ({ height: document.getElementById('things').getBoundingClientRect().height, window: innerHeight }));
      assert.ok(sheet.height <= sheet.window * 0.82 + 1, 'the phone\'s sheet keeps its 82% height: ' + JSON.stringify(sheet));
      await page.keyboard.press('Escape'); await page.setViewportSize({ width: 1280, height: 900 }); seen.push('phone sheet unchanged');
      for (const id of [ids.one, ids.two]) { await page.locator(`.shelf-dossier[data-id="${id}"]`).click(); await becomes(d => d.feed.includes(id) && d.ghosts === 0, 'brought back ' + id); }
      // Archived (N) opened at 1000px and emptied there, then widened: the next archive goes to the shelf alone,
      // never also into the feed below a hidden More.
      await page.setViewportSize({ width: 1000, height: 900 }); await becomes(d => !d.shelfShown && d.more, 'at 1000px again');
      await page.locator('#messages .stack-more').click(); await becomes(d => d.feed.includes(ids.three), 'Archived (N) opened');
      await page.locator(`${section(ids.three)} [aria-label="Bring back"]`).first().click();
      await becomes(d => d.feed.includes(ids.three) && !d.more, 'the last brought back in the feed');
      await page.setViewportSize({ width: 1280, height: 900 }); await becomes(d => !d.shelfShown, 'widened, nothing archived');
      const both = await page.evaluate(async id => {
        document.querySelector(`#messages .reply-stack[data-stack="${id}"] [aria-label="Archive"]`).click();
        // Looked at before Core's answer can arrive (its arrange would hide the dossier anyway): only the page's own work.
        for (let i = 0; i < 3; i += 1) await Promise.resolve();
        const s = document.querySelector(`#messages .reply-stack[data-stack="${id}"]`);
        return { inFeed: Boolean(s && s.getClientRects().length && !s.hidden), onShelf: Boolean(document.querySelector(`.shelf-dossier[data-id="${id}"]`)?.getClientRects().length) };
      }, ids.two);
      assert.deepEqual(both, { inFeed: false, onShelf: true }, 'the first archive once widened: on the shelf, not in the feed');
      await becomes(d => d.ghosts === 0, 'landed');
      // The shelf took over Archived (N): narrowed again, it comes back closed, its dossier not in the feed.
      await page.setViewportSize({ width: 1000, height: 900 });
      d = await becomes(d => !d.shelfShown && d.more, 'narrowed again: Archived (N) is back');
      assert.equal(d.feed.includes(ids.two), false, 'narrowed again: Archived (N) closed, its dossier not in the feed');
      await page.setViewportSize({ width: 1280, height: 900 }); await becomes(d => d.shelfShown && d.replicas.length === 1, 'widened again');
      await page.locator(`.shelf-dossier[data-id="${ids.two}"]`).click(); await becomes(d => d.feed.includes(ids.two) && d.ghosts === 0, 'two brought back');
      await archive(ids.three); await becomes(d => d.replicas.length === 1 && d.replicas[0].id === ids.three && d.ghosts === 0, 'three on the shelf again'); seen.push('shelf taking over closes Archived (N)');
      for (const [to, wants] of [[there, 0], [here, 1], [there, 0], [here, 1]]) {
        await page.evaluate(id => document.querySelector(`#rail a[href$="topic=${id}"]`).click(), to);
        d = await becomes(d => d.replicas.length === wants && d.feed.includes(wants ? ids.two : away.elsewhere) && !d.feed.includes(wants ? away.elsewhere : ids.two), `moved in place to ${to}`);
        assert.equal(d.shelves <= 1, true, `one shelf in the rail after moving to ${to}, not ${d.shelves}`);
      }
      seen.push('one shelf across in-place moves');
      // A topic longer than the page loads, with a dossier archived: Earlier messages still loads older messages.
      await page.goto(`${facts.origin}/?topic=${long}`); await page.locator('body[data-ready=true]').waitFor();
      d = await becomes(d => d.feed.includes(older.m33) && d.earlier, 'the long topic offers earlier messages');
      await archive(older.m33);
      d = await becomes(d => d.replicas.length === 1 && d.ghosts === 0, 'archived in the long topic');
      assert.equal(d.earlier, true, 'with the shelf drawn, Earlier messages is still there'); seen.push('earlier messages beside the shelf');
      await page.screenshot({ path: `${evidence}/${key}.png` });
      assert.deepEqual(await page.evaluate(() => window.roLoops), [], 'no ResizeObserver loop as the shelf turns on and off');
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

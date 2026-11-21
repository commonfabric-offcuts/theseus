// Native paper flights (1019, designer's prototype for Tony) in an isolated HTTP/Core instance: a Note sent from
// the pencil sheet goes onto its page's row in the right rail and the Notebook then opens out of that row; sent
// with the Notebook open, it flies in and the page shows only as it lands; closing flies the page back onto its
// row; a Note is written on the Notebook's paper; a message folding closes onto its row and what is under it
// slides up, and unfolding opens it back out. Every frame is watched, so "shows too early" is a frame count.
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

// In the page before anything runs: every animation started (what, its frames), and on every frame whether a paper
// is in flight, where it is, whether the watched words show anywhere, and where the watched page's row is.
const watcher = () => {
  const box = n => { const r = n.getBoundingClientRect(); return { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) }; };
  const seen = n => { if (!n.getClientRects().length) return false; let o = 1; for (let e = n; e && e.nodeType === 1; e = e.parentElement) { const cs = getComputedStyle(e); if (cs.visibility === 'hidden' || cs.display === 'none') return false; o *= +cs.opacity; } return o > 0.05; };
  window.flightLog = { animations: [], frames: [], words: null, page: null };
  const animate = Element.prototype.animate;
  Element.prototype.animate = function (frames, options) {
    window.flightLog.animations.push({ t: performance.now(), id: this.id, cls: String(this.className), stack: this.dataset?.stack ?? null, entry: this.dataset?.id ?? null, frames: JSON.parse(JSON.stringify(frames)), rect: box(this) });
    return animate.call(this, frames, options);
  };
  const tick = () => {
    const log = window.flightLog, ghost = document.querySelector('.paper-ghost');
    // The watched page's row: by its id, or before the id is known, by its words.
    const row = [...document.querySelectorAll('#things-notebook-body a.row')].find(a => log.page ? new URLSearchParams((a.getAttribute('href') ?? '').split('?')[1] ?? '').get('page') === log.page : log.words && a.textContent.includes(log.words)) ?? null;
    const showing = log.words ? [...document.querySelectorAll('body *:not(.paper-ghost):not(.paper-ghost *)')].filter(n => !n.closest('.paper-ghost, #inline-composer, #new-message-sheet') && n.children.length === 0 && n.textContent.includes(log.words) && seen(n))
      .map(n => n.closest('#things') ? 'rail' : n.closest('#notebook-sheet-dialog') ? 'notebook' : 'elsewhere') : [];
    const dialog = document.getElementById('notebook-sheet-dialog');
    log.frames.push({ t: performance.now(), ghost: ghost ? box(ghost) : null, showing: [...new Set(showing)], row: row ? { ...box(row), landing: row.classList.contains('paper-landing'), seen: seen(row) } : null, open: Boolean(dialog?.open) });
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
};
const NOTE_GROUND = { 'bookends-dark': 'rgb(11, 15, 16)', 'bookends-light': 'rgb(11, 15, 16)', 'paper-dark': 'rgb(242, 238, 229)', 'paper-light': 'rgb(251, 248, 241)' };
// The point a paper lands on: where it started, moved by its last frame's translate.
const landedAt = animation => { const [, x, y] = animation.frames.at(-1).transform.match(/translate\(([-\d.]+)px,\s*([-\d.]+)px\)/); return { x: animation.rect.x + +x, y: animation.rect.y + +y }; };
const near = (a, b, why) => assert.ok(Math.abs(a.x - b.x) <= 3 && Math.abs(a.y - b.y) <= 3, `${why}: ${JSON.stringify(a)} against ${JSON.stringify(b)}`);
try {
  const facts = await control({ method: 'ready' });
  profile = await mkdtemp(`${evidence}/${engine}-profile-`);
  const persistent = await playwright[engine].launchPersistentContext(profile, { headless: true, ...(engine === 'chromium' ? { executablePath: process.env.AIM_CHROME } : {}) });
  browser = persistent.browser(); for (const p of ps()) if (p.command.includes(profile)) owned.add(p.pid); retainChildren(); assert.ok(owned.size);
  for (const [look, scheme, motion] of [['', 'dark', 'full'], ['paper', 'light', 'full'], ['', 'dark', 'reduce']]) {
    const key = `${engine}-laptop-${look || 'bookends'}-${scheme}-${motion}`, seen = [];
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: scheme, reducedMotion: motion === 'reduce' ? 'reduce' : 'no-preference' });
    await context.addInitScript(look => { if (look) localStorage.setItem('theseus-look', look); }, look);
    await context.addInitScript(watcher);
    const page = await context.newPage(), pageErrors = []; page.on('pageerror', e => pageErrors.push(e.message)); page.setDefaultTimeout(6000);
    const log = () => page.evaluate(() => window.flightLog);
    const watch = (words, id = null) => page.evaluate(([words, id]) => { const log = window.flightLog; log.words = words; log.page = id; log.frames = []; log.animations = []; }, [words, id]);
    const settled = () => page.waitForFunction(() => !document.querySelector('.paper-ghost') && !document.body.classList.contains('paper-sending') && !document.getAnimations().some(a => a.playState === 'running'));
    const sendNote = async (title, { sheet = false, onto = null } = {}) => {
      if (sheet) { await page.locator('#new-message').click(); await page.locator('#new-message-sheet[open]').waitFor(); }
      else await page.locator('#inline-writing-body').click();
      await page.locator('#inline-kind-note-card').click();
      await page.waitForFunction(() => document.querySelector('#inline-kind-note-card').getAttribute('aria-checked') === 'true');
      if (onto) { const label = (await page.locator('#inline-note-page option').allTextContents()).find(o => o.includes(onto)); assert.ok(label, 'the page to add to is offered'); await page.locator('#inline-note-page').selectOption({ label }); }
      await page.locator('#inline-writing-body').fill(`${title}\nTwo rows of beans.`);
      await watch(title, onto ? 'fixture-notebook' : null);
      await page.locator('#inline-send').click();
      await page.waitForFunction(([title, onto]) => document.getElementById('notebook-sheet-dialog')?.open && (onto ? [...document.querySelectorAll('#notebook-sheet-dialog .deck-card')].some(c => c.textContent.includes(title)) : document.getElementById('notebook-sheet-title')?.textContent.includes(title)), [title, onto]);
      await settled();
      return log();
    };
    let error;
    try {
      await page.goto(`${facts.origin}/?topic=t1`); await page.locator('body[data-ready=true]').waitFor();
      assert.equal(await page.evaluate(() => document.documentElement.dataset.look ?? ''), look);
      // A Note is written on the Notebook's paper; a Message is not.
      await page.locator('#inline-writing-body').click();
      const ground = () => page.locator('#inline-composer').evaluate(n => getComputedStyle(n).backgroundColor);
      // The Notebook's own panel colour, resolved as a colour inside the Notebook.
      const notebookPanel = await page.evaluate(() => { const d = document.createElement('dialog'), probe = document.createElement('i');
        d.className = 'notebook-sheet-dialog'; probe.style.background = 'var(--panel)'; d.append(probe); document.body.append(d);
        const c = getComputedStyle(probe).backgroundColor; d.remove(); return c; });
      assert.equal(notebookPanel, NOTE_GROUND[`${look || 'bookends'}-${scheme}`], 'the Notebook panel of this look');
      const message = await ground();
      await page.locator('#inline-kind-note-card').click();
      assert.equal(await page.locator('#inline-composer').getAttribute('data-kind'), 'note-card');
      assert.equal(await ground(), notebookPanel, 'a Note takes the Notebook\'s panel');
      await page.locator('#inline-kind-message').click();
      assert.equal(await ground(), message, 'a Message keeps its own ground'); assert.notEqual(message, notebookPanel);
      seen.push('note paper');
      await page.keyboard.press('Escape');

      // Send with the Notebook shut, a card added to the topic's page: onto its row, a beat, then the Notebook opens
      // out of it. (This fixture's rail does not hear of a page made after it is drawn, so a new page's row, which
      // is held back until the paper lands, is checked on a running app, not here.)
      const first = `Flight one ${look || 'bookends'} ${scheme} ${motion}`;
      let l = await sendNote(first, { onto: 'Image Notebook' });
      const flying = l.frames.filter(f => f.ghost);
      if (motion === 'reduce') {
        assert.equal(flying.length, 0, 'reduced motion: nothing flies'); assert.equal(l.animations.filter(a => a.id === 'notebook-sheet-dialog').length, 0, 'reduced motion: no growing');
        seen.push('reduced motion: the page opens, nothing flies');
      } else {
        assert.ok(flying.length > 3, 'a paper flies');
        assert.deepEqual(flying.flatMap(f => f.showing), [], 'nothing of the new page shows while the paper flies');
        const lastFlying = l.frames.lastIndexOf(flying.at(-1)), after = l.frames.slice(lastFlying + 1);
        const ghostFlight = l.animations.filter(a => a.cls.includes('paper-ghost') && a.frames.length === 3).at(-1);
        const rowThen = flying.at(-1).row ?? after.find(f => f.row)?.row;
        assert.ok(rowThen, 'the page has a row in the rail as the paper lands');
        near(landedAt(ghostFlight), rowThen, 'the paper lands on its row');
        const beat = after.findIndex(f => f.open);
        assert.ok(beat > 2 && after.slice(0, beat).every(f => f.row?.seen), 'the row shows for a beat before the Notebook opens: ' + beat);
        const grow = l.animations.find(a => a.id === 'notebook-sheet-dialog' && /scale/.test(a.frames[0].transform ?? ''));
        assert.ok(grow, 'the Notebook grows as it opens');
        near(landedAt({ rect: grow.rect, frames: [grow.frames[0]] }), rowThen, 'it grows out of the row');
        seen.push('two stages: onto the row, a beat, open out of it');
      }

      // Send with the Notebook open: the paper flies in and the page shows only as it lands.
      const second = `Flight two ${look || 'bookends'} ${scheme} ${motion}`;
      l = await sendNote(second, { sheet: true });
      if (motion !== 'reduce') {
        const flying2 = l.frames.filter(f => f.ghost);
        assert.ok(flying2.length > 3, 'a paper flies into the open Notebook');
        assert.deepEqual(flying2.flatMap(f => f.showing), [], 'the page shows only once the paper lands');
        assert.ok(l.frames.slice(l.frames.lastIndexOf(flying2.at(-1)) + 1).some(f => f.showing.includes('notebook')), 'then it shows');
        seen.push('open Notebook: the page waits for the paper');
      }

      // Closing flies the page onto its own row, beside the feed and as the full sheet; opening grows out of it. The
      // topic's listed page, opened from its row.
      await page.keyboard.press('Escape'); await page.waitForFunction(() => !document.getElementById('notebook-sheet-dialog').open); await settled();
      await page.locator('#things-notebook-body a.row[href*="page=fixture-notebook"]').click(); await page.locator('#notebook-sheet-dialog[open]').waitFor(); await settled();
      for (const docked of [true, false]) {
        const dialog = page.locator('#notebook-sheet-dialog');
        if (await dialog.evaluate(n => n.classList.contains('notebook-docked')) !== docked) {
          await dialog.locator('.notebook-menu').click(); await page.getByRole('menuitemcheckbox', { name: 'Side by side', exact: true }).click();
          await page.waitForFunction(docked => document.getElementById('notebook-sheet-dialog').classList.contains('notebook-docked') === docked, docked);
        }
        const id = 'fixture-notebook';
        await watch(null, id);
        await dialog.locator('.notebook-sheet-close').click(); await settled();
        l = await log();
        if (motion === 'reduce') {
          assert.equal(l.frames.filter(f => f.ghost).length, 0, 'reduced motion: closing flies nothing');
          await watch(null, id); await page.locator(`#things-notebook-body a.row[href*="page=${id}"]`).click(); await page.locator('#notebook-sheet-dialog[open]').waitFor(); await settled();
          assert.equal((await log()).animations.filter(a => a.id === 'notebook-sheet-dialog').length, 0, 'reduced motion: opening grows nothing');
          seen.push(`reduced motion: close and open without motion (${docked ? 'beside' : 'full sheet'})`); continue;
        }
        const back = l.animations.filter(a => a.cls.includes('paper-ghost') && a.frames.length === 3).at(-1);
        assert.ok(back, `closing ${docked ? 'beside' : 'the full sheet'} flies the page`);
        const row = l.frames.at(-1).row; assert.ok(row?.seen, 'its row shows in the rail');
        near(landedAt(back), row, `closing ${docked ? 'beside' : 'the full sheet'}: onto its own row`);
        await watch(null, id);
        await page.locator(`#things-notebook-body a.row[href*="page=${id}"]`).click();
        await page.locator('#notebook-sheet-dialog[open]').waitFor(); await settled();
        l = await log();
        const grow = l.animations.find(a => a.id === 'notebook-sheet-dialog' && /scale/.test(a.frames[0].transform ?? ''));
        assert.ok(grow, 'opening from its row grows'); near(landedAt({ rect: grow.rect, frames: [grow.frames[0]] }), row, 'out of the row');
        seen.push(`close onto the row and open out of it (${docked ? 'beside' : 'full sheet'})`);
      }
      // Folding: a message closes onto its row and the dossier under it slides up; unfolding opens it back out.
      await page.keyboard.press('Escape');
      const said = (k, more) => [k, { sender: 'aim-core', addressees: [facts.actor], read: true, divergence_reason: 'Fold source ' + k, ...more }];
      const topic = `fold-${look || 'bookends'}-${scheme}-${motion}`;
      // The feed draws the newest dossier first: the one under is said first.
      const ids = await readingSeed(control)(topic, [said('two', { join: true, body: 'The dossier under it, which makes room.' }),
        said('one', { body: 'The dossier whose reply folds.' }),
        said('reply', { reply_to: 'one', reply_without_quote: 'A reply to fold.', body: 'The reply that folds to one line and opens again.\nIts second line.\nIts third line.' })]);
      await page.goto(`${facts.origin}/?topic=${topic}`); await page.locator('body[data-ready=true]').waitFor();
      const entry = page.locator(`#messages [data-id="${ids.reply}"]`).first();
      await entry.locator('.message-card').first().or(entry).first().waitFor();
      const height = () => entry.evaluate(n => Math.round(n.getBoundingClientRect().height));
      const whole = await height();
      await watch(null); await entry.click({ position: { x: 200, y: 40 } }); await page.keyboard.press('x');
      await page.waitForFunction(id => document.querySelector(`#messages [data-id="${id}"] [data-folded="true"], #messages [data-id="${id}"][data-folded="true"]`), ids.reply); await settled();
      l = await log();
      const folded = await height(); assert.ok(folded < whole / 2, `it folds to its row: ${whole} → ${folded}`);
      const slid = l.animations.filter(a => a.stack === ids.two && /translateY\((?!0)/.test(a.frames[0].transform ?? ''));
      if (motion === 'reduce') {
        assert.equal(l.animations.filter(a => a.cls.includes('fold-ghost')).length + slid.length, 0, 'reduced motion: folding moves nothing');
      } else {
        const shut = l.animations.find(a => a.cls.includes('fold-ghost'));
        assert.ok(shut && /inset\(0(px)? 0(px)? 0(px)? 0(px)?/.test(shut.frames[0].clipPath) && /inset\(0(px)? 0(px)? [1-9]/.test(shut.frames.at(-1).clipPath), 'the message as it was closes up onto its row: ' + JSON.stringify(shut?.frames));
        assert.ok(slid.length, 'the dossier under it slides up into the room: ' + JSON.stringify({ moved: l.animations.filter(a => /translateY/.test(a.frames[0].transform ?? '')).map(a => [a.cls.slice(0, 40), a.stack, a.entry, a.frames[0].transform]), order: await page.locator('#messages .reply-stack').evaluateAll(n => n.map(s => s.dataset.stack)), ids }));
        assert.ok(+slid[0].frames[0].transform.match(/translateY\(([-\d.]+)px\)/)[1] > 0, 'up from where it was, below');
      }
      await watch(null); await entry.locator('[data-folded="true"]').first().or(entry.locator('.fold-line, .folded-row')).first().click({ position: { x: 60, y: 8 } }).catch(async () => { await entry.click({ position: { x: 60, y: 8 } }); });
      await page.waitForFunction(([id, whole]) => document.querySelector(`#messages [data-id="${id}"]`).getBoundingClientRect().height > whole * 0.9, [ids.reply, whole]); await settled();
      l = await log();
      const opening = l.animations.find(a => a.entry === ids.reply && /inset\(0(px)? 0(px)? [1-9]/.test(a.frames[0].clipPath ?? ''));
      if (motion === 'reduce') assert.equal(opening, undefined, 'reduced motion: unfolding moves nothing');
      else { assert.ok(opening, 'unfolding opens the message down out of its row'); assert.ok(l.animations.some(a => a.stack === ids.two && /translateY\(-/.test(a.frames[0].transform ?? '')), 'the dossier under it makes room'); }
      seen.push(motion === 'reduce' ? 'reduced motion: fold and unfold without motion' : 'fold closes onto its row; unfold opens out of it');
      await page.screenshot({ path: `${evidence}/${key}.png` });
      assert.deepEqual(pageErrors, []);
    } catch (e) { error = e; await page.screenshot({ path: `${evidence}/${key}-failed.png` }).catch(() => {});
      await writeFile(`${evidence}/${key}-log.json`, JSON.stringify(await page.evaluate(() => ({ log: window.flightLog, rows: [...document.querySelectorAll('#things-notebook-body a.row')].map(a => [a.getAttribute('href'), a.textContent.trim().slice(0, 40)]), things: Boolean(document.getElementById('things')?.getClientRects().length) })).catch(() => null), null, 1)); }
    results.push({ key, seen, error: error ? String(error.stack ?? error) : null }); await context.close();
  }
} catch (e) { failure = String(e.stack ?? e); }
finally {
  await browser?.close(); fixture.kill('SIGTERM'); await exit; if (profile) await rm(profile, { recursive: true, force: true });
  await writeFile(`${evidence}/results.json`, JSON.stringify({ results, failure, fixtureErrors: errors }, null, 2));
}
const passed = results.filter(r => !r.error).length;
console.log(JSON.stringify({ passed, failed: results.length - passed, failure: failure?.split('\n')[0] ?? null }));
for (const r of results) if (r.error) console.log(r.key, r.error.split('\n').slice(0, 2).join(' | '));
process.exit(failure || passed !== results.length ? 1 : 0);

// Scratch Core/HTTP and actual page geometry. No physical-phone claim.
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, writeFile, rm, access } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import net from 'node:net';
import { fixtureControl } from './fixture_control.mjs';
const engines = await import(process.env.AIM_PLAYWRIGHT_CORE), engine = process.env.AIM_ENGINE ?? 'chromium';
const evidence = process.argv[2], selected = new RegExp(process.argv[3] ?? '');
const geometryOnly = process.argv.includes('--geometry-only');
await mkdir(evidence, { recursive: true });
const files = ['web/aim.css', 'web/look.css', 'web/rails.css', 'web/rail-dense.css', 'web/index.html', 'web/app.mjs',
  'web/notebook-page.mjs', 'web/notebook-sheet.mjs', 'web/notebook-create.mjs', 'web/deck.mjs', 'web/reader.mjs',
  'tests/fixtures/ui_http.py', 'tests/fixture_control.mjs', 'tests/phone_width_1065_native.mjs'];
const sha = b => createHash('sha256').update(b).digest('hex'), hashes = {};
for (const file of files) { const b = await readFile(file); hashes[file] = sha(b); const out = `${evidence}/source/${file}`; await mkdir(out.slice(0, out.lastIndexOf('/')), { recursive: true }); await writeFile(out, b); }
await writeFile(`${evidence}/start.json`, JSON.stringify({ head: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(), hashes }, null, 2));
const fixture = spawn('/usr/bin/python3', ['-B', 'tests/fixtures/ui_http.py', '--freshness', '--media']);
const { control, exit, errors } = fixtureControl(fixture), results = [], cleanup = {}, owned = new Set([fixture.pid]);
let browser, profile, origin, failure, watcher, version;
const processes = () => execFileSync('/bin/ps', ['-axo', 'pid=,ppid=,command='], { encoding: 'utf8' }).trim().split('\n').map(line => { const [, pid, ppid, command] = line.match(/^\s*(\d+)\s+(\d+)\s+(.*)$/); return { pid: +pid, ppid: +ppid, command }; });
function retain() { const all = processes(); for (let changed = true; changed;) { changed = false; for (const p of all) if ((owned.has(p.ppid) || profile && p.command.includes(profile)) && !owned.has(p.pid)) { owned.add(p.pid); changed = true; } } writeFileSync(`${evidence}/owned.json`, JSON.stringify({ at: new Date().toISOString(), profile, ownedPids: [...owned], fixturePid: fixture.pid })); }
const measure = W => {
  const name = el => el.id ? '#' + el.id : el.tagName.toLowerCase() + (typeof el.className === 'string' ? '.' + el.className.trim().split(/\s+/).join('.') : '');
  const visible = el => el.getClientRects().length && !el.closest('[hidden],[inert]') && getComputedStyle(el).visibility !== 'hidden' && getComputedStyle(el).opacity !== '0';
  const box = el => { const r = el.getBoundingClientRect(), s = getComputedStyle(el); let paintedRight = r.right; const clips = [];
    for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) if (['hidden', 'clip', 'auto', 'scroll'].includes(getComputedStyle(p).overflowX)) { const edge = p.getBoundingClientRect().right; paintedRight = Math.min(paintedRight, edge); clips.push({ name: name(p), edge }); }
    return { name: name(el), x: r.x, y: r.y, width: r.width, height: r.height, right: r.right, paintedRight, clips, scroll: el.scrollWidth, client: el.clientWidth, display: s.display, minWidth: s.minWidth, maxWidth: s.maxWidth, overflowX: s.overflowX, whiteSpace: s.whiteSpace, parent: name(el.parentElement ?? document.body) }; };
  // A modal makes the background unavailable without adding an inert attribute.
  // Existing ellipses and local scrollers clip descendant boxes; retain both edges.
  const root = document.querySelector('dialog:modal') ?? document.body;
  const nodes = [root, ...root.querySelectorAll('*')].filter(visible), boxes = nodes.map(box);
  const outside = boxes.filter(b => b.width > 0 && b.height > 0 && b.paintedRight > W + .5);
  const horizontal = boxes.filter(b => b.client > 0 && b.scroll > b.client + 1 && ['auto', 'scroll'].includes(b.overflowX) && !/^(input|textarea)(\.|$)/.test(b.name));
  return { expectedWidth: W, innerWidth, clientWidth: document.documentElement.clientWidth, documentWidth: document.documentElement.scrollWidth, bodyWidth: document.body.scrollWidth,
    visual: visualViewport && { width: visualViewport.width, height: visualViewport.height, scale: visualViewport.scale }, meta: document.querySelector('meta[name=viewport]')?.content,
    root: name(root), outside, horizontal, clipped: boxes.filter(b => b.right > W + .5 && b.paintedRight <= W + .5), boxes: boxes.filter(b => outside.some(o => o.name === b.name) || horizontal.some(o => o.name === b.name)), x: scrollX, y: scrollY };
};
try {
  const facts = await control({ method: 'ready' }); origin = facts.origin; await writeFile(`${evidence}/fixture.json`, JSON.stringify({ origin, fixturePid: fixture.pid }));
  await control({ method: 'pipeline', operation_id: 'width1065-pipeline', kind: 'pipeline.configure', target: { workspace_id: 'w1' }, args: { enabled: true } });
  await control({ method: 'pipeline', operation_id: 'width1065-item', kind: 'pipeline.item_add', target: { workspace_id: 'w1' }, args: { title: 'A wide page should still fit ' + 'unbroken'.repeat(20), section: 'next', sources: [{ note: 'Isolated1065 geometry.' }] } });
  const words = '# Wide content\n\nOpening retained.\n\n## A filled card\n\n' + 'unbroken'.repeat(60) + '\n\n| Name | Detail |\n| --- | --- |\n| One | ' + 'tableword'.repeat(40) + ' |\n\n```text\n' + 'codeword'.repeat(50) + '\n```\n\nEnd of retained words.';
  const filledId = 'width1065-filled';
  await control({ method: 'agent_page', operation_id: 'width1065-filled', item_id: filledId, topic_id: 't1', title: 'Filled phone Notebook', body: words + '\n\n![Wide image](attachment:width1065-filled-media-0)', attachments: [{ name: 'wide1065.png', png: [1400, 900] }] });
  await control({ method: 'agent_page', operation_id: 'width1065-opening', item_id: 'width1065-opening', topic_id: 't1', title: 'Notebook opening width', body: words.replace('## A filled card\n\n', '') });
  const posted = await control({ method: 'agent_message', operation_id: 'width1065-message', topic_id: 't1', whole_topic: true, sender: facts.agent,
    post_args: { divergence_reason: 'Isolated1065 long-word/image feed.' }, body: words + '\n\n![Wide image](attachment:width1065-message-media-0)', attachments: [{ name: 'wide1065.png', png: [1400, 900] }] });
  const messageId = posted.result.message_id;
  profile = await mkdtemp(`${evidence}/${engine}-profile-`);
  const persistent = await engines[engine].launchPersistentContext(profile, { headless: true, ...(engine === 'chromium' ? { executablePath: process.env.AIM_CHROME } : {}) });
  browser = persistent.browser(); version = browser.version(); retain(); watcher = setInterval(retain, 250);
  for (const width of [390, 375]) for (const look of ['bookends', 'paper']) {
    const key = `${width}-${look}`; if (!selected.test(key)) continue;
    const result = { key, measurements: [], errors: [], served: {} }, jobs = [];
    const context = await browser.newContext({ viewport: { width, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 1, colorScheme: 'light' });
    await context.addInitScript(look => localStorage.setItem('theseus-look', look), look);
    const page = await context.newPage(); page.setDefaultTimeout(9000); result.network = []; result.current = 'startup';
    page.on('pageerror', e => { result.errors.push(e.stack); (result.errorContext ??= []).push({ phase: result.current, error: e.stack }); });
    const views = new Set(), waiters = []; let starts = 0;
    page.on('request', r => { if (['/api/view', '/api/command', '/api/bootstrap'].includes(new URL(r.url()).pathname)) { views.add(r); starts++; result.network.push({ event: 'start', phase: result.current, path: new URL(r.url()).pathname, name: r.postDataJSON()?.name }); } });
    const done = r => { if (views.delete(r)) { result.network.push({ event: 'end', phase: result.current, path: new URL(r.url()).pathname, failure: r.failure() }); for (const wake of waiters.splice(0)) wake(); } };
    page.on('requestfinished', done); page.on('requestfailed', done);
    const drain = async () => {
      const deadline = Date.now() + 8000;
      for (;;) {
        while (views.size) await new Promise((resolve, reject) => { const timer = setTimeout(() => reject(Error('API drain timed out')), Math.max(1, deadline - Date.now())); waiters.push(() => { clearTimeout(timer); resolve(); }); });
        const before = starts; await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
        if (!views.size && starts === before) { (result.drains ??= []).push({ starts, pending: views.size }); return; }
        assert.ok(Date.now() < deadline, 'API queue settles before navigation');
      }
    };
    page.on('response', r => { const file = 'web/' + new URL(r.url()).pathname.split('/').at(-1); if (!Object.hasOwn(hashes, file)) return;
      const job = r.body().then(async bytes => { result.served[file] = sha(bytes); const out = `${evidence}/served-${key}/${file}`; await mkdir(out.slice(0, out.lastIndexOf('/')), { recursive: true }); await writeFile(out, bytes); }); job.catch(() => {}); jobs.push(job); });
    const settled = async () => {
      await page.locator('body[data-ready=true]').waitFor();
      await page.evaluate(async () => { await document.fonts.ready; await Promise.all(document.getAnimations().filter(a => Number.isFinite(a.effect?.getComputedTiming().endTime)).map(a => a.finished.catch(() => {}))); });
      // The rail owner also has queued reads not yet visible as HTTP requests.
      await page.waitForFunction(() => !document.documentElement.hasAttribute('data-rails-reading'));
      await drain();
    };
    const vertical = async () => {
      const before = await page.evaluate(() => {
        const root = document.querySelector('dialog:modal') ?? document.body;
        for (const e of [...root.querySelectorAll('*'), ...(root === document.body ? [document.scrollingElement] : [])]) {
          const s = getComputedStyle(e), r = e === document.scrollingElement ? { left: 0, top: 0, right: innerWidth, bottom: innerHeight } : e.getBoundingClientRect();
          if (e.closest('[hidden],[inert]') || e.scrollHeight <= e.clientHeight + 20 || !(['auto', 'scroll'].includes(s.overflowY) || e === document.scrollingElement)) continue;
          // A feed card can consume its own wheel before the document. Aim at
          // the document's visible gutter when testing that outer scroller.
          const x = e === document.scrollingElement ? document.documentElement.clientWidth - 5 : (Math.max(0, r.left) + Math.min(document.documentElement.clientWidth, r.right)) / 2;
          const y = (Math.max(0, r.top) + Math.min(innerHeight, r.bottom)) / 2;
          if (x < 1 || x >= document.documentElement.clientWidth || y < 1 || y >= innerHeight || !e.contains(document.elementFromPoint(x, y))) continue;
          e.dataset.width1065Scroll = 'current';
          return { x, y, top: e.scrollTop, left: e.scrollLeft, height: e.scrollHeight, client: e.clientHeight, name: e.id || e.className };
        }
        return null;
      });
      if (!before) return { needed: false };
      await page.mouse.move(before.x, before.y);
      const down = before.top + before.client < before.height - 5;
      // Mobile WebKit does not implement protocol wheel input. Its existing
      // focusable writing/reading/main surface receives an actual paging key.
      // Neither engine's check claims a physical-phone swipe.
      const input = engine === 'webkit' ? 'native paging key' : 'native wheel';
      if (engine === 'webkit') await page.locator(before.name === '' ? '#main' : '[data-width1065-scroll=current]').press(down ? 'PageDown' : 'PageUp');
      else await page.mouse.wheel(0, down ? 420 : -420);
      await page.waitForFunction(top => document.querySelector('[data-width1065-scroll=current]').scrollTop !== top, before.top, { timeout: 2500 });
      const after = await page.locator('[data-width1065-scroll=current]').evaluate(e => { const state = { top: e.scrollTop, left: e.scrollLeft }; delete e.dataset.width1065Scroll; return state; });
      return { needed: true, input, before, after, passed: after.top !== before.top && after.left === before.left };
    };
    const capture = async (name, host = 'body') => {
      await settled();
      const state = await page.evaluate(measure, width); state.name = name; state.host = host;
      state.passed = state.innerWidth <= width && state.documentWidth <= width && state.bodyWidth <= width && state.visual.width <= width + .5 && state.visual.scale === 1 && !state.outside.length && !state.horizontal.length;
      state.vertical = geometryOnly ? { omitted: 'width-only CSS reversion diagnostic' } : await vertical();
      if (state.vertical.needed) state.passed &&= state.vertical.passed;
      result.measurements.push(state); await page.screenshot({ path: `${evidence}/${key}-${name}.png`, fullPage: true });
      console.log(JSON.stringify({ engine, key, name, passed: state.passed, width: [state.innerWidth, state.documentWidth], outside: state.outside.slice(0, 6).map(b => b.name), horizontal: state.horizontal.map(b => b.name) }));
    };
    const visit = async query => {
      await page.waitForFunction(() => !document.documentElement.hasAttribute('data-rails-reading'));
      await drain();
      // Finish independent requests before replacing a WebKit document. Body
      // readiness alone does not mean every startup reader has completed.
      if (engine === 'webkit') await page.waitForLoadState('networkidle');
      result.current = query; await page.goto(origin + '/' + query); await settled();
    };
    const view = async (host, mode) => {
      await page.locator(host).getByRole('button', { name: 'This page', exact: true }).tap();
      await page.locator('.message-menu-list').getByText('Show as ' + mode, { exact: true }).tap();
      await page.locator(host + ' .notebook-text-panel').waitFor({ state: mode === 'text' ? 'visible' : 'hidden' });
    };
    try {
      const seed = await control({ method: 'agent_topic', operation_id: `width1065-empty-${engine}-${key}`, title: 'New Notebook width', body: 'Isolated new Notebook.', team: true });
      await visit('?topic=' + seed.topic_id); await page.locator('#things-open').tap();
      const section = page.locator('#things .things-sec[data-key=notebook]'); await section.getByRole('button', { name: 'New Notebook page', exact: true }).tap();
      const title = page.getByRole('textbox', { name: 'New Notebook page title', exact: true }); await title.fill('New page1065 ' + key); await title.press('Enter');
      const sheet = page.locator('#notebook-sheet-dialog[open]'); await sheet.waitFor();
      await capture('new-cards', '#notebook-sheet-dialog');
      await view('#notebook-sheet-dialog', 'text'); await capture('new-text', '#notebook-sheet-dialog');
      const created = await control({ method: 'agent_view', actor: facts.actor, name: 'memory_items', args: { owner_scope: { kind: 'topic', id: seed.topic_id } } });
      assert.equal(created.items.length, 1); const createdId = created.items[0].id, written = 'Retained1065 ' + key;
      const saved = page.waitForResponse(r => { try { const q = r.request().postDataJSON(); return q?.kind === 'memory.revise' && r.ok(); } catch { return false; } });
      await sheet.locator('.notebook-text').fill(written); await saved;
      const current = await control({ method: 'agent_view', actor: facts.actor, name: 'memory_current', args: { item_id: createdId } });
      assert.equal(current.body, written); result.writing = { createdId, written, body: current.body };
      await sheet.locator('.notebook-sheet-close').tap(); await sheet.waitFor({ state: 'hidden' });
      await visit('?topic=t1&page=' + filledId); await sheet.waitFor();
      await view('#notebook-sheet-dialog', 'text'); await capture('filled-text-sheet', '#notebook-sheet-dialog');
      await view('#notebook-sheet-dialog', 'cards'); await capture('filled-cards-sheet', '#notebook-sheet-dialog');
      await sheet.locator('.notebook-sheet-close').tap(); await sheet.waitFor({ state: 'hidden' });
      await visit('?cards=' + filledId + '&view=text'); await capture('filled-text-page', '#deck-page');
      await view('#deck-page', 'cards'); await capture('filled-cards-page', '#deck-page');
      await visit('?cards=width1065-opening&view=cards'); await capture('filled-cards-opening', '#deck-page');
      await visit('?topic=t1'); await capture('topic-feed', '#messages');
      await visit('?topic=t1&message=' + messageId); await page.locator('#reader[open]').waitFor(); await capture('reader', '#reader');
      await visit('?workspace=w1'); await capture('outcome', '#outcome-page');
      await page.locator('#outcome-tab-agents').tap(); await page.locator('#outcome-team').waitFor(); await capture('team', '#outcome-team');
      await visit('?pipeline=w1'); await page.locator('#pipeline-page').waitFor(); await capture('pipeline', '#pipeline-page');
      await visit('?cards=' + createdId + '&view=text'); assert.equal(await page.locator('#deck-page .notebook-text').inputValue(), written); result.writing.reloaded = true;
      await drain(); assert.deepEqual(result.errors, []); result.passed = result.measurements.every(m => m.passed);
    } catch (e) { result.driverError = e.stack; await page.screenshot({ path: `${evidence}/${key}-driver-error.png`, fullPage: true }); }
    await Promise.all(jobs); results.push(result); await writeFile(`${evidence}/observations.json`, JSON.stringify(results, null, 2)); retain(); await context.close();
  }
} catch (e) { failure = e.stack; }
finally {
  clearInterval(watcher); if (browser) { retain(); await browser.close(); } cleanup.disconnected = browser ? !browser.isConnected() : true;
  fixture.stdin.end(); cleanup.fixtureExit = await exit; cleanup.fixtureErrors = errors();
  const ps = processes(); cleanup.ownedPids = [...owned]; cleanup.remainingOwned = ps.filter(p => owned.has(p.pid)); cleanup.profileProcesses = profile ? ps.filter(p => p.command.includes(profile)) : [];
  if (profile && cleanup.disconnected && !cleanup.remainingOwned.length && !cleanup.profileProcesses.length) await rm(profile, { recursive: true });
  cleanup.profileAbsent = profile ? await access(profile).then(() => false, () => true) : null;
  cleanup.tcp = origin ? await new Promise(resolve => { const u = new URL(origin), s = net.createConnection({ host: u.hostname, port: +u.port }); s.once('connect', () => { s.destroy(); resolve({ refused: false }); }); s.once('error', e => resolve({ refused: e.code === 'ECONNREFUSED', code: e.code })); }) : null;
  const endHashes = Object.fromEntries(await Promise.all(files.map(async file => [file, sha(await readFile(file))])));
  cleanup.inputsUnchanged = JSON.stringify(hashes) === JSON.stringify(endHashes);
  await writeFile(`${evidence}/end.json`, JSON.stringify({ hashes: endHashes, unchanged: JSON.stringify(hashes) === JSON.stringify(endHashes) }, null, 2));
  await writeFile(`${evidence}/results.json`, JSON.stringify({ engine, version, geometryOnly, results, cleanup, failure }, null, 2));
}
assert.equal(cleanup.disconnected, true); assert.equal(cleanup.fixtureExit.code, 0); assert.equal(cleanup.fixtureErrors, ''); assert.deepEqual(cleanup.remainingOwned, []); assert.deepEqual(cleanup.profileProcesses, []); assert.equal(cleanup.profileAbsent, true); assert.equal(cleanup.tcp?.refused, true);
assert.equal(cleanup.inputsUnchanged, true);
assert.equal(failure, undefined); assert.ok(results.length && results.every(r => r.passed), 'inspect retained width/driver failures');

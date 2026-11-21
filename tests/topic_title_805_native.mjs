// Native title text/pencil geometry and the actual shared rename save path.
// One isolated HTTP/Core fixture and one headless browser at a time per seat.
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { mkdir, writeFile, mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { fixtureControl } from './fixture_control.mjs';
import { textEdgeGeometry } from './topic_title_805_oracles.mjs';
const engines = await import(process.env.AIM_PLAYWRIGHT_CORE);
const evidence = path.resolve(process.argv[2]); await mkdir(evidence, { recursive: true });
const root = process.env.AIM_805_FIXTURE_ROOT ?? process.cwd();
const child = spawn('/usr/bin/python3', ['tests/fixtures/ui_http.py', '--freshness'], { cwd: root });
const { control, exit } = fixtureControl(child);
const navigationControl = process.argv.includes('--navigation-control');
const networkFailures = [];
const results = [], errors = [], marker = `theseus-805-${process.pid}`;
let facts, browser, page, profile, failure;
const processes = () => execFileSync('ps', ['-axo', 'pid=,command='], { encoding: 'utf8' }).split('\n').filter(line => line.includes(marker) || profile && line.includes(profile));
const read = async id => (await control({ method: 'agent_view', actor: facts.actor, name: 'topic', args: { topic_id: id } })).topic;
const until = async fn => { for (let i = 0; i < 100; i++) { if (await fn()) return; await new Promise(resolve => setTimeout(resolve, 50)); } throw Error('Core did not reach expected title'); };
const ready = async () => page.waitForFunction(() => document.body.dataset.ready === 'true');
const receipt = () => page.waitForResponse(response => { try { return response.request().postDataJSON()?.kind === 'topic.update'; } catch { return false; } });
async function closeBrowser() {
  if (!browser) return;
  const rows = execFileSync('ps', ['-axo', 'pid=,ppid=,command='], { encoding: 'utf8' }).split('\n').map(line => { const match = /^\s*(\d+)\s+(\d+)\s+(.*)$/.exec(line); return match && { pid: Number(match[1]), parent: Number(match[2]), command: match[3] }; }).filter(Boolean);
  const owned = new Set(rows.filter(row => row.command.includes(marker) || profile && row.command.includes(profile)).map(row => row.pid));
  for (let n = 0; n < rows.length; n++) for (const row of rows) if (owned.has(row.parent)) owned.add(row.pid);
  await browser.close(); assert.equal(browser.isConnected(), false);
  const livePids = new Set(execFileSync('ps', ['-axo', 'pid='], { encoding: 'utf8' }).trim().split(/\s+/).map(Number));
  const remainingPids = [...owned].filter(pid => livePids.has(pid));
  const remaining = processes(); results.push({ browserClosed: true, profile, ownedPids: [...owned], remainingPids, remaining });
  assert.deepEqual(remainingPids, [], 'owned browser process tree exited');
  assert.deepEqual(remaining, [], 'owned browser profile processes absent after Browser.close');
  browser = null;
}
try {
  facts = await control({ method: 'ready' });
  const forbidden = await control({ method: 'agent_topic', operation_id: '805-forbidden', title: 'Another reader owns this', body: 'Scratch permission control' });
  const conversation = await control({ method: 'coordinator', operation_id: '805-coordinator', coordinator: facts.agent });
  for (const engine of (process.env.AIM_805_ENGINES ?? 'chromium,webkit').split(',')) {
    let persistent;
    if (engine === 'chromium') {
      browser = await engines.chromium.launch({ executablePath: process.env.AIM_CHROME, headless: true, args: ['--enable-automation', `--${marker}`] });
      const cdp = await browser.newBrowserCDPSession();
      profile = (await cdp.send('Browser.getBrowserCommandLine')).arguments.find(x => x.startsWith('--user-data-dir='))?.slice(16);
      assert.ok(profile); await cdp.detach();
    } else {
      profile = await mkdtemp(path.join(tmpdir(), `${marker}-webkit-`));
      persistent = await engines.webkit.launchPersistentContext(profile, { headless: true });
      browser = persistent.browser(); assert.ok(browser);
    }
    results.push({ engine, browserVersion: browser.version(), profile });
    for (const width of [1280, 390]) for (const colorScheme of ['light', 'dark']) {
      const key = `${engine}-${width}-${colorScheme}`;
      const context = await browser.newContext({ viewport: { width, height: 900 }, colorScheme, hasTouch: width === 390, isMobile: width === 390 });
      page = await context.newPage(); page.setDefaultTimeout(10000); page.on('requestfailed', request => networkFailures.push({ key, url: request.url(), failure: request.failure(), method: request.method() })); page.on('pageerror', e => errors.push({ key, error: e.message, stack: e.stack, url: page.url() }));
      for (const [shape, title] of [['short', 'Garden'], ['wrapped', 'This long garden title wraps naturally beside the topic controls and keeps its final words whole'], ['unbroken', 'Garden'.repeat(25)]]) {
        await control({ method: 'topic_state', operation_id: `805-layout-${key}-${shape}`, topic_id: 't1', args: { title } });
        await page.waitForLoadState('networkidle'); await page.goto(facts.origin + '/?topic=t1'); await ready();
        if (navigationControl) continue;
        assert.equal(await page.locator('#topic-title-rename').count(), 1, 'title-adjacent pencil exists on actual page');
        assert.equal(await page.locator('#topic-title').textContent(), title);
        if (width === 1280) {
          await page.mouse.move(1000, 750);
          assert.equal(await page.locator('#topic-title-rename').evaluate(el => getComputedStyle(el).opacity), '0', 'idle pencil is quiet');
          await page.locator('#topic-title').hover();
          const geometry = await page.evaluate(() => {
            const rect = node => { const r = node.getBoundingClientRect(); return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width }; };
            const title = document.getElementById('topic-title'), range = document.createRange(); range.selectNodeContents(title);
            return { text: [...range.getClientRects()].map(r => ({ left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width })), pencil: rect(document.getElementById('topic-title-rename')), viewport: { left: 0, right: innerWidth }, flowRight: rect(title.parentElement).right, pencilMarginPx: 2.4, wrapped: range.getClientRects().length > 1, controls: ['new-message', 'settings-open', 'topic-menu'].map(id => document.getElementById(id)).filter(el => el.getClientRects().length).map(rect), opacity: getComputedStyle(document.getElementById('topic-title-rename')).opacity };
          });
          textEdgeGeometry(geometry); assert.equal(geometry.opacity, '1'); results.push({ key, shape, geometry });
          if (shape === 'short') await page.screenshot({ path: path.join(evidence, `${key}.png`) });
        } else {
          assert.equal(await page.locator('#topic-title-rename').isVisible(), false, 'dossier-style touch title handle, no decorative pencil');
          const box = await page.locator('#topic-title').boundingBox(); assert.ok(box.height >= 44 && box.x >= 0 && box.x + box.width <= width + 1);
          results.push({ key, shape, touchTitleBox: box });
        }
      }
      if (navigationControl) { await page.waitForLoadState('networkidle'); await context.close(); results.push({ key, navigationControl: true }); continue; }
      const title = page.locator('#topic-title'), input = page.locator('#topic-rename');
      // Native click/tap of title, Escape cancellation, then native pencil/keyboard.
      if (width === 390) await title.tap(); else await title.click();
      await input.fill('Cancel this exact writing'); await input.press('Escape');
      assert.equal(await input.isVisible(), false); assert.equal((await read('t1')).title, 'Garden'.repeat(25));
      assert.equal(await page.evaluate(() => document.activeElement.id), width === 390 ? 'topic-title' : 'topic-title-rename');
      if (width === 1280) {
        await title.focus(); await page.keyboard.press(engine === 'webkit' ? 'Alt+Tab' : 'Tab');
        assert.equal(await page.evaluate(() => document.activeElement.id), 'topic-title-rename');
        assert.equal(await page.locator('#topic-title-rename').evaluate(el => getComputedStyle(el).opacity), '1');
        await page.keyboard.press('Enter');
      } else { await title.focus(); await page.keyboard.press('Enter'); }
      const exact = `Exact —  ${key}`;
      await input.fill(exact); const saved = receipt(); await input.press('Enter');
      assert.equal((await (await saved).json()).status, 'committed'); await until(async () => (await read('t1')).title === exact);
      await page.waitForFunction(exact => document.querySelector('#topic-title').textContent === exact && !document.querySelector('#topic-title').hidden, exact);
      await page.waitForLoadState('networkidle'); await page.reload(); await ready(); assert.equal(await title.textContent(), exact);
      // The pencil itself opens the same field on a mouse device.
      if (width === 1280) { await title.hover(); await page.locator('#topic-title-rename').click(); } else await title.tap();
      await input.fill(''); const refused = receipt(); await input.press('Enter');
      assert.equal((await (await refused).json()).status, 'rejected');
      await page.locator('#topic-title-edit .notice:visible').waitFor(); assert.equal(await input.inputValue(), '');
      assert.equal((await read('t1')).title, exact, 'refusal preserves Core title');
      // Open settings while dirty. Observe at the same click boundary, before a repair paint.
      const retained = `Keep —  ${key}`; await input.fill(retained);
      await input.evaluate(el => { window.title805Field = el; document.getElementById('settings-open').addEventListener('click', () => { window.title805Restored = { same: window.title805Field === document.querySelector('#topic-settings #topic-rename'), words: window.title805Field.value, headerHidden: document.getElementById('topic-title-edit').hidden }; }, { once: true }); });
      const settingSave = receipt(); await page.locator('#settings-open').click();
      assert.deepEqual(await page.evaluate(() => window.title805Restored), { same: true, words: retained, headerHidden: true });
      assert.equal((await (await settingSave).json()).status, 'committed'); await until(async () => (await read('t1')).title === retained);
      await page.keyboard.press('Escape'); await page.waitForLoadState('networkidle'); await page.reload(); await ready(); assert.equal(await title.textContent(), retained);
      // Other readers' topic and Conversation keep title clicks inert.
      for (const id of [forbidden.topic_id, conversation.topic_id]) {
        await page.waitForLoadState('networkidle'); await page.goto(facts.origin + '/?topic=' + id); await ready();
        assert.equal(await page.locator('#topic-title-rename').isVisible(), false);
        assert.equal(await title.getAttribute('tabindex'), '-1');
        if (width === 390) await title.tap(); else await title.click();
        assert.equal(await page.locator('#topic-title-edit').isVisible(), false);
      }
      results.push({ key, activationCancelSaveReloadRefusalRestorePermissionsConversation: 'pass' });
      await page.waitForLoadState('networkidle'); await context.close();
    }
    await closeBrowser(); if (persistent) await rm(profile, { recursive: true, force: true });
    profile = null;
  }
  if (!navigationControl) {
    // Compare native WebKit's cancellation diagnostic to a real unchanged210
    // navigation control, preserving raw errors and request failures in evidence.
    const baseline = process.env.AIM_805_WEBKIT_BASELINE ? JSON.parse(await readFile(process.env.AIM_805_WEBKIT_BASELINE, 'utf8')).at(-1) : { errors: [] };
    const signature = e => e.error.replace(/127\.0\.0\.1:\d+/g, '127.0.0.1:PORT');
    const known = new Set(baseline.errors.filter(e => e.key.startsWith('webkit-')).map(signature));
    assert.deepEqual(errors.filter(e => !e.key.startsWith('webkit-') || !known.has(signature(e))), [], 'no new native error family beyond unchanged210 navigation control');
    for (const error of errors) assert.ok(networkFailures.some(request => request.key === error.key && request.url.endsWith('/api/view') && request.failure?.errorText === 'cancelled'), 'known WebKit diagnostic accompanies an actual canceled view request in that case');
  }
} catch (error) {
  failure = error; results.push({ error: error.stack });
  if (page && !page.isClosed()) await page.screenshot({ path: path.join(evidence, 'failure.png'), fullPage: true }).catch(() => {});
} finally {
  await closeBrowser();
  child.stdin.end(); const ended = await exit;
  let absent = false; try { process.kill(child.pid, 0); } catch (e) { absent = e.code === 'ESRCH'; }
  const portClosed = !facts || await new Promise(resolve => { const socket = net.connect(new URL(facts.origin).port, '127.0.0.1'); socket.on('connect', () => { socket.destroy(); resolve(false); }); socket.on('error', () => resolve(true)); socket.setTimeout(1000, () => { socket.destroy(); resolve(false); }); });
  results.push({ fixture: ended, fixturePid: child.pid, absent, port: facts && new URL(facts.origin).port, portClosed, errors, networkFailures, navigationControl });
  await writeFile(path.join(evidence, 'results.json'), JSON.stringify(results, null, 2));
  assert.deepEqual(ended, { code: 0, signal: null }); assert.equal(absent, true); assert.equal(portClosed, true);
}
if (failure) throw failure;

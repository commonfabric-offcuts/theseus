// Actual shipped page, scratch HTTP/Core and native mouse/keys. Geometry is
// measured in Chromium; the below-browser oracle makes no timing claims.
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import net from 'node:net';
import { createHash } from 'node:crypto';
import { fixtureControl } from './fixture_control.mjs';
import { pngPixels } from './png-bands.mjs';
const { chromium } = await import(process.env.AIM_PLAYWRIGHT_CORE);
const evidence = process.argv[2]; await mkdir(evidence, { recursive: true });
const coarseOnly = process.argv.includes('--coarse-only');
const child = spawn('/usr/bin/python3', ['tests/fixtures/ui_http.py', '--freshness']);
const { control, exit } = fixtureControl(child);
const marker = `theseus-935-${process.pid}`, results = [], errors = [];
let browser, page, facts, profile;
const ownedProcesses = () => execFileSync('ps', ['-axo', 'pid=,command='], { encoding: 'utf8' }).split('\n').filter(line => line.includes(marker) || profile && line.includes(profile));
function pixelDelta(a, b) {
  assert.deepEqual([a.width, a.height], [b.width, b.height]);
  let largest = 0;
  for (let y = 0; y < a.height; y++) for (let x = 0; x < a.width; x++) {
    const left = a.pixel(x, y), right = b.pixel(x, y);
    largest = Math.max(largest, ...left.map((value, i) => Math.abs(value - right[i])));
  }
  return largest;
}
const settled = async p => {
  await p.waitForFunction(() => document.body.dataset.ready === 'true' && !document.documentElement.hasAttribute('data-rails-reading') &&
    document.querySelector('#outline #topic-navigation:not([inert])') && !document.querySelector('#retry-topics[aria-disabled]'));
  await p.waitForTimeout(200);
};
const geometry = () => {
  const rect = el => { const r = el.getBoundingClientRect(); return [r.x, r.y, r.width, r.height]; };
  return [...document.querySelectorAll('#outline .ol-outcome')].filter(el => !el.hidden).map(el => ({
    id: el.dataset.workspaceId, box: rect(el), topics: [...el.querySelectorAll('a[data-topic-id]')].filter(a => a.getClientRects().length && !a.closest('[hidden]')).map(a => ({ id: a.dataset.topicId, box: rect(a) })) }));
};
try {
  facts = await control({ method: 'ready' });
  await control({ method: 'light_outcome', outcome: 'w935', title: 'Health page and the Mac', topic: { id: 't935b', title: 'A deliberately long topic title to verify whole hover names' } });
  await control({ method: 'navigation_topics', topics: [
    { id: 't935a', workspace_id: 'w1', title: 'Garden planning' },
    { id: 't935c', workspace_id: 'w935', title: 'Another topic' },
  ] });
  await control({ method: 'agent_page', operation_id: '935-dock-page', item_id: 'n935', topic_id: 't1', title: 'Rail dock check', body: '# Rail note\n\nIsolated Notebook for935.' });
  await control({ method: 'agent_message', operation_id: '935-unread-t1', topic_id: 't1', whole_topic: true, post_args: { divergence_reason: 'Isolated rail unread-count control.' }, body: 'Unread count control for935', sender: facts.agent });
  browser = await chromium.launch({ executablePath: process.env.AIM_CHROME, headless: true, args: ['--enable-automation', `--${marker}`] });
  const session = await browser.newBrowserCDPSession();
  const command = await session.send('Browser.getBrowserCommandLine');
  profile = command.arguments.find(arg => arg.startsWith('--user-data-dir='))?.slice('--user-data-dir='.length);
  assert.ok(profile, 'actual isolated profile identified'); results.push({ profile }); await session.detach();
  if (!coarseOnly) for (const theme of ['light', 'dark']) {
    await control({ method: 'agent_message', operation_id: `935-unread-${theme}`, topic_id: 't935b', whole_topic: true, post_args: { divergence_reason: 'Isolated rail unread-count control.' }, body: 'Unread count control for935', sender: facts.agent });
    const context = await browser.newContext({ viewport: { width: 1280, height: 1000 }, colorScheme: theme });
    page = await context.newPage(); page.on('pageerror', error => errors.push(error.message));
    await page.goto(facts.origin + '/?topic=t935a'); await settled(page);
    await page.locator('.ol-outcome[data-workspace-id="w935"] .ol-disclosure').click(); await page.locator('.ol-outcome[data-workspace-id="w935"] a[data-topic-id="t935b"]').waitFor();
    await page.mouse.move(900, 600); await page.waitForTimeout(200);
    const compact = await page.evaluate(() => ({
      fine: matchMedia('(pointer:fine)').matches,
      width: document.getElementById('rail').getBoundingClientRect().width,
      outcomes: [...document.querySelectorAll('.ol-name')].map(el => ({ height: el.getBoundingClientRect().height, title: el.title, whitespace: getComputedStyle(el.querySelector('.ol-title')).whiteSpace })),
      topics: [...document.querySelectorAll('#outline a[data-topic-id]')].filter(el => el.getClientRects().length).map(el => ({ height: el.getBoundingClientRect().height, title: el.title, whitespace: getComputedStyle(el).whiteSpace })),
      counts: [...document.querySelectorAll('#outline .unread-count')].filter(el => el.getClientRects().length).map(el => el.getBoundingClientRect().right),
    }));
    results.push({ theme, compact });
    assert.equal(compact.fine, true); assert.equal(compact.width, 264);
    for (const row of compact.outcomes) { assert.equal(row.height, 26); assert.ok(row.title); assert.equal(row.whitespace, 'nowrap'); }
    for (const row of compact.topics) { assert.equal(row.height, 24); assert.ok(row.title); assert.equal(row.whitespace, 'nowrap'); }
    assert.ok(compact.counts.length >= 2); assert.ok(Math.max(...compact.counts) - Math.min(...compact.counts) < 1, 'counts align at the rail edge');
    for (const density of ['Compact', 'Roomy']) {
      await page.getByRole('button', { name: density, exact: true }).click();
      assert.equal(Number(await page.getByRole('separator', { name: 'Rail width' }).getAttribute('aria-valuenow')), await page.locator('#rail').evaluate(el => el.getBoundingClientRect().width));
      const w1 = page.locator('.ol-outcome[data-workspace-id="w1"]'), name = w1.locator('.ol-name');
      await name.focus(); await page.keyboard.press('ArrowDown');
      assert.equal(await page.evaluate(() => document.activeElement.classList.contains('ol-pencil')), false, 'Down skips pencil');
      await name.focus(); await page.keyboard.press('ArrowRight');
      assert.equal(await page.evaluate(() => document.activeElement.classList.contains('ol-new-topic')), true, 'Right reaches pencil');
      await page.keyboard.press('ArrowUp'); assert.equal(await name.evaluate(el => document.activeElement === el), true);
      await page.keyboard.press('ArrowRight'); await page.keyboard.press('ArrowDown');
      assert.equal(await page.evaluate(() => document.activeElement.classList.contains('ol-pencil')), false);
      if (density === 'Roomy') {
        const roomy = await page.locator('.ol-outcome[data-workspace-id="w935"] .ol-name').evaluate(el => {
          const r = el.getBoundingClientRect(), range = document.createRange(); range.selectNodeContents(el.querySelector('.ol-title'));
          return { x: r.x, height: r.height, titleLines: range.getClientRects().length, chevron: el.previousElementSibling.getBoundingClientRect().width };
        });
        results.push({ theme, roomy }); assert.ok(roomy.height >= 44); assert.equal(roomy.titleLines, 1); assert.ok(roomy.chevron < 20);
      }
      await page.mouse.move(900, 600);
      // Real bounded HTTP delay, with no intercepted/continued request: the
      // outgoing list must remain drawn until its own delayed read replaces it.
      await control({ method: 'read_delay', ms: 350, name: 'workspace_topics', read_class: 'foreground' });
      const origin = await page.evaluate(() => performance.timeOrigin);
      const before = await page.evaluate(geometry);
      await page.evaluate(() => {
        window.rail935Trace = [];
        document.addEventListener('click', () => {
          const started = performance.now(); window.rail935Started = started;
          for (const ms of [30, 120, 300, 700, 1500]) setTimeout(() => {
            const boxes = [...document.querySelectorAll('#outline .ol-outcome')].filter(el => !el.hidden).map(el => ({
              id: el.dataset.workspaceId, y: el.getBoundingClientRect().y, height: el.getBoundingClientRect().height,
              rows: [...el.querySelectorAll('a[data-topic-id]')].filter(a => a.getClientRects().length && !a.closest('[hidden]')).map(a => ({ id: a.dataset.topicId, y: a.getBoundingClientRect().y, height: a.getBoundingClientRect().height })) }));
            window.rail935Trace.push({ requestedMs: ms, elapsedMs: performance.now() - started, boxes });
          }, ms);
        }, { once: true, capture: true });
      });
      await page.locator('.ol-outcome[data-workspace-id="w935"] a[data-topic-id="t935b"]:visible').click();
      const staticPixels = [], clip = await w1.boundingBox(); let firstImage;
      for (let n = 1; n <= 5; n++) {
        await page.waitForFunction(n => window.rail935Trace.length >= n, n);
        const actualMs = await page.evaluate(() => performance.now() - window.rail935Started);
        const bytes = await page.screenshot({ clip, mask: [page.locator('.ol-outcome[data-workspace-id="w1"] a[data-topic-id="t935a"]:visible')], animations: 'disabled' });
        const pixels = pngPixels(bytes); firstImage ??= pixels;
        await writeFile(path.join(evidence, `rail-${theme}-${density}-${n}.png`), bytes);
        staticPixels.push({ actualMs, sha256: createHash('sha256').update(bytes).digest('hex'), maxChannelDelta: pixelDelta(firstImage, pixels) });
      }
      const trace = await page.evaluate(() => window.rail935Trace);
      results.push({ theme, density, before, trace, staticPixels });
      assert.equal(await page.evaluate(() => performance.timeOrigin), origin, 'cross-outcome click keeps the document');
      const base = before.find(row => row.id === 'w1');
      for (const frame of trace) {
        const row = frame.boxes.find(row => row.id === 'w1');
        assert.equal(row.y, base.box[1]); assert.equal(row.height, base.box[3]);
        assert.deepEqual(row.rows.map(r => [r.id, r.y, r.height]), base.topics.map(r => [r.id, r.box[1], r.box[3]]));
        for (const outcome of frame.boxes) assert.equal(new Set(outcome.rows.map(r => r.id)).size, outcome.rows.length, 'no doubled rows');
      }
      // RGB rounding at a layer boundary differed by exactly1/255 in native07.
      // Keep geometry exact and reject every larger pixel difference.
      assert.ok(staticPixels.every(frame => frame.maxChannelDelta <= 1), 'static rail pixels differ by at most one RGB level, expected selected row masked');
      const changedPixel = { ...firstImage, pixel: (x, y) => { const color = firstImage.pixel(x, y); if (x === 0 && y === 0) color[0] = color[0] > 247 ? color[0] - 8 : color[0] + 8; return color; } };
      assert.equal(pixelDelta(firstImage, changedPixel), 8, 'pixel oracle detects a deliberate single-pixel change');
      // A rapid return starts while the real replacement reads are delayed.
      await w1.locator('.ol-name').click(); await page.waitForURL('**/?workspace=w1');
      await control({ method: 'read_delay', ms: 0 });
      await page.waitForFunction(() => document.body.dataset.ready === 'true' && !document.querySelector('.ol-outcome[data-workspace-id="w1"] [inert]'));
      const returned = await page.evaluate(geometry);
      for (const outcome of returned) assert.equal(new Set(outcome.topics.map(r => r.id)).size, outcome.topics.length);
      const back = page.locator('.ol-outcome[data-workspace-id="w1"] a[data-topic-id="t935a"]:visible');
      await back.click(); await page.waitForURL('**/?topic=t935a'); await settled(page);
      assert.equal(await page.evaluate(() => performance.timeOrigin), origin, 'return keeps the document');
      await page.getByRole('button', { name: density, exact: true }).click();
      // The retained full names also survive repeated TopicRail paints.
      assert.ok((await back.getAttribute('title')).startsWith('Garden planning'));
      await page.screenshot({ path: path.join(evidence, `${theme}-${density}.png`), fullPage: true });
    }
    // Native separator gestures; reload and an in-place move must preserve
    // storage and leave freshly restored control copies working.
    const handle = page.getByRole('separator', { name: 'Rail width' });
    await handle.focus(); await page.keyboard.press('ArrowRight');
    let width = await page.locator('#rail').evaluate(el => el.getBoundingClientRect().width);
    assert.ok(width > 264);
    let b = await handle.boundingBox(); await page.mouse.move(b.x + b.width / 2, 100); await page.mouse.down(); await page.mouse.move(340, 100, { steps: 8 }); await page.mouse.up();
    width = await page.locator('#rail').evaluate(el => el.getBoundingClientRect().width); assert.equal(width, 340);
    await page.reload(); await settled(page); assert.equal(await page.locator('#rail').evaluate(el => el.getBoundingClientRect().width), 340);
    const timeOrigin = await page.evaluate(() => performance.timeOrigin);
    await page.locator('.ol-outcome[data-workspace-id="w935"] .ol-name').click(); await page.waitForFunction(() => document.body.dataset.ready === 'true');
    assert.equal(await page.evaluate(() => performance.timeOrigin), timeOrigin, 'native navigation stays in place');
    await page.getByRole('button', { name: 'Compact', exact: true }).click(); assert.equal(await page.locator('html').getAttribute('data-rail-roomy'), null);
    await handle.focus(); await page.keyboard.press('ArrowLeft'); assert.equal(await page.locator('#rail').evaluate(el => el.getBoundingClientRect().width), 324);
    await handle.dblclick({ position: { x: 3, y: 100 } }); assert.equal(await page.locator('#rail').evaluate(el => el.getBoundingClientRect().width), 264);
    for (const [target, expected] of [[100, 200], [600, 480]]) {
      const b = await handle.boundingBox(); await page.mouse.move(b.x + b.width / 2, 100); await page.mouse.down(); await page.mouse.move(target, 100, { steps: 5 }); await page.mouse.up();
      assert.equal(await page.locator('#rail').evaluate(el => el.getBoundingClientRect().width), expected, 'native drag respects width bound');
    }
    await handle.dblclick({ position: { x: 3, y: 100 } });
    results.push({ theme, nativeWidthAndPostNavigationControls: true }); await context.close();
  }
  if (!coarseOnly) for (const width of [1280, 1512]) for (const theme of ['light', 'dark']) {
    const context = await browser.newContext({ viewport: { width, height: 1000 }, colorScheme: theme });
    page = await context.newPage(); page.on('pageerror', error => errors.push(error.message));
    await page.goto(facts.origin + '/?topic=t1&page=n935'); await settled(page);
    const sheet = page.locator('dialog.notebook-sheet-dialog[open]'); await sheet.waitFor();
    const dock = sheet.getByRole('button', { name: 'Side by side', exact: true });
    if (await dock.getAttribute('aria-pressed') !== 'true') await dock.click();
    await page.waitForFunction(() => document.body.classList.contains('notebook-docked'));
    for (const variant of ['compact', 'dragged', 'roomy']) {
      const handle = page.getByRole('separator', { name: 'Rail width' });
      if (variant === 'dragged') {
        const b = await handle.boundingBox(); await page.mouse.move(b.x + b.width / 2, 100); await page.mouse.down(); await page.mouse.move(340, 100, { steps: 8 }); await page.mouse.up();
      } else {
        await handle.dblclick({ position: { x: 3, y: 100 } });
        await page.getByRole('button', { name: variant === 'roomy' ? 'Roomy' : 'Compact', exact: true }).click();
      }
      await page.locator('#new-message').click(); await page.locator('#new-message-sheet[open][data-width-edges]').waitFor();
      const bounds = await page.evaluate(() => {
        const rect = el => { const r = el.getBoundingClientRect(); return { left: r.left, right: r.right, width: r.width }; };
        return { rail: rect(document.getElementById('rail')), main: rect(document.getElementById('main')),
          notebook: rect(document.querySelector('dialog.notebook-sheet-dialog[open]')), composer: rect(document.getElementById('new-message-sheet')) };
      });
      results.push({ width, theme, variant, docked: bounds });
      assert.equal(bounds.rail.width, variant === 'compact' ? 264 : variant === 'dragged' ? 340 : 288);
      const split = bounds.rail.width + (width - bounds.rail.width) / 2;
      assert.ok(Math.abs(bounds.main.right - split) <= 1, 'conversation ends at the actual rail split');
      assert.ok(bounds.notebook.left >= bounds.main.right, 'docked Notebook never covers conversation');
      assert.ok(bounds.composer.left >= bounds.rail.right && bounds.composer.right <= bounds.main.right, 'docked pencil sheet stays inside conversation');
      await page.screenshot({ path: path.join(evidence, `dock-${width}-${theme}-${variant}.png`), fullPage: true });
      await page.locator('#new-message-close').click(); await page.locator('#new-message-sheet[open]').waitFor({ state: 'hidden' });
    }
    await context.close();
  }
  if (!coarseOnly) {
    const context = await browser.newContext({ viewport: { width: 1280, height: 1000 } });
    await context.addInitScript(() => {
      for (const name of ['getItem', 'setItem', 'removeItem']) {
        const original = Storage.prototype[name];
        Storage.prototype[name] = function(key, ...args) { if (String(key).startsWith('theseus-rail-')) throw Error('935 isolated storage refusal'); return original.call(this, key, ...args); };
      }
    });
    page = await context.newPage(); await page.goto(facts.origin + '/?topic=t935a'); await settled(page);
    await page.getByRole('button', { name: 'Roomy', exact: true }).click(); assert.notEqual(await page.locator('html').getAttribute('data-rail-roomy'), null);
    const handle = page.getByRole('separator', { name: 'Rail width' }); await handle.focus(); await page.keyboard.press('ArrowRight');
    const width = await page.locator('#rail').evaluate(el => el.getBoundingClientRect().width); assert.ok(width > 288);
    await page.locator('.ol-outcome[data-workspace-id="w935"] .ol-name').click(); await page.waitForFunction(() => document.body.dataset.ready === 'true');
    assert.notEqual(await page.locator('html').getAttribute('data-rail-roomy'), null); assert.equal(await page.locator('#rail').evaluate(el => el.getBoundingClientRect().width), width);
    results.push({ storageRefusedPageFallback: true }); await context.close();
  }
  // Exact CSS-disabled controls on phone and desktop coarse pointer.
  for (const width of [390, 1280]) for (const theme of ['light', 'dark']) {
    const context = await browser.newContext({ viewport: { width, height: 900 }, colorScheme: theme, hasTouch: true, isMobile: width === 390 });
    page = await context.newPage(); await page.goto(facts.origin + '/?topic=t935a'); await settled(page);
    if (width === 390) await page.locator('#rail-open').tap();
    assert.equal(await page.getByRole('separator', { name: 'Rail width' }).isVisible(), false);
    assert.equal(await page.getByRole('button', { name: 'Compact', exact: true }).isVisible(), false);
    const before = await page.evaluate(geometry), beforeImage = await page.locator('#rail').screenshot();
    await writeFile(path.join(evidence, `coarse-${width}-${theme}-candidate.png`), beforeImage);
    await page.evaluate(() => {
      [...document.styleSheets].find(sheet => sheet.href?.includes('rail-dense.css')).disabled = true;
      // These controls do not exist in the original DOM. Disabling their
      // hiding CSS alone creates a false baseline with visible extra buttons.
      document.querySelector('.rail-density')?.remove(); document.querySelector('.rail-resize')?.remove();
    });
    assert.deepEqual(await page.evaluate(geometry), before);
    const afterImage = await page.locator('#rail').screenshot();
    await writeFile(path.join(evidence, `coarse-${width}-${theme}-baseline.png`), afterImage);
    const delta = pixelDelta(pngPixels(beforeImage), pngPixels(afterImage));
    assert.ok(delta <= 1, 'phone/coarse baseline rail pixels match within one RGB level');
    results.push({ width, theme, coarse: true, exactCssGeometry: true, maxChannelDelta: delta }); await context.close();
  }
  assert.deepEqual(errors, []);
} catch (error) {
  results.push({ error: error.stack });
  if (page && !page.isClosed()) await page.screenshot({ path: path.join(evidence, 'failure.png'), fullPage: true }).catch(() => {});
  process.exitCode = 1;
} finally {
  if (browser) { await browser.close(); results.push({ browserDisconnected: !browser.isConnected(), remainingOwnedProcesses: ownedProcesses() }); }
  child.stdin.end(); const ended = await exit;
  let fixtureAbsent = false; try { process.kill(child.pid, 0); } catch (error) { fixtureAbsent = error.code === 'ESRCH'; }
  let portClosed = true;
  if (facts) portClosed = await new Promise(resolve => { const socket = net.connect(new URL(facts.origin).port, '127.0.0.1'); socket.on('connect', () => { socket.destroy(); resolve(false); }); socket.on('error', () => resolve(true)); socket.setTimeout(1000, () => { socket.destroy(); resolve(false); }); });
  results.push({ cleanup: ended, fixturePid: child.pid, fixtureAbsent, portClosed });
  await writeFile(path.join(evidence, 'results.json'), JSON.stringify(results, null, 2));
  assert.deepEqual(ended, { code: 0, signal: null }); assert.equal(fixtureAbsent, true); assert.equal(portClosed, true); assert.deepEqual(ownedProcesses(), []);
}

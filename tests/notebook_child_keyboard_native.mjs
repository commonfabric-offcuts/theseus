import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fixtureControl } from './fixture_control.mjs';

const { webkit } = await import(process.env.AIM_PLAYWRIGHT_CORE);
const fixture = spawn('/usr/bin/python3', ['-B', 'tests/fixtures/ui_http.py', '--freshness']);
const { control, exit } = fixtureControl(fixture);
let browser;
try {
  const { origin } = await control({ method: 'ready' });
  const item = 'child-with-keyboard';
  const body = Array.from({ length: 30 }, (_, index) => '## Parent ' + index + '\n\nKeep this card.').join('\n\n');
  await control({ method: 'agent_page', operation_id: 'create-' + item, item_id: item,
    topic_id: 't1', title: 'Add child with keyboard', body });
  browser = await webkit.launch();
  for (const mode of ['layout','visual']) for (const index of [14, 29]) {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    try {
      const page = await context.newPage();
      page.setDefaultTimeout(12000);
      await page.goto(origin + '/?topic=t1&page=' + item);
      await page.locator('body[data-ready=true]').waitFor();
      await page.waitForFunction(() => !document.documentElement.hasAttribute('data-rails-reading'));
      const host = page.locator('#notebook-sheet-dialog[open] .notebook-sheet-page');
      const parent = host.locator('.deck-card[data-index="' + index + '"]');
      await host.locator('.deck-card[data-index="0"][aria-current="true"]').focus();
      for (let step = 0; step < index; step++) await page.keyboard.press('ArrowDown');
      await host.locator('.deck-card[data-index="' + index + '"][aria-current="true"]').waitFor();
      await page.waitForFunction(index => {
        const scroller = document.querySelector('#notebook-sheet-dialog[open] .notebook-sheet-page');
        const row = scroller?.querySelector('.deck-card[data-index="' + index + '"]');
        if (!row?.getClientRects().length) return false;
        scroller.scrollTop += row.getBoundingClientRect().top - 625;
        row.focus({ preventScroll: true });
        return true;
      }, index);
      await parent.getByRole('button', { name: 'Add child card' }).tap();
      const field = host.locator('.deck-editor:focus');
      await field.waitFor();
      const settle = () => page.evaluate(() => new Promise(done =>
        requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(done))))));
      const resize = async height => {
        if (mode === 'layout') await page.setViewportSize({ width: 390, height });
        else await page.evaluate(height => {
          Object.defineProperty(visualViewport, 'height', { configurable: true, get: () => height });
          visualViewport.dispatchEvent(new Event('resize'));
        }, height);
        await page.waitForFunction(height => visualViewport.height === height, height);
        await settle();
      };
      const sample = () => field.evaluate(field => {
        const host = field.closest('.notebook-sheet-page');
        const bounds = field.getBoundingClientRect();
        const scrollBounds = host.getBoundingClientRect();
        const view = visualViewport;
        return { top: bounds.top, bottom: bounds.bottom, sheet: host.scrollTop, document: document.scrollingElement.scrollTop,
          viewTop: view.offsetTop, height: view.height, layoutHeight: innerHeight,
          padding: parseFloat(getComputedStyle(host).paddingBottom), limit: host.scrollHeight - host.clientHeight,
          areaBottom: Math.min(view.offsetTop + view.height, scrollBounds.bottom) };
      });
      const before = await sample();
      await resize(430);
      const shrunk = await sample();
      await field.evaluate(field => { field.closest('.notebook-sheet-page').scrollTop -= 90; });
      const beforePan = await sample();
      await field.evaluate(() => {
        const view = visualViewport;
        Object.defineProperty(view, 'offsetTop', { configurable: true, get: () => 65 });
        view.dispatchEvent(new Event('scroll'));
      });
      await settle();
      const pan = await sample();
      await field.evaluate(field => {
        delete visualViewport.offsetTop;
        const host = field.closest('.notebook-sheet-page');
        host.dispatchEvent(new WheelEvent('wheel', { bubbles: true }));
        host.scrollTop -= 90;
      });
      const away = await sample();
      await resize(390);
      const afterWheel = await sample();
      await field.evaluate(field => { field.blur(); field.focus({ preventScroll: true }); });
      await settle();
      const refocused = await sample();
      await field.evaluate(field => field.blur());
      await settle();
      const blurred = await host.evaluate(host => ({
        padding: parseFloat(getComputedStyle(host).paddingBottom), limit: host.scrollHeight - host.clientHeight,
        freshEditor: Boolean(host.querySelector('[data-notebook-child-editor]')),
      }));
      console.log(JSON.stringify({ mode, index, before, shrunk, beforePan, pan, away, afterWheel, refocused, blurred }));
      if (process.env.AIM_CHILD_BASELINE !== '1') {
        assert.ok(shrunk.top >= shrunk.viewTop && shrunk.bottom <= shrunk.areaBottom, JSON.stringify(shrunk));
        assert.equal(shrunk.document, before.document);
        assert.equal(pan.sheet, beforePan.sheet, 'offset-only visual pan leaves the sheet scroll position in place');
        assert.equal(pan.padding, beforePan.padding, 'offset alone adds no room');
        assert.equal(afterWheel.sheet, away.sheet, 'a person’s scroll takes precedence over keyboard resizing');
        assert.ok(refocused.top >= refocused.viewTop && refocused.bottom <= refocused.areaBottom, JSON.stringify(refocused));
        assert.equal(refocused.document, before.document);
        assert.equal(shrunk.layoutHeight, mode === 'visual' ? 844 : 430);
        assert.ok(Math.abs(shrunk.padding - before.padding - (shrunk.layoutHeight - shrunk.height)) < 1);
        assert.equal(blurred.padding, before.padding, 'blur removes the temporary padding');
        if (mode === 'visual') {
          assert.ok(blurred.freshEditor, 'blur checks the same editor and content');
          assert.equal(blurred.limit, before.limit, 'blur leaves no extra room in the sheet');
        }
      }
    } finally { await context.close(); }
  }
} finally {
  await browser?.close();
  fixture.stdin.end();
  assert.deepEqual(await exit, { code: 0, signal: null });
}

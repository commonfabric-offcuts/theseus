import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fixtureControl } from './fixture_control.mjs';
const { webkit } = await import(process.env.AIM_PLAYWRIGHT_CORE);
const fixture = spawn('/usr/bin/python3', ['-B', 'tests/fixtures/ui_http.py', '--freshness']);
const { control, exit } = fixtureControl(fixture);
let browser;
try {
  const { origin } = await control({ method: 'ready' });
  const item = 'phone-card-width';
  await control({ method: 'agent_page', operation_id: 'create-' + item, item_id: item, topic_id: 't1',
    title: 'Phone card width', body: '## A short card\n\n## A longer Notebook title that should use the width of the card instead of wrapping halfway across the screen\n\n## Third card\n' });
  browser = await webkit.launch();
  for (const width of [375, 390, 1280]) for (const colorScheme of ['light', 'dark']) {
    const context = await browser.newContext({ viewport: { width, height: 844 }, colorScheme, isMobile: width < 761, hasTouch: width < 761 });
    try {
      const page = await context.newPage();
      await page.goto(origin + '/?topic=t1&page=' + item);
      const card = page.locator('#notebook-sheet-dialog[open] .deck-card[data-index="1"]');
      await card.waitFor();
      await page.waitForFunction(() => document.querySelector('#notebook-sheet-dialog[open] .deck-card[data-index="1"]')?.getBoundingClientRect().width > 0);
      const dimensions = await card.evaluate(row => {
        const measure = selector => {
          const element = row.querySelector(selector), b = element.getBoundingClientRect();
          return { left: b.left, right: b.right, top: b.top - row.getBoundingClientRect().top, width: b.width, height: b.height };
        };
        return { row: row.getBoundingClientRect().width, title: measure('.deck-title'),
          menu: measure('.deck-menu'), group: measure('.notebook-card-actions'), current: row.getAttribute('aria-current') };
      });
      assert.ok(dimensions.row > 0);
      if (process.env.AIM_PHONE_WIDTH_BASELINE !== '1' && width < 761) {
        const { title, menu, row } = dimensions;
        assert.ok(title.width >= row * 0.84, JSON.stringify(dimensions));
        assert.ok(Math.abs(title.right - menu.right) < 5, JSON.stringify(dimensions));
        await card.focus();
        await card.getByRole('button', { name: 'Add child card' }).waitFor();
        await card.getByRole('button', { name: 'This card' }).tap();
        await page.getByRole('menu', { name: 'This card' }).waitFor();
      }
      console.log(JSON.stringify({ width, colorScheme, ...dimensions }));
    } finally { await context.close(); }
  }
} finally {
  await browser?.close();
  fixture.stdin.end();
  assert.deepEqual(await exit, { code: 0, signal: null });
}

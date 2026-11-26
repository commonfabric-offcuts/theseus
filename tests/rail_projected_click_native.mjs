// Native Chrome for Testing coverage of the link occupying the faded slot.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fixtureControl } from './fixture_control.mjs';

const { chromium } = await import(process.env.AIM_PLAYWRIGHT_CORE);
const child = spawn('/usr/bin/python3', ['tests/fixtures/ui_http.py', '--freshness', '--live']);
const { control, exit } = fixtureControl(child);
const workspace = 'projected-rail-click';
const topic = number => `${workspace}-${number}`;
const modifier = process.platform === 'darwin' ? 'Meta' : 'Control';
const failures = [];
let browser;

try {
  const { origin } = await control({ method: 'ready' });
  await control({ method: 'navigation_workspaces', workspaces: [{ id: workspace, title: 'Projected rail click', purpose: 'Native rail fixture' }] });
  await control({ method: 'navigation_topics', topics: Array.from({ length: 16 }, (_, index) => ({
    id: topic(index + 1), title: `Topic ${index + 1}`, workspace_id: workspace,
  })) });
  await control({ method: 'topic_state', operation_id: 'projected-done', topic_id: topic(1), args: { state: 'done' } });
  await control({ method: 'topic_state', operation_id: 'projected-archived', topic_id: topic(2), args: { archived: true } });
  browser = await chromium.launch({ executablePath: process.env.AIM_CHROME });
  for (const [kind, id] of [['active', topic(5)], ['done', topic(1)], ['archived', topic(2)]]) {
    const context = await browser.newContext({ viewport: { width: 1280, height: 1000 }, reducedMotion: 'reduce' });
    try {
      const page = await context.newPage();
      await page.addInitScript(() => {
        window.projectedClicks = [];
        window.addEventListener('click', event => {
          window.projectedClicks.push({ trusted: event.isTrusted, topic: event.target.closest('a[data-topic-id]')?.dataset.topicId ?? null });
        }, true);
      });
      const url = origin + '/?topic=' + id;
      await page.goto(url);
      const outcome = page.locator(`.ol-outcome[data-workspace-id="${workspace}"]`);
      const area = outcome.locator('.ol-own');
      await outcome.waitFor();
      if (await outcome.locator('.ol-topics').evaluate(node => node.hidden)) await outcome.locator('.ol-disclosure').click();
      await outcome.locator('[data-topic-fold][data-topic-current]').waitFor();
      const peek = area.locator('[data-rail-fold=peek]');
      const box = await peek.boundingBox();
      assert.ok(box);
      const point = { x: box.x + 35, y: box.y + 8 };
      const topicAtPoint = () => page.evaluate(({ x, y }) =>
        document.elementFromPoint(x, y)?.closest('a[data-topic-id]')?.dataset.topicId, point);
      assert.equal(await topicAtPoint(), id);
      const newPage = context.waitForEvent('page', { timeout: 2500 }).catch(() => null);
      await page.keyboard.down(modifier);
      await page.mouse.move(point.x, point.y);
      await page.mouse.down();
      const revealedOnDown = await area.getAttribute('data-topic-revealed') === '';
      await page.mouse.up();
      await page.keyboard.up(modifier);
      const opened = await newPage;
      if (opened) await opened.waitForURL(url, { timeout: 5000 });
      const click = await page.evaluate(() => window.projectedClicks.at(-1));
      console.log(JSON.stringify({ kind, browser: browser.version(), id, modifier, revealedOnDown, click, opened: opened?.url() ?? null }));
      assert.equal(revealedOnDown, false, 'modified press keeps the anchor in the faded slot through release');
      assert.deepEqual(click, { trusted: true, topic: id });
      assert.equal(opened?.url(), url, 'the browser follows the original link in a new tab');
      assert.equal(page.url(), url);
      await page.mouse.move(point.x, point.y);
      await page.mouse.down();
      assert.equal(await area.getAttribute('data-topic-revealed'), '', 'plain primary press still opens immediately');
      await page.mouse.up();
    } catch (error) {
      failures.push({ kind, error: error.message });
    } finally {
      await context.close();
    }
  }
} finally {
  if (browser) await browser.close();
  child.stdin.end();
  assert.deepEqual(await exit, { code: 0, signal: null });
}

assert.deepEqual(failures, []);

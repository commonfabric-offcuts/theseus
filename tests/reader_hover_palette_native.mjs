import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import { fixtureControl } from './fixture_control.mjs';
import { readingSeed } from './topic_reading_native.mjs';

const { chromium } = await import(process.env.AIM_PLAYWRIGHT_CORE);
const fixture = spawn('/usr/bin/python3', ['-B', 'tests/fixtures/ui_http.py', '--freshness', '--agent-colors', '--other-person']);
const { control, exit, errors } = fixtureControl(fixture);
const report = process.argv[2];
const reportedOnly = process.argv.includes('--reported-only');
const rows = [];
let browser;

async function hoverWords(page, locator) {
  await locator.scrollIntoViewIfNeeded();
  const point = await locator.evaluate(element => {
    const walk = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    while (walk.nextNode()) {
      const word = walk.currentNode.textContent.search(/\S/);
      if (word === -1) continue;
      const range = document.createRange();
      range.setStart(walk.currentNode, word);
      range.setEnd(walk.currentNode, word + 1);
      const box = range.getBoundingClientRect();
      if (box.width && box.height) return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
    }
    throw new Error('No rendered text to hover');
  });
  await page.mouse.move(point.x - 8, point.y);
  await page.mouse.move(point.x, point.y);
}

try {
  const facts = await control({ method: 'ready' });
  const topic = 'reader-hover-palette';
  const ids = await readingSeed(control)(topic, [
    ['agent', { sender: 'aim-core', join: true, read: true, addressees: [facts.actor], divergence_reason: 'Agent color case', body: 'Agent first sentence. Another passage.' }],
    ['own', { sender: 'person', read: true, addressees: ['aim-core'], divergence_reason: 'Own color case', body: 'Own first sentence. Another passage.' }],
    ['other', { sender: 'fixture-other-person', join: true, read: true, addressees: [facts.actor], divergence_reason: 'Other person color case', body: 'Other first sentence. Another passage.' }],
  ]);
  browser = await chromium.launch();
  for (const theme of reportedOnly ? ['dark'] : ['light', 'dark']) {
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, colorScheme: theme, reducedMotion: 'reduce' });
    const page = await context.newPage();
    page.setDefaultTimeout(5500);
    await page.goto(facts.origin + '/?topic=' + topic);
    await page.locator('body[data-ready=true]').waitFor();
    const choose = (group, value) => page.locator(`.look-switch[data-switch="${group}"] button[data-value="${value}"]`).click();
    for (const look of reportedOnly ? ['paper'] : ['', 'paper']) {
      await choose('look', look);
      for (const palette of reportedOnly ? ['vivid'] : ['', 'vivid']) {
        await choose('agentColors', palette);
        for (const tone of reportedOnly ? ['darker'] : ['lighter', '', 'darker']) {
          await choose('lightColour', tone);
          const swatches = reportedOnly ? [''] : ['', 'graphite', look === 'paper' ? 'umber' : 'midnight'];
          for (const swatch of swatches) {
            await choose('bench', swatch);
            for (const [author, id] of reportedOnly ? [['agent', ids.agent]] : Object.entries(ids)) {
              const card = `#messages .message-card[data-id="${id}"]`;
              const preview = page.locator(card + ' > .message-preview');
              await hoverWords(page, preview);
              await page.waitForFunction(selector => {
                const card = document.querySelector(selector);
                return [...(CSS.highlights.get('lit-passage') ?? [])].some(range => card?.contains(range.commonAncestorContainer));
              }, card);
              const feed = await preview.evaluate(el => getComputedStyle(el, '::highlight(lit-passage)').backgroundColor);
              await page.keyboard.press('Enter');
              await page.locator('#reader[open]').waitFor();
              const first = page.locator('#source-body [data-start]').first();
              await first.click();
              await hoverWords(page, first);
              const passage = page.locator('#source-body .hover-quote').first();
              await passage.waitFor();
              const reader = await passage.evaluate(el => getComputedStyle(el).backgroundColor);
              rows.push({ theme, look, palette, tone, swatch, author, feed, reader });
              assert.notEqual(feed, 'rgba(0, 0, 0, 0)', 'feed paints a visible highlight');
              await page.locator('#reader-close').click();
              await page.locator('#reader[open]').waitFor({ state: 'hidden' });
            }
          }
        }
      }
    }
    await context.close();
  }
  assert.equal(rows.length, reportedOnly ? 1 : 216);
  const mismatches = rows.filter(row => row.reader !== row.feed);
  assert.equal(mismatches.length, 0, 'Reader matches feed passage background: ' + JSON.stringify(mismatches.slice(0, 8)));
} finally {
  if (browser) await browser.close();
  fixture.stdin.end();
  const fixtureExit = await exit;
  await writeFile(report, JSON.stringify({ rows, fixtureExit, fixtureErrors: errors() }, null, 2) + '\n');
  assert.deepEqual(fixtureExit, { code: 0, signal: null }, errors());
}

import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fixtureControl } from './fixture_control.mjs';

const [output, mode = 'candidate'] = process.argv.slice(2);
assert.ok(output && ['baseline', 'candidate'].includes(mode));
const { chromium } = await import(process.env.AIM_PLAYWRIGHT_CORE);
await mkdir(output, { recursive: true });

const fixture = spawn('/usr/bin/python3', ['-B', 'tests/fixtures/ui_http.py', '--freshness']);
const { control, exit, errors } = fixtureControl(fixture);
const report = { mode, cases: [], errors: [] };
let browser;

try {
  const { origin, agent } = await control({ method: 'ready' });
  const topic = 'native-cover-tables';
  await control({ method: 'navigation_topics', topics: [{ id: topic, title: 'Weekend garden work' }] });
  const table = [
    '| Work | Current plan |',
    '| --- | --- |',
    '| Seeds | Six trays by Friday |',
    '| Beds | North beds ready |',
    '| Water | Check the line Saturday |',
  ].join('\n');
  const post = async (key, body, replyTo = null) => {
    const sent = await control({ method: 'agent_message', operation_id: '84-post-' + key,
      sender: agent, topic_id: topic, body, read: true, ...(replyTo
        ? { reply_to: replyTo, reply_without_quote: 'Fixture measures rendered tables.' }
        : { source: 'topic', join: key === 'sectioned', divergence_reason: 'A distinct fixture dossier' }) });
    assert.equal(sent.status, 'committed', JSON.stringify(sent));
    return sent.result.message_id;
  };
  const sectioned = await post('sectioned', table);
  await post('sectioned-reply', 'The current garden plan is ready.', sectioned);
  const bare = await post('bare', 'A second dossier has a table without a section.');
  await post('bare-reply', 'The beds are ready for planting.', bare);
  for (const [root, key, stands] of [
    [sectioned, 'sectioned', '## What\n\n' + table + '\n\n## Log\n\nChecked the garden on Tuesday.'],
    [bare, 'bare', table + '\n| ' + 'Irrigation'.repeat(5) + ' | ' + 'IrrigationAdapter'.repeat(7) + ' |'],
  ]) {
    const saved = await control({ method: 'stack_act', kind: 'stack.cover', sender: agent,
      message_id: root, operation_id: '84-cover-' + key, args: { stands } });
    assert.equal(saved.status, 'committed', JSON.stringify(saved));
  }

  browser = await chromium.launch({ executablePath: process.env.AIM_CHROME, headless: true });
  report.browserVersion = browser.version();
  for (const width of [1280, 390]) {
    const phone = width === 390;
    for (const colorScheme of ['light', 'dark']) {
      const context = await browser.newContext({ viewport: { width, height: 880 }, colorScheme,
        isMobile: phone, hasTouch: phone, reducedMotion: 'reduce' });
      try {
        const page = await context.newPage();
        page.setDefaultTimeout(8000);
        page.on('pageerror', error => report.errors.push(error.message));
        await page.goto(origin + '/?topic=' + topic);
        await page.locator('body[data-ready=true]').waitFor();
        const cover = root => page.locator('[data-stack="' + root + '"] > .dossier-cover');
        const tableIn = root => cover(root).locator('.md-table');
        await tableIn(sectioned).waitFor();
        const measure = table => table.evaluate(el => {
          const box = node => node.getBoundingClientRect();
          const width = node => box(node).width;
          const wrapper = el.closest('.md-table-wrap');
          const row = el.closest('.cover-heading') ?? wrapper.parentElement;
          const cover = el.closest('.dossier-cover');
          const coverStyle = cover && getComputedStyle(cover);
          const refresh = cover?.querySelector('.cover-refresh');
          const lines = cell => {
            const range = document.createRange();
            range.selectNodeContents(cell.querySelector('.md-cell'));
            return new Set([...range.getClientRects()].map(rect => Math.round(rect.top))).size;
          };
          return { table: width(el), wrapper: width(wrapper), row: width(row),
            coverContent: cover ? cover.clientWidth - parseFloat(coverStyle.paddingLeft) - parseFloat(coverStyle.paddingRight) : null,
            refreshBelowTable: refresh ? box(refresh).top >= box(el).bottom - 1 : null,
            columns: [...el.tHead.rows[0].cells].map(width), layout: getComputedStyle(el).tableLayout,
            firstRowLines: [...el.tBodies[0].rows[0].cells].map(lines),
            lastRowLines: [...el.tBodies[0].rows[el.tBodies[0].rows.length - 1].cells].map(lines),
            wrapperOverflow: wrapper.scrollWidth - wrapper.clientWidth,
            pageOverflow: document.documentElement.scrollWidth - innerWidth };
        });
        const scope = { width, colorScheme };
        const covered = [await measure(tableIn(sectioned)), await measure(tableIn(bare))];
        const message = page.locator('#messages .message-card[data-id="' + sectioned + '"] .md-table');
        const ordinary = await measure(message);
        report.cases.push({ ...scope, covered, ordinary });
        for (const dims of covered) {
          assert.ok(Math.abs(dims.table - dims.wrapper) <= 1, JSON.stringify({ scope, dims }));
          assert.equal(dims.layout, phone && mode === 'baseline' ? 'fixed' : 'auto');
          assert.ok(dims.pageOverflow <= 1);
          if (!phone && mode === 'baseline') assert.ok(dims.wrapper + 30 < dims.row, JSON.stringify({ scope, dims }));
          else if (mode === 'candidate') {
            assert.ok(Math.abs(dims.wrapper - dims.coverContent) <= 1 && dims.columns[0] < dims.columns[1],
              JSON.stringify({ scope, dims }));
            assert.equal(dims.refreshBelowTable, true);
          }
        }
        if (phone && mode === 'candidate') {
          assert.ok(covered.every(dims => dims.firstRowLines.every(count => count === 1)));
          assert.ok(covered[1].lastRowLines.every(count => count > 1));
          assert.ok(covered.every(dims => dims.wrapperOverflow <= 1));
        }
        assert.equal(ordinary.layout, phone ? 'fixed' : 'auto');
        if (!phone) assert.ok(ordinary.wrapper + 30 < ordinary.row, JSON.stringify({ scope, ordinary }));
        await cover(sectioned).screenshot({ path: join(output, 'cover-' + width + '-' + colorScheme + '.png'),
          animations: 'disabled' });
      } finally {
        await context.close();
      }
    }
  }
  assert.deepEqual(report.errors, []);
} finally {
  await browser?.close();
  report.browserClosed = browser ? !browser.isConnected() : false;
  fixture.stdin.end();
  report.fixture = await exit;
  await writeFile(join(output, 'report.json'), JSON.stringify(report, null, 2) + '\n');
  assert.deepEqual(report.fixture, { code: 0, signal: null }, errors());
  assert.equal(errors(), '');
}

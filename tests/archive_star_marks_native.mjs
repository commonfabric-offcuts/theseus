import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fixtureControl } from './fixture_control.mjs';
import { readingSeed } from './topic_reading_native.mjs';

const [folder, widthArg = '1280', scheme = 'light', look = 'bookends', mode = 'candidate'] = process.argv.slice(2);
const width = +widthArg, phone = width < 760;
await mkdir(folder, { recursive: true });
const fixture = spawn('/usr/bin/python3', ['-B', 'tests/fixtures/ui_http.py', '--freshness', '--live']);
const { control, exit, errors } = fixtureControl(fixture);
const { chromium } = await import(process.env.AIM_PLAYWRIGHT_CORE);
const report = { width, scheme, look, mode, openingReads: [] };
let browser, page;
try {
  const { origin, actor, agent } = await control({ method: 'ready' });
  const topic = 'synthetic-archive-stars';
  const roots = { active: 'Active checklist', starred: 'Starred plans', reply: 'Starred reply', plain: 'Ordinary notes' };
  const pairs = Object.entries(roots).flatMap(([key, body]) => [
    [key, { body, join: true, sender: agent, read: true, divergence_reason: 'Synthetic archive star example.' }],
    [key + 'child', { body: 'A supporting note.', sender: agent, read: true, reply_to: key,
      reply_without_quote: 'Synthetic supporting note.' }],
  ]);
  const ids = await readingSeed(control)(topic, pairs);
  const source = async id => control({ method: 'agent_view', actor, name: 'source', args: { source_ref: { kind: 'message', id } } });
  const act = async (kind, key, args) => {
    const result = await control({ method: 'stack_act', sender: actor, kind, message_id: ids[key],
      operation_id: topic + '-' + kind + '-' + key, args });
    assert.equal(result.status, 'committed', JSON.stringify(result));
  };
  for (const key of ['starred', 'reply', 'plain']) await act('stack.aside', key, { through: (await source(ids[key + 'child'])).seq });
  for (const key of ['active', 'starred', 'replychild']) await act('message.star', key, { starred: true });

  browser = await chromium.launch({ executablePath: process.env.AIM_CHROME });
  const context = await browser.newContext({ viewport: { width, height: 940 }, colorScheme: scheme, isMobile: phone, hasTouch: phone });
  await context.addInitScript(paper => { if (paper) localStorage.setItem('theseus-look', 'paper'); }, look === 'paper');
  await context.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
  page = await context.newPage();
  page.setDefaultTimeout(8000);
  const pageErrors = [];
  let watching = false;
  page.on('pageerror', error => pageErrors.push(error.message));
  page.on('request', request => {
    if (watching && new URL(request.url()).pathname === '/api/view') report.openingReads.push(request.postDataJSON().name);
  });
  await page.goto(origin + '/?topic=' + topic);
  await page.locator('body[data-ready=true]').waitFor();
  const stack = id => page.locator(`#messages .reply-stack[data-stack="${id}"]`);
  const active = stack(ids.active).locator('.stack-star[aria-pressed=true]');
  await active.waitFor();
  const colour = await active.evaluate(node => getComputedStyle(node).color);
  const shelf = page.locator('#things .archive-shelf');
  const replica = id => shelf.locator(`.shelf-dossier[data-id="${id}"]`);
  await (phone ? page.locator('#messages .stack-more') : replica(ids.starred)).waitFor();
  await page.waitForTimeout(200);
  watching = true;
  if (phone) {
    await page.locator('#messages .stack-more').tap();
    await stack(ids.starred).waitFor();
    await stack(ids.reply).waitFor();
  } else {
    await shelf.getByRole('button', { name: 'List', exact: true }).click();
    await replica(ids.starred).waitFor();
  }
  await page.waitForTimeout(250);
  watching = false;
  if (mode === 'candidate') {
    if (phone) {
      for (const key of ['starred', 'reply']) {
        const mark = stack(ids[key]).locator('.stack-head > .archive-title-star');
        await mark.waitFor();
        assert.equal(await mark.textContent(), '★︎');
        assert.equal(await mark.evaluate(node => getComputedStyle(node).color), colour);
        assert.equal(await mark.evaluate(node => {
          const a = node.getBoundingClientRect(), b = node.parentElement.querySelector('.stack-name').getBoundingClientRect();
          return a.left < b.left && Math.abs((a.top + a.bottom) / 2 - (b.top + b.bottom) / 2) < 5;
        }), true);
      }
      assert.equal(await stack(ids.plain).locator('.archive-title-star').count(), 0);
      await stack(ids.starred).scrollIntoViewIfNeeded();
    } else {
      for (const key of ['starred', 'reply']) {
        const tile = replica(ids[key]);
        assert.match(await tile.getAttribute('aria-label'), /, starred,/);
        const mark = await tile.locator('.shelf-title').evaluate(node => {
          const style = getComputedStyle(node, '::before'); return { text: style.content, colour: style.color };
        });
        assert.match(mark.text, /★/);
        assert.equal(mark.colour, colour);
      }
      assert.equal(await replica(ids.plain).locator('.shelf-title').evaluate(node => getComputedStyle(node, '::before').content), 'none');
    }
    await page.screenshot({ path: folder + '/archived-stars.png' });
    if (!phone) {
      await shelf.getByRole('button', { name: 'Grid', exact: true }).click();
      await page.screenshot({ path: folder + '/archived-stars-grid.png' });
    }
  }
  report.colour = colour;
  report.served = {};
  for (const file of ['archive-shelf.mjs', 'archive-shelf.css', 'reply-stacks.mjs', 'stack-look.css']) {
    const response = await context.request.get(origin + '/' + file);
    assert.ok(response.ok(), file);
    const bytes = await response.body();
    assert.deepEqual(bytes, await readFile('web/' + file));
    report.served[file] = createHash('sha256').update(bytes).digest('hex');
  }
  assert.deepEqual(pageErrors, []);
} catch (error) {
  report.failure = error.stack;
  if (page) await page.screenshot({ path: folder + '/failure.png' }).catch(() => {});
  throw error;
} finally {
  await browser?.close();
  fixture.stdin.end();
  report.fixture = await exit;
  report.fixtureErrors = errors();
  await writeFile(folder + '/report.json', JSON.stringify(report, null, 2) + '\n');
  assert.deepEqual(report.fixture, { code: 0, signal: null });
  assert.equal(report.fixtureErrors, '');
}

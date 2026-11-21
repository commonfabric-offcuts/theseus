// Isolated real HTTP/Core; native mouse double-click and focus in Chrome for Testing.
// AIM_CHROME and AIM_PLAYWRIGHT_CORE name the browser and module.
// node tests/reader_edit_909_native.mjs /absolute/evidence
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
import { fixtureControl } from './fixture_control.mjs';
import { routeHref } from '../web/topic-navigation.mjs';
const { chromium } = createRequire(import.meta.url)(process.env.AIM_PLAYWRIGHT_CORE);
const evidence = process.argv[2]; await mkdir(evidence, { recursive: true });
const child = spawn('/usr/bin/python3', ['tests/fixtures/ui_http.py', '--freshness']);
const { control, exit, errors: fixtureErrors } = fixtureControl(child);
let browser, page; const results = [];
try {
  const facts = await control({ method: 'ready' });
  const other = await control({ method: 'agent_message', sender: facts.agent, reply_to: facts.sources[0].id, reply_without_quote: 'Isolated other-author Reader check',
    body: 'Another author selects these words normally.', operation_id: '909-other' });
  assert.equal(other.status, 'committed');
  browser = await chromium.launch({ executablePath: process.env.AIM_CHROME, headless: true });
  for (const width of [1280, 390]) {
    const body = `Own Reader words ${width}\n\nhttps://example.com/reader-test\n\n\`\`\`\ncopy this code\n\`\`\``;
    const own = await control({ method: 'agent_message', sender: 'person', whole_topic: true, body, operation_id: `909-own-${width}` });
    assert.equal(own.status, 'committed');
    const context = await browser.newContext({ viewport: { width, height: 900 } });
    page = await context.newPage(); const errors = []; page.on('pageerror', e => errors.push(e.message));
    const open = async id => {
      await page.goto(facts.origin + routeHref({ kind: 'topic', id: 't1', message: id }));
      await page.waitForSelector('#reader[open] #source-body > span');
    };
    const focused = async selector => page.waitForFunction(s => document.activeElement === document.querySelector(s), selector);
    const edit = page.locator('#message-edit-field'), more = page.locator('#reader-menu');
    await open(own.result.message_id);
    // Links and copy buttons retain their real click action; observe link clicks
    // without navigating the isolated check to an external website.
    const link = page.locator('#source-body a').first();
    await link.evaluate(el => { window.linkClicks909 = 0; el.addEventListener('click', event => { event.preventDefault(); window.linkClicks909++; }, true); });
    await link.dblclick(); assert.equal(await page.evaluate(() => window.linkClicks909), 2);
    assert.equal(await edit.isVisible(), false);
    const copy = page.locator('#source-body button').first();
    await page.locator('#source-body .md-fence').first().hover();
    await copy.dblclick(); assert.equal(await edit.isVisible(), false);
    // A modified gesture retains selection and does not open Edit.
    const words = page.locator('#source-body > span').filter({ hasText: `Own Reader words ${width}` }).first();
    await words.dblclick({ modifiers: ['Alt'] }); assert.equal(await edit.isVisible(), false);
    await words.dblclick(); await edit.waitFor(); await focused('#message-edit-field');
    assert.equal(await edit.inputValue(), body);
    assert.equal(await page.evaluate(() => window.getSelection().toString()), '');
    assert.equal(await page.locator('#reader').evaluate(el => el.open), true);
    await page.screenshot({ path: `${evidence}/edit-${width}.png` });
    await page.locator('#message-edit [data-act="cancel"]').click(); await edit.waitFor({ state: 'hidden' }); await focused('#reader-menu');
    assert.equal(await page.locator('#reader').evaluate(el => el.open), true);
    // Compare the existing menu opener and ending, then save through double-click.
    await more.click(); await page.getByRole('menuitem', { name: 'Edit', exact: true }).click(); await edit.waitFor();
    await page.keyboard.press('Escape'); await edit.waitFor({ state: 'hidden' }); await focused('#reader-menu');
    await words.dblclick(); await edit.waitFor(); await edit.fill(body + '\nChanged exactly');
    await page.locator('#message-edit [data-act="save"]').click(); await edit.waitFor({ state: 'hidden' }); await focused('#reader-menu');
    assert.match(await page.locator('#source-body').innerText(), /Changed exactly/);
    await page.screenshot({ path: `${evidence}/saved-${width}.png` });
    // Other authors still select text; a double-click never starts our edit.
    await open(other.result.message_id);
    await page.locator('#source-body > span').first().dblclick();
    assert.equal(await edit.isVisible(), false);
    assert.notEqual(await page.evaluate(() => window.getSelection().toString()), '');
    assert.deepEqual(errors, []);
    results.push({ width, passed: true, inputs: 'native mouse and keyboard', scope: 'Reader own/other text, link and copy controls, selection, shared Edit, Cancel/Escape/Save focus; narrow desktop viewport, no physical mobile claim' });
    await context.close(); page = null;
  }
} catch (error) {
  results.push({ passed: false, error: error.stack });
  if (page) { await page.screenshot({ path: `${evidence}/failure.png` }).catch(() => {}); await writeFile(`${evidence}/failure.html`, await page.content().catch(() => '')); }
  throw error;
} finally {
  await browser?.close(); child.stdin.end(); const ended = await exit;
  await writeFile(`${evidence}/results.json`, JSON.stringify({ results, fixtureExit: ended, fixtureErrors: fixtureErrors() }, null, 2));
  assert.equal(ended.code, 0);
}

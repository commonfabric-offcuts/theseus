import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { fixtureControl } from './fixture_control.mjs';
import { readingSeed } from './topic_reading_native.mjs';

const { chromium } = await import(process.env.AIM_PLAYWRIGHT_CORE);
const evidence = process.argv[2];
await mkdir(evidence, { recursive: true });
const fixture = spawn('/usr/bin/python3', ['-B', 'tests/fixtures/ui_http.py', '--freshness', '--live']);
const { control, exit } = fixtureControl(fixture);
let browser;
try {
  const facts = await control({ method: 'ready' });
  const topic = 'starred-archive-control';
  const sender = facts.agent;
  const said = (key, body) => [key, { sender, body, join: true, addressees: [facts.actor], read: true, divergence_reason: 'Separate archive control dossiers.' }];
  const { starred, plain } = await readingSeed(control)(topic, [
    said('starred', 'A starred dossier'), said('plain', 'An ordinary dossier'),
  ]);
  let operation = 0;
  const star = async (id, starred) => {
    const receipt = await control({ method: 'stack_act', sender: facts.actor, kind: 'message.star',
      message_id: id, args: { starred }, operation_id: `${topic}-star-${++operation}` });
    assert.equal(receipt.status, 'committed', JSON.stringify(receipt));
    assert.equal(receipt.result.brought_back, undefined);
  };
  await star(starred, true);

  browser = await chromium.launch({ executablePath: process.env.AIM_CHROME });
  const wide = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const narrow = await browser.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  const errors = [];
  for (const page of [wide, narrow]) {
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(`${facts.origin}/?topic=${topic}`);
    await page.locator('body[data-ready=true]').waitFor();
  }
  const section = id => `#messages .reply-stack[data-stack="${id}"]`;
  const shelf = '#things .archive-shelf:not([hidden]) .shelf-dossier';
  const more = narrow.locator('#messages .stack-more');
  const archive = async id => {
    await wide.locator(section(id)).hover();
    await wide.locator(`${section(id)} [aria-label="Archive"]`).click();
  };
  const ordered = async (page, selector, attribute, ids) => {
    await page.waitForFunction(({ selector, attribute, ids }) => {
      const actual = [...document.querySelectorAll(selector)].filter(node => node.getClientRects().length)
        .map(node => node.getAttribute(attribute));
      return JSON.stringify(actual) === JSON.stringify(ids);
    }, { selector, attribute, ids }, { timeout: 9000 });
  };
  const wideOrder = ids => ordered(wide, shelf, 'data-id', ids);
  const narrowOrder = ids => ordered(narrow, '#messages .stack-controls ~ .reply-stack', 'data-stack', ids);
  await archive(starred);
  await wideOrder([starred]);
  await archive(plain);
  await wideOrder([starred, plain]);
  await more.click();
  await narrowOrder([starred, plain]);
  const words = narrow.locator(`${section(starred)} .message-preview`);
  await words.tap();
  const reader = narrow.locator('#reader');
  if (await reader.getAttribute('open') === null) await words.tap();
  await narrow.locator('#reader[open]').waitFor();
  await narrow.locator('#source-body').getByText('A starred dossier', { exact: true }).waitFor();
  await narrow.getByRole('button', { name: 'Next message (below)' }).tap();
  await narrow.locator('#source-body').getByText('An ordinary dossier', { exact: true }).waitFor();
  await narrow.getByRole('button', { name: 'Previous message (above)' }).tap();
  await narrow.locator('#source-body').getByText('A starred dossier', { exact: true }).waitFor();
  await narrow.locator('#reader-close').tap();
  await wide.screenshot({ path: `${evidence}/wide-starred-first.png` });
  await narrow.screenshot({ path: `${evidence}/phone-starred-first.png`, fullPage: true });

  await star(starred, false);
  await star(plain, true);
  await wideOrder([plain, starred]);
  await narrowOrder([plain, starred]);

  await wide.locator(`${shelf}[data-id="${plain}"]`).press('Meta+z');
  await wideOrder([starred]);
  await wide.locator(section(plain)).waitFor();
  await archive(plain);
  await wideOrder([plain, starred]);
  await narrowOrder([plain, starred]);

  const returned = await control({ method: 'agent_message', sender, source: 'topic', topic_id: topic,
    operation_id: `${topic}-visible-return`, body: 'A newer visible reply returns the starred dossier.',
    reply_to: plain, reply_without_quote: 'A later reply.', addressees: [facts.actor] });
  assert.equal(returned.status, 'committed', JSON.stringify(returned));
  await wideOrder([starred]);
  await narrowOrder([starred]);
  await wide.locator(section(plain)).waitFor();
  await narrow.locator(section(plain)).waitFor();
  assert.deepEqual(errors, []);
  console.log('Wide and narrow archive ordering, Reader arrows, cross-tab stars, undo, and a newer visible reply passed.');
} finally {
  await browser?.close();
  fixture.stdin.end();
  assert.deepEqual(await exit, { code: 0, signal: null });
}

import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fixtureControl } from './fixture_control.mjs';

const [out, widthArg = '1280', input = 'mouse'] = process.argv.slice(2);
const width = Number(widthArg), touch = input === 'touch';
assert.ok(out && [390, 1280].includes(width) && ['mouse', 'touch'].includes(input));
await mkdir(out, { recursive: true });
const { chromium } = await import(process.env.AIM_PLAYWRIGHT_CORE);
const fixture = spawn('/usr/bin/python3', ['-B', 'tests/fixtures/ui_http.py', '--freshness', '--live',
  '--teardown-observations', out + '/teardown.jsonl']);
const { control, exit, errors } = fixtureControl(fixture);
const report = { width, input, phases: {}, pageErrors: [] };
let browser, page;

async function geometry() {
  return page.evaluate(() => {
    const rect = node => {
      const { left, top, right, bottom, width, height } = node.getBoundingClientRect();
      return { left, top, right, bottom, width, height };
    };
    const sample = node => {
      const box = rect(node);
      const fractions = [0.25, 0.5, 0.75];
      const hits = box.width && box.height ? fractions.flatMap(y => fractions.map(x =>
        document.elementFromPoint(box.left + box.width * x, box.top + box.height * y)
          ?.closest('button')?.id ?? null)) : [];
      return { box, display: getComputedStyle(node).display, area: getComputedStyle(node).gridArea,
        hit: hits[4] ?? null, hits, text: node.textContent.trim() };
    };
    const thumb = document.querySelector('#thumb-source'), send = document.querySelector('#send-reply');
    const composer = document.querySelector('#reader-composer'), pane = document.querySelector('.reading-pane');
    const a = sample(thumb), b = sample(send);
    const overlaps = a.box.height > 0 && b.box.height > 0 && a.box.width > 0 && b.box.width > 0 &&
      Math.min(a.box.right, b.box.right) > Math.max(a.box.left, b.box.left) &&
      Math.min(a.box.bottom, b.box.bottom) > Math.max(a.box.top, b.box.top);
    return { layout: document.querySelector('#reader').dataset.layout, state: composer.dataset.compose,
      thumb: a, send: b, overlaps,
      sourceReactions: { box: rect(document.querySelector('#reader-reactions')), pane: rect(pane), composer: rect(composer) },
      floatingThumbs: [...document.querySelectorAll('.message-bar button[data-act=thumb]')]
        .map(node => ({ hit: sample(node).hit, display: getComputedStyle(node.parentElement).display })) };
  });
}

try {
  const facts = await control({ method: 'ready' });
  const topic = 'stacked-reader-thumbs';
  await control({ method: 'navigation_topics', topics: [{ id: topic, title: 'Reader thumb layout' }] });
  const posted = await control({ method: 'agent_message', operation_id: 'reader-thumb-layout-source',
    sender: facts.agent, topic_id: topic, join: true, source: 'topic',
    divergence_reason: 'Isolated Reader thumb layout fixture.', body: 'An independent message for the Reader thumb layout.',
    addressees: [facts.actor], intent: 'tell' });
  assert.equal(posted.status, 'committed', JSON.stringify(posted));
  const message = posted.result.message_id;
  assert.equal((await control({ method: 'agent_thumb', sender: facts.actor, message_id: message,
    operation_id: 'reader-thumb-layout-reaction', thumbed: true })).status, 'committed');

  browser = await chromium.launch({ executablePath: process.env.AIM_CHROME });
  const context = await browser.newContext({ viewport: { width, height: 844 }, isMobile: touch, hasTouch: touch });
  await context.addInitScript(instance => {
    localStorage.setItem(JSON.stringify(['aim-next', instance, 'reader-layout', 'mode']), 'stacked');
  }, facts.instance_id);
  page = await context.newPage();
  page.setDefaultTimeout(10000);
  page.on('pageerror', error => report.pageErrors.push(error.stack));
  await page.goto(facts.origin + '/?topic=' + topic + '&message=' + message);
  await page.locator('#reader[open] #source-body').getByText('An independent message for the Reader thumb layout.').waitFor();
  await page.locator('#reader-reactions').getByText('👍 1 you').waitFor();
  const press = selector => touch ? page.locator(selector).tap() : page.locator(selector).click();

  report.phases.reading = await geometry();
  await page.screenshot({ path: out + '/reading.png' });
  await press('#writing-body');
  await page.waitForFunction(() => document.querySelector('#reader-composer').dataset.compose === 'writing');
  report.phases.emptyDraft = await geometry();
  await page.keyboard.insertText('Can you confirm this layout?');
  const send = page.locator('#send-reply');
  await page.waitForFunction(() => document.querySelector('#reader-composer').hasAttribute('data-has-writing') &&
    document.querySelector('#send-reply').getAttribute('aria-disabled') !== 'true');
  report.phases.writing = await geometry();
  await page.screenshot({ path: out + '/writing.png' });

  const { reading, emptyDraft, writing } = report.phases;
  assert.ok(Object.values(report.phases).every(phase => phase.layout === 'stacked'));
  assert.ok(Object.values(report.phases).every(phase => !phase.overlaps), 'the thumb and send button do not overlap');
  assert.equal(reading.state, 'line');
  assert.equal(reading.thumb.hit, 'thumb-source');
  assert.equal(reading.send.display, 'none', 'the reading line gives the right-hand slot to the thumb');
  assert.equal(emptyDraft.send.hit, 'send-reply', 'the empty draft has a separate send button');
  assert.equal(emptyDraft.thumb.hit, 'thumb-source');
  assert.equal(writing.thumb.display, 'none', 'the review-only control leaves the writing row');
  for (const phase of [emptyDraft, writing]) {
    assert.deepEqual(phase.send.hits, Array(9).fill('send-reply'), 'native hit testing finds no control covering Ask');
  }
  assert.match(writing.send.text, /^Ask\b/);
  assert.ok(writing.sourceReactions.box.width > 0 && writing.sourceReactions.box.bottom <= writing.sourceReactions.composer.top,
    'the shared thumb count remains in the reading pane above the composer');

  await send.scrollIntoViewIfNeeded();
  const reply = page.waitForResponse(response => {
    if (new URL(response.url()).pathname !== '/api/command') return false;
    return response.request().postDataJSON()?.kind === 'message.send';
  });
  await press('#send-reply');
  const confirmation = await (await reply).json();
  assert.equal(confirmation.status, 'committed');
  report.send = { status: confirmation.status, message: confirmation.result.message_id };
  assert.deepEqual(report.pageErrors, []);
  report.served = {};
  for (const asset of ['aim.css', 'reader-dense.css', 'write-touch.css']) {
    const response = await page.request.get(facts.origin + '/' + asset);
    assert.ok(response.ok());
    const body = await response.body();
    assert.deepEqual(body, await readFile('web/' + asset));
    report.served[asset] = createHash('sha256').update(body).digest('hex');
  }
} catch (error) {
  report.failure = error.stack;
  throw error;
} finally {
  await browser?.close();
  report.browserClosed = !browser?.isConnected();
  fixture.stdin.end();
  report.fixture = await exit;
  report.fixtureErrors = errors();
  await writeFile(out + '/report.json', JSON.stringify(report, null, 2) + '\n');
  assert.deepEqual(report.fixture, { code: 0, signal: null });
  assert.equal(report.fixtureErrors, '');
}

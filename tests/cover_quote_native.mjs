import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fixtureControl } from './fixture_control.mjs';

const [artifact, widthArg = '1280', scheme = 'light', look = 'bookends'] = process.argv.slice(2);
const width = Number(widthArg), phone = width < 760;
assert.ok(artifact && [1280, 390].includes(width));
await mkdir(artifact, { recursive: true });
const report = { width, scheme, look, errors: [], checks: [] };
const { chromium } = await import(process.env.AIM_PLAYWRIGHT_CORE);
const fixture = spawn('/usr/bin/python3', ['-B', 'tests/fixtures/ui_http.py', '--freshness', '--live', '--agent-colors',
  '--teardown-observations', artifact + '/teardown.jsonl']);
const { control, exit, errors } = fixtureControl(fixture);
let browser, page;
try {
  const { origin, actor } = await control({ method: 'ready' });
  const topic = 'synthetic-cover-quote';
  await control({ method: 'navigation_topics', topics: [{ id: topic, title: 'Cover quote sample' }] });
  const post = async (name, body, extra = {}) => {
    const result = await control({ method: 'agent_message', source: 'topic', sender: 'aim-core', join: true,
      operation_id: 'cover-quote-' + name, topic_id: topic, body, addressees: [actor], intent: 'tell',
      divergence_reason: 'Independent cover quote sample.', ...extra });
    assert.equal(result.status, 'committed', JSON.stringify(result));
    return result.result.message_id;
  };
  const root = await post('root', 'The original message in this dossier.');
  const prior = await post('reply', 'A prior reply under the same dossier.', { reply_to: root, reply_without_quote: 'Synthetic reading fixture.' });
  const stands = '## Plan\n\n👋 Keep **these** exact words.';
  const cover = await control({ method: 'stack_act', kind: 'stack.cover', sender: 'aim-core', message_id: root,
    operation_id: 'quote-cover-revision', args: { stands, waiting: [{ text: 'Which choice?', default: 'Wait' }] } });
  assert.equal(cover.status, 'committed', JSON.stringify(cover));
  const revision = cover.result.cover_revision;
  assert.ok(revision > 0);
  const excerpt = 'Keep **these** exact words.';
  const attribution = 'From the cover · Plan', contextLine = 'Replying to the cover · Plan';
  const opening = '> ' + excerpt + '\n\n';
  const start = Array.from(stands.slice(0, stands.indexOf(excerpt))).length;
  const expected = { source: { kind: 'cover', id: root, revision, part: 'stands' },
    excerpt, start, end: start + Array.from(excerpt).length, section: 'Plan' };
  report.expected = expected;

  browser = await chromium.launch({ executablePath: process.env.AIM_CHROME, headless: true });
  const context = await browser.newContext({ viewport: { width, height: 960 }, colorScheme: scheme, isMobile: phone, hasTouch: phone });
  await context.addInitScript(paper => { if (paper) localStorage.setItem('theseus-look', 'paper'); }, look === 'paper');
  await context.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
  page = await context.newPage(); page.setDefaultTimeout(8000);
  page.on('pageerror', error => report.errors.push(error.stack));
  await page.goto(origin + '/?topic=' + topic);
  const dossier = page.locator(`#messages .reply-stack[data-stack="${root}"]`);
  const words = dossier.locator('.cover-stands');
  const composer = page.locator(`#reply-${root}-composer`);
  const field = composer.locator('textarea').first();
  await page.locator('body[data-ready=true]').waitFor();
  assert.equal(await page.locator('html').getAttribute('data-look'), look === 'paper' ? 'paper' : null);
  assert.equal(await page.evaluate(() => matchMedia('(prefers-color-scheme: dark)').matches), scheme === 'dark');
  await words.getByText('Keep these exact words.').waitFor();
  const ordinary = dossier.locator(`.message-card[data-id="${prior}"] > .message-reply-to`);
  assert.match(await ordinary.textContent(), /^Replying to aim-core: The original message/);
  const pill = page.locator('#cover-quote-selection');
  const paragraph = words.locator('.md-p').filter({ hasText: 'Keep' });
  if (!phone) {
    const disclosure = words.locator('.cover-section');
    await disclosure.locator('summary').click();
    assert.equal(await disclosure.evaluate(node => node.open), false);
    await page.keyboard.press('Enter');
    assert.equal(await disclosure.evaluate(node => node.open), true);
  }
  await paragraph.click();
  await page.keyboard.press('Enter');
  assert.equal(await pill.isVisible(), false);
  assert.equal(await composer.isVisible(), false);
  assert.equal(await page.locator('#new-message-sheet[open]').count(), 0);
  report.checks.push('An empty selection opens no reply, and Return still toggles a focused cover section.');
  await paragraph.scrollIntoViewIfNeeded();
  const points = await paragraph.evaluate(node => {
    const first = node.firstChild, last = node.lastChild;
    const edge = (at, offset) => {
      const range = document.createRange(); range.setStart(at, offset); range.collapse(true);
      const box = range.getBoundingClientRect();
      return { x: box.left, y: box.top + box.height / 2 };
    };
    return { start: edge(first, first.textContent.indexOf('Keep')), end: edge(last, last.textContent.length) };
  });
  report.points = points;
  report.targets = await page.evaluate(({ start, end }) => [start, end].map(({ x, y }) => {
    const at = document.elementFromPoint(x, y);
    return { node: at?.outerHTML.slice(0, 130), userSelect: at && getComputedStyle(at).userSelect };
  }), points);
  await page.mouse.move(points.start.x + 1, points.start.y);
  await page.mouse.down();
  await page.mouse.move(points.end.x - 1, points.end.y, { steps: 15 });
  await page.mouse.up();
  assert.equal(await page.evaluate(() => getSelection().toString()), 'Keep these exact words.');
  if (phone) {
    await pill.waitFor();
    await page.screenshot({ path: artifact + '/cover-selection.png' });
    await pill.tap();
  } else {
    await page.screenshot({ path: artifact + '/cover-selection.png' });
    await page.keyboard.press('Enter');
  }
  assert.equal(await field.inputValue(), opening);
  const label = composer.locator('.cover-quote-attribution');
  assert.equal(await label.textContent(), attribution);
  assert.equal(await label.evaluate(node => node.nextElementSibling === node.parentElement.querySelector('textarea') &&
    !node.isContentEditable), true);
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  assert.equal(await field.evaluate(node => node.scrollTop), 0, 'the composer opens with the attribution visible');
  await page.screenshot({ path: artifact + '/inline-cover-quote.png' });
  const saved = await control({ method: 'agent_view', actor, name: 'dossier_cover', args: { message_id: root } });
  assert.equal(saved.cover_revision, revision);
  assert.equal(saved.cover.stands, stands);
  report.checks.push('A selection across formatting opens the root reply with its cover section and exact authored words.');

  await field.press('End');
  await field.pressSequentially('Accepted synthetic reply.');
  const send = composer.locator(`#reply-${root}-send`);
  await (phone ? send.tap() : send.click());
  const view = (name, args) => control({ method: 'agent_view', actor, name, args });
  let sent;
  for (let checks = 0; checks < 60 && !sent; checks++) {
    const answer = await view('topic_messages', { topic_id: topic, direction: 'before', limit: 50 });
    sent = answer.items?.find(item => item.body?.includes('Accepted synthetic reply.'));
    if (!sent) await page.waitForTimeout(100);
  }
  assert.ok(sent, 'the real inline send was committed');
  const source = await view('source', { source_ref: { kind: 'message', id: sent.id } });
  assert.equal(source.body, opening + 'Accepted synthetic reply.');
  assert.equal(source.reply_to, root);
  assert.deepEqual(source.quotes, [expected]);
  report.readback = { body: source.body, reply_to: source.reply_to, quotes: source.quotes };
  report.checks.push('The committed reply reads back its cover revision and Unicode offsets.');
  const card = page.locator(`.message-card[data-id="${sent.id}"]`);
  const posted = card.locator(':scope > .message-preview');
  const attributionLine = card.locator(':scope > .message-reply-to');
  const displayed = posted.locator('.md-quote');
  await displayed.waitFor();
  assert.equal((await displayed.textContent()).trim(), 'Keep these exact words.');
  assert.equal(await displayed.locator('strong').textContent(), 'these');
  assert.equal(await attributionLine.textContent(), contextLine);
  assert.ok(!(await posted.textContent()).includes(attribution));
  await posted.scrollIntoViewIfNeeded();
  await page.screenshot({ path: artifact + '/posted-cover-quote.png' });

  const refresh = await control({ method: 'stack_act', kind: 'stack.cover', sender: 'aim-core', message_id: root,
    operation_id: 'quote-cover-next-revision', args: { stands: '## Renamed\n\nThe cover changed.' } });
  assert.equal(refresh.status, 'committed', JSON.stringify(refresh));
  assert.equal(refresh.result.cover_revision, revision + 1);
  await words.getByText('The cover changed.').waitFor();
  assert.equal(await attributionLine.textContent(), contextLine);
  const historical = await view('source', { source_ref: { kind: 'message', id: sent.id } });
  assert.equal(historical.body, source.body);
  assert.deepEqual(historical.quotes, [expected]);
  report.checks.push('The posted quote names its original cover section above its formatted words after a cover rewrite.');
  report.served = {};
  for (const name of ['aim.css', 'app.mjs', 'cover-quote-selection.mjs', 'dossier-cover.mjs', 'dossier-selection-quote.mjs',
    'inline-composer.mjs', 'pane-keys.mjs', 'question-state.mjs', 'replies.mjs', 'reply-stacks.mjs', 'stack-order.mjs']) {
    const response = await context.request.get(origin + '/' + name);
    assert.ok(response.ok(), name);
    const bytes = await response.body();
    assert.deepEqual(bytes, await readFile('web/' + name), name);
    report.served['web/' + name] = createHash('sha256').update(bytes).digest('hex');
  }
  assert.deepEqual(report.errors, []);
} catch (error) {
  report.failure = error.stack;
  if (page) await page.screenshot({ path: artifact + '/failure.png' }).catch(() => {});
  throw error;
} finally {
  await browser?.close();
  fixture.stdin.end();
  report.fixture = await exit; report.fixtureErrors = errors();
  await writeFile(artifact + '/report.json', JSON.stringify(report, null, 2) + '\n');
  assert.deepEqual(report.fixture, { code: 0, signal: null });
  assert.equal(report.fixtureErrors, '');
}

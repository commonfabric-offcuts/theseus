import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fixtureControl } from './fixture_control.mjs';

const [out, widthArg = '1280', visit = 'same'] = process.argv.slice(2);
const width = Number(widthArg), phone = width < 760;
assert.ok(out && [390, 1280].includes(width) && ['same', 'cross'].includes(visit));
await mkdir(out, { recursive: true });
const { chromium } = await import(process.env.AIM_PLAYWRIGHT_CORE);
const fixture = spawn('/usr/bin/python3', ['-B', 'tests/fixtures/ui_http.py', '--freshness', '--live',
  '--teardown-observations', out + '/teardown.jsonl']);
const { control, exit, errors } = fixtureControl(fixture);
const report = { width, visit, errors: [], reads: [] };
let browser, page;
try {
  const { origin, actor, agent } = await control({ method: 'ready' });
  const topic = 'star-landing-topic', title = 'A reader starred one reply';
  await control({ method: 'navigation_topics', topics: [{ id: topic, title: 'Dossiers with a loaded history window' }] });
  const post = async (operation, body, replyTo) => {
    const outcome = await control({ method: 'agent_message', operation_id: '45-' + operation, sender: agent,
      topic_id: topic, source: 'topic', join: true, body, addressees: [actor], intent: 'tell',
      ...(replyTo ? { reply_to: replyTo, reply_without_quote: 'Independent fixture reply.' }
        : { divergence_reason: 'Independent starred dossier fixture.' }) });
    assert.equal(outcome.status, 'committed', JSON.stringify(outcome));
    return outcome.result.message_id;
  };
  const root = await post('root', 'This is the old root of the dossier.');
  const starred = await post('starred', 'The first reply carries the only star.', root);
  for (let index = 0; index < 32; index++) await post('between-' + index, 'An unrelated dossier between the replies ' + index);
  const later = await post('later-reply', 'The second reply is part of the dossier.', root);
  assert.equal((await control({ method: 'stack_act', sender: agent, kind: 'stack.name', message_id: root,
    operation_id: '45-name', args: { name: title } })).status, 'committed');
  assert.equal((await control({ method: 'stack_act', sender: actor, kind: 'message.star', message_id: starred,
    operation_id: '45-star', args: { starred: true } })).status, 'committed');
  for (let index = 0; index < 38; index++) await post('later-' + index, 'An unrelated newer dossier ' + index);
  report.ids = { root, later, starred };

  browser = await chromium.launch({ executablePath: process.env.AIM_CHROME });
  page = await browser.newPage({ viewport: { width, height: 900 }, isMobile: phone, hasTouch: phone });
  page.setDefaultTimeout(12000);
  page.on('pageerror', error => report.errors.push(error.stack));
  page.on('request', request => {
    if (new URL(request.url()).pathname !== '/api/view') return;
    const { name, args } = request.postDataJSON() ?? {};
    if (args?.topic_id === topic && ['source', 'topic_messages', 'stack_positions', 'stars'].includes(name))
      report.reads.push({ name, args });
  });
  await page.goto(origin + '/?topic=' + (visit === 'same' ? topic : 't1'));
  await page.locator('body[data-ready=true]').waitFor();
  if (phone) await page.locator('#rail-open').tap();
  const disclosure = page.getByRole('button', { name: 'Open topics in Isolated wiring', exact: true });
  if (await disclosure.isVisible()) await (phone ? disclosure.tap() : disclosure.click());
  const row = page.locator(`#outline .ol-dossier[data-dossier-id="${root}"]`);
  await row.waitFor();
  assert.match(await row.textContent(), /^★ /);
  assert.equal(await page.locator(`#messages .message-card[data-id="${root}"]`).count(), 0,
    'the first feed window starts past the old dossier');
  report.href = await row.getAttribute('href');
  await (phone ? row.tap() : row.click());
  const dossier = page.locator(`#messages .reply-stack[data-stack="${root}"]`);
  await dossier.waitFor();
  await page.waitForFunction(id => document.activeElement?.dataset.id === id, root);
  report.dossier = await dossier.evaluate(section => ({
    summary: section.querySelector('.stack-meta')?.textContent,
    members: [...section.querySelectorAll('.message-card[data-id]')].map(card => card.dataset.id),
    titleStars: [...section.querySelectorAll('.stack-head [aria-pressed], .stack-head [aria-label="Starred dossier"]')]
      .map(star => ({ label: star.getAttribute('aria-label'), text: star.textContent })),
    stars: [...section.querySelectorAll('.message-card[data-starred=true]')].map(card => card.dataset.id),
    focused: document.activeElement?.dataset.id,
  }));
  await page.screenshot({ path: out + '/landed.png' });
  assert.match(report.dossier.summary, /2 replies/);
  assert.deepEqual(report.dossier.members, [root, starred, later]);
  assert.deepEqual(report.dossier.stars, [starred]);
  assert.ok(report.dossier.titleStars.some(star => star.text.startsWith('★')));
  assert.ok(report.dossier.titleStars.some(star => star.label === 'Star first message' && star.text.startsWith('☆')));
  assert.deepEqual(report.reads.filter(read => read.args.dossier_id).map(({ args }) => [args.dossier_id, args.limit]), [[root, 30]]);
  assert.equal(await page.locator('#reader[open], #new-message-sheet[open], .card-reply-composer:not([hidden])').count(), 0);
  assert.deepEqual(report.errors, []);
  report.served = {};
  for (const asset of ['app.mjs', 'outline-dossiers.mjs', 'reply-stacks.mjs', 'stack-look.css', 'topic-navigation.mjs', 'topic-views.mjs']) {
    const response = await page.request.get(origin + '/' + asset);
    assert.ok(response.ok(), asset);
    const bytes = await response.body();
    assert.deepEqual(bytes, await readFile('web/' + asset));
    report.served[asset] = createHash('sha256').update(bytes).digest('hex');
  }
} catch (error) {
  report.failure = error.stack;
  await page?.screenshot({ path: out + '/failure.png' }).catch(() => {});
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

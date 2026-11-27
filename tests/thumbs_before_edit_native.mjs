import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fixtureControl } from './fixture_control.mjs';

const [out, widthArg, look, theme, mode = 'candidate'] = process.argv.slice(2);
const width = Number(widthArg), phone = width === 390, baseline = mode === 'baseline';
const inReader = mode === 'reader';
assert.ok(out && [390, 1280].includes(width) && ['bookends', 'paper'].includes(look) && ['light', 'dark'].includes(theme));
assert.ok(['baseline', 'reader', 'candidate'].includes(mode));
await mkdir(out, { recursive: true });
const { chromium } = await import(process.env.AIM_PLAYWRIGHT_CORE);
const fixture = spawn('/usr/bin/python3', ['-B', 'tests/fixtures/ui_http.py', '--freshness', '--other-person',
  ...(inReader ? ['--live'] : []),
  '--teardown-observations', out + '/teardown.jsonl']);
const { control, exit, errors } = fixtureControl(fixture);
const report = { width, look, theme, mode, reads: [], commands: [], errors: [] };
let browser, page;
try {
  const { origin, actor, agent } = await control({ method: 'ready' });
  const topic = 'thumbs-before-edit', other = 'fixture-other-person';
  await control({ method: 'navigation_topics', topics: [{ id: topic, title: 'Conversation about the garden' }] });
  await control({ method: 'topic_state', operation_id: '51-team', topic_id: topic, participants: [actor, agent, other],
    args: { state: 'active', note: '' } });
  const post = async (id, body) => {
    const receipt = await control({ method: 'agent_message', operation_id: '51-post-' + id, sender: agent, topic_id: topic,
      source: 'topic', join: true, divergence_reason: 'Separate native thumbs example ' + id, body });
    assert.equal(receipt.status, 'committed');
    return receipt.result.message_id;
  };
  const thumbFor = async (sender, id, op) => {
    const receipt = await control({ method: 'agent_thumb', sender, message_id: id, operation_id: '51-' + op });
    assert.equal(receipt.status, 'committed');
  };
  const edit = async (id, op, body, revision = 1) => {
    const receipt = await control({ method: 'agent_edit', sender: agent, message_id: id, operation_id: '51-' + op, body, revision });
    assert.equal(receipt.status, 'committed');
    return receipt.result.edited_ms;
  };
  const mixed = await post('mixed', 'The seedlings can go in on Friday morning.');
  await thumbFor(actor, mixed, 'old-own');
  const editedAt = await edit(mixed, 'mixed-revision', 'The seedlings can go in on Saturday morning.');
  await thumbFor(other, mixed, 'current-other');
  const older = await post('older', 'The gate closes at six.');
  await thumbFor(other, older, 'only-old');
  await edit(older, 'older-revision', 'The gate closes at seven.');
  report.ids = { mixed, older };

  browser = await chromium.launch({ executablePath: process.env.AIM_CHROME });
  const context = await browser.newContext({ viewport: { width, height: 900 }, isMobile: phone, hasTouch: phone,
    colorScheme: theme, reducedMotion: 'reduce' });
  await context.addInitScript(look => {
    localStorage.setItem('theseus-look', look === 'paper' ? 'paper' : '');
    window.thumbInput = [];
    for (const type of ['pointerdown', 'pointerup', 'mousedown', 'focusin', 'click']) {
      document.addEventListener(type, event => {
        const card = event.target.closest?.('.message-card');
        if (card) window.thumbInput.push({
          type, trusted: event.isTrusted, pointer: event.pointerType, target: event.target.className,
          reaction: event.target.closest('[data-react]')?.dataset.react, lit: card.classList.contains('lit')
        });
      }, true);
    }
  }, look);
  page = await context.newPage();
  page.setDefaultTimeout(10000);
  page.on('pageerror', error => report.errors.push(error.stack));
  const pending = new Set();
  const finished = request => pending.delete(request);
  page.on('requestfinished', finished);
  page.on('requestfailed', finished);
  page.on('request', request => {
    const path = new URL(request.url()).pathname;
    if (path === '/api/view') {
      const { name, args } = request.postDataJSON() ?? {};
      report.reads.push({ name, args });
      pending.add(request);
    }
    if (path === '/api/command') {
      const { kind, expected, target } = request.postDataJSON() ?? {};
      report.commands.push({ kind, expected, target });
    }
  });
  const settleReads = async () => {
    for (let turn = 0; turn < 100; turn++) {
      const before = report.reads.length;
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      if (!pending.size && before === report.reads.length) return;
    }
    assert.fail('The fixture view reads did not settle.');
  };
  await page.goto(origin + '/?topic=' + topic);
  await page.locator('body[data-ready=true]').waitFor();
  assert.deepEqual(await page.evaluate(() => ({
    look: document.documentElement.dataset.look || 'bookends', dark: matchMedia('(prefers-color-scheme:dark)').matches
  })), { look, dark: theme === 'dark' });
  const mixedCard = page.locator('#messages .message-card[data-id="' + mixed + '"]');
  const olderCard = page.locator('#messages .message-card[data-id="' + older + '"]');
  const chips = card => card.locator('.message-reactions .reaction-count');
  const prior = card => card.locator('.reaction-stale');
  await chips(mixedCard).first().waitFor();
  await chips(olderCard).first().waitFor();
  await mixedCard.scrollIntoViewIfNeeded();
  await settleReads();
  await page.screenshot({ path: out + '/thumbs.png' });

  if (baseline) {
    assert.equal(await chips(mixedCard).count(), 1, 'old client groups the current and earlier thumbs together');
    assert.equal(await chips(mixedCard).first().locator('.reaction-number').textContent(), '2');
    report.initialReads = report.reads.slice();
  } else {
    assert.equal(await chips(mixedCard).count(), 2);
    assert.equal(await chips(mixedCard).first().locator('.reaction-number').textContent(), '1');
    assert.equal((await chips(mixedCard).nth(1).textContent()).trim(), '👍 1');
    assert.equal(await prior(mixedCard).getAttribute('aria-label'), 'Thumbed before the latest edit: you');
    assert.equal(await prior(mixedCard).getAttribute('aria-pressed'), 'false');
    assert.equal(await prior(mixedCard).getAttribute('role'), 'button');
    assert.deepEqual(await prior(mixedCard).evaluate(node => {
      const style = getComputedStyle(node);
      return { border: style.borderTopStyle, width: style.borderTopWidth, muted: style.color === style.borderTopColor,
        opacity: style.opacity, emojiOpacity: getComputedStyle(node.querySelector('.reaction-stale-emoji')).opacity };
    }), { border: 'dashed', width: '1px', muted: true, opacity: '1', emojiOpacity: '0.55' });
    assert.equal(await chips(olderCard).count(), 1);
    assert.equal(await prior(olderCard).getAttribute('title'), 'Thumbed before the latest edit: ' + other);
    assert.equal(await prior(olderCard).getAttribute('aria-pressed'), null);
    report.initialReads = report.reads.slice();
    let staleButton = prior(mixedCard);
    if (inReader) {
      await page.goto(origin + '/?topic=' + topic + '&message=' + mixed);
      staleButton = page.locator('#reader[open] #reader-reactions button.reaction-stale');
      await staleButton.waitFor();
      await settleReads();
    }
    const thumbReadAt = report.reads.length;
    const renewed = page.waitForResponse(response => new URL(response.url()).pathname === '/api/command' &&
      response.request().postDataJSON()?.kind === 'message.thumb' &&
      response.request().postDataJSON()?.target?.message_id === mixed);
    if (phone) await staleButton.tap(); else await staleButton.click();
    const receipt = await (await renewed).json();
    assert.equal(receipt.status, 'committed');
    assert.equal(receipt.result.changed, true);
    assert.equal(receipt.result.thumb_revision, 3);
    await staleButton.waitFor({ state: 'detached' });
    if (inReader) {
      const line = page.locator('#reader[open] #reader-reactions');
      await line.getByText(/👍 2/).waitFor();
      assert.equal(await line.locator('.reaction-stale').count(), 0);
    } else {
      assert.equal(await chips(mixedCard).count(), 1);
      assert.equal(await chips(mixedCard).first().locator('.reaction-number').textContent(), '2');
      assert.equal(await prior(olderCard).count(), 1);
    }
    await settleReads();
    report.actionReads = report.reads.slice(thumbReadAt);
    const reactionReads = report.actionReads.filter(each => each.name === 'reactions').map(each => each.args.message_id);
    if (inReader) {
      // The stream can also refresh the same reaction after its commit.
      assert.ok(reactionReads.length >= 1 && reactionReads.every(id => id === mixed));
    } else assert.deepEqual(reactionReads, [mixed]);
    const source = await control({ method: 'agent_view', actor, name: 'reactions', args: { message_id: mixed } });
    assert.equal(source.reactions.thumbs.length, 2);
    assert.ok(source.reactions.thumbs.find(thumb => thumb.actor_id === actor).at_ms >= editedAt);
    const command = report.commands.find(each => each.kind === 'message.thumb');
    assert.equal(command.expected.message_revision, 2);
    report.renewed = true;
    await page.screenshot({ path: out + '/thumb-renewed.png' });
    if (inReader) {
      await edit(mixed, 'reader-live-revision', 'The seedlings can go in on Sunday morning.', 2);
      await page.waitForFunction(() => document.querySelector('#source-body').textContent.includes('Sunday'));
      assert.equal((await staleButton.textContent()).trim(), '👍 2', 'the open Reader redraws both now-earlier thumbs');
      assert.equal(await page.locator('#thumb-source').getAttribute('aria-pressed'), 'false');
      const secondRenewal = page.waitForResponse(response => new URL(response.url()).pathname === '/api/command' &&
        response.request().postDataJSON()?.expected?.message_revision === 3 &&
        response.request().postDataJSON()?.kind === 'message.thumb');
      await staleButton.click();
      const second = await (await secondRenewal).json();
      assert.equal(second.status, 'committed');
      assert.equal(second.result.thumb_revision, 5);
      const line = page.locator('#reader[open] #reader-reactions');
      await line.getByText(/👍 1 you/).waitFor();
      assert.equal(await line.locator('.reaction-stale').getAttribute('aria-label'), 'Thumbed before the latest edit: ' + other);
      report.renewedAfterLiveEdit = true;
    }
  }
  assert.deepEqual(report.errors, []);
  report.served = {};
  for (const asset of ['aim.css', 'app.mjs', 'reader.mjs', 'reactions.mjs', 'message-menu.mjs', 'stack-feed.mjs']) {
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
  if (page) report.input = await page.evaluate(() => window.thumbInput).catch(() => []);
  await browser?.close();
  report.browserClosed = !browser?.isConnected();
  fixture.stdin.end();
  report.fixture = await exit;
  report.fixtureErrors = errors();
  await writeFile(out + '/report.json', JSON.stringify(report, null, 2) + '\n');
  assert.deepEqual(report.fixture, { code: 0, signal: null });
  assert.equal(report.fixtureErrors, '');
}

// Native input on the actual waiting mark, real isolated HTTP/Core records.
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import net from 'node:net';
import { fixtureControl } from './fixture_control.mjs';
const { chromium } = await import(process.env.AIM_PLAYWRIGHT_CORE);
const evidence = process.argv[2];
await mkdir(evidence, { recursive: true });
const fixture = spawn('/usr/bin/python3', ['-B', 'tests/fixtures/ui_http.py', '--freshness']);
const { control, exit, errors: fixtureErrors } = fixtureControl(fixture);
const results = [], cleanup = {};
let browser, profile, origin, failure;
const card = id => `#messages .message-card[data-id="${id}"]`;
const state = locator => locator.evaluate(mark => ({
  label: mark.getAttribute('aria-label'), title: mark.title,
  animations: [...mark.children].map(dot => getComputedStyle(dot).animationName),
  running: mark.getAnimations({ subtree: true }).map(animation => animation.playState),
}));
try {
  const facts = await control({ method: 'ready' }); origin = facts.origin;
  const conversation = await control({ method: 'coordinator', operation_id: '722-coordinator', coordinator: facts.agent });
  browser = await chromium.launch({ executablePath: process.env.AIM_CHROME, headless: true, args: ['--enable-automation'] });
  const cdp = await browser.newBrowserCDPSession();
  profile = (await cdp.send('Browser.getBrowserCommandLine')).arguments.find(arg => arg.startsWith('--user-data-dir='))?.split('=').slice(1).join('=');
  assert.ok(profile, 'identify the isolated profile');
  const view = (name, args) => control({ method: 'agent_view', actor: facts.actor, name, args });
  for (const [place, topic] of [['topic', 't1'], ['conversation', conversation.topic_id]]) {
    for (const width of [1280, 390]) for (const colorScheme of ['light', 'dark']) {
      const key = `${place}-${width}-${colorScheme}`;
      const sent = await control({ method: 'agent_message', operation_id: `722-${key}-ask`, sender: 'person',
        topic_id: topic, whole_topic: true, body: `Please check ${key}?`,
        post_args: { addressees: [facts.agent], intent: 'ask' } });
      assert.equal(sent.status, 'committed');
      const id = sent.result.message_id;
      const context = await browser.newContext({ viewport: { width, height: 900 }, colorScheme,
        hasTouch: width === 390, reducedMotion: 'no-preference' });
      const page = await context.newPage(); page.setDefaultTimeout(10000);
      const press = locator => width === 390 ? locator.tap() : locator.click();
      const errors = [], writes = [];
      page.on('pageerror', error => errors.push(error.message));
      page.on('request', request => { if (request.method() === 'POST') writes.push(request.url()); });
      await page.goto(`${origin}/?topic=${topic}`);
      await page.locator('body[data-ready=true]').waitFor();
      const beforeTopic = await view('topic', { topic_id: topic });
      const beforeMessage = (await view('topic_messages', { topic_id: topic, direction: 'before', limit: 50 })).items.find(item => item.id === id);
      if (place === 'conversation') {
        // Current Core deliberately excludes Conversations from awaiting_reply
        // (stacks.py); do not manufacture a new pulse or control there.
        assert.equal(beforeMessage.awaiting_reply, false);
        await page.locator(card(id)).waitFor({ state: 'visible' });
        assert.equal(await page.locator(`${card(id)} .item-waiting`).count(), 0);
        assert.equal(await page.locator(`${card(id)} .waiting-silence`).count(), 0);
        assert.deepEqual(errors, []);
        results.push({ key, conversationGuard: true, awaitingReply: false, errors });
        await page.screenshot({ path: `${evidence}/${key}-unchanged.png` });
        await context.close();
        continue;
      }
      const mark = page.locator(`${card(id)} .reply-wait .item-waiting`);
      await mark.waitFor({ state: 'visible' });
      const before = await state(mark);
      assert.deepEqual(before.animations, Array(3).fill('item-waiting'), 'real dots have the pulsing animation');
      assert.deepEqual(before.running, Array(3).fill('running'), 'real browser animations are running');
      assert.equal(beforeMessage.awaiting_reply, true);
      await page.screenshot({ path: `${evidence}/${key}-before.png` });
      await press(mark);
      const menu = page.locator('.message-menu-list[role=menu]');
      await menu.waitFor({ state: 'visible', timeout: 2500 });
      assert.equal(await menu.getByRole('menuitem').count(), 1);
      const silence = menu.getByRole('menuitem', { name: 'Silence', exact: true });
      assert.equal(await silence.locator('svg').count(), 1, 'Silence has a check drawing');
      // Escape keeps the pulse and puts keyboard focus back on its control.
      await page.keyboard.press('Escape');
      assert.deepEqual((await state(mark)).animations, before.animations);
      await page.keyboard.press('Enter');
      await menu.waitFor({ state: 'visible' });
      writes.length = 0;
      await press(silence);
      await menu.waitFor({ state: 'detached' });
      const after = await state(mark);
      assert.deepEqual(after.animations, Array(3).fill('none'));
      assert.equal(after.label, before.label); assert.equal(after.title, before.title);
      assert.deepEqual(writes, [], 'Silence sends no HTTP mutation');
      const afterTopic = await view('topic', { topic_id: topic });
      assert.deepEqual(afterTopic.topic.asks, beforeTopic.topic.asks, 'the actual request is unchanged');
      assert.equal(afterTopic.topic.state, beforeTopic.topic.state);
      const afterMessage = (await view('topic_messages', { topic_id: topic, direction: 'before', limit: 50 })).items.find(item => item.id === id);
      assert.equal(afterMessage.awaiting_reply, true);
      assert.equal(afterMessage.body, beforeMessage.body);
      if (width === 1280 && colorScheme === 'light') {
        await page.reload();
        await page.locator('body[data-ready=true]').waitFor();
        await mark.waitFor({ state: 'visible' });
        assert.deepEqual((await state(mark)).animations, Array(3).fill('item-waiting'), 'reload starts a new document unsilenced');
        await press(mark); await menu.waitFor({ state: 'visible' });
        await press(silence); await menu.waitFor({ state: 'detached' });
      }
      // A separate new request pulses; Silence has no page-wide mute.
      const another = await control({ method: 'agent_message', operation_id: `722-${key}-another`, sender: 'person',
        topic_id: topic, whole_topic: true, body: `Another request ${key}?`,
        post_args: { addressees: [facts.agent], intent: 'tell' } });
      assert.equal(another.status, 'committed');
      const nextMark = page.locator(`${card(another.result.message_id)} .reply-wait .item-waiting`);
      await nextMark.waitFor({ state: 'visible' });
      assert.deepEqual((await state(nextMark)).animations, Array(3).fill('item-waiting'));
      assert.deepEqual((await state(mark)).animations, Array(3).fill('none'), 'repaint retains only this silence');
      const answer = await control({ method: 'agent_message', operation_id: `722-${key}-reply`, sender: facts.agent,
        topic_id: topic, reply_to: id, addressees: [facts.actor], body: `Completed ${key}.`,
        reply_without_quote: 'The isolated fixture proves the reply still arrives.' });
      assert.equal(answer.status, 'committed');
      await page.locator(card(answer.result.message_id)).waitFor({ state: 'visible' });
      await mark.waitFor({ state: 'detached' });
      const completed = (await view('topic_messages', { topic_id: topic, direction: 'before', limit: 50 })).items.find(item => item.id === id);
      assert.equal(completed.awaiting_reply, false, 'Core completes the silenced request normally');
      assert.deepEqual(errors, []);
      results.push({ key, request: id, reply: answer.result.message_id, before, after, requestCompleted: true, errors });
      await page.screenshot({ path: `${evidence}/${key}-after.png` });
      await context.close();
    }
  }
} catch (error) { failure = error; }
finally {
  try { if (browser) { await browser.close(); cleanup.browserClosed = !browser.isConnected(); } }
  catch (error) { cleanup.browserError = error.message; failure ??= error; }
  fixture.stdin.end(); cleanup.fixtureExit = await exit;
  cleanup.fixtureErrors = fixtureErrors();
  const processes = execFileSync('/bin/ps', ['-axo', 'pid=,command='], { encoding: 'utf8' }).split('\n');
  cleanup.profile = profile;
  cleanup.profileProcesses = profile ? processes.filter(line => line.includes(profile)) : null;
  cleanup.fixtureAbsent = !processes.some(line => Number(line.trim().split(/\s/)[0]) === fixture.pid);
  if (origin) cleanup.portClosed = await new Promise(resolve => {
    const url = new URL(origin), socket = net.createConnection({ host: url.hostname, port: Number(url.port) });
    socket.once('connect', () => { socket.destroy(); resolve(false); }); socket.once('error', () => resolve(true));
  });
  await writeFile(`${evidence}/results.json`, JSON.stringify({ results, cleanup, failure: failure?.stack ?? null }, null, 2));
}
assert.equal(cleanup.browserClosed, true); assert.deepEqual(cleanup.profileProcesses, []);
assert.equal(cleanup.fixtureExit.code, 0); assert.equal(cleanup.fixtureAbsent, true); assert.equal(cleanup.portClosed, true);
if (failure) throw failure;
console.log(JSON.stringify({ passed: results.length, cleanup }));

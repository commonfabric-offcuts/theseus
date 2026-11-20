// Actual Conversation/rail/Reader navigation and authorized withdrawal.
// Isolated HTTP/Core fixture; native pointer and keyboard, no live records.
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import net from 'node:net';
import { fixtureControl } from './fixture_control.mjs';
const { chromium } = await import(process.env.AIM_PLAYWRIGHT_CORE);
const evidence = process.argv[2]; await mkdir(evidence, { recursive: true });
const child = spawn('/usr/bin/python3', ['tests/fixtures/ui_http.py', '--freshness']);
const { control, exit } = fixtureControl(child);
const results = [], cleanup = {};
let browser, profile, origin, failure;
try {
  const facts = await control({ method: 'ready' }); origin = facts.origin;
  const conversation = await control({ method: 'coordinator', operation_id: '928-coordinator', coordinator: facts.agent });
  const id = conversation.topic_id;
  await control({ method: 'topic_state', operation_id: '928-manual', topic_id: 't1',
    args: { state: 'waiting', waiting_on: [facts.agent], note: 'Which manual date?' } });
  browser = await chromium.launch({ executablePath: process.env.AIM_CHROME, headless: true, args: ['--enable-automation'] });
  const cdp = await browser.newBrowserCDPSession();
  profile = (await cdp.send('Browser.getBrowserCommandLine')).arguments.find(arg => arg.startsWith('--user-data-dir='))?.split('=').slice(1).join('=');
  assert.ok(profile, 'identify the actual isolated test profile');
  for (const width of [1280, 390]) for (const colorScheme of ['light', 'dark']) {
    const key = `${width}-${colorScheme}`, words = `Which build should ship for ${key}?`;
    const sent = await control({ method: 'agent_message', sender: 'person', topic_id: id, whole_topic: true,
      operation_id: `928-ask-${key}`, body: words, post_args: { addressees: [facts.agent], intent: 'ask' } });
    assert.equal(sent.status, 'committed'); const question = sent.result.message_id;
    const context = await browser.newContext({ viewport: { width, height: 900 }, colorScheme, hasTouch: width === 390 });
    const page = await context.newPage(); page.setDefaultTimeout(10000);
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    await page.goto(origin + '/?topic=t1');
    if (width === 390) await page.locator('#rail-open').click();
    const rowPill = page.locator(`#outline a[data-topic-id="${id}"] .topic-state`).first();
    await rowPill.waitFor({ state: 'visible' });
    assert.match(await rowPill.getAttribute('title'), new RegExp(words.replace(/[?]/g, '\\?')));
    await rowPill.click();
    await page.locator('#reader[open]').waitFor();
    assert.equal(await page.locator('#source-body').innerText(), words, 'a reader not asked reaches the exact question');
    await page.locator('#reader-close').click();
    const headerPill = page.locator('#topic-description a.topic-state');
    await headerPill.waitFor({ state: 'visible' });
    assert.match(await headerPill.getAttribute('title'), new RegExp(words.replace(/[?]/g, '\\?')));
    // The header pill uses native keyboard input through the app's navigation guard.
    await headerPill.focus(); await page.keyboard.press('Enter');
    await page.locator('#reader[open]').waitFor();
    assert.equal(await page.locator('#source-body').innerText(), words);
    await page.locator('#reader-menu').click();
    const receipt = page.waitForResponse(response => {
      try { return response.request().postDataJSON()?.kind === 'message.withdraw'; } catch { return false; }
    });
    await page.getByText('Withdraw question', { exact: true }).click();
    assert.equal((await (await receipt).json()).status, 'committed');
    await page.waitForFunction(() => !document.querySelector('#topic-description .topic-state'));
    const read = await control({ method: 'agent_view', actor: facts.actor, name: 'topic', args: { topic_id: id } });
    assert.equal(read.topic.state, 'active'); assert.deepEqual(read.topic.asks, []);
    const manual = await control({ method: 'agent_view', actor: facts.actor, name: 'topic', args: { topic_id: 't1' } });
    assert.equal(manual.topic.state, 'waiting'); assert.equal(manual.topic.state_note, 'Which manual date?');
    assert.deepEqual(errors, []);
    results.push({ width, colorScheme, question, rowPointer: true, headerKeyboard: true, actualWithdrawal: true, activeAfter: true, errors });
    await page.screenshot({ path: `${evidence}/${key}.png`, fullPage: true });
    await context.close();
  }
} catch (error) { failure = error; }
finally {
  try { if (browser) { await browser.close(); cleanup.disconnected = !browser.isConnected(); } }
  catch (error) { cleanup.browserError = error.message; failure ??= error; }
  child.stdin.end(); cleanup.fixtureExit = await exit;
  cleanup.fixturePid = child.pid;
  const processes = execFileSync('/bin/ps', ['-axo', 'pid=,command='], { encoding: 'utf8' });
  cleanup.profileIdentified = Boolean(profile);
  cleanup.ownedProfileProcesses = profile ? processes.split('\n').filter(line => line.includes(profile)) : null;
  cleanup.fixtureAbsent = !processes.split('\n').some(line => Number(line.trim().split(/\s/)[0]) === child.pid);
  if (origin) cleanup.portClosed = await new Promise(resolve => {
    const url = new URL(origin), socket = net.createConnection({ host: url.hostname, port: Number(url.port) });
    socket.once('connect', () => { socket.destroy(); resolve(false); }); socket.once('error', () => resolve(true));
  });
  await writeFile(`${evidence}/results.json`, JSON.stringify({ results, cleanup, failure: failure?.stack ?? null }, null, 2));
}
assert.equal(cleanup.fixtureExit.code, 0); assert.equal(cleanup.disconnected, true);
assert.equal(cleanup.profileIdentified, true);
assert.deepEqual(cleanup.ownedProfileProcesses, []); assert.equal(cleanup.fixtureAbsent, true); assert.equal(cleanup.portClosed, true);
if (failure) throw failure;
console.log(JSON.stringify({ passed: results.length, cleanup }));

// One isolated headless Chromium cell. Not entered by preparing this source.
import assert from 'node:assert/strict';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import net from 'node:net';
import { fixtureControl } from './fixture_control.mjs';

const [evidence, playwrightPath, chromePath] = process.argv.slice(2);
assert.ok(evidence && playwrightPath && chromePath && process.argv.length === 5);
await mkdir(evidence, { recursive: false });
const run = promisify(execFile), results = [], cleanup = {};
let fixture, channel, browser, context, page, profile, origin, failure, active = true, serial = 0;
const bounded = (promise, ms, label) => {
  let timer;
  return Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(Error(label + ' timed out')), ms); })])
    .finally(() => clearTimeout(timer));
};
const work = async () => {
  const { chromium } = await import(pathToFileURL(playwrightPath).href);
  fixture = spawn('/usr/bin/python3', ['tests/fixtures/ui_http.py', '--freshness'], { stdio: ['pipe', 'pipe', 'pipe'] });
  channel = fixtureControl(fixture);
  const control = async data => {
    assert.equal(active, true, 'the cell has not been cancelled');
    const result = await bounded(channel.control(data), 10000, 'isolated fixture control');
    assert.equal(active, true, 'a late control answer cannot start another act');
    return result;
  };
  const facts = await control({ method: 'ready', runtime_evidence: true }); origin = facts.origin;
  assert.equal(new URL(origin).hostname, '127.0.0.1');
  const send = async (body, extra = {}) => {
    const receipt = await control({ method: 'agent_message', whole_topic: true, body,
      operation_id: '1163-message-' + (++serial), ...extra });
    assert.equal(receipt.status, 'committed'); return receipt.result.message_id;
  };
  const root = await send('An isolated orchard plan', { sender: 'person', read: true });
  const oldest = await send('Pear trees go beside the path', { post_args: { reply_to: root } });
  for (let n = 0; n < 35; n++) await send('Later isolated note ' + n, { sender: 'person', read: true });
  const starred = await control({ method: 'stack_act', sender: facts.actor, message_id: root,
    kind: 'message.star', args: { starred: true }, operation_id: '1163-star-root' });
  assert.equal(starred.status, 'committed');
  await control({ method: 'mark', message_ids: [oldest], marked: true, operation_id: '1163-mark-oldest' });
  const projection = await control({ method: 'agent_view', actor: facts.actor, name: 'stars', args: { topic_id: 't1' } });
  const item = projection.items.find(s => s.dossier.id === root).dossier;
  assert.equal(item.unread, 1); assert.equal(item.oldest_unread.id, oldest);
  browser = await chromium.launch({ executablePath: chromePath, headless: true, timeout: 10000, args: ['--enable-automation'] });
  assert.equal(active, true);
  const cdp = await browser.newBrowserCDPSession();
  profile = (await cdp.send('Browser.getBrowserCommandLine')).arguments.find(a => a.startsWith('--user-data-dir='))?.slice(16);
  assert.ok(profile);
  context = await browser.newContext({ viewport: { width: 1280, height: 900 }, colorScheme: 'light' });
  page = await context.newPage(); page.setDefaultTimeout(8000); page.setDefaultNavigationTimeout(10000);
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.goto(origin + '/?topic=t1');
  const selector = `#outline .ol-dossier[data-dossier-id="${root}"]`, link = page.locator(selector);
  await link.waitFor();
  const badge = link.locator('.unread-count'); await badge.waitFor();
  assert.equal(await badge.textContent(), '1');
  assert.equal(await badge.getAttribute('tabindex'), null);
  assert.match(await link.getAttribute('aria-label'), /1 unread/);
  const landed = async label => {
    const card = page.locator(`.message-card[data-id="${oldest}"]`);
    await card.waitFor({ state: 'visible' });
    const box = await card.boundingBox();
    assert.ok(box && box.y < 900 && box.y + box.height > 0, 'the actual oldest message is on screen');
    assert.equal(await page.locator('#reader').isVisible(), false, 'landing opens no Reader');
    const position = await control({ method: 'agent_view', actor: facts.actor, name: 'stack_positions',
      args: { topic_id: 't1', message_ids: [oldest] } });
    assert.equal(position.items[0].stack_position.root_id, root);
    results.push({ name: label, root, oldest, box, reader: false, position });
    await page.screenshot({ path: evidence + '/' + label + '.png', fullPage: true });
  };
  await badge.click(); await landed('pointer-count');
  await link.focus(); await page.keyboard.press('Enter'); await landed('keyboard-return');
  await control({ method: 'mark', message_ids: [oldest], marked: false, operation_id: '1163-clear-oldest' });
  await page.waitForFunction(s => { const link = document.querySelector(s); return link && !link.querySelector('.unread-count'); }, selector);
  assert.deepEqual(errors, []);
  results.push({ name: 'live-zero-after-clear', root, oldest, errors });
};
let interrupt;
const stopped = new Promise((_, reject) => { interrupt = () => reject(Error('owned harness received SIGTERM')); });
process.once('SIGTERM', interrupt);
const task = work();
try { await bounded(Promise.race([task, stopped]), 180000, 'one Chromium cell'); }
catch (error) {
  active = false; failure = error;
  try { await bounded(task.catch(() => {}), 15000, 'cancelled cell terminal'); }
  catch (terminalError) { cleanup.taskTerminalError = terminalError.message; }
  if (page && !page.isClosed()) {
    try { await bounded(page.screenshot({ path: evidence + '/failure.png', fullPage: true }), 5000, 'failure screenshot'); }
    catch (captureError) { cleanup.captureError = captureError.message; }
  }
} finally {
  if (browser) {
    try { await bounded(browser.close(), 15000, 'Browser.close'); cleanup.disconnected = !browser.isConnected(); }
    catch (error) { cleanup.browserError = error.message; failure ??= error; }
  }
  if (fixture) {
    fixture.stdin.end();
    try { cleanup.fixtureExit = await bounded(channel.exit, 10000, 'owned fixture exit'); }
    catch (error) { cleanup.fixtureError = error.message; failure ??= error; }
    cleanup.fixturePid = fixture.pid; cleanup.fixtureErrors = channel.errors();
  }
  try {
    const snap = await run('/bin/ps', ['-ww', '-axo', 'pid=,ppid=,pgid=,etime=,command='], { encoding: 'buffer', timeout: 5000, maxBuffer: 8388608 });
    await writeFile(evidence + '/cleanup-ps-stdout.bin', snap.stdout);
    await writeFile(evidence + '/cleanup-ps-stderr.bin', snap.stderr);
    assert.equal(snap.stderr.length, 0);
    const text = new TextDecoder('utf-8', { fatal: true }).decode(snap.stdout), rows = text.trimEnd().split('\n');
    assert.ok(rows.length);
    for (const row of rows) assert.match(row, /^\s*\d+\s+\d+\s+\d+\s+\S+\s+\S.*$/);
    cleanup.profile = profile ?? null;
    cleanup.ownedProfileRows = profile ? rows.filter(row => row.includes(profile)) : null;
    cleanup.fixtureAbsent = !fixture || !rows.some(row => Number(row.trim().split(/\s+/)[0]) === fixture.pid);
  } catch (error) { cleanup.processObservationError = error.message; failure ??= error; }
  if (origin) cleanup.portClosed = await bounded(new Promise(resolve => {
    const u = new URL(origin), socket = net.createConnection({ host: u.hostname, port: Number(u.port) });
    socket.once('connect', () => { socket.destroy(); resolve(false); }); socket.once('error', () => resolve(true));
  }), 5000, 'owned port closure').catch(error => { cleanup.portError = error.message; return false; });
  process.removeListener('SIGTERM', interrupt);
  await writeFile(evidence + '/result.json', JSON.stringify({ name: '1163 Chromium 1280 light', results, cleanup, failure: failure?.stack ?? null }, null, 2));
}
if (failure) throw failure;
assert.equal(results.length, 3); assert.equal(cleanup.disconnected, true);
assert.equal(cleanup.fixtureExit.code, 0); assert.equal(cleanup.fixtureAbsent, true);
assert.deepEqual(cleanup.ownedProfileRows, []); assert.equal(cleanup.portClosed, true);
console.log(JSON.stringify({ passed: 1, observations: results.length, cleanup }));

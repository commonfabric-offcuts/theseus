// Quoted inline send through real HTTP/Core and native input on an isolated origin.
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import net from 'node:net';
import { fixtureControl } from './fixture_control.mjs';
const { chromium } = await import(process.env.AIM_PLAYWRIGHT_CORE);
const evidence = process.argv[2]; await mkdir(evidence, { recursive: true });
const child = spawn('/usr/bin/python3', ['tests/fixtures/ui_http.py', '--freshness']);
const { control, exit, errors: fixtureErrors } = fixtureControl(child);
// Default exercises the regression; explicit control returns to the inline field first.
const readerSend = !process.argv.includes('--inline-control');
const results = [], cleanup = {};
let browser, profile, origin, failure, activePage, releaseSend;
try {
  const facts = await control({ method: 'ready' }); origin = facts.origin;
  browser = await chromium.launch({ executablePath: process.env.AIM_CHROME, headless: true, args: ['--enable-automation'] });
  const cdp = await browser.newBrowserCDPSession();
  profile = (await cdp.send('Browser.getBrowserCommandLine')).arguments.find(arg => arg.startsWith('--user-data-dir='))?.split('=').slice(1).join('=');
  assert.ok(profile);
  for (const width of [1280, 390]) for (const colorScheme of ['light', 'dark']) {
    const key = `${width}-${colorScheme}`;
    const parent = await control({ method: 'agent_message', sender: facts.agent, whole_topic: true, post_args: { divergence_reason: 'Isolated quoted inline Send case' }, body: `A passage to quote ${key}.`, operation_id: `941-parent-${key}` });
    const id = parent.result.message_id;
    const context = await browser.newContext({ viewport: { width, height: 900 }, colorScheme, hasTouch: width === 390 });
    const page = await context.newPage(); activePage = page; page.setDefaultTimeout(10000);
    const errors = []; page.on('pageerror', e => errors.push(e.message));
    await page.goto(origin + '/?topic=t1');
    const card = page.locator(`.message-card[data-id="${id}"]`), words = card.locator(':scope > .message-preview');
    await words.click();
    const root = page.locator(`[id="reply-${id}-composer"]`), field = root.locator('textarea');
    await field.waitFor(); await words.click(); await page.locator('#reader[open]').waitFor();
    await page.locator('#source-body [data-start="0"]').hover(); await page.keyboard.press('Enter');
    const readerField = page.locator('#writing-body');
    assert.match(await readerField.inputValue(), /^> A passage to quote/);
    await readerField.fill('done');
    if (!readerSend) {
      await page.locator('#reader-close').click(); await field.waitFor();
      assert.equal(await field.inputValue(), 'done');
    }
    const receipt = page.waitForResponse(r => { try { return r.request().postDataJSON()?.kind === 'message.send'; } catch { return false; } });
    await page.locator(readerSend ? '#send-reply' : `[id="reply-${id}-send"]`).click();
    const sent = await (await receipt).json(); assert.equal(sent.status, 'committed');
    const sentId = sent.result.message_id, sentCard = page.locator(`.message-card[data-id="${sentId}"]`);
    await sentCard.waitFor(); await page.waitForTimeout(300);
    const source = await control({ method: 'agent_view', actor: facts.actor, name: 'source', args: { source_ref: { kind: 'message', id: sentId } } });
    assert.equal(source.body, 'done'); assert.ok(source.quotes.length, 'sent reply retains actual selected quote');
    const state = { width, colorScheme, readerSend, sentId, quote: source.quotes, fieldClosed: !await root.isVisible(),
      focused: await sentCard.evaluate(el => document.activeElement === el),
      lit: await sentCard.evaluate(el => el.matches('.lit') || Boolean(el.closest('.lit'))), errors };
    results.push(state); await page.screenshot({ path: `${evidence}/${key}-sent.png`, fullPage: true });
    assert.equal(state.fieldClosed, true, 'confirmed quoted send closes the empty inline field');
    assert.equal(state.focused, true); assert.equal(state.lit, true); assert.deepEqual(errors, []);
    if (readerSend && width === 1280 && colorScheme === 'light') {
      if (!await words.isVisible()) await card.locator(':scope > .message-folded').click();
      await words.click(); await field.waitFor(); await words.click(); await page.locator('#reader[open]').waitFor();
      await readerField.fill('Earlier reply awaiting confirmation');
      let sawSend; const seen = new Promise(resolve => { sawSend = resolve; });
      const held = new Promise(resolve => { releaseSend = resolve; });
      await page.route('**/api/command', async route => {
        if (route.request().postDataJSON()?.kind !== 'message.send') return route.continue();
        const response = await route.fetch(); sawSend(); await held; await route.fulfill({ response });
      });
      const laterReceipt = page.waitForResponse(r => { try { return r.request().postDataJSON()?.kind === 'message.send'; } catch { return false; } });
      await page.locator('#send-reply').click(); await seen;
      assert.equal(await page.locator('#reader').isVisible(), true, 'pending publication retains the Reader');
      await readerField.fill('Keep this newer Reader writing');
      releaseSend(); assert.equal((await (await laterReceipt).json()).status, 'committed');
      await page.waitForTimeout(300);
      assert.equal(await readerField.isVisible(), true); assert.equal(await readerField.inputValue(), 'Keep this newer Reader writing');
      assert.equal(await readerField.evaluate(el => document.activeElement === el), true);
      await page.unroute('**/api/command');
      state.pendingReaderKept = true; state.lateConfirmationKeepsNewWriting = true;
      await page.locator('#reader-close').click(); await field.waitFor();
      assert.equal(await field.inputValue(), 'Keep this newer Reader writing');
    }
    await context.close();
  }
} catch (error) {
  failure = error;
  if (activePage && !activePage.isClosed()) {
    await activePage.screenshot({ path: `${evidence}/failure.png`, fullPage: true });
    await writeFile(`${evidence}/failure.html`, await activePage.content());
  }
}
finally {
  releaseSend?.();
  try { if (browser) { await browser.close(); cleanup.disconnected = !browser.isConnected(); } }
  catch (error) { cleanup.browserError = error.message; failure ??= error; }
  child.stdin.end(); cleanup.fixtureExit = await exit;
  cleanup.fixtureErrors = fixtureErrors();
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

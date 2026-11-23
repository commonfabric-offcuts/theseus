// Real HTTP/Core, isolated records and native wide Reader gestures. No live account.
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { mkdir, writeFile, readFile, access } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import os from 'node:os';
import net from 'node:net';
import { fixtureControl } from './fixture_control.mjs';
const evidence = process.argv[2]; assert.ok(evidence); await mkdir(evidence, { recursive: true });
const { chromium } = await import(process.env.AIM_PLAYWRIGHT_CORE);
const hash = b => createHash('sha256').update(b).digest('hex');
const report = { results: [], gates: [], events: [], served: {}, cleanup: {}, errors: [] };
const event = (name, facts = {}) => report.events.push({ name, utc: new Date().toISOString(), ...facts });
const gate = name => { const raw = { name, utc: new Date().toISOString(), load: os.loadavg(), cpus: os.cpus().length }; report.gates.push(raw); assert.ok(raw.cpus === 18 && raw.load[0] < 12, `RESOURCE HOLD ${JSON.stringify(raw)}`); };
const processes = () => execFileSync('/bin/ps', ['-axo', 'pid=,lstart=,stat=,command='], { encoding: 'utf8' }).split('\n');
const present = async p => { try { await access(p); return true; } catch (e) { if (e.code === 'ENOENT') return false; throw e; } };
async function refused(origin) {
  return new Promise(resolve => {
    const u = new URL(origin), socket = net.createConnection({ host: u.hostname, port: Number(u.port) });
    let done = false; const finish = result => { if (done) return; done = true; socket.destroy(); resolve({ origin, utc: new Date().toISOString(), ...result }); };
    socket.setTimeout(2500); socket.once('connect', () => finish({ code: 'CONNECTED' }));
    socket.once('timeout', () => finish({ code: 'TIMEOUT' })); socket.once('error', e => finish({ code: e.code, message: e.message }));
  });
}
let fixture, control, fixtureExit, stdioClose, fixtureErrors, browser, profile, origin, page, failure, releaseSend;
const bodyCaptures = [];
try {
  gate('immediately-before-fixture'); event('fixture-spawn');
  fixture = spawn('/usr/bin/python3', ['tests/fixtures/ui_http.py', '--freshness', '--teardown-observations', `${evidence}/teardown.jsonl`], { env: { ...process.env, PYTHONPYCACHEPREFIX: `${evidence}/pycache` } });
  stdioClose = new Promise(resolve => fixture.once('close', (code, signal) => resolve({ code, signal, utc: new Date().toISOString() })));
  ({ control, exit: fixtureExit, errors: fixtureErrors } = fixtureControl(fixture));
  report.fixturePid = fixture.pid; report.fixtureStart = processes().filter(l => Number(l.trim().split(/\s+/)[0]) === fixture.pid);
  const facts = await control({ method: 'ready' }); origin = facts.origin; report.origin = origin;
  gate('immediately-before-browser'); event('browser-launch');
  browser = await chromium.launch({ executablePath: process.env.AIM_CHROME, headless: true, args: ['--enable-automation'] });
  report.browserVersion = browser.version();
  const cdp = await browser.newBrowserCDPSession();
  profile = (await cdp.send('Browser.getBrowserCommandLine')).arguments.find(x => x.startsWith('--user-data-dir='))?.slice('--user-data-dir='.length); assert.ok(profile); report.profile = profile;
  report.ownedBrowserStart = processes().filter(l => l.includes(profile));
  for (const [index, scheme] of ['dark', 'light'].entries()) {
    const key = `${index}-${scheme}`, ids = [];
    const parent = await control({ method: 'agent_message', sender: facts.agent, whole_topic: true, post_args: { divergence_reason: 'Isolated1122 native folded dossier' }, body: `Isolated1122 ${key} root passage.`, operation_id: `1122-root-${key}` });
    ids.push(parent.result.message_id);
    for (let n = 0; n < 4; n++) {
      const reply = await control({ method: 'agent_message', sender: facts.agent, reply_to: ids[0], reply_without_quote: 'Isolated1122 seeded folded reply', body: `Isolated1122 ${key} reply ${n}.`, operation_id: `1122-seed-${key}-${n}` }); ids.push(reply.result.message_id);
    }
    const context = await browser.newContext({ viewport: { width: 1280, height: 960 }, colorScheme: scheme });
    page = await context.newPage(); page.setDefaultTimeout(12000);
    page.on('pageerror', e => report.errors.push(e.stack || e.message));
    page.on('response', r => {
      const pathname = new URL(r.url()).pathname;
      if (!/\/(card-replies|inline-composer|reply-stacks|reader|app|app-session)\.mjs$/.test(pathname)) return;
      bodyCaptures.push(r.body().then(async b => { const name = pathname.split('/').pop(); report.served[name] = { bytes: b.length, sha256: hash(b) }; await writeFile(`${evidence}/served-${name}`, b); }));
    });
    await page.goto(origin + '/?topic=t1');
    const card = id => page.locator(`.message-card[data-id="${id}"]`);
    for (const id of ids) await card(id).waitFor();
    // Fold four real dossier messages with the message bar's native controls.
    for (const id of ids.slice(1)) { await card(id).hover(); await page.locator('.message-bar [data-act="fold"]').click(); }
    const sourceId = index === 0 ? ids[2] : ids[0], sourceCard = card(sourceId);
    if (index === 0) await sourceCard.locator(':scope > .message-folded').click();
    const foldedBefore = await page.locator(`[data-stack="${ids[0]}"] .message-card[data-folded="true"]`).count();
    // Native Return on a lit feed passage opens Reader without first opening an inline field.
    await sourceCard.locator(':scope > .message-preview .md-p').last().hover({ position: { x: 20, y: 10 } }); await page.keyboard.press('Enter');
    await page.locator('#reader[open]').waitFor(); assert.equal(await page.locator('#reader').getAttribute('data-layout'), 'wide');
    await page.locator('#source-body [data-start="0"]').hover(); await page.keyboard.press('Enter');
    const field = page.locator('#writing-body'), sentBody = `1122 confirmed native ${key}`;
    await field.fill(sentBody);
    const inlineId = `reply-${sourceId}-composer`, inline = page.locator(`[id="${inlineId}"]`);
    await inline.waitFor({ state: 'attached' });
    const passiveBeforeSend = { exists: await inline.count(), hidden: !await inline.isVisible(), body: await inline.locator('textarea').inputValue() };
    const receipt = page.waitForResponse(r => { try { return r.request().postDataJSON()?.kind === 'message.send'; } catch { return false; } });
    await page.locator('#send-reply').click(); const sent = await (await receipt).json(); assert.equal(sent.status, 'committed');
    const sentId = sent.result.message_id; await card(sentId).waitFor();
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const source = await control({ method: 'agent_view', actor: facts.actor, name: 'source', args: { source_ref: { kind: 'message', id: sentId } } });
    const state = { key, sourceId, sentId, seeded: ids, foldedBefore, passiveBeforeSend,
      readerClosed: !await page.locator('#reader').isVisible(), composerClosed: !await inline.isVisible(), cardReply: await sourceCard.getAttribute('data-card-reply'),
      order: await card(sentId).evaluate(el => [...el.closest('.reply-stack').querySelectorAll('.message-card[data-id]')].map(e => e.dataset.id)), body: source.body, quotes: source.quotes?.length,
      geometry: await card(sentId).evaluate(el => { const a = el.getBoundingClientRect(); const p = el.closest('.reply-stack').getBoundingClientRect(); return { sentTop: a.top, sentBottom: a.bottom, stackBottom: p.bottom }; }) };
    report.results.push(state); await page.screenshot({ path: `${evidence}/${key}-sent.png`, fullPage: true });
    assert.equal(state.body, sentBody); assert.ok(state.quotes > 0); assert.ok(state.foldedBefore >= 3, 'several real messages remain folded');
    assert.equal(state.composerClosed, true, 'confirmed direct Reader send folds its passive empty inline composer');
    assert.equal(state.cardReply, null); assert.equal(state.readerClosed, true); assert.equal(state.order.at(-1), sentId, 'confirmed message is the dossier foot');
    if (index === 0) {
      // Inline-origin Reader owns later writing while a real committed receipt is held.
      const words = sourceCard.locator(':scope > .message-preview');
      if (!await words.isVisible()) await sourceCard.locator(':scope > .message-folded').click();
      await words.click(); await inline.waitFor(); await words.click(); await page.locator('#reader[open]').waitFor();
      await field.fill('1122 prior reply awaiting confirmation');
      let sawSend; const seen = new Promise(resolve => { sawSend = resolve; }); const held = new Promise(resolve => { releaseSend = resolve; });
      await page.route('**/api/command', async route => {
        if (route.request().postDataJSON()?.kind !== 'message.send') return route.continue();
        const response = await route.fetch(); sawSend(); await held; await route.fulfill({ response });
      });
      const laterReceipt = page.waitForResponse(r => { try { return r.request().postDataJSON()?.kind === 'message.send'; } catch { return false; } });
      await page.locator('#send-reply').click(); await Promise.race([seen, new Promise((_, reject) => { const timer = setTimeout(() => reject(Error('Held publication not reached')), 12000); timer.unref(); })]);
      assert.equal(await page.locator('#reader').isVisible(), true);
      const later = '1122 preserve newer native Reader writing'; await field.fill(later); releaseSend();
      assert.equal((await (await laterReceipt).json()).status, 'committed');
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      assert.equal(await field.isVisible(), true); assert.equal(await field.inputValue(), later);
      await page.unroute('**/api/command'); await page.locator('#reader-close').click(); await inline.waitFor();
      assert.equal(await inline.locator('textarea').inputValue(), later); state.pendingConfirmationKeepsLaterWriting = true;
    }
    await context.close(); page = null;
  }
  assert.deepEqual(report.errors, []); event('body-completed'); report.bodyCompleted = true;
} catch (e) {
  failure = e; report.failure = e.stack;
  if (page && !page.isClosed()) {
    try { await page.screenshot({ path: `${evidence}/failure.png`, fullPage: true }); await writeFile(`${evidence}/failure.html`, await page.content()); } catch (e) { report.captureFailure = e.stack; }
  }
} finally {
  releaseSend?.();
  if (browser) {
    try { event('Browser.close-start'); await browser.close(); report.cleanup.browserClosed = true; report.cleanup.disconnected = !browser.isConnected(); event('Browser.close-returned'); }
    catch (e) { report.cleanup.browserError = e.stack; failure ??= e; }
  }
  if (fixture) {
    event('fixture-stdin-EOF'); fixture.stdin.end(); report.cleanup.fixtureExit = await fixtureExit; report.cleanup.stdioClose = await stdioClose; report.cleanup.fixtureStderr = fixtureErrors();
    try { const bytes = await readFile(`${evidence}/teardown.jsonl`); report.cleanup.teardown = { bytes: bytes.length, sha256: hash(bytes), records: bytes.toString().trim().split('\n').map(JSON.parse) }; } catch (e) { report.cleanup.teardownError = e.stack; failure ??= e; }
  }
  await Promise.allSettled(bodyCaptures);
  report.cleanup.processesUtc = new Date().toISOString(); const ps = processes();
  report.cleanup.fixtureTuples = fixture ? ps.filter(l => Number(l.trim().split(/\s+/)[0]) === fixture.pid) : [];
  report.cleanup.profileTuples = profile ? ps.filter(l => l.includes(profile)) : [];
  report.cleanup.profileAbsent = profile ? !await present(profile) : null;
  if (origin) report.cleanup.tcp = await refused(origin);
  try {
    if (fixture) { assert.deepEqual(report.cleanup.fixtureExit, { code: 0, signal: null }); assert.equal(report.cleanup.stdioClose.code, 0); assert.equal(report.cleanup.fixtureStderr, ''); const last = report.cleanup.teardown.records.at(-1); assert.equal(last.event, 'cleanup-complete'); assert.deepEqual(last.errors, []); assert.equal(last.fixtureBodyError, null); assert.equal(report.cleanup.tcp.code, 'ECONNREFUSED'); assert.deepEqual(report.cleanup.fixtureTuples, []); }
    if (browser) { assert.equal(report.cleanup.browserClosed, true); assert.equal(report.cleanup.disconnected, true); assert.deepEqual(report.cleanup.profileTuples, []); assert.equal(report.cleanup.profileAbsent, true); }
    report.cleanup.verified = true;
  } catch (e) { report.cleanup.failure = e.stack; failure ??= e; }
  event('evidence-written'); await writeFile(`${evidence}/results.json`, JSON.stringify(report, null, 2) + '\n');
}
if (failure) throw failure;
console.log(JSON.stringify({ passed: report.results.length, cleanupVerified: report.cleanup.verified }));

// Dossier header star through real HTTP/Core and native input on an isolated origin.
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import net from 'node:net';
import { fixtureControl } from './fixture_control.mjs';
const engines = await import(process.env.AIM_PLAYWRIGHT_CORE);
const engine = process.env.AIM_BROWSER ?? 'chromium';
assert.ok(['chromium', 'webkit'].includes(engine));
const evidence = process.argv[2]; await mkdir(evidence, { recursive: true });
const caseFilter = new RegExp(process.argv[3] ?? '');
const sources = {};
for (const name of ['web/reply-stacks.mjs', 'web/stack-look.css', 'web/stack-feed.mjs', 'tests/dossier_header_star_646_native.mjs']) {
  const bytes = await readFile(name); sources[name] = createHash('sha256').update(bytes).digest('hex');
  await writeFile(`${evidence}/${name.replaceAll('/', '-')}`, bytes);
}
await writeFile(`${evidence}/invocation.json`, JSON.stringify({ engine, argv: process.argv, cwd: process.cwd(), sources,
  head: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim() }, null, 2));
const child = spawn('/usr/bin/python3', ['tests/fixtures/ui_http.py', '--freshness']);
const { control, exit, errors: fixtureErrors } = fixtureControl(child);
const results = [], cleanup = {};
let browser, profile, origin, failure, activePage;
try {
  const facts = await control({ method: 'ready' }); origin = facts.origin;
  browser = await engines[engine].launch(engine === 'chromium'
    ? { executablePath: process.env.AIM_CHROME, headless: true, args: ['--enable-automation'] } : { headless: true });
  if (engine === 'chromium') {
    const cdp = await browser.newBrowserCDPSession();
    profile = (await cdp.send('Browser.getBrowserCommandLine')).arguments.find(arg => arg.startsWith('--user-data-dir='))?.slice(16);
    assert.ok(profile);
  }
  for (const width of [1280, 390]) for (const colorScheme of ['light', 'dark']) {
    const key = `${width}-${colorScheme}`;
    if (!caseFilter.test(key)) continue;
    const root = (await control({ method: 'agent_message', sender: 'person', whole_topic: true, body: `Header star ${key}`, operation_id: `646-root-${key}` })).result.message_id;
    const reply = (await control({ method: 'agent_message', sender: 'person', whole_topic: true, post_args: { reply_to: root }, body: `Reply ${key}`, operation_id: `646-reply-${key}`, read: true })).result.message_id;
    await control({ method: 'stack_act', sender: facts.actor, message_id: reply, kind: 'message.star', args: { starred: true }, operation_id: `646-reply-star-${key}` });
    const context = await browser.newContext({ viewport: { width, height: 900 }, colorScheme, hasTouch: width === 390 });
    const page = await context.newPage(); activePage = page; page.setDefaultTimeout(7000);
    const errors = []; page.on('pageerror', e => errors.push(e.message));
    await page.goto(origin + '/?topic=t1');
    const actual = page.locator(`.message-card[data-id="${root}"] .stack-head`);
    await actual.waitFor();
    const section = page.locator('.reply-stack').filter({ has: actual });
    const star = actual.locator(':scope > .stack-star[role="button"]');
    assert.equal(await star.count(), 1, '646: real dossier header has one always-visible star toggle');
    assert.equal(await star.getAttribute('aria-pressed'), 'false', 'a starred reply does not fill the first-message toggle');
    await star.scrollIntoViewIfNeeded();
    const header = async () => ({ url: page.url(), name: await actual.locator('.stack-name').textContent(),
      who: await actual.locator('.stack-who').textContent(), count: await actual.locator('.stack-count').textContent(),
      level: await section.locator(':scope > .stack-toggle').getAttribute('data-state'),
      reader: await page.locator('#reader').isVisible(), rename: await section.getAttribute('data-renaming'),
      titleBox: await actual.locator('.stack-name').boundingBox() });
    const before = await header();
    const look = await star.evaluate(el => { const s = getComputedStyle(el), b = el.getBoundingClientRect(), t = el.parentElement.querySelector('.stack-name').getBoundingClientRect();
      return { visible: s.visibility, background: s.backgroundColor, width: b.width, height: b.height, top: b.top, titleBottom: t.bottom }; });
    assert.equal(look.visible, 'visible'); assert.equal(look.background, 'rgba(0, 0, 0, 0)');
    assert.ok(look.top >= look.titleBottom - 1, 'star stays on second line');
    assert.ok(look.height < 32, 'approved natural box, not a padded44px control');
    const paint = async () => star.evaluate(el => {
      const card = el.closest('.message-card'), cardStar = card.querySelector('.card-star');
      return { text: el.textContent, color: getComputedStyle(el).color,
        quiet: getComputedStyle(el.parentElement.querySelector('.stack-who')).color,
        cardColor: getComputedStyle(cardStar).color, cardText: cardStar.textContent };
    });
    const hollow = await paint();
    await writeFile(`${evidence}/${key}-hollow.json`, JSON.stringify(hollow, null, 2));
    const commands = [];
    const toggle = async (expected, point = null) => {
      const response = page.waitForResponse(r => { try { return r.request().postDataJSON()?.kind === 'message.star'; } catch { return false; } });
      if (point) {
        if (width === 390) await page.touchscreen.tap(point.x, point.y); else await page.mouse.click(point.x, point.y);
      } else if (width === 390) await star.tap(); else await star.click();
      const http = await response, envelope = http.request().postDataJSON(), receipt = await http.json();
      assert.equal(envelope.target.message_id, root); assert.equal(envelope.args.starred, expected); assert.equal(receipt.status, 'committed');
      await page.waitForFunction(({ root, expected }) => document.querySelector(`.message-card[data-id="${root}"] .stack-star`)?.getAttribute('aria-pressed') === String(expected), { root, expected });
      const stored = await control({ method: 'agent_view', actor: facts.actor, name: 'topic_messages', args: { topic_id: 't1', message_ids: [root, reply] } });
      assert.equal(stored.items.find(i => i.id === root).acts.starred, expected);
      assert.equal(stored.items.find(i => i.id === reply).acts.starred, true);
      commands.push({ target: envelope.target.message_id, starred: expected, revision: receipt.result.star_revision,
        storedFirst: stored.items.find(i => i.id === root).acts.starred, storedReply: stored.items.find(i => i.id === reply).acts.starred });
    };
    //951: begin with a filled star reached by a native keyboard press, then
    // unstar it by pointer/touch. WebKit must deliver that tap's click too.
    await star.focus();
    const firstResponse = page.waitForResponse(r => { try { return r.request().postDataJSON()?.kind === 'message.star'; } catch { return false; } });
    await page.keyboard.press('Space');
    assert.equal((await (await firstResponse).json()).status, 'committed');
    await page.waitForFunction(root => document.querySelector(`.message-card[data-id="${root}"] .stack-star`)?.getAttribute('aria-pressed') === 'true', root);
    await toggle(false);
    const box = await star.boundingBox(), point = { x: box.x + box.width - 4, y: box.y + box.height / 2 };
    await toggle(true, point); assert.deepEqual(await header(), before, 'toggling leaves other header state/layout and navigation alone');
    const filled = await paint();
    await writeFile(`${evidence}/${key}-filled.json`, JSON.stringify(filled, null, 2));
    await toggle(false, point); //951: same point and visit, no reload between presses.
    const emptied = await paint();
    await toggle(true);
    await page.reload(); await actual.waitFor();
    assert.equal(await star.getAttribute('aria-pressed'), 'true', 'already-starred first message starts filled');
    await toggle(false);
    await star.focus();
    assert.equal(await star.evaluate(el => document.activeElement === el), true, 'star receives keyboard focus');
    const response = page.waitForResponse(r => { try { return r.request().postDataJSON()?.kind === 'message.star'; } catch { return false; } });
    await page.keyboard.press('Space'); assert.equal((await (await response).json()).status, 'committed');
    await page.waitForFunction(root => document.querySelector(`.message-card[data-id="${root}"] .stack-star`)?.getAttribute('aria-pressed') === 'true', root);
    assert.equal(await star.evaluate(el => document.activeElement === el), true, 'keyboard focus survives repaint');
    // Latest-and-unread (the current ordinary dossier's closed state) stays closed.
    const chevron = section.locator(':scope > .stack-toggle');
    for (let n = 0; n < 3 && await chevron.getAttribute('data-state') !== 'folded'; n++) await chevron.click();
    assert.equal(await chevron.getAttribute('data-state'), 'folded');
    await toggle(false); assert.equal(await chevron.getAttribute('data-state'), 'folded');
    // Writing in the card keeps its cursor and exact text while its header stars.
    await chevron.click();
    const card = page.locator(`.message-card[data-id="${root}"]`), words = card.locator(':scope > .message-preview');
    // The floating toolbar can cover the centre of a short folded row.
    // Open its exposed left edge with native input, without forcing a hit.
    if (!await words.isVisible()) {
      const folded = card.locator(':scope > .message-folded'), options = { position: { x: 8, y: 8 } };
      if (width === 390) await folded.tap(options); else await folded.click(options);
    }
    await words.click({ position: { x: 20, y: 12 } });
    const field = page.locator(`[id="reply-${root}-composer"] textarea`);
    await field.fill('Keep this exact unfinished reply'); await toggle(true);
    assert.equal(await field.inputValue(), 'Keep this exact unfinished reply');
    assert.equal(await field.evaluate(el => document.activeElement === el), true);
    assert.deepEqual(errors, []);
    results.push({ width, colorScheme, root, reply, look, hollow, filled, emptied, commands, consecutivePresses: true, starAndUnstar: true, storedTarget: root, headerUnchanged: true, keyboard: true, closedHeader: true, writingFocus: true });
    await page.screenshot({ path: `${evidence}/${key}.png`, fullPage: true });
    await context.close();
  }
  assert.ok(results.length, 'the filter selects at least one native case');
  for (const { hollow, filled, emptied } of results) {
    assert.equal(hollow.color, hollow.quiet, '951: hollow header star uses the row quiet colour');
    assert.equal(hollow.color, hollow.cardColor, '951: hollow header and card stars match');
    assert.equal(filled.color, filled.cardColor, '951: filled header and card stars match');
    assert.equal(hollow.text, '\u2606\uFE0E', '951: hollow header explicitly uses text presentation');
    assert.equal(filled.text, '\u2605\uFE0E', '951: filled header explicitly uses text presentation');
    assert.equal(emptied.color, hollow.color, '951: second press restores quiet colour');
    assert.equal(hollow.cardText, '☆', '951: original hollow card glyph stays unchanged');
    assert.equal(filled.cardText, '★', '951: original filled card glyph stays unchanged');
    assert.equal(emptied.cardText, hollow.cardText, '951: card star glyph is unchanged after consecutive header presses');
  }
} catch (error) {
  failure = error;
  if (activePage && !activePage.isClosed()) {
    await activePage.screenshot({ path: `${evidence}/failure.png`, fullPage: true });
    await writeFile(`${evidence}/failure.html`, await activePage.content());
  }
}
finally {
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
  await writeFile(`${evidence}/results.json`, JSON.stringify({ engine, origin, results, cleanup, failure: failure?.stack ?? null }, null, 2));
}
assert.equal(cleanup.fixtureExit.code, 0); assert.equal(cleanup.disconnected, true);
if (engine === 'chromium') { assert.equal(cleanup.profileIdentified, true); assert.deepEqual(cleanup.ownedProfileProcesses, []); }
assert.equal(cleanup.fixtureAbsent, true); assert.equal(cleanup.portClosed, true);
if (failure) throw failure;

console.log(JSON.stringify({ passed: results.length, cleanup }));

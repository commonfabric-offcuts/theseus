// Actual card passage/Reader return/inline Send on a scratch HTTP/Core origin.
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import net from 'node:net';
import { fixtureControl } from './fixture_control.mjs';

const playwright = await import(process.env.AIM_PLAYWRIGHT_CORE);
const evidence = process.argv[2], engine = process.argv.includes('--webkit') ? 'webkit' : 'chromium';
const only = process.argv.find(x => x.startsWith('--only='))?.slice(7);
await mkdir(evidence, { recursive: true });
const child = spawn('/usr/bin/python3', ['tests/fixtures/ui_http.py', '--freshness']);
const { control, exit, errors: fixtureErrors } = fixtureControl(child);
const results = [], cleanup = { fixturePid: child.pid }, hashes = {};
for (const file of ['web/inline-composer.mjs','web/card-replies.mjs','web/app-session.mjs','web/editor.mjs','web/session.mjs','web/reader.mjs','web/app.mjs'])
  hashes[file] = createHash('sha256').update(await readFile(file)).digest('hex');
hashes.harness = createHash('sha256').update(await readFile(new URL(import.meta.url))).digest('hex');
let browser, profile, origin, activePage, failure, release;
try {
  const facts = await control({ method: 'ready' }); origin = facts.origin;
  browser = await playwright[engine].launch(engine === 'chromium' ? { executablePath: process.env.AIM_CHROME, headless: true, args: ['--enable-automation'] } : { headless: true });
  if (engine === 'chromium') {
    const cdp = await browser.newBrowserCDPSession();
    profile = (await cdp.send('Browser.getBrowserCommandLine')).arguments.find(x => x.startsWith('--user-data-dir='))?.slice(16);
    cleanup.observedBrowserPids = (await cdp.send('SystemInfo.getProcessInfo')).processInfo.map(x => x.id);
    assert.ok(profile);
  }
  for (const width of [1280, 390]) for (const colorScheme of ['light', 'dark']) {
    for (const gesture of ['ask-unquoted', 'ask-quoted', 'feed-quote', 'feed-reader', 'inline-quote', 'unquoted', 'reader']) {
      if (only && !gesture.startsWith(only)) continue;
      const key = `${gesture}-${width}-${colorScheme}`;
      const result = { key, width, colorScheme, gesture, phases: [] }; results.push(result);
      const parentBody = `A passage for ${key}.`, asking = gesture.startsWith('ask-');
      let parent;
      if (asking) {
        const first = await control({ method: 'agent_message', sender: 'person', whole_topic: true,
          body: `Existing dossier ${key}`, operation_id: `947-root-${key}` });
        assert.equal(first.status, 'committed');
        const rootId = first.result.message_id;
        const cover = await control({ method: 'agent_view', actor: facts.agent, name: 'dossier_cover', args: { message_id: rootId } });
        parent = await control({ method: 'agent_message', sender: facts.agent, join: true, whole_topic: true,
          body: parentBody, operation_id: `947-parent-${key}`, post_args: {
            reply_to: rootId, reply_without_quote: 'The whole synthetic dossier is relevant',
            addressees: [facts.actor], intent: 'ask', go_ahead: false,
            ask_wait: { root_id: cover.root_id, cover_revision: cover.cover_revision,
              questions: [{ actor_id: facts.actor, text: parentBody, options: [], default: null, reason: 'Free response; no choices or default.' }] }
          } });
      } else parent = await control({ method: 'agent_message', sender: facts.agent, whole_topic: true,
        post_args: { divergence_reason: 'Isolated947 native card reply' }, body: parentBody, operation_id: `947-parent-${key}` });
      assert.equal(parent.status, 'committed'); const id = parent.result.message_id;
      const context = await browser.newContext({ viewport: { width, height: 900 }, colorScheme, hasTouch: width === 390 });
      const page = await context.newPage(); activePage = page; page.setDefaultTimeout(8000);
      const errors = []; page.on('pageerror', e => errors.push(e.message));
      await page.goto(origin + '/?topic=t1');
      const card = page.locator(`.message-card[data-id="${id}"]`), words = card.locator(':scope > .message-preview');
      const root = page.locator(`[id="reply-${id}-composer"]`), field = root.locator('textarea');
      if (!gesture.startsWith('feed-')) { await words.click(); await field.waitFor(); }
      if (gesture === 'inline-quote' || gesture === 'reader' || gesture === 'ask-quoted') {
        await words.click(); await page.locator('#reader[open]').waitFor();
        await page.locator('#source-body [data-start]').filter({ hasText: parentBody }).last().hover({ position: { x: 15, y: 10 } }); await page.keyboard.press('Enter');
      } else if (gesture.startsWith('feed-')) {
        await words.locator('.md-p').first().hover({ position: { x: 15, y: 10 } });
        await page.keyboard.press('Enter'); await page.locator('#reader[open]').waitFor();
      }
      const body = asking ? 'mine' : `Exact reply ${key}`, quoted = !['unquoted','ask-unquoted'].includes(gesture);
      if (quoted) {
        const readerField = page.locator('#writing-body');
        assert.match(await readerField.inputValue(), /^> A passage for /);
        // Keep the quoted line, unlike941's original control which replaced it.
        await readerField.press('End'); await page.keyboard.press('Meta+ArrowDown'); await page.keyboard.insertText(body);
        result.quotedWriting = await readerField.inputValue();
        assert.ok(result.quotedWriting.includes(parentBody)); assert.ok(result.quotedWriting.endsWith(body));
        if (!['reader','feed-reader'].includes(gesture)) { await page.locator('#reader-close').click(); await field.waitFor(); }
      } else await field.fill(body);
      const readerSend = ['reader','feed-reader'].includes(gesture);
      const sendingField = readerSend ? page.locator('#writing-body') : field;
      const before = await sendingField.inputValue();
      assert.ok(await sendingField.isVisible(), 'unsent writing stays open'); assert.ok(before.endsWith(body));
      if (asking) {
        const question = await control({ method: 'agent_view', actor: facts.actor, name: 'source', args: { source_ref: { kind: 'message', id } } });
        result.beforeQuestion = question.question;
        assert.equal(question.question.state, 'waiting');
        assert.ok(question.question.waiting_on.includes(facts.actor));
      }
      result.phases.push('unsent exact writing visible');
      const receipt = page.waitForResponse(r => { try { return r.request().postDataJSON()?.kind === 'message.send'; } catch { return false; } });
      if (process.argv.includes('--keyboard')) { await sendingField.focus(); await page.keyboard.press('Meta+Enter'); }
      else await page.locator(readerSend ? '#send-reply' : `[id="reply-${id}-send"]`).click();
      const sent = await (await receipt).json(); assert.equal(sent.status, 'committed');
      result.sentId = sent.result.message_id;
      const sentCard = page.locator(`.message-card[data-id="${result.sentId}"]`); await sentCard.waitFor();
      const source = await control({ method: 'agent_view', actor: facts.actor, name: 'source', args: { source_ref: { kind: 'message', id: result.sentId } } });
      result.core = { body: source.body, quotes: source.quotes, replyTo: source.reply_to };
      assert.ok(source.body.endsWith(body));
      if (quoted) {
        assert.equal(source.quotes[0].excerpt.trim(), parentBody);
        assert.deepEqual(source.quotes[0].source, { id, kind: 'message', revision: 1 });
      }
      else assert.equal(source.quotes.length, 0);
      assert.equal(source.reply_to, id);
      if (asking) {
        const question = await control({ method: 'agent_view', actor: facts.actor, name: 'source', args: { source_ref: { kind: 'message', id } } });
        result.question = question.question;
        assert.equal(question.question.state, 'answered', 'the native reply actually closes its open question');
      }
      result.phases.push('Core published exact reply and quote');
      await page.screenshot({ path: `${evidence}/${key}-published.png`, fullPage: true });
      await root.waitFor({ state: 'hidden' });
      if (readerSend) await page.locator('#reader[open]').waitFor({ state: 'hidden' });
      // A closure repaint can arrive after publication first hid the field.
      // This is a bounded stability observation, not a speed assertion.
      await page.waitForTimeout(1000);
      assert.equal(await root.isVisible(), false, 'confirmed card reply stays closed after the question/dossier repaint');
      result.fieldClosed = true; result.phases.push('confirmed unchanged card field closed');
      assert.deepEqual(errors, []); result.errors = errors; result.passed = true;
      console.log(JSON.stringify({ key, passed: true })); await context.close();
      if (process.argv.includes('--one')) break;
    }
    if (process.argv.includes('--one')) break;
  }
} catch (error) {
  failure = error; if (results.length) { results.at(-1).passed = false; results.at(-1).error = error.stack; }
  if (activePage && !activePage.isClosed()) {
    await activePage.screenshot({ path: `${evidence}/failure.png`, fullPage: true });
    await writeFile(`${evidence}/failure.html`, await activePage.content());
  }
} finally {
  release?.();
  try { if (browser) { await browser.close(); cleanup.browserClosed = !browser.isConnected(); } }
  catch (error) { cleanup.browserError = error.message; failure ??= error; }
  child.stdin.end(); cleanup.fixtureExit = await exit; cleanup.fixtureErrors = fixtureErrors();
  const processes = execFileSync('/bin/ps', ['-axo', 'pid=,command='], { encoding: 'utf8' }).split('\n');
  cleanup.profile = profile;
  cleanup.profileProcesses = profile ? processes.filter(line => line.includes(profile)) : [];
  cleanup.remainingObservedPids = (cleanup.observedBrowserPids ?? []).filter(pid => processes.some(line => Number(line.trim().split(/\s/)[0]) === pid));
  cleanup.fixtureAbsent = !processes.some(line => Number(line.trim().split(/\s/)[0]) === child.pid);
  if (origin) cleanup.portClosed = await new Promise(resolve => {
    const url = new URL(origin), socket = net.createConnection({ host: url.hostname, port: Number(url.port) });
    socket.once('connect', () => { socket.destroy(); resolve(false); }); socket.once('error', () => resolve(true));
  });
  await writeFile(`${evidence}/results.json`, JSON.stringify({ engine, results, hashes, cleanup, failure: failure?.stack ?? null }, null, 2));
}
assert.deepEqual(cleanup.fixtureExit, { code: 0, signal: null }); assert.equal(cleanup.fixtureErrors, '');
assert.equal(cleanup.browserClosed, true); assert.deepEqual(cleanup.profileProcesses, []); assert.deepEqual(cleanup.remainingObservedPids, []);
assert.equal(cleanup.fixtureAbsent, true); assert.equal(cleanup.portClosed, true);
if (failure) throw failure;

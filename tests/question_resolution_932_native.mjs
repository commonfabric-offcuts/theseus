// Actual cover-to-Reader question resolution, supersession and immediate paint.
// Isolated HTTP/Core fixture; native pointer and keyboard, no live records.
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import net from 'node:net';
import { fixtureControl } from './fixture_control.mjs';
const { chromium } = await import(process.env.AIM_PLAYWRIGHT_CORE);
const evidence = process.argv[2]; await mkdir(evidence, { recursive: true });
const answersOnly = process.argv.includes('--answers-only');
const child = spawn('/usr/bin/python3', ['tests/fixtures/ui_http.py', '--freshness', ...(answersOnly ? [] : ['--as-actor', 'fixture-notebook-agent'])]);
const { control, exit, errors: fixtureErrors } = fixtureControl(child);
const results = [], cleanup = {};
const questionFits = async page => {
  await page.locator('.reader-header').evaluate(async node => {
    await Promise.all(node.getAnimations({ subtree: true }).map(animation => animation.finished.catch(() => {})));
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  });
  const geometry = await page.locator('#reader-origin .question-state').evaluate(node => {
    const q = node.getBoundingClientRect(), header = node.closest('.reader-header').getBoundingClientRect();
    const overlaps = [...node.closest('.reader-header').querySelectorAll('button')].filter(other => other !== node && !node.contains(other)).filter(other => {
      const r = other.getBoundingClientRect();
      // DOMRect floats can differ by 0.000002px at a shared transformed edge.
      return r.width && r.height && Math.min(q.right, r.right) - Math.max(q.left, r.left) > .01 &&
        Math.min(q.bottom, r.bottom) - Math.max(q.top, r.top) > .01;
    }).map(other => ({ id: other.id, rect: other.getBoundingClientRect().toJSON() }));
    return { fits: q.left >= header.left && q.right <= header.right + 1 && q.top >= header.top && q.bottom <= header.bottom + 1, overlaps, question: q.toJSON() };
  });
  assert.equal(geometry.fits, true, 'question stays within the Reader header');
  assert.deepEqual(geometry.overlaps, [], 'question never covers navigation controls: ' + JSON.stringify(geometry));
};
let browser, profile, origin, failure, activePage;
try {
  const facts = await control({ method: 'ready' }); origin = facts.origin;
  browser = await chromium.launch({ executablePath: process.env.AIM_CHROME, headless: true, args: ['--enable-automation'] });
  const cdp = await browser.newBrowserCDPSession();
  profile = (await cdp.send('Browser.getBrowserCommandLine')).arguments.find(arg => arg.startsWith('--user-data-dir='))?.split('=').slice(1).join('=');
  assert.ok(profile);
  for (const width of [1280, 390]) for (const colorScheme of ['light', 'dark']) {
    const key = `${width}-${colorScheme}`, words = `New go-ahead question ${key}?`;
    const ask = async (operation, body, parent = null) => {
      const cover = parent ? await control({ method: 'agent_view', actor: facts.agent, name: 'dossier_cover', args: { message_id: parent } }) : null;
      const sent = await control({ method: 'agent_message', sender: facts.agent, join: true, whole_topic: true,
        operation_id: operation, body, post_args: { addressees: [facts.actor], intent: 'ask', go_ahead: true,
          ...(parent ? { reply_to: parent, reply_without_quote: 'This synthetic question concerns the whole dossier' } : { divergence_reason: 'Isolated question resolution case' }),
          ask_wait: { root_id: cover?.root_id ?? null, cover_revision: cover?.cover_revision ?? 0,
            questions: [{ actor_id: facts.actor, text: body, options: ['Yes', 'No'], default: 'No', reason: null }] } } });
      assert.equal(sent.status, 'committed'); return sent.result.message_id;
    };
    let first, question;
    if (!answersOnly) {
      first = await ask(`932-first-${key}`, `Older question ${key}?`);
      question = await ask(`932-second-${key}`, words, first);
      const superseded = await control({ method: 'agent_view', actor: facts.agent, name: 'source', args: { kind: 'message', id: first } });
      assert.equal(superseded.question.state, 'superseded');
    } else {
      const joined = await control({ method: 'agent_message', sender: facts.agent, join: true, whole_topic: true,
        operation_id: `932-answerer-joins-${key}`, body: 'Ready to answer.', post_args: { divergence_reason: 'Isolated answer freshness case' } });
      assert.equal(joined.status, 'committed');
    }
    const context = await browser.newContext({ viewport: { width, height: 900 }, colorScheme, hasTouch: width === 390 });
    const page = await context.newPage(); activePage = page; page.setDefaultTimeout(10000);
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    const personAsk = await control({ method: 'agent_message', sender: 'person', whole_topic: true,
      operation_id: `932-person-ask-${key}`, body: `Person question ${key}?`,
      post_args: { addressees: [facts.agent], intent: 'ask' } });
    assert.equal(personAsk.status, 'committed');
    const personQuestion = personAsk.result.message_id;
    await page.goto(origin + `/?topic=t1&message=${personQuestion}`);
    await page.locator('#reader-origin .question-state').waitFor({ state: 'visible' });
    assert.match(await page.locator('#reader-origin .question-state').innerText(), /Waiting on/);
    const personWords = await page.locator('#source-body').innerText();
    // Let initial Reader/dossier freshness finish before the independent reply.
    // Otherwise an in-flight opening read can mask the missing invalidation.
    await page.waitForTimeout(1000);
    const reply = await control({ method: 'agent_message', sender: facts.agent, whole_topic: true,
      operation_id: `932-answer-${key}`, body: `Answer ${key}.`,
      post_args: { reply_to: personQuestion, reply_without_quote: 'Answering the whole synthetic question' } });
    assert.equal(reply.status, 'committed');
    await page.locator('#reader-origin .question-state').waitFor({ state: 'detached' });
    assert.equal(await page.locator('#reader[open]').count(), 1, 'answer refresh leaves the existing Reader open');
    assert.equal(await page.locator('#source-body').innerText(), personWords, 'answer refresh retains the source words');
    if (answersOnly) {
      assert.deepEqual(errors, []);
      await page.screenshot({ path: `${evidence}/${key}-answered.png` });
      results.push({ width, colorScheme, personQuestion, askerReader: true, answeredPillGoneWithoutReopening: true, wordsKept: true, errors });
      await context.close(); continue;
    }
    await page.goto(origin + '/?topic=t1');
    const waiting = page.locator(`#messages a[href*="${question}"].topic-state`).first();
    await waiting.waitFor({ state: 'visible' });
    await waiting.click();
    await page.locator('#reader[open]').waitFor();
    const displayedWords = await page.locator('#source-body').innerText();
    assert.ok(displayedWords.endsWith(words));
    const resolve = page.locator('#reader-origin button.question-state');
    await resolve.waitFor({ state: 'visible' });
    assert.match(await resolve.innerText(), /Waiting on/);
    await questionFits(page);
    await page.screenshot({ path: `${evidence}/${key}-waiting.png` });
    let releaseReads;
    const readsHeld = new Promise(resolve => { releaseReads = resolve; });
    let observedRead;
    const aReadHeld = new Promise(resolve => { observedRead = resolve; });
    const heldReads = [], routeTasks = [];
    const holdRead = route => {
      heldReads.push(route.request().postData());
      observedRead();
      const task = readsHeld.then(() => route.continue());
      routeTasks.push(task); return task;
    };
    await page.route('**/api/view', holdRead);
    try {
      const receipt = page.waitForResponse(response => {
        try { return response.request().postDataJSON()?.kind === 'message.resolve'; } catch { return false; }
      });
      if (width === 390) await resolve.tap(); else { await resolve.focus(); await page.keyboard.press('Enter'); }
      const answer = await (await receipt).json(); assert.equal(answer.status, 'committed');
      await page.locator('#reader-origin .question-state').waitFor({ state: 'detached' });
      await aReadHeld;
      assert.ok(heldReads.length, 'at least one real refresh request is held');
      assert.equal(await page.locator(`#messages a[href*="${question}"].topic-state`).count(), 0, 'cover wait removed while background reads are held');
      assert.equal(await page.locator('#source-body').innerText(), displayedWords);
      assert.equal(await page.locator('#reader[open]').count(), 1, 'resolution keeps the Reader open');
      assert.equal(await page.locator('#reader-origin .question-state').count(), 0);
      await page.screenshot({ path: `${evidence}/${key}-resolved.png` });
    } finally { releaseReads(); await Promise.all(routeTasks); await page.unroute('**/api/view', holdRead); }
    await page.goto(origin + `/?topic=t1&message=${first}`);
    await page.waitForFunction(expected => document.querySelector('#source-body')?.textContent.includes(expected), `Older question ${key}?`);
    assert.equal(await page.locator('#reader-origin .question-state').count(), 0, 'superseded question has no terminal label');
    await page.goto(origin + `/?topic=t1&message=${question}`);
    await page.waitForFunction(expected => document.querySelector('#source-body')?.textContent.includes(expected), words);
    assert.equal(await page.locator('#reader-origin .question-state').count(), 0, 'resolved question has no terminal label');
    const source = await control({ method: 'agent_view', actor: facts.agent, name: 'source', args: { kind: 'message', id: question } });
    assert.equal(source.question.state, 'resolved'); assert.deepEqual(source.reactions.answers, []);
    const old = await control({ method: 'agent_view', actor: facts.agent, name: 'source', args: { kind: 'message', id: first } });
    assert.equal(old.question.state, 'superseded'); assert.deepEqual(old.reactions.answers, []);
    assert.deepEqual(errors, []);
    results.push({ width, colorScheme, question, first, nativeCoverOpen: true, nativeResolve: width === 390 ? 'tap' : 'Enter',
      answeredPillGoneWithoutReopening: true, heldReadCount: heldReads.length, coverGoneBeforeBackgroundRead: true, wordsKept: true, reloadTerminal: true, terminalLabelsOmitted: true, directSourceNavigation: true, waitingHeaderFits: true, errors });
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

// One scratch origin, no Core data; Browser.close and fixture EOF on every exit.
// Usage: node FILE CHROME PLAYWRIGHT OUTPUT
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { createInterface } from 'node:readline';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const [chrome, playwright, out] = process.argv.slice(2);
assert.ok(chrome?.endsWith('/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing'));
assert.ok(path.isAbsolute(out));
const { chromium } = createRequire(import.meta.url)(playwright);
await mkdir(out, { recursive: true });
const source = fileURLToPath(new URL('..', import.meta.url));
const argv = ['-I', '-X', `pycache_prefix=${path.join(out, 'cache')}`, fileURLToPath(new URL('./fixtures/interactive_html_920.py', import.meta.url)), source];
const child = spawn('/usr/bin/python3', argv, { stdio: ['pipe', 'pipe', 'pipe'] });
const exit = new Promise(resolve => child.once('exit', (code, signal) => resolve({ code, signal })));
let stderr = '', browser, browserClosed = false;
child.stderr.on('data', bytes => { stderr += bytes; });
const lines = createInterface({ input: child.stdout })[Symbol.asyncIterator]();
const read = async () => { const next = await lines.next(); assert.equal(next.done, false, stderr); return JSON.parse(next.value); };
const result = { pid: child.pid, argv: ['/usr/bin/python3', ...argv], observations: [], console: [], requests: [] };
try {
  const ready = await read(); result.runtime = ready;
  browser = await chromium.launch({ executablePath: chrome, headless: true });
  const context = await browser.newContext({ viewport: { width: 1100, height: 800 } });
  await context.route('https://example.invalid/920', route => route.fulfill({ contentType: 'text/html', body: '<title>Outside</title>' }));
  const page = await context.newPage(); page.setDefaultTimeout(10000);
  page.on('console', message => result.console.push(message.text()));
  await page.goto(ready.origin);
  await page.waitForFunction(() => document.body.dataset.ready === 'true');
  assert.equal(await page.evaluate(() => window.raw920 === window.drawn920), true);
  assert.match(await page.locator('.cover-stands').innerText(), /Before \*\*literal\*\*/);
  // No fence has received a gesture: a main-page click activates only the page.
  await page.waitForFunction(() => [...document.querySelectorAll('iframe.html-frame')].length === 3 &&
    [...document.querySelectorAll('iframe.html-frame')].every(frame => frame.style.height));
  const outer = page.frames().find(frame => frame.parentFrame() === page.mainFrame() && frame.url().endsWith('/interactive-html'));
  const inner = outer.childFrames()[0];
  // Playwright Frame.evaluate sets CDP userGesture:true. These observations and
  // the malicious timer must not manufacture activation in either fence frame.
  const sessions = [];
  const execution = async (frame, owner = context, ownerPage = page) => {
    let target = frame, cdp;
    // Site-isolated frames have their own CDP targets; in-process children use
    // their parent's target and an explicit execution context within it.
    while (!cdp) {
      try { cdp = await owner.newCDPSession(target === ownerPage.mainFrame() ? ownerPage : target); }
      catch (error) {
        if (!error.message.includes('part of the parent frame')) throw error;
        target = target.parentFrame(); assert.ok(target);
      }
    }
    sessions.push(cdp); const contexts = new Map();
    cdp.on('Runtime.executionContextCreated', ({ context: entry }) => {
      if (entry.auxData?.isDefault) contexts.set(entry.auxData.frameId, entry.id);
    });
    await cdp.send('Runtime.enable');
    const { frameTree } = await cdp.send('Page.getFrameTree');
    const find = tree => tree.frame.url === frame.url() ? tree : (tree.childFrames ?? []).map(find).find(Boolean);
    const contextId = contexts.get(find(frameTree)?.frame.id); assert.ok(Number.isInteger(contextId));
    return { cdp, contextId };
  };
  const outerContext = await execution(outer), innerContext = await execution(inner);
  const withoutActivation = async ({ cdp, contextId }, fn) => {
    const response = await cdp.send('Runtime.evaluate', { contextId, expression: `(${fn.toString()})()`,
      userGesture: false, awaitPromise: true, returnByValue: true });
    assert.equal(response.exceptionDetails, undefined); return response.result.value;
  };
  await withoutActivation(outerContext, () => { window.timerSeen920 = false; addEventListener('message', event => {
    if (event.data?.kind === 'link') window.timerSeen920 = true;
  }); });
  await page.locator('#private').click();
  assert.equal(await page.evaluate(() => navigator.userActivation.isActive), true);
  assert.equal(await withoutActivation(outerContext, () => navigator.userActivation.isActive), false);
  await withoutActivation(innerContext, () => new Promise(resolve => setTimeout(() => {
    // The source can read the trusted bridge's nonce, so this is not a bad-token test.
    const nonce = document.scripts[0].textContent.match(/\}\)\("([a-f0-9]{48})"\);$/)[1];
    parent.postMessage({ protocol: 'theseus-html-1', nonce, kind: 'link', href: 'https://example.invalid/920' }, '*');
    resolve();
  }, 0)));
  assert.equal(await withoutActivation(outerContext, () => new Promise(resolve => {
    if (window.timerSeen920) { resolve(true); return; }
    const timer = setTimeout(() => { removeEventListener('message', seen); resolve(false); }, 3000);
    function seen(event) { if (event.data?.kind === 'link') {
      clearTimeout(timer); removeEventListener('message', seen); resolve(true);
    } }
    addEventListener('message', seen);
  })), true, 'the malicious message actually reached the bootstrap');
  await page.evaluate(() => new Promise(resolve => setTimeout(resolve, 50)));
  assert.equal(context.pages().length, 1, 'timer-posted valid-nonce link cannot use an unrelated page activation');
  result.timerLink = { pageActive: true, bootstrapActive: false, receivedByBootstrap: true, opened: false };
  for (const session of sessions) await session.detach();
  for (const surface of ['cover', 'notebook', 'reader']) {
    const outer = page.frameLocator(`#${surface} iframe.html-frame`), inner = outer.frameLocator('iframe');
    await inner.locator('#run').click();
    assert.equal(await inner.locator('#result').innerText(), 'script worked');
    const facts = JSON.parse(await inner.locator('#facts').innerText());
    assert.deepEqual(facts, { parent: 'SecurityError', cookie: 'SecurityError', storage: 'SecurityError' });
    const geometry = await page.locator(`#${surface} iframe.html-frame`).evaluate(frame => ({ height: frame.getBoundingClientRect().height, screen: innerHeight }));
    assert.ok(geometry.height <= geometry.screen);
    assert.equal(await inner.locator('html').evaluate(node => node.scrollHeight > node.clientHeight), true);
    result.observations.push({ surface, facts, geometry, script: true });
  }
  result.enforcement = await outer.evaluate(() => {
    const observer = new ReportingObserver(() => {}, { buffered: true, types: ['connection-allowlist'] });
    observer.observe(); const records = observer.takeRecords().map(report => report.toJSON()); observer.disconnect(); return records;
  });
  assert.ok(result.enforcement.some(report => report.type === 'connection-allowlist' && report.body.connection === 'webrtc' &&
    report.body.disposition === 'enforce' && report.body.allowlist.length === 0));
  result.network = await inner.evaluate(origin => window.tryNetwork(origin), ready.origin);
  assert.equal(result.network.fetch, 'TypeError');
  await inner.locator('#rtc').click();
  assert.equal(await inner.locator('#rtc-error').innerText(), 'WebRTC is not available in this isolated HTML block.');
  await inner.locator('#run').click(); assert.equal(await inner.locator('#result').innerText(), 'script worked');
  await page.locator('#parent-alive').click();
  assert.equal(await page.locator('#parent-alive').innerText(), 'Main page responsive');
  result.rtcStub = { ownError: true, frameResponsive: true, mainPageResponsive: true };
  // Scripted clicks cannot authorize the parent; the next click is native.
  await inner.locator('#outside').evaluate(link => link.click());
  assert.equal(context.pages().length, 1);
  const popupWait = context.waitForEvent('page'); await inner.locator('#outside').click();
  const popup = await popupWait; await popup.waitForLoadState();
  assert.equal(popup.url(), 'https://example.invalid/920');
  assert.equal(await popup.evaluate(() => window.opener), null); await popup.close();
  result.link = { native: true, noopener: true, scripted: false };
  // Attempt direct document navigation, which the outer about:-only policy denies.
  await inner.evaluate(origin => { location.href = origin + '/920-navigation'; }, ready.origin).catch(() => {});
  await page.waitForLoadState('networkidle');
  child.stdin.write(JSON.stringify({ id: 1, method: 'requests' }) + '\n');
  result.requests = (await read()).requests;
  assert.equal(result.requests.some(request => /\/920-(fetch|websocket|image|script|navigation)/.test(request.path)), false);
  result.observations.push({ networkRequests: 0 });
  // Actual Notebook Text preserves the source; Cards opt-in is the real owner.
  await page.evaluate(() => window.notebook920.switchView('text'));
  assert.equal(await page.locator('#notebook-text').inputValue(), await page.evaluate(() => window.raw920));
  await page.evaluate(() => window.notebook920.close());
  await context.close();

  child.stdin.write(JSON.stringify({ id: 2, method: 'withhold-header' }) + '\n'); await read();
  const unsupported = await browser.newContext(), textPage = await unsupported.newPage(), sandboxHeaders = [];
  textPage.on('response', response => { if (response.url() === ready.origin + '/interactive-html') sandboxHeaders.push(response.headers()); });
  await textPage.goto(ready.origin);
  await textPage.locator('#reader .html-source').waitFor();
  assert.equal(await textPage.locator('.html-source').count(), 3);
  assert.equal(await textPage.locator('iframe.html-frame').count(), 0, 'no source script executes without enforcement');
  assert.ok(sandboxHeaders.length >= 3 && sandboxHeaders.every(headers => !('connection-allowlist' in headers)));
  const raw = await textPage.evaluate(() => window.raw920);
  const fence = raw.slice(raw.indexOf('```html'), raw.lastIndexOf('```') + 3);
  for (const surface of ['cover', 'notebook', 'reader'])
    assert.equal(await textPage.locator(`#${surface} .html-source .md-pre`).innerText(), fence);
  const passage = await textPage.locator('#reader .html-block').evaluate(node => ({
    start: Number(node.dataset.start), end: Number(node.dataset.end),
    directPassage: node.parentElement.id === 'reader', sourceRetained: Boolean(node.querySelector('.html-source')),
  }));
  assert.ok(Number.isFinite(passage.start) && passage.end > passage.start);
  assert.equal(passage.directPassage, true); assert.equal(passage.sourceRetained, true);
  result.fallback = { headerWithheld: true, surfaces: 3, exactFence: true, arbitraryFrames: 0, passage };
  await textPage.evaluate(() => window.notebook920.close());
  await unsupported.close();

  // Raw browser-policy probe is deliberately last and isolated (Warp13309).
  // Remove only the RTC stub in this context's response, never product files.
  child.stdin.write(JSON.stringify({ id: 3, method: 'raw-rtc-probe' }) + '\n');
  const probeSetup = await read(); assert.ok(probeSetup.mutation && probeSetup.mutation.original !== probeSetup.mutation.modified);
  const probeContext = await browser.newContext(), probePage = await probeContext.newPage();
  probePage.setDefaultTimeout(10000);
  result.rawRTC = { responseMutation: probeSetup.mutation, rendererTerminated: false, mainPageSurvived: null };
  await probePage.goto(ready.origin);
  await probePage.waitForFunction(() => [...document.querySelectorAll('iframe.html-frame')].length === 3 &&
    [...document.querySelectorAll('iframe.html-frame')].every(frame => frame.style.height));
  const probeOuter = probePage.frames().find(frame => frame.parentFrame() === probePage.mainFrame() && frame.url().endsWith('/interactive-html'));
  const probeInner = probeOuter.childFrames()[0], { cdp: probeCDP } = await execution(probeInner, probeContext, probePage);
  let crashed;
  const crash = new Promise(resolve => { crashed = resolve; });
  probeCDP.on('Inspector.targetCrashed', event => { result.rawRTC.rendererTerminated = true; result.rawRTC.crash = event; crashed(); });
  await probeCDP.send('Inspector.enable');
  result.rawRTC.probe = await probeInner.evaluate(() => window.tryWebRTC());
  assert.equal(result.rawRTC.probe.timeout, false, 'a timeout or crash alone is never enforcement');
  assert.deepEqual(result.rawRTC.probe.candidates, []);
  assert.ok(result.rawRTC.probe.reports.some(report => report.type === 'connection-allowlist' &&
    report.body.connection === 'webrtc' && report.body.disposition === 'enforce' && report.body.allowlist.length === 0));
  await Promise.race([crash, new Promise(resolve => setTimeout(resolve, 1000))]);
  try {
    await probePage.locator('#parent-alive').click({ timeout: 2000 });
    result.rawRTC.mainPageSurvived = await probePage.locator('#parent-alive').innerText() === 'Main page responsive';
  } catch (error) { result.rawRTC.mainPageSurvived = false; result.rawRTC.mainPageError = error.message; }
  await probeContext.close();
} finally {
  if (browser) { await browser.close(); browserClosed = !browser.isConnected(); }
  child.stdin.end(); result.exitAfterEOF = await exit; result.browserClosed = browserClosed;
  await writeFile(path.join(out, 'result.json'), JSON.stringify(result, null, 2));
  await writeFile(path.join(out, 'fixture-stderr.log'), stderr);
  console.log(JSON.stringify(result));
}
assert.equal(browserClosed, true);
assert.deepEqual(result.exitAfterEOF, { code: 0, signal: null });

// Checks written for Chrome for Testing, run again in Safari's engine
// (Playwright's WebKit), against the same isolated fixture. The page object is
// the persistence harness's, with Playwright's WebKit input in place of CDP:
// mouse, touch tap, keyboard, text input, screenshots, colour scheme and
// viewport. A check that reaches for anything else (request interception,
// touch drags, CDP domains) fails by name here; each mode runs every check of
// its module except those skipped below with their reason. docs/device-evidence.md
// says what each mode covers and what only a real phone can show. The
// --new-line mode's checks hold a read or lose an answer with Playwright's own
// request routing, which they are written for (new_line_native.mjs). The
// --invite mode holds or loses an answer for the Chrome harness's intercept,
// release and fail with the same routing (team_invite_native.mjs). The --targets mode
// runs an outcome's target, kind and checks, and archiving, completing and bringing
// it back (targets_native.mjs), skipping the checks that hold a press across a commit,
// which wait on the Chrome harness's network log.
//
// Usage: node tests/webkit_native.mjs <ignored chrome path> <evidence dir> --colors|--whispers|--notebook|--rail|--pipeline|--device|--new-line|--reading|--invite|--health|--targets [case filter]
// playwright-core comes from AIM_PLAYWRIGHT_CORE (tools/release_check.py sets it).
import assert from 'node:assert/strict';
import { reachWith } from './compose-reach.mjs';
import { FELL } from './press-fell.mjs';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { createRequire } from 'node:module';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readingColorsCheck } from './reader_colors_native.mjs';
import { whispersChecks } from './whisper_native.mjs';
import { notebookChecks } from './notebook_pages_native.mjs';
import { pipelineChecks } from './pipeline_native.mjs';
import { railChecks } from './outcome_rail_native.mjs';
import { setAsideChecks } from './set_aside_native.mjs';
import { deviceChecks } from './device_native.mjs';
import { newLineStaysChecks } from './new_line_native.mjs';
import { readingChecks } from './topic_reading_native.mjs';
import { teamInviteChecks } from './team_invite_native.mjs';
import { healthChecks } from './health_native.mjs';
import { targetsChecks } from './targets_native.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const [chromePath, evidencePath, mode, caseFilter] = process.argv.slice(2);
assert.ok(['--colors', '--whispers', '--notebook', '--rail', '--pipeline', '--device', '--new-line', '--reading', '--invite', '--health', '--targets'].includes(mode), `a WebKit mode, not ${mode}`);
assert.ok(evidencePath && path.isAbsolute(evidencePath), 'an absolute evidence directory');
const playwrightPath = process.env.AIM_PLAYWRIGHT_CORE;
assert.ok(playwrightPath && path.isAbsolute(playwrightPath), 'AIM_PLAYWRIGHT_CORE names an absolute playwright-core directory');
const { webkit } = createRequire(import.meta.url)(playwrightPath);

// Each mode runs every check its module offers, as the Chrome mode of the same
// name does, against a fixture of its own, except the checks named here with
// the reason they cannot run in this harness. A name here that its module no
// longer offers fails the run, so a renamed check cannot silently leave WebKit.
const HELD = 'holds a read open with the Chrome harness\'s request interception (intercept), which this harness does not offer';
const ACROSS = 'holds a press down across a commit until the page\'s read after it lands, which it reads from the Chrome harness\'s network log (p.network), which this harness does not record';
const SKIPPED = {
  '--rail': {
    'rail the Reader gives its opener back ringed only as this opening found it: opened by the keys, Escape rings the message; the focus gone elsewhere, opened then by the mouse from the same message and closed with the mouse, nothing is ringed': 'WebKit rings the focus the Reader gives back after a mouse close however the opener was found, with the Reader as it was before item 462 too; Chrome holds the rule',
    'rail a write elsewhere shows with no reload, and an unconfirmed state change says where the topic stands': HELD,
    'rail the outline names an outcome by its light and name, which opens its Conversation; one with no conversation opens its page, and nothing moves when that read lands': HELD,
    'rail a send under way keeps the page where it is, in place; unsent writing is saved as the page moves and is there on coming back': HELD,
    'rail a topic the page can no longer read leaves the right rail at once: its pictures and their bytes go before anything is read again': HELD,
    'rail back and forward across outcomes while the page before is still reading: both rails always show the address as a fresh load does': HELD,
    'rail a quick second back, a back before the page is up, and a place chosen meanwhile all move in place, with no load': HELD,
    'rail a move made while the right rail\'s pictures are still being read shows every picture on the page reached, and again on coming back; a picture opens its message in place': HELD,
    'rail after moves in place the window and the document hear what a fresh load of the same place hears, after the same acts': 'reads the window\'s and the document\'s listeners through Chrome DevTools (DOMDebugger.getEventListeners) and picks a file through its chooser, which this harness does not offer',
    'rail the opening page follows a save made elsewhere while it holds no unsaved writing, and keeps unsaved writing': 'records response bodies with the Chrome harness\'s recordResponses',
  },
  '--health': {
    'health wakes that fail light the link on another page and the page says why, live, from the view': 'puts the Health page in a tab behind (document.visibilityState hidden); each page here is a window of its own, which stays visible',
    'health a wake that gets through clears the page and the link, live': 'clears the failing wakes the check above lights, which is skipped here, so it starts with nothing to clear',
  },
  '--targets': {
    'targets the owner reads No target yet and the kind as two chips, and one tap changes the kind': ACROSS,
    'targets Write the target opens in place: Escape leaves the words as they were, Return saves them, and there is no Save button': ACROSS,
    'targets a run of the checks shows with no reload, grouped, and each group and check opens from the keyboard; Measurements lists every reading': ACROSS,
    'targets the loop: a chart says the mark under the pointer and the one Tab reaches; Ship it anyway opens with a press held across a commit, sends nothing without words and accepts on Return; the problems line opens from the keyboard and opens its topic': ACROSS,
    'targets Reached opens in place, asks him to confirm when nothing checks it, and folds the outcome into Reached (1)': ACROSS,
    'targets a topic opens with its outcome\'s target as one closed line that opens to its words': 'reads the target that Write the target saves, a check skipped here',
    'targets the outcome page and Measurements fit 390 with no sideways scroll, light and dark': 'reads the checks a run of the checks records, a check skipped here',
  },
}[mode] ?? {};

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
// A read out when its page navigates has no page left to answer it: Playwright ends it with "Execution context was
// destroyed". Each page's documents are counted as each one's DOMContentLoaded arrives, and its closing counts as one
// too (attach()), so such a read is thrown carrying the arrival of the next document after the one it was sent to
// (item 418). until() takes that as "not yet": it waits on that arrival, within its own bound, and reads again. Any
// other error ends the wait at once, and so does a closed page's: the read after its closing meets the close.
const DESTROYED = /Execution context was destroyed/;
const documents = new WeakMap();
const nextDocument = (opened, seen) => new Promise(resolve => {
  const known = documents.get(opened);
  if (known.count > seen) resolve(); else known.waiting.push(resolve);
});
const read = async (opened, expression) => {
  const seen = documents.get(opened).count;
  try { return await opened.evaluate(expression); }
  catch (error) { throw DESTROYED.test(error.message) ? Object.assign(error, { navigation: nextDocument(opened, seen) }) : error; }
};
// True when the promise settles within ms; false at once when no time is left.
const within = async (promise, ms) => {
  if (ms <= 0) return false;
  let timer;
  try { return await Promise.race([promise.then(() => true), new Promise(resolve => { timer = setTimeout(resolve, ms, false); })]); }
  finally { clearTimeout(timer); }
};
async function until(probe, description, timeout = 8000) {
  const deadline = Date.now() + timeout;
  let left = '';
  while (Date.now() < deadline) {
    let value;
    try { value = await probe(); }
    catch (error) {
      if (!error.navigation) throw error;
      if (!await within(error.navigation, deadline - Date.now())) { left = ' (its page left during a read, and the page it went to never had its document)'; break; }
      continue;
    }
    if (value) return value;
    await sleep(25);
  }
  throw Error(`Timed out: ${description}${left}`);
}

// The harness's own wait, held on a real page in the Notebook mode, whose checks open Notebook pages (item 418): a page
// that navigates while until()'s read is out leaves that read with no page to answer it, and until() reads again once
// the page it went to has its document; any other error still ends the wait at once, and the wait keeps its own bound.
// A hang here would hold the run until the job is cut off, so each wait these checks expect to end is raced against a
// bound well past its own, which fails the check by name.
const ended = async (promise, ms, what) => {
  let timer;
  try { return await Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(Error(`${what}: still waiting ${ms} ms on`)), ms); })]); }
  finally { clearTimeout(timer); }
};
const untilChecks = async ({ check, page }) => {
  await check('notebook harness until reads on through a navigation during its read: the page that left is not yet, and the page it went to answers', async () => {
    const p = await page('until-navigation', null, true);
    let reads = 0;
    const answered = await ended(until(async () => {
      reads += 1;
      // The first read marks its page and navigates, and is still out when its page goes; every later read asks the page it went to.
      if (reads === 1) return p.evaluate("(window.leftHere = true, location.assign('/?topic=t1'), new Promise(() => {}))");
      return p.evaluate("document.body?.dataset.ready === 'true' && !('leftHere' in window) && location.search");
    }, 'the page navigated to answers'), 30000, 'until across a navigation');
    assert.equal(answered, '?topic=t1', 'the page it went to answers');
    assert.ok(reads >= 2, `read again on the page it went to, ${reads} reads`);
  });
  await check('notebook harness until throws any other error at once: a read the page refuses, and a read of a closed page, are each read once', async () => {
    const p = await page('until-other-error', null, true);
    let reads = 0;
    await assert.rejects(ended(until(() => { reads += 1; return p.evaluate("(() => { throw Error('not a navigation'); })()"); }, 'a refused read'), 30000, 'until on a refused read'),
      error => /not a navigation/.test(error.message) && !/Timed out/.test(error.message));
    assert.equal(reads, 1, 'a refused read is read once');
    await p.close();
    reads = 0;
    await assert.rejects(ended(until(() => { reads += 1; return p.evaluate('true'); }, 'a closed page'), 30000, 'until on a closed page'),
      error => /closed/.test(error.message) && !/Timed out/.test(error.message));
    assert.equal(reads, 1, 'a closed page is read once');
  });
  // A wait ends at its own bound: no read begins after it, and the wait ends within LATE of it, or of its last read's
  // answer when that came later. A bound of another size in place of the wait's own (its 8 s default, the whole bound
  // again once a read's page has left, or the loop run on past it) ends the wait seconds late, and fails here.
  const LATE = 1000;
  const timesOut = async (bound, description, probe, refused) => {
    const reads = [], started = Date.now();
    await assert.rejects(ended(until(async () => {
      const read = { began: Date.now() - started };
      reads.push(read);
      try { return await probe(reads.length); } finally { read.answered = Date.now() - started; }
    }, description, bound), 30000, `until on ${description}`), refused);
    const took = Date.now() - started, last = reads.at(-1);
    assert.ok(took >= bound, `not before its bound of ${bound} ms: ended at ${took} ms`);
    const late = reads.filter(read => read.began >= bound + LATE);
    assert.equal(late.length, 0, `no read begins after its bound of ${bound} ms: ${late.length} of ${reads.length} did, from ${JSON.stringify(late[0])}`);
    assert.ok(took <= Math.max(bound, last.answered) + LATE, `ends at its bound of ${bound} ms, or its last read's answer: ended at ${took} ms, reads ${JSON.stringify(reads)}`);
    return reads;
  };
  await check('notebook harness until still times out at its own bound: a condition that never holds, and a page gone to a document that never loads', async () => {
    const p = await page('until-bound', null, true);
    await timesOut(400, 'a condition that never holds', () => p.evaluate('false'), { message: 'Timed out: a condition that never holds' });
    // The page goes to a document whose module script is held, so it never has its DOMContentLoaded. Its read leaves
    // two thirds of the way into the wait's bound, so the wait for the page it went to has only what is left of it.
    let release;
    const released = new Promise(resolve => { release = resolve; });
    await p.pw.route(/\/app\.mjs$/, async route => { await released; await route.continue().catch(() => {}); });
    try {
      const reads = await timesOut(3000, 'a document that never loads',
        () => p.evaluate("new Promise(resolve => setTimeout(resolve, 2000)).then(() => (location.assign('/?topic=t1'), new Promise(() => {})))"),
        error => /^Timed out: a document that never loads/.test(error.message));
      assert.equal(reads.length, 1, 'no read again before the page it went to has its document');
    } finally { release(); }
  });
  await check('notebook harness until ends at once when its page closes while it waits for the page a read went to: the closed page\'s own error, on one read more', async () => {
    const p = await page('until-close', null, true);
    // The page goes to a document whose module script is held, so it has no DOMContentLoaded before it closes.
    let release, closing = null;
    const released = new Promise(resolve => { release = resolve; });
    await p.pw.route(/\/app\.mjs$/, async route => { await released; await route.continue().catch(() => {}); });
    let reads = 0;
    try {
      await assert.rejects(ended(until(() => {
        reads += 1;
        if (reads > 1) return p.evaluate('true');
        // The read leaves with its page. Its error carries the wait for the page it went to, and only then does the page close.
        return p.evaluate("(location.assign('/?topic=t1'), new Promise(() => {}))").catch(error => { closing = p.pw.close(); throw error; });
      }, 'a page closed while its wait is out', 10000), 30000, 'until on a page closed while its wait is out'),
        error => /closed/.test(error.message) && !/Timed out/.test(error.message));
      assert.equal(reads, 2, 'read once before the close, and once after it, which the closed page refuses');
    } finally { release(); await closing; }
  });
};

const fixture = spawn('/usr/bin/python3', ['tests/fixtures/ui_http.py', '--live', ...(['--colors', '--new-line', '--reading'].includes(mode) ? ['--agent-colors'] : []), ...(mode === '--reading' ? ['--other-person'] : []), '--freshness', '--images', '--media'], { cwd: root });
let fixtureSerial = 0, fixtureErrors = '';
const requests = new Map();
fixture.stderr.on('data', data => { fixtureErrors += data; });
createInterface({ input: fixture.stdout }).on('line', line => {
  const result = JSON.parse(line), request = requests.get(result.id); requests.delete(result.id);
  if (result.failure) request.reject(Error(result.failure)); else request.resolve(result.answer);
});
const fixtureExit = new Promise(resolve => fixture.once('exit', code => {
  for (const request of requests.values()) request.reject(Error(`Fixture exited ${code}: ${fixtureErrors}`));
  resolve(code);
}));
const control = data => new Promise((resolve, reject) => {
  const id = ++fixtureSerial; requests.set(id, { resolve, reject });
  fixture.stdin.write(JSON.stringify({ ...data, id }) + '\n');
});

const results = [], observations = [], hashes = {};
for (const filename of ['tests/webkit_native.mjs', 'tests/reader_colors_native.mjs', 'tests/whisper_native.mjs', 'tests/notebook_pages_native.mjs','tests/notebook_sheet_native.mjs','tests/notebook_card_images_native.mjs','web/notebook-sheet.mjs',
  'web/notebook-page.mjs', 'web/notebook-writing.mjs', 'web/notebook-images.mjs', 'web/deck-page.mjs', 'web/deck.mjs', 'web/image-pick.mjs',
  'tests/pipeline_native.mjs', 'tests/outcome_rail_native.mjs', 'web/arrow-reach.mjs', 'tests/device_native.mjs', 'tests/new_line_native.mjs', 'tests/topic_reading_native.mjs', 'tests/png-bands.mjs', 'tests/fixtures/ui_http.py',
  'web/index.html', 'aim_next/web_build.py', 'web/boot.js', 'web/in-place-navigation.mjs', 'web/aim.css', 'web/app.mjs', 'web/press-hold.mjs', 'web/reader.mjs', 'web/phone-check.mjs', 'web/topic-views.mjs', 'web/read-through.mjs', 'web/unanswered.mjs',
  'web/message-menu.mjs', 'web/glyphs.mjs', 'tests/menu_glyphs.mjs', 'web/feed-passages.mjs', 'web/lit-field.mjs', 'web/message-format.mjs', 'web/reveal.mjs', 'web/reactions.mjs', 'web/card-reading.mjs', 'web/outcome-conversation.mjs', 'web/card-scroll.mjs', 'web/interaction-guide.mjs',
  'tests/team_invite_native.mjs', 'web/agent-invite.mjs', 'aim_next/invite.py',
  'tests/health_native.mjs', 'web/health.mjs', 'web/health-light.mjs', 'aim_next/health.py',
  'tests/targets_native.mjs', 'web/targets.mjs', 'web/outcomes.mjs', 'web/outcome-end.mjs', 'web/outcome-light.mjs', 'web/outcome-light-words.mjs', 'aim_next/outcome_end.py',
  'tests/stack_native.mjs', 'tests/message_edit_native.mjs', 'web/message-edit.mjs', 'web/message-edit-writing.mjs', 'web/reply-stacks.mjs', 'web/stack-order.mjs', 'web/stack-feed.mjs', 'web/stack-look.css', 'web/things-rail.mjs', 'aim_next/stacks.py']) {
  const source = await readFile(path.join(root, filename));
  hashes[filename] = createHash('sha256').update(source).digest('hex');
  await mkdir(path.dirname(path.join(evidencePath, 'source', filename)), { recursive: true });
  await writeFile(path.join(evidencePath, 'source', filename), source);
}

let browser, browserClosed = false, facts, fixtureExitCode, version = null;
const offered = new Set();
const qualifications = new Set();
try {
  facts = await control({ method: 'ready' });
  browser = await webkit.launch({ headless: true });
  version = browser.version();
  // A WebKit context has touch, and with it no hover and a coarse pointer, from its start. The device
  // mode runs as a phone does; the others run as a desktop until a check turns touch on, and then
  // the page moves to a touch context at the same address, size and colour scheme. The invite mode
  // runs with touch from the start too: its checks measure each state on a phone and then on a
  // laptop, and a page cannot leave a touch context without loading again, which would lose the state.
  const contexts = {};
  const contextWith = async hasTouch => contexts[hasTouch] ??= await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, hasTouch });
  const page = async (suffix, hint, connected = false, setup = {}) => {
    assert.equal(connected, true, 'WebKit runs connected pages only');
    let touch = (['--device', '--invite'].includes(mode) || (mode === '--colors' && caseFilter?.includes('item 656'))), scheme = null;
    const initScripts = [];
    const errors = [], calls = [], events = [];
    const attach = opened => {
      // WebKit reports each read a page had out when it navigates away as a page
      // error ("... due to access control checks"), though the page handles
      // it; Chrome reports none. Such a read, reported between the main
      // frame's navigation request and its arrival, is an event of the leaving
      // page, not an error. Any other error, and any error at another time,
      // stays an error.
      let leaving = false;
      const known = { count: 0, waiting: [] }, arrived = () => { known.count += 1; for (const resolve of known.waiting.splice(0)) resolve(); };
      documents.set(opened, known);
      // A new document of the main frame has parsed (Playwright tells this of the main frame only). A closed page will have
      // none, so its closing counts as one: a wait on its next document ends, and the read after it meets the close.
      opened.on('domcontentloaded', arrived);
      opened.on('close', arrived);
      opened.on('request', request => { if (request.isNavigationRequest() && request.frame() === opened.mainFrame()) leaving = true; });
      opened.on('framenavigated', frame => { if (frame === opened.mainFrame()) leaving = false; });
      opened.on('requestfailed', request => { if (request.isNavigationRequest() && request.frame() === opened.mainFrame()) leaving = false; });
      opened.on('pageerror', error => {
        if (leaving && /^Fetch API cannot load \S+ due to access control checks\.$/.test(error.stack?.split('\n')[0] ?? '')) events.push({ method: 'leaving page read cancelled', message: error.message });
        else errors.push({ message: error.message, stack: error.stack });
      });
      opened.on('request', request => {
        if (!request.url().startsWith(facts.origin + '/api/')) return;
        let payload; try { payload = JSON.parse(request.postData() ?? 'null'); } catch { payload = null; }
        calls.push({ url: request.url(), payload, headers: request.headers(), at: Date.now() });
      });
      return opened;
    };
    let pw = attach(await (await contextWith(touch)).newPage());
    // The Chrome harness's intercept, release and fail, for the invite mode: a request the handler picks reaches the
    // server, and its answer is held from the page (a response-stage hold), then given to it or lost as a reset connection.
    let intercept = null;
    const held = [];
    if (mode === '--invite' || (mode === '--colors' && caseFilter?.includes('item 656'))) await pw.route(facts.origin + '/api/**', async route => {
      let payload; try { payload = JSON.parse(route.request().postData() ?? 'null'); } catch { payload = null; }
      if (!(intercept && await intercept(payload))) return route.continue();
      const response = await route.fetch();
      held.push({ payload, route, response });
    });
    const evaluate = expression => read(pw, `(async()=>(${expression}))()`);
    let touchAt = null;
    // The CDP calls the listed checks make, each done with WebKit's own input.
    const send = async (method, params = {}) => {
      if (method === 'Input.dispatchMouseEvent') {
        const { type, x, y, button = 'left', clickCount = 1, modifiers = 0 } = params;
        if (type === 'mouseWheel') { await pw.mouse.move(x, y); await pw.mouse.wheel(params.deltaX ?? 0, params.deltaY ?? 0); return {}; }
        // Shift held through the act, as CDP's modifiers hold it (8); no other modifier is asked of a pointer here.
        assert.equal(modifiers & ~8, 0, 'only Shift is held with a pointer');
        if (modifiers & 8) await pw.keyboard.down('Shift');
        try {
          await pw.mouse.move(x, y);
          if (type === 'mousePressed') await pw.mouse.down({ button, clickCount });
          else if (type === 'mouseReleased') await pw.mouse.up({ button, clickCount });
          else assert.equal(type, 'mouseMoved', `mouse event ${type}`);
        } finally { if (modifiers & 8) await pw.keyboard.up('Shift'); }
        return {};
      }
      if (method === 'Input.dispatchTouchEvent') {
        // A tap: WebKit's touchscreen taps where the touch began. A drag has no counterpart.
        if (params.type === 'touchStart') { assert.equal(params.touchPoints.length, 1, 'one finger'); touchAt = params.touchPoints[0]; return {}; }
        if (params.type === 'touchEnd') { assert.ok(touchAt, 'a touch began'); await pw.touchscreen.tap(touchAt.x, touchAt.y); touchAt = null; return {}; }
        throw Error(`Input.dispatchTouchEvent ${params.type} has no WebKit counterpart in this harness`);
      }
      if (method === 'Input.insertText') { await pw.keyboard.insertText(params.text); return {}; }
      if (method === 'Page.captureScreenshot') {
        assert.equal(params.format ?? 'png', 'png');
        // WebKit paints a new selection on a later frame than the event that made it; Chrome's capture
        // waits for that frame itself. Two animation frames is the frame after the one in flight.
        await pw.evaluate(() => new Promise(done => requestAnimationFrame(() => requestAnimationFrame(done))));
        return { data: (await pw.screenshot({ type: 'png' })).toString('base64') };
      }
      if (method === 'Emulation.setEmulatedMedia') {
        for (const feature of params.features ?? []) {
          assert.equal(feature.name, 'prefers-color-scheme', `media feature ${feature.name}`);
          scheme = feature.value || null;
          await pw.emulateMedia({ colorScheme: scheme });
        }
        return {};
      }
      if (method === 'Emulation.setDeviceMetricsOverride') {
        await pw.setViewportSize({ width: params.width, height: params.height });
        if ((params.deviceScaleFactor ?? 1) !== 1) qualifications.add(`device scale ${params.deviceScaleFactor} asked; WebKit keeps the context's 1 (layout is in CSS pixels)`);
        if (params.mobile) qualifications.add('mobile asked; WebKit runs a desktop window at the phone width with touch, not iOS Safari');
        return {};
      }
      if (method === 'Emulation.setTouchEmulationEnabled') {
        if (!params.enabled && mode === '--invite') {
          qualifications.add('touch stays on for the laptop width: WebKit cannot turn touch off for an open page, so the laptop layout is measured in a touch window');
          return {};
        }
        assert.equal(params.enabled, true, 'touch is turned on, never off');
        if (touch) return {};
        const at = pw.url(), size = pw.viewportSize();
        const moved = attach(await (await contextWith(true)).newPage());
        await moved.setViewportSize(size); await moved.emulateMedia({ colorScheme: scheme });
        for (const script of initScripts) await moved.addInitScript(script);
        // Before its first navigation the page is blank and simply opens in the touch context.
        if (at !== 'about:blank') {
          await moved.goto(at);
          await until(() => read(moved, 'document.body?.dataset.ready === "true"'), 'the page started again with touch');
        }
        await pw.close(); pw = moved; p.pw = moved; touch = true;
        qualifications.add('turning touch on loads the page again in a touch context (WebKit cannot turn touch on for a page already open)');
        return {};
      }
      if (method === 'Network.emulateNetworkConditions') {
        assert.ok(params.latency === 0 && params.downloadThroughput === -1 && params.uploadThroughput === -1, 'only offline or online, with no throttling');
        await pw.context().setOffline(params.offline);
        return {};
      }
      if (method === 'Page.addScriptToEvaluateOnNewDocument') { initScripts.push(params.source); await pw.addInitScript(params.source); return { identifier: String(initScripts.length) }; }
      if (method === 'Page.reload') { await pw.reload(); return {}; }
      if (method === 'Page.navigate') { await pw.goto(params.url); return {}; }
      if (method === 'Page.bringToFront') { await pw.bringToFront(); return {}; }
      throw Error(`${method} has no WebKit counterpart in this harness`);
    };
    const box = selector => evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});if(!e)return null;const b=e.getBoundingClientRect();return {x:b.x,y:b.y,width:b.width,height:b.height,viewportWidth:innerWidth,viewportHeight:innerHeight}})()`);
    const still = selector => { let last; return until(async () => {
      const now = await box(selector), same = Boolean(last) && ['x', 'y', 'width', 'height'].every(key => now?.[key] === last[key]);
      last = now; return !now || same;
    }, `${selector} holds its place`); };
    // As in the Chrome harness: a pointer action lands on its target or fails by naming what covers it, or, when
    // the target moved between the hit-test and the press, where the press fell (FELL).
    const point = async (selector, kind = 'click', { covered = false } = {}) => {
      if (kind === 'click' && !covered && await reach(selector)) return;
      await still(selector);
      const bounds = await box(selector); assert.ok(bounds && bounds.width > 0 && bounds.height > 0, `visible target ${selector}`);
      const x = bounds.x + Math.min(12, bounds.width / 2), y = bounds.y + Math.min(12, bounds.height / 2);
      assert.ok(x >= 0 && y >= 0 && x < bounds.viewportWidth && y < bounds.viewportHeight, `target ${selector} is inside the viewport before a native pointer action`);
      const watch = kind === 'click' && !covered;
      const hit = await evaluate(`(target => { const hit = document.elementFromPoint(${x}, ${y}); if (target?.contains(hit)) { ${watch ? FELL.watch(selector) : ''} return ''; } return hit ? hit.tagName.toLowerCase() + (hit.id ? '#' + hit.id : '') : 'nothing'; })(document.querySelector(${JSON.stringify(selector)}))`);
      if (covered) assert.notEqual(hit, '', `${selector} was meant to be covered at the point pressed`);
      else assert.equal(hit, '', `${selector} is covered by ${hit} where it would be pressed`);
      await pw.mouse.move(x, y);
      if (kind === 'click') {
        await pw.mouse.down();
        const fell = watch ? await evaluate(FELL.read) : '';
        await pw.mouse.up();
        if (fell) assert.fail(`${selector} moved between the hit-test and the press: the press fell on ${fell}`);
      }
    };
    // A control the composer or the ⋯ keeps out of sight is reached first, as a person does (compose-reach.mjs).
    const reach = reachWith({ evaluate, point: selector => point(selector), until });
    const key = async (name, modifiers = 0) => {
      const held = [[1, 'Alt'], [2, 'Control'], [4, 'Meta'], [8, 'Shift']].filter(([bit]) => modifiers & bit).map(([, word]) => word);
      // Safari's plain Tab reaches only fields unless "Press Tab to highlight each item" is on;
      // Option-Tab is its key for every item, so a check's Tab is pressed as that.
      if (name === 'Tab' && !held.includes('Alt')) { held.unshift('Alt'); qualifications.add('Tab is pressed as Option-Tab, Safari\'s key for every item; plain Tab skips buttons and cards in Safari by default'); }
      await pw.keyboard.press([...held, name].join('+'));
    };
    const close = () => pw.close();
    // WebKit paints a page's ::selection colour translucently over what is beneath, so the band is
    // looked for in the colour it painted: the commonest colour down the selected line, which must be
    // neither the computed colour's absence (the hover or page beneath) nor anything but a darker or
    // lighter mix of it. The vertical extent the check compares is then measured as in Chrome.
    const selectionPaint = (pixels, x, rect, computed, beneath) => {
      const counts = new Map();
      for (let y = Math.ceil(rect.y); y < Math.floor(rect.y + rect.height); y++) { const c = pixels.pixel(Math.floor(x), y).slice(0, 3).join(','); counts.set(c, (counts.get(c) ?? 0) + 1); }
      const [painted] = [...counts].sort((a, b) => b[1] - a[1])[0] ?? [''];
      const color = painted.split(',').map(Number);
      assert.ok(color.length === 3 && color.join() !== beneath.slice(0, 3).join(), `WebKit painted a selection over ${beneath} (found ${painted})`);
      // Same hue order as the computed colour: a mix of it, not some other colour.
      const order = c => [0, 1, 2].sort((i, j) => c[j] - c[i]).join();
      assert.equal(order(color), order(computed), `WebKit's selection paint ${painted} is a mix of the computed ${computed}`);
      qualifications.add(`WebKit paints ::selection translucently: computed ${computed.join(',')}, painted ${painted}; the band is found in the painted colour`);
      qualifications.add('WebKit paints a selection over the glyph box on its first line and from the line top to the glyph bottom after; the hover is held to cover it, not to match it');
      return color;
    };
    // As in the Chrome harness: a card a reply stack folds away (docs/topic-reading.md, "Reply stacks")
    // is reached as a person reaches it, by a press on its stack's line first; a card on show is left as it is.
    const unfold = async selector => {
      const way = await evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)}),s=e?.closest('.reply-stack');
          if(!s||s.dataset.single==='true')return null;
          if(!e.getClientRects().length){const t=s.querySelector(':scope > .stack-toggle');t.scrollIntoView({block:'center'});return 'fold'}
          const h=e.classList.contains('stack-head-card')?e:e.querySelector(':scope > .stack-head-card');
          if(h&&s.dataset.headOpen==='false'){h.scrollIntoView({block:'center'});return 'head'}return null})()`);
      // An open dossier of more than seven shows its earlier messages behind one row (item 476): a press on that
      // row shows them as rows, and a press on a message's row shows it whole, as a person reaches it.
      const stack = `#messages .reply-stack:has(${selector.replace(/^#messages\s+/, '')})`, row = `${stack} > .stack-replies > .stack-earlier`;
      const rowShows = () => evaluate(`(b=>Boolean(b&&b.getClientRects().length))(document.querySelector(${JSON.stringify(row)}))`);
      const openEarlier = async () => {
        await evaluate(`document.querySelector(${JSON.stringify(row)}).scrollIntoView({block:'center'})`);
        await point(row);
        await until(async () => !await rowShows(), `${selector}: the earlier-messages row opens`);
      };
      if (way === 'fold') {
        for (let step = 0; step < 3 && !await evaluate(`document.querySelector(${JSON.stringify(selector)}).getClientRects().length > 0`); step++) {
          if (await rowShows()) await openEarlier();
          else await point(`${stack} > .stack-toggle`);
        }
        await until(() => evaluate(`document.querySelector(${JSON.stringify(selector)}).getClientRects().length > 0`), `${selector} shows once its stack opens`);
      } else if (way === 'head') {
        // Open with the first message among the earlier ones, its tab shows alone: the row shows it, not the tab.
        if (!await rowShows()) await point(`${selector} .stack-head .stack-who`);
        await until(async () => await evaluate(`document.querySelector(${JSON.stringify(selector)}).closest('.reply-stack').dataset.headOpen === 'true'`) || await rowShows(), `${selector} shows its full message or its dossier's earlier-messages row`);
        if (await rowShows()) await openEarlier();
        await until(() => evaluate(`document.querySelector(${JSON.stringify(selector)}).closest('.reply-stack').dataset.headOpen === 'true'`), `${selector} shows its full message`);
      }
      // A message shown as an earlier message's row shows whole at a press on that row.
      const earlierRow = `${selector}.message-card[data-earlier=true] > .message-earlier, ${selector} .message-card[data-earlier=true] > .message-earlier`;
      if (await evaluate(`Boolean(document.querySelector(${JSON.stringify(earlierRow)}))`)) {
        await evaluate(`document.querySelector(${JSON.stringify(earlierRow)}).scrollIntoView({block:'center'})`);
        await point(earlierRow);
        await until(() => evaluate(`!document.querySelector(${JSON.stringify(earlierRow)})`), `${selector} shows whole from its earlier message's row`);
      }
    };
    const p = { send, evaluate, close, box, point, key, unfold, calls, errors, events, held, network: [], responses: [], pw, selectionPaint, selectionWithinHover: true,
      intercept: handler => { assert.equal(mode, '--invite', 'intercept is offered in the invite mode'); intercept = handler; },
      release: entry => entry.route.fulfill({ response: entry.response }),
      fail: entry => entry.route.abort('connectionreset'),
      open: async index => {
        for (let more = 0; more < 20 && !await evaluate(`Boolean(document.querySelector('#messages [data-id="${facts.sources[index].id}"]'))`); ++more) {
          const count = await evaluate('document.querySelectorAll("#messages [data-id]").length');
          const target = await evaluate(`document.querySelector('#more-messages').hidden && document.querySelector('#messages .new-line-older') ? '#messages .new-line-older' : '#more-messages'`);
          assert.equal(await evaluate(`document.querySelector(${JSON.stringify(target)}).hidden`), false, 'source exists in remaining older history');
          await evaluate(`document.querySelector(${JSON.stringify(target)}).scrollIntoView({block:"center"})`);
          await point(target);
          await until(() => evaluate(`document.querySelectorAll('#messages [data-id]').length > ${count}` +
            (target === '#more-messages' ? '' : ` && !document.querySelector('#messages .new-line-older')`)), 'older history loaded');
        }
        await unfold(`#messages [data-id="${facts.sources[index].id}"]`);
        await evaluate(`document.querySelector('#messages [data-id="${facts.sources[index].id}"]').scrollIntoView({block:'center'})`);
        // A person's reply or thumbs-up folds what it answers for them (docs/reply-stacks.md, item 377): a press on
        // its row unfolds it, then a press on it opens it. Unfolded among an open dossier's earlier messages, it
        // reads as an earlier message's row (item 476), and a press on that row shows it whole first, as unfold does.
        const card = `#messages .message-card[data-id="${facts.sources[index].id}"]`;
        if (await evaluate(`document.querySelector(${JSON.stringify(card)})?.dataset.folded === 'true'`)) {
          await point(`${card} > .message-folded > .folded-author`);
          await until(() => evaluate(`document.querySelector(${JSON.stringify(card)})?.dataset.folded !== 'true'`), 'the folded message unfolds');
          await unfold(`#messages [data-id="${facts.sources[index].id}"]`);
        }
        await point(`#messages [data-id="${facts.sources[index].id}"]`);
        await until(() => evaluate(`document.querySelector('#reader').open && document.querySelector('#source-body').textContent.startsWith('Source ${index} ')`), 'selected full source');
        await until(() => evaluate("document.getAnimations().filter(x=>x.effect?.getTiming().iterations!==Infinity).every(animation=>animation.playState!=='running')"), 'settled reader');
      },
    };
    await setup.beforeNavigate?.(p);
    await pw.goto(setup.url ?? facts.origin + '/?topic=t1');
    await until(() => evaluate('document.body?.dataset.ready === "true" || Boolean(document.querySelector("#app-status") && !document.querySelector("#app-status").hidden)'), 'application bootstrap');
    if (!setup.allowStartupError && await evaluate('document.body.dataset.ready') !== 'true') assert.fail(await evaluate('document.querySelector("#app-status")?.textContent ?? "the page did not start"'));
    return p;
  };
  const check = async (name, action) => {
    offered.add(name);
    if (name in SKIPPED) return;
    if (caseFilter && !new RegExp(caseFilter).test(name)) return;
    const started = Date.now();
    try { await action(); results.push({ name, passed: true, engine: 'webkit', ms: Date.now() - started }); }
    catch (error) { results.push({ name, passed: false, engine: 'webkit', error: error.stack, ms: Date.now() - started }); }
    finally { for (const key of Object.keys(contexts)) { await contexts[key].close(); delete contexts[key]; } }
    process.stdout.write(JSON.stringify(results.at(-1)) + '\n');
  };
  const view = async (name, args) => (await fetch(facts.origin + '/api/view', { method: 'POST', headers: {
    Authorization: `Bearer ${facts.token}`, Origin: facts.origin, 'Content-Type': 'application/json' }, body: JSON.stringify({ name, args }) })).json();
  const field = p => p.evaluate('document.querySelector("#writing-body").value');
  const replace = async (p, text) => {
    await p.point('#writing-body'); await p.key('a', 4);
    assert.equal(await p.evaluate("document.querySelector('#writing-body').selectionEnd-document.querySelector('#writing-body').selectionStart"), (await field(p)).length, 'native select-all instrument');
    await p.send('Input.insertText', { text }); assert.equal(await field(p), text);
  };
  const shot = async (p, name) => writeFile(path.join(evidencePath, 'webkit-' + name + '.png'), await p.pw.screenshot({ type: 'png' }));
  if (mode === '--colors') {
    await readingColorsCheck({ check, page, until, facts, view, control, field, shot, observations });
  } else if (mode === '--whispers') {
    await whispersChecks({ check, page, until, facts, view, control, replace, shot });
  } else if (mode === '--notebook') {
    await untilChecks({ check, page });
    await notebookChecks({ check, page, until, control, view, facts, shot });
  } else if (mode === '--pipeline') {
    await pipelineChecks({ check, page, until, control, view, facts, shot });
  } else if (mode === '--rail') {
    await railChecks({ check, page, until, control, view, facts, shot });
    await setAsideChecks({ check, page, until, control, view, facts, shot });
  } else if (mode === '--new-line') {
    // A page at the size and address the check names, in light. With lose, the
    // first command it accepts reaches the server and its answer is lost (the
    // connection reset); with hold, each view read it accepts is answered by
    // the server and kept from the page until releaseAnswer().
    const open = async (url, size, name, { lose = null, hold = null } = {}) => {
      let lost = false, held = 0, release;
      const released = new Promise(resolve => { release = resolve; });
      const answers = [];
      const p = await page(name, null, true, { url: facts.origin + url, beforeNavigate: async q => {
        await q.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'light' }] });
        await q.send('Emulation.setDeviceMetricsOverride', size);
        if (lose) await q.pw.route(facts.origin + '/api/command', async route => {
          if (lost || !lose(route.request().postDataJSON())) return route.continue();
          lost = true;
          await route.fetch();
          await route.abort('connectionreset');
        });
        if (hold) await q.pw.route(facts.origin + '/api/view', async route => {
          if (!hold(route.request().postDataJSON())) return route.continue();
          held += 1;
          const response = await route.fetch();
          await released;
          await route.fulfill({ response });
        });
        q.pw.on('response', response => {
          if (response.url() !== facts.origin + '/api/view') return;
          const viewName = response.request().postDataJSON()?.name;
          response.json().then(body => answers.push({ name: viewName, body }), () => {});
        });
      } });
      return Object.assign(p, {
        heldAnswer: () => held > 0, releaseAnswer: async () => release(),
        reports: () => p.calls.filter(c => c.payload?.kind === 'topic.read_through').map(c => [c.payload.args.from_seq, c.payload.args.seq]),
        answered: (viewName, test) => answers.some(entry => entry.name === viewName && test(entry.body)),
      });
    };
    await newLineStaysChecks({ check, open, until, view, control, shot, observations, engine: 'webkit' });
  } else if (mode === '--reading') {
    // The browser's windows, each page known by an id of its own for as long as it is open.
    const ids = new WeakMap(); let next = 0;
    const known = () => browser.contexts().flatMap(context => context.pages()).filter(opened => !opened.isClosed()).map(opened => { if (!ids.has(opened)) ids.set(opened, String(++next)); return [ids.get(opened), opened]; });
    const windows = { list: async () => new Map(known().map(([id, opened]) => [id, opened.url()])), close: async id => { for (const [at, opened] of known()) if (at === id) await opened.close(); } };
    await readingChecks({ check, page, until, control, view, facts, shot, observations, windows, engine: 'webkit' });
  } else if (mode === '--invite') {
    await teamInviteChecks({ check, page, until, control, view, facts, shot });
  } else if (mode === '--health') {
    await healthChecks({ check, page, until, control, view, facts, shot });
  } else if (mode === '--targets') {
    await targetsChecks({ check, page, until, control, view, facts, shot });
  } else {
    await deviceChecks({ check, page, until, control, view, facts, shot, observations });
  }
  for (const name of Object.keys(SKIPPED)) if (!offered.has(name)) results.push({ name, passed: false, engine: 'webkit', error: 'skipped for WebKit but no module offers this check any more' });
} finally {
  if (browser) { await browser.close(); browserClosed = true; }
  fixture.stdin.end();
  fixtureExitCode = await fixtureExit;
  await writeFile(path.join(evidencePath, 'native.json'), JSON.stringify({ mode, engine: 'webkit', webkitVersion: version, chromeArgumentIgnored: chromePath ?? null,
    qualifications: [...qualifications], skipped: SKIPPED, hashes, results, observations, fixtureExitCode, fixtureErrors, browserClosed }, null, 2));
  assert.equal(fixtureExitCode, 0, fixtureErrors);
}
assert.ok(results.length && results.every(result => result.passed), 'see native.json for exact failing assertions');

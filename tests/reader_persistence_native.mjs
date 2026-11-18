// Real isolated HTTP/Store and browser IDB/Web Locks. CDP owns only its CFT
// profile and closes the browser over its socket; no signals, origin sweeps,
// product debug endpoints, or other member's identity. Cases explicitly label
// injected payload boundaries (such as paste); those do not prove OS ingestion.
import assert from 'node:assert/strict';
import { reachWith } from './compose-reach.mjs';
import { imageInstrumentation, imageChecks } from './reader_images_native.mjs';
import { freshnessInstrumentation, freshnessChecks, observeUploadProof } from './reader_freshness_native.mjs';
import { liveChecks } from './reader_live_native.mjs';
import { renderChecks } from './render_native.mjs';
import { inlineChecks } from './reader_inline_native.mjs';
import { readingColorsCheck } from './reader_colors_native.mjs';
import { asksChecks } from './reader_asks_native.mjs';
import { whispersChecks } from './whisper_native.mjs';
import { notebookChecks } from './notebook_pages_native.mjs';
import { workChecks } from './topic_work_native.mjs';
import { lightChecks } from './outcome_light_native.mjs';
import { listChecks } from './topic_list_native.mjs';
import { dutiesChecks } from './topic_duties_native.mjs';
import { sourcesChecks } from './topic_sources_native.mjs';
import { wakesChecks } from './wakes_native.mjs';
import { healthChecks } from './health_native.mjs';
import { headerChecks } from './topic_header_native.mjs';
import { linksChecks } from './links_native.mjs';
import { railChecks } from './outcome_rail_native.mjs';
import { setAsideChecks } from './set_aside_native.mjs';
import { formChecks } from './form_rules_native.mjs';
import { teamInviteChecks } from './team_invite_native.mjs';
import { conversationChecks } from './conversation_native.mjs';
import { pipelineChecks } from './pipeline_native.mjs';
import { targetsChecks } from './targets_native.mjs';
import { agentColorsCheck, agentColorChoiceCheck } from './agent_colors_native.mjs';
import { newLineCheck } from './new_line_native.mjs';
import { foldCheck } from './fold_native.mjs';
import { readingChecks } from './topic_reading_native.mjs';
import { navigationChecks } from './reader_navigation_native.mjs';
import { departureChecks, assertDepartureTrace } from './reader_departure_native.mjs';
import { ReleaseRule } from './release-rule.mjs';
import { closeNativePage, settlePageReleases } from './native-page-cleanup.mjs';
import { protocol, bounded, stamps, cleanupVerdict, closeAll, fixtureBound, CALL_BOUND_MS, FIXTURE_BOUND_MS } from './native-calls.mjs';
import { FELL } from './press-fell.mjs';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { mkdtemp, readFile, writeFile, rm, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const phases = { started: Date.now(), cases: [] };
const [chromePath, evidencePath, mode = '--journal', caseFilter] = process.argv.slice(2);
const baseline = process.env.AIM_FRESHNESS_BASELINE === 'ba4a00e';
const legacyAdmission = process.env.AIM_FRESHNESS_LEGACY === '1';
// The page's module and its upload cleanup, as its document loads them: under the build the server serves
// (aim_next/web_build.py, /b/<build>/name), and not a move in place's run of app.mjs (?place=N).
const instrumented = url => { const u = new URL(url); return u.origin === facts.origin && !u.search && /^\/b\/[^/]+\/(?:app|upload-cleanup)\.mjs$/.test(u.pathname); };
const liveUpdatesFixture = ['--freshness', '--inline', '--navigation', '--live', '--colors', '--asks', '--whispers', '--work', '--light', '--list', '--notebook', '--duties', '--sources', '--wakes', '--header', '--rail', '--conversation', '--forms', '--pipeline', '--targets', '--health', '--reading'].includes(mode);
assert.ok(!(baseline && legacyAdmission), 'the shared-two baseline is distinct from single-slot fallback');
assert.ok(chromePath?.endsWith('/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing'));
assert.ok(evidencePath && path.isAbsolute(evidencePath));
assert.ok(['--journal', '--connected', '--correction', '--cleanup', '--images', '--freshness', '--inline', '--navigation', '--live', '--colors', '--asks', '--whispers', '--work', '--light', '--list', '--notebook', '--duties', '--sources', '--wakes', '--header', '--rail', '--conversation', '--forms', '--pipeline', '--targets', '--health', '--reading'].includes(mode));
await mkdir(evidencePath, { recursive: true });
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(probe, description, timeout = 8000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) { const value = await probe(); if (value) return value; await sleep(25); }
  throw Error(`Timed out: ${description}`);
}
const fixture = spawn('/usr/bin/python3', ['tests/fixtures/ui_http.py', ...(['--navigation','--live','--colors','--asks','--whispers','--work','--light','--list', '--notebook','--duties','--sources','--wakes','--header','--rail','--conversation','--forms','--pipeline','--targets', '--health','--reading'].includes(mode) ? ['--live'] : []), ...(['--colors', '--reading'].includes(mode) ? ['--agent-colors'] : []), ...(mode === '--reading' ? ['--other-person'] : []), ...(liveUpdatesFixture ? ['--freshness', '--images', '--media', ...(legacyAdmission ? ['--legacy-read-admission'] : []), ...(baseline ? ['--baseline-read-admission'] : [])] : mode === '--correction' ? ['--media'] : mode === '--images' ? ['--images'] : [])], { cwd: root });
let fixtureSerial = 0, fixtureErrors = '';
const requests = new Map();
fixture.stderr.on('data', data => { fixtureErrors += data; });
createInterface({ input: fixture.stdout }).on('line', line => {
  const result = JSON.parse(line), request = requests.get(result.id); requests.delete(result.id);
  // An answer after its control's bound finds no one waiting.
  if (!request) return;
  if (result.failure) request.reject(Error(result.failure)); else request.resolve(result.answer);
});
const fixtureExit = new Promise(resolve => fixture.once('exit', code => {
  for (const request of requests.values()) request.reject(Error(`Fixture exited ${code}: ${fixtureErrors}`));
  resolve(code);
}));
// Every control, like every browser call, has a bound (native-calls.mjs).
const control = data => {
  const id = ++fixtureSerial;
  return bounded(new Promise((resolve, reject) => {
    requests.set(id, { resolve, reject });
    fixture.stdin.write(JSON.stringify({ ...data, id }) + '\n');
  }), `fixture control ${data.method}`, { onTimeout: () => requests.delete(id) });
};
// A line when each case starts and one when it ends (native-calls.mjs).
const stamp = stamps();
const results = [], hashes = {}, observations = [];
for (const filename of [...(mode === '--reading' ? ['tests/dossier_selection_quote_native.mjs','tests/fixtures/item_674_runtime.py','tests/fixtures/item_674_original_web.json','tests/fixtures/item_674_original_web.json.gz','web/dossier-selection-quote.mjs','web/reader.mjs','web/index.html'] : []),'tests/item_758_oracle.mjs','tests/item_758_native.mjs','tests/item_758_fixture.py','tests/test_item_758_fixture.py','aim_next/reply_passages.py','aim_next/conversation.py','tests/outline_stars_oracle.mjs',...(mode==='--reading'?['tests/fixtures/item_645_original_web.json','tests/fixtures/item_645_original_web.tar.gz','web/dossier-cover.mjs','tests/stack_native.mjs','tests/topic_reading_native.mjs','tests/ui_folded_names.test.mjs','tests/fixtures/ui_http.py','tests/native-calls.mjs','tests/press-fell.mjs','web/reply-stacks.mjs','web/app.mjs','web/aim.css','web/stack-look.css','web/unanswered.mjs','web/outcome-conversation.mjs','web/read-through.mjs','web/stack-feed.mjs','web/stack-order.mjs','web/outcome-scope.mjs','tools/native.py','tools/release_check.py','web/reveal.mjs','web/message-menu.mjs','web/glyphs.mjs','tests/menu_glyphs.mjs','web/feed-passages.mjs','web/lit-field.mjs','web/message-format.mjs','web/reactions.mjs','web/card-reading.mjs','web/card-scroll.mjs','web/interaction-guide.mjs','tests/png-bands.mjs','tests/message_edit_native.mjs','web/message-edit.mjs','web/message-edit-writing.mjs','web/things-rail.mjs','aim_next/stacks.py','web/fold.mjs','web/rail-drawer.mjs','aim_next/reactions.py','aim_next/topic_reading.py','web/at-names.mjs','web/whisper-choice.mjs','aim_next/addressing.py','aim_next/drafts.py']:[]),...(mode==='--reading'?['tests/topic_reading_native.mjs','web/marks.mjs','web/reveal.mjs','web/message-menu.mjs','web/glyphs.mjs','tests/menu_glyphs.mjs','web/feed-passages.mjs','web/lit-field.mjs','web/message-format.mjs','web/reactions.mjs','web/card-reading.mjs','web/outcome-conversation.mjs','web/card-scroll.mjs','web/interaction-guide.mjs','web/reply-stacks.mjs','tests/stack_native.mjs','tests/png-bands.mjs','tests/message_edit_native.mjs','web/message-edit.mjs','web/message-edit-writing.mjs','web/stack-order.mjs','web/stack-feed.mjs','web/stack-look.css','web/things-rail.mjs','aim_next/stacks.py','web/fold.mjs','web/rail-drawer.mjs','aim_next/reactions.py','aim_next/topic_reading.py','web/at-names.mjs','web/whisper-choice.mjs','aim_next/addressing.py','aim_next/drafts.py']:[]), ...(mode==='--forms'?['tests/form_rules_native.mjs','tests/team_invite_native.mjs','web/agent-invite.mjs','aim_next/invite.py','web/quick-create.mjs','web/outcome-purpose.mjs','web/people.mjs','web/opening-view.mjs','web/creation-view.mjs','aim_next/openings.py','aim_next/store.py']:[]), ...(mode==='--conversation'?['tests/conversation_native.mjs','web/outcome-conversation.mjs','web/message-menu.mjs','web/glyphs.mjs','web/reactions.mjs','aim_next/reactions.py','web/whisper-choice.mjs','web/outcome-scope.mjs','web/topic-navigation.mjs','aim_next/standing_conversation.py','aim_next/conversation.py']:[]), ...(mode==='--header'?['tests/topic_header_native.mjs','tests/links_native.mjs','tests/png-bands.mjs','web/topic-header.mjs','web/topic-settings.mjs','web/topic-state.mjs','web/people.mjs','web/links.mjs','web/dismiss.mjs','web/fold.mjs','web/message-menu.mjs','web/glyphs.mjs','web/app-session.mjs']:[]), ...(mode==='--health'?['tests/health_native.mjs','web/health.mjs','web/health-light.mjs','web/topic-navigation.mjs','aim_next/health.py','aim_next/runner.py','aim_next/live.py','aim_next/store.py']:[]), ...(mode==='--targets'?['tests/targets_native.mjs','web/targets.mjs','web/targets-words.mjs','web/charts.mjs','web/outcomes.mjs','web/topic-navigation.mjs','web/app.mjs','aim_next/checks.py','aim_next/outcome_kind.py','aim_next/outcome_rules.py']:[]), ...(mode==='--pipeline'?['tests/pipeline_native.mjs','tests/menu_glyphs.mjs','web/glyphs.mjs','web/pipeline.mjs','web/pipeline-words.mjs','web/topic-navigation.mjs','web/outcome-scope.mjs','web/app.mjs','aim_next/pipeline.py','aim_next/outcome_rules.py','aim_next/blocking.py']:[]), ...(mode==='--rail'?['tests/cover_waiting_756_native.mjs','aim_next/covers.py','aim_next/migrations.py','aim_next/store.py','tests/outcome_rail_native.mjs','tests/set_aside_native.mjs','aim_next/drafts.py','web/arrow-reach.mjs','web/skills.mjs','web/things-rail.mjs','aim_next/tools_core.py','aim_next/tool_words.py','web/key-tree.mjs','web/in-place-navigation.mjs','web/outline-rail.mjs','web/rail-drawer.mjs','web/rails.mjs','web/outcome-scope.mjs','web/outcomes.mjs','web/outcome-light.mjs','web/opening.mjs','web/creation.mjs','web/topic-state.mjs','web/attention.mjs','aim_next/topic_state.py','tests/outline_stars_native.mjs','tests/outline_stars_oracle.mjs','web/outline-dossiers.mjs','web/rails.css','aim_next/stacks.py','aim_next/validation.py']:[]), ...(mode==='--wakes'?['tests/wakes_native.mjs','web/wake-lights.mjs','web/people.mjs','aim_next/wake_health.py','aim_next/runner.py']:[]), ...(mode==='--sources'?['tests/topic_sources_native.mjs','web/quick-create.mjs','web/opening.mjs','web/opening-view.mjs','web/topic-navigation.mjs','aim_next/sources.py','aim_next/openings.py']:[]), ...(mode==='--duties'?['tests/topic_duties_native.mjs','web/topic-state.mjs','aim_next/responsibility.py']:[]), ...(mode==='--notebook'?['web/notebook-page.mjs','web/notebook-writing.mjs','web/notebook-images.mjs','web/deck-page.mjs','web/deck.mjs','web/image-pick.mjs','tests/notebook_pages_native.mjs','tests/notebook_sheet_native.mjs','tests/notebook_card_images_native.mjs','tests/menu_glyphs.mjs','web/notebook-sheet.mjs','web/glyphs.mjs','web/outcome-references.mjs','web/page-reads.mjs','web/page-changes.mjs','web/page-here.mjs','web/topic-navigation.mjs','web/live.mjs','aim_next/live.py','aim_next/memory.py']:[]), ...(mode==='--list'?['tests/topic_list_native.mjs','web/topic-navigation.mjs','aim_next/topic_state.py','aim_next/conversation.py','aim_next/store.py']:[]), ...(mode==='--light'?['tests/outcome_light_native.mjs','web/outcome-light.mjs','web/outcome-light-words.mjs','web/outcomes.mjs','web/topic-state.mjs','web/topic-navigation.mjs','aim_next/outcome_light.py','aim_next/outcome_rules.py','aim_next/blocking.py','aim_next/work.py','aim_next/topic_state.py','aim_next/store.py']:[]), ...(mode==='--work'?['tests/topic_work_native.mjs','web/topic-state.mjs','web/topic-navigation.mjs','web/people.mjs','aim_next/work.py','aim_next/conversation.py','aim_next/topic_state.py']:[]), ...(mode==='--whispers'?['tests/whisper_native.mjs','web/whisper-choice.mjs','aim_next/whispers.py','aim_next/conversation.py']:[]), ...(mode==='--asks'?['tests/reader_asks_native.mjs','web/whisper-choice.mjs','web/people.mjs','web/topic-state.mjs','web/topic-navigation.mjs','aim_next/topic_state.py','aim_next/conversation.py']:[]), ...(mode==='--colors'?['tests/reader_colors_native.mjs','tests/agent_colors_native.mjs','tests/new_line_native.mjs','web/unanswered.mjs','tests/fold_native.mjs','web/fold.mjs','tests/png-bands.mjs','web/live.mjs','aim_next/live.py','web/author-colors.mjs','web/marks.mjs','web/colors.mjs','web/color-picker.mjs','web/people.mjs','aim_next/colors.py','aim_next/delivery.py','aim_next/conversation.py','web/read-through.mjs']:[]), ...(['--journal','--navigation'].includes(mode) ? ['web/creation.mjs','web/intent-journal.mjs','web/creation-view.mjs',...(mode==='--navigation'?['web/opening-view.mjs','web/opening.mjs','web/opening-store.mjs']:[])] : []), ...(mode === '--navigation' ? ['web/topic-navigation.mjs','web/outcomes.mjs','tests/reader_navigation_native.mjs','tests/reader_departure_native.mjs'] : []), 'web/api.mjs', 'web/lines.mjs', 'web/journal.mjs', 'web/app-session.mjs', 'web/app.mjs', 'web/press-hold.mjs', 'web/times.mjs', 'web/session.mjs', 'web/editor.mjs', ...(mode === '--cleanup' ? ['web/cleanup.mjs'] : []), 'web/reader.mjs', 'web/inline-composer.mjs', 'web/image-rows.mjs', 'web/writing-input.mjs', 'web/writing-helpers.mjs', 'web/index.html', 'web/aim.css', 'tests/fixtures/ui_http.py', 'tests/reader_persistence_native.mjs', 'tests/topic_title_native.mjs', 'tests/acts.json', 'web/topic-header.mjs', 'web/topic-state.mjs', 'tests/release-rule.mjs', 'tests/native-page-cleanup.mjs', 'tests/press-fell.mjs', 'tests/native-calls.mjs', ...(mode === '--images' ? ['tests/reader_images_native.mjs','web/uploads.mjs','web/upload-state.mjs','web/upload-cleanup.mjs','web/cleanup.mjs'] : []), ...(liveUpdatesFixture ? ['aim_next/server.py', 'aim_next/web_build.py', 'web/boot.js', 'web/in-place-navigation.mjs', 'web/freshness.mjs', 'web/topic-views.mjs', 'web/cleanup.mjs', 'web/uploads.mjs', 'web/upload-state.mjs', 'web/upload-cleanup.mjs', ...(mode === '--inline' ? ['tests/reader_inline_native.mjs', 'tests/reader_images_native.mjs'] : ['tests/reader_freshness_native.mjs']), ...(mode === '--live' ? ['web/live.mjs', 'web/session-renewal.mjs', 'aim_next/live.py', 'web/attention.mjs', 'web/outcomes.mjs', 'web/topic-navigation.mjs', 'aim_next/delivery.py', 'tests/reader_live_native.mjs', 'tests/render_native.mjs', 'tests/png-bands.mjs', 'web/marks.mjs', 'web/read-through.mjs', 'tests/ui_marks.test.mjs'] : [])] : [])]) {
  let source;
  try { source = await readFile(path.join(root, filename)); }
  catch (error) {
    if (baseline && error.code === 'ENOENT' && ['web/freshness.mjs', 'web/topic-views.mjs'].includes(filename)) { hashes[filename] = null; continue; }
    throw error;
  }
  hashes[filename] = createHash('sha256').update(source).digest('hex');
  await mkdir(path.dirname(path.join(evidencePath, 'source', filename)), { recursive: true });
  await writeFile(path.join(evidencePath, 'source', filename), source);
}
const profile = await mkdtemp(path.join(os.tmpdir(), 'aim-reader-persistence-'));
const downloadPath = await mkdtemp(path.join(os.tmpdir(), 'aim-reader-download-'));
let chrome, chromeExit, socket, cdp, facts, finalHealth, fixtureExitCode;
const pages = new Set();
// Each page's name (page()'s suffix) by its session and by its target, so a
// call that gets no answer, or a page that will not close, is named.
const pageNames = new Map();
const freshnessPages = new Map();
// Every connected page of the running case, in every mode, for failed-case diagnostics.
const connectedPages = new Map();
let runningCase = null;
// A refused release settles on what the page reports of its request: given
// up (cancelled, or its document replaced) or delivered, which makes the
// refusal a failure. One still unsettled when the page goes is a request the
// instrument left paused. Every connected page is held to this as it goes:
// when its case closes it, or after the case for the pages still open.
const releasesSettled = p => settlePageReleases(p, until, record => {
  observations.push({...record,case:runningCase,targetId:p.targetId});
});
try {
  facts = await control({ method: 'ready' });
  phases.fixtureReady = Date.now();
  chrome = spawn(chromePath, ['--headless=new', '--use-mock-keychain', '--password-store=basic', '--disable-gpu-vsync', '--disable-frame-rate-limit', '--no-first-run', '--no-default-browser-check', '--disable-background-networking',
    '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank'], { stdio: 'ignore' });
  chromeExit = new Promise(resolve => chrome.once('exit', resolve));
  const active = await until(async () => { try { return await readFile(path.join(profile, 'DevToolsActivePort'), 'utf8'); } catch { return null; } }, 'CFT DevTools endpoint');
  const [port, endpoint] = active.trim().split('\n');
  socket = new WebSocket(`ws://127.0.0.1:${port}${endpoint}`);
  await new Promise((resolve, reject) => { socket.addEventListener('open', resolve, { once: true }); socket.addEventListener('error', reject, { once: true }); });
  phases.browserReady = Date.now();
  const browser = protocol({ send: text => socket.send(text), open: () => socket.readyState === WebSocket.OPEN, pageOf: sessionId => pageNames.get(sessionId) ?? null });
  const listeners = new Map();
  const browserEvents = [];
  socket.addEventListener('message', event => {
    const packet = JSON.parse(event.data);
    if (!packet.id) {
      if (!packet.sessionId) browserEvents.push(packet);
      if (packet.method === 'Target.targetDestroyed') pages.delete(packet.params.targetId);
      listeners.get(packet.sessionId)?.(packet); return;
    }
    browser.answer(packet);
  });
  // A browser that goes away ends every wait (native-calls.mjs).
  socket.addEventListener('close', () => browser.closed());
  cdp = browser.call;
  let recoveryContext;
  const page = async (suffix, hint, connected = false, setup = {}) => {
    const { targetId } = await cdp('Target.createTarget', { url: 'about:blank', ...(setup.newWindow ? { newWindow: true } : {}), ...(recoveryContext ? { browserContextId: recoveryContext } : {}) }); pages.add(targetId);
    pageNames.set(targetId, suffix);
    const { sessionId } = await cdp('Target.attachToTarget', { targetId, flatten: true });
    pageNames.set(sessionId, suffix);
    const send = (method, params) => cdp(method, params, sessionId);
    const evaluate = async expression => {
      const answer = await send('Runtime.evaluate', { expression: `(async()=>(${expression}))()`, returnByValue: true, awaitPromise: true });
      if (answer.exceptionDetails) throw Error(JSON.stringify(answer.exceptionDetails));
      return answer.result.value;
    };
    const errors = [], calls = [], held = [], events = [], network = [], responses = [], finished = new Set();
    // A refused release counts in errors and fails its case unless the page
    // gave that request up (release-rule.mjs).
    const releases = new ReleaseRule({ failed: failure => errors.push(failure) });
    const releaseHandlers = new Set();
    let intercept = null, recordResponses = false;
    listeners.set(sessionId, packet => {
      if (['Page.fileChooserOpened', 'Runtime.bindingCalled'].includes(packet.method)) events.push(packet);
      if (mode === '--navigation' && packet.method === 'Runtime.consoleAPICalled') events.push(packet);
      if (mode === '--navigation' && packet.method === 'Page.javascriptDialogOpening') { events.push(packet); send('Page.handleJavaScriptDialog', { accept: false }).catch(error => errors.push({ message: error.message })); }
      if (packet.method === 'Runtime.exceptionThrown') errors.push(packet.params.exceptionDetails);
      if (packet.method.startsWith('Network.')) network.push({ method: packet.method, params: packet.params, observedAt: Date.now() });
      releases.observe(packet);
      if (['Network.loadingFinished', 'Network.loadingFailed'].includes(packet.method)) finished.add(packet.params.requestId);
      if (packet.method === 'Fetch.requestPaused') {
        const event = packet.params;
        const handle = async () => {
          let payload; try { payload = JSON.parse(event.request.postData); } catch { payload = null; }
          calls.push({ url: event.request.url, payload, headers: event.request.headers, at: Date.now() });
          if (['--freshness', '--live'].includes(mode) && instrumented(event.request.url)) {
            const response = await send('Fetch.getResponseBody', { requestId: event.requestId });
            const source = response.base64Encoded ? Buffer.from(response.body, 'base64').toString() : response.body;
            await send('Fetch.fulfillRequest', { requestId: event.requestId, responseCode: 200,
              responseHeaders: [{ name: 'Content-Type', value: 'text/javascript; charset=utf-8' }],
              body: Buffer.from(event.request.url.endsWith('/app.mjs') ? freshnessInstrumentation + '\n' + source + '\nwindow.appReadState=()=>({journal:Boolean(journal),registry:Boolean(registry),reader:Boolean(reader),startup:Boolean(startup),loads:listLoads.size});window.appRegistry=()=>registry;' : observeUploadProof(source)).toString('base64') });
            return;
          }
          if (recordResponses && (payload?.name || event.request.url.endsWith('/api/bootstrap'))) {
            const response = await send('Fetch.getResponseBody', { requestId: event.requestId });
            const body = JSON.parse(response.base64Encoded ? Buffer.from(response.body, 'base64').toString() : response.body);
            responses.push({ payload, url: event.request.url, status: event.responseStatusCode, body, at: Date.now() });
          }
          if (await intercept?.(payload, event)) { held.push({ event, payload }); return; }
          await releases.release(event, () => send(event.responseStatusCode===undefined?'Fetch.continueRequest':'Fetch.continueResponse', { requestId: event.requestId }));
        };
        const task = handle().catch(error => errors.push({message:error.message,requestId:event.requestId}));
        releaseHandlers.add(task);
        task.finally(() => releaseHandlers.delete(task));
      }
    });
    await send('Page.enable'); await send('Runtime.enable'); await send('Network.enable');
    await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
    const box = selector => evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});if(!e)return null;const b=e.getBoundingClientRect();return {x:b.x,y:b.y,width:b.width,height:b.height,viewportWidth:innerWidth,viewportHeight:innerHeight}})()`);
    // A pointer action lands on its target: whatever covers the point (a
    // dialog still closing, a backdrop, a neighbour) fails here by name rather
    // than as a later wait. A check that means to press a covered target says so.
    // A target still moving (a row painted above it, the Reader giving the
    // reply more room, a dialog settling) is pressed once it is where it was
    // when last looked at, as a person aims at a still target. A redraw that
    // lands between the hit-test and the press moves it from under the point:
    // the press fails by naming where it fell (FELL), never as a later wait.
    const still = selector => { let last; return until(async () => {
      const now = await box(selector), same = Boolean(last) && ['x', 'y', 'width', 'height'].every(key => now?.[key] === last[key]);
      last = now; return !now || same;
    }, `${selector} holds its place`); };
    const point = async (selector, kind = 'click', { covered = false } = {}) => {
      if (kind === 'click' && !covered && await reach(selector)) return;
      await still(selector);
      const bounds = await box(selector);
      if (!(bounds && bounds.width > 0 && bounds.height > 0)) assert.fail(`visible target ${selector}: ${JSON.stringify(bounds)}, ${await evaluate(`JSON.stringify({ messages: document.querySelectorAll('#messages [data-id]').length, ids: [...document.querySelectorAll('#messages [data-id]')].slice(0, 4).map(e => e.dataset.id), status: document.querySelector('#app-status')?.textContent, ready: document.body.dataset.ready })`)}`);
      const x = bounds.x + Math.min(12, bounds.width / 2), y = bounds.y + Math.min(12, bounds.height / 2);
      if (!(x >= 0 && y >= 0 && x < bounds.viewportWidth && y < bounds.viewportHeight)) assert.fail(`target ${selector} is inside the viewport before a native pointer action: ${JSON.stringify(bounds)}, ${await evaluate('JSON.stringify({ scrollY, scrollHeight: document.documentElement.scrollHeight })')}`);
      const watch = kind === 'click' && !covered;
      const hit = await evaluate(`(target => { const hit = document.elementFromPoint(${x}, ${y}); if (target?.contains(hit)) { ${watch ? FELL.watch(selector) : ''} return ''; } return hit ? hit.tagName.toLowerCase() + (hit.id ? '#' + hit.id : '') + (typeof hit.className === 'string' && hit.className ? '.' + hit.className.trim().split(/\\s+/).join('.') : '') + (hit.closest('dialog[open]') ? ' in ' + (hit.closest('dialog[open]').id ? '#' + hit.closest('dialog[open]').id : 'an open dialog') : '') : 'nothing'; })(document.querySelector(${JSON.stringify(selector)}))`);
      if (covered) assert.notEqual(hit, '', `${selector} was meant to be covered at the point pressed`);
      else assert.equal(hit, '', `${selector} is covered by ${hit} where it would be pressed`);
      await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
      if (kind === 'click') {
        await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
        const fell = watch ? await evaluate(FELL.read) : '';
        await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
        if (fell) assert.fail(`${selector} moved between the hit-test and the press: the press fell on ${fell}`);
      }
    };
    // A control the composer or the ⋯ keeps out of sight is reached first, as a person does (compose-reach.mjs).
    const reach = reachWith({ evaluate, point: selector => point(selector), until });
    const key = async (name, modifiers = 0) => {
      const code = { Enter: 13, Escape: 27, Tab: 9, Backspace: 8, ArrowLeft: 37, ArrowUp: 38, ArrowRight: 39, ArrowDown: 40 }[name] ?? name.toUpperCase().charCodeAt(0);
      const data = { key: name, code: name.length === 1 ? `Key${name.toUpperCase()}` : name, windowsVirtualKeyCode: code, modifiers };
      // A key that edits names the editing command the browser runs for it, as a real key press does.
      await send('Input.dispatchKeyEvent', { type: name === 'Enter' && !modifiers ? 'keyDown' : 'rawKeyDown', ...data,
        ...(modifiers === 4 && ['a','z'].includes(name) ? { commands: [name === 'a' ? 'selectAll' : 'undo'] } : {}),
        ...(name === 'Backspace' && !modifiers ? { commands: ['deleteBackward'] } : {}),
        ...(name === 'Enter' && !modifiers ? { text: '\r', unmodifiedText: '\r' } : {}) });
      await send('Input.dispatchKeyEvent', { type: 'keyUp', ...data });
    };
    const close = () => closeNativePage({
      settle: async () => { if (connectedPages.has(targetId)) await releasesSettled(connectedPages.get(targetId)); },
      close: async () => { if (pages.has(targetId)) { await cdp('Target.closeTarget', { targetId }); pages.delete(targetId); } },
      forget: () => { connectedPages.delete(targetId); listeners.delete(sessionId); },
    });
    if (connected) {
      if (mode === '--images') await send('Page.addScriptToEvaluateOnNewDocument', { source: imageInstrumentation });
      // A card a reply stack folds away (docs/reply-stacks.md) is reached as a
      // person reaches it: a press on its stack's fold line opens the stack
      // first, and a stack's head shows its full message on a press on its
      // row. A card on show is left as it is.
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
      const connectedPage = { targetId, send, evaluate, close, box, point, key, unfold, calls, held, errors, events, network, responses,
        excusedReleases: releases.excused, failedReleases: releases.failed, unsettledReleases: releases.unsettled,
        pendingReleases: releases.pending, releaseHandlers,
        recordResponses: () => { recordResponses = true; },
        response: async event => {
          const result = await send('Fetch.getResponseBody', { requestId: event.requestId });
          return JSON.parse(result.base64Encoded ? Buffer.from(result.body, 'base64').toString() : result.body);
        },
        intercept: handler => { intercept = handler; },
        release: async entry => {
          if (!await releases.release(entry.event, () => send('Fetch.continueResponse', { requestId: entry.event.requestId }))) return;
          await until(() => finished.has(entry.event.networkId), 'released response finished');
          await evaluate('new Promise(resolve=>setTimeout(resolve,0))');
        },
        fail: entry => send('Fetch.failRequest', { requestId: entry.event.requestId, errorReason: 'ConnectionClosed' }),
        open: async index => {
          if (liveUpdatesFixture) {
            for (let more = 0; more < 20 && !await evaluate(`Boolean(document.querySelector('#messages [data-id="${facts.sources[index].id}"]'))`); ++more) {
              const count = await evaluate('document.querySelectorAll("#messages [data-id]").length');
              // More messages, or the New line while it says more new
              // messages lie below, which hides More.
              const more = await evaluate(`document.querySelector('#more-messages').hidden && document.querySelector('#messages .new-line-older') ? '#messages .new-line-older' : '#more-messages'`);
              assert.equal(await evaluate(`document.querySelector(${JSON.stringify(more)}).hidden`), false, 'source exists in remaining older history');
              await evaluate(`document.querySelector(${JSON.stringify(more)}).scrollIntoView({block:"center"})`);
              await point(more);
              // More loads one page. The New line loads page after page until
              // its message is loaded, and the line moves down as they come:
              // the next press waits until it has reached that message.
              await until(() => evaluate(`document.querySelectorAll('#messages [data-id]').length > ${count}` +
                (more === '#more-messages' ? '' : ` && !document.querySelector('#messages .new-line-older')`)), 'older history loaded');
            }
            await evaluate(`document.querySelector('#messages [data-id="${facts.sources[index].id}"]').scrollIntoView({block:'center'})`);
          }
          await unfold(`#messages [data-id="${facts.sources[index].id}"]`);
          await evaluate(`document.querySelector('#messages [data-id="${facts.sources[index].id}"]').scrollIntoView({block:'center'})`);
          // A stack's first message opens from its words: a press on its head's row shows or hides them.
          const heads = await evaluate(`Boolean(document.querySelector('#messages .stack-head-card[data-id="${facts.sources[index].id}"]'))`);
          // A person's reply or thumbs-up folds what it answers for them (docs/reply-stacks.md, item 377): a press on
          // its row (a dossier's first message's too, under the head row, item 471) unfolds it, then a press on it
          // opens it. Unfolded among an open dossier's earlier messages, it reads as an earlier message's row (item
          // 476), and a press on that row shows it whole first, as unfold does.
          const card = `#messages .message-card[data-id="${facts.sources[index].id}"]`;
          if (await evaluate(`document.querySelector(${JSON.stringify(card)})?.dataset.folded === 'true'`)) {
            await point(`${card} > .message-folded > .folded-words`);
            await until(() => evaluate(`document.querySelector(${JSON.stringify(card)})?.dataset.folded !== 'true'`), 'the folded message unfolds');
            await unfold(`#messages [data-id="${facts.sources[index].id}"]`);
          }
          await point(heads ? `#messages .message-card[data-id="${facts.sources[index].id}"] > .message-preview` : `#messages [data-id="${facts.sources[index].id}"]`);
          await until(() => evaluate(`document.querySelector('#reader').open && document.querySelector('#source-body').textContent.startsWith('Source ${index} ')`), 'selected full source');
          await until(() => evaluate("document.getAnimations().filter(x=>x.effect?.getTiming().iterations!==Infinity).every(animation=>animation.playState!=='running')"), 'settled reader');
        },
      };
      connectedPages.set(targetId, connectedPage);
      if (liveUpdatesFixture) {
        freshnessPages.set(targetId, connectedPage);
        await send('Fetch.enable', { patterns: [{ urlPattern: facts.origin + '/api/*', requestStage: 'Response' }, ...(['--freshness', '--live'].includes(mode) ? [{ urlPattern: facts.origin + '/b/*/app.mjs', requestStage: 'Response' }, { urlPattern: facts.origin + '/b/*/upload-cleanup.mjs', requestStage: 'Response' }] : [])] });
        await setup.beforeNavigate?.(connectedPage);
      }
      await send('Page.navigate', { url: setup.url ?? facts.origin + '/?topic=t1' });
      await until(() => evaluate('document.body?.dataset.ready === "true" || Boolean(document.querySelector("#app-status") && !document.querySelector("#app-status").hidden)'), 'application bootstrap');
      if (!setup.allowStartupError) assert.equal(await evaluate('document.body.dataset.ready'), 'true', await evaluate('document.querySelector("#app-status").textContent'));
      if (!liveUpdatesFixture) await send('Fetch.enable', { patterns: [{ urlPattern: facts.origin + '/api/*', requestStage: 'Response' }] });
      return connectedPage;
    }
    // A text document at this origin permits testing the real imported journal
    // without silently starting app.mjs. This is not a connected-UI claim.
    await send('Page.navigate', { url: facts.origin + '/journal.mjs' });
    await until(() => evaluate(`location.origin === ${JSON.stringify(facts.origin)} && document.readyState === 'complete'`), 'owned document');
    await evaluate(`(async()=>{
      window.context = ${JSON.stringify({ instanceId: 'ux-http-fixture', actor: 'fixture-person', sourceRef: { kind: 'message', id: 'journal-' }, topicId: 't1', kind: 'reply' })};
      context.sourceRef.id += ${JSON.stringify(suffix)};
      const {Editor} = await import('/editor.mjs');
      window.editor = new Editor(context, {id:'private', generation:'original', revision:0});
      editor.edit({body:'Private writing ' + ${JSON.stringify(suffix)}});
      window.snapshot = editor.snapshot();
      window.durability = [];
      const transaction = IDBDatabase.prototype.transaction;
      IDBDatabase.prototype.transaction = function(...args) {
        const tx = transaction.apply(this,args);
        if(args[1]==='readwrite') durability.push({requested:args[2]?.durability,actual:tx.durability});
        return tx;
      };
      ${hint ? `sessionStorage.setItem('aim-next-recovery-tab', ${JSON.stringify(hint)});sessionStorage.setItem('aim-next-recovery-hint:'+JSON.stringify([context.instanceId,context.actor]),${JSON.stringify(hint)});` : ''}
      window.j = await (await import('/journal.mjs')).openJournal({instanceId:context.instanceId,actor:context.actor});
      window.readRow = id => new Promise((resolve,reject)=>{
        const request=indexedDB.open('aim-next-pending');request.onerror=()=>reject(request.error);
        request.onsuccess=()=>{const db=request.result,tx=db.transaction('editors');
          tx.objectStore('editors').get(id).onsuccess=e=>resolve(e.target.result??null);tx.oncomplete=()=>db.close();};
      });
      window.putRow = row => new Promise((resolve,reject)=>{
        const request=indexedDB.open('aim-next-pending');request.onerror=()=>reject(request.error);
        request.onsuccess=()=>{const db=request.result,tx=db.transaction('editors','readwrite',{durability:'strict'});
          tx.objectStore('editors').put(row);tx.oncomplete=()=>{db.close();resolve()};tx.onabort=()=>{db.close();reject(tx.error)};};
      });
    })()`);
    return { targetId, send, evaluate, close };
  };
  // cleanupRefuses: the refusals a case arranges in its own cleanup, a pattern
  // each (cleanupVerdict in native-calls.mjs); any other refusal fails it.
  const check = async (name, action, { cleanupRefuses = [] } = {}) => {
    if (mode === '--colors' && !name.startsWith('colors ')) return;
    if (mode === '--asks' && !name.startsWith('asks ')) return;
    if (mode === '--whispers' && !name.startsWith('whispers ')) return;
    if (mode === '--work' && !name.startsWith('work ')) return;
    if (mode === '--light' && !name.startsWith('light ')) return;
    if (mode === '--list' && !name.startsWith('list ')) return;
    if (mode === '--notebook' && !name.startsWith('notebook ')) return;
    if (mode === '--duties' && !name.startsWith('duties ')) return;
    if (mode === '--sources' && !name.startsWith('sources ')) return;
    if (mode === '--wakes' && !name.startsWith('wakes ')) return;
    if (mode === '--health' && !name.startsWith('health ')) return;
    if (mode === '--header' && !name.startsWith('header ')) return;
    if (mode === '--reading' && !name.startsWith('reading ')) return;
    if (mode === '--rail' && !name.startsWith('rail ')) return;
    if (mode === '--forms' && !name.startsWith('forms ')) return;
    if (mode === '--pipeline' && !name.startsWith('pipeline ')) return;
    if (mode === '--targets' && !name.startsWith('targets ')) return;
    if (mode === '--cleanup' && !name.startsWith('cleanup ')) return;
    if (mode === '--images' && !name.startsWith('images ')) return;
    if (mode === '--freshness' && !name.startsWith('freshness ')) return;
    if (mode === '--live' && !name.startsWith('live ')) return;
    if (mode === '--inline' && !name.startsWith('inline ')) return;
    if (mode === '--navigation' && !name.startsWith('navigation ')) return;
    if (caseFilter && !new RegExp(caseFilter).test(name)) return;
    const timing = { name, started: Date.now() };
    runningCase = name;
    const started = stamp.started(name);
    try {
      // Image and epoch recovery cases leave copies, layout preferences and
      // abandoned recovery rows behind, some deliberately. Each gets a fresh
      // owned storage context, shared only by that case's tabs.
      if (/^images /.test(name) || /^epoch recovery /.test(name) || liveUpdatesFixture) recoveryContext = (await cdp('Target.createBrowserContext')).browserContextId;
      timing.actionStarted = Date.now();
      await action();
      for (const p of connectedPages.values()) await releasesSettled(p);
      if (liveUpdatesFixture) {
        const health = await control({ method: 'admission_events' });
        observations.push({ name: 'fixture health', case: name, fatal: health.fatal, next: health.next });
        assert.deepEqual(health.fatal, [], 'a fixture hold timeout is an instrument failure');
        for (const p of freshnessPages.values()) if (p.responses.length) observations.push({ name: 'observed HTTP fault schedule', case: name, responses: p.responses });
      }
      results.push({ name, passed: true });
    }
    catch (error) {
      results.push({ name, passed: false, error: error.stack });
      for (const [targetId, p] of connectedPages) {
        let state;
        try { state = await p.evaluate('({departure:window.departureState?.(),departureTrace:window.departureDiagnostics,snapshot:window.freshSnapshot?.(),evidence:window.freshEvidence,opening:{status:document.querySelector("#inline-save-state")?.textContent,app:document.querySelector("#app-status")?.textContent,review:document.querySelector("#review-content")?.textContent,reviewStatus:document.querySelector("#review-status")?.textContent,reviewOpen:document.querySelector("#version-review")?.open},reader:{open:document.querySelector("#reader")?.open,notice:document.querySelector("#reader-notice")?.textContent,saveState:document.querySelector("#save-state")?.textContent,writingReadOnly:document.querySelector("#writing-body")?.readOnly,focus:document.activeElement?.id},access:{unavailable:window.observedRegistry?.current?.sourceUnavailable,unconfirmed:window.observedRegistry?.current?.availabilityUnconfirmed},updates:document.querySelector("#updates-message")?.textContent,navigation:document.querySelector("#topic-navigation-status")?.textContent,url:location.href,mediaURLs:window.observedMediaURLs?.size})'); }
        catch (error) { state = { diagnosticError: error.message }; }
        observations.push({ name: 'failed case diagnostics', case: name, targetId, state, errors: p.errors, calls: p.calls });
        try { observations.push({ name: 'bounded failure page state', case: name, targetId, state: await p.evaluate(`(()=>{
          // bounded failure snapshot, authorized by8124; no message text or request headers.
          const limits={stacks:16,cards:24,loadedIds:120,rows:32,controls:16,string:80},truncation={strings:false};
          const word=value=>{const s=String(value??'');if(s.length>limits.string)truncation.strings=true;return s.slice(0,limits.string)};
          const bounded=(name,nodes,limit)=>{const all=Array.from(nodes);truncation[name]={total:all.length,kept:Math.min(all.length,limit),truncated:all.length>limit};return all.slice(0,limit)};
          const rect=e=>{const b=e.getBoundingClientRect();return {x:b.x,y:b.y,width:b.width,height:b.height}};
          const identity=e=>e?{tagName:word(e.tagName),id:word(e.id),className:word(e.className),role:word(e.getAttribute('role')),messageId:word(e.closest('[data-id]')?.dataset.id),topicId:word(e.closest('[data-topic-id]')?.dataset.topicId),workspaceId:word(e.closest('[data-workspace-id]')?.dataset.workspaceId)}:null;
          const active=document.activeElement,ancestry=[];let parent=active;for(let n=0;parent&&n<4;n++,parent=parent.parentElement)ancestry.push(identity(parent));truncation.ancestry={kept:ancestry.length,truncated:Boolean(parent)};
          const cards=document.querySelectorAll('#messages .message-card[data-id]');
          const stacks=bounded('stacks',document.querySelectorAll('#messages .reply-stack'),limits.stacks).map(e=>({head:word(e.dataset.stack),fold:word(e.dataset.fold),whole:word(e.dataset.headOpen),rect:rect(e)}));
          const cardState=bounded('cards',cards,limits.cards).map(e=>({id:word(e.dataset.id),whole:word(e.dataset.whole),folded:word(e.dataset.folded),scrollInPlace:e.classList.contains('scroll-in-place'),clientHeight:e.clientHeight,scrollHeight:e.scrollHeight,scrollTop:e.scrollTop,rect:rect(e)}));
          const controls=bounded('controls',document.querySelectorAll('#more-messages, #new-line-older, #messages .stack-earlier'),limits.controls).map(e=>({id:word(e.id),className:word(e.className),shown:Boolean(e.getClientRects().length),disabled:Boolean(e.disabled)||e.getAttribute('aria-disabled')==='true',rect:rect(e)}));
          const outline=document.querySelector('#outline'),rows=outline?outline.querySelectorAll('.nav-item, [role=treeitem]'):[];
          const rowState=bounded('rows',rows,limits.rows).map(e=>({topicId:word(e.dataset.topicId),workspaceId:word(e.dataset.workspaceId),id:word(e.id),shown:Boolean(e.getClientRects().length),current:word(e.getAttribute('aria-current')),selected:word(e.getAttribute('aria-selected')),expanded:word(e.getAttribute('aria-expanded')),rect:rect(e)}));
          const reader=document.querySelector('#reader'),source=document.querySelector('#source-body');
          return {limits,truncation,activeElement:identity(active),ancestry,stackState:{stacks,cards:cardState,loadedIds:bounded('loadedIds',cards,limits.loadedIds).map(e=>word(e.dataset.id)),controls},outlineState:{exists:Boolean(outline),activeRowId:word(active?.closest('[data-topic-id]')?.dataset.topicId),scrollTop:outline?.scrollTop??null,clientHeight:outline?.clientHeight??null,scrollHeight:outline?.scrollHeight??null,rows:rowState},readerState:{exists:Boolean(reader),open:reader?.open??false,sourceId:word(reader?.dataset.sourceId??source?.dataset.id??window.observedRegistry?.current?.source?.source_ref?.id)}};
        })()`) }); }
        catch (diagnosticError) { observations.push({ name: 'bounded failure page state error', case: name, targetId, diagnosticError: diagnosticError.message }); }
      }
    }
    finally {
      timing.actionEnded = Date.now();
      // CDP console events survive navigation. Serialize passive state on green
      // and red alike, after the scenario; never pace its native input sequence.
      for(const [targetId,p] of freshnessPages){
        if(p.requireDepartureTrace){
          const record={name:'passive departure trace',case:name,targetId,trace:[],expectedReceipts:p.departureExpectedReceipts??[]};
          observations.push(record);
          try{
            record.trace=p.events.filter(e=>e.method==='Runtime.consoleAPICalled'&&e.params.args[0]?.value==='departure-diagnostic').map(e=>JSON.parse(e.params.args[1].value));
            assertDepartureTrace(record.trace,record.expectedReceipts);
            record.valid=true;
          }catch(error){
            record.valid=false;record.error=error.stack;
            Object.assign(results.at(-1),{passed:false,instrumentError:error.stack});
          }
        }
        if(p.errors.length)observations.push({name:'interception failure lifecycle',case:name,targetId,errors:p.errors,network:p.network.filter(e=>['Network.loadingFailed','Network.requestWillBeSent'].includes(e.method))});
      }
      // A page or context that will not close fails this case, by name, and
      // the next case still runs in a fresh context of its own.
      const unclosed = [];
      const tidy = async (what, act) => { try { await act(); } catch (error) { unclosed.push(`${what}: ${error.message}`); } };
      for (const targetId of pages) await tidy(`closing page ${pageNames.get(targetId) ?? targetId}`, () => cdp('Target.closeTarget', { targetId }));
      pages.clear(); listeners.clear(); pageNames.clear();
      freshnessPages.clear(); connectedPages.clear();
      if (recoveryContext) { const browserContextId = recoveryContext; recoveryContext = null; await tidy("disposing the case's browser context", () => cdp('Target.disposeBrowserContext', { browserContextId })); }
      results[results.length - 1] = cleanupVerdict(results.at(-1), unclosed, cleanupRefuses);
      timing.cleanupEnded = Date.now(); phases.cases.push(timing);
    }
    stamp.finished(results.at(-1), started);
  };

  if (mode === '--journal') {
  await check('journal private creation uses strict scoped intents without upgrading editor recovery',async()=>{
    const p=await page('intent-storage');
    await p.evaluate(`(async()=>{
      window.b={instance_id:context.instanceId,actor:context.actor,authority:{authority_id:'a',authority_epoch:'e',continuity:'initial'},limits:{body_utf8_bytes:1048576,workspace_members:128}};
      window.openIntents=(await import('/intent-journal.mjs')).openIntentJournal;
      window.creation=await import('/creation.mjs');
      await j.save(snapshot);window.before=await j.own(editor.key);
      window.intents=await openIntents({instanceId:b.instance_id,actor:b.actor});
      for(let n=0;n<45;n++){
        const id='intent-'+String(n).padStart(2,'0');await intents.claim(id);
        await intents.put({format:1,id,kind:'create',instanceId:b.instance_id,actor:b.actor,authority:{authority_id:'a',authority_epoch:'e'},workspace:n<25?'w1':'w2',phase:n<20?'confirmed':'draft',form:{title:'🙂'.repeat(5000),purpose:'private purpose',team:[]},envelope:null,receipt:null,history:[]});
      }
      window.other=await openIntents({instanceId:b.instance_id,actor:'aaa-foreign'});
      await other.claim('intent-20');await other.put({format:1,id:'intent-20',kind:'create',instanceId:b.instance_id,actor:'aaa-foreign',authority:{authority_id:'a',authority_epoch:'e'},workspace:'w1',phase:'draft',form:{title:'Other actor secret',purpose:'secret',team:[]}});
    })()`);
    const first=await p.evaluate('intents.page()');assert.deepEqual(first.items,[]);assert.equal(first.examined,20);assert.equal(first.nextCursor,'intent-19');
    const second=await p.evaluate(`intents.page({cursor:${JSON.stringify(first.nextCursor)}})`);assert.equal(second.items.length,20);assert.equal(second.nextCursor,'intent-39');
    assert.ok(Buffer.byteLength(JSON.stringify(second.items))<=16384);assert.equal(second.items.some(x=>JSON.stringify(x).includes('secret')||Object.hasOwn(x,'form')),false);
    const workspace=await p.evaluate(`intents.page({workspace:'w1',cursor:'intent-19'})`);assert.equal(workspace.items.length,5);assert.equal(workspace.nextCursor,null);
    assert.equal(await p.evaluate(`(await j.own(editor.key)).stamp===before.stamp`),true,'editor recovery remains open and unchanged');
    const other=await page('intent-other-tab');
    await other.evaluate(`window.intents=await (await import('/intent-journal.mjs')).openIntentJournal({instanceId:'ux-http-fixture',actor:'fixture-person'})`);
    assert.equal(await other.evaluate(`intents.claim('intent-20')`),false,'a competing tab cannot own the intent');
    const failure=await other.evaluate(`(async()=>{try{const row=await intents.get('intent-20');await intents.put({...row,phase:'confirmed'});return '';}catch(error){return error.message}})()`);assert.match(failure,/another tab|read.only/i);
    const blocked=await p.evaluate(`(async()=>{
      window.dispatches=0;const api={bootstrap:async()=>b,command:async()=>{dispatches++;throw Error('must not dispatch');}};
      const c=new creation.OutcomeCreation({api,bootstrap:b,journal:intents,intentId:'failure'});await c.load();await c.edit({title:'Kept intent'});
      const original=IDBObjectStore.prototype.put;IDBObjectStore.prototype.put=function(value){if(this.name==='intents')throw Error('Injected disk failure');return original.call(this,value);};
      let message;try{await c.create();}catch(error){message=error.message;}finally{IDBObjectStore.prototype.put=original;}
      return {message,dispatches,durable:await intents.get('failure')};
    })()`);assert.match(blocked.message,/Injected disk failure/);assert.equal(blocked.dispatches,0);assert.equal(blocked.durable.envelope,null);
    await p.evaluate('j.removeExact(editor.key,before.stamp)');assert.equal(await p.evaluate('j.own(editor.key)'),null);
    assert.equal(await p.evaluate('durability.every(x=>x.requested===\'strict\'&&x.actual===\'strict\')'),true);
    await p.evaluate('(intents.close(),other.close())');await other.evaluate('intents.close()');
  });
  await check('duplicated session hint never shares a live document writer', async () => {
    const a = await page('duplicate'), id = await a.evaluate('j.writerId');
    await a.evaluate('j.save(snapshot)');
    const b = await page('duplicate', id);
    assert.notEqual(await b.evaluate('j.writerId'), id, 'every document must mint a fresh writer despite an inherited hint');
    assert.equal(await b.evaluate('j.previousWriter'), id, 'the inherited hint exists but grants no ownership');
    assert.equal(await b.evaluate('(await j.own(editor.key)) ?? null'), null, 'the new writer owns no old pending attempts');
    const locked = await b.evaluate('j.candidates(editor.key)');
    assert.equal(locked.items[0].availability, 'open-in-another-tab');
    assert.equal(Object.hasOwn(locked.items[0], 'snapshot'), false, 'a live writer must not disclose adoptable attempts');
    assert.deepEqual(await b.evaluate(`j.current(editor.key,[${JSON.stringify(locked.items[0].id)}])`), locked.items,
      'reading a candidate by ID lists a live writer\'s copy exactly as a page does');
    const refusal = await b.evaluate('(async()=>{try{await j.adopt(editor.key,{id:' + JSON.stringify(JSON.stringify([await a.evaluate('editor.key'), id])) + ',stamp:(await j.candidates(editor.key)).items[0].stamp});return null}catch(e){return e.message}})()');
    assert.match(refusal, /another tab/i);
  });

  await check('device recovery writes request and observe strict durability', async () => {
    const a = await page('durability'); await a.evaluate('j.save(snapshot)');
    const observed = await a.evaluate('durability'); assert.ok(observed.length > 0);
    assert.ok(observed.every(tx => tx.requested === 'strict' && tx.actual === 'strict'), JSON.stringify(observed));
  });

  await check('candidate discovery never exposes a foreign actor with a forged editor key', async () => {
    const a = await page('scope');
    await a.evaluate(`putRow({id:JSON.stringify([editor.key,'foreign']),editorKey:editor.key,writerId:'foreign',scope:JSON.stringify([context.instanceId,'another-person']),stamp:'foreign-stamp',active:1,snapshot:{...snapshot,context:{...context,actor:'another-person'},draft:{...snapshot.draft,body:'FOREIGN SECRET'}}})`);
    await a.evaluate(`putRow({id:JSON.stringify([editor.key,'forged']),editorKey:editor.key,writerId:'forged',scope:JSON.stringify([context.instanceId,context.actor]),stamp:'forged-stamp',active:1,snapshot:{...snapshot,context:{...context,actor:'another-person'},draft:{...snapshot.draft,body:'FORGED SECRET'}}})`);
    const candidates = await a.evaluate('j.candidates(editor.key)');
    assert.equal(JSON.stringify(candidates).includes('FOREIGN SECRET'), false, 'foreign writing cannot reach a recovery comparison');
    assert.equal(JSON.stringify(candidates).includes('foreign-stamp'), false, 'foreign row identity is not a candidate');
    assert.equal(JSON.stringify(candidates).includes('FORGED SECRET'), false, 'the scoped index alone does not authorize a forged snapshot');
  });

  await check('explicit adoption keeps source history, both lifetime locks, and one descendant', async () => {
    const a = await page('adoption');
    const original = await a.evaluate(`(async()=>{await j.save({...snapshot,attempts:[{envelope:{operation_id:'original-operation',expected:{authority:{authority_epoch:1}}}}]});return j.own(editor.key)})()`);
    await a.close();
    const b = await page('adoption'), idB = await b.evaluate('j.writerId');
    assert.equal(await b.evaluate('typeof j.adopt'), 'function', 'explicit adoption interface must exist');
    const adopted = await b.evaluate(`j.adopt(editor.key,${JSON.stringify({ id: original.id, stamp: original.stamp })})`);
    assert.deepEqual(adopted.snapshot, original.snapshot, 'retain exact frozen attempts and pins');
    assert.equal(adopted.writerId, idB);
    const history = await b.evaluate(`readRow(${JSON.stringify(original.id)})`);
    assert.equal(history.superseded_by, idB); assert.notEqual(history.stamp, original.stamp);
    assert.deepEqual(history.snapshot, original.snapshot);
    const held = await b.evaluate('(await navigator.locks.query()).held.map(lock=>lock.name)');
    assert.ok(held.some(name => name.includes(original.writerId)), 'source ownership lasts after copy');
    assert.ok(held.some(name => name.includes(idB)), 'new document also keeps its own lock');
    await b.close();
    const c = await page('adoption');
    const candidates = await c.evaluate('j.candidates(editor.key)');
    assert.equal(candidates.items.length, 1); assert.equal(candidates.items[0].writerId, idB);
    assert.deepEqual(candidates.items[0].snapshot, original.snapshot);
    assert.equal((await c.evaluate('j.history(editor.key)')).items.length, 1);
  });

  await check('candidates read by ID are listed exactly as a page lists them, and only while a page would list them', async () => {
    const a = await page('current');
    await a.evaluate('j.save(snapshot)');
    await a.evaluate(`(async()=>{
      const scope=JSON.stringify([context.instanceId,context.actor]);
      for(let n=0;n<4;n++){const writerId='past-'+n;await putRow({id:JSON.stringify([editor.key,writerId]),editorKey:editor.key,writerId,scope,active:1,stamp:'stamp-'+n,snapshot})}
      await putRow({id:JSON.stringify([editor.key,'inactive']),editorKey:editor.key,writerId:'inactive',scope,active:0,stamp:'inactive-stamp',snapshot});
      await putRow({id:JSON.stringify([editor.key,'foreign']),editorKey:editor.key,writerId:'foreign',scope:JSON.stringify([context.instanceId,'another-person']),stamp:'foreign-stamp',active:1,snapshot:{...snapshot,context:{...context,actor:'another-person'}}});
      await putRow({id:JSON.stringify([editor.key,'unreadable']),editorKey:editor.key,writerId:'unreadable',scope,active:1,stamp:'unreadable-stamp',snapshot:{format:99}});
    })()`);
    const listed = (await a.evaluate('j.candidates(editor.key,{limit:20})')).items;
    const id = writer => JSON.stringify([JSON.parse(listed[0].id)[0], writer]);
    const asked = [id('past-2'), id('missing'), id('inactive'), id('foreign'), await a.evaluate('j.id(editor.key)'), id('unreadable'), id('past-0')];
    const byId = new Map(listed.map(row => [row.id, row]));
    assert.deepEqual(await a.evaluate(`j.current(editor.key,${JSON.stringify(asked)})`), asked.filter(row => byId.has(row)).map(row => byId.get(row)),
      'the listed IDs come back as the page lists them, in the order asked; missing, inactive, foreign and own rows do not');
    assert.ok(byId.has(id('unreadable')), 'an unreadable copy is still listed, so it can still hold the reply');
    const chosen = byId.get(id('past-1'));
    await a.evaluate('(async()=>{const row=await j.own(editor.key);await j.removeExact(editor.key,row.stamp)})()');
    await a.evaluate(`j.adopt(editor.key,${JSON.stringify({ id: chosen.id, stamp: chosen.stamp })})`);
    assert.deepEqual(await a.evaluate(`j.current(editor.key,${JSON.stringify([chosen.id])})`), [], 'a copy this document adopted is no longer a candidate');
    assert.deepEqual(await a.evaluate('j.current(editor.key,[])'), []);
    // Probes of one closed writer at once, and an ID asked twice, all read it as closed.
    const closed = byId.get(id('past-2'));
    assert.deepEqual(await a.evaluate(`Promise.all([j.current(editor.key,${JSON.stringify([closed.id, closed.id])}),j.current(editor.key,${JSON.stringify([closed.id])})])`),
      [[closed], [closed]], 'no probe sees another as the writer\'s holder');
    // Inspections and by-ID reads of one closed writer at once never see each other as its holder.
    const inspected = byId.get(id('past-3'));
    const together = await a.evaluate(`(async()=>{const c=${JSON.stringify({ id: inspected.id, stamp: inspected.stamp })};
      const runs=[];for(let n=0;n<20;n++){runs.push(j.inspectCandidate(editor.key,c).then(()=>'inspected',e=>e.message));runs.push(j.current(editor.key,[c.id]).then(rows=>rows.map(r=>r.availability).join()));}
      return [...new Set(await Promise.all(runs))].sort()})()`);
    assert.deepEqual(together, ['available', 'inspected']);
    // A writer this document holds after a declined retirement is still listed to it as available.
    assert.equal(await a.evaluate(`j.retireAcknowledged(editor.key,${JSON.stringify(closed)},async()=>false)`), false);
    assert.deepEqual((await a.evaluate(`j.current(editor.key,${JSON.stringify([closed.id])})`)).map(row => row.availability), ['available']);
    assert.equal((await a.evaluate(`j.inspectCandidate(editor.key,${JSON.stringify({ id: closed.id, stamp: closed.stamp })})`)).id, closed.id);
    // Another tab recovers past-0: by its old ID the copy is listed where it moved.
    const b = await page('current'), moving = byId.get(id('past-0'));
    const moved = await b.evaluate(`j.adopt(editor.key,${JSON.stringify({ id: moving.id, stamp: moving.stamp })})`);
    const now = (await a.evaluate('j.candidates(editor.key,{limit:20})')).items.find(row => row.id === moved.id);
    assert.equal(now.availability, 'open-in-another-tab');
    assert.deepEqual(await a.evaluate(`j.current(editor.key,${JSON.stringify([moving.id])})`), [now], 'a copy another tab recovered is listed where it moved');
  });

  await check('stale cleanup and foreign cleanup cannot remove a row', async () => {
    const a = await page('cleanup');
    const old = await a.evaluate('j.save(snapshot)');
    const latest = await a.evaluate(`j.save({...snapshot,draft:{...snapshot.draft,body:'Newer writing'}})`);
    await a.evaluate(`j.removeExact(editor.key,${JSON.stringify(old)})`);
    assert.equal((await a.evaluate('j.own(editor.key)')).stamp, latest);
    await a.evaluate(`(async()=>{const row=await j.own(editor.key);row.scope=JSON.stringify([context.instanceId,'another-person']);await putRow(row)})()`);
    await a.evaluate(`j.removeExact(editor.key,${JSON.stringify(latest)}).catch(()=>{})`);
    assert.notEqual(await a.evaluate('readRow(j.id(editor.key))'), null, 'mismatched actor row survives even exact stamp cleanup');
  });

  await check('adoption abort is atomic and never overwrites current writer work', async () => {
    const a = await page('abort'), original = await a.evaluate('(async()=>{await j.save(snapshot);return j.own(editor.key)})()');
    await a.close(); const b = await page('abort');
    assert.equal(await b.evaluate('typeof j.adopt'), 'function', 'explicit adoption interface must exist');
    await b.evaluate('j.save({...snapshot,draft:{...snapshot.draft,body:"B already exists"}})');
    const refused = await b.evaluate(`(async()=>{try{await j.adopt(editor.key,${JSON.stringify({ id: original.id, stamp: original.stamp })});return false}catch{return true}})()`);
    assert.equal(refused, true); assert.equal((await b.evaluate('j.own(editor.key)')).snapshot.draft.body, 'B already exists');
    assert.equal((await b.evaluate(`readRow(${JSON.stringify(original.id)})`)).superseded_by, undefined);
    await b.evaluate(`(async()=>{const row=await j.own(editor.key);await j.removeExact(editor.key,row.stamp);
      const put=IDBObjectStore.prototype.put;
      IDBObjectStore.prototype.put=function(row,...rest){if(row.superseded_by){this.transaction.abort();}return put.call(this,row,...rest)};
    })()`);
    const aborted = await b.evaluate(`(async()=>{try{await j.adopt(editor.key,${JSON.stringify({ id: original.id, stamp: original.stamp })});return false}catch{return true}})()`);
    assert.equal(aborted, true); assert.equal(await b.evaluate('j.own(editor.key)'), null);
    const retained = await b.evaluate(`readRow(${JSON.stringify(original.id)})`);
    assert.equal(retained.stamp, original.stamp); assert.equal(retained.superseded_by, undefined);
  });

  await check('scoped candidate pages are bounded and cleaned descendant does not resurrect history', async () => {
    const a = await page('pages');
    assert.equal(await a.evaluate('typeof j.adopt'), 'function', 'explicit adoption interface must exist');
    await a.evaluate(`(async()=>{for(let n=0;n<5;n++){const writerId='past-'+n;await putRow({id:JSON.stringify([editor.key,writerId]),editorKey:editor.key,writerId,scope:JSON.stringify([context.instanceId,context.actor]),active:1,stamp:'stamp-'+n,snapshot})}})()`);
    await a.evaluate(`(()=>{window.actualPageSizes=[];const getAll=IDBIndex.prototype.getAll;IDBIndex.prototype.getAll=function(...args){const request=getAll.apply(this,args);request.addEventListener('success',()=>actualPageSizes.push(request.result.length));return request}})()`);
    const first = await a.evaluate('j.candidates(editor.key,{limit:2})');
    assert.equal(first.items.length, 2); assert.ok(first.nextCursor);
    const next = await a.evaluate(`j.candidates(editor.key,{limit:2,cursor:${JSON.stringify(first.nextCursor)}})`);
    assert.equal(next.items.length, 2); assert.notEqual(next.items[0].id, first.items[0].id);
    assert.ok((await a.evaluate('actualPageSizes')).every(size=>size<=3), 'actual IDB results are bounded to this page plus one lookahead');
    const chosen = first.items[0];
    const own = await a.evaluate(`j.adopt(editor.key,${JSON.stringify({ id: chosen.id, stamp: chosen.stamp })})`);
    await a.evaluate(`j.removeExact(editor.key,${JSON.stringify(own.stamp)})`);
    assert.equal((await a.evaluate('j.candidates(editor.key,{limit:20})')).items.length, 4, 'superseded source is never offered again');
    const history = await a.evaluate('j.history(editor.key)');
    assert.equal(history.items[0].id, chosen.id);
    const held = await a.evaluate('(await navigator.locks.query()).held.map(lock=>lock.name)');
    assert.ok(held.some(name => name.includes(chosen.writerId)), 'cleanup does not release adopted ownership');
  });

  await check('unavailable strict durability refuses a device recovery claim', async () => {
    const a = await page('unsupported');
    await a.evaluate(`(()=>{const tx=IDBDatabase.prototype.transaction;IDBDatabase.prototype.transaction=function(...args){const result=tx.apply(this,args);if(args[1]==='readwrite')Object.defineProperty(result,'durability',{value:'relaxed'});return result}})()`);
    const refused = await a.evaluate('(async()=>{try{await j.save(snapshot);return null}catch(e){return e.message}})()');
    assert.match(refused ?? '', /strict|durab/i);
    assert.equal(await a.evaluate('j.own(editor.key)'), null, 'unsupported write does not commit a pretend recovery copy');
  });
  } else {
    const view = (name, args) => {
      const abort = new AbortController();
      return bounded(fetch(facts.origin + '/api/view', { method: 'POST', signal: abort.signal, headers: {
        Authorization: `Bearer ${facts.token}`, Origin: facts.origin, 'Content-Type': 'application/json' }, body: JSON.stringify({ name, args }) }).then(response => response.json()),
        `view ${name}`, { onTimeout: () => abort.abort() });
    };
    const field = page => page.evaluate('document.querySelector("#writing-body").value');
    const replace = async (page, text) => {
      await page.point('#writing-body'); await page.key('a', 4);
      assert.equal(await page.evaluate("document.querySelector('#writing-body').selectionEnd-document.querySelector('#writing-body').selectionStart"), (await field(page)).length, 'native select-all instrument');
      await page.send('Input.insertText', { text }); assert.equal(await field(page), text);
    };
    const privateState = () => view('editor_state', { source_ref: facts.sources[1], topic_id: 't1' });
    const shot = async (page, name) => {
      const image = await page.send('Page.captureScreenshot', { format: 'png' });
      await writeFile(path.join(evidencePath, name + '.png'), Buffer.from(image.data, 'base64'));
    };
    if (mode === '--colors') {
      await readingColorsCheck({check,page,until,facts,view,control,field,shot,observations});
      await agentColorsCheck({check,page,until,facts,control,shot,observations});
      await agentColorChoiceCheck({check,page,until,control,shot,observations});
      await newLineCheck({check,page,until,view,control,shot,observations,facts});
      await foldCheck({check,page,until,view,control,shot,observations,facts});
    } else if (mode === '--asks') {
      await asksChecks({check,page,until,facts,view,control,replace,shot});
    } else if (mode === '--whispers') {
      await whispersChecks({check,page,until,facts,view,control,replace,shot});
    } else if (mode === '--work') {
      await workChecks({check,page,until,control,view,shot});
    } else if (mode === '--light') {
      await lightChecks({check,page,until,control,view,facts,shot});
    } else if (mode === '--list') {
      await listChecks({check,page,until,control,view,shot});
    } else if (mode === '--notebook') {
      await notebookChecks({check,page,until,control,view,facts,shot});
    } else if (mode === '--duties') {
      await dutiesChecks({check,page,until,control,view,facts,shot});
    } else if (mode === '--sources') {
      await sourcesChecks({check,page,until,control,view,facts,shot});
    } else if (mode === '--wakes') {
      await wakesChecks({check,page,until,control,view,facts,shot});
    } else if (mode === '--health') {
      await healthChecks({check,page,until,control,view,facts,shot});
    } else if (mode === '--header') {
      await headerChecks({check,page,until,control,view,facts,shot});
      await linksChecks({check,page,until,control,view,facts,shot,cdp});
    } else if (mode === '--rail') {
      await railChecks({check,page,until,control,view,facts,shot,observations,evidencePath});
      await setAsideChecks({check,page,until,control,view,facts,shot});
    } else if (mode === '--reading') {
      await readingChecks({check,page,until,control,view,facts,shot,observations,grant:async names=>{for(const name of names)await cdp('Browser.setPermission',{permission:{name},setting:'granted',origin:facts.origin,...(recoveryContext?{browserContextId:recoveryContext}:{})});},
        windows:{list:async()=>new Map((await cdp('Target.getTargets')).targetInfos.filter(t=>t.type==='page').map(t=>[t.targetId,t.url])),close:targetId=>cdp('Target.closeTarget',{targetId})}});
    } else if (mode === '--conversation') {
      await conversationChecks({check,page,until,control,view,facts,replace,shot});
    } else if (mode === '--forms') {
      await formChecks({check,page,until,control,view,facts,shot});
      await teamInviteChecks({check,page,until,control,view,facts,shot});
    } else if (mode === '--pipeline') {
      await pipelineChecks({check,page,until,control,view,facts,shot});
    } else if (mode === '--targets') {
      await targetsChecks({check,page,until,control,view,facts,shot});
    } else if (mode === '--inline') {
      await inlineChecks({check,page,until,root,facts,view,control,replace,field,shot,observations});
    } else if (mode === '--navigation') {
      // The release rule in page(), on real requests: one the page gives up
      // by replacing its document, and one the instrument releases twice.
      await check('navigation harness a refused release is no page error only when the page gave its request up', async () => {
        const p = await page('harness-release', null, true);
        let open; const gate = new Promise(resolve => { open = resolve; });
        p.intercept(async (payload, event) => {
          const pathname = new URL(event.request.url).pathname;
          if (pathname === '/api/harness-abandoned') await gate;
          // Released here and again by the harness once the page has its
          // response, so the second release finds the interception gone.
          if (pathname === '/api/harness-released-twice') {
            await p.send('Fetch.continueResponse', { requestId: event.requestId });
            await until(() => p.network.some(e => e.method === 'Network.responseReceived' && e.params.requestId === event.networkId), 'first release delivered');
          }
          return false;
        });
        const sent = name => until(() => p.network.find(e => e.method === 'Network.requestWillBeSent' && e.params.request.url === facts.origin + '/api/' + name)?.params.requestId, 'page sent ' + name);
        await p.evaluate("(fetch('/api/harness-abandoned').catch(()=>{}),true)");
        const abandoned = await sent('harness-abandoned');
        await until(() => p.calls.some(c => c.url === facts.origin + '/api/harness-abandoned'), 'response to the abandoned request paused');
        await p.send('Page.navigate', { url: facts.origin + '/?topic=t1' });
        await until(async () => { try { return await p.evaluate('document.body?.dataset.ready === "true"'); } catch { return false; } }, 'replacement document ready');
        open();
        const settled = id => [...p.excusedReleases, ...p.failedReleases].find(f => f.networkId === id);
        await until(() => settled(abandoned), 'refused release of the abandoned request settled');
        assert.match(settled(abandoned).message, /Invalid InterceptionId/, 'the release really was refused');
        assert.deepEqual(p.errors, [], 'a request the page gave up is no page error');
        await p.evaluate("(fetch('/api/harness-released-twice').catch(()=>{}),true)");
        const twice = await sent('harness-released-twice');
        await until(() => settled(twice), 'refused second release settled');
        assert.match(settled(twice).message, /Invalid InterceptionId/, 'the second release really was refused');
        assert.deepEqual(p.errors.map(f => f.networkId), [twice], 'a refused release of a request the page still wanted is a page error');
        assert.deepEqual(p.failedReleases, p.errors);
        assert.deepEqual(p.excusedReleases.map(f => f.networkId), [abandoned], 'only the abandoned request is excused');
        // A page its case closes is held to the rule as it goes. This failed
        // release was made on purpose, so the close is refused, and the page
        // goes all the same. Every outcome of the rule: release_rule.test.mjs.
        observations.push({ name: 'harness release rule', excused: [...p.excusedReleases], failed: [...p.failedReleases] });
        await assert.rejects(p.close(), /every interception release the page did not give up succeeded/, 'closing the page applies the rule');
        assert.equal(connectedPages.has(p.targetId), false, 'the refused page is closed all the same');
      });
      // A page that stops answering, mid-call, on a real renderer: the call
      // fails at its bound naming its method and page, the case's cleanup
      // still closes the page, and the cases after it run (native-calls.mjs,
      // whose unit holds every bound, the screenshot's included).
      await check('navigation harness a page that stops answering fails its call by name at the bound and is still closed', async () => {
        const p = await page('stops-answering', null, true);
        assert.equal(await p.evaluate('document.body.dataset.ready'), 'true', 'the page answers until it is made busy');
        const busy = p.send('Runtime.evaluate', { expression: 'for(;;){}' }).then(() => 'answered', error => error.message);
        const asked = Date.now();
        await assert.rejects(p.evaluate('1'), { message: `CDP timed out: Runtime.evaluate on page stops-answering, no answer in ${CALL_BOUND_MS / 1000} s` });
        const waited = Date.now() - asked;
        observations.push({ name: 'a page that stops answering', waited, busy: await busy });
        assert.ok(waited >= CALL_BOUND_MS - 100 && waited < CALL_BOUND_MS + 5000, `failed at its bound, not before and not long after: ${waited} ms`);
      });
      // Each case is on the step's log as started before it runs: when its
      // action begins, its own start line is the last line the harness wrote,
      // and the line before it is the result of the case before, with both of
      // that case's times (stamps in native-calls.mjs; the release check reads
      // both lines of every case from the step's log).
      const linesCase = 'navigation harness case lines: a case is on the log as started before it runs';
      await check(linesCase, async () => {
        const own = JSON.parse(stamp.written.at(-1));
        assert.deepEqual(Object.keys(own), ['case', 'started'], 'the last line written is a start line');
        assert.equal(own.case, linesCase, 'and it is this case’s own');
        const since = Date.now() - Date.parse(own.started);
        assert.ok(since >= 0 && since < 60000, `it says when the case started: ${own.started}`);
        if (results.length) {
          const before = JSON.parse(stamp.written.at(-2));
          assert.equal(before.name, results.at(-1).name, 'the line before it is the result of the case before');
          assert.ok(Date.parse(before.started) <= Date.parse(before.finished) && Date.parse(before.finished) <= Date.parse(own.started), 'with when that case started and finished, before this one started');
        }
      });
      // A page and a context that will not close at the end of a case: each
      // is named, the rest of the cleanup goes on, and the next case runs.
      // These refusals are arranged, so the case names them (cleanupRefuses);
      // a refusal no case arranged fails its case (cleanupVerdict's unit).
      const refusedCase = 'navigation harness cleanup refused: a page and a context that will not close are named and the rest is closed';
      let unclosable = null;
      await check(refusedCase, async () => {
        // A target and a context the browser does not know, each refused when
        // closed; the ghost page comes first, so a refusal must not stop the
        // pages after it.
        pages.add('harness-ghost-target'); pageNames.set('harness-ghost-target', 'ghost-page');
        const p = await page('closed-after-a-ghost');
        unclosable = { page: p.targetId, context: recoveryContext };
        recoveryContext = 'harness-ghost-context';
      }, { cleanupRefuses: [/^closing page ghost-page: \{.*\}$/, /^disposing the case's browser context: \{.*\}$/] });
      await check('navigation harness cleanup refused: the case after it runs and finds both refusals on its record', async () => {
        assert.ok(unclosable, 'the case before it ran');
        const before = results.at(-1);
        assert.equal(before.name, refusedCase);
        assert.equal(before.passed, true, 'its refusals were the ones it arranged');
        assert.equal(before.cleanupRefused?.length, 2, `both refusals are on its record: ${JSON.stringify(before)}`);
        assert.match(before.cleanupRefused[0], /^closing page ghost-page: .*No target/);
        assert.match(before.cleanupRefused[1], /^disposing the case's browser context: /);
        const { targetInfos } = await cdp('Target.getTargets');
        assert.equal(targetInfos.some(target => target.targetId === unclosable.page), false, 'the page after the ghost was closed');
        // The real context that case was given is still the harness's to dispose.
        if (unclosable.context) await cdp('Target.disposeBrowserContext', { browserContextId: unclosable.context });
      });
      // A fixture control and a view read from the fixture's server that get
      // no answer fail at their bound, by name, through this harness's own
      // control() and view(). The bound is lowered for that one call only
      // (fixtureBound in native-calls.mjs), so the case takes seconds.
      await check('navigation harness a fixture control and a view that get no answer fail by name at their bound', async () => {
        const lowered = 3000;
        const atBound = async (call, what) => {
          fixtureBound.ms = lowered;
          let pending;
          try { pending = call(); } finally { fixtureBound.ms = FIXTURE_BOUND_MS; }
          const asked = Date.now();
          // A call with no bound never fails; this one says so instead of holding the case.
          const error = await bounded(pending.then(() => null, error => error), `${what} failing at its bound`, { ms: lowered + 10000 });
          const waited = Date.now() - asked;
          assert.equal(error?.message, `Timed out: ${what}, no answer in ${lowered / 1000} s`);
          assert.ok(waited >= lowered - 100 && waited < lowered + 5000, `failed at its bound, not before and not long after: ${waited} ms`);
          return waited;
        };
        // The fixture leaves this control unanswered (tests/fixtures/ui_http.py).
        const waitedControl = await atBound(() => control({ method: 'unanswered' }), 'fixture control unanswered');
        assert.equal(requests.size, 0, 'the unanswered control is no longer waited on');
        // The fixture holds this view's read until it is released.
        const { next: after } = await control({ method: 'admission_events' });
        await control({ method: 'read_hold', hold_id: 'harness-unanswered-view', name: 'workspaces', phase: 'callback', timeout_ms: 15000 });
        const waitedView = await atBound(() => view('workspaces', { limit: 100 }), 'view workspaces');
        await control({ method: 'read_release', hold_id: 'harness-unanswered-view' });
        const { events } = await control({ method: 'admission_events', after });
        assert.ok(events.some(event => event.event === 'hold-enter' && event.hold_id === 'harness-unanswered-view'), 'the view really was held');
        assert.ok(Array.isArray((await view('workspaces', { limit: 100 })).items), 'the next view is answered');
        observations.push({ name: 'a fixture control and a view that get no answer', waitedControl, waitedView });
      });
      await navigationChecks({ check, page, until, root, evidencePath, facts, view, control, replace, field, shot, observations });
      await departureChecks({ check, page, until, facts, view, control, shot, observations });
    } else if (mode === '--live') {
      await liveChecks({check,page,until,control,observations,origin:facts.origin,cdp,view,facts});
      await renderChecks({check,page,until,control,origin:facts.origin,evidencePath});
    } else if (mode === '--freshness') {
      await freshnessChecks({check,page,until,root,facts,view,control,replace,field,shot,observations,baseline,legacyAdmission});
    } else if (mode === '--images') {
      await imageChecks({check,page,until,root,facts,view,control,replace,field,shot,observations});
    } else if (mode === '--cleanup') {
      const rows = p => p.evaluate(`new Promise((resolve,reject)=>{const r=indexedDB.open('aim-next-pending');r.onerror=()=>reject(r.error);r.onsuccess=()=>{const d=r.result,t=d.transaction('editors');t.objectStore('editors').getAll().onsuccess=e=>resolve(e.target.result);t.oncomplete=()=>d.close()}})`);
      const scoped = async p => (await rows(p)).filter(row => row.scope === JSON.stringify([facts.instance_id, facts.actor]) && row.snapshot.sourceRef.id === facts.sources[1].id && row.active === 1);
      await check('cleanup ordinary send click empty field close reload removes only acknowledged recovery', async () => {
        const p = await page('cleanup-send', null, true); await p.open(1);
        await replace(p, 'Exact cleanup publication'); await p.key('Enter', 12);
        const send = await until(() => p.calls.find(call => call.payload?.kind === 'message.send'), 'actual send response');
        const receipt = await view('operation', { operation_id: send.payload.operation_id });
        assert.equal(receipt.status, 'committed');
        await until(async () => { const actual = await scoped(p); return !actual.length || actual.some(row => row.snapshot.attempts.some(a => a.envelope.operation_id === send.payload.operation_id && a.receipt?.status === 'committed')); }, 'application persisted exact send acknowledgement');
        // Await the actual cleanup effect, never infer it from a hidden control.
        await until(async () => (await scoped(p)).length === 0, 'acknowledged IDB retirement').catch(() => {});
        assert.equal((await scoped(p)).length, 0, 'ordinary acknowledged send retires scoped IDB row');
        const canonical = await privateState();
        await p.point('#writing-body');
        const localCaret = await p.evaluate('({start:document.querySelector("#writing-body").selectionStart,end:document.querySelector("#writing-body").selectionEnd})');
        observations.push({ canonicalSuccessor: canonical.draft, localCaret });
        assert.equal(canonical.draft.body, ''); assert.deepEqual(localCaret, { start: 0, end: 0 });
        assert.equal(Object.hasOwn(canonical.draft, 'caret'), false, 'server successor omits only the restoration hint');
        await p.point('#reader-close'); await until(() => p.evaluate('!document.querySelector("#reader").open'), 'closed reader');
        assert.equal((await scoped(p)).length, 0, 'caret-only close cannot recreate a retired row');
        await p.close(); const q = await page('cleanup-reload', null, true); await q.open(1);
        assert.equal(await field(q), ''); assert.equal((await scoped(q)).length, 0, 'fresh document sees no duplicate recovery row');
        await replace(q, 'New writing survives after retirement');
        await until(async () => (await scoped(q)).some(row => row.snapshot.draft.body === 'New writing survives after retirement'), 'fresh local write');
        await until(async () => (await privateState()).draft.body === 'New writing survives after retirement' && !(await scoped(q)).length, 'new writing acknowledged independently');
        assert.deepEqual(q.errors, []);
      });

      await check('cleanup acknowledged autosave preserves native focus caret space and Undo', async () => {
        const p = await page('cleanup-writing', null, true); await p.open(1);
        for (const kind of ['reply', 'note']) {
          if (kind === 'note') await p.point('#toggle-note');
          const original = await field(p), text = 'Cleanup keeps native writing ' + kind;
          await replace(p, text); await p.key('ArrowLeft');
          const visible = () => p.evaluate('({body:document.querySelector("#writing-body").value,focus:document.activeElement.id,caret:[document.querySelector("#writing-body").selectionStart,document.querySelector("#writing-body").selectionEnd],height:document.querySelector("#writing-body").getBoundingClientRect().height,source:document.querySelector("#source-body").textContent})');
          const before = await visible();
          await until(async () => (await privateState())[kind === 'reply' ? 'draft' : 'note']?.body === text && !(await scoped(p)).length, 'private acknowledgement and IDB cleanup');
          assert.deepEqual(await visible(), before, 'cleanup leaves writing, focus, caret and writing space intact');
          await p.key('z', 4); assert.equal(await field(p), original, 'native Undo survives retirement');
          await until(async () => (await privateState())[kind === 'reply' ? 'draft' : 'note']?.body === original && !(await scoped(p)).length, 'Undo separately saved');
        }
        // Done hands the saved note back to the reply; closing then leaves nothing scoped.
        await p.key('Enter', 4); await until(() => p.evaluate(`document.querySelector('#reader').open && document.querySelector('#toggle-note').textContent !== 'Back to reply'`), 'ordinary saved note hands back to the reply');
        await p.point('#reader-close'); await until(() => p.evaluate('!document.querySelector("#reader").open'), 'reader closed');
        assert.equal((await scoped(p)).length, 0); assert.deepEqual(p.errors, []);
      });

      await check('cleanup native adoption retires acknowledged descendant without resurrecting sealed source or releasing locks', async () => {
        const a = await page('cleanup-adopt-a', null, true); await a.open(1);
        await replace(a, 'Unsaved adopted writing');
        const original = await until(async () => (await scoped(a)).find(row => row.snapshot.draft.body === 'Unsaved adopted writing'), 'A recovery copy before autosave');
        await a.close();
        const b = await page('cleanup-adopt-b', null, true); await b.open(1);
        await until(() => b.evaluate('!document.querySelector("#review-versions").hidden'), 'recovery action discoverable');
        await b.point('#review-versions');
        const selector = await until(() => b.evaluate(`(()=>{const section=[...document.querySelectorAll('#review-content section')].find(e=>e.querySelector('pre')?.textContent==='Unsaved adopted writing'&&[...e.querySelectorAll('button')].some(b=>b.textContent==='Recover this version'));if(!section)return null;section.id='cleanup-adopt';return '#cleanup-adopt button'})()`), 'exact recoverable version');
        await b.point(selector); await until(() => b.evaluate('!document.querySelector("#version-review").open'), 'explicit adoption');
        assert.equal(await field(b), 'Unsaved adopted writing');
        const descendant = (await scoped(b)).find(row => row.writerId !== original.writerId); assert.ok(descendant);
        await replace(b, 'Explicitly adopted and acknowledged');
        await until(async () => (await privateState()).draft.body === 'Explicitly adopted and acknowledged' && !(await scoped(b)).length, 'descendant acknowledged and retired');
        const history = (await rows(b)).find(row => row.id === original.id);
        assert.equal(history.active, 0); assert.equal(history.superseded_by, descendant.writerId);
        assert.deepEqual(history.snapshot, original.snapshot, 'original sealed contents remain exact');
        const locks = await b.evaluate('(await navigator.locks.query()).held.map(l=>l.name)');
        assert.ok(locks.some(name => name.includes(original.writerId)), 'source lock lasts after descendant cleanup');
        assert.ok(locks.some(name => name.includes(descendant.writerId)), 'own lock lasts after cleanup');
        const c = await page('cleanup-adopt-c', null, true); await c.open(1);
        assert.equal((await scoped(c)).length, 0, 'C sees neither a resurrected A nor the removed B');
        assert.deepEqual((await rows(c)).find(row => row.id === original.id), history);
        assert.deepEqual(b.errors, []); assert.deepEqual(c.errors, []);
      });

      await check('cleanup closed acknowledged candidate retires but live writer is neither disclosed nor deleted', async () => {
        const a = await page('cleanup-closed-a', null, true); await a.open(1);
        a.intercept(payload => payload?.name === 'editor_state');
        await replace(a, 'Closed acknowledged recovery');
        await until(async () => (await privateState()).draft?.body === 'Closed acknowledged recovery', 'real private save');
        await until(() => a.held.length, 'cleanup canonical read held');
        const original = (await scoped(a))[0]; assert.ok(original);
        const b = await page('cleanup-closed-b', null, true); await b.open(1);
        await until(() => b.evaluate('!document.querySelector("#review-versions").hidden'), 'live writer review');
        await b.point('#review-versions');
        await until(() => b.evaluate('document.querySelector("#review-content").textContent.includes("Open in another tab")'), 'live writer boundary');
        assert.equal(await b.evaluate('[...document.querySelectorAll("#review-content button")].some(b=>b.textContent==="Recover this version")'), false, 'no adoptable live version disclosed');
        assert.deepEqual((await rows(b)).find(row => row.id === original.id), original);
        await a.close(); await b.point('#review-retry');
        await until(async () => !(await rows(b)).some(row => row.id === original.id), 'closed fully acknowledged candidate retired');
        const locks = await b.evaluate('(await navigator.locks.query()).held.map(l=>l.name)');
        assert.equal(locks.some(name => name.includes(original.writerId)), false, 'a retired writer\'s lock is released after its cleanup');
        assert.deepEqual(b.errors, []);
      });

      await check('cleanup strict IDB retirement refuses changed stamps forged scope sealed rows and aborts atomically', async () => {
        const a = await page('cleanup-transaction');
        const oldStamp = await a.evaluate('j.save(snapshot)');
        const original = await a.evaluate('(async()=>{await j.save(snapshot);return j.own(editor.key)})()');
        await a.evaluate(`j.removeExact(editor.key,${JSON.stringify(oldStamp)})`);
        assert.deepEqual(await a.evaluate('j.own(editor.key)'), original, 'old own stamp cannot retire newer row');
        await a.close(); const b = await page('cleanup-transaction');
        const candidate = JSON.stringify(original);
        await b.evaluate(`putRow({...${candidate},scope:JSON.stringify([context.instanceId,'foreign'])})`);
        assert.equal(await b.evaluate(`j.retireAcknowledged(editor.key,${candidate},async()=>true)`), false, 'forged scope cannot retire');
        await b.evaluate(`putRow({...${candidate},active:0,superseded_by:'descendant'})`);
        assert.equal(await b.evaluate(`j.retireAcknowledged(editor.key,${candidate},async()=>true)`), false, 'sealed source cannot retire');
        await b.evaluate(`putRow(${candidate})`);
        assert.equal(await b.evaluate(`j.retireAcknowledged(editor.key,${candidate},async row=>{await putRow({...row,stamp:'newer-stamp'});return true})`), false, 'stamp changed during confirmation survives');
        assert.equal((await b.evaluate(`readRow(${JSON.stringify(original.id)})`)).stamp, 'newer-stamp');
        const lockHeld = async () => (await b.evaluate('(await navigator.locks.query()).held.map(l=>l.name)')).some(name => name.includes(original.writerId));
        assert.equal(await lockHeld(), false, 'a declined cleanup leaves the other writer\'s lock free');
        await b.evaluate(`putRow(${candidate})`);
        const overlap = await b.evaluate(`(async()=>{
          const locked=async()=>(await navigator.locks.query()).held.some(l=>l.name.includes(${JSON.stringify(original.writerId)}));
          let entered,open;const inside=new Promise(r=>entered=r),gate=new Promise(r=>open=r),seen=[];
          const first=j.retireAcknowledged(editor.key,${candidate},async()=>{seen.push(['first',await locked()]);entered();await gate;return false});
          await inside;
          const second=await j.retireAcknowledged(editor.key,${candidate},async()=>{seen.push(['second',await locked()]);return false});
          const midway=await locked(),listed=(await j.current(editor.key,[${JSON.stringify(original.id)}])).map(row=>row?.availability);open();
          return {seen,second,midway,listed,first:await first,after:await locked()};
        })()`);
        assert.deepEqual(overlap, { seen: [['first', true], ['second', true]], second: false, midway: true, listed: ['available'], first: false, after: false },
          'overlapping cleanups of one writer share its lock, which is released when the last ends');
        await b.evaluate('(()=>{window.cleanupDeleteSucceeded=0;window.originalDelete=IDBObjectStore.prototype.delete;IDBObjectStore.prototype.delete=function(...args){const request=originalDelete.apply(this,args),tx=this.transaction;request.addEventListener("success",()=>{++cleanupDeleteSucceeded;tx.abort()});return request}})()');
        const aborted = await b.evaluate(`j.retireAcknowledged(editor.key,${candidate},async()=>true).then(()=>false,()=>true)`);
        assert.equal(await b.evaluate('cleanupDeleteSucceeded'), 1, 'delete request succeeded before transaction abort');
        assert.equal(aborted, true); assert.deepEqual(await b.evaluate(`readRow(${JSON.stringify(original.id)})`), original, 'aborted delete preserves exact row');
        await b.evaluate('IDBObjectStore.prototype.delete=originalDelete');
        assert.equal(await b.evaluate(`j.retireAcknowledged(editor.key,${candidate},async()=>true)`), true, 'positive strict retirement');
        assert.equal(await b.evaluate(`readRow(${JSON.stringify(original.id)})`), null);
        assert.ok((await b.evaluate('durability')).every(tx => tx.requested === 'strict' && tx.actual === 'strict'));
        assert.equal(await lockHeld(), false, 'a retirement releases the other writer\'s lock');
        await b.evaluate(`putRow(${candidate})`);
        const kept = await b.evaluate(`(async()=>{
          let entered,open;const inside=new Promise(r=>entered=r),gate=new Promise(r=>open=r);
          const retire=j.retireAcknowledged(editor.key,${candidate},async()=>{entered();await gate;return true});
          await inside;
          const adopted=await j.adopt(editor.key,{id:${JSON.stringify(original.id)},stamp:${JSON.stringify(original.stamp)}});
          open();
          return {adopted:adopted?.writerId===j.writerId,retired:await retire};
        })()`);
        assert.deepEqual(kept, { adopted: true, retired: false }, 'an adoption during a cleanup wins, and the cleanup then refuses the moved row');
        assert.equal(await lockHeld(), true, 'an adopted source\'s lock is kept after the cleanup that shared it ends');
      });

      // A lock manager the test drives: a release completes only on flush(),
      // which first lets every queued microtask run,
      // hooks.defer(name) holds a request until deferred.get(name)() runs, and
      // hooks.granted(name) runs right after a grant's callback returns.
      const fakeLocks = `(()=>{
        const holders=new Set(),pending=[],deferred=new Map(),hooks={};
        const locks={
          request(name,options,callback){
            const decide=()=>{
              if(holders.has(name))return Promise.resolve(callback(null));
              holders.add(name);
              const value=callback({name,mode:'exclusive'});
              hooks.granted?.(name);
              return Promise.resolve(value).then(result=>new Promise(done=>pending.push(()=>{holders.delete(name);done(result);})));
            };
            if(hooks.defer?.(name))return new Promise(resolve=>deferred.set(name,()=>resolve(decide())));
            return decide();
          },
          query:async()=>({held:[...holders].map(name=>({name})),pending:[]}),
        };
        Object.defineProperty(navigator,'locks',{value:locks,configurable:true});
        return {holders,pending,deferred,hooks,flush:async()=>{await new Promise(r=>setTimeout(r));for(const release of pending.splice(0))release();}};
      })()`;

      await check('cleanup close ends every lock this document holds or was granted, and a refused cleanup lists the copy as another tab\'s', async () => {
        const source = async () => { const p = await page('cleanup-close'); await p.evaluate('j.save(snapshot)'); const row = await p.evaluate('j.own(editor.key)'); await p.close(); return row; };
        const first = await source(), second = await source(), third = await source(), fourth = await source(), fifth = await source();
        const b = await page('cleanup-close');
        const result = await b.evaluate(`(async()=>{
          const fake=${fakeLocks},open=()=>import('/journal.mjs').then(m=>m.openJournal({instanceId:context.instanceId,actor:context.actor}));
          const named=writer=>[...fake.holders].some(name=>name.includes(writer));
          const first=${JSON.stringify(first)},second=${JSON.stringify(second)},third=${JSON.stringify(third)},fourth=${JSON.stringify(fourth)},fifth=${JSON.stringify(fifth)},out={};
          // An adopted source and the document's own writer are ended by close.
          const k1=await open();
          await k1.adopt(editor.key,{id:first.id,stamp:first.stamp});
          out.adoptedHeld=named(first.writerId);
          k1.close();await fake.flush();
          out.afterClose=[named(k1.writerId),named(first.writerId)];
          // A cleanup's granted lease is ended by close while its confirmation is still out.
          const k2=await open();
          let entered,open2;const inside=new Promise(r=>entered=r),gate=new Promise(r=>open2=r);
          const retire=k2.retireAcknowledged(editor.key,second,async()=>{entered();await gate;return true}).then(v=>v,e=>'refused');
          await inside;
          k2.close();await fake.flush();
          out.cleanupHeldAfterClose=named(second.writerId);
          open2();out.retire=await retire;await fake.flush();
          // A lock granted just as the journal closes is released, not kept.
          const k3=await open();
          fake.hooks.granted=name=>{if(name.includes(second.writerId))k3.close();};
          out.adoptAsClosing=await k3.adopt(editor.key,{id:second.id,stamp:second.stamp}).then(()=>'adopted',e=>e.message);
          fake.hooks.granted=null;await fake.flush();
          out.heldAfterClosingAdoption=named(second.writerId);
          // While another tab holds the writer, a listing during this document's refused cleanup says so.
          const k4=await open();
          const other='aim-next-recovery-writer:'+JSON.stringify([context.instanceId,context.actor,second.writerId]);
          fake.holders.add(other);
          let arrived;const requested=new Promise(r=>arrived=r);
          fake.hooks.defer=name=>{if(name!==other)return false;arrived();return true;};
          const refused=k4.retireAcknowledged(editor.key,second,async()=>true);
          await requested;
          // The cleanup's request is answered one task after the listing's read
          // completes, so the listing is already asking about that writer.
          const realTransaction=IDBDatabase.prototype.transaction;let armed=true;
          IDBDatabase.prototype.transaction=function(...args){
            const tx=realTransaction.apply(this,args);
            if(armed&&args[1]==='readonly'){armed=false;tx.addEventListener('complete',()=>setTimeout(()=>fake.deferred.get(other)()));}
            return tx;
          };
          const listing=k4.current(editor.key,[second.id]);
          out.refused=await refused;
          out.listed=(await listing).map(row=>row?.availability);
          IDBDatabase.prototype.transaction=realTransaction;
          // A write transaction created just before close writes nothing,
          // because close has already ended the locks it was made under: a
          // cleanup's delete, an adoption, and the document's own save.
          fake.hooks.defer=null;await fake.flush();
          const closingAtWrite=k=>{let closing=true;IDBDatabase.prototype.transaction=function(...args){
            const tx=realTransaction.apply(this,args);
            // One microtask later: after each method's checks at creation.
            if(closing&&args[1]==='readwrite'){closing=false;queueMicrotask(()=>k.close());}
            return tx;
          };};
          const k5=await open();closingAtWrite(k5);
          out.retireQueuedAtClose=await k5.retireAcknowledged(editor.key,third,async()=>true).then(v=>v,e=>e.message);
          out.queuedRowKept=(await readRow(third.id))?.stamp===third.stamp;
          await fake.flush();
          const k6=await open();closingAtWrite(k6);
          out.adoptQueuedAtClose=await k6.adopt(editor.key,{id:fourth.id,stamp:fourth.stamp}).then(()=>'adopted',e=>e.message);
          const source4=await readRow(fourth.id);
          out.adoptSourceKept=source4?.stamp===fourth.stamp&&source4.active===1&&!source4.superseded_by;
          out.adoptedRowAbsent=!(await readRow(JSON.stringify([editor.key,k6.writerId])));
          await fake.flush();
          const k7=await open();closingAtWrite(k7);
          out.saveQueuedAtClose=await k7.save(snapshot).then(()=>'saved',e=>e.message);
          out.saveRowAbsent=!(await readRow(JSON.stringify([editor.key,k7.writerId])));
          IDBDatabase.prototype.transaction=realTransaction;
          // Close can also land between a write's first read and the read it
          // makes from that read's callback: an adoption's check for its own
          // row. That later callback writes nothing either.
          await fake.flush();
          const k8=await open(),realGet=IDBObjectStore.prototype.get;let reads=0;
          IDBObjectStore.prototype.get=function(...args){
            if(this.transaction.mode==='readwrite'&&++reads===2){IDBObjectStore.prototype.get=realGet;k8.close();}
            return realGet.apply(this,args);
          };
          out.adoptNestedAtClose=await k8.adopt(editor.key,{id:fifth.id,stamp:fifth.stamp}).then(()=>'adopted',e=>e.message);
          IDBObjectStore.prototype.get=realGet;
          out.nestedReads=reads;
          const source5=await readRow(fifth.id);
          out.nestedSourceKept=source5?.stamp===fifth.stamp&&source5.active===1&&!source5.superseded_by;
          out.nestedRowAbsent=!(await readRow(JSON.stringify([editor.key,k8.writerId])));
          return out;
        })()`);
        assert.deepEqual(result, { adoptedHeld: true, afterClose: [false, false], cleanupHeldAfterClose: false, retire: 'refused',
          adoptAsClosing: 'Open in another tab. Close that tab before retrying recovery.', heldAfterClosingAdoption: false, refused: false, listed: ['open-in-another-tab'],
          retireQueuedAtClose: 'Recovery storage is closed.', queuedRowKept: true,
          adoptQueuedAtClose: 'Recovery storage is closed.', adoptSourceKept: true, adoptedRowAbsent: true,
          saveQueuedAtClose: 'Recovery storage is closed.', saveRowAbsent: true,
          adoptNestedAtClose: 'Recovery storage is closed.', nestedReads: 2, nestedSourceKept: true, nestedRowAbsent: true });
      });

      await check('cleanup a writer this document just released is taken again, never refused by its own release', async () => {
        const a = await page('cleanup-relock');
        await a.evaluate('j.save(snapshot)');
        const original = await a.evaluate('j.own(editor.key)');
        await a.close(); const b = await page('cleanup-relock');
        const candidate = JSON.stringify(original);
        // A second journal over a lock manager that completes each release
        // only when the test lets it: one task after the next read-only
        // transaction completes, so all the work that read starts has run.
        const result = await b.evaluate(`(async()=>{
          const {pending}=${fakeLocks};
          const k=await (await import('/journal.mjs')).openJournal({instanceId:context.instanceId,actor:context.actor});
          let armed=false;const realTransaction=IDBDatabase.prototype.transaction;
          IDBDatabase.prototype.transaction=function(...args){
            const tx=realTransaction.apply(this,args);
            if(armed&&args[1]==='readonly'){armed=false;tx.addEventListener('complete',()=>setTimeout(()=>{for(const release of pending.splice(0))release();}));}
            return tx;
          };
          const out={};
          out.first=await k.retireAcknowledged(editor.key,${candidate},async()=>false);
          out.pendingRelease=pending.length;
          armed=true;let confirmed=false;
          out.second=await k.retireAcknowledged(editor.key,${candidate},async()=>{confirmed=true;return false});
          out.confirmed=confirmed;
          // A third declined cleanup leaves its own release pending for the adoption.
          armed=true;
          out.third=await k.retireAcknowledged(editor.key,${candidate},async()=>false);
          // Listing while that release is pending lists the copy as available here.
          armed=true;
          out.listed=(await k.current(editor.key,[${JSON.stringify(original.id)}])).map(row=>row?.availability);
          out.fourth=await k.retireAcknowledged(editor.key,${candidate},async()=>false);
          out.pendingBeforeAdoption=pending.length;
          armed=true;
          out.adopted=await k.adopt(editor.key,{id:${JSON.stringify(original.id)},stamp:${JSON.stringify(original.stamp)}}).then(row=>row.writerId===k.writerId,error=>error.message);
          IDBDatabase.prototype.transaction=realTransaction;
          return out;
        })()`);
        assert.deepEqual(result, { first: false, pendingRelease: 1, second: false, confirmed: true, third: false, listed: ['available'], fourth: false, pendingBeforeAdoption: 1, adopted: true },
          'a cleanup or adoption right after this document released the writer waits for that release, not refused as another tab');
      });
    } else if (mode === '--correction') {
      const sourceText = p => p.evaluate('document.querySelector("#source-body").textContent');
      const observeCalls = async p => {
        const modules = await p.evaluate(`(async()=>{
          const registryURL=new URL('./app-session.mjs',location.href),apiURL=new URL('./api.mjs',location.href);
          if(registryURL.search || apiURL.search)throw Error('Observer module identity has a query string');
          const {EditorRegistry}=await import(registryURL.href),{Api}=await import(apiURL.href);
          window.fixtureCalls=[];let serial=0;
          const wrap=(prototype,method,reference)=>{
            const original=prototype[method];
            prototype[method]=function(...args){
              const call={id:++serial,method,source_ref:structuredClone(reference(args)),settled:false};
              fixtureCalls.push(call);
              const promise=original.apply(this,args);
              const reaction=promise.then(()=>{call.outcome='fulfilled'},error=>{call.outcome='rejected';call.error=error.message});
              call.observed=reaction.then(()=>{call.settled=true});
              return promise;
            };
          };
          wrap(EditorRegistry.prototype,'open',args=>args[0]);
          wrap(EditorRegistry.prototype,'neighbors',args=>args[0].source.source_ref);
          wrap(Api.prototype,'media',args=>args[2]);
          return {registry:registryURL.href,api:apiURL.href};
        })()`);
        observations.push({ observerModules: modules });
      };
      const callState = (p, id) => p.evaluate(`(()=>{const c=fixtureCalls.find(c=>c.id===${id});return c?{id:c.id,method:c.method,source_ref:c.source_ref,settled:c.settled,outcome:c.outcome??null,error:c.error??null}:null})()`);
      const started = async (p, method, source, after = 0) => {
        const call = await until(() => p.evaluate(`(()=>{const c=fixtureCalls.find(c=>c.id>${after}&&c.method===${JSON.stringify(method)}&&JSON.stringify(c.source_ref)===${JSON.stringify(JSON.stringify(source))});return c?{id:c.id,method:c.method,source_ref:c.source_ref}:null})()`), 'application own ' + method + ' call');
        assert.equal(call.method, method); assert.deepEqual(call.source_ref, source, 'observer records the native application call and exact source');
        return call;
      };
      const settled = async (p, call) => {
        const state = await until(async () => { const state = await callState(p, call.id); return state?.settled ? state : null; }, 'exact application ' + call.method + ' settlement');
        assert.equal(state.id, call.id); assert.equal(state.method, call.method); assert.deepEqual(state.source_ref, call.source_ref);
        assert.equal(state.outcome, 'fulfilled', 'successful fixture call settles normally');
        observations.push({ settledApplicationCall: state });
        return state;
      };
      const noticeState = p => p.evaluate("({hidden:document.querySelector('#reader-notice').hidden,text:document.querySelector('#reader-notice').textContent})");
      const arrowState = p => p.evaluate("({previous:document.querySelector('#previous-message').disabled,next:document.querySelector('#next-message').disabled})");
      const imageLink = '#source-attachments a[download="passive.png"]';
      const openAttachment = async (p, name) => {
        const selector = await p.evaluate(`(()=>{const b=[...document.querySelectorAll('#source-attachments button')].find(e=>e.textContent===${JSON.stringify('Open ' + name)});if(!b)return null;b.id='open-fixture-attachment';return '#open-fixture-attachment'})()`);
        assert.ok(selector, 'named attachment discoverable'); await p.point(selector);
      };
      const observeURLs = p => p.evaluate(`(()=>{window.fixtureURLs=[];const create=URL.createObjectURL;URL.createObjectURL=function(blob){const url=create.call(this,blob);fixtureURLs.push({url,type:blob.type});return url}})()`);
      const readable = async (p, url) => {
        // A separate same-origin probe document bypasses CSP before navigation.
        // The application and the download-navigation proof keep their CSP.
        const { targetId } = await cdp('Target.createTarget', { url: 'about:blank' }); pages.add(targetId);
        const { sessionId } = await cdp('Target.attachToTarget', { targetId, flatten: true });
        const inspect = async expression => (await cdp('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }, sessionId)).result.value;
        try {
          await cdp('Page.enable', {}, sessionId); await cdp('Page.setBypassCSP', { enabled: true }, sessionId);
          await cdp('Page.navigate', { url: facts.origin + '/journal.mjs' }, sessionId);
          await until(() => inspect(`location.href===${JSON.stringify(facts.origin + '/journal.mjs')} && document.readyState==='complete'`), 'same-origin URL probe loaded');
          return await inspect(`fetch(${JSON.stringify(url)}).then(r=>r.ok,()=>false)`);
        } finally { await cdp('Target.closeTarget', { targetId }); pages.delete(targetId); }
      };
      // Source 1 answers Source 0, so the page shows it under Source 0 in that
      // stack (docs/reply-stacks.md): the Reader's ↓ (#previous-message, the
      // message below) steps from Source 0 to Source 1, and ↑ (#next-message) back.
      const arrowReady = p => until(() => p.evaluate('!document.querySelector("#previous-message").disabled'), 'neighbor arrow ready');
      // also: other answers the case holds while the step waits.
      const newHeldStep = async (p, also = () => false) => {
        await arrowReady(p);
        const before = p.held.length, step = payload => payload?.name === 'source' && payload.args.id === facts.sources[1].id;
        p.intercept(payload => also(payload) || step(payload));
        await p.point('#previous-message');
        return until(() => p.held.slice(before).find(entry => step(entry.payload)), 'held neighboring source');
      };
      // A held private save keeps the device copy unacknowledged, so cleanup
      // (30186fc) cannot retire it before the case reads it.
      const privateSave = payload => payload?.kind === 'draft.save';
      const localRows = p => p.evaluate(`new Promise((resolve,reject)=>{const r=indexedDB.open('aim-next-pending');r.onerror=()=>reject(r.error);r.onsuccess=()=>{const db=r.result,tx=db.transaction('editors');tx.objectStore('editors').getAll().onsuccess=e=>resolve(e.target.result);tx.oncomplete=()=>db.close()}})`);
      // The Reader's own writing stays editable while a step waits: the person
      // types after the step is held, so Close, Escape, Topic and a refused
      // close are judged on writing only those acts could have kept.

      await check('correction source controls survive mode and quote without redrawing the source', async () => {
        const p = await page('mode-controls', null, true);
        await observeCalls(p);
        p.intercept(payload => payload?.name === 'topic_messages' && payload.args.audience === 'reader');
        await p.open(0); await until(() => p.held.length === 2, 'both neighbor responses held');
        await settled(p, await started(p, 'open', facts.sources[0]));
        const neighborCall = await started(p, 'neighbors', facts.sources[0]), xCursor = p.held[0].payload.args.cursor;
        const xNeighborReads = () => p.calls.filter(call => call.payload?.name === 'topic_messages' && call.payload.args.audience === 'reader' && call.payload.args.cursor === xCursor).length;
        await p.evaluate("(()=>{window.fixtureSourceNode=document.querySelector('#source-body').firstChild;document.querySelector('#source-body').scrollTop=180})()");
        await p.point('#toggle-note'); await p.point('#toggle-note');
        assert.deepEqual(await noticeState(p), { hidden: true, text: '' }, 'ordinary mode changes report no cancelled navigation');
        const place = await p.evaluate("({scroll:document.querySelector('#source-body').scrollTop,focus:document.activeElement.id,height:document.querySelector('#writing-body').getBoundingClientRect().height})");
        p.intercept(null); for (const held of p.held) await p.release(held);
        await settled(p, neighborCall);
        assert.deepEqual(await p.evaluate("({previous:document.querySelector('#previous-message').disabled,next:document.querySelector('#next-message').disabled})"), { previous: false, next: true }, 'resolved arrows survive the mode switch: ↓ to Source 1, nothing above');
        await observeURLs(p); await openAttachment(p, 'passive.png');
        await settled(p, await started(p, 'media', facts.sources[0]));
        await until(() => p.evaluate('fixtureURLs.length === 1'), 'verified image Blob created');
        assert.ok(await p.evaluate(`Boolean(document.querySelector(${JSON.stringify(imageLink)}))`), 'named image download survives the mode switch');
        await until(() => p.evaluate('document.querySelector("#source-attachments img")?.naturalWidth > 0'), 'actual decoded PNG');
        assert.equal(await p.evaluate("document.querySelector('#source-body').firstChild===fixtureSourceNode"), true);
        assert.deepEqual(await p.evaluate("({scroll:document.querySelector('#source-body').scrollTop,focus:document.activeElement.id,height:document.querySelector('#writing-body').getBoundingClientRect().height})"), { ...place, focus: '' }, 'media does not redraw source or writing space');
        await p.point('#previous-message');
        await until(async () => (await sourceText(p)).startsWith('Source 1 '), 'exact next source');
        await settled(p, await started(p, 'open', facts.sources[1]));
        assert.equal(xNeighborReads(), 2, 'Next reuses the exact resolved X neighbor pair');
        observations.push({ xCursor, xNeighborReadCount: xNeighborReads() });
        assert.equal(await field(p), (await privateState()).draft?.body ?? '', 'neighbor has its own draft');
        await p.point('#reader-close'); await until(() => p.evaluate('!document.querySelector("#reader").open'), 'closed neighbor');
        await p.open(0); await p.point('#toggle-note');
        await p.evaluate("document.querySelector('#source-body').scrollTop=0");
        await p.point('#source-body [data-start="0"]'); await p.key('Enter');
        assert.ok((await field(p)).endsWith('> Source 0 exact passage. \n\n'), 'note quote enters this source reply');
        await openAttachment(p, 'passive.png');
        await until(() => p.evaluate('fixtureURLs.length === 2'), 'quoted source image Blob created');
        assert.ok(await p.evaluate(`Boolean(document.querySelector(${JSON.stringify(imageLink)}))`), 'named download after quote from note');
        await until(() => p.evaluate('document.querySelector("#source-attachments img")?.naturalWidth > 0'), 'decoded PNG after quote');
        assert.deepEqual(p.errors, []);
      });

      await check('correction newer mode and quote visibly cancel a held step', async () => {
        for (const action of ['mode', 'quote']) {
          const p = await page('cancel-' + action, null, true); await p.open(0);
          if (action === 'quote') {
            await p.point('#toggle-note');
            assert.deepEqual(await noticeState(p), { hidden: true, text: '' }, 'ordinary note mode reports no cancelled navigation');
          }
          const held = await newHeldStep(p);
          if (action === 'mode') await p.point('#toggle-note');
          else { await p.point('#source-body [data-start="0"]'); await p.key('Enter'); }
          assert.match(await p.evaluate('document.querySelector("#reader-notice").textContent'), /opening the other message was cancelled/, 'newer mode choice visibly cancels navigation');
          await p.release(held);
          assert.ok((await sourceText(p)).startsWith('Source 0 '));
          assert.equal(await p.evaluate('document.querySelector("#toggle-note").textContent'), action === 'mode' ? 'Back to reply' : 'Add note');
          if (action === 'quote') assert.ok((await field(p)).endsWith('> Source 0 exact passage. \n\n'));
          assert.deepEqual(p.errors, []); await p.close();
        }
      });

      await check('correction held Y rejects X neighbors and media then mode cancellation restores X', async () => {
        const p = await page('held-y', null, true); await observeCalls(p);
        // The right rail's thumbnails read media too; they are in before the page's reads are held (things-rail.mjs).
        await until(() => p.evaluate('document.body.dataset.ready==="true" && !document.documentElement.hasAttribute("data-rails-reading")'), 'the rails have read');
        let neighborsHeld = 0, mediaHeld = false;
        p.intercept((payload, event) => {
          if (payload?.name === 'topic_messages' && payload.args.audience === 'reader' && neighborsHeld < 2) { ++neighborsHeld; return true; }
          if (event.request.url.endsWith('/api/media/read') && !mediaHeld) { mediaHeld = true; return true; }
          return payload?.name === 'source' && payload.args.id === facts.sources[1].id;
        });
        await p.open(0); await settled(p, await started(p, 'open', facts.sources[0]));
        await until(() => p.held.length === 2, 'initial X pair held');
        const pair = [...p.held], neighbors = await started(p, 'neighbors', facts.sources[0]);
        await observeURLs(p); await openAttachment(p, 'passive.png');
        const media = await started(p, 'media', facts.sources[0]);
        const mediaResponse = await until(() => p.held.find(entry => entry.event.request.url.endsWith('/api/media/read')), 'X media held');
        await p.point('#source-body'); await p.key('ArrowDown', 4);
        const heldY = await until(() => p.held.find(entry => entry.payload?.name === 'source'), 'Y source held');
        const openingY = await started(p, 'open', facts.sources[1]);
        assert.equal((await callState(p, openingY.id)).settled, false);
        const visible = () => p.evaluate("({source:document.querySelector('#source-body').textContent,body:document.querySelector('#writing-body').value,focus:document.activeElement.id,notice:document.querySelector('#reader-notice').textContent})");
        const before = await visible();
        for (const entry of pair) await p.release(entry);
        await settled(p, neighbors);
        // The verified bytes reached the application's own consumer (the call
        // settled fulfilled). Since 3270cbe a stale answer is refused before
        // it becomes an object URL; whatever URL a stale answer made must
        // never stay readable.
        await p.release(mediaResponse); await settled(p, media);
        const rejectedURLs = await p.evaluate('fixtureURLs.map(entry=>entry.url)');
        const consumers = { arrows: await arrowState(p),
          images: await p.evaluate('document.querySelectorAll("#source-attachments img").length'),
          downloads: await p.evaluate('document.querySelectorAll("#source-attachments a").length'),
          readableURLs: (await Promise.all(rejectedURLs.map(url => readable(p, url)))).filter(Boolean).length };
        observations.push({ heldYConsumers: consumers, rejectedURLs: rejectedURLs.length, heldOpen: await callState(p, openingY.id) });
        assert.equal((await callState(p, openingY.id)).settled, false, 'Y remains held during both X consumer assertions');
        assert.deepEqual(consumers, { arrows: { previous: true, next: true }, images: 0, downloads: 0, readableURLs: 0 }, 'held Y rejects both X consumers');
        assert.deepEqual(await visible(), before, 'discarded X results leave writing/source/focus/notice intact');
        await p.point('#toggle-note');
        observations.push({ postCancellationArrows: await arrowState(p) });
        assert.match((await noticeState(p)).text, /opening the other message was cancelled/);
        await openAttachment(p, 'passive.png');
        const retried = await started(p, 'media', facts.sources[0], media.id); await settled(p, retried);
        await until(() => p.evaluate('document.querySelector("#source-attachments img")?.naturalWidth>0'), 'fresh X PNG accepted after cancellation');
        const acceptedURL = await p.evaluate(`document.querySelector(${JSON.stringify(imageLink)}).href`);
        assert.equal(await readable(p, acceptedURL), true, 'positive live URL after X restoration');
        for (const url of rejectedURLs) assert.equal(await readable(p, url), false, 'earlier rejected URL stays revoked');
        assert.equal((await callState(p, openingY.id)).settled, false, 'old Y stays held while restored X media is accepted');
        await p.release(heldY); await settled(p, openingY);
        assert.ok((await sourceText(p)).startsWith('Source 0 '), 'cancelled Y cannot replace restored X');
        assert.equal(await p.evaluate('document.querySelector("#toggle-note").textContent'), 'Back to reply');
        assert.deepEqual(p.errors, []);
      });

      await check('correction stale media is discarded and displayed object URLs are revoked', async () => {
        const p = await page('media-lifetime', null, true); await observeCalls(p); await p.open(0); await observeURLs(p); await arrowReady(p);
        p.intercept((_payload, event) => event.request.url.endsWith('/api/media/read'));
        await openAttachment(p, 'passive.png'); const held = await until(() => p.held[0], 'held media bytes');
        const media = await started(p, 'media', facts.sources[0]);
        await p.point('#previous-message'); await until(async () => (await sourceText(p)).startsWith('Source 1 '), 'new source before old media');
        const before = await p.evaluate("({body:document.querySelector('#writing-body').value,focus:document.activeElement.id,notice:document.querySelector('#reader-notice').textContent})");
        // The stale verified answer reaches the application's consumer; since
        // 3270cbe it is refused before it becomes an object URL, and any URL a
        // stale answer made must not stay readable.
        await p.release(held); await settled(p, media);
        for (const url of await p.evaluate('fixtureURLs.map(entry=>entry.url)')) assert.equal(await readable(p, url), false, 'discarded source URL is revoked');
        assert.equal(await p.evaluate('document.querySelectorAll("#source-attachments img").length'), 0);
        assert.equal(await p.evaluate('document.querySelectorAll("#source-attachments a").length'), 0, 'no download is offered for the stale answer');
        assert.deepEqual(await p.evaluate("({body:document.querySelector('#writing-body').value,focus:document.activeElement.id,notice:document.querySelector('#reader-notice').textContent})"), before);
        await p.point('#reader-close'); await until(() => p.evaluate('!document.querySelector("#reader").open'), 'close Y');
        p.intercept(null); await p.open(0); await openAttachment(p, 'passive.png');
        await until(() => p.evaluate(`Boolean(document.querySelector(${JSON.stringify(imageLink)}))`), 'current download link');
        const displayed = await p.evaluate(`document.querySelector(${JSON.stringify(imageLink)}).href`);
        assert.equal(await readable(p, displayed), true, 'positive current URL control');
        await p.point('#reader-close'); await until(() => p.evaluate('!document.querySelector("#reader").open'), 'close displayed media');
        assert.equal(await readable(p, displayed), false, 'closed source URL is revoked'); assert.deepEqual(p.errors, []);
      });

      await check('correction explicit Close Escape and Topic cancel pending navigation with preserved writing', async () => {
        for (const action of ['Close', 'Escape', 'Topic']) {
          const p = await page('close-' + action, null, true); await p.open(0);
          const body = 'Writing while navigation waits: ' + action;
          const held = await newHeldStep(p, privateSave);
          await replace(p, body);
          const keptX = rows => rows.some(row => row.snapshot.draft.body === body && row.snapshot.context.sourceRef.id === facts.sources[0].id);
          await until(async () => keptX(await localRows(p)), 'typing while the step waits is kept on this device as it lands');
          assert.deepEqual(await p.evaluate('({send:document.querySelector("#send-reply").disabled,image:document.querySelector("#add-image").disabled})'), { send: true, image: true }, 'sending and images wait for the step');
          // A caret moved without typing is no edit, so nothing keeps it until
          // the close does: what the device holds afterwards is the close's own.
          for (let n = 0; n < 3; n++) await p.key('ArrowLeft');
          const moved = { start: body.length - 3, end: body.length - 3 };
          assert.deepEqual(await p.evaluate("(f=>({start:f.selectionStart,end:f.selectionEnd}))(document.querySelector('#writing-body'))"), moved, 'native caret move instrument');
          const keptCaret = rows => rows.find(row => row.snapshot.draft.body === body && row.snapshot.context.sourceRef.id === facts.sources[0].id)?.snapshot.draft.caret;
          assert.notDeepEqual(keptCaret(await localRows(p)), moved, 'the moved caret is not on the device before the close');
          if (action === 'Escape') await p.key('Escape'); else await p.point(action === 'Topic' ? '#reader-parent' : '#reader-close');
          await until(() => p.evaluate('!document.querySelector("#reader").open'), 'explicit close completes before network');
          assert.equal(await p.evaluate('document.activeElement.dataset.id'), facts.sources[0].id, 'connected opener restored');
          assert.ok(keptX(await localRows(p)), 'newest exact X writing is durable locally');
          assert.deepEqual(keptCaret(await localRows(p)), moved, 'the close itself kept the writing as it stands');
          await p.release(held);
          assert.equal(await p.evaluate('document.querySelector("#reader").open'), false, 'cancelled Y cannot reappear');
          assert.equal(await p.evaluate('document.activeElement.dataset.id'), facts.sources[0].id);
          observations.push({ action, body, localPreserved: true }); assert.deepEqual(p.errors, []); await p.close();
        }
      });

      await check('correction refused local close cancels old navigation and allows a fresh step', async () => {
        const p = await page('failed-close', null, true); await p.open(0);
        const held = await newHeldStep(p, privateSave);
        await p.evaluate(`(()=>{window.fixtureTransaction=IDBDatabase.prototype.transaction;IDBDatabase.prototype.transaction=function(...args){if(args[1]==='readwrite')throw new DOMException('Fixture quota failure','QuotaExceededError');return fixtureTransaction.apply(this,args)}})()`);
        await replace(p, 'Failed close remains editable'); await p.point('#reader-close');
        await until(() => p.evaluate('document.querySelector("#save-state").textContent.includes("Recovery copy unavailable")'), 'visible local preservation failure');
        await until(() => p.evaluate('document.querySelector("#reader-notice").textContent === "Not closed: this device could not keep your writing. It stays here; keep this page open."'), 'the refused close says why');
        assert.equal(await p.evaluate('document.querySelector("#reader").open'), true);
        assert.equal(await field(p), 'Failed close remains editable');
        await p.release(held);
        assert.ok((await sourceText(p)).startsWith('Source 0 '), 'cancelled navigation stays cancelled after failed close');
        assert.equal(await p.evaluate('document.querySelector("#writing-body").readOnly'), false);
        await p.evaluate('IDBDatabase.prototype.transaction=fixtureTransaction'); p.intercept(null);
        await replace(p, 'Recovered local persistence'); await p.point('#previous-message');
        await until(async () => (await sourceText(p)).startsWith('Source 1 '), 'fresh step after restored persistence'); assert.deepEqual(p.errors, []);
      });

      // Close keeps the writing on this device before the Reader goes. While
      // that save is held the field takes no typing, so when later device
      // saves fail the Reader still closes only over writing the device holds.
      await check('correction typing waits while Close keeps the writing, and the closed Reader leaves nothing unkept', async () => {
        const p = await page('close-held-keep', null, true); await p.open(0);
        p.intercept(privateSave);
        await replace(p, 'Kept before Close');
        await until(() => p.evaluate('document.querySelector("#save-state").textContent.startsWith("Saved on this device")'), 'the device holds the writing');
        // The next device save, Close's own, waits for the case; every save
        // after it fails, as a device that has just run out of room would.
        await p.evaluate(`import(new URL('./app-session.mjs',location.href).href).then(({EditorRegistry})=>{
          let release;window.closeHold={puts:0,entered:false,released:new Promise(r=>release=r)};window.closeHold.release=release;
          const close=EditorRegistry.prototype.close;
          EditorRegistry.prototype.close=function(...args){
            const hold=window.closeHold;
            if(!hold.armed){hold.armed=true;hold.writer=this.journal.writerId;const backend=this.journal.backend,put=backend.put;hold.restore=()=>{backend.put=put;};
              backend.put=async(row,guard)=>{if(++hold.puts===1){hold.entered=true;await hold.released;return put(row,guard);}throw new DOMException('Fixture quota failure','QuotaExceededError');};}
            return close.apply(this,args);
          };
        })`);
        await p.point('#reader-close');
        await until(() => p.evaluate('window.closeHold.entered'), 'Close keeps the writing on this device');
        assert.equal(await p.evaluate('document.querySelector("#writing-body").readOnly'), true, 'the field takes no typing while Close keeps the writing');
        assert.deepEqual(await p.evaluate('(s=>[s.textContent,s.dataset.save])(document.querySelector("#save-state"))'), ['Closing — saving on this device…', 'saving'], 'the saving sign says Close is keeping the writing');
        await p.point('#writing-body'); await p.send('Input.insertText', { text: ' typed during Close' });
        const shown = await field(p);
        await p.evaluate('window.closeHold.release()');
        await until(() => p.evaluate('!document.querySelector("#reader").open'), 'Close completes once the device keeps the writing');
        await p.evaluate('window.closeHold.restore()');
        // This page's own row: pages before it left rows for the same message.
        const writer = await p.evaluate('window.closeHold.writer');
        assert.equal(typeof writer, 'string', 'the page that closed is known by its writer');
        const kept = (await localRows(p)).find(row => row.writerId === writer && row.snapshot.context.sourceRef.id === facts.sources[0].id && row.snapshot.context.kind === 'reply');
        assert.equal(kept?.snapshot.draft.body, shown, 'the device holds what the Reader held when it closed');
        assert.equal(shown, 'Kept before Close');
        p.intercept(null); for (const held of p.held) await p.release(held);
        assert.deepEqual(p.errors, []);
      });

      // The held private save keeps the writing off Theseus, so the device is
      // its only keeper: a step that cannot keep it there does not replace it.
      await check('correction a step that cannot keep writing typed while it waited stays on the Reader and says why', async () => {
        const p = await page('failed-step', null, true); await p.open(0);
        const held = await newHeldStep(p, privateSave);
        await p.evaluate(`(()=>{window.fixtureTransaction=IDBDatabase.prototype.transaction;IDBDatabase.prototype.transaction=function(...args){if(args[1]==='readwrite')throw new DOMException('Fixture quota failure','QuotaExceededError');return fixtureTransaction.apply(this,args)}})()`);
        const body = 'Typed while the step could not keep it';
        await replace(p, body);
        await until(() => p.evaluate('document.querySelector("#save-state").textContent.includes("Recovery copy unavailable")'), 'visible local preservation failure');
        await p.release(held);
        await until(() => p.evaluate('document.querySelector("#reader-notice").textContent === "Not opened: this device could not keep your writing. It stays here; keep this page open."'), 'the refused step says why');
        assert.ok((await sourceText(p)).startsWith('Source 0 '), 'the step did not replace the Reader');
        assert.equal(await field(p), body);
        assert.equal(await p.evaluate('document.querySelector("#writing-body").readOnly'), false, 'the Reader takes typing again');
        assert.ok((await p.evaluate('document.querySelector("#save-state").textContent')).includes('Recovery copy unavailable'), 'the warning stays with the writing');
        await p.evaluate('IDBDatabase.prototype.transaction=fixtureTransaction'); p.intercept(null);
        await p.point('#previous-message');
        await until(async () => (await sourceText(p)).startsWith('Source 1 '), 'a fresh step once the device keeps writing');
        assert.ok((await localRows(p)).some(row => row.snapshot.draft.body === body && row.snapshot.context.sourceRef.id === facts.sources[0].id), 'the writing the step left is kept on this device');
        assert.deepEqual(p.errors, []);
      });

      await check('correction download navigation completes exact HTML and SVG downloads', async () => {
        const p = await page('downloads', null, true); await p.open(0);
        await cdp('Browser.setDownloadBehavior', { behavior: 'allowAndName', downloadPath, eventsEnabled: true });
        await cdp('Target.setDiscoverTargets', { discover: true });
        for (const item of facts.media.filter(item => item.content_type !== 'image/png')) {
          await openAttachment(p, item.name);
          const selector = `#source-attachments a[download="${item.name}"]`;
          await until(() => p.evaluate(`Boolean(document.querySelector(${JSON.stringify(selector)}))`), 'verified named download');
          const url = await p.evaluate(`document.querySelector(${JSON.stringify(selector)}).href`), start = browserEvents.length;
          await p.evaluate(`window.open(${JSON.stringify(url)},'_blank') !== null`);
          const observed = await until(() => {
            const events = browserEvents.slice(start);
            const download = events.find(e => e.method === 'Browser.downloadWillBegin' && e.params.url === url);
            const target = events.find(e => ['Target.targetCreated', 'Target.targetInfoChanged'].includes(e.method) && e.params.targetInfo.type === 'page' && e.params.targetInfo.url === url);
            return download ? { download } : target ? { target } : null;
          }, 'download or new target');
          // A new target can precede downloadWillBegin. If it renders instead,
          // retain a positive wrong-MIME control with the actual fixture DOM.
          let begin = observed.download;
          if (!begin) {
            const targetId = observed.target.params.targetInfo.targetId; pages.add(targetId);
            const { sessionId } = await cdp('Target.attachToTarget', { targetId, flatten: true });
            await cdp('Page.enable', {}, sessionId);
            const state = await until(async () => {
              begin = browserEvents.slice(start).find(e => e.method === 'Browser.downloadWillBegin' && e.params.url === url);
              if (begin) return { download: true };
              const r = await cdp('Runtime.evaluate', { expression: `document.readyState==='complete' && document.URL===${JSON.stringify(url)} ? ({url:document.URL,type:document.contentType,title:document.title,root:document.documentElement.localName,marker:document.querySelector('#fixture-marker')?.textContent}) : null`, returnByValue: true }, sessionId);
              return r.result.value;
            }, 'new target finished loading or began download');
            if (!state.download) {
              observations.push({ wrongMimeRendered: state, attachment: item.name });
              assert.equal(state.marker, item.name.endsWith('.html') ? 'Download HTML marker' : 'Download SVG marker', 'wrong-MIME positive rendering control');
              assert.fail('Download-only URL rendered participant markup');
            }
          }
          const done = await until(() => browserEvents.slice(start).find(e => e.method === 'Browser.downloadProgress' && e.params.guid === begin.params.guid && ['completed', 'canceled'].includes(e.params.state)), 'download completion');
          assert.equal(done.params.state, 'completed');
          const bytes = await readFile(path.join(downloadPath, begin.params.guid)), digest = createHash('sha256').update(bytes).digest('hex');
          assert.equal(digest, item.sha256, 'downloaded exact canonical bytes');
          observations.push({ attachment: item.name, begin: begin.params, done: done.params, sha256: digest });
        }
        assert.deepEqual(p.errors, []);
      });
    }
    await check('connected quote, newline, private note, focus, autosave geometry and touch boundary', async () => {
      // CSS-pixel rounding allowance, far below the 40px drag expansion.
      const geometryTolerance = 2, minimumDragExpansion = 40, minimumWideHeightShare = .94;
      const p = await page('connected', null, true); await p.open(1);
      assert.ok((await p.evaluate('document.querySelector("#source-body").textContent')).length > 1024);
      await p.point('#source-body [data-start="0"]', 'move'); await p.key('Enter');
      assert.equal(await field(p), '> Source 1 exact passage. \n\n');
      assert.equal(await p.evaluate('document.querySelector("#reader").dataset.layout'), 'wide', 'quoting on a laptop opens the wide Reader');
      await p.send('Input.insertText', { text: 'Connected response' }); await p.key('Enter');
      assert.equal(await field(p), '> Source 1 exact passage. \n\nConnected response\n');
      assert.equal(p.calls.filter(call => call.payload?.kind === 'message.send').length, 0);
      await until(async () => (await privateState()).draft?.body === await field(p), 'actual draft save');
      assert.equal(await p.evaluate('document.querySelector("#save-state").textContent'), 'Saved to Theseus');
      const reply = await field(p);
      // Done on a note with nothing written has nothing to save: it goes back
      // to the reply, saying nothing, and sends no save.
      const noteSaves = () => p.calls.filter(call => call.payload?.kind === 'note.save').length, savesBefore = noteSaves();
      await p.point('#toggle-note');
      assert.deepEqual(await p.evaluate("[document.querySelector('#writing-body').value, document.querySelector('#send-reply').textContent]"), ['', 'Done'], 'a message with no note');
      await p.point('#send-reply');
      await until(() => p.evaluate("document.querySelector('#toggle-note').textContent === 'Add note'"), 'Done on an empty note goes back to the reply');
      assert.deepEqual(await p.evaluate("({notice:document.querySelector('#reader-notice').hidden?'':document.querySelector('#reader-notice').textContent,body:document.querySelector('#writing-body').value})"),
        { notice: '', body: reply }, 'back on the reply as it was, with no word of a failed save');
      assert.equal(noteSaves(), savesBefore, 'nothing was sent to save');
      await p.point('#toggle-note'); await p.send('Input.insertText', { text: 'Private native note' }); await p.key('Enter', 4);
      // A confirmed note leaves the Reader open, back on the reply as it was.
      await until(() => p.evaluate("document.querySelector('#toggle-note').textContent === 'Show note'"), 'confirmed note hands back to the reply');
      assert.equal((await privateState()).note.body, 'Private native note'); assert.equal((await privateState()).draft.body, reply);
      assert.deepEqual(await p.evaluate("({open:document.querySelector('#reader').open,active:document.activeElement.id,body:document.querySelector('#writing-body').value})"),
        { open: true, active: 'writing-body', body: reply }, 'the saved note keeps the Reader open on the reply');
      await p.point('#reader-close'); await until(() => p.evaluate('!document.querySelector("#reader").open'), 'reader closed');
      assert.equal(await p.evaluate('document.activeElement.dataset.id'), facts.sources[1].id);
      await p.open(1); assert.equal(await field(p), reply);
      // The earlier quote already made this laptop wide (644/668). Exercise
      // both menu directions from that state, keeping the saved reply.
      assert.equal(await p.evaluate('document.querySelector("#reader").dataset.layout'), 'wide', 'the quoted reply reopens wide');
      await p.point('#reader-menu');
      await until(() => p.evaluate(`document.querySelector('.message-menu-list [role=menuitem]:last-child')?.textContent === 'Stacked layout'`), "the wide Reader's menu offers Stacked");
      await p.point('.message-menu-list [role=menuitem]:last-child');
      await until(() => p.evaluate(`document.querySelector('#reader').dataset.layout === 'stacked'`), 'the Reader is stacked');
      assert.equal(await field(p), reply, 'switching to stacked keeps the reply');
      await p.point('#reader-menu');
      await until(() => p.evaluate(`document.querySelector('.message-menu-list [role=menuitem]:last-child')?.textContent === 'Wide layout'`), "the Reader's menu offers Wide");
      await p.point('.message-menu-list [role=menuitem]:last-child');
      await until(() => p.evaluate(`document.querySelector('#reader').dataset.layout === 'wide'`), 'the Reader is wide');
      assert.equal(await field(p), reply, 'switching back to wide keeps the reply');
      const wide = await p.box('.writing-pane'), dialog = await p.box('#reader');
      assert.ok(wide.height + geometryTolerance >= dialog.height * minimumWideHeightShare, 'writing keeps the full wide column');
      await p.point('#writing-body'); await p.send('Input.insertText', { text: ' Undo tail' });
      const withTail = await field(p);
      await until(async () => (await privateState()).draft.body === withTail, 'autosave of native edit');
      await p.key('z', 4); assert.equal(await field(p), reply, 'native Undo survives a real server acknowledgement');
      await p.evaluate("(()=>{const field=document.querySelector('#writing-body');field.setSelectionRange(2,8);document.querySelector('#source-body').scrollTop=350})()");
      const before = await p.evaluate("(()=>{const e=document.querySelector('#source-body');const r=document.createRange();r.setStart(e.children[4].firstChild,0);r.setEnd(e.children[5].firstChild,8);const s=getSelection();s.removeAllRanges();s.addRange(r);return {text:s.toString(),scroll:e.scrollTop,caret:[document.querySelector('#writing-body').selectionStart,document.querySelector('#writing-body').selectionEnd]}})()");
      await until(() => p.evaluate('document.querySelector("#save-state").textContent === "Saved to Theseus"'), 'undo saved');
      const after = await p.evaluate("({text:getSelection().toString(),scroll:document.querySelector('#source-body').scrollTop,caret:[document.querySelector('#writing-body').selectionStart,document.querySelector('#writing-body').selectionEnd]})");
      assert.deepEqual({ text: after.text, caret: after.caret }, { text: before.text, caret: before.caret }, 'status repaint preserves source selection and caret');
      assert.ok(Math.abs(after.scroll - before.scroll) <= geometryTolerance, `status repaint preserves source place within ${geometryTolerance}px`);
      const grip = await p.box('#reader-divider'), x = grip.x + grip.width / 2, y = grip.y + grip.height / 2;
      const writingBefore = await p.box('.writing-pane');
      await p.point('#reader-divider');
      assert.ok(Math.abs((await p.box('.writing-pane')).width - writingBefore.width) <= geometryTolerance, `divider near-action click does not resize within ${geometryTolerance}px`);
      await p.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', buttons: 1, clickCount: 1 });
      for (let step = 1; step <= 6; step++) await p.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: x - step * 10, y, button: 'left', buttons: 1 });
      await p.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: x - 60, y, button: 'left', buttons: 0, clickCount: 1 });
      assert.ok((await p.box('.writing-pane')).width > writingBefore.width + minimumDragExpansion - geometryTolerance, 'actual browser drag expands wide writing');
      assert.equal(await field(p), reply); assert.equal(await p.evaluate('getSelection().toString()'), before.text);
      await p.key('Escape'); assert.equal(await p.evaluate('document.querySelector("#reader").open'), true);
      await p.key('Escape'); await until(() => p.evaluate('!document.querySelector("#reader").open'), 'reader escape');
      await p.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
      await p.open(1); const source = await p.box('#source-body');
      const touch = { x: source.x + 10, y: source.y + 10 };
      await p.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [touch] });
      await p.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      assert.equal(await field(p), reply, 'plain touch does not quote or send');
      assert.equal(p.calls.filter(call => call.payload?.kind === 'message.send').length, 0);
      await shot(p, 'phone-reader'); assert.deepEqual(p.errors, []);
    });

    await check('held real preparation keeps new B editable and cannot close or refocus Y', async () => {
      const p = await page('race', null, true); await p.open(1); await replace(p, 'Native delayed A');
      let once = false;
      p.intercept(payload => payload?.kind === 'submission.prepare' && !once && (once = true));
      await p.key('Enter', 4);
      assert.equal(await field(p), '', 'new B is visible immediately after the send act');
      await p.send('Input.insertText', { text: 'Native delayed B' });
      await until(() => p.held[0], 'held real prepare response');
      // Y is Source 0, the message above Source 1 on the page: the head of the
      // stack Source 1 answers in (docs/reply-stacks.md), whatever replies
      // earlier cases left under it. ⌘↑ steps there.
      const onY = 'document.querySelector("#source-body").textContent.startsWith("Source 0 ")';
      await p.point('#source-body'); await p.key('ArrowUp', 4);
      await until(() => p.evaluate(onY), 'neighbor Y');
      await p.point('#source-body'); const focused = await p.evaluate('document.activeElement.id');
      const original = p.held[0].payload; await p.release(p.held[0]);
      await until(async () => (await view('operation', { operation_id: original.args.send_operation_id })).status === 'committed', 'one public A');
      assert.equal(await p.evaluate('document.querySelector("#reader").open'), true);
      assert.equal(await p.evaluate('document.activeElement.id'), focused);
      assert.equal(await p.evaluate(onY), true, 'still on Y');
      await p.point('#reader-close'); await until(() => p.evaluate('!document.querySelector("#reader").open'), 'close Y');
      // A arrives as a card above the sources and moves them down; the source
      // is pressed once it has, so the press cannot land on A as it arrives.
      await until(() => p.evaluate(`[...document.querySelectorAll('#messages .message-preview')].some(e => e.textContent === 'Native delayed A')`), 'A is drawn');
      await p.open(1); assert.equal(await field(p), 'Native delayed B');
      await shot(p, 'after-delayed-send'); assert.deepEqual(p.errors, []);
    });

    await check('lost public answer, real reload, explicit device recovery and the server\'s record retain one A plus B', async () => {
      const p = await page('lost', null, true); await p.open(1); await replace(p, 'Native lost-answer A');
      p.intercept(payload => payload?.kind === 'message.send');
      await p.key('Enter', 12); assert.equal(await field(p), '');
      await p.send('Input.insertText', { text: 'Native reload B' });
      const held = await until(() => p.held[0], 'committed public response held');
      const receipt = await view('operation', { operation_id: held.payload.operation_id }); assert.equal(receipt.status, 'committed');
      await p.fail(held);
      await until(async () => (await privateState()).draft?.body === 'Native reload B', 'B independently saved');
      await p.close();
      const q = await page('reload', null, true); await q.open(1);
      await until(() => q.evaluate('!document.querySelector("#review-versions").hidden'), 'discoverable recovery');
      await q.point('#review-versions');
      await until(() => q.evaluate('document.querySelector("#version-review").textContent.includes("Native reload B")'), 'actual IDB recovery comparison');
      const selector = await until(() => q.evaluate(`(()=>{const section=[...document.querySelectorAll('#review-content section')].find(e=>e.querySelector('pre')?.textContent==='Native reload B'&&[...e.querySelectorAll('button')].some(b=>b.textContent==='Recover this version'));if(!section)return null;section.id='chosen-native-recovery';return '#chosen-native-recovery button'})()`), 'candidate discovery finished');
      assert.ok(selector, 'explicit candidate for retained B and original A'); await q.point(selector);
      await until(() => q.evaluate('!document.querySelector("#version-review").open'), 'adoption confirmed');
      assert.equal(await field(q), 'Native reload B');
      // The server's record of A's send says it went, so A is not in doubt and
      // leaves no Review button behind (item 118); nothing else here was sent.
      assert.equal((await view('operation', { operation_id: held.payload.operation_id })).status, 'committed');
      assert.equal(await q.evaluate(`Boolean(document.querySelector('#pending-submissions button'))`), false, 'no Review button for a reply the server records as sent');
      const messages = await view('topic_messages', { topic_id: 't1', limit: 100 });
      assert.equal(messages.items.filter(item => item.body === 'Native lost-answer A').length, 1);
      assert.equal(q.calls.filter(call => ['message.send','submission.prepare'].includes(call.payload?.kind)).length, 0, 'recovery and check do not replay publication');
      await q.key('Escape'); assert.equal(await field(q), 'Native reload B'); await shot(q, 'recovered-reader'); assert.deepEqual(q.errors, []);
    });

    await check('epoch recovery comparison preserves writing height and needs an explicit private choice', async () => {
      const p = await page('epoch', null, true); await p.open(1); await replace(p, 'Before fixture epoch');
      await until(async () => (await privateState()).draft?.body === 'Before fixture epoch', 'E1 private acknowledgement');
      await p.evaluate(`(()=>{window.readOwnRecovery=()=>new Promise((resolve,reject)=>{const request=indexedDB.open('aim-next-pending');request.onerror=()=>reject(request.error);request.onsuccess=()=>{const db=request.result,tx=db.transaction('editors'),key=JSON.stringify([${JSON.stringify(facts.instance_id)},${JSON.stringify(facts.actor)},'reply','message',${JSON.stringify(facts.sources[1].id)},'t1']),writer=sessionStorage.getItem('aim-next-recovery-hint:'+JSON.stringify([${JSON.stringify(facts.instance_id)},${JSON.stringify(facts.actor)}]));tx.objectStore('editors').get(JSON.stringify([key,writer])).onsuccess=e=>resolve(e.target.result?.snapshot);tx.oncomplete=()=>db.close();}})})()`);
      await control({ method: 'epoch', epoch: 'native-epoch-2', complete: false, drop_private: true });
      await replace(p, 'Keep this after epoch');
      await until(() => p.evaluate('document.querySelector("#save-state").textContent.includes("Runtime changed")'), 'explicit authority recovery status');
      // Read the device copy once the writing is parked: since 30186fc an
      // acknowledged copy is retired, but parked writing is unacknowledged and
      // keeps the operations it attempted under the old authority.
      const parked = await p.evaluate('readOwnRecovery()');
      assert.ok(parked, 'parked writing keeps its device copy');
      const originalEnvelopes = parked.attempts.map(attempt => attempt.envelope);
      observations.push({ epochParkedAttempts: originalEnvelopes.map(envelope => ({ kind: envelope.kind, epoch: envelope.expected?.authority?.authority_epoch })) });
      assert.ok(originalEnvelopes.some(envelope => envelope.expected?.authority?.authority_epoch !== 'native-epoch-2'), 'the parked copy holds an operation pinned to the old authority');
      const geometry = await p.box('#writing-body');
      // The page parks the writing when it learns of the change, or reads the
      // new runtime at once when its save is refused first. Until that read is
      // done the saved version is unknown, and the comparison must not claim
      // there is none (6e29a82).
      const review = await until(async () => { const value = (await p.evaluate('readOwnRecovery()'))?.authorityRecovery; return value?.phase && value.phase !== 'loading' ? value : null; }, 'settled runtime review phase');
      // What each settled phase means, as the case reads it: ready and blocked
      // come only after both the runtime and the saved version were read;
      // parked and error come before. The comparison is judged against this,
      // not against the field it draws from.
      const readSaved = { ready: true, blocked: true, parked: false, error: false }[review.phase];
      observations.push({ epochFirstReviewPhase: review.phase, epochFirstReviewRead: Boolean(review.authority) });
      assert.equal(typeof readSaved, 'boolean', 'a settled runtime review phase');
      await p.point('#review-versions');
      const saved = readSaved ? 'No saved version here' : 'Saved version unavailable. Retry to read it; your writing is kept.';
      await until(() => p.evaluate(`document.querySelector("#review-content").textContent.includes(${JSON.stringify(saved)})`), 'saved private version as far as it is known');
      assert.equal(await p.evaluate('document.activeElement.id'), 'review-title', 'comparison never focuses its write action');
      await p.point('#review-keep'); await until(() => p.evaluate('!document.querySelector("#version-review").open'), 'Keep both closes comparison');
      assert.equal(await field(p), 'Keep this after epoch');
      assert.equal((await privateState()).draft, null, 'Keep both makes no private write');
      assert.equal((await p.box('#writing-body')).height, geometry.height);
      await p.point('#review-versions');
      let heldOnce = false;
      p.intercept(payload => payload?.name === 'editor_state' && !heldOnce && (heldOnce = true));
      await p.point('#review-retry');
      const failedRead = await until(() => p.held[0], 'held recovery state read'); await p.fail(failedRead);
      await until(() => p.evaluate('document.querySelector("#review-status").textContent.includes("Could not read")'), 'specific failed recovery read');
      assert.equal(await p.evaluate('document.querySelector("#review-save").disabled'), true);
      heldOnce = false;
      await p.point('#review-retry');
      const delayedRead = await until(() => p.held[1], 'second recovery state read held');
      await p.key('Escape');
      assert.equal(await p.evaluate('document.activeElement.id'), 'review-versions');
      await replace(p, 'Typed while recovery read was held');
      await p.release(delayedRead);
      await until(() => p.evaluate('(await readOwnRecovery()).authorityRecovery?.phase === "ready"'), 'current review durably settled after held read');
      await p.point('#review-versions');
      await until(() => p.evaluate('document.querySelector("#review-content").textContent.includes("Typed while recovery read was held")'), 'current writing comparison refreshed');
      assert.ok(await p.evaluate('document.querySelector("#review-content").textContent.includes("No saved version here")'), 'missing current private version');
      await until(() => p.evaluate('!document.querySelector("#review-save").disabled'), 'explicit private choice ready');
      await p.point('#review-save');
      await until(async () => (await privateState()).draft?.body === 'Typed while recovery read was held', 'private resume with new authority');
      await until(() => p.evaluate('!document.querySelector("#version-review").open'), 'confirmed private comparison close');
      assert.equal(await field(p), 'Typed while recovery read was held');
      assert.equal(p.calls.filter(call => ['message.send','submission.prepare'].includes(call.payload?.kind)).length, 0);
      const pinned = p.calls.filter(call => call.payload?.kind === 'draft.save').map(call => call.payload.expected.authority.authority_epoch);
      assert.ok(pinned.includes('native-epoch-2')); assert.ok(pinned.some(epoch => epoch !== 'native-epoch-2'));
      const retained = await p.evaluate('readOwnRecovery()');
      for (const envelope of originalEnvelopes) assert.deepEqual(retained.attempts.find(attempt=>attempt.envelope.operation_id===envelope.operation_id)?.envelope,envelope,'original operation and authority pin survive the private choice');
      await shot(p, 'epoch-recovered'); assert.deepEqual(p.errors, []);
    });

    await check('actual IDB write failure blocks reader close and preserves editable writing', async () => {
      const p = await page('quota', null, true); await p.open(0);
      // Opening may unfold the source first (a reply of the person's folded it, item 377): that act is before the failure.
      const opened = p.calls.length;
      await p.evaluate(`(()=>{const transaction=IDBDatabase.prototype.transaction;IDBDatabase.prototype.transaction=function(...args){if(args[1]==='readwrite')throw new DOMException('Fixture quota failure','QuotaExceededError');return transaction.apply(this,args)}})()`);
      await replace(p, 'Keep unjournaled text in this page');
      await until(() => p.evaluate('document.querySelector("#save-state").textContent.includes("Recovery copy unavailable")'), 'visible IDB failure');
      await p.point('#reader-close');
      assert.equal(await p.evaluate('document.querySelector("#reader").open'), true);
      assert.equal(await field(p), 'Keep unjournaled text in this page');
      await p.point('#writing-body'); await p.send('Input.insertText', { text: ' still editable' });
      assert.ok((await field(p)).includes('still editable'));
      assert.equal(p.calls.slice(opened).filter(call => call.payload?.kind).length, 0, 'an unjournaled act never dispatches');
      await shot(p, 'idb-failure'); assert.deepEqual(p.errors, []);
    });
  }
} finally {
  // Each step of the teardown has its bound, and one that fails is recorded
  // and the rest still run, so native.json is always written (closeAll in
  // native-calls.mjs). A fixture that does not exit is this harness's own
  // child: it is stopped by its handle, and its exit stays unknown.
  const closed = await closeAll({
    browser: cdp && socket?.readyState === WebSocket.OPEN ? { close: () => cdp('Browser.close'), exit: chromeExit, disconnect: () => socket.close() } : null,
    fixture: { health: liveUpdatesFixture ? async () => fixture.exitCode === null ? control({ method: 'admission_events' }) : undefined : null,
      end: () => fixture.stdin.end(), exit: fixtureExit, running: () => fixture.exitCode === null && fixture.signalCode === null, stop: () => fixture.kill('SIGTERM') },
  });
  const teardown = closed.failed; finalHealth = closed.health; fixtureExitCode = closed.exitCode;
  // Every origin/key here belongs to this unique disposable profile; no keys
  // or prefixes are ever removed from a person's browser.
  if (!chrome || chrome.exitCode !== null) {
    await rm(profile, { recursive: true, force: true });
    await rm(downloadPath, { recursive: true, force: true });
  }
  phases.reportingStarted = Date.now();
  await writeFile(path.join(evidencePath, 'native.json'), JSON.stringify({ mode, baseline, legacyAdmission, hashes, results, observations, finalHealth, fixtureExitCode, fixtureErrors, browserClosed: chrome?.exitCode !== null, teardown }, null, 2));
  phases.reportingEnded = Date.now();
  await writeFile(path.join(evidencePath, 'phases.json'), JSON.stringify(phases, null, 2));
  assert.deepEqual(teardown, [], 'the browser and the fixture closed within their bounds');
  assert.equal(fixtureExitCode, 0, fixtureErrors);
  if (liveUpdatesFixture) { assert.deepEqual(finalHealth?.fatal, []); assert.equal(fixtureErrors, '', 'owned fixture stderr is clean'); }
}
assert.ok(results.length && results.every(result => result.passed), 'see native.json for exact failing assertions');

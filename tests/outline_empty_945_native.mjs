// Actual outline name clicks and HTTP/Core list ownership on isolated records.
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, writeFile, rm, access } from 'node:fs/promises';
import net from 'node:net';
import { fixtureControl } from './fixture_control.mjs';
const playwright = await import(process.env.AIM_PLAYWRIGHT_CORE), engine = process.env.AIM_ENGINE ?? 'chromium';
const evidence = process.argv[2]; await mkdir(evidence, { recursive: true });
const workspace = '945-w', buildId = '945-t';
const fixture = spawn('/usr/bin/python3', ['-B', 'tests/fixtures/ui_http.py', '--freshness']);
const { control, exit, errors } = fixtureControl(fixture);
const ps = () => execFileSync('/bin/ps', ['-axo', 'pid=,ppid=,command='], { encoding: 'utf8' }).trim().split('\n').map(line => {
  const [, pid, ppid, command] = line.match(/^\s*(\d+)\s+(\d+)\s+(.*)$/); return { pid: +pid, ppid: +ppid, command };
});
const results = [], cleanup = {}, owned = new Set(); let browser, profile, origin, failure;
function retainChildren() {
  const list = ps(); for (let changed = true; changed;) { changed = false;
    for (const p of list) if (owned.has(p.ppid) && !owned.has(p.pid)) { owned.add(p.pid); changed = true; }
  }
}
const state = (page, scope = workspace) => page.evaluate(async workspace => {
  const { panes } = await import('/panes.mjs');
  const outline = panes.outline, owner = outline?.outcomes?.get(workspace);
  const outcome = document.querySelector(`.ol-outcome[data-workspace-id="${workspace}"]`);
  const visible = node => Boolean(node && node.getBoundingClientRect().height && getComputedStyle(node).visibility !== 'hidden');
  return { route: location.search, outlineText: outcome?.innerText, badge: outcome?.querySelector('.ol-title .unread-count')?.textContent,
    expanded: outcome?.querySelector('.ol-disclosure')?.getAttribute('aria-expanded'),
    adopted: Boolean(outcome?.querySelector('.ol-adopted')), ownHidden: outcome?.querySelector('.ol-own')?.hidden,
    cards: [...document.querySelectorAll('.outcome-topic-card')].filter(visible).map(row => row.dataset.topicId),
    rows: [...outcome?.querySelectorAll('a[data-topic-id]') ?? []].filter(visible).map(row => row.dataset.topicId),
    empty: [...document.querySelectorAll('.empty')].filter(visible).map(node => node.textContent),
    listed: document.querySelector('#topic-navigation')?.dataset.listed,
    projectionUnderOutline: Boolean(document.querySelector('#topic-navigation')?.closest('.ol-topics')),
    navigationIdCount: document.querySelectorAll('#topic-navigation').length,
    runtime: { route: outline?.handles?.route, hasTopicOwner: Boolean(owner?.rail), topicOwnerStarted: owner?.rail?.pages.started,
      adoptedIsNavigation: owner?.adopted === document.querySelector('#topic-navigation'),
      directRailNavigation: Boolean(document.querySelector('#rail > #topic-navigation')) } };
}, scope);
try {
  const facts = await control({ method: 'ready' }); origin = facts.origin;
  const committed = receipt => { assert.equal(receipt.status, 'committed', JSON.stringify(receipt.error)); return receipt.result; };
  const build = await control({ method: 'agent_topic', operation_id: '945', title: 'A Build topic', body: 'Isolated Build opening.', team: true });
  assert.equal(build.workspace_id, workspace); assert.equal(build.topic_id, buildId);
  await control({ method: 'navigation_topics', topics: [{ id: 'ordinary945', workspace_id: workspace, title: 'An ordinary topic' }] });
  let serial = 0;
  const pipeline = (kind, args) => control({ method: 'pipeline', operation_id: `945-pipeline-${++serial}`, kind,
    sender: 'agent', workspace_id: workspace, target: { workspace_id: workspace }, args }).then(committed);
  await pipeline('pipeline.configure', { enabled: true });
  await pipeline('pipeline.stages_set', { stages: [{ stage_id: 'build', name: 'Build' }] });
  const added = await pipeline('pipeline.item_add', { title: 'Isolated Build', size: 'small', section: 'now', sources: [{ note: '945 native control' }] });
  await pipeline('pipeline.piece_start', { numbers: [added.number], topic_id: buildId, stage_id: 'build' });
  const buildRoot = (await control({ method: 'agent_view', actor: facts.actor, name: 'topic_messages', args: { topic_id: buildId, direction: 'before', limit: 50 } })).items[0].id;
  for (let n = 0; n < 13; n++) committed(await control({ method: 'agent_message', operation_id: `945-unread-${n}`, join: true,
    sender: facts.agent, topic_id: buildId, reply_to: buildRoot, addressees: [facts.actor],
    body: `Isolated Build update ${n}.`, reply_without_quote: 'Independent 945 unread-count control.' }));
  const truth = await control({ method: 'agent_view', actor: facts.actor, name: 'workspace_topics', args: { workspace_id: workspace, build: false, limit: 50 } });
  assert.ok(Array.isArray(truth.items), JSON.stringify(truth));
  assert.ok(truth.items.some(item => item.id === 'ordinary945')); assert.ok(!truth.items.some(item => item.id === buildId));
  const counts = (await control({ method: 'agent_view', actor: facts.actor, name: 'workspace_counts', args: { workspace_ids: [workspace] } })).items[0];
  assert.equal(counts.build.unread, 14);
  await control({ method: 'navigation_workspaces', workspaces: [{ id: 'empty945', title: 'An empty outcome' }] });
  const emptyTruth = await control({ method: 'agent_view', actor: facts.actor, name: 'workspace_topics', args: { workspace_id: 'empty945', build: false, limit: 50 } });
  assert.deepEqual(emptyTruth.items, []);
  profile = await mkdtemp(`${evidence}/chrome-profile-`);
  const persistent = await playwright[engine].launchPersistentContext(profile, { headless: true,
    ...(engine === 'chromium' ? { executablePath: process.env.AIM_CHROME } : {}) });
  browser = persistent.browser(); for (const p of ps()) if (p.command.includes(profile)) owned.add(p.pid); retainChildren();
  assert.ok(owned.size);
  for (const width of [1280, 1512]) for (const colorScheme of ['dark', 'light']) {
  const context = await browser.newContext({ viewport: { width, height: 900 }, colorScheme });
  const page = await context.newPage(), reads = [], pageErrors = [];
  let step = 'topic'; const requestSteps = new WeakMap();
  page.on('request', request => requestSteps.set(request, step));
  page.on('pageerror', error => pageErrors.push(error.message));
  page.on('response', async response => {
    const request = response.request(); if (!request.url().endsWith('/api/view')) return;
    const post = request.postDataJSON(); if (!['workspace_topics', 'conversation', 'workspaces', 'workspace_counts'].includes(post?.name)) return;
    const row = { name: post.name, args: post.args, status: response.status(), phase: new URL(page.url()).search, step: requestSteps.get(request) }; reads.push(row);
    try { const answer = await response.json(); row.ids = answer.items?.map(item => item.id); row.error = answer.error?.code; row.groups = answer.groups; } catch {}
  });
  await page.goto(`${origin}/?topic=ordinary945`); await page.locator('body[data-ready=true]').waitFor();
  const disclosure = page.locator(`.ol-outcome[data-workspace-id="${workspace}"] .ol-disclosure`);
  if (await disclosure.getAttribute('aria-expanded') === 'false') await disclosure.click();
  await page.locator(`.ol-outcome[data-workspace-id="${workspace}"] a[data-topic-id="ordinary945"]`).waitFor({ state: 'visible' });
  const before = await state(page);
  const name = page.locator(`.ol-outcome[data-workspace-id="${workspace}"] .ol-name`); step = 'outcome-arrival'; await name.click();
  await page.waitForFunction(workspace => location.search === `?workspace=${workspace}` && document.body.dataset.ready === 'true', workspace);
  let error;
  try {
    await page.waitForFunction(() => [...document.querySelectorAll('.outcome-topic-card')].some(node => node.dataset.topicId === 'ordinary945' && node.getBoundingClientRect().height), undefined, { timeout: 4000 });
    const shown = await state(page); assert.equal(shown.badge, '14'); assert.ok(!shown.empty.includes('No topics shown by the outline.'));
    assert.deepEqual(pageErrors, []);
  } catch (caught) { error = caught.stack; }
  const after = await state(page);
  await page.screenshot({ path: `${evidence}/${engine}-${width}-${colorScheme}-after-name.png` });
  step = 'reload'; await page.reload(); await page.locator('body[data-ready=true]').waitFor();
  let reloadError;
  try { await page.locator('.outcome-topic-card[data-topic-id="ordinary945"]').waitFor({ state: 'visible', timeout: 4000 }); }
  catch (caught) { reloadError = caught.stack; }
  const afterReload = await state(page), controls = {}; let controlsError;
  if (!error && !reloadError) try {
    assert.equal(after.navigationIdCount, 1, 'retired ids cannot shadow the fresh navigation');
    assert.equal(after.adopted, false); assert.equal(after.runtime.topicOwnerStarted, true);
    assert.deepEqual(after.cards, after.rows, 'the home mirrors the same list the outline shows');
    assert.ok(reads.some(read => read.step === 'outcome-arrival' && read.name === 'workspace_topics' && read.status === 200 && read.args.workspace_id === workspace && read.args.build === false));
    step = 'back-topic'; await page.locator('.outcome-topic-card[data-topic-id="ordinary945"]').click();
    await page.waitForFunction(() => location.search === '?topic=ordinary945' && document.body.dataset.ready === 'true');
    await page.locator(`.ol-outcome[data-workspace-id="${workspace}"] #topic-navigation[data-listed]`).waitFor({ state: 'visible', timeout: 4000 });
    controls.backTopic = await state(page); assert.equal(controls.backTopic.adopted, true, 'a real topic page still lends its list to the outline');
    step = 'second-arrival'; await name.click();
    await page.locator('.outcome-topic-card[data-topic-id="ordinary945"]').waitFor({ state: 'visible' });
    await disclosure.click(); controls.folded = await state(page); assert.equal(controls.folded.expanded, 'false'); assert.deepEqual(controls.folded.cards, []);
    await disclosure.click(); await page.locator('.outcome-topic-card[data-topic-id="ordinary945"]').waitFor({ state: 'visible' });
    controls.reopened = await state(page); assert.equal(controls.reopened.badge, String(counts.build.unread));
    if (width === 1280 && colorScheme === 'dark') {
      const empty = page.locator('.ol-outcome[data-workspace-id="empty945"]');
      step = 'empty-outcome'; if (await empty.locator('.ol-disclosure').getAttribute('aria-expanded') === 'false') await empty.locator('.ol-disclosure').click();
      await empty.locator('.ol-name').click();
      await page.waitForFunction(() => location.search === '?workspace=empty945' && document.body.dataset.ready === 'true');
      const conversation = (await control({ method: 'agent_view', actor: facts.actor, name: 'conversation', args: { workspace_id: 'empty945' } })).conversation.topic_id;
      await page.locator(`.outcome-topic-card[data-topic-id="${conversation}"]`).waitFor({ state: 'visible' });
      controls.empty = await state(page, 'empty945'); assert.deepEqual(controls.empty.cards, [conversation], 'zero ordinary topics retain only their standing Conversation');
      await control({ method: 'read_fault', name: 'workspace_topics', read_class: 'foreground', status: 503, count: 1,
        body: { error: { code: 'SERVER_BUSY', message: 'Topics temporarily unavailable.', retryable: true } } });
      step = 'read-error'; await name.click();
      await page.locator('.outcome-topic-cards .notice').filter({ hasText: 'Topics temporarily unavailable.' }).waitFor({ state: 'visible' });
      controls.refused = await state(page); assert.ok(!controls.refused.empty.includes('No topics in this list.'));
      step = 'retry'; await page.locator('.outcome-topic-cards').getByRole('button', { name: 'Retry topics', exact: true }).click();
      await page.locator('.outcome-topic-card[data-topic-id="ordinary945"]').waitFor({ state: 'visible' });
      await page.locator('.outcome-topic-cards .notice').waitFor({ state: 'hidden' }); controls.retried = await state(page);
    }
    assert.deepEqual(pageErrors, []);
  } catch (caught) { controlsError = caught.stack; }
  results.push({ engine, width, colorScheme, before, after, afterReload, controls, truth: { ids: truth.items.map(item => item.id), counts, emptyIds: emptyTruth.items }, reads, pageErrors,
    error: error ?? null, reloadError: reloadError ?? null, controlsError: controlsError ?? null });
  await page.screenshot({ path: `${evidence}/${engine}-${width}-${colorScheme}-after-controls.png` });
  await context.close();
  await writeFile(`${evidence}/observations.json`, JSON.stringify(results, null, 2));
  }
} catch (error) { failure = error; }
finally {
  if (browser) { retainChildren(); await browser.close(); cleanup.browserClosed = !browser.isConnected(); }
  const after = ps(); cleanup.ownedPids = [...owned]; cleanup.remainingOwned = after.filter(p => owned.has(p.pid));
  cleanup.profileProcesses = profile ? after.filter(p => p.command.includes(profile)) : [];
  if (profile && cleanup.browserClosed && !cleanup.remainingOwned.length && !cleanup.profileProcesses.length) {
    await rm(profile, { recursive: true }); cleanup.profileRemoved = await access(profile).then(() => false, () => true);
  }
  fixture.stdin.end(); cleanup.fixtureExit = await exit; cleanup.fixtureErrors = errors(); cleanup.fixturePid = fixture.pid;
  cleanup.fixtureAbsent = !ps().some(p => p.pid === fixture.pid);
  if (origin) cleanup.portClosed = await new Promise(resolve => {
    const url = new URL(origin), socket = net.createConnection({ host: url.hostname, port: +url.port });
    socket.once('connect', () => { socket.destroy(); resolve(false); }); socket.once('error', () => resolve(true));
  });
  await writeFile(`${evidence}/results.json`, JSON.stringify({ results, cleanup, failure: failure?.stack ?? null }, null, 2));
}
assert.equal(cleanup.fixtureExit.code, 0); assert.equal(cleanup.fixtureAbsent, true); assert.equal(cleanup.portClosed, true);
if (failure) throw failure;
assert.equal(cleanup.browserClosed, true); assert.deepEqual(cleanup.remainingOwned, []); assert.deepEqual(cleanup.profileProcesses, []);
assert.ok(results.length && results.every(result => !result.error && !result.reloadError && !result.controlsError), 'actual outline navigation and its controls pass; inspect evidence');
console.log(JSON.stringify({ passed: results.length, cleanup }));

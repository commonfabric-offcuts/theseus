// Real Core stars and question, actual CfT layout/hover, protected-scope comparison.
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import net from 'node:net';
import { fixtureControl } from './fixture_control.mjs';
import { notebookActionEnvelope } from '../web/notebook-writing.mjs';
const { chromium } = await import(process.env.AIM_PLAYWRIGHT_CORE);
const evidence = process.argv[2]; await mkdir(evidence, { recursive: true });
const child = spawn('/usr/bin/python3', ['tests/fixtures/ui_http.py', '--freshness']);
const { control, exit } = fixtureControl(child);
const results = [], failures = [], errors = [], marker = `theseus-940-${process.pid}`;
const baseline = process.env.AIM_940_BASELINE ? JSON.parse(await readFile(process.env.AIM_940_BASELINE, 'utf8')) : [];
let facts, browser, page, profile;
const question = 'Which Compact spacing should ship?';
const check = (key, name, act) => { try { act(); results.push({ key, check: name, pass: true }); } catch (error) { failures.push({ key, check: name, error: error.stack }); } };
const settled = async () => page.waitForFunction(() => document.body.dataset.ready === 'true' && !document.documentElement.hasAttribute('data-rails-reading') && document.querySelector('#outline #topic-navigation:not([inert])'));
const metrics = () => {
  const node = selector => document.querySelector(selector), rect = el => { const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; };
  const style = el => { const s = getComputedStyle(el); return { color: s.color, background: s.backgroundColor, paddingLeft: s.paddingLeft, paddingRight: s.paddingRight, marginLeft: s.marginLeft, whiteSpace: s.whiteSpace, border: s.borderTopWidth }; };
  const box = el => ({ rect: rect(el), style: style(el) });
  const dossier = node('.ol-dossier[data-dossier-id]'), notebook = node('.ol-page[data-page-id="n940"]');
  const other = node('#outline a[data-topic-id="t940other"] .topic-state'), mine = node('#outline a[data-topic-id="t940mine"] .topic-state');
  return { dossier: box(dossier), notebook: box(notebook), topic: box(node('#outline a[data-topic-id="t1"]')), list: box(dossier.parentElement), other: { ...box(other), title: other.title, before: getComputedStyle(other, '::before').content }, mine: box(mine) };
};
try {
  facts = await control({ method: 'ready' });
  await control({ method: 'navigation_topics', topics: [{ id: 't940other', title: 'Waiting for another' }, { id: 't940mine', title: 'Waiting for me' }] });
  const dossier = (await control({ method: 'agent_message', operation_id: '940-dossier', topic_id: 't1', sender: 'person', whole_topic: true, body: 'A scratch starred dossier for940.' })).result.message_id;
  await control({ method: 'stack_act', kind: 'stack.name', operation_id: '940-name', sender: facts.actor, message_id: dossier, args: { name: 'Starred garden dossier' } });
  await control({ method: 'stack_act', kind: 'message.star', operation_id: '940-star', sender: facts.actor, message_id: dossier, args: { starred: true } });
  await control({ method: 'agent_page', operation_id: '940-page', item_id: 'n940', topic_id: 't1', title: 'Starred garden Notebook', body: 'Scratch Notebook for940.' });
  const headers = { Authorization: `Bearer ${facts.token}`, Origin: facts.origin, 'Content-Type': 'application/json' };
  const boot = await (await fetch(facts.origin + '/api/bootstrap', { headers })).json();
  const state = await control({ method: 'agent_view', actor: facts.actor, name: 'memory_current', args: { item_id: 'n940' } });
  const command = notebookActionEnvelope(boot, 'n940', state, 'memory.star', { starred: true });
  assert.equal((await (await fetch(facts.origin + '/api/command', { method: 'POST', headers, body: JSON.stringify(command) })).json()).status, 'committed');
  for (const id of ['t940other', 't940mine']) await control({ method: 'topic_state', operation_id: '940-join-' + id, topic_id: id, participants: [facts.agent], args: { state: 'active' } });
  await control({ method: 'agent_message', operation_id: '940-ask-other', sender: 'person', topic_id: 't940other', whole_topic: true, body: question, post_args: { addressees: [facts.agent], intent: 'ask' } });
  await control({ method: 'topic_state', operation_id: '940-wait-me', topic_id: 't940mine', args: { state: 'waiting', waiting_on: [facts.actor], note: 'Which garden should I water?' } });
  browser = await chromium.launch({ executablePath: process.env.AIM_CHROME, headless: true, args: ['--enable-automation', `--${marker}`] });
  const cdp = await browser.newBrowserCDPSession(); profile = (await cdp.send('Browser.getBrowserCommandLine')).arguments.find(x => x.startsWith('--user-data-dir='))?.slice(16); assert.ok(profile); await cdp.detach();
  for (const scope of [{ name: 'compact', widths: [1280, 1512] }, { name: 'roomy', widths: [1280, 1512] }, { name: 'phone', widths: [390], touch: true }, { name: 'coarse', widths: [1280], touch: true }]) for (const width of scope.widths) for (const colorScheme of ['light', 'dark']) {
    const key = `${scope.name}-${width}-${colorScheme}`, context = await browser.newContext({ viewport: { width, height: 1000 }, colorScheme, hasTouch: !!scope.touch, isMobile: scope.name === 'phone' });
    page = await context.newPage(); page.setDefaultTimeout(10000); page.on('pageerror', error => errors.push({ key, error: error.message }));
    await page.goto(facts.origin + '/?topic=t1'); await settled();
    if (scope.name === 'roomy') await page.getByRole('button', { name: 'Roomy', exact: true }).click();
    if (scope.name === 'phone') await page.locator('#rail-open').tap();
    await page.locator(`.ol-dossier[data-dossier-id="${dossier}"]:visible`).waitFor(); await page.locator('.ol-page[data-page-id="n940"]:visible').waitFor();
    await page.locator('#outline a[data-topic-id="t940other"] .topic-state').waitFor();
    const measured = await page.evaluate(metrics);
    await page.locator(`.ol-dossier[data-dossier-id="${dossier}"]`).hover(); const starHover = await page.locator(`.ol-dossier[data-dossier-id="${dossier}"]`).evaluate(el => getComputedStyle(el).backgroundColor);
    await page.locator('#outline a[data-topic-id="t940other"]').hover(); const topicHover = await page.locator('#outline a[data-topic-id="t940other"]').evaluate(el => getComputedStyle(el).backgroundColor);
    await page.locator('#outline a[data-topic-id="t940other"] .topic-state').hover();
    check(key, 'full928 hover words', () => { assert.ok(measured.other.title.includes(question)); assert.ok(measured.other.title.includes(facts.agent)); assert.match(measured.other.title, /you asked/); });
    results.push({ key, scope: scope.name, measured, starHover, topicHover });
    if (scope.name === 'compact') {
      check(key, 'starred dossier and Notebook rows24px and indented', () => { for (const row of [measured.dossier, measured.notebook]) { assert.equal(row.rect.height, 24); assert.equal(row.style.whiteSpace, 'nowrap'); assert.ok(row.rect.x + parseFloat(row.style.paddingLeft) > measured.topic.rect.x + parseFloat(measured.topic.style.paddingLeft)); } assert.equal(measured.dossier.style.color, measured.notebook.style.color); });
      check(key, 'other wait open ellipsis ring matches own wait size', () => { assert.equal(measured.other.rect.width, measured.mine.rect.width); assert.equal(measured.other.rect.height, measured.mine.rect.height); assert.ok(parseFloat(measured.other.style.border) > 0); assert.match(measured.other.before, /…/); assert.match(measured.other.style.background, /rgba\(0, 0, 0, 0\)/); });
      check(key, 'starred rows use quiet topic hover', () => assert.equal(starHover, topicHover));
      await page.screenshot({ path: `${evidence}/${key}.png`, fullPage: true });
      await page.locator(`.ol-dossier[data-dossier-id="${dossier}"]`).click(); await page.waitForFunction(id => document.activeElement?.closest('[data-id]')?.dataset.id === id, dossier); assert.equal(await page.locator('#reader[open]').count(), 0, 'starred dossier lands in the feed by its existing owner');
      await page.locator('.ol-page[data-page-id="n940"]').click(); const sheet = page.locator('dialog.notebook-sheet-dialog[open]'); await sheet.waitFor(); await sheet.locator('.notebook-sheet-close').click();
    } else if (baseline.length) {
      const prior = baseline.find(row => row.key === key && row.measured); assert.ok(prior, 'pre-patch protected scope exists');
      const retained = data => ({ ...data.measured, other: { ...data.measured.other, title: undefined } });
      check(key, 'protected scope equals actual210 geometry/styles', () => assert.deepEqual(retained({ measured }), retained(prior)));
    }
    await context.close();
  }
  assert.deepEqual(errors, []);
} catch (error) { failures.push({ fatal: error.stack }); }
finally {
  if (browser) {
    const rows = execFileSync('ps', ['-axo', 'pid=,ppid=,command='], { encoding: 'utf8' }).split('\n').map(line => { const m = /^\s*(\d+)\s+(\d+)\s+(.*)$/.exec(line); return m && { pid: +m[1], parent: +m[2], command: m[3] }; }).filter(Boolean);
    const owned = new Set(rows.filter(r => r.command.includes(marker) || r.command.includes(profile)).map(r => r.pid));
    for (let n = 0; n < rows.length; n++) for (const r of rows) if (owned.has(r.parent)) owned.add(r.pid);
    await browser.close(); const live = new Set(execFileSync('ps', ['-axo', 'pid='], { encoding: 'utf8' }).trim().split(/\s+/).map(Number)); const remaining = [...owned].filter(pid => live.has(pid));
    results.push({ browserClosed: !browser.isConnected(), profile, ownedPids: [...owned], remaining }); assert.deepEqual(remaining, []);
  }
  child.stdin.end(); const ended = await exit;
  let absent = false; try { process.kill(child.pid, 0); } catch (e) { absent = e.code === 'ESRCH'; }
  const portClosed = !facts || await new Promise(resolve => { const s = net.connect(new URL(facts.origin).port, '127.0.0.1'); s.on('connect', () => { s.destroy(); resolve(false); }); s.on('error', () => resolve(true)); s.setTimeout(1000, () => { s.destroy(); resolve(false); }); });
  results.push({ fixture: ended, fixturePid: child.pid, absent, port: facts && new URL(facts.origin).port, portClosed, errors, failures });
  await writeFile(`${evidence}/results.json`, JSON.stringify(results, null, 2)); assert.deepEqual(ended, { code: 0, signal: null }); assert.equal(absent, true); assert.equal(portClosed, true);
}
if (failures.length) { process.stderr.write(JSON.stringify(failures, null, 2) + '\n'); process.exitCode = 1; }

// Actual236 rail, scratch Core/HTTP and native density/navigation clicks.
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import net from 'node:net';
import { fixtureControl } from './fixture_control.mjs';
const { chromium } = await import(process.env.AIM_PLAYWRIGHT_CORE);
const evidence = process.argv[2]; await mkdir(evidence, { recursive: true });
const baseline = process.env.AIM_950_BASELINE ? JSON.parse(await readFile(process.env.AIM_950_BASELINE, 'utf8')) : [];
const child = spawn('/usr/bin/python3', ['tests/fixtures/ui_http.py', '--freshness'], { cwd: process.env.AIM_950_FIXTURE_ROOT ?? process.cwd() });
const { control, exit } = fixtureControl(child);
const records = [], failures = [], errors = [], marker = `theseus-950-${process.pid}`;
let browser, page, facts, profile;
const check = (key, name, act) => { try { act(); records.push({ key, name, pass: true }); } catch (error) { failures.push({ key, name, error: error.stack }); } };
const measure = () => {
  const rect = el => { const r = el.getBoundingClientRect(); return [r.x, r.y, r.width, r.height].map(n => Math.round(n * 1000) / 1000); };
  const visible = el => !!el.getClientRects().length && getComputedStyle(el).visibility !== 'hidden' && !el.closest('[hidden]');
  return {
    fine: matchMedia('(pointer:fine)').matches, roomy: document.documentElement.hasAttribute('data-rail-roomy'),
    rail: rect(document.getElementById('rail')), foot: rect(document.querySelector('.rail-foot')),
    rows: [...document.querySelectorAll('#outline .ol-outcome')].map(row => {
      const name = row.querySelector('.ol-name'), standing = row.querySelector('small.standing'), waiting = row.querySelector('.ol-waiting'), lamp = name.querySelector('.outcome-light');
      return { id: row.dataset.workspaceId, title: name.title, href: name.getAttribute('href'),
        boxes: [row, row.querySelector('.ol-row'), name, row.querySelector('.ol-name-line'), row.querySelector('.ol-disclosure'), row.querySelector('.ol-new-topic'), standing, waiting].map(rect),
        standing: { text: standing.textContent, visible: visible(standing), visibility: getComputedStyle(standing).visibility },
        waiting: { hidden: waiting.hidden, visible: visible(waiting) },
        lamp: { visible: visible(lamp), light: lamp.dataset.light, color: getComputedStyle(lamp).color, background: getComputedStyle(lamp).backgroundColor, box: rect(lamp) },
        counts: [...row.querySelectorAll('.unread-count')].map(el => ({ text: el.textContent, visible: visible(el), box: rect(el) })),
        topics: [...row.querySelectorAll('a[data-topic-id]')].map(el => ({ id: el.dataset.topicId, box: rect(el) })) };
    }) };
};
// Child Conversation ids are independently allocated by each scratch Core.
// Compare every child rectangle in order, retaining count/order and row ids.
const geometry = m => ({ rail: m.rail, foot: m.foot, rows: m.rows.map(r => ({ id: r.id, boxes: r.boxes, lamp: r.lamp, counts: r.counts, topics: r.topics.map(t => t.box) })) });
// Each scratch store has its own timestamps; compare stable identity/visibility,
// not the minute spoken by an otherwise unchanged status line.
const presentation = m => ({ fine: m.fine, roomy: m.roomy, rows: m.rows.map(r => ({ id: r.id, title: r.title, href: r.href, standing: { visible: r.standing.visible, visibility: r.standing.visibility }, waiting: r.waiting })) });
try {
  facts = await control({ method: 'ready' });
  await control({ method: 'light_outcome', outcome: 'w950q', title: 'Question outcome', topic: { id: 't950q', title: 'Waiting question' } });
  await control({ method: 'light_outcome', outcome: 'w950empty', title: 'Empty outcome' });
  await control({ method: 'agent_message', operation_id: '950-question', topic_id: 't950q', whole_topic: true, body: 'Which garden should I water?', post_args: {
    addressees: [facts.actor], intent: 'ask', go_ahead: false, divergence_reason: 'Isolated950 waiting-state control.',
    ask_wait: { root_id: null, cover_revision: 0, questions: [{ actor_id: facts.actor, text: 'Which garden should I water?', options: [], default: null, reason: 'This scratch question tests the rail without offering choices or promising a default.' }] },
  } });
  browser = await chromium.launch({ executablePath: process.env.AIM_CHROME, headless: true, args: ['--enable-automation', `--${marker}`] });
  const cdp = await browser.newBrowserCDPSession(); profile = (await cdp.send('Browser.getBrowserCommandLine')).arguments.find(x => x.startsWith('--user-data-dir='))?.slice(16); assert.ok(profile); await cdp.detach();
  const scopes = [
    { name: 'compact', width: 1280 }, { name: 'roomy', width: 1280, roomy: true }, { name: 'roomy', width: 1512, roomy: true },
    { name: 'phone', width: 390, touch: true }, { name: 'coarse', width: 1280, touch: true },
    { name: 'phone-roomy', width: 390, touch: true, savedRoomy: true }, { name: 'coarse-roomy', width: 1280, touch: true, savedRoomy: true },
  ];
  for (const scope of scopes) for (const colorScheme of ['light', 'dark']) {
    const key = `${scope.name}-${scope.width}-${colorScheme}`;
    const context = await browser.newContext({ viewport: { width: scope.width, height: 1000 }, colorScheme, hasTouch: !!scope.touch, isMobile: scope.width === 390 });
    if (scope.savedRoomy) await context.addInitScript(() => localStorage.setItem('theseus-rail-roomy', '1'));
    page = await context.newPage(); page.setDefaultTimeout(10000); page.on('pageerror', error => errors.push({ key, error: error.message }));
    await page.goto(facts.origin + '/?topic=t1');
    await page.waitForFunction(() => document.body.dataset.ready === 'true' && !document.documentElement.hasAttribute('data-rails-reading') && document.querySelector('#outline #topic-navigation:not([inert])'));
    if (scope.roomy) await page.getByRole('button', { name: 'Roomy', exact: true }).click();
    if (scope.width === 390) await page.locator('#rail-open').tap();
    await page.waitForFunction(() => document.querySelector('.ol-outcome[data-workspace-id="w950q"] .ol-waiting')?.hidden === false && document.querySelector('.ol-outcome[data-workspace-id="w950empty"] small.standing')?.textContent === 'No topics yet');
    const measured = await page.evaluate(measure); records.push({ key, measured });
    const compact = scope.name === 'compact', hide = compact || !!scope.roomy;
    check(key, 'standing text follows density and pointer scope', () => {
      assert.equal(measured.fine, !scope.touch); assert.equal(measured.roomy, !!(scope.roomy || scope.savedRoomy));
      for (const row of measured.rows) { assert.ok(row.standing.text); assert.equal(row.standing.visible, !hide); }
    });
    check(key, 'name lights counts and question-only control remain correct', () => {
      for (const row of measured.rows) { assert.ok(row.title); assert.ok(row.href); assert.equal(row.lamp.visible, true); }
      const question = measured.rows.find(row => row.id === 'w950q');
      assert.equal(question.lamp.light, 'waiting'); assert.equal(question.waiting.hidden, false); assert.equal(question.waiting.visible, !hide);
      assert.ok(question.counts.some(c => c.visible && Number(c.text) > 0));
    });
    if (baseline.length) check(key, 'all other rail geometry and controls match unchanged236', () => {
      const prior = baseline.find(row => row.key === key && row.measured); assert.ok(prior); assert.deepEqual(geometry(measured), geometry(prior.measured));
      if (!scope.roomy) assert.deepEqual(presentation(measured), presentation(prior.measured));
    });
    await page.screenshot({ path: `${evidence}/${key}.png`, fullPage: true });
    if (scope.roomy) {
      await page.locator('.ol-outcome[data-workspace-id="w950empty"] .ol-name').click();
      await page.waitForFunction(() => new URL(location.href).searchParams.get('workspace') === 'w950empty' && document.body.dataset.ready === 'true');
      records.push({ key, name: 'native Roomy outcome-name click still opens its outcome', pass: true });
    }
    await context.close();
  }
  assert.deepEqual(errors, []);
} catch (error) { failures.push({ fatal: error.stack }); if (page && !page.isClosed()) await page.screenshot({ path: `${evidence}/failure.png`, fullPage: true }).catch(() => {}); }
finally {
  if (browser) {
    const rows = execFileSync('ps', ['-axo', 'pid=,ppid=,command='], { encoding: 'utf8' }).split('\n').map(line => { const m = /^\s*(\d+)\s+(\d+)\s+(.*)$/.exec(line); return m && { pid: +m[1], parent: +m[2], command: m[3] }; }).filter(Boolean);
    const owned = new Set(rows.filter(r => r.command.includes(marker) || profile && r.command.includes(profile)).map(r => r.pid));
    for (let n = 0; n < rows.length; n++) for (const r of rows) if (owned.has(r.parent)) owned.add(r.pid);
    await browser.close(); const live = new Set(execFileSync('ps', ['-axo', 'pid='], { encoding: 'utf8' }).trim().split(/\s+/).map(Number)); const remaining = [...owned].filter(pid => live.has(pid));
    const profileAbsent = await access(profile).then(() => false, error => { if (error.code === 'ENOENT') return true; throw error; });
    records.push({ browserClosed: !browser.isConnected(), profile, profileAbsent, ownedPids: [...owned], remaining }); assert.deepEqual(remaining, []); assert.equal(profileAbsent, true);
  }
  child.stdin.end(); const ended = await exit;
  let absent = false; try { process.kill(child.pid, 0); } catch (error) { absent = error.code === 'ESRCH'; }
  const portClosed = !facts || await new Promise(resolve => { const s = net.connect(new URL(facts.origin).port, '127.0.0.1'); s.on('connect', () => { s.destroy(); resolve(false); }); s.on('error', () => resolve(true)); s.setTimeout(1000, () => { s.destroy(); resolve(false); }); });
  records.push({ fixture: ended, fixturePid: child.pid, absent, port: facts && new URL(facts.origin).port, portClosed, errors, failures });
  await writeFile(`${evidence}/results.json`, JSON.stringify(records, null, 2)); assert.deepEqual(ended, { code: 0, signal: null }); assert.equal(absent, true); assert.equal(portClosed, true);
}
if (failures.length) { process.stderr.write(JSON.stringify(failures, null, 2) + '\n'); process.exitCode = 1; }

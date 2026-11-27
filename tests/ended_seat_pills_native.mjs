// Real browser views over the isolated Core retirement fixture.
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { fixtureControl } from './fixture_control.mjs';

const { chromium } = await import(process.env.AIM_PLAYWRIGHT_CORE);
const out = process.argv[2];
await mkdir(out, { recursive: true });
const child = spawn('/usr/bin/python3', ['-I', 'tests/fixtures/ended_seat_pills.py']);
const fixture = fixtureControl(child);
const result = { head: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(), widths: [] };
const controls = [['researcher', /researcher/i, true], ['ready-hosted', /ready hosted/i, false], ['agent-a', /agent-a/i, false]];

async function checkPill(pill, ended, name = pill) {
  await pill.waitFor();
  const appearance = await name.evaluate(node => ({ decoration: getComputedStyle(node).textDecorationLine }));
  assert.equal(appearance.decoration.includes('line-through'), ended);
  const title = await pill.getAttribute('title');
  assert.equal(title === 'seat ended', ended);
  return { ...appearance, title };
}

let browser;
try {
  const facts = await fixture.control({ method: 'ready' });
  assert.ok(facts.before.waiting.researcher > 0);
  browser = await chromium.launch({ executablePath: process.env.AIM_CHROME, headless: true });
  const pages = [];
  for (const width of [1280, 390]) {
    const context = await browser.newContext({ viewport: { width, height: 900 }, hasTouch: width === 390, isMobile: width === 390 });
    const page = await context.newPage();
    page.setDefaultTimeout(7000);
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    const seen = { width, team: {}, people: {}, mentions: {}, health: [] };
    result.widths.push(seen);
    await page.goto(facts.origin + '/?topic=seat-check');
    await page.locator('body[data-ready=true]').waitFor();
    const field = page.locator('#inline-writing-body');
    await field.pressSequentially('Please ask @');
    const list = page.getByRole('listbox', { name: 'People to mention' });
    const researcher = list.getByRole('option', { name: /^@researcher\b/ });
    seen.before = await checkPill(researcher, false);
    pages.push({ context, page, width, seen, list, field, researcher, errors });
  }
  const { after, tell } = await fixture.control({ method: 'end' });
  result.core = { before: facts.before, after, tell };
  assert.ok(after.pending.includes(tell));
  assert.equal(after.waiting.researcher, undefined);
  assert.equal(after.wakes.some(wake => wake.actor_id === 'researcher'), false);
  assert.deepEqual(after.red, []);
  assert.equal(after.routes['agent-a'], 'codex_queue');
  assert.ok(after.waiting['ready-hosted'] > 0);
  assert.ok(after.waiting['agent-a'] > 0);
  for (const { context, page, width, seen, list, field, researcher, errors } of pages) {
    await researcher.and(page.locator('[data-seat-ended]')).waitFor();
    assert.equal(await field.evaluate(node => document.activeElement === node), true);
    assert.equal(await field.inputValue(), 'Please ask @');
    for (const [id, , ended] of controls) seen.mentions[id] = await checkPill(list.getByRole('option', { name: new RegExp(`^@${id}\\b`) }), ended);
    await page.screenshot({ path: `${out}/mentions-${width}.png` });
    for (const [id, words, ended] of controls) {
      const pill = page.locator('#participants .person-pill').filter({ hasText: words });
      seen.people[id] = await checkPill(pill, ended, pill.locator('.pill-name'));
    }
    await page.goto(facts.origin + '/?workspace=w1');
    await page.locator('body[data-ready=true]').waitFor();
    if (width === 390) await page.locator('#outcome-tab-agents').tap();
    for (const [id, , ended] of controls) {
      const pill = page.locator(`#outcome-agents [data-actor-id="${id}"]`);
      seen.team[id] = await checkPill(pill, ended, pill.locator('.outcome-agent-name'));
    }
    await page.screenshot({ path: `${out}/team-${width}.png` });
    await page.goto(facts.origin + '/?health');
    await page.locator('.health-top').waitFor();
    assert.doesNotMatch(await page.locator('.health-top').innerText(), /researcher/i);
    assert.equal(await page.locator('[data-key="agent:researcher"]').count(), 0);
    for (const id of ['ready-hosted', 'agent-a']) {
      const summary = await page.locator(`[data-key="agent:${id}"] summary`).innerText();
      assert.match(summary, new RegExp(`\\b${after.waiting[id]} waiting\\b`));
      seen.health.push(summary);
    }
    await page.screenshot({ path: `${out}/health-${width}.png` });
    assert.deepEqual(errors, []);
    await context.close();
  }
} finally {
  await browser?.close();
  child.stdin.end();
  const exited = await fixture.exit;
  result.fixtureExit = exited.code;
  await writeFile(`${out}/results.json`, JSON.stringify(result, null, 2));
  assert.equal(exited.code, 0, fixture.errors());
}
console.log('Ended, ready hosted and native seats verified at 1280 and 390 px.');

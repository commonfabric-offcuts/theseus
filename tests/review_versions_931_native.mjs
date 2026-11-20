// Isolated real HTTP/Core; native writing, comparison and real IndexedDB reload in Chrome for Testing.
// AIM_CHROME and AIM_PLAYWRIGHT_CORE name the browser and module.
// node tests/review_versions_931_native.mjs /absolute/evidence
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { fixtureControl } from './fixture_control.mjs';
const { chromium } = createRequire(import.meta.url)(process.env.AIM_PLAYWRIGHT_CORE);
const evidence = process.argv[2]; await mkdir(evidence, { recursive: true });
const child = spawn('/usr/bin/python3', ['tests/fixtures/ui_http.py', '--freshness']);
const { control, exit, errors: fixtureErrors } = fixtureControl(child);
let browser, page; const results = [];
try {
  const facts = await control({ method: 'ready' });
  browser = await chromium.launch({ executablePath: process.env.AIM_CHROME, headless: true });
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  page = await context.newPage(); const pageErrors = []; page.on('pageerror', e => pageErrors.push(e.message));
  const html = (await readFile('web/index.html', 'utf8')).replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '');
  await page.route('**/unit931', route => route.fulfill({ contentType: 'text/html', body: html }));
  const app = facts.origin + '/?topic=t1', unit = facts.origin + '/unit931';
  await page.goto(app); const field = page.locator('#inline-writing-body'), pill = page.locator('#inline-review-versions');
  await field.waitFor(); await field.fill('Chosen current words');
  await page.waitForFunction(() => document.querySelector('#inline-save-state').dataset.save === 'saved');
  assert.equal(await pill.isVisible(), false, 'saved field is quiet');
  await field.press('End'); await field.pressSequentially(' and newer typing');
  assert.equal(await pill.isVisible(), false, 'ordinary newer typing is quiet');
  await page.waitForFunction(() => document.querySelector('#inline-save-state').dataset.save === 'saved');
  const currentWords = await field.inputValue();
  async function seed(refused) {
    await page.goto(unit);
    return page.evaluate(async ({ token, refused }) => {
      const { Api } = await import('/api.mjs'), { openJournal } = await import('/journal.mjs'), { Editor } = await import('/editor.mjs');
      const api = new Api(token), b = await api.bootstrap(), ref = { kind: 'topic', id: 't1' };
      const state = await api.view('editor_state', { source_ref: ref, topic_id: 't1' });
      const journal = await openJournal({ instanceId: b.instance_id, actor: b.actor });
      try {
        const editor = new Editor({ instanceId: b.instance_id, actor: b.actor, kind: 'reply', sourceRef: ref, topicId: 't1' }, state.draft);
        editor.uploadState = { format: 2, revision: 1, client_cycle_id: editor.clientCycleId, entries: [], submission_links: {} };
        // A retained refused-prepare fixture; the surrounding draft is saved
        // through the actual UI/Core, and this row is real strict IDB storage.
        if (refused) editor.submissions = [{ id: 'refused931', status: 'refused', snapshot: { ...structuredClone(state.draft), body: 'Different frozen refused words' }, receipt: { kind: 'submission.prepare' } }];
        const snapshot = { ...editor.snapshot(), activeAuthority: b.authority, authorityRecovery: null, attempts: [] };
        await journal.save(snapshot); const row = await journal.own(editor.key);
        return { id: row.id, key: editor.key, snapshot: row.snapshot, stamp: row.stamp };
      } finally { journal.close(); }
    }, { token: facts.token, refused });
  }
  await seed(false); await page.goto(app); await field.waitFor();
  await page.waitForFunction(() => !document.querySelector('#inline-send').disabled);
  assert.equal(await field.inputValue(), currentWords); assert.equal(await pill.isVisible(), false, 'identical stored copy is quiet after reload');
  const refusal = await seed(true); await page.goto(app); await field.waitFor(); await page.waitForFunction(() => document.querySelector('#inline-review-versions').textContent === 'Review versions' && !document.querySelector('#inline-review-versions').hidden);
  assert.equal(await pill.textContent(), 'Review versions'); assert.match(await pill.getAttribute('title'), /earlier reply.*differs/);
  await pill.click(); const review = page.locator('#version-review'); await review.waitFor();
  assert.equal(await page.locator('#review-content > section').first().locator('pre').textContent(), 'Different frozen refused words');
  await page.screenshot({ path: `${evidence}/difference.png` });
  await review.getByRole('button', { name: 'Keep current writing', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('#review-status').textContent.startsWith('Current writing kept.'));
  await page.locator('#review-close').click(); assert.equal(await pill.isVisible(), false);
  await page.reload(); await field.waitFor();
  await page.waitForFunction(() => !document.querySelector('#inline-send').disabled);
  assert.equal(await field.inputValue(), currentWords); assert.equal(await pill.isVisible(), false, 'recorded choice stays quiet after reload');
  await page.screenshot({ path: `${evidence}/resolved-reload.png` });
  await page.goto(unit);
  const retained = await page.evaluate(async ({ token, refusal }) => {
    const { Api } = await import('/api.mjs'), { openJournal } = await import('/journal.mjs');
    const b = await new Api(token).bootstrap(), journal = await openJournal({ instanceId: b.instance_id, actor: b.actor });
    try {
      let cursor, row;
      do { const p = await journal.candidates(refusal.key, { limit: 10, ...(cursor ? { cursor } : {}) }); row = p.items.find(r => r.id === refusal.id) ?? row; cursor = p.nextCursor; } while (cursor && !row);
      if (!row?.reviewChoice) throw Error('No durable exact-copy choice');
      let staleRefused = false, changedRefused = false;
      const choice = { ...row.reviewChoice, writerId: journal.writerId };
      try { await journal.keepCandidate(refusal.key, { ...row, stamp: refusal.stamp }, choice, () => true); } catch { staleRefused = true; }
      try { await journal.keepCandidate(refusal.key, row, choice, () => false); } catch { changedRefused = true; }
      return { snapshot: row.snapshot, choice: Boolean(row.reviewChoice), staleRefused, changedRefused };
    } finally { journal.close(); }
  }, { token: facts.token, refusal });
  assert.deepEqual(retained.snapshot, refusal.snapshot, 'resolution preserves every frozen field and send record');
  assert.equal(retained.staleRefused, true); assert.equal(retained.changedRefused, true);
  assert.deepEqual(pageErrors, []);
  results.push({ passed: true, scope: 'native typing/save/newer typing; real IDB identical-copy reload; different refused fixture, named pill, first comparison, explicit keep and new-document reload; unchanged frozen snapshot and failed stale/changed choices' });
  await context.close(); page = null;
} catch (error) {
  results.push({ passed: false, error: error.stack });
  if (page) { await page.screenshot({ path: `${evidence}/failure.png` }).catch(() => {}); await writeFile(`${evidence}/failure.html`, await page.content().catch(() => '')); }
  throw error;
} finally {
  await browser?.close(); child.stdin.end(); const ended = await exit;
  await writeFile(`${evidence}/results.json`, JSON.stringify({ results, fixtureExit: ended, fixtureErrors: fixtureErrors() }, null, 2));
  assert.equal(ended.code, 0);
}

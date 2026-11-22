// Roomy draws a topic's marks as Compact does (real Core questions, actual Chromium layout): a question waiting on
// you a small filled ?, one waiting on someone else a small open ring with an ellipsis, a size up and against the
// title's first line, no activity ring, no state pill. Compact is unchanged: with AIM_ROOMY_BASELINE (this test's
// results.json from the tree before), its every measured mark must equal the one measured there.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { fixtureControl } from './fixture_control.mjs';
const { chromium } = await import(process.env.AIM_PLAYWRIGHT_CORE);
const evidence = process.argv[2]; await mkdir(evidence, { recursive: true });
const child = spawn('/usr/bin/python3', ['tests/fixtures/ui_http.py', '--freshness']);
const { control, exit } = fixtureControl(child);
const baseline = process.env.AIM_ROOMY_BASELINE ? JSON.parse(await readFile(process.env.AIM_ROOMY_BASELINE, 'utf8')).rows : null;
const rows = [], failures = [], errors = [];
const question = 'Which spacing should the rail ship?';
const check = (key, name, act) => { try { act(); rows.push({ key, check: name, pass: true }); } catch (error) { failures.push({ key, check: name, error: error.stack }); } };
let facts, browser;
// Every mark the rail draws on a topic, with where it sits against its row and the row's first line of words.
const marks = () => {
  const rect = el => { const r = el.getBoundingClientRect(); return { x: +r.x.toFixed(2), y: +r.y.toFixed(2), width: +r.width.toFixed(2), height: +r.height.toFixed(2) }; };
  const look = (el, pseudo) => { const s = getComputedStyle(el, pseudo); return { display: s.display, background: s.backgroundColor, color: s.color, border: s.borderTopWidth, borderColor: s.borderTopColor, radius: s.borderTopLeftRadius, content: s.content, fontSize: s.fontSize, fontWeight: s.fontWeight }; };
  const row = id => document.querySelector(`#outline a[data-topic-id="${id}"]`);
  const of = id => { const a = row(id), state = a.querySelector('.topic-state'), work = a.querySelector('.topic-work'), count = a.querySelector('.unread-count');
    // The title's own words: every text in the row outside its marks.
    const lines = [], walk = document.createTreeWalker(a, NodeFilter.SHOW_TEXT);
    for (let n; (n = walk.nextNode());) if (n.data.trim() && !n.parentElement.closest('.topic-state, .unread-count, .topic-work')) { const r = document.createRange(); r.selectNodeContents(n); lines.push(...r.getClientRects()); }
    const first = lines[0];
    return { row: { ...rect(a), paddingRight: getComputedStyle(a).paddingRight, color: getComputedStyle(a).color }, firstLine: first ? { top: +first.top.toFixed(2), bottom: +first.bottom.toFixed(2), right: +Math.max(...lines.map(r => r.right)).toFixed(2) } : null,
      state: state && { ...rect(state), ...look(state), before: look(state, '::before'), text: state.textContent, title: state.title },
      work: work && look(work), count: count && { ...rect(count), ...look(count), addressed: count.classList.contains('addressed') } }; };
  return { other: of('t940other'), mine: of('t940mine'), accent: getComputedStyle(document.documentElement).getPropertyValue('--accent').trim(), rem: parseFloat(getComputedStyle(document.documentElement).fontSize) };
};
try {
  facts = await control({ method: 'ready' });
  await control({ method: 'navigation_topics', topics: [{ id: 't940other', title: 'Waiting for another, a title long enough to wrap onto a second line in Roomy' }, { id: 't940mine', title: 'Waiting for me' }] });
  for (const id of ['t940other', 't940mine']) await control({ method: 'topic_state', operation_id: 'roomy-join-' + id, topic_id: id, participants: [facts.agent], args: { state: 'active' } });
  await control({ method: 'agent_message', operation_id: 'roomy-ask-other', sender: 'person', topic_id: 't940other', whole_topic: true, body: question, post_args: { addressees: [facts.agent], intent: 'ask' } });
  await control({ method: 'topic_state', operation_id: 'roomy-wait-me', topic_id: 't940mine', args: { state: 'waiting', waiting_on: [facts.actor], note: 'Which garden should I water?' } });
  browser = await chromium.launch({ executablePath: process.env.AIM_CHROME, headless: true });
  for (const spacing of ['compact', 'roomy']) for (const width of [1280, 1512]) for (const colorScheme of ['dark', 'light']) {
    const key = `${spacing}-${width}-${colorScheme}`, context = await browser.newContext({ viewport: { width, height: 1000 }, colorScheme });
    const page = await context.newPage(); page.setDefaultTimeout(10000); page.on('pageerror', error => errors.push({ key, error: error.message }));
    await page.goto(facts.origin + '/?topic=t1');
    await page.waitForFunction(() => document.body.dataset.ready === 'true' && !document.documentElement.hasAttribute('data-rails-reading') && document.querySelector('#outline'));
    if (spacing === 'roomy') await page.getByRole('button', { name: 'Roomy', exact: true }).click();
    // An outcome opens folded on a desktop (944): its topics are drawn once it is unfolded.
    if (!(await page.locator('#outline a[data-topic-id="t940other"]').isVisible())) await page.locator('#outline .ol-disclosure').first().click();
    await page.locator('#outline a[data-topic-id="t940other"] .topic-state').waitFor(); await page.locator('#outline a[data-topic-id="t940mine"] .topic-state').waitFor();
    const m = await page.evaluate(marks);
    rows.push({ key, measured: m });
    if (spacing === 'roomy') {
      const size = 1.1 * m.rem;
      check(key, 'your question is a small filled ? in the accent', () => {
        assert.ok(Math.abs(m.mine.state.width - size) < 0.6 && Math.abs(m.mine.state.height - size) < 0.6, JSON.stringify(m.mine.state));
        assert.equal(m.mine.state.radius, '50%'); assert.equal(m.mine.state.before.content, '"?"'); assert.equal(m.mine.state.fontSize, '0px');
      });
      check(key, 'another\'s question is an open ring with an ellipsis, the same size', () => {
        assert.equal(m.other.state.width, m.mine.state.width); assert.equal(m.other.state.height, m.mine.state.height);
        assert.ok(parseFloat(m.other.state.border) > 0); assert.equal(m.other.state.background, 'rgba(0, 0, 0, 0)'); assert.equal(m.other.state.before.content, '"…"');
        assert.ok(m.other.state.title.includes(question), 'its hover names the question');
      });
      check(key, 'no state pill and no activity ring', () => { for (const t of [m.mine, m.other]) { assert.equal(t.state.fontSize, '0px', 'the state\'s words are not drawn'); if (t.work) assert.equal(t.work.display, 'none'); } });
      check(key, 'the mark sits against the title\'s first line, clear of its words', () => {
        for (const t of [m.mine, m.other]) {
          const middle = t.state.y + t.state.height / 2; assert.ok(middle > t.firstLine.top - 1 && middle < t.firstLine.bottom + 1, `${middle} in ${JSON.stringify(t.firstLine)}`);
          assert.ok(t.firstLine.right <= t.state.x + 0.5, `words end ${t.firstLine.right} before the mark at ${t.state.x}`);
          assert.ok(t.state.x + t.state.width <= t.row.x + t.row.width, 'inside its row');
        }
        assert.ok(m.other.row.height > m.mine.row.height, 'the long title wraps in Roomy');
      });
    } else if (baseline) {
      const prior = baseline.find(row => row.key === key && row.measured); assert.ok(prior, 'the tree before measured ' + key);
      // Its hover's words carry the clock time the question was asked: left out of the comparison.
      const drawn = data => ({ ...data, other: { ...data.other, state: { ...data.other.state, title: undefined } }, mine: { ...data.mine, state: { ...data.mine.state, title: undefined } } });
      check(key, 'Compact is unchanged: every mark equals the tree before', () => assert.deepEqual(drawn(m), drawn(prior.measured)));
    }
    await page.screenshot({ path: `${evidence}/${key}.png`, clip: { x: 0, y: 0, width: Math.min(width, 420), height: 1000 } });
    await context.close();
  }
  assert.deepEqual(errors, []);
} catch (error) { failures.push({ fatal: error.stack }); }
finally {
  await browser?.close(); child.stdin.end(); const ended = await exit;
  await writeFile(`${evidence}/results.json`, JSON.stringify({ rows, failures, errors, fixture: ended }, null, 2));
}
console.log(JSON.stringify({ checks: rows.filter(r => r.check).length, failures: failures.length }));
for (const f of failures) console.log(f.key ?? 'fatal', f.check ?? '', (f.error ?? f.fatal).split('\n').slice(0, 2).join(' | ').slice(0, 400));
process.exitCode = failures.length ? 1 : 0;

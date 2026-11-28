import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fixtureControl } from './fixture_control.mjs';

const [output] = process.argv.slice(2);
assert.ok(output);
const { chromium } = await import(process.env.AIM_PLAYWRIGHT_CORE);
await mkdir(output, { recursive: true });
const fixture = spawn('/usr/bin/python3', ['-B', 'tests/fixtures/ui_http.py', '--freshness']);
const { control, exit, errors } = fixtureControl(fixture);
const received = async request => {
  const receipt = await control(request);
  assert.equal(receipt.status, 'committed', JSON.stringify(receipt));
  return receipt.result;
};
const report = { cases: [], errors: [] };
let browser;

try {
  const { origin, actor, agent } = await control({ method: 'ready' });
  const topic = 'cover-delivery-phase';
  await control({ method: 'navigation_topics', topics: [{ id: topic, title: 'Field guide release' }] });
  const post = async (id, sender, body, args = {}) => (await received({ method: 'agent_message', topic_id: topic,
    source: 'topic', operation_id: '59-post-' + id, sender, body, read: true, ...args })).message_id;
  await post('join', agent, 'The field guide notes go here.', { join: true, divergence_reason: 'Set up the fixture examples.' });
  const act = (kind, id, sender, messageId, args) => received({ method: 'stack_act', kind, operation_id: '59-' + id, sender, message_id: messageId, args });
  const dossier = async ({ id, title, nature, stands, criterion, fields, payload, quiet = false }) => {
    const author = quiet ? 'fixture-outside-agent' : 'person';
    const reviewers = quiet ? { addressees: [author] } : {};
    const root = await post(id, author, title, quiet ? { join: true, addressees: [agent], divergence_reason: 'A separate review.' } : { divergence_reason: 'A separate cover example.' });
    const reply = await post(id + '-reply', agent, payload?.text ?? 'I added the first cover.',
      { ...reviewers, reply_to: root, reply_without_quote: 'The first cover answers the whole question.' });
    await act('stack.birth', id + '-birth', agent, root, { reply_id: reply, nature, stands, done_when: criterion });
    if (fields || payload) await act('stack.cover', id + '-cover', agent, root, { stands,
      ...(fields ? { sections: fields } : {}), ...(payload ? { payload: { ...payload, message_id: reply } } : {}),
    });
    return { root, reply };
  };
  const proposed = await dossier({
    id: 'proposed', title: 'Field guide preview', nature: 'research', stands: 'Readers can find the trail plan and download the packet from one page.',
    criterion: 'The field team can find the route, handout, and revision date.', payload: { kind: 'preview',
      text: 'The field guide preview has the full trail plan, handout, and revision date. The field team can check the full packet now.',
      link: 'https://example.test/field-guide' },
    fields: { log: 'Draft map replaced on Tuesday.', where: 'North trailhead noticeboard.', who: 'Field team.', when: 'Friday morning.',
      how: '1. Print the **route** and packet together.\n2. Deliver it to the field team.',
      what: '| **File** | [Contents](https://example.test/contents) |\n| --- | --- |\n| Guide | Printable route and handout |\n| Packet | Supply list |\n| Map | Trail stops |',
      why: '**One home for the plan.** The team can share a single address.' },
  });
  const accepted = await dossier({
    id: 'accepted', title: 'Route map decision', nature: 'decision', stands: 'Use the riverside route for the opening walk.',
    criterion: 'The field lead accepts the route map.', payload: { kind: 'decision', text: 'Riverside route approved for the opening walk.', link: 'https://example.test/map' },
  });
  await received({ method: 'agent_thumb', operation_id: '59-owner-thumb', sender: actor, message_id: accepted.reply });
  const tracking = await dossier({
    id: 'tracking', title: 'Print run', nature: 'tracking', stands: '48 of 60 copies printed.',
    criterion: 'Check the final print count.', fields: { when: '**4:00 PM**\nAt the end of the print run.' },
  });
  const waiting = await dossier({
    id: 'waiting', title: 'Proof', nature: 'feature', stands: 'The print proof is ready for its final check.',
    criterion: 'The margin on every page clears the trim line.', quiet: true, payload: { kind: 'preview', text: 'Print proof ready.' },
  });
  const open = await dossier({
    id: 'open', title: 'Spare packets', nature: 'question', stands: 'How many spare packets should we bring?',
    criterion: 'The lead confirms the quantity.',
  });
  const working = await dossier({
    id: 'working', title: 'Handout checklist', nature: 'feature', stands: 'Prepare the handout for print.',
    criterion: 'The route and legend appear on the same page.',
    fields: { what: '- [x] Measure the path\n- [ ] Add the **route**\n- [ ] Print the guide\n- [x] Check the scale' },
  });

  browser = await chromium.launch({ executablePath: process.env.AIM_CHROME, headless: true });
  report.browser = browser.version();
  for (const width of [1280, 390]) for (const colorScheme of ['light', 'dark']) for (const look of ['bookends', 'paper']) {
    const phone = width === 390;
    const screen = { width, colorScheme, look };
    await act('stack.level', `reset-${width}-${look}-${colorScheme}`, actor, waiting.root, { level: null });
    const context = await browser.newContext({ viewport: { width, height: 900 }, deviceScaleFactor: 1, colorScheme,
      isMobile: phone, hasTouch: phone, reducedMotion: 'reduce' });
    try {
      await context.addInitScript(value => localStorage.setItem('theseus-look', value === 'paper' ? 'paper' : ''), look);
      const page = await context.newPage();
      page.setDefaultTimeout(10000);
      page.on('pageerror', error => report.errors.push(error.message));
      await page.goto(origin + '/?topic=' + topic);
      await page.locator('body[data-ready=true]').waitFor();
      assert.equal(await page.locator('html').getAttribute('data-look'), look === 'paper' ? 'paper' : null);
      const stack = ({ root }) => page.locator('#messages > .reply-stack[data-stack="' + root + '"]');
      const cover = fixture => stack(fixture).locator(':scope > .dossier-cover');
      const press = control => phone ? control.tap() : control.click();
      await cover(proposed).waitFor();
      for (const [example, phase] of [[proposed, 'Delivered'], [accepted, 'Accepted'], [open, 'Open'], [working, 'Working']]) {
        assert.equal(await cover(example).locator('.cover-phase').textContent(), phase);
      }
      assert.equal(await cover(tracking).locator('.cover-phase').count(), 0);
      assert.equal(await cover(tracking).locator('.cover-next').textContent(), 'next 4:00 PM');
      assert.match(await cover(accepted).locator('.cover-acceptance').textContent(), / accepted$/);
      assert.equal(await cover(accepted).locator('.cover-acceptance').evaluate(node => getComputedStyle(node).borderStyle), 'solid');
      const fields = cover(proposed).locator('.cover-structured-section');
      assert.deepEqual(await fields.locator('.cover-section-label').allTextContents(), ['Why', 'What', 'How', 'When', 'Who', 'Where', 'Log']);
      const peeks = await fields.locator('.cover-section-peek').allTextContents();
      assert.deepEqual(peeks.slice(0, 3), ['One home for the plan.', 'File, Contents · 3 rows', 'Print the route and packet together.']);
      const checklist = await cover(working).locator('.cover-section-peek').textContent();
      assert.equal(checklist, '2 of 4 done · Add the route');
      assert.equal(await cover(proposed).locator('.cover-structured-section[open]').count(), 0);
      const filter = page.locator('#agent-coordination-show button');
      if (await page.locator('#messages').getAttribute('data-show-coordination') !== 'true') await press(filter);
      const preview = stack(waiting).locator('.stack-cover-preview');
      await preview.waitFor();
      assert.equal(await stack(waiting).getAttribute('data-compact'), 'true');
      assert.match(await preview.locator('.cover-acceptance').textContent(), /^Waiting on .+'s ok$/);
      assert.equal(await preview.locator('.cover-acceptance').evaluate(node => getComputedStyle(node).borderStyle), 'dashed');
      assert.equal(await cover(waiting).isVisible(), false);
      assert.ok(await preview.evaluate(node => {
        const r = node.closest('.stack-head').getBoundingClientRect();
        const c = node.querySelector('.cover-acceptance').getBoundingClientRect();
        const nature = node.querySelector('.cover-nature');
        const lead = node.querySelector('.stack-cover-lead');
        return c.right <= r.right + 1 && nature.clientWidth >= nature.scrollWidth - 1 && lead.clientWidth > 8;
      }), JSON.stringify(screen));
      const previewFile = 'cover-' + width + '-' + look + '-' + colorScheme + '.png';
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.screenshot({ path: join(output, previewFile), fullPage: true, animations: 'disabled' });
      await press(stack(waiting).locator(':scope > .stack-toggle'));
      await cover(waiting).waitFor();
      const summary = fields.nth(1).locator('summary');
      const geometry = await cover(proposed).evaluate(sheet => {
        const payload = sheet.querySelector('.cover-payload');
        const text = payload.querySelector('.cover-payload-text');
        const range = document.createRange();
        range.selectNodeContents(text);
        const lineTops = [...new Set([...range.getClientRects()].map(rect => rect.top))];
        return { payloadBeforeLead: payload.getBoundingClientRect().bottom <= sheet.querySelector('.cover-heading').getBoundingClientRect().top,
          lineHeight: parseFloat(getComputedStyle(sheet).lineHeight), lineTops,
          link: payload.querySelector('.cover-words a').getBoundingClientRect().height,
          headings: [...sheet.querySelectorAll('.cover-structured-section > summary')].map(node => node.getBoundingClientRect().height),
          overflow: document.documentElement.scrollWidth - innerWidth };
      });
      assert.ok(geometry.payloadBeforeLead && geometry.overflow <= 1, JSON.stringify({ screen, geometry }));
      if (phone) {
        assert.ok(geometry.link >= 44 && geometry.headings.every(height => height >= 44));
        assert.ok(geometry.lineTops.length >= 2 && geometry.lineTops.slice(1).every((top, index) =>
          Math.abs(top - geometry.lineTops[index] - geometry.lineHeight) < 1), JSON.stringify({ screen, geometry }));
      }
      await press(summary);
      await fields.nth(1).locator('.md-table').waitFor();
      const fold = await fields.nth(1).evaluate(node => [node.dataset.coverFoldScope, node.dataset.coverFoldSection]);
      await page.waitForFunction(([key, section]) => JSON.parse(localStorage.getItem(key) ?? '[]').some(choice => choice.section === section && choice.open), fold);
      await page.goto(origin + '/?topic=' + topic + '&message=' + proposed.reply);
      const reader = page.locator('#reader-cover');
      await reader.locator('summary').first().waitFor();
      await press(reader.locator(':scope > summary'));
      const readerSheet = reader.locator('.dossier-cover');
      await readerSheet.waitFor();
      assert.deepEqual(await readerSheet.locator('.cover-section-label').allTextContents(), ['Why', 'What', 'How', 'When', 'Who', 'Where', 'Log']);
      assert.equal(await readerSheet.locator('.cover-structured-section[open] .cover-section-label').textContent(), 'What');
      assert.deepEqual(await readerSheet.locator(':scope > .cover-line').evaluateAll(rows => rows.slice(0, 3).map(row => row.className)),
        ['cover-line cover-header', 'cover-line cover-payload', 'cover-line cover-heading']);
      report.cases.push({ ...screen, geometry, peeks, checklist, previewFile });
    } finally {
      await context.close();
    }
  }
  assert.deepEqual(report.errors, []);
} finally {
  await browser?.close();
  report.browserClosed = Boolean(browser && !browser.isConnected());
  fixture.stdin.end();
  report.fixture = await exit;
  await writeFile(join(output, 'report.json'), JSON.stringify(report, null, 2) + '\n');
  assert.deepEqual(report.fixture, { code: 0, signal: null }, errors());
  assert.equal(errors(), '');
}

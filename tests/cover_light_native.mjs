import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fixtureControl } from './fixture_control.mjs';

const [output] = process.argv.slice(2);
assert.ok(output);
await mkdir(output, { recursive: true });
const { chromium } = await import(process.env.AIM_PLAYWRIGHT_CORE);
const fixture = spawn('/usr/bin/python3', ['-B', 'tests/fixtures/ui_http.py', '--freshness', '--live']);
const { control, exit, errors } = fixtureControl(fixture);
const report = [];
let browser;
try {
  const { origin, actor, agent } = await control({ method: 'ready' });
  const topic = 'cover-light-sample';
  await control({ method: 'navigation_topics', topics: [{ id: topic, title: 'Field guide' }] });
  const committed = async envelope => {
    const receipt = await control(envelope);
    assert.equal(receipt.status, 'committed', JSON.stringify(receipt));
    return receipt.result;
  };
  const post = async (operation, sender, body, args) => (await committed({
    method: 'agent_message', topic_id: topic, source: 'topic', operation_id: 'light-' + operation,
    sender, body, read: true, ...args,
  })).message_id;
  await post('join', agent, 'Field guide planning.', { join: true, divergence_reason: 'Create a fixture topic.' });
  const root = await post('root', actor, 'Field guide dossier', { divergence_reason: 'Create a sample dossier.' });
  const reply = await post('reply', agent, 'The field guide is ready for review.',
    { reply_to: root, reply_without_quote: 'Answer the example.' });
  const act = (kind, operation, args) => committed({ method: 'stack_act', kind,
    operation_id: 'light-' + operation, sender: agent, message_id: root, args });
  const stands = 'The trail map is ready. The handout is with the team.';
  const doneWhen = 'The field team approves the handout. Then we publish it.';
  const what = '👋 **Trail map** and printable handout. Take one on the walk.';
  const whatExcerpt = '👋 **Trail map** and printable handout.';
  await act('stack.birth', 'birth', { reply_id: reply, nature: 'feature', stands, done_when: doneWhen });
  const cover = await act('stack.cover', 'cover', { sections: { what, when: 'Friday morning.' },
    payload: { kind: 'preview', text: 'Field guide preview', link: 'https://example.test/guide', message_id: reply } });
  browser = await chromium.launch({ executablePath: process.env.AIM_CHROME, headless: true });
  for (const width of [1280, 390]) for (const scheme of ['light', 'dark']) {
    const phone = width < 760;
    const context = await browser.newContext({ viewport: { width, height: 900 }, colorScheme: scheme,
      isMobile: phone, hasTouch: phone, reducedMotion: 'reduce' });
    const page = await context.newPage(), pageErrors = [];
    page.setDefaultTimeout(8000);
    page.on('pageerror', error => pageErrors.push(error.message));
    try {
      if (scheme === 'light') await context.addInitScript(() => localStorage.setItem('theseus-look', 'paper'));
      await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin });
      await page.goto(origin + '/?topic=' + topic);
      await page.locator('body[data-ready=true]').waitFor();
      const sheet = page.locator(`#messages > .reply-stack[data-stack="${root}"] > .dossier-cover`);
      const lead = sheet.locator('.cover-stands');
      const criterion = sheet.locator('[data-cover-quote-part=done_when]');
      const whatField = sheet.locator('.cover-structured-section').first();
      const peek = whatField.locator('.cover-section-peek');
      const label = whatField.locator('.cover-section-label');
      const footer = sheet.locator('.cover-help summary');
      await footer.waitFor();

      const lit = () => page.evaluate(() => [...(CSS.highlights.get('cover-lit-passage') ?? [])].map(range => range.toString()));
      const hoverFirstWord = async locator => {
        await locator.scrollIntoViewIfNeeded();
        const point = await locator.evaluate(node => {
          const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT);
          let text;
          while ((text = walker.nextNode()) && !text.data.trim()) { /* locate the first authored text node */ }
          const range = document.createRange();
          range.setStart(text, 0);
          range.setEnd(text, Math.min(2, text.length));
          const box = range.getBoundingClientRect();
          return { x: box.left + box.width / 2, y: box.top + box.height / 2 };
        });
        await page.mouse.move(point.x, point.y);
      };
      assert.deepEqual(await lit(), []);
      if (phone) {
        await label.tap();
        assert.equal(await whatField.evaluate(node => node.open), true);
        assert.deepEqual(await lit(), []);
        await label.tap();
        assert.equal(await whatField.evaluate(node => node.open), false);
        await page.evaluate(() => document.activeElement.blur());
      }
      await hoverFirstWord(label);
      assert.deepEqual(await lit(), []);
      await hoverFirstWord(peek);
      assert.deepEqual(await lit(), ['👋 Trail map and printable handout.']);
      await sheet.screenshot({ path: join(output, `cover-${width}-${scheme}-peek.png`) });
      const copy = await page.evaluate(() => /mac|iphone|ipad|ipod/i.test(navigator.userAgentData?.platform || navigator.platform)) ? 'Meta+c' : 'Control+c';
      await page.evaluate(() => navigator.clipboard.writeText(''));
      await page.keyboard.press(copy);
      await page.waitForFunction(excerpt => navigator.clipboard.readText().then(text => text === excerpt), whatExcerpt);
      await label.click();
      assert.equal(await whatField.evaluate(node => node.open), true);
      assert.deepEqual(await lit(), []);
      await page.keyboard.press('Enter');
      assert.equal(await whatField.evaluate(node => node.open), false, 'the focused disclosure owns Return');
      await label.click();
      await hoverFirstWord(whatField.locator('.cover-section-body'));
      assert.equal((await lit())[0].trim(), '👋 Trail map and printable handout.');
      await hoverFirstWord(sheet.locator('.cover-criterion .cover-label'));
      assert.deepEqual(await lit(), []);
      await hoverFirstWord(criterion);
      assert.equal((await lit())[0].trim(), 'The field team approves the handout.');
      await sheet.screenshot({ path: join(output, `cover-${width}-${scheme}-criterion.png`) });
      await hoverFirstWord(lead);
      assert.equal((await lit())[0].trim(), 'The trail map is ready.');
      const colors = await sheet.evaluate(node => {
        const read = () => {
          const style = getComputedStyle(node);
          return [style.getPropertyValue('--pointer-lit-field').trim() || style.getPropertyValue('--lit-field').trim(),
            style.getPropertyValue('--light-words').trim() || '#fff'];
        };
        const root = document.documentElement, original = root.dataset.lightColour;
        const choices = {};
        for (const choice of ['lighter', 'middle', 'darker']) { root.dataset.lightColour = choice; choices[choice] = read(); }
        root.dataset.lightColour = original;
        return choices;
      });
      assert.deepEqual(colors.middle, ['#000', '#fff']);
      assert.notEqual(colors.lighter[0], colors.middle[0]);
      assert.notEqual(colors.darker[0], colors.middle[0]);
      await page.evaluate(() => { document.documentElement.dataset.pointerLight = 'off'; });
      await hoverFirstWord(criterion);
      assert.deepEqual(await lit(), []);
      await page.evaluate(() => { document.documentElement.dataset.pointerLight = 'on'; document.activeElement.blur(); });
      if (width === 1280 && scheme === 'light') {
        await label.click();
        await page.evaluate(() => document.activeElement.blur());
        await hoverFirstWord(peek);
        await page.keyboard.press('Enter');
        const composer = page.locator(`#reply-${root}-composer`);
        const field = composer.locator('textarea').first();
        const prefix = '> ' + whatExcerpt + '\n\n';
        assert.equal(await field.inputValue(), prefix);
        assert.equal(await composer.locator('.cover-quote-attribution').textContent(), 'From the cover · What');
        await field.press('End');
        await field.pressSequentially('Ready to print.');
        await composer.locator(`#reply-${root}-send`).click();
        let sent;
        for (let check = 0; check < 60 && !sent; check++) {
          const pageRead = await control({ method: 'agent_view', actor, name: 'topic_messages',
            args: { topic_id: topic, direction: 'before', limit: 50 } });
          sent = pageRead.items.find(item => item.body?.includes('Ready to print.'));
          if (!sent) await page.waitForTimeout(100);
        }
        assert.ok(sent, 'the inline reply committed in Core');
        assert.equal(sent.reply_to, root);
        const source = await control({ method: 'agent_view', actor, name: 'source', args: { source_ref: { kind: 'message', id: sent.id } } });
        assert.deepEqual(source.quotes, [{ source: { kind: 'cover', id: root, revision: cover.cover_revision, part: 'section.what' },
          start: 0, end: Array.from(whatExcerpt).length, excerpt: whatExcerpt, section: 'What' }]);
      }
      await hoverFirstWord(lead);
      assert.ok((await lit()).length);
      if (phone && scheme === 'dark') {
        const revision = await act('stack.cover', 'refresh', { sections: { when: 'Friday at 9.' } });
        await page.locator(`[data-cover-quote-revision="${revision.cover_revision}"]`).waitFor();
        assert.deepEqual(await lit(), [], 'a new revision turns out light even on unchanged prose');
      }
      await hoverFirstWord(footer);
      assert.deepEqual(await lit(), []);
      report.push({ width, scheme, colors, pageErrors });
      assert.deepEqual(pageErrors, []);
      console.log('PASS', width, scheme);
    } catch (error) {
      await page.screenshot({ path: join(output, `failure-${width}-${scheme}.png`) }).catch(() => {});
      throw error;
    } finally { await context.close(); }
  }
} finally {
  await browser?.close();
  fixture.stdin.end();
  const result = await exit;
  await writeFile(join(output, 'report.json'), JSON.stringify({ report, fixture: result }, null, 2) + '\n');
  assert.deepEqual(result, { code: 0, signal: null });
  assert.equal(errors(), '');
}

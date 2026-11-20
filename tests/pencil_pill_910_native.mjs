// Actual index, styles and InlineComposer in an isolated local browser fixture.
// No production server, data, account or API is used. This measures the control,
// not real-device keyboard/clipboard behavior or full application navigation.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const [chrome, out] = process.argv.slice(2);
assert.ok(chrome?.endsWith('/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing'));
assert.ok(out && path.isAbsolute(out));
const { chromium } = createRequire(import.meta.url)(process.env.AIM_PLAYWRIGHT_CORE);
const web = fileURLToPath(new URL('../web/', import.meta.url));
await mkdir(out, { recursive: true });
const server = createServer(async (request, response) => {
  try {
    const name = new URL(request.url, 'http://localhost').pathname.slice(1) || 'index.html';
    assert.ok(!name.includes('..'));
    let bytes = await readFile(path.join(web, name));
    if (name === 'index.html') bytes = Buffer.from(bytes.toString().replace(/<script\b[^>]*>[\s\S]*?<\/script>/g, ''));
    response.setHeader('Content-Type', name.endsWith('.css') ? 'text/css' : name.endsWith('.mjs') ? 'text/javascript' : 'text/html');
    response.end(bytes);
  } catch { response.writeHead(404); response.end(); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
let browser;
const results = [];
try {
  browser = await chromium.launch({ executablePath: chrome, headless: true });
  for (const width of [320, 390, 1280]) for (const colorScheme of ['light', 'dark']) {
    const context = await browser.newContext({ viewport: { width, height: 900 }, colorScheme, hasTouch: width < 760 });
    const page = await context.newPage(), errors = [];
    page.setDefaultTimeout(5000);
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(`http://127.0.0.1:${server.address().port}/`);
    await page.evaluate(async () => {
      const { InlineComposer } = await import('/inline-composer.mjs');
      const { Editor } = await import('/editor.mjs');
      document.querySelector('#rail').hidden = true;
      document.querySelector('#topic-title').textContent = 'Pill check';
      const root = document.querySelector('#inline-composer');
      for (const child of document.querySelector('main').children)
        if (!child.contains(root) && !child.contains(document.querySelector('#new-message'))) child.hidden = true;
      const editor = new Editor({ instanceId: 'fixture-910', actor: 'fixture-person', kind: 'reply', sourceRef: { kind: 'topic', id: 't-fixture' }, topicId: 't-fixture' },
        { id: 'd-fixture', generation: 'g', revision: 1, body: '' });
      const composer = new InlineComposer({
        instanceId: 'fixture-910', notebook: { mayWrite: true }, admits: () => true,
        edit: () => {}, status: () => 'Saved', sign: () => '', needsReview: () => false,
        uploads: () => ({ current: () => [], running: new Map(), status: () => 'Ready' }),
        renderPending: () => {}, actorLabel: name => name,
        people: () => ({ everyone: [], members: () => [], kindOf: () => 'person' }),
      });
      composer.show({ topic: { id: 't-fixture', title: 'Pill check' }, editors: { reply: editor } });
      window.fixture910 = composer;
    });
    for (const place of ['inline', 'sheet']) {
      if (place === 'sheet') await page.locator('#new-message').click();
      const note = page.locator('#inline-kind-note-card');
      assert.equal(await note.getAttribute('aria-checked'), 'true', `${place} defaults to Note`);
      assert.equal(await note.innerText(), 'Note');
      assert.equal(await page.locator('#inline-kind [role=radio]').count(), 2);
      await page.locator('#inline-writing-body').fill('Kept title\nKept words');
      await page.locator('#inline-writing-body').evaluate(field => field.setSelectionRange(1, 4));
      await page.locator('#inline-kind-message').click();
      const metric = await page.evaluate(() => {
        const pill = document.querySelector('#inline-kind'), chip = document.querySelector('#inline-who-chip');
        const root = document.querySelector('#inline-composer'), title = document.querySelector('#inline-writing-title');
        const field = document.querySelector('#inline-writing-body');
        const p = pill.getBoundingClientRect(), c = chip.getBoundingClientRect(), r = root.getBoundingClientRect();
        return { pillHeight: p.height, chipHeight: c.height,
          pillRadius: getComputedStyle(pill).borderRadius, chipRadius: getComputedStyle(chip).borderRadius,
          centerDelta: Math.abs((p.left + p.right) / 2 - (r.left + r.right) / 2),
          pillTop: p.top, fieldTop: field.getBoundingClientRect().top,
          clippedTitle: getComputedStyle(title).clip, titleText: title.textContent,
          label: document.querySelector('#new-message-sheet').getAttribute('aria-labelledby'),
          value: field.value, start: field.selectionStart, end: field.selectionEnd,
          checked: [...pill.querySelectorAll('button')].map(button => button.getAttribute('aria-checked')) };
      });
      await writeFile(path.join(out, `${width}-${colorScheme}-${place}.json`), JSON.stringify(metric, null, 2) + '\n');
      await page.locator('#inline-composer').screenshot({ path: path.join(out, `${width}-${colorScheme}-${place}.png`) });
      assert.equal(metric.pillHeight, metric.chipHeight, 'pill and Everyone here have the same rendered height');
      assert.equal(metric.pillRadius, metric.chipRadius, 'pill and chip use the same rendered radius');
      assert.ok(metric.centerDelta <= 1, 'pill centered within one pixel');
      assert.ok(metric.pillTop < metric.fieldTop, 'pill is above writing');
      assert.equal(metric.clippedTitle, 'rect(0px, 0px, 0px, 0px)');
      assert.equal(metric.titleText, 'New message'); assert.equal(metric.label, 'inline-writing-title');
      assert.equal(metric.value, 'Kept title\nKept words'); assert.equal(metric.start, 1); assert.equal(metric.end, 4);
      assert.deepEqual(metric.checked, ['true', 'false']);
      await page.locator('#inline-kind-message').press('ArrowRight');
      assert.equal(await note.getAttribute('aria-checked'), 'true');
      assert.equal(await page.locator('#inline-send .send-word').innerText(), 'Start page');
      await page.locator('#inline-composer').screenshot({ path: path.join(out, `${width}-${colorScheme}-${place}.png`) });
      results.push({ width, colorScheme, place, ...metric });
    }
    assert.deepEqual(errors, []);
    await context.close();
  }
  await writeFile(path.join(out, 'results.json'), JSON.stringify({ cases: results.length, results }, null, 2) + '\n');
  console.log(`${results.length} rendered pill cases passed`);
} finally {
  if (browser) await browser.close();
  await new Promise(resolve => server.close(resolve));
}

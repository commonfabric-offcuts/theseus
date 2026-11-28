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
const report = { previews: [], paging: [] };
let browser;
try {
  const { origin, actor } = await control({ method: 'ready' });
  const sample = 'trash-fold-preview', paged = 'trash-fold-paged', empty = 'trash-fold-empty', uncertain = 'trash-fold-uncertain';
  await control({ method: 'navigation_topics', topics: [sample, paged, empty, uncertain].map(id => ({ id, title: 'Field guide' })) });
  const commit = async envelope => {
    const receipt = await control(envelope);
    assert.equal(receipt.status, 'committed', JSON.stringify(receipt));
    return receipt.result;
  };
  const record = async (topic, title, kind) => {
    const operation = topic + '-' + title;
    const root = await commit({ method: 'agent_message', topic_id: topic, source: 'topic', operation_id: operation,
      sender: actor, body: title, read: true, divergence_reason: 'Prepare isolated Trash rows.' });
    if (kind) {
      await commit({ method: 'stack_act', kind, operation_id: operation + '-act', sender: actor, message_id: root.message_id,
        args: kind === 'stack.trash' ? { trashed: true } : { through: (await control({ method: 'agent_view', actor,
          name: 'source', args: { source_ref: { kind: 'message', id: root.message_id } } })).seq } });
    }
    return root.message_id;
  };
  for (const title of ['Trail route', 'Volunteer notes']) await record(sample, title, 'stack.aside');
  for (const title of ['First map sketch', 'Duplicate handout', 'Previous route']) await record(sample, title, 'stack.trash');
  for (let index = 1; index <= 26; index++) await record(paged, `Discarded draft ${index}`, 'stack.trash');
  await record(empty, 'Current route');
  for (let index = 1; index <= 9; index++) {
    const id = await record(uncertain, `Restored draft ${index}`, 'stack.trash');
    await commit({ method: 'stack_act', kind: 'stack.trash', operation_id: 'restore-old-' + index,
      sender: actor, message_id: id, args: { trashed: false } });
  }
  browser = await chromium.launch({ executablePath: process.env.AIM_CHROME, headless: true });

  async function pageIn(context, topic) {
    const page = await context.newPage(), views = [], issues = [];
    page.setDefaultTimeout(9000);
    page.on('pageerror', error => issues.push(error.message));
    page.on('request', request => {
      if (new URL(request.url()).pathname === '/api/view') views.push(request.postDataJSON());
    });
    await page.goto(origin + '/?topic=' + topic);
    await page.locator('body[data-ready=true]').waitFor();
    return { page, views, issues };
  }
  const archive = views => views.filter(view => view?.name === 'dossier_archive');
  const trash = views => views.filter(view => view?.name === 'dossier_trash').map(view => view.args);
  const settled = page => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  for (const width of [1280, 390]) for (const look of ['bookends', 'paper']) for (const scheme of ['light', 'dark']) {
    const phone = width === 390;
    const context = await browser.newContext({ viewport: { width, height: 900 }, colorScheme: scheme, isMobile: phone,
      hasTouch: phone, reducedMotion: 'reduce' });
    try {
      await context.addInitScript(look => localStorage.setItem('theseus-look', look), look);
      const { page, views, issues } = await pageIn(context, sample);
      if (phone) {
        assert.equal(archive(views).length, 0, 'the closed phone rail starts no Archive read');
        assert.deepEqual(trash(views), []);
        await page.locator('#things-open').tap();
      }
      const shelf = page.locator('#things > .archive-shelf');
      await shelf.locator('.shelf-dossier').last().waitFor();
      const fold = shelf.locator('.archive-trash'), summary = fold.locator('summary');
      await summary.waitFor();
      assert.equal(await fold.evaluate(node => node.open), false);
      assert.equal(await summary.locator('.archive-shelf-count').textContent(), '');
      assert.equal(await fold.evaluate(node => node === node.parentElement.lastElementChild), true);
      assert.equal(await page.locator('html').getAttribute('data-look'), look === 'paper' ? 'paper' : null);
      assert.equal(await page.evaluate(() => matchMedia('(prefers-color-scheme: dark)').matches), scheme === 'dark');
      if (phone) assert.ok((await summary.boundingBox()).height >= 44);
      await settled(page);
      const initialArchive = archive(views).length;
      assert.equal(initialArchive, 1, 'the normal shelf reads Archive once');
      assert.deepEqual(trash(views), []);
      const closed = await shelf.screenshot({ animations: 'disabled' });
      if (phone) await summary.tap(); else { await summary.focus(); await page.keyboard.press('Enter'); }
      const rows = fold.locator('li');
      await rows.last().waitFor();
      assert.deepEqual(await rows.allTextContents(), ['Previous route', 'Duplicate handout', 'First map sketch']);
      assert.equal(await summary.locator('.archive-shelf-count').textContent(), '3');
      const countStyles = await shelf.locator('.archive-shelf-count').evaluateAll(counts =>
        counts.map(node => { const style = getComputedStyle(node); return [style.color, style.fontSize, style.fontWeight]; }));
      assert.deepEqual(countStyles[0], countStyles[1]);
      assert.equal(await fold.locator('li svg[data-glyph=trash][aria-hidden=true]').count(), 3);
      const lookOfRows = await rows.evaluateAll(elements => {
        const muted = getComputedStyle(elements[0].closest('details').querySelector('.archive-shelf-count')).color;
        return elements.map(row => ({ muted: getComputedStyle(row).color === muted, height: row.getBoundingClientRect().height }));
      });
      assert.ok(lookOfRows.every(row => row.muted && (!phone || row.height >= 44)));
      assert.equal(archive(views).length, initialArchive, 'opening Trash does not refresh Archive');
      assert.deepEqual(trash(views), [{ topic_id: sample, limit: 24 }]);
      await summary.evaluate(node => node.blur());
      await page.mouse.move(1, 1);
      const open = await shelf.screenshot({ animations: 'disabled' });
      if (phone) await summary.tap(); else { await summary.focus(); await page.keyboard.press('Enter'); }
      await rows.first().waitFor({ state: 'detached' });
      await settled(page);
      assert.equal(archive(views).length, initialArchive);
      assert.deepEqual(trash(views), [{ topic_id: sample, limit: 24 }], 'folding issues no reads');
      assert.deepEqual(issues, []);

      const comparison = await context.newPage();
      await comparison.setViewportSize({ width: Math.round(width === 390 ? 812 : 640), height: 900 });
      await comparison.setContent(`<style>
        html,body{margin:0;background:#e9e9e5;color:#222;font:14px system-ui}
        main{display:flex;align-items:flex-start;gap:12px;width:max-content;padding:12px}
        figure{margin:0}figcaption{margin-bottom:6px;font-weight:600}img{display:block;border:1px solid #8885}
        </style><main><figure><figcaption>Folded</figcaption><img src="data:image/png;base64,${closed.toString('base64')}"></figure>
        <figure><figcaption>Open</figcaption><img src="data:image/png;base64,${open.toString('base64')}"></figure></main>`);
      const preview = `trash-${width}-${look}-${scheme}.png`;
      await comparison.locator('main').screenshot({ path: join(output, preview) });
      report.previews.push({ width, look, scheme, preview, initialArchive, additionalArchive: archive(views).length - initialArchive,
        foldedTrash: 0, openedTrash: trash(views) });
      console.log('PASS', width, look, scheme);
    } finally { await context.close(); }
  }

  const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, reducedMotion: 'reduce' });
  try {
    let failMore = true;
    await context.route('**/api/view', route => {
      const view = route.request().postDataJSON();
      if (view?.name === 'dossier_trash' && view?.args?.cursor && failMore) {
        failMore = false;
        return route.fulfill({ json: { error: { code: 'TEST_READ_REFUSED', message: 'Synthetic one-time refusal.' } } });
      }
      return route.continue();
    });
    const { page, views, issues } = await pageIn(context, paged);
    const shelf = page.locator('#things > .archive-shelf'), fold = shelf.locator('.archive-trash');
    const summary = fold.locator('summary'), rows = fold.locator('li'), more = fold.locator('button');
    await summary.waitFor();
    assert.equal(await shelf.locator('.archive-shelf-head').isVisible(), false);
    assert.deepEqual(trash(views), []);
    await summary.click();
    await rows.nth(23).waitFor();
    assert.equal(await rows.count(), 24);
    assert.equal(await summary.locator('.archive-shelf-count').textContent(), '');
    assert.equal(await shelf.locator('.shelf-views').isVisible(), false);
    await more.click();
    await fold.getByText('Could not load Trash.').waitFor();
    assert.equal(await rows.count(), 24);
    await more.click();
    await rows.nth(25).waitFor();
    assert.equal(await rows.count(), 26);
    assert.equal(await summary.locator('.archive-shelf-count').textContent(), '26');
    assert.equal(await more.isVisible(), false);
    assert.deepEqual(await rows.allTextContents(), Array.from({ length: 26 }, (_, index) => `Discarded draft ${26 - index}`));
    const reads = trash(views);
    assert.equal(reads.length, 3);
    assert.deepEqual(reads[0], { topic_id: paged, limit: 24 });
    assert.ok(Number.isSafeInteger(reads[1].cursor) && reads[1].cursor > 0);
    assert.deepEqual(reads[2], reads[1]);
    report.paging = reads;
    const emptyArchive = page.waitForResponse(response => {
      if (new URL(response.url()).pathname !== '/api/view') return false;
      const view = response.request().postDataJSON();
      return view?.name === 'dossier_archive' && view?.args?.topic_id === empty;
    });
    await page.goto(origin + '/?topic=' + empty);
    assert.equal((await (await emptyArchive).json()).trash_empty, true);
    await settled(page);
    assert.equal(await shelf.isVisible(), false);
    assert.deepEqual(trash(views), reads);
    await page.goto(origin + '/?topic=' + uncertain);
    await summary.waitFor();
    assert.equal(await shelf.locator('.archive-shelf-head').isVisible(), false);
    assert.deepEqual(trash(views), reads);
    await summary.click();
    await fold.getByText('Trash is empty.').waitFor();
    assert.equal(await rows.count(), 0);
    assert.equal(await more.isVisible(), false);
    assert.deepEqual(trash(views).at(-1), { topic_id: uncertain, limit: 24 });
    const openedReads = trash(views);
    await summary.focus();
    await page.keyboard.press('Enter');
    await shelf.waitFor({ state: 'hidden' });
    assert.equal(await page.evaluate(() => document.activeElement?.closest('#things') !== null), true);
    assert.deepEqual(trash(views), openedReads);
    assert.deepEqual(issues, []);
    console.log('PASS bounded paging, retry, Trash-only, proven empty, and uncertain empty states');
  } finally { await context.close(); }

  const phone = await browser.newContext({ viewport: { width: 390, height: 900 }, isMobile: true, hasTouch: true, reducedMotion: 'reduce' });
  try {
    const { page, views, issues } = await pageIn(phone, empty);
    const first = page.waitForResponse(response => new URL(response.url()).pathname === '/api/view' &&
      response.request().postDataJSON()?.name === 'dossier_archive');
    await page.locator('#things-open').tap();
    assert.equal((await (await first).json()).trash_empty, true);
    await settled(page);
    const shelf = page.locator('#things > .archive-shelf');
    assert.equal(await shelf.isVisible(), false);
    assert.deepEqual(trash(views), []);
    await page.goto(origin + '/?topic=' + paged);
    await page.locator('#things-open').tap();
    const summary = shelf.locator('.archive-trash > summary');
    await summary.waitFor();
    assert.equal(await shelf.locator('.archive-shelf-head').isVisible(), false);
    assert.deepEqual(trash(views), []);
    await summary.tap();
    await shelf.locator('.archive-trash-rows > li').nth(23).waitFor();
    assert.deepEqual(trash(views), [{ topic_id: paged, limit: 24 }]);
    assert.deepEqual(issues, []);
    console.log('PASS phone empty shelf and standalone Trash row');
  } finally { await phone.close(); }
} finally {
  await browser?.close();
  fixture.stdin.end();
  report.fixture = await exit;
  await writeFile(join(output, 'report.json'), JSON.stringify(report, null, 2) + '\n');
  assert.deepEqual(report.fixture, { code: 0, signal: null });
  assert.equal(errors(), '');
}

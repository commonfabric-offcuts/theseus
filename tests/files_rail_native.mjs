import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fixtureControl } from './fixture_control.mjs';
import { paintedBand, pngPixels } from './png-bands.mjs';

const [out, widthText = '1280', scheme = 'light', look = 'bookends'] = process.argv.slice(2);
const width = Number(widthText), phone = width < 760;
await mkdir(out, { recursive: true });
const report = { width, scheme, look, requests: [], checks: [] };
const fixture = spawn('/usr/bin/python3', ['-B', 'tests/fixtures/ui_http.py', '--freshness', '--live']);
const { control, exit, errors } = fixtureControl(fixture);
const { chromium } = await import(process.env.AIM_PLAYWRIGHT_CORE);
const encodedPdf = await readFile(new URL('./fixtures/rail-preview.pdf.b64', import.meta.url), 'utf8');
const pdf = Buffer.from(encodedPdf, 'base64').toString('ascii');
const name = 'Harbor site plan and reference drawings with accessibility notes.pdf';
const plain = 'Fixture field notes.\n';
let browser, page;
try {
  const { origin } = await control({ method: 'ready' });
  const posted = await control({ method: 'agent_message', source: 'topic', sender: 'person',
    operation_id: 'fixture-rail-files', topic_id: 't1', body: 'Reference files for the sample plan.',
    attachments: [{ name, pdf }, { name: 'Harbor diagram.png', png: [70, 40] }] });
  assert.equal(posted.status, 'committed');
  const saved = await control({ method: 'outcome_reference', operation_id: 'fixture-notebook-files', item_id: 'file-references',
    title: 'Harbor references', body: 'Reference attachments for the synthetic plan.',
    attachments: [{ name, pdf }, { name: 'Harbor diagram.png', png: [70, 40] }, { name: 'Field notes.txt', text: plain }] });
  assert.equal(saved.status, 'committed');
  browser = await chromium.launch({ executablePath: process.env.AIM_CHROME, headless: true });
  report.browser = browser.version();
  const context = await browser.newContext({ viewport: { width, height: 940 }, colorScheme: scheme,
    isMobile: phone, hasTouch: phone, acceptDownloads: true });
  await context.addInitScript(paper => { if (paper) localStorage.setItem('theseus-look', 'paper'); }, look === 'paper');
  page = await context.newPage();
  await page.route('**/*', route => {
    const url = new URL(route.request().url());
    return url.origin === origin || url.protocol === 'blob:' ? route.continue() : route.abort();
  });
  page.setDefaultTimeout(9000);
  const pageErrors = [];
  page.on('pageerror', error => pageErrors.push(error.message));
  page.on('request', request => {
    if (new URL(request.url()).pathname === '/api/media/read') report.requests.push(request.postDataJSON());
  });
  const press = locator => phone ? locator.tap() : locator.click();
  const readsOf = id => report.requests.filter(request => request.media_id === id);
  const download = async (activate, id, expectedName, content, source) => {
    const before = readsOf(id).length;
    const [savedFile] = await Promise.all([page.waitForEvent('download'), activate()]);
    assert.equal(savedFile.suggestedFilename(), expectedName);
    assert.deepEqual(await readFile(await savedFile.path()), Buffer.from(content));
    assert.equal(readsOf(id).length, before + 1);
    for (const [key, value] of Object.entries(source)) assert.equal(readsOf(id).at(-1).source_ref[key], value);
  };
  const preview = async (activate, sourceId, tag) => {
    const [popup, response] = await Promise.all([
      context.waitForEvent('page'),
      context.waitForEvent('response', { predicate: response => new URL(response.url()).pathname === '/api/media/pdf-preview' }),
      activate(),
    ]);
    assert.equal(response.status(), 200);
    const request = response.request(), headers = response.headers(), fields = new URLSearchParams(request.postData());
    assert.equal(request.method(), 'POST');
    assert.equal((await request.allHeaders()).origin, origin);
    assert.equal((await request.allHeaders()).authorization, undefined);
    assert.equal(fields.get('message_id'), sourceId);
    assert.equal(fields.get('media_id'), 'fixture-rail-files-media-0');
    assert.equal(fields.get('sha256'), createHash('sha256').update(pdf).digest('hex'));
    assert.match(headers['content-disposition'], /^inline;/);
    assert.equal(headers['content-type'], 'application/pdf');
    assert.equal(headers['cache-control'], 'no-store');
    assert.equal(headers['x-content-type-options'], 'nosniff');
    assert.equal(headers['x-frame-options'], 'DENY');
    assert.equal(headers['referrer-policy'], 'no-referrer');
    // Chromium's native PDF viewer preserves frame-ancestors and may remove the other directives.
    // The direct HTTP tests assert the complete policy emitted by Core.
    assert.match(headers['content-security-policy'], /(?:^|; )frame-ancestors 'none'(?:;|$)/);
    await popup.waitForURL(origin + '/api/media/pdf-preview');
    assert.equal(await popup.evaluate(() => window.opener === null), true);
    await popup.bringToFront();
    const path = out + '/native-pdf-' + tag + '.png';
    let paint;
    const deadline = Date.now() + 5000;
    do {
      const pixels = pngPixels(await popup.screenshot({ path }));
      paint = paintedBand(pixels, pixels.width * 0.6, 0, pixels.height / 2, [0, 102, 255]);
    } while ((!paint || paint.height < 25) && Date.now() < deadline);
    assert.ok(paint && paint.height >= 25, 'The native viewer painted the PDF fixture');
    report.preview ??= [];
    report.preview.push({ tag, status: response.status(), headers, paint });
    assert.equal(readsOf('fixture-rail-files-media-0').length, 0);
    await popup.close();
  };
  await page.goto(origin + '/?topic=t1');
  await page.locator('body[data-ready=true]').waitFor();
  assert.equal(await page.locator('html').getAttribute('data-look'), look === 'paper' ? 'paper' : null);
  if (phone) await press(page.locator('#things-open'));
  const section = page.locator('#things details[data-key="images"]');
  await section.getByText('Files', { exact: true }).waitFor();
  if (await section.getAttribute('open') === null) await press(section.locator('summary button').first());
  const tile = section.getByRole('treeitem', { name, exact: true });
  await tile.waitFor();
  const railImage = section.locator('img.image-thumb:not([hidden])');
  await railImage.waitFor();
  assert.equal(readsOf('fixture-rail-files-media-0').length, 0);
  assert.equal(await tile.getAttribute('title'), name);
  assert.equal(await tile.locator('.file-name').textContent(), name.slice(0, -4));
  const style = await tile.evaluate(node => {
    const box = node.getBoundingClientRect();
    return { delta: Math.abs(box.width - box.height), ground: getComputedStyle(node).backgroundColor,
      imageGround: getComputedStyle(node.parentNode.querySelector('[data-rail-image]')).backgroundColor,
      columns: getComputedStyle(node.parentNode).gridTemplateColumns.split(' ').length,
      glyph: node.querySelector('svg').getBoundingClientRect().width,
      lines: getComputedStyle(node.querySelector('.file-name')).webkitLineClamp };
  });
  assert.equal(style.columns, 3);
  assert.ok(style.delta <= 1, JSON.stringify(style));
  assert.equal(style.glyph, 14);
  assert.equal(await tile.locator('svg path').getAttribute('d'), 'M4 1.5h5.5L13 5v9.5H4z M9.5 1.5V5H13');
  assert.equal(style.lines, '3');
  assert.equal(style.ground, style.imageGround);
  assert.equal(style.ground, look === 'bookends' ? 'rgb(16, 16, 16)' : scheme === 'light' ? 'rgb(217, 217, 213)' : 'rgb(27, 31, 32)');
  report.style = style;
  await tile.scrollIntoViewIfNeeded();
  await page.screenshot({ path: out + '/files-rail.png' });
  const messageRef = { kind: 'message', id: posted.result.message_id };
  await preview(() => press(tile), messageRef.id, 'pointer');
  if (!phone) {
    await tile.focus();
    await page.keyboard.press('Tab');
    await page.keyboard.press('Shift+Tab');
    assert.equal(await tile.evaluate(node => document.activeElement === node), true);
    assert.equal(await tile.evaluate(node => getComputedStyle(node).outlineWidth), '2px');
    await page.screenshot({ path: out + '/files-rail-focus.png' });
    await preview(() => page.keyboard.press('Enter'), messageRef.id, 'return');
  }
  report.checks.push('Files opens an authorized sandboxed PDF in its native viewer with the same tile geometry.');
  await page.goto(origin + '/?topic=t1&page=file-references');
  const sheet = page.locator('.notebook-sheet-page:not([hidden])');
  const pdfButton = sheet.getByRole('button', { name: 'Open ' + name, exact: true });
  const textButton = sheet.getByRole('button', { name: 'Open Field notes.txt', exact: true });
  const image = sheet.locator('.notebook-image img.image-thumb:not([hidden])');
  await pdfButton.waitFor();
  await image.waitFor();
  assert.equal(await pdfButton.evaluate(node => node.scrollWidth <= node.clientWidth + 1), true);
  assert.equal(readsOf('fixture-notebook-files-media-0').length, 0);
  assert.equal(readsOf('fixture-notebook-files-media-2').length, 0);
  assert.ok(readsOf('fixture-notebook-files-media-1').length > 0);
  await pdfButton.scrollIntoViewIfNeeded();
  await page.screenshot({ path: out + '/notebook-attachments.png' });
  const pageRef = { kind: 'memory', id: 'file-references', revision: 1 };
  await download(() => press(pdfButton), 'fixture-notebook-files-media-0', name, pdf, pageRef);
  await download(() => press(textButton), 'fixture-notebook-files-media-2', 'Field notes.txt', plain, pageRef);
  const [popup] = await Promise.all([context.waitForEvent('page'), press(image)]);
  await popup.waitForLoadState();
  assert.match(popup.url(), /^blob:/);
  await popup.close();
  report.checks.push('Notebook files wait for click or tap, and the existing image opens from its thumbnail.');
  assert.deepEqual(pageErrors, []);
  report.served = {};
  for (const file of ['aim.css', 'api.mjs', 'attachment-open.mjs', 'notebook-page.mjs', 'rails.css', 'things-rail.mjs']) {
    const response = await context.request.get(origin + '/' + file);
    assert.ok(response.ok(), file);
    const bytes = await response.body();
    assert.deepEqual(bytes, await readFile('web/' + file), file);
    report.served[file] = createHash('sha256').update(bytes).digest('hex');
  }
} catch (error) {
  report.failure = error.stack;
  if (page) await page.screenshot({ path: out + '/failure.png' }).catch(() => {});
  throw error;
} finally {
  await browser?.close();
  fixture.stdin.end();
  report.fixture = await exit;
  report.fixtureErrors = errors();
  await writeFile(out + '/report.json', JSON.stringify(report, null, 2) + '\n');
  assert.deepEqual(report.fixture, { code: 0, signal: null });
  assert.equal(report.fixtureErrors, '');
}

import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fixtureControl } from './fixture_control.mjs';

const [directory, widthArg = '1280', scheme = 'light', look = 'bookends'] = process.argv.slice(2);
const width = Number(widthArg), phone = width < 760, height = phone ? 844 : 910;
assert.ok(directory && [1280, 390].includes(width));
await mkdir(directory, { recursive: true });
const { chromium } = await import(process.env.AIM_PLAYWRIGHT_CORE);
const fixture = spawn('/usr/bin/python3', ['-B', 'tests/fixtures/ui_http.py', '--freshness', '--live',
  '--teardown-observations', directory + '/teardown.jsonl']);
const { control, exit, errors } = fixtureControl(fixture);
const report = { width, height, scheme, look, surfaces: [], errors: [] };
let browser, page;

const hash = bytes => createHash('sha256').update(bytes).digest('hex');

try {
  const { origin, actor, agent } = await control({ method: 'ready' });
  const topic = 'fixture-inline-card-image', note = 'fixture-inline-card-notebook';
  const attachments = [{ name: 'Landscape.png', png: [960, 440] }, { name: 'Tall study.png', png: [70, 770] }];
  const post = async data => {
    const receipt = await control({ method: 'agent_message', sender: agent, topic_id: topic, source: 'topic',
      addressees: [actor], intent: 'tell', ...data });
    assert.equal(receipt.status, 'committed', JSON.stringify(receipt));
    return receipt.result.message_id;
  };
  await control({ method: 'navigation_topics', topics: [{ id: topic, title: 'Illustration studies' }] });
  const root = await post({ operation_id: '41-dossier', join: true,
    divergence_reason: 'Synthetic image expansion fixture.', body: 'Two illustrations for the card layout.' });
  const message = await post({ operation_id: '41-dossier-pictures', reply_to: root,
    reply_without_quote: 'Pair the landscape and tall study.',
    body: 'The landscape study and a tall alternative.', attachments });
  assert.equal((await control({ method: 'stack_act', sender: agent, kind: 'stack.name', message_id: root,
    operation_id: '41-name', args: { name: 'Illustration studies' } })).status, 'committed');
  const body = '## Illustration studies\n\nThe landscape study and a tall alternative.\n' +
    attachments.map(({ name }, index) => '![' + name + '](attachment:41-notebook-pictures-media-' + index + ')').join('\n') +
    '\n\n## Composition notes\n\nThe notes below the images stay with the card list.';
  assert.equal((await control({ method: 'outcome_reference', operation_id: '41-notebook-pictures',
    item_id: note, title: 'Illustration notebook', body, attachments })).status, 'committed');

  browser = await chromium.launch({ executablePath: process.env.AIM_CHROME });
  report.browser = browser.version();
  const createContext = async () => {
    const context = await browser.newContext({ viewport: { width, height }, colorScheme: scheme,
      isMobile: phone, hasTouch: phone, reducedMotion: 'reduce' });
    await context.addInitScript(paper => { if (paper) localStorage.setItem('theseus-look', 'paper'); }, look === 'paper');
    await context.addInitScript(() => {
      const fetch = window.fetch.bind(window);
      window.imageReads = [];
      window.fetch = async (url, options) => {
        if (new URL(url, location.href).pathname !== '/api/media/read') return fetch(url, options);
        const row = { request: JSON.parse(options.body) };
        window.imageReads.push(row);
        const response = await fetch(url, options);
        row.status = response.status;
        row.descriptor = JSON.parse(response.headers.get('x-aim-media'));
        // Count and hash a clone of the actual verified response. This uses
        // the same request and leaves the application's stream for its reader.
        response.clone().arrayBuffer().then(async bytes => {
          row.bytes = bytes.byteLength;
          const digest = await crypto.subtle.digest('SHA-256', bytes);
          row.sha256 = [...new Uint8Array(digest)].map(value => value.toString(16).padStart(2, '0')).join('');
        }).catch(error => { row.error = String(error); });
        return response;
      };
    });
    return context;
  };
  const layout = async image => image.evaluate(img => {
    const area = img.parentElement.parentElement.getBoundingClientRect(), picture = img.getBoundingClientRect();
    const style = getComputedStyle(img);
    return { width: picture.width, height: picture.height, top: picture.top, bottom: picture.bottom, left: picture.left,
      areaWidth: area.width, naturalWidth: img.naturalWidth, naturalHeight: img.naturalHeight,
      cursor: style.cursor, border: style.borderTopWidth,
      radius: style.borderRadius === '0px' ? getComputedStyle(img.parentElement).borderRadius : style.borderRadius, title: img.title,
      src: img.src, expanded: img.parentElement.hasAttribute('data-image-expanded'),
      focused: document.activeElement === img, documentWidth: document.documentElement.scrollWidth,
      outline: style.outlineWidth, outlineColor: style.outlineColor,
      focusColor: style.getPropertyValue('--focus').trim(), scroll: window.scrollY };
  });
  for (const surface of [
    { label: 'notebook', route: '/?topic=t1&page=' + note, selector: '.notebook-sheet .deck-card .deck-image', sourceKind: 'memory',
      sourceId: note, media: '41-notebook-pictures' },
    { label: 'dossier', route: '/?topic=' + topic, selector: '.reply-stack .message-card[data-id="' + message + '"] .card-image',
      sourceKind: 'message', sourceId: message, media: '41-dossier-pictures' },
  ]) {
    const result = { surface: surface.label, media: [], steps: [] };
    report.surfaces.push(result);
    const context = await createContext();
    try {
      page = await context.newPage();
      page.setDefaultTimeout(9000);
      page.on('pageerror', error => report.errors.push(error.stack));
      const route = origin + surface.route;
      await page.goto(route);
      await page.locator('body[data-ready=true]').waitFor();
      const images = page.locator(surface.selector + ' > img.image-thumb');
      const decoded = async image => {
        await image.waitFor();
        await image.evaluate(img => img.decode());
      };
      const reveal = target => target.evaluate(el => el.scrollIntoView({ block: 'nearest', behavior: 'instant' }));
      const first = images.nth(0), tall = images.nth(1);
      await Promise.all([decoded(first), decoded(tall)]);
      await reveal(first);
      await page.waitForFunction(() => window.imageReads.length >= 2 && window.imageReads.every(row => row.sha256 || row.error));
      result.media = await page.evaluate(() => window.imageReads);
      assert.equal(await images.count(), 2);
      assert.equal(await page.locator('html').getAttribute('data-look'), look === 'paper' ? 'paper' : null);
      const firstHost = page.locator(surface.selector).nth(0), tallHost = page.locator(surface.selector).nth(1);
      const earlier = await layout(first);
      assert.equal(earlier.expanded, false);
      assert.equal(earlier.cursor, 'zoom-in');
      assert.ok(earlier.width >= 44 && earlier.height >= 44);
      const imageIds = new Set(result.media.map(row => row.request.media_id));
      assert.deepEqual([...imageIds].sort(), [0, 1].map(n => surface.media + '-media-' + n));
      for (const row of result.media) {
        assert.equal(row.status, 200);
        assert.equal(row.request.source_ref.kind, surface.sourceKind);
        assert.equal(row.request.source_ref.id, surface.sourceId);
        assert.equal(row.bytes, row.descriptor.size_bytes);
        assert.equal(row.sha256, row.descriptor.sha256);
      }
      const countBefore = result.media.length;
      const take = name => page.screenshot({ path: directory + '/' + surface.label + '-' + name + '.png' });
      await take('folded');
      const press = control => phone ? control.tap() : control.click();
      const tabFrom = async (act, image) => {
        const src = (await layout(image)).src, destination = page.url();
        const pending = context.waitForEvent('page').then(value => ({ value }), error => ({ error }));
        await act();
        const { value, error } = await pending;
        assert.ok(value, error?.stack);
        await value.waitForLoadState('domcontentloaded');
        assert.equal(value.url(), src);
        assert.equal(await value.evaluate(() => window.opener), null);
        await value.close();
        await page.bringToFront();
        assert.equal(page.url(), destination);
      };
      const expand = async (image, key = null) => {
        await reveal(image);
        if (key) await image.focus();
        const before = await layout(image), tabs = context.pages().length;
        assert.equal(before.expanded, false);
        if (key) {
          assert.equal(before.focused, true);
          await page.keyboard.press(key);
        } else await press(image);
        const after = await layout(image);
        assert.equal(after.expanded, true);
        assert.equal(after.src, before.src);
        assert.equal(after.cursor, 'pointer');
        assert.equal(after.title, 'Open in a new tab');
        assert.equal(after.border, '1px');
        assert.equal(after.radius, before.radius);
        assert.ok(Math.abs(after.top - before.top) <= 2, JSON.stringify({ before, after }));
        assert.ok(after.width <= after.areaWidth + 1);
        assert.ok(after.height <= height * .8 + 1);
        assert.ok(Math.abs((after.width - 2) / (after.height - 2) - after.naturalWidth / after.naturalHeight) < .03);
        assert.equal(after.focused, true);
        assert.equal(after.outline, '2px');
        assert.equal(context.pages().length, tabs);
        assert.ok(after.documentWidth <= width + 2);
        assert.equal(await page.locator('#reader[open], .card-reply-composer:not([hidden]), .deck-writing').count(), 0);
        result.steps.push({ action: 'expand', target: key ?? 'press', before, after });
      };
      const row = host => host.locator('.card-image-actions');
      const actions = row(firstHost);
      const fold = actions.getByRole('button', { name: 'Fold', exact: true });
      const open = actions.getByRole('button', { name: 'Open in new tab', exact: true });
      await expand(first);
      assert.ok(Math.abs((await layout(first)).width - (await layout(first)).areaWidth) <= 1);
      assert.deepEqual(await actions.locator('button').allTextContents(), ['Fold', 'Open in new tab↗']);
      assert.equal(await fold.locator('[data-glyph=fold]').count(), 1);
      const [foldBox, openBox] = await Promise.all([fold.boundingBox(), open.boundingBox()]);
      assert.ok(foldBox.x < openBox.x && Math.abs(foldBox.y - openBox.y) < 1);
      if (phone) assert.ok(foldBox.height >= 44 && openBox.height >= 44);
      await take('expanded');
      await tabFrom(() => press(first), first);
      await tabFrom(() => press(open), first);

      await expand(tall);
      assert.equal((await layout(first)).expanded, true);
      const tallLayout = await layout(tall);
      assert.ok(tallLayout.height >= height * .8 - 2);
      assert.ok(tallLayout.width < tallLayout.areaWidth / 2);
      const tallControls = await row(tallHost).evaluate(actions => {
        const host = actions.parentElement;
        return {
          followsImage: actions.previousElementSibling?.matches('img.image-thumb') === true,
          gap: parseFloat(getComputedStyle(host).rowGap),
          row: actions.getBoundingClientRect().toJSON(),
          card: host.closest('.deck-card, .message-card').getBoundingClientRect().toJSON(),
          buttons: [...actions.querySelectorAll('button')].map(button => button.getBoundingClientRect().toJSON()),
        };
      });
      assert.ok(tallControls.followsImage && tallControls.row.top >= tallLayout.bottom &&
        Math.abs(tallControls.row.top - tallLayout.bottom - tallControls.gap) <= 1,
      'the Fold and Open row sits directly under the capped image');
      assert.equal(tallControls.buttons.length, 2);
      for (const box of [tallControls.row, ...tallControls.buttons]) {
        assert.ok(box.left >= tallControls.card.left && box.right <= tallControls.card.right &&
          box.top >= tallControls.card.top && box.bottom <= tallControls.card.bottom,
        'the tall image controls fit inside their card');
      }
      assert.ok(tallControls.buttons[0].left < tallControls.buttons[1].left &&
        Math.abs(tallControls.buttons[0].top - tallControls.buttons[1].top) < 1);
      if (phone) assert.ok(tallControls.buttons.every(box => box.height >= 44));
      result.tallControls = tallControls;
      const tallFold = row(tallHost).getByRole('button', { name: 'Fold', exact: true });
      await reveal(tall);
      await take('expanded-tall');
      await reveal(tallFold);
      await press(tallFold);
      const foldedTall = await layout(tall);
      assert.equal(foldedTall.expanded, false);
      assert.equal(foldedTall.focused, true);
      assert.ok(foldedTall.bottom > 0 && foldedTall.top < height, 'the thumbnail is shown again after folding from below');
      assert.equal((await layout(first)).expanded, true);
      await reveal(fold);
      await press(fold);
      assert.equal((await layout(first)).expanded, false);
      assert.equal((await layout(first)).focused, true);

      // Expand the second image alongside a still-folded first image. Its own
      // row wraps to full width, so its visible top must remain anchored.
      await expand(tall);
      assert.equal((await layout(first)).expanded, false);
      await page.keyboard.press('Escape');
      assert.equal((await layout(tall)).expanded, false);
      assert.equal((await layout(tall)).focused, true);
      await expand(first, 'Enter');
      await tabFrom(() => page.keyboard.press('Enter'), first);
      await first.focus();
      await page.keyboard.press('Tab');
      const focusedRing = el => document.activeElement === el && getComputedStyle(el).outlineWidth === '2px';
      assert.equal(await fold.evaluate(focusedRing), true);
      await page.keyboard.press('Tab');
      assert.equal(await open.evaluate(focusedRing), true);
      await page.keyboard.press('Escape');
      assert.equal((await layout(first)).expanded, false);
      assert.equal((await layout(first)).focused, true);
      await expand(first, 'Enter');
      await page.keyboard.press('Tab');
      assert.equal(await fold.evaluate(focusedRing), true);
      await page.keyboard.press('Enter');
      assert.equal((await layout(first)).expanded, false);
      assert.equal((await layout(first)).focused, true);

      await expand(first, 'Space');
      const beforeSpace = await layout(first), tabs = context.pages().length, destination = page.url();
      // Space has no image action. The Notebook sheet suppresses its default
      // scroll to keep the page behind the sheet still.
      await page.evaluate(() => {
        window.expandedImageSpace = null;
        window.addEventListener('keydown', event => {
          window.expandedImageSpace = { key: event.key, defaultPrevented: event.defaultPrevented };
        }, { once: true });
      });
      await page.keyboard.press('Space');
      const afterSpace = await layout(first);
      assert.equal(afterSpace.expanded, true, 'Space keeps the expanded image open');
      assert.equal(afterSpace.focused, true, 'Space keeps focus on the expanded image');
      assert.equal(afterSpace.src, beforeSpace.src);
      assert.equal(context.pages().length, tabs, 'Space on the expanded image opens no tab');
      assert.equal(page.url(), destination);
      assert.equal(await page.locator('#reader[open], .card-reply-composer:not([hidden]), .deck-writing').count(), 0);
      const spaceEvent = await page.evaluate(() => window.expandedImageSpace);
      assert.deepEqual(spaceEvent, { key: ' ', defaultPrevented: surface.label === 'notebook' });
      result.expandedSpace = { event: spaceEvent, before: beforeSpace, after: afterSpace, tabs };
      result.expansionRequests = await page.evaluate(() => window.imageReads.length) - countBefore;
      assert.equal(result.expansionRequests, 0, 'all image actions reuse the existing verified bytes');
      await withFreshDevice(browser, createContext, route, surface.selector);
      await page.reload();
      await decoded(first);
      assert.equal((await layout(first)).expanded, false, 'reload folds the image');
      assert.equal((await layout(tall)).expanded, false);
      assert.equal(await page.locator(surface.selector + ' .card-image-actions:visible').count(), 0);
      result.reloadReset = true;
      result.independentDeviceReset = true;
    } catch (error) {
      if (page) await page.screenshot({ path: directory + '/' + surface.label + '-failure.png' }).catch(() => {});
      throw error;
    } finally { await context.close(); }
  }
  const session = await browser.newContext();
  try {
    report.served = {};
    for (const file of ['aim.css', 'image-pick.mjs', 'card-images.mjs', 'notebook-page.mjs', 'deck-page.mjs',
      'message-menu.mjs', 'pane-keys.mjs', 'reveal.mjs']) {
      const received = await session.request.get(origin + '/' + file);
      assert.ok(received.ok());
      const bytes = await received.body();
      assert.deepEqual(bytes, await readFile('web/' + file));
      report.served[file] = hash(bytes);
    }
  } finally { await session.close(); }
  assert.deepEqual(report.errors, []);
} catch (error) {
  report.failure = error.stack;
  if (page) await page.screenshot({ path: directory + '/failure.png' }).catch(() => {});
  throw error;
} finally {
  await browser?.close();
  report.browserClosed = !browser?.isConnected();
  fixture.stdin.end();
  report.fixture = await exit;
  report.fixtureErrors = errors();
  await writeFile(directory + '/report.json', JSON.stringify(report, null, 2) + '\n');
  assert.deepEqual(report.fixture, { code: 0, signal: null });
  assert.equal(report.fixtureErrors, '');
}

async function withFreshDevice(browser, createContext, route, selector) {
  assert.ok(browser.isConnected());
  const device = await createContext();
  try {
    const sheet = await device.newPage();
    await sheet.goto(route);
    const image = sheet.locator(selector + ' > img').first();
    await image.waitFor();
    await image.evaluate(img => img.decode());
    assert.equal(await image.evaluate(img => img.parentElement.hasAttribute('data-image-expanded')), false);
  } finally { await device.close(); }
}

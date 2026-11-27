import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fixtureControl } from './fixture_control.mjs';

const [out, widthArg, look, theme, mode = 'candidate'] = process.argv.slice(2);
const width = Number(widthArg), phone = width === 390, baseline = mode === 'baseline', inReader = mode === 'reader';
assert.ok(out && [390, 1280].includes(width) && ['bookends', 'paper'].includes(look) && ['light', 'dark'].includes(theme));
assert.ok(['baseline', 'candidate', 'reader'].includes(mode));
await mkdir(out, { recursive: true });
const { chromium } = await import(process.env.AIM_PLAYWRIGHT_CORE);
const fixture = spawn('/usr/bin/python3', ['-B', 'tests/fixtures/ui_http.py', '--freshness',
  '--teardown-observations', out + '/teardown.jsonl']);
const { control, exit, errors } = fixtureControl(fixture);
const report = { width, look, theme, mode, reads: [], commands: [], errors: [] };
let browser, page;
try {
  const { origin, agent } = await control({ method: 'ready' });
  const topic = 'accept-edits-native';
  await control({ method: 'navigation_topics', topics: [{ id: topic, title: 'Garden work for the weekend' }] });
  const post = async (op, body) => {
    const receipt = await control({ method: 'agent_message', operation_id: '52-post-' + op, sender: agent, topic_id: topic,
      source: 'topic', join: true, read: true, divergence_reason: 'An independent edit example ' + op, body });
    assert.equal(receipt.status, 'committed');
    return receipt.result.message_id;
  };
  const edit = async (message_id, op, body, revision = 1) => {
    const receipt = await control({ method: 'agent_edit', sender: agent, message_id, operation_id: '52-' + op, body, revision });
    assert.equal(receipt.status, 'committed');
  };
  const route = await post('route', 'Meet at the west gate at eight.');
  const supplies = await post('supplies', 'Bring six packets of seeds for the new beds.');
  await edit(route, 'route-edit', 'Meet at the north gate at eight.');
  await edit(supplies, 'supplies-edit', 'Bring eight packets of seeds for the new beds.');

  browser = await chromium.launch({ executablePath: process.env.AIM_CHROME });
  const context = await browser.newContext({ viewport: { width, height: 900 }, isMobile: phone, hasTouch: phone, colorScheme: theme,
    reducedMotion: 'reduce' });
  await context.addInitScript(look => {
    localStorage.setItem('theseus-look', look === 'paper' ? 'paper' : '');
    window.editInput = [];
    for (const type of ['pointerdown', 'pointerup', 'mousedown', 'focusin', 'click', 'keydown']) document.addEventListener(type, event => {
      const toggle = event.target.closest?.('.message-changes-toggle');
      const card = event.target.closest?.('.message-card');
      if (toggle || card) window.editInput.push({ type, pointerType: event.pointerType, key: event.key,
        trusted: event.isTrusted, toggle: Boolean(toggle), target: event.target.className, lit: Boolean(card?.classList.contains('lit')) });
    }, true);
  }, look);
  page = await context.newPage();
  page.setDefaultTimeout(8500);
  page.on('pageerror', error => report.errors.push(error.stack));
  const pending = new Set();
  const done = request => pending.delete(request);
  page.on('requestfinished', done); page.on('requestfailed', done);
  page.on('request', request => {
    const pathname = new URL(request.url()).pathname;
    if (pathname === '/api/view') {
      const { name, args } = request.postDataJSON();
      report.reads.push({ name, args }); pending.add(request);
    }
    if (pathname === '/api/command') report.commands.push(request.postDataJSON().kind);
  });
  const settled = async () => {
    for (let turn = 0; turn < 100; turn++) {
      const before = report.reads.length;
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      if (!pending.size && before === report.reads.length) return;
    }
    assert.fail('View reads did not settle');
  };
  const open = async () => {
    await page.goto(origin + '/?topic=' + topic);
    await page.locator('body[data-ready=true]').waitFor();
    await settled();
  };
  await open();
  assert.deepEqual(await page.evaluate(() => ({ look: document.documentElement.dataset.look || 'bookends',
    dark: matchMedia('(prefers-color-scheme:dark)').matches })), { look, dark: theme === 'dark' });

  const card = id => page.locator('#messages .message-card[data-id="' + id + '"]');
  const toggle = card(route).locator('.message-changes-toggle'), otherToggle = card(supplies).locator('.message-changes-toggle');
  const marked = (host, tag) => host.locator(':scope ' + tag);
  const del = 'del.struck-words', ins = 'ins.added-words';
  await toggle.waitFor();
  await otherToggle.waitFor();
  assert.equal(await marked(card(route), del).count(), 1);
  assert.equal(await marked(card(route), ins).count(), 1);
  report.initialReads = report.reads.slice();
  if (baseline) {
    assert.equal(await toggle.textContent(), 'hide changes');
    assert.equal(await toggle.getAttribute('aria-pressed'), 'true');
  } else {
    assert.equal(await toggle.getAttribute('title'), 'Accept changes');
    assert.equal(await toggle.getAttribute('aria-label'), 'Accept changes');
    assert.equal(await toggle.getAttribute('aria-pressed'), 'false');
    const size = await toggle.boundingBox();
    assert.ok(size.width >= (phone ? 44 : 24) && size.height >= (phone ? 44 : 24), JSON.stringify(size));
    report.target = { width: size.width, height: size.height };
    const glyph = toggle.locator('.message-changes-glyph');
    assert.equal(await glyph.textContent(), '✓');
    const visual = () => glyph.evaluate(el => {
      const style = getComputedStyle(el), mark = el.closest('.message-edited');
      const time = mark.previousElementSibling, separator = time.lastChild;
      const span = (node, first, last) => {
        const range = document.createRange();
        range.setStart(node, first); range.setEnd(node, last);
        return range.getBoundingClientRect().top;
      };
      const { x, y, width, height } = el.getBoundingClientRect(), hit = el.parentElement.getBoundingClientRect();
      const color = name => {
        const sample = document.createElement('span');
        sample.style.color = style.getPropertyValue(name).trim();
        return sample.style.color;
      };
      return { background: style.backgroundColor, border: style.borderTopColor, borderWidth: style.borderTopWidth,
        mark: getComputedStyle(el, '::before').backgroundColor, ink: color('--ink'),
        muted: color('--muted'), mask: style.maskComposite,
        cutout: getComputedStyle(el, '::before').visibility === 'hidden',
        separator: separator.textContent, label: mark.firstChild.textContent,
        sameLine: span(separator, 1, 2) === span(time.querySelector('time').firstChild, 0, 1),
        wrapsBeforeEdited: span(separator, 1, 2) < span(mark.firstChild, 0, 6), wrap: getComputedStyle(mark).whiteSpace,
        box: [x - hit.x, y - hit.y, width, height] };
    });
    const outlined = await visual();
    assert.equal(outlined.background, 'rgba(0, 0, 0, 0)');
    assert.equal(outlined.border, outlined.muted);
    assert.equal(outlined.border, outlined.mark);
    assert.equal(outlined.borderWidth, '1px');
    assert.equal(outlined.wrap, 'nowrap');
    assert.equal(outlined.sameLine, true);
    assert.equal(outlined.separator, '\u00a0·');
    assert.equal(outlined.label, 'Edited');
    if (phone) assert.equal(outlined.wrapsBeforeEdited, true);
    await page.evaluate(() => scrollTo(0, 0));
    await page.screenshot({ path: out + '/untouched.png' });
    const afterInitial = report.reads.length, initialWrites = report.commands.length;
    const activate = async control => phone ? control.tap() : control.click();
    if (!phone) {
      await toggle.scrollIntoViewIfNeeded();
      const at = await toggle.boundingBox();
      await page.mouse.move(at.x + at.width / 2, at.y + at.height / 2);
      report.hit = await toggle.evaluate(el => {
        const author = el.closest('.message-author'), star = author.querySelector('.card-star');
        const mark = el.parentElement;
        const rect = node => node.getBoundingClientRect().toJSON();
        const center = rect(el), point = document.elementFromPoint(center.x + center.width / 2, center.y + center.height / 2);
        return { toggle: center, mark: rect(mark), star: rect(star), hit: point?.className,
          starParent: star.parentElement.className, owner: author.className,
          authorChildren: [...author.children].map(child => child.className),
          markNext: mark.nextElementSibling?.className, starPrevious: star.previousElementSibling?.className,
          style: { mark: getComputedStyle(mark).display, star: getComputedStyle(star).display, offset: getComputedStyle(star).marginLeft } };
      });
    }
    await activate(toggle);
    assert.equal(await toggle.getAttribute('aria-pressed'), 'true', 'the first press accepts');
    assert.equal(await toggle.getAttribute('title'), 'Show changes');
    assert.equal(await toggle.getAttribute('aria-label'), 'Show changes');
    const filled = await visual();
    assert.equal(filled.background, filled.ink);
    assert.equal(filled.background, filled.border);
    assert.match(filled.mask, /exclude/);
    assert.equal(filled.cutout, true);
    assert.deepEqual(filled.box, outlined.box);
    report.visual = { outlined, filled };
    assert.equal((await card(route).locator('.message-edited').textContent()).trim(), 'Edited ✓');
    assert.equal(await marked(card(route), del).count(), 0);
    assert.equal(await marked(card(route), ins).count(), 0);
    assert.equal(await card(route).locator('.message-preview').textContent(), 'Meet at the north gate at eight.');
    assert.equal(await page.locator('#reader').evaluate(el => el.open), false);
    assert.equal(await otherToggle.getAttribute('aria-pressed'), 'false');
    await settled();
    report.acceptReads = report.reads.slice(afterInitial);
    assert.deepEqual(report.acceptReads, []);
    assert.deepEqual(report.commands.slice(initialWrites), []);
    report.firstInput = await page.evaluate(() => window.editInput);
    await page.evaluate(() => scrollTo(0, 0));
    await page.screenshot({ path: out + '/accept-edits.png' });

    await open();
    assert.equal(await toggle.getAttribute('aria-pressed'), 'true', 'device-local acceptance survives reload');
    assert.equal(await marked(card(route), del).count(), 0);
    await toggle.focus();
    await page.keyboard.press('Enter');
    assert.equal(await toggle.getAttribute('aria-pressed'), 'false');
    assert.equal(await marked(card(route), del).count(), 1);
    assert.equal(await toggle.evaluate(el => document.activeElement === el), true, 'focus follows the repainted byline');
    await page.keyboard.press('Space');
    assert.equal(await toggle.getAttribute('aria-pressed'), 'true');
    assert.equal(await marked(card(route), ins).count(), 0);
    assert.equal(await page.locator('#reader').evaluate(el => el.open), false);

    if (inReader) {
      const readerURL = origin + '/?topic=' + topic + '&message=' + route;
      await page.goto(readerURL);
      const reader = page.locator('#reader[open]'), readerToggle = reader.locator('#reader-origin .message-changes-toggle');
      const source = reader.locator('#source-body');
      await readerToggle.waitFor();
      assert.equal(await readerToggle.getAttribute('aria-pressed'), 'true');
      assert.equal(await marked(source, del).count(), 0);
      await activate(readerToggle);
      assert.equal(await readerToggle.getAttribute('aria-pressed'), 'false');
      assert.equal(await marked(source, ins).count(), 1);
      await activate(readerToggle);
      assert.equal(await readerToggle.getAttribute('aria-pressed'), 'true');
      await edit(route, 'third-revision', 'Meet at the east gate at eight.', 2);
      await page.goto(readerURL);
      await source.locator(ins).filter({ hasText: 'east' }).waitFor();
      assert.equal(await readerToggle.getAttribute('aria-pressed'), 'false', 'the new revision shows its own changes');
      assert.equal(await marked(source, ins).count(), 1);
      report.laterRevision = true;
      await page.emulateMedia({ forcedColors: 'active' });
      const forcedGlyph = readerToggle.locator('.message-changes-glyph');
      const forced = () => forcedGlyph.evaluate(el => {
        const style = getComputedStyle(el);
        return { border: style.borderColor, fill: style.backgroundColor, mask: style.maskComposite,
          mark: getComputedStyle(el, '::before').backgroundColor };
      });
      const before = await forced();
      assert.equal(before.fill, 'rgba(0, 0, 0, 0)');
      assert.equal(before.mark, before.border, 'the forced-colors check uses the visible outline color');
      await activate(readerToggle);
      const after = await forced();
      assert.equal(after.fill, before.border, 'the forced-colors fill uses the visible outline color');
      assert.match(after.mask, /exclude/);
      report.forcedColors = { before, after };
    }
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  }
  assert.deepEqual(report.errors, []);
  report.served = {};
  for (const asset of ['aim.css', 'marks.mjs', 'message-changes.mjs', 'message-menu.mjs', 'reader.mjs']) {
    const response = await page.request.get(origin + '/' + asset);
    assert.ok(response.ok());
    const bytes = await response.body();
    assert.deepEqual(bytes, await readFile('web/' + asset));
    report.served[asset] = createHash('sha256').update(bytes).digest('hex');
  }
} catch (error) {
  report.failure = error.stack;
  await page?.screenshot({ path: out + '/failure.png' }).catch(() => {});
  throw error;
} finally {
  if (page) report.input = await page.evaluate(() => window.editInput).catch(() => []);
  await browser?.close();
  report.browserClosed = !browser?.isConnected();
  fixture.stdin.end();
  report.fixture = await exit;
  report.fixtureErrors = errors();
  await writeFile(out + '/report.json', JSON.stringify(report, null, 2) + '\n');
  assert.deepEqual(report.fixture, { code: 0, signal: null });
  assert.equal(report.fixtureErrors, '');
}

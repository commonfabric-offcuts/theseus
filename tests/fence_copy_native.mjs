// Real clicks, keyboard presses and touch taps on isolated Theseus reading
// views. Run in both engines, without granting clipboard permissions.
// Usage: node tests/fence_copy_native.mjs <Chrome for Testing> <evidence dir> [case filter]
import assert from 'node:assert/strict';
import { assertFeedCard, assertCardDrag } from './train49-contract-oracles.mjs';
import { fenceBoundarySnapshot } from './fence-copy-observation.mjs';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { createRequire } from 'node:module';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const [chrome, evidence, filter = ''] = process.argv.slice(2);
const playwright = createRequire(import.meta.url)(process.env.AIM_PLAYWRIGHT_CORE);
await mkdir(evidence, { recursive: true });
const source = {};
for (const filename of ['tests/fence_copy_native.mjs', 'tests/fence-copy-observation.mjs',
  'tests/train49-contract-oracles.mjs', 'tests/fixtures/ui_http.py', 'web/reply-stacks.mjs',
  'web/stack-feed.mjs', 'web/feed-fence-copy.mjs', 'web/fence-copy.mjs',
  'web/message-menu.mjs', 'web/reader.mjs', 'web/app.mjs', 'web/lines.mjs',
  'web/message-format.mjs', 'web/feed-passages.mjs', 'web/stack-order.mjs', 'web/aim.css', 'web/stack-look.css']) {
  const bytes = await readFile(path.join(root, filename));
  source[filename] = createHash('sha256').update(bytes).digest('hex');
  await mkdir(path.dirname(path.join(evidence, 'source', filename)), { recursive: true });
  await writeFile(path.join(evidence, 'source', filename), bytes);
}
const fixture = spawn('/usr/bin/python3', ['tests/fixtures/ui_http.py', '--live', '--freshness', '--images', '--agent-colors'], { cwd: root });
const pending = new Map(); let serial = 0, stderr = '';
fixture.stderr.on('data', data => { stderr += data; });
createInterface({ input: fixture.stdout }).on('line', line => {
  const reply = JSON.parse(line), held = pending.get(reply.id); pending.delete(reply.id);
  if (reply.failure) held.reject(Error(reply.failure)); else held.resolve(reply.answer);
});
const exited = new Promise(resolve => fixture.once('exit', code => {
  for (const held of pending.values()) held.reject(Error(`fixture exited ${code}: ${stderr}`));
  resolve(code);
}));
const control = data => new Promise((resolve, reject) => {
  const id = ++serial; pending.set(id, { resolve, reject }); fixture.stdin.write(JSON.stringify({ ...data, id }) + '\n');
});
const results = [], observations = [];
async function boundary(p, name, phase, cardSelector, controlSelector, point = null) {
  observations.push({ name, phase, engine, source,
    state: await p.evaluate(fenceBoundarySnapshot, { cardSelector, controlSelector, point }) });
  // Persist before the next assertion or native gesture can fail.
  await writeFile(path.join(evidence, 'native.json'), JSON.stringify({ results, observations }, null, 2));
}
let browser, facts, contexts = [], engine;
const payload = '\t  α <tag> & `literal`  \n\nlast line';
const body = 'Before the fence.\n\n~~~~ text\n' + payload + '\n~~~~\n\nAfter the fence.';
const note = 'Opening.\n\n' + body + '\n\n## First card\n' + body + '\n\nTarget after fence.\n\n## Second card\nOther words.';
const wait = (p, fn, arg) => p.waitForFunction(fn, arg, { timeout: 10000 });
const query = id => `.message-card[data-id="${id}"]`;
const feedCopy = card => '.feed-fence-copy[data-message="' + card.match(/data-id="([^"]+)"/)[1] + '"]';

async function open(url, { phone = false, dark = false, width = 390 } = {}) {
  const ctx = await browser.newContext({ viewport: phone ? { width, height: 844 } : { width: 1280, height: 900 }, hasTouch: phone, isMobile: phone, colorScheme: dark ? 'dark' : 'light' });
  contexts.push(ctx);
  await ctx.addInitScript(() => {
    window.copyCalls = []; window.copyMode = 'real'; window.copyResolves = [];
    const clipboard = navigator.clipboard, original = clipboard.writeText.bind(clipboard);
    clipboard.writeText = text => {
      window.copyCalls.push({ text, active: navigator.userActivation?.isActive });
      if (window.copyMode === 'reject') return Promise.reject(Error('Test denial'));
      if (window.copyMode === 'pending') return new Promise(resolve => window.copyResolves.push(resolve));
      return original(text); // synchronous, inside the original native gesture
    };
  });
  const p = await ctx.newPage(); p.errors = []; p.phone = phone;
  p.on('pageerror', error => p.errors.push(String(error)));
  await p.goto(facts.origin + url);
  await wait(p, () => document.body.dataset.ready === 'true');
  return p;
}
async function hoverFence(p, button) {
  const anchor = await button.getAttribute('aria-controls');
  if (anchor) await p.locator('#' + anchor).hover(); else await button.locator('..').hover();
}
async function press(p, selector) {
  const target = p.locator(selector).first();
  if (p.phone) await target.tap(); else { await hoverFence(p, target); await target.click(); }
}
async function copy(p, selector, expected = payload, key = null) {
  const before = await p.evaluate(() => copyCalls.length), button = p.locator(selector).first();
  if (key) { await button.focus(); await p.keyboard.press(key); } else await press(p, selector);
  await wait(p, n => copyCalls.length === n + 1, before);
  assert.equal(await p.evaluate(() => copyCalls.at(-1).text), expected);
  await wait(p, s => document.querySelector(s)?.dataset.label === 'Copied', selector);
  assert.equal(await p.evaluate(() => copyCalls.at(-1).active), true, 'the real clipboard API was invoked during transient activation');
}
// Inline visible feedback is CSS-generated so it does not enter native text selections.
const feedbackWords = notice => notice.evaluate(el => {
  if (!el.hasAttribute('data-feedback')) return el.innerText;
  const before = getComputedStyle(el, '::before');
  if (before.display === 'none' || before.visibility !== 'visible' || before.opacity === '0') return '';
  // WebKit may retain the attribute expression; Chromium resolves its text.
  return before.content === 'attr(data-feedback)' ? el.dataset.feedback : before.content.replace(/^"|"$/g, '');
});

async function picture(p, name) {
  await p.screenshot({ path: path.join(evidence, `${engine}-${name}.png`) });
}
async function check(name, run) {
  const title = `${engine} ${name}`;
  if (filter && !filter.split('|').some(part => title.includes(part))) return;
  try { await run(); results.push({ name: title, passed: true }); console.log('PASS', title); }
  catch (error) { for (const ctx of contexts) for (const p of ctx.pages()) await p.screenshot({ path: path.join(evidence, 'failure-' + results.length + '.png') }).catch(() => {}); results.push({ name: title, passed: false, error: String(error.stack) }); console.log('FAIL', title, String(error)); }
  finally { for (const ctx of contexts.splice(0)) await ctx.close(); }
  await writeFile(path.join(evidence, 'native.json'), JSON.stringify({ results, observations }, null, 2));
}

try {
  facts = await control({ method: 'ready' });
  await control({ method: 'navigation_topics', topics: [{ id: 'fence-topic', title: 'Fence reading' }] });
  const message = (await control({ method: 'agent_message', operation_id: 'fence-message', topic_id: 'fence-topic', join: true, source: 'topic', body })).result.message_id;
  await control({ method: 'outcome_reference', operation_id: 'fence-note', item_id: 'fence-note', title: 'Fence notebook', body: note });
  const conversation = (await control({ method: 'agent_view', name: 'conversation', args: { workspace_id: 'w1' } })).conversation;
  const conversationMessage = (await control({ method: 'agent_message', operation_id: 'fence-conversation', topic_id: conversation.topic_id, source: 'topic', body, whole_topic: true })).result.message_id;
  const longPayload = 'A'.repeat(1800) + '\nlast';
  const longMessage = (await control({ method: 'agent_message', operation_id: 'fence-long', topic_id: 'fence-topic', source: 'topic', body: '```\n' + longPayload + '\n```' })).result.message_id;
  for (engine of ['chromium', 'webkit']) {
    browser = await playwright[engine].launch({ headless: true, ...(engine === 'chromium' ? { executablePath: chrome } : {}) });
    observations.push({ engine, version: browser.version(), clipboardPermissions: 'not granted', phone: 'desktop engine with touch; not a physical iPhone' });
    for (const options of [{}, { dark: true }, { phone: true }, { phone: true, dark: true, width: 320 }]) {
      const label = `${options.phone ? options.width ?? 390 : 'desktop'} ${options.dark ? 'dark' : 'light'}`;
      await check(`surfaces ${label}`, async () => {
        for (const [route, id] of [['/?topic=fence-topic', message], ['/?conversation=w1', conversationMessage]]) {
          const p = await open(route, options), card = query(id), button = feedCopy(card);
          await p.locator(card).scrollIntoViewIfNeeded();
          if (options.phone) {
            assert.equal(await p.locator(button).evaluate(b => getComputedStyle(b).opacity), '1');
            const box = await p.locator(button).boundingBox(); assert.ok(box.width >= 44 && box.height >= 44);
          } else {
            await p.mouse.move(0, 0);
            assert.equal(await p.locator(button).evaluate(b => getComputedStyle(b).opacity), '0');
          }
          await copy(p, button);
          assert.equal(await p.locator('#reader').evaluate(d => d.open), false, 'one Copy tap never opens a message');
          assertFeedCard(await p.locator(card).evaluate(c => ({ tag: c.tagName, role: c.getAttribute('role'), tabIndex: c.tabIndex })));
          assert.equal(await p.locator('button button').count(), 0, 'no nested button semantics');
          assert.ok(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
          await picture(p, `${id === message ? 'topic' : 'conversation'}-${label.replaceAll(' ', '-')}`);
          await p.close();
        }
        const reader = await open('/?topic=fence-topic&message=' + message, options);
        await reader.locator('#source-body .fence-copy').waitFor();
        const writingBefore = await reader.locator('#writing-body').inputValue();
        await copy(reader, '#source-body .fence-copy');
        assert.equal(await reader.locator('#writing-body').inputValue(), writingBefore, 'Copy leaves existing writing untouched');
        await picture(reader, 'reader-' + label.replaceAll(' ', '-'));
        await reader.close();
        for (const route of ['/?cards=fence-note', '/?topic=t1&page=fence-note&revision=1', '/?workspace=w1&page=fence-note&revision=1']) {
          const p = await open(route, options);
          const scope = route.startsWith('/?cards') ? '.deck-card:not(.deck-writing)' : route.startsWith('/?workspace') ? '.page-here-body' : '#source-body';
          await p.locator(scope + ' .fence-copy').first().waitFor();
          await copy(p, scope + ' .fence-copy');
          assert.equal(await p.locator('.deck-writing').count(), 0, 'Copy does not enter card editing');
          assert.ok(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
          await picture(p, `${route.startsWith('/?cards') ? 'notebook-cards' : route.startsWith('/?workspace') ? 'notebook-view' : 'notebook-reader'}-${label.replaceAll(' ', '-')}`);
          assert.deepEqual(p.errors, []);
          await p.close();
        }
      });
    }
    for (const width of [320, 375, 390, 1280]) for (const dark of [false, true]) {
      await check(`copy, partial hint and refusal at ${width}px ${dark ? 'dark' : 'light'}`, async () => {
        const phone = width < 1280;
        const p = await open('/?topic=fence-topic', { phone, width, dark });
        const truncated = p.locator(query(longMessage));
        const cue = truncated.locator('.fence-copy-unavailable');
        await cue.waitFor();
        assert.equal(await p.locator(feedCopy(query(longMessage))).count(), 0);
        assert.equal(await cue.getAttribute('aria-label'), 'Open message to copy');
        const fits = await cue.evaluate(element => {
          const pre = element.parentElement.querySelector('.md-pre'), first = document.createRange();
          first.setStart(pre.firstChild, 0); first.setEnd(pre.firstChild, 1);
          const line = first.getBoundingClientRect(), hint = element.getBoundingClientRect();
          const card = element.closest('.message-card').getBoundingClientRect();
          return hint.width > 0 && hint.left >= card.left && hint.right <= card.right &&
            (hint.bottom <= line.top || hint.right <= line.left);
        });
        assert.ok(fits, 'partial hint stays inside its card and clear of the payload');
        const selector = feedCopy(query(message)), button = p.locator(selector);
        await button.scrollIntoViewIfNeeded();
        const box = await button.boundingBox();
        if (phone) assert.ok(box.width >= 44 && box.height >= 44);
        await copy(p, selector);
        await p.evaluate(() => { copyMode = 'reject'; });
        await press(p, selector);
        await wait(p, sel => document.querySelector(sel).dataset.label === 'Copy failed', selector);
        if (!phone) await p.mouse.move(0, 0);
        const refusal = p.locator('.fence-copy-announcement:not(.sr-only)');
        assert.equal(await feedbackWords(refusal), 'Could not copy. Open the message, select the text, and use Copy.');
        const shown = await refusal.boundingBox();
        assert.ok(shown && shown.width > 2 && shown.x >= 0 && shown.x + shown.width <= width);
        assert.equal(await button.evaluate(b => getComputedStyle(b).opacity), '1');
        assert.equal(await p.locator('#reader').evaluate(d => d.open), false);
        assert.ok(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
        await picture(p, `refusal-${width}-${dark ? 'dark' : 'light'}`);
      });
    }
    for (const [surface, route, selector] of [
      ['Reader', '/?topic=fence-topic&message=' + message, '#source-body .fence-copy'],
      ['Notebook card', '/?cards=fence-note', '.deck-card:not(.deck-writing) .fence-copy'],
      ['Notebook view', '/?workspace=w1&page=fence-note&revision=1', '.page-here-body .fence-copy'],
      ['feed', '/?topic=fence-topic', feedCopy(query(message))],
    ]) await check('pending and refused copy leaves visible controls clear in ' + surface, async () => {
      for (const width of [320, 375, 390, 1280]) for (const dark of [false, true]) {
        const phone = width < 1280, p = await open(route, { width, dark, phone });
        const button = p.locator(selector).first();
        await p.evaluate(() => { copyMode = 'pending'; });
        if (surface === 'feed' && width === 320) await boundary(p, 'feed320 coverage', 'before pending press', query(message), selector);
        try { await press(p, selector); }
        finally { if (surface === 'feed' && width === 320) await boundary(p, 'feed320 coverage', 'after pending press', query(message), selector); }
        await wait(p, () => copyResolves.length === 1);
        assert.equal(await button.getAttribute('data-label'), 'Copying…');
        assert.equal(await button.getAttribute('aria-label'), 'Copying fenced text…');
        assert.equal(await button.getAttribute('title'), 'Copying fenced text…');
        const box = await button.boundingBox();
        if (phone) assert.ok(box.width >= 44 && box.height >= 44, surface + ' pending touch target');
        await p.evaluate(() => { copyResolves.shift()(); copyMode = 'reject'; });
        await wait(p, s => document.querySelector(s).dataset.label === 'Copied', selector);
        if (surface === 'feed' && width === 320) await boundary(p, 'feed320 coverage', 'before refusal press', query(message), selector);
        try { await press(p, selector); }
        finally { if (surface === 'feed' && width === 320) await boundary(p, 'feed320 coverage', 'after refusal press', query(message), selector); }
        const notice = p.locator('.fence-copy-announcement:not(.sr-only)').first();
        await notice.waitFor();
        const guidance = surface === 'feed' ? 'Open the message, select the text, and use Copy.' : 'Select the text and use Copy.';
        assert.equal(await feedbackWords(notice), 'Could not copy. ' + guidance);
        const layout = await notice.evaluate(el => {
          const rect = el.getBoundingClientRect(), modal = el.closest('dialog[open]');
          const controls = [...(modal ?? document).querySelectorAll('button,textarea,input,a[href],[role=button]')];
          const covered = controls.filter(control => {
            if (control.matches('.message-card[role="button"]') && control.contains(el)) {
              // The button is the card's entire background. Its reserved
              // feedback line can overlap the background, never a child control.
              return false;
            }
            const r = control.getBoundingClientRect();
            if (!r.width || !r.height || getComputedStyle(control).visibility === 'hidden') return false;
            const x = (Math.max(rect.left, r.left) + Math.min(rect.right, r.right)) / 2;
            const y = (Math.max(rect.top, r.top) + Math.min(rect.bottom, r.bottom)) / 2;
            return rect.left < r.right && rect.right > r.left && rect.top < r.bottom && rect.bottom > r.top &&
              control.contains(document.elementFromPoint(x, y));
          }).map(c => c.id || c.getAttribute('aria-label') || c.textContent.trim().slice(0, 40));
          return { inView: rect.width > 2 && rect.height > 2 && rect.left >= 0 && rect.top >= 0 &&
            rect.right <= innerWidth && rect.bottom <= innerHeight, covered };
        });
        if (surface === 'feed' && width === 320) await boundary(p, 'feed320 coverage', 'after refusal before coverage assertion', query(message), selector);
        assert.deepEqual(layout, { inView: true, covered: [] }, surface + ' ' + width + (dark ? ' dark' : ' light'));
        await p.close();
      }
    });
    await check('copy refusal at the first fence of a tall feed or Notebook card keeps its place and retries', async () => {
      const lines = Array.from({ length: 70 }, (_, i) => 'Paragraph ' + i + ' has enough words to wrap on a small screen.');
      const text = 'Before.\n\n~~~\nfirst fenced words\n~~~\n\n' + lines.join('\n\n');
      const item = await control({ method: 'agent_message', operation_id: 'long-copy-' + engine, topic_id: 'fence-topic', join: true, source: 'topic', body: text });
      const noteId = 'long-copy-note-' + engine;
      await control({ method: 'outcome_reference', operation_id: noteId, item_id: noteId, title: 'Long copy note', body: '## Long card\n' + text });
      for (const phone of [false, true]) for (const [route, selector] of [
        ['/?topic=fence-topic', feedCopy(query(item.result.message_id))],
        ['/?cards=' + noteId, '.deck-card:not(.deck-writing) .fence-copy'],
      ]) {
        const p = await open(route, { phone, width: phone ? 375 : 1280 }), button = p.locator(selector).first();
        await button.scrollIntoViewIfNeeded();
        await p.evaluate(() => { copyMode = 'reject'; });
        const keyboardFeed = !phone && route.startsWith('/?topic=');
        let release;
        if (keyboardFeed) {
          const held = new Promise(resolve => { release = resolve; });
          await p.route('**/api/view', async route => {
            const body = route.request().postDataJSON();
            if (body.name === 'source' && body.args?.source_ref?.id === item.result.message_id) {
              const response = await route.fetch();
              await held;
              await route.fulfill({ response });
            } else await route.continue();
          });
          // Observe settlement of the application's expansion after processing
          // the controlled reply. The real focus and keyboard events trigger it.
          await p.evaluate(async id => {
            const { CardScroll } = await import('/card-scroll.mjs');
            const expand = CardScroll.prototype.expand;
            CardScroll.prototype.expand = async function(card, item) {
              const result = await expand.call(this, card, item);
              if (item?.id === id && this.known(id) !== undefined) window.tallReadProcessed = true;
              return result;
            };
          }, item.result.message_id);
        }
        if (phone) await button.tap();
        else {
          const before = await button.elementHandle();
          const requested = keyboardFeed && p.waitForRequest(req => req.url().endsWith('/api/view') &&
            req.method() === 'POST' && req.postDataJSON()?.name === 'source' &&
            req.postDataJSON()?.args?.source_ref?.id === item.result.message_id);
          await button.focus();
          if (keyboardFeed) {
            await requested; release();
            await wait(p, () => window.tallReadProcessed === true);
            assert.equal(await p.locator(query(item.result.message_id)).getAttribute('data-whole'), null);
          }
          await p.keyboard.press('Enter');
          assert.ok(await before.evaluate(el => el.isConnected && el === document.activeElement),
            'Enter activates the same focused glyph through the full-message read');
          await before.dispose();
        }
        await wait(p, s => document.querySelector(s)?.dataset.label === 'Copy failed', selector);
        const notice = p.locator('.fence-copy-announcement:not(.sr-only)');
        await notice.waitFor();
        const visible = el => {
          const r = el.getBoundingClientRect();
          return r.width > 1 && r.height > 1 && r.top >= 0 && r.bottom <= innerHeight && r.left >= 0 && r.right <= innerWidth;
        };
        assert.ok(await button.evaluate(visible), route + ' retry control remains in view');
        assert.ok(await notice.evaluate(visible), route + ' refusal is in view');
        if (!phone) assert.ok(await button.evaluate(el => el === document.activeElement), 'keyboard focus stays on Copy');
        assert.equal(await p.locator('[role=status].fence-copy-announcement').innerText(), await feedbackWords(notice));
        await p.evaluate(() => { copyMode = 'real'; });
        if (phone) await button.tap(); else await p.keyboard.press('Enter');
        await wait(p, s => document.querySelector(s)?.dataset.label === 'Copied', selector);
        if (keyboardFeed) {
          await p.keyboard.press(engine === 'webkit' ? 'Alt+Tab' : 'Tab');
          await wait(p, s => document.querySelector(s).dataset.whole === 'shown', query(item.result.message_id));
        }
        await p.close();
      }
    });
    await check('a secondary click keeps the native link selection inside a feed card', async () => {
      const address = 'https://example.com/x';
      const item = await control({ method: 'agent_message', operation_id: 'fence-link-' + engine,
        topic_id: 'fence-topic', join: true, source: 'topic', body: 'Linked ' + address });
      const p = await open('/?topic=fence-topic'), card = p.locator(query(item.result.message_id));
      await card.locator('a').click({ button: 'right' });
      assert.equal(await p.evaluate(() => getSelection().toString()), address);
      assert.equal(await p.locator('.message-menu-list').count(), 0);
      assert.equal(await p.locator('#reader').evaluate(dialog => dialog.open), false);
    });
    await check('after a feed clipboard refusal the message opens with selectable fenced text', async () => {
      const p = await open('/?topic=fence-topic');
      const selector = feedCopy(query(message));
      await p.evaluate(() => { copyMode = 'reject'; });
      await press(p, selector);
      assert.match(await feedbackWords(p.locator('.fence-copy-announcement:not(.sr-only)')), /Open the message/);
      // Approved721: dragging selects the source in place; a separate explicit
      // stationary click still opens the Reader for manual Copy recovery.
      const span = p.locator(query(message) + ' .md-pre').first();
      await span.scrollIntoViewIfNeeded();
      const line = await span.evaluate(node => {
        const text = node.firstChild, i = text.data.indexOf('last');
        const range = document.createRange();
        range.setStart(text, i); range.setEnd(text, i + 4);
        const r = range.getBoundingClientRect();
        return { from: r.left + 1, to: r.right - 1, y: r.top + r.height / 2 };
      });
      await p.mouse.move(line.from, line.y); await p.mouse.down();
      await p.mouse.move(line.to, line.y, { steps: 8 });
      assert.equal(await p.evaluate(() => getSelection().toString()), 'last');
      await p.mouse.up();
      assertCardDrag(await p.evaluate(() => ({ selection: getSelection().toString(), reader: document.querySelector('#reader').open })));
      await span.click();
      const source = p.locator('#source-body');
      await source.locator('.md-pre').waitFor();
      await source.focus();
      await p.keyboard.press('Meta+A');
      assert.ok((await p.evaluate(() => getSelection().toString())).includes(payload));
      await p.keyboard.press('Meta+C');
      const writing = p.locator('#writing-body');
      await writing.focus();
      await p.keyboard.press('Meta+V');
      await wait(p, text => document.querySelector('#writing-body').value.includes(text), payload);
    });
    await check('the inline composer keeps its selected text when the feed menu opens', async () => {
      const p = await open('/?topic=fence-topic');
      const field = p.locator('#inline-writing-body');
      await field.fill('hello composer');
      await field.evaluate(t => t.setSelectionRange(0, 5));
      const card = p.locator(query(message));
      await card.scrollIntoViewIfNeeded();
      const menuBox = await card.boundingBox(), menuPoint = { x: menuBox.x + 8, y: menuBox.y + 8 };
      await boundary(p, 'composer document Selection', 'before menu', query(message), '#inline-writing-body', menuPoint);
      try { await card.click({ button: 'right', position: { x: 8, y: 8 } }); }
      finally { await boundary(p, 'composer document Selection', 'after menu', query(message), '#inline-writing-body', menuPoint); }
      await p.locator('.message-menu-list').waitFor();
      assert.deepEqual(await field.evaluate(t => [t.value, t.selectionStart, t.selectionEnd]), ['hello composer', 0, 5]);
      assert.equal(await p.evaluate(() => getSelection().toString()), engine === 'chromium' ? 'hello' : '');
    });
    if (engine === 'chromium') for (const width of [320, 375, 390]) await check(
      'phone long-press distinguishes words, a fence, and card space at ' + width, async () => {
      const p = await open('/?topic=fence-topic', { phone: true, width });
      const card = p.locator(query(message));
      const cdp = await p.context().newCDPSession(p);
      await card.scrollIntoViewIfNeeded();
      for (const [where, selector, word, previous] of [
        ['prose', '.md-p', 'Before', ''],
        ['fence', '.md-pre', 'last', ''],
        ['fence after refusal', '.md-pre', 'last', ''],
        ['space', null, '', ''],
        ['selected words', '.md-p', 'Before', 'Befor'],
        ['space with selection', null, '', 'Befor'],
      ]) {
        // The paired empty-space baseline uses this 375px card geometry.
        if (!selector && width !== 375) continue;
        if (where === 'fence after refusal') {
          await p.evaluate(() => { copyMode = 'reject'; });
          await press(p, feedCopy(query(message)));
          assert.equal(await feedbackWords(p.locator('.fence-copy-announcement:not(.sr-only)')),
            'Could not copy. Open the message, select the text, and use Copy.');
        }
        const point = await card.evaluate((node, { selector, word, previous }) => {
          const selection = getSelection();
          selection.removeAllRanges();
          if (previous) {
            const text = node.querySelector('.md-p').firstChild;
            selection.setBaseAndExtent(text, 0, text, previous.length);
          }
          window.lastFeedContext = null;
          document.addEventListener('contextmenu', e => { window.lastFeedContext = e.defaultPrevented; }, { once: true });
          if (selector) {
            const text = node.querySelector(selector).firstChild, index = text.data.indexOf(word);
            const range = document.createRange();
            range.setStart(text, index); range.setEnd(text, index + word.length);
            const b = range.getBoundingClientRect();
            return { x: Math.round(b.left + 2), y: Math.round(b.top + b.height / 2) };
          }
          const b = node.getBoundingClientRect();
          const x = Math.round(b.right - 20), y = Math.round(b.top + b.height / 2);
          if (!node.contains(document.elementFromPoint(x, y))) throw Error('The point is outside the card');
          const range = document.createRange(), walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT);
          for (let text = walker.nextNode(); text; text = walker.nextNode()) {
            range.selectNodeContents(text);
            if ([...range.getClientRects()].some(r => r.left <= x && x < r.right && r.top <= y && y < r.bottom))
              throw Error('The blank-space point landed on text');
          }
          return { x, y };
        }, { selector, word, previous });
        if (width === 375 && !selector) await boundary(p, 'phone375 card-space ' + where, 'before long press', query(message), feedCopy(query(message)), point);
        try {
          await cdp.send('Input.synthesizeTapGesture', { ...point, duration: 1200, tapCount: 1, gestureSourceType: 'touch' });
          await wait(p, () => lastFeedContext !== null);
        } finally {
          if (width === 375 && !selector) await boundary(p, 'phone375 card-space ' + where, 'after long press', query(message), feedCopy(query(message)), point);
        }
        const actual = await p.evaluate(() => ({
          prevented: lastFeedContext, selection: getSelection().toString(),
          menu: Boolean(document.querySelector('.message-menu-list')), reader: document.querySelector('#reader').open,
        }));
        const opensMenu = !selector && !previous;
        assert.deepEqual(actual, { prevented: opensMenu, selection: word || previous, menu: opensMenu, reader: false }, where);
        if (opensMenu) await p.keyboard.press('Escape');
      }
      await cdp.detach();
    });
    await check('Space and Enter open the focused feed card once', async () => {
      for (const key of ['Space', 'Enter']) {
        const p = await open('/?topic=fence-topic'), card = p.locator(query(message));
        await card.focus();
        await card.evaluate(element => {
          window.cardActivations = 0;
          element.addEventListener('click', () => { window.cardActivations++; });
          window.readerOpens = 0;
          new MutationObserver(records => {
            readerOpens += records.filter(record => record.oldValue === null).length;
          }).observe(document.querySelector('#reader'), { attributes: true, attributeOldValue: true, attributeFilter: ['open'] });
        });
        await p.keyboard.press(key);
        await wait(p, () => document.querySelector('#reader').open && readerOpens > 0);
        assert.equal(await p.evaluate(() => readerOpens), 1);
        if (key === 'Space') assert.equal(await p.evaluate(() => cardActivations), 1);
        assert.equal(await p.locator('#source-body .md-pre').textContent(), payload);
        assert.equal(await p.evaluate(() => copyCalls.length), 0);
        await p.close();
      }
    });
    await check('keyboard, actual clipboard paste, refusal, and text selection', async () => {
      const p = await open('/?topic=fence-topic&message=' + message);
      const selector = '#source-body .fence-copy';
      await p.locator(selector).waitFor();
      // Reach the button with native Tab (Option-Tab is Safari's all-controls key).
      await p.locator('#source-body').focus();
      await p.keyboard.press(engine === 'webkit' ? 'Alt+Tab' : 'Tab');
      assert.equal(await p.evaluate(() => document.activeElement.className), 'fence-copy');
      await copy(p, selector, payload, 'Enter');
      await copy(p, selector, payload, 'Space');
      await p.evaluate(() => { copyMode = 'pending'; });
      await p.keyboard.press('Space');
      await wait(p, () => copyResolves.length === 1);
      const button = p.locator(selector);
      assert.equal(await button.getAttribute('data-label'), 'Copying…');
      assert.equal(await button.getAttribute('aria-label'), 'Copying fenced text…');
      assert.equal(await button.getAttribute('title'), 'Copying fenced text…');
      await p.evaluate(() => { copyResolves.shift()(); copyMode = 'real'; });
      await wait(p, s => document.querySelector(s).dataset.label === 'Copied', selector);
      // The app's reply field is a genuine editable paste destination.
      const field = p.locator('#writing-body');
      await field.focus(); await p.keyboard.press('Meta+A'); await p.keyboard.press('Meta+V');
      await wait(p, value => document.querySelector('#writing-body').value === value, payload);
      assert.equal(await field.inputValue(), payload, 'native paste sees exactly the real clipboard contents');
      await p.evaluate(() => { copyMode = 'reject'; });
      await press(p, selector);
      await wait(p, () => document.querySelector('#source-body .fence-copy').dataset.label === 'Copy failed');
      assert.equal(await field.inputValue(), payload, 'failure keeps unsent writing');
      await field.focus(); await p.keyboard.press('End'); await p.keyboard.type('!');
      assert.ok((await field.inputValue()).includes('!'), 'the keyboard still types into the open composer');
      assert.equal(await p.locator('.fence-copy-announcement:not(.sr-only)').count(), 0, 'resuming writing clears the refusal');
      await p.evaluate(() => { copyMode = 'real'; });
      await copy(p, selector);
      // Select All and a real native Copy must not acquire the pseudo-labels.
      await p.locator('#source-body').focus(); await p.keyboard.press('Meta+A');
      const selected = await p.evaluate(() => getSelection().toString());
      assert.ok(selected.includes(payload)); assert.doesNotMatch(selected, /Copy|Copied|failed/);
      await p.keyboard.press('Meta+C');
      await field.focus(); await p.keyboard.press('Meta+A'); await p.keyboard.press('Meta+V');
      assert.equal(await field.inputValue(), selected);
      assert.deepEqual(p.errors, []);
    });
    await check('partial fences, horizontal scroll and untouched editors', async () => {
      const p = await open('/?topic=fence-topic', { phone: true });
      const card = query(longMessage);
      await p.locator(card).scrollIntoViewIfNeeded();
      assert.equal(await p.locator(feedCopy(card)).count(), 0);
      await p.locator(card + ' .md-pre').tap();
      await p.locator(feedCopy(card)).waitFor();
      await copy(p, feedCopy(card), longPayload);
      const before = await p.locator(feedCopy(card)).boundingBox();
      await p.locator(card + ' .md-pre').evaluate(e => { e.scrollLeft = 500; });
      const after = await p.locator(feedCopy(card)).boundingBox();
      assert.equal(after.x, before.x); assert.ok(await p.locator(card + ' .md-pre').evaluate(e => e.scrollLeft > 0));
      assert.ok(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      const text = await open('/?cards=fence-note&view=text');
      await text.locator('#notebook-text').waitFor();
      assert.equal(await text.locator('.fence-copy:visible').count(), 0);
      await text.goto(facts.origin + '/?cards=fence-note'); await wait(text, () => document.body.dataset.ready === 'true');
      await text.locator('.deck-card .md-p').last().click();
      await text.locator('.deck-writing textarea').waitFor();
      assert.equal(await text.locator('.deck-writing .fence-copy').count(), 0);
    });
    await check('held pointer and Space retain the visible payload through redraw', async () => {
      const p = await open('/?topic=fence-topic&message=' + message);
      await p.locator('#source-body .fence-copy').waitFor();
      // Exercise the real destructive render entry points with native held input.
      // No handler is invoked by the test; only the external redraw is injected.
      for (const kind of ['reader', 'feed', 'space']) {
        const selector = '#source-body .fence-copy';
        await p.evaluate(async ({ body, kind }) => {
          const m = await import('/message-format.mjs');
          m.drawPassages(document.querySelector('#source-body'), body, document, { copyFences: true });
          window.redraw = () => kind === 'feed'
            ? m.formatWords(document.querySelector('#source-body'), '```\nreplacement\n```', { copyFences: true })
            : m.drawPassages(document.querySelector('#source-body'), '```\nreplacement\n```', document, { copyFences: true });
        }, { body, kind });
        const button = p.locator(selector); await hoverFence(p, button);
        const before = await p.evaluate(() => copyCalls.length);
        if (kind === 'space') { await button.focus(); await p.keyboard.down('Space'); }
        else { const box = await button.boundingBox(); await p.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await p.mouse.down(); }
        await p.evaluate(() => redraw());
        assert.equal(await p.locator('#source-body .md-pre').textContent(), payload);
        if (kind === 'space') await p.keyboard.up('Space'); else await p.mouse.up();
        await wait(p, n => copyCalls.length === n + 1, before);
        assert.equal(await p.evaluate(() => copyCalls.at(-1).text), payload);
        await wait(p, () => document.querySelector('#source-body .md-pre').textContent === 'replacement');
      }
      // A stale success cannot relabel a replacement control.
      await p.evaluate(() => { copyMode = 'pending'; });
      await press(p, '#source-body .fence-copy');
      await p.evaluate(async () => { const m = await import('/message-format.mjs'); m.drawPassages(document.querySelector('#source-body'), '```\nnewer\n```', document, { copyFences: true }); copyResolves.shift()(); });
      assert.equal(await p.locator('#source-body .fence-copy').getAttribute('data-label'), 'Copy');
    });
    await check('Notebook held press and click-to-edit mapping after copying', async () => {
      const id = `fence-held-${engine}`;
      await control({ method: 'outcome_reference', operation_id: id, item_id: id, title: 'Held card', body: '## Card\n' + body });
      const p = await open('/?cards=' + id);
      const selector = '.deck-card .fence-copy'; await p.locator(selector).waitFor();
      await hoverFence(p, p.locator(selector)); const box = await p.locator(selector).boundingBox();
      await p.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await p.mouse.down();
      const revised = p.waitForResponse(async response => response.url().includes('/api/') && (await response.text().catch(() => '')).includes('Revised held card'));
      await control({ method: 'memory_revise', operation_id: id + '-revision', item_id: id, expected_revision: 1, title: 'Revised held card', body: '## Card\n```\nnew revision\n```\n\nTarget after fence.' });
      // Wait for the live revision to be read, while the old pressed row stays.
      await revised;
      assert.equal(await p.locator('.deck-card .md-pre').textContent(), payload);
      await p.mouse.up();
      await wait(p, () => copyCalls.length === 1);
      assert.equal(await p.evaluate(() => copyCalls[0].text), payload);
      await wait(p, () => document.querySelector('.deck-card .md-pre')?.textContent === 'new revision');
      await copy(p, selector, 'new revision');
      // Click a known glyph after the fence and type there. Copy labels must
      // contribute no characters to DeckPage.placeOf's source mapping.
      const point = await p.locator('.deck-card .md-p').last().evaluate(node => {
        const text = node.firstChild, r = document.createRange(); r.setStart(text, 7); r.setEnd(text, 8);
        const b = r.getBoundingClientRect(); return { x: b.left + 1, y: b.top + b.height / 2 };
      });
      await p.mouse.click(point.x, point.y);
      const field = p.locator('.deck-writing textarea'); await field.waitFor();
      const at = await field.evaluate(e => e.selectionStart), text = await field.inputValue();
      assert.equal(text.slice(at, at + 5), 'after');
      await p.keyboard.type('INSERT ');
      assert.ok((await field.inputValue()).includes('Target INSERT after fence.'));
      assert.equal(await p.locator('.deck-writing .fence-copy').count(), 0);
    });

    await check('a live feed message revision waits for the held Copy gesture', async () => {
      const id = (await control({ method: 'agent_message', operation_id: 'fence-edit-' + engine, topic_id: 'fence-topic', source: 'topic', sender: 'person', body })).result.message_id;
      const p = await open('/?topic=fence-topic'), card = query(id), selector = feedCopy(card);
      await hoverFence(p, p.locator(selector)); const box = await p.locator(selector).boundingBox();
      await p.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await p.mouse.down();
      const revised = p.waitForResponse(async response => response.url().includes('/api/') && (await response.text().catch(() => '')).includes('replacement from another device'));
      const headers = { Authorization: `Bearer ${facts.token}`, Origin: facts.origin, 'Content-Type': 'application/json' };
      const boot = await (await fetch(facts.origin + '/api/bootstrap', { headers })).json();
      const receipt = await (await fetch(facts.origin + '/api/command', { method: 'POST', headers, body: JSON.stringify({ v: 1, instance_id: boot.instance_id,
        operation_id: 'fence-live-edit-' + engine, kind: 'message.edit', target: { message_id: id },
        expected: { authority: { authority_id: boot.authority.authority_id, authority_epoch: boot.authority.authority_epoch }, message_revision: 1 },
        args: { body: '```\nreplacement from another device\n```' } }) })).json();
      assert.equal(receipt.status, 'committed');
      await revised;
      assert.equal(await p.locator(card + ' .md-pre').textContent(), payload);
      await p.mouse.up(); await wait(p, () => copyCalls.length === 1);
      assert.equal(await p.evaluate(() => copyCalls[0].text), payload);
      await wait(p, card => document.querySelector(card + ' .md-pre').textContent === 'replacement from another device', card);
      await copy(p, selector, 'replacement from another device');
      assert.equal(await p.locator('#reader').evaluate(d => d.open), false);
    });
    if (engine === 'chromium') await check('native touch scrolling cancels Copy and releases a queued paint', async () => {
      const p = await open('/?topic=fence-topic&message=' + message, { phone: true });
      await p.locator('#source-body .fence-copy').waitFor();
      await p.evaluate(() => { window.cancelledPointers = 0; document.addEventListener('pointercancel', () => cancelledPointers++); });
      const box = await p.locator('#source-body .fence-copy').boundingBox(), x = box.x + box.width / 2, y = box.y + box.height / 2;
      const cdp = await p.context().newCDPSession(p);
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
      await p.evaluate(async () => { const m = await import('/message-format.mjs'); m.drawPassages(document.querySelector('#source-body'), '```\nafter cancelled scroll\n```', document, { copyFences: true }); });
      assert.equal(await p.locator('#source-body .md-pre').textContent(), payload);
      for (const dy of [20, 45, 70]) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y: y - dy }] });
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      await wait(p, () => cancelledPointers > 0);
      await wait(p, () => document.querySelector('#source-body .md-pre').textContent === 'after cancelled scroll');
      assert.equal(await p.evaluate(() => copyCalls.length), 0);
      await cdp.detach();
      await copy(p, '#source-body .fence-copy', 'after cancelled scroll');
    });

    await check('all four newline arrangements display and copy exact fenced text on every surface', async () => {
      const words = 'hixie https://discord.com/channels/1232452732963655720/1539479395180482660/1570832909391106141';
      const forms = ['', '\n'].flatMap(first => ['', '\n'].map(last => '```' + first + words + last + '```'));
      const all = forms.map((form, i) => `## reply ${i + 1}\n${form}`).join('\n\n'), id = 'fence-arrangements-' + engine;
      await control({ method: 'outcome_reference', operation_id: id, item_id: id, title: 'Fence arrangements', body: all });
      const topicId = (await control({ method: 'agent_message', operation_id: id + '-topic', topic_id: 'fence-topic', source: 'topic', body: all })).result.message_id;
      const conversationId = (await control({ method: 'agent_message', operation_id: id + '-conversation', topic_id: conversation.topic_id, source: 'topic', body: all, whole_topic: true })).result.message_id;
      for (const phone of [false, true]) {
        const surfaces = [
          ['/?topic=fence-topic', query(topicId)],
          ['/?conversation=w1', query(conversationId)],
          ['/?topic=fence-topic&message=' + topicId, '#source-body'],
          ['/?cards=' + id, '.deck-page'],
          ['/?topic=t1&page=' + id + '&revision=1', '#source-body'],
          ['/?workspace=w1&page=' + id + '&revision=1', '.page-here-body'],
        ];
        for (const [route, scope] of surfaces) {
          const p = await open(route, { phone, dark: true, width: 320 });
          const controls = p.locator(scope.startsWith('.message-card') ? feedCopy(scope) : scope + ' .fence-copy');
          await controls.first().waitFor();
          assert.equal(await controls.count(), 4, route);
          if (route.startsWith('/?cards')) assert.equal(await p.locator('.deck-card').count(), 4, 'a compact fence never swallows the next card');
          for (let i = 0; i < forms.length; i++) {
            const fence = p.locator(scope + ' .md-fence').nth(i);
            assert.equal(await fence.locator('.md-pre').textContent(), words);
            await controls.nth(i).evaluate((button, i) => { button.id = 'copy-arrangement-' + i; }, i);
            await copy(p, '#copy-arrangement-' + i, words);
          }
          assert.equal(await p.locator('.deck-writing').count(), 0);
          if (scope === '#source-body') {
            const field = p.locator('#writing-body'); await field.focus(); await p.keyboard.press('Meta+A'); await p.keyboard.press('Meta+V');
            await wait(p, words => document.querySelector('#writing-body').value === words, words);
          }
          assert.deepEqual(p.errors, []);
          if (route.startsWith('/?cards')) await picture(p, 'newline-arrangements-' + (phone ? 'phone' : 'desktop'));
          await p.close();
        }
      }
    });
    await check('glyph, same-line URL, own-message contrast and narrow nested quotes', async () => {
      const url = 'https://discord.com/channels/1232452732963655720/1539479395180482660/1570832909391106141';
      const id = `fence-url-${engine}`;
      await control({ method: 'outcome_reference', operation_id: id, item_id: id, title: 'Same-line URL', body: '## reply to hixie\n```' + url + '\n```' });
      for (const phone of [false, true]) {
        const p = await open('/?cards=' + id, { phone, dark: true, width: 320 });
        await p.locator('.deck-card .fence-copy').waitFor();
        assert.equal(await p.locator('.deck-card .md-pre').textContent(), url);
        await copy(p, '.deck-card .fence-copy', url);
        assert.equal(await p.locator('.fence-copy').first().textContent(), '');
        assert.equal(await p.locator('.fence-copy svg').count(), 1);
        await picture(p, `url-glyph-${phone ? 'phone' : 'desktop'}`);
        await p.close();
      }
      const ownBody = body + '\n\n' + ['```', 'nested words', '```'].map(line => '> '.repeat(8) + line).join('\n');
      const own = (await control({ method: 'agent_message', operation_id: id + '-own', topic_id: 'fence-topic', source: 'topic', sender: 'person', body: ownBody })).result.message_id;
      for (const dark of [false, true]) {
        const p = await open('/?topic=fence-topic', { phone: true, width: 320, dark });
        const card = query(own); await p.locator(card).scrollIntoViewIfNeeded();
        await copy(p, feedCopy(card));
        const colors = await p.locator(feedCopy(card)).first().evaluate(button => {
          const s = getComputedStyle(button); return [s.color, s.backgroundColor];
        });
        const lum = color => color.match(/[\d.]+/g).slice(0,3).map(Number).map(c => { c /= 255; return c <= .04045 ? c / 12.92 : ((c + .055) / 1.055) ** 2.4; }).reduce((a,c,i) => a + c * [.2126,.7152,.0722][i], 0);
        const [lo, hi] = colors.map(lum).sort((a,b) => a-b); assert.ok((hi + .05) / (lo + .05) >= 4.5, colors.join(' on '));
        assert.ok(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
        const contained = await p.locator(card + ' .md-fence').last().evaluate(f => f.getBoundingClientRect().right <= f.parentElement.getBoundingClientRect().right + 1);
        assert.ok(contained, 'a nested fence fits its quote');
        await picture(p, `own-nested-${dark ? 'dark' : 'light'}`);
      }
    });
    await check('each feed glyph follows its own fence inside a scrolling card', async () => {
      const gap = Array.from({ length: 9 }, (_, i) => 'Line ' + i + ' has enough words to wrap on a phone.').join('\n\n');
      const words = ['Before.', '~~~\nfirst copy\n~~~', gap, '~~~\nsecond copy\n~~~', gap.repeat(10)].join('\n\n');
      const message = (await control({ method: 'agent_message', operation_id: 'geometry-' + engine,
        topic_id: 'fence-topic', source: 'topic', body: words })).result.message_id;
      for (const width of [320, 375, 390, 1280]) for (const dark of [false, true]) {
        const p = await open('/?topic=fence-topic', { phone: width !== 1280, width, dark });
        const selector = query(message), card = p.locator(selector);
        await card.focus();
        await wait(p, sel => document.querySelector(sel).dataset.whole === 'shown', selector);
        assert.ok(await card.evaluate(el => el.scrollHeight > el.clientHeight + 100));
        await card.evaluate(el => el.scrollIntoView({ block: 'center' }));
        const anchors = card.locator('.feed-fence-anchor');
        assert.equal(await anchors.count(), 2);
        for (let index = 0; index < 2; index++) {
          const anchor = anchors.nth(index), id = await anchor.getAttribute('id');
          const button = p.locator('.feed-fence-copy[aria-controls="' + id + '"]');
          const aligned = await anchor.evaluate(async node => {
            const card = node.closest('.message-card'), button = document.querySelector('[aria-controls="' + node.id + '"].feed-fence-copy');
            card.scrollTop += node.getBoundingClientRect().top - card.getBoundingClientRect().top - 25;
            await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
            const a = node.getBoundingClientRect(), b = button.getBoundingClientRect();
            return { hidden: button.hidden, top: Math.round(b.top - a.top), right: Math.round(b.right - a.right + 4),
              coarse: matchMedia('(pointer:coarse)').matches,
              hit: button.contains(document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2)) };
          });
          assert.ok(!aligned.hidden && Math.abs(aligned.top) <= 1 && Math.abs(aligned.right) <= 1 && (!aligned.coarse || aligned.hit),
            engine + ' ' + width + ' fence ' + index + ': ' + JSON.stringify(aligned));
          if (!p.phone) {
            const line = anchor.locator('.md-pre');
            await line.hover();
            assert.equal(await button.evaluate(b => getComputedStyle(b).opacity), '1');
            const other = await anchors.nth(1 - index).getAttribute('id');
            assert.equal(await p.locator('.feed-fence-copy[aria-controls="' + other + '"]').evaluate(b => b.hasAttribute('data-hover')), false);
          }
          await copy(p, '.feed-fence-copy[aria-controls="' + id + '"]', index ? 'second copy' : 'first copy');
          await card.evaluate(el => { el.scrollTop += 120; });
          await wait(p, id => document.querySelector('.feed-fence-copy[aria-controls="' + id + '"]').hidden, id);
          assert.equal(await p.locator('#reader').evaluate(el => el.open), false);
        }
        await p.close();
      }
    });
    await check('select all and a drag from the topic title include feed words', async () => {
      const p = await open('/?topic=fence-topic'), card = p.locator(query(message));
      await card.scrollIntoViewIfNeeded();
      const points = await card.evaluate(node => {
        const title = [...document.querySelectorAll('h1,h2')].find(el => el.offsetParent && el.textContent.trim());
        const head = title.getBoundingClientRect(), words = node.querySelector('.md-p').firstChild;
        const r = document.createRange(); r.setStart(words, 10); r.setEnd(words, 11);
        const end = r.getBoundingClientRect();
        return [head.left + 2, head.top + head.height / 2, end.left + 1, end.top + end.height / 2];
      });
      const [x, y, toX, toY] = points;
      await p.mouse.move(x, y); await p.mouse.down();
      await p.mouse.move((x + toX) / 2, toY, { steps: 5 }); await p.mouse.move(toX, toY, { steps: 5 }); await p.mouse.up();
      assert.match(await p.evaluate(() => getSelection().toString()), /Before the/);
      await card.focus(); await p.keyboard.press('ControlOrMeta+A');
      const selection = await p.evaluate(() => getSelection().toString());
      assert.ok(selection.includes('Before the fence.') && selection.includes(payload));
      await p.keyboard.press('ControlOrMeta+C');
      const edit = p.locator('#inline-writing-body');
      await edit.focus(); await p.keyboard.press('ControlOrMeta+V');
      await wait(p, text => document.querySelector('#inline-writing-body').value.includes(text), payload);
      assert.ok((await edit.inputValue()).includes('Before the fence.'));
    });
    await check('Tab reveals the Copy corner when a long fence spans its card scroller', async () => {
      const content = Array.from({ length: 200 }, (_, n) => 'line ' + n + ' of the same tall fenced payload').join('\n');
      const id = (await control({ method: 'agent_message', operation_id: 'focus-tall-' + engine,
        topic_id: 'fence-topic', source: 'topic', body: '```\n' + content + '\n```\n\n[following link](https://example.com/after)' })).result.message_id;
      const p = await open('/?topic=fence-topic'), card = p.locator(query(id)), glyph = p.locator(feedCopy(query(id)));
      await card.focus();
      await wait(p, id => document.querySelector('.message-card[data-id="' + id + '"]').classList.contains('scroll-in-place'), id);
      await card.evaluate(c => {
        c.querySelector('.message-preview a').focus({ preventScroll: true });
        c.scrollTop = (c.scrollHeight - c.clientHeight) / 2;
      });
      const spanning = await card.evaluate(el => {
        const fence = el.querySelector('.feed-fence-anchor').getBoundingClientRect();
        const bounds = el.getBoundingClientRect();
        return fence.top < bounds.top - 88 && fence.bottom > bounds.bottom + 88;
      });
      assert.equal(spanning, true, 'one fence extends past both edges of the native card scroller');
      await p.keyboard.press(engine === 'webkit' ? 'Alt+Shift+Tab' : 'Shift+Tab');
      await p.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
      const reached = await glyph.evaluate(button => {
        const box = button.getBoundingClientRect();
        const card = document.getElementById(button.getAttribute('aria-controls')).closest('.message-card').getBoundingClientRect();
        return { focused: button === document.activeElement, hidden: button.hidden,
          inside: box.height > 0 && box.top >= Math.max(card.top, 0) - 1 && box.bottom <= Math.min(card.bottom, innerHeight) + 1 };
      });
      assert.deepEqual(reached, { focused: true, hidden: false, inside: true }, 'keyboard focus exposes the top corner');
      await p.close();
    });
    await check('backward entry reaches a trailing external Copy button', async () => {
      for (const [shape, source] of [['only', ''], ['linked', '[before](https://example.com/before)\n\n']]) {
        const id = (await control({ method: 'agent_message', operation_id: 'tab-reentry-' + shape + engine, topic_id: 'fence-topic', source: 'topic', body: source + '```\nlast payload\n```' })).result.message_id;
        const p = await open('/?topic=fence-topic'), card = p.locator(query(id)), glyph = p.locator(feedCopy(query(id)));
        const tab = engine === 'webkit' ? 'Alt+Tab' : 'Tab', back = engine === 'webkit' ? 'Alt+Shift+Tab' : 'Shift+Tab';
        await glyph.waitFor({ state: 'attached' });
        await card.focus();
        for (let n = 0; n < 15 && !(await glyph.evaluate(e => e === document.activeElement)); n++) await p.keyboard.press(tab);
        assert.ok(await glyph.evaluate(e => e === document.activeElement), shape + ' forward entry');
        await p.keyboard.press(tab);
        assert.ok(await p.evaluate(id => {
          const el = document.activeElement;
          return el !== document.body && !el.closest('.message-bar') && el.closest('.message-card')?.dataset.id !== id && el.dataset.message !== id;
        }, id), shape + ' Tab exits the card');
        await p.keyboard.press(back);
        assert.ok(await glyph.evaluate(e => e === document.activeElement), shape + ' backward re-entry');
        await p.keyboard.press(back);
        assert.equal(await p.evaluate(() => document.activeElement.textContent === 'before' ? 'before' : document.activeElement.dataset.act), shape === 'linked' ? 'before' : 'more');
        await p.close();
      }
    });

    await check('all inline controls stay in forward and reverse Tab order', async () => {
      const id = (await control({ method: 'agent_message', operation_id: 'fence-tabs-' + engine, topic_id: 'fence-topic', source: 'topic',
        body: '[before](https://example.com/before)\n\n```\none\n```\n\n[middle](https://example.com/middle)\n\n```\ntwo\n```\n\n[after](https://example.com/after)' })).result.message_id;
      const p = await open('/?topic=fence-topic'), card = query(id);
      await p.locator(card).focus();
      const tab = engine === 'webkit' ? 'Alt+Tab' : 'Tab', back = engine === 'webkit' ? 'Alt+Shift+Tab' : 'Shift+Tab';
      const name = () => p.evaluate(() => {
        const e = document.activeElement;
        return e.matches('.message-preview a') ? e.textContent : e.matches('.fence-copy') ? 'copy' : null;
      });
      const forward = [];
      for (let i = 0; i < 15 && forward.at(-1) !== 'after'; i++) { await p.keyboard.press(tab); const at = await name(); if (at) forward.push(at); }
      assert.deepEqual(forward, ['before', 'copy', 'middle', 'copy', 'after']);
      const backward = [];
      for (let i = 0; i < 4; i++) { await p.keyboard.press(back); backward.push(await name()); }
      assert.deepEqual(backward, ['copy', 'middle', 'copy', 'before']);
      await p.keyboard.press(back);
      assert.equal(await p.evaluate(() => document.activeElement.dataset.act), 'more', 'back across the inline/toolbar seam');
    });
    await check('press guard survives actual in-place navigation and cancelled presses', async () => {
      const p = await open('/?topic=fence-topic');
      await p.locator(feedCopy(query(message))).waitFor();
      await p.evaluate(() => { window.sameDocument = true; });
      await p.locator('#outline .ol-name[data-conversation-of="w1"]').click();
      await wait(p, () => location.search === '?conversation=w1' && document.body.dataset.ready === 'true');
      assert.equal(await p.evaluate(() => sameDocument), true);
      const card = query(conversationMessage), selector = feedCopy(card);
      await p.locator(selector).waitFor();
      await p.evaluate(() => { window.copyMode = 'real'; });
      for (const cancel of [false, true]) {
        await p.evaluate(async ({ card, body }) => {
          const m = await import('/message-format.mjs');
          m.formatWords(document.querySelector(card + ' .message-preview'), body, { copyFences: 'feed' });
        }, { card, body });
        const button = p.locator(selector); await hoverFence(p, button);
        const box = await button.boundingBox(), before = await p.evaluate(() => copyCalls.length);
        await p.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await p.mouse.down();
        await p.evaluate(async card => {
          const m = await import('/message-format.mjs');
          m.formatWords(document.querySelector(card + ' .message-preview'), '```\nnew after move\n```', { copyFences: 'feed' });
        }, card);
        assert.equal(await p.locator(card + ' .md-pre').textContent(), payload, 'pressed control survives a paint after in-place navigation');
        if (cancel) await p.mouse.move(1, 1);
        await p.mouse.up();
        await wait(p, card => document.querySelector(card + ' .md-pre').textContent === 'new after move', card);
        assert.equal(await p.evaluate(() => copyCalls.length), before + (cancel ? 0 : 1));
      }
    });
    await browser.close(); browser = null;
  }
} finally {
  for (const ctx of contexts.splice(0)) await ctx.close();
  if (browser) await browser.close();
  fixture.stdin.end();
  const code = await exited;
  await writeFile(path.join(evidence, 'native.json'), JSON.stringify({ results, observations, fixtureExitCode: code, browserClosed: !browser || !browser.isConnected() }, null, 2));
}
assert.ok(results.length && results.every(r => r.passed), 'see native.json for exact failing assertions');

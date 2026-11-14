// Real clicks, keyboard presses and touch taps on isolated Theseus reading
// views. Run in both engines, without granting clipboard permissions.
// Usage: node tests/fence_copy_native.mjs <Chrome for Testing> <evidence dir> [case filter]
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const [chrome, evidence, filter = ''] = process.argv.slice(2);
const playwright = createRequire(import.meta.url)(process.env.AIM_PLAYWRIGHT_CORE);
await mkdir(evidence, { recursive: true });
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
let browser, facts, contexts = [], engine;
const payload = '\t  α <tag> & `literal`  \n\nlast line';
const body = 'Before the fence.\n\n~~~~ text\n' + payload + '\n~~~~\n\nAfter the fence.';
const note = 'Opening.\n\n' + body + '\n\n## First card\n' + body + '\n\nTarget after fence.\n\n## Second card\nOther words.';
const wait = (p, fn, arg) => p.waitForFunction(fn, arg, { timeout: 10000 });
const query = id => `.message-card[data-id="${id}"]`;
const copySelector = '.fence-copy';

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
async function press(p, selector) {
  const target = p.locator(selector).first();
  if (p.phone) await target.tap(); else { await target.hover(); await target.click(); }
}
async function copy(p, selector, expected = payload, key = null) {
  const before = await p.evaluate(() => copyCalls.length), button = p.locator(selector).first();
  if (key) { await button.focus(); await p.keyboard.press(key); } else await press(p, selector);
  await wait(p, n => copyCalls.length === n + 1, before);
  assert.equal(await p.evaluate(() => copyCalls.at(-1).text), expected);
  await wait(p, s => document.querySelector(s)?.dataset.label === 'Copied', selector);
  assert.equal(await p.evaluate(() => copyCalls.at(-1).active), true, 'the real clipboard API was invoked during transient activation');
}
async function picture(p, name) {
  await p.screenshot({ path: path.join(evidence, `${engine}-${name}.png`) });
}
async function check(name, run) {
  const title = `${engine} ${name}`;
  if (filter && !filter.split('|').some(part => title.includes(part))) return;
  try { await run(); results.push({ name: title, passed: true }); console.log('PASS', title); }
  catch (error) { results.push({ name: title, passed: false, error: String(error.stack) }); console.log('FAIL', title, String(error)); }
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
          const p = await open(route, options), card = query(id), button = card + ' ' + copySelector;
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
          assert.equal(await p.locator(card).evaluate(c => c.tagName), 'ARTICLE');
          assert.equal(await p.locator('button button').count(), 0, 'no nested button semantics');
          assert.ok(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
          await picture(p, `${id === message ? 'topic' : 'conversation'}-${label.replaceAll(' ', '-')}`);
          await p.close();
        }
        const reader = await open('/?topic=fence-topic&message=' + message, options);
        await reader.locator('#source-body .fence-copy').waitFor();
        await copy(reader, '#source-body .fence-copy');
        assert.equal(await reader.locator('#writing-body').inputValue().catch(() => ''), '');
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
      // The app's reply field is a genuine editable paste destination.
      const field = p.locator('#writing-body');
      await field.focus(); await p.keyboard.press('Meta+V');
      await wait(p, value => document.querySelector('#writing-body').value === value, payload);
      assert.equal(await field.inputValue(), payload, 'native paste sees exactly the real clipboard contents');
      await p.evaluate(() => { copyMode = 'reject'; });
      await press(p, selector);
      await wait(p, () => document.querySelector('#source-body .fence-copy').dataset.label === 'Copy failed');
      assert.equal(await field.inputValue(), payload, 'failure keeps unsent writing');
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
      assert.equal(await p.locator(card + ' .fence-copy').count(), 0);
      await p.locator(card + ' .md-pre').tap();
      await p.locator(card + ' .fence-copy').waitFor();
      await copy(p, card + ' .fence-copy', longPayload);
      const before = await p.locator(card + ' .fence-copy').boundingBox();
      await p.locator(card + ' .md-pre').evaluate(e => { e.scrollLeft = 500; });
      const after = await p.locator(card + ' .fence-copy').boundingBox();
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
        const button = p.locator(selector); await button.hover();
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
      await p.locator(selector).hover(); const box = await p.locator(selector).boundingBox();
      await p.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await p.mouse.down();
      await control({ method: 'memory_revise', operation_id: id + '-revision', item_id: id, expected_revision: 1, title: 'Held card', body: '## Card\n```\nnew revision\n```\n\nTarget after fence.' });
      // Wait for the live revision to be read, while the old pressed row stays.
      await p.waitForTimeout(500);
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
    await browser.close(); browser = null;
  }
} finally {
  for (const ctx of contexts.splice(0)) await ctx.close();
  if (browser) await browser.close();
  fixture.stdin.end();
  const code = await exited;
  await writeFile(path.join(evidence, 'native.json'), JSON.stringify({ results, observations, fixtureExit: code, browserClosed: !browser || !browser.isConnected() }, null, 2));
}
assert.ok(results.length && results.every(r => r.passed), 'every offered fence-copy check passed');

// Isolated real HTTP/Core and native browser input; no live account or records.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
const { chromium } = await import(process.env.AIM_PLAYWRIGHT_CORE);
const evidence = process.argv[2]; await mkdir(evidence, { recursive: true });
const child = spawn('/usr/bin/python3', ['tests/fixtures/ui_http.py', '--freshness']);
let serial = 0, stderr = ''; const pending = new Map();
child.stderr.on('data', b => { stderr += b; });
createInterface({ input: child.stdout }).on('line', line => { const r = JSON.parse(line), p = pending.get(r.id); pending.delete(r.id); r.failure ? p.reject(Error(r.failure)) : p.resolve(r.answer); });
const exited = new Promise(resolve => child.on('exit', resolve));
const control = args => new Promise((resolve, reject) => { const id = ++serial; pending.set(id, { resolve, reject }); child.stdin.write(JSON.stringify({ ...args, id }) + '\n'); });
const browser = await chromium.launch({ executablePath: process.env.AIM_CHROME, headless: true });
const results = []; let page;
try {
  const facts = await control({ method: 'ready' });
  const third = await control({ method: 'agent_message', body: 'Third message for saved writing', operation_id: '907-third', sender: facts.agent, reply_to: facts.sources[0].id, reply_without_quote: 'Isolated fixture reply for independent writing'  });
  const ids = [...facts.sources.map(s => s.id), third.result.message_id];
  for (const [i, id] of ids.entries()) await control({ method: 'private_writing', message_id: id, kind: 'reply', body: `Saved reply ${i}\nSecond line`, operation_id: `907-draft-${i}` });
  for (const width of [1280, 390]) {
    const context = await browser.newContext({ viewport: { width, height: 900 }, isMobile: width < 760, hasTouch: width < 760 });
    page = await context.newPage(); const errors = []; page.on('pageerror', e => errors.push(e.message));
    const press = locator => width < 760 ? locator.tap() : locator.click();
    await page.goto(facts.origin + '/?topic=t1');
    await page.waitForSelector('.card-reply-composer textarea', { timeout: 20000 });
    await page.waitForFunction(() => document.querySelectorAll('.card-reply-composer textarea').length === 3);
    assert.deepEqual(await page.locator('.card-reply-composer textarea').evaluateAll(es => es.map(e => e.value).sort()), ['Saved reply 0\nSecond line','Saved reply 1\nSecond line','Saved reply 2\nSecond line']);
    assert.equal(await page.locator('[id]').evaluateAll(es => es.length === new Set(es.map(e => e.id)).size), true, 'all composer controls have unique ids');
    const reply = page.locator(`[id="reply-${ids[1]}-writing-body"]`);
    await reply.fill('A line\nB line\nC line\nD line\nE line\nF line\nG line\nH line\nI line');
    const short = await reply.evaluate(el => el.getBoundingClientRect().height);
    await press(page.locator(`[id="reply-${ids[1]}-taller-field"]`));
    assert.ok(await reply.evaluate(el => el.getBoundingClientRect().height) > short * 1.5, 'chevron doubles cap');
    await press(page.locator(`[id="reply-${ids[1]}-taller-field"]`));
    assert.ok(Math.abs(await reply.evaluate(el => el.getBoundingClientRect().height) - short) < 2);
    await reply.fill('> quoted line\nExact inline writing');
    await press(page.locator(`[data-id="${ids[1]}"] > .message-preview`));
    await page.waitForSelector('#reader[open]');
    assert.equal(await page.locator('#writing-body').inputValue(), '> quoted line\nExact inline writing');
    assert.equal(await page.locator('#reader').getAttribute('data-layout'), width < 760 ? 'stacked' : 'wide');
    await page.locator('#reader-close').click();
    await reply.waitFor({ state: 'visible' });
    await reply.focus(); await page.keyboard.press('Escape'); await reply.waitFor({ state: 'hidden' });
    assert.equal(await page.locator('#reader').evaluate(el => el.open), false);
    await press(page.locator(`[data-id="${ids[1]}"] > .message-preview`));
    await reply.waitFor({ state: 'visible' }); assert.equal(await reply.inputValue(), '> quoted line\nExact inline writing');
    // Native file selection exercises the existing upload owner; no live clipboard is changed.
    const prefix = `reply-${ids[1]}-`, root = page.locator(`[id="${prefix}composer"]`);
    await press(page.locator(`[id="${prefix}plus-button"]`));
    const picker = page.waitForEvent('filechooser');
    await press(page.locator(`[id="${prefix}add-image"]`));
    const chooser = await picker;
    // Return to the writing before completing the OS file selection so the
    // measured movement is the strip, rather than opening/closing its panel.
    await reply.focus();
    await reply.evaluate(el => { el.setSelectionRange(2, 7); window.scrollBy(0, el.getBoundingClientRect().bottom - innerHeight + 160); });
    const measure = () => reply.evaluate(el => ({ bottom: el.closest('.field-box').getBoundingClientRect().bottom, body: el.value, start: el.selectionStart, end: el.selectionEnd }));
    const beforeImage = await measure();
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aC9sAAAAASUVORK5CYII=', 'base64');
    await chooser.setFiles({ name: '907-fixture.png', mimeType: 'image/png', buffer: png });
    await root.locator('.image-choice').waitFor({ state: 'visible' });
    await page.waitForFunction(id => document.getElementById(id).querySelector('.image-choice button[aria-label^="Remove"]')?.disabled === false, root ? `${prefix}composer` : '');
    await page.waitForTimeout(100);
    const afterImage = await measure();
    assert.ok(Math.abs(beforeImage.bottom - afterImage.bottom) < 3, `image add holds bottom: ${JSON.stringify({ beforeImage, afterImage })}`);
    assert.deepEqual([afterImage.body, afterImage.start, afterImage.end], [beforeImage.body, beforeImage.start, beforeImage.end]);
    // Removing via the strip may focus its button, but must leave the text and selection intact.
    await press(root.locator('.image-choice button[aria-label^="Remove"]'));
    await root.locator('.image-choice').waitFor({ state: 'detached' }); await page.waitForTimeout(100);
    const afterRemove = await measure();
    assert.ok(Math.abs(afterImage.bottom - afterRemove.bottom) < 3, 'image removal holds bottom');
    assert.deepEqual([afterRemove.body, afterRemove.start, afterRemove.end], [beforeImage.body, beforeImage.start, beforeImage.end]);
    await page.screenshot({ path: path.join(evidence, `replies-${width}.png`), fullPage: true });
    assert.deepEqual(errors, []); results.push({ width, independentReplies: 3, chevron: true, reader: true, escape: true, images: true, input: width < 760 ? 'native tap' : 'native click' });
    // Restore for the next isolated browser context.
    await reply.fill('Saved reply 1\nSecond line');
    await page.waitForTimeout(650);
    const own = await control({ method: 'agent_message', sender: 'person', whole_topic: true, body: `Own message ${width}`, operation_id: `907-own-${width}` });
    const ownId = own.result.message_id, ownBody = page.locator(`[data-id="${ownId}"] > .message-preview`);
    await ownBody.waitFor({ state: 'visible' });
    await press(ownBody);
    const ownReply = page.locator(`[id="reply-${ownId}-writing-body"]`);
    await ownReply.waitFor({ state: 'visible' });
    assert.equal(await ownReply.evaluate(el => document.activeElement === el), true, 'first body press focuses reply');
    assert.equal(await page.locator('#reader').evaluate(el => el.open), false);
    await press(ownBody); await page.waitForSelector('#message-edit textarea');
    assert.equal(await page.locator('#message-edit textarea').inputValue(), `Own message ${width}`);
    await page.keyboard.press('Escape'); await page.locator('#reader-close').click();
    // A native mouse double click on another author's message opens Reader.
    if (width > 760) {
      const otherReply = page.locator(`[id="reply-${ids[2]}-writing-body"]`);
      await otherReply.focus(); await page.keyboard.press('Escape');
      await page.locator(`[data-id="${ids[2]}"] > .message-preview`).dblclick();
      await page.waitForSelector('#reader[open]');
      assert.equal(await page.locator('#reader').getAttribute('data-editing'), null);
      await page.locator('#reader-close').click();
    }
    await context.close();
  }
} catch (error) {
  if (page) { await page.screenshot({ path: path.join(evidence, 'failure.png'), fullPage: true }); await writeFile(path.join(evidence, 'failure.html'), await page.content()); }
  results.push({ error: error.stack }); throw error;
} finally {
  await writeFile(path.join(evidence, 'results.json'), JSON.stringify(results, null, 2));
  await browser.close(); child.stdin.end(); assert.equal(await exited, 0, stderr);
}

// Plain Send through the actual page, isolated HTTP/Core and native input.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fixtureControl } from './fixture_control.mjs';
const { chromium } = await import(process.env.AIM_PLAYWRIGHT_CORE);
const evidence = process.argv[2]; await mkdir(evidence, { recursive: true });
const child = spawn('/usr/bin/python3', ['tests/fixtures/ui_http.py', '--freshness']);
const { control, exit } = fixtureControl(child);
const browser = await chromium.launch({ executablePath: process.env.AIM_CHROME, headless: true });
const results = []; let page, releaseSend;
try {
  const facts = await control({ method: 'ready' });
  for (const [width, gesture] of [[1280, 'click'], [390, 'keyboard']]) {
    const parent = await control({ method: 'agent_message', sender: facts.agent, reply_to: facts.sources[0].id, reply_without_quote: 'Isolated parent for inline Send regression',
      body: `937 parent ${width}`, operation_id: `937-parent-${width}` });
    const id = parent.result.message_id;
    const context = await browser.newContext({ viewport: { width, height: 900 } });
    page = await context.newPage(); const commands = [], errors = [];
    page.on('pageerror', e => errors.push(e.message));
    page.on('request', request => { try { const body = request.postDataJSON(); if (body?.kind) commands.push(body); } catch {} });
    await page.goto(facts.origin + '/?topic=t1');
    const parentCard = page.locator(`.message-card[data-id="${id}"]`);
    await parentCard.locator(':scope > .message-preview').click();
    const root = page.locator(`[id="reply-${id}-composer"]`), field = root.locator('textarea');
    await field.fill(Array.from({length:16},(_,n)=>`Height line ${n}`).join('\n'));
    await page.locator(`[id="reply-${id}-taller-field"]`).click();
    await field.fill(`937 plain inline send ${width}`);
    const receipt = page.waitForResponse(response => {
      try { return response.request().postDataJSON()?.kind === 'message.send'; } catch { return false; }
    });
    if (gesture === 'keyboard') { await field.focus(); await page.keyboard.press('Meta+Enter'); }
    else await page.locator(`[id="reply-${id}-send"]`).click();
    const sent = await (await receipt).json(); assert.equal(sent.status, 'committed');
    const sentId = sent.result.message_id, card = page.locator(`.message-card[data-id="${sentId}"]`);
    await card.waitFor({ state: 'visible' });
    // The fresh read and its layout must have settled before inspecting the end state.
    await page.waitForTimeout(300);
    const source = await control({ method: 'agent_view', actor: facts.actor, name: 'source', args: { source_ref: { kind: 'message', id: sentId } } });
    assert.equal(source.body, `937 plain inline send ${width}`);
    const acts = await control({ method: 'agent_view', actor: facts.actor, name: 'message_acts', args: { topic_id: 't1', limit: 100 } });
    assert.equal(acts.error, undefined); assert.equal(acts.next_cursor, null);
    assert.equal(acts.items.some(item => item.acts?.placed != null), false, 'Core records no manual placement');
    const state = {
      width, gesture, sentId, fieldClosed: !await root.isVisible(),
      focused: await card.evaluate(el => document.activeElement === el),
      lit: await card.evaluate(el => el.matches('.lit') || Boolean(el.closest('.lit'))),
      placementCommands: commands.filter(c => c.kind === 'stack.place').length,
      placementLabels: await page.locator('.stack-placed-line:visible').count(),
      corePlacements: acts.items.filter(item => item.acts?.placed != null), commands: commands.map(c => c.kind), errors,
    };
    state.barOnSentCard = await card.evaluate(el => {
      const bar = document.querySelector('.message-bar'), b = bar.getBoundingClientRect(), c = el.getBoundingClientRect();
      return !bar.hidden && b.bottom >= c.top && b.top <= c.bottom;
    });
    results.push(state);
    await page.screenshot({ path: path.join(evidence, `sent-${width}.png`), fullPage: true });
    if (state.fieldClosed) {
      if (!await parentCard.locator(':scope > .message-preview').isVisible()) await parentCard.locator(':scope > .message-folded').click();
      await parentCard.locator(':scope > .message-preview').click();
      await field.waitFor({ state: 'visible' }); assert.equal(await field.inputValue(), '');
      assert.equal(await root.getAttribute('data-tall'), null, 'new opening starts at four lines');
      // The existing Reader and resting topic composer still send through
      // their own owners, with real clicks and committed Core receipts.
      if (width === 1280) {
        let answered; const seen = new Promise(resolve => { answered = resolve; });
        const held = new Promise(resolve => { releaseSend = resolve; });
        await page.route('**/api/command', async route => {
          if (route.request().postDataJSON()?.kind !== 'message.send') return route.continue();
          const response = await route.fetch(); answered(); await held; await route.fulfill({ response });
        });
        await field.fill('937 earlier send awaiting its answer');
        await page.locator(`[id="reply-${id}-send"]`).click(); await seen;
        await field.fill('937 keep this newer writing');
        const lateReceipt = page.waitForResponse(r => { try { return r.request().postDataJSON()?.kind === 'message.send'; } catch { return false; } });
        releaseSend(); assert.equal((await (await lateReceipt).json()).status, 'committed');
        await page.waitForTimeout(300);
        assert.equal(await field.isVisible(), true); assert.equal(await field.inputValue(), '937 keep this newer writing');
        assert.equal(await field.evaluate(el => document.activeElement === el), true);
        state.lateConfirmationKeepsNewWriting = true;
        await page.unroute('**/api/command'); await field.fill('');
        if (!await parentCard.locator(':scope > .message-preview').isVisible()) await parentCard.locator(':scope > .message-folded').click();
        await parentCard.locator(':scope > .message-preview').click();
        await page.locator('#reader[open]').waitFor();
        await page.locator('#writing-body').fill('937 Reader send control');
        const readerReceipt = page.waitForResponse(r => { try { return r.request().postDataJSON()?.kind === 'message.send'; } catch { return false; } });
        await page.locator('#send-reply').click();
        assert.equal((await (await readerReceipt).json()).status, 'committed');
        await page.locator('#reader[open]').waitFor({ state: 'hidden' });
        const resting = page.locator('#inline-writing-body'); await resting.fill('937 resting composer send control');
        const restingReceipt = page.waitForResponse(r => { try { return r.request().postDataJSON()?.kind === 'message.send'; } catch { return false; } });
        await page.locator('#inline-send').click();
        assert.equal((await (await restingReceipt).json()).status, 'committed');
        assert.equal(await resting.isVisible(), true); assert.equal(await resting.inputValue(), '');
        state.readerAndRestingSend = true;
      }
    }
    assert.deepEqual(errors, []); await context.close();
  }
  for (const state of results) {
    assert.equal(state.fieldClosed, true, 'confirmed Send closes empty parent reply');
    assert.equal(state.focused, true, 'new reply takes keyboard focus');
    assert.equal(state.lit, true, 'new reply takes the light');
    assert.equal(state.placementCommands, 0, 'plain Send records no placement');
    assert.equal(state.placementLabels, 0, 'plain Send shows no placement');
    assert.equal(state.barOnSentCard, true, 'toolbar stays on the sent card');
  }
} catch (error) {
  results.push({ error: error.stack });
  if (page && !page.isClosed()) await page.screenshot({ path: path.join(evidence, 'failure.png'), fullPage: true });
  throw error;
} finally {
  releaseSend?.();
  await browser.close(); child.stdin.end();
  const ended = await exit; results.push({ cleanup: ended });
  await writeFile(path.join(evidence, 'results.json'), JSON.stringify(results, null, 2));
  assert.deepEqual(ended, { code: 0, signal: null });
}

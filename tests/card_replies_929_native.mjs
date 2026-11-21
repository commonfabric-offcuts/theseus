// Isolated real HTTP/Core; native mouse double-click and focus in Chrome for Testing.
// AIM_CHROME and AIM_PLAYWRIGHT_CORE name the browser and module.
// node tests/card_replies_929_native.mjs /absolute/evidence
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { fixtureControl } from './fixture_control.mjs';
const { chromium } = createRequire(import.meta.url)(process.env.AIM_PLAYWRIGHT_CORE);
const evidence = process.argv[2]; await mkdir(evidence, { recursive: true });
const child = spawn('/usr/bin/python3', ['tests/fixtures/ui_http.py', '--freshness']);
const { control, exit, errors: fixtureErrors } = fixtureControl(child);
let browser, page; const results = [];
try {
  const facts = await control({ method: 'ready' });
  browser = await chromium.launch({ executablePath: process.env.AIM_CHROME, headless: true });
  const html = (await readFile('web/index.html', 'utf8')).replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '');
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  page = await context.newPage();
  await page.route('**/unit929', route => route.fulfill({ contentType: 'text/html', body: html }));
  await page.goto(facts.origin + '/unit929');
  const dom = await page.evaluate(async () => {
    const { CardReplies } = await import('/card-replies.mjs');
    const { Editor } = await import('/editor.mjs');
    const listeners = new Map(), add = window.addEventListener, remove = window.removeEventListener;
    window.addEventListener = function(type, fn, options) { if (['focus', 'click'].includes(type)) listeners.set(fn, type); return add.call(this, type, fn, options); };
    window.removeEventListener = function(type, fn, options) { listeners.delete(fn); return remove.call(this, type, fn, options); };
    const check = (value, reason) => { if (!value) throw Error(reason); };
    const topic = { id: 't1', title: 'DOM fixture' }, sessions = new Map();
    const registry = { current: null, disposed: false, async initializeCard(ref) {
      if (!sessions.has(ref.id)) sessions.set(ref.id, { surface: 'card', hidden: true, topic, source: { source_ref: ref },
        editors: { reply: new Editor({ instanceId: 'dom929', actor: 'person', sourceRef: ref, topicId: 't1', kind: 'reply' }) } });
      return sessions.get(ref.id);
    }, async hideCard(p) { p.hidden = true; return true; } };
    const callbacks = { instanceId: 'dom929', admits: p => !p.hidden && !registry.current,
      actorLabel: x => x, people: () => ({ kindOf: () => 'agent', everyone: [], members: () => [] }),
      needsReview: () => false, renderPending() {}, edit() {}, uploads: () => ({ current: () => [], running: new Set() }) };
    const owner = new CardReplies({ template: document.querySelector('#inline-composer'), registry, topic: () => topic,
      callbacks, offer() {}, discover() {}, say(error) { throw error; } });
    const cards = new Map();
    for (const id of ['a', 'b', 'c']) { const card = document.createElement('article'); card.tabIndex = 0; card.innerHTML = '<div class="message-preview">Source words</div>'; document.body.append(card); cards.set(id, card); }
    await owner.open('a', cards.get('a'));
    const a = owner.rows.get('a');
    check(a.ui.constructor.name === 'InlineComposer', 'actual InlineComposer constructor');
    check(document.activeElement === a.ui.field, 'actual field focused');
    a.ui.field.value = 'Exact field a'; a.ui.field.dispatchEvent(new Event('input', { bubbles: true }));
    await owner.open('b', cards.get('b')); const b = owner.rows.get('b');
    check(a.p.editors.reply.draft.body === 'Exact field a' && b.ui.field.value === '', 'independent registered writing');
    const ids = [...document.querySelectorAll('[id]')].map(el => el.id); check(ids.length === new Set(ids).size, 'cloned IDs unique');
    for (const row of owner.rows.values()) for (const el of row.ui.root.querySelectorAll('[aria-controls],[aria-labelledby],label[for]'))
      for (const name of ['for', 'aria-controls', 'aria-labelledby']) for (const id of (el.getAttribute(name) || '').split(' ').filter(Boolean))
        check(document.getElementById(id), 'cloned label target ' + id);
    b.ui.$('taller-field').click(); check(b.ui.root.hasAttribute('data-tall'), 'actual height control');
    b.ui.field.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    await new Promise(resolve => setTimeout(resolve, 0));
    check(b.ui.root.hidden && !b.ui.root.hasAttribute('data-tall'), 'actual Escape closes and resets');
    await owner.open('b', cards.get('b'));
    const replacement = document.createElement('article'); replacement.tabIndex = 0;
    document.body.append(replacement); cards.get('a').remove(); cards.set('a', replacement);
    owner.sync([{ id: 'a' }, { id: 'b' }], id => cards.get(id));
    check(owner.rows.get('a') === a && a.ui.root.parentElement === replacement, 'replacement card reuses its adapter and registered writing');
    // Dispose after detachment, without changing the registered editor.
    let checks = 0; a.ui.checkClipboard = b.ui.checkClipboard = () => { checks++; };
    cards.get('a').remove();
    owner.sync([{ id: 'b' }], id => cards.get(id));
    window.dispatchEvent(new Event('focus'));
    check(checks === 1, 'retired card must release its window focus listener');
    check(listeners.size === 2, 'only the surviving card keeps its two window listeners');
    check(!owner.rows.has('a') && sessions.get('a').editors.reply.draft.body === 'Exact field a', 'retirement keeps session writing');
    checks = 0; owner.dispose(); window.dispatchEvent(new Event('focus'));
    check(checks === 0, 'owner disposal releases remaining focus listeners');
    check(listeners.size === 0, 'all card window listeners removed');
    let release;
    const delayedRegistry = { ...registry, initializeCard: () => new Promise(resolve => { release = resolve; }) };
    const delayed = new CardReplies({ template: document.querySelector('#inline-composer'), registry: delayedRegistry, topic: () => topic,
      callbacks, offer() {}, discover() {}, say(error) { throw error; } });
    const opening = delayed.open('c', cards.get('c')); delayed.dispose();
    release(await registry.initializeCard({ kind: 'message', id: 'c' }));
    check(await opening === null && delayed.rows.size === 0 && listeners.size === 0, 'late source load cannot recreate a disposed adapter');
    window.addEventListener = add; window.removeEventListener = remove;
    return { passed: true, scope: 'actual CardReplies/InlineComposer DOM construction, ID labels, writing isolation, focus, Escape/height, detached-card and owner listener cleanup' };
  });
  results.push({ dom }); await context.close(); page = null;
  for (const width of [1280, 390]) {
    const own = await control({ method: 'agent_message', sender: 'person', whole_topic: true, body: `Round trip ${width}`, operation_id: `929-own-${width}` });
    const context = await browser.newContext({ viewport: { width, height: 900 } });
    page = await context.newPage(); const errors = []; page.on('pageerror', e => errors.push(e.message));
    await page.goto(facts.origin + '/?topic=t1');
    const card = page.locator(`[data-id="${own.result.message_id}"]`), words = card.locator(':scope > .message-preview');
    await words.click(); const field = card.locator('.card-reply-composer textarea'); await field.waitFor();
    await words.click(); await page.locator('#message-edit-field').waitFor();
    await page.keyboard.press('Escape'); await page.locator('#reader-close').click();
    await page.locator('#reader').waitFor({ state: 'hidden' });
    assert.equal(await field.isVisible(), false, 'empty inline field stays closed after Reader close');
    await words.click(); await field.waitFor(); await field.fill('Keep these reply words');
    await words.click(); await page.locator('#message-edit-field').waitFor();
    await page.keyboard.press('Escape');
    await page.locator('#writing-body').fill('Keep these reply words plus Reader writing');
    await page.locator('#reader-close').click(); await field.waitFor();
    assert.equal(await field.inputValue(), 'Keep these reply words plus Reader writing');
    await page.screenshot({ path: `${evidence}/kept-${width}.png` });
    assert.deepEqual(errors, []); results.push({ width, passed: true, scope: 'native mouse/keyboard Reader round trip; empty stays closed, writing stays visible' });
    await context.close(); page = null;
  }
} catch (error) {
  results.push({ passed: false, error: error.stack });
  if (page) { await page.screenshot({ path: `${evidence}/failure.png` }).catch(() => {}); await writeFile(`${evidence}/failure.html`, await page.content().catch(() => '')); }
  throw error;
} finally {
  await browser?.close(); child.stdin.end(); const ended = await exit;
  await writeFile(`${evidence}/results.json`, JSON.stringify({ results, fixtureExit: ended, fixtureErrors: fixtureErrors() }, null, 2));
  assert.equal(ended.code, 0);
}

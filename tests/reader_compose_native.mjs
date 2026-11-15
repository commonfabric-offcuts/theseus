// The Reader's composer (docs/reader.md) in Chrome for Testing and Safari's
// engine (Playwright's WebKit), against the isolated fixture: how much of the
// message shows while reading and while writing, that nothing boxed sits under
// it while reading but the one quiet line, the who chip's words, the ⋯ and +,
// an image that blocks Send, a draft kept across messages, every control by
// keyboard alone, Escape and outside presses keeping the writing, and the
// topic page's New message. A phone is 390×844 with real touch; a laptop is
// 1280×800, stacked and side by side; each in light and dark. The topic has
// a real team of seven, as Theseus's do, so whatever shows the topic's people
// is measured at a team's size, not one person's. On the phone every state a
// case photographs is also checked for controls a finger cannot hit.
//
// The keyboard is simulated: with a text field focused, the page is made
// 390×464 (380px shorter), which the browser reports as a visual viewport
// resize, as a phone's keyboard does. docs/reader.md says what only a real
// phone can show.
//
// Usage: node tests/reader_compose_native.mjs <Chrome for Testing> <evidence dir> [case filter]
// A filter runs the cases whose names hold it, or any of its parts split by |;
// a case's name starts with its engine ("chromium phone: …", "webkit …").
// AIM_PLAYWRIGHT_CORE names a playwright-core directory. The release check runs
// it as native-compose; tools/native.py compose [filter] runs it alone.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fixtureControl } from './fixture_control.mjs';
import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const [chrome, evidence, filter = ''] = process.argv.slice(2);
assert.ok(chrome && path.isAbsolute(chrome), 'an absolute Chrome for Testing');
assert.ok(evidence && path.isAbsolute(evidence), 'an absolute evidence directory');
const playwrightPath = process.env.AIM_PLAYWRIGHT_CORE;
assert.ok(playwrightPath && path.isAbsolute(playwrightPath), 'AIM_PLAYWRIGHT_CORE names an absolute playwright-core directory');
const playwright = createRequire(import.meta.url)(playwrightPath);

// Waits on what the page says, read after each animation frame the page draws.
const until = async (p, expression, description, arg, timeout = 8000) => {
  try { return await p.waitForFunction(expression, arg, { polling: 'raf', timeout }); }
  catch (error) { throw Error(`Timed out: ${description}`); }
};

const fixture = spawn('/usr/bin/python3', ['tests/fixtures/ui_http.py', '--live', '--freshness', '--images', '--media', '--agent-colors'], { cwd: root });
const { control, exit: fixtureExit, errors: fixtureErrors } = fixtureControl(fixture);

// What the fixture is seeded with, set by seed() inside the run below, so a seeding failure still leaves native.json.
let facts, agent, first, second, log, wrap;
// Two long messages from an agent, newest last, so a reply to either is
// offered to that agent; and the outcome's pipeline on, so the ⋯ offers it.
const agentMessage = async (n, body) => (await control({ method: 'agent_message', operation_id: `compose-agent-${n}`, body })).result.message_id;
// A real team in the topic: the agent, the person and six more.
const TEAM = ['aim-core', 'aim-lead', 'aim-spec', 'aim-ux', 'fable', 'warp'];
// A log as agents send them, in a topic of its own: one code block, one
// passage in the Reader, taller than any screen.
const LOG = ['The build log, whole:', '', '```', ...Array.from({ length: 70 }, (_, i) => `step ${i + 1}: compiled module ${i + 1} of 70 in ${100 + i} ms`), '```', '', 'That is all of it.'].join('\n');
// A list item long enough to wrap to many lines, in a topic of its own: one
// passage in the Reader, whose lines wrap anew as the Reader's width changes.
const WRAP = ['A plan in one item:', ...Array.from({ length: 16 }, (_, i) => `Paragraph ${i + 1} before the item, to scroll by.`), '- ' + Array.from({ length: 60 }, (_, i) => `part ${i + 1} of the plan`).join(', ') + ', and the item ends here.', '',
  Array.from({ length: 60 }, (_, i) => `Sentence ${i + 1} of a long paragraph.`).join(' '),
  ...Array.from({ length: 30 }, (_, i) => `Paragraph ${i + 1} after the item, to scroll by.`)].join('\n\n');
async function seed() {
  facts = await control({ method: 'ready' });
  agent = facts.agent;
  first = await agentMessage(1, Array.from({ length: 60 }, (_, i) => `First agent passage ${i + 1}, a sentence long enough to wrap on a phone.`).join(' '));
  second = await agentMessage(2, Array.from({ length: 60 }, (_, i) => `Second agent passage ${i + 1}, a sentence long enough to wrap on a phone.`).join(' '));
  await control({ method: 'pipeline', kind: 'pipeline.configure', operation_id: 'compose-pipeline', target: { workspace_id: 'w1' }, args: { enabled: true } });
  await control({ method: 'topic_state', operation_id: 'compose-team', topic_id: 't1', participants: TEAM, args: { state: 'active', note: '' } });
  await control({ method: 'navigation_topics', topics: [{ id: 'compose-log', title: 'Build log' }] });
  log = (await control({ method: 'agent_message', operation_id: 'compose-log', topic_id: 'compose-log', join: true, source: 'topic', body: LOG })).result.message_id;
  await control({ method: 'navigation_topics', topics: [{ id: 'compose-wrap', title: 'Long item' }] });
  wrap = (await control({ method: 'agent_message', operation_id: 'compose-wrap', topic_id: 'compose-wrap', join: true, source: 'topic', body: WRAP })).result.message_id;
}

const SHAPES = {
  phone: { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 },
  stacked: { viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 },
  wide: { viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 },
  // The composer's size (runSizes): the narrowest phones, a laptop taller than
  // the Reader's old 54rem, and a window wider than its maximum.
  'phone-320': { viewport: { width: 320, height: 568 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 },
  'phone-375': { viewport: { width: 375, height: 667 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 },
  'phone-390': { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 },
  // A phone turned sideways is wider than the phone's layout (760px), so it is
  // sized as a small laptop window, and a narrow, short window with a mouse is
  // laid out as a phone is, without the keyboard or a finger's sizes.
  'phone-sideways': { viewport: { width: 844, height: 390 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 },
  narrow: { viewport: { width: 480, height: 300 }, deviceScaleFactor: 1 },
  'laptop-stacked': { viewport: { width: 1440, height: 960 }, deviceScaleFactor: 1 },
  'laptop-wide': { viewport: { width: 1440, height: 960 }, deviceScaleFactor: 1 },
  'very-wide-stacked': { viewport: { width: 2560, height: 1440 }, deviceScaleFactor: 1 },
  'very-wide-wide': { viewport: { width: 2560, height: 1440 }, deviceScaleFactor: 1 },
};
const KEYBOARD = 380;

const results = [], measured = [], shots = [], contexts = new Set();
let browser, engine;

async function page(shape, scheme = 'light', path = '/?topic=t1') {
  const options = SHAPES[shape];
  const context = await browser.newContext({ ...options, colorScheme: scheme });
  contexts.add(context);
  if (engine === 'chromium') await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: facts.origin });
  const mode = JSON.stringify(['aim-next', facts.instance_id, 'reader-layout', 'mode']);
  await context.addInitScript(([key, value]) => { try { localStorage.setItem(key, value); } catch { /* a fresh page reads stacked */ } }, [mode, shape.endsWith('wide') ? 'wide' : 'stacked']);
  const p = await context.newPage();
  const errors = [];
  p.on('pageerror', error => errors.push(String(error)));
  await p.goto(facts.origin + path);
  // A busy machine can take a while over the first load.
  await until(p, () => document.body?.dataset.ready === 'true', 'application bootstrap', undefined, 30000);
  // The clipboard is the machine's: each case starts with text on it, not an image.
  if (engine === 'chromium') await p.evaluate(() => navigator.clipboard.writeText('compose check'));
  return Object.assign(p, { shape, scheme, errors, ctx: context, touch: Boolean(options.hasTouch) });
}
// A press as the shape makes it: a finger's tap on the phone, a click on a laptop.
// force: a control dimmed with aria-disabled is still there to press.
const press = (p, selector, force = false) => p.touch ? p.locator(selector).first().tap({ force }) : p.locator(selector).first().click({ force });
async function open(p, id, words = id === first ? 'First agent' : 'Second agent') {
  const card = `#messages [data-id="${id}"]`;
  await until(p, s => Boolean(document.querySelector(s)), 'the message card', card);
  await p.locator(card).scrollIntoViewIfNeeded();
  // The card's words, away from its buttons and links: on a laptop the
  // pointer lights it and a click opens it; on a phone a tap lights it and a
  // second tap opens it.
  const box = await p.locator(card).boundingBox(), x = box.x + box.width / 2, y = box.y + box.height * 0.6;
  if (p.touch) {
    await p.touchscreen.tap(x, y);
    await until(p, s => document.querySelector(s).classList.contains('lit'), 'the card lit', card);
    await p.touchscreen.tap(x, y);
  } else {
    // A long message's excerpt becomes a box that scrolls under a resting
    // pointer; the cue under it ("Open to read it whole") opens it from there.
    await p.mouse.move(x, y);
    const cue = p.locator(`${card} .message-preview-cue`);
    if (await cue.count()) await cue.first().click(); else await p.mouse.click(x, y);
  }
  await until(p, s => document.querySelector('#reader').open && document.querySelector('#source-body').textContent.startsWith(s), 'the Reader on the message', words)
    .catch(async error => { await picture(p, 'open-failed'); throw Error(`${error.message}: ${await p.evaluate(s => JSON.stringify({ open: document.querySelector('#reader').open, lit: document.querySelector(s)?.className, at: document.activeElement?.id, body: document.querySelector('#source-body').textContent.slice(0, 40) }), card)}`); });
  await until(p, () => document.getAnimations().filter(x=>x.effect?.getTiming().iterations!==Infinity).every(a => a.playState !== 'running'), 'a settled Reader');
}
// The keyboard comes up as a phone's does: the visible height falls while a text field has focus.
async function keyboardUp(p) {
  if (p.shape !== 'phone') return;
  await p.setViewportSize({ width: 390, height: 844 - KEYBOARD });
  await until(p, h => Math.round(visualViewport.height) === h && getComputedStyle(document.documentElement).getPropertyValue('--vv-height').trim() === `${h}px`, 'the Reader at the keyboard\'s top', 844 - KEYBOARD);
}
async function keyboardDown(p) {
  if (p.shape !== 'phone') return;
  await p.setViewportSize({ width: 390, height: 844 });
  await until(p, () => Math.round(visualViewport.height) === 844 && getComputedStyle(document.documentElement).getPropertyValue('--vv-height').trim() === '844px', 'the keyboard down');
}
// Controls of any composer a finger cannot hit: shown, and under 44px either way.
const smallTargets = p => p.evaluate(() => [...document.querySelectorAll('.composer :is(button, input, textarea, select, [role=button])')]
  .filter(el => el.getClientRects().length && getComputedStyle(el).visibility !== 'hidden')
  .map(el => { const b = el.getBoundingClientRect(); return [el.id || el.dataset.intent || el.dataset.name || el.getAttribute('aria-label') || el.textContent || el.className, Math.round(b.width), Math.round(b.height)]; })
  .filter(([, width, height]) => width < 44 || height < 44));
async function type(p, text) {
  await press(p, '#writing-body');
  await until(p, () => document.activeElement?.id === 'writing-body' && document.querySelector('#reader-composer').dataset.compose === 'writing', 'the field taking the writing');
  await p.keyboard.insertText(text);
}
// Lines of the message that show: the article's text box, below the header,
// above the composer and the keyboard, over its line height.
const messageLines = p => p.evaluate(() => {
  const article = document.querySelector('#source-body'), style = getComputedStyle(article), box = article.getBoundingClientRect();
  const header = document.querySelector('.reader-header').getBoundingClientRect(), composer = document.querySelector('#reader-composer').getBoundingClientRect();
  const wide = document.querySelector('#reader').dataset.layout === 'wide';
  const top = Math.max(box.top + parseFloat(style.paddingTop), header.bottom);
  const bottom = Math.min(box.bottom - parseFloat(style.paddingBottom), wide ? Infinity : composer.top, visualViewport.height + visualViewport.offsetTop);
  return { lines: Math.floor((bottom - top) / parseFloat(style.lineHeight)), lineHeight: parseFloat(style.lineHeight), visible: Math.round(bottom - top) };
});
async function picture(p, name) {
  const file = path.join(evidence, engine, `${p.shape}-${p.scheme}-${name}.png`);
  await mkdir(path.dirname(file), { recursive: true });
  await until(p, () => document.getAnimations().filter(x=>x.effect?.getTiming().iterations!==Infinity).every(a => a.playState !== 'running'), 'a settled page');
  await p.screenshot({ path: file });
  shots.push(path.relative(evidence, file));
}
// A state worth a picture is one a finger meets: under touch, every control
// of a composer in it is a finger's size.
async function shot(p, name) {
  await picture(p, name);
  if (p.touch) assert.deepEqual(await smallTargets(p), [], `${name}: every control of the composer is a finger's size`);
}
// Every visible control in the Reader that is not inside the message's text:
// what a person sees under the message while reading.
const controlsUnder = p => p.evaluate(() => {
  const article = document.querySelector('#source-body').getBoundingClientRect();
  return [...document.querySelectorAll('#reader button, #reader input, #reader textarea, #reader select, #reader [role=button]')]
    .filter(el => el.getClientRects().length && !el.closest('#source-body') && getComputedStyle(el).visibility !== 'hidden')
    .filter(el => el.getBoundingClientRect().top >= article.bottom - 1)
    .map(el => el.id || el.className || el.tagName);
});

// How far the Reader's notice reaches over the message's box, in pixels: 0
// when it sits clear of it, as a notice must, so it never covers what is read.
const noticeOver = p => p.evaluate(() => {
  const n = document.querySelector('#reader-notice').getBoundingClientRect(), m = document.querySelector('#source-body').getBoundingClientRect();
  const across = Math.min(n.right, m.right) > Math.max(n.left, m.left);
  return across ? Math.max(0, Math.round(Math.min(n.bottom, m.bottom) - Math.max(n.top, m.top))) : 0;
});
const noticeWords = p => p.evaluate(() => document.querySelector('#reader-notice').hidden ? '' : document.querySelector('#reader-notice').textContent);

// The case that ended with the drafts not reset, so the next case resets them
// before it runs.
let unreset = null;
async function check(name, action) {
  const full = `${engine} ${name}`;
  if (filter && !filter.split('|').some(part => full.includes(part))) return;
  const failures = [], say = error => error.stack ?? String(error);
  // After a case whose reset was refused, this one begins with that reset,
  // once (its pages are closed; only a save a closed page left on its way
  // can still land, as CommandGate in ui_http.py says). Refused again, the
  // case does not run on the writing the earlier case left, and says so.
  if (unreset) {
    try { await control({ method: 'reset_drafts' }); unreset = null; }
    catch (error) { failures.push(`Drafts not reset after "${unreset}": ${say(error)}`); }
  }
  if (!unreset) {
    const started = Date.now();
    // The admitted reds' fingerprints name this line as their runner frame
    // (.github/check-baseline.json): it stays as it reads. A pass it records
    // is taken back below when ending the case fails.
    try { await action(); results.push({ name: full, passed: true, ms: Date.now() - started }); console.log(`PASS ${full}`); }
    catch (error) { failures.push(say(error)); }
    // The case ends with every page closed, each on its own so that one that
    // throws leaves none open to save into later cases, and the drafts reset.
    for (const context of contexts) {
      try { await context.close(); } catch (error) { failures.push(`Ending the case, closing a page: ${say(error)}`); }
    }
    contexts.clear();
    try { await control({ method: 'reset_drafts' }); }
    catch (error) { failures.push(`Ending the case, the drafts were not reset: ${say(error)}`); unreset = full; }
  }
  if (failures.length) {
    if (results.at(-1)?.name === full) results.pop();
    results.push({ name: full, passed: false, error: failures.join('\nthen, ') }); console.log(`FAIL ${full}\n${failures.join('\nthen, ')}`);
  }
  // A fixture that has exited answers nothing more: the run stops here, its
  // evidence written, rather than failing every case left.
  if (fixture.exitCode !== null || fixture.signalCode !== null) throw Error(`The fixture exited during "${full}": ${fixtureErrors()}`);
}
const close = async p => { assert.deepEqual(p.errors, [], 'no page errors'); contexts.delete(p.ctx); await p.ctx.close(); };

// The selectors of naming someone, in the Reader and the New message sheet.
const NAMING = {
  Reader: { chip: '#who-chip', panel: '#who-panel', open: '#recipient-open', sheet: '#recipient-sheet', input: '#recipient-input', names: '#recipient-chips',
    named: '#recipient-named', done: '#recipient-done', back: '#recipient-back', panelDone: '#who-done', field: '#writing-body', composer: '#reader-composer' },
  'New message sheet': { chip: '#inline-who-chip', panel: '#inline-who-panel', open: '#inline-recipient-open', sheet: '#inline-recipient-sheet', input: '#inline-recipient-input',
    names: '#inline-recipient-chips', named: '#inline-recipient-named', done: '#inline-recipient-done', back: '#inline-recipient-back', panelDone: '#inline-who-done',
    field: '#inline-writing-body', composer: '#inline-composer' },
};
// Who a composer names: its step-1 chips, painted on a laptop too, where they are not shown.
const namedIn = (p, at) => p.evaluate(s => [...document.querySelector(s).querySelectorAll('[data-name]')].map(el => el.dataset.name), at.named);

async function run() {
  for (const scheme of ['light', 'dark']) {
    await check(`phone ${scheme}: reading shows at least 18 lines of the message, writing with the keyboard up at least 7, nothing boxed sits under it while reading but the one quiet line, the panels take the keyboard's place, and every control is 44px`, async () => {
      const p = await page('phone', scheme);
      await open(p, second);
      const reading = await messageLines(p);
      measured.push({ engine, shape: 'phone', scheme, state: 'reading', ...reading });
      assert.ok(reading.lines >= 18, `phone reading shows ${reading.lines} lines`);
      const under = await controlsUnder(p);
      assert.deepEqual(under.filter(id => !['plus-button', 'writing-body', 'thumb-source'].includes(id)), [], `only the quiet line under the message: ${under.join(', ')}`);
      const line = await p.evaluate(() => document.querySelector('#reader-composer').getBoundingClientRect().height);
      assert.ok(line <= 72, `the quiet line is one line tall (${line}px)`);
      // + and 👍 are quiet: no ring and no fill until pressed.
      const boxed = await p.evaluate(() => ['#plus-button', '#thumb-source'].map(s => getComputedStyle(document.querySelector(s)))
        .map(c => [c.borderTopColor, c.backgroundColor].some(color => !/^rgba\(0, 0, 0, 0\)$|^transparent$/.test(color))));
      assert.deepEqual(boxed, [false, false], 'the quiet line\'s + and 👍 wear no ring or fill');
      await shot(p, 'reading');
      await type(p, 'Thanks, reading it now.');
      await keyboardUp(p);
      const writing = await messageLines(p);
      measured.push({ engine, shape: 'phone', scheme, state: 'writing, keyboard up', ...writing });
      assert.ok(writing.lines >= 7, `phone writing with the keyboard up shows ${writing.lines} lines`);
      await shot(p, 'writing');
      // A long reply: the field stops growing at its height and scrolls.
      await p.keyboard.insertText('\n' + Array.from({ length: 11 }, (_, i) => `Line ${i + 2} of a long reply.`).join('\n'));
      const long = await messageLines(p);
      measured.push({ engine, shape: 'phone', scheme, state: 'writing a long reply, keyboard up', ...long });
      assert.ok(long.lines >= 7, `phone writing a long reply with the keyboard up shows ${long.lines} lines`);
      await shot(p, 'writing-long');
      // The taller-field toggle: one press gives the writing more room, the
      // writing keeps the focus (and the keyboard), and a second press puts
      // the field back as it was.
      const field = () => p.evaluate(() => ({ height: Math.round(document.querySelector('#writing-body').getBoundingClientRect().height),
        pressed: document.querySelector('#taller-field').getAttribute('aria-pressed'), focus: document.activeElement?.id }));
      const short = await field();
      assert.equal(short.pressed, 'false', 'the field starts at its own height');
      await press(p, '#taller-field');
      await until(p, h => document.querySelector('#writing-body').getBoundingClientRect().height > h * 2, 'the field taller', short.height)
        .catch(async error => assert.fail(`${error.message}: ${JSON.stringify([short, await field()])}`));
      assert.deepEqual({ ...await field(), height: undefined }, { height: undefined, pressed: 'true', focus: 'writing-body' }, 'taller, and still writing');
      await shot(p, 'writing-tall');
      await press(p, '#taller-field');
      await until(p, h => Math.round(document.querySelector('#writing-body').getBoundingClientRect().height) === h, 'the field back to its height', short.height)
        .catch(async error => assert.fail(`${error.message}: ${JSON.stringify([short, await field()])}`));
      assert.deepEqual(await field(), short, 'a second press puts the field back');
      // The who panel takes the keyboard's place at its height.
      await press(p, '#who-chip');
      await keyboardDown(p);
      await until(p, () => !document.querySelector('#who-panel').hidden, 'the who panel');
      const panel = await p.evaluate(() => ({ height: Math.round(document.querySelector('#who-panel').getBoundingClientRect().height), bottom: Math.round(document.querySelector('#who-panel').getBoundingClientRect().bottom), focus: document.activeElement?.id }));
      assert.ok(Math.abs(panel.height - KEYBOARD) <= 2, `the who panel is the keyboard's height (${panel.height}px)`);
      assert.ok(Math.abs(panel.bottom - 844) <= 2, `the who panel sits where the keyboard was (${panel.bottom})`);
      assert.notEqual(panel.focus, 'writing-body', 'the field let the keyboard go');
      const withPanel = await messageLines(p);
      measured.push({ engine, shape: 'phone', scheme, state: 'who panel', ...withPanel });
      await shot(p, 'who-panel');
      if (engine === 'chromium') {
        // A finger scrolling the message keeps the who panel, as it would
        // keep the keyboard. (WebKit's driver has no touch drag.)
        const scrolled = () => p.evaluate(() => { let sum = 0; for (let el = document.querySelector('#source-body'); el; el = el.parentElement) sum += el.scrollTop; return sum; });
        const box = await p.locator('#source-body').boundingBox(), x = box.x + box.width / 2, y = Math.max(box.y, 60) + 150;
        const top = await scrolled(), cdp = await p.context().newCDPSession(p);
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
        for (let step = 1; step <= 8; step++) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y: y - step * 12 }] });
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
        await until(p, () => document.getAnimations().filter(x=>x.effect?.getTiming().iterations!==Infinity).every(a => a.playState !== 'running'), 'the scroll settled');
        assert.ok(await scrolled() > top, 'the finger scrolled the message');
        assert.equal(await p.evaluate(() => document.querySelector('#who-panel').hidden), false, 'scrolling the message keeps the who panel');
      }
      // A tap on + while the who panel is open is a tap on +: the who panel
      // goes and the + panel comes, though closing one moves the other.
      await press(p, '#plus-button');
      await until(p, () => document.querySelector('#who-panel').hidden && !document.querySelector('#plus-panel').hidden, 'the + panel in the who panel\'s place');
      await shot(p, 'plus-panel');
      await close(p);
    });
    for (const shape of ['stacked', 'wide']) await check(`laptop ${shape} ${scheme}: the message fills the Reader while reading and writing${shape === 'stacked' ? ', at least 17 lines while writing' : ''}`, async () => {
      const p = await page(shape, scheme);
      await open(p, second);
      const reading = await messageLines(p);
      measured.push({ engine, shape, scheme, state: 'reading', ...reading });
      if (shape === 'stacked') {
        const under = await controlsUnder(p);
        assert.deepEqual(under.filter(id => !['plus-button', 'writing-body', 'thumb-source'].includes(id)), [], `only the quiet line under the message: ${under.join(', ')}`);
      }
      await shot(p, 'reading');
      // 👍 is on the quiet line; with nothing written Send is dimmed and 👍 stands beside it, until a word is typed.
      const thumb = () => p.evaluate(() => document.querySelector('#thumb-source').getClientRects().length > 0);
      // Where the field is across, and where 👍 starts while it shows.
      const across = () => p.evaluate(() => { const f = document.querySelector('#reader-composer>.field-box').getBoundingClientRect(), t = document.querySelector('#thumb-source');
        return { x: Math.round(f.left), width: Math.round(f.width), thumb: t.getClientRects().length ? Math.round(t.getBoundingClientRect().left) : null }; });
      assert.equal(await thumb(), true, '👍 on the quiet line');
      const line = await across();
      await press(p, '#writing-body');
      await until(p, () => document.querySelector('#reader-composer').dataset.compose === 'writing', 'the composer');
      const empty = await p.evaluate(() => { const send = document.querySelector('#send-reply'); return { dim: send.disabled || send.getAttribute('aria-disabled') === 'true', opacity: Number(getComputedStyle(send).opacity) }; });
      assert.ok(empty.dim && empty.opacity < 1, `with nothing written Send is dimmed (${JSON.stringify(empty)})`);
      assert.equal(await thumb(), true, 'with nothing written 👍 is beside Send');
      const unwritten = await across();
      await type(p, 'Thanks, reading it now.');
      assert.equal(await thumb(), false, '👍 goes once words are typed');
      // The field makes room for 👍 only where 👍 shares its row, so the first word never moves it in Wide.
      const typed = await across();
      if (shape === 'wide') {
        assert.deepEqual([line, unwritten].map(({ x, width }) => ({ x, width })), [typed, typed].map(({ x, width }) => ({ x, width })),
          `side by side, the field is the column's width on the line, writing with nothing written, and with words (${JSON.stringify([line, unwritten, typed])})`);
      } else {
        assert.ok(unwritten.x + unwritten.width <= unwritten.thumb, `stacked, with nothing written the field ends before 👍 (${JSON.stringify(unwritten)})`);
        assert.ok(typed.x === unwritten.x && typed.x + typed.width > unwritten.thumb, `stacked, with words the field takes 👍's place (${JSON.stringify([unwritten, typed])})`);
      }
      assert.equal(await p.evaluate(() => document.querySelector('#send-reply').disabled), false, 'with words written Send can be pressed');
      const writing = await messageLines(p);
      measured.push({ engine, shape, scheme, state: 'writing', ...writing });
      if (shape === 'stacked') assert.ok(writing.lines >= 17, `laptop stacked writing shows ${writing.lines} lines`);
      await shot(p, 'writing');
      // A long reply: the field stops growing at its height and scrolls, and the message keeps its lines.
      await p.keyboard.insertText('\n' + Array.from({ length: 11 }, (_, i) => `Line ${i + 2} of a long reply.`).join('\n'));
      const long = await messageLines(p);
      measured.push({ engine, shape, scheme, state: 'writing a long reply', ...long });
      if (shape === 'stacked') assert.ok(long.lines >= 17, `laptop stacked writing a long reply shows ${long.lines} lines`);
      await shot(p, 'writing-long');
      await press(p, '#who-chip');
      await until(p, () => !document.querySelector('#who-panel').hidden, 'the who panel');
      if (shape === 'stacked') {
        // A popover over the message: the message does not move.
        const over = await messageLines(p);
        assert.equal(over.lines, long.lines, 'the who panel opens over the message, not pushing it');
      } else {
        const inColumn = await p.evaluate(() => { const panel = document.querySelector('#who-panel').getBoundingClientRect(), column = document.querySelector('#reader-composer').getBoundingClientRect(); return panel.left >= column.left && panel.right <= column.right && getComputedStyle(document.querySelector('#who-panel')).position === 'static'; });
        assert.ok(inColumn, 'side by side, the who panel opens inside the writing column');
      }
      await shot(p, 'who-panel');
      await p.keyboard.press('Escape');
      await press(p, '#plus-button');
      await until(p, () => !document.querySelector('#plus-panel').hidden, 'the + panel');
      await shot(p, 'plus-panel');
      await p.keyboard.press('Escape');
      await press(p, '#reader-menu');
      await until(p, () => Boolean(document.querySelector('[role=menu]')), 'the ⋯ menu');
      await shot(p, 'menu');
      await close(p);
    });
  }

  for (const shape of ['phone', 'stacked']) {
    await check(`${shape}: the who chip says in words what Send does and who sees it, as the panel's sentence does; a reply starts as a Tell, and a whisper chosen is dashed and Send says Whisper`, async () => {
      const p = await page(shape);
      await open(p, second);
      await type(p, 'A reply to the agent.');
      const read = () => p.evaluate(() => ({ chip: document.querySelector('#who-chip').textContent, dashed: getComputedStyle(document.querySelector('#who-chip')).borderTopStyle === 'dashed',
        field: getComputedStyle(document.querySelector('#writing-body')).borderTopStyle, send: document.querySelector('#send-reply .send-word')?.textContent ?? document.querySelector('#send-reply').textContent,
        sentence: document.querySelector('#who-panel .audience-line')?.textContent ?? '', who: document.querySelector('#who-panel .audience-line strong')?.textContent ?? '' }));
      let now = await read();
      assert.deepEqual([now.chip, now.dashed, now.field === 'dashed', now.send], [`Tell ${agent} · everyone here`, false, false, 'Tell'], 'a reply to one agent starts as a Tell');
      await press(p, '#who-chip');
      await until(p, () => !document.querySelector('#who-panel').hidden, 'the who panel');
      now = await read();
      assert.ok(now.who.startsWith('Everyone in this topic'), 'the panel says the whole sentence: ' + now.sentence);
      const order = await p.evaluate(() => [...document.querySelectorAll('#who-panel .audience-line, #who-panel .who-label')].filter(el => el.getClientRects().length).map(el => el.classList.contains('audience-line') ? 'sentence' : el.textContent));
      // This message's reply may go to the topic or the outcome's conversation, so In is offered.
      const offered = await p.evaluate(() => document.querySelectorAll('#reply-destination button[data-destination]').length > 1);
      assert.deepEqual(order, ['sentence', 'How', 'To', ...(offered ? ['In'] : [])], 'the sentence first, then How and To, and In only when offered');
      await shot(p, 'tell');
      await press(p, '#who-panel [data-intent="whisper"]');
      await until(p, () => document.querySelector('#who-chip').textContent.startsWith('Whisper '), 'the chip following the choice');
      now = await read();
      assert.deepEqual([now.chip, now.dashed, now.field, now.send], [`Whisper to ${agent} · only you two`, true, 'dashed', 'Whisper']);
      assert.equal(now.who, `Only you and ${agent}`, now.sentence);
      await shot(p, 'whisper');
      await close(p);
    });

    await check(`${shape}: the ⋯ holds Copy Link, Mark unread, Start a topic from this and Add to pipeline${shape === 'phone' ? ', as a sheet from the bottom' : ''}, and nothing of them sits under the message`, async () => {
      const p = await page(shape);
      await open(p, second);
      const visibleUnder = await p.evaluate(() => ['mark-unread', 'start-from-message', 'add-to-pipeline'].filter(id => document.getElementById(id)?.getClientRects().length));
      assert.deepEqual(visibleUnder, [], 'no row of buttons under the message');
      await press(p, '#reader-menu');
      await until(p, () => Boolean(document.querySelector('[role=menu]')), 'the ⋯ menu');
      const items = await p.evaluate(() => [...document.querySelectorAll('[role=menu] [role=menuitem]')].map(item => item.textContent));
      for (const label of ['Copy Link', 'Mark unread', 'Start a topic from this', 'Add to pipeline']) assert.ok(items.includes(label), `${label} in ${items.join(', ')}`);
      if (shape === 'phone') {
        const sheet = await p.evaluate(() => { const box = document.querySelector('[role=menu]').getBoundingClientRect(); return { left: Math.round(box.left), right: Math.round(box.right), bottom: Math.round(box.bottom), targets: Math.min(...[...document.querySelectorAll('[role=menu] [role=menuitem]')].map(item => item.getBoundingClientRect().height)) }; });
        assert.deepEqual([sheet.left, sheet.right, sheet.bottom], [0, 390, 844], 'a sheet across the bottom');
        assert.ok(sheet.targets >= 44, `each item a finger's size (${sheet.targets}px)`);
      }
      await shot(p, 'menu');
      await p.keyboard.press('Escape');
      await until(p, () => !document.querySelector('[role=menu]') && document.activeElement?.id === 'reader-menu', 'the menu closed back to ⋯');
      await close(p);
    });

    await check(`${shape}: + holds Add image, the note and Quote${engine === 'chromium' ? ', and Add image says Paste image when the clipboard holds one' : ''}; Quote only while words are selected, and a quote of a passage out of sight brings it just above the reply, where it then stays as the reply shrinks`, async () => {
      const p = await page(shape);
      await open(p, second);
      await type(p, 'With an image.');
      await press(p, '#plus-button');
      await until(p, () => !document.querySelector('#plus-panel').hidden, 'the + panel');
      const tiles = () => p.evaluate(() => [...document.querySelectorAll('#plus-panel .tile')].filter(t => t.getClientRects().length).map(t => [t.textContent, t.disabled]));
      assert.deepEqual(await tiles(), [['Add image', false], ['Add note', false], ['Quote selection', true]]);
      await p.keyboard.press('Escape');
      // Words selected in the message light Quote, in + and as the pill.
      await p.evaluate(() => { const text = document.querySelector('#source-body span').firstChild, range = document.createRange(); range.setStart(text, 0); range.setEnd(text, 12); getSelection().removeAllRanges(); getSelection().addRange(range); });
      await until(p, () => !document.querySelector('#quote-selection').hidden, 'the quote pill');
      await shot(p, 'quote-pill');
      // Quoting words out of sight brings them just above the reply.
      await p.evaluate(() => { const text = document.querySelector('#source-body').children[45].firstChild, range = document.createRange(); range.setStart(text, 0); range.setEnd(text, 12); getSelection().removeAllRanges(); getSelection().addRange(range); });
      await until(p, () => !document.querySelector('#quote-selection').hidden, 'the quote pill for a passage further down');
      await press(p, '#quote-selection');
      await until(p, () => document.querySelector('#writing-body').value.includes('Second agent') && document.getAnimations().filter(x=>x.effect?.getTiming().iterations!==Infinity).every(a => a.playState !== 'running'), 'the words quoted into the reply');
      const measureKept = () => {
        const body = document.querySelector('#source-body'), style = getComputedStyle(body), box = body.getBoundingClientRect();
        const wide = document.querySelector('#reader').dataset.layout === 'wide';
        const bottom = Math.min(box.bottom - parseFloat(style.paddingBottom), wide ? Infinity : document.querySelector('#reader-composer').getBoundingClientRect().top);
        const words = document.createRange(); words.setStart(body.children[45].firstChild, 0); words.setEnd(body.children[45].firstChild, 12);
        return { gap: Math.round(bottom - words.getBoundingClientRect().bottom), lineHeight: parseFloat(style.lineHeight) };
      };
      const kept = await p.evaluate(measureKept);
      assert.ok(kept.gap >= -2 && kept.gap <= kept.lineHeight, `the quoted words sit just above the reply (${kept.gap}px above it)`);
      await shot(p, 'quoted');
      // On a laptop the reply changing its height changes the message's room;
      // growing room covers nothing, so the passage stays where it is on
      // screen (a phone's field is shorter than what the quote put in it, so
      // it holds its height).
      if (shape === 'stacked') {
        const before = await p.evaluate(() => document.querySelector('#reader-composer').getBoundingClientRect().height);
        const was = await p.evaluate(() => document.querySelector('#source-body').children[45].getBoundingClientRect().top);
        await p.locator('#writing-body').fill('Short.');
        await until(p, h => document.querySelector('#reader-composer').getBoundingClientRect().height < h - 20 && document.getAnimations().filter(x=>x.effect?.getTiming().iterations!==Infinity).every(a => a.playState !== 'running'), 'the reply shorter', before);
        // A resize is told to its observers at the next frame's rendering, after its animation callbacks.
        await p.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
        const now = await p.evaluate(() => document.querySelector('#source-body').children[45].getBoundingClientRect().top);
        assert.ok(Math.abs(now - was) <= 2, `as the reply shrinks the quoted passage stays where it was on screen (its top at ${Math.round(was)}px, then ${Math.round(now)}px)`);
      }
      if (engine === 'chromium') {
        await p.evaluate(async () => {
          const canvas = Object.assign(document.createElement('canvas'), { width: 4, height: 4 });
          const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
          await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
        });
        await p.evaluate(() => getSelection().removeAllRanges());
        // + asks the clipboard as it opens.
        await press(p, '#plus-button');
        await until(p, () => !document.querySelector('#plus-panel').hidden && document.querySelector('#add-image').textContent === 'Paste image', 'the + panel offering Paste image');
        assert.deepEqual((await tiles()).map(([label]) => label), ['Paste image', 'Choose file', 'Add note', 'Quote selection']);
        // A tile does its one thing and puts + away: Paste image adds the image.
        await press(p, '#add-image');
        await until(p, () => Boolean(document.querySelector('#writing-attachments .image-choice')), 'the pasted image in the strip');
        assert.equal(await p.evaluate(() => document.querySelector('#plus-panel').hidden), true, 'Paste image put + away');
      }
      await close(p);
    });

    // Pressing ⋯ or + moves the focus, and a press can let the selection go,
    // so what is quoted is taken as the press is made. Each way of choosing
    // words a shape has: a drag and a press that lights a passage with a
    // mouse, words selected on a phone, and Select All then the keys alone.
    const ways = shape === 'phone' ? ['select'] : ['drag', 'press', 'keys'];
    for (const surface of ['⋯', '+']) await check(`${shape}: Quote selection in the ${surface} quotes what was chosen before it was pressed, after ${ways.join(', ')}; with nothing chosen it is not offered`, async () => {
      const tab = (p, back = false) => p.keyboard.press(`${engine === 'webkit' ? 'Alt+' : ''}${back ? 'Shift+' : ''}Tab`);
      const active = p => p.evaluate(() => document.activeElement?.id || document.activeElement?.textContent || '');
      for (const way of ways) {
        const p = await page(shape);
        await open(p, second);
        const offered = async () => {
          if (surface === '⋯') {
            await until(p, () => Boolean(document.querySelector('[role=menu]')), 'the ⋯ menu');
            return p.evaluate(() => [...document.querySelectorAll('[role=menu] [role=menuitem]')].some(item => item.textContent === 'Quote selection'));
          }
          await until(p, () => !document.querySelector('#plus-panel').hidden, 'the + panel');
          return p.evaluate(() => !document.querySelector('#plus-quote').disabled);
        };
        const opened = async () => {
          if (way !== 'keys') return press(p, surface === '⋯' ? '#reader-menu' : '#plus-button');
          const target = surface === '⋯' ? 'reader-menu' : 'plus-button';
          for (let n = 0; n < 12 && await active(p) !== target; n++) await tab(p, surface === '⋯');
          assert.equal(await active(p), target, `${target} by the keys`);
          await p.keyboard.press('Enter');
        };
        if (way === ways[0]) {
          // Nothing chosen: nothing to quote is offered.
          await opened();
          assert.equal(await offered(), false, `with nothing chosen the ${surface} offers no Quote selection`);
          await p.keyboard.press('Escape');
          await until(p, () => !document.querySelector('[role=menu]') && document.querySelector('#plus-panel').hidden, 'put away');
          await p.locator('#source-body').focus();
        }
        const span = p.locator('#source-body > span').nth(3), box = await span.boundingBox();
        let words;
        if (way === 'drag') {
          // A passage's box changes with line wrapping and reserved scrollbars.
          // Measure actual characters, then select between them with the native mouse.
          const points = await span.evaluate(el => {
            const node = el.firstChild;
            if (node?.nodeType !== Node.TEXT_NODE || node.length <= 25) return null;
            const point = offset => {
              const range = document.createRange(); range.setStart(node, offset); range.setEnd(node, offset + 1);
              const r = range.getBoundingClientRect(); return r.width > 0 && r.height > 0 && { x: r.x + r.width / 2, y: r.y + r.height / 2 };
            };
            return { start: point(8), end: point(25) };
          });
          assert.ok(points?.start && points.end, 'two rendered text characters for the native drag');
          await p.mouse.move(points.start.x, points.start.y); await p.mouse.down(); await p.mouse.move(points.end.x, points.end.y, { steps: 5 }); await p.mouse.up();
          words = await p.evaluate(() => getSelection().toString());
        } else if (way === 'press') {
          await p.mouse.click(box.x + 5, box.y + 5);
          words = await p.evaluate(() => document.querySelector('#source-body .hover-quote').textContent);
        } else if (way === 'select') {
          words = await p.evaluate(() => { const text = document.querySelector('#source-body > span:nth-child(4)').firstChild, range = document.createRange(); range.setStart(text, 2); range.setEnd(text, 14); getSelection().removeAllRanges(); getSelection().addRange(range); return range.toString(); });
          await until(p, () => !document.querySelector('#quote-selection').hidden, 'the quote pill');
        } else {
          await p.keyboard.press('ControlOrMeta+A');
          words = await p.evaluate(() => getSelection().toString().split(/(?<=\.)\s/)[0]);
        }
        assert.ok(words.trim().length > 4, `words chosen by ${way}: ${JSON.stringify(words)}`);
        await opened();
        assert.equal(await offered(), true, `after a ${way}, the ${surface} offers Quote selection`);
        if (way === 'press' && surface === '⋯') {
          // Put away unused, the light has gone: opened again it offers nothing to quote.
          await p.keyboard.press('Escape');
          await until(p, () => !document.querySelector('[role=menu]') && document.activeElement?.id === 'reader-menu', 'the menu closed back to ⋯');
          await p.keyboard.press('Enter');
          assert.equal(await offered(), false, 'what was lit before the menu was put away is not offered again');
          await p.keyboard.press('Escape');
          await until(p, () => !document.querySelector('[role=menu]'), 'the menu closed');
          await p.mouse.click(box.x + 5, box.y + 5);
          await opened();
          assert.equal(await offered(), true, 'lit again, Quote selection is offered again');
        }
        if (surface === '⋯') {
          if (way === 'keys') {
            for (let n = 0; n < 8 && await active(p) !== 'Quote selection'; n++) await p.keyboard.press('ArrowDown');
            await p.keyboard.press('Enter');
          } else await press(p, '[role=menu] [role=menuitem]:text-is("Quote selection")');
        } else if (way === 'keys') {
          for (let n = 0; n < 8 && await active(p) !== 'plus-quote'; n++) await tab(p);
          assert.equal(await active(p), 'plus-quote', 'Quote selection by the keys');
          await p.keyboard.press('Enter');
        } else await press(p, '#plus-quote');
        await until(p, w => document.querySelector('#writing-body').value.startsWith('> ') && document.querySelector('#writing-body').value.includes(w),
          `the words quoted into the reply after a ${way}`, words.trim()).catch(async error => {
          assert.fail(`${error.message}: ${JSON.stringify(await p.evaluate(() => ({ value: document.querySelector('#writing-body').value, active: document.activeElement?.id })))}`);
        });
        await shot(p, `quoted-by-${surface === '⋯' ? 'menu' : 'plus'}-${way}`);
        await close(p);
      }
    });

    await check(`${shape}: a reply whose sending is in doubt shows a Review chip on its line, named whole for a screen reader`, async () => {
      const p = await page(shape);
      await open(p, second);
      await type(p, 'Sent in doubt.');
      // The reply is sent and its preparation comes back unanswered: whether
      // it will go is not known. (While it is still on its way it is not in
      // doubt, docs/replies-in-doubt.md.) It is answered before it reaches the
      // server, so the server never holds it and no other case meets it.
      await p.route('**/api/command', route => route.request().postDataJSON()?.kind === 'submission.prepare'
        ? route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: { code: 'UNAVAILABLE', message: 'Try again', retryable: true } }) })
        : route.continue());
      await press(p, '#send-reply');
      await until(p, () => Boolean(document.querySelector('#pending-submissions button')?.getClientRects().length), 'the Review chip', undefined, 15000);
      const chip = p.locator('#reader-composer').getByRole('button', { name: '1 reply may not have sent. Review', exact: true });
      const where = await p.evaluate(() => [...document.querySelectorAll('#reader-composer .review-chips button')].map(b => `${b.textContent} (${b.getAttribute('aria-label')})`));
      assert.equal(await chip.count(), 1, `the chip's name says what it is about and what a press does: ${where.join('; ')}`);
      assert.equal(await chip.textContent(), 'Review 1 reply', 'its words stay short');
      await shot(p, 'review-chip');
      await close(p);
    });

    await check(`${shape}: an image that needs a choice is named where Saved sits and dims Send; pressing Send says why and opens that image's choices`, async () => {
      const p = await page(shape);
      await open(p, second);
      await type(p, 'Here is the photo.');
      await press(p, '#plus-button');
      await until(p, () => !document.querySelector('#plus-panel').hidden, 'the + panel');
      const chooser = p.waitForEvent('filechooser');
      await press(p, '#add-image');
      await (await chooser).setFiles({ name: 'IMG_3307.heic', mimeType: 'image/heic', buffer: Buffer.from('not an image the browser can read') });
      assert.equal(await p.evaluate(() => document.querySelector('#plus-panel').hidden), true, 'the tile did its one thing and put + away');
      // The server takes no such image, so it waits on a choice: Attach as download, or Remove.
      await until(p, () => document.querySelector('#writing-attachments .image-choice')?.hasAttribute('data-needs'), 'the image marked as needing a choice', undefined, 20000)
        .catch(async error => { throw Error(`${error.message}: ${await p.evaluate(() => document.querySelector('#writing-attachments').innerHTML)} / ${await p.evaluate(() => document.querySelector('#save-state').textContent)}`); });
      assert.equal(await p.evaluate(() => document.querySelector('#save-state').textContent), 'Finish IMG_3307.heic first', 'the blocked image named where Saved sits');
      const state = await p.evaluate(() => ({ disabled: document.querySelector('#send-reply').disabled, dim: document.querySelector('#send-reply').getAttribute('aria-disabled'),
        marked: document.querySelector('#writing-attachments .image-choice')?.hasAttribute('data-needs'), strip: document.querySelector('#writing-attachments').getBoundingClientRect().bottom <= document.querySelector('.field-box').getBoundingClientRect().top + 1 }));
      assert.deepEqual(state, { disabled: false, dim: 'true', marked: true, strip: true }, 'Send dimmed, not disabled; the image marked, in the strip above the field');
      await shot(p, 'blocked');
      await press(p, '#send-reply', true);
      await until(p, () => !document.querySelector('#reader-notice').hidden, 'the notice');
      const after = await p.evaluate(() => ({ notice: document.querySelector('#reader-notice').textContent, open: document.querySelector('#writing-attachments .image-choice')?.hasAttribute('data-open'),
        focus: document.activeElement?.className, writing: document.querySelector('#writing-body').value }));
      assert.deepEqual(after, { notice: 'Finish or remove the image IMG_3307.heic before sending.', open: true, focus: 'image-open', writing: 'Here is the photo.' });
      assert.equal(await noticeOver(p), 0, 'the notice sits clear of the message');
      await shot(p, 'blocked-pressed');
      // Writing on is the next thing the person does: the notice has said its piece.
      await press(p, '#writing-body');
      await p.keyboard.insertText(' More.');
      assert.equal(await noticeWords(p), '', 'writing on clears the notice');
      await close(p);
    });

    await check(`${shape}: a reply begun on one message is kept when the Reader moves to another, says so, and is there on coming back`, async () => {
      const p = await page(shape);
      await open(p, second);
      await type(p, 'Kept across messages.');
      // Both agent messages answer the fixture's first message (its default
      // source), so they read in that message's reply stack, oldest first: the
      // older one is above, ↑ (docs/reply-stacks.md), and ↓ comes back.
      const older = shape === 'phone' ? '.reader-end .end-step:first-child' : '#next-message';
      if (shape === 'phone') await p.locator('.reader-end').scrollIntoViewIfNeeded();
      await press(p, older);
      await until(p, () => !document.querySelector('#source-body').textContent.startsWith('Second agent'), 'the older message');
      const moved = await p.evaluate(() => ({ notice: document.querySelector('#reader-notice').hidden ? '' : document.querySelector('#reader-notice').textContent, field: document.querySelector('#writing-body').value, state: document.querySelector('#reader-composer').dataset.compose }));
      assert.deepEqual(moved, { notice: 'Your reply to the last one is kept.', field: '', state: 'line' });
      assert.equal(await noticeOver(p), 0, 'the notice sits clear of the message');
      if (shape === 'phone') {
        // At the message's end the notice leaves ↑ Previous · ↓ Next to be read and pressed.
        await p.evaluate(() => { const body = document.querySelector('#source-body'); body.scrollTop = body.scrollHeight; });
        const covered = await p.evaluate(() => { const end = document.querySelector('.reader-end').getBoundingClientRect(); return [...document.querySelectorAll('.reader-end .end-step')].map(b => { const r = b.getBoundingClientRect(); return document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)?.closest('.end-step') === b; }).concat(end.bottom <= document.querySelector('#reader-composer').getBoundingClientRect().top + 1); });
        assert.deepEqual(covered, [true, true, true], 'the end line shows whole above the reply');
      }
      await shot(p, 'kept');
      // Starting to write here: the notice has said its piece and goes.
      await type(p, 'A reply here.');
      assert.equal(await noticeWords(p), '', 'writing clears the kept notice');
      await p.locator('#writing-body').fill('');
      await press(p, '#previous-message');
      await until(p, () => document.querySelector('#source-body').textContent.startsWith('Second agent'), 'back on the message');
      assert.equal(await p.evaluate(() => document.querySelector('#writing-body').value), 'Kept across messages.');
      await close(p);
    });

    await check(`${shape}: a reply sent to the outcome's conversation says so on the who chip and above the field, and choosing In keeps the composer, its panel and the focus where they were`, async () => {
      const p = await page(shape);
      await open(p, second);
      await type(p, 'To the conversation.');
      await press(p, '#who-chip');
      await until(p, () => !document.querySelector('#who-panel').hidden, 'the who panel');
      assert.equal(await p.evaluate(() => document.querySelectorAll('#reply-destination button[data-destination]').length), 2, 'In offers This topic and Conversation');
      // A Tell, as a reply starts (docs/whispers.md); a whisper is between the two of you wherever it is posted.
      await press(p, '#who-panel [data-intent="tell"]');
      await until(p, () => document.querySelector('#who-chip').textContent.startsWith('Tell '), 'a Tell');
      // Every input: a finger's tap on the phone, the keyboard alone on a laptop.
      const other = '#reply-destination button[data-destination]:not([aria-pressed="true"])';
      const value = await p.evaluate(s => document.querySelector(s).dataset.destination, other);
      // Safari gives a tapped button no focus, so a tap leaves it where it was; Chrome gives it the chip.
      const before = await p.evaluate(() => document.activeElement?.id);
      if (p.touch) await press(p, other); else { await p.locator(other).focus(); await p.keyboard.press('Enter'); }
      await until(p, ([v, words]) => document.querySelector(`#reply-destination [data-destination="${v}"]`)?.getAttribute('aria-pressed') === 'true' && document.querySelector('#writing-body').value === words,
        'the writing moved to the conversation', [value, 'To the conversation.'], 15000);
      await p.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      const read = () => p.evaluate(() => ({ compose: document.querySelector('#reader-composer').dataset.compose, panel: !document.querySelector('#who-panel').hidden,
        focus: document.activeElement?.dataset.destination ?? document.activeElement?.id, chip: document.querySelector('#who-chip').textContent,
        who: document.querySelector('#who-panel .audience-line strong')?.textContent ?? '', field: document.querySelector('#writing-body').placeholder,
        note: (n => n && n.getClientRects().length && !n.closest('#who-panel') ? n.textContent : '')(document.querySelector('#destination-note')) }));
      let now = await read();
      const kept = now.focus === value || (engine === 'webkit' && p.touch && now.focus === before);
      assert.deepEqual({ ...now, focus: kept ? value : now.focus, note: now.note.endsWith('nobody in this topic is woken.') },
        { compose: 'writing', panel: true, focus: value, chip: `Tell ${agent} · in the conversation`, who: 'Everyone in the conversation', field: `Reply to ${agent} in the conversation…`, note: true },
        'choosing In keeps the panel open and the focus on the choice, and the chip says where it goes');
      await shot(p, 'conversation-panel');
      await press(p, '#who-done');
      await until(p, () => document.querySelector('#who-panel').hidden && document.activeElement?.id === 'writing-body', 'Done back to the writing');
      if (p.shape === 'phone') await keyboardUp(p);
      now = await read();
      assert.ok(now.note.endsWith('nobody in this topic is woken.'), `above the field, outside the panel, where it goes and that nobody here is woken: ${JSON.stringify(now)}`);
      assert.equal(now.chip, `Tell ${agent} · in the conversation`);
      await shot(p, 'conversation-writing');
      if (p.shape === 'phone') await keyboardDown(p);
      // Back to this topic: the chip says everyone here, and the note goes.
      await press(p, '#who-chip');
      await until(p, () => !document.querySelector('#who-panel').hidden, 'the who panel again');
      const here = '#reply-destination button[data-destination]:not([aria-pressed="true"])';
      const back = await p.evaluate(s => document.querySelector(s).dataset.destination, here);
      await press(p, here);
      await until(p, ([v, words]) => document.querySelector(`#reply-destination [data-destination="${v}"]`)?.getAttribute('aria-pressed') === 'true' && document.querySelector('#writing-body').value === words,
        'the writing back in this topic', [back, 'To the conversation.'], 15000);
      now = await read();
      assert.deepEqual([now.chip.endsWith('· everyone here'), now.field, now.note, now.panel], [true, `Reply to ${agent}…`, '', true], JSON.stringify(now));
      await close(p);
    });

    // 👍 and Send's dimming read one rule, whether anything is written: who the
    // reply goes to, how it asks and where it is posted are not writing, so no
    // way a name or a choice reaches an empty reply hides 👍.
    const THUMB = 'with nothing written 👍 stands beside the dimmed Send';
    const unwritten = async (p, why) => {
      const now = await p.evaluate(() => ({ words: document.querySelector('#writing-body').value, writing: document.querySelector('#reader-composer').hasAttribute('data-has-writing'),
        thumb: document.querySelector('#thumb-source').getClientRects().length > 0, dim: document.querySelector('#send-reply').disabled }));
      assert.deepEqual(now, { words: '', writing: false, thumb: true, dim: true }, `${why}: ${JSON.stringify(now)}`);
    };
    const inConversation = p => p.evaluate(() => document.querySelector('#writing-body').placeholder.endsWith(' in the conversation…'));
    const whoPanel = async p => { await press(p, '#who-chip'); await until(p, () => !document.querySelector('#who-panel').hidden, 'the who panel'); };
    const whoDone = async p => { await press(p, '#who-done'); await until(p, () => document.querySelector('#who-panel').hidden, 'Done closes the who panel'); };
    const toConversation = async (p, words) => {
      const other = '#reply-destination button[data-destination]:not([aria-pressed="true"])';
      const value = await p.evaluate(s => document.querySelector(s).dataset.destination, other);
      await press(p, other);
      await until(p, ([v, w]) => document.querySelector(`#reply-destination [data-destination="${v}"]`)?.getAttribute('aria-pressed') === 'true' && document.querySelector('#writing-body').value === w,
        'the reply in the conversation', [value, words], 15000);
    };
    const writingEmpty = async p => {
      await press(p, '#writing-body');
      await until(p, () => document.querySelector('#reader-composer').dataset.compose === 'writing' && document.activeElement?.id === 'writing-body', 'the composer');
    };

    await check(`${shape}: ${THUMB} after words typed, moved to the outcome's conversation and taken back with Backspace, and on a new page there`, async () => {
      const p = await page(shape);
      await open(p, second);
      await type(p, 'Hi');
      await whoPanel(p); await toConversation(p, 'Hi'); await whoDone(p);
      await writingEmpty(p);
      await p.keyboard.press('Backspace'); await p.keyboard.press('Backspace');
      await until(p, () => document.querySelector('#writing-body').value === '', 'Backspace takes the words back');
      await unwritten(p, 'moved to the conversation and emptied');
      assert.equal(await inConversation(p), true, 'the reply still goes to the conversation');
      await until(p, () => document.querySelector('#save-state').textContent.startsWith('Saved to'), 'the emptied reply is saved');
      await close(p);
      // The emptied reply in the conversation, as Theseus keeps it, read by a new page.
      const q = await page(shape);
      await open(q, second);
      await writingEmpty(q);
      if (!await inConversation(q)) { await whoPanel(q); await toConversation(q, ''); await whoDone(q); }
      assert.equal(await inConversation(q), true, 'the reply goes to the conversation');
      await unwritten(q, 'on a new page, the emptied reply in the conversation');
      await close(q);
    });

    await check(`${shape}: ${THUMB} with Ask chosen first, then In: Conversation`, async () => {
      const p = await page(shape);
      await open(p, second);
      await writingEmpty(p);
      await whoPanel(p);
      await press(p, '#who-panel [data-intent="ask"]');
      await until(p, () => document.querySelector('#who-chip').textContent.startsWith('Ask '), 'an Ask');
      await unwritten(p, 'Ask chosen, nothing written');
      await toConversation(p, '');
      await whoDone(p);
      assert.deepEqual([await p.evaluate(() => document.querySelector('#who-chip').textContent.startsWith('Ask ')), await inConversation(p)], [true, true], 'an Ask, to the conversation');
      await unwritten(p, 'Ask, then In: Conversation, nothing written');
      await close(p);
    });

    await check(`${shape}: ${THUMB} with someone named`, async () => {
      const p = await page(shape);
      await open(p, second);
      await writingEmpty(p);
      await whoPanel(p);
      if (p.touch) {
        await press(p, '#recipient-open');
        await until(p, () => document.querySelector('#recipient-sheet')?.open && document.activeElement?.id === 'recipient-input', 'the naming sheet');
        await p.keyboard.insertText('warp');
        await press(p, '#recipient-done');
        await until(p, () => !document.querySelector('#recipient-sheet').open && !document.querySelector('#who-panel').hidden, 'back to the who panel');
      } else {
        await p.locator('#recipient-input').focus();
        await p.keyboard.insertText('warp');
      }
      await whoDone(p);
      assert.ok((await namedIn(p, NAMING.Reader)).includes('warp'), 'warp is named');
      await unwritten(p, 'someone named, nothing written');
      await close(p);
    });

    await check(`${shape}: Escape and presses outside put a panel or the Reader away and keep the writing`, async () => {
      const p = await page(shape);
      await open(p, second);
      await type(p, 'Kept through Escape.');
      await press(p, '#who-chip');
      await until(p, () => !document.querySelector('#who-panel').hidden, 'the who panel');
      await p.keyboard.press('Escape');
      await until(p, () => document.querySelector('#who-panel').hidden && document.activeElement?.id === 'who-chip', 'Escape closes the panel back to its chip');
      assert.equal(await p.evaluate(() => document.querySelector('#reader').open), true, 'the Reader stays open');
      await press(p, '#plus-button');
      await until(p, () => !document.querySelector('#plus-panel').hidden, 'the + panel');
      // A press on the message's words puts the panel away.
      const words = await p.locator('#source-body').boundingBox();
      if (p.touch) await p.touchscreen.tap(words.x + 40, words.y + 40); else await p.mouse.click(words.x + 40, words.y + 40);
      await until(p, () => document.querySelector('#plus-panel').hidden, 'an outside press closes the panel');
      if (shape === 'phone') await until(p, () => document.querySelector('#reader-composer').dataset.compose === 'line' && !document.querySelector('#draft-tag').hidden, 'a tap on the message folds the reply to its line, saying Draft');
      assert.equal(await p.evaluate(() => document.querySelector('#writing-body').value), 'Kept through Escape.');
      // The press lit a passage; the first Escape lets the light go, the next closes the Reader.
      await p.keyboard.press('Escape');
      if (await p.evaluate(() => document.querySelector('#reader').open)) {
        assert.equal(await p.evaluate(() => document.querySelectorAll('#source-body .hover-quote').length), 0, 'Escape let the light go first');
        await p.keyboard.press('Escape');
      }
      await until(p, () => !document.querySelector('#reader').open, 'Escape closes the Reader');
      await open(p, second);
      assert.equal(await p.evaluate(() => document.querySelector('#writing-body').value), 'Kept through Escape.', 'the writing is there on reopening');
      await close(p);
    });
  }

  // Quoting keeps your place (docs/reader.md): words selected in a passage in
  // the middle of what shows, quoted by Return (and on a phone by the ❝ pill
  // too), leave that passage where it was on screen, and the topic page behind
  // the Reader where it was; the quote lands at the end of the reply as it
  // always has, with the cursor after it and the field showing it. Return with
  // nothing chosen does what it did: nothing on the message, a new line in the
  // writing. Words the opening reply would cover are the one thing that
  // moves: the least that shows them just above the reply.
  for (const shape of ['phone', 'stacked', 'wide']) await check(`${shape}: quoting keeps your place: the quoted passage stays where it was on screen, the topic page behind it too, the quote lands after the writing with the cursor after it, and Return with nothing chosen quotes nothing`, async () => {
    const p = await page(shape);
    await open(p, second);
    const settled = () => p.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    // Where things are: a passage's top and bottom on screen, the message's
    // room, the topic page behind the Reader, and the writing.
    const place = n => p.evaluate(n => {
      const body = document.querySelector('#source-body'), part = body.children[n], field = document.querySelector('#writing-body');
      const style = getComputedStyle(body), box = body.getBoundingClientRect(), shown = part.getBoundingClientRect();
      const wide = document.querySelector('#reader').dataset.layout === 'wide';
      const bottom = Math.min(box.bottom - parseFloat(style.paddingBottom), wide ? Infinity : document.querySelector('#reader-composer').getBoundingClientRect().top);
      const card = document.querySelector('#messages .message-card');
      return { top: shown.top, bottom: shown.bottom, room: bottom, lineHeight: parseFloat(style.lineHeight),
        page: { scrollY: window.scrollY, card: card.getBoundingClientRect().top, cards: [...document.querySelectorAll('#messages .message-card')].map(c => c.scrollTop) },
        value: field.value, start: field.selectionStart, end: field.selectionEnd, active: document.activeElement?.id,
        fieldScroll: field.scrollTop, fieldEnd: field.scrollHeight - field.clientHeight };
    }, n);
    // Passage n's top a third of the way down the message's room.
    const middle = async n => {
      await p.evaluate(n => { const body = document.querySelector('#source-body'), box = body.getBoundingClientRect(); body.scrollTop += body.children[n].getBoundingClientRect().top - (box.top + body.clientHeight / 3); }, n);
      await settled();
    };
    // Words in passage n chosen as the shape chooses them: a mouse's drag on a
    // laptop, words selected on a phone (the harness has no finger's long-press).
    const choose = async n => {
      if (p.touch) {
        const words = await p.evaluate(n => { const text = document.querySelector('#source-body').children[n].firstChild, range = document.createRange(); range.setStart(text, 2); range.setEnd(text, 20); getSelection().removeAllRanges(); getSelection().addRange(range); return range.toString(); }, n);
        await until(p, () => !document.querySelector('#quote-selection').hidden, 'the quote pill');
        return words;
      }
      const box = await p.locator(`#source-body > :nth-child(${n + 1})`).boundingBox();
      await p.mouse.move(box.x + 4, box.y + 6); await p.mouse.down(); await p.mouse.move(box.x + 150, box.y + 8, { steps: 6 }); await p.mouse.up();
      return p.evaluate(() => getSelection().toString());
    };
    const quoted = async (how, words, before) => {
      if (how === 'pill') await press(p, '#quote-selection'); else await p.keyboard.press('Enter');
      await until(p, ([w, v]) => document.querySelector('#writing-body').value !== v && document.querySelector('#writing-body').value.includes(w) &&
        document.getAnimations().filter(x => x.effect?.getTiming().iterations !== Infinity).every(a => a.playState !== 'running'), `the words quoted by ${how}`, [words.trim(), before.value]);
      await settled();
    };
    // What a quote adds, exactly as it always has: a blank line after what is
    // written, each line after "> ", and a blank line to write on.
    const addition = (body, words) => (body ? (body.endsWith('\n\n') ? '' : body.endsWith('\n') ? '\n' : '\n\n') : '') + words.split('\n').map(line => `> ${line}`).join('\n') + '\n\n';
    const kept = (before, after, what) => {
      assert.ok(Math.abs(after.top - before.top) <= 2, `${what}: the quoted passage stays where it was on screen (its top at ${Math.round(before.top)}px, then ${Math.round(after.top)}px)`);
      assert.deepEqual(after.page, before.page, `${what}: the topic page behind the Reader stays where it was`);
      assert.equal(after.active, 'writing-body', `${what}: the cursor is in the reply`);
      assert.deepEqual([after.start, after.end], [after.value.length, after.value.length], `${what}: the cursor sits after the quote`);
      assert.ok(Math.abs(after.fieldScroll - after.fieldEnd) <= 1, `${what}: the reply shows the cursor (${after.fieldScroll} of ${after.fieldEnd})`);
    };

    // Reading, the reply its one line: Return quotes words chosen mid-message.
    await middle(20);
    const words = await choose(20), before = await place(20);
    assert.ok(words.trim().length > 4, `words chosen: ${JSON.stringify(words)}`);
    await quoted('Return', words, before);
    const after = await place(20);
    assert.equal(after.value, addition('', words), 'the quote lands in the reply as it always has');
    kept(before, after, 'quoted by Return while reading');
    await shot(p, 'quote-keeps-place');

    // Writing, the reply open with words in it: another passage's words,
    // quoted by Return (on a phone by the pill as well), land after them.
    await p.keyboard.insertText('My thoughts so far.');
    for (const how of p.touch ? ['Return', 'pill'] : ['Return']) {
      const n = how === 'pill' ? 16 : 18;
      await middle(n);
      const more = await choose(n);
      // Return quotes from the message: a phone's selection leaves the focus in the writing.
      if (how === 'Return') await p.evaluate(() => document.querySelector('#source-body').focus({ preventScroll: true }));
      const was = await place(n);
      await quoted(how, more, was);
      const now = await place(n);
      assert.equal(now.value, was.value + addition(was.value, more), `quoted by ${how} while writing: the quote lands after the writing`);
      kept(was, now, `quoted by ${how} while writing`);
    }

    // Return with nothing chosen quotes nothing and moves nothing: on the
    // message it does nothing, in the writing it is a new line.
    if (!p.touch) await p.mouse.move(5, 5);
    await p.evaluate(() => { getSelection().removeAllRanges(); document.querySelector('#source-body').focus({ preventScroll: true }); });
    await settled();
    assert.equal(await p.evaluate(() => document.querySelectorAll('#source-body .hover-quote').length + getSelection().toString().length), 0, 'nothing chosen on the message');
    const still = await place(16);
    await p.keyboard.press('Enter');
    await settled();
    const unmoved = await place(16);
    assert.deepEqual([unmoved.value, Math.round(unmoved.top), unmoved.page], [still.value, Math.round(still.top), still.page], 'Return on the message with nothing chosen quotes nothing and moves nothing');
    await p.evaluate(() => { const f = document.querySelector('#writing-body'); f.focus({ preventScroll: true }); f.setSelectionRange(f.value.length, f.value.length); });
    await p.keyboard.press('Enter');
    await settled();
    const line = await place(16);
    assert.deepEqual([line.value, Math.round(line.top), line.page], [still.value + '\n', Math.round(still.top), still.page], 'Return in the writing with nothing chosen is a new line, and moves nothing');
    await close(p);

    // Where the reply would cover the words as it opens, the message moves
    // the least that shows them just above the reply. Side by side nothing covers them.
    if (shape === 'wide') return;
    const q = await page(shape);
    await open(q, second);
    // The words are the first passage's that end below where the reply opens,
    // brought to end just above it: which passage that is depends on how wide
    // the Reader sets the message, so it is found, not named, and placed exactly.
    const set = await q.evaluate(() => {
      const body = document.querySelector('#source-body'), box = body.getBoundingClientRect(), style = getComputedStyle(body);
      const end = () => Math.min(box.bottom - parseFloat(style.paddingBottom), document.querySelector('#reader-composer').getBoundingClientRect().top) - 4;
      const words = part => { const range = document.createRange(); range.setStart(part.firstChild, 2); range.setEnd(part.firstChild, 20); return range; };
      const at = [...body.children].findIndex(part => part.firstChild?.nodeType === Node.TEXT_NODE && part.firstChild.length >= 20 && words(part).getBoundingClientRect().bottom > end());
      if (at < 0) return { at };
      const range = words(body.children[at]);
      body.scrollTop += range.getBoundingClientRect().bottom - end();
      getSelection().removeAllRanges(); getSelection().addRange(range); body.focus({ preventScroll: true });
      return { at, off: Math.round(range.getBoundingClientRect().bottom - end()), scrolled: body.scrollTop };
    });
    assert.ok(set.at >= 0 && Math.abs(set.off) <= 1, `words placed to end just above where the reply opens: ${JSON.stringify(set)}`);
    await q.keyboard.press('Enter');
    await until(q, () => document.querySelector('#writing-body').value.startsWith('> ') && document.getAnimations().filter(x => x.effect?.getTiming().iterations !== Infinity).every(a => a.playState !== 'running'), 'the words quoted');
    await q.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const covered = await q.evaluate(at => {
      const body = document.querySelector('#source-body'), style = getComputedStyle(body), box = body.getBoundingClientRect();
      const bottom = Math.min(box.bottom - parseFloat(style.paddingBottom), document.querySelector('#reader-composer').getBoundingClientRect().top);
      const words = document.createRange(); words.setStart(body.children[at].firstChild, 2); words.setEnd(body.children[at].firstChild, 20);
      return { gap: Math.round(bottom - words.getBoundingClientRect().bottom), lineHeight: parseFloat(style.lineHeight), scrolled: body.scrollTop };
    }, set.at);
    assert.ok(covered.scrolled > set.scrolled, `the reply came to cover the words, and the message moved (${set.scrolled} to ${covered.scrolled})`);
    assert.ok(covered.gap >= -2 && covered.gap <= covered.lineHeight, `words the reply would cover are shown just above it (${covered.gap}px above it)`);
    await close(q);
  });

  // A passage taller than what shows (docs/reader.md): a code block is one
  // passage, and agents send long logs. A quote keeps showing what showed of
  // the words it takes, moved only as far as the reply or the keyboard comes
  // to cover them, the least that shows them just above it, or as much of them
  // as the room holds: words taller than the room once the reply opens; a line
  // near the log's end with the log's top above the screen; a line in the log
  // running past both edges (on a phone the keyboard then comes up); the log
  // lit whole by a press. Words quoted from above what shows come into sight
  // the least way: a line at the top, words taller than the room with their
  // end at the bottom.
  for (const shape of ['phone', 'stacked', 'wide']) await check(`${shape}: quoting from a passage taller than what shows keeps the words quoted where they were, and words quoted from above what shows come into sight the least way`, async () => {
    const p = await page(shape, 'light', '/?topic=compose-log');
    await open(p, log, 'The build log');
    const settled = () => p.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    // The message's room (above the reply where it covers the message), and
    // where lines k to `to` of the log, and the log itself, are on screen.
    const where = (k, to = k) => p.evaluate(([k, to]) => {
      const body = document.querySelector('#source-body'), style = getComputedStyle(body), box = body.getBoundingClientRect();
      const wide = document.querySelector('#reader').dataset.layout === 'wide';
      const room = { top: box.top + parseFloat(style.paddingTop), bottom: Math.min(box.bottom - parseFloat(style.paddingBottom), wide ? Infinity : document.querySelector('#reader-composer').getBoundingClientRect().top) };
      const block = [...body.children].find(part => part.textContent.includes('step 1: '));
      const at = n => { const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT), words = `step ${n}: compiled`; let node; while ((node = walker.nextNode()) && !node.data.includes(words)); return [node, node.data.indexOf(words), words.length]; };
      const [first, from] = at(k), [last, end, length] = at(to), range = document.createRange(); range.setStart(first, from); range.setEnd(last, end + length);
      const line = range.getBoundingClientRect(), whole = block.getBoundingClientRect();
      return { room, line: { top: line.top, bottom: line.bottom, left: line.left, right: line.right }, log: { top: whole.top, bottom: whole.bottom }, value: document.querySelector('#writing-body').value };
    }, [k, to]);
    // Line k a fraction f of the way down the message's room.
    const put = async (k, f) => {
      const at = await where(k);
      await p.evaluate(dy => { document.querySelector('#source-body').scrollTop += dy; }, at.line.top - (at.room.top + f * (at.room.bottom - at.room.top)));
      await settled();
    };
    // The words of lines k to `to` chosen as the shape chooses them: a mouse's
    // drag on a laptop, words selected on a phone (the harness has no finger's
    // long-press); and words running past what shows, selected on any shape.
    const choose = async (k, to = k, drag = !p.touch) => {
      if (drag) {
        const from = await where(k), till = await where(to);
        await p.mouse.move(from.line.left + 2, (from.line.top + from.line.bottom) / 2); await p.mouse.down();
        await p.mouse.move(till.line.right - 2, (till.line.top + till.line.bottom) / 2, { steps: 6 }); await p.mouse.up();
      } else {
        await p.evaluate(([k, to]) => {
          const block = [...document.querySelector('#source-body').children].find(part => part.textContent.includes('step 1: '));
          const at = n => { const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT), words = `step ${n}: compiled`; let node; while ((node = walker.nextNode()) && !node.data.includes(words)); return [node, node.data.indexOf(words), words.length]; };
          const [first, from] = at(k), [last, end, length] = at(to), range = document.createRange(); range.setStart(first, from); range.setEnd(last, end + length);
          getSelection().removeAllRanges(); getSelection().addRange(range);
          // Return quotes from the message.
          document.querySelector('#source-body').focus({ preventScroll: true });
        }, [k, to]);
        if (p.touch) await until(p, () => !document.querySelector('#quote-selection').hidden, 'the quote pill');
      }
      const words = await p.evaluate(() => getSelection().toString());
      assert.ok(words.includes(`step ${k}: compiled`) && words.includes(`step ${to}: compiled`), `the words of lines ${k} to ${to} chosen: ${JSON.stringify(words.slice(0, 80))}`);
    };
    // Quoted as the shape quotes: by the ❝ pill on a phone, Return on a laptop.
    const quoted = async (words, before) => {
      if (p.touch) await press(p, '#quote-selection'); else await p.keyboard.press('Enter');
      await until(p, ([w, v]) => document.querySelector('#writing-body').value !== v && document.querySelector('#writing-body').value.includes(w) &&
        document.getAnimations().filter(x => x.effect?.getTiming().iterations !== Infinity).every(a => a.playState !== 'running'), `the words quoted: ${words}`, [words, before.value]);
      await settled();
    };
    // What showed of the quoted words (was, before the quote) shows still
    // (now): it moved only as far as the reply or keyboard came to cover it,
    // the least that shows it just above them, or that fills the room with it.
    const kept = (before, after, was, now, what) => {
      const top = Math.max(was.top, before.room.top), bottom = Math.min(was.bottom, before.room.bottom);
      const covered = bottom - after.room.bottom, least = covered > 0 ? Math.min(covered, top - after.room.top) : 0;
      assert.ok(Math.abs(was.top - now.top - least) <= 2, `${what}: the quoted words moved ${Math.round(was.top - now.top)}px up, and the least that shows what showed of them is ${Math.round(least)}px (top ${Math.round(was.top)}px, then ${Math.round(now.top)}px; the room ${Math.round(after.room.top)}–${Math.round(after.room.bottom)}px)`);
      assert.ok(now.top < after.room.bottom && now.bottom > after.room.top, `${what}: still on the screen`);
    };
    // How many of the log's lines from line k the room holds.
    const lines = async k => { const at = await where(k), next = await where(k + 1); return Math.floor((at.room.bottom - at.room.top) / (next.line.top - at.line.top)); };

    // Words from near the room's top to near its bottom, quoted as the reply
    // opens (on a phone, then the keyboard comes up): taller than the room
    // that is left, they fill it, their start kept on the screen.
    await put(4, 0.05);
    const span = 4 + Math.floor(await lines(4) * 0.85);
    await choose(4, span);
    const tall = await where(4, span);
    assert.ok(tall.line.top > tall.room.top && tall.line.bottom < tall.room.bottom, `the words on the screen (${JSON.stringify(tall)})`);
    await quoted(`step ${span}: compiled`, tall);
    await keyboardUp(p);
    await settled();
    const tallAfter = await where(4, span);
    kept(tall, tallAfter, tall.line, tallAfter.line, 'words taller than the room the reply leaves');
    await keyboardDown(p);

    // A line near the log's end, the log's top above the screen.
    await put(66, 1 / 3);
    await choose(66);
    const nearEnd = await where(66);
    assert.ok(nearEnd.log.top < nearEnd.room.top && nearEnd.log.bottom < nearEnd.room.bottom, `the log's top above the screen, its end on it (${JSON.stringify(nearEnd)})`);
    await quoted('step 66: compiled', nearEnd);
    const nearEndAfter = await where(66);
    kept(nearEnd, nearEndAfter, nearEnd.line, nearEndAfter.line, 'a line near the end of a log whose top is above the screen');
    await shot(p, 'quote-tall-near-end');

    // A line in the log running past both edges; on a phone the keyboard
    // then comes up, as the pill puts the cursor in the reply.
    await put(35, 1 / 3);
    await choose(35);
    const inside = await where(35);
    assert.ok(inside.log.top < inside.room.top && inside.log.bottom > inside.room.bottom, `the log past both edges (${JSON.stringify(inside)})`);
    await quoted('step 35: compiled', inside);
    await keyboardUp(p);
    await settled();
    const insideAfter = await where(35);
    kept(inside, insideAfter, inside.line, insideAfter.line, 'a line in a log running past both edges');
    await keyboardDown(p);

    // The log lit whole by a mouse's press, its top a third of the way down
    // and its end past what shows: it stays, but for what the reply comes to
    // cover of it.
    if (!p.touch) {
      await put(1, 1 / 3);
      const lit = await where(3);
      await p.mouse.click((lit.line.left + lit.line.right) / 2, (lit.line.top + lit.line.bottom) / 2);
      await until(p, () => document.querySelectorAll('#source-body .hover-quote').length === 1 && getSelection().isCollapsed, 'the log lit whole');
      const whole = await where(3);
      assert.ok(whole.log.top > whole.room.top && whole.log.bottom > whole.room.bottom, `the log's top on the screen, its end past it (${JSON.stringify(whole)})`);
      await quoted('step 70: compiled', whole);
      const wholeAfter = await where(3);
      kept(whole, wholeAfter, whole.log, wholeAfter.log, 'a log lit whole');
    }

    // A line quoted from above what shows comes into sight at its top: the
    // least move, not one that puts it at the bottom.
    await put(20, 1 / 3);
    await choose(20);
    const chosen = await where(20);
    await p.evaluate(dy => { document.querySelector('#source-body').scrollTop += dy; }, chosen.line.bottom - chosen.room.top + 120);
    await settled();
    const above = await where(20);
    assert.ok(above.line.bottom < above.room.top, `the chosen line above the screen (${JSON.stringify(above)})`);
    await quoted('step 20: compiled', above);
    const aboveAfter = await where(20);
    assert.ok(Math.abs(aboveAfter.line.top - aboveAfter.room.top) <= 2, `a line quoted from above what shows comes into sight at its top (its top ${Math.round(aboveAfter.line.top)}px, the room's ${Math.round(aboveAfter.room.top)}px)`);

    // Words taller than the room, quoted from above it, come into sight with
    // their end at its bottom: the least move, not one that shows their start.
    await put(2, 0.05);
    const longer = 2 + await lines(2) + 6;
    await choose(2, longer, false);
    const high = await where(2, longer);
    await p.evaluate(dy => { document.querySelector('#source-body').scrollTop += dy; }, high.line.bottom - high.room.top + 120);
    await settled();
    const higher = await where(2, longer);
    assert.ok(higher.line.bottom < higher.room.top && high.line.bottom - high.line.top > high.room.bottom - high.room.top, `the chosen words above the screen, and taller than it (${JSON.stringify(higher)})`);
    await quoted(`step ${longer}: compiled`, higher);
    const highAfter = await where(2, longer);
    assert.ok(Math.abs(highAfter.line.bottom - highAfter.room.bottom) <= 2, `words taller than the room quoted from above it come into sight with their end at its bottom (their end ${Math.round(highAfter.line.bottom)}px, the room's ${Math.round(highAfter.room.bottom)}px)`);
    await close(p);
  });

  // The words a quote keeps in sight (docs/reader.md, item 434), on a laptop,
  // stacked. Where things are: the message's room above the reply, its scroll,
  // and passage n's words (its characters 2 to 20).
  const quoteAt = async (p, n) => {
    await p.evaluate(n => { const body = document.querySelector('#source-body'), text = body.children[n].firstChild, range = document.createRange(); range.setStart(text, 2); range.setEnd(text, 20); getSelection().removeAllRanges(); getSelection().addRange(range); body.focus({ preventScroll: true }); }, n);
    const before = await p.evaluate(() => document.querySelector('#writing-body').value);
    await p.keyboard.press('Enter');
    await until(p, v => document.querySelector('#writing-body').value !== v && document.getAnimations().filter(x => x.effect?.getTiming().iterations !== Infinity).every(a => a.playState !== 'running'), 'the words quoted', before);
    await p.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  };
  const wordsAt = (p, n) => p.evaluate(n => {
    const body = document.querySelector('#source-body'), style = getComputedStyle(body), box = body.getBoundingClientRect();
    const room = { top: box.top + parseFloat(style.paddingTop), bottom: Math.min(box.bottom - parseFloat(style.paddingBottom), document.querySelector('#reader-composer').getBoundingClientRect().top) };
    const text = body.children[n].firstChild, range = document.createRange(); range.setStart(text, 2); range.setEnd(text, 20);
    const words = range.getBoundingClientRect(), field = document.querySelector('#writing-body');
    return { room, top: words.top, bottom: words.bottom, scroll: body.scrollTop, end: body.scrollHeight - body.clientHeight, lineHeight: parseFloat(style.lineHeight), field: field.getBoundingClientRect().height, lines: field.value.split('\n').length,
      body: Math.round(box.bottom - parseFloat(style.paddingBottom)), composer: Math.round(document.querySelector('#reader-composer').getBoundingClientRect().top) };
  }, n);
  // Words of a passage from below what shows, placed to end just above where
  // the reply opens, the message scrolled well down to them; its index.
  const nearReply = async p => {
    const n = await p.evaluate(() => [...document.querySelector('#source-body').children].findIndex(part => part.firstChild?.nodeType === Node.TEXT_NODE && part.getBoundingClientRect().top > document.querySelector('#reader-composer').getBoundingClientRect().top + 300));
    await p.evaluate(n => { const body = document.querySelector('#source-body'), text = body.children[n].firstChild, range = document.createRange(); range.setStart(text, 2); range.setEnd(text, 20);
      body.scrollTop += range.getBoundingClientRect().bottom - (document.querySelector('#reader-composer').getBoundingClientRect().top - 8); }, n);
    await p.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    return n;
  };
  // A line typed into the reply at its end, which grows it a line.
  const growLine = async (p, words) => {
    await p.evaluate(() => { const f = document.querySelector('#writing-body'); f.focus({ preventScroll: true }); f.setSelectionRange(f.value.length, f.value.length); });
    const was = await p.evaluate(() => document.querySelector('#writing-body').getBoundingClientRect().height);
    await p.keyboard.insertText('\n' + words);
    await until(p, h => document.querySelector('#writing-body').getBoundingClientRect().height > h, 'the reply a line taller', was);
    await p.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  };
  // The reply's last line deleted, which shrinks it a line.
  const dropLine = async p => {
    const was = await p.evaluate(() => { const f = document.querySelector('#writing-body'); f.focus({ preventScroll: true }); f.setSelectionRange(f.value.lastIndexOf('\n'), f.value.length); return f.getBoundingClientRect().height; });
    await p.keyboard.press('Backspace');
    await until(p, h => document.querySelector('#writing-body').getBoundingClientRect().height < h, 'the reply a line shorter', was);
    await p.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  };

  // One who has not scrolled keeps the words quoted in sight as the reply
  // grows; a scroll the person makes, however made, lets them go, so the
  // reply's next change of size leaves the message where they put it.
  await check('stacked: quoting: one who has not scrolled keeps the quoted words in sight as the reply grows, and a scroll the person makes, a scrollbar\'s drag among them, lets them go', async () => {
    const p = await page('stacked', 'light', '/?topic=compose-wrap');
    await open(p, wrap, 'A plan in one item');
    const n = await nearReply(p);
    await quoteAt(p, n);
    const quoted = await wordsAt(p, n);
    assert.ok(quoted.bottom <= quoted.room.bottom + 2 && quoted.top >= quoted.room.top - 2, `quoted, the words show above the reply (${JSON.stringify(quoted)})`);
    await growLine(p, 'A second thought.');
    const held = await wordsAt(p, n);
    assert.ok(held.bottom <= held.room.bottom + 2 && held.top >= held.room.top - 2, `not scrolled, the quoted words stay in sight above the reply as it grows (words ${Math.round(held.top)}–${Math.round(held.bottom)}px, the room ${Math.round(held.room.top)}–${Math.round(held.room.bottom)}px; quoted ${JSON.stringify(quoted)}, then ${JSON.stringify(held)})`);
    await shot(p, 'quote-held-while-typing');
    // The words scrolled below what shows: by a drag of the message's
    // scrollbar where it has one. Safari's engine draws an overlay scrollbar
    // a headless pointer cannot hold; there the message is scrolled from
    // outside the page's code, as a scrollbar's drag scrolls it.
    const lift = held.room.bottom - held.top + 2 * held.lineHeight;
    const bar = await p.evaluate(() => { const body = document.querySelector('#source-body'), box = body.getBoundingClientRect(), style = getComputedStyle(body);
      return { width: body.offsetWidth - body.clientWidth - parseFloat(style.borderRightWidth) - parseFloat(style.borderLeftWidth), right: box.right - parseFloat(style.borderRightWidth), top: box.top, height: body.clientHeight, ratio: body.clientHeight / body.scrollHeight, scroll: body.scrollTop }; });
    assert.ok(bar.scroll > lift, `the message is scrolled far enough to scroll back (${bar.scroll}px, ${Math.round(lift)}px wanted)`);
    if (bar.width >= 6) {
      const thumb = bar.top + (bar.scroll + bar.height / 2) * bar.ratio, x = bar.right - bar.width / 2;
      await p.mouse.move(x, thumb); await p.mouse.down(); await p.mouse.move(x, thumb - lift * bar.ratio, { steps: 6 }); await p.mouse.up();
    } else await p.evaluate(lift => { document.querySelector('#source-body').scrollTop -= lift; }, lift);
    await p.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const scrolled = await wordsAt(p, n);
    assert.ok(scrolled.scroll < bar.scroll - lift / 2 && scrolled.top > scrolled.room.bottom, `${bar.width >= 6 ? 'the scrollbar\'s drag' : 'the scroll'} moved the message, the words below what shows (${bar.scroll} to ${scrolled.scroll}; the words start at ${Math.round(scrolled.top)}px, the room ends at ${Math.round(scrolled.room.bottom)}px)`);
    await dropLine(p);
    const after = await wordsAt(p, n);
    assert.ok(Math.abs(after.scroll - scrolled.scroll) <= 1, `after the person's scroll, the reply changing size leaves the message where they put it (${scrolled.scroll}, then ${after.scroll})`);
    await close(p);
  });

  // The browser's own pull of a message scrolled to its end, as its room
  // grows there (a phone's keyboard going down), is no scroll of the
  // person's: the words quoted are still kept in sight when the keyboard
  // comes up again.
  await check('phone: quoting at the end of a message: the keyboard going down and coming up again keeps the quoted words in sight', async () => {
    const p = await page('phone', 'light', '/?topic=compose-wrap');
    await open(p, wrap, 'A plan in one item');
    await p.evaluate(() => { const body = document.querySelector('#source-body'); body.scrollTop = body.scrollHeight; });
    await p.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    // The last passage whose words show, just above the reply's line.
    const n = await p.evaluate(() => { const parts = [...document.querySelector('#source-body').children], top = document.querySelector('#reader-composer').getBoundingClientRect().top;
      return parts.findLastIndex(part => part.firstChild?.nodeType === Node.TEXT_NODE && part.getBoundingClientRect().bottom < top - 4); });
    await quoteAt(p, n);
    await keyboardUp(p);
    await p.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const up = await wordsAt(p, n);
    assert.ok(up.bottom <= up.room.bottom + 2 && up.top >= up.room.top - 2, `with the keyboard up, the quoted words show above the reply (${JSON.stringify(up)})`);
    await keyboardDown(p);
    await p.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    await keyboardUp(p);
    await p.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const again = await wordsAt(p, n);
    assert.ok(again.bottom <= again.room.bottom + 2 && again.top >= again.room.top - 2, `the keyboard down and up again, the quoted words still show above the reply (words ${Math.round(again.top)}–${Math.round(again.bottom)}px, the room ${Math.round(again.room.top)}–${Math.round(again.room.bottom)}px)`);
    await shot(p, 'quote-kept-keyboard-again');
    await p.emulateMedia({ colorScheme: 'dark' }); p.scheme = 'dark';
    await shot(p, 'quote-kept-keyboard-again');
    await close(p);
  });

  // Typing in a reply never pulls down a message scrolled to its end: the
  // reply measures itself at no height at each key, which for that moment
  // gives the message its room.
  await check('stacked: typing in the reply leaves a message scrolled to its end at its end', async () => {
    const p = await page('stacked');
    await open(p, second);
    await type(p, 'Some words');
    await p.evaluate(() => { const body = document.querySelector('#source-body'); body.scrollTop = body.scrollHeight; });
    await p.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const atEnd = await wordsAt(p, 3);
    assert.ok(atEnd.end > 0 && Math.abs(atEnd.scroll - atEnd.end) <= 1, `the message scrolled to its end (${atEnd.scroll} of ${atEnd.end})`);
    await p.evaluate(() => { const f = document.querySelector('#writing-body'); f.focus({ preventScroll: true }); f.setSelectionRange(f.value.length, f.value.length); });
    for (const word of [' and', ' a', ' few', ' more']) await p.keyboard.insertText(word);
    await p.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const typed = await wordsAt(p, 3);
    assert.ok(Math.abs(typed.scroll - typed.end) <= 1 && Math.abs(typed.top - atEnd.top) <= 1, `typing leaves the message at its end, its words where they were (${atEnd.scroll} of ${atEnd.end}, then ${typed.scroll} of ${typed.end})`);
    await close(p);
  });

  // Words chosen up to the very start of the next sentence, which begins a
  // line of its own, the reply then opening over them: what is kept in sight
  // above the reply is the words chosen, in the passage that holds them, not
  // the line the next sentence starts on.
  await check('stacked: quoting: words chosen to the very start of the next sentence end just above the reply, not on that sentence\'s line', async () => {
    const q = await page('stacked', 'light', '/?topic=compose-wrap');
    await open(q, wrap, 'A plan in one item');
    const set = await q.evaluate(() => {
      const body = document.querySelector('#source-body'), parts = [...body.children];
      const lines = part => [...part.getClientRects()].filter(box => box.width > 0);
      // A sentence of the long paragraph after which the next one starts a new line.
      const at = parts.findIndex((part, i) => part.textContent.startsWith('Sentence ') && parts[i + 1]?.textContent.startsWith('Sentence ')
        && lines(parts[i + 1])[0].top > lines(part).at(-1).top + 1);
      if (at < 0) return { at };
      const words = parts[at].firstChild, next = parts[at + 1].firstChild, range = document.createRange();
      range.setStart(words, 2); range.setEnd(next, 0);
      const end = () => Math.min(body.getBoundingClientRect().bottom - parseFloat(getComputedStyle(body).paddingBottom), document.querySelector('#reader-composer').getBoundingClientRect().top) - 4;
      const chosen = document.createRange(); chosen.setStart(words, 2); chosen.setEnd(words, words.data.trimEnd().length);
      body.scrollTop += chosen.getBoundingClientRect().bottom - end();
      getSelection().removeAllRanges(); getSelection().addRange(range); body.focus({ preventScroll: true });
      return { at, scrolled: body.scrollTop, selected: getSelection().toString(), next: parts[at + 1].textContent, line: lines(parts[at + 1])[0].top - chosen.getBoundingClientRect().bottom };
    });
    assert.ok(set.at > 0 && set.selected.startsWith('ntence ') && !set.selected.includes(set.next.trim()) && set.line >= 0, `words chosen to the start of the next sentence, which starts the line below: ${JSON.stringify(set)}`);
    await q.keyboard.press('Enter');
    await until(q, () => document.querySelector('#writing-body').value.startsWith('> ') && document.getAnimations().filter(x => x.effect?.getTiming().iterations !== Infinity).every(a => a.playState !== 'running'), 'the words quoted');
    await q.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const shown = await q.evaluate(at => {
      const body = document.querySelector('#source-body'), words = body.children[at].firstChild, chosen = document.createRange();
      chosen.setStart(words, 2); chosen.setEnd(words, words.data.trimEnd().length);
      const bottom = Math.min(body.getBoundingClientRect().bottom - parseFloat(getComputedStyle(body).paddingBottom), document.querySelector('#reader-composer').getBoundingClientRect().top);
      return { gap: Math.round(bottom - chosen.getBoundingClientRect().bottom), lineHeight: parseFloat(getComputedStyle(body).lineHeight), scrolled: body.scrollTop, quoted: document.querySelector('#writing-body').value };
    }, set.at);
    assert.ok(shown.quoted.includes(set.selected.trim()), `the words chosen are quoted: ${JSON.stringify(shown.quoted)}`);
    assert.ok(shown.scrolled > set.scrolled, `the reply came to cover the words, and the message moved (${set.scrolled} to ${shown.scrolled})`);
    assert.ok(shown.gap >= -2 && shown.gap <= shown.lineHeight / 2, `the words chosen end just above the reply, not a line further on (${shown.gap}px above it, a line is ${shown.lineHeight}px)`);
    await shot(q, 'quote-to-next-sentence');
    await close(q);
  });

  // Lines that wrap anew (a phone turned, the window or the layout changed)
  // put quoted words elsewhere in their passage: the message shows the words
  // quoted, measured again, not where they once were. Side by side, the end
  // of a long list item quoted near the bottom of what shows, the window
  // then made narrower.
  await check('wide: quoting: once the lines wrap anew, the message shows the words quoted, not where they were before', async () => {
    const p = await page('wide', 'light', '/?topic=compose-wrap');
    await open(p, wrap, 'A plan in one item');
    const settled = () => p.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const where = () => p.evaluate(() => {
      const body = document.querySelector('#source-body'), style = getComputedStyle(body), box = body.getBoundingClientRect();
      const item = [...body.children].find(part => part.textContent.includes('part 1 of the plan')), walker = document.createTreeWalker(item, NodeFilter.SHOW_TEXT);
      let node; while ((node = walker.nextNode()) && !node.data.includes('the item ends here'));
      const range = document.createRange(), from = node.data.indexOf('the item ends here'); range.setStart(node, from); range.setEnd(node, from + 'the item ends here'.length);
      const words = range.getBoundingClientRect();
      return { room: { top: box.top + parseFloat(style.paddingTop), bottom: box.bottom - parseFloat(style.paddingBottom) }, top: words.top, bottom: words.bottom, width: body.clientWidth };
    });
    await p.evaluate(() => {
      const body = document.querySelector('#source-body'), item = [...body.children].find(part => part.textContent.includes('part 1 of the plan')), walker = document.createTreeWalker(item, NodeFilter.SHOW_TEXT);
      let node; while ((node = walker.nextNode()) && !node.data.includes('the item ends here'));
      const range = document.createRange(), from = node.data.indexOf('the item ends here'); range.setStart(node, from); range.setEnd(node, from + 'the item ends here'.length);
      body.scrollTop += range.getBoundingClientRect().bottom - (body.getBoundingClientRect().bottom - parseFloat(getComputedStyle(body).paddingBottom) - 12);
      getSelection().removeAllRanges(); getSelection().addRange(range); body.focus({ preventScroll: true });
    });
    await settled();
    const before = await where();
    assert.ok(before.bottom < before.room.bottom && before.bottom > before.room.bottom - 40, `the words near the bottom of what shows (${JSON.stringify(before)})`);
    await p.keyboard.press('Enter');
    await until(p, () => document.querySelector('#writing-body').value.includes('the item ends here') && document.getAnimations().filter(x => x.effect?.getTiming().iterations !== Infinity).every(a => a.playState !== 'running'), 'the words quoted');
    await settled();
    const quoted = await where();
    assert.ok(Math.abs(quoted.top - before.top) <= 2, `quoting side by side moves nothing (${Math.round(before.top)}px, then ${Math.round(quoted.top)}px)`);
    await p.setViewportSize({ width: 1000, height: 800 });
    await until(p, w => document.querySelector('#source-body').clientWidth < w, 'the message narrower', quoted.width);
    await settled();
    const wrapped = await where();
    assert.ok(wrapped.top >= wrapped.room.top - 2 && wrapped.bottom <= wrapped.room.bottom + 2, `once the lines wrap anew, the words quoted show (words ${Math.round(wrapped.top)}–${Math.round(wrapped.bottom)}px, the room ${Math.round(wrapped.room.top)}–${Math.round(wrapped.room.bottom)}px)`);
    await shot(p, 'quote-after-rewrap');
    await p.emulateMedia({ colorScheme: 'dark' }); p.scheme = 'dark';
    await shot(p, 'quote-after-rewrap');
    await close(p);
  });

  await check('stacked: every control of the Reader and its composer is reached by keyboard alone, and Escape from each panel returns to its opener', async () => {
    const p = await page('stacked');
    // A message with one above and one below, so both arrows are there to
    // reach: the first agent message, above the second in their reply stack.
    await open(p, second);
    await press(p, '#next-message');
    await until(p, () => document.querySelector('#source-body').textContent.startsWith('First agent') && !document.querySelector('#next-message').disabled && !document.querySelector('#previous-message').disabled, 'the older message');
    // With writing in the reply, so Send can be reached.
    await p.evaluate(() => document.querySelector('#writing-body').focus());
    await p.keyboard.insertText('By keyboard.');
    await p.evaluate(() => document.querySelector('#source-body').focus());
    // Safari moves focus to buttons with ⌥Tab unless its Tab setting says otherwise; Playwright's WebKit is Safari's default.
    const tabbing = async (key, count) => { const seen = []; for (let n = 0; n < count; n++) { await p.keyboard.press(engine === 'webkit' ? key.replace('Tab', 'Alt+Tab') : key); seen.push(await p.evaluate(() => document.activeElement?.id || document.activeElement?.className || '')); } return seen; };
    const seen = new Set([...(await tabbing('Tab', 12)), ...(await tabbing('Shift+Tab', 24))]);
    for (const id of ['reader-parent', 'next-message', 'previous-message', 'reader-menu', 'reader-close', 'source-body', 'plus-button', 'writing-body', 'who-chip', 'send-reply'])
      assert.ok(seen.has(id), `${id} by Tab, among ${[...seen].join(', ')}`);
    await p.evaluate(() => document.querySelector('#who-chip').focus());
    await p.keyboard.press('Enter');
    await until(p, () => document.querySelector('#who-panel').contains(document.activeElement), 'focus in the who panel');
    // Back to Done, the panel's first, then forward through How and the topic's seven people to the name field.
    const inside = new Set(await tabbing('Shift+Tab', 2));
    for (let n = 0; n < 16 && !inside.has('recipient-input'); n++) for (const id of await tabbing('Tab', 1)) inside.add(id);
    for (const id of ['recipient-input', 'who-done']) assert.ok(inside.has(id), `${id} in the who panel by Tab, among ${[...inside].join(', ')}`);
    // A laptop keeps its To row: the topic's team and the name field in the panel, and no + Someone or naming sheet.
    const row = await p.evaluate(() => ({ team: [...document.querySelectorAll('#who-panel #recipient-chips [data-name]')].filter(el => el.getClientRects().length).map(el => el.dataset.name),
      field: document.querySelector('#recipient-input').getClientRects().length > 0, someone: document.querySelector('#recipient-open').getClientRects().length > 0, sheet: document.querySelector('#recipient-sheet').open }));
    assert.deepEqual({ ...row, team: TEAM.every(name => row.team.includes(name)) }, { team: true, field: true, someone: false, sheet: false }, `the laptop's To row: ${JSON.stringify(row)}`);
    await p.keyboard.press('Escape');
    await until(p, () => document.querySelector('#who-panel').hidden && document.activeElement?.id === 'who-chip', 'Escape back to the who chip')
      .catch(error => assert.fail(error.message));
    await p.evaluate(() => document.querySelector('#plus-button').focus());
    await p.keyboard.press('Space');
    await until(p, () => document.activeElement?.id === 'add-image', 'focus on Add image');
    const tiles = new Set(await tabbing('Tab', 1));
    assert.ok(tiles.has('toggle-note'), `the note by Tab, among ${[...tiles].join(', ')}`);
    await p.keyboard.press('Escape');
    await until(p, () => document.querySelector('#plus-panel').hidden && document.activeElement?.id === 'plus-button', 'Escape back to +');
    await p.evaluate(() => document.querySelector('#reader-menu').focus());
    await p.keyboard.press('Enter');
    await until(p, () => document.activeElement?.getAttribute('role') === 'menuitem', 'focus in the ⋯');
    await p.keyboard.press('Escape');
    await until(p, () => document.activeElement?.id === 'reader-menu', 'Escape back to ⋯');
    assert.equal(await p.evaluate(() => document.querySelector('#writing-body').value), 'By keyboard.');
    await close(p);
  });

  // Naming someone on a phone is two steps (docs/reader.md): the who panel,
  // which must leave the message readable whatever the team's size, then the
  // naming sheet, which may take the whole screen as a modal does. The topic
  // has a team of seven, so a step that listed the team would show it.
  // The writing begun, the keyboard up, then the who chip: the who panel in the keyboard's place.
  async function namingStart(p, where) {
    const at = NAMING[where];
    if (where === 'Reader') { await open(p, second); await type(p, 'Hello there.'); }
    else {
      await until(p, () => !document.querySelector('#inline-composer').hidden, 'the topic\'s composer');
      await press(p, '#new-message');
      await until(p, () => document.querySelector('#new-message-sheet')?.open && document.activeElement?.id === 'inline-writing-body', 'the composer, ready to type');
      await p.keyboard.insertText('Hello there.');
    }
    await keyboardUp(p);
    await press(p, at.chip);
    await keyboardDown(p);
    await until(p, s => !document.querySelector(s).hidden, 'the who panel in the keyboard\'s place', at.panel);
    return at;
  }
  // Where the message is scrolled to: the place a return must keep.
  const place = p => p.evaluate(() => { let sum = 0; for (let el = document.querySelector('#source-body'); el; el = el.parentElement) sum += el.scrollTop; return sum + scrollY; });
  // Step 1: what of the who panel shows, and what names it shows.
  const stepOne = (p, at) => p.evaluate(a => {
    const panel = document.querySelector(a.panel), row = document.querySelector(a.names).closest('.who-row'), r = row.getBoundingClientRect();
    return { names: [...panel.querySelectorAll('[data-name]')].filter(el => el.getClientRects().length).map(el => el.dataset.name),
      toRow: Math.round(r.height), panelHeight: Math.round(panel.getBoundingClientRect().height), sheetOpen: document.querySelector(a.sheet)?.open ?? null,
      someone: (b => b && b.getClientRects().length ? b.textContent : null)(document.querySelector(a.open)), focus: document.activeElement?.id || document.activeElement?.className };
  }, at);
  // Step 2: the sheet against what is visible, its title, and what it offers.
  const stepTwo = (p, at) => p.evaluate(a => {
    const sheet = document.querySelector(a.sheet), r = sheet.getBoundingClientRect(), v = { top: visualViewport.offsetTop, height: visualViewport.height, width: visualViewport.width };
    const title = document.getElementById(sheet.getAttribute('aria-labelledby') ?? ''), t = title?.getBoundingClientRect();
    const input = document.querySelector(a.input).getBoundingClientRect();
    return { open: sheet.open, modal: sheet.matches(':modal'), box: [Math.round(r.left), Math.round(r.top - v.top), Math.round(r.width - v.width), Math.round(r.height - v.height)],
      title: title?.textContent ?? null, titleShown: Boolean(t && t.height > 0 && t.top >= r.top && t.bottom <= r.top + 72),
      input: input.top >= v.top && input.bottom <= v.top + v.height + 0.5, focus: document.activeElement?.id,
      team: [...sheet.querySelectorAll('[data-name]')].map(el => el.dataset.name) };
  }, at);
  for (const where of ['Reader', 'New message sheet']) await check(`phone: in the ${where}, naming someone is two steps: the who panel shows who is named and + Someone, never the team${where === 'Reader' ? ', so the message keeps at least 7 lines' : ''}; + Someone opens a sheet over the whole screen, titled, with the team, the name field above the keyboard, and every target a finger's size; Done, Escape and ← each come back to + Someone with the writing and the place kept`, async () => {
    const p = await page('phone');
    const reader = where === 'Reader', at = await namingStart(p, where);
    // Step 1.
    const one = await stepOne(p, at);
    assert.deepEqual(one.names.filter(name => name !== agent), [], `the who panel names no one it was not asked to: ${JSON.stringify(one)}`);
    assert.ok(one.toRow <= 60, `To is one line, whatever the team (${one.toRow}px): ${JSON.stringify(one)}`);
    assert.equal(one.someone, '+ Someone', 'step 1 offers + Someone');
    if (reader) {
      const lines = await messageLines(p);
      measured.push({ engine, shape: 'phone', scheme: 'light', state: 'naming step 1, the who panel', ...lines });
      assert.ok(lines.lines >= 7, `with the who panel open the message shows ${lines.lines} lines`);
    } else assert.ok(await p.evaluate(() => document.querySelector('#new-message-sheet').getBoundingClientRect().top >= 0), 'the New message sheet\'s top stays on screen');
    await shot(p, `naming-step1-${reader ? 'reader' : 'sheet'}`);
    const was = await place(p);
    // Step 2.
    await press(p, at.open);
    await until(p, a => document.querySelector(a.sheet)?.open && document.activeElement === document.querySelector(a.input), 'the naming sheet, its field taking the typing', at)
      .catch(error => assert.fail(error.message));
    await until(p, () => document.getAnimations().filter(x=>x.effect?.getTiming().iterations!==Infinity).every(a => a.playState !== 'running'), 'the sheet settled');
    let two = await stepTwo(p, at);
    assert.deepEqual([two.modal, two.box], [true, [0, 0, 0, 0]], `the sheet is a modal over the whole screen: ${JSON.stringify(two)}`);
    assert.deepEqual([two.title, two.titleShown], ['Name someone', true], 'the sheet says what it is for at its top');
    assert.ok(TEAM.every(name => two.team.includes(name)), `the sheet offers the topic's team: ${two.team.join(', ')}`);
    await keyboardUp(p);
    two = await stepTwo(p, at);
    assert.deepEqual([two.box, two.input], [[0, 0, 0, 0], true], `with the keyboard up the sheet fills what shows, its field above the keyboard: ${JSON.stringify(two)}`);
    await shot(p, `naming-step2-${reader ? 'reader' : 'sheet'}`);
    // Someone not in the topic, typed, and one of the team, tapped.
    await p.keyboard.insertText('fixture-planning-agent');
    await p.keyboard.press('Enter');
    await until(p, s => document.querySelector(s).textContent.includes('fixture-planning-agent'), 'the typed name in the sheet', at.names);
    const offered = await p.evaluate(s => [...document.querySelector(s).querySelectorAll('[data-name="fixture-planning-agent"] button')].map(b => b.getAttribute('aria-label') || b.textContent), at.names);
    assert.deepEqual(offered, ['Remove fixture-planning-agent', 'Add to topic (gets all its messages)'], 'the named chip\'s controls');
    await press(p, `${at.names} [data-name="warp"]`);
    await until(p, s => document.querySelector(`${s} [data-name="warp"]`).getAttribute('aria-pressed') === 'true', 'warp named by a tap', at.names);
    await shot(p, `naming-step2-named-${reader ? 'reader' : 'sheet'}`);
    await keyboardDown(p);
    two = await stepTwo(p, at);
    assert.deepEqual(two.box, [0, 0, 0, 0], `with the keyboard down the sheet still fills the screen: ${JSON.stringify(two)}`);
    await shot(p, `naming-step2-keyboard-down-${reader ? 'reader' : 'sheet'}`);
    // Each way back: to + Someone in the who panel, the writing and the place as they were.
    for (const way of ['Done', 'Escape', '←']) {
      if (way !== 'Done') {
        await press(p, at.open);
        await until(p, a => document.querySelector(a.sheet)?.open && document.activeElement === document.querySelector(a.input), `the sheet again, for ${way}`, at)
          .catch(error => assert.fail(error.message));
      }
      if (way === 'Escape') await p.keyboard.press('Escape'); else await press(p, way === 'Done' ? at.done : at.back);
      await until(p, a => !document.querySelector(a.sheet).open && !document.querySelector(a.panel).hidden && document.activeElement === document.querySelector(a.open), `${way} back to + Someone`, at)
        .catch(async error => assert.fail(`${error.message}: ${JSON.stringify(await stepOne(p, at))}`));
      const back = await stepOne(p, at);
      assert.deepEqual([...back.names].sort(), [...new Set([...one.names, 'fixture-planning-agent', 'warp'])].sort(), `${way}: the who panel names who was named, and no one else`);
      assert.ok(back.toRow <= 60, `${way}: To is still one line (${back.toRow}px)`);
      assert.equal(await p.evaluate(s => document.querySelector(s).value, at.field), 'Hello there.', `${way}: the writing as it was`);
      assert.equal(await place(p), was, `${way}: the message where it was`);
      if (reader && way === 'Done') {
        const lines = await messageLines(p);
        measured.push({ engine, shape: 'phone', scheme: 'light', state: 'naming step 1 again, three named', ...lines });
        assert.ok(lines.lines >= 7, `back in the who panel the message shows ${lines.lines} lines`);
        await shot(p, `naming-step1-named-${reader ? 'reader' : 'sheet'}`);
      }
    }
    await press(p, at.panelDone);
    await until(p, a => document.querySelector(a.panel).hidden && document.activeElement === document.querySelector(a.field), 'Done back to the writing', at)
      .catch(error => assert.fail(error.message));
    assert.equal(await p.evaluate(s => document.querySelector(s).value, at.field), 'Hello there.');
    await close(p);
  });

  await check('phone: naming someone works from the keys alone: the who chip, + Someone, the sheet\'s people, field, ← and Done, Tab staying in the sheet, and Escape and ← back to + Someone', async () => {
    const p = await page('phone');
    const at = NAMING.Reader, tabKey = back => `${engine === 'webkit' ? 'Alt+' : ''}${back ? 'Shift+' : ''}Tab`;
    const active = () => p.evaluate(() => { const el = document.activeElement; return { id: el?.id || el?.dataset.name || el?.dataset.intent || '', inSheet: Boolean(el?.closest('#recipient-sheet')) }; });
    await open(p, second);
    await p.evaluate(() => document.querySelector('#writing-body').focus());
    await p.keyboard.insertText('By the keys.');
    await p.evaluate(() => document.querySelector('#who-chip').focus());
    await p.keyboard.press('Enter');
    await until(p, () => !document.querySelector('#who-panel').hidden && document.querySelector('#who-panel').contains(document.activeElement), 'the who panel by Enter');
    for (let n = 0; n < 16 && (await active()).id !== 'recipient-open'; n++) await p.keyboard.press(tabKey(false));
    assert.equal((await active()).id, 'recipient-open', '+ Someone by Tab');
    await p.keyboard.press('Enter');
    await until(p, () => document.querySelector('#recipient-sheet').open && document.activeElement?.id === 'recipient-input', 'the sheet by Enter, at its field')
      .catch(error => assert.fail(error.message));
    // From the field, the sheet's last, back through the team to ←, its first, naming aim-core with Space on the way.
    const seen = [];
    for (let n = 0; n < 14 && (await active()).id !== 'recipient-back'; n++) {
      await p.keyboard.press(tabKey(true)); seen.push(await active());
      if (seen.at(-1).id === 'aim-core') {
        await p.keyboard.press('Space');
        await until(p, () => document.querySelector('#recipient-chips [data-name="aim-core"]').getAttribute('aria-pressed') === 'true', 'aim-core named by Space')
          .catch(error => assert.fail(error.message));
      }
    }
    assert.deepEqual(seen.filter(at => !at.inSheet), [], `Tab stays in the sheet: ${JSON.stringify(seen)}`);
    const ids = new Set(seen.map(at => at.id));
    for (const id of ['recipient-back', 'recipient-done', 'aim-core', 'warp']) assert.ok(ids.has(id), `${id} by Tab, among ${[...ids].join(', ')}`);
    // Past the sheet's first control nothing behind it takes the focus: the writing, the who panel and the message wait.
    await p.keyboard.press(tabKey(true));
    const beyond = await p.evaluate(() => { const el = document.activeElement; return el && el !== document.body && !el.closest('#recipient-sheet') ? el.id || el.className || el.tagName : null; });
    assert.equal(beyond, null, 'nothing behind the sheet is reached by Tab');
    await p.keyboard.press('Escape');
    await until(p, () => !document.querySelector('#recipient-sheet').open && !document.querySelector('#who-panel').hidden && document.activeElement?.id === 'recipient-open', 'Escape back to + Someone')
      .catch(error => assert.fail(error.message));
    await p.keyboard.press('Enter');
    await until(p, () => document.querySelector('#recipient-sheet').open, 'the sheet again');
    for (let n = 0; n < 14 && (await active()).id !== 'recipient-back'; n++) await p.keyboard.press(tabKey(true));
    await p.keyboard.press('Enter');
    await until(p, () => !document.querySelector('#recipient-sheet').open && document.activeElement?.id === 'recipient-open', '← back to + Someone')
      .catch(error => assert.fail(error.message));
    assert.ok((await stepOne(p, at)).names.includes('aim-core'), 'the who panel names aim-core');
    assert.equal(await p.evaluate(() => document.querySelector('#writing-body').value), 'By the keys.');
    await close(p);
  });

  // A name typed in the naming field is never dropped (compose-bar.mjs
  // takeName): every way of putting the sheet away names it, as Return does,
  // and leaves the field empty.
  for (const where of ['Reader', 'New message sheet']) await check(`phone: in the ${where}, a name typed in the naming sheet is named by Done, ← and Escape, and the who chip says so`, async () => {
    const p = await page('phone');
    const at = await namingStart(p, where), before = await namedIn(p, at);
    const chip = () => p.evaluate(s => document.querySelector(s).textContent, at.chip), chipBefore = await chip();
    const typed = [];
    for (const [way, name] of [['Done', 'warp'], ['←', 'aim-ux'], ['Escape', 'aim-spec']]) {
      await press(p, at.open);
      await until(p, a => document.querySelector(a.sheet)?.open && document.activeElement === document.querySelector(a.input), `the sheet, for ${way}`, at)
        .catch(error => assert.fail(error.message));
      await keyboardUp(p);
      await p.keyboard.insertText(name);
      if (way === 'Escape') await p.keyboard.press('Escape'); else await press(p, way === 'Done' ? at.done : at.back);
      await until(p, a => !document.querySelector(a.sheet).open && !document.querySelector(a.panel).hidden, `${way} back to the who panel`, at)
        .catch(error => assert.fail(error.message));
      await keyboardDown(p);
      typed.push(name);
      const one = await stepOne(p, at);
      assert.deepEqual([...one.names].sort(), [...before, ...typed].sort(), `${way}: step 1 names ${name}, typed in the sheet: ${JSON.stringify(one)}`);
      assert.equal(await p.evaluate(s => document.querySelector(s).value, at.input), '', `${way}: nothing is left behind in the sheet's field`);
    }
    await press(p, at.panelDone);
    await until(p, a => document.querySelector(a.panel).hidden, 'Done back to the writing', at);
    assert.notEqual(await chip(), chipBefore, 'the who chip says who the writing now goes to');
    assert.equal(await p.evaluate(s => document.querySelector(s).value, at.field), 'Hello there.', 'the writing as it was');
    await close(p);
  });

  await check('stacked: a name typed in the who panel\'s To field is named when the panel closes by Done or Escape; a press on the message closes it naming no one, and the name waits in To', async () => {
    const p = await page('stacked'), at = NAMING.Reader;
    await open(p, second);
    await type(p, 'Hello there.');
    const before = await namedIn(p, at), typed = [];
    const chip = () => p.evaluate(s => document.querySelector(s).textContent, at.chip);
    for (const [way, name] of [['Done', 'warp'], ['Escape', 'aim-ux'], ['a press on the message', 'aim-spec']]) {
      await press(p, at.chip);
      await until(p, a => !document.querySelector(a.panel).hidden, `the who panel, for ${way}`, at);
      await p.locator(at.input).focus();
      await p.keyboard.insertText(name);
      const chipWas = await chip();
      if (way === 'Done') await press(p, at.panelDone);
      else if (way === 'Escape') await p.keyboard.press('Escape');
      else { const words = await p.locator('#source-body').boundingBox(); await p.mouse.click(words.x + 40, words.y + 40); }
      await until(p, a => document.querySelector(a.panel).hidden, `${way} closes the who panel`, at);
      if (way === 'a press on the message') {
        assert.deepEqual([[...await namedIn(p, at)].sort(), await chip()], [[...before, ...typed].sort(), chipWas], `${way}: ${name} is not named, and the chip says what it said`);
        await press(p, at.chip);
        await until(p, a => !document.querySelector(a.panel).hidden, 'the who panel again', at);
        assert.equal(await p.evaluate(s => document.querySelector(s).value, at.input), name, `${way}: ${name} waits in To, as typed`);
        continue;
      }
      typed.push(name);
      assert.deepEqual([...await namedIn(p, at)].sort(), [...before, ...typed].sort(), `${way}: ${name}, typed in To, is named`);
      assert.equal(await p.evaluate(s => document.querySelector(s).value, at.input), '', `${way}: nothing is left behind in To`);
    }
    assert.equal(await p.evaluate(s => document.querySelector(s).value, at.field), 'Hello there.', 'the writing as it was');
    await close(p);
  });

  // Escape pressed with focus outside the open who panel (on the message, on
  // Send) is not the panel's keydown: the composer hears it on the document
  // and puts the panel away as its own Escape does (compose-bar.mjs heard),
  // so a name typed in To is named, and the Reader or the sheet stays.
  for (const where of ['Reader', 'New message sheet']) await check(`stacked: in the ${where}, Escape pressed with focus outside the open who panel puts it away and names what was typed in To, and the chip says so`, async () => {
    const p = await page('stacked');
    const at = await namingStart(p, where), before = await namedIn(p, at);
    const chipWas = await p.evaluate(s => document.querySelector(s).textContent, at.chip);
    await p.locator(at.input).focus();
    await p.keyboard.insertText('warp');
    const outside = where === 'Reader' ? '#source-body' : '#inline-send';
    await p.evaluate(s => document.querySelector(s).focus(), outside);
    assert.deepEqual(await p.evaluate(([a, s]) => [document.querySelector(a.panel).hidden, document.activeElement === document.querySelector(s)], [at, outside]), [false, true], `the who panel open, focus on ${outside}`);
    await p.keyboard.press('Escape');
    await until(p, a => document.querySelector(a.panel).hidden, 'Escape puts the who panel away', at);
    const after = await p.evaluate(([a, where]) => ({ to: document.querySelector(a.input).value, chip: document.querySelector(a.chip).textContent, writing: document.querySelector(a.field).value,
      open: document.querySelector(where === 'Reader' ? '#reader' : '#new-message-sheet').open, focus: document.activeElement === document.querySelector(a.chip) }), [at, where]);
    assert.deepEqual({ ...after, named: [...await namedIn(p, at)].sort(), chipChanged: after.chip !== chipWas },
      { ...after, to: '', writing: 'Hello there.', open: true, focus: true, named: [...before, 'warp'].sort(), chipChanged: true },
      `Escape names warp, empties To, keeps the writing and the ${where} open, and focus is back on the who chip: ${JSON.stringify(after)}`);
    await close(p);
  });

  // At the topic page's end the composer is in no open dialog, so nothing
  // there would pass Escape on: the composer hears it itself, with focus on +
  // (reached by the keys alone from the writing) or on Send.
  for (const on of ['+', 'Send']) await check(`stacked: the New message composer at the topic page's end, in no dialog: Escape with focus on ${on}, outside the open who panel, puts it away and names what was typed in To, by the keys alone`, async () => {
    const p = await page('stacked'), at = NAMING['New message sheet'];
    const tab = back => p.keyboard.press(`${engine === 'webkit' ? 'Alt+' : ''}${back ? 'Shift+' : ''}Tab`);
    const focused = () => p.evaluate(() => document.activeElement?.id);
    const tabTo = async (id, back = false) => { for (let n = 0; n < 12 && await focused() !== id; n++) await tab(back); assert.equal(await focused(), id, `${back ? 'Shift+' : ''}Tab reaches #${id}`); };
    await until(p, () => !document.querySelector('#inline-composer').hidden, 'the topic\'s composer');
    await p.locator(at.field).focus();
    await p.keyboard.insertText('Home writing.');
    const before = await namedIn(p, at);
    await tabTo('inline-who-chip', true);
    await p.keyboard.press('Enter');
    await until(p, a => !document.querySelector(a.panel).hidden, 'Return on the who chip opens the who panel', at);
    await tabTo('inline-recipient-input');
    await p.keyboard.insertText('warp');
    if (on === '+') await tabTo('inline-plus-button');
    else await p.evaluate(() => document.querySelector('#inline-send').focus());
    const outside = on === '+' ? 'inline-plus-button' : 'inline-send';
    assert.deepEqual(await p.evaluate(a => [document.querySelector(a.panel).hidden, document.querySelector('#new-message-sheet').open], at), [false, false], 'the who panel open, at the page\'s end, the sheet not popped up');
    assert.equal(await focused(), outside, `focus on ${on}`);
    await p.keyboard.press('Escape');
    await until(p, a => document.querySelector(a.panel).hidden, 'Escape puts the who panel away', at);
    const after = await p.evaluate(a => ({ to: document.querySelector(a.input).value, writing: document.querySelector(a.field).value,
      popped: document.querySelector('#new-message-sheet').open, focus: document.activeElement?.id }), at);
    assert.deepEqual({ ...after, named: [...await namedIn(p, at)].sort() },
      { to: '', writing: 'Home writing.', popped: false, focus: 'inline-who-chip', named: [...before, 'warp'].sort() },
      `Escape names warp, empties To, keeps the writing where it was, and focus is back on the who chip: ${JSON.stringify(after)}`);
    await close(p);
  });

  // A Reader that closes with a panel of its reply open (here by ⌘⇧Return,
  // back to the page with nothing written) takes the panel with it
  // (compose-bar.mjs unseen): the closed Reader hears no more keys, so the
  // topic page's own composer has its Escape, as every surface's composer does.
  for (const panel of ['who', '+']) await check(`stacked: a Reader closed by ⌘⇧Return with its ${panel} panel open takes the panel with it, and the topic page's composer then puts its own who panel away by Escape, naming what waits in To, by the keys alone`, async () => {
    const p = await page('stacked'), at = NAMING['New message sheet'];
    const tab = back => p.keyboard.press(`${engine === 'webkit' ? 'Alt+' : ''}${back ? 'Shift+' : ''}Tab`);
    const focused = () => p.evaluate(() => document.activeElement?.id);
    const tabTo = async (id, back = false) => { for (let n = 0; n < 12 && await focused() !== id; n++) await tab(back); assert.equal(await focused(), id, `${back ? 'Shift+' : ''}Tab reaches #${id}`); };
    // 1. At the page's end, warp typed in To and left unnamed by a press elsewhere.
    await until(p, () => !document.querySelector('#inline-composer').hidden, 'the topic\'s composer');
    await p.locator(at.field).focus();
    await tabTo('inline-who-chip', true);
    await p.keyboard.press('Enter');
    await until(p, a => !document.querySelector(a.panel).hidden, 'the page composer\'s who panel', at);
    await tabTo('inline-recipient-input');
    await p.keyboard.insertText('warp');
    await press(p, '#topic-title');
    await until(p, a => document.querySelector(a.panel).hidden, 'a press elsewhere puts the who panel away', at);
    const before = await namedIn(p, at);
    assert.ok(!before.includes('warp'), 'warp waits unnamed');
    // 2. In the Reader, a panel of the reply open, by the keys.
    await open(p, second);
    await press(p, '#writing-body');
    await until(p, () => document.activeElement?.id === 'writing-body', 'the reply field');
    if (panel === 'who') {
      await tabTo('who-chip', true);
      await p.keyboard.press('Enter');
      await until(p, () => !document.querySelector('#who-panel').hidden, 'the Reader\'s who panel');
      await tabTo('recipient-input');
      await p.keyboard.insertText('aim-ux');
    } else {
      await tabTo('plus-button');
      await p.keyboard.press('Enter');
      await until(p, () => !document.querySelector('#plus-panel').hidden, 'the Reader\'s + panel');
    }
    // The keys of the Reader are the message's: a control keeps its own.
    await p.evaluate(() => document.querySelector('#source-body').focus());
    // 3. Back to the page with nothing written.
    await p.keyboard.press('Meta+Shift+Enter');
    await until(p, () => !document.querySelector('#reader').open, '⌘⇧Return closes the Reader');
    const id = panel === 'who' ? '#who-panel' : '#plus-panel', chip = panel === 'who' ? '#who-chip' : '#plus-button';
    await until(p, ([s, c]) => document.querySelector(s).hidden && document.querySelector(c).getAttribute('aria-expanded') === 'false', `the Reader's ${panel} panel went with it`, [id, chip]);
    // 4. Send at the page's end waits on warp and opens the who panel.
    await p.locator(at.field).focus();
    await p.keyboard.insertText('Home writing.');
    await p.keyboard.press('Meta+Enter');
    await until(p, a => !document.querySelector(a.panel).hidden && document.querySelector(a.input).value === 'warp', 'Send waits on warp, To open on it', at);
    // 5. Escape from + puts it away and names warp.
    await tabTo('inline-plus-button');
    await p.keyboard.press('Escape');
    const after = await p.evaluate(a => ({ panelOpen: !document.querySelector(a.panel).hidden, to: document.querySelector(a.input).value,
      writing: document.querySelector(a.field).value, focus: document.activeElement?.id }), at);
    assert.deepEqual({ ...after, named: [...await namedIn(p, at)].sort() },
      { panelOpen: false, to: '', writing: 'Home writing.', focus: 'inline-who-chip', named: [...before, 'warp'].sort() },
      `the page composer's Escape is its own: ${JSON.stringify(after)}`);
    await close(p);
  });

  // What Send says while it waits on a name typed in To and not named
  // (compose-bar.mjs holdSend) goes as soon as it is no longer true, so it never
  // says someone is not named beside a chip and Send that reach them.
  for (const where of ['Reader', 'New message sheet']) await check(`stacked: in the ${where}, what Send says about a name typed in To and not named goes as soon as it is no longer true: Return names them, a click on them names them, or To is cleared`, async () => {
    const p = await page('stacked'), sends = sendsOf(p);
    const at = await namingStart(p, where), before = await namedIn(p, at);
    const notice = where === 'Reader' ? '#reader-notice' : '#inline-notice';
    const said = () => p.evaluate(n => document.querySelector(n).hidden ? '' : document.querySelector(n).textContent, notice);
    const typed = [];
    for (const [way, name] of [['Return', 'warp'], ['a click on them', 'aim-ux'], ['clearing To', 'aim-spec']]) {
      if (await p.evaluate(a => document.querySelector(a.panel).hidden, at)) {
        await press(p, at.chip);
        await until(p, a => !document.querySelector(a.panel).hidden, `the who panel, for ${way}`, at);
      }
      // What a click on someone named leaves in To goes as the next name is typed.
      await p.locator(at.input).fill(name);
      // Back in the writing, then Send by ⌘ Return.
      await press(p, at.field);
      await until(p, a => document.querySelector(a.panel).hidden && document.activeElement === document.querySelector(a.field), 'back in the writing', at);
      await p.keyboard.press('Meta+Enter');
      await until(p, ([a, n, words]) => !document.querySelector(a.panel).hidden && document.activeElement === document.querySelector(a.input) && document.querySelector(n).textContent === words,
        `Send waits on ${name}, and says so`, [at, notice, waitWords(name)]);
      if (way === 'Return') await p.keyboard.press('Enter');
      else if (way === 'a click on them') await press(p, `${at.names} [data-name="${name}"]`);
      else await p.locator(at.input).fill('');
      if (way !== 'clearing To') typed.push(name);
      const now = { said: await said(), to: await p.evaluate(s => document.querySelector(s).value, at.input), named: [...await namedIn(p, at)].sort() };
      assert.deepEqual(now, { said: '', to: way === 'a click on them' ? name : '', named: [...before, ...typed].sort() },
        `${way}: nothing says ${name} is not named, and To and the chip say what Send will do: ${JSON.stringify(now)}`);
    }
    // Writing on leaves it unsaid.
    await press(p, at.field);
    await p.keyboard.insertText(' More.');
    assert.deepEqual([await said(), sends.length], ['', 0], 'writing on says nothing of it, and nothing was sent');
    await close(p);
  });

  // A name typed in To belongs to the reply it was typed for (compose-bar.mjs
  // writes): moving to another message with the who panel open names no one
  // there, and the name is in To again on coming back.
  await check('stacked, keys alone: a name typed in To for one message\'s reply stays with it; stepping to another message with the who panel open names no one there, and coming back finds it typed', async () => {
    const p = await page('stacked'), at = NAMING.Reader;
    await open(p, second);
    await type(p, 'Reply to the second.');
    const before = await namedIn(p, at);
    const read = () => p.evaluate(a => ({ named: [...document.querySelector(a.named).querySelectorAll('[data-name]')].map(el => el.dataset.name),
      to: document.querySelector(a.input).value, chip: document.querySelector(a.chip).textContent, writing: document.querySelector(a.field).value }), at);
    await p.evaluate(() => document.querySelector('#who-chip').focus());
    await p.keyboard.press('Enter');
    await until(p, a => !document.querySelector(a.panel).hidden && document.querySelector(a.panel).contains(document.activeElement), 'the who panel, by Return on its chip', at);
    await p.locator(at.input).focus();
    await p.keyboard.insertText('warp');
    await p.evaluate(() => document.querySelector('#source-body').focus());
    assert.equal(await p.evaluate(a => document.querySelector(a.panel).hidden, at), false, 'the who panel stays open as focus leaves it');
    // The older message is above the newer in their reply stack: ⌘↑, and ⌘↓ back.
    await p.keyboard.press('Meta+ArrowUp');
    await until(p, () => document.querySelector('#source-body').textContent.startsWith('First agent'), 'the older message');
    const older = await read();
    assert.deepEqual([older.named, older.to, older.chip.includes('warp')], [before, '', false], `the older message's reply names no one more, and its To is empty: ${JSON.stringify(older)}`);
    await p.keyboard.press('Meta+ArrowDown');
    await until(p, () => document.querySelector('#source-body').textContent.startsWith('Second agent'), 'back to the newer message');
    const newer = await read();
    assert.deepEqual([newer.named, newer.to, newer.writing], [before, 'warp', 'Reply to the second.'], `back on the newer message, warp is typed in its To, not named: ${JSON.stringify(newer)}`);
    await close(p);
  });

  for (const shape of ['phone', 'stacked']) await check(`${shape}: New message at the top of the topic opens the composer on its own, ready to type, and Escape puts it back with the writing kept`, async () => {
    const p = await page(shape);
    await until(p, () => !document.querySelector('#inline-composer').hidden, 'the topic\'s composer');
    await p.locator('#inline-composer').scrollIntoViewIfNeeded();
    await shot(p, 'topic-composer');
    await p.evaluate(() => scrollTo(0, 0));
    const control = await p.evaluate(() => { const box = document.querySelector('#new-message')?.getBoundingClientRect(); return box ? { top: Math.round(box.top), shown: box.height > 0, under: document.querySelector('.topic-header').contains(document.querySelector('#new-message')) } : null; });
    assert.ok(control?.shown && control.under, 'a quiet New message beside the title');
    await press(p, '#new-message');
    await until(p, () => document.querySelector('#new-message-sheet')?.open && document.activeElement?.id === 'inline-writing-body', 'the composer, ready to type');
    const sheet = await p.evaluate(() => ({ reader: document.querySelector('#reader').open, message: Boolean(document.querySelector('#new-message-sheet .reading-pane, #new-message-sheet article')), holds: document.querySelector('#new-message-sheet').contains(document.querySelector('#inline-composer')) }));
    assert.deepEqual(sheet, { reader: false, message: false, holds: true }, 'the composer with no message above it');
    await p.keyboard.insertText('A new message.');
    if (shape === 'phone') await keyboardUp(p);
    await shot(p, 'new-message');
    await p.keyboard.press('Escape');
    await until(p, () => !document.querySelector('#new-message-sheet').open, 'Escape puts it back');
    assert.equal(await p.evaluate(() => document.querySelector('#inline-writing-body').value), 'A new message.');
    await close(p);
  });
  await runSizes();
}

// The composer's size (item 400, docs/reader.md "Size"): the Reader, the
// composer with the message beside it, and the New message sheet, the
// composer alone, are as tall as what shows of the window, and as wide as the
// window lets them be up to a maximum (72rem, side by side 100rem); on a
// phone they fill the width and what shows above the keyboard, so nothing
// goes past the screen, sideways or down, and Send stays where a finger
// reaches it. Each width is checked empty, with a draft longer than the field,
// and with an image, measured in px from the page's own boxes.
const REM = 16, WIDEST = { stacked: 72 * REM, wide: 100 * REM };
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64');
const SIZES = { 'phone 320×568': ['phone-320'], 'phone 375×667': ['phone-375'], 'phone 390×844': ['phone-390'], 'phone sideways 844×390': ['phone-sideways'], 'narrow window 480×300': ['narrow'],
  'laptop 1440×960': ['laptop-stacked', 'laptop-wide'], 'very wide 2560×1440': ['very-wide-stacked', 'very-wide-wide'] };
// A refused image: an iPhone's HEIC photo the server takes no copy of, so it
// waits on a choice (Attach as download, Remove) and Send is refused until it
// has one: the notice says why and the image's choices open, the composer's
// tallest state.
const DRAFTS = { empty: 'light', 'a long draft': 'dark', 'an image': 'light', 'a refused image': 'dark' };
const HEIC = { name: 'IMG_3307.heic', mimeType: 'image/heic', buffer: Buffer.from('not an image the browser can read') };
const LONG = Array.from({ length: 120 }, (_, i) => `Line ${i + 1} of a draft longer than any field.`).join('\n');
// What one composer's surface measures: its box, its composer's, the field's
// and Send's, against what shows of the window, and which of its controls, or
// the page itself, reach past what shows.
const sized = (p, which) => p.evaluate(which => {
  const [dialog, composer] = which === 'sheet' ? ['#new-message-sheet', '#inline-composer'] : ['#reader', '#reader-composer'];
  const d = document.querySelector(dialog), c = document.querySelector(composer), field = c.querySelector('textarea'), send = c.querySelector('.compose-send');
  const box = el => { const b = el.getBoundingClientRect(); return { top: Math.round(b.top), bottom: Math.round(b.bottom), left: Math.round(b.left), right: Math.round(b.right), width: Math.round(b.width), height: Math.round(b.height) }; };
  const view = { top: Math.round(visualViewport.offsetTop), height: Math.round(visualViewport.height), width: innerWidth, innerHeight };
  const shown = el => el.getClientRects().length && getComputedStyle(el).visibility !== 'hidden';
  // A control in a box of the composer that scrolls (a phone's panel holding more than fits, or the composer itself where it is taller than what it has) is where a finger brings it: that box is what must show.
  const scroller = el => { for (let at = el.parentElement; at && at !== c.parentElement; at = at.parentElement) if (/auto|scroll/.test(getComputedStyle(at).overflowY) && at.scrollHeight > at.clientHeight) return at; return el; };
  const past = [...c.querySelectorAll('button, input, textarea, select, [role=button]')].filter(shown).map(el => [el.id || el.className || el.tagName, box(scroller(el))])
    .filter(([, b]) => b.left < -1 || b.right > view.width + 1 || b.top < view.top - 1 || b.bottom > view.top + view.height + 1).map(([name]) => name);
  const panel = c.querySelector('.compose-panel:not([hidden])');
  // Shows itself, not only its scroller: its own box inside what shows and inside every box of the composer that clips it.
  const seen = el => { const b = el.getBoundingClientRect(); if (b.top < view.top - 1 || b.bottom > view.top + view.height + 1 || b.left < -1 || b.right > view.width + 1) return false;
    for (let at = el.parentElement; at && at !== c.parentElement; at = at.parentElement) if (getComputedStyle(at).overflowY !== 'visible') { const a = at.getBoundingClientRect(); if (b.top < a.top - 1 || b.bottom > a.bottom + 1) return false; }
    return true; };
  const focus = c.contains(document.activeElement) ? { id: document.activeElement.id || document.activeElement.className, seen: seen(document.activeElement) } : null;
  const notice = c.querySelector('.notice:not([hidden])'), taller = c.querySelector('.taller-field');
  // The composer's rows, top to bottom, are each clear of the others: the notice, the head, a panel in its row, the images, and the foot (+, the field, 👍, Send), which share theirs.
  // A row given less than its height would be drawn over the next (an image's choices under Send).
  const rows = [...c.children].filter(el => shown(el) && getComputedStyle(el).position === 'static' && el.matches('.notice, .compose-head, .compose-panel, .image-strip, .plus-button, .field-box, .compose-send, #thumb-source')
    && !(el.matches('.compose-head') && c.dataset.compose !== 'writing')).map(el => [el.id || el.className, box(el), el.matches('.plus-button, .field-box, .compose-send, #thumb-source') ? 'foot' : el]);
  const over = rows.flatMap(([a, ba, ra], i) => rows.slice(i + 1).filter(([, bb, rb]) => (ra !== 'foot' || rb !== 'foot') && Math.min(ba.bottom, bb.bottom) - Math.max(ba.top, bb.top) > 1).map(([b]) => `${a} / ${b}`));
  // The surface never scrolls, so its own head (the Reader's ✕ and ↑ ↓, the sheet's title and ✕) stays where it is: what is taller scrolls inside the composer.
  const head = d.querySelector(which === 'sheet' ? '.inline-composer>h2' : '.reader-header');
  return { open: d.open, dialog: box(d), surfaceScrolled: d.scrollTop, head: box(head), composer: { ...box(c), scrolls: c.scrollHeight > c.clientHeight + 1 }, field: { ...box(field), scrolls: field.scrollHeight > field.clientHeight + 4, line: parseFloat(getComputedStyle(field).minHeight) }, send: shown(send) ? { ...box(send), seen: seen(send) } : null, panel: panel && box(panel),
    images: c.querySelectorAll('.image-strip .image-choice').length, choices: c.querySelectorAll('.image-strip .image-choice[data-open][data-needs]').length, notice: notice ? notice.textContent : '',
    focus, compose: c.dataset.compose, taller: Boolean(shown(taller)), over, view, past, sideways: document.documentElement.scrollWidth > innerWidth };
}, which);
async function runSizes() {
  for (const [size, shapes] of Object.entries(SIZES)) for (const [draft, scheme] of Object.entries(DRAFTS)) await check(`size ${size}, ${draft}: the composer is as tall as what shows of the window and as wide as it allows up to its maximum, with the message beside it and alone, and nothing reaches past the screen`, async () => {
    for (const shape of shapes) {
      let p = await page(shape, scheme);
      const phone = p.touch, wide = shape.endsWith('wide'), sideways = shape === 'phone-sideways';
      const { width, height } = SHAPES[shape].viewport;
      // The layout is the window's width's, whatever the pointer (aim.css, max-width:760px): a finger only brings the keyboard.
      const narrow = width <= 760;
      // What each surface must measure: on a laptop the window less 3rem each
      // way, up to the maximum across; narrow (a phone) the width, and what shows
      // (less .75rem above the sheet, which the feed's dimming shows through).
      const expected = (which, v) => narrow ? { width, height: v.height - (which === 'sheet' ? 12 : 0) }
        : { width: Math.min(WIDEST[which === 'reader' && wide ? 'wide' : 'stacked'], width - 3 * REM), height: v.innerHeight - 3 * REM };
      const near = (a, b) => Math.abs(a - b) <= 2;
      const fieldOf = { sheet: 'inline-writing-body', reader: 'writing-body' };
      const holds = async (which, when) => {
        const field = fieldOf[which];
        const m = await sized(p, which), want = expected(which, m.view), said = `${shape} ${which} ${when}: ${JSON.stringify({ want, ...m })}`;
        assert.ok(m.open, `open: ${said}`);
        // Sideways, a phone's Reader is a small laptop's, and the keyboard leaves it a sliver: what is held there is
        // only that nothing moves the surface itself, its header (✕, ↑ ↓) staying at its top.
        if (sideways) {
          assert.equal(m.surfaceScrolled, 0, `the ${which} itself never scrolls: ${said}`);
          if (which === 'reader') assert.ok(m.head.top >= m.dialog.top - 1, `the Reader's header stays at its top: ${said}`);
          return m;
        }
        assert.ok(near(m.dialog.height, want.height), `as tall as what shows of the window (${want.height}px), not ${m.dialog.height}px: ${said}`);
        assert.ok(near(m.dialog.width, want.width), `as wide as the window allows up to its maximum (${want.width}px), not ${m.dialog.width}px: ${said}`);
        assert.deepEqual([m.dialog.top >= m.view.top - 1, m.dialog.bottom <= m.view.top + m.view.height + 1, m.dialog.left >= 0, m.dialog.right <= width + 1, m.sideways, m.past],
          [true, true, true, true, false, []], `nothing reaches past what shows, sideways or down, Send included: ${said}`);
        assert.ok(m.send, `Send shows: ${said}`);
        assert.deepEqual(m.over, [], `no row of the composer is drawn over another: ${said}`);
        assert.equal(m.surfaceScrolled, 0, `the ${which} itself never scrolls, what is taller scrolls inside the composer: ${said}`);
        if (which === 'reader') assert.ok(m.head.top >= m.dialog.top - 1 && m.head.bottom <= m.view.top + m.view.height + 1, `the Reader's header shows: ${said}`);
        // Alone, or side by side, the composer is the surface's whole height,
        // its field taking what the rest leaves; stacked, the reply is as tall
        // as its writing and the message has the rest (docs/reader.md).
        if (which === 'sheet' || wide) {
          assert.ok(m.composer.height >= m.dialog.height - 4, `the composer fills its surface's height: ${said}`);
          // Alone, the field ends at the sheet's foot; side by side the hint's line and + · Send's row are under it.
          // On a phone an open panel is under the field, in the keyboard's place.
          const foot = m.panel && m.panel.top >= m.field.bottom - 1 ? m.panel.top : m.dialog.bottom;
          assert.ok(foot - m.field.bottom <= (which === 'sheet' ? 24 : 120), `the field reaches down to the composer's foot: ${said}`);
        }
        // The field gives way first: a composer holding more than it shows (and so scrolling inside itself) has its
        // field at one line, its own minimum, so as much of the head and the images shows as can.
        if (m.composer.scrolls) assert.ok(m.field.height <= m.field.line + 1, `the field gives way to one line (${m.field.line}px) before the composer scrolls: ${said}`);
        if (draft === 'a long draft') assert.ok(m.field.scrolls, `a draft longer than the field scrolls inside it: ${said}`);
        if (draft === 'an image' || draft === 'a refused image') assert.equal(m.images, 1, `the image shows in the composer: ${said}`);
        // What has focus shows itself, and with the field in hand Send shows beside it: a composer taller than what shows scrolls inside itself, the focus in view.
        assert.ok(!m.focus || m.focus.seen, `what has focus shows: ${said}`);
        if (m.focus?.id === field) assert.ok(m.send.seen, `with the field in hand, Send shows: ${said}`);
        if (draft === 'a refused image') {
          assert.equal(m.choices, 1, `the refused image's choices are open: ${said}`);
          if (which === 'reader') assert.equal(m.notice, `Finish or remove the image ${HEIC.name} before sending.`, `the notice says why Send was refused: ${said}`);
        }
        // Narrow (a phone, or a narrow window), writing: the Reader's stacked field has ⤢ to make it taller; the sheet's field is already the sheet's height, so it has none.
        if (narrow && m.compose === 'writing') assert.equal(m.taller, which === 'reader', `⤢ ${which === 'reader' ? 'makes the Reader\'s field taller' : 'is not in the sheet, whose field fills it'}: ${said}`);
        return m;
      };
      const fill = async (which, field, plus, tile) => {
        if (draft === 'a long draft' && which === 'reader') await p.keyboard.insertText(LONG);
        if (draft === 'an image' || draft === 'a refused image') {
          await p.keyboard.insertText('Here is the picture.');
          await press(p, plus);
          await until(p, s => !document.querySelector(s).hidden, 'the + panel', which === 'sheet' ? '#inline-plus-panel' : '#plus-panel');
          const chooser = p.waitForEvent('filechooser');
          await press(p, tile);
          await (await chooser).setFiles(draft === 'an image' ? { name: 'picture.png', mimeType: 'image/png', buffer: PNG } : HEIC);
          await until(p, s => document.querySelectorAll(`${s} .image-strip .image-choice`).length === 1, 'the image in the composer', which === 'sheet' ? '#inline-composer' : '#reader-composer', 20000);
          if (draft === 'a refused image') {
            const strip = which === 'sheet' ? '#inline-attachments' : '#writing-attachments';
            await until(p, s => document.querySelector(`${s} .image-choice`)?.hasAttribute('data-needs'), 'the image waiting on a choice', strip, 20000);
            // Send, refused, says why and opens the image's choices in the Reader; in the sheet Send waits, and a press on the image opens them.
            if (which === 'reader') {
              await press(p, '#send-reply', true);
              await until(p, () => !document.querySelector('#reader-notice').hidden, 'the notice');
            } else await press(p, `${strip} .image-open`);
            await until(p, s => document.querySelector(`${s} .image-choice`).hasAttribute('data-open'), 'the image\'s choices open', strip);
            await until(p, () => document.getAnimations().filter(x => x.effect?.getTiming().iterations !== Infinity).every(a => a.playState !== 'running'), 'a settled composer');
            await holds(which, 'refused, the image\'s choices open');
            await shot(p, `size-refused-${which}-choices`);
          }
          // On a phone the tile let the keyboard go; the field takes it back.
          await press(p, field);
        }
      };
      // The keyboard comes up: the visible height falls by about the share of
      // the screen a phone's keyboard takes, with the field focused.
      const keyboard = async (which, field) => {
        if (!phone) return;
        await until(p, s => document.activeElement === document.querySelector(s), 'the field focused', field);
        const up = height - Math.round(height * 0.45);
        await p.setViewportSize({ width, height: up });
        await until(p, h => Math.round(visualViewport.height) === h && getComputedStyle(document.documentElement).getPropertyValue('--vv-height').trim() === `${h}px`, 'the keyboard up', up);
        await until(p, () => document.getAnimations().filter(x => x.effect?.getTiming().iterations !== Infinity).every(a => a.playState !== 'running'), 'a settled page');
        await holds(which, 'with the keyboard up');
        await shot(p, `size-${draft.replaceAll(' ', '-')}-${which}-keyboard`);
        await p.setViewportSize({ width, height });
        await until(p, h => getComputedStyle(document.documentElement).getPropertyValue('--vv-height').trim() === `${h}px`, 'the keyboard down', height);
      };
      // Alone: the New message sheet (on a laptop, from the stacked page).
      if (!wide) {
        await until(p, () => !document.querySelector('#inline-composer').hidden, 'the topic\'s composer');
        if (draft === 'a long draft') {
          // Held in the composer at the page's end, where the field grew with it, then taken up into the sheet.
          await p.locator('#inline-writing-body').scrollIntoViewIfNeeded();
          await press(p, '#inline-writing-body');
          await until(p, () => document.activeElement?.id === 'inline-writing-body' && document.querySelector('#inline-composer').dataset.compose === 'writing', 'the page end\'s field taking the writing');
          await p.keyboard.insertText(LONG);
        }
        await p.evaluate(() => scrollTo(0, 0));
        await press(p, '#new-message');
        await until(p, () => document.querySelector('#new-message-sheet')?.open && document.activeElement?.id === 'inline-writing-body', 'the composer, ready to type');
        await fill('sheet', '#inline-writing-body', '#inline-plus-button', '#inline-add-image');
        await until(p, () => document.getAnimations().filter(x => x.effect?.getTiming().iterations !== Infinity).every(a => a.playState !== 'running'), 'a settled sheet');
        await holds('sheet', 'open');
        await shot(p, `size-${draft.replaceAll(' ', '-')}-sheet`);
        // The panels are measured where the window is as tall as a phone's or a laptop's: in a short window
        // (sideways, or the narrow 300-high one) a panel is a sliver, and where it opens is not this item's.
        if (draft === 'empty' && height > 400) for (const [panel, opener] of [['#inline-who-panel', '#inline-who-chip'], ['#inline-plus-panel', '#inline-plus-button']]) {
          // Each panel opens inside the sheet, on the screen: a popover above a sheet as tall as the window would be off it.
          await press(p, opener);
          await until(p, s => !document.querySelector(s).hidden, 'the panel', panel);
          const inside = await p.evaluate(s => { const b = document.querySelector(s).getBoundingClientRect(), d = document.querySelector('#new-message-sheet').getBoundingClientRect();
            return { panel: [b.top, b.bottom, b.left, b.right].map(Math.round), sheet: [d.top, d.bottom, d.left, d.right].map(Math.round), inside: b.top >= d.top - 1 && b.bottom <= d.bottom + 1 && b.left >= d.left - 1 && b.right <= d.right + 1 }; }, panel);
          assert.ok(inside.inside, `${panel} opens inside the sheet: ${JSON.stringify(inside)}`);
          await holds('sheet', `with ${panel} open`);
          await shot(p, `size-sheet-${panel.slice(8)}`);
          await p.keyboard.press('Escape');
          await until(p, s => document.querySelector(s).hidden && document.querySelector('#new-message-sheet').open, 'Escape puts the panel away, not the sheet', panel);
        }
        await press(p, '#inline-writing-body');
        await keyboard('sheet', '#inline-writing-body');
        await holds('sheet', 'with the keyboard down again');
        await p.keyboard.press('Escape');
        await until(p, () => !document.querySelector('#new-message-sheet').open, 'Escape puts the sheet back');
      }
      // Beside the message: the Reader, writing a reply, on a page of its own
      // (an image still being taken in keeps the page on the new message).
      if (!wide) { await close(p); p = await page(shape, scheme); }
      await open(p, second);
      await press(p, '#writing-body');
      await until(p, () => document.activeElement?.id === 'writing-body' && document.querySelector('#reader-composer').dataset.compose === 'writing', 'the field taking the writing');
      await fill('reader', '#writing-body', '#plus-button', '#add-image');
      await until(p, () => document.getAnimations().filter(x => x.effect?.getTiming().iterations !== Infinity).every(a => a.playState !== 'running'), 'a settled Reader');
      await holds('reader', 'open');
      await shot(p, `size-${draft.replaceAll(' ', '-')}-reader`);
      await keyboard('reader', '#writing-body');
      await close(p);
    }
  });
}

// After every case above, in a world they do not see: the outcome's
// conversation has a coordinator and a team larger than the topic's, so its
// "Answered by" lists more people than fit above a phone's keyboard.
const ANSWERING = [...TEAM, 'fixture-planning-agent', 'fixture-reviewing-agent'];
async function runAnswering() {
  // "Answered by" in a phone's naming sheet (docs/reader.md): who answers and
  // the topic's people are one list that scrolls between the sheet's head and
  // its field, so the field being typed in stays above the keyboard, and the
  // last of them can be scrolled to and tapped, however big the team.
  async function answeringSheet(p, at) {
    await press(p, at.open);
    await until(p, a => document.querySelector(a.sheet)?.open && document.activeElement === document.querySelector(a.input), 'the naming sheet, its field taking the typing', at)
      .catch(error => assert.fail(error.message));
    await keyboardUp(p);
    const people = `${at.sheet} :is(.answerer-chips > button, .chips > [data-name])`;
    const m = await p.evaluate(([a, people]) => {
      const sheet = document.querySelector(a.sheet), input = document.querySelector(a.input).getBoundingClientRect();
      const head = sheet.querySelector('.naming-head').getBoundingClientRect(), view = [visualViewport.offsetTop, visualViewport.offsetTop + visualViewport.height];
      const rows = [...document.querySelectorAll(people)].filter(el => el.getClientRects().length);
      // Each person is where a finger can bring them: in a box that scrolls
      // (not the sheet's own clipping) whose view lies between the head and the field.
      const scroller = el => { for (let at = el.parentElement; at && at !== sheet; at = at.parentElement) if (/auto|scroll/.test(getComputedStyle(at).overflowY)) return at; return null; };
      // Its place in that box's content (its scrollTop added back) is within what the box scrolls through.
      const unreachable = rows.filter(el => { const s = scroller(el), b = s?.getBoundingClientRect(), r = el.getBoundingClientRect();
        return !s || b.top < head.bottom - 0.5 || b.bottom > input.top + 0.5 || r.bottom - b.top + s.scrollTop > s.scrollHeight + 0.5; }).map(el => el.dataset.answerer ?? el.dataset.name);
      return { answerers: sheet.querySelectorAll('.answerer-chips > button').length, input: [Math.round(input.top), Math.round(input.bottom)], view, unreachable,
        last: (el => el && (el.dataset.answerer ? `[data-answerer="${el.dataset.answerer}"]` : `[data-name="${el.dataset.name}"]`))(rows.at(-1)) };
    }, [at, people]);
    assert.ok(m.answerers >= ANSWERING.length, `Answered by lists the team: ${JSON.stringify(m)}`);
    assert.ok(m.input[0] >= m.view[0] && m.input[1] <= m.view[1] + 0.5, `the field being typed in is above the keyboard: ${JSON.stringify(m)}`);
    assert.deepEqual(m.unreachable, [], `every one of them can be scrolled to: ${JSON.stringify(m)}`);
    await shot(p, 'answered-by-sheet');
    // The last, scrolled to as a finger would, shows whole above the field, and a tap names them.
    const last = `${at.sheet} ${m.last}`;
    await p.evaluate(s => { const el = document.querySelector(s); el.parentElement.closest('.naming-people').scrollTop = 1e6; }, last);
    const seen = await p.evaluate(([s, a]) => { const b = document.querySelector(s).getBoundingClientRect(), field = document.querySelector(a.input).getBoundingClientRect(), head = document.querySelector(a.sheet).querySelector('.naming-head').getBoundingClientRect();
      return b.top >= head.bottom - 0.5 && b.bottom <= field.top + 0.5; }, [last, at]);
    assert.ok(seen, 'the last of them, scrolled to, is whole between the head and the field');
    const pressed = () => p.evaluate(s => document.querySelector(s).getAttribute('aria-pressed'), last);
    const was = await pressed();
    await press(p, last);
    await until(p, ([s, w]) => document.querySelector(s)?.getAttribute('aria-pressed') !== w, 'the last of them named by a tap', [last, was]);
    await press(p, at.done);
    await until(p, a => !document.querySelector(a.sheet).open, 'Done', at);
  }

  await check('phone: on the outcome\'s conversation page, Answered by with a big team: the naming sheet keeps the field above the keyboard, and the last of them can be scrolled to and tapped', async () => {
    // Opened on the conversation page itself: a topic page left while its reads are still out has them
    // cancelled, and Safari's engine reports each as an error of the page left behind.
    const p = await page('phone', 'light', '/?conversation=w1'), at = NAMING['New message sheet'];
    await until(p, n => document.querySelectorAll('#inline-composer .answerer-chips > button').length >= n, 'Answered by, the team', ANSWERING.length, 15000);
    await p.locator(at.field).scrollIntoViewIfNeeded();
    await press(p, at.field);
    await until(p, a => document.activeElement === document.querySelector(a.field), 'the field taking the writing', at);
    await p.keyboard.insertText('Hello there.');
    await keyboardUp(p);
    await press(p, at.chip);
    await keyboardDown(p);
    await until(p, a => !document.querySelector(a.panel).hidden, 'the who panel', at);
    await answeringSheet(p, at);
    await close(p);
  });

  await check('phone: a Reader reply sent to the conversation, Answered by with a big team: the naming sheet keeps the field above the keyboard, and the last of them can be scrolled to and tapped', async () => {
    const p = await page('phone'), at = NAMING.Reader;
    await open(p, second);
    await type(p, 'To the conversation.');
    await keyboardUp(p);
    await press(p, at.chip);
    await keyboardDown(p);
    await until(p, a => !document.querySelector(a.panel).hidden, 'the who panel', at);
    const other = '#reply-destination button[data-destination]:not([aria-pressed="true"])';
    const value = await p.evaluate(s => document.querySelector(s).dataset.destination, other);
    await press(p, other);
    await until(p, ([v, words]) => document.querySelector(`#reply-destination [data-destination="${v}"]`)?.getAttribute('aria-pressed') === 'true' && document.querySelector('#writing-body').value === words,
      'the writing moved to the conversation', [value, 'To the conversation.'], 15000);
    await until(p, n => document.querySelectorAll('#reply-audience .answerer-chips > button').length >= n, 'Answered by, the team', ANSWERING.length, 15000);
    await answeringSheet(p, at);
    await close(p);
  });
}

// Last, the cases that may send: a send changes the topic every case above opens.
// Send with a name typed in To and not named (compose-bar.mjs holdSend)
// sends nothing: with or without that name it would reach people the who chip
// did not say. To opens on the name, and the composer says why.
const waitWords = name => `${name} is typed in To but not named yet. Return names them; clear it to send without them.`;
const WAITING = waitWords('warp');
const sendsOf = p => {
  const sends = [];
  p.on('request', request => { if (request.url().endsWith('/api/command') && JSON.parse(request.postData() ?? '{}').kind === 'message.send') sends.push(request.url()); });
  return sends;
};
const sendResponse = p => p.waitForResponse(response => response.url().endsWith('/api/command') && JSON.parse(response.request().postData() ?? '{}').kind === 'message.send', { timeout: 15000 });
// What a press on Send did: waited (To open on the typed name, focus in it,
// the composer saying why), or sent.
const sendOutcome = (p, at, notice) => Promise.race([
  until(p, ([a, n, words]) => !document.querySelector(a.panel).hidden && document.activeElement === document.querySelector(a.input) && document.querySelector(n).textContent === words,
    'Send waits', [at, notice, WAITING], 15000).then(() => 'waited', () => 'neither waited nor sent'),
  sendResponse(p).then(() => 'sent', () => 'neither waited nor sent')]);
async function runSending() {
  await check('stacked: in the Reader, Send pressed with a name typed in To and not named sends nothing, says so and opens To on it; with To cleared the whisper reaches its one agent alone', async () => {
    const p = await page('stacked'), at = NAMING.Reader, sends = sendsOf(p);
    // A message of its own to answer, so the topic the other engine's cases open is as it was.
    const words = `An agent message to answer in ${engine}.`, message = await agentMessage(`send-${engine}`, words);
    await open(p, message, words);
    await type(p, `Only for you, in ${engine}.`);
    const shown = () => p.evaluate(a => ({ chip: document.querySelector(a.chip).textContent, send: document.querySelector('#send-reply .send-word').textContent }), at);
    const whisper = { chip: `Whisper to ${agent} · only you two`, send: 'Whisper' };
    assert.deepEqual(await shown(), { chip: `Tell ${agent} · everyone here`, send: 'Tell' }, 'the reply starts as a Tell');
    await press(p, at.chip);
    await until(p, a => !document.querySelector(a.panel).hidden, 'the who panel', at);
    await press(p, `${at.panel} [data-intent="whisper"]`);
    await until(p, a => document.querySelector(a.chip).textContent.startsWith('Whisper '), 'Whisper chosen', at);
    assert.deepEqual(await shown(), whisper, 'the reply shows as a whisper');
    await p.locator(at.input).focus();
    await p.keyboard.insertText('warp');
    const before = await control({ method: 'deliveries_to', actors: [agent, 'warp'] });
    const outcome = sendOutcome(p, at, '#reader-notice');
    await press(p, '#send-reply');
    const done = await outcome, held = await control({ method: 'deliveries_to', actors: [agent, 'warp'] });
    assert.deepEqual({ done, sends: sends.length, delivered: [held[agent] - before[agent], held.warp - before.warp], to: await p.evaluate(s => document.querySelector(s).value, at.input), ...await shown() },
      { done: 'waited', sends: 0, delivered: [0, 0], to: 'warp', ...whisper }, 'Send waits: nothing is sent, warp is not named, and it still shows as a whisper');
    await p.locator(at.input).fill('');
    const sent = sendResponse(p);
    await press(p, '#send-reply');
    assert.equal((await (await sent).json()).status, 'committed', 'the reply is sent');
    const after = await control({ method: 'deliveries_to', actors: [agent, 'warp'] });
    assert.deepEqual([after[agent] - before[agent], after.warp - before.warp], [1, 0], 'the whisper reaches its one agent, and not warp');
    await close(p);
  });

  await check('stacked: in the New message composer, Send pressed with a name typed in To and not named sends nothing, says so and opens To on it', async () => {
    const p = await page('stacked'), at = NAMING['New message sheet'], sends = sendsOf(p);
    await until(p, () => !document.querySelector('#inline-composer').hidden, 'the topic\'s composer');
    await press(p, '#new-message');
    await until(p, () => document.querySelector('#new-message-sheet')?.open && document.activeElement?.id === 'inline-writing-body', 'the composer, ready to type');
    await p.keyboard.insertText('A new message.');
    const chipWas = await p.evaluate(s => document.querySelector(s).textContent, at.chip);
    await press(p, at.chip);
    await until(p, a => !document.querySelector(a.panel).hidden, 'the who panel', at);
    await p.locator(at.input).focus();
    await p.keyboard.insertText('warp');
    const before = await control({ method: 'deliveries_to', actors: ['warp'] });
    const outcome = sendOutcome(p, at, '#inline-notice');
    await press(p, '#inline-send');
    const done = await outcome, after = await control({ method: 'deliveries_to', actors: ['warp'] });
    assert.deepEqual({ done, sends: sends.length, delivered: after.warp - before.warp, chip: await p.evaluate(s => document.querySelector(s).textContent, at.chip) },
      { done: 'waited', sends: 0, delivered: 0, chip: chipWas }, 'Send waits: nothing is sent, and the chip says what it said');
    await close(p);
  });
}

// How the run ended, which tools/known_reds.py reads from native.json: every browser it opened is closed again
// (browserClosed); the planned phases, each a function run in each engine, and those that returned and whose browser
// then closed, in order; harnessCompleted, set only once every planned phase returned; and the fixture's own exit code
// and signal, held from its launch. Cleanup runs after an interruption too and writes native.json, but leaves
// harnessCompleted false and the run's own error in place.
const ENGINES = ['chromium', 'webkit'];
const PHASES = [[run], [runAnswering, () => control({ method: 'coordinator', operation_id: 'compose-coordinator', coordinator: agent, team: ANSWERING })], [runSending]];
const plannedPhases = PHASES.flatMap(([phase]) => ENGINES.map(name => `${phase.name}:${name}`)), completedPhases = [];
let browserClosed = true, harnessCompleted = false;
try {
  await seed();
  for (const [phase, before] of PHASES) {
    if (before) await before();
    for (engine of ENGINES) {
      browserClosed = false;
      browser = engine === 'chromium' ? await playwright.chromium.launch({ executablePath: chrome, headless: true }) : await playwright.webkit.launch({ headless: true });
      try { await phase(); } finally { await browser.close(); browserClosed = true; }
      completedPhases.push(`${phase.name}:${engine}`);
    }
  }
  harnessCompleted = true;
} finally {
  fixture.stdin.end();
  const { code: fixtureExitCode, signal: fixtureExitSignal } = await fixtureExit;
  await mkdir(evidence, { recursive: true });
  await writeFile(path.join(evidence, 'native.json'), JSON.stringify({ results, browserClosed, harnessCompleted, plannedPhases, completedPhases,
    fixtureExitCode, fixtureExitSignal, fixtureErrors: fixtureErrors(), measured, shots }, null, 2));
  const failed = results.filter(r => !r.passed);
  console.log(`${results.length - failed.length} passed, ${failed.length} failed`);
  for (const m of measured) console.log(`lines ${m.engine} ${m.shape} ${m.scheme} ${m.state}: ${m.lines} (${m.visible}px at ${m.lineHeight}px)`);
  // An interrupted run keeps its own error; asserting here would replace it.
  if (harnessCompleted) assert.equal(fixtureExitCode, 0, `the fixture exited ${fixtureExitCode ?? fixtureExitSignal}: ${fixtureErrors()}`);
}
assert.ok(results.length && results.every(result => result.passed), 'see native.json for exact failing assertions');

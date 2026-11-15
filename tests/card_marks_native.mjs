// A card's marks of what its message carries (item 127, docs/topic-reading.md),
// in Chrome for Testing and Safari's engine (Playwright's WebKit), against the
// isolated fixture: a quiet glyph beside the card's time for an image, for the
// person's own private note and for a reply they saved and have not sent; none
// for another reader's note or draft; each named and titled in words, none a
// control, each on the time's line and inside its card, in light and dark at
// 320, 375 and 390 points with touch and on a laptop. Then the marks follow
// the person's writing: a note saved and a reply saved in the Reader mark the
// card, sending the reply takes its mark away, and writing saved on another
// device or emptied there moves the marks while another reader's never does.
//
// Usage: node tests/card_marks_native.mjs <Chrome for Testing> <evidence dir> [case filter]
// A filter runs the cases whose names hold it, or any of its parts split by |;
// a case's name starts with its engine. AIM_PLAYWRIGHT_CORE names a
// playwright-core directory. The release check runs it as native-card-marks;
// tools/native.py card-marks [filter] runs it alone.
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
await mkdir(evidence, { recursive: true });

const fixture = spawn('/usr/bin/python3', ['tests/fixtures/ui_http.py', '--live', '--freshness', '--images', '--other-person'], { cwd: root });
const { control, exit: fixtureExit, errors: fixtureErrors } = fixtureControl(fixture);

// Waits on what the page says, read after each animation frame the page draws.
const until = async (p, expression, description, arg) => {
  try { return await p.waitForFunction(expression, arg, { polling: 'raf', timeout: 15000 }); }
  catch { throw Error(`Timed out: ${description}`); }
};
const WORDS = { image: 'Has an image', note: 'Your private note, which only you can see', reply: 'Your reply, saved and not sent' };
const card = id => `.message-card[data-id="${id}"]`;
// Each engine reads a topic of its own, so what one engine's cases change the other's never see.
const ENGINES = ['chromium', 'webkit'];
const ids = {};
async function seed() {
  const facts = await control({ method: 'ready' });
  await control({ method: 'navigation_topics', topics: ENGINES.map(engine => ({ id: `marks-${engine}`, title: 'Card marks' })) });
  for (const engine of ENGINES) {
    const topic = `marks-${engine}`, m = ids[engine] = {};
    const say = async (name, body, more = {}) => (await control({ method: 'agent_message', operation_id: `${topic}-${name}`, topic_id: topic, source: 'topic', body, ...more })).result.message_id;
    const write = (name, kind, message, body, more = {}) => control({ method: 'private_writing', operation_id: `${topic}-write-${name}`, topic_id: topic, kind, message_id: message, body, ...more });
    m.plain = await say('plain', 'Nothing carried, nothing kept.', { join: true });
    m.image = await say('image', 'The release page, as it looks now.', { attachments: [{ name: 'screen.png', image: 'screen.png' }] });
    m.note = await say('note', 'Check the logs before Friday.');
    m.reply = await say('reply', 'Which build should ship?');
    m.all = await say('all', 'Everything at once: two images, a note of mine and my reply, saved.', { attachments: [{ name: 'one.png', image: 'one.png' }, { name: 'one.gif', image: 'one.gif' }] });
    m.theirs = await say('theirs', 'Others keep their own notes and drafts on this one.');
    m.own = await say('own', 'My own message, with a picture.', { sender: 'person', attachments: [{ name: 'one.jpg', image: 'one.jpg' }] });
    await write('note', 'note', m.note, 'Ask about the log rotation.');
    await write('reply', 'draft', m.reply, 'The second one, I think.');
    await write('all-note', 'note', m.all, 'Keep this one.');
    await write('all-reply', 'draft', m.all, 'Looks right to me.');
    await write('own-note', 'note', m.own, 'Send the bigger copy later.');
    // Another person's note and saved reply, and the agent's own, on one message: none of them is the person's.
    await write('other-note', 'note', m.theirs, 'Theirs.', { sender: 'fixture-other-person', join: true });
    await write('other-draft', 'draft', m.theirs, 'Their unsent reply.', { sender: 'fixture-other-person' });
    await write('agent-note', 'note', m.theirs, 'The agent\'s own.', { sender: facts.agent });
    await write('agent-draft', 'draft', m.theirs, 'The agent\'s draft.', { sender: facts.agent });
  }
  return facts;
}
// What each card shows from the start: the kinds of its marks, in order.
const EXPECTED = { plain: [], image: ['image'], note: ['note'], reply: ['reply'], all: ['image', 'note', 'reply'], theirs: [], own: ['image', 'note'] };

let browser, engine, origin;
const results = [], contexts = [], shots = [];
async function open(url, { width = 1280, dark = false } = {}) {
  const phone = width < 760;
  const ctx = await browser.newContext({ viewport: phone ? { width, height: 740 } : { width, height: 900 }, hasTouch: phone, isMobile: phone,
    deviceScaleFactor: phone ? 2 : 1, colorScheme: dark ? 'dark' : 'light' });
  contexts.push(ctx);
  const p = await ctx.newPage(); p.errors = [];
  p.on('pageerror', error => p.errors.push(String(error)));
  await p.goto(origin + url);
  await until(p, () => document.body.dataset.ready === 'true', 'the page ready');
  return p;
}
async function picture(p, name) {
  const file = path.join(evidence, `${engine}-${name}.png`);
  await p.screenshot({ path: file, fullPage: true });
  shots.push(file);
}
async function check(name, run) {
  const title = `${engine} ${name}`;
  if (filter && !filter.split('|').some(part => title.includes(part))) return;
  try { await run(); results.push({ name: title, passed: true }); console.log('PASS', title); }
  catch (error) {
    for (const ctx of contexts) for (const p of ctx.pages()) await p.screenshot({ path: path.join(evidence, `failure-${results.length}.png`) }).catch(() => {});
    results.push({ name: title, passed: false, error: String(error.stack) }); console.log('FAIL', title, String(error));
  } finally { for (const ctx of contexts.splice(0)) await ctx.close(); }
  await writeFile(path.join(evidence, 'native.json'), JSON.stringify({ results, browserClosed: false, shots }, null, 2));
}

// Everything a case reads of one card's marks, measured in the page.
const readCard = (p, id) => p.evaluate(selector => {
  const card = document.querySelector(selector);
  if (!card) return null;
  const box = rect => ({ left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom, width: rect.width, height: rect.height });
  const author = card.querySelector(':scope > .message-author'), time = author.querySelector('.message-time time');
  const lines = time ? [...time.getClientRects()] : [];
  // A color's luminance and the contrast of two (WCAG 2), from the computed rgb() or rgba().
  const rgb = color => color.match(/[\d.]+/g).map(Number);
  const luminance = ([r, g, b]) => [r, g, b].map(v => (v /= 255) <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4).reduce((sum, v, i) => sum + v * [0.2126, 0.7152, 0.0722][i], 0);
  const face = rgb(getComputedStyle(card).backgroundColor);
  return {
    card: box(card.getBoundingClientRect()), author: box(author.getBoundingClientRect()),
    time: lines.length ? box(lines.at(-1)) : null,
    held: Boolean(card.querySelector('.message-time > .together > time + .card-carries')),
    controls: card.querySelectorAll('.card-carries button, .card-carries [role=button], .card-carries [tabindex], .card-carries a, .card-carries input').length,
    marks: [...card.querySelectorAll('.message-author .carry')].map(mark => {
      const style = getComputedStyle(mark), color = rgb(style.backgroundColor);
      const [hi, lo] = [luminance(color), luminance(face)].sort((a, b) => b - a);
      return { kind: mark.className.replace('carry carry-', ''), label: mark.getAttribute('aria-label'), title: mark.title, role: mark.getAttribute('role'),
        box: box(mark.getBoundingClientRect()), masked: /url\(/.test(style.webkitMaskImage || style.maskImage || ''),
        opaque: (color[3] ?? 1) > 0.9, contrast: (hi + 0.05) / (lo + 0.05) };
    }),
  };
}, card(id));

const VIEWS = [[320, false], [320, true], [375, false], [375, true], [390, false], [390, true], [1280, false], [1280, true]];

async function run() {
  const m = ids[engine], topic = `/?topic=marks-${engine}`;
  for (const [width, dark] of VIEWS) {
    const label = `${width}px ${dark ? 'dark' : 'light'}`;
    await check(`marks at ${label}: an image, your note and your saved reply each show a quiet named glyph beside the time; another's never does`, async () => {
      const p = await open(topic, { width, dark });
      await until(p, all => all.every(id => document.querySelector(`.message-card[data-id="${id}"]`)), 'every card drawn', Object.values(m));
      for (const [name, kinds] of Object.entries(EXPECTED)) {
        const seen = await readCard(p, m[name]);
        assert.deepEqual(seen.marks.map(mark => mark.kind), kinds, `${name}: its marks`);
        assert.equal(seen.controls, 0, `${name}: no mark is a control`);
        if (!kinds.length) continue;
        assert.ok(seen.held, `${name}: the marks are held to the time`);
        for (const mark of seen.marks) {
          const words = mark.kind === 'image' && name === 'all' ? 'Has 2 images' : WORDS[mark.kind];
          assert.deepEqual([mark.label, mark.title, mark.role], [words, words, 'img'], `${name} ${mark.kind}: named and titled in words`);
          assert.ok(mark.box.width >= 12 && mark.box.height >= 12 && mark.masked && mark.opaque, `${name} ${mark.kind}: a visible glyph`);
          assert.ok(mark.contrast >= 3, `${name} ${mark.kind}: the glyph stands out from the card's face (${mark.contrast.toFixed(2)}:1)`);
          assert.ok(mark.box.left >= seen.card.left && mark.box.right <= seen.card.right, `${name} ${mark.kind}: inside its card`);
          const middle = (mark.box.top + mark.box.bottom) / 2;
          assert.ok(middle >= seen.time.top && middle <= seen.time.bottom && mark.box.left >= seen.time.right - 1, `${name} ${mark.kind}: on the time's line, after it`);
        }
      }
      // The names a screen reader hears, as the page's accessibility tree gives them.
      assert.equal(await p.getByRole('img', { name: WORDS.image, exact: true }).count(), 2, 'the image card and the own card each say Has an image');
      assert.equal(await p.getByRole('img', { name: 'Has 2 images', exact: true }).count(), 1);
      assert.equal(await p.getByRole('img', { name: WORDS.note, exact: true }).count(), 3);
      assert.equal(await p.getByRole('img', { name: WORDS.reply, exact: true }).count(), 2);
      assert.equal(await p.locator(card(m.all)).getAttribute('aria-label'), null, 'the card keeps the name its words give it');
      if (width >= 760) {
        // No new row: a card with all three marks keeps a one-line author line, as a plain card's.
        const plain = await readCard(p, m.plain), all = await readCard(p, m.all);
        assert.ok(Math.abs(all.author.height - plain.author.height) < 1, `the marked line is as tall as a plain one (${all.author.height} vs ${plain.author.height})`);
      }
      assert.ok(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'nothing scrolls sideways');
      assert.deepEqual(p.errors, []);
      await p.evaluate(() => scrollTo(0, 0));
      await picture(p, `feed-${width}-${dark ? 'dark' : 'light'}`);
    });
  }

  await check('a note and a reply saved in the Reader mark the card, and sending the reply takes its mark away', async () => {
    const p = await open(topic, { width: 1280 });
    const marksOf = id => p.evaluate(selector => [...document.querySelectorAll(selector + ' .message-author .carry')].map(mark => mark.className.replace('carry carry-', '')), card(id));
    await until(p, selector => Boolean(document.querySelector(selector)), 'the plain card drawn', card(m.plain));
    assert.deepEqual(await marksOf(m.plain), []);
    await p.locator(card(m.plain)).click();
    await until(p, () => document.querySelector('#reader').open, 'the Reader open');
    // The note is offered in the + panel, beside the writing.
    await p.locator('#plus-button').click();
    await until(p, () => !document.querySelector('#plus-panel').hidden, 'the + panel open');
    await p.locator('#toggle-note').click();
    await until(p, () => document.activeElement?.id === 'writing-body', 'the note taking the writing');
    await p.keyboard.type('A thought of mine.');
    await p.keyboard.press('Meta+Enter');
    await until(p, () => document.querySelector('#toggle-note').textContent === 'Show note', 'the note saved, back on the reply');
    await until(p, selector => [...document.querySelectorAll(selector + ' .carry')].map(m => m.className).join() === 'carry carry-note', 'the card marks the note', card(m.plain));
    await p.locator('#writing-body').click();
    await p.keyboard.type('Sending this one.');
    await until(p, selector => [...document.querySelectorAll(selector + ' .carry')].map(m => m.className).join() === 'carry carry-note,carry carry-reply', 'the card marks the saved reply', card(m.plain));
    await p.keyboard.press('Meta+Enter');
    await until(p, selector => [...document.querySelectorAll(selector + ' .carry')].map(m => m.className).join() === 'carry carry-note', 'the sent reply takes its mark away, the note stays', card(m.plain));
    await until(p, () => [...document.querySelectorAll('.message-card .message-preview')].some(words => words.textContent.includes('Sending this one.')), 'the reply is a card of its own');
    // Now the message heads a stack, whose head row stands for it while its card is folded in: the row shows its marks.
    await until(p, selector => {
      const marks = [...document.querySelectorAll(selector + ' > .stack-head > .card-carries > .carry')];
      return marks.map(mark => mark.className).join() === 'carry carry-note' && marks.every(mark => mark.getBoundingClientRect().width >= 12);
    }, 'the stack\'s head row shows the note\'s mark, beside who started it', card(m.plain));
    assert.equal(await p.locator(card(m.plain) + ' > .stack-head .carry-note').getAttribute('aria-label'), WORDS.note);
    await p.keyboard.press('Escape');
    await until(p, () => !document.querySelector('#reader').open, 'the Reader closed');
    assert.deepEqual(await marksOf(m.plain), ['note']);
    assert.deepEqual(p.errors, []);
    await picture(p, 'reader-saved-and-sent');
  });

  await check('writing saved or emptied on another device moves the card\'s marks, and another reader\'s never does', async () => {
    const p = await open(topic, { width: 390, dark: true });
    const shows = kinds => until(p, ([selector, want]) => [...document.querySelectorAll(selector + ' .carry')].map(m => m.className.replace('carry carry-', '')).join() === want,
      `the image card shows ${kinds.join(', ') || 'no mark'}`, [card(m.image), kinds.join()]);
    await shows(['image']);
    const write = (name, kind, body, more = {}) => control({ method: 'private_writing', operation_id: `marks-${engine}-elsewhere-${name}`, topic_id: `marks-${engine}`, kind, message_id: m.image, body, ...more });
    await write('reply', 'draft', 'Written on my laptop.');
    await shows(['image', 'reply']);
    await write('note', 'note', 'And a note.');
    await shows(['image', 'note', 'reply']);
    // Another reader's note and draft first, then the person empties theirs: the card follows the person's alone.
    await write('other-note', 'note', 'Not yours.', { sender: 'fixture-other-person' });
    await write('other-draft', 'draft', 'Not yours either.', { sender: 'fixture-other-person' });
    await write('note-emptied', 'note', '   ');
    await shows(['image', 'reply']);
    await write('reply-emptied', 'draft', '');
    await shows(['image']);
    assert.deepEqual(p.errors, []);
    await picture(p, 'elsewhere-390-dark');
  });
}

let harnessCompleted = false, browserClosed = true;
try {
  origin = (await seed()).origin;
  for (engine of ENGINES) {
    browserClosed = false;
    browser = engine === 'chromium' ? await playwright.chromium.launch({ executablePath: chrome, headless: true }) : await playwright.webkit.launch({ headless: true });
    try { await run(); } finally { for (const ctx of contexts.splice(0)) await ctx.close(); await browser.close(); browserClosed = true; }
  }
  harnessCompleted = true;
} finally {
  fixture.stdin.end();
  const { code: fixtureExitCode, signal: fixtureExitSignal } = await fixtureExit;
  await writeFile(path.join(evidence, 'native.json'), JSON.stringify({ results, browserClosed, harnessCompleted, fixtureExitCode, fixtureExitSignal,
    fixtureErrors: fixtureErrors(), shots }, null, 2));
  const failed = results.filter(r => !r.passed);
  console.log(`${results.length - failed.length} passed, ${failed.length} failed`);
  if (harnessCompleted) assert.equal(fixtureExitCode, 0, `the fixture exited ${fixtureExitCode ?? fixtureExitSignal}: ${fixtureErrors()}`);
}
assert.ok(results.length && results.every(result => result.passed), 'see native.json for exact failing assertions');

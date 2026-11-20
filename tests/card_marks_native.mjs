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
// A stack's head row, which stands for its first message, keeps its tab two
// lines high whatever that message carries, starred, folded or open, at every
// width: on a narrow tab the marks give way, whole, before who began it, and
// the reply count always shows. A dossier at 390 points whose first message
// carries a picture alone, selected by touch, shows its image mark beside the
// whole name of who began it while its title bar's ⋯ stands beside the tab,
// past its curved corner (item 473). A whisper of the person's carries its
// marks in the name the browser gives its card, as every other card does.
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
const { control: fixtureRequest, exit: fixtureExit, errors: fixtureErrors } = fixtureControl(fixture);
// Explicit synthetic reasons satisfy today's message contract; never alter Core
// or the shared fixture to admit a root/reply without its own stated reason.
const control = request => fixtureRequest(request.method === 'agent_message' ? {
  ...(request.source === 'topic' && !request.reply_to
    ? { divergence_reason: 'A separate synthetic card for the native card-marks check' }
    : { reply_without_quote: 'This synthetic reply checks the whole card dossier' }),
  ...request,
} : request);

// Waits on what the page says, read after each animation frame the page draws.
const until = async (p, expression, description, arg) => {
  try { return await p.waitForFunction(expression, arg, { polling: 'raf', timeout: 15000 }); }
  catch { throw Error(`Timed out: ${description}`); }
};
// The name on the first line of Playwright's accessibility snapshot of a button, exactly, or null when that line is no
// named button. Playwright writes each line as a YAML key, `- button "<name as JSON>"`, and quotes the whole key when
// YAML would read part of it as syntax (": " in the name, as an image's "Image: screen.png" puts there):
// `- 'button "<name as JSON>"'`, a ' inside it doubled.
const buttonName = snapshot => {
  const line = snapshot.split('\n')[0], quoted = /^- '((?:[^']|'')*)'(?::|$)/.exec(line);
  const key = quoted ? quoted[1].replace(/''/g, "'") : line.startsWith('- ') ? line.slice(2) : '';
  const named = /^button ("(?:[^"\\]|\\.)*")(?: \[[^\]]*\])*:?$/.exec(key);
  return named ? JSON.parse(named[1]) : null;
};
// Both forms read back to the exact name, a ' and an escaped " in it kept; a line that is no button reads as none.
assert.equal(buttonName('- button "fixture-notebook-agent · 3:47 AM Has an image \\"A\\" picture.":\n  - text: x'), 'fixture-notebook-agent · 3:47 AM Has an image "A" picture.');
assert.equal(buttonName(`- 'button "It''s here · Has an image. Image: screen.png"':\n  - 'img "Image: screen.png"'`), "It's here · Has an image. Image: screen.png");
assert.equal(buttonName(`- 'img "Image: screen.png"'`), null);
assert.equal(buttonName('- text: button "not a button"'), null);
const WORDS = { image: 'Has an image', note: 'Your private note, which only you can see', reply: 'Your reply, saved and not sent' };
const card = id => `.message-card[data-id="${id}"]`;
// Each engine reads a topic of its own, so what one engine's cases change the other's never see.
const ENGINES = ['chromium', 'webkit'];
const ids = {}, headIds = {}, whisperIds = {}, pictureIds = {};
async function seed() {
  const facts = await control({ method: 'ready' });
  await control({ method: 'navigation_topics', topics: ENGINES.flatMap(engine => [{ id: `marks-${engine}`, title: 'Card marks' }, ...VIEWS.map((view, index) => ({ id: `heads-${engine}-${index}`, title: 'Head rows' })), { id: `whisper-${engine}`, title: 'A whisper' },
    ...THEMES.map(theme => ({ id: `picture-${engine}-${theme}`, title: 'A picture alone' }))]) });
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
    // Stacks of their own, in a topic for each view, since reading a topic on screen makes its heads no longer new:
    // each headed by a new message from the fixture's agent, whose name is 22 characters, and answered by another
    // person, so none is a quiet agents' dossier. One head carries an image, the person's note and their saved reply
    // and is starred; one carries the same and is folded; one carries an image alone; one carries nothing.
    // A whisper of the person's to the agent, with an image and their note, beside the agent's own message with an
    // image, in a topic of their own so the feed's counts of marks stay as they are.
    const whispers = `whisper-${engine}`, w = whisperIds[engine] = {};
    w.agent = (await control({ method: 'agent_message', operation_id: `${whispers}-agent`, topic_id: whispers, source: 'topic', join: true,
      body: 'A picture from the agent.', attachments: [{ name: 'screen.png', image: 'screen.png' }] })).result.message_id;
    w.whisper = (await control({ method: 'agent_message', operation_id: `${whispers}-whisper`, topic_id: whispers, source: 'topic', sender: 'person',
      addressees: [facts.agent], whisper: true, body: 'A whisper of mine with a picture.', attachments: [{ name: 'one.png', image: 'one.png' }] })).result.message_id;
    await control({ method: 'private_writing', operation_id: `${whispers}-note`, topic_id: whispers, kind: 'note', message_id: w.whisper, body: 'Mine.' });
    headIds[engine] = [];
    for (const index of VIEWS.keys()) {
      const heads = `heads-${engine}-${index}`, h = headIds[engine][index] = {};
      const head = async (name, body, more = {}) => (await control({ method: 'agent_message', operation_id: `${heads}-${name}`, topic_id: heads, source: 'topic', body, ...more })).result.message_id;
      h.starred = await head('starred', 'A starred head, with a picture and my writing.', { join: true, attachments: [{ name: 'screen.png', image: 'screen.png' }] });
      h.folded = await head('folded', 'A folded head, with a picture and my writing.', { attachments: [{ name: 'one.png', image: 'one.png' }] });
      h.one = await head('one', 'A head with a picture alone.', { attachments: [{ name: 'one.jpg', image: 'one.jpg' }] });
      h.bare = await head('bare', 'A head that carries nothing.');
      for (const name of ['starred', 'folded']) {
        await control({ method: 'private_writing', operation_id: `${heads}-note-${name}`, topic_id: heads, kind: 'note', message_id: h[name], body: 'Mine.' });
        await control({ method: 'private_writing', operation_id: `${heads}-draft-${name}`, topic_id: heads, kind: 'draft', message_id: h[name], body: 'My reply.' });
      }
      await control({ method: 'stack_act', sender: facts.actor, kind: 'message.star', message_id: h.starred, operation_id: `${heads}-star`, args: { starred: true } });
      await control({ method: 'stack_act', sender: facts.actor, kind: 'message.fold', message_id: h.folded, operation_id: `${heads}-fold`, args: { folded: true } });
      for (const [order, name] of ['starred', 'folded', 'one', 'bare'].entries())
        await control({ method: 'agent_message', operation_id: `${heads}-answer-${name}`, topic_id: heads, reply_to: h[name], body: 'An answer from someone else.', sender: 'fixture-other-person', join: order === 0 });
    }
    // A dossier of its own for each theme, as the 'one' head above (a new message from the agent, whose name is 22
    // characters, carrying a picture alone, answered by another person), read only by the case that selects it.
    pictureIds[engine] = {};
    for (const theme of THEMES) {
      const topic = `picture-${engine}-${theme}`;
      const head = (await control({ method: 'agent_message', operation_id: `${topic}-head`, topic_id: topic, source: 'topic', join: true,
        body: 'A picture of the shelf, nothing more.', attachments: [{ name: 'one.png', image: 'one.png' }] })).result.message_id;
      await control({ method: 'agent_message', operation_id: `${topic}-answer`, topic_id: topic, reply_to: head, body: 'A word back about the shelf.', sender: 'fixture-other-person', join: true });
      pictureIds[engine][theme] = head;
    }
  }
  return facts;
}
// What each card shows from the start: the kinds of its marks, in order.
const EXPECTED = { plain: [], image: ['image'], note: ['note'], reply: ['reply'], all: ['image', 'note', 'reply'], theirs: [], own: ['image', 'note'] };

let browser, engine, origin;
const results = [], contexts = [], shots = [];
async function open(url, { width = 1280, dark = false, fixedTime = null } = {}) {
  const phone = width < 760;
  const ctx = await browser.newContext({ viewport: phone ? { width, height: 740 } : { width, height: 900 }, hasTouch: phone, isMobile: phone,
    deviceScaleFactor: phone ? 2 : 1, colorScheme: dark ? 'dark' : 'light' });
  contexts.push(ctx);
  const p = await ctx.newPage(); p.errors = [];
  p.on('pageerror', error => p.errors.push(String(error)));
  // Item 634: control the formatted label, not the date or Core's clock.
  if (fixedTime) await p.addInitScript(label => { Date.prototype.toLocaleTimeString = () => label; }, fixedTime);
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
  // Where the line's own words and glyphs end, and where what follows the line begins: an empty line wrapped
  // inside it (a hidden control alone on a line of its own), or a row pushed below it, shows as a gap a plain card
  // does not have. Only what shows counts: words whose element is visible, and the glyphs.
  const walker = document.createTreeWalker(author, NodeFilter.SHOW_TEXT), inked = [];
  for (let text = walker.nextNode(); text; text = walker.nextNode()) {
    if (!text.textContent.trim() || getComputedStyle(text.parentElement).visibility !== 'visible') continue;
    const range = document.createRange(); range.selectNodeContents(text); inked.push(...range.getClientRects());
  }
  inked.push(...[...author.querySelectorAll('.carry')].map(mark => mark.getBoundingClientRect()));
  const next = author.nextElementSibling;
  const parts = [...author.querySelectorAll('*')].map(el => `${el.tagName.toLowerCase()}.${el.className}@${Math.round(el.getBoundingClientRect().top)}+${Math.round(el.getBoundingClientRect().height)}`).join(' ');
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
    star: card.querySelector(':scope > .message-author > .card-star') ? box(card.querySelector(':scope > .message-author > .card-star').getBoundingClientRect()) : null,
    inkBottom: Math.max(...inked.map(rect => rect.bottom)), below: next ? next.getBoundingClientRect().top - author.getBoundingClientRect().bottom : null,
    shape: `${author.getBoundingClientRect().height}px: ${parts}; then ${next ? next.tagName.toLowerCase() + '.' + next.className : 'nothing'}`,
  };
}, card(id));

// Everything a case reads of a stack's head row: the tab's box, each part that shows (a part a screen reader alone
// hears, and the pen a touch screen hides, take no room), each of the marks and the box that holds them, and who began it.
const readHead = (p, id) => p.evaluate(selector => {
  const row = document.querySelector(selector + ' > .stack-head');
  if (!row) return null;
  const box = rect => ({ left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom, width: rect.width, height: rect.height });
  // A part laid out by its children alone (display: contents) is its children.
  const parts = [...row.children].flatMap(part => (getComputedStyle(part).display === 'contents' ? [...part.children] : [part]))
    .filter(part => !part.matches('.stack-hide') && getComputedStyle(part).display !== 'none')
    .map(part => ({ part: part.className, box: box(part.getBoundingClientRect()), text: part.textContent }));
  // The reply count's words ("1 reply"), and whether they read whole: inside what clips them, with room left for the
  // ellipsis when that box is cut short, and inside the tab.
  const meta = row.querySelector(':scope > .stack-meta'), text = meta && document.createTreeWalker(meta, NodeFilter.SHOW_TEXT).nextNode();
  let count = null;
  if (text) {
    const range = document.createRange(); range.selectNodeContents(text);
    const words = range.getBoundingClientRect();
    let clip = text.parentElement;
    // A part laid out by its children alone (display: contents) has no box, so it clips nothing.
    while (clip !== row && (getComputedStyle(clip).overflowX === 'visible' || getComputedStyle(clip).display === 'contents')) clip = clip.parentElement;
    const edge = clip.getBoundingClientRect(), cut = clip.scrollWidth > clip.clientWidth + 0.5, style = getComputedStyle(clip);
    const pen = document.createElement('canvas').getContext('2d');
    pen.font = `${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
    const room = Math.min(edge.right - (cut ? pen.measureText('\u2026').width : 0), row.getBoundingClientRect().right);
    count = { text: text.textContent, words: box(words), whole: words.width > 0 && words.left >= edge.left - 0.5 && words.right <= room + 0.5 };
  }
  const held = row.querySelector(':scope > .card-carries'), who = row.querySelector(':scope > .stack-who');
  return {
    row: box(row.getBoundingClientRect()), parts, held: held ? box(held.getBoundingClientRect()) : null,
    marks: [...row.querySelectorAll('.carry')].map(mark => ({ kind: mark.className.replace('carry carry-', ''), label: mark.getAttribute('aria-label'), box: box(mark.getBoundingClientRect()) })), count,
    who: { text: who.textContent, title: who.title, cut: who.scrollWidth > who.clientWidth + 0.5, width: who.getBoundingClientRect().width },
    shape: parts.map(part => `${part.part}@${Math.round(part.box.left)},${Math.round(part.box.top)}-${Math.round(part.box.right)},${Math.round(part.box.bottom)}`).join(' '),
  };
}, card(id));
// The lines a head row's parts stand on, by their tops.
const linesOf = parts => parts.map(part => Math.round(part.box.top)).filter((top, index, all) => all.findIndex(other => Math.abs(other - top) < 3) === index).length;

const VIEWS = [[320, false], [320, true], [375, false], [375, true], [390, false], [390, true], [1280, false], [1280, true]];
const THEMES = ['light', 'dark'];

async function run() {
  const m = ids[engine], topic = `/?topic=marks-${engine}`;
  for (const [width, dark] of VIEWS) {
    const label = `${width}px ${dark ? 'dark' : 'light'}`;
    await check(`marks at ${label}: an image, your note and your saved reply each show a quiet named glyph beside the time; another's never does`, async () => {
      const p = await open(topic, { width, dark, fixedTime: '12:34 AM' });
      await until(p, all => all.every(id => document.querySelector(`.message-card[data-id="${id}"]`)), 'every card drawn', Object.values(m));
      // A fixed short time is a negative control for the narrow plain line.
      const short = await open(topic, { width, dark, fixedTime: '1:11 AM' });
      await until(short, selector => document.querySelector(selector + ' > .message-author'), 'the short-time plain card', card(m.plain));
      const shortCard = await readCard(short, m.plain);
      const wideCard = await readCard(p, m.plain);
      await writeFile(path.join(evidence, `${engine}-time-${width}-${dark ? 'dark' : 'light'}.json`), JSON.stringify({ wide: wideCard, short: shortCard }, null, 2));
      if (width === 320) await p.locator(card(m.plain)).screenshot({ path: path.join(evidence, `${engine}-plain-${dark ? 'dark' : 'light'}.png`) });
      assert.equal(await short.locator(card(m.plain) + ' .message-time time').textContent(), '1:11 AM');
      assert.equal(await p.locator(card(m.plain) + ' .message-time time').textContent(), '12:34 AM');
      assert.ok(shortCard.author.height < 24, `short time: the plain author line stays single (${shortCard.shape})`);
      assert.ok(wideCard.author.height < 24, `wide time at ${width}: the plain author and full time stay on one line (${wideCard.shape})`);
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
      assert.equal(await p.locator('.message-card > .message-author').getByRole('img', { name: WORDS.image, exact: true }).count(), 2, 'the image card and the own card each say Has an image');
      assert.equal(await p.locator('.message-card > .message-author').getByRole('img', { name: 'Has 2 images', exact: true }).count(), 1);
      assert.equal(await p.locator('.message-card > .message-author').getByRole('img', { name: WORDS.note, exact: true }).count(), 3);
      assert.equal(await p.locator('.message-card > .message-author').getByRole('img', { name: WORDS.reply, exact: true }).count(), 2);
      assert.equal(await p.locator(card(m.all)).getAttribute('aria-label'), null, 'the card keeps the name its words give it');
      // No empty line and no pushed row, at any width: a marked card's line ends where its words and glyphs end, and
      // what follows it starts as far below as on a plain card.
      const plainCard = await readCard(p, m.plain);
      for (const name of Object.keys(EXPECTED)) {
        const seen = await readCard(p, m[name]);
        assert.ok(seen.author.bottom - seen.inkBottom < 4, `${name}: its line holds no line that shows nothing (${seen.shape})`);
        // The star, shown when the card is lit, has its place in the line inside the card, beside the time's last line.
        if (seen.star) assert.ok(seen.star.right <= seen.card.right && seen.star.bottom > seen.time.top && seen.star.top < seen.time.bottom, `${name}: the star's place is inside the card, on the time's line (${seen.shape})`);
        assert.ok(Math.abs(seen.below - plainCard.below) < 1, `${name}: what follows its line starts as on a plain card (${seen.below} vs ${plainCard.below}; ${seen.shape})`);
      }
      if (width >= 760) {
        // No new row: a card with all three marks keeps a one-line author line, as a plain card's.
        const plain = await readCard(p, m.plain), all = await readCard(p, m.all);
        assert.ok(Math.abs(all.author.height - plain.author.height) < 1, `the marked line is as tall as a plain one (${all.author.height} vs ${plain.author.height})`);
      }
      assert.ok(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'nothing scrolls sideways');
      // Keep the star's reserved place when native input selects a plain card.
      const author = p.locator(card(m.plain) + ' > .message-author');
      await author.scrollIntoViewIfNeeded();
      const before = await readCard(p, m.plain);
      if (width < 760) await author.tap(); else await author.click();
      await until(p, selector => getComputedStyle(document.querySelector(selector + ' > .message-author > .card-star')).visibility === 'visible', 'selecting reveals the plain card star', card(m.plain));
      const after = await readCard(p, m.plain);
      const layout = seen => [seen.author.height, seen.time.left - seen.card.left, seen.time.top - seen.card.top,
        seen.star.left - seen.card.left, seen.star.top - seen.card.top];
      assert.deepEqual(layout(after), layout(before), 'revealing the star leaves its reserved place and time unchanged');
      const star = p.locator(card(m.plain) + ' > .message-author > .card-star');
      for (const starred of [true, false]) {
        const response = p.waitForResponse(answer => {
          try { return answer.request().postDataJSON()?.kind === 'message.star'; } catch { return false; }
        });
        if (width < 760) await star.tap(); else await star.click();
        const answer = await response, command = answer.request().postDataJSON();
        assert.equal(command.target.message_id, m.plain, 'the native star act keeps its message target');
        assert.equal(command.args.starred, starred);
        assert.equal((await answer.json()).status, 'committed');
        await until(p, ([selector, want]) => document.querySelector(selector)?.getAttribute('aria-pressed') === String(want),
          'the recorded star act is drawn', [card(m.plain) + ' > .message-author > .card-star', starred]);
      }
      assert.deepEqual(short.errors, []);
      assert.deepEqual(p.errors, []);
      await p.evaluate(() => scrollTo(0, 0));
      await picture(p, `feed-${width}-${dark ? 'dark' : 'light'}`);
    });
  }

  // The name a screen reader hears for a card, as the browser computes it: Chromium's own accessibility tree, and in
  // Safari's engine the name Playwright's accessibility snapshot gives the card's button (buttonName).
  const accessibleName = async (p, selector) => {
    if (engine === 'chromium') {
      const cdp = await p.context().newCDPSession(p);
      try {
        const { result } = await cdp.send('Runtime.evaluate', { expression: `document.querySelector(${JSON.stringify(selector)})` });
        const { node } = await cdp.send('DOM.describeNode', { objectId: result.objectId });
        await cdp.send('Accessibility.enable');
        const { nodes } = await cdp.send('Accessibility.getFullAXTree');
        const found = nodes.find(entry => entry.backendDOMNodeId === node.backendNodeId);
        assert.ok(found, `${selector} is in the accessibility tree`);
        return String(found.name?.value ?? '');
      } finally { await cdp.detach(); }
    }
    const snapshot = await p.locator(selector).ariaSnapshot(), name = buttonName(snapshot);
    assert.ok(name !== null, `${selector} is a named button: ${snapshot}`);
    return name;
  };
  await check('whisper: a whisper card with an image and a note says its marks in the name the browser gives it, as another card does', async () => {
    const w = whisperIds[engine], p = await open(`/?topic=whisper-${engine}`, { width: 390 });
    const marked = (id, count) => until(p, ([selector, want]) => document.querySelectorAll(selector + ' > .message-author .carry').length === want,
      `${count} marks on the card`, [card(id), count]);
    await marked(w.agent, 1);
    await marked(w.whisper, 2);
    const agent = await accessibleName(p, card(w.agent));
    assert.ok(agent.includes(WORDS.image), `another card's name holds its mark: ${agent}`);
    const whisper = await accessibleName(p, card(w.whisper));
    assert.ok(whisper.includes('whisper to'), `the whisper card keeps its own words: ${whisper}`);
    assert.ok(whisper.includes(WORDS.image) && whisper.includes(WORDS.note), `the whisper card's name holds its marks: ${whisper}`);
    // The note emptied on another device: its mark leaves the card and the card's name.
    await control({ method: 'private_writing', operation_id: `whisper-${engine}-note-emptied`, topic_id: `whisper-${engine}`, kind: 'note', message_id: w.whisper, body: '' });
    await marked(w.whisper, 1);
    const emptied = await accessibleName(p, card(w.whisper));
    assert.ok(emptied.includes(WORDS.image) && !emptied.includes(WORDS.note), `the whisper card's name follows its marks: ${emptied}`);
    assert.deepEqual(p.errors, []);
    await picture(p, 'whisper-390');
  });

  // The head row is a tab two lines high: the short name, then one run that never wraps to a third, whatever the head
  // carries and whatever state it is in. What gives way, in order: the count and who replied, then the marks (whole
  // glyphs, dropped from the end), then who began it (cut short, its whole name in its tooltip).
  for (const [index, [width, dark]] of VIEWS.entries()) {
    const label = `${width}px ${dark ? 'dark' : 'light'}`;
    await check(`head rows at ${label}: a starred or folded new head with every mark, one with an image alone and one with none stay two lines inside the tab, each showing its reply count`, async () => {
      const p = await open(`/?topic=heads-${engine}-${index}`, { width, dark }), h = headIds[engine][index];
      await until(p, ([starred, ...rest]) => [starred, ...rest].every(id => document.querySelector(`.message-card[data-id="${id}"] > .stack-head > .stack-who`))
        && document.querySelectorAll(`.message-card[data-id="${starred}"] > .stack-head .carry`).length === 3, 'every head row drawn, the starred one with its marks', [h.starred, h.folded, h.one, h.bare]);
      const inTab = async (name, state) => {
        const seen = await readHead(p, h[name]);
        const where = `${name} (${state}): ${seen.shape}`;
        assert.ok(linesOf(seen.parts) <= 2, `${where}: two lines, never a third`);
        for (const part of seen.parts) assert.ok(part.box.top >= seen.row.top - 0.5 && part.box.bottom <= seen.row.bottom + 0.5 && part.box.right <= seen.row.right + 0.5, `${where}: ${part.part} inside the tab`);
        // A mark shows whole, or not at all.
        const shown = seen.marks.filter(mark => mark.box.left >= seen.held.left - 0.5 && mark.box.right <= seen.held.right + 0.5 && mark.box.bottom <= seen.held.bottom + 0.5 && mark.box.top >= seen.held.top - 0.5);
        for (const mark of seen.marks) if (!shown.includes(mark)) assert.ok(mark.box.top >= seen.held.bottom - 0.5 || mark.box.left >= seen.held.right - 0.5 || mark.box.right <= seen.held.left + 0.5, `${where}: the ${mark.kind} mark shows whole or not at all`);
        for (const mark of shown) assert.ok(mark.box.width >= 12 && mark.box.height >= 12, `${where}: the ${mark.kind} mark a visible glyph`);
        // Who began it gives way last, and its whole name stays in its tooltip.
        if (seen.who.cut) assert.equal(shown.length, 0, `${where}: the marks give way before who began it`);
        assert.equal(seen.who.title, seen.who.text, `${where}: who began it is titled in full`);
        // The reply count always shows, as it did before the marks: they give way before it.
        assert.ok(seen.count?.whole, `${where}: the reply count (${seen.count?.text}) reads whole`);
        return { seen, shown };
      };
      const starred = await inTab('starred', 'new and starred');
      assert.ok(starred.seen.parts.some(part => part.part === 'stack-new') && starred.seen.parts.some(part => part.part === 'stack-star'), 'the starred head is new and starred');
      const folded = await inTab('folded', 'new and folded');
      // The head row is the dossier's title and says nothing of the fold (item 471): the folded first message is its own row under it.
      assert.ok(!folded.seen.parts.some(part => part.part === 'stack-folded'), 'the folded head\'s title row says nothing of the fold');
      // Where there is room, a phone's tab shows the marks too: at 390 an image alone beside the whole name, New and the
      // count. At 375 the count leaves less room than a glyph, and the mark gives way before it; at 320 the 22
      // characters of the name give way to the count too, cut short (its whole name in its tooltip).
      const one = await inTab('one', 'an image alone');
      assert.deepEqual(one.shown.map(mark => mark.kind), width >= 390 ? ['image'] : [], `the image alone shows whole where it fits (${one.seen.shape})`);
      if (width >= 375) assert.equal(one.seen.who.cut, false, 'beside one mark, who began it reads whole');
      const bare = await inTab('bare', 'no marks');
      assert.equal(bare.seen.held, null, 'a head that carries nothing has no marks');
      if (width >= 375) assert.equal(bare.seen.who.cut, false, 'with no marks, who began it reads whole beside New');
      if (width >= 760) {
        // On a laptop there is room: every mark shows, and the name reads whole.
        for (const { seen, shown } of [starred, folded]) {
          assert.deepEqual(shown.map(mark => mark.kind), ['image', 'note', 'reply'], `every mark shows on a laptop (${seen.shape})`);
          assert.equal(seen.who.cut, false, 'who began it reads whole on a laptop');
        }
      }
      // Opened to all its messages, the starred stack's row holds the same: its hide words are for a screen reader only.
      await p.locator(`.reply-stack:has(.message-card[data-id="${h.starred}"]) > .stack-toggle`).click();
      await until(p, id => document.querySelector(`.reply-stack:has(.message-card[data-id="${id}"]) > .stack-toggle`).dataset.state === 'open'
        && document.querySelector(`.message-card[data-id="${id}"] > .stack-head > .stack-hide`), 'the starred stack open to all its messages', h.starred);
      await inTab('starred', 'open');
      assert.ok(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'nothing scrolls sideways');
      assert.deepEqual(p.errors, []);
      await writeFile(path.join(evidence, `${engine}-heads-${width}-${dark ? 'dark' : 'light'}.json`), JSON.stringify({ starred, folded, one, bare }, null, 2));
      await p.evaluate(() => scrollTo(0, 0));
      await picture(p, `heads-${width}-${dark ? 'dark' : 'light'}`);
    });
  }

  // Item 473: the title bar's glyphs take their room from the paper past the tab's curved corner, never from the tab.
  // At 390 a dossier whose first message carries a picture alone shows its image mark beside the whole name of who
  // began it, at rest and once a tap selects it and its title bar shows ⋯: ⋯ is 44px, named with its tooltip, inside
  // the window, beside the tab and clear of its corner, on the tab's line, and a press at its centre lands on it.
  for (const theme of THEMES) {
    await check(`picture-only head row at 390px ${theme}: selected by touch, the dossier keeps its image mark and who began it whole while its title bar's ⋯ stands beside the tab, past its corner`, async () => {
      const p = await open(`/?topic=picture-${engine}-${theme}`, { width: 390, dark: theme === 'dark' }), id = pictureIds[engine][theme], selector = card(id);
      await until(p, sel => document.querySelector(`${sel} > .stack-head > .stack-who`) && document.querySelectorAll(`${sel} > .stack-head .carry`).length === 1, 'the head row drawn with its mark', selector);
      // What a person reads in the row: its parts on two lines inside the tab, the image mark whole, who began it whole,
      // and the reply count whole.
      const row = async state => {
        const seen = await readHead(p, id), where = `${state}: ${seen.shape}`;
        assert.ok(linesOf(seen.parts) <= 2, `${where}: two lines, never a third`);
        const shown = seen.marks.filter(mark => mark.box.left >= seen.held.left - 0.5 && mark.box.right <= seen.held.right + 0.5 && mark.box.top >= seen.held.top - 0.5 && mark.box.bottom <= seen.held.bottom + 0.5);
        assert.deepEqual(shown.map(mark => [mark.kind, mark.label]), [['image', WORDS.image]], `${where}: the image mark shows whole, named`);
        assert.ok(shown[0].box.width >= 12 && shown[0].box.height >= 12, `${where}: a visible glyph`);
        assert.equal(seen.who.cut, false, `${where}: who began it reads whole`);
        assert.ok(seen.count?.whole, `${where}: the reply count reads whole`);
        return seen;
      };
      // The title bar's ⋯ and the tab's corner, as drawn.
      const tools = () => p.evaluate(sel => {
        const section = document.querySelector(sel).closest('.reply-stack'), tools = section.querySelector(':scope > .stack-tools'), menu = tools.querySelector(':scope > [data-tool=menu]');
        const tab = section.querySelector(':scope > [data-id] .stack-head').getBoundingClientRect(), m = menu.getBoundingClientRect(), style = getComputedStyle(tools);
        const corner = parseFloat(getComputedStyle(section).getPropertyValue('--stack-r-tab')) * parseFloat(getComputedStyle(document.documentElement).fontSize);
        const hit = document.elementFromPoint(m.left + m.width / 2, m.top + m.height / 2);
        return { shown: style.visibility === 'visible' && Number(style.opacity) === 1, tab: { left: tab.left, right: tab.right, top: tab.top, bottom: tab.bottom }, corner,
          menu: { left: m.left, right: m.right, top: m.top, bottom: m.bottom, width: m.width, height: m.height, label: menu.getAttribute('aria-label'), title: menu.title, text: menu.textContent },
          others: [...tools.children].filter(b => b !== menu && b.getClientRects().length).length, hit: Boolean(hit && menu.contains(hit)), width: innerWidth, sideways: document.documentElement.scrollWidth > innerWidth };
      }, selector);
      await row('at rest');
      assert.equal((await tools()).shown, false, 'at rest the title bar shows no glyph');
      // A tap on who began it selects the dossier, as a person does; its title bar then shows ⋯.
      await p.locator(`${selector} > .stack-head > .stack-who`).tap();
      await until(p, sel => (t => t && getComputedStyle(t).opacity === '1')(document.querySelector(sel).closest('.reply-stack').querySelector(':scope > .stack-tools')), 'the tap selects the dossier and its title bar shows ⋯', selector);
      const seen = await row('selected'), t = await tools(), where = JSON.stringify(t);
      assert.deepEqual([t.menu.label, t.menu.title, t.menu.text, t.others], ['More for this dossier', 'More for this dossier', '⋯', 0], `⋯ alone, named with its tooltip: ${where}`);
      assert.ok(t.menu.width >= 44 && t.menu.height >= 44, `⋯ is 44px to touch: ${where}`);
      assert.ok(t.menu.left >= t.tab.right + t.corner - 0.5, `⋯ stands beside the tab, past its curved corner: ${where}`);
      assert.ok(t.menu.right <= t.width + 0.5 && t.menu.top >= t.tab.top - 0.5 && t.menu.bottom <= t.tab.bottom + 0.5, `⋯ is inside the window, on the tab's line: ${where}`);
      assert.ok(t.hit, `a press at ⋯'s centre lands on it: ${where}`);
      assert.ok(seen.row.right <= t.menu.left, `nothing of the tab is under ⋯: ${where}`);
      assert.equal(t.sideways, false, 'nothing scrolls sideways');
      assert.deepEqual(p.errors, []);
      await writeFile(path.join(evidence, `${engine}-picture-390-${theme}.json`), JSON.stringify({ seen, tools: t }, null, 2));
      await p.evaluate(() => scrollTo(0, 0));
      await picture(p, `picture-390-${theme}`);
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
    await until(p, selector => [...document.querySelectorAll(selector + ' > .message-author .carry')].map(m => m.className).join() === 'carry carry-note', 'the card marks the note', card(m.plain));
    await p.locator('#writing-body').click();
    await p.keyboard.type('Sending this one.');
    await until(p, selector => [...document.querySelectorAll(selector + ' > .message-author .carry')].map(m => m.className).join() === 'carry carry-note,carry carry-reply', 'the card marks the saved reply', card(m.plain));
    await p.keyboard.press('Meta+Enter');
    // The card's own line: its send accepted makes the message a stack's head at once, whose row shows its marks too (below).
    await until(p, selector => [...document.querySelectorAll(selector + ' > .message-author .carry')].map(m => m.className).join() === 'carry carry-note', 'the sent reply takes its mark away, the note stays', card(m.plain));
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
    // A reply saved, then emptied, on another device moves the head row's marks as it stands, without the stacks arranged again.
    const headRow = kinds => until(p, ([selector, want]) => [...document.querySelectorAll(selector + ' > .stack-head > .card-carries > .carry')].map(mark => mark.className.replace('carry carry-', '')).join() === want,
      `the head row shows ${kinds.join(', ') || 'no mark'}`, [card(m.plain), kinds.join()]);
    const write = (name, body) => control({ method: 'private_writing', operation_id: `marks-${engine}-head-${name}`, topic_id: `marks-${engine}`, kind: 'draft', message_id: m.plain, body });
    await write('saved', 'Another reply, begun on my phone.');
    await headRow(['note', 'reply']);
    await write('emptied', '');
    await headRow(['note']);
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
  await writeFile(path.join(evidence, 'native.json'), JSON.stringify({ results, browserClosed, harnessCompleted, fixtureExitCode, fixtureExitSignal, fixturePid: fixture.pid, origin,
    fixtureErrors: fixtureErrors(), shots }, null, 2));
  const failed = results.filter(r => !r.passed);
  console.log(`${results.length - failed.length} passed, ${failed.length} failed`);
  if (harnessCompleted) assert.equal(fixtureExitCode, 0, `the fixture exited ${fixtureExitCode ?? fixtureExitSignal}: ${fixtureErrors()}`);
}
assert.ok(results.length && results.every(result => result.passed), 'see native.json for exact failing assertions');

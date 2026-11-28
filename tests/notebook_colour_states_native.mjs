import assert from 'node:assert/strict';
import {execFileSync, spawn} from 'node:child_process';
import {mkdir, readFile, writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import net from 'node:net';
import {fixtureControl} from './fixture_control.mjs';
import {readerFromPage} from './message_palette_1091_gestures.mjs';
import {withCardDetails} from '../web/card-details.mjs';

const {chromium} = await import(process.env.AIM_PLAYWRIGHT_CORE);
const [out, spec, baselineFile] = process.argv.slice(2);
const baseline = process.env.AIM_COLOUR_BASELINE === '1';
const tokens = JSON.parse(await readFile(spec + '/tokens.json', 'utf8'));
const previous = baselineFile && JSON.parse(await readFile(baselineFile, 'utf8'));
const materials = Object.values(tokens.materials);
const [bench, ends, dock, paperRails, paperSheet, paperTiles] = materials;
const hues = tokens.notebook_colours_1028.hues;
const keys = Object.keys(hues);
const rgb = hex => 'rgb(' + hex.slice(1, 7).match(/../g).map(x => parseInt(x, 16)).join(', ') + ')';
const hash = buffer => createHash('sha256').update(buffer).digest('hex');
const files = ['aim.css', 'look.css', 'notebook-menu.css', 'rails.css', 'rail-dense.css', 'stack-look.css',
  'notebook-menu.mjs', 'notebook-sheet.mjs', 'things-rail.mjs'];
const heads = Object.fromEntries(await Promise.all(files.map(async name => [name, hash(await readFile('web/' + name))])));
await mkdir(out, {recursive: true});
const result = {head: execFileSync('git', ['rev-parse', 'HEAD'], {encoding: 'utf8'}).trim(), files: heads, rows: []};
const fixture = spawn('/usr/bin/python3', ['-B', 'tests/fixtures/ui_http.py', '--freshness', '--agent-colors', '--other-person']);
const {control, exit, errors} = fixtureControl(fixture);
const ready = 'body[data-ready=true]';
const menuTokens = {
  bookends: ['#0b0f10', '#1a1d1e', '#262a2a', '#b1b7b4'],
  dark: ['#f2eee5', '#ebe7de', '#dcd8cf', '#54504b'],
  light: ['#fbf8f1', '#f4f1ea', '#e4e1da', '#56534d']
};
const style = (loc, pseudo) => loc.evaluate((el, pseudo) => {
  const css = getComputedStyle(el, pseudo);
  const names = ['backgroundColor', 'backgroundImage', 'color', 'borderTopColor', 'borderTopWidth',
    'boxShadow', 'outlineStyle', 'outlineColor', 'outlineOffset', 'outlineWidth'];
  return {...Object.fromEntries(names.map(name => [name, css[name]])),
    ink: css.getPropertyValue('--ink').trim(), muted: css.getPropertyValue('--muted').trim(),
    agentHover: css.getPropertyValue('--agent-hover').trim(), focusVisible: el.matches(':focus-visible')};
}, pseudo);

function equal(value, want, label) {
  assert.equal(value, want, label);
}

function ring(paint, hex, label) {
  equal(paint.boxShadow, rgb(hex) + ' 0px 0px 0px 2px', label);
  equal(paint.outlineStyle, 'none', label + ' has one ring');
}

async function moveToWords(page, locator) {
  await locator.scrollIntoViewIfNeeded();
  const point = await locator.evaluate(el => {
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    let node;
    while (node = walker.nextNode()) {
      const start = node.data.search(/\S/);
      if (start < 0) continue;
      const range = document.createRange();
      range.setStart(node, start);
      range.setEnd(node, Math.min(start + 2, node.length));
      const box = range.getBoundingClientRect();
      if (box.width > 0) return {x: box.x + box.width / 2, y: box.y + box.height / 2};
    }
    throw Error('Card has no visible words');
  });
  await page.mouse.move(point.x, point.y);
}

async function inspectMenu(page, owner, expect) {
  await owner.click({button: 'right'});
  const palette = page.getByRole('menu', {name: 'This page', exact: true});
  await palette.waitFor();
  assert.ok(await palette.evaluate(el => el.classList.contains('notebook-surface')), 'this entry uses the Notebook surface');
  const checked = palette.locator('[aria-checked=true]');
  const other = palette.locator('button:not([disabled]):not([aria-checked=true])').first();
  await other.hover();
  const surface = await style(palette), hover = await style(other);
  const checkedPaint = await style(checked);
  await page.mouse.move(2, 2);
  const focusable = async () => palette.locator('button:focus-visible:not([aria-checked=true])').count();
  for (let i = 0; i < 12 && !(await focusable()); i++) await page.keyboard.press('ArrowDown');
  const focused = await style(palette.locator('button:focus-visible:not([aria-checked=true])'));
  equal(surface.backgroundColor, rgb(expect[0]), 'Notebook menu surface');
  equal(hover.backgroundColor, rgb(baseline ? expect[1] : expect[2]), 'Notebook menu pointer hover');
  equal(checkedPaint.backgroundColor, rgb(expect[2]), 'Notebook menu checked row');
  const keyboardFill = baseline ? rgb(expect[1]) : await palette.evaluate((node, current) =>
    node.classList.contains('menu-sheet') ? current : 'rgba(0, 0, 0, 0)', rgb(expect[2]));
  equal(focused.backgroundColor, keyboardFill, 'Notebook menu keyboard focus');
  equal(focused.outlineColor, rgb(expect[3]), 'Notebook menu focus');
  equal(focused.outlineWidth, '2px', 'Notebook menu outline width');
  equal(focused.outlineOffset, '-2px', 'Notebook menu inner outline');
  await page.keyboard.press('Escape');
  return {surface, hover, checked: checkedPaint, focused};
}

async function inspectDeck(page, deck, pair, tone, focus) {
  const cards = deck.locator('.deck-card');
  await cards.nth(keys.length).waitFor();
  const colors = {};
  for (const hue of keys) {
    const card = deck.locator('.deck-card.agent-' + hue);
    const expected = hues[hue][pair];
    await page.mouse.move(2, 2);
    const rest = await style(card);
    equal(rest.backgroundColor, rgb(expected.fill), hue + ' rest fill');
    equal(rest.borderTopColor, rgb(expected.edge), hue + ' edge');
    await card.hover({position: {x: 15, y: 10}});
    const hover = await style(card);
    equal(hover.backgroundColor, rgb(expected.hover), hue + ' hover fill');
    equal(hover.borderTopColor, rgb(hover.muted), hue + ' hover edge');
    equal(hover.borderTopWidth, '1px', hue + ' hover edge width');
    colors[hue] = {rest, hover};
  }
  const green = deck.locator('.deck-card.agent-green');
  const blue = deck.locator('.deck-card.agent-blue');
  const plain = cards.first();
  await page.mouse.move(2, 2);
  equal(await plain.getAttribute('aria-current'), 'true', 'the deck starts on its plain card');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowDown');
  equal(await blue.getAttribute('aria-current'), 'true', 'keyboard picks the next card');
  const picked = await style(blue);
  assert.ok(picked.focusVisible, 'selected card has native keyboard focus');
  ring(picked, focus, 'selected Notebook card');
  equal(picked.backgroundColor, rgb(hues.blue[pair].hover), 'selected card keeps its tint');
  await plain.hover({position: {x: 15, y: 10}});
  const plainHover = await style(plain);
  equal(plainHover.backgroundColor, rgb(tone['--row-hover']), 'plain card hover fill');
  equal(plainHover.borderTopColor, rgb(plainHover.muted), 'plain card hover edge');
  await page.mouse.move(2, 2);
  await page.keyboard.press('ArrowUp');
  await page.keyboard.press('ArrowUp');
  await page.keyboard.press('Shift+ArrowDown');
  const multi = await style(green);
  assert.ok(await green.evaluate(el => el.classList.contains('deck-selected')), 'shift selects the tint');
  assert.ok(await plain.evaluate(el => el.classList.contains('deck-selected')), 'shift selects the plain card');
  equal(multi.borderTopColor, rgb(tone['--select-edge']), 'multi selection edge');
  equal((await style(plain)).backgroundColor, rgb(tone['--select-fill']), 'plain multi selection fill');
  const expectedMix = await green.evaluate((el, tint) => {
    const probe = document.createElement('span');
    probe.style.backgroundColor = 'color-mix(in srgb, ' + getComputedStyle(el).getPropertyValue('--ink') + ' 8%, ' + tint + ')';
    el.append(probe);
    try { return getComputedStyle(probe).backgroundColor; } finally { probe.remove(); }
  }, hues.green[pair].fill);
  equal(multi.backgroundColor, expectedMix, 'tinted multi selection fill');
  await page.keyboard.press('Shift+F10');
  const picker = page.getByRole('menu', {name: 'This card', exact: true});
  const swatches = {};
  for (const hue of keys) {
    const dot = picker.locator('.notebook-swatch.agent-' + hue + ' .notebook-swatch-dot');
    const paint = await style(dot);
    equal(paint.backgroundColor, rgb(hues[hue][pair].fill), hue + ' picker fill');
    equal(paint.borderTopColor, rgb(hues[hue][pair].edge), hue + ' picker edge');
    swatches[hue] = paint;
  }
  await page.keyboard.press('Escape');
  return {colors, picked, plainHover, multi, swatches};
}

let browser, origin, failure;
try {
  const facts = await control({method: 'ready'});
  origin = facts.origin;
  const {topic} = await control({method: 'agent_view', actor: facts.actor, name: 'topic', args: {topic_id: 't1'}});
  const outcome = 'colour-outcome';
  equal((await control({method: 'team_outcome', operation_id: outcome, workspace_id: outcome,
    title: 'Notebook colour outcome', team: ['fixture-notebook-agent']})).status, 'committed', 'seed outcome');
  if (!baseline) {
    await control({method: 'navigation_topics', topics: [
      {id: 'colour-topic-peer', title: 'Other topic', workspace_id: topic.workspace_id}
    ]});
    const pipeline = async (id, act, args) => {
      const receipt = await control({method: 'pipeline', operation_id: id, kind: 'pipeline.' + act, workspace_id: outcome,
        target: {workspace_id: outcome}, args});
      equal(receipt.status, 'committed', act);
      return receipt.result;
    };
    await pipeline('colour-build-on', 'configure', {enabled: true});
    await pipeline('colour-build-stage', 'stages_set', {stages: [{stage_id: 'build', name: 'Build'}]});
    for (const topic_id of ['colour-build', 'colour-build-peer']) {
      equal((await control({method: 'light_outcome', outcome, exists: true, topic: {id: topic_id, title: 'Build ' + topic_id}})).status,
        'committed', 'seed ' + topic_id);
      const {number} = await pipeline('colour-build-item-' + topic_id, 'item_add',
        {title: 'Colour build ' + topic_id, section: 'now', size: 'small', sources: [{note: 'Scratch specimen'}]});
      await pipeline('colour-build-start-' + topic_id, 'piece_start', {topic_id, numbers: [number], stage_id: 'build'});
    }
  }
  const title = 'Notebook colour specimens';
  const body = '## Plain\n\nPlain Notebook words.\n\n' + keys.map((hue, index) =>
    withCardDetails('## ' + hue + '\n\nNotebook ' + hue + ' words.',
      {id: 'c-' + (index + 1).toString(16).padStart(32, '0'), color: hue, aliases: []})
  ).join('\n\n') + '\n';
  for (const [id, owner_scope] of [
    ['colours-note', {kind: 'topic', id: 't1'}],
    ['colours-chip', {kind: 'workspace', id: outcome}]
  ]) {
    equal((await control({method: 'agent_page', operation_id: id, item_id: id, title, body, owner_scope})).status,
      'committed', 'seed ' + id);
  }
  async function post(id, sender, body, replyTo) {
    const fact = await control({
      method: 'agent_message', topic_id: 't1', operation_id: id, sender, body, join: true, source: 'topic',
      ...(replyTo ? {reply_to: replyTo, reply_without_quote: 'Scratch colour specimen'} : {divergence_reason: 'Scratch colour specimen'})
    });
    equal(fact.status, 'committed', 'seed ' + id);
    return fact.result.message_id;
  }
  const root = await post('colour-stack-root', 'person', 'Stack root colour specimen.');
  const reply = await post('colour-stack-reply', 'fixture-other-person', 'Stack reply colour specimen.', root);
  const agent = await post('colour-agent-hover', facts.agent, 'Agent passage colour specimen. Another sentence here.');
  await post('colour-agent-next', facts.agent, 'Another card for keyboard movement.');
  browser = await chromium.launch({executablePath: process.env.AIM_CHROME});
  result.browser = browser.version();
  const cells = [1280, 390].flatMap(width => ['bookends', 'paper'].flatMap(look =>
    ['dark', 'light'].flatMap(theme => ['quiet', 'vivid'].flatMap(intensity =>
      ['lighter', 'middle', 'darker'].map(light => ({width, look, theme, intensity, light}))))));
  for (const config of cells) {
    const {width, look, theme, intensity, light} = config;
    const key = Object.values(config).join('-');
    if (process.env.AIM_COLOUR_CELL && !key.startsWith(process.env.AIM_COLOUR_CELL)) continue;
    const row = {key, errors: [], states: {}};
    result.rows.push(row);
    const context = await browser.newContext({viewport: {width, height: 950}, colorScheme: theme});
    const page = await context.newPage();
    page.setDefaultTimeout(4500);
    page.on('pageerror', error => row.errors.push(error.message));
    await context.addInitScript(({look, intensity, light}) => {
      localStorage.setItem('theseus-look', look);
      localStorage.setItem('theseus-agent-colors', intensity === 'quiet' ? '' : intensity);
      localStorage.setItem('theseus-light-colour', light === 'middle' ? '' : light);
      window.colourEvents = [];
      for (const type of ['pointerdown', 'keydown', 'contextmenu']) {
        addEventListener(type, event => colourEvents.push([type, event.isTrusted]), true);
      }
    }, config);
    try {
      await page.goto(origin + '/?topic=t1');
      await page.locator(ready).waitFor();
      const settings = await page.locator('html').evaluate(el => ({...el.dataset}));
      equal(settings.look ?? 'bookends', look, 'look applied');
      equal(settings.agentColors ?? 'quiet', intensity, 'intensity applied');
      equal(settings.lightColour ?? 'middle', light, 'passage preference applied');
      const feed = id => page.locator('#messages .message-card[data-id="' + id + '"]');
      await feed(agent).waitFor();
      const preview = feed(agent).locator('.message-preview');
      await page.mouse.move(2, 2);
      const rest = await style(feed(agent));
      await moveToWords(page, preview);
      await page.waitForFunction(id => {
        const card = document.querySelector('#messages .message-card[data-id="' + id + '"]');
        return card?.classList.contains('lit') && [...(CSS.highlights.get('lit-passage') ?? [])]
          .some(range => card.contains(range.commonAncestorContainer));
      }, agent);
      const lit = await style(feed(agent)), field = await style(preview, '::highlight(lit-passage)');
      row.passage = {
        rest: rest.backgroundColor, hover: lit.backgroundColor, field: field.backgroundColor, words: field.color,
        layers: await preview.evaluate(el => [...new Set([el, ...el.querySelectorAll('*')]
          .map(node => getComputedStyle(node).backgroundImage).filter(image => image !== 'none'))])
      };
      if (baseline) continue;
      if (previous) assert.deepEqual(row.passage, previous.rows.find(row => row.key === key)?.passage, 'agent colours and passage');
      ring(lit, bench[theme]['--focus'], 'feed lit');
      const selection = await style(preview, '::selection');
      equal(selection.backgroundColor, rgb(bench[theme]['--text-select']), 'feed text selection');
      equal(selection.color, rgb(selection.ink), 'feed selection ink');
      const focusedFeed = page.locator('#messages .message-card.lit:focus-visible');
      await page.keyboard.press('ArrowDown');
      if (!(await focusedFeed.count())) await page.keyboard.press('ArrowUp');
      await focusedFeed.waitFor();
      ring(await style(focusedFeed), bench[theme]['--focus'], 'selected and focused feed');
      const own = await style(feed(root).locator('.message-preview'), '::selection');
      equal(own.backgroundColor, rgb('#434645'), 'own card selection');
      equal(own.color, rgb('#e0e8e5'), 'own card selection ink');
      row.states.feed = {selection, lit, focused: await style(focusedFeed), own};
      const stackToggle = page.locator('#messages .reply-stack:has([data-id="' + root + '"]) .stack-toggle').first();
      if (!(await feed(reply).isVisible())) await stackToggle.click();
      await moveToWords(page, feed(reply).locator('.message-preview'));
      const stack = await style(feed(reply));
      ring(stack, bench[theme]['--focus'], 'stack lit');
      if (theme === 'dark') equal(stack.backgroundColor, rgb(tokens.one_offs['stacked person card hover, dark']), 'dark stack hover');
      row.states.stack = stack;

      await readerFromPage({page, cardSelector: '#messages .message-card[data-id="' + agent + '"]',
        prefix: 'Agent passage colour specimen.', pressSource: () => preview.click()});
      const words = page.locator('#reader[open] #source-body').getByText('Agent passage colour specimen. Another sentence here.', {exact: true});
      await words.waitFor();
      const reader = await style(words, '::selection');
      equal(reader.backgroundColor, rgb(bench[theme]['--text-select']), 'Reader text selection');
      equal(reader.color, rgb(reader.ink), 'Reader selection ink');
      row.states.reader = reader;
      await page.goto(origin + '/?topic=t1');
      await page.locator(ready).waitFor();

      if (width === 390) await page.locator('#rail-open').click();
      const current = page.locator('#rail a.nav-item[data-topic-id=t1][aria-current=page]:visible').first();
      if (!(await current.count())) {
        await page.locator('.ol-outcome[data-workspace-id="' + topic.workspace_id + '"] .ol-disclosure').click();
      }
      await current.waitFor();
      const rail = await style(current), railTone = look === 'paper' ? paperRails[theme] : ends;
      equal(rail.backgroundColor, rgb(railTone['--row-current']), 'current left rail');
      equal(rail.color, rgb(rail.ink), 'current left rail ink');
      const leftPeer = page.locator('#rail a.nav-item[data-topic-id=colour-topic-peer]:visible').first();
      await leftPeer.hover();
      rail.peer = await style(leftPeer);
      equal(rail.peer.backgroundColor, rgb(railTone['--rail-hover']), 'left rail row hover');
      row.states.rail = rail;
      await page.goto(origin + '/?topic=colour-build');
      await page.locator(ready).waitFor();
      if (width === 390) await page.locator('#things-open').click();
      const buildRow = page.locator('#things .pipe-builds a.row[aria-current=page]');
      const buildPeer = page.locator('#things .pipe-builds a.row:not([aria-current])');
      await buildPeer.hover();
      const right = await style(buildRow), rightHover = await style(buildPeer);
      equal(right.backgroundColor, rgb(railTone['--row-current']), 'current right rail');
      equal(right.color, rgb(right.ink), 'current right rail ink');
      equal((await style(buildRow.locator('.sub'))).color, rgb(right.ink), 'current right rail secondary ink');
      equal(rightHover.backgroundColor, rgb(railTone['--rail-hover']), 'right rail row hover');
      row.states.right = {right, rightHover};
      await page.goto(origin + '/?topic=t1');
      await page.locator(ready).waitFor();
      if (width === 390) await page.locator('#things-open').click();
      const tile = page.locator('#things a[data-page-id=colours-note]');
      await tile.waitFor();
      await tile.hover();
      const tileHover = await style(tile);
      equal(tileHover.borderTopColor, rgb(look === 'paper' ? paperTiles['--tile-hover-ring'] : tileHover.muted), 'Notebook tile hover');
      const menu = menuTokens[look === 'bookends' ? look : theme];
      row.states.railMenu = await inspectMenu(page, tile, menu);
      await tile.click({button: 'right'});
      await page.getByRole('menu', {name: 'This page', exact: true}).locator('[data-notebook-action=cards]').click();
      const deck = page.locator('dialog.notebook-sheet-dialog[open] .notebook-sheet-page');
      await deck.locator('.deck-card').nth(keys.length).waitFor();
      equal(await tile.getAttribute('aria-current'), 'page', 'open Notebook marked in right rail');
      const marker = await style(tile);
      const markerFocus = look === 'paper' ? paperTiles['--focus'] : ends['--focus'];
      equal(marker.borderTopColor, rgb(markerFocus), 'current Notebook tile border');
      equal(marker.borderTopWidth, '1px', 'current Notebook tile border width');
      equal(marker.boxShadow, rgb(markerFocus) + ' 0px 0px 0px 1px', 'current Notebook tile outer edge');
      row.states.marker = {hover: tileHover, open: marker};
      const tone = look === 'paper' ? paperSheet[Object.keys(paperSheet).find(name => name.startsWith(theme))] : ends;
      const isDocked = await deck.evaluate(el => Boolean(el.closest('.notebook-docked')));
      row.states.sheet = await inspectDeck(page, deck, look === 'paper' ? 'paper (Faint)' : 'bookends (Soft)', tone,
        look === 'bookends' && isDocked ? dock['--focus'] : tone['--focus']);
      await page.locator('.notebook-sheet-close').click();
      equal(await tile.getAttribute('aria-current'), null, 'closing Notebook clears the marker');
      await page.goto(origin + '/?cards=colours-note&view=cards');
      await page.locator(ready).waitFor();
      row.states.full = await inspectDeck(page, page.locator('#deck-page'),
        theme === 'dark' ? 'bookends (Soft)' : 'paper (Faint)', bench[theme], bench[theme]['--focus']);
      await page.locator('#deck-page .notebook-menu').click();
      const fullMenu = page.getByRole('menu', {name: 'This page', exact: true});
      assert.ok(await fullMenu.evaluate(el => !el.classList.contains('notebook-surface')), 'the full page keeps its own menu');
      await page.keyboard.press('Escape');
      await page.goto(origin + '/?workspace=' + outcome);
      await page.locator(ready).waitFor();
      if (width === 390) await page.locator('#outcome-tab-notes').click();
      const chip = page.locator('#outcome-references [data-page-id=colours-chip]');
      row.states.chipMenu = await inspectMenu(page, chip, menu);
      assert.deepEqual(row.errors, []);
      row.events = await page.evaluate(() => colourEvents);
      assert.ok(row.events.some(([kind]) => kind === 'keydown'));
      assert.ok(row.events.some(([kind]) => kind === 'contextmenu'));
      assert.ok(row.events.every(([, trusted]) => trusted), 'recorded native events');
    } catch (error) {
      row.failure = error.stack;
      await page.screenshot({path: out + '/' + key + '-failure.png'}).catch(() => {});
      throw error;
    } finally {
      await context.close();
      console.log(key + (row.failure ? ' failed' : ' passed'));
      await writeFile(out + '/results.json', JSON.stringify(result, null, 2));
    }
  }
  equal(result.rows.length, process.env.AIM_COLOUR_CELL ?
    cells.filter(cell => Object.values(cell).join('-').startsWith(process.env.AIM_COLOUR_CELL)).length : 48, 'matrix size');
} catch (error) {
  failure = error;
} finally {
  await browser?.close();
  fixture.stdin.end();
  result.cleanup = {browserClosed: !browser?.isConnected(), fixtureExit: await exit, fixtureStderr: errors()};
  if (origin) result.cleanup.portClosed = await new Promise(resolve => {
    const url = new URL(origin);
    const socket = net.createConnection({host: url.hostname, port: Number(url.port)});
    socket.once('error', error => resolve(error.code === 'ECONNREFUSED'));
    socket.once('connect', () => { socket.destroy(); resolve(false); });
  });
  await writeFile(out + '/results.json', JSON.stringify(result, null, 2));
}
if (failure) throw failure;
assert.deepEqual(result.cleanup, {browserClosed: true, fixtureExit: {code: 0, signal: null}, fixtureStderr: '', portClosed: true});

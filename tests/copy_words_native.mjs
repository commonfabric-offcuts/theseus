import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fixtureControl } from './fixture_control.mjs';
import { readerFromPage } from './message_palette_1091_gestures.mjs';

const [directory, widthOption = '1280', scheme = 'light', look = 'bookends'] = process.argv.slice(2);
const width = Number(widthOption), phone = width < 760;
assert.ok(directory && [1280, 390].includes(width));
await mkdir(directory, { recursive: true });
const report = { width, scheme, look, checks: [], selections: [], errors: [] };
const { chromium } = await import(process.env.AIM_PLAYWRIGHT_CORE);
const fixture = spawn('/usr/bin/python3', ['-B', 'tests/fixtures/ui_http.py', '--freshness', '--live', '--agent-colors', '--other-person',
  '--teardown-observations', directory + '/teardown.jsonl']);
const { control, exit, errors } = fixtureControl(fixture);
let browser, page;
try {
  const { origin, actor } = await control({ method: 'ready' });
  const topic = 'fixture-copy-text';
  await control({ method: 'navigation_topics', topics: [{ id: topic, title: 'Copy text sample' }] });
  const ids = {};
  const put = async (key, body, extras = {}) => {
    const receipt = await control({ method: 'agent_message', operation_id: 'copy-' + key, topic_id: topic,
      source: 'topic', sender: 'aim-core', join: true, body, addressees: [actor], intent: 'tell',
      divergence_reason: 'Independent synthetic clipboard sample.', ...extras });
    assert.equal(receipt.status, 'committed', JSON.stringify(receipt));
    return ids[key] = receipt.result.message_id;
  };
  const message = '> Earlier words\n\nAlpha **marked words** and [sample link](https://example.org/sample).\n\nFirst memory line\nSecond memory line\n\n- One\n- Two\n\n```js\nconst value = 1;\n```';
  await put('message', message, { attachments: [{ name: 'omitted.txt', text: 'Omitted file contents.' }] });
  const code = '    let first = 1;\n      let next = 2;\n';
  await put('fragments', '3. Before **select these words** after\n9. Next row ends here\n\n```js\n' + code + '```');
  const long = 'First line of a long source.\n\n' + 'An additional line to read. '.repeat(51) + '\n\nLast words of the complete source.';
  await put('long', long);
  const folded = 'Filed for another reader.\n\n**Exact folded message ending.**';
  await put('other', 'Synthetic second reader joined.', { sender: 'fixture-other-person' });
  await put('folded', folded, { addressees: ['fixture-other-person'] });
  await put('attachment', '', { attachments: [{ name: 'only.txt', text: 'Attachment without an authored body.' }] });
  await put('private', 'Privately visible **synthetic note**.', { sender: 'person', addressees: ['aim-core'], whisper: true });
  await put('root', 'Dossier root **source words**.');
  await put('reply', 'Dossier reply **different words**.', { reply_to: ids.root, reply_without_quote: 'Synthetic reply fixture.' });
  const cover = { stands: '## Decision\n\nCover **written words**.', waiting: [{ text: 'Ready to decide?', default: 'Hold' }],
    payload: { text: 'Sample result', message_id: ids.reply, link: 'https://example.org/result' } };
  for (const [kind, args] of [['stack.name', { name: 'Sample dossier' }], ['stack.cover', cover]]) {
    const receipt = await control({ method: 'stack_act', sender: 'aim-core', kind, message_id: ids.root,
      operation_id: 'copy-' + kind, args });
    assert.equal(receipt.status, 'committed', JSON.stringify(receipt));
  }
  const notebook = 'copy-notebook', body = '## One\n\nText in **one**.\n\n## Two\n\nText in two.\n\n## Three\n\nText in three.';
  const addPage = await control({ method: 'agent_page', operation_id: 'copy-page', item_id: notebook, topic_id: 't1',
    title: 'Sample notebook', body });
  assert.equal(addPage.status, 'committed', JSON.stringify(addPage));
  const outcomePage = await control({ method: 'outcome_reference', operation_id: 'copy-outcome-page',
    item_id: 'copy-outcome', title: 'Sample outcome notebook', body });
  assert.equal(outcomePage.status, 'committed', JSON.stringify(outcomePage));

  browser = await chromium.launch({ executablePath: process.env.AIM_CHROME, headless: true });
  const context = await browser.newContext({ viewport: { width, height: 960 }, colorScheme: scheme, isMobile: phone, hasTouch: phone });
  await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin });
  await context.addInitScript(paper => { if (paper) localStorage.setItem('theseus-look', 'paper'); }, look === 'paper');
  await context.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
  page = await context.newPage();
  page.setDefaultTimeout(7000);
  page.on('pageerror', error => report.errors.push(error.stack));
  const check = async (name, act) => {
    try { await act(); report.checks.push({ name, pass: true }); }
    catch (error) { report.checks.push({ name, pass: false, error: error.stack }); throw error; }
  };
  const locator = selector => page.locator(selector);
  const card = key => `#messages [data-id="${ids[key]}"]`;
  const words = key => card(key) + ' .message-preview';
  const press = async target => {
    const button = typeof target === 'string' ? locator(target) : target;
    await button.scrollIntoViewIfNeeded();
    await (phone ? button.tap() : button.click());
  };
  const touchHold = async (target, show) => {
    await target.scrollIntoViewIfNeeded();
    const { x, y, width, height } = await target.boundingBox();
    const devtools = await context.newCDPSession(page);
    const touchPoints = [{ x: Math.round(x + width / 2), y: Math.round(y + height / 2) }];
    report.hold = await page.evaluate(({ x, y }) => ({
      target: document.elementFromPoint(x, y)?.outerHTML.slice(0, 250),
      selection: getSelection().toString(),
    }), touchPoints[0]);
    await devtools.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints });
    await show.waitFor();
    await devtools.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await devtools.detach();
  };
  const menu = page.getByRole('menu', { name: 'This message', exact: true });
  const copy = menu.locator('[data-menu-key="Copy text"]');
  const screenshot = name => page.screenshot({ path: directory + '/' + name + '.png' });
  const plainAndHTML = async () => page.evaluate(async () => {
    const [item] = await navigator.clipboard.read();
    const value = async type => (await item.getType(type)).text();
    return { plain: await value('text/plain'), html: await value('text/html') };
  });
  const clipboardStarts = words => page.waitForFunction(async words => (await navigator.clipboard.readText()).startsWith(words), words);
  const expectClip = async (body, html) => {
    await clipboardStarts(body);
    const entry = await plainAndHTML();
    assert.equal(entry.plain, body);
    if (html) assert.match(entry.html, html);
    assert.doesNotMatch(entry.html, /omitted\.txt|Omitted file contents|fence-copy/);
  };
  const expectSelection = async (selected, html) => {
    await clipboardStarts(selected);
    const entry = await plainAndHTML();
    assert.equal(entry.plain, selected);
    assert.match(entry.html, html);
    assert.doesNotMatch(entry.html, /data-(?:start|end|act)=|fence-copy/);
    report.selections.push(entry);
    return entry.html;
  };
  const copyFrom = async (row, status, said) => {
    await press(row);
    await locator(status).filter({ hasText: said }).waitFor();
  };
  const feedMore = '.message-bar [data-act=more]';
  const feedMenu = async key => {
    await locator(card(key)).scrollIntoViewIfNeeded();
    if (phone) await press(card(key) + ' .message-author');
    else await locator(card(key)).hover();
    await press(feedMore);
    await menu.waitFor();
  };
  const selectionRect = target => locator(target).evaluate(el => {
      const range = document.createRange(); range.selectNodeContents(el);
      const { x, y, width, height } = range.getBoundingClientRect();
      return { x, y, width, height };
    });
  const select = async (target, end = target) => {
    await page.evaluate(() => getSelection().removeAllRanges());
    const first = await selectionRect(target), last = await selectionRect(end);
    await page.mouse.move(first.x + 1, first.y + first.height / 2);
    await page.mouse.down();
    await page.mouse.move(last.x + last.width - 1, last.y + last.height / 2, { steps: 10 });
    await page.mouse.up();
    return page.evaluate(() => getSelection().toString());
  };
  const selectCode = async target => {
    await page.evaluate(() => getSelection().removeAllRanges());
    const points = await locator(target).evaluate(el => {
      const node = el.firstChild;
      return [2, node.textContent.trimEnd().length].map(offset => {
        const range = document.createRange();
        range.setStart(node, offset);
        range.collapse(true);
        const rect = range.getBoundingClientRect();
        return { x: rect.x, y: rect.y + rect.height / 2 };
      });
    });
    await page.mouse.move(points[0].x, points[0].y);
    await page.mouse.down();
    await page.mouse.move(points[1].x, points[1].y, { steps: 10 });
    await page.mouse.up();
    return page.evaluate(() => getSelection().toString());
  };
  const copyFragment = async (more, selected, html) => {
    await press(more);
    assert.equal(await copy.getAttribute('data-menu-label'), 'Copy selected text');
    await copyFrom(copy, more, 'Selection copied');
    return expectSelection(selected, html);
  };
  const fragmentCases = async (place, host, more) => {
    const first = host + ' .md-item strong', second = host + ' .md-item-words >> nth=1';
    await check(`${place}: selected words within one ordered row`, async () => {
      await locator(first).scrollIntoViewIfNeeded();
      const selected = await select(first);
      assert.equal(selected, 'select these words');
      const html = await copyFragment(more, selected, /<ol start="3"><li><strong>select these words<\/strong><\/li><\/ol>/);
      assert.doesNotMatch(html, /Before|after|Next row/);
    });
    await check(`${place}: partial ordered selection preserves 3 and 9 in one list`, async () => {
      const selected = await select(first, second);
      assert.match(selected, /select these words after[\s\S]*Next row ends here/);
      const html = await copyFragment(more, selected, /<ol start="3"><li><strong>select these words<\/strong> after<\/li><li value="9">Next row ends here<\/li><\/ol>/);
      assert.equal((html.match(/<ol\b/g) ?? []).length, 1);
      assert.doesNotMatch(html, /Before/);
    });
    await check(`${place}: selection inside code retains the fence's indentation in HTML`, async () => {
      const pre = host + ' .md-pre';
      await locator(pre).scrollIntoViewIfNeeded();
      const selected = await selectCode(pre);
      assert.equal(selected, code.slice(2).trimEnd());
      const html = await copyFragment(more, selected, /<pre><code>[\s\S]*<\/code><\/pre>/);
      const richCode = await page.evaluate(html => new DOMParser().parseFromString(html, 'text/html')
        .querySelector('pre code').textContent, html);
      assert.equal(richCode, selected);
    });
  };
  const openTopic = async () => {
    await page.goto(origin + '/?topic=' + topic);
    await locator('body[data-ready=true]').waitFor();
    await locator(card('message')).waitFor();
    assert.equal(await locator('html').getAttribute('data-look'), look === 'paper' ? 'paper' : null);
  };
  await openTopic();
  await check('feed whole source, both formats, standard feedback', async () => {
    await feedMenu('message');
    assert.equal(await menu.locator('.palette-rows button').first().getAttribute('data-menu-label'), 'Copy text');
    await screenshot('message-menu');
    await copyFrom(copy, feedMore, 'Text copied');
    await expectClip(message, /<blockquote[\s\S]*<strong[^>]*>marked words<\/strong>[\s\S]*<a [^>]*href="https:\/\/example\.org\/sample"[\s\S]*First memory line<br>Second memory line[\s\S]*<ul[\s\S]*<code/);
  });
  await check('selection inside feed uses the selected words and native shortcut label', async () => {
    const selected = await select(words('message') + ' strong');
    assert.equal(selected, 'marked words');
    if (!phone) {
      await locator(words('message') + ' strong').click({ button: 'right' });
      assert.equal(await menu.count(), 0);
      assert.equal(await page.evaluate(() => getSelection().toString()), selected);
    }
    await press(feedMore);
    assert.equal(await copy.getAttribute('data-menu-label'), 'Copy selected text');
    assert.ok(['⌘C', 'Ctrl+C'].includes(await copy.getAttribute('data-menu-keys')));
    await screenshot('message-selected');
    await copyFrom(copy, feedMore, 'Selection copied');
    await expectSelection(selected, /<strong>marked words<\/strong>/);
  });
  await check('selection spanning two list rows preserves exact plain text', async () => {
    const list = words('message') + ' .md-item-words';
    const selected = await select(list + ' >> nth=0', list + ' >> nth=1');
    assert.match(selected, /One[\s\S]*Two/);
    await press(feedMore);
    assert.equal(await copy.getAttribute('data-menu-label'), 'Copy selected text');
    await copyFrom(copy, feedMore, 'Selection copied');
    await expectSelection(selected, /<ul><li>One<\/li><li>Two<\/li><\/ul>/);
  });
  if (phone) await press(card('fragments') + ' .message-author');
  else await locator(card('fragments')).hover();
  await fragmentCases('feed', words('fragments'), feedMore);
  await check('right-click Copy text uses the status line', async () => {
    await press('#topic-title');
    await page.keyboard.press('ArrowRight');
    assert.ok(await page.evaluate(() => getSelection().isCollapsed));
    await locator(words('message') + ' strong').click({ button: 'right' });
    assert.equal(await copy.getAttribute('data-menu-label'), 'Copy text');
    await copyFrom(copy, '#app-status', 'Text copied.');
    await expectClip(message, /<blockquote/);
  });
  await check('clipped message copies through its last line', async () => {
    await feedMenu('long');
    await copyFrom(copy, feedMore, 'Text copied');
    await expectClip(long, /Last words of the complete source/);
  });
  await check('the folded card copies its original Markdown without expanding', async () => {
    const foldedLine = locator(card('folded') + ' .fold-line');
    assert.equal(await foldedLine.getAttribute('aria-expanded'), 'false');
    await foldedLine.click({ button: 'right', position: { x: 14, y: 26 } });
    await copyFrom(copy, '#app-status', 'Text copied.');
    await expectClip(folded, /<strong>Exact folded message ending\.<\/strong>/);
    assert.equal(await foldedLine.getAttribute('aria-expanded'), 'false');
  });
  await check('attachment-only row is disabled with the specified tooltip', async () => {
    await feedMenu('attachment');
    assert.equal(await copy.isDisabled(), true);
    assert.equal(await copy.getAttribute('title'), 'No text to copy');
    await screenshot('attachment-only-disabled');
    await page.keyboard.press('Escape');
  });
  await check('visible whisper uses the same clipboard path', async () => {
    await feedMenu('private');
    await copyFrom(copy, feedMore, 'Text copied');
    await expectClip('Privately visible **synthetic note**.', /<strong[^>]*>synthetic note<\/strong>/);
  });
  await check('cover copies authored sections, waits and payload from dossier title menu', async () => {
    const dossier = `#messages .reply-stack[data-stack="${ids.root}"]`;
    if (phone) {
      await press('#topic-title');
      await touchHold(locator(dossier + ' > .dossier-cover .cover-stands strong'), menu);
    }
    else {
      await locator(dossier).hover();
      await press(dossier + ' .stack-tools [data-tool=menu]');
    }
    await screenshot('dossier-cover-menu');
    await copyFrom(copy, phone ? '#app-status' : dossier + ' .stack-tools [data-tool=menu]', 'Text copied');
    await clipboardStarts('## Decision');
    const entry = await plainAndHTML();
    assert.match(entry.plain, /^## Decision\n\nCover \*\*written words\*\*\.\n\nWaits on .+: Ready to decide\? \(default: Hold\)\n\nPayload: Sample result <https:\/\/example\.org\/result>$/);
    assert.match(entry.html, /<h2[^>]*>Decision<\/h2>[\s\S]*Waits on[\s\S]*Payload:[\s\S]*<a [^>]*href="https:\/\/example\.org\/result"/);
  });
  await check('cover overflow confirms on its own button and copies the refreshed cover', async () => {
    const dossier = `#messages .reply-stack[data-stack="${ids.root}"]`, sheet = locator(dossier + ' > .dossier-cover');
    const visible = await sheet.elementHandle();
    const updated = { ...cover, stands: '## Decision\n\nRefreshed **dossier words**.' };
    const receipt = await control({ method: 'stack_act', sender: 'aim-core', kind: 'stack.cover', message_id: ids.root,
      operation_id: 'copy-cover-refresh', args: updated });
    assert.equal(receipt.status, 'committed');
    await sheet.getByText('Refreshed dossier words.').waitFor();
    assert.equal(await visible.evaluate(node => node.isConnected), true);
    const previousNotice = locator('#app-status button');
    if (await previousNotice.isVisible()) await press(previousNotice);
    await locator('#app-status').waitFor({ state: 'hidden' });
    if (phone) await press(card('root') + ' .message-author');
    else await locator(dossier).hover();
    const more = dossier + ' .stack-tools [data-tool=menu]';
    await press(more);
    await copyFrom(copy, more, 'Text copied');
    await clipboardStarts(updated.stands);
    const entry = await plainAndHTML();
    assert.match(entry.html, /Refreshed <strong>dossier words<\/strong>/);
    assert.doesNotMatch(entry.plain, /Cover written words/);
    const button = locator(more);
    assert.ok(await button.evaluate(node => node.scrollWidth <= node.clientWidth && node.scrollHeight <= node.clientHeight));
    await locator('#app-status').waitFor({ state: 'hidden' });
    await screenshot('dossier-cover-overflow-feedback');
  });
  await check('Reader copies the full rendered message and reports refused permission', async () => {
    await readerFromPage({ page, cardSelector: card('message'), prefix: 'Alpha marked words', pressSource: () => press(words('message')) });
    await press('#reader-menu');
    await screenshot('reader-menu');
    await copyFrom(copy, '#reader-menu', 'Text copied');
    await expectClip(message, /<strong[^>]*>marked words<\/strong>/);
    const selected = await select('#source-body strong');
    assert.equal(selected, 'marked words');
    await press('#reader-menu');
    assert.equal(await copy.getAttribute('data-menu-label'), 'Copy selected text');
    await screenshot('reader-selected');
    await copyFrom(copy, '#reader-menu', 'Selection copied');
    await expectSelection(selected, /<strong>marked words<\/strong>/);
    const devtools = await context.newCDPSession(page);
    const { targetInfo } = await devtools.send('Target.getTargetInfo');
    for (const allowWithoutSanitization of [false, true]) {
      await devtools.send('Browser.setPermission', { permission: { name: 'clipboard-write', allowWithoutSanitization },
        setting: 'denied', origin, browserContextId: targetInfo.browserContextId });
    }
    assert.equal(await page.evaluate(async () => (await navigator.permissions.query({ name: 'clipboard-write' })).state), 'denied');
    await press('#reader-menu');
    await press(copy);
    await locator('#reader-notice').filter({ hasText: 'Could not copy. Select the text and use Copy.' }).waitFor();
    await context.clearPermissions();
    await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin });
    await press('#reader-close');
  });
  await page.goto(`${origin}/?topic=${topic}&message=${ids.fragments}`);
  await locator('#reader[open] #source-body strong').filter({ hasText: 'select these words' }).waitFor();
  await fragmentCases('Reader', '#source-body', '#reader-menu');
  await press('#reader-close');
  const pageMenu = page.getByRole('menu', { name: 'This page', exact: true });
  const pageCopy = pageMenu.locator('[data-notebook-action=copy-text]');
  const notebookMore = '#deck-page .notebook-menu';
  await check('Notebook Text and Cards use the same source with matching HTML structure', async () => {
    await page.goto(origin + '/?cards=' + notebook + '&view=text');
    await press(notebookMore);
    assert.equal(await pageCopy.textContent(), 'Copy text');
    await screenshot('notebook-page-menu');
    await copyFrom(pageCopy, notebookMore, 'Text copied');
    await expectClip(body, /<h2[^>]*>One<\/h2>[\s\S]*<strong[^>]*>one<\/strong>/);
    await press(notebookMore);
    await press(pageMenu.locator('[data-notebook-action=cards]'));
    await locator('#deck-page .deck-card').nth(2).waitFor();
    await press(notebookMore);
    await copyFrom(pageCopy, notebookMore, 'Text copied');
    await expectClip(body, /<h2[^>]*>One<\/h2>[\s\S]*<hr>[\s\S]*<h2[^>]*>Two<\/h2>[\s\S]*<hr>[\s\S]*<h2[^>]*>Three<\/h2>/);
  });
  await check('one Notebook card copies from its thumbnail menu', async () => {
    const row = locator('#deck-page .deck-card').nth(1);
    if (phone) await press(row.locator('.deck-menu'));
    else await row.click({ button: 'right' });
    const cardCopy = page.getByRole('menu', { name: 'This card', exact: true }).locator('[data-notebook-action=copy-text]');
    assert.equal(await cardCopy.textContent(), 'Copy text');
    await screenshot('notebook-card-menu');
    await copyFrom(cardCopy, phone ? '#deck-page .deck-menu.said' : '#deck-page .notebook-page-notice', phone ? 'Text copied' : 'Card text copied.');
    await expectClip('Two\n\nText in two.', /<h2[^>]*>Two<\/h2>[\s\S]*Text in two/);
  });
  await check('several Notebook cards copy in page order', async () => {
    const picked = locator('#deck-page .deck-card[aria-current=true]');
    const index = await picked.getAttribute('data-index');
    await picked.focus();
    await page.keyboard.press(index === '0' ? 'Shift+ArrowDown' : 'Shift+ArrowUp');
    await locator('#deck-page .deck-card.deck-selected').nth(1).waitFor();
    await press(notebookMore);
    assert.equal(await pageCopy.textContent(), 'Copy selected cards');
    await screenshot('notebook-selected');
    await copyFrom(pageCopy, notebookMore, 'Cards copied');
    await expectClip('## One\n\nText in **one**.\n\n## Two\n\nText in two.', /<h2[^>]*>One<\/h2>[\s\S]*<hr>[\s\S]*<h2[^>]*>Two<\/h2>/);
  });
  await check('Notebook sheet overflow copies the current page', async () => {
    await page.goto(origin + '/?topic=t1&page=' + notebook);
    const over = '.notebook-sheet .notebook-menu';
    await press(over);
    await screenshot('notebook-sheet-menu');
    await copyFrom(pageCopy, over, 'Text copied');
    const receiptFits = await locator(over).evaluate(button => button.scrollWidth <= button.clientWidth && button.scrollHeight <= button.clientHeight);
    assert.equal(receiptFits, true);
    await screenshot('notebook-sheet-feedback');
    await expectClip(body, /<h2[^>]*>Three<\/h2>/);
  });
  await check('right-rail Notebook menu copies the already authorized page', async () => {
    await page.goto(origin + '/?topic=t1');
    if (phone) await press('#things-open');
    const row = locator('#things [data-page-id="' + notebook + '"]');
    await row.click({ button: 'right' });
    await screenshot('notebook-rail-menu');
    await press(pageCopy);
    await page.getByText('Text copied.', { exact: true }).waitFor();
    await expectClip(body, /<h2[^>]*>Three<\/h2>/);
    assert.equal(await locator('.notebook-sheet:visible').count(), 0);
  });
  await check('Outcome Notebook chip copies from its own menu', async () => {
    await page.goto(origin + '/?workspace=w1');
    if (phone) await press('#outcome-tab-notes');
    const row = locator('#outcome-references [data-page-id="copy-outcome"]');
    await row.click({ button: 'right' });
    await screenshot('notebook-outcome-menu');
    await press(pageCopy);
    await locator('#outcome-references-status').filter({ hasText: 'Text copied.' }).waitFor();
    await expectClip(body, /<h2[^>]*>Three<\/h2>/);
  });
  report.served = {};
  for (const name of ['aim.css', 'app.mjs', 'copy-words.mjs', 'deck-page.mjs', 'dossier-cover.mjs', 'message-format.mjs',
    'message-menu.mjs', 'message-palette.mjs', 'notebook-menu.mjs', 'notebook-page.mjs', 'notebook-rail-menu.mjs', 'outline-menus.mjs']) {
    const response = await context.request.get(origin + '/' + name);
    assert.ok(response.ok(), name);
    const bytes = await response.body();
    assert.deepEqual(bytes, await readFile('web/' + name), name);
    report.served[name] = createHash('sha256').update(bytes).digest('hex');
  }
  assert.deepEqual(report.errors, []);
} catch (error) {
  report.failure = error.stack;
  if (page) await page.screenshot({ path: directory + '/failure.png' }).catch(() => {});
  throw error;
} finally {
  await browser?.close();
  fixture.stdin.end();
  report.fixture = await exit;
  report.fixtureErrors = errors();
  await writeFile(directory + '/report.json', JSON.stringify(report, null, 2) + '\n');
  assert.deepEqual(report.fixture, { code: 0, signal: null });
  assert.equal(report.fixtureErrors, '');
}

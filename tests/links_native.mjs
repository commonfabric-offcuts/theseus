import assert from 'node:assert/strict';

// Links in a message's words, and a click outside a pop-up (docs/links.md), in
// the real browser against the real server: a link on a card and in the
// Reader opens a new tab and presses nothing under it, a link to a topic here
// opens that topic here, a passage cut by a link is joined, and a press that
// starts and ends on the backdrop closes the Reader, keeping its writing, and
// Topic settings, while a drag out of either does not. A message's ⋯ and
// right-click menu copy its link and set its mark, the Reader's ⋯ holds the
// layout, a message's link opens that message in the Reader (and nothing of a
// message the reader may not see), a topic's id shows the topic's name, and a
// link to the conversation opens it. Every press is a native input event; the
// clipboard is the page's own, never the Mac's. Run by
// reader_persistence_native.mjs with --header.
export async function linksChecks({ check, page, until, control, view, facts, shot, cdp }) {
  const ELSEWHERE = 'http://127.0.0.1:1/preview?Q=1';
  const mouse = (p, type, x, y, more = {}) => p.send('Input.dispatchMouseEvent', { type, x, y, button: 'left', clickCount: 1, ...more });
  // A press at one point let go at another, the pointer moving between with the button held.
  const drag = async (p, [x1, y1], [x2, y2]) => {
    await mouse(p, 'mouseMoved', x1, y1, { button: 'none', clickCount: 0 });
    await mouse(p, 'mousePressed', x1, y1);
    await mouse(p, 'mouseMoved', (x1 + x2) / 2, (y1 + y2) / 2, { buttons: 1, clickCount: 0 });
    await mouse(p, 'mouseMoved', x2, y2, { buttons: 1, clickCount: 0 });
    await mouse(p, 'mouseReleased', x2, y2);
  };
  const pressAt = (p, x, y, more = {}) => drag(p, [x, y], [x, y]).then(() => more);
  const frame = p => p.evaluate('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(()=>r(true))))');
  const open = (p, id) => p.evaluate(`document.querySelector('#${id}').open`);
  const centre = async (p, selector) => { const b = await p.box(selector); assert.ok(b && b.width > 0, 'visible ' + selector); return [b.x + b.width / 2, b.y + b.height / 2]; };
  // The page targets in the browser now, by id and address.
  const tabs = async () => new Map((await cdp('Target.getTargets')).targetInfos.filter(t => t.type === 'page').map(t => [t.targetId, t.url]));
  // A press on the link a selector names opens one new tab at where; the tab is closed again.
  const opensTab = async (p, selector, where) => {
    const before = await tabs();
    await p.evaluate(`document.querySelector(${JSON.stringify(selector)}).scrollIntoView({block:'center'})`);
    await p.point(selector);
    const added = await until(async () => { const now = [...(await tabs())].filter(([id]) => !before.has(id)); return now.length ? now : null; }, 'a new tab opened');
    assert.deepEqual(added.map(([, url]) => url), [where], 'one new tab, at the link\'s address');
    for (const [targetId] of added) await cdp('Target.closeTarget', { targetId });
  };
  const topics = async (...items) => control({ method: 'navigation_topics', topics: items });

  await check('header links in a message open a new tab without opening its card, and a link to a topic here opens it here', async () => {
    await topics({ id: 'links-a', title: 'Links in messages' }, { id: 'links-b', title: 'Where the plan carried on' });
    const body = `The preview is at ${ELSEWHERE} now. The plan carried on in ${facts.origin}/?topic=links-b today.`;
    const id = (await control({ method: 'agent_message', operation_id: 'links-card', topic_id: 'links-a', join: true, source: 'topic', body })).result.message_id;
    const p = await page('links-card', null, true, { url: facts.origin + '/?topic=links-a' });
    const card = `#messages [data-id="${id}"]`;
    await until(() => p.evaluate(`document.querySelectorAll(${JSON.stringify(card + ' a.words-link')}).length === 2`), 'the card shows its two links');
    // A link to a topic here shows the topic's name, its address its title (docs/links.md).
    await until(() => p.evaluate(`[...document.querySelectorAll(${JSON.stringify(card + ' a.words-link')})].at(-1).textContent === 'Where the plan carried on'`), 'the topic link shows its name');
    const links = await p.evaluate(`[...document.querySelectorAll(${JSON.stringify(card + ' a.words-link')})].map(a=>[a.textContent,a.getAttribute('href'),a.target,a.rel,a.title])`);
    assert.deepEqual(links, [[ELSEWHERE, ELSEWHERE, '_blank', 'noopener noreferrer', ''], ['Where the plan carried on', '?topic=links-b', '', '', `${facts.origin}/?topic=links-b`]]);
    assert.equal(await p.evaluate(`document.querySelector(${JSON.stringify(card)}).textContent.includes(${JSON.stringify(body.replace(`${facts.origin}/?topic=links-b`, 'Where the plan carried on'))})`), true, 'every word is drawn');
    await shot(p, 'links-card');
    await opensTab(p, `${card} a.words-link[target="_blank"]`, ELSEWHERE);
    await frame(p);
    assert.deepEqual([await open(p, 'reader'), await p.evaluate('location.search')], [false, '?topic=links-a'], 'the card stays shut and the page stays');
    await p.point(`${card} a.words-link:not([target])`);
    await until(async () => await p.evaluate(`location.search === '?topic=links-b' && document.querySelector('#topic-title').textContent === 'Where the plan carried on'`), 'the topic opened here');
    assert.equal(await open(p, 'reader'), false, 'and the card did not open');
    assert.equal((await tabs()).size >= 1 && [...(await tabs()).values()].some(url => url.includes('?topic=links-b')), true, 'in this tab');
    assert.deepEqual(p.errors, []);
  });

  await check('header links in the Reader open a new tab and light no passage, a link is never cut between passages, and a drag that ends in one extends from its passage', async () => {
    await topics({ id: 'links-r', title: 'Links in the Reader' });
    // The sentence rules end a passage after the "?" inside the address.
    const body = `First sentence here. The preview is at ${ELSEWHERE} now. Last sentence.`;
    const id = (await control({ method: 'agent_message', operation_id: 'links-reader', topic_id: 'links-r', join: true, source: 'topic', body })).result.message_id;
    const p = await page('links-reader', null, true, { url: facts.origin + '/?topic=links-r' });
    const card = `#messages [data-id="${id}"] .message-preview`;
    await until(() => p.evaluate(`Boolean(document.querySelector(${JSON.stringify(card)}))`), 'the card is drawn');
    await p.point(card);
    await until(() => p.evaluate(`document.querySelector('#reader').open && document.querySelector('#source-body').textContent === ${JSON.stringify(body)}`), 'the Reader shows the message');
    await until(() => p.evaluate("document.getAnimations().every(a=>a.playState!=='running')"), 'the Reader settled');
    const passages = await p.evaluate(`[...document.querySelector('#source-body').children].map(s=>[s.textContent,[...s.querySelectorAll('a.words-link')].map(a=>a.textContent)])`);
    assert.deepEqual(passages, [['First sentence here. ', []], [`The preview is at ${ELSEWHERE} now. `, [ELSEWHERE]], ['Last sentence.', []]], 'the link sits whole in one passage');
    await shot(p, 'links-reader');
    await opensTab(p, '#source-body a.words-link', ELSEWHERE);
    await frame(p);
    assert.deepEqual([await open(p, 'reader'), await p.evaluate(`document.querySelectorAll('#source-body .hover-quote').length`)], [true, 0], 'the Reader stays, and no passage lit to quote');
    // A drag from the first passage that ends inside the link (placed by hand:
    // a press on a link drags the link, not a selection), then a native
    // Shift-click on the last passage: the light grows from the dragged passages.
    await p.evaluate(`(()=>{const s=document.querySelector('#source-body'),a=s.querySelector('a.words-link').firstChild;
      getSelection().setBaseAndExtent(s.children[0].firstChild,6,a,5)})()`);
    const [x, y] = await centre(p, '#source-body > span:last-child');
    await mouse(p, 'mouseMoved', x, y, { button: 'none', clickCount: 0, modifiers: 8 });
    await mouse(p, 'mousePressed', x, y, { modifiers: 8 });
    await mouse(p, 'mouseReleased', x, y, { modifiers: 8 });
    await until(async () => await p.evaluate(`[...document.querySelectorAll('#source-body .hover-quote')].map(s=>s.textContent).join('')`) === body, 'every passage from the dragged one to the last lights');
    assert.equal(await p.evaluate('getSelection().isCollapsed || getSelection().rangeCount === 0'), true, 'the dragged selection gave way to the light');
    assert.deepEqual(p.errors, []);
  });

  await check('header a press on the backdrop closes the Reader, keeping its writing, and a drag out of the writing or into it does not', async () => {
    const p = await page('links-outside-reader', null, true);
    await p.open(0);
    const words = 'Kept across a click outside.';
    await p.point('#writing-body'); await p.send('Input.insertText', { text: words });
    const dialog = await p.box('#reader');
    assert.ok(dialog.x > 40, 'there is backdrop beside the Reader at 1440');
    const backdrop = [dialog.x / 2, dialog.y + dialog.height / 2], field = await centre(p, '#writing-body');
    await drag(p, field, backdrop);
    await frame(p);
    assert.equal(await open(p, 'reader'), true, 'a selection dragged out of the writing and let go on the backdrop keeps it open');
    await drag(p, backdrop, field);
    await frame(p);
    assert.equal(await open(p, 'reader'), true, 'a press from the backdrop let go in the writing keeps it open');
    await mouse(p, 'mousePressed', ...backdrop, { button: 'right' }); await mouse(p, 'mouseReleased', ...backdrop, { button: 'right' });
    await frame(p);
    assert.equal(await open(p, 'reader'), true, 'a right-button press keeps it open');
    await shot(p, 'links-outside-reader-open');
    await pressAt(p, ...backdrop);
    await until(async () => !await open(p, 'reader'), 'a press on the backdrop closes it');
    assert.equal(await p.evaluate(`document.activeElement === document.querySelector('#messages [data-id="${facts.sources[0].id}"]')`), true, 'the focus is back on the card that opened it');
    await p.open(0);
    assert.equal(await p.evaluate('document.querySelector("#writing-body").value'), words, 'the writing is kept, and nothing was sent');
    assert.deepEqual(p.errors, []);
  });

  await check('header a selection dragged out of Topic settings and let go on the backdrop keeps it open; a press there closes it', async () => {
    const p = await page('links-outside-settings', null, true);
    await p.evaluate('scrollTo(0,0)');
    await p.point('#settings-open');
    await until(() => open(p, 'topic-settings'), 'Topic settings open');
    await until(() => p.evaluate("document.getAnimations().every(a=>a.playState!=='running')"), 'the dialog settled');
    const box = await p.box('#topic-settings'), note = await centre(p, '#topic-state-note');
    const backdrop = [box.x / 2, box.y + box.height / 2];
    await drag(p, note, backdrop);
    await frame(p);
    assert.equal(await open(p, 'topic-settings'), true, 'a drag from the note let go on the backdrop keeps it open');
    await drag(p, backdrop, note);
    await frame(p);
    assert.equal(await open(p, 'topic-settings'), true, 'a press from the backdrop let go on the note keeps it open');
    await pressAt(p, ...backdrop);
    await until(async () => !await open(p, 'topic-settings'), 'a press on the backdrop closes it');
    assert.equal(await p.evaluate(`document.activeElement?.id`), 'settings-open', 'the focus is back on the gear');
    assert.deepEqual(p.errors, []);
  });

  // docs/links.md, "A message's link", "A message's menu" and "Topics named in a message".
  const items = p => p.evaluate(`[...document.querySelectorAll('.message-menu-list [role=menuitem]')].map(b=>b.textContent)`);
  // A menu that lists something else fails naming what it listed.
  const menuOpen = async (p, want) => {
    let seen;
    try { await until(async () => JSON.stringify(seen = await items(p)) === JSON.stringify(want), 'the menu lists ' + want.join(', ')); }
    catch (error) { assert.deepEqual(seen, want, `${error.message} (lit: ${await p.evaluate(`[...document.querySelectorAll('#messages .lit[data-id]')].map(e=>e.dataset.id+' '+e.className).join(', ')`)})`); }
  };
  const choose = async (p, label) => {
    const at = (await items(p)).indexOf(label); assert.ok(at >= 0, 'the menu offers ' + label);
    await p.point(`.message-menu-list [role=menuitem]:nth-child(${at + 1})`);
    await until(() => p.evaluate(`!document.querySelector('.message-menu-list')`), 'the menu closed');
  };
  // The page's own clipboard: what it is handed is kept on the page, and the Mac's pasteboard is never touched.
  const clipboard = (p, fails = false) => p.evaluate(`(()=>{window.copied=[];Object.defineProperty(navigator.clipboard,'writeText',{configurable:true,
    value:async text=>{if(${fails})throw new DOMException('Refused','NotAllowedError');window.copied.push(text)}});return true})()`);
  const rightClick = async (p, x, y) => {
    await mouse(p, 'mouseMoved', x, y, { button: 'none', clickCount: 0 });
    await mouse(p, 'mousePressed', x, y, { button: 'right' }); await mouse(p, 'mouseReleased', x, y, { button: 'right' });
  };
  // Whether the page's last context menu event was left to the browser.
  const contextLog = p => p.evaluate(`(()=>{window.contexts=[];addEventListener('contextmenu',e=>contexts.push(e.defaultPrevented));return true})()`);
  const settled = p => until(() => p.evaluate("document.getAnimations().every(a=>a.playState!=='running')"), 'settled');
  const readerShows = (p, words) => until(() => p.evaluate(`document.querySelector('#reader').open && document.querySelector('#source-body').textContent === ${JSON.stringify(words)}`), 'the Reader shows ' + words);
  const post = async (operation, topic, body, more = {}) => (await control({ method: 'agent_message', operation_id: operation, topic_id: topic, join: true, source: 'topic', body, ...more })).result.message_id;
  await topics({ id: 'links-m', title: 'Links menu' }, { id: 'links-o', title: 'Other links' });
  const menuWords = 'A message with its own link to copy.';
  const menuId = await post('links-menu', 'links-m', menuWords);
  // A message's ⋯ is on the one bar over the lit message (docs/interaction.md): a card lights under the pointer, or from the keyboard.
  const menuCard = `#messages [data-id="${menuId}"]`, menuMore = '.message-bar [data-act=more]';
  const barShown = p => p.evaluate(`(()=>{const b=document.querySelector('.message-bar');return Boolean(b)&&!b.hidden&&b.offsetHeight>0})()`);
  // The pointer rests on a card, which lights it and brings up its bar.
  const light = async (p, card) => {
    const b = await p.box(card); assert.ok(b && b.width > 0, 'visible ' + card);
    await mouse(p, 'mouseMoved', Math.round(b.x + b.width / 2), Math.round(b.y + b.height - 6), { button: 'none', clickCount: 0 });
    await until(async () => await p.evaluate(`document.querySelector(${JSON.stringify(card)}).classList.contains('lit')`) && await barShown(p), 'the card lit, with its bar');
  };

  await check('header a message\'s ⋯ copies its link and says so, and sets and clears its mark, without opening the card; light and dark', async () => {
    const p = await page('links-menu', null, true, { url: facts.origin + '/?topic=links-m' });
    await until(() => p.evaluate(`Boolean(document.querySelector(${JSON.stringify(menuCard)}))`), 'the card is drawn');
    assert.equal(await p.evaluate(`document.querySelector(${JSON.stringify(menuCard)}).querySelector('button.message-menu, [data-act=more]')`), null, 'the card carries no ⋯ of its own');
    await light(p, menuCard);
    const [card, bar, more] = [await p.box(menuCard), await p.box('.message-bar'), await p.box(menuMore)];
    assert.ok(more.width >= 28 && more.height >= 28, 'a ⋯ big enough to press: ' + JSON.stringify(more));
    assert.ok(bar.x + bar.width <= card.x + card.width && card.x + card.width - (bar.x + bar.width) <= 24 && Math.abs(bar.y + bar.height / 2 - card.y) <= bar.height / 2 + 1, 'the bar over the card\'s top right corner');
    assert.ok(more.x + more.width <= bar.x + bar.width && more.x >= bar.x, 'the ⋯ on the bar');
    await clipboard(p);
    await p.point(menuMore);
    await menuOpen(p, ['Copy Link', 'Mark unread']);
    const list = await p.box('.message-menu-list');
    assert.ok(list.width < 220, 'the menu is as wide as its words: ' + list.width);
    assert.ok(Math.abs(list.x + list.width - (more.x + more.width)) < 2 && list.y >= more.y + more.height, 'under the ⋯, their right edges lined up');
    assert.equal(await p.evaluate(`document.activeElement?.textContent`), 'Copy Link', 'the first item has the focus');
    assert.equal(await p.evaluate(`document.querySelector(${JSON.stringify(menuMore)}).getAttribute('aria-expanded')`), 'true');
    await p.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'light' }] });
    await frame(p); await shot(p, 'links-menu-light');
    await p.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'dark' }] });
    await frame(p); await shot(p, 'links-menu-dark');
    await p.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'light' }] });
    await choose(p, 'Copy Link');
    const link = `${facts.origin}/?topic=links-m&message=${menuId}`;
    assert.deepEqual(await p.evaluate('window.copied'), [link], 'the message\'s link is on the clipboard');
    assert.equal(await p.evaluate(`document.querySelector(${JSON.stringify(menuMore)}).textContent`), 'Link copied');
    // The next press on the ⋯ itself opens its menu: its words change back only once that press has landed.
    // The pointer rests on the card again first: the bar is the lit message's, and the menu may have closed over another card.
    await light(p, menuCard); await p.point(menuMore); await menuOpen(p, ['Copy Link', 'Mark unread']);
    assert.equal(await p.evaluate(`document.querySelector(${JSON.stringify(menuMore)}).textContent`), '⋯', 'until the next press');
    await choose(p, 'Mark unread');
    await until(() => p.evaluate(`Boolean(document.querySelector(${JSON.stringify(menuCard + ' .unread-mark')}))`), 'the card is marked unread');
    await light(p, menuCard); await p.point(menuMore); await menuOpen(p, ['Copy Link', 'Mark read']); await choose(p, 'Mark read');
    await until(() => p.evaluate(`!document.querySelector(${JSON.stringify(menuCard + ' .unread-mark')})`), 'the mark is cleared');
    assert.equal(await open(p, 'reader'), false, 'no press opened the card');
    // Where the clipboard refuses, the link is given to select.
    await clipboard(p, true);
    await light(p, menuCard); await p.point(menuMore); await menuOpen(p, ['Copy Link', 'Mark unread']); await choose(p, 'Copy Link');
    await until(() => p.evaluate(`document.querySelector('#app-status').textContent === ${JSON.stringify('The link could not be copied here. Select it to copy it: ' + link)}`), 'the link to select');
    assert.deepEqual(p.errors, []);
  });

  await check('header a message the reader wrote offers Copy Link alone; a right-click on a card opens the menu at the pointer, and on a link or selected words the browser\'s own menu stays', async () => {
    const own = await post('links-own', 'links-m', 'My own words.', { sender: 'person', join: false });
    const linked = await post('links-linked', 'links-m', `Words around ${ELSEWHERE} a link.`);
    const p = await page('links-right', null, true, { url: facts.origin + '/?topic=links-m' });
    const ownCard = `#messages [data-id="${own}"]`, card = `#messages [data-id="${linked}"]`;
    await until(() => p.evaluate(`Boolean(document.querySelector(${JSON.stringify(ownCard)})) && Boolean(document.querySelector(${JSON.stringify(card + ' a.words-link')}))`), 'the cards are drawn');
    await light(p, ownCard);
    await p.point(menuMore); await menuOpen(p, ['Copy Link']);
    await p.key('Escape');
    await until(() => p.evaluate(`!document.querySelector('.message-menu-list') && document.activeElement === document.querySelector(${JSON.stringify(menuMore)})`), 'Escape closes it and gives the focus back');
    await contextLog(p);
    // Just past the end of the words, on the card's own space; the words fill a whole line's width, so that is where they end.
    const [x, y] = await p.evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(card + ' .message-preview')}),r=document.createRange();r.selectNodeContents(e);const l=[...r.getClientRects()].at(-1),b=e.getBoundingClientRect();
      return [Math.round(Math.min(l.right+30,b.right-10)),Math.round(l.top+l.height/2)]})()`);
    await rightClick(p, x, y);
    await menuOpen(p, ['Copy Link', 'Mark unread']);
    const list = await p.box('.message-menu-list');
    assert.deepEqual([Math.round(list.x), Math.round(list.y)], [x, y], 'at the pointer');
    assert.deepEqual(await p.evaluate('window.contexts'), [true], 'the page took that right-click');
    await p.key('ArrowDown');
    assert.equal(await p.evaluate(`document.activeElement?.textContent`), 'Mark unread', 'Down moves to the next item');
    await p.key('Escape');
    await until(() => p.evaluate(`!document.querySelector('.message-menu-list')`), 'Escape closes it');
    // On a Mac a right-click on a word selects that word before the page hears
    // it; that selection is the press's own, not the person's, and the menu
    // opens all the same, leaving no word selected.
    const word = await p.evaluate(`(()=>{const t=document.createTreeWalker(document.querySelector(${JSON.stringify(card + ' .message-preview')}),NodeFilter.SHOW_TEXT).nextNode(),r=document.createRange();r.setStart(t,0);r.setEnd(t,5);const b=r.getBoundingClientRect();return [Math.round(b.x+b.width/2),Math.round(b.y+b.height/2)]})()`);
    await rightClick(p, ...word);
    await menuOpen(p, ['Copy Link', 'Mark unread']);
    assert.equal(await p.evaluate('getSelection().isCollapsed'), true, 'no word is left selected');
    await p.key('Escape');
    await until(() => p.evaluate(`!document.querySelector('.message-menu-list')`), 'Escape closes it');
    const [lx, ly] = await centre(p, card + ' a.words-link');
    await rightClick(p, lx, ly);
    await frame(p);
    assert.deepEqual([await p.evaluate(`Boolean(document.querySelector('.message-menu-list'))`), await p.evaluate('window.contexts.at(-1)')], [false, false], 'on a link the browser\'s menu stays');
    await p.evaluate(`(()=>{const w=document.createTreeWalker(document.querySelector(${JSON.stringify(card + ' .message-preview')}),NodeFilter.SHOW_TEXT).nextNode();getSelection().setBaseAndExtent(w,0,w,5);return true})()`);
    await rightClick(p, x, y);
    await frame(p);
    assert.deepEqual([await p.evaluate(`Boolean(document.querySelector('.message-menu-list'))`), await p.evaluate('window.contexts.at(-1)')], [false, false], 'on selected words the browser\'s menu stays');
    assert.equal(await open(p, 'reader'), false, 'and the card did not open');
    assert.deepEqual(p.errors, []);
  });

  await check('header Tab reaches a message\'s ⋯, Return opens its menu, and Escape gives the focus back', async () => {
    const p = await page('links-keys', null, true, { url: facts.origin + '/?topic=links-m' });
    await until(() => p.evaluate(`Boolean(document.querySelector(${JSON.stringify(menuCard)}))`), 'the card is drawn');
    await p.evaluate(`(()=>{document.querySelector(${JSON.stringify(menuCard)}).focus();return true})()`);
    await until(() => barShown(p), 'the card the focus is on lights, with its bar');
    // Tab from the lit card goes on to its bar's buttons, in order, as its own ⋯ once followed it.
    const focused = () => p.evaluate(`(()=>{const a=document.activeElement;return a?.closest('.message-bar')?'bar:'+a.dataset.act:a===document.querySelector(${JSON.stringify(menuCard)})?'card':(a?.tagName??'')+(a?.className?'.'+a.className:'')})()`);
    const order = [];
    for (let i = 0; i < 3; i++) { await p.key('Tab'); order.push(await focused()); }
    assert.deepEqual(order, ['bar:thumb', 'bar:reply', 'bar:more'], 'Tab from the card reaches its bar\'s 👍, Reply and ⋯');
    // Shift-Tab from the bar's first button comes back to the card; Tab past its ⋯ goes on to what follows the card.
    await p.key('Tab', 8); await p.key('Tab', 8); await p.key('Tab', 8);
    assert.equal(await focused(), 'card', 'Shift-Tab from the bar\'s first button comes back to the card');
    for (let i = 0; i < 3; i++) await p.key('Tab');
    assert.equal(await focused(), 'bar:more');
    await p.key('Tab');
    assert.equal(await p.evaluate(`(()=>{const a=document.activeElement,c=document.querySelector(${JSON.stringify(menuCard)});return !a.closest('.message-bar')&&a!==c&&Boolean(c.compareDocumentPosition(a)&Node.DOCUMENT_POSITION_FOLLOWING)})()`), true, 'Tab past the ⋯ goes on from the card, not to the page\'s end');
    await p.evaluate(`(()=>{document.querySelector(${JSON.stringify(menuCard)}).focus();return true})()`);
    for (let i = 0; i < 3; i++) await p.key('Tab');
    assert.equal(await focused(), 'bar:more', 'Tab from the card reaches its ⋯');
    await p.key('Enter');
    await menuOpen(p, ['Copy Link', 'Mark unread']);
    assert.equal(await p.evaluate(`document.activeElement?.textContent`), 'Copy Link');
    await p.key('ArrowUp');
    assert.equal(await p.evaluate(`document.activeElement?.textContent`), 'Mark unread', 'Up from the first wraps to the last');
    await p.key('Escape');
    await until(() => p.evaluate(`!document.querySelector('.message-menu-list') && document.activeElement === document.querySelector(${JSON.stringify(menuMore)})`), 'closed, the focus back on the ⋯');
    assert.equal(await open(p, 'reader'), false);
    assert.deepEqual(p.errors, []);
  });

  await check('header a message\'s link opens its topic with that message in the Reader, and the address then names the topic alone', async () => {
    const p = await page('links-open', null, true, { url: `${facts.origin}/?topic=links-m&message=${menuId}` });
    await readerShows(p, menuWords);
    assert.equal(await p.evaluate('location.search'), '?topic=links-m');
    await settled(p);
    await p.key('Escape');
    await until(async () => !await open(p, 'reader'), 'Escape closes the Reader');
    assert.equal(await p.evaluate(`document.activeElement === document.querySelector(${JSON.stringify(menuCard)})`), true, 'the focus is on the message\'s card');
    await p.send('Page.reload', {});
    await until(() => p.evaluate('document.body?.dataset.ready === "true"'), 'reloaded');
    await frame(p);
    assert.equal(await open(p, 'reader'), false, 'a reload opens the topic alone');
    assert.deepEqual(p.errors, []);
  });

  await check('header a link to a message the reader may not see opens nothing of it and says so', async () => {
    const p = await page('links-unseen', null, true, { url: `${facts.origin}/?topic=links-m&message=m-${'0'.repeat(32)}` });
    await until(() => p.evaluate(`document.querySelector('#app-status').textContent === 'This message is not available to you.' && !document.querySelector('#app-status').hidden`), 'it says so');
    assert.deepEqual([await open(p, 'reader'), await p.evaluate('location.search')], [false, '?topic=links-m'], 'the topic, and no Reader');
    assert.deepEqual(p.errors, []);
  });

  await check('header a message\'s link in a message shows "Message in" and its topic\'s name, and opens it in place in its own topic or by opening its topic', async () => {
    const here = await post('links-here', 'links-o', 'The message in this topic.');
    const words = `Here: ${facts.origin}/?topic=links-o&message=${here} and there: ${facts.origin}/?topic=links-m&message=${menuId}`;
    const linking = await post('links-linking', 'links-o', words);
    const p = await page('links-message-link', null, true, { url: facts.origin + '/?topic=links-o' });
    const anchors = `#messages [data-id="${linking}"] a.words-link`;
    await until(() => p.evaluate(`JSON.stringify([...document.querySelectorAll(${JSON.stringify(anchors)})].map(a=>a.textContent)) === ${JSON.stringify(JSON.stringify(['Message in Other links', 'Message in Links menu']))}`), 'each link shows Message in and its topic\'s name');
    await shot(p, 'links-message-link');
    await p.evaluate('(()=>{window.stayed=true;return true})()');
    await p.point(`${anchors}:first-of-type`);
    await readerShows(p, 'The message in this topic.');
    assert.deepEqual([await p.evaluate('window.stayed === true'), await p.evaluate('location.search')], [true, '?topic=links-o'], 'opened in place, the page kept');
    await settled(p);
    await p.key('Escape');
    await until(async () => !await open(p, 'reader'), 'Escape closes the Reader');
    assert.equal(await p.evaluate(`document.activeElement === document.querySelector(${JSON.stringify(anchors)})`), true, 'the focus is back on the link pressed');
    await p.point(`${anchors}:last-of-type`);
    await readerShows(p, menuWords);
    assert.equal(await p.evaluate('location.search'), '?topic=links-m', 'its topic opened, with the message in the Reader');
    assert.deepEqual(p.errors, []);
  });

  await check('header a topic\'s id in a message shows the topic\'s name and opens it, by keyboard and pointer; an id no topic answers to stays words', async () => {
    const named = 't-' + 'c'.repeat(32), nowhere = 't-' + 'f'.repeat(32);
    await topics({ id: named, title: 'Named by its id' });
    const id = await post('links-ids', 'links-m', `Carry on in ${named}; not ${nowhere}.`);
    const anchor = `#messages [data-id="${id}"] a.words-link`;
    for (const how of ['keyboard', 'pointer']) {
      const p = await page('links-ids-' + how, null, true, { url: facts.origin + '/?topic=links-m' });
      await until(() => p.evaluate(`document.querySelector(${JSON.stringify(anchor)})?.textContent === 'Named by its id'`), 'the id shows its topic\'s name');
      assert.deepEqual(await p.evaluate(`(c=>[c.querySelectorAll('a.words-link').length, document.querySelector(${JSON.stringify(anchor)}).title, c.querySelector('.message-preview').textContent])(document.querySelector('#messages [data-id="${id}"]'))`),
        [1, named, `Carry on in Named by its id; not ${nowhere}.`], 'one link, its id its title; the other id is words');
      if (how === 'keyboard') { await p.evaluate(`(()=>{document.querySelector(${JSON.stringify(anchor)}).focus();return true})()`); await p.key('Enter'); }
      else await p.point(anchor);
      await until(() => p.evaluate(`location.search === '?topic=${named}' && document.querySelector('#topic-title').textContent === 'Named by its id'`), 'the topic opened by ' + how);
      assert.equal(await open(p, 'reader'), false, 'and the card did not open');
      assert.deepEqual(p.errors, []);
    }
  });

  await check('header in the Reader a topic\'s name counts as the id it stands for, so a selection after it lights from its own passage', async () => {
    const long = 't-' + 'd'.repeat(32), name = 'A topic whose name runs far longer than its id does';
    await topics({ id: long, title: name });
    const id = await post('links-reader-name', 'links-m', `Carry on in ${long} at once. Then the second one. Last sentence.`);
    const p = await page('links-reader-name', null, true, { url: facts.origin + '/?topic=links-m' });
    const preview = `#messages [data-id="${id}"] .message-preview`;
    await until(() => p.evaluate(`document.querySelector(${JSON.stringify(preview + ' a.words-link')})?.textContent === ${JSON.stringify(name)}`), 'the card shows the name');
    await p.point(preview);
    await until(() => p.evaluate(`document.querySelector('#reader').open && document.querySelector('#source-body a.words-link')?.textContent === ${JSON.stringify(name)}`), 'the Reader shows the name');
    await settled(p);
    const passages = await p.evaluate(`[...document.querySelector('#source-body').children].map(s=>s.textContent)`);
    assert.deepEqual(passages, [`Carry on in ${name} at once. `, 'Then the second one. ', 'Last sentence.']);
    // A selection in the first passage, after the name, then a native Shift-click on the last.
    await p.evaluate(`(()=>{const t=document.querySelector('#source-body a.words-link').nextSibling;getSelection().setBaseAndExtent(t,1,t,4);return true})()`);
    const [x, y] = await centre(p, '#source-body > span:last-child');
    await mouse(p, 'mouseMoved', x, y, { button: 'none', clickCount: 0, modifiers: 8 });
    await mouse(p, 'mousePressed', x, y, { modifiers: 8 });
    await mouse(p, 'mouseReleased', x, y, { modifiers: 8 });
    let lit;
    try { await until(async () => (lit = await p.evaluate(`[...document.querySelectorAll('#source-body .hover-quote')].map(s=>s.textContent)`)).length === 3, 'every passage lights'); }
    catch (error) { assert.deepEqual(lit, passages, error.message); }
    assert.deepEqual(lit, passages, 'from the passage holding the selection to the last');
    assert.deepEqual(p.errors, []);
  });

  await check('header in the Reader a selection that ends inside a topic\'s name takes the name\'s passage, so a light extended from it keeps that passage', async () => {
    const long = 't-' + 'a'.repeat(32), name = 'A name that opens its own passage';
    // A topic of its own, so the cards later checks press in Links menu stay where they were.
    await topics({ id: long, title: name }, { id: 'links-q', title: 'Quoting links' });
    const id = await post('links-reader-name-end', 'links-q', `First words here.\n${long} is next.\nLast sentence.`);
    const p = await page('links-reader-name-end', null, true, { url: facts.origin + '/?topic=links-q' });
    const preview = `#messages [data-id="${id}"] .message-preview`;
    await until(() => p.evaluate(`document.querySelector(${JSON.stringify(preview + ' a.words-link')})?.textContent === ${JSON.stringify(name)}`), 'the card shows the name');
    await p.evaluate(`document.querySelector(${JSON.stringify(preview)}).scrollIntoView({block:'center'})`);
    await p.point(preview);
    await until(() => p.evaluate(`document.querySelector('#reader').open && document.querySelector('#source-body a.words-link')?.textContent === ${JSON.stringify(name)}`), 'the Reader shows the name');
    await settled(p);
    const passages = await p.evaluate(`[...document.querySelector('#source-body').children].map(s=>s.textContent)`);
    assert.deepEqual(passages, ['First words here.\n', `${name} is next.\n`, 'Last sentence.']);
    // A selection from the first word into the name, then a native Shift-click on the first passage.
    await p.evaluate(`(()=>{getSelection().setBaseAndExtent(document.querySelector('#source-body').firstChild.firstChild,0,document.querySelector('#source-body a.words-link').firstChild,3);return true})()`);
    const [x, y] = await centre(p, '#source-body > span:first-child');
    await mouse(p, 'mouseMoved', x, y, { button: 'none', clickCount: 0, modifiers: 8 });
    await mouse(p, 'mousePressed', x, y, { modifiers: 8 });
    await mouse(p, 'mouseReleased', x, y, { modifiers: 8 });
    let lit;
    try { await until(async () => (lit = await p.evaluate(`[...document.querySelectorAll('#source-body .hover-quote')].map(s=>s.textContent)`)).length === 2, 'two passages light'); }
    catch (error) { assert.deepEqual(lit, passages.slice(0, 2), error.message); }
    assert.deepEqual(lit, passages.slice(0, 2), 'the first passage and the name\'s');
    assert.deepEqual(p.errors, []);
  });

  await check('header quoting a selection in the Reader that holds a topic\'s name, a topic\'s address or a message\'s link quotes the words the source holds, and the reply lands', async () => {
    const named = 't-' + 'e'.repeat(32);
    await topics({ id: named, title: 'Named topic for quoting' }, { id: 'links-q', title: 'Quoting links' });
    const body = `See ${named} for more. Then ${facts.origin}/?topic=links-o goes on. And ${facts.origin}/?topic=links-m&message=${menuId} last.`;
    const id = await post('links-quote-names', 'links-q', body);
    const p = await page('links-quote-names', null, true, { url: facts.origin + '/?topic=links-q' });
    const preview = `#messages [data-id="${id}"] .message-preview`;
    await until(() => p.evaluate(`document.querySelectorAll(${JSON.stringify(preview + ' a.words-link')}).length === 3`), 'the card draws its three links');
    await p.evaluate(`document.querySelector(${JSON.stringify(preview)}).scrollIntoView({block:'center'})`);
    await p.point(preview);
    const shows = ['Named topic for quoting', 'Other links', 'Message in Links menu'];
    await until(() => p.evaluate(`document.querySelector('#reader').open && JSON.stringify([...document.querySelectorAll('#source-body a.words-link')].map(a=>a.textContent)) === ${JSON.stringify(JSON.stringify(shows))}`), 'the Reader shows each link by its name');
    await settled(p);
    const from = p.calls.length, quoted = [];
    // Each selection is quoted with the button; the writing then holds the source's own words for it.
    const quote = async (select, excerpt) => {
      await select();
      await p.point('#quote-selection');
      quoted.push(excerpt);
      const writing = quoted.map(words => `> ${words}`).join('\n\n') + '\n\n';
      await until(() => p.evaluate(`document.querySelector('#writing-body').value === ${JSON.stringify(writing)}`), 'the writing quotes ' + excerpt)
        .catch(async error => assert.equal(await p.evaluate(`document.querySelector('#writing-body').value`), writing, error.message));
    };
    const select = (start, startOffset, end, endOffset) => () => p.evaluate(`(()=>{const links=document.querySelectorAll('#source-body a.words-link');
      const at=(which,offset)=>which==='first'?document.querySelector('#source-body').firstChild.firstChild:which==='last'?document.querySelector('#source-body').lastChild.lastChild:links[which].firstChild;
      getSelection().setBaseAndExtent(at(${JSON.stringify(start)}),${startOffset},at(${JSON.stringify(end)}),${endOffset});return true})()`);
    // From the first word to the last, across all three links.
    await quote(select('first', 0, 'last', ' last.'.length), body);
    // From inside one name to inside another: each link a boundary falls in is quoted whole.
    const second = `${facts.origin}/?topic=links-o`;
    await quote(select(0, 3, 1, 2), body.slice(body.indexOf(named), body.indexOf(second) + second.length));
    // Select All, by the keyboard, in the Reader's text.
    await p.evaluate(`(()=>{document.querySelector('#source-body').focus();return true})()`);
    await p.key('a', 4);
    await quote(async () => {}, body);
    await p.point('#send-reply');
    const call = await until(() => p.calls.slice(from).find(c => c.payload?.kind === 'message.send'), 'message.send call');
    let last;
    const receipt = await until(async () => { last = await view('operation', { operation_id: call.payload.operation_id }); return last.status === 'committed' && last; }, 'the reply lands')
      .catch(error => assert.fail(error.message + ': ' + JSON.stringify(last)));
    const sent = await view('source', { source_ref: { kind: 'message', id: receipt.result.message_id } });
    assert.deepEqual(sent.quotes.map(q => q.excerpt), quoted, 'each quote holds the source\'s words');
    assert.deepEqual(p.errors, []);
  });

  await check('header the Reader\'s ⋯ Copy Link names the message\'s own topic, even on a page of another', async () => {
    const conversation = (await view('conversation', { workspace_id: 'w1' })).conversation;
    await control({ method: 'agent_message', operation_id: 'links-copy-about', topic_id: conversation.topic_id, sender: 'person', reply_to: menuId, body: 'About the menu message.' });
    const p = await page('links-copy-about', null, true, { url: facts.origin + '/?conversation=w1' });
    const about = '#messages .about-line .item-link';
    await until(() => p.evaluate(`document.querySelector(${JSON.stringify(about)})?.textContent === 'Links menu'`), 'the About line names the message\'s topic');
    await p.evaluate(`document.querySelector(${JSON.stringify(about)}).scrollIntoView({block:'center'})`);
    await p.point(about);
    await readerShows(p, menuWords); await settled(p);
    await clipboard(p);
    await p.point('#reader-menu'); await menuOpen(p, ['Copy Link', 'Mark unread', 'Wide layout']); await choose(p, 'Copy Link');
    assert.deepEqual(await p.evaluate('window.copied'), [`${facts.origin}/?topic=links-m&message=${menuId}`], 'the link opens the message in its own topic');
    assert.deepEqual(p.errors, []);
  });

  await check('header the Reader\'s ⋯ holds Copy Link, the mark and Wide or Stacked layout, and at a phone\'s width no layout', async () => {
    const p = await page('links-reader-menu', null, true, { url: facts.origin + '/?topic=links-m' });
    await until(() => p.evaluate(`Boolean(document.querySelector(${JSON.stringify(menuCard + ' .message-preview')}))`), 'the card is drawn');
    await p.point(menuCard + ' .message-preview');
    await readerShows(p, menuWords); await settled(p);
    await clipboard(p);
    assert.equal(await p.evaluate(`document.querySelector('#reader-layout')`), null, 'no Wide/Stacked button: the ⋯ holds it');
    await p.point('#reader-menu');
    await menuOpen(p, ['Copy Link', 'Mark unread', 'Wide layout']);
    assert.equal(await p.evaluate(`document.querySelector('.message-menu-list').parentElement.id`), 'reader', 'inside the Reader, above the page');
    await shot(p, 'links-reader-menu');
    await choose(p, 'Wide layout');
    await until(() => p.evaluate(`document.querySelector('#reader').dataset.layout === 'wide'`), 'the Reader is wide');
    await p.point('#reader-menu'); await menuOpen(p, ['Copy Link', 'Mark unread', 'Stacked layout']); await choose(p, 'Stacked layout');
    await until(() => p.evaluate(`document.querySelector('#reader').dataset.layout === 'stacked'`), 'the Reader is stacked');
    await p.point('#reader-menu'); await menuOpen(p, ['Copy Link', 'Mark unread', 'Wide layout']); await choose(p, 'Copy Link');
    assert.deepEqual(await p.evaluate('window.copied'), [`${facts.origin}/?topic=links-m&message=${menuId}`]);
    assert.equal(await p.evaluate(`document.querySelector('#reader-menu').textContent`), 'Link copied');
    await p.key('Shift');
    assert.equal(await p.evaluate(`document.querySelector('#reader-menu').textContent`), '⋯', 'until the next key');
    await p.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
    await until(() => p.evaluate(`matchMedia('(max-width: 760px)').matches`), 'a phone\'s width');
    await settled(p);
    await p.point('#reader-menu');
    await menuOpen(p, ['Copy Link', 'Mark unread']);
    const list = await p.box('.message-menu-list');
    assert.ok(list.x >= 8 && list.x + list.width <= 390 - 8, 'inside the screen: ' + JSON.stringify(list));
    await shot(p, 'links-reader-menu-phone');
    assert.deepEqual(p.errors, []);
  });

  await check('header the Reader\'s ⋯ on a Notebook page copies its links and holds the layout, and at a phone\'s width still copies them', async () => {
    // A page of the outcome's own Notebook, listed in the rail of every topic in it.
    await control({ method: 'outcome_reference', operation_id: 'links-reader-notebook', item_id: 'links-reader-notebook', title: 'Layout notes', body: 'A page of the outcome\'s Notebook.' });
    const row = '#outcome-references-list .reference[data-id="links-reader-notebook"]';
    const p = await page('links-reader-notebook', null, true, { url: facts.origin + '/?topic=links-m' });
    const shown = () => p.evaluate(`!document.querySelector('#reader-menu').hidden && document.querySelector('#reader-menu').getClientRects().length > 0`);
    await until(() => p.evaluate(`Boolean(document.querySelector(${JSON.stringify(row)}))`), 'the Notebook page in the rail');
    await p.evaluate(`document.querySelector(${JSON.stringify(row)}).scrollIntoView({block:'center'})`);
    await p.point(row);
    await until(() => p.evaluate(`document.querySelector('#reader').open && document.querySelector('#source-body').textContent.includes("A page of the outcome's Notebook.")`), 'the Reader shows the page');
    await settled(p);
    assert.equal(await shown(), true);
    await p.point('#reader-menu'); await menuOpen(p, ['Copy Link', 'Copy Link to Revision 1', 'Wide layout']); await p.key('Escape');
    // At a phone's width there is no layout to choose, and the page's links stay.
    await p.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
    await until(() => p.evaluate('innerWidth === 390'), 'a phone\'s width');
    await until(shown, 'the ⋯ at a phone\'s width');
    await p.point('#reader-menu'); await menuOpen(p, ['Copy Link', 'Copy Link to Revision 1']); await p.key('Escape');
    await p.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
    await until(() => p.evaluate('innerWidth === 1440'), 'a wide window');
    await p.point('#reader-menu'); await menuOpen(p, ['Copy Link', 'Copy Link to Revision 1', 'Wide layout']); await p.key('Escape');
    assert.deepEqual(p.errors, []);
  });

  await check('header a link to the outcome\'s conversation, or to a message in it, opens the conversation here', async () => {
    const conversation = (await view('conversation', { workspace_id: 'w1' })).conversation;
    assert.ok(conversation?.topic_id, 'w1 has its conversation');
    const item = (await control({ method: 'agent_message', operation_id: 'links-conversation-item', topic_id: conversation.topic_id, whole_topic: true, sender: 'person', body: 'Where does the launch stand?' })).result.message_id;
    const id = await post('links-conversation', 'links-m', `Ask in ${facts.origin}/?conversation=w1 as in ${facts.origin}/?topic=${conversation.topic_id}&message=${item}`);
    const anchors = `#messages [data-id="${id}"] a.words-link`;
    for (const [which, reader] of [['first', false], ['last', true]]) {
      const p = await page('links-conversation-' + which, null, true, { url: facts.origin + '/?topic=links-m' });
      await until(() => p.evaluate(`document.querySelectorAll(${JSON.stringify(anchors)}).length === 2`), 'both links drawn');
      assert.equal(await p.evaluate(`document.querySelector(${JSON.stringify(anchors + ':first-of-type')}).target`), '', 'the conversation is one of this Theseus\'s places');
      await p.point(`${anchors}:${which}-of-type`);
      await until(() => p.evaluate(`location.search === '?conversation=w1' && document.body.classList.contains('conversation-page') && document.querySelector('#topic-title').textContent === 'Conversation'`), 'the conversation opened here');
      if (reader) await readerShows(p, 'Where does the launch stand?');
      else { await frame(p); assert.equal(await open(p, 'reader'), false); }
      assert.deepEqual(p.errors, []);
    }
  });
}

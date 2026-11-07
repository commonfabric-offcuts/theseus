import assert from 'node:assert/strict';

// Links in a message's words, and a click outside a pop-up (docs/links.md), in
// the real browser against the real server: a link on a card and in the
// Reader opens a new tab and presses nothing under it, a link to a topic here
// opens that topic here, a passage cut by a link is joined, and a press that
// starts and ends on the backdrop closes the Reader, keeping its writing, and
// Topic settings, while a drag out of either does not. Every press is a native
// input event. Run by reader_persistence_native.mjs with --header.
export async function linksChecks({ check, page, until, control, facts, shot, cdp }) {
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
    const links = await p.evaluate(`[...document.querySelectorAll(${JSON.stringify(card + ' a.words-link')})].map(a=>[a.textContent,a.getAttribute('href'),a.target,a.rel])`);
    assert.deepEqual(links, [[ELSEWHERE, ELSEWHERE, '_blank', 'noopener noreferrer'], [`${facts.origin}/?topic=links-b`, '?topic=links-b', '', '']]);
    assert.equal(await p.evaluate(`document.querySelector(${JSON.stringify(card)}).textContent.includes(${JSON.stringify(body)})`), true, 'every word is drawn');
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
}

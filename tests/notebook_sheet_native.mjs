import assert from 'node:assert/strict';

// A Notebook page in the composer over the feed (item 396, docs/decks.md "Where it opens"), in the real browser
// against the real server, at a laptop's width with a pointer and keys and at a phone's with touch: a page opened
// from the outline, the topic's own Notebook, the right rail, the outcome's page and a link as it stands brings up
// the New message sheet with the page in it; a card being written survives ✕, a press outside and Escape, and the
// feed's place and focus come back; keys and a wheel never move the feed behind; a card's reply stack opens in the
// Reader and its way back brings the page back as it was, from the same topic and from another; opening another
// page replaces the first; what changed since it was read shows on opening; a revision made elsewhere reaches the
// page while it shows and costs a closed one nothing; a reload keeps a card half written.
export async function notebookSheetChecks({ check, page, until, control, view, facts, shot }) {
  const SHEET = '#new-message-sheet', PAGE = `${SHEET} .notebook-sheet-page:not([hidden])`;
  // What the sheet shows: whether it is open as a Notebook page, its title, whether the Reader is open over the
  // feed instead, the cards that show, how many pages it holds, and the card box with its words, cursor and focus.
  const state = p => p.evaluate(`(()=>{const d=document.querySelector(${JSON.stringify(SHEET)}),pg=d.querySelector('.notebook-sheet-page:not([hidden])'),f=pg?.querySelector('.deck-writing textarea');
    return {open:d.open&&d.classList.contains('notebook-mode'),title:d.querySelector('.notebook-sheet-title')?.textContent??null,reader:document.querySelector('#reader').open,
      cards:[...(pg?.querySelectorAll('.deck-card:not([hidden]) .deck-title')??[])].map(e=>e.textContent),pages:d.querySelectorAll('.notebook-sheet-page').length,
      box:f?{words:f.value,at:[f.selectionStart,f.selectionEnd],focused:document.activeElement===f}:null}})()`);
  const waitFor = (p, probe, want, words) => until(async () => probe(await state(p)), words)
    .catch(async error => { assert.deepEqual(await state(p), want, words); throw error; });
  const opened = (p, title, cards) => waitFor(p, s => s.open && s.title === title && !s.reader && JSON.stringify(s.cards) === JSON.stringify(cards),
    { open: true, title, reader: false, cards }, `the page ${title} opens in the New message sheet over the feed, not in the Reader`);
  const closed = p => waitFor(p, s => !s.open, { open: false }, 'the sheet closes');
  const words = p => p.evaluate(`document.querySelector(${JSON.stringify(PAGE + ' .notebook-text')})?.value ?? null`);
  const settle = p => p.evaluate('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(()=>setTimeout(r,50))))');
  const scrolled = p => p.evaluate('scrollY');
  // A page's smooth scroll from a key or a wheel runs on after it starts: wait until two frames agree.
  const rested = async p => { let last = await scrolled(p); for (;;) { await settle(p); const now = await scrolled(p); if (now === last) return now; last = now; } };
  const saved = (id, part, said) => until(async () => (await view('memory_current', { item_id: id })).body.includes(part), said)
    .catch(async error => { assert.match((await view('memory_current', { item_id: id })).body, new RegExp(part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), said); throw error; });
  const outcomePage = async (id, title, body) => {
    const answer = await control({ method: 'outcome_reference', operation_id: `${id}-create`, item_id: id, title, body });
    assert.equal(answer.status, 'committed', JSON.stringify(answer));
    return id;
  };
  const topicPage = async (title, body) => {
    const id = (await control({ method: 'seed', memory_items: 1 })).item_ids[0];
    const answer = await control({ method: 'memory_revise', operation_id: `${id}-cards`, item_id: id, expected_revision: 1, title, body });
    assert.equal(answer.status, 'committed', JSON.stringify(answer));
    return id;
  };
  const card = id => `#memory-items .memory-card[data-id="${id}"]`, row = id => `#outcome-references-list .reference[data-id="${id}"]`;
  // A page listed in the topic's Notebook or the outcome's, pressing More as a reader would while the list
  // holds only its first pages (the checks before these leave many). A row or More counts once it shows: the
  // outline's section comes into view after its list and its More are drawn.
  const listed = async (p, selector, said) => {
    const more = selector.startsWith('#memory-items') ? '#more-memory' : '#more-references';
    const look = () => p.evaluate(`(()=>{const b=document.querySelector(${JSON.stringify(more)});const shown=e=>Boolean(e&&e.getClientRects().length);return {here:shown(document.querySelector(${JSON.stringify(selector)})),more:shown(b)&&!b.disabled&&b.getAttribute('aria-disabled')!=='true',rows:document.querySelector(${JSON.stringify(selector)}.split(' ')[0])?.children.length??0}})()`);
    for (;;) {
      const now = await until(async () => { const at = await look(); return at.here || at.more ? at : null; }, said);
      if (now.here) return;
      await press(p, more);
      // More while the list is being read again does nothing (outcome-references.mjs): once the read is done, More
      // is pressed again unless it brought the page.
      await until(async () => { const at = await look(); return at.here || at.rows > now.rows || at.more; }, `${said}, after More`);
    }
  };
  // A pointer on a control in view; the topic's own Notebook is at the end of the feed, scrolled to as a reader would.
  // The sidebar scrolls smoothly: brought into view at once, so the pointer aims where it stays.
  const press = async (p, selector) => {
    await p.evaluate(`document.querySelector(${JSON.stringify(selector)}).scrollIntoView({block:'center',behavior:'instant'})`);
    await p.point(selector);
  };
  // A finger, once its target holds its place.
  const tap = async (p, selector) => {
    let last = null;
    await until(async () => { const now = await p.box(selector), same = Boolean(last && now) && ['x', 'y', 'width', 'height'].every(key => now[key] === last[key]); last = now; return same; }, selector + ' holds its place');
    const x = last.x + last.width / 2, y = last.y + last.height / 2;
    assert.ok(x >= 0 && y >= 0 && x < last.viewportWidth && y < last.viewportHeight, selector + ' is on screen');
    await p.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
    await p.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  };
  // A laptop's window short enough that the topic's page scrolls under the sheet.
  const laptop = { beforeNavigate: q => q.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 600, deviceScaleFactor: 1, mobile: false }) };
  const phone = { beforeNavigate: async q => {
    await q.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
    await q.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 1 });
  } };
  // The card of that title in the sheet, by its index.
  const cardOf = async (p, title) => {
    const index = await p.evaluate(`[...document.querySelectorAll(${JSON.stringify(PAGE + ' .deck-card')})].find(r=>r.querySelector('.deck-title')?.textContent===${JSON.stringify(title)})?.dataset.index ?? null`);
    assert.notEqual(index, null, `the card ${title} shows`);
    return `${PAGE} .deck-card[data-index="${index}"]`;
  };
  // A press in a card's words opens its box there; ⌃E takes the cursor to the end of the line, and the words go in.
  const writeIn = async (p, title, text) => {
    await p.point(`${await cardOf(p, title)} .deck-words`);
    await waitFor(p, s => s.box?.focused, { box: { focused: true } }, `the card ${title} opens to write`);
    await p.key('e', 2);
    await p.send('Input.insertText', { text });
  };
  // A key as a keyboard sends it: Chrome's harness names letters' key codes alone, so the paging keys go with their
  // own (WebKit's harness presses them by name).
  const CODES = { PageUp: 33, PageDown: 34, End: 35, Home: 36, ' ': 32 };
  const keyed = async (p, name) => {
    if (p.pw || !(name in CODES)) return p.key(name);
    const data = { key: name, code: name === ' ' ? 'Space' : name, windowsVirtualKeyCode: CODES[name], ...(name === ' ' ? { text: ' ', unmodifiedText: ' ' } : {}) };
    await p.send('Input.dispatchKeyEvent', { type: name === ' ' ? 'keyDown' : 'rawKeyDown', ...data });
    await p.send('Input.dispatchKeyEvent', { type: 'keyUp', ...data });
  };
  const cardsBody = '## Plan\n\nShip it.\n\n### Steps\n\nOne, two.\n\n## Notes\n\nDan reviews.\n';

  await check('notebook in the composer: a page opened from the outline, the topic\'s Notebook, the right rail and the outcome\'s page comes up in the New message sheet over the feed, with its title, Text and Cards, Full page and ✕, at a laptop\'s width and a phone\'s', async () => {
    const plan = await outcomePage('sheet-entry-plan', 'Sheet plan', cardsBody);
    const notes = await topicPage('Sheet notes', '## First\n\nThe topic\'s own page.\n\n## Second\n\nMore.\n');
    let p = await page('notebook-sheet-entries', null, true);
    // The outline's Outcome Notebook.
    await listed(p, row(plan), 'the outline lists the page');
    await press(p, row(plan));
    await opened(p, 'Sheet plan', ['Plan', 'Steps', 'Notes']);
    const head = await p.evaluate(`(()=>{const d=document.querySelector(${JSON.stringify(SHEET)}),q=s=>d.querySelector(s),keys=q('.notebook-sheet-page:not([hidden]) .deck-keys>span:not([style*="hidden"])');
      return {full:[q('.notebook-sheet-full').getAttribute('href'),q('.notebook-sheet-full').getAttribute('aria-label'),q('.notebook-sheet-full').title],
        close:[q('.notebook-sheet-close').getAttribute('aria-label'),q('.notebook-sheet-close').title],
        views:[...d.querySelectorAll('.notebook-sheet-views button')].map(b=>[b.textContent,b.getAttribute('aria-pressed')]),
        saving:Boolean(q('.notebook-sheet-status .deck-status')),inline:q('#inline-composer').hidden,
        keys:{words:keys.textContent,fits:keys.scrollWidth<=keys.clientWidth+1,long:keys.title.length}}})()`);
    assert.deepEqual({ ...head, full: [head.full[0].replace(/^.*\?/, '?'), head.full[1], head.full[2]], keys: { ...head.keys, long: head.keys.long > 100 } }, {
      full: [`?cards=${plan}`, 'Open as a full page', 'Open as a full page'], close: ['Close, keeping your writing', 'Close, keeping your writing'],
      views: [['Text', 'false'], ['Cards', 'true']], saving: true, inline: true,
      keys: { words: '↑ ↓ pick · Return new card · ⌘Return edit', fits: true, long: true } }, 'the sheet\'s head, and its keys in one short line with the full page\'s line as its tooltip');
    // Text and Cards switch in place, writing nothing.
    const revision = (await view('memory_current', { item_id: plan })).source_ref.revision;
    await p.point(`${SHEET} .notebook-sheet-views button:first-child`);
    await until(async () => (await p.evaluate(`!document.querySelector(${JSON.stringify(PAGE + ' .notebook-text-panel')}).hidden && document.activeElement===document.querySelector(${JSON.stringify(PAGE + ' .notebook-text')})`)) && (await words(p)) === cardsBody, 'Text shows the page\'s words, ready to write');
    await shot(p, 'notebook-sheet-text');
    await p.point(`${SHEET} .notebook-sheet-views button:nth-child(2)`);
    await opened(p, 'Sheet plan', ['Plan', 'Steps', 'Notes']);
    assert.equal((await view('memory_current', { item_id: plan })).source_ref.revision, revision, 'switching views writes nothing');
    await shot(p, 'notebook-sheet-cards');
    await p.point(`${SHEET} .notebook-sheet-close`);
    await closed(p);
    // The topic's own Notebook.
    await listed(p, card(notes), 'the topic\'s Notebook lists its page');
    await press(p, card(notes));
    await opened(p, 'Sheet notes', ['First', 'Second']);
    await p.key('Escape');
    await closed(p);
    // The right rail's Notebook, which lists the topic's own pages.
    const rail = `#things .things-sec[data-key="notebook"]`, link = `${rail} a.row[href*="page=${notes}"]`;
    await until(() => p.evaluate(`Boolean(document.querySelector(${JSON.stringify(link)}))`), 'the right rail lists the page');
    if (!await p.evaluate(`document.querySelector(${JSON.stringify(rail)}).open`)) await p.point(`${rail} > summary`);
    await press(p, link);
    await opened(p, 'Sheet notes', ['First', 'Second']);
    assert.equal(await p.evaluate('location.search'), '?topic=t1', 'opened over the topic, which stays where it is');
    await p.point(`${SHEET} .notebook-sheet-close`);
    await closed(p);
    assert.deepEqual(p.errors, []);
    await p.close();
    // The outcome's own page, which lists its pages after its topics.
    p = await page('notebook-sheet-outcome-entry', null, true, { url: `${facts.origin}/?workspace=w1` });
    await listed(p, row(plan), 'the outcome page lists the page');
    await press(p, row(plan));
    await opened(p, 'Sheet plan', ['Plan', 'Steps', 'Notes']);
    assert.equal(await p.evaluate("document.querySelector('#page-here').hidden"), true, 'nothing opens in place below the list');
    assert.deepEqual(p.errors, []);
    await p.close();
    // At a phone's width, by touch, in light and in dark: the head takes two lines and one card fills the rest.
    for (const scheme of ['light', 'dark']) {
      p = await page(`notebook-sheet-phone-${scheme}`, null, true, phone);
      await p.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: scheme }] });
      await listed(p, card(notes), 'the topic\'s Notebook lists its page');
      await p.evaluate(`document.querySelector(${JSON.stringify(card(notes))}).scrollIntoView({block:'center'})`);
      await tap(p, card(notes));
      await opened(p, 'Sheet notes', ['First', 'Second']);
      await settle(p);
      const fit = await p.evaluate(`(()=>{const d=document.querySelector(${JSON.stringify(SHEET)}),r=s=>d.querySelector(s).getBoundingClientRect(),picked=d.querySelector('.notebook-sheet-page:not([hidden]) .deck-card[aria-current=true]').getBoundingClientRect();
        const small=[...d.querySelectorAll('.notebook-sheet-close,.notebook-sheet-full,.notebook-sheet-views button,.notebook-sheet-page:not([hidden]) .notebook-images>button,.notebook-sheet-page:not([hidden]) .deck-bar button')]
          .filter(b=>b.getClientRects().length).map(b=>[b.getAttribute('aria-label')||b.textContent,Math.round(b.getBoundingClientRect().width),Math.round(b.getBoundingClientRect().height)]).filter(([,w,h])=>w<44||h<44);
        return {sideways:document.documentElement.scrollWidth>innerWidth||d.scrollWidth>d.clientWidth,wraps:r('.notebook-sheet-views').top>=r('.notebook-sheet-title').bottom-1,
          small,fills:picked.height>=innerHeight*0.4&&picked.left>=0&&picked.right<=innerWidth}})()`);
      assert.deepEqual(fit, { sideways: false, wraps: true, small: [], fills: true }, `${scheme}: the sheet at a phone's width`);
      await shot(p, `notebook-sheet-phone-${scheme}`);
      await tap(p, `${SHEET} .notebook-sheet-close`);
      await closed(p);
      assert.deepEqual(p.errors, []);
      await p.close();
    }
  });

  await check('notebook in the composer: a card being written survives ✕, a press outside and Escape, which first finishes it; the feed comes back where it was, the focus on what opened the page, and the box is open again on reopening', async () => {
    const id = await topicPage('Sheet kept', cardsBody);
    const p = await page('notebook-sheet-close', null, true, laptop);
    await listed(p, card(id), 'the topic\'s Notebook lists its page');
    await p.evaluate(`document.querySelector(${JSON.stringify(card(id))}).scrollIntoView({block:'center'})`);
    const at = await scrolled(p);
    assert.ok(at > 0, 'the feed is scrolled down to the topic\'s Notebook');
    const back = async how => {
      await closed(p);
      await settle(p);
      assert.deepEqual(await p.evaluate(`({y:scrollY,focus:document.activeElement===document.querySelector(${JSON.stringify(card(id))})})`), { y: at, focus: true },
        `${how}: the feed is where it was read and the focus is on the card that opened the page`);
    };
    const reopen = async () => { await p.point(card(id)); await waitFor(p, s => s.open && s.title === 'Sheet kept' && !s.reader, { open: true, title: 'Sheet kept', reader: false }, 'the page opens again in the sheet'); };
    await reopen();
    await writeIn(p, 'Notes', ' Kept by ✕.');
    // While a card is written the short keys line is the writing's, its long words in the tooltip.
    assert.deepEqual(await p.evaluate(`(()=>{const l=document.querySelector(${JSON.stringify(PAGE + ' .deck-keys>span:not([style*="hidden"])')});return [l.textContent,l.title.startsWith('Escape')]})()`),
      ['Escape done · ⌘Return next card', true], 'the keys line says what the keys do while a card is written');
    await p.point(`${SHEET} .notebook-sheet-close`);
    await back('✕');
    await reopen();
    await waitFor(p, s => s.box?.focused && s.box.words === 'Notes\nDan reviews. Kept by ✕.' && s.box.at[0] === s.box.words.length,
      { box: { words: 'Notes\nDan reviews. Kept by ✕.', focused: true } }, 'after ✕ the card is open again to write, the cursor where it was');
    await saved(id, 'Dan reviews. Kept by ✕.', 'the unfinished card saved as it was written');
    await p.send('Input.insertText', { text: ' And outside.' });
    // A press on the backdrop, beside the sheet.
    const side = await p.evaluate(`(()=>{const r=document.querySelector(${JSON.stringify(SHEET)}).getBoundingClientRect();return {x:Math.max(4,r.left/2),y:r.top+r.height/2}})()`);
    assert.ok(side.x < (await p.box(SHEET)).x, 'the press is outside the sheet');
    await p.send('Input.dispatchMouseEvent', { type: 'mouseMoved', ...side });
    await p.send('Input.dispatchMouseEvent', { type: 'mousePressed', ...side, button: 'left', clickCount: 1 });
    await p.send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...side, button: 'left', clickCount: 1 });
    await back('a press outside');
    await reopen();
    await waitFor(p, s => s.box?.focused && s.box.words === 'Notes\nDan reviews. Kept by ✕. And outside.', { box: { words: 'Notes\nDan reviews. Kept by ✕. And outside.', focused: true } },
      'after a press outside the card is open again to write');
    // Escape: the first finishes the card, the second closes.
    await p.send('Input.insertText', { text: ' Done by Escape.' });
    await p.key('Escape');
    await waitFor(p, s => s.open && !s.box, { open: true, box: null }, 'the first Escape finishes the card and leaves the sheet open');
    await saved(id, 'And outside. Done by Escape.', 'the finished card is saved');
    await p.key('Escape');
    await back('the second Escape');
    await reopen();
    assert.equal((await state(p)).box, null, 'a card finished stays finished');
    await p.point(`${SHEET} .notebook-sheet-close`);
    await closed(p);
    assert.deepEqual(p.errors, []);
    await p.close();
    // On a phone, by touch: a card written, ✕, and open again on reopening.
    const q = await page('notebook-sheet-close-phone', null, true, phone);
    await listed(q, card(id), 'the topic\'s Notebook lists its page');
    await q.evaluate(`document.querySelector(${JSON.stringify(card(id))}).scrollIntoView({block:'center'})`);
    const phoneAt = await scrolled(q);
    await tap(q, card(id));
    await opened(q, 'Sheet kept', ['Plan', 'Steps', 'Notes']);
    await tap(q, `${PAGE} .deck-bar button:first-of-type`);
    await waitFor(q, s => s.box?.focused, { box: { focused: true } }, 'Edit opens the card in view to write');
    const written = (await state(q)).box.words;
    await q.send('Input.insertText', { text: ' Phone.' });
    await tap(q, `${SHEET} .notebook-sheet-close`);
    await closed(q);
    await settle(q);
    assert.equal(await scrolled(q), phoneAt, 'the feed is where it was read');
    await tap(q, card(id));
    await waitFor(q, s => s.open && s.box?.words === written + ' Phone.', { open: true, box: { words: written + ' Phone.' } }, 'on a phone the card is open again to write');
    await tap(q, `${SHEET} .notebook-sheet-close`);
    await closed(q);
    assert.deepEqual(q.errors, []);
    await q.close();
  });

  await check('notebook in the composer: keys the page does not use, and a wheel or trackpad over the backdrop or the sheet\'s head, move nothing behind it', async () => {
    const id = await topicPage('Sheet keys', cardsBody);
    const p = await page('notebook-sheet-keys', null, true, laptop);
    await listed(p, card(id), 'the topic\'s Notebook lists its page');
    await p.evaluate(`document.querySelector(${JSON.stringify(card(id))}).scrollIntoView({block:'center'})`);
    const wheel = async (point, deltaY) => { await p.send('Input.dispatchMouseEvent', { type: 'mouseWheel', ...point, deltaX: 0, deltaY }); await settle(p); };
    // Without the sheet a wheel over the feed moves it: what follows measures a real wheel.
    const feed = await p.evaluate(`(()=>{const r=document.querySelector('#messages').getBoundingClientRect();return {x:Math.round(r.left+r.width/2),y:Math.round(Math.min(innerHeight-40,Math.max(40,r.top+r.height/2)))}})()`);
    const start = await scrolled(p);
    assert.ok(start > 0, 'the feed is scrolled down to the topic\'s Notebook');
    await wheel(feed, -120);
    await until(async () => (await scrolled(p)) < start, 'a wheel moves the feed while nothing is open over it');
    await rested(p);
    // Nor do the paging keys: a real Page Up moves the feed while nothing is open over it.
    await p.evaluate(`(()=>{document.querySelector(${JSON.stringify(card(id))}).scrollIntoView({block:'center'});document.activeElement?.blur();return true})()`);
    const paged = await scrolled(p);
    await keyed(p, 'PageUp');
    await until(async () => (await scrolled(p)) < paged, 'Page Up moves the feed while nothing is open over it');
    await rested(p);
    await p.evaluate(`document.querySelector(${JSON.stringify(card(id))}).scrollIntoView({block:'center'})`);
    const at = await rested(p);
    await p.point(card(id));
    await opened(p, 'Sheet keys', ['Plan', 'Steps', 'Notes']);
    const still = async said => { await settle(p); assert.equal(await scrolled(p), at, said); };
    const count = () => p.evaluate(`document.querySelector(${JSON.stringify(PAGE + ' .deck-count')}).textContent`);
    await still('opening the page moves nothing behind');
    // ↑ on the first card has nowhere to go; ↓ goes through the cards and on the last has nowhere to go.
    await p.key('ArrowUp'); await still('↑ on the first card moves nothing behind');
    for (let step = 0; step < 3; step++) await p.key('ArrowDown');
    assert.equal(await count(), '3 of 3', 'the arrows the cards use still pick');
    await still('↓ past the last card moves nothing behind');
    for (const name of ['PageDown', 'End', 'PageUp', 'Home', ' ']) { await keyed(p, name); await still(`${name === ' ' ? 'Space' : name} on a card moves nothing behind`); }
    // The keys from the sheet's own controls too.
    await p.evaluate(`document.querySelector(${JSON.stringify(SHEET + ' .notebook-sheet-full')}).focus()`);
    for (const name of ['ArrowDown', 'PageDown', 'End']) { await keyed(p, name); await still(`${name} on Full page moves nothing behind`); }
    assert.equal((await state(p)).open, true, 'and the sheet stays open');
    // A wheel over the backdrop, over the sheet's head, and over cards that have nowhere to scroll.
    const sheet = await p.box(SHEET), title = await p.box(`${SHEET} .notebook-sheet-title`), cards = await p.box(`${PAGE} .deck-cards`);
    const side = { x: Math.round(sheet.x / 2), y: Math.round(sheet.y + sheet.height / 2) }, feedUnder = { x: feed.x, y: Math.round(sheet.y / 2) };
    assert.ok(sheet.x > 20 && sheet.y > 8, 'the backdrop shows beside and above the sheet');
    for (const [where, point] of [['the backdrop beside the sheet', side], ['the backdrop over the feed, above the sheet', feedUnder], ['the sheet\'s head', { x: title.x + 10, y: title.y + title.height / 2 }], ['the cards', { x: cards.x + 40, y: cards.y + 20 }]]) {
      await wheel(point, 400); await still(`a wheel down over ${where} moves nothing behind`);
      await wheel(point, -400); await still(`a wheel up over ${where} moves nothing behind`);
    }
    await p.point(`${SHEET} .notebook-sheet-close`);
    await closed(p);
    await wheel(feed, -120);
    await until(async () => (await scrolled(p)) < at, 'once the sheet is closed the wheel moves the feed again');
    assert.deepEqual(p.errors, []);
    await p.close();
  });

  await check('notebook in the composer: on a phone a finger dragged on the sheet\'s head or a card moves nothing behind it, a swipe still goes through the cards, and ✕ puts the feed back where it was read however it moved', async () => {
    const id = await topicPage('Sheet finger', cardsBody);
    const p = await page('notebook-sheet-finger', null, true, phone);
    // WebKit's harness taps but has no finger drag (webkit_native.mjs): the drags are Chrome's.
    if (p.pw) { await p.close(); return; }
    // A finger set down, drawn by (dx, dy) in ten moves, and lifted.
    const drag = async (from, dx, dy) => {
      await p.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [from] });
      for (let step = 1; step <= 10; step++) await p.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: from.x + dx * step / 10, y: from.y + dy * step / 10 }] });
      await p.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      return rested(p);
    };
    await listed(p, card(id), 'the topic\'s Notebook lists its page');
    await p.evaluate(`document.querySelector(${JSON.stringify(card(id))}).scrollIntoView({block:'center',behavior:'instant'})`);
    // Without the sheet a finger drawn down the feed moves it: what follows measures a real drag.
    const start = await rested(p);
    assert.ok(start > 0, 'the feed is scrolled down to the topic\'s Notebook');
    await drag({ x: 195, y: 300 }, 0, 150);
    assert.ok((await scrolled(p)) < start, 'a finger drag moves the feed while nothing is open over it');
    await p.evaluate(`document.querySelector(${JSON.stringify(card(id))}).scrollIntoView({block:'center',behavior:'instant'})`);
    const at = await rested(p);
    await tap(p, card(id));
    await opened(p, 'Sheet finger', ['Plan', 'Steps', 'Notes']);
    const still = async said => { assert.equal(await rested(p), at, said); assert.equal((await state(p)).open, true, `${said}, and the sheet stays open`); };
    await still('opening the page moves nothing behind');
    // Down and up on each part of the head, and on the card that fills the sheet, which has nowhere to go that way.
    for (const [where, selector] of [['the title', `${SHEET} .notebook-sheet-title`], ['the Text and Cards chips', `${SHEET} .notebook-sheet-views button:first-child`],
      ['the saving sign', `${SHEET} .notebook-sheet-status`], ['the card', `${PAGE} .deck-card[aria-current=true]`]]) {
      const b = await p.box(selector);
      assert.ok(b && b.width > 0 && b.height > 0, `${where} shows`);
      const from = { x: Math.round(b.x + Math.min(b.width / 2, 40)), y: Math.round(b.y + Math.min(b.height / 2, 20)) };
      await drag(from, 0, 150); await still(`a finger drawn down on ${where} moves nothing behind`);
      await drag(from, 0, -Math.min(150, from.y - 2)); await still(`a finger drawn up on ${where} moves nothing behind`);
    }
    // A box in the sheet that scrolls that way keeps the finger: a swipe goes on to the next card.
    const cards = `${PAGE} .deck-cards`, swiped = () => p.evaluate(`document.querySelector(${JSON.stringify(cards)}).scrollLeft`);
    const b = await p.box(`${PAGE} .deck-card[aria-current=true]`), left = await swiped();
    await drag({ x: Math.round(b.x + b.width - 30), y: Math.round(b.y + Math.min(b.height / 2, 120)) }, -240, 0);
    await until(async () => (await swiped()) > left, 'a swipe across the card goes on through the cards');
    await still('a swipe through the cards moves nothing behind');
    // However the feed moved while the sheet was up (its scrollbar dragged, which no harness here sends, stands
    // as a scroll by the page), ✕ puts it back where it was read.
    await p.evaluate(`(()=>{scrollTo({top:${at - 200},behavior:'instant'});return true})()`);
    assert.equal(await rested(p), at - 200, 'the feed moved behind the sheet');
    await tap(p, `${SHEET} .notebook-sheet-close`);
    await closed(p);
    assert.equal(await rested(p), at, '✕ puts the feed back where it was read');
    assert.deepEqual(p.errors, []);
    await p.close();
  });

  await check('notebook in the composer: a card\'s reply stack opens in the Reader with the way back to the page, and closing it brings the page back as it was, in the same topic and from another topic with the feed where it was', async () => {
    const stack = (topic, message) => `[Reply stack](${facts.origin}/?topic=${topic}&message=${message})`;
    // In the same topic: the stack opens in this page's Reader, over the feed.
    const here = (await control({ method: 'agent_message', operation_id: 'notebook-sheet-stack-here', topic_id: 't1', body: 'The stack about the plan, here.' })).result.message_id;
    const id = await topicPage('Sheet stacks', `## Plan\n\nShip it.\n\n${stack('t1', here)}\n\n## Notes\n\nDan reviews.\n`);
    let p = await page('notebook-sheet-stack-here', null, true, laptop);
    await listed(p, card(id), 'the topic\'s Notebook lists its page');
    await p.evaluate(`document.querySelector(${JSON.stringify(card(id))}).scrollIntoView({block:'center'})`);
    let at = await scrolled(p);
    await p.point(card(id));
    await opened(p, 'Sheet stacks', ['Plan', 'Notes']);
    await writeIn(p, 'Notes', ' Mine.');
    await p.point(`${await cardOf(p, 'Plan')} a.deck-bubble`);
    await until(() => p.evaluate(`document.querySelector('#reader').open && document.querySelector('#source-body').textContent.includes('The stack about the plan, here.')`), 'the stack opens in the Reader');
    assert.deepEqual(await p.evaluate(`(()=>{const b=document.querySelector('#reader .notebook-back');return {back:b&&!b.hidden?[b.textContent,b.getAttribute('aria-label'),b.title]:null,sheet:document.querySelector(${JSON.stringify(SHEET)}).open,topic:document.querySelector('#reader-parent').hidden}})()`),
      { back: ['← Sheet stacks', 'Back to the Notebook page Sheet stacks', 'Back to Sheet stacks, as you left it'], sheet: false, topic: true }, 'the Reader\'s header has the way back to the page, in place of its way to the topic');
    await shot(p, 'notebook-sheet-stack-reader');
    await p.point('#reader .notebook-back');
    await waitFor(p, s => s.open && !s.reader && s.box?.focused && s.box.words === 'Notes\nDan reviews. Mine.', { open: true, reader: false, box: { words: 'Notes\nDan reviews. Mine.', focused: true } },
      'the way back brings the page back as it was, the card still being written');
    await p.key('Escape'); await p.key('Escape');
    await closed(p);
    await settle(p);
    assert.deepEqual(await p.evaluate(`({y:scrollY,focus:document.activeElement===document.querySelector(${JSON.stringify(card(id))})})`), { y: at, focus: true },
      'closing the page puts the feed where it was read and gives the focus back to its card');
    assert.deepEqual(p.errors, []);
    await p.close();
    // From another topic: an outcome's page asks in its Conversation, so the stack opens there, and its way back
    // comes back to this topic, the feed where it was and the page open over it with its card box as it was.
    const conversation = (await view('conversation', { workspace_id: 'w1' })).conversation.topic_id;
    const there = (await control({ method: 'agent_message', operation_id: 'notebook-sheet-stack-there', topic_id: conversation, whole_topic: true, sender: 'person', body: 'The stack about the ask, in the Conversation.' })).result.message_id;
    const asks = await outcomePage('sheet-stack-asks', 'Sheet asks', `## Ask\n\nWhat next?\n\n${stack(conversation, there)}\n\n## Draft\n\nWords.\n`);
    p = await page('notebook-sheet-stack-there', null, true, laptop);
    await listed(p, row(asks), 'the outline lists the page');
    await p.evaluate(`(()=>{document.querySelector(${JSON.stringify(row(asks))}).scrollIntoView({block:'center'});scrollTo(0,Math.min(300,document.documentElement.scrollHeight-innerHeight));return true})()`);
    at = await scrolled(p);
    assert.ok(at > 0, 'the feed is scrolled down');
    await p.point(row(asks));
    await opened(p, 'Sheet asks', ['Ask', 'Draft']);
    await writeIn(p, 'Draft', ' Unsent.');
    await p.point(`${await cardOf(p, 'Ask')} a.deck-bubble`);
    await until(() => p.evaluate(`location.search!=='?topic=t1' && document.querySelector('#reader')?.open && document.querySelector('#source-body').textContent.includes('The stack about the ask, in the Conversation.')`), 'the stack opens in the Reader on the Conversation');
    await until(() => p.evaluate(`(()=>{const b=document.querySelector('#reader .notebook-back');return Boolean(b&&!b.hidden&&b.textContent==='← Sheet asks')})()`), 'the Reader there has the way back to the page');
    // Closed any way: Escape.
    await p.key('Escape');
    await until(() => p.evaluate(`location.search==='?topic=t1' && document.body.dataset.ready==='true'`), 'the way back comes back to this topic');
    await waitFor(p, s => s.open && s.title === 'Sheet asks' && s.box?.focused && s.box.words === 'Draft\nWords. Unsent.', { open: true, title: 'Sheet asks', box: { words: 'Draft\nWords. Unsent.', focused: true } },
      'the page is open over the topic again with its card box as it was');
    await saved(asks, 'Words. Unsent.', 'the unfinished card is saved');
    await p.point(`${SHEET} .notebook-sheet-close`);
    await closed(p);
    await settle(p);
    assert.equal(await scrolled(p), at, 'closing the page puts the feed where it was read before the stack');
    assert.deepEqual(p.errors, []);
    await p.close();
  });

  await check('notebook while a card is written, ← at its very start folds away its children, and stays the box\'s on a card with none or mid-text; ⌘Return goes on to a new card below, and over the feed sends no message', async () => {
    // On the cards page.
    const id = await outcomePage('sheet-left-return', 'Cards keys', cardsBody);
    let p = await page('notebook-left-return', null, true, { url: `${facts.origin}/?cards=${id}` });
    const FULL = '#deck-page';
    const box = () => p.evaluate(`(()=>{const f=document.querySelector('${FULL} .deck-writing textarea');return f?{words:f.value,at:[f.selectionStart,f.selectionEnd],focused:document.activeElement===f,above:(()=>{let a=f.closest('li').previousElementSibling;while(a?.hidden)a=a.previousElementSibling;return a?.querySelector('.deck-title')?.textContent??null})()}:null})()`);
    const shows = () => p.evaluate(`({cards:[...document.querySelectorAll('${FULL} .deck-card:not([hidden]) .deck-title')].map(e=>e.textContent),count:document.querySelector('${FULL} .deck-count').textContent,
      focus:document.activeElement?.closest?.('.deck-card')?.querySelector('.deck-title')?.textContent??null})`);
    await until(() => p.evaluate(`document.querySelectorAll('${FULL} .deck-card').length === 3`), 'the cards show');
    await p.key('Enter', 4);
    await until(async () => (await box())?.words === 'Plan\nShip it.', '⌘Return opens Plan to write');
    // ← moves the cursor through the words, then from the very start finishes the card and folds its children away.
    for (let step = 0; step < 'Plan\nShip it.'.length; step++) await p.key('ArrowLeft');
    assert.deepEqual(await box(), { words: 'Plan\nShip it.', at: [0, 0], focused: true, above: null }, '← mid-text moves the cursor and leaves the box open');
    await p.key('ArrowLeft');
    await until(async () => !(await box()), '← at the very start finishes the card');
    assert.deepEqual(await shows(), { cards: ['Plan', 'Notes'], count: '1 of 2 · 1 folded', focus: 'Plan' }, 'its children are folded away, the card picked and focused');
    assert.equal((await view('memory_current', { item_id: id })).body, cardsBody, 'folding writes nothing');
    // On a card with no children, ← at the very start stays the box's.
    await p.key('ArrowDown'); await p.key('Enter', 4);
    await until(async () => (await box())?.words === 'Notes\nDan reviews.', '⌘Return opens Notes to write');
    for (let step = 0; step <= 'Notes\nDan reviews.'.length; step++) await p.key('ArrowLeft');
    assert.deepEqual(await box(), { words: 'Notes\nDan reviews.', at: [0, 0], focused: true, above: 'Plan' }, '← at the very start of a card with no children leaves the box open');
    // ⌘Return finishes the card and opens a new one below it.
    await p.key('Enter', 4);
    await until(async () => JSON.stringify(await box()) === JSON.stringify({ words: '', at: [0, 0], focused: true, above: 'Notes' }), '⌘Return opens a new card below to write')
      .catch(async error => { assert.deepEqual(await box(), { words: '', at: [0, 0], focused: true, above: 'Notes' }, '⌘Return opens a new card below to write'); throw error; });
    await p.send('Input.insertText', { text: 'Next\nWritten after.' });
    await p.key('Enter', 4);
    await until(async () => JSON.stringify(await box()) === JSON.stringify({ words: '', at: [0, 0], focused: true, above: 'Next' }), 'and again below the card just written');
    await until(async () => (await view('memory_current', { item_id: id })).body === cardsBody + '\n## Next\n\nWritten after.\n', 'the new card is saved after Notes')
      .catch(async error => { assert.equal((await view('memory_current', { item_id: id })).body, cardsBody + '\n## Next\n\nWritten after.\n'); throw error; });
    // From an empty box ⌘Return only finishes: it never makes an empty card.
    await p.key('Enter', 4);
    await until(async () => !(await box()), '⌘Return in an empty box only finishes');
    assert.deepEqual((await shows()).cards, ['Plan', 'Notes', 'Next'], 'no empty card is made');
    assert.deepEqual(p.errors, []);
    await p.close();
    // Over the feed, in the composer: ⌘Return goes on to a new card and sends nothing.
    const topicId = await topicPage('Sheet return', '## Only\n\nOne card.\n');
    const messages = async () => (await view('topic_messages', { topic_id: 't1', direction: 'before', limit: 100 })).items.length;
    const sent = await messages();
    p = await page('notebook-sheet-return', null, true);
    await listed(p, card(topicId), 'the topic\'s Notebook lists its page');
    await press(p, card(topicId));
    await opened(p, 'Sheet return', ['Only']);
    await until(() => p.evaluate(`document.activeElement?.matches?.(${JSON.stringify(PAGE + ' .deck-card')})`), 'the picked card has the focus');
    await p.key('Enter', 4);
    await waitFor(p, s => s.box?.words === 'Only\nOne card.', { box: { words: 'Only\nOne card.' } }, '⌘Return opens the card to write');
    await p.key('Enter', 4);
    await waitFor(p, s => s.box?.focused && s.box.words === '', { box: { words: '', focused: true } }, '⌘Return opens a new card below');
    await p.send('Input.insertText', { text: 'Over the feed\nNo message.' });
    await p.key('Enter', 4); await p.key('Enter', 4);
    await waitFor(p, s => s.open && !s.box && JSON.stringify(s.cards) === JSON.stringify(['Only', 'Over the feed']), { open: true, box: null, cards: ['Only', 'Over the feed'] }, 'the cards are written and the sheet stays open');
    await saved(topicId, '## Over the feed\n\nNo message.', 'the card is saved');
    assert.equal(await messages(), sent, '⌘Return sends no message in the topic');
    await p.key('Escape');
    await closed(p);
    assert.deepEqual(p.errors, []);
    await p.close();
  });

  await check('notebook in the composer: a page opened from the keys right after ✕ closed another stays open, and its ✕ gives the focus back to its own card', async () => {
    const first = await topicPage('Sheet keyed one', cardsBody), second = await topicPage('Sheet keyed two', '## Other\n\nAnother page.\n');
    const p = await page('notebook-sheet-keyed', null, true, laptop);
    await listed(p, card(second), 'the topic\'s Notebook lists both pages');
    await press(p, card(first));
    await opened(p, 'Sheet keyed one', ['Plan', 'Steps', 'Notes']);
    // ✕, then at once Tab to the next card and Return: the browser's close event for the first page comes after the
    // second has opened, and must not put the second away.
    await p.point(`${SHEET} .notebook-sheet-close`);
    await p.key('Tab'); await p.key('Enter');
    await opened(p, 'Sheet keyed two', ['Other']);
    await settle(p); await settle(p);
    const still = await state(p);
    assert.deepEqual([still.open, still.title, still.reader, still.cards], [true, 'Sheet keyed two', false, ['Other']], 'the second page stays open over the feed');
    await p.point(`${SHEET} .notebook-sheet-close`);
    await closed(p);
    await settle(p);
    assert.equal(await p.evaluate(`document.activeElement===document.querySelector(${JSON.stringify(card(second))})`), true, 'its ✕ gives the focus back to the card that opened it');
    assert.deepEqual(p.errors, []);
    await p.close();
  });

  await check('notebook in the composer: opening another page replaces the first, whose unfinished card goes on to Core and opens again with it', async () => {
    const first = await topicPage('Sheet first', cardsBody);
    const second = await outcomePage('sheet-second', 'Sheet second', '## Other\n\nAnother page.\n');
    const p = await page('notebook-sheet-replace', null, true);
    await listed(p, card(first), 'the topic\'s Notebook lists its page');
    await press(p, card(first));
    await opened(p, 'Sheet first', ['Plan', 'Steps', 'Notes']);
    await writeIn(p, 'Notes', ' Left open.');
    await p.point(`${SHEET} .notebook-sheet-close`);
    await closed(p);
    await listed(p, row(second), 'the outline lists the second page');
    await press(p, row(second));
    await opened(p, 'Sheet second', ['Other']);
    assert.equal((await state(p)).pages, 1, 'the second page replaces the first in the sheet');
    await saved(first, 'Dan reviews. Left open.', 'the first page\'s unfinished card goes on to Core');
    // Its keys went with it: ↓ picks in the page that shows, and nowhere else.
    await p.key('ArrowDown');
    assert.equal(await p.evaluate(`document.querySelector(${JSON.stringify(PAGE + ' .deck-count')}).textContent`), '1 of 1');
    await p.point(`${SHEET} .notebook-sheet-close`);
    await closed(p);
    await press(p, card(first));
    await waitFor(p, s => s.open && s.title === 'Sheet first' && s.pages === 1 && s.box?.focused && s.box.words === 'Notes\nDan reviews. Left open.',
      { open: true, title: 'Sheet first', pages: 1, box: { words: 'Notes\nDan reviews. Left open.', focused: true } }, 'the first page comes back alone, its card box open again');
    await p.key('Escape'); await p.key('Escape');
    await closed(p);
    assert.deepEqual(p.errors, []);
    await p.close();
  });

  await check('notebook in the composer: a revision made elsewhere shows in the sheet while it is open, and a closed sheet\'s page is not read again until it opens', async () => {
    const id = await topicPage('Sheet live', '## One\n\nFirst words.\n');
    const p = await page('notebook-sheet-live', null, true);
    await listed(p, card(id), 'the topic\'s Notebook lists its page');
    await press(p, card(id));
    await opened(p, 'Sheet live', ['One']);
    let revision = (await view('memory_current', { item_id: id })).source_ref.revision;
    // What Core holds the person has read of the page.
    const readOf = async () => {
      for (let cursor = 0; ;) {
        const listed = await view('memory_items', { owner_scope: { kind: 'topic', id: 't1' }, cursor });
        const item = listed.items.find(entry => entry.id === id);
        if (item || listed.next_cursor === null) return item?.read_revision ?? null;
        cursor = listed.next_cursor;
      }
    };
    await until(async () => (await readOf()) === revision, 'opening the page reads it')
      .catch(async error => { assert.equal(await readOf(), revision, 'opening the page reads it'); throw error; });
    const revise = async body => {
      const answer = await control({ method: 'memory_revise', operation_id: `${id}-live-${revision}`, item_id: id, expected_revision: revision, title: 'Sheet live', body });
      assert.equal(answer.status, 'committed', JSON.stringify(answer)); revision += 1;
    };
    await revise('## One\n\nFirst words.\n\n## Two\n\nAn agent added this.\n');
    await opened(p, 'Sheet live', ['One', 'Two']);
    // Watched as it arrived, the revision is read: Core holds it read, and the page's card wears no light.
    await until(async () => (await readOf()) === revision, 'the revision that reached the page while it showed is read')
      .catch(async error => { assert.equal(await readOf(), revision, 'the revision that reached the page while it showed is read'); throw error; });
    await until(() => p.evaluate(`!document.querySelector(${JSON.stringify(card(id) + ' .unread-count')})`), 'the topic\'s Notebook card wears no light for it');
    // The person's own revision Core counts as read already: a card they write sends no read of it.
    const marked = () => p.calls.filter(call => call.payload?.kind === 'memory.read' && call.payload.target?.item_id === id).length, readBefore = marked();
    assert.ok(readBefore > 0, 'the reads so far are counted');
    await writeIn(p, 'Two', ' Mine.');
    await p.key('Escape');
    await saved(id, 'An agent added this. Mine.', 'the person\'s card is saved');
    revision = (await view('memory_current', { item_id: id })).source_ref.revision;
    const mine = (await control({ method: 'agent_message', operation_id: 'notebook-sheet-live-mine', topic_id: 't1', body: 'A message after the person\'s own revision.' })).result.message_id;
    await until(() => p.evaluate(`Boolean(document.querySelector('#messages [data-id="${mine}"]'))`), 'a message after the person\'s revision reaches the feed');
    await settle(p);
    assert.equal(marked() - readBefore, 0, 'the person\'s own revision sends no read');
    // Nor, all that while, was anything drawn over the cards for the revision watched as it came.
    assert.equal(await p.evaluate(`document.querySelector(${JSON.stringify(PAGE + ' .notebook-sheet-changes')}).hidden`), true, 'nothing is drawn above the cards for a revision watched as it came');
    await p.point(`${SHEET} .notebook-sheet-close`);
    await closed(p);
    const reads = () => p.calls.filter(call => call.payload?.name === 'memory_current' && call.payload.args?.item_id === id).length;
    const before = reads();
    await revise('## One\n\nFirst words.\n\n## Two\n\nAn agent added this.\n\n## Three\n\nWhile it was closed.\n');
    // The commit reached the page: the card in the topic's Notebook lights, and a message after it shows.
    await until(() => p.evaluate(`document.querySelector(${JSON.stringify(card(id) + ' .unread-count')})?.textContent==='1'`), 'the topic\'s Notebook card lights for the new revision');
    const after = (await control({ method: 'agent_message', operation_id: 'notebook-sheet-live-after', topic_id: 't1', body: 'A message after the revision.' })).result.message_id;
    await until(() => p.evaluate(`Boolean(document.querySelector('#messages [data-id="${after}"]'))`), 'a later message reaches the feed');
    await settle(p);
    assert.equal(reads() - before, 0, 'a page whose sheet is closed is not read again on a commit');
    await press(p, card(id));
    await opened(p, 'Sheet live', ['One', 'Two', 'Three']);
    assert.ok(reads() > before, 'opening it again reads it');
    await p.point(`${SHEET} .notebook-sheet-close`);
    await closed(p);
    assert.deepEqual(p.errors, []);
    await p.close();
  });

  await check('notebook in the composer: a reload while a card is written keeps the writing, and its box opens again with the page', async () => {
    const id = await topicPage('Sheet reload', cardsBody);
    // The first save is held on its way, on the first document only, so the writing is on this device alone.
    const p = await page('notebook-sheet-reload', null, true, { beforeNavigate: async q => {
      await q.send('Page.addScriptToEvaluateOnNewDocument', { source: `if(!sessionStorage.getItem('sheet-reload-held')){sessionStorage.setItem('sheet-reload-held','1');
        const originalFetch=fetch.bind(globalThis);globalThis.fetch=async(...args)=>{let kind;try{kind=JSON.parse(args[1]?.body).kind}catch{}
          if(kind==='memory.revise'){globalThis.heldSave=true;return new Promise(()=>{});}return originalFetch(...args);};}` });
    } });
    await listed(p, card(id), 'the topic\'s Notebook lists its page');
    await press(p, card(id));
    await opened(p, 'Sheet reload', ['Plan', 'Steps', 'Notes']);
    await writeIn(p, 'Notes', ' Before the reload.');
    await until(() => p.evaluate('globalThis.heldSave===true'), 'the save is on its way and held');
    assert.equal((await view('memory_current', { item_id: id })).body.includes('Before the reload.'), false, 'Core does not have it yet');
    await p.send('Page.reload', {});
    await until(async () => { try { return await p.evaluate(`document.body.dataset.ready==='true' && !globalThis.heldSave && Boolean(document.querySelector(${JSON.stringify(card(id))}))`); } catch { return false; } }, 'the page loads again');
    await press(p, card(id));
    await waitFor(p, s => s.open && s.box?.focused && s.box.words === 'Notes\nDan reviews. Before the reload.', { open: true, box: { words: 'Notes\nDan reviews. Before the reload.', focused: true } },
      'the card is open again to write, with what was written before the reload');
    await saved(id, 'Dan reviews. Before the reload.', 'the writing kept on this device goes on to Core');
    await p.key('Escape'); await p.key('Escape');
    await closed(p);
    assert.deepEqual(p.errors, []);
    await p.close();
  });
}

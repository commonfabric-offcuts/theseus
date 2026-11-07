import assert from 'node:assert/strict';

// Live updates in the real browser against the real server: the page opens one
// live WebSocket, reads nothing while nothing changes, and shows another participant's
// message as soon as it is saved.
export async function liveChecks({ check, page, until, control, observations, origin, cdp, view, facts }) {
  let serial = 0;
  const message = body => control({ method: 'agent_message', operation_id: `live-message-${++serial}`, body, topic_id: 't1', addressees: [] });
  const hasText = (p, selector, text) => p.evaluate(`document.querySelector(${JSON.stringify(selector)}).textContent.includes(${JSON.stringify(text)})`);
  // The stream's first line has arrived (its number is known), the pass it
  // asked for is done, and no retry is waiting: a first pass can be deferred
  // while the page is still starting, and that retry runs on a timer.
  const settled = p => until(() => p.evaluate('Boolean(window.observedFreshness && !observedFreshness.running && observedFreshness.timer === null && observedFreshness.live?.connected && observedFreshness.live.seq !== null)'), 'live stream connected, no pass running and no retry waiting');
  const reads = p => p.evaluate('freshEvidence.reads.length');
  // The page reports what it has seen (topic.read_through), and each report
  // is a commit the live stream announces and the page reads after, like any
  // other. Caught up: no report waiting or out, the page has heard the
  // instance's last commit and finished reading for it, and nothing was
  // committed meanwhile.
  const reporting = p => p.evaluate('Boolean(window.observedReadThrough && [...observedReadThrough.topics.values()].some(s => s.flight || s.wanted.length))');
  const caughtUp = async p => {
    for (;;) {
      await settled(p);
      // What the last paint showed is reported once the observers have run.
      await p.evaluate('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
      await until(async () => !await reporting(p), 'no report of reading waiting or out');
      const { commit_seq: last } = await control({ method: 'counts' });
      await until(() => p.evaluate(`observedFreshness.live.seq >= ${last}`), 'the page heard the last commit');
      await settled(p);
      if (!await reporting(p) && (await control({ method: 'counts' })).commit_seq === last) return;
    }
  };

  await check('live an idle topic reads nothing, and a new message shows within a second', async () => {
    const p = await page('live-topic', null, true);
    await settled(p);
    const sockets = p.network.filter(event => event.method === 'Network.webSocketCreated' && event.params.url.endsWith('/api/live'));
    assert.equal(sockets.length, 1, 'one live WebSocket per page');
    assert.equal(await p.evaluate('observedFreshness.live.opened'), 1);
    assert.equal(p.calls.filter(call => call.url.endsWith('/api/live')).length, 0, 'no HTTP stream');
    await caughtUp(p);
    const idleFrom = await reads(p), callsFrom = p.calls.length;
    await new Promise(resolve => setTimeout(resolve, 2000));
    const idleReads = (await p.evaluate('freshEvidence.reads')).slice(idleFrom);
    const idleCalls = p.calls.slice(callsFrom).map(call => [call.url.split('/api/')[1], call.payload?.kind ?? call.payload?.name]);
    assert.deepEqual({ idleReads, idleCalls }, { idleReads: [], idleCalls: [] }, 'no read while nothing changes');
    const samples = [];
    for (let n = 0; n < 5; n++) {
      const text = `Live message ${n}`, before = await reads(p);
      await message(text); const savedAt = Date.now();
      await until(() => hasText(p, '#messages', text), 'the new message is shown');
      const shownMs = Date.now() - savedAt;
      await settled(p);
      const work = (await p.evaluate('freshEvidence.reads')).slice(before);
      assert.ok(shownMs < 1000, `shown ${shownMs} ms after it was saved`);
      assert.equal(work.filter(r => r.name === 'changes').length >= 1, true);
      samples.push({ shownMs, reads: work.map(r => r.name) });
    }
    assert.equal(await p.evaluate('Boolean(window.observedReadThrough)'), true, 'the page reported reading what arrived, and the check sees those reports');
    await caughtUp(p);
    const quietFrom = await reads(p);
    await new Promise(resolve => setTimeout(resolve, 1500));
    assert.equal(await reads(p), quietFrom, 'quiet again once the messages are shown');
    observations.push({ name: 'live updates', samples });
    assert.deepEqual(p.errors, []);
    await p.close();
  });

  // A browser holds six HTTP connections per host. Seven open pages each keep
  // a live socket; the visible one must still read and show a new message, as
  // it could not if the six background pages held those six connections.
  // Background pages read when they are shown again.
  await check('live with seven pages open the visible one still reads, and each page catches up when shown', async () => {
    const pages = [];
    for (let n = 0; n < 7; n++) { pages.push(await page(`live-tab-${n}`, null, true)); await settled(pages[n]); }
    const state = p => p.evaluate('({ visible: document.visibilityState, opened: observedFreshness.live.opened, connected: observedFreshness.live.connected })');
    for (const [n, p] of pages.entries()) {
      assert.deepEqual(await state(p), { visible: n === 6 ? 'visible' : 'hidden', opened: 1, connected: true }, `page ${n}`);
    }
    const text = 'Seen by every page', savedAt = Date.now();
    await message(text);
    await until(() => hasText(pages[6], '#messages', text), 'the visible page shows the new message');
    const shownMs = Date.now() - savedAt;
    assert.ok(shownMs < 1000, `the visible page showed it ${shownMs} ms after it was saved`);
    for (const p of pages.slice(0, 6)) {
      assert.equal(await hasText(p, '#messages', text), false, 'a background page waits until it is shown');
      await p.send('Page.bringToFront');
      await until(() => hasText(p, '#messages', text), 'a page shown again catches up');
    }
    observations.push({ name: 'live updates with seven pages open', shownMs });
    for (const p of pages) { assert.deepEqual(p.errors, []); await p.close(); }
  });

  const titleCount = p => p.evaluate("Number((/^\\((\\d+)\\) /.exec(document.title) ?? [0, 0])[1])");
  const rowCount = (p, selector) => p.evaluate(`Number(document.querySelector(${JSON.stringify(selector)})?.querySelector('.unread-count')?.textContent ?? 0)`);
  const named = body => control({ method: 'agent_message', operation_id: `live-message-${++serial}`, body, topic_id: 't1', addressees: ['fixture-person'] });
  const outcomeRow = '#workspaces .nav-item[data-workspace-id="w1"]', topicRow = '#topics .nav-item[data-topic-id="t1"]';

  await check('live a message sent by name adds one to the tab title and to its outcome row', async () => {
    const p = await page('live-root', null, true, { url: origin + '/' });
    await until(() => p.evaluate(`Boolean(document.querySelector(${JSON.stringify(outcomeRow)}))`), 'outcomes listed');
    // The title's first count matches the row once the first attention answer is in.
    await until(async () => await titleCount(p) === await rowCount(p, outcomeRow), 'title and row agree at start');
    const title = await titleCount(p), row = await rowCount(p, outcomeRow), base = (await p.evaluate('document.title')).replace(/^\(\d+\) /, '');
    await named('For you by name');
    await until(async () => await titleCount(p) === title + 1 && await rowCount(p, outcomeRow) === row + 1, 'one more in the tab title and on the outcome row');
    assert.equal((await p.evaluate('document.title')).replace(/^\(\d+\) /, ''), base);
    assert.equal(await p.evaluate(`Boolean(document.querySelector(${JSON.stringify(outcomeRow)} + ' .unread-count.addressed'))`), true);
    assert.match(await p.evaluate(`document.querySelector(${JSON.stringify(outcomeRow)}).textContent`), /sent to you by name/);
    assert.match(await p.evaluate("document.querySelector('#sent-to-you').textContent"), /Sent to you by name/);
    assert.deepEqual(p.errors, []);
    await p.close();
  });

  await check('live on a topic page the rails count a message in another topic, and a page shown again reads its count', async () => {
    await control({ method: 'navigation_topics', topics: [{ id: 'live-own', title: 'Live own topic' }] });
    const p = await page('live-own', null, true, { url: origin + '/?topic=live-own' });
    await settled(p);
    await until(() => p.evaluate(`Boolean(document.querySelector(${JSON.stringify(topicRow)}))`), 'topics listed');
    await until(async () => await titleCount(p) >= await rowCount(p, topicRow), 'the first attention answer is in');
    const title = await titleCount(p), topic = await rowCount(p, topicRow);
    await named('For you, elsewhere');
    await until(async () => await titleCount(p) === title + 1 && await rowCount(p, topicRow) === topic + 1, 'the title and the topic rail row follow the commit');
    // With its live socket stopped, a page in the background learns nothing
    // until it is shown again, and then reads at once.
    await p.evaluate('observedFreshness.live.stop()');
    const other = await page('live-other', null, true, { url: origin + '/' });
    await until(() => p.evaluate("document.visibilityState === 'hidden'"), 'the topic page is in the background');
    await named('For you, while away');
    await until(() => other.evaluate(`document.title.startsWith('(${title + 2}) ')`), 'the page in front counted it');
    assert.equal(await titleCount(p), title + 1, 'the background page has not read it');
    await p.send('Page.bringToFront');
    await until(async () => await titleCount(p) === title + 2 && await rowCount(p, topicRow) === topic + 2, 'shown again, the title and the rail catch up');
    for (const each of [p, other]) { assert.deepEqual(each.errors, []); await each.close(); }
  });

  await check('live turning on notifications hides the button once the person allows them', async () => {
    const p = await page('live-notify', null, true, { url: origin + '/' });
    await until(() => p.evaluate("document.querySelector('#notify').hidden === false"), 'the button is offered');
    assert.equal(await p.evaluate('Notification.permission'), 'default');
    await cdp('Browser.setPermission', { permission: { name: 'notifications' }, setting: 'granted', origin });
    try {
      await p.point('#notify');
      await until(() => p.evaluate("document.querySelector('#notify').hidden === true"), 'the button is gone once allowed');
    } finally {
      // No notification is ever shown by this run.
      await cdp('Browser.resetPermissions', {});
    }
    assert.deepEqual(p.errors, []);
    await p.close();
  });

  // Where it stands, in Topic settings, keeps what the person typed, and
  // their focus, while messages from others repaint the topic; a chip tapped
  // straight after typing saves the typed note first, then the state, in order.
  await check('live Topic settings keeps typing and focus while messages arrive, and a tap straight after typing saves both in order', async () => {
    const p = await page('live-state-form', null, true);
    await settled(p);
    const value = selector => p.evaluate(`document.querySelector(${JSON.stringify(selector)}).value`);
    const lit = () => p.evaluate("[...document.querySelectorAll('#topic-state .state-chips button[aria-pressed=true]')].map(b => b.textContent)");
    const updates = () => p.calls.filter(call => call.payload?.kind === 'topic.update').map(call => call.payload);
    await p.evaluate('scrollTo(0, 0)');
    await p.point('#settings-open');
    await until(() => p.evaluate("document.querySelector('#topic-settings').open"), 'Topic settings is open');
    // Measured once its opening animation has run, as the person sees it.
    await until(() => p.evaluate("document.getAnimations().every(a => a.playState !== 'running')"), 'Topic settings settled');
    await p.point('#topic-state [data-state=waiting]');
    await until(async () => (await lit())[0] === 'Waiting', 'Waiting is saved and lit');
    await until(() => p.evaluate("Boolean(document.querySelector('#topic-state .people-chips button')?.offsetParent)"), 'the people show as chips');
    await p.point('#topic-state .people-chips button:first-child');
    await until(() => p.evaluate("document.querySelector('#topic-state .people-chips button:first-child').getAttribute('aria-pressed') === 'true'"), 'it waits on you');
    await p.point('#topic-state-note'); await p.send('Input.insertText', { text: 'Pick a name' });
    const top = selector => p.evaluate(`Math.round(document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect().top)`);
    const noteTop = await top('#topic-state-note');
    const text = 'Arrives while the note is being written';
    await message(text);
    await until(() => hasText(p, '#messages', text), 'the new message is shown, so the topic was read and painted again');
    await settled(p);
    assert.equal(await p.evaluate('document.activeElement.id'), 'topic-state-note', 'focus stays in the note');
    const noteNow = await top('#topic-state-note');
    assert.ok(Math.abs(noteNow - noteTop) <= 1, `the note stays where it was on the screen: ${noteTop} → ${noteNow}`);
    assert.equal(await value('#topic-state-note'), 'Pick a name', 'what the person typed is kept');
    await p.send('Input.insertText', { text: '!' });
    assert.equal(await value('#topic-state-note'), 'Pick a name!', 'typing goes on where it was');
    const before = updates().length;
    await p.point('#topic-state [data-state=review]');
    await until(async () => (await lit())[0] === 'Ready for review' && (await view('topic', { topic_id: 't1' })).topic.state === 'review', 'the tap commits');
    const sent = updates().slice(before);
    assert.deepEqual(sent.map(u => u.args), [{ note: 'Pick a name!' }, { state: 'review', keep_note: true }], 'the typed note first, then the state alone, keeping it');
    assert.deepEqual(sent.map(u => u.expected.topic_fields), [{ note: '' }, { state: 'waiting', waiting_on: [facts.actor] }], 'each fenced on what it changes');
    const held = (await view('topic', { topic_id: 't1' })).topic;
    assert.deepEqual([held.state, held.state_note], ['review', 'Pick a name!']);
    await until(() => p.evaluate("document.querySelector('#topic-description').textContent === 'Ready for review Pick a name!'"), 'the subtitle follows at once');
    assert.equal(await p.evaluate("document.querySelector('#topic-state .notice').textContent"), 'Saved', 'no refusal');
    assert.equal(await p.evaluate("document.activeElement === document.querySelector('#topic-state [data-state=review]')"), true, 'focus stays on the chip tapped after the commits and the fresh read');
    assert.deepEqual(p.errors, []);
    await p.close();
  });

  // What holds still when a message lands above it: the first card in view,
  // unless the caret is in a field on the page that is on the screen.
  await check('live a message arriving leaves the card being read in place, and a field scrolled away holds nothing', async () => {
    const p = await page('live-anchor', null, true);
    await settled(p);
    const card = "[...document.querySelectorAll('#messages .message-card')].find(card => card.getBoundingClientRect().bottom > 0)";
    const reading = () => p.evaluate(`(c => c && [c.dataset.id, Math.round(c.getBoundingClientRect().top)])(${card})`);
    // The same card, wherever it is now; a correction of a fraction of a pixel
    // lands on a whole-pixel scroll offset.
    const stays = async (was, why) => {
      const now = await p.evaluate(`Math.round(document.querySelector('#messages [data-id=${JSON.stringify(was[0])}]').getBoundingClientRect().top)`);
      assert.ok(Math.abs(now - was[1]) <= 1, `${why}: ${JSON.stringify([was, now])}`);
    };
    const arrive = async text => { await message(text); await until(() => hasText(p, '#messages', text), `${text} is shown`); await settled(p); };
    await p.evaluate("(() => { document.querySelector('#messages .message-card:last-child').scrollIntoView({block:'center'}); document.activeElement.blur(); })()");
    const before = await reading();
    assert.ok(before, 'a card is in view');
    await arrive('Arrives while a card is read');
    await stays(before, 'the card being read stays where it was');
    // The page's own field is the people's add field, below the messages: with
    // the caret in it, it is scrolled away below the screen, and a card is in view.
    const add = "document.querySelector('#participants .people-add input')";
    await p.evaluate(`(field => { field.focus(); scrollBy(0, field.getBoundingClientRect().top - innerHeight - 100); })(${add})`);
    assert.equal(await p.evaluate(`${add}.getBoundingClientRect().top >= innerHeight && document.activeElement === ${add}`), true,
      'the field with the caret is below the screen');
    const away = await reading();
    await arrive('Arrives while focus is scrolled away');
    await stays(away, 'the card in view stays where it was, not the field out of view');

    // A field on the screen being typed in holds still too; the cards above it move up.
    await p.evaluate(`(field => { field.focus(); scrollBy(0, field.getBoundingClientRect().top - 300); })(${add})`);
    const typing = await p.evaluate(`Math.round(${add}.getBoundingClientRect().top)`);
    await arrive('Arrives while a name is being typed');
    assert.ok(Math.abs(await p.evaluate(`Math.round(${add}.getBoundingClientRect().top)`) - typing) <= 1,
      'the field being typed in stays where it was');

    // The browser's own scroll anchoring must not hold the page by the rail:
    // with a rail row and a card both in view, the rail growing moves no card.
    await p.evaluate("document.activeElement.blur()");
    assert.equal(await p.evaluate(`[...document.querySelectorAll('.rail a.nav-item')].some(row => { const b = row.getBoundingClientRect(); return b.top >= 0 && b.bottom <= innerHeight; })`), true,
      'a rail row is in view');
    const railing = await reading();
    assert.ok(railing && railing[1] < 900, 'a card is in view beside it');
    await p.evaluate(`(() => { const grown = document.createElement('div'); grown.style.height = '100px'; grown.id = 'fixture-rail-growth';
      document.querySelector('.rail').prepend(grown); return new Promise(done => requestAnimationFrame(() => requestAnimationFrame(done))); })()`);
    await stays(railing, 'the rail growing moves no card');
    await p.evaluate("document.querySelector('#fixture-rail-growth').remove()");
    assert.deepEqual(p.errors, []);
    await p.close();
  });

  // On a small phone at the top of a topic whose note under its title fills
  // the first screen, with no card on the screen, a message arriving below
  // moves nothing the person is reading. The note is near its 1024-byte limit,
  // and with no header bar the screen is the small phone's.
  await check('live with no card on the screen, a message arriving scrolls nothing', async () => {
    const note = Array.from({ length: 16 }, (_, n) => `Step ${n + 1} of the plan is written out here in full words.`).join(' ');
    await control({ method: 'topic_state', operation_id: 'live-no-card-note', topic_id: 't1', args: { state: 'active', note } });
    const p = await page('live-no-card', null, true);
    await p.send('Emulation.setDeviceMetricsOverride', { width: 375, height: 667, deviceScaleFactor: 1, mobile: true });
    await settled(p);
    await p.evaluate(`(() => { document.activeElement.blur(); scrollTo(0, 0);
      return new Promise(done => requestAnimationFrame(() => requestAnimationFrame(done))); })()`);
    assert.equal(await p.evaluate("[...document.querySelectorAll('#messages .message-card')].some(card => { const b = card.getBoundingClientRect(); return b.bottom > 0 && b.top < innerHeight; })"), false,
      'no card is on the screen');
    const text = 'Arrives below the screen';
    await message(text);
    await until(() => hasText(p, '#messages', text), 'the message is shown');
    await settled(p);
    assert.equal(await p.evaluate('scrollY'), 0, 'the page did not scroll');
    assert.deepEqual(p.errors, []);
    await p.close();
    await control({ method: 'topic_state', operation_id: 'live-no-card-note-cleared', topic_id: 't1', args: { state: 'active', note: '' } });
  });

  // A Reader attachment that is refused and then opens leaves no refusal on
  // the screen, and never clears what something else has said since.
  await check('live a Reader attachment refused then opened shows no refusal, and leaves other notices', async () => {
    const p = await page('live-reader-attachment', null, true);
    await settled(p);
    await p.open(0);
    const named = name => `[...document.querySelectorAll('#source-attachments button')].find(b => b.textContent === ${JSON.stringify('Open ' + name)})`;
    const offered = name => until(() => p.evaluate(`document.querySelector('#reader').open && Boolean(${named(name)})`), 'the Reader offers ' + name);
    const opened = name => until(() => p.evaluate(`Boolean(document.querySelector('#source-attachments a[download=${JSON.stringify(name)}]'))`), name + ' opens');
    const notice = () => p.evaluate("document.querySelector('#reader-notice').hidden ? '' : document.querySelector('#reader-notice').textContent");
    const press = name => p.evaluate(`${named(name)}.focus()`).then(() => p.key('Enter'));
    const refuse = async name => {
      p.intercept((_payload, event) => event.request.url.endsWith('/api/media/read'));
      await press(name);
      const held = await until(() => p.held.find(h => !h.done && h.event.request.url.endsWith('/api/media/read')), 'the read of ' + name + ' is held');
      held.done = true; p.intercept(null); await p.fail(held);
      await until(async () => (await notice()).startsWith(name + ': '), 'the refusal names ' + name);
    };
    await offered('passive.png');
    // Two refusals with the same words: opening the first leaves the second's.
    await refuse('passive.png');
    await refuse('document.html');
    const second = await notice();
    await press('passive.png'); await opened('passive.png');
    assert.equal(await notice(), second, 'another attachment\'s refusal stays');
    await press('document.html'); await opened('document.html');
    assert.equal(await notice(), '', 'its own refusal is gone once it opens');
    // Two attachments with the same name: opening one leaves the other's refusal.
    await p.point('#reader-close');
    await until(() => p.evaluate("!document.querySelector('#reader').open"), 'the Reader closes');
    const twin = await control({ method: 'agent_message', operation_id: `live-message-${++serial}`, body: 'Two pasted images', topic_id: 't1', addressees: [],
      attachments: [{ name: 'image.png', text: 'first' }, { name: 'image.png', text: 'second' }] });
    const card = `#messages [data-id="${twin.result.message_id}"]`;
    await until(() => p.evaluate(`Boolean(document.querySelector(${JSON.stringify(card)}))`), 'the message with two attachments is shown');
    await p.evaluate(`document.querySelector(${JSON.stringify(card)}).scrollIntoView({block:'center'})`);
    await p.point(card);
    const nth = n => `[...document.querySelectorAll('#source-attachments button')].filter(b => b.textContent === 'Open image.png')[${n}]`;
    await until(() => p.evaluate(`document.querySelector('#reader').open && Boolean(${nth(1)})`), 'both attachments are offered');
    const refuseNth = async n => {
      p.intercept((_payload, event) => event.request.url.endsWith('/api/media/read'));
      await p.evaluate(`${nth(n)}.focus()`); await p.key('Enter');
      const held = await until(() => p.held.find(h => !h.done && h.event.request.url.endsWith('/api/media/read')), 'the read is held');
      held.done = true; p.intercept(null); await p.fail(held);
      await until(() => p.evaluate(`!(${nth(n)}).disabled`), 'the refusal settles');
    };
    await refuseNth(0);
    await refuseNth(1);
    const twinNotice = await notice();
    assert.ok(twinNotice.startsWith('image.png: '), twinNotice);
    await p.evaluate(`${nth(0)}.focus()`); await p.key('Enter');
    await until(() => p.evaluate("document.querySelectorAll('#source-attachments a[download=\"image.png\"]').length === 1"), 'the first opens');
    assert.equal(await notice(), twinNotice, 'the other attachment of the same name keeps its refusal');
    await p.point('#reader-close');
    await until(() => p.evaluate("!document.querySelector('#reader').open"), 'the Reader closes again');
    // A notice something else wrote since is never wiped.
    await p.open(0);
    await offered('passive.png');
    await refuse('passive.png');
    await p.evaluate("document.querySelector('#reader-notice').textContent = 'Something else said this'");
    await press('passive.png'); await opened('passive.png');
    assert.equal(await notice(), 'Something else said this', 'a notice it did not write stays');
    assert.deepEqual(p.errors, []);
    await p.close();
  });

  // On a wide, short window the rail scrolls on its own; a long rail's last
  // row can still be reached by scrolling over the rail, though the page beside
  // it is short.
  await check('live a long rail can be scrolled to its end on a short page', async () => {
    await control({ method: 'navigation_topics', topics: [{ id: 'live-rail', title: 'Live short topic' }] });
    const p = await page('live-rail-end', null, true, { url: origin + '/?topic=live-rail' });
    await p.send('Emulation.setDeviceMetricsOverride', { width: 1200, height: 1000, deviceScaleFactor: 1, mobile: false });
    await settled(p);
    assert.equal(await p.evaluate("document.querySelector('.rail').getBoundingClientRect().height > 0"), true, 'the rail is shown');
    await p.evaluate(`(() => { const rail = document.querySelector('.rail'), grown = document.createElement('div'), end = document.createElement('div');
      grown.style.height = '1500px'; end.id = 'fixture-rail-end'; end.textContent = 'The end of the rail'; rail.append(grown, end); scrollTo(0, 0);
      return new Promise(done => requestAnimationFrame(() => requestAnimationFrame(done))); })()`);
    const room = await p.evaluate("JSON.stringify({ page: document.documentElement.scrollHeight - innerHeight, header: document.querySelectorAll('.app-header').length })");
    assert.deepEqual(JSON.parse(room), { page: 0, header: 0 }, `with no header bar the page has no room to scroll: ${room}`);
    const rail = await p.evaluate("(() => { const b = document.querySelector('.rail').getBoundingClientRect(); return { x: b.x + b.width / 2, y: Math.max(b.y, 0) + 100 }; })()");
    await p.send('Input.dispatchMouseEvent', { type: 'mouseMoved', ...rail });
    const end = "(() => { const b = document.querySelector('#fixture-rail-end').getBoundingClientRect(); return b.bottom <= innerHeight; })()";
    for (let n = 0; n < 12 && !(await p.evaluate(end)); n++) {
      await p.send('Input.dispatchMouseEvent', { type: 'mouseWheel', ...rail, deltaX: 0, deltaY: 400 });
      await p.evaluate('new Promise(done => requestAnimationFrame(() => requestAnimationFrame(done)))');
    }
    assert.equal(await p.evaluate(end), true, `the rail's last row comes into view: ${await p.evaluate("JSON.stringify({ scrollY, rail: document.querySelector('.rail').scrollTop, bottom: document.querySelector('#fixture-rail-end').getBoundingClientRect().bottom })")}`);
    assert.deepEqual(p.errors, []);
    await p.close();
  });

  // A message that named the reader in a topic they have since lost: the
  // outcomes page lists its start, and Read it here shows all of it and its
  // attachment. The list is drawn again while the read's answer is held, and
  // again after the attachment is opened, and neither loses anything.
  await check('live a message sent by name in a topic you have lost can be read whole where it is listed', async () => {
    const body = 'Named before you left. ' + 'The rest of a long message. '.repeat(20) + 'The very end.';
    await control({ method: 'lost_named_message', operation_id: 'live-lost-1', body });
    const p = await page('live-lost', null, true, { url: origin + '/' });
    const item = "document.querySelector('#sent-to-you .closed-topic')";
    const press = name => p.evaluate(`[...${item}.querySelectorAll('button')].find(b => b.textContent === ${JSON.stringify(name)}).focus()`).then(() => p.key('Enter'));
    await until(() => p.evaluate(`Boolean(${item}?.textContent.includes('Named before you left.'))`), 'the lost topic\'s message is listed under Sent to you');
    assert.equal(await p.evaluate(`${item}.textContent.includes('The very end.')`), false, 'only its start is listed');
    assert.equal(await p.evaluate(`[...${item}.querySelectorAll('button')].some(b => b.textContent === 'Read it here')`), true, 'the item offers Read it here');
    p.intercept(payload => payload?.name === 'source');
    await press('Read it here');
    const held = await until(() => p.held.find(h => h.payload?.name === 'source'), 'the read\'s answer is held');
    p.intercept(null);
    await named('Arrives while the read is held');
    await until(() => p.evaluate("document.querySelector('#sent-to-you').textContent.includes('Arrives while the read is held')"), 'the list is drawn again mid-read');
    assert.equal(await p.evaluate('document.activeElement.textContent'), 'Reading…', 'the redrawn button keeps focus, and says it is reading');
    await p.release(held);
    await until(() => p.evaluate(`${item}.querySelector('.sent-whole')?.textContent.endsWith('The very end.') === true`), 'the whole message is shown where it is listed');
    assert.equal(await p.evaluate('document.activeElement.textContent'), 'Mark read', 'focus moves on to Mark read');
    const notice = () => p.evaluate(`${item}.querySelector('.notice').hidden ? '' : ${item}.querySelector('.notice').textContent`);
    p.intercept((_payload, event) => event.request.url.endsWith('/api/media/read'));
    await press('Open plan.txt');
    const refused = await until(() => p.held.find(h => h.event.request.url.endsWith('/api/media/read')), 'the attachment read is held');
    p.intercept(null);
    await p.fail(refused);
    await until(async () => (await notice()) !== '', 'a refused attachment says so on its row');
    assert.equal(await p.evaluate('document.activeElement.textContent'), 'Open plan.txt', 'focus returns to Open after a refusal');
    p.intercept((_payload, event) => event.request.url.endsWith('/api/media/read'));
    await press('Open plan.txt');
    const again = await until(() => p.held.find(h => h !== refused && h.event.request.url.endsWith('/api/media/read')), 'the second attachment read is held');
    p.intercept(null);
    await p.evaluate(`[...${item}.querySelectorAll('button')].find(b => b.textContent === 'Mark read').focus()`);
    await p.fail(again);
    await until(() => p.evaluate(`!${item}.querySelector('.attachment-label button')?.disabled`), 'the refusal settles');
    assert.equal(await p.evaluate('document.activeElement.textContent'), 'Mark read', 'focus put elsewhere meanwhile stays there');
    await press('Open plan.txt');
    await until(() => p.evaluate(`[...${item}.querySelectorAll('a')].some(a => a.textContent === 'Download plan.txt')`), 'the attachment opens from the message');
    assert.equal(await notice(), '', 'once it opens, the refusal is gone');
    assert.equal(await p.evaluate('document.activeElement.textContent'), 'Download plan.txt', 'focus moves from Open to Download');
    await named('Arrives after the attachment is open');
    await until(() => p.evaluate("document.querySelector('#sent-to-you').textContent.includes('Arrives after the attachment is open')"), 'the list is drawn again');
    assert.equal(await p.evaluate(`[...${item}.querySelectorAll('a')].some(a => a.textContent === 'Download plan.txt')`), true, 'the opened attachment stays open');
    assert.equal(await p.evaluate('document.activeElement.textContent'), 'Download plan.txt', 'and keeps the focus');
    assert.equal(await p.evaluate(`${item}.querySelector('.sent-whole').textContent.endsWith('The very end.')`), true, 'the whole message stays shown');
    assert.deepEqual(p.errors, []);
    await p.close();
  });

  // Marking a lost topic's message read takes its row out of the list; focus
  // on it goes on to the row now in its place, by key or by pointer, and never
  // falls to the page's body.
  await check('live Mark read on a lost topic\'s message hands focus to the row now in its place', async () => {
    await control({ method: 'lost_named_message', operation_id: 'live-lost-2', body: 'The older lost message.' });
    await control({ method: 'lost_named_message', operation_id: 'live-lost-3', body: 'The newer lost message.' });
    const p = await page('live-lost-mark', null, true, { url: origin + '/' });
    const row = text => `[...document.querySelectorAll('#sent-to-you .closed-topic')].find(li => li.textContent.includes(${JSON.stringify(text)}))`;
    await until(() => p.evaluate(`Boolean(${row('The older lost message.')} && ${row('The newer lost message.')})`), 'both lost messages are listed');
    await p.evaluate(`[...${row('The newer lost message.')}.querySelectorAll('button')].find(b => b.textContent === 'Mark read').focus()`);
    await p.key('Enter');
    await until(() => p.evaluate(`!${row('The newer lost message.')}`), 'the message marked read leaves the list');
    await until(() => p.evaluate(`${row('The older lost message.')}?.contains(document.activeElement) === true`), 'focus is on the row now in its place');
    assert.equal(await p.evaluate('document.activeElement.textContent'), 'Read it here');
    await p.point('#sent-to-you li.closed-topic button:nth-of-type(2)');
    await until(() => p.evaluate(`!${row('The older lost message.')}`), 'the message clicked read leaves the list');
    assert.notEqual(await p.evaluate('document.activeElement.tagName'), 'BODY');
    assert.deepEqual(p.errors, []);
    await p.close();
  });

  // Older messages that More loads appear where the loaded messages ended, so
  // the person reads on from where they asked, and what they read holds still;
  // the button's focus holds nothing still. While the oldest message not yet
  // read is further back, the New line says "More new below" and hides More,
  // so the person reads the topic and answers it first: the list then ends at
  // More's button.
  await check('live More messages shows the older messages where its button was', async () => {
    await control({ method: 'seed', messages: 45 });
    await control({ method: 'agent_message', operation_id: 'live-more-answered', sender: 'person', whole_topic: true, read: true, body: 'Answering the topic, so nothing older waits on me.' });
    const p = await page('live-more', null, true);
    await settled(p);
    await until(() => p.evaluate("document.querySelector('#more-messages').hidden === false"), 'More is offered');
    const count = await p.evaluate("document.querySelectorAll('#messages .message-card').length");
    await p.evaluate("document.querySelector('#more-messages').scrollIntoView({block:'end'})");
    const before = await p.evaluate(`(()=>{const cards=document.querySelectorAll('#messages .message-card'),last=cards[cards.length-1],end=last.nextElementSibling??document.querySelector('#more-messages');
      return {last:last.dataset.id,lastTop:Math.round(last.getBoundingClientRect().top),end:end.id||end.dataset.line,endTop:Math.round(end.getBoundingClientRect().top),button:Math.round(document.querySelector('#more-messages').getBoundingClientRect().top)}})()`);
    await p.point('#more-messages');
    assert.equal(await p.evaluate("document.activeElement.id"), 'more-messages', 'the press focuses the button');
    await until(() => p.evaluate(`document.querySelectorAll('#messages .message-card').length > ${count}`), 'older messages are loaded');
    await settled(p);
    const after = await p.evaluate(`({first:Math.round(document.querySelectorAll('#messages .message-card')[${count}].getBoundingClientRect().top),lastTop:Math.round(document.querySelector('#messages [data-id="${before.last}"]').getBoundingClientRect().top)})`);
    const seen = JSON.stringify({ before, after });
    assert.ok(Math.abs(after.lastTop - before.lastTop) <= 1, `the messages already shown hold still: ${seen}`);
    assert.ok(Math.abs(after.first - before.endTop) <= 1, `the first older message is where the loaded messages ended: ${seen}`);
    observations.push({ name: 'More messages', before, after });
    assert.deepEqual(p.errors, []);
    await p.close();
  });

  // Mark unread. Each check marks in a topic of its own, on an agent's message
  // there (a mark on the person's own message counts nowhere), which the
  // person has already read, so nothing else there waits on them and no
  // reading through settles anything while the counts are compared. With
  // older, that many of the person's own messages follow it, so it is older
  // than the first page.
  let markSerial = 0;
  const markTopic = async (title, older = 0) => {
    const id = `live-marks-${++markSerial}`;
    await control({ method: 'navigation_topics', topics: [{ id, title }] });
    const sent = await control({ method: 'agent_message', operation_id: id + '-agent', topic_id: id, source: 'topic', join: true, read: true,
      body: 'Fixture conversation, from the agent in ' + id });
    for (let n = 0; n < older; n++) await control({ method: 'agent_message', operation_id: `${id}-own-${n}`, topic_id: id, source: 'topic', sender: 'person', body: `The person's own message ${n}.` });
    return { id, message: sent.result.message_id, url: `${origin}/?topic=${id}` };
  };
  const markAs = async (ids, marked) => control({ method: 'mark', operation_id: `live-mark-${++markSerial}`, message_ids: ids, marked });
  const counts = () => control({ method: 'counts' });
  // Each message.mark the page sent, as it left the page: a request still
  // unanswered counts, so a check that none was sent cannot pass early.
  const markCalls = p => p.network.filter(e => e.method === 'Network.requestWillBeSent' && e.params.request.url.endsWith('/api/command'))
    .map(e => JSON.parse(e.params.request.postData ?? (e.params.request.postDataEntries ?? []).map(part => Buffer.from(part.bytes ?? '', 'base64').toString()).join('')))
    .filter(envelope => envelope.kind === 'message.mark');
  // The page's last open has ended, whatever became of it, and its clear (if
  // any) has left.
  const openSettled = async p => {
    await until(() => p.evaluate('freshEvidence.opens.length > 0 && freshEvidence.opens.at(-1).end !== undefined && !observedRegistry.pendingOpen'), 'the open has ended');
    await p.evaluate('new Promise(resolve => setTimeout(resolve, 0))');
  };
  const card = id => `#messages [data-id="${id}"]`;
  const pill = (p, id) => p.evaluate(`Boolean(document.querySelector(${JSON.stringify(card(id) + ' .unread-mark')}))`);
  const button = p => p.evaluate("(b => b.hidden ? null : [b.textContent, b.getAttribute('aria-pressed')])(document.querySelector('#mark-unread'))");
  const line = p => p.evaluate("document.querySelector('#topic-marks').hidden ? '' : document.querySelector('#topic-marks-words').textContent");
  const readerShows = (p, text) => p.evaluate(`document.querySelector('#reader').open && document.querySelector('#source-body').textContent.includes(${JSON.stringify(text)})`);
  const openCard = async (p, id, text) => {
    await until(() => p.evaluate(`Boolean(document.querySelector(${JSON.stringify(card(id))}))`), 'the card is drawn');
    await p.evaluate(`document.querySelector(${JSON.stringify(card(id))}).scrollIntoView({block:'center'})`);
    await p.point(card(id));
    await until(() => readerShows(p, text), 'the Reader shows the message whole');
  };
  const pressed = (p, state) => until(async () => JSON.stringify(await button(p)) === JSON.stringify(state), `the Reader button is ${state}`);
  const marksRow = id => `#topics .nav-item[data-topic-id="${id}"]`;

  // A topic the person may no longer read keeps its cards hidden as they
  // were: the next commit's reload reads the rail again and never the topic.
  await check('live a denied topic: a later commit never repaints cached content', async () => {
    const p = await page('live-denied', null, true); await settled(p);
    await control({ method: 'read_fault', name: 'changes', status: 200, count: 1,
      body: { instance_id: facts.instance_id, error: { code: 'FORBIDDEN', message: 'Fixture FORBIDDEN', retryable: false } } });
    await message('Commit that meets the refusal');
    await until(() => p.evaluate('observedFreshness.stopped'), 'topic refused');
    await until(() => hasText(p, '#updates-message', 'topic is unavailable'), 'the page says the topic is unavailable');
    await until(() => p.evaluate('appReadState().loads===0'), 'reads settled');
    assert.equal(await p.evaluate('document.querySelector("#messages").hidden'), true, 'the refusal hides the cards');
    const oldCards = await p.evaluate('document.querySelector("#messages").innerHTML');
    p.recordResponses(); const since = Date.now();
    await message('Must not paint after topic denial');
    await until(() => p.responses.some(r => r.payload?.name === 'workspace_topics' && r.at >= since), 'the commit reload ran');
    await until(() => p.evaluate('appReadState().loads===0'), 'reads settled');
    assert.equal(await p.evaluate('document.querySelector("#messages").hidden'), true);
    assert.equal(await p.evaluate('document.querySelector("#messages").innerHTML'), oldCards);
    assert.equal(await hasText(p, '#messages', 'Must not paint after topic denial'), false);
    assert.equal(p.responses.some(r => r.payload?.name === 'topic_messages' && r.at >= since), false, 'the denied topic\'s messages are not read again');
    assert.deepEqual(p.errors, []); await p.close();
  });

  // Inside an outcome the rail lists no outcomes, so the outcome row's count
  // is read on the Outcomes home, open in a page of its own.
  await check('live Mark unread in the Reader raises the title, topic and outcome counts, survives a reload, and a second page catches up', async () => {
    const topic = await markTopic('Marks: counts');
    const second = await page('live-mark-second', null, true, { url: topic.url }); await settled(second);
    const home = await page('live-mark-home', null, true, { url: origin + '/' });
    await until(() => home.evaluate(`Boolean(document.querySelector(${JSON.stringify(outcomeRow)}))`), 'outcomes listed');
    await until(async () => await titleCount(home) === (await view('attention', {})).unread, 'the home holds the first attention answer');
    const p = await page('live-mark-counts', null, true, { url: topic.url }); await settled(p);
    await until(() => p.evaluate(`Boolean(document.querySelector(${JSON.stringify(marksRow(topic.id))}))`), 'the rail is drawn');
    assert.equal(await p.evaluate(`Boolean(document.querySelector(${JSON.stringify(outcomeRow)}))`), false, 'no outcome rows inside an outcome');
    await until(async () => await titleCount(p) === (await view('attention', {})).unread, 'the title holds the first attention answer');
    const before = { title: await titleCount(p), topic: await rowCount(p, marksRow(topic.id)), outcome: await rowCount(home, outcomeRow), counts: await counts() };
    assert.equal(before.topic, 0, 'nothing waits in a topic of the person\'s own');
    await openCard(p, topic.message, 'Fixture conversation');
    assert.deepEqual(markCalls(p), [], 'opening what is not marked sends nothing');
    await pressed(p, ['Mark unread', 'false']);
    await p.point('#mark-unread');
    await pressed(p, ['Marked unread', 'true']);
    await until(async () => await titleCount(p) === before.title + 1 && await rowCount(p, marksRow(topic.id)) === 1,
      'the title and the topic row each count one more');
    assert.equal(await pill(p, topic.message), true, 'the card behind the Reader shows Unread');
    const after = await counts();
    assert.deepEqual([after.marked - before.counts.marked, after.mark_operations - before.counts.mark_operations], [1, 1]);
    assert.deepEqual([after.acknowledged_deliveries, after.http_delivery_acks], [before.counts.acknowledged_deliveries, before.counts.http_delivery_acks], 'a mark settles no delivery');
    await second.send('Page.bringToFront');
    await until(async () => await titleCount(second) === before.title + 1 && await rowCount(second, marksRow(topic.id)) === 1 && await pill(second, topic.message) &&
      await line(second) === '1 message marked unread', 'the second page catches up when shown');
    await home.send('Page.bringToFront');
    await until(async () => await titleCount(home) === before.title + 1 && await rowCount(home, outcomeRow) === before.outcome + 1, 'the outcome row on the home counts one more');
    await p.send('Page.bringToFront');
    await p.send('Page.navigate', { url: topic.url });
    await until(() => p.evaluate('document.body?.dataset.ready === "true"'), 'the page is read again');
    await until(async () => await pill(p, topic.message) && await line(p) === '1 message marked unread' && await titleCount(p) === before.title + 1, 'the mark survives a reload');
    assert.deepEqual(markCalls(p).length, 1, 'loading the topic clears nothing');
    for (const each of [p, second, home]) { assert.deepEqual(each.errors, []); await each.close(); }
    await markAs([topic.message], false);
  });

  await check('live a card click clears the mark at the revision the page saw', async () => {
    const topic = await markTopic('Marks: card');
    const [marked] = await markAs([topic.message], true);
    const p = await page('live-mark-card', null, true, { url: topic.url }); await settled(p);
    await until(async () => await pill(p, topic.message) && await line(p) === '1 message marked unread', 'the card and the line show the mark');
    const before = await counts();
    await openCard(p, topic.message, 'Fixture conversation');
    await until(async () => (await counts()).marked === before.marked - 1, 'the open cleared the mark');
    assert.deepEqual(markCalls(p).map(m => [m.target.message_id, m.args.marked, m.expected.mark_revision]), [[topic.message, false, marked.mark_revision]]);
    await until(async () => !(await pill(p, topic.message)) && await line(p) === '', 'the pill and the line are gone');
    await pressed(p, ['Mark unread', 'false']);
    assert.deepEqual(p.errors, []); await p.close();
  });

  await check('live Read it pressed from the keyboard hands focus to the page when it clears the last mark', async () => {
    const topic = await markTopic('Marks: focus after the last');
    await markAs([topic.message], true);
    const p = await page('live-mark-last-focus', null, true, { url: topic.url }); await settled(p);
    await until(async () => await line(p) === '1 message marked unread', 'the line shows');
    await p.evaluate("document.querySelector('#read-mark').focus()");
    await p.key('Enter');
    await until(() => readerShows(p, 'Fixture conversation'), 'Read it opens');
    await until(async () => await line(p) === '', 'the last mark clears and the line goes');
    await p.key('Escape');
    await until(() => p.evaluate("!document.querySelector('#reader').open && document.activeElement?.id === 'main'"), 'the Reader closes and the page holds focus');
    assert.ok(await p.evaluate("document.activeElement.matches(':focus-visible')"), 'focus came from the keyboard, so Chrome would ring it');
    assert.equal(await p.evaluate("getComputedStyle(document.activeElement).outlineStyle"), 'none', 'no ring is drawn around the whole page');
    assert.deepEqual(p.errors, []); await p.close();
  });

  await check('live Read it lands on a message older than the first page and clears it', async () => {
    const topic = await markTopic('Marks: Read it, further back', 30), oldest = topic.message;
    const [marked] = await markAs([oldest], true);
    const p = await page('live-mark-read-it', null, true, { url: topic.url }); await settled(p);
    await until(async () => await line(p) === '1 message marked unread', 'the topic says one message is marked');
    assert.equal(await p.evaluate(`Boolean(document.querySelector(${JSON.stringify(card(oldest))}))`), false, 'the marked message is older than the loaded page');
    await p.evaluate("document.querySelector('#read-mark').focus()");
    await p.key('Enter');
    await until(() => readerShows(p, 'Fixture conversation, from the agent in ' + topic.id), 'Read it opens the marked message whole');
    await until(async () => await line(p) === '', 'the line goes once the mark is cleared');
    assert.deepEqual(markCalls(p).map(m => [m.target.message_id, m.args.marked, m.expected.mark_revision]), [[oldest, false, marked.mark_revision]]);
    assert.equal((await view('editor_state', { source_ref: { kind: 'message', id: oldest }, topic_id: topic.id })).mark.marked, false);
    assert.deepEqual(p.errors, []); await p.close();
  });

  await check('live a refused or failed source read clears nothing', async () => {
    const topic = await markTopic('Marks: refused');
    await markAs([topic.message], true);
    const p = await page('live-mark-refused', null, true, { url: topic.url }); await settled(p);
    await until(() => pill(p, topic.message), 'the card shows the mark');
    const status = () => p.evaluate("document.querySelector('#app-status').hidden ? '' : document.querySelector('#app-status').textContent");
    for (const [status_, code] of [[403, 'FORBIDDEN'], [500, 'SERVER_FAILURE']]) {
      await control({ method: 'read_fault', name: 'source', status: status_, body: { error: { code, message: `Injected ${code}` } }, count: 1 });
      await p.evaluate(`document.querySelector(${JSON.stringify(card(topic.message))}).scrollIntoView({block:'center'})`);
      await p.point(card(topic.message));
      await until(async () => (await status()).includes(`Injected ${code}`), `the ${status_} refusal is reported`);
      await openSettled(p);
      assert.equal(await p.evaluate("document.querySelector('#reader').open"), false);
    }
    p.intercept(payload => payload?.name === 'source');
    await p.point(card(topic.message));
    const held = await until(() => p.held.find(h => h.payload?.name === 'source'), 'the source read is held');
    p.intercept(null); await p.fail(held);
    await until(async () => (await status()) !== '', 'the failed read is reported');
    await openSettled(p);
    assert.equal(await p.evaluate("document.querySelector('#reader').open"), false);
    assert.deepEqual(markCalls(p), []);
    assert.equal(await pill(p, topic.message), true);
    assert.equal((await view('marks', { topic_id: topic.id })).items.length, 1, 'the mark stays');
    assert.deepEqual(p.errors, []); await p.close();
    await markAs([topic.message], false);
  });

  await check('live Escape while the source is read cancels the open and clears nothing', async () => {
    const topic = await markTopic('Marks: Escape');
    await markAs([topic.message], true);
    const p = await page('live-mark-escape', null, true, { url: topic.url }); await settled(p);
    await until(() => pill(p, topic.message), 'the card shows the mark');
    p.intercept(payload => payload?.name === 'source');
    await p.evaluate(`document.querySelector(${JSON.stringify(card(topic.message))}).scrollIntoView({block:'center'})`);
    await p.point(card(topic.message));
    const held = await until(() => p.held.find(h => h.payload?.name === 'source'), 'the source read is held');
    p.intercept(null);
    assert.equal(await p.evaluate("document.querySelector('#reader').open"), false, 'no Reader yet');
    await p.key('Escape');
    await p.release(held);
    await openSettled(p);
    assert.equal(await p.evaluate("document.querySelector('#reader').open"), false, 'the cancelled open never shows');
    assert.deepEqual(markCalls(p), []);
    assert.equal((await view('marks', { topic_id: topic.id })).items.length, 1);
    // The card opens on the next press, and that open clears.
    await openCard(p, topic.message, 'Fixture conversation');
    await until(async () => markCalls(p).length === 1 && await line(p) === '', 'a later open clears');
    assert.deepEqual(p.errors, []); await p.close();
  });

  // While a document's own navigation is held, DevTools holds every command
  // to its frame (Runtime.evaluate included) until the navigation goes on,
  // and then runs it in the next document. So the leaving document reports
  // through a binding, an event it sends itself, when its open has ended.
  await check('live a page that leaves while the source and the next page are held clears nothing', async () => {
    const topic = await markTopic('Marks: leaving'), away = await markTopic('Marks: elsewhere');
    await markAs([topic.message], true);
    const p = await page('live-mark-leave', null, true, { url: topic.url }); await settled(p);
    await until(async () => await pill(p, topic.message) && await p.evaluate(`Boolean(document.querySelector(${JSON.stringify(marksRow(away.id))}))`), 'the mark and the other topic are shown');
    const before = await counts();
    await p.send('Runtime.addBinding', { name: 'leavingOpenEnded' });
    // When the next open ends, and a turn later (when any clear it earned has
    // left), the document says where it is and what it shows.
    await p.evaluate(`(() => { const opens = freshEvidence.opens; opens.push = function (record) {
      let end; Object.defineProperty(record, 'end', { enumerable: true, get: () => end, set: value => { end = value;
        setTimeout(() => leavingOpenEnded(JSON.stringify({ search: location.search, readerOpen: document.querySelector('#reader').open,
          pendingOpen: Boolean(observedRegistry.pendingOpen), error: record.error ?? null })), 0); } });
      return Array.prototype.push.call(this, record); }; })()`);
    await p.send('Fetch.enable', { patterns: [{ urlPattern: origin + '/api/*', requestStage: 'Response' }, { urlPattern: origin + '/app.mjs', requestStage: 'Response' },
      { urlPattern: origin + '/upload-cleanup.mjs', requestStage: 'Response' }, { urlPattern: away.url, requestStage: 'Response' }] });
    p.intercept((payload, event) => payload?.name === 'source' || event.request.url === away.url);
    await p.evaluate(`document.querySelector(${JSON.stringify(card(topic.message))}).scrollIntoView({block:'center'})`);
    await p.point(card(topic.message));
    const source = await until(() => p.held.find(h => h.payload?.name === 'source'), 'the source read is held');
    await p.evaluate(`document.querySelector(${JSON.stringify(marksRow(away.id))}).scrollIntoView({block:'center'})`);
    await p.point(marksRow(away.id));
    const next = await until(() => p.held.find(h => h.event.request.url === away.url), 'the next page is held');
    p.intercept(null);
    // From here until the next page goes on, nothing is asked of the page.
    await p.send('Fetch.continueResponse', { requestId: source.event.requestId });
    const ended = await until(() => p.events.find(e => e.method === 'Runtime.bindingCalled' && e.params.name === 'leavingOpenEnded'), 'the leaving document reports its open ended');
    assert.deepEqual(JSON.parse(ended.params.payload), { search: `?topic=${topic.id}`, readerOpen: false, pendingOpen: false, error: null },
      'the leaving document dropped the open and shows no Reader');
    assert.deepEqual(markCalls(p), [], 'the leaving document sent no clear');
    await p.send('Fetch.continueResponse', { requestId: next.event.requestId });
    await until(() => p.evaluate(`location.search === ${JSON.stringify('?topic=' + away.id)} && document.body?.dataset.ready === 'true'`), 'the next page opens');
    assert.deepEqual(markCalls(p), []);
    assert.equal((await view('marks', { topic_id: topic.id })).items.length, 1, 'the mark stays');
    assert.equal((await counts()).mark_operations, before.mark_operations, 'no mark operation was recorded');
    assert.deepEqual(p.errors, []); await p.close();
    await markAs([topic.message], false);
  });

  await check('live a page in the background when the source arrives clears nothing until it is shown again', async () => {
    const topic = await markTopic('Marks: background');
    const [marked] = await markAs([topic.message], true);
    const p = await page('live-mark-hidden', null, true, { url: topic.url }); await settled(p);
    await until(() => pill(p, topic.message), 'the card shows the mark');
    p.intercept(payload => payload?.name === 'source');
    await p.evaluate(`document.querySelector(${JSON.stringify(card(topic.message))}).scrollIntoView({block:'center'})`);
    await p.point(card(topic.message));
    const held = await until(() => p.held.find(h => h.payload?.name === 'source'), 'the source read is held');
    p.intercept(null);
    const other = await page('live-mark-front', null, true, { url: origin + '/' });
    await until(() => p.evaluate("document.visibilityState === 'hidden'"), 'the page is in the background');
    await p.release(held);
    await until(() => readerShows(p, 'Fixture conversation'), 'the Reader shows the message in the background');
    await openSettled(p);
    assert.deepEqual(markCalls(p), [], 'nothing is cleared while the page is not in front');
    assert.equal((await view('marks', { topic_id: topic.id })).items.length, 1);
    await p.send('Page.bringToFront');
    await until(async () => markCalls(p).length === 1 && (await view('marks', { topic_id: topic.id })).items.length === 0, 'shown again, the open clears');
    assert.deepEqual(markCalls(p).map(m => [m.args.marked, m.expected.mark_revision]), [[false, marked.mark_revision]]);
    for (const each of [p, other]) { assert.deepEqual(each.errors, []); await each.close(); }
  });

  await check('live opening a topic, from a link or its rail row, clears no mark in it', async () => {
    const topic = await markTopic('Marks: topic only'), from = await markTopic('Marks: rail start');
    await markAs([topic.message], true);
    const p = await page('live-mark-topic-only', null, true, { url: topic.url }); await settled(p);
    await until(async () => await pill(p, topic.message) && await line(p) === '1 message marked unread', 'the mark is shown');
    await p.send('Page.navigate', { url: from.url });
    await until(() => p.evaluate(`document.body?.dataset.ready === 'true' && Boolean(document.querySelector(${JSON.stringify(marksRow(topic.id))}))`), 'another topic is open');
    await p.evaluate(`document.querySelector(${JSON.stringify(marksRow(topic.id))}).scrollIntoView({block:'center'})`);
    await p.point(marksRow(topic.id));
    await until(() => p.evaluate(`location.search === ${JSON.stringify('?topic=' + topic.id)} && document.body?.dataset.ready === 'true'`), 'the rail row opens the topic');
    await settled(p);
    await until(async () => await pill(p, topic.message) && await line(p) === '1 message marked unread', 'the mark is still shown');
    assert.deepEqual(markCalls(p), []);
    assert.equal((await view('marks', { topic_id: topic.id })).items.length, 1);
    assert.deepEqual(p.errors, []); await p.close();
    await markAs([topic.message], false);
  });

  for (const when of ['before editor_state answers', 'after editor_state answered']) {
    await check(`live a mark renewed while the open is under way survives, ${when}`, async () => {
      const topic = await markTopic(`Marks: renewed ${when}`);
      const [marked] = await markAs([topic.message], true);
      const p = await page('live-mark-renewed', null, true, { url: topic.url }); await settled(p);
      await until(() => pill(p, topic.message), 'the card shows the mark');
      const hold = `live-mark-renew-${markSerial}`;
      let held = null;
      if (when === 'before editor_state answers') {
        const { next } = await control({ method: 'admission_events' });
        await control({ method: 'read_hold', hold_id: hold, name: 'editor_state', phase: 'callback' });
        await p.evaluate(`document.querySelector(${JSON.stringify(card(topic.message))}).scrollIntoView({block:'center'})`);
        await p.point(card(topic.message));
        await until(async () => (await control({ method: 'admission_events', after: next })).events.some(e => e.event === 'hold-enter' && e.hold_id === hold), 'editor_state is held in Core');
      } else {
        p.intercept(payload => payload?.name === 'source');
        await p.evaluate(`document.querySelector(${JSON.stringify(card(topic.message))}).scrollIntoView({block:'center'})`);
        await p.point(card(topic.message));
        held = await until(() => p.held.find(h => h.payload?.name === 'source'), 'the source answer is held');
        p.intercept(null);
        assert.ok(p.calls.some(call => call.payload?.name === 'editor_state' && call.payload.args.source_ref?.id === topic.message), 'editor_state has answered');
      }
      const [renewed] = await markAs([topic.message], true);
      assert.equal(renewed.mark_revision, marked.mark_revision + 2, 'marking what is marked renews it');
      if (held) await p.release(held); else await control({ method: 'read_release', hold_id: hold });
      await until(() => readerShows(p, 'Fixture conversation'), 'the source shows');
      await until(() => markCalls(p).length === 1, 'the open sent its clear');
      assert.deepEqual(markCalls(p).map(m => [m.args.marked, m.expected.mark_revision]), [[false, marked.mark_revision]], 'fenced on the revision the card showed');
      await pressed(p, ['Marked unread', 'true']);
      assert.deepEqual((await view('marks', { topic_id: topic.id })).items.map(item => item.mark_revision), [renewed.mark_revision], 'the newer reminder stays');
      assert.equal(await pill(p, topic.message), true);
      assert.equal(await p.evaluate("document.querySelector('#reader-notice').hidden"), true, 'the open\'s refused clear is silent');
      assert.deepEqual(p.errors, []); await p.close();
      await markAs([topic.message], false);
    });
  }

  await check('live Read it reaches every mark in turn, across pages of marks', async () => {
    const topic = await markTopic('Marks: many');
    const ids = [];
    for (let n = 0; n < 52; n++) {
      const sent = await control({ method: 'agent_message', operation_id: `live-mark-many-${n}`, body: `Marked message ${n} of many`, topic_id: topic.id, addressees: [] });
      ids.push(sent.result.message_id);
    }
    await markAs(ids, true);
    const p = await page('live-mark-many', null, true, { url: topic.url }); await settled(p);
    await until(async () => await line(p) === '52 messages marked unread', 'every page of marks is read');
    const readNext = async n => {
      await p.evaluate("document.querySelector('#read-mark').focus()");
      await p.key('Enter');
      await until(() => readerShows(p, `Marked message ${n} of many`), `Read it opens message ${n}`);
      await until(async () => (await view('editor_state', { source_ref: { kind: 'message', id: ids[n] }, topic_id: topic.id })).mark.marked === false, `message ${n} is cleared`);
      await p.key('Escape');
      await until(() => p.evaluate("!document.querySelector('#reader').open"), 'the Reader closes');
    };
    await readNext(0);
    await until(async () => await line(p) === '51 messages marked unread', 'the line names one fewer');
    await readNext(1);
    // Messages 2 to 49 are read on another device; 50 and 51 came on the second page.
    await markAs(ids.slice(2, 50), false);
    await until(async () => await line(p) === '2 messages marked unread', 'the page follows the clears made elsewhere');
    await readNext(50);
    await until(async () => await line(p) === '1 message marked unread', 'one left');
    await readNext(51);
    await until(async () => await line(p) === '', 'no marks left, no line');
    assert.deepEqual(markCalls(p).map(m => m.target.message_id), [ids[0], ids[1], ids[50], ids[51]]);
    assert.deepEqual(p.errors, []); await p.close();
  });

  await check('live a lost answer on Mark unread sends the same request again, and Core records it once', async () => {
    const topic = await markTopic('Marks: lost answer');
    const p = await page('live-mark-lost', null, true, { url: topic.url }); await settled(p);
    // Only the person's own press may move the page on; no commit reload races it.
    await p.evaluate('observedFreshness.live.stop()');
    await openCard(p, topic.message, 'Fixture conversation');
    await pressed(p, ['Mark unread', 'false']);
    const before = await counts();
    p.intercept(payload => payload?.kind === 'message.mark');
    await p.point('#mark-unread');
    const held = await until(() => p.held.find(h => h.payload?.kind === 'message.mark'), 'the answer is held');
    p.intercept(null); await p.fail(held);
    await until(() => p.evaluate("!document.querySelector('#reader-notice').hidden && document.querySelector('#reader-notice').textContent.includes('Press again')"), 'the Reader says the answer was lost');
    const recorded = await counts();
    assert.deepEqual([recorded.mark_operations - before.mark_operations, recorded.marked - before.marked], [1, 1], 'Core recorded it before the answer was lost');
    await pressed(p, ['Mark unread', 'false']);
    await p.point('#mark-unread');
    await pressed(p, ['Marked unread', 'true']);
    const [first, second] = markCalls(p);
    assert.deepEqual(second, first, 'the same envelope, operation included');
    assert.deepEqual((await counts()).mark_operations, recorded.mark_operations, 'no new operation');
    assert.deepEqual(p.errors, []); await p.close();
    await markAs([topic.message], false);
  });

  await check('live a second tab\'s pill and Reader button follow a mark made in the first', async () => {
    const topic = await markTopic('Marks: two tabs');
    const b = await page('live-mark-tab-b', null, true, { url: topic.url }); await settled(b);
    await openCard(b, topic.message, 'Fixture conversation');
    await pressed(b, ['Mark unread', 'false']);
    const a = await page('live-mark-tab-a', null, true, { url: topic.url }); await settled(a);
    await openCard(a, topic.message, 'Fixture conversation');
    await a.point('#mark-unread');
    await pressed(a, ['Marked unread', 'true']);
    await b.send('Page.bringToFront');
    await pressed(b, ['Marked unread', 'true']);
    await until(() => pill(b, topic.message), 'the second tab\'s card shows Unread');
    await a.send('Page.bringToFront');
    await a.point('#mark-unread');
    await pressed(a, ['Mark unread', 'false']);
    await b.send('Page.bringToFront');
    await pressed(b, ['Mark unread', 'false']);
    await until(async () => !(await pill(b, topic.message)), 'and loses it when the mark is cleared');
    assert.deepEqual(markCalls(b), [], 'the second tab sent nothing');
    for (const each of [a, b]) { assert.deepEqual(each.errors, []); await each.close(); }
  });

  // Closing the Reader keeps its writing on this device first, and only then
  // closes the modal dialog. A press on the page in between lands on the
  // Reader, so a check that presses a card right after × must wait for the
  // Reader to close. The hold delivers each write's completion only when the
  // check lets it go; the write itself commits as usual.
  const keptWritesHold = `(() => {
    let gate = null, release = null;
    window.keptWrites = { held: 0, delivered: 0 };
    window.holdKeptWrites = () => { gate = new Promise(resolve => { release = resolve; }); };
    window.releaseKeptWrites = () => { const resolve = release; gate = null; release = null; resolve(); };
    const transaction = IDBDatabase.prototype.transaction;
    IDBDatabase.prototype.transaction = function (...args) {
      const tx = transaction.apply(this, args), held = gate;
      if (!held || args[1] !== 'readwrite') return tx;
      let handler = null;
      Object.defineProperty(tx, 'oncomplete', { configurable: true, get: () => handler, set: fn => { handler = fn; } });
      keptWrites.held++;
      tx.addEventListener('complete', event => held.then(() => { keptWrites.delivered++; handler?.call(tx, event); }));
      return tx;
    };
  })()`;
  await check('live a card pressed while the Reader is still keeping its writing opens nothing, and opens once the Reader has closed', async () => {
    const p = await page('live-close-keeps-writing', null, true, { beforeNavigate: q => q.send('Page.addScriptToEvaluateOnNewDocument', { source: keptWritesHold }) });
    await settled(p);
    const notebook = '#memory-items .memory-card';
    await until(() => p.evaluate(`Boolean(document.querySelector(${JSON.stringify(notebook)}))`), 'the Notebook is listed');
    await p.open(1);
    // The idle save's answer is held, so the close has writing to keep.
    p.intercept(payload => payload?.kind === 'draft.save');
    await p.point('#writing-body'); await p.send('Input.insertText', { text: 'Kept while the Reader closes' });
    await p.evaluate('holdKeptWrites()');
    const opens = await p.evaluate('freshEvidence.opens.length');
    await p.point('#reader-close');
    await until(() => p.evaluate('keptWrites.held > 0'), 'the close is keeping the writing on this device');
    assert.equal(await p.evaluate("document.querySelector('#reader').open"), true, 'the Reader stays open until its writing is kept');
    await p.evaluate(`document.querySelector(${JSON.stringify(notebook)}).scrollIntoView({block:'center'})`);
    const target = await p.box(notebook);
    const at = { x: target.x + Math.min(12, target.width / 2), y: target.y + Math.min(12, target.height / 2) };
    assert.equal(await p.evaluate(`Boolean(document.elementFromPoint(${at.x},${at.y})?.closest('#reader'))`), true, 'the press lands on the Reader');
    await p.point(notebook, 'click', { covered: true });
    assert.equal(await p.evaluate('freshEvidence.opens.length'), opens, 'a card behind the open Reader opens nothing');
    await p.evaluate('releaseKeptWrites()');
    await until(() => p.evaluate("!document.querySelector('#reader').open"), 'the Reader closes once its writing is kept');
    assert.equal(await p.evaluate('freshEvidence.opens.length'), opens, 'the press made while it was open is not replayed');
    await p.evaluate(`document.querySelector(${JSON.stringify(notebook)}).scrollIntoView({block:'center'})`);
    await p.point(notebook);
    await until(() => p.evaluate("document.querySelector('#reader').open && document.querySelector('#reader-origin').textContent.includes('Notebook')"), 'the Notebook opens once the Reader has closed');
    assert.equal(await p.evaluate('freshEvidence.opens.length'), opens + 1);
    p.intercept(null);
    for (const entry of p.held.splice(0)) await p.release(entry);
    assert.deepEqual(p.errors, []); await p.close();
  });

  // A Notebook page's row by its title, without the light a page revised
  // since the person read it wears after its title.
  const pageTitle = "(row => { const title = row.cloneNode(true); title.querySelectorAll('.unread-count, .sr-only').forEach(light => light.remove()); return title.textContent; })";
  // Last, because it adds to the outcome's Notebook, which every later topic
  // page would list.
  await check('live the outcome Notebook pages sit in the sidebar beside the topics, open whole in the Reader, and follow a revision', async () => {
    const p = await page('live-outcome-references', null, true);
    await settled(p);
    const rows = () => p.evaluate(`[...document.querySelectorAll('#outcome-references-list .reference')].map(${pageTitle})`);
    assert.equal(await p.evaluate("document.querySelector('#outcome-references').hidden"), true, 'an outcome with no Notebook shows nothing');
    await control({ method: 'outcome_reference', operation_id: 'live-outcome-reference', item_id: 'live-outcome-reference',
      title: 'Architecture', body: 'The outcome passage every topic stands on.' });
    await until(() => p.evaluate("!document.querySelector('#outcome-references').hidden"), 'the outcome Notebook appears without a reload');
    assert.equal(await p.evaluate("document.querySelector('.rail').contains(document.querySelector('#outcome-references'))"), true, 'the pages are in the sidebar');
    assert.deepEqual(await rows(), ['Architecture']);
    // A page's row is a row like a topic's: as tall, and in the same column.
    const boxes = await p.evaluate("(()=>{const t=document.querySelector('#topics .nav-item').getBoundingClientRect(),r=document.querySelector('#outcome-references-list .reference').getBoundingClientRect();return {topic:[t.left,t.height],page:[r.left,r.height]}})()");
    assert.equal(boxes.page[0], boxes.topic[0], 'pages line up with topics');
    assert.ok(boxes.page[1] >= 44, 'a page row is a full touch target: ' + boxes.page[1]);
    // Below the topics the earlier checks left, in the sidebar's own scroll.
    await p.evaluate("document.querySelector('#outcome-references-list .reference').scrollIntoView({block:'center'})");
    await p.point('#outcome-references-list .reference');
    await until(() => p.evaluate("document.querySelector('#reader').open && document.querySelector('#source-body').textContent.includes('The outcome passage every topic stands on.')"), 'the Reader shows the item whole');
    await control({ method: 'memory_revise', operation_id: 'live-outcome-reference-revise', item_id: 'live-outcome-reference',
      expected_revision: 1, title: 'Architecture, revised', body: 'The revised outcome passage.' });
    await until(async () => JSON.stringify(await rows()) === JSON.stringify(['Architecture, revised']), 'the row shows the revision');
    await until(() => p.evaluate("!document.querySelector('#revision-offer').hidden && document.querySelector('#open-revision').textContent === 'Open revision 2'"), 'the Reader offers the revision');
    await p.point('#open-revision');
    await until(() => p.evaluate("document.querySelector('#source-body').textContent.includes('The revised outcome passage.')"), 'the revision opens');
    assert.deepEqual(p.errors, []);
    await p.close();
  });

  // Also adds to the outcome's Notebook, so it runs after the case above.
  await check('live an outcome Notebook page revised after a reply opens at its revision, before and after a reload, and only writing keeps an older one', async () => {
    const p = await page('live-notebook-revision', null, true);
    await settled(p);
    const url = await p.evaluate('location.href');
    const id = 'live-release-pipeline', row = `#outcome-references-list .reference[data-id="${id}"]`;
    const ref = revision => ({ kind: 'memory', id, revision });
    const saved = async revision => (await view('editor_state', { source_ref: ref(revision), topic_id: facts.topic_id })).draft;
    const revise = (expected, title, body) => control({ method: 'memory_revise', operation_id: `live-notebook-revision-${expected}`, item_id: id,
      expected_revision: expected, title, body });
    const has = (selector, text) => p.evaluate(`document.querySelector(${JSON.stringify(selector)}).textContent.includes(${JSON.stringify(text)})`);
    const open = async title => {
      await until(() => p.evaluate(`(row => row && ${pageTitle}(row))(document.querySelector(${JSON.stringify(row)})) === ${JSON.stringify(title)}`), `the outcome Notebook lists ${title}`);
      await p.evaluate(`document.querySelector(${JSON.stringify(row)}).scrollIntoView({block:'center'})`);
      await p.point(row);
      await until(() => p.evaluate("document.querySelector('#reader').open"), 'the Reader opens the page');
    };
    const close = async () => { await p.point('#reader-close'); await until(() => p.evaluate("!document.querySelector('#reader').open"), 'the Reader closes'); };
    await control({ method: 'outcome_reference', operation_id: id, item_id: id, title: 'Release pipeline', body: 'Pipeline revision one.' });
    await open('Release pipeline');
    await until(() => has('#source-body', 'Pipeline revision one.'), 'revision one is shown');
    await p.point('#writing-body'); await p.send('Input.insertText', { text: 'A reply about revision one' });
    await p.key('Enter', 12);
    // As on the live instance: the send leaves an empty reply in its place, saved at revision one.
    await until(async () => { const draft = await saved(1); return draft?.body === '' && draft.source_ref.revision === 1 && draft.revision > 1; }, 'the sent reply leaves an empty one at revision one');
    await close();
    await revise(1, 'Release pipeline, revised', 'Pipeline revision two.');
    for (const reload of [false, true]) {
      if (reload) {
        await p.send('Page.navigate', { url });
        await until(() => p.evaluate('document.body?.dataset.ready === "true"'), 'the page is read again');
        await settled(p);
      }
      await open('Release pipeline, revised');
      await until(() => has('#source-body', 'Pipeline revision two.'), `reload ${reload}: the page opens at revision two`);
      assert.equal(await has('#reader-origin', 'Notebook · revision 2'), true);
      assert.equal(await p.evaluate("document.querySelector('#source-update').hidden"), true, `reload ${reload}: an empty reply names no older revision`);
      if (!reload) await close();
    }
    await p.point('#writing-body'); await p.send('Input.insertText', { text: 'Unsent words about revision two' });
    await until(async () => { const draft = await saved(2); return draft?.body === 'Unsent words about revision two' && draft.source_ref.revision === 2; }, 'the writing is saved about revision two');
    await close();
    // Writing keeps its revision, and the Reader says the page has changed since.
    await revise(2, 'Release pipeline, third', 'Pipeline revision three.');
    await open('Release pipeline, third');
    await until(() => has('#source-body', 'Pipeline revision three.'), 'the page opens at revision three');
    assert.equal(await p.evaluate("document.querySelector('#writing-body').value"), 'Unsent words about revision two');
    assert.equal(await p.evaluate("document.querySelector('#source-update').hidden"), false);
    assert.equal(await p.evaluate("document.querySelector('#source-update').textContent"),
      'This page has changed since you started writing. Your writing refers to revision 2; you are reading revision 3.');
    assert.equal((await saved(3)).source_ref.revision, 2, 'the saved writing keeps revision two');
    assert.deepEqual(p.errors, []);
    await p.close();
  });
}

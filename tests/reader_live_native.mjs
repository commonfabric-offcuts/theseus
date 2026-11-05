import assert from 'node:assert/strict';

// Live updates in the real browser against the real server: the page opens one
// live WebSocket, reads nothing while nothing changes, and shows another participant's
// message as soon as it is saved.
export async function liveChecks({ check, page, until, control, observations, origin, cdp }) {
  let serial = 0;
  const message = body => control({ method: 'agent_message', operation_id: `live-message-${++serial}`, body, topic_id: 't1', addressees: [] });
  const hasText = (p, selector, text) => p.evaluate(`document.querySelector(${JSON.stringify(selector)}).textContent.includes(${JSON.stringify(text)})`);
  // The stream's first line has arrived (its number is known), the pass it
  // asked for is done, and no retry is waiting: a first pass can be deferred
  // while the page is still starting, and that retry runs on a timer.
  const settled = p => until(() => p.evaluate('Boolean(window.observedFreshness && !observedFreshness.running && observedFreshness.timer === null && observedFreshness.live?.connected && observedFreshness.live.seq !== null)'), 'live stream connected, no pass running and no retry waiting');
  const reads = p => p.evaluate('freshEvidence.reads.length');

  await check('live an idle topic reads nothing, and a new message shows within a second', async () => {
    const p = await page('live-topic', null, true);
    await settled(p);
    const sockets = p.network.filter(event => event.method === 'Network.webSocketCreated' && event.params.url.endsWith('/api/live'));
    assert.equal(sockets.length, 1, 'one live WebSocket per page');
    assert.equal(await p.evaluate('observedFreshness.live.opened'), 1);
    assert.equal(p.calls.filter(call => call.url.endsWith('/api/live')).length, 0, 'no HTTP stream');
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

  // The topic-state form keeps what the person typed, and their focus, while
  // messages from others repaint the topic; a second change made straight
  // after a first one commits. Choosing from a select's native popup is not
  // what this checks, so the choice is set and its change event sent.
  await check('live the topic state form keeps typing and focus while messages arrive, and saves twice in a row', async () => {
    const p = await page('live-state-form', null, true);
    await settled(p);
    const value = selector => p.evaluate(`document.querySelector(${JSON.stringify(selector)}).value`);
    const choose = state => p.evaluate(`(s=>{s.value=${JSON.stringify(state)};s.dispatchEvent(new Event('change'))})(document.querySelector('#topic-state-choice'))`);
    const line = () => p.evaluate("document.querySelector('#topic-state .state-line').textContent");
    const onSave = () => p.evaluate("document.activeElement === document.querySelector('#topic-state button.primary')");
    await p.evaluate("document.querySelector('#topic-state').scrollIntoView({block:'start'})");
    await p.point('#topic-state summary');
    await until(() => p.evaluate("document.querySelector('#topic-state details').open"), 'the form is open');
    await choose('waiting');
    await p.point('#topic-state-waiting'); await p.send('Input.insertText', { text: 'fixture-person' });
    await p.point('#topic-state-note'); await p.send('Input.insertText', { text: 'Pick a name' });
    const top = selector => p.evaluate(`Math.round(document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect().top)`);
    const noteTop = await top('#topic-state-note');
    const text = 'Arrives while the state is being chosen';
    await message(text);
    await until(() => hasText(p, '#messages', text), 'the new message is shown, so the topic was read and painted again');
    await settled(p);
    assert.equal(await p.evaluate('document.activeElement.id'), 'topic-state-note', 'focus stays in the note');
    assert.ok(Math.abs(await top('#topic-state-note') - noteTop) <= 1, 'the note stays where it was on the screen');
    assert.deepEqual([await value('#topic-state-choice'), await value('#topic-state-note'), await value('#topic-state-waiting')],
      ['waiting', 'Pick a name', 'fixture-person'], 'what the person typed is kept');
    await p.send('Input.insertText', { text: '!' });
    assert.equal(await value('#topic-state-note'), 'Pick a name!', 'typing goes on where it was');
    await p.point('#topic-state button.primary');
    await until(async () => (await line()).startsWith('Waiting on you · Pick a name!'), 'the line shows the saved state');
    assert.equal(await onSave(), true, 'focus stays on Save after the commit and the fresh read');
    await choose('active');
    assert.deepEqual([await value('#topic-state-note'), await value('#topic-state-waiting')], ['', ''], 'a new state starts with an empty note and nobody waited on');
    await p.point('#topic-state button.primary');
    await until(async () => (await line()).startsWith('Active'), 'the second change commits');
    assert.equal(await p.evaluate("document.querySelector('#topic-state .notice').hidden"), true, 'no refusal');
    assert.equal(await onSave(), true);
    const updates = p.calls.filter(call => call.payload?.kind === 'topic.update').map(call => call.payload.expected.topic_revision);
    assert.equal(updates.length, 2);
    assert.ok(updates[1] > updates[0], 'the second change sends a newer version');
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
    await p.evaluate("(() => { document.querySelector('#topic-state details').open = true; document.querySelector('#topic-state-note').focus(); document.querySelector('#messages .message-card:last-child').scrollIntoView({block:'center'}); })()");
    assert.equal(await p.evaluate("document.querySelector('#topic-state-note').getBoundingClientRect().bottom <= 0 && document.activeElement === document.querySelector('#topic-state-note')"), true,
      'the field with the caret is above the screen');
    const away = await reading();
    await arrive('Arrives while focus is scrolled away');
    await stays(away, 'the card in view stays where it was, not the field out of view');

    // A select being chosen in holds still too; the cards below it move down.
    await p.evaluate(`(() => { const choice = document.querySelector('#topic-state-choice'); choice.focus();
      scrollBy(0, choice.getBoundingClientRect().top - 100); })()`);
    const chosen = await p.evaluate("Math.round(document.querySelector('#topic-state-choice').getBoundingClientRect().top)");
    await arrive('Arrives while a state is being chosen');
    assert.ok(Math.abs(await p.evaluate("Math.round(document.querySelector('#topic-state-choice').getBoundingClientRect().top)") - chosen) <= 1,
      'the select being chosen in stays where it was');

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

  // On a phone at the top of a topic, with its state open and no card on the
  // screen, a message arriving below moves nothing the person is reading.
  await check('live with no card on the screen, a message arriving scrolls nothing', async () => {
    const p = await page('live-no-card', null, true);
    await p.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
    await settled(p);
    await p.evaluate(`(() => { document.querySelector('#topic-state details').open = true; document.activeElement.blur(); scrollTo(0, 0);
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
  });

  // A message that named the reader in a topic they have since lost: the
  // outcomes page lists its start, and Read it here shows all of it.
  await check('live a message sent by name in a topic you have lost can be read whole where it is listed', async () => {
    const body = 'Named before you left. ' + 'The rest of a long message. '.repeat(20) + 'The very end.';
    await control({ method: 'lost_named_message', operation_id: 'live-lost-1', body });
    const p = await page('live-lost', null, true, { url: origin + '/' });
    const item = "document.querySelector('#sent-to-you .closed-topic')";
    await until(() => p.evaluate(`Boolean(${item}?.textContent.includes('Named before you left.'))`), 'the lost topic\'s message is listed under Sent to you');
    assert.equal(await p.evaluate(`${item}.textContent.includes('The very end.')`), false, 'only its start is listed');
    assert.equal(await p.evaluate(`[...${item}.querySelectorAll('button')].some(b => b.textContent === 'Read it here')`), true, 'the item offers Read it here');
    await p.evaluate(`[...${item}.querySelectorAll('button')].find(b => b.textContent === 'Read it here').focus()`);
    await p.key('Enter');
    await until(() => p.evaluate(`${item}.querySelector('.sent-whole')?.textContent.endsWith('The very end.') === true`), 'the whole message is shown where it is listed');
    assert.equal(await p.evaluate('document.activeElement.textContent'), 'Mark read', 'focus moves on to Mark read');
    assert.deepEqual(p.errors, []);
    await p.close();
  });

  // Older messages that More loads appear where its button was, so the person
  // reads on from where they asked; the button's focus holds nothing still.
  await check('live More messages shows the older messages where its button was', async () => {
    await control({ method: 'seed', messages: 45 });
    const p = await page('live-more', null, true);
    await settled(p);
    await until(() => p.evaluate("document.querySelector('#more-messages').hidden === false"), 'More is offered');
    const count = await p.evaluate("document.querySelectorAll('#messages .message-card').length");
    await p.evaluate("document.querySelector('#more-messages').scrollIntoView({block:'end'})");
    const button = await p.evaluate("Math.round(document.querySelector('#more-messages').getBoundingClientRect().top)");
    await p.point('#more-messages');
    assert.equal(await p.evaluate("document.activeElement.id"), 'more-messages', 'the press focuses the button');
    await until(() => p.evaluate(`document.querySelectorAll('#messages .message-card').length > ${count}`), 'older messages are loaded');
    await settled(p);
    const first = await p.evaluate(`Math.round(document.querySelectorAll('#messages .message-card')[${count}].getBoundingClientRect().top)`);
    assert.ok(Math.abs(first - button) <= 1, `the first older message is where the button was: ${JSON.stringify({ button, first })}`);
    assert.deepEqual(p.errors, []);
    await p.close();
  });
}

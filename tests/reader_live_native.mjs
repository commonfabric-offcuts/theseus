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
}

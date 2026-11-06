import assert from 'node:assert/strict';

// Work observed in the real browser against the real server: a topic someone
// just posted in carries the work ring, its row title says who did what and
// when, and screen readers hear the same words; a key under the topics says
// what the ring means, on a phone too. No row ever says nobody works.
export async function workChecks({ check, page, until, control, view, shot }) {
  const row = '#topics .nav-item[data-topic-id="t1"]';
  const read = p => p.evaluate(`(()=>{const r=document.querySelector(${JSON.stringify(row)});return r?{title:r.title,dot:Boolean(r.querySelector('.topic-work')),words:[...r.querySelectorAll('.sr-only')].map(e=>e.textContent),size:(()=>{const d=r.querySelector('.topic-work');if(!d)return null;const b=d.getBoundingClientRect();return [b.width,b.height]})()}:null})()`);

  await check('work a topic someone just posted in carries the dot, and its title says who and when', async () => {
    await control({ method: 'agent_message', operation_id: 'work-agent-posts', body: 'Picked this up.', topic_id: 't1', addressees: [] });
    const p = await page('work-row', null, true);
    const shown = await until(async () => { const r = await read(p); return r?.title.includes('fixture-notebook-agent posted') && r; }, 'row shows the agent post as activity');
    const work = (await view('topic', { topic_id: 't1' })).topic.work;
    assert.equal(work.observed, true);
    assert.equal(shown.dot, true, 'observed work has the dot');
    assert.match(shown.title, /^Activity seen .+ \(fixture-notebook-agent posted\)$/);
    // The row's other words for screen readers, its unread count (", 1 unread"),
    // come and go with what is read; the work's words are the title's.
    assert.deepEqual(shown.words.filter(words => !/^, \d+ unread/.test(words)), [' · ' + shown.title], 'screen readers hear the title');
    assert.ok(shown.size[0] > 0 && shown.size[0] <= 10 && shown.size[1] <= 10, 'the ring is small: ' + shown.size);
    for (const r of await p.evaluate(`[...document.querySelectorAll('#topics .nav-item')].map(a=>a.title)`)) assert.doesNotMatch(r, /nobody|no one/i);
    // A hollow ring in the quiet text color, not the filled accent dot of
    // presence and unread; and a key, in words, at laptop and phone width.
    const ring = async q => q.evaluate(`(()=>{const d=document.querySelector(${JSON.stringify(row + ' .topic-work')}),c=getComputedStyle(d),k=document.querySelector('#topics-key'),b=k.getBoundingClientRect();
      return {fill:c.backgroundColor,border:[c.borderTopColor,c.borderRightColor,c.borderBottomColor,c.borderLeftColor],quiet:getComputedStyle(k).color,
        key:!k.hidden&&b.height>0&&b.width>0&&b.right<=innerWidth,words:k.textContent.trim(),hiddenFromReaders:k.getAttribute('aria-hidden')}})()`);
    const laptop = await ring(p);
    assert.deepEqual([laptop.fill, laptop.border, laptop.key, laptop.words, laptop.hiddenFromReaders], ['rgba(0, 0, 0, 0)', Array(4).fill(laptop.quiet), true, 'Activity seen', 'true'], 'a hollow ring, and its key: ' + JSON.stringify(laptop));
    await shot(p, 'work-row-dot');
    assert.deepEqual(p.errors, []);
    const phone = await page('work-row-phone', null, true, { beforeNavigate: async q => {
      await q.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
      await q.send('Emulation.setTouchEmulationEnabled', { enabled: true });
    } });
    await until(async () => (await read(phone))?.dot, 'phone: the row has its ring');
    const small = await ring(phone);
    assert.deepEqual([small.fill, small.key, small.words], ['rgba(0, 0, 0, 0)', true, 'Activity seen'], 'phone: the key says what the ring means, where no title shows: ' + JSON.stringify(small));
    await phone.evaluate("document.querySelector('#topics-key').scrollIntoView({block:'center'})");
    await shot(phone, 'work-row-ring-phone');
    assert.deepEqual(phone.errors, []);
    await phone.close();
  });

  // Having written in a topic lets a teammate say where it stands without
  // becoming one of its participants: an agent of the outcome's team writes,
  // then marks the topic ready for review; the open page shows what it said,
  // with no reload, and does not list it among the participants. What the
  // person writes next to the whole topic wakes the participants, not it.
  await check('work a teammate who has written in a topic can say where it stands, and is not woken by later messages', async () => {
    const agent = 'fixture-planning-agent', participant = 'fixture-notebook-agent';
    const chips = p => p.evaluate(`[...document.querySelectorAll('#participants .chip')].map(chip=>chip.textContent)`);
    const line = p => p.evaluate(`document.querySelector('#topic-state .state-line')?.textContent ?? ''`);
    const p = await page('work-writer-says', null, true);
    await until(async () => (await chips(p)).length > 0, 'participants drawn');
    assert.equal((await chips(p)).some(words => words.includes(agent)), false, 'not a participant before writing');
    const posted = await control({ method: 'agent_message', operation_id: 'work-writer-says', sender: agent, member: true, body: 'I will take this one.' });
    assert.equal('joined' in posted.result, false, 'a post says nothing of joining');
    await until(() => p.evaluate(`Boolean(document.querySelector('#messages [data-id="${posted.result.message_id}"]'))`), 'the message lands');
    const said = await control({ method: 'agent_state', operation_id: 'work-writer-says-review', sender: agent, args: { state: 'review', note: 'Ready to read' } });
    assert.equal(said.status, 'committed', 'Core takes the writer\'s word: ' + JSON.stringify(said.error));
    assert.deepEqual([said.result.state, said.result.state_by], ['review', agent]);
    const shown = await until(async () => { const words = await line(p); return words.includes('Ready to read') && words; }, 'the page shows where it stands');
    assert.match(shown, /^Ready for review · Ready to read — fixture-planning-agent, /);
    assert.equal((await chips(p)).some(words => words.includes(agent)), false, 'still not listed among the participants');
    assert.equal((await view('topic', { topic_id: 't1' })).participants.some(row => row.actor_id === agent), false, 'nor in Core');
    const before = await control({ method: 'deliveries_to', actors: [agent, participant] });
    const next = await control({ method: 'agent_message', operation_id: 'work-writer-says-next', sender: 'person', whole_topic: true, body: 'Reading it now.' });
    await until(() => p.evaluate(`Boolean(document.querySelector('#messages [data-id="${next.result.message_id}"]'))`), 'the next message lands');
    const after = await control({ method: 'deliveries_to', actors: [agent, participant] });
    assert.deepEqual([after[agent] - before[agent], after[participant] - before[participant]], [0, 1], 'the participant is woken; the writer is not');
    await p.evaluate(`document.querySelector('#topic-state').scrollIntoView({block:'center'})`);
    await shot(p, 'work-writer-says');
    assert.deepEqual(p.errors, []);
    await p.close();
  });
}

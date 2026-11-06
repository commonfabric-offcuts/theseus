import assert from 'node:assert/strict';

// Work observed in the real browser against the real server: a topic someone
// just posted in carries the work dot, its row title says who did what and
// when, and screen readers hear the same words. No row ever says nobody works.
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
    assert.ok(shown.size[0] > 0 && shown.size[0] <= 10 && shown.size[1] <= 10, 'the dot is small: ' + shown.size);
    for (const r of await p.evaluate(`[...document.querySelectorAll('#topics .nav-item')].map(a=>a.title)`)) assert.doesNotMatch(r, /nobody|no one/i);
    await shot(p, 'work-row-dot');
    assert.deepEqual(p.errors, []);
  });

  // Writing in a topic makes the writer one of its participants: an agent of
  // the outcome's team who is not one writes, and the open page lists it among
  // the participants as its message lands, with no reload.
  await check('work a teammate who writes in a topic is listed among its participants as the message lands', async () => {
    const agent = 'fixture-planning-agent';
    const chips = p => p.evaluate(`[...document.querySelectorAll('#participants .chip')].map(chip=>chip.textContent)`);
    const p = await page('work-writer-joins', null, true);
    await until(async () => (await chips(p)).length > 0, 'participants drawn');
    assert.equal((await chips(p)).some(words => words.includes(agent)), false, 'not a participant before writing');
    const posted = await control({ method: 'agent_message', operation_id: 'work-writer-joins', sender: agent, member: true, body: 'I will take this one.' });
    assert.equal(posted.result.joined, true, 'Core says the post made it a participant');
    await until(() => p.evaluate(`Boolean(document.querySelector('#messages [data-id="${posted.result.message_id}"]'))`), 'the message lands');
    await until(async () => (await chips(p)).some(words => words.includes(agent)), 'the writer is listed among the participants');
    assert.ok((await view('topic', { topic_id: 't1' })).participants.some(row => row.actor_id === agent), 'and Core lists it');
    await p.evaluate(`document.querySelector('#participants').scrollIntoView({block:'center'})`);
    await shot(p, 'work-writer-joins');
    assert.deepEqual(p.errors, []);
    await p.close();
  });
}

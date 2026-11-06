import assert from 'node:assert/strict';

// Work observed in the real browser against the real server: a topic someone
// just posted in carries the work dot, its row title says who did what and
// when, and screen readers hear the same words. No row ever says nobody works.
// The reader's own posts are no news to them: they light no dot and are never
// what the row's words name.
export async function workChecks({ check, page, until, control, view, shot }) {
  const rowOf = topic => `#topics .nav-item[data-topic-id="${topic}"]`;
  const row = rowOf('t1');
  const read = (p, selector = row) => p.evaluate(`(()=>{const r=document.querySelector(${JSON.stringify(selector)});return r?{title:r.title,dot:Boolean(r.querySelector('.topic-work')),words:[...r.querySelectorAll('.sr-only')].map(e=>e.textContent),size:(()=>{const d=r.querySelector('.topic-work');if(!d)return null;const b=d.getBoundingClientRect();return [b.width,b.height]})()}:null})()`);

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

  await check('work the reader\'s own posts light no dot, and the words name only what others did', async () => {
    // The reader opens a topic and nobody else writes in it.
    await control({ method: 'navigation_topics', topics: [{ id: 'work-own', title: 'Only mine' }] });
    const own = rowOf('work-own');
    const first = await page('work-own', null, true);
    const mine = await until(async () => await read(first, own), 'row for a topic only the reader wrote in');
    assert.equal(mine.dot, false, 'the reader\'s own post lights no dot');
    assert.equal(mine.title, 'No activity seen');
    const alone = (await view('topic', { topic_id: 'work-own' })).topic.work;
    assert.deepEqual([alone.observed, alone.seen_ms, alone.by, alone.how], [false, null, null, null]);
    await shot(first, 'work-own-no-dot');
    assert.deepEqual(first.errors, []);
    // The agent joins and posts; then the reader posts again, last.
    await control({ method: 'agent_message', operation_id: 'work-own-agent', body: 'On it.', topic_id: 'work-own', join: true, addressees: [] });
    await control({ method: 'agent_message', operation_id: 'work-own-person', body: 'Thanks.', topic_id: 'work-own', sender: 'person', addressees: [] });
    const later = await page('work-own-later', null, true);
    const lit = await until(async () => { const r = await read(later, own); return r?.dot && r; }, 'the agent\'s post lights the row');
    assert.match(lit.title, /^Activity seen .+ \(fixture-notebook-agent posted\)$/, 'the words name the agent, not the reader\'s later post');
    assert.doesNotMatch(lit.title, /you posted/);
    const work = (await view('topic', { topic_id: 'work-own' })).topic.work;
    assert.deepEqual([work.observed, work.by, work.how], [true, 'fixture-notebook-agent', 'posted']);
    await shot(later, 'work-own-others-dot');
    assert.deepEqual(later.errors, []);
  });
}

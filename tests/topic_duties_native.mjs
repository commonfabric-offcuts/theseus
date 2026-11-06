import assert from 'node:assert/strict';

// What each participant is responsible for, in the real browser against the
// real server: an agent's note appears beside where the topic stands without a
// reload, and the reader says their own from the state form, by pointer and
// typing, and sees it as "you".
export async function dutiesChecks({ check, page, until, control, view, facts, shot }) {
  const listed = p => p.evaluate(`[...document.querySelectorAll('#topic-state .responsibilities li')].filter(li=>!li.closest('[hidden]')).map(li=>li.textContent)`);
  const notes = async () => Object.fromEntries((await view('topic', { topic_id: 't1' })).participants.map(item => [item.actor_id, [item.responsibility, item.responsibility_revision]]));

  await check('duties an agent\'s note appears under the state line as it is set', async () => {
    const p = await page('duties-live', null, true);
    assert.deepEqual(await listed(p), [], 'no notes, no list');
    await control({ method: 'responsibility', operation_id: 'duties-agent-note', note: 'Reviews the copy' });
    const shown = await until(async () => { const items = await listed(p); return items.length && items; }, 'the agent note arrives live');
    assert.deepEqual(shown, [`${facts.agent} Reviews the copy`]);
    // It sits right after the state line, inside the topic's state panel.
    assert.equal(await p.evaluate(`document.querySelector('#topic-state .state-line').nextElementSibling?.classList.contains('responsibilities')`), true);
    await shot(p, 'duties-agent-note');
    assert.deepEqual(p.errors, []);
  });

  await check('duties the reader says what they do from the state form and sees it as you', async () => {
    const p = await page('duties-own', null, true);
    await p.evaluate(`document.querySelector('#topic-state details.state-form summary').scrollIntoView({block:'center'})`);
    await p.point('#topic-state details.state-form summary');
    await until(() => p.evaluate(`document.querySelector('#topic-state details.state-form').open`), 'state form open');
    await p.evaluate(`document.querySelector('#topic-responsibility').scrollIntoView({block:'center'})`);
    await p.point('#topic-responsibility');
    assert.equal(await p.evaluate('document.activeElement?.id'), 'topic-responsibility');
    await p.send('Input.insertText', { text: 'Decides the release name' });
    const before = p.calls.length;
    await p.evaluate(`document.querySelector('#topic-responsibility-save').scrollIntoView({block:'center'})`);
    await p.point('#topic-responsibility-save');
    const call = await until(() => p.calls.slice(before).find(c => c.payload?.kind === 'responsibility.set'), 'responsibility.set call');
    assert.deepEqual(call.payload.args, { note: 'Decides the release name' });
    assert.equal(call.payload.expected.responsibility_revision, 0);
    await until(async () => (await notes())[facts.actor]?.[0] === 'Decides the release name', 'Core keeps the note');
    const shown = await until(async () => { const items = await listed(p); return items[0]?.startsWith('you') && items; }, 'the list shows the reader first');
    assert.deepEqual(shown, ['you Decides the release name', `${facts.agent} Reviews the copy`]);
    assert.equal(await p.evaluate(`document.querySelector('#topic-state .notice').hidden`), true, 'no refusal was shown');
    await shot(p, 'duties-own-note');
    assert.deepEqual(p.errors, []);
  });
}

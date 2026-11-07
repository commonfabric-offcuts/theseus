import assert from 'node:assert/strict';

// What each participant is responsible for, in the real browser against the
// real server: an agent's part appears under "Your part" in Topic settings
// without a reload, and the reader writes their own on its one line, by
// pointer and typing, saved on Return.
export async function dutiesChecks({ check, page, until, control, view, facts, shot }) {
  // Only what the person can see: the list inside the open Topic settings.
  const listed = p => p.evaluate(`[...document.querySelectorAll('dialog#topic-settings[open] #topic-state .responsibilities li')].filter(li=>!li.closest('[hidden]')).map(li=>li.textContent)`);
  const settings = async p => {
    await p.point('#settings-open');
    await until(() => p.evaluate(`document.querySelector('#topic-settings').open`), 'Topic settings open');
  };
  const notes = async () => Object.fromEntries((await view('topic', { topic_id: 't1' })).participants.map(item => [item.actor_id, [item.responsibility, item.responsibility_revision]]));

  await check('duties an agent\'s part appears under the reader\'s own line as it is set', async () => {
    const p = await page('duties-live', null, true);
    await settings(p);
    assert.deepEqual(await listed(p), [], 'no notes, no list');
    await control({ method: 'responsibility', operation_id: 'duties-agent-note', note: 'Reviews the copy' });
    const shown = await until(async () => { const items = await listed(p); return items.length && items; }, 'the agent note arrives live');
    assert.deepEqual(shown, [`${facts.agent} Reviews the copy`]);
    // It sits under "Your part" and the reader's own line, inside the topic's state panel.
    assert.deepEqual(await p.evaluate(`[...document.querySelector('#topic-state .settings-part').children].map(e=>e.id||e.className)`), ['part-heading', 'topic-responsibility', 'responsibilities']);
    await shot(p, 'duties-agent-note');
    assert.deepEqual(p.errors, []);
  });

  await check('duties the reader writes their part on its one line, saved on Return', async () => {
    const p = await page('duties-own', null, true);
    await settings(p);
    await p.evaluate(`document.querySelector('#topic-responsibility').scrollIntoView({block:'center'})`);
    await p.point('#topic-responsibility');
    assert.equal(await p.evaluate('document.activeElement?.id'), 'topic-responsibility');
    assert.equal(await p.evaluate(`Boolean(document.querySelector('#topic-responsibility-save'))`), false, 'no Save my part button');
    await p.send('Input.insertText', { text: 'Decides the release name' });
    const before = p.calls.length;
    await p.key('Enter');
    const call = await until(() => p.calls.slice(before).find(c => c.payload?.kind === 'responsibility.set'), 'responsibility.set call');
    assert.deepEqual(call.payload.args, { note: 'Decides the release name' });
    assert.equal(call.payload.expected.responsibility_revision, 0);
    await until(async () => (await notes())[facts.actor]?.[0] === 'Decides the release name', 'Core keeps the note');
    await until(() => p.evaluate(`document.querySelector('#topic-state .notice').textContent === 'Saved'`), 'a quiet Saved, no refusal');
    assert.deepEqual([await p.evaluate(`document.querySelector('#topic-responsibility').value`), await listed(p), await p.evaluate('document.activeElement?.id')],
      ['Decides the release name', [`${facts.agent} Reviews the copy`], 'topic-responsibility'], 'the line keeps it and the list shows the others; the focus stays on the line');
    await shot(p, 'duties-own-note');
    assert.deepEqual(p.errors, []);
  });
}

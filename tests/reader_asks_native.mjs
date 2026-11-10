import assert from 'node:assert/strict';

// Asking in the real browser against the real server: an agent's ask shows on
// the topic's row as waiting on the reader, with how long it has waited; the
// reader's reply clears it; and a reply sent with Ask chosen waits on whoever
// it names, while one sent as a Tell waits on nobody. (A reply to one agent
// starts as a whisper, whisper_native.mjs; these choose Tell or Ask.)
export async function asksChecks({ check, page, until, control, view, facts, replace, shot }) {
  const row = '#topics .nav-item[data-topic-id="t1"]';
  const mark = p => p.evaluate(`(()=>{const m=document.querySelector(${JSON.stringify(row + ' .topic-state')});return m?{text:m.textContent,title:m.title,state:m.dataset.state,mine:m.classList.contains('mine')}:null})()`);
  const choice = p => p.evaluate(`Object.fromEntries([...document.querySelectorAll('#intent-row button[data-intent]')].map(c=>[c.dataset.intent,
    (c.getAttribute('aria-pressed')==='true'?'checked':'')+(c.disabled?'disabled':'')]))`);
  const asks = async () => (await view('topic', { topic_id: 't1' })).topic.asks ?? [];
  // Someone in the topic is a name tapped once to address them; anyone else is typed.
  const addressTo = async (p, name) => {
    const chip = `#recipient-chips .choice-chip[data-name=${JSON.stringify(name)}]`;
    if (await p.evaluate(`Boolean(document.querySelector(${JSON.stringify(chip)}))`)) await p.point(chip);
    else { await p.point('#recipient-input'); await p.send('Input.insertText', { text: name }); await p.key('Enter'); }
    await until(() => p.evaluate(`[...document.querySelectorAll('#recipient-chips [data-name]')].some(c=>c.dataset.name===${JSON.stringify(name)}&&(c.classList.contains('chip')||c.getAttribute('aria-pressed')==='true'))`), 'recipient named');
  };
  const sent = async (p, from) => {
    await p.point('#send-reply');
    const call = await until(() => p.calls.slice(from).find(c => c.payload?.kind === 'message.send'), 'message.send call');
    const receipt = await until(async () => { const r = await view('operation', { operation_id: call.payload.operation_id }); return r.status === 'committed' && r; }, 'send committed');
    return receipt.result.message_id;
  };

  await check('asks an agent asking the reader marks the row as waiting on them, with since', async () => {
    await control({ method: 'agent_message', operation_id: 'asks-agent-asks', body: 'Can you confirm the date?', topic_id: 't1', addressees: [facts.actor], intent: 'ask' });
    const p = await page('asks-row', null, true);
    const shown = await until(async () => { const m = await mark(p); return m?.state === 'waiting' && m; }, 'row shows the ask');
    assert.equal(shown.mine, true, 'the reader is the one waited on');
    assert.match(shown.text, /^Waiting on you/);
    assert.match(shown.title, /asked you, since /, 'the row title says how long the ask has waited');
    await shot(p, 'asks-row-waiting');
    assert.deepEqual(p.errors, []);
  });

  await check('asks a reply chosen as a Tell tells, and ends the wait on the reader', async () => {
    const p = await page('asks-tell', null, true); await p.open(1);
    assert.equal((await choice(p)).ask, 'disabled', 'no Ask before anyone is named');
    await replace(p, 'The fourth works.');
    await addressTo(p, facts.agent);
    assert.deepEqual(await choice(p), { whisper: 'checked', tell: '', ask: '' }, 'Ask can be chosen once someone is named');
    await p.point('#intent-row button[data-intent="tell"]');
    await until(async () => (await choice(p)).tell === 'checked', 'Tell chosen');
    const id = await sent(p, 0);
    const source = await view('source', { source_ref: { kind: 'message', id } });
    assert.equal(source.intent, 'tell', 'a reply chosen as a Tell tells');
    assert.deepEqual((await asks()).filter(a => a.actor_id === facts.actor), [], 'the reader answered, so nothing waits on them');
    await until(async () => (await mark(p)) === null, 'row mark gone once nothing waits');
    assert.deepEqual(p.errors, []);
  });

  // The topic's people are painted again after every commit in it, and Address
  // with them. A press held on a name while a commit lands still names them.
  await check('asks a press on a name held down while a commit repaints the topic still names them', async () => {
    const p = await page('asks-held', null, true); await p.open(1);
    await replace(p, 'Holding the name down.');
    const chip = `#recipient-chips .choice-chip[data-name=${JSON.stringify(facts.agent)}]`;
    await until(() => p.evaluate(`document.querySelector(${JSON.stringify(chip)})?.getAttribute('aria-pressed') === 'false'`), 'the agent is a name to tap');
    // The names are in the who panel, opened from the who chip (docs/reader.md).
    if (await p.evaluate('document.querySelector("#who-panel").hidden')) await p.point('#who-chip');
    await until(() => p.evaluate('!document.querySelector("#who-panel").hidden'), 'the who panel is open');
    await p.evaluate(`document.querySelector(${JSON.stringify(chip)}).scrollIntoView({block:'center'})`);
    const b = await p.box(chip), x = b.x + b.width / 2, y = b.y + b.height / 2;
    assert.equal(await p.evaluate(`document.elementFromPoint(${x}, ${y}) === document.querySelector(${JSON.stringify(chip)})`), true, 'the agent\'s name is what is pressed');
    await p.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
    await p.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
    // The names a message can be to are filled again in the same turn that
    // paints the topic's people and Address: a record of that is the repaint.
    await p.evaluate(`(()=>{window.namesPainted=0;new MutationObserver(records=>{window.namesPainted+=records.length;}).observe(document.querySelector('#addressable-names'),{childList:true});})()`);
    await control({ method: 'agent_message', operation_id: 'asks-held-commit', body: 'A commit while the name is held down.', topic_id: 't1', addressees: [] });
    await until(() => p.evaluate('window.namesPainted > 0'), 'the commit repaints the topic\'s people while the name is down');
    await p.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
    await until(() => p.evaluate(`document.querySelector(${JSON.stringify(chip)})?.getAttribute('aria-pressed') === 'true'`), 'the held press named the agent');
    assert.deepEqual(p.errors, []);
  });

  await check('asks a reply sent with Ask waits on the agent it names until the agent writes', async () => {
    const p = await page('asks-ask', null, true); await p.open(1);
    await replace(p, 'Who signs off on it?');
    await addressTo(p, facts.agent);
    await p.point('#intent-row button[data-intent="ask"]');
    await until(async () => (await choice(p)).ask === 'checked', 'Ask chosen');
    assert.equal(await p.evaluate('document.querySelector("#send-reply .send-word").textContent'), 'Ask');
    const id = await sent(p, 0);
    assert.equal((await view('source', { source_ref: { kind: 'message', id } })).intent, 'ask');
    assert.deepEqual((await asks()).map(a => [a.actor_id, a.message_id, a.by]), [[facts.agent, id, facts.actor]]);
    const shown = await until(async () => { const m = await mark(p); return m?.state === 'waiting' && m; }, 'row waits on the agent');
    assert.equal(shown.mine, false);
    assert.match(shown.title, /asked fixture-notebook-agent, since /);
    await shot(p, 'asks-row-waiting-on-agent');
    await control({ method: 'agent_message', operation_id: 'asks-agent-answers', body: 'I do.', topic_id: 't1', addressees: [] });
    assert.deepEqual(await asks(), [], 'the agent wrote in the topic, so its wait cleared');
    await until(async () => (await mark(p)) === null, 'row mark cleared live');
    assert.deepEqual(p.errors, []);
  });
}

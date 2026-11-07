import assert from 'node:assert/strict';

// An outcome's conversation (item 82, docs/conversation.md) in the real
// browser against the real server: the page at ?conversation=w1 is a topic
// page, messages above the writing box; a card arrives New and turns Answered
// live; an ask brings "Asks you" and "Waiting on you", and a reply in the
// Reader clears both; Answered by in the writing box is one tap on a name; the
// Reader on a message in a topic sends the writing to the conversation by one
// tap on To; a link to the conversation's topic opens as ?conversation=;
// Only new leaves out what is settled; and the page at 390 wide, light and
// dark. Run by reader_persistence_native.mjs with --conversation;
// screenshots are kept as conversation-*.png for review.
const PHONE = { width: 390, height: 844, deviceScaleFactor: 2, mobile: true };

export async function conversationChecks({ check, page, until, control, view, facts, replace, shot }) {
  const agent = facts.agent, other = 'fixture-planning-agent', person = facts.actor;
  const quiet = async (p, expression) => { try { return await p.evaluate(expression); } catch { return false; } };
  const open = (name, url, setup = {}) => page(name, null, true, { url: facts.origin + url, ...setup });
  const card = id => `#messages [data-id="${id}"]`;
  // What a card shows of its item: its tags in order, "Asks you", and whether it is shown.
  const tags = (p, id) => quiet(p, `(c=>c&&{tags:[...c.querySelectorAll('.item-tag')].map(t=>t.textContent),
    mine:[...c.querySelectorAll('.item-tag.mine')].map(t=>t.textContent), detail:[...c.querySelectorAll('.item-detail')].map(d=>d.textContent),
    asks:c.querySelector('.asks-you')?.textContent??null, shown:c.getClientRects().length>0})(document.querySelector(${JSON.stringify(card(id))}))`);
  const row = p => quiet(p, `(r=>r&&{current:r.getAttribute('aria-current'),waiting:r.querySelector('.topic-state')?.textContent??null,
    unread:r.querySelector('.unread-count')?.textContent??null,shown:r.getClientRects().length>0})(document.querySelector('#conversation-row a'))`);
  const chip = p => quiet(p, `(h=>({hidden:h.hidden||h.getClientRects().length===0,text:h.querySelector('button')?.textContent??null,
    pressed:h.querySelector('button')?.getAttribute('aria-pressed')??null}))(document.querySelector('#conversation-show'))`);
  const post = async (operation, body, args = {}) => (await control({ method: 'agent_message', operation_id: operation, topic_id: conversation.topic_id,
    whole_topic: !args.reply_to, sender: 'person', body, ...args })).result.message_id;
  const answer = async (operation, body, args) => (await control({ method: 'agent_message', operation_id: operation, topic_id: conversation.topic_id,
    sender: agent, body, ...args })).result.message_id;
  const sent = async (p, from) => {
    await p.point('#send-reply');
    const call = await until(() => p.calls.slice(from).find(c => c.payload?.kind === 'message.send'), 'message.send call');
    const receipt = await until(async () => { const r = await view('operation', { operation_id: call.payload.operation_id }); return r.status === 'committed' && r; }, 'send committed');
    return receipt.result.message_id;
  };
  const openCard = async (p, id, words) => {
    await until(() => quiet(p, `Boolean(document.querySelector(${JSON.stringify(card(id))}))`), 'the card is drawn');
    await p.evaluate(`document.querySelector(${JSON.stringify(card(id))}).scrollIntoView({block:'center'})`);
    await p.point(card(id));
    await until(() => quiet(p, `document.querySelector('#reader').open && document.querySelector('#source-body').textContent.includes(${JSON.stringify(words)})`), 'the Reader shows it');
    await until(() => p.evaluate("document.getAnimations().every(animation=>animation.playState!=='running')"), 'settled reader');
  };

  // The person's agent answers in w1's conversation, and a second agent is on the team.
  const conversation = await control({ method: 'coordinator', operation_id: 'conversation-coordinator', coordinator: agent, team: [other] });
  assert.equal(conversation.coordinator.actor_id, agent);

  await check('conversation the page is a topic page, messages above the writing box, and a card arrives New and turns Answered live', async () => {
    const p = await open('conversation-page', '/?conversation=w1');
    await until(() => quiet(p, `!document.querySelector('#conversation-empty').hidden`), 'the empty conversation says what it is for');
    assert.match(await p.evaluate(`document.querySelector('#conversation-empty').textContent`), new RegExp(`^Nothing here yet\\.Write below .* ${agent} answers each one here`));
    assert.equal(await p.evaluate(`document.querySelector('#topic-title').textContent`), 'Conversation');
    assert.match(await p.evaluate(`document.querySelector('#topic-description').textContent`), new RegExp(`${agent} answers here; others answer only when you name them\\.$`));
    assert.equal(await p.evaluate(`document.querySelector('#inline-writing-body').placeholder`), 'Write to Isolated wiring…');
    assert.equal(await p.evaluate('document.body.classList.contains("conversation-page")'), true);
    assert.deepEqual(await until(async () => { const r = await row(p); return r?.shown && r; }, 'the rail row'), { current: 'page', waiting: null, unread: null, shown: true });
    const item = await post('conversation-item', 'Where does the launch stand?');
    const fresh = await until(async () => { const t = await tags(p, item); return t?.tags.length && t; }, 'the card arrives with its tag');
    assert.deepEqual(fresh.tags, ['New']);
    assert.equal(await p.evaluate(`document.querySelector('#conversation-empty').hidden`), true);
    assert.deepEqual(await until(async () => { const c = await chip(p); return !c.hidden && c; }, 'Only new shows'), { hidden: false, text: 'Only new (1)', pressed: 'false' });
    const placed = await p.evaluate(`(()=>{const m=document.querySelector('#messages').getBoundingClientRect(),w=document.querySelector('#inline-composer').getBoundingClientRect();return {messages:m.bottom,writing:w.top}})()`);
    assert.ok(placed.messages <= placed.writing + 1, `the messages sit above the writing box (${JSON.stringify(placed)})`);
    await answer('conversation-answer', 'On track for Friday.', { reply_to: item });
    const answered = await until(async () => { const t = await tags(p, item); return t?.tags[0] === 'Answered' && t; }, 'the card turns Answered without a reload');
    assert.deepEqual(answered.tags, ['Answered']);
    assert.match(answered.detail[0], new RegExp(`^${agent}'s reply · `));
    assert.equal((await until(async () => { const c = await chip(p); return c.hidden && c; }, 'nothing new: the chip goes')).hidden, true);
    await shot(p, 'conversation-answered');
    assert.deepEqual(p.errors, []); await p.close();
  });

  await check('conversation an ask back brings "Asks you" and "Waiting on you", and replying to it in the Reader clears both', async () => {
    const p = await open('conversation-ask', '/?conversation=w1');
    const item = await post('conversation-ask-item', 'Can we move the launch?');
    const ask = await answer('conversation-ask-back', `@${person} to which day?`, { reply_to: item, addressees: [person], intent: 'ask' });
    const waiting = await until(async () => { const t = await tags(p, item); return t?.mine.length && t; }, 'the item waits on the reader');
    assert.deepEqual([waiting.tags, waiting.mine], [['New', 'Waiting on you'], ['Waiting on you']], 'the ask back answers nothing; it waits');
    assert.equal((await tags(p, ask)).asks, 'Asks you');
    assert.equal((await until(async () => { const r = await row(p); return r?.waiting && r; }, 'the row says so')).waiting, 'Waiting on you');
    await shot(p, 'conversation-waiting');
    await openCard(p, ask, 'to which day?');
    await replace(p, 'Friday.');
    const from = p.calls.length;
    const reply = await sent(p, from);
    assert.equal((await view('source', { source_ref: { kind: 'message', id: reply } })).reply_to, ask, 'the reply answers that ask');
    await until(async () => { const t = await tags(p, item); return t && !t.mine.length; }, 'Waiting on you goes');
    await until(async () => (await tags(p, ask))?.asks === null, 'Asks you goes');
    await until(async () => (await row(p))?.waiting === null, 'the row stops waiting');
    assert.deepEqual((await tags(p, item)).tags, ['New'], 'still New: nobody answered the item itself');
    assert.deepEqual(p.errors, []); await p.close();
  });

  await check('conversation Answered by in the writing box names the coordinator, and one tap names someone else instead', async () => {
    const p = await open('conversation-answerers', '/?conversation=w1');
    // The writing box is below the messages, as in any topic.
    await p.evaluate(`document.querySelector('#inline-composer').scrollIntoView({block:'center'})`);
    await p.point('#inline-writing-body');
    const chips = () => quiet(p, `(h=>h&&{label:h.querySelector(':scope > span.muted').textContent,
      chips:[...h.querySelectorAll('.answerer-chips button')].filter(b=>b.getClientRects().length).map(b=>[b.dataset.answerer,b.getAttribute('aria-pressed')]),
      named:[...h.querySelectorAll('.chips .chip')].filter(c=>c.getClientRects().length).map(c=>c.dataset.name)})(document.querySelector('#inline-composer .audience'))`);
    const first = await until(async () => { const c = await chips(); return c?.chips.length === 2 && c; }, 'the team as chips');
    assert.deepEqual(first, { label: 'Answered by', chips: [[agent, 'true'], [other, 'false']], named: [] });
    await p.point(`#inline-composer .answerer-chips button[data-answerer="${agent}"]`);
    assert.deepEqual((await chips()).chips, [[agent, 'true'], [other, 'false']], 'a tap on the coordinator changes nothing');
    await p.point(`#inline-composer .answerer-chips button[data-answerer="${other}"]`);
    const named = await until(async () => { const c = await chips(); return c.chips[1][1] === 'true' && c; }, 'a tap names them');
    assert.deepEqual(named, { label: 'Answered by', chips: [[agent, 'false'], [other, 'true']], named: [] }, 'shown once, as their pressed chip');
    await shot(p, 'conversation-answered-by');
    await p.point(`#inline-composer .answerer-chips button[data-answerer="${other}"]`);
    await until(async () => (await chips()).chips[0][1] === 'true', 'a second tap takes them off');
    assert.deepEqual(p.errors, []); await p.close();
  });

  await check('conversation the Reader on a message in a topic sends the writing to the conversation by one tap on To, waking nobody in the topic', async () => {
    const p = await open('conversation-reader', '/?topic=t1');
    await p.open(1);
    const to = () => quiet(p, `({chips:[...document.querySelectorAll('#reply-destination button')].map(b=>[b.textContent,b.getAttribute('aria-pressed')]),
      note:document.querySelector('#destination-note').hidden?null:document.querySelector('#destination-note').textContent,body:document.querySelector('#writing-body').value})`);
    await until(async () => (await to())?.chips.length === 2, 'two chips under To');
    assert.deepEqual((await to()).chips, [['This topic', 'true'], ['Conversation', 'false']]);
    await replace(p, 'This needs a decision from the team.');
    const before = (await view('topic', { topic_id: 't1' })).topic;
    await p.point('#reply-destination button[data-destination]:not([aria-pressed="true"])');
    const moved = await until(async () => { const t = await to(); return t.chips[1][1] === 'true' && t.body && t; }, 'the conversation is chosen and the writing came along');
    assert.deepEqual(moved, { chips: [['This topic', 'false'], ['Conversation', 'true']],
      note: `Goes to the outcome's conversation with a link to this message. ${agent} answers there; nobody in this topic is woken.`,
      body: 'This needs a decision from the team.' });
    await shot(p, 'conversation-reader-to');
    const sentId = await sent(p, p.calls.length);
    const page = await view('topic_messages', { topic_id: conversation.topic_id, direction: 'before', limit: 20 });
    const message = page.items.find(item => item.id === sentId);
    assert.ok(message, 'it was sent to the conversation');
    assert.deepEqual([message.about?.message_id, message.about?.topic_id, message.item?.state], [facts.sources[1].id, 't1', 'new']);
    const after = (await view('topic', { topic_id: 't1' })).topic;
    assert.deepEqual([after.version, after.latest_message_id ?? null], [before.version, before.latest_message_id ?? null], 'nothing moved in the topic');
    assert.deepEqual(p.errors, []); await p.close();
  });

  await check('conversation a link to its topic opens as ?conversation=, and Only new leaves out what is settled', async () => {
    const p = await open('conversation-address', `/?topic=${conversation.topic_id}`);
    await until(() => quiet(p, `location.search==='?conversation=w1' && document.body.classList.contains('conversation-page')`), 'the address names the conversation');
    const settled = (await view('topic_messages', { topic_id: conversation.topic_id, direction: 'before', limit: 50 })).items.find(item => item.item?.state === 'settled').id;
    const fresh = await post('conversation-only-new', 'One more thing: the press kit.');
    await until(async () => (await tags(p, fresh))?.tags[0] === 'New', 'the new card');
    const count = (await view('conversation', { workspace_id: 'w1' })).conversation.new_items;
    assert.deepEqual(await until(async () => { const c = await chip(p); return c.text === `Only new (${count})` && c; }, 'the count'), { hidden: false, text: `Only new (${count})`, pressed: 'false' });
    await p.point('#conversation-show button');
    await until(async () => (await chip(p)).pressed === 'true', 'pressed');
    assert.deepEqual([(await tags(p, fresh)).shown, (await tags(p, settled)).shown], [true, false], 'only the new cards show');
    await shot(p, 'conversation-only-new');
    await p.point('#conversation-show button');
    await until(async () => (await tags(p, settled))?.shown, 'everything shows again');
    assert.deepEqual(p.errors, []); await p.close();
  });

  await check('conversation at 390 wide, light and dark, the page, its tags and the row fit with no sideways scroll', async () => {
    const backgrounds = [];
    for (const theme of ['light', 'dark']) {
      const p = await open(`conversation-phone-${theme}`, '/?conversation=w1', { beforeNavigate: async q => {
        await q.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: theme }] });
        await q.send('Emulation.setDeviceMetricsOverride', PHONE);
        await q.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 1 });
      } });
      await until(() => quiet(p, `document.querySelectorAll('#messages .item-tag').length > 0`), theme + ': the tags are drawn');
      const fit = await p.evaluate(`(()=>{const v=innerWidth,out=[...document.querySelectorAll('#messages .item-tag-group,#messages .item-tag,#conversation-show button')]
        .filter(e=>e.getClientRects().length).filter(e=>{const r=e.getBoundingClientRect();return r.left<-1||r.right>v+1}).map(e=>e.className);
        return {scroll:document.scrollingElement.scrollWidth,width:v,out,ink:getComputedStyle(document.body).color}})()`);
      assert.ok(fit.scroll <= fit.width, `${theme}: no sideways scroll (${fit.scroll} of ${fit.width})`);
      assert.deepEqual(fit.out, [], `${theme}: every tag inside the screen`);
      backgrounds.push(fit.ink);
      await shot(p, `conversation-phone-${theme}`);
      assert.deepEqual(p.errors, []); await p.close();
    }
    assert.notEqual(backgrounds[0], backgrounds[1], `the words follow the theme (${backgrounds})`);
  });
}

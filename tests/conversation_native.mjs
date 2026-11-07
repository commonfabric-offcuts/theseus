import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

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
    // The writing box is below the messages, as in any topic. Its Answered by
    // row is drawn once the page knows who answers, and the messages above it
    // once they are read; either moves the box, so it is pressed after both.
    await until(() => quiet(p, `document.querySelectorAll('#inline-composer .answerer-chips button').length===2 && document.querySelectorAll('#messages [data-seq]').length>0`),
      'the page knows who answers and shows its messages');
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

  await check('conversation switching To back and forth carries every word each way, leaves nothing behind, and Send sends all of it', async () => {
    const p = await open('conversation-reader-switch', '/?topic=t1');
    await p.open(0);
    const source = facts.sources[0];
    const to = () => quiet(p, `({chips:[...document.querySelectorAll('#reply-destination button')].map(b=>[b.textContent,b.getAttribute('aria-pressed')]),
      body:document.querySelector('#writing-body').value})`);
    const saved = async topicId => (await view('editor_state', { source_ref: source, topic_id: topicId })).draft?.body ?? '';
    const tap = async (label, index) => {
      await p.point(`#reply-destination button:nth-child(${index + 1})`);
      return until(async () => { const t = await to(); return t?.chips[index]?.[1] === 'true' && t; }, `${label} is chosen`);
    };
    await until(async () => (await to())?.chips.length === 2, 'two chips under To');
    await replace(p, 'abc');
    await until(async () => await saved('t1') === 'abc', 'the writing is saved where it is');
    const there = await tap('Conversation', 1);
    assert.equal(there.body, 'abc', 'the writing came along');
    await until(async () => await saved('t1') === '', 'the draft it left is emptied');
    await replace(p, 'abc plus more');
    await until(async () => await saved(conversation.topic_id) === 'abc plus more', 'saved in the conversation');
    const back = await tap('This topic', 0);
    assert.deepEqual(back, { chips: [['This topic', 'true'], ['Conversation', 'false']], body: 'abc plus more' }, 'every word written there came back');
    await until(async () => await saved(conversation.topic_id) === '', 'and the conversation keeps nothing of it');
    assert.equal((await tap('Conversation', 1)).body, 'abc plus more', 'and goes again, whole');
    assert.equal((await tap('This topic', 0)).body, 'abc plus more');
    await until(async () => await saved(conversation.topic_id) === '' && await saved('t1') === 'abc plus more', 'the writing is in one place');
    const sentId = await sent(p, p.calls.length);
    const message = await view('source', { source_ref: { kind: 'message', id: sentId } });
    assert.deepEqual([message.topic_id, message.body], ['t1', 'abc plus more'], 'Send sent all of it to this topic');
    assert.equal(await saved(conversation.topic_id), '', 'nothing is left waiting in the conversation');
    assert.deepEqual(p.errors, []); await p.close();
  });

  await check('conversation writing with an image stays where the image was chosen: To says why and nothing moves', async () => {
    const p = await open('conversation-reader-image', '/?topic=t1');
    await p.open(1);
    const png = (await readFile(new URL('./fixtures/media/one.png', import.meta.url))).toString('base64');
    const to = () => quiet(p, `({chips:[...document.querySelectorAll('#reply-destination button')].map(b=>[b.textContent,b.getAttribute('aria-pressed')]),
      body:document.querySelector('#writing-body').value,notice:document.querySelector('#reader-notice').hidden?null:document.querySelector('#reader-notice').textContent})`);
    await until(async () => (await to())?.chips.length === 2, 'two chips under To');
    await replace(p, 'With a picture.');
    // A page-owned paste event, as the image checks do; never the OS pasteboard.
    assert.equal(await p.evaluate(`(()=>{const data=new DataTransfer();data.items.add(new File([Uint8Array.from(atob(${JSON.stringify(png)}),c=>c.charCodeAt(0))],'one.png',{type:'image/png'}));
      const event=new ClipboardEvent('paste',{bubbles:true,cancelable:true,clipboardData:data});document.querySelector('#writing-body').dispatchEvent(event);return event.defaultPrevented})()`), true);
    await until(async () => (await view('editor_state', { source_ref: facts.sources[1], topic_id: 't1' })).draft?.attachments.length === 1, 'the image is in the draft');
    await p.point('#reply-destination button:nth-child(2)');
    const stayed = await until(async () => { const t = await to(); return (t?.notice || t?.chips[1]?.[1] === 'true') && t; }, 'To answers the tap');
    assert.deepEqual(stayed, { chips: [['This topic', 'true'], ['Conversation', 'false']], body: 'With a picture.',
      notice: 'Images go where they were chosen. Send or remove them before choosing another place.' });
    const kept = (await view('editor_state', { source_ref: facts.sources[1], topic_id: 't1' })).draft;
    assert.deepEqual([kept.body, kept.attachments.length], ['With a picture.', 1], 'the writing and its image are where they were');
    assert.equal((await view('editor_state', { source_ref: facts.sources[1], topic_id: conversation.topic_id })).draft?.body ?? '', '', 'and nothing went to the conversation');
    // The checks after these read this message's reply empty: Remove the image, and delete the words.
    await p.point('#writing-attachments .image-choice button:last-child');
    await p.point('#writing-body'); await p.key('a', 4);
    for (const type of ['rawKeyDown', 'keyUp']) {
      await p.send('Input.dispatchKeyEvent', { type, key: 'Backspace', code: 'Backspace', windowsVirtualKeyCode: 8, ...(type === 'keyUp' ? {} : { commands: ['deleteBackward'] }) });
    }
    await until(async () => { const d = (await view('editor_state', { source_ref: facts.sources[1], topic_id: 't1' })).draft; return d?.body === '' && d.attachments.length === 0; },
      'the reply is empty again');
    assert.deepEqual(p.errors, []); await p.close();
  });

  await check('conversation an image still uploading, or one whose upload failed, keeps its writing where it was chosen: To says why and nothing moves', async () => {
    const p = await open('conversation-reader-uploading', '/?topic=t1');
    await p.open(1);
    const png = (await readFile(new URL('./fixtures/media/one.png', import.meta.url))).toString('base64');
    const to = () => quiet(p, `({chips:[...document.querySelectorAll('#reply-destination button')].map(b=>[b.textContent,b.getAttribute('aria-pressed')]),
      body:document.querySelector('#writing-body').value,notice:document.querySelector('#reader-notice').hidden?null:document.querySelector('#reader-notice').textContent})`);
    const draft = async topicId => (await view('editor_state', { source_ref: facts.sources[1], topic_id: topicId })).draft;
    const paste = () => p.evaluate(`(()=>{const data=new DataTransfer();data.items.add(new File([Uint8Array.from(atob(${JSON.stringify(png)}),c=>c.charCodeAt(0))],'one.png',{type:'image/png'}));
      const event=new ClipboardEvent('paste',{bubbles:true,cancelable:true,clipboardData:data});document.querySelector('#writing-body').dispatchEvent(event);return event.defaultPrevented})()`);
    // Each notice the Reader shows, counted, so a refusal that repeats the
    // words already showing is seen as an answer to the new tap.
    await p.evaluate(`(()=>{window.noticesShown=0;new MutationObserver(()=>window.noticesShown++).observe(document.querySelector('#reader-notice'),{childList:true})})()`);
    const refused = async why => {
      const before = await p.evaluate('window.noticesShown');
      await p.point('#reply-destination button:nth-child(2)');
      const stayed = await until(async () => { const t = await to(), shown = await quiet(p, 'window.noticesShown');
        return (shown > before && t?.notice || t?.chips[1]?.[1] === 'true') && t; }, `To answers the tap ${why}`);
      assert.deepEqual(stayed, { chips: [['This topic', 'true'], ['Conversation', 'false']], body: 'With a picture.',
        notice: 'Images go where they were chosen. Send or remove them before choosing another place.' }, why);
    };
    const remove = async () => {
      assert.equal(await p.evaluate(`document.querySelector('#writing-attachments .image-choice button:last-child')?.textContent`), 'Remove');
      await p.point('#writing-attachments .image-choice button:last-child');
      await until(() => quiet(p, `document.querySelector('#writing-attachments').children.length===0`), 'the image is removed');
      await until(async () => (await draft('t1'))?.attachments.length === 0, 'and the draft holds no image');
    };
    await until(async () => (await to())?.chips.length === 2, 'two chips under To');
    await replace(p, 'With a picture.');
    await until(async () => (await draft('t1'))?.body === 'With a picture.', 'the words are saved');
    p.intercept((_payload, event) => event.request.url.endsWith('/api/media/upload'));
    assert.equal(await paste(), true);
    const held = await until(() => p.held.find(e => e.event.request.url.endsWith('/api/media/upload')), 'the upload is held');
    await until(() => quiet(p, `document.querySelector('#writing-attachments').textContent.includes('Uploading')`), 'the Reply shows it uploading');
    await refused('while the image uploads');
    p.intercept(null); await p.release(held);
    await until(async () => (await draft('t1'))?.attachments.length === 1, 'the upload finishes into the draft it was chosen for');
    assert.deepEqual([(await draft('t1')).body, (await draft(conversation.topic_id))?.body ?? ''], ['With a picture.', ''], 'the words stayed with their image');
    await remove();
    // An upload that fails leaves the image chosen but never attached.
    p.intercept((_payload, event) => event.request.url.endsWith('/api/media/upload'));
    assert.equal(await paste(), true);
    const lost = await until(() => p.held.find(e => e.event.request.url.endsWith('/api/media/upload') && e !== held), 'the second upload is held');
    p.intercept(null); await p.fail(lost);
    await until(() => quiet(p, `!document.querySelector('#writing-attachments').textContent.includes('Uploading') && document.querySelector('#writing-attachments').children.length===1`), 'the upload failed');
    assert.match(await p.evaluate(`document.querySelector('#writing-attachments').textContent`), /^one\.png/, 'the failed image is still chosen');
    assert.equal((await draft('t1'))?.attachments.length ?? 0, 0, 'and not attached');
    await refused('after the upload failed');
    assert.equal((await draft(conversation.topic_id))?.body ?? '', '', 'nothing went to the conversation');
    // The checks after these read this message's reply empty.
    await remove();
    await p.point('#writing-body'); await p.key('a', 4);
    for (const type of ['rawKeyDown', 'keyUp']) {
      await p.send('Input.dispatchKeyEvent', { type, key: 'Backspace', code: 'Backspace', windowsVirtualKeyCode: 8, ...(type === 'keyUp' ? {} : { commands: ['deleteBackward'] }) });
    }
    await until(async () => { const d = await draft('t1'); return d?.body === '' && d.attachments.length === 0; }, 'the reply is empty again');
    assert.deepEqual(p.errors, []); await p.close();
  });

  await check('conversation names and Ask go with the writing when To changes, so the ask waits on whoever it names and nothing stays behind', async () => {
    const p = await open('conversation-reader-names', '/?topic=t1');
    await p.open(0);
    const source = facts.sources[0];
    const draft = async topicId => {
      const d = (await view('editor_state', { source_ref: source, topic_id: topicId })).draft;
      return { body: d?.body ?? '', addressees: d?.addressees ?? [], intent: d?.intent ?? null };
    };
    await until(() => quiet(p, `document.querySelectorAll('#reply-destination button').length===2`), 'two chips under To');
    await p.point('#recipient-input'); await p.send('Input.insertText', { text: other }); await p.key('Enter');
    await until(() => quiet(p, `[...document.querySelectorAll('#recipient-chips .chip')].some(c=>c.dataset.name===${JSON.stringify(other)})`), 'the name is a chip');
    await p.point('#intent-row label[data-intent="ask"]');
    await until(() => quiet(p, `document.querySelector('#intent-row label[data-intent="ask"] input').checked`), 'Ask is chosen');
    await replace(p, 'Which build is it?');
    await until(async () => (await draft('t1')).body === 'Which build is it?', 'saved where it was written');
    await p.point('#reply-destination button:nth-child(2)');
    await until(() => quiet(p, `document.querySelector('#reply-destination button:nth-child(2)').getAttribute('aria-pressed')==='true'`), 'Conversation is chosen');
    assert.deepEqual(await until(async () => { const d = await draft(conversation.topic_id); return d.body && d; }, 'the writing is saved in the conversation'),
      { body: 'Which build is it?', addressees: [other], intent: 'ask' }, 'the name and Ask went with the words');
    assert.deepEqual(await until(async () => { const d = await draft('t1'); return !d.body && d; }, 'the draft it left is emptied'),
      { body: '', addressees: [], intent: null }, 'and nothing of it stayed behind');
    assert.deepEqual([await quiet(p, `[...document.querySelectorAll('#recipient-chips .chip')].map(c=>c.dataset.name)`),
      await quiet(p, `document.querySelector('#intent-row label[data-intent="ask"] input').checked`)], [[other], true], 'the Reply still shows them');
    const sentId = await sent(p, p.calls.length);
    const message = await view('source', { source_ref: { kind: 'message', id: sentId } });
    assert.deepEqual([message.topic_id, message.intent ?? null, message.addressees ?? []], [conversation.topic_id, 'ask', [other]], 'the ask was sent to whoever it names');
    assert.deepEqual(await draft('t1'), { body: '', addressees: [], intent: null }, 'nothing is left waiting in this topic');
    assert.deepEqual(p.errors, []); await p.close();
  });

  await check('conversation a Whisper moved by To stays a Whisper, even onto a draft there that holds an Ask, and is sent to that agent alone', async () => {
    const p = await open('conversation-reader-whisper', '/?topic=t1');
    const source = facts.sources[0];
    const draft = async topicId => {
      const d = (await view('editor_state', { source_ref: source, topic_id: topicId })).draft;
      return { body: d?.body ?? '', addressees: d?.addressees ?? [], intent: d?.intent ?? null, whisper: d?.whisper ?? null };
    };
    const reply = () => quiet(p, `({checked:[...document.querySelectorAll('#intent-row label[data-intent] input:checked')].map(i=>i.value),
      send:document.querySelector('#send-reply .send-word').textContent,line:document.querySelector('#intent-row .audience-line').textContent,
      to:[...document.querySelectorAll('#reply-destination button')].map(b=>b.getAttribute('aria-pressed'))})`);
    const name = async () => {
      await p.point('#recipient-input'); await p.send('Input.insertText', { text: other }); await p.key('Enter');
      await until(() => quiet(p, `[...document.querySelectorAll('#recipient-chips .chip')].some(c=>c.dataset.name===${JSON.stringify(other)})`), 'the name is a chip');
    };
    const choose = async value => {
      await p.point(`#intent-row label[data-intent="${value}"]`);
      await until(async () => (await reply())?.checked[0] === value, `${value} is chosen`);
    };
    // An Ask left waiting in the conversation's draft of this message: the Reader opens on This topic again afterwards.
    await p.open(0);
    await until(() => quiet(p, `document.querySelectorAll('#reply-destination button').length===2`), 'two chips under To');
    await name(); await choose('ask');
    await replace(p, 'Old question.');
    await until(async () => (await draft('t1')).body === 'Old question.', 'saved where it was written');
    await p.point('#reply-destination button:nth-child(2)');
    assert.deepEqual(await until(async () => { const d = await draft(conversation.topic_id); return d.body && d; }, 'the Ask waits in the conversation'),
      { body: 'Old question.', addressees: [other], intent: 'ask', whisper: false });
    await p.point('#reader-close'); await until(() => p.evaluate('!document.querySelector("#reader").open'), 'closed reader');
    // A Whisper to one agent, chosen in this topic.
    await p.open(0);
    await until(async () => (await reply())?.to.join() === 'true,false', 'the Reader opens on This topic');
    await name(); await choose('tell'); await choose('whisper');
    await replace(p, 'Private note.');
    assert.deepEqual(await until(async () => { const d = await draft('t1'); return d.body === 'Private note.' && d; }, 'the whisper is saved here'),
      { body: 'Private note.', addressees: [other], intent: null, whisper: true });
    await p.point('#reply-destination button:nth-child(2)');
    const moved = await until(async () => { const r = await reply(); return r?.to.join() === 'false,true' && r; }, 'Conversation is chosen');
    assert.deepEqual([moved.checked, moved.send], [['whisper'], 'Whisper'], `the Whisper stayed a Whisper (${moved.line})`);
    assert.match(moved.line, new RegExp(`^Only you and ${other} will see this\\.`));
    assert.deepEqual(await until(async () => { const d = await draft(conversation.topic_id); return d.body.includes('Private note.') && d; }, 'saved in the conversation'),
      { body: 'Old question.\n\nPrivate note.', addressees: [other], intent: null, whisper: true }, 'the Ask there did not come through');
    // With Answered by, the whisper's line and an earlier reply's Review, Send sits below the Reply's fold at 900 tall: scrolled to, as a person would.
    await p.evaluate(`document.querySelector('#send-reply').scrollIntoView({block:'nearest'})`);
    const sentId = await sent(p, p.calls.length);
    const message = await view('source', { source_ref: { kind: 'message', id: sentId } });
    assert.deepEqual([message.topic_id, message.whisper ?? false, message.private_to ?? null, message.intent ?? null, message.body],
      [conversation.topic_id, true, other, null, 'Old question.\n\nPrivate note.'], 'sent to that agent alone, never on the record');
    assert.deepEqual(await draft('t1'), { body: '', addressees: [], intent: null, whisper: null }, 'nothing is left waiting in this topic');
    assert.deepEqual(p.errors, []); await p.close();
  });

  await check('conversation a link to its topic opens as ?conversation=, and Only new leaves out what is settled', async () => {
    const p = await open('conversation-address', `/?topic=${conversation.topic_id}`);
    await until(() => quiet(p, `location.search==='?conversation=w1' && document.body.classList.contains('conversation-page')`), 'the address names the conversation');
    // One item answered, so there is something settled to leave out.
    const settled = await post('conversation-settled', 'Is the venue booked?');
    await answer('conversation-settled-answer', 'Yes, since Monday.', { reply_to: settled });
    await until(async () => (await tags(p, settled))?.tags[0] === 'Answered', 'the settled card');
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

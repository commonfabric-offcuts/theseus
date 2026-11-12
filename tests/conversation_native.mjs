import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

// An outcome's conversation (item 82, docs/conversation.md) in the real
// browser against the real server: the page at ?conversation=w1 is a topic
// page, messages above the writing box; a card arrives New and turns Answered
// live; an ask back answers the item and brings "Asks you" and "Waiting on
// you", and a reply in the Reader clears both, as does the bar's 👍 on the ask
// (item 239), which brings both back when it is taken back; Answered by in the writing box is one tap on a name; the
// Reader on a message in a topic sends the writing to the conversation by one
// tap on To; replies stack as in any topic, with each stacked card's tags,
// "Asks you", links, keys, menu and Only new at work (item 227, at 1280 wide,
// light and dark); a link to the conversation's topic opens as ?conversation=;
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
  // Under Only new every card shown lays out as a card standing on its own does, whatever stack it is in and whatever else of
  // that stack shows: in line with the list on both sides, and the space under it, before the next card shown, is the space
  // between two cards that stand alone. Each card shown, in order: [id, left inset, right inset, space to the next].
  const onlyNewLayout = async (p, label) => {
    const cards = await p.evaluate(`(l=>{const b=l.getBoundingClientRect(),r=v=>Math.round(v*10)/10;
      const shown=[...l.querySelectorAll(':scope > [data-id], :scope > .reply-stack > [data-id], :scope > .reply-stack > .stack-replies > [data-id]')].filter(e=>e.getClientRects().length);
      return shown.map((e,i)=>{const c=e.getBoundingClientRect(),n=shown[i+1];
        return {id:e.dataset.id,alone:e.parentElement===l&&n?.parentElement===l,row:[e.dataset.id,r(c.left-b.left),r(b.right-c.right),n?r(n.getBoundingClientRect().top-c.bottom):null]}})})(document.querySelector('#messages'))`);
    const lone = cards.find(card => card.alone);
    assert.ok(lone, `${label}: two cards that stand alone, one after the other ${JSON.stringify(cards)}`);
    const space = lone.row[3];
    assert.ok(space > 0, `${label}: cards that stand alone have space between them (${space})`);
    assert.deepEqual(cards.map(card => card.row), cards.map((card, i) => [card.id, 0, 0, i < cards.length - 1 ? space : null]), `${label}: every card shown lays out as one standing alone`);
    return cards.map(card => card.id);
  };
  // The Conversation's row: in the outline, the outcome's own row, open (outline-rail.mjs).
  const row = p => quiet(p, `(r=>r&&{current:r.getAttribute('aria-current'),waiting:r.querySelector('.topic-state')?.textContent??null,
    unread:r.querySelector('.unread-count')?.textContent??null,shown:r.getClientRects().length>0})(document.querySelector('#outline .ol-name[data-conversation-of="w1"]'))`);
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

  await check('conversation an ask back answers the item and brings "Asks you" and "Waiting on you", and replying to it in the Reader clears both', async () => {
    const p = await open('conversation-ask', '/?conversation=w1');
    const item = await post('conversation-ask-item', 'Can we move the launch?');
    const ask = await answer('conversation-ask-back', `@${person} to which day?`, { reply_to: item, addressees: [person], intent: 'ask' });
    const waiting = await until(async () => { const t = await tags(p, item); return t?.mine.length && t; }, 'the item waits on the reader');
    assert.deepEqual([waiting.tags, waiting.mine], [['Answered', 'Waiting on you'], ['Waiting on you']], 'the ask back answers the item, and its ask waits');
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
    assert.deepEqual((await tags(p, item)).tags, ['Answered'], 'still Answered: the reply to the ask settles nothing more');
    assert.deepEqual(p.errors, []); await p.close();
  });

  await check('conversation 👍 on an ask to the reader answers it yes: "Asks you" and "Waiting on you" go live, and taking the 👍 back brings them back', async () => {
    // Item 239: a person's 👍 on an ask that waits on them answers it, in Core, and the page shows what Core says.
    const p = await open('conversation-thumb', '/?conversation=w1');
    const item = await post('conversation-thumb-item', 'Shall we launch on Friday?');
    const ask = await answer('conversation-thumb-ask', `@${person} morning or afternoon?`, { reply_to: item, addressees: [person], intent: 'ask' });
    const waits = async () => (await view('conversation', { workspace_id: 'w1' })).conversation.waits.filter(wait => wait.ask_message_id === ask).map(wait => wait.on);
    const waiting = async on => {
      const word = on ? 'Waiting on you' : null;
      await until(async () => (await tags(p, ask))?.asks === (on ? 'Asks you' : null), `"Asks you" ${on ? 'shows' : 'goes'}`);
      await until(async () => { const t = await tags(p, item); return t && JSON.stringify(t.mine) === JSON.stringify(on ? [word] : []); }, `Waiting on you ${on ? 'shows on' : 'goes from'} the item`);
      await until(async () => (await row(p))?.waiting === word, `the row ${on ? 'waits' : 'stops waiting'}`);
    };
    await waiting(true);
    assert.deepEqual(await waits(), [person], 'Core: the ask waits on the reader');
    // The bar's 👍, pressed as a person presses it: the pointer rests on the ask's card, then clicks the bar's 👍.
    const thumb = async on => {
      const words = `#messages .message-card[data-id="${ask}"] > .message-preview`;
      await p.evaluate(`document.querySelector(${JSON.stringify(words)}).scrollIntoView({block:'center'})`);
      await p.point(words, 'move');
      await until(() => quiet(p, `(b=>Boolean(b&&!b.hidden&&b.querySelector('[data-act=thumb]')))(document.querySelector('.message-bar'))`), 'the ask lights, with its bar');
      await p.point('.message-bar [data-act=thumb]');
      await until(async () => (await view('reactions', { message_id: ask })).reactions.thumbs.some(t => t.actor_id === person && t.answered === true) === on,
        `Core holds the 👍 ${on ? 'as a yes' : 'taken back'}`);
    };
    await thumb(true);
    assert.deepEqual(await waits(), [], 'Core: the 👍 answered the ask, and the waits agents read say so');
    await waiting(false);
    assert.deepEqual((await tags(p, item)).tags, ['Answered'], 'the item stays Answered');
    await shot(p, 'conversation-thumb-answered');
    await thumb(false);
    assert.deepEqual(await waits(), [person], 'Core: taking the 👍 back makes the ask wait again');
    await waiting(true);
    // A 👍 again answers it again, and leaves nothing waiting on the reader for the checks after this one.
    await thumb(true);
    await waiting(false);
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
    // The names are in the who panel, which the who chip opens (docs/reader.md).
    await p.point('#inline-writing-body'); await p.point('#inline-who-chip');
    const chips = () => quiet(p, `(h=>h&&{label:h.closest('.who-row').querySelector(':scope > .who-label').textContent,
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

  await check('conversation writing with an image stays where the image was chosen: To opens the conversation empty and says the writing is kept here', async () => {
    const p = await open('conversation-reader-image', '/?topic=t1');
    await p.open(1);
    const png = (await readFile(new URL('./fixtures/media/one.png', import.meta.url))).toString('base64');
    const to = () => quiet(p, `({chips:[...document.querySelectorAll('#reply-destination button')].map(b=>[b.textContent,b.getAttribute('aria-pressed')]),
      body:document.querySelector('#writing-body').value,images:document.querySelector('#writing-attachments').children.length,
      notice:document.querySelector('#reader-notice').hidden?null:document.querySelector('#reader-notice').textContent})`);
    const draft = async topicId => (await view('editor_state', { source_ref: facts.sources[1], topic_id: topicId })).draft;
    await until(async () => (await to())?.chips.length === 2, 'two chips under To');
    await replace(p, 'With a picture.');
    // A page-owned paste event, as the image checks do; never the OS pasteboard.
    assert.equal(await p.evaluate(`(()=>{const data=new DataTransfer();data.items.add(new File([Uint8Array.from(atob(${JSON.stringify(png)}),c=>c.charCodeAt(0))],'one.png',{type:'image/png'}));
      const event=new ClipboardEvent('paste',{bubbles:true,cancelable:true,clipboardData:data});document.querySelector('#writing-body').dispatchEvent(event);return event.defaultPrevented})()`), true);
    await until(async () => (await draft('t1'))?.attachments.length === 1, 'the image is in the draft');
    await p.point('#reply-destination button:nth-child(2)');
    // The line is written in the same task that presses the chip, so either one shows the answer whole.
    const there = await until(async () => { const t = await to(); return (t?.notice || t?.chips[1]?.[1] === 'true') && t; }, 'To answers the tap');
    assert.deepEqual(there, { chips: [['This topic', 'false'], ['Conversation', 'true']], body: '', images: 0, notice: 'Your writing for This topic is kept there.' },
      'the conversation opens with its own empty draft');
    const kept = await draft('t1');
    assert.deepEqual([kept.body, kept.attachments.length], ['With a picture.', 1], 'the writing and its image are where they were');
    assert.equal((await draft(conversation.topic_id))?.body ?? '', '', 'and nothing went to the conversation');
    await p.point('#reply-destination button:nth-child(1)');
    const back = await until(async () => { const t = await to(); return t?.chips[0]?.[1] === 'true' && t.images === 1 && t; }, 'back on This topic');
    assert.deepEqual([back.body, back.notice], ['With a picture.', null], 'the writing is there as it was, and the empty conversation had nothing to keep');
    // The checks after these read this message's reply empty: Remove the image, and delete the words.
    await p.point('#writing-attachments .image-choice button:last-child');
    await p.point('#writing-body'); await p.key('a', 4);
    for (const type of ['rawKeyDown', 'keyUp']) {
      await p.send('Input.dispatchKeyEvent', { type, key: 'Backspace', code: 'Backspace', windowsVirtualKeyCode: 8, ...(type === 'keyUp' ? {} : { commands: ['deleteBackward'] }) });
    }
    await until(async () => { const d = await draft('t1'); return d?.body === '' && d.attachments.length === 0; }, 'the reply is empty again');
    assert.deepEqual(p.errors, []); await p.close();
  });

  await check('conversation an image still uploading, or one whose upload failed, keeps its writing where it was chosen: To opens the conversation and nothing moves', async () => {
    const p = await open('conversation-reader-uploading', '/?topic=t1');
    await p.open(1);
    const png = (await readFile(new URL('./fixtures/media/one.png', import.meta.url))).toString('base64');
    const to = () => quiet(p, `({chips:[...document.querySelectorAll('#reply-destination button')].map(b=>[b.textContent,b.getAttribute('aria-pressed')]),
      body:document.querySelector('#writing-body').value,notice:document.querySelector('#reader-notice').hidden?null:document.querySelector('#reader-notice').textContent})`);
    const draft = async topicId => (await view('editor_state', { source_ref: facts.sources[1], topic_id: topicId })).draft;
    const paste = () => p.evaluate(`(()=>{const data=new DataTransfer();data.items.add(new File([Uint8Array.from(atob(${JSON.stringify(png)}),c=>c.charCodeAt(0))],'one.png',{type:'image/png'}));
      const event=new ClipboardEvent('paste',{bubbles:true,cancelable:true,clipboardData:data});document.querySelector('#writing-body').dispatchEvent(event);return event.defaultPrevented})()`);
    const tap = async (index, why) => {
      await p.point(`#reply-destination button:nth-child(${index + 1})`);
      return until(async () => { const t = await to(); return t?.chips[index]?.[1] === 'true' && t; }, `To answers the tap ${why}`);
    };
    const kept = async why => {
      await p.point('#reply-destination button:nth-child(2)');
      assert.deepEqual(await until(async () => { const t = await to(); return (t?.notice || t?.chips[1]?.[1] === 'true') && t; }, `To answers the tap ${why}`),
        { chips: [['This topic', 'false'], ['Conversation', 'true']], body: '', notice: 'Your writing for This topic is kept there.' }, why);
      assert.equal((await draft(conversation.topic_id))?.body ?? '', '', `nothing went to the conversation ${why}`);
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
    await kept('while the image uploads');
    p.intercept(null); await p.release(held);
    await until(async () => (await draft('t1'))?.attachments.length === 1, 'the upload finishes into the draft it was chosen for');
    assert.deepEqual([(await draft('t1')).body, (await draft(conversation.topic_id))?.body ?? ''], ['With a picture.', ''], 'the words stayed with their image');
    assert.equal((await tap(0, 'back')).body, 'With a picture.', 'back on This topic, the writing is there');
    await until(() => quiet(p, `document.querySelector('#writing-attachments').children.length===1`), 'with its image');
    await remove();
    // An upload that fails leaves the image chosen but never attached.
    p.intercept((_payload, event) => event.request.url.endsWith('/api/media/upload'));
    assert.equal(await paste(), true);
    const lost = await until(() => p.held.find(e => e.event.request.url.endsWith('/api/media/upload') && e !== held), 'the second upload is held');
    p.intercept(null); await p.fail(lost);
    await until(() => quiet(p, `!document.querySelector('#writing-attachments').textContent.includes('Uploading') && document.querySelector('#writing-attachments').children.length===1`), 'the upload failed');
    assert.match(await p.evaluate(`document.querySelector('#writing-attachments').textContent`), /^one\.png/, 'the failed image is still chosen');
    assert.equal((await draft('t1'))?.attachments.length ?? 0, 0, 'and not attached');
    await kept('after the upload failed');
    assert.equal((await tap(0, 'back again')).body, 'With a picture.');
    await until(() => quiet(p, `document.querySelector('#writing-attachments').textContent.startsWith('one.png')`), 'the failed image is still chosen there');
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
    await until(() => quiet(p, `[...document.querySelectorAll('#recipient-chips [data-name]')].filter(c=>c.classList.contains('chip')||c.getAttribute('aria-pressed')==='true').map(c=>c.dataset.name).includes(${JSON.stringify(other)})`), 'the name is a chip');
    await p.point('#intent-row button[data-intent="ask"]');
    await until(() => quiet(p, `document.querySelector('#intent-row button[data-intent="ask"]').getAttribute('aria-pressed')==='true'`), 'Ask is chosen');
    await replace(p, 'Which build is it?');
    await until(async () => (await draft('t1')).body === 'Which build is it?', 'saved where it was written');
    await p.point('#reply-destination button:nth-child(2)');
    await until(() => quiet(p, `document.querySelector('#reply-destination button:nth-child(2)').getAttribute('aria-pressed')==='true'`), 'Conversation is chosen');
    assert.deepEqual(await until(async () => { const d = await draft(conversation.topic_id); return d.body && d; }, 'the writing is saved in the conversation'),
      { body: 'Which build is it?', addressees: [other], intent: 'ask' }, 'the name and Ask went with the words');
    assert.deepEqual(await until(async () => { const d = await draft('t1'); return !d.body && d; }, 'the draft it left is emptied'),
      { body: '', addressees: [], intent: null }, 'and nothing of it stayed behind');
    assert.deepEqual([await quiet(p, `[...document.querySelectorAll('#recipient-chips [data-name]')].filter(c=>c.classList.contains('chip')||c.getAttribute('aria-pressed')==='true').map(c=>c.dataset.name)`),
      await quiet(p, `document.querySelector('#intent-row button[data-intent="ask"]').getAttribute('aria-pressed')==='true'`)], [[other], true], 'the Reply still shows them');
    const sentId = await sent(p, p.calls.length);
    const message = await view('source', { source_ref: { kind: 'message', id: sentId } });
    assert.deepEqual([message.topic_id, message.intent ?? null, message.addressees ?? []], [conversation.topic_id, 'ask', [other]], 'the ask was sent to whoever it names');
    assert.deepEqual(await draft('t1'), { body: '', addressees: [], intent: null }, 'nothing is left waiting in this topic');
    assert.deepEqual(p.errors, []); await p.close();
  });

  await check('conversation To never merges two drafts: a Whisper switched onto a conversation draft holding an Ask leaves both as they were, and is sent to that agent alone', async () => {
    const p = await open('conversation-reader-whisper', '/?topic=t1');
    const source = facts.sources[0];
    const draft = async topicId => {
      const d = (await view('editor_state', { source_ref: source, topic_id: topicId })).draft;
      return { body: d?.body ?? '', addressees: d?.addressees ?? [], intent: d?.intent ?? null, whisper: d?.whisper ?? null };
    };
    const reply = () => quiet(p, `({checked:[...document.querySelectorAll('#intent-row button[data-intent][aria-pressed=true]')].map(c=>c.dataset.intent),
      send:document.querySelector('#send-reply .send-word').textContent,body:document.querySelector('#writing-body').value,
      names:[...document.querySelectorAll('#recipient-chips [data-name]')].filter(c=>c.classList.contains('chip')||c.getAttribute('aria-pressed')==='true').map(c=>c.dataset.name),
      notice:document.querySelector('#reader-notice').hidden?null:document.querySelector('#reader-notice').textContent,
      to:[...document.querySelectorAll('#reply-destination button')].map(b=>b.getAttribute('aria-pressed'))})`);
    const name = async () => {
      await p.point('#recipient-input'); await p.send('Input.insertText', { text: other }); await p.key('Enter');
      await until(() => quiet(p, `[...document.querySelectorAll('#recipient-chips [data-name]')].filter(c=>c.classList.contains('chip')||c.getAttribute('aria-pressed')==='true').map(c=>c.dataset.name).includes(${JSON.stringify(other)})`), 'the name is a chip');
    };
    const choose = async value => {
      await p.point(`#intent-row button[data-intent="${value}"]`);
      await until(async () => (await reply())?.checked[0] === value, `${value} is chosen`);
    };
    const ask = { body: 'Old question.', addressees: [other], intent: 'ask', whisper: false };
    const whisper = { body: 'Private note.', addressees: [other], intent: null, whisper: true };
    // An Ask left waiting in the conversation's draft of this message: the Reader opens on This topic again afterwards.
    await p.open(0);
    await until(() => quiet(p, `document.querySelectorAll('#reply-destination button').length===2`), 'two chips under To');
    await name(); await choose('ask');
    await replace(p, 'Old question.');
    await until(async () => (await draft('t1')).body === 'Old question.', 'saved where it was written');
    await p.point('#reply-destination button:nth-child(2)');
    assert.deepEqual(await until(async () => { const d = await draft(conversation.topic_id); return d.body && d; }, 'the Ask moved whole into the empty conversation draft'), ask);
    await p.point('#reader-close'); await until(() => p.evaluate('!document.querySelector("#reader").open'), 'closed reader');
    // A Whisper to one agent, chosen in this topic.
    await p.open(0);
    await until(async () => (await reply())?.to.join() === 'true,false', 'the Reader opens on This topic');
    await name(); await choose('tell'); await choose('whisper');
    await replace(p, 'Private note.');
    assert.deepEqual(await until(async () => { const d = await draft('t1'); return d.body === 'Private note.' && d; }, 'the whisper is saved here'), whisper);
    await p.point('#reply-destination button:nth-child(2)');
    const there = await until(async () => { const r = await reply(); return r?.to.join() === 'false,true' && (r.notice || r.body && r.body !== 'Old question.') && r; }, 'Conversation is chosen');
    assert.deepEqual([there.body, there.names, there.checked, there.notice], ['Old question.', [other], ['ask'], 'Your writing for This topic is kept there.'],
      "the conversation's own draft opens as it was, and one line says where the whisper is");
    // The line is as wide as its words, not the pane.
    const fits = await p.evaluate(`(n=>{const r=document.createRange();r.selectNodeContents(n);const s=getComputedStyle(n);
      const edges=['paddingLeft','paddingRight','borderLeftWidth','borderRightWidth'].reduce((sum,key)=>sum+parseFloat(s[key]),0);
      return {box:n.getBoundingClientRect().width,words:r.getBoundingClientRect().width+edges,pane:n.parentElement.clientWidth}})(document.querySelector('#reader-notice'))`);
    assert.ok(fits.box <= fits.words + 2 && fits.box < fits.pane / 2, `the line is as wide as its words: ${fits.box} for ${fits.words}, in a pane ${fits.pane} wide`);
    await shot(p, 'conversation-reader-kept');
    assert.deepEqual([await draft(conversation.topic_id), await draft('t1')], [ask, whisper], 'nothing merged: both drafts are as they were');
    await p.point('#reply-destination button:nth-child(1)');
    const back = await until(async () => { const r = await reply(); return r?.to.join() === 'true,false' && (r.notice || r.body && r.body !== 'Private note.') && r; }, 'This topic is chosen again');
    assert.deepEqual([back.body, back.names, back.checked, back.send, back.notice], ['Private note.', [other], ['whisper'], 'Whisper', 'Your writing for the conversation is kept there.'],
      'the Whisper is still a Whisper, in its own draft');
    assert.deepEqual([await draft(conversation.topic_id), await draft('t1')], [ask, whisper], 'and switching back merged nothing either');
    await p.evaluate(`document.querySelector('#send-reply').scrollIntoView({block:'nearest'})`);
    const sentId = await sent(p, p.calls.length);
    const message = await view('source', { source_ref: { kind: 'message', id: sentId } });
    assert.deepEqual([message.topic_id, message.whisper ?? false, message.private_to ?? null, message.intent ?? null, message.body],
      ['t1', true, other, null, 'Private note.'], 'sent to that agent alone, never on the record');
    assert.deepEqual(await draft(conversation.topic_id), ask, "the conversation's Ask still waits in its own draft");
    assert.deepEqual(p.errors, []); await p.close();
  });

  await check('conversation writing that To moves into an empty draft is the same Tell in this topic and in the conversation, and is sent as that, either way', async () => {
    const text = 'Private: I think the build is broken.', status = 'Status, please.', words = 'The build finished.';
    // A topic of its own in the outcome, so the checks after these find nothing new in t1.
    const place = 'conversation-kind';
    await control({ method: 'navigation_topics', topics: [{ id: place, title: 'Build watch' }] });
    const id = (await control({ method: 'agent_message', operation_id: 'conversation-kind-source', topic_id: place, source: 'topic', join: true, body: words })).result.message_id;
    const p = await open('conversation-reader-kind', `/?topic=${place}`);
    const source = { kind: 'message', id };
    const draft = async topicId => {
      const d = (await view('editor_state', { source_ref: source, topic_id: topicId })).draft;
      return { body: d?.body ?? '', addressees: d?.addressees ?? [], intent: d?.intent ?? null, whisper: d?.whisper ?? null };
    };
    const reply = () => quiet(p, `({checked:[...document.querySelectorAll('#intent-row button[data-intent][aria-pressed=true]')].map(c=>c.dataset.intent),
      send:document.querySelector('#send-reply .send-word').textContent,body:document.querySelector('#writing-body').value,
      who:document.querySelector('#who-sentence .audience-line strong')?.textContent??null,
      names:[...document.querySelectorAll('#recipient-chips [data-name]')].filter(c=>c.classList.contains('chip')||c.getAttribute('aria-pressed')==='true').map(c=>c.dataset.name),
      notice:document.querySelector('#reader-notice').hidden?null:document.querySelector('#reader-notice').textContent,
      to:[...document.querySelectorAll('#reply-destination button')].map(b=>b.getAttribute('aria-pressed'))})`);
    const tap = async (index, body, why) => {
      await p.point(`#reply-destination button:nth-child(${index + 1})`);
      return until(async () => { const r = await reply(); return r?.to[index] === 'true' && r.body === body && r; }, why);
    };
    const sentAs = async () => {
      await p.evaluate(`document.querySelector('#send-reply').scrollIntoView({block:'nearest'})`);
      const message = await view('source', { source_ref: { kind: 'message', id: await sent(p, p.calls.length) } });
      return [message.topic_id, message.whisper ?? false, message.private_to ?? null, message.intent ?? null, message.body];
    };
    const reopen = async () => {
      if (await quiet(p, 'document.querySelector("#reader").open')) {
        await p.point('#reader-close'); await until(() => p.evaluate('!document.querySelector("#reader").open'), 'closed reader');
      }
      await openCard(p, id, words);
      await until(async () => (await reply())?.to.join() === 'true,false', 'the Reader opens on This topic');
    };
    // A reply to one agent starts as a Tell, in this topic and in the conversation alike: nothing goes private by default.
    await reopen();
    await replace(p, text);
    await until(async () => (await draft(place)).body === text, 'saved where it was written');
    const here = await reply();
    assert.deepEqual([here.checked, here.send, here.who], [['tell'], 'Tell', 'Everyone in this topic'], 'the Reader shows a Tell to the agent');
    const moved = await tap(1, text, 'Conversation is chosen, with the writing');
    assert.deepEqual([moved.checked, moved.send, moved.who, moved.names, moved.notice], [['tell'], 'Tell', 'Everyone in the conversation', [agent], null],
      'the moved writing is the same Tell there');
    assert.deepEqual(await until(async () => { const d = await draft(conversation.topic_id); return d.body && d; }, 'kept in the conversation'),
      { body: text, addressees: [agent], intent: null, whisper: null }, 'no choice is written down for it');
    assert.deepEqual(await sentAs(), [conversation.topic_id, false, null, 'tell', text], 'sent on the record as a Tell, as shown');
    // The other way: a Tell to one agent written in the conversation, moved into this topic's empty draft.
    await reopen();
    await tap(1, '', 'Conversation is chosen, with nothing to move');
    // Someone in the topic is a name tapped once, and a second tap takes them off; anyone else has a ×.
    if ((await reply()).names.includes(agent)) {
      const chip = `#recipient-chips [data-name="${agent}"]`;
      await p.point(await quiet(p, `document.querySelector(${JSON.stringify(chip)}).classList.contains('choice-chip')`) ? chip : `${chip} button`);
    }
    await p.point('#recipient-input'); await p.send('Input.insertText', { text: other }); await p.key('Enter');
    await until(async () => (await reply())?.names.join() === other, 'only the second agent is named');
    await replace(p, status);
    await until(async () => (await draft(conversation.topic_id)).body === status, 'saved in the conversation');
    const there = await reply();
    // The sentence says where the reply goes: the conversation (docs/reader.md, "Where it goes").
    assert.deepEqual([there.checked, there.send, there.who], [['tell'], 'Tell', 'Everyone in the conversation'], 'the conversation shows a Tell');
    const back = await tap(0, status, 'This topic is chosen, with the writing');
    assert.deepEqual([back.checked, back.send, back.who, back.names, back.notice], [['tell'], 'Tell', 'Everyone in this topic', [other], null],
      'the moved writing keeps the Tell the Reader showed');
    const told = await sentAs();
    assert.deepEqual(told, [place, false, null, 'tell', status], 'sent on the record as a Tell, as shown');
    assert.deepEqual(p.errors, []); await p.close();
  });

  await check('conversation replies stack under the message they answer, as in any topic, and what the conversation paints on a card works on a stacked one', async () => {
    // An item answered, followed up (a new item of its own), asked back about
    // and noted, all read before the page opens; then one more reply, unread.
    const item = await post('conversation-stack-item', 'Is the venue booked?');
    const answered = await answer('conversation-stack-answer', 'Yes, since Monday.', { reply_to: item });
    const followUp = await post('conversation-stack-follow', 'And the caterer?', { reply_to: answered });
    const ask = await answer('conversation-stack-ask', `@${person} which room?`, { reply_to: item, addressees: [person], intent: 'ask' });
    const noted = await answer('conversation-stack-noted', 'Noted.', { reply_to: answered, read: true });
    const late = await answer('conversation-stack-late', 'The menu is set too.', { reply_to: noted });
    const DESK = { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false };
    const desk = theme => ({ beforeNavigate: async q => {
      await q.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: theme }] });
      await q.send('Emulation.setDeviceMetricsOverride', DESK);
    } });
    // The stack that holds the answer: its head, each reply (oldest first, as a chat reads) and whether it shows, its fold lines shown, and what follows it.
    const stack = q => quiet(q, `(s=>s&&{head:s.querySelector(':scope > [data-id]')?.dataset.id??null,
      replies:[...s.querySelectorAll(':scope > .stack-replies > [data-id]')].map(e=>[e.dataset.id,e.getClientRects().length>0]),
      lines:[...s.querySelectorAll(':scope > .stack-replies > .stack-fold-line')].filter(t=>t.getClientRects().length).map(t=>t.textContent),
      after:s.nextElementSibling?.dataset?.line??null})(document.querySelector(${JSON.stringify(card(answered))})?.closest('.reply-stack'))`);
    // The page draws its messages, then the conversation's read brings the tags and the asks that wait: the state each check reads is the one it settles in.
    const settles = async (probe, expected, label) => {
      let last;
      await until(async () => { last = await probe(); return JSON.stringify(last) === JSON.stringify(expected); }, label).catch(() => {});
      assert.deepEqual(last, expected, label);
    };
    const p = await open('conversation-stacks', '/?conversation=w1', desk('light'));
    await settles(() => stack(p), { head: item, replies: [[answered, false], [followUp, false], [ask, false], [noted, false], [late, true]], lines: [], after: 'new' },
      'the partial stack shows latest plus unread: read New items and read asks do not force earlier replies into view, and the New line stays under the stack');
    // The chevron opens all messages; read items retain their tags and controls there.
    await p.evaluate(`document.querySelector(${JSON.stringify(card(item))}).scrollIntoView({block:'center'})`);
    await p.point(`#messages .reply-stack[data-stack="${item}"] > .stack-toggle`);
    await settles(() => stack(p), { head: item, replies: [[answered, true], [followUp, true], [ask, true], [noted, true], [late, true]], lines: [], after: 'new' },
      'opening all shows every reply in order, including the read New item and the read ask');
    const seen = [await tags(p, item), await tags(p, followUp), await tags(p, ask)];
    assert.deepEqual([seen[0].mine, seen[1].tags, seen[1].shown, seen[2].asks, seen[2].shown], [['Waiting on you'], ['New'], true, 'Asks you', true],
      'the stacked New item shows its tag, the stacked ask its "Asks you", and its item waits on you');
    await shot(p, 'conversation-stack-1280-light');
    // Every commit paints each card's tags again; one that changes nothing on a card leaves its links, so a press on one lands.
    await p.evaluate(`(window.tagLink=document.querySelector(${JSON.stringify(card(item) + ' .item-tags .item-link')}),true)`);
    const another = await post('conversation-stack-another', 'Another question.');
    await until(async () => (await tags(p, another))?.tags[0] === 'New', 'a new item lands, and the page paints every card\'s tags');
    assert.equal(await p.evaluate('window.tagLink.isConnected'), true, 'the stacked item\'s tag link is the one that was there');
    // The Answered tag's link to the reply the stack folds away opens the stack and lands on it, in the Reader.
    // Its original message and tags are available in the fully open stack.
    await p.evaluate(`document.querySelector(${JSON.stringify(card(item))}).scrollIntoView({block:'center'})`);
    await p.point(`${card(item)} .item-tags .item-tag-group:first-child .item-link`);
    await until(() => quiet(p, `document.querySelector('#reader').open && document.querySelector('#source-body').textContent.includes('Yes, since Monday.')`), 'the Reader shows the reply');
    // In view as scrolling brings it, to the pixel it rounds to.
    const landed = await p.evaluate(`(c=>{const b=c.getBoundingClientRect();return {shown:c.getClientRects().length>0,inView:b.top>=-1&&b.bottom<=innerHeight+1,
      open:c.closest('.reply-stack').dataset.fold,top:b.top,bottom:b.bottom,height:innerHeight,scroll:scrollY}})(document.querySelector(${JSON.stringify(card(answered))}))`);
    assert.deepEqual([landed.shown, landed.inView, landed.open], [true, true, 'open'], 'its stack opened and the reply is in view ' + JSON.stringify(landed));
    await p.point('#reader-close'); await until(() => p.evaluate('!document.querySelector("#reader").open'), 'closed reader');
    // The keys light what the focus is on: the pointer rests where no message is, so it lights none.
    const focusOn = async id => {
      await p.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 4, y: DESK.height - 4 });
      await p.evaluate(`(document.activeElement?.blur(),document.querySelector(${JSON.stringify(card(id))}).focus(),true)`);
    };
    // ↓ moves the light down the stack, oldest reply first, a folded reply opened included, and Return replies to the lit one.
    await focusOn(item);
    const litId = () => quiet(p, `document.querySelector('#messages .lit[data-id]')?.dataset.id??null`);
    await until(async () => await litId() === item, 'the focused card lights');
    for (const id of [answered, followUp, ask]) { await p.key('ArrowDown'); await until(async () => await litId() === id, `↓ lights ${id}`); }
    await p.key('Enter');
    await until(() => quiet(p, `document.querySelector('#reader').open && document.querySelector('#source-body').textContent.includes('which room?') && document.activeElement?.id==='writing-body'`),
      'Return opens the lit stacked ask in the Reader, ready to reply');
    await p.point('#reader-close'); await until(() => p.evaluate('!document.querySelector("#reader").open'), 'closed reader');
    // The bar's ⋯ on a stacked reply opens its menu: the message's acts, then its stack's, each naming its keys.
    await focusOn(ask);
    await until(async () => await litId() === ask && await quiet(p, `!document.querySelector('.message-bar').hidden`), 'the stacked ask is lit, with its bar');
    await p.point('.message-bar [data-act=more]');
    assert.deepEqual(await until(() => quiet(p, `(l=>l&&[...l.querySelectorAll('button')].map(b=>b.textContent))(document.querySelector('.message-menu-list'))`), 'the menu opens'),
      ['Star for me', 'Fold', 'Copy Link', 'Mark unread', 'Move its stack up⌘↑', 'Move its stack down⌘↓', 'Fold its stack←', 'Open its stack→',
        'Join the stack above⇧⌘↑', 'Join the stack below⇧⌘↓', 'Undo⌘Z']);
    await p.key('Escape'); await until(() => quiet(p, `!document.querySelector('.message-menu-list')`), 'Escape closes it');
    // A stack whose top message is the New item and no reply under it is New: the person adds to their own question, and the coordinator answers only that.
    const screen = await post('conversation-stack-screen', 'Can we add a second screen?');
    const sideRoom = await post('conversation-stack-side-room', 'For the side room, I mean.', { reply_to: screen });
    const sideAnswer = await answer('conversation-stack-side-answer', 'The side room has one already.', { reply_to: sideRoom });
    // Its stack: the head, each reply and whether it shows, and the stack's line.
    const topStack = () => quiet(p, `(s=>s&&{head:s.querySelector(':scope > [data-id]')?.dataset.id??null,
      replies:[...s.querySelectorAll(':scope > .stack-replies > [data-id]')].map(e=>[e.dataset.id,e.getClientRects().length>0]),
      lines:[...s.querySelectorAll(':scope > .stack-replies > .stack-fold-line')].filter(t=>t.getClientRects().length).map(t=>t.textContent)})(document.querySelector(${JSON.stringify(card(sideRoom))})?.closest('.reply-stack'))`);
    await settles(async () => [(await tags(p, screen))?.tags, (await tags(p, sideRoom))?.tags, (await topStack())?.head], [['New'], ['Answered'], screen],
      'the New question heads its stack, and the reply under it is answered');
    // A stack holding more than one New card: the person adds to their own question before anyone answers (a New message on top
    // and a New reply), and asks two more things under an answer (two New replies under a settled message). Then two items alone.
    const badges = await post('conversation-stack-badges', 'Can we get name badges?');
    const lanyards = await post('conversation-stack-lanyards', 'And lanyards, if there is time.', { reply_to: badges });
    const parking = await post('conversation-stack-parking', 'Is parking free?');
    const parked = await answer('conversation-stack-parked', 'Yes, for the day.', { reply_to: parking });
    const cloakroom = await post('conversation-stack-cloakroom', 'Is there a cloakroom?', { reply_to: parked });
    const quietRoom = await post('conversation-stack-quiet-room', 'And a quiet room?', { reply_to: parked });
    const flowers = await post('conversation-stack-flowers', 'Who brings the flowers?');
    const menus = await post('conversation-stack-menus', 'Who prints the menus?');
    await settles(async () => Promise.all([badges, lanyards, parking, cloakroom, quietRoom, flowers, menus].map(async id => (await tags(p, id))?.tags)),
      [['New'], ['New'], ['Answered'], ['New'], ['New'], ['New'], ['New']], 'the badges and their lanyards are New, the parking answered and the two asks under it New');
    // Only new shows each New item alone: a stacked one without the settled message it hangs under, nor the other replies or their line, and with no indent;
    // a New one on top of its stack without the settled replies under it.
    const pressOnlyNew = async () => { await p.evaluate(`document.querySelector('#conversation-show').scrollIntoView({block:'center'})`); await p.point('#conversation-show button'); };
    await pressOnlyNew();
    await until(async () => (await chip(p)).pressed === 'true', 'Only new is pressed');
    const filtered = await stack(p);
    assert.deepEqual([(await tags(p, item)).shown, filtered.replies, filtered.lines],
      [false, [[answered, false], [followUp, true], [ask, false], [noted, false], [late, false]], []], 'only the stacked New item shows');
    const onTop = await topStack();
    assert.deepEqual([(await tags(p, screen)).shown, onTop.replies, onTop.lines], [true, [[sideRoom, false], [sideAnswer, false]], []],
      'the New item on top of its stack shows, and the settled replies under it do not');
    const indent = id => p.evaluate(`Math.round(document.querySelector(${JSON.stringify(card(id))}).getBoundingClientRect().left-document.querySelector('#messages').getBoundingClientRect().left)`);
    assert.deepEqual([await indent(followUp), await indent(screen)], [0, 0], 'in line with the other new cards');
    // Two New cards of one stack, one after the other, sit apart as two cards standing alone do: a New message on top and its New reply, and two New replies.
    assert.deepEqual((await onlyNewLayout(p, '1280 light')).slice(0, 6), [menus, flowers, cloakroom, quietRoom, badges, lanyards],
      'the items alone, then the two New replies oldest first, then the New message and its New reply');
    await shot(p, 'conversation-stack-only-new');
    await pressOnlyNew();
    await until(async () => (await tags(p, item))?.shown, 'everything shows again');
    assert.deepEqual([(await tags(p, cloakroom)).shown, (await tags(p, quietRoom)).shown], [true, true],
      'leaving Only new preserves my replies that arrived while this page was open, as item 357 requires');
    // Only new changes a filter, not the stack's reading state. Choosing the
    // state afresh releases the held replies and restores latest plus unread.
    const parkingToggle = `#messages .reply-stack[data-stack="${parking}"] > .stack-toggle`;
    for (const level of ['open', 'head', 'folded']) {
      await p.evaluate(`document.querySelector(${JSON.stringify(parkingToggle)}).scrollIntoView({block:'center'})`);
      await p.point(parkingToggle);
      await until(() => quiet(p, `document.querySelector(${JSON.stringify(parkingToggle)}).parentElement.dataset.fold===${JSON.stringify(level)}`), 'choose the stack state: ' + level);
    }
    assert.deepEqual([(await tags(p, cloakroom)).shown, (await tags(p, quietRoom)).shown], [false, true],
      'an explicit stack-state choice releases my earlier read reply; the latest remains');
    // Answered while the page is open, the stacked item's tag turns in place, and the answer joins its stack.
    const caterer = await answer('conversation-stack-caterer', 'The caterer is booked.', { reply_to: followUp });
    await until(async () => (await tags(p, followUp))?.tags[0] === 'Answered', 'the stacked item turns Answered without a reload');
    assert.deepEqual((await until(async () => { const s = await stack(p); return s?.replies.at(-1)[0] === caterer && s; }, 'the answer joins the stack')).replies.at(-1),
      [caterer, true], 'the answer is the stack\'s newest reply, in view');
    // A fresh own reply is held beside its answer, then released by a real
    // tab return while the dossier is off screen, as on ordinary topic pages.
    const held = await post('conversation-stack-held-return', 'Can I leave my coat there?', { reply_to: quietRoom });
    const newest = await answer('conversation-stack-held-answer', 'Yes, coats can stay there.', { reply_to: held });
    await settles(async () => [(await tags(p, held))?.shown, (await tags(p, newest))?.shown], [true, true],
      'my newly sent reply stays beside its answer before leaving the page');
    const elsewhere = await open('conversation-stack-away', '/?conversation=w1', desk('light'));
    await until(() => p.evaluate("document.visibilityState==='hidden'"), 'another tab hides the conversation');
    await p.evaluate('scrollTo(0,document.documentElement.scrollHeight)');
    assert.equal(await p.evaluate(`(()=>{const b=document.querySelector(${JSON.stringify(card(held))}).closest('.reply-stack').getBoundingClientRect();return b.bottom<=0||b.top>=innerHeight})()`), true,
      'the held reply\'s dossier is off screen');
    await p.send('Page.bringToFront');
    await until(() => p.evaluate("document.visibilityState==='visible'"), 'the conversation is shown again');
    await settles(async () => [(await tags(p, held))?.shown, (await tags(p, newest))?.shown], [false, true],
      'returning with the dossier off screen releases my held reply and keeps the latest');
    assert.deepEqual(elsewhere.errors, []); await elsewhere.close();
    assert.deepEqual(p.errors, []); await p.close();
    const dark = await open('conversation-stacks-dark', '/?conversation=w1', desk('dark'));
    await until(async () => (await stack(dark))?.head === item && (await tags(dark, followUp))?.tags.length, 'dark: the stack and its tags');
    await shot(dark, 'conversation-stack-1280-dark');
    assert.deepEqual(dark.errors, []); await dark.close();
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
      // Only new on the phone: every card shown, a stack's New cards among them, lays out as one standing alone.
      await p.evaluate(`document.querySelector('#conversation-show').scrollIntoView({block:'center'})`);
      await p.point('#conversation-show button');
      await until(async () => (await chip(p)).pressed === 'true', theme + ': Only new is pressed');
      await onlyNewLayout(p, `390 ${theme}`);
      await shot(p, `conversation-phone-only-new-${theme}`);
      assert.deepEqual(p.errors, []); await p.close();
    }
    assert.notEqual(backgrounds[0], backgrounds[1], `the words follow the theme (${backgrounds})`);
  });
}

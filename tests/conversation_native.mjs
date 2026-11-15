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
const WAITING = 'Waiting for an answer';

export async function conversationChecks({ check, page, until, control, view, facts, replace, shot }) {
  const agent = facts.agent, other = 'fixture-planning-agent', person = facts.actor;
  const quiet = async (p, expression) => { try { return await p.evaluate(expression); } catch { return false; } };
  const open = (name, url, setup = {}) => page(name, null, true, { url: facts.origin + url, ...setup });
  const card = id => `#messages [data-id="${id}"]`;
  // What a card shows of its item: its tags in order, "Asks you", and whether it is shown. An item that waits for an
  // answer shows three dots in place of a word (item 389), read here by their name, WAITING.
  const tags = (p, id) => quiet(p, `(c=>c&&{tags:[...c.querySelectorAll('.item-tag,.item-waiting')].map(t=>t.classList.contains('item-waiting')?t.getAttribute('aria-label').split(' · ')[0]:t.textContent),
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
  const row = p => quiet(p, `(r=>r&&{current:r.getAttribute('aria-current'),waiting:r.closest('.ol-outcome')?.querySelector('.ol-waiting:not([hidden])')?'Waiting on you':null,
    unread:r.querySelector('.unread-count')?.textContent??null,shown:r.getClientRects().length>0})(document.querySelector('#outline .ol-name[data-conversation-of="w1"]'))`);
  // The row above the feed (item 382): where "N marked unread · Read it" and the chips sit, beside the list's edges.
  const filterRow = p => quiet(p, `(()=>{const box=e=>{if(!e||!e.getClientRects().length)return null;const b=e.getBoundingClientRect();return {left:Math.round(b.left),right:Math.round(b.right),mid:Math.round((b.top+b.bottom)/2)}};
    const l=document.getElementById('messages').getBoundingClientRect();
    return {marks:box(document.getElementById('topic-marks')),chip:box(document.querySelector('#conversation-show button')),list:{left:Math.round(l.left),right:Math.round(l.right)}}})()`);
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
    await until(() => p.evaluate("document.getAnimations().filter(x=>x.effect?.getTiming().iterations!==Infinity).every(animation=>animation.playState!=='running')"), 'settled reader');
  };

  // The person's agent answers in w1's conversation, and a second agent is on the team.
  const conversation = await control({ method: 'coordinator', operation_id: 'conversation-coordinator', coordinator: agent, team: [other] });
  assert.equal(conversation.coordinator.actor_id, agent);

  // The three dots on a card whose item waits (item 389): how many, their name, each one's animation and its delay, how
  // many are running, their size, and the ink of the first beside the card's own.
  const dots = (p, id) => quiet(p, `(w=>w&&{count:w.children.length,role:w.getAttribute('role'),label:w.getAttribute('aria-label'),title:w.title,
    names:[...w.children].map(s=>getComputedStyle(s).animationName),delays:[...w.children].map(s=>getComputedStyle(s).animationDelay),
    running:w.getAnimations({subtree:true}).filter(a=>a.playState==='running').length,shown:w.getClientRects().length>0,
    size:[Math.round(w.getBoundingClientRect().width),Math.round(w.getBoundingClientRect().height)],
    ink:getComputedStyle(w.firstElementChild).backgroundColor===getComputedStyle(w).color&&getComputedStyle(w).color===getComputedStyle(w.closest('.message-card')).color})(document.querySelector(${JSON.stringify(card(id) + ' .item-waiting')}))`);
  const chips = (p, id) => quiet(p, `[...document.querySelector(${JSON.stringify(card(id))}).querySelectorAll('.item-tag')].map(t=>t.textContent)`);

  await check('conversation the page is a topic page, messages above the writing box, and a card arrives waiting for an answer, three quiet dots pulsing in turn, and turns Answered live, the dots gone', async () => {
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
    assert.deepEqual(fresh.tags, [WAITING]);
    // In place of a word chip, three quiet dots in the card's own ink, pulsing in turn, named for a screen reader and the pointer.
    const waiting = await until(async () => { const d = await dots(p, item); return d?.running === 3 && d; }, 'the three dots pulse');
    assert.deepEqual([waiting.count, waiting.role, waiting.label, waiting.title, waiting.shown], [3, 'img', WAITING, WAITING, true], 'three dots, named and titled "Waiting for an answer"');
    assert.deepEqual([waiting.names, waiting.delays], [['item-waiting', 'item-waiting', 'item-waiting'], ['0s', '0.25s', '0.5s']], 'each pulses, one after another');
    assert.equal(waiting.ink, true, 'in the card\'s own ink');
    assert.ok(waiting.size[0] <= 40 && waiting.size[1] <= 24, `small: ${waiting.size}`);
    assert.deepEqual(await chips(p, item), [], 'and no word chip says New');
    await shot(p, 'conversation-waiting-dots');
    // Under reduced motion they stay still, and still show.
    await p.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
    const calm = await until(async () => { const d = await dots(p, item); return d?.running === 0 && d; }, 'under reduced motion the dots stop');
    assert.deepEqual([calm.count, calm.shown, calm.names], [3, true, ['none', 'none', 'none']], 'still three, shown, and still');
    await p.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: '' }] });
    assert.equal(await p.evaluate(`document.querySelector('#conversation-empty').hidden`), true);
    assert.deepEqual(await until(async () => { const c = await chip(p); return !c.hidden && c; }, 'Only new shows'), { hidden: false, text: 'Only new (1)', pressed: 'false' });
    const placed = await p.evaluate(`(()=>{const m=document.querySelector('#messages').getBoundingClientRect(),w=document.querySelector('#inline-composer').getBoundingClientRect();return {messages:m.bottom,writing:w.top}})()`);
    assert.ok(placed.messages <= placed.writing + 1, `the messages sit above the writing box (${JSON.stringify(placed)})`);
    await answer('conversation-answer', 'On track for Friday.', { reply_to: item });
    const answered = await until(async () => { const t = await tags(p, item); return t?.tags[0] === 'Answered' && t; }, 'the card turns Answered without a reload');
    assert.deepEqual(answered.tags, ['Answered']);
    assert.equal(await dots(p, item), null, 'answered, the dots go');
    assert.match(answered.detail[0], new RegExp(`^${agent}'s reply · `));
    assert.equal((await until(async () => { const c = await chip(p); return c.hidden && c; }, 'nothing new: the chip goes')).hidden, true);
    await shot(p, 'conversation-answered');
    assert.deepEqual(p.errors, []); await p.close();
  });

  await check('conversation an item taken into a topic waits no more: its three dots go, and it says Taken into a topic', async () => {
    const p = await open('conversation-taken', '/?conversation=w1');
    const item = await post('conversation-taken-item', 'Could someone look into the badges?');
    await until(async () => (await dots(p, item))?.count === 3, 'the item waits, with its three dots');
    await control({ method: 'source_start', operation_id: 'conversation-taken-start', message_id: item, title: 'Badges', body: 'Looking into the badges.' });
    const taken = await until(async () => { const t = await tags(p, item); return t?.tags[0] === 'Taken into a topic' && t; }, 'the card says it was taken, without a reload');
    assert.deepEqual(taken.tags, ['Taken into a topic']);
    assert.equal(await dots(p, item), null, 'taken, the dots go');
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
    // A 👍 given folds the ask for the reader (item 377, docs/reply-stacks.md): then its one-line row lights the same way.
    const thumb = async on => {
      const card = `#messages .message-card[data-id="${ask}"]`;
      const folded = await quiet(p, `document.querySelector(${JSON.stringify(card)})?.dataset.folded === 'true'`);
      const words = folded ? `${card} > .message-folded > .folded-author` : `${card} > .message-preview`;
      await p.evaluate(`document.querySelector(${JSON.stringify(words)}).scrollIntoView({block:'center'})`);
      await p.point(words, 'move');
      await until(() => quiet(p, `(b=>Boolean(b&&!b.hidden&&b.querySelector('[data-act=thumb]')))(document.querySelector('.message-bar'))`), 'the ask lights, with its bar');
      await p.point('.message-bar [data-act=thumb]');
      await until(async () => (await view('reactions', { message_id: ask })).reactions.thumbs.some(t => t.actor_id === person && t.answered === true) === on,
        `Core holds the 👍 ${on ? 'as a yes' : 'taken back'}`);
    };
    await thumb(true);
    assert.deepEqual(await waits(), [], 'Core: the 👍 answered the ask, and the waits agents read say so');
    await until(() => quiet(p, `document.querySelector('#messages .message-card[data-id="${ask}"]')?.dataset.folded === 'true'`), 'the 👍 folds the ask to its row for the reader');
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
    assert.deepEqual([seen[0].mine, seen[1].tags, seen[1].shown, seen[2].asks, seen[2].shown], [['Waiting on you'], [WAITING], true, 'Asks you', true],
      'the stacked New item shows its tag, the stacked ask its "Asks you", and its item waits on you');
    await shot(p, 'conversation-stack-1280-light');
    // Every commit paints each card's tags again; one that changes nothing on a card leaves its links, so a press on one lands.
    await p.evaluate(`(window.tagLink=document.querySelector(${JSON.stringify(card(item) + ' .item-tags .item-link')}),true)`);
    const another = await post('conversation-stack-another', 'Another question.');
    await until(async () => (await tags(p, another))?.tags[0] === WAITING, 'a new item lands, and the page paints every card\'s tags');
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
    // Its stack is fully open, so of its two states the menu offers the other one, Fold (item 394).
    await focusOn(ask);
    await until(async () => await litId() === ask && await quiet(p, `!document.querySelector('.message-bar').hidden`), 'the stacked ask is lit, with its bar');
    await p.point('.message-bar [data-act=more]');
    assert.deepEqual(await until(() => quiet(p, `(l=>l&&[...l.querySelectorAll('button')].map(b=>b.textContent))(document.querySelector('.message-menu-list'))`), 'the menu opens'),
      ['Star for me', 'Fold', 'Copy Link', 'Mark unread', 'Move below More', 'Move its stack up⌘↑', 'Move its stack down⌘↓', 'Fold its stack←',
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
    await settles(async () => [(await tags(p, screen))?.tags, (await tags(p, sideRoom))?.tags, (await topStack())?.head], [[WAITING], ['Answered'], screen],
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
      [[WAITING], [WAITING], ['Answered'], [WAITING], [WAITING], [WAITING], [WAITING]], 'the badges and their lanyards are New, the parking answered and the two asks under it New');
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
    for (const level of ['open', 'folded']) {
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
    const reply = await answer('conversation-settled-answer', 'Yes, since Monday.', { reply_to: settled });
    await until(async () => (await tags(p, settled))?.tags[0] === 'Answered', 'the settled card');
    const fresh = await post('conversation-only-new', 'One more thing: the press kit.');
    await until(async () => (await tags(p, fresh))?.tags[0] === WAITING, 'the new card');
    const count = (await view('conversation', { workspace_id: 'w1' })).conversation.new_items;
    assert.deepEqual(await until(async () => { const c = await chip(p); return c.text === `Only new (${count})` && c; }, 'the count'), { hidden: false, text: `Only new (${count})`, pressed: 'false' });
    await p.point('#conversation-show button');
    await until(async () => (await chip(p)).pressed === 'true', 'pressed');
    assert.deepEqual([(await tags(p, fresh)).shown, (await tags(p, settled)).shown], [true, false], 'only the new cards show');
    await shot(p, 'conversation-only-new');
    await p.point('#conversation-show button');
    await until(async () => (await tags(p, settled))?.shown, 'everything shows again');
    assert.deepEqual(p.errors, []); await p.close();
    // The view filters sit on one row (item 382): "1 message marked unread · Read it" at its left, Only new at its right.
    // The page counts what is marked unread as it opens, so it opens again once a message is marked.
    // The coordinator's answer, marked unread as another device would (the reader's own message is never unread to them).
    await control({ method: 'mark', operation_id: 'conversation-filters-mark', message_ids: [reply], marked: true });
    const q = await open('conversation-address-marked', '/?conversation=w1');
    const row = await until(async () => { const r = await filterRow(q); return r?.marks && r?.chip && r; }, 'Read it and Only new show');
    assert.ok(Math.abs(row.marks.mid - row.chip.mid) <= 4, `Read it and Only new sit on one row: ${JSON.stringify(row)}`);
    assert.ok(row.marks.left - row.list.left <= 2 && row.list.right - row.chip.right <= 2, `Read it at the row's left, Only new at its right: ${JSON.stringify(row)}`);
    assert.deepEqual(q.errors, []); await q.close();
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
      const fit = await p.evaluate(`(()=>{const v=innerWidth,out=[...document.querySelectorAll('#messages .item-tag-group,#messages .item-tag,#messages .item-waiting,#conversation-show button,#topic-marks')]
        .filter(e=>e.getClientRects().length).filter(e=>{const r=e.getBoundingClientRect();return r.left<-1||r.right>v+1}).map(e=>e.className);
        return {scroll:document.scrollingElement.scrollWidth,width:v,out,ink:getComputedStyle(document.body).color}})()`);
      assert.ok(fit.scroll <= fit.width, `${theme}: no sideways scroll (${fit.scroll} of ${fit.width})`);
      assert.deepEqual(fit.out, [], `${theme}: every tag inside the screen`);
      backgrounds.push(fit.ink);
      assert.ok(await p.evaluate(`[...document.querySelectorAll('#messages .item-waiting')].some(w=>w.getClientRects().length>0&&w.children.length===3)`), `${theme}: an item waiting shows its three dots`);
      const row = await until(async () => { const r = await filterRow(p); return r?.marks && r?.chip && r; }, theme + ': Read it and Only new show');
      // Side by side while the row holds both; where it cannot, Only new wraps just under, still at the right.
      const fits = (row.marks.right - row.marks.left) + (row.chip.right - row.chip.left) + 8 <= row.list.right - row.list.left;
      if (fits) assert.ok(Math.abs(row.marks.mid - row.chip.mid) <= 4, `${theme}: at a phone's width, Read it and Only new sit on one row: ${JSON.stringify(row)}`);
      else assert.ok(row.chip.mid > row.marks.mid + 10 && row.chip.mid - row.marks.mid <= 60 && Math.abs(row.list.right - row.chip.right) <= 2,
        `${theme}: at a phone's width the row cannot hold both, so Only new wraps just under it, at the right: ${JSON.stringify(row)}`);
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

  // Only new is its own view (reply-stacks.mjs, shownView): every New item shows, one put below More among them, so the
  // keys and the Reader's ↓ reach it, and neither ever lands on a settled message Only new hides. Item 355; this case
  // began as an independent review's.
  await check('conversation Only new: the keys and the Reader\'s ↓ reach a New item put below More, and never a settled one it hides', async () => {
    const DESK = { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false };
    const p = await open('conversation-only-new-aside', '/?conversation=w1', { beforeNavigate: async q => q.send('Emulation.setDeviceMetricsOverride', DESK) });
    const a = await post('conversation-aside-a', 'Aside check: the first question.');
    const b = await post('conversation-aside-b', 'Aside check: the question put aside.');
    const c = await post('conversation-aside-c', 'Aside check: the last question.');
    for (const id of [a, b, c]) await until(async () => (await tags(p, id))?.tags[0] === WAITING, 'the new card ' + id);
    const litId = () => quiet(p, `document.querySelector('#messages .lit[data-id]')?.dataset.id??null`);
    const focusOn = async id => {
      await p.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 4, y: DESK.height - 4 });
      await p.evaluate(`(document.activeElement?.blur(),document.querySelector(${JSON.stringify(card(id))}).scrollIntoView({block:'center'}),document.querySelector(${JSON.stringify(card(id))}).focus(),true)`);
      await until(async () => await litId() === id, `${id} lights`);
    };
    await focusOn(b);
    await p.point('.message-bar [data-act=more]');
    await until(() => quiet(p, `Boolean(document.querySelector('.message-menu-list'))`), 'the menu opens');
    await p.evaluate(`[...document.querySelectorAll('.message-menu-list button')].find(e=>e.textContent==='Move below More').click()`);
    await until(async () => (await view('stack_positions', { topic_id: conversation.topic_id, message_ids: [b] })).items[0].stack_position.below, 'Core holds b below More');
    await until(async () => !(await tags(p, b))?.shown, 'b goes below a closed More');
    await p.evaluate(`document.querySelector('#conversation-show').scrollIntoView({block:'center'})`);
    await p.point('#conversation-show button');
    await until(async () => (await chip(p)).pressed === 'true', 'Only new is pressed');
    await until(async () => (await tags(p, b))?.shown, 'Only new shows b, put aside');
    // What Only new draws, top to bottom: the cards laid out.
    const drawn = await p.evaluate(`[...document.querySelectorAll('#messages [data-id]')].filter(e=>e.getClientRects().length&&e.matches('[data-item]')).map(e=>e.dataset.id)`);
    // ↓ from a, key by key: every card lit is one Only new draws, and b is reached.
    await focusOn(a);
    const keyed = [a];
    for (let n = 0; n < 60 && keyed.at(-1) !== b; n++) {
      await p.key('ArrowDown');
      const before = keyed.at(-1);
      const now = await until(async () => { const id = await litId(); return id && id !== before && id; }, '↓ moves the light').catch(() => before);
      if (now === before) break;
      keyed.push(now);
    }
    assert.deepEqual(keyed.filter(id => !drawn.includes(id)), [], 'every card ↓ lights is one Only new draws');
    assert.equal(keyed.at(-1), b, `keys: ↓ from a reaches b, put aside and shown (lit ${JSON.stringify(keyed)})`);
    // The Reader from a, ↓ by ↓: every message it opens is one Only new draws, and it reaches b.
    await p.evaluate(`document.querySelector(${JSON.stringify(card(a))}).scrollIntoView({block:'center'})`);
    await p.point(card(a));
    await until(() => quiet(p, `document.querySelector('#reader').open && document.querySelector('#source-body').textContent.includes('the first question')`), 'the Reader shows a');
    const opened = [];
    for (let n = 0; n < 60; n++) {
      if (await quiet(p, `document.querySelector('#source-body').textContent.includes('put aside')`)) break;
      await until(() => quiet(p, `!document.querySelector('#previous-message').disabled`), `the Reader offers ↓ (opened ${opened.length})`);
      const was = await p.evaluate(`document.querySelector('#source-body').textContent`);
      await p.point('#previous-message');
      await until(() => quiet(p, `document.querySelector('#source-body').textContent !== ${JSON.stringify(was)}`), 'the Reader moved');
      opened.push(await p.evaluate(`document.querySelector('#source-body').textContent.slice(0, 60)`));
    }
    assert.ok(await quiet(p, `document.querySelector('#source-body').textContent.includes('put aside')`), `the Reader's ↓ from a reaches b (${JSON.stringify(opened)})`);
    const settledOpened = [];
    for (const words of opened) if (!(await p.evaluate(`[...document.querySelectorAll('#messages [data-id]')].some(e=>e.getClientRects().length&&e.textContent.includes(${JSON.stringify(words.slice(0, 40))}))`))) settledOpened.push(words);
    assert.deepEqual(settledOpened, [], 'the Reader opened only messages Only new draws');
    await p.point('#reader-close'); await until(() => p.evaluate('!document.querySelector("#reader").open'), 'closed reader');
    assert.deepEqual(p.errors, []); await p.close();
  });

  // A New item heading a dossier put below a closed More: Only new draws it, and the Reader's ↓ steps to it.
  // A message Only new leaves out is never opened on the way (the case above checks that). Item 355; this case and the
  // next began as an independent review's.
  const readerReaches = async (p, from, words) => {
    await p.evaluate(`document.querySelector(${JSON.stringify(card(from))}).scrollIntoView({block:'center'})`);
    await p.point(card(from));
    await until(() => quiet(p, `document.querySelector('#reader').open && document.querySelector('#source-body').textContent.includes('the first question')`), 'the Reader shows a');
    const opened = [];
    for (let n = 0; n < 60 && !(await quiet(p, `document.querySelector('#source-body').textContent.includes(${JSON.stringify(words)})`)); n++) {
      await until(() => quiet(p, `!document.querySelector('#previous-message').disabled`), `the Reader offers ↓ (opened ${JSON.stringify(opened)})`);
      const was = await p.evaluate(`document.querySelector('#source-body').textContent`);
      await p.point('#previous-message');
      await until(() => quiet(p, `document.querySelector('#source-body').textContent !== ${JSON.stringify(was)}`), 'the Reader moved');
      opened.push(await p.evaluate(`document.querySelector('#source-body').textContent.slice(0, 50)`));
    }
    await p.point('#reader-close'); await until(() => p.evaluate('!document.querySelector("#reader").open'), 'closed reader');
    return opened;
  };
  await check('conversation Only new: a New item heading a dossier put below a closed More is drawn, and the Reader steps to it', async () => {
    const DESK = { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false };
    const p = await open('rv-only-new-dossier', '/?conversation=w1', { beforeNavigate: async q => q.send('Emulation.setDeviceMetricsOverride', DESK) });
    const a = await post('rv-dossier-a', 'Dossier check: the first question.');
    const b = await post('rv-dossier-b', 'Dossier check: the head put aside.');
    const b2 = await post('rv-dossier-b2', 'Dossier check: a reply under the head.', { reply_to: b });
    const c = await post('rv-dossier-c', 'Dossier check: the last question.');
    for (const id of [a, b, b2, c]) await until(async () => (await tags(p, id))?.tags[0] === WAITING, 'the new card ' + id);
    await until(() => quiet(p, `Boolean(document.querySelector(${JSON.stringify(card(b))})?.closest('.reply-stack'))`), 'b heads a dossier');
    await control({ method: 'stack_act', sender: person, kind: 'stack.aside', message_id: b, operation_id: 'rv-dossier-aside', args: { through: (await view('topic_messages', { topic_id: conversation.topic_id, audience: 'all', direction: 'before', limit: 1 })).items[0].seq } });
    await until(async () => (await view('stack_positions', { topic_id: conversation.topic_id, message_ids: [b] })).items[0].stack_position.below, 'Core holds b below More');
    await until(async () => !(await tags(p, b))?.shown, 'b goes below a closed More');
    await p.evaluate(`document.querySelector('#conversation-show').scrollIntoView({block:'center'})`);
    await p.point('#conversation-show button');
    await until(async () => (await chip(p)).pressed === 'true', 'Only new is pressed');
    await until(() => quiet(p, `document.querySelector('#messages').classList.contains('only-new')`), 'the list is Only new');
    await until(async () => (await tags(p, c))?.shown && (await tags(p, a))?.shown, 'a and c draw');
    assert.deepEqual([Boolean((await tags(p, b))?.shown), Boolean((await tags(p, b2))?.shown)], [true, true],
      'Only new draws every New item, the dossier put below More included');
    const opened = await readerReaches(p, a, 'head put aside');
    assert.ok(opened.at(-1)?.includes('head put aside'), `the Reader's ↓ from a reaches b (${JSON.stringify(opened)})`);
    await p.point('#conversation-show button');
    await until(async () => (await chip(p)).pressed !== 'true', 'Only new is off again');
    assert.deepEqual(p.errors, []); await p.close();
  });

  // An act redraws the stacks without repainting the Conversation page: a New item put below a closed More stays drawn.
  await check('conversation Only new: after an act arrives, a New item put below a closed More stays drawn, and the Reader steps to it', async () => {
    const DESK = { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false };
    const p = await open('rv-only-new-act', '/?conversation=w1', { beforeNavigate: async q => q.send('Emulation.setDeviceMetricsOverride', DESK) });
    const a = await post('rv-act-a', 'Act check: the first question.');
    const b = await post('rv-act-b', 'Act check: the single one put aside.');
    const c = await post('rv-act-c', 'Act check: the last question.');
    for (const id of [a, b, c]) await until(async () => (await tags(p, id))?.tags[0] === WAITING, 'the new card ' + id);
    await control({ method: 'stack_act', sender: person, kind: 'stack.aside', message_id: b, operation_id: 'rv-act-aside', args: { through: (await view('topic_messages', { topic_id: conversation.topic_id, audience: 'all', direction: 'before', limit: 1 })).items[0].seq } });
    await until(async () => (await view('stack_positions', { topic_id: conversation.topic_id, message_ids: [b] })).items[0].stack_position.below, 'Core holds b below More');
    await until(async () => !(await tags(p, b))?.shown, 'b goes below a closed More');
    await p.evaluate(`document.querySelector('#conversation-show').scrollIntoView({block:'center'})`);
    await p.point('#conversation-show button');
    await until(async () => (await chip(p)).pressed === 'true', 'Only new is pressed');
    await until(async () => (await tags(p, b))?.shown, 'Only new shows b, put aside');
    await control({ method: 'stack_act', sender: person, kind: 'message.star', message_id: c, operation_id: 'rv-act-star', args: { starred: true } });
    await until(() => quiet(p, `[...document.querySelectorAll(${JSON.stringify(`${card(c)}, ${card(c)} .message-card`)})].some(e => e.dataset.starred === 'true')`), 'the star reaches the page');
    assert.equal(Boolean((await tags(p, b))?.shown), true, 'after the star, Only new still draws b, put aside');
    const opened = await readerReaches(p, a, 'single one put aside');
    assert.ok(opened.at(-1)?.includes('single one put aside'), `after the star, the Reader's ↓ from a reaches b (${JSON.stringify(opened)})`);
    await p.point('#conversation-show button');
    await until(async () => (await chip(p)).pressed !== 'true', 'Only new is off again');
    assert.deepEqual(p.errors, []); await p.close();
  });

  // A New reply in a closed dossier is a folded row; Only new draws it, before and after an act redraws the stacks.
  await check('conversation Only new: a New reply folded in a closed dossier is drawn, and stays drawn after an act', async () => {
    const DESK = { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false };
    const p = await open('only-new-folded', '/?conversation=w1', { beforeNavigate: async q => q.send('Emulation.setDeviceMetricsOverride', DESK) });
    const root = await post('only-new-folded-root', 'Folded check: the question.');
    const reply = await post('only-new-folded-reply', 'Folded check: the reply inside.', { reply_to: root });
    const later = await post('only-new-folded-later', 'Folded check: the latest reply.', { reply_to: root });
    for (const id of [root, reply, later]) await until(async () => (await tags(p, id))?.tags[0] === WAITING, 'the new card ' + id);
    // A person's dossier steps between two levels (item 394): latest plus unread ('folded') and every message ('open').
    // The reply is the reader's own, so read, and not the latest: the person opens the dossier, then closes it, and
    // closed it folds the reply away.
    const toggle = `.reply-stack[data-stack="${root}"] > .stack-toggle`;
    const fold = () => quiet(p, `document.querySelector('.reply-stack[data-stack="${root}"]')?.dataset.fold ?? null`);
    const step = async to => {
      for (let n = 0; n < 2 && await fold() !== to; n++) {
        const was = await fold();
        await p.evaluate(`document.querySelector(${JSON.stringify(toggle)}).scrollIntoView({block:'center'})`);
        await p.point(toggle);
        await until(async () => await fold() !== was, 'the dossier changes level');
      }
    };
    await step('open');
    assert.equal(await fold(), 'open', 'the dossier is open');
    await until(async () => (await tags(p, reply))?.shown, 'open, the dossier shows the reply');
    await step('folded');
    assert.equal(await fold(), 'folded', 'the dossier is closed');
    await until(async () => !(await tags(p, reply))?.shown, 'the reply is folded away');
    assert.equal(Boolean((await tags(p, later))?.shown), true, 'closed, the dossier still shows its latest reply');
    await p.evaluate(`document.querySelector('#conversation-show').scrollIntoView({block:'center'})`);
    await p.point('#conversation-show button');
    await until(async () => (await chip(p)).pressed === 'true', 'Only new is pressed');
    await until(async () => (await tags(p, reply))?.shown, 'Only new draws the folded New reply');
    await control({ method: 'stack_act', sender: person, kind: 'message.star', message_id: root, operation_id: 'only-new-folded-star', args: { starred: true } });
    await until(() => quiet(p, `[...document.querySelectorAll(${JSON.stringify(`${card(root)}, ${card(root)} .message-card`)})].some(e => e.dataset.starred === 'true')`), 'the star reaches the page');
    assert.equal(Boolean((await tags(p, reply))?.shown), true, 'after the star, Only new still draws the folded New reply');
    await p.point('#conversation-show button');
    await until(async () => (await chip(p)).pressed !== 'true', 'Only new is off again');
    await until(async () => !(await tags(p, reply))?.shown, 'with Only new off, the closed dossier folds the reply away again');
    assert.deepEqual(p.errors, []); await p.close();
  });

  // Each case below works in a conversation of its own, so what earlier checks left in w1
  // (unread answers, New items) does not decide where the New line goes or whether older messages remain.
  const ownConversation = async id => {
    await control({ method: 'navigation_workspaces', workspaces: [{ id, title: 'Review ' + id, team: [agent, other], coordinator: agent }] });
    return (await view('conversation', { workspace_id: id })).conversation.topic_id;
  };
  const say = async (topicId, operation, body, args = {}) => (await control({ method: 'agent_message', operation_id: operation, topic_id: topicId,
    whole_topic: !args.reply_to, sender: other, body, ...args })).result.message_id;
  const toggleOnlyNew = async (p, on) => {
    await p.evaluate(`document.querySelector('#conversation-show').scrollIntoView({block:'center'})`);
    await p.point('#conversation-show button');
    await until(async () => ((await chip(p)).pressed === 'true') === on, on ? 'Only new is pressed' : 'Only new is off');
  };

  // Item 476 under Only new: an open dossier of more than seven shows its earlier-messages row, saying how many of
  // them are new, until Only new is pressed; then the row goes and each New message among the earlier ones shows as
  // a card, as Only new shows every New item. Off again, the row is back as it was: closed, or opened to its rows.
  // At a laptop's width and 390, 375 and 320 on a phone.
  await check('conversation Only new: an open dossier\'s earlier-messages row, closed or opened to its rows, gives way to the New messages among them and comes back when Only new is off', async () => {
    const DESK = { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false };
    const topicId = await ownConversation('rv476');
    // The person's own: each an item still waiting, so New, the replies included.
    const mine = async (operation, body, args = {}) => (await control({ method: 'agent_message', operation_id: operation, topic_id: topicId,
      whole_topic: !args.reply_to, sender: 'person', body, ...args })).result.message_id;
    const ids = [await mine('rv476-root', 'Earlier check: the plan.')];
    for (let n = 1; n <= 8; n++) ids.push(await mine(`rv476-${n}`, `Earlier check: reply ${n}.`, { reply_to: ids[0] }));
    // A person's reply folds the message it answers for them (Core); unfolded again, the first message shows as any does.
    await control({ method: 'stack_act', sender: person, kind: 'message.fold', message_id: ids[0], operation_id: 'rv476-unfold', args: { folded: false } });
    const p = await open('rv476', '/?conversation=rv476', { beforeNavigate: async q => q.send('Emulation.setDeviceMetricsOverride', DESK) });
    const toggle = `.reply-stack[data-stack="${ids[0]}"] > .stack-toggle`;
    const fold = () => quiet(p, `document.querySelector('.reply-stack[data-stack="${ids[0]}"]')?.dataset.fold ?? null`);
    await until(async () => await fold() !== null, 'the dossier is drawn');
    for (let n = 0; n < 2 && await fold() !== 'open'; n++) {
      const was = await fold();
      await p.evaluate(`document.querySelector(${JSON.stringify(toggle)}).scrollIntoView({block:'center'})`);
      await p.point(toggle);
      await until(async () => await fold() !== was, 'the dossier changes level');
    }
    assert.equal(await fold(), 'open', 'the dossier is open');
    // The row's words while it shows, and each of the nine: whether it shows, and as a row or a card.
    const seen = () => quiet(p, `(()=>{const s=document.querySelector('.reply-stack[data-stack="${ids[0]}"]'),b=s.querySelector('.stack-earlier'),shown=e=>e.getClientRects().length>0;
      return {row:b&&shown(b)?b.textContent:null,messages:${JSON.stringify(ids)}.map(id=>{const c=document.querySelector('#messages .message-card[data-id="'+id+'"]');
        return !c||!shown(c)?'hidden':shown(c.querySelector(':scope > .message-preview'))?'card':c.querySelector(':scope > .message-earlier')&&shown(c.querySelector(':scope > .message-earlier'))?'row':'tab'})}})()`);
    const widths = async (want, label) => {
      for (const [width, mobile] of [[1280, false], [390, true], [375, true], [320, true]]) {
        await p.send('Emulation.setDeviceMetricsOverride', { width, height: mobile ? 844 : 900, deviceScaleFactor: 1, mobile });
        // What the dossier's first message shows when it does not settle: its stack's state and each of its parts.
        const first = () => quiet(p, `(c=>c&&{stack:{...c.closest('.reply-stack').dataset},card:{...c.dataset},lit:c.classList.contains('lit'),
          parts:[...c.children].map(e=>e.className+':'+getComputedStyle(e).display)})(document.querySelector('#messages .message-card[data-id="${ids[0]}"]'))`);
        try { await until(async () => JSON.stringify(await seen()) === JSON.stringify(want), `${width}px: ${label}`); }
        catch (error) {
          const state = await quiet(p, `import('/reply-stacks.mjs').then(m=>{const s=m.stackState(document.getElementById('messages')),id=${JSON.stringify(ids[0])},st=s.stacks.find(x=>x.id===id);
            return JSON.stringify({level:s.levels.get(id),earlier:[...s.earlier],whole:[...s.whole],folded:[...s.folded],earlierRows:[...s.earlierRows],only:Boolean(s.only),head:st?.head?.id,replies:st?.replies.map(r=>r.id),acts:st?.head?.acts})})`);
          throw new Error(`${error.message}: ${JSON.stringify(await seen())}, its first message ${JSON.stringify(await first())}, the stack state ${state}`);
        }
        assert.equal(await p.evaluate('document.documentElement.scrollWidth > innerWidth'), false, `${width}px: ${label}: nothing scrolls sideways`);
      }
      await p.send('Emulation.setDeviceMetricsOverride', DESK);
    };
    const cards = Array(9).fill('card');
    await widths({ row: '2 earlier messages', messages: ['tab', 'hidden', ...cards.slice(2)] }, 'open, the row stands for the two earlier ones');
    await shot(p, 'conversation-earlier-row');
    await toggleOnlyNew(p, true);
    await widths({ row: null, messages: cards }, 'under Only new the row goes and the New ones among the earlier show as cards');
    await toggleOnlyNew(p, false);
    await widths({ row: '2 earlier messages', messages: ['tab', 'hidden', ...cards.slice(2)] }, 'Only new off, the row is back, closed');
    await p.evaluate(`document.querySelector('.reply-stack[data-stack="${ids[0]}"] .stack-earlier').scrollIntoView({block:'center'})`);
    await p.point(`.reply-stack[data-stack="${ids[0]}"] .stack-earlier`);
    await widths({ row: null, messages: ['row', 'row', ...cards.slice(2)] }, 'opened, the earlier ones are rows');
    await toggleOnlyNew(p, true);
    await widths({ row: null, messages: cards }, 'under Only new the rows show as cards');
    await shot(p, 'conversation-earlier-only-new');
    await toggleOnlyNew(p, false);
    await widths({ row: null, messages: ['row', 'row', ...cards.slice(2)] }, 'Only new off, the earlier ones are rows again');
    assert.deepEqual(p.errors, []); await p.close();
  });

  // shownView says a dossier put aside is on show under Only new; lineSeq reads it when placeLine runs (an act, a
  // message), and turning Only new off redraws the stacks without placing the line again.
  await check('conversation Only new: a line placed while Only new is on is not left below the closed More once it is off', async () => {
    const DESK = { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false };
    const topicId = await ownConversation('rv6line');
    const ids = {};
    ids.a = await say(topicId, 'rv6line-a', 'Line check: A, read.', { read: true });
    ids.b = await say(topicId, 'rv6line-b', 'Line check: B, the oldest new, put aside.');
    ids.c = await say(topicId, 'rv6line-c', 'Line check: C.');
    const names = Object.fromEntries(Object.entries(ids).map(([key, id]) => [id, key]));
    const lined = q => q.evaluate(`[...document.querySelector('#messages').children].filter(e=>e.getClientRects().length)
      .map(e=>e.dataset.line?'New':e.classList.contains('stack-more')?'More':(${JSON.stringify(names)})[e.dataset.id??e.dataset.stack]??null).filter(Boolean)`);
    const p = await open('rv6line', '/?conversation=rv6line', { beforeNavigate: async q => q.send('Emulation.setDeviceMetricsOverride', DESK) });
    await until(async () => JSON.stringify(await lined(p)) === JSON.stringify(['c', 'b', 'New', 'a']), `the line under B, the oldest new (${JSON.stringify(await lined(p))})`);
    await control({ method: 'stack_act', sender: person, kind: 'stack.aside', message_id: ids.b, operation_id: 'rv6line-aside', args: { through: (await view('topic_messages', { topic_id: topicId, audience: 'all', direction: 'before', limit: 1 })).items[0].seq } });
    await until(async () => (await view('stack_positions', { topic_id: topicId, message_ids: [ids.b] })).items[0].stack_position.below, 'Core holds B below More');
    await until(async () => JSON.stringify(await lined(p)) === JSON.stringify(['c', 'New', 'a', 'More']), `with B below More the line sits under C (${JSON.stringify(await lined(p))})`);
    await toggleOnlyNew(p, true);
    await control({ method: 'stack_act', sender: person, kind: 'message.star', message_id: ids.a, operation_id: 'rv6line-star', args: { starred: true } });
    await until(() => quiet(p, `[...document.querySelectorAll(${JSON.stringify(`${card(ids.a)}, ${card(ids.a)} .message-card`)})].some(e => e.dataset.starred === 'true')`), 'the star reaches the page');
    await toggleOnlyNew(p, false);
    await until(async () => !(await lined(p)).includes('b'), 'B is below the closed More again');
    assert.deepEqual(await lined(p), ['c', 'New', 'a', 'More'], 'with Only new off and More closed, the New line is not below More');
    assert.deepEqual(p.errors, []); await p.close();
  });

  // Only new draws a dossier put aside (shownView's asideShown) and hides More's button; More messages (Earlier
  // messages), which loads older messages, still follows More's own open state (paintMoreMessages).
  await check('conversation Only new: with a dossier put aside, older messages can still be loaded under Only new', async () => {
    const DESK = { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false };
    const topicId = await ownConversation('rv6older');
    const ids = [];
    for (let n = 0; n < 34; n++) ids.push(await say(topicId, `rv6older-${n}`, `Older check: message ${n}.`, { read: n === 33 }));
    const p = await open('rv6older', '/?conversation=rv6older', { beforeNavigate: async q => q.send('Emulation.setDeviceMetricsOverride', DESK) });
    await until(() => quiet(p, `Boolean(document.querySelector(${JSON.stringify(card(ids[33]))}))`), 'the newest is drawn');
    const more = () => quiet(p, `(m=>({hidden:m.hidden,shown:m.getClientRects().length>0,text:m.textContent}))(document.querySelector('#more-messages'))`);
    await until(async () => (await more()).shown, 'More messages loads older messages');
    await control({ method: 'stack_act', sender: person, kind: 'stack.aside', message_id: ids[32], operation_id: 'rv6older-aside', args: { through: (await view('topic_messages', { topic_id: topicId, audience: 'all', direction: 'before', limit: 1 })).items[0].seq } });
    await until(async () => (await view('stack_positions', { topic_id: topicId, message_ids: [ids[32]] })).items[0].stack_position.below, 'Core holds 32 below More');
    await until(async () => !(await tags(p, ids[32]))?.shown, '32 goes below a closed More');
    await toggleOnlyNew(p, true);
    await until(async () => (await tags(p, ids[32]))?.shown, 'Only new draws 32, put aside');
    const loader = await more();
    const moreButton = await quiet(p, `Boolean(document.querySelector('#messages .stack-more')?.getClientRects().length)`);
    assert.ok(loader.shown || moreButton, `under Only new, with 32 put aside and drawn, something loads older messages (#more-messages ${JSON.stringify(loader)}, More's button shown ${moreButton})`);
    await toggleOnlyNew(p, false);
    assert.deepEqual(p.errors, []); await p.close();
  });

  // Under Only new More is not drawn (aim.css hides everything but New items), so moving a New message below More
  // leaves focus on the message, which Only new still draws, rather than on a More nobody can see (stack-feed.mjs, setAside).
  await check('conversation Only new: moving a New message below More keeps focus on it, More being hidden', async () => {
    const DESK = { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false };
    const topicId = await ownConversation('r7focus');
    const ids = {};
    ids.a = await say(topicId, 'r7focus-a', 'Focus check: the first question.');
    ids.b = await say(topicId, 'r7focus-b', 'Focus check: the question put aside.');
    ids.c = await say(topicId, 'r7focus-c', 'Focus check: the last question.');
    const p = await open('r7focus', '/?conversation=r7focus', { beforeNavigate: async q => q.send('Emulation.setDeviceMetricsOverride', DESK) });
    for (const id of Object.values(ids)) await until(async () => (await tags(p, id))?.tags[0] === WAITING, 'the new card ' + id);
    await toggleOnlyNew(p, true);
    await p.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 4, y: DESK.height - 4 });
    await p.evaluate(`(document.activeElement?.blur(),document.querySelector(${JSON.stringify(card(ids.b))}).scrollIntoView({block:'center'}),document.querySelector(${JSON.stringify(card(ids.b))}).focus(),true)`);
    await until(() => quiet(p, `document.querySelector('#messages .lit[data-id]')?.dataset.id===${JSON.stringify(ids.b)}`), 'b lights');
    await p.point('.message-bar [data-act=more]');
    await until(() => quiet(p, `Boolean(document.querySelector('.message-menu-list'))`), 'the menu opens');
    await p.evaluate(`[...document.querySelectorAll('.message-menu-list button')].find(e=>e.textContent==='Move below More').click()`);
    await until(async () => (await view('stack_positions', { topic_id: topicId, message_ids: [ids.b] })).items[0].stack_position.below, 'Core holds b below More');
    await until(async () => (await tags(p, ids.b))?.shown, 'Only new still draws b, put aside');
    const focus = () => p.evaluate(`(e=>({tag:e?.tagName??null,cls:e?.className??null,drawn:Boolean(e&&e!==document.body&&e.getClientRects().length),
      on:e?.closest('[data-id]')?.dataset.id??e?.closest('[data-stack]')?.dataset.stack??null}))(document.activeElement)`);
    const at = await focus();
    assert.equal(at.drawn && at.on === ids.b, true, `focus stays on b, which Only new draws, though More is hidden (focus is on ${JSON.stringify(at)})`);
    await toggleOnlyNew(p, false);
    assert.deepEqual(p.errors, []); await p.close();
  });

  // Agent coordination hidden by Show agent coordination stays hidden under Only new: the keys never light it and the
  // Reader's ↓ never opens it, even with New items in it.
  await check('conversation Only new: agent coordination hidden by its chip is neither drawn nor stepped to under Only new', async () => {
    const DESK = { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false };
    const topicId = await ownConversation('rv6coord');
    const ids = {};
    ids.a = await say(topicId, 'rv6coord-a', 'Coord check: the first question.', { read: true });
    ids.d = await say(topicId, 'rv6coord-d', 'Coord check: between agents.', { post_args: { addressees: [agent], intent: 'tell' } });
    ids.c = await say(topicId, 'rv6coord-c', 'Coord check: the last question.');
    const p = await open('rv6coord', '/?conversation=rv6coord', { beforeNavigate: async q => q.send('Emulation.setDeviceMetricsOverride', DESK) });
    await until(() => quiet(p, `Boolean(document.querySelector(${JSON.stringify(card(ids.c))}))&&Boolean(document.querySelector(${JSON.stringify(card(ids.d))}))`), 'drawn');
    const coordination = await p.evaluate(`document.querySelector(${JSON.stringify(card(ids.d))}).closest('[data-coordination]')?.dataset.coordination ?? null`);
    assert.equal(coordination, 'agents', 'd heads agent coordination');
    await until(() => quiet(p, `Boolean(document.querySelector('#agent-coordination-show button')?.getClientRects().length)`), 'the coordination chip shows');
    if (await p.evaluate(`document.querySelector('#messages').dataset.showCoordination`) === 'true') {
      await p.point('#agent-coordination-show button');
      await until(() => quiet(p, `document.querySelector('#messages').dataset.showCoordination==='false'`), 'agent coordination hidden');
    }
    // The Only new chip shows once the conversation's read counts its New items.
    await until(async () => !(await chip(p)).hidden, 'the Only new chip shows');
    await toggleOnlyNew(p, true);
    const drawn = await p.evaluate(`[...document.querySelectorAll('#messages [data-id]')].filter(e=>e.getClientRects().length).map(e=>e.dataset.id)`);
    assert.equal((await tags(p, ids.d))?.tags[0], WAITING, 'd is a New item');
    assert.equal(drawn.includes(ids.d), false, 'Only new does not draw hidden agent coordination');
    // Reader from a, ↑ (newer, toward c) to the end: never d.
    await p.evaluate(`document.querySelector(${JSON.stringify(card(ids.a))}).scrollIntoView({block:'center'})`);
    await p.point(card(ids.a));
    await until(() => quiet(p, `document.querySelector('#reader').open && document.querySelector('#source-body').textContent.includes('the first question')`), 'the Reader shows a');
    const opened = [];
    for (let n = 0; n < 10; n++) {
      // ↓ is briefly disabled while neighbours load: wait for the source to settle, then for ↓ or a stable end.
      await until(() => quiet(p, `document.querySelector('#reader').open`), 'reader');
      const offered = await until(async () => (await quiet(p, `!document.querySelector('#next-message').disabled`)) ? 'yes' : null, 'the Reader offers ↑').catch(() => 'no');
      if (offered === 'no') break;
      const was = await p.evaluate(`document.querySelector('#source-body').textContent`);
      await p.point('#next-message');
      await until(() => quiet(p, `document.querySelector('#source-body').textContent !== ${JSON.stringify(was)}`), 'the Reader moved');
      opened.push(await p.evaluate(`document.querySelector('#source-body').textContent.slice(0, 50)`));
      if (opened.at(-1).includes('the last question')) break;
    }
    assert.deepEqual(opened.filter(words => words.includes('between agents')), [], `the Reader's ↑ never opens hidden agent coordination (${JSON.stringify(opened)})`);
    const state = await p.evaluate(`({drawn:[...document.querySelectorAll('#messages [data-id]')].filter(e=>e.getClientRects().length).map(e=>e.dataset.id),
      up:document.querySelector('#next-message').disabled,down:document.querySelector('#previous-message').disabled,body:document.querySelector('#source-body').textContent.slice(0,40),
      items:[...document.querySelectorAll('#messages [data-id]')].map(e=>[e.dataset.id,e.dataset.item??null,e.dataset.coordination??null])})`);
    assert.ok(opened.at(-1)?.includes('the last question'), `the Reader reaches c (${JSON.stringify(opened)}; ids ${JSON.stringify(ids)}; ${JSON.stringify(state)})`);
    await p.point('#reader-close'); await until(() => p.evaluate('!document.querySelector("#reader").open'), 'closed reader');
    await toggleOnlyNew(p, false);
    assert.deepEqual(p.errors, []); await p.close();
  });

  // rv355r7 (independent review): what loads older messages, as the page shows it under Only new. The New line's
  // "More new below" (a button, [data-line=older]) is hidden under Only new (aim.css), and paintMoreMessages hides
  // More messages / Earlier messages whenever that line is in the list, drawn or not.
  const loaders = p => quiet(p, `({line:(l=>l?{shown:l.getClientRects().length>0,faded:l.classList.contains('new-line-read')}:null)(document.querySelector('#messages > [data-line=older]')),
    more:(m=>({hidden:m.hidden,shown:m.getClientRects().length>0,text:m.textContent}))(document.querySelector('#more-messages'))})`);
  const canLoadOlder = state => Boolean(state?.line?.shown || state?.more?.shown);
  for (const aside of [false, true]) {
    await check(`conversation Only new: with the oldest new message not loaded${aside ? ' and a dossier put aside' : ''}, older messages can still be loaded under Only new`, async () => {
      const DESK = { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false };
      const name = aside ? 'rv7olderaside' : 'rv7older';
      const topicId = await ownConversation(name);
      const ids = [];
      for (let n = 0; n < 34; n++) ids.push(await say(topicId, `${name}-${n}`, `Unloaded new check: message ${n}.`));
      const p = await open(name, `/?conversation=${name}`, { beforeNavigate: async q => q.send('Emulation.setDeviceMetricsOverride', DESK) });
      await until(() => quiet(p, `Boolean(document.querySelector(${JSON.stringify(card(ids[33]))}))`), 'the newest is drawn');
      assert.equal(await quiet(p, `Boolean(document.querySelector(${JSON.stringify(card(ids[0]))}))`), false, 'the oldest new message is not loaded');
      await until(async () => canLoadOlder(await loaders(p)), `with Only new off, something loads older messages (${JSON.stringify(await loaders(p))})`);
      if (aside) {
        await control({ method: 'stack_act', sender: person, kind: 'stack.aside', message_id: ids[32], operation_id: name + '-aside', args: { through: (await view('topic_messages', { topic_id: topicId, audience: 'all', direction: 'before', limit: 1 })).items[0].seq } });
        await until(async () => (await view('stack_positions', { topic_id: topicId, message_ids: [ids[32]] })).items[0].stack_position.below, 'Core holds 32 below More');
        await until(async () => !(await tags(p, ids[32]))?.shown, '32 goes below a closed More');
      }
      await until(async () => !(await chip(p)).hidden, 'the Only new chip shows');
      await toggleOnlyNew(p, true);
      if (aside) await until(async () => (await tags(p, ids[32]))?.shown, 'Only new draws 32, put aside');
      const state = await loaders(p);
      const moreButton = await quiet(p, `Boolean(document.querySelector('#messages .stack-more')?.getClientRects().length)`);
      assert.ok(canLoadOlder(state) || moreButton, `under Only new, with message 0 (New) not loaded, something on the page loads older messages (${JSON.stringify(state)}, More's button shown ${moreButton})`);
      await toggleOnlyNew(p, false);
      assert.deepEqual(p.errors, []); await p.close();
    });
  }

  // rv355r7: ⌘Z after Move below More under Only new brings the message back, and the keys stay on it.
  await check('conversation Only new: Command-Z after moving a New message below More brings it back with the focus on it', async () => {
    const DESK = { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false };
    const topicId = await ownConversation('rv7undo');
    const ids = {};
    ids.a = await say(topicId, 'rv7undo-a', 'Undo check: the first question.');
    ids.b = await say(topicId, 'rv7undo-b', 'Undo check: the question put aside.');
    ids.c = await say(topicId, 'rv7undo-c', 'Undo check: the last question.');
    const p = await open('rv7undo', '/?conversation=rv7undo', { beforeNavigate: async q => q.send('Emulation.setDeviceMetricsOverride', DESK) });
    for (const id of Object.values(ids)) await until(async () => (await tags(p, id))?.tags[0] === WAITING, 'the new card ' + id);
    await toggleOnlyNew(p, true);
    await p.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 4, y: DESK.height - 4 });
    await p.evaluate(`(document.activeElement?.blur(),document.querySelector(${JSON.stringify(card(ids.b))}).scrollIntoView({block:'center'}),document.querySelector(${JSON.stringify(card(ids.b))}).focus(),true)`);
    await until(() => quiet(p, `document.querySelector('#messages .lit[data-id]')?.dataset.id===${JSON.stringify(ids.b)}`), 'b lights');
    await p.point('.message-bar [data-act=more]');
    await until(() => quiet(p, `Boolean(document.querySelector('.message-menu-list'))`), 'the menu opens');
    await p.evaluate(`[...document.querySelectorAll('.message-menu-list button')].find(e=>e.textContent==='Move below More').click()`);
    await until(async () => (await view('stack_positions', { topic_id: topicId, message_ids: [ids.b] })).items[0].stack_position.below, 'Core holds b below More');
    const focus = () => p.evaluate(`(e=>({drawn:Boolean(e&&e!==document.body&&e.getClientRects().length),on:e?.closest('[data-id]')?.dataset.id??null,cls:e?.className??null}))(document.activeElement)`);
    await p.key('z', 4);
    await until(async () => !(await view('stack_positions', { topic_id: topicId, message_ids: [ids.b] })).items[0].stack_position.below, `⌘Z brings b back in Core (focus was ${JSON.stringify(await focus())})`);
    const at = await focus();
    assert.equal(at.drawn && at.on === ids.b, true, `after ⌘Z the focus is on b (${JSON.stringify(at)})`);
    await toggleOnlyNew(p, false);
    await until(async () => (await tags(p, ids.b))?.shown, 'with Only new off b shows where it was');
    assert.equal(await quiet(p, `Boolean(document.querySelector('#messages .stack-more')?.getClientRects().length)`), false, 'nothing is below More');
    assert.deepEqual(p.errors, []); await p.close();
  });

  // rv355r7: with More open, Move below More: where does focus go, and can the keys go on from there.
  await check('conversation Move below More: moving a message below More while More is open leaves the focus on something drawn', async () => {
    const DESK = { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false };
    const topicId = await ownConversation('rv7open');
    const ids = {};
    ids.a = await say(topicId, 'rv7open-a', 'Open check: the first question.');
    ids.b = await say(topicId, 'rv7open-b', 'Open check: already put aside.');
    ids.c = await say(topicId, 'rv7open-c', 'Open check: put aside second.');
    ids.d = await say(topicId, 'rv7open-d', 'Open check: the last question.');
    const p = await open('rv7open', '/?conversation=rv7open', { beforeNavigate: async q => q.send('Emulation.setDeviceMetricsOverride', DESK) });
    for (const id of Object.values(ids)) await until(async () => (await tags(p, id))?.shown, 'drawn ' + id);
    await control({ method: 'stack_act', sender: person, kind: 'stack.aside', message_id: ids.b, operation_id: 'rv7open-aside', args: { through: (await view('topic_messages', { topic_id: topicId, audience: 'all', direction: 'before', limit: 1 })).items[0].seq } });
    await until(async () => !(await tags(p, ids.b))?.shown, 'b goes below a closed More');
    await p.evaluate(`document.querySelector('#messages .stack-more').scrollIntoView({block:'center'})`);
    await p.point('#messages .stack-more');
    await until(async () => (await tags(p, ids.b))?.shown, 'More opens: b shows');
    await p.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 4, y: DESK.height - 4 });
    await p.evaluate(`(document.activeElement?.blur(),document.querySelector(${JSON.stringify(card(ids.c))}).scrollIntoView({block:'center'}),document.querySelector(${JSON.stringify(card(ids.c))}).focus(),true)`);
    await until(() => quiet(p, `document.querySelector('#messages .lit[data-id]')?.dataset.id===${JSON.stringify(ids.c)}`), 'c lights');
    await p.point('.message-bar [data-act=more]');
    await until(() => quiet(p, `Boolean(document.querySelector('.message-menu-list'))`), 'the menu opens');
    await p.evaluate(`[...document.querySelectorAll('.message-menu-list button')].find(e=>e.textContent==='Move below More').click()`);
    await until(async () => (await view('stack_positions', { topic_id: topicId, message_ids: [ids.c] })).items[0].stack_position.below, 'Core holds c below More');
    const at = await p.evaluate(`(e=>({drawn:Boolean(e&&e!==document.body&&e.getClientRects().length),on:e?.closest('[data-id]')?.dataset.id??null,more:e?.classList?.contains('stack-more')??false,text:e?.textContent?.slice(0,60)??null}))(document.activeElement)`);
    assert.equal(at.drawn, true, `focus is on something drawn (${JSON.stringify(at)})`);
    const order = await p.evaluate(`[...document.querySelector('#messages').children].filter(e=>e.getClientRects().length).map(e=>e.classList.contains('stack-more')?'More':e.dataset.line?'line':(${JSON.stringify(Object.fromEntries(Object.entries(ids).map(([k, v]) => [v, k])))})[e.dataset.id??e.dataset.stack]??null).filter(Boolean)`);
    // Observed at 9632359: focus goes to More ("Hide messages · 2 put aside") while c is still drawn below it.
    assert.ok(order.includes('c'), `c is still drawn below the open More (${JSON.stringify(order)}; focus ${JSON.stringify(at)})`);
    await p.key('z', 4);
    await until(async () => !(await view('stack_positions', { topic_id: topicId, message_ids: [ids.c] })).items[0].stack_position.below, 'Command-Z brings c back');
    const back = await p.evaluate(`(e=>({drawn:Boolean(e&&e!==document.body&&e.getClientRects().length),on:e?.closest('[data-id]')?.dataset.id??null}))(document.activeElement)`);
    assert.equal(back.drawn && back.on === ids.c, true, `after ⌘Z focus on c (${JSON.stringify(back)})`);
    assert.deepEqual(p.errors, []); await p.close();
  });

  // rv355r7: Earlier messages, pressed under Only new with a dossier put aside, loads the older messages and Only new
  // draws the New ones among them; with nothing older left, it goes; Only new off, More closed hides the aside again.
  await check('conversation Only new: pressing Earlier messages under Only new loads older New messages and draws them', async () => {
    const DESK = { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false };
    const topicId = await ownConversation('rv7earlier');
    const ids = [];
    for (let n = 0; n < 40; n++) ids.push(await say(topicId, `rv7earlier-${n}`, `Earlier check: message ${n}.`, { read: n === 39 }));
    const p = await open('rv7earlier', '/?conversation=rv7earlier', { beforeNavigate: async q => q.send('Emulation.setDeviceMetricsOverride', DESK) });
    await until(() => quiet(p, `Boolean(document.querySelector(${JSON.stringify(card(ids[39]))}))`), 'the newest is drawn');
    await control({ method: 'stack_act', sender: person, kind: 'stack.aside', message_id: ids[38], operation_id: 'rv7earlier-aside', args: { through: (await view('topic_messages', { topic_id: topicId, audience: 'all', direction: 'before', limit: 1 })).items[0].seq } });
    await until(async () => !(await tags(p, ids[38]))?.shown, '38 goes below a closed More');
    await until(async () => !(await chip(p)).hidden, 'the Only new chip shows');
    await toggleOnlyNew(p, true);
    await until(async () => (await tags(p, ids[38]))?.shown, 'Only new draws 38');
    const loader = () => quiet(p, `(m=>({shown:m.getClientRects().length>0,text:m.textContent}))(document.querySelector('#more-messages'))`);
    await until(async () => (await loader()).shown, 'Earlier messages shows under Only new');
    assert.equal(await quiet(p, `Boolean(document.querySelector(${JSON.stringify(card(ids[0]))}))`), false, 'message 0 is not loaded yet');
    await p.evaluate(`document.querySelector('#more-messages').scrollIntoView({block:'center'})`);
    await p.point('#more-messages');
    await until(() => quiet(p, `Boolean(document.querySelector(${JSON.stringify(card(ids[0]))}))`), 'Earlier messages loads message 0');
    await until(async () => (await tags(p, ids[0]))?.shown, `Only new draws message 0, a New item (${JSON.stringify(await tags(p, ids[0]))})`);
    const drawn = await p.evaluate(`[...document.querySelectorAll('#messages [data-id]')].filter(e=>e.getClientRects().length).map(e=>e.dataset.id)`);
    const missing = ids.filter(id => !drawn.includes(id));
    assert.deepEqual(missing, [], 'under Only new every New message loaded is drawn, the one put aside among them');
    await until(async () => !(await loader()).shown, `with nothing older left, Earlier messages goes (${JSON.stringify(await loader())})`);
    await toggleOnlyNew(p, false);
    await until(async () => !(await tags(p, ids[38]))?.shown, 'Only new off: 38 is below the closed More again');
    assert.deepEqual(p.errors, []); await p.close();
  });
  // rv355r8b (independent review): the doc says under Only new the dossier keeps focus after Move below More. Here the
  // dossier's head was read (Only new does not draw it) and its reply is New (drawn); Move below More from the reply's ⋯.
  await check('conversation Only new: under Only new, Move below More from a New reply whose head Only new does not draw leaves focus on something drawn', async () => {
    const DESK = { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false };
    const topicId = await ownConversation('rv8bfocus');
    const ids = {};
    ids.a = await say(topicId, 'rv8bfocus-a', 'Focus check: the first question.');
    const msg = async (operation, sender, body, args = {}) => (await control({ method: 'agent_message', operation_id: operation, topic_id: topicId, whole_topic: !args.reply_to, sender, body, ...args })).result.message_id;
    ids.root = await msg('rv8bfocus-root', 'person', 'Focus check: the head, to be answered.');
    ids.ans = await msg('rv8bfocus-ans', agent, 'Focus check: the answer.', { reply_to: ids.root });
    ids.reply = await msg('rv8bfocus-reply', 'person', 'Focus check: the New reply.', { reply_to: ids.ans });
    ids.c = await say(topicId, 'rv8bfocus-c', 'Focus check: the last question.');
    const p = await open('rv8bfocus', '/?conversation=rv8bfocus', { beforeNavigate: async q => q.send('Emulation.setDeviceMetricsOverride', DESK) });
    await until(async () => (await tags(p, ids.reply))?.tags[0] === WAITING && (await tags(p, ids.root))?.tags[0] !== WAITING, 'the reply is New, the head settled').catch(async e => { throw Error(e.message + ' ' + JSON.stringify([await tags(p, ids.reply), await tags(p, ids.root)])); });
    const rootState = await tags(p, ids.root);
    await until(async () => !(await chip(p)).hidden, 'the Only new chip shows');
    await toggleOnlyNew(p, true);
    await until(async () => (await tags(p, ids.reply))?.shown, 'Only new draws the New reply');
    const headShown = Boolean((await tags(p, ids.root))?.shown);
    assert.equal(headShown, false, `Only new does not draw the read head (${JSON.stringify(await tags(p, ids.root))})`);
    await p.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 4, y: DESK.height - 4 });
    await p.evaluate(`(document.activeElement?.blur(),document.querySelector(${JSON.stringify(card(ids.reply))}).scrollIntoView({block:'center'}),document.querySelector(${JSON.stringify(card(ids.reply))}).focus(),true)`);
    await until(() => quiet(p, `document.querySelector('#messages .lit[data-id]')?.dataset.id===${JSON.stringify(ids.reply)}`), 'the reply lights');
    await p.point('.message-bar [data-act=more]');
    await until(() => quiet(p, `Boolean(document.querySelector('.message-menu-list'))`), 'the menu opens');
    const labels = await p.evaluate(`[...document.querySelectorAll('.message-menu-list button')].map(e=>e.textContent)`);
    assert.ok(labels.includes('Move below More'), `the reply's ⋯ offers Move below More (${JSON.stringify(labels)})`);
    await p.evaluate(`[...document.querySelectorAll('.message-menu-list button')].find(e=>e.textContent==='Move below More').click()`);
    await until(async () => (await view('stack_positions', { topic_id: topicId, message_ids: [ids.root] })).items[0].stack_position.below, 'Core holds the dossier below More');
    await until(() => quiet(p, `!document.querySelector('.message-menu-list')`), 'the menu closes');
    const focus = () => p.evaluate(`(e=>({drawn:Boolean(e&&e!==document.body&&e.getClientRects().length),on:e?.closest('[data-id]')?.dataset.id??null,tag:e?.tagName??null,cls:e?.className??null,act:e?.dataset?.act??null,label:e?.getAttribute?.('aria-label')??null,text:e?.textContent?.slice(0,40)??null,bar:e?.closest('.message-bar')?{shown:Boolean(e.closest('.message-bar').getClientRects().length),hidden:e.closest('.message-bar').hidden}:null,lit:document.querySelector('#messages .lit[data-id]')?.dataset.id??null,headFocusable:(h=>h?{rects:h.getClientRects().length}:null)(document.querySelector(${JSON.stringify(card(ids.root))}))}))(document.activeElement)`);
    const at = await focus();
    assert.equal(at.drawn, true, `after Move below More under Only new, focus is on something drawn (head shown ${headShown}, root ${JSON.stringify(rootState)}; focus ${JSON.stringify(at)})`);
    // ⌘Z, from wherever the move left the keys: the dossier comes back, and the keys are on it.
    await p.key('z', 4);
    const undone = await until(async () => !(await view('stack_positions', { topic_id: topicId, message_ids: [ids.root] })).items[0].stack_position.below, 'Command-Z brings the dossier back').then(() => true, () => false);
    const back = await focus();
    assert.ok(undone, `⌘Z after the move brings the dossier back (focus was ${JSON.stringify(at)})`);
    assert.ok(back.drawn && [ids.reply, ids.root].includes(back.on), `after ⌘Z the keys are on the dossier (${JSON.stringify(back)})`);
    assert.ok([ids.reply, ids.root].includes(at.on), `the dossier keeps focus (${JSON.stringify(at)})`);
    await toggleOnlyNew(p, false);
    assert.deepEqual(p.errors, []); await p.close();
  });
  // rv355r8b (independent review): the two loaders of older messages, across Only new on and off, page by page. Off, an
  // unfaded "More new below" line is the one loader and More messages / Earlier messages hides; on, the line is not drawn
  // and the button loads; nothing older left, the button goes; off again, the line returns as the one loader.
  const rv8 = p => quiet(p, `({line:(l=>l?{kind:l.dataset.line,shown:l.getClientRects().length>0,faded:l.classList.contains('new-line-read')}:null)(document.querySelector('#messages > [data-line]')),
    more:(m=>({hidden:m.hidden,shown:m.getClientRects().length>0,text:m.textContent}))(document.querySelector('#more-messages')),
    loaded:document.querySelectorAll('#messages [data-id]').length})`);
  const lineLoads = s => Boolean(s?.line && s.line.kind === 'older' && s.line.shown && !s.line.faded);
  for (const [label, metrics, aside] of [['desk', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false }, false],
    ['desk', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false }, true], ['phone', PHONE, true]]) {
    await check(`conversation Only new loader: ${label}${aside ? ', a dossier put aside' : ''}: one loader of older messages at a time, Only new on and off, page by page`, async () => {
      const name = `rv8b${label}${aside ? 'aside' : ''}`, N = 70;
      const topicId = await ownConversation(name);
      const ids = [];
      for (let n = 0; n < N; n++) ids.push(await say(topicId, `${name}-${n}`, `Loader check: message ${n}.`));
      const p = await open(name, `/?conversation=${name}`, { beforeNavigate: async q => {
        await q.send('Emulation.setDeviceMetricsOverride', metrics);
        if (metrics.mobile) await q.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 1 });
      } });
      const has = id => quiet(p, `Boolean(document.querySelector(${JSON.stringify(card(id))}))`);
      await until(() => has(ids[N - 1]), 'the newest is drawn');
      assert.equal(await has(ids[0]), false, 'the oldest (New) is not loaded');
      await until(async () => lineLoads(await rv8(p)), `Only new off: the line "More new below" shows unfaded (${JSON.stringify(await rv8(p))})`);
      assert.equal((await rv8(p)).more.shown, false, `Only new off: the button hides while the line loads (${JSON.stringify(await rv8(p))})`);
      if (aside) {
        await control({ method: 'stack_act', sender: person, kind: 'stack.aside', message_id: ids[N - 2], operation_id: name + '-aside', args: { through: (await view('topic_messages', { topic_id: topicId, audience: 'all', direction: 'before', limit: 1 })).items[0].seq } });
        await until(async () => !(await tags(p, ids[N - 2]))?.shown, 'the dossier goes below a closed More');
        const s = await rv8(p);
        assert.ok(lineLoads(s) && !s.more.shown, `aside, More closed, Only new off: the line alone loads (${JSON.stringify(s)})`);
      }
      await until(async () => !(await chip(p)).hidden, 'the Only new chip shows');
      await toggleOnlyNew(p, true);
      await until(async () => (await rv8(p)).more.shown, `Only new on: the button shows (${JSON.stringify(await rv8(p))})`);
      let s = await rv8(p);
      assert.equal(s.line?.shown ?? false, false, 'Only new on: the line is not drawn');
      assert.equal(s.more.text, aside ? 'Earlier messages' : 'More messages', 'its words');
      const before = s.loaded;
      await p.evaluate(`document.querySelector('#more-messages').scrollIntoView({block:'center'})`);
      await p.point('#more-messages');
      await until(async () => (await rv8(p)).loaded > before, 'the press loads older messages');
      if (!(await has(ids[0]))) {
        await until(async () => (await rv8(p)).more.shown, `Only new on, more older left: the button stays (${JSON.stringify(await rv8(p))})`);
        await toggleOnlyNew(p, false);
        await until(async () => { const t = await rv8(p); return lineLoads(t) !== t.more.shown; }, `Only new off with older left: exactly one loader (${JSON.stringify(await rv8(p))})`);
        s = await rv8(p);
        assert.ok(!(lineLoads(s) && s.more.shown), `never both (${JSON.stringify(s)})`);
        if (lineLoads(s)) assert.equal(s.more.shown, false, 'the line back unfaded: the button hides again');
        await toggleOnlyNew(p, true);
        for (let i = 0; i < 5 && !(await has(ids[0])); i++) {
          await until(async () => (await rv8(p)).more.shown, `Only new on: the button shows to load more (${JSON.stringify(await rv8(p))})`);
          const at = (await rv8(p)).loaded;
          await p.evaluate(`document.querySelector('#more-messages').scrollIntoView({block:'center'})`);
          await p.point('#more-messages');
          await until(async () => (await rv8(p)).loaded > at, 'the press loads older messages');
        }
      }
      assert.equal(await has(ids[0]), true, 'the oldest is loaded at last');
      await until(async () => !(await rv8(p)).more.shown, `nothing older left: the button goes (${JSON.stringify(await rv8(p))})`);
      await until(async () => (await tags(p, ids[0]))?.shown, 'Only new draws message 0');
      await toggleOnlyNew(p, false);
      s = await rv8(p);
      assert.equal(s.more.shown, false, `Only new off, nothing older: no button (${JSON.stringify(s)})`);
      assert.notEqual(s.line?.kind, 'older', `no "More new below" line with nothing older (${JSON.stringify(s)})`);
      if (aside) await until(async () => !(await tags(p, ids[N - 2]))?.shown, 'Only new off: the dossier is below the closed More again');
      assert.deepEqual(p.errors, []); await p.close();
    });
  }
  {
  // The Reader under Only new, which is this page's own view (reply-stacks.mjs, shownView): from a message it does
  // not draw, ↑ and ↓ step to the nearest message it draws; another topic's message steps as it would without it.
  const swMsg = async (topicId, operation, sender, body, args = {}) => (await control({ method: 'agent_message', operation_id: operation, topic_id: topicId,
    whole_topic: !args.reply_to, sender, body, ...args })).result.message_id;
  const swDesk = { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false };
  await check('conversation Only new: the Reader opened by a link on a settled message offers ↑ to the New message drawn above it', async () => {
    const topicId = await ownConversation('onlynew-link');
    const ids = {};
    ids.n0 = await say(topicId, 'onlynew-link-n0', 'Link sweep: the oldest New question.');
    ids.t = await swMsg(topicId, 'onlynew-link-t', 'person', 'Link sweep: settled T.');
    ids.ta = await swMsg(topicId, 'onlynew-link-ta', agent, 'Link sweep: the answer to T.', { reply_to: ids.t, addressees: [person] });
    ids.s = await swMsg(topicId, 'onlynew-link-s', 'person', 'Link sweep: settled S, linked.');
    ids.sa = await swMsg(topicId, 'onlynew-link-sa', agent, 'Link sweep: the answer to S.', { reply_to: ids.s, addressees: [person] });
    ids.n1 = await say(topicId, 'onlynew-link-n1', `Link sweep: N1, see ${facts.origin}/?topic=${topicId}&message=${ids.s} please.`);
    const p = await open('onlynew-link', '/?conversation=onlynew-link', { beforeNavigate: async q => q.send('Emulation.setDeviceMetricsOverride', swDesk) });
    await until(async () => (await tags(p, ids.s))?.tags[0] === 'Answered' && (await tags(p, ids.t))?.tags[0] === 'Answered' && (await tags(p, ids.n1))?.tags[0] === WAITING && (await tags(p, ids.n0))?.tags[0] === WAITING, 'T and S settled, N0 and N1 New');
    await until(async () => !(await chip(p)).hidden, 'the Only new chip shows');
    await toggleOnlyNew(p, true);
    await until(async () => !(await tags(p, ids.s))?.shown && (await tags(p, ids.n1))?.shown && (await tags(p, ids.n0))?.shown, 'Only new draws N1 and N0, not S');
    const drawn = await p.evaluate(`[...document.querySelectorAll('#messages [data-id]')].filter(e=>e.getClientRects().length).map(e=>e.dataset.id)`);
    const link = `${card(ids.n1)} a.words-link`;
    await until(() => quiet(p, `Boolean(document.querySelector(${JSON.stringify(link)}))`), 'N1 carries the link');
    await p.evaluate(`document.querySelector(${JSON.stringify(link)}).scrollIntoView({block:'center'})`);
    await p.point(link);
    await until(() => quiet(p, `document.querySelector('#reader').open && document.querySelector('#source-body').textContent.includes('settled S')`), 'the link opens S in the Reader');
    const seq = (await view('source', { source_ref: { kind: 'message', id: ids.s } })).seq;
    const core = {};
    for (const [way, direction] of [['next', 'after'], ['previous', 'before']]) core[way] = (await view('topic_messages', { topic_id: topicId, cursor: seq, audience: 'reader', direction, limit: 1 })).items[0]?.id ?? null;
    const names = Object.fromEntries(Object.entries(ids).map(([key, id]) => [id, key]));
    const up = await until(() => quiet(p, `!document.querySelector('#next-message').disabled`), 'the Reader offers ↑').then(() => true, () => false);
    const down = await quiet(p, `!document.querySelector('#previous-message').disabled`);
    const state = `drawn under Only new ${JSON.stringify(drawn.map(id => names[id] ?? id))}; Core's neighbours of S: next ${names[core.next] ?? core.next}, previous ${names[core.previous] ?? core.previous}; ↑ offered ${up}, ↓ offered ${down}`;
    assert.ok(up, `with N1 drawn above where S sits, the Reader on S (opened by N1's link) offers ↑ (${state})`);
    await p.point('#next-message');
    await until(() => quiet(p, `document.querySelector('#source-body').textContent.includes('Link sweep: N1')`), `↑ from S opens N1 (${state})`);
    await p.point('#reader-close'); await until(() => p.evaluate('!document.querySelector("#reader").open'), 'closed reader');
    assert.deepEqual(p.errors, []); await p.close();
  });
  await check('conversation Only new: the Reader on another topic\'s message, opened from an About link, offers the same ↑ and ↓ with Only new on as off', async () => {
    // A message sent to the conversation about t1's message carries an About link back to it; the link opens t1's
    // message in the Reader here. Only new is the Conversation's view of its own items, not of t1's messages.
    const t = await open('onlynew-about-t1', '/?topic=t1');
    await t.open(1);
    await until(() => quiet(t, `document.querySelectorAll('#reply-destination button').length === 2`), 'two chips under To');
    await replace(t, 'About sweep: a decision about this message.');
    await t.point('#reply-destination button[data-destination]:not([aria-pressed="true"])');
    await until(() => quiet(t, `document.querySelectorAll('#reply-destination button')[1]?.getAttribute('aria-pressed') === 'true'`), 'the conversation is chosen');
    const sentId = await sent(t, t.calls.length);
    assert.deepEqual(t.errors, []); await t.close();
    const p = await open('onlynew-about', '/?conversation=w1', { beforeNavigate: async q => q.send('Emulation.setDeviceMetricsOverride', swDesk) });
    const about = `${card(sentId)} .about-line .item-link`;
    await until(async () => (await tags(p, sentId))?.tags[0] === WAITING && await quiet(p, `Boolean(document.querySelector(${JSON.stringify(about)}))`), 'the sent message is New and carries its About link');
    const sourceWords = (await view('source', { source_ref: facts.sources[1] })).body.slice(0, 30);
    const offered = async label => {
      await p.evaluate(`document.querySelector(${JSON.stringify(about)}).scrollIntoView({block:'center'})`);
      await p.point(about);
      await until(() => quiet(p, `document.querySelector('#reader').open && document.querySelector('#source-body').textContent.includes(${JSON.stringify(sourceWords)})`), `${label}: the About link opens t1's message in the Reader`);
      const either = () => quiet(p, `!document.querySelector('#next-message').disabled || !document.querySelector('#previous-message').disabled`);
      await until(either, `${label}: the Reader offers a step`).catch(() => null);
      const state = await p.evaluate(`({up:!document.querySelector('#next-message').disabled,down:!document.querySelector('#previous-message').disabled})`);
      await p.point('#reader-close'); await until(() => p.evaluate('!document.querySelector("#reader").open'), 'closed reader');
      return state;
    };
    const off = await offered('Only new off');
    assert.ok(off.up || off.down, `Only new off: the Reader on t1's message offers a step (${JSON.stringify(off)})`);
    await toggleOnlyNew(p, true);
    await until(async () => (await tags(p, sentId))?.shown, 'Only new draws the sent message');
    const on = await offered('Only new on');
    assert.deepEqual(on, off, `the Reader on t1's message offers the same steps with Only new on (${JSON.stringify(on)}) as off (${JSON.stringify(off)})`);
    await toggleOnlyNew(p, false);
    assert.deepEqual(p.errors, []); await p.close();
  });
  }
  // Item 403: Only new sits in the row over the feed, between the header's buttons and the messages. The keys go onto it
  // and off again as on any of the buttons at the top of the feed, with it on and with it off.
  await check('conversation the keys go on from Only new: ↓ reaches the top of the feed and ↑ comes back, ↑ goes on up to the header\'s buttons and ↓ back, on and off, skipping no message, and Return and Space still press it', async () => {
    // Two items, so the feed holds a second message for ↓ to go on to whatever ran before.
    await post('conversation-keys-older', 'An item for the keys.');
    const fresh = await post('conversation-keys-new', 'A new item for the keys.');
    const p = await open('conversation-keys', '/?conversation=w1');
    await until(async () => (await tags(p, fresh))?.tags[0] === WAITING, 'the new card');
    await until(async () => !(await chip(p)).hidden, 'Only new shows');
    const only = '#conversation-show button';
    // Where the keys are: Only new, a dossier's chevron, a message, or another control by its id.
    const keyed = () => p.evaluate(`(()=>{const e=document.activeElement;if(e?.matches?.(${JSON.stringify(only)}))return 'only-new';
      if(e?.matches?.('#messages .stack-toggle'))return 'stack:'+e.closest('.reply-stack').dataset.stack;
      const m=e?.closest?.('#messages [data-id]');return m?'message:'+m.dataset.id:e?.id||e?.tagName||'none'})()`);
    // The feed's first stops as the keys step through them, top down: each message shown, a dossier's chevron
    // just before its head while that head shows whole (reply-stacks.mjs, navigationStops).
    const stops = () => p.evaluate(`(()=>{const out=[];for(const e of document.querySelectorAll('#messages > [data-id], #messages > .reply-stack > [data-id], #messages > .reply-stack > .stack-replies > [data-id]')){
      if(!e.getClientRects().length)continue;const s=e.closest('.reply-stack'),t=s?.querySelector(':scope > .stack-toggle');
      if(s?.dataset.stack===e.dataset.id&&s.dataset.headOpen==='true'&&t?.getClientRects().length)out.push('stack:'+s.dataset.stack);out.push('message:'+e.dataset.id)}return out.slice(0,2)})()`);
    // A click on Only new turns it on, and Chrome leaves it the focus.
    await p.evaluate(`document.querySelector('#conversation-show').scrollIntoView({block:'center'})`);
    await p.point(only);
    await until(async () => (await chip(p)).pressed === 'true', 'a click turns Only new on');
    assert.equal(await keyed(), 'only-new', 'the keys are on Only new');
    const [first] = await stops();
    assert.ok(first, 'the feed shows a message under Only new');
    await p.key('ArrowDown');
    assert.equal(await keyed(), first, '↓ from Only new moves the keys on to the top of the feed');
    await p.key('ArrowUp');
    assert.equal(await keyed(), 'only-new', '↑ from the top of the feed comes back to Only new, the button the keys left');
    // Only new is a row of its own under the header's buttons: ↑ from it goes up to them, never staying on it.
    await p.key('ArrowUp');
    assert.equal(await p.evaluate(`Boolean(document.querySelector('#main > .topic-header')?.contains(document.activeElement))`), true,
      `↑ from Only new goes up to the header's buttons, not ${await keyed()}`);
    await p.key('ArrowDown');
    assert.equal(await keyed(), 'only-new', '↓ from the header\'s buttons comes back down to Only new');
    // Off by Return, the keys still on it: ↓ and ↓ again go down the feed as it now shows, skipping no message.
    await p.key('Enter');
    await until(async () => (await chip(p)).pressed === 'false', 'Return on Only new turns it off');
    assert.equal(await keyed(), 'only-new', 'the keys stay on it');
    const all = await stops();
    assert.equal(all.length, 2, `the whole feed shows at least two stops: ${all}`);
    await p.key('ArrowDown');
    assert.equal(await keyed(), all[0], '↓ from it, turned off, goes to the top of the whole feed');
    await p.key('ArrowDown');
    assert.equal(await keyed(), all[1], 'and the next ↓ to the next, skipping nothing');
    await p.key('ArrowUp'); await p.key('ArrowUp');
    assert.equal(await keyed(), 'only-new', 'and ↑ back up to Only new');
    await p.key(' ');
    await until(async () => (await chip(p)).pressed === 'true', 'Space turns it on again');
    await p.key(' ');
    await until(async () => (await chip(p)).pressed === 'false', 'and off');
    assert.deepEqual(p.errors, []); await p.close();
  });
}

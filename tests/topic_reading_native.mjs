// The topic page's acts and how its cards read (docs/interaction.md,
// docs/thumbs.md, docs/topic-reading.md), pressed as a person presses them: a
// pointer and keys at 1280 wide, and a finger at 390 wide with touch. Each
// check seeds a topic of its own through the fixture's real commands and
// reads what Core then holds, so a press that only repaints the page fails.
// Run in Chrome for Testing by reader_persistence_native.mjs --reading and in
// Safari's engine by webkit_native.mjs --reading. Screenshots are kept as
// reading-*.png.
//
// Which check holds each act is in tests/acts.json, with the break each one
// must catch (tools/acts.py): the bar's, the card's and the Reader's 👍 and
// one an agent gives (item 25); ✅ and 🚫 on a go-ahead ask (124); ↑ ↓,
// Return, Reply on the bar and a phone's two taps (114); a cut-off card that
// scrolls in place (108); the guide (106); read cards and quiet agent talk
// (31); the reply arrow (102); reply stacks (103, and 283 in stack_native.mjs); the time beside "Saved to
// Theseus" (61); ⌥↑ and ⌥↓ (78); and #img, Paste image and a pasted image
// (121), in the topic's composer and in the Reader.
import assert from 'node:assert/strict';
import { stackChecks } from './stack_native.mjs';

const DEVICES = { laptop: { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false }, phone: { width: 390, height: 844, deviceScaleFactor: 1, mobile: true } };
const entry = id => `#messages [data-id="${id}"]`;
// A message's card: the entry itself, or the card a folded line holds; either carries its id.
const card = id => `#messages .message-card[data-id="${id}"]`;
// Its words, where a press opens or lights it: an agent's name on the card opens its colour picker instead.
const words = id => card(id) + ' > .message-preview';
const BAR = '.message-bar';
// Before the page's own code: each command the page sends, by kind, as it sends it (the page binds fetch when it
// starts, and sends a press's command within the press's own click), and each click as the window first hears it.
// After a press's click is heard, what it sent is known, so "sends nothing" needs no wait.
// window.watchFor = {read, words}: a check waits for the page to read the view named read and get an answer
// holding words; window.watched turns true when it has.
// window.holdReads: the page's reports of what it read on screen (topic.read_through) are held unanswered, as a
// lost connection holds them, so Core keeps those messages unread and a check sees what one act read.
// window.staleThumb: the next thumbs-up goes fenced on a revision Core does not hold, so Core refuses it.
// window.fetchesOut: how many of the page's requests are out and not yet answered (held reports aside).
const HEARD = `(()=>{window.sent=[];window.taps=0;window.fetchesOut=0;const f=window.fetch;window.fetch=function(input,init){
  let b=null;try{b=init&&typeof init.body==='string'?JSON.parse(init.body):null;if(b&&b.kind)window.sent.push(b.kind)}catch(e){}
  if(b&&b.kind==='topic.read_through'&&window.holdReads)return new Promise(()=>{});
  if(b&&b.kind==='message.thumb'&&window.staleThumb){window.staleThumb=false;b.expected.thumb_revision+=99;init={...init,body:JSON.stringify(b)}}
  const answer=f.call(this,input,init),watch=window.watchFor,back=()=>{window.fetchesOut--};window.fetchesOut++;answer.then(back,back);
  if(watch&&b&&b.name===watch.read)answer.then(r=>r.clone().text()).then(t=>{if(t.includes(watch.words))window.watched=true},()=>{});
  return answer};
  addEventListener('click',()=>{window.taps++},true)})()`;

// grant(names): Chrome's own grant of permissions (clipboard-read, ...) to the page's
// origin, as a person's earlier "Allow" leaves it; Safari's engine has none. engine: 'chrome' or 'webkit'.
export async function readingChecks({ check, page, until, view, control, shot, facts, observations, grant = null, engine = 'chrome' }) {
  // A topic of the person's own, with aim-core and aim-ux in it, and messages
  // said in order: each [name, {sender, body, ...}] as the fixture's agent_message takes it.
  const seed = async (topic, said) => {
    await control({ method: 'navigation_topics', topics: [{ id: topic, title: 'Reading ' + topic }] });
    const ids = {};
    let n = 0;
    for (const [name, more] of said) {
      const { reply_to: to, ...rest } = more;
      ids[name] = (await control({ method: 'agent_message', operation_id: `${topic}-${n++}`, topic_id: topic, source: 'topic',
        ...rest, ...(to ? { reply_to: ids[to] } : {}) })).result.message_id;
    }
    return ids;
  };
  // The page at a device's size; on the phone, with touch from its start. init: more to run before the page's own code.
  const open = async (name, device, topic, first, init = '') => {
    const metrics = DEVICES[device];
    const p = await page(name, null, true, { url: facts.origin + '/?topic=' + topic, beforeNavigate: async q => {
      await q.send('Page.addScriptToEvaluateOnNewDocument', { source: HEARD });
      if (init) await q.send('Page.addScriptToEvaluateOnNewDocument', { source: init });
      await q.send('Emulation.setDeviceMetricsOverride', metrics);
      if (metrics.mobile) await q.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 1 });
    } });
    await until(() => p.evaluate(`document.body.dataset.ready === 'true' && Boolean(document.querySelector(${JSON.stringify(entry(first))}))`), name + ': the topic is drawn');
    return p;
  };
  // Brings a page to the front and lets it catch up before a reload: a page behind another reads what it missed
  // when it is shown, and a reload over those reads replaces the document under answers still on their way.
  // Once it is visible the page has started its catch-up, which it does as it hears so, and it has caught up
  // when none of its requests is out.
  const front = async pg => {
    await pg.send('Page.bringToFront');
    await until(() => pg.evaluate("document.visibilityState === 'visible' && window.fetchesOut === 0"), 'the page is shown and its catch-up reads are answered');
  };
  // Waits for read() to give want; on a timeout the failure shows what it gave instead.
  const becomes = async (read, want, message) => {
    let last;
    try { await until(async () => JSON.stringify(last = await read()) === JSON.stringify(want), message); }
    catch (error) { assert.deepEqual(last, want, message); throw error; }
  };
  // ⌘Z in a field: in Chrome it must give want. Safari's engine is held to no undo grouping here:
  // what it gives is recorded, and the writing is put as want for the steps after.
  const undoes = async (p, field, want, message) => {
    await p.key('z', 4);
    if (engine === 'chrome') return becomes(() => valueOf(p, field), want, message);
    await p.evaluate('new Promise(done=>requestAnimationFrame(()=>requestAnimationFrame(done)))');
    const undone = await valueOf(p, field);
    observations.push({ name: 'reading ' + message, engine, held: undone === want ? 'as in Chrome' : 'gives ' + JSON.stringify(undone) + ', not ' + JSON.stringify(want) });
    if (undone !== want) { await p.evaluate(`document.querySelector(${JSON.stringify(field)}).select()`); await p.send('Input.insertText', { text: want }); }
  };
  const centre = (p, selector) => p.evaluate(`document.querySelector(${JSON.stringify(selector)}).scrollIntoView({block:'center'})`);
  // A finger's tap where the target shows, failing by name when something else is there.
  const tap = async (p, selector, at = 'corner') => {
    const b = await p.box(selector);
    assert.ok(b && b.width > 0 && b.height > 0, `visible target ${selector}`);
    const x = at === 'centre' ? b.x + b.width / 2 : b.x + Math.min(12, b.width / 2), y = at === 'centre' ? b.y + b.height / 2 : b.y + Math.min(12, b.height / 2);
    assert.ok(x >= 0 && y >= 0 && x < b.viewportWidth && y < b.viewportHeight, `${selector} is inside the window before a tap`);
    const hit = await p.evaluate(`(t=>{const h=document.elementFromPoint(${x},${y});return t?.contains(h)?'':h?h.tagName.toLowerCase()+'.'+h.className:'nothing'})(document.querySelector(${JSON.stringify(selector)}))`);
    assert.equal(hit, '', `${selector} is covered by ${hit} where it would be tapped`);
    await p.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
    await p.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  };
  // Where a wheel or a finger's drag starts on a target: on the part of it the window shows, at most 120px
  // below that part's top, on the target itself and not something over it. Taken just before each
  // gesture, as the page stands then: a fling runs on past the distance it was given, by more some runs
  // than others, so a point worked out from where the target was can fall outside the window.
  const within = async (p, selector) => {
    const at = await p.evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)}),b=e.getBoundingClientRect(),top=Math.max(b.top,0),bottom=Math.min(b.bottom,innerHeight),
      x=b.left+b.width/2,y=top+Math.min((bottom-top)/2,120);return {x,y,shown:bottom-top,hit:e.contains(document.elementFromPoint(x,y))}})()`);
    assert.ok(at.shown >= 40 && at.hit, `${selector} shows in the window where a gesture starts on it: ${JSON.stringify(at)}`);
    return [at.x, at.y];
  };
  // A click on a laptop, a tap on a phone.
  const press = (p, device, selector) => (device === 'phone' ? tap(p, selector) : p.point(selector));
  const lit = p => p.evaluate(`[...document.querySelectorAll('#messages .lit[data-id]')].map(e=>e.dataset.id)`);
  const bar = p => p.evaluate(`(()=>{const b=document.querySelector('${BAR}');return b&&!b.hidden?Object.fromEntries([...b.querySelectorAll('button')].filter(x=>!x.hidden).map(x=>[x.dataset.act,x.getAttribute('aria-pressed')])):null})()`);
  const readerOn = p => p.evaluate(`document.querySelector('#reader').open ? document.querySelector('#source-body').textContent : null`);
  const closeReader = async (p, device) => {
    await press(p, device, '#reader-close');
    await until(async () => await readerOn(p) === null, 'the Reader closed');
  };
  // Lights a card as the person does: the pointer rests on it, or a finger taps it; on its words,
  // or, for a stack's head shown as one row, on that row, which lights with no bar (docs/reply-stacks.md).
  const light = async (p, device, id) => {
    await centre(p, card(id));
    const row = !await p.evaluate(`document.querySelector(${JSON.stringify(words(id))})?.getClientRects().length > 0`);
    // The left edge now belongs to the separate reply chevron. Light the
    // head on its author text, which still opens the head's own message.
    const target = row ? card(id) + ' > .stack-head > .stack-who' : words(id);
    if (device === 'phone') await tap(p, target); else await p.point(target, 'move');
    await until(async () => (await lit(p)).includes(id) && (await bar(p) === null) === row, `${device}: ${id} lights, ${row ? 'with no bar on a head shown as one row' : 'with its bar'}`);
  };
  // The pointer leaves the messages for a spot where no message, bar or control is.
  const away = async p => {
    const [x, y] = await p.evaluate(`(()=>{for(const [x,y] of [[innerWidth-6,innerHeight-6],[innerWidth-6,6],[6,innerHeight-6],[6,6]]){const h=document.elementFromPoint(x,y);
      if(!h||!h.closest('#messages, .message-bar, button, a, input, textarea'))return [x,y]}return null})()`);
    await p.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
  };
  const reactions = async id => (await view('reactions', { message_id: id })).reactions;
  const thumbsBy = async (id, who) => (await reactions(id)).thumbs.filter(thumb => thumb.actor_id === who).length;
  // The Reader on a message, opened as the person opens it: Return on the lit message, or a phone's second tap.
  const openReader = async (p, device, id, starts) => {
    await p.evaluate('document.activeElement?.blur()');
    if (device === 'laptop') { await light(p, device, id); await p.key('Enter'); }
    else { await centre(p, card(id)); await tap(p, words(id)); await until(async () => (await lit(p)).includes(id), 'phone: the message lights'); await tap(p, words(id)); }
    await until(async () => (await readerOn(p))?.startsWith(starts), `${device}: the Reader opens on "${starts}"`);
  };
  // The Reader opened to be read: a click on the lit message, or a phone's second tap. The cursor is never put
  // in the reply, which is one quiet line.
  const readerByClick = async (p, device, id, starts) => {
    await p.evaluate('document.activeElement?.blur()');
    if (device === 'laptop') { await light(p, device, id); await p.point(words(id)); await until(async () => (await readerOn(p))?.startsWith(starts), `laptop: a click opens the Reader on "${starts}"`); }
    else await openReader(p, device, id, starts);
    await until(() => p.evaluate(`document.querySelector('#reader-composer').dataset.compose === 'line' && document.activeElement?.id !== 'writing-body'`),
      `${device}: the Reader's reply is one quiet line, with no cursor in it`);
  };
  // The cursor put in a field by a press, as the person puts it there.
  const into = async (p, device, field) => {
    await centre(p, field);
    await press(p, device, field);
    await until(() => p.evaluate(`document.activeElement?.id === ${JSON.stringify(field.slice(1))}`), `${device}: the cursor is in ${field}`);
  };
  const valueOf = (p, field) => p.evaluate(`document.querySelector(${JSON.stringify(field)}).value`);
  // Each image row under a writing: its words, "name · state".
  const imageRows = (p, host) => p.evaluate(`[...document.querySelectorAll(${JSON.stringify(host + ' .image-choice')})].map(r=>r.firstElementChild.textContent)`);

  await check('reading the bar\'s 👍 and the card\'s 👍 count record a thumbs-up in Core, and pressing again takes it back', async () => {
    for (const device of Object.keys(DEVICES)) {
      const topic = 'reading-thumb-' + device;
      const ids = await seed(topic, [['plain', { sender: 'aim-core', join: true, addressees: [facts.actor], body: 'A plain message for you to thumb up.' }],
        ['next', { sender: 'aim-core', addressees: [facts.actor], body: 'Another message, newer.' }]]);
      const p = await open('reading-thumb-' + device, device, topic, ids.plain);
      const line = card(ids.plain) + ' > .message-reactions';
      const count = () => p.evaluate(`(()=>{const c=document.querySelector(${JSON.stringify(line)})?.querySelector('.reaction-count');return c?{text:c.textContent,mine:c.classList.contains('mine'),who:getComputedStyle(c.querySelector('.reaction-who')).display!=='none'}:null})()`);
      await light(p, device, ids.plain);
      assert.deepEqual(await bar(p), { thumb: 'false', reply: null, more: null }, device + ': 👍, Reply and ⋯; no ✅ 🚫 on a message that asks nothing');
      assert.equal(await count(), null, device + ': no count before anyone thumbs it');
      const thumb = async (on, how) => {
        await how();
        await until(async () => await thumbsBy(ids.plain, facts.actor) === (on ? 1 : 0), `${device}: Core holds the thumbs-up ${on ? 'on' : 'taken back'}`);
        await until(async () => on ? (await count())?.mine === true && (await bar(p))?.thumb === 'true' : await count() === null && (await bar(p))?.thumb === 'false',
          `${device}: the card and the bar show it ${on ? 'on' : 'taken back'}`);
      };
      const viaBar = () => press(p, device, `${BAR} [data-act=thumb]`);
      await thumb(true, viaBar);
      assert.match((await count()).text, /^👍 1/, device + ': the card counts one');
      // Where a pointer hovers, the count says how many and its title names who; on a phone the lit card's count names who.
      assert.equal((await count()).who, device === 'phone', device + ': names shown on the count only where nothing hovers');
      await shot(p, 'reading-thumb-' + device);
      await thumb(false, viaBar);
      await thumb(true, viaBar);
      if (device === 'phone') {
        // Where a finger presses, each of the bar's buttons is at least 44px each way.
        const sizes = await p.evaluate(`[...document.querySelectorAll('${BAR} button')].filter(b=>!b.hidden).map(b=>{const r=b.getBoundingClientRect();return [b.dataset.act,Math.round(r.width),Math.round(r.height)]})`);
        assert.ok(sizes.length === 3 && sizes.every(([, width, height]) => width >= 44 && height >= 44), `phone: the bar's buttons are 44px or more (${JSON.stringify(sizes)})`);
        // On a phone a tap on the count names who, as hover does; it does not take the thumbs-up back.
        const [taps, sent] = await p.evaluate('[window.taps, window.sent.length]');
        await tap(p, line + ' > .reaction-count');
        await until(() => p.evaluate(`window.taps === ${taps + 1}`), 'phone: the tap on the count is heard');
        assert.deepEqual(await p.evaluate(`window.sent.slice(${sent})`), [], 'phone: a tap on the count sends nothing');
        await until(async () => (await count())?.who === true && (await lit(p)).includes(ids.plain), 'phone: the lit card\'s count names who');
        assert.equal(await thumbsBy(ids.plain, facts.actor), 1, 'phone: a tap on the count leaves the thumbs-up on');
        assert.equal(await readerOn(p), null, 'phone: and opens nothing');
        await thumb(false, viaBar);
      } else {
        // A click on the card's own count takes it back, and the Reader stays shut.
        await thumb(false, () => p.point(line + ' > .reaction-count'));
        assert.equal(await readerOn(p), null, 'laptop: the count acts, and opens nothing');
      }
      assert.deepEqual(p.errors, []);
      await p.close();
    }
  });

  await check('reading ✅ and 🚫 on a go-ahead ask record the person\'s answer in Core and tell the agent by a reply', async () => {
    for (const device of Object.keys(DEVICES)) {
      const topic = 'reading-ask-' + device;
      const ids = await seed(topic, [['ask', { sender: 'aim-core', join: true, whole_topic: true, body: 'May I deploy release 32 now?',
        post_args: { addressees: [facts.actor], intent: 'ask', go_ahead: true } }]]);
      const p = await open('reading-ask-' + device, device, topic, ids.ask);
      const choices = card(ids.ask) + ' > .message-reactions';
      const answer = async () => (await reactions(ids.ask)).answers.filter(a => a.actor_id === facts.actor).map(a => a.answer);
      const replies = async () => (await view('topic_messages', { topic_id: topic, direction: 'before', limit: 20 })).items
        .filter(item => item.reply_to === ids.ask && item.author_id === facts.actor).map(item => [item.body, item.addressees]);
      assert.deepEqual(await p.evaluate(`[...document.querySelector(${JSON.stringify(card(ids.ask))}).querySelectorAll('[data-react]')].map(e=>[e.dataset.react,e.textContent])`),
        [['yes', '✅ Go ahead'], ['no', "🚫 Don't"]], device + ': the ask offers both answers on its card');
      await light(p, device, ids.ask);
      assert.deepEqual(await bar(p), { thumb: 'false', yes: 'false', no: 'false', reply: null, more: null }, device + ': and on its bar');
      // Laptop: the card's ✅, then the bar's 🚫. Phone: the bar's ✅, then the card's 🚫.
      const first = device === 'phone' ? `${BAR} [data-act=yes]` : `${choices} [data-react=yes]`;
      const second = device === 'phone' ? `${choices} [data-react=no]` : `${BAR} [data-act=no]`;
      await press(p, device, first);
      await until(async () => (await answer()).join() === 'yes', device + ': Core holds ✅');
      await until(async () => (await replies()).length === 1, device + ': the agent is told by a reply');
      assert.deepEqual(await replies(), [['✅ Go ahead', ['aim-core']]], device + ': ✅ Go ahead, to the agent that asked');
      const mine = () => p.evaluate(`document.querySelector(${JSON.stringify(choices + ' .mine')})?.dataset.react ?? null`);
      // The page shows each reply Core holds; a card moved under a resting pointer takes the light,
      // so the pointer comes to rest on the ask again (a finger's tap lights only when the ask is not lit: a second tap is a press).
      const relight = async () => {
        const said = (await view('topic_messages', { topic_id: topic, direction: 'before', limit: 20 })).items.filter(item => item.reply_to === ids.ask && item.author_id === facts.actor).map(item => item.id);
        await until(() => p.evaluate(`${JSON.stringify(said)}.every(id => document.querySelector('#messages [data-id="' + id + '"]'))`), device + ': the page shows each reply');
        if (device !== 'phone' || !(await lit(p)).includes(ids.ask)) await light(p, device, ids.ask);
      };
      await until(async () => await mine() === 'yes', device + ': the card shows ✅ as the answer');
      assert.equal(await readerOn(p), null, device + ': answering opens nothing');
      // The reply stacks under the ask, and the ask may move with its stack: once the page shows the reply, light it again where it now is.
      await relight();
      // Heading its stack now, the ask shows as one row, with no bar: a press on it shows the whole card, its answers and its bar too.
      if (!await p.evaluate(`document.querySelector(${JSON.stringify(choices)}).getClientRects().length > 0`)) {
        await press(p, device, card(ids.ask) + ' > .stack-head .stack-who');
        await until(() => p.evaluate(`document.querySelector(${JSON.stringify(choices)}).getClientRects().length > 0`), device + ': a press on the head shows the ask whole');
      }
      await until(async () => (await bar(p))?.yes === 'true' && (await bar(p))?.no === 'false', device + ': the bar shows ✅ as the answer');
      await shot(p, 'reading-ask-' + device);
      await press(p, device, second);
      await until(async () => (await answer()).join() === 'no', device + ': Core holds 🚫, the answer changed');
      await until(async () => (await replies()).length === 2, device + ': the agent is told again');
      assert.deepEqual((await replies()).map(([body]) => body).sort(), ['✅ Go ahead', "🚫 Don't (I changed my answer)"], device + ': the change is said');
      await until(async () => await mine() === 'no', device + ': the card shows 🚫');
      await relight();
      await until(async () => (await bar(p))?.no === 'true' && (await bar(p))?.yes === 'false', device + ': the bar shows 🚫');
      assert.equal(await readerOn(p), null, device + ': still nothing opened');
      assert.deepEqual(p.errors, []);
      await p.close();
    }
  });

  await check('reading ↑ and ↓ move the light, Return opens the Reader on the lit message with the cursor in the reply, and on a phone a first tap lights and a second opens', async () => {
    for (const device of Object.keys(DEVICES)) {
      const topic = 'reading-keys-' + device;
      const ids = await seed(topic, [['a', { sender: 'aim-core', join: true, addressees: [facts.actor], body: 'Message A, the oldest.' }],
        ['b', { sender: 'aim-core', addressees: [facts.actor], body: 'Message B, in the middle.' }],
        ['c', { sender: 'aim-core', addressees: [facts.actor], body: 'Message C, the newest.' }]]);
      const p = await open('reading-keys-' + device, device, topic, ids.a);
      if (device === 'laptop') {
        // Newest on top: C, B, A. The pointer rests on B, then leaves the list.
        await light(p, device, ids.b);
        await away(p);
        await p.evaluate('document.activeElement?.blur()');
        await p.key('ArrowDown');
        await until(async () => (await lit(p)).join() === ids.a, 'laptop: ↓ lights the message below, A');
        await p.key('ArrowUp'); await p.key('ArrowUp');
        await until(async () => (await lit(p)).join() === ids.c, 'laptop: ↑ ↑ light the message above, C');
        await p.key('ArrowDown');
        await until(async () => (await lit(p)).join() === ids.b, 'laptop: ↓ back to B');
        await p.key('Enter');
        await until(async () => (await readerOn(p))?.startsWith('Message B'), 'laptop: Return opens the Reader on B');
        await until(() => p.evaluate(`document.activeElement?.id === 'writing-body'`), 'laptop: the cursor is in the reply');
        assert.equal(await p.evaluate(`document.querySelector('#writing-body').value`), '', 'laptop: nothing quoted');
        await shot(p, 'reading-keys-laptop');
        await closeReader(p, device);
      } else {
        // Each tap's click, as the window first hears it, and each that reaches B's card, where its own handler opens it.
        await p.evaluate(`(()=>{window.taps=0;window.reached=0;document.querySelector(${JSON.stringify(card(ids.b))}).addEventListener('click',()=>{window.reached++})})()`);
        const clicks = () => p.evaluate('[window.taps, window.reached]');
        await centre(p, card(ids.b));
        await tap(p, words(ids.b));
        await until(async () => (await clicks())[0] === 1 && (await lit(p)).join() === ids.b && await bar(p) !== null, 'phone: a first tap lights B and shows its bar');
        assert.deepEqual(await clicks(), [1, 0], 'phone: the first tap\'s click never reaches the card, so it opens nothing');
        assert.equal(await readerOn(p), null, 'phone: and the Reader is shut');
        await tap(p, words(ids.b));
        await until(async () => (await readerOn(p))?.startsWith('Message B'), 'phone: a second tap opens B');
        assert.deepEqual(await clicks(), [2, 1], 'phone: the second tap\'s click reaches the card');
        await closeReader(p, device);
        // A tap on another card moves the light, and opens nothing; a tap outside any message lets it go.
        await centre(p, card(ids.a));
        await tap(p, words(ids.a));
        await until(async () => (await lit(p)).join() === ids.a, 'phone: a tap on A lights A');
        assert.equal(await readerOn(p), null, 'phone: a first tap on another card opens nothing');
        await p.evaluate(`scrollTo(0,0)`);
        await tap(p, '#topic-title');
        await until(async () => (await lit(p)).length === 0 && await bar(p) === null, 'phone: a tap outside the messages lets the light go');
      }
      assert.deepEqual(p.errors, []);
      await p.close();
    }
  });

  await check('reading a cut-off message scrolls in place under the wheel or a finger, and the page does not move', async () => {
    for (const device of Object.keys(DEVICES)) {
      const topic = 'reading-long-' + device;
      const body = Array.from({ length: 80 }, (_, i) => `Line ${i} of a long message that runs on past what a card shows.`).join('\n');
      const ids = await seed(topic, [['long', { sender: 'aim-ux', join: true, addressees: [facts.actor], body }],
        ...Array.from({ length: 6 }, (_, i) => ['after' + i, { sender: 'aim-core', join: i === 0, addressees: [facts.actor], body: 'A short message ' + i + '.' }])]);
      const p = await open('reading-long-' + device, device, topic, ids.long);
      const preview = card(ids.long) + ' > .message-preview';
      const state = () => p.evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(preview)}),s=getComputedStyle(e),b=e.getBoundingClientRect();
        return {inPlace:e.classList.contains('scroll-in-place'),top:e.scrollTop,more:e.scrollHeight-e.clientHeight,overflow:s.overflowY,height:b.height,window:innerHeight,pageY:scrollY}})()`);
      await centre(p, card(ids.long));
      const before = await state();
      assert.equal(before.inPlace, false, device + ': cut off, until it lights');
      await light(p, device, ids.long);
      await until(async () => (await state()).inPlace && (await state()).more > 100, device + ': lit, its words become a box holding the whole message');
      const box = await state();
      assert.equal(box.overflow, 'auto', device + ': the box scrolls');
      assert.ok(Math.abs(box.height - before.height) <= 1, `${device}: the box keeps the excerpt's height (${before.height} → ${box.height})`);
      if (device === 'phone') assert.ok(box.height <= box.window * 0.6 + 1, `phone: the box is no taller than 60% of the window (${box.height} of ${box.window})`);
      const wheel = async deltaY => { const [x, y] = await within(p, preview); await p.send('Input.dispatchMouseEvent', { type: 'mouseWheel', x, y, deltaX: 0, deltaY }); };
      const drag = async (yDistance, speed) => { const [x, y] = await within(p, preview); await p.send('Input.synthesizeScrollGesture', { x, y, yDistance, gestureSourceType: 'touch', speed }); };
      if (device === 'laptop') {
        await wheel(240);
        await until(async () => (await state()).top > 0, 'laptop: the wheel scrolls the box');
        assert.equal((await state()).pageY, box.pageY, 'laptop: and not the page');
        // At its bottom edge the same wheel carries on with the page, and the box's fade says nothing more is below.
        const more = () => p.evaluate(`document.querySelector(${JSON.stringify(preview)}).dataset.more`);
        await until(async () => await more() === 'both', 'laptop: part way down, more is hidden both ways (the box hears its own scroll)');
        await wheel(box.more + 400);
        await until(async () => await more() === 'above', 'laptop: at the bottom of the box only what is above is hidden');
        const atEdge = await state();
        await wheel(240);
        await until(async () => (await state()).pageY > atEdge.pageY, 'laptop: at the box\'s edge the wheel scrolls the page on');
      } else if ('pw' in p) {
        // Safari's engine in this harness has a tap but no finger drag: the box is held to scroll (overflow auto, above) and to leave room beside it.
        observations.push({ name: 'reading finger drag', engine: 'webkit', held: 'overflow-y auto and at most 60% of the window; no drag in this harness' });
      } else {
        await drag(-240, 1200);
        await until(async () => (await state()).top > 0, 'phone: a finger drag inside scrolls the box');
        assert.equal((await state()).pageY, box.pageY, 'phone: and not the page');
        // Beside the card, above it or below it, where the page shows.
        const at = await p.box(card(ids.long)), outsideY = at.y > 60 ? at.y / 2 : Math.min(at.y + at.height + (at.viewportHeight - at.y - at.height) / 2, at.viewportHeight - 10);
        assert.ok(outsideY < at.y || outsideY > at.y + at.height, 'phone: a point outside the card');
        await p.send('Input.synthesizeScrollGesture', { x: at.x + at.width / 2, y: outsideY, yDistance: -240, gestureSourceType: 'touch', speed: 1200 });
        await until(async () => (await state()).pageY !== box.pageY, 'phone: a drag outside it scrolls the page');
        // Dragged inside to its bottom edge, the next drag inside carries on with the page.
        await drag(-(box.more + 400), 2400);
        await until(async () => (await state()).top >= (await state()).more - 1, 'phone: a long drag inside takes the box to its bottom edge');
        const atEnd = await state();
        await drag(-200, 1200);
        await until(async () => (await state()).pageY > atEnd.pageY, 'phone: at the box\'s edge a drag inside scrolls the page on');
      }
      await shot(p, 'reading-long-' + device);
      assert.deepEqual(p.errors, []);
      await p.close();
    }
  });

  await check('reading ? and the rail\'s "? Pointer, keys and taps" open the guide, and ? in the writing opens none', async () => {
    for (const device of Object.keys(DEVICES)) {
      const topic = 'reading-guide-' + device;
      const ids = await seed(topic, [['m', { sender: 'aim-core', join: true, addressees: [facts.actor], body: 'A message to open.' }]]);
      const p = await open('reading-guide-' + device, device, topic, ids.m);
      const guide = () => p.evaluate(`(()=>{const d=document.querySelector('dialog.interaction-guide');return d?{open:d.open,title:d.querySelector('h2').textContent,rules:d.querySelectorAll('dt').length}:null})()`);
      const shut = async () => {
        await press(p, device, 'dialog.interaction-guide [aria-label=Close]');
        await until(async () => (await guide())?.open === false, device + ': ✕ closes the guide');
      };
      if (device === 'laptop') {
        await p.evaluate('document.activeElement?.blur()');
        await p.key('?');
        await until(async () => (await guide())?.open === true, 'laptop: ? opens the guide');
        assert.deepEqual(await guide(), { open: true, title: 'Pointer, keys and taps', rules: 15 }, 'laptop: the guide, every rule');
        await shot(p, 'reading-guide-laptop');
        await p.key('Escape');
        await until(async () => (await guide())?.open === false, 'laptop: Escape closes it');
        // In the topic's composer, ? is the writing's, not the guide's.
        await into(p, device, '#inline-writing-body');
        await p.key('?');
        await p.evaluate('new Promise(done=>requestAnimationFrame(()=>requestAnimationFrame(done)))');
        assert.equal((await guide()).open, false, 'laptop: ? in the composer opens no guide');
        assert.equal(await p.evaluate(`document.activeElement?.id`), 'inline-writing-body', 'laptop: the cursor stays in the composer');
        await p.evaluate('document.activeElement?.blur()');
        // In the reply too.
        await light(p, device, ids.m);
        await p.key('Enter');
        await until(() => p.evaluate(`document.activeElement?.id === 'writing-body'`), 'laptop: the cursor is in the reply');
        await p.key('?');
        await p.evaluate('new Promise(done=>requestAnimationFrame(()=>requestAnimationFrame(done)))');
        assert.equal((await guide()).open, false, 'laptop: ? in the reply opens no guide');
        assert.equal(await p.evaluate(`document.activeElement?.id`), 'writing-body', 'laptop: the cursor stays in the reply');
        await closeReader(p, device);
        await p.point('.guide-open');
      } else {
        await tap(p, '#rail-open');
        await until(() => p.evaluate(`document.querySelector('.guide-open')?.getClientRects().length > 0`), 'phone: "☰ Topics" shows the guide\'s way in');
        await tap(p, '.guide-open');
      }
      await until(async () => (await guide())?.open === true, device + ': the rail\'s "? Pointer, keys and taps" opens the guide');
      if (device === 'phone') await shot(p, 'reading-guide-phone');
      await shut();
      assert.deepEqual(p.errors, []);
      await p.close();
    }
  });

  await check('reading read cards sit back on the read fill, talk between agents is dimmed until pressed, and a card opened reads as read', async () => {
    for (const device of Object.keys(DEVICES)) {
      const topic = 'reading-look-' + device;
      const ids = await seed(topic, [['said', { sender: 'fixture-other-person', join: true, addressees: [facts.actor], body: 'Another person\'s message, read already.' }],
        ['old', { sender: 'aim-core', join: true, addressees: [facts.actor], body: 'An older message, read already.', read: true }],
        ['talk', { sender: 'aim-ux', join: true, addressees: ['aim-core'], body: 'aim-ux to aim-core only: talk between agents.' }],
        ['fresh', { sender: 'aim-core', addressees: [facts.actor], body: 'A new message, not read yet.' }]]);
      const p = await open('reading-look-' + device, device, topic, ids.fresh);
      const look = id => p.evaluate(`(()=>{const c=document.querySelector(${JSON.stringify(card(id))});return {read:c.hasAttribute('data-read'),fill:getComputedStyle(c).backgroundColor}})()`);
      // The fills the design gives: --read-card under a person's card, and an agent's tint mixed toward it under an agent's.
      const fill = (background, within) => p.evaluate(`(()=>{const d=document.createElement('div');d.className=${JSON.stringify(within)};d.style.background=${JSON.stringify(background)};
        document.body.append(d);const c=getComputedStyle(d).backgroundColor;d.remove();return c})()`);
      const tint = await p.evaluate(`[...document.querySelector(${JSON.stringify(card(ids.old))}).classList].find(c=>/^agent-(?!card$)/.test(c))`);
      const readFill = await fill('var(--read-card)', ''), agentRead = await fill('color-mix(in srgb,var(--agent-card) var(--read-tint),var(--read-card))', tint);
      if (device === 'laptop') await away(p);
      const said = await look(ids.said), old = await look(ids.old), fresh = await look(ids.fresh);
      assert.deepEqual([said.read, old.read, fresh.read], [true, true, false], device + ': read, and not read, as the topic opened');
      assert.equal(said.fill, readFill, device + ': another person\'s read card sits on the read fill');
      assert.equal(old.fill, agentRead, device + ': an agent\'s read card keeps a share of its tint over the read fill');
      assert.notEqual(fresh.fill, agentRead, device + ': an unread card does not');
      // Talk between agents: one quiet line, dimmed; pressed, it wakes for the visit.
      const line = entry(ids.talk) + ' > .fold-line';
      const dim = () => p.evaluate(`(()=>{const f=document.querySelector(${JSON.stringify(entry(ids.talk))});return {talk:f.dataset.talk,woken:'woken' in f.dataset,opacity:Number(getComputedStyle(f.querySelector('.fold-line')).opacity)}})()`);
      await centre(p, line);
      if (device === 'laptop') await away(p);
      await until(async () => (await dim()).opacity < 0.7, device + ': talk between agents is dimmed');
      assert.equal((await dim()).talk, 'agents');
      await shot(p, 'reading-look-' + device);
      await press(p, device, line);
      await until(async () => (await dim()).woken, device + ': pressed, it wakes');
      // The light moves on to the new card; the woken line stays at full strength, unlit and unfocused.
      await light(p, device, ids.fresh);
      if (device === 'laptop') await away(p);
      await p.evaluate('document.activeElement?.blur()');
      await until(async () => !(await lit(p)).includes(ids.talk) && (await dim()).opacity === 1, device + ': and stays awake for the visit');
      // Opened in the Reader, the new card reads as read at once.
      if (device === 'laptop') await p.point(words(ids.fresh)); else await tap(p, words(ids.fresh));
      await until(async () => (await readerOn(p))?.startsWith('A new message'), device + ': the new card opens');
      await closeReader(p, device);
      await until(async () => (await look(ids.fresh)).read, device + ': opened, it reads as read');
      if (device === 'laptop') await away(p);
      assert.equal((await look(ids.fresh)).fill, agentRead, device + ': on the read fill');
      assert.deepEqual(p.errors, []);
      await p.close();
    }
  });

  await check('reading the reply arrow says "You replied at" and opens the reply; on a phone a first tap says it and a second opens it', async () => {
    for (const device of Object.keys(DEVICES)) {
      const topic = 'reading-replied-' + device;
      // The message replied to is itself a reply, so it shows whole inside its stack (a head shows as one row).
      const ids = await seed(topic, [['root', { sender: 'aim-core', join: true, addressees: [facts.actor], body: 'The stack\'s first message.' }],
        ['answered', { sender: 'aim-core', reply_to: 'root', addressees: [facts.actor], body: 'A message you will reply to.' }],
        ['mine', { sender: 'person', reply_to: 'answered', addressees: ['aim-core'], body: 'My reply to it.' }],
        ['other', { sender: 'aim-core', addressees: [facts.actor], body: 'A message you have not replied to.' }]]);
      const p = await open('reading-replied-' + device, device, topic, ids.root);
      // Replied to, it reads as read and folds behind the stack's line, under the newest reply (the person's own): the line opens it.
      const unfold = async (q, head, id) => {
        const line = `#messages .reply-stack[data-stack="${head}"] .stack-toggle`;
        await centre(q, line);
        await press(q, device, line);
        await until(() => q.evaluate(`document.querySelector(${JSON.stringify(card(id))}).getClientRects().length > 0`), `${device}: the stack's line opens the reply`);
      };
      await unfold(p, ids.root, ids.answered);
      const arrow = card(ids.answered) + ' .replied-mark';
      const said = () => p.evaluate(`(()=>{const a=document.querySelector(${JSON.stringify(arrow)}),w=a.querySelector('.replied-words');return {words:w.textContent,shown:Number(getComputedStyle(w).opacity),reply:a.dataset.reply}})()`);
      assert.equal(await p.evaluate(`document.querySelector(${JSON.stringify(card(ids.other))}).querySelector('.replied-mark')`), null, device + ': no arrow on a message not replied to');
      await centre(p, arrow);
      assert.equal((await said()).reply, ids.mine, device + ': the arrow goes to the reply');
      assert.match((await said()).words, /^You replied at \d{1,2}:\d{2}/, device + ': it says when');
      if (device === 'laptop') {
        await away(p);
        await until(async () => (await said()).shown === 0, 'laptop: the words are hidden until the pointer comes');
        await p.point(arrow, 'move');
        await until(async () => (await said()).shown === 1, 'laptop: under the pointer it says "You replied at"');
        await shot(p, 'reading-replied-laptop');
        await p.point(arrow);
      } else {
        await tap(p, arrow);
        await until(async () => (await said()).shown === 1, 'phone: a first tap says "You replied at"');
        assert.equal(await readerOn(p), null, 'phone: and opens nothing');
        await shot(p, 'reading-replied-phone');
        // A tap elsewhere puts the words away; the next first tap says them again.
        await tap(p, words(ids.other));
        await until(async () => (await said()).shown === 0, 'phone: a tap elsewhere puts the words away');
        await centre(p, arrow);
        await tap(p, arrow);
        await until(async () => (await said()).shown === 1, 'phone: a first tap says it again');
        assert.equal(await readerOn(p), null, 'phone: still nothing opened');
        await tap(p, arrow);
      }
      await until(async () => (await readerOn(p))?.startsWith('My reply to it.'), device + ': the reply opens in the Reader');
      assert.deepEqual(p.errors, []);
      await p.close();
      // Lit, a card's bar sits clear of its reply arrow, even where a long name puts the arrow under the bar's corner.
      const far = await seed(topic + '-long', [['first', { sender: 'fixture-notebook-agent', join: true, addressees: [facts.actor], body: 'The stack\'s first message.' }],
        ['long', { sender: 'fixture-notebook-agent', reply_to: 'first', addressees: [facts.actor], body: 'A long name puts the arrow far along its line.' }],
        ['also', { sender: 'person', reply_to: 'long', addressees: ['fixture-notebook-agent'], body: 'My reply to the long name.' }]]);
      const q = await open('reading-replied-long-' + device, device, topic + '-long', far.first);
      await unfold(q, far.first, far.long);
      await light(q, device, far.long);
      const covers = await q.evaluate(`(()=>{const b=document.querySelector('${BAR}').getBoundingClientRect(),m=document.querySelector(${JSON.stringify(card(far.long) + ' .replied-mark')}).getBoundingClientRect();
        return b.right>m.left&&b.left<m.right&&b.bottom>m.top&&b.top<m.bottom})()`);
      assert.equal(covers, false, device + ': the bar does not cover the reply arrow');
      assert.deepEqual(q.errors, []);
      await q.close();
    }
  });

  await check('reading the save status says when the writing was saved, "Saved to Theseus · 4:40 AM", in the topic\'s composer and in the Reader', async () => {
    for (const device of Object.keys(DEVICES)) {
      const topic = 'reading-saved-' + device;
      const ids = await seed(topic, [['m', { sender: 'aim-core', join: true, addressees: [facts.actor], body: 'A message to answer.' }]]);
      const p = await open('reading-saved-' + device, device, topic, ids.m);
      // A save status and the time beside it: the status's words, the time's words, when it was, and the words
      // the page should give that time now (the time alone today, "Yesterday" and the time if midnight has passed).
      const beside = status => p.evaluate(`(()=>{const s=document.querySelector(${JSON.stringify(status)}),t=s.parentElement.querySelector(':scope > time.save-time');
        if(!t)return {status:s.textContent,time:null};const ms=Number(t.dataset.ms),at=new Date(ms),now=new Date(),day=d=>new Date(d.getFullYear(),d.getMonth(),d.getDate()).getTime();
        const hours=at.toLocaleTimeString('en-US',{hour:'numeric',minute:'2-digit'}),a=s.getBoundingClientRect(),b=t.getBoundingClientRect();
        return {status:s.textContent,time:t.textContent,ms,expected:day(at)===day(now)?hours:'Yesterday '+hours,after:s.nextElementSibling===t,
          line:b.width>0&&b.height>0&&b.top<a.bottom&&a.top<b.bottom&&b.left>=a.right-1,shown:getComputedStyle(t).display!=='none'&&getComputedStyle(t).visibility==='visible'}})()`);
      // Writes into a field, and returns the time shown once Theseus holds what was written.
      const write = async (where, field, status, text) => {
        const since = await p.evaluate('Date.now()');
        await centre(p, field);
        await press(p, device, field);
        await until(() => p.evaluate(`document.activeElement?.id === ${JSON.stringify(field.slice(1))}`), `${device} ${where}: the cursor is in the writing`);
        await p.send('Input.insertText', { text });
        await until(async () => { const b = await beside(status); return b.status === 'Saved to Theseus' && b.time !== null && b.ms >= since; },
          `${device} ${where}: "Saved to Theseus" with the time of this save beside it`);
        const until_ = await p.evaluate('Date.now()'), shown = await beside(status);
        assert.ok(shown.ms >= since && shown.ms <= until_, `${device} ${where}: the time is when this save happened`);
        assert.equal(shown.time, shown.expected, `${device} ${where}: the time reads as the page's times do`);
        assert.match(shown.time, /^(Yesterday )?\d{1,2}:\d{2} [AP]M$/, `${device} ${where}: a readable time`);
        assert.deepEqual([shown.after, shown.line, shown.shown], [true, true, true], `${device} ${where}: the time shows right after the words, on their line`);
        return shown;
      };
      // The topic's composer: no time before this page has seen a save; one after; a later save moves it.
      assert.equal((await beside('#inline-save-state')).time, null, device + ' composer: no time before a save');
      const first = await write('composer', '#inline-writing-body', '#inline-save-state', 'A new message, saved.');
      const again = await write('composer', '#inline-writing-body', '#inline-save-state', ' And more.');
      assert.ok(again.ms > first.ms, device + ' composer: a later save moves the time');
      await shot(p, 'reading-saved-composer-' + device);
      // The Reader, opened on the message. The cursor leaves the composer first, or Return is the composer's.
      await p.evaluate('document.activeElement?.blur()');
      if (device === 'laptop') { await light(p, device, ids.m); await p.key('Enter'); }
      else { await centre(p, card(ids.m)); await tap(p, words(ids.m)); await until(async () => (await lit(p)).includes(ids.m), 'phone: the message lights'); await tap(p, words(ids.m)); }
      await until(async () => (await readerOn(p))?.startsWith('A message to answer.'), device + ': the Reader opens on the message');
      assert.equal((await beside('#save-state')).time, null, device + ' Reader: no time before its reply is saved');
      await write('Reader', '#writing-body', '#save-state', 'A reply, saved.');
      await shot(p, 'reading-saved-reader-' + device);
      await closeReader(p, device);
      assert.deepEqual(p.errors, []);
      await p.close();
    }
  });

  await check('reading 👍 in the Reader beside Send records a thumbs-up in Core, and a second press takes it back', async () => {
    for (const device of Object.keys(DEVICES)) {
      const topic = 'reading-reader-thumb-' + device;
      const ids = await seed(topic, [['theirs', { sender: 'aim-core', join: true, addressees: [facts.actor], body: 'A message to thumb up in the Reader.' }],
        ['mine', { sender: 'person', addressees: ['aim-core'], body: 'My own message.' }]]);
      const p = await open('reading-reader-thumb-' + device, device, topic, ids.theirs);
      // 👍 as it shows, or null: its words, whether it is pressed, what follows it, and whether it is whole,
      // under nothing at its middle and clear of Send's left edge when Send shows.
      const button = () => p.evaluate(`(()=>{const b=document.querySelector('#thumb-source'),s=document.querySelector('#send-reply');if(b.hidden||!b.getClientRects().length)return null;
        const r=b.getBoundingClientRect(),t=s.getClientRects().length?s.getBoundingClientRect():null;
        return {text:b.textContent,pressed:b.getAttribute('aria-pressed'),beside:b.nextElementSibling?.id,clear:b.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2))&&(!t||r.right<=t.left)}})()`);
      await openReader(p, device, ids.theirs, 'A message to thumb up');
      // Return on a laptop puts the cursor in the reply, which is then writing,
      // with nothing written: 👍 is beside Send there too, not only on the quiet line.
      const state = () => p.evaluate(`({composer:document.querySelector('#reader-composer').dataset.compose,focus:document.activeElement?.id,words:document.querySelector('#writing-body').value})`);
      if (device === 'laptop') assert.deepEqual(await state(), { composer: 'writing', focus: 'writing-body', words: '' }, 'laptop: Return leaves the cursor in an empty reply');
      assert.deepEqual(await button(), { text: '👍', pressed: 'false', beside: 'send-reply', clear: true }, device + ': 👍 beside Send');
      // Given, the 👍 closes the Reader once Core holds it (the next check); opened again by a click, it shows
      // given and counted, and a second press takes it back with the Reader open.
      await closeReader(p, device);
      await readerByClick(p, device, ids.theirs, 'A message to thumb up');
      await press(p, device, '#thumb-source');
      await until(async () => await thumbsBy(ids.theirs, facts.actor) === 1, `${device}: Core holds the thumbs-up`);
      await until(async () => await readerOn(p) === null, `${device}: the 👍 closes the Reader`);
      await readerByClick(p, device, ids.theirs, 'A message to thumb up');
      await until(async () => (await button())?.pressed === 'true', `${device}: opened again, the Reader's 👍 shows it on`);
      assert.equal((await button()).text, '👍 1', device + ': and counts it');
      await press(p, device, '#thumb-source');
      await until(async () => await thumbsBy(ids.theirs, facts.actor) === 0, `${device}: Core holds the thumbs-up taken back`);
      await until(async () => (await button())?.pressed === 'false', `${device}: the Reader's 👍 shows it taken back`);
      assert.deepEqual([(await button()).text, await readerOn(p) !== null], ['👍', true], device + ': and counts it, with the Reader still open');
      // In the reply, writing and still empty, 👍 stays beside Send; it goes once a word is
      // typed, while Send can send it.
      await into(p, device, '#writing-body');
      await until(async () => (await state()).composer === 'writing', `${device}: the reply is writing`);
      assert.deepEqual(await button(), { text: '👍', pressed: 'false', beside: 'send-reply', clear: true }, device + ': writing an empty reply, 👍 beside Send');
      await p.send('Input.insertText', { text: 'Thanks' });
      await until(async () => await button() === null, `${device}: 👍 goes once a word is typed`);
      assert.equal(await p.evaluate(`(s=>s.disabled||s.getAttribute('aria-disabled')==='true')(document.querySelector('#send-reply'))`), false, device + ': with a word written Send can send it');
      if (device === 'phone') await shot(p, 'reading-reader-thumb-phone');
      // Each letter taken back with Backspace, the reply is empty again, as before a word was typed:
      // 👍 is back beside Send, the reply holds nothing, and that is what Theseus keeps.
      const empty = () => p.evaluate(`(()=>{const c=document.querySelector('#reader-composer');return {composer:c.dataset.compose,words:document.querySelector('#writing-body').value,
        writing:c.hasAttribute('data-has-writing'),draft:!document.querySelector('#draft-tag').hidden}})()`);
      for (let n = 'Thanks'.length; n > 0; n--) await p.key('Backspace');
      await until(async () => await valueOf(p, '#writing-body') === '', `${device}: Backspace takes every letter back`);
      await until(async () => (await button()) !== null, `${device}: emptied, 👍 comes back`);
      assert.deepEqual(await button(), { text: '👍', pressed: 'false', beside: 'send-reply', clear: true }, device + ': emptied, 👍 is beside Send again');
      assert.deepEqual(await empty(), { composer: 'writing', words: '', writing: false, draft: false }, device + ': the emptied reply holds nothing');
      await until(() => p.evaluate(`document.querySelector('#save-state').textContent === 'Saved to Theseus'`), `${device}: the emptied reply is saved`);
      await closeReader(p, device);
      // Opened again, and on a new page, the reply is still empty and 👍 still shows, with no Draft on the line.
      const shown = { text: '👍', pressed: 'false', beside: 'send-reply', clear: true };
      const unwritten = device === 'laptop' ? { composer: 'writing', words: '', writing: false, draft: false } : { composer: 'line', words: '', writing: false, draft: false };
      await openReader(p, device, ids.theirs, 'A message to thumb up');
      assert.deepEqual([await button(), await empty()], [shown, unwritten], device + ': opened again, the reply is empty and 👍 shows');
      await closeReader(p, device);
      // The person's own message offers no 👍.
      await openReader(p, device, ids.mine, 'My own message.');
      assert.equal(await button(), null, device + ': no 👍 on the person\'s own message');
      await closeReader(p, device);
      assert.deepEqual(p.errors, []);
      await p.close();
      const q = await open('reading-reader-thumb-again-' + device, device, topic, ids.theirs);
      await openReader(q, device, ids.theirs, 'A message to thumb up');
      assert.deepEqual(await q.evaluate(`(()=>{const b=document.querySelector('#thumb-source'),c=document.querySelector('#reader-composer');
        return {thumb:!b.hidden&&b.getClientRects().length>0,composer:c.dataset.compose,writing:c.hasAttribute('data-has-writing'),draft:!document.querySelector('#draft-tag').hidden}})()`),
        { thumb: true, composer: unwritten.composer, writing: false, draft: false }, device + ': on a new page, the reply is empty and 👍 shows');
      await closeReader(q, device);
      assert.deepEqual(q.errors, []);
      await q.close();
    }
  });

  await check('reading 👍 given in the Reader closes it as Send does, on its quiet line or with the cursor in the reply, keeping what the reply holds; taken back or refused, it stays open', async () => {
    for (const device of Object.keys(DEVICES)) {
      const topic = 'reading-thumb-close-' + device;
      const ids = await seed(topic, [['theirs', { sender: 'aim-core', join: true, addressees: [facts.actor], body: 'A message to answer with a thumbs-up.' }]]);
      const p = await open('reading-thumb-close-' + device, device, topic, ids.theirs);
      const reader = () => p.evaluate(`(()=>{const n=document.querySelector('#reader-notice');return {open:document.querySelector('#reader').open,composer:document.querySelector('#reader-composer').dataset.compose,
        chip:document.querySelector('#who-chip').textContent,thumb:document.querySelector('#thumb-source').getAttribute('aria-pressed'),notice:n.hidden?'':n.textContent}})()`);
      // Opened to be read, by a click or a phone's second tap, the cursor never in the reply: the quiet line's 👍.
      await readerByClick(p, device, ids.theirs, 'A message to answer');
      // Refused there, the Reader stays open on its quiet line and says why.
      assert.equal((await reader()).notice, '', device + ': the Reader opens saying nothing');
      await p.evaluate('window.staleThumb = true');
      await press(p, device, '#thumb-source');
      await until(async () => (await reader()).notice !== '', device + ': on the quiet line, the refusal is said in the Reader');
      assert.equal(await thumbsBy(ids.theirs, facts.actor), 0, device + ': Core holds no thumbs-up');
      assert.deepEqual({ ...(await reader()), notice: undefined, chip: undefined }, { open: true, composer: 'line', chip: undefined, thumb: 'false', notice: undefined },
        device + ': refused on the quiet line, the Reader stays open as it was');
      // Given there, Core holds it and the Reader closes, as after Send.
      await press(p, device, '#thumb-source');
      await until(async () => await thumbsBy(ids.theirs, facts.actor) === 1, device + ': Core holds the quiet line\'s thumbs-up');
      await until(async () => await readerOn(p) === null, device + ': the quiet line\'s 👍 closes the Reader, as Send does');
      // Opened again the same way, it shows given; taken back on the quiet line, the Reader stays.
      await readerByClick(p, device, ids.theirs, 'A message to answer');
      await until(async () => (await reader()).thumb === 'true', device + ': opened again, 👍 shows given');
      await press(p, device, '#thumb-source');
      await until(async () => await thumbsBy(ids.theirs, facts.actor) === 0, device + ': the 👍 on the quiet line is taken back');
      await until(async () => (await reader()).thumb === 'false', device + ': and shows taken back');
      assert.deepEqual([await readerOn(p) !== null, (await reader()).composer], [true, 'line'], device + ': taking it back leaves the Reader open on its quiet line');
      await closeReader(p, device);
      // With the cursor in the reply: on a laptop Return leaves it there; on a phone the reply opens with a tap in it.
      await openReader(p, device, ids.theirs, 'A message to answer');
      if (device === 'phone') await into(p, device, '#writing-body');
      await until(async () => (await reader()).composer === 'writing', device + ': the reply is open');
      // What the reply holds, with nothing written, so 👍 still shows: it goes as a whisper.
      await press(p, device, '#who-chip');
      await until(() => p.evaluate(`!document.querySelector('#who-panel').hidden`), device + ': the who panel opens');
      await press(p, device, '#who-panel [data-intent="whisper"]');
      await until(async () => (await reader()).chip.startsWith('Whisper to aim-core'), device + ': the chip says the reply is a whisper');
      await press(p, device, '#who-done');
      await until(async () => (await reader()).composer === 'writing' && await p.evaluate(`document.querySelector('#who-panel').hidden && !document.querySelector('#thumb-source').hidden`),
        device + ': the panel is put away, the reply still open, 👍 beside Send');
      const chip = (await reader()).chip;
      // Refused: the 👍 goes fenced on a revision Core does not hold, and Core says no.
      assert.equal((await reader()).notice, '', device + ': the reopened Reader says nothing');
      await p.evaluate('window.staleThumb = true');
      await press(p, device, '#thumb-source');
      await until(async () => (await reader()).notice !== '', device + ': the refusal is said in the Reader');
      assert.equal(await thumbsBy(ids.theirs, facts.actor), 0, device + ': Core holds no thumbs-up');
      const refused = await reader();
      assert.deepEqual({ ...refused, notice: undefined }, { open: true, composer: 'writing', chip, thumb: 'false', notice: undefined }, device + ': refused, the Reader and its reply stay open as they were');
      // Given: Core holds it, and the Reader closes as after Send.
      await press(p, device, '#thumb-source');
      await until(async () => await thumbsBy(ids.theirs, facts.actor) === 1, device + ': Core holds the thumbs-up');
      await until(async () => await readerOn(p) === null, device + ': the 👍 closes the Reader, as Send does');
      // Opened again, the reply holds what it held, and the 👍 shows given.
      await openReader(p, device, ids.theirs, 'A message to answer');
      await until(async () => (await reader()).thumb === 'true', device + ': opened again, 👍 shows given');
      assert.equal((await reader()).chip, chip, device + ': and the reply is still a whisper');
      // Taken back with the cursor in the reply, the Reader and its reply stay open.
      if (device === 'phone') { assert.equal((await reader()).composer, 'line', 'phone: opened to be read, the reply is one quiet line'); await into(p, device, '#writing-body'); }
      await until(async () => (await reader()).composer === 'writing', device + ': the reply is open again');
      await press(p, device, '#thumb-source');
      await until(async () => await thumbsBy(ids.theirs, facts.actor) === 0, device + ': the 👍 is taken back');
      await until(async () => (await reader()).thumb === 'false', device + ': and shows taken back');
      assert.deepEqual([await readerOn(p) !== null, (await reader()).composer], [true, 'writing'], device + ': taking it back leaves the Reader and its reply open');
      await closeReader(p, device);
      assert.deepEqual(p.errors, []);
      await p.close();
    }
  });

  await check('reading a 👍 on an unread message reads that message at once, here and on another page, with the counts and the New line, and the messages around it stay unread', async () => {
    const topic = 'reading-thumb-read';
    const ids = await seed(topic, [['a', { sender: 'aim-core', join: true, addressees: [facts.actor], body: 'Message A, the oldest, unread.' }],
      ['b', { sender: 'aim-core', addressees: [facts.actor], body: 'Message B, unread, to thumb up.' }],
      ['c', { sender: 'aim-core', addressees: [facts.actor], body: 'Message C, the newest, unread.' }]]);
    const name = Object.fromEntries(Object.entries(ids).map(([key, id]) => [id, key]));
    // Both pages hold their reports of reading on screen, so only the 👍 reads anything. A page behind another
    // catches up when it is shown, so each page is brought to the front before it acts or is read.
    const hold = 'window.holdReads = true';
    const p = await open('reading-thumb-read', 'laptop', topic, ids.a, hold);
    const q = await open('reading-thumb-read-other', 'laptop', topic, ids.a, hold);
    // What Core holds unread for the person in the topic, oldest first.
    const unread = async () => (await view('topic_messages', { topic_id: topic, direction: 'before', limit: 20 })).items.filter(item => item.unread).map(item => name[item.id]).sort();
    // How a page shows it: each card read or not, the New line (under which message, faded), the tab's total and the topic's row.
    const looks = pg => pg.evaluate(`(()=>{const ids=${JSON.stringify(ids)},read={};for(const [k,id] of Object.entries(ids))read[k]=document.querySelector('#messages .message-card[data-id="'+id+'"]').hasAttribute('data-read');
      const l=document.querySelector('#messages .new-line'),prev=l?.previousElementSibling,under=prev?.dataset.id??prev?.querySelector('[data-id]')?.dataset.id??null;
      const row=document.querySelector('#outline a[data-topic-id=${JSON.stringify(topic)}]'),badge=row?.querySelector('.unread-count');
      return {read,line:l?{under:Object.entries(ids).find(([,id])=>id===under)?.[0]??under,faded:l.classList.contains('new-line-read')}:null,
        total:Number(/^\\((\\d+)\\) /.exec(document.title)?.[1]??0),row:row?Number(badge?.textContent??0):null}})()`);
    assert.deepEqual(await unread(), ['a', 'b', 'c'], 'all three unread to begin with');
    await p.send('Page.bringToFront');
    const before = await looks(p);
    assert.deepEqual({ ...before, total: undefined }, { read: { a: false, b: false, c: false }, line: { under: 'a', faded: false }, total: undefined, row: 3 }, 'the page shows all three unread, the New line under A');
    const total = before.total;
    await q.send('Page.bringToFront');
    await becomes(async () => ({ ...await looks(q), total: undefined }), { ...before, total: undefined }, 'the other page shows the same');
    await p.send('Page.bringToFront');
    const thumb = async id => { await light(p, 'laptop', id); await press(p, 'laptop', `${BAR} [data-act=thumb]`); };
    await thumb(ids.b);
    await until(async () => await thumbsBy(ids.b, facts.actor) === 1, 'Core holds the thumbs-up on B');
    assert.deepEqual(await unread(), ['a', 'c'], 'Core reads B alone: A and C stay unread');
    const one = { read: { a: false, b: true, c: false }, line: { under: 'a', faded: false }, total: total - 1, row: 2 };
    await becomes(() => looks(p), one, 'B reads as read at once, the counts drop by one, and the New line holds under A, still unread');
    await q.send('Page.bringToFront');
    await becomes(() => looks(q), one, 'the other page shows the same, with no reload');
    await p.send('Page.bringToFront');
    // A 👍 on A, the message the line is under: the line goes under the oldest message still unread.
    await thumb(ids.a);
    await until(async () => (await unread()).join() === 'c', 'Core reads A too: only C is unread');
    await becomes(() => looks(p), { read: { a: true, b: true, c: false }, line: { under: 'c', faded: false }, total: total - 2, row: 1 }, 'here the New line moves under C, as a Mark read places it');
    await q.send('Page.bringToFront');
    await becomes(() => looks(q), { read: { a: true, b: true, c: false }, line: { under: 'a', faded: false }, total: total - 2, row: 1 }, 'elsewhere the line stays where it was, holding C above it');
    // Taking the 👍 off B, on the other page, leaves it read; a 👍 act that read nothing moves no New line there.
    await light(q, 'laptop', ids.b);
    await until(() => q.evaluate(`document.querySelector('${BAR} [data-act=thumb]').getAttribute('aria-pressed') === 'true'`), 'the other page\'s bar shows B thumbed up');
    await press(q, 'laptop', `${BAR} [data-act=thumb]`);
    await until(async () => await thumbsBy(ids.b, facts.actor) === 0, 'Core holds the thumbs-up on B taken back');
    await until(() => q.evaluate(`document.querySelector('${BAR} [data-act=thumb]').getAttribute('aria-pressed') === 'false'`), 'the bar shows it taken back');
    assert.deepEqual(await unread(), ['c'], 'taken back, B is still read in Core');
    await front(p);
    await until(() => p.evaluate(`!document.querySelector(${JSON.stringify(card(ids.b) + ' > .message-reactions')})`), 'this page hears the 👍 taken back');
    assert.deepEqual(await looks(q), { read: { a: true, b: true, c: false }, line: { under: 'a', faded: false }, total: total - 2, row: 1 }, 'the other page shows B still read, its line where it was');
    assert.deepEqual(await looks(p), { read: { a: true, b: true, c: false }, line: { under: 'c', faded: false }, total: total - 2, row: 1 }, 'and so does this one');
    // A reload keeps it.
    const origin = await p.evaluate('performance.timeOrigin');
    await p.send('Page.reload');
    await until(() => p.evaluate(`performance.timeOrigin !== ${origin} && document.body?.dataset.ready === 'true' && Boolean(document.querySelector('#messages .new-line')) &&
      ${JSON.stringify(Object.values(ids))}.every(id => document.querySelector('#messages .message-card[data-id="' + id + '"]'))`).catch(() => false), 'the page loads again, a new document with all three cards');
    await becomes(() => looks(p), { read: { a: true, b: true, c: false }, line: { under: 'c', faded: false }, total: total - 2, row: 1 }, 'loaded again, A and B read, C unread, the line under C');
    assert.deepEqual(p.errors, []); assert.deepEqual(q.errors, []);
    await p.close(); await q.close();
  });

  await check('reading a 👍 on a message marked unread clears the mark and reads it at once, here and on another page, and a reload keeps it', async () => {
    // Item 327: unread is a pending delivery or a mark. The person reads B, marks it unread, closes the Reader and
    // later gives it a 👍 from the bar without opening it: the 👍 reads it, mark and all. A stays unread throughout.
    const topic = 'reading-thumb-marked';
    const ids = await seed(topic, [['a', { sender: 'aim-core', join: true, addressees: [facts.actor], body: 'Message A, the oldest, unread.' }],
      ['b', { sender: 'aim-core', addressees: [facts.actor], body: 'Message B, read, then marked unread.' }]]);
    const hold = 'window.holdReads = true';
    const p = await open('reading-thumb-marked', 'laptop', topic, ids.a, hold);
    const q = await open('reading-thumb-marked-other', 'laptop', topic, ids.a, hold);
    const marked = async () => (await view('marks', { topic_id: topic })).items.map(item => item.message_id);
    // How a page shows it: each card read or not and its Unread pill, the topic's marks line, and the topic's row.
    const looks = pg => pg.evaluate(`(()=>{const ids=${JSON.stringify(ids)},cards={};for(const [k,id] of Object.entries(ids)){const c=document.querySelector('#messages .message-card[data-id="'+id+'"]');
      cards[k]={read:c.hasAttribute('data-read'),pill:Boolean(c.querySelector('.unread-mark'))}}
      const row=document.querySelector('#outline a[data-topic-id=${JSON.stringify(topic)}]'),badge=row?.querySelector('.unread-count');
      return {cards,marks:!document.querySelector('#topic-marks').hidden,row:row?Number(badge?.textContent??0):null}})()`);
    await p.send('Page.bringToFront');
    await openReader(p, 'laptop', ids.b, 'Message B');
    await until(() => p.evaluate("!document.querySelector('#mark-unread').hidden && document.querySelector('#mark-unread').getAttribute('aria-pressed') === 'false'"), 'the Reader offers Mark unread on B');
    await p.point('#mark-unread');
    await until(async () => (await marked()).join() === ids.b, 'Core holds B marked unread');
    await closeReader(p, 'laptop');
    const marking = { cards: { a: { read: false, pill: false }, b: { read: false, pill: true } }, marks: true, row: 2 };
    await becomes(() => looks(p), marking, 'B reads as unread, with its Unread pill and the marks line; A is unread too');
    await q.send('Page.bringToFront');
    await becomes(() => looks(q), marking, 'the other page shows the same');
    await p.send('Page.bringToFront');
    // The pointer comes to B from A, as it would come back to the message later.
    await light(p, 'laptop', ids.a);
    await light(p, 'laptop', ids.b);
    await press(p, 'laptop', `${BAR} [data-act=thumb]`);
    await until(async () => await thumbsBy(ids.b, facts.actor) === 1, 'Core holds the thumbs-up on B');
    await until(async () => (await marked()).length === 0, 'the 👍 cleared B\'s mark in Core');
    const read = { cards: { a: { read: false, pill: false }, b: { read: true, pill: false } }, marks: false, row: 1 };
    await becomes(() => looks(p), read, 'B reads as read at once, its pill and the marks line gone, and only A counts');
    await q.send('Page.bringToFront');
    await becomes(() => looks(q), read, 'the other page shows the same, with no reload');
    await front(p);
    const origin = await p.evaluate('performance.timeOrigin');
    await p.send('Page.reload');
    await until(() => p.evaluate(`performance.timeOrigin !== ${origin} && document.body?.dataset.ready === 'true' &&
      ${JSON.stringify(Object.values(ids))}.every(id => document.querySelector('#messages .message-card[data-id="' + id + '"]'))`).catch(() => false), 'the page loads again, a new document with both cards');
    await becomes(() => looks(p), read, 'loaded again, B is read and unmarked, A unread');
    assert.deepEqual(p.errors, []); assert.deepEqual(q.errors, []);
    await p.close(); await q.close();
  });

  await check('reading ⌘C with nothing selected copies the lit message\'s words as written, as ⇧⌘C does in the Reader; a selection, the writing and no lit message leave ⌘C to the browser', async () => {
    const topic = 'reading-copy';
    const long = Array.from({ length: 60 }, (_, i) => `Line ${i} of a long message, cut off on its card.`).join('\n');
    const ids = await seed(topic, [['short', { sender: 'aim-core', join: true, addressees: [facts.actor], body: 'A short message\nwith a second line, *as written*.' }],
      ['long', { sender: 'aim-ux', join: true, addressees: [facts.actor], body: long }],
      ['newest', { sender: 'aim-core', addressees: [facts.actor], body: 'The newest message.' }]]);
    const p = await open('reading-copy', 'laptop', topic, ids.short);
    const written = async id => (await view('source', { source_ref: { kind: 'message', id } })).body;
    // The page's own clipboard: what it is handed is kept on the page, and the Mac's pasteboard is never touched.
    // Each ⌘C heard is recorded with whether the page took it (prevented its default) and then kept from the
    // browser, so a ⌘C the page leaves alone copies nothing to the Mac either.
    await p.evaluate(`(()=>{window.copied=[];window.keyed=[];Object.defineProperty(navigator.clipboard,'writeText',{configurable:true,value:async text=>{window.copied.push(text)}});
      addEventListener('keydown',e=>{if(e.metaKey&&!e.altKey&&!e.ctrlKey&&e.key.toLowerCase()==='c'){window.keyed.push(e.defaultPrevented);e.preventDefault()}});return true})()`);
    const copy = async (modifiers = 4) => {
      const heard = await p.evaluate('window.keyed.length');
      await p.key('c', modifiers);
      await until(() => p.evaluate(`window.keyed.length > ${heard}`), 'the page heard ⌘C');
      return p.evaluate('window.keyed.at(-1)');
    };
    const copied = () => p.evaluate('window.copied.slice()');
    // Nothing lit: ⌘C is the browser's.
    await away(p);
    await p.evaluate('document.activeElement?.blur()');
    assert.deepEqual(await lit(p), [], 'nothing is lit');
    assert.equal(await copy(), false, 'with nothing lit the page leaves ⌘C alone');
    assert.deepEqual(await copied(), [], 'and copies nothing');
    // The pointer rests on a message: ⌘C copies its words as written.
    await light(p, 'laptop', ids.short);
    assert.equal(await copy(), true, 'the page takes ⌘C on the lit message');
    const short = await written(ids.short);
    await becomes(copied, [short], 'the lit message\'s words, as written, are on the clipboard');
    // The keys move the light from under the resting pointer: the message they light is the one ⌘C copies, as Return answers it.
    await p.key('ArrowUp');
    await until(async () => (await lit(p)).join() === ids.long, 'the keys light the cut-off message above');
    assert.equal(await copy(), true, 'the page takes ⌘C on it');
    const whole = await written(ids.long);
    await becomes(copied, [short, whole], 'the whole message is on the clipboard, not its excerpt');
    // The Reader's ⇧⌘C gives the same words.
    await p.point(words(ids.long));
    await until(async () => (await readerOn(p))?.startsWith('Line 0'), 'a click opens the lit message in the Reader');
    assert.equal(await copy(12), true, 'the Reader takes ⇧⌘C');
    await becomes(copied, [short, whole, whole], 'the Reader copies the same words');
    await closeReader(p, 'laptop');
    // Words selected on the page: ⌘C copies them as the browser does, not the lit message.
    await light(p, 'laptop', ids.short);
    await p.evaluate(`(()=>{const r=document.createRange();r.selectNodeContents(document.querySelector(${JSON.stringify(words(ids.short))}));getSelection().removeAllRanges();getSelection().addRange(r);return true})()`);
    assert.equal(await copy(), false, 'with words selected the page leaves ⌘C to the browser');
    assert.deepEqual(await copied(), [short, whole, whole], 'and puts nothing of its own on the clipboard');
    await p.evaluate('getSelection().removeAllRanges()');
    // In the writing ⌘C is the writing's, with a message still lit.
    await into(p, 'laptop', '#inline-writing-body');
    await p.send('Input.insertText', { text: 'Words in the composer.' });
    assert.ok((await lit(p)).length === 1, 'a message is still lit');
    assert.equal(await copy(), false, 'in the composer the page leaves ⌘C to the writing');
    assert.deepEqual(await copied(), [short, whole, whole], 'and puts nothing of its own on the clipboard');
    assert.deepEqual(p.errors, []);
    await p.close();
  });

  await check('reading a thumbs-up an agent gives shows on the card while the page is open, and so does its taking back', async () => {
    const topic = 'reading-live-thumb';
    const ids = await seed(topic, [['theirs', { sender: 'aim-core', join: true, addressees: [facts.actor], body: 'From aim-core.' }],
      ['mine', { sender: 'person', addressees: ['aim-core'], body: 'Mine, for aim-core to thumb up.' }]]);
    const p = await open('reading-live-thumb', 'laptop', topic, ids.mine);
    const count = () => p.evaluate(`(()=>{const c=document.querySelector(${JSON.stringify(card(ids.mine) + ' > .message-reactions .reaction-count')});return c?{number:c.querySelector('.reaction-number').textContent,title:c.title}:null})()`);
    assert.equal(await count(), null, 'no count before the agent thumbs it up');
    await control({ method: 'agent_thumb', operation_id: topic + '-on', sender: 'aim-core', message_id: ids.mine });
    await until(async () => (await count())?.number === '1', 'the card counts the agent\'s thumbs-up, with no reload');
    assert.equal((await count()).title, '👍 aim-core: read and understood', 'and names the agent');
    await control({ method: 'agent_thumb', operation_id: topic + '-off', sender: 'aim-core', message_id: ids.mine, thumbed: false });
    await until(async () => await count() === null, 'taken back, the count goes');
    assert.deepEqual(p.errors, []);
    await p.close();
  });

  await check('reading Reply on the bar opens the Reader on the lit message with the cursor in the reply, and nothing quoted', async () => {
    for (const device of Object.keys(DEVICES)) {
      const topic = 'reading-bar-reply-' + device;
      const ids = await seed(topic, [['a', { sender: 'aim-core', join: true, addressees: [facts.actor], body: 'Message A, to reply to.' }],
        ['b', { sender: 'aim-core', addressees: [facts.actor], body: 'Message B, newer.' }]]);
      const p = await open('reading-bar-reply-' + device, device, topic, ids.a);
      await light(p, device, ids.a);
      await press(p, device, `${BAR} [data-act=reply]`);
      await until(async () => (await readerOn(p))?.startsWith('Message A'), device + ': Reply on the bar opens the Reader on the lit message');
      await until(() => p.evaluate(`document.activeElement?.id === 'writing-body'`), device + ': the cursor is in the reply');
      assert.equal(await valueOf(p, '#writing-body'), '', device + ': nothing quoted');
      await closeReader(p, device);
      assert.deepEqual(p.errors, []);
      await p.close();
    }
  });

  await check('reading replies gather into a stack under the message they answer, oldest first, folded to the newest and any unread, and its line opens the rest', async () => {
    for (const device of Object.keys(DEVICES)) {
      const topic = 'reading-stack-' + device;
      // Read through "other"; three and four come after, unread. Three answers two, so it is in the stack too.
      const ids = await seed(topic, [['root', { sender: 'aim-core', join: true, addressees: [facts.actor], body: 'The message the replies answer.' }],
        ['one', { sender: 'aim-core', reply_to: 'root', addressees: [facts.actor], body: 'Reply one.' }],
        ['two', { sender: 'aim-core', reply_to: 'root', addressees: [facts.actor], body: 'Reply two.' }],
        ['other', { sender: 'aim-core', addressees: [facts.actor], body: 'A message on its own.', read: true }],
        ['three', { sender: 'aim-core', reply_to: 'two', addressees: [facts.actor], body: 'Reply three, to reply two.' }],
        ['four', { sender: 'aim-core', reply_to: 'root', addressees: [facts.actor], body: 'Reply four, the newest.' }]]);
      const name = Object.fromEntries(Object.entries(ids).map(([key, id]) => [id, key]));
      const p = await open('reading-stack-' + device, device, topic, ids.root);
      const stack = async () => {
        const seen = await p.evaluate(`(()=>{const list=document.querySelector('#messages'),head=list.querySelector(${JSON.stringify(card(ids.root))}),s=head?.closest('.reply-stack');
          if(!s)return null;const t=s.querySelector(':scope > .stack-toggle'),own=list.querySelector(${JSON.stringify(entry(ids.other))});
          return {top:s.parentElement===list,head:s.firstElementChild.dataset.id,replies:[...s.querySelectorAll(':scope > .stack-replies > [data-id]')].map(e=>[e.dataset.id,e.getClientRects().length>0]),
            expanded:t?.getAttribute('aria-expanded')??null,fold:s.dataset.fold,aboveOther:Boolean(s.compareDocumentPosition(own)&Node.DOCUMENT_POSITION_FOLLOWING),otherAlone:own.parentElement===list}})()`);
        return seen && { ...seen, head: name[seen.head], replies: seen.replies.map(([id, shown]) => [name[id], shown]) };
      };
      await becomes(stack, { top: true, head: 'root', replies: [['one', false], ['two', false], ['three', true], ['four', true]], expanded: 'true', fold: 'folded',
        aboveOther: true, otherAlone: true }, device + ': the replies under the message, oldest first as a chat reads; the unread ones and the newest in view, the rest folded behind one line; the stack above the message on its own, as its newest reply is newer');
      await shot(p, 'reading-stack-' + device);
      const line = `#messages .reply-stack[data-stack="${ids.root}"] > .stack-toggle`;
      await centre(p, line);
      await press(p, device, line);
      await until(async () => (await stack())?.fold === 'open', device + ': a press on the line opens the stack');
      assert.deepEqual((await stack()).replies.map(([, shown]) => shown), [true, true, true, true], device + ': every reply shows');
      assert.equal((await stack()).expanded, 'true', device + ': and the line folds them again');
      await press(p, device, line);
      await until(async () => (await stack())?.fold === 'head', device + ': a second press closes the stack');
      assert.deepEqual((await stack()).replies.map(([, shown]) => shown), [false, false, false, false], device + ': closed shows no replies');
      assert.equal(await readerOn(p), null, device + ': the line opens no message');
      assert.deepEqual(p.errors, []);
      await p.close();
    }
  });

  await check('reading #img in the topic\'s composer and in the Reader lists the topic\'s images with thumbnails, and ↓ Return or a tap adds the one picked', async () => {
    for (const device of Object.keys(DEVICES)) {
      const topic = 'reading-img-' + device;
      const ids = await seed(topic, [['chart', { sender: 'aim-core', join: true, addressees: [facts.actor], body: 'The chart.', attachments: [{ name: 'chart.png', image: 'screen.png' }] }],
        ['photo', { sender: 'aim-ux', join: true, addressees: [facts.actor], body: 'The photo.', attachments: [{ name: 'photo.png', image: 'one.png' }] }]]);
      let p = await open('reading-img-' + device, device, topic, ids.photo);
      // The list #img opens under a field: each image's name, whether it is the one ↑ ↓ chose, and whether its thumbnail shows.
      const list = field => p.evaluate(`(()=>{const l=document.getElementById(${JSON.stringify(field.slice(1) + '-images')});if(!l||l.hidden)return null;
        return [...l.querySelectorAll('.image-option')].map(o=>{const t=o.querySelector('img.image-thumb'),r=t?.getBoundingClientRect();
          return [o.querySelector('.image-option-name').textContent,o.getAttribute('aria-selected')==='true',Boolean(t&&!t.hidden&&t.complete&&t.naturalWidth>0&&r.width>0&&r.height>0)]})})()`);
      const both = [['photo.png', true, true], ['chart.png', false, true]];
      // An image picked keeps its bytes on the device before it goes to Theseus. Where this browser's
      // context will not keep a Blob in IndexedDB (WebKit's test context), its row says so instead.
      const refusal = await p.evaluate(`new Promise(done=>{const r=indexedDB.open('reading-blob-probe');r.onupgradeneeded=()=>r.result.createObjectStore('s');
        r.onerror=()=>done(String(r.error));r.onsuccess=()=>{try{const t=r.result.transaction('s','readwrite');
        const q=t.objectStore('s').put(new Blob(['x']),'k');q.onerror=()=>done(String(q.error));t.oncomplete=()=>{r.result.close();done('')}}catch(error){done(String(error))}}})`);
      const ready = 'chart.png · ' + (refusal ? 'Bytes not saved on this device' : 'Ready');
      if (refusal) observations.push({ name: 'reading #img ' + device, held: 'the image picked is added; this context keeps no Blob in IndexedDB (' + refusal + '), so its row says Bytes not saved on this device' });
      // The topic's composer: the newest image first, each with its thumbnail; ↓ and Return pick, or a tap.
      await into(p, device, '#inline-writing-body');
      await p.send('Input.insertText', { text: 'Here it is: #img' });
      await until(async () => JSON.stringify(await list('#inline-writing-body')) === JSON.stringify(both), device + ' composer: #img lists the topic\'s two images, newest first, each with its thumbnail');
      await shot(p, 'reading-img-composer-' + device);
      if (device === 'laptop') {
        await p.key('ArrowDown');
        await until(async () => (await list('#inline-writing-body'))?.[1]?.[1] === true, 'laptop composer: ↓ chooses the second image');
        await p.key('Enter');
      } else { await centre(p, '#inline-writing-body-images-1'); await tap(p, '#inline-writing-body-images-1', 'centre'); }
      await becomes(() => imageRows(p, '#inline-attachments'), [ready], device + ' composer: the image picked is added to the writing, and Theseus holds it');
      assert.equal(await list('#inline-writing-body'), null, device + ' composer: the list closes');
      assert.equal(await valueOf(p, '#inline-writing-body'), 'Here it is: ', device + ' composer: the #img words come out of the writing');
      assert.equal(await p.evaluate(`document.activeElement?.id`), 'inline-writing-body', device + ' composer: the writing keeps the cursor');
      // The strip over the writing shows the image's thumbnail, on a phone as on a laptop (docs/reader.md).
      const thumb = () => p.evaluate(`(()=>{const t=document.querySelector('#inline-attachments .image-choice>img.image-thumb'),r=t?.getBoundingClientRect();return Boolean(t&&!t.hidden&&t.complete&&t.naturalWidth>0&&r.width>0&&r.height>0)})()`);
      await until(thumb, device + ' composer: the strip shows the image\'s thumbnail');
      if (device === 'laptop') {
        // The #img words came out as one edit Undo takes back; the image stays.
        await undoes(p, '#inline-writing-body', 'Here it is: #img', 'laptop composer: ⌘Z puts the #img words back');
        assert.deepEqual(await imageRows(p, '#inline-attachments'), [ready], 'laptop composer: ⌘Z leaves the image picked');
        // The cursor at the words' end opens the list again, and Escape closes it with the writing kept.
        await p.key('ArrowRight');
        await until(async () => await list('#inline-writing-body') !== null, 'laptop composer: the cursor after #img opens the list');
        await p.key('Escape');
        await until(async () => await list('#inline-writing-body') === null, 'laptop composer: Escape closes the list');
        assert.equal(await valueOf(p, '#inline-writing-body'), 'Here it is: #img', 'laptop composer: and keeps the writing');
        assert.deepEqual(await imageRows(p, '#inline-attachments'), [ready], 'laptop composer: and the image picked');
      }
      // The Reader: letters after #img narrow the list by name. An image whose bytes the device could not
      // keep holds the page to the composer, so where that is so the Reader is opened in a page of its own.
      if (refusal) { assert.deepEqual(p.errors, []); await p.close(); p = await open('reading-img-reader-' + device, device, topic, ids.photo); }
      await openReader(p, device, ids.photo, 'The photo.');
      await into(p, device, '#writing-body');
      await p.send('Input.insertText', { text: '#imgchart' });
      await until(async () => JSON.stringify(await list('#writing-body')) === JSON.stringify([['chart.png', true, true]]), device + ' Reader: #imgchart lists only chart.png');
      if (device === 'laptop') await p.key('Enter'); else { await centre(p, '#writing-body-images-0'); await tap(p, '#writing-body-images-0', 'centre'); }
      await becomes(() => imageRows(p, '#writing-attachments'), [ready], device + ' Reader: the image picked is added to the reply, and Theseus holds it');
      assert.deepEqual([await list('#writing-body'), await valueOf(p, '#writing-body')], [null, ''], device + ' Reader: the list closes and the #img words are gone');
      // The Reader stays open over an image whose bytes the device could not keep.
      if (!refusal) await closeReader(p, device);
      assert.deepEqual(p.errors, []);
      await p.close();
    }
  });

  await check('reading Paste image: where the browser can tell the clipboard holds an image, the button says so and adds it, in the composer and the Reader, and Choose file beside it opens the picker', async () => {
    const topic = 'reading-paste';
    const ids = await seed(topic, [['m', { sender: 'aim-core', join: true, addressees: [facts.actor], body: 'A message to answer with an image.' }]]);
    const p = await open('reading-paste', 'laptop', topic, ids.m);
    // The image button in the + panel, as it shows: its words, or null while it is not shown, and whether Choose
    // file shows beside it: '' for the Reader's, 'inline-' for the composer's.
    const shown = el => !el.hidden && el.getClientRects().length > 0;
    const button = at => p.evaluate(`(()=>{const b=document.getElementById('${at}add-image'),c=document.getElementById('${at}choose-image'),shown=${shown};return [shown(b)?b.textContent:null,shown(c)]})()`);
    const settled = () => p.evaluate('new Promise(done=>requestAnimationFrame(()=>requestAnimationFrame(done)))');
    // The image tiles are in the + panel: + opens it, as the person opens it, when it is shut.
    const plus = async at => {
      if (await p.evaluate(`!document.getElementById('${at}plus-panel').hidden`)) return;
      await p.point(`#${at}plus-button`);
      await until(() => p.evaluate(`(${shown})(document.getElementById('${at}plus-panel'))`), `${at || 'Reader '}+ opens its panel`);
    };
    if (!grant) {
      // Safari's engine: nothing tells the page what the clipboard holds without a press, so the button stays Add image.
      await into(p, 'laptop', '#inline-writing-body');
      await plus('inline-');
      await settled();
      assert.deepEqual(await button('inline-'), ['Add image', false], 'webkit composer: Add image');
      await openReader(p, 'laptop', ids.m, 'A message to answer');
      await plus('');
      await settled();
      assert.deepEqual(await button(''), ['Add image', false], 'webkit Reader: Add image');
      await closeReader(p, 'laptop');
      observations.push({ name: 'reading Paste image', engine: 'webkit', held: 'the button reads Add image; Safari reads the clipboard only inside a press' });
      assert.deepEqual(p.errors, []);
      await p.close();
      return;
    }
    // The person allowed this page to read the clipboard before; the page itself never asks.
    await grant(['clipboard-read', 'clipboard-write']);
    await p.send('Emulation.setFocusEmulationEnabled', { enabled: true });
    await p.send('Page.setInterceptFileChooserDialog', { enabled: true });
    await into(p, 'laptop', '#inline-writing-body');
    await plus('inline-');
    await settled();
    assert.deepEqual(await button('inline-'), ['Add image', false], 'composer: an empty clipboard leaves Add image');
    // An image copied, as a person's copy puts it on the clipboard; the writing then takes the focus again.
    const copied = await p.evaluate(`(async()=>{try{const c=document.createElement('canvas');c.width=40;c.height=30;const x=c.getContext('2d');x.fillStyle='#2a7';x.fillRect(0,0,40,30);
      const blob=await new Promise(done=>c.toBlob(done,'image/png'));await navigator.clipboard.write([new ClipboardItem({'image/png':blob})]);
      const allowed=(await navigator.permissions.query({name:'clipboard-read'})).state;let held;
      try{held=(await navigator.clipboard.read()).flatMap(item=>item.types)}catch(error){held=String(error)}
      document.activeElement?.blur();return [allowed,held]}catch(error){return String(error)}})()`);
    assert.deepEqual(copied, ['granted', ['image/png']], 'the clipboard holds the image copied, and the page may read it');
    await into(p, 'laptop', '#inline-writing-body');
    await plus('inline-');
    await until(async () => JSON.stringify(await button('inline-')) === JSON.stringify(['Paste image', true]), 'composer: the button says Paste image, with Choose file beside it');
    await shot(p, 'reading-paste-composer');
    const chooser = () => p.events.filter(event => event.method === 'Page.fileChooserOpened').length;
    const chosen = chooser();
    await p.point('#inline-choose-image');
    await until(async () => chooser() === chosen + 1, 'composer: Choose file opens the file picker');
    // A tile puts the panel away; the picker's Cancel is in it, under +.
    await plus('inline-');
    await p.point('#inline-cancel-image');
    await plus('inline-');
    await until(async () => JSON.stringify(await button('inline-')) === JSON.stringify(['Paste image', true]), 'composer: the picker let go, Paste image is back');
    await p.point('#inline-add-image');
    await until(async () => (await imageRows(p, '#inline-attachments')).join() === 'pasted.png · Ready', 'composer: Paste image adds the clipboard\'s image, and Theseus holds it');
    assert.equal(chooser(), chosen + 1, 'composer: Paste image opens no picker');
    // ⌘V in the writing pastes it too.
    await into(p, 'laptop', '#inline-writing-body');
    await p.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'v', code: 'KeyV', windowsVirtualKeyCode: 86, modifiers: 4, commands: ['paste'] });
    await p.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'v', code: 'KeyV', windowsVirtualKeyCode: 86, modifiers: 4 });
    await until(async () => (await imageRows(p, '#inline-attachments')).join() === 'pasted.png · Ready,image.png · Ready', 'composer: ⌘V pastes the image into the writing as well, as Chrome names it');
    // The Reader's button reads the clipboard as its writing takes the focus.
    await openReader(p, 'laptop', ids.m, 'A message to answer');
    await plus('');
    await until(async () => JSON.stringify(await button('')) === JSON.stringify(['Paste image', true]), 'Reader: the button says Paste image, with Choose file beside it');
    await p.point('#add-image');
    await until(async () => (await imageRows(p, '#writing-attachments')).join() === 'pasted.png · Ready', 'Reader: Paste image adds the clipboard\'s image, and Theseus holds it');
    assert.equal(chooser(), chosen + 1, 'Reader: Paste image opens no picker');
    await shot(p, 'reading-paste-reader');
    await closeReader(p, 'laptop');
    assert.deepEqual(p.errors, []);
    await p.close();
  });

  await check('reading ⌥↑ and ⌥↓ move the line in the writing, in the topic\'s composer and in the Reader, and ⌘Z puts it back', async () => {
    const topic = 'reading-move';
    const ids = await seed(topic, [['m', { sender: 'aim-core', join: true, addressees: [facts.actor], body: 'A message to answer with a list.' }]]);
    const p = await open('reading-move', 'laptop', topic, ids.m);
    const moves = async (where, field) => {
      await p.send('Input.insertText', { text: 'a) one\nb) two\nc) three' });
      // From the end of "c) three" the cursor goes up a line, onto "b) two".
      await p.key('ArrowUp');
      await p.key('ArrowUp', 1);
      await becomes(() => valueOf(p, field), 'b) two\na) one\nc) three', `${where}: ⌥↑ moves "b) two" above "a) one"`);
      await undoes(p, field, 'a) one\nb) two\nc) three', `${where}: ⌘Z puts it back`);
      // The cursor on "b) two" again, wherever ⌘Z left it.
      await p.evaluate(`(f=>f.setSelectionRange(9,9))(document.querySelector(${JSON.stringify(field)}))`);
      await p.key('ArrowDown', 1);
      await becomes(() => valueOf(p, field), 'a) one\nc) three\nb) two', `${where}: ⌥↓ moves it below "c) three"`);
    };
    await into(p, 'laptop', '#inline-writing-body');
    await moves('composer', '#inline-writing-body');
    await openReader(p, 'laptop', ids.m, 'A message to answer');
    await moves('Reader', '#writing-body');
    await closeReader(p, 'laptop');
    assert.deepEqual(p.errors, []);
    await p.close();
  });

  await stackChecks({ check, until, view, control, shot, facts, observations, engine },
    { seed, open, becomes, centre, tap, press, lit, bar, away, readerOn, closeReader, light, openReader, entry, card, words, DEVICES });
}

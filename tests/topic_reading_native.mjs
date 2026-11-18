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
// (121), in the topic's composer and in the Reader; and what the keys select
// coming fully into view, and a click or a tap scrolling nothing (379).
import assert from 'node:assert/strict';
import { reading785Checks } from './reading_785_native.mjs';
import { stackChecks } from './stack_native.mjs';
import { editChecks } from './message_edit_native.mjs';
import { pngPixels } from './png-bands.mjs';

const DEVICES = { laptop: { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false }, phone: { width: 390, height: 844, deviceScaleFactor: 1, mobile: true } };
// A pointer at a phone's widths: a narrow laptop window, or a tablet with a trackpad. open() takes these too; they are
// kept out of DEVICES, which the checks that run on every device go through.
const POINTER_WIDTHS = { w390: { width: 390, height: 844, deviceScaleFactor: 1, mobile: false }, w375: { width: 375, height: 812, deviceScaleFactor: 1, mobile: false },
  w320: { width: 320, height: 640, deviceScaleFactor: 1, mobile: false } };
// The narrower phones a look is checked at, beside DEVICES' phone (390): a page opened at one of these only looks.
const NARROW = { 'phone-320': { width: 320, height: 640, deviceScaleFactor: 1, mobile: true }, 'phone-375': { width: 375, height: 812, deviceScaleFactor: 1, mobile: true } };
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
// window.waitView = name: the page's reads of the view so named wait unsent, as a slow connection holds them, until
// window.letViews() sends them; what Core commits meanwhile reaches the page in one answer. window.waitingViews: those waiting.
// window.fetchesOut: how many of the page's requests are out and not yet answered (held reports aside).
// window.sendReceipts: Core's answers to the page's message.send commands, in the order they came.
const HEARD = `(()=>{window.sent=[];window.sendReceipts=[];window.taps=0;window.fetchesOut=0;window.waitingViews=[];window.letViews=()=>{window.waitView=null;for(const go of window.waitingViews.splice(0))go()};
  const f=window.fetch;window.fetch=function(input,init){
  let b=null;try{b=init&&typeof init.body==='string'?JSON.parse(init.body):null;if(b&&b.kind)window.sent.push(b.kind)}catch(e){}
  if(b&&b.name&&b.name===window.waitView)return new Promise(go=>window.waitingViews.push(go)).then(()=>window.fetch.call(this,input,init));
  if(b&&b.kind==='topic.read_through'&&window.holdReads)return new Promise(()=>{});
  if(b&&b.kind==='message.thumb'&&window.staleThumb){window.staleThumb=false;b.expected.thumb_revision+=99;init={...init,body:JSON.stringify(b)}}
  const answer=f.call(this,input,init),watch=window.watchFor,back=()=>{window.fetchesOut--};window.fetchesOut++;answer.then(back,back);
  if(watch&&b&&b.name===watch.read)answer.then(r=>r.clone().text()).then(t=>{if(t.includes(watch.words))window.watched=true},()=>{});
  if(b&&b.kind==='message.send')answer.then(r=>r.clone().json()).then(j=>window.sendReceipts.push(j),()=>{});
  return answer};
  addEventListener('click',()=>{window.taps++},true)})()`;

// grant(names): Chrome's own grant of permissions (clipboard-read, ...) to the page's
// origin, as a person's earlier "Allow" leaves it; Safari's engine has none. engine: 'chrome' or 'webkit'.
// windows: the browser's own windows, as it opens them: list() gives each page's id and address, close(id) closes one.
export async function readingChecks({ check, page, until, view, control, shot, facts, observations, grant = null, windows, engine = 'chrome' }) {
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
  // query: the page's address after the origin, the topic's page unless given. before(q): more to do to the page
  // before it is opened, once its size and touch are set (what serves its files, say).
  const open = async (name, device, topic, first, init = '', query = '/?topic=' + topic, before = null) => {
    const metrics = DEVICES[device] ?? POINTER_WIDTHS[device] ?? NARROW[device];
    const p = await page(name, null, true, { url: facts.origin + query, beforeNavigate: async q => {
      await q.send('Page.addScriptToEvaluateOnNewDocument', { source: HEARD });
      if (init) await q.send('Page.addScriptToEvaluateOnNewDocument', { source: init });
      await q.send('Emulation.setDeviceMetricsOverride', metrics);
      if (metrics.mobile) await q.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 1 });
      if (before) await before(q);
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
  // A finger's tap where the target shows, failing by name when something else is there: at its corner, its
  // centre, or the centre of its first line ('first'), for a link that wraps, whose box's centre is between its lines.
  // The point is measured and hit-tested in one look at the page, once the target has held its place across two
  // animation frames, as a person aims at a still target: a row filled in above the feed (the outline
  // rail at phone width) moves the cards with no scroll, and a point measured before that lands on
  // whatever moved under it. A page not shown draws no frames, and is measured as it stands.
  // during: what happens while the finger is down, before it lifts. WebKit's touchscreen only taps whole
  // (webkit_native.mjs), so there it happens just before the tap.
  const tap = async (p, selector, at = 'corner', during = null) => {
    const aim = await until(() => p.evaluate(`new Promise(done=>{const t=document.querySelector(${JSON.stringify(selector)}),
      rect=()=>{const b=t&&(${at === 'first'}?t.getClientRects()[0]:t.getBoundingClientRect());return b?{x:b.x,y:b.y,width:b.width,height:b.height}:null},
      tapStableTolerancePx=0.5,same=(a,b)=>Boolean(a&&b)&&['x','y','width','height'].every(key=>Math.abs(a[key]-b[key])<=tapStableTolerancePx),
      look=()=>{const tapViewportTolerancePx=0.5,b=rect();if(!b)return {b};const x=${at === 'corner'}?b.x+Math.min(12,b.width/2):b.x+b.width/2,y=${at === 'corner'}?b.y+Math.min(12,b.height/2):b.y+b.height/2,
        h=document.elementFromPoint(x,y);return {b,x,y,inside:x>=tapViewportTolerancePx&&y>=tapViewportTolerancePx&&x<=innerWidth-tapViewportTolerancePx&&y<=innerHeight-tapViewportTolerancePx,hit:t.contains(h)?'':h?h.tagName.toLowerCase()+'.'+h.className:'nothing'}};
      if(document.hidden)return done(look());
      const first=rect();requestAnimationFrame(()=>{const second=rect();requestAnimationFrame(()=>done(same(first,second)&&same(second,rect())?look():null))})})`),
      `${selector} holds its place across two frames before a tap (tapStableTolerancePx=0.5)`);
    const { b, x, y } = aim;
    const tapVisibleTolerancePx = 0.5;
    assert.ok(b && b.width > tapVisibleTolerancePx && b.height > tapVisibleTolerancePx, `visible target ${selector} (tapVisibleTolerancePx=0.5)`);
    assert.ok(aim.inside, `${selector} is inside the window before a tap (tapViewportTolerancePx=0.5)`);
    assert.equal(aim.hit, '', `${selector} is covered by ${aim.hit} where it would be tapped`);
    await p.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
    if (during) await during();
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
  // What the shown Reader says outside the message's own words: each visible element's text, title and
  // aria-label; and whether one of them gives n thumbs-up with each of names.
  const readerSays = p => p.evaluate(`(()=>{const words=document.querySelector('#source-body');return [...document.querySelectorAll('#reader *')]
    .filter(e=>e.getClientRects().length&&!words.contains(e)&&!e.contains(words)).map(e=>[e.textContent,e.title,e.getAttribute('aria-label')].filter(Boolean).join(' '))})()`);
  const readerCounts = async (p, n, names) => (await readerSays(p)).some(text => new RegExp('👍\\s*' + n + '(?!\\d)').test(text) && names.every(who => text.includes(who)));
  const closeReader = async (p, device) => {
    await press(p, device, '#reader-close');
    await until(async () => await readerOn(p) === null, 'the Reader closed');
  };
  // Lights a card as the person does: the pointer rests on it, or a finger taps it; on its words,
  // or, for a stack's head shown as one row, on that row, which lights with no bar (docs/reply-stacks.md).
  // offWords: the pointer rests on its author's line instead, so no passage of its words lights with it
  // (item 478), and Return answers the message with nothing quoted.
  // A message the person folded (a thumbs-up or a reply of theirs folds it, docs/reply-stacks.md) lights on its one-line row
  // under the pointer, with its bar, but in a dossier with none (item 471); on a phone a tap on that row unfolds it, so it
  // is unfolded first (unfoldRow).
  const light = async (p, device, id, offWords = false) => {
    await centre(p, card(id));
    if (await foldedRow(p, id)) {
      if (device === 'phone') await unfoldRow(p, device, id);
      else {
        const dossier = await p.evaluate(`document.querySelector(${JSON.stringify(card(id))}).closest('.reply-stack')?.dataset.single === 'false'`);
        await p.point(card(id) + ' > .message-folded > .folded-words', 'move');
        await until(async () => (await lit(p)).includes(id) && (await bar(p) === null) === dossier, `${device}: ${id} lights on its folded row, ${dossier ? 'with no bar in a dossier' : 'with its bar'}`);
        return;
      }
    }
    const row = !await p.evaluate(`document.querySelector(${JSON.stringify(words(id))})?.getClientRects().length > 0`);
    // The left edge now belongs to the separate reply chevron. Light the
    // head on its author text, which still opens the head's own message.
    const target = row ? card(id) + ' > .stack-head > .stack-who' : offWords && device === 'laptop' ? card(id) + ' > .message-author' : words(id);
    if (device === 'phone') await tap(p, target); else await p.point(target, 'move');
    await until(async () => (await lit(p)).includes(id) && (await bar(p) === null) === row, `${device}: ${id} lights, ${row ? 'with no bar on a head shown as one row' : 'with its bar'}`);
  };
  // Whether a message shows as its folded row, and a press on that row, which shows it whole again (docs/reply-stacks.md).
  const foldedRow = (p, id) => p.evaluate(`(c=>c?.dataset.folded==='true'&&Boolean(c.querySelector(':scope > .message-folded')?.getClientRects().length))(document.querySelector(${JSON.stringify(card(id))}))`);
  const unfoldRow = async (p, device, id) => {
    // On its words: item 645 keeps repeated sender names for screen readers only.
    const row = card(id) + ' > .message-folded > .folded-words';
    await centre(p, row); await press(p, device, row);
    await until(async () => !await foldedRow(p, id) && await p.evaluate(`document.querySelector(${JSON.stringify(words(id))})?.getClientRects().length > 0`), `${device}: a press on ${id}'s row shows it whole`);
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
  // On a phone a tap on a message already lit (the Reader closing lights the message it showed) is that second
  // tap: it opens the Reader at once, and a further tap would land on the Reader opening over the message.
  const openReader = async (p, device, id, starts) => {
    await p.evaluate('document.activeElement?.blur()');
    if (device === 'laptop') { await light(p, device, id, true); await p.key('Enter'); }
    else {
      // A first tap lights it, unless it is lit already (a tap on its folded row that showed it whole lights it too); the next opens it.
      await centre(p, card(id));
      if (!(await lit(p)).includes(id)) { await tap(p, words(id)); await until(async () => (await lit(p)).includes(id), 'phone: the message lights'); }
      await tap(p, words(id));
    }
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
      assert.deepEqual(await bar(p), { thumb: 'false', reply: null, fold: null, more: null }, device + ': 👍, Reply, Fold and ⋯; no ✅ 🚫 on a message that asks nothing, and no Show full message on one shown whole');
      assert.equal(await count(), null, device + ': no count before anyone thumbs it');
      const thumb = async (on, how) => {
        await how();
        await until(async () => await thumbsBy(ids.plain, facts.actor) === (on ? 1 : 0), `${device}: Core holds the thumbs-up ${on ? 'on' : 'taken back'}`);
        await until(async () => on ? (await count())?.mine === true && (await bar(p))?.thumb === 'true' : await count() === null && (await bar(p))?.thumb === 'false',
          `${device}: the card and the bar show it ${on ? 'on' : 'taken back'}`);
      };
      const viaBar = () => press(p, device, `${BAR} [data-act=thumb]`);
      await thumb(true, viaBar);
      // A thumbs-up folds the message for the person (docs/reply-stacks.md, item 377); a press on its row shows it whole again.
      await until(() => foldedRow(p, ids.plain), device + ': the thumbs-up folds the message to its row');
      await unfoldRow(p, device, ids.plain);
      if (device === 'phone' && !(await lit(p)).includes(ids.plain)) await light(p, device, ids.plain);
      assert.match((await count()).text, /^👍 1/, device + ': the card counts one');
      // Where a pointer hovers, the count says how many and its title names who; on a phone the lit card's count names who.
      assert.equal((await count()).who, device === 'phone', device + ': names shown on the count only where nothing hovers');
      await shot(p, 'reading-thumb-' + device);
      await thumb(false, viaBar);
      await thumb(true, viaBar);
      if (device === 'phone') {
        // Where a finger presses, each of the bar's buttons is at least 44px each way.
        const sizes = await p.evaluate(`[...document.querySelectorAll('${BAR} button')].filter(b=>!b.hidden).map(b=>{const r=b.getBoundingClientRect();return [b.dataset.act,Math.round(r.width),Math.round(r.height)]})`);
        // 👍, Reply, Fold (item 473) and ⋯.
        assert.ok(sizes.length === 4 && sizes.every(([, width, height]) => width >= 44 && height >= 44), `phone: the bar's buttons are 44px or more (${JSON.stringify(sizes)})`);
        // On a phone a tap on the count names who, as hover does; it does not take the thumbs-up back.
        await until(() => foldedRow(p, ids.plain), 'phone: given again, the thumbs-up folds the message again');
        await unfoldRow(p, device, ids.plain);
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
        await until(() => foldedRow(p, ids.plain), 'laptop: given again, the thumbs-up folds the message again');
        await unfoldRow(p, device, ids.plain);
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
      assert.deepEqual(await bar(p), { thumb: 'false', yes: 'false', no: 'false', reply: null, fold: null, more: null }, device + ': and on its bar');
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
      // An answer is a reply, so it folds the ask for the person (docs/reply-stacks.md, item 377): heading its stack, the ask is
      // its dossier's first message, which shows as its folded row once the dossier is fully open (a press on the dossier's
      // head row), and a press on that row shows it whole again (item 471).
      const relight = async () => {
        const said = (await view('topic_messages', { topic_id: topic, direction: 'before', limit: 20 })).items.filter(item => item.reply_to === ids.ask && item.author_id === facts.actor).map(item => item.id);
        await until(() => p.evaluate(`${JSON.stringify(said)}.every(id => document.querySelector('#messages [data-id="' + id + '"]'))`), device + ': the page shows each reply');
        await until(async () => (await view('message_acts', { topic_id: topic })).items.some(item => item.message_id === ids.ask && item.acts.folded), device + ': the answer folds the ask, in Core');
        await until(() => p.evaluate(`document.querySelector(${JSON.stringify(card(ids.ask))})?.dataset.folded === 'true'`), device + ': the page shows the ask folded');
        if (await p.evaluate(`document.querySelector(${JSON.stringify(card(ids.ask))}).closest('.reply-stack')?.dataset.headOpen === 'false'`)) {
          await press(p, device, card(ids.ask) + ' > .stack-head .stack-who');
          await until(() => p.evaluate(`Boolean(document.querySelector(${JSON.stringify(card(ids.ask) + ' > .message-folded')})?.getClientRects().length)`), device + ': a press on the dossier\'s head row shows the ask as its folded row');
        }
        await press(p, device, card(ids.ask) + ' > .message-folded > .folded-words');
        await until(() => p.evaluate(`document.querySelector(${JSON.stringify(choices)}).getClientRects().length > 0`), device + ': a press on its folded row shows the ask whole');
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

  // The bar is bounded by the window (docs/interaction.md): a go-ahead ask its card cuts off has the most buttons a
  // bar shows (👍 ✅ 🚫, Reply, Show full message, Fold and ⋯, item 473), seven a finger wide, more than a 320px
  // window holds in a row, and "Link copied" on its ⋯ widens a bar further. In every state, at 390, 375 and 320
  // pixels, the bar keeps to one row over its card, every button 44px to touch and inside the window, ⋯ last: where
  // there is no room it puts Fold, then Show full message, behind its ⋯, whose menu offers them, and they come back
  // once there is room (the ⋯ says ⋯ again). Where there is room it puts nothing away: a laptop, a short ask at 390.
  await check('reading a go-ahead ask\'s bar keeps every button in the window at 390, 375 and 320 pixels, with Show full message and with "Link copied" on its ⋯, in one row, what does not fit behind its ⋯', async () => {
    const long = Array.from({ length: 70 }, (_, i) => `Step ${i}. What the deploy will do, in words that need the whole card.`).join('\n\n');
    // The bar as it stands: its buttons in order, each one's box, and the bar's and its card's boxes.
    const barNow = (p, id) => p.evaluate(`(()=>{const b=document.querySelector('${BAR}');if(!b||b.hidden)return null;const box=e=>{const r=e.getBoundingClientRect();return {left:Math.round(r.left),right:Math.round(r.right),top:Math.round(r.top),bottom:Math.round(r.bottom),width:Math.round(r.width),height:Math.round(r.height)}};
      return {window:document.documentElement.clientWidth,bar:box(b),card:box(document.querySelector(${JSON.stringify(card(id))})),said:b.querySelector('[data-act=more]').textContent,
        buttons:[...b.querySelectorAll('button')].filter(x=>!x.hidden).map(x=>({act:x.dataset.act,...box(x)})),sideways:document.documentElement.scrollWidth>document.documentElement.clientWidth}})()`);
    const frames = p => p.evaluate('new Promise(done=>requestAnimationFrame(()=>requestAnimationFrame(done)))');
    // What the ⋯ menu calls each button the bar can put behind it.
    const MENU = { full: 'Show full message', fold: 'Fold' };
    for (const device of Object.keys(DEVICES)) {
      const topic = 'reading-ask-bar-' + device;
      const ids = await seed(topic, [['short', { sender: 'aim-core', join: true, whole_topic: true, body: 'May I deploy release 33 now?',
        post_args: { addressees: [facts.actor], intent: 'ask', go_ahead: true } }],
        ['long', { sender: 'aim-core', whole_topic: true, body: 'May I deploy release 34 now?\n\n' + long, post_args: { addressees: [facts.actor], intent: 'ask', go_ahead: true } }]]);
      const p = await open(topic, device, topic, ids.short);
      // The page's own clipboard, so Copy Link says "Link copied" on the ⋯ and the Mac's pasteboard is never touched.
      await p.evaluate(`(()=>{if(!navigator.clipboard)Object.defineProperty(navigator,'clipboard',{configurable:true,value:{}});Object.defineProperty(navigator.clipboard,'writeText',{configurable:true,value:async text=>{(window.copied??=[]).push(text)}});return true})()`);
      const problems = [];
      // Looks at the bar in one state, and answers what it shows and what it put behind its ⋯.
      const look = async (width, id, state) => {
        const want = id === ids.long ? ['thumb', 'yes', 'no', 'reply', 'full', 'fold', 'more'] : ['thumb', 'yes', 'no', 'reply', 'fold', 'more'];
        const at = await barNow(p, id), where = `${device} ${width} ${id === ids.long ? 'long' : 'short'} ask, ${state}`;
        if (!at) { problems.push(`${where}: no bar`); return { shown: [], behind: [] }; }
        const shown = at.buttons.map(b => b.act), behind = want.filter(act => !shown.includes(act));
        // It shows its buttons in their order, ⋯ last, and puts only Show full message and Fold away.
        if (JSON.stringify(shown) !== JSON.stringify(want.filter(act => shown.includes(act))) || behind.some(act => !(act in MENU))) problems.push(`${where}: the bar is ${shown.join(' ')}, from ${want.join(' ')}`);
        if (state === 'Link copied' && at.said !== 'Link copied') problems.push(`${where}: the ⋯ says ${JSON.stringify(at.said)}`);
        for (const b of at.buttons) {
          if (b.left < 0 || b.right > at.window) problems.push(`${where}: ${b.act} runs off the window (${b.left}–${b.right} in ${at.window})`);
          if (device === 'phone' && (b.width < 44 || b.height < 44)) problems.push(`${where}: ${b.act} is ${b.width}×${b.height}, under 44px`);
        }
        if (at.bar.left < 0 || at.bar.right > at.window) problems.push(`${where}: the bar runs off the window (${at.bar.left}–${at.bar.right} in ${at.window})`);
        if (at.bar.bottom <= at.card.top || at.bar.top >= at.card.bottom) problems.push(`${where}: the bar is not over its card (bar ${at.bar.top}–${at.bar.bottom}, card ${at.card.top}–${at.card.bottom})`);
        const rows = new Set(at.buttons.map(b => b.top)).size;
        if (rows !== 1) problems.push(`${where}: the bar takes ${rows} rows`);
        if (at.sideways) problems.push(`${where}: the page scrolls sideways`);
        // Where there is room, nothing goes behind the ⋯: a laptop, and a phone's short ask at 390 before anything is said.
        if ((device === 'laptop' || (width === 390 && id === ids.short && state === 'plain')) && behind.length) problems.push(`${where}: ${behind.join(' and ')} went behind the ⋯ with room for them`);
        // Seven buttons a finger wide are wider than 320 pixels less 8 each side, and six are not: Fold alone goes.
        if (width === 320 && id === ids.long && state === 'plain' && JSON.stringify(behind) !== '["fold"]') problems.push(`${where}: behind the ⋯ is ${JSON.stringify(behind)}, not Fold alone`);
        observations.push({ name: 'ask bar in the window', engine, device, width, message: id === ids.long ? 'long' : 'short', state, rows, shown, behind, bar: at.bar, window: at.window });
        return { shown, behind };
      };
      // A press on the bar's ⋯ opens its menu (a sheet on a phone), which offers what the bar put behind it.
      const offers = async (behind, where) => {
        await press(p, device, `${BAR} [data-act=more]`);
        const items = await until(async () => { const now = await p.evaluate(`[...document.querySelectorAll('.message-menu-list [role=menuitem]')].map(b=>b.firstChild?.textContent??'')`); return now.includes('Copy Link') ? now : null; }, `${device}: the ⋯ menu offers Copy Link`);
        for (const act of behind) if (!items.includes(MENU[act])) problems.push(`${where}: the ⋯ menu does not offer ${MENU[act]}, which the bar put behind it (${items.join(', ')})`);
        return items;
      };
      // Copy Link from that menu, and the ⋯ says "Link copied".
      const copy = async (id, behind, where) => {
        const items = await offers(behind, where);
        await press(p, device, `.message-menu-list [role=menuitem]:nth-child(${items.indexOf('Copy Link') + 1})`);
        await until(() => p.evaluate(`!document.querySelector('.message-menu-list') && document.querySelector('${BAR} [data-act=more]').textContent === 'Link copied'`), `${device}: the ⋯ says Link copied`);
        await frames(p);
        assert.ok((await lit(p)).includes(id), `${device}: the message keeps its light`);
      };
      const widths = device === 'phone' ? [390, 375, 320] : [DEVICES.laptop.width];
      for (const width of widths) {
        if (width !== DEVICES[device].width) await p.send('Emulation.setDeviceMetricsOverride', { ...DEVICES[device], width });
        await until(() => p.evaluate(`innerWidth === ${width}`), `${device}: the window is ${width} wide`);
        for (const id of [ids.short, ids.long]) {
          const name = id === ids.long ? 'long' : 'short';
          await light(p, device, id);
          // The long ask's card cuts it off, and its bar offers Show full message (there is room for it before anything is said).
          if (id === ids.long) await until(async () => (await barNow(p, id))?.buttons.some(b => b.act === 'full'), `${device} ${width}: the long ask's bar offers Show full message`);
          await frames(p);
          const plain = await look(width, id, 'plain');
          if (width === 320 || device === 'laptop') for (const theme of ['light', 'dark']) {
            await p.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: theme }] });
            await frames(p); await shot(p, `ask-bar-${device}-${width}-${name}-${theme}`);
          }
          await p.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'light' }] });
          await copy(id, plain.behind, `${device} ${width} ${name} ask`);
          const copied = await look(width, id, 'Link copied');
          if (width === 320) await shot(p, `ask-bar-${device}-${width}-${name}-copied`);
          // The next press on the ⋯ opens its menu, offering what the bar put behind it for "Link copied", and once it
          // has landed the ⋯ says ⋯ again and what went behind it comes back; Escape closes the menu.
          await offers(copied.behind, `${device} ${width} ${name} ask, Link copied`);
          await p.key('Escape');
          await until(() => p.evaluate(`!document.querySelector('.message-menu-list')`), `${device}: Escape closes the ⋯ menu`);
          await until(() => p.evaluate(`document.querySelector('${BAR} [data-act=more]').textContent === '⋯'`), `${device}: the ⋯ says ⋯ again`);
          await frames(p);
          const again = await look(width, id, '⋯ again');
          if (JSON.stringify(again.shown) !== JSON.stringify(plain.shown)) problems.push(`${device} ${width} ${name} ask: with ⋯ again the bar is ${again.shown.join(' ')}, not ${plain.shown.join(' ')} as before Link copied`);
        }
      }
      assert.deepEqual(problems, [], `${device}: every button of the bar in the window, in one row`);
      assert.equal(await readerOn(p), null, `${device}: nothing opened`);
      // Both asks are answered, so no topic is left waiting on the reader: the rail's waiting light it would leave lit
      // widens the rail's first row for every check after this one. Each answer is a reply, which folds its ask into its
      // stack's head row and moves the cards: the page shows the reply and the bar's ✅ holds its place across two
      // frames before the next press.
      for (const id of [ids.long, ids.short]) {
        const name = id === ids.long ? 'long' : 'short';
        if (!(await lit(p)).includes(id)) await light(p, device, id);
        await until(() => p.evaluate(`new Promise(done=>{const at=()=>JSON.stringify(document.querySelector('${BAR} [data-act=yes]')?.getBoundingClientRect()??null),first=at();requestAnimationFrame(()=>requestAnimationFrame(()=>done(first!=='null'&&first===at())))})`), `${device}: the ${name} ask's ✅ holds its place`);
        await press(p, device, `${BAR} [data-act=yes]`);
        await until(async () => (await reactions(id)).answers.some(a => a.actor_id === facts.actor && a.answer === 'yes'), `${device}: Core holds ✅ on the ${name} ask`);
        const reply = await until(async () => (await view('topic_messages', { topic_id: topic, direction: 'before', limit: 10 })).items.find(item => item.reply_to === id && item.author_id === facts.actor)?.id, `${device}: the ${name} ask's answer is a reply`);
        await until(() => p.evaluate(`Boolean(document.querySelector('#messages [data-id="${reply}"]')) && window.fetchesOut === 0`), `${device}: the page shows the ${name} ask's answer`);
      }
      assert.deepEqual(p.errors, []);
      await p.close();
    }
  });

  // A finger held on a go-ahead ask's one-row head while the page hears of an act on another device of the
  // person's (item 355, B5): a star on a message this page has not loaded moves no dossier and draws no stack
  // again; a star on one it shows does, and that repaint, waiting for the finger to lift (press-hold.mjs), runs
  // as it lifts and replaces the head's row under it. Either way the tap opens the head and the ask keeps its
  // light and its bar, ✅ pressed. A pointer's release lets no light go, so this is the phone's. In WebKit the
  // star is read just before the tap (tap, during).
  await check('reading a phone\'s tap on a go-ahead ask\'s one-row head keeps the ask lit with its ✅ bar while the page hears of a star made on another device', async () => {
    const device = 'phone';
    for (const starred of ['unloaded', 'shown']) {
      const topic = 'reading-ask-held-' + starred;
      // 31 earlier messages, one more than the page first loads, so the oldest is not loaded.
      const earlier = Array.from({ length: 31 }, (_, i) => ['e' + i, { sender: 'aim-ux', ...(i === 0 ? { join: true } : {}), body: `Earlier message ${i + 1}.`, read: true }]);
      const ids = await seed(topic, [...earlier, ['ask', { sender: 'aim-core', join: true, whole_topic: true, body: 'May I deploy release 32 now?',
        post_args: { addressees: [facts.actor], intent: 'ask', go_ahead: true } }]]);
      const p = await open('reading-ask-held-' + starred, device, topic, ids.ask);
      const target = starred === 'unloaded' ? ids.e0 : ids.e30;
      assert.equal(await p.evaluate(`Boolean(document.querySelector(${JSON.stringify(card(target))}))`), starred === 'shown', `phone: the starred message is ${starred === 'shown' ? '' : 'not '}loaded`);
      const choices = card(ids.ask) + ' > .message-reactions';
      await light(p, device, ids.ask);
      await press(p, device, `${BAR} [data-act=yes]`);
      await until(async () => (await reactions(ids.ask)).answers.some(a => a.actor_id === facts.actor && a.answer === 'yes'), 'phone: Core holds ✅');
      const reply = await until(async () => (await view('topic_messages', { topic_id: topic, direction: 'before', limit: 5 })).items
        .find(item => item.reply_to === ids.ask && item.author_id === facts.actor)?.id, 'phone: the agent is told by a reply');
      await until(() => p.evaluate(`Boolean(document.querySelector('#messages [data-id="${reply}"]'))`), 'phone: the page shows the reply');
      await until(() => p.evaluate(`document.querySelector(${JSON.stringify(choices)}).getClientRects().length === 0`), 'phone: the ask folds into its stack\'s one-row head');
      if (!(await lit(p)).includes(ids.ask)) await light(p, device, ids.ask);
      await until(() => p.evaluate('window.fetchesOut === 0'), 'phone: the page has read all it heard of');
      // The finger down on the head; the star on another device; the page reads the topic's acts and the dossiers'
      // places again; then the finger lifts.
      await centre(p, card(ids.ask));
      await tap(p, card(ids.ask) + ' > .stack-head > .stack-who', 'corner', async () => {
        await p.evaluate(`(window.watched = false, window.watchFor = ${JSON.stringify({ read: 'stack_positions', words: ids.ask })})`);
        await control({ method: 'stack_act', sender: facts.actor, kind: 'message.star', message_id: target, operation_id: topic + '-star', args: { starred: true } });
        await until(() => p.evaluate('window.watched === true && window.fetchesOut === 0'), 'phone: the page reads the dossiers\' places after the star');
        await p.evaluate('new Promise(done=>requestAnimationFrame(()=>requestAnimationFrame(done)))');
      });
      // The head row is the dossier's title (item 471): the tap opens the dossier, its light kept on the ask it landed
      // in, and the ask, which the answer folded, shows as its row; a tap on that row shows it whole.
      await until(() => p.evaluate(`document.querySelector(${JSON.stringify(card(ids.ask))}).closest('.reply-stack')?.dataset.headOpen === 'true'`), 'phone: the tap on the head opens the dossier');
      assert.ok((await lit(p)).includes(ids.ask), `phone, a star on a message ${starred === 'shown' ? 'the page shows' : 'not loaded'}: the tap held through the repaint keeps the light on the ask (lit ${JSON.stringify(await lit(p))})`);
      if (await foldedRow(p, ids.ask)) await unfoldRow(p, device, ids.ask);
      await until(() => p.evaluate(`document.querySelector(${JSON.stringify(choices)}).getClientRects().length > 0`), 'phone: the ask shows whole');
      if (starred === 'shown') await until(() => p.evaluate(`document.querySelector(${JSON.stringify(card(target))})?.dataset.starred === 'true'`), 'phone: the page shows the star');
      await until(async () => (await lit(p)).includes(ids.ask) && (await bar(p))?.yes === 'true' && (await bar(p))?.no === 'false',
        `phone, a star on a message ${starred === 'shown' ? 'the page shows' : 'not loaded'}: the ask stays lit and its bar shows ✅`).catch(async error => {
        throw Object.assign(error, { message: `${error.message} (lit ${JSON.stringify(await lit(p))}, bar ${JSON.stringify(await bar(p))})` });
      });
      assert.equal(await readerOn(p), null, 'phone: the tap opens nothing');
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

  // What the keys select comes fully into view (item 379, docs/interaction.md, web/reveal.mjs). WHERE, in the
  // page: the message entries on show, top to bottom; which one is lit (i of n); the box of what shows as
  // selected (its card, or for a dossier's compact header the whole dossier, whole); the ones beside it; the
  // window's height and scroll.
  const WHERE = `(()=>{const list=document.querySelector('#messages'),shown=[...list.querySelectorAll(':scope > [data-id], :scope > .reply-stack > [data-id], :scope > .reply-stack > .stack-replies > [data-id]')].filter(e=>e.getClientRects().length);
    const lit=list.querySelector('.lit[data-id]'),i=lit?shown.findIndex(e=>e===lit||e.contains(lit)):-1;if(i<0)return {i,n:shown.length};
    const entry=shown[i],s=entry.parentElement.classList.contains('reply-stack')?entry.parentElement:null,whole=Boolean(s&&s.dataset.single==='false'&&s.dataset.headOpen==='false'&&s.firstElementChild===entry);
    const r=(whole?s:lit).getBoundingClientRect(),beside=k=>shown[k]?.getBoundingClientRect()??null;
    return {i,n:shown.length,whole,top:r.top,bottom:r.bottom,prevBottom:beside(i-1)?.bottom??null,nextTop:beside(i+1)?.top??null,h:innerHeight,y:scrollY,max:document.documentElement.scrollHeight-innerHeight}})()`;
  const TENTH = 0.1, close = (a, b) => Math.abs(a - b) <= 1.5;
  // Presses key (↓ or ↑) from the lit message to the last one that way, holding each step to the rule: one
  // taller than the window lands its top a tenth below the top; one that fits shows whole, and scrolls
  // nothing when it already stood a tenth inside (or the room there is), else the least that leaves that room
  // beyond the edge it came in at, where the page can scroll that far. The steps, each with how far it scrolled.
  const walk = async (p, device, key) => {
    const way = key === 'ArrowDown' ? 1 : -1, steps = [];
    let before = await p.evaluate(WHERE);
    assert.ok(before.i >= 0, `${device}: a message is lit before the keys walk`);
    while (before.i + way >= 0 && before.i + way < before.n) {
      await p.key(key);
      await until(async () => (await p.evaluate(WHERE)).i === before.i + way, `${device}: ${key} lights the next message along`);
      const now = await p.evaluate(WHERE), moved = now.y - before.y, h = now.h, size = now.bottom - now.top;
      const atEnd = now.y >= now.max - 0.5, atTop = now.y <= 0.5;
      const said = `${device}: ${way > 0 ? '↓' : '↑'} onto ${now.whole ? 'a dossier' : 'a message'}, ${now.i + 1} of ${now.n}: ${JSON.stringify({ was: before, now })}`;
      if (size > h) {
        // Unless the page cannot scroll the way that would take it.
        if (!(now.top < h * TENTH ? atTop : atEnd)) assert.ok(close(now.top, h * TENTH), said + ': taller than the window, its top lands a tenth below the top');
      } else {
        const room = Math.min(h * TENTH, h - size), was = { top: now.top + moved, bottom: now.bottom + moved };
        assert.ok(now.top >= -0.5 && now.bottom <= h + 0.5, said + ': it shows whole');
        const low = was.bottom > h - room + 0.5, high = was.top < room - 0.5;
        if (!low && !high) assert.equal(moved, 0, said + ': one already a tenth inside the window scrolls nothing');
        else if (low && !high && !atEnd) assert.ok(close(now.bottom, h - room), said + ': it scrolls the least that leaves a tenth of the window below it');
        else if (high && !low && !atTop) assert.ok(close(now.top, room), said + ': it scrolls the least that leaves a tenth of the window above it');
        if (room === h * TENTH && way > 0 && now.nextTop !== null) assert.ok(now.nextTop < h - 1, said + ': the next message shows below it');
        if (room === h * TENTH && way < 0 && now.prevBottom !== null && !atTop) assert.ok(now.prevBottom > 1, said + ': the message above it shows');
      }
      steps.push({ ...now, moved });
      before = now;
    }
    return steps;
  };
  // The keys start from nothing lit, at the top of the page: ↓ lights the top message.
  const keysFromTop = async (p, device) => {
    if (device === 'laptop') await away(p);
    await p.evaluate('(document.activeElement?.blur(), scrollTo(0, 0))');
    await p.key('ArrowDown');
    await until(async () => (await p.evaluate(WHERE)).i === 0, `${device}: ↓ with nothing lit lights the top message`);
  };

  await check('reading ↓ and ↑ down a long feed bring each message fully into view with a tenth of the window beyond it, and a click, a tap or the pointer resting on a card near the bottom scrolls nothing', async () => {
    for (const device of Object.keys(DEVICES)) {
      const topic = 'reading-margin-' + device;
      const ids = await seed(topic, Array.from({ length: 16 }, (_, k) => [`m${k}`, { sender: 'aim-core', ...(k === 0 ? { join: true } : {}), ...(k === 15 ? { read: true } : {}),
        addressees: [facts.actor], body: `Message ${k} of a long feed. ` + 'Words to read, enough for a card of a few lines. '.repeat(3) }]));
      const p = await open('reading-margin-' + device, device, topic, ids.m0);
      await keysFromTop(p, device);
      const down = await walk(p, device, 'ArrowDown');
      assert.ok(down.filter(step => step.moved > 0).length >= 3, `${device}: going down, the keys scrolled the page at least three times: ${JSON.stringify(down.map(step => step.moved))}`);
      await shot(p, 'reading-margin-' + device);
      const up = await walk(p, device, 'ArrowUp');
      assert.ok(up.filter(step => step.moved < 0).length >= 3, `${device}: going up, the keys scrolled the page at least three times: ${JSON.stringify(up.map(step => step.moved))}`);
      // A card reaching into the bottom tenth, where a key would scroll it: the pointer resting on it, a click
      // (which opens it in the Reader) or a tap (which lights it) leaves the page where it is.
      const target = ids.m7, scrollY = () => p.evaluate('scrollY');
      await p.evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(card(target))});scrollBy({top:e.getBoundingClientRect().top-innerHeight*0.85,behavior:'instant'})})()`);
      assert.equal(await p.evaluate(`document.querySelector(${JSON.stringify(card(target))}).getBoundingClientRect().bottom > innerHeight * 0.9`), true,
        `${device}: the card reaches into the bottom tenth of the window`);
      const still = await scrollY();
      if (device === 'laptop') {
        await p.point(words(target), 'move');
        await until(async () => (await lit(p)).includes(target), 'laptop: the pointer resting on the card lights it');
        assert.equal(await scrollY(), still, 'laptop: the pointer resting on a card near the bottom scrolls nothing');
        await p.point(words(target));
        await until(async () => (await readerOn(p))?.startsWith('Message 7'), 'laptop: a click opens the card in the Reader');
        assert.equal(await scrollY(), still, 'laptop: a click on a card near the bottom scrolls nothing');
        await closeReader(p, device);
      } else {
        await tap(p, words(target));
        await until(async () => (await lit(p)).includes(target), 'phone: a tap lights the card');
        assert.equal(await scrollY(), still, 'phone: a tap on a card near the bottom scrolls nothing');
        assert.equal(await readerOn(p), null, 'phone: and opens nothing');
      }
      assert.deepEqual(p.errors, []);
      await p.close();
    }
  });

  await check('reading a dossier taller than the window, its header selected by ↓ or by ↑, lands with its top a tenth below the top, and the keys bring each of its replies into view whole', async () => {
    for (const device of Object.keys(DEVICES)) {
      const topic = 'reading-margin-dossier-' + device;
      // Every reply unread, so the dossier, at its first fold, shows them all under its compact header. The
      // page's reports of what it read are held, so nothing changes under the keys.
      const replies = Array.from({ length: 7 }, (_, k) => [`r${k}`, { sender: 'aim-core', reply_to: 'root', addressees: [facts.actor],
        body: `Reply ${k}, a long one. ` + 'A reply that takes several lines to read, so the dossier with all of its replies is taller than the window. '.repeat(5) }]);
      const ids = await seed(topic, [['old', { sender: 'aim-core', join: true, addressees: [facts.actor], body: 'The oldest message, on its own, below the dossier.' }],
        ['root', { sender: 'aim-core', addressees: [facts.actor], body: 'The message the long replies answer.' }], ...replies,
        ['top', { sender: 'aim-core', addressees: [facts.actor], body: 'The newest message, on its own, above the dossier.' }]]);
      const p = await open('reading-margin-dossier-' + device, device, topic, ids.old, 'window.holdReads = true;');
      const dossier = `#messages .reply-stack[data-stack="${ids.root}"]`;
      assert.equal(await p.evaluate(`(s=>s.dataset.headOpen==='false'&&s.getBoundingClientRect().height>innerHeight)(document.querySelector(${JSON.stringify(dossier)}))`), true,
        `${device}: the dossier shows its compact header and its replies, taller than the window`);
      await keysFromTop(p, device);
      const down = await walk(p, device, 'ArrowDown'), onto = down.find(step => step.whole);
      assert.ok(onto && close(onto.top, onto.h * TENTH), `${device}: ↓ onto the dossier's header lands the dossier's top a tenth below the top: ${JSON.stringify(onto)}`);
      assert.ok(onto.bottom - onto.top > onto.h, `${device}: what the keys brought into view is the whole dossier, taller than the window`);
      await shot(p, 'reading-margin-dossier-' + device);
      const up = await walk(p, device, 'ArrowUp'), back = up.find(step => step.whole);
      assert.ok(back && close(back.top, back.h * TENTH) && back.moved < 0, `${device}: ↑ onto the dossier's header from its replies lands its top a tenth below the top: ${JSON.stringify(back)}`);
      assert.deepEqual(p.errors, []);
      await p.close();
    }
  });

  await check('reading a dossier showing its whole first message, its chevron selected by ↓, comes into view as the whole dossier, its top a tenth below the top when it is taller than the window', async () => {
    for (const device of Object.keys(DEVICES)) {
      const topic = 'reading-margin-chevron-' + device;
      // Six replies, seven messages with the first: opened, the dossier shows every one of them whole (one of more than
      // seven shows its newest seven and one row for the earlier ones, item 476, its first message among those).
      const replies = Array.from({ length: 6 }, (_, k) => [`r${k}`, { sender: 'aim-core', reply_to: 'root', addressees: [facts.actor],
        body: `Reply ${k}, a long one. ` + 'A reply that takes several lines to read, so the dossier with all of its replies is taller than the window. '.repeat(5) }]);
      const ids = await seed(topic, [['old', { sender: 'aim-core', join: true, addressees: [facts.actor], body: 'The oldest message, on its own, below the dossier.' }],
        ['root', { sender: 'aim-core', addressees: [facts.actor], body: 'The message the long replies answer.' }], ...replies,
        ['top', { sender: 'aim-core', addressees: [facts.actor], body: 'The newest message, on its own, above the dossier.' }]]);
      const p = await open('reading-margin-chevron-' + device, device, topic, ids.old, 'window.holdReads = true;');
      const dossier = `#messages .reply-stack[data-stack="${ids.root}"]`;
      // The dossier as it shows: its first message whole or not, whether its chevron has the keys, its box and the window's.
      const shown = () => p.evaluate(`(s=>{const r=s.getBoundingClientRect();return {headOpen:s.dataset.headOpen,chevron:document.activeElement===s.querySelector(':scope > .stack-toggle'),
        top:r.top,bottom:r.bottom,h:innerHeight,y:scrollY}})(document.querySelector(${JSON.stringify(dossier)}))`);
      await keysFromTop(p, device);
      await p.key('ArrowDown');
      await until(async () => { const w = await p.evaluate(WHERE); return w.i === 1 && w.whole; }, `${device}: ↓ selects the dossier's compact header`);
      // → opens the dossier fully, its first message whole, and its chevron becomes a stop of its own.
      for (let n = 0; n < 3 && (await shown()).headOpen !== 'true'; n++) await p.key('ArrowRight');
      await until(async () => (await shown()).headOpen === 'true', `${device}: → opens the dossier fully`);
      // ↑ back to the newest message, above it, then ↓ onto the chevron.
      for (let n = 0; n < 4 && (await p.evaluate(WHERE)).i !== 0; n++) await p.key('ArrowUp');
      await until(async () => (await p.evaluate(WHERE)).i === 0, `${device}: ↑ lights the newest message again`);
      const before = await shown();
      assert.ok(before.top > before.h * 0.1 + 20, `${device}: before ↓, the dossier's top stands well below a tenth of the window: ${JSON.stringify(before)}`);
      await p.key('ArrowDown');
      await until(async () => (await shown()).chevron, `${device}: ↓ puts the keys on the dossier's chevron`);
      const now = await shown();
      assert.ok(now.bottom - now.top > now.h, `${device}: the dossier, fully open, is taller than the window: ${JSON.stringify(now)}`);
      assert.ok(close(now.top, now.h * TENTH), `${device}: ↓ onto the chevron brings the whole dossier into view, its top a tenth below the window's top: ${JSON.stringify({ before, now })}`);
      await shot(p, 'reading-margin-chevron-' + device);
      assert.deepEqual(p.errors, []);
      await p.close();
    }
  });

  await check('reading #img: ↓ and ↑ through a long list of images bring the one chosen into view with a tenth of the list beyond it', async () => {
    // A laptop's keys: a phone picks from the list with a tap.
    const topic = 'reading-img-margin';
    const ids = await seed(topic, Array.from({ length: 9 }, (_, k) => [`i${k}`, { sender: 'aim-core', ...(k === 0 ? { join: true } : {}), addressees: [facts.actor],
      body: `Image ${k}.`, attachments: [{ name: `image-${k}.png`, image: k % 2 ? 'one.png' : 'screen.png' }] }]));
    const p = await open('reading-img-margin', 'laptop', topic, ids.i8);
    await into(p, 'laptop', '#inline-writing-body');
    await p.send('Input.insertText', { text: '#img' });
    // The list: how many images, which one is chosen, its box against what of the list shows in the window, and
    // how far the list is and can be scrolled.
    const LIST = `(()=>{const l=document.getElementById('inline-writing-body-images');if(!l||l.hidden)return null;const o=[...l.querySelectorAll('.image-option')],i=o.findIndex(x=>x.getAttribute('aria-selected')==='true');
      const s=l.getBoundingClientRect(),top=Math.max(s.top,0),bottom=Math.min(s.bottom,innerHeight),r=o[i]?.getBoundingClientRect();
      return {n:o.length,i,top:r?r.top-top:null,bottom:r?r.bottom-top:null,h:bottom-top,y:l.scrollTop,max:l.scrollHeight-l.clientHeight}})()`;
    await until(async () => (await p.evaluate(LIST))?.n === 9, 'the list shows the topic\'s nine images');
    assert.ok((await p.evaluate(LIST)).max > 0, 'the list scrolls');
    const walk = async (key, words) => {
      const ys = [];
      let before = await p.evaluate(LIST);
      while (key === 'ArrowDown' ? before.i < before.n - 1 : before.i > 0) {
        await p.key(key);
        await until(async () => (await p.evaluate(LIST)).i !== before.i, `${words}: the next image is chosen`);
        const now = await p.evaluate(LIST), room = now.h * TENTH, moved = now.y - before.y, said = `${words}, onto ${now.i + 1} of ${now.n}: ${JSON.stringify({ before, now })}`;
        assert.ok(now.top >= -0.5 && now.bottom <= now.h + 0.5, said + ': it shows whole');
        if (now.y < now.max - 0.5) assert.ok(now.bottom <= now.h - room + 1.5, said + ': a tenth of the list shows below it');
        if (now.y > 0.5) assert.ok(now.top >= room - 1.5, said + ': a tenth of the list shows above it');
        if (now.top + moved >= room + 1.5 && now.bottom + moved <= now.h - room - 1.5) assert.equal(moved, 0, said + ': one already a tenth inside scrolls nothing');
        ys.push(now.y); before = now;
      }
      assert.ok(new Set(ys).size >= 3, `${words}: the list scrolled as the keys went: ${JSON.stringify(ys)}`);
    };
    await walk('ArrowDown', '↓ down the list');
    await walk('ArrowUp', '↑ up the list');
    await p.key('Escape');
    assert.deepEqual(p.errors, []);
    await p.close();
  });

  await check('reading Show full message removes clipping for just that feed card, in topics and Conversation, until the page is left', async () => {
    for (const device of Object.keys(DEVICES)) for (const conversation of [false, true]) {
      const name = `reading-show-full-${device}-${conversation}`, body = Array.from({ length: 70 }, (_, i) => `Paragraph ${i}. Words that need the full height of the message to be read.`).join('\n\n');
      let topic = name;
      if (conversation) {
        await control({ method: 'navigation_workspaces', workspaces: [{ id: name, title: name, team: ['fable'], coordinator: 'fable' }] });
        topic = (await view('conversation', { workspace_id: name })).conversation.topic_id;
      } else await control({ method: 'navigation_topics', topics: [{ id: topic, title: name }] });
      const say = async (n, text, reply_to = null) => (await control({ method: 'agent_message', operation_id: `${name}-${n}`, topic_id: topic, source: 'topic', sender: 'fable', join: !conversation && n === 0, addressees: [facts.actor], body: text, ...(reply_to ? { reply_to } : {}) })).result.message_id;
      const root = await say(0, 'A short stack root.'), reply = await say(1, body, root), alone = await say(2, body);
      const p = await open(name, device, topic, alone, 'window.holdReads = true;');
      // The card's box, the words' own box inside it, and what the dossier's look adds below the words: a card a
      // later face overlaps takes that overlap as padding under its words (docs/reply-stacks.md, "The look").
      const geometry = id => p.evaluate(`(c=>({height:c.getBoundingClientRect().height,overflow:c.scrollHeight-c.clientHeight,words:c.querySelector('.message-preview').textContent,
        wordsHeight:c.querySelector('.message-preview').getBoundingClientRect().height,padding:parseFloat(getComputedStyle(c).paddingBottom),covered:c.dataset.stackCovered==='true',
        overlap:parseFloat(getComputedStyle(c).getPropertyValue('--stack-overlap')),excerpt:c.querySelector('.message-preview-cue')?.getClientRects().length??0}))(document.querySelector(${JSON.stringify(card(id))}))`);
      const show = async id => {
        await light(p, device, id);
        await until(() => p.evaluate(`document.querySelector(${JSON.stringify(card(id))}).dataset.whole==='shown'`), name + ': the complete source is loaded into the clipped card');
        const before = await geometry(id);
        assert.ok(before.overflow > 100, name + ': the message starts clipped');
        await press(p, device, BAR + ' [data-act="more"]');
        const index = await p.evaluate(`[...document.querySelectorAll('.message-menu-list > button')].findIndex(b=>b.textContent==='Show full message')`);
        assert.ok(index >= 0, name + ': the clipped message offers Show full message');
        await press(p, device, `.message-menu-list > button:nth-child(${index + 1})`);
        await until(async () => (await geometry(id)).height > before.height + 100, name + ': the card grows to show its entire message');
        const whole = await geometry(id);
        assert.ok(whole.overflow <= 1, name + ': nothing remains in an internal scrolling viewport');
        assert.ok(whole.words.includes('Paragraph 69.'), name + ': the last paragraph is present');
        assert.equal(whole.excerpt, 0, name + ': the excerpt cue is gone');
        assert.equal(await readerOn(p), null, name + ': no Reader opened');
      };
      const replyHeight = (await geometry(reply)).height;
      await show(alone);
      assert.equal((await geometry(reply)).height, replyHeight, name + ': the other card has not expanded');
      await show(reply);
      const shown = await geometry(reply), height = shown.height;
      assert.equal(shown.covered, false, name + ': the long reply is the dossier\'s last face, overlapped by nothing');
      // A real new reply causes live rearrangement; the choice remains on the same card.
      await say(3, 'Another reply arriving while the long message is shown.', root);
      await until(() => p.evaluate(`document.querySelector('#messages').textContent.includes('Another reply arriving')`), name + ': the live reply arrived');
      // The new reply's face overlaps the long one's foot (item 429), which takes exactly that overlap as padding
      // under its words. The words themselves keep their whole height, nothing scrolls inside the card, and the
      // card grows by that padding and nothing else, so what shows of it above the new face is what showed before.
      const after = await geometry(reply);
      assert.equal(after.covered, true, name + ': the reply that arrived overlaps the long one');
      assert.equal(after.wordsHeight, shown.wordsHeight, name + ': a live update keeps the whole message\'s height');
      assert.ok(after.overflow <= 1 && after.words === shown.words && after.excerpt === 0, name + ': a live update keeps the full message, unclipped: ' + JSON.stringify({ shown, after }));
      assert.ok(after.overlap > 0, name + ': the look names its overlap: ' + JSON.stringify(after));
      // Layout rounds a box to a 64th of a pixel.
      assert.ok(Math.abs(after.padding - shown.padding - after.overlap) < 0.02, name + ': the card takes the overlap as padding under its words: ' + JSON.stringify({ shown, after }));
      assert.ok(Math.abs(after.height - height - after.overlap) < 0.02, name + ': the card grows by that padding alone: ' + JSON.stringify({ shown, after }));
      await shot(p, name);
      assert.deepEqual(p.errors, []); await p.close();
      const q = await open(name + '-new-page', device, topic, alone, 'window.holdReads = true;');
      assert.ok(await q.evaluate(`(c=>c.getBoundingClientRect().height<${height}-100)(document.querySelector(${JSON.stringify(card(reply))}))`), name + ': a new page has the ordinary clipped card');
      assert.deepEqual(q.errors, []); await q.close();
      // The person reads the topic to its end, so the outcome a Conversation run made has nothing new in it: on a
      // phone the cases after this one would otherwise show "new in other outcomes" under their header.
      await control({ method: 'agent_message', operation_id: `${name}-read`, topic_id: topic, source: 'topic', sender: 'fable', addressees: [facts.actor], body: 'Read to the end.', read: true });
    }
  });

  await check('reading Show full message preserves the excerpt on a failed source read and retries without opening the Reader', async () => {
    const topic = 'reading-show-full-retry', body = Array.from({ length: 70 }, (_, i) => `Paragraph ${i}. Words that need the full height of the message to be read.`).join('\n\n');
    const ids = await seed(topic, [['long', { sender: 'aim-core', join: true, addressees: [facts.actor], body }]]);
    const init = `(()=>{window.failWhole=true;const f=window.fetch;window.fetch=(url,init)=>{let b;try{b=JSON.parse(init?.body)}catch{};if(window.failWhole&&b?.name==='source')return Promise.resolve(new Response(JSON.stringify({error:{message:'Source offline for this check'}}),{status:503,headers:{'Content-Type':'application/json'}}));return f(url,init)}})()`;
    const p = await open(topic, 'laptop', topic, ids.long, init);
    const choose = async () => {
      await light(p, 'laptop', ids.long); await press(p, 'laptop', BAR + ' [data-act="more"]');
      const index = await p.evaluate(`[...document.querySelectorAll('.message-menu-list > button')].findIndex(b=>b.textContent==='Show full message')`);
      assert.ok(index >= 0, 'the action remains available');
      await press(p, 'laptop', `.message-menu-list > button:nth-child(${index + 1})`);
    };
    const shape = () => p.evaluate(`(c=>({height:c.getBoundingClientRect().height,words:c.querySelector('.message-preview').textContent}))(document.querySelector(${JSON.stringify(card(ids.long))}))`);
    await light(p, 'laptop', ids.long); const before = await shape();
    await choose();
    await until(() => p.evaluate(`document.querySelector('#app-status').textContent.includes('Source offline')`), 'the failed read is reported');
    assert.deepEqual(await shape(), before, 'a failed source read loses neither the excerpt nor its layout');
    await p.evaluate('window.failWhole=false'); await choose();
    await until(async () => (await shape()).height > before.height + 100, 'retry displays the full source');
    assert.equal(await readerOn(p), null, 'retry never opens a modal');
    assert.deepEqual(p.errors, []); await p.close();
  });

  // A lit card is a box the reader may have scrolled inside; growing it to the
  // whole message keeps the words they were reading where they were
  // (docs/experience-guidelines.md, "Your place holds"), and on a card never
  // scrolled inside, moves neither the words nor the page.
  await check('reading Show full message on a card scrolled inside keeps the words being read where they were', async () => {
    for (const device of Object.keys(DEVICES)) {
      const topic = 'reading-show-full-place-' + device, body = Array.from({ length: 70 }, (_, i) => `Paragraph ${i}. Words that need the full height of the message to be read.`).join('\n\n');
      const ids = await seed(topic, [['scrolled', { sender: 'aim-core', join: true, addressees: [facts.actor], body }],
        ['still', { sender: 'aim-core', addressees: [facts.actor], body }], ['after', { sender: 'aim-core', addressees: [facts.actor], body: 'A short message below.' }]]);
      const p = await open(topic, device, topic, ids.scrolled, 'window.holdReads = true;');
      const frames = () => p.evaluate('new Promise(done=>requestAnimationFrame(()=>requestAnimationFrame(done)))');
      // Where some words of a card show in the window, with the card's own scroll and the page's.
      const place = (id, text) => p.evaluate(`(()=>{const c=document.querySelector(${JSON.stringify(card(id))}),w=document.createTreeWalker(c,NodeFilter.SHOW_TEXT);let n;
        while((n=w.nextNode())){const i=n.data.indexOf(${JSON.stringify(text)});if(i>=0){const r=document.createRange();r.setStart(n,i);r.setEnd(n,i+${text.length});
          return {y:Math.round(r.getBoundingClientRect().top),inner:c.scrollTop,pageY:scrollY,full:c.dataset.full==='shown',overflow:c.scrollHeight-c.clientHeight}}}return null})()`);
      const showFull = async id => {
        await press(p, device, BAR + ' [data-act="more"]');
        const index = await p.evaluate(`[...document.querySelectorAll('.message-menu-list > button')].findIndex(b=>b.textContent==='Show full message')`);
        assert.ok(index >= 0, `${device}: the lit message offers Show full message`);
        await press(p, device, `.message-menu-list > button:nth-child(${index + 1})`);
        await until(async () => (await place(id, 'Paragraph 0.'))?.full === true, `${device}: the card shows its whole message`);
        await frames();
      };
      await light(p, device, ids.scrolled);
      await until(() => p.evaluate(`(c=>c.dataset.whole==='shown'&&c.classList.contains('scroll-in-place'))(document.querySelector(${JSON.stringify(card(ids.scrolled))}))`), `${device}: lit, the card is a box holding the whole message`);
      // Read on inside the box, as the reader does.
      if (device === 'laptop') {
        const [x, y] = await within(p, card(ids.scrolled));
        await p.send('Input.dispatchMouseEvent', { type: 'mouseWheel', x, y, deltaX: 0, deltaY: 400 });
      } else if ('pw' in p) {
        // Safari's engine in this harness has no finger drag: the box is put where a drag would leave it.
        await p.evaluate(`document.querySelector(${JSON.stringify(card(ids.scrolled))}).scrollTop = 400`);
        observations.push({ name: 'reading Show full after a drag inside', engine: 'webkit', held: 'the box scrolled by scrollTop; no drag in this harness' });
      } else {
        const [x, y] = await within(p, card(ids.scrolled));
        await p.send('Input.synthesizeScrollGesture', { x, y, yDistance: -400, gestureSourceType: 'touch', speed: 1200 });
      }
      await until(async () => (await place(ids.scrolled, 'Paragraph 20.')).inner >= 100, `${device}: the box scrolled inside`);
      await frames();
      const before = await place(ids.scrolled, 'Paragraph 20.');
      await showFull(ids.scrolled);
      const after = await place(ids.scrolled, 'Paragraph 20.');
      assert.ok(after.overflow <= 1, `${device}: nothing is left to scroll inside the card`);
      assert.ok(Math.abs(after.y - before.y) <= 2, `${device}: the words being read stay where they were (y ${before.y} → ${after.y}, inner scroll ${before.inner})`);
      // Never scrolled inside: neither the words nor the page move.
      await light(p, device, ids.still);
      await until(() => p.evaluate(`document.querySelector(${JSON.stringify(card(ids.still))}).dataset.whole==='shown'`), `${device}: the other card is read whole`);
      await frames();
      const still = await place(ids.still, 'Paragraph 0.');
      assert.equal(still.inner, 0, `${device}: not scrolled inside`);
      await showFull(ids.still);
      const grown = await place(ids.still, 'Paragraph 0.');
      assert.deepEqual([grown.y, grown.pageY], [still.y, still.pageY], `${device}: an unscrolled card grows below its words and the page holds still`);
      await shot(p, topic);
      assert.deepEqual(p.errors, []); await p.close();
    }
  });

  await check('reading a cut-off message scrolls in place under the wheel or a finger, and the page does not move', async () => {
    for (const device of Object.keys(DEVICES)) {
      const topic = 'reading-long-' + device;
      const body = Array.from({ length: 80 }, (_, i) => `Line ${i} of a long message that runs on past what a card shows.`).join('\n');
      // Older messages below it leave the page room to scroll on past the box's edge: the topic's Team is in its header
      // now (item 465), so the page no longer runs on below the feed.
      const ids = await seed(topic, [...Array.from({ length: 3 }, (_, i) => ['before' + i, { sender: 'aim-core', join: i === 0, addressees: [facts.actor], body: 'An earlier message ' + i + '.' }]),
        ['long', { sender: 'aim-ux', join: true, addressees: [facts.actor], body }],
        ...Array.from({ length: 6 }, (_, i) => ['after' + i, { sender: 'aim-core', addressees: [facts.actor], body: 'A short message ' + i + '.' }])]);
      const p = await open('reading-long-' + device, device, topic, ids.long);
      const preview = card(ids.long);
      const state = () => p.evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(preview)}),s=getComputedStyle(e),b=e.getBoundingClientRect();
        return {inPlace:e.classList.contains('scroll-in-place'),top:e.scrollTop,more:e.scrollHeight-e.clientHeight,overflow:s.overflowY,height:b.height,window:innerHeight,pageY:scrollY,
          authorBottom:e.querySelector('.message-author').getBoundingClientRect().bottom-b.top,excerpt:e.querySelector('.message-preview').getBoundingClientRect().height}})()`);
      await centre(p, card(ids.long));
      const before = await state();
      assert.equal(before.inPlace, false, device + ': cut off, until it lights');
      await light(p, device, ids.long);
      await until(async () => (await state()).inPlace && (await state()).more > 100, device + ': lit, its words become a box holding the whole message');
      const box = await state();
      assert.equal(box.overflow, 'auto', device + ': the box scrolls');
      assert.ok(Math.abs(box.height - before.height) <= 1, `${device}: the box keeps the excerpt's height (${before.height} → ${box.height})`);
      if (device === 'phone') assert.ok(before.excerpt <= box.window * 0.6 + 1, `phone: the excerpt is no taller than 60% of the window (${before.excerpt} of ${box.window})`);
      const wheel = async deltaY => { const [x, y] = await within(p, preview); await p.send('Input.dispatchMouseEvent', { type: 'mouseWheel', x, y, deltaX: 0, deltaY }); };
      const drag = async (yDistance, speed) => { const [x, y] = await within(p, preview); await p.send('Input.synthesizeScrollGesture', { x, y, yDistance, gestureSourceType: 'touch', speed }); };
      if (device === 'laptop') {
        await wheel(240);
        await until(async () => (await state()).top > 0, 'laptop: the wheel scrolls the box');
        assert.equal((await state()).pageY, box.pageY, 'laptop: and not the page');
        assert.ok((await state()).authorBottom < 0, 'laptop: the author and timestamp scroll out of the card');
        await shot(p, 'reading-long-headers-away-' + device);
        // At its bottom edge the same wheel carries on with the page.
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
        assert.ok((await state()).authorBottom < 0, 'phone: the author and timestamp scroll out of the card');
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

  // Lighting a cut-off card reads its whole message and puts it in place of the excerpt's words. That read can
  // be answered while a press on those words is held: the browser sends no click for a press whose element went
  // from under it, so the words wait for the press and its click to be over, and the press still opens the Reader.
  await check('reading a press held on a cut-off card while its whole message arrives still opens it in the Reader, and the card then reads on in place', async () => {
    const topic = 'reading-press-whole';
    const body = Array.from({ length: 60 }, (_, i) => `Line ${i} of a long message that a press opens.`).join('\n');
    const ids = await seed(topic, [['long', { sender: 'aim-ux', join: true, addressees: [facts.actor], body }],
      ['after', { sender: 'aim-core', join: true, addressees: [facts.actor], body: 'A short message after it.' }]]);
    const opened = (await control({ method: 'admission_events', after: Number.MAX_SAFE_INTEGER })).next;
    const p = await open(topic, 'laptop', topic, ids.long, 'window.holdReads = true;');
    await centre(p, card(ids.long));
    await away(p);
    await until(() => p.evaluate('window.fetchesOut === 0'), 'the page has its answers');
    const since = (await control({ method: 'admission_events', after: Number.MAX_SAFE_INTEGER })).next;
    assert.deepEqual((await control({ method: 'admission_events', after: opened })).events.filter(e => e.event === 'callback-enter' && e.name === 'source'), [],
      'nothing has read the long message whole yet');
    const hold = topic + '-hold';
    // The lit card's read of its whole is held in the server, as a slow answer is.
    await control({ method: 'read_hold', hold_id: hold, name: 'source', phase: 'callback', read_class: 'background', count: 1 });
    await p.evaluate(`(window.watched=false,window.watchFor={read:'source',words:'Line 59 of a long message'},true)`);
    const [x, y] = await within(p, words(ids.long));
    await p.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
    await until(async () => (await lit(p)).includes(ids.long), 'the pointer lights the cut-off card');
    await until(async () => (await control({ method: 'admission_events', after: since })).events.some(e => e.event === 'hold-enter' && e.hold_id === hold), 'its read of the whole message is held');
    assert.equal(await p.evaluate(`document.querySelector(${JSON.stringify(card(ids.long))}).dataset.whole`), undefined, 'the card still shows its excerpt');
    // The press goes down on the excerpt's words, and the whole message arrives while it is held.
    await p.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
    await control({ method: 'read_release', hold_id: hold });
    await until(() => p.evaluate('window.watched === true'), 'the whole message reaches the page while the press is held');
    await p.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
    await until(async () => (await readerOn(p))?.startsWith('Line 0'), 'the press opens the card\'s message in the Reader');
    await closeReader(p, 'laptop');
    await until(() => p.evaluate(`(c=>c.dataset.whole==='shown'&&c.classList.contains('scroll-in-place'))(document.querySelector(${JSON.stringify(card(ids.long))}))`), 'once the press is over, the card holds the whole message and reads on in place');
    assert.deepEqual(p.errors, []); await p.close();
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
        assert.deepEqual(await guide(), { open: true, title: 'Pointer, keys and taps', rules: 16 }, 'laptop: the guide, every rule');
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
        await light(p, device, ids.m, true);
        await p.key('Enter');
        await until(() => p.evaluate(`document.activeElement?.id === 'writing-body'`), 'laptop: the cursor is in the reply');
        await p.key('?');
        await p.evaluate('new Promise(done=>requestAnimationFrame(()=>requestAnimationFrame(done)))');
        assert.equal((await guide()).open, false, 'laptop: ? in the reply opens no guide');
        assert.equal(await p.evaluate(`document.activeElement?.id`), 'writing-body', 'laptop: the cursor stays in the reply');
        await closeReader(p, device);
        // The guide's ? is at the side rail's foot, under who you are (item 628): brought into view as a person scrolls to it.
        await centre(p, '#rail #instance-label ~ .guide-open');
        await p.point('#rail #instance-label ~ .guide-open');
      } else {
        await tap(p, '#rail-open');
        await until(() => p.evaluate(`document.querySelector('.guide-open')?.getClientRects().length > 0`), 'phone: "☰ Topics" shows the guide\'s way in');
        await centre(p, '#rail #instance-label ~ .guide-open');
        await tap(p, '#rail #instance-label ~ .guide-open');
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
      // The person's reply folded it for them (docs/reply-stacks.md, item 377): a press on its row shows it whole, arrow and all.
      await unfoldRow(p, device, ids.answered);
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
      await unfoldRow(q, device, far.long);
      await light(q, device, far.long);
      const covers = await q.evaluate(`(()=>{const b=document.querySelector('${BAR}').getBoundingClientRect(),m=document.querySelector(${JSON.stringify(card(far.long) + ' .replied-mark')}).getBoundingClientRect();
        return b.right>m.left&&b.left<m.right&&b.bottom>m.top&&b.top<m.bottom})()`);
      assert.equal(covers, false, device + ': the bar does not cover the reply arrow');
      assert.deepEqual(q.errors, []);
      await q.close();
    }
  });

  // Item 475: after the person posts, the Conversation's three dots show on their message until the first reply from
  // anyone else (aim_next/stacks.py, awaiting_fields; web/card-reading.mjs). How a message's dots stand on the page:
  // null when it draws none; else how many, their name, whether they show inside the card, how many pulse, and whether
  // each dot is in the card's own ink, read in one look.
  const WAITING = 'Waiting for a reply';
  const dots = (p, id) => p.evaluate(`(c=>{const w=c&&c.querySelector(':scope > .reply-wait .item-waiting');if(!w)return null;
    const b=w.getBoundingClientRect(),k=c.getBoundingClientRect(),ink=getComputedStyle(c).color;
    return {count:w.children.length,role:w.getAttribute('role'),label:w.getAttribute('aria-label'),title:w.title,
      shown:b.width>0&&b.height>0&&w.getClientRects().length>0,inside:b.left>=k.left&&b.right<=k.right&&b.top>=k.top&&b.bottom<=k.bottom,
      running:[...w.children].filter(d=>getComputedStyle(d).animationName==='item-waiting').length,
      ink:[...w.children].every(d=>getComputedStyle(d).backgroundColor===ink)}})(document.querySelector(${JSON.stringify(card(id))}))`);
  const showing = d => d !== null && d.count === 3 && d.role === 'img' && d.label === WAITING && d.title === WAITING && d.shown && d.inside && d.ink;
  // What Core says of each of the person's messages in a topic: whether it waits for a reply, by its words.
  const waits = async topic => Object.fromEntries((await view('topic_messages', { topic_id: topic, direction: 'before', limit: 50 })).items
    .filter(item => item.author_id === facts.actor).map(item => [item.body, item.awaiting_reply]));
  // The person writes in the topic's composer and sends, as they do; the id Core gives the message, once its card is drawn.
  const post = async (p, device, topic, text) => {
    await into(p, device, '#inline-writing-body');
    await p.send('Input.insertText', { text });
    await until(async () => await valueOf(p, '#inline-writing-body') === text, `${device} composer: "${text}" is written`);
    await centre(p, '#inline-send');
    await press(p, device, '#inline-send');
    const id = await until(async () => (await view('topic_messages', { topic_id: topic, direction: 'before', limit: 50 })).items
      .find(item => item.author_id === facts.actor && item.body === text)?.id, `${device}: Core holds "${text}"`);
    await until(() => p.evaluate(`Boolean(document.querySelector(${JSON.stringify(card(id))})) && window.fetchesOut === 0`), `${device}: "${text}" is drawn and the page has no read out`);
    return id;
  };
  // A reload, waited on as a new document holding every card named.
  const reload = async (p, ids) => {
    await front(p);
    const origin = await p.evaluate('(window.documentOrigin??=performance.timeOrigin)');
    await p.send('Page.reload');
    await until(() => p.evaluate(`(window.documentOrigin??=performance.timeOrigin) !== ${origin} && document.body?.dataset.ready === 'true' && window.fetchesOut === 0 &&
      ${JSON.stringify(ids)}.every(id => document.querySelector('#messages .message-card[data-id="' + id + '"]'))`).catch(() => false), 'the page loads again, a new document with every card');
  };

  await check('reading dots after the person posts to an agent show on their message until anyone else replies: their own next message and a whisper draw none and clear none, a reply in another dossier clears nothing, and a reload keeps each', async () => {
    for (const device of Object.keys(DEVICES)) {
      const topic = 'reading-dots-' + device;
      const ids = await seed(topic, [['a', { sender: 'aim-core', join: true, addressees: [facts.actor], body: 'aim-core is here to help.' }]]);
      const p = await open('reading-dots-' + device, device, topic, ids.a);
      // Posted to aim-core, which takes part: three dots, in the card's ink, named for a screen reader and the pointer.
      // That they pulse is the Conversation's own element and its check (conversation_native.mjs, item 389); a hosted
      // runner's Chrome may run no CSS animation (the 459 runner-only conversation dots red), so here it is recorded only.
      const first = await post(p, device, topic, '@aim-core can you check the build?');
      await until(async () => showing(await dots(p, first)), `${device}: the dots show on the person's message`);
      observations.push({ name: 'reading dots pulse', engine, device, running: (await dots(p, first)).running });
      assert.equal(await dots(p, ids.a), null, device + ': none on aim-core\'s message');
      await shot(p, 'reading-dots-' + device);
      // The person's own second message waits too, and ends nothing.
      const second = await post(p, device, topic, 'And the release notes, when you can.');
      await until(async () => showing(await dots(p, second)), `${device}: the second message waits too`);
      assert.ok(showing(await dots(p, first)), device + ': the person\'s own second message leaves the first one\'s dots');
      // A whisper of theirs draws none, and clears none.
      const whisper = (await control({ method: 'agent_message', operation_id: topic + '-whisper', topic_id: topic, source: 'topic', sender: 'person',
        whisper: true, addressees: ['aim-core'], body: 'Just between us.' })).result.message_id;
      await until(() => p.evaluate(`Boolean(document.querySelector(${JSON.stringify(card(whisper))})) && window.fetchesOut === 0`), device + ': the whisper is drawn');
      assert.equal(await dots(p, whisper), null, device + ': never on a whisper');
      assert.ok(showing(await dots(p, first)) && showing(await dots(p, second)), device + ': a whisper clears nothing');
      // The topic's first message was the person's, before aim-core took part: nobody else received it.
      assert.deepEqual(await waits(topic), { ['Fixture conversation ' + topic]: false, '@aim-core can you check the build?': true, 'And the release notes, when you can.': true, 'Just between us.': false },
        device + ': Core says the same');
      // A reload keeps it: the page reads it from the topic, not from what it drew.
      await reload(p, [first, second, whisper]);
      await until(async () => showing(await dots(p, first)) && showing(await dots(p, second)), `${device}: loaded again, both still wait`);
      assert.equal(await dots(p, whisper), null, device + ': loaded again, the whisper draws none');
      // aim-core answers the first: its dots go while the page is open; the second, in a dossier of its own, still waits.
      const answer = (await control({ method: 'agent_message', operation_id: topic + '-answer', topic_id: topic, sender: 'aim-core', reply_to: first,
        body: 'Looking at the build now.' })).result.message_id;
      await until(async () => await dots(p, first) === null && Boolean(await p.evaluate(`document.querySelector(${JSON.stringify(card(answer))})`)), `${device}: aim-core's reply ends the first one's dots`);
      assert.ok(showing(await dots(p, second)), device + ': a reply in another dossier ends nothing');
      assert.equal(await dots(p, answer), null, device + ': none on aim-core\'s reply');
      // Another person answers the second: a person's reply ends it as an agent's does.
      await control({ method: 'agent_message', operation_id: topic + '-person', topic_id: topic, sender: 'fixture-other-person', join: true, reply_to: second,
        body: 'I have the release notes.' });
      await until(async () => await dots(p, second) === null, `${device}: another person's reply ends the second one's dots`);
      await reload(p, [first, second, answer]);
      assert.deepEqual([await dots(p, first), await dots(p, second)], [null, null], device + ': loaded again, neither waits');
      assert.deepEqual(await waits(topic), { ['Fixture conversation ' + topic]: false, '@aim-core can you check the build?': false, 'And the release notes, when you can.': false, 'Just between us.': false },
        device + ': and Core says so');
      assert.deepEqual(p.errors, []);
      await p.close();
    }
  });

  // Item 475's words, "until the first reply from anyone else" (warp's ruling, codex #5267): a reply that answers the
  // message from another stack, an agent's thumbs-up on it, and a message naming the person each end the dots.
  await check('reading dots end on a reply joined to another stack, an agent\'s thumbs-up and a message naming the person in a subject of its own, and a reload keeps each ended; a person\'s thumbs-up and a message to nobody end none', async () => {
    for (const device of Object.keys(DEVICES)) {
      const topic = 'reading-dots-outside-' + device;
      const ids = await seed(topic, [['a', { sender: 'aim-core', join: true, addressees: [facts.actor], body: 'aim-core is here to help.' }],
        ['p', { sender: 'fixture-other-person', join: true, body: 'Another person is here too.' }]]);
      const p = await open('reading-dots-outside-' + device, device, topic, ids.a);
      const drawn = id => p.evaluate(`Boolean(document.querySelector(${JSON.stringify(card(id))})) && window.fetchesOut === 0`);
      // aim-core answers the first message, and someone joins the answer to another stack: it still answers it.
      const joined = await post(p, device, topic, '@aim-core can you check the notes?');
      await until(async () => showing(await dots(p, joined)), `${device}: the first message waits`);
      const reply = (await control({ method: 'agent_message', operation_id: topic + '-reply', topic_id: topic, sender: 'aim-core', reply_to: joined,
        body: 'Checked the notes.' })).result.message_id;
      await until(async () => await dots(p, joined) === null && await drawn(reply), `${device}: aim-core's reply ends the first one's dots`);
      await control({ method: 'stack_act', sender: 'fixture-other-person', kind: 'stack.join', message_id: reply, operation_id: topic + '-join', args: { into: ids.p } });
      await until(async () => (await view('topic_messages', { topic_id: topic, direction: 'before', limit: 50 })).items
        .find(item => item.id === reply)?.stack_position.root_id === ids.p, `${device}: Core holds the reply in the other person's stack`);
      // A person's thumbs-up is no reply; aim-core's is.
      const thumbed = await post(p, device, topic, '@aim-core and the release, when you can?');
      await until(async () => showing(await dots(p, thumbed)), `${device}: the second message waits`);
      const thumbs = () => p.evaluate(`document.querySelector(${JSON.stringify(card(thumbed) + ' > .message-reactions .reaction-number')})?.textContent ?? null`);
      await control({ method: 'agent_thumb', operation_id: topic + '-person-thumb', sender: 'fixture-other-person', message_id: thumbed });
      await until(async () => await thumbs() === '1', `${device}: the other person's thumbs-up shows on the card`);
      assert.ok(showing(await dots(p, thumbed)), device + ': a person\'s thumbs-up leaves the dots');
      await control({ method: 'agent_thumb', operation_id: topic + '-thumb', sender: 'aim-core', message_id: thumbed });
      await until(async () => await thumbs() === '2' && await dots(p, thumbed) === null, `${device}: aim-core's thumbs-up ends the second one's dots, with no reload`);
      // A message to nobody is no reply; one naming the person, in a subject of its own, is.
      const told = await post(p, device, topic, '@aim-core and the screenshots?');
      await until(async () => showing(await dots(p, told)), `${device}: the third message waits`);
      const everyone = (await control({ method: 'agent_message', operation_id: topic + '-everyone', topic_id: topic, sender: 'aim-core', whole_topic: true,
        body: 'A note for everyone here.' })).result.message_id;
      await until(() => drawn(everyone), `${device}: aim-core's note to everyone is drawn`);
      assert.ok(showing(await dots(p, told)), device + ': a message naming nobody leaves the dots');
      const tell = (await control({ method: 'agent_message', operation_id: topic + '-tell', topic_id: topic, sender: 'aim-core', whole_topic: true,
        post_args: { addressees: [facts.actor], intent: 'tell' }, body: 'The screenshots are up.' })).result.message_id;
      await until(async () => await dots(p, told) === null && await drawn(tell), `${device}: aim-core telling the person ends the third one's dots, with no reload`);
      await reload(p, [joined, thumbed, told]);
      assert.deepEqual([await dots(p, joined), await dots(p, thumbed), await dots(p, told)], [null, null, null],
        device + ': loaded again, none waits: the reply joined to another stack, the thumbs-up and the tell each still answer theirs');
      assert.deepEqual(await waits(topic), { ['Fixture conversation ' + topic]: false, '@aim-core can you check the notes?': false,
        '@aim-core and the release, when you can?': false, '@aim-core and the screenshots?': false }, device + ': and Core says so');
      assert.deepEqual(p.errors, []);
      await p.close();
    }
  });

  await check('reading dots never show where no agent receives the message: a topic of people only, with nobody named', async () => {
    for (const device of Object.keys(DEVICES)) {
      const topic = 'reading-dots-people-' + device;
      const ids = await seed(topic, [['p', { sender: 'fixture-other-person', join: true, body: 'Only people take part here.' }]]);
      const p = await open('reading-dots-people-' + device, device, topic, ids.p);
      const own = await post(p, device, topic, 'Notes for the two of us.');
      assert.equal(await dots(p, own), null, device + ': no agent received it, so no dots');
      assert.deepEqual(await waits(topic), { ['Fixture conversation ' + topic]: false, 'Notes for the two of us.': false }, device + ': Core says none waits');
      assert.deepEqual(p.errors, []);
      await p.close();
    }
  });

  await check('reading dots on a waiting message sit inside its card in its ink at 320, 375 and 390 wide and on a laptop, light and dark, with nothing scrolling sideways', async () => {
    const topic = 'reading-dots-look';
    const ids = await seed(topic, [['a', { sender: 'aim-core', join: true, addressees: [facts.actor], body: 'aim-core is here to help.' }],
      ['own', { sender: 'person', reply_to: 'a', addressees: ['aim-core'], body: 'Could you look at the failing check on the phone layout before the release goes out this evening?' }]]);
    for (const size of ['phone-320', 'phone-375', 'phone', 'laptop']) {
      const p = await open('reading-dots-look-' + size, size, topic, ids.own);
      for (const theme of ['light', 'dark']) {
        await p.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: theme }] });
        await until(() => p.evaluate(`matchMedia('(prefers-color-scheme: ${theme})').matches`), `${size}: the page reads ${theme}`);
        await centre(p, card(ids.own));
        await until(async () => showing(await dots(p, ids.own)), `${size} ${theme}: the dots show inside the card, in its ink`);
        assert.ok(await p.evaluate('document.documentElement.scrollWidth <= innerWidth'), `${size} ${theme}: nothing scrolls sideways`);
        await shot(p, `reading-dots-look-${size}-${theme}`);
      }
      assert.deepEqual(p.errors, []);
      await p.close();
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
      if (device === 'laptop') { await light(p, device, ids.m, true); await p.key('Enter'); }
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

  // Who the writing goes to, as the composer's quiet line under the chip says it (item 329).
  const toLine = (p, line) => p.evaluate(`(e=>e&&!e.hidden&&e.getClientRects().length>0&&getComputedStyle(e).visibility==='visible'?e.textContent:null)(document.querySelector(${JSON.stringify(line)}))`);
  // A topic with aim-core and aim-ux in it, and two messages of aim-core's to the person.
  const atSeed = topic => seed(topic, [['ux', { sender: 'aim-ux', join: true, body: 'aim-ux is here too.' }],
    ['a', { sender: 'aim-core', join: true, addressees: [facts.actor], body: 'Message A from aim-core.' }],
    ['b', { sender: 'aim-core', addressees: [facts.actor], body: 'Message B from aim-core.' }]]);

  await check('reading a leading @name says who the writing goes to as it is typed, "To aim-ux", in the topic\'s composer and the Reader, and with none the default', async () => {
    for (const device of Object.keys(DEVICES)) {
      const topic = 'reading-at-hint-' + device;
      const ids = await atSeed(topic);
      const p = await open('reading-at-hint-' + device, device, topic, ids.a);
      // Types each piece as keys would give it, and waits for the line to say want.
      const types = async (field, line, steps) => {
        for (const [text, want] of steps) {
          await p.send('Input.insertText', { text });
          await becomes(() => toLine(p, line), want, `${device} ${field}: after "${text}" the line says ${JSON.stringify(want)}`);
        }
      };
      // The topic's composer goes to everyone here by default, and to aim-ux once the writing starts with @aim-ux.
      await into(p, device, '#inline-writing-body');
      await becomes(() => toLine(p, '#inline-writing-to'), 'To everyone here', device + ' composer: nobody named, everyone here');
      await types('composer', '#inline-writing-to', [['@aim', 'To everyone here'], ['-ux', 'To aim-ux'], [' and @AIM-CORE', 'To aim-ux'], [' see above', 'To aim-ux']]);
      await shot(p, 'reading-at-hint-composer-' + device);
      // Not at the start, or naming nobody here: plain text, and the default stands, said quietly.
      await p.evaluate(`document.querySelector('#inline-writing-body').select()`);
      await types('composer', '#inline-writing-to', [['Hello @aim-ux', 'To everyone here']]);
      await p.evaluate(`document.querySelector('#inline-writing-body').select()`);
      await types('composer', '#inline-writing-to', [['@nobody hello', 'To everyone here'], ['', 'To everyone here']]);
      assert.equal(await p.evaluate(`document.querySelector('#inline-notice').hidden`), true, device + ' composer: an @word naming nobody raises no notice');
      // The Reader's reply goes to the author it answers by default, and to aim-ux once it starts with @aim-ux.
      await openReader(p, device, ids.a, 'Message A from aim-core.');
      await into(p, device, '#writing-body');
      await becomes(() => toLine(p, '#writing-to'), 'To aim-core', device + ' Reader: the author it answers by default');
      await types('Reader', '#writing-to', [['@aim-u', 'To aim-core'], ['x', 'To aim-ux'], [', @aim-core: both', 'To aim-ux and aim-core']]);
      await shot(p, 'reading-at-hint-reader-' + device);
      await p.evaluate(`document.querySelector('#writing-body').select()`);
      await types('Reader', '#writing-to', [['Thanks', 'To aim-core']]);
      // The @word stays in the writing as typed.
      await p.evaluate(`document.querySelector('#writing-body').select()`);
      await types('Reader', '#writing-to', [['@aim-ux over to you', 'To aim-ux']]);
      assert.equal(await valueOf(p, '#writing-body'), '@aim-ux over to you', device + ' Reader: the words stay as written');
      await closeReader(p, device);
      assert.deepEqual(p.errors, []);
      await p.close();
    }
  });

  await check('reading a reply to someone else\'s message that starts with @name is recorded to that member, and one without keeps its author', async () => {
    for (const device of Object.keys(DEVICES)) {
      const topic = 'reading-at-send-' + device;
      const ids = await atSeed(topic);
      const p = await open('reading-at-send-' + device, device, topic, ids.a);
      // The person's messages, oldest first, past the topic's own first message.
      let opening = new Set();
      const own = async () => (await view('topic_messages', { topic_id: topic, direction: 'before', limit: 20 })).items
        .filter(item => item.author_id === facts.actor && !opening.has(item.id)).sort((x, y) => x.seq - y.seq);
      opening = new Set((await own()).map(item => item.id));
      const mine = async () => (await own()).map(item => [item.body, item.addressees, item.reply_to ?? null]);
      // The page has drawn every message the person sent and has no read out, so nothing moves under the next press.
      const settled = async () => {
        const sent = (await own()).map(item => item.id);
        await until(() => p.evaluate(`${JSON.stringify(sent)}.every(id => document.querySelector('#messages [data-id="' + id + '"]')) && window.fetchesOut === 0`),
          device + ': the page shows each message sent');
      };
      // A reply in the Reader, written and sent as the person does; what the line said before Send.
      const reply = async (id, starts, text) => {
        await openReader(p, device, id, starts);
        await into(p, device, '#writing-body');
        await p.send('Input.insertText', { text });
        await until(async () => await valueOf(p, '#writing-body') === text, `${device}: "${text}" is written`);
        const said = await toLine(p, '#writing-to');
        await press(p, device, '#send-reply');
        await until(async () => (await mine()).some(([body]) => body === text), `${device}: Core holds "${text}"`);
        if (await readerOn(p) !== null) await closeReader(p, device);
        await settled();
        return said;
      };
      // Tony's case: a reply to aim-core's message, starting with @aim-ux; then one with no leading @name.
      const said = [await reply(ids.a, 'Message A', '@aim-ux can you reply here when your tool is running?'),
        await reply(ids.b, 'Message B', 'Thanks, @aim-ux will look')];
      // The topic's composer: one by @name, and one with none.
      for (const text of ['@aim-ux please check the build', 'For everyone']) {
        await settled();
        await into(p, device, '#inline-writing-body');
        await p.send('Input.insertText', { text });
        await until(async () => await valueOf(p, '#inline-writing-body') === text, `${device} composer: "${text}" is written`);
        said.push(await toLine(p, '#inline-writing-to'));
        await centre(p, '#inline-send');
        await press(p, device, '#inline-send');
        await until(async () => (await mine()).some(([body]) => body === text), `${device}: Core holds "${text}"`);
      }
      // Core records the @named member in place of the author it answers, the words as written, and the default without one.
      assert.deepEqual(await mine(), [
        ['@aim-ux can you reply here when your tool is running?', ['aim-ux'], ids.a],
        ['Thanks, @aim-ux will look', ['aim-core'], ids.b],
        ['@aim-ux please check the build', ['aim-ux'], null],
        ['For everyone', [], null]], device + ': Core records each to the member its leading @name names, else to the default');
      // Each as the composer said before Send.
      assert.deepEqual(said, ['To aim-ux', 'To aim-core', 'To aim-ux', 'To everyone here'], device + ': the line said whom Core then recorded');
      assert.deepEqual(p.errors, []);
      await p.close();
    }
  });

  // Tony's case (item 329): an outcome of the person's, one per device, where fable answers in its conversation and
  // aim-spec is on its team but in neither the conversation (only the team's people and fable take part there) nor
  // its topic; warp takes part in the topic and is not on the team. A leading @name names whom Core can send to
  // where the writing goes: the line says so before Send, and Core records it.
  await check('reading a leading @name of a member of the outcome\'s team who is in neither the topic nor its conversation says "To" them and is recorded to them; one only in the topic names nobody in writing sent to the conversation', async () => {
    for (const device of Object.keys(DEVICES)) {
      const outcome = 'reading-at-team-' + device, topic = outcome + '-topic';
      await control({ method: 'navigation_workspaces', workspaces: [{ id: outcome, title: 'At names ' + device, team: ['fable', 'aim-spec'], coordinator: 'fable' }] });
      const conversation = (await view('conversation', { workspace_id: outcome })).conversation.topic_id;
      await control({ method: 'navigation_topics', topics: [{ id: topic, title: 'At names ' + device, workspace_id: outcome }] });
      const say = async (n, topicId, more) => (await control({ method: 'agent_message', operation_id: `${outcome}-${n}`, topic_id: topicId, source: 'topic', ...more })).result.message_id;
      const status = await say(0, conversation, { sender: 'fable', addressees: [facts.actor], body: 'The wake check is in.' });
      const fable = await say(1, topic, { sender: 'fable', join: true, addressees: [facts.actor], body: 'Fable in the topic.' });
      await say(2, topic, { sender: 'warp', join: true, body: 'Warp is here too.' });
      const again = await say(4, topic, { sender: 'fable', addressees: [facts.actor], body: 'Fable again in the topic.' });
      const present = async topicId => (await view('topic', { topic_id: topicId })).participants.map(person => person.actor_id).sort();
      assert.deepEqual([await present(conversation), await present(topic)], [['fable', facts.actor].sort(), ['fable', facts.actor, 'warp'].sort()],
        device + ': aim-spec takes part in neither the conversation nor the topic');
      // The person's message in a topic, by its words: [addressees, the message it answers].
      const recorded = async (topicId, body) => {
        const item = await until(async () => (await view('topic_messages', { topic_id: topicId, direction: 'before', limit: 50 })).items
          .find(entry => entry.author_id === facts.actor && entry.body === body), `${device}: Core holds "${body}"`);
        return [item.addressees, item.reply_to ?? null];
      };
      // Types each piece as keys would give it, and waits for the line to say want.
      const types = async (p, line, steps) => {
        for (const [text, want] of steps) {
          await p.send('Input.insertText', { text });
          await becomes(() => toLine(p, line), want, `${device}: after "${text}" the line says ${JSON.stringify(want)}`);
        }
      };
      // The page has drawn the message just sent and has no read out, so nothing moves under the next press.
      const settled = async (p, topicId, body) => {
        const id = await until(async () => (await view('topic_messages', { topic_id: topicId, direction: 'before', limit: 50 })).items
          .find(entry => entry.author_id === facts.actor && entry.body === body)?.id, `${device}: "${body}" is sent`);
        if (await readerOn(p) !== null) await closeReader(p, device);
        await until(() => p.evaluate(`Boolean(document.querySelector('#messages [data-id="${id}"]')) && window.fetchesOut === 0`), device + ': the page shows the message sent');
      };

      // In the conversation, a reply to fable's message that starts with @aim-spec goes to aim-spec, as the line says.
      const tony = '@aim-spec can you reply here when your tool for watching this topic is running?';
      const p = await open('reading-at-team-conversation-' + device, device, conversation, status);
      await openReader(p, device, status, 'The wake check is in.');
      await into(p, device, '#writing-body');
      await becomes(() => toLine(p, '#writing-to'), 'To fable', device + ' conversation Reader: fable, whose message it answers, by default');
      await types(p, '#writing-to', [['@aim-sp', 'To fable'], [tony.slice('@aim-sp'.length), 'To aim-spec']]);
      await shot(p, 'reading-at-team-conversation-' + device);
      await press(p, device, '#send-reply');
      await settled(p, conversation, tony);
      assert.deepEqual(await recorded(conversation, tony), [['aim-spec'], status], device + ': Core records it to aim-spec, in place of fable');
      // aim-spec answers it where it was asked.
      const asked = (await view('topic_messages', { topic_id: conversation, direction: 'before', limit: 50 })).items.find(entry => entry.body === tony).id;
      const running = await say(3, conversation, { sender: 'aim-spec', reply_to: asked, addressees: [facts.actor], body: 'It is running now.' });
      // Its answer, drawn, moves the writing box: the box is pressed after.
      await until(() => p.evaluate(`Boolean(document.querySelector('#messages [data-id="${running}"]')) && window.fetchesOut === 0`), device + ': the page shows aim-spec\'s answer');
      // The conversation's own composer names aim-spec the same way.
      const build = '@aim-spec please check the build';
      await into(p, device, '#inline-writing-body');
      await types(p, '#inline-writing-to', [[build, 'To aim-spec']]);
      await centre(p, '#inline-send');
      await press(p, device, '#inline-send');
      await settled(p, conversation, build);
      assert.deepEqual((await recorded(conversation, build))[0], ['aim-spec'], device + ': Core records the composer\'s message to aim-spec');
      assert.deepEqual(p.errors, []);
      await p.close();

      // In the outcome's topic, a reply to fable's message names aim-spec, on the team and not in the topic.
      const q = await open('reading-at-team-topic-' + device, device, topic, fable);
      const over = '@aim-spec over to you';
      await openReader(q, device, fable, 'Fable in the topic.');
      await into(q, device, '#writing-body');
      await types(q, '#writing-to', [['@aim-spec', 'To aim-spec'], [' over to you', 'To aim-spec']]);
      await press(q, device, '#send-reply');
      await settled(q, topic, over);
      assert.deepEqual(await recorded(topic, over), [['aim-spec'], fable], device + ': Core records the topic\'s reply to aim-spec, in place of fable');
      // warp, in the topic and not on the team, is someone writing here goes to, and no one in the conversation:
      // the same words moved there by one tap on To go to fable, whose message they answer.
      const there = '@warp are you there?';
      await openReader(q, device, again, 'Fable again in the topic.');
      await into(q, device, '#writing-body');
      await types(q, '#writing-to', [[there, 'To warp']]);
      // On a phone In is in the who panel, which the who chip opens and Done closes (docs/reader.md).
      const panel = shown => q.evaluate(`!document.querySelector('#who-panel').hidden === ${shown}`);
      if (device === 'phone') { await press(q, device, '#who-chip'); await until(() => panel(true), 'phone: the who panel opens'); }
      await press(q, device, '#reply-destination button[data-destination]:not([aria-pressed="true"])');
      await until(() => q.evaluate(`document.querySelector('#reply-destination button[aria-pressed="true"]')?.textContent === 'Conversation' && document.querySelector('#writing-body').value === ${JSON.stringify(there)}`),
        device + ': the conversation is chosen and the writing came along');
      if (device === 'phone') { await press(q, device, '#who-done'); await until(() => panel(false), 'phone: the who panel closes'); }
      await becomes(() => toLine(q, '#writing-to'), 'To fable', device + ': in the conversation, @warp names nobody and the line says fable');
      await press(q, device, '#send-reply');
      assert.deepEqual(await recorded(conversation, there), [['fable'], null], device + ': Core records it in the conversation to fable, not warp');
      if (await readerOn(q) !== null) await closeReader(q, device);
      assert.deepEqual(q.errors, []);
      await q.close();
    }
  });

  // A message the Reader shows from its source alone, its card on no loaded
  // page (here, from a Conversation reply's About link): the Reader itself
  // says how many thumbed it up and who, while its 👍 stays the reader's own.
  await check('reading a message opened from an About link, its card on no page, shows in the Reader how many thumbed it up and who', async () => {
    for (const device of Object.keys(DEVICES)) {
      const name = 'reading-about-thumbs-' + device;
      const ids = await seed(name, [['other', { sender: 'aim-ux', join: true, body: 'Here to read the message.' }],
        ['elsewhere', { sender: 'aim-core', join: true, body: 'A message in another topic, read by another reader.' }]]);
      await control({ method: 'navigation_workspaces', workspaces: [{ id: name, title: name, team: ['fable'], coordinator: 'fable' }] });
      const topic = (await view('conversation', { workspace_id: name })).conversation.topic_id;
      const reply = (await control({ method: 'agent_message', operation_id: name + '-about', topic_id: topic, sender: 'person', reply_to: ids.elsewhere, body: 'About the message elsewhere.' })).result.message_id;
      // The outcome's Conversation page, where a reply about a message elsewhere carries its About link.
      const p = await open(name, device, topic, reply, '', '/?conversation=' + name);
      const about = card(reply) + ' .about-line .item-link';
      await until(() => p.evaluate(`Boolean(document.querySelector(${JSON.stringify(about)}))`), `${device}: the reply's About line links to the message`);
      const fromAbout = async () => {
        await centre(p, about);
        if (device === 'laptop') await p.point(about);
        else {
          // A finger on the link's first line of words: at a phone's width the topic's name wraps, and its box's
          // corner and centre fall on the About line beside the words. As on any card, a phone's first tap lights
          // the reply; the next follows the link.
          const onLink = async () => {
            const at = await p.evaluate(`(e=>{const r=e.getClientRects()[0],x=r.left+r.width/2,y=r.top+r.height/2;return {x,y,hit:e.contains(document.elementFromPoint(x,y))}})(document.querySelector(${JSON.stringify(about)}))`);
            assert.ok(at.hit, `${device}: the link's words are where the finger lands`);
            await p.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: at.x, y: at.y }] });
            await p.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
          };
          if (!(await lit(p)).includes(reply)) { await onLink(); await until(async () => (await lit(p)).includes(reply), `${device}: the first tap lights the reply`); }
          await onLink();
        }
        await until(async () => (await readerOn(p))?.startsWith('A message in another topic'), `${device}: the About link opens the Reader on the message`);
        assert.equal(await p.evaluate(`document.querySelector(${JSON.stringify(card(ids.elsewhere))})`), null, `${device}: no loaded page holds the message's card`);
      };
      const thumb = () => p.evaluate(`(b=>({text:b.textContent,title:b.title,label:b.getAttribute('aria-label')}))(document.querySelector('#thumb-source'))`);
      await fromAbout();
      assert.ok(!(await readerSays(p)).some(text => /👍\s*\d/.test(text)), `${device}: no count while no one has thumbed it up`);
      await closeReader(p, device);
      await control({ method: 'agent_thumb', operation_id: name + '-ux', sender: 'aim-ux', message_id: ids.elsewhere });
      await fromAbout();
      assert.ok(await readerCounts(p, 1, ['aim-ux']), `${device}: the Reader shows 👍 1 and aim-ux: ${JSON.stringify(await readerSays(p))}`);
      assert.deepEqual(await thumb(), { text: '👍', title: 'Thumbs-up: read and understood', label: 'Thumbs-up: read and understood' }, `${device}: the composer's 👍 stays the reader's own`);
      await shot(p, name);
      await closeReader(p, device);
      assert.deepEqual(p.errors, []); await p.close();
    }
  });

  await check('reading the composer thumb represents only your action while the message keeps everyone’s count and names', async () => {
    for (const device of Object.keys(DEVICES)) {
      const topic = 'reading-own-thumb-' + device;
      const ids = await seed(topic, [['other', { sender: 'aim-ux', join: true, body: 'Here to read the message.' }],
        ['theirs', { sender: 'aim-core', join: true, body: 'A message with another person’s thumbs-up.' }]]);
      await control({ method: 'agent_thumb', operation_id: topic + '-other', sender: 'aim-ux', message_id: ids.theirs });
      const p = await open(topic, device, topic, ids.theirs);
      const button = () => p.evaluate(`(b=>({text:b.textContent,pressed:b.getAttribute('aria-pressed'),title:b.title}))(document.querySelector('#thumb-source'))`);
      const count = () => p.evaluate(`document.querySelector(${JSON.stringify(card(ids.theirs) + ' .reaction-number')})?.textContent`);
      const off = { text: '👍', pressed: 'false', title: 'Thumbs-up: read and understood' };
      await readerByClick(p, device, ids.theirs, 'A message with another');
      assert.deepEqual(await button(), off, device + ': someone else’s reaction is not on the composer button');
      assert.equal(await count(), '1', device + ': the message retains the aggregate');
      assert.ok(await p.evaluate(`document.querySelector(${JSON.stringify(card(ids.theirs) + ' .reaction-count')}).title.includes('aim-ux')`), device + ': the message names the other reader');
      await press(p, device, '#thumb-source');
      await until(async () => await thumbsBy(ids.theirs, facts.actor) === 1 && await readerOn(p) === null, device + ': your thumb records once and closes the Reader');
      await until(() => foldedRow(p, ids.theirs), device + ': your thumb folds the card');
      await unfoldRow(p, device, ids.theirs);
      await readerByClick(p, device, ids.theirs, 'A message with another');
      assert.deepEqual(await button(), { text: '👍', pressed: 'true', title: 'You said you read and understood it. Press to take it back.' }, device + ': your own state is selected without the aggregate');
      assert.equal(await count(), '2', device + ': both reactions remain on the message');
      assert.ok(await readerCounts(p, 2, ['you', 'aim-ux']), device + ': and the Reader shows both: ' + JSON.stringify(await readerSays(p)));
      await press(p, device, '#thumb-source');
      await until(async () => await thumbsBy(ids.theirs, facts.actor) === 0 && (await button()).pressed === 'false', device + ': undo changes only your reaction');
      assert.equal(await thumbsBy(ids.theirs, 'aim-ux'), 1, device + ': the other reader’s reaction remains');
      await control({ method: 'agent_thumb', operation_id: topic + '-other-off', sender: 'aim-ux', message_id: ids.theirs, thumbed: false });
      await until(async () => await count() === undefined, device + ': the live aggregate repaint arrived');
      assert.deepEqual(await button(), off, device + ': another person’s change never selects your control');
      assert.ok(!(await readerSays(p)).some(text => /👍\s*\d/.test(text)), device + ': with no thumbs-up left the Reader shows no count');
      await into(p, device, '#writing-body'); await p.send('Input.insertText', { text: 'Unsent words' });
      assert.equal(await p.evaluate(`document.querySelector('#thumb-source').getClientRects().length`), 0, device + ': typing hides the personal action');
      assert.equal(await thumbsBy(ids.theirs, facts.actor), 0, device + ': typing sends no thumb');
      await shot(p, topic); await closeReader(p, device);
      assert.deepEqual(p.errors, []); await p.close();
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
      // The thumbs-up folded the message for the person (docs/reply-stacks.md, item 377); a press on its row shows it whole.
      await until(() => foldedRow(p, ids.theirs), `${device}: the thumbs-up folds the message to its row`);
      await unfoldRow(p, device, ids.theirs);
      await readerByClick(p, device, ids.theirs, 'A message to thumb up');
      await until(async () => (await button())?.pressed === 'true', `${device}: opened again, the Reader's 👍 shows it on`);
      assert.equal((await button()).text, '👍', device + ': the personal action has no aggregate count');
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
      // The thumbs-up folded the message for the person (docs/reply-stacks.md, item 377); a press on its row shows it whole.
      await until(() => foldedRow(p, ids.theirs), device + ': the thumbs-up folds the message to its row');
      await unfoldRow(p, device, ids.theirs);
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
      await until(() => foldedRow(p, ids.theirs), device + ': given again, the thumbs-up folds the message again');
      await unfoldRow(p, device, ids.theirs);
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
    // Which document is up: its timeOrigin as first read, kept on the window (WebKit's can move 1 ms with no load).
    const origin = await p.evaluate('(window.documentOrigin??=performance.timeOrigin)');
    await p.send('Page.reload');
    await until(() => p.evaluate(`(window.documentOrigin??=performance.timeOrigin) !== ${origin} && document.body?.dataset.ready === 'true' && Boolean(document.querySelector('#messages .new-line')) &&
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
    const origin = await p.evaluate('(window.documentOrigin??=performance.timeOrigin)');
    await p.send('Page.reload');
    await until(() => p.evaluate(`(window.documentOrigin??=performance.timeOrigin) !== ${origin} && document.body?.dataset.ready === 'true' &&
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
    // Background reads share one bounded lane, which refuses a read when it is busy (aim_next/server.py,
    // ReadAdmission), as it is while a page loads. ⌘C is the person's own act, and its read of the whole message
    // never waits on that lane: here the lane refuses every background read of a message's source.
    const busy = { error: { code: 'SERVER_BUSY', message: 'This read could not enter its bounded lane.', retryable: true } };
    await control({ method: 'read_fault', name: 'source', read_class: 'background', status: 503, body: busy, count: 50 });
    try {
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
      // The pointer rests on a message, off its words: ⌘C copies its words as written.
      await light(p, 'laptop', ids.short, true);
      assert.equal(await copy(), true, 'the page takes ⌘C on the lit message');
      const short = await written(ids.short);
      await becomes(copied, [short], 'the lit message\'s words, as written, are on the clipboard');
      // The keys move the light from under the resting pointer: the message they light is the one ⌘C copies, as Return answers it.
      await p.key('ArrowUp');
      await until(async () => (await lit(p)).join() === ids.long, 'the keys light the cut-off message above');
      assert.equal(await copy(), true, 'the page takes ⌘C on it');
      const whole = await written(ids.long);
      await becomes(copied, [short, whole], 'the whole message is on the clipboard, not its excerpt, though the background lane is busy');
      assert.equal(await p.evaluate(`document.querySelector('#app-status').textContent.includes('Could not copy')`), false, 'nothing says the copy was refused');
      // The Reader's ⇧⌘C gives the same words.
      await p.point(words(ids.long));
      await until(async () => (await readerOn(p))?.startsWith('Line 0'), 'a click opens the lit message in the Reader');
      assert.equal(await copy(12), true, 'the Reader takes ⇧⌘C');
      await becomes(copied, [short, whole, whole], 'the Reader copies the same words');
      await closeReader(p, 'laptop');
      // Words selected on the page: ⌘C copies them as the browser does, not the lit message.
      await light(p, 'laptop', ids.short, true);
      await p.evaluate(`(()=>{const r=document.createRange();r.selectNodeContents(document.querySelector(${JSON.stringify(words(ids.short))}));getSelection().removeAllRanges();getSelection().addRange(r);return true})()`);
      assert.equal(await copy(), false, 'with words selected the page leaves ⌘C to the browser');
      assert.deepEqual(await copied(), [short, whole, whole], 'and puts nothing of its own on the clipboard');
      await p.evaluate('getSelection().removeAllRanges()');
      // In the writing ⌘C is the writing's, with a message lit. The press that puts the cursor there takes the
      // feed's light (docs/interaction.md); the pointer resting on a message again lights it, the cursor staying put.
      await into(p, 'laptop', '#inline-writing-body');
      await p.send('Input.insertText', { text: 'Words in the composer.' });
      await light(p, 'laptop', ids.short);
      assert.equal(await p.evaluate('document.activeElement?.id'), 'inline-writing-body', 'the cursor is still in the composer');
      assert.deepEqual(await lit(p), [ids.short], 'a message is lit');
      assert.equal(await copy(), false, 'in the composer the page leaves ⌘C to the writing');
      assert.deepEqual(await copied(), [short, whole, whole], 'and puts nothing of its own on the clipboard');
      assert.deepEqual(p.errors, []);
      await p.close();
    } finally { await control({ method: 'read_fault_clear' }); }
  });

  // A card's words, pressed and read as the cases below press and read them (item 478): where some of its words are
  // on screen, the middle of their first box; the pointer moved there, Shift held when modifiers is 8; those words
  // selected, as a drag over them selects them; the words of the lit passage, or null; and the Reader's reply.
  const wordsAt = (p, id, text) => p.evaluate(`(()=>{const w=document.querySelector(${JSON.stringify(words(id))}),t=${JSON.stringify(text)},walker=document.createTreeWalker(w,4);let n;
    while((n=walker.nextNode())&&!n.data.includes(t));if(!n)return null;const r=document.createRange();r.setStart(n,n.data.indexOf(t));r.setEnd(n,n.data.indexOf(t)+t.length);
    const b=r.getClientRects()[0];return {x:b.left+b.width/2,y:b.top+b.height/2}})()`);
  const moveTo = async (p, id, text, modifiers = 0) => { const at = await wordsAt(p, id, text); assert.ok(at, `${text} is drawn on ${id}`); await p.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: at.x, y: at.y, modifiers }); };
  const selectOn = (p, id, text) => p.evaluate(`(()=>{const w=document.querySelector(${JSON.stringify(words(id))}),t=${JSON.stringify(text)},walker=document.createTreeWalker(w,4);let n;
    while((n=walker.nextNode())&&!n.data.includes(t));if(!n)return false;const r=document.createRange();r.setStart(n,n.data.indexOf(t));r.setEnd(n,n.data.indexOf(t)+t.length);
    getSelection().removeAllRanges();getSelection().addRange(r);return getSelection().toString()===t})()`);
  const shiningOn = p => p.evaluate(`(()=>{const h=CSS.highlights.get('lit-passage');return h&&h.size?[...h][0].toString():null})()`);
  const replyOf = p => p.evaluate(`document.querySelector('#writing-body').value`);

  // What ⌘C put on the clipboard, read back through the browser's own clipboard: in Chrome by its clipboard API,
  // granted; Safari's engine lets a page read the clipboard only inside a press, so there it is read by the
  // browser's own paste (⌘V) into the Reader's reply, once the Reader is open, and the pasted words taken out again.
  // copyOn presses ⌘C and gives what it copied in Chrome, null in Safari's engine; sureOn holds what it gave, or
  // there what is pasted, to words.
  const clipboardOf = p => p.evaluate('navigator.clipboard.readText()');
  const copyOn = async p => {
    await p.evaluate(`navigator.clipboard.writeText('nothing copied yet')`); await p.key('c', 4);
    if (!grant) return null;
    await until(async () => await clipboardOf(p) !== 'nothing copied yet', 'the page copies on ⌘C'); return clipboardOf(p);
  };
  const pastedOn = async p => {
    const before = await p.evaluate(`(()=>{const f=document.querySelector('#writing-body');f.focus();f.setSelectionRange(f.value.length,f.value.length);return f.value})()`);
    await p.key('v', 4);
    await until(async () => await replyOf(p) !== before, 'the browser pastes what is on the clipboard');
    const after = await replyOf(p);
    assert.ok(after.startsWith(before), 'the paste lands at the end of the reply');
    await p.evaluate(`(()=>{const f=document.querySelector('#writing-body');f.setSelectionRange(${JSON.stringify(before.length)},f.value.length)})()`);
    await p.key('Backspace');
    await until(async () => await replyOf(p) === before, 'the pasted words taken out again');
    return after.slice(before.length);
  };
  const sureOn = async (p, got, words, what) => { if (grant) assert.equal(got, words, what); else assert.equal(await pastedOn(p), words, what + ' (pasted in Safari\'s engine)'); };

  // A card's passages light under the pointer as the Reader's do (item 478, docs/interaction.md "The light"), on a
  // topic's card and a dossier's alike: ⌘C copies exactly the lit words, read back through the browser's own
  // clipboard, Return opens the Reader with those same words quoted, and Shift grows the light as in the Reader.
  // The words before and after the passage are neither copied nor quoted. The keys lighting a message light no
  // passage, and Return there replies with nothing quoted.
  await check('reading a passage the pointer rests on lights on a topic\'s card and a dossier\'s; ⌘C copies exactly its words and Return quotes them in the Reader; Shift grows the light', async () => {
    const topic = 'reading-passage';
    const said = ['Words before the passage.', 'The lit passage is these words.', 'Words after the passage.'];
    const body = said.join(' ');
    const ids = await seed(topic, [['root', { sender: 'aim-core', join: true, addressees: [facts.actor], body: 'The message a dossier grows from.' }],
      ['reply', { sender: 'aim-ux', join: true, addressees: [facts.actor], reply_to: 'root', body }],
      ['alone', { sender: 'aim-core', addressees: [facts.actor], body }]]);
    if (grant) await grant(['clipboard-read', 'clipboard-write']);
    const p = await open('reading-passage', 'laptop', topic, ids.alone);
    // The pointer on words of a card's message, what lights, ⌘C and the reply, as the helpers above press and read them.
    const move = (id, text, modifiers = 0) => moveTo(p, id, text, modifiers), shining = () => shiningOn(p), copy = () => copyOn(p), reply = () => replyOf(p);
    const sure = (got, words, what) => sureOn(p, got, words, what);
    for (const [id, where] of [[ids.alone, 'a topic\'s card'], [ids.reply, 'a dossier\'s card']]) {
      await centre(p, card(id));
      // On the card but off its words, the message lights and no passage does.
      await p.point(card(id) + ' > .message-author', 'move');
      await until(async () => (await lit(p)).includes(id), `${where}: lit from its author's line`);
      assert.equal(await shining(), null, `${where}: no passage lights off the words`);
      await move(id, 'lit passage');
      await becomes(shining, said[1] + ' ', `${where}: the passage under the pointer lights, and only it`);
      const copied = await copy();
      if (grant) assert.equal(copied, said[1], `${where}: ⌘C copies exactly the lit words, not the words before or after them`);
      await p.key('Enter');
      await until(async () => (await readerOn(p))?.startsWith(said[0]), `${where}: Return opens the Reader on the message`);
      await until(() => p.evaluate(`document.activeElement?.id === 'writing-body'`), `${where}: the cursor is in the reply`);
      assert.equal(await reply(), `> ${said[1]} \n\n`, `${where}: the reply quotes those same words, and nothing before or after them`);
      if (!grant) await sure(null, said[1], `${where}: ⌘C copied exactly the lit words, not the words before or after them`);
      await shot(p, 'reading-passage-quoted-' + (id === ids.alone ? 'card' : 'dossier'));
      // In the Reader too, ⌘C on a passage lit by a press copies exactly its words.
      await p.point('#source-body [data-start="0"]');
      await until(() => p.evaluate(`document.querySelectorAll('#source-body .hover-quote').length === 1 && getSelection().isCollapsed`), `${where}: a press lights the Reader's first passage`);
      await sure(await copy(), said[0], `${where}: ⌘C in the Reader copies exactly the lit passage's words`);
      await closeReader(p, 'laptop');
    }
    // Shift grows the light from the passage lit first to the one under the pointer, and both copy and quote it.
    await centre(p, card(ids.reply));
    await move(ids.reply, 'Words before');
    await becomes(shining, said[0] + ' ', 'the first passage lights');
    await move(ids.reply, 'Words after', 8);
    await becomes(shining, body, 'moved with Shift held, the light grows to the passage under the pointer');
    const grown = await copy();
    if (grant) assert.equal(grown, body, '⌘C copies the passages lit');
    await shot(p, 'reading-passage-shift');
    // The same light in the dark scheme.
    await p.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'dark' }] });
    await until(() => p.evaluate(`matchMedia('(prefers-color-scheme: dark)').matches`), 'the page in the dark scheme');
    assert.equal(await shining(), body, 'the light stays as the scheme changes');
    await shot(p, 'reading-passage-shift-dark');
    await p.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: '' }] });
    await until(() => p.evaluate(`!matchMedia('(prefers-color-scheme: dark)').matches`), 'the page in the light scheme again');
    await p.key('Enter');
    await until(async () => (await reply()).endsWith(`> ${body}\n\n`), 'Return quotes the passages lit, after the reply kept');
    if (!grant) await sure(null, body, '⌘C copied the passages lit');
    await closeReader(p, 'laptop');
    // The keys light a message and no passage: Return replies with nothing quoted.
    await centre(p, card(ids.alone));
    await move(ids.alone, 'lit passage');
    await becomes(shining, said[1] + ' ', 'a passage lights on the topic\'s card again');
    await p.key('ArrowDown');
    await until(async () => (await lit(p)).length === 1 && !(await lit(p)).includes(ids.alone), 'the keys light the message below');
    await p.key('ArrowUp');
    await until(async () => (await lit(p)).join() === ids.alone && await shining() === null, 'the keys light the message again, and no passage');
    await p.key('Enter');
    await until(async () => (await readerOn(p))?.startsWith(said[0]) && await p.evaluate(`document.activeElement?.id === 'writing-body'`), 'Return opens the Reader');
    assert.equal(await reply(), `> ${said[1]} \n\n`, 'Return with no passage lit quotes nothing more');
    await closeReader(p, 'laptop');
    assert.deepEqual(p.errors, []);
    await p.close();
    // A finger lights a message and no passage of it: on a phone a tap is not a pointer resting on words.
    const phone = await open('reading-passage-phone', 'phone', topic, ids.alone);
    await light(phone, 'phone', ids.alone);
    assert.equal(await phone.evaluate(`(()=>{const h=CSS.highlights.get('lit-passage');return h&&h.size?[...h][0].toString():null})()`), null, 'a tap lights the message and no passage of it');
    await shot(phone, 'reading-passage-phone');
    assert.deepEqual(phone.errors, []);
    await phone.close();
  });

  // The dark field behind a lit passage (item 527, docs/reading-colors.md): what lights, and where the field is painted,
  // read from the screenshot's own pixels, the rows of exactly the field's black, not the boxes of the words, which name
  // the words and not the paint. litLines gives the words lit, on the card (its CSS highlight) or in the Reader (its
  // .hover-quote spans), as a box per line, the boxes of their characters joined. fieldOf finds the field's rows in
  // columns every one of those lines covers: above holds how far it reaches over the first line's words, below how far
  // under the last line's, gaps how many rows between its top and its bottom are left unlit, and lines each line's
  // field, its words' height with above and below (a passage of one line: its field's whole height, both edges in sight).
  // The field's colour: black, and on the person's own black card its light words' colour (aim.css, --lit-field).
  const FIELD = [0, 0, 0], OWN_FIELD = [0xe0, 0xe8, 0xe5];
  const litLines = (p, surface) => p.evaluate(`(()=>{let range=null;
    if(${JSON.stringify(surface)}==='reader'){const lit=[...document.querySelectorAll('#source-body .hover-quote')];if(lit.length){range=document.createRange();range.setStartBefore(lit[0]);range.setEndAfter(lit.at(-1))}}
    else{const h=CSS.highlights.get('lit-passage');range=h&&h.size?[...h][0]:null}
    if(!range)return null;
    const c=range.commonAncestorContainer,host=c.nodeType===1?c:c.parentNode,walk=document.createTreeWalker(host,NodeFilter.SHOW_TEXT),boxes=[];
    for(let n=walk.nextNode();n;n=walk.nextNode()){if(!range.intersectsNode(n)||!n.data.trim())continue;const r=document.createRange();r.selectNodeContents(n);
      if(n===range.startContainer)r.setStart(n,range.startOffset);if(n===range.endContainer)r.setEnd(n,range.endOffset);
      for(const b of r.getClientRects())if(b.width>2)boxes.push({left:b.left,right:b.right,top:b.top,bottom:b.bottom})}
    boxes.sort((a,b)=>a.top-b.top);const lines=[];
    for(const b of boxes){const l=lines.find(l=>Math.min(l.bottom,b.bottom)-Math.max(l.top,b.top)>(b.bottom-b.top)/2);
      if(l)Object.assign(l,{left:Math.min(l.left,b.left),right:Math.max(l.right,b.right),top:Math.min(l.top,b.top),bottom:Math.max(l.bottom,b.bottom)});else lines.push({...b})}
    return {text:range.toString().trim(),lines}})()`);
  const fieldOf = async (p, surface, color = FIELD) => {
    const lit = await litLines(p, surface);
    assert.ok(lit?.lines.length, `${surface}: a passage is lit`);
    const image = pngPixels(Buffer.from((await p.send('Page.captureScreenshot', { format: 'png' })).data, 'base64'));
    const lines = lit.lines, high = lines[0].bottom - lines[0].top;
    const left = Math.ceil(Math.max(...lines.map(l => l.left))) + 1, right = Math.min(Math.floor(Math.min(...lines.map(l => l.right))) - 1, left + 24);
    assert.ok(right - left >= 4, `${surface}: the lines lit share columns to measure the field in (${left} to ${right})`);
    const dark = y => { for (let x = left; x <= right; x++) if (image.pixel(x, y).every((v, i) => v === color[i])) return true; return false; };
    // The field's rows: from the middle of each line lit, every row painted in its colour, over and under, without a
    // break; rows of words not lit nearby, painted in that colour on the person's own card, are not reached.
    const found = new Set(), low = Math.max(0, Math.floor(lines[0].top - 2 * high)), high2 = Math.min(image.height, Math.ceil(lines.at(-1).bottom + 2 * high));
    for (const line of lines) {
      const mid = Math.round((line.top + line.bottom) / 2);
      if (!dark(mid)) continue;
      for (let y = mid; y >= low && dark(y); y--) found.add(y);
      for (let y = mid + 1; y < high2 && dark(y); y++) found.add(y);
    }
    const rows = [...found].sort((a, b) => a - b);
    assert.ok(rows.length, `${surface}: the field is painted behind the words lit`);
    const top = rows[0], bottom = rows.at(-1) + 1, above = lines[0].top - top, below = bottom - lines.at(-1).bottom;
    const round = n => Math.round(n * 10) / 10;
    return { text: lit.text, lines: lines.map(l => round(l.bottom - l.top + above + below)), above: round(above), below: round(below), gaps: bottom - top - rows.length,
      steps: lines.slice(1).map((l, i) => round(l.top - lines[i].top)) };
  };
  // A card's layout as it stands, measured from its top: each line of its words (the top of its characters), the
  // height its lines keep and the size of its words, and how tall the card is.
  const layoutOf = (p, id) => p.evaluate(`(c=>{const w=c.querySelector(':scope > .message-preview'),at=c.getBoundingClientRect().top,walk=document.createTreeWalker(w,NodeFilter.SHOW_TEXT),tops=new Set();
    for(let n=walk.nextNode();n;n=walk.nextNode()){if(!n.data.trim())continue;const r=document.createRange();r.selectNodeContents(n);for(const b of r.getClientRects())if(b.width>2)tops.add(Math.round((b.top-at)*10)/10)}
    const s=getComputedStyle(w);return {height:Math.round(c.getBoundingClientRect().height*10)/10,tops:[...tops].sort((a,b)=>a-b),lineHeight:parseFloat(s.lineHeight),size:parseFloat(s.fontSize)}})(document.querySelector(${JSON.stringify(card(id))}))`);
  // The Reader's words, pointed at as moveTo points at a card's: the passage holding text scrolled into the middle of
  // what shows, and the pointer moved onto text.
  const readerTo = async (p, text) => {
    const at = await p.evaluate(`(()=>{const w=document.querySelector('#source-body'),t=${JSON.stringify(text)},walker=document.createTreeWalker(w,4);let n;
      while((n=walker.nextNode())&&!n.data.includes(t));if(!n)return null;n.parentElement.closest('[data-start]')?.scrollIntoView({block:'center'});
      const r=document.createRange();r.setStart(n,n.data.indexOf(t));r.setEnd(n,n.data.indexOf(t)+t.length);const b=r.getClientRects()[0];return {x:b.left+b.width/2,y:b.top+b.height/2}})()`);
    assert.ok(at, `${text} is drawn in the Reader`);
    await p.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: at.x, y: at.y });
  };
  const scheme = async (p, dark) => {
    await p.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: dark ? 'dark' : '' }] });
    await until(() => p.evaluate(`matchMedia('(prefers-color-scheme: dark)').matches === ${dark}`), `the page in the ${dark ? 'dark' : 'light'} scheme`);
  };
  const WIDTHS = [['laptop', 'a laptop\'s width'], ['w390', '390px with a pointer'], ['w375', '375px with a pointer'], ['w320', '320px with a pointer']];

  // Tony (Mez en place #5287): the black field behind a passage lit on a card is as tall as the one behind a passage
  // lit in the Reader. On each card and in the Reader the same two passages light: a line of its own, whose field's
  // height is measured whole, and a passage of several lines, whose field reaches as far over its first line and under
  // its last as the Reader's and leaves no row between its lines unlit. Each line's field matches the Reader's to
  // within a pixel. The person's own black card paints its field in its light words' colour, as tall. The light moves
  // nothing on the card: before it, while it shows and once it is out, the card's lines are where they were and it is
  // as tall, and its lines keep their own height, 1.5 times its words' size, not the Reader's 1.7.
  for (const [width, called] of WIDTHS) await check(`reading a passage lit on a topic's card and a dossier's at ${called} has a dark field as tall as the Reader's, line by line, in light and dark, and moves nothing on the card`, async () => {
    const topic = 'reading-field-' + width;
    const short = 'A short line.', long = 'The long passage runs on across more than one line on every card and in the Reader alike, so its dark field is measured where its lines meet as well as at its top and its bottom.';
    const body = ['Words before the field.', short, long, 'Words after the field.'].join('\n\n');
    const ids = await seed(topic, [['mine', { sender: 'person', body }],
      ['root', { sender: 'aim-core', join: true, addressees: [facts.actor], body: 'The message a dossier grows from.' }],
      ['reply', { sender: 'aim-ux', join: true, addressees: [facts.actor], reply_to: 'root', body }],
      ['alone', { sender: 'aim-core', addressees: [facts.actor], body }]]);
    const p = await open(topic, width, topic, ids.alone);
    const passages = [['short', 'short line', short], ['long', 'long passage runs', long]];
    for (const dark of [false, true]) {
      const tone = dark ? 'dark' : 'light';
      await scheme(p, dark);
      const fields = [];
      for (const [id, where, color] of [[ids.alone, 'topic card', FIELD], [ids.reply, 'dossier card', FIELD], [ids.mine, 'own card', OWN_FIELD]]) {
        await centre(p, card(id)); await away(p);
        const before = await layoutOf(p, id);
        assert.ok(Math.abs(before.lineHeight - 1.5 * before.size) < 0.6, `${tone} ${where}: a line of its words is 1.5 times their size (${before.lineHeight}px at ${before.size}px), as before`);
        for (const [name, text, said] of passages) {
          await moveTo(p, id, text);
          await until(async () => await shiningOn(p) !== null && (await shiningOn(p)).trim() === said, `${tone} ${where}: the ${name} passage lights under the pointer`);
          const field = await fieldOf(p, 'card', color);
          fields.push({ where, name, field });
          assert.ok(field.steps.every(step => Math.abs(step - before.lineHeight) < 0.6), `${tone} ${where}: the ${name} passage's lines are the card's own line height apart (${before.lineHeight}px): ${JSON.stringify(field.steps)}`);
          assert.deepEqual(await layoutOf(p, id), before, `${tone} ${where}: the ${name} passage lit moves no line of the card and leaves it as tall`);
          await shot(p, `reading-field-${width}-${tone}-${where.split(' ')[0]}-${name}`);
        }
        await centre(p, card(id === ids.alone ? ids.reply : ids.alone)); await away(p);
        await moveTo(p, id === ids.alone ? ids.reply : ids.alone, 'Words after');
        await until(async () => (await shiningOn(p))?.trim() === 'Words after the field.', `${tone}: the light moves to the other card`);
        assert.deepEqual(await layoutOf(p, id), before, `${tone} ${where}: with its light out, the card's lines are where they were and it is as tall`);
      }
      // The Reader on the same message, opened by a click on its words, and the same two passages lit there.
      await centre(p, card(ids.alone));
      await moveTo(p, ids.alone, 'Words before');
      await until(async () => (await lit(p)).includes(ids.alone), `${tone}: the topic card lights`);
      await p.point(words(ids.alone));
      await until(async () => (await readerOn(p))?.startsWith('Words before'), `${tone}: a click opens the Reader on the message`);
      // Measured once the Reader has come to rest: on a phone it rises into place.
      await until(() => p.evaluate("document.getAnimations().filter(a=>a.effect?.getTiming().iterations!==Infinity).every(a=>a.playState!=='running')"), `${tone}: the Reader has come to rest`);
      const reader = {};
      for (const [name, text, said] of passages) {
        await readerTo(p, text);
        await until(() => p.evaluate(`[...document.querySelectorAll('#source-body .hover-quote')].map(s=>s.textContent).join('').trim() === ${JSON.stringify(said)}`), `${tone}: the ${name} passage lights in the Reader`);
        reader[name] = await fieldOf(p, 'reader');
        await shot(p, `reading-field-${width}-${tone}-reader-${name}`);
      }
      await closeReader(p, 'laptop');
      assert.equal(reader.short.lines.length, 1, `${tone}: the short passage is one line in the Reader`);
      assert.ok(reader.long.lines.length > 1, `${tone}: the long passage runs to more lines than one in the Reader`);
      for (const { where, name, field } of fields) {
        const theirs = reader[name], says = `${tone} ${where}, the ${name} passage: the card's field per line ${JSON.stringify(field.lines)}px (over its words ${field.above}, under ${field.below}, ${field.gaps} rows unlit), the Reader's ${JSON.stringify(theirs.lines)}px (over ${theirs.above}, under ${theirs.below}, ${theirs.gaps} unlit)`;
        if (name === 'short') assert.equal(field.lines.length, 1, `${says}: one line on the card too`);
        else assert.ok(field.lines.length > 1, `${says}: more lines than one on the card too`);
        assert.equal(field.gaps, 0, `${says}: no row between the lines is left unlit`);
        assert.ok(field.lines.every(line => Math.abs(line - theirs.lines[0]) <= 1), `${says}: each line's field as tall as the Reader's, to within a pixel`);
      }
    }
    assert.deepEqual(p.errors, []);
    await p.close();
  });

  // Where a lit passage's field may show (item 527): behind the lit words where they show, and nowhere else on the
  // card. shownLit gives each box of the lit characters (a text node's part on a line, as litLines reads them) with
  // the part of the card it can show in: the card's own box, cut to every box between the words and the card that
  // clips what overflows it (a code block or a table that scrolls sideways, a phone's excerpt cut off at a height).
  // solid: the same, less the edges a box that scrolls fades out where it has more to show (aim.css, .md-scrolls'
  // mask), where its words and their field fade together.
  const shownLit = (p, id) => p.evaluate(`(c=>{const h=CSS.highlights.get('lit-passage'),range=h&&h.size?[...h][0]:null;if(!range||!c)return null;
    const o=c.getBoundingClientRect(),boxes=[];
    const fade=2*parseFloat(getComputedStyle(document.documentElement).fontSize);
    const shows=n=>{let s={left:o.left,right:o.right,top:o.top,bottom:o.bottom},solid={...s};
      for(let e=n.parentElement;e&&e!==c;e=e.parentElement){const st=getComputedStyle(e);if(st.overflowX==='visible'&&st.overflowY==='visible')continue;
        const r=e.getBoundingClientRect(),l=r.left+e.clientLeft,t=r.top+e.clientTop,m=[st.maskImage,st.webkitMaskImage].some(v=>v&&v!=='none')?fade:0;
        s={left:Math.max(s.left,l),right:Math.min(s.right,l+e.clientWidth),top:Math.max(s.top,t),bottom:Math.min(s.bottom,t+e.clientHeight)};
        solid={left:Math.max(solid.left,l+m),right:Math.min(solid.right,l+e.clientWidth-m),top:Math.max(solid.top,t),bottom:Math.min(solid.bottom,t+e.clientHeight)}}
      return {...s,solid}};
    const k=range.commonAncestorContainer,walk=document.createTreeWalker(k.nodeType===1?k:k.parentNode,NodeFilter.SHOW_TEXT);
    for(let n=walk.nextNode();n;n=walk.nextNode()){if(!range.intersectsNode(n)||!n.data.trim())continue;const r=document.createRange();r.selectNodeContents(n);
      if(n===range.startContainer)r.setStart(n,range.startOffset);if(n===range.endContainer)r.setEnd(n,range.endOffset);
      const s=shows(n);for(const b of r.getClientRects())if(b.width>2)boxes.push({left:b.left,right:b.right,top:b.top,bottom:b.bottom,shows:s})}
    return {card:{left:o.left,right:o.right,top:o.top,bottom:o.bottom},boxes}})(document.querySelector(${JSON.stringify(card(id))}))`);
  // The field as painted on a card, read from the screenshot's pixels of the field's colour (within a few levels, so
  // a field seen through a code block's faint tint counts): stray counts those on the card outside every place a lit
  // box's field may reach (where the box shows, and over and under it by less than its words' height, which a field's
  // reach always is), at gives the first; bare names each lit box that shows whose rows just over and just under its
  // words, inside what shows unfaded (solid), are not all the field's colour. Only on a card whose own words are not in that colour.
  const fieldPaint = async (p, id, color = FIELD) => {
    const lit = await shownLit(p, id);
    assert.ok(lit?.boxes.length, `a passage is lit on ${id}`);
    const image = pngPixels(Buffer.from((await p.send('Page.captureScreenshot', { format: 'png' })).data, 'base64'));
    const near = (x, y) => image.pixel(x, y).every((v, i) => Math.abs(v - color[i]) <= 16);
    const places = lit.boxes.map(b => {
      const reach = b.bottom - b.top;
      return { left: Math.floor(Math.max(b.left, b.shows.left)) - 1, right: Math.ceil(Math.min(b.right, b.shows.right)) + 1,
        top: Math.floor(Math.max(b.top - reach, b.shows.top)) - 1, bottom: Math.ceil(Math.min(b.bottom + reach, b.shows.bottom)) + 1 };
    }).filter(a => a.right - a.left > 2 && a.bottom > a.top);
    const reach = Math.max(...lit.boxes.map(b => b.bottom - b.top));
    const x0 = Math.max(0, Math.ceil(lit.card.left)), x1 = Math.min(image.width - 1, Math.floor(lit.card.right) - 1);
    const y0 = Math.max(0, Math.ceil(lit.card.top), Math.floor(Math.min(...lit.boxes.map(b => b.top)) - 2 * reach));
    const y1 = Math.min(image.height - 1, Math.floor(lit.card.bottom) - 1, Math.ceil(Math.max(...lit.boxes.map(b => b.bottom)) + 2 * reach));
    let stray = 0, at = null;
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      if (!near(x, y) || places.some(a => x >= a.left && x <= a.right && y >= a.top && y <= a.bottom)) continue;
      stray++; at ??= [x, y];
    }
    const bare = [];
    for (const b of lit.boxes) {
      const left = Math.ceil(Math.max(b.left, b.shows.solid.left)) + 2, right = Math.floor(Math.min(b.right, b.shows.solid.right)) - 2;
      if (right - left < 6) continue;
      for (const y of [Math.floor(b.top) - 2, Math.ceil(b.bottom) + 1]) {
        if (y <= b.shows.top + 1 || y >= b.shows.bottom - 1 || y < 0 || y >= image.height) continue;
        const step = Math.max(1, Math.floor((right - left) / 60));
        for (let x = left; x <= right; x += step) if (!near(x, y)) { bare.push(`the box at ${Math.round(b.left)},${Math.round(b.top)} has no field at ${x},${y}`); break; }
      }
    }
    return { stray, at, bare, boxes: lit.boxes.length, shown: places.length };
  };
  // Two animation frames: the frame after the one in flight, by which a scroll or a resize is painted.
  const painted = p => p.evaluate('new Promise(done=>requestAnimationFrame(()=>requestAnimationFrame(done)))');

  // Reviewer (B1): a lit code block on a card painted its field across the card, outside the code box that clips its
  // long line, and left it behind when the box scrolled sideways. A code block with a line longer than the card, a
  // blank line, and a short line; then a table wider than the card. On a topic's and a dossier's card, each lit under
  // the pointer: its field shows only where its words show, inside the box that clips them (nothing in the card's
  // padding beside the box), and each lit line that shows has its field over and under it; then the box scrolls 300
  // pixels sideways, and the field moves with the words: nothing is left where the short line was, and what shows of
  // the long line still has its field.
  for (const [width, called] of WIDTHS) await check(`reading a lit code block or table on a topic's card and a dossier's at ${called} paints its field only where its words show, inside the box that scrolls them sideways, before and after it scrolls, in light and dark`, async () => {
    const topic = 'reading-clip-' + width;
    const long = '$ tail ' + Array.from({ length: 24 }, (_, i) => `step${i}=done`).join(' ');
    const cells = ['first', 'second', 'third', 'fourth', 'fifth'].map(n => `${n}_column_holds_a_long_value`);
    const table = [`| ${cells.join(' | ')} |`, `|${cells.map(() => '---').join('|')}|`, `| ${cells.map((_, i) => `row_value_${i}_runs_long_unbroken`).join(' | ')} |`].join('\n');
    const body = ['Words before the code.', ['```', long, '', 'second short line', '```'].join('\n'), 'Words between.', table, 'Words after the table.'].join('\n\n');
    const ids = await seed(topic, [['root', { sender: 'aim-core', join: true, addressees: [facts.actor], body: 'The message a dossier grows from.' }],
      ['reply', { sender: 'aim-ux', join: true, addressees: [facts.actor], reply_to: 'root', body }],
      ['alone', { sender: 'aim-core', addressees: [facts.actor], body }]]);
    const p = await open(topic, width, topic, ids.alone);
    const boxes = [['code block', '.md-pre', 'second short line', 'second short line'], ['table', '.md-table-wrap', 'row_value_0', 'row_value_0_runs_long_unbroken']];
    for (const dark of [false, true]) {
      const tone = dark ? 'dark' : 'light';
      await scheme(p, dark);
      for (const [id, where] of [[ids.alone, 'topic card'], [ids.reply, 'dossier card']]) {
        for (const [what, selector, text, shows] of boxes) {
          const box = card(id) + ' ' + selector, says = `${tone} ${where} at ${called}, the ${what}`;
          assert.ok(await p.evaluate(`(b=>b.scrollWidth>b.clientWidth+300)(document.querySelector(${JSON.stringify(box)}))`), `${says}: is wider than its box by more than 300px`);
          await centre(p, box); await away(p);
          await moveTo(p, id, text);
          await until(async () => (await shiningOn(p))?.includes(shows), `${says}: lights under the pointer`);
          const lit = await shiningOn(p);
          const before = await fieldPaint(p, id);
          assert.equal(before.stray, 0, `${says}: no field is painted on the card where no lit word shows (${before.stray} pixels, the first at ${before.at})`);
          assert.deepEqual(before.bare, [], `${says}: each lit line that shows has its field over and under it`);
          await shot(p, `reading-clip-${width}-${tone}-${where.split(' ')[0]}-${what.split(' ')[0]}`);
          await p.evaluate(`document.querySelector(${JSON.stringify(box)}).scrollLeft = 300`);
          await until(() => p.evaluate(`document.querySelector(${JSON.stringify(box)}).scrollLeft === 300`), `${says}: scrolls 300px sideways`);
          await painted(p);
          assert.equal(await shiningOn(p), lit, `${says}: the same words stay lit as the box scrolls`);
          const after = await fieldPaint(p, id);
          assert.ok(after.shown > 0, `${says}: some lit words still show once scrolled`);
          assert.equal(after.stray, 0, `${says}: scrolled 300px sideways, no field is left where no lit word shows (${after.stray} pixels, the first at ${after.at})`);
          assert.deepEqual(after.bare, [], `${says}: scrolled, each lit line that shows still has its field over and under it`);
          await shot(p, `reading-clip-${width}-${tone}-${where.split(' ')[0]}-${what.split(' ')[0]}-scrolled`);
          await p.evaluate(`document.querySelector(${JSON.stringify(box)}).scrollLeft = 0`);
        }
      }
    }
    assert.deepEqual(p.errors, []);
    await p.close();
  });

  // The rest of B1's class: a phone's excerpt cut off at a height (aim.css, a coarse pointer: a tablet with a trackpad
  // or a mouse) and a card that scrolls in place. A message longer than a card shows, whose first sentence runs past
  // where the excerpt is cut off: lit under the pointer while its whole words are still on their way, the sentence's
  // field stops where the excerpt is cut off, and none shows on the card below it. Once the whole message has come,
  // the card scrolls in place; a short sentence lit there has its field behind it, and keeps it as the card scrolls
  // 60 pixels under it.
  await check('reading a lit passage on a phone\'s cut-off excerpt paints no field past where the excerpt is cut off, and on a card that scrolls in place its field moves with the words, in light and dark', async () => {
    const topic = 'reading-clip-phone';
    const first = 'Here begins one sentence, ' + Array.from({ length: 30 }, () => 'and the words run on across the line').join(', ') + '.';
    const shorts = Array.from({ length: 24 }, (_, i) => `Short sentence ${i}.`);
    const ids = await seed(topic, [['earlier', { sender: 'aim-ux', join: true, addressees: [facts.actor], body: 'An earlier message.' }],
      ['long', { sender: 'aim-core', join: true, addressees: [facts.actor], body: [first, shorts.join(' ')].join('\n\n') }]]);
    const p = await open(topic, 'phone', topic, ids.long);
    const on = card(ids.long);
    await p.evaluate("window.waitView = 'source'");
    for (const dark of [false, true]) {
      const tone = dark ? 'dark' : 'light';
      await scheme(p, dark);
      await centre(p, on); await away(p);
      await moveTo(p, ids.long, 'Here begins');
      await until(async () => (await shiningOn(p))?.startsWith('Here begins'), `${tone}: the first sentence lights under the pointer`);
      assert.ok(await p.evaluate(`(c=>{const w=c.querySelector(':scope > .message-preview'),r=w.getBoundingClientRect(),h=CSS.highlights.get('lit-passage'),last=[...[...h][0].getClientRects()].at(-1);
        return c.dataset.whole!=='shown'&&getComputedStyle(w).overflowY==='hidden'&&w.scrollHeight>w.clientHeight+1&&last.bottom>r.bottom+10})(document.querySelector(${JSON.stringify(on)}))`), `${tone}: the excerpt is cut off, and the lit sentence runs past where it is cut off`);
      const clipped = await fieldPaint(p, ids.long);
      assert.equal(clipped.stray, 0, `${tone}: no field is painted on the card past where the excerpt is cut off (${clipped.stray} pixels, the first at ${clipped.at})`);
      assert.deepEqual(clipped.bare, [], `${tone}: each lit line that shows has its field over and under it`);
      await shot(p, `reading-clip-phone-${tone}-excerpt`);
    }
    await away(p);
    await p.evaluate('window.letViews()');
    await until(() => p.evaluate(`document.querySelector(${JSON.stringify(on)}).classList.contains('scroll-in-place')`), 'the whole message comes, and the card scrolls in place');
    for (const dark of [false, true]) {
      const tone = dark ? 'dark' : 'light';
      await scheme(p, dark);
      await p.evaluate(`(c=>{c.scrollIntoView({block:'center'});c.scrollTop=c.scrollHeight})(document.querySelector(${JSON.stringify(on)}))`);
      await painted(p); await away(p);
      await moveTo(p, ids.long, 'Short sentence 10.');
      await until(async () => (await shiningOn(p))?.trim() === 'Short sentence 10.', `${tone}: a short sentence lights under the pointer`);
      const top = await p.evaluate(`document.querySelector(${JSON.stringify(on)}).scrollTop`);
      assert.ok(top > 120, `${tone}: the card has scrolled in place (${top}px)`);
      const still = await fieldPaint(p, ids.long);
      assert.equal(still.stray, 0, `${tone}: no field shows where no lit word does (${still.stray} pixels, the first at ${still.at})`);
      assert.deepEqual(still.bare, [], `${tone}: on the card scrolled in place, the lit sentence has its field over and under it`);
      await p.evaluate(`document.querySelector(${JSON.stringify(on)}).scrollTop -= 60`);
      await until(() => p.evaluate(`document.querySelector(${JSON.stringify(on)}).scrollTop === ${top - 60}`), `${tone}: the card scrolls 60px under the pointer`);
      await painted(p);
      assert.equal((await shiningOn(p))?.trim(), 'Short sentence 10.', `${tone}: the same sentence stays lit as the card scrolls`);
      const whole = await shownLit(p, ids.long);
      assert.ok(whole.boxes.every(b => b.top >= b.shows.top + 8 && b.bottom <= b.shows.bottom - 8), `${tone}: the lit sentence still shows whole in the card, clear of its edges`);
      const moved = await fieldPaint(p, ids.long);
      assert.equal(moved.stray, 0, `${tone}: scrolled in place, no field is left where no lit word shows (${moved.stray} pixels, the first at ${moved.at})`);
      assert.deepEqual(moved.bare, [], `${tone}: scrolled in place, the lit sentence has its field over and under it`);
      await shot(p, `reading-clip-phone-${tone}-in-place`);
    }
    assert.deepEqual(p.errors, []);
    await p.close();
  });

  // Reviewer (B2): the field follows the words when they wrap anew. A passage of several lines lit on a topic's card
  // at 1280 wide; the window narrows to 760, where the passage runs to more lines, and widens to 1280 again, the
  // pointer resting on the words throughout: after each, every lit line has its field behind it, over and under, no
  // row between the lines is left unlit, and no field is left where the lines were.
  await check('reading a lit passage on a card keeps its field behind every lit line as the window narrows and widens and the words wrap anew', async () => {
    const topic = 'reading-field-wrap';
    const long = 'The long passage runs on across several lines on the card, and runs to more of them once the window narrows, so its dark field must follow its words to wherever they wrap.';
    const ids = await seed(topic, [['earlier', { sender: 'aim-ux', join: true, addressees: [facts.actor], body: 'An earlier message.' }],
      ['alone', { sender: 'aim-core', join: true, addressees: [facts.actor], body: ['Words before the field.', long, 'Words after the field.'].join('\n\n') }]]);
    const p = await open(topic, 'laptop', topic, ids.alone);
    await centre(p, card(ids.alone)); await away(p);
    await moveTo(p, ids.alone, 'long passage runs');
    await until(async () => (await shiningOn(p))?.trim() === long, 'the long passage lights under the pointer');
    let lines = (await litLines(p, 'card')).lines.length;
    for (const wide of [760, 1280]) {
      await p.send('Emulation.setDeviceMetricsOverride', { ...DEVICES.laptop, width: wide });
      await until(async () => await p.evaluate('innerWidth') === wide && (await litLines(p, 'card'))?.lines.length !== lines, `the window is ${wide}px wide and the lit words wrap anew`);
      await painted(p);
      const now = (await litLines(p, 'card')).lines.length;
      assert.equal((await shiningOn(p))?.trim(), long, `at ${wide}px the same passage stays lit`);
      await p.evaluate(`(w=>{const r=w.getBoundingClientRect();if(r.top<0||r.bottom>innerHeight)w.scrollIntoView({block:'center'})})(document.querySelector(${JSON.stringify(words(ids.alone))}))`);
      await painted(p);
      const field = await fieldOf(p, 'card'), paint = await fieldPaint(p, ids.alone);
      const says = `at ${wide}px (${lines} lines lit before, ${now} now): the field per line ${JSON.stringify(field.lines)}px (over ${field.above}, under ${field.below}, ${field.gaps} rows unlit)`;
      assert.equal(field.lines.length, now, `${says}: every lit line is measured`);
      assert.equal(field.gaps, 0, `${says}: every lit line has its field behind it after the resize, no row between them unlit`);
      assert.ok(field.above >= 1 && field.below >= 1, `${says}: the field reaches over the first line and under the last`);
      assert.ok(field.lines.every(line => Math.abs(line - field.lines[0]) <= 1), `${says}: each line's field as tall as the others`);
      assert.equal(paint.stray, 0, `${says}: no field is left where no lit word shows (${paint.stray} pixels, the first at ${paint.at})`);
      assert.deepEqual(paint.bare, [], `${says}: each lit line has its field over and under it`);
      await shot(p, `reading-field-wrap-${wide}`);
      lines = now;
    }
    assert.deepEqual(p.errors, []);
    await p.close();
  });

  // A card's passage light in each of its states at a phone's widths with a pointer (item 527), as on a laptop
  // (the cases above): off the words nothing lights; under the pointer a passage lights; off the words again it stays;
  // moved with Shift held it grows; the focus moving to a control of the message, where Return presses the control,
  // puts it out; back on the card it lights again, and Return quotes it. Nothing scrolls sideways at any of them.
  for (const [width, called] of WIDTHS.slice(1)) await check(`reading a card's passage light at ${called}: none off the words, lit, kept off the words, grown with Shift, out at a control of the message, and quoted by Return`, async () => {
    const topic = 'reading-states-' + width;
    const said = ['Words before the passage.', 'The lit passage is these words.', 'Words after the passage.'];
    const ids = await seed(topic, [['earlier', { sender: 'aim-core', join: true, addressees: [facts.actor], body: 'An earlier message.' }],
      ['alone', { sender: 'aim-ux', join: true, addressees: [facts.actor], body: said.join(' ') }]]);
    const p = await open(topic, width, topic, ids.alone);
    const on = card(ids.alone), sideways = () => p.evaluate('document.scrollingElement.scrollWidth - innerWidth');
    const focus = () => p.evaluate(`(c=>{const e=document.activeElement,b=document.querySelector('${BAR}');return e===c?'card':c.contains(e)||b.contains(e)?(e.getAttribute('aria-label')||e.title||e.textContent):e?e.tagName.toLowerCase():null})(document.querySelector(${JSON.stringify(on)}))`);
    await centre(p, on);
    await p.point(on + ' > .message-author', 'move');
    await until(async () => (await lit(p)).includes(ids.alone), `${called}: the message lights from its author's line`);
    assert.equal(await shiningOn(p), null, `${called}: off the words no passage lights`);
    await moveTo(p, ids.alone, 'lit passage');
    await becomes(() => shiningOn(p), said[1] + ' ', `${called}: the passage under the pointer lights`);
    assert.ok(await sideways() <= 0, `${called}: nothing scrolls sideways with a passage lit`);
    await shot(p, `reading-states-${width}-lit`);
    await p.point(on + ' > .message-author', 'move');
    assert.equal(await shiningOn(p), said[1] + ' ', `${called}: off the words the passage lit stays lit`);
    await moveTo(p, ids.alone, 'Words after', 8);
    await becomes(() => shiningOn(p), `${said[1]} ${said[2]}`, `${called}: moved with Shift held, the light grows to the passage under the pointer`);
    assert.ok(await sideways() <= 0, `${called}: nothing scrolls sideways with the light grown`);
    await shot(p, `reading-states-${width}-grown`);
    assert.equal(await focus(), 'card', `${called}: the focus is on the card`);
    await p.key('Tab');
    await until(async () => !['card', 'body', null].includes(await focus()), `${called}: Tab reaches a control of the message`);
    assert.equal(await shiningOn(p), null, `${called}: at ${await focus()}, where Return presses the control, no passage is lit`);
    await shot(p, `reading-states-${width}-out`);
    for (let i = 0; i < 4 && await focus() !== 'card'; i++) {
      const was = await focus();
      await p.key('Tab', 8);
      await until(async () => await focus() !== was, `${called}: Shift-Tab moves the focus back`);
    }
    assert.equal(await focus(), 'card', `${called}: Shift-Tab comes back to the card`);
    await moveTo(p, ids.alone, 'Words before');
    await becomes(() => shiningOn(p), said[0] + ' ', `${called}: back on the card the passage under the pointer lights again`);
    await p.key('Enter');
    await until(async () => (await readerOn(p))?.startsWith(said[0]) && await p.evaluate(`document.activeElement?.id === 'writing-body'`), `${called}: Return opens the Reader`);
    assert.equal(await replyOf(p), `> ${said[0]} \n\n`, `${called}: Return quotes the passage lit, and nothing more`);
    assert.ok(await sideways() <= 0, `${called}: nothing scrolls sideways in the Reader`);
    await closeReader(p, 'laptop');
    assert.deepEqual(p.errors, []);
    await p.close();
  });

  // A lit passage promises the quote Return would make (docs/experience-guidelines.md, "Keys mean one thing in each
  // place"): the focus moving where Return does something else, a control of the lit message (its ☆, the bar's 👍,
  // Reply and ⋯) or writing, puts the light out, as it goes out in the Reader. Back on the card, where Return quotes,
  // the pointer resting on the words lights a passage again, and Return quotes it.
  await check('reading a card\'s lit passage goes out as the focus moves to a control of the message or to writing, where Return does something else', async () => {
    const topic = 'reading-passage-focus';
    const said = ['Words before the passage.', 'The lit passage is these words.', 'Words after the passage.'];
    const ids = await seed(topic, [['earlier', { sender: 'aim-core', join: true, addressees: [facts.actor], body: 'An earlier message.' }],
      ['alone', { sender: 'aim-ux', join: true, addressees: [facts.actor], body: said.join(' ') }]]);
    const p = await open(topic, 'laptop', topic, ids.alone);
    const on = card(ids.alone);
    // Where the focus is: the card itself, or a control of the message (in its card or its bar) by its name.
    const focus = () => p.evaluate(`(c=>{const e=document.activeElement,b=document.querySelector('${BAR}');return e===c?'card':c.contains(e)||b.contains(e)?(e.getAttribute('aria-label')||e.title||e.textContent):e&&e.matches('input,textarea,[contenteditable="true"]')?'writing':e?e.tagName.toLowerCase():null})(document.querySelector(${JSON.stringify(on)}))`);
    await centre(p, on);
    await moveTo(p, ids.alone, 'lit passage');
    await becomes(() => shiningOn(p), said[1] + ' ', 'the passage under the pointer lights');
    // The pointer moving onto the message gave it the keys' place: the focus is on the card, where Return quotes.
    assert.equal(await focus(), 'card', 'the focus is on the card');
    // Tab goes through the message's controls; at each, Return presses the control, and no passage is lit.
    const stops = [];
    for (let i = 1; i <= 4; i++) {
      const was = await focus();
      await p.key('Tab');
      await until(async () => await focus() !== was, `Tab ${i} moves the focus`);
      stops.push(await focus());
      assert.ok(!['card', 'body', null].includes(stops.at(-1)), `Tab ${i} reaches a control of the message (${stops.join(', ')})`);
      assert.equal(await shiningOn(p), null, `at ${stops.at(-1)} (Tab ${i}), where Return presses the control and quotes nothing, no passage is lit`);
    }
    await shot(p, 'reading-passage-focus-control');
    await p.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'dark' }] });
    await until(() => p.evaluate(`matchMedia('(prefers-color-scheme: dark)').matches`), 'the page in the dark scheme');
    await shot(p, 'reading-passage-focus-control-dark');
    await p.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: '' }] });
    await until(() => p.evaluate(`!matchMedia('(prefers-color-scheme: dark)').matches`), 'the page in the light scheme again');
    // Shift-Tab comes back to the card: the pointer resting on the words lights a passage there again, and Return quotes it.
    for (let i = 0; i < 4 && await focus() !== 'card'; i++) {
      const was = await focus();
      await p.key('Tab', 8);
      await until(async () => await focus() !== was, 'Shift-Tab moves the focus back');
    }
    assert.equal(await focus(), 'card', 'Shift-Tab comes back to the card');
    await moveTo(p, ids.alone, 'Words after');
    await becomes(() => shiningOn(p), said[2], 'with the focus on the card, the passage under the pointer lights');
    assert.equal(await focus(), 'card', 'and the focus stays on the card');
    await p.key('Enter');
    await until(async () => (await readerOn(p))?.startsWith(said[0]) && await p.evaluate(`document.activeElement?.id === 'writing-body'`), 'Return opens the Reader');
    assert.equal(await replyOf(p), `> ${said[2]}\n\n`, 'Return on the card quotes the passage lit');
    await closeReader(p, 'laptop');
    // The focus moving into writing by the keys (⌘Return, a new message in this page's place) puts the light out too.
    await centre(p, on);
    await moveTo(p, ids.alone, 'lit passage');
    await becomes(() => shiningOn(p), said[1] + ' ', 'a passage lights again');
    assert.equal(await focus(), 'card', 'the focus is on the card');
    await p.key('Enter', 4);
    await until(async () => await focus() === 'writing', '⌘Return puts the cursor in writing');
    assert.equal(await shiningOn(p), null, 'with the cursor in writing, where Return makes a new line, no passage is lit');
    assert.deepEqual(p.errors, []);
    await p.close();
  });

  // Shift-click on a card lights from the passage lit first to the one under the pointer, as in the Reader, and opens
  // nothing; the browser grows no selection of its own beside the light. Words selected on a card (dragged over) are
  // what Shift grows the light from, giving way to it, and what Return quotes when they are there.
  await check('reading Shift-click on a card grows the light and opens nothing; words selected on a card anchor Shift\'s light, and Return quotes exactly them', async () => {
    const topic = 'reading-passage-shift';
    const said = ['Words before the passage.', 'The lit passage is these words.', 'Words after the passage.'];
    const body = said.join(' ');
    const ids = await seed(topic, [['earlier', { sender: 'aim-core', join: true, addressees: [facts.actor], body: 'An earlier message.' }],
      ['alone', { sender: 'aim-ux', join: true, addressees: [facts.actor], body }]]);
    const p = await open(topic, 'laptop', topic, ids.alone);
    const on = card(ids.alone);
    const collapsed = () => p.evaluate('getSelection().isCollapsed');
    await centre(p, on);
    await moveTo(p, ids.alone, 'Words before');
    await becomes(() => shiningOn(p), said[0] + ' ', 'the first passage lights');
    // Off the words, on the author's line, the light stays; the Shift-click is then pressed where the last passage is.
    await p.point(on + ' > .message-author', 'move');
    assert.equal(await shiningOn(p), said[0] + ' ', 'off the words the passage lit stays lit');
    const at = await wordsAt(p, ids.alone, 'Words after');
    const taps = await p.evaluate('window.taps');
    await p.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: at.x, y: at.y, button: 'left', clickCount: 1, modifiers: 8 });
    await p.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: at.x, y: at.y, button: 'left', clickCount: 1, modifiers: 8 });
    await until(() => p.evaluate(`window.taps > ${taps}`), 'the Shift-click is heard');
    await p.evaluate('new Promise(done=>requestAnimationFrame(()=>requestAnimationFrame(done)))');
    assert.equal(await shiningOn(p), body, 'Shift-click lights from the passage lit first to the one under the pointer');
    assert.equal(await readerOn(p), null, 'Shift-click opens nothing');
    assert.equal(await collapsed(), true, 'and the browser grows no selection of its own beside the light');
    await shot(p, 'reading-passage-shift-click');
    await p.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'dark' }] });
    await until(() => p.evaluate(`matchMedia('(prefers-color-scheme: dark)').matches`), 'the page in the dark scheme');
    assert.equal(await shiningOn(p), body, 'the light stays as the scheme changes');
    await shot(p, 'reading-passage-shift-click-dark');
    await p.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: '' }] });
    await until(() => p.evaluate(`!matchMedia('(prefers-color-scheme: dark)').matches`), 'the page in the light scheme again');
    await p.key('Enter');
    await until(async () => (await readerOn(p))?.startsWith(said[0]) && await p.evaluate(`document.activeElement?.id === 'writing-body'`), 'Return opens the Reader');
    assert.equal(await replyOf(p), `> ${body}\n\n`, 'Return quotes the passages the Shift-click lit');
    await closeReader(p, 'laptop');
    // Words dragged over in the middle passage, another passage lit: Shift grows the light from the passages the
    // words touch, not from the passage lit, and the selection gives way to the light.
    await centre(p, on);
    await moveTo(p, ids.alone, 'Words before');
    await becomes(() => shiningOn(p), said[0] + ' ', 'the first passage lights again');
    assert.equal(await selectOn(p, ids.alone, 'passage is these'), true, 'words in the middle passage selected');
    await moveTo(p, ids.alone, 'Words after', 8);
    await becomes(() => shiningOn(p), `${said[1]} ${said[2]}`, 'moved with Shift held, the light grows from the passage the selected words are in, not from the one lit');
    assert.equal(await collapsed(), true, 'the selection gives way to the light');
    await p.key('Enter');
    await until(async () => (await readerOn(p))?.startsWith(said[0]) && await p.evaluate(`document.activeElement?.id === 'writing-body'`), 'Return opens the Reader');
    assert.ok((await replyOf(p)).endsWith(`> ${said[1]} ${said[2]}\n\n`), `Return quotes the passages lit from the selection: ${JSON.stringify(await replyOf(p))}`);
    await closeReader(p, 'laptop');
    // Words selected on a card with a passage lit: Return quotes exactly the words selected, not the passage.
    await centre(p, on);
    await moveTo(p, ids.alone, 'Words before');
    await becomes(() => shiningOn(p), said[0] + ' ', 'the first passage lights again');
    assert.equal(await selectOn(p, ids.alone, 'passage is these'), true, 'words in the middle passage selected');
    await p.key('Enter');
    await until(async () => (await readerOn(p))?.startsWith(said[0]) && await p.evaluate(`document.activeElement?.id === 'writing-body'`), 'Return opens the Reader');
    assert.ok((await replyOf(p)).endsWith(`\n\n> passage is these\n\n`), `Return quotes exactly the words selected, not the passage lit: ${JSON.stringify(await replyOf(p))}`);
    await closeReader(p, 'laptop');
    assert.deepEqual(p.errors, []);
    await p.close();
  });

  // A card drawn again under its lit passage puts the light out (item 478), as an edit drawn into the Reader puts out
  // the passage lit there (docs/reader.md): once the words change, the place lit holds other words, and Return and ⌘C
  // would act on words no one lit. With no passage lit, Return quotes nothing and ⌘C copies the whole message as
  // written; the pointer moving on the new words lights a passage of them, which ⌘C copies and Return quotes exactly.
  // Each is pressed as the person presses it, ⌘C read back through the browser's own clipboard (copyOn, sureOn).
  // redrawn(p, id, words, lit, copied): the checks once the card is drawn again with words; lit is text of a passage
  // the pointer then rests on, copied that passage's words as ⌘C copies them.
  const redrawn = async (p, id, words, lit, copied) => {
    assert.equal(await shiningOn(p), null, 'the card drawn again with other words, no words are lit, not the place lit on the old ones');
    const got = await copyOn(p);
    if (grant) assert.equal(got, words, '⌘C with no passage lit copies the whole message as written, not words of the place lit before');
    await p.key('Enter');
    await until(async () => (await readerOn(p))?.startsWith(words.slice(0, 20)) && await p.evaluate(`document.activeElement?.id === 'writing-body'`), 'Return opens the Reader on the message');
    assert.equal(await replyOf(p), '', 'Return with no passage lit quotes nothing, not words of the place lit before');
    if (!grant) await sureOn(p, null, words, '⌘C copied the whole message as written, not words of the place lit before');
    await closeReader(p, 'laptop');
    // On the new words the pointer lights a passage of them; ⌘C and Return act on exactly it.
    await centre(p, card(id));
    await moveTo(p, id, lit);
    await becomes(() => shiningOn(p), copied + ' ', 'on the new words the pointer lights a passage of them');
    const again = await copyOn(p);
    if (grant) assert.equal(again, copied, '⌘C copies exactly the passage lit on the new words');
    await p.key('Enter');
    await until(async () => (await readerOn(p))?.startsWith(words.slice(0, 20)) && await p.evaluate(`document.activeElement?.id === 'writing-body'`), 'Return opens the Reader again');
    assert.ok((await replyOf(p)).endsWith(`> ${copied} \n\n`), `Return quotes exactly the passage lit on the new words: ${JSON.stringify(await replyOf(p))}`);
    if (!grant) await sureOn(p, null, copied, '⌘C copied exactly the passage lit on the new words');
    await closeReader(p, 'laptop');
  };

  // The whole of a cut-off message arriving in place of its excerpt is one such redraw. The whole is read ahead as the
  // card lights, and is held here in the server until the excerpt's last sentence, cut mid-word, is lit.
  await check('reading a cut-off card\'s lit passage goes out as its whole message arrives in place of the excerpt; ⌘C and Return then act on no words of the excerpt', async () => {
    const topic = 'reading-passage-whole';
    // Over the 1,024 bytes of a long message's excerpt, which cuts its last sentence mid-word.
    const filler = Array.from({ length: 21 }, (_, i) => `Sentence ${i + 1} fills the card with words to read.`).join(' ') + ' And one more sentence pads it out.';
    const last = 'The cut sentence goes on past where the excerpt ends, and ends here.', body = `${filler} ${last}`, cut = body.slice(filler.length + 1, 1024);
    assert.equal(cut, 'The cut sen', 'the excerpt cuts the last sentence mid-word');
    const ids = await seed(topic, [['earlier', { sender: 'aim-core', join: true, addressees: [facts.actor], body: 'An earlier message.' }],
      ['long', { sender: 'aim-ux', join: true, addressees: [facts.actor], body }]]);
    if (grant) await grant(['clipboard-read', 'clipboard-write']);
    const p = await open(topic, 'laptop', topic, ids.long, 'window.holdReads = true;');
    const on = card(ids.long), shown = () => p.evaluate(`document.querySelector(${JSON.stringify(words(ids.long))}).textContent`);
    assert.ok((await shown()).endsWith(cut), 'the card shows the excerpt, its last sentence cut mid-word');
    await centre(p, on); await away(p);
    await until(() => p.evaluate('window.fetchesOut === 0'), 'the page has its answers');
    const since = (await control({ method: 'admission_events', after: Number.MAX_SAFE_INTEGER })).next;
    const hold = topic + '-hold';
    await control({ method: 'read_hold', hold_id: hold, name: 'source', phase: 'callback', read_class: 'background', count: 1 });
    try {
      await moveTo(p, ids.long, 'cut sen');
      await until(async () => (await control({ method: 'admission_events', after: since })).events.some(e => e.event === 'hold-enter' && e.hold_id === hold), 'the card lights, and the read ahead of its whole message is held in the server');
      await becomes(() => shiningOn(p), cut, 'the excerpt\'s last sentence, cut mid-word, lights under the pointer');
    } finally { await control({ method: 'read_release', hold_id: hold }); }
    await until(() => p.evaluate(`(c=>c.dataset.whole==='shown'&&c.querySelector(':scope > .message-preview').textContent.endsWith(${JSON.stringify(last)}))(document.querySelector(${JSON.stringify(on)}))`), 'the whole message arrives in place of the excerpt');
    await shot(p, 'reading-passage-whole');
    await redrawn(p, ids.long, body, 'Sentence 2 fills', 'Sentence 2 fills the card with words to read.');
    assert.deepEqual(p.errors, []);
    await p.close();
  });

  // An edit arriving is the other: the person's message, edited on another device while a passage of it is lit here.
  await check('reading an edit arriving under a card\'s lit passage puts the light out; ⌘C and Return then act on no words of the place lit before', async () => {
    const topic = 'reading-passage-edited';
    const said = ['Words before the passage.', 'The lit passage is these words.', 'Words after the passage.'];
    const edited = 'New words come first in this edit, longer. Then a second sentence. The end.';
    const ids = await seed(topic, [['earlier', { sender: 'aim-core', join: true, addressees: [facts.actor], body: 'An earlier message.' }],
      ['mine', { sender: 'person', body: said.join(' ') }]]);
    if (grant) await grant(['clipboard-read', 'clipboard-write']);
    const p = await open(topic, 'laptop', topic, ids.mine);
    await centre(p, card(ids.mine));
    await moveTo(p, ids.mine, 'lit passage');
    await becomes(() => shiningOn(p), said[1] + ' ', 'the passage under the pointer lights');
    // The person's Save on another device, through Core (docs/message-edit.md), by the revision it was edited from.
    const headers = { Authorization: `Bearer ${facts.token}`, Origin: facts.origin, 'Content-Type': 'application/json' };
    const b = await (await fetch(facts.origin + '/api/bootstrap', { headers })).json();
    const receipt = await (await fetch(facts.origin + '/api/command', { method: 'POST', headers, body: JSON.stringify({ v: 1, instance_id: b.instance_id,
      operation_id: topic + '-elsewhere', kind: 'message.edit', target: { message_id: ids.mine },
      expected: { authority: { authority_id: b.authority.authority_id, authority_epoch: b.authority.authority_epoch }, message_revision: 1 }, args: { body: edited } }) })).json();
    assert.equal(receipt.status, 'committed', 'the edit elsewhere commits: ' + JSON.stringify(receipt.error ?? null));
    await until(() => p.evaluate(`document.querySelector(${JSON.stringify(words(ids.mine))}).textContent === ${JSON.stringify(edited)}`), 'the card draws the edited words');
    await shot(p, 'reading-passage-edited');
    await redrawn(p, ids.mine, edited, 'second sentence', 'Then a second sentence.');
    assert.deepEqual(p.errors, []);
    await p.close();
  });

  // The person's Save on another device, through Core (docs/message-edit.md): message id edited from revision from to body.
  const editElsewhere = async (id, from, body, operation) => {
    const headers = { Authorization: `Bearer ${facts.token}`, Origin: facts.origin, 'Content-Type': 'application/json' };
    const b = await (await fetch(facts.origin + '/api/bootstrap', { headers })).json();
    const receipt = await (await fetch(facts.origin + '/api/command', { method: 'POST', headers, body: JSON.stringify({ v: 1, instance_id: b.instance_id,
      operation_id: operation, kind: 'message.edit', target: { message_id: id },
      expected: { authority: { authority_id: b.authority.authority_id, authority_epoch: b.authority.authority_epoch }, message_revision: from }, args: { body } }) })).json();
    assert.equal(receipt.status, 'committed', 'the edit elsewhere commits: ' + JSON.stringify(receipt.error ?? null));
  };
  // The words a card shows drawn again as they were keep its light on them (item 527): a reply's card is drawn again
  // with its own unchanged words when the message it answers is edited (its "Replying to" line reads the new words).
  // The light stays on the same words of the words drawn anew, and Return quotes them.
  await check('reading a reply\'s card drawn again with its own words, as the message it answers is edited, keeps its lit passage', async () => {
    const topic = 'reading-passage-same';
    const said = ['Words before the passage.', 'The lit passage is these words.', 'Words after the passage.'];
    const ids = await seed(topic, [['mine', { sender: 'person', body: 'The message the reply answers.' }],
      ['reply', { sender: 'aim-ux', join: true, addressees: [facts.actor], reply_to: 'mine', body: said.join(' ') }]]);
    const p = await open(topic, 'laptop', topic, ids.reply);
    const on = card(ids.reply);
    await centre(p, on);
    await moveTo(p, ids.reply, 'lit passage');
    await becomes(() => shiningOn(p), said[1] + ' ', 'the passage under the pointer lights on the reply\'s card');
    await p.evaluate(`window.wordsBefore = [...document.querySelector(${JSON.stringify(words(ids.reply))}).childNodes]`);
    await editElsewhere(ids.mine, 1, 'The message the reply answers, edited elsewhere.', topic + '-elsewhere');
    await until(() => p.evaluate(`document.querySelector(${JSON.stringify(on + ' > .message-reply-to')})?.textContent.includes('edited elsewhere')`), 'the reply\'s line reads the edited words');
    assert.equal(await p.evaluate('window.wordsBefore.every(node => !node.isConnected)'), true, 'the reply\'s own words were drawn again');
    assert.equal(await p.evaluate(`document.querySelector(${JSON.stringify(words(ids.reply))}).textContent`), said.join(' '), 'as the same words');
    assert.equal(await shiningOn(p), said[1] + ' ', 'the light stays on the same words, drawn anew');
    assert.equal(await p.evaluate(`(()=>{const h=CSS.highlights.get('lit-passage');return Boolean(h&&h.size&&[...h][0].startContainer.isConnected)})()`), true, 'lit on the words as they are drawn now');
    await shot(p, 'reading-passage-same');
    await p.key('Enter');
    await until(async () => (await readerOn(p))?.startsWith(said[0]) && await p.evaluate(`document.activeElement?.id === 'writing-body'`), 'Return opens the Reader');
    assert.equal(await replyOf(p), `> ${said[1]} \n\n`, 'Return quotes the passage still lit');
    await closeReader(p, 'laptop');
    assert.deepEqual(p.errors, []);
    await p.close();
  });

  // A quote taken from a card names the revision of the words the card shows, the words it quotes (item 527). A card
  // still showing an older revision than the Reader that Return opens on (the page has heard of an edit made
  // elsewhere, and its read of the edited words is slow) quotes that revision's words and names that revision, and
  // Core records it so; a quote naming the Reader's newer revision would name words it does not hold, which Core
  // refuses.
  await check('reading Return on a card still showing an older revision quotes that revision\'s words and names it, though the Reader opens on the newer one', async () => {
    const topic = 'reading-passage-revision';
    const said = ['Words before the passage.', 'The lit passage is these words.', 'Words after the passage.'];
    const edited = 'New words come first in this edit, longer. Then a second sentence. The end.';
    const ids = await seed(topic, [['earlier', { sender: 'aim-core', join: true, addressees: [facts.actor], body: 'An earlier message.' }],
      ['mine', { sender: 'person', body: said.join(' ') }]]);
    const p = await open(topic, 'laptop', topic, ids.mine);
    await centre(p, card(ids.mine));
    await moveTo(p, ids.mine, 'lit passage');
    await becomes(() => shiningOn(p), said[1] + ' ', 'the passage under the pointer lights');
    // From here the page's reads of the topic's messages wait unsent, as a slow connection holds them.
    await p.evaluate("window.waitView = 'topic_messages'");
    await editElsewhere(ids.mine, 1, edited, topic + '-elsewhere');
    await until(() => p.evaluate('window.waitingViews.length > 0'), 'the page hears of the edit, and its read of the edited words waits');
    assert.equal(await p.evaluate(`document.querySelector(${JSON.stringify(words(ids.mine))}).textContent`), said.join(' '), 'the card still shows revision 1');
    assert.equal(await shiningOn(p), said[1] + ' ', 'with its passage lit');
    await p.key('Enter');
    await until(async () => (await readerOn(p)) !== null && await p.evaluate(`document.activeElement?.id === 'writing-body'`), 'Return opens the Reader, the cursor in the reply');
    assert.equal(await readerOn(p), edited, 'the Reader shows revision 2, the newer one');
    assert.equal(await replyOf(p), `> ${said[1]} \n\n`, 'the reply quotes the words lit on the card');
    // Core's answer to the send, which refuses a quote naming a revision whose words do not hold it (INVALID_QUOTE).
    await p.key('Enter', 4);
    const receipt = await until(() => p.evaluate('window.sendReceipts[0] ?? null'), 'Core answers the reply\'s send');
    assert.equal(receipt.status, 'committed', 'Core takes the reply with its quote: ' + JSON.stringify(receipt.error ?? null));
    let sent = null;
    await until(async () => {
      const page = await view('topic_messages', { topic_id: topic, direction: 'before', limit: 5 });
      const reply = page.items.find(item => item.reply_to === ids.mine && item.author_id === facts.actor);
      if (!reply) return false;
      sent = await view('source', { source_ref: { kind: 'message', id: reply.id } });
      return true;
    }, 'the reply lands in Core');
    assert.deepEqual(sent.quotes.map(q => [q.source, q.excerpt]), [[{ kind: 'message', id: ids.mine, revision: 1 }, said[1] + ' ']],
      'the quote names revision 1, the one the card showed and its words come from');
    await p.evaluate('window.letViews()');
    await until(() => p.evaluate(`document.querySelector(${JSON.stringify(words(ids.mine))}).textContent === ${JSON.stringify(edited)}`), 'the card then draws the edited words');
    assert.deepEqual(p.errors, []);
    await p.close();
  });

  // The focus going to the message's ⋯ menu, opened from its bar or by a right-click on its words, puts a lit passage
  // out (item 527, docs/interaction.md "The light"): Return there presses a menu item, and quotes nothing.
  await check('reading a card\'s lit passage goes out as the message\'s ⋯ menu takes the focus, from its bar or a right-click', async () => {
    const topic = 'reading-passage-menu';
    const said = ['Words before the passage.', 'The lit passage is these words.', 'Words after the passage.'];
    const ids = await seed(topic, [['earlier', { sender: 'aim-core', join: true, addressees: [facts.actor], body: 'An earlier message.' }],
      ['alone', { sender: 'aim-ux', join: true, addressees: [facts.actor], body: said.join(' ') }]]);
    const p = await open(topic, 'laptop', topic, ids.alone);
    const menu = () => p.evaluate(`(m=>m?{focused:m.contains(document.activeElement),items:[...m.querySelectorAll('[role=menuitem]')].map(b=>b.firstChild.textContent)}:null)(document.querySelector('.message-menu-list'))`);
    await centre(p, card(ids.alone));
    await moveTo(p, ids.alone, 'lit passage');
    await becomes(() => shiningOn(p), said[1] + ' ', 'the passage under the pointer lights');
    await p.point(BAR + ' [data-act="more"]');
    await until(async () => (await menu())?.focused, 'the bar\'s ⋯ opens the message\'s menu, the focus on its first item');
    assert.equal(await shiningOn(p), null, 'with the focus in the menu, where Return presses an item, no passage is lit');
    await shot(p, 'reading-passage-menu-bar');
    await p.key('Escape');
    await until(async () => await menu() === null, 'Escape closes the menu');
    assert.equal(await shiningOn(p), null, 'and lights nothing again');
    // Back on the words, a passage lights; a right-click on the card opens the menu where the pointer is. It is pressed
    // in the card's corner, off its words, where the light stays as it was: Safari's engine selects the word a
    // right-click lands on, and words selected keep the browser's own menu.
    await moveTo(p, ids.alone, 'Words after');
    await becomes(() => shiningOn(p), said[2], 'the pointer on the words lights a passage again');
    const corner = await p.evaluate(`(b=>({x:b.left+6,y:b.top+6}))(document.querySelector(${JSON.stringify(card(ids.alone))}).getBoundingClientRect())`);
    await p.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: corner.x, y: corner.y });
    assert.equal(await shiningOn(p), said[2], 'off the words, in the card\'s corner, the passage lit stays lit');
    for (const type of ['mousePressed', 'mouseReleased']) await p.send('Input.dispatchMouseEvent', { type, x: corner.x, y: corner.y, button: 'right', clickCount: 1 });
    await until(async () => (await menu())?.focused, 'a right-click on the card opens the message\'s menu, the focus on its first item');
    assert.equal(await shiningOn(p), null, 'with the focus in the menu a right-click opened, no passage is lit');
    await shot(p, 'reading-passage-menu-right');
    await p.key('Escape');
    await until(async () => await menu() === null, 'Escape closes the menu');
    assert.equal(await readerOn(p), null, 'nothing opened');
    assert.deepEqual(p.errors, []);
    await p.close();
  });

  // Tab off a lit passage on a dossier's card, to a control of its message, empties the page's light (item 527), as on
  // a topic's card: CSS.highlights holds no passage, so nothing shows lit where Return would press the control.
  await check('reading Tab off a lit passage on a dossier\'s card puts the light out, and back on the card it lights again', async () => {
    const topic = 'reading-passage-dossier-tab';
    const said = ['Words before the passage.', 'The lit passage is these words.', 'Words after the passage.'];
    const ids = await seed(topic, [['root', { sender: 'aim-core', join: true, addressees: [facts.actor], body: 'The message a dossier grows from.' }],
      ['reply', { sender: 'aim-ux', join: true, addressees: [facts.actor], reply_to: 'root', body: said.join(' ') }]]);
    const p = await open(topic, 'laptop', topic, ids.reply);
    const on = card(ids.reply), empty = () => p.evaluate(`(h=>!h||h.size===0)(CSS.highlights.get('lit-passage'))`);
    const focus = () => p.evaluate(`(c=>{const e=document.activeElement,b=document.querySelector('${BAR}');return e===c?'card':c.contains(e)||b.contains(e)?(e.getAttribute('aria-label')||e.title||e.textContent):e?e.tagName.toLowerCase():null})(document.querySelector(${JSON.stringify(on)}))`);
    assert.equal(await p.evaluate(`Boolean(document.querySelector(${JSON.stringify(on)}).closest('.reply-stack'))`), true, 'the reply\'s card is in a dossier');
    await centre(p, on);
    await moveTo(p, ids.reply, 'lit passage');
    await becomes(() => shiningOn(p), said[1] + ' ', 'the passage under the pointer lights on the dossier\'s card');
    assert.equal(await focus(), 'card', 'the focus is on the card');
    await p.key('Tab');
    await until(async () => !['card', 'body', null].includes(await focus()), 'Tab reaches a control of the message');
    assert.equal(await empty(), true, `at ${await focus()}, where Return presses the control, CSS.highlights holds no lit passage`);
    await shot(p, 'reading-passage-dossier-tab');
    await p.key('Tab', 8);
    await until(async () => await focus() === 'card', 'Shift-Tab comes back to the card');
    await moveTo(p, ids.reply, 'Words after');
    await becomes(() => shiningOn(p), said[2], 'back on the card the passage under the pointer lights again');
    assert.deepEqual(p.errors, []);
    await p.close();
  });

  // Shift-click on a link in a card's words opens the link as the browser does, in a new window, as it did before a
  // card's passages lit (item 478); the page leaves it alone, as the Reader leaves a press on a link, and it grows no
  // light. Shift-click on the card's other words still grows the light, and opens nothing. The link goes to a file of
  // this server, outside the app's own places, so the new window has an address to show in Safari's engine too.
  await check('reading Shift-click on a link in a card\'s words opens it in a new window as the browser does; Shift-click on its other words grows the light', async () => {
    const topic = 'reading-passage-link', ELSEWHERE = facts.origin + '/aim.css?shift-click';
    const said = ['Words before the link.', `The style is at ${ELSEWHERE} now.`, 'Words after the link.'];
    const ids = await seed(topic, [['earlier', { sender: 'aim-core', join: true, addressees: [facts.actor], body: 'An earlier message.' }],
      ['alone', { sender: 'aim-ux', join: true, addressees: [facts.actor], body: said.join(' ') }]]);
    const p = await open(topic, 'laptop', topic, ids.alone);
    const on = card(ids.alone);
    await until(() => p.evaluate(`document.querySelector(${JSON.stringify(on + ' a.words-link[target="_blank"]')})?.getAttribute('href') === ${JSON.stringify(ELSEWHERE)}`), 'the card shows the link, to open in a new window');
    // Each click as the window first hears it, kept to read once it is over: whether the page took it from the browser;
    // and whether the focus has been on the card's link.
    await p.evaluate(`(addEventListener('click',e=>{window.lastClick=e},true),addEventListener('focusin',e=>{if(e.target.matches?.('a.words-link'))window.linkFocused=true},true),true)`);
    const shiftClick = async text => {
      const at = await wordsAt(p, ids.alone, text), taps = await p.evaluate('window.taps');
      assert.ok(at, `${text} is drawn on the card`);
      for (const type of ['mousePressed', 'mouseReleased']) await p.send('Input.dispatchMouseEvent', { type, x: at.x, y: at.y, button: 'left', clickCount: 1, modifiers: 8 });
      await until(() => p.evaluate(`window.taps > ${taps}`), `the Shift-click on ${text} is heard`);
    };
    await centre(p, on);
    // Shift-click on the card's words grows the light from the passage lit to the one under the pointer, and opens nothing.
    await moveTo(p, ids.alone, 'Words before');
    await becomes(() => shiningOn(p), said[0] + ' ', 'the first passage lights');
    await shiftClick('Words after');
    await becomes(() => shiningOn(p), said.join(' '), 'Shift-click on the card\'s words grows the light from the passage lit to the one under the pointer');
    assert.equal(await p.evaluate('window.lastClick.defaultPrevented'), true, 'the page takes a Shift-click on words from the browser');
    assert.equal(await readerOn(p), null, 'Shift-click on words opens nothing');
    // The pointer comes to rest on the link, which lights the passage it is in, as passing over words does. Words of
    // the passage before it are then selected, as a drag over them selects them: Shift grows a light from words
    // selected (the Shift-click case above), so a light the Shift-click grew would reach back over that passage, and
    // differ from the one lit (item 527). The Shift-click lands where the pointer rests, so nothing moves before it.
    await moveTo(p, ids.alone, 'aim.css');
    await becomes(() => shiningOn(p), said[1] + ' ', 'the passage the link is in lights');
    assert.equal(await selectOn(p, ids.alone, 'before the'), true, 'words of the passage before the link selected');
    const before = await windows.list();
    await shiftClick('aim.css');
    // The link grows no light. Where the click put the focus on the link (Chrome's does), Return there follows the
    // link, and the light went out as it does wherever Return quotes nothing; otherwise it stays as it was.
    const onLink = await p.evaluate('window.linkFocused === true');
    assert.equal(await shiningOn(p), onLink ? null : said[1] + ' ', `the link grows no light, from the words selected or the passage lit (the focus ${onLink ? 'went to the link' : 'never on the link'})`);
    assert.equal(await p.evaluate('window.lastClick.defaultPrevented'), false, 'the page leaves a Shift-click on a link to the browser');
    const added = await until(async () => { const now = [...(await windows.list())].filter(([id]) => !before.has(id)); return now.some(([, url]) => url === ELSEWHERE) ? now : null; }, 'Shift-click on the link opens a new window at its address');
    assert.deepEqual(added.map(([, url]) => url), [ELSEWHERE], 'one new window, at the link\'s address');
    for (const [id] of added) await windows.close(id);
    await p.send('Page.bringToFront');
    assert.equal(await readerOn(p), null, 'and the card did not open');
    assert.deepEqual(p.errors, []);
    await p.close();
  });

  // Lighting a cut-off card reads its whole message ahead in the background lane, one read at a time with a short
  // queue. Show full is the person's own act: while that read ahead is slow (held in the server), Show full still
  // shows the whole message and does not wait behind it.
  await check('reading Show full message shows the whole message while the lit card\'s read ahead is slow in the background lane', async () => {
    const topic = 'reading-show-full-busy-lane', body = Array.from({ length: 70 }, (_, i) => `Paragraph ${i}. Words that need the full height of the message to be read.`).join('\n\n');
    const ids = await seed(topic, [['long', { sender: 'aim-core', join: true, addressees: [facts.actor], body }],
      ['after', { sender: 'aim-ux', join: true, addressees: [facts.actor], body: 'A short message after it.' }]]);
    const p = await open(topic, 'laptop', topic, ids.long, 'window.holdReads = true;');
    await centre(p, card(ids.long)); await away(p);
    await until(() => p.evaluate('window.fetchesOut === 0'), 'the page has its answers');
    const since = (await control({ method: 'admission_events', after: Number.MAX_SAFE_INTEGER })).next;
    const hold = topic + '-hold';
    await control({ method: 'read_hold', hold_id: hold, name: 'source', phase: 'callback', read_class: 'background', count: 1 });
    try {
      await light(p, 'laptop', ids.long);
      await until(async () => (await control({ method: 'admission_events', after: since })).events.some(e => e.event === 'hold-enter' && e.hold_id === hold), 'the lit card\'s read ahead is held in the server');
      await p.point(BAR + ' [data-act="more"]');
      const index = await p.evaluate(`[...document.querySelectorAll('.message-menu-list > button')].findIndex(b=>b.textContent==='Show full message')`);
      assert.ok(index >= 0, 'Show full message is offered on the cut-off card');
      await p.point(`.message-menu-list > button:nth-child(${index + 1})`);
      const shape = () => p.evaluate(`(c=>({full:c.dataset.full??null,last:c.querySelector(':scope > .message-preview').textContent.includes('Paragraph 69.'),status:document.querySelector('#app-status').hidden?null:document.querySelector('#app-status').textContent}))(document.querySelector(${JSON.stringify(card(ids.long))}))`);
      let seen;
      await until(async () => { seen = await shape(); return seen.full === 'shown' || seen.status !== null; }, 'Show full shows the message or says why not');
      assert.deepEqual(seen, { full: 'shown', last: true, status: null }, 'Show full shows the whole message though the read ahead holds the background lane');
    } finally { await control({ method: 'read_release', hold_id: hold }); }
    assert.deepEqual(p.errors, []); await p.close();
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
      await until(async () => (await stack())?.fold === 'folded', device + ': a second press folds the stack back to its newest and unread replies (two states, item 394)');
      const back = (await stack()).replies.map(([, shown]) => shown);
      assert.deepEqual([back[0], back[1], back[3]], [false, false, true], device + ': the newest shows again (with any reply still unread), the older read replies folded');
      assert.equal((await stack()).expanded, 'true', device + ': and the line is never a header alone');
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

  await reading785Checks({ check, until, view, control, shot, facts, observations, engine }, { seed, open, tap });
  await stackChecks({ check, until, view, control, shot, facts, observations, engine },
    { seed, open, becomes, centre, tap, press, lit, bar, away, readerOn, closeReader, light, openReader, entry, card, words, DEVICES });
  await editChecks({ check, until, view, control, facts, shot, engine },
    { seed, open, centre, tap, press, lit, light, openReader, closeReader, readerOn, into, valueOf, card, words, DEVICES });
}

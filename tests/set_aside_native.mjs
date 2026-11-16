import assert from 'node:assert/strict';

// Item 548: a reply in doubt set aside (docs/replies-in-doubt.md). A reply
// prepared and never sent (a submission with a send operation id and no
// outcome, as the fixture's agent_message makes it with unsent) stays in doubt
// for good; it holds no move (item 547), but it keeps its Review button. Each of the
// three shapes a person's reply takes is seeded in a topic of its own: one
// from the topic's composer, one replying to a message, and one replying to a
// message with only an image. Its Review list offers Set aside; set aside, it
// is in doubt no more, here at once and after a reload, its words go back into
// the empty writing as its draft, and Undo puts it back in doubt with the
// writing empty again. Then the press on another topic goes on the first try.
// Run by reader_persistence_native.mjs and webkit_native.mjs with --rail.
const SIZES = { laptop: { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false },
  w320: { width: 320, height: 640, deviceScaleFactor: 2, mobile: true }, w375: { width: 375, height: 812, deviceScaleFactor: 2, mobile: true },
  w390: { width: 390, height: 844, deviceScaleFactor: 2, mobile: true } };
const SHAPES = {
  composer: 'a reply from the topic\'s composer',
  message: 'a reply to a message',
  attachment: 'a reply to a message with only an image',
};

export async function setAsideChecks({ check, page, until, control, view, facts, shot }) {
  const q = value => JSON.stringify(value);
  const open = (name, url, size = 'laptop', theme = 'light') => page(name, null, true, { url: facts.origin + url, beforeNavigate: async p => {
    await p.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: theme }] });
    await p.send('Emulation.setDeviceMetricsOverride', SIZES[size]);
  } });
  let serial = 0;
  // A topic with the shape's reply in doubt, and another topic to leave for.
  // composer-image is an image-only reply from the topic's composer; extra adds to the reply (who it goes to, how).
  const seed = async (shape, extra = {}) => {
    const n = ++serial, here = `aside-${shape}-${n}`, away = `aside-away-${shape}-${n}`;
    await control({ method: 'navigation_topics', topics: [{ id: here, title: `Set aside ${shape} ${n}` }, { id: away, title: `Away ${shape} ${n}` }] });
    let replyTo = null, source = { kind: 'topic', id: here };
    if (extra.addressees) {
      // The agent the reply names writes in the topic first, as one of it.
      await control({ method: 'agent_message', operation_id: `${here}-agent`, topic_id: here, sender: extra.addressees[0], join: true, whole_topic: true, body: `The agent in ${shape} ${n}` });
    }
    if (!shape.startsWith('composer')) {
      const incoming = await control({ method: 'agent_message', operation_id: `${here}-incoming`, topic_id: here, member: true, body: `Incoming for ${shape} ${n}` });
      replyTo = incoming.result.message_id; source = { kind: 'message', id: replyTo };
    }
    const image = shape === 'attachment' || shape === 'composer-image';
    const body = image ? '' : `Words kept for ${shape} ${n}`;
    const prepared = await control({ method: 'agent_message', operation_id: `${here}-reply`, topic_id: here, sender: 'person', unsent: true, body,
      ...(replyTo ? { reply_to: replyTo } : { source: 'topic' }),
      ...(image ? { attachments: [{ name: 'kept.png', image: 'one.png' }] } : {}), ...extra });
    const words = await view('submission', { submission_id: prepared.submission_id });
    assert.equal(words.send_receipt, null, 'the send was never made');
    return { here, away, replyTo, source, body, submission: prepared.submission_id, attachments: words.attachments, words };
  };
  const unsent = async s => (await view('submissions', { source_ref: s.source, topic_id: s.here, limit: 20, unsent: true })).items.map(item => item.id);
  const draft = async s => (await view('editor_state', { source_ref: s.source, topic_id: s.here })).draft;
  const ready = (p, id) => until(() => p.evaluate(`document.body.dataset.ready==='true' && new URL(location.href).searchParams.get('topic')===${q(id)}`), `the page is on ${id}`);
  // Arrived on the topic, or failed saying what the page said instead.
  const arrive = async (p, id) => {
    try { await ready(p, id); } catch (error) {
      throw Error(`${error.message}; the page says ${q(await notice(p))}, shows ${q(await reviews(p))} and is at ${await p.evaluate('location.href')}`);
    }
  };
  const notice = p => p.evaluate('document.querySelector("#topic-navigation-status").hidden?"":document.querySelector("#topic-navigation-status").textContent');
  // The Review buttons the page shows, wherever they are.
  const reviews = p => p.evaluate(`[...document.querySelectorAll('#inline-pending button,#topic-pending button,#pending-submissions button')].filter(b=>b.getClientRects().length).map(b=>b.textContent)`);
  const topicRow = id => `#outline a[data-topic-id="${id}"]`;
  // A press on another topic's row in the outline, scrolled into view as a person scrolls to it: earlier
  // cases add topics, so the row can sit below the window.
  const pressRow = async (p, id) => {
    await until(() => p.evaluate(`Boolean(document.querySelector(${q(topicRow(id))}))`), 'the other topic is in the outline');
    await p.evaluate(`document.querySelector(${q(topicRow(id))}).scrollIntoView({block:'center',inline:'nearest'})`);
    await p.point(topicRow(id));
  };
  // A press on the composer's writing as a person makes it: scrolled to the middle of the window, once nothing is
  // moving, so on a phone in WebKit the field is not under the window's edge or still settling.
  const pressWriting = async p => {
    await p.evaluate(`document.querySelector('#inline-writing-body').scrollIntoView({block:'center'})`);
    await until(() => p.evaluate("document.getAnimations().filter(x=>x.effect?.getTiming().iterations!==Infinity).every(a=>a.playState!=='running')"), 'nothing is moving');
    await p.point('#inline-writing-body');
  };
  // The composer given the keys as the page gives them, where what a case looks at is the Review list, not the press
  // (as "rail set aside looks right" does): on a phone in WebKit the field can move under a press.
  const focusWriting = async p => {
    await p.evaluate(`document.querySelector('#inline-writing-body').focus()`);
    await until(() => p.evaluate(`document.activeElement?.id==='inline-writing-body'`), 'the composer has the keys');
  };
  const card = s => `#review-content [data-id="${s.submission}"]`;
  const cardState = (p, s) => p.evaluate(`(c=>c&&{state:c.dataset.state,title:c.querySelector('h3').textContent,acts:[...c.querySelectorAll('.aside-act')].map(b=>({text:b.textContent,name:b.getAttribute('aria-label'),tip:b.title}))})(document.querySelector(${q(card(s))}))`);
  const openReader = async (p, s) => {
    await until(() => p.evaluate(`Boolean(document.querySelector('#messages [data-id="${s.replyTo}"]'))`), 'the message replied to shows');
    await p.evaluate(`document.querySelector('#messages [data-id="${s.replyTo}"]').scrollIntoView({block:'center'})`);
    await p.point(`#messages [data-id="${s.replyTo}"]`);
    await until(() => p.evaluate(`document.querySelector('#reader').open && document.querySelector('#source-body').textContent.startsWith(${q('Incoming for ')})`), 'the Reader opens on the message');
  };
  const closeReader = async p => { await p.point('#reader-close'); await until(() => p.evaluate('!document.querySelector("#reader").open'), 'the Reader closes'); };
  // The writing the reply came from, as the page shows it.
  const shownWriting = async (p, s) => {
    if (s.source.kind === 'topic') return p.evaluate(`document.querySelector('#inline-writing-body').value`);
    await openReader(p, s);
    const value = await p.evaluate(`document.querySelector('#writing-body').value`);
    await closeReader(p);
    return value;
  };
  const wordsOf = d => ({ body: d?.body ?? '', attachments: (d?.attachments ?? []).map(ref => ref.id) });

  // How the line looks, on a laptop and a phone (320, 375, 390), light and
  // dark: each act a short word with its name and tooltip, 44px to touch on a
  // phone, the list never wider than the window, and nothing else in the list
  // or the composer moves when a reply is set aside.
  await check('rail set aside looks right: Set aside, Undo and Copy are short named words, 44px to touch on a phone, at 1280, 320, 375 and 390, light and dark, and setting aside one reply leaves the other in doubt and the composer as it was', async () => {
    const acts = p => p.evaluate(`[...document.querySelectorAll('#review-content .aside-act')].map(b=>{const r=b.getBoundingClientRect();return {text:b.textContent,name:b.getAttribute('aria-label'),tip:b.title,width:r.width,height:r.height,shown:r.width>0&&r.height>0};})`);
    // The Review list, which is what this item draws: the dialog within the window and nothing in it wider than it.
    const wide = p => p.evaluate('(d=>({scroll:d.scrollWidth,inner:d.clientWidth,list:document.querySelector("#review-content").scrollWidth,listInner:document.querySelector("#review-content").clientWidth,width:innerWidth,dialog:Math.ceil(d.getBoundingClientRect().right)}))(document.querySelector("#version-review"))');
    const fits = w => w.dialog <= w.width && w.scroll <= w.inner && w.list <= w.listInner;
    for (const [size, theme] of [['laptop', 'light'], ['laptop', 'dark'], ['w320', 'light'], ['w320', 'dark'], ['w375', 'light'], ['w375', 'dark'], ['w390', 'light'], ['w390', 'dark']]) {
      const s = await seed('composer');
      // A second reply in doubt in the same writing, which must stay in doubt.
      const other = await control({ method: 'agent_message', operation_id: `${s.here}-other`, topic_id: s.here, sender: 'person', unsent: true, body: `Another reply ${size} ${theme}`, source: 'topic' });
      const p = await open(`aside-look-${size}-${theme}`, `/?topic=${s.here}`, size, theme);
      await ready(p, s.here);
      await until(async () => (await reviews(p)).join() === 'Review 2 replies', 'both replies are in doubt');
      // The person's own writing in the composer, which setting aside leaves as it was.
      // The field takes the keys as the page gives them to it; what this case looks at is the Review list.
      await p.evaluate(`document.querySelector('#inline-writing-body').focus()`);
      await until(() => p.evaluate(`document.activeElement?.id==='inline-writing-body'`), 'the composer has the keys');
      await p.send('Input.insertText', { text: 'Mine, typed here' });
      await until(() => p.evaluate(`document.querySelector('#inline-writing-body').value==='Mine, typed here'`), 'typed');
      await p.point('#inline-pending button');
      await until(async () => (await acts(p)).length === 2, 'each reply offers Set aside');
      const phone = size !== 'laptop';
      for (const act of await acts(p)) {
        assert.deepEqual([act.text, act.name, Boolean(act.tip), act.shown], ['Set aside', 'Set this reply aside', true, true], `${size} ${theme}`);
        if (phone) assert.ok(act.height >= 44 && act.width >= 44, `${size}: Set aside is 44px to touch: ${JSON.stringify(act)}`);
      }
      let w = await wide(p); assert.ok(fits(w), `${size}: the Review list fits the window ${JSON.stringify(w)}`);
      if (shot) await shot(p, `set-aside-${size}-${theme}-offered`);
      await p.point(`${card(s)} .aside-act`);
      await until(async () => (await cardState(p, s))?.state === 'aside', 'set aside');
      // The composer held writing, so the words stay readable on the line, with Copy and Undo.
      assert.deepEqual((await cardState(p, s)).acts.map(act => [act.text, act.name, Boolean(act.tip)]),
        [['Copy', 'Copy this reply\'s words', true], ['Undo', 'Undo set aside: this reply may not have sent', true]], `${size} ${theme}`);
      assert.equal(await p.evaluate(`document.querySelector(${q(card(s) + ' pre')})?.textContent`), s.body, 'its words stay readable on the line');
      for (const act of (await acts(p)).filter(act => act.text !== 'Set aside')) if (phone) assert.ok(act.height >= 44 && act.width >= 44, `${size}: ${act.text} is 44px to touch`);
      assert.deepEqual(await cardState(p, { submission: other.submission_id }).then(c => [c.state, c.acts.map(a => a.text)]), ['doubt', ['Set aside']], 'the other reply is still in doubt');
      assert.deepEqual(await unsent(s), [other.submission_id], 'Core still lists the other reply');
      w = await wide(p); assert.ok(fits(w), `${size}: the Review list fits the window ${JSON.stringify(w)}`);
      if (shot) await shot(p, `set-aside-${size}-${theme}-aside`);
      await p.point('#review-close');
      await until(() => p.evaluate('!document.querySelector("#version-review").open'), 'the Review list closes');
      assert.equal(await p.evaluate(`document.querySelector('#inline-writing-body').value`), 'Mine, typed here', 'the composer is as it was');
      await until(async () => (await reviews(p)).join() === 'Review 1 reply', 'the other reply keeps its Review button');
    }
  });

  for (const [shape, words] of Object.entries(SHAPES)) {
    await check(`rail set aside ${shape}: ${words} prepared and never sent stays in doubt; Set aside takes it out of doubt and its words go back into the empty writing, Undo puts it back, and set aside again the press on another topic goes on the first try, as after a reload`, async () => {
      const s = await seed(shape);
      assert.deepEqual(await unsent(s), [s.submission], 'Core lists the reply as not sent');
      const p = await open(`aside-${shape}`, `/?topic=${s.here}`);
      await ready(p, s.here);
      // A message's writing is the page's once its Reader has opened it.
      if (s.replyTo) { await openReader(p, s); await closeReader(p); }
      const button = s.replyTo ? '#topic-pending button' : '#inline-pending button';
      await until(async () => (await reviews(p)).join() === 'Review 1 reply', 'the reply in doubt has its one Review button');
      // Set aside, from the Review list.
      await p.point(button);
      await until(async () => Boolean(await cardState(p, s)), 'the Review list shows the reply');
      const offered = await cardState(p, s);
      assert.deepEqual(offered.acts, [{ text: 'Set aside', name: 'Set this reply aside', tip: offered.acts[0]?.tip }], 'one light Set aside, named');
      assert.ok(offered.acts[0].tip, 'Set aside has a tooltip');
      await p.point(`${card(s)} .aside-act`);
      await until(async () => (await cardState(p, s))?.state === 'aside', 'the reply is set aside');
      const aside = await cardState(p, s);
      assert.equal(aside.title, 'Set aside');
      assert.deepEqual(aside.acts.map(act => act.text), ['Undo'], 'its words went back into the writing, so the line offers only Undo');
      assert.match(await p.evaluate(`document.querySelector(${q(card(s))}).textContent`), /back in your writing/);
      assert.deepEqual(await reviews(p), [], 'no Review button: nothing is in doubt');
      assert.deepEqual(await unsent(s), [], 'Core leaves it out of the replies not sent');
      await until(async () => JSON.stringify(wordsOf(await draft(s))) === JSON.stringify({ body: s.body, attachments: s.attachments.map(ref => ref.id) }),
        'its words, and its image, are the writing\'s draft');
      if (shot) await shot(p, `set-aside-${shape}-laptop-light`);
      // Undo puts it back in doubt, and the writing is empty again.
      await p.point(`${card(s)} .aside-act`);
      await until(async () => (await cardState(p, s))?.state === 'doubt', 'Undo puts the reply back');
      await until(async () => (await reviews(p)).join() === 'Review 1 reply', 'in doubt again, its Review button is back');
      assert.deepEqual(await unsent(s), [s.submission], 'Core lists it again');
      await until(async () => JSON.stringify(wordsOf(await draft(s))) === JSON.stringify({ body: '', attachments: [] }), 'the writing is empty again');
      // Set aside again, and leave.
      await p.point(`${card(s)} .aside-act`);
      await until(async () => (await cardState(p, s))?.state === 'aside', 'set aside again');
      await p.point('#review-close');
      await until(() => p.evaluate('!document.querySelector("#version-review").open'), 'the Review list closes');
      assert.equal(await shownWriting(p, s), s.body, 'the writing shows its words');
      await until(async () => JSON.stringify(wordsOf(await draft(s))) === JSON.stringify({ body: s.body, attachments: s.attachments.map(ref => ref.id) }), 'saved as the draft');
      await pressRow(p, s.away);
      await arrive(p, s.away);
      // The page loaded again on the topic, as a reload loads it: nothing is in doubt, the words are still the
      // writing, and once the person has opened that writing (a message's, in the Reader) and closed it, a press on
      // another topic goes on the first try, at once, while the page may still be checking the image a reply set
      // aside put back: Theseus holds it, so leaving loses nothing (item 548, review B4). The load is waited for by a
      // timeOrigin kept on the window; while the old document gives way to the new one a read of it can fail.
      const loaded = await p.evaluate('(window.documentOrigin??=performance.timeOrigin)');
      await p.send('Page.navigate', { url: facts.origin + `/?topic=${s.here}` });
      await until(async () => { try { return await p.evaluate(`document.body?.dataset.ready==='true' && (window.documentOrigin??=performance.timeOrigin) !== ${loaded} && new URL(location.href).searchParams.get('topic')===${q(s.here)}`); } catch { return false; } }, 'the page loads again on the topic');
      if (s.replyTo) { await openReader(p, s); await closeReader(p); }
      assert.deepEqual(await reviews(p), [], 'after a reload no Review button');
      assert.equal(await shownWriting(p, s), s.body, 'after a reload the words are the writing');
      await pressRow(p, s.away);
      await arrive(p, s.away);
      // In another tab, the writing is ready to send: the draft this device kept is the draft Theseus holds, so the
      // copy kept here was retired and nothing asks to be checked in Review versions first. Then the press goes.
      const again = await open(`aside-${shape}-again`, `/?topic=${s.here}`);
      await ready(again, s.here);
      assert.deepEqual(await reviews(again), [], 'in another tab no Review button');
      if (s.replyTo) {
        await openReader(again, s);
        await until(() => again.evaluate(`document.querySelector('#send-reply').ariaDisabled !== 'true' && !('blocked' in document.querySelector('#save-state').dataset) && document.querySelector('#writing-body').value===${q(s.body)}`),
          'the Reader\'s writing is ready to send').catch(async error => { throw Error(`${error.message}; it says ${q(await again.evaluate(`document.querySelector('#save-state').textContent`))}`); });
        await closeReader(again);
      } else assert.equal(await shownWriting(again, s), s.body, 'in another tab the words are the writing');
      await pressRow(again, s.away);
      await arrive(again, s.away);
    });
  }

  // A reply set aside while its writing holds words keeps them on its line in the Review list (docs/replies-in-doubt.md),
  // and the line stays in reach once the list closes, after a reload too: a light Set aside chip opens it.
  // The page's own clipboard: what Copy hands it is kept on the page, and the Mac's pasteboard is never touched.
  const clipboard = p => p.evaluate(`(()=>{window.copied=[];Object.defineProperty(navigator.clipboard,'writeText',{configurable:true,
    value:async text=>{window.copied.push(text)}});return true})()`);
  const copied = p => p.evaluate('window.copied');
  const chip = p => p.evaluate(`(b=>b&&{text:b.textContent,name:b.getAttribute('aria-label'),tip:b.title})(document.querySelector('#inline-pending button'))`);
  const keptLine = (p, s) => p.evaluate(`(c=>c&&{state:c.dataset.state,words:c.querySelector('pre')?.textContent??null,acts:[...c.querySelectorAll('.aside-act')].map(b=>b.textContent)})(document.querySelector(${q(card(s))}))`);
  const undo = s => `${card(s)} .aside-act[aria-label^="Undo"]`;
  const typeInComposer = async (p, s, text, reach = pressWriting) => {
    await reach(p); await p.send('Input.insertText', { text });
    await until(() => p.evaluate(`document.querySelector('#inline-writing-body').value===${q(text)}`), 'typed');
    await until(async () => (await draft(s))?.body === text, 'the typed words are saved as the draft');
  };
  const closeList = async p => { await p.point('#review-close'); await until(() => p.evaluate('!document.querySelector("#version-review").open'), 'the Review list closes'); };
  // Waits for what read() answers to be expected, and fails showing what it was instead.
  const settles = async (read, expected, label) => {
    try { await until(async () => JSON.stringify(await read()) === JSON.stringify(expected), label); }
    catch (error) { assert.deepEqual(await read(), expected, label); throw error; }
  };

  await check('rail set aside kept words: set aside while the composer holds writing, its words stay readable with Copy after the Review list closes and after a reload, Copy hands over exactly them, and Undo from there puts it back in doubt with the writing as typed', async () => {
    const s = await seed('composer');
    const p = await open('aside-kept', `/?topic=${s.here}`);
    await ready(p, s.here);
    await until(async () => (await reviews(p)).join() === 'Review 1 reply', 'the reply is in doubt');
    await typeInComposer(p, s, 'Mine, typed here');
    await clipboard(p);
    await p.point('#inline-pending button');
    await until(async () => (await cardState(p, s))?.state === 'doubt', 'the Review list shows the reply');
    await p.point(`${card(s)} .aside-act`);
    await until(async () => (await keptLine(p, s))?.state === 'aside', 'set aside');
    assert.deepEqual(await keptLine(p, s), { state: 'aside', words: s.body, acts: ['Copy', 'Undo'] }, 'its words on its line, with Copy and Undo');
    await p.point(`${card(s)} .aside-act`);
    await until(async () => (await copied(p)).length === 1, 'Copy hands the words over');
    assert.deepEqual(await copied(p), [s.body], 'Copy hands over exactly the reply\'s words');
    await closeList(p);
    assert.equal(await p.evaluate(`document.querySelector('#inline-writing-body').value`), 'Mine, typed here', 'the composer is as typed');
    await settles(() => reviews(p), ['Set aside 1'], 'with the list closed, the reply set aside has a Set aside chip, and nothing is in doubt');
    const named = await chip(p);
    assert.ok(named.name && named.tip, `the chip has its name and a tooltip: ${JSON.stringify(named)}`);
    await p.point('#inline-pending button');
    await until(async () => (await keptLine(p, s))?.words === s.body, 'the chip opens the list on its words');
    assert.deepEqual((await keptLine(p, s)).acts, ['Copy', 'Undo']);
    await closeList(p);
    // Nothing is in doubt, so the press on another topic goes on the first try.
    await pressRow(p, s.away);
    await arrive(p, s.away);
    // After a reload the words are still readable there, with Copy.
    const again = await open('aside-kept-again', `/?topic=${s.here}`);
    await ready(again, s.here);
    await settles(() => reviews(again), ['Set aside 1'], 'after a reload the chip is there');
    await clipboard(again);
    await again.point('#inline-pending button');
    await until(async () => (await keptLine(again, s))?.words === s.body, 'after a reload its words are readable on its line');
    await again.point(`${card(s)} .aside-act`);
    await until(async () => (await copied(again)).length === 1, 'Copy after a reload');
    assert.deepEqual(await copied(again), [s.body]);
    // Undo from there: in doubt again, and the writing stays as typed.
    await again.point(undo(s));
    await until(async () => (await keptLine(again, s))?.state === 'doubt', 'Undo puts the reply back in doubt');
    await settles(() => reviews(again), ['Review 1 reply'], 'in doubt again, its Review button is back');
    assert.deepEqual(await unsent(s), [s.submission], 'Core lists it again');
    assert.equal(await again.evaluate(`document.querySelector('#inline-writing-body').value`), 'Mine, typed here', 'Undo leaves the writing as typed');
    assert.equal((await draft(s)).body, 'Mine, typed here');
  });

  await check('rail set aside kept image: an image-only reply set aside while the composer holds writing keeps its image on its line, opened there, after a reload too, and the writing gains no image', async () => {
    const s = await seed('composer-image');
    assert.equal(s.attachments.length, 1);
    const p = await open('aside-kept-image', `/?topic=${s.here}`);
    await ready(p, s.here);
    await until(async () => (await reviews(p)).join() === 'Review 1 reply', 'the reply is in doubt');
    await typeInComposer(p, s, 'Mine, with no image');
    await p.point('#inline-pending button');
    await until(async () => (await cardState(p, s))?.state === 'doubt', 'the Review list shows the reply');
    await p.point(`${card(s)} .aside-act`);
    await until(async () => (await keptLine(p, s))?.state === 'aside', 'set aside');
    assert.deepEqual((await keptLine(p, s)).acts, ['Undo'], 'no words to copy, so only Undo');
    const opened = async page => {
      await until(() => page.evaluate(`Boolean(document.querySelector(${q(card(s) + ' .attachment-label button')}))`), 'its image is offered on its line');
      await page.point(`${card(s)} .attachment-label button`);
      await until(() => page.evaluate(`(i=>Boolean(i&&i.complete&&i.naturalWidth>0))(document.querySelector(${q(card(s) + ' img')}))`), 'its image shows on its line');
    };
    await opened(p);
    await closeList(p);
    await settles(() => reviews(p), ['Set aside 1'], 'with the list closed, the reply set aside has a Set aside chip');
    assert.deepEqual(wordsOf(await draft(s)), { body: 'Mine, with no image', attachments: [] }, 'the writing gains no image');
    const again = await open('aside-kept-image-again', `/?topic=${s.here}`);
    await ready(again, s.here);
    await settles(() => reviews(again), ['Set aside 1'], 'after a reload the chip is there');
    await again.point('#inline-pending button');
    await opened(again);
  });

  await check('rail set aside whisper: a whisper set aside into the empty composer comes back as the same whisper to the same agent, an ask as the same ask, a whisper replying to another agent\'s message gains no name offered there, and Undo empties every field it filled', async () => {
    const agent = 'fixture-notebook-agent', other = 'fixture-planning-agent';
    const fields = d => ({ body: d?.body ?? '', addressees: d?.addressees ?? [], whisper: d?.whisper === true, intent: d?.intent ?? null });
    // The last: a whisper to one agent replying to another's message, whose Reader offers that other agent.
    for (const [kind, shape, extra] of [['whisper', 'composer', { addressees: [agent], whisper: true }], ['ask', 'composer', { addressees: [agent], intent: 'ask' }],
      ['whisper', 'message', { addressees: [other], whisper: true }]]) {
      const s = await seed(shape, extra);
      const expected = fields(s.words);
      assert.deepEqual(expected, { body: s.body, addressees: extra.addressees, whisper: kind === 'whisper', intent: kind === 'ask' ? 'ask' : null }, `the ${kind} as prepared`);
      const p = await open(`aside-${kind}-${shape}`, `/?topic=${s.here}`);
      await ready(p, s.here);
      if (s.replyTo) { await openReader(p, s); await closeReader(p); }
      await until(async () => (await reviews(p)).join() === 'Review 1 reply', 'the reply is in doubt');
      await p.point(s.replyTo ? '#topic-pending button' : '#inline-pending button');
      await until(async () => (await cardState(p, s))?.state === 'doubt', 'the Review list shows the reply');
      await p.point(`${card(s)} .aside-act`);
      await until(async () => (await cardState(p, s))?.state === 'aside', 'set aside');
      await settles(async () => fields(await draft(s)), expected, `the draft is the same ${kind}, to the same agent`);
      if (!s.replyTo) {
        const pressed = await p.evaluate(`Object.fromEntries([...document.querySelectorAll('#inline-intent-row button[data-intent]')].map(c=>[c.dataset.intent,c.getAttribute('aria-pressed')==='true']))`);
        assert.equal(pressed[kind], true, `the composer shows it as a ${kind}: ${JSON.stringify(pressed)}`);
      }
      await p.point(undo(s));
      await until(async () => (await cardState(p, s))?.state === 'doubt', 'Undo puts the reply back in doubt');
      await settles(async () => fields(await draft(s)), { body: '', addressees: [], whisper: false, intent: null }, 'Undo empties every field it filled');
    }
  });

  // Every state of a reply set aside, on a laptop and a phone (320, 375, 390), light and dark: its words kept on its
  // line with Copy, its image opened there, the Set aside chip once the list closes, and its words back in the writing.
  // Each act and Open is 44px to touch on a phone, and nothing is wider than the window.
  await check('rail set aside kept looks right: the kept line with its words and its image opened, the Set aside chip, and the line whose words went back, at 1280, 320, 375 and 390, light and dark', async () => {
    const touch = (p, selector) => p.evaluate(`[...document.querySelectorAll(${q(selector)})].filter(b=>b.getClientRects().length).map(b=>{const r=b.getBoundingClientRect();return {text:b.textContent,width:r.width,height:r.height,name:b.getAttribute('aria-label'),tip:b.title};})`);
    // The Review list, what this item draws: the dialog within the window and nothing in it wider than it, its image
    // too; with the list closed, the chip within the window. A width failure names what reaches past the window.
    const wide = p => p.evaluate('(d=>({scroll:d.scrollWidth,inner:d.clientWidth,list:document.querySelector("#review-content").scrollWidth,listInner:document.querySelector("#review-content").clientWidth,width:innerWidth,dialog:Math.ceil(d.getBoundingClientRect().right),open:d.open,images:Math.max(0,...[...document.querySelectorAll("#review-content img")].map(i=>Math.ceil(i.getBoundingClientRect().right))),chip:Math.ceil(document.querySelector("#inline-pending button")?.getBoundingClientRect().right??0),past:[...document.querySelectorAll("body *")].filter(e=>e.getClientRects().length&&e.getBoundingClientRect().right>innerWidth+0.5).slice(-6).map(e=>e.tagName.toLowerCase()+(e.id?"#"+e.id:"")+(typeof e.className==="string"&&e.className?"."+e.className.trim().split(/\s+/).join("."):"")+":"+Math.ceil(e.getBoundingClientRect().right))}))(document.querySelector("#version-review"))');
    const fits = async (p, size) => { const w = await wide(p); assert.ok(w.open ? w.dialog <= w.width && w.scroll <= w.inner && w.list <= w.listInner && w.images <= w.width : w.chip <= w.width, `${size}: nothing wider than the window ${JSON.stringify(w)}`); };
    const big = (acts, size, phone) => { for (const act of acts) if (phone) assert.ok(act.height >= 44 && act.width >= 44, `${size}: ${act.text} is 44px to touch: ${JSON.stringify(act)}`); };
    for (const [size, theme] of [['laptop', 'light'], ['laptop', 'dark'], ['w320', 'light'], ['w320', 'dark'], ['w375', 'light'], ['w375', 'dark'], ['w390', 'light'], ['w390', 'dark']]) {
      const phone = size !== 'laptop';
      const s = await seed('composer-image');
      const other = await control({ method: 'agent_message', operation_id: `${s.here}-words`, topic_id: s.here, sender: 'person', unsent: true, body: `Words kept ${size} ${theme}`, source: 'topic' });
      const t = { ...s, submission: other.submission_id, body: `Words kept ${size} ${theme}` };
      const p = await open(`aside-kept-look-${size}-${theme}`, `/?topic=${s.here}`, size, theme);
      await ready(p, s.here);
      await until(async () => (await reviews(p)).join() === 'Review 2 replies', 'both replies are in doubt');
      await typeInComposer(p, s, 'Mine', focusWriting);
      await p.point('#inline-pending button');
      for (const r of [s, t]) {
        await until(async () => (await cardState(p, r))?.state === 'doubt', 'listed');
        await p.evaluate(`document.querySelector(${q(card(r) + ' .aside-act')}).scrollIntoView({block:'nearest'})`);
        await p.point(`${card(r)} .aside-act`);
        await until(async () => (await cardState(p, r))?.state === 'aside', 'set aside');
      }
      await p.evaluate(`document.querySelector(${q(card(s) + ' .attachment-label button')}).scrollIntoView({block:'nearest'})`);
      big(await touch(p, `${card(s)} .attachment-label button`), size, phone);
      await p.point(`${card(s)} .attachment-label button`);
      await until(() => p.evaluate(`(i=>Boolean(i&&i.complete&&i.naturalWidth>0))(document.querySelector(${q(card(s) + ' img')}))`), 'its image shows on its line');
      assert.deepEqual((await keptLine(p, t)), { state: 'aside', words: t.body, acts: ['Copy', 'Undo'] });
      big(await touch(p, '#review-content .aside-act'), size, phone);
      await fits(p, size);
      if (shot) await shot(p, `set-aside-kept-${size}-${theme}-line`);
      await closeList(p);
      await settles(() => reviews(p), ['Set aside 2'], 'the Set aside chip counts both');
      const [chipped] = await touch(p, '#inline-pending button');
      assert.ok(chipped.name && chipped.tip, `the chip has its name and a tooltip: ${JSON.stringify(chipped)}`);
      big([chipped], size, phone);
      await fits(p, size);
      if (shot) await shot(p, `set-aside-kept-${size}-${theme}-chip`);
      // Its words back in the writing: the composer emptied, the reply put back and set aside again.
      await p.point('#inline-pending button');
      await until(async () => (await keptLine(p, t))?.state === 'aside', 'the chip opens the list');
      await p.point(undo(t));
      await until(async () => (await cardState(p, t))?.state === 'doubt', 'Undo puts it back');
      await closeList(p);
      await focusWriting(p);
      await p.evaluate(`document.querySelector('#inline-writing-body').select()`);
      await p.key('Backspace');
      await until(async () => (await draft(s))?.body === '', 'the composer is empty and saved so');
      await p.point('#inline-pending button');
      await until(async () => (await cardState(p, t))?.state === 'doubt', 'listed again');
      await p.point(`${card(t)} .aside-act`);
      await until(async () => (await cardState(p, t))?.state === 'aside' && /back in your writing/.test(await p.evaluate(`document.querySelector(${q(card(t))}).textContent`)), 'its words went back');
      big(await touch(p, `${card(t)} .aside-act`), size, phone);
      await fits(p, size);
      if (shot) await shot(p, `set-aside-kept-${size}-${theme}-back`);
      await closeList(p);
      assert.equal(await p.evaluate(`document.querySelector('#inline-writing-body').value`), t.body, 'its words are the writing');
      await settles(() => reviews(p), ['Set aside 1'], 'the image kept on its line keeps the chip');
    }
  });
}

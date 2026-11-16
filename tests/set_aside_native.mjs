import assert from 'node:assert/strict';

// Item 548: a reply in doubt set aside (docs/replies-in-doubt.md). A reply
// prepared and never sent (a submission with a send operation id and no
// outcome, as the fixture's agent_message makes it with unsent) stays in doubt
// for good, so the departure guard holds a press on another topic. Each of the
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
  const seed = async shape => {
    const n = ++serial, here = `aside-${shape}-${n}`, away = `aside-away-${shape}-${n}`;
    await control({ method: 'navigation_topics', topics: [{ id: here, title: `Set aside ${shape} ${n}` }, { id: away, title: `Away ${shape} ${n}` }] });
    let replyTo = null, source = { kind: 'topic', id: here };
    if (shape !== 'composer') {
      const incoming = await control({ method: 'agent_message', operation_id: `${here}-incoming`, topic_id: here, member: true, body: `Incoming for ${shape} ${n}` });
      replyTo = incoming.result.message_id; source = { kind: 'message', id: replyTo };
    }
    const body = shape === 'attachment' ? '' : `Words kept for ${shape} ${n}`;
    const prepared = await control({ method: 'agent_message', operation_id: `${here}-reply`, topic_id: here, sender: 'person', unsent: true, body,
      ...(replyTo ? { reply_to: replyTo } : { source: 'topic' }),
      ...(shape === 'attachment' ? { attachments: [{ name: 'kept.png', image: 'one.png' }] } : {}) });
    const words = await view('submission', { submission_id: prepared.submission_id });
    assert.equal(words.send_receipt, null, 'the send was never made');
    return { here, away, replyTo, source, body, submission: prepared.submission_id, attachments: words.attachments };
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
    const wide = p => p.evaluate('({scroll:document.documentElement.scrollWidth,width:innerWidth,dialog:Math.ceil(document.querySelector("#version-review").getBoundingClientRect().right)})');
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
      let w = await wide(p); assert.ok(w.scroll <= w.width && w.dialog <= w.width, `${size}: nothing wider than the window ${JSON.stringify(w)}`);
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
      w = await wide(p); assert.ok(w.scroll <= w.width && w.dialog <= w.width, `${size}: nothing wider than the window ${JSON.stringify(w)}`);
      if (shot) await shot(p, `set-aside-${size}-${theme}-aside`);
      await p.point('#review-close');
      await until(() => p.evaluate('!document.querySelector("#version-review").open'), 'the Review list closes');
      assert.equal(await p.evaluate(`document.querySelector('#inline-writing-body').value`), 'Mine, typed here', 'the composer is as it was');
      await until(async () => (await reviews(p)).join() === 'Review 1 reply', 'the other reply keeps its Review button');
    }
  });

  for (const [shape, words] of Object.entries(SHAPES)) {
    await check(`rail set aside ${shape}: ${words} prepared and never sent holds the departure guard; Set aside takes it out of doubt and its words go back into the empty writing, Undo puts it back, and set aside again the press on another topic goes on the first try, as after a reload`, async () => {
      const s = await seed(shape);
      assert.deepEqual(await unsent(s), [s.submission], 'Core lists the reply as not sent');
      const p = await open(`aside-${shape}`, `/?topic=${s.here}`);
      await ready(p, s.here);
      // A message's writing is the page's once its Reader has opened it.
      if (s.replyTo) { await openReader(p, s); await closeReader(p); }
      const button = s.replyTo ? '#topic-pending button' : '#inline-pending button';
      await until(async () => (await reviews(p)).join() === 'Review 1 reply', 'the reply in doubt has its one Review button');
      // The guard holds a press on another topic and names the button.
      await pressRow(p, s.away);
      await until(async () => /Review 1 reply/.test(await notice(p)), 'the guard holds the press and names the Review button');
      assert.equal(await p.evaluate('new URL(location.href).searchParams.get("topic")'), s.here, 'the press was held');
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
      // After a reload nothing is in doubt and the words are still the draft.
      const again = await open(`aside-${shape}-again`, `/?topic=${s.here}`);
      await ready(again, s.here);
      if (s.replyTo) { await openReader(again, s); await closeReader(again); }
      assert.deepEqual(await reviews(again), [], 'after a reload no Review button');
      assert.equal(await shownWriting(again, s), s.body, 'after a reload the words are the writing');
      await pressRow(again, s.away);
      if (shape !== 'attachment') { await arrive(again, s.away); return; }
      // An image a page kept on this device asks to be checked after a reload
      // (the image-copy rule, docs/images.md), whatever reply it belongs to;
      // what this item answers is that the guard no longer names a reply in doubt.
      await until(async () => await again.evaluate('new URL(location.href).searchParams.get("topic")') === s.away || /image/.test(await notice(again)),
        'the press goes, or is held only for the image kept on this device');
      assert.doesNotMatch(await notice(again), /Review|confirmed sent/, 'the guard names no reply in doubt');
    });
  }
}

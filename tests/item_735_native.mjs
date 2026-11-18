import assert from 'node:assert/strict';

// Only isolated fixture controls prepare data or select real immutable builds.
// Every product act below is browser input; evaluate only observes or scrolls.
export async function item735Checks(ctx, h) {
  const { check, until, control, view, shot, facts, observations } = ctx;
  const { seed, open, centre, press, tap, card, entry } = h;
  const devices = ['laptop', 'phone', 'phone-375', 'phone-320'];
  // Two CSS px allow subpixel/scroll rounding, but never a hidden/offscreen card.
  const tolerance = { viewportRoundingPx: 2, paintedPx: 1 };
  const input = device => device === 'laptop' ? 'laptop' : 'phone';
  const section = root => `#messages .reply-stack[data-stack="${root}"]`;
  const star = root => section(root) + ' > [data-id] > .stack-head > .stack-star';
  const setStar = async (topic, id, on, tag, actor = facts.actor) => { const receipt = await control({ method: 'stack_act', sender: actor,
    kind: 'message.star', message_id: id, operation_id: `${topic}-${tag}`, args: { starred: on } }); assert.equal(receipt.status, 'committed', 'fixture star actually committed'); return receipt; };
  const position = async (topic, root) => (await view('stack_positions', { topic_id: topic, message_ids: [root] })).items[0].stack_position;
  const acts = async (topic, id) => (await view('message_acts', { topic_id: topic })).items.find(item => item.message_id === id)?.acts;
  const themeOf = (p, theme) => p.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: theme }] });
  const settled = async p => {
    await until(() => p.evaluate('window.fetchesOut===0'), 'item 735 foreground reads answered');
    await p.evaluate('new Promise(done=>requestAnimationFrame(()=>requestAnimationFrame(done)))');
  };
  const look = (p, topic, root, target) => p.evaluate(`(()=>{
    const c=document.querySelector(${JSON.stringify(card(target))}),s=c?.closest('.reply-stack'),
      w=c?.querySelector(':scope > .message-preview'),r=w?.getClientRects().length?w.getBoundingClientRect():null,
      b=c?.getBoundingClientRect(),mark=c?.querySelector(':scope > .message-author > .card-star'),
      all=[...document.querySelectorAll('#messages .message-card[data-id]')].map(e=>e.dataset.id);
    return {topic:new URL(location.href).searchParams.get('topic'),dossier:s?.dataset.stack??null,
      whole:!!r&&r.height>${tolerance.paintedPx}&&c.dataset.earlier!=='true'&&c.dataset.folded!=='true',
      focused:!!c&&document.activeElement===c,star:!!mark&&mark.textContent==='★'&&mark.getClientRects().length>0&&getComputedStyle(mark).visibility==='visible',
      onScreen:!!b&&b.height>${tolerance.paintedPx}&&b.top>=-${tolerance.viewportRoundingPx}&&b.bottom<=innerHeight+${tolerance.viewportRoundingPx},
      uncovered:!!r&&r.height>${tolerance.paintedPx}&&c.contains(document.elementFromPoint(r.left+Math.min(24,r.width/2),r.top+Math.min(8,r.height/2))),
      reader:document.querySelector('#reader').open,unique:new Set(all).size===all.length};})()`);
  const want = (topic, root) => ({ topic, dossier: root, whole: true, focused: true, star: true, onScreen: true, uncovered: true, reader: false, unique: true });
  const runtime = async (phase, action) => {
    const receipt = await control({ method: 'item_735_runtime', phase });
    observations.push({ name: 'item 735 source receipt', ...receipt });
    assert.deepEqual(receipt.core_identity, { instance_id: facts.instance_id, actor: facts.actor });
    if (receipt.mutation) assert.notEqual(receipt.mutation.before_sha256, receipt.mutation.after_sha256);
    try { await action(receipt); }
    finally {
      const restored = await control({ method: 'item_735_runtime', phase: 'restored' });
      assert.equal(restored.restored, true);
      assert.deepEqual(restored.hashes, receipt.candidate_hashes, 'every public source byte restored');
      assert.deepEqual(restored.core_identity, receipt.core_identity, 'source changes never replace Core');
      observations.push({ name: 'item 735 restored receipt', ...restored });
    }
  };
  const ready = async (p, device, root) => {
    const toggle = section(root) + ' > .stack-toggle';
    await centre(p, toggle); await press(p, input(device), toggle);
    await until(() => p.evaluate(`document.querySelector(${JSON.stringify(toggle)}).dataset.state==='open'`), 'item 735 dossier fully expanded');
    await settled(p);
  };
  const activate = async (p, device, root, keyboard = null) => {
    await centre(p, star(root));
    if (keyboard) {
      // Native Tab only, including the browser's wrap; never focus() as input.
      for (let n = 0; n < 180 && !await p.evaluate(`document.activeElement===document.querySelector(${JSON.stringify(star(root))})`); n++) await p.key('Tab');
      assert.equal(await p.evaluate(`document.activeElement===document.querySelector(${JSON.stringify(star(root))})`), true, 'native Tab reaches the title star');
      await p.key(keyboard);
    } else await press(p, input(device), star(root));
    await settled(p);
  };
  const assertLanding = async (p, topic, root, target) => {
    await until(() => p.evaluate(`document.activeElement===document.querySelector(${JSON.stringify(card(target))})`), 'item 735 exact message takes focus');
    assert.deepEqual(await look(p, topic, root, target), want(topic, root), 'title star reveals the exact hidden starred reply in place');
  };

  for (const device of devices) for (const theme of ['light', 'dark']) {
    await check(`reading item 735 hidden starred reply red first and restored ${device} ${theme}`, async () => {
      const topic = `hidden-735-${device}-${theme}`;
      const ids = await seed(topic, [
        ['root', { sender: 'aim-core', join: true, addressees: [facts.actor], body: 'The spring garden plan.', read: true }],
        ...Array.from({ length: 18 }, (_, n) => ['r' + n, { sender: 'aim-core', reply_to: 'root', addressees: [facts.actor], body: `Garden reply ${n}: keep this exact message.`, read: true }]),
        ['neighbour', { sender: 'aim-ux', join: true, addressees: [facts.actor], body: 'Another dossier keeps its place.', read: true }],
        ['neighbourReply', { sender: 'aim-ux', reply_to: 'neighbour', addressees: [facts.actor], body: 'The neighbour remains separate.', read: true }],
        ['private', { sender: 'fixture-other-person', join: true, reply_to: 'root', addressees: ['aim-core'], whisper: true, body: 'PRIVATE 735 cannot select or leak.', read: true }],
      ]);
      await setStar(topic, ids.private, true, 'private-star', 'fixture-other-person');
      await setStar(topic, ids.r0, true, 'their-star', 'aim-core');
      await setStar(topic, ids.r1, true, 'own-star');
      assert.deepEqual((await position(topic, ids.root)).starred, [ids.r1], 'Core destination is the one own available star');
      assert.equal((await acts(topic, ids.r1)).folded, false, 'personal folded=false does not establish view visibility');
      const corePage = await view('topic_messages', { topic_id: topic, direction: 'before', limit: 100 });
      assert.equal(corePage.items.some(item => item.id === ids.private), false, 'Core enforces actual private access');
      observations.push({ name: 'item 735 fixture identity', topic, ids, instance_id: facts.instance_id, actor: facts.actor, tolerance });
      const phases = ['base', ...(device === 'laptop' && theme === 'light' ? ['no-reveal', 'wrong-destination', 'no-scroll'] : []), 'restored'];
      for (const phase of phases) await runtime(phase, async receipt => {
        let p;
        try {
          p = await open(`${topic}-${phase}`, device, topic, ids.root, 'window.holdReads=true');
          assert.equal(await p.evaluate(`document.querySelector('script[type=module][src]').src.includes('/b/${receipt.stamp}/')`), true, 'page uses the actual selected source stamp');
          await themeOf(p, theme); await ready(p, device, ids.root);
          assert.equal((await look(p, topic, ids.root, ids.r1)).whole, false, 'the own-starred reply starts behind Earlier messages even fully expanded');
          assert.equal(await p.evaluate(`document.querySelector(${JSON.stringify(star(ids.root))}).textContent`), '★ Starred');
          const order = await p.evaluate(`[...document.querySelectorAll('#messages > .reply-stack')].map(e=>e.dataset.stack)`);
          const beforePosition = await position(topic, ids.root);
          const writing = `Exact writing 735 ${device} ${theme}.`;
          if (phase === 'restored') {
            await centre(p, '#new-message'); await press(p, input(device), '#new-message');
            await until(() => p.evaluate("document.activeElement?.id==='inline-writing-body'"), 'native composer ready');
            await p.send('Input.insertText', { text: writing }); await p.key('Escape');
            await until(() => p.evaluate("!document.querySelector('#new-message-sheet').open"), 'composer returned with writing kept');
          }
          await centre(p, star(ids.root)); await shot(p, `${topic}-${phase}-before`);
          await activate(p, device, ids.root, phase === 'restored' && device === 'laptop' && theme === 'dark' ? 'Enter' : null);
          if (phase === 'restored') {
            await assertLanding(p, topic, ids.root, ids.r1);
            assert.equal(await p.evaluate("document.querySelector('#inline-writing-body').value"), writing, 'title navigation preserves exact composer writing');
          } else {
            const actual = await look(p, topic, ids.root, ids.r1); let raw;
            assert.throws(() => assert.deepEqual(actual, want(topic, ids.root), 'title star reveals the exact hidden starred reply in place'), error => {
              assert.equal(error.code, 'ERR_ASSERTION'); raw = { stack: error.stack, actual: error.actual, expected: error.expected }; return true;
            }, 'the actual hidden-reply assertion must reject old/mutated source');
            observations.push({ name: 'item 735 actual red failure', topic, phase, stamp: receipt.stamp, raw });
          }
          await shot(p, `${topic}-${phase}-after`);
          assert.deepEqual(await position(topic, ids.root), beforePosition, 'title press changes no Core star, place, hold or identity');
          assert.deepEqual(await p.evaluate(`[...document.querySelectorAll('#messages > .reply-stack')].map(e=>e.dataset.stack)`), order, 'dossier order unchanged');
          assert.equal(await p.evaluate(`document.querySelector(${JSON.stringify(entry(ids.private))})!==null||document.querySelector('#messages').textContent.includes('PRIVATE 735')`), false, 'no private DOM or words leak');
          assert.deepEqual(p.errors, []);
        } finally { if (p) await p.close(); }
      });
      // Several own stars: added in reverse message order, earliest still wins.
      await setStar(topic, ids.r1, false, 'earliest-off');
      await setStar(topic, ids.r4, true, 'later-on');
      await setStar(topic, ids.r1, true, 'earliest-last');
      assert.deepEqual((await position(topic, ids.root)).starred, [ids.r1, ids.r4]);
      let p;
      try {
        p = await open(topic + '-multiple', device, topic, ids.root, 'window.holdReads=true');
        await themeOf(p, theme); await ready(p, device, ids.root);
        await activate(p, device, ids.root, device === 'laptop' ? ' ' : null);
        await assertLanding(p, topic, ids.root, ids.r1);
        await shot(p, topic + '-multiple-earliest');
      } finally { if (p) await p.close(); }
      await setStar(topic, ids.r1, false, 'earliest-final-off');
      await setStar(topic, ids.r4, false, 'later-final-off');
      assert.deepEqual((await position(topic, ids.root)).starred, [], 'other actor stars cannot supply a destination');
      try {
        p = await open(topic + '-negative', device, topic, ids.root, 'window.holdReads=true');
        await themeOf(p, theme); await ready(p, device, ids.root);
        assert.equal(await p.evaluate(`Boolean(document.querySelector(${JSON.stringify(star(ids.root))}))`), false, 'no own star: no selector despite another actor and private stars');
        await shot(p, topic + '-no-own-star'); assert.deepEqual(p.errors, []);
      } finally { if (p) await p.close(); }
    });
  }

  for (const device of devices) await check(`reading item 735 Core paging and unchanged 613 unread reveal ${device}`, async () => {
    const topic = `paged-735-${device}`;
    await control({ method: 'navigation_topics', topics: [{ id: topic, title: 'Paged garden 735' }] });
    const ids = await control({ method: 'dossier_deep', topic_id: topic });
    await setStar(topic, ids.target, true, 'deep-star');
    let p;
    try {
      p = await open(topic, device, topic, ids.newest, 'window.holdReads=true');
      assert.equal(await p.evaluate(`Boolean(document.querySelector(${JSON.stringify(card(ids.target))}))`), false, 'target starts outside the loaded Core page');
      const partialStar = '#messages .stack-head > .stack-star';
      await centre(p, partialStar); await press(p, input(device), partialStar);
      await assertLanding(p, topic, ids.root, ids.target);
      assert.ok(await p.evaluate(`Boolean(document.querySelector(${JSON.stringify(card(ids.root))}))`), '613 loads the actual dossier root too');
      await shot(p, topic + '-title-paged'); assert.deepEqual(p.errors, []);
    } finally { if (p) await p.close(); }
    // A fresh page still owes that delivery (held reports), so the original
    // unread badge now exercises the same path with its original intent.
    try {
      p = await open(topic + '-unread', device, topic, ids.newest, 'window.holdReads=true');
      if (device !== 'laptop') { await centre(p, '#rail-open'); await tap(p, '#rail-open'); }
      const badge = `#outline a[data-topic-id="${topic}"] .unread-count`;
      await until(() => p.evaluate(`Boolean(document.querySelector(${JSON.stringify(badge)}))`), '613 unread badge ready');
      await centre(p, badge); await press(p, input(device), badge);
      await assertLanding(p, topic, ids.root, ids.target);
      await shot(p, topic + '-613-unread'); assert.deepEqual(p.errors, []);
    } finally { if (p) await p.close(); }
  });
}

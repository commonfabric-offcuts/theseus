import assert from 'node:assert/strict';

// Only isolated fixture controls prepare data or select real immutable builds.
// Every product act below is browser input; evaluate only observes or scrolls.
export async function item735Checks(ctx, h) {
  const { check, until, control, view, shot, facts, observations } = ctx;
  const { seed, open, centre, press, tap, card, entry, words, closeReader } = h;
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
    assert.deepEqual(await look(p, topic, root, target), want(topic, root), 'title star reveals the exact own-starred message in place');
  };

  // Tony's picture shape runs first: latest replies with the first message folded away.
  for (const shape of ['first', 'hidden']) for (const device of devices) for (const theme of ['light', 'dark']) {
    await check(`reading item 735 ${shape} starred message red first and restored ${device} ${theme}`, async () => {
      const topic = `${shape}-735-${device}-${theme}`;
      const ids = await seed(topic, [
        ['root', { sender: 'aim-core', join: true, addressees: [facts.actor], body: 'The spring garden plan.', read: true }],
        ...Array.from({ length: shape === 'hidden' ? 40 : 18 }, (_, n) => ['r' + n, { sender: 'aim-core', reply_to: 'root', addressees: [facts.actor], body: `Garden reply ${n}: keep this exact message.`, read: true }]),
        ['neighbour', { sender: 'aim-ux', join: true, addressees: [facts.actor], body: 'Another dossier keeps its place.', read: true }],
        ['neighbourReply', { sender: 'aim-ux', reply_to: 'neighbour', addressees: [facts.actor], body: 'The neighbour remains separate.', read: true }],
        ['private', { sender: 'fixture-other-person', join: true, reply_to: 'root', addressees: ['aim-core'], whisper: true, body: 'PRIVATE 735 cannot select or leak.', read: true }],
      ]);
      const target = shape === 'first' ? ids.root : ids.r26, later = shape === 'first' ? ids.r1 : ids.r29;
      const prepare = async p => {
        if (shape === 'hidden') await ready(p, device, ids.root);
        else assert.equal(await p.evaluate(`document.querySelector(${JSON.stringify(section(ids.root) + ' > .stack-toggle')}).dataset.state`), 'folded', 'picture case starts open to latest with its first message folded away');
        await settled(p);
      };
      await setStar(topic, ids.private, true, 'private-star', 'fixture-other-person');
      await setStar(topic, shape === 'first' ? ids.r0 : ids.root, true, 'their-star', 'aim-core');
      await setStar(topic, target, true, 'own-star');
      assert.deepEqual((await position(topic, ids.root)).starred, [target], 'Core destination is the one own available star');
      assert.equal((await acts(topic, target)).folded, false, 'personal folded=false does not establish view visibility');
      const corePage = await view('topic_messages', { topic_id: topic, direction: 'before', limit: 100 });
      assert.equal(corePage.items.some(item => item.id === ids.private), false, 'Core enforces actual private access');
      observations.push({ name: 'item 735 fixture identity', topic, ids, instance_id: facts.instance_id, actor: facts.actor, tolerance });
      const reds = ['base', ...(device === 'laptop' && theme === 'light' ? ['no-reveal', 'wrong-destination', ...(shape === 'hidden' ? ['no-scroll'] : [])] : []), ...(device !== 'laptop' ? ['touch-gate'] : [])];
      const phases = reds.flatMap(phase => [phase, 'restored']);
      for (const [phaseIndex, phase] of phases.entries()) await runtime(phase, async receipt => {
        const phaseKey = `${phaseIndex}-${phase}`;
        let p;
        try {
          p = await open(`${topic}-${phaseKey}`, device, topic, ids.root, 'window.holdReads=true');
          assert.equal(await p.evaluate(`document.querySelector('script[type=module][src]').src.includes('/b/${receipt.stamp}/')`), true, 'page uses the actual selected source stamp');
          await themeOf(p, theme); await prepare(p);
          assert.equal((await look(p, topic, ids.root, target)).whole, false, 'the exact own-starred message starts folded away from this view');
          assert.equal(await p.evaluate(`document.querySelector(${JSON.stringify(star(ids.root))}).textContent`), '★ Starred');
          assert.equal(await p.evaluate(`document.querySelectorAll(${JSON.stringify(star(ids.root))}).length`), 1, 'one title control, no duplicate hit target');
          const order = await p.evaluate(`[...document.querySelectorAll('#messages > .reply-stack')].map(e=>e.dataset.stack)`);
          const beforePosition = await position(topic, ids.root);
          const writing = `Exact writing 735 ${device} ${theme}.`;
          if (phase === 'restored' || phase === 'touch-gate') {
            await centre(p, '#new-message'); await press(p, input(device), '#new-message');
            await until(() => p.evaluate("document.activeElement?.id==='inline-writing-body'"), 'native composer ready');
            await p.key('a', 4); await p.send('Input.insertText', { text: writing }); await p.key('Escape');
            await until(() => p.evaluate("!document.querySelector('#new-message-sheet').open"), 'composer returned with writing kept');
          }
          await centre(p, star(ids.root));
          if ((phase === 'restored' || phase === 'touch-gate') && device !== 'laptop') assert.equal(await p.evaluate(`document.querySelector(${JSON.stringify(card(ids.root))}).classList.contains('lit')`), false, 'composer close leaves title head unlit before its FIRST tap');
          await shot(p, `${topic}-${phaseKey}-before`);
          observations.push({ name: 'item 735 before native press', topic, phase, phaseKey, state: await look(p, topic, ids.root, target), scrollY: await p.evaluate('scrollY') });
          await activate(p, device, ids.root, phase === 'restored' && device === 'laptop' && theme === 'dark' ? 'Enter' : null);
          observations.push({ name: 'item 735 after native press', topic, phase, phaseKey, state: await look(p, topic, ids.root, target), geometry: await p.evaluate(`(()=>{const b=document.querySelector(${JSON.stringify(card(target))}).getBoundingClientRect();return {scrollY,viewport:innerHeight,top:b.top,bottom:b.bottom}})()`) });
          if (phase === 'restored') {
            await assertLanding(p, topic, ids.root, target);
            assert.equal(await p.evaluate("document.querySelector('#inline-writing-body').value"), writing, 'title navigation preserves exact composer writing');
          } else {
            const actual = await look(p, topic, ids.root, target); let raw;
            assert.throws(() => assert.deepEqual(actual, want(topic, ids.root), 'title star reveals the exact own-starred message in place'), error => {
              assert.equal(error.code, 'ERR_ASSERTION'); raw = { stack: error.stack, actual: error.actual, expected: error.expected }; return true;
            }, 'the actual own-message assertion must reject old/mutated source');
            if (phase === 'touch-gate') assert.equal(actual.whole, false, 'old touch gate swallows reveal from the unlit title');
            if (phase === 'no-scroll') {
              assert.equal(actual.whole, true, 'scroll mutant really reveals the target');
              assert.equal(actual.focused, true, 'scroll mutant really selects the exact target');
              assert.equal(actual.onScreen, false, 'scroll mutant must die on offscreen geometry, not another field');
            }
            observations.push({ name: 'item 735 actual red failure', topic, phase, phaseKey, stamp: receipt.stamp, raw });
          }
          await shot(p, `${topic}-${phaseKey}-after`);
          assert.deepEqual(await position(topic, ids.root), beforePosition, 'title press changes no Core star, place, hold or identity');
          assert.deepEqual(await p.evaluate(`[...document.querySelectorAll('#messages > .reply-stack')].map(e=>e.dataset.stack)`), order, 'dossier order unchanged');
          assert.equal(await p.evaluate(`document.querySelector(${JSON.stringify(entry(ids.private))})!==null||document.querySelector('#messages').textContent.includes('PRIVATE 735')`), false, 'no private DOM or words leak');
          if (phase === 'restored') {
            await centre(p, words(target)); await press(p, input(device), words(target));
            await until(() => p.evaluate("document.querySelector('#reader').open"), 'native message press opens the Reader');
            await until(() => p.evaluate("document.querySelector('#reader-star').getAttribute('aria-pressed')==='true'"), 'Reader shows the same own star');
            await press(p, input(device), '#reader-aside');
            await until(() => p.evaluate("[...document.querySelectorAll('.press-note')].some(n=>n.textContent.includes('unstar it to move it below More'))"), '635 archive still says why this starred dossier stays');
            assert.deepEqual(await position(topic, ids.root), beforePosition, '635 hold changes no position or star');
            await closeReader(p, input(device));
            assert.equal(await p.evaluate("document.querySelector('#inline-writing-body').value"), writing, 'Reader hold and return retain exact writing');
            assert.deepEqual(await position(topic, ids.root), beforePosition, 'Reader return keeps the same dossier');
            await shot(p, topic + '-' + phaseKey + '-635-hold-return');
          }
          assert.deepEqual(p.errors, []);
        } finally {
          if (p) {
            try {
              observations.push({ name: 'item 735 before cleanup', topic, phase, phaseKey, state: await look(p, topic, ids.root, target), geometry: await p.evaluate(`(()=>{const c=document.querySelector(${JSON.stringify(card(target))}),b=c?.getBoundingClientRect();return {scrollY,viewport:innerHeight,active:document.activeElement?.outerHTML,top:b?.top,bottom:b?.bottom}})()`) });
              await shot(p, `${topic}-${phaseKey}-before-cleanup`);
            } finally { await p.close(); }
          }
        }
      });
      // Several own stars: added in reverse message order, earliest still wins.
      await setStar(topic, target, false, 'earliest-off');
      await setStar(topic, later, true, 'later-on');
      await setStar(topic, target, true, 'earliest-last');
      assert.deepEqual((await position(topic, ids.root)).starred, [target, later]);
      let p;
      try {
        p = await open(topic + '-multiple', device, topic, ids.root, 'window.holdReads=true');
        await themeOf(p, theme); await prepare(p);
        await activate(p, device, ids.root, device === 'laptop' ? ' ' : null);
        await assertLanding(p, topic, ids.root, target);
        await shot(p, topic + '-multiple-earliest');
      } finally { if (p) { try { observations.push({ name: 'item 735 auxiliary before cleanup', topic, state: await look(p, topic, ids.root, target) }); await shot(p, topic + '-multiple-before-cleanup'); } finally { await p.close(); } } }
      await setStar(topic, target, false, 'earliest-final-off');
      await setStar(topic, later, false, 'later-final-off');
      assert.deepEqual((await position(topic, ids.root)).starred, [], 'other actor stars cannot supply a destination');
      p = null;
      try {
        p = await open(topic + '-negative', device, topic, ids.root, 'window.holdReads=true');
        await themeOf(p, theme); await prepare(p);
        assert.equal(await p.evaluate(`Boolean(document.querySelector(${JSON.stringify(star(ids.root))}))`), false, 'no own star: no selector despite another actor and private stars');
        await shot(p, topic + '-no-own-star');
        if (device !== 'laptop') {
          // Exempting the title action must not make a card body's first tap open it.
          await centre(p, '#new-message'); await press(p, input(device), '#new-message');
          await until(() => p.evaluate("document.activeElement?.id==='inline-writing-body'"), 'negative control composer ready');
          await p.key('Escape');
          await until(() => p.evaluate("!document.querySelector('#new-message-sheet').open"), 'negative control composer closed');
          const bodyTarget = shape === 'first' ? ids.r17 : ids.r39;
          await centre(p, words(bodyTarget)); await press(p, input(device), words(bodyTarget));
          assert.equal(await p.evaluate("document.querySelector('#reader').open"), false, 'card body FIRST tap still only lights');
          assert.equal(await p.evaluate(`document.querySelector(${JSON.stringify(card(bodyTarget))}).classList.contains('lit')`), true, 'native first body tap lights its own card');
          await press(p, input(device), words(bodyTarget));
          await until(() => p.evaluate("document.querySelector('#reader').open"), 'card body SECOND tap still opens');
          await closeReader(p, input(device));
          await shot(p, topic + '-body-touch-ownership');
        }
        assert.deepEqual(p.errors, []);
      } finally { if (p) { try { observations.push({ name: 'item 735 auxiliary before cleanup', topic, state: await look(p, topic, ids.root, target) }); await shot(p, topic + '-negative-before-cleanup'); } finally { await p.close(); } } }
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

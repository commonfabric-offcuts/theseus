import assert from 'node:assert/strict';

// The missing parts of 301, through real keys and the real fixture (564).
// Registered in railChecks so both release browser owners keep these checks.
export async function arrowPartsChecks({ check, page, until, control, facts, shot, observations }) {
  let serial = Date.now();
  const focused = (p, selector) => p.evaluate(`document.activeElement===document.querySelector(${JSON.stringify(selector)})`);
  const focus = (p, selector) => p.evaluate(`document.querySelector(${JSON.stringify(selector)}).focus()`);
  const enter = async (tag, width, theme, links = false) => {
    const topic = `arrow-parts-564-${tag}-${width}-${theme}-${++serial}`;
    await control({ method: 'navigation_topics', topics: [{ id: topic, title: 'Arrow parts' }] });
    const say = async (name, body, extra = {}) => {
      const sent = await control({ method: 'agent_message', operation_id: topic + '-' + name,
        topic_id: topic, source: 'topic', sender: 'person', body, ...extra });
      assert.equal(sent.status, 'committed');
      return sent.result.message_id;
    };
    const head = await say('head', links
      ? 'Read [Source passage](https://example.test/source) and [Second link](https://example.test/second).\n\n```js\nconst answer = 42;\n```'
      : 'The original dossier message.');
    const replies = links ? [] : [await say('first', 'The earlier reply.', { reply_to: head }),
      await say('last', 'The latest reply.', { reply_to: head })];
    const plain = await say('plain', 'A message without links.');
    const p = await page(topic, null, true, { url: facts.origin + '/?topic=' + topic, beforeNavigate: async q => {
      await q.send('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: width < 760 });
      await q.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: theme }] });
    } });
    const card = id => `.message-card[data-id="${id}"]`, stack = `.reply-stack[data-stack="${head}"]`;
    await until(() => p.evaluate(`document.body.dataset.ready==='true' && Boolean(document.querySelector('${card(head)}')) && !document.documentElement.hasAttribute('data-rails-reading')`), 'the fixture messages and rails are drawn');
    return { p, head, replies, plain, card, stack, toggle: stack + ' > .stack-toggle' };
  };
  const land = async (p, key, selector, why) => {
    await p.key(key);
    assert.equal(await focused(p, selector), true, why);
    assert.equal(await p.evaluate(`(()=>{const e=document.activeElement,shown=e.matches('.stack-head-card')&&e.closest('.reply-stack').dataset.headOpen==='false'?e.querySelector('.stack-head'):e,r=shown.getBoundingClientRect();return shown.checkVisibility({visibilityProperty:true})&&r.width>0&&r.height>0&&!e.closest('[inert]')&&e.matches(':focus-visible')})()`), true, 'the focused control (or compact head row) is shown, usable and keyboard focused');
  };
  for (const width of [320, 375, 390, 1280]) for (const theme of ['light', 'dark']) {
    await check(`rail item 564 folded parts ${width} ${theme}: compact header, chevron, visible replies and back`, async () => {
      const { p, head, card, stack, toggle } = await enter('folded', width, theme);
      try {
        await focus(p, card(head));
        if (await p.evaluate(`document.querySelector('${stack}').dataset.headOpen`) !== 'true') await p.key('ArrowRight'); // Open only if needed, then fold through the native key owner.
        await p.key('ArrowLeft');
        assert.equal(await p.evaluate(`document.querySelector('${stack}').dataset.headOpen`), 'false');
        const visible = await p.evaluate(`[...document.querySelectorAll('${stack} > .stack-replies [data-id]')].filter(e=>e.getClientRects().length).map(e=>e.dataset.id)`);
        assert.ok(visible.length, 'a folded dossier still shows its latest reply');
        await land(p, 'ArrowDown', toggle, 'down from the compact header reaches its chevron');
        await land(p, 'ArrowDown', card(visible[0]), 'down from the chevron reaches the first shown reply');
        await land(p, 'ArrowUp', toggle, 'up returns to the folded chevron');
        await land(p, 'ArrowUp', card(head), 'up returns to the compact header');
        assert.equal(await p.evaluate(`document.querySelector('${stack}').dataset.headOpen`), 'false', 'traversing does not unfold the dossier');
        await shot(p, `564-folded-${width}-${theme}`);
        observations.push({ item: 564, state: 'folded', width, theme, visibleReplies: visible });
        assert.deepEqual(p.errors, []);
      } finally { await p.close(); }
    });
    await check(`rail item 564 unfolded and plain negatives ${width} ${theme}: existing vertical order and pane arrows`, async () => {
      const { p, head, replies, plain, card, stack, toggle } = await enter('negative', width, theme);
      try {
        await focus(p, card(head));
        if (await p.evaluate(`document.querySelector('${stack}').dataset.headOpen`) !== 'true') await p.key('ArrowRight');
        assert.equal(await p.evaluate(`document.querySelector('${stack}').dataset.headOpen`), 'true');
        await land(p, 'ArrowUp', toggle, 'open dossier still has its chevron before its head');
        await land(p, 'ArrowDown', card(head), 'then the original message');
        for (const id of replies) await land(p, 'ArrowDown', card(id), 'then replies in their existing order');
        await focus(p, card(plain)); await p.key('ArrowLeft');
        assert.equal(await p.evaluate("Boolean(document.activeElement.closest('#outline'))"), width === 1280, 'plain-card left still crosses to the visible outline only');
        if (width !== 1280) assert.equal(await focused(p, card(plain)), true, 'a hidden pane is not opened');
        assert.deepEqual(p.errors, []);
      } finally { await p.close(); }
    });
    await check(`rail item 564 message words ${width} ${theme}: enter links, reach the code button, return to the card`, async () => {
      const { p, head, plain, card } = await enter('words', width, theme, true);
      try {
        const first = card(head) + ' .message-preview a.words-link', second = first + ':nth-of-type(2)', copy = `.feed-fence-copy[data-message="${head}"]`;
        assert.equal(await p.evaluate(`document.querySelectorAll('${card(head)} .message-preview a.words-link').length`), 2);
        assert.equal(await p.evaluate(`Boolean(document.querySelector('${copy}'))`), true, 'a real button is present inside the message words');
        await focus(p, card(head));
        await land(p, 'ArrowRight', first, 'right enters the first link rather than jumping to a rail');
        await land(p, 'ArrowRight', second, 'right reaches the next link');
        await land(p, 'ArrowRight', copy, 'right reaches the button on the next line');
        await land(p, 'ArrowLeft', second, 'left returns from the button to the second link');
        await land(p, 'ArrowLeft', first, 'left returns to the first link');
        await land(p, 'ArrowLeft', card(head), 'left from the first control returns to the card');
        await land(p, 'ArrowRight', first, 'the words can be entered again');
        await land(p, 'ArrowUp', card(plain), 'up from a link still reaches the preceding message');
        await focus(p, card(head)); await land(p, 'ArrowRight', first, 'return to words');
        await land(p, 'Tab', second, 'Tab keeps the same source order');
        await land(p, 'Tab', copy, 'Tab still reaches the external code Copy control');
        await p.key('ArrowRight');
        assert.equal(await p.evaluate("Boolean(document.activeElement.closest('#things'))"), width === 1280, 'past the final control, right crosses only to a visible right rail');
        if (width !== 1280) assert.equal(await focused(p, copy), true, 'right does not open a hidden rail');
        await focus(p, card(head)); await land(p, 'ArrowRight', first, 'leave the screenshot on the first link');
        await shot(p, `564-words-${width}-${theme}`);
        assert.deepEqual(p.errors, []);
      } finally { await p.close(); }
    });
  }
}

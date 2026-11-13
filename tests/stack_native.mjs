// Reply stacks on the topic page (docs/reply-stacks.md), pressed as a person
// presses them: a pointer and keys at 1280 wide, and a finger at 390 wide.
// Each check seeds a topic of its own through the fixture's real commands and
// reads what Core then holds, for the person and for another reader (the
// fixture's stack_act and acts_as act and read as someone else), so a press
// that only repaints the page fails. Run from topic_reading_native.mjs, in
// Chrome for Testing (reader_persistence_native.mjs --reading) and in Safari's
// engine (webkit_native.mjs --reading). Screenshots are kept as stack-*.png.
import assert from 'node:assert/strict';

// helpers: what topic_reading_native.mjs's checks press and read with.
export async function stackChecks({ check, until, view, control, shot, facts, observations, engine }, helpers) {
  const { seed, open, becomes, centre, tap, press, lit, bar, away, readerOn, closeReader, light, openReader, entry, card, words, DEVICES } = helpers;
  const other = 'aim-core';
  // A stack, as the page shows it: its head's row and whether its full message
  // shows, its fold, and what sits under it top to bottom, by the names seeded.
  const look = (p, ids, head) => {
    const names = Object.fromEntries(Object.entries(ids).map(([key, id]) => [id, key]));
    return p.evaluate(`(()=>{const names=${JSON.stringify(names)},c=document.querySelector(${JSON.stringify(card(ids[head]))}),s=c?.closest('.reply-stack');
      if(!s)return null;const row=s.querySelector('.stack-head');const shown=e=>e.getClientRects().length>0;
      return {fold:s.dataset.fold,headOpen:s.dataset.headOpen,placed:s.dataset.placed,head:names[s.firstElementChild.dataset.id],
        name:row?.querySelector('.stack-name')?.textContent??null,meta:row?.querySelector('.stack-meta')?.textContent??null,isNew:Boolean(row?.querySelector('.stack-new')),
        full:shown(c.querySelector(':scope > .message-preview')),
        rows:[...s.querySelector(':scope > .stack-replies').children].filter(shown).map(e=>e.dataset.id?names[e.dataset.id]:e.classList.contains('stack-join-line')?'join: '+e.querySelector('.stack-join-words').textContent.replace(/, .*$/,''):e.className)}})()`);
  };
  // The stacks down the page, each by its head's name.
  const stacks = (p, ids) => {
    const names = Object.fromEntries(Object.entries(ids).map(([key, id]) => [id, key]));
    // The topic's opening, the person's own and the oldest, is left out.
    return p.evaluate(`[...document.querySelector('#messages').children].filter(e=>(e.dataset.id||e.classList.contains('reply-stack'))&&!(e.classList.contains('own-message')&&!(${JSON.stringify(names)})[e.dataset.id])).map(e=>(${JSON.stringify(names)})[e.dataset.id??e.dataset.stack]??('?'+e.tagName+'.'+e.className))`);
  };
  // The acts on a message as a reader holds them in Core.
  const actsOf = async (topic, id, reader = facts.actor) => {
    const found = reader === facts.actor ? await view('message_acts', { topic_id: topic }) : (await control({ method: 'acts_as', reader, topic_id: topic })).acts;
    return found.items.find(item => item.message_id === id)?.acts ?? null;
  };
  const starsOf = async reader => (reader === facts.actor ? await view('stars', {}) : (await control({ method: 'acts_as', reader, topic_id: 'none' })).stars).items.map(star => star.message_id);
  // The keys on a message, reached as a person reaches it: ↓ from the top of the page until its card holds the focus.
  const keyTo = async (p, id) => {
    // From the bar or a menu the keys come back to the page first, as Esc or a press on the page brings them.
    await p.evaluate(`(()=>{if(!document.querySelector('#messages').contains(document.activeElement))document.activeElement?.blur()})()`);
    for (let step = 0; step < 30; step++) {
      // A dossier's chevron is a stop before its head, so it is placed as the dossier itself.
      const way = await p.evaluate(`(()=>{const here=document.activeElement,to=document.querySelector(${JSON.stringify(card(id))});
        const at=here?.matches?.('#messages .reply-stack > .stack-toggle')?here.parentElement:here?.closest?.('#messages [data-id]');
        if(at?.dataset.id===${JSON.stringify(id)})return 'there';if(!at)return 'ArrowDown';return at.compareDocumentPosition(to)&Node.DOCUMENT_POSITION_FOLLOWING?'ArrowDown':'ArrowUp'})()`);
      if (way === 'there') return;
      await p.key(way);
    }
    assert.fail(`the keys never reached ${id}`);
  };
  const said = p => p.evaluate(`document.getElementById('stack-said')?.textContent ?? ''`);
  const alertColour = p => p.evaluate(`(()=>{const s=document.createElement('span');s.style.color='var(--alert)';document.body.append(s);const c=getComputedStyle(s).color;s.remove();return c})()`);
  const focusedOn = p => p.evaluate(`document.activeElement?.closest?.('[data-id]')?.dataset.id ?? null`);
  // The ⋯ menu of a message, from its bar, and the words of its items.
  const menuOf = async (p, device, id) => {
    await light(p, device, id);
    await press(p, device, '.message-bar [data-act=more]');
    await until(() => p.evaluate(`Boolean(document.querySelector('.message-menu-list'))`), `${device}: ⋯ opens the menu`);
    return p.evaluate(`[...document.querySelector('.message-menu-list').querySelectorAll('button')].map(b=>b.textContent)`);
  };
  // A press held down where its click opens nothing: on the topic's name, at the top of the page. Gives
  // back the press's release.
  const holdOnTitle = async p => {
    await p.evaluate('scrollTo(0,0)');
    const b = await p.box('#topic-title'), x = b.x + Math.min(12, b.width / 2), y = b.y + b.height / 2;
    assert.equal(await p.evaluate(`document.getElementById('topic-title').contains(document.elementFromPoint(${x},${y}))`), true, 'the topic\'s name shows where it is pressed');
    await p.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
    await p.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
    return () => p.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
  };
  // Two frames on: a repaint the page made at once is on the page.
  const twoFrames = p => p.evaluate('new Promise(done=>requestAnimationFrame(()=>requestAnimationFrame(done)))');
  const choose = async (p, device, label) => {
    const at = await p.evaluate(`[...document.querySelectorAll('.message-menu-list button')].findIndex(b=>b.firstChild.textContent===${JSON.stringify(label)})`);
    assert.ok(at >= 0, `${label} is in the menu`);
    await press(p, device, `.message-menu-list button:nth-of-type(${at + 1})`);
  };

  await check('reading coordination dossiers stay compact, can be hidden, and return for human or room replies', async () => {
    for (const device of Object.keys(DEVICES)) {
      const topic = 'stack-coordination-' + device;
      const ids = await seed(topic, [
        ['primer', { sender: 'aim-ux', join: true, addressees: [facts.actor], body: 'Ready for this topic.' }],
        ['root', { sender: 'aim-core', join: true, addressees: ['aim-ux'], body: 'Review between agents only' }],
        ['reply', { sender: 'aim-ux', join: true, addressees: ['aim-core'], reply_to: 'root', body: 'The review is ready.' }],
        ['room', { sender: 'aim-core', addressees: [], body: 'An update for the room.' }],
        ['roomReply', { sender: 'aim-ux', addressees: ['aim-core'], reply_to: 'room', body: 'I checked it.' }],
        ['mine', { sender: facts.actor, addressees: ['aim-core'], body: 'My question.' }],
        ['answer', { sender: 'aim-core', addressees: ['aim-ux'], reply_to: 'mine', body: 'Answering the human without a To field naming them.' }],
      ]);
      const p = await open(topic, device, topic, ids.root);
      const target = `#messages .reply-stack[data-stack="${ids.root}"]`;
      const state = () => p.evaluate(`(()=>{const s=document.querySelector(${JSON.stringify(target)});return s?{compact:s.dataset.compact,fold:s.dataset.fold,visible:s.getClientRects().length>0,height:s.getBoundingClientRect().height}:null})()`);
      await until(async () => (await state())?.compact === 'true', 'the agent-only dossier is compact');
      assert.ok((await state()).height <= 52, 'one quiet row, not a folder and another row');
      assert.equal((await look(p, ids, 'room')).fold, 'folded', 'room posts retain normal dossiers');
      assert.equal((await look(p, ids, 'mine')).fold, 'folded', 'direct answers to the human stay visible');
      await shot(p, 'coordination-compact-' + device);
      const toggle = target + ' > .stack-toggle', filter = '#agent-coordination-show button';
      // From its header alone, the two states every dossier has (item 394); it never goes back to the header alone.
      for (const wanted of ['folded', 'open', 'folded']) {
        await centre(p, toggle); await press(p, device, toggle);
        await becomes(async () => (await state()).fold, wanted, 'from the header, the two states: ' + wanted);
      }
      await centre(p, filter); await press(p, device, filter);
      await becomes(async () => (await state()).visible, false, 'Show agent coordination hides the row');
      const later = (await control({ method: 'agent_message', operation_id: topic + '-later', topic_id: topic, source: 'topic', sender: 'aim-ux', addressees: ['aim-core'], reply_to: ids.reply, body: 'Another internal check.' })).result.message_id;
      await until(() => p.evaluate(`Boolean(document.querySelector(${JSON.stringify(card(later))}))`), 'new internal reply arrives');
      assert.equal((await state()).visible, false, 'agent replies do not make it reappear');
      const human = (await control({ method: 'agent_message', operation_id: topic + '-human', topic_id: topic, source: 'topic', sender: 'aim-core', addressees: device === 'phone' ? [] : [facts.actor], reply_to: later, body: 'Now this needs your attention.' })).result.message_id;
      await until(() => p.evaluate(`Boolean(document.querySelector(${JSON.stringify(card(human))}))`), 'human-addressed reply arrives');
      await becomes(async () => (await state()).visible, true, 'a human-addressed reply brings the dossier back');
      assert.equal(await p.evaluate(`document.querySelector(${JSON.stringify(target)}).dataset.coordination`), '', 'mixed stack is not classified as agent-only');
      await shot(p, 'coordination-returned-' + device);
      assert.deepEqual(p.errors, []); await p.close();
    }
  });

  await check('reading stacks a dossier left at its header alone shows latest plus unread once it is not agents\' alone, and a new agent-only dossier still begins as its header', async () => {
    // Item 394: the header alone is no state of an ordinary dossier. An agent-only dossier (item 359) still begins
    // there; ⌘Z after opening one takes it back there; once a reply brings in the person it reads as any other.
    const topic = 'stack-head-left';
    const ids = await seed(topic, [
      ['primer', { sender: 'aim-ux', join: true, addressees: [facts.actor], body: 'Ready for this topic.' }],
      ['root', { sender: 'aim-core', join: true, addressees: ['aim-ux'], body: 'Agents only, at first.' }],
      ['reply', { sender: 'aim-ux', addressees: ['aim-core'], reply_to: 'root', body: 'Checked between us.' }],
    ]);
    const p = await open(topic, 'laptop', topic, ids.root);
    const target = `#messages .reply-stack[data-stack="${ids.root}"]`, toggle = target + ' > .stack-toggle';
    const state = () => p.evaluate(`(s=>s&&{compact:s.dataset.compact,fold:s.dataset.fold,coordination:s.dataset.coordination})(document.querySelector(${JSON.stringify(target)}))`);
    await becomes(state, { compact: 'true', fold: 'head', coordination: 'agents' }, 'an agent-only dossier begins as its header alone');
    await centre(p, toggle); await press(p, 'laptop', toggle);
    await becomes(state, { compact: 'false', fold: 'folded', coordination: 'agents' }, 'its chevron opens it to latest plus unread');
    await p.evaluate(`document.querySelector(${JSON.stringify(toggle)}).focus()`);
    await p.key('z', 4);
    await becomes(state, { compact: 'true', fold: 'head', coordination: 'agents' }, '⌘Z takes it back to its header alone');
    const human = (await control({ method: 'agent_message', operation_id: topic + '-human', topic_id: topic, source: 'topic', sender: 'aim-core', addressees: [facts.actor], reply_to: ids.reply, body: 'Now this one is yours.' })).result.message_id;
    await until(() => p.evaluate(`Boolean(document.querySelector(${JSON.stringify(card(human))}))`), 'the reply to the person arrives');
    await becomes(state, { compact: 'false', fold: 'folded', coordination: '' }, 'not agents\' alone now, the dossier left at its header shows latest plus unread');
    assert.ok((await look(p, { ...ids, human }, 'root')).rows.includes('human'), 'and the reply to the person shows in it');
    assert.equal(await p.evaluate(`document.querySelector(${JSON.stringify(toggle)}).getAttribute('aria-expanded')`), 'true', 'its chevron says it is open');
    await shot(p, 'stack-head-left-laptop');
    // A dossier between agents that arrives now still begins as its header alone.
    const fresh = (await control({ method: 'agent_message', operation_id: topic + '-fresh', topic_id: topic, source: 'topic', sender: 'aim-core', addressees: ['aim-ux'], body: 'A new check between agents.' })).result.message_id;
    await control({ method: 'agent_message', operation_id: topic + '-fresh-reply', topic_id: topic, source: 'topic', sender: 'aim-ux', addressees: ['aim-core'], reply_to: fresh, body: 'On it.' });
    const freshStack = `#messages .reply-stack[data-stack="${fresh}"]`;
    await becomes(() => p.evaluate(`(s=>s&&{compact:s.dataset.compact,fold:s.dataset.fold})(document.querySelector(${JSON.stringify(freshStack)}))`), { compact: 'true', fold: 'head' },
      'a new agent-only dossier begins as its header alone');
    assert.deepEqual(p.errors, []); await p.close();
  });

  await check('reading coordination links reveal hidden work and plain arrows open a dossier from its header to the two states, never back to the header', async () => {
    const topic = 'stack-coordination-links';
    const ids = await seed(topic, [
      ['primer', { sender: 'aim-ux', join: true, addressees: [facts.actor], body: 'Ready.' }],
      ['root', { sender: 'aim-core', join: true, addressees: ['aim-ux'], body: 'Internal dossier.' }],
      ['reply', { sender: 'aim-ux', reply_to: 'root', addressees: ['aim-core'], body: 'Internal answer.' }],
      ['single', { sender: 'aim-core', addressees: ['aim-ux'], body: 'Internal standalone.' }],
    ]);
    const link = (await control({ method: 'agent_message', operation_id: topic + '-link', topic_id: topic, source: 'topic', sender: other, addressees: [facts.actor],
      body: `[Reply](${facts.origin}/?topic=${topic}&message=${ids.reply}) and [Standalone](${facts.origin}/?topic=${topic}&message=${ids.single}).` })).result.message_id;
    const p = await open(topic, 'laptop', topic, ids.root);
    await keyTo(p, ids.root);
    for (const [key, want] of [['ArrowRight', 'folded'], ['ArrowRight', 'open'], ['ArrowLeft', 'folded']]) {
      await p.key(key); await becomes(async () => (await look(p, ids, 'root')).fold, want, key + ' chooses ' + want);
    }
    // ← at latest plus unread leaves for the outline, and the dossier stays as it is.
    await p.key('ArrowLeft');
    await until(() => p.evaluate("Boolean(document.activeElement.closest('#outline'))"), 'another ← moves into the outline');
    assert.equal((await look(p, ids, 'root')).fold, 'folded', 'leaving the dossier at latest plus unread, not its header alone');
    await control({ method: 'stack_act', sender: facts.actor, kind: 'message.fold', message_id: ids.reply,
      operation_id: topic + '-saved-fold', args: { folded: true } });
    await until(async () => (await actsOf(topic, ids.reply))?.folded === true, 'the quiet reply has a saved personal fold');
    const filter = '#agent-coordination-show button';
    for (const [id, words] of [[ids.reply, 'Internal answer.'], [ids.single, 'Internal standalone.']]) {
      await centre(p, filter); await p.point(filter);
      assert.equal(await p.evaluate(`document.querySelector(${JSON.stringify(card(id))}).getClientRects().length`), 0, 'the target is hidden');
      const anchor = `${card(link)} a.words-link[href*="message=${id}"]`;
      await centre(p, anchor); await p.point(anchor);
      await until(async () => (await readerOn(p))?.startsWith(words), 'the link opens the hidden message in the Reader');
      await closeReader(p, 'laptop');
      assert.equal(await p.evaluate(`document.querySelector('#agent-coordination-show button').getAttribute('aria-pressed')`), 'true', 'the filter says the target is visible again');
      assert.equal((await actsOf(topic, ids.reply)).folded, true, 'revealing hidden work preserves the saved personal fold');
    }
    assert.deepEqual(p.errors, []); await p.close();
  });

  await check('reading stacks fully expanded dossiers keep their own keyboard stop in both directions', async () => {
    const topic = 'stack-open-header-stop';
    const ids = await seed(topic, [
      ['older', { sender: other, join: true, addressees: [facts.actor], body: 'Older dossier' }],
      ['olderReply', { sender: other, reply_to: 'older', addressees: [facts.actor], body: 'Older reply' }],
      ['newer', { sender: other, addressees: [facts.actor], body: 'Newer dossier' }],
      ['newerReply', { sender: other, reply_to: 'newer', addressees: [facts.actor], body: 'Newer reply' }],
    ]);
    const p = await open(topic, 'laptop', topic, ids.newer);
    for (const id of [ids.older, ids.newer]) await press(p, 'laptop', `.reply-stack[data-stack="${id}"] > .stack-toggle`);
    const focused = () => p.evaluate(`(()=>{const at=document.activeElement;return at.matches('.stack-toggle')?'stack:'+at.closest('.reply-stack').dataset.stack:at.closest('[data-id]')?.dataset.id??null})()`);
    await keyTo(p, ids.newerReply);
    await p.key('ArrowDown');
    assert.equal(await focused(), 'stack:' + ids.older, 'Down reaches the neighboring dossier before its original message');
    assert.equal(await p.evaluate("document.querySelector('.message-bar').hidden"), true, 'a dossier has no message toolbar');
    await p.key('ArrowDown'); assert.equal(await focused(), ids.older);
    await p.key('ArrowDown'); assert.equal(await focused(), ids.olderReply);
    for (const expected of [ids.older, 'stack:' + ids.older, ids.newerReply, ids.newer, 'stack:' + ids.newer]) {
      await p.key('ArrowUp'); assert.equal(await focused(), expected, 'Up traverses every message and dossier');
    }
    await p.key('ArrowUp');
    assert.equal(await p.evaluate("Boolean(document.activeElement.closest('.topic-header'))"), true, 'Up from the first dossier reaches the page header');
    await p.key('ArrowDown'); assert.equal(await focused(), 'stack:' + ids.newer);
    await p.key('ArrowDown'); assert.equal(await focused(), ids.newer);
    await shot(p, 'stack-expanded-header-keyboard');
    assert.deepEqual(p.errors, []); await p.close();
  });

  await check('reading stacks move the keys from a dossier whose chevron holds the focus without being a stop', async () => {
    const topic = 'stack-chevron-not-a-stop';
    // Eight dossiers, s7 at the top of the page down to s0, each folded to its unread reply.
    const said = [];
    for (let n = 0; n < 8; n++) {
      said.push(['s' + n, { sender: other, ...(n ? {} : { join: true }), addressees: [facts.actor], body: 'Dossier ' + n }]);
      said.push(['s' + n + 'R', { sender: other, reply_to: 's' + n, addressees: [facts.actor], body: 'Reply in dossier ' + n }]);
    }
    const ids = await seed(topic, said);
    const p = await open(topic, 'laptop', topic, ids.s3);
    const toggle = id => `.reply-stack[data-stack="${id}"] > .stack-toggle`;
    const fold = id => p.evaluate(`document.querySelector(${JSON.stringify(`.reply-stack[data-stack="${id}"]`)}).dataset.fold`);
    const focused = () => p.evaluate(`(()=>{const at=document.activeElement;return at.matches('.stack-toggle')?'stack:'+at.closest('.reply-stack').dataset.stack:at.closest('[data-id]')?.dataset.id??null})()`);
    const atPageHeader = () => p.evaluate("Boolean(document.activeElement.closest('.topic-header'))");
    // Whether the dossier sits below the first message in view, so a move that
    // starts over from the top of the window shows as a move from elsewhere.
    const belowFirstInView = id => p.evaluate(`(()=>{const s=document.querySelector(${JSON.stringify(`.reply-stack[data-stack="${id}"]`)});
      const first=[...document.querySelectorAll('#messages [data-id]')].find(e=>e.getClientRects().length&&e.getBoundingClientRect().bottom>0);return Boolean(first)&&!s.contains(first)})()`);
    // Shift-Tab back onto a dossier's chevron from a message after it, so the
    // message the keys were last on is not the dossier's head.
    const backTo = async id => {
      for (let step = 0; step < 12 && await focused() !== 'stack:' + id; step++) await p.key('Tab', 8);
      assert.equal(await focused(), 'stack:' + id, 'Shift-Tab reaches the chevron of ' + id);
    };
    assert.equal(await fold(ids.s3), 'folded', 'an unread dossier starts folded');
    for (let step = 0; step < 3 && await fold(ids.s3) !== 'open'; step++) { await centre(p, toggle(ids.s3)); await press(p, 'laptop', toggle(ids.s3)); }
    assert.equal(await fold(ids.s3), 'open');
    await centre(p, toggle(ids.s3));
    await keyTo(p, ids.s4R);
    await p.key('ArrowDown');
    assert.equal(await focused(), 'stack:' + ids.s3, 'Down from the dossier above reaches the expanded header');
    // Space on the expanded header folds the dossier to latest plus unread (Return there edits its title, item 385);
    // its chevron keeps the focus but is no longer a stop, and stands for the dossier's compact header.
    await p.key(' ');
    await becomes(() => fold(ids.s3), 'folded', 'Space on the expanded header folds the dossier to latest plus unread');
    assert.equal(await focused(), 'stack:' + ids.s3, 'the folding chevron keeps the focus');
    assert.equal(await belowFirstInView(ids.s3), true, 'the dossier is not the first in view');
    await p.key('ArrowDown');
    assert.equal(await focused(), ids.s3R, 'Down from a folded chevron reaches its dossier\'s shown reply');
    await backTo(ids.s3);
    await p.key('ArrowUp');
    assert.equal(await focused(), ids.s4R, 'Up from a folded chevron reaches the last message of the dossier above');
    // Tab back onto the folded dossier's chevron, the keys move on the same way.
    await centre(p, toggle(ids.s3));
    await keyTo(p, ids.s3R); await backTo(ids.s3);
    assert.equal(await belowFirstInView(ids.s3), true, 'the folded dossier is not the first in view');
    await p.key('ArrowDown');
    assert.equal(await focused(), ids.s3R, 'Down from a folded chevron reached by Tab reaches its dossier\'s shown reply');
    // Space on the first dossier's expanded header, then Up, reaches the page header.
    for (let step = 0; step < 3 && await fold(ids.s7) !== 'open'; step++) { await centre(p, toggle(ids.s7)); await press(p, 'laptop', toggle(ids.s7)); }
    assert.equal(await fold(ids.s7), 'open');
    await keyTo(p, ids.s7);
    await p.key('ArrowUp');
    assert.equal(await focused(), 'stack:' + ids.s7, 'Up from the first original message reaches its expanded header');
    await p.key(' ');
    await becomes(() => fold(ids.s7), 'folded', 'Space on the expanded header folds the first dossier');
    assert.equal(await focused(), 'stack:' + ids.s7, 'the folding chevron keeps the focus');
    await p.key('ArrowUp');
    assert.equal(await atPageHeader(), true, 'Up from the first dossier\'s folded chevron reaches the page header');
    assert.deepEqual(p.errors, []); await p.close();
  });

  await check('reading stacks long message headers scroll away inside their cards without moving the dossier tab', async () => {
    for (const device of Object.keys(DEVICES)) {
      const topic = 'stack-scrolling-headers-' + device;
      const body = Array.from({ length: 80 }, (_, i) => `Line ${i}: long words to read inside this message.`).join('\n');
      const ids = await seed(topic, [['root', { sender: other, join: true, addressees: [facts.actor], body }],
        ['reply', { sender: other, reply_to: 'root', addressees: [facts.actor], body }]]);
      const p = await open(topic, device, topic, ids.root);
      await keyTo(p, ids.root);
      await p.key('ArrowRight');
      await becomes(async () => (await look(p, ids, 'root')).fold, 'open', 'the full stack opens');
      for (const name of ['root', 'reply']) {
        const selector = card(ids[name]);
        await keyTo(p, ids[name]);
        await until(() => p.evaluate(`document.querySelector(${JSON.stringify(selector)}).dataset.whole === 'shown'`), name + ' loads the whole message');
        await centre(p, selector);
        const measure = () => p.evaluate(`(()=>{const c=document.querySelector(${JSON.stringify(selector)}),b=c.getBoundingClientRect(),t=c.closest('.reply-stack').querySelector('.stack-head').getBoundingClientRect();
          return {top:b.top,height:b.height,page:scrollY,scroll:c.scrollTop,author:c.querySelector('.message-author').getBoundingClientRect().bottom-b.top,
            reply:c.querySelector('.message-reply-to')?.getBoundingClientRect().bottom-b.top,tabTop:t.top,tabHeight:t.height,
            tabHit:c.closest('.reply-stack').querySelector('.stack-head').contains(document.elementFromPoint(t.left+t.width/2,t.top+t.height/2))}})()`);
        const before = await measure();
        const b = await p.box(selector), x = b.x + b.width / 2, y = Math.max(0,b.y) + Math.min(120, (Math.min(b.y+b.height,b.viewportHeight)-Math.max(0,b.y))/2);
        await p.send('Input.dispatchMouseEvent', { type: 'mouseWheel', x, y, deltaX: 0, deltaY: 240 });
        await until(async () => (await measure()).scroll > 100, name + ': the wheel scrolls inside the message');
        const after = await measure();
        assert.ok(after.author < 0, name + ': the author scrolls out of the card');
        if (name === 'reply') assert.ok(after.reply < 0, 'the reply context scrolls away too');
        assert.deepEqual([after.top,after.height,after.page,after.tabTop,after.tabHeight], [before.top,before.height,before.page,before.tabTop,before.tabHeight], 'card and dossier tab stay in place');
        if (name === 'root') assert.equal(after.tabHit, true, 'the dossier title is still visible and clickable');
        await shot(p, 'stack-headers-away-' + name + '-' + device);
      }
      // Folding and reopening must retain a usable card and title, including a loaded root.
      await keyTo(p, ids.root); await p.key('ArrowLeft');
      await becomes(async () => (await look(p, ids, 'root')).fold, 'folded', 'the loaded stack folds to latest plus unread');
      await p.key('ArrowRight');
      await becomes(async () => (await look(p, ids, 'root')).fold, 'open', 'the loaded stack reopens');
      assert.ok(await p.evaluate(`document.querySelector(${JSON.stringify(card(ids.root))}).clientHeight > 96`), 'the reopened root has its scrolling viewport');
      assert.deepEqual(p.errors, []); await p.close();
    }
  });

  await check('reading stacks plain arrows change the stack before leaving for a siderail, and leave writing alone', async () => {
    for (const device of Object.keys(DEVICES)) {
      const topic = 'stack-plain-arrows-' + device;
      const ids = await seed(topic, [['root', { sender: other, join: true, addressees: [facts.actor], body: 'A stack for the arrow keys.' }],
        ['one', { sender: other, reply_to: 'root', body: 'An earlier reply.', read: true }],
        ['two', { sender: other, reply_to: 'root', addressees: [facts.actor], body: 'The latest reply.' }]]);
      await control({ method: 'stack_act', sender: facts.actor, kind: 'message.star', message_id: ids.one, operation_id: topic + '-star', args: { starred: true } });
      const p = await open(topic, device, topic, ids.root);
      if (device === 'laptop') await until(() => p.evaluate("Boolean(document.querySelector('#things .things-sec[data-key=starred]:not([hidden])'))"), 'the desktop right rail has a Starred section');
      const state = async level => becomes(async () => (await look(p, ids, 'root')).fold, level, device + ': ' + level);
      const inPane = pane => p.evaluate(`Boolean(document.activeElement.closest(${JSON.stringify(pane)}))`);
      // A dossier has two states (item 394): latest plus unread, where it starts, and all of it.
      await keyTo(p, ids.root);
      await p.key('ArrowLeft');
      assert.equal((await look(p, ids, 'root')).fold, 'folded', 'Left at latest plus unread changes nothing in the stack');
      assert.equal(await inPane(device === 'laptop' ? '#outline' : '#messages'), true, 'Left at latest plus unread leaves only when the outline is on screen');
      if (device === 'laptop') await p.key('ArrowRight');
      assert.equal(await focusedOn(p), ids.root, 'returning keeps the same stack');
      await p.key('ArrowRight'); await state('open');
      await shot(p, 'plain-arrows-open-' + device);
      assert.equal(await inPane('#messages'), true, 'the opening press stays in the stack');
      await p.key('ArrowRight');
      assert.equal(await inPane(device === 'laptop' ? '#things' : '#messages'), true, device + ': another Right leaves only when the right rail is on screen');
      await keyTo(p, ids.two);
      await p.evaluate("document.getElementById('new-message').focus()");
      await p.key('ArrowDown');
      assert.equal(await p.evaluate("document.activeElement.matches('.stack-toggle') ? document.activeElement.closest('.reply-stack').dataset.stack : null"), ids.root, 'Down from the page header starts at the first open dossier, not its original message or a remembered reply');
      await keyTo(p, ids.two);
      await p.key('ArrowLeft'); await state('folded');
      assert.equal(await focusedOn(p), ids.two, 'a still-visible reply retains the keys');
      await p.key('ArrowRight'); await state('open');
      await keyTo(p, ids.one);
      await p.key('ArrowLeft'); await state('folded');
      assert.equal(await focusedOn(p), ids.root, 'folding away a read reply returns the keys to its header');
      // The chevron itself has the same arrows as a message, with no second pane move.
      for (let step = 0; step < 12 && !await p.evaluate("document.activeElement.matches('.stack-toggle')"); step++) await p.key('Tab');
      assert.equal(await p.evaluate("document.activeElement.matches('.stack-toggle')"), true, 'Tab reaches the chevron');
      await p.key('ArrowRight'); await state('open');
      assert.equal(await inPane('#messages'), true, 'the chevron opens in place');
      await p.key('z', 4); await state('folded');
      // A real cursor keeps plain arrows, even with a stack selected beforehand.
      await p.key('Enter', 4);
      await until(() => p.evaluate("document.activeElement?.id === 'inline-writing-body'"), 'new message writing has the cursor');
      await p.send('Input.insertText', { text: 'Keep this writing' });
      await p.key('ArrowLeft'); await p.key('ArrowRight');
      await state('folded');
      assert.equal(await p.evaluate("document.activeElement?.id"), 'inline-writing-body', 'writing keeps the cursor');
      assert.equal(await p.evaluate("document.activeElement.value"), 'Keep this writing', 'writing stays intact');
      assert.equal(await readerOn(p), null, 'no Reader opened');
      assert.deepEqual(p.errors, []); await p.close();
    }
  });

  await check('reading stacks use exactly two states, latest plus unread and all messages, by the chevron, the header, the arrows and the menu, with no header alone', async () => {
    for (const device of Object.keys(DEVICES)) {
      const topic = 'stack-chat-' + device;
      const ids = await seed(topic, [['root', { sender: other, join: true, addressees: [facts.actor], body: 'Can we lock the cabin for July 12?\nThe owner wants an answer by Friday.' }],
        ['one', { sender: other, reply_to: 'root', body: 'Older read reply.', read: true }],
        ['two', { sender: 'aim-ux', join: true, reply_to: 'root', body: 'Older read starred reply.', read: true }],
        ['three', { sender: other, reply_to: 'root', body: 'Another read reply.', read: true }],
        ['four', { sender: other, reply_to: 'root', body: 'Read reply four.', read: true }],
        ['five', { sender: other, reply_to: 'two', addressees: [facts.actor], body: 'Unread reply five.' }],
        ['six', { sender: other, reply_to: 'root', addressees: [facts.actor], body: 'Latest reply, also unread.' }]]);
      await control({ method: 'stack_act', sender: facts.actor, kind: 'message.star', message_id: ids.two, operation_id: topic + '-star', args: { starred: true } });
      const p = await open(topic, device, topic, ids.root);
      const toggle = `#messages .reply-stack[data-stack="${ids.root}"] > .stack-toggle`;
      const all = ['one','two','three','four','five','six'];
      const labels = { folded: 'Latest and unread replies; show all messages', open: 'All messages; show latest and unread replies' };
      const assertState = async (level, rows, full) => {
        await becomes(async () => { const v=await look(p,ids,'root');return {level:v.fold,rows:v.rows,full:v.full}; }, {level,rows,full}, device + ': ' + level);
        assert.equal(await p.evaluate(`document.querySelectorAll('#messages .stack-foot,#messages .stack-reply').length`),0,'no input-looking reply strip in any state');
        assert.equal(await p.evaluate(`document.querySelector(${JSON.stringify(toggle)}).dataset.state`),level);
        assert.equal(await p.evaluate(`document.querySelector(${JSON.stringify(toggle)}).getAttribute('aria-expanded')`),'true','the chevron always says the dossier is expanded: there is no closed state');
        assert.ok((await p.evaluate(`document.querySelector(${JSON.stringify(toggle)}).getAttribute('aria-label')`)).startsWith(labels[level]+': '),'the chevron names the state it shows and the one it moves to');
      };
      await assertState('folded', ['five','six'], false);
      assert.match((await look(p,ids,'root')).meta,/^6 replies .*2 new$/,'counts remain in the header');
      assert.equal(await p.evaluate(`getComputedStyle(document.querySelector('#messages .stack-fresh')).color`),await alertColour(p),'new count remains red');
      assert.equal(await p.evaluate(`document.querySelectorAll('#messages .stack-fold-line').length`),0,'no repeated fold bars');
      assert.equal(await p.evaluate(`(()=>{const t=document.querySelector(${JSON.stringify(toggle)}).getBoundingClientRect(),n=document.querySelector(${JSON.stringify(card(ids.root)+' .stack-name')}).getBoundingClientRect();return t.right<=n.left+1&&t.top<n.bottom&&t.bottom>n.top})()`),true,'chevron beside the title');
      await shot(p,'stack-chat-'+device);
      await centre(p,toggle); await press(p,device,toggle);
      await assertState('open',all,true);
      await shot(p,'stack-open-'+device);
      // The same native button goes back to latest plus unread: a second press never leaves the header alone.
      if(device==='laptop') {
        await p.evaluate(`document.querySelector(${JSON.stringify(card(ids.root))}).focus({preventScroll:true})`);
        // The original's links and reactions can precede the sibling button.
        for(let step=0;step<12&&!await p.evaluate(`document.activeElement.matches('.stack-toggle')`);step++) await p.key('Tab');
        assert.equal(await p.evaluate(`document.activeElement.matches('.stack-toggle')`),true,'Tab reaches chevron');
        // Space presses it; Return on a dossier edits its title (item 385).
        await p.key(' ');
      } else await press(p,device,toggle);
      await assertState('folded',['five','six'],false);
      const partial=await look(p,ids,'root');
      assert.equal(partial.rows.filter(x=>x==='six').length,1,'latest unread is never duplicated');
      assert.ok(!partial.rows.includes('two'),'a read star does not add a third kind of content');
      await press(p,device,toggle);
      await assertState('open',all,true);
      await press(p,device,toggle);
      await assertState('folded',['five','six'],false);
      // The header row is the same switch.
      await light(p,device,ids.root);
      await press(p,device,`${card(ids.root)} .stack-who`);
      await assertState('open',all,true);
      await press(p,device,`${card(ids.root)} .stack-who`);
      await assertState('folded',['five','six'],false);
      assert.equal(await readerOn(p),null,'the chevron and the header open no Reader');
      if(device==='laptop') {
        // The ⋯ menu offers only the step there is: Open at latest plus unread, Fold at all. (A phone's sheet
        // holds the same items behind Move or join…, as "reading stacks on a phone ⋯ opens the acts as a sheet …" checks.)
        const stackItems = async () => (await menuOf(p,device,ids.six)).filter(t=>/^(Open|Fold) its stack/.test(t));
        assert.deepEqual(await stackItems(),['Open its stack→'],'at latest plus unread, ⋯ offers Open its stack and no Fold');
        await choose(p,device,'Open its stack');
        await assertState('open',all,true);
        assert.equal(await said(p),'Original message and every reply shown');
        assert.equal(await readerOn(p),null,'choosing Open its stack opens no Reader');
        assert.deepEqual(await stackItems(),['Fold its stack←'],'at all messages, ⋯ offers Fold its stack and no Open');
        await choose(p,device,'Fold its stack');
        await assertState('folded',['five','six'],false);
        assert.equal(await said(p),'Latest and unread replies shown');
        assert.equal(await readerOn(p),null,'choosing Fold its stack opens no Reader');
        // → and ← step between the two; ← at latest plus unread leaves for the outline, the dossier as it was.
        await keyTo(p,ids.root);
        await p.key('ArrowRight');
        await assertState('open',all,true);
        await p.key('ArrowLeft');
        await assertState('folded',['five','six'],false);
        await p.key('ArrowLeft');
        await until(() => p.evaluate("Boolean(document.activeElement.closest('#outline'))"),'← at latest plus unread moves into the outline');
        await assertState('folded',['five','six'],false);
        await p.key('ArrowRight');
        assert.equal(await focusedOn(p),ids.root,'→ from the outline comes back to the same dossier');
        // ⌘Z puts back each step, and only those two states.
        await p.key('ArrowRight'); await assertState('open',all,true);
        await p.key('z',4); await assertState('folded',['five','six'],false);
      }
      assert.equal(await readerOn(p),null,'stack controls do not open a modal');
      assert.deepEqual(p.errors,[]); await p.close();
    }
  });

  await check('reading stacks keep their dossier through color changes, returning to the tab and arriving replies', async () => {
    for (const audience of ['person', 'agents']) {
      const topic = 'stack-color-refresh-' + audience, to = audience === 'person' ? facts.actor : 'aim-ux';
      const ids = await seed(topic, [...(audience === 'agents' ? [['join', { sender: to, join: true, body: 'Here to reply.', read: true }]] : []),
        ['root', { sender: other, join: true, addressees: [to], body: 'A dossier that stays a dossier.', read: true }],
        ['reply', { sender: other, reply_to: 'root', addressees: [to], body: 'A reply inside the folder.', read: true }]]);
      const p = await open(topic, 'laptop', topic, ids.root);
      const selector = card(ids.root), stack = `.reply-stack[data-stack="${ids.root}"]`;
      await p.evaluate(`(()=>{window.stackDamage=[];const c=document.querySelector(${JSON.stringify(selector)});
        new MutationObserver(()=>{if(c.isConnected&&c.closest('.reply-stack')&&!c.classList.contains('stack-head-card'))window.stackDamage.push(c.className)})
          .observe(c,{attributes:true,attributeFilter:['class']})})()`);
      if (audience === 'agents') {
        await until(() => p.evaluate(`document.querySelector(${JSON.stringify(stack)})?.dataset.compact === 'true'`), 'agent-only coordination starts as its compact row');
        await press(p, 'laptop', stack + ' > .stack-toggle');
        await until(async () => (await look(p, ids, 'root')).fold === 'folded', 'one press shows latest and unread');
      }
      await press(p, 'laptop', stack + ' > .stack-toggle');
      await until(async () => (await look(p, ids, 'root')).fold === 'open', 'the original shows');
      await p.point(selector + ' .author-name');
      await until(() => p.evaluate("Boolean(document.querySelector('.color-picker'))"), 'the color picker opens');
      await p.point('.color-picker [aria-label="rose"]');
      await until(() => p.evaluate(`!document.querySelector('.color-picker')&&document.querySelector(${JSON.stringify(selector)}).classList.contains('agent-rose')`), 'the chosen color is on the card');
      assert.deepEqual(await p.evaluate('window.stackDamage'), [], 'a color choice never erases the dossier');
      // Back to latest plus unread, then leave and return to the actual tab.
      await press(p, 'laptop', stack + ' > .stack-toggle');
      await until(async () => (await look(p, ids, 'root')).fold === 'folded', 'one press goes back to latest and unread');
      // The headless WebKit harness's bringToFront does not dispatch window
      // focus. Chrome proves that native trigger; both engines prove the
      // same color painter through an actual picker choice above.
      if (engine === 'chrome') {
        const elsewhere = await open(topic + '-elsewhere', 'laptop', topic, ids.root);
        await p.evaluate("(()=>{window.watchFor={read:'colors',words:'palette'};window.watched=false})()");
        await p.send('Page.bringToFront');
        await until(() => p.evaluate('window.watched'), 'returning to the tab read the colors again');
        assert.deepEqual(await p.evaluate('window.stackDamage'), [], 'a focus refresh never erases the dossier');
        await elsewhere.close();
      }
      for (let n = 0; n < 3; n++) {
        const id = (await control({ method: 'agent_message', operation_id: topic + '-live-' + n, topic_id: topic, source: 'topic',
          sender: other, addressees: [to], reply_to: ids.root, body: 'Arriving reply ' + n })).result.message_id;
        await until(() => p.evaluate(`Boolean(document.querySelector(${JSON.stringify(card(id))}))`), 'the arriving reply is drawn');
        const state = await look(p, ids, 'root');
        assert.equal(state.fold, 'folded'); assert.equal(state.full, false, 'arrival does not reveal the original');
        assert.equal(await p.evaluate(`getComputedStyle(document.querySelector(${JSON.stringify(selector + ' .stack-head')})).position`), 'absolute', 'the dossier tab keeps its position');
      }
      assert.deepEqual(await p.evaluate('window.stackDamage'), [], 'the class survives the complete refresh sequence');
      await shot(p, topic); assert.deepEqual(p.errors, []); await p.close();
    }
  });

  await check('reading stacks give only the current message or stack one strong highlight', async () => {
    for(const device of Object.keys(DEVICES)) for(const theme of ['light','dark']) {
      const topic='stack-one-highlight-'+device+'-'+theme;
      const ids=await seed(topic,[['root',{sender:other,join:true,addressees:[facts.actor],body:'One selected thing at a time.',read:true}],
        ['one',{sender:other,reply_to:'root',addressees:[facts.actor],body:'An unread reply with its own quiet cue.'}],
        ['two',{sender:facts.actor,reply_to:'root',addressees:[other],body:'My latest reply has a quiet border too.'}]]);
      await control({ method: 'stack_act', sender: facts.actor, kind: 'message.star', message_id: ids.one, operation_id: topic + '-star', args: { starred: true } });
      // My reply folded the first message for me (item 377); unfolded again, it reads whole when the stack is open.
      await control({ method: 'stack_act', sender: facts.actor, kind: 'message.fold', message_id: ids.root, operation_id: topic + '-unfold', args: { folded: false } });
      const p=await open(topic,device,topic,ids.root);
      await p.send('Emulation.setEmulatedMedia',{features:[{name:'prefers-color-scheme',value:theme}]});
      const strong=()=>p.evaluate(`(()=>{const probe=document.createElement('i');probe.style.color='var(--focus)';document.body.append(probe);const color=getComputedStyle(probe).color;probe.remove();
        return [...document.querySelectorAll('#messages .reply-stack,#messages .message-card,#messages .fold-line,#messages .stack-toggle')].filter(e=>{const b=e.getBoundingClientRect();if(!b.width||!b.height)return false;const s=getComputedStyle(e);return s.boxShadow.includes(color)||(s.outlineStyle!=='none'&&parseFloat(s.outlineWidth)>0&&s.outlineColor===color)||s.borderColor===color}).map(e=>e.classList.contains('reply-stack')?'stack:'+e.dataset.stack:e.dataset.id||e.parentElement.dataset.id||e.className)})()`);
      if(device==='laptop') await keyTo(p,ids.one); else await light(p,device,ids.one);
      await becomes(strong,[ids.one],device+' '+theme+': selected unread message alone has the ring');
      await light(p,device,ids.two);
      await becomes(strong,[ids.two],device+' '+theme+': pointer/tap moves the only ring, leaving earlier focus quiet');
      await shot(p,'one-highlight-message-'+device+'-'+theme);
      await light(p,device,ids.root);
      await becomes(strong,['stack:'+ids.root],device+' '+theme+': compact header selects just the stack');
      if(device==='laptop') {
        await p.evaluate(`document.querySelector(${JSON.stringify(card(ids.root))}).focus({preventScroll:true})`);
        await p.key('Tab');
        assert.equal(await p.evaluate(`document.activeElement.matches('.stack-toggle')`),true,'chevron has keyboard focus');
        await becomes(strong,['stack:'+ids.root],'control focus has one stack ring, with no leftover message ring');
      }
      await shot(p,'one-highlight-header-'+device+'-'+theme);
      await light(p,device,ids.two);
      await becomes(strong,[ids.two],'returning to a message takes the stack ring away');
      if (device === 'laptop') {
        await keyTo(p, ids.root);
        await p.key('ArrowLeft');
        assert.equal(await p.evaluate("Boolean(document.activeElement.closest('#outline'))"), true, 'Left at latest plus unread moves into the outline');
        await becomes(strong, [], 'the outline leaves no strong feed ring');
        // The pointer moving onto the dossier takes the only ring, and the keys' place with it (item 387): the outline lets go.
        await light(p, device, ids.root);
        await becomes(strong, ['stack:' + ids.root], 'hover takes the only ring');
        assert.equal(await focusedOn(p), ids.root, 'and the keys: they are on the dossier the pointer moved onto');
        await p.key('ArrowLeft');
        assert.equal(await p.evaluate("Boolean(document.activeElement.closest('#outline'))"), true, 'Left from there moves into the outline again');
        await becomes(strong, [], 'the keys in the outline clear the feed\'s ring');
        assert.notEqual(await p.evaluate('getComputedStyle(document.activeElement).outlineStyle'), 'none', 'the current rail row owns the ring');
        await p.key('ArrowRight');
        assert.equal(await focusedOn(p), ids.root, 'the feed remembers its place without a persistent highlight');
        await becomes(strong, ['stack:' + ids.root], 'returning to the feed restores its selection');
        await p.key('ArrowRight');
        await becomes(async () => (await look(p, ids, 'root')).fold, 'open', 'one → opens every message');
        await away(p);
        await becomes(strong, [], 'moving the pointer off the feed leaves no stale stack ring');
        await p.key('ArrowDown');
        await becomes(strong, [ids.one], 'keys in the feed resume from its focused message');
        await p.key('ArrowRight');
        assert.equal(await p.evaluate("Boolean(document.activeElement.closest('#things'))"), true, 'Right moves into the other rail');
        await becomes(strong, [], 'the right rail also owns the highlight alone');
        await light(p, device, ids.root);
        await becomes(strong, [ids.root], 'pointer selection takes over from the right rail too');
        assert.equal(await focusedOn(p), ids.root, 'and the keys with it');
        assert.equal(await p.evaluate("Boolean(document.querySelector('#things').contains(document.activeElement))"), false, 'the right rail has no stale focus');
        await p.key('ArrowRight');
        assert.equal(await p.evaluate("Boolean(document.activeElement.closest('#things'))"), true, 'Right on the open stack moves into the right rail again');
        await becomes(strong, [], 'the right rail\'s keys take the light back');
      }
      assert.deepEqual(p.errors,[]); await p.close();
    }
  });

  await check('reading stacks rename in place: Return saves it for everyone with who typed it, Esc cancels, ⌘Z puts it back, an empty name gives back the first line, and another\'s rename shows at once', async () => {
    const topic = 'stack-rename';
    const ids = await seed(topic, [['root', { sender: other, join: true, addressees: [facts.actor], body: 'Can we lock the cabin for the week of July 12 before Friday when the owner decides?' }],
      ['reply', { sender: other, reply_to: 'root', addressees: [facts.actor], body: 'A reply.', read: true }]]);
    const p = await open('stack-rename', 'laptop', topic, ids.root);
    const name = async () => (await look(p, ids, 'root')).name;
    await until(async () => (await name()) === 'Can we lock the cabin for the week of July 12 before Friday when the owner decides?', 'the name is the first line');
    const input = `#messages .reply-stack .stack-rename-input`;
    await p.point(`${card(ids.root)} .stack-name`);
    await until(() => p.evaluate(`document.activeElement?.matches?.(${JSON.stringify(input)})`), 'a press on the name opens it to rename, the cursor in it');
    await p.send('Input.insertText', { text: 'Cabin week' });
    await p.key('Escape');
    await until(async () => !await p.evaluate(`Boolean(document.querySelector(${JSON.stringify(input)}))`), 'Esc closes it');
    assert.equal((await actsOf(topic, ids.root))?.name ?? null, null, 'Esc saves nothing');
    await p.point(`${card(ids.root)} .stack-pen`);
    await until(() => p.evaluate(`document.activeElement?.matches?.(${JSON.stringify(input)})`), 'the ✎ opens it too');
    await p.send('Input.insertText', { text: 'Cabin week' });
    await p.key('Enter');
    await until(async () => (await name()) === 'Cabin week', 'Return saves: the row shows the new name');
    await until(async () => (await actsOf(topic, ids.root, other))?.name?.text === 'Cabin week', 'Core holds it for everyone, another reader included');
    assert.equal((await actsOf(topic, ids.root, other)).name.by, facts.actor, 'with who typed it');
    assert.equal(await focusedOn(p), ids.root, 'the head keeps the focus');
    await p.key('z', 4);
    await until(async () => (await actsOf(topic, ids.root))?.name === null && (await name()).startsWith('Can we lock'), '⌘Z puts the first line back, in Core');
    // Another reader renames it: the page shows it without a reload.
    await control({ method: 'stack_act', sender: other, kind: 'stack.name', message_id: ids.root, operation_id: 'stack-rename-other', args: { name: 'Their name' } });
    await until(async () => (await name()) === 'Their name', 'another reader\'s rename shows at once');
    assert.match(await p.evaluate(`document.querySelector(${JSON.stringify(card(ids.root) + ' .stack-name')}).title`), new RegExp(`Named by ${other}`));
    // Cleared, it is named by its first line again.
    await p.point(`${card(ids.root)} .stack-name`);
    await until(() => p.evaluate(`document.activeElement?.matches?.(${JSON.stringify(input)})`), 'open to rename again');
    await p.evaluate(`document.activeElement.select()`);
    await p.key('Backspace');
    await p.key('Enter');
    await until(async () => (await name()).startsWith('Can we lock') && (await actsOf(topic, ids.root, other))?.name === null, 'an empty name gives back the first line, for everyone');
    const ellipsis = await p.evaluate(`(n=>getComputedStyle(n).textOverflow)(document.querySelector(${JSON.stringify(card(ids.root) + ' .stack-name')}))`);
    assert.equal(ellipsis, 'ellipsis', 'a long name ends in …');
    // The keys leaving the name save it, as Return does: the field closes, and Core holds it for everyone.
    await p.point(`${card(ids.root)} .stack-name`);
    await until(() => p.evaluate(`document.activeElement?.matches?.(${JSON.stringify(input)})`), 'open to rename once more');
    await p.send('Input.insertText', { text: 'Boat keys' });
    await p.key('Tab');
    await until(async () => !await p.evaluate(`Boolean(document.querySelector(${JSON.stringify(input)}))`), 'the keys leaving the name close it');
    await until(async () => (await name()) === 'Boat keys' && (await actsOf(topic, ids.root, other))?.name?.text === 'Boat keys', 'and save it, for everyone');
    await shot(p, 'stack-rename');
    assert.deepEqual(p.errors, []);
    await p.close();
  });

  await check('reading stacks ⋯ Star is the reader\'s own: a starred reply never folds, the rail\'s Starred lists it and lands on it, and another reader sees no star', async () => {
    const topic = 'stack-star';
    const ids = await seed(topic, [['root', { sender: other, join: true, addressees: [facts.actor], body: 'The root of the stack.' }],
      ['one', { sender: other, reply_to: 'root', addressees: [facts.actor], body: 'Reply one, to star.' }],
      ['two', { sender: other, reply_to: 'root', addressees: [facts.actor], body: 'Reply two.' }],
      ['three', { sender: other, reply_to: 'root', addressees: [facts.actor], body: 'Reply three.', read: true }]]);
    const p = await open('stack-star', 'laptop', topic, ids.root);
    await becomes(async () => (await look(p, ids, 'root')).rows, ['three'], 'read through: the newest reply alone shows');
    await press(p, 'laptop', `#messages .reply-stack .stack-toggle`);
    await until(async () => (await look(p, ids, 'root')).fold === 'open', 'opened');
    const items = await menuOf(p, 'laptop', ids.one);
    assert.ok(items.includes('Star for me') && items.some(item => item.startsWith('Move its stack up')) && items.some(item => item.startsWith('Join the stack above')),
      `the menu offers Star and the stack's keys: ${items}`);
    assert.ok(items.some(item => item.endsWith('⌘↑')), 'each stack item names its keys');
    await choose(p, 'laptop', 'Star for me');
    await until(async () => (await actsOf(topic, ids.one))?.starred === true, 'Core holds the star');
    assert.equal((await actsOf(topic, ids.one, other))?.starred ?? false, false, 'another reader sees no star');
    assert.deepEqual(await starsOf(other), [], 'and lists none');
    assert.ok((await starsOf(facts.actor)).includes(ids.one), 'the reader\'s stars list it');
    // Latest plus unread shows no more for a star: the starred reply, read, folds away with the rest.
    await keyTo(p, ids.root);
    await p.key('ArrowLeft');
    await becomes(async () => (await look(p, ids, 'root')).rows, ['three'], 'latest plus unread leaves the starred read reply out too');
    assert.equal(await p.evaluate(`document.querySelector(${JSON.stringify(card(ids.one) + ' > .message-author > .card-star')})?.textContent`), '★', 'the starred reply shows its filled star after its author');
    // The rail's Starred: this topic's star, and a press lands on it.
    // Stars elsewhere (another check's) sit under Elsewhere, after this topic's.
    const row = `#things .things-sec[data-key=starred] .things-body > div > ul:first-child a.row`;
    await becomes(() => p.evaluate(`[...document.querySelectorAll(${JSON.stringify(row)})].map(e=>e.firstChild.textContent)`), ['Reply one, to star.'], 'the rail\'s Starred lists this topic\'s star first, by its words');
    assert.equal(await p.evaluate(`[...document.querySelectorAll('#things .things-sec')].filter(d=>!d.hidden)[0].dataset.key`), 'starred', 'Starred comes first');
    assert.equal(await p.evaluate(`document.querySelector('#things .things-sec[data-key=starred] .things-quiet').textContent`), 'Only you see your stars.');
    if (!await p.evaluate(`document.querySelector('#things .things-sec[data-key=starred]').open`)) await p.point('#things .things-sec[data-key=starred] > summary');
    await p.point(row);
    await until(async () => await focusedOn(p) === ids.one, 'a press on the star lands on its message');
    assert.equal(await readerOn(p), null, 'landing opens no Reader');
    await shot(p, 'stack-star');
    await menuOf(p, 'laptop', ids.one);
    await choose(p, 'laptop', 'Unstar');
    await until(async () => (await actsOf(topic, ids.one))?.starred === false, 'Unstar takes it back, in Core');
    await until(() => p.evaluate(`!document.querySelector(${JSON.stringify(row)})`), 'and the rail lists it no more');
    // Landing on a hidden star opens the stack; it remains open for Unstar.
    await until(async () => (await look(p, ids, 'root')).fold === 'open', 'the stack opened again');
    await menuOf(p, 'laptop', ids.one);
    await choose(p, 'laptop', 'Star for me');
    await until(() => p.evaluate(`Boolean(document.querySelector(${JSON.stringify(row)}))`), 'starred again, the rail lists it');
    const unstar = `#things .things-sec[data-key=starred] .things-body > div > ul:first-child .things-unstar`;
    await p.point(unstar);
    await until(async () => (await actsOf(topic, ids.one))?.starred === false, 'the rail\'s Unstar takes it off, in Core');
    await until(() => p.evaluate(`!document.querySelector(${JSON.stringify(row)})`), 'and the rail lists it no more');
    await until(() => p.evaluate(`document.querySelector(${JSON.stringify(card(ids.one))}).dataset.starred === 'false'`), 'the card shows no star');
    assert.deepEqual(p.errors, []);
    await p.close();
  });

  await check('reading stacks ⌘↑ ⌘↓ move a stack where the reader wants it, kept after a reload; a new reply does not lift it; another reader keeps newest on top', async () => {
    const topic = 'stack-move';
    const ids = await seed(topic, [['a', { sender: other, join: true, addressees: [facts.actor], body: 'Stack A.' }],
      ['b', { sender: other, addressees: [facts.actor], body: 'Stack B.' }],
      ['c', { sender: other, addressees: [facts.actor], body: 'Stack C.' }],
      ['c1', { sender: other, reply_to: 'c', addressees: [facts.actor], body: 'A reply to C.', read: true }]]);
    let p = await open('stack-move', 'laptop', topic, ids.a);
    await becomes(() => stacks(p, ids), ['c', 'b', 'a'], 'newest activity on top');
    await keyTo(p, ids.a);
    await p.key('ArrowUp', 4);
    await becomes(() => stacks(p, ids), ['c', 'a', 'b'], '⌘↑ moves A above B');
    assert.equal(await focusedOn(p), ids.a, 'the keys stay on A');
    assert.match(await said(p), /Moved up/, 'a screen reader hears the move');
    await until(async () => typeof (await actsOf(topic, ids.a))?.placed === 'number', 'Core holds the place');
    assert.equal((await actsOf(topic, ids.a, other))?.placed ?? null, null, 'another reader\'s order is untouched');
    assert.equal(await p.evaluate(`document.querySelector('#messages .reply-stack[data-stack=${JSON.stringify(ids.a)}] .stack-placed-words')?.textContent`), 'Placed here by you');
    await p.close();
    p = await open('stack-move-again', 'laptop', topic, ids.a);
    await becomes(() => stacks(p, ids), ['c', 'a', 'b'], 'after a reload the place holds');
    // A new reply to A does not lift it; a new stack lands on top.
    const late = (await control({ method: 'agent_message', operation_id: 'stack-move-late', topic_id: topic, source: 'topic', sender: other, reply_to: ids.a, addressees: [facts.actor], body: 'A late reply to A.' })).result.message_id;
    const fresh = (await control({ method: 'agent_message', operation_id: 'stack-move-fresh', topic_id: topic, source: 'topic', sender: other, addressees: [facts.actor], body: 'A new stack D.' })).result.message_id;
    const all = { ...ids, late, d: fresh };
    await becomes(() => stacks(p, all), ['d', 'c', 'a', 'b'], 'the late reply leaves A where it was placed; the new stack lands on top');
    await keyTo(p, ids.a);
    await p.key('ArrowDown', 4);
    await becomes(() => stacks(p, all), ['d', 'c', 'b', 'a'], '⌘↓ moves it down');
    await p.key('z', 4);
    await becomes(() => stacks(p, all), ['d', 'c', 'a', 'b'], '⌘Z puts it back');
    await p.point(`#messages .reply-stack[data-stack="${ids.a}"] .stack-unplace`);
    await becomes(() => stacks(p, all), ['d', 'a', 'c', 'b'], 'Let new replies move it: it goes where its newest reply puts it');
    await until(async () => (await actsOf(topic, ids.a))?.placed === null, 'and Core holds none');
    await shot(p, 'stack-move');
    assert.deepEqual(p.errors, []);
    await p.close();
  });

  await check('reading stacks the reader\'s own reply leaves its stack where it was, under their eyes and after a reload; anyone else\'s reply lifts it', async () => {
    const topic = 'stack-own-reply';
    const ids = await seed(topic, [['a', { sender: other, join: true, addressees: [facts.actor], body: 'Stack A.', read: true }],
      ['b', { sender: other, addressees: [facts.actor], body: 'Stack B.', read: true }],
      ['b1', { sender: other, reply_to: 'b', addressees: [facts.actor], body: 'A reply to B.', read: true }],
      ['c', { sender: other, addressees: [facts.actor], body: 'Stack C.', read: true }]]);
    let p = await open('stack-own-reply', 'laptop', topic, ids.c);
    await becomes(() => stacks(p, ids), ['c', 'b', 'a'], 'newest activity on top');
    const topOf = () => p.evaluate(`document.querySelector('#messages .reply-stack[data-stack=${JSON.stringify(ids.b)}]').getBoundingClientRect().top`);
    const before = await topOf();
    // The reader answers B's reply as a person does: Reply on its bar, the words, Send.
    const text = 'My own reply to B.';
    await light(p, 'laptop', ids.b1);
    await press(p, 'laptop', '.message-bar [data-act=reply]');
    await until(() => p.evaluate(`document.activeElement?.id === 'writing-body'`), 'the cursor is in the reply');
    await p.send('Input.insertText', { text });
    await press(p, 'laptop', '#send-reply');
    const mine = await until(async () => (await view('topic_messages', { topic_id: topic, direction: 'before', limit: 50 })).items
      .find(item => item.author_id === facts.actor && item.body === text)?.id, 'Core holds the reply');
    if (await readerOn(p) !== null) await closeReader(p, 'laptop');
    await until(() => p.evaluate(`document.querySelector(${JSON.stringify(card(mine))})?.closest('.reply-stack')?.dataset.stack === ${JSON.stringify(ids.b)} && window.fetchesOut === 0`),
      'the reply is drawn into B\'s stack');
    assert.deepEqual(await stacks(p, ids), ['c', 'b', 'a'], 'the reader\'s own reply leaves B where it was, under C');
    assert.equal(await topOf(), before, 'B\'s stack holds still on the page as the reply arrives');
    await p.close();
    p = await open('stack-own-reply-again', 'laptop', topic, ids.c);
    await becomes(() => stacks(p, ids), ['c', 'b', 'a'], 'after a reload B is still where it was');
    // A reply by anyone else lifts its stack, B's own included, the reader's reply in it notwithstanding.
    await control({ method: 'agent_message', operation_id: topic + '-to-a', topic_id: topic, source: 'topic', sender: other, reply_to: ids.a, addressees: [facts.actor], body: 'A reply to A.', read: true });
    await becomes(() => stacks(p, ids), ['a', 'c', 'b'], 'another\'s reply lifts A to the top');
    await control({ method: 'agent_message', operation_id: topic + '-to-b', topic_id: topic, source: 'topic', sender: other, reply_to: ids.b1, addressees: [facts.actor], body: 'Another reply in B.', read: true });
    await becomes(() => stacks(p, ids), ['b', 'a', 'c'], 'another\'s reply in B lifts B to the top');
    assert.deepEqual(p.errors, []);
    await p.close();
  });

  // Core's answers held at the network (the Chrome harness's interception), and let go one at a time.
  if (engine === 'chrome') await check('reading stacks quick acts and late answers: the page always draws the last act and ends where Core does, an answer read before an act puts nothing back, and a quick star then unstar shows unstarred', async () => {
    const topic = 'stack-quick';
    const ids = await seed(topic, [['a', { sender: other, join: true, addressees: [facts.actor], body: 'Stack A.' }],
      ['b', { sender: other, addressees: [facts.actor], body: 'Stack B.' }],
      ['c', { sender: other, addressees: [facts.actor], body: 'Stack C.' }],
      ['c1', { sender: other, reply_to: 'c', addressees: [facts.actor], body: 'A reply to C.', read: true }]]);
    let p = await open('stack-quick', 'laptop', topic, ids.a);
    await becomes(() => stacks(p, ids), ['c', 'b', 'a'], 'newest activity on top');
    const heldOf = test => p.held.filter(entry => test(entry.payload));
    const reads = payload => payload?.name === 'message_acts', places = payload => payload?.kind === 'stack.place', starsSent = payload => payload?.kind === 'message.star';
    // A star the reader gave A elsewhere, so every acts answer names A, with its place as it then stood.
    await control({ method: 'stack_act', sender: facts.actor, kind: 'message.star', message_id: ids.a, operation_id: topic + '-star-a', args: { starred: true } });
    await until(() => p.evaluate(`document.querySelector(${JSON.stringify(card(ids.a))}).dataset.starred === 'true'`), 'the star given elsewhere shows');
    // An acts read answered before the move below, and let go after Core confirmed it.
    p.intercept(payload => reads(payload));
    await control({ method: 'stack_act', sender: other, kind: 'stack.name', message_id: ids.c, operation_id: topic + '-name', args: { name: 'Named by them' } });
    const early = await until(() => heldOf(reads)[0], 'an acts read is answered and held');
    await keyTo(p, ids.a);
    await p.key('ArrowUp', 4);
    await becomes(() => stacks(p, ids), ['c', 'a', 'b'], '⌘↑ moves A above B');
    await until(async () => (await actsOf(topic, ids.a))?.place_revision === 1, 'Core holds the place');
    p.held.splice(p.held.indexOf(early), 1);
    await p.release(early);
    await until(async () => (await look(p, ids, 'c')).name === 'Named by them', 'the early answer is read: it names C');
    assert.deepEqual(await stacks(p, ids), ['c', 'a', 'b'], 'the early answer puts back none of the move it was read before');
    await p.key('ArrowDown', 4);
    await becomes(() => stacks(p, ids), ['c', 'b', 'a'], '⌘↓ after it moves A back below B');
    await until(async () => (await actsOf(topic, ids.a))?.place_revision === 2, 'Core takes the move sent after the early answer, fenced on the revision it confirmed');
    assert.deepEqual(p.errors, []);
    p.intercept(null);
    for (const entry of p.held.splice(0)) await p.release(entry);
    // ⌘↑ ⌘↓ ⌘Z at once, Core's answers held and let go one at a time, with the page drawn again between them.
    // Each act reaches Core as it is sent; only its answer is held, and the next is sent once it lands.
    p.intercept(payload => places(payload));
    await p.key('ArrowUp', 4); await p.key('ArrowDown', 4); await p.key('z', 4);
    await becomes(() => stacks(p, ids), ['c', 'a', 'b'], '⌘↑ ⌘↓ ⌘Z: A above B, as ⌘Z left it');
    for (const step of [1, 2]) {
      const answer = await until(() => heldOf(places)[0], `act ${step} reached Core`);
      const said = await p.response(answer.event);
      assert.equal(said?.status, 'committed', `Core takes act ${step}`);
      p.held.splice(p.held.indexOf(answer), 1);
      await p.release(answer);
      await until(() => heldOf(places)[0], `act ${step + 1} is sent once act ${step}'s answer lands`);
      await becomes(async () => (await actsOf(topic, ids.a))?.place_revision, 3 + step, `Core holds act ${step + 1}`);
    }
    // A reply arriving draws the page again while the last act is unanswered.
    const reply = (await control({ method: 'agent_message', operation_id: topic + '-reply', topic_id: topic, source: 'topic', sender: other, reply_to: ids.c, addressees: [facts.actor], body: 'Another reply to C.', read: true })).result.message_id;
    await until(() => p.evaluate(`Boolean(document.querySelector(${JSON.stringify(card(reply))}))`), 'the reply arrives');
    assert.deepEqual(await stacks(p, ids), ['c', 'a', 'b'], 'drawn again before the last answer, the page still shows the last act');
    const last = heldOf(places)[0];
    p.held.splice(p.held.indexOf(last), 1);
    p.intercept(null);
    await p.release(last);
    assert.equal((await actsOf(topic, ids.a))?.place_revision, 5, 'Core holds the last act');
    assert.deepEqual(await stacks(p, ids), ['c', 'a', 'b'], 'and the page still draws it');
    // A quick star then unstar, the first answer let go while the second is unanswered.
    p.intercept(payload => starsSent(payload));
    await menuOf(p, 'laptop', ids.b); await choose(p, 'laptop', 'Star for me');
    await menuOf(p, 'laptop', ids.b); await choose(p, 'laptop', 'Unstar');
    const starred = () => p.evaluate(`document.querySelector(${JSON.stringify(card(ids.b))}).dataset.starred`);
    await until(async () => await starred() === 'false', 'star then unstar: no star shows');
    const first = await until(() => heldOf(starsSent)[0], 'the star reached Core');
    p.held.splice(p.held.indexOf(first), 1);
    await p.release(first);
    const second = await until(() => heldOf(starsSent)[0], 'the unstar is sent after it');
    await control({ method: 'agent_message', operation_id: topic + '-reply-2', topic_id: topic, source: 'topic', sender: other, reply_to: ids.c, addressees: [facts.actor], body: 'A third reply to C.', read: true });
    await until(async () => (await look(p, ids, 'c')).meta?.startsWith('3 replies'), 'another reply draws the page again');
    assert.equal(await starred(), 'false', 'with the star confirmed and the unstar not, the card still shows no star');
    p.held.splice(p.held.indexOf(second), 1);
    p.intercept(null);
    await p.release(second);
    await until(async () => (await actsOf(topic, ids.b))?.star_revision === 2 && (await actsOf(topic, ids.b)).starred === false, 'Core holds the unstar');
    assert.equal(await starred(), 'false');
    assert.deepEqual(p.errors, []);
    await p.close();
    // A fresh page draws what Core holds: the same as the page did.
    p = await open('stack-quick-again', 'laptop', topic, ids.a);
    await becomes(() => stacks(p, ids), ['c', 'a', 'b'], 'after a reload the order is the one the page last drew');
    const starredNow = () => p.evaluate(`document.querySelector(${JSON.stringify(card(ids.b))}).dataset.starred`);
    assert.equal(await starredNow(), 'false');
    // A star refused before it reaches Core is drawn no more: the card shows what Core holds.
    await p.send('Fetch.enable', { patterns: [{ urlPattern: facts.origin + '/api/command', requestStage: 'Request' }, { urlPattern: facts.origin + '/api/view', requestStage: 'Response' }] });
    p.intercept(payload => starsSent(payload));
    await menuOf(p, 'laptop', ids.b); await choose(p, 'laptop', 'Star for me');
    await until(async () => await starredNow() === 'true', 'the star shows at once');
    const refused = await until(() => p.held.find(entry => starsSent(entry.payload)), 'the star is on its way');
    p.held.splice(p.held.indexOf(refused), 1);
    p.intercept(null);
    await p.send('Fetch.fulfillRequest', { requestId: refused.event.requestId, responseCode: 200, responseHeaders: [{ name: 'Content-Type', value: 'application/json' }],
      body: Buffer.from(JSON.stringify({ instance_id: facts.instance_id, status: 'rejected', error: { code: 'FORBIDDEN', message: 'Refused for this check.' } })).toString('base64') });
    await until(async () => await starredNow() === 'false', 'refused, the card shows no star');
    assert.equal((await actsOf(topic, ids.b))?.starred, false, 'and Core holds none');
    assert.deepEqual(p.errors, []);
    await p.close();
  });
  else observations.push({ name: 'stacks quick acts', engine, held: 'holds Core\'s answers with the Chrome harness\'s request interception, which Safari\'s harness does not offer' });

  await check('reading stacks ⇧⌘↑ joins a stack to the one above for everyone, its first message in view with a join line, and Split back out takes it out again', async () => {
    const topic = 'stack-join';
    const ids = await seed(topic, [['old', { sender: other, join: true, addressees: [facts.actor], body: 'The older stack.' }],
      ['oldReply', { sender: other, reply_to: 'old', addressees: [facts.actor], body: 'Its reply.' }],
      ['top', { sender: other, addressees: [facts.actor], body: 'The newer stack.' }],
      ['topReply', { sender: other, reply_to: 'top', addressees: [facts.actor], body: 'The newer stack\'s reply.', read: true }]]);
    const p = await open('stack-join', 'laptop', topic, ids.old);
    await becomes(() => stacks(p, ids), ['top', 'old'], 'two stacks');
    await keyTo(p, ids.old);
    await p.key('ArrowUp', 12);
    await becomes(() => stacks(p, ids), ['top'], '⇧⌘↑ joins the older stack into the one above');
    assert.match(await said(p), /Joined to the stack above/, 'a screen reader hears the join');
    // The join opens the stack it went into, with no → needed (item 354).
    await becomes(async () => (await look(p, ids, 'top')).rows, ['join: Joined from its own stack by You', 'old', 'oldReply', 'topReply'],
      'one run, oldest first: its first message in view with a join line, its reply, in view before, still in view, then the newer stack\'s reply');
    // The joined stack's first message heads nothing now: its head row goes, and it reads as a card.
    const headed = id => p.evaluate(`(()=>{const c=document.querySelector(${JSON.stringify(card(id))});return {row:Boolean(c.querySelector(':scope > .stack-head')),head:c.classList.contains('stack-head-card')}})()`);
    assert.deepEqual(await headed(ids.old), { row: false, head: false }, 'the joined stack\'s first message keeps no head row');
    assert.equal(await p.evaluate(`document.querySelectorAll('#messages .stack-replies .stack-head').length`), 0, 'no head row inside a stack\'s replies');
    await until(async () => (await actsOf(topic, ids.old, other))?.joined?.into === ids.top, 'Core holds the join for everyone');
    assert.equal((await actsOf(topic, ids.old, other)).joined.by, facts.actor, 'with who joined it');
    await p.point(`#messages .stack-join-line .stack-split`);
    await becomes(() => stacks(p, ids), ['top', 'old'], 'Split back out takes it out again');
    assert.deepEqual(await headed(ids.old), { row: true, head: true }, 'split back out, it heads its stack again, with its row');
    await until(async () => (await actsOf(topic, ids.old, other))?.joined === null, 'for everyone');
    await keyTo(p, ids.old);
    await p.key('ArrowUp', 12);
    await becomes(() => stacks(p, ids), ['top'], 'joined again');
    await p.key('z', 4);
    await becomes(() => stacks(p, ids), ['top', 'old'], '⌘Z undoes the join');
    await shot(p, 'stack-join');
    assert.deepEqual(p.errors, []);
    await p.close();
  });

  // Item 354, Tony's case: ⇧⌘↑ on an older stack whose replies were all read, into the newer message on its
  // own above it. Drawn as a stack is by default, the stack it went into showed its head as one row and only
  // its newest reply, with neither the joined message nor its join line, and the keys went to the head.
  await check('reading stacks a join you make shows where it went: the stack it went into open, its head and the joined messages under their join line, the keys on the message you acted on, in the window; a join made elsewhere opens nothing', async () => {
    // The stack headed by head as the page shows it, with the keys' message, whether the acted message and the
    // join line before the joined stack's first message (joined) are in the window, uncovered (a pixel's leeway
    // for an edge that scrolling to it leaves a fraction past the window), and where the page went since from,
    // what placeOf read before the join: 'kept' when the list's frame or the card still has not moved in the window
    // (a browser that keeps the page's place by a card the reader sees holds that card, and the frame moves by the
    // room a stack's tab takes above a message that was on its own; one that holds what is above the list holds
    // the frame, and the card moves by that room); else 'to the join line at the top' when the page moved just
    // until the line's top stood a tenth of the window below the window's top, or 'to the message at the bottom'
    // when it moved just until the acted message's bottom stood a tenth of the window above the window's bottom
    // (what the keys select comes into view with that room beyond it, docs/interaction.md); anything else is how
    // far it moved, which a join that scrolls only as far as it needs never does.
    const where = async (p, ids, head, acted, joined, still, from) => {
      const names = Object.fromEntries(Object.entries(ids).map(([key, id]) => [id, key]));
      const now = await placeOf(p, ids[still]);
      const at = await p.evaluate(`(()=>{const inWindow=e=>{if(!e)return false;const r=e.getBoundingClientRect();return r.height>0&&r.top>=-1&&r.bottom<=innerHeight+1&&e.contains(document.elementFromPoint(r.left+r.width/2,(r.top+r.bottom)/2))};
        const c=document.querySelector(${JSON.stringify(card(ids[acted]))}),line=[...document.querySelectorAll('#messages .stack-join-line')].find(n=>n.dataset.join===${JSON.stringify(ids[joined])});
        return {acted:inWindow(c),line:inWindow(line),lineTop:line?.getBoundingClientRect().top,bottom:innerHeight-document.querySelector(${JSON.stringify(entry(ids[acted]))}).getBoundingClientRect().bottom,tenth:innerHeight*0.1}})()`);
      const went = Math.abs(now.frame - from.frame) < 1 || Math.abs(now.card - from.card) < 1 ? 'kept'
        : Math.abs(at.lineTop - at.tenth) <= 1 ? 'to the join line at the top'
          : Math.abs(at.bottom - at.tenth) <= 1 ? 'to the message at the bottom'
            : `moved ${Math.round(from.frame - now.frame)}px`;
      const shown = await look(p, ids, head);
      return { fold: shown?.fold, full: shown?.full, rows: shown?.rows, keys: names[await focusedOn(p)] ?? null, acted: at.acted, line: at.line, went };
    };
    // Where the list's frame (what holds the list, which a join leaves where it is on the page) and a message's
    // card are in the window: their tops.
    const placeOf = (p, id) => p.evaluate(`({frame:document.querySelector('#messages').parentElement.getBoundingClientRect().top,card:document.querySelector(${JSON.stringify(card(id))}).getBoundingClientRect().top})`);
    // Scrolls the page so the acted message's card starts where a step needs it: its top just inside the window's
    // top ('top'), its bottom just inside the window's bottom ('bottom'), wholly above the window ('above') or wholly
    // below it ('below').
    const startAt = async (p, id, at) => {
      const r = await p.evaluate(`(()=>{const c=document.querySelector(${JSON.stringify(card(id))}),r=c.getBoundingClientRect(),at=${JSON.stringify(at)};
        scrollBy(0,{top:r.top-2,bottom:r.bottom-innerHeight+2,above:r.bottom+40,below:r.top-innerHeight-40}[at]);const n=c.getBoundingClientRect();return {top:n.top,bottom:n.bottom,h:innerHeight}})()`);
      const want = { top: [r.top, 2], bottom: [r.bottom, r.h - 2], above: [r.bottom, -40], below: [r.top, r.h + 40] }[at];
      assert.ok(Math.abs(want[0] - want[1]) < 1, `the page scrolls the card ${at}: ${JSON.stringify(r)}`);
    };
    const seeds = (older, newer, newerReplies) => [[older, { sender: other, join: true, addressees: [facts.actor], body: `Stack ${older}, older.`, read: true }],
      [older + '1', { sender: other, reply_to: older, addressees: [facts.actor], body: `A read reply to ${older}.`, read: true }],
      [older + '2', { sender: other, reply_to: older, addressees: [facts.actor], body: `Another read reply to ${older}.`, read: true }],
      [newer, { sender: other, addressees: [facts.actor], body: `Stack ${newer}, newer.`, read: true }],
      ...Array.from({ length: newerReplies }, (_, n) => [newer + (n + 1), { sender: other, reply_to: newer, addressees: [facts.actor], body: `A read reply to ${newer}.`, read: true }])];
    const line = 'join: Joined from its own stack by You';

    // ⇧⌘↑ into B on its own above A's stack: from A's first message, with A and the place its join line takes in
    // the window already; from A's last reply with its card at the window's top, wholly above the window, and wholly
    // below it; each undone by ⌘Z. Then the ⋯ menu's join, and Split back out.
    let topic = 'stack-join-shows-up';
    let ids = await seed(topic, seeds('a', 'b', 0));
    let p = await open(topic, 'laptop', topic, ids.a);
    await p.evaluate(`document.body.style.paddingTop = document.body.style.paddingBottom = '2000px'`);
    await becomes(() => stacks(p, ids), ['b', 'a'], 'B on its own above A\'s stack');
    await keyTo(p, ids.a);
    await p.evaluate(`document.querySelector(${JSON.stringify(card(ids.b))}).scrollIntoView({block:'start'})`);
    let from = await placeOf(p, ids.b);
    await p.key('ArrowUp', 12);
    await becomes(() => stacks(p, ids), ['b'], '⇧⌘↑ joins A\'s stack into B');
    await becomes(() => where(p, ids, 'b', 'a', 'a', 'b', from), { fold: 'open', full: true, rows: [line, 'a', 'a1', 'a2'], keys: 'a', acted: true, line: true, went: 'kept' },
      '⇧⌘↑: B open, its own message whole, then A under its join line with every reply; the keys on A, in the window with its join line, and the page where it was');
    await shot(p, 'stack-join-shows-up');
    await p.key('z', 4);
    await becomes(() => stacks(p, ids), ['b', 'a'], '⌘Z puts A\'s stack back');
    assert.equal(await focusedOn(p), ids.a, '⌘Z leaves the keys on A, as before');
    for (const [at, place, went] of [['top', 'at the window\'s top', 'to the join line at the top'], ['above', 'above the window', 'to the join line at the top'], ['below', 'below the window', 'to the message at the bottom']]) {
      await keyTo(p, ids.a2);
      await startAt(p, ids.a2, at);
      from = await placeOf(p, ids.b);
      await p.key('ArrowUp', 12);
      await becomes(() => stacks(p, ids), ['b'], `⇧⌘↑ from A's last reply ${place} joins A's stack into B`);
      await becomes(() => where(p, ids, 'b', 'a2', 'a', 'b', from), { fold: 'open', full: true, rows: [line, 'a', 'a1', 'a2'], keys: 'a2', acted: true, line: true, went },
        `⇧⌘↑ from A's last reply ${place}: the keys on it, in the window with A's join line, the page scrolled ${went}`);
      await p.key('z', 4);
      await becomes(() => stacks(p, ids), ['b', 'a'], `⌘Z puts A's stack back (from ${place})`);
    }
    await menuOf(p, 'laptop', ids.a2);
    from = await placeOf(p, ids.b);
    await choose(p, 'laptop', 'Join the stack above');
    await becomes(() => stacks(p, ids), ['b'], '⋯ Join the stack above joins A\'s stack into B');
    await becomes(() => where(p, ids, 'b', 'a2', 'a', 'b', from), { fold: 'open', full: true, rows: [line, 'a', 'a1', 'a2'], keys: 'a2', acted: true, line: true, went: 'kept' },
      '⋯: B open with A under its join line; the keys on the reply the menu was opened on, in the window with the join line');
    await p.point(`#messages .stack-join-line .stack-split`);
    await becomes(() => stacks(p, ids), ['b', 'a'], 'Split back out takes A out again');
    assert.deepEqual(p.errors, []);
    await p.close();

    // ⇧⌘↓ on a reply of D, into C's stack below it, read against E, on its own above both: with D's reply where
    // the page opened, where the join carries it into the window's bottom tenth, then with its card at the window's
    // bottom, where the join carries it below the window.
    const newest = ['e', { sender: other, addressees: [facts.actor], body: 'On its own, newest.', read: true }];
    topic = 'stack-join-shows-down';
    ids = await seed(topic, [...seeds('c', 'd', 2), newest]);
    p = await open(topic, 'laptop', topic, ids.c);
    await p.evaluate(`document.body.style.paddingTop = document.body.style.paddingBottom = '2000px'`);
    await becomes(() => stacks(p, ids), ['e', 'd', 'c'], 'D\'s stack above C\'s');
    await keyTo(p, ids.d2);
    await p.evaluate(`document.querySelector(${JSON.stringify(card(ids.e))}).scrollIntoView({block:'start'})`);
    from = await placeOf(p, ids.e);
    await p.key('ArrowDown', 12);
    await becomes(() => stacks(p, ids), ['e', 'c'], '⇧⌘↓ joins D\'s stack into C');
    await becomes(() => where(p, ids, 'c', 'd2', 'd', 'e', from), { fold: 'open', full: true, rows: ['c1', 'c2', line, 'd', 'd1', 'd2'], keys: 'd2', acted: true, line: true, went: 'to the message at the bottom' },
      '⇧⌘↓: C open, its own message whole and its replies, then D under its join line with every reply; the keys on D\'s reply, which the join carries into the window\'s bottom tenth, so the page scrolls just until a tenth shows below it, with the join line');
    await p.key('z', 4);
    await becomes(() => stacks(p, ids), ['e', 'd', 'c'], '⌘Z puts D\'s stack back');
    assert.equal((await look(p, ids, 'c')).fold, 'folded', '⌘Z puts back how far C was folded');
    await keyTo(p, ids.d2);
    await startAt(p, ids.d2, 'bottom');
    from = await placeOf(p, ids.e);
    await p.key('ArrowDown', 12);
    await becomes(() => stacks(p, ids), ['e', 'c'], '⇧⌘↓ from D\'s reply at the window\'s bottom joins D\'s stack into C');
    await becomes(() => where(p, ids, 'c', 'd2', 'd', 'e', from), { fold: 'open', full: true, rows: ['c1', 'c2', line, 'd', 'd1', 'd2'], keys: 'd2', acted: true, line: true, went: 'to the message at the bottom' },
      '⇧⌘↓ from D\'s reply at the window\'s bottom: the join carries it below the window, and the page scrolls down just until it shows, with its join line');
    assert.deepEqual(p.errors, []);
    await p.close();

    // On a phone, ⋯'s Move or join… sheet, from where the page opened: on the phone's shorter window the join
    // carries D's reply below it.
    topic = 'stack-join-shows-phone';
    ids = await seed(topic, [...seeds('c', 'd', 2), newest]);
    p = await open(topic, 'phone', topic, ids.c);
    await p.evaluate(`document.body.style.paddingBottom = '2000px'`);
    await becomes(() => stacks(p, ids), ['e', 'd', 'c'], 'phone: D\'s stack above C\'s');
    await menuOf(p, 'phone', ids.d2);
    await choose(p, 'phone', 'Move or join…');
    await until(() => p.evaluate(`[...document.querySelectorAll('.message-menu-list.menu-sheet button')].some(b=>b.firstChild.textContent==='Join the stack below')`), 'phone: the second sheet');
    from = await placeOf(p, ids.e);
    await choose(p, 'phone', 'Join the stack below');
    await becomes(() => stacks(p, ids), ['e', 'c'], 'phone: the sheet joins D\'s stack into C');
    await becomes(() => where(p, ids, 'c', 'd2', 'd', 'e', from), { fold: 'open', full: true, rows: ['c1', 'c2', line, 'd', 'd1', 'd2'], keys: 'd2', acted: true, line: true, went: 'to the message at the bottom' },
      'phone: C open with D under its join line; the keys on the reply the sheet was opened on, which the join carries below the phone\'s window, scrolled just into it with the join line');
    await shot(p, 'stack-join-shows-phone');
    assert.deepEqual(p.errors, []);
    await p.close();

    // A join someone else makes reaches the page as it always has: nothing opens under the reader.
    topic = 'stack-join-shows-theirs';
    ids = await seed(topic, seeds('a', 'b', 0));
    p = await open(topic, 'laptop', topic, ids.a);
    await becomes(() => stacks(p, ids), ['b', 'a'], 'B on its own above A\'s stack');
    await control({ method: 'stack_act', sender: other, kind: 'stack.join', message_id: ids.a, operation_id: topic + '-join', args: { into: ids.b } });
    await becomes(() => stacks(p, ids), ['b'], 'their join reaches the page');
    const theirs = await look(p, ids, 'b');
    assert.deepEqual({ fold: theirs.fold, full: theirs.full, rows: theirs.rows }, { fold: 'folded', full: false, rows: ['a2'] },
      'their join draws B as any stack is drawn: its head as one row and its newest reply');
    assert.deepEqual(p.errors, []);
    await p.close();
  });

  // Item 361, Tony's case: a join makes the two stacks one, so a reply to any message in it lands at the bottom.
  await check('reading stacks a join makes one stack: every message of both oldest first under its head, a new reply to the joined stack\'s message lands at the bottom, the keys and the phone read the same, and Split back out puts both back', async () => {
    const topic = 'stack-join-one';
    const ids = await seed(topic, [['a', { sender: other, join: true, addressees: [facts.actor], body: 'Stack A, older.', read: true }],
      ['b', { sender: other, addressees: [facts.actor], body: 'Stack B, newer.', read: true }],
      ['b1', { sender: other, reply_to: 'b', addressees: [facts.actor], body: 'A reply to B.', read: true }],
      ['a2', { sender: other, reply_to: 'a', addressees: [facts.actor], body: 'A reply to A.', read: true }],
      ['b3', { sender: other, reply_to: 'b', addressees: [facts.actor], body: 'Another reply to B.', read: true }]]);
    const line = 'join: Joined from its own stack by You';
    const toggle = `#messages .reply-stack[data-stack="${ids.b}"] > .stack-toggle`;
    const p = await open(topic, 'laptop', topic, ids.a);
    await becomes(() => stacks(p, ids), ['b', 'a'], 'B above A');
    await keyTo(p, ids.a);
    await p.key('ArrowUp', 12);
    await becomes(() => stacks(p, ids), ['b'], '⇧⌘↑ joins A into B');
    // Fully open, every message shows: a join you make that already opens it (release 58) needs no press.
    if ((await look(p, ids, 'b')).fold !== 'open') await press(p, 'laptop', toggle);
    await becomes(async () => (await look(p, ids, 'b')).rows, [line, 'a', 'b1', 'a2', 'b3'], 'B\'s head, then A under its join line, b1, a2, b3: one run by when each was written');
    const reply = async (name, to, body) => { ids[name] = (await control({ method: 'agent_message', operation_id: `${topic}-${name}`, topic_id: topic, source: 'topic', sender: other, reply_to: ids[to], addressees: [facts.actor], body })).result.message_id; };
    await reply('a6', 'a', 'A new reply to A, after the join.');
    await becomes(async () => (await look(p, ids, 'b')).rows, [line, 'a', 'b1', 'a2', 'b3', 'a6'], 'a new reply to the joined stack\'s message lands at the bottom');
    await reply('b7', 'b1', 'A new reply to B\'s reply.');
    await becomes(async () => (await look(p, ids, 'b')).rows, [line, 'a', 'b1', 'a2', 'b3', 'a6', 'b7'], 'and a new reply to B\'s own reply lands under it');
    assert.deepEqual(await stacks(p, ids), ['b'], 'still one stack');
    // The keys step down the stack in the same order.
    await keyTo(p, ids.b);
    const stepped = [];
    for (let n = 0; n < 6; n++) { await p.key('ArrowDown'); const at = await focusedOn(p); stepped.push(Object.keys(ids).find(key => ids[key] === at) ?? at); }
    assert.deepEqual(stepped, ['a', 'b1', 'a2', 'b3', 'a6', 'b7'], '↓ from B\'s head steps down the one run');
    await shot(p, 'stack-join-one');
    // The phone, opening the topic afresh, reads the same run.
    const q = await open(topic + '-phone', 'phone', topic, ids.b);
    await becomes(async () => (await look(q, ids, 'b')).fold, 'folded', 'phone: latest and unread first');
    await press(q, 'phone', toggle);
    await becomes(async () => (await look(q, ids, 'b')).rows, [line, 'a', 'b1', 'a2', 'b3', 'a6', 'b7'], 'phone: fully open, the same one run');
    assert.deepEqual(q.errors, []);
    await q.close();
    // Split back out: B as it was with its own replies, A on its own again.
    await p.point(`#messages .stack-join-line .stack-split`);
    await becomes(() => stacks(p, ids), ['b', 'a'], 'Split back out: two stacks again');
    await becomes(async () => (await look(p, ids, 'b')).rows, ['b1', 'b3', 'b7'], 'B keeps only its own replies, oldest first, and no join line');
    await until(async () => (await actsOf(topic, ids.a, other))?.joined === null, 'for everyone');
    assert.deepEqual(p.errors, []);
    await p.close();
  });

  await check('reading stacks a head shown as one row has no bar; shown whole, its bar sits below the head row, never across where the tab meets the stack', async () => {
    for (const device of Object.keys(DEVICES)) {
      const topic = 'stack-bar-' + device;
      const ids = await seed(topic, [['root', { sender: other, join: true, addressees: [facts.actor], body: 'Is the gate code still 4471?\nAsking before Saturday.', read: true }],
        ['one', { sender: other, reply_to: 'root', addressees: [facts.actor], body: 'It is.', read: true }]]);
      const p = await open(topic, device, topic, ids.root);
      // light() waits for the head to light with no bar.
      await light(p, device, ids.root);
      await press(p, device, `${card(ids.root)} .stack-who`);
      await until(async () => (await look(p, ids, 'root')).full, `${device}: a press on the head shows its full message`);
      await until(async () => await bar(p) !== null, `${device}: shown whole, the head has its bar`);
      const place = await p.evaluate(`(()=>{const b=document.querySelector('.message-bar').getBoundingClientRect(),c=document.querySelector(${JSON.stringify(card(ids.root))}),
        row=c.querySelector(':scope > .stack-head').getBoundingClientRect(),box=c.getBoundingClientRect();return {belowRow:b.top>=row.bottom,onCard:b.bottom<=box.bottom}})()`);
      assert.deepEqual(place, { belowRow: true, onCard: true }, `${device}: the bar sits below the head row, on the head's card`);
      // Hidden again by another press on its row, the head loses its bar while it stays lit.
      await press(p, device, `${card(ids.root)} .stack-who`);
      await until(async () => !(await look(p, ids, 'root')).full, `${device}: another press on the head row hides it`);
      await until(async () => (await lit(p)).includes(ids.root) && await bar(p) === null, `${device}: a head shown as one row again has no bar, and stays lit`);
      assert.deepEqual(p.errors, []);
      await p.close();
    }
  });

  // The head's row stands above the folder's top edge, over the head's own box, which has no height at
  // all while the head shows only its row (stack-look.css). The keys reaching the head from below
  // bring that row into view, not just the edge, whether the head shows as one row or whole.
  await check('reading stacks ↑ onto a stack\'s head from a reply at the top of the window brings the head\'s row into view, shown as one row or whole', async () => {
    const topic = 'stack-head-up';
    const ids = await seed(topic, [['before', { sender: other, join: true, addressees: [facts.actor], body: 'A message on its own, above the stack.', read: true }],
      ['root', { sender: other, addressees: [facts.actor], body: 'Which ferry do we take on Sunday?', read: true }],
      ['one', { sender: other, reply_to: 'root', addressees: [facts.actor], body: 'The 9:40, it has room for the car.', read: true }]]);
    const p = await open(topic, 'laptop', topic, ids.root);
    await p.evaluate(`document.body.style.paddingBottom = '2000px'`);
    for (const shown of ['one row', 'whole']) {
      if (shown === 'whole') {
        await press(p, 'laptop', `${card(ids.root)} .stack-who`);
        await until(async () => (await look(p, ids, 'root')).full, 'laptop: a press on the head shows it whole');
      }
      await keyTo(p, ids.one);
      // The reply at the very top of the window: its head's row is above it, out of view.
      await p.evaluate(`scrollBy(0, document.querySelector(${JSON.stringify(card(ids.one))}).getBoundingClientRect().top)`);
      await p.key('ArrowUp');
      await until(async () => await focusedOn(p) === ids.root, `laptop, head ${shown}: ↑ puts the keys on the head`);
      await twoFrames(p);
      const row = await p.evaluate(`(()=>{const r=document.querySelector(${JSON.stringify(card(ids.root))}).querySelector(':scope > .stack-head'),b=r.getBoundingClientRect(),who=r.querySelector('.stack-who'),w=who.getBoundingClientRect();
        const hit=document.elementFromPoint(w.left+w.width/2,w.top+w.height/2);return {top:b.top,bottom:b.bottom,window:innerHeight,shown:b.top>=0&&b.bottom<=innerHeight&&who.contains(hit)}})()`);
      assert.equal(row.shown, true, `laptop, head ${shown}: the head's row is in the window, uncovered: ${JSON.stringify(row)}`);
    }
    assert.deepEqual(p.errors, []);
    await p.close();
  });

  await check('reading stacks repeated arrows keep keyboard selection while the page scrolls under a stationary pointer', async () => {
    const topic = 'stack-stationary-pointer';
    const body = name => name + '\n' + Array.from({ length: 16 }, (_, n) => `Line ${n + 1} of a reply that makes the page scroll.`).join('\n');
    const ids = await seed(topic, [['old', { sender: other, join: true, addressees: [facts.actor], body: 'Older stack' }],
      ['oldOne', { sender: other, reply_to: 'old', addressees: [facts.actor], body: body('Old reply one') }],
      ['oldTwo', { sender: other, reply_to: 'old', addressees: [facts.actor], body: body('Old reply two') }],
      ['new', { sender: other, addressees: [facts.actor], body: 'Newer stack' }],
      ['newOne', { sender: other, reply_to: 'new', addressees: [facts.actor], body: body('New reply one') }],
      ['newTwo', { sender: other, reply_to: 'new', addressees: [facts.actor], body: body('New reply two') }]]);
    const p = await open(topic, 'laptop', topic, ids.old);
    try {
      await light(p, 'laptop', ids.oldTwo);
      const x = await p.evaluate(`document.querySelector('#messages').getBoundingClientRect().left + 100`);
      await p.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y: 750 });
      await p.evaluate(`document.querySelector(${JSON.stringify(card(ids.oldTwo))}).focus({preventScroll:true})`);
      const order = [ids.new, ids.newOne, ids.newTwo, ids.old, ids.oldOne, ids.oldTwo];
      for (let index = order.length - 2; index >= 0; --index) {
        const expected = order[index];
        await p.key('ArrowUp');
        await twoFrames(p);
        // WebKit can report a same-position pointermove after scrolling
        // settles, about 100ms later. Hold the selection at a person's pace.
        await new Promise(resolve => setTimeout(resolve, 400));
        assert.equal(await focusedOn(p), expected, 'Up moves one message upward: step ' + index);
        assert.ok((await lit(p)).includes(expected), 'scrolling under a stationary pointer does not steal the keyboard light');
      }
      // The page's existing key navigation can continue into its header;
      // another Up must not select a lower message again.
      await p.key('ArrowUp'); await twoFrames(p);
      await new Promise(resolve => setTimeout(resolve, 400));
      assert.equal(await p.evaluate("Boolean(document.activeElement.closest('.topic-header'))"), true, 'Up past the first message reaches the header');
      assert.deepEqual(await lit(p), [], 'the header owns the focus, with no stale feed selection');
      // The pointer can take over again as soon as it actually moves.
      const target = await p.evaluate(`(()=>{const e=document.elementFromPoint(${x},750);return e?.closest('[data-id]')?.dataset.id})()`);
      assert.ok(target && target !== order[0], 'a different message is under the resting pointer');
      await p.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: x + 1, y: 750 });
      await until(async () => (await lit(p)).includes(target), 'real mouse movement resumes hover selection');
      await shot(p, 'stack-stationary-pointer');
      assert.deepEqual(p.errors, []);
    } finally { await p.close(); }
  });

  await check('reading stacks the bar stays in the window while any of its card is, and scrolls away with it, in a stack or on its own', async () => {
    for (const device of Object.keys(DEVICES)) {
      const topic = 'stack-bar-away-' + device;
      const ids = await seed(topic, [['alone', { sender: other, join: true, addressees: [facts.actor], body: 'A message on its own, with no replies.', read: true }],
        ['root', { sender: other, addressees: [facts.actor], body: 'Who has the spare key?', read: true }],
        ['one', { sender: other, reply_to: 'root', addressees: [facts.actor], body: 'It hangs by the door.', read: true }]]);
      const p = await open(topic, device, topic, ids.root);
      // Room to scroll a card well above the window, whatever the window's height.
      await p.evaluate(`document.body.style.paddingBottom = '2000px'`);
      const barAt = () => p.evaluate(`(()=>{const b=document.querySelector('.message-bar');if(!b||b.hidden)return null;const r=b.getBoundingClientRect();return {top:r.top,bottom:r.bottom,height:r.height,window:innerHeight}})()`);
      // Scrolls so the card's bottom edge sits at y in the window.
      const bottomAt = (id, y) => p.evaluate(`scrollBy(0, document.querySelector(${JSON.stringify(card(id))}).getBoundingClientRect().bottom - (${y}))`);
      for (const [name, id] of [['a reply in a stack', ids.one], ['a card on its own', ids.alone]]) {
        assert.equal(await p.evaluate(`Boolean(document.querySelector(${JSON.stringify(card(id))}).closest('.reply-stack'))`), id === ids.one, `${device}: ${name} is ${id === ids.one ? '' : 'not '}in a stack`);
        await light(p, device, id);
        // Leave the pointer still: scrolling must preserve the selected card.
        const { height } = await barAt();
        // A little of the card's bottom still in the window: its bar is there too.
        await bottomAt(id, height + 10);
        let seen;
        await until(async () => { seen = await barAt(); return seen && seen.top >= 0 && seen.bottom <= height + 10 + 1; }, `${device}: ${name}'s bar stays in the window while its bottom does`)
          .catch(error => assert.fail(`${error.message}: ${JSON.stringify(seen)}`));
        // The card's bottom 150px above the window: its bar has gone with it, over nothing else on the page.
        await bottomAt(id, -150);
        await until(async () => { seen = await barAt(); return seen && seen.bottom <= 0; }, `${device}: ${name}'s bar scrolls away with it`)
          .catch(error => assert.fail(`${error.message}: ${JSON.stringify(seen)}`));
        assert.deepEqual((await lit(p)).includes(id), true, `${device}: ${name} stays lit, its bar out of the window with it`);
      }
      assert.deepEqual(p.errors, []);
      await p.close();
    }
  });

  // A reply lit under the pointer and then folded away in its stack has no
  // box for its bar to sit over: the light goes, and no bar is left lying
  // over the stack's fold line, where the pointer goes next to open it again.
  await check('reading stacks a lit reply its stack folds away takes its light and its bar with it, and its fold line can be pressed again', async () => {
    const topic = 'stack-bar-folded';
    const ids = await seed(topic, [['root', { sender: other, join: true, addressees: [facts.actor], body: 'Which room is the meeting in?', read: true }],
      ['one', { sender: other, reply_to: 'root', addressees: [facts.actor], body: 'Room four, upstairs.', read: true }],
      ['two', { sender: other, reply_to: 'root', addressees: [facts.actor], body: 'Room four is booked, so room six.', read: true }],
      ['three', { sender: other, reply_to: 'root', addressees: [facts.actor], body: 'Room six it is.', read: true }]]);
    const p = await open(topic, 'laptop', topic, ids.root);
    const line = `#messages .reply-stack[data-stack="${ids.root}"] .stack-toggle`;
    const shows = async () => (await look(p, ids, 'root')).rows.includes('one');
    await centre(p, line);
    await press(p, 'laptop', line);
    await until(shows, 'laptop: the fold line opens the earlier replies');
    await light(p, 'laptop', ids.one);
    // The pointer goes up to the fold line just above, which lights nothing, and folds the lit reply away.
    assert.deepEqual(await lit(p), [ids.one], 'laptop: the reply is lit');
    await press(p, 'laptop', line);
    await until(async () => !await shows(), 'laptop: the fold line folds the lit reply away');
    await twoFrames(p);
    assert.deepEqual({ lit: await lit(p), bar: await bar(p) }, { lit: [], bar: null }, 'laptop: the folded reply keeps no light, and no bar is left on the page');
    // The next press opens them all again.
    await press(p, 'laptop', line);
    await until(shows, 'laptop: the fold line, pressed again, opens the earlier replies');
    assert.deepEqual(p.errors, []);
    await p.close();
  });

  await check('reading stacks a reply arriving while a press is held is drawn once it ends, so nothing moves under the pointer and the press lands where it began', async () => {
    // A pointer's press: a finger held as long can turn into a long press, which ends the hold by its menu.
    const topic = 'stack-held-press';
    const ids = await seed(topic, [['root', { sender: other, join: true, addressees: [facts.actor], body: 'Who is bringing the ladder?', read: true }],
      ['one', { sender: other, reply_to: 'root', addressees: [facts.actor], body: 'I can bring it.', read: true }],
      ['later', { sender: other, addressees: [facts.actor], body: 'The van is parked out front.', read: true }]]);
    const p = await open(topic, 'laptop', topic, ids.later);
    await centre(p, words(ids.later));
    const at = await p.box(words(ids.later)), x = at.x + at.width / 2, y = at.y + at.height / 2;
    await p.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
    // The pointer resting on the message moved nothing: it is still under it.
    assert.equal((await p.box(words(ids.later))).y, at.y, 'laptop: the message pressed is where it was aimed at');
    await p.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
    const body = 'A new reply while the press is held.';
    await p.evaluate(`(window.watched = false, window.watchFor = ${JSON.stringify({ read: 'topic_messages', words: body })})`);
    const arrived = (await control({ method: 'agent_message', operation_id: `${topic}-held`, topic_id: topic, source: 'topic', sender: other, reply_to: ids.root, addressees: [facts.actor], body })).result.message_id;
    await until(() => p.evaluate('window.watched'), 'laptop: the page read the topic\'s new messages, the new reply among them, while the press is held');
    // Two frames on, a reply drawn at once would be on the page.
    await p.evaluate('new Promise(done=>requestAnimationFrame(()=>requestAnimationFrame(done)))');
    const held = await p.evaluate(`({top:document.querySelector(${JSON.stringify(words(ids.later))}).getBoundingClientRect().top,
      under:document.querySelector(${JSON.stringify(card(ids.later))}).contains(document.elementFromPoint(${x},${y})),drawn:Boolean(document.querySelector(${JSON.stringify(card(arrived))}))})`);
    await p.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
    assert.deepEqual(held, { top: at.y, under: true, drawn: false }, 'laptop: while the press is held, the new reply waits and the message pressed stays under the pointer');
    await until(async () => (await readerOn(p))?.startsWith('The van is parked out front.'), 'laptop: the click lands on the message pressed and opens it');
    await until(() => p.evaluate(`document.querySelector(${JSON.stringify(card(arrived))})?.closest('.reply-stack')?.dataset.stack === ${JSON.stringify(ids.root)}`), 'laptop: once the press ends the new reply is drawn into its stack');
    // The click above opens the Reader, which draws the page again whatever the release did. Held where
    // its click opens nothing, the reply that waited is drawn by the release alone: read at once after
    // it, with no wait, it is in its stack.
    await closeReader(p, 'laptop');
    const release = await holdOnTitle(p);
    const second = 'A second reply while a press is held.';
    await p.evaluate(`(window.watched = false, window.watchFor = ${JSON.stringify({ read: 'topic_messages', words: second })})`);
    const later = (await control({ method: 'agent_message', operation_id: `${topic}-held-2`, topic_id: topic, source: 'topic', sender: other, reply_to: ids.root, addressees: [facts.actor], body: second })).result.message_id;
    await until(() => p.evaluate('window.watched'), 'laptop: the page read the second reply while the press on the topic\'s name is held');
    await twoFrames(p);
    const stackOf = () => p.evaluate(`document.querySelector(${JSON.stringify(card(later))})?.closest('.reply-stack')?.dataset.stack ?? null`);
    assert.equal(await stackOf(), null, 'laptop: while the press is held, the second reply waits');
    await release();
    assert.equal(await stackOf(), ids.root, 'laptop: the moment the press ends, the reply that waited is drawn into its stack');
    assert.equal(await readerOn(p), null, 'laptop: and the press on the topic\'s name opened nothing');
    assert.deepEqual(p.errors, []);
    await p.close();
  });

  // An act's answer that changes the stacks waits under a held press as a
  // reply does, and is drawn the moment the press ends (stack-feed.mjs,
  // settled). A star Core refuses: the card shows it at once, and the
  // refusal takes it away. The page also reads the acts again on its next
  // pass; any such read is held until after the release, so only the
  // release can draw the refusal.
  if (engine === 'chrome') await check('reading stacks an act\'s answer landing while a press is held is drawn the moment it ends, and not before', async () => {
    const topic = 'stack-held-act';
    const ids = await seed(topic, [['a', { sender: other, join: true, addressees: [facts.actor], body: 'Stack A.', read: true }],
      ['b', { sender: other, addressees: [facts.actor], body: 'Stack B.', read: true }]]);
    const p = await open(topic, 'laptop', topic, ids.a);
    const starred = () => p.evaluate(`document.querySelector(${JSON.stringify(card(ids.b))}).dataset.starred`);
    const starsSent = payload => payload?.kind === 'message.star', reads = payload => payload?.name === 'message_acts';
    await p.send('Fetch.enable', { patterns: [{ urlPattern: facts.origin + '/api/command', requestStage: 'Request' }, { urlPattern: facts.origin + '/api/view', requestStage: 'Response' }] });
    p.intercept(payload => starsSent(payload) || reads(payload));
    await menuOf(p, 'laptop', ids.b); await choose(p, 'laptop', 'Star for me');
    await until(async () => await starred() === 'true', 'laptop: the star shows at once');
    const refused = await until(() => p.held.find(entry => starsSent(entry.payload)), 'laptop: the star is on its way');
    p.held.splice(p.held.indexOf(refused), 1);
    const release = await holdOnTitle(p);
    await p.send('Fetch.fulfillRequest', { requestId: refused.event.requestId, responseCode: 200, responseHeaders: [{ name: 'Content-Type', value: 'application/json' }],
      body: Buffer.from(JSON.stringify({ instance_id: facts.instance_id, status: 'rejected', error: { code: 'FORBIDDEN', message: 'Refused for this check.' } })).toString('base64') });
    // The page says the refusal once the stacks were told of it.
    await until(() => p.evaluate(`document.getElementById('app-status').textContent.includes('Refused for this check.')`), 'laptop: the refusal is heard while the press is held');
    await twoFrames(p);
    assert.equal(await starred(), 'true', 'laptop: while the press is held, the refusal waits and the card still shows the star');
    await release();
    assert.equal(await starred(), 'false', 'laptop: the moment the press ends, the refusal is drawn: no star');
    p.intercept(null);
    for (const entry of p.held.splice(0)) await p.release(entry);
    assert.equal(await readerOn(p), null, 'laptop: and the press on the topic\'s name opened nothing');
    assert.notEqual((await actsOf(topic, ids.b))?.starred, true, 'Core holds no star');
    await until(async () => await starred() === 'false', 'laptop: the acts read again agree: no star');
    assert.deepEqual(p.errors, []);
    await p.close();
  });
  else observations.push({ name: 'stacks an act\'s answer under a held press', engine, held: 'holds Core\'s answers with the Chrome harness\'s request interception, which Safari\'s harness does not offer' });

  // A press that ends with no pointerup ends all the same, or every repaint
  // after it would wait for the next tap (press-hold.mjs). Chrome's own input
  // gives each ending: a finger that scrolls (pointercancel), ⌃ and a press
  // on a Mac (its context menu), and the window losing the focus (blur, as
  // the focus going into a frame gives it). Safari's engine in this harness
  // has no finger drag, no ⌃-press menu and no blur of its own to give.
  if (engine === 'chrome') await check('reading stacks a press ends however it ends: a finger that scrolls, a context menu from the press, the window losing the focus; and what arrives is drawn without another press', async () => {
    const arrives = async (p, topic, root, label, device) => {
      const body = `A reply after ${label}.`;
      const id = (await control({ method: 'agent_message', operation_id: `${topic}-${label.replace(/\W+/g, '-')}`, topic_id: topic, source: 'topic', sender: other, reply_to: root, addressees: [facts.actor], body })).result.message_id;
      await until(() => p.evaluate(`document.querySelector(${JSON.stringify(card(id))})?.closest('.reply-stack')?.dataset.stack === ${JSON.stringify(root)}`), `${device}: after ${label}, a reply arriving is drawn into its stack with no other press`);
    };
    // Each press and how it ended, as the page heard them.
    const HEARD_ENDS = `(()=>{window.pressEvents=[];for(const n of ['pointerdown','pointerup','pointercancel','contextmenu'])document.addEventListener(n,e=>pressEvents.push(n),true);addEventListener('blur',()=>pressEvents.push('blur'))})()`;
    const ended = p => p.evaluate('window.pressEvents.join()');

    // A phone: a finger that scrolls the page. The browser takes the touch for
    // the scroll and cancels the pointer; no pointerup comes.
    {
      const topic = 'stack-press-scroll';
      const said = [['root', { sender: other, join: true, addressees: [facts.actor], body: 'Who has the spare paddle?', read: true }],
        ['one', { sender: other, reply_to: 'root', addressees: [facts.actor], body: 'It is in the shed.', read: true }]];
      for (let n = 0; n < 12; n++) said.push([`later${n}`, { sender: other, addressees: [facts.actor], body: `Another stack, ${n}, long enough to fill the phone's window as a topic does.`, read: true }]);
      const ids = await seed(topic, said);
      const p = await open(topic, 'phone', topic, ids.root);
      await p.evaluate(HEARD_ENDS);
      const scrolled = () => p.evaluate('Math.round(document.scrollingElement.scrollTop)');
      const before = await scrolled();
      await p.send('Input.synthesizeScrollGesture', { x: 195, y: 650, yDistance: -300, speed: 800, gestureSourceType: 'touch' });
      await until(async () => (await scrolled()) !== before, 'phone: the finger scrolled the page');
      assert.deepEqual(await ended(p), 'pointerdown,pointercancel', 'phone: the finger went down and the scroll cancelled it, with no pointerup');
      await arrives(p, topic, ids.root, 'a finger that scrolls', 'phone');
      assert.deepEqual(p.errors, []);
      await p.close();
    }
    // A laptop: ⌃ and a press on a message opens its menu (a Mac's context
    // menu from the primary button), and the window losing the focus while a
    // press is held. In each, the button is still down when the reply arrives.
    {
      const topic = 'stack-press-ends';
      const ids = await seed(topic, [['root', { sender: other, join: true, addressees: [facts.actor], body: 'When does the ferry leave?', read: true }],
        ['one', { sender: other, reply_to: 'root', addressees: [facts.actor], body: 'At nine.', read: true }],
        ['later', { sender: other, addressees: [facts.actor], body: 'The tickets are booked.', read: true }]]);
      const p = await open(topic, 'laptop', topic, ids.later);
      await p.send('Emulation.setFocusEmulationEnabled', { enabled: true });
      await p.evaluate(HEARD_ENDS);
      await centre(p, words(ids.later));
      const at = await p.box(words(ids.later)), x = at.x + at.width / 2, y = at.y + at.height / 2;
      await p.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
      await p.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1, modifiers: 2 });
      await until(() => p.evaluate(`Boolean(document.querySelector('.message-menu-list'))`), 'laptop: ⌃ and a press opens the message\'s menu');
      assert.equal(await ended(p), 'pointerdown,contextmenu', 'laptop: the press opened the context menu, its button still down');
      await arrives(p, topic, ids.root, 'a context menu from the press', 'laptop');
      await p.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1, modifiers: 2 });
      await p.key('Escape');
      await until(() => p.evaluate(`!document.querySelector('.message-menu-list')`), 'laptop: Esc closes the menu');
      // The window loses the focus with the press held: the focus goes into a frame on the page.
      await p.evaluate(`(()=>{const f=document.createElement('iframe');f.id='press-elsewhere';f.srcdoc='<p>elsewhere</p>';f.style.cssText='position:fixed;right:0;bottom:0;width:40px;height:40px';document.body.append(f);return new Promise(done=>f.onload=done)})()`);
      await p.evaluate('window.pressEvents=[]');
      await centre(p, words(ids.later));
      const again = await p.box(words(ids.later)), ax = again.x + again.width / 2, ay = again.y + again.height / 2;
      await p.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: ax, y: ay });
      await p.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: ax, y: ay, button: 'left', clickCount: 1 });
      await p.evaluate(`document.getElementById('press-elsewhere').contentWindow.focus()`);
      await until(async () => (await ended(p)) === 'pointerdown,blur', 'laptop: the window lost the focus, the press still held');
      await arrives(p, topic, ids.root, 'the window losing the focus', 'laptop');
      await p.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: ax, y: ay, button: 'left', clickCount: 1 });
      await p.evaluate(`document.getElementById('press-elsewhere').remove()`);
      assert.deepEqual(p.errors, []);
      await p.close();
    }
  });

  await check('reading stacks the one New line sits under the lowest stack holding anything new, never inside one', async () => {
    const topic = 'stack-new-line';
    const ids = await seed(topic, [['old', { sender: other, join: true, addressees: [facts.actor], body: 'An old stack, read.' }],
      ['middle', { sender: other, addressees: [facts.actor], body: 'A stack in the middle, read.', read: true }],
      ['oldReply', { sender: other, reply_to: 'old', addressees: [facts.actor], body: 'A new reply in the old stack.' }],
      ['top', { sender: other, addressees: [facts.actor], body: 'The newest stack, new.' }]]);
    const p = await open('stack-new-line', 'laptop', topic, ids.old);
    await becomes(() => stacks(p, ids), ['top', 'old', 'middle'], 'the old stack rises with its new reply');
    const line = () => p.evaluate(`(()=>{const l=document.querySelector('#messages > [data-line=new]');return l?{under:l.previousElementSibling?.dataset.stack??l.previousElementSibling?.dataset.id,lines:document.querySelectorAll('#messages [data-line=new]').length,inside:Boolean(document.querySelector('.reply-stack [data-line]'))}:null})()`);
    await becomes(line, { under: ids.old, lines: 1, inside: false }, 'one New line, under the stack holding the new reply, none inside it');
    assert.deepEqual(p.errors, []);
    await p.close();
  });

  await check('reading stacks the Reader\'s ↑ and ↓ follow the page: down a stack to its newer replies, then on to the stack below', async () => {
    for (const device of Object.keys(DEVICES)) {
      const topic = 'stack-reader-' + device;
      const ids = await seed(topic, [['below', { sender: other, join: true, addressees: [facts.actor], body: 'The stack below.' }],
        ['root', { sender: other, addressees: [facts.actor], body: 'The stack on top.' }],
        ['one', { sender: other, reply_to: 'root', addressees: [facts.actor], body: 'Reply one.' }],
        ['two', { sender: other, reply_to: 'root', addressees: [facts.actor], body: 'Reply two.', read: true }]]);
      const p = await open('stack-reader-' + device, device, topic, ids.root);
      await openReader(p, device, ids.two, 'Reply two.');
      const step = async (where, starts, message) => {
        const button = device === 'phone' ? `.reader-end .end-step:${where === 'above' ? 'first' : 'last'}-child` : where === 'above' ? '#next-message' : '#previous-message';
        if (device === 'phone') await p.evaluate(`document.querySelector(${JSON.stringify(button)}).scrollIntoView({block:'center'})`);
        await until(() => p.evaluate(`!document.querySelector(${JSON.stringify(button)}).disabled`), `${device}: ${message}: its button can be pressed`);
        await press(p, device, button);
        await until(async () => (await readerOn(p))?.startsWith(starts), `${device}: ${message}`);
      };
      if (device === 'phone') assert.deepEqual(await p.evaluate(`[...document.querySelectorAll('.reader-end .end-step')].map(b=>b.dataset.words)`), ['↑ Previous', '↓ Next'], 'phone: the line says ↑ Previous · ↓ Next');
      else assert.deepEqual(await p.evaluate(`['next-message','previous-message'].map(id=>document.getElementById(id).getAttribute('aria-label'))`), ['Previous message (above)', 'Next message (below)']);
      await step('above', 'Reply one.', '↑ is the reply above, the older one');
      await step('above', 'The stack on top.', '↑ again is the stack\'s first message');
      await step('below', 'Reply one.', '↓ goes down the stack');
      await step('below', 'Reply two.', '↓ to the newer reply');
      await step('below', 'The stack below.', '↓ from the stack\'s last reply is the stack below');
      await closeReader(p, device);
      assert.deepEqual(p.errors, []);
      await p.close();
    }
  });

  await check('reading stacks the stack keys are inert in writing, even with a message lit', async () => {
    const topic = 'stack-inert';
    const ids = await seed(topic, [['a', { sender: other, join: true, addressees: [facts.actor], body: 'Stack A.' }], ['b', { sender: other, addressees: [facts.actor], body: 'Stack B.' }]]);
    const p = await open('stack-inert', 'laptop', topic, ids.a);
    // A lit message (the keys were on it a moment ago), then the cursor goes into the writing.
    await keyTo(p, ids.a);
    await p.point('#inline-writing-body');
    assert.deepEqual(await lit(p), [], 'writing takes the light off A');
    assert.equal(await p.evaluate("document.querySelector('#messages').dataset.lastMessage"), ids.a, 'the feed remembers A without highlighting it');
    await until(() => p.evaluate(`document.activeElement?.id === 'inline-writing-body'`), 'the cursor is in the topic\'s writing');
    await p.send('Input.insertText', { text: 'Writing a reply' });
    for (const [key, modifiers] of [['ArrowUp', 4], ['ArrowDown', 4], ['ArrowUp', 12], ['ArrowLeft', 4], ['ArrowLeft', 0], ['ArrowRight', 0], ['z', 4]]) await p.key(key, modifiers);
    assert.deepEqual(await stacks(p, ids), ['b', 'a'], 'no stack moved or joined');
    assert.equal(await actsOf(topic, ids.a), null, 'and nothing was recorded');
    assert.equal(await p.evaluate(`document.activeElement?.id`), 'inline-writing-body', 'the writing keeps the cursor');
    assert.deepEqual(p.errors, []);
    await p.close();
  });

  await check('reading stacks on a phone ⋯ opens the acts as a sheet, and Move or join… opens the stack\'s moves in a second sheet', async () => {
    const topic = 'stack-sheet';
    const ids = await seed(topic, [['a', { sender: other, join: true, addressees: [facts.actor], body: 'Stack A.' }], ['b', { sender: other, addressees: [facts.actor], body: 'Stack B.' }],
      ['b1', { sender: other, reply_to: 'b', addressees: [facts.actor], body: 'A reply to B.', read: true }]]);
    const p = await open('stack-sheet', 'phone', topic, ids.a);
    const items = await menuOf(p, 'phone', ids.b1);
    assert.equal(await p.evaluate(`document.querySelector('.message-menu-list').classList.contains('menu-sheet')`), true, 'phone: a sheet from the bottom');
    assert.ok(items.includes('Star for me') && items.includes('Fold') && items.at(-1) === 'Move or join…', `phone: the acts, then Move or join…: ${items}`);
    await choose(p, 'phone', 'Move or join…');
    await until(() => p.evaluate(`[...document.querySelectorAll('.message-menu-list.menu-sheet button')].some(b=>b.firstChild.textContent==='Move its stack down')`), 'phone: a second sheet with the stack\'s moves');
    await shot(p, 'stack-sheet-phone');
    await choose(p, 'phone', 'Move its stack down');
    await becomes(() => stacks(p, ids), ['a', 'b'], 'phone: the stack moved down');
    await until(async () => typeof (await actsOf(topic, ids.b))?.placed === 'number', 'phone: Core holds the place');
    assert.deepEqual(p.errors, []);
    await p.close();
  });

  await check('reading stacks a thumbs-up on a reply deals with its stack: coming back, its earlier unread replies fold', async () => {
    const topic = 'stack-dealt';
    const ids = await seed(topic, [['root', { sender: other, join: true, addressees: [facts.actor], body: 'The root.' }],
      ['one', { sender: other, reply_to: 'root', addressees: [facts.actor], body: 'Reply one, unread.' }],
      ['two', { sender: other, reply_to: 'root', addressees: [facts.actor], body: 'Reply two, unread.' }],
      ['three', { sender: other, reply_to: 'root', addressees: [facts.actor], body: 'Reply three, unread.' }]]);
    let p = await open('stack-dealt', 'laptop', topic, ids.root);
    await becomes(async () => (await look(p, ids, 'root')).rows, ['one', 'two', 'three'], 'unread replies all in view');
    await light(p, 'laptop', ids.two);
    await p.point('.message-bar [data-act=thumb]');
    await until(async () => (await actsOf(topic, ids.two))?.dealt === true, 'the thumbs-up deals with the stack up to it, in Core');
    assert.deepEqual((await look(p, ids, 'root')).rows, ['one', 'two', 'three'], 'nothing folds while it is in front of the person');
    await p.close();
    // Coming back, the replies dealt with fold; three, newer, stays.
    p = await open('stack-dealt-back', 'laptop', topic, ids.root);
    await becomes(async () => (await look(p, ids, 'root')).rows, ['three'], 'coming back, the replies up to the thumbs-up fold, read');
    assert.deepEqual(p.errors, []);
    await p.close();
  });

  await check('reading stacks the reader\'s own reply in a stack deals with it: coming back, it folds to that reply', async () => {
    const topic = 'stack-replied';
    const ids = await seed(topic, [['root', { sender: other, join: true, addressees: [facts.actor], body: 'The root.' }],
      ['one', { sender: other, reply_to: 'root', addressees: [facts.actor], body: 'Reply one, unread.' }],
      ['two', { sender: other, reply_to: 'root', addressees: [facts.actor], body: 'Reply two, unread.' }]]);
    let p = await open('stack-replied', 'laptop', topic, ids.root);
    await becomes(async () => (await look(p, ids, 'root')).rows, ['one', 'two'], 'both unread replies in view');
    ids.mine = (await control({ method: 'agent_message', operation_id: topic + '-mine', topic_id: topic, source: 'topic', sender: facts.actor,
      reply_to: ids.two, addressees: [other], body: 'My answer to reply two.' })).result.message_id;
    await becomes(async () => (await look(p, ids, 'root')).rows, ['one', 'two', 'mine'], 'the reply shows in its stack, nothing folding under the person\'s eyes');
    await until(async () => (await actsOf(topic, ids.mine))?.dealt === true, 'the reply deals with the stack up to it, in Core');
    // Another message of the reader's own, not in a stack, deals with nothing.
    const alone = (await control({ method: 'agent_message', operation_id: topic + '-alone', topic_id: topic, source: 'topic', sender: facts.actor, addressees: [other], body: 'A new message of mine.' })).result.message_id;
    await until(() => p.evaluate(`Boolean(document.querySelector(${JSON.stringify(card(alone))}))`), 'the message on its own shows');
    assert.deepEqual(await p.evaluate(`window.sent.filter(kind => kind === 'message.deal').length`), 1, 'a message of the reader\'s own starting no stack sends no deal');
    assert.equal((await actsOf(topic, alone))?.dealt ?? false, false, 'and Core holds none');
    assert.deepEqual(p.errors, []);
    await p.close();
    p = await open('stack-replied-back', 'laptop', topic, ids.root);
    await becomes(async () => (await look(p, ids, 'root')).rows, ['mine'], 'coming back, the stack folds to the reader\'s reply');
    assert.deepEqual(p.errors, []);
    await p.close();
  });

  await check('reading stacks a sent reply stays visible when its answer arrives', async () => {
    const topic = 'stack-sent-answer';
    const ids = await seed(topic, [['root', { sender: other, join: true, addressees: [facts.actor], body: 'The root.', read: true }],
      ['one', { sender: other, reply_to: 'root', addressees: [facts.actor], body: 'A question I am reading.' }]]);
    const p = await open(topic, 'laptop', topic, ids.root);
    await becomes(async () => (await look(p, ids, 'root')).rows, ['one'], 'the unread question is visible');
    ids.mine = (await control({ method: 'agent_message', operation_id: topic + '-mine', topic_id: topic, source: 'topic', sender: facts.actor,
      reply_to: ids.one, addressees: [other], body: 'My reply must stay while I read the answer.' })).result.message_id;
    await becomes(async () => (await look(p, ids, 'root')).rows, ['one', 'mine'], 'my sent reply joins the question');
    await until(async () => (await actsOf(topic, ids.mine))?.dealt === true, 'my reply is dealt with before the answer arrives');
    ids.answer = (await control({ method: 'agent_message', operation_id: topic + '-answer', topic_id: topic, source: 'topic', sender: other,
      reply_to: ids.mine, addressees: [facts.actor], body: 'The answer to your reply.' })).result.message_id;
    await becomes(async () => (await look(p, ids, 'root')).rows, ['one', 'mine', 'answer'], 'the answer does not hide my intervening reply');
    assert.equal((await look(p, ids, 'root')).full, false, 'retaining my reply does not expand the original');
    await keyTo(p, ids.root); await p.key('ArrowRight');
    await becomes(async () => (await look(p, ids, 'root')).fold, 'open', 'I explicitly open the whole stack');
    await p.key('ArrowLeft');
    await becomes(async () => (await look(p, ids, 'root')).rows, ['answer'], 'folding to latest/unread again clears the temporary retention');
    assert.deepEqual(p.errors, []);
    await p.close();
  });

  // Only the reader's own reply is held so: another person's reply, read as it
  // arrives, is replaced by a newer one as before; and coming back to the tab
  // with the stack off screen lets go of the reader's reply, as a later visit
  // never had it.
  await check('reading stacks a sent reply is held alone: another reader\'s read reply arriving is replaced as before, and coming back with the stack off screen lets go', async () => {
    const topic = 'stack-sent-held-alone';
    // Messages after the stack's own, enough that it is off screen with the page scrolled to its end.
    const later = Array.from({ length: 8 }, (_, n) => [`later${n}`, { sender: other, addressees: [facts.actor], read: true,
      body: `An earlier message, number ${n}, long enough to take room on the page. `.repeat(6) }]);
    const ids = await seed(topic, [['root', { sender: other, join: true, addressees: [facts.actor], body: 'The root.', read: true }], ...later,
      ['one', { sender: other, reply_to: 'root', addressees: [facts.actor], body: 'One, read.', read: true }]]);
    const p = await open(topic, 'laptop', topic, ids.root);
    const rows = async () => (await look(p, ids, 'root')).rows;
    await becomes(rows, ['one'], 'the read latest shows');
    ids.mine = (await control({ method: 'agent_message', operation_id: topic + '-mine', topic_id: topic, source: 'topic', sender: facts.actor,
      reply_to: ids.one, addressees: [other], body: 'Mine.' })).result.message_id;
    await becomes(rows, ['mine'], 'my reply replaces the read latest');
    await until(async () => (await actsOf(topic, ids.mine))?.dealt === true, 'my reply is dealt with');
    ids.x = (await control({ method: 'agent_message', operation_id: topic + '-x', topic_id: topic, source: 'topic', sender: other,
      reply_to: ids.root, addressees: [facts.actor], body: 'X, read on arrival.', read: true })).result.message_id;
    await becomes(rows, ['mine', 'x'], 'my reply stays beside the newer reply');
    ids.y = (await control({ method: 'agent_message', operation_id: topic + '-y', topic_id: topic, source: 'topic', sender: other,
      reply_to: ids.root, addressees: [facts.actor], body: 'Y, read on arrival.', read: true })).result.message_id;
    await becomes(rows, ['mine', 'y'], 'another reader\'s read reply is replaced by a newer one, not held as mine is');
    // The reader scrolls to the end of the page, where the stack is off screen, and comes back to the tab.
    const offScreen = () => p.evaluate(`(()=>{const b=document.querySelector(${JSON.stringify(card(ids.root))}).closest('.reply-stack').getBoundingClientRect();return b.bottom<=0||b.top>=innerHeight})()`);
    if (engine === 'chrome') {
      const elsewhere = await open(topic + '-elsewhere', 'laptop', topic, ids.root);
      await until(() => p.evaluate("document.visibilityState === 'hidden'"), 'with another tab in front, the page is hidden');
      await p.evaluate('scrollTo(0,document.documentElement.scrollHeight)');
      assert.equal(await offScreen(), true, 'at the end of the page the stack is off screen');
      await p.send('Page.bringToFront');
      await until(() => p.evaluate("document.visibilityState === 'visible'"), 'the page is shown again');
      await elsewhere.close();
    } else {
      // Safari's headless harness never hides a page behind another, so it says the page is shown again itself.
      await p.evaluate('scrollTo(0,document.documentElement.scrollHeight)');
      assert.equal(await offScreen(), true, 'at the end of the page the stack is off screen');
      await p.evaluate("document.dispatchEvent(new Event('visibilitychange'))");
    }
    await becomes(rows, ['y'], 'coming back with the stack off screen lets go of my reply');
    assert.deepEqual(p.errors, []);
    await p.close();
    const q = await open(topic + '-back', 'laptop', topic, ids.root);
    await becomes(async () => (await look(q, ids, 'root')).rows, ['y'], 'a later visit does not hold my reply');
    assert.deepEqual(q.errors, []);
    await q.close();
  });

  // A reply of the reader's own from another device, dealt with there, that
  // arrives in one answer with its answer: the first draw with them in holds it.
  await check('reading stacks a sent reply arriving already dealt with, in one update with its answer, shows from the first draw', async () => {
    const topic = 'stack-sent-elsewhere';
    const ids = await seed(topic, [['root', { sender: other, join: true, addressees: [facts.actor], body: 'The root.', read: true }],
      ['one', { sender: other, reply_to: 'root', addressees: [facts.actor], body: 'One, read.', read: true }]]);
    const p = await open(topic, 'laptop', topic, ids.root);
    await becomes(async () => (await look(p, ids, 'root')).rows, ['one'], 'the read latest shows');
    await p.evaluate("window.waitView = 'topic_messages'");
    ids.mine = (await control({ method: 'agent_message', operation_id: topic + '-mine', topic_id: topic, source: 'topic', sender: facts.actor,
      reply_to: ids.one, addressees: [other], body: 'Mine, from my phone.' })).result.message_id;
    await control({ method: 'stack_act', sender: facts.actor, kind: 'message.deal', message_id: ids.mine, operation_id: topic + '-deal', args: { dealt: true } });
    ids.answer = (await control({ method: 'agent_message', operation_id: topic + '-answer', topic_id: topic, source: 'topic', sender: other,
      reply_to: ids.mine, addressees: [facts.actor], body: 'The answer, read on arrival.', read: true })).result.message_id;
    await until(() => p.evaluate('window.waitingViews.length > 0'), 'the page went to read the new messages, and its read waits');
    // What the stack showed the first time the answer was drawn in it.
    const names = Object.fromEntries(Object.entries(ids).map(([key, id]) => [id, key]));
    await p.evaluate(`(()=>{window.firstRows=null;const names=${JSON.stringify(names)},shown=e=>e.getClientRects().length>0;
      new MutationObserver((_,o)=>{const c=document.querySelector(${JSON.stringify(card(ids.answer))}),s=c?.closest('.reply-stack');if(!s||!shown(c))return;
        window.firstRows=[...s.querySelector(':scope > .stack-replies').children].filter(shown).map(e=>names[e.dataset.id]??e.className);o.disconnect()})
        .observe(document.getElementById('messages'),{childList:true,subtree:true,attributes:true})})()`);
    await p.evaluate('window.letViews()');
    await until(() => p.evaluate('window.firstRows !== null'), 'the answer is drawn in the stack');
    assert.deepEqual(await p.evaluate('window.firstRows'), ['mine', 'answer'], 'the first draw with them in shows my reply beside its answer');
    await becomes(async () => (await look(p, ids, 'root')).rows, ['mine', 'answer'], 'and it stays');
    assert.equal(await p.evaluate(`window.sent.filter(kind => kind === 'message.deal').length`), 0, 'a reply dealt with elsewhere sends no deal from here');
    assert.deepEqual(p.errors, []);
    await p.close();
  });

  await check('reading stacks a reply arriving replaces the read latest in the partial view', async () => {
    const topic = 'stack-arrive';
    const ids = await seed(topic, [['root', { sender: other, join: true, addressees: [facts.actor], body: 'The root.' }],
      ['one', { sender: other, reply_to: 'root', addressees: [facts.actor], body: 'Reply one, read.', read: true }],
      ['two', { sender: other, reply_to: 'root', addressees: [facts.actor], body: 'Reply two, read.', read: true }]]);
    let p = await open('stack-arrive', 'laptop', topic, ids.root);
    await becomes(async () => (await look(p, ids, 'root')).rows, ['two'], 'the newest reply shows, the earlier one folded');
    ids.three = (await control({ method: 'agent_message', operation_id: 'stack-arrive-three', topic_id: topic, source: 'topic', sender: other,
      reply_to: ids.root, addressees: [facts.actor], body: 'Reply three, read.', read: true })).result.message_id;
    await becomes(async () => (await look(p, ids, 'root')).rows, ['three'], 'the new latest replaces the older read latest');
    await p.close();
    p = await open('stack-arrive-back', 'laptop', topic, ids.root);
    await becomes(async () => (await look(p, ids, 'root')).rows, ['three'], 'coming back, two folds with the earlier reply');
    assert.deepEqual(p.errors, []);
    await p.close();
  });

  await check('reading stacks a link in a message to a folded reply opens its stack and lands on it', async () => {
    const topic = 'stack-link';
    const ids = await seed(topic, [['root', { sender: other, join: true, addressees: [facts.actor], body: 'The root.' }],
      ['one', { sender: other, reply_to: 'root', addressees: [facts.actor], body: 'Reply one, folded away.' }],
      ['two', { sender: other, reply_to: 'root', addressees: [facts.actor], body: 'Reply two.', read: true }]]);
    const linking = (await control({ method: 'agent_message', operation_id: 'stack-link-to', topic_id: topic, source: 'topic', sender: other, addressees: [facts.actor],
      body: `See ${facts.origin}/?topic=${topic}&message=${ids.one} for that.`, read: true })).result.message_id;
    const p = await open('stack-link', 'laptop', topic, ids.root);
    await becomes(async () => (await look(p, ids, 'root')).rows, ['two'], 'reply one is folded away');
    await centre(p, `${card(linking)} a.words-link`);
    await p.point(`${card(linking)} a.words-link`);
    await until(async () => (await look(p, ids, 'root')).fold === 'open' && await p.evaluate(`document.querySelector(${JSON.stringify(card(ids.one))}).getClientRects().length>0`), 'the link opens its stack, the reply in view');
    await until(async () => (await readerOn(p))?.startsWith('Reply one'), 'and opens it in the Reader, as a link to a message here does');
    await closeReader(p, 'laptop');
    assert.deepEqual(p.errors, []);
    await p.close();
  });

  await check('reading stacks a card a join or a move carries keeps its table scrolled sideways', async () => {
    const topic = 'stack-carry';
    const table = ['| ' + Array.from({ length: 14 }, (_, i) => `Column ${i} heading`).join(' | ') + ' |', '|' + ' --- |'.repeat(14),
      '| ' + Array.from({ length: 14 }, (_, i) => `cell ${i} with words`).join(' | ') + ' |'].join('\n');
    const ids = await seed(topic, [['a', { sender: other, join: true, addressees: [facts.actor], body: 'Stack A, older.' }],
      ['a1', { sender: other, reply_to: 'a', addressees: [facts.actor], body: 'A reply to A.', read: true }],
      ['b', { sender: other, addressees: [facts.actor], body: 'Stack B, newer.', read: true }],
      ['b1', { sender: other, reply_to: 'b', addressees: [facts.actor], body: 'A wide table, unread:\n\n' + table }],
      ['c', { sender: other, addressees: [facts.actor], body: 'A message on its own, the newest.', read: true }]]);
    const p = await open('stack-carry', 'laptop', topic, ids.a);
    await becomes(() => stacks(p, ids), ['c', 'b', 'a'], 'three stacks');
    const wrap = `${card(ids.b1)} .md-table-wrap`;
    const scrolled = () => p.evaluate(`(()=>{const w=document.querySelector(${JSON.stringify(wrap)});return {left:w.scrollLeft,fade:w.classList.contains('md-more-left'),over:w.scrollWidth-w.clientWidth}})()`);
    await until(async () => (await scrolled()).over > 100, 'the table is wider than its card');
    await centre(p, wrap);
    const b = await p.box(wrap);
    await p.send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: b.x + b.width / 2, y: b.y + b.height / 2, deltaX: 300, deltaY: 0 });
    await until(async () => (await scrolled()).left > 100 && (await scrolled()).fade, 'the wheel scrolls the table sideways; its left edge fades');
    const left = (await scrolled()).left;
    // ⇧⌘↓ on B joins it into A: B's cards move into A's stack.
    await keyTo(p, ids.b);
    await p.key('ArrowDown', 12);
    await becomes(() => stacks(p, ids), ['c', 'a'], 'B joined into A');
    await until(async () => (await look(p, ids, 'a')).rows.includes('b1'), 'the table\'s card shows in A');
    assert.equal((await scrolled()).left, left, 'carried into A by the join, the table keeps its sideways scroll');
    assert.equal((await scrolled()).fade, true, 'and its left fade');
    // ⌘↑ on A moves its stack, every card in it, above C.
    await keyTo(p, ids.a);
    await p.key('ArrowUp', 4);
    await becomes(() => stacks(p, ids), ['a', 'c'], '⌘↑ moves A above C');
    assert.equal((await scrolled()).left, left, 'moved with its stack, the table keeps its sideways scroll');
    await shot(p, 'stack-carry');
    assert.deepEqual(p.errors, []);
    await p.close();
  });

  // A message the reader folds stays folded for them (Core's message.fold), on every device and after a reload,
  // in every state of its stack, until they unfold it; nobody else's view changes.
  // Its row's words leave out the 👍 on it (item 390), which thumbOn reads.
  const folded = (p, id) => p.evaluate(`(()=>{const c=document.querySelector(${JSON.stringify(card(id))}),r=c?.querySelector(':scope > .message-folded'),shown=e=>Boolean(e&&e.getClientRects().length);
    const t=r?.querySelector(':scope > .folded-thumb');
    return {row:c?.dataset.folded==='true'&&shown(r),words:shown(r)?[...r.childNodes].filter(n=>n!==t).map(n=>n.textContent).join(''):null,whole:shown(c?.querySelector(':scope > .message-preview'))}})()`);
  // The 👍 on a message's folded row: what it says, whether it is pressed, its name and tooltip, and its size.
  const thumbOn = (p, id) => p.evaluate(`(()=>{const t=document.querySelector(${JSON.stringify(card(id) + ' > .message-folded > .folded-thumb')});if(!t||!t.getClientRects().length)return null;
    const b=t.getBoundingClientRect();return {text:t.textContent,pressed:t.getAttribute('aria-pressed'),label:t.getAttribute('aria-label'),title:t.title,role:t.getAttribute('role'),width:Math.round(b.width),height:Math.round(b.height)}})()`);
  const foldOf = async (topic, id, reader = facts.actor) => (await actsOf(topic, id, reader))?.folded ?? false;
  await check('reading stacks a message folded in a fully open stack stays folded for the reader through every state, a reload and another device, and unfolds by a press or ⌘Z', async () => {
    const topic = 'stack-fold';
    const ids = await seed(topic, [['root', { sender: other, join: true, addressees: [facts.actor], body: 'The root of the folder.' }],
      ['one', { sender: other, reply_to: 'root', addressees: [facts.actor], body: 'Reply one, to open by a link.', read: true }],
      ['two', { sender: other, reply_to: 'root', addressees: [facts.actor], body: 'Reply two, to fold.\nIts second line.', read: true }],
      ['three', { sender: other, reply_to: 'root', addressees: [facts.actor], body: 'Reply three.', read: true }]]);
    const openAll = async (p, device) => {
      await becomes(async () => (await look(p, ids, 'root')).fold, 'folded', `${device}: latest and unread first`);
      await press(p, device, '#messages .reply-stack .stack-toggle');
      await becomes(async () => (await look(p, ids, 'root')).rows, ['one', 'two', 'three'], `${device}: fully open, every reply shows`);
    };
    let p = await open('stack-fold', 'laptop', topic, ids.root);
    await openAll(p, 'laptop');
    // Another device of the reader's, open on the same topic.
    const q = await open('stack-fold-other-device', 'laptop', topic, ids.root);
    await openAll(q, 'laptop');
    // A page behind another reads what it missed when it is shown: the other device is looked at in front, then put back.
    const onOther = async (read, want, message) => {
      await q.send('Page.bringToFront');
      await becomes(read, want, message);
      await p.send('Page.bringToFront');
    };
    await p.send('Page.bringToFront');
    const items = await menuOf(p, 'laptop', ids.two);
    assert.ok(items.includes('Fold') && !items.includes('Unfold'), `⋯ offers Fold: ${items}`);
    await choose(p, 'laptop', 'Fold');
    await until(async () => await foldOf(topic, ids.two), 'Core holds the fold');
    assert.equal(await foldOf(topic, ids.two, other), false, 'another reader\'s view of it is unchanged');
    await becomes(() => folded(p, ids.two), { row: true, words: `${other}Reply two, to foldFolded`, whole: false },
      'in the fully open stack it is one row: who wrote it, its first words and Folded');
    assert.deepEqual((await look(p, ids, 'root')).rows, ['one', 'two', 'three'], 'in its place; nothing else folds');
    assert.equal((await look(p, ids, 'root')).fold, 'open', 'the stack stays fully open');
    await onOther(async () => (await folded(q, ids.two)).row, true, 'the other device shows it folded');
    // ⌘Z undoes the fold just made, in Core and on both devices.
    assert.equal(await focusedOn(p), ids.two, 'the folded message keeps the focus');
    await p.key('z', 4);
    await until(async () => !await foldOf(topic, ids.two), '⌘Z unfolds it, in Core');
    await becomes(() => folded(p, ids.two), { row: false, words: null, whole: true }, 'and it reads whole');
    await onOther(async () => (await folded(q, ids.two)).whole, true, 'on the other device too');
    await menuOf(p, 'laptop', ids.two);
    await choose(p, 'laptop', 'Fold');
    await until(async () => await foldOf(topic, ids.two), 'folded again');
    // Every state of the stack keeps it: changing the state clears no fold.
    for (const level of ['folded', 'open']) {
      await press(p, 'laptop', '#messages .reply-stack .stack-toggle');
      await becomes(async () => (await look(p, ids, 'root')).fold, level, `the chevron steps to ${level}`);
      assert.equal(await foldOf(topic, ids.two), true, `${level}: Core still holds the fold`);
    }
    await becomes(() => folded(p, ids.two), { row: true, words: `${other}Reply two, to foldFolded`, whole: false }, 'open again, it is still its row');
    await shot(p, 'stack-fold-open');
    await p.close();
    // A reload: the fold is still there.
    p = await open('stack-fold-reload', 'laptop', topic, ids.root);
    await openAll(p, 'laptop');
    await becomes(async () => (await folded(p, ids.two)).row, true, 'after a reload it is still folded');
    // A press on the row unfolds it, and opens no Reader.
    await centre(p, card(ids.two));
    await p.point(card(ids.two) + ' > .message-folded > .folded-words');
    await until(async () => !await foldOf(topic, ids.two), 'a press on the row unfolds it, in Core');
    await becomes(async () => (await folded(p, ids.two)).whole, true, 'and it reads whole');
    assert.equal(await readerOn(p), null, 'the press opened no Reader');
    await onOther(async () => (await folded(q, ids.two)).whole, true, 'on the other device too');
    // A link to a folded message opens it for that view, and writes no unfold.
    await control({ method: 'stack_act', sender: facts.actor, kind: 'message.fold', message_id: ids.one, operation_id: topic + '-fold-one', args: { folded: true } });
    await becomes(async () => (await folded(p, ids.one)).row, true, 'folded on another device, it shows folded here');
    const linking = (await control({ method: 'agent_message', operation_id: topic + '-link', topic_id: topic, source: 'topic', sender: other, addressees: [facts.actor],
      body: `See ${facts.origin}/?topic=${topic}&message=${ids.one} for that.`, read: true })).result.message_id;
    await until(() => p.evaluate(`Boolean(document.querySelector(${JSON.stringify(card(linking) + ' a.words-link')}))`), 'the link arrives');
    await centre(p, `${card(linking)} a.words-link`);
    await p.point(`${card(linking)} a.words-link`);
    await becomes(async () => (await folded(p, ids.one)).whole, true, 'the link opens the folded message whole');
    assert.equal(await foldOf(topic, ids.one), true, 'and Core keeps its fold');
    await until(async () => (await readerOn(p))?.startsWith('Reply one'), 'the Reader opens on it, as a link does');
    await closeReader(p, 'laptop');
    // Opened only for that view: changing its stack's state folds it to its row again, and Core is unchanged.
    for (const level of ['folded', 'open']) {
      await press(p, 'laptop', '#messages .reply-stack .stack-toggle');
      await becomes(async () => (await look(p, ids, 'root')).fold, level, `after the link, the chevron steps to ${level}`);
    }
    await becomes(async () => (await folded(p, ids.one)).row, true, 'a state change folds the message the link opened back to its row');
    assert.equal(await foldOf(topic, ids.one), true, 'and Core still holds its fold');
    // A star keeps a message in view: starring a folded message unfolds it, and a starred one offers no Fold.
    await control({ method: 'stack_act', sender: facts.actor, kind: 'message.fold', message_id: ids.three, operation_id: topic + '-fold-three', args: { folded: true } });
    await becomes(async () => (await folded(p, ids.three)).row, true, 'three is folded');
    await centre(p, card(ids.three));
    await p.point(card(ids.three) + ' > .message-folded > .folded-author', 'move');
    await until(async () => (await lit(p)).includes(ids.three) && await bar(p) !== null, 'the pointer lights the folded row, with its bar');
    await press(p, 'laptop', '.message-bar [data-act=more]');
    await until(() => p.evaluate(`Boolean(document.querySelector('.message-menu-list'))`), '⋯ opens the folded message\'s menu');
    const offered = await p.evaluate(`[...document.querySelector('.message-menu-list').querySelectorAll('button')].map(b=>b.textContent)`);
    assert.ok(offered.includes('Unfold') && !offered.includes('Fold'), `a folded message offers Unfold: ${offered}`);
    await choose(p, 'laptop', 'Star for me');
    await until(async () => (await actsOf(topic, ids.three))?.starred === true && !await foldOf(topic, ids.three), 'starring it unfolds it, in Core');
    await becomes(async () => (await folded(p, ids.three)).whole, true, 'and it reads whole');
    assert.ok(!(await menuOf(p, 'laptop', ids.three)).includes('Fold'), 'a starred message offers no Fold');
    await p.key('Escape');
    // The stack's first message folds to its head row alone; a press on the row unfolds it.
    await menuOf(p, 'laptop', ids.root);
    await choose(p, 'laptop', 'Fold');
    await until(async () => await foldOf(topic, ids.root), 'the first message is folded, in Core');
    await until(async () => { const v = await look(p, ids, 'root'); return v.fold === 'open' && v.headOpen === 'false' && !v.full; }, 'fully open, its first message shows only as the head row');
    assert.equal(await p.evaluate(`document.querySelector(${JSON.stringify(card(ids.root) + ' > .stack-head > .stack-folded')})?.textContent`), 'Folded', 'which says it is folded');
    assert.equal(await p.evaluate(`document.querySelectorAll(${JSON.stringify(card(ids.root) + ' .message-folded')}).length`), 0, 'and no second row doubles it');
    await p.point(card(ids.root) + ' > .stack-head > .stack-who');
    await until(async () => !await foldOf(topic, ids.root), 'a press on the head row unfolds it');
    await until(async () => (await look(p, ids, 'root')).full, 'and it shows whole');
    assert.deepEqual(p.errors, []);
    assert.deepEqual(q.errors, []);
    await p.close(); await q.close();
  });

  if (engine === 'chrome') await check('reading stacks on a phone a message swiped right in a fully open stack folds to its row, and swiped left or tapped unfolds', async () => {
    const topic = 'stack-fold-swipe';
    const ids = await seed(topic, [['root', { sender: other, join: true, addressees: [facts.actor], body: 'The root.' }],
      ['one', { sender: other, reply_to: 'root', addressees: [facts.actor], body: 'Reply one.', read: true }],
      ['two', { sender: other, reply_to: 'root', addressees: [facts.actor], body: 'Reply two, swiped.', read: true }],
      ['three', { sender: other, reply_to: 'root', addressees: [facts.actor], body: 'Reply three.', read: true }]]);
    const p = await open('stack-fold-swipe', 'phone', topic, ids.root);
    await becomes(async () => (await look(p, ids, 'root')).fold, 'folded', 'phone: latest and unread first');
    await press(p, 'phone', '#messages .reply-stack .stack-toggle');
    await becomes(async () => (await look(p, ids, 'root')).rows, ['one', 'two', 'three'], 'phone: fully open');
    const drag = async (selector, from, to) => {
      await centre(p, selector);
      const b = await p.box(selector), y = b.y + b.height / 2, t0 = Date.now() / 1000;
      await p.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: b.x + from, y }], timestamp: t0 });
      for (const part of [1, 2, 3, 4]) await p.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: b.x + from + (to - from) * part / 4, y }], timestamp: t0 + 0.05 * part });
      await p.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: b.x + to, y }], timestamp: t0 + 0.6 });
      await p.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [], timestamp: t0 + 0.65 });
    };
    await drag(card(ids.two), 20, 160);
    await until(async () => await foldOf(topic, ids.two), 'phone: swiped right in the fully open stack, it is folded in Core');
    await becomes(async () => ({ ...(await folded(p, ids.two)), rows: (await look(p, ids, 'root')).rows }), { row: true, words: `${other}Reply two, swipedFolded`, whole: false, rows: ['one', 'two', 'three'] },
      'phone: it is one row, in its place in the open stack');
    await shot(p, 'stack-fold-phone');
    await drag(card(ids.two), 160, 20);
    await until(async () => !await foldOf(topic, ids.two), 'phone: its row swiped left unfolds it, in Core');
    await becomes(async () => (await folded(p, ids.two)).whole, true, 'phone: and it reads whole');
    await drag(card(ids.two), 20, 160);
    await until(async () => await foldOf(topic, ids.two), 'phone: folded once more');
    await becomes(async () => (await folded(p, ids.two)).row, true, 'phone: its row shows');
    await tap(p, card(ids.two) + ' > .message-folded > .folded-words');
    await until(async () => !await foldOf(topic, ids.two), 'phone: one tap on its row unfolds it, in Core');
    await becomes(async () => (await folded(p, ids.two)).whole, true, 'phone: and it reads whole');
    assert.equal(await readerOn(p), null, 'phone: the tap opened no Reader');
    // A starred message is not folded: a swipe right on it writes nothing and leaves it whole. Acts go to Core in
    // order, so once a later swipe's fold is in Core, any fold the starred one had sent would be there before it.
    await control({ method: 'stack_act', sender: facts.actor, kind: 'message.star', message_id: ids.three, operation_id: topic + '-star-three', args: { starred: true } });
    await until(() => p.evaluate(`document.querySelector(${JSON.stringify(card(ids.three))})?.dataset.starred === 'true'`), 'phone: three shows starred');
    await drag(card(ids.three), 20, 160);
    await drag(card(ids.two), 20, 160);
    await until(async () => await foldOf(topic, ids.two), 'phone: the later swipe on two lands in Core');
    assert.equal(await foldOf(topic, ids.three), false, 'phone: the starred message swiped right is not folded in Core');
    assert.deepEqual(await folded(p, ids.three), { row: false, words: null, whole: true }, 'phone: and its card is whole');
    assert.deepEqual(p.errors, []);
    await p.close();
  });
  else observations.push({ name: 'stacks fold swipe', engine, held: 'Safari\'s engine in this harness has a tap but no finger drag: the fold\'s swipe is checked in Chrome' });

  if (engine === 'chrome') await check('reading stacks a reply swiped to the right on a phone folds to its row, and a drag that scrolls a wide table or code folds nothing', async () => {
    const topic = 'stack-swipe';
    const table = ['| ' + Array.from({ length: 14 }, (_, i) => `Column ${i} heading`).join(' | ') + ' |', '|' + ' --- |'.repeat(14),
      '| ' + Array.from({ length: 14 }, (_, i) => `cell ${i} with words`).join(' | ') + ' |'].join('\n');
    // The message stays under the 1,024 bytes a card shows, so its card holds the whole of it.
    const code = '```\n' + Array.from({ length: 6 }, (_, i) => `step_${i}_with_a_long_name()`).join('; ') + '\n```';
    const ids = await seed(topic, [['root', { sender: other, join: true, addressees: [facts.actor], body: 'The root.' }],
      ['one', { sender: other, reply_to: 'root', addressees: [facts.actor], body: 'Reply one, unread.' }],
      ['wide', { sender: other, reply_to: 'root', addressees: [facts.actor], body: 'A wide table, unread:\n\n' + table + '\n\n' + code }],
      ['two', { sender: other, reply_to: 'root', addressees: [facts.actor], body: 'Reply two, unread.' }]]);
    const p = await open('stack-swipe', 'phone', topic, ids.root);
    await becomes(async () => (await look(p, ids, 'root')).rows, ['one', 'wide', 'two'], 'phone: every unread reply in view');
    // A finger's drag, timed as a hand moves: it comes to rest before it lifts, so nothing flings on after it.
    const drag = async (selector, from, to) => {
      await centre(p, selector);
      const b = await p.box(selector), y = b.y + b.height / 2, t0 = Date.now() / 1000;
      await p.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: b.x + from, y }], timestamp: t0 });
      for (const part of [1, 2, 3, 4]) await p.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: b.x + from + (to - from) * part / 4, y }], timestamp: t0 + 0.05 * part });
      await p.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: b.x + to, y }], timestamp: t0 + 0.6 });
      await p.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [], timestamp: t0 + 0.65 });
    };
    // A finger dragging a wide table or a block of code back to its start scrolls it, and folds nothing.
    for (const [what, inner] of [['table', '.md-table-wrap'], ['code', '.md-pre']]) {
      const at = `${card(ids.wide)} ${inner}`;
      const left = () => p.evaluate(`document.querySelector(${JSON.stringify(at)}).scrollLeft`);
      await until(() => p.evaluate(`(e=>e.scrollWidth-e.clientWidth>200)(document.querySelector(${JSON.stringify(at)}))`), `phone: the ${what} is wider than its card`);
      await p.evaluate(`document.querySelector(${JSON.stringify(at)}).scrollLeft=200`);
      await until(async () => await left() === 200, `phone: the ${what} scrolled sideways`);
      await drag(at, 20, 160);
      await until(async () => await left() < 200, `phone: the drag scrolls the ${what} back`);
      assert.deepEqual((await look(p, ids, 'root')).rows, ['one', 'wide', 'two'], `phone: a drag on the ${what} folds nothing`);
    }
    await drag(card(ids.one), 20, 160);
    await until(async () => await foldOf(topic, ids.one), 'phone: swiped right, reply one is folded, in Core');
    await becomes(async () => ({ ...(await folded(p, ids.one)), rows: (await look(p, ids, 'root')).rows }), { row: true, words: `${other}Reply one, unreadFolded`, whole: false, rows: ['one', 'wide', 'two'] },
      'phone: swiped right, reply one is its one row, in its place');
    assert.deepEqual(p.errors, []);
    await p.close();
  });
  else observations.push({ name: 'stacks swipe', engine, held: 'Safari\'s engine in this harness has a tap but no finger drag: the swipe is checked in Chrome' });

  // A trackpad's two-finger swipe reaches the page as wheel events, sideways. With macOS's natural scrolling, fingers moving
  // right give a negative deltaX: a run of events close together, then the smaller ones of the momentum after the fingers lift.
  await check('reading stacks on a laptop two fingers swiped right on the trackpad fold a reply once, swiped left unfold it, and a scroll, a sideways table or a star folds nothing', async () => {
    const topic = 'stack-trackpad';
    const table = ['| ' + Array.from({ length: 14 }, (_, i) => `Column ${i} heading`).join(' | ') + ' |', '|' + ' --- |'.repeat(14),
      '| ' + Array.from({ length: 14 }, (_, i) => `cell ${i} with words`).join(' | ') + ' |'].join('\n');
    const tall = Array.from({ length: 8 }, (_, i) => `Line ${i} of a message that makes the page taller than the window.`).join('\n');
    const ids = await seed(topic, [['root', { sender: other, join: true, addressees: [facts.actor], body: 'The root.' }],
      ['one', { sender: other, reply_to: 'root', addressees: [facts.actor], body: 'Reply one, unread.' }],
      ['wide', { sender: other, reply_to: 'root', addressees: [facts.actor], body: 'A wide table, unread:\n\n' + table }],
      ['kept', { sender: other, reply_to: 'root', addressees: [facts.actor], body: 'Reply kept, starred.' }],
      ...[1, 2, 3, 4, 5].map(n => ['tall' + n, { sender: other, addressees: [facts.actor], body: `Message ${n} on its own.\n${tall}`, read: true }])]);
    await control({ method: 'stack_act', sender: facts.actor, kind: 'message.star', message_id: ids.kept, operation_id: topic + '-star', args: { starred: true } });
    // Every wheel event the window hears, after the feed has had it: its deltas and whether the page took it from the browser.
    const heard = `addEventListener('wheel',e=>{(window.wheels??=[]).push({x:e.deltaX,y:e.deltaY,prevented:e.defaultPrevented})},{passive:true})`;
    const p = await open('stack-trackpad', 'laptop', topic, ids.root, heard);
    // The stack fully open, every reply in view; each new document opens it again.
    const fullyOpen = async () => {
      const toggle = `#messages .reply-stack[data-stack="${ids.root}"] .stack-toggle`;
      if ((await look(p, ids, 'root')).fold !== 'open') { await centre(p, toggle); await press(p, 'laptop', toggle); }
      await becomes(async () => (await look(p, ids, 'root')).rows, ['one', 'wide', 'kept'], 'the stack fully open, every reply in view');
    };
    await fullyOpen();
    const where = await p.evaluate('JSON.stringify([location.href, history.length])');
    const folds = () => p.evaluate(`window.sent.filter(kind=>kind==='message.fold').length`);
    const wheels = () => p.evaluate(`(window.wheels??[]).splice(0)`);
    const RIGHT = [[-30, 0], [-30, 0], [-30, 0], [-30, 0], [-18, 0], [-10, 0], [-5, 0], [-2, 0], [-1, 0]];
    const LEFT = RIGHT.map(([x, y]) => [-x, y]);
    // Fingers that come back to the left before they lift, in the same swipe, further than a swipe left goes.
    const BACK = Array.from({ length: 8 }, () => [30, 0]);
    // Fingers on the trackpad over a target, the pointer resting on it; done when the window has heard every delta.
    // Given `at` (seconds since the epoch), the events are stamped from it 16 ms apart, which Chrome hands on as their timeStamp.
    const fingers = async (selector, steps, modifiers = 0, at = null) => {
      await centre(p, selector);
      const b = await p.box(selector), x = b.x + b.width / 2, y = b.y + Math.min(b.height / 2, 20);
      await p.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
      for (const [n, [deltaX, deltaY]] of steps.entries()) await p.send('Input.dispatchMouseEvent', { type: 'mouseWheel', x, y, deltaX, deltaY, modifiers, ...at === null ? {} : { timestamp: at + 0.016 * n } });
      const sum = steps.reduce((s, [dx, dy]) => [s[0] + dx, s[1] + dy], [0, 0]);
      const got = [];
      await until(async () => { got.push(...await wheels()); return got.reduce((s, w) => s + w.x, 0) === sum[0] && got.reduce((s, w) => s + w.y, 0) === sum[1]; }, `the window heard the gesture over ${selector}`);
      return got;
    };
    // A new document is a new gesture: what the page heard of the last one goes with it.
    const reload = async () => {
      const origin = await p.evaluate('performance.timeOrigin');
      await p.send('Page.reload');
      await until(() => p.evaluate(`performance.timeOrigin !== ${origin} && document.body?.dataset.ready === 'true' && Boolean(document.querySelector(${JSON.stringify(card(ids.kept))}))`).catch(() => false), 'the page loads again');
      await fullyOpen();
    };

    // Two fingers right over reply one fold it, once: neither the momentum after it nor the fingers coming back
    // before they lift folds it again or unfolds it.
    const right = await fingers(card(ids.one), [...RIGHT, ...BACK]);
    await until(async () => await foldOf(topic, ids.one), 'two fingers right: reply one is folded, in Core');
    await becomes(async () => (await folded(p, ids.one)).row, true, 'and it is its one row');
    await until(() => p.evaluate('window.fetchesOut === 0'), 'every act sent is answered');
    assert.equal(await folds(), 1, 'one swipe, momentum and coming back and all, sent one fold');
    assert.equal(await foldOf(topic, ids.one), true, 'and it stays folded');
    assert.ok(right.length > 0 && right.every(w => w.prevented), `the page took every event of the sideways swipe from the browser: ${JSON.stringify(right)}`);
    assert.equal(await p.evaluate(`getComputedStyle(document.documentElement).overscrollBehaviorX`), 'none', 'over the feed a sideways overscroll goes back to no page');
    assert.equal(await p.evaluate('JSON.stringify([location.href, history.length])'), where, 'the page went nowhere');
    // One page hears many swipes: a pause of 250 ms or more between wheel events, by the events' own times, starts the next.
    // Chrome stamps each event as CDP says, so on this same page a swipe left begins 300 ms after the last event of the
    // swipe right and unfolds reply one, and a swipe right 300 ms after that folds it again. Safari's engine in this harness
    // stamps the wheel itself.
    if (engine === 'chrome') {
      // Now is after every event the window heard of the swipe right, which Chrome stamped as it sent them.
      const unfoldAt = await p.evaluate('performance.timeOrigin + performance.now()') / 1000 + 0.3, foldAt = unfoldAt + 0.016 * (LEFT.length - 1) + 0.3;
      await fingers(card(ids.one), LEFT, 0, unfoldAt);
      await until(async () => !await foldOf(topic, ids.one), 'a second swipe, left, on the same page unfolds reply one, in Core');
      await becomes(async () => (await folded(p, ids.one)).whole, true, 'and it reads whole');
      await fingers(card(ids.one), RIGHT, 0, foldAt);
      await until(async () => await foldOf(topic, ids.one), 'a third swipe, right, on the same page folds it again, in Core');
      await becomes(async () => (await folded(p, ids.one)).row, true, 'and it is its one row again');
      await until(() => p.evaluate('window.fetchesOut === 0'), 'every act sent is answered');
      assert.equal(await folds(), 3, 'three swipes on one page sent three folds');
    }
    // Folded is the reader's: after a reload it is still folded, and two fingers left over its row unfold it.
    await reload();
    await becomes(async () => (await folded(p, ids.one)).row, true, 'after a reload reply one is still folded');
    await fingers(card(ids.one), LEFT);
    await until(async () => !await foldOf(topic, ids.one), 'two fingers left over its row unfold it, in Core');
    await becomes(async () => (await folded(p, ids.one)).whole, true, 'and it reads whole');
    // A scroll down that drifts to the right scrolls the page and folds nothing; the page leaves it to the browser.
    await reload();
    await centre(p, card(ids.one));
    const top = () => p.evaluate(`document.querySelector(${JSON.stringify(card(ids.one))}).getBoundingClientRect().top`);
    const before = await top();
    const down = await fingers(card(ids.one), [[-25, 80], [-25, 80], [-25, 80], [-25, 80], [-25, 80]]);
    await until(async () => before - await top() > 100, 'the scroll moves the page');
    assert.equal((await folded(p, ids.one)).whole, true, 'a scroll folds nothing');
    assert.ok(down.every(w => !w.prevented), `the page left every event of the scroll to the browser: ${JSON.stringify(down)}`);
    // Two fingers over a table wider than its card scroll the table, and fold nothing.
    await reload();
    const wrap = `${card(ids.wide)} .md-table-wrap`;
    const left = () => p.evaluate(`document.querySelector(${JSON.stringify(wrap)}).scrollLeft`);
    await until(() => p.evaluate(`(e=>e.scrollWidth-e.clientWidth>200)(document.querySelector(${JSON.stringify(wrap)}))`), 'the table is wider than its card');
    await centre(p, wrap);
    await p.evaluate(`document.querySelector(${JSON.stringify(wrap)}).scrollLeft=200`);
    await until(async () => await left() === 200, 'the table scrolled sideways');
    const sideways = await fingers(wrap, RIGHT);
    await until(async () => await left() < 200, 'the swipe scrolls the table back');
    assert.deepEqual([(await folded(p, ids.wide)).whole, (await look(p, ids, 'root')).rows], [true, ['one', 'wide', 'kept']], 'a swipe on the table folds nothing');
    assert.ok(sideways.every(w => !w.prevented), `the page left every event over the table to the browser: ${JSON.stringify(sideways)}`);
    // A starred message is not folded.
    await reload();
    await fingers(card(ids.kept), RIGHT);
    assert.equal((await folded(p, ids.kept)).whole, true, 'two fingers right over a starred message fold nothing');
    assert.equal(await folds(), 0, 'and send no fold');
    assert.equal(await foldOf(topic, ids.kept), false, 'Core holds no fold');
    // The wheel with Ctrl held zooms, and folds nothing. Safari's engine in this harness turns the wheel with no keys held.
    if (engine === 'chrome') {
      await reload();
      await fingers(card(ids.one), RIGHT, 2);
      assert.equal((await folded(p, ids.one)).whole, true, 'two fingers right with Ctrl held fold nothing');
      assert.equal(await folds(), 0, 'and send no fold');
    }
    assert.equal(await p.evaluate('JSON.stringify([location.href, history.length])'), where, 'the page went nowhere through it all');
    assert.deepEqual(p.errors, []);
    await p.close();
  });

  // x as a person types it: in Chrome a key press with its letter, which a field takes as typing; in Safari's
  // engine the keyboard's own press, which types it too.
  const typeX = p => engine === 'chrome'
    ? p.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'x', code: 'KeyX', windowsVirtualKeyCode: 88, text: 'x', unmodifiedText: 'x' })
      .then(() => p.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'x', code: 'KeyX', windowsVirtualKeyCode: 88 }))
    : p.key('x');
  const foldsSent = p => p.evaluate(`window.sent.filter(kind=>kind==='message.fold').length`);
  const thumbedBy = async (id, who = facts.actor) => (await view('reactions', { message_id: id })).reactions.thumbs.some(thumb => thumb.actor_id === who);
  const fullyOpen = async (p, device, ids) => {
    const toggle = `#messages .reply-stack[data-stack="${ids.root}"] > .stack-toggle`;
    if ((await look(p, ids, 'root')).fold !== 'open') { await centre(p, toggle); await press(p, device, toggle); }
    await becomes(async () => (await look(p, ids, 'root')).fold, 'open', `${device}: the stack fully open`);
  };
  // A finger's drag across a card on a phone, as the swipe cases make it.
  const fingerDrag = async (p, selector, from, to) => {
    await centre(p, selector);
    const b = await p.box(selector), y = b.y + Math.min(b.height / 2, 120), t0 = Date.now() / 1000;
    await p.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: b.x + from, y }], timestamp: t0 });
    for (const part of [1, 2, 3, 4]) await p.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: b.x + from + (to - from) * part / 4, y }], timestamp: t0 + 0.05 * part });
    await p.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: b.x + to, y }], timestamp: t0 + 0.6 });
    await p.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [], timestamp: t0 + 0.65 });
  };
  // Two fingers on the trackpad over a card, the pointer resting on it, as the trackpad case sends them (natural
  // scrolling: fingers moving right give a negative deltaX); done once the window has heard every delta, which it gives back.
  const HEARD_WHEELS = `addEventListener('wheel',e=>{(window.wheels??=[]).push({x:e.deltaX,y:e.deltaY,prevented:e.defaultPrevented})},{passive:true})`;
  const SWIPE_RIGHT = [[-30, 0], [-30, 0], [-30, 0], [-30, 0], [-18, 0], [-10, 0], [-5, 0], [-2, 0], [-1, 0]];
  const trackpad = async (p, selector, steps) => {
    await centre(p, selector);
    const b = await p.box(selector), x = b.x + b.width / 2, y = Math.max(b.y, 0) + Math.min(b.height / 2, 40);
    await p.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
    for (const [deltaX, deltaY] of steps) await p.send('Input.dispatchMouseEvent', { type: 'mouseWheel', x, y, deltaX, deltaY });
    const sum = steps.reduce((all, [dx, dy]) => [all[0] + dx, all[1] + dy], [0, 0]), got = [];
    await until(async () => { got.push(...await p.evaluate('(window.wheels??[]).splice(0)')); return got.reduce((all, w) => all + w.x, 0) === sum[0] && got.reduce((all, w) => all + w.y, 0) === sum[1]; },
      `the window heard the gesture over ${selector}`);
    return got;
  };

  // Item 377: a person's reply to a message, or their thumbs-up on it, folds it for them in Core, as their Fold would.
  await check('reading stacks replying to a message or a thumbs-up on it folds it for the person, on every device; a starred one stays whole, the Reader keeps showing it whole, the feed keeps its place and the keys, and ⌘Z leaves it folded', async () => {
    const topic = 'stack-fold-answered';
    const ids = await seed(topic, [['root', { sender: other, join: true, addressees: [facts.actor], body: 'The root, already read.', read: true }],
      ['one', { sender: other, reply_to: 'root', addressees: [facts.actor], body: 'Reply one, to answer.' }],
      ['two', { sender: other, reply_to: 'root', addressees: [facts.actor], body: 'Reply two, to thumb up.' }],
      ['kept', { sender: other, reply_to: 'root', addressees: [facts.actor], body: 'Reply kept, starred.' }]]);
    await control({ method: 'stack_act', sender: facts.actor, kind: 'message.star', message_id: ids.kept, operation_id: topic + '-star', args: { starred: true } });
    const p = await open(topic, 'laptop', topic, ids.root);
    await becomes(async () => (await look(p, ids, 'root')).rows, ['one', 'two', 'kept'], 'every unread reply in view');
    // A reply written in the Reader and sent with ⇧⌘Return, which keeps the Reader open on the message.
    await openReader(p, 'laptop', ids.one, 'Reply one');
    await until(() => p.evaluate(`document.activeElement?.id === 'writing-body'`), 'the cursor is in the reply');
    const topOf = id => p.evaluate(`Math.round(document.querySelector(${JSON.stringify(card(id))}).getBoundingClientRect().top)`);
    const before = await topOf(ids.one);
    await p.send('Input.insertText', { text: 'My answer to reply one.' });
    await p.key('Enter', 12);
    await until(async () => await foldOf(topic, ids.one), 'the reply folds reply one for the person, in Core');
    await becomes(async () => (await folded(p, ids.one)).row, true, 'the feed shows reply one as its row');
    assert.ok((await readerOn(p))?.startsWith('Reply one, to answer.'), 'the Reader, still open on reply one, shows it whole');
    assert.equal(await topOf(ids.one), before, 'its row keeps the place the message had in the feed');
    assert.deepEqual((await look(p, ids, 'root')).rows.slice(0, 3), ['one', 'two', 'kept'], 'in its place in its stack');
    await closeReader(p, 'laptop');
    await until(async () => await focusedOn(p) === ids.one, 'the keys come back to reply one, now its row');
    // ⌘Z puts back what the person did on this page: the reply's fold is not one of those, and stays.
    await p.key('z', 4);
    await until(async () => await said(p) === 'Nothing to put back', '⌘Z has nothing of the reply\'s to put back');
    assert.equal(await foldOf(topic, ids.one), true, 'the fold the reply made stays after ⌘Z');
    // The bar's 👍 on reply two folds it.
    await light(p, 'laptop', ids.two);
    await p.point('.message-bar [data-act=thumb]');
    await until(async () => await foldOf(topic, ids.two), 'a thumbs-up folds reply two for the person, in Core');
    await becomes(async () => (await folded(p, ids.two)).row, true, 'the feed shows reply two as its row');
    // A starred message keeps in view: neither a thumbs-up nor a reply folds it.
    await light(p, 'laptop', ids.kept);
    await p.point('.message-bar [data-act=thumb]');
    await until(async () => await thumbedBy(ids.kept), 'the thumbs-up on the starred reply is in Core');
    ids.mine = (await control({ method: 'agent_message', operation_id: topic + '-mine', topic_id: topic, source: 'topic', sender: facts.actor,
      reply_to: ids.kept, addressees: [other], body: 'An answer to the starred reply.' })).result.message_id;
    await until(() => p.evaluate(`Boolean(document.querySelector(${JSON.stringify(card(ids.mine))})) && window.fetchesOut === 0`), 'the answer to the starred reply is drawn');
    assert.equal(await foldOf(topic, ids.kept), false, 'a starred message is not folded by a thumbs-up or a reply, in Core');
    assert.deepEqual(await folded(p, ids.kept), { row: false, words: null, whole: true }, 'and it reads whole');
    // Taking the thumbs-up back unfolds nothing.
    await centre(p, card(ids.two));
    await p.point(card(ids.two) + ' > .message-folded > .folded-author', 'move');
    await until(async () => (await lit(p)).includes(ids.two) && await bar(p) !== null, 'the pointer lights reply two\'s row, with its bar');
    await p.point('.message-bar [data-act=thumb]');
    await until(async () => !await thumbedBy(ids.two), 'the thumbs-up on reply two is taken back, in Core');
    assert.equal(await foldOf(topic, ids.two), true, 'and reply two stays folded');
    // Nobody else's view changes; the person's other device shows both folded.
    assert.deepEqual([await foldOf(topic, ids.one, other), await foldOf(topic, ids.two, other)], [false, false], 'another reader sees neither folded');
    await shot(p, 'stack-fold-answered');
    const q = await open(topic + '-other-device', 'laptop', topic, ids.root);
    await fullyOpen(q, 'laptop', ids);
    await becomes(async () => [(await folded(q, ids.one)).row, (await folded(q, ids.two)).row, (await folded(q, ids.kept)).whole], [true, true, true],
      'the person\'s other device shows replies one and two folded and the starred reply whole');
    assert.deepEqual(p.errors, []); assert.deepEqual(q.errors, []);
    await p.close(); await q.close();
  });

  // Item 381: a long message that scrolls up and down in its card folds by a swipe like any other.
  await check('reading stacks a swipe folds a long message that scrolls up and down inside its card, by a finger on a phone and two fingers on a trackpad', async () => {
    for (const device of engine === 'chrome' ? ['phone', 'laptop'] : ['laptop']) {
      const topic = 'stack-fold-long-' + device;
      const long = Array.from({ length: 60 }, (_, i) => `Line ${i}: a long message, read where it is, that scrolls up and down inside its card.`).join('\n');
      const ids = await seed(topic, [['root', { sender: other, join: true, addressees: [facts.actor], body: 'The root.', read: true }],
        ['long', { sender: other, reply_to: 'root', addressees: [facts.actor], body: 'A long reply.\n' + long }],
        ['last', { sender: other, reply_to: 'root', addressees: [facts.actor], body: 'The last reply.' }]]);
      const p = await open(topic, device, topic, ids.root, device === 'laptop' ? HEARD_WHEELS : '');
      await becomes(async () => (await look(p, ids, 'root')).rows, ['long', 'last'], `${device}: both unread replies in view`);
      const selector = card(ids.long);
      await light(p, device, ids.long);
      await until(() => p.evaluate(`(c=>c.dataset.whole==='shown'&&c.classList.contains('scroll-in-place')&&c.scrollHeight-c.clientHeight>200)(document.querySelector(${JSON.stringify(selector)}))`),
        `${device}: the long reply is read whole, scrolling up and down in its card`);
      // Real screens round a long message's words to a pixel wider than its card shows (item 381); the harness's
      // screens lay them out to the pixel, so the words are given that pixel here: they run a pixel past the
      // card's padding, so the card is a pixel wider than it shows (scrollWidth over clientWidth) in both engines.
      await p.evaluate(`(c=>document.head.append(Object.assign(document.createElement('style'),{textContent:'.message-card.scroll-in-place>.message-preview{box-sizing:border-box;min-width:calc(100% + '+(parseFloat(getComputedStyle(c).paddingRight)+1)+'px)}'})))(document.querySelector(${JSON.stringify(selector)}))`);
      await until(() => p.evaluate(`(c=>c.scrollWidth>c.clientWidth)(document.querySelector(${JSON.stringify(selector)}))`), `${device}: the words run a pixel past the card`);
      if (device === 'phone') await fingerDrag(p, selector, 20, 160);
      else await trackpad(p, selector, SWIPE_RIGHT);
      await until(async () => await foldOf(topic, ids.long), `${device}: swiped right, the long reply is folded, in Core`);
      await becomes(async () => (await folded(p, ids.long)).row, true, `${device}: and it is its one row`);
      await shot(p, 'stack-fold-long-' + device);
      assert.deepEqual(p.errors, []); await p.close();
    }
    if (engine !== 'chrome') observations.push({ name: 'stacks fold long swipe', engine, held: 'Safari\'s engine in this harness has a tap but no finger drag: the phone\'s swipe on a long message is checked in Chrome' });
  });

  // Item 388: x on the selected message is Fold or Unfold, as in its ⋯.
  await check('reading stacks x folds the selected message to its row and x again unfolds it, in Core; a starred message and a dossier as a whole fold nothing, and in writing x is typed', async () => {
    const topic = 'stack-fold-key';
    const ids = await seed(topic, [['root', { sender: other, join: true, addressees: [facts.actor], body: 'The root of the folder.', read: true }],
      ['one', { sender: other, reply_to: 'root', addressees: [facts.actor], body: 'Reply one.', read: true }],
      ['two', { sender: other, reply_to: 'root', addressees: [facts.actor], body: 'Reply two, folded by x.', read: true }],
      ['kept', { sender: other, reply_to: 'root', addressees: [facts.actor], body: 'Reply kept, starred.', read: true }]]);
    await control({ method: 'stack_act', sender: facts.actor, kind: 'message.star', message_id: ids.kept, operation_id: topic + '-star', args: { starred: true } });
    const p = await open(topic, 'laptop', topic, ids.root);
    await fullyOpen(p, 'laptop', ids);
    await keyTo(p, ids.two);
    await typeX(p);
    await until(async () => await foldOf(topic, ids.two), 'x folds the selected reply, in Core');
    await becomes(() => folded(p, ids.two), { row: true, words: `${other}Reply two, folded by xFolded`, whole: false }, 'and it is its one row');
    assert.equal(await focusedOn(p), ids.two, 'the keys stay on it');
    assert.equal(await said(p), 'Folded to one line, for you only');
    assert.equal(await foldOf(topic, ids.two, other), false, 'another reader\'s view of it is unchanged');
    await typeX(p);
    await until(async () => !await foldOf(topic, ids.two), 'x again unfolds it, in Core');
    await becomes(async () => (await folded(p, ids.two)).whole, true, 'and it reads whole');
    assert.equal(await focusedOn(p), ids.two, 'the keys still on it');
    await typeX(p);
    await until(async () => await foldOf(topic, ids.two), 'x folds it once more');
    await p.key('z', 4);
    await until(async () => !await foldOf(topic, ids.two), '⌘Z puts back the fold x made');
    // A starred message stays open, and says so.
    await keyTo(p, ids.kept);
    const sentBefore = await foldsSent(p);
    await typeX(p);
    await until(async () => await said(p) === 'Starred messages stay open', 'x on a starred message says it stays open');
    assert.equal(await foldsSent(p), sentBefore, 'and sends no fold');
    assert.deepEqual(await folded(p, ids.kept), { row: false, words: null, whole: true }, 'it reads whole');
    // On a dossier as a whole, its chevron or its compact header, x does nothing (yet).
    await p.evaluate(`document.querySelector(${JSON.stringify(`.reply-stack[data-stack="${ids.root}"] > .stack-toggle`)}).focus()`);
    await typeX(p); await twoFrames(p);
    await press(p, 'laptop', `.reply-stack[data-stack="${ids.root}"] > .stack-toggle`);
    await becomes(async () => (await look(p, ids, 'root')).fold, 'folded', 'the stack back to latest plus unread, its head one row');
    await keyTo(p, ids.root);
    assert.equal((await look(p, ids, 'root')).headOpen, 'false', 'the keys are on the dossier\'s compact header');
    await typeX(p); await twoFrames(p);
    await until(() => p.evaluate('window.fetchesOut === 0'), 'nothing is out');
    assert.equal(await foldsSent(p), sentBefore, 'x on the chevron or the compact header sends no fold');
    assert.equal(await foldOf(topic, ids.root), false, 'and the first message is not folded, in Core');
    // In writing x is a letter: in the topic's composer and in the Reader's reply.
    await p.key('Enter', 4);
    await until(() => p.evaluate("document.activeElement?.id === 'inline-writing-body'"), 'the new message\'s writing has the cursor');
    await typeX(p);
    await until(() => p.evaluate("document.activeElement?.value === 'x'"), 'x is typed in the composer');
    await p.key('Escape');
    await until(() => p.evaluate("!document.querySelector('#new-message-sheet')?.open"), 'Escape puts the composer back');
    await press(p, 'laptop', `.reply-stack[data-stack="${ids.root}"] > .stack-toggle`);
    await becomes(async () => (await look(p, ids, 'root')).fold, 'open', 'the stack fully open again, reply one in view');
    await openReader(p, 'laptop', ids.one, 'Reply one');
    await until(() => p.evaluate(`document.activeElement?.id === 'writing-body'`), 'the cursor is in the reply');
    await typeX(p);
    await until(() => p.evaluate("document.querySelector('#writing-body').value === 'x'"), 'x is typed in the reply');
    await closeReader(p, 'laptop');
    assert.equal(await foldsSent(p), sentBefore, 'typing x sends no fold');
    assert.equal(await foldOf(topic, ids.one), false, 'and the message the Reader showed is not folded');
    assert.deepEqual(p.errors, []); await p.close();
  });

  // Item 388 on a dossier's original message. Folded, it is its head row, at every state of the dossier; x on that
  // row unfolds it, whether x or the person's reply (item 377) folded it, and at latest and unread it does as a
  // press on the row does, opening the dossier so the message reads whole. So x then x always comes back.
  await check('reading stacks x folds a dossier\'s original message to its head row and x again unfolds it, after x or the person\'s reply folded it, fully open or at latest and unread', async () => {
    const topic = 'stack-fold-key-head';
    const ids = await seed(topic, [['root', { sender: other, join: true, addressees: [facts.actor], body: 'The original message.', read: true }],
      ['one', { sender: other, reply_to: 'root', addressees: [facts.actor], body: 'Reply one.', read: true }],
      ['two', { sender: other, reply_to: 'root', addressees: [facts.actor], body: 'Reply two.', read: true }]]);
    const toggle = `#messages .reply-stack[data-stack="${ids.root}"] > .stack-toggle`;
    const head = async () => { const l = await look(p, ids, 'root'); return [l.fold, l.headOpen]; };
    const p = await open(topic, 'laptop', topic, ids.root);
    await fullyOpen(p, 'laptop', ids);
    await keyTo(p, ids.root);
    assert.deepEqual(await head(), ['open', 'true'], 'fully open, the original message reads whole');
    const sent = await foldsSent(p);
    await typeX(p);
    await until(async () => await foldOf(topic, ids.root), 'x folds the original message, in Core');
    await becomes(head, ['open', 'false'], 'it is its head row, the dossier still fully open');
    assert.equal(await focusedOn(p), ids.root, 'the keys stay on it');
    await typeX(p);
    await until(async () => !await foldOf(topic, ids.root), 'x again unfolds it, in Core');
    await becomes(head, ['open', 'true'], 'and it reads whole');
    assert.equal(await foldsSent(p), sent + 2, 'one fold sent for each x');
    assert.equal(await focusedOn(p), ids.root, 'the keys still on it');
    // The person's reply to it folds it (item 377); x on its head row unfolds it.
    ids.mine = (await control({ method: 'agent_message', operation_id: topic + '-mine', topic_id: topic, source: 'topic', sender: facts.actor,
      reply_to: ids.root, addressees: [other], body: 'My answer to the original.' })).result.message_id;
    await until(() => p.evaluate(`Boolean(document.querySelector(${JSON.stringify(card(ids.mine))})) && window.fetchesOut === 0`), 'my reply is drawn');
    await until(async () => await foldOf(topic, ids.root), 'my reply folds the original message, in Core');
    await becomes(async () => (await look(p, ids, 'root')).headOpen, 'false', 'the page shows it as its head row');
    await keyTo(p, ids.root);
    await typeX(p);
    await until(async () => !await foldOf(topic, ids.root), 'x unfolds what my reply folded, in Core');
    await becomes(head, ['open', 'true'], 'and it reads whole');
    // At latest and unread a folded first message is its head row too: x unfolds it and opens the dossier.
    await typeX(p);
    await until(async () => await foldOf(topic, ids.root), 'x folds it once more');
    await centre(p, toggle); await press(p, 'laptop', toggle);
    await becomes(head, ['folded', 'false'], 'the dossier at latest and unread, its head one row');
    await keyTo(p, ids.root);
    await typeX(p);
    await until(async () => !await foldOf(topic, ids.root), 'x on the head row unfolds the folded first message, in Core');
    await becomes(head, ['open', 'true'], 'and opens the dossier, so the message reads whole');
    assert.equal(await focusedOn(p), ids.root, 'the keys stay on it');
    await typeX(p);
    await until(async () => await foldOf(topic, ids.root), 'and x again folds it');
    assert.deepEqual(p.errors, []); await p.close();
  });

  // Item 390: a folded message's row carries its 👍.
  await check('reading stacks a folded message\'s row carries its 👍: pressed once given, with the count, given and taken back without unfolding, reached by Tab, named, and 44px under a finger', async () => {
    for (const device of Object.keys(DEVICES)) {
      const topic = 'stack-fold-thumb-' + device;
      const ids = await seed(topic, [['root', { sender: other, join: true, addressees: [facts.actor], body: 'The root.', read: true }],
        ['one', { sender: other, reply_to: 'root', addressees: [facts.actor], body: 'Reply one, folded.', read: true }],
        ['two', { sender: 'aim-ux', join: true, reply_to: 'root', addressees: [facts.actor], body: 'Reply two, folded, thumbed by another.', read: true }],
        ['mine', { sender: facts.actor, addressees: [other], body: 'My own message, folded.', read: true }]]);
      await control({ method: 'agent_thumb', sender: other, message_id: ids.two, operation_id: topic + '-their-thumb' });
      assert.equal(await thumbedBy(ids.two, other), true, 'another gives reply two a thumbs-up');
      for (const id of [ids.one, ids.two, ids.mine]) await control({ method: 'stack_act', sender: facts.actor, kind: 'message.fold', message_id: id, operation_id: topic + '-fold-' + id, args: { folded: true } });
      const p = await open(topic, device, topic, ids.root);
      await fullyOpen(p, device, ids);
      await becomes(async () => [(await folded(p, ids.one)).row, (await folded(p, ids.two)).row, (await folded(p, ids.mine)).row], [true, true, true], `${device}: three folded rows`);
      const pick = thumb => thumb && (({ text, pressed, label, title, role }) => ({ text, pressed, label, title, role }))(thumb);
      assert.deepEqual(pick(await thumbOn(p, ids.one)), { text: '👍', pressed: 'false', label: 'Thumbs up', title: 'Thumbs up', role: 'button' }, `${device}: a folded row's 👍, named and titled`);
      assert.deepEqual(pick(await thumbOn(p, ids.two)), { text: '👍 1', pressed: 'false', label: 'Thumbs up (1)', title: 'Thumbs up', role: 'button' }, `${device}: with the count once someone else has given one`);
      assert.equal(await thumbOn(p, ids.mine), null, `${device}: the person's own message takes no thumbs-up from them, so its row has none`);
      // Only the card names its message (data-id): what finds a message's card finds that card alone, not its 👍 too.
      assert.equal(await p.evaluate(`document.querySelectorAll(${JSON.stringify(`#messages [data-id="${ids.one}"]`)}).length`), 1, `${device}: the folded row's 👍 names no message of its own`);
      if (device === 'phone') {
        const size = await thumbOn(p, ids.one);
        assert.ok(size.width >= 44 && size.height >= 44, `phone: the 👍 is 44px or more each way under a finger: ${JSON.stringify(size)}`);
      }
      const thumb = `${card(ids.one)} > .message-folded > .folded-thumb`;
      await centre(p, thumb);
      if (device === 'laptop') {
        // The pointer on the row lights it, and its bar sits clear of the row's 👍, so the 👍 can still be pressed.
        await p.point(card(ids.one) + ' > .message-folded > .folded-author', 'move');
        await until(async () => (await lit(p)).includes(ids.one) && await bar(p) !== null, 'laptop: the row lights, with its bar');
        assert.equal(await p.evaluate(`(()=>{const b=document.querySelector('.message-bar').getBoundingClientRect(),t=document.querySelector(${JSON.stringify(thumb)}).getBoundingClientRect();
          return b.right>t.left&&b.left<t.right&&b.bottom>t.top&&b.top<t.bottom})()`), false, 'laptop: the bar does not cover the row\'s 👍');
      }
      await press(p, device, thumb);
      await until(async () => await thumbedBy(ids.one), `${device}: the row's 👍 gives the thumbs-up, in Core`);
      await becomes(async () => pick(await thumbOn(p, ids.one)), { text: '👍 1', pressed: 'true', label: 'Remove thumbs up (1)', title: 'Remove thumbs up', role: 'button' }, `${device}: shown pressed, counted`);
      assert.equal(await foldOf(topic, ids.one), true, `${device}: the message stays folded, in Core`);
      assert.equal((await folded(p, ids.one)).row, true, `${device}: and on the page`);
      assert.equal(await readerOn(p), null, `${device}: the press opens nothing`);
      for (const theme of ['light', 'dark']) {
        await p.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: theme }] });
        await shot(p, `stack-fold-thumb-${device}-${theme}`);
      }
      await press(p, device, thumb);
      await until(async () => !await thumbedBy(ids.one), `${device}: a second press takes it back, in Core`);
      await becomes(async () => (await thumbOn(p, ids.one))?.pressed, 'false', `${device}: shown not pressed`);
      assert.equal(await foldOf(topic, ids.one), true, `${device}: and the message stays folded`);
      if (device === 'laptop' && engine !== 'chrome') observations.push({ name: 'stacks folded row thumb Tab', engine, held: 'Safari\'s key for every item is Option-Tab, which the page leaves to the browser, as it does for the bar\'s buttons: Tab from a folded row to its 👍 is checked in Chrome' });
      if (device === 'laptop' && engine === 'chrome') {
        // The keys: Tab from the selected row reaches its 👍, and Return gives the thumbs-up there.
        await keyTo(p, ids.two);
        await p.key('Tab');
        await until(() => p.evaluate(`document.activeElement?.matches(${JSON.stringify(`${card(ids.two)} > .message-folded > .folded-thumb`)})`), 'laptop: Tab from the selected row reaches its 👍');
        await p.key('Enter');
        await until(async () => await thumbedBy(ids.two), 'laptop: Return on it gives the thumbs-up, in Core');
        assert.equal(await foldOf(topic, ids.two), true, 'laptop: and the message stays folded');
        assert.equal(await readerOn(p), null, 'laptop: Return on the 👍 opens no Reader');
      }
      assert.deepEqual(p.errors, []); await p.close();
    }
  });

  // Item 393: a scroll right after a trackpad swipe folds a message is the browser's at once.
  await check('reading stacks a scroll right after two fingers fold a message on the trackpad scrolls the page at once', async () => {
    const topic = 'stack-fold-then-scroll';
    const tall = Array.from({ length: 8 }, (_, i) => `Line ${i} of a message that makes the page taller than the window.`).join('\n');
    const ids = await seed(topic, [['root', { sender: other, join: true, addressees: [facts.actor], body: 'The root.' }],
      ['one', { sender: other, reply_to: 'root', addressees: [facts.actor], body: 'Reply one, unread.' }],
      ...[1, 2, 3, 4, 5].map(n => ['tall' + n, { sender: other, addressees: [facts.actor], body: `Message ${n} on its own.\n${tall}`, read: true }])]);
    const p = await open(topic, 'laptop', topic, ids.root, HEARD_WHEELS);
    await becomes(async () => (await look(p, ids, 'root')).rows, ['one'], 'the unread reply in view');
    // The stack's head sits above the reply that folds, so only a scroll moves it.
    const top = () => p.evaluate(`document.querySelector(${JSON.stringify(card(ids.root))}).getBoundingClientRect().top`);
    await centre(p, card(ids.one));
    const before = await top();
    // The fingers swipe right, then at once scroll, as a scroll that starts in the swipe's momentum. The stack
    // sits at the foot of the page (the newer messages are above it), so the scroll goes up the page.
    const DOWN = [[0, -10], [0, -20], [0, -40], [0, -60], [0, -80], [0, -80]];
    const heard = await trackpad(p, card(ids.one), [...SWIPE_RIGHT, ...DOWN]);
    await until(async () => await foldOf(topic, ids.one), 'the swipe folds reply one, in Core');
    const down = heard.filter(w => w.y !== 0);
    assert.equal(down.length, DOWN.length, `the window heard every event of the scroll: ${JSON.stringify(heard)}`);
    assert.ok(down.every(w => !w.prevented), `the page left every event of the scroll to the browser: ${JSON.stringify(down)}`);
    assert.ok(heard.filter(w => w.y === 0).every(w => w.prevented), `and took the sideways swipe from it: ${JSON.stringify(heard)}`);
    if (engine === 'chrome') await until(async () => await top() - before >= 250, 'the page scrolls the whole way the fingers moved');
    else observations.push({ name: 'stacks scroll after a trackpad fold', engine, held: 'in this harness Safari\'s engine scrolls the page for none of the wheel events that follow a swipe\'s, though the page leaves them to it (seemingly one gesture with the swipe, whose first events the page kept); that every event of the scroll is left to the browser is checked here, and that the page then scrolls, in Chrome' });
    assert.equal(await foldsSent(p), 1, 'one fold sent');
    assert.deepEqual(p.errors, []); await p.close();
  });

  // Item 376: a star in a message's header, and in the Reader beside its title, the same act as Star for me in ⋯;
  // and the Reader's ⋯ folds the message as the card's Fold does.
  // hits: what a press 21px from the glyph's middle each way lands on is the star (a 44px target under a finger).
  const starOn = (p, id) => p.evaluate(`(s=>{if(!s)return null;const b=s.getBoundingClientRect(),cx=b.left+b.width/2,cy=b.top+b.height/2;
    return {shown:s.getClientRects().length>0&&getComputedStyle(s).visibility==='visible',text:s.textContent,pressed:s.getAttribute('aria-pressed'),label:s.getAttribute('aria-label'),title:s.title,role:s.getAttribute('role'),
    width:Math.round(b.width),height:Math.round(b.height),hits:[[-21,0],[21,0],[0,-21],[0,21]].map(([x,y])=>document.elementFromPoint(cx+x,cy+y)===s)}})(document.querySelector(${JSON.stringify(card(id) + ' > .message-author > .card-star')}))`);
  const readerStar = p => p.evaluate(`(s=>s&&{shown:!s.hidden&&s.getClientRects().length>0,text:s.textContent,pressed:s.getAttribute('aria-pressed'),label:s.getAttribute('aria-label'),title:s.title,
    width:Math.round(s.getBoundingClientRect().width),height:Math.round(s.getBoundingClientRect().height)})(document.getElementById('reader-star'))`);
  const glyph = s => s && (({ shown, text, pressed, label, title }) => ({ shown, text, pressed, label, title }))(s);
  const OUTLINE = { shown: true, text: '☆', pressed: 'false', label: 'Star for me', title: 'Star for me' };
  const FILLED = { shown: true, text: '★', pressed: 'true', label: 'Unstar', title: 'Unstar' };
  // The Reader's ⋯, opened by a press, and the words of its items.
  const readerMenu = async (p, device) => {
    await press(p, device, '#reader-menu');
    await until(() => p.evaluate(`Boolean(document.querySelector('.message-menu-list'))`), `${device}: the Reader's ⋯ opens its menu`);
    return p.evaluate(`[...document.querySelector('.message-menu-list').querySelectorAll('button')].map(b=>b.firstChild.textContent)`);
  };
  const shutMenu = async p => { await p.key('Escape'); await until(() => p.evaluate(`!document.querySelector('.message-menu-list')`), 'Escape closes the menu'); };

  await check('reading stacks a star in a message\'s header, outline while the message is lit and filled once starred, stars it for you alone and unstars it, and opens nothing', async () => {
    for (const device of Object.keys(DEVICES)) {
      const topic = 'stack-header-star-' + device;
      const ids = await seed(topic, [['a', { sender: other, join: true, addressees: [facts.actor], body: 'Message A, starred from its header.', read: true }],
        ['b', { sender: other, addressees: [facts.actor], body: 'Message B, left alone.', read: true }]]);
      const p = await open(topic, device, topic, ids.a);
      const star = card(ids.a) + ' > .message-author > .card-star';
      if (device === 'laptop') await away(p);
      assert.equal(glyph(await starOn(p, ids.a))?.shown ?? false, false, `${device}: a message neither lit nor starred shows no star`);
      await light(p, device, ids.a);
      assert.deepEqual(glyph(await starOn(p, ids.a)), OUTLINE, `${device}: the lit message shows an outline star after who wrote it and when, named and titled`);
      assert.equal((await starOn(p, ids.a)).role, 'button', `${device}: a button to a screen reader`);
      // Only the card names its message (data-id): what finds a message's card finds that card alone, not its star too.
      assert.equal(await p.evaluate(`document.querySelectorAll(${JSON.stringify(`#messages [data-id="${ids.a}"]`)}).length`), 1, `${device}: the star names no message of its own`);
      assert.equal(glyph(await starOn(p, ids.b))?.shown ?? false, false, `${device}: the message not lit shows none`);
      if (device === 'phone') {
        assert.deepEqual((await starOn(p, ids.a)).hits, [true, true, true, true], 'phone: the star answers a finger 44px each way around it');
      }
      await press(p, device, star);
      await until(async () => (await actsOf(topic, ids.a))?.starred === true, `${device}: a press on the star stars the message, in Core`);
      await becomes(async () => glyph(await starOn(p, ids.a)), FILLED, `${device}: the star is filled, and pressed`);
      assert.equal((await actsOf(topic, ids.a, other))?.starred ?? false, false, `${device}: another reader sees no star`);
      // Its author line painted again (marked unread from another device, then read): the star is put back with it, filled.
      const unread = card(ids.a) + ' > .message-author .unread-mark';
      await control({ method: 'mark', operation_id: topic + '-mark', message_ids: [ids.a], marked: true });
      await until(() => p.evaluate(`Boolean(document.querySelector(${JSON.stringify(unread)}))`), `${device}: marked unread elsewhere, its author line is painted again, with Unread`);
      assert.deepEqual(glyph(await starOn(p, ids.a)), FILLED, `${device}: and keeps its filled star`);
      await control({ method: 'mark', operation_id: topic + '-clear', message_ids: [ids.a], marked: false });
      await until(() => p.evaluate(`!document.querySelector(${JSON.stringify(unread)})`), `${device}: read again elsewhere, its author line is painted again, without Unread`);
      assert.deepEqual(glyph(await starOn(p, ids.a)), FILLED, `${device}: and still keeps its filled star`);
      assert.equal(await readerOn(p), null, `${device}: the press opens no Reader`);
      // The light goes to B: A keeps its filled star, B shows its outline one.
      await light(p, device, ids.b);
      assert.deepEqual(glyph(await starOn(p, ids.a)), FILLED, `${device}: a starred message shows its filled star when it is not lit`);
      assert.deepEqual(glyph(await starOn(p, ids.b)), OUTLINE, `${device}: and the lit one its outline star`);
      for (const theme of ['light', 'dark']) {
        await p.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: theme }] });
        await shot(p, `stack-header-star-${device}-${theme}`);
      }
      await light(p, device, ids.a);
      await press(p, device, star);
      await until(async () => (await actsOf(topic, ids.a))?.starred === false, `${device}: a second press unstars it, in Core`);
      await becomes(async () => glyph(await starOn(p, ids.a)), OUTLINE, `${device}: the lit message shows its outline star again`);
      await light(p, device, ids.b);
      assert.equal(glyph(await starOn(p, ids.a))?.shown ?? false, false, `${device}: unstarred and not lit, it shows no star`);
      if (device === 'laptop' && engine !== 'chrome') observations.push({ name: 'stacks header star Tab', engine, held: 'Safari\'s key for every item is Option-Tab, which the page leaves to the browser, as it does for the bar\'s buttons: Tab from a message to its header star is checked in Chrome' });
      if (device === 'laptop' && engine === 'chrome') {
        // The keys: Tab from the selected message reaches its star before the bar's buttons, and Return stars it.
        await keyTo(p, ids.b);
        await p.key('Tab');
        await until(() => p.evaluate(`document.activeElement?.matches(${JSON.stringify(card(ids.b) + ' > .message-author > .card-star')})`), 'laptop: Tab from the selected message reaches its star first');
        await p.key('Enter');
        await until(async () => (await actsOf(topic, ids.b))?.starred === true, 'laptop: Return on the star stars the message, in Core');
        assert.equal(await readerOn(p), null, 'laptop: Return on the star opens no Reader');
        await p.key('Tab');
        await until(() => p.evaluate(`document.activeElement?.closest('.message-bar') !== null`), 'laptop: the next Tab goes on to the bar');
      }
      assert.deepEqual(p.errors, []); await p.close();
    }
  });

  await check('reading stacks the Reader\'s star beside its title stars and unstars the message as the card\'s does, and its ⋯ offers Fold message, Unfold message once folded, and no Fold on a starred message', async () => {
    for (const device of Object.keys(DEVICES)) {
      const topic = 'stack-reader-star-' + device;
      const ids = await seed(topic, [['a', { sender: other, join: true, addressees: [facts.actor], body: 'Message A, read in the Reader.', read: true }],
        ['b', { sender: other, addressees: [facts.actor], body: 'Message B, newer.', read: true }]]);
      const p = await open(topic, device, topic, ids.a);
      await openReader(p, device, ids.a, 'Message A');
      assert.deepEqual(glyph(await readerStar(p)), OUTLINE, `${device}: an outline star beside the Reader's title, named and titled`);
      assert.equal(await p.evaluate(`document.getElementById('reader-star').parentElement.contains(document.getElementById('reader-title'))`), true, `${device}: beside the title`);
      if (device === 'phone') {
        const size = await readerStar(p);
        assert.ok(size.width >= 44 && size.height >= 44, `phone: the Reader's star is 44px or more each way under a finger: ${JSON.stringify(size)}`);
      }
      let items = await readerMenu(p, device);
      assert.ok(items.includes('Fold message') && !items.includes('Unfold message'), `${device}: the Reader's ⋯ offers Fold message: ${items}`);
      await shutMenu(p);
      await press(p, device, '#reader-star');
      await until(async () => (await actsOf(topic, ids.a))?.starred === true, `${device}: the Reader's star stars the message, in Core`);
      await becomes(async () => glyph(await readerStar(p)), FILLED, `${device}: the Reader's star is filled`);
      await until(() => p.evaluate(`document.querySelector(${JSON.stringify(card(ids.a))}).dataset.starred === 'true'`), `${device}: and the card agrees`);
      assert.equal((await starOn(p, ids.a))?.text, '★', `${device}: its header shows the filled star`);
      assert.equal((await actsOf(topic, ids.a, other))?.starred ?? false, false, `${device}: another reader sees no star`);
      items = await readerMenu(p, device);
      assert.ok(!items.includes('Fold message') && !items.includes('Unfold message'), `${device}: a starred message's ⋯ offers no Fold: ${items}`);
      await shutMenu(p);
      for (const theme of ['light', 'dark']) {
        await p.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: theme }] });
        await shot(p, `stack-reader-star-${device}-${theme}`);
      }
      await press(p, device, '#reader-star');
      await until(async () => (await actsOf(topic, ids.a))?.starred === false, `${device}: pressed again it unstars, in Core`);
      await becomes(async () => glyph(await readerStar(p)), OUTLINE, `${device}: the outline star again`);
      // A star made on another device while the Reader shows the message: its star follows, with no press here.
      await control({ method: 'stack_act', sender: facts.actor, kind: 'message.star', message_id: ids.a, operation_id: topic + '-elsewhere-star', args: { starred: true } });
      await becomes(async () => glyph(await readerStar(p)), FILLED, `${device}: a star made elsewhere fills the Reader's star`);
      await control({ method: 'stack_act', sender: facts.actor, kind: 'message.star', message_id: ids.a, operation_id: topic + '-elsewhere-unstar', args: { starred: false } });
      await becomes(async () => glyph(await readerStar(p)), OUTLINE, `${device}: and taken off there, the outline again`);
      items = await readerMenu(p, device);
      await choose(p, device, 'Fold message');
      await until(async () => await foldOf(topic, ids.a), `${device}: Fold message folds it for the reader, in Core`);
      assert.equal(await foldOf(topic, ids.a, other), false, `${device}: another reader's view of it is unchanged`);
      assert.match(await readerOn(p) ?? '', /^Message A/, `${device}: the Reader keeps showing it whole`);
      items = await readerMenu(p, device);
      assert.ok(items.includes('Unfold message') && !items.includes('Fold message'), `${device}: once folded the ⋯ offers Unfold message: ${items}`);
      await choose(p, device, 'Unfold message');
      await until(async () => !await foldOf(topic, ids.a), `${device}: Unfold message unfolds it, in Core`);
      await closeReader(p, device);
      await becomes(async () => (await folded(p, ids.a)).whole, true, `${device}: the card reads whole`);
      assert.deepEqual(p.errors, []); await p.close();
    }
  });

  // A link to an older message of a long topic opens it alone in the Reader, its card not loaded: its star and
  // Fold message are there as for any message, and follow a star made elsewhere.
  await check('reading stacks the Reader\'s star and Fold message show for a message the page has not loaded, opened alone from its link', async () => {
    const topic = 'stack-reader-star-alone';
    const ids = await seed(topic, Array.from({ length: 36 }, (_, n) => ['m' + n, { sender: other, ...(n ? {} : { join: true }), addressees: [facts.actor], body: `Message ${n}, of a long topic.`, read: true }]));
    const p = await open(topic, 'laptop', `${topic}&message=${ids.m0}`, ids.m35);
    await until(async () => (await readerOn(p))?.startsWith('Message 0,'), 'the link opens the oldest message in the Reader');
    assert.equal(await p.evaluate(`Boolean(document.querySelector(${JSON.stringify(card(ids.m0))}))`), false, 'the page has not loaded its card: it opened alone');
    await becomes(async () => glyph(await readerStar(p)), OUTLINE, 'an outline star beside the Reader\'s title');
    let items = await readerMenu(p, 'laptop');
    assert.ok(items.includes('Fold message') && !items.includes('Unfold message'), `the Reader's ⋯ offers Fold message: ${items}`);
    await shutMenu(p);
    await press(p, 'laptop', '#reader-star');
    await until(async () => (await actsOf(topic, ids.m0))?.starred === true, 'the Reader\'s star stars it, in Core');
    await becomes(async () => glyph(await readerStar(p)), FILLED, 'the Reader\'s star is filled');
    assert.equal((await actsOf(topic, ids.m0, other))?.starred ?? false, false, 'another reader sees no star');
    items = await readerMenu(p, 'laptop');
    assert.ok(!items.includes('Fold message') && !items.includes('Unfold message'), `a starred message's ⋯ offers no Fold: ${items}`);
    await shutMenu(p);
    await press(p, 'laptop', '#reader-star');
    await until(async () => (await actsOf(topic, ids.m0))?.starred === false, 'pressed again it unstars, in Core');
    await becomes(async () => glyph(await readerStar(p)), OUTLINE, 'the outline star again');
    await control({ method: 'stack_act', sender: facts.actor, kind: 'message.star', message_id: ids.m0, operation_id: topic + '-elsewhere-star', args: { starred: true } });
    await becomes(async () => glyph(await readerStar(p)), FILLED, 'a star made elsewhere fills the Reader\'s star');
    await control({ method: 'stack_act', sender: facts.actor, kind: 'message.star', message_id: ids.m0, operation_id: topic + '-elsewhere-unstar', args: { starred: false } });
    await becomes(async () => glyph(await readerStar(p)), OUTLINE, 'and taken off there, the outline again');
    items = await readerMenu(p, 'laptop');
    await choose(p, 'laptop', 'Fold message');
    await until(async () => await foldOf(topic, ids.m0), 'Fold message folds it for the reader, in Core');
    assert.equal(await foldOf(topic, ids.m0, other), false, 'another reader\'s view of it is unchanged');
    items = await readerMenu(p, 'laptop');
    assert.ok(items.includes('Unfold message') && !items.includes('Fold message'), `once folded the ⋯ offers Unfold message: ${items}`);
    await choose(p, 'laptop', 'Unfold message');
    await until(async () => !await foldOf(topic, ids.m0), 'Unfold message unfolds it, in Core');
    assert.equal(await p.evaluate(`Boolean(document.querySelector(${JSON.stringify(card(ids.m0))}))`), false, 'and its card is still not loaded');
    if (engine === 'chrome') {
      // A star Core refuses (held at the network, the Chrome harness's interception): the Reader's star shows it at
      // once, and the refusal takes it away, so the Reader shows what Core holds.
      const starsSent = payload => payload?.kind === 'message.star';
      await p.send('Fetch.enable', { patterns: [{ urlPattern: facts.origin + '/api/command', requestStage: 'Request' }, { urlPattern: facts.origin + '/api/view', requestStage: 'Response' }] });
      p.intercept(payload => starsSent(payload));
      await press(p, 'laptop', '#reader-star');
      await becomes(async () => glyph(await readerStar(p)), FILLED, 'a press shows the star at once');
      const refused = await until(() => p.held.find(entry => starsSent(entry.payload)), 'the star is on its way');
      p.held.splice(p.held.indexOf(refused), 1);
      p.intercept(null);
      await p.send('Fetch.fulfillRequest', { requestId: refused.event.requestId, responseCode: 200, responseHeaders: [{ name: 'Content-Type', value: 'application/json' }],
        body: Buffer.from(JSON.stringify({ instance_id: facts.instance_id, status: 'rejected', error: { code: 'FORBIDDEN', message: 'Refused for this check.' } })).toString('base64') });
      await becomes(async () => glyph(await readerStar(p)), OUTLINE, 'refused, the Reader\'s star shows no star again');
      assert.equal((await actsOf(topic, ids.m0))?.starred, false, 'and Core holds none');
    } else observations.push({ name: 'stacks Reader star alone refused', engine, held: 'holds Core\'s answer with the Chrome harness\'s request interception, which Safari\'s harness does not offer: a refused star on a message opened alone is checked in Chrome' });
    assert.deepEqual(p.errors, []); await p.close();
  });

  // Item 385: Return on a dossier selected as a whole edits its title, as Rename in ⋯ does.
  await check('reading stacks Return on a selected dossier edits its title: Return saves it, Escape cancels, Return in writing types, and Return on a message still replies', async () => {
    const topic = 'stack-rename-key';
    const ids = await seed(topic, [['root', { sender: other, join: true, addressees: [facts.actor], body: 'Plan the cabin week.', read: true }],
      ['reply', { sender: other, reply_to: 'root', addressees: [facts.actor], body: 'A reply to the plan.', read: true }],
      ['lone', { sender: other, addressees: [facts.actor], body: 'A message on its own.', read: true }]]);
    const p = await open(topic, 'laptop', topic, ids.root);
    await away(p);
    const input = '#messages .reply-stack .stack-rename-input', toggle = `#messages .reply-stack[data-stack="${ids.root}"] > .stack-toggle`;
    const editing = () => p.evaluate(`document.activeElement?.matches?.(${JSON.stringify(input)}) ? document.activeElement.value : null`);
    // What has the keys, for a failure to name: the title's words while it is edited.
    const keysOn = () => p.evaluate(`(()=>{const e=document.activeElement;return e?.matches?.(${JSON.stringify(input)})?e.value:(e?.className||e?.tagName)+' '+(e?.closest?.('[data-id]')?.dataset.id??'')})()`);
    const names = () => p.evaluate(`window.sent.filter(kind=>kind==='stack.name').length`);
    const name = async () => (await look(p, ids, 'root')).name;
    await keyTo(p, ids.root);
    assert.equal((await look(p, ids, 'root')).headOpen, 'false', 'the keys are on the dossier\'s compact header');
    await p.key('Enter');
    await becomes(keysOn, 'Plan the cabin week', 'Return on the selected dossier opens its title to edit, the cursor in it');
    assert.equal(await readerOn(p), null, 'and opens no Reader');
    await p.send('Input.insertText', { text: 'Cabin week' });
    await p.key('Escape');
    await until(async () => !await p.evaluate(`Boolean(document.querySelector(${JSON.stringify(input)}))`), 'Escape cancels the edit');
    assert.equal(await name(), 'Plan the cabin week', 'the title is as it was');
    assert.equal(await names(), 0, 'and nothing is sent');
    assert.equal((await actsOf(topic, ids.root))?.name ?? null, null, 'nor held by Core');
    // Its chevron selected stands for the dossier too.
    await p.evaluate(`document.querySelector(${JSON.stringify(toggle)}).focus({preventScroll:true})`);
    const fold = (await look(p, ids, 'root')).fold;
    await p.key('Enter');
    await becomes(keysOn, 'Plan the cabin week', 'Return on the dossier\'s chevron opens its title to edit');
    assert.equal((await look(p, ids, 'root')).fold, fold, 'and does not press the chevron');
    await p.send('Input.insertText', { text: 'Cabin week' });
    await p.key('Enter');
    await until(async () => (await name()) === 'Cabin week', 'Return in the title saves it');
    await until(async () => (await actsOf(topic, ids.root, other))?.name?.text === 'Cabin week', 'Core holds it for everyone');
    assert.equal(await names(), 1, 'one rename sent: the Return that saved it started no second edit');
    assert.equal(await editing(), null, 'the title is no longer being edited');
    // Fully open, the head shows its whole message: Return there replies, as on any message.
    await centre(p, toggle); await press(p, 'laptop', toggle);
    await becomes(async () => (await look(p, ids, 'root')).headOpen, 'true', 'the dossier fully open, its first message whole');
    await away(p);
    await keyTo(p, ids.root);
    await p.key('Enter');
    await until(async () => (await readerOn(p))?.startsWith('Plan the cabin week.'), 'Return on the head shown whole opens the Reader on it');
    assert.equal(await p.evaluate(`Boolean(document.querySelector(${JSON.stringify(input)}))`), false, 'and edits no title');
    await closeReader(p, 'laptop');
    await keyTo(p, ids.lone);
    await p.key('Enter');
    await until(async () => (await readerOn(p))?.startsWith('A message on its own.'), 'Return on a message on its own replies');
    await closeReader(p, 'laptop');
    // In writing Return is a new line, wherever the keys were.
    await keyTo(p, ids.root);
    await p.key('Enter', 4);
    await until(() => p.evaluate("document.activeElement?.id === 'inline-writing-body'"), 'the new message\'s writing has the cursor');
    await p.send('Input.insertText', { text: 'One' });
    await p.key('Enter');
    await p.send('Input.insertText', { text: 'Two' });
    await until(() => p.evaluate("document.activeElement?.value === 'One\\nTwo'"), 'Return in the writing makes a new line');
    assert.equal(await p.evaluate(`Boolean(document.querySelector(${JSON.stringify(input)}))`), false, 'and edits no title');
    assert.equal(await names(), 1, 'nor renames anything');
    assert.deepEqual(p.errors, []); await p.close();
  });

  // Item 386: a click or a tap in a message, or on a dossier's header, puts the keys there, scrolling nothing.
  await check('reading stacks a click or a tap in a message moves the keys\' place there and scrolls nothing, a click on a dossier\'s header puts them on the dossier, and a press in writing keeps the cursor', async () => {
    for (const device of Object.keys(DEVICES)) {
      const topic = 'stack-click-keys-' + device;
      const ids = await seed(topic, [['root', { sender: other, join: true, addressees: [facts.actor], body: 'The dossier\'s first message.', read: true }],
        ['one', { sender: other, reply_to: 'root', addressees: [facts.actor], body: 'Reply one.', read: true }],
        ['two', { sender: other, reply_to: 'root', addressees: [facts.actor], body: 'Reply two.', read: true }],
        ['folded', { sender: other, addressees: [facts.actor], body: 'A folded message whose 👍 is pressed.', read: true }],
        ...[1, 2, 3, 4, 5, 6].map(n => ['m' + n, { sender: other, addressees: [facts.actor], body: `Message ${n} on its own.\n` + 'Words to read, enough for a card of a few lines. '.repeat(3), read: true }])]);
      await control({ method: 'stack_act', sender: facts.actor, kind: 'message.fold', message_id: ids.folded, operation_id: topic + '-fold', args: { folded: true } });
      const p = await open(topic, device, topic, ids.root);
      if (device === 'laptop') await away(p);
      const at = () => p.evaluate(`(()=>{const e=document.activeElement;return e?.matches?.('.stack-toggle')?'stack:'+e.closest('.reply-stack').dataset.stack:e?.matches?.('#messages .message-card')?e.dataset.id:e?.closest?.('#messages [data-id]')?'in:'+e.closest('[data-id]').dataset.id:e?.id||e?.tagName})()`);
      await becomes(async () => (await folded(p, ids.folded)).row, true, `${device}: the folded message shows as its row`);
      await keyTo(p, ids.m6);
      assert.equal(await at(), ids.m6, `${device}: the keys are on the newest message`);
      // The folded row stands at the foot of the window, its card reaching just past it, where moving the keys there would scroll.
      const thumb = card(ids.folded) + ' > .message-folded > .folded-thumb';
      // The window's foot between the 👍's bottom and the card's.
      const edges = await p.evaluate(`(()=>{const c=document.querySelector(${JSON.stringify(card(ids.folded))}).getBoundingClientRect(),t=document.querySelector(${JSON.stringify(thumb)}).getBoundingClientRect();
        scrollBy({top:Math.round((c.bottom+t.bottom)/2-innerHeight),behavior:'instant'});
        const c2=document.querySelector(${JSON.stringify(card(ids.folded))}).getBoundingClientRect(),t2=document.querySelector(${JSON.stringify(thumb)}).getBoundingClientRect();
        return {card:c2.bottom,thumb:t2.bottom,foot:innerHeight}})()`);
      assert.ok(edges.card > edges.foot && edges.thumb <= edges.foot, `${device}: the row's 👍 shows and its card runs just past the window's foot: ${JSON.stringify(edges)}`);
      const still = await p.evaluate('scrollY');
      if (device === 'laptop' && engine === 'chrome') {
        // A press with no move before it, so the pointer's resting place (item 387) plays no part.
        const b = await p.box(thumb), x = b.x + b.width / 2, y = b.y + b.height / 2;
        await p.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
        await p.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
      } else await press(p, device, thumb);
      await until(async () => await thumbedBy(ids.folded), `${device}: the press acts: the row's 👍 gives the thumbs-up, in Core`);
      await becomes(at, ids.folded, `${device}: the press puts the keys on the message it fell in, its card itself`);
      assert.equal(await p.evaluate('scrollY'), still, `${device}: and the page stays where it is`);
      assert.equal(await readerOn(p), null, `${device}: nothing opened`);
      // The keys act there: x unfolds the message pressed, not the one the keys were on before.
      await typeX(p);
      await until(async () => !await foldOf(topic, ids.folded), `${device}: x unfolds the message the press put the keys on, in Core`);
      await becomes(async () => (await folded(p, ids.folded)).whole, true, `${device}: and the page shows it whole, so what is below it has moved before it is pressed`);
      assert.equal(await foldOf(topic, ids.m6), false, `${device}: and folds nothing where the keys were`);
      if (device === 'laptop') {
        // Fully open, a click on the dossier's tab row folds it to latest plus unread and puts the keys on the dossier:
        // its head, which shows as one row again and stands for it.
        const toggle = `#messages .reply-stack[data-stack="${ids.root}"] > .stack-toggle`;
        await centre(p, toggle);
        if ((await look(p, ids, 'root')).fold !== 'open') await press(p, 'laptop', toggle);
        await becomes(async () => [(await look(p, ids, 'root')).fold, (await look(p, ids, 'root')).headOpen], ['open', 'true'], 'laptop: the dossier fully open');
        await keyTo(p, ids.m1);
        const before = await p.evaluate('scrollY');
        const row = card(ids.root) + ' > .stack-head .stack-who';
        if (engine === 'chrome') {
          const b = await p.box(row), x = b.x + Math.min(12, b.width / 2), y = b.y + b.height / 2;
          await p.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
          await p.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
        } else await p.point(row);
        await becomes(async () => (await look(p, ids, 'root')).fold, 'folded', 'laptop: the click on the tab row folds the dossier to latest plus unread, as before');
        await becomes(at, ids.root, 'laptop: and puts the keys on the dossier, its head shown as one row');
        assert.equal((await look(p, ids, 'root')).headOpen, 'false', 'laptop: the head shows as its row');
        assert.equal(await p.evaluate('scrollY'), before, 'laptop: the page stays where it is');
        await p.key('ArrowDown');
        await becomes(at, ids.two, 'laptop: ↓ goes on from the dossier, to its shown reply');
      }
      // A press in writing keeps the cursor there.
      await p.evaluate(`document.querySelector('#inline-writing-body').scrollIntoView({block:'center'})`);
      await press(p, device, '#inline-writing-body');
      await until(() => p.evaluate(`document.activeElement?.id === 'inline-writing-body'`), `${device}: a press in the writing puts the cursor there`);
      assert.deepEqual(p.errors, []); await p.close();
    }
  });

  // Item 387: the pointer moving onto a message or a dossier gives it the keys' place.
  await check('reading stacks the pointer moving onto a message or a dossier gives it the keys\' place, scrolling nothing; not while the keys move under a still pointer, nor from writing, and never by touch', async () => {
    const topic = 'stack-hover-keys';
    const body = name => name + '\n' + Array.from({ length: 8 }, (_, n) => `Line ${n + 1} of a message that makes the page scroll.`).join('\n');
    const ids = await seed(topic, [['root', { sender: other, join: true, addressees: [facts.actor], body: 'Plan the boat trip.', read: true }],
      ['reply', { sender: other, reply_to: 'root', addressees: [facts.actor], body: 'A reply to the plan.', read: true }],
      ...[1, 2, 3, 4, 5, 6].map(n => ['m' + n, { sender: other, addressees: [facts.actor], body: body(`Message ${n}`), read: true }])]);
    const p = await open(topic, 'laptop', topic, ids.root);
    await away(p);
    const at = () => p.evaluate(`(()=>{const e=document.activeElement;return e?.matches?.('#messages .message-card')?e.dataset.id:e?.id||e?.tagName})()`);
    await keyTo(p, ids.m6);
    // A message reaching into the bottom tenth of the window, where the keys would scroll it.
    await p.evaluate(`(()=>{const c=document.querySelector(${JSON.stringify(card(ids.m3))});scrollBy({top:c.getBoundingClientRect().top-innerHeight*0.85,behavior:'instant'})})()`);
    const still = await p.evaluate('scrollY');
    await p.point(words(ids.m3), 'move');
    await becomes(at, ids.m3, 'the pointer moving onto a message puts the keys on it');
    assert.equal(await p.evaluate('scrollY'), still, 'and the page stays where it is');
    assert.ok((await lit(p)).includes(ids.m3), 'it is lit');
    // The keys act there: x folds the message under the pointer.
    await typeX(p);
    await until(async () => await foldOf(topic, ids.m3), 'x folds the message the pointer moved onto, in Core');
    assert.equal(await foldOf(topic, ids.m6), false, 'and not the one the keys were on before');
    await typeX(p);
    await until(async () => !await foldOf(topic, ids.m3), 'x again unfolds it');
    // A dossier's compact header: the pointer on it gives the dossier the keys, and Return edits its title.
    await centre(p, card(ids.root));
    await p.point(card(ids.root) + ' > .stack-head .stack-who', 'move');
    await becomes(at, ids.root, 'the pointer on the dossier\'s compact header puts the keys on the dossier');
    await p.key('Enter');
    await until(() => p.evaluate(`document.activeElement?.matches?.('.stack-rename-input')`), 'Return edits the hovered dossier\'s title');
    await p.key('Escape');
    await until(() => p.evaluate(`!document.querySelector('.stack-rename-input')`), 'Escape cancels it');
    // Keys in use under a still pointer: the page scrolls under it, and the keys keep their place.
    await keyTo(p, ids.m5);
    await p.evaluate(`document.querySelector(${JSON.stringify(card(ids.m5))}).scrollIntoView({block:'start'})`);
    const x = await p.evaluate(`document.querySelector('#messages').getBoundingClientRect().left + 100`), y = await p.evaluate('Math.round(innerHeight*0.15)');
    await p.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
    await p.evaluate(`document.querySelector(${JSON.stringify(card(ids.m5))}).focus({preventScroll:true})`);
    for (const expected of [ids.m4, ids.m3, ids.m2, ids.m1]) {
      await p.key('ArrowDown');
      await twoFrames(p);
      // WebKit can report a same-position pointermove after scrolling settles, about 100ms later.
      await new Promise(resolve => setTimeout(resolve, 400));
      assert.equal(await at(), expected, '↓ moves the keys one message on, whatever the page brings under the still pointer');
    }
    const under = await p.evaluate(`(()=>{const e=document.elementFromPoint(${x},${y});return e?.closest('#messages .message-card')?.dataset.id??null})()`);
    assert.ok(under && under !== ids.m1, `another message is under the resting pointer (${under})`);
    await p.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: x + 2, y });
    await becomes(at, under, 'once the pointer really moves, the message under it takes the keys');
    // Writing keeps the cursor: the pointer crossing the messages takes nothing from it.
    await p.evaluate(`document.querySelector('#inline-writing-body').scrollIntoView({block:'end'})`);
    await p.point('#inline-writing-body');
    await until(() => p.evaluate(`document.activeElement?.id === 'inline-writing-body'`), 'the cursor is in the writing');
    await p.send('Input.insertText', { text: 'Half written' });
    for (const id of [ids.m1, ids.m2]) { await centre(p, card(id)); await p.point(words(id), 'move'); await twoFrames(p); }
    assert.equal(await at(), 'inline-writing-body', 'the pointer moving over the messages leaves the cursor in the writing');
    assert.equal(await p.evaluate(`document.querySelector('#inline-writing-body').value`), 'Half written', 'and the writing as it was');
    // The writing's own controls and panels keep the keys too: Who sees this message, opened by the keys, keeps
    // them on its choice while the pointer moves over a message, and Return there opens no Reader.
    await p.evaluate(`document.getElementById('inline-who-chip').focus()`);
    await p.key('Enter');
    await until(() => p.evaluate(`(w=>!w.hidden&&w.contains(document.activeElement))(document.getElementById('inline-who-panel'))`), 'Return on the who chip opens Who sees this message, the keys on its choice');
    const choice = () => p.evaluate(`(e=>document.getElementById('inline-who-panel').contains(e)?e.textContent:(e?.className||e?.tagName)+' '+(e?.dataset?.id??''))(document.activeElement)`);
    const chosen = await choice();
    const left = await p.evaluate(`Math.round(document.querySelector('#messages').getBoundingClientRect().left + 60)`);
    for (const y of [120, 160, 200]) {
      assert.ok(await p.evaluate(`Boolean(document.elementFromPoint(${left},${y})?.closest('#messages .message-card'))`), `a message is under the pointer at ${y}`);
      await p.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: left, y }); await twoFrames(p);
    }
    assert.equal(await choice(), chosen, 'the pointer moving over a message leaves the keys on the panel\'s choice');
    await p.key('Enter');
    await twoFrames(p);
    assert.equal(await readerOn(p), null, 'and Return there opens no Reader');
    if (await p.evaluate(`!document.getElementById('inline-who-panel').hidden`)) await p.key('Escape');
    // A press on a message's bar while writing acts and leaves the cursor in the writing.
    await p.point('#inline-writing-body');
    await until(() => p.evaluate(`document.activeElement?.id === 'inline-writing-body'`), 'the cursor is back in the writing');
    await centre(p, card(ids.m2));
    await p.point(words(ids.m2), 'move');
    await until(async () => (await lit(p)).includes(ids.m2), 'the pointer lights a message, its bar showing');
    await p.point('.message-bar [data-act=thumb]');
    await until(async () => await thumbedBy(ids.m2), 'the bar\'s 👍 gives the thumbs-up, in Core');
    assert.equal(await at(), 'inline-writing-body', 'and the cursor stays in the writing');
    assert.deepEqual(p.errors, []); await p.close();
    if (engine !== 'chrome') { observations.push({ name: 'stacks hover keys touch', engine, held: 'Safari\'s engine in the harness has no finger drag: that a finger moving over the messages moves no keys is checked in Chrome' }); return; }
    // A finger moving over the messages, scrolling, gives nothing the keys' place.
    const q = await open(topic + '-phone', 'phone', topic, ids.root);
    await centre(q, card(ids.m4));
    await tap(q, words(ids.m4));
    await until(async () => (await lit(q)).includes(ids.m4), 'phone: a tap lights a message');
    const placed = await q.evaluate(`document.activeElement?.closest?.('#messages [data-id]')?.dataset.id ?? document.activeElement?.tagName`);
    const fingerScroll = async () => {
      const b = await q.box(card(ids.m2)), cx = b.x + b.width / 2, cy = Math.min(b.y + b.height / 2, 600), t0 = Date.now() / 1000;
      await q.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: cx, y: cy }], timestamp: t0 });
      for (const part of [1, 2, 3, 4]) await q.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: cx, y: cy - 40 * part }], timestamp: t0 + 0.05 * part });
      await q.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [], timestamp: t0 + 0.3 });
    };
    await centre(q, card(ids.m2));
    await fingerScroll();
    await twoFrames(q);
    assert.equal(await q.evaluate(`document.activeElement?.closest?.('#messages [data-id]')?.dataset.id ?? document.activeElement?.tagName`), placed, 'phone: a finger moving over other messages moves no keys');
    assert.deepEqual(await lit(q), [ids.m4], 'phone: nor the light');
    assert.deepEqual(q.errors, []); await q.close();
  });

  // Item 382: the feed's view filters sit at the right of one row, "N messages marked unread · Read it" at its left.
  await check('reading stacks the feed\'s view filter sits at the right of the row "N messages marked unread · Read it" heads, at a laptop\'s width and a phone\'s, wrapping only when the row cannot hold both, and the row takes no room when nothing in it shows', async () => {
    const row = p => p.evaluate(`(()=>{const box=e=>{if(!e||!e.getClientRects().length)return null;const b=e.getBoundingClientRect();
      return {left:Math.round(b.left),right:Math.round(b.right),top:Math.round(b.top),bottom:Math.round(b.bottom),mid:Math.round((b.top+b.bottom)/2),width:Math.round(b.width),height:Math.round(b.height)}};
      const r=document.querySelector('.feed-filters'),l=document.getElementById('messages').getBoundingClientRect();
      return {row:box(r),marks:box(document.getElementById('topic-marks')),chip:box(document.querySelector('#agent-coordination-show button')),
        list:{left:Math.round(l.left),right:Math.round(l.right)},gap:r?parseFloat(getComputedStyle(r).columnGap)||0:0,scroll:document.scrollingElement.scrollWidth,width:innerWidth}})()`);
    for (const device of Object.keys(DEVICES)) {
      const topic = 'stack-filter-row-' + device;
      const ids = await seed(topic, [['primer', { sender: 'aim-ux', join: true, addressees: [facts.actor], body: 'Ready for this topic.', read: true }],
        ['root', { sender: 'aim-core', join: true, addressees: ['aim-ux'], body: 'Between agents only.', read: true }],
        ['reply', { sender: 'aim-ux', addressees: ['aim-core'], reply_to: 'root', body: 'Checked between us.', read: true }],
        ['mine', { sender: 'aim-core', addressees: [facts.actor], body: 'One to mark unread.', read: true }]]);
      await control({ method: 'mark', operation_id: topic + '-mark', message_ids: [ids.mine], marked: true });
      const p = await open(topic, device, topic, ids.mine);
      const both = await until(async () => { const r = await row(p); return r.marks && r.chip && r; }, `${device}: "1 message marked unread · Read it" and Show agent coordination show`);
      assert.ok(both.row, `${device}: they share one row above the feed: ${JSON.stringify(both)}`);
      assert.ok(Math.abs(both.marks.left - both.list.left) <= 2, `${device}: "Read it" at the row's left: ${JSON.stringify(both)}`);
      assert.ok(Math.abs(both.list.right - both.chip.right) <= 2, `${device}: the filter at its right: ${JSON.stringify(both)}`);
      const fits = both.marks.width + both.gap + both.chip.width <= both.row.width;
      if (device === 'laptop') assert.ok(fits, `laptop: the row holds both: ${JSON.stringify(both)}`);
      if (fits) assert.ok(Math.abs(both.marks.mid - both.chip.mid) <= 4, `${device}: side by side, on one line: ${JSON.stringify(both)}`);
      else assert.ok(both.chip.top >= both.marks.bottom - 1 && both.chip.top - both.marks.bottom <= 12, `${device}: the row cannot hold both, so the filter wraps just under, at the right: ${JSON.stringify(both)}`);
      assert.ok(both.scroll <= both.width, `${device}: nothing scrolls sideways (${both.scroll} of ${both.width})`);
      for (const theme of ['light', 'dark']) {
        await p.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: theme }] });
        await shot(p, `stack-filter-row-${device}-${theme}`);
      }
      // Read it gone, the filter keeps the row, at its right.
      await control({ method: 'mark', operation_id: topic + '-clear', message_ids: [ids.mine], marked: false });
      const alone = await until(async () => { const r = await row(p); return !r.marks && r.chip && r; }, `${device}: the mark cleared, Read it goes`);
      assert.ok(Math.abs(alone.list.right - alone.chip.right) <= 2, `${device}: the filter alone stays at the right: ${JSON.stringify(alone)}`);
      assert.ok(alone.row.height <= alone.chip.height + 2, `${device}: and the row is one line: ${JSON.stringify(alone)}`);
      assert.deepEqual(p.errors, []); await p.close();
    }
    // Nothing in the row: it takes no room.
    const topic = 'stack-filter-row-empty';
    const ids = await seed(topic, [['plain', { sender: 'aim-core', join: true, addressees: [facts.actor], body: 'A plain message, nothing to filter.', read: true }]]);
    const p = await open(topic, 'laptop', topic, ids.plain);
    const empty = await row(p);
    assert.deepEqual([empty.marks, empty.chip, empty.row], [null, null, null], `with nothing to show, the row takes no room: ${JSON.stringify(empty)}`);
    assert.deepEqual(p.errors, []); await p.close();
  });
}

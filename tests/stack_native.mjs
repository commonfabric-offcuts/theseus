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
  const { seed, open, becomes, centre, tap, press, lit, readerOn, closeReader, light, openReader, entry, card, words, DEVICES } = helpers;
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
        rows:[...s.querySelector(':scope > .stack-replies').children].filter(shown).map(e=>e.dataset.id?names[e.dataset.id]:e.classList.contains('stack-fold-line')?'fold: '+e.textContent:e.classList.contains('stack-join-line')?'join: '+e.querySelector('.stack-join-words').textContent.replace(/, .*$/,''):e.className)}})()`);
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
      const way = await p.evaluate(`(()=>{const at=document.activeElement?.closest?.('#messages [data-id]'),to=document.querySelector(${JSON.stringify(card(id))});
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
  const choose = async (p, device, label) => {
    const at = await p.evaluate(`[...document.querySelectorAll('.message-menu-list button')].findIndex(b=>b.firstChild.textContent===${JSON.stringify(label)})`);
    assert.ok(at >= 0, `${label} is in the menu`);
    await press(p, device, `.message-menu-list button:nth-of-type(${at + 1})`);
  };

  await check('reading stacks read as a chat: the head on top as one row, replies oldest first, a line for each folded run with its new count in red, and a press on the head shows its full message', async () => {
    for (const device of Object.keys(DEVICES)) {
      const topic = 'stack-chat-' + device;
      const ids = await seed(topic, [['root', { sender: other, join: true, addressees: [facts.actor], body: 'Can we lock the cabin for July 12?\nThe owner wants an answer by Friday.' }],
        ['one', { sender: other, reply_to: 'root', addressees: [facts.actor], body: 'Reply one.' }],
        ['two', { sender: 'aim-ux', join: true, reply_to: 'root', addressees: [facts.actor], body: 'Reply two, starred.' }],
        ['three', { sender: other, reply_to: 'root', addressees: [facts.actor], body: 'Reply three.' }],
        ['four', { sender: other, reply_to: 'root', addressees: [facts.actor], body: 'Reply four.', read: true }],
        ['five', { sender: other, reply_to: 'two', addressees: [facts.actor], body: 'Reply five, to reply two, unread.' }],
        ['six', { sender: other, reply_to: 'root', addressees: [facts.actor], body: 'Reply six, the newest, unread.' }]]);
      await control({ method: 'stack_act', sender: facts.actor, kind: 'message.star', message_id: ids.two, operation_id: topic + '-star', args: { starred: true } });
      const p = await open('stack-chat-' + device, device, topic, ids.root);
      // Read through four; five and six are unread and in view. Two, starred, stays in view in its place in time; each run either side folds behind a line of its own.
      await becomes(() => look(p, ids, 'root'), { fold: 'folded', headOpen: 'false', placed: 'false', head: 'root', name: 'Can we lock the cabin for July 12?',
        meta: `6 replies · ${other}, aim-ux · 2 new`, isNew: false, full: false, rows: ['fold: 1 earlier reply', 'two', 'fold: 2 more replies', 'five', 'six'] },
        device + ': the head is one row; the replies oldest first, the starred one and the unread ones in view where they sit, a line for each folded run');
      await shot(p, 'stack-chat-' + device);
      // ⌘← (on a laptop) folds to the head alone: the line then counts the unread in red.
      if (device === 'laptop') {
        await keyTo(p, ids.root);
        await p.key('ArrowLeft', 4);
        await becomes(async () => (await look(p, ids, 'root')).rows, ['fold: 1 earlier reply', 'two', 'fold: 4 more replies · 2 new'], 'laptop: ⌘← on the head folds to the head and the starred reply; the line counts 2 new');
        assert.equal(await p.evaluate(`getComputedStyle(document.querySelector('#messages .stack-fold-new')).color`), await alertColour(p), 'laptop: the count is in the alert red');
        await p.key('ArrowRight', 4);
        await until(async () => (await look(p, ids, 'root')).full, 'laptop: ⌘→ on the head first shows its full message');
        await p.key('ArrowRight', 4);
        await becomes(async () => (await look(p, ids, 'root')).rows, ['fold: 1 earlier reply', 'two', 'fold: 2 more replies', 'five', 'six'], 'laptop: ⌘→ again opens the replies a step');
        await p.key('ArrowLeft', 4); await p.key('ArrowLeft', 4);
        await until(async () => !(await look(p, ids, 'root')).full && (await look(p, ids, 'root')).fold === 'head', 'laptop: ⌘← ⌘← fold it back to the head and hide its full message');
        await p.key('z', 4);
        await until(async () => (await look(p, ids, 'root')).fold === 'folded', 'laptop: ⌘Z undoes the last fold');
      }
      // A press on the head's row shows the full message under it, and Hide the full message hides it; nothing opens.
      // On a phone a first tap lights the head, as on any card, and the second is the press.
      await centre(p, card(ids.root));
      if (device === 'phone') {
        await tap(p, `${card(ids.root)} .stack-who`);
        await until(async () => (await lit(p)).includes(ids.root), 'phone: a first tap lights the head');
        assert.equal((await look(p, ids, 'root')).full, false, 'phone: and shows nothing more');
      }
      await press(p, device, `${card(ids.root)} .stack-who`);
      await until(async () => (await look(p, ids, 'root')).full, device + ': a press on the head shows the full message');
      assert.equal(await readerOn(p), null, device + ': and opens no Reader');
      await press(p, device, `${card(ids.root)} .stack-hide`);
      await until(async () => !(await look(p, ids, 'root')).full, device + ': Hide the full message hides it');
      // A press on a fold line opens every reply; again folds them.
      const line = `#messages .reply-stack[data-stack="${ids.root}"] .stack-fold-line`;
      await centre(p, line);
      await press(p, device, line);
      await becomes(async () => (await look(p, ids, 'root')).rows, ['fold: Fold 3 earlier replies', 'one', 'two', 'three', 'four', 'five', 'six'], device + ': a fold line opens every reply, oldest first');
      assert.equal(await readerOn(p), null, device + ': the line opens no message');
      assert.deepEqual(p.errors, []);
      await p.close();
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
    await becomes(async () => (await look(p, ids, 'root')).rows, ['fold: 2 earlier replies', 'three'], 'read through: the newest reply alone shows');
    await press(p, 'laptop', `#messages .reply-stack .stack-fold-line`);
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
    // Folded to its head (⌘←, ⌘←), the starred reply still shows.
    await keyTo(p, ids.root);
    await p.key('ArrowLeft', 4); await p.key('ArrowLeft', 4);
    await becomes(async () => (await look(p, ids, 'root')).rows, ['one', 'fold: 2 more replies'], 'folded to the head, the starred reply stays in view in its place');
    assert.equal(await p.evaluate(`getComputedStyle(document.querySelector(${JSON.stringify(card(ids.one) + ' > .message-author')}),'::after').content`), '"★ Starred"');
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
    // Unstarred, it folds with the stack's head again; opened, starred again, the rail's own Unstar takes it off too.
    await press(p, 'laptop', `#messages .reply-stack[data-stack="${ids.root}"] .stack-fold-line`);
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
    await becomes(async () => (await look(p, ids, 'top')).rows, ['topReply', 'join: Joined from its own stack by You', 'old', 'oldReply'],
      'its messages come after the replies, its first message in view with a join line, and its reply, in view before, still in view');
    assert.match(await said(p), /Joined to the stack above/, 'a screen reader hears the join');
    await until(async () => (await actsOf(topic, ids.old, other))?.joined?.into === ids.top, 'Core holds the join for everyone');
    assert.equal((await actsOf(topic, ids.old, other)).joined.by, facts.actor, 'with who joined it');
    await p.point(`#messages .stack-join-line .stack-split`);
    await becomes(() => stacks(p, ids), ['top', 'old'], 'Split back out takes it out again');
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
    assert.deepEqual(await lit(p), [ids.a], 'A stays lit while the person writes');
    await until(() => p.evaluate(`document.activeElement?.id === 'inline-writing-body'`), 'the cursor is in the topic\'s writing');
    await p.send('Input.insertText', { text: 'Writing a reply' });
    for (const [key, modifiers] of [['ArrowUp', 4], ['ArrowDown', 4], ['ArrowUp', 12], ['ArrowLeft', 4], ['z', 4]]) await p.key(key, modifiers);
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
    assert.ok(items.includes('Star for me') && items.includes('Fold into earlier replies') && items.at(-1) === 'Move or join…', `phone: the acts, then Move or join…: ${items}`);
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
    await becomes(async () => (await look(p, ids, 'root')).rows, ['fold: 2 earlier replies', 'three'], 'coming back, the replies up to the thumbs-up fold, read');
    assert.deepEqual(p.errors, []);
    await p.close();
  });

  await check('reading stacks a reply arriving shows under the newest, which stays in view until coming back', async () => {
    const topic = 'stack-arrive';
    const ids = await seed(topic, [['root', { sender: other, join: true, addressees: [facts.actor], body: 'The root.' }],
      ['one', { sender: other, reply_to: 'root', addressees: [facts.actor], body: 'Reply one, read.', read: true }],
      ['two', { sender: other, reply_to: 'root', addressees: [facts.actor], body: 'Reply two, read.', read: true }]]);
    let p = await open('stack-arrive', 'laptop', topic, ids.root);
    await becomes(async () => (await look(p, ids, 'root')).rows, ['fold: 1 earlier reply', 'two'], 'the newest reply shows, the earlier one folded');
    ids.three = (await control({ method: 'agent_message', operation_id: 'stack-arrive-three', topic_id: topic, source: 'topic', sender: other,
      reply_to: ids.root, addressees: [facts.actor], body: 'Reply three, read.', read: true })).result.message_id;
    await becomes(async () => (await look(p, ids, 'root')).rows, ['fold: 1 earlier reply', 'two', 'three'], 'the new reply shows under two, which does not fold under the person\'s eyes');
    await p.close();
    p = await open('stack-arrive-back', 'laptop', topic, ids.root);
    await becomes(async () => (await look(p, ids, 'root')).rows, ['fold: 2 earlier replies', 'three'], 'coming back, two folds with the earlier reply');
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
    await becomes(async () => (await look(p, ids, 'root')).rows, ['fold: 1 earlier reply', 'two'], 'reply one is folded away');
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

  if (engine === 'chrome') await check('reading stacks a reply swiped to the right on a phone folds into the earlier replies', async () => {
    const topic = 'stack-swipe';
    const ids = await seed(topic, [['root', { sender: other, join: true, addressees: [facts.actor], body: 'The root.' }],
      ['one', { sender: other, reply_to: 'root', addressees: [facts.actor], body: 'Reply one, unread.' }],
      ['two', { sender: other, reply_to: 'root', addressees: [facts.actor], body: 'Reply two, unread.' }]]);
    const p = await open('stack-swipe', 'phone', topic, ids.root);
    await becomes(async () => (await look(p, ids, 'root')).rows, ['one', 'two'], 'phone: both unread replies in view');
    await centre(p, card(ids.one));
    const b = await p.box(card(ids.one));
    const y = b.y + b.height / 2;
    await p.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: b.x + 20, y }] });
    await p.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: b.x + 90, y }] });
    await p.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: b.x + 160, y }] });
    await p.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await becomes(async () => (await look(p, ids, 'root')).rows, ['fold: 1 earlier reply · 1 new', 'two'], 'phone: swiped right, reply one folds into the earlier replies');
    assert.deepEqual(p.errors, []);
    await p.close();
  });
  else observations.push({ name: 'stacks swipe', engine, held: 'Safari\'s engine in this harness has a tap but no finger drag: the swipe is checked in Chrome' });
}

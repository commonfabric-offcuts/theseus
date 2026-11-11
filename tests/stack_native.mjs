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
      // Another press on the tab hides it again; "Hide the full message" is its words for a screen reader.
      await press(p, device, `${card(ids.root)} .stack-who`);
      await until(async () => !(await look(p, ids, 'root')).full, device + ': another press on the head row hides it');
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
    assert.match(await p.evaluate(`getComputedStyle(document.querySelector(${JSON.stringify(card(ids.one) + ' > .message-author')}),'::after').content`), /★/, 'the starred reply shows its star after its author');
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
    await becomes(async () => (await look(p, ids, 'top')).rows, ['topReply', 'join: Joined from its own stack by You', 'old', 'oldReply'],
      'its messages come after the replies, its first message in view with a join line, and its reply, in view before, still in view');
    // The joined stack's first message heads nothing now: its head row goes, and it reads as a card.
    const headed = id => p.evaluate(`(()=>{const c=document.querySelector(${JSON.stringify(card(id))});return {row:Boolean(c.querySelector(':scope > .stack-head')),head:c.classList.contains('stack-head-card')}})()`);
    assert.deepEqual(await headed(ids.old), { row: false, head: false }, 'the joined stack\'s first message keeps no head row');
    assert.equal(await p.evaluate(`document.querySelectorAll('#messages .stack-replies .stack-head').length`), 0, 'no head row inside a stack\'s replies');
    assert.match(await said(p), /Joined to the stack above/, 'a screen reader hears the join');
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

  await check('reading stacks the reply line sits at the foot of an open stack, and of a folded one only while the keys or the pointer are in it; a press, a tap or Return on it opens the Reader replying to the stack\'s newest message', async () => {
    for (const device of Object.keys(DEVICES)) {
      const topic = 'stack-reply-line-' + device;
      const ids = await seed(topic, [['root', { sender: other, join: true, addressees: [facts.actor], body: 'Where do we keep the boat keys?', read: true }],
        ['one', { sender: other, reply_to: 'root', addressees: [facts.actor], body: 'In the drawer.', read: true }],
        ['two', { sender: 'aim-ux', join: true, reply_to: 'root', addressees: [facts.actor], body: 'Or the hook.', read: true }],
        ['three', { sender: other, reply_to: 'root', addressees: [facts.actor], body: 'The hook, by the door, the newest reply.', read: true }],
        ['near', { sender: other, addressees: [facts.actor], body: 'Another stack.', read: true }],
        ['nearReply', { sender: other, reply_to: 'near', addressees: [facts.actor], body: 'Its reply.', read: true }]]);
      const p = await open(topic, device, topic, ids.root);
      const stack = `#messages .reply-stack[data-stack="${ids.root}"]`, foot = `${stack} > .stack-foot`, line = `${foot} > .stack-reply`;
      const footing = () => p.evaluate(`(()=>{const s=document.querySelector(${JSON.stringify(stack)}),f=s?.querySelector(':scope > .stack-foot');
        return {fold:s?.dataset.fold,shown:Boolean(f?.getClientRects().length),last:s?.lastElementChild===f,words:f?.querySelector('.stack-reply-words')?.textContent??null}})()`);
      const replying = async message => {
        await until(async () => (await readerOn(p))?.startsWith('The hook, by the door'), `${device}: ${message}: the Reader opens on the stack's newest message`);
        await until(() => p.evaluate(`document.activeElement?.id === 'writing-body'`), `${device}: ${message}: with the cursor in the reply`);
        await closeReader(p, device);
      };
      // What the device has: a pointer that rests (Chrome at laptop size), or touch alone (a phone, and every WebKit context).
      const { hovers, fine } = await p.evaluate(`({hovers:matchMedia('(hover:hover)').matches,fine:matchMedia('(pointer:fine)').matches&&innerWidth>760})`);
      // Folded, with neither the keys, a tap's light nor the pointer in it: no reply line.
      if (device === 'laptop') await away(p);
      await p.evaluate('document.activeElement?.blur()');
      await becomes(footing, { fold: 'folded', shown: false, last: true, words: 'Reply in this stack…' }, `${device}: a folded stack the person is not in shows no reply line, though it is there, last`);
      // The pointer resting on its newest reply, or a finger's tap on it, shows it at the foot.
      await light(p, device, ids.three);
      await becomes(async () => (await footing()).shown, true, `${device}: the pointer or a tap in a folded stack shows its reply line`);
      // With a pointer, it goes once the pointer leaves, the keys not in it. On a touch screen the tap landed in it,
      // and it stays (Safari's engine gives a tapped card no focus, so this holds without the keys too).
      if (hovers) { await p.evaluate('document.activeElement?.blur()'); await away(p); }
      await becomes(async () => (await footing()).shown, !hovers, `${device}: ${hovers ? 'the pointer gone, the keys not in it, hides it' : 'the tap that landed in it keeps it'}`);
      if (!hovers) {
        // A tap on it, which lets the light go, leaves it under the finger, and opens the Reader replying.
        assert.equal(await p.evaluate(`getComputedStyle(document.querySelector(${JSON.stringify(line + ' .stack-key')})).display`), 'none', `${device}: touch alone names no key`);
        await tap(p, line);
        await replying('a tap on the reply line');
        await p.evaluate('document.activeElement?.blur()');
      }
      // The light in another stack, with the pointer gone, hides it. A tap that then lets the light go (on the fold
      // line below) moves nothing under the finger: the other stack keeps its reply line until the light is elsewhere.
      await light(p, device, ids.nearReply);
      if (hovers) await away(p);
      await p.evaluate('document.activeElement?.blur()');
      await becomes(async () => (await footing()).shown, false, `${device}: the light in another stack hides it`);
      if (device === 'laptop') {
        // The keys in it show it; Tab reaches it after the stack's last message and its bar, and Return on it replies.
        // Safari's engine leaves buttons out of Tab's order, as Safari does by default: there the keys are put on it.
        await keyTo(p, ids.three);
        if (hovers) await away(p);
        await becomes(async () => (await footing()).shown, true, 'laptop: the keys in a folded stack show its reply line');
        if (engine === 'chrome') {
          for (let step = 0; step < 12 && !await p.evaluate(`document.activeElement?.matches('.stack-reply')`); step++) await p.key('Tab');
          assert.equal(await p.evaluate(`document.activeElement === document.querySelector(${JSON.stringify(line)})`), true, 'laptop: Tab from the stack\'s last message reaches its reply line');
          assert.equal(await p.evaluate(`getComputedStyle(document.querySelector(${JSON.stringify(line + ' .stack-key')})).display !== 'none'`), fine, `laptop: holding the keys, it ${fine ? 'names Return' : 'names no key on a touch screen'}`);
          await p.key('Enter');
          await replying('Return on the reply line');
          await p.evaluate('document.activeElement?.blur()');
        } else {
          // Safari's engine leaves buttons out of Tab's order and, in this harness, keeps the keys off a button put
          // there by focus(): what it gives is recorded, and the press is a tap below.
          await p.evaluate(`document.querySelector(${JSON.stringify(line)}).focus()`);
          const on = await p.evaluate(`document.activeElement === document.querySelector(${JSON.stringify(line)})`);
          observations.push({ name: 'reading stacks the reply line takes the keys from focus()', engine, held: on ? 'as in Chrome' : 'the keys stay off it' });
          await p.evaluate('document.activeElement?.blur()');
        }
      }
      if (hovers) {
        // The keys in the stack above show its reply line; a press on a message below takes the keys, and the line
        // stays until the click has landed, so the message pressed does not move under the pointer and opens.
        await keyTo(p, ids.nearReply);
        await away(p);
        const nearFoot = `#messages .reply-stack[data-stack="${ids.near}"] > .stack-foot`;
        await until(() => p.evaluate(`document.querySelector(${JSON.stringify(nearFoot)}).getClientRects().length > 0`), 'laptop: the keys in the stack above show its reply line');
        await centre(p, words(ids.three));
        const at = await p.box(words(ids.three)), x = at.x + at.width / 2, y = at.y + at.height / 2;
        await p.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
        await p.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
        const held = await p.evaluate(`({top:document.querySelector(${JSON.stringify(words(ids.three))}).getBoundingClientRect().top,line:document.querySelector(${JSON.stringify(nearFoot)}).getClientRects().length>0})`);
        await p.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
        assert.deepEqual(held, { top: at.y, line: true }, 'laptop: while the press is held, the stack above keeps its reply line and the message pressed stays put');
        await until(async () => (await readerOn(p))?.startsWith('The hook, by the door'), 'laptop: the click lands and opens the message');
        await closeReader(p, 'laptop');
        await p.evaluate('document.activeElement?.blur()');
        // A click that lands in a folded stack (on its head row, which shows the full message) keeps its reply line
        // once the pointer has gone; another click on the row hides the message again.
        await centre(p, `${card(ids.root)} .stack-who`);
        await p.point(`${card(ids.root)} .stack-who`);
        await until(async () => (await look(p, ids, 'root')).full, 'laptop: a click on the head row shows the full message');
        await away(p);
        await becomes(async () => (await footing()).shown, true, 'laptop: a click that landed in a folded stack keeps its reply line, the pointer gone');
        await p.point(`${card(ids.root)} .stack-who`);
        await until(async () => !(await look(p, ids, 'root')).full, 'laptop: another click on the head row hides it');
        await p.evaluate('document.activeElement?.blur()');
        // The pointer over a folded stack, on no message, shows it, and a click on it replies.
        await light(p, 'laptop', ids.nearReply); await away(p);
        await becomes(async () => (await footing()).shown, false, 'laptop: the light and the keys elsewhere');
        await centre(p, `${stack} .stack-fold-line`);
        await p.point(`${stack} .stack-fold-line`, 'move');
        await becomes(async () => (await footing()).shown, true, 'laptop: the pointer over a folded stack shows its reply line');
        await p.point(line);
        await replying('a click on the reply line');
      }
      // Open, it always shows its reply line, with the person elsewhere.
      await centre(p, `${stack} .stack-fold-line`);
      await press(p, device, `${stack} .stack-fold-line`);
      await becomes(async () => (await footing()).fold, 'open', `${device}: the fold line opens the stack`);
      await light(p, device, ids.nearReply);
      if (device === 'laptop') await away(p);
      await p.evaluate('document.activeElement?.blur()');
      await becomes(async () => (await footing()).shown, true, `${device}: an open stack shows its reply line with the person elsewhere`);
      await shot(p, 'stack-reply-line-' + device);
      assert.deepEqual(p.errors, []);
      await p.close();
    }
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
      const row = await p.evaluate(`(()=>{const r=document.querySelector(${JSON.stringify(card(ids.root))}).querySelector(':scope > .stack-head'),b=r.getBoundingClientRect();
        const hit=document.elementFromPoint(b.left+Math.min(12,b.width/2),b.top+b.height/2);return {top:b.top,bottom:b.bottom,window:innerHeight,shown:b.top>=0&&b.bottom<=innerHeight&&r.contains(hit)}})()`);
      assert.equal(row.shown, true, `laptop, head ${shown}: the head's row is in the window, uncovered: ${JSON.stringify(row)}`);
    }
    assert.deepEqual(p.errors, []);
    await p.close();
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
        if (device === 'laptop') await away(p);
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
    const line = `#messages .reply-stack[data-stack="${ids.root}"] .stack-fold-line`;
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
    // Pressed again where it is, nothing covers the line, and it opens.
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
    // The pointer resting on the message moved nothing (no stack's reply line came or went): it is still under it.
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
    await becomes(async () => (await look(p, ids, 'root')).rows, ['fold: 2 earlier replies', 'mine'], 'coming back, the stack folds to the reader\'s reply');
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

  if (engine === 'chrome') await check('reading stacks a reply swiped to the right on a phone folds into the earlier replies, and a drag that scrolls a wide table or code folds nothing', async () => {
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
    await becomes(async () => (await look(p, ids, 'root')).rows, ['fold: 1 earlier reply · 1 new', 'wide', 'two'], 'phone: swiped right, reply one folds into the earlier replies');
    assert.deepEqual(p.errors, []);
    await p.close();
  });
  else observations.push({ name: 'stacks swipe', engine, held: 'Safari\'s engine in this harness has a tap but no finger drag: the swipe is checked in Chrome' });
}

// Edit a message (item 228, docs/message-edit.md), in the browser as the person
// uses it: Edit in the ⋯ of a message they sent, from a feed card, a dossier
// row and the Reader; the Reader's edit mode with Save (⌘Return) and Cancel;
// and each state the mode shows. Called from readingChecks
// (topic_reading_native.mjs), so it runs in the reader persistence harness's
// reading mode.
//
// The cases named "reading edit mode" need nothing from Core but the message
// and its reader: the menus, the mode opening and closing, the keys it holds,
// and blank words. The cases named "reading edit save" need Core's
// message.edit command, topic_messages by message_ids and the actor-scope
// edit change.
import assert from 'node:assert/strict';

// Before the page's own code, after HEARD: a message.edit the page sends can
// be held until window.letEdit() (saving), answered with nothing although Core
// took it (window.dropEdit: uncertain), or answered busy without reaching Core
// (window.busyEdit), or refused with window.refuseEdit's {code, message} without reaching Core.
// window.edits counts the message.edit requests that reached Core.
export const EDIT_FAULTS = `(()=>{window.edits=0;const g=window.fetch;window.fetch=function(input,init){
  let b=null;try{b=init&&typeof init.body==='string'?JSON.parse(init.body):null}catch(e){}
  if(!b||b.kind!=='message.edit')return g.call(this,input,init);
  if(window.refuseEdit){const e=window.refuseEdit;window.refuseEdit=null;return Promise.resolve(new Response(JSON.stringify({v:1,instance_id:b.instance_id,operation_id:b.operation_id,kind:b.kind,
    status:'rejected',recorded:true,error:{code:e.code,message:e.message}}),{status:200,headers:{'Content-Type':'application/json'}}))}
  if(window.busyEdit){window.busyEdit=false;return Promise.resolve(new Response(JSON.stringify({v:1,instance_id:b.instance_id,operation_id:b.operation_id,kind:b.kind,
    status:'retryable',recorded:false,error:{code:'DATABASE_BUSY',message:'Theseus is busy.'}}),{status:200,headers:{'Content-Type':'application/json'}}))}
  if(window.holdEdit){window.holdEdit=false;return new Promise(go=>{window.letEdit=()=>{window.edits++;go(g.call(this,input,init))}})}
  window.edits++;
  if(window.dropEdit){window.dropEdit=false;return g.call(this,input,init).then(()=>{throw new TypeError('Failed to fetch')})}
  return g.call(this,input,init)};})()`;

export async function editChecks({ check, until, view, facts, shot = async () => {}, engine = 'chrome' }, helpers) {
  const { seed, open, centre, tap, press, lit, light, openReader, closeReader, readerOn, into, valueOf, card, words, DEVICES } = helpers;
  const FIELD = '#message-edit-field', EDIT = '#message-edit';
  const button = act => `${EDIT} button[data-act=${act}]`;
  // The ⋯ of a message from its bar, and its items' words.
  const menuOf = async (p, device, id) => {
    // A message already lit with its bar (the Reader closing lights the message it showed) is not tapped again:
    // on a phone a tap on a lit message opens the Reader. The person presses its ⋯ as it stands.
    const ready = await p.evaluate(`[...document.querySelectorAll('#messages .lit[data-id]')].some(e=>e.dataset.id===${JSON.stringify(id)})
      && Boolean(document.querySelector('.message-bar:not([hidden]) [data-act=more]')?.getClientRects().length)`);
    if (!ready) await light(p, device, id);
    await press(p, device, '.message-bar [data-act=more]');
    await until(() => p.evaluate(`Boolean(document.querySelector('.message-menu-list'))`), `${device}: ⋯ opens the menu`);
    return p.evaluate(`[...document.querySelector('.message-menu-list').querySelectorAll('button')].map(b=>b.firstChild.textContent)`);
  };
  const choose = async (p, device, label) => {
    const at = await p.evaluate(`[...document.querySelectorAll('.message-menu-list button')].findIndex(b=>b.firstChild.textContent===${JSON.stringify(label)})`);
    assert.ok(at >= 0, `${label} is in the menu`);
    await press(p, device, `.message-menu-list button:nth-of-type(${at + 1})`);
  };
  const closeMenu = async p => { await p.key('Escape'); await until(() => p.evaluate(`!document.querySelector('.message-menu-list')`), 'Escape closes the menu'); };
  // The Reader in its edit mode: the field, holding words, in place of the message's words, with the cursor in it.
  const editing = async (p, device, body) => {
    await until(() => p.evaluate(`document.querySelector('#reader').open && document.querySelector('#reader').dataset.editing === 'true'
      && document.querySelector('#source-body').hidden && !document.querySelector('${EDIT}').hidden && document.activeElement?.id === 'message-edit-field'`),
    `${device}: the Reader is in its edit mode, with the cursor in the field`);
    assert.equal(await valueOf(p, FIELD), body, `${device}: the field holds the message's words`);
  };
  // Holds the device's edit store with a write that stays open while
  // window.keptHeld is true; a read of the store sets window.keptRead.
  const holdKept = p => p.evaluate(`new Promise((ready, failed) => {
    const get = IDBObjectStore.prototype.get;
    IDBObjectStore.prototype.get = function (...args) { if (this.transaction.db.name === 'theseus-message-edit-v1' && this.transaction.mode === 'readonly') window.keptRead = true; return get.apply(this, args); };
    window.keptRead = false; window.keptHeld = true;
    const open = indexedDB.open('theseus-message-edit-v1', 1);
    open.onerror = () => failed(open.error);
    open.onsuccess = () => {
      const db = open.result, store = db.transaction('writing', 'readwrite').objectStore('writing');
      const spin = () => { if (window.keptHeld) store.get('held').onsuccess = spin; else db.close(); };
      spin(); ready(true);
    };
  })`);
  const notEditing = p => until(() => p.evaluate(`!document.querySelector('#reader').dataset.editing && document.querySelector('${EDIT}').hidden`), 'the edit mode is gone');
  const state = p => p.evaluate(`document.querySelector('${EDIT}').dataset.state ?? null`);
  const status = p => p.evaluate(`document.querySelector('${EDIT} .message-edit-status')?.textContent ?? null`);
  const off = (p, act) => p.evaluate(`(b=>b?b.disabled||b.hidden:null)(document.querySelector('${button(act)}'))`);
  const focusOn = p => p.evaluate(`document.activeElement?.closest?.('[data-id]')?.dataset.id ?? document.activeElement?.id ?? null`);
  const edits = p => p.evaluate(`window.sent.filter(kind => kind === 'message.edit').length`);
  // Where a card sits in the window: the feed's scroll, measured where the person sees it.
  const top = (p, id) => p.evaluate(`Math.round(document.querySelector(${JSON.stringify(card(id))}).getBoundingClientRect().top)`);
  const replaceWords = async (p, text) => {
    await p.evaluate(`(f=>{f.focus();f.select()})(document.querySelector('${FIELD}'))`);
    if (text) await p.send('Input.insertText', { text }); else await p.key('Backspace');
    assert.equal(await valueOf(p, FIELD), text);
  };
  // What Core holds of a message, read as the person.
  const held = async (topic, id) => {
    const page = await view('topic_messages', { topic_id: topic, message_ids: [id] });
    const item = (page.items ?? page.messages ?? []).find(m => m.id === id);
    assert.ok(item, `Core gives ${id} by its id`);
    return { revision: item.revision, body: item.body, edited: Number.isSafeInteger(item.edited_ms) };
  };
  // A Save of the person's from somewhere else (another device): message.edit through Core, as the person.
  const editElsewhere = async (id, revision, body, operation) => {
    const headers = { Authorization: `Bearer ${facts.token}`, Origin: facts.origin, 'Content-Type': 'application/json' };
    const boot = await (await fetch(facts.origin + '/api/bootstrap', { headers })).json();
    const receipt = await (await fetch(facts.origin + '/api/command', { method: 'POST', headers, body: JSON.stringify({ v: 1, instance_id: boot.instance_id,
      operation_id: operation, kind: 'message.edit', target: { message_id: id },
      expected: { authority: { authority_id: boot.authority.authority_id, authority_epoch: boot.authority.authority_epoch }, message_revision: revision },
      args: { body } }) })).json();
    assert.equal(receipt.status, 'committed', 'the edit elsewhere is saved: ' + JSON.stringify(receipt.error ?? null));
  };
  // A topic with an agent's message and the person's own message after it; answered: and an agent's reply to
  // the person's, which makes theirs the head of a stack, shown as one row (docs/reply-stacks.md).
  const edited = async (topic, answered = false) => seed(topic, [
    ['theirs', { sender: 'aim-core', join: true, addressees: [facts.actor], body: 'An agent says where the work stands.' }],
    ['mine', { sender: 'person', body: 'My own words, as I sent them.' }],
    ...(answered ? [['reply', { sender: 'aim-core', reply_to: 'mine', addressees: [facts.actor], body: 'The agent answers my words.' }]] : []),
  ]);
  // The Reader's ⋯, and Edit in it.
  const readerMenu = async p => {
    await p.point('#reader-menu');
    await until(() => p.evaluate(`Boolean(document.querySelector('.message-menu-list'))`), 'the Reader\'s ⋯ opens');
    return p.evaluate(`[...document.querySelectorAll('.message-menu-list button')].map(b=>b.firstChild.textContent)`);
  };

  await check('reading edit mode is offered in the ⋯ of the person\'s own message only; from a card it opens the Reader on it, and Cancel sends nothing and leaves the page as it was', async () => {
    const topic = 'edit-card-laptop', ids = await edited(topic);
    const p = await open(topic, 'laptop', topic, ids.mine, EDIT_FAULTS);
    assert.equal((await menuOf(p, 'laptop', ids.theirs)).includes('Edit'), false, 'an agent\'s message offers no Edit');
    await closeMenu(p);
    // An unsent reply to the message, and words in the composer under the topic: Edit leaves both as they are.
    await openReader(p, 'laptop', ids.mine, 'My own words');
    await into(p, 'laptop', '#writing-body'); await p.send('Input.insertText', { text: 'An unsent reply.' });
    await closeReader(p, 'laptop');
    await into(p, 'laptop', '#inline-writing-body'); await p.send('Input.insertText', { text: 'A line in the composer.' });
    await p.evaluate('document.activeElement?.blur()');
    const items = await menuOf(p, 'laptop', ids.mine);
    assert.ok(items.includes('Edit'), 'the person\'s own message offers Edit: ' + items.join(', '));
    const before = { top: await top(p, ids.mine), lit: await lit(p) };
    await choose(p, 'laptop', 'Edit');
    await editing(p, 'laptop', 'My own words, as I sent them.');
    assert.equal(await valueOf(p, '#writing-body'), 'An unsent reply.', 'the unsent reply is beside the edit, untouched');
    assert.equal(await off(p, 'save'), false, 'Save is offered'); assert.equal(await off(p, 'cancel'), false, 'Cancel is offered');
    assert.equal(await off(p, 'retry'), true, 'Try again is not offered before a Save');
    await replaceWords(p, 'Words I let go.');
    await p.point(button('cancel'));
    await until(async () => await readerOn(p) === null, 'Cancel ends the edit, and the Reader opened for it closes');
    await until(async () => await focusOn(p) === ids.mine, 'the focus goes back to the card');
    assert.equal(await edits(p), 0, 'Cancel sends nothing');
    assert.equal(await p.evaluate(`document.querySelector(${JSON.stringify(words(ids.mine))}).textContent`), 'My own words, as I sent them.', 'the card shows the words as sent');
    assert.deepEqual({ top: await top(p, ids.mine), lit: await lit(p) }, before, 'the card stays where it was, and lit as it was');
    assert.equal(await valueOf(p, '#inline-writing-body'), 'A line in the composer.', 'the composer keeps its words');
    // A Cancel lets the words go: the next Edit starts from the message as sent.
    await menuOf(p, 'laptop', ids.mine); await choose(p, 'laptop', 'Edit');
    await editing(p, 'laptop', 'My own words, as I sent them.');
    await p.point(button('cancel')); await until(async () => await readerOn(p) === null, 'Cancel again');
    assert.deepEqual(p.errors, []);
    await p.close();
  });

  await check('reading edit mode from the Reader\'s ⋯ holds ⌘↑ and ⌘↓, and Escape leaves it keeping the words for the next Edit', async () => {
    const topic = 'edit-reader-laptop', ids = await edited(topic);
    const p = await open(topic, 'laptop', topic, ids.mine, EDIT_FAULTS);
    await openReader(p, 'laptop', ids.theirs, 'An agent says');
    assert.equal((await readerMenu(p)).includes('Edit'), false, 'the Reader\'s ⋯ on an agent\'s message offers no Edit');
    await closeMenu(p); await closeReader(p, 'laptop');
    await openReader(p, 'laptop', ids.mine, 'My own words');
    // The Reader learns what it may step to once the page has placed the message (takeNeighbors).
    await until(() => p.evaluate(`!document.querySelector('#previous-message').disabled`), '⌘↑ would step to the message before');
    assert.ok((await readerMenu(p)).includes('Edit'), 'the Reader\'s ⋯ on the person\'s own message offers Edit');
    await choose(p, 'laptop', 'Edit');
    await editing(p, 'laptop', 'My own words, as I sent them.');
    for (const key of ['ArrowUp', 'ArrowDown']) {
      await p.key(key, 4);
      await p.evaluate('new Promise(done=>requestAnimationFrame(()=>requestAnimationFrame(done)))');
      assert.ok((await readerOn(p))?.startsWith('My own words'), `⌘${key} does not step away while editing`);
      assert.equal(await p.evaluate(`document.querySelector('#reader').dataset.editing`), 'true', `⌘${key} leaves the edit mode as it was`);
    }
    assert.equal(await p.evaluate(`document.querySelector('#previous-message').disabled && document.querySelector('#next-message').disabled`), true, 'the step buttons are off while editing');
    await p.send('Input.insertText', { text: ' And more.' });
    await p.key('Escape');
    await notEditing(p);
    assert.ok((await readerOn(p))?.startsWith('My own words, as I sent them.'), 'the Reader stays open on the message, as sent');
    await until(async () => await focusOn(p) === 'reader-menu', 'the focus goes back to the Reader\'s ⋯');
    assert.equal(await edits(p), 0, 'Escape sends nothing');
    // The words were kept on the device: the next Edit brings them back, and
    // its edit mode shows only once they are read. A write of the page's own
    // holds the device store, so Edit's read of them waits until it is let go.
    await holdKept(p);
    await readerMenu(p);
    await choose(p, 'laptop', 'Edit');
    await until(() => p.evaluate('window.keptRead === true'), 'Edit reads the words kept on the device');
    // Nothing can be typed into the edit field before its words are read.
    assert.deepEqual(await p.evaluate(`({ editing: document.querySelector('#reader').dataset.editing ?? null, shown: !document.querySelector('${EDIT}').hidden,
      focus: document.activeElement?.id ?? null })`).then(s => ({ ...s, focus: s.focus === 'message-edit-field' })),
    { editing: null, shown: false, focus: false }, 'the edit mode waits for the words kept on the device');
    await p.evaluate('window.keptHeld = false');
    await editing(p, 'laptop', 'My own words, as I sent them. And more.');
    await p.point(button('cancel'));
    await notEditing(p);
    assert.ok(await readerOn(p), 'Cancel from the Reader\'s ⋯ leaves the Reader open');
    assert.equal(await p.evaluate(`document.querySelector('#previous-message').disabled`), false, 'the step buttons are back');
    await closeReader(p, 'laptop');
    assert.deepEqual(p.errors, []);
    await p.close();
  });

  await check('reading edit mode from a dossier row\'s ⋯ opens the Reader on that reply to edit it', async () => {
    const topic = 'edit-dossier-laptop', ids = await seed(topic, [
      ['root', { sender: 'aim-core', join: true, addressees: [facts.actor], body: 'Which room should we use?' }],
      ['middle', { sender: 'aim-ux', join: true, reply_to: 'root', addressees: [facts.actor], body: 'The small room is free.' }],
      ['mine', { sender: 'person', reply_to: 'root', body: 'My reply in the stack.' }],
    ]);
    const p = await open(topic, 'laptop', topic, ids.root, EDIT_FAULTS);
    await until(() => p.evaluate(`Boolean(document.querySelector(${JSON.stringify(card(ids.mine))})?.closest('.reply-stack'))`), 'the person\'s reply is a row of the stack');
    assert.ok((await menuOf(p, 'laptop', ids.mine)).includes('Edit'), 'the person\'s reply in a stack offers Edit');
    await choose(p, 'laptop', 'Edit');
    await editing(p, 'laptop', 'My reply in the stack.');
    await p.key('Escape');
    await until(async () => await readerOn(p) === null, 'Escape ends the edit, and the Reader opened for it closes');
    await until(async () => await focusOn(p) === ids.mine, 'the focus goes back to the row');
    assert.equal(await edits(p), 0);
    // Escape kept the words; Cancel lets them go.
    await menuOf(p, 'laptop', ids.mine); await choose(p, 'laptop', 'Edit');
    await editing(p, 'laptop', 'My reply in the stack.');
    await p.point(button('cancel')); await until(async () => await readerOn(p) === null, 'Cancel');
    assert.deepEqual(p.errors, []);
    await p.close();
  });

  await check('reading edit mode at a phone\'s width by touch: a tap on the card, its ⋯, Edit and Cancel, each control a finger\'s size', async () => {
    const topic = 'edit-card-phone', ids = await edited(topic);
    const p = await open(topic, 'phone', topic, ids.mine, EDIT_FAULTS);
    const before = await top(p, ids.mine);
    assert.ok((await menuOf(p, 'phone', ids.mine)).includes('Edit'), 'phone: the person\'s own message offers Edit');
    await choose(p, 'phone', 'Edit');
    await editing(p, 'phone', 'My own words, as I sent them.');
    const sizes = await p.evaluate(`[...document.querySelectorAll('${EDIT} button')].filter(b=>b.getClientRects().length).map(b=>{const r=b.getBoundingClientRect();return [b.dataset.act,Math.round(r.height),b.getAttribute('aria-label')||b.textContent]})`);
    for (const [act, height, name] of sizes) { assert.ok(height >= 44, `phone: ${act} is at least 44px tall (${height})`); assert.ok(name.trim(), `phone: ${act} has a name`); }
    assert.ok(await p.evaluate(`(()=>{const f=document.querySelector('${FIELD}').getBoundingClientRect();return f.left>=0&&f.right<=innerWidth})()`), 'phone: the field fits the width');
    await centre(p, button('cancel')); await tap(p, button('cancel'));
    await until(async () => await readerOn(p) === null, 'phone: Cancel ends the edit and the Reader closes');
    assert.equal(await edits(p), 0, 'phone: Cancel sends nothing');
    assert.equal(await top(p, ids.mine), before, 'phone: the card is where it was');
    assert.deepEqual(p.errors, []);
    await p.close();
  });

  await check('reading edit mode with blank words offers no Save, and ⌘Return sends nothing', async () => {
    const topic = 'edit-empty-laptop', ids = await edited(topic);
    const p = await open(topic, 'laptop', topic, ids.mine, EDIT_FAULTS);
    await menuOf(p, 'laptop', ids.mine); await choose(p, 'laptop', 'Edit');
    await editing(p, 'laptop', 'My own words, as I sent them.');
    await replaceWords(p, '');
    await until(async () => await off(p, 'save') === true, 'Save is off while the words are blank');
    await p.key('Enter', 4);
    await p.evaluate('new Promise(done=>requestAnimationFrame(()=>requestAnimationFrame(done)))');
    assert.equal(await edits(p), 0, '⌘Return sends nothing');
    assert.equal(await state(p), 'editing', 'the edit mode stays');
    await p.send('Input.insertText', { text: '   ' });
    assert.equal(await off(p, 'save'), true, 'spaces alone are blank');
    await p.point(button('cancel')); await until(async () => await readerOn(p) === null, 'Cancel');
    assert.deepEqual(p.errors, []);
    await p.close();
  });

  // From here, Core's message.edit, topic_messages by message_ids and the edit change.
  await check('reading edit save with ⌘Return and with Save: Core holds the next revision, and the card shows the words with Edited', async () => {
    const topic = 'edit-save-laptop', ids = await edited(topic);
    const p = await open(topic, 'laptop', topic, ids.mine, EDIT_FAULTS);
    await menuOf(p, 'laptop', ids.mine); await choose(p, 'laptop', 'Edit');
    await editing(p, 'laptop', 'My own words, as I sent them.');
    await replaceWords(p, 'My words, corrected.');
    await p.key('Enter', 4);
    await until(async () => await readerOn(p) === null, '⌘Return saves, and the Reader opened for the edit closes');
    await until(async () => await focusOn(p) === ids.mine, 'the focus goes back to the card');
    assert.deepEqual(await held(topic, ids.mine), { revision: 2, body: 'My words, corrected.', edited: true });
    await until(() => p.evaluate(`document.querySelector(${JSON.stringify(words(ids.mine))}).textContent === 'My words, corrected.'
      && document.querySelector(${JSON.stringify(card(ids.mine) + ' .message-edited')})?.textContent.includes('Edited')`), 'the card shows the new words, and Edited');
    // Save by its button, from the Reader's ⋯: the Reader stays open, with the new words and Edited beside its author.
    await openReader(p, 'laptop', ids.mine, 'My words, corrected.');
    await readerMenu(p);
    await choose(p, 'laptop', 'Edit');
    await editing(p, 'laptop', 'My words, corrected.');
    await replaceWords(p, 'My words, corrected twice.');
    await p.point(button('save'));
    await notEditing(p);
    await until(async () => (await readerOn(p)) === 'My words, corrected twice.', 'the Reader shows the saved words');
    assert.ok(await p.evaluate(`document.querySelector('#reader').textContent.includes('Edited')`), 'the Reader says Edited');
    assert.deepEqual(await held(topic, ids.mine), { revision: 3, body: 'My words, corrected twice.', edited: true });
    assert.equal(await p.evaluate('window.edits'), 2, 'one message.edit for each Save');
    await closeReader(p, 'laptop');
    assert.deepEqual(p.errors, []);
    await p.close();
  });

  await check('reading edit save in one tab shows in another without a reload: the new words, Edited, the reply\'s line and an open Reader', async () => {
    // The person's message heads a stack, shown as one row: each tab opens it by its link, in the Reader.
    const topic = 'edit-tabs-laptop', ids = await edited(topic, true), link = `/?topic=${topic}&message=${ids.mine}`;
    const other = await open(topic + '-other', 'laptop', topic, ids.mine, EDIT_FAULTS, link);
    await until(async () => (await readerOn(other))?.startsWith('My own words'), 'the other tab\'s Reader is on the message');
    await other.evaluate('window.sameDocument = true');
    const p = await open(topic, 'laptop', topic, ids.mine, EDIT_FAULTS, link);
    await until(async () => (await readerOn(p))?.startsWith('My own words'), 'the Reader is on the message');
    await readerMenu(p); await choose(p, 'laptop', 'Edit');
    await editing(p, 'laptop', 'My own words, as I sent them.');
    await replaceWords(p, 'Words saved in one tab.');
    await p.key('Enter', 4);
    await notEditing(p);
    await until(async () => (await readerOn(p)) === 'Words saved in one tab.', 'saved, and the Reader shows the words');
    // A page behind another reads what it missed when it is shown.
    await other.send('Page.bringToFront');
    await until(async () => (await readerOn(other)) === 'Words saved in one tab.', 'the other tab\'s open Reader shows the new words in place');
    await closeReader(other, 'laptop');
    await until(() => other.evaluate(`document.querySelector(${JSON.stringify(words(ids.mine))}).textContent === 'Words saved in one tab.'
      && Boolean(document.querySelector(${JSON.stringify(card(ids.mine) + ' .message-edited')}))
      && document.querySelector(${JSON.stringify(card(ids.reply) + ' > .message-reply-to')})?.textContent.includes('Words saved in one tab.')`),
    'the other tab shows the new words, Edited and the reply\'s line');
    assert.equal(await other.evaluate('window.sameDocument'), true, 'without a reload');
    assert.equal(await other.evaluate('window.edits'), 0, 'the other tab sent nothing');
    assert.deepEqual(other.errors, []); assert.deepEqual(p.errors, []);
    await other.close(); await p.close();
  });

  await check('reading edit save elsewhere of a message older than the loaded page rewrites the line of a loaded reply to it, without a reload', async () => {
    // The person's message, then more of their own than the page's first read holds (30), then an agent's reply to the first:
    // the page opens on the newest, holding the reply and not the message it answers.
    const topic = 'edit-unloaded-laptop', ids = await seed(topic, [
      ['mine', { sender: 'person', body: 'Ship it at 5.' }],
      ...Array.from({ length: 31 }, (_, n) => [`said${n}`, { sender: 'person', body: `Another word of mine, ${n + 1}.` }]),
      ['reply', { sender: 'aim-core', join: true, reply_to: 'mine', addressees: [facts.actor], body: 'On it.' }],
    ]);
    const p = await open(topic, 'laptop', topic, ids.reply, EDIT_FAULTS);
    const line = () => p.evaluate(`document.querySelector(${JSON.stringify(card(ids.reply) + ' > .message-reply-to')})?.textContent ?? null`);
    await until(async () => (await line())?.includes('Ship it at 5.'), 'the reply\'s line shows the words it answers');
    assert.equal(await p.evaluate(`Boolean(document.querySelector(${JSON.stringify(card(ids.mine))}))`), false, 'the message it answers is not loaded');
    const loaded = await p.evaluate('performance.timeOrigin');
    await editElsewhere(ids.mine, 1, 'Ship it at 6.', `${topic}-elsewhere`);
    await until(async () => (await line())?.includes('Ship it at 6.'), 'the reply\'s line reads the latest words');
    assert.equal((await line()).includes('Ship it at 5.'), false, 'and not the old ones');
    assert.equal(await p.evaluate('performance.timeOrigin'), loaded, 'without a reload');
    assert.equal(await p.evaluate('window.edits'), 0, 'this page sent nothing');
    assert.deepEqual(p.errors, []);
    await p.close();
  });

  await check('reading edit save after a newer revision is a conflict: the saved words are shown, and Save mine or Use saved', async () => {
    const topic = 'edit-conflict-laptop', ids = await edited(topic);
    const p = await open(topic, 'laptop', topic, ids.mine, EDIT_FAULTS);
    for (const [choice, revision] of [['mine', 2], ['saved', 4]]) {
      const body = (await held(topic, ids.mine)).body;
      await menuOf(p, 'laptop', ids.mine); await choose(p, 'laptop', 'Edit');
      await editing(p, 'laptop', body);
      await replaceWords(p, `Mine, written here for ${choice}.`);
      await editElsewhere(ids.mine, revision - 1, 'Saved elsewhere ' + revision + '.', `${topic}-elsewhere-${choice}`);
      await p.key('Enter', 4);
      await until(async () => await state(p) === 'conflict', 'the Save meets the newer revision');
      assert.equal(await p.evaluate(`(t=>t&&t.getClientRects().length?t.textContent:null)(document.querySelector('${EDIT} .message-edit-conflict-title'))`),
        'This message was edited elsewhere', 'the conflict says so, over the saved words');
      assert.equal(await p.evaluate(`document.querySelector('${EDIT} .message-edit-saved').textContent`), 'Saved elsewhere ' + revision + '.', 'the saved words are shown');
      assert.equal(await off(p, 'save'), true, 'Save is off: the choice stands in for it');
      await p.point(button(choice));
      await until(async () => await readerOn(p) === null, `${choice}: the edit ends`);
      assert.deepEqual(await held(topic, ids.mine), choice === 'mine'
        ? { revision: revision + 1, body: `Mine, written here for ${choice}.`, edited: true }
        : { revision, body: 'Saved elsewhere ' + revision + '.', edited: true }, `${choice}: what Core holds`);
      await until(() => p.evaluate(`document.querySelector(${JSON.stringify(words(ids.mine))}).textContent === ${JSON.stringify(choice === 'mine' ? `Mine, written here for ${choice}.` : 'Saved elsewhere ' + revision + '.')}`), `${choice}: the card shows it`);
    }
    assert.deepEqual(p.errors, []);
    await p.close();
  });

  await check('reading edit save with no answer is uncertain: Try again asks Core first and saves once', async () => {
    const topic = 'edit-uncertain-laptop', ids = await edited(topic);
    const p = await open(topic, 'laptop', topic, ids.mine, EDIT_FAULTS);
    await menuOf(p, 'laptop', ids.mine); await choose(p, 'laptop', 'Edit');
    await editing(p, 'laptop', 'My own words, as I sent them.');
    await replaceWords(p, 'Saved, though no answer came.');
    await p.evaluate('window.dropEdit = true');
    await p.key('Enter', 4);
    await until(async () => await state(p) === 'uncertain', 'no answer: not known whether it was saved');
    assert.equal(await status(p), 'Not known whether this was saved: Theseus did not confirm it.');
    assert.equal(await off(p, 'retry'), false, 'Try again is offered'); assert.equal(await off(p, 'save'), true, 'Save is off');
    await p.point(button('retry'));
    await until(async () => await readerOn(p) === null, 'Try again finds it saved, and the edit ends');
    assert.equal(await p.evaluate('window.edits'), 1, 'Try again read the operation and did not send it again');
    assert.deepEqual(await held(topic, ids.mine), { revision: 2, body: 'Saved, though no answer came.', edited: true });
    assert.deepEqual(p.errors, []);
    await p.close();
  });

  await check('reading edit save answered busy keeps the words and Try again saves them', async () => {
    const topic = 'edit-busy-laptop', ids = await edited(topic);
    const p = await open(topic, 'laptop', topic, ids.mine, EDIT_FAULTS);
    await menuOf(p, 'laptop', ids.mine); await choose(p, 'laptop', 'Edit');
    await editing(p, 'laptop', 'My own words, as I sent them.');
    await replaceWords(p, 'Saved after a busy moment.');
    await p.evaluate('window.busyEdit = true');
    await p.key('Enter', 4);
    await until(async () => await state(p) === 'busy', 'busy');
    assert.equal(await status(p), 'Not saved: Theseus was busy.');
    assert.equal(await valueOf(p, FIELD), 'Saved after a busy moment.', 'the words are kept');
    assert.deepEqual(await held(topic, ids.mine), { revision: 1, body: 'My own words, as I sent them.', edited: false }, 'Core took nothing');
    await p.point(button('retry'));
    await until(async () => await readerOn(p) === null, 'Try again saves');
    assert.deepEqual(await held(topic, ids.mine), { revision: 2, body: 'Saved after a busy moment.', edited: true });
    assert.deepEqual(p.errors, []);
    await p.close();
  });

  await check('reading edit save while its answer is out: the field reads only, Saving…, and no second Save', async () => {
    const topic = 'edit-saving-laptop', ids = await edited(topic);
    const p = await open(topic, 'laptop', topic, ids.mine, EDIT_FAULTS);
    await menuOf(p, 'laptop', ids.mine); await choose(p, 'laptop', 'Edit');
    await editing(p, 'laptop', 'My own words, as I sent them.');
    await replaceWords(p, 'Saved slowly.');
    await p.evaluate('window.holdEdit = true');
    await p.key('Enter', 4);
    await until(async () => await state(p) === 'saving', 'saving');
    assert.equal(await status(p), 'Saving…');
    assert.equal(await p.evaluate(`document.querySelector('${FIELD}').readOnly`), true, 'the field reads only');
    assert.equal(await off(p, 'save'), true, 'Save is off'); assert.equal(await off(p, 'cancel'), true, 'Cancel waits for the answer');
    await p.key('Enter', 4);
    await p.evaluate('window.letEdit()');
    await until(async () => await readerOn(p) === null, 'the answer comes and the edit ends');
    assert.equal(await p.evaluate('window.edits'), 1, 'one Save');
    assert.deepEqual(await held(topic, ids.mine), { revision: 2, body: 'Saved slowly.', edited: true });
    assert.deepEqual(p.errors, []);
    await p.close();
  });
  // Each state the edit mode shows, as the person sees it at the narrowest phone widths and on a laptop: what it
  // says, which controls it offers, each a finger's size on a phone with a name and nothing over another, and
  // nothing beyond the window. The states are reached as Core answers them: a real too-long Save
  // (BODY_TOO_LARGE), and busy, no answer and a held answer as the page meets them (EDIT_FAULTS).
  const WIDTHS = [['phone', 320], ['phone', 375], ['phone', 390], ['laptop', 1280]];
  const laid = async (p, device, what) => {
    const seen = await p.evaluate(`(()=>{const host=document.querySelector('${EDIT}'),shown=e=>e.getClientRects().length>0&&getComputedStyle(e).visibility!=='hidden';
      const box=e=>{const b=e.getBoundingClientRect();return {left:b.left,right:b.right,top:b.top,bottom:b.bottom,height:b.height}};
      const controls=[...host.querySelectorAll('button')].filter(shown).map(b=>({act:b.dataset.act,name:(b.getAttribute('aria-label')||b.textContent).trim(),...box(b)}));
      const status=host.querySelector('.message-edit-status'),field=host.querySelector('textarea');
      return {controls,status:status&&shown(status)&&status.textContent?box(status):null,field:box(field),width:innerWidth,scroll:document.documentElement.scrollWidth,
        header:[...document.querySelectorAll('#reader-close,#reader-menu')].filter(shown).map(box)}})()`);
    const where = `${device} ${seen.width} ${what}`;
    const over = (a, b) => a.left < b.right - 1 && b.left < a.right - 1 && a.top < b.bottom - 1 && b.top < a.bottom - 1;
    assert.ok(seen.scroll <= seen.width, `${where}: nothing beyond the window (${seen.scroll} of ${seen.width})`);
    assert.ok(seen.field.left >= 0 && seen.field.right <= seen.width, `${where}: the field fits the width`);
    for (const c of seen.controls) {
      assert.ok(c.name, `${where}: ${c.act} has a name`);
      assert.ok(c.left >= 0 && c.right <= seen.width, `${where}: ${c.act} is inside the window`);
      if (device === 'phone') assert.ok(c.height >= 44, `${where}: ${c.act} is a finger's size (${c.height})`);
      for (const other of seen.controls) if (other !== c) assert.ok(!over(c, other), `${where}: ${c.act} and ${other.act} do not overlap`);
      if (seen.status) assert.ok(!over(c, seen.status), `${where}: what it says is not under ${c.act}`);
      for (const h of seen.header) assert.ok(!over(c, h), `${where}: ${c.act} is clear of the Reader's own controls`);
    }
    return seen.controls.map(c => c.act);
  };
  const editFrom = async (p, device, id, body) => {
    await menuOf(p, device, id); await choose(p, device, 'Edit');
    await editing(p, device, body);
  };
  const saveBy = (p, device) => (device === 'phone' ? press(p, device, button('save')) : p.key('Enter', 4));

  await check('reading edit save each state at 320, 375 and 390 wide by touch, and on a laptop: editing, empty, too long, refused, busy, saving, saved with Edited, no answer, and a conflict with both choices', async () => {
    for (const [device, width] of WIDTHS) {
      const topic = `edit-states-${width}`, ids = await edited(topic);
      const p = await open(topic, device, topic, ids.mine, EDIT_FAULTS);
      if (device === 'phone' && width !== 390) await p.send('Emulation.setDeviceMetricsOverride', { width, height: 740, deviceScaleFactor: 1, mobile: true });
      await editFrom(p, device, ids.mine, 'My own words, as I sent them.');
      assert.deepEqual(await laid(p, device, 'editing'), ['cancel', 'save'], `${device} ${width}: editing offers Cancel and Save`);
      await replaceWords(p, 'Kept as I write.');
      await until(async () => await status(p) === 'Kept on this device', 'editing: the words are kept on this device');
      // Empty: Save is off.
      await replaceWords(p, '');
      await until(async () => await off(p, 'save') === true, 'empty: Save is off');
      await laid(p, device, 'empty');
      // Too long: Core refuses it, recorded; the words stay in the field, and Save stays on for changed words.
      const long = 'x'.repeat(1048577);
      await p.evaluate(`(f=>{f.value='x'.repeat(1048577);f.dispatchEvent(new Event('input',{bubbles:true}))})(document.querySelector('${FIELD}'))`);
      await saveBy(p, device);
      await until(async () => await state(p) === 'refused', 'too long: refused');
      assert.equal(await status(p), 'Not saved: too long');
      assert.equal((await valueOf(p, FIELD)).length, long.length, 'too long: the words stay in the field');
      assert.equal(await p.evaluate(`document.querySelector('${FIELD}').readOnly`), false, 'too long: the words may be changed');
      await laid(p, device, 'too long');
      // Refused for another reason: Core's own words.
      await replaceWords(p, 'Refused words.');
      await p.evaluate(`window.refuseEdit = { code: 'ATTACHMENT_INVALID', message: 'Core will not take these.' }`);
      await saveBy(p, device);
      await until(async () => await state(p) === 'refused', 'refused');
      assert.equal(await status(p), 'Not saved: Core will not take these.');
      assert.equal(await valueOf(p, FIELD), 'Refused words.', 'refused: the words are kept');
      await laid(p, device, 'refused');
      // Busy: Try again, with Cancel, and the words held as sent.
      await replaceWords(p, 'Saved after busy and a wait.');
      await p.evaluate('window.busyEdit = true');
      await saveBy(p, device);
      await until(async () => await state(p) === 'busy', 'busy');
      assert.equal(await status(p), 'Not saved: Theseus was busy.');
      assert.deepEqual(await laid(p, device, 'busy'), ['retry', 'cancel', 'save'], `${device} ${width}: busy offers Try again`);
      // Saving: Try again's answer held; the field reads only.
      await p.evaluate('window.holdEdit = true');
      await press(p, device, button('retry'));
      await until(async () => await state(p) === 'saving', 'saving');
      assert.equal(await status(p), 'Saving…');
      await laid(p, device, 'saving');
      await shot(p, `edit-states-${width}-saving`);
      await p.evaluate('window.letEdit()');
      await until(async () => await readerOn(p) === null, 'saved: the edit ends and the Reader opened for it closes');
      // Normal: the card shows the words and Edited, its author line within the window.
      await until(() => p.evaluate(`document.querySelector(${JSON.stringify(words(ids.mine))}).textContent === 'Saved after busy and a wait.'
        && Boolean(document.querySelector(${JSON.stringify(card(ids.mine) + ' .message-edited')})?.getClientRects().length)`), 'saved: the card shows the new words, and Edited');
      assert.ok(await p.evaluate(`(e=>{const b=e.getBoundingClientRect();return b.right<=innerWidth&&b.left>=0})(document.querySelector(${JSON.stringify(card(ids.mine) + ' .message-edited')}))`), 'Edited is inside the window');
      assert.deepEqual(await held(topic, ids.mine), { revision: 2, body: 'Saved after busy and a wait.', edited: true });
      // No answer: Try again asks Core first.
      await editFrom(p, device, ids.mine, 'Saved after busy and a wait.');
      await replaceWords(p, 'Saved with no answer.');
      await p.evaluate('window.dropEdit = true');
      await saveBy(p, device);
      await until(async () => await state(p) === 'uncertain', 'no answer: uncertain');
      assert.deepEqual(await laid(p, device, 'uncertain'), ['retry', 'cancel', 'save']);
      await press(p, device, button('retry'));
      await until(async () => await readerOn(p) === null, 'Try again finds it saved');
      // A conflict: the saved words, and Save mine and Use saved, each a finger's size.
      await editFrom(p, device, ids.mine, 'Saved with no answer.');
      await replaceWords(p, 'Mine, on the old base.');
      await editElsewhere(ids.mine, 3, 'Saved on another device.', `${topic}-elsewhere`);
      await saveBy(p, device);
      await until(async () => await state(p) === 'conflict', 'conflict');
      const conflict = await laid(p, device, 'conflict');
      assert.ok(conflict.includes('mine') && conflict.includes('saved'), `${device} ${width}: the conflict offers Save mine and Use saved: ${conflict}`);
      for (const scheme of ['light', 'dark']) {
        await p.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: scheme }] });
        await shot(p, `edit-states-${width}-conflict-${scheme}`);
        await laid(p, device, 'conflict ' + scheme);
      }
      await press(p, device, button('saved'));
      await until(async () => await readerOn(p) === null, 'Use saved ends the edit');
      assert.deepEqual(await held(topic, ids.mine), { revision: 4, body: 'Saved on another device.', edited: true }, 'Use saved sends nothing');
      assert.deepEqual(p.errors, []);
      await p.close();
    }
  });

  await check('reading edit save a draft kept by Escape and resumed after the message moved on is a conflict; Save mine with the saved words ends unchanged and sends nothing; Cancel lets a draft go', async () => {
    for (const device of ['laptop', 'phone']) {
      const topic = `edit-resume-${device}`, ids = await edited(topic);
      const p = await open(topic, device, topic, ids.mine, EDIT_FAULTS);
      await editFrom(p, device, ids.mine, 'My own words, as I sent them.');
      await replaceWords(p, 'A draft written on revision 1.');
      if (device === 'laptop') await p.key('Escape'); else await press(p, device, '#reader-close');
      await until(async () => await readerOn(p) === null, 'Escape or closing the Reader leaves the edit');
      assert.equal(await edits(p), 0);
      await editElsewhere(ids.mine, 1, 'Saved on another device.', `${topic}-elsewhere`);
      await until(() => p.evaluate(`document.querySelector(${JSON.stringify(words(ids.mine))}).textContent === 'Saved on another device.'`), 'the page shows the newer words');
      // Edit again: the kept draft comes back, on the base it was written on.
      await editFrom(p, device, ids.mine, 'A draft written on revision 1.');
      await saveBy(p, device);
      await until(async () => await state(p) === 'conflict', 'the resumed draft meets the newer revision: a conflict, never an overwrite');
      assert.deepEqual(await held(topic, ids.mine), { revision: 2, body: 'Saved on another device.', edited: true });
      // Use the saved words as mine: Save mine with words equal to the current revision ends the edit unchanged.
      await replaceWords(p, 'Saved on another device.');
      const before = await p.evaluate('window.edits');
      await press(p, device, button('mine'));
      await until(async () => await readerOn(p) === null, 'Save mine with the saved words ends the edit');
      assert.equal(await p.evaluate('window.edits'), before, 'and sends nothing');
      assert.deepEqual(await held(topic, ids.mine), { revision: 2, body: 'Saved on another device.', edited: true });
      // Cancel lets a draft go: the next Edit starts from the saved words.
      await editFrom(p, device, ids.mine, 'Saved on another device.');
      await replaceWords(p, 'A draft to let go.');
      await press(p, device, button('cancel'));
      await until(async () => await readerOn(p) === null, 'Cancel');
      await editFrom(p, device, ids.mine, 'Saved on another device.');
      await press(p, device, button('cancel'));
      await until(async () => await readerOn(p) === null, 'Cancel again');
      assert.deepEqual(p.errors, []);
      await p.close();
    }
  });

  await check('reading edit save elsewhere changes the right rail\'s pull request and preview links without a reload', async () => {
    const topic = 'edit-rail-laptop', ids = await seed(topic, [
      ['theirs', { sender: 'aim-core', join: true, addressees: [facts.actor], body: 'Where is the fix?' }],
      ['mine', { sender: 'person', body: 'The fix is [First try](https://github.com/acme/field/pull/1); see http://bench.example.ts.net:5192/preview/one.' }],
    ]);
    const p = await open(topic, 'laptop', topic, ids.mine, EDIT_FAULTS);
    const things = () => p.evaluate(`(()=>{const t=document.getElementById('things');return {prs:[...t.querySelectorAll('[data-key=prs] a.row')].map(a=>a.getAttribute('href')),
      previews:[...t.querySelectorAll('[data-key=previews] a.row')].map(a=>a.getAttribute('href'))}})()`);
    await until(async () => (await things()).prs.length === 1, 'the right rail lists the pull request in the person\'s message');
    assert.deepEqual(await things(), { prs: ['https://github.com/acme/field/pull/1'], previews: ['http://bench.example.ts.net:5192/preview/one'] });
    const loaded = await p.evaluate('performance.timeOrigin');
    await editElsewhere(ids.mine, 1, 'The fix is [Second try](https://github.com/acme/field/pull/2); see http://bench.example.ts.net:5192/preview/two.', `${topic}-elsewhere`);
    await until(async () => JSON.stringify(await things()) === JSON.stringify({ prs: ['https://github.com/acme/field/pull/2'], previews: ['http://bench.example.ts.net:5192/preview/two'] }),
      'the right rail shows the edited message\'s links, and not the old ones');
    assert.equal(await p.evaluate('performance.timeOrigin'), loaded, 'without a reload');
    assert.deepEqual(p.errors, []);
    await p.close();
  });

  await check('reading edit quote made in the Reader after an edit names the revision the Reader showed, and Core records it', async () => {
    const topic = 'edit-quote-laptop', ids = await edited(topic);
    const p = await open(topic, 'laptop', topic, ids.mine, EDIT_FAULTS);
    await openReader(p, 'laptop', ids.mine, 'My own words');
    // Edited elsewhere while the Reader is open on it: the Reader shows revision 2 in place.
    await editElsewhere(ids.mine, 1, 'Words of the second revision.', `${topic}-elsewhere`);
    await until(async () => (await readerOn(p)) === 'Words of the second revision.', 'the open Reader shows the new words in place');
    await p.evaluate(`(()=>{const b=document.querySelector('#source-body');getSelection().setBaseAndExtent(b.firstChild.firstChild,0,b.firstChild.firstChild,'Words of the second'.length);return true})()`);
    await p.point('#quote-selection');
    await until(() => p.evaluate(`document.querySelector('#writing-body').value.startsWith('> Words of the second')`), 'the reply quotes the selection');
    await p.point('#send-reply');
    let sent = null;
    await until(async () => {
      const page = await view('topic_messages', { topic_id: topic, direction: 'before', limit: 5 });
      const reply = page.items.find(item => item.reply_to === ids.mine && item.author_id === facts.actor);
      if (!reply) return false;
      sent = await view('source', { source_ref: { kind: 'message', id: reply.id } });
      return true;
    }, 'the reply lands');
    assert.deepEqual(sent.quotes.map(q => [q.source, q.excerpt]), [[{ kind: 'message', id: ids.mine, revision: 2 }, 'Words of the second']],
      'the quote names revision 2, the one the Reader showed');
    assert.deepEqual(p.errors, []);
    await p.close();
  });
  void DEVICES;
}

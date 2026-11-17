// Edit a message (item 228, docs/message-edit.md), in the browser as the person
// uses it: Edit in the ⋯ of a message they sent, from a feed card, a dossier
// row and the Reader; the Reader's edit mode with Save (⌘Return) and Cancel;
// and each state the mode shows. Called from readingChecks
// (topic_reading_native.mjs), so it runs in the reader persistence harness's
// reading mode.
//
// The cases named "reading edit mode" need Core's edit session (item 452:
// message.edit_open, edit_draft and edit_close) and the message: the menus,
// the mode opening and closing, the keys it holds, and blank words. The cases
// named "reading edit save" also need Core's message.edit command,
// topic_messages by message_ids and the actor-scope edit change. The cases
// named "reading edit hold" and "reading edit timing" are the session's own:
// an agent's read of a message held while it is edited, draft saves, another
// device, a kept close, a reload, a slice-1 row, and each session command
// answered late or never.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { appendFileSync, cpSync, mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Release 76's commit (bb3a46da): the build a tab opened before 4:50 AM on 11 November held, whose
// MessageEditWriting has no start() (item 523, docs/rails.md, "One build per document").
const RELEASE_76 = 'bb3a46dae2ba8e5c09ae64897344ea0a25fef05a';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// Before the page's own code, after HEARD. Each session command the page sends (message.edit_open, message.edit_draft,
// message.edit_close and message.edit, the Save) is listed in window.session as [kind, operation_id, holder], as it
// leaves. window.faultOf[kind] says what happens to the next one of that kind: 'hold' keeps it unsent until
// window.letOf[kind](lose) sends it (lose: Core takes it and its answer is lost); 'drop' sends it and loses its answer;
// 'busy' answers DATABASE_BUSY without reaching Core. For a Save, as in slice 1: window.holdEdit (held until
// window.letEdit()), window.dropEdit (no answer, though Core took it), window.busyEdit, and window.refuseEdit's
// {code, message} answered without reaching Core. window.edits counts the Saves that reached Core.
// window.clock, when a number, is the page's clock (Date.now): a check holds the time the hold's renewal reads, and moves it.
export const EDIT_FAULTS = `(()=>{window.edits=0;window.session=[];window.faultOf={};window.letOf={};window.clock=null;
  const now=Date.now;Date.now=()=>typeof window.clock==='number'?window.clock:now.call(Date);
  const KINDS=['message.edit','message.edit_open','message.edit_draft','message.edit_close'];
  const g=window.fetch;window.fetch=function(input,init){
  let b=null;try{b=init&&typeof init.body==='string'?JSON.parse(init.body):null}catch(e){}
  if(!b||!KINDS.includes(b.kind))return g.call(this,input,init);
  window.session.push([b.kind,b.operation_id,b.args&&typeof b.args.holder==='string'?b.args.holder:null]);
  const answer=(status,recorded,error)=>Promise.resolve(new Response(JSON.stringify({v:1,instance_id:b.instance_id,operation_id:b.operation_id,kind:b.kind,
    status,recorded,error}),{status:200,headers:{'Content-Type':'application/json'}}));
  let fault=window.faultOf[b.kind]||null;delete window.faultOf[b.kind];
  if(b.kind==='message.edit'){
    if(window.refuseEdit){const e=window.refuseEdit;window.refuseEdit=null;return answer('rejected',true,{code:e.code,message:e.message})}
    if(window.busyEdit){window.busyEdit=false;fault='busy'}
    else if(window.holdEdit){window.holdEdit=false;fault='hold'}
    else if(window.dropEdit){window.dropEdit=false;fault='drop'}}
  if(fault==='busy')return answer('retryable',false,{code:'DATABASE_BUSY',message:'Theseus is busy.'});
  const go=lose=>{if(b.kind==='message.edit')window.edits++;const sent=g.call(this,input,init);return lose?sent.then(()=>{throw new TypeError('Failed to fetch')}):sent};
  if(fault==='hold')return new Promise(ok=>{window.letOf[b.kind]=lose=>{delete window.letOf[b.kind];ok(go(lose))};if(b.kind==='message.edit')window.letEdit=()=>window.letOf[b.kind]()});
  return go(fault==='drop')};})()`;

export async function editChecks({ check, until, view, control, facts, shot = async () => {}, engine = 'chrome' }, helpers) {
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
    open.onupgradeneeded = () => { if (!open.result.objectStoreNames.contains('writing')) open.result.createObjectStore('writing'); };
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
  const coreItem = async (topic, id) => {
    const page = await view('topic_messages', { topic_id: topic, message_ids: [id] });
    const item = (page.items ?? page.messages ?? []).find(m => m.id === id);
    assert.ok(item, `Core gives ${id} by its id`);
    return { revision: item.revision, body: item.body, edited: Number.isSafeInteger(item.edited_ms) };
  };
  // A command of the person's from somewhere else (another device), through Core.
  // Read at each command: a restarted server (the build cases' deploys) hands out a new session.
  const headers = () => ({ Authorization: `Bearer ${facts.token}`, Origin: facts.origin, 'Content-Type': 'application/json' });
  const boot = async () => (await fetch(facts.origin + '/api/bootstrap', { headers: headers() })).json();
  const elsewhere = async (kind, id, expected, args, operation) => {
    const b = await boot();
    const receipt = await (await fetch(facts.origin + '/api/command', { method: 'POST', headers: headers(), body: JSON.stringify({ v: 1, instance_id: b.instance_id,
      operation_id: operation, kind, target: { message_id: id },
      expected: { authority: { authority_id: b.authority.authority_id, authority_epoch: b.authority.authority_epoch }, ...expected }, args }) })).json();
    assert.equal(receipt.status, 'committed', `${kind} elsewhere commits: ` + JSON.stringify(receipt.error ?? null));
    return receipt.result;
  };
  // A Save from another device, which holds no edit session: it commits by revision.
  const editElsewhere = (id, revision, body, operation) => elsewhere('message.edit', id, { message_revision: revision }, { body }, operation);
  // Edit opened on another device: it takes the session, and Core answers with the session's draft.
  const OTHER = 'h-another-device';
  const openElsewhere = (id, operation) => elsewhere('message.edit_open', id, {}, { holder: OTHER }, operation);
  // What an agent reading the topic (aim-core, which takes part in it) is given of a message.
  const agentItem = async (topic, id) => {
    const page = await control({ method: 'agent_view', actor: 'aim-core', name: 'topic_messages', args: { topic_id: topic, message_ids: [id] } });
    const item = (page?.items ?? []).find(m => m.id === id);
    assert.ok(item, `an agent is given ${id} by its id: ` + JSON.stringify(page).slice(0, 300));
    return { withheld: item.withheld, body: item.body };
  };
  const closes = p => p.evaluate(`window.sent.filter(kind => kind === 'message.edit_close').length`);
  // The session commands the page sent, in order: [kind without "message.", operation, holder].
  const sessionOf = async p => (await p.evaluate('window.session')).map(([kind, op, holder]) => [kind.replace('message.', ''), op, holder]);
  const kindsOf = async p => (await sessionOf(p)).map(([kind]) => kind);
  // The row this device keeps of a message's edit (messageEditStore), read beside the page's own connection.
  const bindingOf = async id => { const b = await boot(); return { instance_id: b.instance_id, actor_id: b.actor, message_id: id }; };
  const deviceRow = async (p, id) => p.evaluate(`(async()=>{const key=${JSON.stringify(JSON.stringify(await bindingOf(id)))};
    return await new Promise((done,failed)=>{const open=indexedDB.open('theseus-message-edit-v1',1);
      open.onupgradeneeded=()=>{if(!open.result.objectStoreNames.contains('writing'))open.result.createObjectStore('writing')};
      open.onerror=()=>failed(open.error);
      open.onsuccess=()=>{const db=open.result,get=db.transaction('writing','readonly').objectStore('writing').get(key);
        get.onsuccess=()=>{db.close();done(get.result??null)};get.onerror=()=>{db.close();failed(get.error)}}})})()`);
  // Puts a row on this device as an earlier page kept it, before the page's Edit reads it.
  const putRow = async (p, id, kept) => {
    const b = await boot(), binding = await bindingOf(id), row = { ...kept, binding };
    if (row.pending) row.pending = { ...row.pending, instance_id: b.instance_id,
      expected: { ...row.pending.expected, authority: { authority_id: b.authority.authority_id, authority_epoch: b.authority.authority_epoch } } };
    return p.evaluate(`(async()=>{const key=${JSON.stringify(JSON.stringify(binding))},row=${JSON.stringify(row)};
    return await new Promise((done,failed)=>{const open=indexedDB.open('theseus-message-edit-v1',1);
      open.onupgradeneeded=()=>{if(!open.result.objectStoreNames.contains('writing'))open.result.createObjectStore('writing')};
      open.onerror=()=>failed(open.error);
      open.onsuccess=()=>{const db=open.result,tx=db.transaction('writing','readwrite');tx.objectStore('writing').put(row,key);
        tx.oncomplete=()=>{db.close();done(row.pending?row.pending:true)};tx.onerror=()=>{db.close();failed(tx.error)}}})})()`);
  };
  const notice = p => p.evaluate(`document.querySelector('#reader-notice')?.textContent ?? ''`);
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

  await check('reading edit mode is offered in the ⋯ of the person\'s own message only; from a card it opens the Reader on it, and Cancel saves nothing, closes the edit once and leaves the page as it was', async () => {
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
    assert.equal(await edits(p), 0, 'Cancel saves nothing');
    assert.equal(await closes(p), 1, 'and closes the edit session once');
    assert.equal(await p.evaluate(`document.querySelector(${JSON.stringify(words(ids.mine))}).textContent`), 'My own words, as I sent them.', 'the card shows the words as sent');
    assert.deepEqual({ top: await top(p, ids.mine), lit: await lit(p) }, before, 'the card stays where it was, and lit as it was');
    assert.equal(await valueOf(p, '#inline-writing-body'), 'A line in the composer.', 'the composer keeps its words');
    // A Cancel lets the words go: the next Edit starts from the message as sent.
    await menuOf(p, 'laptop', ids.mine); await choose(p, 'laptop', 'Edit');
    await editing(p, 'laptop', 'My own words, as I sent them.');
    await p.point(button('cancel')); await until(async () => await readerOn(p) === null, 'Cancel again');
    assert.equal(await closes(p), 2, 'each Cancel closes once');
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
    assert.equal(await edits(p), 0, 'Escape saves nothing');
    assert.equal(await closes(p), 0, 'and sends no close: the session stays for the next Edit');
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
    assert.equal(await edits(p), 0); assert.equal(await closes(p), 0, 'Escape closes nothing');
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
    assert.equal(await edits(p), 0, 'phone: Cancel saves nothing'); assert.equal(await closes(p), 1, 'phone: and closes once');
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
    assert.deepEqual(await coreItem(topic, ids.mine), { revision: 2, body: 'My words, corrected.', edited: true });
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
    assert.deepEqual(await coreItem(topic, ids.mine), { revision: 3, body: 'My words, corrected twice.', edited: true });
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
    // Which document is up: its timeOrigin as first read, kept on the window (WebKit's can move 1 ms with no load).
    const loaded = await p.evaluate('(window.documentOrigin??=performance.timeOrigin)');
    await editElsewhere(ids.mine, 1, 'Ship it at 6.', `${topic}-elsewhere`);
    await until(async () => (await line())?.includes('Ship it at 6.'), 'the reply\'s line reads the latest words');
    assert.equal((await line()).includes('Ship it at 5.'), false, 'and not the old ones');
    assert.equal(await p.evaluate('(window.documentOrigin??=performance.timeOrigin)'), loaded, 'without a reload');
    assert.equal(await p.evaluate('window.edits'), 0, 'this page sent nothing');
    assert.deepEqual(p.errors, []);
    await p.close();
  });

  await check('reading edit save after a newer revision is a conflict: the saved words are shown, and Save mine or Use saved', async () => {
    const topic = 'edit-conflict-laptop', ids = await edited(topic);
    const p = await open(topic, 'laptop', topic, ids.mine, EDIT_FAULTS);
    for (const [choice, revision] of [['mine', 2], ['saved', 4]]) {
      const body = (await coreItem(topic, ids.mine)).body;
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
      assert.deepEqual(await coreItem(topic, ids.mine), choice === 'mine'
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
    assert.deepEqual(await coreItem(topic, ids.mine), { revision: 2, body: 'Saved, though no answer came.', edited: true });
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
    assert.deepEqual(await coreItem(topic, ids.mine), { revision: 1, body: 'My own words, as I sent them.', edited: false }, 'Core took nothing');
    await p.point(button('retry'));
    await until(async () => await readerOn(p) === null, 'Try again saves');
    assert.deepEqual(await coreItem(topic, ids.mine), { revision: 2, body: 'Saved after a busy moment.', edited: true });
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
    assert.deepEqual(await coreItem(topic, ids.mine), { revision: 2, body: 'Saved slowly.', edited: true });
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
      await until(async () => await status(p) === 'Kept', 'editing: Core keeps the words as they are written');
      await laid(p, device, 'kept');
      // Another device opens the edit: this one says so, with Edit here, and takes it back by it.
      await openElsewhere(ids.mine, `${topic}-other-open`);
      await until(async () => await state(p) === 'elsewhere' && await status(p) === 'Open on your other device', 'elsewhere: another device holds the edit');
      assert.deepEqual(await laid(p, device, 'elsewhere'), ['here', 'cancel', 'save'], `${device} ${width}: elsewhere offers Edit here`);
      assert.equal(await p.evaluate(`document.querySelector('${button('here')}').title`), 'Take the edit back to this device');
      for (const scheme of ['light', 'dark']) {
        await p.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: scheme }] });
        await shot(p, `edit-states-${width}-elsewhere-${scheme}`);
        await laid(p, device, 'elsewhere ' + scheme);
      }
      await p.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'light' }] });
      await press(p, device, button('here'));
      await until(async () => await state(p) === 'editing' && await off(p, 'here') === true, 'Edit here: this device holds the edit again');
      // Empty: Save is off.
      await replaceWords(p, '');
      await until(async () => await off(p, 'save') === true, 'empty: Save is off');
      await laid(p, device, 'empty');
      // Too long: Core refuses it, recorded; the words stay in the field, and Save stays on for changed words. A draft
      // save of the same words may be refused before the tap or while the Save is out; what shows follows the Save
      // alone. Held, it is Saving… with the field read only; once answered, its own refusal, the field editable.
      const long = 'x'.repeat(1048577);
      await p.evaluate(`(f=>{f.value='x'.repeat(1048577);f.dispatchEvent(new Event('input',{bubbles:true}))})(document.querySelector('${FIELD}'))`);
      await p.evaluate('window.holdEdit = true');
      await saveBy(p, device);
      await until(() => p.evaluate(`Boolean(window.letOf['message.edit'])`), 'too long: the Save is out, held');
      assert.equal(await state(p), 'saving', 'too long: while the Save is out, it is saving');
      assert.equal(await status(p), 'Saving…', 'too long: while the Save is out, Saving…');
      assert.equal(await p.evaluate(`document.querySelector('${FIELD}').readOnly`), true, 'too long: while the Save is out, the field reads only');
      const editsBefore = await p.evaluate('window.edits');
      await p.evaluate('window.letEdit()');
      await until(async () => await p.evaluate('window.edits') === editsBefore + 1 && await state(p) === 'refused', 'too long: the Save answered, refused');
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
      assert.deepEqual(await coreItem(topic, ids.mine), { revision: 2, body: 'Saved after busy and a wait.', edited: true });
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
      assert.deepEqual(await coreItem(topic, ids.mine), { revision: 4, body: 'Saved on another device.', edited: true }, 'Use saved saves nothing');
      assert.equal((await kindsOf(p)).at(-1), 'edit_close', 'and closes the edit');
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
      assert.deepEqual(await coreItem(topic, ids.mine), { revision: 2, body: 'Saved on another device.', edited: true });
      // Use the saved words as mine: Save mine with words equal to the current revision ends the edit unchanged.
      await replaceWords(p, 'Saved on another device.');
      const before = await p.evaluate('window.edits');
      await press(p, device, button('mine'));
      await until(async () => await readerOn(p) === null, 'Save mine with the saved words ends the edit');
      assert.equal(await p.evaluate('window.edits'), before, 'and sends nothing');
      assert.deepEqual(await coreItem(topic, ids.mine), { revision: 2, body: 'Saved on another device.', edited: true });
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
    const loaded = await p.evaluate('(window.documentOrigin??=performance.timeOrigin)');
    await editElsewhere(ids.mine, 1, 'The fix is [Second try](https://github.com/acme/field/pull/2); see http://bench.example.ts.net:5192/preview/two.', `${topic}-elsewhere`);
    await until(async () => JSON.stringify(await things()) === JSON.stringify({ prs: ['https://github.com/acme/field/pull/2'], previews: ['http://bench.example.ts.net:5192/preview/two'] }),
      'the right rail shows the edited message\'s links, and not the old ones');
    assert.equal(await p.evaluate('(window.documentOrigin??=performance.timeOrigin)'), loaded, 'without a reload');
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

  // From here, item 452: the edit session in Core.
  // An agent's correction of its own words (item 614): an edit of its message, never a second one. For the person who
  // had read the first words, the card and the Reader show those Core says the edit took away struck through where they
  // stood, beside the new ones, and the message is unread again; for a topic the person had not read, only the new
  // words. Reads on screen are held, so what shows unread is what Core holds, not what this page then reads again.
  const FIRST = 'Built on release 85, and the checks are green.', FIXED = 'Built on release 86, and the checks are green.';
  const STRUCK = 'Built on release 85 86, and the checks are green.';
  // Waits for read() to give want; on a timeout the failure shows what it gave instead.
  const becomes = async (read, want, message) => {
    let last;
    try { await until(async () => JSON.stringify(last = await read()) === JSON.stringify(want), message); }
    catch (error) { assert.deepEqual(last, want, message); throw error; }
  };
  // A card or the Reader as the person sees it: its words (the Reader's without its end line), each struck run's words,
  // and how a struck run is drawn.
  const strikeOf = (p, host) => p.evaluate(`(h=>h&&{text:[...h.childNodes].filter(n=>!n.classList?.contains('reader-end')).map(n=>n.textContent).join(''),struck:[...h.querySelectorAll('del.struck-words')].map(d=>d.textContent),
    look:[...h.querySelectorAll('del.struck-words')].map(d=>{const s=getComputedStyle(d);return {through:s.textDecorationLine.includes('line-through'),title:d.title,
      quiet:s.color!==getComputedStyle(h).color}})})(document.querySelector(${JSON.stringify(host)}))`);
  const agentCards = p => p.evaluate(`[...document.querySelectorAll('#messages .message-card[data-id]')].filter(c=>c.textContent.includes('Built on release')).length`);
  await check('reading edit agent correction: one card; the person who had read it sees the old words struck through beside the new ones, on the card and in the Reader, and it is unread again; a topic not yet read shows only the new words; at 320, 375 and 390 wide by touch, and on a laptop, light and dark', async () => {
    for (const [device, width] of WIDTHS) {
      const read = `edit-agent-read-${width}`, fresh = `edit-agent-fresh-${width}`;
      // The person reads the agent's line before its correction in one topic, and not in the other.
      const a = await seed(read, [['line', { sender: 'aim-core', join: true, body: FIRST, read: true }]]);
      const b = await seed(fresh, [['line', { sender: 'aim-core', join: true, body: FIRST }]]);
      const unreadIn = async (topic, id) => (await view('topic_messages', { topic_id: topic, message_ids: [id] })).items.find(item => item.id === id)?.unread;
      assert.equal(await unreadIn(read, a.line), false, `${width}: read before the correction`);
      assert.equal(await unreadIn(fresh, b.line), true, `${width}: not read before the correction`);
      const p = await open(read, device, read, a.line, 'window.holdReads = true');
      if (device === 'phone' && width !== 390) await p.send('Emulation.setDeviceMetricsOverride', { width, height: 740, deviceScaleFactor: 1, mobile: true });
      assert.deepEqual(await strikeOf(p, words(a.line)), { text: FIRST, struck: [], look: [] }, `${width}: the first words, nothing struck`);
      assert.ok(await p.evaluate(`document.querySelector(${JSON.stringify(card(a.line))}).hasAttribute('data-read')`), `${width}: the card reads as read`);
      // A minute later the agent corrects it, by editing it, while the page is open; and the line in the other topic.
      const edits = [];
      for (const [topic, id] of [[read, a.line], [fresh, b.line]]) {
        edits.push(await control({ method: 'agent_edit', operation_id: `${topic}-edit`, sender: 'aim-core', message_id: id, body: FIXED }));
      }
      assert.deepEqual(edits.map(receipt => [receipt.status, receipt.error?.code ?? null, receipt.result?.revision ?? null]),
        [['committed', null, 2], ['committed', null, 2]], `${width}: Core takes the agent's edit of its own words`);
      // On the open page, with no reload: the same card shows 85 struck through before 86, and the message is new again.
      await becomes(() => strikeOf(p, words(a.line)).then(seen => seen && { text: seen.text, struck: seen.struck }), { text: STRUCK, struck: ['85'] },
        `${width}: the card shows "85" struck through before "86"`);
      const { look } = await strikeOf(p, words(a.line));
      assert.deepEqual(look, [{ through: true, title: 'Words you read before the author changed them', quiet: true }], `${width}: drawn struck through, quieter, with a title`);
      assert.equal(await agentCards(p), 1, `${width}: one card, not a second message`);
      assert.equal(await unreadIn(read, a.line), true, `${width}: Core holds it unread again`);
      await until(() => p.evaluate(`!document.querySelector(${JSON.stringify(card(a.line))}).hasAttribute('data-read')`), `${width}: the card reads as new again`);
      assert.ok(await p.evaluate('document.documentElement.scrollWidth <= innerWidth'), `${width}: nothing beyond the window`);
      for (const scheme of ['light', 'dark']) {
        await p.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: scheme }] });
        assert.equal((await strikeOf(p, words(a.line))).look[0].quiet, true, `${width} ${scheme}: the struck words are quieter`);
        await shot(p, `edit-agent-card-${width}-${scheme}`);
      }
      await p.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'light' }] });
      // The Reader shows the message whole, the same way.
      await openReader(p, device, a.line, 'Built on release');
      await becomes(() => strikeOf(p, '#source-body').then(seen => seen && { text: seen.text.trim(), struck: seen.struck }), { text: STRUCK, struck: ['85'] },
        `${width}: the Reader shows "85" struck through before "86"`);
      for (const scheme of ['light', 'dark']) {
        await p.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: scheme }] });
        await shot(p, `edit-agent-reader-${width}-${scheme}`);
      }
      await p.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'light' }] });
      // A second correction that only adds words, before and after, while the Reader shows the message: nothing more is
      // struck, there or on the card, and what was struck moves with the words. The person is reading it there.
      const again = await control({ method: 'agent_edit', operation_id: `${read}-edit-2`, sender: 'aim-core', message_id: a.line, revision: 2, body: 'Update: ' + FIXED + ' Deployed.' });
      assert.equal(again.status, 'committed', `${width}: the second edit commits`);
      await becomes(() => strikeOf(p, '#source-body').then(seen => seen && { text: seen.text.trim(), struck: seen.struck }), { text: 'Update: ' + STRUCK + ' Deployed.', struck: ['85'] },
        `${width}: the open Reader shows the added words, and only what they had read and lost is struck, where it now stands`);
      await closeReader(p, device === 'laptop' ? 'laptop' : 'phone');
      await becomes(() => strikeOf(p, words(a.line)).then(seen => seen && { text: seen.text, struck: seen.struck }), { text: 'Update: ' + STRUCK + ' Deployed.', struck: ['85'] },
        `${width}: the card shows the same`);
      // A third, with the Reader closed: the card is new again, though this visit opened it.
      const third = await control({ method: 'agent_edit', operation_id: `${read}-edit-3`, sender: 'aim-core', message_id: a.line, revision: 3, body: 'Update: ' + FIXED + ' Deployed at noon.' });
      assert.equal(third.status, 'committed', `${width}: the third edit commits`);
      await becomes(() => strikeOf(p, words(a.line)).then(seen => seen && { text: seen.text, struck: seen.struck }), { text: 'Update: ' + STRUCK + ' Deployed at noon.', struck: ['85'] },
        `${width}: the card shows the third words`);
      await until(() => p.evaluate(`!document.querySelector(${JSON.stringify(card(a.line))}).hasAttribute('data-read')`), `${width}: the card reads as new again after the third edit`);
      assert.deepEqual(p.errors, []);
      await p.close();
      // A page loaded afresh draws the card struck from the start, new.
      const r = await open(read, device, read, a.line, 'window.holdReads = true');
      assert.deepEqual(await strikeOf(r, words(a.line)).then(seen => ({ text: seen.text, struck: seen.struck })), { text: 'Update: ' + STRUCK + ' Deployed at noon.', struck: ['85'] },
        `${width}: loaded afresh, the card is drawn struck`);
      assert.equal(await r.evaluate(`document.querySelector(${JSON.stringify(card(a.line))}).hasAttribute('data-read')`), false, `${width}: and new`);
      assert.deepEqual(r.errors, []);
      await r.close();
      // The topic the person had not read: only the new words, once, nothing struck.
      const q = await open(fresh, device, fresh, b.line, 'window.holdReads = true');
      if (device === 'phone' && width !== 390) await q.send('Emulation.setDeviceMetricsOverride', { width, height: 740, deviceScaleFactor: 1, mobile: true });
      assert.deepEqual(await strikeOf(q, words(b.line)), { text: FIXED, struck: [], look: [] }, `${width}: not read before: only the new words`);
      assert.equal(await agentCards(q), 1, `${width}: one card`);
      for (const scheme of ['light', 'dark']) {
        await q.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: scheme }] });
        await shot(q, `edit-agent-fresh-${width}-${scheme}`);
      }
      assert.deepEqual(q.errors, []);
      await q.close();
    }
  });

  // A long correction: the agent's report runs past what a card shows, and its edit changes words in the excerpt and
  // past it. The card strikes what its excerpt shows; read on in place (lit) or shown full, it holds the whole message,
  // and strikes everything the person had read that the edit took away. A reader who had not read it sees none.
  await check('reading edit agent long correction: a card cut off at its excerpt strikes what it shows, and lit or shown full strikes everything the edit took away; nothing for a topic not yet read; at 320, 375 and 390 wide by touch, and on a laptop, light and dark', async () => {
    const report = n => `Built on release ${n}, and the checks are green.\n\n` + Array.from({ length: 24 }, (_, i) => `Step ${i + 1} of the glossary rebuild ran in order and wrote its lamp file.`).join('\n\n') + `\n\nSigned off on build ${n}.`;
    const LONG = report(85), LONG_FIXED = report(86);
    assert.ok(new TextEncoder().encode(LONG.slice(0, LONG.indexOf('Signed off'))).length > 1024, 'the last line is past what a card shows');
    const shape = (p, id) => strikeOf(p, words(id)).then(seen => seen && { struck: seen.struck, signed: seen.text.includes('Signed off') ? seen.text.slice(seen.text.indexOf('Signed off')) : '' });
    for (const [device, width] of WIDTHS) {
      const read = `edit-agent-long-${width}`, fresh = `edit-agent-long-fresh-${width}`;
      const a = await seed(read, [['line', { sender: 'aim-core', join: true, body: LONG, read: true }]]);
      const b = await seed(fresh, [['line', { sender: 'aim-core', join: true, body: LONG }]]);
      for (const [topic, id] of [[read, a.line], [fresh, b.line]]) {
        const receipt = await control({ method: 'agent_edit', operation_id: `${topic}-edit`, sender: 'aim-core', message_id: id, body: LONG_FIXED });
        assert.deepEqual([receipt.status, receipt.result?.revision ?? null], ['committed', 2], `${width}: Core takes the agent's edit`);
      }
      for (const [topic, id, struck] of [[read, a.line, ['85', '85']], [fresh, b.line, []]]) {
        const said = `${width} ${topic === read ? 'read before' : 'not read before'}`;
        const p = await open(topic, device, topic, id, 'window.holdReads = true');
        if (device === 'phone' && width !== 390) await p.send('Emulation.setDeviceMetricsOverride', { width, height: 740, deviceScaleFactor: 1, mobile: true });
        // The excerpt: the first change struck, the last line not shown.
        assert.deepEqual(await shape(p, id), { struck: struck.slice(0, 1), signed: '' }, `${said}: the excerpt strikes what it shows`);
        // Lit, the card is a box holding the whole message, and strikes both changes.
        await light(p, device, id);
        await until(() => p.evaluate(`(c=>c.dataset.whole==='shown'&&c.classList.contains('scroll-in-place'))(document.querySelector(${JSON.stringify(card(id))}))`), `${said}: lit, the card holds the whole message`);
        await becomes(() => shape(p, id), { struck, signed: struck.length ? 'Signed off on build 85 86.' : 'Signed off on build 86.' }, `${said}: lit, the whole message's changes are struck`);
        assert.ok(await p.evaluate('document.documentElement.scrollWidth <= innerWidth'), `${said}: nothing beyond the window`);
        for (const scheme of ['light', 'dark']) {
          await p.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: scheme }] });
          await p.evaluate(`(c=>{c.scrollTop=c.scrollHeight})(document.querySelector(${JSON.stringify(card(id))}))`);
          await shot(p, `edit-agent-long-lit-${topic === read ? 'read' : 'fresh'}-${width}-${scheme}`);
        }
        await p.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'light' }] });
        // Show full: the card grows to the whole message, struck the same.
        assert.ok((await menuOf(p, device, id)).includes('Show full message'), `${said}: the cut-off card offers Show full message`);
        await choose(p, device, 'Show full message');
        await until(() => p.evaluate(`document.querySelector(${JSON.stringify(card(id))}).dataset.full==='shown'`), `${said}: shown full`);
        assert.deepEqual(await shape(p, id), { struck, signed: struck.length ? 'Signed off on build 85 86.' : 'Signed off on build 86.' }, `${said}: shown full, the same changes are struck`);
        assert.deepEqual(p.errors, []);
        await p.close();
      }
    }
  });

  await check('reading edit hold: Edit sends edit_open before the field shows, an agent then reads the message without its words, and Cancel closes once and gives them back', async () => {
    const topic = 'edit-hold-laptop', ids = await edited(topic);
    const p = await open(topic, 'laptop', topic, ids.mine, EDIT_FAULTS);
    const words = 'My own words, as I sent them.';
    assert.deepEqual(await agentItem(topic, ids.mine), { withheld: false, body: words }, 'before Edit an agent reads the words');
    await p.evaluate(`window.faultOf['message.edit_open'] = 'hold'`);
    await menuOf(p, 'laptop', ids.mine); await choose(p, 'laptop', 'Edit');
    await until(() => p.evaluate(`typeof window.letOf['message.edit_open'] === 'function'`), 'edit_open leaves');
    assert.deepEqual(await p.evaluate(`({ editing: document.querySelector('#reader').dataset.editing ?? null, shown: !document.querySelector('${EDIT}').hidden })`),
      { editing: null, shown: false }, 'the field waits for Core\'s answer');
    await p.evaluate(`window.letOf['message.edit_open']()`);
    await editing(p, 'laptop', words);
    const [[kind, , holder]] = await sessionOf(p);
    assert.equal(kind, 'edit_open'); assert.equal(typeof holder, 'string');
    assert.equal((await deviceRow(p, ids.mine))?.holder, holder, 'the device keeps the holder it named');
    assert.deepEqual(await agentItem(topic, ids.mine), { withheld: true, body: '' }, 'while Edit is open an agent is given the message without its words');
    assert.equal((await coreItem(topic, ids.mine)).body, words, 'the person still reads their words');
    await p.point(button('cancel'));
    await until(async () => await readerOn(p) === null, 'Cancel ends the edit');
    assert.deepEqual(await kindsOf(p), ['edit_open', 'edit_close'], 'one close, and nothing saved');
    assert.deepEqual(await agentItem(topic, ids.mine), { withheld: false, body: words }, 'Cancel gives the agent the words back');
    assert.equal(await deviceRow(p, ids.mine), null, 'the device row goes');
    assert.deepEqual(p.errors, []);
    await p.close();
  });

  await check('reading edit hold draft: typing saves the words to Core, Kept; another device opening Edit gets them, and this one says Open on your other device, its Save commits by revision and closes nothing', async () => {
    for (const device of ['laptop', 'phone']) {
      const topic = `edit-draft-${device}`, ids = await edited(topic);
      const p = await open(topic, device, topic, ids.mine, EDIT_FAULTS);
      await menuOf(p, device, ids.mine); await choose(p, device, 'Edit');
      await editing(p, device, 'My own words, as I sent them.');
      await replaceWords(p, 'Words to carry to another device.');
      await until(async () => await status(p) === 'Kept', `${device}: Core confirms the words`);
      const drafts = (await sessionOf(p)).filter(([kind]) => kind === 'edit_draft');
      assert.ok(drafts.length >= 1, 'a draft save went');
      const other = await openElsewhere(ids.mine, `${topic}-other-open`);
      assert.deepEqual([other.draft, other.taken], ['Words to carry to another device.', true], 'another device opens on this one\'s Core draft');
      await until(async () => await status(p) === 'Open on your other device', `${device}: this page learns another device holds the edit`);
      assert.equal(await off(p, 'here'), false, 'Edit here is offered');
      await replaceWords(p, 'Saved from the device that let go.');
      const before = (await sessionOf(p)).length;
      await (device === 'phone' ? press(p, device, button('save')) : p.key('Enter', 4));
      await until(async () => await readerOn(p) === null, `${device}: Save commits by revision and the edit ends`);
      assert.deepEqual((await sessionOf(p)).slice(before).map(([kind]) => kind), ['edit'], 'a Save, and no close: this device does not hold the edit');
      assert.deepEqual(await coreItem(topic, ids.mine), { revision: 2, body: 'Saved from the device that let go.', edited: true });
      assert.deepEqual(await agentItem(topic, ids.mine), { withheld: true, body: '' }, 'the other device still holds the message from agents');
      await elsewhere('message.edit_close', ids.mine, {}, { holder: OTHER }, `${topic}-other-close`);
      assert.deepEqual(await agentItem(topic, ids.mine), { withheld: false, body: 'Saved from the device that let go.' }, 'its close gives them the new words');
      assert.deepEqual(p.errors, []);
      await p.close();
    }
  });

  await check('reading edit hold Edit here: a device that lost the edit takes it back, saves its words as the draft, and its Cancel closes once', async () => {
    const topic = 'edit-here-laptop', ids = await edited(topic);
    const p = await open(topic, 'laptop', topic, ids.mine, EDIT_FAULTS);
    await menuOf(p, 'laptop', ids.mine); await choose(p, 'laptop', 'Edit');
    await editing(p, 'laptop', 'My own words, as I sent them.');
    const [[, , holder]] = await sessionOf(p);
    await openElsewhere(ids.mine, `${topic}-other-open`);
    await until(async () => await state(p) === 'elsewhere', 'another device holds the edit');
    await replaceWords(p, 'Taken back to this device.');
    const before = (await sessionOf(p)).length;
    await p.point(button('here'));
    await until(async () => await state(p) === 'editing' && await off(p, 'here') === true, 'Edit here takes it back');
    await until(async () => await status(p) === 'Kept', 'and Core confirms this device\'s words as the draft');
    const after = (await sessionOf(p)).slice(before);
    assert.deepEqual(after.slice(0, 2).map(([kind, , h]) => [kind, h]), [['edit_open', holder], ['edit_draft', holder]], 'edit_open with this page\'s holder, then its words');
    const reopened = await openElsewhere(ids.mine, `${topic}-other-again`);
    assert.equal(reopened.draft, 'Taken back to this device.', 'Core holds this device\'s words as the draft');
    await until(async () => await state(p) === 'elsewhere', 'the other device takes it again');
    await p.point(button('cancel'));
    await until(async () => await readerOn(p) === null, 'Cancel ends the edit here');
    assert.equal(await closes(p), 0, 'Cancel on a device that does not hold the edit closes nothing');
    assert.deepEqual(await agentItem(topic, ids.mine), { withheld: true, body: '' }, 'the other device still holds it');
    await elsewhere('message.edit_close', ids.mine, {}, { holder: OTHER }, `${topic}-other-close`);
    assert.deepEqual(p.errors, []);
    await p.close();
  });

  await check('reading edit hold another device resumes: a device with no row of its own opens Edit on the Core draft written elsewhere', async () => {
    const topic = 'edit-resume-core-laptop', ids = await edited(topic);
    let p = await open(topic, 'laptop', topic, ids.mine, EDIT_FAULTS);
    await menuOf(p, 'laptop', ids.mine); await choose(p, 'laptop', 'Edit');
    await editing(p, 'laptop', 'My own words, as I sent them.');
    await replaceWords(p, 'A draft begun on the laptop.');
    await until(async () => await status(p) === 'Kept', 'Core keeps the draft');
    const [[, , first]] = await sessionOf(p);
    await p.key('Escape'); await notEditing(p);
    assert.equal(await closes(p), 0, 'Escape sends no close');
    // Another device: this device's row is let go, as a device that never held it has none.
    await p.evaluate(`new Promise((done, failed) => { const d = indexedDB.deleteDatabase('theseus-message-edit-v1'); d.onsuccess = () => done(true); d.onerror = () => failed(d.error); })`);
    await p.close();
    p = await open(topic + '-again', 'laptop', topic, ids.mine, EDIT_FAULTS);
    await menuOf(p, 'laptop', ids.mine); await choose(p, 'laptop', 'Edit');
    await editing(p, 'laptop', 'A draft begun on the laptop.');
    const [[kind, , holder]] = await sessionOf(p);
    assert.equal(kind, 'edit_open'); assert.notEqual(holder, first, 'a new holder: another device');
    assert.equal(await state(p), 'editing'); assert.equal(await status(p), 'Kept', 'Core\'s draft, which Core keeps');
    await p.point(button('cancel'));
    await until(async () => await readerOn(p) === null, 'Cancel');
    assert.deepEqual(await kindsOf(p), ['edit_open', 'edit_close']);
    assert.deepEqual(await agentItem(topic, ids.mine), { withheld: false, body: 'My own words, as I sent them.' });
    assert.deepEqual(p.errors, []);
    await p.close();
  });

  await check('reading edit hold Escape and reload: Escape sends nothing and the message stays held; a reload\'s Edit rejoins the session with the same holder and the words', async () => {
    const topic = 'edit-reload-laptop', ids = await edited(topic);
    let p = await open(topic, 'laptop', topic, ids.mine, EDIT_FAULTS);
    await menuOf(p, 'laptop', ids.mine); await choose(p, 'laptop', 'Edit');
    await editing(p, 'laptop', 'My own words, as I sent them.');
    await replaceWords(p, 'Half a thought, kept.');
    await until(async () => await status(p) === 'Kept', 'Core keeps the words');
    const sent = (await sessionOf(p)).length, [[, , holder]] = await sessionOf(p);
    await p.key('Escape'); await notEditing(p);
    assert.equal((await sessionOf(p)).length, sent, 'Escape sends nothing to Core');
    assert.deepEqual(await agentItem(topic, ids.mine), { withheld: true, body: '' }, 'the session stays open, and holds the message until it lapses');
    assert.equal((await deviceRow(p, ids.mine))?.holder, holder, 'the device row stays');
    await p.close();
    p = await open(topic + '-reload', 'laptop', topic, ids.mine, EDIT_FAULTS);
    await menuOf(p, 'laptop', ids.mine); await choose(p, 'laptop', 'Edit');
    await editing(p, 'laptop', 'Half a thought, kept.');
    assert.deepEqual((await sessionOf(p))[0].filter((_, n) => n !== 1), ['edit_open', holder], 'the reload rejoins with the same holder');
    await p.point(button('cancel'));
    await until(async () => await readerOn(p) === null, 'Cancel');
    assert.deepEqual(await kindsOf(p), ['edit_open', 'edit_close']);
    assert.deepEqual(await agentItem(topic, ids.mine), { withheld: false, body: 'My own words, as I sent them.' });
    assert.deepEqual(p.errors, []);
    await p.close();
  });

  await check('reading edit hold resumed Save: a reload while saving replays the Save as it was made, then closes once; Core holds revision 2 and an agent reads it', async () => {
    const topic = 'edit-replay-laptop', ids = await edited(topic);
    let p = await open(topic, 'laptop', topic, ids.mine, EDIT_FAULTS);
    await menuOf(p, 'laptop', ids.mine); await choose(p, 'laptop', 'Edit');
    await editing(p, 'laptop', 'My own words, as I sent them.');
    await replaceWords(p, 'Saved across a reload.');
    await p.evaluate('window.holdEdit = true');
    await p.key('Enter', 4);
    // Saving… shows before the Save's request leaves (the device keeps it first), so the case waits on the request itself.
    await until(async () => await state(p) === 'saving' && (await kindsOf(p)).includes('edit'), 'the Save is out');
    const save = (await sessionOf(p)).find(([kind]) => kind === 'edit');
    await p.close();
    assert.deepEqual(await coreItem(topic, ids.mine), { revision: 1, body: 'My own words, as I sent them.', edited: false }, 'the Save never reached Core');
    p = await open(topic + '-reload', 'laptop', topic, ids.mine, EDIT_FAULTS);
    await menuOf(p, 'laptop', ids.mine); await choose(p, 'laptop', 'Edit');
    await until(async () => (await kindsOf(p)).includes('edit_close') && await readerOn(p) === null, 'the kept Save goes, a close follows, and the edit ends');
    const again = await sessionOf(p);
    assert.deepEqual(again.map(([kind]) => kind), ['edit_open', 'edit', 'edit_close'], 'edit_open, the Save, and one close');
    assert.deepEqual(again[1], save, 'the Save is the one made before the reload, under its operation');
    assert.deepEqual(await coreItem(topic, ids.mine), { revision: 2, body: 'Saved across a reload.', edited: true });
    assert.deepEqual(await agentItem(topic, ids.mine), { withheld: false, body: 'Saved across a reload.' }, 'the session is not open: an agent reads revision 2');
    assert.equal(await deviceRow(p, ids.mine), null);
    assert.deepEqual(p.errors, []);
    await p.close();
  });

  await check('reading edit hold kept close: a Cancel whose close gets no answer keeps it on the device; the next Edit sends it again first under the same operation, and not at all past a busy one', async () => {
    const topic = 'edit-kept-close-laptop', ids = await edited(topic);
    const p = await open(topic, 'laptop', topic, ids.mine, EDIT_FAULTS);
    await menuOf(p, 'laptop', ids.mine); await choose(p, 'laptop', 'Edit');
    await editing(p, 'laptop', 'My own words, as I sent them.');
    await replaceWords(p, 'Words to let go.');
    // The close is slow: Save and Cancel go off at once, and then its answer is lost.
    await p.evaluate(`window.faultOf['message.edit_close'] = 'hold'`);
    await p.point(button('cancel'));
    await until(() => p.evaluate(`typeof window.letOf['message.edit_close'] === 'function'`), 'the close leaves');
    assert.deepEqual([await off(p, 'save'), await off(p, 'cancel')], [true, true], 'Save and Cancel are off while the close is out');
    await p.evaluate(`window.letOf['message.edit_close'](true)`);
    await until(async () => await readerOn(p) === null, 'with no answer the edit still ends');
    const [, , holder] = (await sessionOf(p))[0], [kind, operation] = (await sessionOf(p)).at(-1);
    assert.equal(kind, 'edit_close');
    const row = await deviceRow(p, ids.mine);
    assert.deepEqual({ holder: row?.holder, closing: row?.closing, value: row?.value }, { holder, closing: operation, value: undefined },
      'the device keeps only the holder and the close\'s operation');
    // The next Edit sends the kept close first; busy, nothing opens and the row stays.
    let sent = (await sessionOf(p)).length;
    await p.evaluate(`window.faultOf['message.edit_close'] = 'busy'`);
    await menuOf(p, 'laptop', ids.mine); await choose(p, 'laptop', 'Edit');
    await until(async () => await notice(p) === 'Edit could not start: Theseus was busy', 'busy: Edit could not start, and says why');
    assert.deepEqual((await sessionOf(p)).slice(sent).map(([k, op]) => [k, op]), [['edit_close', operation]], 'the kept close, and no edit_open');
    assert.equal(await p.evaluate(`document.querySelector('#reader').dataset.editing ?? null`), null, 'nothing opens');
    assert.equal((await deviceRow(p, ids.mine))?.closing, operation, 'the row stays');
    await closeReader(p, 'laptop');
    sent = (await sessionOf(p)).length;
    await menuOf(p, 'laptop', ids.mine); await choose(p, 'laptop', 'Edit');
    await editing(p, 'laptop', 'My own words, as I sent them.');
    const next = (await sessionOf(p)).slice(sent);
    assert.deepEqual(next.map(([k, op]) => [k, op === operation]), [['edit_close', true], ['edit_open', false]], 'the kept close again, under its operation, then edit_open');
    assert.notEqual(next[1][2], holder, 'a fresh row, with a new holder');
    await p.point(button('cancel'));
    await until(async () => await readerOn(p) === null, 'Cancel');
    assert.deepEqual(await agentItem(topic, ids.mine), { withheld: false, body: 'My own words, as I sent them.' });
    assert.deepEqual(p.errors, []);
    await p.close();
  });

  await check('reading edit hold slice-1 row: a row kept before sessions opens on its words, which become the draft; a kept slice-1 Save replays as it was made and then closes once', async () => {
    const topic = 'edit-slice1-laptop', ids = await edited(topic);
    const p = await open(topic, 'laptop', topic, ids.mine, EDIT_FAULTS);
    await putRow(p, ids.mine, { v: 1, base: { revision: 1, body: 'My own words, as I sent them.' }, value: 'Words kept before sessions.', pending: null, conflict: null });
    await menuOf(p, 'laptop', ids.mine); await choose(p, 'laptop', 'Edit');
    await editing(p, 'laptop', 'Words kept before sessions.');
    await until(async () => (await kindsOf(p)).join() === 'edit_open,edit_draft' && await status(p) === 'Kept', 'its words become the draft');
    const [[, , holder], [, , draftHolder]] = await sessionOf(p);
    assert.equal(draftHolder, holder);
    await p.key('Escape'); await notEditing(p);
    // A slice-1 Save kept on the device: {body} alone, replayed byte for byte, then one close.
    const operation = `${topic}-slice1-save`;
    const envelope = await putRow(p, ids.mine, { v: 1, base: { revision: 1, body: 'My own words, as I sent them.' }, value: 'Saved by a page of slice 1.', conflict: null,
      pending: { v: 1, instance_id: '', operation_id: operation, kind: 'message.edit', target: { message_id: ids.mine },
        expected: { authority: {}, message_revision: 1 }, args: { body: 'Saved by a page of slice 1.' } } });
    assert.deepEqual(Object.keys(envelope.args), ['body']);
    const sent = (await sessionOf(p)).length;
    await menuOf(p, 'laptop', ids.mine); await choose(p, 'laptop', 'Edit');
    await until(async () => (await kindsOf(p)).slice(sent).includes('edit_close') && await readerOn(p) === null, 'the kept Save goes, a close follows, and the edit ends');
    const after = (await sessionOf(p)).slice(sent);
    assert.deepEqual(after.map(([kind, op, h]) => [kind, kind === 'edit' ? op : null, kind === 'edit' ? h : null]),
      [['edit_open', null, null], ['edit', operation, null], ['edit_close', null, null]], 'edit_open, the slice-1 Save with no holder, then one close');
    assert.deepEqual(await coreItem(topic, ids.mine), { revision: 2, body: 'Saved by a page of slice 1.', edited: true });
    assert.deepEqual(await agentItem(topic, ids.mine), { withheld: false, body: 'Saved by a page of slice 1.' });
    assert.deepEqual(p.errors, []);
    await p.close();
  });

  // Early timing: each step answered late, or never.
  await check('reading edit timing slow device store: edit_open waits until the device row is read, the holder is on the device while it is out, and the field waits for Core', async () => {
    const topic = 'edit-slow-store-laptop', ids = await edited(topic);
    const p = await open(topic, 'laptop', topic, ids.mine, EDIT_FAULTS);
    await holdKept(p);
    await p.evaluate(`window.faultOf['message.edit_open'] = 'hold'`);
    await menuOf(p, 'laptop', ids.mine); await choose(p, 'laptop', 'Edit');
    await until(() => p.evaluate('window.keptRead === true'), 'Edit reads the device row');
    assert.deepEqual(await sessionOf(p), [], 'nothing goes to Core while the device row is unread');
    await p.evaluate('window.keptHeld = false');
    await until(() => p.evaluate(`typeof window.letOf['message.edit_open'] === 'function'`), 'then edit_open leaves');
    const [[, , holder]] = await sessionOf(p);
    assert.equal((await deviceRow(p, ids.mine))?.holder, holder, 'the holder is on the device while edit_open is out');
    assert.equal(await p.evaluate(`document.querySelector('#reader').dataset.editing ?? null`), null, 'the field waits for Core');
    await p.evaluate(`window.letOf['message.edit_open']()`);
    await editing(p, 'laptop', 'My own words, as I sent them.');
    await p.point(button('cancel'));
    await until(async () => await readerOn(p) === null, 'Cancel');
    assert.deepEqual(p.errors, []);
    await p.close();
  });

  await check('reading edit timing lost and busy edit_open: Edit could not start and says why, nothing opens, and the next Edit opens with the same holder', async () => {
    const topic = 'edit-lost-open-laptop', ids = await edited(topic);
    const p = await open(topic, 'laptop', topic, ids.mine, EDIT_FAULTS);
    await p.evaluate(`window.faultOf['message.edit_open'] = 'busy'`);
    await menuOf(p, 'laptop', ids.mine); await choose(p, 'laptop', 'Edit');
    await until(async () => await notice(p) === 'Edit could not start: Theseus was busy', 'busy: it says so');
    assert.equal(await p.evaluate(`document.querySelector('#reader').dataset.editing ?? null`), null, 'busy: nothing opens');
    assert.deepEqual(await agentItem(topic, ids.mine), { withheld: false, body: 'My own words, as I sent them.' }, 'busy: Core took nothing');
    await closeReader(p, 'laptop');
    // Core takes it and the answer is lost: the message is held, though nothing opened here, until the next Edit's own.
    await p.evaluate(`window.faultOf['message.edit_open'] = 'drop'`);
    await menuOf(p, 'laptop', ids.mine); await choose(p, 'laptop', 'Edit');
    await until(async () => await notice(p) === 'Edit could not start: Theseus did not answer', 'no answer: it says so');
    assert.equal(await p.evaluate(`document.querySelector('#reader').dataset.editing ?? null`), null, 'no answer: nothing opens');
    assert.deepEqual(await agentItem(topic, ids.mine), { withheld: true, body: '' }, 'Core opened it');
    await closeReader(p, 'laptop');
    await menuOf(p, 'laptop', ids.mine); await choose(p, 'laptop', 'Edit');
    await editing(p, 'laptop', 'My own words, as I sent them.');
    const opens = (await sessionOf(p)).filter(([kind]) => kind === 'edit_open');
    assert.equal(opens.length, 3); assert.equal(new Set(opens.map(([, , h]) => h)).size, 1, 'every edit_open names the one holder the device keeps');
    await p.point(button('cancel'));
    await until(async () => await readerOn(p) === null, 'Cancel');
    assert.deepEqual(await agentItem(topic, ids.mine), { withheld: false, body: 'My own words, as I sent them.' }, 'its close lets the agent read again');
    assert.deepEqual(p.errors, []);
    await p.close();
  });

  await check('reading edit timing the Reader closed while edit_open is out: nothing opens, and once Core answers, the session it opened is closed again, once', async () => {
    const topic = 'edit-moved-on-laptop', ids = await edited(topic);
    const p = await open(topic, 'laptop', topic, ids.mine, EDIT_FAULTS);
    await p.evaluate(`window.faultOf['message.edit_open'] = 'hold'`);
    await menuOf(p, 'laptop', ids.mine); await choose(p, 'laptop', 'Edit');
    await until(() => p.evaluate(`typeof window.letOf['message.edit_open'] === 'function'`), 'edit_open is out');
    await closeReader(p, 'laptop');
    await p.evaluate(`window.letOf['message.edit_open']()`);
    // window.session lists the close as it leaves; the device row (holding the holder since edit_open left) goes
    // only once Core answered the close, so that is what the agent's read waits on.
    await until(async () => (await kindsOf(p)).join() === 'edit_open,edit_close' && await deviceRow(p, ids.mine) === null,
      'once Core answers, its session is closed again, and with nothing unconfirmed the device row goes');
    assert.equal(await p.evaluate(`document.querySelector('#reader').open || Boolean(document.querySelector('#reader').dataset.editing)`), false, 'nothing opens');
    assert.deepEqual(await agentItem(topic, ids.mine), { withheld: false, body: 'My own words, as I sent them.' }, 'the agent reads the words');
    assert.deepEqual(p.errors, []);
    await p.close();
  });

  await check('reading edit timing the Reader closed while edit_open is out, with a Save kept on the device and its close lost: the Save stays beside the close, and the next Edit sends the close, then that Save, once', async () => {
    const topic = 'edit-moved-on-kept-save-laptop', ids = await edited(topic);
    const p = await open(topic, 'laptop', topic, ids.mine, EDIT_FAULTS);
    // A Save journaled on this device whose request never reached Core.
    const operation = `${topic}-kept-save`;
    const save = await putRow(p, ids.mine, { v: 1, base: { revision: 1, body: 'My own words, as I sent them.' }, value: 'Saved after all.', conflict: null,
      holder: 'h-earlier', session_revision: null, kept: null,
      pending: { v: 1, instance_id: '', operation_id: operation, kind: 'message.edit', target: { message_id: ids.mine },
        expected: { authority: {}, message_revision: 1 }, args: { body: 'Saved after all.', holder: 'h-earlier' } } });
    await p.evaluate(`window.faultOf['message.edit_open'] = 'hold'`);
    await menuOf(p, 'laptop', ids.mine); await choose(p, 'laptop', 'Edit');
    await until(() => p.evaluate(`typeof window.letOf['message.edit_open'] === 'function'`), 'edit_open is out');
    await closeReader(p, 'laptop');
    await p.evaluate(`window.faultOf['message.edit_close'] = 'hold'`);
    await p.evaluate(`window.letOf['message.edit_open']()`);
    await until(() => p.evaluate(`typeof window.letOf['message.edit_close'] === 'function'`), 'the abandoned session\'s close leaves');
    await p.evaluate(`window.letOf['message.edit_close'](true)`);
    const [, closing] = (await sessionOf(p)).at(-1);
    await until(async () => (await deviceRow(p, ids.mine))?.closing === closing, 'the lost close is kept on the device');
    const row = await deviceRow(p, ids.mine);
    assert.deepEqual(row.pending, save, 'and the kept Save stays beside it');
    assert.equal(row.value, 'Saved after all.');
    // The next Edit: the kept close under its operation, edit_open, the kept Save under its own, then one close.
    const sent = (await sessionOf(p)).length;
    await menuOf(p, 'laptop', ids.mine); await choose(p, 'laptop', 'Edit');
    await until(async () => (await kindsOf(p)).slice(sent).join() === 'edit_close,edit_open,edit,edit_close' && await readerOn(p) === null,
      'the kept close goes, then edit_open, the kept Save and one close, and the edit ends');
    const after = (await sessionOf(p)).slice(sent);
    assert.deepEqual([after[0][1], after[2][1]], [closing, operation], 'the close and the Save each under their own operation');
    assert.deepEqual(await coreItem(topic, ids.mine), { revision: 2, body: 'Saved after all.', edited: true }, 'the Save reached Core');
    assert.deepEqual(await agentItem(topic, ids.mine), { withheld: false, body: 'Saved after all.' });
    assert.equal(await deviceRow(p, ids.mine), null);
    assert.deepEqual(p.errors, []);
    await p.close();
  });

  await check('reading edit timing slow and lost draft saves: a Save waits for the draft save out and goes once it returns; a lost one goes again under its operation, then the words typed since', async () => {
    const topic = 'edit-slow-draft-laptop', ids = await edited(topic);
    const p = await open(topic, 'laptop', topic, ids.mine, EDIT_FAULTS);
    await menuOf(p, 'laptop', ids.mine); await choose(p, 'laptop', 'Edit');
    await editing(p, 'laptop', 'My own words, as I sent them.');
    // Lost: the next draft save goes again, the same, then one of the words typed since.
    await p.evaluate(`window.faultOf['message.edit_draft'] = 'drop'`);
    await replaceWords(p, 'A first draft.');
    await until(async () => (await kindsOf(p)).includes('edit_draft'), 'a draft save goes, and its answer is lost');
    const [, lost] = (await sessionOf(p)).find(([kind]) => kind === 'edit_draft');
    assert.equal(await status(p), 'Kept on this device', 'not confirmed');
    await p.send('Input.insertText', { text: ' More.' });
    await until(async () => await status(p) === 'Kept', 'the words typed since are confirmed');
    const drafts = (await sessionOf(p)).filter(([kind]) => kind === 'edit_draft').map(([, op]) => op);
    assert.equal(drafts[1], lost, 'the lost one went again under its operation');
    assert.ok(drafts.length >= 3 && !drafts.slice(2).includes(lost), 'then the words typed since, as a new operation');
    // Slow: Save waits only for the draft save out.
    await p.evaluate(`window.faultOf['message.edit_draft'] = 'hold'`);
    await replaceWords(p, 'Saved behind a slow draft.');
    await until(() => p.evaluate(`typeof window.letOf['message.edit_draft'] === 'function'`), 'a draft save is out');
    await p.key('Enter', 4);
    await until(async () => await state(p) === 'saving', 'Save waits');
    assert.equal((await kindsOf(p)).includes('edit'), false, 'the Save has not left while the draft save is out');
    await p.evaluate(`window.letOf['message.edit_draft'](true)`);
    await until(async () => await readerOn(p) === null, 'once it returns, with no answer, the Save goes and commits');
    assert.equal((await kindsOf(p)).at(-1), 'edit', 'the holder\'s Save closes the session: no close after it');
    assert.deepEqual(await coreItem(topic, ids.mine), { revision: 2, body: 'Saved behind a slow draft.', edited: true });
    assert.deepEqual(await agentItem(topic, ids.mine), { withheld: false, body: 'Saved behind a slow draft.' });
    assert.deepEqual(p.errors, []);
    await p.close();
  });

  await check('reading edit timing renewal on a clock the check sets: a key in the field 30 s after Core last renewed sends one draft save, and one sooner sends none', async () => {
    const topic = 'edit-renewal-laptop', ids = await edited(topic);
    const p = await open(topic, 'laptop', topic, ids.mine, EDIT_FAULTS);
    // The page's clock stands still from before Edit: Core's answer to edit_open is the last renewal, at 0 s.
    const at = await p.evaluate('window.clock = Date.now()');
    await menuOf(p, 'laptop', ids.mine); await choose(p, 'laptop', 'Edit');
    await editing(p, 'laptop', 'My own words, as I sent them.');
    await p.evaluate(`window.clock = ${at} + 29999`);
    await p.key('ArrowLeft');
    await p.evaluate(`window.clock = ${at} + 30000`);
    await p.key('ArrowLeft');
    await until(async () => (await kindsOf(p)).includes('edit_draft'), 'the key at 30 s renews the hold');
    assert.deepEqual(await kindsOf(p), ['edit_open', 'edit_draft'], 'one renewal: the key at 29.999 s sent none');
    assert.equal((await sessionOf(p))[1][2], (await sessionOf(p))[0][2]);
    await until(async () => await status(p) === '', 'the words are as sent, so nothing to say');
    await p.key('ArrowLeft');
    await p.point(button('cancel'));
    await until(async () => await readerOn(p) === null, 'Cancel');
    assert.deepEqual(await kindsOf(p), ['edit_open', 'edit_draft', 'edit_close'], 'a key just after a renewal sends none');
    assert.deepEqual(p.errors, []);
    await p.close();
  });

  // One build per document (item 523, docs/rails.md): a page opened on one build, the server then serving another
  // (a deploy), and a move in place (in-place-navigation.mjs), then Edit on the person's own message.
  // A topic's row in the outline, and a move to it as the person makes one: a press, or on a phone a tap in the drawer.
  const outlineRow = id => `#outline a[data-topic-id="${id}"]`;
  const railOpen = p => p.evaluate(`document.querySelector('#rail').classList.contains('open')`);
  // What the page was doing, kept in a failure of a move: where it is, the shell's state, every press and click it heard
  // since the move began (with where ☰ was then) and, in Chrome, each shift of its layout, with what moved.
  const moveState = p => p.evaluate(`import('/in-place-navigation.mjs').then(({ shell }) => ({ at: location.search, ready: document.body?.dataset.ready,
    drawer: document.querySelector('#rail')?.classList.contains('open'), expanded: document.querySelector('#rail-open')?.getAttribute('aria-expanded'),
    inert: document.querySelector('#main')?.inert, sheet: document.querySelector('#new-message-sheet')?.open, focus: document.activeElement?.id || document.activeElement?.tagName,
    notices: [...document.querySelectorAll('.notice:not([hidden])')].map(n => n.id + ': ' + n.textContent), presses: window.movePresses, shifts: window.moveShifts, restartNotices: window.restartNotices,
    shell: { moving: shell.moving, page: Boolean(shell.page), handles: Boolean(shell.handles), owed: Boolean(shell.owed), leaving: shell.leaving, build: shell.build } }))`)
    .catch(e => ({ unread: e.message }));
  const explained = (p, error) => moveState(p).then(state => { throw Object.assign(error, { message: error.message + ' ' + JSON.stringify(state) }); });
  const moveTo = async (p, device, id) => {
    // The rails' reads settled first: what they bring (the outline's rows, the line under ☰ of what is new elsewhere) moves them.
    await until(() => p.evaluate(`!document.documentElement.hasAttribute('data-rails-reading')`).catch(() => false), `${device}: the rails are quiet`);
    await p.evaluate(`(window.movePresses = [], window.moveShifts = [], ['pointerdown', 'pointerup', 'click'].forEach(type => addEventListener(type, e => window.movePresses.push(type + ':'
      + (e.target.id || e.target.getAttribute?.('data-topic-id') || e.target.className || e.target.tagName) + ':' + e.defaultPrevented + '@' + Math.round(e.clientX) + ',' + Math.round(e.clientY)
      + ' ☰' + Math.round(document.querySelector('#rail-open')?.getBoundingClientRect().top) + ' scroll' + Math.round(scrollY)), true)),
      (() => { try { new PerformanceObserver(list => { for (const shift of list.getEntries()) window.moveShifts.push((shift.sources ?? []).map(s => (s.node?.id || s.node?.className || s.node?.nodeName) + ' ' + Math.round(s.previousRect.top) + '→' + Math.round(s.currentRect.top)).join(', ')); })
        .observe({ type: 'layout-shift' }); } catch {} })(), true)`);
    // ☰ Outcomes is at the top of the page, which the person scrolls back to first.
    if (device === 'phone' && !await railOpen(p)) {
      await centre(p, '#rail-open');
      await press(p, device, '#rail-open');
      await until(() => railOpen(p), 'phone: the drawer opens').catch(error => explained(p, error));
    }
    await until(() => p.evaluate(`Boolean(document.querySelector(${JSON.stringify(outlineRow(id))}))`), `the outline names ${id}`);
    await centre(p, outlineRow(id));
    await press(p, device, outlineRow(id));
  };
  // The page shows the topic, started: by a move in place or by a load.
  // A document being replaced answers nothing, and has not arrived.
  const arrived = (p, id, first) => until(() => p.evaluate(`location.search === ${JSON.stringify('?topic=' + id)} && document.body?.dataset.ready === 'true'
    && Boolean(document.querySelector(${JSON.stringify(card(first))}))`).catch(() => false), `the page shows ${id}`, 15000).catch(error => explained(p, error));
  // The document this page was is gone: a load replaced it.
  const replaced = (p, what) => until(() => p.evaluate('window.sameDocument !== true').catch(() => false), what, 15000);
  // The build the page's modules came from (aim_next/web_build.py), and the one the server serves: null for none.
  const pageBuild = p => p.evaluate(`(s => { const [, b, build] = s ? new URL(s.src).pathname.split('/') : []; return b === 'b' && build ? build : null; })(document.querySelector('script[type=module][src]'))`);
  const servedBuild = async () => { const r = await fetch(facts.origin + '/api/build'); return r.ok ? (await r.json()).build : null; };
  // What the page says of a move: the notice where a refused move says why, and the New message sheet's or the Reader's.
  const moveNotice = p => p.evaluate(`['topic-navigation-status', 'inline-notice', 'reader-notice'].map(id => document.getElementById(id)).filter(n => n && !n.hidden).map(n => n.textContent).join(' | ')`);
  // The stack of each error the Reader says, and what the page's MessageEditWriting is, read from the page's own modules.
  const watchNotices = p => p.evaluate(`import('/reader.mjs').then(({ Reader }) => { window.noticed = []; const said = Reader.prototype.notice;
    Reader.prototype.notice = function (what) { if (what instanceof Error) window.noticed.push(String(what.stack || what.message)); return said.call(this, what); }; return true; })`);
  const editEvidence = p => p.evaluate(`import('/message-edit-writing.mjs').then(m => ({ notice: document.querySelector('#reader-notice').hidden ? '' : document.querySelector('#reader-notice').textContent,
    stacks: window.noticed ?? [], constructor: m.MessageEditWriting.name, start: typeof m.MessageEditWriting.prototype.start,
    methods: Object.getOwnPropertyNames(m.MessageEditWriting.prototype).join(' ') }))`);
  // Files served to the page in place of the server's, as a page opened on them holds them; stop() lets the server serve again.
  const keyOf = url => { const { pathname } = new URL(url); return pathname === '/' ? '/index.html' : pathname; };
  const typeOf = key => /\.m?js$/.test(key) ? 'text/javascript; charset=utf-8' : key.endsWith('.css') ? 'text/css; charset=utf-8' : 'text/html; charset=utf-8';
  const bodyOf = (files, key) => key === '/index.html' ? Buffer.from(files.get(key).toString().replace('__AIM_SESSION_TOKEN__', facts.token)) : files.get(key);
  const serveFiles = async (q, files) => {
    const ours = url => { const u = new URL(url); return u.origin === facts.origin && !u.pathname.startsWith('/api/') && files.has(keyOf(url)); };
    if (engine === 'webkit') {
      const fulfil = route => route.fulfill({ status: 200, contentType: typeOf(keyOf(route.request().url())), body: bodyOf(files, keyOf(route.request().url())) });
      const matches = url => ours(url.href);
      await q.pw.route(matches, fulfil);
      return () => q.pw.unroute(matches, fulfil);
    }
    await q.send('Fetch.enable', { patterns: [{ urlPattern: facts.origin + '/*', requestStage: 'Response' }] });
    q.intercept(async (payload, event) => {
      if (!ours(event.request.url)) return false;
      const key = keyOf(event.request.url);
      await q.send('Fetch.fulfillRequest', { requestId: event.requestId, responseCode: 200, responseHeaders: [{ name: 'Content-Type', value: typeOf(key) }], body: bodyOf(files, key).toString('base64') });
      return true;
    });
    return async () => { q.intercept(null); await q.send('Fetch.enable', { patterns: [{ urlPattern: facts.origin + '/api/*', requestStage: 'Response' }] }); };
  };
  let release76 = null;
  const filesOf = revision => new Map(execFileSync('git', ['ls-tree', '-r', '--name-only', revision, 'web'], { cwd: ROOT, encoding: 'utf8' }).trim().split('\n')
    .map(file => ['/' + file.slice('web/'.length), execFileSync('git', ['show', `${revision}:${file}`], { cwd: ROOT })]));
  // A deploy: the server stops and starts again on web (another build's files), or on the checkout's own.
  // p, a page open meanwhile: it hears the server go, and reaches it again before the person acts: its live feed up, and
  // every line it showed while Theseus was away (its words of not reaching Theseus, its saves and updates waiting) gone.
  // On a phone those lines sit above ☰ (aim.css, the folded rail), so one going after the person aims moves ☰ from under
  // the finger. window.restartNotices lists each line that showed meanwhile, for a failure.
  const contactOf = p => p.evaluate(`import('/api.mjs').then(({ contact }) => ({ live: contact.live, unreached: Boolean(document.querySelector('[data-unreached]')),
    notices: [...document.querySelectorAll('.notice:not([hidden])')].filter(n => n.getClientRects().length).map(n => n.id + ': ' + n.textContent), seen: window.restartNotices }))`).catch(() => null);
  const watchRestart = p => p.evaluate(`(() => { window.restartNotices = []; const seen = () => { for (const n of document.querySelectorAll('.notice:not([hidden])')) {
    const line = n.id + ': ' + n.textContent; if (n.getClientRects().length && !window.restartNotices.includes(line)) window.restartNotices.push(line); } };
    new MutationObserver(seen).observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['hidden'] }); return true; })()`);
  const restartOn = async (web = null, p = null) => {
    if (p) await watchRestart(p);
    await control({ method: 'server_stop' });
    if (p) await until(async () => (await contactOf(p))?.live === false, 'the page hears the server go');
    const restarted = await control({ method: 'server_start', ...(web ? { web } : {}) });
    assert.equal(restarted.origin, facts.origin, 'the server is back at the same address');
    facts.token = restarted.token;
    if (p) {
      let last = null;
      await until(async () => { last = await contactOf(p); return last?.live === true && !last.unreached && last.notices.length === 0; }, 'the page reaches the server again', 15000)
        .catch(error => { throw Object.assign(error, { message: error.message + ' ' + JSON.stringify(last) }); });
    }
  };
  // Another build of the page: the checkout's files with one module changed.
  const anotherBuild = () => {
    const dir = path.join(mkdtempSync(path.join(os.tmpdir(), 'theseus-build-')), 'web');
    cpSync(path.join(ROOT, 'web'), dir, { recursive: true });
    appendFileSync(path.join(dir, 'lines.mjs'), '\n// Another build of the page (message_edit_native.mjs).\n');
    return dir;
  };
  const twoTopics = async (name) => {
    const ids = await edited(name);
    const there = await seed(name + '-away', [['note', { sender: 'aim-core', join: true, addressees: [facts.actor], body: 'Another topic, open first.' }]]);
    return { topic: name, away: name + '-away', ids, there };
  };
  // Each run of app.mjs the page asks the server for from here on (a move in place imports app.mjs?place=N), by its
  // address: what the browser sent, so a run the server then refuses is listed too.
  const runsAsked = p => {
    const run = url => /\/app\.mjs\?place=/.test(url);
    if (engine === 'webkit') { const asked = []; p.pw.on('request', request => { if (run(request.url())) asked.push(new URL(request.url()).pathname); }); return () => asked; }
    const from = p.network.length;
    return () => p.network.slice(from).filter(e => e.method === 'Network.requestWillBeSent' && run(e.params.request.url)).map(e => new URL(e.params.request.url).pathname);
  };
  const PHONES = [320, 375, 390];
  const sized = async (p, device, width) => { if (device === 'phone' && width !== 390) await p.send('Emulation.setDeviceMetricsOverride', { width, height: 844, deviceScaleFactor: 1, mobile: true }); };

  await check('reading edit build a page opened on release 76, moved in place once the server serves this build, opens Edit on the person\'s message with no error', async () => {
    const { topic, away, ids, there } = await twoTopics('edit-build-76');
    release76 ??= filesOf(RELEASE_76);
    let stop = null;
    const p = await open('edit-build-76', 'laptop', away, there.note, EDIT_FAULTS, undefined, async q => { stop = await serveFiles(q, release76); });
    assert.equal(await pageBuild(p), null, 'the page runs release 76, whose modules name no build');
    // From here the server serves this build, as when release 77 went live under the open tab.
    await stop();
    await p.evaluate('(window.sameDocument = true)');
    await moveTo(p, 'laptop', topic);
    await arrived(p, topic, ids.mine);
    const moved = { sameDocument: await p.evaluate('window.sameDocument === true'), build: await pageBuild(p), served: await servedBuild() };
    await watchNotices(p);
    await menuOf(p, 'laptop', ids.mine); await choose(p, 'laptop', 'Edit');
    await until(() => p.evaluate(`document.querySelector('#reader').dataset.editing === 'true' || !document.querySelector('#reader-notice').hidden`), 'Edit opens, or the Reader says why not');
    const seen = await editEvidence(p);
    assert.equal(seen.notice, '', 'Edit opens with no notice: ' + JSON.stringify({ moved, ...seen }));
    await editing(p, 'laptop', 'My own words, as I sent them.');
    assert.ok(moved.served, 'the server names the build it serves');
    assert.deepEqual(moved, { sameDocument: false, build: moved.served, served: moved.served }, 'the move loaded the place afresh, on the build the server serves');
    await p.point(button('cancel')); await until(async () => await readerOn(p) === null, 'Cancel');
    assert.deepEqual(p.errors, []);
    await p.close();
  });

  await check('reading edit build a move on one build stays in place and says nothing; once the server starts on another build the next move loads the place afresh on it, the writing kept, and Edit opens: at 320, 375 and 390 by touch and on a laptop', async () => {
    const next = anotherBuild();
    let onNext = false;
    try {
      for (const [device, width] of [...PHONES.map(w => ['phone', w]), ['laptop', 1280]]) {
        const { topic, away, ids, there } = await twoTopics(`edit-build-next-${width}`);
        const p = await open(`edit-build-next-${width}`, device, away, there.note, EDIT_FAULTS);
        await sized(p, device, width);
        const first = await pageBuild(p);
        await p.evaluate('(window.sameDocument = true)');
        const inPlace = runsAsked(p);
        await moveTo(p, device, topic);
        await arrived(p, topic, ids.mine);
        assert.equal(await p.evaluate('window.sameDocument === true'), true, `${width}: on one build the move is made in place, with no load`);
        assert.deepEqual(inPlace(), [`/b/${first}/app.mjs`], `${width}: by one run of app.mjs, under the page's own build`);
        assert.equal(await moveNotice(p), '', `${width}: and nothing is said`);
        // Writing in the composer, saved, before the deploy.
        const words = `Written before the deploy (${width}).`;
        await into(p, device, '#inline-writing-body'); await p.send('Input.insertText', { text: words });
        await until(() => p.evaluate(`document.querySelector('#inline-save-state').textContent.startsWith('Saved to Theseus')`), `${width}: the writing is saved`, 15000);
        if (await p.evaluate(`document.querySelector('#new-message-sheet').open`)) await press(p, device, '#new-message-close');
        await p.evaluate('document.activeElement?.blur()');
        // Each width's page opened on the build the server served; the deploy is to the other one.
        onNext = !onNext; await restartOn(onNext ? next : null, p);
        const across = runsAsked(p);
        await moveTo(p, device, away);
        await arrived(p, away, there.note);
        const served = await servedBuild();
        assert.deepEqual(across(), [], `${width}: the move read the build and loaded, asking the server for no run of the page's old build`);
        assert.equal(await p.evaluate('window.sameDocument === true'), false, `${width}: across builds the move loads the place afresh, never running another build's code in this document`);
        assert.ok(served && first && served !== first, `${width}: the server serves another build than the page first had`);
        assert.equal(await pageBuild(p), served, `${width}: the page loaded runs the server's build`);
        assert.equal(await moveNotice(p), '', `${width}: with nothing said`);
        // On the new build a move is in place again, and the writing is there.
        await p.evaluate('(window.sameDocument = true)');
        await moveTo(p, device, topic);
        await arrived(p, topic, ids.mine);
        assert.equal(await p.evaluate('window.sameDocument === true'), true, `${width}: on the new build the move is in place`);
        await until(async () => await valueOf(p, '#inline-writing-body') === words, `${width}: the writing is kept, as the page restores it`);
        await watchNotices(p);
        await menuOf(p, device, ids.mine); await choose(p, device, 'Edit');
        await until(() => p.evaluate(`document.querySelector('#reader').dataset.editing === 'true' || !document.querySelector('#reader-notice').hidden`), `${width}: Edit opens, or the Reader says why not`);
        assert.equal((await editEvidence(p)).notice, '', `${width}: Edit opens with no notice`);
        await editing(p, device, 'My own words, as I sent them.');
        await press(p, device, button('cancel')); await until(async () => await readerOn(p) === null, 'Cancel');
        await shot(p, `edit-build-next-${width}`);
        assert.deepEqual(p.errors, []);
        await p.close();
      }
    } finally {
      await restartOn(null);
      rmSync(path.dirname(next), { recursive: true, force: true });
    }
  });

  // The move's read of the build the server serves, held unanswered, as a slow connection holds it; release() answers it.
  const holdBuildRead = async p => {
    if (engine === 'webkit') {
      const routes = [];
      await p.pw.route(facts.origin + '/api/build', route => { routes.push(route); });
      return { out: () => until(() => routes.length > 0, 'the move reads the build').catch(error => explained(p, error)), release: async () => { for (const route of routes.splice(0)) await route.continue(); await p.pw.unroute(facts.origin + '/api/build'); } };
    }
    const isBuild = event => event.request.url === facts.origin + '/api/build';
    p.intercept((payload, event) => isBuild(event));
    return { out: () => until(() => p.held.some(h => isBuild(h.event)), 'the move reads the build').catch(error => explained(p, error)),
      // Each read let go leaves the list, so a later hold on the same page waits for a read of its own.
      release: async () => { p.intercept(null); for (const h of p.held.filter(h => isBuild(h.event))) { p.held.splice(p.held.indexOf(h), 1); await p.send('Fetch.continueResponse', { requestId: h.event.requestId }); } } };
  };
  // The page's device copy of writing held unwritten (journal.mjs) while window.holdJournal is true, so the writing is not yet safe.
  const holdJournal = p => p.evaluate(`import('/journal.mjs').then(({ RecoveryJournal }) => { window.journalHeld = [];
    for (const name of ['save', 'saveLatest']) { const write = RecoveryJournal.prototype[name];
      RecoveryJournal.prototype[name] = function (...args) { if (!window.holdJournal) return write.apply(this, args);
        return new Promise(go => window.journalHeld.push(go)).then(() => write.apply(this, args)); }; } return true; })`);
  const letJournal = p => p.evaluate('(() => { window.holdJournal = false; for (const go of window.journalHeld.splice(0)) go(); return true; })()');
  const scheme = (p, value) => p.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value }] });

  await check('reading edit build a move that finds another build while writing here is not yet safe stays, says Theseus updated with Reload, keeps the words, and Reload loads the new build with them: at 320, 375 and 390 by touch and on a laptop, light and dark', async () => {
    const next = anotherBuild();
    let onNext = false;
    try {
      for (const [device, width] of [...PHONES.map(w => ['phone', w]), ['laptop', 1280]]) {
        const { topic, away, ids, there } = await twoTopics(`edit-build-held-${width}`);
        const p = await open(`edit-build-held-${width}`, device, away, there.note, EDIT_FAULTS);
        await sized(p, device, width);
        await holdJournal(p);
        onNext = !onNext; await restartOn(onNext ? next : null, p);
        await p.evaluate('(window.sameDocument = true)');
        const read = await holdBuildRead(p);
        await moveTo(p, device, topic);
        await read.out();
        // While the move waits on the answer, the person writes, and the device has not kept the words yet.
        const words = `Written as Theseus updated (${width}).`;
        await p.evaluate('window.holdJournal = true');
        await into(p, device, '#inline-writing-body'); await p.send('Input.insertText', { text: words });
        await until(() => p.evaluate('window.journalHeld.length > 0'), `${width}: the device copy is out`);
        await read.release();
        await until(async () => (await moveNotice(p)).startsWith('Theseus updated.'), `${width}: the page says Theseus updated`);
        assert.equal(await p.evaluate(`location.search`), '?topic=' + away, `${width}: the page stays where it was`);
        assert.equal(await p.evaluate('window.sameDocument === true'), true, `${width}: and nothing loaded`);
        assert.equal(await valueOf(p, '#inline-writing-body'), words, `${width}: the words are in their box`);
        const reload = await p.evaluate(`[...document.querySelectorAll('.updated-reload')].filter(b => b.getClientRects().length).map(b => { const r = b.getBoundingClientRect();
          return { text: b.textContent, title: b.title, width: r.width, height: r.height, inside: r.left >= 0 && r.right <= innerWidth && r.top >= 0 && r.bottom <= innerHeight }; })`);
        assert.ok(reload.length >= 1, `${width}: Reload shows: ` + JSON.stringify(reload));
        for (const button of reload) {
          assert.deepEqual([button.text, button.title, button.inside], ['Reload', 'Reload Theseus', true], `${width}: Reload says so, with a tooltip, in the window`);
          if (device === 'phone') assert.ok(button.width >= 44 && button.height >= 44, `${width}: Reload is a finger's size: ${JSON.stringify(button)}`);
        }
        // On a phone the rail is folded and its notices stand above the topic, inset from the screen's top and sides.
        if (device === 'phone') {
          const box = await p.evaluate(`(() => { const r = document.getElementById('topic-navigation-status').getBoundingClientRect();
            return { folded: !document.querySelector('.rail').classList.contains('open'), left: r.left, right: innerWidth - r.right, top: r.top + scrollY }; })()`);
          assert.ok(box.folded && box.left >= 12 && box.right >= 12 && box.top >= 8, `${width}: the notice sits inset from the screen's top and sides, the rail folded: ` + JSON.stringify(box));
        }
        assert.equal(await p.evaluate('document.documentElement.scrollWidth <= innerWidth'), true, `${width}: nothing scrolls sideways`);
        for (const look of ['light', 'dark']) { await scheme(p, look); await shot(p, `edit-build-updated-${width}-${look}`); }
        await scheme(p, '');
        // The words kept on the device, Reload loads the place on the new build, and the words come with it.
        await letJournal(p);
        // The words safe (no guard of the page's holds), as the page says it: then Reload loads with no ask.
        await until(() => p.evaluate(`import('/in-place-navigation.mjs').then(({ shell }) => !shell.guards.some(holds => holds()))`), `${width}: the device keeps the words`);
        await until(() => p.evaluate(`document.querySelector('#inline-save-state').textContent === 'Saved to Theseus'`), `${width}: the page says the words are saved to Theseus`);
        const where = await p.evaluate(`['topic-navigation-status', 'inline-notice'].find(id => document.querySelector('#' + id + ' .updated-reload')?.getClientRects().length)`);
        await press(p, device, `#${where} .updated-reload`);
        await replaced(p, `${width}: Reload loads the page`);
        await arrived(p, away, there.note);
        assert.equal(await p.evaluate('window.sameDocument === true'), false, `${width}: Reload loaded the page`);
        assert.equal(await pageBuild(p), await servedBuild(), `${width}: on the server's build`);
        await until(async () => await valueOf(p, '#inline-writing-body') === words, `${width}: with the words, as the page restores them`).catch(async error => {
          const state = await p.evaluate(`({ value: document.querySelector('#inline-writing-body').value, saved: document.querySelector('#inline-save-state').textContent,
            notice: [...document.querySelectorAll('.notice:not([hidden])')].map(n => n.id + ': ' + n.textContent), build: document.querySelector('script[type=module][src]')?.src })`).catch(e => ({ unread: e.message }));
          throw Object.assign(error, { message: error.message + ' ' + JSON.stringify(state) });
        });
        assert.equal(await moveNotice(p), '', `${width}: and nothing more to say`);
        assert.deepEqual(p.errors, []);
        await p.close();
        void ids;
      }
    } finally {
      await restartOn(null);
      rmSync(path.dirname(next), { recursive: true, force: true });
    }
  });

  // Theseus updated said where the person writes (app.mjs updatedNotice): in the open Reader, and in the New message
  // sheet, beside the topic line; reached by a back, whose address is put back (in-place-navigation.mjs, updated).
  await check('reading edit build a back that finds another build while writing in the open Reader or New message sheet is not yet safe stays, puts the address back, and says Theseus updated there with Reload: at 320, 375 and 390 by touch and on a laptop, light and dark', async () => {
    const next = anotherBuild();
    let onNext = false;
    try {
      for (const surface of ['reader', 'sheet']) {
        for (const [device, width] of [...PHONES.map(w => ['phone', w]), ['laptop', 1280]]) {
          const name = `edit-build-back-${surface}-${width}`;
          const { topic, away, ids, there } = await twoTopics(name);
          const p = await open(name, device, away, there.note, EDIT_FAULTS);
          await sized(p, device, width);
          // A move in place on one build, so a back is the page's own.
          await p.evaluate('(window.sameDocument = true)');
          await moveTo(p, device, topic);
          await arrived(p, topic, ids.mine);
          await holdJournal(p);
          onNext = !onNext; await restartOn(onNext ? next : null, p);
          const field = surface === 'reader' ? '#writing-body' : '#inline-writing-body', notice = surface === 'reader' ? '#reader-notice' : '#inline-notice';
          if (surface === 'reader') await openReader(p, device, ids.theirs, 'An agent says');
          else { await press(p, device, '#new-message'); await until(() => p.evaluate(`document.querySelector('#new-message-sheet').open`), `${width}: New message opens`); }
          const read = await holdBuildRead(p);
          await p.evaluate('history.back()');
          await read.out();
          // While the back waits on the answer, the person writes, and the device has not kept the words yet.
          const words = `Written in the ${surface} as Theseus updated (${width}).`;
          await p.evaluate('window.holdJournal = true');
          await into(p, device, field); await p.send('Input.insertText', { text: words });
          await until(() => p.evaluate('window.journalHeld.length > 0'), `${width}: the device copy is out`);
          await read.release();
          const says = selector => p.evaluate(`(n => n && !n.hidden && n.getClientRects().length > 0 ? n.textContent : '')(document.querySelector(${JSON.stringify(selector)}))`);
          await until(async () => (await says(notice)).startsWith('Theseus updated.'), `${width}: the ${surface} says Theseus updated`);
          assert.ok((await p.evaluate(`document.querySelector('#topic-navigation-status').textContent`)).startsWith('Theseus updated.'), `${width}: and so does the topic line`);
          await until(() => p.evaluate(`location.search === ${JSON.stringify('?topic=' + topic)}`), `${width}: the back is put back: the address names the page that stayed`);
          assert.equal(await p.evaluate('window.sameDocument === true'), true, `${width}: nothing loaded`);
          assert.equal(await p.evaluate(surface === 'reader' ? `document.querySelector('#reader').open` : `document.querySelector('#new-message-sheet').open`), true, `${width}: the ${surface} stays open`);
          assert.equal(await valueOf(p, field), words, `${width}: the words are in their box`);
          const reload = await p.evaluate(`(b => { if (!b || !b.getClientRects().length) return null; const r = b.getBoundingClientRect(), x = r.left + r.width / 2, y = r.top + r.height / 2;
            return { text: b.textContent, title: b.title, width: r.width, height: r.height, inside: r.left >= 0 && r.right <= innerWidth && r.top >= 0 && r.bottom <= innerHeight, hit: b.contains(document.elementFromPoint(x, y)) }; })(document.querySelector(${JSON.stringify(notice + ' .updated-reload')}))`);
          assert.ok(reload, `${width}: Reload shows in the ${surface}`);
          assert.deepEqual([reload.text, reload.title, reload.inside, reload.hit], ['Reload', 'Reload Theseus', true, true], `${width}: Reload says so, with a tooltip, in the window, uncovered: ${JSON.stringify(reload)}`);
          if (device === 'phone') assert.ok(reload.width >= 44 && reload.height >= 44, `${width}: Reload is a finger's size: ${JSON.stringify(reload)}`);
          assert.equal(await p.evaluate('document.documentElement.scrollWidth <= innerWidth'), true, `${width}: nothing scrolls sideways`);
          for (const look of ['light', 'dark']) { await scheme(p, look); await shot(p, `edit-build-back-${surface}-${width}-${look}`); }
          await scheme(p, '');
          // The words kept, Reload in the ${surface} loads the page that stayed, on the new build.
          await letJournal(p);
          await until(() => p.evaluate(`import('/in-place-navigation.mjs').then(({ shell }) => !shell.guards.some(holds => holds()))`), `${width}: the device keeps the words`);
          await press(p, device, notice + ' .updated-reload');
          await replaced(p, `${width}: Reload loads the page`);
          await arrived(p, topic, ids.mine);
          assert.equal(await pageBuild(p), await servedBuild(), `${width}: on the server's build`);
          assert.deepEqual(p.errors, []);
          await p.close();
          void away;
        }
      }
    } finally {
      await restartOn(null);
      rmSync(path.dirname(next), { recursive: true, force: true });
    }
  });

  // The page's guard hands the move its last look, which the shell asks again once the build is read
  // (in-place-navigation.mjs, decide): words typed while the read is out keep the page where it is, whether this
  // device has kept them yet or its copy of them is still being written, after a row and after a back with the cursor
  // left in the composer. The page says why, as a refused move does, and the words stay in their box.
  const keptHere = (p, what) => until(() => p.evaluate(`import('/in-place-navigation.mjs').then(({ shell }) => !shell.guards.some(holds => holds()))`), what);
  const STAYED = 'Keep this page open until your writing and selected images are safely saved, then choose the topic again.';
  const savedToTheseus = (p, what) => until(() => p.evaluate(`document.querySelector('#inline-save-state').textContent === 'Saved to Theseus'`), what, 15000);
  await check('reading edit build on one build, words typed while a move reads the build keep the page where it is, which says why, with the words in their box, kept on this device or not yet, after a row and after a back with the cursor in the composer: at 320, 375 and 390 by touch and on a laptop, light and dark', async () => {
    for (const [device, width] of [...PHONES.map(w => ['phone', w]), ['laptop', 1280]]) {
      const name = `edit-build-typed-${width}`;
      const { topic, away, ids, there } = await twoTopics(name);
      const p = await open(name, device, away, there.note, EDIT_FAULTS);
      await sized(p, device, width);
      await holdJournal(p);
      await p.evaluate('(window.sameDocument = true)');
      const first = await pageBuild(p);
      // One move held at its read of the build while the person writes on. held: the device's copy of the words is
      // still being written as the read is answered; otherwise the device has kept them first.
      const typedWhileRead = async (how, held, words, place, look) => {
        const runs = runsAsked(p), read = await holdBuildRead(p);
        if (how === 'row') await moveTo(p, device, topic);
        else { await into(p, device, '#inline-writing-body'); await p.evaluate('history.back()'); }
        await read.out();
        if (how === 'row') await into(p, device, '#inline-writing-body');
        const before = await p.evaluate(`(f => { f.setSelectionRange(f.value.length, f.value.length); return f.value; })(document.querySelector('#inline-writing-body'))`);
        if (held) await p.evaluate('window.holdJournal = true');
        await p.send('Input.insertText', { text: words });
        if (held) await until(() => p.evaluate('window.journalHeld.length > 0'), `${width} ${how}: the device's copy is still being written`);
        else await keptHere(p, `${width} ${how}: the device has kept the words`);
        await read.release();
        await until(async () => (await p.evaluate(`document.querySelector('#topic-navigation-status').textContent`)) === STAYED, `${width} ${how}: the page says why it stayed`)
          .catch(error => explained(p, error));
        await until(() => p.evaluate(`location.search === ${JSON.stringify('?topic=' + place)}`), `${width} ${how}: the address names the page that stayed`);
        assert.equal(await p.evaluate('window.sameDocument === true'), true, `${width} ${how}: nothing loaded`);
        assert.deepEqual(runs(), [], `${width} ${how}: and no run of the page was asked for`);
        assert.equal(await valueOf(p, '#inline-writing-body'), before + words, `${width} ${how}: the words are in their box`);
        // Said where the person is looking: in the New message sheet when it is open over the page, else by the topic line,
        // brought into the window (within a pixel's rounding). A back is put back by a traversal, after which the browser
        // puts back that entry's scroll, as it does for any back the page refuses: there the line's words are checked.
        const line = await p.evaluate(`(() => { const sheet = document.querySelector('#new-message-sheet').open, n = document.querySelector(sheet ? '#inline-notice' : '#topic-navigation-status');
          const r = n.getBoundingClientRect(), whole = ${JSON.stringify(how === 'row')};
          return { sheet, text: n.hidden ? '' : n.textContent, inside: !whole || r.width > 0 && r.left >= -1 && r.right <= innerWidth + 1 && r.top >= -1 && r.bottom <= innerHeight + 1,
          rect: [r.left, r.top, r.right, r.bottom].map(Math.round), window: [innerWidth, innerHeight, Math.round(scrollY)], visual: visualViewport && [visualViewport.width, visualViewport.height, visualViewport.offsetTop].map(Math.round),
          focus: document.activeElement?.id, display: getComputedStyle(n).display }; })()`);
        assert.deepEqual([line.text, line.inside], [STAYED, true], `${width} ${how}: said in the window where the person writes: ${JSON.stringify(line)}`);
        assert.equal(await p.evaluate('document.documentElement.scrollWidth <= innerWidth'), true, `${width} ${how}: nothing scrolls sideways`);
        if (look) { for (const scheme_ of ['light', 'dark']) { await scheme(p, scheme_); await shot(p, `edit-build-typed-${how}-${width}-${scheme_}`); } await scheme(p, ''); }
        if (held) await letJournal(p);
        await savedToTheseus(p, `${width} ${how}: the words are saved to Theseus`);
        return before + words;
      };
      await typedWhileRead('row', false, `Typed as the row's move read the build (${width}).`, away, false);
      const awayWords = await typedWhileRead('row', true, ` And while the device was still writing (${width}).`, away, true);
      // Chosen again with the words safe, the move is made in place, on the page's own build.
      const again = runsAsked(p);
      await moveTo(p, device, topic);
      await arrived(p, topic, ids.mine);
      assert.equal(await p.evaluate('window.sameDocument === true'), true, `${width}: chosen again, the move is made in place`);
      assert.deepEqual(again(), [`/b/${first}/app.mjs`], `${width}: by one run of app.mjs, under the page's own build`);
      await typedWhileRead('back', false, `Typed as the back read the build (${width}).`, topic, false);
      await typedWhileRead('back', true, ` And while the device was still writing (${width}).`, topic, true);
      // A back with the words safe goes, in place, and the first topic's words are in its box.
      if (await p.evaluate(`document.querySelector('#new-message-sheet').open`)) await press(p, device, '#new-message-close');
      await p.evaluate('history.back()');
      await arrived(p, away, there.note);
      assert.equal(await p.evaluate('window.sameDocument === true'), true, `${width}: the back goes in place`);
      await until(async () => await valueOf(p, '#inline-writing-body') === awayWords, `${width}: the first topic's words are in its box`);
      assert.deepEqual(p.errors, []);
      await p.close();
    }
  });

  // On another build, words typed while the move reads the build and kept on this device keep the page where it is too:
  // it says Theseus updated with Reload (the guard's last look no longer stands), rather than load the new build with
  // the words only under Review versions.
  await check('reading edit build words typed while a move reads the build and kept on this device keep the page where it is when the server serves another build, which says Theseus updated, with the words in their box: at 320, 375 and 390 by touch and on a laptop', async () => {
    const next = anotherBuild();
    let onNext = false;
    try {
      for (const [device, width] of [...PHONES.map(w => ['phone', w]), ['laptop', 1280]]) {
        const name = `edit-build-typed-next-${width}`;
        const { topic, away, there } = await twoTopics(name);
        const p = await open(name, device, away, there.note, EDIT_FAULTS);
        await sized(p, device, width);
        onNext = !onNext; await restartOn(onNext ? next : null, p);
        await p.evaluate('(window.sameDocument = true)');
        const read = await holdBuildRead(p);
        await moveTo(p, device, topic);
        await read.out();
        const words = `Typed as Theseus updated, kept on this device (${width}).`;
        await into(p, device, '#inline-writing-body'); await p.send('Input.insertText', { text: words });
        await keptHere(p, `${width}: the device has kept the words`);
        await read.release();
        await until(async () => (await moveNotice(p)).startsWith('Theseus updated.'), `${width}: the page says Theseus updated`).catch(error => explained(p, error));
        assert.equal(await p.evaluate('location.search'), '?topic=' + away, `${width}: the page stays where it was`);
        assert.equal(await p.evaluate('window.sameDocument === true'), true, `${width}: and nothing loaded`);
        assert.equal(await valueOf(p, '#inline-writing-body'), words, `${width}: the words are in their box`);
        assert.deepEqual(p.errors, []);
        await p.close();
      }
    } finally {
      await restartOn(null);
      rmSync(path.dirname(next), { recursive: true, force: true });
    }
  });

  // Saves of the topic's writing to Theseus held unsent while window.holdDrafts is true (the page's fetch, as it leaves).
  const holdDrafts = p => p.evaluate(`(() => { window.holdDrafts = true; window.draftsHeld = 0; const send = window.fetch;
    window.fetch = function (input, init) { let body = null; try { body = JSON.parse(init?.body ?? 'null'); } catch {}
      if (window.holdDrafts && body?.kind === 'draft.save') { window.draftsHeld += 1; return new Promise(() => {}); } return send.call(this, input, init); }; return true; })()`);

  // Words kept on this device only, which Theseus never had, come back after a load as the page offers them
  // (tests/reader_persistence_native.mjs, "explicit device recovery"): Review versions shows them as writing kept on
  // this device, and Recover this version puts them back in the box.
  const recovered = async (p, words) => {
    await until(() => p.evaluate(`!document.querySelector('#inline-review-versions').hidden`).catch(() => false), 'the page offers the versions kept on this device');
    await p.point('#inline-review-versions');
    const chosen = await until(() => p.evaluate(`(() => { const section = [...document.querySelectorAll('#review-content section')].find(e => e.querySelector('pre')?.textContent === ${JSON.stringify(words)}
      && [...e.querySelectorAll('button')].some(b => b.textContent === 'Recover this version')); if (!section) return null; section.id = 'chosen-device-recovery';
      return '#chosen-device-recovery button'; })()`), 'the words are among them, kept on this device');
    await p.evaluate(`[...document.querySelectorAll(${JSON.stringify(chosen)})].find(b => b.textContent === 'Recover this version').id = 'chosen-device-recover'`);
    await p.point('#chosen-device-recover');
    await until(async () => await valueOf(p, '#inline-writing-body') === words, 'Recover this version puts the words back');
  };

  await check('reading edit build Reload pressed once the words are kept on this device, before Theseus has them, loads the new build, and the words come back as on any load', async () => {
    const next = anotherBuild();
    try {
      const { topic, away, there } = await twoTopics('edit-build-device');
      const p = await open('edit-build-device', 'laptop', away, there.note, EDIT_FAULTS);
      await holdJournal(p);
      await restartOn(next, p);
      await p.evaluate('(window.sameDocument = true)');
      const read = await holdBuildRead(p);
      await moveTo(p, 'laptop', topic);
      await read.out();
      const words = 'Written as Theseus updated, kept on this device only.';
      await p.evaluate('window.holdJournal = true');
      await holdDrafts(p);
      await into(p, 'laptop', '#inline-writing-body'); await p.send('Input.insertText', { text: words });
      await until(() => p.evaluate('window.journalHeld.length > 0'), 'the device copy is out');
      await read.release();
      await until(async () => (await moveNotice(p)).startsWith('Theseus updated.'), 'the page says Theseus updated');
      await letJournal(p);
      await until(() => p.evaluate(`import('/in-place-navigation.mjs').then(({ shell }) => !shell.guards.some(holds => holds()))`), 'the device keeps the words');
      await until(() => p.evaluate(`document.querySelector('#inline-save-state').textContent.startsWith('Saved on this device')`), 'the page says the words are on this device');
      // Any Save to Theseus is held unsent (holdDrafts), so the words are on this device only as Reload is pressed.
      assert.notEqual(await p.evaluate(`document.querySelector('#inline-save-state').textContent`), 'Saved to Theseus', 'and Theseus has not had them');
      await p.point('#topic-navigation-status .updated-reload');
      await replaced(p, 'Reload loads the page');
      await arrived(p, away, there.note);
      assert.equal(await pageBuild(p), await servedBuild(), 'on the server\'s build');
      await recovered(p, words);
      assert.deepEqual(p.errors, []);
      await p.close();
    } finally {
      await restartOn(null);
      rmSync(path.dirname(next), { recursive: true, force: true });
    }
  });

  await check('reading edit build on one build, a reload with the words kept on this device only, before Theseus has them, brings them back as the page offers them', async () => {
    const { away, there } = await twoTopics('edit-build-device-same');
    const p = await open('edit-build-device-same', 'laptop', away, there.note, EDIT_FAULTS);
    const words = 'Written on one build, kept on this device only.';
    await holdDrafts(p);
    await into(p, 'laptop', '#inline-writing-body'); await p.send('Input.insertText', { text: words });
    await until(() => p.evaluate(`document.querySelector('#inline-save-state').textContent.startsWith('Saved on this device')`), 'the page says the words are on this device');
    await until(() => p.evaluate(`import('/in-place-navigation.mjs').then(({ shell }) => !shell.guards.some(holds => holds()))`), 'the device keeps the words');
    await p.evaluate('(window.sameDocument = true, location.reload(), true)');
    await replaced(p, 'the page reloads');
    await arrived(p, away, there.note);
    await recovered(p, words);
    assert.deepEqual(p.errors, []);
    await p.close();
  });

  // Edit on the person's own message as they reach it: from its bar. Once a reply heads it into a stack shown as its
  // row alone (docs/reply-stacks.md), which has no bar, the person lights the row and presses it, which shows the
  // message whole with its bar (tests/stack_native.mjs, "a head shown as one row has no bar").
  // A reply of the person's own folds their message (docs/reply-stacks.md): in a dossier its folded row stands under
  // the head's row, which stays the title (item 471), and a press on that folded row shows it whole.
  const editReached = async (p, device, id) => {
    const shown = () => p.evaluate(`document.querySelector(${JSON.stringify(words(id))})?.getClientRects().length > 0`);
    const folded = () => p.evaluate(`Boolean(document.querySelector(${JSON.stringify(card(id) + ' > .message-folded > .folded-author')})?.getClientRects().length)`);
    if (!await shown()) {
      // Lit already (the Reader closing lights the message it showed), the next press on the row shows it whole.
      if (!(await lit(p)).includes(id)) await light(p, device, id);
      if (!await shown() && !await folded()) {
        await press(p, device, `${card(id)} .stack-who`);
        await until(async () => await shown() || await folded(), `${device}: a press on the head's row shows it, whole or as its folded row`);
      }
      if (await folded()) await press(p, device, `${card(id)} > .message-folded > .folded-author`);
      await until(shown, `${device}: a press on the head's row shows it whole`);
    }
    await menuOf(p, device, id); await choose(p, device, 'Edit');
  };
  await check('reading edit build going back into Edit after posting a reply while Edit was held, twice, opens on the latest words with no notice; an agent\'s message offers no Edit, and another device holding the edit is said', async () => {
    for (const device of ['laptop', 'phone']) {
      const topic = `edit-again-${device}`;
      const ids = await seed(topic, [['theirs', { sender: 'aim-core', join: true, addressees: [facts.actor], body: 'An agent asks for a word.' }]]);
      const p = await open(topic, device, topic, ids.theirs, EDIT_FAULTS);
      await watchNotices(p);
      // The person posts a message.
      const posted = `Posted from the composer (${device}).`;
      await into(p, device, '#inline-writing-body'); await p.send('Input.insertText', { text: posted });
      if (device === 'laptop') await p.key('Enter', 4); else await press(p, device, '#inline-send');
      const mine = await until(() => p.evaluate(`[...document.querySelectorAll('#messages .message-card[data-id]')].find(c => c.querySelector('.message-preview')?.textContent === ${JSON.stringify(posted)})?.dataset.id ?? null`), `${device}: the message is posted`, 15000);
      if (await p.evaluate(`document.querySelector('#new-message-sheet').open`)) await press(p, device, '#new-message-close');
      assert.equal((await menuOf(p, device, ids.theirs)).includes('Edit'), false, `${device}: an agent's message offers no Edit`);
      await closeMenu(p);
      let latest = posted;
      for (const round of [1, 2]) {
        // Edit, kept open with new words in it.
        await editReached(p, device, mine);
        await until(() => p.evaluate(`document.querySelector('#reader').dataset.editing === 'true' || !document.querySelector('#reader-notice').hidden`), `${device} ${round}: Edit opens, or the Reader says why not`);
        assert.equal((await editEvidence(p)).notice, '', `${device} ${round}: Edit opens with no notice: ` + JSON.stringify(await editEvidence(p)));
        await editing(p, device, latest);
        latest = `Changed in round ${round} (${device}).`;
        await replaceWords(p, latest);
        await until(async () => await status(p) === 'Kept', `${device} ${round}: Core keeps the words`);
        // A reply posted while the edit is held: from the Reader beside it in round 1, from the topic's composer once the Reader is closed in round 2.
        const reply = `A reply in round ${round} (${device}).`;
        if (round === 1) {
          await into(p, device, '#writing-body'); await p.send('Input.insertText', { text: reply });
          if (device === 'laptop') await p.key('Enter', 4); else await press(p, device, '#send-reply');
          await until(() => p.evaluate(`[...document.querySelectorAll('#messages .message-card .message-preview')].some(e => e.textContent === ${JSON.stringify(reply)})`), `${device} ${round}: the reply is posted`, 15000);
          if (await readerOn(p) !== null) await closeReader(p, device);
        } else {
          await closeReader(p, device);
          await into(p, device, '#inline-writing-body'); await p.send('Input.insertText', { text: reply });
          if (device === 'laptop') await p.key('Enter', 4); else await press(p, device, '#inline-send');
          await until(() => p.evaluate(`[...document.querySelectorAll('#messages .message-card .message-preview')].some(e => e.textContent === ${JSON.stringify(reply)})`), `${device} ${round}: the reply is posted`, 15000);
          if (await p.evaluate(`document.querySelector('#new-message-sheet').open`)) await press(p, device, '#new-message-close');
        }
      }
      // Back into Edit after the second reply: the latest words, no notice.
      await editReached(p, device, mine);
      await until(() => p.evaluate(`document.querySelector('#reader').dataset.editing === 'true' || !document.querySelector('#reader-notice').hidden`), `${device}: Edit opens again, or the Reader says why not`);
      assert.equal((await editEvidence(p)).notice, '', `${device}: Edit opens with no notice: ` + JSON.stringify(await editEvidence(p)));
      await editing(p, device, latest);
      // Another device takes the edit: this page says so, and keeps its words.
      await openElsewhere(mine, `${topic}-other-open`);
      await until(async () => await status(p) === 'Open on your other device', `${device}: this page learns another device holds the edit`);
      assert.equal(await valueOf(p, FIELD), latest, `${device}: the words stay`);
      await press(p, device, button('cancel')); await until(async () => await readerOn(p) === null, 'Cancel');
      await elsewhere('message.edit_close', mine, {}, { holder: OTHER }, `${topic}-other-close`);
      assert.deepEqual(p.errors, []);
      await p.close();
    }
  });

  // A page loaded across a deploy (item 523, docs/rails.md, "One build per document"): its index.html from one server
  // and its modules asked for once the next one has started, or while none is up. The page's boot (web/boot.js) loads
  // afresh on the build the server serves, or says it could not open the page, with Reload; it never stays blank.
  // Each document this page loads counts itself (sessionStorage.loads), so a load the boot asked for is counted, and
  // counts its reads of the build (window.buildReads), answered or not: a read that got no answer leaves no resource entry in WebKit.
  const LOADS = `(()=>{try{sessionStorage.loads=String(Number(sessionStorage.loads||0)+1)}catch(e){}
    window.buildReads=0;const f=window.fetch;window.fetch=function(input,init){if(new URL(String(input instanceof Request?input.url:input),location.href).pathname==='/api/build')window.buildReads++;return f.call(this,input,init)}})()`;
  const loads = p => p.evaluate('Number(sessionStorage.loads)');
  // What the document loaded: its modules' addresses, whether it read the build, and what its status line says.
  const loaded = p => p.evaluate(`({ modules: performance.getEntriesByType('resource').map(e => new URL(e.name)).filter(u => /\\.m?js$/.test(u.pathname)).map(u => u.pathname),
    readBuild: window.buildReads > 0,
    status: document.querySelector('#app-status').hidden ? '' : document.querySelector('#app-status').textContent, ready: document.body?.dataset.ready ?? null })`).catch(() => null);
  // Every module the page asks for under a build is held unsent, as a slow connection holds it: step() sends on those
  // asked so far and holds the next, let(lose) sends on every one held, or loses it (a dropped connection), and holds no more.
  const holdModules = async p => {
    const isModule = url => { const u = new URL(url); return u.origin === facts.origin && u.pathname.startsWith('/b/'); };
    if (engine === 'webkit') {
      const routes = []; let holding = true;
      const match = url => isModule(url.href), handler = route => { if (holding) routes.push(route); else route.continue(); };
      await p.pw.route(match, handler);
      const go = (lose = false) => Promise.allSettled(routes.splice(0).map(route => lose ? route.abort('connectionrefused') : route.continue()));
      return { asked: () => routes.map(route => new URL(route.request().url()).pathname), step: () => go(),
        let: async (lose = false) => { holding = false; await go(lose); await p.pw.unroute(match, handler); } };
    }
    const mine = () => p.held.filter(h => h.event.responseStatusCode === undefined && isModule(h.event.request.url));
    const go = (lose = false) => Promise.allSettled(mine().map(h => { p.held.splice(p.held.indexOf(h), 1);
      return p.send(lose ? 'Fetch.failRequest' : 'Fetch.continueRequest', { requestId: h.event.requestId, ...(lose ? { errorReason: 'ConnectionRefused' } : {}) }); }));
    p.intercept((payload, event) => event.responseStatusCode === undefined && isModule(event.request.url));
    await p.send('Fetch.enable', { patterns: [{ urlPattern: facts.origin + '/api/*', requestStage: 'Response' }, { urlPattern: facts.origin + '/b/*', requestStage: 'Request' }] });
    return { asked: () => mine().map(h => new URL(h.event.request.url).pathname), step: () => go(), let: async (lose = false) => { p.intercept(null); await go(lose); } };
  };
  // The page loads again with every module held: its index.html comes from the server as it stands, and its entry
  // module is let through, so the entry's own imports are what wait. Gives the build index.html named and the held modules.
  const reloadHeld = async (p, what) => {
    const held = await holdModules(p);
    const reloading = p.send('Page.reload').catch(error => error);
    await until(() => held.asked().some(at => /^\/b\/[^/]+\/app\.mjs$/.test(at)), `${what}: the page asks for its entry under its build`);
    const [, , build] = held.asked().find(at => /^\/b\/[^/]+\/app\.mjs$/.test(at)).split('/');
    await held.step();
    await until(() => held.asked().length > 0, `${what}: the entry's own imports are asked for, and held`);
    return { build, held, reloading };
  };
  const comesUp = (p, topic, first, what) => until(() => p.evaluate(`location.search === ${JSON.stringify('?topic=' + topic)} && document.body?.dataset.ready === 'true'
    && Boolean(document.querySelector(${JSON.stringify(card(first))}))`).catch(() => false), what, 15000)
    .catch(async error => { throw Object.assign(error, { message: error.message + ' ' + JSON.stringify({ loads: await loads(p).catch(() => null), loaded: await loaded(p) }) }); });
  const onOneBuild = (seen, build, what) => {
    assert.ok(seen.modules.length > 10, `${what}: the page's modules are listed (${seen.modules.length})`);
    assert.deepEqual(seen.modules.filter(at => !at.startsWith(`/b/${build}/`)), [], `${what}: every module is of build ${build}, none of another`);
  };

  await check('reading edit build a page whose modules are asked for once the server has started on another build loads afresh on it, once, and comes up on that build alone: on a laptop and at 390 by touch', async () => {
    const next = anotherBuild();
    let onNext = false;
    try {
      for (const device of ['laptop', 'phone']) {
        const name = `edit-build-boot-${device}`;
        const ids = await seed(name, [['note', { sender: 'aim-core', join: true, addressees: [facts.actor], body: 'A page loaded across a deploy.' }]]);
        const p = await open(name, device, name, ids.note, LOADS);
        const before = await loads(p);
        const { build: first, held, reloading } = await reloadHeld(p, device);
        // The deploy: the next server serves another build before the first one's modules are asked for.
        onNext = !onNext; await restartOn(onNext ? next : null);
        const served = await servedBuild();
        assert.ok(served && served !== first, `${device}: the server now serves another build than the page's index.html named`);
        await held.let();
        await reloading;
        await comesUp(p, name, ids.note, `${device}: the page comes up, rather than stay blank`);
        assert.equal(await loads(p), before + 2, `${device}: by one load of its own after the reload, no more`);
        assert.equal(await pageBuild(p), served, `${device}: on the build the server serves`);
        const seen = await loaded(p);
        onOneBuild(seen, served, device);
        assert.equal(seen.status, '', `${device}: saying nothing`);
        assert.deepEqual(p.errors, []);
        await p.close();
      }
    } finally {
      await restartOn(null);
      rmSync(path.dirname(next), { recursive: true, force: true });
    }
  });

  await check('reading edit build a page whose modules the server could not give says Theseus could not open this page, with Reload, and loads nothing by itself: a module lost on its own build, and the server away mid-deploy; Reload brings it up: on a laptop and at 390 by touch', async () => {
    for (const device of ['laptop', 'phone']) {
      const name = `edit-build-said-${device}`;
      const ids = await seed(name, [['note', { sender: 'aim-core', join: true, addressees: [facts.actor], body: 'A page whose modules were lost.' }]]);
      const p = await open(name, device, name, ids.note, LOADS);
      for (const way of ['lost', 'away']) {
        const what = `${device}, ${way}`;
        const before = await loads(p);
        const { build, held, reloading } = await reloadHeld(p, what);
        if (way === 'away') await control({ method: 'server_stop' });
        // Lost: the server serves the page's own build, so loading again would meet the same; away: nothing answers.
        await held.let(way === 'lost');
        await reloading;
        await until(async () => (await loaded(p))?.status !== '', `${what}: the page says it could not open, rather than stay blank`, 15000)
          .catch(async error => { throw Object.assign(error, { message: error.message + ' ' + JSON.stringify({ loads: await loads(p).catch(() => null), loaded: await loaded(p) }) }); });
        const seen = await loaded(p);
        assert.deepEqual({ status: seen.status, ready: seen.ready, readBuild: seen.readBuild, loads: await loads(p) },
          { status: 'Theseus could not open this page.Reload', ready: null, readBuild: true, loads: before + 1 }, `${what}: in plain words with Reload, having read the build and loaded nothing by itself`);
        assert.equal(await p.evaluate(`Boolean(document.querySelector('#app-status').getClientRects().length && document.querySelector('#app-status .updated-reload').getClientRects().length)`), true, `${what}: where the person sees it`);
        await shot(p, `edit-build-said-${device}-${way}`);
        if (way === 'away') {
          const restarted = await control({ method: 'server_start' });
          assert.equal(restarted.origin, facts.origin, 'the server is back at the same address');
          facts.token = restarted.token;
        }
        assert.equal(await servedBuild(), build, `${what}: the server serves the page's build`);
        await press(p, device, '#app-status .updated-reload');
        await comesUp(p, name, ids.note, `${what}: Reload brings the page up`);
        assert.equal(await loads(p), before + 2, `${what}: by the one load Reload asked for`);
        onOneBuild(await loaded(p), build, what);
      }
      assert.deepEqual(p.errors, []);
      await p.close();
    }
  });

  await check('reading edit build a page on one build, its modules slow but the server the same, loads once and reads no build; nor does a page opened plainly', async () => {
    const name = 'edit-build-once';
    const ids = await seed(name, [['note', { sender: 'aim-core', join: true, addressees: [facts.actor], body: 'A page on one build.' }]]);
    const p = await open(name, 'laptop', name, ids.note, LOADS);
    const served = await servedBuild();
    let seen = await loaded(p);
    assert.deepEqual({ loads: await loads(p), readBuild: seen.readBuild, status: seen.status }, { loads: 1, readBuild: false, status: '' }, 'opened plainly: one load, no build read, nothing said');
    onOneBuild(seen, served, 'opened plainly');
    const { build, held, reloading } = await reloadHeld(p, 'slow');
    assert.equal(build, served, 'the page asks for the build the server serves');
    await held.let();
    await reloading;
    await comesUp(p, name, ids.note, 'slow: the page comes up');
    seen = await loaded(p);
    assert.deepEqual({ loads: await loads(p), readBuild: seen.readBuild, status: seen.status }, { loads: 2, readBuild: false, status: '' }, 'slow: the reload alone, no build read, nothing said');
    onOneBuild(seen, served, 'slow');
    assert.deepEqual(p.errors, []);
    await p.close();
  });
  void DEVICES;
}

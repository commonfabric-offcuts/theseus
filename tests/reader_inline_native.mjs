import assert from 'node:assert/strict';
import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { holdRemoveThroughUpload, namedImages, LONG_NAME, recordTap, tapReached } from './reader_images_native.mjs';

// One selected real HTTP/Store flow. No product controller is replaced. File
// selection uses a native Add image click and a fixture file supplied through
// CDP; it does not establish interaction with the operating system's picker.
export async function inlineChecks({ check, page, until, root, facts, view, control, replace, field, shot, observations }) {
  await check('inline shared writing Ctrl commands and Undo match Reader', async () => {
    const p=await page('shared-writing',null,true), body='First line\nkeep remove';
    const text=selector=>p.evaluate(`document.querySelector(${JSON.stringify(selector)}).value`);
    const exercise=async selector=>{
      await p.evaluate(`document.querySelector(${JSON.stringify(selector)}).scrollIntoView({block:'center'})`);
      await p.point(selector);await p.send('Input.insertText',{text:body});
      await p.key('w',2);assert.equal(await text(selector),'First line\nkeep ','Ctrl-W deletes the previous word');
      await p.key('z',4);assert.equal(await text(selector),body,'native Undo restores Ctrl-W');
      await p.key('u',2);assert.equal(await text(selector),'First line\n','Ctrl-U preserves earlier lines');
      await p.key('z',4);assert.equal(await text(selector),body,'native Undo restores Ctrl-U');
      await p.key('a',2);assert.equal(await p.evaluate(`document.querySelector(${JSON.stringify(selector)}).selectionStart`),11);
      await p.key('k',2);assert.equal(await text(selector),'First line\n');
      await p.key('z',4);assert.equal(await text(selector),body);
      await p.key('e',2);assert.equal(await p.evaluate(`document.querySelector(${JSON.stringify(selector)}).selectionStart`),body.length);
      await p.key('Enter');assert.equal(await text(selector),body+'\n','plain Return remains writing');
    };
    await exercise('#inline-writing-body');
    // The topic draft is shared with the cases that follow: leave it empty.
    await p.key('a',4);await p.key('k',2);assert.equal(await text('#inline-writing-body'),'');
    await until(async()=>(await view('editor_state',{source_ref:{kind:'topic',id:facts.topic_id},topic_id:facts.topic_id})).draft?.body==='','emptied topic draft saved');
    await p.open(1);await exercise('#writing-body');
    const before=await field(p);
    await p.point('#source-body [data-start="0"]','move');await p.point('#source-body');
    await p.point('#source-body [data-start="0"]','move');await p.key('Enter');
    const quoted=await field(p);assert.notEqual(quoted,before);assert.match(quoted,/> Source 1 exact passage/);
    assert.equal(await p.evaluate('document.activeElement.id'),'writing-body');
    await p.key('z',4);assert.equal(await field(p),before,'native Undo restores writing before quote insertion');
    await until(async()=>{const s=await view('editor_state',{source_ref:facts.sources[1],topic_id:facts.topic_id});return s.draft?.body===before;},'Undo is saved canonically');
    assert.equal(p.calls.some(c=>['message.send','submission.prepare'].includes(c.payload?.kind)),false,'editing and Undo do not send');
    await shot(p,'shared-writing-reader');assert.deepEqual(p.errors,[]);
  });
  await check('inline Select All takes the message alone: the field it is in, or the message the Reader shows', async () => {
    const p=await page('select-all',null,true);
    // Chrome reports a text field's own selection as the page's selection, so
    // the page holding exactly the field's words means nothing else was taken.
    const state=selector=>p.evaluate(`(()=>{const f=document.querySelector(${JSON.stringify(selector)});return {start:f.selectionStart,end:f.selectionEnd,length:f.value.length,page:String(getSelection()),value:f.value}})()`);
    // The topic's writing field: ⌘A selects its own words and nothing on the page.
    await p.evaluate("document.querySelector('#inline-writing-body').scrollIntoView({block:'center'})");
    await p.point('#inline-writing-body');await p.send('Input.insertText',{text:'Inline words to select'});
    await p.key('a',4);
    assert.deepEqual(await state('#inline-writing-body'),{start:0,end:22,length:22,page:'Inline words to select',value:'Inline words to select'},'the inline field selects its own words alone');
    await p.key('k',2);assert.equal(await p.evaluate("document.querySelector('#inline-writing-body').value"),'');
    // The Reader's writing field: the same.
    await p.open(1);await p.point('#writing-body');
    const kept=await field(p);
    // The press lands near the field's top-left; the words go at the end.
    await p.evaluate('(f=>f.setSelectionRange(f.value.length,f.value.length))(document.querySelector("#writing-body"))');
    await p.send('Input.insertText',{text:' and more'});await p.key('a',4);
    const writing=await state('#writing-body');
    assert.deepEqual([writing.start,writing.end,writing.page],[0,writing.length,writing.value],'the Reader field selects its own words alone');
    // The message, clicked to read it, and a control beside it: ⌘A selects the
    // message's words, none of the Reader's buttons or labels.
    const message=await p.evaluate("document.querySelector('#source-body').textContent");
    for(const focus of ["document.querySelector('#source-body').focus()","document.querySelector('#quote-selection').focus()"]) {
      if(focus.includes('source-body'))await p.point('#source-body');else await p.evaluate(focus);
      await p.key('a',4);
      const chosen=await p.evaluate('String(getSelection())');
      assert.equal(chosen,message,`${focus}: the message's words alone`);
      const heading=await p.evaluate("document.querySelector('#reader-title').textContent");
      for(const control of ['Quote selection',heading,'Wide','Send','Add note','Add image'])assert.equal(chosen.includes(control),false,`${focus}: ${control} is not selected`);
      assert.equal(await p.evaluate("document.querySelector('#writing-body').value"),kept+' and more','selecting the message leaves the writing as it was');
    }
    await shot(p,'select-all-reader');
    // Leave the reply as the cases that follow expect it.
    await p.point('#writing-body');await p.key('a',4);if(kept)await p.send('Input.insertText',{text:kept});else await p.key('k',2);
    await until(async()=>(await view('editor_state',{source_ref:facts.sources[1],topic_id:facts.topic_id})).draft?.body===kept,'the reply is back as it was');
    assert.deepEqual(p.errors,[]);
  });
  await check('inline messages say when they were sent, in the log and in the reader', async () => {
    const p=await page('message-times',null,true);
    // The fixture's messages were sent moments ago: the time alone (or, in a
    // run that crosses midnight, yesterday's), with the date in its title.
    const shown=/^(Yesterday )?\d{1,2}:\d{2} (AM|PM)$/, dated=/^\d{1,2}:\d{2} (AM|PM) (Sun|Mon|Tue|Wed|Thu|Fri|Sat) [A-Z][a-z]{2} \d{1,2}$/;
    const times=await p.evaluate('[...document.querySelectorAll("#messages .message-card .message-time")].map(node=>({text:node.textContent,title:node.querySelector("time")?.title}))');
    assert.ok(times.length>0,'the log shows times');
    for(const time of times){assert.match(time.text.replace(/^ · /,''),shown);assert.match(time.title,dated,'its title keeps the date');}
    await p.open(1);
    const origin=await p.evaluate('({text:document.querySelector("#reader-origin").textContent,title:document.querySelector("#reader-origin time")?.title})');
    assert.match(origin.text.split(' · ').at(-1),shown,'the reader says when the message was sent');
    assert.match(origin.title,dated);
    assert.deepEqual(p.errors,[]);
  });
  await check('inline nothing lights while writing; a clicked passage lights and Return quotes it', async () => {
    const p=await page('quote-while-writing',null,true);
    await p.open(1);
    const lit=()=>p.evaluate('document.querySelectorAll("#source-body .hover-quote").length');
    const focused=()=>p.evaluate('document.activeElement.id');
    const quotes=async()=>((await field(p)).match(/> Source 1 exact passage/g)??[]).length;
    const before=await field(p), already=await quotes();
    await p.point('#source-body [data-start="0"]','move');
    assert.ok(await lit(),'away from the writing, the passage under the pointer lights');
    await p.point('#writing-body');
    assert.equal(await lit(),0,'putting the caret in the writing puts the light out');
    await p.evaluate('(f=>f.setSelectionRange(f.value.length,f.value.length))(document.querySelector("#writing-body"))');
    await p.send('Input.insertText',{text:'My reply'});
    await p.point('#source-body [data-start="0"]','move');
    assert.equal(await lit(),0,'nothing lights while the caret is in the writing');
    assert.equal(await focused(),'writing-body');
    await p.key('Enter');
    assert.equal(await field(p),before+'My reply\n','in the writing, Return is a new line');
    await p.point('#source-body [data-start="0"]');
    assert.ok(await lit(),'clicking a passage lights it');
    assert.notEqual(await focused(),'writing-body');
    await p.key('Enter');
    assert.equal(await quotes(),already+1,'Return quotes the clicked passage');
    assert.equal(await focused(),'writing-body','the caret returns to the writing');
    assert.equal(await lit(),0);
    // Leave the shared draft as it was found.
    await p.key('a',4);await p.key('k',2);
    if(before)await p.send('Input.insertText',{text:before});
    assert.equal(await field(p),before);
    await until(async()=>(await view('editor_state',{source_ref:facts.sources[1],topic_id:facts.topic_id})).draft?.body===before,'restored draft saved');
    assert.deepEqual(p.errors,[]);
  });
  await check('inline the light shows only where Return quotes, and Shift-click quotes exactly what lights', async () => {
    const p=await page('quote-light-rules',null,true);
    await p.open(1);
    const lit=()=>p.evaluate('[...document.querySelectorAll("#source-body .hover-quote")].map(s=>s.textContent).join("")');
    const before=await field(p);
    await p.point('#source-body [data-start="0"]','move');
    assert.ok(await lit(),'with the reader focused, the passage under the pointer lights');
    await p.point('#recipient-input');
    assert.equal(await lit(),'','a caret in the recipient field puts the light out');
    await p.point('#source-body [data-start="0"]','move');
    assert.equal(await lit(),'','nothing lights while Return would add a recipient');
    const starts=await p.evaluate('[...document.querySelectorAll("#source-body [data-start]")].map(s=>s.dataset.start)');
    assert.ok(starts.length>=3,'the fixture source has three passages');
    await p.point('#source-body [data-start="0"]');
    const b=await p.box(`#source-body [data-start="${starts[2]}"]`), x=b.x+Math.min(12,b.width/2), y=b.y+Math.min(12,b.height/2);
    await p.send('Input.dispatchMouseEvent',{type:'mouseMoved',x,y,modifiers:8});
    await p.send('Input.dispatchMouseEvent',{type:'mousePressed',x,y,button:'left',buttons:1,clickCount:1,modifiers:8});
    await p.send('Input.dispatchMouseEvent',{type:'mouseReleased',x,y,button:'left',clickCount:1,modifiers:8});
    const shown=await lit(), passages=await p.evaluate(`[...document.querySelectorAll("#source-body [data-start]")].slice(0,3).map(s=>s.textContent).join("")`);
    assert.equal(shown,passages,'Shift-click lights from the first passage through the third');
    assert.equal(await p.evaluate('getSelection().toString()'),'','the browser\'s own selection does not grow beside the light');
    await p.key('Enter');
    assert.ok((await field(p)).includes(shown.split('\n').map(line=>`> ${line}`).join('\n')),'Return quotes what lit');
    // Leave the shared draft as it was found.
    await p.key('a',4);await p.key('k',2);
    if(before)await p.send('Input.insertText',{text:before});
    assert.equal(await field(p),before);
    await until(async()=>(await view('editor_state',{source_ref:facts.sources[1],topic_id:facts.topic_id})).draft?.body===before,'restored draft saved');
    assert.deepEqual(p.errors,[]);
  });
  await check('inline a Shift-click after a drag lights from the dragged passage, and Return quotes what lights', async () => {
    const p=await page('quote-drag-extend',null,true);
    await p.open(1);
    const lit=()=>p.evaluate('[...document.querySelectorAll("#source-body .hover-quote")].map(s=>s.textContent).join("")');
    const before=await field(p);
    const starts=await p.evaluate('[...document.querySelectorAll("#source-body [data-start]")].map(s=>s.dataset.start)');
    assert.ok(starts.length>=3,'the fixture source has three passages');
    // A point inside a passage's first line, share of the way along it.
    const inside=(start,share)=>p.evaluate(`(()=>{const r=document.querySelector('#source-body [data-start="${start}"]').getClientRects()[0];return {x:r.x+r.width*${share},y:r.y+r.height/2};})()`);
    const from=await inside(starts[0],.5), to=await inside(starts[1],.5);
    await p.send('Input.dispatchMouseEvent',{type:'mouseMoved',x:from.x,y:from.y});
    await p.send('Input.dispatchMouseEvent',{type:'mousePressed',x:from.x,y:from.y,button:'left',buttons:1,clickCount:1});
    await p.send('Input.dispatchMouseEvent',{type:'mouseMoved',x:to.x,y:to.y,button:'left',buttons:1});
    await p.send('Input.dispatchMouseEvent',{type:'mouseReleased',x:to.x,y:to.y,button:'left',clickCount:1});
    const dragged=await p.evaluate('getSelection().toString()');
    assert.ok(dragged&&!(await p.evaluate(`document.querySelector('#source-body [data-start="${starts[0]}"]').textContent`)).startsWith(dragged),'the drag selected from inside the first passage into the second');
    const c=await inside(starts[2],.2);
    await p.send('Input.dispatchMouseEvent',{type:'mouseMoved',x:c.x,y:c.y,modifiers:8});
    await p.send('Input.dispatchMouseEvent',{type:'mousePressed',x:c.x,y:c.y,button:'left',buttons:1,clickCount:1,modifiers:8});
    await p.send('Input.dispatchMouseEvent',{type:'mouseReleased',x:c.x,y:c.y,button:'left',clickCount:1,modifiers:8});
    const shown=await lit(), passages=await p.evaluate(`[...document.querySelectorAll("#source-body [data-start]")].slice(0,3).map(s=>s.textContent).join("")`);
    assert.equal(shown,passages,'Shift-click lights from the dragged passages through the third');
    assert.equal(await p.evaluate('getSelection().toString()'),'','the dragged selection gives way to the light');
    await p.key('Enter');
    const quote=shown.split('\n').map(line=>`> ${line}`).join('\n');
    assert.ok((await field(p)).includes(quote),'Return quotes what lit, not the dragged text');
    // Leave the shared draft as it was found.
    await p.key('a',4);await p.key('k',2);
    if(before)await p.send('Input.insertText',{text:before});
    assert.equal(await field(p),before);
    await until(async()=>(await view('editor_state',{source_ref:facts.sources[1],topic_id:facts.topic_id})).draft?.body===before,'restored draft saved');
    assert.deepEqual(p.errors,[]);
  });
  await check('inline Add to topic pressed from the keyboard on a recipient chip leaves focus in the recipient field', async () => {
    const p=await page('reach-add-focus',null,true);
    await p.open(1);
    const name='fixture-outside-agent', focused=()=>p.evaluate('document.activeElement.id');
    const chip=`[...document.querySelectorAll("#recipient-chips .chip")].find(c=>c.dataset.name===${JSON.stringify(name)})`;
    const participants=async()=>(await view('topic',{topic_id:facts.topic_id})).participants.map(row=>row.actor_id);
    assert.equal((await participants()).includes(name),false,'the fixture agent starts outside the topic');
    await p.point('#recipient-input');await p.send('Input.insertText',{text:name});await p.key('Enter');
    await until(()=>p.evaluate(`${chip}?.classList.contains('unreachable')`),'the chip says they are not in the topic');
    await p.key('Tab',8);
    assert.equal(await p.evaluate('document.activeElement.textContent'),'Add to topic (gets all its messages)','Shift-Tab from the field reaches the chip\'s offer');
    await p.key('Enter');
    // Once in the topic they are one of its people: a name tapped once, lit while the reply names them.
    const named=`document.querySelector('#recipient-chips button.choice-chip[data-name=${JSON.stringify(name)}]')`;
    await until(()=>p.evaluate(`${named}?.getAttribute('aria-pressed')==='true' && !${chip}`),'the chip is repainted once they are in the topic');
    assert.ok((await participants()).includes(name),'Return on the offer added them');
    assert.equal(await focused(),'recipient-input','focus stays in the reader, on the recipient field');
    await p.key('Tab',8);
    assert.equal(await p.evaluate(`document.activeElement===${named}`),true,'Shift-Tab reaches their name');
    await p.key('Enter');
    await until(()=>p.evaluate(`${named}?.getAttribute('aria-pressed')==='false'`),'Return on it takes them off the reply, and their name stays to tap again');
    assert.equal(await p.evaluate(`document.activeElement===${named}`),true,'and the focus stays on their name');
    await until(async()=>(await view('editor_state',{source_ref:facts.sources[1],topic_id:facts.topic_id})).draft?.addressees.length===0,'the draft keeps no recipient');
    // Leave the topic's participants as they were found.
    await p.evaluate(`document.querySelector('#participants button[aria-label="Remove ${name}"]').click()`);
    await until(async()=>!(await participants()).includes(name),'the fixture agent is out of the topic again');
    assert.deepEqual(p.errors,[]);
  });
  await check('inline correction unavailable startup remains readable and Retry restores its composer', async () => {
    await control({ method: 'read_fault', name: 'editor_state', read_class: 'foreground', status: 503, body: { error: { code: 'SERVER_BUSY', message: 'Composer is temporarily unavailable', retryable: true } }, count: 1 });
    const p = await page('inline-startup-refusal', null, true);
    assert.ok(await p.evaluate('document.querySelectorAll("#messages .message-card").length>0'));
    assert.equal(await p.evaluate('document.querySelector("#inline-writing-body").disabled'), true);
    await p.evaluate('document.querySelector("#inline-composer").scrollIntoView({block:"center"})');
    await p.point('#inline-writing-body'); await p.send('Input.insertText', { text: 'must not enter ownerless writing' });
    assert.equal(await p.evaluate('document.querySelector("#inline-writing-body").value'), '');
    assert.equal(p.calls.some(c => c.payload?.kind), false, 'failed startup and disabled typing create no draft/command');
    assert.equal(await p.evaluate('document.querySelector("#inline-retry").textContent'), 'Retry composer');
    await p.point('#inline-retry');
    await until(() => p.evaluate('!document.querySelector("#inline-writing-body").disabled && document.querySelector("#inline-retry").hidden'), 'same document retries confirmed composer');
    assert.equal(p.calls.some(c => c.payload?.kind), false, 'retrying the read does not manufacture a draft');
    await p.evaluate('window.scrollTo(0,0)');
    await control({ method: 'read_fault', name: 'source', read_class: 'foreground', status: 503, body: { error: { code: 'SERVER_BUSY', message: 'This source could not be opened', retryable: true } }, count: 1 });
    // A card whose words show: a press there opens it (on a stack's head shown as one row, a press shows its words instead).
    await p.evaluate(`[...document.querySelectorAll('#messages .message-card')].find(c=>c.querySelector(':scope > .message-preview')?.getClientRects().length).id='inline-open-fixture-card'`);
    await p.point('#inline-open-fixture-card > .message-preview');
    await until(() => p.evaluate('!document.querySelector("#app-status").hidden'), 'failed inline-origin open is explained globally');
    assert.match(await p.evaluate('document.querySelector("#app-status").textContent'), /source could not be opened/);
    const notice = await p.box('#app-status'); assert.ok(notice.y >= 0 && notice.y+notice.height<=notice.viewportHeight, 'failed visible-card open has a visible explanation');
    assert.equal(await p.evaluate('document.querySelector("#reader").open'), false);
    assert.deepEqual(p.errors, []);
  });

  await check('inline correction moved Reader mode recipient and image controls retain their owner', async () => {
    const p = await page('reader-moved-controls', null, true); await p.open(1);
    await replace(p, 'Reply remains separate from its private note');
    await p.point('#recipient-input'); await p.send('Input.insertText', { text: 'fixture-agent' }); await p.key('Enter');
    assert.ok(await p.evaluate('document.querySelector("#recipient-chips").textContent.includes("fixture-agent")'));
    await p.point('#toggle-note'); await replace(p, 'Private note remains private');
    await p.point('#toggle-note'); assert.equal(await field(p), 'Reply remains separate from its private note');
    await p.point('#recipient-chips [aria-label="Remove fixture-agent"]'); assert.equal(await p.evaluate('Boolean(document.querySelector("#recipient-chips [data-name=\'fixture-agent\']"))'), false);
    await p.send('Page.setInterceptFileChooserDialog', { enabled: true }); await p.point('#add-image');
    const chooser = await until(() => p.events.find(e => e.method === 'Page.fileChooserOpened'), 'Reader native image chooser');
    await p.send('DOM.setFileInputFiles', { backendNodeId: chooser.params.backendNodeId, files: [path.join(root, 'tests/fixtures/media/screen.png')] });
    // Remove is pressed once the row says Ready, as a person would. Its upload
    // may still be finishing; the row's repaint then keeps the Remove pressed.
    await until(() => p.evaluate('document.querySelector("#writing-attachments .image-choice span")?.textContent === "screen.png · Ready"'), 'Reader image ready');
    await p.evaluate('(()=>{const b=[...document.querySelectorAll("#writing-attachments button")].find(b=>b.textContent==="Remove");b.id="reader-remove-fixture-image"})()');
    await p.point('#reader-remove-fixture-image');
    await until(() => p.evaluate('document.querySelector("#writing-attachments").children.length===0'), 'native image-row removal');
    await until(async () => { const state=await view('editor_state', { source_ref: facts.sources[1], topic_id: facts.topic_id }); return state.draft?.body==='Reply remains separate from its private note' && state.draft.attachments.length===0 && state.draft.addressees.length===0 && state.note?.body==='Private note remains private'; }, 'separate exact reply/note saved with recipient and image removed');
    assert.equal(p.calls.some(c => ['message.send','submission.prepare'].includes(c.payload?.kind)), false);
    assert.deepEqual(p.errors, []);
  });

  await check('inline find restore owner switch arrival and exact source-free send', async () => {
    const p = await page('inline-composer', null, true);
    const inlineBody = () => p.evaluate('document.querySelector("#inline-writing-body").value');
    const inlineState = () => view('editor_state', { source_ref: { kind: 'topic', id: facts.topic_id }, topic_id: facts.topic_id });
    const noSend = () => assert.equal(p.calls.filter(c => c.payload?.kind === 'message.send').length, 0);
    assert.equal(await p.evaluate('Boolean(document.querySelector("#inline-composer"))'), true, 'the topic exposes New message without opening a source');
    assert.equal(await p.evaluate('document.querySelector("#inline-writing-title").textContent'), 'New message');
    assert.match(await p.evaluate('document.querySelector("#inline-destination").textContent'), /^To /);
    assert.ok((await p.evaluate('document.querySelector("#inline-destination").textContent')).includes(await p.evaluate('document.querySelector("#topic-title").textContent')));
    // Seed one closed, unacknowledged local copy through the actual journal.
    // This is isolated fixture setup, not an assertion of a native user edit.
    await p.evaluate(`(async()=>{
      const {Editor}=await import('/editor.mjs');
      const context=${JSON.stringify({ instanceId: facts.instance_id, actor: facts.actor, kind: 'reply', topicId: facts.topic_id, sourceRef: { kind: 'topic', id: facts.topic_id } })};
      const previous=new Editor(context,{id:'inline-retained-fixture',generation:'retained',revision:0});
      previous.edit({body:'Older inline writing kept on this device'});
      const j=await (await import('/journal.mjs')).openJournal(context);
      try { await j.save(previous.snapshot()); } finally { j.close(); }
    })()`);
    // Which document is up: its timeOrigin as first read, kept on the window (WebKit's can move 1 ms with no load).
    const beforeRecoveryReload = await p.evaluate('(window.documentOrigin??=performance.timeOrigin)');
    await p.send('Page.reload');
    await until(() => p.evaluate(`(window.documentOrigin??=performance.timeOrigin) !== ${beforeRecoveryReload} && document.body?.dataset.ready === "true"`), 'fresh inline document for saved-copy discovery');
    await until(() => p.evaluate('!document.querySelector("#inline-review-versions").hidden'), 'retained inline writing exposes Review versions');
    await p.evaluate('document.querySelector("#inline-review-versions").scrollIntoView({block:"center"})');
    await p.point('#inline-review-versions');
    await until(() => p.evaluate('document.querySelector("#review-content").textContent.includes("Older inline writing kept on this device")'), 'the inline recovery entry shows exact retained writing');
    assert.equal(await inlineBody(), '', 'discovery does not adopt or overwrite current writing');
    assert.equal(await p.evaluate('document.querySelector("#reader").open'), false, 'inline recovery never manufactures a source Reader');
    await p.point('#review-close'); noSend();
    const afterReview = await p.evaluate('(window.documentOrigin??=performance.timeOrigin)');
    await p.send('Page.reload');
    await until(() => p.evaluate(`(window.documentOrigin??=performance.timeOrigin) !== ${afterReview} && document.body?.dataset.ready === "true"`), 'inline document after review');
    const tabLimit = await p.evaluate('document.querySelectorAll("a[href],button,input,textarea,select,[tabindex]").length + 2');
    for (let count = 0; count < tabLimit && await p.evaluate('document.activeElement?.id') !== 'inline-writing-body'; ++count) await p.key('Tab');
    assert.equal(await p.evaluate('document.activeElement.id'), 'inline-writing-body', 'normal Tab finds writing with no programmatic focus');
    await p.send('Input.insertText', { text: 'A new message in this topic' });
    await p.key('Enter');
    assert.equal(await inlineBody(), 'A new message in this topic\n', 'plain Return inserts a real newline'); noSend();
    await p.send('Input.insertText', { text: 'A second line kept through reload' });
    const expected = 'A new message in this topic\nA second line kept through reload';
    await until(async () => (await inlineState()).draft?.body === expected, 'canonical inline draft saved');

    await p.open(1); await replace(p, 'Separate modal writing stays intact');
    await until(async () => (await view('editor_state', { source_ref: facts.sources[1], topic_id: facts.topic_id })).draft?.body === 'Separate modal writing stays intact', 'unrelated modal draft saved');
    const modalDraft = (await view('editor_state', { source_ref: facts.sources[1], topic_id: facts.topic_id })).draft;
    await p.point('#reader-close'); await until(() => p.evaluate('!document.querySelector("#reader").open'), 'modal closed');
    assert.equal(await inlineBody(), expected); noSend();
    const documentStart = await p.evaluate('(window.documentOrigin??=performance.timeOrigin)');
    await p.send('Page.reload');
    await until(() => p.evaluate(`(window.documentOrigin??=performance.timeOrigin) !== ${documentStart} && document.body?.dataset.ready === "true" && Boolean(document.querySelector('#inline-writing-body'))`), 'new inline document ready');
    assert.equal(await inlineBody(), expected, 'reload returns to the independent topic draft');

    await p.evaluate('document.querySelector("#inline-add-image").scrollIntoView({block:"center"})');
    await p.send('Page.setInterceptFileChooserDialog', { enabled: true });
    p.intercept((_payload, event) => event.request.url.endsWith('/api/media/upload'));
    await p.point('#inline-add-image');
    const picker = await until(() => p.events.find(e => e.method === 'Page.fileChooserOpened'), 'native inline chooser');
    const imagePath = path.join(root, 'tests/fixtures/media/screen.png');
    await p.send('DOM.setFileInputFiles', { backendNodeId: picker.params.backendNodeId, files: [imagePath] });
    const held = await until(() => p.held.find(e => e.event.request.url.endsWith('/api/media/upload')), 'held inline image response');
    assert.equal(await p.evaluate('document.querySelector("#inline-send").disabled'), true, 'an unresolved chosen image cannot be silently omitted');
    await p.open(1); assert.equal(await field(p), modalDraft.body);
    await p.point('#writing-body'); await p.key('e', 2);
    const modalSnapshot = () => p.evaluate(`(()=>{const f=document.querySelector('#writing-body');return {body:f.value,start:f.selectionStart,end:f.selectionEnd,focus:document.activeElement.id,notice:document.querySelector('#reader-notice').textContent,images:document.querySelector('#writing-attachments').textContent}})()`);
    const beforeCompletion = await modalSnapshot();
    p.intercept(null); await p.release(held);
    await until(async () => (await inlineState()).draft?.attachments.length === 1, 'the admitted upload finishes on the inline owner');
    assert.deepEqual(await modalSnapshot(), beforeCompletion, 'late inline completion cannot paint or focus the modal');
    await p.point('#reader-close'); await until(() => p.evaluate('!document.querySelector("#reader").open'), 'modal closed after inline upload');
    await until(() => p.evaluate('document.querySelector("#inline-attachments").textContent.includes("Ready")'), 'inline attachment visible on resume');
    assert.equal(await inlineBody(), expected); noSend();

    await p.evaluate('document.querySelector("#inline-writing-body").scrollIntoView({block:"center"})');
    await p.point('#inline-writing-body'); await p.key('e', 2); await p.key('ArrowLeft');
    const writingPosition = () => p.evaluate(`(()=>{const f=document.querySelector('#inline-writing-body'),b=f.getBoundingClientRect();return {body:f.value,start:f.selectionStart,end:f.selectionEnd,focus:document.activeElement.id,top:b.top,bottom:b.bottom,height:innerHeight}})()`);
    const pageHeight = () => p.evaluate('document.documentElement.scrollHeight');
    const beforeArrival = await writingPosition(), heightBefore = await pageHeight();
    assert.ok(beforeArrival.top >= 0 && beforeArrival.bottom <= beforeArrival.height, 'the actual writing area is visible before arrival');
    // The arrival is a message of its own to the topic, written from the topic
    // (no message it answers), so it is a stack of its own drawn at the top of
    // the newest-first page, above the writing: the page grows above what is
    // being written, which holds its place. A reply into the stack on screen
    // would instead take the place of its read latest reply
    // (docs/reply-stacks.md, "Folding", item 342), which can leave the page
    // shorter than the window, where no place can be held.
    const arrival = 'An independent automatic arrival while writing inline';
    const received = await control({ method: 'agent_message', operation_id: 'inline-native-automatic-arrival', body: arrival, topic_id: facts.topic_id, source: 'topic', addressees: [] });
    assert.equal(received.status, 'committed');
    await until(() => p.evaluate(`document.querySelector('#messages').textContent.includes(${JSON.stringify(arrival)})`), 'automatic incoming render without Refresh');
    const afterArrival = await writingPosition();
    const arrived = await p.evaluate(`(()=>{const c=[...document.querySelectorAll('#messages .message-card')].find(c=>c.textContent.includes(${JSON.stringify(arrival)}));return {above:Boolean(c)&&Boolean(c.compareDocumentPosition(document.querySelector('#inline-writing-body'))&Node.DOCUMENT_POSITION_FOLLOWING),shown:Boolean(c?.getClientRects().length)}})()`);
    assert.deepEqual({ ...arrived, grew: await pageHeight() > heightBefore }, { above: true, shown: true, grew: true }, 'the arrival is drawn above the writing and the page grows by it');
    assert.deepEqual({ ...afterArrival, top: beforeArrival.top, bottom: beforeArrival.bottom }, beforeArrival, 'arrival preserves body, caret and focus');
    assert.ok(afterArrival.top >= 0 && afterArrival.bottom <= afterArrival.height, 'arrival keeps the writing area in view');
    assert.ok(Math.abs(afterArrival.top - beforeArrival.top) <= 2, 'arrival preserves the visible writing position ' + JSON.stringify({ beforeArrival, afterArrival, stacks: await p.evaluate(`[...document.querySelector('#messages').children].map(e=>e.className.split(' ')[0]+':'+(e.dataset.fold??''))`) }));
    observations.push({ name: 'inline arrival anchor', beforeArrival, afterArrival });
    await shot(p, 'inline-before-send'); noSend();

    await p.key('Enter', 4);
    const send = await until(() => p.calls.find(c => c.payload?.kind === 'message.send'), 'Command-Return sends');
    const receipt = await view('operation', { operation_id: send.payload.operation_id }); assert.equal(receipt.status, 'committed');
    const source = await view('source', { kind: 'message', id: receipt.result.message_id });
    assert.equal(source.body, expected); assert.equal(source.author, facts.actor); assert.equal(source.topic_id, facts.topic_id);
    assert.equal(source.reply_to, null); assert.equal(source.exchange_id, null); assert.deepEqual(source.quotes, []);
    assert.equal(source.attachments.length, 1);
    assert.equal(source.attachments[0].sha256, createHash('sha256').update(await readFile(imagePath)).digest('hex'));
    await until(async () => await inlineBody() === '', 'inline successor ready');
    assert.equal(await p.evaluate('document.activeElement.id'), 'inline-writing-body');
    assert.equal(await p.evaluate('document.querySelector("#reader").open'), false);
    assert.equal(p.calls.filter(c => c.payload?.kind === 'message.send').length, 1, 'one deliberate send');
    assert.deepEqual((await view('editor_state', { source_ref: facts.sources[1], topic_id: facts.topic_id })).draft, modalDraft, 'the unrelated modal draft is unchanged');
    assert.equal(p.calls.some(c => c.payload?.name === 'source' && c.payload.args?.kind === 'topic'), false, 'the composer never fabricates a source');
    observations.push({ name: 'inline exact publication', receipt, source, modalDraft });
    await shot(p, 'inline-after-send'); assert.deepEqual(p.errors, []);
  });
  await check('inline Remove moves focus to the writing only while the person has not moved it', async () => {
    const p = await page('inline-remove-focus', null, true);
    const inlineBody = () => p.evaluate('document.querySelector("#inline-writing-body").value');
    const center = selector => p.evaluate(`document.querySelector(${JSON.stringify(selector)}).scrollIntoView({block:'center'})`);
    const removed = () => p.evaluate('!document.querySelector("#inline-attachments").textContent.includes("screen.png")');
    const choose = async () => {
      await center('#inline-add-image');
      const n = p.events.length; await p.send('Page.setInterceptFileChooserDialog', { enabled: true }); await p.point('#inline-add-image');
      const event = await until(() => p.events.slice(n).find(e => e.method === 'Page.fileChooserOpened'), 'inline chooser');
      await p.send('DOM.setFileInputFiles', { backendNodeId: event.params.backendNodeId, files: [path.join(root, 'tests/fixtures/media/screen.png')] });
      await until(() => p.evaluate('document.querySelector("#inline-attachments .image-choice span")?.textContent === "screen.png · Ready" && [...document.querySelectorAll("#inline-attachments button")].some(b=>b.textContent==="Remove"&&!b.disabled)'), 'ready inline image with Remove');
      await p.evaluate('[...document.querySelectorAll("#inline-attachments button")].find(b=>b.textContent==="Remove").dataset.inlineRemove=""');
      await center('[data-inline-remove]');
    };
    // Another tab of this person holds the recovery store, so Remove's strict
    // write finishes only after the person has clicked into the writing and
    // begun typing.
    await choose();
    const holder = await page('inline-remove-focus-holder');
    await holder.evaluate(`new Promise((resolve,reject)=>{const r=indexedDB.open('aim-next-pending');r.onerror=()=>reject(r.error);r.onsuccess=()=>{const d=r.result,t=d.transaction('editors','readwrite',{durability:'strict'}),s=t.objectStore('editors');window.release=false;const keep=()=>{if(!window.release)s.get('inline-remove-focus-hold').onsuccess=keep};keep();t.oncomplete=()=>{d.close();window.released=true};resolve()}})`);
    await p.point('[data-inline-remove]');
    assert.equal(await p.evaluate('Boolean(document.querySelector("[data-inline-remove]")?.isConnected)'), true, 'Remove is still writing behind the held store');
    await center('#inline-writing-body'); await p.point('#inline-writing-body'); await p.key('a', 4);
    await p.send('Input.insertText', { text: 'Typed while Remove waits' });
    assert.equal(await removed(), false, 'Remove is still held when the person has moved focus and typed');
    await holder.evaluate('window.release=true');
    await until(() => holder.evaluate('window.released===true'), 'held store released');
    await until(removed, 'Remove finished');
    await p.evaluate('new Promise(resolve=>setTimeout(resolve,0))');
    assert.equal(await p.evaluate('document.activeElement.id'), 'inline-writing-body', 'a finished Remove leaves focus where the person put it');
    await p.send('Input.insertText', { text: ' and after' });
    assert.equal(await inlineBody(), 'Typed while Remove waits and after', 'typing goes on into the writing');
    // Untouched, focus leaves the removed button for the writing: Add image
    // is in the + panel, put away (docs/reader.md).
    await choose(); await p.point('[data-inline-remove]');
    await until(removed, 'second Remove finished');
    await until(() => p.evaluate('document.activeElement.id === "inline-writing-body"'), 'focus in the writing after an untouched Remove');
    assert.equal(await inlineBody(), 'Typed while Remove waits and after');
    assert.equal(p.calls.filter(c => c.payload?.kind === 'message.send').length, 0);
    // The topic draft is shared with any case that follows: leave it empty.
    await center('#inline-writing-body'); await p.point('#inline-writing-body'); await p.key('a', 4); await p.key('k', 2);
    assert.equal(await inlineBody(), '');
    await until(async () => { const draft = (await view('editor_state', { source_ref: { kind: 'topic', id: facts.topic_id }, topic_id: facts.topic_id })).draft; return draft?.body === '' && draft.attachments.length === 0; }, 'emptied topic draft saved');
    assert.deepEqual(p.errors, []);
  });
  // The inline composer's image row, with the fixture's short name at the
  // desktop width, and on the phone with a long name whose words wrap.
  for (const [width, name] of [[1440, 'screen.png'], [390, LONG_NAME]]) {
    await check(`inline Remove held down while its upload finishes removes the image at ${width} wide with the name ${name}`, async () => {
      const names = await namedImages(root);
      try {
        const p = await page(`inline-remove-held-${width}`, null, true);
        if (width === 390) await p.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
        await p.evaluate('document.querySelector("#inline-add-image").scrollIntoView({block:"center"})');
        p.intercept((_payload, event) => event.request.url.endsWith('/api/media/upload'));
        const n = p.events.length; await p.send('Page.setInterceptFileChooserDialog', { enabled: true }); await p.point('#inline-add-image');
        const event = await until(() => p.events.slice(n).find(e => e.method === 'Page.fileChooserOpened'), 'inline chooser');
        await p.send('DOM.setFileInputFiles', { backendNodeId: event.params.backendNodeId, files: [name === 'screen.png' ? path.join(root, 'tests/fixtures/media/screen.png') : names.file(name)] });
        const held = await until(() => p.held.find(x => x.event.request.url.endsWith('/api/media/upload')), 'held inline upload');
        await holdRemoveThroughUpload(p, '#inline-attachments', held, until, { name });
        await until(async () => { const draft = (await view('editor_state', { source_ref: { kind: 'topic', id: facts.topic_id }, topic_id: facts.topic_id })).draft; return draft?.body === '' && draft.attachments.length === 0; }, 'the topic draft saved with no image');
        assert.equal(p.calls.filter(c => c.payload?.kind === 'message.send').length, 0);
        assert.deepEqual(p.errors, []);
      } finally { await names.done(); }
    });
  }
  // On a phone, with a finger: Remove is held on the second image while the
  // first's upload fails, with focus in the message field. Each image is a
  // thumbnail in the strip (docs/reader.md), so the first's failing moves
  // nothing and the second's × keeps its place under the finger. Remove
  // removes the second image only, the tap's mouse events and click reach
  // nothing under the finger but Remove, and the message field keeps the focus.
  await check('inline Remove held by a finger beside an image whose upload fails removes its own image, nothing under the finger is pressed, and the field keeps the focus', async () => {
    const names = await namedImages(root);
    try {
      const p = await page('inline-remove-tap-below', null, true);
      await p.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
      await p.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
      const center = selector => p.evaluate(`document.querySelector(${JSON.stringify(selector)}).scrollIntoView({block:'center'})`);
      p.intercept((_payload, event) => event.request.url.endsWith('/api/media/upload'));
      const choose = async (file, upload) => {
        await center('#inline-add-image');
        const n = p.events.length; await p.send('Page.setInterceptFileChooserDialog', { enabled: true }); await p.point('#inline-add-image');
        const event = await until(() => p.events.slice(n).find(e => e.method === 'Page.fileChooserOpened'), upload);
        await p.send('DOM.setFileInputFiles', { backendNodeId: event.params.backendNodeId, files: [file] });
      };
      await choose(names.file(LONG_NAME), 'first inline chooser');
      const first = await until(() => p.held.find(x => x.event.request.url.endsWith('/api/media/upload')), 'first held inline upload');
      await choose(path.join(root, 'tests/fixtures/media/screen.png'), 'second inline chooser');
      // The second image's upload waits its turn behind the first's.
      await until(() => p.evaluate('[...document.querySelectorAll("#inline-attachments .image-choice span")].some(s=>s.textContent==="screen.png · Ready to continue upload")'), 'the second image waiting to upload');
      await center('#inline-attachments');
      const { focus } = await holdRemoveThroughUpload(p, '#inline-attachments', first, until, { name: 'screen.png', finishing: LONG_NAME, place: 'kept', touch: true, fail: true, from: '#inline-writing-body' });
      assert.equal(focus, 'inline-writing-body', 'the message field keeps the focus');
      assert.equal(await p.evaluate('[...document.querySelectorAll("#inline-attachments .image-choice")].map(r=>r.firstElementChild.textContent.split(" · ")[0]).join("|")'), LONG_NAME, 'the first image stays');
      await until(async () => (await view('editor_state', { source_ref: { kind: 'topic', id: facts.topic_id }, topic_id: facts.topic_id })).draft?.attachments.length === 0, 'the topic draft saved with no image, the first one\'s upload having failed');
      assert.equal(p.calls.filter(c => c.payload?.kind === 'message.send').length, 0);
      assert.deepEqual(p.errors, []);
    } finally { await names.done(); }
  });

  // The inverse, on a phone: a finger goes down on the composer just below
  // the second image, on no image button, while the first's upload fails.
  // Each image is a thumbnail in the strip (docs/reader.md), so the first's
  // failing moves nothing: no Remove comes under the finger, nothing is
  // pressed, both images stay, and focus stays in the message field.
  await check('inline a finger that goes down below the image strip presses nothing there as an upload above fails', async () => {
    const names = await namedImages(root);
    try {
      const p = await page('inline-field-tap-below', null, true);
      await p.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
      await p.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
      const center = selector => p.evaluate(`document.querySelector(${JSON.stringify(selector)}).scrollIntoView({block:'center'})`);
      p.intercept((_payload, event) => event.request.url.endsWith('/api/media/upload'));
      const chooser = () => p.events.filter(e => e.method === 'Page.fileChooserOpened').length;
      const choose = async (file, upload) => {
        await center('#inline-add-image');
        const n = p.events.length; await p.send('Page.setInterceptFileChooserDialog', { enabled: true }); await p.point('#inline-add-image');
        const event = await until(() => p.events.slice(n).find(e => e.method === 'Page.fileChooserOpened'), upload);
        await p.send('DOM.setFileInputFiles', { backendNodeId: event.params.backendNodeId, files: [file] });
      };
      await choose(names.file(LONG_NAME), 'first inline chooser');
      const first = await until(() => p.held.find(x => x.event.request.url.endsWith('/api/media/upload')), 'first held inline upload');
      await choose(path.join(root, 'tests/fixtures/media/screen.png'), 'second inline chooser');
      await until(() => p.evaluate('[...document.querySelectorAll("#inline-attachments .image-choice span")].some(s=>s.textContent==="screen.png · Ready to continue upload")'), 'the second image waiting to upload');
      await center('#inline-attachments');
      await p.evaluate('[...[...document.querySelectorAll("#inline-attachments .image-choice")].find(r=>r.firstElementChild.textContent.startsWith("screen.png · ")).querySelectorAll("button")].find(b=>b.textContent==="Remove").dataset.slid=""');
      const remove = await p.box('[data-slid]'), x = remove.x + remove.width / 2, y = remove.y + remove.height + 30;
      const under = () => p.evaluate(`(e=>e?.closest('[data-slid]')?'Remove':e?.closest('[data-holds-press]')?'an image button':e?.id||e?.tagName)(document.elementFromPoint(${x},${y}))`);
      assert.notEqual(await under(), 'Remove'); assert.notEqual(await under(), 'an image button', 'the finger goes down on no image button');
      assert.equal(await p.evaluate('(()=>{const f=document.querySelector("#inline-writing-body");f.focus();return document.activeElement===f})()'), true, 'focus is in the message field');
      const opened = chooser();
      await recordTap(p);
      await p.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
      p.intercept(null); await p.fail(first);
      await until(() => p.evaluate(`JSON.parse([...document.querySelectorAll('#inline-attachments .image-choice')].find(r=>r.firstElementChild.textContent.startsWith(${JSON.stringify(LONG_NAME)}))?.dataset.view||'[]')[4]===false`), 'the first row repainted as its upload failed');
      assert.notEqual(await under(), 'Remove', 'the first image\'s failing moved no Remove under the finger');
      await p.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      assert.deepEqual((await tapReached(p, until)).filter(([, target]) => target === 'pressed'), [], 'the tap presses no image button');
      assert.deepEqual(await p.evaluate('({rows:[...document.querySelectorAll("#inline-attachments .image-choice")].map(r=>r.firstElementChild.textContent.split(" · ")[0]),remove:!document.querySelector("[data-slid]").disabled,focus:document.activeElement?.id})'), { rows: [LONG_NAME, 'screen.png'], remove: true, focus: 'inline-writing-body' }, 'both images stay, Remove was never pressed, and focus stays in the message field');
      assert.equal(chooser(), opened, 'and nothing else was pressed');
      assert.deepEqual(p.errors, []);
      // The topic draft is shared with any case that follows: leave it empty.
      await control({ method: 'reset_drafts' });
    } finally { await names.done(); }
  });
}

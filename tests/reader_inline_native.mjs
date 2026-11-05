import assert from 'node:assert/strict';
import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

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
    await p.point('#messages .message-card');
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
    await p.point('#recipient-chips button'); assert.equal(await p.evaluate('document.querySelector("#recipient-chips").children.length'), 0);
    await p.send('Page.setInterceptFileChooserDialog', { enabled: true }); await p.point('#add-image');
    const chooser = await until(() => p.events.find(e => e.method === 'Page.fileChooserOpened'), 'Reader native image chooser');
    await p.send('DOM.setFileInputFiles', { backendNodeId: chooser.params.backendNodeId, files: [path.join(root, 'tests/fixtures/media/screen.png')] });
    await until(() => p.evaluate('document.querySelector("#writing-attachments").textContent.includes("Ready")'), 'Reader image ready');
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
    const beforeRecoveryReload = await p.evaluate('performance.timeOrigin');
    await p.send('Page.reload');
    await until(() => p.evaluate(`performance.timeOrigin !== ${beforeRecoveryReload} && document.body?.dataset.ready === "true"`), 'fresh inline document for saved-copy discovery');
    await until(() => p.evaluate('!document.querySelector("#inline-review-versions").hidden'), 'retained inline writing exposes Review versions');
    await p.evaluate('document.querySelector("#inline-review-versions").scrollIntoView({block:"center"})');
    await p.point('#inline-review-versions');
    await until(() => p.evaluate('document.querySelector("#review-content").textContent.includes("Older inline writing kept on this device")'), 'the inline recovery entry shows exact retained writing');
    assert.equal(await inlineBody(), '', 'discovery does not adopt or overwrite current writing');
    assert.equal(await p.evaluate('document.querySelector("#reader").open'), false, 'inline recovery never manufactures a source Reader');
    await p.point('#review-close'); noSend();
    const afterReview = await p.evaluate('performance.timeOrigin');
    await p.send('Page.reload');
    await until(() => p.evaluate(`performance.timeOrigin !== ${afterReview} && document.body?.dataset.ready === "true"`), 'inline document after review');
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
    const documentStart = await p.evaluate('performance.timeOrigin');
    await p.send('Page.reload');
    await until(() => p.evaluate(`performance.timeOrigin !== ${documentStart} && document.body?.dataset.ready === "true" && Boolean(document.querySelector('#inline-writing-body'))`), 'new inline document ready');
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
    const beforeArrival = await writingPosition();
    assert.ok(beforeArrival.top >= 0 && beforeArrival.bottom <= beforeArrival.height, 'the actual writing area is visible before arrival');
    const arrival = 'An independent automatic arrival while writing inline';
    const received = await control({ method: 'agent_message', operation_id: 'inline-native-automatic-arrival', body: arrival, topic_id: facts.topic_id, addressees: [] });
    assert.equal(received.status, 'committed');
    await until(() => p.evaluate(`document.querySelector('#messages').textContent.includes(${JSON.stringify(arrival)})`), 'automatic incoming render without Refresh');
    const afterArrival = await writingPosition();
    assert.deepEqual({ ...afterArrival, top: beforeArrival.top, bottom: beforeArrival.bottom }, beforeArrival, 'arrival preserves body, caret and focus');
    assert.ok(afterArrival.top >= 0 && afterArrival.bottom <= afterArrival.height, 'arrival keeps the writing area in view');
    assert.ok(Math.abs(afterArrival.top - beforeArrival.top) <= 2, 'arrival preserves the visible writing position');
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
}

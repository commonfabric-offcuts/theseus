import assert from 'node:assert/strict';
import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
export const imageInstrumentation = `(()=>{
  window.imagePuts=[];
  const bytes=(x,seen=new Set())=>{if(x instanceof Blob)return x.size;if(!x||typeof x!=='object'||seen.has(x))return 0;seen.add(x);return (x instanceof Map?[...x.keys(),...x.values()]:x instanceof Set?[...x]:Object.values(x)).reduce((n,v)=>n+bytes(v,seen),0)};
  const put=IDBObjectStore.prototype.put;
  IDBObjectStore.prototype.put=function(value,...rest){if(this.name==='editors')imagePuts.push({kind:value.kind,bytes:bytes(value),id:value.id});return put.call(this,value,...rest)};
  window.imageRows=()=>new Promise((resolve,reject)=>{const r=indexedDB.open('aim-next-pending');r.onerror=()=>reject(r.error);r.onsuccess=()=>{const d=r.result,t=d.transaction('editors');t.objectStore('editors').getAll().onsuccess=e=>resolve(e.target.result.map(v=>({...v,blob:v.blob?{size:v.blob.size}:undefined})));t.oncomplete=()=>d.close()}});
})()`;
export async function imageChecks({ check: harnessCheck, page: harnessPage, until, root, facts, view, control, replace, field, shot, observations }) {
  // Every case owns its writing: the drafts an earlier case left (recovery
  // copies' text, retained attachments) are emptied before it starts, as a
  // send leaves them. Its browser storage is a fresh context (the harness).
  const check = (name, action) => harnessCheck(name, async () => { await control({ method: 'reset_drafts' }); await action(); });
  // Messages are newest first, so earlier cases' sends push a source below
  // the fold. Position the actual card before its native press.
  const page = async (...args) => {
    const p = await harnessPage(...args);
    if (p.open) { const open = p.open; p.open = async index => { await p.evaluate(`document.querySelector('#messages [data-id="${facts.sources[index].id}"]').scrollIntoView({block:'center'})`); await open(index); }; }
    return p;
  };
  // The narrow layout is applied by the Reader's media-query listener in the
  // next rendered frame. Until then its panes keep the wide columns, so wait
  // for the Reader's own layout before measuring a target. A Reader already
  // stacked shows that layout before the listener runs; the listener alone
  // hides the layout switch, so the wait holds from either starting layout.
  const narrow = async p => {
    await p.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
    await until(() => p.evaluate('matchMedia("(max-width: 760px)").matches && document.querySelector("#reader").dataset.layout === "stacked" && document.querySelector("#reader-layout").hidden === true'), 'Reader in its narrow layout');
  };
  const png = (await readFile(path.join(root, 'tests/fixtures/media/screen.png'))).toString('base64');
  // Page-owned clipboard payload only: never read/write the OS pasteboard or
  // dispatch Cmd+V. This proves the paste event boundary, not OS ingestion.
  const pasteImage = p => p.evaluate(`(()=>{
    const data=new DataTransfer();data.items.add(new File([Uint8Array.from(atob(${JSON.stringify(png)}),c=>c.charCodeAt(0))],'pasted.png',{type:'image/png'}));
    const event=new ClipboardEvent('paste',{bubbles:true,cancelable:true,clipboardData:data});
    document.querySelector('#writing-body').dispatchEvent(event);return event.defaultPrevented;
  })()`);
  await check('images restoration preview cue opens exact full text and leaves short cards unchanged', async () => {
    const p = await page('preview-cue', null, true);
    const selector = `#messages [data-id="${facts.sources[0].id}"]`;
    assert.match(await p.evaluate(`document.querySelector(${JSON.stringify(selector)}).textContent`), /Open to read the rest/, 'long preview must expose the way to the full message');
    const original = await view('source', facts.sources[0]);
    await p.open(0);
    assert.equal(await p.evaluate('document.querySelector("#source-body").textContent'), original.body);
    await replace(p, 'Short restoration message'); await p.key('Enter', 4);
    const sent = await until(() => p.calls.find(c => c.payload?.kind === 'message.send'), 'short message send');
    const receipt = await view('operation', { operation_id: sent.payload.operation_id });
    assert.equal(receipt.status, 'committed');
    await until(() => p.evaluate('!document.querySelector("#reader").open'), 'send returns to topic');
    // Sending invalidates the topic view itself. Wait for that render instead of
    // racing its scroll-anchor restoration with an unrelated Refresh click.
    const short = `#messages [data-id="${receipt.result.message_id}"]`;
    await until(() => p.box(short), 'short card appears');
    assert.equal(await p.evaluate(`document.querySelector(${JSON.stringify(short)}+' .message-preview').textContent`), 'Short restoration message');
    assert.equal(await p.evaluate(`document.querySelector(${JSON.stringify(short)}).textContent.includes('Open to read the rest')`), false);
    await shot(p, 'restoration-preview-cue'); assert.deepEqual(p.errors, []);
  });
  await check('images restoration paste event preserves source through delayed upload and sends exact bytes once', async () => {
    const p = await page('paste-event', null, true); await p.open(1);
    await replace(p, 'Writing beside a pasted image');
    p.intercept((_payload, event) => event.request.url.endsWith('/api/media/upload'));
    assert.equal(await pasteImage(p), true, 'image paste must be handled without native text insertion');
    const held = await until(() => p.held.find(x => x.event.request.url.endsWith('/api/media/upload')), 'delayed image confirmation');
    assert.equal(await field(p), 'Writing beside a pasted image');
    assert.equal(p.calls.filter(c => c.payload?.kind === 'message.send').length, 0, 'paste sends nothing');
    assert.equal(await p.evaluate('document.querySelector("#send-reply").disabled'), true, 'unconfirmed image cannot be omitted from Send');
    await p.point('#reader-close'); await until(() => p.evaluate('!document.querySelector("#reader").open'), 'close original source');
    await p.open(0); const other = await field(p);
    p.intercept(null); await p.release(held);
    await until(async () => (await view('editor_state', { source_ref: facts.sources[1], topic_id: 't1' })).draft?.attachments.length === 1, 'original draft receives ready attachment');
    assert.equal(await field(p), other, 'late upload cannot change the new source writing');
    assert.equal(await p.evaluate('document.querySelector("#writing-attachments").children.length'), 0, 'late upload cannot attach to the new source');
    await p.point('#reader-close'); await until(() => p.evaluate('!document.querySelector("#reader").open'), 'close second source');
    await p.open(1);
    await until(() => p.evaluate('document.querySelector("#writing-attachments").textContent.includes("Ready")'), 'original pasted image is ready');
    await p.point('#writing-body'); await p.key('e', 2); await p.key('Enter'); await p.send('Input.insertText', { text: 'Second line' });
    const expected = 'Writing beside a pasted image\nSecond line';
    assert.equal(await field(p), expected); await p.key('Enter', 12);
    const sent = await until(() => p.calls.find(c => c.payload?.kind === 'message.send'), 'native send after paste');
    const receipt = await view('operation', { operation_id: sent.payload.operation_id }); assert.equal(receipt.status, 'committed');
    const source = await view('source', { kind: 'message', id: receipt.result.message_id });
    assert.equal(source.body, expected); assert.equal(source.topic_id, 't1'); assert.equal(source.author, facts.actor);
    assert.equal(source.attachments.length, 1);
    assert.equal(source.attachments[0].sha256, createHash('sha256').update(Buffer.from(png, 'base64')).digest('hex'));
    assert.equal(p.calls.filter(c => c.payload?.kind === 'message.send').length, 1);
    await p.point('#reader-close'); await until(() => p.evaluate('!document.querySelector("#reader").open'), 'close sent reader');
    await p.evaluate('document.querySelector("#memory-items .memory-card").scrollIntoView({block:"center"})'); await p.point('#memory-items .memory-card');
    await until(() => p.evaluate('document.querySelector("#reader").open && document.querySelector("#reader-title").textContent === "Image Notebook"'), 'Notebook reader');
    await p.point('#writing-body'); assert.equal(await pasteImage(p), true);
    await until(() => p.evaluate('document.querySelector("#writing-attachments").textContent.includes("Ready")'), 'Notebook reply image ready');
    await until(async () => (await view('editor_state', { source_ref: { kind: 'memory', id: 'fixture-notebook', revision: 1 }, topic_id: 't1' })).draft?.attachments.length === 1, 'Notebook draft saves the ready attachment');
    const captures = p.calls.filter(c => c.payload?.kind === 'media.begin').length;
    await p.point('#toggle-note'); await replace(p, 'Private note'); assert.equal(await pasteImage(p), true);
    assert.match(await p.evaluate('document.querySelector("#reader-notice").textContent'), /private note/i);
    assert.equal(await field(p), 'Private note');
    assert.equal(p.calls.filter(c => c.payload?.kind === 'media.begin').length, captures, 'private-note paste cannot mutate the hidden reply');
    observations.push({ name: 'restoration paste boundary', injected: 'ClipboardEvent + DataTransfer + real File; no system clipboard access', native: 'focus, typing, source navigation and Send', untested: 'OS clipboard ingestion' });
    await shot(p, 'restoration-paste-note-boundary'); assert.deepEqual(p.errors, []);
  });
  await check('images restoration footer controls stay fixed through real typing and save confirmation', async () => {
    const p = await page('footer-stability', null, true); await p.open(1);
    for (const layout of ['stacked', 'wide', 'narrow']) {
      if (layout === 'wide') await p.point('#reader-layout');
      if (layout === 'narrow') await narrow(p);
      await until(() => p.evaluate('document.getAnimations().every(a=>a.playState!=="running")'), 'settled layout');
      p.intercept(payload => payload?.kind === 'draft.save');
      const previousHeld = p.held.length;
      await replace(p, `Footer stability ${layout}`);
      const held = await until(() => p.held.slice(previousHeld).find(x => x.payload?.kind === 'draft.save'), 'delayed save confirmation');
      // The saving sign: its words, and a mark drawn from the palette (a ring
      // while the save to Theseus is under way, the accent once it holds).
      const mark = () => p.evaluate('(s=>({text:s.textContent,state:s.dataset.save,fill:getComputedStyle(s,"::before").backgroundColor,ring:getComputedStyle(s,"::before").borderTopColor,width:getComputedStyle(s,"::before").width,accent:getComputedStyle(document.querySelector("#send-reply")).backgroundColor}))(document.querySelector("#save-state"))');
      await until(() => p.evaluate('document.querySelector("#save-state").textContent === "Saved on this device — saving to Theseus…"'), 'device-saved status');
      const saving = await mark();
      assert.equal(saving.state, 'saving'); assert.equal(saving.fill, 'rgba(0, 0, 0, 0)', 'a ring while the save is under way'); assert.notEqual(saving.ring, 'rgba(0, 0, 0, 0)');
      assert.notEqual(saving.width, '0px', 'the mark is drawn');
      const selectors = ['#add-image', '#send-reply', '#writing-body'];
      const before = await Promise.all(selectors.map(s => p.box(s)));
      await shot(p, `restoration-footer-${layout}-pending`);
      p.intercept(null); await p.release(held);
      await until(() => p.evaluate('document.querySelector("#save-state").textContent === "Saved to Theseus"'), 'server-saved status');
      const saved = await mark();
      assert.equal(saved.state, 'saved'); assert.equal(saved.fill, saved.accent, 'the accent once Theseus holds the writing');
      const after = await Promise.all(selectors.map(s => p.box(s)));
      observations.push({ name: 'footer geometry', layout, before, after });
      for (let i = 0; i < selectors.length; i++) for (const axis of ['x', 'y', 'width', 'height']) {
        assert.ok(Math.abs(before[i][axis] - after[i][axis]) <= 1, `${layout}: ${selectors[i]} ${axis} must stay still across save status changes`);
      }
      for (const b of after) assert.ok(b.width > 0 && b.height > 0 && b.x >= 0 && b.y >= 0 && b.x + b.width <= b.viewportWidth && b.y + b.height <= b.viewportHeight, 'writing and controls remain visible');
      assert.equal(await field(p), `Footer stability ${layout}`);
      await shot(p, `restoration-footer-${layout}-saved`);
    }
    assert.equal(p.calls.filter(c => c.payload?.kind === 'message.send').length, 0, 'typing and save redraws cannot send');
    assert.deepEqual(p.errors, []);
  });
  await check('images restoration footer touch gap does nothing and deliberate Send works', async () => {
    const p = await page('footer-touch', null, true); await p.open(1);
    await narrow(p);
    await until(() => p.evaluate('document.getAnimations().every(a=>a.playState!=="running")'), 'settled narrow reader');
    await replace(p, 'Footer touch narrow');
    await until(() => p.evaluate('document.querySelector("#save-state").textContent === "Saved to Theseus"'), 'touch fixture saved');
    const add = await p.box('#add-image'), send = await p.box('#send-reply');
    const touch = async (x, y) => {
      await p.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
      await p.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    };
    const gap = (add.x + add.width + send.x) / 2, y = send.y + send.height / 2;
    assert.ok(gap > add.x + add.width && gap < send.x, 'a real gap separates the actions');
    await p.send('Page.setInterceptFileChooserDialog', { enabled: true });
    const chooserCount = p.events.filter(e => e.method === 'Page.fileChooserOpened').length;
    await p.evaluate(`(()=>{window.footerContacts=[];for(const type of ['touchstart','pointerdown','click']) document.addEventListener(type,e=>footerContacts.push({type,target:e.target.id,x:e.clientX,y:e.clientY,touches:e.touches?[...e.touches].map(t=>({x:t.clientX,y:t.clientY})):null}),true)})()`);
    await touch(gap, y);
    const bodyAfterGap = await field(p);
    let gapReceipt = null, gapSource = null;
    if (bodyAfterGap !== 'Footer touch narrow') {
      const act = await until(() => p.calls.find(c => c.payload?.kind === 'message.send'), 'unexpected gap send receipt');
      gapReceipt = await view('operation', { operation_id: act.payload.operation_id });
      if (gapReceipt.status === 'committed') gapSource = await view('source', { kind: 'message', id: gapReceipt.result.message_id });
    }
    observations.push({ name: 'footer gap contact', add, send, gap, y, events: await p.evaluate('footerContacts'), sends: p.calls.filter(c => c.payload?.kind === 'message.send').length, gapReceipt, gapSource });
    assert.equal(bodyAfterGap, 'Footer touch narrow');
    assert.equal(p.calls.filter(c => c.payload?.kind === 'message.send').length, 0, 'touching the gap does not send');
    assert.equal(p.events.filter(e => e.method === 'Page.fileChooserOpened').length, chooserCount, 'touching the gap does not choose an image');
    await touch(add.x + add.width + 2, add.y + add.height / 2);
    assert.equal(await field(p), 'Footer touch narrow');
    assert.equal(p.calls.filter(c => c.payload?.kind === 'message.send').length, 0, 'an Add image edge touch cannot send');
    // While an image is being chosen the footer says why Send waits, and at a
    // phone's width, under the Whisper/Tell/Ask row and a reply under review,
    // the writing pane scrolls to its Cancel as a person would.
    if (await p.evaluate('!document.querySelector("#cancel-image").hidden')) {
      await p.evaluate('document.querySelector("#cancel-image").scrollIntoView({block:"nearest"})');
      await p.point('#cancel-image');
    }
    await shot(p, 'restoration-footer-touch');
    const sendAfterEdge = await p.box('#send-reply');
    await touch(sendAfterEdge.x + sendAfterEdge.width / 2, sendAfterEdge.y + sendAfterEdge.height / 2);
    const sent = await until(() => p.calls.find(c => c.payload?.kind === 'message.send'), 'deliberate touch Send');
    const receipt = await view('operation', { operation_id: sent.payload.operation_id }); assert.equal(receipt.status, 'committed');
    const source = await view('source', { kind: 'message', id: receipt.result.message_id });
    assert.equal(source.body, 'Footer touch narrow'); assert.equal(source.topic_id, 't1');
    assert.equal(p.calls.filter(c => c.payload?.kind === 'message.send').length, 1);
    observations.push({ name: 'narrow touch boundaries', gapNoAction: true, deliberateSend: receipt.result.message_id });
    assert.deepEqual(p.errors, []);
  });
  const model = async (p, actual = false) => p.evaluate(`(async()=>{
    const {Api}=await import('/api.mjs'), {EditorRegistry}=await import('/app-session.mjs');
    window.api=new Api(${JSON.stringify(facts.token)});window.boot=await api.bootstrap();
    window.r=new EditorRegistry({api,bootstrap:boot,journal:j,saveDelayMs:30000,maxSaveDelayMs:60000});
    window.e=${actual ? ` (await r.open(${JSON.stringify(facts.sources[1])},{topicId:'t1'})).editors.reply` : `await r.register(context,{id:'capture-model',revision:0,generation:'g'})`};
    window.u=r.sessionFor(e).uploads;window.file=new File([Uint8Array.from(atob(${JSON.stringify(png)}),c=>c.charCodeAt(0))],'retained.png',{type:'image/png'});
  })()`);
  await check('images X1 passive canonical refs remain visible and allow ordinary IDB recovery', async () => {
    const a = await page('passive-ref-writer'); await model(a, true);
    await a.evaluate("(async()=>{e.edit({body:'Canonical image draft'});await u.add(file);await r.flush(e);await r.cleanup.own(r.sessionFor(e));r.cancelSave(e)})()");
    const remote = await view('editor_state', {source_ref:facts.sources[1],topic_id:'t1'});
    assert.equal(remote.draft.attachments.length, 1);
    // Keep an ordinary text-only manifest (format 1) through the real journal.
    await a.evaluate("(async()=>{const {Editor}=await import('/editor.mjs');const other=new Editor(e.context,e.draft);other.edit({body:'Recovered ordinary writing'});await j.save(other.snapshot());r.dispose()})()");
    await a.close();
    const b = await page('passive-ref-reader', null, true); await b.open(1);
    assert.match(await b.evaluate('document.querySelector("#writing-attachments").textContent'), /retained.png.*Ready/);
    assert.equal(await b.evaluate('[...document.querySelectorAll("#writing-attachments button")].some(b=>b.textContent==="Remove")'), true);
    const rows = await b.evaluate('imageRows()');
    assert.equal(rows.filter(row => row.active === 1 && row.editorKey?.includes('"reply"')).length, 1, 'passive reading creates no new adoption target');
    await b.point('#review-versions');
    await until(() => b.evaluate('[...document.querySelectorAll("#review-content button")].some(b=>b.textContent==="Recover this version")'), 'ordinary copy action');
    await b.evaluate('[...document.querySelectorAll("#review-content button")].find(b=>b.textContent==="Recover this version").id="ordinary-recover"');
    assert.equal(await b.evaluate('document.querySelector("#ordinary-recover").disabled'), false);
    await b.point('#ordinary-recover');
    await until(() => b.evaluate('!document.querySelector("#version-review").open'), 'actual IDB adoption commits');
    assert.equal(await field(b), 'Recovered ordinary writing');
    await shot(b, 'passive-canonical-adoption'); await b.close();
  });
  await check('images X2 two tabs can keep current writing without publishing refused A', async () => {
    const a = await page('refused-a-writer'); await model(a, true);
    await a.evaluate("(async()=>{e.edit({body:'Frozen A never publish'});await u.add(file);await r.flush(e);await r.cleanup.own(r.sessionFor(e));r.cancelSave(e)})()");
    const b = await page('current-b-reader', null, true); await b.open(1);
    // Hold the typing deadline, not the server slot: the explicit Send still
    // performs its real save. This pins discovery before B autosaves over A.
    await b.evaluate('(()=>{const timer=window.setTimeout;window.setTimeout=(fn,ms,...args)=>timer(fn,ms===450?30000:ms===2000?60000:ms,...args)})()');
    await until(() => b.evaluate('!document.querySelector("#previous-message").disabled'), 'neighbor reads complete');
    const refused = await a.evaluate("(async()=>{const command=api.command.bind(api);api.command=envelope=>command(envelope.kind==='submission.prepare'?{...envelope,args:{...envelope.args,body:'different echoed body'}}:envelope);const foreground=r.cleanup.foreground();try{const item=await r.send(e,{stay:true});r.cancelSave(e);return item}finally{foreground.release()}})()");
    assert.equal(refused.status, 'refused'); assert.equal(refused.receipt.recorded, true);
    assert.equal(refused.receipt.error.code, 'REVISION_CONFLICT');
    await a.close();
    await replace(b, 'Current B goes alone');
    await b.point('#review-versions');
    await until(() => b.evaluate('[...document.querySelectorAll("#review-content button")].some(b=>b.textContent==="Keep current writing")'), 'explicit keep-current choice');
    assert.equal(await b.evaluate('document.querySelector("#send-reply").disabled'), true);
    await b.evaluate('[...document.querySelectorAll("#review-content button")].find(b=>b.textContent==="Keep current writing").id="keep-current-refusal"');
    await b.point('#keep-current-refusal');
    await until(() => b.evaluate('document.querySelector("#review-status").textContent.includes("Current writing kept")'), 'keep-current inspection committed');
    await b.point('#review-close');
    assert.equal(await field(b), 'Current B goes alone');
    assert.equal(await b.evaluate('document.querySelector("#send-reply").disabled'), false);
    await b.point('#writing-body'); await b.key('Enter', 12);
    const sent = await until(() => b.calls.find(c=>c.payload?.kind==='message.send'), 'current B sent');
    const receipt = await view('operation',{operation_id:sent.payload.operation_id}); assert.equal(receipt.status,'committed');
    const source = await view('source',{kind:'message',id:receipt.result.message_id}); assert.equal(source.body,'Current B goes alone');
    const neverSent = await view('operation',{operation_id:refused.sendOperationId}); assert.equal(neverSent.recorded,false);
    assert.ok((await b.evaluate('imageRows()')).some(row=>row.snapshot?.submissions.some(item=>item.id===refused.id && item.status==='refused')), 'old refused snapshot stays recoverable');
    observations.push({name:'X2 schedule', setup:'real Store refusal via mismatching echoed body; own cleanup reserved during refusal; B autosave timer held to pin exact A revision', interaction:'native typing, Review versions, Keep current writing, Cmd-Shift-Return'});
    await shot(b, 'current-writing-sent'); await b.close();
  });
  await check('images X4 mid-read reload keeps unknown remote and explicit Review Retry', async () => {
    const a = await page('unknown-remote-writer'); await model(a, true);
    await a.evaluate("(async()=>{e.edit({body:'Refused A image reply'});await u.add(file);await r.flush(e);await r.cleanup.own(r.sessionFor(e));r.cancelSave(e);window.foreground=r.cleanup.foreground();const command=api.command.bind(api),view=api.view.bind(api);api.command=envelope=>command(envelope.kind==='submission.prepare'?{...envelope,args:{...envelope.args,body:'different echoed body'}}:envelope);api.view=(name,args)=>name==='editor_state'?(window.conflictReadStarted=true,new Promise(()=>{})):view(name,args);window.sending=r.send(e,{stay:true});e.edit({body:'Current B survives reload'})})()");
    await until(() => a.evaluate('window.conflictReadStarted===true'), 'conflict read held after refusal');
    const stored = await a.evaluate('(await j.own(e.key)).snapshot');
    assert.equal(stored.conflict.attempted.body, 'Current B survives reload');
    assert.equal(Object.hasOwn(stored.conflict, 'remote'), false);
    await a.close();
    const b = await page('unknown-remote-reader', null, true); await b.open(1); await b.point('#review-versions');
    await until(() => b.evaluate('[...document.querySelectorAll("#review-content button")].some(b=>b.textContent==="Recover this version")'), 'unknown copy recovery');
    await b.evaluate('[...document.querySelectorAll("#review-content button")].find(b=>b.textContent==="Recover this version").id="unknown-recover"');
    await b.point('#unknown-recover'); await until(() => b.evaluate('!document.querySelector("#version-review").open'), 'unknown comparison restored');
    assert.equal(await field(b), 'Current B survives reload');
    assert.equal(await b.evaluate('document.querySelector("#send-reply").disabled'), true);
    b.intercept(payload => payload?.name==='editor_state');
    await b.point('#review-versions'); const held = await until(() => b.held[0], 'unknown remote reread');
    await b.send('Fetch.fulfillRequest', {requestId:held.event.requestId,responseCode:200,responseHeaders:[{name:'Content-Type',value:'application/json'}],body:Buffer.from(JSON.stringify({error:{code:'SERVER_BUSY',message:'Typed busy read'}})).toString('base64')});
    await until(() => b.evaluate('!document.querySelector("#review-retry").hidden'), 'unknown read finished with Retry');
    assert.equal(await b.evaluate('document.querySelector("#review-content").textContent.includes("Saved version unavailable")'), true, 'unknown must not be painted as confirmed none');
    assert.equal(await b.evaluate('document.querySelector("#review-content").textContent.includes("No saved version here")'), false);
    await shot(b, 'unknown-remote-comparison'); b.intercept(null); await b.point('#review-retry');
    await until(() => b.evaluate('document.querySelector("#review-content").textContent.includes("Refused A image reply")'), 'explicit retry reads saved remote');
    assert.equal(await field(b), 'Current B survives reload');
    assert.equal(await b.evaluate('document.querySelector("#send-reply").disabled'), true);
    assert.equal(b.calls.filter(c=>c.payload?.kind==='message.send').length,0);
    observations.push({name:'X4 interruption', setup:'real recorded refusal; close owning tab mid read after durable block; typed HTTP200 error injected only for explicit Review', proof:'native recovery and Retry preserve B; Send stays blocked; no publication'});
    await b.close();
  });
  await check('images X3 readonly recovery rejects native terminal edits and synthetic fallback input', async () => {
    const a = await page('readonly-writer'); await model(a, true);
    await a.evaluate("(async()=>{e.edit({body:'Saved writing stays intact'});await r.flush(e);await u.add(file,{start:false});r.cancelSave(e)})()");
    await a.close();
    const b = await page('readonly-reader', null, true); await b.open(1);
    assert.equal(await b.evaluate('document.querySelector("#writing-body").readOnly'), true);
    const original = await field(b);
    await b.point('#writing-body'); await b.key('ArrowRight', 4); await b.key('u', 2);
    assert.equal(await field(b), original, 'native Ctrl-U must not alter a read-only recovery draft');
    await b.key('w', 2); await b.key('k', 2); assert.equal(await field(b), original);
    await b.evaluate('(()=>{const f=document.querySelector("#writing-body");f.setRangeText("injected",0,f.value.length,"end");f.dispatchEvent(new Event("input",{bubbles:true}))})()');
    assert.equal(await field(b), original, 'injected fallback input also cannot change read-only writing');
    await b.key('Tab'); assert.notEqual(await b.evaluate('document.activeElement.id'), 'writing-body');
    await b.point('#toggle-note'); await replace(b, 'Private note remains editable');
    await b.point('#toggle-note'); assert.equal(await field(b), original);
    await b.point('#review-versions');
    await until(() => b.evaluate('[...document.querySelectorAll("#review-content button")].some(b=>b.textContent==="Recover this version")'), 'recovery choice');
    assert.equal(await b.evaluate('[...document.querySelectorAll("#review-content button")].find(b=>b.textContent==="Recover this version").disabled'), false);
    observations.push({name:'X3 input boundary', native:'Ctrl-U/W/K, Tab, private-note typing', injected:'setRangeText + input exercises fallback boundary, not a native gesture'});
    await shot(b, 'readonly-recovery'); await b.close();
  });
  await check('images keyboard chooser file assignment and exact send retain the Reader', async () => {
    const p = await page('images-main', null, true); await p.open(1);
    assert.ok(await p.box('#add-image'), 'Add image must be visible and discoverable');
    await p.point('#writing-body');
    for (let i = 0; i < 12 && await p.evaluate('document.activeElement.id') !== 'add-image'; i++) await p.key('Tab');
    assert.equal(await p.evaluate('document.activeElement.id'), 'add-image');
    await p.send('Page.setInterceptFileChooserDialog', { enabled: true });
    await p.key('Enter');
    const chooser = await until(() => p.events.find(e => e.method === 'Page.fileChooserOpened'), 'native file chooser activation');
    // Interception proves browser assignment, not the OS dismiss gesture.
    await p.send('DOM.setFileInputFiles', { backendNodeId: chooser.params.backendNodeId, files: [path.join(root, 'tests/fixtures/media/screen.png')] });
    await until(() => p.evaluate('document.querySelector("#writing-attachments .image-choice span")?.textContent === "screen.png · Ready"'), 'ready image chip names its file');
    const captured = await p.evaluate('imagePuts');
    assert.equal(captured.filter(x => x.bytes > 0).length, 1);
    assert.ok(captured.every(x => !x.bytes || x.kind === 'upload-bytes-v1'));
    await p.point('#source-body span:first-child'); await p.key('Enter');
    assert.match(await field(p), /^> Source 1 exact passage/); await p.key('z', 4); assert.equal(await field(p), '', 'native quote Undo remains intact');
    await replace(p, 'Reply with the selected image');
    await p.key('Enter'); await p.send('Input.insertText', { text: 'second line' });
    assert.equal(await field(p), 'Reply with the selected image\nsecond line');
    await p.point('#toggle-note'); await replace(p, 'Private note keeps its own writing');
    assert.equal(await p.evaluate('document.querySelector("#add-image").hidden'), true);
    await p.point('#toggle-note'); assert.equal(await field(p), 'Reply with the selected image\nsecond line');
    assert.ok((await p.evaluate('document.querySelector("#writing-attachments").textContent')).includes('screen.png'));
    await p.point('#add-image'); await until(() => p.evaluate('!document.querySelector("#cancel-image").hidden'), 'visible picker release');
    await p.point('#cancel-image'); assert.equal(await p.evaluate('document.querySelector("#cancel-image").hidden'), true);
    observations.push({ name: 'picker dismissal', evidence: 'Visible Cancel image selection clicked natively. OS picker dismissal remains unproved.' });
    await p.point('#reader-close');
    await until(() => p.evaluate('!document.querySelector("#reader").open'), 'reader fully closed before reopening');
    await p.open(1);
    assert.equal(await field(p), 'Reply with the selected image\nsecond line');
    await shot(p, 'image-ready'); await p.point('#writing-body'); await p.key('Enter', 12);
    const sent = await until(() => p.calls.find(c => c.payload?.kind === 'message.send'), 'actual image reply send');
    const receipt = await view('operation', { operation_id: sent.payload.operation_id }); assert.equal(receipt.status, 'committed');
    const source = await view('source', { kind: 'message', id: receipt.result.message_id });
    assert.equal(source.body, 'Reply with the selected image\nsecond line'); assert.equal(source.attachments.length, 1);
    assert.equal(source.attachments[0].name, 'screen.png');
    assert.ok((await p.evaluate('imagePuts')).every(x => !x.bytes || x.kind === 'upload-bytes-v1'));
    await until(async () => !(await p.evaluate('imageRows()')).some(r => r.kind === 'upload-bytes-v1'), 'actual byte-row retirement');
    await p.point('#reader-close'); await until(() => p.evaluate('!document.querySelector("#reader").open'), 'sent reader closes');
    // The committed send refreshes the list; wait for it before positioning the
    // real card. Refresh is not this check's action and may be offscreen.
    const sentCard = '#messages [data-id="' + receipt.result.message_id + '"]';
    await until(() => p.box(sentCard), 'sent message is discoverable');
    await p.evaluate(`document.querySelector(${JSON.stringify(sentCard)}).scrollIntoView({block:'center'})`);
    await p.point(sentCard);
    await until(() => p.evaluate('document.querySelector("#reader").open && Boolean(document.querySelector("#source-attachments button"))'), 'sent image Open action');
    await p.point('#source-attachments button');
    await until(() => p.evaluate('document.querySelector("#source-attachments img")?.naturalWidth > 0'), 'exact sent bytes rendered');
    await shot(p, 'image-opened');
    assert.deepEqual(p.errors, []);
  });
  await check('images close pressed while an image is being chosen keeps the Reader open and says why', async () => {
    // Its own browser context, and no writing saved to the shared fixture, so
    // later cases on the same source see nothing of it.
    const p = await page('images-close-refused', null, true); await p.open(1);
    const writing = await field(p);
    await p.send('Page.setInterceptFileChooserDialog', { enabled: true });
    await p.point('#add-image'); await until(() => p.evaluate('!document.querySelector("#cancel-image").hidden'), 'image selection reserved');
    await until(() => p.events.find(e => e.method === 'Page.fileChooserOpened'), 'native file chooser activation');
    assert.deepEqual(await p.evaluate("({hidden:document.querySelector('#reader-notice').hidden,text:document.querySelector('#reader-notice').textContent})"), { hidden: true, text: '' });
    await p.point('#reader-close');
    await until(() => p.evaluate('document.querySelector("#reader-notice").textContent === "Keep this page open until the selected image is saved or removed."'), 'the refused close says why');
    assert.equal(await p.evaluate('document.querySelector("#reader").open'), true, 'the Reader stays open');
    assert.equal(await field(p), writing);
    await p.point('#cancel-image');
    await p.point('#reader-close'); await until(() => p.evaluate('!document.querySelector("#reader").open'), 'close once the selection is released');
    assert.deepEqual(p.errors, []);
  });
  for (const failure of ['abort', 'quota']) {
    await check(`images atomic capture ${failure} preserves text and never dispatches bytes`, async () => {
      const p = await page('image-' + failure);
      await p.evaluate(imageInstrumentation);
      await p.evaluate(`(async()=>{
        const {Api}=await import('/api.mjs'), {EditorRegistry}=await import('/app-session.mjs');
        window.api=new Api(${JSON.stringify(facts.token)});window.boot=await api.bootstrap();
        window.r=new EditorRegistry({api,bootstrap:boot,journal:j,saveDelayMs:30000,maxSaveDelayMs:60000});
        window.e=await r.register(context,{id:'capture-${failure}',revision:0,generation:'g'});
        window.u=r.sessionFor(e).uploads;e.edit({body:'Protected before image'});await r.edited(e);
        window.captureDispatches=[];
        for(const method of ['command','upload']){const original=api[method].bind(api);api[method]=(...args)=>{captureDispatches.push(method);return original(...args)}}
      })()`);
      if (failure === 'abort') await p.evaluate(`(()=>{const put=IDBObjectStore.prototype.put;IDBObjectStore.prototype.put=function(value,...rest){const result=put.call(this,value,...rest);if(value.snapshot?.uploadState?.entries.some(e=>e.bytes_ref))this.transaction.abort();return result}})()`);
      else {
        const usage = await p.send('Storage.getUsageAndQuota', { origin: facts.origin });
        await p.send('Storage.overrideQuotaForOrigin', { origin: facts.origin, quotaSize: usage.usage + 65536 });
        await p.evaluate('r.cancelSave(e)');
        // Chromium BucketContext caches space allowances for 30 seconds.
        // Override readback alone is not evidence that a write consults it.
        await new Promise(resolve => setTimeout(resolve, 31000));
      }
      const actual = await p.evaluate(`(async()=>{const bytes=new Uint8Array(8*1024*1024);for(let i=0;i<bytes.length;i+=65536)crypto.getRandomValues(bytes.subarray(i,i+65536));try{window.selection=await u.add(new File([bytes],'quota.png',{type:'image/png'}),{start:${failure === 'abort'}})}catch(error){window.captureError=error.message;window.selection=u.current().at(-1).selection_id}return u.status(selection)})()`);
      observations.push({name:'quota observation '+failure,actual,estimate:await p.evaluate('navigator.storage.estimate()'),usage:await p.send('Storage.getUsageAndQuota',{origin:facts.origin})});
      assert.match(actual, /not saved/i);
      assert.deepEqual(await p.evaluate('captureDispatches'), [], 'failed capture dispatches neither command nor bytes');
      let rows = await p.evaluate('imageRows()');
      assert.equal(rows.filter(row => row.kind === 'upload-bytes-v1' && row.editorKey.includes('journal-image-' + failure)).length, 0, 'actual store enumeration detects orphan byte rows');
      if (failure === 'quota') await p.send('Storage.overrideQuotaForOrigin', { origin: facts.origin });
      await p.evaluate(`(async()=>{e.edit({body:'Newest text after byte refusal'});await r.edited(e)})()`);
      assert.equal(await p.evaluate('(await j.own(e.key)).snapshot.draft.body'), 'Newest text after byte refusal');
      const before = await p.evaluate('imagePuts.filter(x=>x.bytes).length');
      await p.evaluate('u.remove(selection)');
      assert.equal(await p.evaluate('imagePuts.filter(x=>x.bytes).length'), before, 'Remove never retries failed bytes');
      assert.ok((await p.evaluate('imagePuts')).every(x => !x.bytes || x.kind === 'upload-bytes-v1'));
      if (failure === 'quota') await p.send('Storage.overrideQuotaForOrigin', { origin: facts.origin });
      await p.evaluate('(()=>{r.dispose();j.close()})()');
      observations.push({ name: 'capture ' + failure, actual, bytePutAttempts: before, scope: 'real IDB transaction/controller; not a native file selection claim' });
    });
  }

  await check('images lost publication reload and repeated adoption retain one byte owner', async () => {
    const a = await page('images-reload-a', null, true); await a.open(0);
    await replace(a, 'Saved text with an image still being confirmed');
    await until(async () => (await view('editor_state', { source_ref: facts.sources[0], topic_id: 't1' })).draft?.body === 'Saved text with an image still being confirmed', 'acknowledged text control');
    a.intercept((_payload, event) => event.request.url.endsWith('/api/media/upload'));
    await a.send('Page.setInterceptFileChooserDialog', { enabled: true }); await a.point('#add-image');
    const chooser = await until(() => a.events.find(e => e.method === 'Page.fileChooserOpened'), 'reload file chooser');
    await a.send('DOM.setFileInputFiles', { backendNodeId: chooser.params.backendNodeId, files: [path.join(root, 'tests/fixtures/media/screen.png')] });
    await until(() => a.held.find(e => e.event.request.url.endsWith('/api/media/upload')), 'held real publication response');
    const rowsA = await a.evaluate('imageRows()');
    const ownerA = rowsA.find(row => row.active === 1 && row.snapshot?.context.kind === 'reply' && row.snapshot.sourceRef.id === facts.sources[0].id);
    const byte = rowsA.find(row => row.kind === 'upload-bytes-v1' && row.id === ownerA?.snapshot.uploadState?.entries.find(e => e.selected)?.bytes_ref);
    assert.ok(byte); await a.close();
    let previous;
    for (const suffix of ['b','c']) {
      const p = await page('images-reload-' + suffix, null, true); await p.open(0);
      assert.equal(await p.evaluate('document.querySelector("#writing-body").readOnly'), true);
      const before = p.calls.length; await p.point('#writing-body'); await p.key('Enter', 12);
      assert.equal(await field(p), 'Saved text with an image still being confirmed', 'the central send gate must not freeze acknowledged text while recovery is unresolved');
      assert.equal(p.calls.slice(before).filter(c => ['submission.prepare','message.send'].includes(c.payload?.kind)).length, 0);
      await p.point('#toggle-note'); await p.point('#toggle-note');
      await p.point('#review-versions');
      await until(() => p.evaluate('[...document.querySelectorAll("#review-content button")].some(b=>b.textContent==="Recover this version"&&!b.disabled)'), 'recover remains reachable after note toggle');
      await p.evaluate('[...document.querySelectorAll("#review-content button")].find(b=>b.textContent==="Recover this version"&&!b.disabled).dataset.imageRecover=""');
      await p.point('[data-image-recover]');
      await until(() => p.evaluate('!document.querySelector("#version-review").open'), 'image copy adopted');
      const rows = await p.evaluate('imageRows()');
      assert.equal(rows.filter(r => r.kind === 'upload-bytes-v1' && r.id === byte.id).length, 1);
      assert.equal(rows.filter(r => r.snapshot?.uploadState?.entries.some(e => e.bytes_ref === byte.id)).length, 1, 'superseded history owns no byte pointer');
      assert.equal((await p.evaluate('imagePuts')).filter(x => x.bytes).length, 0, 'adoption never re-puts bytes');
      if (suffix === 'b') await p.close(); else previous = p;
    }
    const p = previous;
    const checkIndex = await p.evaluate('[...document.querySelectorAll("#writing-attachments button")].findIndex(b=>b.textContent==="Check confirmation")');
    assert.ok(checkIndex >= 0);
    const before = p.calls.length;
    await p.point(`#writing-attachments button:nth-of-type(${checkIndex + 1})`);
    await until(() => p.evaluate('document.querySelector("#writing-attachments").textContent.includes("Ready")'), 'original ready response recovered');
    assert.ok(p.calls.slice(before).every(c => !c.url.endsWith('/api/command') && !c.url.endsWith('/api/media/upload')));
    await p.point('#writing-body'); await p.key('Enter', 12);
    const sent = await until(() => p.calls.find(c => c.payload?.kind === 'message.send'), 'recovered image sent');
    const receipt = await view('operation', { operation_id: sent.payload.operation_id });
    const source = await view('source', { kind: 'message', id: receipt.result.message_id }); assert.equal(source.attachments.length, 1);
    await until(async () => !(await p.evaluate('imageRows()')).some(r => r.kind === 'upload-bytes-v1' && r.id === byte.id), 'adopted byte row retires after exact send');
    await shot(p, 'image-recovered'); assert.deepEqual(p.errors, []);
  });

  for (const branch of ['own', 'abandoned']) await check(`images ${branch} metadata deletion refuses an owned byte pointer`, async () => {
    const a = await page('image-delete-' + branch); await model(a);
    await a.evaluate('u.add(file,{start:false})');
    const owner = await a.evaluate('j.own(e.key)'), bytesId = owner.snapshot.uploadState.entries[0].bytes_ref;
    if (branch === 'own') {
      assert.equal(await a.evaluate(`j.removeExact(e.key,${JSON.stringify(owner.stamp)})`), false);
      assert.ok(await a.evaluate(`readRow(${JSON.stringify(owner.id)})`));
      assert.ok(await a.evaluate(`readRow(${JSON.stringify(bytesId)})`));
      await a.evaluate('r.dispose()');
    } else {
      await a.close(); const b = await page('image-delete-' + branch);
      assert.equal(await b.evaluate(`j.retireAcknowledged(editor.key,${JSON.stringify(owner)},async()=>true)`), false);
      assert.ok(await b.evaluate(`readRow(${JSON.stringify(owner.id)})`));
      assert.ok(await b.evaluate(`readRow(${JSON.stringify(bytesId)})`));
    }
  });

  await check('images abandoned canonical copy retires on explicit review without adoption', async () => {
    const a = await page('image-abandoned-ready-a'); await a.evaluate(imageInstrumentation); await model(a, true);
    await a.evaluate(`(()=>{r.cleanup.own=async()=>false;r.cleanup.request=()=>{};})()`);
    await a.evaluate(`(async()=>{e.edit({body:'Canonical image copy'});await u.add(file);await r.flush(e)})()`);
    const row = await a.evaluate('j.own(e.key)'), bytesId = row.snapshot.uploadState.entries[0].bytes_ref;
    assert.ok(bytesId); assert.ok(await a.evaluate(`readRow(${JSON.stringify(bytesId)})`));
    await a.close();
    const b = await page('image-abandoned-ready-b'); await b.evaluate(imageInstrumentation); await model(b, true);
    // Initial open gives foreground source reads priority. The existing
    // Review versions refresh performs the deferred canonical proof.
    assert.equal(await b.evaluate('e.recoveryDiscovery'), true);
    assert.equal(await b.evaluate('u.current().length'), 1, 'canonical ref is represented before retirement clears discovery');
    assert.equal(await b.evaluate('u.pending()'), true);
    await b.evaluate('r.recoveryCandidates(e)');
    assert.equal(await b.evaluate(`readRow(${JSON.stringify(row.id)})`), null);
    assert.equal(await b.evaluate(`readRow(${JSON.stringify(bytesId)})`), null);
    assert.equal(await b.evaluate('e.recoveryDiscovery'), false);
    assert.equal(await b.evaluate('imagePuts.filter(x=>x.bytes).length'), 0, 'retirement/import never copies the old bytes');
    assert.equal(await b.evaluate('e.draft.body'), 'Canonical image copy');
    assert.equal(await b.evaluate('e.draft.attachments.length'), 1);
    assert.equal(await b.evaluate('u.current()[0].ready_descriptor.media_id === e.draft.attachments[0].id'), true);
    assert.equal(await b.evaluate('u.pending()'), false);
    assert.equal(await b.evaluate('(await j.own(e.key)) ?? null'), null, 'retirement validation creates no passive journal target');
    await b.evaluate('r.dispose()');
  });

  await check('images adoption final transaction rejects a replaced registered session', async () => {
    const a = await page('image-adopt-inner-a'); await model(a, true); await a.evaluate('u.add(file,{start:false})');
    const original = await a.evaluate('j.own(e.key)'); await a.close();
    const b = await page('image-adopt-inner-b'); await model(b, true);
    await b.evaluate(`(()=>{
      window.guardHit=false;const get=IDBObjectStore.prototype.get;
      IDBObjectStore.prototype.get=function(key){const request=get.call(this,key);
        if(this.name==='editors'&&this.transaction.mode==='readwrite'&&key===j.id(e.key))request.addEventListener('success',()=>{window.guardHit=true;r.sessions.delete(e.key)},{once:true});
        return request;
      };
    })()`);
    const answer = await b.evaluate(`(async()=>{try{await r.adoptCandidate(e,${JSON.stringify(original)},r.current);return null}catch(error){return error.message}})()`);
    assert.equal(await b.evaluate('guardHit'), true, 'instrument reaches the inner guard after outer validation');
    assert.match(answer ?? '', /writing|changed/i);
    assert.equal(await b.evaluate('readRow(j.id(e.key))'), null, 'no stale adoption target is written');
    const old = await b.evaluate(`readRow(${JSON.stringify(original.id)})`);
    assert.equal(old.active, 1); assert.equal(old.snapshot.uploadState.entries[0].bytes_ref, original.snapshot.uploadState.entries[0].bytes_ref);
    await b.evaluate('r.dispose()');
  });

  await check('images every-put instrument detects a Blob hidden in metadata', async () => {
    const p = await page('image-byte-detector'); await p.evaluate(imageInstrumentation);
    await p.evaluate(`putRow({id:'image-byte-detector-only',snapshot:{nested:new Map([['blob',new Blob(['counterfactual'])]])}})`);
    const puts = await p.evaluate('imagePuts');
    assert.throws(() => assert.ok(puts.every(row => !row.bytes || row.kind === 'upload-bytes-v1')));
    assert.equal(puts.at(-1).bytes, 14);
  });

  await check('images Remove moves focus to Add image only while the person has not moved it', async () => {
    const p = await page('remove-focus', null, true); await p.open(1);
    await replace(p, 'Writing kept through Remove');
    const choose = async () => {
      const n = p.events.length; await p.send('Page.setInterceptFileChooserDialog', { enabled: true }); await p.point('#add-image');
      const event = await until(() => p.events.slice(n).find(e => e.method === 'Page.fileChooserOpened'), 'reply chooser');
      await p.send('DOM.setFileInputFiles', { backendNodeId: event.params.backendNodeId, files: [path.join(root, 'tests/fixtures/media/screen.png')] });
      await until(() => p.evaluate('document.querySelector("#writing-attachments .image-choice span")?.textContent === "screen.png · Ready" && [...document.querySelectorAll("#writing-attachments button")].some(b=>b.textContent==="Remove"&&!b.disabled)'), 'ready image with Remove');
      await p.evaluate('[...document.querySelectorAll("#writing-attachments button")].find(b=>b.textContent==="Remove").dataset.imageRemove=""');
    };
    // Another tab of this person holds the recovery store, so Remove's strict
    // write finishes only after the person has clicked back into the writing.
    await choose();
    const holder = await page('remove-focus-holder');
    await holder.evaluate(`new Promise((resolve,reject)=>{const r=indexedDB.open('aim-next-pending');r.onerror=()=>reject(r.error);r.onsuccess=()=>{const d=r.result,t=d.transaction('editors','readwrite',{durability:'strict'}),s=t.objectStore('editors');window.release=false;const keep=()=>{if(!window.release)s.get('remove-focus-hold').onsuccess=keep};keep();t.oncomplete=()=>{d.close();window.released=true};resolve()}})`);
    await p.point('[data-image-remove]');
    assert.equal(await p.evaluate('Boolean(document.querySelector("[data-image-remove]")?.isConnected)'), true, 'Remove is still writing behind the held store');
    await p.point('#writing-body');
    await holder.evaluate('window.release=true');
    await until(() => holder.evaluate('window.released===true'), 'held store released');
    await until(() => p.evaluate('!document.querySelector("#writing-attachments").textContent.includes("screen.png")'), 'Remove finished');
    await p.evaluate('new Promise(resolve=>setTimeout(resolve,0))');
    assert.equal(await p.evaluate('document.activeElement.id'), 'writing-body', 'a finished Remove leaves focus where the person put it');
    await replace(p, 'Typed after a late Remove');
    // Untouched, focus leaves the removed button for Add image.
    await choose(); await p.point('[data-image-remove]');
    await until(() => p.evaluate('!document.querySelector("#writing-attachments").textContent.includes("screen.png")'), 'second Remove finished');
    await until(() => p.evaluate('document.activeElement.id === "add-image"'), 'focus on Add image after an untouched Remove');
    assert.equal(await field(p), 'Typed after a late Remove');
    assert.equal(p.calls.filter(c => c.payload?.kind === 'message.send').length, 0);
    assert.deepEqual(p.errors, []);
  });

  await check('images Notebook held Remove explicit download and recorded refusal cards', async () => {
    const p = await page('images-notebook', null, true);
    const notebook = '#memory-items [data-id="fixture-notebook"]';
    // Notebook follows the conversation; position the actual card first.
    await p.evaluate(`document.querySelector(${JSON.stringify(notebook)}).scrollIntoView({block:'center'})`);
    await p.point(notebook); await until(() => p.evaluate('document.querySelector("#reader-origin").textContent.includes("Notebook")'), 'Notebook Reader');
    await until(() => p.evaluate("document.getAnimations().every(animation=>animation.playState!=='running')"), 'settled Notebook reader');
    const choose = async filename => {
      await until(() => p.evaluate('!document.querySelector("#add-image").disabled'), 'Notebook image action ready');
      const n = p.events.length; await p.send('Page.setInterceptFileChooserDialog', { enabled: true }); await p.point('#add-image');
      const event = await until(() => p.events.slice(n).find(e => e.method === 'Page.fileChooserOpened'), 'Notebook chooser');
      await p.send('DOM.setFileInputFiles', { backendNodeId: event.params.backendNodeId, files: [filename] });
    };
    await replace(p, 'Notebook reply before Remove');
    let hold = true; p.intercept((_payload, event) => { if (hold && event.request.url.endsWith('/api/media/upload')) { hold = false; return true; } return false; });
    // Fault seam: Abort is requested by production but the actual fetch stays
    // outstanding until its real held response is released.
    await p.evaluate('AbortController.prototype.abort=function(){}');
    await choose(path.join(root, 'tests/fixtures/media/screen.png'));
    const held = await until(() => p.held[0], 'held publication');
    await p.evaluate('[...document.querySelectorAll("#writing-attachments button")].find(b=>b.textContent==="Remove").dataset.imageRemove=""');
    await p.point('[data-image-remove]'); await replace(p, 'New Notebook writing survives Remove');
    const invalid = path.join(root, 'tests/fixtures/media/invalid-image.png');
    await choose(invalid);
    // Unsupported type needs a deliberate download; for malformed-image proof
    // use a .png fixture whose bytes really are invalid PNG.
    await until(() => p.evaluate('document.querySelector("#writing-attachments").textContent.includes("invalid-image")'), 'second selected file');
    await p.release(held);
    await until(() => p.evaluate('document.querySelector("#writing-attachments").textContent.includes("Attach as download")'), 'explicit fallback is discoverable');
    assert.equal(await field(p), 'New Notebook writing survives Remove');
    await p.evaluate('[...document.querySelectorAll("#writing-attachments button")].find(b=>b.textContent==="Attach as download").dataset.imageFallback=""');
    await p.point('[data-image-fallback]');
    // "Ready to continue upload" is not a completed attachment. The old
    // substring probe sent while Uploading; native-12 records the disabled gate.
    await until(() => p.evaluate('document.querySelector("#writing-attachments .image-choice span")?.textContent.endsWith(" · Ready") && !document.querySelector("#send-reply").disabled'), 'explicit download ready and Send enabled');
    observations.push({name:'Notebook before send readiness',status:await p.evaluate('({attachments:document.querySelector("#writing-attachments").textContent,disabled:document.querySelector("#send-reply").disabled,save:document.querySelector("#save-state").textContent})')});
    await p.point('#writing-body'); await p.key('Enter', 12);
    let firstSend;
    try { firstSend = await until(() => p.calls.find(c => c.payload?.kind === 'message.send'), 'Notebook attachment send'); }
    catch (error) { observations.push({name:'Notebook send timeout',text:await p.evaluate('document.querySelector("#reader").innerText'),rows:await p.evaluate('imageRows()'),calls:p.calls,errors:p.errors}); await shot(p,'notebook-send-timeout'); throw error; }
    const receipt = await view('operation', { operation_id: firstSend.payload.operation_id });
    const sent = await view('source', { kind: 'message', id: receipt.result.message_id });
    assert.equal(sent.attachments.length, 1); assert.equal(sent.attachments[0].content_type, 'application/octet-stream');
    assert.equal(sent.attachments[0].name, 'invalid-image.png');
    await replace(p, 'Refused A remains separate');
    await p.point('#recipient-input'); await p.send('Input.insertText', { text: 'fixture-outside-agent' }); await p.key('Enter');
    await p.point('#writing-body'); await p.key('Enter', 12);
    const refused = await until(() => p.calls.find(c => c.payload?.kind === 'message.send' && c.payload.operation_id !== firstSend.payload.operation_id), 'recorded R1a refusal');
    const rejected = await view('operation', { operation_id: refused.payload.operation_id }); assert.equal(rejected.error.code, 'REPLY_PATH_UNAVAILABLE');
    await replace(p, 'Successor B is untouched'); await p.point('#pending-submissions button');
    const card = '#review-content [data-id="' + refused.payload.args.submission_id + '"]';
    await until(() => p.evaluate(`document.querySelector(${JSON.stringify(card)})?.textContent.includes(${JSON.stringify(rejected.error.message)})`), 'local recorded explanation');
    assert.equal(await field(p), 'Successor B is untouched');
    await p.point('#review-close'); await p.point('#reader-close'); await until(() => p.evaluate('!document.querySelector("#reader").open'), 'Notebook reader closed');
    await p.close();
    const q = await page('images-refusal-restored', null, true);
    // The newly sent replies push Notebook below the viewport. Position the
    // actual card before native input; offscreen coordinates are not a click.
    await q.evaluate(`document.querySelector(${JSON.stringify(notebook)}).scrollIntoView({block:'center'})`);
    const bounds = await q.box(notebook); assert.ok(bounds.y >= 0 && bounds.y + bounds.height <= 900);
    await q.point(notebook);
    try { await until(() => q.evaluate('document.querySelector("#reader").open'), 'restored Notebook reader'); }
    catch (error) { observations.push({ name: 'restored Notebook failure', text: await q.evaluate('document.body.innerText'), errors: q.errors, calls: q.calls }); await shot(q, 'restored-notebook-failure'); throw error; }
    await until(() => q.evaluate("document.getAnimations().every(animation=>animation.playState!=='running')"), 'settled restored Notebook');
    await q.point('#pending-submissions button');
    await until(() => q.box(card), 'restored pending card');
    assert.equal(await q.evaluate(`document.querySelector(${JSON.stringify(card)}).textContent.includes(${JSON.stringify(rejected.error.message)})`), false, 'no eager per-card receipt read');
    q.intercept(payload => payload?.name === 'submission' && payload.args.submission_id === refused.payload.args.submission_id);
    await q.point(card + ' button');
    const delayed = await until(() => q.held[0], 'explicit submitted writing read');
    const response = await q.send('Fetch.getResponseBody', { requestId: delayed.event.requestId });
    const detail = JSON.parse(response.base64Encoded ? Buffer.from(response.body, 'base64').toString() : response.body);
    detail.send_receipt.operation_id = 'wrong-operation';
    await q.send('Fetch.fulfillRequest', { requestId: delayed.event.requestId, responseCode: 200,
      responseHeaders: [{ name: 'Content-Type', value: 'application/json' }], body: Buffer.from(JSON.stringify(detail)).toString('base64') });
    await until(() => q.evaluate(`Boolean(document.querySelector(${JSON.stringify(card + ' pre')}))`), 'explicit writing visible');
    assert.equal(await q.evaluate(`document.querySelector(${JSON.stringify(card)}).textContent.includes(${JSON.stringify(rejected.error.message)})`), false, 'wrong operation cannot render its reason');
    q.intercept(null); const before = q.calls.length;
    await q.evaluate(`[...document.querySelector(${JSON.stringify(card)}).querySelectorAll('button')].find(b=>b.textContent==='Check confirmation').dataset.refusalCheck=''`);
    await q.point('[data-refusal-check]');
    await until(() => q.evaluate(`document.querySelector(${JSON.stringify(card)}).textContent.includes(${JSON.stringify(rejected.error.message)})`), 'validated restored refusal reason');
    assert.ok(q.calls.slice(before).every(c => !c.url.endsWith('/api/command')));
    await shot(q, 'recorded-refusal'); assert.deepEqual(q.errors, []);
  });

}

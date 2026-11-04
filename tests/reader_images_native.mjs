import assert from 'node:assert/strict';
import path from 'node:path';
import { readFile } from 'node:fs/promises';
export const imageInstrumentation = `(()=>{
  window.imagePuts=[];
  const bytes=(x,seen=new Set())=>{if(x instanceof Blob)return x.size;if(!x||typeof x!=='object'||seen.has(x))return 0;seen.add(x);return (x instanceof Map?[...x.keys(),...x.values()]:x instanceof Set?[...x]:Object.values(x)).reduce((n,v)=>n+bytes(v,seen),0)};
  const put=IDBObjectStore.prototype.put;
  IDBObjectStore.prototype.put=function(value,...rest){if(this.name==='editors')imagePuts.push({kind:value.kind,bytes:bytes(value),id:value.id});return put.call(this,value,...rest)};
  window.imageRows=()=>new Promise((resolve,reject)=>{const r=indexedDB.open('aim-next-pending');r.onerror=()=>reject(r.error);r.onsuccess=()=>{const d=r.result,t=d.transaction('editors');t.objectStore('editors').getAll().onsuccess=e=>resolve(e.target.result.map(v=>({...v,blob:v.blob?{size:v.blob.size}:undefined})));t.oncomplete=()=>d.close()}});
})()`;
export async function imageChecks({ check, page, until, root, facts, view, replace, field, shot, observations }) {
  const png = (await readFile(path.join(root, 'tests/fixtures/media/screen.png'))).toString('base64');
  const model = async (p, actual = false) => p.evaluate(`(async()=>{
    const {Api}=await import('/api.mjs'), {EditorRegistry}=await import('/app-session.mjs');
    window.api=new Api(${JSON.stringify(facts.token)});window.boot=await api.bootstrap();
    window.r=new EditorRegistry({api,bootstrap:boot,journal:j,saveDelayMs:30000,maxSaveDelayMs:60000});
    window.e=${actual ? ` (await r.open(${JSON.stringify(facts.sources[1])},{topicId:'t1'})).editors.reply` : `await r.register(context,{id:'capture-model',revision:0,generation:'g'})`};
    window.u=r.sessionFor(e).uploads;window.file=new File([Uint8Array.from(atob(${JSON.stringify(png)}),c=>c.charCodeAt(0))],'retained.png',{type:'image/png'});
  })()`);
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
    await until(() => p.evaluate('document.querySelector("#writing-attachments").textContent.includes("Ready")'), 'ready image chip');
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
    await p.point('#refresh'); await until(() => p.box('#messages [data-id="' + receipt.result.message_id + '"]'), 'sent message is discoverable');
    await p.point('#messages [data-id="' + receipt.result.message_id + '"]');
    await until(() => p.evaluate('document.querySelector("#reader").open && Boolean(document.querySelector("#source-attachments button"))'), 'sent image Open action');
    await p.point('#source-attachments button');
    await until(() => p.evaluate('document.querySelector("#source-attachments img")?.naturalWidth > 0'), 'exact sent bytes rendered');
    await shot(p, 'image-opened');
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
    await b.evaluate('r.recoveryCandidates(e)');
    assert.equal(await b.evaluate(`readRow(${JSON.stringify(row.id)})`), null);
    assert.equal(await b.evaluate(`readRow(${JSON.stringify(bytesId)})`), null);
    assert.equal(await b.evaluate('e.recoveryDiscovery'), false);
    assert.equal(await b.evaluate('imagePuts.filter(x=>x.bytes).length'), 0, 'retirement/import never copies the old bytes');
    assert.equal(await b.evaluate('e.draft.body'), 'Canonical image copy');
    assert.equal(await b.evaluate('e.draft.attachments.length'), 1);
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

  await check('images Notebook held Remove explicit download and recorded refusal cards', async () => {
    const p = await page('images-notebook', null, true);
    const notebook = '#memory-items [data-id="fixture-notebook"]';
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
    await until(() => p.evaluate('document.querySelector("#writing-attachments").textContent.includes("Ready")'), 'explicit download ready');
    await p.point('#writing-body'); await p.key('Enter', 12);
    const firstSend = await until(() => p.calls.find(c => c.payload?.kind === 'message.send'), 'Notebook attachment send');
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

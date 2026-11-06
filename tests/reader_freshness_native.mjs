import assert from 'node:assert/strict';
import path from 'node:path';

// Prepended only to the response of the actual app module in the owned CFT
// fixture. These wrappers observe public lifetimes and delegate every call.
// They supply no alternate controller, reader, API, storage or view result.
export const freshnessInstrumentation = `
import {EditorRegistry as ObservedRegistry} from './app-session.mjs';
import {Reader as ObservedReader} from './reader.mjs';
import {RecoveryCleanup as ObservedCleanup} from './cleanup.mjs';
const {Freshness:ObservedFreshness}=await import('./freshness.mjs').catch(error=>{if(!${JSON.stringify(process.env.AIM_FRESHNESS_BASELINE === 'ba4a00e')})throw error;return {}});
window.freshEvidence={shows:0,opens:[],neighbors:[],reads:[]};
window.cleanupEvidence=[];window.uploadProofEvidence=[];
for(const method of ['request','retireOwn']){
  const original=ObservedCleanup.prototype[method];
  ObservedCleanup.prototype[method]=function(session,...args){const r={method,at:performance.now(),key:session.editor.key,format:session.snapshot().format,version:session.editor.localVersion};cleanupEvidence.push(r);const result=original.call(this,session,...args);if(method==='retireOwn')return Promise.resolve(result).then(value=>{r.end=performance.now();r.retired=value;return value},error=>{r.end=performance.now();r.error=error.message;throw error});return result};
}
window.observedMediaURLs=new Set();
const observedCreateURL=URL.createObjectURL,observedRevokeURL=URL.revokeObjectURL;
URL.createObjectURL=function(...args){const url=observedCreateURL.apply(this,args);observedMediaURLs.add(url);return url};
URL.revokeObjectURL=function(url){observedMediaURLs.delete(url);return observedRevokeURL.call(this,url)};
const observedIds=new WeakMap();let observedSerial=0;
const observedId=value=>{if(!value)return null;if(!observedIds.has(value))observedIds.set(value,++observedSerial);return observedIds.get(value)};
for(const name of ['open','neighbors']){
  const original=ObservedRegistry.prototype[name];
  ObservedRegistry.prototype[name]=async function(...args){
    window.observedRegistry=this;const record={start:performance.now(),background:Boolean(args[1]?.read)};
    freshEvidence[name==='open'?'opens':'neighbors'].push(record);
    try{return await original.apply(this,args)}catch(error){record.error=error.message;throw error}finally{record.end=performance.now()}
  };
}
const observedShow=ObservedReader.prototype.show;
ObservedReader.prototype.show=function(...args){window.observedReader=this;freshEvidence.shows++;const opened=freshEvidence.opens.at(-1);if(opened)opened.present=performance.now();return observedShow.apply(this,args)};
if(ObservedFreshness){
  const observedRequest=ObservedFreshness.prototype.request;
  ObservedFreshness.prototype.request=function(...args){window.observedFreshness=this;return observedRequest.apply(this,args)};
  const observedRead=ObservedFreshness.prototype.readAt;
  const observedReadOwners=new WeakSet();
  ObservedFreshness.prototype.readAt=async function(...args){
    if(!observedReadOwners.has(this)){const read=this.read;this.read=operation=>read(options=>{freshEvidence.reads.at(-1).dispatch=performance.now();return operation(options)});observedReadOwners.add(this)}
    const r={name:args[1],args:args[2],start:performance.now()};freshEvidence.reads.push(r);
    try{const answer=await observedRead.apply(this,args);r.items=answer.items?.length;r.hasMore=answer.has_more;return answer}catch(e){r.error=e.code??e.message;throw e}finally{r.end=performance.now()}
  };
}
window.freshSnapshot=()=>{const r=window.observedRegistry,p=r?.current,e=p?.editors.reply,f=document.querySelector('#writing-body'),s=window.getSelection();return {
  presentation:observedId(p),sourceObject:observedId(p?.source),editorObject:observedId(e),generation:r?.generation,pending:r?.pendingOpen??null,
  shows:freshEvidence.shows,source:p?.source.source_ref,sourceText:document.querySelector('#source-body')?.textContent,
  editorSource:e?.sourceRef,key:e?.key,cycle:e?.clientCycleId,body:e?.draft.body,quotes:e?.draft.quotes,
  reservation:observedId(e?.imageReservation),selected:s?.toString(),range:s?.rangeCount?{start:s.getRangeAt(0).startOffset,end:s.getRangeAt(0).endOffset,startNode:observedId(s.getRangeAt(0).startContainer),endNode:observedId(s.getRangeAt(0).endContainer)}:null,
  focus:document.activeElement?.id,caret:f?{start:f.selectionStart,end:f.selectionEnd}:null,scroll:document.querySelector('#source-body')?.scrollTop,
}};
`;

// Instrument the genuine producer, leaving its reads and retirement decision
// untouched. This is applied only to the fixture's response body.
export function observeUploadProof(source) {
  const from = 'export async function uploadProof(row, context, { api, read, authority }) {';
  assert.equal(source.split(from).length, 2);
  return source.replace(from, 'async function observedUploadProof(row, context, { api, read, authority }) {') + `
export async function uploadProof(...args){
  const record={start:performance.now(),key:args[0].snapshot.key,version:args[0].snapshot.localVersion,reads:[]};
  (window.uploadProofEvidence??=[]).push(record);
  const options=args[2],read=options.read;
  try{const result=await observedUploadProof(args[0],args[1],{...options,read:operation=>{const r={dispatch:performance.now()};record.reads.push(r);return read(operation).finally(()=>{r.settled=performance.now()})}});record.result=result===null?'kept':result.projected?'projected':'bytes-only';return result}
  catch(error){record.error=error.code??error.message;throw error}finally{record.end=performance.now()}
}
`;
}

export async function freshnessChecks({ check, page, until, root, facts, view, control, replace, field, shot, observations, baseline = false, legacyAdmission = false }) {
  let serial = 0;
  const operation = label => `freshness-${label}-${++serial}`;
  const message = body => control({ method: 'agent_message', operation_id: operation('message'), body, topic_id: 't1', addressees: [] });
  const revise = async body => {
    const source = await view('source', { kind: 'memory', id: 'fixture-notebook', revision: 1 });
    assert.ok(Number.isInteger(source.current_revision));
    return control({ method: 'memory_revise', operation_id: operation('revise'), item_id: 'fixture-notebook',
      expected_revision: source.current_revision, title: 'Fresh Notebook', body });
  };
  const fault = (name, code, status = 200) => control({ method: 'read_fault', name, status,
    body: { instance_id: facts.instance_id, error: { code, message: `Fixture ${code}`, retryable: false } }, count: 1 });
  const hasText = (p, selector, text) => p.evaluate(`document.querySelector(${JSON.stringify(selector)}).textContent.includes(${JSON.stringify(text)})`);
  const idleRead = p => until(() => p.evaluate('window.observedFreshness && !observedFreshness.running'), 'completed current freshness window');
  const publicSendRequest = (event, clickedAt) => event.method === 'Network.requestWillBeSent' &&
    event.params.request.url.endsWith('/api/command') && event.params.wallTime * 1000 >= clickedAt &&
    JSON.parse(event.params.request.postData).kind === 'message.send';
  const tap = async (p, selector) => {
    const b = await p.box(selector); assert.ok(b && b.width > 0 && b.height > 0, `visible touch target ${selector}`);
    await p.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: b.x + b.width/2, y: b.y + b.height/2 }] });
    await p.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  };

  if (legacyAdmission) {
    await check('freshness fallback without capability performs no automatic reads', async () => {
      const p = await page('legacy-capability', null, true);
      assert.equal(await hasText(p, '#updates-message', 'Automatic updates need the updated server'), true);
      const before = p.calls.length;
      await message('Manual Refresh on the unsupported-capability fixture');
      await new Promise(resolve => setTimeout(resolve, 1100));
      assert.equal(p.calls.length, before);
      assert.equal(p.calls.some(c => c.payload?.name === 'changes'), false);
      assert.equal(await hasText(p, '#messages', 'Manual Refresh on the unsupported-capability fixture'), false);
      await p.point('#refresh');
      await until(() => hasText(p, '#messages', 'Manual Refresh on the unsupported-capability fixture'), 'explicit manual Refresh');
      observations.push({ name: 'no-capability fallback', before, calls: p.calls });
      assert.deepEqual(p.errors, []);
    });
    return;
  }

  await check('freshness Notebook card top alignment and native activation', async () => {
    const seeded = await control({ method: 'seed', memory_items: 2 });
    const ids = ['fixture-notebook', ...seeded.item_ids];
    const title = 'A taller Notebook entry';
    const body = 'This deliberately longer entry gives shorter neighboring cards real empty space. '.repeat(8);
    const revision = await control({ method: 'memory_revise', operation_id: operation('alignment-tall'),
      item_id: ids[0], expected_revision: 1, title, body });
    assert.equal(revision.status, 'committed');
    const p = await page('notebook-top-alignment', null, true);
    const card = id => `#memory-items [data-id="${id}"]`;
    const scroll = selector => p.evaluate(`document.querySelector(${JSON.stringify(selector)}).scrollIntoView({block:'center'})`);
    const geometry = () => p.evaluate(`Array.from(document.querySelectorAll('#memory-items .memory-card'),e=>{
      const b=e.getBoundingClientRect(),t=e.querySelector('strong').getBoundingClientRect(),s=e.querySelector('span').getBoundingClientRect(),c=getComputedStyle(e);
      return {id:e.dataset.id,x:b.x,y:b.y,width:b.width,height:b.height,titleTop:t.top,titleHeight:t.height,bodyBottom:s.bottom,
        expectedTop:b.top+parseFloat(c.borderTopWidth)+parseFloat(c.paddingTop)};
    })`);
    const aligned = boxes => {
      assert.equal(boxes.length, 3, 'all three real Notebook cards rendered');
      for (const b of boxes) {
        assert.ok(b.width > 0 && b.height > 0 && b.titleHeight > 0, 'rendered nonzero card and title');
        assert.ok(Math.abs(b.titleTop - b.expectedTop) <= 1, `${b.id}: title must start at top border plus padding; offset ${b.titleTop-b.expectedTop}`);
      }
    };
    await until(() => p.evaluate('document.querySelectorAll("#memory-items .memory-card").length===3'), 'unequal Notebook entries');
    await scroll('#memory-items');
    const before = await geometry(); observations.push({ name: 'Notebook desktop geometry', boxes: before });
    await shot(p, 'notebook-desktop');
    assert.ok(before.every(b => Math.abs(b.y-before[0].y) <= 1 && Math.abs(b.height-before[0].height) <= 1), 'equal-height cards share one desktop row');
    assert.ok(before[0].bodyBottom-before[0].titleTop > before[1].bodyBottom-before[1].titleTop+150, 'substantially unequal intrinsic contents expose centering');
    aligned(before);
    const click = async (x,y) => {
      assert.ok(await p.evaluate(`${x}>=0 && ${y}>=0 && ${x}<innerWidth && ${y}<innerHeight`), 'native point is inside viewport');
      await p.send('Input.dispatchMouseEvent', { type:'mousePressed',x,y,button:'left',clickCount:1 });
      await p.send('Input.dispatchMouseEvent', { type:'mouseReleased',x,y,button:'left',clickCount:1 });
    };
    const open = async (expectedTitle,expectedBody) => {
      await until(() => p.evaluate(`document.querySelector('#reader').open && document.querySelector('#reader-title').textContent===${JSON.stringify(expectedTitle)}`), 'native activation opens exact Notebook title');
      assert.equal(await p.evaluate('document.querySelector("#source-body").textContent'), expectedBody);
      await until(() => p.evaluate('document.getAnimations().every(a=>a.playState!=="running")'), 'settled Reader');
    };
    const close = async id => {
      await p.point('#reader-close');
      await until(() => p.evaluate('!document.querySelector("#reader").open'), 'Reader closed');
      assert.equal(await p.evaluate('document.activeElement.dataset.id'), id, 'opener focus restored');
    };
    const gapX=(before[0].x+before[0].width+before[1].x)/2, gapY=before[1].y+before[1].height/2;
    assert.equal(await p.evaluate(`document.elementFromPoint(${gapX},${gapY}).id`), 'memory-items', 'point is truly the card gap');
    await click(gapX,gapY); assert.equal(await p.evaluate('document.querySelector("#reader").open'), false);
    const lower={x:before[1].x+before[1].width/2,y:before[1].y+before[1].height*.93};
    assert.ok(lower.y>before[1].bodyBottom+20, 'bottom 7% point is in empty lower card space');
    await click(lower.x,lower.y); await open('Fixture item 0','Fixture Notebook body 0'); await close(ids[1]);
    await p.key('Tab');
    assert.equal(await p.evaluate('document.activeElement.dataset.id'),ids[2]);
    assert.equal(await p.evaluate('document.activeElement.matches(":focus-visible") && getComputedStyle(document.activeElement).outlineStyle!=="none"'),true);
    await p.key('Enter'); await open('Fixture item 1','Fixture Notebook body 1'); await close(ids[2]);
    for (const type of ['keyDown','keyUp']) await p.send('Input.dispatchKeyEvent', {type,key:' ',code:'Space',windowsVirtualKeyCode:32,...(type==='keyDown'?{text:' '}: {})});
    await open('Fixture item 1','Fixture Notebook body 1'); await close(ids[2]);
    await p.evaluate(`window.alignmentCard=document.querySelector(${JSON.stringify(card(ids[2]))})`);
    const revisedBody='A revised short preview, still aligned at the top.';
    assert.equal((await control({method:'memory_revise',operation_id:operation('alignment-redraw'),item_id:ids[2],expected_revision:1,title:'Revised short item',body:revisedBody})).status,'committed');
    await until(() => hasText(p,card(ids[2]),revisedBody),'actual Notebook revision paints');
    assert.equal(await p.evaluate('document.activeElement===alignmentCard && alignmentCard.isConnected'),true,'revision preserves focused card identity');
    const redrawn=await geometry(); aligned(redrawn); observations.push({name:'Notebook redrawn geometry',boxes:redrawn,lowerClick:lower});
    await p.send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});
    await p.send('Emulation.setTouchEmulationEnabled',{enabled:true});
    await scroll(card(ids[1]));
    const mobile=await geometry(); aligned(mobile);
    assert.ok(mobile.every(b=>b.x>=0 && b.x+b.width<=390 && b.height>=44),'mobile cards fit and retain touch height');
    assert.equal(await p.evaluate('document.documentElement.scrollWidth'),390,'no horizontal overflow');
    observations.push({name:'Notebook mobile pre-input geometry',boxes:mobile});
    await shot(p,'notebook-mobile-before-touch');
    await p.evaluate(`(()=>{window.notebookTouches=[];for(const type of ['touchstart','touchend','click'])document.addEventListener(type,e=>{
      const point=e.changedTouches?.[0]??e;notebookTouches.push({type,id:e.target.closest('.memory-card')?.dataset.id??e.target.id,x:point.clientX,y:point.clientY});
    },true)})()`);
    // Chrome adjusts a gap touch to a neighboring button in both the baseline
    // and fixed layout. The retained diagnostic is not an inert-gap guarantee.
    // Here the touch is deliberately in the card's own area.
    await tap(p,card(ids[1])); await open('Fixture item 0','Fixture Notebook body 0');
    const touchEvents=await p.evaluate('notebookTouches');
    assert.ok(touchEvents.some(e=>e.type==='click' && e.id===ids[1]),'native touch activates the intended card');
    await tap(p,'#reader-close'); await until(()=>p.evaluate('!document.querySelector("#reader").open'),'touch close');
    assert.equal(p.calls.some(c=>['message.send','submission.prepare','memory.create','memory.revise'].includes(c.payload?.kind)),false,'native card actions publish nothing');
    observations.push({name:'Notebook mobile geometry',boxes:mobile,touchEvents}); await shot(p,'notebook-mobile');
    assert.deepEqual(p.errors,[]);
  });

  await check('freshness C2 identical paired open and neighbor latency workload', async () => {
    const a = await page('latency-a', null, true, { newWindow: true });
    const b = await page('latency-b', null, true, { newWindow: true });
    for (const p of [a, b]) {
      assert.equal(await p.evaluate('document.visibilityState'), 'visible');
    }
    await control({ method: 'read_delay', ms: 25 });
    try {
    for (let round = 0; round < 10; ++round) {
      for (const [p, index] of [[a, 0], [b, 1]]) {
        await p.open(index);
        await until(() => p.evaluate('freshEvidence.neighbors.some(r=>!r.background) && freshEvidence.neighbors.filter(r=>!r.background).every(r=>r.end!==undefined)'), 'paired foreground neighbors settled');
        await p.point('#reader-close');
        await until(() => p.evaluate('!document.querySelector("#reader").open'), 'latency reader closed');
      }
    }
    const all = [await a.evaluate('freshEvidence'), await b.evaluate('freshEvidence')];
    const opens = all.flatMap(e => e.opens), neighbors = all.flatMap(e => e.neighbors.filter(r => !r.background));
    assert.equal(opens.length, 20); assert.equal(neighbors.length, 20);
    assert.ok([...opens, ...neighbors].every(r => !r.error && Number.isFinite(r.end)), 'all reservations complete without a timeout');
    assert.ok(opens.every(r => Number.isFinite(r.present)));
    const stats = values => {
      const sorted = [...values].sort((a,b) => a-b);
      return { n: sorted.length, p50: sorted[Math.ceil(sorted.length * .5) - 1], p95: sorted[Math.ceil(sorted.length * .95) - 1], max: sorted.at(-1) };
    };
    // The command measurement uses the same visible documents and actual
    // inside-permit delay. Peer navigation starts paired reads as Send
    // is clicked; no model call substitutes for either user action.
    await a.open(0); await replace(a, 'Identical workload command-dispatch sample'); await b.open(1);
    await until(() => b.evaluate('!document.querySelector("#previous-message").disabled'), 'peer navigation ready');
    await b.point('#previous-message');
    const clickedAt = Date.now(); await a.point('#send-reply');
    const request = await until(() => a.network.find(e => publicSendRequest(e, clickedAt)), 'native public Send dispatch during peer navigation');
    const response = await until(() => a.network.find(e => e.method === 'Network.responseReceived' && e.params.requestId === request.params.requestId), 'native Send socket timing');
    const requestStartMs = request.params.wallTime * 1000 - clickedAt;
    assert.ok(requestStartMs < 1000, 'foreground command does not wait for paired reads');
    const send = await until(() => a.calls.find(c => c.payload?.kind === 'message.send' && c.at >= clickedAt), 'native sample actually sent');
    await until(async () => (await Promise.all([a,b].map(p=>p.evaluate('freshEvidence.opens.every(r=>r.end!==undefined) && freshEvidence.neighbors.every(r=>r.end!==undefined)')))).every(Boolean), 'peer foreground reads settled before external verification');
    const verification = [];
    const sent = await until(async () => {
      const answer = await view('operation', { operation_id: send.payload.operation_id }); verification.push(answer);
      if (answer.error?.code==='SERVER_BUSY') return false;
      assert.equal(answer.status, 'committed'); return answer;
    }, 'recorded Send receipt after the measured workload');
    assert.equal((await view('source', { kind: 'message', id: sent.result.message_id })).body, 'Identical workload command-dispatch sample');
    const admission = await control({ method: 'admission_events' });
    const delays = admission.events.filter(e=>e.event==='delay-enter');
    const delayCounts = { foreground: delays.filter(e=>e.read_class==='foreground').length, background: delays.filter(e=>e.read_class==='background').length };
    assert.ok(delayCounts.foreground > 0);
    if (!baseline) assert.ok(delayCounts.background > 0, 'candidate automatic updates remain active during comparison');
    assert.ok(delays.filter(e=>e.name==='source').length >= 20, 'every measured open reaches the real delayed callback');
    for (const start of delays) {
      const events = admission.events.filter(e=>e.request_id===start.request_id);
      const end = events.find(e=>e.event==='delay-exit');
      if (!end || !events.some(e=>e.event==='callback-exit')) {
        assert.notEqual(start.name, 'source', 'every measured source callback has completed');
        continue; // an unrelated automatic callback can still be active
      }
      assert.ok(end.at-start.at >= .024, 'the requested25ms delay is inside the measured permit');
      const order = events.map(e=>e.event);
      assert.ok(order.indexOf('callback-enter') < order.indexOf('delay-enter'));
      assert.ok(order.indexOf('delay-exit') < order.indexOf('callback-exit'));
      if (order.includes('released')) assert.ok(order.indexOf('close-exit') < order.indexOf('released'));
    }
    observations.push({ name: 'paired latency', baseline, workload: 'two visible CFT windows; 10 native open/close rounds each;25ms actual Store callback delay inside admission; no Response-stage delay or hidden cleanup wait',
      opens, neighbors, openToPresentMs: stats(opens.map(r => r.present-r.start)), neighborMs: stats(neighbors.map(r => r.end-r.start)),
      send: { clickedAt, requestStartMs, request: request.params, responseTiming: response.params.response.timing, socketSendDelayMs: response.params.response.timing?.sendStart, receipt: sent, verification },
      admission, delayCounts });
    assert.deepEqual(a.errors, []); assert.deepEqual(b.errors, []);
    } finally { await control({ method: 'read_delay', ms: 0 }); }
  });
  await check('freshness C3 public Send dispatch while a foreground callback is held', async () => {
    const a = await page('public-send-a', null, true, {newWindow:true});
    const b = await page('public-send-b', null, true, {newWindow:true});
    await a.open(0); await replace(a, 'Exact public Send under a held foreground read'); await b.open(1);
    await until(() => b.evaluate('!document.querySelector("#previous-message").disabled'), 'peer has a previous message');
    const holdId = operation('send-foreground'), admissionBefore = await control({method:'admission_events'});
    await control({method:'read_delay',ms:25});
    await control({method:'read_hold',hold_id:holdId,name:'source',phase:'callback',read_class:'foreground'});
    try {
      await b.point('#previous-message');
      const held = await until(async () => (await control({method:'admission_events',after:admissionBefore.next})).events.find(e=>e.event==='hold-enter' && e.hold_id===holdId), 'peer source callback actually holds a read permit');
      await a.evaluate('document.querySelector("#send-reply").addEventListener("click",()=>{window.nativeSendClickAt=performance.timeOrigin+performance.now()},{once:true,capture:true})');
      const gestureStartedAt = Date.now(); await a.point('#send-reply');
      const clickedAt = await a.evaluate('nativeSendClickAt');
      const request = await until(() => a.network.find(e=>publicSendRequest(e,clickedAt)), 'exact message.send starts before the read is released');
      const payload = JSON.parse(request.params.request.postData);
      assert.equal(payload.kind, 'message.send', 'C3 identifies the public command, not its preceding draft save');
      assert.ok(request.params.wallTime*1000-clickedAt < 1000);
      const response = await until(() => a.network.find(e=>e.method==='Network.responseReceived' && e.params.requestId===request.params.requestId), 'public command response while read held');
      await until(()=>a.network.some(e=>e.method==='Network.loadingFinished' && e.params.requestId===request.params.requestId),'public command body complete');
      const raw = await a.send('Network.getResponseBody',{requestId:request.params.requestId});
      const receipt = JSON.parse(raw.base64Encoded?Buffer.from(raw.body,'base64').toString():raw.body);
      assert.equal(receipt.kind, 'message.send'); assert.equal(receipt.operation_id,payload.operation_id); assert.equal(receipt.status,'committed');
      const admission = await control({method:'admission_events',after:admissionBefore.next});
      assert.ok(!admission.events.some(e=>e.request_id===held.request_id && ['released','legacy-read-exit','hold-exit'].includes(e.event)), 'Send commits while the peer still owns its permit');
      const timeline = a.network.filter(e=>e.method==='Network.requestWillBeSent' && e.params.wallTime*1000>=gestureStartedAt && e.params.request.url.includes('/api/')).map(e=>({at:e.params.wallTime*1000,requestId:e.params.requestId,payload:e.params.request.postData?JSON.parse(e.params.request.postData):null,readClass:Object.entries(e.params.request.headers).find(([k])=>k.toLowerCase()==='x-aim-read-class')?.[1]??null}));
      for (const item of timeline.filter(e=>e.payload?.kind)) {
        const answer = a.network.find(e=>e.method==='Network.responseReceived' && e.params.requestId===item.requestId);
        const raw = await a.send('Network.getResponseBody',{requestId:item.requestId});
        item.receipt = JSON.parse(raw.base64Encoded?Buffer.from(raw.body,'base64').toString():raw.body);
        item.responseAt = request.params.wallTime*1000 + (answer.params.timestamp-request.params.timestamp)*1000;
        item.timing = answer.params.response.timing;
        assert.equal(item.receipt.kind,item.payload.kind); assert.equal(item.receipt.status,'committed');
      }
      const draft = timeline.find(e=>e.payload?.kind==='draft.save'), prepare = timeline.find(e=>e.payload?.kind==='submission.prepare');
      assert.ok(draft && prepare && draft.responseAt<=prepare.at && prepare.responseAt<=request.params.wallTime*1000, 'the durable command chain waits for each command receipt');
      assert.ok(!timeline.some(e=>e.at<request.params.wallTime*1000 && e.payload?.name && e.readClass!=='background'), 'no foreground preflight read before the healthy public Send');
      observations.push({name:'public Send under held read',baseline,gestureStartedAt,clickedAt,draftStartMs:draft.at-clickedAt,requestStartMs:request.params.wallTime*1000-clickedAt,request:request.params,responseTiming:response.params.response.timing,receipt,timeline,held,admission});
    } finally { await control({method:'read_release',hold_id:holdId}); await control({method:'read_delay',ms:0}); }
    assert.deepEqual(a.errors,[]); assert.deepEqual(b.errors,[]);
  });
  if (baseline) return;

  await check('freshness scale scoped consumer cost and real hidden polling', async () => {
    const scale = Number(process.env.AIM_FRESHNESS_SCALE ?? 1000);
    assert.ok([1000, 10000].includes(scale));
    const seedStart = Date.now();
    const seeded = await control({ method: 'seed', unrelated_records: scale });
    const seedMs = Date.now() - seedStart;
    assert.equal(seeded.unrelated_changes, scale);
    const readyStart = Date.now(), p = await page('scale-consumer', null, true);
    const readyMs = Date.now() - readyStart;
    assert.equal(await p.evaluate('document.visibilityState'), 'visible');
    await idleRead(p);
    const count = async () => p.evaluate('freshEvidence.reads.length');
    const callsAfter = async index => (await p.evaluate('freshEvidence.reads')).slice(index);
    const beforeUnrelated = await count(), unrelatedStart = Date.now();
    // This transaction adds a change outside the viewed topic. It is query
    // fixture data, not a message attributed to an agent.
    await control({ method: 'seed', unrelated_records: 1 });
    await new Promise(resolve => setTimeout(resolve, 1600));
    const unrelated = await callsAfter(beforeUnrelated);
    assert.ok(unrelated.filter(r => r.name === 'changes').length >= 2);
    assert.ok(unrelated.every(r => r.name === 'changes' && r.items === 0), 'unrelated commits cause no dependent refresh');
    const idleStart = Date.now(), beforeIdle = await count();
    await new Promise(resolve => setTimeout(resolve, 2100));
    const idleElapsed = Date.now()-idleStart, idle = await callsAfter(beforeIdle);
    assert.ok(idle.length >= 3 && idle.length / (idleElapsed/1000) <= 2, 'healthy visible idle performs at most two checks per second');
    assert.ok(idle.every(r => r.name === 'changes'));
    const samples = [], beforeWork = await count();
    for (let n=0; n<10; ++n) {
      const text = `Scoped scale message ${n}`, body = `Scoped Notebook revision ${n}`;
      const sent = await message(text), committedAt = Date.now();
      await until(() => hasText(p, '#messages', text), 'scoped incoming message visible');
      const messageMs = Date.now()-committedAt;
      const revised = await revise(body), revisedAt = Date.now();
      await until(() => hasText(p, '#memory-items', body), 'exact loaded Notebook key visible');
      const notebookMs = Date.now()-revisedAt;
      assert.ok(messageMs < 1000 && notebookMs < 1000, 'healthy scoped changes visible within one second');
      samples.push({sent,revised,messageMs,notebookMs});
    }
    await idleRead(p);
    const work = await callsAfter(beforeWork), keyed = work.filter(r => r.name === 'memory_items' && r.args.limit === 1);
    assert.equal(keyed.length, 10, 'each loaded Notebook revision gets one keyed read');
    assert.ok(keyed.every(r => !r.error && Number.isFinite(r.dispatch) && r.dispatch >= r.start && r.end >= r.dispatch));
    const durations = keyed.map(r => r.end-r.start).sort((a,b)=>a-b);
    const keyedP95Ms = durations[Math.ceil(durations.length*.95)-1];
    assert.ok(keyedP95Ms < 500, 'keyed-read p95 meets the selected500ms target');
    const cover = await page('scale-other-tab', null, true);
    await cover.send('Page.bringToFront');
    await until(() => p.evaluate('document.visibilityState === "hidden"'), 'actual browser tab becomes hidden');
    await idleRead(p);
    const hiddenStart = Date.now(), beforeHidden = await count();
    const hiddenSent = await message('Scoped message arriving while hidden');
    await new Promise(resolve => setTimeout(resolve, 1100));
    assert.equal((await callsAfter(beforeHidden)).length, 0, 'hidden document starts no automatic reads');
    const hiddenMs = Date.now()-hiddenStart, returnAt = Date.now();
    await p.send('Page.bringToFront');
    await until(() => p.evaluate('document.visibilityState === "visible"'), 'actual browser tab returns visible');
    await until(() => hasText(p, '#messages', 'Scoped message arriving while hidden'), 'visibility return catches up');
    assert.ok(Date.now()-returnAt < 1000);
    observations.push({name:'scoped scale',scale,unrelatedAfterCommit:scale+1,seedMs,readyMs,
      unrelated:{elapsedMs:idleStart-unrelatedStart,reads:unrelated},idle:{elapsedMs:idleElapsed,reads:idle},
      samples,work,keyedP95Ms,hidden:{elapsedMs:hiddenMs,reads:0,hiddenSent,returnToVisibleMs:Date.now()-returnAt},
      qualification:'Unrelated rows are private query-scale fixture records. Ten real fixture-agent message/revision pairs; no Response-stage delay. The hidden interval is separate from healthy visible latency.'});
    assert.deepEqual(p.errors, []); assert.deepEqual(cover.errors, []);
    assert.equal(p.calls.some(c => ['message.send','submission.prepare','delivery.ack'].includes(c.payload?.kind)), false);
  });

  await check('freshness F3 two visible documents preserve Store holds and Send dispatch under a real producer', async () => {
    await message('A real reader neighbor for the admission workload');
    const a = await page('freshness-budget-a', null, true, { newWindow: true });
    const begin = await control({ method: 'admission_events' });
    const holdId = operation('callback-hold');
    await control({ method: 'read_hold', hold_id: holdId, name: 'changes', phase: 'callback', read_class: 'background' });
    const held = await until(async () => (await control({ method: 'admission_events', after: begin.next })).events.find(e => e.event === 'hold-enter' && e.hold_id === holdId), 'background Store callback held');
    try {
      const b = await page('freshness-budget-b', null, true, { newWindow: true });
      assert.equal(await a.evaluate('document.visibilityState'), 'visible');
      assert.equal(await b.evaluate('document.visibilityState'), 'visible');
      await a.open(1);
      const during = await control({ method: 'admission_events', after: begin.next });
      assert.equal(during.lanes.background.active, 1, 'client abort cannot release the held Store callback');
      assert.ok(!during.events.some(e => e.request_id === held.request_id && e.event === 'released'));
      assert.ok(during.events.some(e => e.event === 'callback-enter' && e.read_class === 'foreground' && e.name === 'source'));
      await control({ method: 'read_release', hold_id: holdId });
      await until(async () => (await control({ method: 'admission_events', after: begin.next })).events.some(e => e.request_id === held.request_id && e.event === 'released'), 'permit released after callback and close');
      await b.open(0);
      const closeId = operation('close-hold'), beforeClose = await control({ method: 'admission_events' });
      await control({ method: 'read_hold', hold_id: closeId, name: 'changes', phase: 'close', read_class: 'background' });
      const closing = await until(async () => (await control({ method: 'admission_events', after: beforeClose.next })).events.find(e => e.event === 'hold-enter' && e.hold_id === closeId), 'Store close holds background permit');
      try {
        assert.equal((await control({ method: 'admission_events' })).lanes.background.active, 1);
        await a.point('#next-message');
        await until(() => a.evaluate('observedRegistry.current.source.source_ref.id !== ' + JSON.stringify(facts.sources[1].id)), 'foreground navigation completes while close held');
      } finally { await control({ method: 'read_release', hold_id: closeId }); }
      await a.send('Page.setInterceptFileChooserDialog', { enabled: true });
      await a.point('#add-image');
      const chooser = await until(() => a.events.find(e => e.method === 'Page.fileChooserOpened'), 'producer image chosen natively');
      await a.send('DOM.setFileInputFiles', { backendNodeId: chooser.params.backendNodeId, files: [path.join(root, 'tests/fixtures/media/screen.png')] });
      await until(() => hasText(a, '#writing-attachments', 'Ready'), 'producer image ready');
      await a.evaluate('(()=>{const b=[...document.querySelectorAll("#writing-attachments button")].find(e=>e.textContent==="Check confirmation");if(!b)throw Error("Missing visible image Check");b.id="freshness-image-check"})()');
      await a.point('#freshness-image-check');
      await until(() => hasText(a, '#writing-attachments', 'Ready'), 'explicit image Check completes');
      // Healthy response-stage delay keeps the genuine producer busy. No
      // early refusal or cleanup.idle shortcut is substituted for its work.
      a.intercept(async payload => { if (payload?.name) await new Promise(resolve => setTimeout(resolve, 15)); return false; });
      let producing = true, typed = 0;
      await a.point('#writing-body');
      const producer = (async () => {
        while (producing && typed < 60) { await a.send('Input.insertText', { text: 'x' }); typed++; await new Promise(resolve => setTimeout(resolve, 90)); }
      })();
      let receipt, arrivedAt, committedAt;
      try {
        await until(() => a.evaluate('uploadProofEvidence.length > 0 && cleanupEvidence.some(e=>e.method==="request"&&e.format===2)'), 'real persisted format2 producer entered uploadProof');
        receipt = await message('Healthy incoming while format2 producer runs'); committedAt = Date.now();
        await until(() => hasText(a, '#messages', 'Healthy incoming while format2 producer runs'), 'freshness advances before producer stops');
        arrivedAt = Date.now(); assert.ok(producing && typed < 60, 'producer is still active at visibility');
        assert.ok(arrivedAt - committedAt < 1000, 'healthy commit becomes visible within one second');
      } finally { producing = false; await producer; }
      const expectedWriting = await field(a), clickedAt = Date.now(); await a.point('#send-reply');
      const started = await until(() => a.network.find(e => publicSendRequest(e, clickedAt)), 'public message.send request starts');
      const response = await until(() => a.network.find(e => e.method === 'Network.responseReceived' && e.params.requestId === started.params.requestId), 'command response timing');
      const requestStartMs = started.params.wallTime * 1000 - clickedAt;
      assert.ok(requestStartMs < 1000, 'Send dispatch does not await a read queue');
      const send = await until(() => a.calls.find(c => c.payload?.kind === 'message.send' && c.at >= clickedAt), 'exact public Send reaches Store');
      const sent = await view('operation', { operation_id: send.payload.operation_id });
      assert.equal(sent.status, 'committed');
      const publication = await view('source', { kind: 'message', id: sent.result.message_id });
      assert.equal(publication.body, expectedWriting); assert.equal(publication.attachments.length, 1);
      const events = await control({ method: 'admission_events', after: begin.next });
      for (const e of events.events.filter(e => e.lanes)) {
        assert.ok(e.lanes.foreground.active <= 1 && e.lanes.background.active <= 1);
        assert.ok(e.lanes.foreground.active + e.lanes.background.active <= 2);
        assert.ok(e.lanes.foreground.waiting <= 8 && e.lanes.background.waiting <= 2);
      }
      const proof = await a.evaluate('({cleanup:cleanupEvidence,proof:uploadProofEvidence,lifetimes:freshEvidence})');
      assert.ok(proof.proof.some(r => r.reads.some(read => read.settled !== undefined)));
      for (const call of [...a.calls, ...b.calls]) {
        const lane = Object.entries(call.headers).find(([key]) => key.toLowerCase() === 'x-aim-read-class')?.[1];
        if (call.payload?.name === 'changes' && call.payload.args.cursor) assert.equal(lane, 'background');
        if (call.payload?.kind) assert.equal(lane, undefined, 'commands use no read-class header');
      }
      observations.push({ name: 'two documents and producer', held, closing, receipt, typed, committedAt, arrivedAt, visibilityMs: arrivedAt - committedAt, expectedWriting, clickedAt,
        requestStartMs, request: started.params, responseTiming: response.params.response.timing,
        socketSendDelayMs: response.params.response.timing?.sendStart, events, proof, sent,
        qualification: 'Native actions with healthy 15ms response delay; no claim about hidden/offline/stalled latency.' });
      assert.deepEqual(a.errors, []); assert.deepEqual(b.errors, []); await shot(a, 'freshness-producer');
    } finally { await control({ method: 'read_release', hold_id: holdId }); }
  });

  await check('freshness F2 loaded paging and explicit Notebook revision preserve editor identity', async () => {
    const seeded = await control({ method: 'seed', messages: 35, memory_items: 25, unrelated_records: 200 });
    const p = await page('freshness-paging', null, true);
    await p.evaluate('document.querySelector("#more-memory").scrollIntoView({block:"center"})');
    await p.point('#more-memory');
    const lastId = seeded.item_ids.at(-1);
    await until(() => p.evaluate(`Boolean(document.querySelector('#memory-items [data-id="${lastId}"]'))`), 'loaded Notebook item beyond first twenty');
    const frontier = await p.evaluate('observedFreshness.checkpoint');
    const older = await p.evaluate('[...document.querySelectorAll("#messages [data-id]")].map(e=>e.dataset.id)');
    const revision = await control({ method: 'memory_revise', operation_id: operation('last-loaded'), item_id: lastId,
      expected_revision: 1, title: 'Loaded item revised', body: 'Changed beyond the first twenty' });
    await until(() => hasText(p, `#memory-items [data-id="${lastId}"]`, 'Changed beyond the first twenty'), 'keyed loaded summary updated');
    assert.ok(p.calls.some(c => c.payload?.name === 'memory_items' && c.payload.args.limit === 1 && c.payload.args.cursor > 0), 'loaded key has an exact bounded summary read');
    const memorySelector = '#memory-items [data-id="fixture-notebook"]';
    await p.evaluate(`document.querySelector(${JSON.stringify(memorySelector)}).scrollIntoView({block:'center'})`);
    await p.point(memorySelector);
    await until(() => p.evaluate('observedRegistry?.current?.source.source_ref.kind === "memory"'), 'Notebook opens in the ordinary reader');
    await replace(p, 'Writing stays pinned to this Notebook revision');
    await p.point('#source-body span:first-child'); await p.key('Enter');
    await p.send('Page.setInterceptFileChooserDialog', { enabled: true }); await p.point('#add-image');
    const chooser = await until(() => p.events.find(e => e.method === 'Page.fileChooserOpened'), 'Notebook reply image reservation');
    await p.send('DOM.setFileInputFiles', { backendNodeId: chooser.params.backendNodeId, files: [path.join(root, 'tests/fixtures/media/screen.png')] });
    await until(() => hasText(p, '#writing-attachments', 'Ready'), 'Notebook reply image ready');
    await p.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
    await p.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 1 });
    await until(() => p.evaluate('matchMedia("(max-width:760px)").matches && document.getAnimations().every(a=>a.playState!=="running")'), 'mobile reader layout');
    const writingBox = await p.box('#writing-body');
    const before = await p.evaluate('freshSnapshot()'); assert.ok(before.quotes.length);
    const revised = await revise('A newer Notebook passage, offered explicitly');
    await until(() => p.evaluate('!document.querySelector("#revision-offer").hidden'), 'discoverable newer revision offer');
    const held = await p.evaluate('freshSnapshot()');
    for (const key of ['presentation','sourceObject','editorObject','generation','pending','shows','source','sourceText','editorSource','key','cycle','body','quotes','focus','caret','scroll']) assert.deepEqual(held[key], before[key], key);
    assert.equal((await p.box('#writing-body')).height, writingBox.height, 'the revision offer consumes no writing space');
    await tap(p, '#revision-offer span');
    assert.equal((await p.evaluate('freshSnapshot()')).presentation, before.presentation, 'nearby notice text does not open the revision');
    await p.point('#writing-body'); await p.send('Input.insertText', { text: ' more writing' });
    assert.equal(await p.evaluate('document.querySelector("#revision-offer").hidden'), false, 'ordinary status paint keeps the offer');
    const written = await p.evaluate('freshSnapshot()');
    await tap(p, '#open-revision');
    await until(() => p.evaluate(`observedRegistry.current.source.source_ref.revision > ${before.source.revision}`), 'explicit revision action opens newer source');
    const opened = await p.evaluate('freshSnapshot()');
    for (const key of ['editorObject','editorSource','key','cycle','body','quotes']) assert.deepEqual(opened[key], written[key], key);
    assert.notEqual(opened.presentation, written.presentation); assert.equal(opened.shows, written.shows + 1);
    assert.equal(await hasText(p, '#writing-attachments', 'screen.png'), true, 'selected image stays in the pinned writing cycle');
    await p.point('#reader-close');
    await until(() => p.evaluate('!document.querySelector("#reader").open'), 'reader closes before live paging');
    const burst = await control({ method: 'seed', messages: 55, memory_items: 0 });
    await until(() => p.evaluate(`Boolean(document.querySelector('#messages [data-id="${burst.message_ids.at(-1)}"]'))`), 'more than thirty incoming messages caught up', 12000);
    const all = await p.evaluate('[...document.querySelectorAll("#messages [data-id]")].map(e=>e.dataset.id)');
    assert.equal(new Set(all).size, all.length);
    assert.ok([...older, ...burst.message_ids].every(id => all.includes(id)), 'loaded history and every incoming message remain');
    observations.push({ name: 'paging and revision', revision, revised, frontier, before, held, written, opened, loadedBefore: older.length, loadedAfter: all.length });
    assert.deepEqual(p.errors, []); await shot(p, 'freshness-revision');
  });

  await check('freshness C6 foreground cancellation retains the genuine format2 row and bytes', async () => {
    const p = await page('freshness-kept-bytes', null, true); await p.open(1);
    await replace(p, 'Exact writing and image survive a deferred proof');
    const holdId = operation('cleanup-bootstrap'), beforeEvents = await control({ method: 'admission_events' });
    await control({ method: 'read_hold', hold_id: holdId, name: 'bootstrap', phase: 'callback', read_class: 'background' });
    try {
      await p.send('Page.setInterceptFileChooserDialog', { enabled: true }); await p.point('#add-image');
      const chooser = await until(() => p.events.find(e=>e.method==='Page.fileChooserOpened'), 'format2 image picker');
      await p.send('DOM.setFileInputFiles', { backendNodeId: chooser.params.backendNodeId, files: [path.join(root, 'tests/fixtures/media/screen.png')] });
      await until(() => hasText(p, '#writing-attachments', 'Ready'), 'format2 image ready');
      const held = await until(async () => (await control({ method: 'admission_events', after: beforeEvents.next })).events.find(e=>e.event==='hold-enter' && e.hold_id===holdId), 'real uploadProof bootstrap held');
      const key = await p.evaluate('observedRegistry.current.editors.reply.key');
      const retained = async () => p.evaluate(`(async()=>{const key=${JSON.stringify(key)},r=observedRegistry,j=r.journal,row=await j.own(key),entry=row?.snapshot.uploadState?.entries.find(e=>e.selected),bytes=entry?.bytes_ref?await j.readBytes(key,entry.bytes_ref):null;return {rowId:row?.id,format:row?.snapshot.format,source:row?.snapshot.sourceRef,body:row?.snapshot.draft.body,bytesRef:entry?.bytes_ref,byteCount:bytes?.blob.size,sha256:bytes?Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',await bytes.blob.arrayBuffer()))).map(x=>x.toString(16).padStart(2,'0')).join(''):null,cleanupError:r.sessions.get(key).editor.cleanupError??null}})()`);
      const before = await retained(); assert.equal(before.format, 2); assert.ok(before.byteCount > 0); assert.equal(before.sha256.length, 64);
      await p.point('#reader-close'); await until(() => p.evaluate('!document.querySelector("#reader").open'), 'close before foreground navigation');
      await p.open(0);
      await until(() => p.evaluate('uploadProofEvidence.some(e=>e.error==="CLEANUP_DEFERRED")'), 'genuine proof deferred by foreground reservation');
      const after = await retained(); assert.deepEqual(after, before, 'owned row, pin, writing and exact byte digest survive interruption');
      const during = await control({ method: 'admission_events', after: beforeEvents.next });
      assert.ok(!during.events.some(e=>e.request_id===held.request_id && e.event==='released'), 'client deferral did not release Store ownership');
      const current = await p.evaluate('freshSnapshot()');
      await control({ method: 'read_release', hold_id: holdId });
      await until(async () => (await control({ method: 'admission_events', after: beforeEvents.next })).events.some(e=>e.request_id===held.request_id && e.event==='released'), 'late Store completion releases its own permit');
      const settled = await p.evaluate('freshSnapshot()');
      for (const name of ['presentation','sourceObject','editorObject','generation','shows','source','key','cycle','body','quotes']) assert.deepEqual(settled[name], current[name], 'late completion preserves '+name);
      observations.push({ name: 'format2 foreground deferral', held, before, after, current, settled, proof: await p.evaluate('uploadProofEvidence'), events: during });
      assert.deepEqual(p.errors, []);
    } finally { await control({ method: 'read_release', hold_id: holdId }); }
  });

  await check('freshness F2 revision offer survives delayed summary and a newer commit during explicit opening', async () => {
    const p = await page('freshness-offer-race', null, true);
    await p.evaluate('document.querySelector(\'#memory-items [data-id="fixture-notebook"]\').scrollIntoView({block:"center"})');
    await p.point('#memory-items [data-id="fixture-notebook"]');
    await until(() => p.evaluate('window.observedRegistry?.current?.source.source_ref.kind==="memory"'), 'ordinary Notebook presentation');
    await replace(p, 'Pinned writing stays with the original revision'); await idleRead(p);
    const before = await p.evaluate('freshSnapshot()');
    p.intercept(payload => payload?.name==='memory_items' && payload.args.limit===1 || payload?.name==='source' && payload.args.kind==='memory');
    const revision = await revise('Offer from the key before its summary is released');
    const summary = await until(() => p.held.find(h=>h.payload?.name==='memory_items'), 'keyed summary response held');
    await until(() => p.evaluate('!document.querySelector("#revision-offer").hidden'), 'change key alone offers the revision');
    assert.equal((await p.evaluate('freshSnapshot()')).shows, before.shows);
    await p.point('#open-revision');
    const source = await until(() => p.held.find(h=>h.payload?.name==='source'), 'explicit revision source captured');
    const captured = await p.response(source.event);
    assert.ok(captured.source_ref.revision > before.source.revision);
    const newer = await revise('A key arriving after the explicit source was captured');
    // The old keyed read was canceled by foreground opening. Only the exact
    // explicit source response is released; the next feed window finds newer.
    p.intercept(null); await p.release(source);
    await until(() => p.evaluate(`observedRegistry.current.source.source_ref.revision===${captured.source_ref.revision}`), 'captured explicit source becomes current');
    await until(() => p.evaluate(`document.querySelector('#open-revision').textContent==='Open revision ${captured.source_ref.revision+1}' && !document.querySelector('#revision-offer').hidden`), 'later key offers its newer revision');
    const after = await p.evaluate('freshSnapshot()');
    for (const key of ['editorObject','editorSource','key','cycle','body','quotes']) assert.deepEqual(after[key], before[key], key);
    assert.equal(after.shows, before.shows + 1);
    await p.evaluate('window.staleRevisionOffer=document.querySelector("#open-revision").onclick');
    await p.point('#reader-close'); await until(() => p.evaluate('!document.querySelector("#reader").open'), 'close offered revision');
    await p.open(1); const replacement = await p.evaluate('freshSnapshot()');
    await p.evaluate('staleRevisionOffer()');
    assert.deepEqual(await p.evaluate('freshSnapshot()'), replacement, 'a retained old handler cannot reopen a replaced source');
    observations.push({ name: 'revision timing', before, after, replacement, revision, newer, captured, summaryInput: summary.payload,
      qualification: 'Open and close are native; the final stale-handler guard is an explicit handler probe, not a native-click claim.' });
    assert.deepEqual(p.errors, []);
  });

  await check('freshness F1 baseline precedes captured old initial messages and Notebook', async () => {
    const countsBefore = await control({ method: 'counts' });
    const schedule = []; let messageHeld = false, memoryHeld = false, incoming;
    const p = await page('freshness-initial', null, true, { beforeNavigate: async p => {
      p.intercept(async (payload, event) => {
        if (payload?.name === 'changes' && !payload.args.cursor) schedule.push({ kind: 'baseline', at: Date.now(), body: await p.response(event) });
        if (payload?.name === 'topic_messages' && !messageHeld) {
          messageHeld = true;
          const old = await p.response(event); assert.ok(!old.items.some(x => x.body === 'Incoming during captured old messages'));
          schedule.push({ kind: 'old-messages', at: Date.now(), body: old });
          await p.point('#refresh'); await p.point('#refresh');
          incoming = await message('Incoming during captured old messages');
          schedule.push({ kind: 'message-commit-before-release', at: Date.now(), receipt: incoming });
        } else if (payload?.name === 'memory_items' && !memoryHeld) {
          memoryHeld = true; const old = await p.response(event);
          assert.ok(!old.items.some(x => x.body === 'Notebook revised during captured old list'));
          schedule.push({ kind: 'old-notebook', at: Date.now(), body: old });
          const receipt = await revise('Notebook revised during captured old list');
          schedule.push({ kind: 'notebook-commit-before-release', at: Date.now(), receipt });
        }
        return false;
      });
    } });
    assert.equal(schedule[0].kind, 'baseline');
    assert.equal(schedule.filter(e => e.kind === 'baseline').length, 1, 'Refresh during initial loading shares the existing startup');
    await until(() => hasText(p, '#messages', 'Incoming during captured old messages'), 'automatic incoming message after old body');
    await until(() => hasText(p, '#memory-items', 'Notebook revised during captured old list'), 'automatic Notebook summary after old body');
    assert.ok(messageHeld && memoryHeld);
    // Since 4a372d2 the page reports the other actors' messages on screen as
    // read (docs/agents.md, "The browser reports what a person has seen";
    // docs/attention.md). Reading changes sends nothing else: every command is
    // such a report over rendered cards that starts and ends on another
    // actor's message, and Core records exactly those reports and the
    // deliveries they settle. A report can still be in flight when the cards
    // paint, so the counts are read once every request has its answer.
    const commandRequests = () => p.network.filter(e => e.method === 'Network.requestWillBeSent' && e.params.request.url.endsWith('/api/command')).length;
    const commands = () => p.calls.filter(c => c.url.endsWith('/api/command'));
    const countsAfter = await until(async () => {
      const sent = commandRequests(), counts = await control({ method: 'counts' });
      return sent === commands().length && sent === commandRequests() && counts.http_commands - countsBefore.http_commands === sent ? counts : null;
    }, 'every command the page sent was answered');
    const reports = commands();
    assert.deepEqual(reports.map(c => c.payload?.kind).filter(kind => kind !== 'topic.read_through'), [], 'reading changes sends nothing but what the person has seen');
    const rendered = await p.evaluate('Object.fromEntries([...document.querySelectorAll("#messages [data-seq]")].map(e=>[e.dataset.seq,e.classList.contains("own-message")]))');
    for (const { payload } of reports) {
      const { from_seq: from, seq: through } = payload.args;
      assert.equal(payload.target.topic_id, 't1');
      for (let seq = from; seq <= through; seq++) assert.ok(String(seq) in rendered, `report ${from}..${through} holds only rendered messages`);
      assert.ok(rendered[from] === false && rendered[through] === false, `report ${from}..${through} starts and ends on another actor's message`);
    }
    for (const key of ['http_media_publications', 'http_delivery_acks', 'media']) assert.equal(countsAfter[key], countsBefore[key], key);
    const recorded = countsAfter.read_through_operations - countsBefore.read_through_operations;
    assert.equal(recorded, reports.length, 'every command was a recorded read-through report');
    assert.equal(countsAfter.acknowledged_deliveries - countsBefore.acknowledged_deliveries,
      countsAfter.read_through_acknowledged - countsBefore.read_through_acknowledged, 'only the read-through reports settled deliveries');
    assert.equal(countsAfter.messages, countsBefore.messages + 1, 'only the explicitly attributed fixture message was published');
    assert.equal(countsAfter.operations, countsBefore.operations + 4 + recorded, 'only the three fixture send operations, one Notebook revision and the read-through reports were recorded');
    const cards = await p.evaluate('[...document.querySelectorAll("#messages [data-id]")].map(e=>e.dataset.id)');
    assert.equal(new Set(cards).size, cards.length);
    observations.push({ name: 'initial race', schedule, countsBefore, countsAfter, changes: p.calls.filter(c => c.payload?.name === 'changes') });
    await shot(p, 'freshness-initial'); assert.deepEqual(p.errors, []);
  });

  await check('freshness F4 incoming changes preserve selection writing and a held native picker', async () => {
    const p = await page('freshness-native', null, true); await p.open(1);
    await replace(p, 'Exact private writing remains');
    await p.point('#source-body span:first-child'); await p.key('Enter');
    assert.match(await field(p), /> Source 1 exact passage/);
    await p.key('z', 4); assert.equal(await field(p), 'Exact private writing remains', 'native quote Undo');
    const selection = await p.evaluate('(()=>{const text=document.querySelector("#source-body span:first-child").firstChild;const first=document.createRange(),last=document.createRange();first.setStart(text,0);first.setEnd(text,1);last.setStart(text,5);last.setEnd(text,6);const a=first.getBoundingClientRect(),b=last.getBoundingClientRect();return {x:a.left+.1,y:a.top+a.height/2,end:b.right-.1}})()');
    await p.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: selection.x, y: selection.y });
    await p.send('Input.dispatchMouseEvent', { type: 'mousePressed', button: 'left', clickCount: 1, x: selection.x, y: selection.y });
    await p.send('Input.dispatchMouseEvent', { type: 'mouseMoved', button: 'left', buttons: 1, x: selection.end, y: selection.y });
    await p.send('Input.dispatchMouseEvent', { type: 'mouseReleased', button: 'left', clickCount: 1, x: selection.end, y: selection.y });
    assert.equal(await p.evaluate('getSelection().toString()'), 'Source', 'native drag selects the intended exact word');
    const sourceBox = await p.box('#source-body');
    await p.send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: sourceBox.x+20, y: sourceBox.y+sourceBox.height/2, deltaX: 0, deltaY: 140 });
    await until(() => p.evaluate('document.querySelector("#source-body").scrollTop>0'), 'native reading scroll');
    const selectedBefore = await p.evaluate('freshSnapshot()');
    await message('Incoming while a native passage selection stays in place');
    await until(() => hasText(p, '#messages', 'Incoming while a native passage selection stays in place'), 'incoming message preserves native selection');
    const selectedAfter = await p.evaluate('freshSnapshot()');
    for (const key of ['presentation','sourceObject','editorObject','generation','shows','source','editorSource','key','cycle','body','quotes','selected','range','focus','caret','scroll']) assert.deepEqual(selectedAfter[key], selectedBefore[key], key);
    observations.push({ name: 'native selected passage', selectedBefore, selectedAfter });
    await p.send('Page.setInterceptFileChooserDialog', { enabled: true });
    await p.point('#add-image');
    const chooser = await until(() => p.events.find(e => e.method === 'Page.fileChooserOpened'), 'browser file chooser reservation');
    const before = await p.evaluate('freshSnapshot()'); assert.ok(before.reservation);
    assert.ok(before.cycle, 'the image cycle instrument must name the real cycle');
    const started = Date.now(), receipt = await message('Incoming while image picker reserved');
    await until(() => hasText(p, '#messages', 'Incoming while image picker reserved'), 'automatic update with picker still held');
    const after = await p.evaluate('freshSnapshot()');
    for (const key of ['presentation', 'sourceObject', 'editorObject', 'generation', 'pending', 'shows', 'source', 'editorSource', 'key', 'cycle', 'body', 'quotes', 'reservation', 'focus', 'caret', 'scroll']) {
      assert.deepEqual(after[key], before[key], `background update preserves ${key}`);
    }
    await p.send('DOM.setFileInputFiles', { backendNodeId: chooser.params.backendNodeId, files: [path.join(root, 'tests/fixtures/media/screen.png')] });
    await until(() => hasText(p, '#writing-attachments', 'Ready'), 'same reserved image selection becomes ready');
    assert.equal(await field(p), before.body);
    observations.push({ name: 'native picker', before, after, receipt, commitToObservedMs: Date.now() - started,
      qualification: 'Browser chooser activation and same input assignment; OS picker dismissal is not claimed.' });
    await shot(p, 'freshness-picker'); assert.deepEqual(p.errors, []);
  });

  await check('freshness F1 finite continuation and same-binding resync preserve the reader', async () => {
    const p = await page('freshness-window', null, true); await p.open(1);
    p.recordResponses();
    await replace(p, 'Keep this reader through a scoped resync');
    const before = await p.evaluate('freshSnapshot()'), countsBefore = await control({ method: 'counts' });
    const schedule = []; let captured = false, resyncing = false, baselineCaptured = false, initialHeld = false, releaseInitial;
    const initialGate = new Promise(resolve => { releaseInitial = resolve; });
    p.intercept(async (payload, event) => {
      if (event.request.url.endsWith('/api/bootstrap') && resyncing) schedule.push({ kind: 'resync-bootstrap', body: await p.response(event) });
      if (payload?.name !== 'changes') return false;
      const body = await p.response(event);
      if (!initialHeld) {
        initialHeld = true; schedule.push({ kind: 'before-burst-response', body });
        await initialGate; return false;
      }
      if (!captured && body.has_more) {
        captured = true; schedule.push({ kind: 'partial-window', cursor: payload.args.cursor, body });
        const receipt = await message('Committed after the captured finite window');
        schedule.push({ kind: 'after-window-commit', receipt });
      }
      if (resyncing && !payload.args.cursor) {
        assert.equal(baselineCaptured, false); baselineCaptured = true;
        schedule.push({ kind: 'resync-baseline', body });
        const receipt = await message('Committed after the replacement same-binding baseline');
        schedule.push({ kind: 'after-baseline-commit', receipt });
      }
      return false;
    });
    await until(() => initialHeld, 'captured feed response before the burst');
    let burst;
    try { burst = await control({ method: 'seed', messages: 55, memory_items: 0 }); }
    finally { releaseInitial(); }
    await until(() => hasText(p, '#messages', 'Committed after the captured finite window'), 'next feed window catches the later commit', 12000);
    assert.equal(captured, true);
    const ids = await p.evaluate('[...document.querySelectorAll("#messages [data-id]")].map(x=>x.dataset.id)');
    assert.ok(burst.message_ids.every(id => ids.includes(id))); assert.equal(new Set(ids).size, ids.length);
    resyncing = true; await fault('changes', 'RESYNC_REQUIRED');
    await until(() => hasText(p, '#messages', 'Committed after the replacement same-binding baseline'), 'same-binding resync catches up', 12000);
    assert.ok(baselineCaptured);
    assert.ok(p.responses.some(r=>r.payload?.name==='changes' && r.body.error?.code==='RESYNC_REQUIRED'));
    assert.ok(schedule.findIndex(x=>x.kind==='resync-bootstrap') < schedule.findIndex(x=>x.kind==='resync-baseline'));
    const after = await p.evaluate('freshSnapshot()');
    for (const key of ['presentation','sourceObject','editorObject','generation','pending','shows','source','editorSource','key','cycle','body','quotes','focus','caret','scroll']) assert.deepEqual(after[key], before[key], key);
    const countsAfter = await control({ method: 'counts' });
    // Draft autosaves remain owned by writing; freshness never publishes.
    assert.equal(p.calls.some(c => ['message.send','submission.prepare','delivery.ack'].includes(c.payload?.kind)), false);
    for (const key of ['http_media_publications','http_delivery_acks','acknowledged_deliveries','media']) assert.equal(countsAfter[key], countsBefore[key], key);
    observations.push({ name: 'finite window and resync', schedule, before, after, countsBefore, countsAfter });
    assert.deepEqual(p.errors, []);
  });

  await check('freshness inline interrupted availability rechecks and resumes dirty autosave without sending', async () => {
    const p = await page('inline-interrupted-access', null, true); await p.open(1);
    await p.point('#reader-close'); await until(() => p.evaluate('!document.querySelector("#reader").open'), 'Reader closed');
    await idleRead(p);
    await p.evaluate('document.querySelector("#inline-writing-body").scrollIntoView({block:"center"})');
    await p.point('#inline-writing-body'); await p.send('Input.insertText', { text: 'Dirty writing survives an interrupted access check' });
    const id = 'inline-interrupted-availability';
    await control({ method: 'read_hold', hold_id: id, name: 'editor_state', read_class: 'background', phase: 'callback', count: 1 });
    await p.evaluate('(()=>{observedFreshness.invalidate("availability",0,true);observedFreshness.request();})()');
    await until(async () => (await control({ method: 'admission_events' })).events.some(e => e.event === 'hold-enter' && e.hold_id === id), 'inline availability read actually held');
    assert.equal(await p.evaluate('observedRegistry.inline.availabilityUnconfirmed'), true);
    // The actual message-card open starts a foreground read and interrupts the
    // freshness epoch; no direct call to the availability handler or interrupt.
    await p.open(1);
    await until(() => p.evaluate('!observedRegistry.inline.availabilityChecking'), 'canceled inline check releases checking');
    assert.equal(await p.evaluate('observedRegistry.inline.availabilityUnconfirmed'), true, 'cancellation is not proof of restored access');
    assert.equal(await p.evaluate('observedRegistry.inline.editors.reply.unavailable'), true);
    assert.equal(await p.evaluate('document.querySelector("#inline-retry").hidden'), false, 'Retry exists once the check ends');
    assert.equal(await p.evaluate('observedFreshness.dirty.has("availability")'), true, 'one existing dirty-key queue retains the recheck');
    await control({ method: 'read_release', hold_id: id });
    await until(() => p.evaluate('!observedRegistry.inline.availabilityUnconfirmed && !observedRegistry.inline.editors.reply.unavailable'), 'automatic fenced recheck confirms access');
    await until(async () => (await view('editor_state', { source_ref: { kind: 'topic', id: 't1' }, topic_id: 't1' })).draft?.body === 'Dirty writing survives an interrupted access check', 'dirty inline save resumes after access confirmation');
    assert.equal(p.calls.some(c => ['message.send','submission.prepare'].includes(c.payload?.kind)), false);
    await p.point('#reader-close'); await until(() => p.evaluate('!document.querySelector("#reader").open'), 'Reader closes with inline writing retained');
    assert.equal(await p.evaluate('document.querySelector("#inline-writing-body").value'), 'Dirty writing survives an interrupted access check');
    observations.push({ name: 'inline interrupted access recheck', calls: p.calls }); assert.deepEqual(p.errors, []);
  });

  await check('freshness F5 topic denial preserves a directly readable source and disables its destination', async () => {
    const p = await page('freshness-topic-access', null, true); await p.open(1);
    p.recordResponses();
    await replace(p, 'Keep writing when the topic becomes unavailable'); await idleRead(p);
    // This permission-response schedule begins after the writing owner's
    // existing save/proof. Otherwise that proof can consume the injected
    // editor_state refusal before the access recheck being measured.
    await until(() => p.evaluate('(()=>{const e=observedRegistry.current.editors.reply;return e.localVersion===e.ackVersion})()'), 'existing private writing acknowledged');
    await p.evaluate('observedRegistry.cleanup.idle(observedRegistry.current.editors.reply.key)');
    const before = await p.evaluate('freshSnapshot()');
    const state = await view('editor_state', { source_ref: before.source, topic_id: 't1' });
    assert.equal(state.source_available, true); state.destination_available = false;
    // Inline and modal now both read editor_state. The old unscoped fault
    // could feed this modal identity to inline; target the source under test.
    await control({ method: 'read_fault', name: 'editor_state', source_ref: before.source, read_class: 'background', status: 200, body: state, count: 1 });
    await fault('changes', 'FORBIDDEN');
    await until(() => p.evaluate('observedFreshness.stopped && observedRegistry.current.destinationAvailable===false && !observedRegistry.current.availabilityUnconfirmed'), 'readable source with refused topic destination');
    const after = await p.evaluate('freshSnapshot()');
    assert.ok(p.responses.some(r=>r.payload?.name==='changes' && r.body.error?.code==='FORBIDDEN'));
    assert.ok(p.responses.some(r=>r.payload?.name==='editor_state' && r.body.source_available && r.body.destination_available===false));
    for (const key of ['presentation','sourceObject','editorObject','shows','source','sourceText','editorSource','key','cycle','body','quotes','focus','caret','scroll']) assert.deepEqual(after[key], before[key], key);
    assert.equal(await p.evaluate('document.querySelector("#messages").hidden'), true);
    assert.equal(await p.evaluate('document.querySelector("#quote-selection").disabled'), false);
    assert.equal(await p.evaluate('document.querySelector("#send-reply").disabled'), true);
    assert.equal(p.calls.some(c => ['message.send','submission.prepare','delivery.ack'].includes(c.payload?.kind)), false);
    observations.push({ name: 'topic-only denial', before, after, qualification: 'Real HTTP error/state response seam, not a backend permission-transition proof.' });
    assert.deepEqual(p.errors, []);
  });

  await check('freshness F5 denied source fences an already captured image response', async () => {
    const p = await page('freshness-permission', null, true); await p.open(0);
    p.recordResponses();
    await replace(p, 'Private writing kept after source denial'); await idleRead(p);
    p.intercept((payload, event) => event.request.url.includes('/api/media') || payload?.name === 'source');
    const button = await p.evaluate('(()=>{const b=[...document.querySelectorAll("#source-attachments button")].find(x=>x.textContent.startsWith("Open "));if(b)b.id="held-source-media";return Boolean(b)})()');
    assert.ok(button); await p.point('#held-source-media');
    const media = await until(() => p.held.find(h => h.event.request.url.includes('/api/media')), 'captured media response before permission loss');
    await fault('source', 'FORBIDDEN'); await fault('changes', 'FORBIDDEN');
    const source = await until(() => p.held.find(h => h.payload?.name === 'source'), 'captured exact source refusal');
    await p.point('#toggle-note');
    assert.equal(await p.evaluate('observedRegistry.current.mode'), 'note', 'mode changes retain the same source lifetime');
    await p.release(source);
    await until(() => p.evaluate('window.observedRegistry?.current?.sourceUnavailable === true'), 'exact source is refused');
    assert.ok(p.responses.some(r=>r.payload?.name==='source' && r.body.error?.code==='FORBIDDEN'));
    assert.equal(await p.evaluate('document.querySelector("#source-body").textContent'), '');
    await p.release(media);
    assert.equal(await p.evaluate('document.querySelector("#source-attachments").children.length'), 0, 'late media cannot restore inaccessible content');
    const deniedAccess = await p.evaluate('({liveMediaURLs:observedMediaURLs.size,retryVisible:Boolean(document.querySelector("#retry-source") && !document.querySelector("#retry-source").hidden),statusRole:document.querySelector("#source-access-status")?.getAttribute("role")??null})');
    observations.push({ name: 'denied source controls and bytes', deniedAccess });
    assert.deepEqual(deniedAccess, { liveMediaURLs: 0, retryVisible: true, statusRole: 'status' }, 'no retained inaccessible media; an explained, discoverable access Retry inside the modal');
    await p.point('#toggle-note');
    assert.equal(await field(p), 'Private writing kept after source denial');
    assert.equal(await p.evaluate('document.querySelector("#quote-selection").disabled'), true);
    assert.equal(await p.evaluate('document.querySelector("#send-reply").disabled'), true);
    p.intercept(null);
    for (let i = 0; i < 15 && await p.evaluate('document.activeElement.id') !== 'retry-source'; ++i) await p.key('Tab', 8);
    assert.equal(await p.evaluate('document.activeElement.id'), 'retry-source', 'source retry is keyboard reachable');
    const refusedBefore = await p.evaluate('freshSnapshot()'), callsBefore = p.calls.length, responsesBefore = p.responses.length;
    await fault('source', 'FORBIDDEN'); await p.key('Enter');
    await until(() => p.calls.slice(callsBefore).some(c => c.payload?.name === 'source'), 'explicit still-refused source read');
    await until(() => p.evaluate('!document.querySelector("#retry-source").disabled'), 'still-refused retry finished');
    const refusedAfter = await p.evaluate('freshSnapshot()');
    assert.ok(p.responses.slice(responsesBefore).some(r=>r.payload?.name==='source' && r.body.error?.code==='FORBIDDEN'));
    for (const key of ['editorSource','key','cycle','body','quotes']) assert.deepEqual(refusedAfter[key], refusedBefore[key], key);
    assert.equal(refusedAfter.focus, 'retry-source');
    assert.equal(await p.evaluate('document.querySelector("#source-attachments").children.length'), 0);
    assert.equal(p.calls.slice(callsBefore).some(c => c.payload?.kind), false, 'an access retry is only a read');
    const regrantCalls = p.calls.length; await p.key('Enter');
    await until(() => p.evaluate('document.querySelector("#retry-source").hidden && document.activeElement.id==="source-body"'), 'source-only regrant preserves focus inside the reader');
    const restored = await p.evaluate('freshSnapshot()');
    for (const key of ['editorSource','key','cycle','body','quotes']) assert.deepEqual(restored[key], refusedBefore[key], key);
    assert.ok(await p.evaluate('document.querySelectorAll("#source-attachments button").length>0'), 'real attachment actions return after confirmed access');
    assert.equal(await p.evaluate('observedFreshness.stopped'), true, 'source Retry does not restart denied topic polling');
    assert.equal(p.calls.slice(regrantCalls).some(c => c.payload?.name === 'changes' || c.payload?.kind), false);
    observations.push({ name: 'late source media', mediaCapturedAt: media.event.responseStatusCode, state: await p.evaluate('freshSnapshot()') });
    await shot(p, 'freshness-denied'); assert.deepEqual(p.errors, []);
  });

  await check('freshness F5 authority refusal parks durable writing and explicit Retry reaches owned reads', async () => {
    const p = await page('freshness-park', null, true); await p.open(1);
    p.recordResponses();
    await replace(p, 'Park this exact private writing');
    await fault('changes', 'INVALID_BINDING');
    await until(() => p.evaluate('observedRegistry.current.editors.reply.authorityRecovery?.phase === "parked"'), 'park-only recovery state');
    assert.ok(p.responses.some(r=>r.payload?.name==='changes' && r.body.error?.code==='INVALID_BINDING'));
    const kept = await p.evaluate('(await observedRegistry.journal.own(observedRegistry.current.editors.reply.key)).snapshot');
    assert.equal(kept.draft.body, 'Park this exact private writing'); assert.equal(kept.authorityRecovery.phase, 'parked');
    const baselineCalls = p.calls.length;
    await new Promise(resolve => setTimeout(resolve, 700));
    assert.equal(p.calls.slice(baselineCalls).some(c => c.url.endsWith('/api/bootstrap')), false, 'park has no automatic probe');
    assert.equal(p.calls.some(c => ['message.send','submission.prepare','delivery.ack'].includes(c.payload?.kind)), false);
    await p.point('#review-versions');
    await fault('bootstrap', 'INVALID_BINDING');
    const beforeRetry = p.calls.length; await p.point('#review-retry');
    await until(() => hasText(p, '#review-status', 'Could not read'), 'refused binding probe remains reviewable');
    assert.ok(p.responses.some(r=>r.url.endsWith('/api/bootstrap') && r.body.error?.code==='INVALID_BINDING' && r.status===409));
    assert.ok(p.calls.slice(beforeRetry).some(c => c.url.endsWith('/api/bootstrap')));
    const beforeSecondRetry = p.calls.length; await p.point('#review-retry');
    await until(() => p.evaluate('observedRegistry.current.editors.reply.authorityRecovery?.phase === "blocked"'), 'unchanged authority is not adopted');
    assert.ok(p.calls.slice(beforeSecondRetry).some(c => c.url.endsWith('/api/bootstrap')));
    assert.ok(p.calls.slice(beforeSecondRetry).some(c => c.payload?.name === 'editor_state'));
    assert.equal(await field(p), 'Park this exact private writing');
    assert.equal(await p.evaluate('document.querySelector("#review-save").disabled'), true);
    observations.push({ name: 'park and explicit retry', retained: kept, retryCalls: p.calls.slice(beforeRetry) });
    await shot(p, 'freshness-parked'); assert.deepEqual(p.errors, []);
  });

  for (const [status, code, reconnect] of [[401,'SESSION_REQUIRED',true], [403,'ORIGIN_REFUSED',true], [200,'VIEW_TOO_LARGE',false], [400,'INVALID_READ_CLASS',false], [200,'MALFORMED_INSTANCE',false]]) {
    await check(`freshness F5 boundary ${code} stops without automatic adoption or reconnect`, async () => {
      const p = await page('freshness-boundary-'+code, null, true); await p.open(1);
      await replace(p, 'Writing retained at '+code); p.recordResponses();
      const before = await p.evaluate('freshSnapshot()');
      if (code==='MALFORMED_INSTANCE') await control({ method:'read_fault', name:'changes', status:200, count:1, body:{instance_id:'wrong-instance'} });
      else await fault('changes', code, status);
      await until(()=>p.evaluate('observedFreshness.stopped'), 'explicit stop for '+code);
      assert.ok(p.responses.some(r=>r.payload?.name==='changes' && r.status===status && (code==='MALFORMED_INSTANCE' ? r.body.instance_id==='wrong-instance' : r.body.error?.code===code)), 'the measured boundary response was received');
      const after = await p.evaluate('freshSnapshot()');
      for (const key of ['presentation','sourceObject','editorObject','generation','shows','source','editorSource','key','cycle','body','quotes','focus','caret','scroll']) assert.deepEqual(after[key], before[key], key);
      assert.equal(await p.evaluate('document.querySelector("#updates-retry").textContent'), reconnect ? 'Reload to reconnect' : 'Retry updates');
      const reads = p.calls.filter(c=>c.payload?.name==='changes').length;
      const consumerReads = await p.evaluate('freshEvidence.reads.length');
      const foregroundBootstraps = () => p.calls.filter(c=>c.url.endsWith('/api/bootstrap') && !Object.entries(c.headers).some(([key,value])=>key.toLowerCase()==='x-aim-read-class'&&value==='background')).length;
      const probes = foregroundBootstraps();
      await new Promise(resolve=>setTimeout(resolve,650));
      assert.equal(p.calls.filter(c=>c.payload?.name==='changes').length, reads, 'no automatic Changes retry');
      assert.equal(await p.evaluate('freshEvidence.reads.length'), consumerReads, 'freshness does not issue an automatic probe');
      assert.equal(foregroundBootstraps(), probes, 'no automatic reconnect or foreground authority probe');
      assert.equal(p.calls.some(c=>['message.send','submission.prepare','delivery.ack'].includes(c.payload?.kind)), false);
      assert.deepEqual(p.errors, []);
      observations.push({ name:'failure boundary', status, code, before, after, consumerReads, reads, probes, qualification:'Private HTTP response seam; explicit Reload is not activated. Existing image cleanup may still perform its own background bootstrap bracket.' });
    });
  }

  for (const sourceDenied of [false, true]) await check(`freshness correction A resync topic refusal checks source denied=${sourceDenied}`, async () => {
    const p = await page('correction-a', null, true); await p.open(1);
    await replace(p, 'Keep exact resync-denial writing');
    await until(() => p.evaluate('observedRegistry.current.editors.reply.localVersion===observedRegistry.current.editors.reply.ackVersion'), 'private save settled');
    await p.evaluate('observedRegistry.cleanup.idle(observedRegistry.current.editors.reply.key)');
    await idleRead(p); p.recordResponses();
    const before = await p.evaluate('freshSnapshot()');
    if (sourceDenied) await fault('source', 'FORBIDDEN');
    else {
      const state = await view('editor_state', { source_ref: before.source, topic_id: 't1' }); state.destination_available = false;
      // Since 4b03bc5 the inline composer's own editor_state read runs beside
      // this one and goes first; scope the refusal to the Reader's source.
      await control({ method:'read_fault', name:'editor_state', source_ref: before.source, read_class:'background', status:200, body:state, count:1 });
    }
    await fault('changes', 'RESYNC_REQUIRED'); await fault('changes', 'FORBIDDEN');
    await until(() => p.evaluate('observedFreshness.stopped'), 'resync denied');
    assert.ok(p.responses.some(r=>r.payload?.name==='changes' && !r.payload.args.cursor && r.body.error?.code==='FORBIDDEN'), 'the replacement baseline was refused');
    assert.equal(await p.evaluate('document.querySelector("#messages").hidden'), true, 'resync denial hides topic content');
    await until(() => p.evaluate('!observedRegistry.current.availabilityChecking'), 'independent source check complete');
    const after = await p.evaluate('freshSnapshot()');
    for (const key of ['presentation','editorObject','key','cycle','body','quotes','editorSource']) assert.deepEqual(after[key], before[key], key);
    assert.equal(after.sourceText, sourceDenied ? '' : before.sourceText);
    assert.equal(await p.evaluate('document.querySelector("#quote-selection").disabled'), sourceDenied);
    assert.equal(await p.evaluate('document.querySelector("#send-reply").disabled'), true);
    assert.ok(p.responses.some(r=>r.payload?.name==='source'));
    if (!sourceDenied) assert.ok(p.responses.some(r=>r.payload?.name==='editor_state' && r.payload.args.source_ref?.kind==='message' && r.body.source_available && r.body.destination_available===false), 'the Reader itself was told its destination is unavailable');
    observations.push({name:'correction A',sourceDenied,before,after}); assert.deepEqual(p.errors, []);
  });

  await check('freshness correction B diagnostic stop keeps native Refresh usable without restarting updates', async () => {
    const p = await page('correction-b-refresh', null, true); await p.open(1);
    await replace(p, 'Private writing across manual Refresh');
    const before = await p.evaluate('freshSnapshot()');
    await p.point('#reader-close'); await until(() => p.evaluate('!document.querySelector("#reader").open'), 'header available after reader close');
    await fault('changes', 'INVALID_ARGUMENT'); await until(() => p.evaluate('observedFreshness.stopped'), 'diagnostic stop');
    const incoming = await message('New message while updates are stopped'), checkpoint = await p.evaluate('observedFreshness.checkpoint');
    const calls = p.calls.length;
    await p.evaluate('document.querySelector("#refresh").scrollIntoView({block:"center"})'); await p.point('#refresh');
    await until(() => hasText(p, '#messages', 'New message while updates are stopped'), 'manual Refresh paints the new message', 2500);
    assert.equal(await p.evaluate('observedFreshness.stopped'), true);
    assert.deepEqual(await p.evaluate('observedFreshness.checkpoint'), checkpoint);
    assert.ok(await hasText(p, '#updates-message', 'INVALID_ARGUMENT'));
    assert.equal(p.calls.slice(calls).some(c=>c.payload?.name==='changes'), false);
    await p.open(1); const after = await p.evaluate('freshSnapshot()');
    for (const key of ['editorObject','key','cycle','body','quotes','source','editorSource']) assert.deepEqual(after[key], before[key], key);
    observations.push({name:'correction B diagnostic Refresh',incoming,before,after}); assert.deepEqual(p.errors, []);
  });

  await check('freshness correction B denied Refresh explains Retry and never repaints cached content', async () => {
    const p = await page('correction-b-denied', null, true); await p.open(1);
    await replace(p, 'Kept through refused manual refresh'); await p.point('#reader-close');
    await until(() => p.evaluate('!document.querySelector("#reader").open'), 'reader closed');
    await fault('changes','FORBIDDEN'); await until(() => p.evaluate('observedFreshness.stopped'), 'topic refused');
    const oldCards = await p.evaluate('document.querySelector("#messages").innerHTML');
    await message('Must not paint after topic denial');
    await p.evaluate('document.querySelector("#refresh").scrollIntoView({block:"center"})');
    await p.point('#refresh');
    await until(() => hasText(p,'#app-status','Topic unavailable. Use Retry updates.'), 'explicit denied Refresh guidance',2500);
    await until(() => p.evaluate('appReadState().loads===0'), 'manual reads settled');
    assert.equal(await p.evaluate('document.querySelector("#messages").hidden'),true);
    assert.equal(await p.evaluate('document.querySelector("#messages").innerHTML'),oldCards);
    await fault('topic_messages','FORBIDDEN'); await p.point('#refresh');
    await until(() => hasText(p,'#app-status','Fixture FORBIDDEN'), 'manual refusal visible');
    assert.equal(await p.evaluate('document.querySelector("#messages").hidden'),true);
    assert.deepEqual(p.errors, []);
  });

  for (const transition of ['denial','authority']) await check(`freshness correction B late manual read cannot paint after ${transition}`, async () => {
    const p = await page('correction-b-late', null, true); await p.open(1);
    await replace(p,'Retained while a manual list is held'); await p.point('#reader-close');
    await until(() => p.evaluate('!document.querySelector("#reader").open'), 'reader closed');
    await fault('changes','INVALID_ARGUMENT'); await until(() => p.evaluate('observedFreshness.stopped'), 'diagnostic stopped');
    const oldCards=await p.evaluate('document.querySelector("#messages").innerHTML');
    await message('Held manual response '+transition);
    p.intercept(payload=>payload?.name==='topic_messages' && payload.args.limit===30);
    await p.evaluate('document.querySelector("#refresh").scrollIntoView({block:"center"})'); await p.point('#refresh');
    const held=await until(()=>p.held[0], 'manual list answer held',2500);
    // The foreground manual read intentionally defers background dispatch.
    // Inject the app's real access transition callbacks while that response
    // is held; this is a paint-race proof, not a claim of a native denial act.
    // Denial goes through stopDenied, as a refused Changes read does; since
    // 4b03bc5 its recheck also reads the inline composer's topic access, which
    // a denied topic refuses. The Reader is closed, so it never reads a source.
    await p.evaluate(transition==='denial'
      ? '(async()=>{await observedFreshness.stopDenied({kind:"forbidden",code:"FORBIDDEN",message:"Fixture FORBIDDEN"},name=>{if(name==="source")throw Error("no source is open");return Promise.reject(Object.assign(Error("Fixture FORBIDDEN"),{code:"FORBIDDEN"}))},()=>true)})()'
      : '(async()=>{const b=observedFreshness.bootstrap;await observedFreshness.authorityLost({instance_id:b.instance_id,actor_id:b.actor,...b.authority},{code:"INVALID_BINDING"});observedFreshness.status({kind:"authority",code:"INVALID_BINDING"})})()');
    await until(()=>hasText(p,'#updates-message',transition==='denial'?'topic is unavailable':'runtime changed'),'access transition before late manual answer');
    p.intercept(null); await p.release(held);
    await until(()=>p.evaluate('appReadState().loads===0'),'late manual operation settled');
    assert.equal(await p.evaluate('document.querySelector("#messages").innerHTML'),oldCards,'late answer cannot paint through a newer access gate');
    const calls=p.calls.length; await p.point('#refresh');
    await until(()=>hasText(p,'#app-status',transition==='denial'?'Topic unavailable. Use Retry updates.':'Review'),'manual refresh explains current gate');
    if(transition==='authority') assert.equal(p.calls.slice(calls).some(c=>c.payload?.name==='topic_messages'||c.payload?.name==='memory_items'),false);
    observations.push({name:'correction B late paint',transition,qualification:'Native Refresh and real held HTTP response; access transition injected through actual app callbacks because the foreground reservation intentionally defers background dispatch.'});
    assert.deepEqual(p.errors, []);
  });

  await check('freshness correction C command recovery changes binding before held freshness settles', async () => {
    const p=await page('correction-c',null,true); await p.open(1); await replace(p,'Writing before epoch');
    await until(()=>p.evaluate('observedRegistry.current.editors.reply.localVersion===observedRegistry.current.editors.reply.ackVersion'),'private writing saved');
    await p.evaluate('observedRegistry.cleanup.idle(observedRegistry.current.editors.reply.key)');
    let heldOnce=false;
    p.intercept(payload=>payload?.name==='changes' && !heldOnce && (heldOnce=true));
    const held=await until(()=>p.held[0],'old changes response held');
    const checkpoint=await p.evaluate('observedFreshness.checkpoint');
    const nextEpoch=operation('epoch'); await control({method:'epoch',epoch:nextEpoch,complete:false,drop_private:true});
    await replace(p,'Exact writing after command-first epoch');
    await until(()=>p.evaluate(`observedRegistry.runtime.current.authority_epoch===${JSON.stringify(nextEpoch)}`),'actual command recovery bootstrap wins');
    const before=await p.evaluate('({snapshot:freshSnapshot(),recovery:observedRegistry.current.editors.reply.authorityRecovery,attempts:observedRegistry.sessionFor(observedRegistry.current.editors.reply).attempts})');
    assert.ok(p.calls.some(c=>c.payload?.kind==='draft.save' && c.payload.expected.authority.authority_epoch!==nextEpoch));
    p.intercept(null); await p.release(held);
    await until(()=>p.evaluate('observedFreshness.stopped'),'binding mismatch stops freshness',2500);
    assert.ok(await hasText(p,'#updates-message','runtime changed'));
    const after=await p.evaluate('({snapshot:freshSnapshot(),recovery:observedRegistry.current.editors.reply.authorityRecovery,attempts:observedRegistry.sessionFor(observedRegistry.current.editors.reply).attempts})');
    for(const key of ['editorObject','key','cycle','body','quotes','source','editorSource']) assert.deepEqual(after.snapshot[key],before.snapshot[key],key);
    assert.deepEqual(after.recovery,before.recovery,'newer recovery review remains intact'); assert.deepEqual(after.attempts,before.attempts);
    assert.deepEqual(await p.evaluate('observedFreshness.checkpoint'),checkpoint);
    assert.equal(await p.evaluate('observedFreshness.timer'),null);
    assert.equal(p.calls.some(c=>['submission.prepare','message.send'].includes(c.payload?.kind)),false);
    observations.push({name:'correction C command-first',before,after,checkpoint}); assert.deepEqual(p.errors, []);
  });

  for(const name of ['topic_messages','memory_items']) await check(`freshness correction E typed startup ${name} refusal leaves startup retry intact`, async () => {
    await fault(name,'DATABASE_BUSY');
    const p=await page('correction-e-'+name,null,true,{allowStartupError:true});
    await until(()=>p.evaluate('window.appReadState && !appReadState().startup'),'actual initialization rejected');
    assert.ok(await hasText(p,'#app-status','DATABASE_BUSY'));
    assert.notEqual(await p.evaluate('document.body.dataset.ready'),'true');
    assert.deepEqual(await p.evaluate('appReadState()'),{journal:false,registry:false,reader:false,startup:false,loads:0},'typed startup refusal precedes all editor and journal setup');
    assert.equal(await p.evaluate('document.querySelectorAll(".message-card,.memory-card").length'),0);
    assert.equal(p.calls.some(c=>c.payload?.kind),false);
    const calls=p.calls.length; await p.point('#refresh');
    await until(()=>p.evaluate('document.body.dataset.ready==="true" && Boolean(window.observedFreshness)'),'native Refresh restarts complete initialization');
    const names=p.calls.slice(calls).filter(c=>c.payload?.name).map(c=>c.payload.name);
    assert.ok(names.indexOf('changes')>=0 && names.indexOf('changes')<names.indexOf('topic_messages') && names.indexOf('changes')<names.indexOf('memory_items'));
    // Messages on screen are marked read; restarting writes nothing else.
    assert.deepEqual(p.calls.filter(c=>c.payload?.kind && c.payload.kind!=='topic.read_through').map(c=>c.payload.kind),[]); assert.deepEqual(p.errors, []);
    observations.push({name:'correction E startup',list:name,readOrder:names});
  });

  await check('freshness F5 transient reads back off and explicit diagnostic retry resumes', async () => {
    await control({ method: 'seed', messages: 35, memory_items: 0 });
    const p = await page('freshness-errors', null, true);
    await p.open(1); await p.point('#reader-close'); await until(()=>p.evaluate('!document.querySelector("#reader").open'), 'reader closed for page Retry');
    p.recordResponses();
    for (const [status, code] of [[503, 'SERVER_BUSY'], [500, 'REQUEST_UNCONFIRMED'], [503, 'CAPABILITIES_UNAVAILABLE']]) {
      await fault('changes', code, status);
      await until(() => hasText(p, '#updates-message', 'Updates delayed'), `visible ${code} delay`);
      assert.ok(p.responses.some(r=>r.payload?.name==='changes' && r.status===status && r.body.error?.code===code), 'the injected refusal was actually received');
      assert.deepEqual(await p.evaluate('[...observedRegistry.sessions.values()].map(s=>s.editor.cleanupError??null)'), [null,null], 'a server delay never reports a cleanup failure');
      const failedAt = p.calls.at(-1).at;
      await until(() => p.evaluate('document.querySelector("#updates-status").hidden'), `healthy read after ${code}`);
      const requests = p.calls.filter(c => c.payload?.name === 'changes' && c.at >= failedAt);
      assert.ok(requests.length <= 3, 'one pending retry, no request pile');
      observations.push({ name: 'transient read', status, code, requests });
    }
    await fault('changes', 'INVALID_ARGUMENT');
    await until(() => p.evaluate('observedFreshness.stopped'), 'diagnostic stop');
    const atStop = p.calls.length; await new Promise(resolve => setTimeout(resolve, 650));
    assert.equal(p.calls.length, atStop, 'malformed/nonretryable reads do not become polling');
    await p.evaluate('window.scrollTo(0,document.body.scrollHeight)');
    assert.ok((await p.box('#updates-retry')).y < 0, 'the pointer control is deliberately offscreen');
    await assert.rejects(p.point('#updates-retry'), /inside the viewport/, 'the native pointer instrument must reject an offscreen target');
    await p.evaluate('document.querySelector("#updates-retry").scrollIntoView({block:"center"})');
    await p.point('#updates-retry');
    await until(() => p.evaluate('!observedFreshness.stopped && document.querySelector("#updates-status").hidden'), 'explicit retry restores reads');
    assert.equal(p.calls.filter(c => c.url.endsWith('/api/command')).length, 0);
    await shot(p, 'freshness-read-retry'); assert.deepEqual(p.errors, []);
  });
}

import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return{promise,resolve};};
export async function topicCloseFlows({browser,control,facts,result,out,engine,canary=false,observe}){
 let serial=0;
 const kinds=canary?['heldUndo','readerDone']:['heldUndo','refusalArchive','refusalDone','lostReload','readerDone','readerArchive','waitingUndo','railDone','otherTopicArchive','storageFailure','laterNavigation','explicitRead','peerUndo','keyboardDone','remoteDone'];
 if(process.env.AIM_1000_FLOW)assert.ok(kinds.includes(process.env.AIM_1000_FLOW),'requested flow exists');
 const topic=async()=> (await control({method:'agent_view',actor:facts.actor,name:'topic',args:{topic_id:'t1'}})).topic;
 const journal=page=>page.evaluate(()=>new Promise((resolve,reject)=>{const req=indexedDB.open('theseus-topic-close',1);req.onsuccess=()=>{const db=req.result;const tx=db.transaction('actions');const get=tx.objectStore('actions').getAll();get.onsuccess=()=>resolve(get.result);tx.oncomplete=()=>db.close();tx.onerror=()=>reject(tx.error);};req.onerror=()=>reject(req.error);}));
 const assertOutcome=async page=>{
  await page.waitForFunction(()=>location.search==='?workspace=w1'&&document.body.dataset.ready==='true'&&document.querySelector('#outline a.ol-name[data-workspace-id="w1"][aria-current="page"]'));
  assert.equal(await page.locator('#reader').evaluate(n=>n.open),false,'Reader closes on departure');
  assert.equal(await page.locator('#outline a[data-topic-id="t1"]').evaluateAll(nodes=>nodes.filter(n=>!n.closest('.topic-group')).length),0,'current topic absent from active rail');
 };
 for(const width of canary?[1280]:[1280,390])for(const look of canary?['bookends']:['bookends','paper'])for(const kind of kinds.filter(k=>!process.env.AIM_1000_FLOW||k===process.env.AIM_1000_FLOW)){
  const label=`${engine}-${width}-${look}-${kind}`,cell={label,kind,requests:[],errors:[]};result.flows??=[];result.flows.push(cell);
  await control({method:'topic_state',operation_id:`1000-flow-reset-${++serial}`,topic_id:'t1',args:{archived:false,state:kind==='waitingUndo'?'waiting':'review',...(kind==='waitingUndo'?{waiting_on:[facts.agent]}:{}),note:'Kept original note'}});
  const context=await browser.newContext({viewport:{width,height:900},colorScheme:look==='bookends'?'dark':'light',hasTouch:width===390,isMobile:width===390});
  await context.addInitScript(look=>localStorage.setItem('theseus-look',look==='paper'?'paper':''),look);
  let page=await context.newPage(),peer,release;
  const attach=p=>{p.setDefaultTimeout(12000);p.on('pageerror',e=>cell.errors.push(e.stack));p.on('request',q=>{let payload;try{payload=q.postDataJSON();}catch{}if(payload)cell.requests.push({url:q.url(),payload,at:performance.now()});});};attach(page);
  const press=async locator=>width===390?locator.tap():locator.click();
  const ready=async(p=page)=>{await p.waitForFunction(()=>document.body.dataset.ready==='true'&&!document.documentElement.hasAttribute('data-rails-reading'));};
  const keptRow=async(p=page)=>{const rows=await journal(p);const row=rows.find(r=>r.topic.id==='t1');assert.ok(row);return row;};
  const archive=kind==='refusalArchive'||kind==='readerArchive';
  const reveal=async id=>{
   if(width===390&&await page.locator('#rail-open').getAttribute('aria-expanded')!=='true')await press(page.locator('#rail-open'));
   const disclosure=page.locator('#outline .ol-disclosure[aria-controls="ol-topics-w1"]');
   if(await disclosure.getAttribute('aria-expanded')!=='true')await press(disclosure);
   await page.locator(`#outline a[data-topic-id="${id}"]`).waitFor({state:'visible'});
  };
  const act=async()=>{
   if(kind==='railDone'||kind==='otherTopicArchive'){
    await reveal('t1');const row=page.locator('#outline a[data-topic-id="t1"]');
    if(width===390){await row.focus();await page.keyboard.press('Shift+F10');}else await row.click({button:'right'});
    await press(page.getByRole('menuitem',{name:kind==='railDone'?'Mark Done':'Archive',exact:true}));
   }else if(kind==='keyboardDone'){
    await page.locator('#settings-open').focus();let stops=0;
    while(!await page.locator('#topic-description .mark-done').evaluate(n=>n===document.activeElement)&&stops++<4)await page.keyboard.press(engine==='webkit'?'Alt+Tab':'Tab');
    assert.equal(await page.locator('#topic-description .mark-done').evaluate(n=>n===document.activeElement&&n.matches(':focus-visible')),true);
    await page.keyboard.press(width===390?'Space':'Enter');cell.nativeKeyboard=true;
   }else if(kind==='waitingUndo'){
    await press(page.locator('#settings-open'));await press(page.locator('#topic-state button[data-state="done"]'));
   }else if(kind.startsWith('reader')){
    await press(page.locator('#reader-menu'));await press(page.getByRole('menuitem',{name:archive?'Archive topic':'Mark topic done',exact:true}));
   }else if(archive){await press(page.locator('#settings-open'));await press(page.locator('#topic-settings button').filter({hasText:/^Archive$/}));}
   else await press(page.locator('#topic-description .mark-done'));
  };
  try{
   const reader=kind.startsWith('reader');
   await page.goto(`${facts.origin}/?topic=${kind==='otherTopicArchive'?'close1000-flow-other':'t1'}${reader?'&message='+facts.sources[0].id:''}`);await ready();
   if(reader){
    await page.locator('#reader[open]').waitFor();await press(page.locator('#writing-body'));await page.keyboard.press('Meta+A');await page.keyboard.press('Backspace');await page.keyboard.insertText(`Saved Reader words ${label}`);
   }
   if(kind==='remoteDone'){
    await control({method:'topic_state',operation_id:`1000-remote-done-${++serial}`,topic_id:'t1',args:{state:'done',note:'Other device done note'}});
    await page.waitForFunction(()=>document.querySelector('#topic-description')?.textContent.includes('Done Other device done note'));assert.equal(new URL(page.url()).searchParams.get('topic'),'t1','remote state never departs this person');
    await press(page.locator('#settings-open'));await press(page.locator('#topic-state-note'));await page.keyboard.press('Meta+A');await page.keyboard.insertText(`Note after remote Done ${label}`);await page.keyboard.press('Enter');await page.waitForFunction(words=>document.querySelector('#topic-description')?.textContent.includes(words),`Note after remote Done ${label}`);assert.equal((await topic()).state_note,`Note after remote Done ${label}`);cell.remoteDonePreservesReading=true;
   }else if(kind==='storageFailure'){
    await page.evaluate(()=>{window.original1000Transaction=IDBDatabase.prototype.transaction;IDBDatabase.prototype.transaction=function(name,mode,...rest){if(this.name==='theseus-topic-close'&&mode==='readwrite')throw new DOMException('Controlled local keep refusal','QuotaExceededError');return original1000Transaction.call(this,name,mode,...rest);};});
    await act();await page.waitForFunction(()=>document.querySelector('#topic-close-notice')?.textContent?.includes('Controlled local keep refusal'));
    assert.equal(new URL(page.url()).searchParams.get('topic'),'t1');assert.equal((await topic()).state,'review');assert.equal(cell.requests.filter(r=>r.payload.kind==='topic.update').length,0);assert.equal((await journal(page)).length,0);
    await page.evaluate(()=>IDBDatabase.prototype.transaction=original1000Transaction);cell.storageFailureAdmitsNothing=true;
   }else if(['heldUndo','refusalArchive','refusalDone','laterNavigation','explicitRead','peerUndo'].includes(kind)){
    const entered=deferred(),hold=deferred();release=()=>hold.resolve();let intercepted=false;
    await page.route('**/api/command',async route=>{
     const q=route.request().postDataJSON();
     if(q.kind!=='topic.update'||q.target.topic_id!=='t1'||intercepted){await route.continue();return;}
     intercepted=true;cell.forward=structuredClone(q);entered.resolve();await hold.promise;await route.continue();
    });
    await act();await entered.promise;await assertOutcome(page);const row=await keptRow();
    assert.deepEqual(row.envelope,cell.forward,'local strict row keeps exact envelope');assert.equal(row.phase,'pending');assert.equal((await topic()).state,'review','held command has not reached Core');cell.keptBeforeService=true;
    if(kind==='heldUndo'){
     await press(page.locator('#topic-close-notice').getByRole('button',{name:'Undo',exact:true}));
     const waiting=await keptRow();assert.ok(waiting.undo.id);assert.equal(waiting.undo.envelope,null,'Undo waits for the actual forward result');
    }else if(kind==='refusalArchive'||kind==='refusalDone'){
     await control({method:'topic_state',operation_id:`1000-concurrent-${++serial}`,topic_id:'t1',args:{archived:kind==='refusalArchive',state:'active',note:'Other device keeps these words'}});
     // Archive's own field changed, so its captured archived=false fence refuses.
    }else if(kind==='laterNavigation'){
     await reveal('close1000-flow-other');await press(page.locator('#outline a[data-topic-id="close1000-flow-other"]'));await ready();
     await press(page.locator('#new-message'));await page.locator('#inline-writing-body').waitFor({state:'visible'});await press(page.locator('#inline-writing-body'));await page.keyboard.press('Meta+A');await page.keyboard.press('Backspace');await page.keyboard.insertText(`Later words ${label}`);
     cell.laterWords=`Later words ${label}`;
    }else if(kind==='explicitRead'){
     await press(page.locator('#topic-close-notice').getByRole('button',{name:'Open topic',exact:true}));
     await page.waitForFunction(()=>location.search==='?topic=t1'&&document.body.dataset.ready==='true');
     await press(page.locator('#new-message'));await page.locator('#inline-writing-body').waitFor({state:'visible'});await press(page.locator('#inline-writing-body'));await page.keyboard.press('Meta+A');await page.keyboard.press('Backspace');await page.keyboard.insertText(`Explicit later words ${label}`);cell.laterWords=`Explicit later words ${label}`;
    }else if(kind==='peerUndo'){
     peer=await context.newPage();attach(peer);await peer.goto(`${facts.origin}/?workspace=w1`);await ready(peer);
     await peer.locator('#topic-close-notice').getByRole('button',{name:'Undo',exact:true}).waitFor();
     await press(peer.locator('#topic-close-notice').getByRole('button',{name:'Undo',exact:true}));
     await peer.waitForFunction(()=>document.querySelector('#topic-close-notice')?.textContent?.includes('Restored'));
     assert.equal((await topic()).state,'review');cell.peerUndo=true;
    }
    release();
    if(kind==='heldUndo'||kind==='peerUndo'){
     await page.waitForFunction(()=>document.querySelector('#topic-close-notice')?.textContent?.includes('Restored'));assert.equal((await topic()).state,'review');
    }else if(kind==='refusalArchive'||kind==='refusalDone'){
     await page.waitForFunction(()=>/Could not (archive|mark done)/.test(document.querySelector('#topic-close-notice')?.textContent));
     const saved=await topic();assert.equal(saved.archived,kind==='refusalArchive');assert.equal(saved.state_note,'Other device keeps these words');
     assert.equal((await keptRow()).phase,'rejected');if(kind==='refusalDone'){await page.waitForFunction(()=>[...document.querySelectorAll('#outline a[data-topic-id="t1"]')].some(n=>!n.closest('.topic-group')));cell.refusalRestoredRow=true;}assert.match(await page.locator('#topic-close-notice').innerText(),/changed/i);
    }else{
     await page.waitForFunction(()=>document.querySelector('#topic-close-notice')?.textContent?.includes('Marked done'));
     assert.equal(new URL(page.url()).searchParams.get('topic'),kind==='explicitRead'?'t1':'close1000-flow-other');assert.equal(await page.locator('#inline-writing-body').inputValue(),cell.laterWords,'late receipt preserves later writing');
    }
   }else if(kind==='lostReload'){
    let first=true,allowReplay=false;
    await page.route('**/api/command',async route=>{
     const q=route.request().postDataJSON();
     if(q.kind==='topic.update'&&first){first=false;cell.forward=structuredClone(q);cell.actualReceipt=await (await route.fetch()).json();await route.abort('connectionreset');}
     else if(q.kind==='topic.update'&&!allowReplay)await route.abort('connectionreset');
     else await route.continue();
    });
    await act();await assertOutcome(page);await page.waitForFunction(()=>document.querySelector('#topic-close-notice')?.textContent?.includes('confirmation is unknown'));
    const before=await topic();allowReplay=true;await page.reload();await ready();
    await page.waitForFunction(()=>document.querySelector('#topic-close-notice')?.textContent?.includes('Marked done'));
    const row=await keptRow();assert.deepEqual(row.envelope,cell.forward);assert.deepEqual(row.receipt,cell.actualReceipt);assert.equal((await topic()).version,before.version,'replay has no second topic effect');
    const sent=cell.requests.filter(r=>r.payload.kind==='topic.update');assert.ok(sent.length>=2);for(const one of sent)assert.deepEqual(one.payload,sent[0].payload);cell.exactReplay=true;
    await press(page.locator('#topic-close-notice').getByRole('button',{name:'Undo',exact:true}));await page.waitForFunction(()=>document.querySelector('#topic-close-notice')?.textContent?.includes('Restored'));
   }else{
    await act();
    if(kind==='otherTopicArchive'){await page.waitForFunction(()=>document.querySelector('#topic-close-notice')?.textContent?.includes('Archived'));assert.equal(new URL(page.url()).searchParams.get('topic'),'close1000-flow-other');}
    else await assertOutcome(page);
    await page.waitForFunction(()=>document.querySelector('#topic-close-notice')?.textContent?.includes('Undo'));
    if(reader){const editor=await control({method:'agent_view',actor:facts.actor,name:'editor_state',args:{topic_id:'t1',source_ref:facts.sources[0]}});
     assert.equal(editor.draft.body,`Saved Reader words ${label}`,'normal departure guard keeps exact Reader writing');cell.readerWritingKept=true;}
    await press(page.locator('#topic-close-notice').getByRole('button',{name:'Undo',exact:true}));await page.waitForFunction(()=>document.querySelector('#topic-close-notice')?.textContent?.includes('Restored'));
    const saved=await topic();assert.equal(saved.state,kind==='waitingUndo'?'waiting':'review');assert.equal(saved.archived,false);
    if(kind==='waitingUndo')assert.deepEqual(saved.waiting_on,[facts.agent]);
    if(kind==='otherTopicArchive')assert.equal(new URL(page.url()).searchParams.get('topic'),'close1000-flow-other','another-topic act never steals the page');
   }
   cell.row=['storageFailure','remoteDone'].includes(kind)?null:await keptRow();
   if(cell.row?.phase==='undone'){await page.waitForFunction(()=>[...document.querySelectorAll('#outline a[data-topic-id="t1"]')].some(n=>!n.closest('.topic-group')));cell.undoRestoredActiveRail=true;}
   assert.deepEqual(cell.errors,[]);cell.passed=true;await page.screenshot({path:`${out}/${label}.png`});await observe();
   console.log(JSON.stringify({flow:label,passed:true}));
  }catch(error){cell.error=error.stack;await page.screenshot({path:`${out}/${label}-failure.png`}).catch(()=>{});await writeFile(`${out}/${label}-failure.html`,await page.content()).catch(()=>{});throw error;}
  finally{release?.();await context.close();}
 }
}

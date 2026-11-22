//1051 isolated native deletion, departure and restoration; strict owned cleanup.
import assert from 'node:assert/strict';
import {spawn,execFileSync} from 'node:child_process';
import {writeFileSync} from 'node:fs';
import {mkdir,mkdtemp,writeFile,readFile,rm,access} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import net from 'node:net';
import {fixtureControl} from './fixture_control.mjs';
const engines=await import(process.env.AIM_PLAYWRIGHT_CORE),engine=process.env.AIM_ENGINE??'chromium';
const selected=new RegExp(process.argv[3]??'');
const evidence=process.argv[2];await mkdir(evidence,{recursive:true});
const sourceFiles=['web/app.mjs','web/notebook-page.mjs','web/notebook-writing.mjs','web/notebook-sheet.mjs','web/notebook-delete-ui.mjs','web/in-place-navigation.mjs','web/rails.mjs','web/look.css','tests/fixtures/ui_http.py','tests/notebook_delete_1051_native.mjs'];
const hashes=Object.fromEntries(await Promise.all(sourceFiles.map(async path=>[path,createHash('sha256').update(await readFile(path)).digest('hex')])));
await writeFile(`${evidence}/source.json`,JSON.stringify({head:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),hashes},null,2));
for(const path of sourceFiles){const saved=`${evidence}/source/${path}`;await mkdir(saved.slice(0,saved.lastIndexOf('/')),{recursive:true});await writeFile(saved,await readFile(path));}
const savedResponses=new Set();
const fixture=spawn('/usr/bin/python3',['-B','tests/fixtures/ui_http.py','--freshness','--other-person']);
const {control,exit,errors}=fixtureControl(fixture),results=[],cleanup={},owned=new Set();
let browser,profile,origin,failure;
const processes=()=>execFileSync('/bin/ps',['-axo','pid=,ppid=,command='],{encoding:'utf8'}).trim().split('\n').map(line=>{const [,pid,ppid,command]=line.match(/^\s*(\d+)\s+(\d+)\s+(.*)$/);return {pid:+pid,ppid:+ppid,command};});
function retain(){const all=processes();for(let changed=true;changed;){changed=false;for(const p of all)if((owned.has(p.ppid)||profile&&p.command.includes(profile))&&!owned.has(p.pid)){owned.add(p.pid);changed=true;}}writeFileSync(`${evidence}/owned-processes.json`,JSON.stringify({profile,fixturePid:fixture.pid,ownedPids:[...owned]}));}

try {
 const facts=await control({method:'ready'});origin=facts.origin;await writeFile(`${evidence}/fixture.json`,JSON.stringify({origin,pid:fixture.pid}));
 profile=await mkdtemp(`${evidence}/${engine}-profile-`);const persistent=await engines[engine].launchPersistentContext(profile,{headless:true,...(engine==='chromium'?{executablePath:process.env.AIM_CHROME}:{})});browser=persistent.browser();retain();assert.ok(owned.size);
 for(const width of [320,375,390,1280])for(const look of ['bookends','paper']){
  const key=`${width}-${look}`;if(!selected.test(key))continue;
  const seeded=await control({method:'agent_topic',operation_id:`delete1051-${engine}-${key}`,title:'Delete Notebook1051',body:'A topic without Notebook pages.',team:true});
  const result={key,errors:[],requests:[],observations:[]},context=await browser.newContext({viewport:{width,height:900},hasTouch:width<=760,isMobile:width<=760,colorScheme:'light'});
  await context.addInitScript(look=>localStorage.setItem('theseus-look',look),look);const page=await context.newPage();page.setDefaultTimeout(9000);page.on('pageerror',e=>result.errors.push(e.stack));
  const served={},jobs=[];page.on('response',response=>{const path='web/'+new URL(response.url()).pathname.split('/').at(-1);if(Object.hasOwn(hashes,path)){const j=response.body().then(async b=>{served[path]=createHash('sha256').update(b).digest('hex');if(!savedResponses.has(path)){savedResponses.add(path);const saved=`${evidence}/served/${path}`;await mkdir(saved.slice(0,saved.lastIndexOf('/')),{recursive:true});await writeFile(saved,b);}});j.catch(()=>{});jobs.push(j);}});
  const views=new Set(),viewWaiters=[];let viewStarts=0;
  const viewDone=request=>{if(views.delete(request))for(const done of viewWaiters.splice(0))done();};page.on('requestfinished',viewDone);page.on('requestfailed',viewDone);
  const drainViews=async()=>{let rounds=0;for(;;){while(views.size)await new Promise(resolve=>viewWaiters.push(resolve));const before=viewStarts;await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));rounds++;if(!views.size&&viewStarts===before){(result.viewDrains??=[]).push({requests:viewStarts,pending:views.size,rounds});return;}}};
  page.on('request',request=>{if(new URL(request.url()).pathname==='/api/view'){views.add(request);viewStarts++;}try{const v=request.postDataJSON();if(v?.kind?.startsWith('memory.'))result.requests.push(v);}catch{}});
  const press=async node=>width<=760?node.tap():node.click();
  try {
   const title='Undo target '+key;
   const created=await control({method:'outcome_reference',operation_id:`delete-page-${engine}-${key}`,item_id:`delete1051-${engine}-${key}`,topic_id:seeded.topic_id,title,body:'## Kept\n\nEvery word stays in history.\n'});result.created=created;
   let oldTab;
   if(width===1280&&look==='bookends'){
    oldTab=await context.newPage();await oldTab.goto(origin+'/favicon.ico');await oldTab.evaluate(()=>new Promise((resolve,reject)=>{const r=indexedDB.open('theseus-notebook-writing-v1',2);r.onupgradeneeded=()=>{r.result.createObjectStore('writing');r.result.createObjectStore('images').createIndex('scope','scope');};r.onsuccess=()=>{window.oldNotebookDB=r.result;const tx=r.result.transaction(['writing','images'],'readwrite');tx.objectStore('writing').put({proof:'old unfinished writing'},'upgrade-proof');tx.objectStore('images').put({scope:'upgrade-proof',bytes:new Uint8Array([4,5,6])},['upgrade-proof','image']);tx.oncomplete=resolve;};r.onerror=()=>reject(r.error);}));
   }
   await page.goto(origin+'/?workspace=w1&page='+`delete1051-${engine}-${key}`);await page.locator('body[data-ready=true]').waitFor();
   if(oldTab){await page.getByText('Close older Notebook tabs, then reload to update safe device storage.',{exact:false}).first().waitFor();await oldTab.close();await drainViews();await page.reload();await page.locator('body[data-ready=true]').waitFor();
    result.upgrade=await page.evaluate(()=>new Promise((resolve,reject)=>{const r=indexedDB.open('theseus-notebook-writing-v1',3);r.onsuccess=()=>{const db=r.result,tx=db.transaction(['writing','images'],'readonly'),a=tx.objectStore('writing').get('upgrade-proof'),b=tx.objectStore('images').get(['upgrade-proof','image']);tx.oncomplete=()=>{resolve({version:db.version,writing:a.result,bytes:[...b.result.bytes]});db.close();};};r.onerror=()=>reject(r.error);}));assert.deepEqual(result.upgrade,{version:3,writing:{proof:'old unfinished writing'},bytes:[4,5,6]});await drainViews();await page.goto(origin+'/?workspace=w1&page='+`delete1051-${engine}-${key}`);await page.locator('body[data-ready=true]').waitFor();
   }

   const sheet=page.locator('#notebook-sheet-dialog[open]');await sheet.waitFor();await press(sheet.getByRole('button',{name:'This page',exact:true}));
   const dialogs=[];page.on('dialog',async d=>{dialogs.push(d.message());await d.accept();});
   await press(page.getByRole('menuitem',{name:'Delete',exact:true}));
   await sheet.waitFor({state:'hidden'});
   const notice=page.locator('#notebook-delete-notice');await notice.waitFor();await page.waitForFunction(()=>document.querySelector('#notebook-delete-notice')?.textContent.startsWith('Deleted'));
   result.dialogs=dialogs;result.sheetOpen=await sheet.count();result.notice=await notice.innerText();
   assert.equal(dialogs.length,0,'Delete closes without a confirmation dialog');assert.equal(result.sheetOpen,0,'Delete closes the Notebook page');
   const id=`delete1051-${engine}-${key}`;
   const state=async()=>control({method:'agent_view',actor:facts.actor,name:'memory_status',args:{item_id:id}});
   assert.equal((await state()).deleted,true);
   await page.waitForFunction(()=>!document.querySelector('.paper-ghost'));result.undoBounds=await notice.getByRole('button',{name:'Undo',exact:true}).evaluate(b=>{const r=b.getBoundingClientRect();return {width:r.width,height:r.height,x:r.x,right:r.right,visible:getComputedStyle(b).visibility,occluded:!b.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2))};});assert.ok(result.undoBounds.width>0&&result.undoBounds.height>0);assert.ok(result.undoBounds.x>=0&&result.undoBounds.right<=width);assert.equal(result.undoBounds.visible,'visible');assert.equal(result.undoBounds.occluded,false);
   await page.screenshot({path:`${evidence}/${key}-deleted.png`,fullPage:true});
   const documentToken=await page.evaluate(()=>window.notebookDeleteDocument=crypto.randomUUID());
   const home=page.getByRole('link',{name:'Theseus Outcomes',exact:true});if(!await home.isVisible())await press(page.locator('#rail-open'));
   await press(home);await page.waitForFunction(()=>!new URL(location.href).searchParams.has('workspace')&&document.body.dataset.ready==='true');
   result.inPlace={before:documentToken,after:await page.evaluate(()=>window.notebookDeleteDocument),href:page.url()};assert.equal(result.inPlace.after,documentToken,'Undo owner survives an actual in-place move to Outcomes');
   await notice.waitFor();await page.keyboard.press('Meta+z');await sheet.waitFor();await page.waitForFunction(()=>!document.querySelector('#notebook-delete-notice'));
   assert.equal((await state()).deleted,false);await page.waitForFunction(title=>document.querySelector('#notebook-sheet-title')?.textContent===title,title);assert.equal(await sheet.locator('.notebook-sheet-title').textContent(),title);
   await press(sheet.getByRole('button',{name:'This page',exact:true}));await press(page.getByRole('menuitem',{name:'Delete',exact:true}));await sheet.waitFor({state:'hidden'});
   await page.waitForFunction(()=>document.querySelector('#notebook-delete-notice')?.textContent.startsWith('Deleted'));await drainViews();await page.reload();await page.locator('body[data-ready=true]').waitFor();await notice.waitFor();
   assert.equal(await page.locator('#notebook-sheet-dialog[open]').count(),0,'reload does not reopen the deleted source');
   await press(notice.getByRole('button',{name:'Undo',exact:true}));await page.locator('#notebook-sheet-dialog[open]').waitFor();
   assert.equal((await state()).deleted,false);const current=await control({method:'agent_view',actor:facts.actor,name:'memory_current',args:{item_id:id}});
   assert.equal(current.body,'## Kept\n\nEvery word stays in history.\n');assert.equal(current.source_ref.revision,5);result.current=current;
   const original=await control({method:'agent_view',actor:facts.actor,name:'source',args:{source_ref:{kind:'memory',id,revision:1}}});assert.equal(original.body,current.body);result.original=original;
   await drainViews();await page.goto(origin+'/?cards='+id+'&view=cards');await page.locator('body[data-ready=true]').waitFor();
   await press(page.locator('#deck-page').getByRole('button',{name:'This page',exact:true}));await press(page.getByRole('menuitem',{name:'Delete',exact:true}));
   await page.waitForURL('**/?workspace=w1');await page.locator('body[data-ready=true]').waitFor();await notice.waitFor();
   await page.waitForFunction(()=>document.querySelector('#notebook-delete-notice')?.textContent.startsWith('Deleted'));
   assert.equal((await state()).deleted,true);await page.keyboard.press('Meta+z');await page.locator('#notebook-sheet-dialog[open]').waitFor();assert.equal((await state()).deleted,false);
   const deletes=result.requests.filter(r=>r.kind==='memory.delete');assert.deepEqual(deletes.map(r=>r.args.deleted),[true,false,true,false,true,false]);assert.equal(new Set(deletes.map(r=>r.operation_id)).size,6);
   if(width===1280&&look==='bookends'){
    const syntheticDialog=page.locator('#notebook-sheet-dialog[open]');await press(syntheticDialog.getByRole('button',{name:'This page',exact:true}));await press(page.getByRole('menuitem',{name:'Delete',exact:true}));await syntheticDialog.waitFor({state:'hidden'});await page.waitForFunction(()=>document.querySelector('#notebook-delete-notice')?.textContent.startsWith('Deleted'));
    result.syntheticHistoryUndo=await page.evaluate(()=>{const e=new InputEvent('beforeinput',{inputType:'historyUndo',bubbles:true,cancelable:true});document.body.dispatchEvent(e);return {trusted:e.isTrusted,prevented:e.defaultPrevented};});assert.deepEqual(result.syntheticHistoryUndo,{trusted:false,prevented:true});await syntheticDialog.waitFor();await page.waitForFunction(title=>document.querySelector('#notebook-sheet-title')?.textContent===title,title);assert.equal((await state()).deleted,false);
    result.pagination=await page.evaluate(async()=>{const scope=JSON.stringify(['ux-http-fixture','pagination-probe']);await new Promise((resolve,reject)=>{const r=indexedDB.open('theseus-notebook-writing-v1',3);r.onsuccess=()=>{const db=r.result,tx=db.transaction('deletions','readwrite');for(let i=0;i<22;i++){const key='probe-'+String(i).padStart(2,'0');tx.objectStore('deletions').put({scope,at:i,key,binding:{item_id:key},undo:{}},key);}tx.oncomplete=()=>{db.close();resolve();};tx.onerror=()=>reject(tx.error);};});const {notebookDeleted}=await import('/notebook-writing.mjs');const b={instance_id:'ux-http-fixture',actor:'pagination-probe'},a=await notebookDeleted(b),c=await notebookDeleted(b,globalThis,a.cursor),other=await notebookDeleted({...b,actor:'no-such-person'});return {first:a.rows.length,cursor:!!a.cursor,next:c.rows.length,end:c.cursor,unique:new Set([...a.rows,...c.rows].map(r=>r.key)).size,other:other.rows.length,newest:a.rows[0].key,oldest:c.rows.at(-1).key};});assert.deepEqual(result.pagination,{first:20,cursor:true,next:2,end:null,unique:22,other:0,newest:'probe-21',oldest:'probe-00'});
    let lose=true;await page.route('**/api/command',async route=>{const e=route.request().postDataJSON();if(lose&&e.kind==='memory.delete'&&e.args.deleted){lose=false;const answer=await route.fetch();result.lostReceipt=await answer.json();await route.abort();}else await route.continue();});
    let dialog=page.locator('#notebook-sheet-dialog[open]');await press(dialog.getByRole('button',{name:'This page',exact:true}));await press(page.getByRole('menuitem',{name:'Delete',exact:true}));await dialog.waitFor({state:'hidden'});
    await page.waitForFunction(()=>document.querySelector('#notebook-delete-notice')?.textContent.includes('Not confirmed yet'));assert.equal((await state()).deleted,true);result.uncertainNotice=await notice.innerText();
    const lost=result.requests.filter(r=>r.kind==='memory.delete').at(-1);await drainViews();await page.reload();await page.locator('body[data-ready=true]').waitFor();await page.waitForFunction(()=>document.querySelector('#notebook-delete-notice')?.textContent.startsWith('Deleted'));
    const retried=result.requests.filter(r=>r.kind==='memory.delete').at(-1);assert.deepEqual(retried,lost,'reload retries exact delete identity');await press(notice.getByRole('button',{name:'Undo',exact:true}));await dialog.waitFor();assert.equal((await state()).deleted,false);
    // A real competing Core revision while the native delete request is held causes Core refusal.
    let arrived,release;const held=new Promise(done=>arrived=done),gate=new Promise(done=>release=done);let hold=true;
    await page.unroute('**/api/command');await page.route('**/api/command',async route=>{const e=route.request().postDataJSON();if(hold&&e.kind==='memory.delete'&&e.args.deleted){hold=false;arrived();await gate;}await route.continue();});
    try{await press(dialog.getByRole('button',{name:'This page',exact:true}));await press(page.getByRole('menuitem',{name:'Delete',exact:true}));await held;await dialog.waitFor({state:'hidden'});const before=await state();assert.equal(before.deleted,false);
     const changed=await control({method:'memory_revise',operation_id:'race-'+engine,item_id:id,expected_revision:before.source_ref.revision,title,body:current.body});assert.equal(changed.status,'committed');result.competingRevision=changed;
    }finally{release();}
    await page.waitForFunction(()=>document.querySelector('#notebook-delete-notice')?.textContent.startsWith('Could not delete'));assert.equal((await state()).deleted,false);assert.equal(await notice.getByRole('button',{name:'Undo',exact:true}).count(),0);result.refusedNotice=await notice.innerText();
    await press(notice.getByRole('button',{name:'Open page',exact:true}));await dialog.waitFor();await page.waitForFunction(title=>document.querySelector('#notebook-sheet-title')?.textContent===title,title);assert.equal(await dialog.locator('.notebook-sheet-title').textContent(),title);await page.unroute('**/api/command');
    let arrivedUndo,releaseUndo;const reachedUndo=new Promise(done=>arrivedUndo=done),gateUndo=new Promise(done=>releaseUndo=done);let holdUndo=true;
    await page.route('**/api/command',async route=>{const e=route.request().postDataJSON();if(holdUndo&&e.kind==='memory.delete'&&e.args.deleted){holdUndo=false;arrivedUndo();await gateUndo;}await route.continue();});
    try{await press(dialog.getByRole('button',{name:'This page',exact:true}));await press(page.getByRole('menuitem',{name:'Delete',exact:true}));await reachedUndo;await dialog.waitFor({state:'hidden'});await page.keyboard.press('Meta+z');
     await page.waitForFunction(()=>document.querySelector('#notebook-delete-notice')?.textContent.startsWith('Restoring'));assert.equal((await state()).deleted,false);result.undoBeforeReceipt=true;
    }finally{releaseUndo();}
    await dialog.waitFor();await page.waitForFunction(title=>document.querySelector('#notebook-sheet-title')?.textContent===title,title);assert.equal((await state()).deleted,false);await page.unroute('**/api/command');
    let arrivedFull,releaseFull;const fullReached=new Promise(done=>arrivedFull=done),fullGate=new Promise(done=>releaseFull=done);let holdFull=true;
    await drainViews();await page.goto(origin+'/?cards='+id+'&view=cards');await page.locator('body[data-ready=true]').waitFor();
    await page.route('**/api/command',async route=>{const e=route.request().postDataJSON();if(holdFull&&e.kind==='memory.delete'&&e.args.deleted){holdFull=false;arrivedFull();await fullGate;}await route.continue();});
    try{await press(page.locator('#deck-page').getByRole('button',{name:'This page',exact:true}));await press(page.getByRole('menuitem',{name:'Delete',exact:true}));await page.waitForURL('**/?workspace=w1');await fullReached;await page.locator('body[data-ready=true]').waitFor();await page.keyboard.press('Meta+z');await page.waitForFunction(()=>document.querySelector('#notebook-delete-notice')?.textContent.startsWith('Restoring'));assert.equal((await state()).deleted,false);result.fullpageUndoBeforeReceipt=true;}finally{releaseFull();}
    await page.locator('#notebook-sheet-dialog[open]').waitFor();await page.waitForFunction(title=>document.querySelector('#notebook-sheet-title')?.textContent===title,title);assert.equal((await state()).deleted,false);await page.unroute('**/api/command');
   }
   const restoredSheet=page.locator('#notebook-sheet-dialog[open]');await restoredSheet.waitFor();
   await restoredSheet.evaluate(async el=>{for(const a of el.getAnimations({subtree:true}))if(Number.isFinite(a.effect?.getComputedTiming().endTime))await a.finished.catch(()=>{});});
   result.restoredPaint=await restoredSheet.evaluate(el=>{const s=getComputedStyle(el),b=el.querySelector('.notebook-sheet-body');return {opacity:s.opacity,visibility:s.visibility,body:b?.innerText??el.innerText,animations:el.getAnimations({subtree:true}).filter(a=>a.playState==='running'&&Number.isFinite(a.effect?.getComputedTiming().endTime)).length};});
   assert.equal(result.restoredPaint.opacity,'1');assert.equal(result.restoredPaint.visibility,'visible');assert.equal(result.restoredPaint.animations,0);assert.match(result.restoredPaint.body,/Every word stays in history/);
   await page.screenshot({path:`${evidence}/${key}-restored.png`,fullPage:true});
   await drainViews();await Promise.all(jobs);result.served=served;for(const [path,h]of Object.entries(served))assert.equal(h,hashes[path],path+' served');assert.deepEqual(result.errors,[]);result.passed=true;
  }catch(error){result.error=error.stack;await page.screenshot({path:`${evidence}/${key}-failure.png`,fullPage:true});await writeFile(`${evidence}/${key}-failure.html`,await page.content());}
  results.push(result);console.log(JSON.stringify({key,passed:result.passed,error:result.error?.split('\n')[0]}));await writeFile(`${evidence}/observations.json`,JSON.stringify(results,null,2));retain();await context.close();
 }
}catch(error){failure=error.stack;}
finally {
  if(browser){retain();await browser.close();}cleanup.disconnected=browser?!browser.isConnected():true;
  fixture.stdin.end();cleanup.fixtureExit=await exit;cleanup.fixtureErrors=errors();
  const ps=processes();cleanup.fixturePid=fixture.pid;cleanup.fixtureAbsent=!ps.some(p=>p.pid===fixture.pid);cleanup.ownedPids=[...owned];cleanup.remainingOwned=ps.filter(p=>owned.has(p.pid));cleanup.profileProcesses=profile?ps.filter(p=>p.command.includes(profile)):[];
  if(profile&&cleanup.disconnected&&!cleanup.remainingOwned.length&&!cleanup.profileProcesses.length)await rm(profile,{recursive:true});
  cleanup.profileAbsent=profile?await access(profile).then(()=>false,()=>true):null;
  cleanup.portClosed=origin?await new Promise(resolve=>{const u=new URL(origin),s=net.createConnection({host:u.hostname,port:+u.port});s.once('connect',()=>{s.destroy();resolve(false);});s.once('error',()=>resolve(true));}):null;
  await writeFile(`${evidence}/results.json`,JSON.stringify({engine,results,cleanup,failure},null,2));
  const endHashes=Object.fromEntries(await Promise.all(sourceFiles.map(async path=>[path,createHash('sha256').update(await readFile(path)).digest('hex')])));
  await writeFile(`${evidence}/end-source.json`,JSON.stringify({hashes:endHashes,same:JSON.stringify(endHashes)===JSON.stringify(hashes)},null,2));
}
assert.equal(cleanup.disconnected,true);assert.equal(cleanup.fixtureExit.code,0);assert.equal(cleanup.fixtureErrors,'');assert.equal(cleanup.fixtureAbsent,true);assert.equal(cleanup.portClosed,true);assert.equal(cleanup.profileAbsent,true);assert.deepEqual(cleanup.remainingOwned,[]);assert.deepEqual(cleanup.profileProcesses,[]);
for(const path of sourceFiles)assert.equal(createHash('sha256').update(await readFile(path)).digest('hex'),hashes[path]);
assert.equal(failure,undefined);assert.ok(results.length);assert.ok(results.every(r=>r.passed),'inspect retained failures');console.log(JSON.stringify({passed:results.length,cleanup}));

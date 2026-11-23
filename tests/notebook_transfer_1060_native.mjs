// Private headless-engine proof: actual menu keys/taps and native pointer drag,
// real HTTP/Core and IndexedDB. Never a live account or a physical-device claim.
import assert from 'node:assert/strict';
import {spawn,execFileSync} from 'node:child_process';
import {mkdir,mkdtemp,writeFile,readFile,rm,access} from 'node:fs/promises';
import {writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import net from 'node:net';
import {fixtureControl} from './fixture_control.mjs';
const engines=await import(process.env.AIM_PLAYWRIGHT_CORE),engine=process.env.AIM_ENGINE??'chromium';
const evidence=process.argv[2],selected=new RegExp(process.argv[3]??'');await mkdir(evidence,{recursive:true});
const rows=[],cleanup={},owned=new Set();
let browser,profile,origin,bodyError;
const processes=()=>execFileSync('/bin/ps',['-axo','pid=,ppid=,command='],{encoding:'utf8'}).trim().split('\n').map(line=>{const [,pid,ppid,command]=line.match(/^\s*(\d+)\s+(\d+)\s+(.*)$/);return {pid:+pid,ppid:+ppid,command};});
function retain(){const all=processes();for(let changed=true;changed;){changed=false;for(const p of all)if((owned.has(p.ppid)||profile&&p.command.includes(profile))&&!owned.has(p.pid)){owned.add(p.pid);changed=true;}}writeFileSync(`${evidence}/owned-processes.json`,JSON.stringify({profile,fixturePid:fixture.pid,ownedPids:[...owned]}));}
const selectedWeb=['aim.css','app.mjs','notebook-delete-ui.mjs','notebook-page.mjs','notebook-rail-menu.mjs','notebook-writing.mjs','outcome-references.mjs','outline-dossiers.mjs','outline-menus.mjs','topic-link-route.mjs','topic-views.mjs','notebook-transfer.mjs','notebook-transfer-drag.mjs'];
const webFiles=[];for(const f of selectedWeb)if(await access('web/'+f).then(()=>true,()=>false))webFiles.push(f);
const digests=Object.fromEntries(await Promise.all(webFiles.map(async f=>[f,createHash('sha256').update(await readFile('web/'+f)).digest('hex')])));
const fixture=spawn('/usr/bin/python3',['-B','tests/fixtures/ui_http.py','--freshness','--other-person']);
const {control,exit,errors}=fixtureControl(fixture);
try{
 const facts=await control({method:'ready',runtime_evidence:true});origin=facts.origin;await writeFile(`${evidence}/fixture.json`,JSON.stringify(facts));
 profile=await mkdtemp(`${evidence}/${engine}-private-profile-`);
 const persistent=await engines[engine].launchPersistentContext(profile,{headless:true,...(engine==='chromium'?{executablePath:process.env.AIM_CHROME}:{})});browser=persistent.browser();retain();assert.ok(owned.size);
 for(const width of [1280,390])for(const look of ['bookends','paper']){
  const key=`${width}-${look}`;if(!selected.test(key))continue;
  const row={key,checks:[],errors:[],requests:[],served:{}},context=await browser.newContext({viewport:{width,height:900},hasTouch:width===390,isMobile:width===390});
  await context.addInitScript(look=>localStorage.setItem('theseus-look',look),look);
  const page=await context.newPage();page.setDefaultTimeout(10000);page.on('pageerror',e=>row.errors.push(e.stack));const served=[];
  const active=new Set();let starts=0;
  page.on('request',r=>{if(['/api/view','/api/command'].includes(new URL(r.url()).pathname)){active.add(r);starts++;}});
  const ended=r=>active.delete(r);page.on('requestfinished',ended);page.on('requestfailed',ended);
  const drain=async()=>{for(const end=Date.now()+10000;Date.now()<end;){const before=starts;
    if(!active.size){await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));if(!active.size&&starts===before){(row.drains??=[]).push({starts,pending:0});return;}}
    await new Promise(r=>setTimeout(r,25));
   }assert.fail('Fixture navigation would abandon '+active.size+' API requests');};
  page.on('response',response=>{const f=new URL(response.url()).pathname.split('/').at(-1);if(webFiles.includes(f)){const task=response.body().then(async b=>{row.served[f]=createHash('sha256').update(b).digest('hex');await mkdir(`${evidence}/served`,{recursive:true});await writeFile(`${evidence}/served/${f}`,b);});task.catch(()=>{});served.push(task);}});
  page.on('request',r=>{try{const e=r.postDataJSON();if(e?.kind?.startsWith('memory.'))row.requests.push(e);}catch{}});
  const press=async locator=>width===390?locator.tap():locator.click();
  const check=async(name,job)=>{await job();row.checks.push({name,passed:true});};
  const id=`transfer-${engine}-${key}`,title=`Transfer ${key}`,words='## Retained\n\nExact Notebook words.\n';
  const view=(name,args)=>control({method:'agent_view',actor:facts.actor,name,args});
  const state=()=>view('memory_current',{item_id:id});
  const waitReceipt=kind=>{const p=page.waitForResponse(r=>r.url().endsWith('/api/command')&&r.request().postDataJSON()?.kind===kind).then(async r=>{const receipt=await r.json();assert.equal(receipt.status,'committed',JSON.stringify(receipt));return receipt;});p.catch(()=>{});return p;};
  const journal=()=>page.evaluate(async binding=>new Promise((resolve,reject)=>{const r=indexedDB.open('theseus-notebook-writing-v1',3);r.onsuccess=()=>{const db=r.result,tx=db.transaction('deletions','readonly'),q=tx.objectStore('deletions').get(JSON.stringify(binding));let value;q.onsuccess=()=>value=q.result;tx.oncomplete=()=>{db.close();resolve(value??null);};tx.onerror=()=>{db.close();reject(tx.error);};};r.onerror=()=>reject(r.error);}),{instance_id:facts.instance_id,actor_id:facts.actor,item_id:id});
  const openMenu=async()=>press(page.getByRole('button',{name:'This page',exact:true}));
  const committedJournal=async(operation=null)=>{let value;for(const end=Date.now()+10000;Date.now()<end;){
    value=await journal();if(value?.undo?.phase==='committed'&&(!operation||value.undo.operation===operation))return value;
    await new Promise(resolve=>setTimeout(resolve,25));
   }assert.fail('Matching committed IndexedDB journal not observed: '+JSON.stringify({operation,value}));};
  const choose=async(kind,label,wait=true)=>{await openMenu();await press(page.getByRole('menuitem',{name:kind==='memory.move'?'Move to…':'Copy to…',exact:true}));
    const item=page.getByRole('menuitem',{name:label,exact:true});await item.waitFor();if(width===390)assert.ok((await item.boundingBox()).height>=44);
    const receipt=wait?waitReceipt(kind):null;if(width===1280){const labels=await page.getByRole('menu').locator('[role="menuitem"]:not([disabled])').allTextContents(),at=labels.findIndex(text=>text.trim()===label);assert.ok(at>=0,JSON.stringify(labels));await page.keyboard.press('Home');for(let i=0;i<at;i++)await page.keyboard.press('ArrowDown');await page.keyboard.press('Enter');}else await press(item);return receipt;};
  const undo=async()=>{const receipt=waitReceipt('memory.transfer.undo');await page.keyboard.press('Meta+z');const answer=await receipt;await page.locator('#notebook-sheet-dialog[open]').waitFor();return answer;};
  const openCurrent=async()=>{const s=(await state()).owner_scope;await drain();await page.goto(origin+`/?${s.kind==='topic'?'topic':'workspace'}=${s.id}&page=${id}`);await page.locator('body[data-ready=true]').waitFor();await page.locator('#notebook-sheet-dialog[open]').waitFor();};
  const closeSheet=async()=>{if(await page.locator('#notebook-sheet-dialog[open]').isVisible())await page.keyboard.press('Escape');};
  try{
   await control({method:'outcome_reference',operation_id:'seed-'+id,item_id:id,title,body:words});
   const topic=(await view('topic',{topic_id:'t1'})).topic;row.topicTitle=topic.title;
   await page.goto(origin+'/?workspace=w1&page='+id);await page.locator('body[data-ready=true]').waitFor();await page.locator('#notebook-sheet-dialog[open]').waitFor();
   await check('native menu move, scope and quiet committed receipt',async()=>{
    const before=await state();assert.deepEqual(before.owner_scope,{kind:'workspace',id:'w1'});
    const answer=await choose('memory.move',topic.title);row.moveReceipt=answer;
    assert.deepEqual((await state()).owner_scope,{kind:'topic',id:'t1'});assert.equal((await state()).body,words);
    await page.locator('#notebook-sheet-dialog[open]').waitFor({state:'hidden'});
    const kept=await committedJournal();assert.equal(kept.undo.phase,'committed');assert.equal(kept.undo.expires,answer.result.committed_ms+600000);
    assert.equal(await page.locator('#notebook-delete-notice').count(),0);
    assert.equal((await view('memory_items',{owner_scope:{kind:'workspace',id:'w1'}})).items.some(p=>p.id===id),false);
   });
   await check('native Command-Z restores exact scope through persisted journal',async()=>{
    row.moveInverse=await undo();assert.deepEqual((await state()).owner_scope,{kind:'workspace',id:'w1'});assert.equal((await state()).body,words);
    assert.equal(await page.locator('#notebook-delete-notice').count(),0);
   });
   await check('native copy, reciprocal bytes, reload and exact paired Undo',async()=>{
    const answer=await choose('memory.copy',topic.title);row.copyReceipt=answer;const clone=await view('memory_current',{item_id:answer.result.copy.item_id});
    assert.equal(clone.title,title+' copy');assert.equal(clone.body,`[Original](?workspace=w1&page=${id})\n\n`+words);
    assert.equal((await state()).body,`[Copy](?topic=t1&page=${clone.source_ref.id})\n\n`+words);
    await page.waitForFunction(id=>document.querySelector('#notebook-sheet-dialog .notebook-text')?.value.includes(id),clone.source_ref.id);
    const first=await committedJournal();assert.equal(first.undo.copy_revision,1);assert.equal(first.undo.expires,answer.result.committed_ms+600000);
    await drain();await page.reload();await page.locator('body[data-ready=true]').waitFor();assert.equal((await journal()).undo.expires,first.undo.expires);
    // Undo opens the sheet without inventing a URL page marker. A reload may
    // therefore return to its outcome with the same device-kept Undo target.
    if(await page.locator('#notebook-sheet-dialog[open]').isVisible())await page.keyboard.press('Escape');
    row.copyInverse=await undo();assert.equal((await state()).body,words);assert.equal((await view('memory_status',{item_id:clone.source_ref.id})).deleted,true);
   });
   if(width===1280)await check('native rail drag moves; native Option-drag copies through the same owner',async()=>{
    // The current rail lists this topic's pages only. Put this isolated page
    // here through the real menu, then open it from that real Notebook row.
    row.dragPreparation=await choose('memory.move',topic.title);
    await drain();await page.goto(origin+'/?topic=t1');await page.locator('body[data-ready=true]').waitFor();
    await press(page.locator(`#things .things-sec[data-key="notebook"] a.row[href*="page=${id}"]`));
    await page.locator('#notebook-sheet-dialog[open]').waitFor();row.dragContextURL=page.url();
    const layout=page.locator('#notebook-sheet-dialog').getByRole('button',{name:'Side by side',exact:true});if(await layout.getAttribute('aria-pressed')!=='true')await press(layout);assert.equal(await layout.getAttribute('aria-pressed'),'true');
    const source=page.locator('#notebook-sheet-dialog .notebook-menu'),target=page.locator('a.ol-name[data-workspace-id="w1"]').first();
    const moving=waitReceipt('memory.move');await source.dragTo(target);row.dragMove=await moving;assert.deepEqual((await state()).owner_scope,{kind:'workspace',id:'w1'});
    await undo();const side=page.locator('#notebook-sheet-dialog').getByRole('button',{name:'Side by side',exact:true});
    if(await side.getAttribute('aria-pressed')!=='true')await press(side);assert.equal(await side.getAttribute('aria-pressed'),'true');
    const copying=waitReceipt('memory.copy');await page.keyboard.down('Alt');try{await page.locator('#notebook-sheet-dialog .notebook-menu').dragTo(target);}finally{await page.keyboard.up('Alt');}
    row.dragCopy=await copying;assert.deepEqual((await state()).owner_scope,{kind:'topic',id:'t1'});await page.keyboard.press('Escape');await undo();
   });
   await check('lost copy answer reloads its exact IndexedDB request without a second clone or renewed deadline',async()=>{
    await openCurrent();const before=await state();let lose=true;
    await page.route('**/api/command',async route=>{const sent=route.request().postDataJSON();if(lose&&sent.kind==='memory.copy'){
      lose=false;const answer=await route.fetch();row.lostCopyReceipt=await answer.json();await route.abort();
    }else await route.continue();});
    try{
     await choose('memory.copy',topic.title,false);
     await page.waitForFunction(()=>document.querySelector('#notebook-delete-notice')?.textContent.includes('Not confirmed yet'));
     assert.equal(row.lostCopyReceipt.status,'committed');const exact=structuredClone(row.requests.filter(r=>r.kind==='memory.copy').at(-1));row.lostCopyEnvelope=exact;
     assert.equal((await journal()).undo.phase,'pending');assert.equal((await state()).source_ref.revision,row.lostCopyReceipt.result.revision);
     await drain();await page.reload();await page.locator('body[data-ready=true]').waitFor();const kept=await committedJournal(exact.operation_id);row.lostCopyJournal=kept;
     assert.equal(kept.undo.expires,row.lostCopyReceipt.result.committed_ms+600000);
     const attempts=row.requests.filter(r=>r.operation_id===exact.operation_id);assert.ok(attempts.length>=2);for(const attempt of attempts)assert.deepEqual(attempt,exact);
     assert.equal((await state()).source_ref.revision,row.lostCopyReceipt.result.revision,'same operation appends no second revision');
     const clones=(await view('memory_items',{owner_scope:{kind:'topic',id:'t1'}})).items.filter(p=>p.id===exact.args.copy_id);assert.equal(clones.length,1);
     await closeSheet();row.lostCopyInverse=await undo();assert.equal((await state()).body,before.body);
     assert.equal((await view('memory_status',{item_id:exact.args.copy_id})).deleted,true);
    }finally{await page.unroute('**/api/command');}
   });
   await check('native Command-Z before move receipt is kept first and inverses the exact committed revision',async()=>{
    await openCurrent();const before=await state();
    // Use the actual outcome's title rather than a guessed fixture label.
    const outcome=(await view('workspace',{workspace_id:'w1'})).workspace;
    let reached,release;const held=new Promise(r=>reached=r),gate=new Promise(r=>release=r);let hold=true;
    await page.route('**/api/command',async route=>{if(hold&&route.request().postDataJSON()?.kind==='memory.move'){hold=false;reached();await gate;}await route.continue();});
    const moved=waitReceipt('memory.move'),inverse=waitReceipt('memory.transfer.undo');
    try{
     await choose('memory.move',before.owner_scope.kind==='topic'?outcome.title+' · Outcome Notebook':topic.title,false);await held;
     await page.locator('#notebook-sheet-dialog[open]').waitFor({state:'hidden'});await page.keyboard.press('Meta+z');
     await page.waitForFunction(()=>document.querySelector('#notebook-delete-notice')?.textContent.startsWith('Undo for'));
     assert.equal((await journal()).undo.undoRequested,true);assert.deepEqual((await state()).owner_scope,before.owner_scope);
    }finally{release();}
    try{
     row.earlyMove=await moved;row.earlyInverse=await inverse;await page.locator('#notebook-sheet-dialog[open]').waitFor();
     const envelope=row.requests.filter(r=>r.kind==='memory.transfer.undo').at(-1);assert.equal(envelope.expected.item_revision,row.earlyMove.result.revision);assert.equal(envelope.target.transfer_id,row.earlyMove.operation_id);
     assert.deepEqual((await state()).owner_scope,before.owner_scope);assert.equal((await state()).body,before.body);
    }finally{await page.unroute('**/api/command');}
   });
   await check('synthetic destination refusal is explicit and keeps the actual page unchanged',async()=>{
    await openCurrent();const before=await state(),outcome=(await view('workspace',{workspace_id:'w1'})).workspace;let refuse=true;
    await page.route('**/api/command',async route=>{const e=route.request().postDataJSON();if(refuse&&e.kind==='memory.move'){
      refuse=false;row.syntheticDestinationRefusal={instance_id:e.instance_id,operation_id:e.operation_id,kind:e.kind,status:'rejected',recorded:true,error:{code:'FORBIDDEN',message:'The destination Notebook is read-only.'},affected:[]};
      await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(row.syntheticDestinationRefusal)});
    }else await route.continue();});
    try{
     await choose('memory.move',before.owner_scope.kind==='topic'?outcome.title+' · Outcome Notebook':topic.title,false);
     await page.waitForFunction(()=>document.querySelector('#notebook-delete-notice')?.textContent.includes('The destination Notebook is read-only.'));
     assert.deepEqual((await state()).owner_scope,before.owner_scope);assert.equal((await state()).body,before.body);assert.equal((await state()).source_ref.revision,before.source_ref.revision);
     assert.equal((await journal()).undo.phase,'rejected');assert.equal(await page.locator('#notebook-delete-notice').getByRole('button',{name:'Undo',exact:true}).count(),0);
    }finally{await page.unroute('**/api/command');}
   });
   if(width===1280&&look==='bookends')await check('visible native writing and exact image bytes survive blocked transfer, association, move and copy Undo',async()=>{
    await openCurrent();await openMenu();await press(page.getByRole('menuitemcheckbox',{name:'Text',exact:true}));
    const before=await state(),outcome=(await view('workspace',{workspace_id:'w1'})).workspace;
    const label=before.owner_scope.kind==='topic'?outcome.title+' · Outcome Notebook':topic.title;
    const bytes=await readFile('tests/fixtures/media/one.png'),sha=createHash('sha256').update(bytes).digest('hex');
    let reached,release;const held=new Promise(r=>reached=r),gate=new Promise(r=>release=r);let hold=true;
    await page.route('**/api/media/upload',async route=>{if(hold){hold=false;reached();await gate;}await route.continue();});
    let kept;
    try{
     await page.locator('#notebook-sheet-dialog input[type=file]').setInputFiles({name:'kept-1060.png',mimeType:'image/png',buffer:bytes});await held;
     const field=page.locator('#notebook-sheet-dialog .notebook-text');await field.fill('Visible writing before transfer.');
     const count=row.requests.filter(r=>r.kind==='memory.move').length;await choose('memory.move',label,false);
     await page.waitForFunction(()=>document.querySelector('#notebook-sheet-dialog')?.textContent.includes('Finish saving it before changing this page.'));
     assert.equal(row.requests.filter(r=>r.kind==='memory.move').length,count);assert.deepEqual((await state()).owner_scope,before.owner_scope);assert.equal(await field.inputValue(),'Visible writing before transfer.');
     kept=await page.evaluate(binding=>new Promise((resolve,reject)=>{const q=indexedDB.open('theseus-notebook-writing-v1',3);q.onsuccess=()=>{const db=q.result,tx=db.transaction(['writing','images'],'readonly'),w=tx.objectStore('writing').get(JSON.stringify(binding)),im=tx.objectStore('images').index('scope').getAll(JSON.stringify(binding));tx.oncomplete=()=>{db.close();resolve({writing:w.result,images:im.result.map(v=>[...new Uint8Array(v.bytes)])});};tx.onerror=()=>reject(tx.error);};q.onerror=()=>reject(q.error);}),{instance_id:facts.instance_id,actor_id:facts.actor,item_id:id});
     assert.equal(kept.images.length,1);assert.equal(createHash('sha256').update(Buffer.from(kept.images[0])).digest('hex'),sha);assert.equal(kept.writing.images.some(i=>i.bytes),false);
    }finally{release();}
    try{
     const associated=await page.waitForResponse(r=>r.url().endsWith('/api/command')&&r.request().postDataJSON()?.kind==='memory.revise'&&r.request().postDataJSON()?.args.attachments.length===1);assert.equal((await associated.json()).status,'committed');
     const carrying=await state();assert.equal(carrying.attachments.length,1);assert.equal(carrying.body,'Visible writing before transfer.');
     row.imageRetention={sha256:sha,size:bytes.length,deviceBytes:kept.images[0].length,media:carrying.attachments[0].id};
     const moved=await choose('memory.move',label);await committedJournal(moved.operation_id);assert.equal((await state()).body,carrying.body);assert.equal((await state()).attachments[0].id,carrying.attachments[0].id);await undo();
     const copied=await choose('memory.copy',topic.title);await committedJournal(copied.operation_id);const clone=await view('memory_current',{item_id:copied.result.copy.item_id});assert.equal(clone.attachments[0].id,carrying.attachments[0].id);
     const token=await page.locator('meta[name="aim-next-session"]').getAttribute('content');
     row.mediaRead=await page.evaluate(async({token,media,source})=>{const r=await fetch('/api/media/read',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+token},body:JSON.stringify({media_id:media,source_ref:source})});const bytes=await r.arrayBuffer();return {status:r.status,size:bytes.byteLength,sha256:[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(b=>b.toString(16).padStart(2,'0')).join(''),descriptor:r.headers.get('X-AIM-Media')};},{token,media:carrying.attachments[0].id,source:clone.source_ref});
     assert.equal(row.mediaRead.status,200);assert.equal(row.mediaRead.sha256,sha);assert.equal(row.mediaRead.size,bytes.length);assert.equal(JSON.parse(row.mediaRead.descriptor).sha256,sha);
     const field=page.locator('#notebook-sheet-dialog .notebook-text'),shown=await field.inputValue(),inverses=row.requests.filter(r=>r.kind==='memory.transfer.undo').length;
     await field.click();await page.keyboard.press('End');await page.keyboard.insertText(' native text');await page.keyboard.press('Meta+z');
     assert.equal(await field.inputValue(),shown);assert.equal(row.requests.filter(r=>r.kind==='memory.transfer.undo').length,inverses,'text field keeps its native Undo');
     await closeSheet();await undo();assert.equal((await state()).body,carrying.body);assert.equal((await state()).attachments[0].id,carrying.attachments[0].id);
    }finally{await page.unroute('**/api/media/upload');}
   });
   await check('a real concurrent clone revision refuses paired Undo and retains both current bodies',async()=>{
    await openCurrent();const answer=await choose('memory.copy',topic.title);await committedJournal();const original=await state(),clone=await view('memory_current',{item_id:answer.result.copy.item_id});
    row.cloneRace=await control({method:'memory_revise',operation_id:'clone-race-'+id,item_id:clone.source_ref.id,expected_revision:clone.source_ref.revision,title:clone.title,body:'Concurrent clone writing stays.'});assert.equal(row.cloneRace.status,'committed');
    const refusal=page.waitForResponse(r=>r.url().endsWith('/api/command')&&r.request().postDataJSON()?.kind==='memory.transfer.undo').then(r=>r.json());
    await closeSheet();await page.keyboard.press('Meta+z');row.inverseRefusal=await refusal;assert.equal(row.inverseRefusal.status,'rejected');assert.equal(row.inverseRefusal.error.code,'REVISION_CONFLICT');
    await page.waitForFunction(()=>document.querySelector('#notebook-delete-notice')?.textContent.includes('Undo for')&&document.querySelector('#notebook-delete-notice')?.textContent.includes('was refused'));
    assert.equal((await journal()).undo.phase,'restore_rejected');assert.equal((await state()).body,original.body);assert.equal((await state()).source_ref.revision,original.source_ref.revision);
    const latest=await view('memory_current',{item_id:clone.source_ref.id});assert.equal(latest.body,'Concurrent clone writing stays.');assert.equal(latest.deleted,false);
   });
   if(width===1280&&look==='bookends')await check('full-page header move hands the kept request to the destination and native Undo reopens it',async()=>{
    const before=await state(),outcome=(await view('workspace',{workspace_id:'w1'})).workspace;
    await drain();await page.goto(origin+`/?cards=${id}&view=text`);await page.locator('body[data-ready=true]').waitFor();await page.locator('#deck-page .notebook-menu').waitFor();
    row.fullpageMove=await choose('memory.move',before.owner_scope.kind==='topic'?outcome.title+' · Outcome Notebook':topic.title);
    await page.waitForFunction(()=>!new URL(location.href).searchParams.has('cards')&&document.body.dataset.ready==='true');
    await committedJournal(row.fullpageMove.operation_id);row.fullpageInverse=await undo();assert.deepEqual((await state()).owner_scope,before.owner_scope);assert.equal((await state()).body,before.body);
   });
   await drain();await Promise.all(served);for(const f of webFiles)assert.equal(row.served[f],digests[f],f+' served bytes');assert.deepEqual(row.errors,[]);row.passed=true;
   await page.screenshot({path:`${evidence}/${key}.png`,fullPage:true});
  }catch(error){row.error=error.stack;await page.screenshot({path:`${evidence}/${key}-failure.png`,fullPage:true});await writeFile(`${evidence}/${key}-failure.html`,await page.content());}
  rows.push(row);await writeFile(`${evidence}/observations.json`,JSON.stringify(rows,null,2));console.log(JSON.stringify({key,passed:row.passed,error:row.error?.split('\n')[0]}));retain();await context.close();
 }
}catch(error){bodyError=error.stack;}
finally{
 if(browser){retain();await browser.close();}cleanup.disconnected=browser?!browser.isConnected():true;
 fixture.stdin.end();cleanup.fixtureExit=await exit;cleanup.fixtureErrors=errors();const ps=processes();cleanup.fixturePid=fixture.pid;
 cleanup.fixtureAbsent=!ps.some(p=>p.pid===fixture.pid);cleanup.ownedPids=[...owned];cleanup.remainingOwned=ps.filter(p=>owned.has(p.pid));cleanup.profileProcesses=profile?ps.filter(p=>p.command.includes(profile)):[];
 if(profile&&cleanup.disconnected&&!cleanup.remainingOwned.length&&!cleanup.profileProcesses.length)await rm(profile,{recursive:true});
 cleanup.profileAbsent=profile?await access(profile).then(()=>false,()=>true):null;
 cleanup.portClosed=origin?await new Promise(resolve=>{const u=new URL(origin),s=net.createConnection({host:u.hostname,port:+u.port});s.once('connect',()=>{s.destroy();resolve(false);});s.once('error',()=>resolve(true));}):null;
 await writeFile(`${evidence}/results.json`,JSON.stringify({engine,rows,cleanup,bodyError},null,2));
}
assert.equal(cleanup.disconnected,true);assert.equal(cleanup.fixtureExit.code,0);assert.equal(cleanup.fixtureErrors,'');assert.equal(cleanup.fixtureAbsent,true);assert.equal(cleanup.portClosed,true);assert.equal(cleanup.profileAbsent,true);assert.deepEqual(cleanup.remainingOwned,[]);assert.deepEqual(cleanup.profileProcesses,[]);
assert.equal(bodyError,undefined);assert.ok(rows.length);assert.ok(rows.every(r=>r.passed),'inspect retained native failures');console.log(JSON.stringify({passed:rows.length,cleanup}));

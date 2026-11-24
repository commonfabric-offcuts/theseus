// Real HTTP/Core outcomes, with native browser input. The caller owns processes.
import assert from 'node:assert/strict';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';

const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const owners=['app.mjs','stack-feed.mjs','rail-topic-fold.mjs','notebook-rail-menu.mjs',
  'notebook-page.mjs','notebook-writing.mjs','notebook-delete-ui.mjs','outline-menus.mjs',
  'outline-dossiers.mjs','things-rail.mjs','key-tree.mjs'];
const pause=()=>new Promise(resolve=>setTimeout(resolve,25));
async function until(read,accept,label){
  let last;for(const end=Date.now()+10000;Date.now()<end;){last=await read();if(accept(last))return last;await pause();}
  assert.fail(label+': '+JSON.stringify(last));
}
const view=(control,facts,name,args)=>control({method:'agent_view',actor:facts.actor,name,args});

async function nativeCase({browser,facts,evidence,key,look,theme='light'},act){
  const row={key,checks:[],requests:[],receipts:[],errors:[],served:{},servedURLs:{}};
  const dir=evidence+'/1215-'+key;await mkdir(dir,{recursive:true});
  const hashes=Object.fromEntries(await Promise.all(owners.map(async file=>[file,sha(await readFile('web/'+file))])));
  const context=await browser.newContext({viewport:{width:1280,height:1000},colorScheme:theme});
  await context.addInitScript(look=>{
    localStorage.setItem('theseus-look',look);window.input1215=[];
    for(const type of ['wheel','contextmenu','keydown','click'])addEventListener(type,event=>{
      const record={type,trusted:event.isTrusted,key:event.key,deltaX:event.deltaX,deltaY:event.deltaY,
        stack:event.target.closest?.('[data-stack]')?.dataset.stack,page:event.target.closest?.('[data-page-id]')?.dataset.pageId};
      window.input1215.push(record);setTimeout(()=>{record.defaultPreventedAtNextTask=event.defaultPrevented;},0);
    },true);
  },look);
  const page=await context.newPage();page.setDefaultTimeout(10000);
  const pending=new Set(),jobs=[];let started=0;
  page.on('pageerror',error=>row.errors.push(error.stack));
  page.on('request',request=>{
    if(['/api/command','/api/view'].includes(new URL(request.url()).pathname)){pending.add(request);started++;}
    if(request.url().endsWith('/api/command'))row.requests.push(request.postDataJSON());
  });
  const ended=request=>pending.delete(request);page.on('requestfinished',ended);page.on('requestfailed',ended);
  page.on('response',response=>{
    const path=new URL(response.url()).pathname,file=path.split('/').at(-1);
    if(owners.includes(file)){
      const job=response.body().then(async bytes=>{row.served[file]=sha(bytes);row.servedURLs[file]=response.url();await writeFile(dir+'/'+file,bytes);});
      job.catch(()=>{});jobs.push(job);
    }
    if(path==='/api/command'){
      const job=response.json().then(receipt=>row.receipts.push({request:response.request().postDataJSON(),receipt}));
      job.catch(()=>{});jobs.push(job);
    }
  });
  const drain=async()=>{
    for(const end=Date.now()+10000;Date.now()<end;){const before=started;
      if(!pending.size){await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
        if(!pending.size&&before===started)return;}
      await pause();
    }assert.fail('Outstanding fixture API requests: '+pending.size);
  };
  const check=(name,act)=>{try{act();row.checks.push({name,passed:true});}catch(error){row.checks.push({name,passed:false,error:error.stack});throw error;}};
  const receipt=async(kind,id,deleted)=>until(()=>row.receipts.find(r=>r.request.kind===kind&&
    (id===undefined||r.request.target.item_id===id)&&
    (deleted===undefined||r.request.args.deleted===deleted)),Boolean,'Committed '+kind+' receipt');
  try{
    await act({page,row,check,receipt,drain});await drain();await Promise.all(jobs);
    const required=key.startsWith('archive-')?['app.mjs','stack-feed.mjs','rail-topic-fold.mjs']:
      ['app.mjs','notebook-rail-menu.mjs','notebook-page.mjs','notebook-writing.mjs','notebook-delete-ui.mjs','outline-menus.mjs','things-rail.mjs','key-tree.mjs'];
    check('actual served owners match inspected source',()=>{for(const file of required)assert.equal(row.served[file],hashes[file],file);});
    for(const file of Object.keys(row.served))assert.equal(row.served[file],hashes[file],file+' original served bytes');
    check('no browser application errors',()=>assert.deepEqual(row.errors,[]));row.passed=true;
  }catch(error){row.error=error.stack;await page.screenshot({path:dir+'/failure.png',fullPage:true}).catch(()=>{});await writeFile(dir+'/failure.html',await page.content()).catch(()=>{});}
  finally{
    row.input=await page.evaluate(()=>window.input1215).catch(()=>null);
    row.finalFocus=await page.evaluate(()=>({id:document.activeElement?.id,page:document.activeElement?.dataset.pageId,rail:document.activeElement?.closest('#things,#outline')?.id})).catch(()=>null);
    if(row.journal)row.journalAfterInput=await journal(page,row.journal.binding);
    try{await drain();}catch(error){row.drainError=error.stack;row.passed=false;}
    await Promise.allSettled(jobs);row.source=hashes;
    await context.close();await writeFile(dir+'/result.json',JSON.stringify(row,null,2));
  }
  console.log(JSON.stringify({key,passed:row.passed,checks:row.checks.length,error:row.error?.split('\n')[0]}));return row;
}

export async function archiveRevealOutcomes({browser,control,facts,evidence}){
  const rows=[];
  for(const look of ['bookends','paper'])for(const theme of ['light','dark']){
    const key='archive-'+look+'-'+theme,workspace='native1215-'+key;
    await control({method:'navigation_workspaces',workspaces:[{id:workspace,title:'Native archive '+key,purpose:'Isolated outcome proof'}]});
    const topics=Array.from({length:10},(_,n)=>({id:workspace+'-'+n,title:'Native archive topic '+n,workspace_id:workspace}));
    await control({method:'navigation_topics',topics});const topic=topics[0].id;
    const ids=[];for(let n=0;n<2;n++)ids.push((await control({method:'agent_message',operation_id:key+'-'+n,topic_id:topic,
      sender:facts.agent,join:true,addressees:[facts.actor],intent:'tell',divergence_reason:'Separate exact archive target '+n,
      body:'Native archive proof dossier '+n+' — distinct retained words.'})).result.message_id);
    rows.push(await nativeCase({browser,facts,evidence,key,look,theme},async({page,row,check,receipt})=>{
      row.identities={workspace,topic,archive:ids[0],untouched:ids[1]};
      await page.goto(facts.origin+'/?topic='+topic);await page.locator('body[data-ready=true]').waitFor();
      row.paint=await page.evaluate(()=>({look:document.documentElement.dataset.look||'bookends',dark:matchMedia('(prefers-color-scheme:dark)').matches}));
      check('requested look and browser color scheme are active',()=>assert.deepEqual(row.paint,{look,dark:theme==='dark'}));
      const outcome=page.locator(`.ol-outcome[data-workspace-id="${workspace}"]`),area=outcome.locator('.ol-own');
      await outcome.waitFor();if(await outcome.locator('.ol-topics').evaluate(el=>el.hidden))await outcome.locator('.ol-disclosure').click();
      await page.waitForFunction(({workspace,topic})=>{const o=document.querySelector(`.ol-outcome[data-workspace-id="${workspace}"]`);
        return o?.querySelector(`a[data-topic-id="${topic}"]`)&&o.querySelectorAll('.ol-topic-list>a[data-topic-id]').length>=8&&o.querySelector('.ol-own[data-topic-fold]');},{workspace,topic});
      const truth=()=>view(control,facts,'topic_messages',{topic_id:topic,message_ids:ids});
      row.before=await truth();check('exact two Core dossiers start unarchived',()=>{for(const id of ids)assert.equal(row.before.items.find(i=>i.id===id).stack_position.below,false);});
      const head=page.locator(`#messages .reply-stack[data-stack="${ids[0]}"] .stack-head`).first();await head.waitFor();
      const peek=await area.locator('[data-rail-fold=peek]').boundingBox();assert.ok(peek);
      await page.mouse.move(peek.x+30,peek.y-10);await page.waitForFunction(workspace=>document.querySelector(`.ol-outcome[data-workspace-id="${workspace}"] .ol-own`)?.hasAttribute('data-topic-revealed'),workspace);
      row.inputStart=await page.evaluate(()=>window.input1215.length);
      const point=await head.boundingBox();assert.ok(point);await page.mouse.move(point.x+point.width/2,point.y+point.height/2);await page.mouse.wheel(0,25);
      // Wait for the browser's native event to reach the page before inspecting it.
      await page.waitForFunction(()=>window.input1215.some(e=>e.type==='wheel'&&e.deltaY===25&&e.trusted));
      row.afterVertical=await truth();check('native vertical scroll preserves reveal and both Core dossiers',()=>{
        assert.deepEqual(row.afterVertical.items.map(i=>[i.id,i.stack_position.below]),row.before.items.map(i=>[i.id,i.stack_position.below]));
      });row.verticalReveal=await area.getAttribute('data-topic-revealed');
      check('vertical wheel leaves pointer reveal latched',()=>assert.equal(row.verticalReveal,''));
      const next=await head.boundingBox();await page.mouse.move(next.x+next.width/2,next.y+next.height/2);await page.mouse.wheel(-120,0);
      const sent=await receipt('stack.aside');row.archiveReceipt=sent;
      check('horizontal gesture commits exact dossier archive operation',()=>{assert.equal(sent.receipt.status,'committed');assert.equal(sent.request.target.message_id,ids[0]);});
      row.afterArchive=await until(truth,s=>s.items.find(i=>i.id===ids[0])?.stack_position.below===true,'Exact Core dossier archive');
      check('Core archives intended dossier and preserves other dossier',()=>{assert.equal(row.afterArchive.items.find(i=>i.id===ids[0]).stack_position.below,true);assert.equal(row.afterArchive.items.find(i=>i.id===ids[1]).stack_position.below,false);});
      row.horizontalReveal=await area.getAttribute('data-topic-revealed');
      check('horizontal wheel closes pointer reveal',()=>assert.equal(row.horizontalReveal,null));
      await page.locator(`.shelf-dossier[data-id="${ids[0]}"]`).waitFor();
      row.native=await page.evaluate(start=>window.input1215.slice(start),row.inputStart);
      check('archive used trusted wheel on exact dossier head with no click or key',()=>{
        assert.ok(row.native.some(e=>e.trusted&&e.deltaX===-120&&e.stack===ids[0]));
        assert.equal(row.native.filter(e=>!e.trusted||e.type!=='wheel').length,0);
      });
    }));
  }return rows;
}

async function journal(page,binding){return page.evaluate(binding=>new Promise((resolve,reject)=>{
  const request=indexedDB.open('theseus-notebook-writing-v1',3);request.onerror=()=>reject(request.error);
  request.onsuccess=()=>{const db=request.result,tx=db.transaction('deletions','readonly'),query=tx.objectStore('deletions').get(JSON.stringify(binding));
    tx.oncomplete=()=>{db.close();resolve(query.result??null);};tx.onerror=()=>{db.close();reject(tx.error);};};
}),binding);}

export async function unopenedDeleteOutcomes({browser,control,facts,evidence}){
  const rows=[];
  for(const look of ['bookends','paper'])for(const entry of ['outline','things']){
    const key='delete-'+look+'-'+entry,id='native1215-'+key,topic='t1',title='Unopened '+key,words='## Retained writing\n\nExact first-Delete words — '+key+'.\n';
    const made=await control({method:'agent_page',operation_id:'seed-'+id,item_id:id,topic_id:topic,title,body:words});assert.equal(made.status,'committed');
    rows.push(await nativeCase({browser,facts,evidence,key,look},async({page,row,check,receipt,drain})=>{
      row.identities={id,topic,title,words};const binding={instance_id:facts.instance_id,actor_id:facts.actor,item_id:id};
      const state=()=>view(control,facts,'memory_current',{item_id:id});
      await page.goto(facts.origin+'/?topic='+topic);await page.locator('body[data-ready=true]').waitFor();
      const right=page.locator(`#things a.ol-page[data-page-id="${id}"]`);await right.waitFor();
      const section=page.locator('#things .things-sec[data-key=notebook]');if(!await section.evaluate(el=>el.open))await section.locator('summary').click();
      await right.waitFor({state:'visible'});
      if(entry==='outline'){
        await right.click({button:'right'});await page.getByRole('menuitem',{name:'Star',exact:true}).click();
        const starred=await receipt('memory.star',id);assert.equal(starred.receipt.status,'committed');
        await drain();await page.reload();await page.locator('body[data-ready=true]').waitFor();
        const outcome=page.locator('.ol-outcome[data-workspace-id=w1]');await outcome.waitFor();
        if(await outcome.locator('.ol-topics').evaluate(el=>el.hidden))await outcome.locator('.ol-disclosure').click();
      }
      const target=page.locator(`#${entry} a.ol-page[data-page-id="${id}"]`).first();await target.waitFor();
      row.before=await state();check('exact unopened page is intact and sheet is closed',()=>{
        assert.equal(row.before.body,words);assert.equal(row.before.deleted,false);assert.deepEqual(row.before.owner_scope,{kind:'topic',id:topic});
        assert.equal(row.requests.filter(r=>r.kind==='memory.read'&&r.target.item_id===id).length,0);
      });assert.equal(await page.locator('#notebook-sheet-dialog[open]').count(),0);
      if(entry==='outline'){await target.focus();await page.keyboard.press('Shift+F10');}else await target.click({button:'right'});
      const deleteChoice=page.getByRole('menuitem',{name:'Delete page',exact:true});
      await deleteChoice.waitFor();assert.equal(await deleteChoice.getAttribute('data-notebook-action'),'delete');
      assert.equal(await page.locator('#notebook-sheet-dialog[open]').count(),0);
      row.beforeDeleteCommands=row.requests.filter(r=>r.kind==='memory.delete').length;assert.equal(row.beforeDeleteCommands,0);
      await deleteChoice.click(); // exactly one selection
      const removed=await receipt('memory.delete',id,true);row.deleteReceipt=removed;
      check('first rail Delete commits one exact page operation',()=>{assert.equal(removed.receipt.status,'committed');assert.equal(row.requests.filter(r=>r.kind==='memory.delete').length,1);});
      row.journal=await until(()=>journal(page,binding),j=>j?.undo?.phase==='committed'&&j.undo.operation===removed.request.operation_id,'Exact committed Delete journal');
      row.deleted=await view(control,facts,'memory_status',{item_id:id});
      await page.locator('#notebook-sheet-dialog[open]').waitFor({state:'hidden'});
      row.focusAfterDelete=await page.evaluate(()=>({id:document.activeElement?.id,page:document.activeElement?.dataset.pageId,rail:document.activeElement?.closest('#things,#outline')?.id}));
      check('real journal keeps exact delete identity and Core confirms deletion',()=>{
        assert.equal(row.deleted.deleted,true);assert.deepEqual(row.journal.binding,binding);assert.equal(row.journal.undo.operation,removed.request.operation_id);
      });
      await page.keyboard.press('Meta+z');const restored=await receipt('memory.delete',id,false);row.undoReceipt=restored;
      await page.locator('#notebook-sheet-dialog[open]').waitFor();
      await page.waitForFunction(title=>document.querySelector('#notebook-sheet-title')?.textContent===title,title);
      row.restored=await state();check('normal native Undo restores exact writing and scope with one inverse',()=>{
        assert.equal(restored.receipt.status,'committed');assert.notEqual(restored.request.operation_id,removed.request.operation_id);
        assert.equal(row.requests.filter(r=>r.kind==='memory.delete').length,2);assert.equal(row.restored.deleted,false);
        assert.equal(row.restored.title,title);assert.equal(row.restored.body,words);assert.deepEqual(row.restored.owner_scope,row.before.owner_scope);
      });
      row.native=await page.evaluate(()=>window.input1215);check('Delete and Undo came from trusted browser input',()=>{
        assert.ok(row.native.some(e=>e.type==='click'&&e.trusted));assert.ok(row.native.some(e=>e.type==='keydown'&&e.trusted&&e.key==='z'));
      });
    }));
  }return rows;
}

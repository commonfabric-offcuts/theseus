// One bounded native representative per invocation. Scratch Core/origin/profile
// only; no page handler is invoked to stand in for a pointer, touch or key.
import assert from 'node:assert/strict';
import {spawn,execFileSync} from 'node:child_process';
import {appendFileSync} from 'node:fs';
import {mkdir,mkdtemp,readFile,writeFile,readdir,rm,access} from 'node:fs/promises';
import {loadavg,cpus} from 'node:os';
import {resolve,isAbsolute} from 'node:path';
import {createHash} from 'node:crypto';
import net from 'node:net';
import {fixtureControl} from './fixture_control.mjs';

const [destination,engine='chromium',widthArg='1280',theme='dark']=process.argv.slice(2);
assert.ok(destination&&isAbsolute(destination));assert.ok(['chromium','webkit'].includes(engine));
const width=Number(widthArg),phone=width<=760;assert.ok([390,1280].includes(width));assert.ok(['light','dark'].includes(theme));
const evidence=resolve(destination);await mkdir(evidence,{recursive:false});
const sha=b=>createHash('sha256').update(b).digest('hex');
const put=(name,value)=>writeFile(`${evidence}/${name}`,JSON.stringify(value,null,2)+'\n');
const report={engine,width,theme,resource:[],cases:[],requests:[],receipts:[],captureErrors:[],lostToNavigation:[],pageErrors:[],cleanup:{errors:[]}};
const files=async dir=>(await Promise.all((await readdir(dir,{withFileTypes:true})).map(e=>e.isDirectory()?files(`${dir}/${e.name}`):[`${dir}/${e.name}`]))).flat();
const names=[...await files('web'),'tests/notebook_editor_quote_1076_native.mjs','tests/fixture_control.mjs','tests/fixtures/ui_http.py','tests/fixtures/fixture_teardown.py'];
const sources=new Map();
for(const name of names){const bytes=await readFile(name);sources.set(name,bytes);await mkdir(`${evidence}/selected/${name.slice(0,name.lastIndexOf('/'))}`,{recursive:true});await writeFile(`${evidence}/selected/${name}`,bytes);}
report.sources=Object.fromEntries([...sources].map(([name,b])=>[name,{bytes:b.length,sha256:sha(b)}]));await put('selected.json',report.sources);
const processRows=()=>execFileSync('/bin/ps',['-axo','pid=,ppid=,lstart=,command='],{encoding:'utf8'}).trim().split('\n').map(line=>{
  const v=line.trim().split(/\s+/),command=v.slice(7).join(' ');return {pid:+v[0],ppid:+v[1],started:v.slice(2,7).join(' '),command,commandSHA256:sha(command)};
}).filter(r=>r.command!=='/bin/ps -axo pid=,ppid=,lstart=,command=');
const identity=r=>`${r.pid}:${r.started}:${r.commandSHA256}`,owned=new Map();
const sample=()=>{const rows=processRows(),tree=new Set([process.pid]);for(let changed=true;changed;){changed=false;for(const r of rows)if(tree.has(r.ppid)&&!tree.has(r.pid)){tree.add(r.pid);changed=true;}}
  for(const r of rows)if(r.pid!==process.pid&&tree.has(r.pid))owned.set(identity(r),r);return rows;};
const gate=async boundary=>{const r={boundary,utc:new Date().toISOString(),load:loadavg(),cpus:cpus().length};report.resource.push(r);await put('resource.json',report.resource);assert.equal(r.cpus,18);assert.ok(r.load[0]<12,'fresh load must be below12');};
const bounded=(promise,label,ms=15000)=>new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error(label+' exceeded '+ms+'ms')),ms);promise.then(v=>{clearTimeout(timer);resolve(v);},e=>{clearTimeout(timer);reject(e);});});
const refusal=origin=>new Promise(resolve=>{const u=new URL(origin),s=net.createConnection({host:u.hostname,port:+u.port});s.setTimeout(4000,()=>{s.destroy();resolve({utc:new Date().toISOString(),refused:false,error:'timeout'});});s.once('connect',()=>{s.destroy();resolve({utc:new Date().toISOString(),refused:false});});s.once('error',e=>resolve({utc:new Date().toISOString(),refused:e.code==='ECONNREFUSED',code:e.code}));});
const cleanup=async(name,fn)=>{try{await fn();}catch(error){report.cleanup.errors.push({name,error:error.stack});}};
let fixture,channel,browser,context,profile,origin,page;const jobs=[],served=new Set();let captureClosed=false;
const capture=(details,work)=>{if(captureClosed)return;const job=Promise.resolve().then(work).catch(error=>report.captureErrors.push({...details,error:error.stack??String(error)}));jobs.push(job);};
const captures={get closed(){return captureClosed;},close(){captureClosed=true;return jobs.length;}};
report.events=[];const recordEvent=event=>{appendFileSync(`${evidence}/events.jsonl`,JSON.stringify(event)+'\n');report.events.push(event);};
try{
  const engines=await import(process.env.AIM_PLAYWRIGHT_CORE);
  await gate('immediately-before-fixture-spawn');
  fixture=spawn('/usr/bin/python3',['tests/fixtures/ui_http.py','--freshness','--live','--teardown-observations',`${evidence}/fixture-teardown.jsonl`]);
  const stdio=new Promise(resolve=>fixture.once('close',(code,signal)=>resolve({code,signal,utc:new Date().toISOString()})));
  channel={...fixtureControl(fixture),stdio};sample();
  const control=channel.control,ready=await control({method:'ready'});report.fixture={pid:fixture.pid,ready};origin=ready.origin;
  const view=(name,args)=>control({method:'agent_view',actor:ready.actor,name,args});
  profile=await mkdtemp(`${evidence}/${engine}-profile-`);report.cleanup.profile=profile;
  await gate('immediately-before-browser-launch');
  context=await engines[engine].launchPersistentContext(profile,{headless:true,...(engine==='chromium'?{executablePath:process.env.AIM_CHROME}:{}),viewport:{width,height:960},colorScheme:theme});
  browser=context.browser();report.browserVersion=browser.version();sample();
  await context.route('**/*',route=>new URL(route.request().url()).origin===origin?route.continue():route.abort('blockedbyclient'));
  page=await context.newPage();page.setDefaultTimeout(12000);page.on('pageerror',error=>report.pageErrors.push(error.stack??String(error)));
  page.on('request',request=>{if(new URL(request.url()).pathname.startsWith('/api/')){let payload;try{payload=request.postDataJSON();}catch{}report.requests.push({utc:new Date().toISOString(),path:new URL(request.url()).pathname,payload});}});
  page.on('response',response=>{
    const url=new URL(response.url()),name='web/'+url.pathname.split('/').at(-1);
    if(sources.has(name)&&!served.has(name)&&!captureClosed){served.add(name);capture({name},async()=>{const bytes=await response.body();assert.deepEqual(bytes,sources.get(name),'served owner '+name);await mkdir(`${evidence}/served/web`,{recursive:true});await writeFile(`${evidence}/served/${name}`,bytes);});}
    if(url.pathname.startsWith('/api/')&&response.headers()['content-type']?.includes('application/json'))capture({path:url.pathname},async()=>{
      const bytes=await response.body(),body=JSON.parse(bytes.toString()),digest=sha(bytes);await mkdir(`${evidence}/http-bodies`,{recursive:true});await writeFile(`${evidence}/http-bodies/${digest}`,bytes);
      let request;try{request=response.request().postDataJSON();}catch{}
      report.receipts.push({utc:new Date().toISOString(),path:url.pathname,status:response.status(),request,body,bytes:bytes.length,sha256:digest});
    });
  });
  await page.exposeBinding('__1076FixtureEvent',(_source,event)=>recordEvent(event));
  await page.addInitScript(()=>{const documentId=crypto.randomUUID();globalThis.__1076DocumentId=documentId;globalThis.__1076Pending=new Set();globalThis.__1076Errors=[];
    for(const type of ['pointerdown','click','keydown','beforeinput','input','select','focusin'])document.addEventListener(type,event=>{
      if(!event.target.closest?.('.deck-editor,#reader'))return;
      const value=event.target.matches?.('textarea')?event.target.value:undefined;
      const pending=globalThis.__1076FixtureEvent({documentId,type,key:event.key??null,metaKey:event.metaKey,ctrlKey:event.ctrlKey,altKey:event.altKey,shiftKey:event.shiftKey,trusted:event.isTrusted,target:event.target.id||event.target.className,value,start:event.target.selectionStart,end:event.target.selectionEnd,direction:event.target.selectionDirection});
      globalThis.__1076Pending.add(pending);pending.then(()=>globalThis.__1076Pending.delete(pending),error=>{globalThis.__1076Errors.push(String(error));globalThis.__1076Pending.delete(pending);});
    },true);
  });
  const flush=async()=>{await page.evaluate(async()=>{await Promise.all([...globalThis.__1076Pending]);if(globalThis.__1076Errors.length)throw Error(globalThis.__1076Errors.join('\n'));});await Promise.all(jobs);};
  const select=async(field,selected)=>{
    const value=await field.inputValue(),start=selected===null?value.length:value.indexOf(selected);assert.ok(start>=0);
    await field.press('Meta+a');await page.keyboard.press('ArrowLeft');
    for(const char of value.slice(0,start))await page.keyboard.press('ArrowRight');
    for(const char of selected??'')await page.keyboard.press('Shift+ArrowRight');
    const state=await field.evaluate(f=>({value:f.value,start:f.selectionStart,end:f.selectionEnd,direction:f.selectionDirection,focused:document.activeElement===f,documentId:globalThis.__1076DocumentId,selected:f.value.slice(f.selectionStart,f.selectionEnd)}));
    assert.equal(state.selected,selected??'');assert.equal(state.focused,true);return state;
  };
  const quoteSave=(item,quotes)=>page.waitForResponse(response=>{try{const e=response.request().postDataJSON();return e.kind==='draft.save'&&e.args.source_ref?.id===item&&(e.args.quotes?.length??0)>=quotes;}catch{return false;}});
  const openReader=()=>page.waitForFunction(()=>document.querySelector('#reader')?.open&&document.querySelector('#writing-body')?.getClientRects().length);
  let serial=0;
  for(const surface of ['sheet','full'])for(const name of ['confirmed-draft-image-privacy','dirty-selection','no-selection','whitespace-only','hidden-image-parts','fresh1075-split']){
    const eventStart=report.events.length;
    const item=`quote1076-${surface}-${++serial}`,pic=item+'-media-0';
    const sourceBody=`## Source\n\nbefore kept words after\n\n![Picture](attachment:${pic})\n\nAfter picture.\n\n## Neighbor\n\nUntouched.\n`;
    const created=await control({method:'agent_page',operation_id:item,item_id:item,topic_id:'t1',title:'1076 '+name,body:sourceBody,attachments:[{name:'Picture.png',image:'screen.png'}]});assert.equal(created.status,'committed');
    const current=()=>view('memory_current',{item_id:item}),route=origin+(surface==='full'?`/?cards=${item}&view=cards`:`/?topic=t1&page=${item}`);
    await page.goto(route);await page.locator('body[data-ready=true]').waitFor();
    const host=()=>page.locator(surface==='full'?'#deck-page':'#notebook-sheet-dialog .notebook-sheet-page:not([hidden])'),field=()=>host().locator('.deck-editor');
    await host().locator('.deck-card[data-index="0"] .deck-title').click();await field().waitFor();
    const original=await current(),originalValue=await field().inputValue();let selected='kept words';
    if(name==='dirty-selection'){await field().press('Meta+a');await page.keyboard.type(originalValue+' edited');}
    if(name==='whitespace-only'){await field().press('Meta+a');await page.keyboard.type('Source\nbefore   after');selected='   ';}
    if(name==='no-selection')selected=null;
    if(name==='hidden-image-parts')selected='after\n\n\nAfter picture.';
    let state=await select(field(),selected);
    if(name==='fresh1075-split'){
      await page.keyboard.press('Meta+Enter');await field().waitFor();assert.equal(await field().inputValue(),selected);state=await select(field(),selected);
    }
    const result={surface,name,item,original,originalValue,selection:state,eventStart,sendCountBefore:report.requests.filter(r=>r.payload?.kind==='message.send').length};report.cases.push(result);await put('progress.json',report.cases);
    const ordinary=name==='no-selection'||name==='whitespace-only';
    const saved=ordinary?null:quoteSave(item,1);saved?.catch(()=>{});await page.keyboard.press('Enter');
    if(ordinary){
      assert.equal(await field().inputValue(),state.value.slice(0,state.start)+'\n'+state.value.slice(state.end));assert.equal(await page.locator('#reader').evaluate(d=>d.open),false);
      result.fieldAfter=await field().inputValue();result.coreAfter=await current();
    }else{
      await openReader();const response=await saved,command=response.request().postDataJSON(),receipt=await response.json();assert.equal(receipt.status,'committed');
      const source=await current(),ref=command.args.quotes.at(-1).source;assert.deepEqual(ref,{kind:'memory',id:item,revision:source.source_ref.revision});
      const quotes=command.args.quotes.filter(q=>q.source.id===item);assert.equal(quotes.map(q=>q.excerpt).join(''),selected);for(const q of quotes)assert.ok(source.body.includes(q.excerpt));
      result.quoteCommand=command;result.quoteReceipt=receipt;result.confirmed=source;
      assert.equal(await page.locator('#writing-body').evaluate(f=>document.activeElement===f),true);
      if(name==='confirmed-draft-image-privacy'){
        assert.equal(source.body,original.body);assert.equal(source.source_ref.revision,original.source_ref.revision);
        await page.locator('#writing-body').click();await page.keyboard.press('Meta+ArrowDown');await page.keyboard.type('Kept1076 draft.');
        await page.locator('#who-chip').click();await page.locator('#recipient-open').click();
        for(const chip of await page.locator('#recipient-chips [data-name][aria-pressed=true]').all())if(await chip.getAttribute('data-name')!=='fixture-notebook-agent')await chip.click();
        const agent=page.locator('#recipient-chips [data-name="fixture-notebook-agent"]');if(await agent.getAttribute('aria-pressed')!=='true')await agent.click();
        await page.locator('#recipient-done').click();await page.locator('#intent-row [data-intent=whisper]').click();await page.locator('#who-done').click();
        await page.locator('#plus-button').click();const chooser=page.waitForEvent('filechooser');await page.locator('#add-image').click();await(await chooser).setFiles(resolve('tests/fixtures/media/screen.png'));if(await page.locator('#plus-done').isVisible())await page.locator('#plus-done').click();
        let draft;
        for(let n=0;n<120;n++){draft=(await view('editor_state',{topic_id:'t1',source_ref:ref})).draft;if(draft?.attachments.length===1&&draft.body.includes('Kept1076 draft.')&&draft.whisper===true)break;await page.waitForTimeout(50);}
        assert.equal(draft.attachments.length,1);assert.equal(draft.whisper,true);assert.deepEqual(draft.addressees,['fixture-notebook-agent']);result.keptDraft=draft;
        await page.locator('#reader-close').click();
        if(surface==='full'){await flush();await page.goto(route);await page.locator('body[data-ready=true]').waitFor();if(!await field().count())await host().locator('.deck-card[data-index="0"] .deck-title').click();}
        await field().waitFor();assert.equal(await field().inputValue(),originalValue);result.appendedSelection=await select(field(),'before');
        const appended=quoteSave(item,2);appended.catch(()=>{});await page.keyboard.press('Enter');await openReader();assert.equal((await(await appended).json()).status,'committed');
        const after=(await view('editor_state',{topic_id:'t1',source_ref:ref})).draft;result.appendedDraft=after;
        assert.ok(after.body.startsWith(draft.body.trimEnd()));assert.equal(after.quotes.length,draft.quotes.length+1);assert.deepEqual(after.attachments,draft.attachments);assert.deepEqual(after.addressees,draft.addressees);assert.equal(after.whisper,draft.whisper);assert.equal(after.intent,draft.intent);
        assert.equal(report.requests.filter(r=>r.payload?.kind==='message.send').length,result.sendCountBefore,'quoting sends nothing');
        await flush();await page.goto(origin+`/?topic=t1&page=${item}&revision=${ref.revision}`);await page.locator('body[data-ready=true]').waitFor();await openReader();
        const reloaded=(await view('editor_state',{topic_id:'t1',source_ref:ref})).draft;assert.equal(reloaded.quotes.length,after.quotes.length);assert.equal(await page.locator('#writing-body').inputValue(),after.body);result.reloadedDraft=reloaded;
        const sent=page.waitForResponse(r=>{try{return r.request().postDataJSON()?.kind==='message.send';}catch{return false;}});sent.catch(()=>{});await page.locator('#writing-body').click();await page.keyboard.press('Meta+Enter');const send=await(await sent).json();assert.equal(send.status,'committed');result.sent=send;
        result.sentSource=await view('source',{source_ref:{kind:'message',id:send.result.message_id}});assert.equal(result.sentSource.whisper,true);assert.ok(result.sentSource.body.includes('Kept1076 draft.'));
        assert.equal((await current()).body,original.body);
      }else{
        assert.equal(report.requests.filter(r=>r.payload?.kind==='message.send').length,result.sendCountBefore,'quote does not send');
        await page.locator('#reader-close').click();
        if(name==='fresh1075-split'&&surface==='sheet'){
          await field().waitFor();assert.equal(await field().inputValue(),selected);await field().press('Meta+z');
          await field().waitFor({state:'detached'});let restored;for(let n=0;n<120;n++){restored=await current();if(restored.body===original.body)break;await page.waitForTimeout(50);}assert.equal(restored.body,original.body);result.undone=restored;
        }
      }
    }
    await page.screenshot({path:`${evidence}/${surface}-${name}.png`});await flush();
    result.eventEnd=report.events.length;result.events=report.events.slice(eventStart,result.eventEnd);
    const nativeReturn=selection=>result.events.some(e=>e.documentId===selection.documentId&&e.type==='keydown'&&e.key==='Enter'&&e.trusted&&
      !e.metaKey&&!e.ctrlKey&&!e.altKey&&!e.shiftKey&&e.value===selection.value&&e.start===selection.start&&e.end===selection.end&&e.direction===selection.direction);
    assert.equal(nativeReturn(state),true,'this case has its own trusted plain Return with the exact captured field range');
    if(result.appendedSelection)assert.equal(nativeReturn(result.appendedSelection),true,'the append has its own trusted exact-range Return');
    assert.ok(result.events.some(e=>e.documentId===state.documentId&&e.type==='keydown'&&e.key==='ArrowRight'&&e.trusted),'this case has native selection/caret keys');
    result.nativeReturnVerified=true;result.passed=true;await put('progress.json',report.cases);sample();
  }
  await flush();assert.ok(report.events.some(e=>e.type==='keydown'&&e.key==='Enter'&&e.trusted));assert.ok(report.events.some(e=>e.type==='keydown'&&e.key==='ArrowRight'&&e.trusted));
  assert.deepEqual(report.captureErrors,[]);assert.deepEqual(report.pageErrors,[]);
  for(const owner of ['web/notebook-page.mjs','web/notebook-passages.mjs','web/notebook-writing.mjs','web/notebook-card-split.mjs','web/notebook-quote-transfer.mjs','web/app.mjs','web/reader.mjs'])assert.ok(served.has(owner),'actual served owner '+owner);
  report.completed=true;
}catch(error){report.fatal=error.stack;if(page){await page.screenshot({path:`${evidence}/failure.png`}).catch(()=>{});report.failureState=await page.evaluate(()=>({url:location.href,ready:document.body.dataset.ready,active:document.activeElement?.outerHTML,readerOpen:document.querySelector('#reader')?.open})).catch(e=>({error:String(e)}));}}
finally{
  if(!captures.closed){report.cleanup.responseJobsAtClose=captures.close();report.cleanup.captureClosedUTC=new Date().toISOString();}
  await cleanup('response captures',async()=>{await bounded(Promise.all(jobs),'response captures');});
  if(browser){report.cleanup.browserCloseStart=new Date().toISOString();await cleanup('Browser.close',async()=>{sample();await bounded(browser.close(),'Browser.close');report.cleanup.browserCloseReturn=new Date().toISOString();});report.cleanup.disconnected=!browser.isConnected();}
  if(fixture){fixture.stdin.end();report.cleanup.eof=new Date().toISOString();await cleanup('fixture exit/stdio',async()=>{report.cleanup.fixtureExit=await bounded(channel.exit,'fixture exit');report.cleanup.stdioClosed=await bounded(channel.stdio,'fixture stdio');report.cleanup.fixtureErrors=channel.errors();report.cleanup.stdinFinished=fixture.stdin.writableFinished;assert.equal(report.cleanup.stdinFinished,true);});
    await cleanup('post-EOF records',async()=>{const b=await readFile(`${evidence}/fixture-teardown.jsonl`);assert.ok(b.toString().endsWith('\n'));const rows=b.toString().trimEnd().split('\n').map(JSON.parse);report.cleanup.teardown={sha256:sha(b),records:rows};assert.equal(rows.at(-1).event,'cleanup-complete');assert.deepEqual(rows.at(-1).errors,[]);assert.equal(rows.at(-1).fixtureBodyError,null);assert.ok(rows.filter(r=>r.event==='cleanup-stage').every(r=>r.status==='ok'));});
    if(origin)report.cleanup.tcp=await refusal(origin);
  }
  const live=sample();report.cleanup.owned=[...owned.values()];report.cleanup.remaining=live.filter(r=>owned.has(identity(r)));report.cleanup.profileProcesses=profile?live.filter(r=>r.command.includes(profile)):[];
  if(profile&&!report.cleanup.remaining.length&&!report.cleanup.profileProcesses.length&&(!browser||report.cleanup.disconnected))await cleanup('profile removal',()=>rm(profile,{recursive:true}));
  report.cleanup.profileAbsent=profile?await access(profile).then(()=>false,()=>true):true;report.served=[...served];report.sourceUnchanged=(await Promise.all([...sources].map(async([n,b])=>sha(await readFile(n))===sha(b)))).every(Boolean);
  report.cleanup.responseJobsAfterClose=jobs.length;assert.equal(report.cleanup.responseJobsAfterClose,report.cleanup.responseJobsAtClose,'no capture job is appended after closing begins');
  report.cleanup.verified=report.cleanup.errors.length===0&&report.cleanup.remaining.length===0&&report.cleanup.profileProcesses.length===0&&report.cleanup.profileAbsent&&(!browser||report.cleanup.disconnected)&&(!fixture||(report.cleanup.fixtureExit?.code===0&&report.cleanup.fixtureExit?.signal===null&&report.cleanup.stdioClosed?.code===0&&report.cleanup.fixtureErrors===''&&report.cleanup.tcp?.refused));
  report.limits='One headless engine/1280/dark representative, two Notebook routes and named editor cases. Native keyboard and pointer events are fixture-owned; setFiles supplies a scratch image through the real chooser and does not prove a physical file gesture. No physical phone, software keyboard, IME, clipboard, timing, other-engine/cell, source freeze or approval claim.';
  await put('native.json',report);
}
assert.equal(report.cleanup.verified,true,'complete current owned cleanup');assert.equal(report.sourceUnchanged,true);assert.equal(report.fatal,undefined);assert.equal(report.completed,true);

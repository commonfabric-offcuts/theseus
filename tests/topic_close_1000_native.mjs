// Real full app + HTTP adapter + Core, native browser input, isolated records.
// Browser monotonic timestamps measure the observed local fixture only.
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdir, writeFile, readFile, access } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import net from 'node:net';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { headerChecks } from './topic_header_native.mjs';
import { topicCloseFlows } from './topic_close_1000_flows.mjs';
import { fixtureControl } from './fixture_control.mjs';
const [chrome, playwright, out, mode='baseline', engine='chromium'] = process.argv.slice(2);
assert.ok(['chromium','webkit'].includes(engine));
assert.ok(['baseline','canary','verify','flows','flow-canary','headers'].includes(mode));
const root=fileURLToPath(new URL('..',import.meta.url));
const api=createRequire(import.meta.url)(playwright);
await mkdir(out,{recursive:true});
const fixture=spawn('/usr/bin/python3',['-I','-X',`pycache_prefix=${out}/pycache`,`${root}/tests/fixtures/topic_close_1000.py`,root,out],{cwd:root});
const {control,exit,errors:fixtureErrors}=fixtureControl(fixture);
const result={mode,engine,source:root,head:execFileSync('git',['-C',root,'rev-parse','HEAD'],{encoding:'utf8'}).trim(),hashes:{},cells:[],errors:[],cleanup:{fixturePid:fixture.pid}};
for(const name of ['web/aim.css','web/app.mjs','web/topic-close.mjs','web/topic-close-storage.mjs','web/topic-close-ui.mjs','web/topic-close-projection.mjs','web/outline-menus.mjs','web/topic-navigation.mjs','web/topic-state.mjs','web/in-place-navigation.mjs','web/outline-rail.mjs','web/api.mjs','tests/fixtures/ui_http.py','tests/fixtures/topic_close_1000.py','tests/topic_close_1000_native.mjs','tests/topic_close_1000_flows.mjs','tests/topic_header_native.mjs'])result.hashes[name]=createHash('sha256').update(await readFile(`${root}/${name}`)).digest('hex');
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const rows=()=>execFileSync('/bin/ps',['-axo','pid=,ppid=,command='],{encoding:'utf8'}).split('\n').map(s=>s.trim().match(/^(\d+)\s+(\d+)\s+(.*)$/)).filter(Boolean).map(m=>({pid:+m[1],parent:+m[2],command:m[3]}));
const owned=new Set();let browser,facts,profile,cdp,page;
const observe=async()=>{if(cdp)for(const p of (await cdp.send('SystemInfo.getProcessInfo')).processInfo)owned.add(p.id);const ps=rows();for(const p of ps)if(profile&&p.command.includes(profile))owned.add(p.pid);for(let changed=true;changed;){changed=false;for(const p of ps)if(owned.has(p.parent)&&!owned.has(p.pid)){owned.add(p.pid);changed=true;}}};
try{
 facts=await control({method:'ready',runtime_evidence:true});result.runtime={...facts};delete result.runtime.token;result.loadBefore=execFileSync('/usr/bin/uptime',[],{encoding:'utf8'}).trim();
 const load=+result.loadBefore.match(/load averages?:\s*([\d.]+)/)[1];assert.ok(load<12,`load ${load} must be below12 on18cores`);
 if(engine==='chromium'){browser=await api.chromium.launch({executablePath:chrome,headless:true,args:['--enable-automation']});cdp=await browser.newBrowserCDPSession();profile=(await cdp.send('Browser.getBrowserCommandLine')).arguments.find(x=>x.startsWith('--user-data-dir='))?.slice(16);}else{profile=await mkdtemp(join(tmpdir(),'core-lane8-1000-webkit-'));const context=await api.webkit.launchPersistentContext(profile,{headless:true});browser=context.browser();}
 result.version=browser.version();assert.equal(browser.browserType().name(),engine);assert.ok(profile);await observe();assert.ok(owned.size);
 let serial=0;
 if(mode==='headers'){
  assert.equal(engine,'chromium');const contexts=[];result.headers=[];
  const until=async(probe,label)=>{const end=Date.now()+12000;while(Date.now()<end){const value=await probe();if(value)return value;await pause(25);}throw Error('Timed out: '+label);};
  try{await headerChecks({facts,control,view:async(name,args)=>(await control({method:'agent_view',actor:facts.actor,name,args})),until,shot:async(p,label)=>p.native.screenshot({path:`${out}/${label}.png`}),
   check:async(name,act)=>{if(!/^header (a topic Ready for review|✅ Done is reached)/.test(name))return;const cell={name};result.headers.push(cell);try{await act();cell.passed=true;}catch(error){cell.error=error.stack;throw error;}},
   page:async(label,setup,live,options={})=>{const context=await browser.newContext({viewport:{width:1440,height:900}});contexts.push(context);const native=await context.newPage();page=native;const session=await context.newCDPSession(native),calls=[],errors=[];native.on('request',q=>{try{const payload=q.postDataJSON();if(payload)calls.push({payload});}catch{}});native.on('pageerror',error=>errors.push(error.stack));
    await native.goto(options.url??`${facts.origin}/?topic=t1`);await native.waitForFunction(()=>document.body.dataset.ready==='true'&&!document.documentElement.hasAttribute('data-rails-reading'));
    return{native,calls,errors,evaluate:source=>native.evaluate(source),point:selector=>native.locator(selector).first().click(),box:selector=>native.locator(selector).first().boundingBox(),send:(method,args)=>session.send(method,args),key:(key,mods=0)=>native.keyboard.press([(mods&4?'Meta':null),(mods&8?'Shift':null),(mods&2?'Control':null),(mods&1?'Alt':null),key].filter(Boolean).join('+'))};}});assert.equal(result.headers.length,2);}
  finally{await observe();for(const context of contexts)await context.close();page=null;}
 }else if(['flows','flow-canary'].includes(mode)){
  await control({method:'navigation_topics',topics:[{id:'close1000-flow-other',title:'Another synthetic topic'}]});
  await topicCloseFlows({browser,control,facts,result,out,engine,canary:mode==='flow-canary',observe});
 }else for(const volume of mode==='canary'?['small']:['small','larger']){
  const start=volume==='small'?0:6,end=volume==='small'?6:80;
  await control({method:'navigation_topics',topics:Array.from({length:end-start},(_,i)=>({id:`close1000-${i+start}`,title:`Synthetic topic ${i+start}`}))});
  if(volume==='larger')for(let i=0;i<160;i++)await control({method:'agent_message',operation_id:`1000-history-${i}`,sender:'person',topic_id:'t1',body:`Synthetic history ${i}: retained writing and an ordinary topic reply.`,whole_topic:true});
  const counts=await control({method:'counts'});
  for(const width of mode==='canary'?[1280]:[1280,390])for(const look of mode==='canary'?['bookends']:['bookends','paper'])for(const action of ['done','archive']){
   const label=`${volume}-${width}-${look}-${action}`;
   await control({method:'topic_state',operation_id:`1000-reset-${++serial}`,topic_id:'t1',args:{archived:false,state:'review',note:'Synthetic ready topic'}});
   const context=await browser.newContext({viewport:{width,height:900},colorScheme:look==='bookends'?'dark':'light',hasTouch:width<500,isMobile:width<500});
   page=await context.newPage();page.setDefaultTimeout(15000);page.on('pageerror',e=>result.errors.push({label,error:e.stack}));
   await page.addInitScript(({look})=>{
    localStorage.setItem('theseus-look',look==='paper'?'paper':'');
    const E=window.close1000={requests:[],frames:[],keeps:[],action:null,watch:false};
    const transaction=IDBDatabase.prototype.transaction,put=IDBObjectStore.prototype.put,tracked=new WeakMap();
    IDBDatabase.prototype.transaction=function(...args){const tx=transaction.apply(this,args);if(this.name==='theseus-topic-close'&&args[1]==='readwrite'){const keep={start:performance.now(),durability:tx.durability,ids:[]};E.keeps.push(keep);tracked.set(tx,keep);tx.addEventListener('complete',()=>keep.complete=performance.now());tx.addEventListener('abort',()=>keep.aborted=performance.now());}return tx;};
    IDBObjectStore.prototype.put=function(row,...rest){const keep=tracked.get(this.transaction);if(keep)keep.ids.push(row.id);return put.call(this,row,...rest);};
    const original=window.fetch;
    window.fetch=async function(input,options){
     let payload=null;try{payload=JSON.parse(options?.body);}catch{}
     const url=typeof input==='string'?input:input?.url;
     const row={url,payload,start:performance.now()};E.requests.push(row);
     try{
      const response=await original.apply(this,arguments);row.headers=performance.now();row.http=response.status;
      const json=response.json.bind(response);response.json=async()=>{try{const value=await json();row.end=performance.now();row.answer={status:value.status,error:value.error?.code};return value;}catch(error){row.end=performance.now();row.error=String(error);throw error;}};
      return response;
     }catch(error){row.end=performance.now();row.error=String(error);throw error;}
    };
    window.addEventListener('click',event=>{if(!E.watch)return;const b=event.target.closest('button');if(!b)return;if(b.classList.contains('mark-done')||b.textContent.trim()==='Archive'){E.action={at:performance.now(),trusted:event.isTrusted,text:b.textContent};}},true);
    const sample=()=>{
     if(E.watch){const active=[...document.querySelectorAll('#outline a[data-topic-id="t1"]')].some(n=>!n.closest('.topic-group'));
      const state={url:location.search,active,ready:document.body.dataset.ready==='true',outcomeVisible:!!document.querySelector('#outcome-page:not([hidden])'),heading:document.querySelector('#topic-title')?.textContent,subtitle:document.querySelector('#topic-description')?.textContent,reader:!!document.querySelector('#reader')?.open,railsReading:document.documentElement.hasAttribute('data-rails-reading'),current:[...document.querySelectorAll('#outline [aria-current="page"]')].map(n=>({topic:n.dataset.topicId,workspace:n.dataset.workspaceId,text:n.textContent}))};
      const key=JSON.stringify(state);if(E.last!==key){E.last=key;E.frames.push({at:performance.now(),...state});}}
     requestAnimationFrame(sample);
    };requestAnimationFrame(sample);
   },{look});
   await page.goto(`${facts.origin}/?topic=t1`);
   await page.waitForFunction(()=>document.body.dataset.ready==='true'&&document.querySelector('#topic-description .mark-done')&&!document.documentElement.hasAttribute('data-rails-reading'));
   await page.waitForFunction(()=>!close1000.requests.some(r=>r.payload&&!r.end)&&performance.now()-Math.max(0,...close1000.requests.map(r=>r.end??r.headers??r.start))>100);
   if(action==='archive'){await page.locator('#settings-open').click();await page.locator('#topic-settings').waitFor({state:'visible'});}
   await page.evaluate(()=>{close1000.watch=true;close1000.start=performance.now();});
   const button=action==='done'?page.locator('#topic-description .mark-done'):page.locator('#topic-settings button').filter({hasText:/^Archive$/});
   if(width<500)await button.tap();else await button.click();
   await page.waitForFunction(()=>close1000.requests.some(r=>r.payload?.kind==='topic.update'&&r.end));
   if(mode==='verify')await page.waitForFunction(()=>location.search==='?workspace=w1'&&document.body.dataset.ready==='true'&&document.querySelector('#outline a.ol-name[data-workspace-id="w1"][aria-current="page"]'));
   await page.waitForFunction(()=>!document.documentElement.hasAttribute('data-rails-reading')&&!close1000.requests.some(r=>r.start>=close1000.action.at&&r.payload&&!r.end));
   await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
   const observed=await page.evaluate(()=>structuredClone(close1000));
   assert.equal(observed.action.trusted,true,'actual native act');
   const command=observed.requests.find(r=>r.payload?.kind==='topic.update'&&r.start>=observed.action.at);assert.equal(command.answer.status,'committed');
   const keep=observed.keeps.find(k=>k.ids.includes(command.payload.operation_id));if(mode==='verify'){assert.equal(keep.durability,'strict');assert.ok(keep.complete<=command.start,'strict transaction completes before command dispatch');}
   const related=observed.requests.filter(r=>r.start>=observed.action.at);
   const removed=observed.frames.find(r=>r.at>=observed.action.at&&!r.active);
   const destination=observed.frames.find(r=>r.at>=observed.action.at&&new URLSearchParams(r.url).get('workspace')==='w1'&&r.ready&&r.outcomeVisible&&r.heading&&r.current.some(n=>n.workspace==='w1'));
   const cell={label,volume,width,look,action,counts,observed,timings:{durableKeep:keep?keep.complete-observed.action.at:null,dispatch:command.start-observed.action.at,commandRoundTrip:command.end-command.start,commandAnswer:command.end-observed.action.at,activeRemoval:removed?removed.at-observed.action.at:null,outcomeDestination:destination?destination.at-observed.action.at:null},readsAfterAct:related.filter(r=>r.payload?.name||r.payload?.query).map(r=>({name:r.payload.name??r.payload.query,start:r.start-observed.action.at,roundTrip:r.end-r.start,end:r.end-observed.action.at})),final:observed.frames.at(-1)};
   result.cells.push(cell);
   if(mode==='verify'){assert.ok(destination,'Archive/Done opens the actual parent outcome');assert.equal(cell.final.reader,false);assert.ok(cell.final.current.some(r=>r.workspace==='w1'));await page.locator('#topic-close-notice').getByRole('button',{name:'Undo',exact:true}).click();await page.waitForFunction(()=>document.querySelector('#topic-close-notice').textContent.includes('Restored'));const saved=(await control({method:'agent_view',actor:facts.actor,name:'topic',args:{topic_id:'t1'}})).topic;assert.equal(saved.state,'review');assert.equal(saved.archived,false);assert.equal(saved.state_note,'Synthetic ready topic');}
   await page.screenshot({path:`${out}/${label}.png`,fullPage:false});await observe();await context.close();page=null;
   await writeFile(`${out}/results.json`,JSON.stringify(result,null,2));console.log(JSON.stringify({label,timings:cell.timings,reads:cell.readsAfterAct}));
  }
 }
 result.admission=await control({method:'admission_events'});assert.deepEqual(result.admission.fatal,[]);assert.deepEqual(result.errors,[]);
}catch(error){result.failure=error.stack;process.exitCode=1;if(page&&!page.isClosed()){await page.screenshot({path:`${out}/failure.png`}).catch(()=>{});await writeFile(`${out}/failure.html`,await page.content()).catch(()=>{});}}
finally{
 if(browser){await observe();await browser.close();result.cleanup.browserClosed=!browser.isConnected();}
 for(let n=0;n<30&&[...owned].some(pid=>rows().some(p=>p.pid===pid));n++)await pause(100);
 const ps=rows();result.cleanup.observedBrowserPids=[...owned];result.cleanup.remainingObservedPids=[...owned].filter(pid=>ps.some(p=>p.pid===pid));result.cleanup.profileProcesses=ps.filter(p=>profile&&p.command.includes(profile));result.cleanup.profile=profile;if(engine==='webkit'&&!result.cleanup.remainingObservedPids.length&&!result.cleanup.profileProcesses.length)await rm(profile,{recursive:true,force:true});result.cleanup.profileAbsent=profile?await access(profile).then(()=>false,()=>true):true;
 fixture.stdin.end();result.cleanup.fixtureExit=await exit;result.cleanup.fixtureErrors=fixtureErrors();result.cleanup.fixtureAbsent=!rows().some(p=>p.pid===fixture.pid);
 if(facts)result.cleanup.portClosed=await new Promise(resolve=>{const u=new URL(facts.origin),socket=net.connect(+u.port,u.hostname);socket.once('connect',()=>{socket.destroy();resolve(false);});socket.once('error',()=>resolve(true));});
 const scratch=JSON.parse(await readFile(`${out}/scratch-roots.json`));result.cleanup.scratchRoots=scratch;result.cleanup.scratchAbsent=(await Promise.all(scratch.map(p=>access(p).then(()=>false,()=>true)))).every(Boolean);
 await writeFile(`${out}/results.json`,JSON.stringify(result,null,2));
 assert.equal(result.cleanup.browserClosed,true);assert.deepEqual(result.cleanup.remainingObservedPids,[]);assert.deepEqual(result.cleanup.profileProcesses,[]);assert.equal(result.cleanup.profileAbsent,true);assert.deepEqual(result.cleanup.fixtureExit,{code:0,signal:null});assert.equal(result.cleanup.fixtureErrors,'');assert.equal(result.cleanup.fixtureAbsent,true);assert.equal(result.cleanup.portClosed,true);assert.equal(result.cleanup.scratchAbsent,true);
 console.log(JSON.stringify({cells:result.cells.length,failure:result.failure,cleanup:result.cleanup}));
}

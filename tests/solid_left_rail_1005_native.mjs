// Real app/Core/HTTP and native input. Controlled holds/refusals are labelled;
// observed transport timings are never presented as production latency.
import assert from 'node:assert/strict';
import {spawn,execFileSync} from 'node:child_process';
import {mkdir,mkdtemp,writeFile,rm,access} from 'node:fs/promises';
import net from 'node:net';
import {fixtureControl} from './fixture_control.mjs';
const engines=await import(process.env.AIM_PLAYWRIGHT_CORE),engine=process.env.AIM_BROWSER??'chromium';
const evidence=process.argv[2];await mkdir(evidence,{recursive:true});
const sourceFiles=['web/in-place-navigation.mjs','web/outline-rail.mjs','web/topic-navigation.mjs','web/freshness.mjs','web/app.mjs','web/rails.mjs','web/outline-dossiers.mjs','tests/solid_left_rail_1005_native.mjs'];
const hashes=execFileSync('/usr/bin/shasum',['-a','256',...sourceFiles],{encoding:'utf8'}).trim();
const load=execFileSync('uptime',{encoding:'utf8'}).trim();assert.ok(Number(/load averages?:\s*([\d.]+)/.exec(load)?.[1])<12,load);
await writeFile(evidence+'/source.json',JSON.stringify({HEAD:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),hashes,load},null,2));
const fixture=spawn('/usr/bin/python3',['-B','tests/fixtures/ui_http.py','--freshness','--live']);
const {control,exit,errors:fixtureErrors}=fixtureControl(fixture);
const checks=[],traces=[],cleanup={},owned=new Set();let browser,profile,facts,failure;
const deferred=()=>{let resolve;const promise=new Promise(done=>resolve=done);return{promise,resolve};};
const waiting=async(promise,why)=>{let timer;try{return await Promise.race([promise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error(why)),12000);})]);}finally{clearTimeout(timer);}};
const ps=()=>execFileSync('/bin/ps',['-axo','pid=,ppid=,command='],{encoding:'utf8'}).trim().split('\n').map(line=>{const[,pid,ppid,command]=line.match(/^\s*(\d+)\s+(\d+)\s+(.*)$/);return{pid:+pid,ppid:+ppid,command};});
function remember(){const rows=ps();for(const r of rows)if(profile&&r.command.includes(profile))owned.add(r.pid);for(let more=true;more;){more=false;for(const r of rows)if(owned.has(r.ppid)&&!owned.has(r.pid)){owned.add(r.pid);more=true;}}}
const check=async(name,act)=>{try{await act();checks.push({name,pass:true});}catch(e){checks.push({name,error:e.stack});}await writeFile(evidence+'/progress.json',JSON.stringify({checks,traces},null,2));};
const A='rail1005-a',B='rail1005-b',C='rail1005-c',atopic=A+'-00';
const routeOf=id=>'#outline .ol-outcome[data-workspace-id="'+id+'"]';
const pending=new Set();
try{
 facts=await control({method:'ready'});
 await control({method:'navigation_workspaces',workspaces:[A,B,C].map((id,index)=>({id,title:'Rail1005 '+String.fromCharCode(65+index),purpose:'Isolated rail navigation'}))});
 await control({method:'navigation_topics',topics:[A,B,C].flatMap(workspace=>Array.from({length:6},(_,index)=>({id:workspace+'-'+String(index).padStart(2,'0'),title:workspace+' topic '+index,workspace_id:workspace})))});
 profile=await mkdtemp(evidence+'/'+engine+'-profile-');
 const persistent=await engines[engine].launchPersistentContext(profile,{headless:true,...(engine==='chromium'?{executablePath:process.env.AIM_CHROME}:{})});browser=persistent.browser();remember();assert.ok(owned.size);
 cleanup.engine=browser.browserType().name();cleanup.version=browser.version();
 let width=1280,look='';
 async function withPage(key,action){
  key+='-'+width+'-'+(look||'bookends');
  const context=await browser.newContext({viewport:{width,height:1000},colorScheme:look?'light':'dark',isMobile:width<760,hasTouch:width<760}),page=await context.newPage(),events=[],requests=new Map(),pageErrors=[];let serial=0;
  page.setDefaultTimeout(12000);page.on('pageerror',e=>pageErrors.push({message:e.message,stack:e.stack,url:page.url()}));
  page.on('request',r=>{if(!['/api/view','/api/bootstrap','/api/build'].includes(new URL(r.url()).pathname))return;let body;try{body=r.postDataJSON();}catch{}const event={id:++serial,kind:'request',at:performance.now(),path:new URL(r.url()).pathname,body,lane:r.headers()['x-aim-read-class']??null,url:page.url()};requests.set(r,event);events.push(event);});
  page.on('requestfinished',r=>{const event=requests.get(r);if(event){event.finished=performance.now();event.timing=r.timing();}});
  page.on('requestfailed',r=>{const event=requests.get(r);if(event){event.failed=performance.now();event.failure=r.failure();}});
  page.on('response',async response=>{const event=requests.get(response.request());if(event){event.response=performance.now();event.status=response.status();try{if(event.path==='/api/view'){const v=await response.json();event.code=v.error?.code;}}catch{event.unreadable=true;}}});
  await context.addInitScript(look=>{window.document1005=crypto.randomUUID();localStorage.setItem('theseus-look',look);},look);
  const settled=()=>page.waitForFunction(()=>document.body.dataset.ready==='true'&&!document.documentElement.hasAttribute('data-rails-reading'));
  const snapshot=()=>page.evaluate(()=>{const t=window.trace1005;const visible=n=>!n.hidden&&n.getClientRects().length>0&&!n.closest('[hidden]');return{url:location.href,document:window.document1005,rows:[...document.querySelectorAll('#outline a[data-topic-id],#outline a.ol-name')].filter(visible).map(n=>{let identity=t.identities.get(n);if(!identity)t.identities.set(n,identity=++t.serial);const r=n.getBoundingClientRect();return{key:n.dataset.topicId??n.dataset.workspaceId,identity,current:n.getAttribute('aria-current'),top:r.top,height:r.height,opacity:getComputedStyle(n).opacity,dimmed:n.dataset.dimmed};}),folds:[...document.querySelectorAll('#outline .ol-outcome')].map(n=>[n.dataset.workspaceId,n.querySelector('.ol-disclosure').getAttribute('aria-expanded')]),notices:[...document.querySelectorAll('#outline .notice,#updates-status')].filter(visible).map(n=>n.textContent),observations:t.observations};});
  const install=()=>page.evaluate(()=>{const t=window.trace1005={identities:new WeakMap(),serial:0,observations:[]};let previous='';const record=()=>{const visible=n=>!n.hidden&&n.getClientRects().length>0&&!n.closest('[hidden]');const notices=[...document.querySelectorAll('#outline .notice,#updates-status')].filter(visible).map(n=>n.textContent);const text=JSON.stringify(notices);if(text!==previous){previous=text;t.observations.push({at:performance.now(),url:location.href,notices});}};new MutationObserver(record).observe(document.body,{subtree:true,childList:true,attributes:true,attributeFilter:['hidden','aria-current','inert']});record();});
  const state={key,width,look,events,pageErrors,phases:[]};
  const act=locator=>width<760?locator.tap():locator.click();
  const show=async()=>{if(width<760&&!await page.locator('#rail').evaluate(n=>n.classList.contains('open')))await act(page.locator('#rail-open'));};
  try{await page.goto(facts.origin+'/?topic='+atopic);await settled();await install();await action({page,context,events,settled,snapshot,state,act,show});
   await check(key+' no uncaught page errors',()=>assert.deepEqual(pageErrors,[]));}
  catch(e){state.fatal=e.stack;await page.screenshot({path:evidence+'/'+key+'-fatal.png',animations:'disabled'}).catch(()=>{});checks.push({name:key+' completes',error:e.stack});}
  finally{state.final=await snapshot().catch(()=>null);traces.push(state);remember();await page.screenshot({path:evidence+'/'+key+'.png',animations:'disabled'}).catch(()=>{});await context.close();await writeFile(evidence+'/progress.json',JSON.stringify({checks,traces},null,2));}
 }
 for(width of [1280,390])for(look of ['', 'paper']){
 await withPage('navigation',async({page,events,settled,snapshot,state,act,show})=>{
  await show();
  for(const id of [A,C]){const toggle=page.locator(routeOf(id)+' .ol-disclosure');if(await toggle.getAttribute('aria-expanded')!=='true'){await act(toggle);await settled();}}
  const before=await snapshot();state.phases.push({name:'before',at:performance.now(),snapshot:before});
  for(const id of [C,A]){
   const began=performance.now();await show();await act(page.locator(routeOf(id)+' .ol-name'));await page.waitForURL('**/?workspace='+id);await settled();await show();const after=await snapshot();state.phases.push({name:'move-'+id,began,ended:performance.now(),snapshot:after});
   await check('move '+id+' keeps document',()=>assert.equal(after.document,before.document));
   await check('move '+id+' retains loaded topic DOM identities',()=>{const prior=new Map(before.rows.map(r=>[r.key,r.identity]));for(const row of after.rows)if(prior.has(row.key))assert.equal(row.identity,prior.get(row.key),row.key);});
   await check('move '+id+' retains folds',()=>assert.deepEqual(after.folds,before.folds));
  }

  for(const id of [A+'-02',C+'-03']){
   await show();await act(page.locator('#outline a[data-topic-id="'+id+'"]'));await page.waitForURL('**/?topic='+id);await settled();await show();const after=await snapshot();state.phases.push({name:'topic-'+id,at:performance.now(),snapshot:after});
   await check('topic move retains loaded DOM identities '+id+' '+width+' '+look,()=>{const prior=new Map(before.rows.map(r=>[r.key,r.identity]));for(const row of after.rows)if(prior.has(row.key))assert.equal(row.identity,prior.get(row.key),row.key);});
   await check('topic move selects only current topic '+id+' '+width+' '+look,()=>assert.deepEqual(after.rows.filter(r=>r.current==='page').map(r=>r.key),[id]));
  }
  let armed=true;const reached=deferred(),release=deferred();pending.add(release);
  await page.route('**/api/view',async route=>{let v;try{v=route.request().postDataJSON();}catch{}if(armed&&v?.name==='workspace_topics'&&v.args.workspace_id===B){armed=false;const began=performance.now(),response=await route.fetch();state.controlledHold={began,serviceReturned:performance.now(),name:v.name,args:v.args};reached.resolve();await release.promise;state.controlledHold.released=performance.now();await route.fulfill({response});}else await route.continue();});
  try{
   await show();await act(page.locator(routeOf(B)+' .ol-disclosure'));await waiting(reached.promise,'B topic read reaches controlled hold');
   const held=await snapshot();state.phases.push({name:'B-read-held',at:performance.now(),snapshot:held});
   await act(page.locator(routeOf(C)+' .ol-name'));await page.waitForURL('**/?workspace='+C);
   const module=await page.evaluate(()=>new URL('./in-place-navigation.mjs',document.querySelector('script[type=module][src]').src).href);
   await page.waitForFunction(async({module,C})=>(await import(module)).shell.handles?.route?.id===C,{module,C});
   state.phases.push({name:'moved-with-B-read-held',at:performance.now(),snapshot:await snapshot()});release.resolve();pending.delete(release);await settled();
   await show();const after=await snapshot();state.phases.push({name:'released',at:performance.now(),snapshot:after});
   await check('own move never publishes a moved-on topic notice',()=>assert.equal(after.observations.some(x=>x.notices.some(n=>n.includes('page moved on'))),false));
   await check('held move retains folds',()=>assert.deepEqual(after.folds,held.folds));
   await check('held move keeps already loaded rows',()=>{for(const row of held.rows)assert.ok(after.rows.some(n=>n.key===row.key),row.key);});
  }finally{release.resolve();pending.delete(release);}
  state.duplicateReads=state.phases.filter(x=>x.began).map(phase=>{const counts=new Map();for(const e of events.filter(e=>e.at>=phase.began&&e.at<=phase.ended&&e.body?.name)){const key=e.body.name+':'+JSON.stringify(e.body.args);counts.set(key,(counts.get(key)??0)+1);}return{phase:phase.name,duplicates:[...counts].filter(([,n])=>n>1)};});
 });
 await withPage('poll',async({page,events,settled,snapshot,state,act,show})=>{
  await show();const toggle=page.locator(routeOf(A)+' .ol-disclosure');if(await toggle.getAttribute('aria-expanded')!=='true'){await act(toggle);await settled();}
  const before=await snapshot();
  let faults=1;const faultTimes=[];
  await page.route('**/api/view',async route=>{let v;try{v=route.request().postDataJSON();}catch{}if(faults&&v?.name==='changes'&&v.args.scope?.kind==='topic'&&v.args.cursor){faults--;const began=performance.now(),response=await route.fetch();faultTimes.push({began,serviceReturned:performance.now(),originalStatus:response.status(),args:v.args});await route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:{code:'SERVER_BUSY',message:'Controlled1005 retryable changes refusal',retryable:true}})});}else await route.continue();});
  const began=performance.now();state.controlledFaults=faultTimes;
  const recovered=page.waitForResponse(r=>{try{const v=r.request().postDataJSON();return faultTimes.length>0&&r.status()===200&&v?.name==='changes'&&v.args.scope?.kind==='topic'&&v.args.scope.id===atopic;}catch{return false;}});
  const receipt=await control({method:'agent_message',operation_id:'1005-poll-'+engine+'-'+width+'-'+(look||'bookends'),sender:facts.agent,topic_id:atopic,join:true,whole_topic:true,post_args:{divergence_reason:'Synthetic1005 freshness probe'},body:'Synthetic1005 freshness trigger'});assert.equal(receipt.status,'committed');
  await recovered;
  await page.waitForFunction(()=>document.querySelector('#updates-status').hidden,{timeout:12000});await settled();const after=await snapshot();state.phases.push({name:'one-transient-poll-failure',began,ended:performance.now(),snapshot:after});
  await check('one failed poll attempt recovers before a delay notice',()=>assert.equal(after.observations.some(x=>x.notices.some(n=>n.includes('Updates delayed'))),false));
  await check('poll recovers through a real answered changes request',()=>assert.ok(events.some(e=>e.body?.name==='changes'&&e.status===200&&e.at>(faultTimes[0]?.began??Infinity))));
  await check('poll status does not globally dim the rail',()=>assert.deepEqual(after.rows.map(r=>[r.key,r.opacity,r.dimmed]),before.rows.map(r=>[r.key,r.opacity,r.dimmed])));
 });
 await withPage('exhausted-poll',async({page,events,settled,snapshot,state,show})=>{
  await show();let faults=3;state.controlledFaults=[];
  await page.route('**/api/view',async route=>{const v=route.request().postDataJSON();if(faults&&v?.name==='changes'&&v.args.cursor&&v.args.scope?.kind==='topic'){
   faults--;state.controlledFaults.push({at:performance.now(),attempt:3-faults});await route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:{code:'SERVER_BUSY',retryable:true,message:'Controlled1005 sustained poll refusal'}})});
  }else await route.continue();});
  const receipt=await control({method:'agent_message',operation_id:'1005-exhausted-'+engine+'-'+width+'-'+(look||'bookends'),sender:facts.agent,topic_id:atopic,join:true,whole_topic:true,post_args:{divergence_reason:'Synthetic1005 sustained failure probe'},body:'Synthetic1005 failure trigger'});assert.equal(receipt.status,'committed');
  await page.waitForFunction(()=>document.querySelector('#updates-status').textContent.includes('Updates delayed')&&!document.querySelector('#updates-status').hidden);
  const delayed=await snapshot();state.phases.push({name:'delay-after-three-failures',at:performance.now(),snapshot:delayed});
  await check('delay follows three actual failed poll attempts '+width+' '+look,()=>assert.equal(state.controlledFaults.length,3));
  await page.waitForFunction(()=>document.querySelector('#updates-status').hidden);await settled();
  await check('exhausted poll later recovers '+width+' '+look,()=>assert.ok(events.some(e=>e.body?.name==='changes'&&e.status===200&&e.at>state.controlledFaults.at(-1).at)));
 });
 await withPage('unreadable-topics',async({page,settled,snapshot,state,act,show})=>{
  await show();const toggle=page.locator(routeOf(B)+' .ol-disclosure');await page.evaluate(()=>{window.retry1005=false;document.addEventListener('click',e=>{if(e.isTrusted&&e.target.closest('button')?.textContent==='Retry topics')window.retry1005=true;},true);});
  await page.route('**/api/view',async route=>{const v=route.request().postDataJSON();if(v?.name==='workspace_topics'&&v.args.workspace_id===B&&!await page.evaluate(()=>window.retry1005)){await route.fulfill({status:200,contentType:'application/json',body:'not JSON'});}else await route.continue();});
  await act(toggle);await page.locator(routeOf(B)+' .notice').waitFor({state:'visible'});
  const diagnostic=await snapshot();state.phases.push({name:'real-unreadable-http200',at:performance.now(),snapshot:diagnostic});
  await check('unreadable HTTP200 keeps its real diagnostic '+width+' '+look,()=>assert.ok(diagnostic.notices.some(n=>n.includes('unreadable'))));
  await act(page.locator(routeOf(B)+' .ol-own > button').filter({hasText:'Retry topics'}));await settled();
  await check('unreadable topic retry recovers '+width+' '+look,async()=>assert.equal(await page.locator(routeOf(B)+' .notice').isVisible(),false));
 });
 }

}catch(e){failure=e.stack;}
finally{
 for(const p of pending)p.resolve();
 if(browser){remember();await browser.close();cleanup.browserClosed=!browser.isConnected();}
 const after=ps();cleanup.ownedPids=[...owned];cleanup.remainingOwned=after.filter(p=>owned.has(p.pid));cleanup.profileProcesses=profile?after.filter(p=>p.command.includes(profile)):[];
 if(profile&&cleanup.browserClosed&&!cleanup.remainingOwned.length&&!cleanup.profileProcesses.length){await rm(profile,{recursive:true});cleanup.profileRemoved=await access(profile).then(()=>false,()=>true);}
 fixture.stdin.end();cleanup.fixtureExit=await exit;cleanup.fixtureErrors=fixtureErrors();cleanup.fixturePid=fixture.pid;cleanup.fixtureAbsent=!ps().some(p=>p.pid===fixture.pid);
 if(facts?.origin)cleanup.portClosed=await new Promise(resolve=>{const u=new URL(facts.origin),s=net.createConnection({host:u.hostname,port:+u.port});s.once('connect',()=>{s.destroy();resolve(false);});s.once('error',()=>resolve(true));});
 await writeFile(evidence+'/results.json',JSON.stringify({engine,checks,traces,cleanup,failure},null,2));
}
console.log(JSON.stringify({engine,pass:checks.filter(c=>c.pass).length,fail:checks.filter(c=>c.error),cleanup,failure},null,2));
if(failure||checks.some(c=>c.error)||!cleanup.browserClosed||cleanup.remainingOwned?.length||cleanup.profileProcesses?.length||!cleanup.profileRemoved||cleanup.fixtureExit?.code!==0||cleanup.fixtureErrors||!cleanup.fixtureAbsent||!cleanup.portClosed)process.exitCode=1;

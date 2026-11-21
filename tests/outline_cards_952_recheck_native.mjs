// Bounded current-head reproduction, exactly20 native cells. No product mutation.
import assert from 'node:assert/strict';
import {spawn,execFileSync} from 'node:child_process';
import {mkdir,mkdtemp,writeFile,readFile,cp,appendFile,rm,access} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import net from 'node:net';
import {fixtureControl} from './fixture_control.mjs';
const {chromium}=await import(process.env.AIM_PLAYWRIGHT_CORE),evidence=process.argv[2];await mkdir(evidence,{recursive:true});
const fixture=spawn('/usr/bin/python3',['-B','tests/fixtures/ui_http.py','--freshness']);
const {control,exit,errors}=fixtureControl(fixture),results=[],cleanup={},owned=new Set(),fixtureOwned=new Set([fixture.pid]);
const ps=()=>execFileSync('/bin/ps',['-axo','pid=,ppid=,command='],{encoding:'utf8'}).trim().split('\n').map(line=>{const[,pid,ppid,command]=line.match(/^\s*(\d+)\s+(\d+)\s+(.*)$/);return{pid:+pid,ppid:+ppid,command};});
function children(set){const list=ps();for(let changed=true;changed;){changed=false;for(const p of list)if(set.has(p.ppid)&&!set.has(p.pid)){set.add(p.pid);changed=true;}}}
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const source={};for(const name of ['outline-rail.mjs','topic-navigation.mjs','outcome-topic-cards.mjs'])source[name]=await readFile(new URL('../web/'+name,import.meta.url));
let browser,profile,origin,failure,serial=0;
const snap=()=>{
 const visible=el=>Boolean(el.getClientRects().length&&el.getBoundingClientRect().height),box=el=>{const b=el.getBoundingClientRect(),s=getComputedStyle(el);return{id:el.dataset.topicId,text:el.textContent,width:b.width,height:b.height,radius:s.borderRadius,padding:s.padding,fontSize:s.fontSize,background:s.backgroundColor,classes:el.className};};
 const rows=[...document.querySelectorAll('#outline a[data-topic-id]')].filter(visible).map(box),cards=[...document.querySelectorAll('#outline .outcome-topic-card')].filter(visible).map(box);
 return{route:location.search,look:document.documentElement.dataset.look??'',dark:matchMedia('(prefers-color-scheme:dark)').matches,rows,cards,
  cardishRows:rows.filter(r=>r.height>76),main:[...document.querySelectorAll('#outcome-page .outcome-topic-card')].filter(visible).map(box),
  feed:[...document.querySelectorAll('#messages .message-card:not([data-folded=true]):not([data-earlier=true])')].filter(visible).map(box),
  styles:[...document.querySelectorAll('link[rel=stylesheet]')].map(el=>{let rules=0,error=null;try{rules=el.sheet?.cssRules.length??0;}catch(e){error=e.name;}return{href:el.href,rules,error};})};
};
try{
 const facts=await control({method:'ready'});origin=facts.origin;children(fixtureOwned);
 const made=await control({method:'navigation_topics',topics:[{id:'t952a',title:'Redesign pencil sheet'},{id:'t952b',title:'Notebook redesign'}]});assert.ok(made.every(r=>r.status==='committed'));
 assert.equal((await control({method:'agent_message',operation_id:'952-feed-control',topic_id:'t1',sender:facts.agent,reply_without_quote:'Independent952 isolated feed-card control.',body:'An isolated dossier card.\n\nThese words exercise the normal full card in the feed while the outline keeps its separate rail rows.\n\nThe final paragraph remains part of this full message card.'})).status,'committed');
 profile=await mkdtemp(`${evidence}/chromium-profile-`);const persistent=await chromium.launchPersistentContext(profile,{headless:true,executablePath:process.env.AIM_CHROME});
 browser=persistent.browser();cleanup.engine=browser.browserType().name();cleanup.version=browser.version();assert.equal(cleanup.engine,'chromium');for(const p of ps())if(p.command.includes(profile))owned.add(p.pid);children(owned);assert.ok(owned.size);
 await writeFile(`${evidence}/owned-start.json`,JSON.stringify({profile,ownedPids:[...owned],fixturePid:fixture.pid,origin}));
 for(const look of ['', 'paper'])for(const colorScheme of ['light','dark'])for(const mode of ['cold','warm-repeat','reload','history','restart']){
  const cell=++serial,key=`${cell}-${look||'bookends'}-${colorScheme}-${mode}`,density=cell%2?'compact':'roomy';
  const context=await browser.newContext({viewport:{width:1360,height:1000},colorScheme});
  await context.addInitScript(({look,density})=>{
   if(look)localStorage.setItem('theseus-look',look);localStorage.setItem('theseus-rail-roomy',density==='roomy'?'1':'0');
   sessionStorage.loads952=String(Number(sessionStorage.loads952||0)+1);
   globalThis.seen952=[];
   const inspect=()=>{const rows=[...document.querySelectorAll('#outline .outcome-topic-card,#outline a[data-topic-id]')].filter(el=>el.getClientRects().length&&el.getBoundingClientRect().height>76);
    if(rows.length)seen952.push({route:location.search,rows:rows.map(el=>({text:el.textContent,classes:el.className,height:el.getBoundingClientRect().height}))});};
   let pending=false;new MutationObserver(()=>{if(!pending){pending=true;requestAnimationFrame(()=>{pending=false;inspect();});}}).observe(document,{subtree:true,childList:true,attributes:true});
   addEventListener('load',inspect,true);
  },{look,density});
  const page=await context.newPage(),pageErrors=[],css=[];page.setDefaultTimeout(7000);page.on('pageerror',e=>pageErrors.push(e.message));page.on('response',r=>{if(/\.css(?:$|\?)/.test(r.url()))css.push({url:r.url(),status:r.status()});});
  const settle=async()=>{await page.waitForFunction(()=>document.body.dataset.ready==='true'&&!document.documentElement.hasAttribute('data-rails-reading'));
   const disclosure=page.locator('.ol-outcome[data-workspace-id=w1] .ol-disclosure');await disclosure.waitFor();if(await disclosure.getAttribute('aria-expanded')!=='true')await disclosure.click();await page.locator('#outline a[data-topic-id=t1]:visible').waitFor();await page.evaluate(()=>new Promise(done=>requestAnimationFrame(()=>requestAnimationFrame(done))));};
  const home=async()=>{await page.locator('.ol-outcome[data-workspace-id=w1] .ol-name').click();await page.waitForFunction(()=>new URL(location.href).searchParams.get('workspace')==='w1');await settle();};
  const topic=async()=>{await page.locator('#outline a[data-topic-id=t1]:visible').click();await page.waitForFunction(()=>new URL(location.href).searchParams.get('topic')==='t1');await settle();};
  let error,state,seen,feedBefore,feedAfter,restart,sourceHashes,reached=false;
  try{
   if(mode==='restart'){
    let holding=true,resolveReady,timer;const held=[],ready=new Promise(resolve=>{resolveReady=resolve;});
    await page.route('**/b/**',route=>{if(!holding)return route.continue();held.push(route);if(held.some(r=>/\/app\.mjs$/.test(r.request().url()))&&held.some(r=>/\.css$/.test(r.request().url())))resolveReady();});
    await page.goto(`${origin}/?workspace=w1`,{waitUntil:'commit'});
    try{await Promise.race([ready,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('No held module/style graph')),7000);})]);}finally{clearTimeout(timer);}
    const oldRequests=held.map(r=>r.request().url()),oldBuild=/\/b\/([^/]+)\//.exec(oldRequests[0])[1],nextWeb=`${evidence}/restart-web-${cell}`;
    await cp(new URL('../web',import.meta.url),nextWeb,{recursive:true});await appendFile(`${nextWeb}/rail-dense.css`,`\n/* Isolated952 build marker ${cell}; no style rule. */\n`);
    await control({method:'server_stop'});const started=await control({method:'server_start',web:nextWeb});assert.equal(started.origin,origin);
    const served=await (await fetch(origin+'/api/build',{headers:{Authorization:`Bearer ${started.token}`}})).json();assert.notEqual(served.build,oldBuild);
    holding=false;await Promise.allSettled(held.map(r=>r.continue()));await settle();restart={oldBuild,newBuild:served.build,loads:await page.evaluate(()=>Number(sessionStorage.loads952))};assert.equal(restart.loads,2);
   }else{await page.goto(`${origin}/?workspace=w1`);await settle();}
   if(mode!=='cold'&&mode!=='restart'){
    await topic();feedBefore=await page.evaluate(snap);await home();
    if(mode==='warm-repeat'){await topic();await home();}
    if(mode==='reload'){await page.reload();await settle();}
    if(mode==='history'){await page.goBack();await settle();assert.match(page.url(),/topic=t1/);await page.goForward();await settle();assert.match(page.url(),/workspace=w1/);}
   }
   await page.waitForFunction(()=>document.querySelectorAll('#outcome-page .outcome-topic-card').length>=3);reached=true;state=await page.evaluate(snap);seen=await page.evaluate(()=>seen952);
   assert.equal(state.look,look);assert.equal(state.dark,colorScheme==='dark');assert.ok(state.styles.length>=6&&state.styles.every(s=>s.rules>0&&!s.error));assert.ok(css.every(r=>[200,304].includes(r.status)||(restart&&r.status===523&&r.url.includes(`/b/${restart.oldBuild}/`))));
   if(restart)assert.ok(state.styles.every(s=>s.href.includes(`/b/${restart.newBuild}/`)));
   assert.equal(state.cards.length,0);assert.equal(state.cardishRows.length,0);assert.ok(state.rows.length>=3&&state.rows.every(r=>r.height<=76));assert.deepEqual(seen,[]);
   sourceHashes={};const moduleURL=await page.evaluate(()=>[...document.scripts].find(s=>s.src.includes('/app.mjs')).src);
   for(const [name,bytes]of Object.entries(source)){const served=await(await page.request.get(new URL('./'+name,moduleURL).href)).body();assert.deepEqual(served,bytes);sourceHashes[name]=sha(served);}
   await page.screenshot({path:`${evidence}/${key}.png`,fullPage:true});
   await topic();feedAfter=await page.evaluate(snap);assert.ok(feedAfter.feed.some(r=>r.height>76),'feed keeps full dossier cards');
   if(feedBefore?.feed.length){const a=feedBefore.feed.at(-1),b=feedAfter.feed.at(-1);assert.equal(b.radius,a.radius);assert.equal(b.padding,a.padding);assert.equal(b.fontSize,a.fontSize);}
   assert.deepEqual(pageErrors,[]);
  }catch(e){error=e.stack;state??=await page.evaluate(snap).catch(()=>null);seen??=await page.evaluate(()=>seen952).catch(()=>null);await page.screenshot({path:`${evidence}/${key}-failure.png`,fullPage:true}).catch(()=>{});}
  const reproduced=Boolean(state?.cards.length||state?.cardishRows.length||seen?.length);
  results.push({cell,key,look:look||'bookends',colorScheme,mode,density,state,seen,feedBefore,feedAfter,restart,sourceHashes,pageErrors,css,reached,reproduced,error:error??null});await writeFile(`${evidence}/observations.json`,JSON.stringify(results,null,2));await context.close();
  if(reproduced||(error&&!reached))break;
 }
}catch(e){failure=e;}
finally{
 if(browser){children(owned);await browser.close();cleanup.browserClosed=!browser.isConnected();}
 const after=ps();cleanup.ownedPids=[...owned];cleanup.remainingOwned=after.filter(p=>owned.has(p.pid));cleanup.profileProcesses=profile?after.filter(p=>p.command.includes(profile)):[];
 if(profile&&cleanup.browserClosed&&!cleanup.remainingOwned.length&&!cleanup.profileProcesses.length){await rm(profile,{recursive:true});cleanup.profileRemoved=await access(profile).then(()=>false,()=>true);}
 children(fixtureOwned);fixture.stdin.end();cleanup.fixtureExit=await exit;cleanup.fixtureErrors=errors();cleanup.fixturePid=fixture.pid;cleanup.fixtureAbsent=!ps().some(p=>p.pid===fixture.pid);cleanup.fixtureOwnedPids=[...fixtureOwned];cleanup.remainingFixtureOwned=ps().filter(p=>fixtureOwned.has(p.pid));
 if(origin)cleanup.portClosed=await new Promise(resolve=>{const u=new URL(origin),s=net.createConnection({host:u.hostname,port:+u.port});s.once('connect',()=>{s.destroy();resolve(false);});s.once('error',()=>resolve(true));});
 await writeFile(`${evidence}/results.json`,JSON.stringify({sourceHead:'f9e8fd65a52c7c530d7846c79dca5bacaced19be',results,cleanup,failure:failure?.stack??null},null,2));
}
const reproduced=results.filter(r=>r.reproduced),failed=results.filter(r=>r.error);process.stdout.write(JSON.stringify({cells:results.length,reproduced:reproduced.map(r=>r.key),pass:results.length-failed.length,errors:failed.map(r=>({key:r.key,error:r.error})),cleanup,failure:failure?.stack??null},null,2)+'\n');
if(failure||failed.length||!cleanup.browserClosed||cleanup.remainingOwned?.length||cleanup.profileProcesses?.length||!cleanup.profileRemoved||cleanup.fixtureExit?.code!==0||!cleanup.fixtureAbsent||cleanup.remainingFixtureOwned?.length||!cleanup.portClosed)process.exitCode=1;

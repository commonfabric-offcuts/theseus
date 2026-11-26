import assert from 'node:assert/strict';
import {spawn, execFileSync} from 'node:child_process';
import {createInterface} from 'node:readline';
import {readFile, writeFile, access} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {dirname} from 'node:path';
import {chromium} from '/Users/commonfabric/Library/Caches/deno/npm/registry.npmjs.org/playwright-core/1.59.1/index.mjs';

const here=dirname(fileURLToPath(import.meta.url)), root=process.env.FLEX_1298_EVIDENCE;
const repo=process.env.FLEX_PRODUCT_REPO, head=process.env.FLEX_PRODUCT_HEAD;
const hash=x=>createHash('sha256').update(x).digest('hex');
const save=(name,value)=>writeFile(`${root}/${name}`,JSON.stringify(value,null,2)+'\n');
assert.equal(execFileSync('git',['-C',repo,'rev-parse','HEAD'],{encoding:'utf8'}).trim(),head);
assert.equal(execFileSync('git',['-C',repo,'status','--porcelain'],{encoding:'utf8'}),'');
const report={productHead:head,startedMs:Date.now(),status:'incomplete',arrivals:[],errors:[],network:[],coverage:[],unsupported:[],qualification:'One instrumented synthetic baseline; not general speed, native interaction acceptance or Tony incident attribution.'};
await save('native-intent.json',{head,startedMs:report.startedMs});
const fixture=spawn('/usr/bin/python3',['-X',`pycache_prefix=${root}/fixture-pycache`,'-I',`${here}/1298_fixture.py`,'serve'],{cwd:repo});
let serial=0, ended=false, fixtureStderr='';const requests=new Map();
fixture.stderr.on('data',x=>fixtureStderr+=x);
const fixtureExit=new Promise(resolve=>fixture.once('exit',(code,signal)=>{ended=true;for(const p of requests.values())p.reject(Error('fixture exited'));requests.clear();resolve({code,signal});}));
createInterface({input:fixture.stdout}).on('line',line=>{const value=JSON.parse(line),pending=requests.get(value.id);requests.delete(value.id);if(!pending)return;value.failure?pending.reject(Error(value.failure)):pending.resolve(value.answer);});
const control=value=>new Promise((resolve,reject)=>{if(ended)return reject(Error('fixture ended'));const id=++serial;requests.set(id,{resolve,reject});fixture.stdin.write(JSON.stringify({...value,id})+'\n');});
const bounded=async(promise,ms,label)=>{let timer;try{return await Promise.race([promise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error(`Deadline: ${label}`)),ms);})]);}finally{clearTimeout(timer);}};
let browser, context, page, cdp, browserProfile, profiler=false,tracing=false;
try {
  report.fixture=await bounded(control({method:'ready'}),10000,'fixture ready');
  browser=await chromium.launch({headless:false,executablePath:'/Users/commonfabric/Library/Caches/ms-playwright/chromium-1223/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing',args:['--window-size=1512,982','--theseus-1298-baseline471']});
  const bc=await browser.newBrowserCDPSession();report.browser=await bc.send('Browser.getVersion');
  const argv=(await bc.send('Browser.getBrowserCommandLine')).arguments;browserProfile=argv.find(s=>s.startsWith('--user-data-dir='))?.slice(16);
  await save('ownership.json',{fixturePid:fixture.pid,browserProfile,argv,node:{path:process.execPath,version:process.version,sha256:hash(await readFile(process.execPath))}});
  context=await browser.newContext({viewport:{width:1512,height:900},deviceScaleFactor:2,colorScheme:'dark'});
  await context.addInitScript(()=>{
    const q=window.__body1298={phase:'setup',events:[],requests:[],mutations:[],inputs:[],errors:[],dropped:0,overheadMs:0};
    q.add=(kind,data={})=>{const t=performance.now();try{if(q.events.length>=20000){q.dropped++;return;}q.events.push({kind,at:t,phase:q.phase,...data});}catch(e){q.errors.push(String(e));}finally{q.overheadMs+=performance.now()-t;}};
    const responses=new WeakMap(), fetched=window.fetch, json=Response.prototype.json;
    window.fetch=function(...args){const event={callAt:performance.now(),phase:q.phase,url:String(args[0]),body:args[1]?.body??null};q.requests.push(event);const promise=fetched.apply(this,args);promise.then(r=>{event.headersAt=performance.now();event.status=r.status;responses.set(r,event);},e=>{event.failure=String(e);});return promise;};
    Response.prototype.json=function(...args){const event=responses.get(this);if(event)event.jsonStart=performance.now();const promise=json.apply(this,args);promise.then(value=>{if(event){event.jsonEnd=performance.now();event.answer=value;}},e=>{if(event){event.jsonEnd=performance.now();event.decodeFailure=String(e);}});return promise;};
    for(const type of ['pointerdown','pointerup','click','keydown','keyup','wheel','input','selectionchange'])document.addEventListener(type,e=>q.inputs.push({type,trusted:e.isTrusted,at:performance.now(),phase:q.phase,key:e.key,deltaY:e.deltaY}),true);
    const observe=()=>{const list=document.querySelector('#messages');if(!list)return requestAnimationFrame(observe);new MutationObserver(changes=>{const t=performance.now();try{for(const m of changes){if(q.mutations.length>=20000){q.dropped++;break;}const node=m.target.nodeType===1?m.target:m.target.parentElement;q.mutations.push({at:t,phase:q.phase,type:m.type,attribute:m.attributeName,dossier:node?.closest('.reply-stack')?.dataset.dossier??null,id:node?.dataset.id??null,added:m.addedNodes.length,removed:m.removedNodes.length});}}catch(e){q.errors.push(String(e));}finally{q.overheadMs+=performance.now()-t;}}).observe(list,{subtree:true,attributes:true,childList:true,characterData:true});};requestAnimationFrame(observe);
  });
  page=await context.newPage();page.setDefaultTimeout(15000);page.on('pageerror',e=>report.errors.push(e.stack));
  cdp=await context.newCDPSession(page);await cdp.send('Network.enable');
  for(const name of ['requestWillBeSent','responseReceived','loadingFinished','loadingFailed'])cdp.on('Network.'+name,value=>{if(report.network.length<10000)report.network.push({kind:name,...value});else report.networkDropped=(report.networkDropped??0)+1;});
  await page.goto(`${report.fixture.origin}/?topic=t1298-main`);await page.waitForFunction(()=>document.body.dataset.ready==='true');await page.bringToFront();
  report.modules=await page.evaluate(()=>{const app=[...document.querySelectorAll('script[type="module"][src]')].map(e=>e.src).find(s=>new URL(s).pathname.endsWith('/app.mjs'));if(!app||!/^\/b\/[^/]+\/app\.mjs$/.test(new URL(app).pathname))throw Error('Unversioned document');return{app,importMap:document.querySelector('script[type="importmap"]')?.textContent};});
  report.moduleBytes={};for(const file of ['app.mjs','api.mjs','topic-views.mjs','stack-feed.mjs','reply-stacks.mjs']){const url=new URL(file,report.modules.app).href,response=await context.request.get(url);assert.equal(response.status(),200);const bytes=await response.body();assert.equal(hash(bytes),hash(await readFile(`${repo}/web/${file}`)));report.moduleBytes[file]={url,bytes:bytes.length,sha256:hash(bytes)};}
  report.observerIdentity=await page.evaluate(async ({app})=>{
    const views=await import(new URL('topic-views.mjs',app).href),feed=await import(new URL('stack-feed.mjs',app).href),stacks=await import(new URL('reply-stacks.mjs',app).href);
    const identity={views:(await import('/topic-views.mjs'))===views,feed:(await import('/stack-feed.mjs'))===feed};
    const q=__body1298;q.entries=stacks.entries;
    const tap=(prototype,name)=>{const actual=prototype[name];if(typeof actual!=='function')throw Error('Missing '+name);prototype[name]=function(...args){
      if(name==='messagesPage'&&!this.paint.__body1298){const paint=this.paint;this.paint=function(...a){const call=++q.serial;q.add('paint:entry',{call,paintKind:a[0]});try{return paint.apply(this,a);}finally{q.add('paint:return',{call,paintKind:a[0]});}};this.paint.__body1298=true;}
      const call=++q.serial;q.add(name+':entry',{call,ids:name==='messagesPage'?args[0]?.items?.map(m=>m.id):undefined,options:name==='messagesPage'?args[1]:undefined});
      let result;try{result=actual.apply(this,args);}catch(e){q.add(name+':throw',{call,error:String(e)});throw e;}q.add(name+':return',{call,value:typeof result==='boolean'?result:undefined,promise:result instanceof Promise});return result;
    };};q.serial=0;
    for(const name of ['messagesPage','trimWindow'])tap(views.TopicViews.prototype,name);
    for(const name of ['arrange','paintArrangement'])tap(feed.StackFeed.prototype,name);
    q.snapshot=()=>{const t=performance.now(),list=document.querySelector('#messages'),selection=getSelection(),windowState=window[Symbol.for('theseus.topicWorkingSet')]?.();const value={at:t,y:scrollY,window:windowState,
      ids:stacks.entries(list).map(e=>e.dataset.id),dossiers:[...list.querySelectorAll(':scope > .reply-stack')].map(e=>{const b=e.getBoundingClientRect();return{id:e.dataset.dossier,head:e.dataset.stack,fold:e.dataset.fold,placed:e.dataset.placed,top:b.top,bottom:b.bottom,members:stacks.entries(list).filter(n=>n.closest('.reply-stack')===e).map(n=>({id:n.dataset.id,hidden:n.hidden,cls:n.className,seq:n.dataset.seq})),cover:e.querySelector(':scope > .dossier-cover')?.textContent,html:e.outerHTML};}),
      active:{tag:document.activeElement?.tagName,id:document.activeElement?.id},selection:{collapsed:selection?.isCollapsed,text:selection?.toString()},visibility:document.visibilityState,errors:q.errors.length,dropped:q.dropped,overheadMs:q.overheadMs};q.overheadMs+=performance.now()-t;return value;};
    return identity;
  },report.modules);
  assert.ok(report.observerIdentity.views&&report.observerIdentity.feed,'Document owner identity');
  const roots=report.fixture.ledger.dossiers.map(d=>d.root.message_id),initial=report.fixture.ledger.initial_ids;
  const snapshot=()=>page.evaluate(()=>__body1298.snapshot());
  const verify=(s,ids)=>{assert.equal(report.errors.length,0,'Product exceptions');assert.equal(s.errors,0,'Observer errors');assert.equal(s.dropped,0,'Observer drops');assert.deepEqual([...s.window.loaded].sort(),[...ids].sort());assert.deepEqual([...s.ids].sort(),[...ids].sort());assert.equal(s.window.fullRecords,ids.length);assert.equal(s.window.canonicalDOM,ids.length);assert.ok(s.window.runs<=8);assert.deepEqual(s.dossiers.map(d=>d.id),roots);assert.ok(s.dossiers.every(d=>d.fold==='open'));assert.equal(s.window.originalOperations,0);assert.equal(s.window.replySurfaces,0);};
  await page.waitForTimeout(500);report.beforeSetup=await snapshot();verify(report.beforeSetup,initial);
  for(let n=0;n<12;n++){const s=await snapshot(),d=s.dossiers.find(d=>d.id===roots[4]);if(Math.abs(d.top-64)<2)break;await page.mouse.move(1505,450);await page.mouse.wheel(0,d.top-64);await page.waitForTimeout(150);}
  await page.waitForTimeout(250);report.initial=await snapshot();verify(report.initial,initial);
  assert.ok(Math.abs(report.initial.dossiers[4].top-64)<3,'D4 setup anchor');assert.ok(report.initial.dossiers[9].top>=900,'D9 below viewport');assert.equal(report.initial.visibility,'visible');
  await cdp.send('Profiler.enable');await cdp.send('Profiler.setSamplingInterval',{interval:1000});await cdp.send('Profiler.start');profiler=true;
  await cdp.send('Profiler.startPreciseCoverage',{callCount:true,detailed:true});
  await cdp.send('Tracing.start',{categories:'devtools.timeline,v8.execute,blink.user_timing',transferMode:'ReturnAsStream'});tracing=true;
  const bodyStarted=Date.now();report.bodyStartedMs=bodyStarted;
  const remaining=()=>{const ms=90000-(Date.now()-bodyStarted);assert.ok(ms>0,'90s body deadline');return ms;};
  await page.evaluate(()=>{__body1298.phase='idle';});await page.waitForTimeout(5000);report.idle=await snapshot();verify(report.idle,initial);
  report.idleCoverage=await cdp.send('Profiler.takePreciseCoverage');
  const expected=[...initial];
  for(let ordinal=0;ordinal<12;ordinal++){
    const row={ordinal,startedMs:Date.now()};report.arrivals.push(row);
    await bounded((async()=>{
      await page.evaluate(n=>{__body1298.phase='arrival-'+n;},ordinal);
      row.receipt=await control({method:'arrival',ordinal});expected.push(row.receipt.message_id);
      await page.waitForFunction(id=>__body1298.events.some(e=>e.kind==='messagesPage:entry'&&e.ids?.includes(id)),row.receipt.message_id,{timeout:Math.min(2800,remaining())});
      await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
      row.admission=await page.evaluate(id=>{const q=__body1298,entries=q.events.filter(e=>e.kind==='messagesPage:entry'&&e.ids?.includes(id));return entries.map(e=>({entry:e,returned:q.events.find(r=>r.kind==='messagesPage:return'&&r.call===e.call)}));},row.receipt.message_id);
      assert.ok(row.admission.some(a=>a.returned?.value===true),'No successful document admission');
      row.snapshot=await snapshot();verify(row.snapshot,expected);
      assert.ok(Math.abs(row.snapshot.dossiers[4].top-report.initial.dossiers[4].top)<2,'D4 geometry drift');assert.equal(row.snapshot.y,report.initial.y,'Scroll drift');
      assert.deepEqual(row.snapshot.active,report.initial.active,'Focus drift');assert.deepEqual(row.snapshot.selection,report.initial.selection,'Selection drift');
      const integrity=await page.evaluate(()=>({inputs:__body1298.inputs.filter(e=>e.phase.startsWith('arrival-')),errors:__body1298.errors,dropped:__body1298.dropped}));
      assert.equal(integrity.inputs.length,0,'Input during arrivals');assert.equal(integrity.errors.length,0);assert.equal(integrity.dropped,0);
      row.coverage=await cdp.send('Profiler.takePreciseCoverage');row.endedMs=Date.now();
    })(),Math.min(3000,remaining()),'arrival '+ordinal);
  }
  report.final=await snapshot();verify(report.final,expected);
  await page.evaluate(()=>{__body1298.phase='cover-control';});
  report.coverReceipt=await bounded(control({method:'cover'}),Math.min(3000,remaining()),'cover command');
  await page.waitForFunction(root=>document.querySelector(`.reply-stack[data-dossier="${root}"] > .dossier-cover`)?.textContent.includes('Explicit changed control.'),roots[4],{timeout:Math.min(3000,remaining())});
  await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
  report.coverSnapshot=await snapshot();verify(report.coverSnapshot,expected);report.coverProjection=await control({method:'projection'});
  report.bodyEndedMs=Date.now();assert.ok(report.bodyEndedMs-bodyStarted<=90000);report.status='complete';
} catch(error){report.failure={name:error.name,message:error.message,stack:error.stack,atMs:Date.now()};report.status='incomplete';}
finally {
  if(page){try{report.observations=await page.evaluate(()=>{const q=__body1298;return{events:q.events,requests:q.requests,mutations:q.mutations,inputs:q.inputs,errors:q.errors,dropped:q.dropped,overheadMs:q.overheadMs,last:q.snapshot?.()};});}catch(error){report.observationFailure=String(error);}}
  if(cdp&&profiler){try{report.cpuProfile=(await cdp.send('Profiler.stop')).profile;report.finalCoverage=await cdp.send('Profiler.takePreciseCoverage');await cdp.send('Profiler.stopPreciseCoverage');}catch(error){report.profilerFailure=String(error);}}
  if(cdp&&tracing){try{const done=new Promise(resolve=>cdp.once('Tracing.tracingComplete',resolve));await cdp.send('Tracing.end');const end=await bounded(done,10000,'trace stop');let text='';for(;;){const v=await cdp.send('IO.read',{handle:end.stream});text+=v.data;if(text.length>64*1024*1024)throw Error('trace cap');if(v.eof)break;}await cdp.send('IO.close',{handle:end.stream});await writeFile(`${root}/trace.json`,text);report.traceBytes=Buffer.byteLength(text);}catch(error){report.traceFailure=String(error);}}
  if(browser){try{await browser.close();report.browserClosed=true;}catch(error){report.browserCloseFailure=String(error);}}
  if(browserProfile){try{await access(browserProfile);report.profileAbsent=false;}catch{report.profileAbsent=true;}}
  try{report.fixtureStop=await bounded(control({method:'stop'}),15000,'fixture stop');}catch(error){report.fixtureStopFailure=String(error);fixture.stdin.end();}
  try{report.fixtureExit=await bounded(fixtureExit,15000,'fixture reap');}catch(error){report.fixtureExitFailure=String(error);}
  report.fixtureStderr=fixtureStderr;report.endedMs=Date.now();await save('result.json',report);await save('capture-terminal.json',{status:report.status,startedMs:report.startedMs,endedMs:report.endedMs,browserClosed:report.browserClosed,profileAbsent:report.profileAbsent,fixtureStop:report.fixtureStop,fixtureExit:report.fixtureExit});
}
console.log(JSON.stringify({status:report.status,arrivals:report.arrivals.length,failure:report.failure,result:`${root}/result.json`}));
process.exitCode=report.status==='complete'?0:1;

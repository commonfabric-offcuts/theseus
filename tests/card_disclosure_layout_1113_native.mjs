// Real Chrome paint work on an isolated supplied body. No live account data.
import assert from 'node:assert/strict';
import {spawn,execFileSync} from 'node:child_process';
import {mkdir,mkdtemp,readFile,writeFile,rm,access} from 'node:fs/promises';
import {loadavg,cpus} from 'node:os';
import {resolve,isAbsolute} from 'node:path';
import {createHash} from 'node:crypto';
import net from 'node:net';
import {fixtureControl} from './fixture_control.mjs';
import {parseDeck} from '../web/deck.mjs';

const evidence=resolve(process.argv[2]);assert.ok(isAbsolute(process.argv[2]));
assert.ok(isAbsolute(process.env.AIM_1113_BODY));await mkdir(evidence,{recursive:false});
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const bodyBytes=await readFile(process.env.AIM_1113_BODY),body=bodyBytes.toString('utf8');
assert.equal(bodyBytes.length,148948);assert.equal(sha(bodyBytes),'ef512f546d03078a767929ac69b57fa9e4cec705c834cec711243d641462b45f');
assert.equal(parseDeck(body).cards.length,307);
const names=['web/card-disclosure.mjs','web/deck-page.mjs','web/notebook-page.mjs','web/notebook-passages.mjs','web/deck.mjs','web/aim.css'];
const sources=Object.fromEntries(await Promise.all(names.map(async name=>[name,await readFile(name)])));
const sourceMap=execFileSync('git',['ls-files','-s'],{encoding:'utf8'});await writeFile(`${evidence}/source-map.txt`,sourceMap);
const report={fixture:{bytes:bodyBytes.length,sha256:sha(bodyBytes),cards:307},
  source:Object.fromEntries(Object.entries(sources).map(([name,bytes])=>[name,{bytes:bytes.length,sha256:sha(bytes)}])),
  resource:[],samples:[],typing:[],errors:[],cleanup:{}};
let fixture,channel,browser,profile,origin,held=false,currentPage;
const owned=new Map(),jobs=[],served=new Set();
const processes=()=>execFileSync('/bin/ps',['-axo','pid=,ppid=,lstart=,command='],{encoding:'utf8'}).trim().split('\n').map(line=>{
  const fields=line.trim().split(/\s+/),command=fields.slice(7).join(' ');
  return {pid:+fields[0],ppid:+fields[1],started:fields.slice(2,7).join(' '),command,commandSHA256:sha(command)};
}).filter(row=>row.command!=='/bin/ps -axo pid=,ppid=,lstart=,command=');
const identity=row=>`${row.pid}:${row.started}:${row.commandSHA256}`;
const sampleProcesses=()=>{
  const rows=processes(),descendants=new Set([process.pid]);
  for(let changed=true;changed;){changed=false;for(const row of rows)if(descendants.has(row.ppid)&&!descendants.has(row.pid)){descendants.add(row.pid);changed=true;}}
  for(const row of rows)if(row.pid!==process.pid&&descendants.has(row.pid))owned.set(identity(row),row);
  return rows;
};
const resource=async boundary=>{
  const sample={boundary,utc:new Date().toISOString(),load:loadavg(),cpus:cpus().length};
  report.resource.push(sample);await writeFile(`${evidence}/resource.json`,JSON.stringify(report.resource,null,2));
  return sample.cpus===18&&sample.load[0]<12;
};
const refusal=address=>new Promise(resolve=>{
  const url=new URL(address),socket=net.createConnection({host:url.hostname,port:+url.port});
  socket.once('connect',()=>{socket.destroy();resolve({refused:false});});
  socket.once('error',error=>resolve({refused:error.code==='ECONNREFUSED',code:error.code}));
});
const cleanupStep=async(name,action)=>{try{await action();}catch(error){report.cleanup.errors??=[];report.cleanup.errors.push({name,error:error.stack});}};
try {
  const engines=await import(process.env.AIM_PLAYWRIGHT_CORE);
  if(!await resource('immediately-before-fixture-spawn')){held=true;}
  else {
    fixture=spawn('/usr/bin/python3',['tests/fixtures/ui_http.py','--freshness','--live','--teardown-observations',`${evidence}/fixture-teardown.jsonl`],{env:process.env});
    const stdioClosed=new Promise(resolve=>fixture.once('close',(code,signal)=>resolve({code,signal})));channel={...fixtureControl(fixture),stdioClosed};sampleProcesses();
    const ready=await channel.control({method:'ready'});origin=ready.origin;report.fixture.ready=ready;report.fixture.pid=fixture.pid;sampleProcesses();
    profile=await mkdtemp(`${evidence}/chromium-profile-`);report.cleanup.profile=profile;
    if(!await resource('immediately-before-browser-launch')){held=true;}
    else {
      const persistent=await engines.chromium.launchPersistentContext(profile,{headless:true,executablePath:process.env.AIM_CHROME});
      browser=persistent.browser();report.browserVersion=browser.version();sampleProcesses();
      const item='layout1113-'+process.pid;
      assert.equal((await channel.control({method:'outcome_reference',operation_id:item,item_id:item,topic_id:'t1',title:'Private307-card performance fixture',body})).status,'committed');
      const initial=await channel.control({method:'agent_view',name:'memory_current',args:{item_id:item}});
      const context=await browser.newContext({viewport:{width:1280,height:960},colorScheme:'dark'});
      if(process.env.AIM_1113_READINESS_ONLY==='1')await context.addInitScript(()=>{
        globalThis.__1113LoadEvents=[];globalThis.__1113ObservedTypes=[];
        for(const type of ['paint','longtask'])if(PerformanceObserver.supportedEntryTypes.includes(type)){
          globalThis.__1113ObservedTypes.push(type);
          new PerformanceObserver(list=>{
            for(const entry of list.getEntries())if(globalThis.__1113LoadEvents.length<500)
              globalThis.__1113LoadEvents.push({type:entry.entryType,name:entry.name,startTime:entry.startTime,duration:entry.duration});
          }).observe({type,buffered:true});
        }
      });
      await context.route('**/*',route=>{
        const url=new URL(route.request().url());return url.origin===origin?route.continue():route.abort('blockedbyclient');
      });
      const page=await context.newPage();currentPage=page;page.setDefaultTimeout(10000);page.on('pageerror',error=>report.errors.push(error.stack??error.message));
      report.navigation={console:[],requests:[],failures:[],responses:[]};
      page.on('console',message=>report.navigation.console.push({type:message.type(),text:message.text()}));
      const location=url=>{const parsed=new URL(url);return {origin:parsed.origin,path:parsed.pathname};};
      page.on('request',request=>{
        if(new URL(request.url()).pathname.startsWith('/api/')){
          let data;try{data=request.postDataJSON();}catch{}
          report.navigation.requests.push({at:new Date().toISOString(),...location(request.url()),kind:data?.kind,name:data?.name});
        }
      });
      page.on('requestfailed',request=>report.navigation.failures.push({...location(request.url()),failure:request.failure()}));
      page.on('response',response=>{
        if(new URL(response.url()).pathname.startsWith('/api/'))report.navigation.responses.push({at:new Date().toISOString(),...location(response.url()),status:response.status()});
        const name='web/'+new URL(response.url()).pathname.split('/').at(-1);
        if(sources[name]&&!served.has(name)){served.add(name);jobs.push(response.body().then(async bytes=>{
          assert.deepEqual(bytes,sources[name],'exact loaded source '+name);
          await mkdir(`${evidence}/served/web`,{recursive:true});await writeFile(`${evidence}/served/${name}`,bytes);
        }));}
      });
      const cdp=await context.newCDPSession(page);await cdp.send('Performance.enable');
      const readinessOnly=process.env.AIM_1113_READINESS_ONLY==='1';
      if(readinessOnly){
        //18355: both owners use the same navigation-to-ready boundary. A
        //120-second original timeout is a censored observation, never120s
        //of measured readiness or a passing product assertion.
        const limitMs=120000,start=performance.now(),startedUTC=new Date().toISOString();
        await page.goto(`${origin}/?cards=${item}&view=cards`,{waitUntil:'commit',timeout:limitMs});
        let reached=true;
        try{await page.locator('body[data-ready=true]').waitFor({timeout:Math.max(1,limitMs-(performance.now()-start))});}
        catch(error){if(error.name!=='TimeoutError')throw error;reached=false;}
        const elapsedMs=performance.now()-start;
        report.readiness={startedUTC,limitMs,reached,censored:!reached,
          timeToReadyMs:reached?elapsedMs:null,observedElapsedMs:elapsedMs,
          lowerBoundMs:reached?null:limitMs,boundary:'before navigation request through visible body[data-ready=true]'};
        report.opening=await page.evaluate(()=>({ready:document.body.dataset.ready==='true',
          cards:document.querySelectorAll('#deck-page .deck-card').length,
          status:[...document.querySelectorAll('.deck-status')].map(node=>node.textContent)}));
        report.loadEvents=await page.evaluate(()=>({supported:globalThis.__1113ObservedTypes,events:globalThis.__1113LoadEvents}));
        await writeFile(`${evidence}/readiness.json`,JSON.stringify(report.readiness,null,2));
        await page.screenshot({path:`${evidence}/${reached?'ready':'readiness-censored'}.png`});
        assert.equal(report.opening.cards,307,'the exact307-card fixture is rendered');
        if(reached)assert.equal(report.opening.ready,true);
        if(reached&&process.env.AIM_1113_READINESS_TYPING==='1'){
          if(await resource('before-optional-post-readiness-typing')){
            await page.locator('#deck-page .deck-title').first().click();
            const field=page.locator('#deck-page .deck-editor');await field.waitFor();const text=await field.inputValue();
            await field.evaluate(field=>{globalThis.__1113ReadyInputs=[];field.addEventListener('input',event=>globalThis.__1113ReadyInputs.push({at:performance.now(),trusted:event.isTrusted}));});
            const start=performance.now();await page.keyboard.type('1113');
            report.typing.push({wallMs:performance.now()-start,events:await page.evaluate(()=>globalThis.__1113ReadyInputs)});
            assert.ok((await field.inputValue()).includes('1113'));assert.ok(report.typing[0].events.every(event=>event.trusted));
            await page.keyboard.press('Meta+z');assert.equal(await field.inputValue(),text,'native Undo retains exact writing');
            await page.keyboard.press('Escape');
            const current=await channel.control({method:'agent_view',name:'memory_current',args:{item_id:item}});
            assert.equal(current.body,body,'scratch body retained after typing and Undo');
          }else report.typingSkipped='fresh resource gate held after readiness; no typing launched';
        }
        await Promise.all(jobs);assert.ok(names.every(name=>served.has(name)),'all readiness owners loaded and byte-compared');
        await context.close();
      }else{
      await page.goto(`${origin}/?cards=${item}&view=cards`);await page.locator('body[data-ready=true]').waitFor();
      assert.equal(await page.locator('#deck-page .deck-card').count(),307);
      if(process.env.AIM_1113_OPENING_ONLY==='1'){
        report.opening={ready:true,cards:307};await Promise.all(jobs);await context.close();
      }else{
      await page.evaluate(async()=>{
        const {NotebookPage}=await import('/notebook-page.mjs'),{CardDisclosure}=await import('/card-disclosure.mjs');
        globalThis.__1113={paints:[],deferred:[],inputs:[]};
        const paint=NotebookPage.prototype.paint;
        NotebookPage.prototype.paint=function(...args){
          globalThis.__1113.current=this;const start=performance.now();
          try{return paint.apply(this,args);}finally{globalThis.__1113.paints.push({start,ms:performance.now()-start});}
        };
        if(CardDisclosure.prototype.flush){const flush=CardDisclosure.prototype.flush;
          CardDisclosure.prototype.flush=function(...args){const start=performance.now();
            try{return flush.apply(this,args);}finally{globalThis.__1113.deferred.push({start,ms:performance.now()-start});}};}
        document.addEventListener('input',event=>{
          if(!event.target.matches('.deck-editor'))return;
          globalThis.__1113.inputs.push({trusted:event.isTrusted,at:performance.now()});
        },true);
      });
      // A native edit/close acquires the actual page object without altering app source.
      await page.locator('#deck-page .deck-title').first().click();await page.locator('#deck-page .deck-editor').waitFor();
      await page.keyboard.press('Escape');await page.locator('#deck-page .deck-editor').waitFor({state:'detached'});
      const metrics=async()=>Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map(({name,value})=>[name,value]));
      for(let i=0;i<5;i++){
        const before=await metrics();
        const sample=await page.evaluate(async()=>{
          const state=globalThis.__1113;state.deferred=[];state.paints=[];
          const start=performance.now();state.current.paint();const sync=performance.now()-start;
          await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
          const finalStart=performance.now(),height=state.current.host.getBoundingClientRect().height,finalLayoutMs=performance.now()-finalStart;
          return {syncPaintMs:sync,deferred:state.deferred,finalLayoutMs,height,settledElapsedMs:performance.now()-start,
            hints:[...state.current.keys.children].map(node=>({visibility:getComputedStyle(node).visibility,display:getComputedStyle(node).display})),
            totalHintContainers:state.current.host.querySelectorAll('.deck-keys').length};
        });
        const after=await metrics();sample.layoutCount=after.LayoutCount-before.LayoutCount;
        sample.layoutMs=(after.LayoutDuration-before.LayoutDuration)*1000;
        sample.workMs=sample.syncPaintMs+sample.deferred.reduce((sum,x)=>sum+x.ms,0)+sample.finalLayoutMs;
        // Include the scheduling wait until the final disclosure flush. The
        // three settlement frames establish quiescence; unused tail waits
        // are retained separately rather than charged as rendering work.
        sample.paintToLastMeasurementMs=await page.evaluate(sample=>{
          const paint=globalThis.__1113.paints[0];
          return Math.max(paint.start+paint.ms,...sample.deferred.map(x=>x.start+x.ms))-paint.start+sample.finalLayoutMs;
        },sample);
        report.samples.push(sample);await writeFile(`${evidence}/timing.json`,JSON.stringify(report.samples,null,2));sampleProcesses();
      }
      await page.locator('#deck-page .deck-title').first().click();const field=page.locator('#deck-page .deck-editor');await field.waitFor();
      const beforeText=await field.inputValue();
      await page.evaluate(()=>{globalThis.__1113.paints=[];globalThis.__1113.inputs=[];});
      const typingStart=performance.now();await page.keyboard.type('1113');
      report.typing.push({wallMs:performance.now()-typingStart,...await page.evaluate(()=>({paints:globalThis.__1113.paints,inputs:globalThis.__1113.inputs}))});
      assert.ok((await field.inputValue()).includes('1113'));assert.ok(report.typing[0].inputs.every(event=>event.trusted));
      await page.keyboard.press('Meta+z');assert.equal(await field.inputValue(),beforeText,'native Undo retains editor writing');
      await page.keyboard.press('Escape');
      await page.screenshot({path:`${evidence}/large-page.png`});
      const current=await channel.control({method:'agent_view',name:'memory_current',args:{item_id:item}});
      assert.equal(current.body,body,'scratch body exactly retained after typing Undo');assert.ok(current.source_ref.revision>=initial.source_ref.revision);
      await Promise.all(jobs);assert.ok(names.every(name=>served.has(name)),'all timing owners loaded and byte-compared');
      await context.close();
      if(process.env.AIM_1113_EXPECT!=='baseline'){
        assert.ok(report.samples.every(sample=>sample.deferred.length>0),'actual deferred disclosure measurements occurred');
        assert.ok(report.samples.every(sample=>sample.paintToLastMeasurementMs<50),'one real307-card paint through its last deferred measurement and final layout under50ms');
      }
      }
      }
    }
  }
} catch(error){
  report.fatal=error.stack;
  if(currentPage){
    report.navigationFailure=await currentPage.evaluate(()=>({ready:document.body.dataset.ready,
      title:document.title,status:[...document.querySelectorAll('.deck-status,[role=alert],#status')].map(node=>({id:node.id,class:node.className,text:node.textContent})),
      cardCount:document.querySelectorAll('#deck-page .deck-card').length,
      visiblePage:!document.querySelector('#deck-page')?.hidden})).catch(error=>({error:error.message}));
    await currentPage.screenshot({path:`${evidence}/failure.png`}).catch(()=>{});
  }
}
finally {
  await cleanupStep('loaded source receipts',async()=>{await Promise.all(jobs);});
  if(browser){await cleanupStep('Browser.close',async()=>{sampleProcesses();await browser.close();report.cleanup.browserClose=true;});report.cleanup.disconnected=!browser.isConnected();}
  else report.cleanup.browser='not launched';
  if(fixture){
    fixture.stdin.end();report.cleanup.eofUTC=new Date().toISOString();
    await cleanupStep('fixture exit',async()=>{report.cleanup.fixtureExit=await channel.exit;report.cleanup.stdioClosed=await channel.stdioClosed;report.cleanup.fixtureErrors=channel.errors();});
    await cleanupStep('post-EOF teardown',async()=>{
      const bytes=await readFile(`${evidence}/fixture-teardown.jsonl`);assert.ok(bytes.toString().endsWith('\n'));
      const records=bytes.toString().trimEnd().split('\n').map(line=>JSON.parse(line));report.cleanup.teardown={sha256:sha(bytes),records};
      assert.equal(records.at(-1).event,'cleanup-complete');assert.deepEqual(records.at(-1).errors,[]);
      assert.ok(records.filter(record=>record.event==='cleanup-stage').every(record=>record.status==='ok'));
    });
    if(origin)report.cleanup.tcp=await refusal(origin);
  }
  const live=sampleProcesses();report.cleanup.owned=[...owned.values()];
  report.cleanup.remaining=live.filter(row=>owned.has(identity(row)));
  report.cleanup.profileProcesses=profile?live.filter(row=>row.command.includes(profile)):[];
  if(profile&&!report.cleanup.remaining.length&&!report.cleanup.profileProcesses.length&&(!browser||report.cleanup.disconnected))await rm(profile,{recursive:true});
  report.cleanup.profileAbsent=profile?await access(profile).then(()=>false,()=>true):true;
  report.held=held;report.served=[...served];
  report.sourceUnchanged=(await Promise.all(names.map(async name=>sha(await readFile(name))===sha(sources[name])))).every(Boolean);
  report.limits=process.env.AIM_1113_READINESS_ONLY==='1'
    ? '18355 readiness pair: headless1280x960 desktop Chrome on the same307-card body and standalone shell. Time-to-ready spans before navigation request through visible body[data-ready=true]. A120-second timeout is a right-censored observation with a lower bound, not an exact readiness time or product green. Optional trusted typing is separate. No physical-device or exhaustive process-history claim.'
    : 'Headless1280x960 desktop Chrome. paintToLastMeasurementMs spans synchronous paint through the last deferred disclosure flush, including that scheduling wait, plus final forced-layout cost. workMs retains just active work; settledElapsed includes all three settlement frames. CDP layout totals include all work between samples. Native typing is measured separately. No physical-device or exhaustive process-history claim.';
  await writeFile(`${evidence}/native.json`,JSON.stringify(report,null,2));
}
assert.equal(report.fatal,undefined);assert.deepEqual(report.errors,[]);assert.deepEqual(report.cleanup.errors??[],[]);
assert.deepEqual(report.cleanup.remaining,[]);assert.deepEqual(report.cleanup.profileProcesses,[]);assert.equal(report.cleanup.profileAbsent,true);assert.equal(report.sourceUnchanged,true);
if(fixture){assert.equal(report.cleanup.fixtureExit.code,0);assert.equal(report.cleanup.fixtureExit.signal,null);assert.equal(report.cleanup.stdioClosed.code,0);assert.equal(report.cleanup.fixtureErrors,'');assert.equal(report.cleanup.tcp?.refused,true);}
if(browser){assert.equal(report.cleanup.browserClose,true);assert.equal(report.cleanup.disconnected,true);}
if(held)process.exitCode=75;
else if(process.env.AIM_1113_READINESS_ONLY==='1')assert.ok(report.readiness?.reached||report.readiness?.censored,'completed readiness observation, not product green');
else if(process.env.AIM_1113_OPENING_ONLY==='1')assert.equal(report.opening?.ready,true);
else assert.equal(report.samples.length,5);

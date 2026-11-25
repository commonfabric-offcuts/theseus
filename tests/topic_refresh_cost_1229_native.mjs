// Real scratch Core and owned headless Chrome. No live database or user browser.
import assert from 'node:assert/strict';
import {spawn, execFileSync} from 'node:child_process';
import {mkdir, readFile, writeFile, access} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import net from 'node:net';
import http from 'node:http';
import {fixtureControl} from './fixture_control.mjs';

const {chromium} = await import(process.env.AIM_PLAYWRIGHT_CORE);
const evidence = process.argv[2], count = Number(process.argv[3] ?? 6);
const seedCount=Number(process.argv[4]??0);
assert.ok(evidence && Number.isSafeInteger(count) && count > 0 && count <= 100);
assert.ok(Number.isSafeInteger(seedCount)&&seedCount>=0&&seedCount<=500);
await mkdir(evidence, {recursive: true});
const marker = `theseus-render1229-${process.pid}-${Date.now()}`;
const report = {schema:1, startedMs:Date.now(), count, cases:[], failures:[], networkErrors:[], warnings:[], limits:[
  'One fresh headless Chrome tab, 1400x900; no personal profile or live data.',
  'Sequential committed messages with a 750ms quiet drain; CPU includes this pacing.',
  'Precise coverage enabled: CPU is an instrumented trend, not the original 3.7-message/s sample.',
  'Hover, multi-tab, real GPU, live size, and other regression routes require separate proof.']};
const check = (name, pass, detail) => { if (!pass) report.failures.push({name, detail}); };
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
report.head = execFileSync('git', ['rev-parse', 'HEAD'], {encoding:'utf8'}).trim();
report.sources = {};
for (const path of ['web/app.mjs','web/freshness.mjs','web/outline-rail.mjs','web/outcome-refresh.mjs',
  'web/dimming-sync.mjs','web/attention.mjs','web/health-light.mjs','web/api.mjs','web/cleanup.mjs',
  'aim_next/changes.py','aim_next/delivery.py','tests/fixtures/ui_http.py']) {
  report.sources[path] = hash(await readFile(path));
}
report.harnessHash = hash(await readFile(new URL(import.meta.url)));
const fixture = spawn('/usr/bin/python3', ['tests/fixtures/ui_http.py','--freshness','--live']);
const {control, exit, errors} = fixtureControl(fixture);
let browser, page, facts, profile, browserCDP;
const metrics = async cdp => Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map(m => [m.name,m.value]));
const processes = async () => (await browserCDP.send('SystemInfo.getProcessInfo')).processInfo;
const processCPU = (before, after) => after.map(row => ({id:row.id,type:row.type,
  seconds:row.cpuTime-(before.find(old => old.id===row.id)?.cpuTime ?? row.cpuTime)}));
const canonical = value => value && typeof value==='object' ? Array.isArray(value) ? value.map(canonical)
  : Object.fromEntries(Object.keys(value).sort().map(key => [key,canonical(value[key])])) : value;
const readSummary = reads => {
  const byName={},multiplicity={};
  for(const read of reads){byName[read.name]=(byName[read.name]??0)+1;
    const key=read.name+':'+JSON.stringify(canonical(read.args));multiplicity[key]=(multiplicity[key]??0)+1;}
  return {reads,byName,multiplicity};
};
const cleanReads = reads => reads.every(read=>read.status>=200&&read.status<300&&!read.failure&&!read.bodyFailure&&read.bodyEnded!==undefined);
const readKey = row => row.name+':'+JSON.stringify(canonical(row.args));
const classifyReads = reads => reads.map(row=>{
  const owner=row.owner;
  const superseded=Boolean(row.signalAborted&&(row.failureName==='AbortError'||row.bodyFailureName==='AbortError')&&
    owner?.kind==='background'&&owner.partitioned&&owner.endEpoch>owner.epoch&&owner.errorCode==='CLEANUP_DEFERRED');
  const recovered=superseded&&reads.find(later=>later.start>row.end&&readKey(later)===readKey(row)&&cleanReads([later]));
  return {read:row,kind:cleanReads([row])?'complete':recovered?'owned-foreground-supersession-recovered':'unresolved',
    ...(recovered?{recoveryStart:recovered.start}: {})};
});
try {
  facts = await control({method:'ready',runtime_evidence:true});
  report.runtime = facts.runtime_evidence;
  const created = await control({method:'navigation_topics',topics:[
    {id:'cost1229-open',title:'Render cost open',workspace_id:'w1'},
    {id:'cost1229-other',title:'Render cost elsewhere',workspace_id:'w1'}]});
  const roots = created.map(receipt => { assert.equal(receipt.status,'committed'); return receipt.result.message_id; });
  // Establish participation before the measurement boundary. Later traffic is
  // one real message.post command each, with no draft/prepare/join commits.
  await control({method:'agent_message',operation_id:'cost1229-join',join:true,
    topic_id:'cost1229-other',whole_topic:true,body:'Warm-up fixture reply',
    post_args:{reply_to:roots[1],reply_without_quote:'Synthetic render-cost setup.'}});
  await control({method:'agent_message',operation_id:'cost1229-open-join',join:true,
    topic_id:'cost1229-open',whole_topic:true,body:'Open-topic warm-up fixture reply',
    post_args:{reply_to:roots[0],reply_without_quote:'Synthetic render-cost setup.'}});
  report.seed={dossiers:seedCount,bodyCharacters:0};
  for(let number=0;number<seedCount;number++){
    const body=`Render cost seed dossier ${number}\n\n`+'Retained fixture writing and its wrapping across the open feed. '.repeat(40);
    const receipt=await control({method:'agent_message',operation_id:`cost1229-seed-${number}`,sender:'person',
      topic_id:'cost1229-open',whole_topic:true,body,post_args:{divergence_reason:'Independent render-cost seed dossier.'}});
    assert.equal(receipt.status,'committed');report.seed.bodyCharacters+=body.length;
  }
  browser = await chromium.launch({headless:true,executablePath:process.env.AIM_CHROME,args:[`--${marker}`]});
  report.browser = {engine:browser.browserType().name(),version:browser.version()};
  assert.equal(report.browser.engine,'chromium');
  browserCDP = await browser.newBrowserCDPSession();
  profile = (await browserCDP.send('Browser.getBrowserCommandLine')).arguments.find(arg => arg.startsWith('--user-data-dir='))?.slice(16);
  assert.ok(profile);
  await writeFile(evidence+'/ownership.json',JSON.stringify({marker,profile,fixturePid:fixture.pid,origin:facts.origin},null,2));
  const context = await browser.newContext({viewport:{width:1400,height:900},colorScheme:'dark'});
  await context.addInitScript(() => {
    const probe = window.render1229 = {reads:[],pending:0,last:performance.now(),seq:null,feedMutations:0,signalOwners:new WeakMap(),owners:[]};
    const original = window.fetch;
    window.fetch = async function(input, init) {
      const path = new URL(typeof input==='string' ? input : input.url,location.href).pathname;
      let row;
      if (path==='/api/view') {
        const request = JSON.parse(init?.body ?? '{}');
        row = {name:request.name,args:request.args,start:performance.now(),commitSeen:probe.seq};
        row.readClass=new Headers(init?.headers).get('X-AIM-Read-Class');
        row.owner=init?.signal?probe.signalOwners.get(init.signal):undefined;
        row.publish=probe.publishing;
        row.signalAborted=init?.signal?.aborted===true;
        init?.signal?.addEventListener('abort',()=>{row.signalAborted=true;row.abortAt=performance.now();},{once:true});
        probe.reads.push(row); probe.pending++; probe.last=performance.now();
      }
      let finished=false;
      const finish=()=>{if(row&&!finished){finished=true;row.end=performance.now();probe.pending--;probe.last=performance.now();}};
      try {
        const response=await original.apply(this,arguments);
        if(row){
          row.status=response.status;row.headers=performance.now();
          for(const name of ['json','text','arrayBuffer','blob','formData']){
            const consume=response[name].bind(response);
            response[name]=async(...args)=>{
              row.bodyStarted=performance.now();row.bodyReader=name;
              try{return await consume(...args);}
              catch(error){row.bodyFailure=String(error);row.bodyFailureName=error?.name;throw error;}
              finally{row.bodyEnded=performance.now();finish();}
            };
          }
        }
        return response;
      }catch(error){if(row){row.failure=String(error);row.failureName=error?.name;}finish();throw error;}
    };
    const Socket = window.WebSocket;
    window.WebSocket = class extends Socket {
      constructor(...args) { super(...args); this.addEventListener('message',event => {
        try { const value=JSON.parse(event.data);if(Number.isSafeInteger(value.seq)){probe.seq=value.seq;probe.last=performance.now();} }catch{}
      }); }
    };
  });
  // A real HTTP200/partial JSON boundary proves the counter cannot declare
  // drain at headers. This page has no application, data or extra authority.
  let releaseBody,probePage;
  const bodyServer=http.createServer((request,response)=>{
    if(request.url!=='/api/view'){response.end('<!doctype html><title>Owned body boundary</title>');return;}
    response.writeHead(200,{'Content-Type':'application/json'});response.write('{"probe":');
    releaseBody=()=>response.end('true}');
  });
  await new Promise(resolve=>bodyServer.listen(0,'127.0.0.1',resolve));
  try{
    probePage=await context.newPage();await probePage.goto(`http://127.0.0.1:${bodyServer.address().port}/`);
    await probePage.evaluate(()=>{window.bodyProbePromise=fetch('/api/view',{method:'POST',body:JSON.stringify({name:'owned_body_probe',args:{}})})
      .then(response=>{render1229.clientHeaders=response.status===200;return response.json();});});
    await probePage.waitForFunction(()=>render1229.clientHeaders&&render1229.reads[0]?.bodyStarted!==undefined);
    await probePage.waitForTimeout(900);
    report.delayedBody={held:await probePage.evaluate(()=>({pending:render1229.pending,read:render1229.reads[0],wouldDrain:render1229.pending===0&&performance.now()-render1229.last>=750}))};
    check('body pending beyond quiet window',report.delayedBody.held.pending===1&&!report.delayedBody.held.wouldDrain,report.delayedBody.held);
    releaseBody();await probePage.evaluate(()=>window.bodyProbePromise);
    report.delayedBody.released=await probePage.evaluate(()=>({pending:render1229.pending,read:render1229.reads[0]}));
    check('body settlement observed',report.delayedBody.released.pending===0&&report.delayedBody.released.read.bodyEnded!==undefined,report.delayedBody.released);
  }finally{releaseBody?.();await probePage?.close();await new Promise(resolve=>bodyServer.close(resolve));}
  page = await context.newPage();
  const responseJobs=[];
  page.on('response',response=>{
    if(new URL(response.url()).pathname!=='/api/view')return;
    const request=response.request().postDataJSON();
    responseJobs.push(response.json().then(answer=>{if(answer.error)report.networkErrors.push({time:Date.now(),name:request.name,args:request.args,status:response.status(),error:answer.error});},error=>report.networkErrors.push({time:Date.now(),name:request.name,args:request.args,status:response.status(),bodyFailure:String(error)})));
  });
  page.on('pageerror',error => report.failures.push({name:'pageerror',detail:error.stack}));
  await page.goto(facts.origin+'/?topic=cost1229-open');
  await page.waitForFunction(() => document.body.dataset.ready==='true');
  const hasPageRefresh=await access('web/page-refresh.mjs').then(()=>true,()=>false);
  await page.evaluate(async hasPageRefresh=>{
    const p=render1229,{RecoveryCleanup}=await import('/cleanup.mjs'),{Freshness}=await import('/freshness.mjs');
    const cleanups=new Set(),controllers=new Set();let serial=0;
    const originalRead=RecoveryCleanup.prototype.read;
    RecoveryCleanup.prototype.read=function(operation,...args){
      cleanups.add(this);
      const owner={id:++serial,kind:'background',epoch:this.readEpoch,partitioned:this.partitioned,start:performance.now()};
      p.owners.push(owner);
      return originalRead.call(this,options=>{if(options.signal)p.signalOwners.set(options.signal,owner);return operation(options);},...args)
        .then(value=>{owner.result='resolved';return value;},error=>{owner.errorCode=error?.code;owner.result='rejected';throw error;})
        .finally(()=>{owner.end=performance.now();owner.endEpoch=this.readEpoch;p.last=performance.now();});
    };
    const originalForeground=RecoveryCleanup.prototype.foreground;
    RecoveryCleanup.prototype.foreground=function(...args){
      cleanups.add(this);const epoch=this.readEpoch,lease=originalForeground.apply(this,args),read=lease.read;
      const owner={id:++serial,kind:'foreground',epoch,beganEpoch:this.readEpoch,start:performance.now()};p.owners.push(owner);
      lease.read=operation=>read.call(lease,options=>{if(options.signal)p.signalOwners.set(options.signal,owner);return operation(options);});
      const release=lease.release;lease.release=()=>{owner.end=performance.now();owner.endEpoch=this.readEpoch;return release.call(lease);};
      return lease;
    };
    const observe=(Class,kind)=>{
      const request=Class.prototype.request;
      Class.prototype.request=function(...args){controllers.add(this);this.probeKind=kind;
        if(kind==='page-refresh'&&!this.probePublish){
          this.probePublish=true;const publish=this.publish;
          this.publish=async(batch,full)=>{
            const publication={id:++serial,full,start:performance.now(),frontiers:batch.windows.map(w=>({scope:w.scope,checkpoint:w.checkpoint,continuation:w.continuation}))};
            p.publishing=publication;
            try{return await publish.call(this,batch,full);}finally{publication.end=performance.now();if(p.publishing===publication)p.publishing=null;}
          };
        }
        return request.apply(this,args);
      };
    };
    observe(Freshness,'freshness');
    if(hasPageRefresh)observe((await import('/page-refresh.mjs')).PageRefresh,'page-refresh');
    p.state=()=>({cleanups:[...cleanups].map(c=>({epoch:c.readEpoch,foreground:c.foregroundCount,active:Boolean(c.activeRead)})),
      controllers:[...controllers].filter(c=>!c.disposed).map(c=>({kind:c.probeKind,stopped:c.stopped,running:Boolean(c.running),
        pending:Boolean(c.pending||c.requested||c.force||c.dirty?.size||c.continuation),timer:c.timer!==null}))});
    p.settled=()=>{const s=p.state();return s.cleanups.every(c=>!c.active&&!c.foreground)&&s.controllers.every(c=>!c.stopped&&!c.running&&!c.pending&&!c.timer);};
  },hasPageRefresh);
  const settle = async () => {
    for(let attempt=0;attempt<10;attempt++){
      await page.waitForFunction(() => { const p=window.render1229;return p.seq!==null && p.pending===0 && p.settled() && performance.now()-p.last>=750; },null,{timeout:20000});
      const observed=responseJobs.length;
      await Promise.allSettled(responseJobs);
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      if(observed===responseJobs.length&&await page.evaluate(()=>render1229.pending===0&&render1229.settled()&&performance.now()-render1229.last>=750))return;
    }
    throw new Error('response jobs did not settle within the bounded drain');
  };
  await settle();
  report.loadedFeed=await page.evaluate(()=>({cards:document.querySelectorAll('#messages .message-card').length,
    characters:document.querySelector('#messages').textContent.length,nodes:document.querySelector('#messages').querySelectorAll('*').length}));
  await page.evaluate(() => {
    const p=window.render1229;
    p.rows=new Map([...document.querySelectorAll('#outline a[data-topic-id]')].map(row=>[row.dataset.topicId,row]));
    p.feed=new MutationObserver(records => {p.feedMutations+=records.length;});
    p.feed.observe(document.querySelector('#messages'),{subtree:true,childList:true,characterData:true,attributes:true});
    p.rowMutations=[];p.warnings=[];
    p.rail=new MutationObserver(records=>{for(const record of records){
      const element=record.target.nodeType===Node.ELEMENT_NODE?record.target:record.target.parentElement;
      const row=element?.closest('a[data-topic-id]');if(row)p.rowMutations.push({id:row.dataset.topicId,type:record.type,attribute:record.attributeName});
    }});
    p.rail.observe(document.querySelector('#outline'),{subtree:true,childList:true,characterData:true,attributes:true});
    p.warningObserver=new MutationObserver(records=>{for(const record of records){
      const element=record.target.nodeType===Node.ELEMENT_NODE?record.target:record.target.parentElement;
      const notice=element?.closest('.notice');
      if(notice&&!notice.hidden&&notice.textContent.trim())p.warnings.push({time:performance.now(),text:notice.textContent});
    }p.last=performance.now();});
    p.warningObserver.observe(document.documentElement,{subtree:true,childList:true,characterData:true,attributes:true,attributeFilter:['hidden']});
  });
  const cdp = await context.newCDPSession(page);
  await cdp.send('Performance.enable'); await cdp.send('Profiler.enable');
  await cdp.send('Profiler.startPreciseCoverage',{callCount:true,detailed:false});
  const coverage = async () => {
    const answer = await cdp.send('Profiler.takePreciseCoverage');
    const calls = answer.result.filter(script=>/\/app\.mjs(?:\?|$)/.test(script.url))
      .flatMap(script=>script.functions).filter(fn=>fn.functionName==='captureListAnchor')
      .reduce((total,fn)=>total+fn.ranges[0].count,0);
    return {captureListAnchor:calls,timestamp:answer.timestamp};
  };
  await coverage();
  report.warmupEnd = await page.evaluate(() => ({time:performance.now(),seq:render1229.seq,reads:render1229.reads.length}));
  const restReadStart=report.warmupEnd.reads;
  const restCPU=await processes(),restMetrics=await metrics(cdp),restStart=Date.now();
  await new Promise(resolve=>setTimeout(resolve,3000));
  await settle();
  report.rest={wallMs:Date.now()-restStart,processCPU:processCPU(restCPU,await processes()),
    before:restMetrics,after:await metrics(cdp),...readSummary(await page.evaluate(from=>render1229.reads.slice(from),restReadStart))};
  check('idle rest does not reread views',report.rest.reads.length===0,report.rest);
  await coverage();
  for (const addressed of [false,true]) {
    const phase = {name:addressed?'addressed-elsewhere':'unaddressed-elsewhere',posts:[],reads:[],samples:[]};
    const beforeMetrics=await metrics(cdp),beforeCPU=await processes(),started=Date.now();
    for(let number=0;number<count;number++) {
      const boundary=await page.evaluate(()=>({reads:render1229.reads.length,seq:render1229.seq,mutations:render1229.feedMutations,rowMutations:render1229.rowMutations.length}));
      const operation=`cost1229-${addressed?'to':'plain'}-${number}`;
      const receipt=await control({method:'agent_message',operation_id:operation,topic_id:'cost1229-other',
        whole_topic:true,body:`Render probe ${operation}`,post_args:{reply_to:roots[1],
          reply_without_quote:'Identified scratch render-cost measurement.',
          ...(addressed?{addressees:[facts.actor],intent:'tell'}:{})}});
      assert.equal(receipt.status,'committed');
      phase.posts.push({operation,receipt});
      await page.waitForFunction(seq=>render1229.seq>seq,boundary.seq,{timeout:20000});
      await settle();
      const truth=await control({method:'agent_view',actor:facts.actor,name:'workspace_topics',args:{workspace_id:'w1',limit:100}});
      assert.ok(!truth.error,JSON.stringify(truth));
      const item=truth.items.find(item=>item.id==='cost1229-other');assert.ok(item);
      const observed=await page.evaluate(({from,topic})=>{
        const row=document.querySelector(`#outline a[data-topic-id="${topic}"]`);
        return {reads:render1229.reads.slice(from),badge:row?.querySelector('.unread-count')?.textContent??null,
          rowPresent:Boolean(row),seq:render1229.seq,feedMutations:render1229.feedMutations,
          replaced:[...render1229.rows].filter(([id,old])=>id!==topic&&document.querySelector(`#outline a[data-topic-id="${id}"]`)!==old).map(([id])=>id)};
      },{from:boundary.reads,topic:item.id});
      observed.unchangedRowMutations=await page.evaluate(({from,topic})=>render1229.rowMutations.slice(from).filter(row=>row.id!==topic),{from:boundary.rowMutations,topic:item.id});
      const functions=await coverage();
      const multiplicity={};
      for(const read of observed.reads){const key=read.name+':'+JSON.stringify(canonical(read.args));multiplicity[key]=(multiplicity[key]??0)+1;}
      const sample={operation,truth:{id:item.id,unread:item.unread,addressed:item.addressed},observed,functions,multiplicity};
      phase.samples.push(sample);phase.reads.push(...observed.reads);
      check(operation+' positive rail count',observed.rowPresent&&observed.badge===String(item.unread),sample.truth);
      check(operation+' no duplicate view/args',Object.values(multiplicity).every(n=>n<=1),multiplicity);
      check(operation+' <=3 total views',observed.reads.length<=3,observed.reads.length);
      check(operation+' no feed anchor scan',functions.captureListAnchor===0,functions);
      check(operation+' no feed DOM mutation',observed.feedMutations===boundary.mutations,{before:boundary.mutations,after:observed.feedMutations});
      check(operation+' unchanged rows retained',observed.replaced.length===0,observed.replaced);
      check(operation+' unchanged rows untouched',observed.unchangedRowMutations.length===0,observed.unchangedRowMutations);
      const forbidden=new Set(['topic','topic_unread','marks','wakes','topic_tools','memory_items','pipeline','pipeline_row','health_light','workspace_links','conversation']);
      check(operation+' unrelated resources unread',observed.reads.every(read=>!forbidden.has(read.name)),observed.reads.map(read=>read.name));
      check(operation+' successful complete reads',cleanReads(observed.reads),observed.reads);
      if(!addressed)check(operation+' no unrelated attention read',observed.reads.every(read=>read.name!=='attention'),observed.reads.map(read=>read.name));
      if(addressed){
        const attention=await control({method:'agent_view',actor:facts.actor,name:'attention',args:{}});
        sample.attentionTruth=attention;
        sample.tabTitle=await page.title();
        check(operation+' positive attention item',attention.latest_addressed?.some(item=>item.message?.id===receipt.result.message_id),receipt.result);
        check(operation+' positive attention total',sample.tabTitle.startsWith(`(${attention.unread}) `),{unread:attention.unread,title:sample.tabTitle});
        check(operation+' attention refreshed',observed.reads.some(read=>read.name==='attention'),observed.reads.map(read=>read.name));
      }
    }
    const afterMetrics=await metrics(cdp),afterCPU=await processes();
    phase.wallMs=Date.now()-started;phase.processCPU=processCPU(beforeCPU,afterCPU);
    phase.metrics=Object.fromEntries(['TaskDuration','ScriptDuration','LayoutDuration','RecalcStyleDuration','LayoutCount','RecalcStyleCount'].map(key=>[key,afterMetrics[key]-beforeMetrics[key]]));
    phase.perMessage={reads:phase.reads.length/count,layouts:phase.metrics.LayoutCount/count,styles:phase.metrics.RecalcStyleCount/count,
      cpuPercent:100*phase.processCPU.reduce((total,p)=>total+p.seconds,0)/(phase.wallMs/1000)};
    phase.byName={};for(const read of phase.reads)phase.byName[read.name]=(phase.byName[read.name]??0)+1;
    report.cases.push(phase);await writeFile(evidence+'/progress.json',JSON.stringify(report,null,2));
  }
  const openCPU=await processes(),openMetrics=await metrics(cdp),openStart=Date.now();
  const openPhase={name:'open-topic-positive',posts:[],samples:[]};
  const openReadStart=await page.evaluate(()=>render1229.reads.length);
  for(let number=0;number<count;number++){
    const boundary=await page.evaluate(()=>({reads:render1229.reads.length,seq:render1229.seq}));
    const body=`Render open-topic probe ${number}`,operation=`cost1229-open-${number}`;
    const receipt=await control({method:'agent_message',operation_id:operation,topic_id:'cost1229-open',whole_topic:true,
      body,post_args:{reply_to:roots[0],reply_without_quote:'Identified scratch open-topic measurement.'}});
    assert.equal(receipt.status,'committed');openPhase.posts.push({operation,receipt});
    await page.waitForFunction(body=>document.querySelector('#messages')?.textContent.includes(body),body,{timeout:20000});
    await settle();
    const sample={operation,before:boundary,after:await page.evaluate(()=>({time:performance.now(),seq:render1229.seq})),
      ...readSummary(await page.evaluate(from=>render1229.reads.slice(from),boundary.reads))};
    openPhase.samples.push(sample);
    sample.classified=classifyReads(sample.reads);
    check(operation+' complete or owned-recovered reads',sample.classified.every(row=>row.kind!=='unresolved'),sample.classified);
    // A post window can include read-through's later commit. Preserve total
    // cost, and group duplicates by the actual live sequence and publication.
    sample.byChange={};for(const row of sample.reads){const key=JSON.stringify([row.commitSeen,row.publish?.id??null,readKey(row)]);sample.byChange[key]=(sample.byChange[key]??0)+1;}
    check(operation+' no duplicate within observed change/publication',Object.values(sample.byChange).every(n=>n<=1),sample.byChange);
  }
  const openAfter=await metrics(cdp);
  openPhase.wallMs=Date.now()-openStart;openPhase.processCPU=processCPU(openCPU,await processes());
  openPhase.metrics=Object.fromEntries(['TaskDuration','ScriptDuration','LayoutDuration','RecalcStyleDuration','LayoutCount','RecalcStyleCount'].map(key=>[key,openAfter[key]-openMetrics[key]]));
  openPhase.functions=await coverage();report.openTopic=openPhase;
  Object.assign(openPhase,readSummary(await page.evaluate(from=>render1229.reads.slice(from),openReadStart)));
  openPhase.perMessage={reads:openPhase.reads.length/count,layouts:openPhase.metrics.LayoutCount/count,styles:openPhase.metrics.RecalcStyleCount/count};
  check('open topic still reaches feed',openPhase.posts.length===count&&openPhase.functions.captureListAnchor>0,openPhase.functions);
  report.sends=[];
  for(const surface of ['inline-reply','bottom-composer']){
    const phase={name:surface,sends:[]};
    for(let number=0;number<count;number++){
      const body=`Native ${surface} probe ${number}`;
      let field,send;
      if(surface==='inline-reply'){
        const card=page.locator('#messages .message-card:visible').last();
        const parent=await card.getAttribute('data-id');
        await card.hover();await page.locator('.message-bar [data-act=reply]').click();
        field=page.locator(`[id="reply-${parent}-writing-body"]`);
        send=page.locator(`[id="reply-${parent}-send"]`);
      }else{
        field=page.locator('#inline-writing-body');await field.click();
        const kind=page.locator('#inline-kind-message');if(await kind.isVisible())await kind.click();
        send=page.locator('#inline-send');
      }
      await field.fill(body);
      await page.waitForFunction(id=>document.getElementById(id)?.closest('.composer')?.querySelector('[data-save]')?.dataset.save==='saved',await field.getAttribute('id'),{timeout:20000});
      await settle();await coverage();
      const boundary=await page.evaluate(()=>render1229.reads.length),warningStart=await page.evaluate(()=>render1229.warnings.length);
      const before=await metrics(cdp),cpu=await processes(),started=Date.now(),errorStart=report.networkErrors.length;
      const response=page.waitForResponse(response=>{try{return response.request().postDataJSON()?.kind==='message.send';}catch{return false;}},{timeout:20000});
      await send.click();const receipt=await(await response).json();assert.equal(receipt.status,'committed');
      await page.locator(`#messages .message-card[data-id="${receipt.result.message_id}"]`).waitFor({state:'attached',timeout:20000});
      await settle();
      const source=await control({method:'agent_view',actor:facts.actor,name:'source',args:{source_ref:{kind:'message',id:receipt.result.message_id}}});
      check(surface+' committed writing preserved',source.body?.includes(body),source.body);
      const after=await metrics(cdp),processCPUResult=processCPU(cpu,await processes());
      const sample={number,receipt,wallMs:Date.now()-started,processCPU:processCPUResult,
        functions:await coverage(),metrics:Object.fromEntries(['TaskDuration','ScriptDuration','LayoutDuration','RecalcStyleDuration','LayoutCount','RecalcStyleCount'].map(key=>[key,after[key]-before[key]])),
        reads:await page.evaluate(from=>render1229.reads.slice(from),boundary),warnings:await page.evaluate(from=>render1229.warnings.slice(from),warningStart),networkErrors:report.networkErrors.slice(errorStart)};
      phase.sends.push(sample);
      sample.classified=classifyReads(sample.reads);
      check(surface+' complete or owned-recovered reads',sample.classified.every(row=>row.kind!=='unresolved'),sample.classified);
      check(surface+' no unexpected response errors',sample.networkErrors.length===0,sample.networkErrors);
      check(surface+' no warning flicker',sample.warnings.length===0,sample.warnings);
      await writeFile(evidence+'/progress.json',JSON.stringify({...report,activeSend:phase},null,2));
    }
    report.sends.push(phase);
  }
  await settle();
  report.warnings=await page.evaluate(()=>render1229.warnings);
  report.ownership=await page.evaluate(()=>({owners:render1229.owners,state:render1229.state()}));
  check('clean traffic has no unexpected body or structured response errors',report.networkErrors.length===0,report.networkErrors);
  check('clean traffic has no warning flicker',report.warnings.length===0,report.warnings);
} catch(error) { report.failures.push({name:'harness or setup barrier',detail:error.stack});
  if(page&&!page.isClosed())await page.screenshot({path:evidence+'/failure.png',fullPage:true}).catch(()=>{}); }
finally {
  if(browser){
    const rows=execFileSync('ps',['-axo','pid=,ppid=,command='],{encoding:'utf8'}).split('\n').map(line=>{const m=/^\s*(\d+)\s+(\d+)\s+(.*)$/.exec(line);return m&&{pid:+m[1],parent:+m[2],command:m[3]};}).filter(Boolean);
    const owned=new Set(rows.filter(r=>r.command.includes(marker)||profile&&r.command.includes(profile)).map(r=>r.pid));
    for(let n=0;n<rows.length;n++)for(const row of rows)if(owned.has(row.parent))owned.add(row.pid);
    await browser.close();
    const live=new Set(execFileSync('ps',['-axo','pid='],{encoding:'utf8'}).trim().split(/\s+/).map(Number));
    const remaining=[...owned].filter(pid=>live.has(pid));
    const profileAbsent=profile?await access(profile).then(()=>false,error=>{if(error.code==='ENOENT')return true;throw error;}):null;
    report.browserCleanup={closed:!browser.isConnected(),owned:[...owned],remaining,profile,profileAbsent};
    check('browser cleanup',remaining.length===0&&profileAbsent===true,report.browserCleanup);
  }
  fixture.stdin.end();const ended=await exit;
  let absent=false;try{process.kill(fixture.pid,0);}catch(error){absent=error.code==='ESRCH';}
  const portClosed=!facts||await new Promise(resolve=>{const socket=net.connect(new URL(facts.origin).port,'127.0.0.1');socket.on('connect',()=>{socket.destroy();resolve(false);});socket.on('error',()=>resolve(true));socket.setTimeout(1000,()=>{socket.destroy();resolve(false);});});
  report.fixtureCleanup={ended,absent,portClosed,stderr:errors()};
  check('fixture cleanup',ended.code===0&&ended.signal===null&&absent&&portClosed,report.fixtureCleanup);
  report.endedMs=Date.now();report.accepted=report.failures.length===0;
  await writeFile(evidence+'/results.json',JSON.stringify(report,null,2));
  console.log(JSON.stringify({head:report.head,accepted:report.accepted,cases:report.cases.map(c=>({name:c.name,...c.perMessage,byName:c.byName})),failures:report.failures.length}));
  process.exitCode=report.accepted?0:1;
}

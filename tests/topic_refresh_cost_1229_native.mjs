// Real scratch Core and owned headless Chrome. No live database or user browser.
import assert from 'node:assert/strict';
import {spawn, execFileSync} from 'node:child_process';
import {mkdir, readFile, writeFile, access} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import net from 'node:net';
import {fixtureControl} from './fixture_control.mjs';

const {chromium} = await import(process.env.AIM_PLAYWRIGHT_CORE);
const evidence = process.argv[2], count = Number(process.argv[3] ?? 6);
assert.ok(evidence && Number.isSafeInteger(count) && count > 0 && count <= 100);
await mkdir(evidence, {recursive: true});
const marker = `theseus-render1229-${process.pid}-${Date.now()}`;
const report = {schema:1, startedMs:Date.now(), count, cases:[], failures:[], limits:[
  'One fresh headless Chrome tab, 1400x900; no personal profile or live data.',
  'Sequential committed messages with a 750ms quiet drain; CPU includes this pacing.',
  'Precise coverage enabled: CPU is an instrumented trend, not the original 3.7-message/s sample.',
  'Hover, multi-tab, real GPU, live size, and other regression routes require separate proof.']};
const check = (name, pass, detail) => { if (!pass) report.failures.push({name, detail}); };
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
report.head = execFileSync('git', ['rev-parse', 'HEAD'], {encoding:'utf8'}).trim();
report.sources = {};
for (const path of ['web/app.mjs','web/freshness.mjs','web/outline-rail.mjs','web/outcome-refresh.mjs',
  'web/dimming-sync.mjs','web/attention.mjs','web/health-light.mjs','tests/fixtures/ui_http.py']) {
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
  browser = await chromium.launch({headless:true,executablePath:process.env.AIM_CHROME,args:[`--${marker}`]});
  report.browser = {engine:browser.browserType().name(),version:browser.version()};
  assert.equal(report.browser.engine,'chromium');
  browserCDP = await browser.newBrowserCDPSession();
  profile = (await browserCDP.send('Browser.getBrowserCommandLine')).arguments.find(arg => arg.startsWith('--user-data-dir='))?.slice(16);
  assert.ok(profile);
  await writeFile(evidence+'/ownership.json',JSON.stringify({marker,profile,fixturePid:fixture.pid,origin:facts.origin},null,2));
  const context = await browser.newContext({viewport:{width:1400,height:900},colorScheme:'dark'});
  await context.addInitScript(() => {
    const probe = window.render1229 = {reads:[],pending:0,last:performance.now(),seq:null,feedMutations:0};
    const original = window.fetch;
    window.fetch = async function(input, init) {
      const path = new URL(typeof input==='string' ? input : input.url,location.href).pathname;
      let row;
      if (path==='/api/view') {
        const request = JSON.parse(init?.body ?? '{}');
        row = {name:request.name,args:request.args,start:performance.now(),commitSeen:probe.seq};
        probe.reads.push(row); probe.pending++; probe.last=performance.now();
      }
      try { const response=await original.apply(this,arguments); if(row)row.status=response.status; return response; }
      catch(error) { if(row)row.failure=String(error); throw error; }
      finally { if(row){row.end=performance.now();probe.pending--;probe.last=performance.now();} }
    };
    const Socket = window.WebSocket;
    window.WebSocket = class extends Socket {
      constructor(...args) { super(...args); this.addEventListener('message',event => {
        try { const value=JSON.parse(event.data);if(Number.isSafeInteger(value.seq)){probe.seq=value.seq;probe.last=performance.now();} }catch{}
      }); }
    };
  });
  page = await context.newPage();
  page.on('pageerror',error => report.failures.push({name:'pageerror',detail:error.stack}));
  await page.goto(facts.origin+'/?topic=cost1229-open');
  await page.waitForFunction(() => document.body.dataset.ready==='true');
  const settle = async () => {
    await page.waitForFunction(() => { const p=window.render1229;return p.seq!==null && p.pending===0 && performance.now()-p.last>=750; },null,{timeout:20000});
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  };
  await settle();
  await page.evaluate(() => {
    const p=window.render1229;
    p.rows=new Map([...document.querySelectorAll('#outline a[data-topic-id]')].map(row=>[row.dataset.topicId,row]));
    p.feed=new MutationObserver(records => {p.feedMutations+=records.length;});
    p.feed.observe(document.querySelector('#messages'),{subtree:true,childList:true,characterData:true,attributes:true});
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
  const restCPU=await processes(),restMetrics=await metrics(cdp),restStart=Date.now();
  await new Promise(resolve=>setTimeout(resolve,3000));
  report.rest={wallMs:Date.now()-restStart,processCPU:processCPU(restCPU,await processes()),
    before:restMetrics,after:await metrics(cdp)};
  await coverage();
  for (const addressed of [false,true]) {
    const phase = {name:addressed?'addressed-elsewhere':'unaddressed-elsewhere',posts:[],reads:[],samples:[]};
    const beforeMetrics=await metrics(cdp),beforeCPU=await processes(),started=Date.now();
    for(let number=0;number<count;number++) {
      const boundary=await page.evaluate(()=>({reads:render1229.reads.length,seq:render1229.seq,mutations:render1229.feedMutations}));
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
      const forbidden=new Set(['topic','topic_unread','marks','wakes','topic_tools','memory_items','pipeline','pipeline_row','health_light','workspace_links','conversation']);
      check(operation+' unrelated resources unread',observed.reads.every(read=>!forbidden.has(read.name)),observed.reads.map(read=>read.name));
      check(operation+' successful reads',observed.reads.every(read=>read.status>=200&&read.status<300&&!read.failure),observed.reads);
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
  const openPhase={name:'open-topic-positive',posts:[]};
  for(let number=0;number<count;number++){
    const body=`Render open-topic probe ${number}`,operation=`cost1229-open-${number}`;
    const receipt=await control({method:'agent_message',operation_id:operation,topic_id:'cost1229-open',whole_topic:true,
      body,post_args:{reply_to:roots[0],reply_without_quote:'Identified scratch open-topic measurement.'}});
    assert.equal(receipt.status,'committed');openPhase.posts.push({operation,receipt});
    await page.waitForFunction(body=>document.querySelector('#messages')?.textContent.includes(body),body,{timeout:20000});
    await settle();
  }
  const openAfter=await metrics(cdp);
  openPhase.wallMs=Date.now()-openStart;openPhase.processCPU=processCPU(openCPU,await processes());
  openPhase.metrics=Object.fromEntries(['TaskDuration','ScriptDuration','LayoutDuration','RecalcStyleDuration','LayoutCount','RecalcStyleCount'].map(key=>[key,openAfter[key]-openMetrics[key]]));
  openPhase.functions=await coverage();report.openTopic=openPhase;
  check('open topic still reaches feed',openPhase.posts.length===count&&openPhase.functions.captureListAnchor>0,openPhase.functions);
} catch(error) { report.failures.push({name:'harness or setup barrier',detail:error.stack}); }
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

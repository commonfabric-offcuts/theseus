// Real Core/HTTP, independent device contexts and durable tab close/reopen.
import assert from 'node:assert/strict';
import { spawn,execFileSync } from 'node:child_process';
import { mkdir,mkdtemp,writeFile,rm,access,readFile } from 'node:fs/promises';
import { createHash,randomUUID } from 'node:crypto';
import os from 'node:os';
import net from 'node:net';
import { fixtureControl } from './fixture_control.mjs';

const playwright=await import(process.env.AIM_PLAYWRIGHT_CORE),engine=process.env.AIM_ENGINE??'chromium';
const [out,mode='smoke']=process.argv.slice(2);await mkdir(out,{recursive:true});
const load=os.loadavg();assert.ok(load[0]<12,'actual load below12 before launch');
const fixture=spawn('/usr/bin/python3',['-X',`pycache_prefix=${out}/pycache`,'tests/fixtures/ui_http.py','--freshness','--live']);
const {control,exit,errors}=fixtureControl(fixture);
const result={engine,mode,load,cells:[],errors:[],cleanup:{},failure:null},owned=new Set();let browser,profile,origin,facts;
const ps=()=>execFileSync('/bin/ps',['-axo','pid=,ppid=,command='],{encoding:'utf8'}).trim().split('\n').map(line=>{
  const [,pid,ppid,command]=line.match(/^\s*(\d+)\s+(\d+)\s+(.*)$/);return {pid:+pid,ppid:+ppid,command};
});
const remember=()=>{const rows=ps();for(let again=true;again;){again=false;for(const r of rows)if(owned.has(r.ppid)&&!owned.has(r.pid)){owned.add(r.pid);again=true;}}};
const value=()=>({version:1,selected:0,sets:[{focus:null,outcomes:[],topics:[]},{focus:null,outcomes:[],topics:[]}]});
try{
  facts=await control({method:'ready'});origin=facts.origin;result.runtime={...facts,token:'scratch token omitted'};
  await control({method:'navigation_workspaces',workspaces:[{id:'w1004',title:'Other Dim outcome',team:[]}]});
  const made=await control({method:'navigation_topics',topics:[{id:'t1004a',title:'Dim topic A'},{id:'t1004b',title:'Dim topic B'},{id:'t1004c',title:'Dim topic C',workspace_id:'w1004'}]});
  assert.ok(made.every(x=>x.status==='committed'));
  profile=await mkdtemp(`${out}/${engine}-profile-`);
  const persistent=await playwright[engine].launchPersistentContext(profile,{headless:true,...(engine==='chromium'?{executablePath:process.env.AIM_CHROME}:{})});
  browser=persistent.browser();result.browserVersion=browser.version();for(const r of ps())if(r.command.includes(profile))owned.add(r.pid);remember();assert.ok(owned.size);
  const headers={Authorization:`Bearer ${facts.token}`,Origin:origin};
  const coreView=async()=>{const response=await persistent.request.post(origin+'/api/view',{headers,data:{name:'rail_dimming',args:{}}});assert.equal(response.status(),200);const r=await response.json();assert.ok(!r.error,JSON.stringify(r));return r;};
  const boot=await (await persistent.request.get(origin+'/api/bootstrap',{headers})).json();
  assert.equal(boot.limits.rail_dim_choices,2048,'Core advertises the editing bound to both devices');
  const reset=async()=>{const current=await coreView();const response=await persistent.request.post(origin+'/api/command',{headers,data:{v:1,instance_id:facts.instance_id,operation_id:randomUUID(),kind:'rail.dimming_set',target:{},expected:{dim_revision:current.dim_revision,authority:{authority_id:boot.authority.authority_id,authority_epoch:boot.authority.authority_epoch}},args:{value:value()}}});const r=await response.json();assert.equal(r.status,'committed',JSON.stringify(r));};
  const widths=mode==='green'?[1280,390,375,320]:[1280];let first=true;
  for(const width of widths)for(const look of mode==='green'?['bookends','paper']:['bookends'])for(const colorScheme of mode==='green'?['light','dark']:['light']){
    const cell={width,look,colorScheme,requests:[]};result.cells.push(cell);
    if(!first)await reset();
    const contexts=[];
    const make=async(phone,legacy=false)=>{
      const context=await browser.newContext({viewport:{width:phone?width:1280,height:1000},hasTouch:phone,isMobile:phone,colorScheme});contexts.push(context);
      await context.addInitScript(({instance,actor,look,legacy})=>{
        const opened=`aim-next.outline-open.${JSON.stringify([instance,actor])}`;
        localStorage.setItem(opened,JSON.stringify({w1:true,w1004:true}));
        if(look==='paper')localStorage.setItem('theseus-look','paper');
        if(legacy){const key=`aim-next.rail-dimming.v1:${JSON.stringify([instance,actor])}`;if(localStorage.getItem(key)===null)localStorage.setItem(key,JSON.stringify({version:1,selected:1,sets:[{focus:null,outcomes:[['w1004',true],['w1004-unreadable',true]],topics:[['w1','t1004a',true],['w1','t1004-unreadable',true]]},{focus:null,outcomes:[],topics:[]}]}));}
      },{instance:facts.instance_id,actor:facts.actor,look,legacy});
      return context;
    };
    const phone=width<500,aContext=await make(phone,first),bContext=await make(false);
    let a,b;
    const watch=page=>{page.setDefaultTimeout(12000);page.on('pageerror',e=>result.errors.push(String(e)));page.on('request',r=>{if(r.url().endsWith('/api/command')){try{const e=r.postDataJSON();if(e.kind==='rail.dimming_set')cell.requests.push(e);}catch{}}});};
    const visit=async(page,drawer=false)=>{watch(page);await page.goto(origin+'/?topic=t1');await page.locator('body[data-ready=true]').waitFor();if(drawer)await page.locator('#rail-open').tap();await page.locator('#outline a[data-topic-id=t1004a]').waitFor({state:'visible'});};
    const saved=page=>page.waitForFunction(()=>document.querySelector('.rail-dim')?.title.includes('kept in Core'));
    const selected=(page,n)=>page.waitForFunction(n=>document.querySelector(`.rail-dim [data-dim-set="${n}"]`)?.getAttribute('aria-pressed')==='true',n);
    const dimmed=(page,id,on)=>page.waitForFunction(({id,on})=>document.querySelector(`#outline a[data-topic-id="${id}"]`)?.dataset.dimmed===String(on),{id,on});
    const choose=async(page,n,touch=false)=>{const button=page.locator(`.rail-dim [data-dim-set="${n}"]`);if(touch)await button.tap();else await button.click();await selected(page,n);await saved(page);};
    const edit=(page,id,mods=['Meta'])=>page.locator(`#outline a[data-topic-id="${id}"]`).click({modifiers:mods,position:{x:20,y:10}});
    let releaseImport=()=>{},importHeld=null;
    if(first){
      let held,release;importHeld=new Promise(r=>held=r);const gate=new Promise(r=>release=r);releaseImport=release;
      await aContext.route('**/api/view',async route=>{const request=route.request().postDataJSON();
        if(request.name!=='rail_dimming'||!request.args?.candidate)return route.continue();
        const response=await route.fetch();held();await gate;await route.fulfill({response});
      });
    }
    try{
      a=await aContext.newPage();await visit(a,phone);
      if(importHeld){await importHeld;await edit(a,'t1004b');releaseImport();cell.initialReadClick=true;}
      await saved(a);
      b=await bContext.newPage();await visit(b);await saved(b);
      if(first){await selected(a,1);await selected(b,1);await dimmed(b,'t1004a',true);await dimmed(b,'t1004b',true);const core=await coreView();assert.equal(core.dim_revision,1);assert.equal(core.value.selected,1);assert.ok(!JSON.stringify(core.value).includes('unreadable'));assert.equal(await a.evaluate(({instance,actor})=>localStorage.getItem(`aim-next.rail-dimming.v1:${JSON.stringify([instance,actor])}`),{instance:facts.instance_id,actor:facts.actor}),null);await aContext.unroute('**/api/view');cell.realLegacyImport=true;cell.prunedUnreadableLegacy=true;cell.retiredLegacyKey=true;}
      first=false;
      assert.equal(await b.evaluate(({instance,actor})=>localStorage.getItem(`aim-next.rail-dimming.v1:${JSON.stringify([instance,actor])}`),{instance:facts.instance_id,actor:facts.actor}),null,'second device has no copied973 cache');
      await choose(b,0);await selected(a,0);const beforeURL=b.url();
      await edit(b,'t1004b');await saved(b);await selected(a,1);await dimmed(a,'t1004b',true);await dimmed(b,'t1004b',true);assert.equal(b.url(),beforeURL);cell.twoIndependentDevices=true;
      await choose(a,2,phone);await selected(b,2);await edit(b,'t1004a',['Meta','Shift']);await saved(b);await dimmed(a,'t1004b',true);await dimmed(a,'t1004a',false);cell.nativeControls=true;
      const hashes={};for(const file of ['rail-dimming.mjs','dim-choices.mjs','dimming-sync.mjs','dim-journal.mjs','outline-rail.mjs']){const r=await persistent.request.get(origin+'/'+file);const served=createHash('sha256').update(await r.body()).digest('hex');assert.equal(served,createHash('sha256').update(await readFile('web/'+file)).digest('hex'));hashes[file]=served;}cell.servedHashes=hashes;
      // The server commits, but this device loses the response. Close the tab,
      // keeping only browser storage, then reopen and retry the same operation.
      let lost=null;
      await bContext.route('**/api/command',async route=>{const e=route.request().postDataJSON();if(e.kind!=='rail.dimming_set')return route.continue();
        if(!lost){lost=structuredClone(e);await route.fetch();}await route.abort('failed');});
      const revisionBefore=(await coreView()).dim_revision;
      await edit(b,'t1004b');await b.locator('.rail-dim-retry').waitFor();assert.ok(lost);const committed=await coreView();assert.equal(committed.dim_revision,revisionBefore+1);
      const records=await b.evaluate(()=>Object.keys(localStorage).filter(k=>k.startsWith('aim-next.rail-dimming.pending.v1:')).map(k=>JSON.parse(localStorage.getItem(k))));assert.ok(records.some(r=>r.snapshot.prepared.some(p=>p.envelope.operation_id===lost.operation_id)));
      await b.close();b=null;await bContext.unroute('**/api/command');
      b=await bContext.newPage();await visit(b);await saved(b);assert.equal((await coreView()).dim_revision,committed.dim_revision);
      const replay=cell.requests.filter(e=>e.operation_id===lost.operation_id);assert.ok(replay.length>=2);assert.ok(replay.every(e=>JSON.stringify(e)===JSON.stringify(lost)));cell.exactCloseReopen={operation:lost.operation_id,attempts:replay.length,revision:committed.dim_revision};
      await selected(a,2);await dimmed(a,'t1004b',false);
      if(phone){const boxes=await a.locator('.rail-dim [data-dim-set]').evaluateAll(nodes=>nodes.map(n=>{const b=n.getBoundingClientRect();return {width:b.width,height:b.height};}));assert.ok(boxes.every(b=>b.width>=44&&b.height>=44));cell.touchTargets=boxes;}
      await a.screenshot({path:`${out}/${width}-${look}-${colorScheme}.png`,fullPage:true});assert.deepEqual(result.errors,[]);
    }catch(error){
      cell.failure=error.stack;
      if(a&&!a.isClosed()){
        cell.failureDOM=await a.evaluate(()=>({title:document.querySelector('.rail-dim')?.title,text:document.querySelector('.rail-dim')?.textContent,locks:Boolean(navigator.locks?.request),keys:Object.keys(localStorage),notices:[...document.querySelectorAll('[role=alert]')].map(n=>n.textContent)}));
        await a.screenshot({path:`${out}/failure.png`,fullPage:true});
      }
      try{cell.failureCore=await coreView();}catch(coreError){cell.failureCoreError=String(coreError);}throw error;
    }finally{releaseImport();for(const context of contexts)await context.close();remember();}
  }
}catch(error){result.failure=error.stack;process.exitCode=1;}
finally{
  if(browser){remember();await browser.close();result.cleanup.browserClosed=!browser.isConnected();}
  const after=ps();result.cleanup.ownedPids=[...owned];result.cleanup.remainingOwned=after.filter(r=>owned.has(r.pid));result.cleanup.profileProcesses=profile?after.filter(r=>r.command.includes(profile)):[];
  if(profile&&result.cleanup.browserClosed&&!result.cleanup.remainingOwned.length&&!result.cleanup.profileProcesses.length){await rm(profile,{recursive:true});result.cleanup.profileRemoved=await access(profile).then(()=>false,()=>true);}
  fixture.stdin.end();result.cleanup.fixtureExit=await exit;result.cleanup.fixtureErrors=errors();result.cleanup.fixtureAbsent=!ps().some(r=>r.pid===fixture.pid);
  if(origin)result.cleanup.portClosed=await new Promise(resolve=>{const u=new URL(origin),s=net.connect(+u.port,u.hostname);s.once('connect',()=>{s.destroy();resolve(false);});s.once('error',()=>resolve(true));});
  await writeFile(`${out}/results.json`,JSON.stringify(result,null,2));
  assert.deepEqual(result.cleanup.fixtureExit,{code:0,signal:null});assert.equal(result.cleanup.fixtureAbsent,true);assert.equal(result.cleanup.portClosed,true);
  if(browser){assert.equal(result.cleanup.browserClosed,true);assert.deepEqual(result.cleanup.remainingOwned,[]);assert.deepEqual(result.cleanup.profileProcesses,[]);assert.equal(result.cleanup.profileRemoved,true);}
  console.log(JSON.stringify({engine,mode,cells:result.cells.length,failure:result.failure,cleanup:result.cleanup}));
}

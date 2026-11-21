// Run the retained372 own cases with native Playwright input and strict owned
// cleanup. The main reading producer continues to offer the same cases.
import assert from 'node:assert/strict';
import {spawn,execFileSync} from 'node:child_process';
import {mkdir,mkdtemp,readFile,writeFile,rm,access} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import net from 'node:net';
import {fixtureControl} from './fixture_control.mjs';
import {waitingQuestions372Checks} from './waiting_questions_372_native.mjs';
const playwright=await import(process.env.AIM_PLAYWRIGHT_CORE),engine=process.env.AIM_ENGINE??'chromium';
const evidence=process.argv[2],filter=new RegExp(process.argv[3]??'');await mkdir(evidence,{recursive:true});
const root=process.env.AIM_372_ROOT??process.cwd();
const sources=['aim_next/blocking.py','aim_next/conversation.py','aim_next/store.py','aim_next/topic_state.py','aim_next/outcome_light.py','aim_next/outcome_rules.py','web/topic-navigation.mjs','web/things-rail.mjs','web/waiting-questions.mjs','web/outline-rail.mjs'];
const hashes=Object.fromEntries(await Promise.all(sources.map(async f=>[f,createHash('sha256').update(await readFile(`${root}/${f}`)).digest('hex')])));
await writeFile(`${evidence}/source.json`,JSON.stringify({root,HEAD:execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim(),hashes,harness:createHash('sha256').update(await readFile('tests/waiting_questions_372_acceptance.mjs')).digest('hex'),cases:createHash('sha256').update(await readFile('tests/waiting_questions_372_native.mjs')).digest('hex')},null,2));
const fixture=spawn('/usr/bin/python3',['-B','tests/fixtures/ui_http.py','--freshness','--live'],{cwd:root});
const {control,exit,errors}=fixtureControl(fixture),results=[],observations=[],cleanup={},owned=new Set(),fixtureOwned=new Set([fixture.pid]);
const ps=()=>execFileSync('/bin/ps',['-axo','pid=,ppid=,command='],{encoding:'utf8'}).trim().split('\n').map(line=>{
  const[,pid,ppid,command]=line.match(/^\s*(\d+)\s+(\d+)\s+(.*)$/);return{pid:+pid,ppid:+ppid,command};});
function children(set){const rows=ps();for(let more=true;more;){more=false;for(const p of rows)if(set.has(p.ppid)&&!set.has(p.pid)){set.add(p.pid);more=true;}}}
let browser,profile,origin,failure,currentPage;
const until=async(probe,why)=>{const end=Date.now()+8000;while(Date.now()<end){const value=await probe();if(value)return value;await new Promise(r=>setTimeout(r,25));}throw Error('Timed out: '+why);};
try{
  const facts=await control({method:'ready'});origin=facts.origin;children(fixtureOwned);
  profile=await mkdtemp(`${evidence}/${engine}-profile-`);
  const persistent=await playwright[engine].launchPersistentContext(profile,{headless:true,...(engine==='chromium'?{executablePath:process.env.AIM_CHROME}:{})});
  browser=persistent.browser();cleanup.engine=browser.browserType().name();cleanup.version=browser.version();assert.equal(cleanup.engine,engine);
  for(const p of ps())if(p.command.includes(profile))owned.add(p.pid);children(owned);assert.ok(owned.size);
  const view=(name,args)=>control({method:'agent_view',actor:facts.actor,name,args});
  const page=async(name,_unused,_independent,{url,beforeNavigate})=>{
    const width=Number(/q372-(\d+)/.exec(name)?.[1]);assert.ok(width);
    const context=await browser.newContext({viewport:{width,height:width<600?844:900},deviceScaleFactor:1,isMobile:width<600,hasTouch:width<600});
    const pw=await context.newPage(),pageErrors=[],pendingViews=new Set();currentPage=pw;pw.setDefaultTimeout(6000);
    pw.on('pageerror',e=>{pageErrors.push(e.message);observations.push({name:'item372 page error',engine,case:name,error:e.message,stack:e.stack,url:pw.url()});});
    pw.on('request',r=>{if(new URL(r.url()).pathname==='/api/view')pendingViews.add(r);});
    // Requests of a discarded document may receive neither completion event.
    // A new main-frame document owns a new set; page errors remain unfiltered.
    pw.on('framenavigated',frame=>{if(frame===pw.mainFrame()){
      observations.push({name:'item372 navigation',engine,case:name,url:frame.url(),discardedPending:[...pendingViews].map(r=>({url:r.url(),request:r.postData()}))});pendingViews.clear();
    }});
    pw.on('requestfinished',r=>pendingViews.delete(r));
    pw.on('requestfailed',r=>{pendingViews.delete(r);observations.push({name:'item372 failed request',engine,case:name,url:r.url(),failure:r.failure(),request:r.postData()});});
    const readsSettled=()=>until(()=>pendingViews.size===0,name+': outstanding fixture view reads finish before navigation');
    let touch;
    const wrapped={errors:pageErrors,pw,
      readsSettled,
      evaluate:async expression=>{if(expression==='history.back()')await readsSettled();return pw.evaluate(expression);},
      // The case measures querySelector's first, uncovered owner. Navigation
      // snapshots can retain a second, hidden copy of the same row.
      point:selector=>pw.locator(selector).first().click(),key:key=>pw.keyboard.press(key),
      close:async()=>{children(owned);await pw.screenshot({path:`${evidence}/${name}-closing.png`,animations:'disabled'});await context.close();if(currentPage===pw)currentPage=null;},
      send:async(method,args={})=>{
        if(method==='Emulation.setDeviceMetricsOverride'){assert.equal(args.mobile,width<600);return pw.setViewportSize({width:args.width,height:args.height});}
        if(method==='Emulation.setTouchEmulationEnabled'){assert.equal(args.enabled,width<600);return;}
        if(method==='Emulation.setEmulatedMedia')return pw.emulateMedia({colorScheme:args.features.find(f=>f.name==='prefers-color-scheme').value});
        if(method==='Input.dispatchTouchEvent'){
          if(args.type==='touchStart'){touch=args.touchPoints[0];return;}
          assert.equal(args.type,'touchEnd');assert.ok(touch);const at=touch;touch=null;return pw.touchscreen.tap(at.x,at.y);
        }
        if(method==='Page.navigate'){await readsSettled();return pw.goto(args.url);}
        throw Error('Unsupported372 native operation '+method);
      }};
    await beforeNavigate(wrapped);await pw.goto(url);
    const moduleURL=await pw.evaluate(()=>new URL('./topic-navigation.mjs',[...document.scripts].find(s=>s.src.includes('/app.mjs')).src).href);
    for(const file of ['topic-navigation.mjs','outline-rail.mjs']) assert.equal(createHash('sha256').update(await (await pw.request.get(new URL(file,moduleURL).href)).body()).digest('hex'),hashes['web/'+file]);
    return wrapped;
  };
  const check=async(name,act)=>{
    if(!filter.test(name))return;let error;
    try{await act();}catch(e){error=e.stack;if(currentPage&&!currentPage.isClosed())await currentPage.screenshot({path:`${evidence}/failure-${results.length}.png`});}
    results.push({name,error:error??null});await writeFile(`${evidence}/observations.json`,JSON.stringify({results,observations},null,2));
  };
  const shot=async(p,name)=>p.pw.screenshot({path:`${evidence}/${name}.png`,animations:'disabled'});
  await waitingQuestions372Checks({check,page,until,control,view,facts,shot,observations,engine});
}catch(e){failure=e;}
finally{
  if(browser){children(owned);await browser.close();cleanup.browserClosed=!browser.isConnected();}
  const after=ps();cleanup.ownedPids=[...owned];cleanup.remainingOwned=after.filter(p=>owned.has(p.pid));cleanup.profileProcesses=profile?after.filter(p=>p.command.includes(profile)):[];
  if(profile&&cleanup.browserClosed&&!cleanup.remainingOwned.length&&!cleanup.profileProcesses.length){await rm(profile,{recursive:true});cleanup.profileRemoved=await access(profile).then(()=>false,()=>true);}
  children(fixtureOwned);fixture.stdin.end();cleanup.fixtureExit=await exit;cleanup.fixtureErrors=errors();cleanup.fixturePid=fixture.pid;
  cleanup.fixtureAbsent=!ps().some(p=>p.pid===fixture.pid);cleanup.fixtureOwnedPids=[...fixtureOwned];cleanup.remainingFixtureOwned=ps().filter(p=>fixtureOwned.has(p.pid));
  if(origin)cleanup.portClosed=await new Promise(resolve=>{const u=new URL(origin),s=net.createConnection({host:u.hostname,port:+u.port});s.once('connect',()=>{s.destroy();resolve(false);});s.once('error',()=>resolve(true));});
  await writeFile(`${evidence}/results.json`,JSON.stringify({engine,hashes,results,observations,cleanup,failure:failure?.stack??null},null,2));
}
console.log(JSON.stringify({engine,pass:results.filter(r=>!r.error).length,fail:results.filter(r=>r.error),cleanup,failure:failure?.stack??null},null,2));
if(failure||!results.length||results.some(r=>r.error)||!cleanup.browserClosed||cleanup.remainingOwned?.length||cleanup.profileProcesses?.length||!cleanup.profileRemoved||cleanup.fixtureExit?.code!==0||!cleanup.fixtureAbsent||cleanup.remainingFixtureOwned?.length||!cleanup.portClosed||cleanup.fixtureErrors)process.exitCode=1;

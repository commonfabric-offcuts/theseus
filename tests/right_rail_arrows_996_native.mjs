// Actual right-rail keyboard, pointer and emulated phone taps; no physical-device claim.
import assert from 'node:assert/strict';
import {spawn,execFileSync} from 'node:child_process';
import {mkdir,mkdtemp,writeFile,rm,access,readFile} from 'node:fs/promises';
import net from 'node:net';
import {createHash} from 'node:crypto';
import {resolve} from 'node:path';
import {fixtureControl} from './fixture_control.mjs';
const playwright=await import(process.env.AIM_PLAYWRIGHT_CORE),engine=process.env.AIM_ENGINE??'chromium';
const evidence=process.argv[2],baseline=process.env.AIM_996_BASELINE==='1',touchOnly=process.env.AIM_996_TOUCH==='1';await mkdir(evidence,{recursive:true});
const fixture=spawn('/usr/bin/python3',['-B','tests/fixtures/ui_http.py','--freshness','--live','--images','--media'],{cwd:process.env.AIM_996_ROOT??process.cwd()});
const source=await readFile(resolve(process.env.AIM_996_ROOT??process.cwd(),'web/things-rail.mjs')),sourceHash=createHash('sha256').update(source).digest('hex');
const style=await readFile(resolve(process.env.AIM_996_ROOT??process.cwd(),'web/rails.css')),styleHash=createHash('sha256').update(style).digest('hex');
const {control,exit,errors}=fixtureControl(fixture),results=[],cleanup={},owned=new Set(),fixtureOwned=new Set([fixture.pid]);
const ps=()=>execFileSync('/bin/ps',['-axo','pid=,ppid=,command='],{encoding:'utf8'}).trim().split('\n').map(line=>{const[,pid,ppid,command]=line.match(/^\s*(\d+)\s+(\d+)\s+(.*)$/);return{pid:+pid,ppid:+ppid,command};});
function children(set){const list=ps();for(let changed=true;changed;){changed=false;for(const p of list)if(set.has(p.ppid)&&!set.has(p.pid)){set.add(p.pid);changed=true;}}}
let browser,profile,origin,failure,serial=0;
try{
 const facts=await control({method:'ready'});origin=facts.origin;children(fixtureOwned);
 profile=await mkdtemp(`${evidence}/${engine}-profile-`);
 const persistent=await playwright[engine].launchPersistentContext(profile,{headless:true,...(engine==='chromium'?{executablePath:process.env.AIM_CHROME}:{})});
 browser=persistent.browser();cleanup.engine=browser.browserType().name();cleanup.version=browser.version();assert.equal(cleanup.engine,engine);for(const p of ps())if(p.command.includes(profile))owned.add(p.pid);children(owned);assert.ok(owned.size);
 await writeFile(`${evidence}/owned-start.json`,JSON.stringify({engine,profile,ownedPids:[...owned],fixturePid:fixture.pid,origin}));

 const cells=touchOnly?[[390,'bookends','light']]:baseline||process.env.AIM_996_PREFLIGHT==='1'?[[1280,'bookends','light']]:[1280,1600,390].flatMap(width=>['bookends','paper'].flatMap(look=>['light','dark'].map(theme=>[width,look,theme])));
 for(const[width,look,colorScheme]of cells){
  const key=`${engine}-${width}-${look}-${colorScheme}`,n=++serial,first=`page996-${n}-first`,second=`page996-${n}-second`;
  for(const[id,title]of [[first,'First notebook page996 '+n],[second,'Second notebook page996 '+n]])assert.equal((await control({method:'agent_page',operation_id:id,item_id:id,topic_id:'t1',title,body:'Page words retained for the rail.'})).status,'committed');
  const sent=await control({method:'agent_message',operation_id:`996-links-${n}`,sender:'person',whole_topic:true,body:`Rail source ${n}. [A preview](https://example.test/preview/${n}) [Pull request](https://github.com/example/repo/pull/${n})`,attachments:[{name:`rail996-${n}.png`,image:'screen.png'}]});assert.equal(sent.status,'committed');
  const phone=width<761,context=await browser.newContext({viewport:{width,height:1000},colorScheme,...(phone?{isMobile:true,hasTouch:true}: {})});await context.addInitScript(look=>localStorage.setItem('theseus-look',look),look);
  const page=await context.newPage(),pageErrors=[];page.setDefaultTimeout(6000);page.on('pageerror',e=>pageErrors.push(e.message));let error;const observations=[];
  const snap=()=>page.evaluate(()=>({active:{tag:document.activeElement.tagName,classes:document.activeElement.className,label:document.activeElement.getAttribute('aria-label'),href:document.activeElement.getAttribute('href'),inFeed:!!document.activeElement.closest('#main')},sections:[...document.querySelectorAll('#things .things-sec:not([hidden])')].map(s=>({key:s.dataset.key,open:s.open,chevron:!!s.querySelector('.things-disclosure')})),url:location.href,folds:Object.fromEntries(Object.entries(localStorage).filter(([k])=>k.startsWith('aim-next.things.')))}));
  const record=async phase=>observations.push({phase,...await snap()});
  try{
   await page.goto(origin+'/?topic=t1');await page.waitForFunction(()=>document.body.dataset.ready==='true');
   const app=await page.evaluate(()=>[...document.scripts].find(s=>s.src.includes('/app.mjs')).src);assert.deepEqual(await(await page.request.get(new URL('./things-rail.mjs',app).href)).body(),source,'exact served rail owner');assert.deepEqual(await(await page.request.get(new URL('./rails.css',app).href)).body(),style,'exact served rail CSS');
   const notebook=page.locator('#things .things-sec[data-key=notebook]'),summary=notebook.locator(':scope>summary'),link=notebook.locator(`a[href*="${first}"]`);
   if(phone){
    await page.locator('#things-open').tap();await notebook.waitFor();await page.waitForFunction(()=>getComputedStyle(document.getElementById('things')).transform==='none');
    const chevron=summary.locator('.things-disclosure'),box=await chevron.boundingBox();
    observations.push({phase:'phone disclosure bounds',box});assert.ok(box.width>=44&&box.height>=44,'new phone disclosure has a 44px touch target');
    assert.equal(await notebook.evaluate(s=>s.open),true);await chevron.tap();assert.equal(await notebook.evaluate(s=>s.open),false,'native phone chevron tap folds once');
    await chevron.tap();assert.equal(await notebook.evaluate(s=>s.open),true,'native phone chevron tap reopens once');
    await summary.locator('.things-section-name').tap();assert.equal(await notebook.evaluate(s=>s.open),false,'phone heading tap still folds');
    await summary.locator('.things-section-name').tap();assert.equal(await notebook.evaluate(s=>s.open),true,'phone heading tap still opens');
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'phone has no horizontal overflow');
   }else{
   await link.waitFor();assert.equal(await notebook.evaluate(s=>s.open),true);await link.focus();await record('notebook before Left');await page.keyboard.press('ArrowLeft');await record('notebook after Left');
   assert.equal((await snap()).active.inFeed,true,'996 Notebook item Left goes directly to feed');assert.equal(await notebook.evaluate(s=>s.open),true,'996 Left keeps Notebook open');
   await summary.focus();await page.keyboard.press('ArrowLeft');assert.equal((await snap()).active.inFeed,true);assert.equal(await notebook.evaluate(s=>s.open),true);
   const chevron=summary.locator('.things-disclosure');assert.equal(await chevron.count(),1,'996 Notebook header has its independent disclosure');
   await summary.focus();await page.keyboard.press('ArrowRight');assert.equal(await chevron.evaluate(n=>n===document.activeElement),true,'Right reaches disclosure');
   await page.keyboard.press('Enter');await page.waitForFunction(()=>!document.querySelector('#things .things-sec[data-key=notebook]').open);await page.keyboard.press('Space');await page.waitForFunction(()=>document.querySelector('#things .things-sec[data-key=notebook]').open);
   assert.equal(await chevron.getAttribute('aria-expanded'),'true');await page.keyboard.press('ArrowRight');assert.equal(await page.locator('#things .notebook-create').evaluate(n=>n===document.activeElement),true,'Notebook pencil still reachable');
   await page.keyboard.press('ArrowLeft');assert.equal((await snap()).active.inFeed,true,'pencil Left goes to feed');
   await chevron.focus();await page.keyboard.press('ArrowDown');assert.equal(await notebook.locator('.things-body').evaluate(n=>n.contains(document.activeElement)),true,'Down enters first Notebook row');
   await page.keyboard.press('ArrowUp');assert.equal(await summary.evaluate(n=>n===document.activeElement),true,'Up returns to header without closing');assert.equal(await notebook.evaluate(s=>s.open),true);
   await summary.click();assert.equal(await notebook.evaluate(s=>s.open),false,'pointer heading still folds');await summary.click();assert.equal(await notebook.evaluate(s=>s.open),true,'pointer heading still opens');
   await chevron.click();assert.equal(await notebook.evaluate(s=>s.open),false,'pointer chevron toggles exactly once');await page.waitForFunction(()=>Object.keys(localStorage).filter(k=>k.startsWith('aim-next.things.')).some(k=>JSON.parse(localStorage.getItem(k)).notebook===false));await record('closed fold persisted before reload');await page.reload();await page.waitForFunction(()=>document.body.dataset.ready==='true');await notebook.waitFor();assert.equal(await notebook.evaluate(s=>s.open),false,'saved fold survives reload');await chevron.click();
   for(const name of ['images','prs','previews']){
    const section=page.locator(`#things .things-sec[data-key="${name}"]`);await section.waitFor();const row=section.locator('.things-body a').first();await row.waitFor();await row.focus();await page.keyboard.press('ArrowLeft');assert.equal((await snap()).active.inFeed,true,name+' item Left reaches feed');assert.equal(await section.evaluate(s=>s.open),true,name+' stays open');
    const heading=section.locator(':scope>summary');await heading.focus();await page.keyboard.press('ArrowLeft');assert.equal((await snap()).active.inFeed,true,name+' heading Left reaches feed');assert.equal(await section.evaluate(s=>s.open),true);
    const disclosure=heading.locator('.things-disclosure');await disclosure.focus();await page.keyboard.press('Enter');assert.equal(await section.evaluate(s=>s.open),false);await page.keyboard.press('Space');assert.equal(await section.evaluate(s=>s.open),true);
   }
   }
   await record('all sections passed');assert.deepEqual(pageErrors,[]);await notebook.scrollIntoViewIfNeeded();await page.screenshot({path:`${evidence}/${key}.png`});
  }catch(e){error=e.stack;await record('failure before close').catch(()=>{});await page.screenshot({path:`${evidence}/${key}-failure.png`}).catch(()=>{});}
  results.push({key,error:error??null,observations,pageErrors});await writeFile(`${evidence}/observations.json`,JSON.stringify(results,null,2));children(owned);await context.close();
 }
}catch(e){failure=e;}
finally{
 if(browser){children(owned);await browser.close();cleanup.browserClosed=!browser.isConnected();}
 const after=ps();cleanup.ownedPids=[...owned];cleanup.remainingOwned=after.filter(p=>owned.has(p.pid));cleanup.profileProcesses=profile?after.filter(p=>p.command.includes(profile)):[];
 if(profile&&cleanup.browserClosed&&!cleanup.remainingOwned.length&&!cleanup.profileProcesses.length){await rm(profile,{recursive:true});cleanup.profileRemoved=await access(profile).then(()=>false,()=>true);}
 children(fixtureOwned);fixture.stdin.end();cleanup.fixtureExit=await exit;cleanup.fixtureErrors=errors();cleanup.fixturePid=fixture.pid;
 cleanup.fixtureAbsent=!ps().some(p=>p.pid===fixture.pid);cleanup.fixtureOwnedPids=[...fixtureOwned];cleanup.remainingFixtureOwned=ps().filter(p=>fixtureOwned.has(p.pid));
 if(origin)cleanup.portClosed=await new Promise(resolve=>{const u=new URL(origin),s=net.createConnection({host:u.hostname,port:+u.port});s.once('connect',()=>{s.destroy();resolve(false);});s.once('error',()=>resolve(true));});
 await writeFile(`${evidence}/results.json`,JSON.stringify({engine,baseline,sourceHash,styleHash,results,cleanup,failure:failure?.stack??null},null,2));
}
const failed=results.filter(r=>r.error);process.stdout.write(JSON.stringify({engine,pass:results.length-failed.length,fail:failed.length,failed:failed.map(r=>({key:r.key,error:r.error})),cleanup,fatal:failure?.stack??null},null,2)+'\n');
if(failure||failed.length||!cleanup.browserClosed||cleanup.remainingOwned?.length||cleanup.profileProcesses?.length||!cleanup.profileRemoved||cleanup.fixtureExit?.code!==0||!cleanup.fixtureAbsent||cleanup.remainingFixtureOwned?.length||!cleanup.portClosed)process.exitCode=1;

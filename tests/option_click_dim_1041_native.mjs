// Native browser Command-click tabs and Option/Option-Shift kept Core choices.
import assert from 'node:assert/strict';
import {spawn,execFileSync} from 'node:child_process';
import {mkdir,mkdtemp,writeFile,rm,access} from 'node:fs/promises';
import net from 'node:net';
import {createHash,randomUUID} from 'node:crypto';
import {fixtureControl} from './fixture_control.mjs';
const playwright=await import(process.env.AIM_PLAYWRIGHT_CORE),engine=process.env.AIM_ENGINE??'chromium';
const evidence=process.argv[2],baseline=process.env.AIM_1041_PREFLIGHT==='1';await mkdir(evidence,{recursive:true});
const sourceHashes=JSON.parse(process.env.AIM_1041_SOURCE_HASHES??'{}');
const sourceHash=process.env.AIM_1041_SOURCE_SHA256;assert.match(sourceHash??'',/^[a-f0-9]{64}$/,'supply actual RailDimming hash');
const fixture=spawn('/usr/bin/python3',['-B','tests/fixtures/ui_http.py','--freshness','--live'],{cwd:process.env.AIM_1041_ROOT??process.cwd()});
const {control,exit,errors}=fixtureControl(fixture),results=[],cleanup={},owned=new Set(),fixtureOwned=new Set([fixture.pid]);
const ps=()=>execFileSync('/bin/ps',['-axo','pid=,ppid=,command='],{encoding:'utf8'}).trim().split('\n').map(line=>{const[,pid,ppid,command]=line.match(/^\s*(\d+)\s+(\d+)\s+(.*)$/);return{pid:+pid,ppid:+ppid,command};});
function children(set){const list=ps();for(let changed=true;changed;){changed=false;for(const p of list)if(set.has(p.ppid)&&!set.has(p.pid)){set.add(p.pid);changed=true;}}}
let browser,profile,origin,failure;
try{
 const facts=await control({method:'ready'});origin=facts.origin;children(fixtureOwned);
 await control({method:'navigation_workspaces',workspaces:[{id:'w1041',title:'Dim menu outcome',team:[]}]});
 await control({method:'navigation_topics',topics:[{id:'t1041',title:'Dim menu topic'}]});
 profile=await mkdtemp(`${evidence}/${engine}-profile-`);
 const persistent=await playwright[engine].launchPersistentContext(profile,{headless:true,...(engine==='chromium'?{executablePath:process.env.AIM_CHROME}:process.env.AIM_WEBKIT?{executablePath:process.env.AIM_WEBKIT}:{})});
 browser=persistent.browser();cleanup.engine=browser.browserType().name();cleanup.version=browser.version();for(const p of ps())if(p.command.includes(profile))owned.add(p.pid);children(owned);assert.ok(owned.size);
 await writeFile(`${evidence}/owned-start.json`,JSON.stringify({engine,profile,ownedPids:[...owned],fixturePid:fixture.pid,origin}));
 const headers={Authorization:`Bearer ${facts.token}`,Origin:origin};
 const view=async()=>{const response=await persistent.request.post(origin+'/api/view',{headers,data:{name:'rail_dimming',args:{}}});assert.equal(response.status(),200);const r=await response.json();assert.ok(!r.error);return r;};
 const boot=await(await persistent.request.get(origin+'/api/bootstrap',{headers})).json();
 const save=async value=>{const before=await view();const response=await persistent.request.post(origin+'/api/command',{headers,data:{v:1,instance_id:facts.instance_id,operation_id:randomUUID(),kind:'rail.dimming_set',target:{},expected:{dim_revision:before.dim_revision,authority:{authority_id:boot.authority.authority_id,authority_epoch:boot.authority.authority_epoch}},args:{value}}});const r=await response.json();assert.equal(r.status,'committed',JSON.stringify(r));return r;};
 const empty=()=>({version:1,selected:0,sets:[{focus:null,outcomes:[],topics:[]},{focus:null,outcomes:[],topics:[]}]});
 const cells=baseline?[[1280,'bookends','light']]:['bookends','paper'].flatMap(look=>['light','dark'].map(theme=>[1280,look,theme]));
 for(const[width,look,colorScheme]of cells)for(const[kind,selector,w,t]of [['topic','#outline a[data-topic-id=t1041]','w1','t1041'],['outcome','#outline a.ol-name[data-workspace-id=w1041]','w1041',null]])for(const gesture of ['command','option','inverse']){
  await save(empty());const key=`${engine}-${look}-${colorScheme}-${kind}-${gesture}`,observations=[],pageErrors=[],leavingReadCancellations=[],requests=[],newPages=[],downloads=[];let error,leaving=false;
  const context=await browser.newContext({viewport:{width,height:1000},colorScheme});
  await context.addInitScript(({look,instance,actor})=>{localStorage.setItem('theseus-look',look);localStorage.setItem(`aim-next.outline-open.${JSON.stringify([instance,actor])}`,JSON.stringify({w1:true,w1041:true}));},{look,instance:facts.instance_id,actor:facts.actor});
  const page=await context.newPage();page.setDefaultTimeout(6000);
  page.on('pageerror',e=>{const detail={message:e.message,stack:e.stack,phase:leaving?'leaving':'active'};if(engine==='webkit'&&leaving&&/^Fetch API cannot load \S+ due to access control checks\.$/.test(e.stack?.split('\n')[0]??''))leavingReadCancellations.push(detail);else pageErrors.push(detail);});
  page.on('request',r=>{if(r.url().endsWith('/api/command')){const envelope=r.postDataJSON();if(envelope.kind==='rail.dimming_set')requests.push(envelope);}});
  page.on('download',d=>downloads.push({suggestedFilename:d.suggestedFilename()}));context.on('page',p=>{if(p!==page)newPages.push(p);});
  const saved=()=>page.waitForFunction(()=>document.querySelector('.rail-dim')?.title.includes('kept in Core'));
  const visit=async()=>{leaving=true;await page.goto(origin+'/?topic=t1');await page.locator('body[data-ready=true]').waitFor();leaving=false;await page.locator(selector).waitFor({state:'visible'});await saved();};
  try{
   await visit();children(owned);await writeFile(`${evidence}/owned-latest.json`,JSON.stringify({engine,profile,ownedPids:[...owned],fixturePid:fixture.pid,origin}));
   const app=await page.evaluate(()=>[...document.scripts].find(s=>s.src.includes('/app.mjs')).src);
   for(const[file,hash]of Object.entries(sourceHashes)){const served=await(await page.request.get(new URL('./'+file,app).href)).body();assert.equal(createHash('sha256').update(served).digest('hex'),hash,'served '+file);}
   assert.equal(sourceHashes['rail-dimming.mjs'],sourceHash);const row=page.locator(selector),originalURL=page.url(),href=await row.getAttribute('href'),before=await view(),current=await page.locator('#outline [aria-current=page]').evaluateAll(ns=>ns.map(n=>n.getAttribute('href')));
   if(kind==='topic'&&gesture==='command'){
    const keys=page.locator('#outline-keys');await keys.locator('summary').click();const words=await keys.innerText();assert.match(words,/Option-click/);assert.match(words,/Option-Shift/);assert.match(words,/Command-click.*new tab/);const geometry=await keys.evaluate(root=>{const term=[...root.querySelectorAll('dt')].find(n=>n.textContent.includes('click')),box=root.getBoundingClientRect(),d=term.nextElementSibling.getBoundingClientRect();return {label:term.textContent,right:d.right,containerRight:box.right,descriptionWidth:d.width};});observations.push({phase:'rendered key description containment',geometry});assert.ok(geometry.right<=geometry.containerRight+.5,'new shortcut must leave descriptions inside the rail legend');await keys.locator('dt').filter({hasText:'click'}).scrollIntoViewIfNeeded();await page.screenshot({path:`${evidence}/${key}-keys.png`});await keys.locator('summary').click();
    await page.locator('.guide-open').click();const guide=page.locator('dialog.interaction-guide[open]');const help=await guide.innerText();assert.match(help,/Option-click/);assert.match(help,/Option-Shift/);assert.match(help,/Command-click.*new tab/);await guide.getByRole('button',{name:'Close',exact:true}).click();observations.push({phase:'native rendered Keys and opened guide',legend:words,guideHasOption:true});
   }
   let menuValue=null;
   if(process.env.AIM_1041_MENU==='1'&&gesture==='option'){
    await row.focus();await page.keyboard.press('Shift+F10');await page.getByRole('menuitem',{name:'Dim',exact:true}).click();await saved();menuValue=(await view()).value;
    await row.focus();await page.keyboard.press('Shift+F10');await page.getByRole('menuitem',{name:'Undim',exact:true}).click();await saved();observations.push({phase:'separate composition shared menu kept value',menuValue,off:await view()});
   }
   const modifiers=gesture==='command'?['Meta']:gesture==='inverse'?['Alt','Shift']:['Alt'];
   const receipt=gesture==='command'?null:page.waitForResponse(r=>{try{return r.url().endsWith('/api/command')&&r.request().postDataJSON().kind==='rail.dimming_set';}catch{return false;}},{timeout:2500}).then(async r=>({status:r.status(),body:await r.json()})).catch(e=>({waitError:e.message}));
   const popup=gesture==='command'?context.waitForEvent('page',{timeout:1800}).catch(()=>null):null;
   await row.click({modifiers,position:{x:20,y:10}});
   if(gesture==='command'){
    const opened=await popup;observations.push({phase:'native Command-click actual tab event',newPageCount:newPages.length,url:opened?.url()??null,core:await view(),requests});
    assert.ok(opened,'Command-click must create an actual browser page');await opened.waitForURL(new URL(href,origin).href);await opened.locator('body[data-ready=true]').waitFor();await opened.waitForFunction(()=>document.querySelector('.rail-dim')?.title.includes('kept in Core'));assert.deepEqual(await view(),before,'Command-click writes no kept Dim fact');assert.deepEqual(requests,[]);observations.push({phase:'actual new page loaded with unchanged kept choice',url:opened.url(),core:await view()});await opened.close();
   }else{
    const response=await receipt;observations.push({phase:'native modified click actual Core receipt',response,core:await view(),downloads,newPageCount:newPages.length});assert.equal(response.waitError,undefined,'native Option gesture must reach the existing Core writer');assert.equal(response.body.status,'committed');await saved();
    const core=await view();assert.equal(core.value.selected,1);const set=core.value.sets[0];
    if(gesture==='inverse')assert.deepEqual(set.focus,[w,t]);else assert.ok((t===null?set.outcomes:set.topics).some(x=>t===null?x[0]===w&&x[1]:x[0]===w&&x[1]===t&&x[2]));
    if(menuValue)assert.deepEqual(core.value,menuValue,'Option and1033 menu share the same kept choice');
    assert.deepEqual(core.value.sets[1],empty().sets[1]);assert.equal(newPages.length,0);assert.deepEqual(downloads,[]);assert.equal(page.url(),originalURL);assert.deepEqual(await page.locator('#outline [aria-current=page]').evaluateAll(ns=>ns.map(n=>n.getAttribute('href'))),current);
    await visit();assert.deepEqual(await view(),core,'modified choice survives reload and actual readback');observations.push({phase:'Core kept state after reload',core});
   }
   await page.screenshot({path:`${evidence}/${key}.png`});assert.deepEqual(pageErrors,[]);
  }catch(e){error=e.stack;observations.push({phase:'failure',core:await view().catch(()=>null),newPageCount:newPages.length,downloads,body:await page.locator('body').innerText().catch(()=>null)});await page.screenshot({path:`${evidence}/${key}-failure.png`}).catch(()=>{});}
  results.push({key,error:error??null,observations,pageErrors,leavingReadCancellations,requests});await writeFile(`${evidence}/observations.json`,JSON.stringify(results,null,2));children(owned);leaving=true;await context.close();
 }
}catch(e){failure=e;}
finally{
 if(browser){children(owned);await browser.close();cleanup.browserClosed=!browser.isConnected();}
 const after=ps();cleanup.ownedPids=[...owned];cleanup.remainingOwned=after.filter(p=>owned.has(p.pid));cleanup.profileProcesses=profile?after.filter(p=>p.command.includes(profile)):[];
 if(profile&&cleanup.browserClosed&&!cleanup.remainingOwned.length&&!cleanup.profileProcesses.length){await rm(profile,{recursive:true});cleanup.profileRemoved=await access(profile).then(()=>false,()=>true);}
 children(fixtureOwned);fixture.stdin.end();cleanup.fixtureExit=await exit;cleanup.fixtureErrors=errors();cleanup.fixturePid=fixture.pid;
 cleanup.fixtureAbsent=!ps().some(p=>p.pid===fixture.pid);cleanup.fixtureOwnedPids=[...fixtureOwned];cleanup.remainingFixtureOwned=ps().filter(p=>fixtureOwned.has(p.pid));
 if(origin)cleanup.portClosed=await new Promise(resolve=>{const u=new URL(origin),s=net.createConnection({host:u.hostname,port:+u.port});s.once('connect',()=>{s.destroy();resolve(false);});s.once('error',()=>resolve(true));});
 await writeFile(`${evidence}/results.json`,JSON.stringify({engine,baseline,sourceHash,sourceHashes,results,cleanup,failure:failure?.stack??null},null,2));
}
const failed=results.filter(r=>r.error);process.stdout.write(JSON.stringify({engine,pass:results.length-failed.length,fail:failed.length,failed:failed.map(r=>({key:r.key,error:r.error})),cleanup,fatal:failure?.stack??null},null,2)+'\n');
if(!results.length||failure||failed.length||!cleanup.browserClosed||cleanup.remainingOwned?.length||cleanup.profileProcesses?.length||!cleanup.profileRemoved||cleanup.fixtureExit?.code!==0||!cleanup.fixtureAbsent||cleanup.fixtureErrors||cleanup.remainingFixtureOwned?.length||!cleanup.portClosed)process.exitCode=1;

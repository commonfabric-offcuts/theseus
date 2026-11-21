// Real Core state, native topic/outcome menu doors, saved choice and Command-click parity.
import assert from 'node:assert/strict';
import {spawn,execFileSync} from 'node:child_process';
import {mkdir,mkdtemp,writeFile,rm,access} from 'node:fs/promises';
import net from 'node:net';
import {createHash,randomUUID} from 'node:crypto';
import {fixtureControl} from './fixture_control.mjs';
const playwright=await import(process.env.AIM_PLAYWRIGHT_CORE),engine=process.env.AIM_ENGINE??'chromium';
const evidence=process.argv[2],baseline=process.env.AIM_1033_PREFLIGHT==='1';await mkdir(evidence,{recursive:true});
const sourceHashes=JSON.parse(process.env.AIM_1033_SOURCE_HASHES??'{}');
const sourceHash=process.env.AIM_1033_SOURCE_SHA256;assert.match(sourceHash??'',/^[a-f0-9]{64}$/,'supply actual OutlineMenus hash');
const fixture=spawn('/usr/bin/python3',['-B','tests/fixtures/ui_http.py','--freshness','--live'],{cwd:process.env.AIM_1033_ROOT??process.cwd()});
const {control,exit,errors}=fixtureControl(fixture),results=[],cleanup={},owned=new Set(),fixtureOwned=new Set([fixture.pid]);
const ps=()=>execFileSync('/bin/ps',['-axo','pid=,ppid=,command='],{encoding:'utf8'}).trim().split('\n').map(line=>{const[,pid,ppid,command]=line.match(/^\s*(\d+)\s+(\d+)\s+(.*)$/);return{pid:+pid,ppid:+ppid,command};});
function children(set){const list=ps();for(let changed=true;changed;){changed=false;for(const p of list)if(set.has(p.ppid)&&!set.has(p.pid)){set.add(p.pid);changed=true;}}}
let browser,profile,origin,failure;
try{
 const facts=await control({method:'ready'});origin=facts.origin;children(fixtureOwned);
 await control({method:'navigation_workspaces',workspaces:[{id:'w1033',title:'Dim menu outcome',team:[]}]});
 await control({method:'navigation_topics',topics:[{id:'t1033',title:'Dim menu topic'}]});
 profile=await mkdtemp(`${evidence}/${engine}-profile-`);
 const persistent=await playwright[engine].launchPersistentContext(profile,{headless:true,...(engine==='chromium'?{executablePath:process.env.AIM_CHROME}:process.env.AIM_WEBKIT?{executablePath:process.env.AIM_WEBKIT}:{})});
 browser=persistent.browser();cleanup.engine=browser.browserType().name();cleanup.version=browser.version();for(const p of ps())if(p.command.includes(profile))owned.add(p.pid);children(owned);assert.ok(owned.size);
 await writeFile(`${evidence}/owned-start.json`,JSON.stringify({engine,profile,ownedPids:[...owned],fixturePid:fixture.pid,origin}));
 const headers={Authorization:`Bearer ${facts.token}`,Origin:origin};
 const view=async()=>{const response=await persistent.request.post(origin+'/api/view',{headers,data:{name:'rail_dimming',args:{}}});assert.equal(response.status(),200);const r=await response.json();assert.ok(!r.error);return r;};
 const boot=await(await persistent.request.get(origin+'/api/bootstrap',{headers})).json();
 const save=async value=>{const before=await view();const response=await persistent.request.post(origin+'/api/command',{headers,data:{v:1,instance_id:facts.instance_id,operation_id:randomUUID(),kind:'rail.dimming_set',target:{},expected:{dim_revision:before.dim_revision,authority:{authority_id:boot.authority.authority_id,authority_epoch:boot.authority.authority_epoch}},args:{value}}});const r=await response.json();assert.equal(r.status,'committed',JSON.stringify(r));return r;};
 const empty=()=>({version:1,selected:0,sets:[{focus:null,outcomes:[],topics:[]},{focus:null,outcomes:[],topics:[]}]});
 const cells=(baseline?[[1280,'bookends','light']]:[1280,390].flatMap(width=>['bookends','paper'].flatMap(look=>['light','dark'].map(theme=>[width,look,theme])))).filter(c=>!process.env.AIM_1033_FILTER||new RegExp(process.env.AIM_1033_FILTER).test(c.join('-')));
 for(const[width,look,colorScheme]of cells){
  await save(empty());const key=`${engine}-${width}-${look}-${colorScheme}`,phone=width<761,observations=[],pageErrors=[],leavingReadCancellations=[],requests=[];let error,cdp,leaving=false;
  const context=await browser.newContext({viewport:{width,height:1000},colorScheme,...(phone?{isMobile:true,hasTouch:true}:{})});
  await context.addInitScript(({look,instance,actor})=>{localStorage.setItem('theseus-look',look);localStorage.setItem(`aim-next.outline-open.${JSON.stringify([instance,actor])}`,JSON.stringify({w1:true,w1033:true}));window.dimTouches=[];document.addEventListener('pointerdown',e=>{if(e.pointerType==='touch')window.dimTouches.push({trusted:e.isTrusted,pointerType:e.pointerType});},true);},{look,instance:facts.instance_id,actor:facts.actor});
  const page=await context.newPage();page.setDefaultTimeout(8000);page.on('pageerror',e=>{const detail={message:e.message,stack:e.stack,phase:leaving?'leaving':'active'};if(engine==='webkit'&&leaving&&/^Fetch API cannot load \S+ due to access control checks\.$/.test(e.stack?.split('\n')[0]??''))leavingReadCancellations.push(detail);else pageErrors.push(detail);});page.on('request',r=>{if(r.url().endsWith('/api/command')){const e=r.postDataJSON();if(e.kind==='rail.dimming_set')requests.push(e);}});
  const saved=()=>page.waitForFunction(()=>document.querySelector('.rail-dim')?.title.includes('kept in Core'));
  const visit=async()=>{leaving=true;await page.goto(origin+'/?topic=t1');await page.locator('body[data-ready=true]').waitFor();leaving=false;if(phone)await page.locator('#rail-open').tap();await page.locator('#outline a[data-topic-id=t1033]').waitFor({state:'visible'});await saved();};
  const openMenu=async(row,label)=>{
   await row.scrollIntoViewIfNeeded();
   if(phone&&engine==='chromium'){
    cdp??=await context.newCDPSession(page);const b=await row.boundingBox();assert.ok(b);await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:b.x+Math.min(30,b.width/2),y:b.y+b.height/2,radiusX:1,radiusY:1,force:1}]});
    try{await page.getByRole('menuitem',{name:label,exact:true}).waitFor();}finally{await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});}
   }else if(phone){await row.focus();await page.keyboard.press('Shift+F10');}else {const b=await row.boundingBox();assert.ok(b);assert.equal(await page.evaluate(()=>document.getSelection()?.isCollapsed),true,'context menu begins without a text selection');await row.click({button:'right',position:{x:b.width-3,y:b.height/2}});}
   await page.getByRole('menuitem',{name:label,exact:true}).waitFor();
  };
  const choose=async label=>{const item=page.getByRole('menuitem',{name:label,exact:true});if(phone)await item.tap();else await item.click();await page.getByRole('menuitem',{name:label,exact:true}).waitFor({state:'hidden'});await saved();};
  try{
   await visit();const initialURL=page.url(),selected=await page.locator('#outline [aria-current=page]').evaluateAll(ns=>ns.map(n=>n.getAttribute('href')));
   const app=await page.evaluate(()=>[...document.scripts].find(s=>s.src.includes('/app.mjs')).src);
   for(const[file,hash]of Object.entries(sourceHashes)){const served=await(await page.request.get(new URL('./'+file,app).href)).body();assert.equal(createHash('sha256').update(served).digest('hex'),hash,'served '+file);}
   assert.equal(sourceHashes['outline-menus.mjs'],sourceHash);
   if(process.env.AIM_1033_EXISTING_HOLD_ESCAPE==='1'){
    const row=page.locator('#outline a[data-topic-id=t1033]');await openMenu(row,'Copy Link');
    observations.push({phase:'original held menu before Escape',focus:await page.evaluate(()=>({tag:document.activeElement?.tagName,words:document.activeElement?.textContent,menu:!!document.activeElement?.closest('[role=menu]')}))});
    await page.keyboard.press('Escape');
    observations.push({phase:'original held menu after Escape',menuVisible:await page.getByRole('menuitem',{name:'Copy Link',exact:true}).isVisible(),railOpen:await page.locator('#rail').evaluate(n=>n.classList.contains('open'))});
    assert.equal(await page.getByRole('menuitem',{name:'Copy Link',exact:true}).isVisible(),false,'inherited held menu Escape must close menu');
   }
   for(const[kind,selector,w,t]of [['topic','#outline a[data-topic-id=t1033]','w1','t1033'],['outcome','#outline a.ol-name[data-workspace-id=w1033]','w1033',null]]){
    let row=page.locator(selector);const before=await view();await openMenu(row,'Dim');assert.equal((await view()).dim_revision,before.dim_revision,'opening and releasing hold send no Dim write');assert.equal(page.url(),initialURL);
    const box=await page.getByRole('menuitem',{name:'Dim',exact:true}).boundingBox();assert.ok(box.width>0&&box.height>0);await page.screenshot({path:`${evidence}/${key}-${kind}-menu-dim.png`});await choose('Dim');
    const on=await view(),set=on.value.sets[on.value.selected-1];assert.equal(on.value.selected,1);assert.ok((t===null?set.outcomes:set.topics).some(x=>t===null?x[0]===w&&x[1]===true:x[0]===w&&x[1]===t&&x[2]===true));assert.equal(page.url(),initialURL);
    assert.equal(await row.evaluate(n=>n===document.activeElement),true,'shared close restores target row');
    observations.push({kind,phase:'menu Dim confirmed in Core',beforeRevision:before.dim_revision,core:on});
    await page.screenshot({path:`${evidence}/${key}-${kind}-dim.png`});
    await visit();row=page.locator(selector);await row.focus();await page.keyboard.press('Shift+F10');await page.getByRole('menuitem',{name:'Undim',exact:true}).waitFor();await page.screenshot({path:`${evidence}/${key}-${kind}-menu-undim.png`});await page.keyboard.press('Escape');await page.getByRole('menuitem',{name:'Undim',exact:true}).waitFor({state:'hidden'});assert.equal(await row.evaluate(n=>n===document.activeElement),true);assert.equal((await view()).dim_revision,on.dim_revision,'Escape has no kept write');
    await row.focus();await page.keyboard.press('Shift+F10');await page.getByRole('menuitem',{name:'Undim',exact:true}).waitFor();await choose('Undim');
    const off=await view();assert.ok(off.dim_revision>on.dim_revision);const offSet=off.value.sets[off.value.selected-1];assert.ok((t===null?offSet.outcomes:offSet.topics).some(x=>t===null?x[0]===w&&x[1]===false:x[0]===w&&x[1]===t&&x[2]===false));
    await row.click({modifiers:['Meta'],position:{x:20,y:10}});await saved();if(phone&&!await page.locator('#rail').evaluate(n=>n.classList.contains('open')))await page.locator('#rail-open').tap();const cmd=await view();assert.deepEqual(cmd.value,on.value,'Command-click and menu use the same kept value');
    await openMenu(row,'Undim');await choose('Undim');assert.equal(page.url(),initialURL);assert.deepEqual(await page.locator('#outline [aria-current=page]').evaluateAll(ns=>ns.map(n=>n.getAttribute('href'))),selected);
    observations.push({kind,phase:'reload Undim / keyboard Escape / Command-click parity confirmed',core:await view(),phoneDoor:phone?(engine==='chromium'?'native touch hold':'native Shift-F10 and tap'):'native right click'});
   }
   if(width===1280&&look==='bookends'&&colorScheme==='light'){
    let injected=false,conflict;await context.route('**/api/command',async route=>{const e=route.request().postDataJSON();if(e.kind!=='rail.dimming_set'||injected)return route.continue();injected=true;const other=structuredClone((await view()).value);other.sets[1].outcomes=[['w1033',true]];await save(other);const response=await route.fetch();conflict=await response.json();await route.fulfill({response});});
    const row=page.locator('#outline a[data-topic-id=t1033]');await openMenu(row,'Dim');await choose('Dim');await context.unroute('**/api/command');assert.equal(conflict.error?.code,'REVISION_CONFLICT');const core=await view();assert.ok(core.value.sets[1].outcomes.some(([w,on])=>w==='w1033'&&on));assert.ok(core.value.sets[0].topics.some(([w,t,on])=>w==='w1'&&t==='t1033'&&on));observations.push({phase:'actual Core conflict/rebase preserves unrelated second set',conflict,core});
   }
   if(phone&&engine==='chromium'){const touches=await page.evaluate(()=>dimTouches);assert.ok(touches.length&&touches.every(t=>t.trusted));observations.push({phase:'actual trusted phone touch doors',touches});}
   assert.deepEqual(pageErrors,[]);
  }catch(e){error=e.stack;observations.push({phase:'failure',url:page.url(),core:await view().catch(()=>null),body:await page.locator('body').innerText().catch(()=>null)});await page.screenshot({path:`${evidence}/${key}-failure.png`}).catch(()=>{});}
  results.push({key,error:error??null,observations,pageErrors,leavingReadCancellations,requests});await writeFile(`${evidence}/observations.json`,JSON.stringify(results,null,2));children(owned);await writeFile(`${evidence}/owned-latest.json`,JSON.stringify({engine,profile,ownedPids:[...owned],fixturePid:fixture.pid,origin}));leaving=true;await context.close();
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

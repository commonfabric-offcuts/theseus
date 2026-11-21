// Real isolated Core/HTTP and native input. No live records or physical-device claim.
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, writeFile, rm, access } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import net from 'node:net';
import { fixtureControl } from './fixture_control.mjs';
import { Api } from '../web/api.mjs';
const engines=await import(process.env.AIM_PLAYWRIGHT_CORE),engine=process.env.AIM_BROWSER??'chromium',out=process.argv[2];
await mkdir(out,{recursive:true});
const sourceFiles=['web/app.mjs','web/deck-page.mjs','web/notebook-page.mjs','web/notebook-sheet.mjs','web/notebook-rail-menu.mjs','web/outcome-references.mjs','web/outcome-page-layout.mjs','web/outline-menus.mjs','web/message-menu.mjs','web/api.mjs','web/live.mjs','web/outcome-refresh.mjs','web/aim.css','tests/fixtures/ui_http.py','tests/notebook_chat_1042_native.mjs'];
const sha=b=>createHash('sha256').update(b).digest('hex'),hashes=Object.fromEntries(await Promise.all(sourceFiles.map(async f=>[f,sha(await readFile(f))])));
await writeFile(out+'/source.json',JSON.stringify({head:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),hashes},null,2));
const fixture=spawn('/usr/bin/python3',['-B','tests/fixtures/ui_http.py','--freshness','--live']);
const {control,exit,errors}=fixtureControl(fixture),results=[],cleanup={},owned=new Set();
const ps=()=>execFileSync('/bin/ps',['-axo','pid=,ppid=,command='],{encoding:'utf8'}).trim().split('\n').map(line=>{const [,pid,ppid,command]=line.match(/^\s*(\d+)\s+(\d+)\s+(.*)$/);return{pid:+pid,ppid:+ppid,command};});
let browser,profile,origin,failure;
function retain(){const list=ps();for(let changed=true;changed;){changed=false;for(const p of list)if((owned.has(p.ppid)||profile&&p.command.includes(profile))&&!owned.has(p.pid)){owned.add(p.pid);changed=true;}}}
const closedPort=origin=>new Promise(resolve=>{const u=new URL(origin),s=net.createConnection({host:u.hostname,port:+u.port});s.once('connect',()=>{s.destroy();resolve(false);});s.once('error',()=>resolve(true));});
try{
 const facts=await control({method:'ready'});origin=facts.origin;
 const api=new Api(facts.token,(url,init)=>fetch(new URL(url,origin),{...init,headers:{...init?.headers,Origin:origin}})),bootstrap=await api.bootstrap();
 const agent=facts.agent;
 const coordinator=async workspace=>{const w=(await api.view('workspace',{workspace_id:workspace})).workspace;const r=await api.command({v:1,instance_id:facts.instance_id,operation_id:crypto.randomUUID(),kind:'workspace.coordinator_set',target:{workspace_id:workspace},expected:{authority:{authority_id:bootstrap.authority.authority_id,authority_epoch:bootstrap.authority.authority_epoch},workspace_revision:w.version},args:{actor_id:agent}});assert.equal(r.status,'committed',JSON.stringify(r));return r;};
 profile=await mkdtemp(out+'/'+engine+'-profile-');const context=await engines[engine].launchPersistentContext(profile,{headless:true,executablePath:engine==='chromium'?process.env.AIM_CHROME:process.env.AIM_WEBKIT});browser=context.browser();retain();assert.ok(owned.size);
 const cells=process.env.AIM_1042_PREFLIGHT==='phone'?[[390,'bookends','light']]:process.env.AIM_1042_PREFLIGHT==='1'?[[1280,'bookends','light']]:[1280,390].flatMap(width=>['bookends','paper'].flatMap(look=>['light','dark'].map(theme=>[width,look,theme])));
 for(const [width,look,colorScheme]of cells){
 const key=`${width}-${look}-${colorScheme}`,one='chat1042-one-'+key,empty='chat1042-empty-'+key;
 for(const [workspace,team]of[[one,[agent]],[empty,[]]]){
  const made=await control({method:'team_outcome',operation_id:workspace,workspace_id:workspace,title:workspace,team});assert.equal(made.status,'committed');
  assert.equal((await control({method:'outcome_reference',operation_id:workspace+'-page',workspace_id:workspace,item_id:workspace+'-page',title:'Notebook '+workspace,body:'## Researcher card\n\nHelp with these words.\n\n## Another card\n\nSeparate context.\n'})).status,'committed');
 }
 await coordinator(one);
 for(const [workspace,hasAgent]of[[one,true],[empty,false]]){
  const result={key,width,look,colorScheme,workspace,hasAgent,errors:[],leavingReadCancellations:[],checks:[],reads:[],commands:[],served:{}},context=await browser.newContext({viewport:{width,height:950},colorScheme,...(width<761?{isMobile:true,hasTouch:true}:{})});
  await context.addInitScript(look=>localStorage.setItem('theseus-look',look),look);const page=await context.newPage();page.setDefaultTimeout(6000);const jobs=[],press=el=>width<761?el.tap():el.click();let phase='active';
  page.on('pageerror',error=>{if(engine==='webkit'&&phase==='leaving'&&error.stack?.split('\n')[0]===`Fetch API cannot load ${origin}/api/view due to access control checks.`)result.leavingReadCancellations.push(error.stack);else result.errors.push(error.stack);});
  page.on('request',request=>{if(request.url().endsWith('/api/view'))result.reads.push(request.postDataJSON());if(request.url().endsWith('/api/command'))result.commands.push(request.postDataJSON());});
  page.on('response',response=>{const name='web/'+new URL(response.url()).pathname.split('/').at(-1);if(hashes[name])jobs.push(response.body().then(b=>result.served[name]=sha(b)).catch(error=>result.errors.push(error.stack)));});
  const check=async(name,run)=>{try{await run();result.checks.push({name,passed:true});}catch(error){result.checks.push({name,passed:false,error:error.stack});}};
  try{
   const room=(await api.view('conversation',{workspace_id:workspace})).conversation;assert.ok(room?.topic_id);result.coreTopic=(await api.view('topic',{topic_id:room.topic_id}));assert.equal(result.coreTopic.participants.filter(p=>p.kind==='agent'&&p.enabled).length,hasAgent?1:0);
   await page.goto(origin+'/?workspace='+workspace);await page.locator('body[data-ready=true]').waitFor();if(await page.locator('#outcome-tab-notes').isVisible())await press(page.locator('#outcome-tab-notes'));
   await press(page.locator('#outcome-references-list [data-id="'+workspace+'-page"]'));
   const sheet=page.locator('#notebook-sheet-dialog'),root=sheet.locator('.notebook-sheet-page:not([hidden])');await root.waitFor();
   await root.locator('.deck-card').first().waitFor();
   result.actualSurface='outcome main Notebook document -> NotebookSheet Cards -> per-card This card menu';
   await press(sheet.getByRole('button',{name:'This page',exact:true}));const pageMenu=page.getByRole('menu',{name:'This page',exact:true});await pageMenu.waitFor();result.pageMenuItems=await pageMenu.locator('[role^=menuitem]').allTextContents();await page.keyboard.press('Escape');
   const open=async()=>{await press(root.locator('.deck-card').first().locator('.deck-menu'));const menu=page.getByRole('menu',{name:'This card',exact:true});await menu.waitFor();return menu;};
   let menu=await open(),chat=menu.getByRole('menuitem',{name:/^Chat about this…/});assert.equal(await chat.isDisabled(),!hasAgent);
   if(hasAgent){
    await press(chat);const field=root.locator('.deck-ask-field');await field.waitFor();assert.equal(await field.evaluate(el=>el===document.activeElement),true);assert.equal(await root.locator('.deck-ask-agent').textContent(),agent);result.enabledFlowOpened=true;
    await field.fill('Unsaved question, never sent');await press(root.getByRole('button',{name:'Cancel',exact:true}));
   }else{
    result.disabledRow={text:await chat.textContent(),title:await chat.getAttribute('title')};
    await check('disabled outcome Chat explains its missing Conversation agent',async()=>assert.match(result.disabledRow.text+' '+(result.disabledRow.title??''),/No agent in this outcome.s Conversation yet/));
    await page.screenshot({path:out+'/'+key+'-empty-menu.png'});await page.keyboard.press('Escape');
    const topicRead=()=>page.waitForResponse(response=>{if(!response.url().endsWith('/api/view'))return false;const q=response.request().postDataJSON();return q.name==='topic'&&q.args?.topic_id===room.topic_id;}).then(response=>response.json()).then(value=>({value}),error=>({error}));
    let waiting=topicRead();
    result.join=await control({method:'outcome_change',operation_id:'1042-join-'+key,sender:facts.actor,workspace_id:workspace,member:agent,present:true});assert.equal(result.join.status,'committed');
    let read=await waiting;assert.ifError(read.error);result.teamOnlyRoom=read.value;assert.equal(read.value.participants.filter(p=>p.kind==='agent'&&p.enabled).length,0);
    menu=await open();assert.equal(await menu.getByRole('menuitem',{name:/^Chat about this…/}).isDisabled(),true);await page.keyboard.press('Escape');
    waiting=topicRead();result.coordinatorJoin=await coordinator(workspace);read=await waiting;assert.ifError(read.error);result.followedRoom=read.value;
    assert.equal(read.value.participants.filter(p=>p.kind==='agent'&&p.enabled).length,1);
    menu=await open();chat=menu.getByRole('menuitem',{name:/^Chat about this…/});assert.equal(await chat.isDisabled(),false);await press(chat);await root.locator('.deck-ask-field').waitFor();assert.equal(await root.locator('.deck-ask-agent').textContent(),agent);result.actualConversationCoordinatorJoinHealedWithoutReload=true;await press(root.getByRole('button',{name:'Cancel',exact:true}));
   }
   assert.equal(result.commands.filter(x=>x.kind==='message.post').length,0,'opening Chat sends nothing');assert.deepEqual(result.errors,[]);await Promise.all(jobs);for(const name of sourceFiles.filter(f=>f.startsWith('web/')))assert.equal(result.served[name],hashes[name],'actual served '+name);
  }catch(error){result.error=error.stack;await page.screenshot({path:out+'/'+workspace+'-failure.png',fullPage:true}).catch(()=>{});await writeFile(out+'/'+workspace+'-failure.html',await page.content().catch(()=>''));}
  results.push(result);await writeFile(out+'/observations.json',JSON.stringify(results,null,2));retain();phase='leaving';await context.close();
 }
 }
}catch(error){failure=error.stack;}
finally{
 if(browser){retain();await browser.close();}cleanup.browserClosed=browser?!browser.isConnected():true;fixture.stdin.end();cleanup.fixtureExit=await exit;cleanup.fixtureErrors=errors();const list=ps();cleanup.ownedPids=[...owned];cleanup.remainingOwned=list.filter(p=>owned.has(p.pid));cleanup.fixtureAbsent=!list.some(p=>p.pid===fixture.pid);cleanup.profileProcesses=profile?list.filter(p=>p.command.includes(profile)):[];
 if(profile&&cleanup.browserClosed&&!cleanup.remainingOwned.length&&!cleanup.profileProcesses.length)await rm(profile,{recursive:true});cleanup.profileAbsent=profile?await access(profile).then(()=>false,()=>true):true;cleanup.portClosed=origin?await closedPort(origin):null;
 await writeFile(out+'/results.json',JSON.stringify({engine,results,cleanup,failure},null,2));
}
assert.ok(cleanup.browserClosed&&cleanup.fixtureAbsent&&cleanup.profileAbsent&&cleanup.portClosed);assert.equal(cleanup.fixtureExit.code,0);assert.equal(cleanup.fixtureErrors,'');assert.deepEqual(cleanup.remainingOwned,[]);assert.deepEqual(cleanup.profileProcesses,[]);
for(const f of sourceFiles)assert.equal(sha(await readFile(f)),hashes[f],f+' unchanged');assert.equal(failure,undefined);assert.ok(results.length>0&&results.every(r=>!r.error&&r.checks.every(c=>c.passed)),'inspect native results');

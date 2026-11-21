//1052 actual empty Notebook and native creation/rail keys in isolated Core records.
import assert from 'node:assert/strict';
import {spawn,execFileSync} from 'node:child_process';
import {writeFileSync} from 'node:fs';
import {mkdir,mkdtemp,writeFile,readFile,rm,access} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import net from 'node:net';
import {fixtureControl} from './fixture_control.mjs';
const engines=await import(process.env.AIM_PLAYWRIGHT_CORE),engine=process.env.AIM_ENGINE??'chromium';
const selected=new RegExp(process.argv[3]??'');
const evidence=process.argv[2];await mkdir(evidence,{recursive:true});
const sourceFiles=['web/app.mjs','web/things-rail.mjs','web/rails.css','web/rail-dense.css','web/notebook-create.mjs','web/quick-create.mjs','web/key-tree.mjs','web/notebook-sheet.mjs','web/look.css','tests/fixtures/ui_http.py','tests/empty_notebook_1052_native.mjs'];
const hashes=Object.fromEntries(await Promise.all(sourceFiles.map(async path=>[path,createHash('sha256').update(await readFile(path)).digest('hex')])));
await writeFile(`${evidence}/source.json`,JSON.stringify({head:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),hashes},null,2));
for(const path of sourceFiles){const saved=`${evidence}/source/${path}`;await mkdir(saved.slice(0,saved.lastIndexOf('/')),{recursive:true});await writeFile(saved,await readFile(path));}
const savedResponses=new Set();
const fixture=spawn('/usr/bin/python3',['-B','tests/fixtures/ui_http.py','--freshness','--other-person']);
const {control,exit,errors}=fixtureControl(fixture),results=[],cleanup={},owned=new Set();
let browser,profile,origin,failure;
const processes=()=>execFileSync('/bin/ps',['-axo','pid=,ppid=,command='],{encoding:'utf8'}).trim().split('\n').map(line=>{const [,pid,ppid,command]=line.match(/^\s*(\d+)\s+(\d+)\s+(.*)$/);return {pid:+pid,ppid:+ppid,command};});
function retain(){const all=processes();for(let changed=true;changed;){changed=false;for(const p of all)if((owned.has(p.ppid)||profile&&p.command.includes(profile))&&!owned.has(p.pid)){owned.add(p.pid);changed=true;}}writeFileSync(`${evidence}/owned-processes.json`,JSON.stringify({profile,fixturePid:fixture.pid,ownedPids:[...owned]}));}

try {
 const facts=await control({method:'ready'});origin=facts.origin;await writeFile(`${evidence}/fixture.json`,JSON.stringify({origin,pid:fixture.pid}));
 profile=await mkdtemp(`${evidence}/${engine}-profile-`);const persistent=await engines[engine].launchPersistentContext(profile,{headless:true,...(engine==='chromium'?{executablePath:process.env.AIM_CHROME}:{})});browser=persistent.browser();retain();assert.ok(owned.size);
 for(const width of [320,375,390,1280])for(const look of ['bookends','paper']){
  const key=`${width}-${look}`;if(!selected.test(key))continue;
  const seeded=await control({method:'agent_topic',operation_id:`empty1052-${engine}-${key}`,title:'Empty Notebook1052',body:'A topic without Notebook pages.',team:true});
  const result={key,errors:[],requests:[],observations:[]},context=await browser.newContext({viewport:{width,height:900},hasTouch:width<=760,isMobile:width<=760,colorScheme:'light'});
  await context.addInitScript(look=>localStorage.setItem('theseus-look',look),look);const page=await context.newPage();page.setDefaultTimeout(9000);page.on('pageerror',e=>result.errors.push(e.stack));
  const served={},jobs=[];page.on('response',response=>{const path='web/'+new URL(response.url()).pathname.split('/').at(-1);if(Object.hasOwn(hashes,path)){const j=response.body().then(async b=>{served[path]=createHash('sha256').update(b).digest('hex');if(!savedResponses.has(path)){savedResponses.add(path);const saved=`${evidence}/served/${path}`;await mkdir(saved.slice(0,saved.lastIndexOf('/')),{recursive:true});await writeFile(saved,b);}});j.catch(()=>{});jobs.push(j);}});
  const views=new Set(),viewWaiters=[];let viewStarts=0;
  const viewDone=request=>{if(views.delete(request))for(const done of viewWaiters.splice(0))done();};page.on('requestfinished',viewDone);page.on('requestfailed',viewDone);
  const drainViews=async()=>{let rounds=0;for(;;){while(views.size)await new Promise(resolve=>viewWaiters.push(resolve));const before=viewStarts;await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));rounds++;if(!views.size&&viewStarts===before){(result.viewDrains??=[]).push({requests:viewStarts,pending:views.size,rounds});return;}}};
  page.on('request',request=>{if(new URL(request.url()).pathname==='/api/view'){views.add(request);viewStarts++;}try{const v=request.postDataJSON();if(v?.kind?.startsWith('memory.'))result.requests.push(v);}catch{}});
  const press=async node=>width<=760?node.tap():node.click();
  const ready=async()=>{if(page.url()!=='about:blank')await drainViews();await page.goto(origin+'/?topic='+seeded.topic_id);await page.locator('body[data-ready=true]').waitFor();if(width<=760)await press(page.locator('#things-open'));};
  const section=()=>page.locator('#things .things-sec[data-key=notebook]'),heading=()=>section().locator(':scope > summary'),pencil=()=>section().getByRole('button',{name:'New Notebook page',exact:true});
  const snapshot=async phase=>{const v=await section().evaluate(n=>({visible:!n.hidden,open:n.open,heading:n.querySelector('.things-section-name')?.textContent,pencils:n.querySelectorAll('.notebook-create:not([hidden])').length,tiles:[...n.querySelectorAll('.things-body *')].filter(n=>n.textContent==='No pages yet.').length,bodyElements:n.querySelector('.things-body').childElementCount,bodyText:n.querySelector('.things-body').textContent,bodyHeight:n.querySelector('.things-body').getBoundingClientRect().height,bodyBackground:getComputedStyle(n.querySelector('.things-body')).backgroundColor,active:document.activeElement.getAttribute('aria-label')||document.activeElement.className,overflow:document.documentElement.scrollWidth>innerWidth}));result.observations.push({phase,...v});return v;};
  try {
   const beforeCore=await control({method:'agent_view',actor:facts.actor,name:'memory_items',args:{owner_scope:{kind:'topic',id:seeded.topic_id}}});assert.equal(beforeCore.items.length,0);
   await ready();await section().waitFor();const empty=await snapshot('empty before any creation');assert.equal(empty.heading,'Notebook');assert.equal(empty.pencils,1);assert.equal(empty.overflow,false);
   await page.screenshot({path:`${evidence}/${key}-empty.png`,fullPage:true});
   await heading().focus();await page.keyboard.press('ArrowRight');assert.equal(await heading().locator('.things-disclosure').evaluate(n=>n===document.activeElement),true,'Right reaches disclosure');
   await page.keyboard.press('ArrowRight');assert.equal(await pencil().evaluate(n=>n===document.activeElement),true,'next Right reaches same pencil');
   await page.keyboard.press('ArrowLeft');assert.equal(await page.evaluate(()=>!!document.activeElement.closest('#main')),true,'Left reaches feed without a new stop');
   if(width<=760){assert.equal(await page.evaluate(()=>document.documentElement.hasAttribute('data-things-open')),false,'Left closes the phone rail');await press(page.locator('#things-open'));await section().waitFor();await page.waitForFunction(()=>getComputedStyle(document.getElementById('things')).transform==='none');}
   if(width<=760){await heading().focus();await page.keyboard.press('ArrowRight');await page.keyboard.press('ArrowRight');}else await pencil().focus();
   result.beforeReturn=await pencil().evaluate(n=>({focused:n===document.activeElement,focusVisible:n.matches(':focus-visible'),outline:getComputedStyle(n).outlineStyle,width:getComputedStyle(n).outlineWidth}));assert.equal(result.beforeReturn.focused,true,'pencil has focus before Return');assert.equal(result.beforeReturn.focusVisible,true,'native arrow modality gives the pencil its ring');await page.keyboard.press('Enter');const input=page.getByRole('textbox',{name:'New Notebook page title',exact:true});await input.waitFor();await page.keyboard.press('Escape');await input.waitFor({state:'detached'});assert.equal(await pencil().evaluate(n=>n===document.activeElement),true);assert.equal(result.requests.length,0,'opening/cancel sends no page write');
   await press(pencil());await input.waitFor();const title='Created1052 '+key;await input.fill(title);await input.press('Enter');const sheet=page.locator('#notebook-sheet-dialog[open]');await sheet.waitFor();
   const created=await control({method:'agent_view',actor:facts.actor,name:'memory_items',args:{owner_scope:{kind:'topic',id:seeded.topic_id}}});assert.equal(created.items.length,1);assert.equal(created.items[0].title,title);result.created=created.items[0];assert.equal(result.requests.filter(r=>r.kind==='memory.create').length,1);
   await press(sheet.locator('.notebook-sheet-close'));await sheet.waitFor({state:'hidden'});await ready();await section().waitFor();const row=section().locator(`a.row[href*="${created.items[0].id}"]`);await row.waitFor();assert.ok((await row.textContent()).includes(title),'kept page replaces empty state after reload');
   await row.focus();await page.keyboard.press('ArrowUp');assert.equal(await heading().evaluate(n=>n===document.activeElement),true,'row Up keeps the heading stop');
   await page.screenshot({path:`${evidence}/${key}-created.png`,fullPage:true});await snapshot('created and reloaded');
   await drainViews();await Promise.all(jobs);result.served=served;for(const [path,h]of Object.entries(served))assert.equal(h,hashes[path],path+' served');for(const path of sourceFiles.filter(p=>p.startsWith('web/')))assert.ok(served[path],path+' actually served');assert.deepEqual(result.errors,[]);
   assert.equal(empty.tiles,0,'empty Notebook has no placeholder tile');assert.equal(empty.bodyElements,0,'no replacement placeholder element');assert.equal(empty.bodyText,'');assert.equal(empty.bodyHeight,0,'empty Notebook paints no body capsule');result.passed=true;
  }catch(error){result.error=error.stack;await page.screenshot({path:`${evidence}/${key}-failure.png`,fullPage:true});await writeFile(`${evidence}/${key}-failure.html`,await page.content());}
  results.push(result);console.log(JSON.stringify({key,passed:result.passed,error:result.error?.split('\n')[0]}));await writeFile(`${evidence}/observations.json`,JSON.stringify(results,null,2));retain();await context.close();
 }
}catch(error){failure=error.stack;}
finally {
  if(browser){retain();await browser.close();}cleanup.disconnected=browser?!browser.isConnected():true;
  fixture.stdin.end();cleanup.fixtureExit=await exit;cleanup.fixtureErrors=errors();
  const ps=processes();cleanup.fixturePid=fixture.pid;cleanup.fixtureAbsent=!ps.some(p=>p.pid===fixture.pid);cleanup.ownedPids=[...owned];cleanup.remainingOwned=ps.filter(p=>owned.has(p.pid));cleanup.profileProcesses=profile?ps.filter(p=>p.command.includes(profile)):[];
  if(profile&&cleanup.disconnected&&!cleanup.remainingOwned.length&&!cleanup.profileProcesses.length)await rm(profile,{recursive:true});
  cleanup.profileAbsent=profile?await access(profile).then(()=>false,()=>true):null;
  cleanup.portClosed=origin?await new Promise(resolve=>{const u=new URL(origin),s=net.createConnection({host:u.hostname,port:+u.port});s.once('connect',()=>{s.destroy();resolve(false);});s.once('error',()=>resolve(true));}):null;
  await writeFile(`${evidence}/results.json`,JSON.stringify({engine,results,cleanup,failure},null,2));
}
assert.equal(cleanup.disconnected,true);assert.equal(cleanup.fixtureExit.code,0);assert.equal(cleanup.fixtureErrors,'');assert.equal(cleanup.fixtureAbsent,true);assert.equal(cleanup.portClosed,true);assert.equal(cleanup.profileAbsent,true);assert.deepEqual(cleanup.remainingOwned,[]);assert.deepEqual(cleanup.profileProcesses,[]);
for(const path of sourceFiles)assert.equal(createHash('sha256').update(await readFile(path)).digest('hex'),hashes[path]);
assert.equal(failure,undefined);assert.ok(results.length);assert.ok(results.every(r=>r.passed),'inspect retained failures');console.log(JSON.stringify({passed:results.length,cleanup}));

// Native pre-edit evidence for 1028. Uses scratch Core and existing card/page/thumbnail doors.
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
const sourceFiles=['web/app.mjs','web/aim.css','web/look.css','web/look-touch.css','web/rails.css','web/notebook-page.mjs','web/notebook-writing.mjs','web/notebook-sheet.mjs','web/deck-page.mjs','web/outcome-references.mjs','web/color-picker.mjs','web/card-details.mjs','aim_next/memory.py','aim_next/store.py','aim_next/migrations.py','tests/fixtures/ui_http.py','tests/notebook_colours_1028_preedit_native.mjs'];
const hashes=Object.fromEntries(await Promise.all(sourceFiles.map(async path=>[path,createHash('sha256').update(await readFile(path)).digest('hex')])));
await writeFile(`${evidence}/source.json`,JSON.stringify({head:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),hashes},null,2));
for(const path of sourceFiles){const saved=`${evidence}/source/${path}`;await mkdir(saved.slice(0,saved.lastIndexOf('/')),{recursive:true});await writeFile(saved,await readFile(path));}
const fixture=spawn('/usr/bin/python3',['-B','tests/fixtures/ui_http.py','--freshness','--other-person']);
const {control,exit,errors}=fixtureControl(fixture),results=[],cleanup={},owned=new Set();
let browser,profile,origin,failure;
const processes=()=>execFileSync('/bin/ps',['-axo','pid=,ppid=,command='],{encoding:'utf8'}).trim().split('\n').map(line=>{const [,pid,ppid,command]=line.match(/^\s*(\d+)\s+(\d+)\s+(.*)$/);return {pid:+pid,ppid:+ppid,command};});
function retain(){const all=processes();for(let changed=true;changed;){changed=false;for(const p of all)if((owned.has(p.ppid)||profile&&p.command.includes(profile))&&!owned.has(p.pid)){owned.add(p.pid);changed=true;}}writeFileSync(`${evidence}/owned-processes.json`,JSON.stringify({profile,fixturePid:fixture.pid,ownedPids:[...owned]}));}

const inspect = node=>node.evaluate(n=>{const s=getComputedStyle(n);return {classes:n.className,current:n.getAttribute('aria-current'),background:s.backgroundColor,edge:s.borderTopColor,ink:s.color,tint:s.getPropertyValue('--card-tint'),hover:s.getPropertyValue('--card-tint-hover')};});
try {
 const facts=await control({method:'ready'});origin=facts.origin;await writeFile(`${evidence}/fixture.json`,JSON.stringify({origin,pid:fixture.pid}));
 profile=await mkdtemp(`${evidence}/${engine}-profile-`);const persistent=await engines[engine].launchPersistentContext(profile,{headless:true,...(engine==='chromium'?{executablePath:process.env.AIM_CHROME}:{})});browser=persistent.browser();retain();assert.ok(owned.size);
 for(const width of [1280,390])for(const look of ['bookends','paper'])for(const scheme of ['light','dark']){
  const key=`${width}-${look}-${scheme}`;if(!selected.test(key))continue;
  const item=`baseline-1028-${engine}-${key}`,result={key,errors:[],missing:[]},context=await browser.newContext({viewport:{width,height:900},hasTouch:width<=760,isMobile:width<=760,colorScheme:scheme});
  assert.equal((await control({method:'outcome_reference',operation_id:item+'-create',item_id:item,title:item,body:'## Blue card\n\nWords kept.\n\n<!-- theseus-card: {"id":"c-11111111111111111111111111111111","aliases":[],"color":"blue"} -->\n\n## Plain card\n\nOther words.\n'})).status,'committed');
  await context.addInitScript(look=>localStorage.setItem('theseus-look',look),look);
  const page=await context.newPage();page.setDefaultTimeout(8000);page.on('pageerror',error=>result.errors.push(error.stack));const served={},jobs=[];
  page.on('response',response=>{const path='web/'+new URL(response.url()).pathname.split('/').at(-1);if(Object.hasOwn(hashes,path)){const job=response.body().then(bytes=>{served[path]=createHash('sha256').update(bytes).digest('hex');});job.catch(()=>{});jobs.push(job);}});
  const press=async target=>width<=760?target.tap():target.click();
  try{
   await page.goto(origin+'/?workspace=w1');await page.locator('body[data-ready=true]').waitFor();
   const tab=page.locator('#outcome-tab-notes');if(await tab.isVisible())await press(tab);
   const thumbnail=page.locator(`#outcome-references-list [data-id="${item}"]`);await thumbnail.waitFor();
   await thumbnail.click({button:'right'});await page.waitForTimeout(100);
   result.thumbnailMenu=await page.getByRole('menu',{name:'This page',exact:true}).count();
   if(!result.thumbnailMenu)result.missing.push('thumbnail page menu');await page.keyboard.press('Escape');
   await press(thumbnail);const dialog=page.locator('#notebook-sheet-dialog[open]');await dialog.waitFor();
   const more=dialog.getByRole('button',{name:'This page',exact:true});await press(more);
   result.pageColourDoor=await page.getByRole('menuitem',{name:'Set color',exact:true}).count();if(!result.pageColourDoor)result.missing.push('page Set color');
   await page.keyboard.press('Escape');const blue=dialog.locator('.deck-card.deck-tinted.agent-blue');await blue.waitFor();await page.mouse.move(2,2);result.blue=await inspect(blue);
   const expected=look==='paper'?['rgb(236, 241, 241)','rgb(231, 236, 236)']:['rgb(13, 32, 46)','rgb(18, 37, 51)'];
   if(!expected.includes(result.blue.background))result.missing.push('specified blue card fill');
   await page.screenshot({path:`${evidence}/${key}.png`});
   await Promise.all(jobs);result.served=served;for(const [path,hash]of Object.entries(served))assert.equal(hash,hashes[path],path+' served');
   assert.deepEqual(result.errors,[]);result.passed=result.missing.length===0;
  }catch(error){result.error=error.stack;await page.screenshot({path:`${evidence}/${key}-failure.png`,fullPage:true});await writeFile(`${evidence}/${key}-failure.html`,await page.content());}
  results.push(result);console.log(JSON.stringify(result));await writeFile(`${evidence}/observations.json`,JSON.stringify(results,null,2));retain();await context.close();
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

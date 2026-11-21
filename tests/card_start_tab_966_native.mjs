// Native card-start Tab gestures against scratch Core/HTTP; owned browser/fixture cleanup.
import assert from 'node:assert/strict';
import {spawn,execFileSync} from 'node:child_process';
import {mkdir,mkdtemp,writeFile,rm,access,readFile} from 'node:fs/promises';
import net from 'node:net';
import {createHash} from 'node:crypto';
import {resolve} from 'node:path';
import {fixtureControl} from './fixture_control.mjs';
const playwright=await import(process.env.AIM_PLAYWRIGHT_CORE),engine=process.env.AIM_ENGINE??'chromium';
const evidence=process.argv[2],baseline=process.env.AIM_966_BASELINE==='1';await mkdir(evidence,{recursive:true});
const fixture=spawn('/usr/bin/python3',['-B','tests/fixtures/ui_http.py','--freshness'],{cwd:process.env.AIM_966_ROOT??process.cwd()});
const source=await readFile(resolve(process.env.AIM_966_ROOT??process.cwd(),'web/deck-page.mjs')),sourceHash=createHash('sha256').update(source).digest('hex');
const {control,exit,errors}=fixtureControl(fixture),results=[],cleanup={},owned=new Set(),fixtureOwned=new Set([fixture.pid]);
const ps=()=>execFileSync('/bin/ps',['-axo','pid=,ppid=,command='],{encoding:'utf8'}).trim().split('\n').map(line=>{const[,pid,ppid,command]=line.match(/^\s*(\d+)\s+(\d+)\s+(.*)$/);return{pid:+pid,ppid:+ppid,command};});
function children(set){const list=ps();for(let changed=true;changed;){changed=false;for(const p of list)if(set.has(p.ppid)&&!set.has(p.pid)){set.add(p.pid);changed=true;}}}
let browser,profile,origin,failure,serial=0;
try{
 const facts=await control({method:'ready'});origin=facts.origin;children(fixtureOwned);
 profile=await mkdtemp(`${evidence}/${engine}-profile-`);
 const persistent=await playwright[engine].launchPersistentContext(profile,{headless:true,...(engine==='chromium'?{executablePath:process.env.AIM_CHROME}:{})});
 browser=persistent.browser();cleanup.engine=browser.browserType().name();cleanup.version=browser.version();assert.equal(cleanup.engine,engine);
 for(const p of ps())if(p.command.includes(profile))owned.add(p.pid);children(owned);assert.ok(owned.size);
 await writeFile(`${evidence}/owned-start.json`,JSON.stringify({engine,profile,ownedPids:[...owned],fixturePid:fixture.pid,origin}));
 const cells=baseline?[['full','','dark']]:[['full','','dark'],['full','paper','light'],['sheet','','light'],['sheet','paper','dark'],['dock','','dark'],['dock','paper','light']];
 for(const [surface,look,colorScheme]of cells.filter(c=>!process.env.AIM_966_SURFACE||c[0]===process.env.AIM_966_SURFACE)){
  const context=await browser.newContext({viewport:{width:1360,height:1000},colorScheme});
  await context.addInitScript(look=>{if(look)localStorage.setItem('theseus-look',look);},look);
  const page=await context.newPage(),pageErrors=[];page.setDefaultTimeout(4500);page.on('pageerror',e=>pageErrors.push(e.message));
  const root=()=>page.locator(surface==='full'?'#deck-page':'#notebook-sheet-dialog .notebook-sheet-page:not([hidden])'),editor=()=>root().locator('.deck-writing textarea');
  const snapshot=()=>editor().evaluate(f=>({value:f.value,start:f.selectionStart,end:f.selectionEnd,depth:+f.closest('.deck-writing').style.getPropertyValue('--depth'),focus:document.activeElement===f}));
  const current=item=>control({method:'agent_view',name:'memory_current',args:{item_id:item}});
  // Poll the real scratch Core over the fixture channel; no product handler used to make a gesture.
  const waitSaved=async(item,test)=>{const end=Date.now()+4500;let last;do{last=await current(item);if(test(last.body))return last;await page.waitForTimeout(25);}while(Date.now()<end);assert.fail('Saved Core body: '+last.body);};
  const fresh=async(body)=>{
   const item=`card966-${++serial}`;
   assert.equal((await control({method:surface==='dock'?'agent_page':'outcome_reference',topic_id:'t1',operation_id:item,item_id:item,title:'Card Tab '+serial,body})).status,'committed');
   await page.goto(`${origin}/?${surface==='full'?`cards=${item}&view=cards`:`topic=t1&page=${item}`}`);
   await page.waitForFunction(()=>document.body.dataset.ready==='true');
   const moduleURL=await page.evaluate(()=>new URL('./deck-page.mjs',[...document.scripts].find(s=>s.src.includes('/app.mjs')).src).href);
   assert.deepEqual(await (await page.request.get(moduleURL)).body(),source,'served source is the exact owned checkout');
   assert.equal(await page.evaluate(()=>document.documentElement.dataset.look??''),look);
   assert.equal(await page.evaluate(()=>matchMedia('(prefers-color-scheme: dark)').matches),colorScheme==='dark');
   if(surface!=='full'){
    await page.locator('#notebook-sheet-dialog[open]').waitFor();
    const dialog=page.locator('#notebook-sheet-dialog');
    if((await dialog.evaluate(el=>el.classList.contains('notebook-docked')))!==(surface==='dock')){
     await dialog.locator('.notebook-menu').click();await page.getByRole('menuitemcheckbox',{name:'Side by side',exact:true}).click();
    }
    assert.equal(await dialog.evaluate(el=>el.classList.contains('notebook-docked')),surface==='dock');
   }
   await root().locator('.deck-card').first().waitFor();
   await root().locator('.deck-card .deck-title').first().click();await editor().waitFor();
   await page.keyboard.press('Meta+a');await page.keyboard.press('ArrowRight');return item;
  };
  const check=async(name,act)=>{let error;try{await act();assert.deepEqual(pageErrors,[]);}catch(e){error=e.stack;await page.screenshot({path:`${evidence}/${engine}-${surface}-${look||'bookends'}-${name}.png`});}
   results.push({key:`${engine}-${surface}-${look||'bookends'}-${colorScheme}-${name}`,error:error??null,pageErrors:[...pageErrors]});await writeFile(`${evidence}/observations.json`,JSON.stringify(results,null,2));};
  await check('command-return-tab-new-card',async()=>{
   const item=await fresh('## Parent\n\nKept parent words.\n');
   await page.keyboard.press('Meta+Enter');assert.deepEqual(await snapshot(),{value:'',start:0,end:0,depth:0,focus:true});
   await page.keyboard.press('Tab');assert.deepEqual(await snapshot(),{value:'',start:0,end:0,depth:1,focus:true});
   await page.keyboard.type('New child');await page.keyboard.press('Escape');
   await waitSaved(item,b=>b.includes('### New child'));assert.match((await current(item)).body,/^## Parent\n\nKept parent words\.\n\n### New child\n$/);
   if(surface==='full')await page.reload();else await page.goto(`${origin}/?topic=t1&page=${item}`);
   await root().locator('.deck-card[data-index="1"]').waitFor();
   assert.equal(await root().locator('.deck-card[data-index="1"]').evaluate(el=>el.style.getPropertyValue('--depth')),'1');
  });
  await check('saved-card-children-caret-undo',async()=>{
   const body='## Parent\n\n## Card\n\n- one\n- two\n\n### Child\n\nKept child words.\n',item=await fresh(body);
   await page.keyboard.press('Escape');await page.keyboard.press('ArrowDown');await page.keyboard.press('Meta+Enter');
   await page.keyboard.press('Meta+a');await page.keyboard.press('ArrowLeft');assert.equal((await snapshot()).start,0);
   const before=await snapshot();await page.keyboard.press('Tab');assert.deepEqual(await snapshot(),{...before,depth:1});
   await waitSaved(item,b=>b.includes('### Card')&&b.includes('#### Child'));
   await page.keyboard.press('Shift+Tab');assert.deepEqual(await snapshot(),before);await waitSaved(item,b=>b===body);
   await page.keyboard.press('Tab');await page.keyboard.press('Escape');
   await page.keyboard.press('Meta+z');await waitSaved(item,b=>b===body);
  });
  await check('nonzero-line-indentation-control',async()=>{
   const body='## First\n\n- one\n- two\n',item=await fresh(body),before=await snapshot();
   assert.ok(before.start>0);await page.keyboard.press('Tab');
   assert.deepEqual(await snapshot(),{...before,value:'First\n- one\n  - two',start:before.start+2,end:before.end+2});
   await page.keyboard.press('Shift+Tab');assert.deepEqual(await snapshot(),before);await page.keyboard.press('Escape');await waitSaved(item,b=>b===body);
  });
  await check('first-card-boundaries-and-line-control',async()=>{
   const body='## First\n\n- one\n- two\n',item=await fresh(body);await page.keyboard.press('Meta+a');await page.keyboard.press('ArrowLeft');
   const before=await snapshot();await page.keyboard.press('Tab');assert.deepEqual(await snapshot(),before);
   await page.keyboard.press('Shift+Tab');assert.deepEqual(await snapshot(),before);
   await page.keyboard.press('Meta+a');await page.keyboard.press('ArrowRight');const line=await snapshot();await page.keyboard.press('Tab');
   assert.deepEqual(await snapshot(),{...line,value:'First\n- one\n  - two',start:line.start+2,end:line.end+2});
   await page.keyboard.press('Shift+Tab');assert.deepEqual(await snapshot(),line);await page.keyboard.press('Escape');await waitSaved(item,b=>b===body);
  });
  if(!baseline)await check('zero-selection-is-line',async()=>{
   const body='## Parent\n\n## Card\n\nWords.\n',item=await fresh(body);
   await page.keyboard.press('Meta+a');await page.keyboard.press('ArrowLeft');await page.keyboard.press('Shift+ArrowRight');const before=await snapshot();assert.equal(before.end,1);
   await page.keyboard.press('Tab');assert.deepEqual(await snapshot(),{...before,value:'  '+before.value,start:2,end:3});
   await page.keyboard.press('Shift+Tab');assert.deepEqual(await snapshot(),before);await page.keyboard.press('Escape');await waitSaved(item,b=>b===body);
  });
  if(!baseline&&surface==='full'&&!look)await check('phone-width-hardware-tab',async()=>{
   await page.setViewportSize({width:390,height:844});await fresh('## Parent\n');
   await page.keyboard.press('Meta+Enter');await page.keyboard.press('Tab');assert.deepEqual(await snapshot(),{value:'',start:0,end:0,depth:1,focus:true});
   await page.keyboard.press('Shift+Tab');assert.deepEqual(await snapshot(),{value:'',start:0,end:0,depth:0,focus:true});
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  });
  await context.close();
 }
}catch(e){failure=e;}
finally{
 if(browser){children(owned);await browser.close();cleanup.browserClosed=!browser.isConnected();}
 const after=ps();cleanup.ownedPids=[...owned];cleanup.remainingOwned=after.filter(p=>owned.has(p.pid));cleanup.profileProcesses=profile?after.filter(p=>p.command.includes(profile)):[];
 if(profile&&cleanup.browserClosed&&!cleanup.remainingOwned.length&&!cleanup.profileProcesses.length){await rm(profile,{recursive:true});cleanup.profileRemoved=await access(profile).then(()=>false,()=>true);}
 children(fixtureOwned);fixture.stdin.end();cleanup.fixtureExit=await exit;cleanup.fixtureErrors=errors();cleanup.fixturePid=fixture.pid;
 cleanup.fixtureAbsent=!ps().some(p=>p.pid===fixture.pid);cleanup.fixtureOwnedPids=[...fixtureOwned];cleanup.remainingFixtureOwned=ps().filter(p=>fixtureOwned.has(p.pid));
 if(origin)cleanup.portClosed=await new Promise(resolve=>{const u=new URL(origin),s=net.createConnection({host:u.hostname,port:+u.port});s.once('connect',()=>{s.destroy();resolve(false);});s.once('error',()=>resolve(true));});
 await writeFile(`${evidence}/results.json`,JSON.stringify({engine,baseline,sourceHash,results,cleanup,failure:failure?.stack??null},null,2));
}
const failed=results.filter(r=>r.error);process.stdout.write(JSON.stringify({engine,pass:results.length-failed.length,fail:failed.length,failed:failed.map(r=>({key:r.key,error:r.error})),cleanup,fatal:failure?.stack??null},null,2)+'\n');
if(failure||failed.length||!cleanup.browserClosed||cleanup.remainingOwned?.length||cleanup.profileProcesses?.length||!cleanup.profileRemoved||cleanup.fixtureExit?.code!==0||!cleanup.fixtureAbsent||cleanup.remainingFixtureOwned?.length||!cleanup.portClosed)process.exitCode=1;

// Native keyboard/focus/caret and scratch-Core persistence; no live records.
import assert from 'node:assert/strict';
import {spawn,execFileSync} from 'node:child_process';
import {mkdir,mkdtemp,writeFile,readFile,rm,access} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {resolve} from 'node:path';
import net from 'node:net';
import {fixtureControl} from './fixture_control.mjs';
const engine=process.env.AIM_ENGINE??'chromium',evidence=resolve(process.argv[2]);
const selected=new RegExp(process.env.AIM_1058_CASES??'.'),cellsSelected=new RegExp(process.env.AIM_1058_CELLS??'.');
const playwright=await import(process.env.AIM_PLAYWRIGHT_CORE);
await mkdir(evidence,{recursive:false});
const source=await readFile('web/deck-page.mjs'),hash=b=>createHash('sha256').update(b).digest('hex');
const fixture=spawn('/usr/bin/python3',['tests/fixtures/ui_http.py','--freshness'],{cwd:process.cwd(),env:process.env});
const {control,exit,errors}=fixtureControl(fixture),results=[],observations=[],cleanup={errors:[]},owned=new Set(),fixtureOwned=new Set([fixture.pid]);
const ps=()=>execFileSync('/bin/ps',['-axo','pid=,ppid=,comm='],{encoding:'utf8'}).trim().split('\n').flatMap(s=>{
 const [,pid,ppid,command]=s.match(/^\s*(\d+)\s+(\d+)\s+(.*)$/);
 // The observation command itself is not a browser/fixture descendant to
 // retain. Keep only PID/parent facts, never machine command arguments.
 return command==='/bin/ps'?[]:[{pid:Number(pid),ppid:Number(ppid)}];
});
const profilePids=()=>!profile?[]:execFileSync('/bin/ps',['-axo','pid=,command='],{encoding:'utf8'}).trim().split('\n').filter(s=>s.includes(profile)).map(s=>Number(s.trim().split(/\s+/)[0]));
const children=set=>{const rows=ps();for(let changed=true;changed;){changed=false;for(const p of rows)if(set.has(p.ppid)&&!set.has(p.pid)){set.add(p.pid);changed=true;}}};
const ownChildren=()=>{children(fixtureOwned);const all=new Set([process.pid]);children(all);for(const pid of all)if(pid!==process.pid&&!fixtureOwned.has(pid))owned.add(pid);children(owned);};
const retain=()=>{ownChildren();};
const current=item=>control({method:'agent_view',name:'memory_current',args:{item_id:item}});
const nested='## Parent\n\nKept parent.\n\n### Card\n\n- one\n- two\n\n#### Child\n\nKept child.\n\n## Last\n';
const outdented='## Parent\n\nKept parent.\n\n## Card\n\n- one\n- two\n\n### Child\n\nKept child.\n\n## Last\n';
let browser,profile,origin,fatal,watcher,serial=0;
try {
 const ready=await control({method:'ready'});origin=ready.origin;children(fixtureOwned);
 await writeFile(`${evidence}/fixture-ready.json`,JSON.stringify({pid:fixture.pid,ready,effectivePycache:process.env.PYTHONPYCACHEPREFIX},null,2));
 profile=await mkdtemp(`${evidence}/${engine}-profile-`);
 const persistent=await playwright[engine].launchPersistentContext(profile,{headless:true,...(engine==='chromium'?{executablePath:process.env.AIM_CHROME}:{})});
 browser=persistent.browser();assert.equal(browser.browserType().name(),engine);retain();assert.ok(owned.size);
 cleanup.engine=browser.browserType().name();cleanup.version=browser.version();watcher=setInterval(retain,500);
 const cells=[['full',1360,'','dark'],['full',1360,'paper','light'],['sheet',1360,'','light'],['sheet',1360,'paper','dark'],['dock',1360,'','dark'],['dock',1360,'paper','light'],['sheet',390,'','light']];
 for(const [surface,width,look,colorScheme]of cells){
  const cell=`${surface}-${width}-${look||'bookends'}-${colorScheme}`;if(!cellsSelected.test(cell))continue;
  const context=await browser.newContext({viewport:{width,height:width===390?844:1000},colorScheme});
  await context.addInitScript(look=>{if(look)localStorage.setItem('theseus-look',look);},look);
  const page=await context.newPage(),pageErrors=[];page.setDefaultTimeout(5000);page.on('pageerror',e=>pageErrors.push(e.stack??e.message));
  const host=()=>page.locator(surface==='full'?'#deck-page':'#notebook-sheet-dialog .notebook-sheet-page:not([hidden])');
  const field=()=>host().locator('.deck-writing textarea');
  const snap=()=>field().evaluate(f=>({value:f.value,start:f.selectionStart,end:f.selectionEnd,direction:f.selectionDirection,depth:Number(f.closest('.deck-writing').style.getPropertyValue('--depth')),focus:document.activeElement===f}));
  const atStart=async()=>{await page.keyboard.press('Meta+a');await page.keyboard.press('ArrowLeft');const s=await snap();assert.equal(s.start,0);assert.equal(s.end,0);};
  const atEnd=async()=>{await page.keyboard.press('Meta+a');await page.keyboard.press('ArrowRight');const s=await snap();assert.equal(s.start,s.value.length);assert.equal(s.end,s.value.length);};
  const saved=async(item,expected)=>{let last;for(let i=0;i<180;i++){last=await current(item);if(last.body===expected)return last;await page.waitForTimeout(25);}assert.equal(last.body,expected,'persisted scratch Core body');};
  const display=async(index)=>{await page.waitForFunction(sel=>!document.querySelector(sel+' .deck-writing textarea'),surface==='full'?'#deck-page':'#notebook-sheet-dialog .notebook-sheet-page:not([hidden])');
   const state=await page.evaluate(()=>({tag:document.activeElement.tagName,index:document.activeElement.dataset.index,card:document.activeElement.matches('.deck-card'),sheet:Boolean(document.activeElement.closest('#notebook-sheet-dialog')),editor:Boolean(document.activeElement.closest('.deck-writing'))}));
   observations.push({cell,kind:'display',state});assert.equal(state.card,true);assert.equal(Number(state.index),index);assert.equal(state.editor,false);if(surface!=='full')assert.equal(state.sheet,true);
  };
  const fresh=async(body=nested,index=1)=>{
   const item=`boundaries1058-${engine}-${++serial}`;
   const created=await control({method:surface==='dock'?'agent_page':'outcome_reference',topic_id:'t1',operation_id:item,item_id:item,title:'Boundary keys '+serial,body});assert.equal(created.status,'committed');
   await page.goto(`${origin}/?${surface==='full'?`cards=${item}&view=cards`:`topic=t1&page=${item}`}`);await page.waitForFunction(()=>document.body.dataset.ready==='true');
   const url=await page.evaluate(()=>new URL('./deck-page.mjs',[...document.scripts].find(s=>s.src.includes('/app.mjs')).src).href);
   // This separate byte probe does not exercise a pooled connection's idle
   // lifetime. Keep its own connection explicit; the browser's native app
   // requests retain the server's normal connection policy.
   const response=await page.request.get(url,{headers:{Connection:'close'}});assert.equal(response.status(),200);
   assert.equal(response.headers().connection,'close');
   const served=await response.body();assert.deepEqual(served,source,'served exact own DeckPage bytes');
   assert.equal(await page.evaluate(()=>document.documentElement.dataset.look??''),look);assert.equal(await page.evaluate(()=>matchMedia('(prefers-color-scheme: dark)').matches),colorScheme==='dark');
   if(surface!=='full'){
    const dialog=page.locator('#notebook-sheet-dialog[open]');await dialog.waitFor();
    if(await dialog.evaluate(n=>n.classList.contains('notebook-docked'))!==(surface==='dock')){
     await dialog.locator('.notebook-menu').click();await page.getByRole('menuitemcheckbox',{name:'Side by side',exact:true}).click();
    }
    assert.equal(await dialog.evaluate(n=>n.classList.contains('notebook-docked')),surface==='dock');
   }
   const row=host().locator(`.deck-card[data-index="${index}"]`);await row.waitFor();await row.locator('.deck-title').click();await field().waitFor();
   assert.equal((await snap()).focus,true);observations.push({cell,kind:'fresh',item,body,served:{url,sha256:hash(served)},snapshot:await snap()});return item;
  };
  const check=async(name,act)=>{
   if(!selected.test(name))return;let error;
   try{await act();assert.deepEqual(pageErrors,[]);}catch(e){error=e.stack;await page.screenshot({path:`${evidence}/${cell}-${name}-failure.png`}).catch(()=>{});}
   results.push({cell,name,error:error??null,pageErrors:[...pageErrors]});retain();
   await writeFile(`${evidence}/observations.json`,JSON.stringify({results,observations},null,2));
  };
  await check('left-leaf-display',async()=>{const item=await fresh('## Parent\n\n### Card\n\nKept words.\n\n## Last\n');await atStart();await page.keyboard.press('ArrowLeft');await display(1);await saved(item,'## Parent\n\n### Card\n\nKept words.\n\n## Last\n');});
  await check('right-leaf-display',async()=>{const body='## Parent\n\n### Card\n\nKept words.\n\n## Last\n',item=await fresh(body);await atEnd();await page.keyboard.press('ArrowRight');await display(1);await saved(item,body);});
  await check('end-outdent-stays-editing-persists-subtree',async()=>{
   const item=await fresh();await atEnd();const before=await snap();await page.keyboard.press('Shift+Tab');const after=await snap();
   observations.push({cell,kind:'outdent',before,after});assert.deepEqual(after,{...before,depth:0});await saved(item,outdented);
   await page.keyboard.type(' kept');await atEnd();await page.keyboard.press('ArrowRight');await display(1);const expected=outdented.replace('- two\n','- two kept\n');await saved(item,expected);
   // The sheet consumes its opening page query. Reopen its explicit page
   // address; a bare reload correctly returns to the underlying destination.
   if(surface==='full')await page.reload();else await page.goto(`${origin}/?topic=t1&page=${item}`);
   await host().locator('.deck-card[data-index="1"]').waitFor();
   assert.equal(await host().locator('.deck-card[data-index="1"]').evaluate(n=>Number(n.style.getPropertyValue('--depth'))),0);
   assert.equal(await host().locator('.deck-card[data-index="2"]').evaluate(n=>Number(n.style.getPropertyValue('--depth'))),1);assert.equal((await current(item)).body,expected);
  });
  await check('parents-display-without-fold-toggle',async()=>{
   await fresh(nested,0);await atStart();await page.keyboard.press('ArrowLeft');await display(0);assert.equal(await host().locator('.deck-card[data-index="1"]').isVisible(),true);
   await host().locator('.deck-card[data-index="0"] .deck-title').click();await field().waitFor();await atEnd();await page.keyboard.press('ArrowRight');await display(0);assert.equal(await host().locator('.deck-card[data-index="1"]').isVisible(),true);
   await page.keyboard.press('ArrowLeft');assert.equal(await host().locator('.deck-card[data-index="1"]').isVisible(),false);
   await host().locator('.deck-card[data-index="0"] .deck-title').click();await field().waitFor();await atEnd();await page.keyboard.press('ArrowRight');await display(0);assert.equal(await host().locator('.deck-card[data-index="1"]').isVisible(),false);
   await page.keyboard.press('ArrowRight');assert.equal(await host().locator('.deck-card[data-index="1"]').isVisible(),true);
  });
  await check('interior-and-selections-keep-writing',async()=>{
   await fresh();await atEnd();const before=await snap();await page.keyboard.press('ArrowLeft');assert.deepEqual(await snap(),{...before,start:before.start-1,end:before.end-1});
   await page.keyboard.press('ArrowRight');assert.equal((await snap()).focus,true);assert.equal((await snap()).end,before.end);
   await page.keyboard.press('Meta+a');const selected=await snap();assert.equal(selected.start,0);assert.equal(selected.end,selected.value.length);await page.keyboard.press('ArrowRight');assert.equal((await snap()).focus,true);
   await atStart();await page.keyboard.press('Shift+ArrowRight');assert.equal((await snap()).end,1);await page.keyboard.press('ArrowLeft');assert.equal((await snap()).focus,true);
   await page.keyboard.press('ArrowLeft');await display(1);
  });
  await check('end-selection-is-line-outdent',async()=>{
   const item=await fresh();await page.keyboard.press('Meta+a');const before=await snap();await page.keyboard.press('Shift+Tab');assert.deepEqual(await snap(),before);assert.equal((await current(item)).body,nested);
   await page.keyboard.press('Tab');assert.equal((await snap()).value,'  '+before.value.replaceAll('\n','\n  '));await page.keyboard.press('Shift+Tab');assert.deepEqual(await snap(),before);
  });
  await check('top-level-end-outdent-is-inert',async()=>{
   const item=await fresh(nested,0);await atEnd();const before=await snap();await page.keyboard.press('Shift+Tab');
   assert.deepEqual(await snap(),before);assert.equal((await current(item)).body,nested);
  });
  await check('fresh-end-outdent-keeps-writing-and-persists-placement',async()=>{
   const body='## Parent\n\n### Card\n\n## Last\n',item=await fresh(body);await page.keyboard.press('Meta+Enter');
   assert.equal((await snap()).value,'');assert.equal((await snap()).depth,1);await page.keyboard.type('Fresh');const before=await snap();
   await page.keyboard.press('Shift+Tab');assert.deepEqual(await snap(),{...before,depth:0});
   await page.keyboard.press('ArrowRight');await display(2);await saved(item,'## Parent\n\n### Card\n\n## Fresh\n\n## Last\n');
  });
  await check('start-Tab966-and-interior-line-controls',async()=>{
   const body='## Parent\n\n## Card\n\n- one\n- two\n',item=await fresh(body);await atStart();const first=await snap();
   await page.keyboard.press('Tab');assert.deepEqual(await snap(),{...first,depth:1});await saved(item,body.replace('## Card','### Card'));
   await page.keyboard.press('Shift+Tab');assert.deepEqual(await snap(),first);await saved(item,body);
   await atEnd();await page.keyboard.press('ArrowLeft');const interior=await snap();await page.keyboard.press('Tab');
   assert.deepEqual(await snap(),{...interior,value:interior.value.replace('- two','  - two'),start:interior.start+2,end:interior.end+2});
   await page.keyboard.press('Shift+Tab');assert.deepEqual(await snap(),interior);await page.keyboard.press('Escape');await saved(item,body);
  });
  await check('outdent-deck-Undo-remains-exact',async()=>{
   const item=await fresh();await atEnd();await page.keyboard.press('Shift+Tab');await saved(item,outdented);
   await page.keyboard.press('Escape');await display(1);await page.keyboard.press('Meta+z');await saved(item,nested);
  });
  for(const arrow of ['ArrowLeft','ArrowRight'])await check(`empty-fresh-${arrow}-finishes-without-blank-record`,async()=>{
   const item=await fresh();await page.keyboard.press('Meta+Enter');assert.equal((await snap()).value,'');
   await page.keyboard.press(arrow);await display(1);assert.equal((await current(item)).body,nested);
  });
  await check('top-level-end-outdent-keeps-exact-field',async()=>{const item=await fresh(nested,0);await atEnd();const before=await snap();await page.keyboard.press('Shift+Tab');assert.deepEqual(await snap(),before);await saved(item,nested);});
  await check('966-start-placement-and-interior-line-control',async()=>{
   const body='## Parent\n\n## Card\n\n- one\n- two\n\n## Last\n',item=await fresh(body);await atStart();const before=await snap();await page.keyboard.press('Tab');assert.deepEqual(await snap(),{...before,depth:1});await saved(item,body.replace('## Card','### Card'));
   await page.keyboard.press('Shift+Tab');assert.deepEqual(await snap(),before);await saved(item,body);
   await atEnd();await page.keyboard.press('ArrowLeft');const interior=await snap();await page.keyboard.press('Tab');const indented=await snap();assert.equal(indented.value,interior.value.replace('- two','  - two'));await page.keyboard.press('Shift+Tab');assert.deepEqual(await snap(),interior);
  });
  await check('fresh-end-outdent-retains-writing-and-saves',async()=>{
   const item=await fresh();await page.keyboard.press('Meta+Enter');assert.equal((await snap()).value,'');assert.equal((await snap()).depth,1);
   await page.keyboard.type('Fresh');const before=await snap();await page.keyboard.press('Shift+Tab');assert.deepEqual(await snap(),{...before,depth:0});await page.keyboard.press('ArrowRight');await display(3);
   await saved(item,nested.replace('## Last\n','## Fresh\n\n## Last\n'));
  });
  await check('left-finish-saves-real-typed-change',async()=>{
   const item=await fresh();await atEnd();await page.keyboard.type(' kept');await atStart();await page.keyboard.press('ArrowLeft');await display(1);await saved(item,nested.replace('- two\n','- two kept\n'));
  });
  await page.screenshot({path:`${evidence}/${cell}-final.png`});await context.close();
 }
}catch(e){fatal=e.stack;}
finally{
 const attempt=async(name,act)=>{try{await act();}catch(e){cleanup.errors.push({name,error:e.stack});}};
 clearInterval(watcher);retain();
 await attempt('Browser.close',async()=>{if(browser){await browser.close();cleanup.browserClosed=!browser.isConnected();}});
 await attempt('owned-process-absence',async()=>{
  for(let i=0;i<20;i++){const left=ps().filter(p=>owned.has(p.pid));if(!left.length)break;await new Promise(r=>setTimeout(r,50));}
  cleanup.ownedPids=[...owned];cleanup.remainingOwned=ps().filter(p=>owned.has(p.pid));assert.deepEqual(cleanup.remainingOwned,[]);
 });
 await attempt('profile',async()=>{assert.equal(cleanup.browserClosed,true);assert.deepEqual(cleanup.remainingOwned,[]);cleanup.profilePids=profilePids();assert.deepEqual(cleanup.profilePids,[]);if(profile){assert.ok(profile.startsWith(evidence+'/'));await rm(profile,{recursive:true});cleanup.profileRemoved=await access(profile).then(()=>false,()=>true);assert.equal(cleanup.profileRemoved,true);}});
 await attempt('fixture-EOF-and-exit',async()=>{children(fixtureOwned);fixture.stdin.end();cleanup.fixtureExit=await exit;cleanup.fixtureErrors=errors();assert.deepEqual(cleanup.fixtureExit,{code:0,signal:null});assert.equal(cleanup.fixtureErrors,'');});
 await attempt('fixture-processes',async()=>{cleanup.fixturePids=[...fixtureOwned];cleanup.remainingFixture=ps().filter(p=>fixtureOwned.has(p.pid));assert.deepEqual(cleanup.remainingFixture,[]);});
 await attempt('scratch-TCP',async()=>{if(origin){cleanup.origin=origin;cleanup.portClosed=await new Promise(resolve=>{const u=new URL(origin),s=net.createConnection({host:u.hostname,port:Number(u.port)});s.once('connect',()=>{s.destroy();resolve(false);});s.once('error',()=>resolve(true));});assert.equal(cleanup.portClosed,true);}});
 const failed=results.filter(r=>r.error),report={engine,sourceSha256:hash(source),requestedChromiumExecutable:engine==='chromium'?process.env.AIM_CHROME:null,results,observations,cleanup,fatal,pass:results.length-failed.length,fail:failed.length};
 await writeFile(`${evidence}/report.json`,JSON.stringify(report,null,2));console.log(JSON.stringify({engine,pass:report.pass,fail:report.fail,failed:failed.map(r=>({cell:r.cell,name:r.name,error:r.error})),cleanup,fatal},null,2));
 if(fatal||failed.length||!results.length||cleanup.errors.length)process.exitCode=1;
}

// Real isolated browser/Core proof. Run with AIM_ENGINE, AIM_PLAYWRIGHT_CORE,
// AIM_CHROME and an absolute evidence directory; filters only narrow named cells/cases.
import assert from 'node:assert/strict';
import {spawn,execFileSync} from 'node:child_process';
import {mkdir,mkdtemp,writeFile,readFile,rm,access} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {resolve,isAbsolute} from 'node:path';
import net from 'node:net';
import {fixtureControl} from './fixture_control.mjs';
const engine=process.env.AIM_ENGINE??'chromium',evidence=resolve(process.argv[2]);
assert.ok(['chromium','webkit'].includes(engine));assert.ok(isAbsolute(process.argv[2]));
const selected=new RegExp(process.env.AIM_1059_CASES??'.'),cellsSelected=new RegExp(process.env.AIM_1059_CELLS??'.');
const playwright=await import(process.env.AIM_PLAYWRIGHT_CORE);await mkdir(evidence,{recursive:false});
const hash=b=>createHash('sha256').update(b).digest('hex'),sources={};
for(const name of ['web/deck-page.mjs','web/aim.css','web/card-disclosure.mjs'])try{sources[name]=await readFile(name);}catch(error){if(error.code!=='ENOENT')throw error;}
const fixture=spawn('/usr/bin/python3',['tests/fixtures/ui_http.py','--freshness','--live'],{cwd:process.cwd(),env:process.env});
const {control,exit,errors}=fixtureControl(fixture),results=[],observations=[],leavingReadCancellations=[],cleanup={errors:[]},owned=new Set(),fixtureOwned=new Set([fixture.pid]);
const ps=()=>execFileSync('/bin/ps',['-axo','pid=,ppid=,comm='],{encoding:'utf8'}).trim().split('\n').flatMap(s=>{const [,pid,ppid,command]=s.match(/^\s*(\d+)\s+(\d+)\s+(.*)$/);return command==='/bin/ps'?[]:[{pid:Number(pid),ppid:Number(ppid)}];});
const children=set=>{const rows=ps();for(let changed=true;changed;){changed=false;for(const p of rows)if(set.has(p.ppid)&&!set.has(p.pid)){set.add(p.pid);changed=true;}}};
const retain=()=>{children(fixtureOwned);const all=new Set([process.pid]);children(all);for(const pid of all)if(pid!==process.pid&&!fixtureOwned.has(pid))owned.add(pid);children(owned);};
let browser,profile,origin,fatal,watcher,serial=0;
const current=item=>control({method:'agent_view',name:'memory_current',args:{item_id:item}});
const long=tag=>Array.from({length:14},(_,i)=>`${tag} paragraph ${i+1}: words kept in this card, with enough detail to read fully.`).join('\n\n')+'\n\nEND-TOKEN-1059';
const one=long('First'),two=long('Second'),body=`## Parent\n\n${one}\n\n### Child\n\nChild words.\n\n## Second\n\n${two}\n\n## Short\n\nTiny.\n`;
try{
 const ready=await control({method:'ready'});origin=ready.origin;children(fixtureOwned);
 await writeFile(`${evidence}/fixture-ready.json`,JSON.stringify({pid:fixture.pid,ready,effectivePycache:process.env.PYTHONPYCACHEPREFIX},null,2));
 profile=await mkdtemp(`${evidence}/${engine}-profile-`);
 const persistent=await playwright[engine].launchPersistentContext(profile,{headless:true,...(engine==='chromium'?{executablePath:process.env.AIM_CHROME}:{})});
 browser=persistent.browser();cleanup.version=browser.version();cleanup.profile=profile;retain();watcher=setInterval(retain,500);
 const cells=[['full',1360,false,'light'],['full',1360,true,'dark'],['sheet',1360,false,'dark'],['sheet',1360,true,'light'],['dock',1360,false,'light'],['dock',1360,true,'dark'],['sheet',390,false,'light'],['sheet',390,true,'dark']];
 for(const [surface,width,roomy,colorScheme]of cells){
  const cell=`${surface}-${width}-${roomy?'roomy':'compact'}-${colorScheme}`;if(!cellsSelected.test(cell))continue;
  const context=await browser.newContext({viewport:{width,height:width===390?844:1000},hasTouch:width===390,colorScheme});
  await context.addInitScript(roomy=>{
   localStorage.setItem('theseus-rail-roomy',roomy?'1':'0');globalThis.__1059Focus=[];
   const retain=e=>{const n=document.activeElement;globalThis.__1059Focus.push({at:performance.now(),type:e.type,key:e.key,tag:n?.tagName,class:n?.className,index:n?.closest?.('.deck-card')?.dataset.index});if(globalThis.__1059Focus.length>200)globalThis.__1059Focus.shift();};
   for(const type of ['focusin','focusout','keydown'])document.addEventListener(type,retain,true);
  },roomy);
  const page=await context.newPage(),pageErrors=[];let navigation=false;page.setDefaultTimeout(5000);
  page.on('pageerror',e=>{const error=e.stack??e.message;if(engine==='webkit'&&navigation&&error.split('\n')[0]===`Fetch API cannot load ${origin}/api/view due to access control checks.`)leavingReadCancellations.push({cell,error,boundary:'explicit navigation/close'});else pageErrors.push(error);});
  const tab=reverse=>page.keyboard.press(`${engine==='webkit'?'Alt+':''}${reverse?'Shift+':''}Tab`);
  const frames=()=>page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
  const selector=surface==='full'?'#deck-page':'#notebook-sheet-dialog .notebook-sheet-page:not([hidden])',host=()=>page.locator(selector);
  const row=i=>host().locator(`.deck-card[data-index="${i}"]`),pill=i=>row(i).locator('.deck-disclosure'),field=()=>host().locator('.deck-writing textarea');
  let item,url,probed=false;
  const snap=i=>row(i).evaluate(row=>{
   const words=row.querySelector('.deck-words'),button=row.querySelector('.deck-disclosure'),rect=words?.getBoundingClientRect();let tail=null;
   if(words){const walk=document.createTreeWalker(words,NodeFilter.SHOW_TEXT);let node;while(node=walk.nextNode())if(node.data.includes('END-TOKEN-1059')){const range=document.createRange();range.setStart(node,node.data.indexOf('END-TOKEN-1059'));range.setEnd(node,node.data.length);const r=range.getBoundingClientRect();tail={width:r.width,height:r.height,inside:r.top>=rect.top-1&&r.bottom<=rect.bottom+1&&r.left>=rect.left-1&&r.right<=rect.right+1};}}
   return {title:row.querySelector('.deck-title')?.textContent,words:words?.textContent,width:rect?.width,height:rect?.height,clientHeight:words?.clientHeight,scrollHeight:words?.scrollHeight,tail,
    paragraphs:words?[...words.children].map(p=>({tag:p.tagName,rect:JSON.parse(JSON.stringify(p.getBoundingClientRect())),margin:getComputedStyle(p).margin})):[],
    button:button?{label:button.textContent,hidden:button.hidden,expanded:button.getAttribute('aria-expanded'),focused:document.activeElement===button}:null,editing:Boolean(row.querySelector('textarea'))};
  });
  const until=async(probe,description)=>{let value;for(let i=0;i<150;i++){value=await probe();if(value)return value;await page.waitForTimeout(25);}assert.ok(value,description);};
  const requirePill=async i=>{
   try{await pill(i).waitFor({state:'visible',timeout:2500});}catch(error){assert.equal(await pill(i).count(),1,'an actually truncated display card offers Show all');assert.equal((await snap(i)).button.hidden,false,'an actually truncated display card offers Show all');throw error;}
  };
  const whole=async i=>{await until(async()=>{const s=await snap(i);return s.button?.expanded==='true'&&s.tail?.width>0&&s.tail?.height>0&&s.tail.inside&&s.scrollHeight<=s.clientHeight+1;},'the real last token lies inside the full unclipped card');};
  const saved=async expected=>{let got;for(let i=0;i<150;i++){got=await current(item);if(got.body===expected)return got;await page.waitForTimeout(25);}assert.equal(got.body,expected,'exact scratch Core body');};
  const fresh=async(text=body)=>{
   item=`disclosure1059-${engine}-${++serial}`;const made=await control({method:surface==='dock'?'agent_page':'outcome_reference',operation_id:item,item_id:item,topic_id:'t1',title:'Card disclosure '+serial,body:text});assert.equal(made.status,'committed');
   url=surface==='full'?`${origin}/?cards=${item}&view=cards`:`${origin}/?topic=t1&page=${item}`;
   // A visible first paint precedes NotebookSheet.open's final focus. Its
   // actual opening memory.read receipt follows that step; wait for it.
   const opened=surface==='full'?null:page.waitForResponse(response=>{if(!response.url().endsWith('/api/command'))return false;const request=response.request().postDataJSON();return request.kind==='memory.read'&&request.target?.item_id===item;},{timeout:9000}).then(r=>r.json()).then(r=>{assert.equal(r.status,'committed');return null;},error=>error);
   navigation=true;await page.goto(url);await page.waitForFunction(()=>document.body.dataset.ready==='true');await row(0).waitFor();
   if(opened){const error=await opened;if(error)throw error;}
   await page.evaluate(()=>document.fonts.ready);await frames();
   assert.equal(await page.evaluate(()=>document.documentElement.hasAttribute('data-rail-roomy')),roomy);
   if(surface!=='full'){
    const dialog=page.locator('#notebook-sheet-dialog[open]');await dialog.waitFor();
    if(await dialog.evaluate(n=>n.classList.contains('notebook-docked'))!==(surface==='dock')){await dialog.locator('.notebook-menu').click();await page.getByRole('menuitemcheckbox',{name:'Side by side',exact:true}).click();}
    assert.equal(await dialog.evaluate(n=>n.classList.contains('notebook-docked')),surface==='dock');
   }
   if(!probed){
    const app=await page.evaluate(()=>[...document.scripts].find(s=>s.src.includes('/app.mjs')).src);
    for(const [name,expected]of Object.entries(sources)){const response=await page.request.get(new URL('./'+name.slice(4),app).href,{headers:{Connection:'close'}});assert.equal(response.status(),200);const bytes=await response.body();assert.deepEqual(bytes,expected,'actual served '+name);observations.push({cell,kind:'served',path:name,sha256:hash(bytes)});}
    probed=true;
   }
   await frames();navigation=false;return item;
  };
  const reachPill=async i=>{
   // → reaches the existing card menu; native Tab from there reaches the new pill.
   await page.keyboard.press('ArrowRight');
   for(let n=0;n<24;n++){if(await pill(i).evaluate(b=>document.activeElement===b))return;await tab(false);}
   assert.equal((await snap(i)).button.focused,true,'native keys reach the disclosure button');
  };
  const press=async target=>width===390?target.tap():target.click();
  const view=async mode=>{
   if(surface==='full')await press(host().getByRole('button',{name:mode==='text'?'Text':'Cards',exact:true}));
   else{await press(page.locator('#notebook-sheet-dialog').getByRole('button',{name:'This page',exact:true}));await press(page.getByRole('menuitemcheckbox',{name:mode==='text'?'Show as text':'Show as cards',exact:true}));}
  };
  const moveFromPill=async()=>{
   await tab(true);assert.equal(await row(0).locator('.deck-menu').evaluate(n=>document.activeElement===n),true,'native Shift-Tab reaches this card menu');
   await page.keyboard.press('ArrowLeft');assert.equal(await row(0).evaluate(n=>document.activeElement===n),true,'native Left returns to this card');
   assert.equal(await row(0).getAttribute('aria-current'),'true');await page.keyboard.press('Meta+ArrowDown');
  };
  const check=async(name,act)=>{
   if(!selected.test(name))return;let error;
   try{await act();assert.deepEqual(pageErrors,[]);}catch(e){error=e.stack;observations.push({cell,kind:'failure-state',name,events:await page.evaluate(()=>globalThis.__1059Focus).catch(()=>[]),focus:await page.evaluate(()=>({tag:document.activeElement?.tagName,className:document.activeElement?.className,card:document.activeElement?.closest('.deck-card')?.dataset.index})).catch(()=>null),cards:await Promise.all([0,1,2,3].map(i=>snap(i).catch(()=>null)))});await page.screenshot({path:`${evidence}/${cell}-${name}-failure.png`}).catch(()=>{});}
   results.push({cell,name,error:error??null,pageErrors:[...pageErrors]});retain();await writeFile(`${evidence}/observations.json`,JSON.stringify({results,observations},null,2));
  };
  await check('whole-content-and-collapse',async()=>{
   await fresh();const before=await current(item);await requirePill(0);const folded=await snap(0);assert.equal(folded.button.label,'Show all');assert.ok(folded.scrollHeight>folded.clientHeight+1);
   await reachPill(0);await page.keyboard.press('Enter');await whole(0);const expanded=await snap(0);assert.ok(expanded.height>folded.height+20);assert.equal(expanded.button.focused,true);assert.equal(expanded.editing,false);assert.equal((await snap(2)).button.label,'Show all');
   await page.keyboard.press('Space');await until(async()=>(await snap(0)).button?.expanded==='false','native Space collapses the same card');assert.equal((await snap(0)).button.focused,true);
   assert.equal((await current(item)).source_ref.revision,before.source_ref.revision,'disclosure has no Core write');assert.equal((await current(item)).body,body);
   observations.push({cell,kind:'whole-and-collapse',folded,expanded,collapsed:await snap(0)});
  });
  await check('choice-focus-and-children-across-repaint',async()=>{
   await fresh();await requirePill(0);await reachPill(0);await page.keyboard.press('Enter');await whole(0);
   const seen=await current(item),changed=body.replace('Tiny.','Tiny changed.');const receipt=await control({method:'memory_revise',operation_id:item+'-remote',item_id:item,expected_revision:seen.source_ref.revision,title:seen.title,body:changed});assert.equal(receipt.status,'committed');
   await until(async()=>(await snap(3)).words?.includes('Tiny changed.'),'the unrelated remote card is repainted');await frames();await whole(0);assert.equal((await snap(0)).button.focused,true);assert.equal((await snap(2)).button.expanded,'false');
   await press(row(0).locator('.deck-fold'));assert.equal(await row(1).isVisible(),false);await whole(0);
   await press(row(0).locator('.deck-fold'));assert.equal(await row(1).isVisible(),true);await whole(0);await saved(changed);
  });
  await check('disappearing-focused-pill-follows-its-card',async()=>{
   await fresh();await requirePill(2);await reachPill(2);await page.keyboard.press('Enter');await whole(2);
   assert.equal(await host().locator('.deck-card[aria-current="true"]').getAttribute('data-index'),'0','focus is on a different card from the picked one');
   const seen=await current(item),changed=body.replace(two,'Tiny second.');
   const receipt=await control({method:'memory_revise',operation_id:item+'-shorter',item_id:item,expected_revision:seen.source_ref.revision,title:seen.title,body:changed});assert.equal(receipt.status,'committed');
   await until(async()=>(await snap(2)).words?.includes('Tiny second.'),'the focused disclosure card becomes untruncated after content repaint');
   await frames();
   assert.equal((await snap(2)).button.hidden,true);
   assert.equal(await page.evaluate(sel=>document.activeElement===document.querySelector(sel+' .deck-card[data-index="2"]'),selector),true,'the vanished pill returns focus to its own card, not the other picked card');
   const next=await current(item),again=changed.replace('Tiny.','Tiny changed again.');
   assert.equal((await control({method:'memory_revise',operation_id:item+'-again',item_id:item,expected_revision:next.source_ref.revision,title:next.title,body:again})).status,'committed');
   await until(async()=>(await snap(3)).words?.includes('Tiny changed again.'),'a second remote repaint arrives');
   await frames();
   assert.equal(await page.evaluate(sel=>document.activeElement===document.querySelector(sel+' .deck-card[data-index="2"]'),selector),true,'the same card keeps fallback focus through another actual repaint');
   assert.equal(await field().count(),0);await saved(again);observations.push({cell,kind:'vanished-pill-focus',snapshot:await snap(2)});
  });
  await check('choice-follows-real-card-move',async()=>{
   await fresh();await requirePill(0);await reachPill(0);await page.keyboard.press('Enter');await whole(0);
   await moveFromPill();
   await until(async()=>(await snap(1)).title==='Parent','the actual move puts the parent below Second');await whole(1);assert.equal((await snap(0)).button.expanded,'false');assert.equal((await snap(2)).title,'Child');
   await saved(`## Second\n\n${two}\n\n## Parent\n\n${one}\n\n### Child\n\nChild words.\n\n## Short\n\nTiny.\n`);
  });
  if(surface!=='dock')await check('width-reflow-and-short-card-absence',async()=>{
   await fresh('## Medium\n\n'+Array(32).fill('medium').join(' ')+'\n\n## Short\n\nTiny.\n');
   await page.setViewportSize({width:390,height:844});await requirePill(0);await reachPill(0);await page.keyboard.press('Enter');assert.equal((await snap(0)).button.expanded,'true');
   const narrow=await snap(0);observations.push({cell,kind:'reflow-narrow',snapshot:narrow});
   // At the existing standalone desktop shell breakpoint the main grid's
   // hidden rail leaves its first track narrow. Use a wider actual card at
   // 760px, and assert the measured growth rather than assuming viewport=card.
   await page.setViewportSize({width:760,height:1000});
   try{await until(async()=>!(await snap(0)).button|| (await snap(0)).button.hidden,'wide untruncated words have no pill');}
   finally{observations.push({cell,kind:'reflow-wide',snapshot:await snap(0)});}
   assert.ok((await snap(0)).width>narrow.width+100,'the real word box widens');
   assert.equal(await row(0).evaluate(r=>document.activeElement===r),true,'resize disappearance returns focus to the same row');
   assert.equal((await snap(1)).button.hidden,true);
   await page.setViewportSize({width:390,height:844});await until(async()=>(await snap(0)).button?.expanded==='true','the card keeps its choice when narrow again');
  });
  await check('editing-text-and-native-undo-stay-their-own',async()=>{
   await page.setViewportSize({width,height:width===390?844:1000});await fresh();await requirePill(0);await press(pill(0));await whole(0);await press(row(0).locator('.deck-title'));await field().waitFor();
   const original=await field().inputValue();await field().press('Meta+a');await field().press('ArrowRight');await page.keyboard.insertText(' EDIT1059');
   const before=await field().evaluate(f=>{globalThis.__1059Field=f;return {value:f.value,start:f.selectionStart,end:f.selectionEnd};});
   await press(pill(2));assert.deepEqual(await field().evaluate(f=>({value:f.value,start:f.selectionStart,end:f.selectionEnd})),before);assert.equal(await field().evaluate(f=>f===globalThis.__1059Field),true,'other disclosure preserves the actual native editor');
   await field().click();await page.keyboard.press('Meta+z');await until(async()=>await field().inputValue()===original,'native Undo still removes the actual edit');await page.keyboard.press('Escape');await until(async()=>!await field().count(),'Escape finishes editing');await whole(0);await saved(body);
   await view('text');await host().locator('.notebook-text').waitFor();await view('cards');await whole(0);await saved(body);
  });
  await check('duplicate-local-move-and-new-opening-lifetime',async()=>{
   const same=`## Same\n\n${one}\n\n## Same\n\n${one}\n\n## Short\n\nTiny.\n`;await fresh(same);await requirePill(0);await reachPill(0);await page.keyboard.press('Enter');await whole(0);
   await moveFromPill();await whole(1);assert.equal((await snap(0)).button.expanded,'false');await saved(same);
   navigation=true;await page.goto(url);await row(0).waitFor();await frames();navigation=false;await requirePill(0);assert.equal((await snap(0)).button.expanded,'false');assert.equal((await snap(1)).button.expanded,'false');assert.equal((await snap(2)).button.hidden,true);await saved(same);
  });
  await check('separate-open-page-choice-and-read-only',async()=>{
   await fresh();await requirePill(0);await reachPill(0);await page.keyboard.press('Enter');await whole(0);const before=await current(item),peer=await context.newPage();
   try{
    await peer.goto(`${origin}/?cards=${item}&view=cards`);await peer.locator('body[data-ready="true"]').waitFor();await peer.locator('#deck-page.deck-read-only').waitFor();
    assert.match(await peer.locator('#deck-page .deck-status').textContent(),/another tab/i);
    const other=i=>peer.locator(`#deck-page .deck-card[data-index="${i}"] .deck-disclosure`);await other(0).waitFor({state:'visible'});assert.equal(await other(0).getAttribute('aria-expanded'),'false');
    await other(2).press('Enter');assert.equal(await other(2).getAttribute('aria-expanded'),'true');
    assert.equal(await peer.locator('#deck-page .deck-card[data-index="2"] .deck-words').evaluate(words=>{const rect=words.getBoundingClientRect(),range=document.createRange(),node=words.lastChild;range.selectNodeContents(node);const tail=[...range.getClientRects()].at(-1);return words.scrollHeight<=words.clientHeight+1&&tail?.bottom<=rect.bottom+1;}),true,'the read-only page actually shows the whole second card');
    assert.equal(await other(0).getAttribute('aria-expanded'),'false');await page.bringToFront();await frames();await whole(0);assert.equal((await snap(2)).button.expanded,'false');
    assert.equal((await current(item)).body,before.body);assert.equal((await current(item)).source_ref.revision,before.source_ref.revision);observations.push({cell,kind:'actual-tab-lock-read-only-and-independent-choices'});
   }finally{await peer.close();await page.bringToFront();}
  });
  await page.screenshot({path:`${evidence}/${cell}-final.png`});navigation=true;await context.close();
 }
}catch(error){fatal=error.stack;}
finally{
 const attempt=async(name,act)=>{try{await act();}catch(error){cleanup.errors.push({name,error:error.stack});}};clearInterval(watcher);retain();
 await attempt('Browser.close',async()=>{if(browser){await browser.close();cleanup.browserClosed=!browser.isConnected();}});
 await attempt('owned-process-absence',async()=>{for(let i=0;i<20;i++){if(!ps().some(p=>owned.has(p.pid)))break;await new Promise(r=>setTimeout(r,50));}cleanup.ownedPids=[...owned];cleanup.remainingOwned=ps().filter(p=>owned.has(p.pid));assert.deepEqual(cleanup.remainingOwned,[]);});
 await attempt('profile',async()=>{assert.equal(cleanup.browserClosed,true);assert.deepEqual(cleanup.remainingOwned,[]);cleanup.profilePids=execFileSync('/bin/ps',['-axo','pid=,command='],{encoding:'utf8'}).trim().split('\n').filter(s=>profile&&s.includes(profile)).map(s=>Number(s.trim().split(/\s+/)[0]));assert.deepEqual(cleanup.profilePids,[]);if(profile){assert.ok(profile.startsWith(evidence+'/'));await rm(profile,{recursive:true});cleanup.profileRemoved=await access(profile).then(()=>false,()=>true);assert.equal(cleanup.profileRemoved,true);}});
 await attempt('fixture-EOF-and-exit',async()=>{children(fixtureOwned);fixture.stdin.end();cleanup.fixtureExit=await exit;cleanup.fixtureErrors=errors();assert.deepEqual(cleanup.fixtureExit,{code:0,signal:null});assert.equal(cleanup.fixtureErrors,'');});
 await attempt('fixture-processes',async()=>{cleanup.fixturePids=[...fixtureOwned];cleanup.remainingFixture=ps().filter(p=>fixtureOwned.has(p.pid));assert.deepEqual(cleanup.remainingFixture,[]);});
 await attempt('scratch-TCP',async()=>{if(origin){cleanup.origin=origin;cleanup.portClosed=await new Promise(resolve=>{const u=new URL(origin),s=net.createConnection({host:u.hostname,port:Number(u.port)});s.once('connect',()=>{s.destroy();resolve(false);});s.once('error',()=>resolve(true));});assert.equal(cleanup.portClosed,true);}});
 const failed=results.filter(r=>r.error),report={engine,sourceHashes:Object.fromEntries(Object.entries(sources).map(([p,b])=>[p,hash(b)])),requestedChromiumExecutable:engine==='chromium'?process.env.AIM_CHROME:null,results,observations,leavingReadCancellations,cleanup,fatal,pass:results.length-failed.length,fail:failed.length,limits:['desktop engines at390, no physical-device/native-IME/performance claim','WebKit uses its platform Alt+Tab / Alt+Shift+Tab button-navigation gestures; explicit navigation/close caller-abort errors are retained separately from active errors','width-reflow case applies to full/sheet only; fixed dock expansion tested by the other cases','process evidence is observed descendants sampled500ms, not complete instantaneous history']};
 await writeFile(`${evidence}/report.json`,JSON.stringify(report,null,2));
 await writeFile(`${evidence}/native.json`,JSON.stringify({engine,webkitVersion:engine==='webkit'?cleanup.version:null,results:results.map(r=>({...r,passed:!r.error})),observations,owned:{fixturePid:fixture.pid,origin,profile},browserClosed:cleanup.browserClosed,fixtureExitCode:cleanup.fixtureExit?.code,fixtureErrors:cleanup.fixtureErrors,teardown:cleanup.errors,teardownError:cleanup.errors.length?JSON.stringify(cleanup.errors):null,bodyError:fatal??null},null,2));
 console.log(JSON.stringify({engine,pass:report.pass,fail:report.fail,failed:failed.map(r=>({cell:r.cell,name:r.name,error:r.error})),cleanup,fatal},null,2));
 if(fatal||failed.length||!results.length||cleanup.errors.length)process.exitCode=1;
}

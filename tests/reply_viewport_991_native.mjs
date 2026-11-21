// Actual visual viewport shrink and native writing; no physical software-keyboard claim.
import assert from 'node:assert/strict';
import {spawn,execFileSync} from 'node:child_process';
import {mkdir,mkdtemp,writeFile,rm,access,readFile} from 'node:fs/promises';
import net from 'node:net';
import {createHash} from 'node:crypto';
import {resolve} from 'node:path';
import {fixtureControl} from './fixture_control.mjs';
const playwright=await import(process.env.AIM_PLAYWRIGHT_CORE),engine=process.env.AIM_ENGINE??'chromium';
const evidence=process.argv[2],baseline=process.env.AIM_991_BASELINE==='1',align993=process.env.AIM_993_ALIGN==='1';await mkdir(evidence,{recursive:true});
const fixture=spawn('/usr/bin/python3',['-B','tests/fixtures/ui_http.py','--freshness'],{cwd:process.env.AIM_991_ROOT??process.cwd()});
const source=await readFile(resolve(process.env.AIM_991_ROOT??process.cwd(),'web/compose-bar.mjs')),sourceHash=createHash('sha256').update(source).digest('hex');
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
 const cells=baseline?[[390,'','dark','card'],[390,'paper','light','pencil']]:['','paper'].flatMap(look=>['light','dark'].flatMap(theme=>['card','pencil','foot'].map(kind=>[390,look,theme,kind]))).concat([[390,'','dark','reader'],[390,'paper','light','reader'],[1280,'','dark','card'],[1280,'paper','light','pencil']]);
 for(const[width,look,colorScheme,kind]of cells){
  const key=`${engine}-${width}-${look||'bookends'}-${colorScheme}-${kind}`,n=++serial;
  const root=await control({method:'agent_message',operation_id:`991-root-${n}`,sender:facts.actor,whole_topic:true,post_args:{divergence_reason:'Independent991 viewport cell'},body:`Viewport writing ${n}`});assert.equal(root.status,'committed');
  const parent=await control({method:'agent_message',operation_id:`991-parent-${n}`,sender:facts.agent,reply_to:root.result.message_id,reply_without_quote:'Independent991 keyboard viewport fixture.',body:'A paragraph about the writing place. '.repeat(50)});assert.equal(parent.status,'committed');const id=parent.result.message_id;
  const context=await browser.newContext({viewport:{width,height:844},hasTouch:width===390,isMobile:width===390,colorScheme});
  await context.addInitScript(look=>{if(look)localStorage.setItem('theseus-look',look);globalThis.viewport991=[];for(const type of ['resize','scroll'])visualViewport.addEventListener(type,()=>viewport991.push({type,height:visualViewport.height,width:visualViewport.width,top:visualViewport.offsetTop,layout:innerHeight}));},look);
  const page=await context.newPage(),pageErrors=[];page.setDefaultTimeout(6000);page.on('pageerror',e=>pageErrors.push(e.message));let field,composer,error,before,first,second,typed,desktop;
  const snap=()=>field.evaluate(f=>{const r=n=>{const b=n.getBoundingClientRect();return{top:b.top,bottom:b.bottom,height:b.height};},root=f.closest('.composer'),box=f.closest('.field-box'),send=root.querySelector(':scope>.compose-send'),plus=root.querySelector(':scope>.plus-button'),shown=n=>n&&n.getClientRects().length;
   return{field:r(f),box:r(box),send:shown(send)?r(send):null,plus:shown(plus)?r(plus):null,foot:Math.max(box.getBoundingClientRect().bottom,...[send,plus].filter(shown).map(n=>n.getBoundingClientRect().bottom)),vv:{height:visualViewport.height,top:visualViewport.offsetTop,width:visualViewport.width,scale:visualViewport.scale},layout:innerHeight,scrollY,composerScroll:root.scrollTop,focus:document.activeElement===f,value:f.value,start:f.selectionStart,end:f.selectionEnd,events:[...viewport991]};});
  const frame=()=>page.evaluate(()=>new Promise(done=>requestAnimationFrame(()=>requestAnimationFrame(()=>requestAnimationFrame(done)))));
  const inside=s=>{assert.ok(s.foot<=s.vv.top+s.vv.height-4,`footer ${s.foot} exceeds visible bottom ${s.vv.top+s.vv.height}`);assert.equal(s.focus,true);if(align993&&(kind==='card'||kind==='foot')){assert.ok(Math.abs(s.vv.top+s.vv.height-s.foot-8)<=2,'993 footer rests8px above reported keyboard');assert.ok(s.box.top>=s.vv.top-1,'993 field top stays visible');}};
  try{
   await page.goto(origin+'/?topic=t1');await page.waitForFunction(()=>document.body.dataset.ready==='true');
   const app=await page.evaluate(()=>[...document.scripts].find(s=>s.src.includes('/app.mjs')).src);assert.deepEqual(await(await page.request.get(new URL('./compose-bar.mjs',app).href)).body(),source,'served exact source');
   if(kind==='card'||kind==='reader'){
    const words=page.locator(`.message-card[data-id="${id}"]`).locator(':scope>.message-preview');await words.click();composer=page.locator(`[id="reply-${id}-composer"]`);field=composer.locator('textarea');await field.waitFor();
    if(kind==='reader'){await words.click();await page.locator('#reader[open]').waitFor();composer=page.locator('#reader-composer');field=page.locator('#writing-body');}
   }else{if(kind==='pencil'){await page.locator('#new-message').click();await page.locator('#new-message-sheet[open]').waitFor();}composer=page.locator('#inline-composer');field=page.locator('#inline-writing-body');}
   await field.click();await page.keyboard.type('Writing above the keyboard.');await frame();
   if(kind==='card'||kind==='foot')await field.evaluate((f,align)=>{const root=f.closest('.composer'),send=root.querySelector(':scope>.compose-send');const bottom=align?260:visualViewport.offsetTop+visualViewport.height-12;window.scrollBy({top:Math.max(f.getBoundingClientRect().bottom,send.getBoundingClientRect().bottom)-bottom,behavior:'instant'});},align993&&width===390);
   await frame();before=await snap();assert.equal(before.focus,true);assert.equal(before.vv.width,width);
   if(width>760){
    await page.keyboard.type(' Still writing.');await frame();desktop=await snap();assert.equal(desktop.vv.height,before.vv.height);assert.equal(desktop.vv.top,before.vv.top);assert.equal(desktop.scrollY,before.scrollY);assert.equal(desktop.composerScroll,before.composerScroll);
   }else{
    await page.setViewportSize({width,height:430});await page.waitForFunction(h=>visualViewport.height<h,before.vv.height);await frame();first=await snap();assert.ok(first.events.some(e=>e.type==='resize'&&e.height<before.vv.height));inside(first);assert.equal(first.value,before.value);assert.deepEqual([first.start,first.end],[before.start,before.end]);
    await page.keyboard.type('\nMore writing.\nAnother line.\nStill here.');await frame();typed=await snap();inside(typed);assert.match(typed.value,/Still here\.$/);
    await page.setViewportSize({width,height:350});await page.waitForFunction(h=>visualViewport.height<h,first.vv.height);await frame();second=await snap();inside(second);assert.equal(second.value,typed.value);assert.deepEqual([second.start,second.end],[typed.start,typed.end]);
   }
   assert.deepEqual(pageErrors,[]);await page.screenshot({path:`${evidence}/${key}.png`});
  }catch(e){error=e.stack;await page.screenshot({path:`${evidence}/${key}-failure.png`}).catch(()=>{});}
  results.push({key,error:error??null,before,first,typed,second,desktop,pageErrors});await writeFile(`${evidence}/observations.json`,JSON.stringify(results,null,2));await context.close();
 }
}catch(e){failure=e;}
finally{
 if(browser){children(owned);await browser.close();cleanup.browserClosed=!browser.isConnected();}
 const after=ps();cleanup.ownedPids=[...owned];cleanup.remainingOwned=after.filter(p=>owned.has(p.pid));cleanup.profileProcesses=profile?after.filter(p=>p.command.includes(profile)):[];
 if(profile&&cleanup.browserClosed&&!cleanup.remainingOwned.length&&!cleanup.profileProcesses.length){await rm(profile,{recursive:true});cleanup.profileRemoved=await access(profile).then(()=>false,()=>true);}
 children(fixtureOwned);fixture.stdin.end();cleanup.fixtureExit=await exit;cleanup.fixtureErrors=errors();cleanup.fixturePid=fixture.pid;
 cleanup.fixtureAbsent=!ps().some(p=>p.pid===fixture.pid);cleanup.fixtureOwnedPids=[...fixtureOwned];cleanup.remainingFixtureOwned=ps().filter(p=>fixtureOwned.has(p.pid));
 if(origin)cleanup.portClosed=await new Promise(resolve=>{const u=new URL(origin),s=net.createConnection({host:u.hostname,port:+u.port});s.once('connect',()=>{s.destroy();resolve(false);});s.once('error',()=>resolve(true));});
 await writeFile(`${evidence}/results.json`,JSON.stringify({engine,baseline,align993,sourceHash,results,cleanup,failure:failure?.stack??null},null,2));
}
const failed=results.filter(r=>r.error);process.stdout.write(JSON.stringify({engine,pass:results.length-failed.length,fail:failed.length,failed:failed.map(r=>({key:r.key,error:r.error})),cleanup,fatal:failure?.stack??null},null,2)+'\n');
if(failure||failed.length||!cleanup.browserClosed||cleanup.remainingOwned?.length||cleanup.profileProcesses?.length||!cleanup.profileRemoved||cleanup.fixtureExit?.code!==0||!cleanup.fixtureAbsent||cleanup.remainingFixtureOwned?.length||!cleanup.portClosed)process.exitCode=1;

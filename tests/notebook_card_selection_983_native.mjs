// Actual app/native keyboard and pointer checks. Also runs unchanged against a
// historical worktree by launching this file with that worktree as cwd.
import assert from 'node:assert/strict';
import {spawn,execFileSync} from 'node:child_process';
import {mkdir,readFile,writeFile,access} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import net from 'node:net';
import {fixtureControl} from './fixture_control.mjs';
const {chromium}=await import(process.env.AIM_PLAYWRIGHT_CORE);
const evidence=process.argv[2],quick=process.argv.includes('--quick'),edges=process.argv.includes('--edges');
await mkdir(evidence,{recursive:true});
const records=[],failures=[],errors=[],marker=`theseus-983-${process.pid}`;
const check=async(name,act)=>{try{await act();records.push({name,pass:true});}catch(error){failures.push({name,error:error.stack});}};
const hashes={};for(const file of ['web/aim.css','web/look.css','web/deck-page.mjs','web/notebook-page.mjs','web/arrow-reach.mjs','tests/notebook_card_selection_983_native.mjs']){
 try{hashes[file]=createHash('sha256').update(await readFile(file)).digest('hex');}catch(error){if(error.code!=='ENOENT')throw error;}
}
records.push({engine:'chromium',version:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),hashes});
const child=spawn('/usr/bin/python3',['tests/fixtures/ui_http.py','--freshness','--live']);
const {control,exit}=fixtureControl(child);let browser,profile,facts,page;
const body='Opening.\n\n## First\n\nFirst words.\n\n## Second\n\nSecond words.\n\n## Third\n\nThird words.';
const snapshot=()=>page.locator('.deck-cards:visible').evaluate(el=>({
 selected:[...el.querySelectorAll('.deck-selected')].map(n=>Number(n.dataset.index)),
 picked:[...el.querySelectorAll('[aria-current=true]')].map(n=>Number(n.dataset.index)),
 paints:[...el.querySelectorAll('.deck-card')].map(n=>{const s=getComputedStyle(n);return{background:s.backgroundColor,border:s.borderTopColor};}),
 count:el.parentElement.querySelector('.deck-count')?.textContent,
 editing:!!el.querySelector('.deck-writing'),focus:document.activeElement?.outerHTML.slice(0,180)
}));
try{
 facts=await control({method:'ready'});
 browser=await chromium.launch({headless:true,executablePath:process.env.AIM_CHROME,args:['--enable-automation',`--${marker}`]});
 records.push({actualEngine:browser.browserType().name(),browserVersion:browser.version()});assert.equal(browser.browserType().name(),'chromium');
 const cdp=await browser.newBrowserCDPSession();profile=(await cdp.send('Browser.getBrowserCommandLine')).arguments.find(x=>x.startsWith('--user-data-dir='))?.slice(16);await cdp.detach();assert.ok(profile);
 await writeFile(evidence+'/ownership.json',JSON.stringify({marker,profile,fixturePid:child.pid,origin:facts.origin},null,2));
 const cells=edges?[]:quick?[['sheet','Bookends','light'],['sheet','Paper','light']]:['full','sheet','dock'].flatMap(surface=>['Bookends','Paper'].flatMap(look=>['light','dark'].map(theme=>[surface,look,theme])));
 for(const [surface,look,theme]of cells){
  const key=[surface,look,theme].join('-'),item='note983-'+key;
  assert.equal((await control({method:'outcome_reference',operation_id:item,item_id:item,title:'Selection source',body})).status,'committed');
  const topicId=(await control({method:'agent_view',name:'conversation',args:{workspace_id:'w1'}})).conversation.topic_id;
  const context=await browser.newContext({viewport:{width:surface==='dock'?1440:surface==='full'?1280:1100,height:1000},colorScheme:theme});page=await context.newPage();page.setDefaultTimeout(10000);page.on('pageerror',e=>errors.push({key,error:e.message}));
  await page.goto(facts.origin+'/?topic='+topicId);await page.waitForFunction(()=>document.body.dataset.ready==='true');
  const lookButton=page.getByRole('button',{name:look,exact:true});
  if(await lookButton.count())await lookButton.click();else records.push({key,lookUnavailable:true});
  await page.goto(facts.origin+(surface==='full'?`/?cards=${item}&view=cards`:`/?topic=${topicId}&page=${item}`));await page.waitForFunction(()=>document.body.dataset.ready==='true');
  const rows=page.locator((surface==='full'?'#deck-page':'#notebook-sheet-dialog')+' .deck-card');await rows.first().waitFor();
  await rows.first().locator('.deck-title').click();
  if(await page.locator('.deck-writing:visible').count())await page.keyboard.press('Escape');
  await page.keyboard.press('ArrowDown');const idle=await snapshot();await page.keyboard.press('ArrowUp');
  await page.keyboard.press('Shift+ArrowDown');const two=await snapshot();records.push({key,phase:'shift-down',idle,two});
  await check(key+' native Shift-Down extends existing state',async()=>assert.deepEqual(two.selected,[0,1]));
  await check(key+' selected noncurrent card visibly differs from idle',async()=>assert.notDeepEqual(two.paints[0],idle.paints[0]));
  await page.screenshot({path:evidence+'/'+key+'-selected.png',fullPage:true});
  await page.keyboard.press('Shift+ArrowDown');await check(key+' native Shift-Down extends to third',async()=>assert.deepEqual((await snapshot()).selected,[0,1,2]));
  await page.keyboard.press('Shift+ArrowUp');await check(key+' reverse Shift-Up shrinks range',async()=>assert.deepEqual((await snapshot()).selected,[0,1]));
  await page.keyboard.press('Shift+ArrowUp');await check(key+' return to anchor ends range',async()=>assert.deepEqual((await snapshot()).selected,[]));
  await rows.nth(2).locator('.deck-title').click({modifiers:['Meta']});
  await check(key+' native Cmd-click adds a separate card',async()=>assert.deepEqual((await snapshot()).selected,[0,2]));
  await rows.nth(2).locator('.deck-title').click({modifiers:['Meta']});
  await check(key+' native Cmd-click removes that card',async()=>assert.deepEqual((await snapshot()).selected,[]));
  await page.keyboard.press('Shift+ArrowDown');await page.keyboard.press('ArrowDown');
  await check(key+' plain arrow ends selection',async()=>assert.deepEqual((await snapshot()).selected,[]));
  await rows.first().locator('.deck-title').click();const field=page.locator('.deck-writing:visible textarea');
  await field.waitFor();await field.press('Home');await field.press('Shift+ArrowDown');
  await check(key+' editing keeps Shift-arrows in text',async()=>{assert.equal(await page.locator('.deck-selected').count(),0);assert.equal(await field.evaluate(el=>el.selectionEnd>el.selectionStart),true);});
  await page.keyboard.press('Escape');await context.close();
 }
 if(edges)for(const width of [1440,390])for(const look of ['Bookends','Paper']){
  const key=`edges-${width}-${look}`,item='note983-'+key;
  const foldedBody='## Parent\n\nParent words.\n\n### Child\n\nHidden words.\n\n## Second\n\nSecond words.\n\n## Third\n\nThird words.';
  assert.equal((await control({method:'outcome_reference',operation_id:item,item_id:item,title:'Selection edges',body:foldedBody})).status,'committed');
  const topicId=(await control({method:'agent_view',name:'conversation',args:{workspace_id:'w1'}})).conversation.topic_id;
  const context=await browser.newContext({viewport:{width:width===390?1100:width,height:1000},hasTouch:width===390,isMobile:width===390});
  page=await context.newPage();page.setDefaultTimeout(10000);page.on('pageerror',e=>errors.push({key,error:e.message}));
  await page.goto(facts.origin+'/?topic='+topicId);await page.waitForFunction(()=>document.body.dataset.ready==='true');
  await page.getByRole('button',{name:look,exact:true}).click();
  if(width===390)await page.setViewportSize({width,height:1000});
  records.push({key,chosenLook:await page.locator('html').getAttribute('data-look'),coarse:await page.evaluate(()=>matchMedia('(pointer: coarse)').matches)});
  const route=facts.origin+`/?topic=${topicId}&page=${item}`;await page.goto(route);await page.waitForFunction(()=>document.body.dataset.ready==='true');
  const rows=page.locator('#notebook-sheet-dialog .deck-card');await rows.first().locator('.deck-title').click();await page.keyboard.press('Escape');await page.keyboard.press('ArrowLeft');await page.keyboard.press('Shift+ArrowDown');
  await check(key+' folded children stay outside native selection',async()=>assert.deepEqual((await snapshot()).selected,[0,2]));
  await check(key+' actual count names two selected',async()=>assert.match(await page.locator('.deck-count:visible').innerText(),/2 selected/));
  await rows.nth(3).locator('.deck-words').click({modifiers:['Meta']});
  await check(key+' body modifier-click adds to existing range',async()=>assert.deepEqual((await snapshot()).selected,[0,2,3]));
  if(width>760){
   const before=(await snapshot()).selected;await rows.nth(2).locator('.deck-title').click({modifiers:['Control']});await page.getByRole('menu',{name:'This card'}).waitFor();
   await check(key+' Mac Control-click keeps the card menu and selection',async()=>assert.deepEqual((await snapshot()).selected,before));await page.keyboard.press('Escape');
  }
  await page.screenshot({path:evidence+'/'+key+'-selected.png',fullPage:true});
  const held=page;page=await context.newPage();await page.setViewportSize({width,height:1000});page.setDefaultTimeout(10000);page.on('pageerror',e=>errors.push({key,error:e.message}));await page.goto(route);await page.waitForFunction(()=>document.body.dataset.ready==='true');await page.locator('.deck-read-only').waitFor();
  await page.locator('.deck-card').first().locator('.deck-title').click();await page.keyboard.press('Shift+ArrowDown');
  await check(key+' actual second-tab readonly page still selects',async()=>{assert.equal(await page.locator('.deck-writing').count(),0);assert.equal((await snapshot()).selected.length,2);});
  await held.close();await context.close();
 }
 assert.deepEqual(errors,[]);
}catch(error){failures.push({fatal:error.stack});if(page&&!page.isClosed())await page.screenshot({path:evidence+'/failure.png',fullPage:true}).catch(()=>{});}
finally{
 if(browser){
  const rows=execFileSync('ps',['-axo','pid=,ppid=,command='],{encoding:'utf8'}).split('\n').map(line=>{const m=/^\s*(\d+)\s+(\d+)\s+(.*)$/.exec(line);return m&&{pid:+m[1],parent:+m[2],command:m[3]};}).filter(Boolean);
  const owned=new Set(rows.filter(r=>r.command.includes(marker)||profile&&r.command.includes(profile)).map(r=>r.pid));for(let n=0;n<rows.length;n++)for(const r of rows)if(owned.has(r.parent))owned.add(r.pid);
  await browser.close();const live=new Set(execFileSync('ps',['-axo','pid='],{encoding:'utf8'}).trim().split(/\s+/).map(Number));const remaining=[...owned].filter(p=>live.has(p));const profileAbsent=await access(profile).then(()=>false,e=>{if(e.code==='ENOENT')return true;throw e;});
  records.push({browserClosed:!browser.isConnected(),ownedPids:[...owned],remaining,profile,profileAbsent});assert.deepEqual(remaining,[]);assert.equal(profileAbsent,true);
 }
 child.stdin.end();const ended=await exit;let absent=false;try{process.kill(child.pid,0);}catch(e){absent=e.code==='ESRCH';}
 const portClosed=!facts||await new Promise(resolve=>{const s=net.connect(new URL(facts.origin).port,'127.0.0.1');s.on('connect',()=>{s.destroy();resolve(false);});s.on('error',()=>resolve(true));s.setTimeout(1000,()=>{s.destroy();resolve(false);});});
 records.push({fixture:ended,fixturePid:child.pid,absent,portClosed,errors,failures});await writeFile(evidence+'/results.json',JSON.stringify(records,null,2));assert.deepEqual(ended,{code:0,signal:null});assert.equal(absent,true);assert.equal(portClosed,true);
}
if(failures.length){process.stderr.write(JSON.stringify(failures,null,2)+'\n');process.exitCode=1;}

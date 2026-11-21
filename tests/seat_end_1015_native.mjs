// Actual native Team gestures, isolated HTTP/Core/runner, synthetic app-server.
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fixtureControl } from './fixture_control.mjs';
const { chromium } = await import(process.env.AIM_PLAYWRIGHT_CORE);
const root=path.resolve(path.dirname(new URL(import.meta.url).pathname),'..');
const out=path.resolve(process.argv[2]);await mkdir(out,{recursive:true});
const fixture=spawn('/usr/bin/python3',['-I',path.join(root,'tests/fixtures/headless_seat_1002.py'),path.join(out,'fixture')],{stdio:['pipe','pipe','pipe']});
const channel=fixtureControl(fixture), result={cases:[],errors:[]}, pids=new Set();
let browser,profile,tracker;
const present=pid=>{try{process.kill(pid,0);return true;}catch(e){if(e.code==='ESRCH')return false;throw e;}};
const processes=()=>execFileSync('/bin/ps',['-axo','pid=,ppid=,command='],{encoding:'utf8'}).split('\n').map(line=>{
 const m=line.trim().match(/^(\d+)\s+(\d+)\s+(.*)$/);return m&&{pid:+m[1],parent:+m[2],command:m[3]};}).filter(Boolean);
const observe=()=>{const rows=processes();for(const row of rows)if(profile&&row.command.includes(profile))pids.add(row.pid);
 let more=true;while(more){more=false;for(const row of rows)if(pids.has(row.parent)&&!pids.has(row.pid)){pids.add(row.pid);more=true;}}};
const until=async(action,label)=>{const end=Date.now()+30000;do{const value=await action();if(value)return value;await new Promise(r=>setTimeout(r,50));}while(Date.now()<end);throw Error('Missing '+label);};
try{
 const info=await channel.control({method:'info'});
 profile=await mkdtemp(path.join(os.tmpdir(),'theseus-core8-1015-'));
 const context=await chromium.launchPersistentContext(profile,{headless:true,executablePath:process.env.AIM_CHROME,viewport:{width:1280,height:900},hasTouch:true});
 browser=context.browser();assert.ok(browser);observe();tracker=setInterval(observe,200);
 result.browser=browser.version();
 for(const width of [1280,320]){
  const workspace='end-'+width;await channel.control({method:'workspace',workspace});
  const page=await context.newPage();await page.setViewportSize({width,height:900});
  page.on('pageerror',e=>result.errors.push(e.stack));
  await page.addInitScript(()=>{window.nativeActs=[];for(const type of ['click','input','keydown'])addEventListener(type,e=>nativeActs.push({type,trusted:e.isTrusted,key:e.key,id:e.target.id}),true);});
  await page.goto(info.origin+'/?workspace='+workspace);
  await page.locator('#team-people .add-chip').click();await page.locator('#add-headless-seat').click();
  await page.locator('#headless-seat-name').click();await page.keyboard.insertText('Native End '+width);
  await page.locator('#headless-seat-role').click();await page.keyboard.insertText('Retain exact fixture history.');
  await page.locator('#headless-seat-submit').click();
  await until(async()=> (await page.locator('.seat-statuses').innerText()).includes('Ready'), 'ready seat');
  await page.locator('#headless-seat-name').click();await page.keyboard.insertText('Future draft '+width);
  await page.locator('#headless-seat-role').click();await page.keyboard.insertText('My unsent next role.');
  const before=await until(async()=>{const state=await channel.control({method:'inspect',workspace});
    return state.messages.some(row=>row[0]===state.seats[0]?.[1])&&state;}, 'actual first fixture reply');
  assert.equal(before.seats.length,1);
  const end=page.locator('[data-seat-end]');await end.waitFor({state:'visible'});
  const box=await end.boundingBox();assert.ok(box.height>=44&&box.width>=44);
  let original, intercepted=false;
  if(width===1280)await page.route('**/api/command',async route=>{
   const request=route.request().postDataJSON();if(request.kind!=='workspace.hosted_seat_end')return route.continue();
   original=request;await route.fetch();intercepted=true;await route.abort('failed');
  });
  if(width===320)await end.tap();
  else{
   // Walk native keyboard focus to the named End control, then activate it.
   await page.locator('#headless-seat-role').click();
   for(let n=0;n<150;n++){await page.keyboard.press('Tab');if(await page.evaluate(()=>Boolean(document.activeElement?.dataset.seatEnd)))break;}
   assert.equal(await page.evaluate(()=>Boolean(document.activeElement?.dataset.seatEnd)),true);
   await page.keyboard.press('Enter');
  }
  if(width===1280){
   await until(()=>intercepted,'lost End response');
   await page.locator('#headless-seat-retry:not([disabled])').waitFor();
   await page.reload();await page.locator('#team-people .add-chip').click();await page.locator('#add-headless-seat').click();
   assert.equal(await page.locator('#headless-seat-name').inputValue(),'Future draft '+width);
   assert.equal(await page.locator('#headless-seat-role').inputValue(),'My unsent next role.');
   await page.locator('#headless-seat-retry').click();
   await page.locator('#headless-seat-retry').waitFor({state:'hidden'});
   result.lost_request=original;
  }
  await until(async()=> (await page.locator('.seat-statuses').innerText()).includes('Ended · history kept.'),'ended seat');
  assert.equal(await page.locator('[data-seat-end]').count(),0);
  assert.equal((await page.locator('.headless-seats .notice').innerText()).includes('Ending after'),false,'the latest Core state replaces the earlier Ending confirmation');
  assert.equal(await page.locator('#headless-seat-name').inputValue(),'Future draft '+width);
  const geometry=await page.evaluate(()=>({width:innerWidth,scroll:document.documentElement.scrollWidth}));
  assert.ok(geometry.scroll<=geometry.width+1,JSON.stringify(geometry));
  const after=await channel.control({method:'inspect',workspace});assert.equal(after.routes_unchanged,true);
  assert.deepEqual(after.messages,before.messages,'End retains the original task and fixture reply');
  const acts=await page.evaluate(()=>nativeActs);assert.ok(acts.length&&acts.every(e=>e.trusted));
  await page.screenshot({path:path.join(out,'ended-'+width+'.png'),fullPage:true});
  result.cases.push({width,passed:true,geometry,acts,seat:after.seats[0]});await page.close();
 }
}catch(error){result.errors.push(error.stack);process.exitCode=1;}
finally{
 observe();if(tracker)clearInterval(tracker);
 if(browser)await browser.close();
 const absent=await until(()=>[...pids].every(pid=>!present(pid)),'owned browser PID exit');
 if(profile){assert.ok(!processes().some(row=>row.command.includes(profile)));await rm(profile,{recursive:true});}
 fixture.stdin.end();const exited=await channel.exit;assert.equal(exited.code,0,channel.errors());assert.equal(present(fixture.pid),false);
 const cleanup=JSON.parse(await readFile(path.join(out,'fixture','cleanup.json'),'utf8'));
 result.cleanup={browser_close:true,pids:[...pids],all_absent:absent,profile_removed:true,fixture_exit:exited,...cleanup};
 await writeFile(path.join(out,'results.json'),JSON.stringify(result,null,2));
}
assert.deepEqual(result.errors,[]);console.log(JSON.stringify({passed:result.cases.length,cleanup:result.cleanup}));

// One isolated Chromium cell: native menu/key gestures, local preferences,
// real HTTP/Core and the actual IndexedDB-backed writing/departure path.
import assert from 'node:assert/strict';
import {spawn,execFileSync} from 'node:child_process';
import {mkdir,mkdtemp,writeFile,rm,access,readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import net from 'node:net';
import {fixtureControl} from './fixture_control.mjs';

const evidence=process.argv[2];await mkdir(evidence,{recursive:true});
const playwright=await import(process.env.AIM_PLAYWRIGHT_CORE);
const fixture=spawn('/usr/bin/python3',['-B','tests/fixtures/ui_http.py','--freshness','--live']);
const {control,exit,errors}=fixtureControl(fixture),cleanup={},checks=[],owned=new Set(),fixtureOwned=new Set([fixture.pid]);
const ps=()=>execFileSync('/bin/ps',['-ww','-axo','pid=,ppid=,command='],{encoding:'utf8'}).trim().split('\n').map(line=>{
  const match=/^\s*(\d+)\s+(\d+)\s+(.*)$/.exec(line);assert.ok(match,'complete process row');return{pid:+match[1],ppid:+match[2],command:match[3]};
});
const children=set=>{const rows=ps();for(let change=true;change;){change=false;for(const row of rows)if(set.has(row.ppid)&&!set.has(row.pid)){set.add(row.pid);change=true;}}};
let context,browser,profile,origin,failure,page;const pageErrors=[];
try {
  const facts=await control({method:'ready'});origin=facts.origin;children(fixtureOwned);
  await control({method:'navigation_topics',topics:[{id:'t1160',title:'Shortcut target'}]});
  profile=await mkdtemp(evidence+'/chrome-profile-');
  context=await playwright.chromium.launchPersistentContext(profile,{headless:true,executablePath:process.env.AIM_CHROME,viewport:{width:1280,height:1000}});
  browser=context.browser();for(const row of ps())if(row.command.includes(profile))owned.add(row.pid);children(owned);
  assert.ok(owned.size,'owned Chrome identity');
  await context.addInitScript(({instance,actor})=>{localStorage.setItem('theseus-look','bookends');localStorage.setItem('aim-next.outline-open.'+JSON.stringify([instance,actor]),JSON.stringify({w1:true}));window.hotkeyEvents=[];document.addEventListener('keydown',event=>{if(event.altKey&&/^Digit/.test(event.code))window.hotkeyEvents.push({code:event.code,key:event.key,trusted:event.isTrusted,target:event.target.id});},true);},{instance:facts.instance_id,actor:facts.actor});
  page=await context.newPage();page.setDefaultTimeout(9000);page.on('pageerror',error=>pageErrors.push(error.stack));
  await page.goto(origin+'/?topic=t1');await page.locator('body[data-ready=true]').waitFor();
  const sourceFiles=['rail-hotkeys.mjs','rails.mjs','outline-menus.mjs'];
  const script=await page.evaluate(()=>[...document.scripts].find(script=>script.src.includes('/app.mjs')).src);
  for(const file of sourceFiles){const actual=await(await page.request.get(new URL('./'+file,script).href)).body();const expected=await readFile('web/'+file);assert.equal(createHash('sha256').update(actual).digest('hex'),createHash('sha256').update(expected).digest('hex'),'served '+file);}
  const target=()=>page.locator('#outline a[data-topic-id=t1160]'),home=()=>page.locator('#outline a[data-topic-id=t1]');
  const assign=async(row,digit)=>{
    await row.scrollIntoViewIfNeeded();await row.click({button:'right'});
    await page.getByRole('menuitemradio',{name:digit===null?'No key':'Option+'+digit,exact:true}).click();
    await page.locator('.rail-hotkey-row').waitFor({state:'hidden'});
  };
  const arrived=async id=>{await page.waitForURL(url=>url.searchParams.get('topic')===id);await page.locator('body[data-ready=true]').waitFor();};
  await assign(target(),'2');await assign(home(),'1');
  assert.equal(await target().locator('.rail-hotkeycap').innerText(),'2');
  await page.keyboard.press('Alt+Digit2');await arrived('t1160');checks.push('native Option-Digit2 opens assigned topic');
  await page.keyboard.press('Alt+Digit1');await arrived('t1');
  await page.reload();await page.locator('body[data-ready=true]').waitFor();assert.equal(await target().locator('.rail-hotkeycap').innerText(),'2');checks.push('reload retains exact local assignment');
  await assign(page.locator('#health-link'),'2');assert.equal(await target().locator('.rail-hotkeycap').count(),0);
  await page.keyboard.press('Alt+Digit2');await page.waitForURL(url=>url.searchParams.has('health'));await page.locator('body[data-ready=true]').waitFor();
  await page.keyboard.press('Alt+Digit1');await arrived('t1');checks.push('reassignment across Health and topic; shortcut returns from Health');
  await assign(target(),'2');await assign(target(),null);assert.equal(await target().locator('.rail-hotkeycap').count(),0);
  const before=page.url();await page.keyboard.press('Alt+Digit2');assert.equal(page.url(),before);checks.push('clear removes cap and leaves unassigned Option key alone');
  await assign(target(),'2');
  if(!await page.locator('#inline-writing-body').isVisible())await page.locator('#new-message').click();
  const writing='Unsent shortcut writing 1160 — exact bytes';await page.locator('#inline-writing-body').fill(writing);
  await page.keyboard.press('Alt+Digit2');await arrived('t1160');await page.keyboard.press('Alt+Digit1');await arrived('t1');
  if(!await page.locator('#inline-writing-body').isVisible())await page.locator('#new-message').click();
  await page.waitForFunction(text=>document.querySelector('#inline-writing-body')?.value===text,writing);
  checks.push('native shortcut from typing field retains exact unsent IndexedDB writing across departure and return');
  const events=await page.evaluate(()=>window.hotkeyEvents);assert.ok(events.length&&events.every(event=>event.trusted));
  assert.deepEqual(pageErrors,[]);await page.screenshot({path:evidence+'/rail-hotkeys.png'});
  await writeFile(evidence+'/observations.json',JSON.stringify({checks,events,writing,writingDigest:createHash('sha256').update(writing).digest('hex'),url:page.url(),pageErrors},null,2));
} catch(error) {failure=error.stack;await page?.screenshot({path:evidence+'/failure.png'}).catch(()=>{});}
finally {
  if(browser){children(owned);try{await browser.close();cleanup.browserClosed=!browser.isConnected();}catch(error){cleanup.browserCloseError=error.stack;}}
  const after=ps();cleanup.ownedPids=[...owned];cleanup.remainingOwned=after.filter(row=>owned.has(row.pid));cleanup.profileProcesses=profile?after.filter(row=>row.command.includes(profile)):[];
  if(profile&&cleanup.browserClosed&&!cleanup.remainingOwned.length&&!cleanup.profileProcesses.length){await rm(profile,{recursive:true});cleanup.profileRemoved=await access(profile).then(()=>false,()=>true);}
  children(fixtureOwned);fixture.stdin.end();cleanup.fixtureExit=await exit;cleanup.fixtureErrors=errors();
  cleanup.fixtureAbsent=!ps().some(row=>row.pid===fixture.pid);cleanup.remainingFixtureOwned=ps().filter(row=>fixtureOwned.has(row.pid));
  if(origin)cleanup.portClosed=await new Promise(resolve=>{const url=new URL(origin),socket=net.createConnection({host:url.hostname,port:+url.port});socket.once('connect',()=>{socket.destroy();resolve(false);});socket.once('error',()=>resolve(true));});
  await writeFile(evidence+'/results.json',JSON.stringify({checks,pageErrors,failure,cleanup},null,2));
}
console.log(JSON.stringify({checks:checks.length,failure,cleanup}));
if(failure||checks.length!==5||!cleanup.browserClosed||cleanup.remainingOwned.length||cleanup.profileProcesses.length||!cleanup.profileRemoved||cleanup.fixtureExit?.code!==0||!cleanup.fixtureAbsent||cleanup.remainingFixtureOwned.length||cleanup.fixtureErrors||!cleanup.portClosed)process.exitCode=1;

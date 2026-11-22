import assert from 'node:assert/strict';
import {spawn, execFileSync} from 'node:child_process';
import {mkdir, mkdtemp, writeFile, rm, access} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import net from 'node:net';
import {fixtureControl} from './fixture_control.mjs';

const engine=process.env.AIM_ENGINE??'chromium', out=process.argv[2];
const playwright=await import(process.env.AIM_PLAYWRIGHT_CORE);
const hashes=JSON.parse(process.env.AIM_1038_HASHES), baseline=process.env.AIM_1038_PREFLIGHT==='1';
await mkdir(out,{recursive:true});
await mkdir(`${out}/served`,{recursive:true});
const fixture=spawn('/usr/bin/python3',['-B','tests/fixtures/runner_faults_1038.py','--freshness','--live']);
const {control,exit,errors}=fixtureControl(fixture), results=[], cleanup={}, owned=new Set(), fixtureOwned=new Set([fixture.pid]);
const ps=()=>execFileSync('/bin/ps',['-axo','pid=,ppid=,command='],{encoding:'utf8'}).trim().split('\n').map(line=>{const[,pid,ppid,command]=line.match(/^\s*(\d+)\s+(\d+)\s+(.*)$/);return{pid:+pid,ppid:+ppid,command};});
function children(set){const rows=ps();for(let changed=true;changed;){changed=false;for(const row of rows)if(set.has(row.ppid)&&!set.has(row.pid)){set.add(row.pid);changed=true;}}}
let browser,profile,origin,fatal;
try {
 const facts=await control({method:'ready'});origin=facts.origin;children(fixtureOwned);
 profile=await mkdtemp(`${out}/${engine}-profile-`);
 const persistent=await playwright[engine].launchPersistentContext(profile,{headless:true,
  ...(engine==='chromium'?{executablePath:process.env.AIM_CHROME}:{executablePath:process.env.AIM_WEBKIT})});
 browser=persistent.browser();cleanup.engine=engine;cleanup.version=browser.version();
 for(const row of ps())if(row.command.includes(profile))owned.add(row.pid);children(owned);assert.ok(owned.size);
 await writeFile(`${out}/owned-start.json`,JSON.stringify({profile,ownedPids:[...owned],fixturePid:fixture.pid,origin}));
 const cells=baseline?[[1280,'bookends','light']]:[1280,390].flatMap(width=>['bookends','paper'].flatMap(look=>['light','dark'].map(theme=>[width,look,theme])));
 for(const [width,look,colorScheme] of cells)for(const kind of baseline?['value']:['value','sqlite']) {
  const key=`${engine}-${width}-${look}-${colorScheme}-${kind}`, observations=[],pageErrors=[],leavingReadCancellations=[];
  const context=await browser.newContext({viewport:{width,height:1000},colorScheme,hasTouch:width===390,isMobile:width===390});
  await context.addInitScript(look=>localStorage.setItem('theseus-look',look),look);
  const page=await context.newPage();page.setDefaultTimeout(6000);let error,leaving=false;
  page.on('pageerror',e=>{const detail={message:e.message,stack:e.stack,phase:leaving?'leaving':'active'};
   if(engine==='webkit'&&leaving&&/^Fetch API cannot load \S+ due to access control checks\.$/.test(e.stack?.split('\n')[0]??''))leavingReadCancellations.push(detail);else pageErrors.push(detail);});
  const press=async locator=>width===390?locator.tap():locator.click();
  const executedLoads=[];let modulePhase='initial';
  const verifyLoads=(executed,phase)=>{
   for(const [name,hash]of Object.entries(hashes).filter(([name])=>name.startsWith('web/'))){
    const loads=executed.filter(row=>row.name===name&&row.phase===phase);assert.ok(loads.length,phase+' executed response '+name);
    for(const row of loads){assert.equal(row.error,undefined);assert.equal(row.status,200);assert.equal(row.sha256,hash,phase+' executed '+name);}
   }
  };
  page.on('response',response=>{
   const file=new URL(response.url()).pathname.split('/').pop(), name='web/'+file;
   if(!(name in hashes))return;
   const index=executedLoads.length,phase=modulePhase;
   executedLoads.push((async()=>{
    const bytes=await response.body(), actual=createHash('sha256').update(bytes).digest('hex');
    const saved=`served/${key}-${index}-${file}`;await writeFile(`${out}/${saved}`,bytes);
    return {name,phase,url:response.url(),status:response.status(),sha256:actual,saved};
   })().catch(e=>({name,phase,error:e.stack})));
  });
  try {
   const paused=await control({method:'item_757',action:'runner_fault_1038',step:'pause',kind});observations.push({phase:'actual catch-all and kept Core pause',paused});
   assert.equal(paused.result.status,'paused');
   assert.deepEqual(paused.source_hashes,Object.fromEntries(Object.entries(hashes).filter(([name])=>name.startsWith('aim_next/'))));
   await page.goto(origin+'/?health');await page.locator('body[data-ready=true]').waitFor();
   const executed=await Promise.all(executedLoads);
   verifyLoads(executed,'initial');
   observations.push({phase:'original executed module response bodies retained',executed});
   const summary=page.locator('details[data-key=runner] summary');await summary.waitFor();
   await page.waitForFunction(()=>document.querySelector('details[data-key=runner] summary')?.textContent.includes('storage fault'));
   const text=await summary.innerText();observations.push({phase:'actual rendered pause',text});
   assert.match(text,new RegExp(kind==='sqlite'?'OperationalError: database is locked':'ValueError: Invalid value'));
   assert.deepEqual(paused.health.runner.fault,paused.result.fault);
   await press(summary);assert.equal(await page.locator('details[data-key=runner]').getAttribute('open'),'');
   const geometry=await page.evaluate(()=>({width:innerWidth,scroll:document.documentElement.scrollWidth,right:document.querySelector('details[data-key=runner] summary').getBoundingClientRect().right}));
   assert.ok(geometry.scroll<=geometry.width+1);assert.ok(geometry.right<=geometry.width+1);observations.push({phase:'rendered containment',geometry});
   assert.doesNotMatch(await page.locator('body').innerText(),/PRIVATE_TOKEN|PRIVATE_MESSAGE|\/Users\/private/);
   await page.screenshot({path:`${out}/${key}-paused.png`});
   modulePhase='reload';leaving=true;await page.reload();await page.locator('body[data-ready=true]').waitFor();leaving=false;
   verifyLoads(await Promise.all(executedLoads),'reload');
   await page.waitForFunction(name=>document.querySelector('details[data-key=runner] summary')?.textContent.includes(name),paused.result.fault.exception_class);
   const resumed=await control({method:'item_757',action:'runner_fault_1038',step:'resume'});observations.push({phase:'actual version-fenced Core resume',resumed});
   assert.equal(resumed.status,'acquired');assert.deepEqual(resumed.health.runner.prior.fault,paused.result.fault);assert.equal(resumed.health.runner.fault,undefined);
   await page.waitForFunction(()=>document.querySelector('details[data-key=runner] summary')?.textContent.includes('Has been running'));
   if(await page.locator('details[data-key=runner]').getAttribute('open')===null)await press(summary);
   await page.waitForFunction(name=>document.querySelector('details[data-key=runner]')?.textContent.includes(name),paused.result.fault.exception_class);
   assert.doesNotMatch(await page.locator('body').innerText(),/PRIVATE_TOKEN|PRIVATE_MESSAGE|\/Users\/private/);
   await page.screenshot({path:`${out}/${key}-resumed.png`});assert.deepEqual(pageErrors,[]);
  } catch(e) {error=e.stack;await page.screenshot({path:`${out}/${key}-failure.png`}).catch(()=>{});}
  const executed=await Promise.all(executedLoads);observations.push({phase:'all original module loads including reload',executed});
  if(executed.some(row=>row.error)&&!error)error='Original response capture failed: '+JSON.stringify(executed);
  results.push({key,error:error??null,observations,pageErrors,leavingReadCancellations});
  await writeFile(`${out}/observations.json`,JSON.stringify(results,null,2));children(owned);
  await writeFile(`${out}/owned-latest.json`,JSON.stringify({profile,ownedPids:[...owned],fixturePid:fixture.pid,origin}));
  leaving=true;await context.close();
 }
} catch(e) {fatal=e.stack;}
finally {
 if(browser){children(owned);await browser.close();cleanup.browserClosed=!browser.isConnected();}
 const rows=ps();cleanup.ownedPids=[...owned];cleanup.remainingOwned=rows.filter(r=>owned.has(r.pid));cleanup.profileProcesses=profile?rows.filter(r=>r.command.includes(profile)):[];
 if(profile&&cleanup.browserClosed&&!cleanup.remainingOwned.length&&!cleanup.profileProcesses.length){await rm(profile,{recursive:true});cleanup.profileRemoved=await access(profile).then(()=>false,()=>true);}
 children(fixtureOwned);fixture.stdin.end();cleanup.fixtureExit=await exit;cleanup.fixtureErrors=errors();cleanup.fixturePid=fixture.pid;
 const after=ps();cleanup.fixtureAbsent=!after.some(r=>r.pid===fixture.pid);cleanup.fixtureOwnedPids=[...fixtureOwned];cleanup.remainingFixtureOwned=after.filter(r=>fixtureOwned.has(r.pid));
 if(origin)cleanup.portClosed=await new Promise(resolve=>{const u=new URL(origin),s=net.createConnection({host:u.hostname,port:+u.port});s.once('connect',()=>{s.destroy();resolve(false)});s.once('error',()=>resolve(true));});
 await writeFile(`${out}/results.json`,JSON.stringify({engine,baseline,hashes,results,cleanup,fatal:fatal??null},null,2));
}
const bad=results.filter(r=>r.error);process.stdout.write(JSON.stringify({engine,pass:results.length-bad.length,fail:bad.length,bad:bad.map(r=>({key:r.key,error:r.error})),cleanup,fatal:fatal??null},null,2)+'\n');
if(!results.length||bad.length||fatal||!cleanup.browserClosed||cleanup.remainingOwned?.length||cleanup.profileProcesses?.length||!cleanup.profileRemoved||cleanup.fixtureExit?.code!==0||cleanup.fixtureErrors||!cleanup.fixtureAbsent||cleanup.remainingFixtureOwned?.length||!cleanup.portClosed)process.exitCode=1;

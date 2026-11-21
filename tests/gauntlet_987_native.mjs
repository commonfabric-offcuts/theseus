// Actual PipelinePage.pieceCard with real isolated Core freeze records.
// No app-bootstrap, Core write, physical-phone or model claim.
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { createInterface } from 'node:readline';
import { mkdir,writeFile,access,readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import os from 'node:os';
import net from 'node:net';
const [chrome,playwright,out,mode='green',engine='chromium']=process.argv.slice(2);
assert.ok(['chromium','webkit'].includes(engine));
const api=createRequire(import.meta.url)(playwright),type=api[engine];
await mkdir(out,{recursive:true});
const source=fileURLToPath(new URL('..',import.meta.url));
const child=spawn('/usr/bin/python3',['-I','-X',`pycache_prefix=${out}/pycache`,`${source}/tests/fixtures/gauntlet_987.py`,source],{stdio:['pipe','pipe','pipe']});
const ended=new Promise(resolve=>child.once('exit',(code,signal)=>resolve({code,signal})));
let stderr='';child.stderr.on('data',s=>stderr+=s);
const lines=createInterface({input:child.stdout})[Symbol.asyncIterator]();
const alive=pid=>{try{process.kill(pid,0);return true;}catch{return false;}};
const portOpen=origin=>new Promise(resolve=>{const s=net.connect(new URL(origin).port,'127.0.0.1');s.once('connect',()=>{s.destroy();resolve(true);});s.once('error',()=>resolve(false));});
const pause=ms=>new Promise(r=>setTimeout(r,ms));
const result={engine,mode,cells:[],errors:[],cleanup:{},failure:null};let browser,facts,owned=[],profile,webkitProfiles=[];
const profiles=async()=>new Set((await readdir(os.tmpdir())).filter(x=>x.startsWith('playwright_webkitdev_profile-')));
try{
  const ready=await lines.next();assert.equal(ready.done,false,stderr);facts=JSON.parse(ready.value);result.runtime=facts;
  const beforeProfiles=await profiles();
  browser=await type.launch({...(engine==='chromium'?{executablePath:chrome,args:['--enable-automation']}:process.env.GAUNTLET987_WEBKIT?{executablePath:process.env.GAUNTLET987_WEBKIT}:{}),headless:true});
  assert.equal(browser.browserType().name(),engine);result.version=browser.version();
  if(engine==='chromium'){
    const cdp=await browser.newBrowserCDPSession();const command=(await cdp.send('Browser.getBrowserCommandLine')).arguments;
    profile=command.find(x=>x.startsWith('--user-data-dir='))?.slice(16);assert.ok(profile);result.profile=profile;
    owned=execFileSync('ps',['-axo','pid=,command='],{encoding:'utf8'}).split('\n').filter(x=>x.includes(profile)).map(x=>Number(x.trim().split(/\s+/)[0]));
    assert.ok(owned.length);await cdp.detach();
  }else{
    // This fixture owns the newly launched browser and every descendant only.
    const rows=execFileSync('ps',['-axo','pid=,ppid=,command='],{encoding:'utf8'}).split('\n').map(x=>x.trim().match(/^(\d+)\s+(\d+)\s+(.*)$/)).filter(Boolean);
    const descendants=new Set([process.pid]);let changed=true;while(changed){changed=false;for(const r of rows)if(descendants.has(+r[2])&&!descendants.has(+r[1])){descendants.add(+r[1]);changed=true;}}
    owned=rows.filter(r=>descendants.has(+r[1])&&/WebKit|MiniBrowser|NetworkProcess|WebProcess|Playwright|pw_run/.test(r[3])).map(r=>+r[1]);assert.ok(owned.length);
    webkitProfiles=[...await profiles()].filter(x=>!beforeProfiles.has(x)).map(x=>`${os.tmpdir()}/${x}`);
    assert.equal(webkitProfiles.length,1,'identify the actual owned WebKit profile');
    result.profile=webkitProfiles[0];
  }
  result.ownedPids=owned;
  for(const width of mode==='green'?[1280,390,375,320]:[1280])for(const colorScheme of mode==='green'?['light','dark']:['light']){
    const context=await browser.newContext({viewport:{width,height:900},colorScheme});
    const page=await context.newPage();page.on('pageerror',e=>result.errors.push(e.stack));
    try{
      await page.goto(mode==='red'?facts.baseline:facts.candidate);await page.waitForFunction(()=>window.ready987);
      const cell={width,colorScheme};result.cells.push(cell);
      assert.equal(await page.locator('[data-state=before] .pl-judged').count(),0);
      assert.equal(await page.locator('[data-state=ordinary] .pl-judged').count(),0);
      assert.equal(await page.locator('[data-state=judged] .pl-judged').count(),1,'actual judged Core freeze has a card mark');
      assert.equal(await page.locator('.pl-judged').textContent(),'Judged · this change pays its own gauntlet');
      cell.proof=await page.evaluate(()=>Object.fromEntries(Object.entries(window.records987).map(([s,v])=>[s,v.pieces[0].freeze])));
      assert.equal(cell.proof.before,null);assert.equal(cell.proof.ordinary.judged,false);assert.equal(cell.proof.judged.judged,true);
      assert.equal(cell.proof.judged.files[0],'tools/deploy.py');
      assert.equal(await page.locator('[data-state=judged] .pl-judged').evaluate(n=>{const r=n.getBoundingClientRect();return r.width>0&&r.left>=0&&r.right<=innerWidth;}),true);
      assert.equal(await page.locator('.pl-judged').getAttribute('role'),'note');
      await page.screenshot({path:`${out}/${width}-${colorScheme}.png`,fullPage:true});
    }finally{await context.close();}
  }
  assert.deepEqual(result.errors,[]);
}catch(error){result.failure=error.stack;process.exitCode=1;}
finally{
  if(browser){await browser.close();result.cleanup.browserClosed=!browser.isConnected();}
  for(let n=0;n<30&&owned.some(alive);n++)await pause(100);
  result.cleanup.ownedRemaining=owned.filter(alive);
  if(profile)result.cleanup.profileAbsent=await access(profile).then(()=>false,()=>true);
  if(webkitProfiles.length)result.cleanup.profileAbsent=(await Promise.all(webkitProfiles.map(p=>access(p).then(()=>false,()=>true)))).every(Boolean);
  child.stdin.end();result.cleanup.fixtureExit=await ended;result.cleanup.fixtureAbsent=!alive(child.pid);
  if(facts){result.cleanup.portsClosed=!(await portOpen(facts.candidate))&&!(await portOpen(facts.baseline));await access(facts.scratch).then(()=>{throw Error('scratch remains');},()=>{});}
  await writeFile(`${out}/fixture-stderr.txt`,stderr);await writeFile(`${out}/results.json`,JSON.stringify(result,null,2));
  assert.deepEqual(result.cleanup.ownedRemaining,[],'owned browser PIDs ended');
  if(profile)assert.equal(result.cleanup.profileAbsent,true);
  assert.deepEqual(result.cleanup.fixtureExit,{code:0,signal:null});assert.equal(result.cleanup.fixtureAbsent,true);assert.equal(result.cleanup.portsClosed,true);
  console.log(JSON.stringify({engine,mode,cells:result.cells.length,failure:result.failure,cleanup:result.cleanup}));
}

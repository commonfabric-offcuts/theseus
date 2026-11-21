// Actual shared feed arrangement and Reader.paintCover, on content-free origins.
// No app-bootstrap, Core write, physical-phone or model claim.
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { createInterface } from 'node:readline';
import { mkdir,writeFile,access,readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import os from 'node:os';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import net from 'node:net';
const [chrome,playwright,out,mode='green',engine='chromium']=process.argv.slice(2);
assert.ok(['chromium','webkit'].includes(engine));
const api=createRequire(import.meta.url)(playwright),type=api[engine];
await mkdir(out,{recursive:true});
assert.ok(os.loadavg()[0]<12,'actual one-minute load below12 before browser launch');
const source=fileURLToPath(new URL('..',import.meta.url));
const child=spawn('/usr/bin/python3',['-I','-X',`pycache_prefix=${out}/pycache`,`${source}/tests/fixtures/cover_sections_1006.py`,source],{stdio:['pipe','pipe','pipe']});
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
  browser=await type.launch({...(engine==='chromium'?{executablePath:chrome,args:['--enable-automation']}:process.env.COVER1006_WEBKIT?{executablePath:process.env.COVER1006_WEBKIT}:{}),headless:true});
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
  const rich='Preface\n\n# Today\n\n- **Built** one\n- [Result](https://example.test/result)\n\n### Detail\n\nKeep `bytes`\n\n## Next\n\nNext words\n\n# Parked\n\nParked words';
  for(const width of mode==='green'?[1280,390,375,320]:[1280])for(const colorScheme of mode==='green'?['light','dark']:['light'])for(const look of mode==='green'?['bookends','paper']:['bookends']){
    const context=await browser.newContext({viewport:{width,height:900},colorScheme,hasTouch:width<500,isMobile:width<500});
    context.setDefaultTimeout(10000);context.setDefaultNavigationTimeout(10000);
    const page=await context.newPage();page.on('pageerror',e=>result.errors.push(String(e)));
    const visit=async origin=>{await page.goto(origin);await page.waitForFunction(()=>window.ready1006);await page.evaluate(v=>document.documentElement.dataset.look=v,look);};
    const feed='#messages .dossier-cover',reader='#reader-cover .dossier-cover';
    const heading=(surface,n)=>page.locator(`${surface} .cover-section-heading`).nth(n);
    const press=async locator=>width<500?locator.tap():locator.click();
    const opened=()=>page.evaluate(()=>['#messages .dossier-cover','#reader-cover .dossier-cover'].map(s=>[...document.querySelectorAll(s+' .cover-section')].map(n=>n.open)));
    const expectFolds=async value=>{await page.waitForFunction(v=>['#messages .dossier-cover','#reader-cover .dossier-cover'].every(s=>JSON.stringify([...document.querySelectorAll(s+' .cover-section')].map(n=>n.open))===JSON.stringify(v)),value);};
    try{
      const cell={width,colorScheme,look};result.cells.push(cell);
      const images=[];
      for(const origin of [facts.baseline,facts.candidate]){
        await visit(origin);await page.evaluate(()=>window.paint1006('Plain standing words\nSecond line\n\nFourth line <literal>'));
        images.push(await page.locator(feed).screenshot({animations:'disabled'}));
      }
      assert.deepEqual(images[1],images[0],'no-heading plain pixels equal actual294');cell.plainPixels=true;
      const hashes={};for(const file of ['dossier-cover.mjs','cover-sections.mjs','stack-look.css','reply-stacks.mjs','reader.mjs','message-format.mjs']){
        const response=await page.request.get(facts.candidate+'/'+file);assert.equal(response.status(),200);
        const served=createHash('sha256').update(await response.body()).digest('hex');
        assert.equal(served,createHash('sha256').update(await readFile(source+'/web/'+file)).digest('hex'));hashes[file]=served;
      }cell.servedHashes=hashes;
      await page.evaluate(v=>window.paint1006(v),rich);await page.locator('#reader-cover > summary').click();
      await expectFolds([true,true,true,true]);
      const initial=await page.evaluate(async raw=>{const {formatNodes,sourcePosition}=await import('/message-format.mjs');
        const unwrap=n=>n.classList?.contains('cover-section')?[n.firstElementChild.firstElementChild,...[...n.lastElementChild.childNodes].flatMap(unwrap)]:[n];
        const reference=formatNodes(raw,{doc:document});
        return ['#messages .dossier-cover','#reader-cover .dossier-cover'].map(s=>{
        const w=document.querySelector(s+' .cover-stands'),sections=w.querySelectorAll('.cover-section'),r=w.getBoundingClientRect();
        return {sections:sections.length,nested:sections[0].querySelectorAll('.cover-section').length,items:w.querySelectorAll('.md-item').length,
          fullWidth:Math.abs(r.width-w.parentElement.getBoundingClientRect().width)<1,overflow:r.right>innerWidth+1,
          exactWords:w.textContent===document.querySelector('[data-id=root] .message-preview').textContent,
          sourcePositions:[...w.childNodes].flatMap(unwrap).map(n=>sourcePosition(n,0)),referencePositions:reference.map(n=>sourcePosition(n,0)),
          labels:[...w.querySelectorAll('.cover-section-heading')].map(n=>n.textContent),outer:document.querySelector('#reader-cover').open};
      });},rich);
      for(const at of initial){assert.equal(at.sections,4);assert.equal(at.nested,2);assert.equal(at.items,2);assert.equal(at.fullWidth,true);assert.equal(at.overflow,false);assert.equal(at.outer,true);assert.equal(at.exactWords,true);assert.deepEqual(at.sourcePositions,at.referencePositions);assert.deepEqual(at.labels,['Today','Detail','Next','Parked']);}cell.initial=initial;
      await press(heading(feed,2));await expectFolds([true,true,false,true]);
      // Native details can retain descendant layout boxes while hiding them.
      assert.equal(await page.locator(`${reader} .cover-section-body`).nth(2).isVisible(),false);
      assert.equal(await page.locator('#reader-cover').evaluate(n=>n.open),true);cell.nativePointerOrTouch=true;
      await page.reload();await page.waitForFunction(()=>window.ready1006);await page.evaluate(v=>{document.documentElement.dataset.look=v;window.paint1006('unused');},look);
      await page.evaluate(v=>window.paint1006(v),rich);await page.locator('#reader-cover > summary').click();await expectFolds([true,true,false,true]);cell.reload=true;
      await page.evaluate(v=>window.paint1006(v+'\n\nNew body words'),rich);await expectFolds([true,true,false,true]);
      await page.evaluate(v=>window.paint1006(v,{viewer:'different-viewer'}),rich);await expectFolds([true,true,true,true]);
      await page.evaluate(v=>window.paint1006(v,{viewer:'scratch-reader',root:'different-message'}),rich);await expectFolds([true,true,true,true]);
      await page.evaluate(v=>window.paint1006(v,{root:'root'}),rich);await expectFolds([true,true,false,true]);cell.scope=true;
      // 989 still closes the outer Reader cover when its source changes.
      if(!await page.locator('#reader-cover').evaluate(n=>n.open))await page.locator('#reader-cover > summary').click();
      await heading(reader,2).focus();await page.keyboard.press('Enter');await expectFolds([true,true,true,true]);
      await page.keyboard.press('Space');await expectFolds([true,true,false,true]);cell.nativeKeys=true;
      await press(heading(feed,0));await expectFolds([false,true,false,true]);await press(heading(reader,0));await expectFolds([true,true,false,true]);
      await context.route('https://example.test/**',r=>r.fulfill({body:'Scratch destination',contentType:'text/plain'}));
      const destination=page.waitForEvent('popup');await page.locator(`${reader} .cover-stands a`).click();const popup=await destination;await popup.waitForLoadState();assert.equal(popup.url(),'https://example.test/result');await popup.close();cell.nativeLink=true;
      await page.screenshot({path:`${out}/${width}-${colorScheme}-${look}.png`,fullPage:true});
      if(width===1280&&colorScheme==='light'&&look==='bookends'){
        const other=await context.newPage();await other.goto(facts.candidate);await other.waitForFunction(()=>window.ready1006);await other.evaluate(v=>window.paint1006(v),rich);
        await heading(feed,2).click();await expectFolds([true,true,true,true]);
        await other.waitForFunction(()=>[...document.querySelectorAll('#messages .cover-section')].every(n=>n.open));
        await other.close();cell.sameOriginStorageEvent=true;
      }
      assert.deepEqual(await page.evaluate(()=>Object.keys(localStorage).filter(k=>!k.startsWith('theseus:cover-sections:1:'))),[],'only own scratch preference keys');
    }finally{await Promise.race([context.close(),pause(12000).then(()=>{throw Error('Owned context cleanup timed out; Browser.close follows');})]);}
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

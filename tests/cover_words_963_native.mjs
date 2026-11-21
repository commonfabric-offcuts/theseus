// Actual shared feed arrangement and Reader.paintCover, on content-free origins.
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
const child=spawn('/usr/bin/python3',['-I','-X',`pycache_prefix=${out}/pycache`,`${source}/tests/fixtures/cover_words_963.py`,source],{stdio:['pipe','pipe','pipe']});
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
  browser=await type.launch({...(engine==='chromium'?{executablePath:chrome,args:['--enable-automation']}:process.env.COVER963_WEBKIT?{executablePath:process.env.COVER963_WEBKIT}:{}),headless:true});
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
  const rich='- **Built** the first piece\n- Check `exact bytes`\n- Read [the result](https://example.test/result)';
  for(const width of mode==='green'?[1280,390,375,320]:[1280])for(const colorScheme of mode==='green'?['light','dark']:['light'])for(const look of mode==='green'?['bookends','paper']:['bookends']){
    const context=await browser.newContext({viewport:{width,height:900},colorScheme});
    context.setDefaultTimeout(10000);context.setDefaultNavigationTimeout(10000);
    const page=await context.newPage();page.on('pageerror',e=>result.errors.push(String(e)));
    const visit=async origin=>{await page.goto(origin);await page.waitForFunction(()=>window.ready963);await page.evaluate(v=>document.documentElement.dataset.look=v,look);};
    try{
      const cell={width,colorScheme,look};
      if(mode==='green'){
        const images=[];
        for(const origin of [facts.baseline,facts.candidate]){
          await visit(origin);await page.evaluate(()=>window.paint963('Plain standing words\nSecond line\n\nFourth line <literal>'));
          await page.locator('#reader-cover > summary').click();
          images.push(await page.locator('#feed > #messages > .reply-stack > .dossier-cover').screenshot({animations:'disabled'}));
        }
        assert.deepEqual(images[1],images[0],'plain cover pixels equal pristine266');cell.plainPixels=true;
      }else await visit(mode==='red'?facts.baseline:facts.candidate);
      const revision=await page.evaluate(v=>window.paint963(v),rich);
      if(!await page.locator('#reader-cover').evaluate(n=>n.open))await page.locator('#reader-cover > summary').click();
      const at=await page.evaluate(()=>{
        const font=n=>{const s=getComputedStyle(n);return [s.fontFamily,s.fontSize,s.fontWeight,s.lineHeight];};
        return ['#messages .dossier-cover','#reader-cover .dossier-cover'].map(s=>{const host=document.querySelector(s),w=host.querySelector('.cover-stands');return {
          items:w.querySelectorAll('.md-item').length,bold:w.querySelector('strong')?.textContent,code:w.querySelector('code')?.textContent,
          link:w.querySelector('a')?.href,font:font(w),reference:font(document.querySelector(s.startsWith('#messages')?'[data-id=root] .message-preview':'#reference')),
          time:host.querySelector('.cover-revision-line time').dataset.ms,overflow:w.getBoundingClientRect().right>innerWidth+1};});
      });
      cell.at=at;result.cells.push(cell);
      for(const surface of at){assert.equal(surface.items,3,'cover has the three message list items');assert.equal(surface.bold,'Built');assert.equal(surface.code,'exact bytes');assert.equal(surface.link,'https://example.test/result');assert.deepEqual(surface.font,surface.reference,'message face/size/weight/line-height');assert.equal(surface.time,String(revision.at_ms));assert.equal(surface.overflow,false);}
      await page.screenshot({path:`${out}/${width}-${colorScheme}-${look}.png`,fullPage:true});
      await context.route('https://example.test/**',r=>r.fulfill({body:'Scratch destination',contentType:'text/plain'}));
      const destination=page.waitForEvent('popup');await page.locator('#reader-cover .cover-stands a').click();const popup=await destination;await popup.waitForLoadState();assert.equal(popup.url(),'https://example.test/result');await popup.close();cell.nativeWrittenLink=true;
      // Existing HTML path, including its literal surrounding Markdown, is a negative.
      await page.evaluate(()=>window.paint963('Before **literal**\n```html\n<button>Run</button>\n```\nAfter'));
      const html=await page.locator('#messages .cover-stands').evaluate(w=>({frames:w.querySelectorAll('iframe').length,sandbox:w.querySelector('iframe')?.getAttribute('sandbox'),bold:w.querySelectorAll('strong').length,text:w.textContent}));
      assert.equal(html.frames,1);assert.equal(html.sandbox,'allow-scripts');assert.equal(html.bold,0);assert.match(html.text,/Before \*\*literal\*\*/);cell.html=html;
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

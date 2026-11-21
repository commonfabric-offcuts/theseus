// Native footer geometry in an isolated HTTP/Core instance.
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, writeFile, rm, access } from 'node:fs/promises';
import net from 'node:net';
import { fixtureControl } from './fixture_control.mjs';
const playwright = await import(process.env.AIM_PLAYWRIGHT_CORE), engine = process.env.AIM_ENGINE ?? 'chromium';
const evidence = process.argv[2];
await mkdir(evidence, { recursive: true });
const fixture = spawn('/usr/bin/python3', ['-B', 'tests/fixtures/ui_http.py', '--freshness']);
const { control, exit, errors } = fixtureControl(fixture);
const ps = () => execFileSync('/bin/ps', ['-axo', 'pid=,ppid=,command='], { encoding: 'utf8' }).trim().split('\n').map(line => {
  const [, pid, ppid, command] = line.match(/^\s*(\d+)\s+(\d+)\s+(.*)$/); return { pid: +pid, ppid: +ppid, command };
});
const results = [], cleanup = {}, owned = new Set(); let browser, profile, origin, failure;
function retainChildren() {
  const list = ps(); for (let changed = true; changed;) { changed = false;
    for (const p of list) if (owned.has(p.ppid) && !owned.has(p.pid)) { owned.add(p.pid); changed = true; }
  }
}
const geometry=page=>page.evaluate(()=>{
  const box=el=>{const b=el.getBoundingClientRect();return {x:b.x,y:b.y,width:b.width,height:b.height};};
  return {outlineText:document.querySelector('#outline').innerText,outlineBox:box(document.querySelector('#outline')),railScroll:document.querySelector('#rail').scrollTop,dim:box(document.querySelector('.rail-dim')),digits:[...document.querySelectorAll('.rail-dim button')].map(box),
    look:box(document.querySelector('.look-switch[data-switch=look]')),colors:box(document.querySelector('.look-switch[data-switch=agentColors]')),
    foot:[...document.querySelector('.rail-foot').children].map(el=>({class:el.className,id:el.id,box:box(el)}))};
});
try{
  const facts=await control({method:'ready'});origin=facts.origin;
  profile=await mkdtemp(`${evidence}/${engine}-profile-`);
  const persistent=await playwright[engine].launchPersistentContext(profile,{headless:true,...(engine==='chromium'?{executablePath:process.env.AIM_CHROME}:{})});
  browser=persistent.browser();for(const p of ps())if(p.command.includes(profile))owned.add(p.pid);retainChildren();assert.ok(owned.size);
  await writeFile(`${evidence}/owned-start.json`,JSON.stringify({profile,ownedPids:[...owned],fixturePid:fixture.pid,origin}));
  for(const look of ['','paper'])for(const colorScheme of ['light','dark'])for(const density of ['compact','roomy']){
    const context=await browser.newContext({viewport:{width:1280,height:1000},colorScheme});
    await context.addInitScript(({look,density})=>{if(look)localStorage.setItem('theseus-look',look);localStorage.setItem('theseus-rail-roomy',density==='roomy'?'1':'0');},{look,density});
    const page=await context.newPage(),pageErrors=[];page.on('pageerror',e=>pageErrors.push(e.message));page.setDefaultTimeout(5000);
    await page.goto(`${origin}/?topic=t1`);await page.locator('body[data-ready=true]').waitFor();await page.locator('.look-switch[data-switch=agentColors]').waitFor({state:'visible'});await page.locator('#outline .ol-outcome[data-workspace-id=w1]').waitFor({state:'visible'});await page.evaluate(()=>document.fonts.ready);
    // A provisional current-outcome row precedes its real standing line.
    // Finish the actual owner's read before comparing absolute footer boxes.
    await page.evaluate(async()=>{
      const app=[...document.scripts].find(s=>s.src.includes('/app.mjs'));
      const {panes}=await import(new URL('./panes.mjs',app.src).href);
      if(!panes.outline)throw Error('actual outline owner missing');
      await panes.outline.reload();
    });
    let before=await geometry(page),cssControl;let error;
    const key=`${look||'bookends'}-${colorScheme}-${density}`;
    try{
      if(process.env.AIM_980_BASELINE!=='1'){
        // Revert exactly the new CSS rule in this settled native document,
        // then restore its own bytes. Other loads can move the whole footer
        // while the outline finishes reading; this control changes only980.
        const rule=await page.evaluate(()=>{
          const sheet=[...document.styleSheets].find(s=>s.href?.endsWith('/rails.css'));
          const index=[...sheet.cssRules].findIndex(r=>r.cssText.includes('--rail-dim-width'));
          if(index<0)throw Error('980 CSS rule missing');
          const css=sheet.cssRules[index].cssText;sheet.deleteRule(index);return {index,css};
        });
        let original;
        try{await page.evaluate(()=>new Promise(done=>requestAnimationFrame(()=>requestAnimationFrame(done))));original=await geometry(page);}
        finally{await page.evaluate(({index,css})=>{[...document.styleSheets].find(s=>s.href?.endsWith('/rails.css')).insertRule(css,index);},rule);}
        await page.evaluate(()=>new Promise(done=>requestAnimationFrame(()=>requestAnimationFrame(done))));before=await geometry(page);
        cssControl={original,restored:before,ruleRestored:true};
        assert.ok(Math.abs(original.dim.width-original.colors.width)>1,'actual980 rule removal restores the width failure');
        assert.equal(before.foot.length,original.foot.length);
        before.foot.forEach((el,i)=>{const old=original.foot[i];assert.deepEqual([el.class,el.id],[old.class,old.id]);for(const axis of ['x','y','width','height'])if(!(el.class==='rail-dim'&&axis==='width'))assert.ok(Math.abs(el.box[axis]-old.box[axis])<.6,`${el.class||el.id} keeps ${axis} in the same settled page`);});
      }
      assert.ok(Math.abs(before.dim.width-before.colors.width)<.6,'Dim matches Quiet|Vivid directly below');assert.ok(Math.max(...before.digits.map(b=>b.width))-Math.min(...before.digits.map(b=>b.width))<.6,'numeric segments share width evenly');
    }catch(e){error=e.stack;}
    results.push({key:`${engine}-${look||'bookends'}-${colorScheme}-${density}-geometry`,before,cssControl,error:error??null});
    let behaviorError;
    try{
      for(const n of [1,2,0]){await page.locator(`.rail-dim button[data-dim-set="${n}"]`).click();assert.equal(await page.locator(`.rail-dim button[data-dim-set="${n}"]`).getAttribute('aria-pressed'),'true');}
      for(const [attr,value]of [['agentColors','vivid'],['agentColors',''],['look','paper'],['look','']]){
        await page.locator(`.look-switch[data-switch="${attr}"] button[data-value="${value}"]`).click();assert.equal(await page.evaluate(attr=>document.documentElement.dataset[attr]??'',attr),value);
      }
      assert.deepEqual(pageErrors,[]);
    }catch(e){behaviorError=e.stack;}
    results.push({key:`${engine}-${look||'bookends'}-${colorScheme}-${density}-behavior`,after:await geometry(page),error:behaviorError??null,pageErrors});
    if(process.env.AIM_980_BASELINE!=='1'){
    let followError;
    try{
      const palette=page.locator('.look-switch[data-switch=agentColors]'),initial=await geometry(page),priorStyle=await palette.getAttribute('style');
      await palette.evaluate((el,width)=>{el.style.width=`${width+12}px`;},initial.colors.width);
      await page.waitForFunction(()=>{const dim=document.querySelector('.rail-dim').getBoundingClientRect(),palette=document.querySelector('.look-switch[data-switch=agentColors]').getBoundingClientRect();return Math.abs(dim.width-palette.width)<.6&&palette.width>90;});
      const changed=await geometry(page);assert.ok(changed.colors.width>initial.colors.width+10);assert.ok(Math.abs(changed.dim.width-changed.colors.width)<.6);
      await palette.evaluate((el,style)=>{style===null?el.removeAttribute('style'):el.setAttribute('style',style);},priorStyle);
      await page.waitForFunction(width=>Math.abs(document.querySelector('.rail-dim').getBoundingClientRect().width-width)<.6,initial.colors.width);
      await page.locator('#outline .ol-name[data-workspace-id=w1]').click();await page.waitForURL('**/?workspace=w1');await page.locator('body[data-ready=true]').waitFor();
      await page.waitForFunction(()=>document.querySelector('.rail-dim button[data-dim-set="0"]'));
      const moved=await geometry(page);assert.ok(Math.abs(moved.dim.width-moved.colors.width)<.6);
      await page.locator('.rail-dim button[data-dim-set="2"]').click();assert.equal(await page.locator('.rail-dim button[data-dim-set="2"]').getAttribute('aria-pressed'),'true');
      assert.deepEqual(pageErrors,[]);
    }catch(e){followError=e.stack;}
    results.push({key:`${engine}-${key}-source-resize-restore-and-navigation`,after:await geometry(page),error:followError??null,pageErrors});
    }
    if(look===''&&colorScheme==='dark'&&density==='compact')await page.screenshot({path:`${evidence}/footer.png`});
    await writeFile(`${evidence}/observations.json`,JSON.stringify(results,null,2));await context.close();
  }
  const context=await browser.newContext({viewport:{width:390,height:844},hasTouch:true,isMobile:true}),page=await context.newPage();
  let touchError;
  try{
    await page.goto(`${origin}/?topic=t1`);await page.locator('body[data-ready=true]').waitFor();await page.locator('#rail-open').tap();
    const boxes=await page.locator('.rail-dim button').evaluateAll(buttons=>buttons.map(b=>{const r=b.getBoundingClientRect();return {width:r.width,height:r.height};}));
    assert.equal(boxes.length,3);assert.ok(boxes.every(b=>b.width>=44&&b.height>=44));
    for(const n of [1,2,0]){await page.locator(`.rail-dim button[data-dim-set="${n}"]`).tap();assert.equal(await page.locator(`.rail-dim button[data-dim-set="${n}"]`).getAttribute('aria-pressed'),'true');}
  }catch(e){touchError=e.stack;}
  results.push({key:`${engine}-390-touch-targets`,error:touchError??null});await context.close();
} catch(caught) { failure=caught; }
finally {
  if (browser) { retainChildren(); await browser.close(); cleanup.browserClosed = !browser.isConnected(); }
  const after = ps(); cleanup.ownedPids = [...owned]; cleanup.remainingOwned = after.filter(p => owned.has(p.pid));
  cleanup.profileProcesses = profile ? after.filter(p => p.command.includes(profile)) : [];
  if (profile && cleanup.browserClosed && !cleanup.remainingOwned.length && !cleanup.profileProcesses.length) {
    await rm(profile, { recursive: true }); cleanup.profileRemoved = await access(profile).then(() => false, () => true);
  }
  fixture.stdin.end(); cleanup.fixtureExit = await exit; cleanup.fixtureErrors = errors(); cleanup.fixturePid = fixture.pid;
  cleanup.fixtureAbsent = !ps().some(p => p.pid === fixture.pid);
  if (origin) cleanup.portClosed = await new Promise(resolve => {
    const url = new URL(origin), socket = net.createConnection({ host: url.hostname, port: +url.port });
    socket.once('connect', () => { socket.destroy(); resolve(false); }); socket.once('error', () => resolve(true));
  });
  await writeFile(`${evidence}/results.json`, JSON.stringify({ results, cleanup, failure: failure?.stack ?? null }, null, 2));
}
assert.equal(cleanup.fixtureExit.code, 0); assert.equal(cleanup.fixtureAbsent, true); assert.equal(cleanup.portClosed, true);
if (failure) throw failure;
assert.equal(cleanup.browserClosed, true); assert.deepEqual(cleanup.remainingOwned, []); assert.deepEqual(cleanup.profileProcesses, []);
assert.ok(results.length && results.every(result => !result.error), '980 width and retained footer behavior pass; inspect evidence');
console.log(JSON.stringify({ passed: results.length, cleanup }));

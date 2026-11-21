// Native first-paint observations in an isolated HTTP/Core instance.
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, writeFile, rm, access } from 'node:fs/promises';
import net from 'node:net';
import { fixtureControl } from './fixture_control.mjs';
const playwright = await import(process.env.AIM_PLAYWRIGHT_CORE), engine = process.env.AIM_ENGINE ?? 'chromium';
const evidence = process.argv[2], baseline = process.env.AIM_976_BASELINE === '1';
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
const sample = () => {
  const rows = [...document.querySelectorAll('#outline a.nav-item[data-topic-id]')].filter(el => el.getClientRects().length).map(el => {
    const s=getComputedStyle(el), r=el.getBoundingClientRect(), list=el.parentElement;
    return {id:el.dataset.topicId, outcome:el.closest('.ol-outcome')?.dataset.workspaceId, color:s.color,
      decoration:s.textDecorationLine, font:s.fontSize, line:s.lineHeight, display:s.display,current:el.getAttribute('aria-current')==='page',
      width:r.width,height:r.height,listId:list.id,listClass:list.className,inert:Boolean(el.closest('[inert]'))};
  });
  return {url:location.href,ready:document.body.dataset.ready??null,rows,
    sheets:[...document.querySelectorAll('link[rel=stylesheet]')].map(el=>({href:el.href,loaded:Boolean(el.sheet)}))};
};
try {
  const facts=await control({method:'ready'});origin=facts.origin;
  await control({method:'navigation_workspaces',workspaces:[{id:'w976',title:'Other outcome',team:[]}]});
  const receipts=await control({method:'navigation_topics',topics:[{id:'t976a',title:'Current topic A'},{id:'t976b',title:'Current topic B'},{id:'t976c',title:'Other topic C',workspace_id:'w976'}]});
  assert.ok(receipts.every(r=>r.status==='committed'));
  profile=await mkdtemp(`${evidence}/${engine}-profile-`);
  const persistent=await playwright[engine].launchPersistentContext(profile,{headless:true,...(engine==='chromium'?{executablePath:process.env.AIM_CHROME}:{})});
  browser=persistent.browser();for(const p of ps())if(p.command.includes(profile))owned.add(p.pid);retainChildren();assert.ok(owned.size);
  await writeFile(`${evidence}/owned-start.json`,JSON.stringify({profile,ownedPids:[...owned],fixturePid:fixture.pid,origin}));
  const cells=baseline?[['','dark','compact']]:['','paper'].flatMap(look=>['light','dark'].flatMap(scheme=>['compact','roomy'].map(density=>[look,scheme,density])));
  for(const [look,colorScheme,density] of cells){
    const context=await browser.newContext({viewport:{width:1280,height:1000},colorScheme});
    await context.addInitScript(({instance,actor,look,density})=>{
      localStorage.setItem(`aim-next.outline-open.${JSON.stringify([instance,actor])}`,JSON.stringify({w1:true,w976:true}));
      localStorage.setItem('theseus-rail-roomy',density==='roomy'?'1':'0');
      if(look)localStorage.setItem('theseus-look',look);
    },{instance:facts.instance_id,actor:facts.actor,look,density});
    const page=await context.newPage(),pageErrors=[],css=[];page.setDefaultTimeout(7000);
    page.on('pageerror',e=>pageErrors.push(e.message));page.on('request',r=>{if(new URL(r.url()).pathname.endsWith('.css'))css.push(r.url());});
    await page.goto(`${origin}/?topic=t1`);await page.locator('body[data-ready=true]').waitFor();
    const topic=id=>page.locator(`#outline a.nav-item[data-topic-id="${id}"]`);
    await topic('t976a').waitFor({state:'visible'});await topic('t976c').waitFor({state:'visible'});
    assert.equal(await page.evaluate(()=>document.documentElement.hasAttribute('data-rail-roomy')),density==='roomy');
    const initialSheets=await page.evaluate(sample),initialCss=[...css];
    assert.equal(initialCss.length,new Set(initialCss).size,'each stylesheet loaded once on document arrival');
    assert.ok(initialSheets.sheets.every(s=>s.loaded));
    const moves=[['normal-same-outcome',topic('t976a'),'?topic=t976a',false],['held-same-outcome',topic('t976b'),'?topic=t976b',true]];
    if(!baseline)moves.push(['held-other-outcome',topic('t976c'),'?topic=t976c',true],['held-outcome-home',page.locator('#outline .ol-name[data-workspace-id="w1"]'),'?workspace=w1',true]);
    for(const [name,target,query,hold]of moves){
      await page.mouse.move(1000,900);const before=await page.evaluate(sample);
      let release,held,seen;const routing=[],routeErrors=[];const reached=new Promise(done=>seen=done),gate=new Promise(done=>release=done);
      if(hold)await page.route('**/api/bootstrap',route=>{const job=(async()=>{held=true;seen();await gate;await route.continue();})().catch(e=>routeErrors.push(e.message));routing.push(job);return job;});
      await page.evaluate(fn=>{
        window.rail976Frames=[];window.rail976Sample=eval(`(${fn})`);window.rail976Running=true;
        const frame=()=>{if(!window.rail976Running)return;window.rail976Frames.push(window.rail976Sample());requestAnimationFrame(frame);};requestAnimationFrame(frame);
      },sample.toString());
      let error,heldShot;
      try{
        await target.click({position:{x:20,y:10},noWaitAfter:true});
        if(hold){
          await Promise.race([reached,new Promise((_,reject)=>setTimeout(()=>reject(Error('native navigation did not reach bootstrap gate')),7000))]);
          await page.evaluate(()=>new Promise(done=>requestAnimationFrame(()=>requestAnimationFrame(done))));
          heldShot=await page.evaluate(sample);await page.screenshot({path:`${evidence}/${engine}-${look||'bookends'}-${colorScheme}-${density}-${name}-held.png`});
          release();await Promise.all(routing);await page.unroute('**/api/bootstrap');
        }
        await page.waitForURL(url=>url.search===query);await page.locator('body[data-ready=true]').waitFor();
        if(query.startsWith('?topic='))await page.waitForFunction(id=>document.querySelector(`#outline a.nav-item[data-topic-id="${id}"]`)?.getAttribute('aria-current')==='page',query.slice(7));
        await page.mouse.move(1000,900);await page.evaluate(()=>new Promise(done=>requestAnimationFrame(()=>requestAnimationFrame(done))));
      }catch(caught){error=caught.stack;release();await Promise.all(routing);}
      const frames=await page.evaluate(()=>{window.rail976Running=false;return window.rail976Frames;}),after=await page.evaluate(sample);
      const flash=frames.flatMap((f,index)=>f.rows.filter(r=>r.decoration.includes('underline')||r.display!=='block').map(row=>({index,...row})));
      const noSheets=JSON.stringify(css)===JSON.stringify(initialCss),allLoaded=frames.every(f=>f.sheets.every(s=>s.loaded));
      try{assert.ok(frames.length,'native animation frames observed');assert.deepEqual(flash,[],'retained rail rows stay styled at each observed paint');
        for(const frame of frames)for(const row of frame.rows){const prior=before.rows.find(r=>r.id===row.id);if(prior)for(const key of ['font','line','display','width','height'])assert.equal(row[key],prior[key],`retained ${row.id} keeps ${key} at a real frame`);}
        for(const row of after.rows){const prior=before.rows.find(r=>r.id===row.id);if(prior&&!prior.current&&!row.current)for(const key of ['color','decoration','font','line','display','width','height'])assert.equal(row[key],prior[key],`settled ${row.id} keeps ${key}`);}
        assert.equal(noSheets,true,'navigation requests no stylesheet');assert.equal(allLoaded,true,'stylesheets remain loaded');assert.deepEqual(pageErrors,[]);assert.deepEqual(routeErrors,[]);}catch(caught){error??=caught.stack;}
      // Settled paint is checked independently even when the transition oracle fails.
      const settled={unstyled:after.rows.filter(r=>r.decoration.includes('underline')||r.display!=='block'),sameSheets:noSheets,pageErrors:[...pageErrors]};
      results.push({key:`${engine}-${look||'bookends'}-${colorScheme}-${density}-${name}`,before,held:held??false,heldShot,frames,after,flash,settled,error:error??null});
      await writeFile(`${evidence}/observations.json`,JSON.stringify(results,null,2));
      await page.screenshot({path:`${evidence}/${engine}-${look||'bookends'}-${colorScheme}-${density}-${name}-settled.png`});
      if(error&&!baseline)break;
    }
    assert.equal(css.length,new Set(css).size);await context.close();
  }
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
assert.ok(results.length && results.every(result => !result.error), '976 retained rail paint and navigation pass; inspect evidence');
console.log(JSON.stringify({ passed: results.length, cleanup }));

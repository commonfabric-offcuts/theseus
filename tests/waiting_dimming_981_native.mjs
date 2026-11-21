// Native waiting-filter/dim composition in an isolated HTTP/Core instance.
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, writeFile, rm, access } from 'node:fs/promises';
import net from 'node:net';
import { fixtureControl } from './fixture_control.mjs';
const playwright = await import(process.env.AIM_PLAYWRIGHT_CORE), engine = process.env.AIM_ENGINE ?? 'chromium';
const evidence = process.argv[2];
await mkdir(evidence, { recursive: true });
const fixture = spawn('/usr/bin/python3', ['-B', 'tests/fixtures/ui_http.py', '--freshness', '--live']);
const { control, exit, errors } = fixtureControl(fixture);
const ps = () => execFileSync('/bin/ps', ['-axo', 'pid=,ppid=,command='], { encoding: 'utf8' }).trim().split('\n').map(line => {
  const [, pid, ppid, command] = line.match(/^\s*(\d+)\s+(\d+)\s+(.*)$/); return { pid: +pid, ppid: +ppid, command };
});
const results = [], cleanup = {}, owned = new Set(),fixtureOwned=new Set([fixture.pid]); let browser, profile, origin, failure;
function retainChildren() {
  const list = ps(); for (let changed = true; changed;) { changed = false;
    for (const p of list) if (owned.has(p.ppid) && !owned.has(p.pid)) { owned.add(p.pid); changed = true; }
  }
}
function retainFixtureChildren(){const list=ps();for(let changed=true;changed;){changed=false;for(const p of list)if(fixtureOwned.has(p.ppid)&&!fixtureOwned.has(p.pid)){fixtureOwned.add(p.pid);changed=true;}}}
const baseline=process.env.AIM_981_BASELINE==='1';
const shot=page=>page.evaluate(()=>{
  const box=el=>{const b=el.getBoundingClientRect();return {x:b.x,y:b.y,width:b.width,height:b.height};};
  const data=el=>{const name=el.querySelector('.ol-title')??el,style=getComputedStyle(name),probe=document.createElement('span');
    probe.style.color='color-mix(in srgb,var(--ink) 15%,var(--paper))';el.append(probe);const dimInk=getComputedStyle(probe).color;probe.remove();
    return {id:el.dataset.topicId??el.dataset.workspaceId,shown:el.getClientRects().length>0,dimmed:el.dataset.dimmed??el.closest('.ol-outcome')?.dataset.dimmed,
      current:el.getAttribute('aria-current'),color:style.color,weight:style.fontWeight,dimInk,box:box(el),
      badge:el.querySelector('.unread-count')?getComputedStyle(el.querySelector('.unread-count')).visibility:null,
      waits:el.hasAttribute('data-cover-waiting')||Boolean(el.querySelector('.topic-state.mine'))};};
  return {url:location.search,count:document.querySelector('#outline-only-waiting .n').textContent,pressed:document.querySelector('#outline-only-waiting').getAttribute('aria-pressed'),
    choices:[...document.querySelectorAll('.rail-dim button')].map(b=>[b.textContent,b.getAttribute('aria-pressed')]),
    outcomes:[...document.querySelectorAll('#outline .ol-outcome')].map(li=>({id:li.dataset.workspaceId,shown:!li.hidden,open:li.hasAttribute('data-open'),row:data(li.querySelector('.ol-name'))})),
    topics:[...document.querySelectorAll('#outline a.nav-item[data-topic-id]')].map(data)};
});
const topicIn=(s,id)=>{const r=s.topics.find(r=>r.id===id);assert.ok(r,`actual topic row ${id}`);return r;};
const outcomeIn=(s,id)=>{const r=s.outcomes.find(r=>r.id===id);assert.ok(r);return r;};
const sameBox=(a,b)=>{for(const k of ['x','y','width','height'])assert.ok(Math.abs(a[k]-b[k])<.6,`${k} retains rail shape`);};
try{
  const facts=await control({method:'ready'});origin=facts.origin;retainFixtureChildren();
  await control({method:'navigation_workspaces',workspaces:[{id:'w981other',title:'Other quiet outcome',team:[]},{id:'w981fold',title:'Folded quiet outcome',team:[]}]});
  const created=await control({method:'navigation_topics',topics:[{id:'q981',title:'Quiet topic'},{id:'a981',title:'Topic waiting on the reader'},{id:'c981',title:'Dossier cover waiting on the reader'},{id:'o981',title:'Other quiet topic',workspace_id:'w981other'},{id:'f981',title:'Folded topic',workspace_id:'w981fold'}]});
  assert.ok(created.every(r=>r.status==='committed'));
  let serial=0;const said=state=>control({method:'topic_state',operation_id:`981-said-${++serial}`,topic_id:'a981',args:{state,waiting_on:state==='waiting'?[facts.actor]:[]}});
  assert.equal((await said('waiting')).status,'committed');
  assert.equal((await control({method:'agent_message',operation_id:'981-cover-participant',topic_id:'c981',join:true,sender:facts.agent,reply_to:created[2].result.message_id,body:'Isolated cover preparation.',reply_without_quote:'981 isolated cover setup.'})).status,'committed');
  assert.equal((await control({method:'agent_message',operation_id:'981-unread',topic_id:'q981',join:true,sender:facts.agent,reply_to:created[0].result.message_id,body:'An unread quiet-topic reply.',reply_without_quote:'981 isolated badge control.'})).status,'committed');
  const cover=on=>control({method:'stack_act',operation_id:`981-cover-${++serial}`,sender:facts.agent,message_id:created[2].result.message_id,kind:'stack.cover',args:{waiting:on?[{text:'Review this isolated result?',default:'Kept pending'}]:[]}});
  assert.equal((await cover(true)).status,'committed');
  profile=await mkdtemp(`${evidence}/${engine}-profile-`);
  const persistent=await playwright[engine].launchPersistentContext(profile,{headless:true,...(engine==='chromium'?{executablePath:process.env.AIM_CHROME}:{})});
  browser=persistent.browser();cleanup.engine=browser.browserType().name();cleanup.version=browser.version();assert.equal(cleanup.engine,engine);for(const p of ps())if(p.command.includes(profile))owned.add(p.pid);retainChildren();assert.ok(owned.size);
  await writeFile(`${evidence}/owned-start.json`,JSON.stringify({profile,ownedPids:[...owned],fixturePid:fixture.pid,origin}));
  const cells=baseline?[['','dark','compact']]:['','paper'].flatMap(look=>['light','dark'].map(s=>[look,s,'compact'])).concat([['','dark','roomy'],['paper','light','roomy']]);
  for(const [look,colorScheme,density]of cells){
    // A preceding cell genuinely reads q981 during navigation. Give this
    // independent cell its own unread badge through Core, before arrival.
    assert.equal((await control({method:'agent_message',operation_id:`981-unread-cell-${++serial}`,topic_id:'q981',sender:facts.agent,reply_to:created[0].result.message_id,body:`Unread badge for cell${serial}.`,reply_without_quote:'981 isolated per-cell badge control.'})).status,'committed');
    const context=await browser.newContext({viewport:{width:1280,height:1000},colorScheme});
    await context.addInitScript(({look,density,instance,actor})=>{if(look)localStorage.setItem('theseus-look',look);localStorage.setItem('theseus-rail-roomy',density==='roomy'?'1':'0');localStorage.setItem(`aim-next.outline-open.${JSON.stringify([instance,actor])}`,JSON.stringify({w1:true,w981other:true,w981fold:false}));},{look,density,instance:facts.instance_id,actor:facts.actor});
    const page=await context.newPage(),pageErrors=[],reads=[];page.setDefaultTimeout(5000);page.on('pageerror',e=>pageErrors.push(e.message));
    page.on('request',r=>{if(r.url().endsWith('/api/view')){const p=r.postDataJSON();reads.push({name:p?.name,args:p?.args});}});
    await page.goto(`${origin}/?topic=t1`);await page.locator('body[data-ready=true]').waitFor();
    const settle=async()=>{await page.waitForFunction(async()=>{const app=[...document.scripts].find(s=>s.src.includes('/app.mjs'));const{panes}=await import(new URL('./panes.mjs',app.src).href);return panes.outline?.handles?.live?.state==='live';});await page.evaluate(async()=>{const app=[...document.scripts].find(s=>s.src.includes('/app.mjs'));const{panes}=await import(new URL('./panes.mjs',app.src).href);await panes.outline.reload();});await page.evaluate(()=>new Promise(done=>requestAnimationFrame(()=>requestAnimationFrame(done))));};
    await settle();await page.waitForFunction(()=>document.querySelector('#outline-only-waiting .n')?.textContent==='2');
    const pill=page.locator('#outline-only-waiting'),topic=id=>page.locator(`#outline a[data-topic-id="${id}"]`),away=()=>page.mouse.move(1000,950);
    const on=async()=>{if(await pill.getAttribute('aria-pressed')!=='true')await pill.click();await away();await page.evaluate(()=>new Promise(done=>requestAnimationFrame(()=>requestAnimationFrame(done))));};
    const off=async()=>{if(await pill.getAttribute('aria-pressed')==='true')await pill.click();await away();await page.evaluate(()=>new Promise(done=>requestAnimationFrame(()=>requestAnimationFrame(done))));};
    const choose=n=>page.locator(`.rail-dim button[data-dim-set="${n}"]`).click();
    const saved=()=>page.evaluate(key=>localStorage.getItem(key),`aim-next.rail-dimming.v1:${JSON.stringify([facts.instance_id,facts.actor])}`);
    async function check(name,act){let error;await away();const before=await shot(page);try{await act(before);assert.deepEqual(pageErrors,[]);}catch(e){error=e.stack;}const after=await shot(page);results.push({key:`${engine}-${look||'bookends'}-${colorScheme}-${density}-${name}`,before,after,error:error??null,pageErrors:[...pageErrors]});await writeFile(`${evidence}/observations.json`,JSON.stringify(results,null,2));if(error||name==='waiting-paint')await page.screenshot({path:`${evidence}/${engine}-${look||'bookends'}-${colorScheme}-${density}-${name}.png`});await off();}
    await check('rows-count-folds-and-no-list-read',async before=>{
      const listed=reads.filter(r=>['workspaces','workspace_topics'].includes(r.name)).length,store=await saved();await on();const after=await shot(page);
      assert.deepEqual(after.outcomes.map(r=>[r.id,r.shown,r.open]),before.outcomes.map(r=>[r.id,r.shown,r.open]));
      assert.equal(after.count,before.count);assert.equal(after.count,'2');
      for(const r of before.topics.filter(r=>r.shown)){const now=topicIn(after,r.id);assert.equal(now.shown,true);sameBox(r.box,now.box);}
      for(const r of before.outcomes)sameBox(r.row.box,outcomeIn(after,r.id).row.box);
      assert.equal(reads.filter(r=>['workspaces','workspace_topics'].includes(r.name)).length,listed,'waiting paint does not list-read');assert.equal(await saved(),store);
    });
    await check('waiting-paint',async before=>{
      await on();let s=await shot(page),q=topicIn(s,'q981');assert.equal(q.shown,true);assert.equal(q.color,q.dimInk);assert.equal(q.badge,'hidden','actual unread badge keeps its slot but hides');assert.notEqual(topicIn(s,'a981').color,topicIn(s,'a981').dimInk);assert.notEqual(topicIn(s,'c981').color,topicIn(s,'c981').dimInk);
      assert.notEqual(topicIn(s,'t1').color,topicIn(s,'t1').dimInk,'selected quiet row stays full');
      assert.equal(outcomeIn(s,'w981other').row.color,outcomeIn(s,'w981other').row.dimInk);assert.equal(outcomeIn(s,'w981other').row.weight,'500');
      await topic('q981').hover();s=await shot(page);assert.notEqual(topicIn(s,'q981').color,topicIn(s,'q981').dimInk,'hover restores full row');assert.equal(topicIn(s,'q981').badge,'visible','hover restores unread badge');assert.equal(topicIn(s,'o981').color,topicIn(s,'o981').dimInk);sameBox(topicIn(before,'q981').box,topicIn(s,'q981').box);
    });
    await check('saved-set-composition',async()=>{
      await choose(1);await topic('a981').click({modifiers:['Meta'],position:{x:20,y:10}});await away();const stored=await saved();
      await on();let s=await shot(page);assert.equal(topicIn(s,'q981').shown,true);assert.equal(topicIn(s,'q981').color,topicIn(s,'q981').dimInk);assert.notEqual(topicIn(s,'a981').color,topicIn(s,'a981').dimInk,'1003 reader wait overrides the saved layer');assert.equal(await saved(),stored);
      await choose(0);await away();s=await shot(page);assert.equal(topicIn(s,'q981').color,topicIn(s,'q981').dimInk,'0 leaves waiting layer');assert.notEqual(topicIn(s,'a981').color,topicIn(s,'a981').dimInk);
      await choose(1);await off();s=await shot(page);assert.notEqual(topicIn(s,'q981').color,topicIn(s,'q981').dimInk);assert.notEqual(topicIn(s,'a981').color,topicIn(s,'a981').dimInk);assert.equal(await saved(),stored);
      await topic('a981').click({modifiers:['Meta'],position:{x:20,y:10}});await choose(0);
    });
    await check('unchanged-count-control',async before=>{await on();assert.equal((await shot(page)).count,'2');await off();assert.equal((await shot(page)).count,before.count);});
    if(!baseline){
      await check('live-said-and-cover-waits',async()=>{
        await on();try{
          assert.equal((await cover(false)).status,'committed');await page.waitForFunction(()=>document.querySelector('#outline-only-waiting .n')?.textContent==='1'&&!document.querySelector('#outline a[data-topic-id=c981]')?.hasAttribute('data-cover-waiting'));
          await page.waitForFunction(()=>document.querySelector('#outline a[data-topic-id=c981]')?.dataset.dimmed==='true');let s=await shot(page);assert.equal(topicIn(s,'c981').shown,true);assert.equal(topicIn(s,'c981').color,topicIn(s,'c981').dimInk);
          assert.equal((await said('active')).status,'committed');await page.waitForFunction(()=>document.querySelector('#outline-only-waiting .n')?.textContent==='0'&&document.querySelector('#outline a[data-topic-id=a981]')?.dataset.dimmed==='true');
          s=await shot(page);assert.equal(s.pressed,'true');assert.equal(topicIn(s,'a981').shown,true);assert.equal(topicIn(s,'a981').color,topicIn(s,'a981').dimInk);
        }finally{await said('waiting');await cover(true);await page.waitForFunction(()=>document.querySelector('#outline-only-waiting .n')?.textContent==='2');}
      });
      await check('navigation-keeps-composed-paint',async()=>{
        await on();await topic('q981').click();await page.waitForURL('**/?topic=q981');await page.locator('body[data-ready=true]').waitFor();await settle();await away();let s=await shot(page);assert.equal(s.pressed,'true');assert.notEqual(topicIn(s,'q981').color,topicIn(s,'q981').dimInk);assert.equal(topicIn(s,'o981').shown,true);assert.equal(topicIn(s,'o981').color,topicIn(s,'o981').dimInk);await choose(2);assert.equal((await shot(page)).choices[2][1],'true');await choose(0);
      });
    }
    await check('new-filter-control',async()=>{
      await on();const fresh=page.locator('#outline-only-new');assert.equal(await fresh.isEnabled(),true);await fresh.click();assert.equal(await pill.getAttribute('aria-pressed'),'false');assert.equal(await fresh.getAttribute('aria-pressed'),'true');await page.waitForFunction(()=>document.querySelector('.ol-outcome[data-workspace-id=w981other]')?.hidden===true);await fresh.click();assert.equal(outcomeIn(await shot(page),'w981other').shown,true);
    });
    await context.close();
  }
  if(!baseline){
    const context=await browser.newContext({viewport:{width:390,height:844},hasTouch:true,isMobile:true});
    await context.addInitScript(({instance,actor})=>localStorage.setItem(`aim-next.outline-open.${JSON.stringify([instance,actor])}`,JSON.stringify({w1:true,w981other:true,w981fold:false})),{instance:facts.instance_id,actor:facts.actor});
    const page=await context.newPage();page.setDefaultTimeout(5000);let error,before,after;
    try{
      await page.goto(`${origin}/?topic=t1`);await page.locator('body[data-ready=true]').waitFor();await page.waitForFunction(()=>document.querySelector('#outline-only-waiting .n')?.textContent==='2');await page.locator('#rail-open').tap();
      await page.locator('#outline a[data-topic-id=q981]').waitFor({state:'visible'});before=await shot(page);
      await page.locator('#outline-only-waiting').tap();await page.waitForFunction(()=>document.querySelector('#outline a[data-topic-id=q981]')?.dataset.dimmed==='true');after=await shot(page);
      assert.equal(after.count,'2');assert.equal(topicIn(after,'q981').shown,true);assert.equal(topicIn(after,'q981').color,topicIn(after,'q981').dimInk);assert.equal(outcomeIn(after,'w981other').shown,true);
      await page.locator('#outline-only-waiting').tap();assert.equal((await shot(page)).pressed,'false');
    }catch(e){error=e.stack;await page.screenshot({path:`${evidence}/${engine}-390-failure.png`});}
    results.push({key:`${engine}-390-touch-waiting`,before,after,error:error??null});await context.close();
  }
} catch(caught) { failure=caught; }
finally {
  if (browser) { retainChildren(); await browser.close(); cleanup.browserClosed = !browser.isConnected(); }
  const after = ps(); cleanup.ownedPids = [...owned]; cleanup.remainingOwned = after.filter(p => owned.has(p.pid));
  cleanup.profileProcesses = profile ? after.filter(p => p.command.includes(profile)) : [];
  if (profile && cleanup.browserClosed && !cleanup.remainingOwned.length && !cleanup.profileProcesses.length) {
    await rm(profile, { recursive: true }); cleanup.profileRemoved = await access(profile).then(() => false, () => true);
  }
  retainFixtureChildren();fixture.stdin.end(); cleanup.fixtureExit = await exit; cleanup.fixtureErrors = errors(); cleanup.fixturePid = fixture.pid;
  cleanup.fixtureAbsent = !ps().some(p => p.pid === fixture.pid);cleanup.fixtureOwnedPids=[...fixtureOwned];cleanup.remainingFixtureOwned=ps().filter(p=>fixtureOwned.has(p.pid));
  if (origin) cleanup.portClosed = await new Promise(resolve => {
    const url = new URL(origin), socket = net.createConnection({ host: url.hostname, port: +url.port });
    socket.once('connect', () => { socket.destroy(); resolve(false); }); socket.once('error', () => resolve(true));
  });
  await writeFile(`${evidence}/results.json`, JSON.stringify({ engine, results, cleanup, failure: failure?.stack ?? null }, null, 2));
}
assert.deepEqual(cleanup.remainingFixtureOwned,[]);assert.equal(cleanup.fixtureExit.code, 0); assert.equal(cleanup.fixtureAbsent, true); assert.equal(cleanup.portClosed, true);
if (failure) throw failure;
assert.equal(cleanup.browserClosed, true); assert.deepEqual(cleanup.remainingOwned, []); assert.deepEqual(cleanup.profileProcesses, []);
assert.ok(results.length && results.every(result => !result.error), '981 waiting paint and saved-set composition pass; inspect evidence');
console.log(JSON.stringify({ passed: results.length, cleanup }));

// Native saved-view wait exemption and existing waiting filter in isolated Core/Live.
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, writeFile, rm, access } from 'node:fs/promises';
import net from 'node:net';
import {createHash} from 'node:crypto';
import { fixtureControl } from './fixture_control.mjs';
const playwright = await import(process.env.AIM_PLAYWRIGHT_CORE), engine = process.env.AIM_ENGINE ?? 'chromium';
const evidence = process.argv[2];
// The launch command supplies the actual frozen product-file hash. No harness filesystem read.
const sourceHash=process.env.AIM_1003_SOURCE_SHA256;assert.match(sourceHash??'',/^[a-f0-9]{64}$/,'supply actual product SHA256 before launching');
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
const baseline=process.env.AIM_1003_BASELINE==='1';
const shot=page=>page.evaluate(()=>{
  const box=el=>{const b=el.getBoundingClientRect();let x=b.x,y=b.y;for(let parent=el.parentElement;parent;parent=parent.parentElement){x+=parent.scrollLeft;y+=parent.scrollTop;}return {x,y,width:b.width,height:b.height,viewportX:b.x,viewportY:b.y};};
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
  await control({method:'navigation_workspaces',workspaces:[{id:'w1003other',title:'Other quiet outcome',team:[]},{id:'w1003fold',title:'Folded quiet outcome',team:[]}]});
  const created=await control({method:'navigation_topics',topics:[{id:'q1003',title:'Quiet topic'},{id:'a1003',title:'Topic waiting on the reader'},{id:'c1003',title:'Dossier cover waiting on the reader'},{id:'ask1003',title:'An open question to the reader'},{id:'o1003',title:'Other quiet topic',workspace_id:'w1003other'},{id:'f1003',title:'Folded topic',workspace_id:'w1003fold'}]});
  assert.ok(created.every(r=>r.status==='committed'));
  let serial=0;const said=state=>control({method:'topic_state',operation_id:`1003-said-${++serial}`,topic_id:'a1003',args:{state,waiting_on:state==='waiting'?[facts.actor]:[]}});
  assert.equal((await said('waiting')).status,'committed');
  assert.equal((await control({method:'agent_message',operation_id:'1003-cover-participant',topic_id:'c1003',join:true,sender:facts.agent,reply_to:created[2].result.message_id,body:'Isolated cover preparation.',reply_without_quote:'1003 isolated cover setup.'})).status,'committed');
  assert.equal((await control({method:'agent_message',operation_id:'1003-unread',topic_id:'q1003',join:true,sender:facts.agent,reply_to:created[0].result.message_id,body:'An unread quiet-topic reply.',reply_without_quote:'1003 isolated badge control.'})).status,'committed');
  const cover=on=>control({method:'stack_act',operation_id:`1003-cover-${++serial}`,sender:facts.agent,message_id:created[2].result.message_id,kind:'stack.cover',args:{waiting:on?[{text:'Review this isolated result?',default:'Kept pending'}]:[]}});
  assert.equal((await cover(true)).status,'committed');
  let lastAsk;const ask=async()=>lastAsk=await control({method:'agent_message',operation_id:`1003-ask-${++serial}`,topic_id:'ask1003',join:true,whole_topic:true,body:'A real isolated question for the reader.',post_args:{intent:'ask',addressees:[facts.actor],go_ahead:false,divergence_reason:'Separate1003 question',ask_wait:{root_id:null,cover_revision:0,questions:[{actor_id:facts.actor,text:'A real isolated question for the reader.',options:[],default:null,reason:'Synthetic factual question without choices or default'}]}}});
  const answer=()=>control({method:'agent_message',operation_id:`1003-answer-${++serial}`,topic_id:'ask1003',sender:'person',reply_to:lastAsk.result.message_id,reply_without_quote:'Answers the exact synthetic ask.',body:'The isolated answer clears the question.'});
  assert.equal((await ask()).status,'committed');
  profile=await mkdtemp(`${evidence}/${engine}-profile-`);
  const persistent=await playwright[engine].launchPersistentContext(profile,{headless:true,...(engine==='chromium'?{executablePath:process.env.AIM_CHROME}:{})});
  browser=persistent.browser();cleanup.engine=browser.browserType().name();cleanup.version=browser.version();assert.equal(cleanup.engine,engine);for(const p of ps())if(p.command.includes(profile))owned.add(p.pid);retainChildren();assert.ok(owned.size);
  await writeFile(`${evidence}/owned-start.json`,JSON.stringify({profile,ownedPids:[...owned],fixturePid:fixture.pid,origin}));
  const cells=baseline?[['bookends','light','compact']]:['bookends','paper'].flatMap(look=>['light','dark'].flatMap(theme=>['compact','roomy'].map(density=>[look,theme,density])));
  for(const[look,colorScheme,density]of cells){
    const key=`${engine}-${look}-${colorScheme}-${density}`,observations=[],pageErrors=[],reads=[];
    const context=await browser.newContext({viewport:{width:1280,height:1000},colorScheme});
    await context.addInitScript(({look,density,instance,actor})=>{localStorage.setItem('theseus-look',look);localStorage.setItem('theseus-rail-roomy',density==='roomy'?'1':'0');localStorage.setItem(`aim-next.outline-open.${JSON.stringify([instance,actor])}`,JSON.stringify({w1:true,w1003other:true,w1003fold:false}));},{look,density,instance:facts.instance_id,actor:facts.actor});
    const page=await context.newPage();page.setDefaultTimeout(7000);page.on('pageerror',e=>pageErrors.push(e.message));
    page.on('request',r=>{if(r.url().endsWith('/api/view')){const p=r.postDataJSON();reads.push({name:p?.name,args:p?.args});}});
    let error;
    try{
      await page.goto(origin+'/?topic=t1');await page.locator('body[data-ready=true]').waitFor();
      const app=await page.evaluate(()=>[...document.scripts].find(s=>s.src.includes('/app.mjs')).src);assert.equal(createHash('sha256').update(await(await page.request.get(new URL('./rail-dimming.mjs',app).href)).body()).digest('hex'),sourceHash,'exact served dimming owner');
      await page.waitForFunction(async()=>{const app=[...document.scripts].find(s=>s.src.includes('/app.mjs'));const{panes}=await import(new URL('./panes.mjs',app.src).href);return panes.outline?.handles?.live?.state==='live';});
      await page.evaluate(async()=>{const app=[...document.scripts].find(s=>s.src.includes('/app.mjs'));const{panes}=await import(new URL('./panes.mjs',app.src).href);await panes.outline.reload();});
      const topic=id=>page.locator(`#outline a[data-topic-id="${id}"]`),pill=page.locator('#outline-only-waiting'),away=()=>page.mouse.move(1000,950);
      const frame=async()=>{await away();await page.evaluate(()=>new Promise(done=>requestAnimationFrame(()=>requestAnimationFrame(done))));};
      const saved=()=>page.evaluate(key=>localStorage.getItem(key),`aim-next.rail-dimming.v1:${JSON.stringify([facts.instance_id,facts.actor])}`);
      const record=async phase=>{const state=await shot(page);observations.push({phase,...state});return state;};
      const wait=async(id,on)=>page.waitForFunction(({id,on})=>{const row=document.querySelector(`#outline a[data-topic-id="${id}"]`);return !!row&&(row.hasAttribute('data-cover-waiting')||!!row.querySelector('.topic-state.mine'))===on;},{id,on});
      for(const id of ['a1003','c1003','ask1003'])await wait(id,true);
      for(const selected of [1,2]){
        const listed=reads.filter(r=>['workspaces','workspace_topics'].includes(r.name)).length,before=await record('before Dim'+selected);
        await page.locator(`.rail-dim button[data-dim-set="${selected}"]`).click();
        if(selected===1)await page.locator('#outline .ol-name[data-workspace-id=w1]').click({modifiers:['Meta'],position:{x:20,y:10}});
        else await topic('t1').click({modifiers:['Meta','Shift'],position:{x:20,y:10}});
        await frame();const kept=await saved(),state=await record('Dim'+selected+' with waits');
        observations.push({phase:'list-read inventory during manual Dim'+selected,before:listed,after:reads.filter(r=>['workspaces','workspace_topics'].includes(r.name)).length,note:'Includes pending Live refreshes; zero-read paint is held below the browser, not attributed from this concurrent interval.'});
        for(const id of ['a1003','c1003','ask1003']){const row=topicIn(state,id);assert.equal(row.dimmed,'false',id+' reader wait stays full in Dim'+selected);assert.notEqual(row.color,row.dimInk);sameBox(topicIn(before,id).box,row.box);}
        assert.equal(topicIn(state,'q1003').color,topicIn(state,'q1003').dimInk,'quiet saved choice remains dim');assert.notEqual(topicIn(state,'t1').color,topicIn(state,'t1').dimInk,'current row stays full');
        const folds=state.outcomes.map(r=>[r.id,r.open]),count=state.count;
        if(selected===2){await pill.click();await frame();assert.equal((await shot(page)).count,count,'waiting pill keeps count');}
        assert.equal((await said('active')).status,'committed');await wait('a1003',false);await page.waitForFunction(()=>document.querySelector('#outline a[data-topic-id=a1003]')?.dataset.dimmed==='true');
        assert.equal((await said('waiting')).status,'committed');await wait('a1003',true);await page.waitForFunction(()=>document.querySelector('#outline a[data-topic-id=a1003]')?.dataset.dimmed==='false');
        assert.equal((await cover(false)).status,'committed');await wait('c1003',false);await page.waitForFunction(()=>document.querySelector('#outline a[data-topic-id=c1003]')?.dataset.dimmed==='true');
        assert.equal((await cover(true)).status,'committed');await wait('c1003',true);await page.waitForFunction(()=>document.querySelector('#outline a[data-topic-id=c1003]')?.dataset.dimmed==='false');
        assert.equal((await answer()).status,'committed');await wait('ask1003',false);await page.waitForFunction(()=>document.querySelector('#outline a[data-topic-id=ask1003]')?.dataset.dimmed==='true');
        assert.equal((await ask()).status,'committed');await wait('ask1003',true);await page.waitForFunction(()=>document.querySelector('#outline a[data-topic-id=ask1003]')?.dataset.dimmed==='false');
        if(selected===2){await pill.click();await frame();}
        await page.waitForFunction(count=>document.querySelector('#outline-only-waiting .n')?.textContent===count,count);
        const after=await record('Dim'+selected+' after real Live clear and reapply');assert.equal(await saved(),kept,'Live waits preserve exact saved bytes');assert.deepEqual(after.outcomes.map(r=>[r.id,r.open]),folds);assert.equal(after.count,count);
      }
      await page.screenshot({path:`${evidence}/${key}.png`});
      const sets=JSON.parse(await saved()).sets;await page.locator('.rail-dim button[data-dim-set="0"]').click();await pill.click();await frame();let state=await record('Dim0 with waiting pill');
      assert.equal(topicIn(state,'q1003').color,topicIn(state,'q1003').dimInk);for(const id of ['a1003','c1003','ask1003'])assert.notEqual(topicIn(state,id).color,topicIn(state,id).dimInk);
      await pill.click();await frame();state=await record('Dim0 pill off');assert.notEqual(topicIn(state,'q1003').color,topicIn(state,'q1003').dimInk);assert.deepEqual(JSON.parse(await saved()).sets,sets);assert.deepEqual(pageErrors,[]);
    }catch(e){error=e.stack;observations.push({phase:'failure',...await shot(page).catch(()=>({}))});await page.screenshot({path:`${evidence}/${key}-failure.png`}).catch(()=>{});}
    results.push({key,error:error??null,observations,pageErrors,reads});await writeFile(`${evidence}/observations.json`,JSON.stringify(results,null,2));retainChildren();await context.close();
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
  await writeFile(`${evidence}/results.json`, JSON.stringify({ engine, sourceHash, results, cleanup, failure: failure?.stack ?? null }, null, 2));
}
assert.deepEqual(cleanup.remainingFixtureOwned,[]);assert.equal(cleanup.fixtureExit.code, 0); assert.equal(cleanup.fixtureAbsent, true); assert.equal(cleanup.portClosed, true);
if (failure) throw failure;
assert.equal(cleanup.browserClosed, true); assert.deepEqual(cleanup.remainingOwned, []); assert.deepEqual(cleanup.profileProcesses, []);
assert.equal(cleanup.profileRemoved,true);
assert.ok(results.length && results.every(result => !result.error), '1003 reader wait exemption and Live restoration pass; inspect evidence');
console.log(JSON.stringify({ passed: results.length, cleanup }));

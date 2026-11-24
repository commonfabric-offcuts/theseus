// Actual card passage/Reader return/inline Send on a scratch HTTP/Core origin.
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { mkdir, writeFile, readFile, mkdtemp, rm, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import net from 'node:net';
import { fixtureControl } from './fixture_control.mjs';

const playwright = await import(process.env.AIM_PLAYWRIGHT_CORE);
const evidence = process.argv[2], engine = process.argv.includes('--webkit') ? 'webkit' : 'chromium';
const only = process.argv.find(x => x.startsWith('--only='))?.slice(7);
const withoutMedia = process.argv.includes('--without-media');
await mkdir(evidence, { recursive: true });
const results = [], cleanup = {}, hashes = {};
for (const file of ['web/outcome-topic-cards.mjs','web/outcome-page-layout.mjs','web/outcome-purpose.mjs','web/outcome-references.mjs','web/app.mjs','web/outcome-page.css','web/index.html'])
  hashes[file] = createHash('sha256').update(await readFile(file)).digest('hex');
hashes.harness = createHash('sha256').update(await readFile(new URL(import.meta.url))).digest('hex');
const child = spawn('/usr/bin/python3', ['tests/fixtures/ui_http.py', '--freshness']);
const { control, exit, errors: fixtureErrors } = fixtureControl(child);
cleanup.fixturePid = child.pid;
let browser, profile, origin, activePage, failure, release;
const processRows = () => execFileSync('/bin/ps',['-axo','pid=,ppid=,command='],{encoding:'utf8'}).split('\n').map(line=>{
  const match=line.match(/^\s*(\d+)\s+(\d+)\s+(.+)$/);return match?{pid:Number(match[1]),parent:Number(match[2]),command:match[3]}:null;
}).filter(Boolean);
try {
  const facts = await control({ method: 'ready' }); origin = facts.origin;
  if(engine==='webkit'){
    profile=await mkdtemp(join(tmpdir(),'page-lane6-960-webkit-'));
    const context=await playwright.webkit.launchPersistentContext(profile,{headless:true});browser=context.browser();assert.ok(browser);
    const rows=processRows(),owned=new Set(rows.filter(row=>row.command.includes(profile)).map(row=>row.pid));assert.ok(owned.size,'WebKit owns its explicit profile process');
    for(let changed=true;changed;){changed=false;for(const row of rows)if(owned.has(row.parent)&&!owned.has(row.pid)){owned.add(row.pid);changed=true;}}
    cleanup.observedBrowserPids=[...owned];
  }else browser=await playwright.chromium.launch({executablePath:process.env.AIM_CHROME,headless:true,args:['--enable-automation']});
  if (engine === 'chromium') {
    const cdp = await browser.newBrowserCDPSession();
    profile = (await cdp.send('Browser.getBrowserCommandLine')).arguments.find(x => x.startsWith('--user-data-dir='))?.slice(16);
    cleanup.observedBrowserPids = (await cdp.send('SystemInfo.getProcessInfo')).processInfo.map(x => x.id);
    assert.ok(profile);
  }
  for (const id of ['t960one','t960two','t960ten']) await control({method:'light_outcome',outcome:'w960',exists:id!=='t960one',title:'Outcome960',topic:{id,title:id}});
  const latest='Current newest960 prose';
  for (const [id,count] of [['t960two',1],['t960ten',9]]) for(let n=0;n<count;n++) {
    const sent=await control({method:'agent_message',sender:facts.agent,topic_id:id,whole_topic:true,post_args:{divergence_reason:'Isolated960 native card'},body:latest,operation_id:`960-${id}-${n}`});assert.equal(sent.status,'committed');
  }
  const waiting=await control({method:'agent_state',sender:facts.agent,topic_id:'t960two',operation_id:'960-waits',args:{state:'waiting',waiting_on:[facts.actor]}});assert.equal(waiting.status,'committed');
  const note=await control({method:'agent_page',item_id:'n960',owner_scope:{kind:'workspace',id:'w960'},title:'Train window',body:'# Train window\n\nThe train leaves at seven.',operation_id:'960-note'});assert.equal(note.status,'committed');
  const cells=withoutMedia?[[1440,'light','bookends'],[1440,'dark','paper']]:process.argv.includes('--quick')?[[1440,'light','bookends']]:[1440,1280,1000,390].flatMap(width=>['light','dark'].flatMap(scheme=>['bookends','paper'].map(look=>[width,scheme,look])));
  for (const [width,colorScheme,look] of cells) {
    const key=`${width}-${colorScheme}-${look}`,result={key,phases:[]};results.push(result);
    const context=await browser.newContext({viewport:{width,height:1000},colorScheme,hasTouch:width===390});
    await context.addInitScript(look=>localStorage.setItem('theseus-look',look==='paper'?'paper':''),look);
    const page=await context.newPage();activePage=page;page.setDefaultTimeout(8000);const errors=[],views=[];result.errors=errors;
    page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{try{if(r.url().endsWith('/api/view'))views.push(r.postDataJSON().name);}catch{}});
    await page.goto(origin+'/?workspace=w960');await page.locator('body[data-ready=true]').waitFor();
    if(withoutMedia){
      // The legacy application bootstrap has other media-dependent owners.
      // Remove the API only around this real component's construction, in
      // one browser task, then restore it before any unrelated owner runs.
      result.probe=await page.evaluate(async()=>{
        const [{OutcomePageLayout},{PurposeLine}]=await Promise.all([import('/outcome-page-layout.mjs'),import('/outcome-purpose.mjs')]);
        const root=document.createElement('div'),header=document.createElement('header'),host=document.createElement('section'),team=document.createElement('section'),description=document.createElement('p'),purposeHost=document.createElement('div');
        host.id='outcome-page';host.className='selection-page';header.append(description,team);host.append(purposeHost);root.append(header,host);document.body.append(root);
        const original=window.matchMedia;let layout,observer;
        try{
          window.matchMedia=undefined;
          layout=new OutcomePageLayout({host,team,cards:{filter(){}},reader:'probe',color:()=> 'olive'});
          const purpose=new PurposeLine({host:purposeHost,description,save:()=>{throw Error('No save in this rendering probe');}});
          observer=new MutationObserver(()=>{});
          observer.observe(header,{childList:true});observer.observe(purposeHost,{childList:true});
          purpose.paint({id:'probe',purpose:'Probe purpose',version:1},true);layout.setPurpose(purpose);
          const movedPurposeNodes=observer.takeRecords().flatMap(change=>[...change.addedNodes,...change.removedNodes]).filter(node=>node===description||node===purpose.action).length;
          return {teamInHeader:team.parentNode===header,purposeInHeader:description.parentNode===header,movedPurposeNodes,wideAttribute:host.hasAttribute('data-outcome-wide'),wideSectionAttached:layout.section.isConnected,display:getComputedStyle(host).display,action:purpose.action.textContent};
        }finally{observer?.disconnect();window.matchMedia=original;layout?.dispose();root.remove();}
      });
      assert.equal(result.probe.movedPurposeNodes,0,'default narrow paint does not reparent the description or action');
      assert.equal(result.probe.teamInHeader,true);assert.equal(result.probe.purposeInHeader,true);assert.equal(result.probe.wideAttribute,false);assert.equal(result.probe.wideSectionAttached,false);assert.notEqual(result.probe.display,'grid');assert.equal(result.probe.action,'Edit purpose');assert.deepEqual(errors,[]);
      result.phases.push('component-scoped media capability absence: original narrow DOM and CSS in native browser');result.passed=true;console.log(JSON.stringify({key,passed:true,probe:result.probe}));await context.close();continue;
    }
    const toggle=page.locator('.ol-outcome[data-workspace-id="w960"] .ol-disclosure');
    // Phone drawers hide the disclosure; use the actual Outcomes control first.
    if(width===390)await page.locator('#rail-open').click();
    if(await toggle.getAttribute('aria-expanded')==='false')await toggle.click();
    if(width===390)await page.locator('#rail-backdrop').click({position:{x:380,y:500}});
    const card=page.locator('.outcome-topic-card[data-topic-id="t960two"]');await card.waitFor();
    assert.equal(views.filter(name=>name==='topic_messages').length,0,'no per-card topic reads');
    const wide=!withoutMedia,opening=card.locator('.outcome-topic-latest');
    assert.equal(await opening.isVisible(),wide);
    if(wide){
      assert.ok((await opening.innerText()).includes(latest));
      // 997: below 1100px the bench is three tabs; each part shows once its tab is chosen.
      const tabbed=width<1100,tab=async key=>{if(tabbed)await page.locator(`#outcome-tab-${key}`).click();};
      assert.equal(await page.locator('.outcome-tabs').isVisible(),tabbed);
      if(tabbed){assert.equal(await page.locator('#outcome-page').getAttribute('data-outcome-tab'),'topics');assert.equal(await page.locator('#outcome-agents').isVisible(),false);assert.equal(await page.locator('#outcome-references').isVisible(),false);}
      await tab('agents');
      assert.equal(await page.locator('#outcome-agents').isVisible(),true);
      assert.equal(await page.locator('#outcome-purpose .purpose-pencil').count(),1);
      const pencil=page.locator('#outcome-purpose .purpose-pencil');await pencil.click();
      const purpose=`Kept purpose960 ${key}`;
      const field=page.locator('#outcome-purpose-input');await field.fill(purpose);await field.press('Enter');
      await field.waitFor({state:'hidden'});
      const core=await control({method:'agent_view',actor:facts.actor,name:'workspace',args:{workspace_id:'w960'}});assert.equal(core.workspace.purpose,purpose);
      const escapedPurpose=`Escape purpose960 ${key}`;
      await pencil.click();await field.fill(escapedPurpose);await field.press('Escape');await field.waitFor({state:'hidden'});assert.equal(await pencil.evaluate(n=>n===document.activeElement),true);
      assert.equal((await control({method:'agent_view',actor:facts.actor,name:'workspace',args:{workspace_id:'w960'}})).workspace.purpose,escapedPurpose);
      assert.ok((await page.locator('#topic-description').innerText()).includes(escapedPurpose));
      const member=page.locator(`#outcome-agents .outcome-agent[data-actor-id="${facts.actor}"]`);
      assert.ok((await member.innerText()).includes('1 topic waits on you'));await member.click();
      await page.waitForFunction(()=>getComputedStyle(document.querySelector('[data-topic-id="t960one"].outcome-topic-card')).opacity==='0.25');
      assert.equal(await card.evaluate(n=>getComputedStyle(n).opacity),'1');
      if(tabbed){assert.equal(await page.locator('#outcome-page').getAttribute('data-outcome-tab'),'topics','picking an agent shows its topics');await tab('agents');}
      await member.click();
      await page.waitForFunction(()=>getComputedStyle(document.querySelector('[data-topic-id="t960one"].outcome-topic-card')).opacity==='1');
      const add=page.locator('#outcome-agents #team-people .add-chip');await add.click();assert.equal(await add.getAttribute('aria-expanded'),'true');await add.click();
      await tab('notes');
      const note=page.locator('#outcome-references-list [data-id="n960"]');assert.equal(await note.locator('.outcome-page-opening').innerText(),'The train leaves at seven.');
      const headingBox=await page.locator('#outcome-references>.rail-heading').boundingBox(),noteBox=await note.boundingBox();assert.ok(headingBox.y+headingBox.height<=noteBox.y+1,'Notebook heading is above its page cards');
      const color=await page.locator('#outcome-references').evaluate(n=>getComputedStyle(n).backgroundColor);
      assert.equal(color,look==='paper'?(colorScheme==='light'?'rgb(251, 248, 241)':'rgb(242, 238, 229)'):'rgb(0, 0, 0)');
      for(const [id,sheets] of [['t960one','0'],['t960two','1'],['t960ten','2']]){
        const at=page.locator(`.outcome-topic-card[data-topic-id="${id}"]`);assert.equal(await at.getAttribute('data-sheets'),sheets);
        if(sheets==='0')assert.equal(await at.evaluate(n=>getComputedStyle(n,'::after').content),'none');
      }
      if(width===1440&&colorScheme==='light'&&look==='bookends'){
        await pencil.click();await field.fill('Unsent resize writing960');
        // 985: the bench holds at every width, so a narrower window keeps the purpose and its unsent words in place.
        await page.setViewportSize({width:1000,height:1000});
        assert.equal(await page.locator('#outcome-purpose>#topic-description').count(),1);assert.equal(await field.inputValue(),'Unsent resize writing960');
        await page.setViewportSize({width,height:1000});assert.equal(await field.inputValue(),'Unsent resize writing960');await field.press('Escape');await field.waitFor({state:'hidden'});
        assert.equal((await control({method:'agent_view',actor:facts.actor,name:'workspace',args:{workspace_id:'w960'}})).workspace.purpose,'Unsent resize writing960');
        assert.equal(await pencil.evaluate(n=>n===document.activeElement),true);
        // Advance real scratch Core after the immutable request is queued,
        // then deliver it unchanged: this is an actual conflict, not a
        // fabricated refusal response.
        let conflict=false;
        await page.route('**/api/command',async route=>{
          const sent=route.request().postDataJSON();
          if(!conflict&&sent?.kind==='workspace.update'){
            conflict=true;const changed=await control({method:'onboarding_790',action:'update',workspace_id:'w960',operation_id:`960-conflict-${engine}`,purpose:'Concurrent purpose960'});assert.equal(changed.status,'committed');
          }
          await route.continue();
        });
        await pencil.click();await field.fill('Retained after conflict960');
        const refused=page.waitForResponse(r=>{try{return r.request().postDataJSON()?.kind==='workspace.update';}catch{return false;}});
        await field.press('Enter');const receipt=await(await refused).json();assert.equal(receipt.status,'rejected');
        assert.equal(await field.inputValue(),'Retained after conflict960');assert.equal(await field.isVisible(),true);
        await page.locator('#outcome-purpose .one-line-state:not([hidden])').waitFor();await page.unroute('**/api/command');
        await page.waitForFunction(()=>document.querySelector('#topic-description').textContent.includes('Concurrent purpose960'));
        await field.press('Escape');await field.waitFor({state:'hidden'});
        assert.equal((await control({method:'agent_view',actor:facts.actor,name:'workspace',args:{workspace_id:'w960'}})).workspace.purpose,'Retained after conflict960','Escape retries the retained purpose through the current save owner');
        await card.click();await page.waitForURL(url=>url.searchParams.get('topic')==='t960two');await page.locator('#messages .message-card').first().waitFor();
        assert.equal(await page.locator('#outcome-page').isVisible(),false,'topic page remains its own surface');
        await page.setViewportSize({width:1280,height:1000});
        await page.locator('.ol-name[data-workspace-id="w960"]').click();await page.waitForURL(url=>url.searchParams.get('workspace')==='w960');await page.locator('.outcome-topic-card[data-topic-id="t960two"]').waitFor();
        await page.setViewportSize({width,height:1000});
        const retry=page.locator('.outcome-topic-cards>button').filter({hasText:'Retry topics'});
        if(await retry.isVisible()){
          result.roundTripRetry=true;await retry.click();
          await page.locator('.outcome-topic-cards>.notice').waitFor({state:'hidden'});
        }
        result.phases.push('resize retains writing; actual Core conflict retains writing; topic/rail round-trip and retired listener');
      }
      result.phases.push('latest prose, real purpose save/Escape, shared waiting filter/Add, Notebook material/snippet, sheets');
    }else{
      assert.equal(await page.locator('#outcome-agents').isVisible(),false);
      assert.equal(await card.locator('.outcome-topic-meta').isVisible(),true);
      assert.equal(await page.locator('.topic-header #outcome-team').count(),1);
      if(withoutMedia){
        assert.equal(await page.locator('#outcome-page').getAttribute('data-outcome-wide'),null);
        assert.notEqual(await page.locator('#outcome-page').evaluate(n=>getComputedStyle(n).display),'grid');
        result.phases.push('explicitly removed media API: existing narrow DOM and CSS at wide viewport');
      }
      result.phases.push('existing narrow cards/team and no wide snippets');
    }
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'no horizontal page overflow');
    assert.deepEqual(errors,[]);result.errors=errors;result.views=views;
    await page.screenshot({path:`${evidence}/${key}.png`,fullPage:true});result.passed=true;console.log(JSON.stringify({key,passed:true}));await context.close();
  }
} catch (error) {
  failure = error; if (results.length) { results.at(-1).passed = false; results.at(-1).error = error.stack; }
  if (activePage && !activePage.isClosed()) {
    await activePage.screenshot({ path: `${evidence}/failure.png`, fullPage: true });
    await writeFile(`${evidence}/failure.html`, await activePage.content());
  }
} finally {
  release?.();
  try { if (browser) { await browser.close(); cleanup.browserClosed = !browser.isConnected(); } }
  catch (error) { cleanup.browserError = error.message; failure ??= error; }
  child.stdin.end(); cleanup.fixtureExit = await exit; cleanup.fixtureErrors = fixtureErrors();
  const processes = execFileSync('/bin/ps', ['-axo', 'pid=,command='], { encoding: 'utf8' }).split('\n');
  cleanup.profile = profile;
  cleanup.profileProcesses = profile ? processes.filter(line => line.includes(profile)) : [];
  cleanup.remainingObservedPids = (cleanup.observedBrowserPids ?? []).filter(pid => processes.some(line => Number(line.trim().split(/\s/)[0]) === pid));
  cleanup.fixtureAbsent = !processes.some(line => Number(line.trim().split(/\s/)[0]) === child.pid);
  if(engine==='webkit'&&cleanup.browserClosed&&cleanup.profileProcesses.length===0&&cleanup.remainingObservedPids.length===0)await rm(profile,{recursive:true,force:true});
  cleanup.profileAbsent=profile?await access(profile).then(()=>false,()=>true):false;
  if (origin) cleanup.portClosed = await new Promise(resolve => {
    const url = new URL(origin), socket = net.createConnection({ host: url.hostname, port: Number(url.port) });
    socket.once('connect', () => { socket.destroy(); resolve(false); }); socket.once('error', () => resolve(true));
  });
  await writeFile(`${evidence}/results.json`, JSON.stringify({ engine, results, hashes, cleanup, failure: failure?.stack ?? null }, null, 2));
}
assert.deepEqual(cleanup.fixtureExit, { code: 0, signal: null }); assert.equal(cleanup.fixtureErrors, '');
assert.equal(cleanup.browserClosed, true); assert.deepEqual(cleanup.profileProcesses, []); assert.deepEqual(cleanup.remainingObservedPids, []);
assert.equal(cleanup.fixtureAbsent, true); assert.equal(cleanup.portClosed, true);
assert.equal(cleanup.profileAbsent,true);
if (failure) throw failure;

// Native 958 refused links and good destinations through isolated Core/browser input.
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, writeFile, readFile, rm, access } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import net from 'node:net';
import { fixtureControl } from './fixture_control.mjs';
const engines = await import(process.env.AIM_PLAYWRIGHT_CORE), engine = process.env.AIM_BROWSER ?? 'chromium';
const evidence = process.argv[2]; await mkdir(evidence, { recursive: true });
const filter = new RegExp(process.argv[3] ?? '');
const sourceRoot=process.env.AIM_958_FIXTURE_ROOT ?? process.cwd();
const sourceFiles=['web/app.mjs','web/topic-link-route.mjs'];
const hashes = Object.fromEntries(await Promise.all(sourceFiles.map(async path => [path, createHash('sha256').update(await readFile(`${sourceRoot}/${path}`)).digest('hex')])));
await writeFile(`${evidence}/source.json`, JSON.stringify({ base: execFileSync('git', ['rev-parse', 'HEAD'], { cwd:sourceRoot, encoding: 'utf8' }).trim(), hashes, harness:createHash('sha256').update(await readFile('tests/unfound_links_958_native.mjs')).digest('hex') }, null, 2));
const child = spawn('/usr/bin/python3', ['-B', 'tests/fixtures/ui_http.py', '--freshness'],{cwd:sourceRoot});
const { control, exit, errors } = fixtureControl(child);
const results = [], cleanup = {}; let browser, origin, profile, activePage, failure;
const owned = new Set();
const processes = () => execFileSync('/bin/ps', ['-axo', 'pid=,ppid=,command='], { encoding: 'utf8' }).trim().split('\n').map(line => {
  const [, pid, ppid, command] = line.match(/^\s*(\d+)\s+(\d+)\s+(.*)$/); return { pid: +pid, ppid: +ppid, command };
});
function retainChildren() {
  const list = processes(); for (let changed = true; changed;) { changed = false;
    for (const p of list) if ((owned.has(p.ppid) || profile && p.command.includes(profile)) && !owned.has(p.pid)) { owned.add(p.pid); changed = true; }
  }
}
try {
  const facts=await control({method:'ready'});origin=facts.origin;
  const sourceTopic='t-958-source',note='n-958-note',goodPage='n-958-good';
  const placeholder='[words](?topic=Name&page=n-…)';
  const markdown=placeholder+'\n\n[Unknown name](?topic=NoSuch958)\n\n[Good page](?topic=landing&page='+goodPage+')';
  await control({method:'topic_state',operation_id:'958-landing',topic_id:'t1',args:{title:'Landing'}});
  await control({method:'navigation_topics',topics:[{id:sourceTopic,title:'Link source'}]});
  await control({method:'agent_page',operation_id:'958-good',item_id:goodPage,topic_id:'t1',title:'Good page',body:'# Good page\n\nActual958 destination.'});
  await control({method:'agent_page',operation_id:'958-note',item_id:note,topic_id:'t1',title:'Written links',body:'## Links\n\n'+markdown});
  const root=(await control({method:'agent_message',operation_id:'958-root',topic_id:sourceTopic,sender:'person',whole_topic:true,body:markdown})).result.message_id;
  const plain=(await control({method:'agent_message',operation_id:'958-plain',topic_id:sourceTopic,sender:'person',whole_topic:true,body:markdown})).result.message_id;
  await control({method:'agent_message',operation_id:'958-reply',topic_id:sourceTopic,sender:'person',reply_to:root,body:'Keeps the dossier cover visible.'});
  await control({method:'stack_act',kind:'stack.cover',operation_id:'958-cover',sender:facts.actor,message_id:root,args:{stands:markdown}});
  await control({method:'stack_act',kind:'stack.name',operation_id:'958-name',sender:facts.actor,message_id:root,args:{name:'Written links'}});
  await control({method:'pipeline',kind:'pipeline.configure',operation_id:'958-pipeline',target:{workspace_id:'w1'},args:{enabled:true}});
  const number=(await control({method:'pipeline',kind:'pipeline.item_add',operation_id:'958-record',target:{workspace_id:'w1'},args:{title:'Written record',description:markdown,section:'now',size:'small',sources:[{note:'Isolated958 fixture'}]}})).result.number;
  const missingId='n-'+ 'b'.repeat(32),missingTopic='t-'+ 'a'.repeat(32);
  const variants=[
    ['Missing topic id','?topic='+missingTopic],
    ['Missing canonical page','?topic='+missingTopic+'&page='+missingId],
    ['Missing current page','?topic='+sourceTopic+'&page='+missingId],
    ['Missing outcome page','?workspace=w1&page='+missingId],
    ['Missing Cards page','?cards='+missingId],
    ['Missing revision','?topic=Landing&page='+goodPage+'&revision=99'],
    ['Malformed topic id','?topic=t-…'],
    ['Good name','?topic=landing'],
  ];
  const messages=[];for(const [i,[label,target]] of variants.entries()) {
    const id=(await control({method:'agent_message',operation_id:'958-variant-'+i,topic_id:sourceTopic,sender:'person',whole_topic:true,body:`[${label}](${target})`})).result.message_id;messages.push({label,target,id});
  }
  profile=await mkdtemp(`${evidence}/${engine}-profile-`);
  const persistent=await engines[engine].launchPersistentContext(profile,{headless:true,...(engine==='chromium'?{executablePath:process.env.AIM_CHROME}:{})});
  browser=persistent.browser();assert.equal(browser.browserType().name(),engine);retainChildren();assert.ok(owned.size);
  for(const width of [1280,390]) for(const look of ['bookends','paper']) {
    const context=await browser.newContext({viewport:{width,height:1000},colorScheme:look==='paper'?'light':'dark',hasTouch:width===390});
    await context.addInitScript(look=>localStorage.setItem('theseus-look',look),look);
    let page;const errors=[],onError=e=>errors.push(e.message);
    // Each independent case gets its own document. Repeated goto on an active
    // WebKit page reports aborted background requests as access-control errors.
    const finishPage=async()=>{if(!page)return;assert.deepEqual(errors,[]);page.off('pageerror',onError);await page.close();page=null;};
    const openPage=async url=>{await finishPage();page=await context.newPage();activePage=page;page.setDefaultTimeout(6000);page.on('pageerror',onError);await page.goto(origin+url);await ready();};
    const ready=()=>page.waitForFunction(()=>document.body.dataset.ready==='true');
    const press=async(anchor,keyboard=false)=>{if(keyboard){await anchor.focus();await page.keyboard.press('Enter');}else if(width===390)await anchor.tap();else await anchor.click();};
    const sources=[
      {name:'message',url:'/?topic='+sourceTopic,selector:`#messages [data-id="${plain}"] .message-preview`,notice:'#topic-navigation-status'},
      {name:'reader',url:'/?topic='+sourceTopic+'&message='+root,selector:'#source-body',notice:'#reader-notice'},
      {name:'cover',url:'/?topic='+sourceTopic,selector:'#messages .cover-stands',notice:'#topic-navigation-status'},
      {name:'item',url:'/?pipeline=w1&item='+number,selector:'#topic-description',notice:'#topic-navigation-status'},
      {name:'note-reader',url:'/?topic=t1&page='+note+'&revision=1',selector:'#source-body',notice:'#reader-notice'},
      {name:'cards',url:'/?cards='+note+'&view=cards',selector:'#deck-page',notice:'#deck-page'},
      {name:'sheet',url:'/?topic=t1&page='+note,selector:'dialog.notebook-sheet-dialog[open]',notice:'dialog.notebook-sheet-dialog[open]'},
    ];
    for(const surface of sources) {
      const key=`${width}-${look}-${surface.name}`;if(!filter.test(key))continue;
      await openPage(surface.url);
      const host=page.locator(surface.selector);await host.waitFor();
      if(surface.name==='sheet'&&!await host.getByRole('link',{name:'words',exact:true}).isVisible()) {
        await page.locator('.notebook-sheet .notebook-menu').click();await page.getByRole('menuitemcheckbox',{name:'Show as cards',exact:true}).click();
      }
      const link=host.getByRole('link',{name:'words',exact:true});await link.waitFor();
      const originalUrl=page.url(),title=await page.locator('#topic-title').textContent();
      let writing=null;
      if(surface.name==='message') {
        const field=page.locator('#inline-writing-body');await field.fill('Exact958 writing stays here.');writing=await field.inputValue();
      }
      await press(link);
      const notice=page.locator(surface.notice).getByText('This page could not be found or is not available to you. Stayed here.',{exact:true});
      await notice.waitFor();assert.equal(await notice.isVisible(),true,'refusal is visible at the pressed surface');
      assert.equal(page.url(),originalUrl);assert.equal(await page.locator('#topic-title').textContent(),title);
      assert.equal(await link.isVisible(),true,'source stays rendered');
      if(writing!==null)assert.equal(await page.locator('#inline-writing-body').inputValue(),writing);
      await page.screenshot({path:`${evidence}/${key}-missing.png`});
      await press(host.getByRole('link',{name:'Unknown name',exact:true}),!['cards','sheet'].includes(surface.name));
      const unknown=page.locator(surface.notice).getByText('No topic is named NoSuch958. Choose the topic from Outcomes.',{exact:true});await unknown.waitFor();assert.equal(await unknown.isVisible(),true);assert.equal(page.url(),originalUrl);
      await page.screenshot({path:`${evidence}/${key}-refused.png`});
      await press(host.getByRole('link',{name:'Good page',exact:true}));
      await page.waitForFunction(()=>[...document.querySelectorAll('dialog.notebook-sheet-dialog[open]')].some(el=>el.textContent.includes('Actual958 destination.')));
      assert.equal(await page.locator('#topic-title').textContent(),'Landing');
      results.push({width,look,surface:surface.name,pass:true,checks:['missing stays','visible refusal','unknown name stays','good named page opens',...(writing!==null?['exact writing retained']:[])]});
    }
    if(filter.test(`${width}-${look}-variants`)) for(const v of messages) {
      await openPage('/?topic='+sourceTopic);const before=page.url();
      const a=page.locator(`#messages [data-id="${v.id}"]`).getByRole('link',{name:v.label,exact:true});await press(a,true);
      if(v.label==='Good name')await page.waitForFunction(()=>new URL(location.href).searchParams.get('topic')==='t1'&&document.querySelector('#topic-title').textContent==='Landing');
      else {
        const text=v.label==='Missing topic id'?'This topic could not be found or is not available to you. Stayed here.':v.label==='Malformed topic id'?'No topic is named t-…. Choose the topic from Outcomes.':'This page could not be found or is not available to you. Stayed here.';
        await page.locator('#topic-navigation-status').getByText(text,{exact:true}).waitFor();assert.equal(page.url(),before);assert.equal(await a.isVisible(),true);
      }
      results.push({width,look,variant:v.label,pass:true});
    }
    await finishPage();retainChildren();await context.close();
  }
} catch (error) {
  failure = error;
  if (activePage && !activePage.isClosed()) {
    await activePage.screenshot({ path: `${evidence}/failure.png`, fullPage: true });
    await writeFile(`${evidence}/failure.html`, await activePage.content());
    await writeFile(`${evidence}/events.json`, JSON.stringify(await activePage.evaluate(() => window.events958??[]), null, 2));
  }
} finally {
  if (browser) { retainChildren(); await browser.close(); cleanup.disconnected = !browser.isConnected(); }
  cleanup.browserStarted=Boolean(browser);cleanup.disconnected=browser?!browser.isConnected():true;
  child.stdin.end(); cleanup.fixtureExit = await exit; cleanup.fixtureErrors = errors();
  const ps = processes();
  cleanup.fixturePid = child.pid; cleanup.fixtureAbsent = !ps.some(p => p.pid === child.pid);
  cleanup.ownedPids = [...owned]; cleanup.remainingOwned = ps.filter(p => owned.has(p.pid));
  cleanup.profile = profile; cleanup.profileProcesses = profile ? ps.filter(p => p.command.includes(profile)) : [];
  if (profile && cleanup.disconnected && !cleanup.remainingOwned.length && !cleanup.profileProcesses.length) await rm(profile, { recursive: true });
  cleanup.profileAbsent = profile ? await access(profile).then(() => false, () => true) : null;
  if (origin) cleanup.portClosed = await new Promise(resolve => { const url = new URL(origin), socket = net.createConnection({ host: url.hostname, port: Number(url.port) });
    socket.once('connect', () => { socket.destroy(); resolve(false); }); socket.once('error', () => resolve(true)); });
  await writeFile(`${evidence}/results.json`, JSON.stringify({ engine, browserType: browser?.browserType().name() ?? null, browserVersion: browser?.version() ?? null, results, cleanup, failure: failure?.stack ?? null }, null, 2));
}
assert.equal(cleanup.disconnected, true); assert.equal(cleanup.fixtureExit.code, 0); assert.equal(cleanup.fixtureErrors, '');
assert.equal(cleanup.fixtureAbsent, true); assert.equal(cleanup.portClosed, true);
assert.deepEqual(cleanup.remainingOwned, []); assert.deepEqual(cleanup.profileProcesses, []); assert.equal(cleanup.profileAbsent, true);
if (failure) throw failure;
console.log(JSON.stringify({ passed: results.length, cleanup }));

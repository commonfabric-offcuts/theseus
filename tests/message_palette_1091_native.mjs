// One bounded native representative per invocation. Scratch Core/origin/profile
// only; no page handler is invoked to stand in for a pointer, touch or key.
import assert from 'node:assert/strict';
import {spawn,execFileSync} from 'node:child_process';
import {appendFileSync} from 'node:fs';
import {mkdir,mkdtemp,readFile,writeFile,readdir,rm,access} from 'node:fs/promises';
import {loadavg,cpus} from 'node:os';
import {resolve,isAbsolute} from 'node:path';
import {createHash} from 'node:crypto';
import net from 'node:net';
import {fixtureControl} from './fixture_control.mjs';
import {ROWS,misglyphed,misdrawn,misplaced} from './menu_glyphs.mjs';
import {readerFromPage} from './message_palette_1091_gestures.mjs';
import {ResponseCaptures,fixtureEvents} from './message_palette_1091_capture.mjs';

const [destination,engine='chromium',widthArg='1280',theme='dark']=process.argv.slice(2);
assert.ok(destination&&isAbsolute(destination));assert.ok(['chromium','webkit'].includes(engine));
const width=Number(widthArg),phone=width<=760;assert.ok([390,1280].includes(width));assert.ok(['light','dark'].includes(theme));
const evidence=resolve(destination);await mkdir(evidence,{recursive:false});
const sha=b=>createHash('sha256').update(b).digest('hex');
const put=(name,value)=>writeFile(`${evidence}/${name}`,JSON.stringify(value,null,2)+'\n');
const report={engine,width,theme,resource:[],cases:[],requests:[],receipts:[],captureErrors:[],lostToNavigation:[],pageErrors:[],cleanup:{errors:[]}};
const files=async dir=>(await Promise.all((await readdir(dir,{withFileTypes:true})).map(e=>e.isDirectory()?files(`${dir}/${e.name}`):[`${dir}/${e.name}`]))).flat();
const names=[...await files('web'),'tests/message_palette_1091_native.mjs','tests/menu_glyphs.mjs','tests/fixture_control.mjs','tests/fixtures/ui_http.py','tests/message_palette_1091_gestures.mjs','tests/message_palette_1091_capture.mjs'];
const sources=new Map();
for(const name of names){const bytes=await readFile(name);sources.set(name,bytes);await mkdir(`${evidence}/selected/${name.slice(0,name.lastIndexOf('/'))}`,{recursive:true});await writeFile(`${evidence}/selected/${name}`,bytes);}
report.sources=Object.fromEntries([...sources].map(([name,b])=>[name,{bytes:b.length,sha256:sha(b)}]));await put('selected.json',report.sources);
const processRows=()=>execFileSync('/bin/ps',['-axo','pid=,ppid=,lstart=,command='],{encoding:'utf8'}).trim().split('\n').map(line=>{
  const v=line.trim().split(/\s+/),command=v.slice(7).join(' ');return {pid:+v[0],ppid:+v[1],started:v.slice(2,7).join(' '),command,commandSHA256:sha(command)};
}).filter(r=>r.command!=='/bin/ps -axo pid=,ppid=,lstart=,command=');
const identity=r=>`${r.pid}:${r.started}:${r.commandSHA256}`,owned=new Map();
const sample=()=>{const rows=processRows(),tree=new Set([process.pid]);for(let changed=true;changed;){changed=false;for(const r of rows)if(tree.has(r.ppid)&&!tree.has(r.pid)){tree.add(r.pid);changed=true;}}
  for(const r of rows)if(r.pid!==process.pid&&tree.has(r.pid))owned.set(identity(r),r);return rows;};
const gate=async boundary=>{const r={boundary,utc:new Date().toISOString(),load:loadavg(),cpus:cpus().length};report.resource.push(r);await put('resource.json',report.resource);assert.equal(r.cpus,18);assert.ok(r.load[0]<12,'fresh load must be below12');};
const bounded=(promise,label,ms=15000)=>new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error(label+' exceeded '+ms+'ms')),ms);promise.then(v=>{clearTimeout(timer);resolve(v);},e=>{clearTimeout(timer);reject(e);});});
const refusal=origin=>new Promise(resolve=>{const u=new URL(origin),s=net.createConnection({host:u.hostname,port:+u.port});s.setTimeout(4000,()=>{s.destroy();resolve({utc:new Date().toISOString(),refused:false,error:'timeout'});});s.once('connect',()=>{s.destroy();resolve({utc:new Date().toISOString(),refused:false});});s.once('error',e=>resolve({utc:new Date().toISOString(),refused:e.code==='ECONNREFUSED',code:e.code}));});
const cleanup=async(name,fn)=>{try{await fn();}catch(error){report.cleanup.errors.push({name,error:error.stack});}};
let fixture,channel,browser,context,profile,origin,page;const captures=new ResponseCaptures(report),jobs=captures.jobs,served=new Set();
const eventLog=fixtureEvents(line=>appendFileSync(`${evidence}/events.jsonl`,line));report.events=eventLog.events;
try{
  const engines=await import(process.env.AIM_PLAYWRIGHT_CORE);
  await gate('immediately-before-fixture-spawn');
  fixture=spawn('/usr/bin/python3',['tests/fixtures/ui_http.py','--freshness','--live','--agent-colors','--other-person','--teardown-observations',`${evidence}/fixture-teardown.jsonl`]);
  const stdio=new Promise(resolve=>fixture.once('close',(code,signal)=>resolve({code,signal,utc:new Date().toISOString()})));
  channel={...fixtureControl(fixture),stdio};sample();
  const control=channel.control,ready=await control({method:'ready'});report.fixture={pid:fixture.pid,ready};origin=ready.origin;
  const topic='palette1091-'+process.pid;await control({method:'navigation_topics',topics:[{id:topic,title:'1091 scratch menu palette'}]});
  const body='Alpha **kept words**. Beta unchanged sentence. Gamma final sentence.';
  const ids={};
  for(const [key,sender,words,to,intent] of [['root','aim-core',body,null,'tell'],['reply','aim-core','A separate agent reply.', 'root','tell'],['own','person','My own question stays authored.',null,'ask'],['single','aim-core','A standalone agent message.',null,'tell']]){
    const request={method:'agent_message',operation_id:topic+'-'+key,topic_id:topic,source:'topic',sender,join:true,body:words,addressees:[sender==='person'?'aim-core':ready.actor],intent,...(to?{reply_to:ids[to],reply_without_quote:'This isolated agent reply supplies a menu-kind fixture, not a substantive response to the source.'}:{divergence_reason:`Independent1091 ${key} menu-kind fixture, separate from the topic primer and other menu cases.`})};
    const receipt=await control(request);assert.equal(receipt.status,'committed');report.receipts.push({request,receipt});ids[key]=receipt.result.message_id;
  }
  report.ids=ids;const view=(name,args)=>control({method:'agent_view',actor:ready.actor,name,args});
  const before=await view('source',{source_ref:{kind:'message',id:ids.root}});report.originalSource=before;
  assert.equal(before.body,body);assert.ok(Number.isSafeInteger(before.revision),'actual source revision retained');
  profile=await mkdtemp(`${evidence}/${engine}-profile-`);report.cleanup.profile=profile;
  await gate('immediately-before-browser-launch');
  context=await engines[engine].launchPersistentContext(profile,{headless:true,...(engine==='chromium'?{executablePath:process.env.AIM_CHROME}:{}),viewport:{width,height:960},colorScheme:theme,isMobile:phone,hasTouch:phone});
  browser=context.browser();report.browserVersion=browser.version();sample();
  await context.route('**/*',route=>{const u=new URL(route.request().url());return u.origin===origin?route.continue():route.abort('blockedbyclient');});
  page=await context.newPage();page.setDefaultTimeout(12000);page.on('pageerror',e=>report.pageErrors.push(e.stack??String(e)));
  page.on('request',request=>{if(new URL(request.url()).pathname.startsWith('/api/')){let payload;try{payload=request.postDataJSON();}catch{}report.requests.push({utc:new Date().toISOString(),path:new URL(request.url()).pathname,payload});}});
  // Catch each job immediately: a rejected response body must never bypass
  // finally. First loaded owner bytes remain failure-bearing evidence.
  page.on('response',response=>{const u=new URL(response.url()),name='web/'+u.pathname.split('/').at(-1);
    if(sources.has(name)&&!served.has(name)&&!captures.closed){served.add(name);captures.add({name},()=>response.body().then(async bytes=>{assert.deepEqual(bytes,sources.get(name),'served owner '+name);await mkdir(`${evidence}/served/web`,{recursive:true});await writeFile(`${evidence}/served/${name}`,bytes);}));}
    if(u.pathname.startsWith('/api/')&&response.headers()['content-type']?.includes('application/json'))captures.add({path:u.pathname},()=>response.json().then(body=>report.receipts.push({utc:new Date().toISOString(),path:u.pathname,body})));
  });
  await page.exposeBinding('__1091FixtureEvent',(_source,event)=>eventLog.record(event));
  await page.addInitScript(()=>{const documentId=crypto.randomUUID();globalThis.__1091EventPending=new Set();globalThis.__1091EventErrors=[];for(const type of ['pointerdown','click','keydown'])document.addEventListener(type,e=>{
    const pending=globalThis.__1091FixtureEvent({documentId,type,trusted:e.isTrusted,key:e.key??null,pointerType:e.pointerType??null,target:e.target.closest?.('button')?.getAttribute('data-menu-key')??e.target.id});
    globalThis.__1091EventPending.add(pending);pending.then(()=>globalThis.__1091EventPending.delete(pending),error=>{globalThis.__1091EventErrors.push(String(error));globalThis.__1091EventPending.delete(pending);});
  },true);});
  const flushEvents=()=>page.evaluate(async()=>{await Promise.all([...globalThis.__1091EventPending]);if(globalThis.__1091EventErrors.length)throw Error(globalThis.__1091EventErrors.join('\n'));});
  const card=id=>`#messages [data-id="${id}"]`,words=id=>`${card(id)} .message-preview`;
  const press=async selector=>{const target=page.locator(selector);await target.scrollIntoViewIfNeeded();if(phone)await target.tap();else await target.click();};
  const openReader=(id,prefix)=>readerFromPage({page,cardSelector:card(id),prefix,pressSource:()=>press(words(id))});
  const load=async()=>{await page.goto(`${origin}/?topic=${topic}`);await page.locator('body[data-ready=true]').waitFor();await page.locator(card(ids.single)).waitFor();};
  const openFeed=async id=>{const target=page.locator(card(id));await target.scrollIntoViewIfNeeded();if(phone)await target.locator('.message-author').tap();else await target.hover();await press('.message-bar [data-act=more]');};
  const menu=page.locator('.menu-palette');
  const inspect=async name=>{
    await menu.waitFor();
    const state=await menu.evaluate(root=>{const bs=[...root.querySelectorAll('button')],enabled=bs.filter(b=>!b.disabled);const first=root.querySelector('.palette-rows button:not(:disabled)')??bs.find(b=>!b.disabled&&!b.closest('.palette-marks'))??enabled[0];
      return {labels:bs.map(b=>b.dataset.menuLabel),keys:bs.map(b=>b.dataset.menuKey),enabled:enabled.map(b=>b.dataset.menuKey),initial:document.activeElement?.dataset.menuKey,wantFirst:first?.dataset.menuKey,sheet:root.classList.contains('menu-sheet'),bounds:{width:root.getBoundingClientRect().width,right:root.getBoundingClientRect().right,bottom:root.getBoundingClientRect().bottom},viewport:{width:innerWidth,height:innerHeight}};});
    report.cases.push({name,state});await put('progress.json',report.cases);
    assert.equal(state.initial,state.wantFirst,'initial focus takes the first ordinary action');assert.ok(!state.labels.includes('Rename'));assert.ok(!state.labels.some(l=>/^Break out paragraphs/.test(l)));
    assert.equal(state.sheet,phone);assert.ok(state.bounds.right<=state.viewport.width+1&&state.bounds.bottom<=state.viewport.height+1,'palette stays in viewport');
    const rows=await page.evaluate(ROWS);report.cases.at(-1).glyphs=rows;assert.deepEqual(misglyphed(rows),[]);assert.deepEqual(misdrawn(rows),[]);assert.deepEqual(misplaced(rows),[]);
    await page.keyboard.press('Home');
    for(let i=0;i<state.enabled.length;i++){assert.equal(await page.evaluate(()=>document.activeElement?.dataset.menuKey),state.enabled[i],'native ArrowRight traverses every offered act');await page.keyboard.press('ArrowRight');}
    assert.equal(await page.evaluate(()=>document.activeElement?.dataset.menuKey),state.enabled[0],'all buttons wrap');
    await page.keyboard.press('End');assert.equal(await page.evaluate(()=>document.activeElement?.dataset.menuKey),state.enabled.at(-1));
    await page.keyboard.press('ArrowLeft');assert.equal(await page.evaluate(()=>document.activeElement?.dataset.menuKey),state.enabled.at(-2));
    await page.screenshot({path:`${evidence}/${name}.png`});await page.keyboard.press('Escape');await menu.waitFor({state:'detached'});
  };
  await load();await openFeed(ids.single);await inspect('agent-message-feed');
  if(!phone){await page.locator(words(ids.single)).click({button:'right'});await inspect('agent-message-right-click');}
  await openFeed(ids.single);await press('.menu-palette [data-menu-key=star]');
  let starAfter;
  for(let n=0;n<30;n++){starAfter=await view('message_acts',{topic_id:topic});if(starAfter.items.find(i=>i.message_id===ids.single)?.acts.starred)break;await page.waitForTimeout(50);}
  report.starAfter=starAfter;assert.equal(starAfter.items.find(i=>i.message_id===ids.single)?.acts.starred,true,'native mark activation commits through its existing Core owner');
  await openFeed(ids.own);await inspect('own-question-feed');
  // The actual title bar owner supplies the dossier's first-message menu.
  const dossier=`#messages .reply-stack[data-stack="${ids.root}"]`;
  await page.locator(dossier).scrollIntoViewIfNeeded();if(phone)await page.locator(`${dossier} .stack-name,${dossier} .stack-head`).first().tap();else await page.locator(dossier).hover();
  await press(`${dossier} .stack-tools [data-tool=menu]`);await inspect('dossier-title-menu');
  await openFeed(ids.reply);await inspect('agent-reply-feed');
  await page.locator(words(ids.single)).scrollIntoViewIfNeeded();if(!phone)await page.locator(card(ids.single)).hover();
  await openReader(ids.single,'A standalone agent message.');
  assert.equal(await page.locator('#reader').evaluate(d=>d.open),true,'Reader opens through native source presses');
  await press('#reader-menu');await inspect('reader-message-menu');
  await press('#reader-close');
  // Read the three-sentence source itself for the display/writing controls.
  const sourceCard=page.locator(words(ids.root));
  if(!await sourceCard.isVisible())await press(`${dossier} .stack-toggle`);
  await openReader(ids.root,'Alpha kept words.');
  await page.locator('#source-body').filter({hasText:'Alpha'}).waitFor();
  await page.locator('#writing-body').click();await page.keyboard.type('1091 kept writing');
  const kept=await page.locator('#writing-body').inputValue();assert.ok(kept.includes('1091 kept writing'));
  await press('#reader-close');
  // Preferences use ordinary rail access, including the phone drawer. A new
  // document after reload cannot satisfy readiness with the outgoing one.
  const group='.rail-foot .look-switch[data-switch=paragraphs]';
  const rail=async()=>{if(phone)await press('#rail-open');await page.locator(group).scrollIntoViewIfNeeded();assert.equal(await page.locator(group).count(),1);};
  await rail();assert.equal(await page.locator(group+' [data-value=off]').getAttribute('aria-pressed'),'true');
  await press(group+' [data-value=on]');assert.equal(await page.locator(group+' [data-value=on]').getAttribute('aria-pressed'),'true');
  const preference=await page.evaluate(({instance,actor})=>{const key=JSON.stringify(['aim-next',instance,actor,'text-display','break-out-paragraphs']);return {key,value:localStorage.getItem(key)};},{instance:ready.instance_id,actor:ready.actor});
  report.preference=preference;assert.equal(preference.value,'on');await page.screenshot({path:`${evidence}/paragraphs-rail.png`});
  if(phone)await page.keyboard.press('Escape');
  assert.equal(await sourceCard.locator(':scope > .md-p').count(),3,'same existing feed redraw breaks out three sentences');
  await openReader(ids.root,'Alpha kept words.');
  assert.equal(await page.locator('#source-body > .sentence-paragraph').count(),3,'Reader uses the same existing rule');
  assert.equal(await page.locator('#writing-body').inputValue(),kept,'rail choice preserves the same source reply');
  await press('#reader-close');
  await flushEvents();const documentId=await page.evaluate(()=>globalThis.__1091Document=crypto.randomUUID());await page.reload();
  await page.waitForFunction(id=>document.body.dataset.ready==='true'&&globalThis.__1091Document!==id,documentId);await page.locator(card(ids.single)).waitFor();
  await rail();assert.equal(await page.locator(group+' [data-value=on]').getAttribute('aria-pressed'),'true','actual reload keeps the exact preference');
  await press(group+' [data-value=off]');if(phone)await page.keyboard.press('Escape');
  // A rail-foot replacement is a lifecycle control, not a claimed native
  // navigation: replace only that owned DOM clone, then use native choice.
  await page.evaluate(()=>{const foot=document.querySelector('.rail-foot');foot.replaceWith(foot.cloneNode(true));});
  await rail();await press(group+' [data-value=on]');assert.equal(await page.locator(group+' [data-value=on]').getAttribute('aria-pressed'),'true','replacement is rebound, not a dead copied button');
  await press(group+' [data-value=off]');if(phone)await page.keyboard.press('Escape');
  const after=await view('source',{source_ref:{kind:'message',id:ids.root}});report.finalSource=after;assert.deepEqual([after.body,after.revision],[before.body,before.revision],'menu/preference checks preserve exact authored body/revision');
  await flushEvents();assert.ok(report.events.length&&report.events.every(e=>e.trusted),'every observed gesture is native');assert.equal(new Set(report.events.map(e=>e.documentId)).size,2,'fixture event log survives the actual reload');
  report.cleanup.responseJobsAtClose=captures.close();report.cleanup.captureClosedUTC=new Date().toISOString();
  await Promise.all(jobs);assert.deepEqual(report.captureErrors,[]);assert.deepEqual(report.pageErrors,[]);
  for(const owner of ['web/app.mjs','web/message-menu.mjs','web/message-palette.mjs','web/menu-palette.css','web/paragraph-switch.mjs','web/text-display-rules.mjs'])assert.ok(served.has(owner),'first loaded bytes retained: '+owner);
  report.completed=true;
}catch(error){report.fatal=error.stack;if(page){await page.screenshot({path:`${evidence}/failure.png`}).catch(()=>{});report.failureState=await page.evaluate(()=>({url:location.href,ready:document.body.dataset.ready,active:document.activeElement?.outerHTML,menus:[...document.querySelectorAll('[role=menu]')].map(e=>e.outerHTML)})).catch(e=>({error:String(e)}));}}
finally{
  if(!captures.closed){report.cleanup.responseJobsAtClose=captures.close();report.cleanup.captureClosedUTC=new Date().toISOString();}
  await cleanup('response captures',async()=>{await bounded(Promise.all(jobs),'response captures');});
  if(browser){report.cleanup.browserCloseStart=new Date().toISOString();await cleanup('Browser.close',async()=>{sample();await bounded(browser.close(),'Browser.close');report.cleanup.browserCloseReturn=new Date().toISOString();});report.cleanup.disconnected=!browser.isConnected();}
  if(fixture){fixture.stdin.end();report.cleanup.eof=new Date().toISOString();await cleanup('fixture exit/stdio',async()=>{report.cleanup.fixtureExit=await bounded(channel.exit,'fixture exit');report.cleanup.stdioClosed=await bounded(channel.stdio,'fixture stdio');report.cleanup.fixtureErrors=channel.errors();});
    await cleanup('post-EOF records',async()=>{const b=await readFile(`${evidence}/fixture-teardown.jsonl`);assert.ok(b.toString().endsWith('\n'));const rows=b.toString().trimEnd().split('\n').map(JSON.parse);report.cleanup.teardown={sha256:sha(b),records:rows};assert.equal(rows.at(-1).event,'cleanup-complete');assert.deepEqual(rows.at(-1).errors,[]);assert.equal(rows.at(-1).fixtureBodyError,null);assert.ok(rows.filter(r=>r.event==='cleanup-stage').every(r=>r.status==='ok'));});
    if(origin)report.cleanup.tcp=await refusal(origin);
  }
  const live=sample();report.cleanup.owned=[...owned.values()];report.cleanup.remaining=live.filter(r=>owned.has(identity(r)));report.cleanup.profileProcesses=profile?live.filter(r=>r.command.includes(profile)):[];
  if(profile&&!report.cleanup.remaining.length&&!report.cleanup.profileProcesses.length&&(!browser||report.cleanup.disconnected))await cleanup('profile removal',()=>rm(profile,{recursive:true}));
  report.cleanup.profileAbsent=profile?await access(profile).then(()=>false,()=>true):true;report.served=[...served];report.sourceUnchanged=(await Promise.all([...sources].map(async([n,b])=>sha(await readFile(n))===sha(b)))).every(Boolean);
  report.cleanup.responseJobsAfterClose=jobs.length;assert.equal(report.cleanup.responseJobsAfterClose,report.cleanup.responseJobsAtClose,'no capture job is appended after closing begins');
  report.cleanup.verified=report.cleanup.errors.length===0&&report.cleanup.remaining.length===0&&report.cleanup.profileProcesses.length===0&&report.cleanup.profileAbsent&&(!browser||report.cleanup.disconnected)&&(!fixture||(report.cleanup.fixtureExit?.code===0&&report.cleanup.fixtureExit?.signal===null&&report.cleanup.stdioClosed?.code===0&&report.cleanup.fixtureErrors===''&&report.cleanup.tcp?.refused));
  report.limits='One headless engine/viewport/theme representative. Native gestures use an isolated profile and real scratch Core. Rail-foot replacement is an explicit DOM lifecycle control; it is not native navigation. No physical device, clipboard, timing, other-engine/cell, source freeze or approval claim.';
  await put('native.json',report);
}
assert.equal(report.cleanup.verified,true,'complete current owned cleanup');assert.equal(report.sourceUnchanged,true);assert.equal(report.fatal,undefined);assert.equal(report.completed,true);

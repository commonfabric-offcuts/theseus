// Actual bounded older-page reads and native scroll/placement. No product loader invocation.
import assert from 'node:assert/strict';
import {spawn,execFileSync} from 'node:child_process';
import {mkdir,mkdtemp,readFile,writeFile,rm,access} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import net from 'node:net';
import {fixtureControl} from './fixture_control.mjs';
const baseline=process.argv.includes('--baseline');
const engine=process.env.AIM_ENGINE??'chromium',api=await import(process.env.AIM_PLAYWRIGHT_CORE);
const out=process.argv[2],at=process.argv.indexOf('--case'),filter=at<0?null:new RegExp(process.argv[at+1]);
await mkdir(out,{recursive:true});await writeFile(out+'/producer.mjs',await readFile(new URL(import.meta.url)));
const sha=b=>createHash('sha256').update(b).digest('hex');
const files=['index.html','older-feed.mjs','app.mjs','inline-composer.mjs','compose-bar.mjs','pencil-keys.mjs','session.mjs','app-session.mjs','card-replies.mjs','message-menu.mjs','card-reading.mjs','paper-flight.mjs','fold.mjs','aim.css','write-touch.css','reader.mjs'];
const hashes=Object.fromEntries(await Promise.all(files.map(async p=>[p,sha(await readFile('web/'+p))])));
const producer=sha(await readFile(new URL(import.meta.url)));
const builtIndex=execFileSync('/usr/bin/python3',['-B','-c',"from aim_next.web_build import load; import sys; sys.stdout.buffer.write(load('web').index)"]);
const servedExpected={...hashes,'index.html':sha(builtIndex)};
const head=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim();
const load=+execFileSync('/usr/bin/uptime',{encoding:'utf8'}).match(/load averages?:\s*([0-9.]+)/)[1];assert.ok(load<12,'launch load below12/18: '+load);
const fixture=spawn('/usr/bin/python3',['-B','tests/fixtures/ui_http.py','--freshness','--agent-colors']);
const {control,exit,errors}=fixtureControl(fixture);
const ps=()=>execFileSync('/bin/ps',['-axo','pid=,ppid=,command='],{encoding:'utf8'}).split('\n').flatMap(s=>{const m=s.match(/^\s*(\d+)\s+(\d+)\s+(.+)$/);return m?[{pid:+m[1],ppid:+m[2],command:m[3]}]:[];});
const results=[],owned=new Set(),cleanup={};let browser,profile,facts,failure,stopRequested=false;
process.on('SIGTERM',()=>{stopRequested=true;});process.on('SIGINT',()=>{stopRequested=true;});
const observe=()=>{const rows=ps();for(const p of rows)if(profile&&p.command.includes(profile))owned.add(p.pid);for(let changed=true;changed;){changed=false;for(const p of rows)if(owned.has(p.ppid)&&!owned.has(p.pid)){owned.add(p.pid);changed=true;}}};
try{
 facts=await control({method:'ready'});profile=await mkdtemp(out+'/'+engine+'-profile-');
 const persistent=await api[engine].launchPersistentContext(profile,{headless:true,...(engine==='chromium'?{executablePath:process.env.AIM_CHROME}:process.env.AIM_WEBKIT?{executablePath:process.env.AIM_WEBKIT}:{})});
 browser=persistent.browser();observe();assert.ok(owned.size);await writeFile(out+'/owned-pids.json',JSON.stringify({profile,pids:[...owned],fixture:fixture.pid}));

 cases:for(const width of [1280,390])for(const look of ['bookends','paper']){
  const key=`${width}-${look}`;if(filter&&!filter.test(key))continue;const row={key,width,look,input:'native wheel and keyboard; phone menus use native taps',mobile:width<760&&engine==='chromium',served:{},servedURLs:{},errors:[],reads:[]};results.push(row);
  const context=await browser.newContext({viewport:{width,height:900},hasTouch:width<760,isMobile:row.mobile});
  await context.addInitScript(look=>{if(look==='paper')localStorage.setItem('theseus-look','paper');window.probe1045=[];for(const type of ['wheel','scroll','keydown'])addEventListener(type,e=>probe1045.push({type,trusted:e.isTrusted,key:e.key,dy:e.deltaY,y:scrollY}),{passive:true});},look);
  await mkdir(out+'/'+key+'-served',{recursive:true});
  const page=await context.newPage();page.setDefaultTimeout(8000);page.on('pageerror',e=>row.errors.push({message:e.message,stack:e.stack}));
  page.on('request',r=>{try{const q=r.postDataJSON();if(q?.name==='topic_messages')row.reads.push(q);}catch{}});
  const until=async(test,label)=>{const end=Date.now()+7000;while(Date.now()<end){if(await test())return;await new Promise(r=>setTimeout(r,20));}throw Error(label);};
  const frame=()=>page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
  const ids=()=>page.locator('#messages .message-card').evaluateAll(ns=>ns.map(n=>n.dataset.id));
  const press=async l=>width<760?l.tap():l.click();
  const hold='older-'+key;let held=false;
  try{
   const created=await control({method:'agent_topic',operation_id:'scroll1045-'+key,title:'Older pages '+key,body:'First old message.'});row.topic=created.topic_id;row.seed=[];
   for(let i=0;i<69;i++){const sent=await control({method:'agent_message',operation_id:`scroll1045-${key}-${i}`,topic_id:row.topic,sender:'person',whole_topic:true,body:`Scroll history ${String(i).padStart(3,'0')}.`,read:i===68});assert.equal(sent.status,'committed');row.seed.push(sent.result.message_id);}
   row.coreFirst=await control({method:'agent_view',actor:facts.actor,name:'topic_messages',args:{topic_id:row.topic,audience:'all',direction:'before',limit:30}});assert.ok(row.coreFirst.next_cursor);
   await page.goto(facts.origin+'/?topic='+row.topic);await page.locator('body[data-ready=true]').waitFor();await frame();
   for(const p of files){if(p==='index.html'){const html=(await(await page.request.get(facts.origin+'/')).body()).toString();await writeFile(out+'/'+key+'-served/index.html',html);row.servedURLs[p]=facts.origin+'/';row.servedHTMLHash=sha(html);row.served[p]=sha(html.replace(/(<meta name="aim-next-session" content=")[^"]+(">)/,'$1__AIM_SESSION_TOKEN__$2'));}else{const url=await page.evaluate(p=>performance.getEntriesByType('resource').find(x=>new URL(x.name).pathname.endsWith('/'+p))?.name,p);assert.ok(url,'loaded '+p);row.servedURLs[p]=url;const body=await(await page.request.get(url)).body();await writeFile(out+'/'+key+'-served/'+p,body);row.served[p]=sha(body);}assert.equal(row.served[p],servedExpected[p]);}
   row.initial=await ids();assert.equal(row.initial.length,30);assert.equal(new Set(row.initial).size,30);row.look=await page.locator('html').getAttribute('data-look');assert.equal(row.look??'bookends',look);
   const older=()=>row.reads.filter(q=>Object.hasOwn(q.args,'cursor'));
   row.focusBeforeScroll=await page.evaluate(()=>({id:document.activeElement?.id,tag:document.activeElement?.tagName}));
   if(!baseline){await control({method:'read_hold',hold_id:hold,name:'topic_messages',read_class:'foreground',phase:'callback'});held=true;}
   await page.mouse.move(width/2,250);await page.mouse.wheel(0,650);await frame();await page.mouse.wheel(0,-3000);await page.waitForFunction(()=>scrollY===0);await frame();
   if(baseline){
    row.beforeClick={ids:await ids(),reads:[...older()]};assert.equal(row.beforeClick.ids.length,30);assert.equal(older().length,0);
    const more=page.locator('#more-messages');assert.equal(await more.isVisible(),true);row.button=await more.innerText();await more.scrollIntoViewIfNeeded();await page.screenshot({path:out+'/'+key+'-button.png'});
    await press(more);await page.waitForFunction(()=>document.querySelectorAll('#messages .message-card').length===60);row.after=await ids();assert.equal(new Set(row.after).size,60);assert.equal(older().length,1);assert.equal(older()[0].args.limit,30);assert.equal(older()[0].args.cursor,row.coreFirst.next_cursor);
    assert.equal(await more.count(),0,'1045 removes the visible feed Earlier/More control');
   }else{
    assert.equal(await page.locator('#more-messages').count(),0,'1045 removes the visible feed Earlier/More control');
    try{await until(async()=>(await control({method:'admission_events'})).events.some(e=>e.event==='hold-enter'&&e.hold_id===hold),'actual foreground older read held');for(let n=0;n<6;n++){await page.mouse.wheel(0,-70);await frame();}assert.equal(older().length,1,'concurrent upward attempts share one actual older request');assert.equal((await ids()).length,30,'held read has not painted');}
    finally{if(held){const a=await control({method:'admission_events'});if(!a.events.some(e=>e.event==='hold-enter'&&e.hold_id===hold))row.cancel=await control({method:'read_cancel',hold_id:hold});row.release=await control({method:'read_release',hold_id:hold});held=false;}}
    await page.waitForFunction(()=>document.querySelectorAll('#messages .message-card').length===60);row.after=await ids();assert.equal(new Set(row.after).size,60);assert.deepEqual(row.after.slice(0,30),row.initial);assert.equal(older().length,1);assert.equal(older()[0].args.cursor,row.coreFirst.next_cursor);
    await frame();assert.equal(older().length,1,'no queued drain after settlement');
    row.focusAfterScroll=await page.evaluate(()=>({id:document.activeElement?.id,tag:document.activeElement?.tagName}));
    await control({method:'read_fault',name:'topic_messages',read_class:'foreground',status:400,count:1,body:{error:{code:'FIXTURE_1045_REFUSED',message:'1045 isolated older read refused',retryable:false}}});
    await page.mouse.wheel(0,-70);await until(async()=>(await control({method:'admission_events'})).events.some(e=>e.event==='fault-applied'&&e.name==='topic_messages'&&e.body?.error?.code==='FIXTURE_1045_REFUSED'),'actual isolated read refusal applied');
    await page.getByText('1045 isolated older read refused',{exact:false}).first().waitFor();await frame();assert.equal((await ids()).length,60);assert.equal(older().length,2);row.refusedCursor=older()[1].args.cursor;
    const heldId=row.initial[0];row.positionBefore=await page.locator(`.message-card[data-id="${heldId}"]`).evaluate(n=>({top:n.getBoundingClientRect().top,y:scrollY}));
    await page.mouse.wheel(0,-550);await page.waitForFunction(()=>document.querySelectorAll('#messages .message-card').length===70);row.end=await ids();assert.equal(new Set(row.end).size,70);assert.deepEqual(row.end.slice(0,60),row.after);assert.equal(older().length,3);assert.equal(older()[2].args.cursor,row.refusedCursor,'retry keeps unadvanced cursor');
    row.positionAfter=await page.locator(`.message-card[data-id="${heldId}"]`).evaluate(n=>({top:n.getBoundingClientRect().top,y:scrollY}));assert.ok(Math.abs(row.positionBefore.top-row.positionAfter.top)<=2);
    await page.mouse.wheel(0,-550);await page.keyboard.press('Home');await frame();assert.equal(older().length,3,'end-of-history stops reads');
    const all=await control({method:'agent_view',actor:facts.actor,name:'topic_messages',args:{topic_id:row.topic,audience:'all',direction:'before',limit:30,cursor:older()[2].args.cursor}});assert.equal(all.next_cursor,null);row.coreEnd=all;
    await page.screenshot({path:out+'/'+key+'-loaded.png'});
    const archived=row.initial[0],stack=page.locator(`#messages .reply-stack[data-stack="${archived}"]`).first();await stack.hover();if(width<760){await press(stack.locator('[data-tool=menu]').first());await press(page.getByRole('menuitem',{name:/^Archive(?:\s|$)/}));}else await press(stack.locator('[aria-label="Archive"]').first());
    if(width>=1200){const replica=page.locator(`.shelf-dossier[data-id="${archived}"]`);await replica.waitFor();assert.equal(await stack.isVisible(),false);await press(replica);}else{const more=page.locator('#messages .stack-more');await more.waitFor();await press(more);await stack.waitFor();row.archivedFeedShown=await stack.isVisible();assert.equal(row.archivedFeedShown,true);await page.keyboard.press('Meta+z');}
    await stack.waitFor();await page.waitForFunction(()=>!document.querySelector('.shelf-ghost'));row.archiveReachable=true;
    const oldest=row.end.at(-1);row.mark=await control({method:'mark',operation_id:'1045-mark-'+key,message_ids:[oldest],marked:true});
    row.coreUnread=await control({method:'agent_view',actor:facts.actor,name:'topic_unread',args:{topic_id:row.topic}});assert.equal(row.coreUnread.oldest_unread.id,oldest);
    await page.reload();await page.locator('body[data-ready=true]').waitFor();await page.waitForFunction(()=>document.getElementById('topic-marks-words')?.textContent==='1 message marked unread');await frame();const newLine=page.locator('#messages [data-line=older]');await newLine.waitFor();row.newLine=await newLine.innerText();const readsBeforeNew=older().length;await newLine.scrollIntoViewIfNeeded();await frame();await press(newLine);
    await page.waitForFunction(id=>document.activeElement?.dataset.id===id,oldest);assert.equal((await ids()).length,70);assert.equal(new Set(await ids()).size,70);assert.equal(older().length-readsBeforeNew,2,'New keeps its bounded multi-page owner');row.newFocus=await page.evaluate(()=>({id:document.activeElement?.dataset.id,top:document.activeElement?.getBoundingClientRect().top}));assert.equal(row.newFocus.id,oldest);assert.ok(row.newFocus.top>=0&&row.newFocus.top<900);assert.equal(await page.locator('#more-messages').count(),0);
    await until(async()=>(await control({method:'agent_view',actor:facts.actor,name:'topic_unread',args:{topic_id:row.topic}})).oldest_unread===null,'native New landing clears actual mark');row.newSettled=true;
    await page.screenshot({path:out+'/'+key+'-new.png'});row.admission=await control({method:'admission_events'});assert.deepEqual(row.admission.fatal,[]);
   }
   assert.ok(older().every(q=>q.args.limit===30&&q.args.direction==='before'),'every cursor read stays bounded30 before');assert.deepEqual(row.errors,[]);row.passed=true;
  }catch(e){row.passed=false;row.error=e.stack;row.dom=await page.evaluate(()=>({y:scrollY,active:document.activeElement?.id,count:document.querySelectorAll('#messages .message-card').length,button:document.getElementById('more-messages')?.outerHTML,status:document.getElementById('app-status')?.innerText,probe:window.probe1045})).catch(()=>null);await page.screenshot({path:out+'/'+key+'-failure.png'}).catch(()=>{});}
  if(held){const events=await control({method:'admission_events'});if(!events.events.some(e=>e.event==='hold-enter'&&e.hold_id===hold))await control({method:'read_cancel',hold_id:hold});await control({method:'read_release',hold_id:hold});held=false;}
  observe();await writeFile(out+'/owned-pids.json',JSON.stringify({profile,pids:[...owned],fixture:fixture.pid}));await context.close();await writeFile(out+'/observations.json',JSON.stringify(results,null,2));console.log(JSON.stringify({key,passed:row.passed,error:row.error?.split('\n')[0]}));if(!row.passed)break cases;
 }
}catch(e){failure=e.stack;}
finally{
 if(browser){observe();await browser.close();cleanup.browserClosed=!browser.isConnected();}const rows=ps();cleanup.ownedPids=[...owned];cleanup.remainingOwned=rows.filter(p=>owned.has(p.pid));cleanup.profileProcesses=profile?rows.filter(p=>p.command.includes(profile)):[];
 if(profile&&cleanup.browserClosed&&!cleanup.remainingOwned.length&&!cleanup.profileProcesses.length){await rm(profile,{recursive:true});cleanup.profileRemoved=await access(profile).then(()=>false,()=>true);}
 fixture.stdin.end();cleanup.fixtureExit=await exit;cleanup.fixtureErrors=errors();cleanup.fixturePid=fixture.pid;cleanup.fixtureAbsent=!ps().some(p=>p.pid===fixture.pid);
 if(facts)cleanup.portClosed=await new Promise(resolve=>{const u=new URL(facts.origin),s=net.createConnection({host:u.hostname,port:+u.port});s.once('connect',()=>{s.destroy();resolve(false);});s.once('error',()=>resolve(true));});
 await writeFile(out+'/results.json',JSON.stringify({engine,version:browser?.version(),head,source:process.cwd(),load,hashes,servedExpected,producer,producerAtEnd:sha(await readFile(new URL(import.meta.url))),results,cleanup,failure},null,2));
}
assert.equal(sha(await readFile(new URL(import.meta.url))),producer,'producer stays byte-identical through this phase');assert.equal(cleanup.browserClosed,true);assert.deepEqual(cleanup.remainingOwned,[]);assert.deepEqual(cleanup.profileProcesses,[]);assert.equal(cleanup.profileRemoved,true);assert.deepEqual(cleanup.fixtureExit,{code:0,signal:null});assert.equal(cleanup.fixtureErrors,'');assert.equal(cleanup.fixtureAbsent,true);assert.equal(cleanup.portClosed,true);assert.ok(results.length&&results.every(r=>r.passed),'1045 native older-page check; retained actual failures');

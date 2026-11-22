// Actual scratch Core asks, shared message-card dots and native Silence (1043).
import assert from 'node:assert/strict';
import {spawn,execFileSync} from 'node:child_process';
import {mkdir,mkdtemp,writeFile,rm,access} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import net from 'node:net';
import {fixtureControl} from './fixture_control.mjs';

const out=process.argv[2],engine=process.env.AIM_ENGINE??'chromium';
const source=process.env.AIM_1043_SOURCE_ROOT??process.cwd();
const hashes=JSON.parse(process.env.AIM_1043_HASHES),preflight=process.env.AIM_1043_PREFLIGHT==='1';
const playwright=await import(process.env.AIM_PLAYWRIGHT_CORE);
await mkdir(`${out}/served`,{recursive:true});
const fixture=spawn('/usr/bin/python3',['-B',`${source}/tests/fixtures/ui_http.py`,'--freshness','--live']);
const {control,exit,errors}=fixtureControl(fixture),results=[],cleanup={};
const owned=new Set(),fixtureOwned=new Set([fixture.pid]);
const ps=()=>execFileSync('/bin/ps',['-axo','pid=,ppid=,command='],{encoding:'utf8'}).trim().split('\n').map(line=>{
 const [,pid,ppid,command]=line.match(/^\s*(\d+)\s+(\d+)\s+(.*)$/);return{pid:+pid,ppid:+ppid,command};
});
function children(set){const rows=ps();for(let changed=true;changed;){changed=false;for(const row of rows)if(set.has(row.ppid)&&!set.has(row.pid)){set.add(row.pid);changed=true;}}}
const card=id=>`#messages .message-card[data-id="${id}"]`;
const measure=locator=>locator.evaluate(mark=>({
 label:mark.getAttribute('aria-label'),title:mark.title,rect:mark.getBoundingClientRect().toJSON(),
 animations:[...mark.children].map(dot=>getComputedStyle(dot).animationName),
 delays:[...mark.children].map(dot=>getComputedStyle(dot).animationDelay),
 opacities:[...mark.children].map(dot=>getComputedStyle(dot).opacity),
 timelines:mark.getAnimations({subtree:true}).map(a=>({state:a.playState,time:a.currentTime})),
 reduced:matchMedia('(prefers-reduced-motion:reduce)').matches,
}));
const frames=page=>page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
let browser,profile,origin,fatal;
try{
 const facts=await control({method:'ready'});origin=facts.origin;children(fixtureOwned);
 const conversation=await control({method:'coordinator',operation_id:'1043-coordinator',coordinator:facts.agent});
 const view=(name,args,actor=facts.actor)=>control({method:'agent_view',actor,name,args});
 const item=async(topic,id)=>(await view('topic_messages',{topic_id:topic,direction:'before',limit:50})).items.find(x=>x.id===id);
 profile=await mkdtemp(`${out}/${engine}-profile-`);
 const persistent=await playwright[engine].launchPersistentContext(profile,{headless:true,
  ...(engine==='chromium'?{executablePath:process.env.AIM_CHROME}:{executablePath:process.env.AIM_WEBKIT})});
 browser=persistent.browser();cleanup.engine=engine;cleanup.version=browser.version();
 for(const row of ps())if(row.command.includes(profile))owned.add(row.pid);children(owned);assert.ok(owned.size);
 await writeFile(`${out}/owned-start.json`,JSON.stringify({profile,ownedPids:[...owned],fixturePid:fixture.pid,origin}));
 const cells=preflight?[[1280,'bookends','compact','light']]:[1280,390].flatMap(width=>['bookends','paper'].flatMap(look=>['compact','roomy'].flatMap(density=>['light','dark'].map(theme=>[width,look,density,theme]))));
 for(const [width,look,density,colorScheme]of cells)for(const [place,topic]of [['topic','t1'],['conversation',conversation.topic_id]]){
  const key=`${engine}-${width}-${look}-${density}-${colorScheme}-${place}`,observations=[],pageErrors=[],leavingReadCancellations=[],loads=[];
  const context=await browser.newContext({viewport:{width,height:1000},colorScheme,hasTouch:width===390,isMobile:width===390,reducedMotion:'no-preference'});
  await context.addInitScript(({look,density})=>{localStorage.setItem('theseus-look',look);localStorage.setItem('theseus-rail-roomy',density==='roomy'?'1':'0');},{look,density});
  const page=await context.newPage();page.setDefaultTimeout(6000);let phase='initial',leaving=false,error;
  const press=locator=>width===390?locator.tap():locator.click();
  const writes=[];page.on('request',r=>{if(r.method()==='POST')writes.push(r.url());});
  page.on('pageerror',e=>{const row={message:e.message,stack:e.stack,phase:leaving?'leaving':'active'};
   if(engine==='webkit'&&leaving&&/^Fetch API cannot load \S+ due to access control checks\.$/.test(e.stack?.split('\n')[0]??''))leavingReadCancellations.push(row);else pageErrors.push(row);
  });
  page.on('response',response=>{
   const name='web/'+new URL(response.url()).pathname.split('/').pop();if(!(name in hashes))return;
   const index=loads.length,when=phase;
   loads.push((async()=>{const bytes=await response.body(),saved=`served/${key}-${index}-${name.slice(4)}`;await writeFile(`${out}/${saved}`,bytes);
    return{name,phase:when,url:response.url(),status:response.status(),sha256:createHash('sha256').update(bytes).digest('hex'),saved};})().catch(e=>({name,phase:when,error:e.stack})));
  });
  const verifyLoads=async when=>{
   const executed=await Promise.all(loads);
   for(const [name,hash]of Object.entries(hashes).filter(([name])=>name.startsWith('web/'))){
    const found=executed.filter(row=>row.name===name&&row.phase===when);assert.ok(found.length,when+' original '+name);
    for(const row of found){assert.equal(row.error,undefined);assert.equal(row.status,200);assert.equal(row.sha256,hash,when+' executed '+name);}
   }
  };
  try{
   const beforeDeliveries=await control({method:'deliveries_to',actors:[facts.agent]});
   const sent=await control({method:'agent_message',operation_id:`1043-${key}-ask`,sender:'person',topic_id:topic,whole_topic:true,
    body:`Please check ${key}?`,post_args:{addressees:[facts.agent],intent:'ask',go_ahead:false,divergence_reason:'Independent scratch message waiting episode'}});
   assert.equal(sent.status,'committed');const id=sent.result.message_id;
   const delivered=await control({method:'deliveries_to',actors:[facts.agent]});assert.equal(delivered[facts.agent],beforeDeliveries[facts.agent]+1);
   const before=await item(topic,id);observations.push({phase:'actual published ask and agent receipt',sent,beforeDeliveries,delivered,before});
   assert.equal(before.awaiting_reply,true,'actual received own message waits in '+place);assert.equal(before.no_agent_notified,false);
   await page.goto(`${origin}/?topic=${topic}`);await page.locator('body[data-ready=true]').waitFor();await verifyLoads('initial');
   const mark=page.locator(`${card(id)} .reply-wait .item-waiting`),button=page.locator(`${card(id)} .waiting-silence`);
   await mark.waitFor({state:'visible'});await mark.scrollIntoViewIfNeeded();const first=await measure(mark);await frames(page);const second=await measure(mark);
   assert.deepEqual(first.animations,Array(3).fill('item-waiting'));assert.deepEqual(first.delays,['0s','0.25s','0.5s']);
   assert.equal(first.timelines.length,3);assert.ok(first.timelines.every(x=>x.state==='running'&&typeof x.time==='number'));
   assert.ok(second.timelines.every((x,i)=>x.time>first.timelines[i].time),'real animation time advances');
   assert.ok(first.rect.width>0&&first.rect.height>0&&first.rect.x>=0&&first.rect.right<=width+1&&first.rect.y>=0&&first.rect.bottom<=1001);
   observations.push({phase:'actual visible pulse and advancing browser animation',first,second});
   await page.emulateMedia({reducedMotion:'reduce'});
   await page.waitForFunction(sel=>[...document.querySelector(sel).children].every(dot=>getComputedStyle(dot).animationName==='none'),`${card(id)} .reply-wait .item-waiting`);
   const reduced=await measure(mark);assert.equal(reduced.reduced,true);assert.deepEqual(reduced.animations,Array(3).fill('none'));assert.deepEqual(reduced.timelines,[]);
   observations.push({phase:'actual reduced-motion static dots',reduced});
   await page.emulateMedia({reducedMotion:'no-preference'});
   await page.waitForFunction(sel=>[...document.querySelector(sel).children].every(dot=>getComputedStyle(dot).animationName==='item-waiting'),`${card(id)} .reply-wait .item-waiting`);
   await page.screenshot({path:`${out}/${key}-waiting.png`});
   const topicBefore=await view('topic',{topic_id:topic});await press(button);
   const menu=page.locator('.message-menu-list[role=menu]');await menu.waitFor({state:'visible'});
   if(width===1280){await page.keyboard.press('Escape');assert.equal(await button.evaluate(x=>x===document.activeElement),true);await page.keyboard.press('Enter');await menu.waitFor({state:'visible'});}
   writes.length=0;await press(menu.getByRole('menuitem',{name:'Silence',exact:true}));await menu.waitFor({state:'detached'});await frames(page);
   const silent=await measure(mark);assert.equal(await button.isVisible(),false);assert.deepEqual(writes,[],'Silence sends no HTTP mutation');
   const still=await item(topic,id),topicAfter=await view('topic',{topic_id:topic});
   assert.equal(still.awaiting_reply,true);assert.equal(still.body,before.body);assert.deepEqual(topicAfter.topic.asks,topicBefore.topic.asks);assert.equal(topicAfter.topic.state,topicBefore.topic.state);
   observations.push({phase:'native Silence leaves actual Core wait untouched',silent,still,writes:[...writes]});
   phase='reload';leaving=true;await page.reload();await page.locator('body[data-ready=true]').waitFor();leaving=false;await verifyLoads('reload');
   await mark.waitFor({state:'visible'});assert.deepEqual((await measure(mark)).animations,Array(3).fill('item-waiting'),'reload starts a new unsilenced document');
   await press(button);await menu.waitFor({state:'visible'});await press(menu.getByRole('menuitem',{name:'Silence',exact:true}));await menu.waitFor({state:'detached'});
   const another=await control({method:'agent_message',operation_id:`1043-${key}-another`,sender:'person',topic_id:topic,whole_topic:true,body:`Another ${key}.`,
    post_args:{addressees:[facts.agent],intent:'tell',divergence_reason:'Another independent scratch waiting episode'}});
   const next=page.locator(`${card(another.result.message_id)} .reply-wait .item-waiting`);await next.waitFor({state:'visible'});
   assert.deepEqual((await measure(next)).animations,Array(3).fill('item-waiting'));assert.equal(await button.isVisible(),false);
   const answer=await control({method:'agent_message',operation_id:`1043-${key}-answer`,sender:facts.agent,topic_id:topic,reply_to:id,addressees:[facts.actor],body:`Checked ${key}.`,reply_without_quote:'The isolated fixture answers this complete scratch request.'});
   assert.equal(answer.status,'committed');const completed=await item(topic,id);assert.equal(completed.awaiting_reply,false);
   await page.locator(card(id)).waitFor({state:'visible'});await page.locator(`${card(id)} .reply-wait`).waitFor({state:'detached'});
   observations.push({phase:'actual agent reply settles and removes the card mark',answer,completed});
   await page.screenshot({path:`${out}/${key}-answered.png`});
   if(place==='conversation'){
    const wid=`1043-${key}-empty`,created=await control({method:'team_outcome',operation_id:wid,workspace_id:wid,title:'Unwatched scratch outcome',team:[]});
    assert.equal(created.status,'committed');const empty=created.result.conversation_id;
    const note=await control({method:'agent_message',operation_id:`${wid}-note`,sender:'person',topic_id:empty,whole_topic:true,body:'No agent is addressed or listening.'});
    const unwatched=await item(empty,note.result.message_id);assert.equal(unwatched.no_agent_notified,true);assert.equal(unwatched.awaiting_reply,false);
    phase='unwatched';leaving=true;await page.goto(`${origin}/?topic=${empty}`);await page.locator('body[data-ready=true]').waitFor();leaving=false;await verifyLoads('unwatched');
    const glyph=page.locator(`${card(note.result.message_id)} .reply-wait .no-agent-notified`);await glyph.waitFor({state:'visible'});await glyph.scrollIntoViewIfNeeded();
    const geometry=await glyph.boundingBox();assert.ok(geometry.width>0&&geometry.height>0&&geometry.x>=0&&geometry.x+geometry.width<=width+1&&geometry.y>=0&&geometry.y+geometry.height<=1001);assert.equal(await page.locator(`${card(note.result.message_id)} .item-waiting`).count(),0);
    observations.push({phase:'actual no-recipient Conversation unwatched glyph',created,note,unwatched,geometry});
   }
   assert.deepEqual(pageErrors,[]);
  }catch(e){error=e.stack;await page.screenshot({path:`${out}/${key}-failure.png`}).catch(()=>{});}
  const executed=await Promise.all(loads);observations.push({phase:'all original executed module and style responses',executed});
  if(executed.some(row=>row.error)&&!error)error='Original response capture failed: '+JSON.stringify(executed);
  results.push({key,error:error??null,observations,pageErrors,leavingReadCancellations});
  await writeFile(`${out}/observations.json`,JSON.stringify(results,null,2));children(owned);leaving=true;await context.close();
 }
}catch(e){fatal=e.stack;}
finally{
 try{if(browser){children(owned);await browser.close();cleanup.browserClosed=!browser.isConnected();}}catch(e){cleanup.browserError=e.stack;}
 const rows=ps();cleanup.ownedPids=[...owned];cleanup.remainingOwned=rows.filter(r=>owned.has(r.pid));cleanup.profileProcesses=profile?rows.filter(r=>r.command.includes(profile)):[];
 if(profile&&cleanup.browserClosed&&!cleanup.remainingOwned.length&&!cleanup.profileProcesses.length){await rm(profile,{recursive:true});cleanup.profileRemoved=await access(profile).then(()=>false,()=>true);}
 children(fixtureOwned);fixture.stdin.end();cleanup.fixtureExit=await exit;cleanup.fixtureErrors=errors();cleanup.fixturePid=fixture.pid;
 const after=ps();cleanup.fixtureAbsent=!after.some(r=>r.pid===fixture.pid);cleanup.fixtureOwnedPids=[...fixtureOwned];cleanup.remainingFixtureOwned=after.filter(r=>fixtureOwned.has(r.pid));
 if(origin)cleanup.portClosed=await new Promise(resolve=>{const u=new URL(origin),s=net.createConnection({host:u.hostname,port:+u.port});s.once('connect',()=>{s.destroy();resolve(false)});s.once('error',()=>resolve(true));});
 await writeFile(`${out}/results.json`,JSON.stringify({engine,preflight,hashes,source,results,cleanup,fatal:fatal??null},null,2));
}
const bad=results.filter(r=>r.error);console.log(JSON.stringify({engine,pass:results.length-bad.length,fail:bad.length,bad:bad.map(r=>({key:r.key,error:r.error})),cleanup,fatal:fatal??null},null,2));
if(!results.length||bad.length||fatal||!cleanup.browserClosed||cleanup.remainingOwned?.length||cleanup.profileProcesses?.length||!cleanup.profileRemoved||cleanup.fixtureExit?.code!==0||cleanup.fixtureErrors||!cleanup.fixtureAbsent||cleanup.remainingFixtureOwned?.length||!cleanup.portClosed)process.exitCode=1;

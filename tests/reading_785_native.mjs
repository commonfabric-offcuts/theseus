import assert from 'node:assert/strict';
import { T785, card785, rect785, capture785, read785, pill785, frames785, held785, solid785, expressions785 as E, staleInit785 } from './reading_785_oracle.mjs';

export const names785 = ['laptop','phone'].flatMap(device=>['light','dark'].map(theme=>`reading item 785 document top hides outside arrival ${device} ${theme}`)).concat(['laptop','phone'].flatMap(device=>['light','dark'].map(theme=>`reading item 785 holds arrivals edits resize and native intent ${device} ${theme}`))).concat(['laptop','phone'].flatMap(device=>['light','dark'].map(theme=>`reading item 785 deliberate New send opening and More ${device} ${theme}`))).concat('reading item 785 served source geometry mutants and exact build restoration');
const body785 = label => `${label}. The real words at this reading place stay exactly here.\n\n` + 'A paragraph with enough real words to cross several lines on a phone and keep a distinct reading identity. '.repeat(6);

export async function reading785Checks({check,until,control,view,facts,shot,observations,engine}, {seed,open,tap}) {
 const history = (phase,data) => observations.push({name:'reading item 785',phase,engine,...data});
 const settle = async p => {await p.evaluate(frames785);await p.evaluate(frames785);};
 const snapshot = async (p,phase,before=null) => {await settle(p);const after=await p.evaluate(read785);history(phase,{before,after});if(before)held785(before,after);return after;};
 const wheel = async (p,dy) => {
  const at=await p.evaluate(E.wheelAim);
  await p.send('Input.dispatchMouseEvent',{type:'mouseWheel',...at,deltaX:0,deltaY:dy});await settle(p);
 };
 const position = async (p,id,top=0) => {
  // Feedback is geometry from real native wheel events, never programmatic scrolling.
  for(let step=0;step<8;step++) {const r=await p.evaluate(rect785(card785(id)));if(Math.abs(r.top-top)<=1)return;await wheel(p,r.top-top);}
  const r=await p.evaluate(rect785(card785(id)));assert.ok(Math.abs(r.top-top)<=1,`native wheel reaches intended reading edge ${JSON.stringify(r)}`);
 };
 const seedTopic = async (key,count=14) => {
  const ids=await seed(key,Array.from({length:count},(_,i)=>['m'+i,{sender:'aim-core',join:i===0,addressees:[facts.actor],body:body785(key+' message '+i)}]));
  return ids;
 };
 const arrival = async (p,topic,key) => {
  const result=await control({method:'agent_message',operation_id:key,topic_id:topic,sender:'aim-core',addressees:[facts.actor],body:body785(key+' outside arrival')});
  assert.equal(result.status,'committed','other fixture actor arrival commits in real Core');
  const id=result.result.message_id;
  await until(()=>p.evaluate(E.exists(id)),'other fixture actor realtime arrival is drawn');
  return id;
 };
 const activate = async(p,device,id) => {
  if(device==='phone') await tap(p,'.new-above','centre');
  else {
   // Reach the actual pill through native Tab/Shift-Tab; no focus() or DOM click().
   for(let i=0;i<180;i++){if(await p.evaluate(E.activePill))break;await p.key('Tab',8);}
   assert.equal(await p.evaluate(E.activePill),true,'native keyboard reaches New above');
   await p.key('Enter');
  }
  await until(()=>p.evaluate(E.lands(id)),'New above activates the actual new message and its focus');
  assert.equal(await p.evaluate(pill785),null,'offer clears once the arrival is reached');
 };
 const bind = async (p,receipt=null) => {
  const state=await p.evaluate(E.binding);
  history('served source binding',{state,receipt});
  if(receipt) assert.ok(state.module.includes('/b/'+receipt.stamp+'/'),'page loads selected immutable Build');
  return state;
 };
 const resizeAbove = async(p,id,height) => {
  // Explicit external-layout fault stimulus: actual DOM geometry, not a user handler.
  await p.evaluate(E.resize(id,height));
  await settle(p);
 };
 for(const device of ['laptop','phone'])for(const theme of ['light','dark'])await check(`reading item 785 document top hides outside arrival ${device} ${theme}`,async()=>{
  const topic=`reading785-doc-top-${device}-${theme}`,ids=await seedTopic(topic);let p;
  try {p=await open(topic,device,topic,ids.m13);await p.send('Emulation.setEmulatedMedia',{features:[{name:'prefers-color-scheme',value:theme}]});
   await until(()=>p.evaluate(E.ready),'document top initial reads settle');await wheel(p,-100000);assert.equal(await p.evaluate(E.y),0);
   await bind(p,await control({method:'reading_785_runtime',phase:'restored'}));const before=await p.evaluate(capture785),id=await arrival(p,topic,topic+'-new');await snapshot(p,'document top arrival',before);
   const rect=await p.evaluate(rect785(card785(id))),pill=await p.evaluate(pill785);history('actual document top geometry',{device,theme,before,rect,pill});await shot(p,topic+'-arrival');
   assert.ok(rect.bottom<=T785.arrivalSightPx,'document-top arrival is above sight, arrivalSightPx=1');solid785(pill);await activate(p,device,id);assert.deepEqual(p.errors,[]);
  } catch(error){history('matrix failure',{topic,error:error.stack});throw error;} finally {if(p){await p.close();history('page closed',{topic});}}
 });
 for(const device of ['laptop','phone'])for(const theme of ['light','dark'])await check(`reading item 785 holds arrivals edits resize and native intent ${device} ${theme}`,async()=>{
  const topic=`reading785-${device}-${theme}`,ids=await seedTopic(topic);let p;
  try {
   p=await open(topic,device,topic,ids.m13,staleInit785(topic));
   await p.send('Emulation.setEmulatedMedia',{features:[{name:'prefers-color-scheme',value:theme}]});
   await until(()=>p.evaluate(E.ready),'initial reads settle');await settle(p);await bind(p,await control({method:'reading_785_runtime',phase:'restored'}));
   // Topic top is the real first message at the viewport edge, not an arbitrary scroll offset.
   await position(p,ids.m13,0);const top=await p.evaluate(capture785);
   const newId=await arrival(p,topic,topic+'-top');await snapshot(p,'top arrival',top);
   const newRect=await p.evaluate(rect785(card785(newId)));history('top hidden arrival',{newRect});
   assert.ok(newRect.bottom<=T785.arrivalSightPx,'top arrival is just above sight, arrivalSightPx=1');
   const pill=await p.evaluate(pill785);history('pill geometry',{device,theme,pill});await shot(p,topic+'-top-arrival');solid785(pill);
   await activate(p,device,newId);history('native New above activation',{device,id:newId});
   // The midpoint of a long card crosses the top; retain its actual range, not the card's top.
   await position(p,ids.m7,-90);const mid=await p.evaluate(capture785);
   assert.equal(mid.id,ids.m7,'the intended real middle card is the reading anchor');
   const midArrival=await arrival(p,topic,topic+'-middle');await snapshot(p,'mid arrival',mid);
   const edit=await control({method:'agent_edit',operation_id:topic+'-edit',message_id:ids.m12,sender:'aim-core',body:body785('Edited above reading')+'\n\n'+body785('Larger above')});
   assert.equal(edit.status,'committed','remote edit commits');
   await until(()=>p.evaluate(E.edited(ids.m12)),'remote edit arrives');await snapshot(p,'above edit',mid);
   await resizeAbove(p,ids.m11,130);await snapshot(p,'late resize grow',mid);
   await resizeAbove(p,ids.m11,0);await snapshot(p,'late resize shrink',mid);
   // Real native scroll deliberately leaves the old range, then becomes the new anchor.
   let y=await p.evaluate(E.y);await wheel(p,180);assert.ok(Math.abs(await p.evaluate(E.y)-y)>=T785.deliberatePx,'native wheel retains deliberate movement');
   if(device==='phone'&&engine==='chrome') {
    const at=await p.evaluate(E.touchAim);
    y=await p.evaluate(E.y);await p.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[at]});
    for(let i=1;i<=8;i++)await p.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:at.x,y:at.y-i*22}]});
    await p.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
    await until(async()=>Math.abs(await p.evaluate(E.y)-y)>=T785.deliberatePx,'native finger scroll changes the reading place');let prior=null,stable=0;await until(async()=>{const y=await p.evaluate(E.y);stable=y===prior?stable+1:0;prior=y;return stable>=4},'native finger fling settles');await settle(p);
   } else if(device==='phone')history('native touch drag unavailable',{qualification:'WebKit driver supplies native taps and wheel; no finger-drag API. Physical iOS not proven.'});
   if(device==='laptop') {y=await p.evaluate(E.y);const focus=await p.evaluate(E.activeIdentity);await p.key('ArrowDown');await p.key('ArrowDown');await settle(p);const after=await p.evaluate(E.activeIdentity),afterY=await p.evaluate(E.y);history('native keyboard destination',{before:y,after:afterY,focusBefore:focus,focusAfter:after});assert.ok(JSON.stringify(focus)!==JSON.stringify(after)||Math.abs(afterY-y)>=T785.deliberatePx,'native keys keep their own focus or scroll destination');}
   const deliberate=await p.evaluate(capture785);await resizeAbove(p,ids.m11,90);await snapshot(p,'new deliberate anchor holds',deliberate);
   // Hold an actual old-topic messages answer, release only after native navigation.
   await p.evaluate(E.gate);
   await control({method:'agent_message',operation_id:topic+'-stale',topic_id:topic,sender:'aim-core',body:'Held old-topic realtime words.'});
   await until(()=>p.evaluate(E.waiting),'old-topic message response is actually held');
   // Native topic navigation; later old-topic arrivals cannot repaint its destination.
   await wheel(p,-100000);await until(()=>p.evaluate(E.top),'native wheel reaches navigation');
   if(device==='phone') { const toggle=await p.evaluate(E.hasRail);if(toggle)await tap(p,'#rail-open'); }
   const link=await p.evaluate(E.link);
   if(link) {
    const selector='a[href='+JSON.stringify(link)+']';if(device==='phone')await tap(p,selector);else await p.point(selector);
    await until(()=>p.evaluate(E.navigated),'native navigation reaches different topic');
    await p.evaluate(E.release);await settle(p);
    await control({method:'agent_message',operation_id:topic+'-after-leave',topic_id:topic,sender:'aim-core',body:'Old topic arrival after navigation.'});await settle(p);
    assert.equal(await p.evaluate(E.absent(midArrival)),true,'old topic cannot reappear after navigation');history('navigation settled',{link});
   } else assert.fail('real t1 topic navigation link is reachable');
   assert.deepEqual(p.errors,[]);
  } catch(error){history('matrix failure',{topic,error:error.stack});throw error;} finally {if(p){await p.close();history('page closed',{topic});}}
 });
 for(const device of ['laptop','phone'])for(const theme of ['light','dark'])await check(`reading item 785 deliberate New send opening and More ${device} ${theme}`,async()=>{
  const topic=`reading785-acts-${device}-${theme}`,ids=await seedTopic(topic,65);let p;
  const press=selector=>device==='phone'?tap(p,selector,'centre'):p.point(selector);
  const locate=async(selector,top)=>{for(let i=0;i<8;i++){const r=await p.evaluate(rect785(selector));if(Math.abs(r.top-top)<=1)return;await wheel(p,r.top-top);}assert.ok(Math.abs((await p.evaluate(rect785(selector))).top-top)<=1,'native wheel brings deliberate control into view');};
  try {p=await open(topic,device,topic,ids.m64);await p.send('Emulation.setEmulatedMedia',{features:[{name:'prefers-color-scheme',value:theme}]});await until(()=>p.evaluate(E.ready),'acts initial reads settle');await wheel(p,-100000);await bind(p,await control({method:'reading_785_runtime',phase:'restored'}));
   const before=await p.evaluate(E.y);await press('#new-message');await until(()=>p.evaluate(E.sheetOpen),'native New opens its sheet');await press('#inline-writing-body');assert.equal(await p.evaluate(E.writingReady),true,'native press puts typing in New message');
   const body=topic+' own deliberate send';await p.send('Input.insertText',{text:body});await p.key('Enter',4);
   const receipt=await until(()=>p.evaluate(E.receipt),'Core answers native own send');assert.equal(receipt.status,'committed','own native send commits');
   const core=await view('topic_messages',{topic_id:topic,direction:'before',limit:5});const own=core.items.filter(e=>e.author_id===facts.actor&&e.body===body);assert.equal(own.length,1,'own send records exact words once');
   await until(()=>p.evaluate(E.exists(own[0].id)),'own sent card arrives');await until(async()=>!await p.evaluate(E.sheetOpen),'own send closes New sheet');
   const ownRect=await p.evaluate(rect785(card785(own[0].id)));history('own send native landing',{device,theme,before,after:await p.evaluate(E.y),ownRect,receipt});assert.ok(ownRect.bottom>0&&ownRect.top<await p.evaluate(E.viewportHeight),'own send lands visibly rather than retaining old reading hold');assert.equal(await p.evaluate(pill785),null,'own send makes no New above offer');
   await locate(card785(own[0].id),140);const words=card785(own[0].id)+' > .message-preview';await press(words);if(device==='phone'&&!await p.evaluate(E.readerOpen))await press(words);
   await until(()=>p.evaluate(E.readerOpen),'native opening retains normal Reader semantics');await press('#reader-close');await until(async()=>!await p.evaluate(E.readerOpen),'native close returns to topic');
   const controlSelector=await p.evaluate(E.olderControl);assert.ok(controlSelector,'real older page is available');await locate(controlSelector,device==='phone'?400:500);
   const prior=await p.evaluate(E.drawnIds),controlTop=(await p.evaluate(rect785(controlSelector))).top;await press(controlSelector);
   await until(async()=>(await p.evaluate(E.drawnIds)).some(id=>!prior.includes(id)),'native More brings real older messages');await settle(p);
   const after=await p.evaluate(E.drawnIds),loaded=after.find(id=>!prior.includes(id)),land=(await p.evaluate(rect785(card785(loaded)))).top;history('native More landing',{prior,after,loaded,land,controlTop});assert.ok(Math.abs(land-controlTop)<=T785.anchorDriftPx,'More puts first new older card at requested control edge within 1px');assert.equal(await p.evaluate(pill785),null,'More creates no new-arrival offer');assert.deepEqual(p.errors,[]);
  } catch(error){history('acts failure',{topic,error:error.stack});throw error;}
  finally {if(p){await p.close();history('page closed',{topic});}}
 });
 await check(names785.at(-1),async()=>{
  // Every mutant runs on an immutable copied Build, each page closes before restoration.
  const variants=['no-hold','wrong-anchor','pill-top','pill-centre','pill-surface','pill-shadow'].map(phase=>({phase,device:'laptop',theme:'light'})).concat(['laptop','phone'].flatMap(device=>['light','dark'].map(theme=>({phase:'fallback',device,theme}))));
  for(const {phase,device,theme} of variants) {
   const receipt=await control({method:'reading_785_runtime',phase});history('runtime mutation applied',{receipt});let p;
   try {
    const topic='reading785-mutant-'+phase+'-'+device+'-'+theme,ids=await seedTopic(topic);p=await open(topic,device,topic,ids.m13);await p.send('Emulation.setEmulatedMedia',{features:[{name:'prefers-color-scheme',value:theme}]});await bind(p,receipt);
    await until(()=>p.evaluate(E.ready),'mutant initial reads settle');await position(p,ids.m7,-90);
    const before=await p.evaluate(capture785),id=await arrival(p,topic,topic+'-arrival');await settle(p);const after=await p.evaluate(read785);
    if(phase==='no-hold') {assert.ok(Math.abs(after.top-before.top)>40,'applied no-hold source moves actual geometry by >40px');assert.throws(()=>held785(before,after),/reading anchor drift/);}
    else if(phase==='wrong-anchor') {
     // Change height above the true reading character but below the wrong last-card anchor.
     await resizeAbove(p,ids.m3,140);const wrong=await p.evaluate(read785);history('wrong anchor geometry',{before,wrong});
     assert.ok(Math.abs(wrong.top-before.top)>40,'wrong-anchor source moves actual geometry by >40px');assert.throws(()=>held785(before,wrong),/reading anchor drift/);
    } else {
     held785(before,after);const pill=await p.evaluate(pill785);history('mutated pill geometry',{phase,pill});await shot(p,'reading785-'+phase);
     if(phase==='fallback') {history('unsupported anchor source control',{actualEngineSupports:pill?.supports});solid785(pill,{fallback:true});await activate(p,device,id);}
     else if(phase==='pill-centre'&&!pill.supports)history('centre mutant unrun',{reason:'engine does not support anchor syntax; actual fallback measured separately'});
     else assert.throws(()=>solid785(pill),phase==='pill-top'?/pill top/:phase==='pill-centre'?/pill centred/:phase==='pill-shadow'?/pill has shadow/:/pill surface is opaque/);
    }
    history('runtime mutant caught or fallback verified',{phase,before,after});assert.deepEqual(p.errors,[]);
   } catch(error){history('runtime failure',{phase,error:error.stack});throw error;} finally {
    if(p)await p.close();
    const restored=await control({method:'reading_785_runtime',phase:'restored'});assert.equal(restored.restored,true);assert.deepEqual(restored.hashes,receipt.candidate_hashes);history('runtime byte restored',{receipt:restored});
    let restoredPage;
    try {const key='reading785-restored-'+phase+'-'+device+'-'+theme,ids=await seedTopic(key);restoredPage=await open(key,'laptop',key,ids.m13);await bind(restoredPage,restored);await until(()=>restoredPage.evaluate(E.ready),'restored candidate initial reads settle');await position(restoredPage,ids.m7,-90);const before=await restoredPage.evaluate(capture785);await arrival(restoredPage,key,key+'-new');await snapshot(restoredPage,'restored native control '+phase,before);assert.deepEqual(restoredPage.errors,[]);}
    finally {if(restoredPage)await restoredPage.close();}

   }
  }
 });
}

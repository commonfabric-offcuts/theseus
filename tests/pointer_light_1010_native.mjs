// Actual pointer/key/touch input. Geometry/state reads are observations, never gesture substitutes.
import assert from 'node:assert/strict';
export const SIZES1010={laptop:{width:1280,height:900,mobile:false},w320:{width:320,height:844,mobile:true},w375:{width:375,height:844,mobile:true},w390:{width:390,height:844,mobile:true}};
export const cases1010=()=>Object.keys(SIZES1010).flatMap(size=>['light','dark'].flatMap(theme=>['bookends','paper'].map(look=>({id:'L-'+look,size,theme,look,name:`1010 ${size} ${theme} ${look}`}))));
// Same bounded leaving-page rule as tests/webkit_native.mjs: retain the event; all other errors fail.
export const leavingReadCancellation=(error,engine,leaving)=>engine==='webkit'&&leaving&&/^Fetch API cannot load \S+ due to access control checks\.$/.test(error.stack?.split('\n')[0]??'');
const q=JSON.stringify,group='.look-switch[data-switch="pointerLight"]';
export async function pointerLight1010Checks({check,page,until,control,facts,shot,observations,engine},{seed,cases=cases1010()}){
 for(const spec of cases)await check(spec.name,async()=>{
  const metrics=SIZES1010[spec.size],phone=metrics.mobile,slug=`reading-1010-${spec.id}-${spec.size}-${spec.theme}`,topic=slug+'-a',other=slug+'-b';
  const body='Alpha sentence. Beta sentence.';
  const ids=await seed(topic,[['head',{sender:'aim-core',join:true,addressees:[facts.actor],body:'Dossier first words.',read:true,divergence_reason:'1010 isolated dossier'}],['reply',{sender:'aim-ux',join:true,reply_to:'head',addressees:[facts.actor],body:'Dossier reply words.',read:true,reply_without_quote:'1010 isolated reply'}],['a',{sender:'aim-core',addressees:[facts.actor],body,read:true,divergence_reason:'1010 independent outlined target'}]]);
  await control({method:'navigation_topics',topics:[{id:other,title:'1010 other topic'}]});
  const p=await page(slug,null,true,{url:facts.origin+'/?topic='+topic,beforeNavigate:async pg=>{
   await pg.send('Page.addScriptToEvaluateOnNewDocument',{source:`(()=>{window.probe1010={document:crypto.randomUUID(),sources:[],trusted:[],pending:0};const raw=fetch;window.fetch=function(input,init){let b;try{b=JSON.parse(init?.body??'null')}catch{}probe1010.pending++;const answer=raw.call(this,input,init);answer.then(r=>r.clone().arrayBuffer()).then(()=>probe1010.pending--,()=>probe1010.pending--);if(b?.name==='source')answer.then(r=>r.clone().json()).then(r=>probe1010.sources.push({request:b.args,source:r.source_ref,body:r.body}),()=>{});return answer};addEventListener('click',e=>probe1010.trusted.push({trusted:e.isTrusted,target:e.target.textContent}),true);if(!sessionStorage.getItem('init1010')){sessionStorage.setItem('init1010','1');${spec.look==='paper'?"localStorage.setItem('theseus-look','paper');":''}}})()`});
   await pg.send('Emulation.setDeviceMetricsOverride',{...metrics,deviceScaleFactor:1});if(phone)await pg.send('Emulation.setTouchEmulationEnabled',{enabled:true,maxTouchPoints:1});
   await pg.send('Emulation.setEmulatedMedia',{features:[{name:'prefers-color-scheme',value:spec.theme}]});
  }});
  let n=0;
  const record=async label=>{observations.push({case:spec.name,label,state:await p.evaluate(`({href:location.href,document:probe1010.document,preference:document.documentElement.dataset.pointerLight??'',stored:localStorage.getItem('theseus-pointer-light'),lit:[...document.querySelectorAll('#messages .lit[data-id]')].map(e=>e.dataset.id),pointer:[...CSS.highlights.values()].flatMap(h=>[...h]).map(r=>r.toString()),reader:document.querySelector('#reader')?.open,source:probe1010.sources.at(-1),focus:document.activeElement?.id})`)});await shot(p,`${slug}-${++n}-${label}`);};
  const aim=async(selector,kind='click',text=false)=>{
   await p.evaluate(`document.querySelector(${q(selector)})?.scrollIntoView({block:'center',behavior:'instant'})`);await p.evaluate('document.fonts.ready');await p.evaluate('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');let priorPoint;
   const at=await until(async()=>{const current=await p.evaluate(`(()=>{const e=document.querySelector(${q(selector)});if(!e||!e.getClientRects().length)return false;let b=e.getBoundingClientRect();${text?"const w=document.createTreeWalker(e,NodeFilter.SHOW_TEXT);let t;while(t=w.nextNode()){if(t.data.trim()){const r=document.createRange();r.setStart(t,0);r.setEnd(t,Math.min(1,t.data.length));b=r.getBoundingClientRect();break;}}":''}const x=b.left+Math.min(6,b.width/2),y=b.top+b.height/2;return x>=0&&y>=0&&x<innerWidth&&y<innerHeight&&e.contains(document.elementFromPoint(x,y))?{x:(x-(visualViewport?.offsetLeft??0))*(visualViewport?.scale??1),y:(y-(visualViewport?.offsetTop??0))*(visualViewport?.scale??1)}:false})()`);const before=priorPoint;priorPoint=current;return current&&before&&Math.abs(current.x-before.x)<.5&&Math.abs(current.y-before.y)<.5?current:false;},'stable visible target '+selector);
   await p.send('Input.dispatchMouseEvent',{type:'mouseMoved',x:at.x-8,y:at.y});await p.send('Input.dispatchMouseEvent',{type:'mouseMoved',...at});
   if(kind==='tap'){await p.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[at]});await p.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});}
   else if(kind==='click'){await p.send('Input.dispatchMouseEvent',{type:'mousePressed',...at,button:'left'});await p.send('Input.dispatchMouseEvent',{type:'mouseReleased',...at,button:'left'});}
   return at;
  };
  const press=selector=>aim(selector,phone?'tap':'click');
  const openRail=async()=>{if(phone&&!await p.evaluate("document.querySelector('#rail').classList.contains('open')"))await press('#rail-open');};
  const closeRail=async()=>{if(phone&&await p.evaluate("document.querySelector('#rail').classList.contains('open')")){await p.key('Escape');await until(()=>p.evaluate("!document.querySelector('#rail').classList.contains('open')"),'native Escape closes rail');}};
  const choose=async off=>{await openRail();await press(group+` button[data-value="${off?'off':''}"]`);assert.equal(await p.evaluate(`document.querySelector(${q(group+` button[data-value="${off?'off':''}"]`)}).getAttribute('aria-pressed')`),'true');await closeRail();};
  const card=id=>`#messages .message-card[data-id="${id}"]`,lit=()=>p.evaluate("CSS.highlights.get('lit-passage')?.size??0");
  const closeReply=async()=>{if(await p.evaluate("document.querySelector('#reader').open"))await press('#reader-close');else await press(card(ids.a)+' .card-reply-close');};
  const ready=()=>until(()=>p.evaluate("document.body.dataset.ready==='true'"),'page ready');
  try{
   await ready();
   if(process.argv.includes('--notebook-only')){
    const note=await control({method:'agent_view',name:'memory_current',args:{item_id:'fixture-notebook'}});
    await control({method:'memory_revise',operation_id:'1010-notebook-probe-'+slug,item_id:'fixture-notebook',expected_revision:note.source_ref.revision,title:'Pointer passage notebook',body:'## Card\n\nNotebook first sentence. Another sentence.'});
    await p.send('Page.navigate',{url:facts.origin+'/?cards=fixture-notebook&view=cards'});await ready();
    await until(()=>p.evaluate("Boolean(document.querySelector('.deck-card.notebook-reading-words'))"),'bound Notebook');
    await p.evaluate(`(async()=>{const feed=performance.getEntriesByType('resource').find(e=>e.name.includes('/feed-passages.mjs'))?.name??'/feed-passages.mjs';const {FeedPassages}=await import(feed);const real=FeedPassages.prototype.point;probe1010.passages=[];probe1010.events=[];probe1010.valid=[];document.addEventListener('pointermove',e=>probe1010.events.push({type:e.pointerType,target:e.target.outerHTML?.slice(0,200),buttons:e.buttons,screenX:e.screenX,screenY:e.screenY,clientX:e.clientX,clientY:e.clientY}),true);const nb=performance.getEntriesByType('resource').find(e=>e.name.includes('/notebook-passages.mjs'))?.name??'/notebook-passages.mjs';const {NotebookPassages}=await import(nb);const valid=NotebookPassages.prototype.valid;NotebookPassages.prototype.valid=function(entry){const r=entry&&this.records.get(entry),v=valid.call(this,entry);probe1010.valid.push({entry:Boolean(entry),record:Boolean(r),current:r?.current(),value:v,active:document.activeElement?.tagName});return v;};FeedPassages.prototype.point=function(e,entry){const hit=this.at(e.clientX,e.clientY,entry);probe1010.passages.push({x:e.clientX,y:e.clientY,type:e.pointerType,buttons:e.buttons,lights:this.lights(),supported:this.supported,point:this.pointer,hit:hit&&hit.span});const result=real.call(this,e,entry);probe1010.passages.at(-1).lit=this.lit&&{start:this.lit.start,end:this.lit.end};return result;}})()`);
    const actualPoint=await aim('.deck-card.notebook-reading-words .deck-words','move',true);observations.push({case:spec.name,label:'notebook-point',point:actualPoint,viewport:await p.evaluate('({scale:visualViewport.scale,offsetX:visualViewport.offsetLeft,offsetY:visualViewport.offsetTop,scroll:scrollY,width:innerWidth})')});
    observations.push({case:spec.name,label:'notebook-native-probe',state:await p.evaluate('({passages:probe1010.passages,events:probe1010.events,valid:probe1010.valid})')});
    assert.ok(await p.evaluate("CSS.highlights.get('notebook-lit-passage')?.size??0"),'actual Notebook pointer on');return;
   }
   await until(()=>p.evaluate(`Boolean(document.querySelector(${q(card(ids.a))}))`),'seeded message');await openRail();
   assert.equal(await p.evaluate(`document.querySelectorAll(${q(group)}).length`),1,'one pointer lighting switch');
   assert.equal(await p.evaluate(`document.querySelector(${q(group+' button[data-value=""]')})?.getAttribute('aria-pressed')`),'true','default on');
   const box=await p.evaluate(`(()=>{const e=document.querySelector(${q(group)}),b=e.getBoundingClientRect();return {left:b.left,right:b.right,width:innerWidth,buttons:[...e.children].map(x=>({height:x.getBoundingClientRect().height,width:x.getBoundingClientRect().width}))}})()`);
   observations.push({case:spec.name,label:'switch-geometry',box});assert.ok(box.left>=-1&&box.right<=box.width+1,'whole switch inside phone/desktop');if(phone)assert.ok(box.buttons.every(b=>b.height>=44&&b.width>=44),'new switch touch targets at least44px');
   await closeRail();await choose(true);
   await openRail();await press(group+' button[data-value=""]');await p.key('Tab');
   assert.equal(await p.evaluate(`document.activeElement?.matches(${q(group+' button[data-value="off"]')})`),true,'native Tab reaches Light off');
   await p.key('Space');assert.equal(await p.evaluate("document.documentElement.dataset.pointerLight"),'off','native Space chooses off');await closeRail();await record('off');
   await aim(card(ids.a)+' > .message-preview','move',true);assert.equal(await lit(),0,'off pointer lights no passage');assert.equal(await p.evaluate(`document.querySelector(${q(card(ids.a))}).outerHTML.includes('linear-gradient(var(--lit-field)')`),false,'no hidden inline passage field');
   assert.equal(await p.evaluate(`document.querySelector(${q(card(ids.a))}).classList.contains('lit')`),true,'message outline remains');
   await p.key('Enter');await until(()=>p.evaluate(`document.activeElement?.id===${q('reply-'+ids.a+'-writing-body')}`),'784 current unquoted Reply');
   assert.equal(await p.evaluate(`document.querySelector('#reader').open`),false);await p.key('Enter');
   assert.equal(await p.evaluate('document.activeElement.value'),'\n','writing Return stays newline');await p.key('Backspace');await closeReply();await press('#people-heading');for(let step=0;step<40&&!await p.evaluate("document.activeElement?.matches('.message-card,.stack-toggle')");step++)await p.key('ArrowDown');
   assert.equal(await p.evaluate("document.activeElement?.matches('.message-card,.stack-toggle')"),true,'native arrows keep their message/dossier outline with pointer light off');assert.equal(await lit(),0);
   await choose(false);await aim(card(ids.a)+' > .message-preview','move',true);await until(lit,'on lights actual passage');
   assert.equal(await p.evaluate("[...CSS.highlights.get('lit-passage')][0].toString()"),'Alpha sentence. ');await record('on-hover');
   // Toggle off while a passage exists: the real button clears it without a message-side move.
   await choose(true);assert.equal(await lit(),0,'actual off press clears old highlight');assert.equal(await p.evaluate(`document.querySelector(${q(card(ids.a))}).outerHTML.includes('linear-gradient(var(--lit-field)')`),false,'actual off clears painted field');
   await p.send('Page.reload',{});await ready();assert.equal(await p.evaluate("document.documentElement.dataset.pointerLight"),'off','off kept through reload');
   const before=await p.evaluate('probe1010.document');await openRail();
   const outcome='#outline li[data-workspace-id="w1"]';await until(()=>p.evaluate(`Boolean(document.querySelector(${q(outcome)}))`),'outcome row');
   if(!await p.evaluate(`document.querySelector(${q(outcome)}).hasAttribute('data-open')`))await press(outcome+' .ol-disclosure');
   await press(`#outline a[data-topic-id="${other}"]`);await until(()=>p.evaluate(`location.search.includes(${q(other)})`),'in-place other topic');
   assert.equal(await p.evaluate('probe1010.document'),before,'same document through navigation');assert.equal(await p.evaluate(`document.querySelectorAll(${q(group)}).length`),1,'no duplicate remount');assert.equal(await p.evaluate("document.documentElement.dataset.pointerLight"),'off');
   // Real reload into the seeded topic still has the device setting.
   await p.send('Page.navigate',{url:facts.origin+'/?topic='+topic});await ready();
   await aim(card(ids.a)+' > .message-preview','move',true);
   // Native drag leaves real selected text even though pointer passages are off.
   const point=await aim(card(ids.a)+' > .message-preview','move',true);
   await p.send('Input.dispatchMouseEvent',{type:'mousePressed',...point,button:'left'});await p.send('Input.dispatchMouseEvent',{type:'mouseMoved',x:point.x+48,y:point.y});await p.send('Input.dispatchMouseEvent',{type:'mouseReleased',x:point.x+48,y:point.y,button:'left'});
   const selected=await p.evaluate('getSelection().toString()');assert.ok(selected.trim(),'native drag selects actual words');assert.equal(await lit(),0,'drag did not make a pointer passage');
   await p.key('Enter');await until(()=>p.evaluate("document.querySelector('#reader').open"),'actual selected text quotes');
   assert.equal(await p.evaluate("document.querySelector('#writing-body').value"),'> '+selected+'\n\n','exact native selection retained');
   await aim('#source-body [data-start]','click',true);await aim('#source-body [data-start]','move',true);assert.equal(await p.evaluate("document.querySelectorAll('#source-body .hover-quote').length"),0,'Reader pointer respects off');await record('off-reader-selection');
   await press('#reader-close');await choose(false);
   await aim(card(ids.a)+' > .message-preview','move',true);await until(lit,'on again');const quoted=await p.evaluate("[...CSS.highlights.get('lit-passage')][0].toString()");await p.key('Enter');await until(()=>p.evaluate("document.querySelector('#reader').open"),'hover Return quotes');assert.equal(await p.evaluate("document.querySelector('#writing-body').value"),'> '+selected+'\n\n> '+quoted+'\n\n','kept selected-text draft plus the new exact hover quote');
   assert.ok((await p.evaluate('probe1010.trusted')).every(e=>e.trusted),'all recorded clicks native');await record('on-return');
   await aim('#source-body [data-start]','click',true);assert.ok(await p.evaluate("document.querySelectorAll('#source-body .hover-quote').length"),'Reader pointer on lights its passage');
   await press('#reader-close');await choose(true);
   const note=await control({method:'agent_view',name:'memory_current',args:{item_id:'fixture-notebook'}});
   assert.equal((await control({method:'memory_revise',operation_id:'1010-note-'+slug,item_id:'fixture-notebook',expected_revision:note.source_ref.revision,title:'Pointer passage notebook',body:'## Card\n\nNotebook first sentence. Another sentence.'})).status,'committed');
   const notebook=async()=>{await p.send('Page.navigate',{url:facts.origin+'/?cards=fixture-notebook&view=cards'});await ready();await until(()=>p.evaluate("Boolean(document.querySelector('.deck-card.notebook-reading-words:not(.deck-writing) .deck-words'))"),'Notebook saved words bound to passage owner');};
   const noteWords='.deck-card.notebook-reading-words:not(.deck-writing) .deck-words';
   await notebook();await aim(noteWords,'move',true);assert.equal(await p.evaluate("CSS.highlights.get('notebook-lit-passage')?.size??0"),0,'shared Notebook pointer off');
   await p.send('Page.navigate',{url:facts.origin+'/?topic='+topic});await ready();await choose(false);await notebook();await aim(noteWords,'move',true);
   await until(()=>p.evaluate("CSS.highlights.get('notebook-lit-passage')?.size??0"),'Notebook pointer on');assert.equal(await p.evaluate("[...CSS.highlights.get('notebook-lit-passage')][0].toString()"),'Notebook first sentence. ');await record('notebook-on');
   assert.deepEqual(p.errors,[]);
  }catch(error){observations.push({case:spec.name,label:'failure-dom',state:await p.evaluate(`({focus:document.activeElement?.outerHTML.slice(0,800),cards:[...document.querySelectorAll('.deck-card')].map(e=>e.outerHTML.slice(0,1400)),selection:getSelection().toString(),media:{hover:matchMedia('(hover:hover)').matches,coarse:matchMedia('(pointer:coarse)').matches}})`)});await record('failure');throw error;}finally{await p.close();}
 });
}

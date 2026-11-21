import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

// Real input and scratch Core readback. No direct product handler calls.
export async function notebookDraft827Checks({check,page,until,control,view,facts,shot,observations,engine='chrome'}) {
 for(const phone of [true,false])for(const theme of ['light','dark'])for(const surface of ['sheet','full'])for(const mode of ['text','cards']) {
  const label=`${phone?'phone':'laptop'}-${theme}-${surface}-${mode}`,name=`notebook item 827 ${label}: menu actions preserve both Draft states`;
  await check(name,async()=>{
   const id='nb827-'+label,body='## First\n\nExact private words — keep  two spaces.\n\n## Second\n\nLast line.\n';
   let title='Notebook '+label,p,phase='setup';
   const host=surface==='sheet'?'#notebook-sheet-dialog .notebook-sheet-page:not([hidden])':'#deck-page';
   const more=surface==='sheet'?'#notebook-sheet-dialog button.notebook-menu':'#deck-page button.notebook-menu';
   const current=()=>view('memory_current',{item_id:id});
   const fields=s=>({title:s.title,body:s.body,attachments:s.attachments,references:s.references,draft:s.draft});
   const press=async selector=>{
    await p.evaluate(`document.querySelector(${JSON.stringify(selector)}).scrollIntoView({block:'center',behavior:'instant'})`);
    if(!phone)return p.point(selector);
    const at=await p.evaluate(`new Promise(done=>requestAnimationFrame(()=>requestAnimationFrame(()=>{const e=document.querySelector(${JSON.stringify(selector)}),b=e.getBoundingClientRect(),x=b.x+b.width/2,y=b.y+b.height/2;done({x,y,width:b.width,height:b.height,hit:e.contains(document.elementFromPoint(x,y))})})))`);
    assert.ok(at.width>0&&at.height>0&&at.hit,'native touch target is visible and uncovered: '+selector);
    await p.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:at.x,y:at.y}]});
    await p.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
   };
   const openMenu=async draft=>{
    await until(()=>p.evaluate(`(b=>b&&!b.disabled&&b.getClientRects().length)(document.querySelector(${JSON.stringify(more)}))`),'page menu available');
    await press(more);await until(()=>p.evaluate('Boolean(document.querySelector(".message-menu-list"))'),'actual menu opens');
    const rows=await p.evaluate('[...document.querySelectorAll(".message-menu-list > button")].map(b=>({label:b.textContent.trim(),checked:b.getAttribute("aria-checked")}))');
    assert.equal(rows.find(r=>r.label==='Private Draft')?.checked,String(draft),'menu check matches actual Draft state');
   };
   const choose=async label=>{
    const index=await p.evaluate(`[...document.querySelectorAll('.message-menu-list > button')].findIndex(b=>b.textContent.trim()===${JSON.stringify(label)})`);
    assert.ok(index>=0,'menu offers '+label);await press(`.message-menu-list > button:nth-child(${index+1})`);
   };
   const exact=async draft=>{
    const s=await current();assert.deepEqual(fields(s),{title,body,attachments:[],references:[],draft},'exact page content and Draft survive menu action');
    observations.push({name,phase,draft,revision:s.source_ref.revision,starred:s.starred,contentSha256:createHash('sha256').update(JSON.stringify(fields(s))).digest('hex')});return s;
   };
   try {
    assert.equal((await control({method:'outcome_reference',operation_id:id,item_id:id,title,body})).status,'committed');
    const url=facts.origin+(surface==='sheet'?`/?topic=t1&page=${id}`:`/?cards=${id}&view=${mode}`);
    p=await page(id,null,true,{url,beforeNavigate:async q=>{
     await q.send('Emulation.setDeviceMetricsOverride',{width:phone?390:1280,height:900,deviceScaleFactor:1,mobile:phone});
     if(phone)await q.send('Emulation.setTouchEmulationEnabled',{enabled:true,maxTouchPoints:1});
     await q.send('Emulation.setEmulatedMedia',{features:[{name:'prefers-color-scheme',value:theme}]});
    }});
    await until(()=>p.evaluate(`document.body.dataset.ready==='true'&&document.querySelector(${JSON.stringify(more)})?.getClientRects().length`),'Notebook surface opens');
    await until(()=>p.evaluate(`document.querySelector(${JSON.stringify(host+' .notebook-text')})?.value.includes('Exact private words')`),'saved Notebook content finishes loading before the first menu tap');
    await openMenu(false);await choose(mode==='text'?'Show as text':'Show as cards');phase='initial-view';await exact(false);
    for(const draft of [false,true]) {
     phase='open-close-'+draft;await openMenu(draft);await p.key('Escape');await exact(draft);
     for(const starred of [true,false]) {
      phase=(starred?'star-':'unstar-')+draft;const before=await current();await openMenu(draft);await choose(starred?'Star':'Unstar');
      await until(async()=>(await current()).starred===starred,'native star commits');
      assert.equal((await exact(draft)).source_ref.revision,before.source_ref.revision,'personal star writes no content revision');
     }
     const field=(surface==='sheet'?'#notebook-sheet-dialog':'#topic-title')+' .notebook-rename:not([hidden])',before=await current();phase='rename-cancel-'+draft;
     await openMenu(draft);await choose('Rename');await until(()=>p.evaluate(`Boolean(document.querySelector(${JSON.stringify(field)})?.getClientRects().length)`),'actual title field opens');
     await press(field);await p.key('a',4);await p.send('Input.insertText',{text:'Canceled title'});await p.key('Escape');
     assert.equal((await exact(draft)).source_ref.revision,before.source_ref.revision,'canceled rename writes no revision');
     phase='rename-save-'+draft;await openMenu(draft);await choose('Rename');
     await until(()=>p.evaluate(`Boolean(document.querySelector(${JSON.stringify(field)})?.getClientRects().length)`),'title field returns');
     const renamed=title+' renamed';await press(field);await p.key('a',4);await p.send('Input.insertText',{text:renamed});await p.key('Enter');
     await until(async()=>(await current()).title===renamed,'native rename commits');title=renamed;
     assert.equal((await exact(draft)).source_ref.revision,before.source_ref.revision+1,'rename appends one complete revision');
     phase='explicit-draft-'+draft;await openMenu(draft);await choose('Private Draft');
     await until(async()=>(await current()).draft===!draft,'explicit Private Draft changes the flag');await exact(!draft);
    }
    phase='reload';await p.evaluate('window.nb827BeforeReload=true');await p.send('Page.reload');
    await until(async()=>{try{return await p.evaluate(`!window.nb827BeforeReload&&document.body.dataset.ready==='true'`);}catch(error){if(/navigated|Execution context|Cannot find context/.test(error.message))return false;throw error;}},'new document returns after real reload');
    // Topic page links are consumed on arrival (app.mjs pageAnchor). Reopen
    // that exact saved page through its real link after reloading the feed.
    if(surface==='sheet')await p.send('Page.navigate',{url});
    await until(()=>p.evaluate(`document.querySelector(${JSON.stringify(host+' .notebook-text')})?.value.includes('Exact private words')`),'saved content returns on its actual surface');
    await openMenu(false);await p.key('Escape');await exact(false);await shot(p,'notebook-827-'+label);assert.deepEqual(p.errors,[]);
    observations.push({name,engine,physicalPhone:false,input:phone?'native taps at390px and keyboard':'native pointer and keyboard',allPhases:'passed'});
   }catch(error){observations.push({name,phase,error:error.stack});if(p)await shot(p,'notebook-827-'+label+'-failure').catch(()=>{});throw error;}
   finally{if(p)await p.close();}
  });
 }
}

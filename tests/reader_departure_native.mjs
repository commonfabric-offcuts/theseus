import assert from 'node:assert/strict';

export function assertDepartureTrace(trace, expectedReceipts) {
  assert.equal(expectedReceipts.length,2,'both expected publication identities are retained');
  assert.ok(trace.some(e=>e.event==='registry trace installed'),'registry trace installed');
  assert.ok(trace.some(e=>e.event==='navigation trace installed'),'navigation trace installed');
  assert.ok(trace.some(e=>e.event==='notice mutation'&&e.hidden===false),'visible departure notice retained');
  const entries=trace.filter(e=>e.event==='openTarget entered');
  assert.ok(entries.length>0,'native departure decisions retained');
  for(const entry of entries){
    const click=trace.find(e=>e.event==='native click'&&e.act===entry.act);
    assert.equal(click?.target.topic,entry.destination.id,'actual native target matches the navigation decision');
    assert.ok(trace.some(e=>e.act===entry.act&&['openTarget settled','openTarget refused'].includes(e.event)),'navigation decision settled in retained trace');
    assert.equal(typeof entry.state.hasInFlightSend,'boolean');
    assert.ok(Array.isArray(entry.state.unconfirmed)&&Array.isArray(entry.state.sessions));
    assert.equal(typeof entry.state.notice.hidden,'boolean');
    for(const session of entry.state.sessions)assert.ok(Array.isArray(session.activeSends)&&Array.isArray(session.submissions));
  }
  for(const operationId of expectedReceipts)assert.ok(entries.some(e=>e.state.sessions.some(s=>s.submissions.some(i=>i.receipt?.operation_id===operationId&&i.receipt.status==='committed'))),'exact confirmed receipt retained at departure');
}

export async function departureChecks({check,page,until,facts,view,control,observations,shot}) {
  const ready=(p,id)=>until(async()=>{try{return await p.evaluate(`document.body.dataset.ready==='true' && new URL(location.href).searchParams.get('topic')===${JSON.stringify(id)}`);}catch{return false;}},'ready '+id);
  const point=async(p,selector)=>{
    await until(()=>p.evaluate(`(()=>{const all=document.querySelectorAll(${JSON.stringify(selector)});if(all.length!==1)return false;const b=all[0].getBoundingClientRect();return b.width>0&&b.height>0;})()`),'unique rendered departure target '+selector);
    await p.evaluate(`document.querySelector(${JSON.stringify(selector)}).scrollIntoView({block:'center',inline:'nearest'})`);await p.point(selector);
  };
  // The rail lists a workspace's topics in ID order, 20 to a page, behind More
  // (workspace_topics in aim_next/store.py, PAGE in web/topic-navigation.mjs).
  // Earlier cases in this fixture add topics that sort ahead of t1 and t2, so
  // the instrument pages the rail natively until its target is rendered, and
  // fails by name when neither the target nor More appears. A topic choice
  // loads a new document, whose rail starts again from the first page. Cases
  // reveal before writing, so no More press falls inside a timed or held act;
  // once a document has shown a target, choosing it there presses no More,
  // and a rail that fell back to its first page fails the case.
  const revealed=new WeakMap();
  const reveal=async(p,id)=>{
    const selector=`#topics a[data-topic-id="${id}"]`;
    for(let pressed=0;;++pressed){
      const found=await until(()=>p.evaluate(`(()=>{const all=document.querySelectorAll(${JSON.stringify(selector)});if(all.length>1)return false;
        if(all.length===1){const b=all[0].getBoundingClientRect();return b.width>0&&b.height>0&&'rendered';}
        const more=document.querySelector('#more-topics');return !more.hidden&&!more.hasAttribute('aria-disabled')&&'more';})()`),'unique rendered departure target '+selector+' or More topics');
      if(found==='rendered'){revealed.set(p,{id,document:await p.evaluate('performance.timeOrigin')});return pressed;}
      const count=await p.evaluate('document.querySelectorAll("#topics a").length');
      await p.evaluate('document.querySelector("#more-topics").scrollIntoView({block:"center",inline:"nearest"})');await p.point('#more-topics');
      await until(()=>p.evaluate(`document.querySelectorAll("#topics a").length>${count}`),'More topics rendered a later page');
    }
  };
  const choose=async(p,id='t2')=>{
    const shown=revealed.get(p),document=await p.evaluate('performance.timeOrigin');
    const pressed=await reveal(p,id);
    if(shown?.id===id&&shown.document===document)assert.equal(pressed,0,`the rail still shows ${id}, already revealed in this document, without More`);
    await point(p,`#topics a[data-topic-id="${id}"]`);return pressed;
  };
  const notice=p=>p.evaluate('document.querySelector("#topic-navigation-status").hidden?"":document.querySelector("#topic-navigation-status").textContent');
  const rows=p=>p.evaluate(`new Promise((resolve,reject)=>{const r=indexedDB.open('aim-next-pending',2);r.onerror=()=>reject(r.error);r.onsuccess=()=>{const db=r.result,t=db.transaction('editors'),q=t.objectStore('editors').index('editorKey').getAll(${JSON.stringify(JSON.stringify([facts.instance_id,facts.actor,'reply','topic','t1','t1']))});q.onsuccess=()=>resolve(q.result);q.onerror=()=>reject(q.error);t.oncomplete=()=>db.close();};})`);
  const write=async(p,text)=>{await point(p,'#inline-writing-body');await p.key('a',4);await p.send('Input.insertText',{text});};
  const setup=()=>control({method:'navigation_topics',topics:[{id:'t2',title:'Design discussion'}]});
  const observeDeparture=async p=>{p.requireDepartureTrace=true;return p.send('Page.addScriptToEvaluateOnNewDocument',{source:`
    window.departureDiagnostics=[];
    window.departureAct=0;window.departureClick=null;
    window.departureTrace=entry=>{departureDiagnostics.push(entry);console.log('departure-diagnostic',JSON.stringify(entry));};
    import('/app-session.mjs').then(({EditorRegistry})=>{
      const original=EditorRegistry.prototype.initializeInline;
      EditorRegistry.prototype.initializeInline=function(...args){window.departureRegistry=this;return original.apply(this,args);};
      departureTrace({event:'registry trace installed'});
    });
    import('/topic-navigation.mjs').then(({TopicNavigation})=>{const original=TopicNavigation.prototype.openTarget;TopicNavigation.prototype.openTarget=function(...args){
      const act=departureClick;departureTrace({event:'openTarget entered',act,destination:args[0],state:departureState()});
      const result=original.apply(this,args);result.then(value=>departureTrace({event:'openTarget settled',act,value,state:departureState()}),error=>departureTrace({event:'openTarget refused',act,error:error.message,state:departureState()}));return result;
    };departureTrace({event:'navigation trace installed'});});
    window.departureState=()=>{const r=window.departureRegistry;return {route:location.href,ready:document.body?.dataset.ready,
      links:[...document.querySelectorAll('#topics a')].map(a=>({id:a.dataset.topicId,href:a.href})),
      visibleCards:[...document.querySelectorAll('#review-content [data-id]')].map(n=>({id:n.dataset.id,text:n.textContent})),
      notice:{text:document.querySelector('#topic-navigation-status')?.textContent,hidden:document.querySelector('#topic-navigation-status')?.hidden},
      hasInFlightSend:r?.hasInFlightSend,unconfirmed:r?.unconfirmedSends.map(({editor,item})=>({key:editor.key,source:editor.sourceRef,id:item.id,status:item.status,receipt:item.receipt})),
      sessions:r?[...r.sessions.values()].map(s=>({key:s.editor.key,source:s.editor.sourceRef,activeSends:[...s.sends.keys()],submissions:s.editor.submissions.map(i=>({id:i.id,status:i.status,receipt:i.receipt,blocked:i.blocked})),attempts:s.attempts.map(a=>({id:a.envelope.operation_id,kind:a.envelope.kind,error:a.error,receipt:a.receipt}))})):[]};};
    document.addEventListener('click',e=>{const t=e.target.closest('a,button')??e.target;departureClick=performance.timeOrigin+':'+(++departureAct);departureTrace({event:'native click',act:departureClick,target:{tag:t.tagName,text:t.textContent?.slice(0,100),id:t.id,href:t.href,topic:t.dataset.topicId,submission:t.closest('[data-id]')?.dataset.id},state:departureState()});},true);
    document.addEventListener('DOMContentLoaded',()=>{const n=document.querySelector('#topic-navigation-status');if(n)new MutationObserver(()=>departureTrace({event:'notice mutation',text:n.textContent,hidden:n.hidden,state:departureState()})).observe(n,{subtree:true,childList:true,attributes:true,characterData:true});});
  `});};
  const exact=async(p,call,body)=>{
    const receipt=await view('operation',{operation_id:call.payload.operation_id});assert.equal(receipt.status,'committed');
    const source=await view('source',{kind:'message',id:receipt.result.message_id});
    assert.equal(source.body,body);assert.equal(source.topic_id,'t1');assert.equal(source.author,facts.actor);assert.equal(source.reply_to,null);
    const messages=await view('topic_messages',{topic_id:'t1',limit:100,cursor:source.seq-1,direction:'after'});
    assert.equal(messages.items.filter(m=>m.body===body).length,1,'exact message occurs once');
    assert.equal(p.calls.filter(c=>c.payload?.kind==='message.send'&&c.payload.operation_id===call.payload.operation_id).length,1);
    observations.push({name:'exact departure publication',receipt,source});
  };

  await check('navigation correction active prepare publication reload and settled confirmation',async()=>{
    await setup();const p=await page('departure-active',null,true,{beforeNavigate:observeDeparture}),body='One exact message before switching';
    await reveal(p,'t2');
    p.intercept(payload=>['submission.prepare','message.send'].includes(payload?.kind));
    await write(p,body);await p.key('Enter',4);
    const preparing=await until(()=>p.held.find(h=>h.payload?.kind==='submission.prepare'),'held prepare');
    await choose(p);await until(async()=>/send/i.test(await notice(p)),'active prepare keeps page with guidance');
    assert.equal(await p.evaluate('new URL(location.href).searchParams.get("topic")'),'t1');
    assert.equal(p.events.filter(e=>e.method==='Page.javascriptDialogOpening').length,0,'sidebar does not fall back to beforeunload');
    await p.release(preparing);
    const sending=await until(()=>p.held.find(h=>h.payload?.kind==='message.send'),'held publication');
    await choose(p);await until(async()=>/send/i.test(await notice(p)),'active publication keeps page with guidance');
    assert.match(await notice(p),/send/i);
    const origin=await p.evaluate('performance.timeOrigin');await p.send('Page.reload');
    await until(()=>p.events.some(e=>e.method==='Page.javascriptDialogOpening'&&e.params.type==='beforeunload'),'headless reload protection');
    assert.equal(await p.evaluate('performance.timeOrigin'),origin,'CDP dismisses reload and keeps document');
    p.intercept(null);await p.release(sending);await exact(p,sending,body);
    await point(p,'#inline-pending button');
    await until(()=>p.evaluate(`document.querySelector('#review-content [data-id="${sending.payload.args.submission_id}"] h3')?.textContent==='Sent to Theseus'`),'publication visibly confirmed');
    await point(p,'#review-close');
    await choose(p);await ready(p,'t2');await choose(p,'t1');await ready(p,'t1');await reveal(p,'t2');

    const unknown='A committed publication awaiting its original confirmation';
    p.intercept(payload=>payload?.kind==='message.send');await write(p,unknown);await p.key('Enter',4);
    const held=await until(()=>p.held.find(h=>h.payload?.kind==='message.send'&&h.payload.operation_id!==sending.payload.operation_id),'unknown publication response');
    p.intercept(null);await p.fail(held);
    const item=await until(async()=>{const all=await rows(p);return all.flatMap(r=>r.snapshot.submissions).find(i=>i.status==='prepared'&&i.snapshot.body===unknown);},'settled pending publication');
    await choose(p);await until(async()=>/unconfirmed/i.test(await notice(p)),'unconfirmed choice notice');
    await point(p,'#inline-pending button');await point(p,`#review-content [data-id="${item.id}"] button`);
    await until(()=>p.evaluate(`document.querySelector('#review-content [data-id="${item.id}"] h3')?.textContent==='Sent to Theseus'`),'Check confirms original publication');
    await point(p,'#review-close');await choose(p);await ready(p,'t2');await exact(p,held,unknown);
    assert.equal(p.events.filter(e=>e.method==='Page.javascriptDialogOpening').length,1,'only the deliberate headless reload opened a prompt');
    p.departureExpectedReceipts=[sending.payload.operation_id,held.payload.operation_id];
    assert.deepEqual(p.errors,[]);
  });

  await check('navigation departure instrument waits for the actual rendered target',async()=>{
    await setup();const hold='departure-rail-not-ready';
    await control({method:'read_hold',hold_id:hold,name:'workspace_topics',read_class:'foreground',phase:'callback',count:1});
    let p;
    try {
      p=await page('departure-target-readiness',null,true);
      assert.equal(await p.evaluate('document.querySelectorAll("#topics a[data-topic-id=t2]").length'),0,'the held read really prevents the target from existing');
      let observed=0,settled=false;const evaluate=p.evaluate;p.evaluate=async expression=>{try{return await evaluate(expression);}finally{observed++;}};
      let pressed=null;const selecting=choose(p).then(count=>{settled=true;pressed=count;},error=>{settled=true;throw error;});selecting.catch(()=>{});
      await until(()=>observed>0,'target observation attempted');
      assert.equal(settled,false,'the helper must wait for its absent target instead of attempting a native click');
      await control({method:'read_release',hold_id:hold});await selecting;await ready(p,'t2');
      observations.push({name:'departure instrument rail pages pressed',pressed});
      assert.deepEqual(p.errors,[]);assert.equal(p.calls.some(c=>c.payload?.kind),false);
    }finally{await control({method:'read_release',hold_id:hold});}
  });

  await check('navigation correction blocked before prepare informed departure and retained return',async()=>{
    await setup();const p=await page('departure-blocked',null,true),body='Retain this exact blocked original without replay';
    await reveal(p,'t2');
    p.intercept(payload=>payload?.kind==='draft.save'&&payload.args.source_ref?.kind==='topic');
    await write(p,body);await p.key('Enter',4);
    const held=await until(()=>p.held.find(h=>h.payload?.kind==='draft.save'),'held original save');
    await control({method:'read_fault',name:'operation',status:503,body:{error:{code:'SERVER_BUSY',message:'Confirmation unavailable',retryable:true}},count:1});
    p.intercept(null);await p.fail(held);
    const original=await until(async()=>{const all=await rows(p);return all.flatMap(r=>r.snapshot.submissions).find(i=>i.blocked&&i.snapshot.body===body);},'durable blocked-before-prepare item');
    assert.equal(p.calls.some(c=>c.payload?.kind==='submission.prepare'),false,'preparation was never issued');
    await choose(p);await until(async()=>/unconfirmed/i.test(await notice(p)),'first blocked departure stays');
    assert.match(await notice(p),/device.*Design discussion/is);
    assert.equal(await p.evaluate('new URL(location.href).searchParams.get("topic")'),'t1');
    await choose(p);await ready(p,'t2');await choose(p,'t1');await ready(p,'t1');
    const retained=(await rows(p)).flatMap(r=>r.snapshot.submissions).find(i=>i.id===original.id);
    assert.deepEqual(retained,original,'same retained pending item survives both navigations');
    // A different document finds local-only work through the existing explicit
    // recovery flow. It must not silently adopt or replay the submission.
    await point(p,'#inline-review-versions');
    await until(()=>p.evaluate(`[...document.querySelectorAll('#review-content button')].some(b=>b.textContent==='Recover this version')`),'retained copy recovery action renders');
    const recover=await p.evaluate(`(()=>{const b=[...document.querySelectorAll('#review-content button')].find(b=>b.textContent==='Recover this version');if(!b)return null;b.dataset.nativeRecover='';return !b.disabled;})()`);
    assert.equal(recover,true,'retained copy is discoverable and recoverable');
    await point(p,'[data-native-recover]');await until(()=>p.evaluate('!document.querySelector("#version-review").open'),'explicit recovery closes review');
    await point(p,'#inline-pending button');
    assert.equal(await p.evaluate(`document.querySelector('#review-content [data-id="${original.id}"] pre').textContent`),body);
    assert.equal(p.calls.some(c=>c.payload?.kind==='message.send'||c.payload?.kind==='submission.prepare'),false,'departure and explicit recovery never replay');
    assert.equal(p.events.some(e=>e.method==='Page.javascriptDialogOpening'),false,'settled item alone does not trap navigation');
    observations.push({name:'retained blocked original',original,retained});await shot(p,'departure-retained-pending');assert.deepEqual(p.errors,[]);
  });

  await check('navigation correction retry chain protects prepare publication and preserves original refusal',async()=>{
    await setup();const p=await page('departure-correction-chain',null,true),body='One exact deliberately corrected publication';
    await reveal(p,'t2');
    p.intercept(payload=>payload?.kind==='draft.save'&&payload.args.source_ref?.kind==='topic');
    await write(p,body);await p.key('Enter',4);
    const saved=await until(()=>p.held.find(h=>h.payload?.kind==='draft.save'),'original save held before preparation');
    const draft=(await view('editor_state',{source_ref:{kind:'topic',id:'t1'},topic_id:'t1'})).draft;
    // An isolated second writer advances the real canonical draft before the
    // browser can prepare A. This yields an actual retained CAS refusal.
    const other={...saved.payload,operation_id:'departure-correction-other-writer',
      expected:{...saved.payload.expected,draft_revision:draft.revision},
      args:{...saved.payload.args,body:'Other writer version reviewed before correction'}};
    const otherReceipt=await (await fetch(facts.origin+'/api/command',{method:'POST',headers:{
      Authorization:`Bearer ${facts.token}`,Origin:facts.origin,'Content-Type':'application/json'},body:JSON.stringify(other)})).json();
    assert.equal(otherReceipt.status,'committed');p.intercept(null);await p.release(saved);
    const original=await until(async()=>{const all=await rows(p);return all.flatMap(r=>r.snapshot.submissions).find(i=>i.status==='refused'&&i.snapshot.body===body);},'original refused preparation retained');
    const originalReceipt=await view('operation',{operation_id:original.prepareOperationId});
    assert.equal(originalReceipt.status,'rejected');assert.equal(originalReceipt.error.code,'REVISION_CONFLICT');
    const reviewButton=async text=>{
      await until(()=>p.evaluate(`(()=>{const b=[...document.querySelectorAll('#review-content button')].find(b=>b.textContent===${JSON.stringify(text)});if(!b||b.disabled)return false;b.dataset.nativeCorrection='';return true;})()`),'available '+text);
      await point(p,'[data-native-correction]');
    };
    await point(p,'#inline-pending button');await reviewButton('Prepare this reply again');
    await until(()=>p.evaluate('Boolean(document.querySelector("#review-content input[type=checkbox]"))'),'explicit correction review');
    await point(p,'#review-content input[type=checkbox]');
    p.intercept(payload=>['submission.prepare','message.send'].includes(payload?.kind));
    await reviewButton('Prepare this reply again');
    const preparing=await until(()=>p.held.find(h=>h.payload?.kind==='submission.prepare'),'held corrected preparation');
    await point(p,'#review-close');
    const stay=async stage=>{
      await choose(p);await until(async()=>/Wait for the send/.test(await notice(p)),stage+' uses active send guidance');
      assert.equal(await p.evaluate('new URL(location.href).searchParams.get("topic")'),'t1');
      const before=p.events.filter(e=>e.method==='Page.javascriptDialogOpening').length;
      const origin=await p.evaluate('performance.timeOrigin');await p.send('Page.reload');
      await until(()=>p.events.filter(e=>e.method==='Page.javascriptDialogOpening'&&e.params.type==='beforeunload').length>before,stage+' reload protection');
      assert.equal(await p.evaluate('performance.timeOrigin'),origin,'CDP immediately dismissed correction reload');
    };
    await stay('correction prepare');await p.release(preparing);
    const sending=await until(()=>p.held.find(h=>h.payload?.kind==='message.send'),'held corrected publication');
    await stay('correction publication');p.intercept(null);await p.release(sending);await exact(p,sending,body);
    await point(p,'#inline-pending button');
    await until(()=>p.evaluate(`document.querySelector('#review-content [data-id="${sending.payload.args.submission_id}"] h3')?.textContent==='Sent to Theseus'`),'corrected publication visibly confirmed');
    assert.equal(await p.evaluate(`document.querySelector('#review-content [data-id="${original.id}"] h3').textContent`),'Not sent — writing kept');
    assert.deepEqual(await view('operation',{operation_id:original.prepareOperationId}),originalReceipt,'original refusal is immutable');
    assert.equal(p.calls.filter(c=>c.payload?.kind==='message.send').length,1,'one correction publication, no original replay');
    await point(p,'#review-close');await choose(p);await ready(p,'t2');
    assert.equal(p.events.filter(e=>e.method==='Page.javascriptDialogOpening').length,2,'only the two deliberate reloads prompted');
    assert.deepEqual(p.errors,[]);observations.push({name:'native correction original refusal',originalReceipt,otherReceipt});
  });

  await check('navigation correction just closed Reader reply and note save inside debounce',async()=>{
    await setup();const p=await page('departure-closed-reader',null,true);
    for(const [index,note] of [[0,false],[1,true]]) {
      await reveal(p,'t2');await p.open(index);if(note)await point(p,'#toggle-note');
      const body=note?'Exact private note after closing':'Exact reply after closing';
      await point(p,'#writing-body');await p.key('a',4);await p.send('Input.insertText',{text:body});const typedAt=Date.now();
      await point(p,'#reader-close');await until(()=>p.evaluate('!document.querySelector("#reader").open'),'Reader closes');await choose(p);
      assert.ok(Date.now()-typedAt<450,'topic activation occurs before the real autosave delay');await ready(p,'t2');
      const state=await view('editor_state',{source_ref:facts.sources[index],topic_id:'t1'});assert.equal((note?state.note:state.draft)?.body,body);
      await choose(p,'t1');await ready(p,'t1');await p.open(index);if(note)await point(p,'#toggle-note');
      assert.equal(await p.evaluate('document.querySelector("#writing-body").value'),body);
      await point(p,'#reader-close');
    }
    assert.equal(p.calls.some(c=>c.payload?.kind==='message.send'||c.payload?.kind==='submission.prepare'),false);assert.equal(p.events.some(e=>e.method==='Page.javascriptDialogOpening'),false);assert.deepEqual(p.errors,[]);
  });
}

import assert from 'node:assert/strict';

export async function departureChecks({check,page,until,facts,view,control,observations,shot}) {
  const ready=(p,id)=>until(async()=>{try{return await p.evaluate(`document.body.dataset.ready==='true' && new URL(location.href).searchParams.get('topic')===${JSON.stringify(id)}`);}catch{return false;}},'ready '+id);
  const point=async(p,selector)=>{await p.evaluate(`document.querySelector(${JSON.stringify(selector)}).scrollIntoView({block:'center',inline:'nearest'})`);await p.point(selector);};
  const choose=(p,id='t2')=>point(p,`#topics a[data-topic-id="${id}"]`);
  const notice=p=>p.evaluate('document.querySelector("#topic-navigation-status").hidden?"":document.querySelector("#topic-navigation-status").textContent');
  const rows=p=>p.evaluate(`new Promise((resolve,reject)=>{const r=indexedDB.open('aim-next-pending',2);r.onerror=()=>reject(r.error);r.onsuccess=()=>{const db=r.result,t=db.transaction('editors'),q=t.objectStore('editors').index('editorKey').getAll(${JSON.stringify(JSON.stringify([facts.instance_id,facts.actor,'reply','topic','t1','t1']))});q.onsuccess=()=>resolve(q.result);q.onerror=()=>reject(q.error);t.oncomplete=()=>db.close();};})`);
  const write=async(p,text)=>{await point(p,'#inline-writing-body');await p.key('a',4);await p.send('Input.insertText',{text});};
  const setup=()=>control({method:'navigation_topics',topics:[{id:'t2',title:'Design discussion'}]});
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
    await setup();const p=await page('departure-active',null,true),body='One exact message before switching';
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
    await choose(p);await ready(p,'t2');await choose(p,'t1');await ready(p,'t1');

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
    assert.deepEqual(p.errors,[]);
  });

  await check('navigation correction blocked before prepare informed departure and retained return',async()=>{
    await setup();const p=await page('departure-blocked',null,true),body='Retain this exact blocked original without replay';
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

  await check('navigation correction just closed Reader reply and note save inside debounce',async()=>{
    await setup();const p=await page('departure-closed-reader',null,true);
    for(const [index,note] of [[0,false],[1,true]]) {
      await p.open(index);if(note)await point(p,'#toggle-note');
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

import assert from 'node:assert/strict';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';


export async function navigationChecks({ check, page, until, root, evidencePath, facts, view, control, shot, observations }) {
  const link = id => `#topics a[data-topic-id="${id}"]`;
  const topics = [{ id: 't2', title: 'Design discussion' }, { id: 't3', title: 'Greenlight discussion' }];
  // A wait that spans a document replacement can probe the new document after
  // it commits and before its body is parsed. Readiness probes read
  // document.body?.dataset, so that moment reads as not ready yet.
  const ready = (p, id) => until(async () => { try { return await p.evaluate(`document.body.dataset.ready==='true' && new URL(location.href).searchParams.get('topic')===${JSON.stringify(id)} && Boolean(document.querySelector(${JSON.stringify(link(id))}))`); } catch { return false; } }, 'topic '+id+' ready');
  // The rail fills from its own workspace_topics read, which may settle after
  // the page is ready; a native choice waits for its actual rendered link.
  const rendered = (p, id) => until(() => p.evaluate(`(()=>{const all=document.querySelectorAll(${JSON.stringify(link(id))});if(all.length!==1)return false;const b=all[0].getBoundingClientRect();return b.width>0&&b.height>0;})()`), 'rendered topic link '+id);
  const click = async (p, id) => { await rendered(p, id); await p.evaluate(`document.querySelector(${JSON.stringify(link(id))}).scrollIntoView({block:'center',inline:'nearest'})`); await p.point(link(id)); };
  const noActs = p => assert.equal(p.calls.some(c => ['workspace.create','message.send','submission.prepare','delivery.ack','opening.save','opening.publish'].includes(c.payload?.kind)), false, 'navigation never sends, acknowledges or creates work');
  const noPrompt = p => assert.equal(p.events.some(e => e.method === 'Page.javascriptDialogOpening'), false, 'normal navigation never relies on beforeunload confirmation');
  const state = () => view('editor_state', { source_ref: { kind: 'topic', id: 't1' }, topic_id: 't1' });
  const observeStorage=async p=>p.send('Page.addScriptToEvaluateOnNewDocument',{source:`
    window.storageWrites=[];
    for(const method of ['put','add','delete','clear']){const original=IDBObjectStore.prototype[method];IDBObjectStore.prototype[method]=function(...args){
      const act={method,store:this.name,db:this.transaction.db.name};storageWrites.push(act);console.log('ux-storage-write',JSON.stringify(act));return original.apply(this,args);
    };}
    import('/journal.mjs').then(({RecoveryJournal})=>{for(const method of ['save','saveLatest','transition','capture','releaseBytes','releaseExact','removeExact','retireAcknowledged','retireImageCandidate','changeCandidateImages','adopt']){
      const original=RecoveryJournal.prototype[method];if(!original)continue;RecoveryJournal.prototype[method]=function(...args){console.log('ux-journal-write',method);return original.apply(this,args);};
    }});
    import('/creation.mjs').then(({OutcomeCreation})=>{const original=OutcomeCreation.prototype.persist;OutcomeCreation.prototype.persist=function(...args){console.log('ux-journal-write','creation.persist');return original.apply(this,args);};});
  `});
  const storageActs=p=>p.events.filter(e=>e.method==='Runtime.consoleAPICalled'&&['ux-storage-write','ux-journal-write'].includes(e.params.args[0]?.value));
  let observedActionId=0;
  const observedAction=async(p,selector,kind)=>{
    const token=kind+':'+(++observedActionId);
    await p.evaluate(`(()=>{const node=document.querySelector(${JSON.stringify(selector)}),original=node.onclick;if(typeof original!=='function')throw Error('Native action handler absent');node.onclick=function(...args){const result=original.apply(this,args);Promise.resolve(result).then(()=>console.log('ux-action-settled',${JSON.stringify(token)}),()=>console.log('ux-action-settled',${JSON.stringify(token)}));return result;};node.scrollIntoView({block:'center'});})()`);
    await p.point(selector);
    await until(()=>p.events.some(e=>e.method==='Runtime.consoleAPICalled'&&e.params.args[0]?.value==='ux-action-settled'&&e.params.args[1]?.value===token),'exact native '+kind+' handler settled');
  };

  await check('navigation outcomes root empty paging keyboard and protected departure', async () => {
    // Outcomes list in workspace-ID order (docs/workspaces-query.md), and this
    // case places its rows by position, so it needs the fixture's w1 alone.
    assert.deepEqual((await view('workspaces',{limit:100})).items.map(x=>x.id),['w1'],'outcomes root starts from an outcome list holding only w1');
    const workspaces=Array.from({length:21},(_,n)=>({id:'outcome-'+String(n).padStart(2,'0'),title:n<2?'Same outcome':'Outcome '+n,purpose:'Purpose '+n}));
    const created=await control({method:'navigation_workspaces',workspaces});
    assert.ok(created.every(r=>r.status==='committed'));
    const p=await page('outcome-navigation',null,true,{url:facts.origin+'/'});
    const activate=async selector=>{await p.evaluate(`document.querySelector(${JSON.stringify(selector)}).scrollIntoView({block:'center',inline:'center'})`);await p.point(selector);};
    assert.equal(await p.evaluate('document.querySelector("#topic-title").textContent'),'Outcomes','root provides discoverable outcomes rather than requiring a topic URL');
    await until(()=>p.evaluate('document.querySelectorAll("#workspaces a").length===20'),'first bounded outcome page');
    assert.equal(p.calls.some(c=>['topic','topic_messages','editor_state'].includes(c.payload?.name)),false,'root reads no fabricated topic/editor');
    // Two outcomes with the same title stay two links to two pages; the grey line under each name
    // says where it stands (item 86), and its id is at the top of its own page.
    const labels=await p.evaluate('[...document.querySelectorAll("#workspaces a")].slice(0,2).map(a=>({text:a.textContent,href:a.getAttribute("href")}))');
    assert.deepEqual(labels,[{text:'Same outcomeNo topics yet',href:'?workspace=outcome-00'},{text:'Same outcomeNo topics yet',href:'?workspace=outcome-01'}]);
    await shot(p,'outcomes-root');
    await control({method:'read_fault',name:'workspaces',status:503,body:{error:{code:'DATABASE_BUSY',message:'Outcomes temporarily unavailable',retryable:true}},count:1});
    await activate('#refresh');
    await until(()=>p.evaluate('!document.querySelector("#retry-workspaces").hidden'),'outcome retry is discoverable');
    assert.match(await p.evaluate('document.querySelector("#outcomes-status").textContent'),/Outcomes temporarily unavailable/);
    assert.equal(await p.evaluate('document.querySelectorAll("#workspaces a").length'),20,'transient error preserves available choices');
    await activate('#retry-workspaces');
    await until(()=>p.evaluate('document.querySelector("#retry-workspaces").hidden'),'retry restores outcomes');
    assert.equal(await p.evaluate('document.activeElement.dataset.workspaceId'),'outcome-00','Retry hands focus to an available outcome');
    await activate('#more-workspaces');
    await until(()=>p.evaluate('document.querySelector("#more-workspaces").hidden'),'last outcome page');
    assert.equal(await p.evaluate('document.querySelectorAll("#workspaces a").length'),22);
    assert.equal(await p.evaluate('document.activeElement.dataset.workspaceId'),'outcome-20');
    await activate('#workspaces a[data-workspace-id="outcome-00"]');
    await until(()=>p.evaluate('document.body?.dataset.ready==="true" && new URL(location.href).searchParams.get("workspace")==="outcome-00"'),'empty outcome');
    assert.equal(await p.evaluate('document.querySelector("#topic-title").textContent'),'Same outcome');
    assert.match(await p.evaluate('document.querySelector("#outcome-empty").textContent'),/No topics yet/);
    assert.equal(await p.evaluate('document.querySelector("#inline-composer").hidden'),true);
    await shot(p,'outcomes-empty');
    // A keyboard user chooses the real outcome and topic through ordinary links.
    await activate('#outcomes-home');
    await until(()=>p.evaluate('document.body?.dataset.ready==="true" && !location.search'),'root again');
    await until(()=>p.evaluate('!document.querySelector("#more-workspaces").hidden'),'root More available');
    await activate('#more-workspaces');
    await until(()=>p.evaluate('Boolean(document.querySelector("#workspaces a[data-workspace-id=w1]"))'),'original outcome visible');
    await p.key('Tab');
    assert.equal(await p.evaluate('document.activeElement.dataset.workspaceId'),'w1');
    await p.key('Enter');
    await until(()=>p.evaluate('document.body?.dataset.ready==="true" && Boolean(document.querySelector("#topics a[data-topic-id=t1]"))'),'workspace topics');
    await control({method:'read_fault',name:'workspace',status:403,body:{error:{code:'FORBIDDEN',message:'Outcome access denied'}},count:1});
    await activate('#refresh');
    await until(()=>p.evaluate('document.querySelector("#topic-navigation").hidden'),'denied outcome hides its previous topic choices');
    assert.equal(await p.evaluate('document.querySelector("#topic-title").textContent'),'Outcome unavailable');
    assert.equal(await p.evaluate('document.querySelector("#app-status").hidden'),false);
    await activate('#refresh');
    await until(()=>p.evaluate('!document.querySelector("#topic-navigation").hidden && document.querySelector("#app-status").hidden'),'Refresh restores permitted outcome');
    await activate('#topics a[data-topic-id="t1"]');await ready(p,'t1');
    await p.evaluate('document.querySelector("#inline-writing-body").scrollIntoView({block:"center"})');await activate('#inline-writing-body');
    const body='Writing preserved when choosing Outcomes';await p.send('Input.insertText',{text:body});const entered=Date.now();
    await activate('#outcomes-home');
    assert.ok(Date.now()-entered<450,'outcome link activated before autosave debounce');
    await until(()=>p.evaluate('document.body?.dataset.ready==="true" && !location.search'),'guarded root departure');
    assert.equal((await state()).draft.body,body);
    await p.send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});
    await p.send('Emulation.setTouchEmulationEnabled',{enabled:true});
    await until(()=>p.evaluate('Boolean(document.querySelector("#workspaces a[data-workspace-id=outcome-00]"))'),'mobile outcomes');
    await p.evaluate('document.querySelector("#workspaces a[data-workspace-id=outcome-00]").scrollIntoView({block:"center"})');
    const b=await p.box('#workspaces a[data-workspace-id="outcome-00"]');
    const next=await p.box('#workspaces a[data-workspace-id="outcome-01"]');
    const gap={x:b.x+b.width/2,y:(b.y+b.height+next.y)/2};
    assert.ok(next.y>b.y+b.height,'there is a real gap outside either outcome');
    await p.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[gap]});
    await p.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
    await new Promise(resolve=>setTimeout(resolve,100));
    assert.equal(await p.evaluate('location.search'),'','a neighboring gap does not choose an outcome');
    await p.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:b.x+b.width/2,y:b.y+b.height/2}]});
    await p.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
    await until(()=>p.evaluate('document.body?.dataset.ready==="true" && new URL(location.href).searchParams.get("workspace")==="outcome-00"'),'mobile outcome selection');
    await shot(p,'outcomes-mobile-empty');
    noActs(p);noPrompt(p);assert.deepEqual(p.errors,[]);
  });

  await check('navigation correction creation handover adopts the displayed title purpose team and current notices',async()=>{
    const route=facts.origin+'/?new=outcome&intent=correction-handover';
    const owner=await page('handover-owner',null,true,{url:route});
    const click=async(p,s)=>{await p.evaluate(`document.querySelector(${JSON.stringify(s)}).scrollIntoView({block:'center'})`);await p.point(s);};
    const type=async(p,s,text)=>{await click(p,s);await p.key('a',4);await p.send('Input.insertText',{text});};
    await type(owner,'#outcome-title-input','Old title');await type(owner,'#outcome-purpose-input','Old purpose');
    await until(()=>owner.evaluate('document.querySelector("#outcome-page").textContent.includes("Form saved on this browser")'),'original form saved');
    const contender=await page('handover-contender',null,true,{url:route});assert.equal(await contender.evaluate('document.querySelector("#outcome-title-input").value'),'Old title');
    await type(owner,'#outcome-title-input','New title');await type(owner,'#outcome-purpose-input','New purpose');
    await type(owner,'[aria-label="Add outcome team member"]','fixture-notebook-agent');await owner.key('Enter');
    await until(()=>owner.evaluate('document.querySelector("#outcome-page").textContent.includes("Form saved on this browser")'),'new form saved');await owner.close();
    await click(contender,'#refresh');await until(()=>contender.evaluate('!document.querySelector("#create-outcome").disabled'),'handover completed');
    assert.equal(await contender.evaluate('document.querySelector("#outcome-title-input").value'),'New title');
    assert.equal(await contender.evaluate('document.querySelector("#outcome-purpose-input").value'),'New purpose');
    assert.match(await contender.evaluate('document.querySelector("#outcome-page .chips").textContent'),/fixture-notebookbook-agent|fixture-notebook-agent/);
    contender.intercept(payload=>payload?.kind==='workspace.create');await click(contender,'#create-outcome');
    const held=await until(()=>contender.held.find(h=>h.payload?.kind==='workspace.create'),'handover creation response');
    assert.equal(held.payload.args.title,'New title');assert.equal(held.payload.args.purpose,'New purpose');assert.deepEqual(held.payload.args.team,[facts.actor,'fixture-notebook-agent']);
    contender.intercept(null);await contender.fail(held);
    await until(()=>contender.evaluate('!document.querySelector("#outcome-page .notice").hidden'),'lost response reason rendered');
    await control({method:'read_fault',name:'operation',status:503,body:{error:{code:'DATABASE_BUSY',message:'Current confirmation read failed',retryable:true}},count:1});
    await click(contender,'#check-outcome');await until(()=>contender.evaluate('document.querySelector("#outcome-page .notice").textContent.includes("Current confirmation read failed")'),'new read reason overrides old transport error');
    await click(contender,'#check-outcome');await until(()=>contender.evaluate('!document.querySelector("#start-first-topic").hidden'),'creation confirmation');
    assert.equal(await contender.evaluate('document.querySelector("#outcome-page .notice").hidden'),true);
    assert.equal(contender.calls.filter(c=>c.payload?.kind==='workspace.create').length,1);assert.deepEqual(contender.errors,[]);noPrompt(contender);
    await shot(contender,'creation-handover-confirmed');
  });

  await check('navigation placeholder absent during pending startup and error recovery', async () => {
    await control({ method: 'navigation_topics', topics });
    const p = await page('placeholder-transition', null, true);
    const header = () => p.evaluate(`({title:document.querySelector('#topic-title').textContent,
      description:document.querySelector('#topic-description').textContent,
      generic:document.body.textContent.includes('A place to work together') || document.body.textContent.includes('Choose a workspace and topic to begin.')})`);
    const emptyHeader = async phase => {
      const value=await header(); observations.push({name:'pending topic header',phase,...value});
      assert.equal(value.title,'',phase+' must not introduce a generic topic title');
      assert.equal(value.description,'',phase+' must not introduce generic guidance');
      assert.equal(value.generic,false);
    };
    const heldTransition = async (mobile=false) => {
      const start=p.held.length;
      p.intercept((_payload,event)=>event.request.url.endsWith('/api/bootstrap'));
      if (mobile) {
        await rendered(p, 't2');
        await p.evaluate(`document.querySelector(${JSON.stringify(link('t2'))}).scrollIntoView({block:'center',inline:'center'})`);
        const b=await p.box(link('t2'));assert.equal(b.viewportWidth,390);
        await p.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:b.x+b.width/2,y:b.y+b.height/2}]});
        await p.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
      } else await click(p,'t2');
      const held=await until(()=>p.held.slice(start).find(h=>h.event.request.url.endsWith('/api/bootstrap')),'actual new-document bootstrap held');
      await until(()=>p.evaluate('Boolean(document.querySelector("#topic-title"))'),'static header rendered');
      assert.equal(await p.evaluate('new URL(location.href).searchParams.get("topic")'),'t2');
      assert.notEqual(await p.evaluate('document.body.dataset.ready'),'true');
      await shot(p,mobile?'placeholder-mobile-pending':'placeholder-desktop-pending');
      await emptyHeader(mobile?'mobile pending':'desktop pending');
      p.intercept(null);await p.release(held);await ready(p,'t2');
      assert.equal((await header()).title,topics[0].title);
      // A plainly Active topic with no note has no subtitle, and the old hint is never written there.
      assert.deepEqual([(await header()).description,await p.evaluate('document.querySelector("#topic-description").hidden')],['',true]);
      await shot(p,mobile?'placeholder-mobile-ready':'placeholder-desktop-ready');
    };
    await heldTransition();
    p.recordResponses();
    await control({method:'read_fault',name:'topic',status:503,body:{error:{code:'DATABASE_BUSY',message:'Topic read delayed',retryable:true}},count:1});
    await click(p,'t1');
    // Api's non-2xx AttemptError preserves the human message, not the code.
    await until(()=>p.evaluate('!document.querySelector("#app-status").hidden && document.querySelector("#app-status").textContent==="Topic read delayed"'),'startup refusal remains visible');
    assert.ok(p.responses.some(r=>r.payload?.name==='topic' && r.status===503 && r.body.error?.code==='DATABASE_BUSY'),'typed refusal was actually received');
    observations.push({name:'startup refusal feedback',text:await p.evaluate('document.querySelector("#app-status").textContent')});
    await emptyHeader('startup refusal');
    await p.point('#refresh');await ready(p,'t1');
    assert.equal((await header()).title,'Read here');
    await p.send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});
    await p.send('Emulation.setTouchEmulationEnabled',{enabled:true});
    await heldTransition(true);
    // Outcomes is now the selected bare-root behavior; pending topic headers
    // stay empty, while a resolved root has its own real selection heading.
    await p.send('Page.navigate',{url:facts.origin+'/'});
    await until(()=>p.evaluate('document.body?.dataset.ready==="true" && document.querySelector("#topic-title").textContent==="Outcomes"'),'bare-root outcome selection');
    assert.equal((await header()).generic,false);
    noActs(p);noPrompt(p);assert.deepEqual(p.errors,[]);
  });

  await check('navigation native keyboard same-tab draft preservation failure and selected-image boundaries', async () => {
    await control({ method: 'navigation_topics', topics });
    const p = await page('topic-navigation', null, true);
    await until(() => p.evaluate('document.querySelectorAll("#topics a[href]").length===3'), 'Topics must contain discoverable real links');
    assert.equal(await p.evaluate(`document.querySelector(${JSON.stringify(link('t1'))}).getAttribute('aria-current')`), 'page');
    const original = await p.evaluate('performance.timeOrigin'); await click(p, 't1');
    assert.equal(await p.evaluate('performance.timeOrigin'), original, 'current topic is a no-op');
    // Tab/Return activation from ordinary document focus, never click().
    // Earlier cases leave more outcomes in the rail; Tab passes each of them.
    await p.evaluate('document.querySelector("#refresh").scrollIntoView({block:"center"})'); await p.point('#refresh');
    const tabLimit = await p.evaluate('document.querySelectorAll("a[href],button,input,textarea,select,[tabindex]").length + 2');
    for (let n = 0; n < tabLimit && await p.evaluate('document.activeElement?.dataset.topicId') !== 't2'; ++n) await p.key('Tab');
    assert.equal(await p.evaluate('document.activeElement?.dataset.topicId'), 't2');
    assert.notEqual(await p.evaluate('getComputedStyle(document.activeElement).outlineStyle'), 'none', 'keyboard focus is visible');
    await p.key('Enter'); await ready(p, 't2');
    assert.equal(await p.evaluate('document.querySelector("#topic-title").textContent'), topics[0].title);
    await click(p, 't1'); await ready(p, 't1');
    // The debounce timing below measures writing-to-activation, not the rail read.
    await rendered(p, 't2');
    // t1 may already hold a saved draft (the outcomes root case leaves one), and
    // the composer shows it; this writing replaces it, as the newer writing does below.
    await p.evaluate('document.querySelector("#inline-writing-body").scrollIntoView({block:"center"})'); await p.point('#inline-writing-body'); await p.key('a', 4);
    const text = 'A precise inline draft kept across a topic switch';
    await p.send('Input.insertText', { text }); const writtenAt = Date.now(); await click(p, 't2');
    assert.ok(Date.now()-writtenAt < 450, 'link is activated inside the actual450ms autosave debounce');
    await ready(p, 't2'); assert.equal((await state()).draft.body, text);
    await click(p, 't1'); await ready(p, 't1');
    assert.equal(await p.evaluate('document.querySelector("#inline-writing-body").value'), text, 'return loads canonical writing directly without recovery');
    noPrompt(p); noActs(p);

    // A connection failure after the server saves is still unknown to the UI.
    // Staying proves we do not mistake transport completion for acknowledgement.
    p.intercept(payload => payload?.kind === 'draft.save' && payload.args.source_ref?.kind === 'topic');
    await rendered(p, 't2');
    await p.evaluate('document.querySelector("#inline-writing-body").scrollIntoView({block:"center"})'); await p.point('#inline-writing-body'); await p.key('a', 4);
    await p.send('Input.insertText', { text: text+' — newer writing' }); await click(p, 't2');
    const held = await until(() => p.held.find(h => h.payload?.kind === 'draft.save'), 'held save acknowledgement');
    assert.equal(await p.evaluate('new URL(location.href).searchParams.get("topic")'), 't1');
    // Private saves reconcile a lost response by reading their exact operation.
    // Refuse that probe too, so this actually measures an unknown save rather
    // than an acknowledged save whose HTTP response was lost.
    await control({ method: 'read_fault', name: 'operation', status: 503, body: { error: { code: 'SERVER_BUSY', message: 'Confirmation remains unavailable', retryable: true } }, count: 1 });
    p.intercept(null); await p.fail(held);
    await until(() => p.evaluate('!document.querySelector("#topic-navigation-status").hidden && document.querySelector("#topic-navigation-status").textContent.includes("Stayed")'), 'unknown save explains staying');
    assert.equal(await p.evaluate('document.querySelector("#inline-writing-body").value'), text+' — newer writing'); noActs(p);
    await click(p, 't2'); await ready(p, 't2'); await click(p, 't1'); await ready(p, 't1');
    assert.equal(await p.evaluate('document.querySelector("#inline-writing-body").value'), text+' — newer writing');

    await p.evaluate('document.querySelector("#inline-add-image").scrollIntoView({block:"center"})');
    await p.send('Page.setInterceptFileChooserDialog', { enabled: true });
    p.intercept((_payload, event) => event.request.url.endsWith('/api/media/upload'));
    await p.point('#inline-add-image');
    const chooser = await until(() => p.events.find(e => e.method === 'Page.fileChooserOpened'), 'native image chooser');
    await p.send('DOM.setFileInputFiles', { backendNodeId: chooser.params.backendNodeId, files: [path.join(root, 'tests/fixtures/media/screen.png')] });
    const upload = await until(() => p.held.find(h => h.event.request.url.endsWith('/api/media/upload')), 'held image publication acknowledgement');
    await click(p, 't2');
    await until(() => p.evaluate('!document.querySelector("#topic-navigation-status").hidden && /image/i.test(document.querySelector("#topic-navigation-status").textContent)'), 'pending selected image visibly keeps the topic');
    assert.equal(await p.evaluate('new URL(location.href).searchParams.get("topic")'), 't1');
    p.intercept(null); await p.release(upload);
    await until(async () => (await state()).draft.attachments.length === 1, 'selected image joins the confirmed canonical draft');
    const saved = (await state()).draft; await click(p, 't2'); await ready(p, 't2'); await click(p, 't1'); await ready(p, 't1');
    assert.equal(await p.evaluate('document.querySelector("#inline-writing-body").value'), saved.body);
    assert.deepEqual((await state()).draft.attachments, saved.attachments);
    await until(() => p.evaluate('document.querySelector("#inline-attachments").textContent.includes("Ready")'), 'saved attachment visible after return');
    noPrompt(p); noActs(p); assert.deepEqual(p.errors, []);
    observations.push({ name: 'saved return', draft: saved }); await shot(p, 'navigation-saved-return');
  });

  await check('navigation paging workspace denial retry and narrow touch targets', async () => {
    await control({ method: 'navigation_topics', topics });
    const extra = Array.from({ length: 20 }, (_, n) => ({ id: 'p'+String(n).padStart(2,'0'), title: 'Fixture topic '+n }));
    await control({ method: 'navigation_topics', topics: extra });
    const p = await page('navigation-pages-mobile', null, true);
    await until(() => p.evaluate('document.querySelectorAll("#topics a").length===21'), 'first20 plus current topic outside the page');
    assert.equal(await p.evaluate('document.querySelectorAll("#topics a[aria-current=page]").length'), 1);
    // The rail lists topics by latest activity, so the next page's first
    // link is whichever of its topics was active last, read from the rail.
    const shown = () => p.evaluate('[...document.querySelectorAll("#topics a")].map(a=>a.dataset.topicId)');
    const firstPage = await shown();
    await p.evaluate('document.querySelector("#more-topics").scrollIntoView({block:"center"})'); await p.point('#more-topics');
    await until(() => p.evaluate('document.querySelectorAll("#topics a").length===23 && document.querySelector("#more-topics").hidden'), 'next page appends without duplicating current topic');
    assert.equal(await p.evaluate('new Set([...document.querySelectorAll("#topics a")].map(a=>a.dataset.topicId)).size'), 23);
    const added = (await shown()).filter(id => !firstPage.includes(id));
    assert.deepEqual([...added].sort(), ['t2', 't3'], 'the next page holds the two topics left');
    assert.equal(await p.evaluate('document.activeElement?.dataset.topicId'), added[0], 'last More hands focus to the next new link');
    await control({ method: 'read_fault', name: 'workspace_topics', read_class: 'foreground', status: 503, body: { error: { code: 'SERVER_BUSY', message: 'Topic list delayed', retryable: true } }, count: 1 });
    await p.evaluate('document.querySelector("#refresh").scrollIntoView({block:"center"})'); await p.point('#refresh');
    await until(() => p.evaluate('!document.querySelector("#retry-topics").hidden'), 'topic list failure exposes Retry');
    assert.equal(await p.evaluate('document.querySelectorAll("#topics a").length'), 23, 'transient error retains the previous links');
    await control({ method: 'read_fault', name: 'workspace_topics', read_class: 'foreground', status: 403, body: { error: { code: 'FORBIDDEN', message: 'Workspace unavailable', retryable: false } }, count: 1 });
    await p.evaluate('document.querySelector("#retry-topics").scrollIntoView({block:"center"})'); await p.point('#retry-topics');
    await until(() => p.evaluate('document.querySelector("#topics").hidden'), 'workspace denial hides its cached links');
    // A reload reads back to the last row the reader had loaded, so Retry
    // restores all 23 links and leaves nothing for More.
    await p.point('#retry-topics'); await until(() => p.evaluate('!document.querySelector("#topics").hidden && document.querySelectorAll("#topics a").length===23 && document.querySelector("#more-topics").hidden'), 'explicit Retry restores every confirmed workspace link the reader had');
    await p.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
    await p.send('Emulation.setTouchEmulationEnabled', { enabled: true });
    await p.evaluate(`document.querySelector(${JSON.stringify(link('t2'))}).scrollIntoView({block:'center',inline:'center'})`);
    const before = await p.evaluate('performance.timeOrigin'), b = await p.box(link('t2'));
    assert.equal(b.viewportWidth,390, 'horizontal rail does not widen the mobile layout viewport');
    assert.ok(b.height >= 44 && b.width > 44, 'named link is at least44px tall');
    const touch = async (x,y) => { await p.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{x,y}] }); await p.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); };
    // Its neighbour is the link after it, whichever topic the activity order puts there.
    const after = await p.evaluate(`(links=>links[links.findIndex(a=>a.dataset.topicId==='t2')+1]?.dataset.topicId??null)([...document.querySelectorAll('#topics a')])`);
    assert.ok(after, 'a link follows t2 in the rail');
    const neighbor = await p.box(link(after)); const gap = b.x+b.width+Math.max(1,(neighbor.x-b.x-b.width)/2);
    assert.ok(gap < neighbor.x && gap < b.viewportWidth, 'measured actual gap between topic links');
    await p.evaluate(`(()=>{for(const type of ['touchstart','touchend','click'])document.addEventListener(type,e=>console.log('navigation-touch',JSON.stringify({type,target:e.target.closest('a')?.dataset.topicId??e.target.id,x:e.changedTouches?.[0]?.clientX??e.clientX,y:e.changedTouches?.[0]?.clientY??e.clientY,rawTarget:document.elementFromPoint(e.changedTouches?.[0]?.clientX??e.clientX,e.changedTouches?.[0]?.clientY??e.clientY)?.id})),true)})()`);
    await touch(gap,b.y+b.height/2);
    observations.push({ name: 'actual gap touch', b, neighbor, gap, events: p.events.filter(e=>e.method==='Runtime.consoleAPICalled') });
    assert.equal(await p.evaluate('performance.timeOrigin'),before,'gap touch must do nothing');
    await touch(b.x+b.width/2,b.y+b.height/2); await ready(p,'t2');
    assert.equal(await p.evaluate('document.querySelector("#topic-title").textContent'),topics[0].title);
    noPrompt(p); noActs(p); assert.deepEqual(p.errors,[]); await shot(p,'navigation-narrow');
  });
  await check('navigation creation intent database coexists with actual shipped editor image and local writing',async()=>{
    await control({method:'navigation_topics',topics:[{id:'coexist-topic',title:'Isolated old-tab writing'}]});
    const revision='c3e99a85ae42c961a0dfa727b82b17131aa52d89',sources=new Map(),hashes={};
    const files=execFileSync('git',['ls-tree','-r','--name-only',revision,'web'],{cwd:root,encoding:'utf8'}).trim().split('\n');
    for(const file of files){
      const source=execFileSync('git',['show',revision+':'+file],{cwd:root});sources.set('/'+file.slice(4),source);
      hashes[file]=createHash('sha256').update(source).digest('hex');const out=path.join(evidencePath,'shipped-source',file);await mkdir(path.dirname(out),{recursive:true});await writeFile(out,source);
    }
    const served=[];
    const old=await page('actual-shipped',null,true,{url:facts.origin+'/?topic=coexist-topic',beforeNavigate:async p=>{
      await p.send('Network.setCacheDisabled',{cacheDisabled:true});
      await p.send('Page.addScriptToEvaluateOnNewDocument',{source:`window.pendingVersionChanges=0;(()=>{const open=indexedDB.open.bind(indexedDB);indexedDB.open=(...args)=>{const r=open(...args);r.addEventListener('success',()=>{if(args[0]==='aim-next-pending')r.result.addEventListener('versionchange',()=>pendingVersionChanges++);});return r;};})()`});
      await p.send('Fetch.enable',{patterns:[{urlPattern:facts.origin+'/api/command',requestStage:'Request'},{urlPattern:facts.origin+'/*.mjs',requestStage:'Response'},{urlPattern:facts.origin+'/aim.css',requestStage:'Response'},{urlPattern:facts.origin+'/?*',requestStage:'Response'}]});
      p.intercept(async(payload,event)=>{
        if(payload?.kind==='draft.save'){
          await p.send('Fetch.fulfillRequest',{requestId:event.requestId,responseCode:503,responseHeaders:[{name:'Content-Type',value:'application/json'}],body:Buffer.from(JSON.stringify({error:{code:'UNAVAILABLE',message:'Fixture keeps old-tab writing local'}})).toString('base64')});return true;
        }
        const pathname=new URL(event.request.url).pathname,key=pathname==='/'?'/index.html':pathname,source=sources.get(key);
        if(!source)return false;
        const content=key==='/index.html'?Buffer.from(source.toString().replace('__AIM_SESSION_TOKEN__',facts.token)):source;
        await p.send('Fetch.fulfillRequest',{requestId:event.requestId,responseCode:200,responseHeaders:[{name:'Content-Type',value:key.endsWith('.mjs')?'text/javascript':key.endsWith('.css')?'text/css':'text/html'}],body:content.toString('base64')});served.push(key);return true;
      });
    }});
    assert.ok(served.includes('/app.mjs')&&served.includes('/journal.mjs')&&served.includes('/inline-composer.mjs'));
    await old.evaluate('document.querySelector("#inline-writing-body").scrollIntoView({block:"center"})');await old.point('#inline-writing-body');await old.send('Input.insertText',{text:'Old tab private writing survives'});
    await old.send('Page.setInterceptFileChooserDialog',{enabled:true});await old.point('#inline-add-image');
    const chooser=await until(()=>old.events.find(e=>e.method==='Page.fileChooserOpened'),'old picker');
    await old.send('DOM.setFileInputFiles',{backendNodeId:chooser.params.backendNodeId,files:[path.join(root,'tests/fixtures/media/screen.png')]});
    await until(()=>old.evaluate('document.querySelector("#inline-attachments").textContent.includes("Ready")'),'old ready image');
    const rows=()=>old.evaluate(`new Promise((resolve,reject)=>{const r=indexedDB.open('aim-next-pending',2);r.onerror=()=>reject(r.error);r.onsuccess=()=>{const db=r.result,tx=db.transaction('editors');tx.objectStore('editors').getAll().onsuccess=e=>resolve(e.target.result.map(row=>({id:row.id,body:row.snapshot?.draft?.body,bytes:row.blob?.size,stamp:row.stamp})));tx.oncomplete=()=>db.close();};})`);
    const before=await until(async()=>{const r=await rows();return r.some(x=>x.body==='Old tab private writing survives')&&r.some(x=>x.bytes>0)?r:null;},'old editor and image recovery rows');
    const current=await page('new-intents-coexist',null,true,{url:facts.origin+'/?new=outcome&intent=coexist-intent'});
    await until(()=>current.evaluate('Boolean(document.querySelector("#outcome-title-input"))'),'new intent database open');
    assert.equal(await old.evaluate('pendingVersionChanges'),0,'new intents never upgrade old pending DB');
    const after=await rows();for(const row of before)assert.ok(after.some(r=>r.id===row.id&&r.body===row.body&&r.bytes===row.bytes),'old rows survive');
    assert.equal(await old.evaluate('document.querySelector("#inline-writing-body").value'),'Old tab private writing survives');
    await old.point('#inline-writing-body');await old.key('a',4);
    assert.equal(await old.evaluate('document.querySelector("#inline-writing-body").selectionEnd-document.querySelector("#inline-writing-body").selectionStart'),'Old tab private writing survives'.length,'native select-all on the old inline composer');
    await old.send('Input.insertText',{text:'Old tab private writing survives and stays editable'});
    await until(async()=>{const r=await rows();return r.some(x=>x.body==='Old tab private writing survives and stays editable');},'actual old editor remains functional');
    assert.equal(old.calls.some(c=>['message.send','opening.publish','submission.prepare'].includes(c.payload?.kind)),false);
    assert.deepEqual(old.errors,[]);assert.deepEqual(current.errors,[]);
    observations.push({name:'actual shipped-code coexistence',revision,hashes,served,editorAndImageRows:before.map(r=>({id:r.id,bytes:r.bytes})),pendingVersionChanges:0});
  });

  await check('navigation outcome creation saves a form resumes and creates once by keyboard',async()=>{
    const p=await page('create-outcome',null,true,{url:facts.origin+'/'});
    const click=async selector=>{await p.evaluate(`document.querySelector(${JSON.stringify(selector)}).scrollIntoView({block:'center'})`);await p.point(selector);};
    await until(()=>p.evaluate('document.body?.dataset.ready==="true" && document.querySelector("#topic-title").textContent==="Outcomes"'),'root ready');
    assert.equal(await p.evaluate('document.querySelector("#new-outcome").disabled'),false,'New outcome must be discoverable and enabled');
    await click('#new-outcome');await until(()=>p.evaluate('Boolean(document.querySelector("#outcome-title-input"))'),'outcome form');
    assert.equal(await p.evaluate('document.activeElement.id'),'outcome-title-input');
    await p.send('Input.insertText',{text:'Keyboard outcome'});await p.key('Tab');await p.send('Input.insertText',{text:'A retained purpose'});
    await click('[aria-label="Add outcome team member"]');await p.send('Input.insertText',{text:'fixture-notebook-agent'});await p.key('Enter');
    assert.equal(p.calls.some(c=>c.payload?.kind==='workspace.create'),false,'Enter adds team metadata without creating');
    await until(()=>p.evaluate('document.querySelector("#outcome-page").textContent.includes("Form saved on this browser")'),'form durable');
    const route=await p.evaluate('location.href');await click('#creation-later');
    await until(()=>p.evaluate('document.querySelector("#topic-title").textContent==="Outcomes" && Boolean(document.querySelector("#unfinished-work a"))'),'local Resume entry');
    await click('#unfinished-work a');await until(()=>p.evaluate('Boolean(document.querySelector("#outcome-title-input"))'),'resumed form');
    assert.equal(await p.evaluate('location.href'),route);assert.equal(await p.evaluate('document.querySelector("#outcome-title-input").value'),'Keyboard outcome');
    assert.equal(await p.evaluate('document.querySelector("#outcome-purpose-input").value'),'A retained purpose');
    assert.equal(await p.evaluate('[...document.querySelectorAll("#outcome-page .notice")].filter(n=>!n.hidden&&!n.textContent).length'),0,'no empty warning banner');
    assert.ok((await p.box('#outcome-title-input')).height>=44,'creation title has a touch-sized input');
    await shot(p,'create-outcome-form');
    for(let n=0;n<15&&await p.evaluate('document.activeElement.id')!=='create-outcome';n++)await p.key('Tab');
    assert.equal(await p.evaluate('document.activeElement.id'),'create-outcome');await p.key('Enter');
    await until(()=>p.evaluate('Boolean(document.querySelector("#start-first-topic")&&!document.querySelector("#start-first-topic").hidden)'),'confirmed outcome');
    const calls=p.calls.filter(c=>c.payload?.kind==='workspace.create');assert.equal(calls.length,1);
    const command=calls[0].payload;assert.deepEqual(command.args.team,[facts.actor,'fixture-notebook-agent']);assert.equal(Object.hasOwn(command.args,'coordinator'),false);
    const receipt=await view('operation',{operation_id:command.operation_id});assert.equal(receipt.status,'committed');
    const workspace=await view('workspace',{workspace_id:command.args.id});assert.equal(workspace.workspace.title,'Keyboard outcome');assert.equal(workspace.workspace.owner_id,facts.actor);
    assert.equal(p.calls.some(c=>['submission.prepare','opening.publish','message.send'].includes(c.payload?.kind)),false);
    await click('#creation-later');await until(()=>p.evaluate('document.querySelector("#topic-title")?.textContent==="Keyboard outcome"'),'real empty outcome after Later');
    assert.equal((await view('workspace_topics',{workspace_id:command.args.id,limit:20})).items.length,0);
    await shot(p,'created-empty-outcome');assert.deepEqual(p.errors,[]);noPrompt(p);
  });

  await check('navigation uncertain creation checks without writing then retries the exact act with mobile boundaries',async()=>{
    let drop=true;
    const p=await page('uncertain-outcome',null,true,{url:facts.origin+'/?new=outcome&intent=uncertain-native',beforeNavigate:async p=>{
      await p.send('Fetch.enable',{patterns:[{urlPattern:facts.origin+'/api/command',requestStage:'Request'},{urlPattern:facts.origin+'/api/view',requestStage:'Response'}]});
      p.intercept(async(payload,event)=>{
        if(drop&&payload?.kind==='workspace.create'){
          drop=false;await p.send('Fetch.fulfillRequest',{requestId:event.requestId,responseCode:503,responseHeaders:[{name:'Content-Type',value:'application/json'}],body:Buffer.from(JSON.stringify({error:{code:'UNAVAILABLE',message:'Injected loss before commit'}})).toString('base64')});return true;
        }return false;
      });
    }});
    const click=async selector=>{await p.evaluate(`document.querySelector(${JSON.stringify(selector)}).scrollIntoView({block:'center'})`);await p.point(selector);};
    await until(()=>p.evaluate('document.body?.dataset.ready==="true" && Boolean(document.querySelector("#outcome-title-input"))'),'uncertain form ready');
    await p.send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});
    await p.send('Emulation.setTouchEmulationEnabled',{enabled:true});
    await click('#outcome-title-input');await p.send('Input.insertText',{text:'Mobile uncertain outcome'});
    await p.evaluate('document.querySelector("#create-outcome").scrollIntoView({block:"center"})');
    const b=await p.box('#create-outcome');assert.ok(b.height>=44);
    const tap=async(x,y)=>{await p.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x,y}]});await p.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});};
    const before=p.calls.filter(c=>c.payload?.kind==='workspace.create').length;
    await tap(b.x+b.width+3,b.y+b.height/2);await p.evaluate('new Promise(r=>setTimeout(r,100))');
    assert.equal(p.calls.filter(c=>c.payload?.kind==='workspace.create').length,before,'nearby gap tap does not create');
    await tap(b.x+b.width/2,b.y+b.height/2);
    await until(()=>p.evaluate('document.querySelector("#outcome-page").textContent.includes("Creation not confirmed")'),'uncertain visible');
    const attempts=p.calls.filter(c=>c.payload?.kind==='workspace.create');assert.equal(attempts.length,1);const original=attempts[0].payload;
    assert.equal((await view('operation',{operation_id:original.operation_id})).status,'unknown','instrument prevented the original server effect');
    await click('#check-outcome');await until(()=>p.evaluate('!document.querySelector("#retry-outcome").hidden'),'explicit Retry available after scoped unknown read');
    assert.equal(p.calls.filter(c=>c.payload?.kind==='workspace.create').length,1,'Check does not write');
    await shot(p,'uncertain-outcome-mobile');
    await click('#retry-outcome');await until(()=>p.evaluate('!document.querySelector("#start-first-topic").hidden'),'retry confirmed');
    const sent=p.calls.filter(c=>c.payload?.kind==='workspace.create');assert.equal(sent.length,2);assert.deepEqual(sent[1].payload,original,'Retry preserves the complete request');
    assert.equal((await view('operation',{operation_id:original.operation_id})).status,'committed');
    assert.equal(await p.evaluate('document.documentElement.scrollWidth<=innerWidth'),true,'390px form has no horizontal overflow');
    assert.deepEqual(p.errors,[]);noPrompt(p);
  });


  await check('navigation creation actual pending departure unknown return and read-only Refresh',async()=>{
    const p=await page('creation-departure',null,true,{url:facts.origin+'/?new=outcome&intent=departure-intent'});
    const click=async(q,selector)=>{await q.evaluate(`document.querySelector(${JSON.stringify(selector)}).scrollIntoView({block:'center'})`);await q.point(selector);};
    await click(p,'#outcome-title-input');await p.send('Input.insertText',{text:'Guarded outcome'});
    await until(()=>p.evaluate('document.querySelector("#outcome-page").textContent.includes("Form saved on this browser")'),'guarded form saved');
    const route=await p.evaluate('location.href');
    const other=await page('creation-competing',null,true,{url:route,beforeNavigate:observeStorage});
    assert.match(await other.evaluate('document.querySelector("#outcome-page").textContent'),/read-only/);
    await observedAction(other,'#refresh','creation');
    await until(()=>other.evaluate('document.querySelector("#outcome-page").textContent.includes("read-only")'),'read-only Refresh settled');
    assert.equal(other.calls.some(c=>c.payload?.kind),false,'read-only Refresh cannot dispatch a write');
    assert.deepEqual(storageActs(other),[],'actual intent/recovery stores and journal entry points stay unwritten after Refresh');
    await click(other,'#creation-later');await until(()=>other.evaluate('document.body?.dataset.ready==="true" && location.search===""'),'competing tab can leave');
    assert.deepEqual(storageActs(other),[],'read-only departure attempts no journal write or delete');noPrompt(other);await other.close();
    p.intercept(payload=>payload?.kind==='workspace.create');await click(p,'#create-outcome');
    const held=await until(()=>p.held.find(h=>h.payload?.kind==='workspace.create'),'creation response held after effect');
    await click(p,'#outcomes-home');
    await until(()=>p.evaluate('document.querySelector("#topic-navigation-status").textContent.includes("Wait for creation")'),'pending departure protected by app beforeLeave');
    assert.equal(await p.evaluate('location.href'),route);
    p.intercept(null);await p.fail(held);
    await until(()=>p.evaluate('document.querySelector("#outcome-page").textContent.includes("Creation not confirmed")'),'uncertain creation visible');
    assert.equal((await view('operation',{operation_id:held.payload.operation_id})).status,'committed','response loss leaves a real committed effect unknown to the page');
    await click(p,'#outcomes-home');
    await until(()=>p.evaluate('document.querySelector("#topic-navigation-status").textContent.includes("again")'),'named informed departure');
    assert.equal(await p.evaluate('location.href'),route);
    await click(p,'#outcomes-home');await until(()=>p.evaluate('document.body?.dataset.ready==="true" && location.search===""'),'second explicit choice leaves');
    // The unfinished list reads this browser's journal after the page is ready.
    await until(()=>p.evaluate('Boolean(document.querySelector("#unfinished-work a"))'),'retained creation listed');
    await click(p,'#unfinished-work a');await until(()=>p.evaluate('Boolean(document.querySelector("#check-outcome"))'),'retained creation resumed');
    assert.equal(await p.evaluate('location.href'),route);assert.equal(await p.evaluate('document.querySelector("#outcome-title-input").value'),'Guarded outcome');
    assert.equal(p.calls.filter(c=>c.payload?.kind==='workspace.create').length,1,'Resume cannot replay uncertain creation');
    await click(p,'#check-outcome');await until(()=>p.evaluate('!document.querySelector("#start-first-topic").hidden'),'Check reads the original committed result');
    assert.equal(p.calls.filter(c=>c.payload?.kind==='workspace.create').length,1);noPrompt(p);assert.deepEqual(p.errors,[]);
    await shot(p,'creation-guarded-return');
  });

}

import assert from 'node:assert/strict';
import path from 'node:path';

export async function navigationChecks({ check, page, until, root, facts, view, control, shot, observations }) {
  const link = id => `#topics a[data-topic-id="${id}"]`;
  const topics = [{ id: 't2', title: 'Design discussion' }, { id: 't3', title: 'Greenlight discussion' }];
  const ready = (p, id) => until(async () => { try { return await p.evaluate(`document.body.dataset.ready==='true' && new URL(location.href).searchParams.get('topic')===${JSON.stringify(id)} && Boolean(document.querySelector(${JSON.stringify(link(id))}))`); } catch { return false; } }, 'topic '+id+' ready');
  const click = async (p, id) => { await p.evaluate(`document.querySelector(${JSON.stringify(link(id))}).scrollIntoView({block:'center',inline:'nearest'})`); await p.point(link(id)); };
  const noActs = p => assert.equal(p.calls.some(c => ['message.send','submission.prepare','delivery.ack','topic.create_and_send'].includes(c.payload?.kind)), false, 'navigation never sends, acknowledges or creates work');
  const noPrompt = p => assert.equal(p.events.some(e => e.method === 'Page.javascriptDialogOpening'), false, 'normal navigation never relies on beforeunload confirmation');
  const state = () => view('editor_state', { source_ref: { kind: 'topic', id: 't1' }, topic_id: 't1' });

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
      assert.equal((await header()).description,'Open a message to read, quote, reply, or keep a private note.');
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
    // A person can still open a bare URL and find the existing explicit guidance.
    await p.send('Page.navigate',{url:facts.origin+'/'});
    await until(()=>p.evaluate('!document.querySelector("#app-status").hidden && document.querySelector("#app-status").textContent.includes("Open a Theseus topic link to choose the conversation.")'),'bare-root guidance retained');
    await emptyHeader('bare root');
    noActs(p);noPrompt(p);assert.deepEqual(p.errors,[]);
  });

  await check('navigation native keyboard same-tab draft preservation failure and selected-image boundaries', async () => {
    await control({ method: 'navigation_topics', topics });
    const p = await page('topic-navigation', null, true);
    assert.equal(await p.evaluate('document.querySelectorAll("#topics a[href]").length'), 3, 'Topics must contain discoverable real links');
    assert.equal(await p.evaluate(`document.querySelector(${JSON.stringify(link('t1'))}).getAttribute('aria-current')`), 'page');
    const original = await p.evaluate('performance.timeOrigin'); await click(p, 't1');
    assert.equal(await p.evaluate('performance.timeOrigin'), original, 'current topic is a no-op');
    // Tab/Return activation from ordinary document focus, never click().
    await p.point('#refresh');
    for (let n = 0; n < 12 && await p.evaluate('document.activeElement?.dataset.topicId') !== 't2'; ++n) await p.key('Tab');
    assert.equal(await p.evaluate('document.activeElement?.dataset.topicId'), 't2');
    assert.notEqual(await p.evaluate('getComputedStyle(document.activeElement).outlineStyle'), 'none', 'keyboard focus is visible');
    await p.key('Enter'); await ready(p, 't2');
    assert.equal(await p.evaluate('document.querySelector("#topic-title").textContent'), topics[0].title);
    await click(p, 't1'); await ready(p, 't1');
    await p.evaluate('document.querySelector("#inline-writing-body").scrollIntoView({block:"center"})'); await p.point('#inline-writing-body');
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
    await p.evaluate('document.querySelector("#more-topics").scrollIntoView({block:"center"})'); await p.point('#more-topics');
    await until(() => p.evaluate('document.querySelectorAll("#topics a").length===23 && document.querySelector("#more-topics").hidden'), 'next page appends without duplicating current topic');
    assert.equal(await p.evaluate('new Set([...document.querySelectorAll("#topics a")].map(a=>a.dataset.topicId)).size'), 23);
    assert.equal(await p.evaluate('document.activeElement?.dataset.topicId'), 't2', 'last More hands focus to the next new link');
    await control({ method: 'read_fault', name: 'workspace_topics', read_class: 'foreground', status: 503, body: { error: { code: 'SERVER_BUSY', message: 'Topic list delayed', retryable: true } }, count: 1 });
    await p.evaluate('document.querySelector("#refresh").scrollIntoView({block:"center"})'); await p.point('#refresh');
    await until(() => p.evaluate('!document.querySelector("#retry-topics").hidden'), 'topic list failure exposes Retry');
    assert.equal(await p.evaluate('document.querySelectorAll("#topics a").length'), 23, 'transient error retains the previous links');
    await control({ method: 'read_fault', name: 'workspace_topics', read_class: 'foreground', status: 403, body: { error: { code: 'FORBIDDEN', message: 'Workspace unavailable', retryable: false } }, count: 1 });
    await p.evaluate('document.querySelector("#retry-topics").scrollIntoView({block:"center"})'); await p.point('#retry-topics');
    await until(() => p.evaluate('document.querySelector("#topics").hidden'), 'workspace denial hides its cached links');
    await p.point('#retry-topics'); await until(() => p.evaluate('!document.querySelector("#topics").hidden && document.querySelectorAll("#topics a").length===21'), 'explicit Retry restores confirmed workspace links');
    await p.evaluate('document.querySelector("#more-topics").scrollIntoView({block:"center"})'); await p.point('#more-topics');
    await until(() => p.evaluate('document.querySelectorAll("#topics a").length===23'), 'remaining page returns');
    await p.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
    await p.send('Emulation.setTouchEmulationEnabled', { enabled: true });
    await p.evaluate(`document.querySelector(${JSON.stringify(link('t2'))}).scrollIntoView({block:'center',inline:'center'})`);
    const before = await p.evaluate('performance.timeOrigin'), b = await p.box(link('t2'));
    assert.equal(b.viewportWidth,390, 'horizontal rail does not widen the mobile layout viewport');
    assert.ok(b.height >= 44 && b.width > 44, 'named link is at least44px tall');
    const touch = async (x,y) => { await p.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{x,y}] }); await p.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); };
    const neighbor = await p.box(link('t3')); const gap = b.x+b.width+Math.max(1,(neighbor.x-b.x-b.width)/2);
    assert.ok(gap < neighbor.x && gap < b.viewportWidth, 'measured actual gap between topic links');
    await p.evaluate(`(()=>{for(const type of ['touchstart','touchend','click'])document.addEventListener(type,e=>console.log('navigation-touch',JSON.stringify({type,target:e.target.closest('a')?.dataset.topicId??e.target.id,x:e.changedTouches?.[0]?.clientX??e.clientX,y:e.changedTouches?.[0]?.clientY??e.clientY,rawTarget:document.elementFromPoint(e.changedTouches?.[0]?.clientX??e.clientX,e.changedTouches?.[0]?.clientY??e.clientY)?.id})),true)})()`);
    await touch(gap,b.y+b.height/2);
    observations.push({ name: 'actual gap touch', b, neighbor, gap, events: p.events.filter(e=>e.method==='Runtime.consoleAPICalled') });
    assert.equal(await p.evaluate('performance.timeOrigin'),before,'gap touch must do nothing');
    await touch(b.x+b.width/2,b.y+b.height/2); await ready(p,'t2');
    assert.equal(await p.evaluate('document.querySelector("#topic-title").textContent'),topics[0].title);
    noPrompt(p); noActs(p); assert.deepEqual(p.errors,[]); await shot(p,'navigation-narrow');
  });
}

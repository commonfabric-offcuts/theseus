import assert from 'node:assert/strict';
import { assertRows757, assertSheet757, rows757, route757, snapshot757 } from './reading_item_757_oracle.mjs';

export async function readingItem757Checks({ check, until, control, view, facts, shot, observations, engine }, h) {
  const { open, centre, press, openReader, closeReader, card } = h;
  const sizes = { laptop: [1280,800], 'phone-320': [320,844], 'phone-375': [375,844], phone: [390,844] };
  let serial = 0;
  const call = async (action, f) => control({ method: 'item_757', action,
    ...(typeof f === 'string' ? { key: f } : { fixture: f }), serial: ++serial });
  const sheet = f => `#messages .reply-stack[data-stack="${f.root}"] > .dossier-cover`;
  // Current folders, including singletons, draw one actual cover sheet.
  const singleton = f => `#messages .reply-stack[data-stack="${f.lone}"] > .dossier-cover`;
  // Observe successful real source responses without changing requests/results.
  // Both engines expose the same evidence; no private app object is fabricated.
  const sourceReads = `window.holdReads=true;window.item757Sources=[];{const fetch757=window.fetch;window.fetch=function(input,init){
    let b;try{b=JSON.parse(init?.body)}catch{}const result=fetch757.call(this,input,init);
    if(b?.name==='source')result.then(r=>r.clone().json()).then(answer=>{if(answer.source_ref){window.item757Sources.push({requested:b.args,source:answer.source_ref,body:answer.body});
      if(window.item757Sources.length>8)window.item757Sources.shift()}},()=>{});return result}}`;
  const openAt = (key, device, theme, f) => open(key, device, f.topic, f.root, sourceReads, undefined, async p => {
    const [width,height] = sizes[device];
    await p.send('Emulation.setDeviceMetricsOverride', { width,height,deviceScaleFactor:1,mobile:device!=='laptop' });
    await p.send('Emulation.setEmulatedMedia', { features:[{name:'prefers-color-scheme',value:theme}] });
  });
  const readyRows = (p, selector, cover) => until(async () => {
    const at = await p.evaluate(snapshot757(selector));
    return at && JSON.stringify(at.rows) === JSON.stringify(rows757(cover));
  }, 'current loaded cover has the actual item identities and states');
  const inspectSheet = async (p, selector, cover) => {
    await readyRows(p, selector, cover);
    const at = await p.evaluate(snapshot757(selector));
    assert.equal(at.drawn,true,'the asserted sheet is actually drawn');
    assertSheet757(at, cover);
    return at;
  };
  const picture = async (p, key, surface, extra={}) => {
    if (surface.startsWith('reader')) await p.evaluate(`(async()=>{for(const a of document.querySelector('#reader').getAnimations())await a.finished})()`);
    const actual = await p.evaluate(`({width:innerWidth,height:innerHeight,theme:matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light',
      documentOrigin:performance.timeOrigin,readerOpen:document.querySelector('#reader').open,
      sourceId:window.item757Sources.at(-1)?.source?.id??null,sourceText:document.querySelector('#source-body').textContent})`);
    await shot(p, key + '-' + surface);
    observations.push({name:'reading item 757 capture',key,surface,engine,actual,...extra});
  };
  const opening = async (p, input, f, key) => {
    if (input === 'phone') {
      // The preserved manual wait names this actual dossier root. Its real
      // link enters the Reader without depending on a separate folded-card
      // touch owner; source identity and unchanged document are still checked.
      const link = sheet(f) + ' .cover-wait > a';
      await centre(p, link); await press(p, input, link);
      await until(() => p.evaluate(`document.querySelector('#reader')?.open && document.querySelector('#source-body')?.textContent.startsWith('Which weekend suits the cabin trip?')`),
        'native preserved wait link opens the actual source Reader');
      return;
    }
    const toggle = `#messages .reply-stack[data-stack="${f.root}"] > .stack-toggle`;
    const state = () => p.evaluate(`(()=>{const c=document.querySelector(${JSON.stringify(card(f.root))}),
      t=document.querySelector(${JSON.stringify(toggle)}),w=c?.querySelector(':scope > .message-preview');
      return {toggle:t?.dataset.state,previewDrawn:!!w?.getClientRects().length,card:c?.outerHTML,
        active:document.activeElement?.outerHTML,readerOpen:document.querySelector('#reader')?.open}})()`);
    observations.push({name:'reading item 757 opening preconditions',key,phase:'before',actual:await state()});
    if ((await state()).toggle !== 'open') {
      await centre(p,toggle); await press(p,input,toggle);
      await until(()=>p.evaluate(`document.querySelector(${JSON.stringify(toggle)})?.dataset.state==='open'`),'existing dossier control opens the head before Reader input');
    }
    if (!(await state()).previewDrawn) {
      const folded = card(f.root) + ' > .message-folded > .folded-words';
      await centre(p, folded); await press(p, input, folded);
      await until(async () => (await state()).previewDrawn, 'native folded-message row reveals its own source words');
    }
    observations.push({name:'reading item 757 opening preconditions',key,phase:'after native control',actual:await state()});
    await openReader(p,input,f.root,'Which weekend suits the cabin trip?');
  };
  const failure = async (p,key,error) => {
    const record={name:'reading item 757 failure before close',key,primary:{message:String(error),stack:error.stack},secondary:[]};
    observations.push(record);
    try { record.state=await p.evaluate(`({url:location.href,ready:document.body?.dataset.ready,
      active:document.activeElement?.outerHTML,readerOpen:document.querySelector('#reader')?.open,
      sourceReads:window.item757Sources,dom:document.documentElement?.outerHTML})`); }
    catch(e) {record.secondary.push({phase:'DOM/state',error:String(e)});}
    try {await shot(p,key+'-failure-before-close');record.screenshot=key+'-failure-before-close';}
    catch(e) {record.secondary.push({phase:'screenshot',error:String(e)});}
  };
  const close = async (p,key,primary) => {
    try {await p.close();} catch(error) {
      observations.push({name:'reading item 757 close failure',key,error:String(error),primary:primary?String(primary):null});
      if(!primary)throw error;
    }
  };
  const confirmReader = async (p, f) => {
    await until(()=>p.evaluate(`window.item757Sources.at(-1)?.source?.id===${JSON.stringify(f.root)}`),'Reader read the actual selected source identity from Core');
    const actual=await p.evaluate(`({read:window.item757Sources.at(-1),text:document.querySelector('#source-body').textContent})`);
    assert.deepEqual(actual.read.requested,{kind:'message',id:f.root},'Reader requested the actual existing source');
    assert.deepEqual(actual.read.source,{kind:'message',id:f.root},'Core answered for that exact source identity');
    assert.ok(actual.text.startsWith(actual.read.body),'Reader DOM draws that source response body');
  };
  const noWrong = async (p, f) => {
    const at = await p.evaluate(`(()=>{const c=document.querySelector(${JSON.stringify(card(f.unrelated))});return {
      rows:c?.querySelectorAll('.cover-item').length??null,sheet:c?.closest('.reply-stack')?.querySelector(':scope > .dossier-cover')?.textContent??null}})()`);
    assert.deepEqual(at,{rows:0,sheet:null},'unrelated actual dossier acquires no other item cover');
  };
  for (const device of Object.keys(sizes)) for (const theme of ['light','dark']) {
    await check(`reading item 757 named rows manual fields dossier singleton Reader and exact item route ${device} ${theme}`, async () => {
      const key=`item757-look-${device}-${theme}`;
      const seeded=await call('seed',key),f=seeded.fixture,cover=seeded.readback.covers.root.cover;
      observations.push({name:'reading item 757 actual seed',key,...seeded});
      const input=device==='laptop'?'laptop':'phone';
      const p=await openAt(key,device,theme,f);
      let primary;
      try {
        const before=await inspectSheet(p,sheet(f),cover);
        await noWrong(p,f);
        const toggle=`#messages .reply-stack[data-stack="${f.root}"] > .stack-toggle`;
        const was=await p.evaluate(`document.querySelector(${JSON.stringify(toggle)}).dataset.state`);
        await centre(p,sheet(f)); await picture(p,key,'dossier-'+was,{snapshot:before});
        await centre(p,toggle); await press(p,input,toggle);
        await until(()=>p.evaluate(`document.querySelector(${JSON.stringify(toggle)}).dataset.state!==${JSON.stringify(was)}`),'native dossier toggle changes state');
        await inspectSheet(p,sheet(f),cover);
        const next=await p.evaluate(`document.querySelector(${JSON.stringify(toggle)}).dataset.state`);
        await centre(p,sheet(f)); await picture(p,key,'dossier-'+next);
        await readyRows(p,singleton(f),seeded.readback.covers.lone.cover);
        const lone=await p.evaluate(snapshot757(singleton(f),false));
        assert.equal(lone.drawn,true,'singleton rows are actually drawn');
        assertRows757(lone.rows,seeded.readback.covers.lone.cover);
        await centre(p,singleton(f)); await picture(p,key,'singleton');
        await opening(p,input,f,key);
        await until(()=>p.evaluate(`!document.querySelector('#reader-cover').hidden`),'Reader has the source dossier cover');
        assert.equal(await p.evaluate(`document.querySelector('#reader-cover').open`),false,'Reader starts with its cover collapsed');
        assert.equal(await p.evaluate(`document.querySelector('#reader-cover .reader-cover-words').textContent`),'Cabin is booked');
        assert.equal(await p.evaluate(`window.item757Sources.at(-1)?.source?.id`),f.root,'Reader holds the actual selected message identity');
        await confirmReader(p,f);
        await picture(p,key,'reader-collapsed');
        await press(p,input,'#reader-cover > summary');
        await until(()=>p.evaluate(`document.querySelector('#reader-cover').open`),'native press expands Reader cover');
        await inspectSheet(p,'#reader-cover > .dossier-cover',cover);
        await picture(p,key,'reader-expanded');
        await closeReader(p,input);
        // Select by its exact route, independent of where manual rows put it.
        const exact=sheet(f)+` .cover-item a[href="${route757(cover.items[1])}"]`;
        const documentBeforeNavigation=await p.evaluate('performance.timeOrigin');
        await centre(p,exact); await press(p,input,exact);
        await until(()=>p.evaluate(`document.body&&performance.timeOrigin!==${JSON.stringify(documentBeforeNavigation)}&&document.body.dataset.ready==='true'&&location.search===${JSON.stringify(route757(cover.items[1]))}`),'native item link opens the existing exact route');
        const item=(await view('pipeline_item',{workspace_id:f.workspace,number:f.second})).item;
        assert.equal(item.title,'Speed up the feed');
        await until(()=>p.evaluate(`document.querySelector('#pipeline-page')?.textContent.includes('Speed up the feed')`),'item record on screen has its actual title');
        observations.push({name:'reading item 757 exact route',key,href:await p.evaluate('location.search'),workspace:f.workspace,number:item.number});
        assert.deepEqual(p.errors,[]);
      } catch(error) {primary=error;await failure(p,key,error);throw error;} finally {await close(p,key,primary);}
    });
  }

  await check('reading item 757 loaded lifecycle Review round Wait Done combine stage named Live and actual release',async()=>{
    const key='item757-lifecycle',seeded=await call('seed',key); let f=seeded.fixture;
    const p=await openAt(key,'laptop','light',f);
    let primary;
    try {
      const origin=await p.evaluate('performance.timeOrigin'),manual=seeded.readback.covers.root;
      await inspectSheet(p,sheet(f),manual.cover);
      await opening(p,'laptop',f,key);
      await press(p,'laptop','#reader-cover > summary');
      for(const [action,states] of [['review-round',['Review, round 2','Review']],['wait',['Wait','Review']],['done',['Wait','Done']],
        ['combine',['Check candidate','Done']],['stage-named-live',['Live','Done']],['record-live',['Live · release 757','Done']]]) {
        const answer=await call(action,f);f=answer.fixture;
        const cover=answer.readback.covers.root.cover;
        assert.deepEqual(cover.items.map(r=>r.state),states,'actual committed lifecycle readback: '+action);
        assert.equal(answer.readback.covers.root.cover_revision,manual.cover_revision);
        for(const k of ['stands','payload','waiting','by','at_ms'])assert.deepEqual(cover[k],manual.cover[k],action+' preserves '+k);
        await inspectSheet(p,'#reader-cover > .dossier-cover',cover);
        assert.equal(await p.evaluate(`document.querySelector('#reader-cover').open`),true,'loaded Reader stays expanded through a real state change');
        assert.equal(await p.evaluate('window.item757Sources.at(-1)?.source?.id'),f.root,'lifecycle refresh keeps the selected source');
        await confirmReader(p,f);
        await picture(p,key,'reader-'+action,{readback:answer.readback});
        if(action==='stage-named-live') {
          assert.equal(cover.items[0].state,'Live','configured stage name alone claims no release/deployment');
          assert.deepEqual(answer.readback.release_records,[],'actual Core has no deployment record for the generative stage named Live');
        }
        if(action==='record-live')assert.deepEqual(answer.readback.release_records.map(r=>r.release),[757],'Live release words follow the actual synthetic release record');
      }
      await closeReader(p,'laptop');
      const final=(await call('read',f)).readback;
      await inspectSheet(p,sheet(f),final.covers.root.cover);
      await readyRows(p,singleton(f),final.covers.lone.cover);
      await noWrong(p,f);
      assert.equal(await p.evaluate('performance.timeOrigin'),origin,'loaded topic and Reader refresh without reloading');
      await centre(p,sheet(f));await picture(p,key,'dossier-actual-release');
      assert.deepEqual(p.errors,[]);
    }catch(error){primary=error;await failure(p,key,error);throw error;}finally{await close(p,key,primary);}
  });

  await check('reading item 757 current join split multisource and source visible destination private redaction by touch',async()=>{
    const key='item757-join-private',seeded=await call('seed',key);let f=seeded.fixture;
    const p=await openAt(key,'phone','dark',f);
    let primary;
    try{
      const origin=await p.evaluate('performance.timeOrigin');
      await inspectSheet(p,sheet(f),seeded.readback.covers.root.cover);
      const joined=await call('join-private',f);f=joined.fixture;
      assert.equal(joined.readback.covers.joined.root_id,f.root);
      assert.deepEqual(joined.readback.covers.root.cover.items[0].sources,[f.root,f.joined]);
      assert.ok(joined.private_owner_cover.cover.items.some(r=>r.workspace_id===f.private_workspace),'actual destination owner sees private row');
      assert.ok(!JSON.stringify(joined.readback).includes(f.private_workspace),'Core gives source-only reader no destination identity');
      await inspectSheet(p,sheet(f),joined.readback.covers.root.cover);
      assert.equal(await p.evaluate(`document.querySelector('#messages').textContent.includes('Secret destination title 757')`),false,'private destination title is not drawn');
      assert.equal(await p.evaluate(`!!document.querySelector('#messages a[href*="'+${JSON.stringify(f.private_workspace)}+'"]')`),false,'private destination route is not drawn');
      await noWrong(p,f);
      await centre(p,sheet(f));await picture(p,key,'dossier-joined-redacted',{readback:joined.readback});
      await opening(p,'phone',f,key);
      await press(p,'phone','#reader-cover > summary');
      await inspectSheet(p,'#reader-cover > .dossier-cover',joined.readback.covers.root.cover);
      const manual = joined.readback.covers.root;
      for (const action of ['grant-private', 'revoke-private']) {
        const changed = await call(action, f); f = changed.fixture;
        const cover = changed.readback.covers.root.cover;
        const admitted = action === 'grant-private';
        assert.equal(cover.items.some(row => row.workspace_id === f.private_workspace), admitted,
          'actual committed destination membership controls row visibility');
        assert.equal(changed.readback.covers.root.cover_revision, manual.cover_revision);
        for (const key of ['stands','payload','waiting','by','at_ms']) assert.deepEqual(cover[key], manual.cover[key]);
        await inspectSheet(p,'#reader-cover > .dossier-cover',cover);
        assert.equal(await p.evaluate(`document.querySelector('#reader-cover').textContent.includes('Secret destination title 757')`), admitted,
          'loaded Reader gains and redacts destination words after actual access changes');
        await confirmReader(p,f);
        await picture(p,key,'reader-'+action,{readback:changed.readback});
      }
      const split=await call('split',f);f=split.fixture;
      assert.equal(split.readback.covers.joined.root_id,f.joined);
      await inspectSheet(p,'#reader-cover > .dossier-cover',split.readback.covers.root.cover);
      assert.equal(await p.evaluate('window.item757Sources.at(-1)?.source?.id'),f.root,'split refresh never changes Reader message identity');
      await confirmReader(p,f);
      await picture(p,key,'reader-split',{readback:split.readback});
      await closeReader(p,'phone');
      await readyRows(p,`#messages .reply-stack[data-stack="${f.joined}"] > .dossier-cover`,split.readback.covers.joined.cover);
      await centre(p,card(f.joined));await picture(p,key,'singleton-after-split');
      await noWrong(p,f);
      assert.equal(await p.evaluate('performance.timeOrigin'),origin,'joins/privacy/split refresh the currently loaded document');
      assert.deepEqual(p.errors,[]);
    }catch(error){primary=error;await failure(p,key,error);throw error;}finally{await close(p,key,primary);}
  });
}

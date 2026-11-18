import assert from 'node:assert/strict';

// Isolated Core and immutable public builds; product acts are native input.
// No handler invocation, DOM replacement, forced focus or timed settling.
export async function item646Checks(ctx, h) {
  const { check, until, control, view, shot, facts, observations } = ctx;
  const { seed, open, centre, press, card } = h;
  const devices = ['laptop', 'phone', 'phone-375', 'phone-320'];
  const tolerance = { layoutRoundingPx: 1, baselineRoundingPx: 2, naturalWidthPx: 1 };
  const input = d => d === 'laptop' ? 'laptop' : 'phone';
  const section = root => `#messages .reply-stack[data-stack="${root}"]`;
  // A partial page is headed by a reply: select the one drawn header, never
  // pretend its data-stack is the unloaded Core root.
  const star = '#messages .stack-head > .stack-star';
  const settle = async p => {
    await until(() => p.evaluate('window.fetchesOut===0'), 'item 646 foreground requests answered');
    await p.evaluate('new Promise(done=>requestAnimationFrame(()=>requestAnimationFrame(done)))');
  };
  const acts = async (topic, id) => (await view('message_acts', { topic_id: topic })).items.find(x => x.message_id === id)?.acts ?? {};
  const setStar = async (topic, id, on, tag, sender = facts.actor) => {
    const receipt = await control({ method: 'stack_act', kind: 'message.star', sender, message_id: id, args: { starred: on }, operation_id: topic + '-' + tag });
    assert.equal(receipt.status, 'committed'); return receipt;
  };
  const events = async () => (await control({ method: 'admission_events' })).events;
  const look = p => p.evaluate(`(()=>{
    const s=document.querySelector(${JSON.stringify(star)}), head=s?.parentElement,n=head?.querySelector('.stack-name'),c=head?.querySelector('.stack-count'),folder=head?.closest('.reply-stack'),toggle=folder?.querySelector(':scope > .stack-toggle');
    const rect=e=>{const r=e?.getBoundingClientRect();return r?{x:r.x,y:r.y,width:r.width,height:r.height,bottom:r.bottom}:null},css=s&&getComputedStyle(s),ns=n&&getComputedStyle(n),hs=head&&getComputedStyle(head),b=rect(s);
    const before=s&&getComputedStyle(s,'::before'),after=s&&getComputedStyle(s,'::after');
    const range=document.createRange();if(s)range.selectNodeContents(s);const glyph=s?range.getBoundingClientRect():null;
    const natural=glyph?glyph.width+(before.content==='none'?0:(()=>{const canvas=document.createElement('canvas'),cx=canvas.getContext('2d');cx.font=css.font;return cx.measureText('·').width+parseFloat(before.marginRight)})()):null;
    return {count:document.querySelectorAll(${JSON.stringify(star)}).length,text:s?.textContent,pressed:s?.getAttribute('aria-pressed'),label:s?.getAttribute('aria-label'),
      star:b,name:rect(n),head:rect(head),toggle:rect(toggle),countBox:rect(c),natural,
      font:css?.fontSize,line:css?.lineHeight,colour:css?.color,background:css?.backgroundColor,
      livePadding:parseFloat(getComputedStyle(document.documentElement).fontSize)*.45,paddingTop:hs?.paddingTop,titleLine:ns?.lineHeight,separator:before?.content,countSeparator:c&&getComputedStyle(c,'::before').content,
      overlay:after?.content,position:css?.position,minWidth:css?.minWidth,minHeight:css?.minHeight,
      hit:!!b&&s.contains(document.elementFromPoint(b.x+b.width/2,b.y+b.height/2)),
      active:document.activeElement?.id||document.activeElement?.className||document.activeElement?.tagName,
      ring:!!s&&s.matches(':focus-visible')&&parseFloat(css.outlineWidth)>0,
      href:location.href,scroll:scrollY,reader:document.querySelector('#reader').open,
      stacks:[...document.querySelectorAll('#messages > .reply-stack')].map(e=>e.dataset.stack),
      folds:[...document.querySelectorAll('#messages .reply-stack')].map(e=>({id:e.dataset.stack,fold:e.dataset.fold,head:e.dataset.headOpen})),
      writing:document.querySelector('#inline-writing-body')?.value,to:document.querySelector('#inline-writing-to')?.textContent,
      images:[...document.querySelectorAll('#inline-attachments .image-choice')].map(e=>({text:e.textContent,src:e.querySelector('img')?.src})),
      private:document.querySelector('#messages').textContent.includes('PRIVATE 646'),overflow:document.documentElement.scrollWidth>innerWidth+${tolerance.layoutRoundingPx}};
  })()`);
  const appearance = state => {
    assert.equal(state.count, 1, 'one familiar always-visible second-line control');
    assert.equal(state.hit, true, 'actual glyph box owns its native hit point');
    assert.equal(state.background, 'rgba(0, 0, 0, 0)', 'dossier surface shows through the control');
    assert.equal(state.separator, '"·"', 'original middle dot');
    assert.equal(state.countSeparator, '"·"', 'original count separator');
    assert.ok(state.star.y >= state.name.bottom - tolerance.layoutRoundingPx, 'star is on the second line');
    assert.ok(Math.abs(parseFloat(state.paddingTop)-state.livePadding)<=tolerance.layoutRoundingPx, 'title keeps original live top padding');
    assert.ok(state.name.y - state.head.y >= state.livePadding - tolerance.layoutRoundingPx, 'title keeps live alignment with chevron');
    assert.ok(Math.abs(state.star.width - state.natural) <= tolerance.naturalWidthPx, 'target is its natural glyph and separator width');
    assert.ok(state.star.height <= parseFloat(state.line) + tolerance.layoutRoundingPx, 'no enlarged vertical hit box');
    assert.ok(['none', 'normal'].includes(state.overlay), 'no hidden overlay target');
    assert.equal(state.overflow, false, 'no sideways scroll');
  };
  const kept = (before, after, keyboard = false, rehead = false) => {
    assert.equal(after.href, before.href, 'tap keeps destination');
    assert.equal(after.reader, false, 'tap opens no Reader');
    assert.ok(Math.abs(after.scroll - before.scroll) <= tolerance.layoutRoundingPx, 'tap causes no selection scroll');
    assert.equal(after.active, before.active, 'activation preserves the actual focus');
    for (const field of ['writing', 'to', 'images']) assert.deepEqual(after[field], before[field], 'exact unsent ' + field + ' retained');
    if (!rehead) for (const field of ['stacks', 'folds']) assert.deepEqual(after[field], before[field], 'tap does not reveal or rearrange ' + field);
    assert.equal(after.private, false, 'no private words in DOM');
    if (keyboard) assert.equal(after.ring, true, 'keyboard ring persists on actual control');
  };
  const theme = (p, value) => p.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value }] });
  const tabTo = async p => {
    for (let n=0;n<180&&!await p.evaluate(`document.activeElement===document.querySelector(${JSON.stringify(star)})`);n++) await p.key('Tab');
    assert.equal(await p.evaluate(`document.activeElement===document.querySelector(${JSON.stringify(star)})`), true, 'native Tab reaches star');
  };
  const runtime = async (phase, action) => {
    const receipt = await control({ method: 'item_646_runtime', phase });
    observations.push({ name: 'item 646 runtime', ...receipt });
    assert.deepEqual(receipt.core_identity, { instance_id: facts.instance_id, actor: facts.actor });
    if (receipt.mutation) assert.notEqual(receipt.mutation.before_sha256, receipt.mutation.after_sha256);
    try { await action(receipt); }
    finally {
      const restored = await control({ method: 'item_646_runtime', phase: 'restored' });
      assert.equal(restored.restored, true);
      assert.deepEqual(restored.hashes, receipt.candidate_hashes, 'all candidate bytes restored');
      observations.push({ name: 'item 646 restoration', ...restored });
    }
  };
  const pageIn = async (tag, device, topic, first, action, init = '') => {
    let p;
    try { p=await open(tag,device,topic,first,'window.holdReads=true;'+init); await settle(p); await action(p); assert.deepEqual(p.errors, []); }
    finally { if(p) { try { await shot(p,tag+'-cleanup'); observations.push({ name:'item 646 page cleanup',tag,state:await look(p) }); } finally { await p.close(); } } }
  };
  const basicSeed = async (topic, quiet = false) => seed(topic,[
    ['root',{sender:'aim-core',join:true,addressees:[quiet?'aim-ux':facts.actor],body:'Garden plan 646.',read:true,attachments:[{name:'garden.png',image:'one.png'}]}],
    ['reply',{sender:'aim-core',reply_to:'root',addressees:[quiet?'aim-ux':facts.actor],body:'A reply stays separate.',read:true}],
    ['private',{sender:'fixture-other-person',join:true,reply_to:'root',addressees:['aim-core'],whisper:true,body:'PRIVATE 646 is never yours.',read:true}],
  ]);
  const write = async (p, device) => {
    await centre(p,'#new-message'); await press(p,input(device),'#new-message');
    await until(()=>p.evaluate("document.activeElement?.id==='inline-writing-body'"),'native writing ready');
    await p.send('Input.insertText',{text:'@aim-core Exact unsent 646.\nKeep this image: #img'});
    await until(()=>p.evaluate("!!document.querySelector('#inline-writing-body-images-0')"),'native image choice ready');
    await p.key('Enter');
    await until(()=>p.evaluate("document.querySelectorAll('#inline-attachments .image-choice').length===1"),'native chosen image kept');
    await p.key('Escape');
    await until(()=>p.evaluate("!document.querySelector('#new-message-sheet').open"),'writing closed with contents kept');
    await settle(p);
  };
  const changed = async (p,topic,id,on) => {
    await until(async()=>Boolean((await acts(topic,id)).starred)===on,'Core records exact first-message toggle');
    await until(()=>p.evaluate(`document.querySelector(${JSON.stringify(star)})?.getAttribute('aria-pressed')===${JSON.stringify(String(on))}`),'header shows committed star');
    await settle(p);
  };

  // FIRST executed feature case uses every public byte of the approved preview.
  await check('reading item 646 exact approved source first native toggle',async()=>{
    const topic='approved-646',ids=await basicSeed(topic);
    await runtime('approved',async receipt=>{
      assert.deepEqual(receipt.hashes,receipt.candidate_hashes,'first feature test is EXACT approved web bytes');
      await pageIn(topic,'laptop',topic,ids.root,async p=>{
        assert.equal(await p.evaluate(`document.querySelector('script[type=module][src]').src.includes('/b/${receipt.stamp}/')`),true);
        await centre(p,star); const before=await look(p); appearance(before); await shot(p,topic+'-before');
        await press(p,'laptop',star); await changed(p,topic,ids.root,true); const after=await look(p); kept(before,after);
        await shot(p,topic+'-starred'); observations.push({name:'item 646 approved native',before,after,tolerance});
      });
    });
  });

  for(const device of devices) for(const mode of ['light','dark']) await check(`reading item 646 toggle privacy writing and original appearance ${device} ${mode}`,async()=>{
    const topic=`toggle-646-${device}-${mode}`,ids=await basicSeed(topic);
    await setStar(topic,ids.reply,true,'reply-on'); await setStar(topic,ids.root,true,'other-root','aim-core');
    await setStar(topic,ids.private,true,'private-on','fixture-other-person');
    const inaccessible=await view('source',{source_ref:{kind:'message',id:ids.private}}); assert.ok(inaccessible.error,'Core refuses private source');
    let original;
    // Real old source draws the familiar passive mark; the baseline is recorded,
    // not used to call the old reveal contract a current compatibility gate.
    await setStar(topic,ids.root,true,'appearance-root-on');
    await runtime('original',()=>pageIn(topic+'-old',device,topic,ids.root,async p=>{
      await theme(p,mode); await centre(p,star); original=await look(p); await shot(p,topic+'-original');
      let raw; assert.throws(()=>assert.equal(original.label,'Unstar','old passive mark cannot toggle'),e=>{assert.equal(e.code,'ERR_ASSERTION');raw=e.stack;return true;});
      observations.push({name:'item 646 old source red',topic,raw,state:original});
    }));
    await setStar(topic,ids.root,false,'appearance-root-off');
    await pageIn(topic,device,topic,ids.root,async p=>{
      await theme(p,mode); await write(p,device); await centre(p,star); const before=await look(p); appearance(before);
      assert.equal(before.pressed,'false','reply-only and another reader never light root control');
      assert.equal(before.text,'☆'); assert.equal(before.to,'To aim-core'); assert.equal(before.images.length,1);
      for(const key of ['paddingTop','titleLine','font','line','colour']) assert.equal(before[key],original[key],'same original '+key);
      await shot(p,topic+'-off'); await press(p,input(device),star); await changed(p,topic,ids.root,true);
      const on=await look(p); kept(before,on); appearance(on); assert.equal(on.text,'★ Starred');
      const theirs=await control({method:'acts_as',reader:'aim-core',topic_id:topic});
      assert.equal(theirs.acts.items.find(x=>x.message_id===ids.root).acts.starred,true,'other reader retains own star');
      assert.equal((await acts(topic,ids.reply)).starred,true,'reply star retained');
      await shot(p,topic+'-on');
      if(device==='laptop') {
        await tabTo(p); const keyed=await look(p); await p.key('Enter'); await changed(p,topic,ids.root,false); kept(keyed,await look(p),true);
        await p.key(' '); await changed(p,topic,ids.root,true); kept(keyed,await look(p),true);
      }
      const lit=await look(p); await press(p,input(device),star); await changed(p,topic,ids.root,false); kept(lit,await look(p));
      await shot(p,topic+'-off-again');
      observations.push({name:'item 646 native matrix',topic,device,mode,before,on,off:await look(p),original,tolerance});
    });
    await pageIn(topic+'-reload',device,topic,ids.root,async p=>{
      await centre(p,star); assert.equal((await look(p)).pressed,'false','reload uses Core root state');
      await centre(p,'#new-message'); await press(p,input(device),'#new-message');
      await until(()=>p.evaluate("document.activeElement?.id==='inline-writing-body'"),'reload restores writing');
      const writing=await look(p); assert.equal(writing.writing,'@aim-core Exact unsent 646.\nKeep this image: ');assert.equal(writing.images.length,1);assert.equal(writing.to,'To aim-core');
      await p.key('Escape');
    });
  });

  for(const phase of ['wrong-root','reply-state','navigation','focus','touch-gate','padding','background','target']) await check(`reading item 646 applied ${phase} red and exact restore`,async()=>{
    const device=phase==='touch-gate'?'phone-320':'laptop',topic='mutant-646-'+phase,ids=await basicSeed(topic);
    for(const run of [phase,'restored']) {
      await setStar(topic,ids.root,false,run+'-off'); await setStar(topic,ids.reply,true,run+'-reply');
      await runtime(run,()=>pageIn(topic+'-'+run,device,topic,ids.root,async p=>{
        await write(p,device); await centre(p,star); const before=await look(p); await shot(p,topic+'-'+run+'-before');
        if(phase==='reply-state'||['padding','background','target'].includes(phase)) {
          const actual=await look(p), want=()=>{
            if(phase==='reply-state')assert.equal(actual.pressed,'false','reply alone never lights first message');
            if(phase==='padding')assert.ok(Math.abs(parseFloat(actual.paddingTop)-actual.livePadding)<=tolerance.layoutRoundingPx,'title keeps original live top padding');
            if(phase==='background')assert.equal(actual.background,'rgba(0, 0, 0, 0)','dossier surface shows through the control');
            if(phase==='target')assert.ok(Math.abs(actual.star.width-actual.natural)<=tolerance.naturalWidthPx,'target is its natural glyph and separator width');
          };
          if(run==='restored') want(); else {let raw;assert.throws(want,e=>{assert.equal(e.code,'ERR_ASSERTION');raw=e.stack;return true;});observations.push({name:'item 646 actual mutant red',phase,raw,actual});}
        } else {
          await press(p,input(device),star); await settle(p);
          const after=await look(p),rootOn=Boolean((await acts(topic,ids.root)).starred);
          const want=()=>{
            if(phase==='wrong-root'||phase==='touch-gate')assert.equal(rootOn,true,'native first press stars exact first message');
            else if(phase==='focus') assert.equal(after.active,before.active,'pointer retains actual focus');
            else kept(before,after);
          };
          if(run==='restored') {await changed(p,topic,ids.root,true);want();}
          else {let raw;assert.throws(want,e=>{assert.equal(e.code,'ERR_ASSERTION');raw=e.stack;return true;});observations.push({name:'item 646 actual mutant red',phase,raw,before,after,rootOn});}
        }
        await shot(p,topic+'-'+run+'-after');
      }));
    }
  });

  for(const device of devices) for(const mode of ['light','dark']) await check(`reading item 646 true unloaded root ${device} ${mode}`,async()=>{
    const topic=`unloaded-646-${device}-${mode}`;
    await control({method:'navigation_topics',topics:[{id:topic,title:'Unloaded first message 646'}]});
    const ids=await control({method:'dossier_deep',topic_id:topic});
    await setStar(topic,ids.target,true,'reply');
    for(const phase of device==='laptop'&&mode==='light'?['loaded-reply','restored']:['restored']) {
      await setStar(topic,ids.root,false,phase+'-off');
      await runtime(phase,()=>pageIn(topic+'-'+phase,device,topic,ids.newest,async p=>{
        await theme(p,mode); assert.equal(await p.evaluate(`!!document.querySelector(${JSON.stringify(card(ids.root))})`),false,'true root not loaded');
        await centre(p,star); const before=await look(p); assert.equal(before.pressed,'false','unloaded root is not its starred reply');
        await shot(p,topic+'-'+phase+'-before'); await press(p,input(device),star); await settle(p);
        const on=Boolean((await acts(topic,ids.root)).starred),after=await look(p);
        if(phase==='restored') {
          assert.equal(on,true,'Core names and stars actual unloaded root'); kept(before,after,false,true);
          assert.equal(after.pressed,'true');assert.equal((await acts(topic,ids.target)).starred,true,'reply stays starred');
          await press(p,input(device),star); await changed(p,topic,ids.root,false);
        } else {let raw;assert.throws(()=>assert.equal(on,true,'Core names and stars actual unloaded root'),e=>{assert.equal(e.code,'ERR_ASSERTION');raw=e.stack;return true;});observations.push({name:'item 646 unloaded source red',raw,before,after});}
        observations.push({name:'item 646 unloaded native',topic,phase,before,after,ids});await shot(p,topic+'-'+phase+'-after');
      }));
    }
  });

  for(const mode of ['pending','optimistic','busy','refused','lost-answer']) await check(`reading item 646 ${mode} real Core boundary`,async()=>{
    const topic='boundary-646-'+mode,ids=await basicSeed(topic);
    for(const phase of ['pending','optimistic'].includes(mode)?[mode,'restored']:['restored']) {
      await setStar(topic,ids.root,false,phase+'-off');
      await runtime(phase,()=>pageIn(topic+'-'+phase,'laptop',topic,ids.root,async p=>{
        await centre(p,star);const before=await look(p),at=(await events()).length;
        const hold=topic+'-'+phase;
        await control({method:'read_hold',hold_id:hold,name:mode==='lost-answer'?'answer:message.star':'command:message.star',phase:'callback'});
        let locked=false;
        try {
          await press(p,'laptop',star);
          await until(async()=>(await events()).some(e=>e.event==='hold-enter'&&e.hold_id===hold),'actual command reached Core boundary');
          const waiting=await look(p);
          if(mode==='optimistic') {
            const want=()=>assert.equal(waiting.pressed,'false','no optimistic wrong star before Core answer');
            if(phase==='restored')want();else {let raw;assert.throws(want,e=>{assert.equal(e.code,'ERR_ASSERTION');raw=e.stack;return true;});observations.push({name:'item 646 actual mutant red',mode,phase,raw,waiting});}
          }
          if(mode==='pending') {
            await press(p,'laptop',star);await press(p,'laptop',star);
            // All native click handlers have returned; the product queues sends
            // behind the held one. Count again after it is released below.
          }
          if(mode==='refused') await setStar(topic,ids.root,true,'race-star');
          if(mode==='busy'){await control({method:'item_646_lock',held:true});locked=true;}
          if(mode==='lost-answer') {
            // The real command is committed but its HTTP answer remains held.
            assert.equal((await acts(topic,ids.root)).starred,true);
            assert.equal(waiting.pressed,'false','committed Core with unanswered transport stays unconfirmed');
            await p.send('Page.reload');
          }
        } finally {await control({method:'read_release',hold_id:hold});}
        try {
          await settle(p);
          const sent=(await events()).slice(at).filter(e=>e.event==='star-command-enter');
          const answered=(await events()).slice(at).filter(e=>e.event==='star-command-answer');
          if(mode==='pending') {
            const want=()=>assert.equal(new Set(sent.map(e=>e.envelope.operation_id)).size,1,'repeated pending taps keep one exact operation');
            if(phase==='restored')want();else {let raw;assert.throws(want,e=>{assert.equal(e.code,'ERR_ASSERTION');raw=e.stack;return true;});observations.push({name:'item 646 actual mutant red',mode,raw,sent});}
          } else if(mode==='busy') {
            assert.ok(answered.some(e=>e.receipt.error?.code==='DATABASE_BUSY'&&!e.receipt.recorded),'real SQLite contention is not recorded result');
            assert.equal((await look(p)).pressed,'false');
          } else if(mode==='refused') {
            assert.ok(answered.some(e=>e.receipt.error?.code==='REVISION_CONFLICT'),'actual Core refused stale revision');
            assert.equal((await acts(topic,ids.root)).starred,true,'race winner remains');
          } else if(mode==='lost-answer') {
            await until(()=>p.evaluate("document.body.dataset.ready==='true'"),'real reload ready');
            await centre(p,star); assert.equal((await look(p)).pressed,'true','reload reads actual committed state');
          }
          observations.push({name:'item 646 boundary evidence',mode,phase,before,after:await look(p),sent,answered});
          await shot(p,topic+'-'+phase+'-boundary');
        } finally {if(locked)await control({method:'item_646_lock',held:false});}
        if(mode==='busy') {
          // An actual subsequent response wakes the retained exact operation.
          await p.send('Page.reload');await until(()=>p.evaluate("document.body.dataset.ready==='true'"),'busy reload ready');
          await centre(p,star);await press(p,'laptop',star);await changed(p,topic,ids.root,true);
        }
      }));
    }
  });

  for(const device of devices) await check(`reading item 646 quiet dossier and singleton ${device}`,async()=>{
    const topic='quiet-646-'+device,ids=await basicSeed(topic,true);
    await pageIn(topic,device,topic,ids.root,async p=>{
      await centre(p,star);const before=await look(p);appearance(before);await press(p,input(device),star);await changed(p,topic,ids.root,true);kept(before,await look(p));
    });
    const singleTopic='single-646-'+device,single=await seed(singleTopic,[['root',{sender:'aim-core',join:true,addressees:[facts.actor],body:'One message keeps its own familiar star.',read:true}]]);
    await pageIn(singleTopic,device,singleTopic,single.root,async p=>{
      assert.equal(await p.evaluate(`document.querySelectorAll(${JSON.stringify(star)}).length`),0,'a singleton stays a message without an invented dossier title');
      await shot(p,singleTopic+'-message');
    });
  });
}

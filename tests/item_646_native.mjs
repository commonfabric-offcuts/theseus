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
      compact:folder?.dataset.compact==='true',livePadding:parseFloat(getComputedStyle(document.documentElement).fontSize)*(folder?.dataset.compact==='true' ? .25 : innerWidth<=760 ? .4 : .45),paddingTop:hs?.paddingTop,titleLine:ns?.lineHeight,separator:before?.content,countSeparator:c&&getComputedStyle(folder?.dataset.compact==='true'?head.querySelector('.stack-meta'):c,'::before').content,
      overlay:after?.content,position:css?.position,minWidth:css?.minWidth,minHeight:css?.minHeight,
      hit:!!b&&s.contains(document.elementFromPoint(b.x+b.width/2,b.y+b.height/2)),
      active:document.activeElement?.id||document.activeElement?.className||document.activeElement?.tagName,
      ring:!!s&&s.matches(':focus-visible')&&parseFloat(css.outlineWidth)>0,
      href:location.href,scroll:scrollY,reader:document.querySelector('#reader').open,
      stacks:[...document.querySelectorAll('#messages > .reply-stack')].map(e=>e.dataset.stack),
      folds:[...document.querySelectorAll('#messages .reply-stack')].map(e=>({id:e.dataset.stack,fold:e.dataset.fold,head:e.dataset.headOpen})),
      writing:document.querySelector('#inline-writing-body')?.value,to:document.querySelector('#inline-writing-to')?.textContent,
      images:[...document.querySelectorAll('#inline-attachments .image-choice')].map(e=>({selection:e.dataset.selection,name:e.querySelector('.image-open span')?.textContent.split(' · ')[0],src:e.querySelector('img')?.src})),
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
    ...(quiet?[['primer',{sender:'aim-ux',join:true,body:'Agent participant is here.',read:true}]]:[]),
    ['root',{sender:'aim-core',join:true,addressees:[quiet?'aim-ux':facts.actor],body:'Garden plan 646.',read:true,attachments:[{name:'garden.png',image:'one.png'}]}],
    ['reply',{sender:'aim-core',reply_to:'root',addressees:[quiet?'aim-ux':facts.actor],body:'A reply stays separate.',read:true}],
    ['private',{sender:'fixture-other-person',join:true,reply_to:'root',addressees:['aim-core'],whisper:true,body:'PRIVATE 646 is never yours.',read:true}],
  ]);
  const write = async (p, device) => {
    await centre(p,'#new-message'); await press(p,input(device),'#new-message');
    await until(()=>p.evaluate("document.activeElement?.id==='inline-writing-body'"),'native writing ready');
    const hasImage=await p.evaluate("document.querySelectorAll('#inline-attachments .image-choice').length===1");
    await p.key('a',4);
    await p.send('Input.insertText',{text:'@aim-core Exact unsent 646.\nKeep this image: '+(hasImage?'':'#img')});
    if(!hasImage){
      await until(()=>p.evaluate("!!document.querySelector('#inline-writing-body-images-0')"),'native image choice ready');
      await p.key('Enter');
    }
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
  await check('reading item 646 exact approved source preserves observed focus red',async()=>{
    const topic='approved-646',ids=await basicSeed(topic);
    await runtime('approved',async receipt=>{
      assert.equal(receipt.stamp,'d39946e4a02387046915','archived exact approved web stamp observed in first hosted runs');
      await pageIn(topic,'laptop',topic,ids.root,async p=>{
        assert.equal(await p.evaluate(`document.querySelector('script[type=module][src]').src.includes('/b/${receipt.stamp}/')`),true);
        await centre(p,star); const before=await look(p); appearance(before); await shot(p,topic+'-before');
        await press(p,'laptop',star); await changed(p,topic,ids.root,true); const after=await look(p);
        let raw;assert.throws(()=>assert.equal(after.active,before.active,'approved desktop pointer preserves focus'),e=>{assert.equal(e.code,'ERR_ASSERTION');raw=e.stack;return true;});
        observations.push({name:'item 646 exact approved feature red',raw,before,after});
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
      assert.equal(theirs.acts.items.find(x=>x.message_id===ids.root).acts.star_revision,1,'own toggle never changes another reader revision');
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

  for(const phase of ['wrong-root','reply-state','navigation','focus','touch-gate',...(ctx.engine==='webkit'?['touch-cancel']:[]),'padding','background','target']) await check(`reading item 646 applied ${phase} red and exact restore`,async()=>{
    const device=['touch-gate','touch-cancel'].includes(phase)?'phone-320':'laptop',topic='mutant-646-'+phase,ids=await basicSeed(topic);
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
            if(phase==='wrong-root'||phase==='touch-gate'||phase==='touch-cancel')assert.equal(rootOn,true,'native first press stars exact first message');
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
        if(phase==='restored')await changed(p,topic,ids.root,true);
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
          await centre(p,'#new-message');await press(p,'laptop','#new-message');
          await until(()=>p.evaluate("document.activeElement?.id==='inline-writing-body'"),'native writing read wakes recovery');
          await changed(p,topic,ids.root,true);
          const retry=(await events()).slice(at).filter(e=>e.event==='star-command-enter');
          assert.ok(retry.length>=2,'real retry reached Core after contention');
          assert.equal(new Set(retry.map(e=>e.envelope.operation_id)).size,1,'busy retries same exact operation');
          await p.key('Escape');
        }
      }));
    }
  });

  await check('reading item 646 in doubt repeated tap and same operation recovery',async()=>{
    const topic='doubt-646',ids=await basicSeed(topic);
    const lostTransport=`(()=>{const original=window.fetch;let lost=false;window.fetch=function(input,init){
      const body=init&&typeof init.body==='string'?JSON.parse(init.body):null,result=original.call(this,input,init);
      if(body?.kind==='message.star'&&!lost){lost=true;return result.then(()=>{throw new TypeError('Fixture discards the real committed HTTP answer')})}return result};})()`;
    for(const phase of ['doubt','restored']){
      await setStar(topic,ids.root,false,phase+'-off');
      await runtime(phase,()=>pageIn(topic+'-'+phase,'laptop',topic,ids.root,async p=>{
        await centre(p,star);const at=(await events()).length,hold=topic+'-'+phase,readHold=hold+'-acts';
        await control({method:'read_hold',hold_id:hold,name:'answer:message.star',phase:'callback'});
        await control({method:'read_hold',hold_id:readHold,name:'message_acts',phase:'callback'});
        try {
          await press(p,'laptop',star);
          await until(async()=>(await events()).some(e=>e.event==='hold-enter'&&e.hold_id===hold),'real committed answer held');
          assert.equal((await acts(topic,ids.root)).starred,true,'Core really committed the lost answer');
          assert.equal((await look(p)).pressed,'false','unanswered transport never paints success');
        } finally {await control({method:'read_release',hold_id:hold});}
        try {
          await until(async()=>(await events()).some(e=>e.event==='hold-enter'&&e.hold_id===readHold),'doubt reconciles through real acts read');
          await press(p,'laptop',star);
          if(phase==='doubt')await until(async()=>(await events()).slice(at).filter(e=>e.event==='star-command-enter').length>1,'applied doubt mutant sends duplicate');
          await p.evaluate('new Promise(done=>requestAnimationFrame(()=>requestAnimationFrame(done)))');
          const sent=(await events()).slice(at).filter(e=>e.event==='star-command-enter');
          const want=()=>assert.equal(new Set(sent.map(e=>e.envelope.operation_id)).size,1,'repeated tap in doubt never creates a new operation');
          if(phase==='restored')want();else {let raw;assert.throws(want,e=>{assert.equal(e.code,'ERR_ASSERTION');raw=e.stack;return true;});observations.push({name:'item 646 actual doubt mutant red',raw,sent});}
        } finally {await control({method:'read_release',hold_id:readHold});}
        await settle(p);
        if(phase==='restored'){
          await changed(p,topic,ids.root,true);
          await until(async()=>(await events()).slice(at).filter(e=>e.event==='star-command-enter').length>=2,'actual response wakes exact-operation retry');
          const sent=(await events()).slice(at).filter(e=>e.event==='star-command-enter');
          assert.equal(new Set(sent.map(e=>e.envelope.operation_id)).size,1,'retry reuses the lost operation');
          assert.deepEqual(sent[0].envelope,sent.at(-1).envelope,'retry preserves every request field');
          const operations=await control({method:'item_646_operations'});
          assert.equal(operations.rows.filter(x=>x.operation_id===sent[0].envelope.operation_id).length,1,'one durable operation after actual transport loss');
          observations.push({name:'item 646 actual same operation recovery',sent});
        }
        await shot(p,topic+'-'+phase+'-recovery');
      },lostTransport));
    }
  });

  for(const state of ['loading','load-error','changed-root']) await check(`reading item 646 ${state} truthful unloaded boundary`,async()=>{
    const topic='load-646-'+state;
    await control({method:'navigation_topics',topics:[{id:topic,title:'Unloaded boundary 646'}]});
    const ids=await control({method:'dossier_deep',topic_id:topic});
    const neighbour=(await control({method:'agent_message',operation_id:topic+'-neighbour',sender:'aim-core',topic_id:topic,source:'topic',body:'A separate dossier.'})).result.message_id;
    await pageIn(topic,'laptop',topic,ids.newest,async p=>{
      await centre(p,star);const before=await look(p),at=(await events()).length;
      const hold=topic+'-page';
      if(state==='load-error')await control({method:'read_fault',name:'topic_messages',status:500,body:{error:{code:'FIXTURE_READ_FAILURE',message:'The older messages could not be read.'}}});
      await control({method:'read_hold',hold_id:hold,name:'topic_messages',phase:'callback'});
      try {
        await press(p,'laptop',star);
        await until(async()=>(await events()).some(e=>e.event==='hold-enter'&&e.hold_id===hold),'actual scoped root page waits');
        await press(p,'laptop',star);
        assert.equal((await look(p)).pressed,'false','loading never claims a star');
        assert.equal((await events()).slice(at).filter(e=>e.event==='star-command-enter').length,0,'loading and repeated tap create no operation');
        if(state==='changed-root') {
          const receipt=await control({method:'stack_act',sender:'aim-core',kind:'stack.join',message_id:ids.root,args:{into:neighbour},operation_id:topic+'-join'});
          assert.equal(receipt.status,'committed','actual Core root changed while read held');
        }
      } finally {await control({method:'read_release',hold_id:hold});}
      if(state==='loading') {
        await changed(p,topic,ids.root,true);
        assert.equal(new Set((await events()).slice(at).filter(e=>e.event==='star-command-enter').map(e=>e.envelope.operation_id)).size,1,'one operation after actual load');
      } else {
        await until(()=>p.evaluate("document.querySelector('#app-status').textContent.includes('unavailable')&&window.fetchesOut===0"),'failed or changed root is said truthfully');
        await settle(p);
        assert.equal(Boolean((await acts(topic,ids.root)).starred),false,'unavailable or changed first message mutates nothing');
        assert.equal((await events()).slice(at).filter(e=>e.event==='star-command-enter').length,0,'no substituted message act');
      }
      const after=await look(p);kept(before,after,false,true);await shot(p,topic+'-result');
      observations.push({name:'item 646 unloaded boundary',state,before,after,events:(await events()).slice(at)});
    });
  });

  await check('reading item 646 empty own-star list has one truthful outline toggle',async()=>{
    const topic='empty-646',ids=await basicSeed(topic);
    assert.equal((await view('stars',{})).items.filter(x=>x.topic_id===topic).length,0);
    await pageIn(topic,'phone-320',topic,ids.root,async p=>{
      await centre(p,star);const before=await look(p);assert.equal(before.pressed,'false');assert.equal(before.text,'☆');appearance(before);
      await press(p,'phone',star);await changed(p,topic,ids.root,true);kept(before,await look(p));await shot(p,topic+'-first-star');
    });
  });

  for(const device of devices) for(const mode of ['light','dark']) await check(`reading item 646 quiet dossier and singleton ${device} ${mode}`,async()=>{
    const topic='quiet-646-'+device+'-'+mode,ids=await basicSeed(topic,true);
    await pageIn(topic,device,topic,ids.root,async p=>{
      await theme(p,mode);await centre(p,star);const before=await look(p);appearance(before);await press(p,input(device),star);await changed(p,topic,ids.root,true);kept(before,await look(p));
    });
    const singleTopic='single-646-'+device+'-'+mode,single=await seed(singleTopic,[['root',{sender:'aim-core',join:true,addressees:[facts.actor],body:'One message keeps its own familiar star.',read:true}]]);
    await pageIn(singleTopic,device,singleTopic,single.root,async p=>{
      await theme(p,mode);assert.equal(await p.evaluate(`document.querySelectorAll(${JSON.stringify(star)}).length`),0,'a singleton stays a message without an invented dossier title');
      await shot(p,singleTopic+'-message');
    });
  });
}

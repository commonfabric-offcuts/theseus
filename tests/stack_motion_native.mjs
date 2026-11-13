// Item 412: sample real frames of the real feed; actions go through native
// menus, keys or touches and fixture commands commit to isolated Core records.
import assert from 'node:assert/strict';
const PROBE = `window.motionFrames=[];window.motionClock=0;
addEventListener('DOMContentLoaded',()=>{const sample=()=>{window.motionClock++;
for(const c of document.querySelectorAll('#messages .message-card[data-stack-motion]')){
 const e=c.closest('.message-fold')||c,s=c.closest('.reply-stack'),r=s?.querySelector('.stack-replies');
 const prior=[...r?.querySelectorAll(':scope>[data-id]')||[]].find(n=>n.dataset.id!==c.dataset.id&&!n.hidden);
 const bar=document.querySelector('.message-bar'),barBox=bar?.getBoundingClientRect(),tab=s?.querySelector(':scope>[data-id] .stack-head')?.getBoundingClientRect();
 const b=e.getBoundingClientRect(),q=r?.getBoundingClientRect(),a=c.querySelector(':scope>.message-author');
 const authors=[...c.querySelectorAll(':scope>.message-author,:scope>.message-folded')].filter(n=>getComputedStyle(n).display!=='none'&&getComputedStyle(n).visibility!=='hidden');
 window.motionFrames.push({clock:window.motionClock,id:c.dataset.id,kind:c.dataset.stackMotion,top:b.top,bottom:b.bottom,height:b.height,
 opacity:+getComputedStyle(e).opacity,transform:getComputedStyle(e).transform,edge:b.bottom-(q?.top||0),floor:q?.height,
 authors:authors.length,authorOffset:a?a.getBoundingClientRect().top-b.top:null,authorOpacity:a?+getComputedStyle(a).opacity:1,sectionBottom:s?.getBoundingClientRect().bottom,
 priorTop:prior?.getBoundingClientRect().top,barId:document.querySelector('#messages .message-card.lit')?.dataset.id,barTop:barBox?.top,barHeight:barBox?.height,tabBottom:tab?.bottom,animations:e.getAnimations().length+c.getAnimations().length});}
 };const tick=()=>{setTimeout(sample,0);requestAnimationFrame(tick)};requestAnimationFrame(tick)});`;

export async function motionChecks({ check, until, view, control, shot, facts, observations }, h) {
  const { seed, open, centre, press, card, DEVICES, menuOf, choose, away, keyTo } = h;
  const widths = [320,375,390,1280];
  const atWidths = async (label, run) => {
    for (const width of widths) {
      const device = width === 1280 ? 'laptop' : 'phone', saved = DEVICES.phone;
      if (device === 'phone') DEVICES.phone = { ...saved, width };
      const topic = `motion-${label}-${width}`;
      const ids = await seed(topic, [
        ['primer',{sender:'aim-ux',join:true,addressees:[facts.actor],body:'Membership ready.'}],
        ['root',{sender:'aim-core',join:true,addressees:[facts.actor],body:'A stable dossier header.'}],
        ['one',{sender:'aim-ux',reply_to:'root',addressees:[facts.actor],body:'A message with a real author and words.\n\nMore words to clip as this card folds.\n\nThe final paragraph stays in Core.'}],
        ['two',{sender:'aim-core',reply_to:'root',addressees:[facts.actor],body:'The next card covers only the sacrificial edge.'}],
      ]);
      let p;
      try {
        p = await open(topic,device,topic,ids.root,PROBE);
        await p.send('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'no-preference'}]});
        await centre(p, `#messages .reply-stack[data-stack="${ids.root}"]`);
        await run({p,ids,topic,device,width});
        assert.deepEqual(p.errors,[]);
      } finally { if(p)await p.close(); DEVICES.phone=saved; }
    }
  };
  const frames = (p,id,kind) => p.evaluate(`window.motionFrames.filter(f=>f.id===${JSON.stringify(id)}&&f.kind===${JSON.stringify(kind)})`);
  const settled = p => until(()=>p.evaluate(`!document.querySelector('#messages [data-stack-motion]')`),'motion restores natural geometry');
  const add = async ({topic,ids}, label='new') => (await control({method:'agent_message',operation_id:topic+'-'+label,topic_id:topic,source:'topic',sender:'aim-core',reply_to:ids.root,addressees:[facts.actor],body:'A new live reply.\n\n'+('The boundary follows this moving edge. '.repeat(9))})).result.message_id;
  const folded = async ctx => {
    await menuOf(ctx.p,ctx.device,ctx.ids.one); await choose(ctx.p,ctx.device,'Fold');
    await settled(ctx.p);
  };
  await check('reading dossier motion arrival follows the moving lower edge at 320 375 390 and laptop', async()=>{
    await atWidths('arrival',async ctx=>{
      const {p,ids,width,topic}=ctx;
      const old = await p.evaluate(`document.querySelector(${JSON.stringify(card(ids.root))}).closest('.reply-stack').querySelector('.stack-replies').getBoundingClientRect().height`);
      const priorTop=(await p.box(card(ids.one))).y;
      const id=await add(ctx);
      await until(async()=>(await frames(p,id,'arrival')).some(f=>f.opacity>.2&&f.opacity<.8),'a live reply actually travels');
      const read = async()=> (await view('topic_messages',{topic_id:topic,audience:'all',direction:'after',cursor:0,limit:30})).items.find(item=>item.id===id);
      assert.equal((await read()).unread,true,'a transparent travelling face has not earned a read in Core');
      await settled(p); await centre(p,card(id));
      await until(async()=>!(await read()).unread,'the settled visible face earns its real Core read');
      const samples=await frames(p,id,'arrival');
      assert.ok(samples.every(f=>Math.abs(f.priorTop-priorTop)<1.1),'the earlier words being read keep their screen position during travel');
      assert.ok(samples.some(f=>f.opacity<.8&&f.transform!=='none'),'the new face fades and travels');
      assert.ok(samples.some(f=>f.edge<old-1&&Math.abs(f.floor-old)<1.1),'the old floor holds before contact');
      assert.ok(samples.some(f=>f.edge>old+2&&Math.abs(f.floor-f.edge)<1.1),'after contact the floor follows the moving edge');
      assert.ok(samples.every(f=>Math.abs(f.floor-Math.max(old,f.edge))<1.1),'every sampled boundary follows contact rather than pre-expanding');
      observations.push({name:'motion-arrival-'+width,old,samples}); await shot(p,'motion-arrival-'+width);
    });
  });
  await check('reading dossier motion fold clips one solid author at 320 375 390 and laptop', async()=>{
    await atWidths('fold',async ctx=>{
      const {p,ids,width}=ctx, before=(await p.box(card(ids.one))).height;
      // A long card may own only the y longhand. Animation cleanup must not
      // erase it by restoring an absent overflow shorthand.
      await p.evaluate(`document.querySelector(${JSON.stringify(card(ids.one))}).style.overflowY='auto'`);
      await folded(ctx);
      const samples=await frames(p,ids.one,'fold'), final=await p.box(card(ids.one));
      assert.equal(await p.evaluate(`document.querySelector(${JSON.stringify(card(ids.one))}).style.overflowY`),'auto','the card keeps its original scroll axis');
      assert.ok(samples.length>2&&samples.some(f=>f.height>final.height+2&&f.height<before-2),'fold has intermediate clipped heights');
      assert.ok(samples.every(f=>f.authors===1&&f.authorOpacity===1),'one solid author, no fading duplicate');
      await centre(p,card(ids.one)); await away(p);
      const surface=await p.evaluate(`(()=>{const c=document.querySelector(${JSON.stringify(card(ids.one))}),n=c.parentElement.querySelector(${JSON.stringify(card(ids.two))}),b=c.getBoundingClientRect(),z=n.getBoundingClientRect();return {folded:c.dataset.folded,exposed:z.top-b.top,words:getComputedStyle(c.querySelector('.folded-words')).opacity,hit:c.contains(document.elementFromPoint(b.left+6,b.top+22))}})()`);
      assert.equal(surface.folded,'true'); assert.equal(surface.words,'1');
      if(width<760){assert.ok(surface.exposed>=43.9,'44px phone strip remains exposed');assert.equal(surface.hit,true,'the exposed strip itself receives the tap');
        const thumb=card(ids.one)+' > .message-folded > .folded-thumb';
        const state=await p.evaluate(`document.querySelector(${JSON.stringify(thumb)}).getAttribute('aria-pressed')`);
        await press(p,ctx.device,thumb);
        await until(()=>p.evaluate(`document.querySelector(${JSON.stringify(thumb)}).getAttribute('aria-pressed')!==${JSON.stringify(state)}`),'the folded thumb receives a native tap');
        assert.equal(await p.evaluate(`document.querySelector(${JSON.stringify(card(ids.one))}).dataset.folded`),'true','thumb does not unfold the card');
      }
      observations.push({name:'motion-fold-'+width,surface,samples}); await shot(p,'motion-fold-'+width);
    });
  });
  await check('reading dossier motion unfold draws the same solid author at 320 375 390 and laptop', async()=>{
    await atWidths('unfold',async ctx=>{
      const {p,ids,width,device}=ctx; await folded(ctx);
      const before=(await p.box(card(ids.one))).height;
      const headerOffset=await p.evaluate(`(()=>{const c=document.querySelector(${JSON.stringify(card(ids.one))});return c.querySelector('.folded-author').getBoundingClientRect().top-c.getBoundingClientRect().top})()`);
      await centre(p,card(ids.one)); await press(p,device,card(ids.one)); await settled(p);
      const samples=await frames(p,ids.one,'unfold'), after=(await p.box(card(ids.one))).height;
      assert.ok(samples.length>2&&samples.some(f=>f.height>before+2&&f.height<after-2),'unfold has intermediate heights');
      assert.ok(samples.every(f=>f.authors===1&&f.authorOpacity===1),'unfold keeps one solid header');
      assert.ok(Math.abs(samples[0].authorOffset-headerOffset)<3,'the original author resumes at the folded author inset');
      assert.equal(await p.evaluate(`document.querySelector(${JSON.stringify(card(ids.one))}).dataset.folded`),'false');
      observations.push({name:'motion-unfold-'+width,samples}); await shot(p,'motion-unfold-'+width);
    });
  });
  await check('reading dossier motion reduced preference paints natural arrival fold and unfold without travel', async()=>{
    await atWidths('reduced',async ctx=>{
      const {p,ids,device}=ctx;
      await p.send('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]});
      const id=await add(ctx); await until(()=>p.evaluate(`Boolean(document.querySelector(${JSON.stringify(card(id))}))`),'reduced arrival appears');
      await folded(ctx); await centre(p,card(ids.one)); await press(p,device,card(ids.one)); await settled(p);
      assert.deepEqual(await p.evaluate('window.motionFrames'),[],'reduced motion runs none of the three transitions');
      assert.equal(await p.evaluate(`document.querySelector(${JSON.stringify(card(ids.one))}).style.height`),'');
    });
  });
  await check('reading dossier motion a press held through arrival freezes geometry until release', async()=>{
    await atWidths('press',async ctx=>{
      const {p,ids}=ctx, id=await add(ctx);
      await until(()=>p.evaluate(`(()=>{const c=document.querySelector(${JSON.stringify(card(id))});return c?.dataset.stackMotion==='arrival'&&+getComputedStyle(c).opacity>.1&&+getComputedStyle(c).opacity<.8})()`),'the arrival is currently mid-flight');
      const b=await p.box('#topic-title'),x=b.x+10,y=b.y+b.height/2;
      await p.send('Input.dispatchMouseEvent',{type:'mousePressed',x,y,button:'left',clickCount:1});
      const look=()=>p.evaluate(`(()=>{const c=document.querySelector(${JSON.stringify(card(id))}),r=c.getBoundingClientRect();return [r.top,r.bottom,getComputedStyle(c).transform,c.closest('.reply-stack').getBoundingClientRect().bottom]})()`);
      const before=await look();
      await p.evaluate(`new Promise(done=>{const start=performance.now();const tick=()=>performance.now()-start>170?done():requestAnimationFrame(tick);requestAnimationFrame(tick)})`);
      assert.deepEqual(await look(),before,'a held primary press freezes the card and folder');
      await p.send('Input.dispatchMouseEvent',{type:'mouseReleased',x,y,button:'left',clickCount:1}); await settled(p);
      assert.ok((await frames(p,id,'arrival')).some(f=>f.opacity>.95),'release resumes the current arrival');
    });
  });
  await check('reading dossier motion cancelling an arrival mid-flight restores styles and accepts its successor', async()=>{
    await atWidths('cancel',async ctx=>{
      const {p}=ctx,id=await add(ctx);
      await until(async()=>(await frames(p,id,'arrival')).length>2,'arrival began before cancellation');
      await p.send('Emulation.setDeviceMetricsOverride',{...DEVICES[ctx.device],width:ctx.width+1});
      await p.evaluate('new Promise(done=>requestAnimationFrame(()=>requestAnimationFrame(done)))');
      assert.equal(await p.evaluate(`Boolean(document.querySelector(${JSON.stringify(card(id))})?.dataset.stackMotion)`),false,'resize cancels before the normal end of the flight');
      await settled(p);
      assert.deepEqual(await p.evaluate(`(()=>{const c=document.querySelector(${JSON.stringify(card(id))}),r=c.closest('.stack-replies');return [c.style.transform,c.style.opacity,r.style.height,c.getAnimations().length]})()`),['','','',0]);
      await centre(p,card(id)); // Bring the next slot on screen; off-screen arrivals correctly stay static.
      const next=await add(ctx,'successor'); await until(async()=>(await frames(p,next,'arrival')).length>2,'successor can animate after cancellation'); await settled(p);
      // A real Undo can reverse a fold before its clipped author reaches the
      // row. Its semantic row is hidden then: measure the original header.
      await centre(p,card(ctx.ids.one));
      const full=(await p.box(card(ctx.ids.one))).height;
      const compact=await p.evaluate(`parseFloat(getComputedStyle(document.querySelector('#messages')).getPropertyValue('--stack-folded-height'))`);
      await menuOf(p,ctx.device,ctx.ids.one); await choose(p,ctx.device,'Fold');
      await until(()=>p.evaluate(`(()=>{const c=document.querySelector(${JSON.stringify(card(ctx.ids.one))});return c.dataset.stackMotion==='fold'&&c.getBoundingClientRect().height<${compact+(full-compact)*.35}&&c.getBoundingClientRect().height>${compact+3}})()`),'the fold is partway through its clip');
      const inset=()=>p.evaluate(`(()=>{const c=document.querySelector(${JSON.stringify(card(ctx.ids.one))});return c.querySelector(':scope>.message-author').getBoundingClientRect().top-c.getBoundingClientRect().top})()`);
      const held=await inset(); await p.key('z',4);
      assert.ok(Math.abs(await inset()-held)<3,'Undo reverses from the single currently visible author, without a header jump');
      await settled(p);
      assert.equal(await p.evaluate(`document.querySelector(${JSON.stringify(card(ctx.ids.one))}).dataset.folded`),'false','native Undo restores the unfolded state');
    });
  });
  await check('reading dossier motion no arrival on page load or a read-only replay', async()=>{
    await atWidths('replay',async ctx=>{
      const {p,ids,topic}=ctx;
      await p.evaluate('new Promise(done=>requestAnimationFrame(()=>requestAnimationFrame(done)))');
      assert.deepEqual(await p.evaluate('window.motionFrames'),[],'page load has no motion');
      await control({method:'stack_act',sender:facts.actor,kind:'message.star',message_id:ids.one,operation_id:topic+'-star',args:{starred:true}});
      await until(()=>p.evaluate(`document.querySelector(${JSON.stringify(card(ids.one))}).dataset.starred==='true'`),'read-only act replay reaches page');
      assert.deepEqual(await p.evaluate('window.motionFrames'),[],'a replay of the same messages never deals them again');
    });
  });

  // Item 379: what the keys move to is brought fully into view. A reply still
  // arriving is revealed where it lands, while it keeps travelling there.
  await check('reading dossier motion the keys onto a reply still arriving bring it whole into view where it lands at 320 375 390 and laptop', async()=>{
    await atWidths('keys',async ctx=>{
      const {p,ids,topic}=ctx;
      await keyTo(p,ids.two);
      await p.evaluate(`(c=>scrollBy(0,c.getBoundingClientRect().bottom-(innerHeight-260)))(document.querySelector(${JSON.stringify(card(ids.two))}))`);
      const id=(await control({method:'agent_message',operation_id:topic+'-tall',topic_id:topic,source:'topic',sender:'aim-core',reply_to:ids.root,addressees:[facts.actor],
        body:Array.from({length:12},(_,i)=>`Line ${i+1} of a tall live reply.`).join('\n\n')})).result.message_id;
      // The key goes as soon as the page's own frame shows the reply in flight.
      await p.evaluate(`new Promise(done=>{const look=()=>{const c=document.querySelector(${JSON.stringify(card(id))}),e=c?.closest('.stack-replies > [data-id]');
        if(c?.dataset.stackMotion==='arrival'&&+getComputedStyle(e).opacity<.6)done();else requestAnimationFrame(look)};look()})`);
      await p.key('ArrowDown');
      const keyed=await p.evaluate(`[document.querySelector(${JSON.stringify(card(id))}).dataset.stackMotion??null,window.motionClock,document.querySelector('#messages .message-card.lit')?.dataset.id??null]`);
      assert.deepEqual([keyed[0],keyed[2]],['arrival',id],'ArrowDown lit the reply while it was still arriving');
      await settled(p);
      const box=await p.evaluate(`(r=>({top:r.top,bottom:r.bottom,height:r.height,screen:innerHeight}))(document.querySelector(${JSON.stringify(card(id))}).getBoundingClientRect())`);
      assert.ok(box.height<box.screen*.8,`the reply fits the screen with room: ${JSON.stringify(box)}`);
      assert.ok(box.top>=0&&box.bottom<=box.screen,`the lit reply shows whole once it lands: ${JSON.stringify(box)}`);
      assert.ok(box.bottom>=box.screen*.75,`the page scrolled no further than to show it: ${JSON.stringify(box)}`);
      assert.ok((await frames(p,id,'arrival')).some(f=>f.clock>keyed[1]&&f.transform!=='none'),'the keys do not cut its landing short');
    });
  });

  // A fold is motion too: a reply unfolding (here, on another device) is
  // revealed at its full height, not the clipped height it has in flight.
  await check('reading dossier motion the keys onto a reply still unfolding bring it whole into view where it lands at 320 375 390 and laptop', async()=>{
    await atWidths('keys-unfold',async ctx=>{
      const {p,ids,topic}=ctx;
      const id=(await control({method:'agent_message',operation_id:topic+'-tall',topic_id:topic,source:'topic',sender:'aim-core',reply_to:ids.root,addressees:[facts.actor],
        body:Array.from({length:12},(_,i)=>`Line ${i+1} of a tall reply to fold.`).join('\n\n')})).result.message_id;
      await until(()=>p.evaluate(`Boolean(document.querySelector(${JSON.stringify(card(id))}))`),'the tall reply is drawn'); await settled(p);
      const full=(await p.box(card(id))).height;
      const fold=on=>control({method:'stack_act',sender:facts.actor,kind:'message.fold',message_id:id,operation_id:`${topic}-fold-${on}`,args:{folded:on}});
      await fold(true);
      await until(()=>p.evaluate(`document.querySelector(${JSON.stringify(card(id))}).dataset.folded==='true'`),'the fold from another device reaches the page'); await settled(p);
      await keyTo(p,ids.two);
      await p.evaluate(`(c=>scrollBy(0,c.getBoundingClientRect().bottom-(innerHeight-260)))(document.querySelector(${JSON.stringify(card(ids.two))}))`);
      await p.evaluate('window.motionFrames=[]');
      await fold(false);
      await p.evaluate(`new Promise(done=>{const look=()=>{const c=document.querySelector(${JSON.stringify(card(id))});
        if(c?.dataset.stackMotion==='unfold'&&c.getBoundingClientRect().height<${full}*.6)done();else requestAnimationFrame(look)};look()})`);
      await p.key('ArrowDown');
      const keyed=await p.evaluate(`[document.querySelector(${JSON.stringify(card(id))}).dataset.stackMotion??null,window.motionClock,document.querySelector('#messages .message-card.lit')?.dataset.id??null]`);
      assert.deepEqual([keyed[0],keyed[2]],['unfold',id],'ArrowDown lit the reply while it was still unfolding');
      await settled(p);
      const box=await p.evaluate(`(r=>({top:r.top,bottom:r.bottom,height:r.height,screen:innerHeight}))(document.querySelector(${JSON.stringify(card(id))}).getBoundingClientRect())`);
      assert.ok(Math.abs(box.height-full)<1.1&&box.height<box.screen*.8,`the reply unfolded whole and fits the screen with room: ${JSON.stringify({full,...box})}`);
      assert.ok(box.top>=0&&box.bottom<=box.screen,`the lit reply shows whole once it unfolds: ${JSON.stringify(box)}`);
      assert.ok(box.bottom>=box.screen*.75,`the page scrolled no further than to show it: ${JSON.stringify(box)}`);
      assert.ok((await frames(p,id,'unfold')).some(f=>f.clock>keyed[1]&&f.height<full-2),'the keys do not cut the unfold short');
    });
  });

  // Low on a short page the window cannot yet scroll to where a reply still
  // moving lands: its folder is shorter in flight. The keys still reveal it
  // as the still page (reduced motion) does, once, and it keeps moving there.
  const long = width => 'A long live reply.\n\n'+'The boundary follows this moving edge. '.repeat(width>=1280?32:width<=320?20:24);
  const atEnd = async (ctx, kind, start, still) => {
    const {p,ids}=ctx;
    await keyTo(p,ids.two);
    const low=await p.evaluate(`(c=>(scrollBy(0,c.getBoundingClientRect().bottom-(innerHeight-260)),{bottom:c.getBoundingClientRect().bottom,screen:innerHeight,y:scrollY,max:document.scrollingElement.scrollHeight-innerHeight}))(document.querySelector(${JSON.stringify(card(ids.two))}))`);
    assert.ok(low.bottom>0&&low.bottom<low.screen-40,`the dossier's last reply shows low on the screen: ${JSON.stringify(low)}`);
    if (still) await p.send('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]});
    await p.evaluate('window.motionFrames=[]');
    const id=await start();
    // The key goes on the page's own frame that shows the reply early in its
    // motion (or, still, drawn); a reply drawn still ends the wait as well.
    const early=await p.evaluate(`new Promise(done=>{const look=()=>{const c=document.querySelector(${JSON.stringify(card(id))}),e=c?.closest('.stack-replies > [data-id]'),o=e&&+getComputedStyle(e).opacity;
      if(c?.dataset.stackMotion===${JSON.stringify(kind)}&&(${JSON.stringify(kind)}!=='arrival'||o>.02&&o<.6))done(true);
      else if(c&&!c.dataset.stackMotion&&c.dataset.folded!=='true')done({still:true,opacity:o});else requestAnimationFrame(look)};look()})`);
    assert.ok(still?early?.still===true&&!(early.opacity<1):early===true,`the reply is ${still?'drawn still':'early in its '+kind} when the key goes: ${JSON.stringify(early)}`);
    const before=await p.evaluate(`(()=>{const c=document.querySelector(${JSON.stringify(card(id))});return {height:c.getBoundingClientRect().height,y:scrollY,max:document.scrollingElement.scrollHeight-innerHeight}})()`);
    await p.key('ArrowDown');
    const keyed=await p.evaluate(`[document.querySelector(${JSON.stringify(card(id))}).dataset.stackMotion??null,window.motionClock,document.querySelector('#messages .message-card.lit')?.dataset.id??null,scrollY]`);
    assert.deepEqual([keyed[0],keyed[2]],[still?null:kind,id],`ArrowDown lit the reply ${still?'drawn still':'while it was still moving ('+kind+')'}`);
    await settled(p);
    await p.evaluate('new Promise(done=>requestAnimationFrame(()=>requestAnimationFrame(done)))');
    const box=await p.evaluate(`(r=>({top:r.top,bottom:r.bottom,height:r.height,screen:innerHeight,y:scrollY,minHeight:document.documentElement.style.minHeight}))(document.querySelector(${JSON.stringify(card(id))}).getBoundingClientRect())`);
    const seen={before,keyed:keyed[3],...box};
    assert.ok(box.height<box.screen*.95,`the reply fits the screen: ${JSON.stringify(seen)}`);
    assert.ok(box.top>=0&&box.bottom<=box.screen,`the lit reply shows whole once it lands: ${JSON.stringify(seen)}`);
    if (still) { assert.deepEqual(await p.evaluate('window.motionFrames'),[],'the still page runs no motion'); return seen; }
    assert.equal(box.y,keyed[3],'the page scrolled once, at the key, and stayed while it landed');
    assert.equal(box.minHeight,'','the length the motion held goes with it');
    assert.ok((await frames(p,id,kind)).some(f=>f.clock>keyed[1]&&(kind==='arrival'?f.transform!=='none':f.height<before.height+(box.height-before.height)*.9)),'the keys do not cut its motion short');
    return seen;
  };
  // Each width runs still first, then moving, on topics of the same shape.
  const asStill = async (label, run) => {
    const seen = {};
    for (const still of [true,false]) await atWidths(label+(still?'-still':''),async ctx=>{ (seen[ctx.width]??={})[still?'still':'moving']=await run(ctx,still); });
    for (const [width,{still,moving}] of Object.entries(seen))
      assert.ok(Math.abs(moving.bottom-still.bottom)<=1&&Math.abs(moving.top-still.top)<=1,`at ${width} the moving reply lands where the still page shows it: ${JSON.stringify({still,moving})}`);
  };
  await check('reading dossier motion the keys onto a long reply arriving low on a short page reveal it as the still page does at 320 375 390 and laptop', async()=>{
    await asStill('keys-end',(ctx,still)=>atEnd(ctx,'arrival',async()=>
      (await control({method:'agent_message',operation_id:ctx.topic+'-long',topic_id:ctx.topic,source:'topic',sender:'aim-core',reply_to:ctx.ids.root,addressees:[facts.actor],body:long(ctx.width)})).result.message_id,still));
  });
  await check('reading dossier motion the keys onto a long reply unfolding low on a short page reveal it as the still page does at 320 375 390 and laptop', async()=>{
    await asStill('keys-end-unfold',async(ctx,still)=>{
      const {p,topic,ids}=ctx;
      const id=(await control({method:'agent_message',operation_id:topic+'-long',topic_id:topic,source:'topic',sender:'aim-core',reply_to:ids.root,addressees:[facts.actor],body:long(ctx.width)})).result.message_id;
      await until(()=>p.evaluate(`Boolean(document.querySelector(${JSON.stringify(card(id))}))`),'the long reply is drawn'); await settled(p);
      const fold=on=>control({method:'stack_act',sender:facts.actor,kind:'message.fold',message_id:id,operation_id:`${topic}-fold-${on}`,args:{folded:on}});
      await fold(true);
      await until(()=>p.evaluate(`document.querySelector(${JSON.stringify(card(id))}).dataset.folded==='true'`),'the fold from another device reaches the page'); await settled(p);
      return atEnd(ctx,'unfold',async()=>(await fold(false),id),still);
    });
  });

  // What the person is writing below a dossier stays where it is: a reply
  // arriving above it lands in its natural place, with no travel.
  const holds = async (ctx, opener, field) => {
    const {p,ids,topic,device}=ctx;
    if (opener) { await centre(p,opener); await press(p,device,opener); }
    else { await centre(p,field); await press(p,device,field); }
    await until(()=>p.evaluate(`document.activeElement===document.querySelector(${JSON.stringify(field)})`),'the caret is in the field');
    await p.evaluate(`(f=>scrollBy(0,f.getBoundingClientRect().top-(innerHeight-90)))(document.querySelector(${JSON.stringify(field)}))`);
    const slot=await p.evaluate(`document.querySelector(${JSON.stringify(card(ids.two))}).getBoundingClientRect().bottom`);
    const at=await p.evaluate(`(f=>{const top=f.getBoundingClientRect().top;window.fieldTops=[];window.fieldSampling=true;
      const tick=()=>{window.fieldTops.push(f.getBoundingClientRect().top);if(window.fieldSampling)requestAnimationFrame(tick)};requestAnimationFrame(tick);return {top,screen:innerHeight}})(document.querySelector(${JSON.stringify(field)}))`);
    assert.ok(slot>0&&slot<at.top&&at.top<at.screen-40,`the dossier's end shows above the field, low on the screen: ${JSON.stringify({slot,...at})}`);
    const id=await add(ctx,'held');
    await until(()=>p.evaluate(`Boolean(document.querySelector(${JSON.stringify(card(id))}))`),'the live reply is drawn');
    await settled(p);
    await p.evaluate('new Promise(done=>requestAnimationFrame(()=>requestAnimationFrame(done)))');
    const tops=await p.evaluate('(window.fieldSampling=false,window.fieldTops)');
    const shown=await p.evaluate(`(r=>r.bottom>0&&r.top<innerHeight)(document.querySelector(${JSON.stringify(card(id))}).getBoundingClientRect())`);
    assert.equal(shown,true,'the new reply landed on the screen, where it could have travelled');
    assert.ok(tops.length>2&&tops.every(top=>Math.abs(top-at.top)<=1),`the field holds still in every frame: ${JSON.stringify({at:at.top,low:Math.min(...tops),high:Math.max(...tops)})}`);
    assert.deepEqual(await frames(p,id,'arrival'),[],'a reply above the writing does not travel');
    assert.equal(await p.evaluate(`document.activeElement===document.querySelector(${JSON.stringify(field)})`),true,'the caret stays in the field');
  };
  await check('reading dossier motion writing below an arriving reply holds still: the People field at 320 375 390 and laptop', async()=>{
    await atWidths('held-people',ctx=>holds(ctx,'#participants .add-chip','#participants .people-add input'));
  });
  await check('reading dossier motion writing below an arriving reply holds still: a new message at 320 375 390 and laptop', async()=>{
    await atWidths('held-writing',ctx=>holds(ctx,null,'#inline-writing-body'));
  });

  await check('reading dossier motion a burst shares its moving floor and an off-screen batch stays natural', async()=>{
    await atWidths('burst',async ctx=>{
      const {p,ids,topic,width}=ctx;
      await keyTo(p,ids.two);
      const floor=await p.evaluate(`document.querySelector(${JSON.stringify(card(ids.root))}).closest('.reply-stack').querySelector('.stack-replies').getBoundingClientRect().height`);
      const burst=async(count,label)=>{
        await p.evaluate("window.waitView='topic_messages'");
        const added=[];
        for(let i=0;i<count;i++)added.push((await control({method:'agent_message',operation_id:`${topic}-${label}-${i}`,topic_id:topic,source:'topic',sender:'aim-core',reply_to:ids.root,addressees:[facts.actor],body:`${label} short live reply ${i}.`})).result.message_id);
        await p.evaluate('window.letViews()');
        await until(()=>p.evaluate(`Boolean(document.querySelector(${JSON.stringify(card(added.at(-1)))}))`),'the whole committed batch reaches the real page');
        return added;
      };
      const added=await burst(2,'visible');
      await keyTo(p,added[1]);
      await until(async()=>(await frames(p,added[1],'arrival')).length>2,'both visible faces share a landing'); await settled(p);
      const samples=await p.evaluate(`window.motionFrames.filter(f=>${JSON.stringify(added)}.includes(f.id))`),groups=new Map();
      for(const sample of samples){if(!groups.has(sample.clock))groups.set(sample.clock,[]);groups.get(sample.clock).push(sample);}
      const together=[...groups.values()].filter(group=>group.length===2);
      assert.ok(together.length>2,'both faces were measured in the same native frames');
      const attached=samples.filter(f=>f.id===added[1]&&f.barId===added[1]&&Math.abs(f.floor-floor)<1.1&&f.top>Math.max(4,(f.tabBottom||0)+2)+f.barHeight/2+2);
      assert.ok(attached.length>1,'a selected short face travels below the tab before contact');
      assert.ok(attached.every(f=>Math.abs(f.barTop-(f.top-f.barHeight/2))<1.1),'the existing message bar follows the incoming face before folder growth');
      assert.ok(together.every(group=>group.every(f=>Math.abs(f.floor-Math.max(floor,...group.map(g=>g.edge)))<1.1)),'one boundary follows the lowest travelling edge');
      await centre(p,card(added[1])); await p.evaluate('window.motionFrames=[]');
      const many=await burst(10,'offscreen');
      await p.evaluate('new Promise(done=>requestAnimationFrame(()=>requestAnimationFrame(()=>setTimeout(done,0))))');
      assert.deepEqual(await p.evaluate('window.motionFrames'),[],'a batch extending off screen uses natural layout together');
      assert.equal(await p.evaluate(`document.querySelector(${JSON.stringify(card(many[0]))}).closest('.stack-replies').style.height`),'');
      observations.push({name:'motion-burst-'+width,samples});
    });
  });

}

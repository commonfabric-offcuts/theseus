// Item 412: sample real frames of the real feed; actions go through native
// menus, keys or touches and fixture commands commit to isolated Core records.
import assert from 'node:assert/strict';
const PROBE = `window.motionFrames=[];window.motionClock=0;
addEventListener('DOMContentLoaded',()=>{const sample=()=>{window.motionClock++;
for(const c of document.querySelectorAll('#messages .message-card[data-stack-motion]')){
 const e=c.closest('.message-fold')||c,s=c.closest('.reply-stack'),r=s?.querySelector('.stack-replies');
 const prior=[...r?.querySelectorAll(':scope>[data-id]')||[]].find(n=>n.dataset.id!==c.dataset.id&&!n.hidden);
 const b=e.getBoundingClientRect(),q=r?.getBoundingClientRect(),a=c.querySelector(':scope>.message-author');
 const authors=[...c.querySelectorAll(':scope>.message-author,:scope>.message-folded')].filter(n=>getComputedStyle(n).display!=='none'&&getComputedStyle(n).visibility!=='hidden');
 window.motionFrames.push({clock:window.motionClock,id:c.dataset.id,kind:c.dataset.stackMotion,top:b.top,bottom:b.bottom,height:b.height,
 opacity:+getComputedStyle(e).opacity,transform:getComputedStyle(e).transform,edge:b.bottom-(q?.top||0),floor:q?.height,
 authors:authors.length,authorOffset:a?a.getBoundingClientRect().top-b.top:null,authorOpacity:a?+getComputedStyle(a).opacity:1,sectionBottom:s?.getBoundingClientRect().bottom,
 priorTop:prior?.getBoundingClientRect().top,animations:e.getAnimations().length+c.getAnimations().length});}
 };const tick=()=>{setTimeout(sample,0);requestAnimationFrame(tick)};requestAnimationFrame(tick)});`;

export async function motionChecks({ check, until, view, control, shot, facts, observations }, h) {
  const { seed, open, centre, press, card, DEVICES, menuOf, choose } = h;
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
    await menuOf(ctx.p,ctx.device,ctx.ids.one); await choose(ctx.p,ctx.device,'Fold message');
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
      observations['motion-arrival-'+width]={old,samples}; await shot(p,'motion-arrival-'+width);
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
      const surface=await p.evaluate(`(()=>{const c=document.querySelector(${JSON.stringify(card(ids.one))}),n=c.parentElement.querySelector(${JSON.stringify(card(ids.two))}),b=c.getBoundingClientRect(),z=n.getBoundingClientRect();return {folded:c.dataset.folded,exposed:z.top-b.top,words:getComputedStyle(c.querySelector('.folded-words')).opacity,hit:c.contains(document.elementFromPoint(b.left+b.width/2,b.top+22))}})()`);
      assert.equal(surface.folded,'true'); assert.equal(surface.words,'1');
      if(width<760){assert.ok(surface.exposed>=43.9,'44px phone strip remains exposed');assert.equal(surface.hit,true);}
      observations['motion-fold-'+width]={surface,samples}; await shot(p,'motion-fold-'+width);
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
      observations['motion-unfold-'+width]=samples; await shot(p,'motion-unfold-'+width);
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
      await until(async()=>(await frames(p,id,'arrival')).some(f=>f.opacity>.1&&f.opacity<.8),'the arrival is mid-flight');
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
      await settled(p);
      assert.deepEqual(await p.evaluate(`(()=>{const c=document.querySelector(${JSON.stringify(card(id))}),r=c.closest('.stack-replies');return [c.style.transform,c.style.opacity,r.style.height,c.getAnimations().length]})()`),['','','',0]);
      const next=await add(ctx,'successor'); await until(async()=>(await frames(p,next,'arrival')).length>2,'successor can animate after cancellation'); await settled(p);
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

}

// Item 412: sample real frames of the real feed; actions go through native
// menus, keys or touches and fixture commands commit to isolated Core records.
import assert from 'node:assert/strict';
// Frames are sampled after each animation frame, and also once as an arrival
// starts: its first pose is set in the same task that marks it, so the face
// is read above the old floor even when a slow engine paints no frame before
// contact.
const PROBE = `window.motionFrames=[];window.motionClock=0;
addEventListener('DOMContentLoaded',()=>{const sample=only=>{window.motionClock++;
for(const c of document.querySelectorAll('#messages .message-card[data-stack-motion]')){if(only&&c.dataset.stackMotion!==only)continue;
 const e=c.closest('.message-fold')||c,s=c.closest('.reply-stack'),r=s?.querySelector('.stack-replies');
 const prior=[...r?.querySelectorAll(':scope>[data-id]')||[]].find(n=>n.dataset.id!==c.dataset.id&&!n.hidden);
 const bar=document.querySelector('.message-bar'),barBox=bar?.getBoundingClientRect(),tab=s?.querySelector(':scope>[data-id] .stack-head')?.getBoundingClientRect();
 const b=e.getBoundingClientRect(),q=r?.getBoundingClientRect(),a=c.querySelector(':scope>.message-author');
 const authors=[...c.querySelectorAll(':scope>.message-author,:scope>.message-folded')].filter(n=>getComputedStyle(n).display!=='none'&&getComputedStyle(n).visibility!=='hidden');
 window.motionFrames.push({clock:window.motionClock,id:c.dataset.id,kind:c.dataset.stackMotion,top:b.top,bottom:b.bottom,height:b.height,
 opacity:+getComputedStyle(e).opacity,transform:getComputedStyle(e).transform,edge:b.bottom-(q?.top||0),floor:q?.height,
 authors:authors.length,authorOffset:a?a.getBoundingClientRect().top-b.top:null,authorOpacity:a?+getComputedStyle(a).opacity:1,sectionBottom:s?.getBoundingClientRect().bottom,
 priorTop:prior?.getBoundingClientRect().top,barId:document.querySelector('#messages .message-card.lit')?.dataset.id,barTop:barBox?.top,barHeight:barBox?.height,tabBottom:tab?.bottom,animations:e.getAnimations().length+c.getAnimations().length});}
 };new MutationObserver(records=>{if(records.some(m=>m.target.matches('.message-card[data-stack-motion=arrival]')))sample('arrival')})
 .observe(document.documentElement,{subtree:true,attributes:true,attributeFilter:['data-stack-motion']});
 const tick=()=>{setTimeout(sample,0);requestAnimationFrame(tick)};requestAnimationFrame(tick)});`;

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
  const add = async ({topic,ids}, label='new', body='A new live reply.\n\n'+('The boundary follows this moving edge. '.repeat(9))) => (await control({method:'agent_message',operation_id:topic+'-'+label,topic_id:topic,source:'topic',sender:'aim-core',reply_to:ids.root,addressees:[facts.actor],body})).result.message_id;
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
  // Item 412, Tony's rule: during a slide, presses are ignored. A press on the
  // face still arriving reaches neither it nor what it passes over, and once
  // it lands it takes a press as any card does. Holding the press pauses it,
  // and the pointer moving onto it does not light it.
  await check('reading dossier motion a press on a reply still sliding in does nothing, and once landed it takes the press', async()=>{
    await atWidths('slide-press',async ctx=>{
      const {p,device}=ctx, id=await add(ctx), sel=JSON.stringify(card(id));
      await p.evaluate(`(()=>{window.slidePresses=[];for(const name of ['pointerdown','pointerup','mousedown','mouseup','click','focusin','pointermove'])document.addEventListener(name,()=>slidePresses.push(name),true)})()`);
      await until(()=>p.evaluate(`(()=>{const c=document.querySelector(${sel});return c?.dataset.stackMotion==='arrival'&&+getComputedStyle(c).opacity>.1&&+getComputedStyle(c).opacity<.5})()`),'the arrival is early in its flight');
      const state=()=>p.evaluate(`(()=>{const c=document.querySelector(${sel});return {lit:document.querySelector('#messages .message-card.lit')?.dataset.id??null,reader:document.querySelector('#reader').open,focus:document.activeElement?.closest?.('[data-id]')?.dataset.id??null,motion:c.dataset.stackMotion??null}})()`);
      const before=await state();
      const {x,y,under}=await p.evaluate(`(()=>{const c=document.querySelector(${sel}),r=c.getBoundingClientRect(),top=Math.max(r.top,0),bottom=Math.min(r.bottom,innerHeight),x=r.left+Math.min(24,r.width/2),y=(top+bottom)/2;
        return {x,y,on:c.contains(document.elementFromPoint(x,y)),under:document.elementsFromPoint(x,y).find(e=>!c.contains(e))?.closest('[data-id]')?.dataset.id??null}})()`).then(at=>{assert.ok(at.on,'the sliding face is what the point hits');return at;});
      if (device==='phone') { await p.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x,y}]}); await p.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]}); }
      else {
        // The pointer moves across the face before it presses, as a hand does.
        await p.send('Input.dispatchMouseEvent',{type:'mouseMoved',x:x-8,y});
        await p.send('Input.dispatchMouseEvent',{type:'mouseMoved',x,y});
        await p.send('Input.dispatchMouseEvent',{type:'mousePressed',x,y,button:'left',clickCount:1});
        const look=()=>p.evaluate(`(()=>{const c=document.querySelector(${sel}),r=c.getBoundingClientRect();return [r.top,r.bottom,getComputedStyle(c).transform,getComputedStyle(c).opacity]})()`);
        const held=await look();
        await p.evaluate(`new Promise(done=>{const start=performance.now();const tick=()=>performance.now()-start>170?done():requestAnimationFrame(tick);requestAnimationFrame(tick)})`);
        assert.deepEqual(await look(),held,'a press held on the sliding face pauses it, as any held press does');
        await p.send('Input.dispatchMouseEvent',{type:'mouseReleased',x,y,button:'left',clickCount:1});
      }
      assert.equal((await state()).motion,'arrival','the press fell while the reply was still sliding in');
      await settled(p);
      assert.deepEqual(await p.evaluate('window.slidePresses'),[],`no part of the press reached the page, neither the face nor ${under??'what it passes over'}`);
      assert.deepEqual({...await state(),motion:null},{...before,motion:null},'nothing was lit, focused or opened by the pointer or the press');
      await press(p,device,card(id));
      await until(async()=>{const now=await state();return now.lit===id||now.reader;},'the landed reply takes a press');
      assert.ok((await p.evaluate('window.slidePresses')).includes('click'),'the landed press reaches the page');
    });
  });
  // What of a press reaches the page, as the page's own listeners hear it.
  const listen = p => p.evaluate(`(()=>{window.heard=[];if(window.listening)return;window.listening=true;for(const name of ['pointerdown','pointerup','pointercancel','mousedown','mouseup','click','dblclick','auxclick','contextmenu','focusin','selectstart','dragstart'])document.addEventListener(name,()=>heard.push(name),true)})()`);
  const heard = p => p.evaluate('window.heard');
  const motionOf = (p,sel) => p.evaluate(`document.querySelector(${sel})?.dataset.stackMotion??null`);
  const early = (p,sel) => until(()=>p.evaluate(`(()=>{const c=document.querySelector(${sel});return c?.dataset.stackMotion==='arrival'&&+getComputedStyle(c).opacity>.1&&+getComputedStyle(c).opacity<.5})()`),'the arrival is early in its flight');
  // A reply early in its slide, and a point on its face.
  const sliding = async (ctx,label,body) => {
    const {p}=ctx, id=await add(ctx,label,body), sel=JSON.stringify(card(id));
    await early(p,sel);
    const at=await p.evaluate(`(()=>{const c=document.querySelector(${sel}),r=c.getBoundingClientRect(),top=Math.max(r.top,0),bottom=Math.min(r.bottom,innerHeight),x=r.left+Math.min(24,r.width/2),y=(top+bottom)/2;return {x,y,on:c.contains(document.elementFromPoint(x,y))}})()`);
    assert.ok(at.on,'the sliding face is what the point hits');
    return {id,sel,x:at.x,y:at.y};
  };
  const mouse = (p,type,x,y,button='left',buttons=0) => p.send('Input.dispatchMouseEvent',{type,x,y,button,buttons,clickCount:1});
  const tap = async (p,device,x,y,button='left') => {
    if (device==='phone') { await p.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x,y}]}); await p.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]}); return; }
    await mouse(p,'mousePressed',x,y,button,button==='left'?1:2); await mouse(p,'mouseReleased',x,y,button);
  };
  const drawn = (p,id) => p.evaluate(`Boolean(document.querySelector(${JSON.stringify(card(id))}))`);
  await check('reading dossier motion after a press falls on a sliding reply, a script click, the keys and the pointer act as before', async()=>{
    await atWidths('slide-after',async ctx=>{
      const {p}=ctx;
      await p.evaluate(`(()=>{const b=document.createElement('button');b.id='after-press';b.textContent='After';b.style.cssText='position:fixed;left:0;bottom:0;z-index:99';window.afterClicks=[];b.addEventListener('click',e=>afterClicks.push(e.isTrusted));document.body.append(b)})()`);
      const s=await sliding(ctx,'after'); await tap(p,'laptop',s.x,s.y);
      assert.equal(await motionOf(p,s.sel),'arrival','the press fell while the reply was still sliding in');
      await p.evaluate(`document.getElementById('after-press').click()`);
      assert.deepEqual(await p.evaluate('window.afterClicks'),[false],"a script's click still reaches the page");
      await p.evaluate(`document.getElementById('after-press').focus()`); await p.key('Enter');
      assert.deepEqual(await p.evaluate('window.afterClicks'),[false,true],'Enter on a focused button still presses it');
      await settled(p); await centre(p,card(s.id));
      const b=await p.box(card(s.id)), x=b.x+Math.min(24,b.width/2), y=b.y+b.height/2;
      await mouse(p,'mouseMoved',x,Math.max(1,b.y-30)); await mouse(p,'mouseMoved',x,y);
      await until(()=>p.evaluate(`document.querySelector('#messages .message-card.lit')?.dataset.id===${JSON.stringify(s.id)}`),'the landed reply lights under the pointer');
    },[1280]);
  });
  await check('reading dossier motion a press begun elsewhere and released over a reply still sliding in is heard whole and holds nothing after', async()=>{
    await atWidths('slide-elsewhere',async ctx=>{
      const {p}=ctx, s=await sliding(ctx,'elsewhere'); await listen(p);
      const b=await p.box('#topic-title'), x=b.x+10, y=b.y+b.height/2;
      await mouse(p,'mousePressed',x,y,'left',1);
      for (const f of [.33,.66,1]) await mouse(p,'mouseMoved',x+(s.x-x)*f,y+(s.y-y)*f,'left',1);
      await mouse(p,'mouseReleased',s.x,s.y);
      assert.equal(await motionOf(p,s.sel),'arrival','the release fell while the reply was still sliding in');
      const h=await heard(p);
      assert.ok(h.includes('pointerdown')&&h.includes('pointerup'),'the page hears both ends of a press begun elsewhere');
      await settled(p);
      // A press left held would hold back every later live message.
      const next=await add(ctx,'elsewhere-next');
      await until(()=>drawn(p,next),'the next live message is drawn: no press is left held');
      await settled(p);
    },[1280]);
  });
  await check('reading dossier motion a right press on a reply still sliding in opens nothing, and once landed it reaches the page', async()=>{
    await atWidths('slide-right',async ctx=>{
      const {p}=ctx, menu=()=>p.evaluate(`Boolean(document.querySelector('.message-menu-list'))`);
      const s=await sliding(ctx,'right'); await listen(p);
      await tap(p,'laptop',s.x,s.y,'right');
      assert.equal(await motionOf(p,s.sel),'arrival','the right press fell while the reply was still sliding in');
      assert.deepEqual(await heard(p),[],'no part of the right press reached the page');
      assert.equal(await menu(),false,'no message menu opened');
      await settled(p); await centre(p,card(s.id));
      const b=await p.box(card(s.id)); await listen(p);
      await tap(p,'laptop',b.x+Math.min(24,b.width/2),b.y+b.height/2,'right');
      assert.ok((await heard(p)).includes('contextmenu'),'a right press on the landed reply reaches the page');
      if (await menu()) { await p.key('Escape'); await until(async()=>!await menu(),'the menu closes'); }
    },[1280]);
  });
  await check('reading dossier motion a drag begun on a reply still sliding in selects nothing', async()=>{
    await atWidths('slide-drag',async ctx=>{
      const {p}=ctx, s=await sliding(ctx,'drag'); await listen(p); await p.evaluate('getSelection().removeAllRanges()');
      await mouse(p,'mousePressed',s.x,s.y,'left',1);
      for (const dx of [40,80,160]) await mouse(p,'mouseMoved',s.x+dx,s.y+6,'left',1);
      await mouse(p,'mouseReleased',s.x+160,s.y+6);
      assert.equal(await motionOf(p,s.sel),'arrival','the drag ended while the reply was still sliding in');
      assert.equal(await p.evaluate('getSelection().toString()'),'','a drag begun on the sliding face selects no text');
      assert.deepEqual(await heard(p),[],'nothing of the drag reached the page');
      await settled(p);
    },[1280]);
  });
  await check('reading dossier motion a press held on a reply still sliding in holds back the next live message until release', async()=>{
    await atWidths('slide-hold',async ctx=>{
      const {p}=ctx, s=await sliding(ctx,'first'); await listen(p);
      await mouse(p,'mousePressed',s.x,s.y,'left',1);
      const words='A second live reply, sent while a press is held on the first.';
      await p.evaluate(`(window.watched=false,window.watchFor=${JSON.stringify({read:'topic_messages',words})})`);
      const next=await add(ctx,'second',words);
      await until(()=>p.evaluate('window.watched'),'the page has read the next message while the press is held');
      await p.evaluate('new Promise(done=>requestAnimationFrame(()=>requestAnimationFrame(done)))');
      assert.equal(await drawn(p,next),false,'a press held on the sliding face holds back the next live message, as any held press does');
      await mouse(p,'mouseReleased',s.x,s.y);
      await until(()=>drawn(p,next),'released, the next message is drawn');
      assert.deepEqual(await heard(p),[],'nothing of the held press reached the page');
      await settled(p);
    },[1280]);
  });
  // A fence's Copy is drawn over its card from a layer of its own; it belongs
  // to the card it sits on.
  await check('reading dossier motion a press on the Copy of a code block on a reply still sliding in does nothing, and once landed it takes the press', async()=>{
    await atWidths('slide-fence',async ctx=>{
      const {p,device}=ctx;
      const id=await add(ctx,'fence','A reply with code.\n\n```\nconst copied = true;\nline two\nline three\n```\n\nAfter the code. '+'More words follow the code here. '.repeat(6));
      const sel=JSON.stringify(card(id)), copy=`[...document.querySelectorAll('.feed-fence-copy')].find(b=>b.dataset.message===${JSON.stringify(id)})`;
      // The layer places its Copy on the frame after the card moves or the
      // page scrolls; it is aimed at once it sits on its fence.
      const fence=card(id)+' .feed-fence-anchor';
      const at=()=>p.evaluate(`(()=>{const c=${copy},a=document.querySelector(${JSON.stringify(fence)});if(!c||c.hidden||!a)return null;const r=c.getBoundingClientRect(),x=r.x+r.width/2,y=r.y+r.height/2;return {x,y,on:Math.abs(r.top-a.getBoundingClientRect().top)<1.5&&c.contains(document.elementFromPoint(x,y))}})()`);
      // A mouse shows the Copy by passing over its fence; a touch screen always shows it.
      const over=async()=>{ if(device==='phone')return; const b=await p.box(fence); await mouse(p,'mouseMoved',b.x+b.width/2,b.y+b.height/2); };
      await early(p,sel); await over();
      let point=null;
      await until(async()=>(point=await at())?.on||await motionOf(p,sel)!=='arrival','the Copy of the sliding face is placed');
      assert.ok(point?.on,'the Copy of the sliding face is shown and is what the point hits');
      // The page draws the Copy afresh when the card lands, so its clicks are
      // heard on the document, and stop there to leave the clipboard alone.
      await listen(p); await p.evaluate(`(()=>{window.copies=[];document.addEventListener('click',e=>{if(e.target.closest?.('.feed-fence-copy')?.dataset.message===${JSON.stringify(id)}){copies.push(e.isTrusted);e.stopImmediatePropagation()}},true)})()`);
      await tap(p,device,point.x,point.y);
      assert.equal(await motionOf(p,sel),'arrival','the press fell while the reply was still sliding in');
      await settled(p);
      assert.deepEqual(await p.evaluate('window.copies'),[],'a press on the Copy of a code block on a sliding face does nothing');
      assert.deepEqual(await heard(p),[],'no part of the press reached the page');
      await centre(p,card(id)); await over();
      let landed=null;
      await until(async()=>(landed=await at())?.on,'the landed Copy is shown on its fence and is what the point hits');
      await tap(p,device,landed.x,landed.y);
      await until(()=>p.evaluate('window.copies.length===1'),'the landed Copy takes the press');
    },[375,1280]);
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
    // A cut-off reply the keys lit reads its whole words in place once they come (card-scroll.mjs):
    // the still page and the moving one are compared once that read has landed, however long it takes.
    await until(()=>p.evaluate(`(c=>!c.querySelector(':scope > .message-preview-cue')||c.dataset.whole==='shown')(document.querySelector(${JSON.stringify(card(id))}))`),'a cut-off reply the keys lit reads on in place');
    await p.evaluate('new Promise(done=>requestAnimationFrame(()=>requestAnimationFrame(done)))');
    const box=await p.evaluate(`(c=>(r=>({top:r.top,bottom:r.bottom,height:r.height,screen:innerHeight,y:scrollY,minHeight:document.documentElement.style.minHeight,inPlace:c.classList.contains('scroll-in-place'),maxHeight:c.style.maxHeight}))(c.getBoundingClientRect()))(document.querySelector(${JSON.stringify(card(id))}))`);
    const seen={before,keyed:keyed[3],...box};
    assert.ok(box.height<box.screen*.95,`the reply fits the screen: ${JSON.stringify(seen)}`);
    assert.ok(box.top>=0&&box.bottom<=box.screen,`the lit reply shows whole once it lands: ${JSON.stringify(seen)}`);
    if (still) { assert.deepEqual(await p.evaluate('window.motionFrames'),[],'the still page runs no motion'); return seen; }
    assert.equal(box.y,keyed[3],'the page scrolled once, at the key, and stayed while it landed');
    assert.equal(box.minHeight,'','the length the motion held goes with it');
    // A cut-off message's whole words, read in once the keys light it, are a
    // changed body: they end its motion (a laptop here). Otherwise it keeps moving.
    if (!box.inPlace) assert.ok((await frames(p,id,kind)).some(f=>f.clock>keyed[1]&&(kind==='arrival'?f.transform!=='none':f.height<before.height+(box.height-before.height)*.9)),'the keys do not cut its motion short');
    return seen;
  };
  // Each width runs still first, then moving, on topics of the same shape. Their
  // titles may wrap apart on a phone, so the page's scroll differs; the screen does not.
  const asStill = async (label, run) => {
    const seen = {};
    for (const still of [true,false]) await atWidths(label+(still?'-still':''),async ctx=>{ (seen[ctx.width]??={})[still?'still':'moving']=await run(ctx,still); });
    for (const [width,{still,moving}] of Object.entries(seen))
      assert.ok(['top','bottom','height'].every(k=>Math.abs(moving[k]-still[k])<=1)&&moving.inPlace===still.inPlace&&moving.maxHeight===still.maxHeight,
        `at ${width} the moving reply lands where and as the still page shows it: ${JSON.stringify({still,moving})}`);
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

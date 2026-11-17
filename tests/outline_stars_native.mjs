import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

const WIDTHS = [320, 375, 390, 1280];
// Measured geometry tolerances: 2px absorbs engine rounding but cannot hide a
// missing 12px indent, a 36px touch target, or a row wider than its parent.
const GEOMETRY_TOLERANCE_PX = 2;
const TOUCH_TARGET_TOLERANCE_PX = 0.75;
const row = id => `#outline .ol-dossier[data-dossier-id="${id}"]`;

export async function item715Checks({check, page, until, control, facts, shot}) {
  const press = async (p, selector, width) => {
    await p.evaluate(`document.querySelector(${JSON.stringify(selector)}).scrollIntoView({block:'nearest'})`);
    if (width === 1280) return p.point(selector);
    const b = await p.box(selector), x = b.x+b.width/2, y=b.y+b.height/2;
    assert.equal(await p.evaluate(`document.querySelector(${JSON.stringify(selector)}).contains(document.elementFromPoint(${x},${y}))`), true, 'native touch reaches the intended row');
    await p.send('Input.dispatchTouchEvent', {type:'touchStart',touchPoints:[{x,y}]});
    await p.send('Input.dispatchTouchEvent', {type:'touchEnd',touchPoints:[]});
  };
  const up = async (seed, width, theme, label) => {
    const p = await page(label, null, true, {url: facts.origin+'/?topic='+seed.topic, beforeNavigate: async p => {
      await p.send('Emulation.setEmulatedMedia', {features:[{name:'prefers-color-scheme',value:theme}]});
      await p.send('Emulation.setDeviceMetricsOverride', {width,height:900,deviceScaleFactor:1,mobile:width!==1280});
      if(width!==1280) await p.send('Emulation.setTouchEmulationEnabled',{enabled:true,maxTouchPoints:1});
    }});
    await until(()=>p.evaluate(`Boolean(document.querySelector('#outline a[data-topic-id="${seed.topic}"]')) && !document.documentElement.hasAttribute('data-rails-reading')`), 'the actual parent topic has loaded');
    if(width!==1280) await press(p,'#rail-open',width);
    await shot(p, label+'-initial'); // actual unmodified baseline, even while the feature is absent
    return p;
  };
  const loaded = (p, seed) => until(()=>p.evaluate(`document.querySelector('#outline .ol-dossiers[data-parent-topic-id="${seed.topic}"]')?.dataset.loaded==='true'`), 'the scoped starred dossier read has settled under its parent');
  const act = async (seed, root, kind, args, prefix) => {
    const answer = await control({method:'item715_act',operation_id:prefix+'-'+randomUUID(),message_id:root,kind,args});
    assert.equal(answer.status,'committed','fixture act actually committed');
  };
  for(const width of WIDTHS) for(const theme of ['light','dark']) {
    for(const state of ['available','empty','updates','busy','error','refused','keyboard']) {
      await check(`rail item 715 ${state} at ${width} ${theme}, geometry tolerance 2px and touch tolerance 0.75px`,async()=>{
        const label=`item715-${state}-${width}-${theme}`, prefix=label+'-'+randomUUID();
        const seed=await control({method:'item715_seed',operation_id:prefix,empty:state==='empty'});
        const p=await up(seed,width,theme,label);
        try {
          await loaded(p,seed);
          if(state==='empty') {
            assert.equal(await p.evaluate(`document.querySelectorAll('#outline .ol-dossier').length`),0,'an empty parent adds no dossier or duplicate group');
            await shot(p,label); return;
          }
          const ids = await p.evaluate(`[...document.querySelectorAll('#outline .ol-dossier')].map(e=>e.dataset.dossierId)`);
          assert.deepEqual(ids,[...seed.roots].reverse(),'newest stars first, equal titles retain separate real identities');
          assert.equal(await p.evaluate(`document.querySelector(${JSON.stringify(row(seed.roots[3]))}).textContent.trim()`),'★ Fallback words 3','empty name uses the feed preview');
          const geometry=await p.evaluate(`(()=>{const parent=document.querySelector('#outline a[data-topic-id="${seed.topic}"]'), pr=parent.getBoundingClientRect();
            return [...document.querySelectorAll('#outline .ol-dossier')].map(e=>{const b=e.getBoundingClientRect(),c=getComputedStyle(e);return {left:b.left-pr.left,right:b.right-pr.right,height:b.height,color:c.color,parent:getComputedStyle(parent).color,bg:getComputedStyle(document.body).backgroundColor,title:e.title,level:e.getAttribute('aria-level')}})})()`);
          for(const g of geometry) {
            assert.ok(g.left>=12-GEOMETRY_TOLERANCE_PX,'children are visibly tucked under their parent, tolerance 2px');
            assert.ok(g.right<=GEOMETRY_TOLERANCE_PX,'long titles stay within the parent width, tolerance 2px');
            assert.ok(g.height>=44-TOUCH_TARGET_TOLERANCE_PX,'each child is a 44px touch target, tolerance 0.75px');
            assert.notEqual(g.color,g.parent,'titles use a distinct theme color');
            assert.ok(g.title.length>0,'each title has a tooltip');
            assert.equal(g.level,'3','children are in the outline tree at the topic child level');
          }
          await shot(p,label);
          if(state==='updates') {
            await act(seed,seed.roots[3],'stack.name',{name:'Renamed live'},prefix);
            await until(()=>p.evaluate(`document.querySelector(${JSON.stringify(row(seed.roots[3]))})?.textContent==='★ Renamed live'`),'rename arrives live');
            await act(seed,seed.roots[3],'message.star',{starred:false},prefix);
            await until(()=>p.evaluate(`!document.querySelector(${JSON.stringify(row(seed.roots[3]))})`),'unstar removes the title live');
            await act(seed,seed.roots[3],'message.star',{starred:true},prefix);
            await until(()=>p.evaluate(`Boolean(document.querySelector(${JSON.stringify(row(seed.roots[3]))}))`),'star restores that actual dossier live');
          }
          if(['busy','error','refused'].includes(state)) {
            let intercepted=false;
            p.intercept(payload=>payload?.name==='stars'&&payload.args?.topic_id===seed.topic ? (intercepted=true) : false);
            await act(seed,seed.roots[3],'stack.name',{name:'After held read'},prefix);
            await until(()=>p.held.length>0,'the actual scoped read response is held');
            assert.equal(intercepted,true);
            assert.equal(await p.evaluate(`document.querySelector('#outline .ol-dossiers').getAttribute('aria-busy')`),'true','busy is exposed without discarding confirmed titles');
            assert.equal(await p.evaluate(`document.querySelectorAll('#outline .ol-dossier').length`),4,'busy keeps confirmed titles');
            await shot(p,label+'-held');
            const held=p.held.shift(); p.intercept(null);
            if(state==='busy') await p.release(held);
            else {
              await p.send('Fetch.fulfillRequest',{requestId:held.event.requestId,responseCode:200,responseHeaders:[{name:'Content-Type',value:'application/json'}],body:Buffer.from(JSON.stringify({instance_id:facts.instance_id,error:{code:state==='refused'?'FORBIDDEN':'DATABASE_BUSY',message:'Scoped read unavailable',retryable:state==='error'}})).toString('base64')});
              await until(()=>p.evaluate(`Boolean(document.querySelector('#outline .ol-dossiers button[data-retry]'))`),'the scoped refusal offers recovery');
              assert.equal(await p.evaluate(`document.querySelectorAll('#outline .ol-dossier').length`),state==='refused'?0:4,'denied clears private titles; an ordinary read error keeps confirmed titles');
              await shot(p,label+'-recovery');
              await press(p,'#outline .ol-dossiers button[data-retry]',width);
            }
            await until(()=>p.evaluate(`document.querySelector(${JSON.stringify(row(seed.roots[3]))})?.textContent==='★ After held read'`),'recovery reads the new title');
          }
          if(state==='keyboard') {
            await press(p,`#outline a[data-topic-id="${seed.topic}"]`,width);
            // A phone move closes its drawer; reopening gives the same row its keys.
            if(width!==1280) await press(p,'#rail-open',width);
            await p.key('ArrowDown');
            await until(()=>p.evaluate(`document.activeElement?.dataset.dossierId===${JSON.stringify(seed.roots[3])}`),'native Down reaches the first child');
            await p.key('ArrowLeft');
            assert.equal(await p.evaluate('document.activeElement?.dataset.topicId'),seed.topic,'Left returns to the actual parent');
            await p.key('ArrowDown'); await p.key('Enter');
          } else if(state==='available') await press(p,row(seed.roots[3]),width);
          if(['available','keyboard'].includes(state)) {
            await until(()=>p.evaluate(`new URL(location.href).searchParams.get('message')===${JSON.stringify(seed.roots[3])}`),'the title opens its real dossier destination');
            assert.equal(await p.evaluate(`new URL(location.href).searchParams.get('topic')`),seed.topic,'destination stays in the real parent topic');
          }
          assert.deepEqual(p.errors,[]);
        } finally {await p.close();}
      });
    }
  }
}

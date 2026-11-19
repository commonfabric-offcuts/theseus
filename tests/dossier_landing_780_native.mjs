// Prepared own cases, UNRUN in the source phase. No driver registration or
// runner allocation here. Next stage supplies isolated prepare780 fixtures.
import assert from 'node:assert/strict';
export const VIEWPORT_TOLERANCE_PX = 2;
export const HORIZONTAL_TOLERANCE_PX = 2;
export const landing780Cases = [1280,320,390].flatMap(width => ['light','dark'].flatMap(theme =>
  ['same-loaded','same-unloaded','cross-topic'].flatMap(route => ['ordinary','folded','below-More'].flatMap(state =>
    (width===1280?['click','Return']:['tap']).map(input => ({width,theme,route,state,input,status:'UNRUN'}))))));

export const landing780DraftCases = [1280,320,390].flatMap(width => ['light','dark'].flatMap(theme =>
  ['inline-save-refused-kept','Reader-save-refused-kept','retry-after-save','cancel-by-newer-choice','same-topic-existing-Reader','ordinary-message-same-topic','ordinary-message-cross-topic'].map(state => ({width,theme,state,status:'UNRUN'}))));

// prepare780(case): returns {page,root,topic,topicSelector,cardSelector,
// titleSelector}. It seeds an isolated origin before opening the page, applies
// folded/below-More fixture state through Core, and leaves the initial target
// hidden or at least 80px outside the viewport with its outline row visible.
// It must not activate the feature, alter focus, or pre-scroll the target.
// page is the owned native pool page (point/key/send/evaluate); cleanup closes
// the owned context, and driver finally uses Browser.close. No browser starts
// on importing this module. Width/theme/fixture validation belongs to prepare.
export async function item780LandingChecks({check,prepare780,until,capture,close780}) {
  for(const spec of landing780Cases) await check(`780 ${spec.route} ${spec.state} ${spec.input} ${spec.width} ${spec.theme}; viewport tolerance 2px`,async()=>{
    const f=await prepare780(spec),p=f.page;
    const row=`#outline .ol-dossier[data-dossier-id="${f.root}"]`;
    const snapshot=()=>p.evaluate(`(()=>{
      const card=document.querySelector(${JSON.stringify(f.cardSelector)}),title=document.querySelector(${JSON.stringify(f.titleSelector)}),r=title?.getBoundingClientRect(),c=card?.getBoundingClientRect(),style=getComputedStyle(document.documentElement);
      const top=parseFloat(style.scrollPaddingTop)||0,bottom=innerHeight-(parseFloat(style.scrollPaddingBottom)||0);
      return {reader:!!document.querySelector('#reader')?.open,sheet:!!document.querySelector('#new-message-sheet')?.open,
        selected:!!card?.classList.contains('lit'),active:document.activeElement===card,root:card?.dataset.id,
        topic:!!document.querySelector(${JSON.stringify(f.topicSelector)}),
        rect:r?{top:r.top,bottom:r.bottom,left:r.left,right:r.right,height:r.height}:null,
        shown:!!title?.getClientRects().length && !title?.closest('[hidden], [inert]'),
        content:{top,bottom},cardRect:c?{top:c.top,bottom:c.bottom,height:c.height}:null,
        height:innerHeight,width:innerWidth,overflow:document.documentElement.scrollWidth-innerWidth,
        openings:window.item780Openings??null,url:location.href};})()`);
    let error;
    try {
      const before=await snapshot();await capture(p,spec,'before',before);
      assert.equal(before.reader,false);assert.equal(before.sheet,false);
      assert.ok(!before.shown || before.rect.bottom < -80 || before.rect.top > before.height+80,'fixture makes no-scroll mutant observable');
      // Observational hook only: retains every transient dialog open, including
      // one opened then closed in a single task. No product method is wrapped.
      await p.evaluate(`(()=>{window.item780Openings=[];new MutationObserver(records=>{
        for(const r of records) if(r.target.matches?.('#reader, #new-message-sheet') &&
          (r.oldValue!==null || r.target.hasAttribute('open'))) window.item780Openings.push(r.target.id);
      }).observe(document.body,{subtree:true,attributes:true,attributeFilter:['open'],attributeOldValue:true});})()`);
      if(spec.input==='Return') {
        // Reach the tree and its child entirely by real keys.
        for(let n=0;n<100&&!await p.evaluate("!!document.activeElement?.closest('#outline')");n++)await p.key('Tab',9);
        for(let n=0;n<300&&!await p.evaluate(`document.activeElement===document.querySelector(${JSON.stringify(row)})`);n++)await p.key('ArrowDown',40);
        assert.equal(await p.evaluate(`document.activeElement===document.querySelector(${JSON.stringify(row)})`),true,'native arrows reached actual starred child');
        await p.key('Enter',13);
      } else if(spec.input==='click') await p.point(row);
      else {
        const b=await p.box(row),x=b.x+b.width/2,y=b.y+b.height/2;
        assert.equal(await p.evaluate(`document.querySelector(${JSON.stringify(row)}).contains(document.elementFromPoint(${x},${y}))`),true);
        await p.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x,y}]});
        await p.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
      }
      await until(async()=>{const s=await snapshot();return s.topic&&s.active&&s.selected&&s.shown;},'actual target selected on its topic');
      const after=await snapshot();await capture(p,spec,'after',after);
      assert.equal(after.root,f.root);assert.equal(after.reader,false);assert.equal(after.sheet,false);
      assert.deepEqual(after.openings,[],'no transient Reader or reply box opening');
      assert.ok(after.rect.top>=after.content.top-VIEWPORT_TOLERANCE_PX,'title top in view, tolerance 2px');
      assert.ok(after.rect.bottom<=after.content.bottom+VIEWPORT_TOLERANCE_PX,'title bottom in view, tolerance 2px');
      const visible=Math.min(after.cardRect.bottom,after.content.bottom)-Math.max(after.cardRect.top,after.content.top);
      assert.ok(visible>=Math.min(after.cardRect.height,44)-VIEWPORT_TOLERANCE_PX,'card shows at least min(height,44px), tolerance 2px');
      assert.ok(after.overflow<=HORIZONTAL_TOLERANCE_PX,'no horizontal overflow, tolerance 2px');
    } catch(caught) {error=caught;await capture(p,spec,'failure',await snapshot(),caught);throw caught;}
    finally {await close780(f,error);}
  });
}

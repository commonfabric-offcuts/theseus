import { topicTitleChecks } from './topic_title_native.mjs';
import assert from 'node:assert/strict';
import { pngPixels, paintedBand } from './png-bands.mjs';

export async function readingColorsCheck({ check, page, until, facts, view, control, field, shot, observations }) {
  await topicTitleChecks({ check, page, until, control, view, facts, shot }, 'colors');
  await check('colors reading colors distinguish authors and preserve source geometry', async () => {
    const failures=[];
    const expect=(ok,why)=>{if(!ok)failures.push(why);};
    const rgb=s=>s.match(/[\d.]+/g).slice(0,3).map(Number);
    const contrast=(a,b)=>{
      const luminance=color=>color.match(/[\d.]+/g).slice(0,3).map(Number).map(c=>{c/=255;return c<=.04045?c/12.92:((c+.055)/1.055)**2.4;}).reduce((s,c,i)=>s+c*[.2126,.7152,.0722][i],0);
      const x=luminance(a),y=luminance(b);return (Math.max(x,y)+.05)/(Math.min(x,y)+.05);
    };
    // The neutral page (docs/reading-colors.md): never the green that is Fable's card.
    const neutral={light:'rgb(239, 240, 240)',dark:'rgb(37, 43, 46)'};
    for(const theme of ['dark','light']) {
      const original=await control({method:'agent_message',operation_id:'reading-colors-original-'+theme,body:'Original other author '+theme+'.'});
      const p=await page('reading-colors-'+theme,null,true,{beforeNavigate:p=>p.send('Emulation.setEmulatedMedia',{features:[{name:'prefers-color-scheme',value:theme}]})});
      // A card in a reply stack has no border of its own: its edge is its box-shadow, the 2px ring when it is the current
      // message (docs/reply-stacks.md, "The look"). edge is that ring's colour in a stack, else the border's.
      const style=s=>p.evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(s)}),c=getComputedStyle(e),stacked=Boolean(e.closest('.reply-stack:not(.only-new *)'));
        return {background:c.backgroundColor,color:c.color,border:c.borderColor,outline:c.outlineStyle,stacked,shadow:c.boxShadow,
          edge:stacked?(c.boxShadow.match(/rgba?\\([^)]*\\)/)||[c.borderColor])[0]:c.borderColor}})()`);
      const own=`#messages [data-id="${facts.sources[1].id}"]`;
      // The person's own long card answers their first message, so it sits in that message's reply stack, folded away under the agents' later replies.
      await until(()=>p.evaluate(`Boolean(document.querySelector(${JSON.stringify(own)}))`),'own card drawn');
      await p.unfold(own);
      // The quiet words on the message's own color: ↑ Previous · ↓ Next at its
      // end, shown on a phone (docs/reader.md), read there and the window put back.
      const endHint=async()=>{
        await p.send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});
        await until(()=>p.evaluate("document.querySelector('#reader .reader-end')?.getClientRects().length>0"),'the end line on a phone');
        const words=await style('.reader-end .end-step'),pane=await style('.reading-pane');
        await p.send('Emulation.setDeviceMetricsOverride',{width:1440,height:900,deviceScaleFactor:1,mobile:false});
        await until(()=>p.evaluate("!matchMedia('(max-width: 760px)').matches&&document.getAnimations().filter(x=>x.effect?.getTiming().iterations!==Infinity).every(animation=>animation.playState!=='running')"),'the window put back');
        return {color:words.color,background:pane.background};
      };
      const initialOwn=await style(own),initialOther=await style(`#messages [data-id="${original.result.message_id}"]`);
      expect(initialOwn.background==='rgb(0, 0, 0)'&&initialOther.background!=='rgb(0, 0, 0)',theme+': initial paint distinguishes own and other');
      const incoming=await control({method:'agent_message',operation_id:'reading-colors-'+theme,body:'Other author for reading colors '+theme+'.'});
      const other=`#messages [data-id="${incoming.result.message_id}"]`;
      await until(()=>p.evaluate(`Boolean(document.querySelector(${JSON.stringify(other)}))`),'other author arrival rendered');
      await p.evaluate(`document.querySelector(${JSON.stringify(own)}).scrollIntoView({block:'center'})`);
      await p.send('Input.dispatchMouseEvent',{type:'mouseMoved',x:2,y:2});
      const ownRest=await style(own),otherRest=await style(other);
      const secondary=await p.evaluate(`[...document.querySelector(${JSON.stringify(own)}).querySelectorAll('.message-time,.message-preview-cue')].map(e=>({text:e.textContent,color:getComputedStyle(e).color}))`);
      expect(secondary.length===2,theme+': own long card has timestamp and excerpt cue');
      expect(ownRest.background==='rgb(0, 0, 0)',theme+': own card is black at rest');
      expect(ownRest.background!==otherRest.background,theme+': other arrival does not get own fill');
      // In a stack no card has a border at rest; the fill above tells the person's own from another's.
      expect(ownRest.stacked||ownRest.border!==otherRest.border,theme+': own border is distinct at rest');
      for(const c of [ownRest,...secondary])expect(contrast(c.color,'rgb(0, 0, 0)')>=4.5,theme+': all own-card text readable on black');
      await shot(p,'reading-colors-'+theme+'-cards-rest');
      await p.point(own,'move');const ownHover=await style(own);
      // Tony's own card stays black under the pointer, exactly as live; only
      // its edge changes (its border, or in a stack its ring), and no side of it grows an edge or bar.
      expect(ownHover.background==='rgb(0, 0, 0)',theme+': own card stays black on hover');
      expect(ownHover.border!==ownRest.border||ownHover.shadow!==ownRest.shadow,theme+': own hover has a visible change '+JSON.stringify([ownRest,ownHover]));
      // A long card read in place scrolls inside itself, and the browser draws its scrollbar inside the card's right edge:
      // a classic one, or an overlay one for a moment after the card scrolls (the hosted runner shows either). It is
      // the browser's, not an edge or bar of the page's, so it is hidden while both sides are sampled.
      await p.evaluate(`document.head.append(Object.assign(document.createElement('style'),{id:'check-no-scrollbars',textContent:'#messages *{scrollbar-width:none!important}'}))`);
      const ownBox=await p.box(own),hoverPixels0=pngPixels(Buffer.from((await p.send('Page.captureScreenshot',{format:'png'})).data,'base64'));
      await p.evaluate(`document.getElementById('check-no-scrollbars').remove()`);
      const midY=Math.round(ownBox.y+ownBox.height/2),black=rgb(ownHover.background);
      const pad=(from,to)=>Array.from({length:to-from},(_,k)=>({x:from+k,px:hoverPixels0.pixel(from+k,midY)}));
      // Any pixel that is not the card's black is named, with what the page draws there.
      const bad=[...pad(Math.ceil(ownBox.x)+3,Math.ceil(ownBox.x)+14),...pad(Math.floor(ownBox.x+ownBox.width)-14,Math.floor(ownBox.x+ownBox.width)-3)].filter(({px})=>!px.every((v,i)=>v===black[i]));
      const there=bad.length?await p.evaluate(`(()=>{const e=document.elementFromPoint(${bad[0].x},${midY});return e&&{tag:e.tagName,id:e.id,cls:String(e.className),own:e===document.querySelector(${JSON.stringify(own)})}})()`):null;
      expect(!bad.length,theme+': the hovered card is black on both sides, with no edge or bar'+(bad.length?' '+JSON.stringify({bad:bad.slice(0,6),count:bad.length,midY,box:ownBox,there}):''));
      await shot(p,'reading-colors-'+theme+'-cards');
      await p.send('Input.dispatchMouseEvent',{type:'mouseMoved',x:2,y:2});
      // Each lit card's bar buttons follow it in the Tab order (docs/interaction.md), so a card takes up to four stops.
      // From the control just before it, as its stack opened lays it out (docs/reply-stacks.md).
      await p.evaluate(`(()=>{const o=document.querySelector(${JSON.stringify(own)}),all=[...document.querySelectorAll('button,input,textarea,a[href],[tabindex]:not([tabindex="-1"])')].filter(e=>!e.disabled&&!e.closest('[inert]')&&e.getClientRects().length&&!e.contains(o)&&o.compareDocumentPosition(e)&Node.DOCUMENT_POSITION_PRECEDING);all.at(-1).focus({preventScroll:true})})()`);
      for(let n=0;n<8&&!await p.evaluate(`document.activeElement.matches(${JSON.stringify(own)})`);n++)await p.key('Tab');
      assert.equal(await p.evaluate(`document.activeElement.matches(${JSON.stringify(own)})`),true,'own message reachable by native Tab: '+await p.evaluate(`(()=>{const o=document.querySelector(${JSON.stringify(own)}),a=document.activeElement,s=o.closest('.reply-stack');return JSON.stringify({own:{tag:o.tagName,hidden:o.hidden,tab:o.tabIndex,rects:o.getClientRects().length,inert:Boolean(o.closest('[inert]')),fold:s?.dataset.fold,head:s?.dataset.headOpen,cls:o.className},active:{tag:a.tagName,id:a.id,cls:a.className,text:a.textContent.slice(0,40)}})})()`));
      // On its own a focused card wears the focus outline; in a reply stack the stack's look draws the focus instead
      // (docs/reply-stacks.md, "The look"): the card's own ring in the focus colour, and no second ring round the folder,
      // as selecting a message takes the stack's ring away (web/stack-look.css).
      const focusShown=await p.evaluate(`(()=>{const o=document.querySelector(${JSON.stringify(own)}),s=o.closest('.reply-stack'),probe=document.createElement('span');
        probe.style.color='var(--focus)';document.body.append(probe);const focus=getComputedStyle(probe).color;probe.remove();
        return s?getComputedStyle(o).boxShadow.includes(focus)&&!getComputedStyle(s).boxShadow.includes(focus):getComputedStyle(o).outlineStyle==='solid'})()`);
      expect(focusShown,theme+': keyboard focus stays visible on own black card');
      await p.evaluate(`document.querySelector(${JSON.stringify(other)}).scrollIntoView({block:'center'})`);
      await p.point(other,'move');const topicHover=await style(other);
      // Any card but your own shows a ring under the pointer, one color on all four sides, that stands out from its
      // hover fill. Outside a stack it is neutral (docs/reading-colors.md). In a stack it is the current message's ring,
      // and which colour that ring should be is not settled: docs/reading-colors.md (item 91b) asks for a neutral grey,
      // docs/reply-stacks.md (items 342 and 430) for the one focus-coloured ring, which is what the page draws. Until a
      // person decides, this check asserts neither colour in a stack, only that the ring is there and shows.
      const ring=rgb(topicHover.edge);
      expect(/^rgb\(\d+, \d+, \d+\)$/.test(topicHover.edge)&&topicHover.edge!==otherRest.edge,theme+`: a hovered agent card is ringed alike on all four sides (${otherRest.edge} to ${topicHover.edge})`);
      expect((topicHover.stacked||Math.max(...ring)-Math.min(...ring)<=20)&&contrast(topicHover.edge,topicHover.background)>=3,theme+`: the ring is neutral and shows on the hover fill (${topicHover.edge} on ${topicHover.background})`);
      // Sample a real space between source words: an opaque article background
      // can hide the pane's correct computed color.
      const behindWords=async()=>{
        const point=await p.evaluate(`(()=>{const t=document.querySelector('#source-body [data-start]').firstChild,n=t.textContent.indexOf(' '),r=document.createRange();r.setStart(t,n);r.setEnd(t,n+1);const b=r.getBoundingClientRect();return {x:Math.floor(b.x+b.width/2),y:Math.floor(b.y+b.height/2)}})()`);
        const pixels=pngPixels(Buffer.from((await p.send('Page.captureScreenshot',{format:'png'})).data,'base64'));
        assert.ok(point.x>=0&&point.x<pixels.width&&point.y>=0&&point.y<pixels.height,'source background sample is inside the screenshot');
        return {point,pixel:pixels.pixel(point.x,point.y)};
      };
      const painted=(sample,background)=>sample.pixel.length===3&&sample.pixel.every((v,i)=>v===rgb(background)[i]);
      // An agent's message is read on its card's color under the pointer: the
      // card just pressed. Every other source is read on the neutral page.
      await p.point(other);
      await until(()=>p.evaluate(`document.querySelector('#reader').open&&document.querySelector('#source-body').textContent.includes('Other author for reading colors')`),'the agent message is open');
      await until(()=>p.evaluate("document.getAnimations().filter(x=>x.effect?.getTiming().iterations!==Infinity).every(animation=>animation.playState!=='running')"),'settled reader');
      const agentSource=await style('.reading-pane'),agentSample=await behindWords();
      expect(agentSource.background===topicHover.background,theme+': an agent message is read on its card hover color');
      expect(painted(agentSample,topicHover.background),theme+': painted background behind the agent message words matches its card hover');
      const agentHint=await endHint();
      expect(contrast(agentHint.color,agentHint.background)>=4.5,theme+': the end line\'s contrast on the agent color is at least 4.5:1');
      await shot(p,'reading-colors-'+theme+'-agent-source');
      await p.point('#reader-close');
      await until(()=>p.evaluate('!document.querySelector("#reader").open'),'agent message Reader closed');
      await p.open(1);
      const hint=await endHint(),hintContrast=contrast(hint.color,hint.background);
      expect(hintContrast>=4.5,theme+': the end line\'s contrast is at least 4.5:1');
      const geometry=()=>p.evaluate(`['#source-body','#writing-body'].map(s=>{const e=document.querySelector(s),r=e.getBoundingClientRect();return {s,x:r.x,y:r.y,width:r.width,height:r.height,scrollHeight:e.scrollHeight,text:e.value??e.textContent}})`);
      const before=await geometry(),writing=await style('#writing-body'),source=await style('.reading-pane');
      expect(source.background===neutral[theme],theme+': the person\'s own message is read on the neutral page, not an agent\'s color');
      const {point:backgroundPoint,pixel:sourcePixel}=await behindWords();
      expect(painted({pixel:sourcePixel},neutral[theme]),theme+': painted background behind source words is the neutral page');
      const target=await p.evaluate(`(()=>{const spans=[...document.querySelectorAll('#source-body [data-start]')];const s=spans.find(e=>e.getClientRects().length>1&&e.getBoundingClientRect().bottom<innerHeight/2)||spans[0];const range=document.createRange();range.selectNodeContents(s);const r=range.getClientRects()[0];return {start:s.dataset.start,x:r.x+2,y:r.y+r.height/2}})()`);
      await p.send('Input.dispatchMouseEvent',{type:'mouseMoved',x:target.x,y:target.y});
      const hovered=await style('#source-body .hover-quote');
      expect(hovered.background==='rgb(0, 0, 0)',theme+': passage hover is black');
      expect(contrast(hovered.color,'rgb(0, 0, 0)')>=4.5,theme+': passage hover text readable');
      const coverage=await p.evaluate(`(()=>{const s=document.querySelector('#source-body .hover-quote'),range=document.createRange();range.selectNodeContents(s);const rects=r=>[...r].map(b=>({x:b.x,y:b.y,width:b.width,height:b.height}));return {text:s.textContent,span:rects(s.getClientRects()),textRange:rects(range.getClientRects()),lineHeight:getComputedStyle(s).lineHeight,paddingTop:getComputedStyle(s).paddingTop,paddingBottom:getComputedStyle(s).paddingBottom}})()`);
      const hoverPixels=pngPixels(Buffer.from((await p.send('Page.captureScreenshot',{format:'png'})).data,'base64'));
      await shot(p,'reading-colors-'+theme+'-hover');
      assert.deepEqual(await geometry(),before,'hover cannot move or rewrap source/writing');
      assert.deepEqual(await style('#writing-body'),writing,'hover cannot recolor writing');
      // Native partial drag starts inside one passage and ends inside the next.
      const drag=await p.evaluate(`(()=>{const a=document.querySelector('#source-body .hover-quote'),b=a.nextElementSibling;const point=(s,n)=>{const r=document.createRange();r.setStart(s.firstChild,n);r.setEnd(s.firstChild,n+1);const q=r.getBoundingClientRect();return {x:q.x+1,y:q.y+q.height/2}};return {from:point(a,2),to:point(b,8)}})()`);
      await p.send('Input.dispatchMouseEvent',{type:'mousePressed',...drag.from,button:'left',buttons:1,clickCount:1});
      for(let n=1;n<=8;n++)await p.send('Input.dispatchMouseEvent',{type:'mouseMoved',x:drag.from.x+(drag.to.x-drag.from.x)*n/8,y:drag.from.y+(drag.to.y-drag.from.y)*n/8,button:'left',buttons:1});
      await p.send('Input.dispatchMouseEvent',{type:'mouseReleased',...drag.to,button:'left',buttons:0,clickCount:1});
      const selection=await p.evaluate(`(()=>{const s=getSelection();return {text:s.toString(),rects:[...s.getRangeAt(0).getClientRects()].map(b=>({x:b.x,y:b.y,width:b.width,height:b.height}))}})()`);
      assert.ok(selection.text.length>5,'native selection instrument selected source text');
      const selectionColor=await p.evaluate(`getComputedStyle(document.querySelector('#source-body [data-start]'),'::selection').backgroundColor`);
      const selectionPixels=pngPixels(Buffer.from((await p.send('Page.captureScreenshot',{format:'png'})).data,'base64'));
      const bands=[];
      for(const rect of coverage.textRange.filter(r=>r.width>10)) {
        const shared=selection.rects.find(r=>Math.abs(r.y-rect.y)<1&&Math.min(r.x+r.width,rect.x+rect.width)-Math.max(r.x,rect.x)>10);
        if(!shared)continue;
        const x=(Math.max(shared.x,rect.x)+Math.min(shared.x+shared.width,rect.x+rect.width))/2;
        // Look beyond adjacent lines so excessive paint cannot pass merely
        // because the scan clipped it to the desired selection height.
        const margin=2*parseFloat(coverage.lineHeight),top=rect.y-margin,bottom=rect.y+rect.height+margin;
        const hover=paintedBand(hoverPixels,x,top,bottom,rgb(hovered.background));
        // Chrome paints ::selection as computed; a harness whose engine paints it otherwise says what it painted.
        const selectedPaint=p.selectionPaint?p.selectionPaint(selectionPixels,x,shared,rgb(selectionColor),rgb(hovered.background)):rgb(selectionColor);
        const selected=paintedBand(selectionPixels,x,top,bottom,selectedPaint);
        assert.ok(hover&&selected,'pixel instrument finds both native paint bands');
        assert.equal(paintedBand(selectionPixels,x,top,bottom,[255,0,255]),null,'wrong-color negative control is not a selection');
        bands.push({x,hover,selected});
        // Chrome paints a selection over the whole line box, and the hover matches it exactly. Safari
        // paints less on some lines (docs/device-evidence.md), so there the hover only has to cover it.
        if(p.selectionWithinHover)expect(hover.top<=selected.top&&selected.bottom<=hover.bottom,theme+`: the hover covers all that a native selection paints (hover ${hover.top}-${hover.bottom}, selection ${selected.top}-${selected.bottom})`);
        else expect(Math.abs(hover.top-selected.top)<=1&&Math.abs(hover.bottom-selected.bottom)<=1,theme+`: hover and native selection have the same painted vertical extent (hover ${hover.top}-${hover.bottom}, selection ${selected.top}-${selected.bottom})`);
      }
      assert.ok(bands.length>=2,'wrapped hover is measured on both lines');
      await shot(p,'reading-colors-'+theme+'-selection');
      const previous=await field(p);await p.key('Enter');
      assert.equal(await field(p),previous+'> '+selection.text.split('\n').join('\n> ')+'\n\n','native partial selection quotes exactly');
      await p.key('z',4);assert.equal(await field(p),previous,'Undo restores the draft');
      // The Reader closes once its writing is kept on this device; until then
      // it is modal and a press on the card behind it lands on the Reader.
      await p.point('#reader-close');
      await until(()=>p.evaluate('!document.querySelector("#reader").open'),'Reader closed');
      // A Notebook page is read in the Reader at a revision (as it stands it opens in the composer, docs/decks.md).
      const notebookItem=await p.evaluate(`document.querySelector('#memory-items .memory-card').dataset.id`);
      const notebookRevision=(await view('memory_current',{item_id:notebookItem})).source_ref.revision;
      await p.send('Page.navigate',{url:`${facts.origin}/?topic=t1&page=${encodeURIComponent(notebookItem)}&revision=${notebookRevision}`});
      await until(()=>p.evaluate(`document.body.dataset.ready==='true'&&document.querySelector('#reader').open&&document.querySelector('#reader-origin').textContent.includes('Notebook')`),'Notebook source open');
      expect((await style('.reading-pane')).background===neutral[theme],theme+': a Notebook page is read on the neutral page');
      assert.match(await p.evaluate(`document.querySelector('#reader-origin').textContent`),/Notebook · revision/,'Notebook provenance intact');
      await p.point('#reader-close');
      await until(()=>p.evaluate('!document.querySelector("#reader").open'),'Notebook Reader closed');
      await p.send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});
      await p.send('Emulation.setTouchEmulationEnabled',{enabled:true});
      await p.evaluate(`document.querySelector(${JSON.stringify(own)}).scrollIntoView({block:'center'})`);
      expect((await style(own)).background==='rgb(0, 0, 0)'&&(await style(other)).background!=='rgb(0, 0, 0)',theme+': phone cards distinguish authors');
      assert.equal(await p.evaluate('document.documentElement.scrollWidth<=innerWidth'),true,'phone cards do not overflow horizontally');
      await shot(p,'reading-colors-'+theme+'-phone-cards');
      await p.open(1);
      expect((await style('.reading-pane')).background===neutral[theme],theme+': phone Reader keeps the neutral page for the person\'s own message');
      // The laptop steps above usually leave an unsent copy of this reply on this
      // device (unless its idle save went through before the page moved on).
      // The phone Reader looks for earlier copies in the background and offers
      // one it finds, which narrows the writing field. Measure once that search
      // has finished, so the touch alone is compared. WebKit's harness turns
      // touch on in a fresh browser context, whose device keeps no copy.
      await until(()=>p.evaluate("document.querySelector('#reader').dataset.discovered==='true'"),'the Reader has looked for earlier writing');
      const offered=await p.evaluate("!document.querySelector('#review-versions').hidden");
      const phoneBefore=await geometry(),phoneWriting=await field(p),sourceBox=await p.box('#source-body');
      const touch={x:sourceBox.x+10,y:sourceBox.y+10};
      await p.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[touch]});
      await p.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
      assert.equal(await field(p),phoneWriting,'plain source touch does not quote');
      assert.equal(p.calls.filter(call=>call.payload?.kind==='message.send').length,0,'nearby interactions never send');
      assert.deepEqual(await geometry(),phoneBefore,'source touch keeps phone writing geometry');
      assert.equal(await p.evaluate('document.querySelector("#reader").scrollWidth<=innerWidth'),true,'phone Reader does not overflow horizontally');
      await shot(p,'reading-colors-'+theme+'-phone-reader');
      observations.push({name:'reading colors',theme,offered,initialOwn,initialOther,ownRest,ownHover,otherRest,secondary,topicHover,agentSource,agentSample,agentHint,source,backgroundPoint,sourcePixel,hint,hintContrast,writing,hovered,coverage,selection,bands});
      assert.deepEqual(p.errors,[]);
      await p.close();
    }
    assert.deepEqual(failures,[],'requested reading colors');
  });
}

import assert from 'node:assert/strict';
import { pngPixels, paintedBand } from './png-bands.mjs';

export async function readingColorsCheck({ check, page, until, facts, view, control, field, shot, observations }) {
  await check('colors reading colors distinguish authors and preserve source geometry', async () => {
    const failures=[];
    const expect=(ok,why)=>{if(!ok)failures.push(why);};
    const rgb=s=>s.match(/[\d.]+/g).slice(0,3).map(Number);
    const contrast=(a,b)=>{
      const luminance=color=>color.match(/[\d.]+/g).slice(0,3).map(Number).map(c=>{c/=255;return c<=.04045?c/12.92:((c+.055)/1.055)**2.4;}).reduce((s,c,i)=>s+c*[.2126,.7152,.0722][i],0);
      const x=luminance(a),y=luminance(b);return (Math.max(x,y)+.05)/(Math.min(x,y)+.05);
    };
    for(const theme of ['dark','light']) {
      const original=await control({method:'agent_message',operation_id:'reading-colors-original-'+theme,body:'Original other author '+theme+'.'});
      const p=await page('reading-colors-'+theme,null,true,{beforeNavigate:p=>p.send('Emulation.setEmulatedMedia',{features:[{name:'prefers-color-scheme',value:theme}]})});
      const style=s=>p.evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(s)}),c=getComputedStyle(e);return {background:c.backgroundColor,color:c.color,border:c.borderColor,outline:c.outlineStyle}})()`);
      const own=`#messages [data-id="${facts.sources[1].id}"]`;
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
      expect(ownRest.border!==otherRest.border,theme+': own border is distinct at rest');
      for(const c of [ownRest,...secondary])expect(contrast(c.color,'rgb(0, 0, 0)')>=4.5,theme+': all own-card text readable on black');
      await shot(p,'reading-colors-'+theme+'-cards-rest');
      await p.point(own,'move');const ownHover=await style(own);
      // The whole card lifts off black: visible on a light page, every side
      // alike, its words still readable.
      const luminance=c=>contrast(c,'rgb(0, 0, 0)')*0.05-0.05;
      expect(ownHover.background!=='rgb(0, 0, 0)'&&contrast(ownHover.background,'rgb(0, 0, 0)')>=1.3&&luminance(ownHover.background)<0.05,theme+': own card lifts to near-black on hover');
      expect(ownHover.border!==ownRest.border,theme+': own hover has a visible change');
      for(const c of [ownHover,...secondary])expect(contrast(c.color,ownHover.background)>=4.5,theme+': own-card text readable on its hover');
      const ownBox=await p.box(own),hoverPixels0=pngPixels(Buffer.from((await p.send('Page.captureScreenshot',{format:'png'})).data,'base64'));
      const midY=Math.round(ownBox.y+ownBox.height/2),lifted=rgb(ownHover.background);
      const pad=(from,to)=>Array.from({length:to-from},(_,k)=>hoverPixels0.pixel(from+k,midY));
      expect([...pad(Math.ceil(ownBox.x)+3,Math.ceil(ownBox.x)+14),...pad(Math.floor(ownBox.x+ownBox.width)-14,Math.floor(ownBox.x+ownBox.width)-3)].every(px=>px.every((v,i)=>v===lifted[i])),theme+': the hover fills the card, with no edge or bar');
      await shot(p,'reading-colors-'+theme+'-cards');
      await p.send('Input.dispatchMouseEvent',{type:'mouseMoved',x:2,y:2});
      for(let n=0;n<80&&!await p.evaluate(`document.activeElement.matches(${JSON.stringify(own)})`);n++)await p.key('Tab');
      assert.equal(await p.evaluate(`document.activeElement.matches(${JSON.stringify(own)})`),true,'own message reachable by native Tab');
      expect((await style(own)).outline==='solid',theme+': keyboard focus stays visible on own black card');
      await p.evaluate(`document.querySelector(${JSON.stringify(other)}).scrollIntoView({block:'center'})`);
      await p.point(other,'move');const topicHover=await style(other);
      await p.open(1);
      const geometry=()=>p.evaluate(`['#source-body','#writing-body'].map(s=>{const e=document.querySelector(s),r=e.getBoundingClientRect();return {s,x:r.x,y:r.y,width:r.width,height:r.height,scrollHeight:e.scrollHeight,text:e.value??e.textContent}})`);
      const before=await geometry(),writing=await style('#writing-body'),source=await style('.reading-pane');
      expect(source.background===topicHover.background,theme+': Reader source uses topic-hover background');
      // Sample a real space between source words: an opaque article background
      // can hide the pane's correct computed color.
      const backgroundPoint=await p.evaluate(`(()=>{const t=document.querySelector('#source-body [data-start]').firstChild,n=t.textContent.indexOf(' '),r=document.createRange();r.setStart(t,n);r.setEnd(t,n+1);const b=r.getBoundingClientRect();return {x:Math.floor(b.x+b.width/2),y:Math.floor(b.y+b.height/2)}})()`);
      const sourcePixels=pngPixels(Buffer.from((await p.send('Page.captureScreenshot',{format:'png'})).data,'base64'));
      assert.ok(backgroundPoint.x>=0&&backgroundPoint.x<sourcePixels.width&&backgroundPoint.y>=0&&backgroundPoint.y<sourcePixels.height,'source background sample is inside the screenshot');
      const sourcePixel=sourcePixels.pixel(backgroundPoint.x,backgroundPoint.y);
      expect(sourcePixel.length===3&&sourcePixel.every((v,i)=>v===rgb(topicHover.background)[i]),theme+': painted background behind source words matches topic hover');
      const hint=await style('.source-actions .muted'),hintContrast=contrast(hint.color,source.background);
      expect(hintContrast>=4.5,theme+': source action hint contrast is at least 4.5:1');
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
        const selected=paintedBand(selectionPixels,x,top,bottom,rgb(selectionColor));
        assert.ok(hover&&selected,'pixel instrument finds both native paint bands');
        assert.equal(paintedBand(selectionPixels,x,top,bottom,[255,0,255]),null,'wrong-color negative control is not a selection');
        bands.push({x,hover,selected});
        expect(Math.abs(hover.top-selected.top)<=1&&Math.abs(hover.bottom-selected.bottom)<=1,theme+': hover and native selection have the same painted vertical extent');
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
      await p.evaluate(`document.querySelector('#memory-items .memory-card').scrollIntoView({block:'center'})`);
      await p.point('#memory-items .memory-card');
      await until(()=>p.evaluate(`document.querySelector('#reader').open&&document.querySelector('#reader-origin').textContent.includes('Notebook')`),'Notebook source open');
      expect((await style('.reading-pane')).background===topicHover.background,theme+': Notebook uses the same source background');
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
      expect((await style('.reading-pane')).background===topicHover.background,theme+': phone Reader retains source background');
      const phoneBefore=await geometry(),phoneWriting=await field(p),sourceBox=await p.box('#source-body');
      const touch={x:sourceBox.x+10,y:sourceBox.y+10};
      await p.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[touch]});
      await p.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
      assert.equal(await field(p),phoneWriting,'plain source touch does not quote');
      assert.equal(p.calls.filter(call=>call.payload?.kind==='message.send').length,0,'nearby interactions never send');
      assert.deepEqual(await geometry(),phoneBefore,'source touch keeps phone writing geometry');
      assert.equal(await p.evaluate('document.querySelector("#reader").scrollWidth<=innerWidth'),true,'phone Reader does not overflow horizontally');
      await shot(p,'reading-colors-'+theme+'-phone-reader');
      observations.push({name:'reading colors',theme,initialOwn,initialOther,ownRest,ownHover,otherRest,secondary,topicHover,source,backgroundPoint,sourcePixel,hint,hintContrast,writing,hovered,coverage,selection,bands});
      assert.deepEqual(p.errors,[]);
      await p.close();
    }
    assert.deepEqual(failures,[],'requested reading colors');
  });
}

import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { withPageCleanup } from './native-page-cleanup.mjs';

// Item 7715: 2 CSS px admits subpixel engine rounding, but cannot hide a
// missing row, a stale count, or the pill crossing the rail by a whole glyph.
const LAYOUT_TOLERANCE_PX = 2;
export async function item756Checks({check, page, until, control, facts, shot, observations, evidencePath}) {
  for (const width of [320,375,390,1280]) for (const theme of ['light','dark']) {
    await check(`rail item 756 covers count across topics, native filter and immediate set clear, privacy and writing at ${width} ${theme}`, async () => {
      const label=`item756-${width}-${theme}`, prefix=label+'-'+randomUUID();
      const seed=await control({method:'item756_seed',operation_id:prefix});
      const p=await page(label,null,true,{url:facts.origin+'/?topic='+seed.topics[0],beforeNavigate:async p=>{
        await p.send('Emulation.setEmulatedMedia',{features:[{name:'prefers-color-scheme',value:theme}]});
        await p.send('Emulation.setDeviceMetricsOverride',{width,height:900,deviceScaleFactor:1,mobile:width!==1280});
        if(width!==1280) await p.send('Emulation.setTouchEmulationEnabled',{enabled:true,maxTouchPoints:1});
      }});
      const count=()=>p.evaluate("Number(document.querySelector('#outline-only-waiting .n')?.textContent)");
      const press=async selector=>{
        await p.evaluate(`document.querySelector(${JSON.stringify(selector)}).scrollIntoView({block:'center'})`);
        if(width===1280) return p.point(selector);
        const b=await p.box(selector),x=b.x+b.width/2,y=b.y+b.height/2;
        await p.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x,y}]});
        await p.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
      };
      const act=async (n,waiting)=>{
        const receipt=await control({method:'item756_act',message_id:seed.roots[n],waiting,operation_id:prefix+'-'+randomUUID()});
        assert.equal(receipt.status,'committed','actual cover mutation committed');
        observations.push({name:'item 756 cover receipt',label,receipt});
      };
      const snapshot=()=>p.evaluate(`(()=>{const f=document.getElementById('inline-writing-body');return {value:f.value,start:f.selectionStart,end:f.selectionEnd,focus:document.activeElement===f,url:location.href,origin:(window.item756Origin??=performance.timeOrigin)}})()`);
      await withPageCleanup(p, async () => {
      try {
        await until(()=>p.evaluate("document.body.dataset.ready==='true' && !document.documentElement.hasAttribute('data-rails-reading') && Boolean(document.querySelector('#outline-only-waiting .n'))"),'item 756 outline settled');
        const baseline=await count();
        await press('#new-message');
        await until(()=>p.evaluate("document.getElementById('inline-writing-body').getClientRects().length>0"),'writing is open');
        await press('#inline-writing-body');
        await p.send('Input.insertText',{text:'Cabin choice kept exactly'});
        await p.key('ArrowLeft',8); // native Shift-Left makes a real selection
        const writing=await snapshot();
        assert.ok(writing.end > writing.start, 'native Shift-Left selected actual writing');
        await shot(p,label+'-before');
        const wait={text:'Choose a cabin',default:'Keep the current cabin'};
        await act(0,[wait,wait]); await act(1,[wait]);
        await until(async()=>await count()===baseline+2,'item 756 two covers count once each immediately');
        const kept=await snapshot();
        assert.deepEqual(kept,writing,'cover refresh keeps exact writing, native selection, focus and document');
        if(width!==1280) { await p.key('Escape'); await press('#rail-open'); }
        await shot(p,label+'-after');
        if(width===1280) {
          await press('#outline-only-waiting');
          await p.key(' '); // native keyboard toggles it back off
          await p.key('Enter'); // native keyboard activates the filter again
        } else await press('#outline-only-waiting');
        await until(()=>p.evaluate("document.getElementById('outline-only-waiting').getAttribute('aria-pressed')==='true'"),'native pill activation filters');
        for(const tid of seed.topics) await until(()=>p.evaluate(`(()=>{const a=document.querySelector('#outline a[data-topic-id="${tid}"]');return Boolean(a?.getClientRects().length)})()`),'counted cover topic is visible through the filter');
        const geometry=await p.evaluate(`(()=>{const c=document.getElementById('outline-only-waiting').getBoundingClientRect(),r=document.getElementById('rail').getBoundingClientRect();return {left:c.left-r.left,right:c.right-r.right,width:c.width}})()`);
        assert.ok(geometry.left>=-LAYOUT_TOLERANCE_PX && geometry.right<=LAYOUT_TOLERANCE_PX,'pill stays in rail, named 2px rounding tolerance');
        await writeFile(path.join(evidencePath,label+'-geometry.json'),JSON.stringify({geometry,LAYOUT_TOLERANCE_PX}));
        const hand=async (sender,owner)=>{
          const receipt=await control({method:'outcome_change',sender,owner,workspace_id:seed.workspace,operation_id:prefix+'-'+randomUUID()});
          assert.equal(receipt.status,'committed','owner change actually committed');
        };
        await hand('fixture-person',seed.other);
        await until(async()=>await count()===baseline,'old owner no longer counts covers naming someone else');
        await hand(seed.other,'fixture-person');
        await until(async()=>await count()===baseline+2,'restored owner sees just the two readable covers');
        await act(0,[]);
        await until(async()=>await count()===baseline+1,'one cleared cover updates without reload');
        await act(1,[]);
        await until(async()=>await count()===baseline,'both cleared covers restore the original count; hidden whisper never contributes');
        await press('#outline-only-waiting');
        assert.equal(await p.evaluate("document.getElementById('outline-only-waiting').getAttribute('aria-pressed')"),'false','same pill restores unfiltered outcomes');
        assert.equal((await snapshot()).value,writing.value,'native filter keeps writing');
        await shot(p,label+'-cleared');
      } catch(error) {
        await shot(p,label+'-failure');
        await writeFile(path.join(evidencePath,label+'-failure.json'),JSON.stringify({error:error.stack,calls:p.calls.map(c=>c.payload),errors:p.errors},null,2));
        throw error;
      }
      });
    });
  }
}

import assert from 'node:assert/strict';
// Own Notebook cases use the registered Chrome/WebKit adapter and its normal
// fixture/browser cleanup. State injection is at fetch, never at a UI handler.
export async function notebookImages653({check,page,until,control,view,facts,shot}) {
  const sizes={320:{width:320,height:568},375:{width:375,height:667},390:{width:390,height:844},laptop:{width:1280,height:800}};
  const GEOMETRY_PX=2, TOUCH_PX=.5;
  for(const width of [320,375,390,'laptop'])for(const scheme of ['light','dark'])for(const surface of ['sheet','full'])for(const state of ['normal','busy','refused','save-error','read-only','empty','missing','read-error']){
    await check(`notebook item 653 ${width} ${scheme} ${surface} ${state}: whole image stays a small thumbnail and writing survives recovery`,async()=>{
      const id=`nb653-${width}-${scheme}-${surface}-${state}`,image=id+'-media-0';
      const body=state==='empty'?'':`## Picture\nItem 653 exact words.\n![screen.png](attachment:${image})\n${state==='missing'?'![missing.png](attachment:missing-653)':''}`;
      const attachments=state==='empty'?[]:[{name:'screen.png',png:[240,480]}];
      let topic='t1';
      if(state==='read-only'){
        const owned=await control({method:'agent_topic',operation_id:id+'-topic',title:'Read only item 653',body:'Read here.',team:true,watching:true});topic=owned.topic_id;
        assert.equal((await control({method:'agent_page',operation_id:id,item_id:id,topic_id:topic,title:'Read only images',body,attachments})).status,'committed');
      }else assert.equal((await control({method:'outcome_reference',operation_id:id,item_id:id,title:'Item 653 images',body,attachments})).status,'committed');
      const host=surface==='sheet'?'.notebook-sheet-page:not([hidden])':'#deck-page',field=host+' .deck-writing textarea';
      const transport=`(()=>{window.item653State=${JSON.stringify(state)};window.item653Attempts=[];const send=fetch.bind(globalThis);globalThis.fetch=async(...args)=>{
        const url=String(args[0]);if(!url.endsWith('/api/command')&&!url.endsWith('/api/view'))return send(...args);
        const q=JSON.parse(args[1].body);
        if(item653State==='read-error'&&q.name==='memory_current'&&q.args?.item_id===${JSON.stringify(id)})return new Response(JSON.stringify({error:{code:'UNAVAILABLE',message:'Item 653 page read unavailable'}}),{status:503,headers:{'Content-Type':'application/json'}});
        if(q.kind!=='memory.revise'||q.target?.item_id!==${JSON.stringify(id)})return send(...args);
        item653Attempts.push(q);
        if(item653State==='busy')await new Promise(done=>window.item653Release=done);
        if(item653State==='save-error')throw Error('Item 653 lost save answer');
        if(item653State==='refused')return new Response(JSON.stringify({instance_id:q.instance_id,operation_id:q.operation_id,kind:q.kind,status:'rejected',recorded:false,error:{code:'FORBIDDEN',message:'Item 653 access temporarily removed'}}),{headers:{'Content-Type':'application/json'}});
        return send(...args);
      };})()`;
      const p=await page(id,null,true,{url:facts.origin+(surface==='sheet'?`/?topic=${topic}&page=${id}`:`/?cards=${id}`),beforeNavigate:async q=>{
        await q.send('Page.addScriptToEvaluateOnNewDocument',{source:transport});
        await q.send('Emulation.setEmulatedMedia',{features:[{name:'prefers-color-scheme',value:scheme}]});
        await q.send('Emulation.setDeviceMetricsOverride',{...sizes[width],deviceScaleFactor:1,mobile:width!=='laptop'});
        if(width!=='laptop')await q.send('Emulation.setTouchEmulationEnabled',{enabled:true,maxTouchPoints:1});
      }});
      const press=async selector=>{
        await p.evaluate(`document.querySelector(${JSON.stringify(selector)}).scrollIntoView({block:'nearest',behavior:'instant'})`);
        if(width==='laptop')return p.point(selector);
        const b=await p.box(selector);assert.ok(b&&b.width&&b.height,'the native target exists');
        await p.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:b.x+b.width/2,y:b.y+b.height/2}]});
        await p.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
      };
      const geometry=async selector=>{
        await until(()=>p.evaluate(`(()=>{const i=document.querySelector(${JSON.stringify(selector)});return i&&!i.hidden&&i.complete&&i.naturalWidth>0})()`),'item 653 image decoded');
        const g=await p.evaluate(`(()=>{const i=document.querySelector(${JSON.stringify(selector)}),r=i.getBoundingClientRect();return {width:r.width,height:r.height,fit:getComputedStyle(i).objectFit,rem:parseFloat(getComputedStyle(document.documentElement).fontSize)}})()`);
        assert.ok(Math.abs(g.width-3*g.rem)<=GEOMETRY_PX&&Math.abs(g.height-3*g.rem)<=GEOMETRY_PX,'item 653 3rem square: '+JSON.stringify(g));assert.equal(g.fit,'contain');
        if(width!=='laptop')assert.ok(g.width>=44-TOUCH_PX&&g.height>=44-TOUCH_PX);
      };
      try{
        await until(()=>p.evaluate("document.body.dataset.ready==='true'"),'item 653 Notebook ready');
        if(state==='read-error'){
          await until(()=>p.evaluate("document.body.textContent.includes('Item 653 page read unavailable')"),'named read error');
          assert.equal(await p.evaluate(`document.querySelectorAll(${JSON.stringify(host+' .image-thumb:not([hidden])')}).length`),0);
        }else if(state==='empty'){
          await until(()=>p.evaluate(`Boolean(document.querySelector(${JSON.stringify(host+' .deck-empty')}))`),'empty page');
          assert.equal(await p.evaluate(`document.querySelectorAll(${JSON.stringify(host+' .image-thumb')}).length`),0);
        }else{
          await geometry(host+' .deck-card .image-thumb');
          if(state==='missing')assert.equal(await p.evaluate(`document.querySelector(${JSON.stringify(host+' .deck-image[data-state=missing]')})?.textContent.includes('not on this page')`),true);
          if(state==='read-only'){
            await press(host+' .deck-card .deck-words');
            assert.equal(await p.evaluate(`Boolean(document.querySelector(${JSON.stringify(field)}))`),false,'reader cannot edit');
          }else if(['busy','refused','save-error'].includes(state)){
            await press(host+' .deck-bar button:first-of-type');
            await until(()=>p.evaluate(`document.activeElement===document.querySelector(${JSON.stringify(field)})`),'native card press focuses writing');
            // Native insertion changes the card without any synthetic input.
            await p.send('Input.insertText',{text:'Item 653 added writing. '});
            await until(()=>p.evaluate('item653Attempts.length>0'),'a real save attempt');
            if(state==='busy')await until(()=>p.evaluate('Boolean(window.item653Release)'),'save held');
            else await until(()=>p.evaluate(`Boolean(document.querySelector(${JSON.stringify(surface==='sheet'?'.notebook-sheet-status .deck-again':'#deck-page .deck-again')}))`),'recovery offered');
            await geometry(host+' .deck-writing .image-thumb');
            assert.ok((await p.evaluate(`document.querySelector(${JSON.stringify(field)}).value`)).includes('Item 653 added writing.'));
          }
        }
        await shot(p,`item-653-${width}-${scheme}-${surface}-${state}`);
        assert.equal(await p.evaluate('document.documentElement.scrollWidth<=innerWidth+2'),true,'no horizontal page loss');
        if(['busy','refused','save-error'].includes(state)){
          const written=await p.evaluate(`document.querySelector(${JSON.stringify(field)}).value`);
          await p.evaluate("item653State='normal';window.item653Release?.()");
          if(state!=='busy')await press(surface==='sheet'?'.notebook-sheet-status .deck-again':'#deck-page .deck-again');
          await until(async()=> (await view('memory_current',{item_id:id})).body.includes('Item 653 added writing.'),'recovery actually saves');
          assert.equal(await p.evaluate(`document.querySelector(${JSON.stringify(field)}).value`),written,'same writing after recovery');
          await geometry(host+' .deck-writing .image-thumb');await shot(p,`item-653-${width}-${scheme}-${surface}-${state}-recovered`);
        }
        assert.deepEqual(p.errors,[]);
      }finally{
        await p.evaluate("item653State='normal';window.item653Release?.()");
        await p.close();
      }
    });
  }
}

// Spec 9118 §7, amendments 9139/9149/9155/9217. Input is native browser
// pointer/keys; Range is used only to measure where to drag, never to select.
import assert from 'node:assert/strict';
import {native768, RULE} from './text_display_768_fixtures.mjs';
const GAP_TOLERANCE_PX=1, MIN_PARAGRAPH_GAP_PX=4;
export async function textDisplay768Checks({check,page,until,view,control,shot,facts,observations,grant,engine},h) {
  const {seed,open,centre,press,light,closeReader,into,words,card}=h;
  const field='#writing-body', source='#source-body';
  const val=p=>p.evaluate(`document.querySelector('${field}').value`);
  const quote=s=>s.split('\n').map(line=>'> '+line).join('\n')+'\n\n';
  const paragraphCount=(p,host,kind)=>p.evaluate(`document.querySelectorAll(${JSON.stringify(host+(kind==='list'?' .sentence-paragraph':host===source?' > .sentence-paragraph':' > .md-p'))}).length`);
  const ready=(p,id)=>until(()=>p.evaluate(`document.body.dataset.ready==='true'&&Boolean(document.querySelector(${JSON.stringify(card(id))}))`),'item 768 topic ready');
  const reader=(p,id)=>until(()=>p.evaluate(`document.querySelector('#reader').open&&document.querySelector('#source-body').textContent.includes(${JSON.stringify(id)})`),'item 768 Reader open');
  const openSource=async(p,device,id,first)=>{await centre(p,words(id));await press(p,device,words(id));if(!await p.evaluate("document.querySelector('#reader').open"))await press(p,device,words(id));await reader(p,first);};
  const toggle=async(p,device,id,inReader,on)=>{
    if(inReader)await press(p,device,'#reader-menu');
    else {await light(p,device,id);await press(p,device,'.message-bar [data-act=more]');}
    const menu=await until(()=>p.evaluate(`(()=>{const bs=[...document.querySelectorAll('.message-menu-list > button')];return bs.length?bs.map((b,i)=>({i,text:b.firstChild.textContent,checked:b.getAttribute('aria-checked')})):null})()`),'item 768 ellipsis menu opens');
    const entries=menu.filter(b=>b.text.startsWith('Break out paragraphs'));
    assert.equal(entries.length,1,'exactly one existing-menu toggle, feed and Reader');
    assert.equal(entries[0].text,'Break out paragraphs · '+(on?'Off':'On'));
    assert.equal(entries[0].checked,String(!on));
    await press(p,device,`.message-menu-list > button:nth-child(${entries[0].i+1})`);
    await until(()=>p.evaluate("!document.querySelector('.message-menu-list')"),'item 768 toggle closes its menu');
  };
  // Native copy/paste edit commands in Chrome; WebKit receives its own keyboard
  // press. No clipboard stub, synthetic ClipboardEvent or execCommand.
  const copy=async p=>{
    if(engine==='webkit')await p.key('c',4);
    else {const k={key:'c',code:'KeyC',windowsVirtualKeyCode:67,modifiers:4};await p.send('Input.dispatchKeyEvent',{type:'rawKeyDown',...k,commands:['copy']});await p.send('Input.dispatchKeyEvent',{type:'keyUp',...k});}
  };
  const readCopy=async(p,expected,label)=>{
    try {
      let got;
      if(grant)got=await p.evaluate('navigator.clipboard.readText()');
      else {
        await into(p,'laptop',field);await p.key('ArrowDown',4); // native end of reply
        const before=await val(p);await p.key('v',4);
        await until(async()=>await val(p)!==before,label+': native paste changes writing');
        const after=await val(p);assert.ok(after.startsWith(before),'paste appends to retained reply');got=after.slice(before.length);
        await p.key('z',4);await until(async()=>await val(p)===before,label+': native Undo removes paste');
      }
      observations.push({name:'item 768 actual clipboard',engine,label,expected,actual:got});assert.equal(got,expected,label);
    }catch(error){observations.push({name:'item 768 clipboard failure',engine,label,error:String(error),stack:error.stack});throw error;}
  };
  const position=(p,host,word,end=false)=>p.evaluate(`(()=>{const host=document.querySelector(${JSON.stringify(host)}),w=document.createTreeWalker(host,NodeFilter.SHOW_TEXT);let n;
    while(n=w.nextNode()){const at=n.data.indexOf(${JSON.stringify(word)});if(at<0)continue;const r=document.createRange();r.setStart(n,at);r.setEnd(n,at+${word.length});const boxes=[...r.getClientRects()],b=boxes[${end?'boxes.length-1':'0'}];
      const x=${end?'b.right-0.2':'b.left+0.2'},y=b.top+b.height/2;return {x,y,hit:host.contains(document.elementFromPoint(x,y)),inView:y>=0&&y<innerHeight};}return null})()`);
  // Read-only event observers. No selection/range mutation or cancelled default.
  const traceStart=(p,host,label)=>p.evaluate(`(()=>{
    window.item768TraceStop?.();
    const host=document.querySelector(${JSON.stringify(host)}),events=[],handlers=[];
    const describe=n=>n?{node:n.nodeName,id:n.id??null,classes:n.className??null,text:n.nodeType===3?n.data:null}:null;
    const state=()=>{const s=getSelection();return {text:s.toString(),type:s.type,rangeCount:s.rangeCount,collapsed:s.isCollapsed,anchor:describe(s.anchorNode),anchorOffset:s.anchorOffset,focus:describe(s.focusNode),focusOffset:s.focusOffset,active:describe(document.activeElement),focused:document.hasFocus(),visibility:document.visibilityState}};
    for(const [where,target] of [['window',window],['document',document],['card',host.closest('button')??host],['words',host]])for(const capture of [true,false])for(const type of ['pointerdown','pointermove','pointerup','mousedown','mousemove','mouseup','click','selectstart','selectionchange','keydown','keyup','focusin','focusout']){
      const handler=e=>{if(events.length>=1200)return;events.push({where,phase:capture?'capture':'bubble',type:e.type,trusted:e.isTrusted,defaultPrevented:e.defaultPrevented,cancelable:e.cancelable,target:describe(e.target),key:e.key??null,buttons:e.buttons??null,button:e.button??null,shift:e.shiftKey??null,pointerType:e.pointerType??null,x:e.clientX??null,y:e.clientY??null,state:state()})};
      target.addEventListener(type,handler,{capture,passive:true});handlers.push([target,type,handler,capture]);
    }
    window.item768TraceStop=()=>{for(const [target,type,handler,capture]of handlers)target.removeEventListener(type,handler,capture);delete window.item768TraceStop;return {label:${JSON.stringify(label)},events,final:state(),ancestors:[host,...(()=>{const out=[];for(let e=host.parentElement;e;e=e.parentElement)out.push(e);return out})()].map(e=>{const c=getComputedStyle(e),b=e.getBoundingClientRect();return {node:describe(e),userSelect:c.userSelect,webkitUserSelect:c.webkitUserSelect,display:c.display,visibility:c.visibility,pointerEvents:c.pointerEvents,box:{x:b.x,y:b.y,width:b.width,height:b.height}}})}};
    return state();
  })()`);
  const drag=async(p,host,first,last,diagnostic=null)=>{
    await centre(p,host);
    const a=await position(p,host,first),b=await position(p,host,last,true);
    assert.ok(a?.hit&&b?.hit&&a.inView&&b.inView,'native selection endpoints are visible and hit their message');
    const initial=await traceStart(p,host,diagnostic??'own selected interval');
    let selected;
    try{
      await p.send('Input.dispatchMouseEvent',{type:'mouseMoved',x:a.x,y:a.y});
      await p.send('Input.dispatchMouseEvent',{type:'mousePressed',button:'left',clickCount:1,x:a.x,y:a.y});
      for(let k=1;k<=12;k++)await p.send('Input.dispatchMouseEvent',{type:'mouseMoved',button:'left',buttons:1,x:a.x+(b.x-a.x)*k/12,y:a.y+(b.y-a.y)*k/12});
      await p.send('Input.dispatchMouseEvent',{type:'mouseReleased',button:'left',clickCount:1,x:b.x,y:b.y});
      selected=await p.evaluate('getSelection().toString()');
      // Harmless native modifier keys expose the key route without Copy/Return
      // when the drag has no selection. They do not manufacture an interval.
      if(diagnostic){if(engine==='webkit')await p.key('Shift');else {await p.send('Input.dispatchKeyEvent',{type:'rawKeyDown',key:'Shift',code:'ShiftLeft',windowsVirtualKeyCode:16,modifiers:8});await p.send('Input.dispatchKeyEvent',{type:'keyUp',key:'Shift',code:'ShiftLeft',windowsVirtualKeyCode:16,modifiers:0});}}
    }finally{
      const trace=await p.evaluate('window.item768TraceStop()');
      observations.push({name:'item 768 native drag',engine,host,first,last,selected,diagnostic,a,b,initial,trace});
    }
    if(!diagnostic)assert.ok(selected.startsWith(first)&&selected.endsWith(last),'native drag selects the intended exact endpoints: '+JSON.stringify(selected));
    return selected;
  };
  const rest=async(p,host,word)=>{
    await centre(p,host);const a=await position(p,host,word);assert.ok(a?.hit&&a.inView,'lit word is reachable');
    // A native click collapses prior selection and moves focus out of writing.
    // Reader text does not open another surface. Feed uses movement alone.
    if(host===source){await p.send('Input.dispatchMouseEvent',{type:'mousePressed',button:'left',clickCount:1,x:a.x,y:a.y});await p.send('Input.dispatchMouseEvent',{type:'mouseReleased',button:'left',clickCount:1,x:a.x,y:a.y});}
    await p.send('Input.dispatchMouseEvent',{type:'mouseMoved',x:a.x+1,y:a.y});
    await until(()=>p.evaluate(host===source?"Boolean(document.querySelector('#source-body .hover-quote'))":"Boolean(CSS.highlights.get('lit-passage')?.size)"),'item 768 native pointer lights a passage');
  };
  const clearReply=async(p,device)=>{await into(p,device,field);await p.key('a',4);await p.key('Backspace');await p.send('Input.insertText',{text:'Kept writing'});await until(async()=>await val(p)==='Kept writing','item 768 writing retained baseline');};
  const checkGap=async(p,label)=>{
    const gap=()=>p.evaluate(`(()=>{const [a,b]=document.querySelectorAll('#source-body > .sentence-paragraph');return b.getBoundingClientRect().top-a.getBoundingClientRect().bottom})()`);
    const holds=g=>assert.ok(g>=MIN_PARAGRAPH_GAP_PX-GAP_TOLERANCE_PX,`sentence paragraph gap at least ${MIN_PARAGRAPH_GAP_PX}px, tolerance ${GAP_TOLERANCE_PX}px: ${g}`);
    holds(await gap());
    await p.evaluate("(()=>{const s=document.createElement('style');s.id='item-768-gap-mutant';s.textContent='#source-body > .sentence-paragraph{display:inline!important;margin:0!important}';document.head.append(s);return true})()");
    try{const bad=await gap();assert.throws(()=>holds(bad),/sentence paragraph gap/,'actual collapsed-paragraph geometry mutant caught');observations.push({name:'item 768 geometry mutant',label,bad,GAP_TOLERANCE_PX,MIN_PARAGRAPH_GAP_PX});}
    finally{await p.evaluate("document.getElementById('item-768-gap-mutant').remove()");}
    holds(await gap());
  };
  await check('reading item 768 diagnostic Off/On: same authored interval in separate owned documents',async()=>{
    const f=native768.sentence,topic='item-768-diagnostic',ids=await seed(topic,[['m',{sender:'aim-core',join:true,addressees:[facts.actor],body:f.body}]]),comparison=[];
    // Chromium's first diagnostic proved that reload+ready could accept the old
    // document. Each phase now opens a new owned target at the explicit topic
    // URL; no readiness read can come from a document it is replacing.
    for(const on of [false,true]){
      const p=await open(topic+(on?'-on':'-off'),'laptop',topic,ids.m);
      try{
        assert.equal(await paragraphCount(p,words(ids.m),'sentence'),1,'comparison starts Off');
        if(on){await toggle(p,'laptop',ids.m,false,true);await until(async()=>await paragraphCount(p,words(ids.m),'sentence')===f.paragraphs,'diagnostic On partitions');}
        comparison.push({on,selected:await drag(p,words(ids.m),f.first,f.last,'candidate '+(on?'On':'Off')),first:f.first,last:f.last});
      }finally{await p.close();}
    }
    observations.push({name:'item 768 Off/On comparison',engine,comparison,separateOwnedDocuments:true,oneAuthoredInterval:true});
  });
  await check('reading item 768 diagnostic defaults: standalone button and plain text receive the same native gesture',async()=>{
    const topic='item-768-default-controls',ids=await seed(topic,[['m',{sender:'aim-core',join:true,addressees:[facts.actor],body:native768.sentence.body}]]);
    const p=await open(topic,'laptop',topic,ids.m);
    try{
      // These separate explanatory controls retain browser defaults. No product
      // node, event handler or user-select value is changed.
      await p.evaluate(`(()=>{const c=document.createElement('div');c.id='item768-controls';Object.assign(c.style,{position:'fixed',top:'100px',left:'100px',zIndex:'99999',background:'white',color:'black'});for(const tag of ['button','div']){const e=document.createElement(tag);e.id='item768-'+tag;e.textContent='Alpha native control Omega';c.append(e)}document.body.append(c);return true})()`);
      await drag(p,'#item768-button','Alpha','Omega','standalone default button');
      const plain=await drag(p,'#item768-div','Alpha','Omega','standalone default div');
      assert.equal(plain,'Alpha native control Omega','same native gesture selects actual plain text');
      assert.deepEqual(p.errors,[]);
    }finally{await p.close();}
  });
  await check('reading item 768 diagnostic prefeature: authenticated actual public bytes receive the native card drag',async()=>{
    const f=native768.sentence,topic='item-768-prefeature',ids=await seed(topic,[['m',{sender:'aim-core',join:true,addressees:[facts.actor],body:f.body}]]);
    let p,runtimeChanged=false;
    try{
      // Select the isolated immutable Build before opening any document. This
      // avoids both stale reload readiness and activation changing its address.
      runtimeChanged=true;
      const before=await control({method:'item_768_runtime',phase:'prefeature'});
      observations.push({name:'item 768 diagnostic source',engine,...before});
      assert.equal(before.source,'3187c1bc851bdb256c272928a00dce974e2c8e48');
      p=await open(topic,'laptop',topic,ids.m);
      const loaded=await p.evaluate("[...document.querySelectorAll('script[type=module]')].map(e=>e.src)");
      assert.ok(loaded.some(url=>url.includes('/b/'+before.stamp+'/app.mjs')),'actual prefeature document binds the selected immutable build');
      observations.push({name:'item 768 prefeature loaded module',engine,loaded,stamp:before.stamp});
      await drag(p,words(ids.m),f.first,f.last,'actual prefeature');
      assert.deepEqual(p.errors,[]);
    }finally{
      try{if(p)await p.close();}
      finally{if(runtimeChanged){const restored=await control({method:'item_768_runtime',phase:'restored'});observations.push({name:'item 768 diagnostic restored source',engine,...restored});assert.equal(restored.restored,true);}}
    }
  });
  for(const device of ['laptop','phone'])for(const [kind,f] of Object.entries(native768)) {
    await check(`reading item 768 ${device} ${kind}: native card/Reader selection, Copy, light, Return, toggle and reload; gap tolerance 1px`,async()=>{
      const label=`item-768-${device}-${kind}`,topic=label,ids=await seed(topic,[['m',{sender:'aim-core',join:true,addressees:[facts.actor],body:f.body}]]);
      const p=await open(label,device,topic,ids.m);
      try{
        if(grant)await grant(['clipboard-read','clipboard-write']);
        const documentId=await p.evaluate('(window.item768Document=crypto.randomUUID())');
        const original=await view('source',{source_ref:{kind:'message',id:ids.m}});
        const off=await p.evaluate(`document.querySelector(${JSON.stringify(words(ids.m))}).textContent`);
        const marks=()=>p.evaluate(`[...document.querySelectorAll(${JSON.stringify(words(ids.m)+' strong, '+words(ids.m)+' em, '+words(ids.m)+' code, '+words(ids.m)+' a')})].map(e=>[e.tagName,e.textContent])`);
        const protectedBefore=await marks();
        assert.equal(await paragraphCount(p,words(ids.m),kind),kind==='list'?0:1,'default Off');
        await toggle(p,device,ids.m,false,true);
        await until(async()=>await paragraphCount(p,words(ids.m),kind)===f.paragraphs,'card draws enabled partitions');
        assert.deepEqual(await marks(),protectedBefore,'protected formatted marks stay whole');
        await shot(p,label+'-card-on');
        await drag(p,words(ids.m),f.first,f.last);await copy(p);await p.key('Enter');await reader(p,f.first);
        const q=quote(f.expected);await until(async()=>await val(p)===q,'card native Return quotes exact authored slice');
        await readCopy(p,f.expected,label+' card selected Copy');
        await clearReply(p,device);
        assert.equal(await paragraphCount(p,source,kind),f.paragraphs,'Reader agrees with card');
        if(kind==='sentence')await checkGap(p,label);
        await drag(p,source,f.first,f.last);await copy(p);await p.key('Enter');
        await until(async()=>await val(p)==='Kept writing\n\n'+q,'Reader Return quotes exact selected source without display gaps');
        await readCopy(p,f.expected,label+' Reader selected Copy');
        await clearReply(p,device);
        const next=kind==='sentence'?f.body.indexOf('Gamma'):kind==='enumerator'?f.body.indexOf('3)'):f.body.indexOf('2)');
        const start=kind==='sentence'?f.body.indexOf('Beta'):kind==='enumerator'?f.body.indexOf('2)'):0;
        const rawLight=f.body.slice(start,next);
        await rest(p,source,f.target);await copy(p);await p.key('Enter');
        await until(async()=>await val(p)==='Kept writing\n\n'+quote(rawLight),'Reader lit Return uses exact authored interval');
        await readCopy(p,rawLight.trimEnd(),label+' Reader lit Copy');
        const kept=await val(p),url=await p.evaluate('location.href');
        await toggle(p,device,ids.m,true,false);
        assert.equal(await val(p),kept,'Off redraw retains reply');assert.equal(await p.evaluate('location.href'),url,'toggle keeps document address');assert.equal(await p.evaluate('window.item768Document'),documentId,'toggle redraws without reload');
        assert.equal(await p.evaluate("document.querySelectorAll('#source-body .sentence-paragraph').length"),0,'Off redraws immediately');
        // Off retains the original formatted native Copy contract: no Markdown marks.
        if(kind!=='enumerator'){
          await drag(p,source,'bold','bold');await copy(p);await readCopy(p,'bold',label+' Off native formatted selection');
        }
        await toggle(p,device,ids.m,true,true);assert.equal(await val(p),kept,'On retains writing');
        await shot(p,label+'-reader-on');
        await closeReader(p,device);
        // A card light after Reader close: pointer movement, then native Copy/Return.
        await rest(p,words(ids.m),f.target);await copy(p);await p.key('Enter');await reader(p,f.first);
        await until(async()=>(await val(p)).endsWith(quote(rawLight)),'card lit Return exact authored interval');
        await readCopy(p,rawLight.trimEnd(),label+' card lit Copy');
        await closeReader(p,device);
        await p.send('Page.reload');await ready(p,ids.m);
        assert.equal(await paragraphCount(p,words(ids.m),kind),f.paragraphs,'On persists across actual reload');
        await openSource(p,device,ids.m,f.first);
        assert.ok((await val(p)).startsWith(kept),'reload retains writing');
        await toggle(p,device,ids.m,true,false);await closeReader(p,device);
        assert.equal(await p.evaluate(`document.querySelector(${JSON.stringify(words(ids.m))}).textContent`),off,'Off restores original drawing');
        await p.send('Page.reload');await ready(p,ids.m);assert.equal(await paragraphCount(p,words(ids.m),kind),kind==='list'?0:1,'Off persists');
        const after=await view('source',{source_ref:{kind:'message',id:ids.m}});
        assert.deepEqual([after.body,after.revision],[original.body,original.revision],'display and quoting do not change saved source');
        assert.deepEqual(p.errors,[]);
      }finally{await p.close();}
    });
  }
  await check('reading item 768 actual browser storage isolates reader, instance and another device',async()=>{
    const topic='item-768-isolation',ids=await seed(topic,[['m',{sender:'aim-core',join:true,addressees:[facts.actor],body:native768.sentence.body}]]);
    const p=await open(topic,'laptop',topic,ids.m);let other;
    try{
      await toggle(p,'laptop',ids.m,false,true);
      const scope=await p.evaluate(`(async()=>{const {TextDisplayPreferences:P}=await import([...document.querySelectorAll('script[type=module]')][0].src.replace(/[^/]+$/,'text-display-rules.mjs'));return {same:new P(${JSON.stringify(facts.instance_id)},${JSON.stringify(facts.actor)},localStorage).enabled,reader:new P(${JSON.stringify(facts.instance_id)},'item-768-other-reader',localStorage).enabled,instance:new P('item-768-other-instance',${JSON.stringify(facts.actor)},localStorage).enabled}})()`);
      assert.deepEqual(scope,{same:[RULE],reader:[],instance:[]},'actual browser localStorage scopes by instance and reader');
      other=await page('item-768-other-device',null,true,{isolatedDevice:true,url:facts.origin+'/?topic='+topic});await ready(other,ids.m);
      assert.equal(await paragraphCount(other,words(ids.m),'sentence'),1,'fresh browser device storage defaults Off while first device is On');
      assert.equal(await paragraphCount(p,words(ids.m),'sentence'),3,'another device does not alter first');
      observations.push({name:'item 768 isolation',engine,scope,separateBrowserContext:true});
    }finally{if(other)await other.close();await p.close();}
  });
}

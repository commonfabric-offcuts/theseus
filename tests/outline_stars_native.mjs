import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import {observeReader, readerSnapshot, assertReaderDestination} from './outline_stars_oracle.mjs';

const WIDTHS = [320, 375, 390, 1280];
// Measured geometry tolerances: 2px absorbs engine rounding but cannot hide a
// missing 12px indent, a 36px touch target, or a row wider than its parent.
const GEOMETRY_TOLERANCE_PX = 2;
const TOUCH_TARGET_TOLERANCE_PX = 0.75;
const row = id => `#outline .ol-dossier[data-dossier-id="${id}"]`;

export async function item715Checks({check, page, until, control, view, facts, shot, observations, evidencePath}) {
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
    const group=await p.evaluate(`Boolean(document.querySelector('#outline a[data-topic-id="${seed.topic}"]')?.closest('details:not([open])'))`);
    if(group) await press(p,`#outline .ol-outcome[data-workspace-id="${seed.workspace}"] details:has(a[data-topic-id="${seed.topic}"]) > summary`,width);
    await p.evaluate(observeReader);
    await shot(p, label+'-initial'); // actual unmodified baseline, even while the feature is absent
    return p;
  };
  const capture = async (p, label, error = null) => {
    const actual=await p.evaluate(readerSnapshot);
    await writeFile(path.join(evidencePath,label+'-state.json'),JSON.stringify({actual,error:error?.stack??null,
      calls:p.calls.map(c=>c.payload),errors:p.errors},null,2));
    await shot(p,label);
    return actual;
  };
  const opened = async (p, root, topic, label) => {
    await until(()=>p.evaluate('Boolean(document.querySelector("#reader")?.open)'), 'native title press opens a Reader');
    const actual=await capture(p,label);
    const legacyURL={expected:root,actual:new URL(actual.url).searchParams.get('message')};
    legacyURL.passed=legacyURL.actual===legacyURL.expected;
    await writeFile(path.join(evidencePath,label+'-oracle.json'),JSON.stringify({legacyURL,actual,expected:{root,topic}},null,2));
    observations.push({name:'item715 native red-first URL observation then Reader oracle',label,root,topic,legacyURL,actual});
    assertReaderDestination(actual,root,topic);
    return actual;
  };
  const loaded = (p, seed) => until(()=>p.evaluate(`document.querySelector('#outline .ol-dossiers[data-parent-topic-id="${seed.topic}"]')?.dataset.loaded==='true' && document.querySelector('#outline .ol-dossiers[data-parent-topic-id=\"${seed.topic}\"]').getAttribute('aria-busy')==='false'`), 'the scoped starred dossier read has settled under its parent');
  const act = async (seed, root, kind, args, prefix) => {
    const answer = await control({method:'item715_act',operation_id:prefix+'-'+randomUUID(),message_id:root,kind,args});
    assert.equal(answer.status,'committed','fixture act actually committed');
  };
  for(const width of WIDTHS) for(const theme of ['light','dark']) {
    for(const state of ['available','empty','updates','busy','error','refused','keyboard','read-only','folded','unloaded','guarded','actor-isolation']) {
      await check(`rail item 715 ${state} at ${width} ${theme}, geometry tolerance 2px and touch tolerance 0.75px`,async()=>{
        const label=`item715-${state}-${width}-${theme}`, prefix=label+'-'+randomUUID();
        const seed=await control({method:'item715_seed',operation_id:prefix,empty:state==='empty',read_only:state==='read-only',unloaded:state==='unloaded',cross_topic:state==='guarded'});
        const p=await up(seed,width,theme,label);
        let closed=false;
        try {
          await loaded(p,seed);
          if(state==='guarded') await until(()=>p.evaluate(`Boolean(document.querySelector(${JSON.stringify(row(seed.unloaded.root))}))`),'the cross-topic fixture title has loaded');
          if(state==='empty') {
            assert.equal(await p.evaluate(`document.querySelectorAll('#outline .ol-dossier').length`),0,'an empty parent adds no dossier or duplicate group');
            await shot(p,label); return;
          }
          const ids = await p.evaluate(`[...document.querySelectorAll('#outline .ol-dossiers[data-parent-topic-id="${seed.topic}"] .ol-dossier')].map(e=>e.dataset.dossierId)`);
          assert.deepEqual(ids,[...seed.roots].reverse(),'newest stars first, equal titles retain separate real identities');
          assert.equal(await p.evaluate(`document.querySelector(${JSON.stringify(row(seed.roots[3]))}).textContent.trim()`),'★ Fallback words 3','empty name uses the feed preview');
          const geometry=await p.evaluate(`(()=>{const parent=document.querySelector('#outline a[data-topic-id="${seed.topic}"]'), pr=parent.getBoundingClientRect();
            return [...document.querySelectorAll('#outline .ol-dossier')].map(e=>{const b=e.getBoundingClientRect(),c=getComputedStyle(e);return {left:b.left-pr.left,right:b.right-pr.right,height:b.height,color:c.color,parent:getComputedStyle(parent).color,bg:getComputedStyle(document.documentElement).backgroundColor,title:e.title,level:e.getAttribute('aria-level')}})})()`);
          await writeFile(path.join(evidencePath,label+'-geometry.json'),JSON.stringify({geometry,GEOMETRY_TOLERANCE_PX,TOUCH_TARGET_TOLERANCE_PX},null,2));
          for(const g of geometry) {
            assert.ok(g.left>=12-GEOMETRY_TOLERANCE_PX,'children are visibly tucked under their parent, tolerance 2px');
            assert.ok(g.right<=GEOMETRY_TOLERANCE_PX,'long titles stay within the parent width, tolerance 2px');
            assert.ok(g.height>=44-TOUCH_TARGET_TOLERANCE_PX,'each child is a 44px touch target, tolerance 0.75px');
            assert.notEqual(g.color,g.parent,'titles use a distinct theme color');
            const luminance = color => {const channels=color.match(/[\d.]+/g).slice(0,3).map(v=>{const c=Number(v)/255;return c<=.04045?c/12.92:((c+.055)/1.055)**2.4;});return channels[0]*.2126+channels[1]*.7152+channels[2]*.0722;};
            const a=luminance(g.color),b=luminance(g.bg);
            assert.ok((Math.max(a,b)+.05)/(Math.min(a,b)+.05)>=4.5,'distinct text meets 4.5:1 contrast in its theme');
            assert.ok(g.title.length>0,'each title has a tooltip');
            assert.equal(g.level,state==='read-only'?'4':'3','children are in the outline tree at the topic child level');
          }
          await shot(p,label);
          if(state==='folded') {
            await press(p,`#outline a[data-topic-id="${seed.topic}"]`,width);
            if(width!==1280 && !await p.evaluate("document.getElementById('rail').classList.contains('open')")) await press(p,'#rail-open',width);
            await p.key('ArrowLeft',4);
            await until(()=>p.evaluate(`!document.querySelector('#outline .ol-outcome[data-workspace-id="${seed.workspace}"]').hasAttribute('data-open')`),'native folding hides the parent');
            const before=p.calls.filter(c=>c.payload?.name==='stars'&&c.payload.args?.topic_id===seed.topic).length;
            p.recordResponses();
            await act(seed,seed.roots[3],'stack.name',{name:'Changed while folded'},prefix);
            await until(()=>p.responses.some(r=>r.payload?.name==='workspaces'),'the commit has refreshed the folded outline');
            assert.equal(p.calls.filter(c=>c.payload?.name==='stars'&&c.payload.args?.topic_id===seed.topic).length,before,'a folded parent starts no scoped star reads');
            assert.equal(await p.evaluate(`document.querySelectorAll('#outline .ol-dossier').length`),0,'folding removes every child title');
            await p.key('ArrowRight',4); await loaded(p,seed);
            await until(()=>p.evaluate(`document.querySelector(${JSON.stringify(row(seed.roots[3]))})?.textContent==='★ Changed while folded'`),'unfolding refreshes the title');
          }
          if(state==='unloaded') {
            assert.equal(await p.evaluate(`Boolean(document.querySelector('#outline a[data-topic-id="${seed.unloaded.topic}"]'))`),false,'the old parent is outside the loaded range');
            assert.equal(await p.evaluate(`Boolean(document.querySelector(${JSON.stringify(row(seed.unloaded.root))}))`),false,'an unloaded parent has no orphan title');
            assert.equal(p.calls.some(c=>c.payload?.name==='stars'&&c.payload.args?.topic_id===seed.unloaded.topic),false,'an unloaded parent starts no star read');
            await press(p,'#more-topics',width);
            await until(()=>p.evaluate(`Boolean(document.querySelector(${JSON.stringify(row(seed.unloaded.root))}))`),'native More topics brings the old parent and its own starred dossier');
            assert.equal(await p.evaluate(`document.querySelector(${JSON.stringify(row(seed.unloaded.root))}).closest('.ol-dossiers').previousElementSibling.dataset.topicId`),seed.unloaded.topic,'the title belongs to that loaded parent');
          }
          if(state==='guarded') {
            await press(p,row(seed.roots[0]),width);
            await opened(p,seed.roots[0],seed.topic,label+'-original');
            await p.point('#writing-body');
            const fault=await control({method:'item715_save_fault',enabled:true});
            assert.equal(fault.enabled,true,'isolated save refusal is installed before typing');
            const writing='Exact words kept for this original dossier — '+prefix;
            await p.send('Input.insertText',{text:writing}); await p.key('Escape');
            await until(()=>p.evaluate('!document.getElementById("reader").open'),'Escape keeps the reply and closes its Reader');
            if(width!==1280) await press(p,'#rail-open',width);
            await press(p,row(seed.roots[3]),width);
            const same=await opened(p,seed.roots[3],seed.topic,label+'-same-topic');
            assert.equal(same.navigation.includes('not confirmed saved'),false,'same-topic Reader opening does not invoke the leave-topic guard');
            assert.equal(same.writing,'','another source does not inherit the original reply');
            await p.key('Escape');
            await until(()=>p.evaluate('!document.getElementById("reader").open'),'close the other source');
            if(width!==1280) await press(p,'#rail-open',width);
            await press(p,row(seed.roots[0]),width);
            const returned=await opened(p,seed.roots[0],seed.topic,label+'-returned');
            assert.equal(returned.writing,writing,'returning to the original source retains exact writing and destination');
            await p.key('Escape');
            await until(()=>p.evaluate('!document.getElementById("reader").open'),'close before leaving the topic');
            if(width!==1280) await press(p,'#rail-open',width);
            await press(p,row(seed.unloaded.root),width);
            await until(()=>p.evaluate(`document.getElementById('topic-navigation-status').textContent.includes('not confirmed saved')`),'cross-topic navigation is refused by the real writing guard');
            const originalRowState = `(()=>{
              const rail=document.getElementById('rail'), parent=document.querySelector('#outline a[data-topic-id="${seed.topic}"]'),
                group=document.querySelector('#outline .ol-dossiers[data-parent-topic-id="${seed.topic}"]'),
                original=group?.querySelector('.ol-dossier[data-dossier-id="${seed.roots[0]}"]');
              const visible=e=>Boolean(e && e.getClientRects().length && !e.closest('[inert]') && getComputedStyle(e).visibility==='visible');
              const actual={drawerOpen:rail?.classList.contains('open')??false,topic:new URL(location.href).searchParams.get('topic'),
                parentPresent:Boolean(parent),parentVisible:visible(parent),groupPresent:Boolean(group),
                parentTopic:group?.previousElementSibling?.dataset.topicId??null,loaded:group?.dataset.loaded??null,busy:group?.getAttribute('aria-busy')??null,
                rowPresent:Boolean(original),rowVisible:visible(original),dossier:original?.dataset.dossierId??null,
                href:original?.getAttribute('href')??null,notice:group?.textContent??null};
              actual.ready=actual.topic===${JSON.stringify(seed.topic)} && actual.parentVisible && actual.parentTopic===${JSON.stringify(seed.topic)} &&
                actual.loaded==='true' && actual.busy==='false' && actual.rowVisible && actual.dossier===${JSON.stringify(seed.roots[0])};
              return actual;
            })()`;
            const captureOriginalRow = async (phase, error = null) => {
              const actual=await p.evaluate(originalRowState);
              await writeFile(path.join(evidencePath,label+'-'+phase+'-navigation-state.json'),JSON.stringify({actual,
                expected:{topic:seed.topic,dossier:seed.roots[0]},error:error?.stack??null},null,2));
              observations.push({name:'item715 guarded original row readiness',label,phase,actual});
              await shot(p,label+'-'+phase+'-navigation');
              return actual;
            };
            await captureOriginalRow('cross-topic-refused');
            const refused=await capture(p,label+'-cross-topic-refused');
            assert.equal(new URL(refused.url).searchParams.get('topic'),seed.topic,'refusal keeps the original topic');
            assert.equal(refused.open,false,'refusal opens no Reader in the other topic');
            assert.equal(refused.writing,writing,'refusal retains the exact writing');
            assert.deepEqual(refused.context.sourceRef,{kind:'message',id:seed.roots[0]},'refusal keeps the original reply source');
            assert.equal(refused.context.topicId,seed.topic,'refusal keeps the exact reply destination');
            assert.equal(p.calls.some(c=>c.payload?.kind==='message.send'),false,'pressing a title sends no writing');
            const restored=await control({method:'item715_save_fault',enabled:false});
            assert.ok(restored.refused>fault.refused,'the guard encountered an actual failed save');
            const afterRestoration=await captureOriginalRow('fault-restored');
            // A refused link press also closes the phone drawer and removes its children.
            if(width!==1280 && !afterRestoration.drawerOpen) await press(p,'#rail-open',width);
            try {
              await until(async()=> (await p.evaluate(originalRowState)).ready,
                'the original topic has its loaded, nonbusy, visible original dossier row after native drawer reopening');
            } catch(error) {
              const actual=await captureOriginalRow('unsupported-original-row',error);
              throw Error('Unsupported original row readiness: '+JSON.stringify(actual)+'; '+error.message);
            }
            const ready=await captureOriginalRow('original-row-ready');
            assert.equal(ready.ready,true,'Unsupported original row readiness: '+JSON.stringify(ready));
            await press(p,row(seed.roots[0]),width);
            const kept=await opened(p,seed.roots[0],seed.topic,label+'-writing-kept');
            assert.equal(kept.writing,writing,'the original reply remains readable after the guard');
            await p.key('Escape');
            await until(()=>p.evaluate('!document.getElementById("reader").open'),'close before retrying the actual destination');
            if(width!==1280) await press(p,'#rail-open',width);
            await press(p,row(seed.unloaded.root),width);
            await until(()=>p.evaluate(`new URL(location.href).searchParams.get('topic')===${JSON.stringify(seed.unloaded.topic)} && document.body.dataset.ready==='true'`),'the restored save allows the actual destination');
            // Moving in place loads a new app module, while Reader remains the shared build module.
            const destination=await opened(p,seed.unloaded.root,seed.unloaded.topic,label+'-cross-topic-restored');
            assert.equal(destination.writing,'','the new topic inherits no original writing');
            const saved=await view('editor_state',{source_ref:{kind:'message',id:seed.roots[0]},topic_id:seed.topic,limit:10,unsent:true});
            assert.equal(saved.draft.body,writing,'Core holds the exact original writing after the allowed move');
            assert.deepEqual(saved.source_ref,{kind:'message',id:seed.roots[0]});
            assert.deepEqual(saved.destination,{topic_id:seed.topic});
            observations.push({name:'item715 same-topic and cross-topic writing',label,fault,restored,writing,saved});
          }
          if(state==='actor-isolation') {
            assert.deepEqual(p.errors,[]);
            await capture(p,label+'-primary-before-close');
            await p.close(); closed=true;
            await control({method:'server_stop'});
            Object.assign(facts,await control({method:'server_start',as_actor:'fixture-715-other'}));
            let q;
            try {
              q=await up(seed,width,theme,label+'-other-actor'); await loaded(q,seed);
              assert.equal(await q.evaluate(`document.querySelectorAll('#outline .ol-dossier').length`),0,'the other actor inherits no personal star or private title');
              await q.close(); q=null;
              const removed=await control({method:'item715_access',workspace:seed.workspace,operation_id:prefix+'-remove'});
              assert.equal(removed.status,'committed','membership actually removed');
              q=await page(label+'-denied',null,true,{url:facts.origin+'/?topic='+seed.topic,allowStartupError:true,beforeNavigate:async p=>{
                await p.send('Emulation.setEmulatedMedia',{features:[{name:'prefers-color-scheme',value:theme}]});
                await p.send('Emulation.setDeviceMetricsOverride',{width,height:900,deviceScaleFactor:1,mobile:width!==1280});
              }});
              await until(()=>q.evaluate(`!document.getElementById('app-status').hidden && document.getElementById('app-status').textContent.length>0`),'actual denied membership is shown');
              assert.equal(await q.evaluate(`document.querySelectorAll('#outline .ol-dossier').length`),0,'a denied actor sees no titles from the previous actor');
              assert.deepEqual(q.errors,[]);
              await shot(q,label+'-denied');
            } catch(error) {
              if(q) await capture(q,label+'-actor-failure',error);
              throw error;
            } finally {
              await q?.close(); await control({method:'server_stop'}); Object.assign(facts,await control({method:'server_start'}));
            }
          }
          if(state==='actor-isolation') return;
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
              const answer={instance_id:facts.instance_id,error:{code:state==='refused'?'FORBIDDEN':'DATABASE_BUSY',message:'Scoped read unavailable',retryable:state==='error'}};
              if(held.route) await held.route.fulfill({status:200,json:answer});
              else await p.send('Fetch.fulfillRequest',{requestId:held.event.requestId,responseCode:200,responseHeaders:[{name:'Content-Type',value:'application/json'}],body:Buffer.from(JSON.stringify(answer)).toString('base64')});
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
            if(width!==1280 && !await p.evaluate("document.getElementById('rail').classList.contains('open')")) await press(p,'#rail-open',width);
            await p.key('ArrowDown');
            await until(()=>p.evaluate(`document.activeElement?.dataset.dossierId===${JSON.stringify(seed.roots[3])}`),'native Down reaches the first child');
            await p.key('ArrowLeft');
            assert.equal(await p.evaluate('document.activeElement?.dataset.topicId'),seed.topic,'Left returns to the actual parent');
            await p.key('ArrowDown'); await p.key('Enter');
          } else if(['available','read-only','folded','unloaded'].includes(state)) {
            await press(p,row(state==='unloaded'?seed.unloaded.root:seed.roots[3]),width);
          }
          if(['available','keyboard','read-only','folded','unloaded'].includes(state)) {
            await opened(p,state==='unloaded'?seed.unloaded.root:seed.roots[3],state==='unloaded'?seed.unloaded.topic:seed.topic,label+'-opened');
          }
          assert.deepEqual(p.errors,[]);
        } catch(error) {
          if(!closed) await capture(p,label+'-failure-before-close',error);
          throw error;
        } finally {
          if(state==='guarded') await control({method:'item715_save_fault',enabled:false});
          if(!closed) await p.close();
        }
      });
    }
  }
  const mutations = [
    {name:'indent',file:'rails.css',from:'.ol-dossiers{margin:0 0 .15rem .9rem;',to:'.ol-dossiers{margin:0 0 .15rem 0;',expected:/tucked/},
    {name:'touch',file:'rails.css',from:'.ol-dossier{display:block;min-height:44px;',to:'.ol-dossier{display:block;min-height:30px;height:30px;',expected:/44px/},
    {name:'color',file:'rails.css',from:'padding:.55rem .5rem;color:var(--warn);font-size:.85rem',to:'padding:.55rem .5rem;color:var(--accent);font-size:.85rem',expected:/distinct/},
    {name:'route',file:'outline-dossiers.mjs',from:"this.outline.open({kind:'topic',id:state.id,message:id}, link.title);",to:"this.outline.open({kind:'topic',id:state.id,message:state.stars.find(s=>s.dossier.id!==id).dossier.id}, link.title);",expected:/canonical root/},
  ];
  const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
  for(const mutation of mutations) await check(`rail item 715 applied ${mutation.name} source mutant and restored control`,async()=>{
    const source=new URL('../web/'+mutation.file,import.meta.url), original=await readFile(source);
    assert.equal(original.toString().split(mutation.from).length-1,1,'the intended source mutant applies exactly once');
    const changed=Buffer.from(original.toString().replace(mutation.from,mutation.to));
    const evidence=path.join(evidencePath,'item715-mutants',mutation.name);
    await mkdir(evidence,{recursive:true});
    await writeFile(path.join(evidence,'original-source.txt'),original);
    await writeFile(path.join(evidence,'mutated-source.txt'),changed);
    const probe=async phase=>{
      // A fresh operation identity and a fresh native page for every mutant/control.
      const label='item715-'+mutation.name+'-'+phase, seed=await control({method:'item715_seed',operation_id:label+'-'+randomUUID()});
      const p=await up(seed,390,'dark',label);
      try {
        await loaded(p,seed);
        const g=await p.evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(row(seed.roots[3]))}),b=e.getBoundingClientRect(),p=e.closest('.ol-dossiers').previousElementSibling.getBoundingClientRect();return {indent:b.left-p.left,height:b.height,color:getComputedStyle(e).color,token:getComputedStyle(e).getPropertyValue('--warn').trim()}})()`);
        await writeFile(path.join(evidence,label+'-geometry.json'),JSON.stringify({phase,g,GEOMETRY_TOLERANCE_PX,TOUCH_TARGET_TOLERANCE_PX},null,2));
        await capture(p,label+'-before-assertion');
        if(mutation.name==='indent') assert.ok(g.indent>=12-GEOMETRY_TOLERANCE_PX,'children are tucked under the parent, tolerance 2px');
        if(mutation.name==='touch') assert.ok(g.height>=44-TOUCH_TARGET_TOLERANCE_PX,'44px touch target, tolerance 0.75px');
        if(mutation.name==='color') {
          const parent=await p.evaluate(`getComputedStyle(document.querySelector('#outline a[data-topic-id=\"${seed.topic}\"]')).color`);
          assert.notEqual(g.color,parent,'the dossier title has a distinct readable color from its parent');
        }
        if(mutation.name==='route') {
          await press(p,row(seed.roots[3]),390);
          await opened(p,seed.roots[3],seed.topic,label+'-canonical-root');
        }
        await shot(p,label);
        assert.deepEqual(p.errors,[]);
      } catch(error) {
        await capture(p,label+'-failure-before-close',error);
        throw error;
      } finally {await p.close();}
    };
    await control({method:'server_stop'});
    let failure;
    try {
      await writeFile(source,changed);
      assert.equal(digest(await readFile(source)),digest(changed),'mutant bytes actually applied');
      Object.assign(facts,await control({method:'server_start'}));
      try {await probe('mutant');} catch(error) {failure=error;}
      assert.ok(failure && failure.code==='ERR_ASSERTION' && mutation.expected.test(failure.message),'the intended native assertion kills the applied source mutant: '+String(failure));
    } finally {
      await writeFile(source,original);
      assert.equal(digest(await readFile(source)),digest(original),'source restored byte for byte');
      await writeFile(path.join(evidence,'restored-source.txt'),await readFile(source));
      await control({method:'server_stop'});
      Object.assign(facts,await control({method:'server_start'}));
    }
    await probe('restored');
    const record={name:'item715 applied source mutant',mutant:mutation.name,file:mutation.file,original:digest(original),mutated:digest(changed),restored:digest(await readFile(source)),failure:failure.message,control:'passed'};
    observations.push(record); await writeFile(path.join(evidence,'verdict.json'),JSON.stringify(record,null,2));
  });

}

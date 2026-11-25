import assert from 'node:assert/strict';
import {spawn, execFileSync} from 'node:child_process';
import {createInterface} from 'node:readline';
import {readFile,writeFile,mkdir,access} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {dirname} from 'node:path';
import {installDossierObserver} from './dossier1279_observe.mjs';
import {chromium} from '/Users/commonfabric/Library/Caches/deno/npm/registry.npmjs.org/playwright-core/1.59.1/index.mjs';

const code=dirname(fileURLToPath(import.meta.url)), name=process.argv[2];
const evidence=process.env.FLEX_DIAGNOSTIC_EVIDENCE, out=`${evidence}/${name}`;
const repo=process.env.FLEX_PRODUCT_REPO, head=process.env.FLEX_PRODUCT_HEAD;
await mkdir(out,{mode:0o700});
const save=(n,v)=>writeFile(`${out}/${n}`,JSON.stringify(v,null,2));
const hash=x=>createHash('sha256').update(x).digest('hex');
assert.equal(execFileSync('git',['-C',repo,'rev-parse','HEAD'],{encoding:'utf8'}).trim(),head);
assert.equal(execFileSync('git',['-C',repo,'status','--porcelain'],{encoding:'utf8'}),'');
const report={name,head,startedMs:Date.now(),cases:[],failures:[],errors:[],observationOnly:true,scratchArrivalCeiling:3630,scratchArrivals:0,nodeRuntime:{execPath:process.execPath,version:process.version,sha256:hash(await readFile(process.execPath))},
  qualification:'Instrumented synthetic native diagnostic; neither retrospective Tony attribution nor performance measurement.'};
const fixture=spawn('/usr/bin/python3',['-X',`pycache_prefix=${out}/fixture-pycache`,'-I',`${code}/dossier1285_fixture.py`,out],{cwd:repo});
let requestNumber=0, fixtureErrors='', ended=false;
const requests=new Map();
fixture.stderr.on('data',x=>fixtureErrors+=x);
const fixtureExit=new Promise(resolve=>fixture.once('exit',(code,signal)=>{
  ended=true;for(const p of requests.values())p.reject(Error(`Fixture exited ${code??signal}: ${fixtureErrors}`));requests.clear();resolve({code,signal});
}));
createInterface({input:fixture.stdout}).on('line',line=>{
  const result=JSON.parse(line), p=requests.get(result.id);requests.delete(result.id);
  if(!p)return;if(result.failure)p.reject(Error(result.failure));else p.resolve(result.answer);
});
const control=data=>new Promise((resolve,reject)=>{
  if(ended){reject(Error(`Fixture ended: ${fixtureErrors}`));return;}
  const id=++requestNumber;requests.set(id,{resolve,reject});fixture.stdin.write(JSON.stringify({...data,id})+'\n');
});
let browser, browserProfile;
try {
  report.fixture=await control({method:'ready'});
  const origin=`http://127.0.0.1:${report.fixture.port}`;
  browser=await chromium.launch({headless:false,
    executablePath:'/Users/commonfabric/Library/Caches/ms-playwright/chromium-1223/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing',
    args:['--window-size=1512,982',`--theseus-dossier1285-${name}`]});
  const bc=await browser.newBrowserCDPSession();report.browserVersion=await bc.send('Browser.getVersion');
  const args=(await bc.send('Browser.getBrowserCommandLine')).arguments;
  browserProfile=args.find(x=>x.startsWith('--user-data-dir='))?.slice(16);
  await save('ownership.json',{fixture:fixture.pid,browserProfile,args});
  const order=['cover-visible','human-items','cover-selection','selection-move','cover-focus','message-visible'];
  assert.equal(report.fixture.dataset.cases.length,6);
  for(const label of order){
    const target=report.fixture.dataset.cases.find(c=>c.label===label);assert.ok(target);
    const row={...target,startedMs:Date.now(),arrivals:[],barriers:[]};report.cases.push(row);
    const context=await browser.newContext({viewport:{width:1512,height:900},deviceScaleFactor:2,colorScheme:'dark'});
    let page;
    const requireObserverIntegrity=async boundary=>{
      const integrity=await page.evaluate(()=>({errors:__dossier1279.observerErrors,dropped:__dossier1279.dropped}));
      assert.equal(report.errors.filter(e=>e.label===target.label).length,0,`Product exception at ${boundary}; stop pressure`);
      (row.observerChecks??=[]).push({boundary,wallMs:Date.now(),...integrity});
      assert.equal(integrity.errors.length,0,`Observer errors at ${boundary}; stop before further arrivals/completion`);
      assert.equal(integrity.dropped,0,`Observer event loss at ${boundary}; stop before further arrivals/completion`);
    };
    try {
      await context.addInitScript(target=>{
        const q=window.__dossier1279={target,phase:'initial-load',events:[],inputs:[],network:[],samples:[],dropped:0,observerErrors:[]};
        q.add=(kind,data={})=>{if(q.events.length>=40000){q.dropped++;return;}q.events.push({kind,at:performance.now(),wallMs:Date.now(),phase:q.phase,...data});};
        const relevant=e=>e?.nodeType===1&&(e.dataset?.id===target.root||target.replies.includes(e.dataset?.id)||e.dataset?.dossier===target.root||e.closest?.('.reply-stack')?.dataset.dossier===target.root);
        q.rect=e=>{if(!e)return null;const b=e.getBoundingClientRect();return{top:b.top,bottom:b.bottom,left:b.left,right:b.right,height:b.height,width:b.width,rects:e.getClientRects().length};};
        q.sample=()=>{
          const section=document.querySelector(`.reply-stack[data-dossier="${target.root}"]`);
          const cover=section?.querySelector(':scope > .dossier-cover');
          const current=window[Symbol.for('theseus.topicWorkingSet')]?.()??null;
          const selection=getSelection();
          return {at:performance.now(),wallMs:Date.now(),phase:q.phase,observerDropped:q.dropped,y:scrollY,href:location.href,visibility:document.visibilityState,
            window:current,section:q.rect(section),sectionHead:section?.dataset.stack,cover:q.rect(cover),readerOpen:Boolean(document.querySelector('#reader')?.open),
            coverItems:[...(cover?.querySelectorAll(':scope > .cover-item')??[])].map(e=>({text:e.textContent,href:e.querySelector('a')?.getAttribute('href'),state:e.querySelector('.cover-item-state')?.textContent})),sectionHidden:section?.hidden,sectionClass:section?.className,
            entries:[target.root,...target.replies].map(id=>{const e=document.querySelector(`#messages [data-id="${id}"]`);return{id,rect:q.rect(e),connected:e?.isConnected,hidden:e?.hidden,display:e?getComputedStyle(e).display:null};}),
            coverIdentity:cover?(q.coverIds??=new WeakMap()).get(cover)??((q.coverIds.set(cover,++q.serial)),q.serial):null,
            active:{id:document.activeElement?.id,cls:document.activeElement?.className,inCover:Boolean(cover?.contains(document.activeElement))},
            selection:{text:selection?.toString(),collapsed:selection?.isCollapsed,anchorInCover:Boolean(cover?.contains(selection?.anchorNode)),focusInCover:Boolean(cover?.contains(selection?.focusNode))},
            listClass:document.querySelector('#messages')?.className,bodyClass:document.body.className,
            updatesNotice:{hidden:document.querySelector('#updates-status')?.hidden,
              words:document.querySelector('#updates-message')?.textContent},
            focusTargets:[...(cover?.querySelectorAll('a[href],button,input,select,textarea,[tabindex]')??[])].map(e=>({
              tag:e.tagName,cls:e.className,text:e.textContent?.slice(0,100),tabIndex:e.tabIndex,
              disabled:e.disabled,hidden:e.hidden,inert:Boolean(e.closest('[inert]')),rect:q.rect(e)}))};
        };q.serial=0;
        for(const type of ['pointerdown','pointerup','click','keydown','keyup','wheel','input','selectionchange'])document.addEventListener(type,e=>q.inputs.push({type,trusted:e.isTrusted,at:performance.now(),phase:q.phase,key:e.key,deltaY:e.deltaY,id:e.target?.id,cls:e.target?.className}),true);
        for(const method of ['remove','replaceWith']){
          const original=Element.prototype[method];Element.prototype[method]=function(...args){
            try{if(relevant(this))q.add(`Element.${method}`,{id:this.dataset.id,dossier:this.dataset.dossier,cls:this.className,stack:new Error().stack,before:q.sample()});}
            catch(error){q.observerErrors.push({kind:`Element.${method}`,message:error.message,stack:error.stack});}
            return original.apply(this,args);
          };
        }
        const fetched=window.fetch;
        window.fetch=async function(...args){let body;try{body=JSON.parse(args[1]?.body);}catch{}
          const event={at:performance.now(),phase:q.phase,url:String(args[0]),body};q.network.push(event);
          const response=await fetched.apply(this,args),decode=response.json.bind(response);
          response.json=async()=>{const value=await decode();event.decodedAt=performance.now();event.answer=value;return value;};return response;
        };
        const observe=()=>{if(!document.querySelector('#messages'))return requestAnimationFrame(observe);
          new MutationObserver(changes=>{for(const c of changes){if(relevant(c.target)||[...c.removedNodes,...c.addedNodes].some(relevant))q.add('DOM mutation',{type:c.type,attribute:c.attributeName,targetId:c.target.dataset?.id,targetClass:c.target.className,removed:[...c.removedNodes].map(n=>({id:n.dataset?.id,dossier:n.dataset?.dossier,cls:n.className})),added:[...c.addedNodes].map(n=>({id:n.dataset?.id,dossier:n.dataset?.dossier,cls:n.className})),after:q.sample()});}}).observe(document.querySelector('#messages'),{subtree:true,attributes:true,childList:true});};requestAnimationFrame(observe);
      },target);
      page=await context.newPage();page.setDefaultTimeout(20000);page.on('pageerror',e=>report.errors.push({label:target.label,error:e.stack}));
      await page.goto(`${origin}/?topic=${target.topic}`);
      await page.waitForFunction(()=>document.body.dataset.ready==='true');await page.bringToFront();
      row.documentModules=await page.evaluate(()=>{
        const app=[...document.querySelectorAll('script[type="module"][src]')].map(e=>e.src).find(src=>new URL(src).pathname.endsWith('/app.mjs'));
        if(!app||!/^\/b\/[^/]+\/app\.mjs$/.test(new URL(app).pathname))throw Error('Document entry has no versioned build identity');
        return {app,topicViews:new URL('topic-views.mjs',app).href,stackFeed:new URL('stack-feed.mjs',app).href,
          importMap:document.querySelector('script[type="importmap"]')?.textContent};
      });
      row.moduleBytes={};
      row.documentModules.api=new URL('api.mjs',row.documentModules.app).href;
      row.documentModules.decoder=new URL('dossier-positions.mjs',row.documentModules.app).href;
      for(const [key,file] of [['app','app.mjs'],['topicViews','topic-views.mjs'],['stackFeed','stack-feed.mjs'],['api','api.mjs'],['decoder','dossier-positions.mjs']]){
        const response=await context.request.get(row.documentModules[key]);assert.equal(response.status(),200);
        const bytes=await response.body(),sha256=hash(bytes);
        assert.equal(sha256,hash(await readFile(`${repo}/web/${file}`)));
        row.moduleBytes[key]={url:row.documentModules[key],bytes:bytes.length,sha256,productHead:head};
      }
      row.servedApp=row.moduleBytes.app.sha256;
      await page.waitForFunction(root=>window[Symbol.for('theseus.topicWorkingSet')]?.()?.loaded.includes(root),target.root);
      await page.locator(`.reply-stack[data-dossier="${target.root}"] > .dossier-cover`).waitFor({state:'visible'});
      row.observerIdentity=await page.evaluate(installDossierObserver,row.documentModules);
      assert.equal(row.observerIdentity.absoluteViewsSame,true,'Import map and explicit document owner identity agree');
      assert.equal(row.observerIdentity.absoluteFeedSame,true,'Feed module identity agrees');
      const coverSelector=`.reply-stack[data-dossier="${target.root}"] > .dossier-cover`;
      const sample=()=>page.evaluate(()=>__dossier1279.sample());
      const settled=async()=>{
        await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
        await page.waitForTimeout(150);
        const value=await sample();
        assert.ok(value.window.fullRecords<=300,`Combined full records ${value.window.fullRecords} exceeds300`);
        assert.ok(value.window.canonicalDOM<=300,`Canonical DOM exceeds300`);
        assert.ok(value.window.runs<=8,`Window runs ${value.window.runs} exceeds8`);
        return value;
      };
      const visible=r=>Boolean(r?.height>0&&r?.width>0&&r.bottom>0&&r.top<900);
      const moveCover=async wanted=>{
        await page.mouse.move(1505,450);
        for(let attempt=0;attempt<12;attempt++){
          const box=await page.locator(coverSelector).boundingBox();assert.ok(box,'Cover must exist before positioning');
          if(Math.abs(box.y-wanted)<5)break;
          await page.mouse.wheel(0,box.y-wanted);await page.waitForTimeout(150);
        }
        await page.waitForTimeout(200);
      };
      const moveAway=async()=>{
        await page.mouse.move(1505,450);
        for(let n=0;n<10;n++){
          const state=await sample();
          if(!visible(state.cover)&&!state.entries.some(e=>visible(e.rect)))return state;
          await page.mouse.wheel(0,Math.max(900,(state.cover?.bottom??0)+500));await page.waitForTimeout(180);
        }
        throw Error('Native wheel did not move cover and target cards offscreen; no pressure');
      };
      const verifyItems=async stage=>{
        const projection=await control({method:'projection',label:target.label});
        const current=projection.cover??projection;
        const state=await sample();
        (row.itemChecks??=[]).push({stage,projection,rendered:state.coverItems});
        assert.equal(current.stands,null);assert.equal(current.payload,null);assert.equal(current.by,null);
        assert.equal(current.items.length,3);assert.equal(state.coverItems.length,3);
        assert.deepEqual(current.items.map(x=>x.number),target.item_numbers);
        for(let n=0;n<3;n++){
          assert.ok(state.coverItems[n].text.includes(current.items[n].title));
          assert.equal(state.coverItems[n].state,current.items[n].state);
          assert.ok(state.coverItems[n].href.includes(String(current.items[n].number)));
        }
      };
      await moveCover(target.label==='human-items'?800:20);
      row.focusInventory=await page.evaluate(()=>__dossier1279.sample().focusTargets);
      if(target.label==='cover-focus'){
        row.priorFocusBarrier='Original1279:80 trusted Tabs failed; this uses a trusted pointer down/up on an existing control, without activation.';
        const button=page.locator(coverSelector+' button').first();
        assert.ok(await button.count(),'Existing cover button required; no injected tabindex');
        const box=await button.boundingBox();assert.ok(box&&box.y>=0&&box.y+box.height<=900);
        await page.mouse.move(box.x+box.width/2,box.y+box.height/2);await page.waitForTimeout(100);
        await page.mouse.down();await page.mouse.move(1505,450,{steps:8});await page.mouse.up();
        await page.waitForTimeout(150);
        row.focusEstablished=await sample();
        assert.equal(row.focusEstablished.active.inCover,true,'Native press/release leaves existing control focused');
        assert.equal(row.focusEstablished.selection.collapsed,true);
        assert.equal(row.focusEstablished.readerOpen,false,'Reader cannot independently pin target');
      }
      if(['cover-selection','selection-move'].includes(target.label)){
        const box=await page.locator(coverSelector+' .cover-stands').boundingBox();assert.ok(box);
        const y=Math.max(35,box.y+18);
        await page.mouse.move(box.x+15,y);await page.mouse.down();await page.mouse.move(box.x+280,y,{steps:12});await page.mouse.up();
        const selected=await sample();
        assert.ok(!selected.selection.collapsed&&selected.selection.anchorInCover&&selected.selection.focusInCover,'Native drag selects cover words');
      }
      if(['cover-focus','cover-selection','selection-move'].includes(target.label))await moveAway();
      await page.evaluate(()=>__dossier1279.phase='protected-arrivals');
      row.before=await settled();
      assert.ok(row.before.window.loaded.includes(target.root),'Target admitted before pressure');
      assert.equal(row.before.readerOpen,false,'No Reader hold supplies independent retention');
      row.messageFacesVisible=row.before.entries.filter(e=>visible(e.rect)).map(e=>e.id);
      if(target.label==='message-visible')assert.ok(row.messageFacesVisible.length>0,'Visible-message control needs actual visible entry');
      else assert.equal(row.messageFacesVisible.length,0,'All target message entries must be offscreen');
      if(['cover-visible','human-items'].includes(target.label))assert.ok(visible(row.before.cover),'Actual cover intersects viewport');
      else if(target.label!=='message-visible'){
        assert.equal(visible(row.before.cover),false,'Native focus/selection retention begins with cover offscreen');
        assert.ok(row.before.window.protected.includes(row.before.sectionHead),'Offscreen cover protects current displayed head');
      }
      if(target.label==='human-items'){
        await verifyItems('initial');
        row.negotiatedReads=await page.evaluate(root=>__dossier1279.network.filter(e=>e.body?.name==='topic_messages'&&e.body.args?.position_format==='root-table-v1'&&e.answer?.positions?.[root]).map(e=>({at:e.at,decodedAt:e.decodedAt,request:e.body,position:e.answer.positions[root]})),target.root);
        assert.ok(row.negotiatedReads.length,'Actual page negotiated and received items-only authoritative root table');
      }
      await page.screenshot({path:`${out}/${target.label}-before.png`});
      const pressure=async(first,last,stage)=>{
        await page.evaluate(value=>__dossier1279.phase=value,stage);
        for(let start=first;start<last;start+=30){
          await requireObserverIntegrity(`before-${stage}-${start}`);
          assert.ok(report.scratchArrivals+30<=3630,'Fixed pressure ceiling');
          const arrival=await control({method:'arrivals',label:target.label,start,count:30,
            churn:start===120&&['cover-visible','human-items'].includes(target.label)});
          report.scratchArrivals+=30;row.arrivals.push({...arrival,stage,start});
          await page.waitForFunction(id=>{
            const q=__dossier1279,entry=q.events.findLast(e=>e.kind==='TopicViews.messagesPage:entry'&&e.read?.ids?.includes(id));
            return entry&&q.events.some(e=>e.call===entry.call&&['TopicViews.messagesPage:return','TopicViews.messagesPage:throw'].includes(e.kind));
          },arrival.last,{timeout:30000});
          const admitted=await page.evaluate(id=>{
            const q=__dossier1279,entry=q.events.findLast(e=>e.kind==='TopicViews.messagesPage:entry'&&e.read?.ids?.includes(id));
            return {entry,terminal:q.events.find(e=>e.call===entry.call&&['TopicViews.messagesPage:return','TopicViews.messagesPage:throw'].includes(e.kind))};
          },arrival.last);
          row.arrivals.at(-1).admission=admitted;
          assert.notEqual(admitted.terminal.kind,'TopicViews.messagesPage:throw','Actual document ingestion threw');
          assert.equal(admitted.terminal.value,true,'Actual document ingestion refused frontier');
          await page.waitForFunction(id=>window[Symbol.for('theseus.topicWorkingSet')]?.()?.loaded.includes(id),arrival.last,{timeout:30000});
          const state=await settled();row.arrivals.at(-1).observed=state;
          await requireObserverIntegrity(`after-${stage}-${start}`);
          if(stage==='protected-arrivals'){
            assert.ok(state.window.loaded.includes(target.root),'Protected root survives ordinary arrivals');
            assert.ok(state.cover,'Protected cover remains connected');
          }
          await save('progress.json',report);
        }
      };
      await pressure(0,330,'protected-arrivals');
      row.protectedAfter=await settled();
      if(target.label==='human-items')await verifyItems('after-item-revision');
      if(target.label!=='message-visible'){
        await page.evaluate(()=>__dossier1279.phase='native-release');
        if(target.label==='selection-move'){
          await page.mouse.move(1505,450);await page.mouse.wheel(0,-1000000);await page.waitForTimeout(250);
          const box=await page.locator('#topic-title').boundingBox();assert.ok(box&&box.y>=0&&box.y<900);
          await page.mouse.move(box.x+3,box.y+box.height/2);await page.mouse.down();
          await page.mouse.move(box.x+Math.min(180,box.width-3),box.y+box.height/2,{steps:10});await page.mouse.up();
          const range=await sample();
          assert.ok(!range.selection.collapsed&&!range.selection.anchorInCover&&!range.selection.focusInCover,'Native drag moves range to other text');
        }else if(['cover-selection','cover-focus'].includes(target.label)){
          await page.mouse.click(1500,50);await page.waitForTimeout(100);
          const released=await sample();
          if(target.label==='cover-selection')assert.equal(released.selection.collapsed,true,'Trusted outside click collapses selection');
          else assert.equal(released.active.inCover,false,'Trusted outside click moves focus');
        }
        row.release=await moveAway();
        assert.equal(row.release.readerOpen,false);
        assert.equal(row.release.active.inCover,false);
        assert.ok(row.release.selection.collapsed||!row.release.selection.anchorInCover&&!row.release.selection.focusInCover);
        assert.ok(![target.root,...target.replies,row.release.sectionHead].some(id=>row.release.window.protected.includes(id)),'Released dossier has no remaining protection before second pressure');
        await pressure(330,660,'released-arrivals');
        row.after=await settled();
        assert.equal(row.after.window.loaded.includes(target.root),false,'Ordinary bounded eviction resumes after release');
        assert.equal(Boolean(row.after.cover),false,'Unrepresented dossier cover retires');
        await page.screenshot({path:`${out}/${target.label}-evicted.png`});
        await page.evaluate(()=>__dossier1279.phase='authored-linked-return');
        const above=page.getByRole('button',{name:/new above/i});
        if(await above.count())await above.first().click();
        const link=page.getByRole('link',{name:'Return dossier',exact:true});assert.ok(await link.count(),'Actual authored return link must be rendered');
        await link.last().click();await page.waitForTimeout(500);
        row.linkedReturn=await sample();
        assert.ok(row.linkedReturn.cover,'Authored-link return restores current stored dossier');
        if(target.label==='human-items')await verifyItems('linked-return');
      }else row.after=row.protectedAfter;
      row.rootRetained=row.after.window.loaded.includes(target.root);row.coverRetained=Boolean(row.after.cover);
      row.sourceAfter=await control({method:'source',label:target.label});
      await page.screenshot({path:`${out}/${target.label}-after.png`});
      await requireObserverIntegrity('case-complete');row.transitionComplete=true;
    }catch(e){row.barriers.push(e.stack);if(page){
      row.barrierState=await page.evaluate(()=>__dossier1279.sample()).catch(error=>({sampleError:String(error)}));
      await page.screenshot({path:`${out}/${target.label}-barrier.png`}).catch(()=>{});
    }}
    finally{
      if(page)row.ingestionDisposition=await page.evaluate(last=>{
        const q=__dossier1279;
        const entry=q.events.findLast(e=>e.kind==='TopicViews.messagesPage:entry'&&e.read?.ids?.includes(last));
        const terminal=entry&&q.events.find(e=>e.call===entry.call&&['TopicViews.messagesPage:return','TopicViews.messagesPage:throw'].includes(e.kind));
        const refresh=q.events.findLast(e=>e.kind==='TopicViews.refresh:entry'&&e.key==='messages'&&e.phase==='arrivals');
        const current=refresh&&q.events.filter(e=>e.call===refresh.call&&e.kind==='TopicViews.refresh:current');
        const status=q.observerErrors.length?'observer-error-excludes-attribution':!last?'no-arrival-batch':
          terminal?.kind==='TopicViews.messagesPage:throw'?'ingestion-threw':terminal?.value===false?'ingestion-returned-false':
          terminal?.value===true?'ingestion-returned-true':current?.some(e=>e.value===false)?'currentness-false-before-admission':'owner-entry-not-observed';
        return {status,entry,terminal,refresh,current,observerErrors:q.observerErrors,
          qualification:'No extra currentness calls; false return is retained with frontier state, not called eviction.'};
      },row.arrivals.at(-1)?.last??null).catch(error=>({exportError:String(error)}));
      if(page)row.probe=await page.evaluate(()=>{const {target,phase,events,inputs,network,samples,dropped,observerErrors,observerIdentity}=window.__dossier1279;return {target,phase,events,inputs,network,samples,dropped,observerErrors,observerIdentity};}).catch(e=>({exportError:String(e)}));
      row.endedMs=Date.now();await context.close().catch(error=>row.barriers.push('Context cleanup: '+error.stack));await save('progress.json',report);
    }
  }
}catch(e){report.failures.push(e.stack);}
finally{
  if(browser){try{await browser.close();report.browserClosed=!browser.isConnected();report.profileAbsent=await access(browserProfile).then(()=>false,()=>true);}catch(error){report.failures.push('Browser.close: '+error.stack);}}
  if(!ended){try{report.fixtureStop=await control({method:'stop'});}catch(e){report.failures.push(String(e));fixture.stdin.end();}}
  report.fixtureExit=await fixtureExit;
  if(report.fixtureExit.code!==0||report.fixtureStop?.thread_alive!==false)report.failures.push('Fixture terminal did not establish exit0 and thread closure');
  if(!report.browserClosed||!report.profileAbsent)report.failures.push('Browser/profile closure not established');
  report.fixtureErrors=fixtureErrors;report.endedMs=Date.now();
  await save('result.json',report);
  console.log(JSON.stringify({name,cases:report.cases.map(c=>({label:c.label,transitionComplete:c.transitionComplete,rootRetained:c.rootRetained,coverRetained:c.coverRetained,barriers:c.barriers})),failures:report.failures}));
}
process.exitCode=report.failures.length||report.errors.length||report.cases.length!==6||report.cases.some(c=>!c.transitionComplete||c.barriers.length)?1:0;

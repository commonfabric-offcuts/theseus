import assert from 'node:assert/strict';
import {spawn, execFileSync} from 'node:child_process';
import {createInterface} from 'node:readline';
import {readFile,writeFile,mkdir,access} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {dirname} from 'node:path';
import {chromium} from '/Users/commonfabric/Library/Caches/deno/npm/registry.npmjs.org/playwright-core/1.59.1/index.mjs';

const code=dirname(fileURLToPath(import.meta.url)), name=process.argv[2];
const evidence=process.env.FLEX_DIAGNOSTIC_EVIDENCE, out=`${evidence}/${name}`;
const repo=process.env.FLEX_PRODUCT_REPO, head=process.env.FLEX_PRODUCT_HEAD;
await mkdir(out,{mode:0o700});
const save=(n,v)=>writeFile(`${out}/${n}`,JSON.stringify(v,null,2));
const hash=x=>createHash('sha256').update(x).digest('hex');
assert.equal(execFileSync('git',['-C',repo,'rev-parse','HEAD'],{encoding:'utf8'}).trim(),head);
assert.equal(execFileSync('git',['-C',repo,'status','--porcelain'],{encoding:'utf8'}),'');
const report={name,head,startedMs:Date.now(),cases:[],failures:[],errors:[],observationOnly:true,
  qualification:'Instrumented synthetic native diagnostic; neither retrospective Tony attribution nor performance measurement.'};
const fixture=spawn('/usr/bin/python3',['-I',`${code}/dossier1279_fixture.py`,out]);
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
    args:['--window-size=1512,982',`--theseus-dossier1279-${name}`]});
  const bc=await browser.newBrowserCDPSession();report.browserVersion=await bc.send('Browser.getVersion');
  const args=(await bc.send('Browser.getBrowserCommandLine')).arguments;
  browserProfile=args.find(x=>x.startsWith('--user-data-dir='))?.slice(16);
  await save('ownership.json',{fixture:fixture.pid,browserProfile,args});
  for(const target of report.fixture.dataset.cases){
    const row={...target,startedMs:Date.now(),arrivals:[],barriers:[]};report.cases.push(row);
    const context=await browser.newContext({viewport:{width:1512,height:900},deviceScaleFactor:2,colorScheme:'dark'});
    let page;
    try {
      await context.addInitScript(target=>{
        const q=window.__dossier1279={target,phase:'initial-load',events:[],inputs:[],network:[],samples:[],dropped:0};
        q.add=(kind,data={})=>{if(q.events.length>=40000){q.dropped++;return;}q.events.push({kind,at:performance.now(),wallMs:Date.now(),phase:q.phase,...data});};
        const relevant=e=>e?.nodeType===1&&(e.dataset?.id===target.root||target.replies.includes(e.dataset?.id)||e.dataset?.dossier===target.root||e.closest?.('.reply-stack')?.dataset.dossier===target.root);
        q.rect=e=>{if(!e)return null;const b=e.getBoundingClientRect();return{top:b.top,bottom:b.bottom,left:b.left,right:b.right,height:b.height,width:b.width,rects:e.getClientRects().length};};
        q.sample=()=>{
          const section=document.querySelector(`.reply-stack[data-dossier="${target.root}"]`);
          const cover=section?.querySelector(':scope > .dossier-cover');
          const current=window[Symbol.for('theseus.topicWorkingSet')]?.()??null;
          const selection=getSelection();
          return {at:performance.now(),wallMs:Date.now(),phase:q.phase,y:scrollY,href:location.href,visibility:document.visibilityState,
            window:current,section:q.rect(section),cover:q.rect(cover),sectionHidden:section?.hidden,sectionClass:section?.className,
            entries:[target.root,...target.replies].map(id=>{const e=document.querySelector(`#messages [data-id="${id}"]`);return{id,rect:q.rect(e),connected:e?.isConnected,hidden:e?.hidden,display:e?getComputedStyle(e).display:null};}),
            coverIdentity:cover?(q.coverIds??=new WeakMap()).get(cover)??((q.coverIds.set(cover,++q.serial)),q.serial):null,
            active:{id:document.activeElement?.id,cls:document.activeElement?.className,inCover:Boolean(cover?.contains(document.activeElement))},
            selection:{text:selection?.toString(),collapsed:selection?.isCollapsed,anchorInCover:Boolean(cover?.contains(selection?.anchorNode)),focusInCover:Boolean(cover?.contains(selection?.focusNode))},
            listClass:document.querySelector('#messages')?.className,bodyClass:document.body.className};
        };q.serial=0;
        for(const type of ['pointerdown','pointerup','click','keydown','keyup','wheel','input','selectionchange'])document.addEventListener(type,e=>q.inputs.push({type,trusted:e.isTrusted,at:performance.now(),phase:q.phase,key:e.key,deltaY:e.deltaY,id:e.target?.id,cls:e.target?.className}),true);
        for(const method of ['remove','replaceWith']){
          const original=Element.prototype[method];Element.prototype[method]=function(...args){
            if(relevant(this))q.add(`Element.${method}`,{id:this.dataset.id,dossier:this.dataset.dossier,cls:this.className,stack:new Error().stack,before:q.sample()});
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
      row.servedApp=hash(await(await context.request.get(`${origin}/app.mjs`)).body());
      assert.equal(row.servedApp,hash(await readFile(`${repo}/web/app.mjs`)));
      await page.waitForFunction(root=>window[Symbol.for('theseus.topicWorkingSet')]?.()?.loaded.includes(root),target.root);
      await page.locator(`.reply-stack[data-dossier="${target.root}"] > .dossier-cover`).waitFor({state:'visible'});
      await page.evaluate(async()=>{
        const q=window.__dossier1279;
        const {TopicViews}=await import('/topic-views.mjs');
        const {StackFeed}=await import('/stack-feed.mjs');
        for(const name of ['messagesPage','trimWindow','readPositions']){
          const actual=TopicViews.prototype[name];
          TopicViews.prototype[name]=function(...args){
            const detail={name,stack:new Error().stack,before:q.sample(),recordBefore:[q.target.root,...q.target.replies].map(id=>({id,present:this.messages.has(id),position:this.positions.get(id)})),membership:this.membershipRevision};
            if(name==='messagesPage')detail.read={ids:args[0]?.items?.map(x=>x.id),commit_seq:args[0]?.commit_seq,frontier:args[1]};
            const result=actual.apply(this,args);
            detail.result=result instanceof Promise?'promise':result;detail.after=q.sample();
            detail.recordAfter=[q.target.root,...q.target.replies].map(id=>({id,present:this.messages.has(id)}));q.add('TopicViews.'+name,detail);return result;
          };
        }
        const arrange=StackFeed.prototype.arrange;
        StackFeed.prototype.arrange=function(...args){const before=q.sample(),stack=new Error().stack,result=arrange.apply(this,args);q.add('StackFeed.arrange',{before,after:q.sample(),stack});return result;};
        q.phase='positioning';
      });
      await page.mouse.move(1505,450);
      for(let attempt=0;attempt<10;attempt++){
        const top=await page.locator(`.reply-stack[data-dossier="${target.root}"] > .dossier-cover`).evaluate(e=>e.getBoundingClientRect().top);
        if(Math.abs(top-20)<5)break;
        await page.mouse.wheel(0,top-20);await page.waitForTimeout(200);
      }
      await page.waitForTimeout(500);
      if(target.label==='cover-focus'){
        const box=await page.locator(`.reply-stack[data-dossier="${target.root}"] .cover-stands`).boundingBox();
        await page.mouse.click(box.x+25,Math.max(30,box.y+14));
        for(let n=0;n<80;n++){
          if(await page.evaluate(()=>__dossier1279.sample().active.inCover))break;
          await page.keyboard.press('Tab');
        }
        assert.equal(await page.evaluate(()=>__dossier1279.sample().active.inCover),true,'Native Tab reaches cover');
      }
      if(target.label==='cover-selection'){
        const box=await page.locator(`.reply-stack[data-dossier="${target.root}"] .cover-stands`).boundingBox();
        const y=Math.max(35,box.y+18);await page.mouse.move(box.x+15,y);await page.mouse.down();await page.mouse.move(box.x+280,y,{steps:12});await page.mouse.up();
        assert.equal(await page.evaluate(()=>{const s=__dossier1279.sample().selection;return !s.collapsed&&s.anchorInCover&&s.focusInCover;}),true,'Native drag selects cover words');
      }
      await page.evaluate(()=>__dossier1279.phase='arrivals');row.before=await page.evaluate(()=>__dossier1279.sample());
      assert.ok(row.before.window.loaded.includes(target.root),'Target loaded before churn');
      assert.ok(row.before.cover?.bottom>0&&row.before.cover.top<900,'Cover visible before churn');
      row.messageFacesVisible=row.before.entries.filter(e=>e.rect?.rects&&e.rect.bottom>0&&e.rect.top<900).map(e=>e.id);
      if(target.label!=='message-visible')assert.equal(row.messageFacesVisible.length,0,'Cover-only condition has no visible message entry');
      else assert.ok(row.messageFacesVisible.length>0,'Visible-message control has an entry visible');
      await page.screenshot({path:`${out}/${target.label}-before.png`});
      for(let start=0;start<330;start+=30){
        const arrival=await control({method:'arrivals',label:target.label,start,count:30,churn:start===120&&target.label!=='message-visible'});row.arrivals.push(arrival);
        await page.waitForFunction(id=>window[Symbol.for('theseus.topicWorkingSet')]?.()?.loaded.includes(id),arrival.last,{timeout:30000});
        await page.waitForTimeout(250);
        const sample=await page.evaluate(()=>__dossier1279.sample());row.arrivals.at(-1).observed=sample;
        await save('progress.json',report);
      }
      await page.waitForTimeout(750);row.after=await page.evaluate(()=>__dossier1279.sample());
      row.rootRetained=row.after.window.loaded.includes(target.root);row.coverRetained=Boolean(row.after.cover);
      row.sourceAfter=await control({method:'source',label:target.label});
      await page.screenshot({path:`${out}/${target.label}-after.png`});
      row.transitionComplete=true;
      await page.evaluate(()=>__dossier1279.phase='separate-linked-return');
      const newAbove=page.getByRole('button',{name:/new above/i});
      if(await newAbove.count())await newAbove.first().click().catch(e=>row.barriers.push('New above: '+e.message));
      const link=page.getByRole('link',{name:'Return dossier',exact:true});
      if(await link.count()){
        await link.first().click();await page.waitForTimeout(1000);row.linkedReturn=await page.evaluate(()=>__dossier1279.sample());
      }else row.barriers.push('Separate linked-return control not rendered; no programmatic handler substitute.');
    }catch(e){row.barriers.push(e.stack);if(page)await page.screenshot({path:`${out}/${target.label}-barrier.png`}).catch(()=>{});}
    finally{
      if(page)row.probe=await page.evaluate(()=>{const {add,sample,rect,coverIds,...q}=window.__dossier1279;return q;}).catch(e=>({exportError:String(e)}));
      row.endedMs=Date.now();await context.close();await save('progress.json',report);
    }
  }
}catch(e){report.failures.push(e.stack);}
finally{
  if(browser){await browser.close();report.browserClosed=!browser.isConnected();report.profileAbsent=await access(browserProfile).then(()=>false,()=>true);}
  if(!ended){try{report.fixtureStop=await control({method:'stop'});}catch(e){report.failures.push(String(e));fixture.stdin.end();}}
  report.fixtureExit=await fixtureExit;report.fixtureErrors=fixtureErrors;report.endedMs=Date.now();
  await save('result.json',report);
  console.log(JSON.stringify({name,cases:report.cases.map(c=>({label:c.label,transitionComplete:c.transitionComplete,rootRetained:c.rootRetained,coverRetained:c.coverRetained,barriers:c.barriers})),failures:report.failures}));
}
process.exitCode=report.failures.length||report.cases.some(c=>!c.transitionComplete)?1:0;

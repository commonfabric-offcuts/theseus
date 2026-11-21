// Actual thumbnail geometry, native keys and retained image menu/opening controls.
import assert from 'node:assert/strict';
import {spawn,execFileSync} from 'node:child_process';
import {mkdir,mkdtemp,writeFile,rm,access} from 'node:fs/promises';
import net from 'node:net';
import {createHash} from 'node:crypto';
import {fixtureControl} from './fixture_control.mjs';
const playwright=await import(process.env.AIM_PLAYWRIGHT_CORE),engine=process.env.AIM_ENGINE??'chromium';
const count=Number(process.env.AIM_1030_COUNT??5);
const evidence=process.argv[2],baseline=process.env.AIM_1030_BASELINE==='1';await mkdir(evidence,{recursive:true});
const sourceHashes=JSON.parse(process.env.AIM_1030_SOURCE_HASHES??'{}');
const sourceHash=process.env.AIM_1030_SOURCE_SHA256;assert.match(sourceHash??'',/^[a-f0-9]{64}$/,'supply actual frozen ThingsRail hash');
const fixture=spawn('/usr/bin/python3',['-B','tests/fixtures/ui_http.py','--freshness','--live','--images'],{cwd:process.env.AIM_1030_ROOT??process.cwd()});
const {control,exit,errors}=fixtureControl(fixture),results=[],cleanup={},owned=new Set(),fixtureOwned=new Set([fixture.pid]);
const ps=()=>execFileSync('/bin/ps',['-axo','pid=,ppid=,command='],{encoding:'utf8'}).trim().split('\n').map(line=>{const[,pid,ppid,command]=line.match(/^\s*(\d+)\s+(\d+)\s+(.*)$/);return{pid:+pid,ppid:+ppid,command};});
function children(set){const list=ps();for(let changed=true;changed;){changed=false;for(const p of list)if(set.has(p.ppid)&&!set.has(p.pid)){set.add(p.pid);changed=true;}}}
let browser,profile,origin,failure;
try{
 const facts=await control({method:'ready'});origin=facts.origin;children(fixtureOwned);
 const sent=await control({method:'agent_message',operation_id:'1030-grid-images',sender:'person',source:'topic',body:'Grid source1030. [A preview](https://example.test/preview/grid) [Pull request](https://github.com/example/repo/pull/1007)',attachments:Array.from({length:count},(_,i)=>({name:`grid1030-${i}.png`,png:[24+i,18]}))});assert.equal(sent.status,'committed');
 await control({method:'agent_message',operation_id:'1030-plain-feed-entry',sender:'person',source:'topic',body:'Feed entry1030 plain. No inline controls.'});
 profile=await mkdtemp(`${evidence}/${engine}-profile-`);
 const persistent=await playwright[engine].launchPersistentContext(profile,{headless:true,...(engine==='chromium'?{executablePath:process.env.AIM_CHROME}:process.env.AIM_WEBKIT?{executablePath:process.env.AIM_WEBKIT}:{})});
 browser=persistent.browser();cleanup.engine=browser.browserType().name();cleanup.version=browser.version();assert.equal(cleanup.engine,engine);for(const p of ps())if(p.command.includes(profile))owned.add(p.pid);children(owned);assert.ok(owned.size);
 await writeFile(`${evidence}/owned-start.json`,JSON.stringify({engine,profile,ownedPids:[...owned],fixturePid:fixture.pid,origin}));
 const cells=baseline?[1280,390].flatMap(width=>['bookends','paper'].map(look=>[width,look,'light'])):[1280,390].flatMap(width=>['bookends','paper'].flatMap(look=>['light','dark'].map(theme=>[width,look,theme])));
 for(const[width,look,colorScheme]of cells.filter(c=>!process.env.AIM_1030_FILTER||new RegExp(process.env.AIM_1030_FILTER).test(c.join('-')))){
  const key=`${engine}-${width}-${look}-${colorScheme}`,phone=width<761,observations=[],pageErrors=[];
  const context=await browser.newContext({viewport:{width,height:phone?844:1000},colorScheme,...(phone?{isMobile:true,hasTouch:true}:{})});await context.addInitScript(look=>localStorage.setItem('theseus-look',look),look);
  const page=await context.newPage();page.setDefaultTimeout(7000);page.on('pageerror',e=>pageErrors.push(e.message));let error;
  const section=page.locator('#things .things-sec[data-key=images]'),thumb=id=>page.locator(`#things a[data-rail-image="${id}"]`);
  const ensure=async()=>{if(phone&&!await page.locator('html').getAttribute('data-things-open').then(v=>v!==null))await page.locator('#things-open').tap();await section.waitFor();await page.waitForFunction(()=>getComputedStyle(document.getElementById('things')).transform==='none');};
  const layout=()=>page.evaluate(()=>{const cells=[...document.querySelectorAll('#things .things-thumbs>a')].filter(el=>el.checkVisibility()).map(el=>{const b=el.getBoundingClientRect();return{id:el.dataset.railImage,left:b.left,right:b.right,top:b.top,bottom:b.bottom,cx:(b.left+b.right)/2};}).sort((a,b)=>a.top-b.top||a.left-b.left),rows=[];for(const c of cells){let row=rows.find(row=>Math.abs(row[0].top-c.top)<1);if(!row)rows.push(row=[]);row.push(c);}return rows;});
  const active=()=>page.evaluate(()=>({image:document.activeElement.closest('[data-rail-image]')?.dataset.railImage,tag:document.activeElement.tagName,section:document.activeElement.closest('.things-sec')?.dataset.key,feed:!!document.activeElement.closest('#main')}));
  const move=async(from,press,to)=>{await thumb(from.id).focus();await page.keyboard.press(press);const at=await active();observations.push({from:from.id,press,expected:to.id,active:at});assert.equal(at.image,to.id,press+' follows actual thumbnail placement');};
  try{
   await page.goto(origin+'/?topic=t1');await page.waitForFunction(()=>document.body.dataset.ready==='true');
   const app=await page.evaluate(()=>[...document.scripts].find(s=>s.src.includes('/app.mjs')).src);assert.equal(createHash('sha256').update(await(await page.request.get(new URL('./things-rail.mjs',app).href)).body()).digest('hex'),sourceHash,'exact served grid owner');
   for(const[path,hash]of Object.entries(sourceHashes)){assert.equal(createHash('sha256').update(await(await page.request.get(new URL('./'+path,app).href)).body()).digest('hex'),hash,'exact served '+path);}
   await page.evaluate(n=>document.documentElement.dataset.probeImageCount=n,count);await ensure();await page.waitForFunction(()=>{const rows=[...document.querySelectorAll('#things a[data-rail-image]')];return rows.length===Number(document.documentElement.dataset.probeImageCount)&&rows.every(row=>row.querySelector('img.image-thumb')?.checkVisibility());});
   const ringPaint=()=>page.evaluate(()=>{
    const focus=document.activeElement,tile=focus.closest('[data-rail-image]');
    const rect=el=>{const b=el.getBoundingClientRect();return {left:b.left,right:b.right,top:b.top,bottom:b.bottom};};
    const intersection=(a,b)=>({left:Math.max(a.left,b.left),right:Math.min(a.right,b.right),top:Math.max(a.top,b.top),bottom:Math.min(a.bottom,b.bottom)});
    const area=b=>Math.max(0,b.right-b.left)*Math.max(0,b.bottom-b.top);
    return [focus,...(tile&&tile!==focus?[tile]:[])].map(el=>{
     const s=getComputedStyle(el),width=parseFloat(s.outlineWidth)||0,offset=parseFloat(s.outlineOffset)||0,b=rect(el),inner={left:b.left-offset,right:b.right+offset,top:b.top-offset,bottom:b.bottom+offset},outer={left:inner.left-width,right:inner.right+width,top:inner.top-width,bottom:inner.bottom+width};
     let clip={left:0,top:0,right:innerWidth,bottom:innerHeight};const ancestors=[];
     for(let p=el.parentElement;p;p=p.parentElement){const style=getComputedStyle(p),r=rect(p),x=style.overflowX!=='visible',y=style.overflowY!=='visible';if(!x&&!y)continue;
      const c={left:x?r.left+(parseFloat(style.borderLeftWidth)||0):-Infinity,right:x?r.right-(parseFloat(style.borderRightWidth)||0):Infinity,top:y?r.top+(parseFloat(style.borderTopWidth)||0):-Infinity,bottom:y?r.bottom-(parseFloat(style.borderBottomWidth)||0):Infinity};clip=intersection(clip,c);ancestors.push({tag:p.tagName,classes:p.className,overflowX:style.overflowX,overflowY:style.overflowY,box:r});}
     const visibleArea=s.outlineStyle==='none'||width<=0?0:area(intersection(outer,clip))-area(intersection(inner,clip));
     return {tag:el.tagName,classes:el.className,width,offset,style:s.outlineStyle,visibleArea,box:b,clip,ancestors};
    });
   });
   const painted=async label=>{const rings=await ringPaint();observations.push({phase:label,active:await active(),rings});assert.ok(rings.some(r=>r.visibleArea>1),'selected picture outline has painted area outside ancestor clipping');};
   const checkGrid=async label=>{
    const rows=await layout();observations.push({phase:label,rows});assert.equal(rows.flat().length,count,'every authored picture is drawn');assert.ok(rows[0].length>=2,'real thumbnail row');
    if(!phone){await thumb(rows[0][0].id).focus();await page.locator('#messages .message-card').filter({hasText:'Feed entry1030 plain.'}).focus();await page.keyboard.press('ArrowRight');assert.equal((await active()).image,rows[0][0].id,'native feed Right enters retained tile');await painted('native feed entry');await page.screenshot({path:`${evidence}/${key}-feed-entry.png`});}
    if(phone)await thumb(rows[0][0].id).locator('img.image-thumb').focus();
    for(const expected of [rows[0][1],rows[0][Math.min(2,rows[0].length-1)]]){
     await page.keyboard.press('ArrowRight');
     const at=await active(),focus=await page.evaluate(()=>{const el=document.activeElement,s=getComputedStyle(el);return {tag:el.tagName,outlineStyle:s.outlineStyle,outlineWidth:s.outlineWidth,focusVisible:el.matches(':focus-visible')};});
     observations.push({phase:'consecutive Right without resetting focus',expected:expected.id,active:at,focus});
     assert.equal(at.image,expected.id,'consecutive Right retains the next drawn picture');assert.equal(focus.tag,'IMG');assert.notEqual(focus.outlineStyle,'none');assert.ok(parseFloat(focus.outlineWidth)>0);await painted('continued Right unclipped ring');
    }
    if(rows.length>1){await move(rows[0][0],'ArrowDown',rows[1][0]);assert.equal((await active()).tag,'IMG','grid landing retains actual picture Return owner');await painted('Down ring');await move(rows[1][0],'ArrowUp',rows[0][0]);await painted('Up ring');}
    await move(rows[0][0],'ArrowRight',rows[0][1]);await move(rows[0][1],'ArrowLeft',rows[0][0]);await move(rows[0].at(-1),'ArrowRight',rows[0].at(-1));
    await thumb(rows[0][1].id).focus();await page.keyboard.press('ArrowUp');const header=await active();assert.equal(header.tag,'SUMMARY');assert.equal(header.section,'images');assert.equal(header.feed,false);assert.equal(await section.evaluate(s=>s.open),true);
    const last=rows.at(-1),prior=rows.at(-2)??[],missing=prior.find(c=>!last.some(l=>c.cx>l.left&&c.cx<l.right));if(missing)await move(missing,'ArrowDown',missing);
    const next=await section.evaluate(s=>{for(let p=s.nextElementSibling;p;p=p.nextElementSibling)if(!p.hidden)return p.dataset.key;return null;});
    if(next){await thumb(last[0].id).focus();await page.keyboard.press('ArrowDown');const at=await active();assert.equal(at.tag,'SUMMARY');assert.equal(at.section,next);}
    await thumb(rows.at(-1)[0].id).focus();await page.keyboard.press('ArrowLeft');assert.equal((await active()).feed,true,'first visual column keeps996 feed handoff');await ensure();assert.equal(await section.evaluate(s=>s.open),true);
   };
   await checkGrid('actual default layout');
   if(!baseline&&width===1280&&look==='bookends'&&colorScheme==='light'){
    for(const columns of [2,4]){await section.locator('.things-thumbs').evaluate((g,n)=>g.style.gridTemplateColumns=`repeat(${n},minmax(0,1fr))`,columns);await checkGrid('controlled actual layout '+columns+' columns');}
    await section.locator('.things-thumbs').evaluate(g=>g.style.gridTemplateColumns='');
   }
   const cell={id:await page.locator('#things a[data-rail-image][title^="grid1030-"]').first().getAttribute('data-rail-image')};assert.ok(cell.id);await thumb(cell.id).focus();await page.keyboard.press('Shift+F10');
   await page.getByRole('menuitem',{name:'Copy link',exact:true}).waitFor();for(const name of ['Copy image','Download'])assert.ok(await page.getByRole('menuitem',{name,exact:true}).count());assert.ok(await page.getByRole('menuitem',{name:/^Archive its message/}).count());await page.keyboard.press('Escape');assert.equal((await active()).image,cell.id,'menu Escape returns thumbnail');
   const image=thumb(cell.id).locator('img.image-thumb');await image.waitFor();await image.focus();
   let opened=context.waitForEvent('page');await page.keyboard.press('Enter');let popup=await opened;await popup.waitForLoadState();assert.match(popup.url(),/^blob:/);await popup.close();
   opened=context.waitForEvent('page');if(phone)await image.tap();else await image.click();popup=await opened;await popup.waitForLoadState();assert.match(popup.url(),/^blob:/);await popup.close();
   await page.bringToFront();await ensure();
   assert.deepEqual(pageErrors,[]);await section.scrollIntoViewIfNeeded();await page.screenshot({path:`${evidence}/${key}.png`});
  }catch(e){error=e.stack;observations.push({phase:'failure',active:await active().catch(()=>null),rows:await layout().catch(()=>null)});await page.screenshot({path:`${evidence}/${key}-failure.png`}).catch(()=>{});}
  results.push({key,error:error??null,observations,pageErrors});await writeFile(`${evidence}/observations.json`,JSON.stringify(results,null,2));children(owned);await context.close();
 }
}catch(e){failure=e;}
finally{
 if(browser){children(owned);await browser.close();cleanup.browserClosed=!browser.isConnected();}
 const after=ps();cleanup.ownedPids=[...owned];cleanup.remainingOwned=after.filter(p=>owned.has(p.pid));cleanup.profileProcesses=profile?after.filter(p=>p.command.includes(profile)):[];
 if(profile&&cleanup.browserClosed&&!cleanup.remainingOwned.length&&!cleanup.profileProcesses.length){await rm(profile,{recursive:true});cleanup.profileRemoved=await access(profile).then(()=>false,()=>true);}
 children(fixtureOwned);fixture.stdin.end();cleanup.fixtureExit=await exit;cleanup.fixtureErrors=errors();cleanup.fixturePid=fixture.pid;
 cleanup.fixtureAbsent=!ps().some(p=>p.pid===fixture.pid);cleanup.fixtureOwnedPids=[...fixtureOwned];cleanup.remainingFixtureOwned=ps().filter(p=>fixtureOwned.has(p.pid));
 if(origin)cleanup.portClosed=await new Promise(resolve=>{const u=new URL(origin),s=net.createConnection({host:u.hostname,port:+u.port});s.once('connect',()=>{s.destroy();resolve(false);});s.once('error',()=>resolve(true));});
 await writeFile(`${evidence}/results.json`,JSON.stringify({engine,count,baseline,sourceHash,sourceHashes,results,cleanup,failure:failure?.stack??null},null,2));
}
const failed=results.filter(r=>r.error);process.stdout.write(JSON.stringify({engine,pass:results.length-failed.length,fail:failed.length,failed:failed.map(r=>({key:r.key,error:r.error})),cleanup,fatal:failure?.stack??null},null,2)+'\n');
if(!results.length||failure||failed.length||!cleanup.browserClosed||cleanup.remainingOwned?.length||cleanup.profileProcesses?.length||!cleanup.profileRemoved||cleanup.fixtureExit?.code!==0||!cleanup.fixtureAbsent||cleanup.remainingFixtureOwned?.length||!cleanup.portClosed)process.exitCode=1;

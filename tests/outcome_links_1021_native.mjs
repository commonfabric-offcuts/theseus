// Native gestures and real isolated Core; viewport emulation is not a physical phone.
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, writeFile, rm, access } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import net from 'node:net';
import http from 'node:http';
import { fixtureControl } from './fixture_control.mjs';
import { Api } from '../web/api.mjs';

const engines = await import(process.env.AIM_PLAYWRIGHT_CORE), engine = process.env.AIM_BROWSER ?? 'chromium';
const evidence = process.argv[2]; await mkdir(evidence, { recursive: true });
const sourceFiles = ['web/things-rail.mjs','web/workspace-links.mjs','web/glyphs.mjs','web/browser-link.svg','web/rails.css','web/app.mjs','web/api.mjs','web/key-tree.mjs','web/arrow-reach.mjs',
  'web/freshness.mjs','web/topic-views.mjs','web/outcome-refresh.mjs',
  'aim_next/workspace_links.py','aim_next/store.py','aim_next/migrations.py','aim_next/validation.py','aim_next/contract.py','aim_next/server.py',
  'tests/fixtures/ui_http.py','tests/outcome_links_1021_native.mjs'];
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const hashes = Object.fromEntries(await Promise.all(sourceFiles.map(async path => [path, digest(await readFile(path))])));
await writeFile(`${evidence}/source.json`, JSON.stringify({checkout_head:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),hashes,
  driver:process.env.AIM_PLAYWRIGHT_CORE,executable:engine==='chromium'?process.env.AIM_CHROME:process.env.AIM_WEBKIT},null,2));
const fixture = spawn('/usr/bin/python3',['-B','tests/fixtures/ui_http.py','--freshness','--live']);
const {control,exit,errors} = fixtureControl(fixture), results = [], cleanup = {}, owned = new Set();
const ps = () => execFileSync('/bin/ps',['-axo','pid=,ppid=,command='],{encoding:'utf8'}).trim().split('\n').map(line => {
  const [,pid,ppid,command] = line.match(/^\s*(\d+)\s+(\d+)\s+(.*)$/); return {pid:+pid,ppid:+ppid,command};
});
let browser, profile, origin, failure, activePage, iconServer, iconOrigin;
const iconRequests=[], iconBytes=await readFile('tests/fixtures/media/screen.png');
const portClosed = origin => new Promise(resolve=>{const u=new URL(origin),s=net.createConnection({host:u.hostname,port:+u.port});s.once('connect',()=>{s.destroy();resolve(false);});s.once('error',()=>resolve(true));});
function retain() { const list=ps();for(let changed=true;changed;){changed=false;for(const p of list)if((owned.has(p.ppid)||profile&&p.command.includes(profile))&&!owned.has(p.pid)){owned.add(p.pid);changed=true;}} }
try {
  iconServer=http.createServer((request,response)=>{iconRequests.push({url:request.url,referer:request.headers.referer??null,sha256:digest(iconBytes)});response.writeHead(200,{'Content-Type':'image/png','Content-Length':iconBytes.length,'Cache-Control':'no-store'});response.end(iconBytes);});
  await new Promise(resolve=>iconServer.listen(0,'127.0.0.1',resolve));iconOrigin=`http://127.0.0.1:${iconServer.address().port}`;
  const facts = await control({method:'ready'}); origin = facts.origin;
  const api = new Api(facts.token,(url,init)=>fetch(new URL(url,origin),{...init,headers:{...init?.headers,Origin:origin}})), bootstrap = await api.bootstrap();
  const set = async (workspace,url,title,revision=0,removed=false) => {
    const receipt=await api.command({v:1,instance_id:facts.instance_id,operation_id:crypto.randomUUID(),kind:'workspace.link_set',target:{workspace_id:workspace},
      expected:{authority:{authority_id:bootstrap.authority.authority_id,authority_epoch:bootstrap.authority.authority_epoch},link_revision:revision},args:{url,title,removed}});assert.equal(receipt.status,'committed');return receipt;
  };
  profile = await mkdtemp(`${evidence}/${engine}-profile-`);
  const executablePath=engine==='chromium'?process.env.AIM_CHROME:process.env.AIM_WEBKIT;
  const persistent = await engines[engine].launchPersistentContext(profile,{headless:true,...(executablePath?{executablePath}:{})});
  browser = persistent.browser(); retain(); assert.ok(owned.size);
  const cells=process.env.AIM_1021_PREFLIGHT==='phone'?[[390,'bookends','light']]:process.env.AIM_1021_PREFLIGHT==='1'?[[1280,'bookends','light']]:[1280,390].flatMap(width=>['bookends','paper'].flatMap(look=>['light','dark'].map(theme=>[width,look,theme])));
  for(const [width,look,colorScheme] of cells) {
    const key=`${width}-${look}-${colorScheme}`, workspace=`links1021-${key}`, result={key,receipts:[],errors:[],iconRequests:[],console:[]};
    await control({method:'team_outcome',operation_id:workspace,workspace_id:workspace,title:`Links ${key}`,team:[facts.agent]});
    const conversation=await control({method:'agent_view',actor:facts.actor,name:'conversation',args:{workspace_id:workspace}}), topic=conversation.conversation.topic_id;
    const legacy=`${origin}/preview/legacy-${key}`;
    await control({method:'agent_message',operation_id:`legacy-${key}`,sender:'person',whole_topic:true,topic_id:topic,body:`[Existing preview](${legacy})`});
    for(let n=0;n<18;n++)result.receipts.push(await set(workspace,`${origin}/seed/${key}/${n}`,`Link ${n} ${n===2?'with a longer title':''}`));
    const iconStart=iconRequests.length,site=`${iconOrigin}/site/${key}`;result.receipts.push(await set(workspace,site,'Site icon fixture'));
    const context=await browser.newContext({viewport:{width,height:950},colorScheme,...(width<761?{isMobile:true,hasTouch:true}:{})});
    await context.addInitScript(look=>{localStorage.setItem('theseus-look',look);window.iconEvents1021=[];addEventListener('error',e=>{if(e.target?.tagName==='IMG')window.iconEvents1021.push({src:e.target.src,html:e.target.outerHTML});},true);window.copied1021=[];Object.defineProperty(navigator,'clipboard',{value:{writeText:async text=>window.copied1021.push(text)},configurable:true});},look);
    // Real independent HTTP icon origin. Playwright suppresses /favicon.ico
    // whenever interception is enabled, so no route interception before decode.
    const page=await context.newPage(); activePage=page; page.setDefaultTimeout(6000);let phase='active';result.leavingReadCancellations=[];page.on('pageerror',e=>{const detail={message:e.message,stack:e.stack,phase};const first=e.stack?.split('\n')[0]??'';if(engine==='webkit'&&phase==='leaving'&&first===`Fetch API cannot load ${origin}/api/view due to access control checks.`)result.leavingReadCancellations.push(detail);else result.errors.push(detail);});page.on('request',r=>{if(/favicon|icon-probe/.test(r.url()))result.iconRequests.push({url:r.url(),requested:true});});page.on('console',m=>result.console.push(m.text()));page.on('requestfailed',r=>result.iconRequests.push({url:r.url(),failure:r.failure()}));
    const served={},jobs=[];page.on('response',response=>{const name='web/'+new URL(response.url()).pathname.split('/').at(-1);if(Object.hasOwn(hashes,name))jobs.push(response.body().then(bytes=>served[name]=digest(bytes)));});
    const openRail=async()=>{if(width<1181&&!(await page.locator('#things-open').getAttribute('aria-expanded')==='true'))await page.locator('#things-open').click();};
    const section=page.locator('#things .things-sec[data-key=previews]'),form=section.locator('.link-form');
    const anchor=url=>section.locator(`a[data-outcome-link][href="${url}"]`);
    const press=target=>width<761?target.tap():target.click();
    const door=async url=>{const a=anchor(url);if(width<761)await a.locator('..').locator('button[data-link-menu]').tap();else await a.click({button:'right'});const sheet=page.getByRole('menu',{name:'Link',exact:true});await sheet.waitFor();return sheet;};
    const menu=async(url,name)=>{const sheet=await door(url);await press(sheet.getByRole('menuitem',{name,exact:true}));};
    try {
      result.pageHeaders=await (await page.goto(`${origin}/?topic=${topic}`)).allHeaders();await page.locator('body[data-ready=true]').waitFor();await openRail();
      await anchor(legacy).waitFor();assert.equal((await section.locator('.things-section-name').textContent()).trim(),'Links');
      await page.waitForFunction(url=>[...document.querySelectorAll('a[data-outcome-link]')].find(a=>a.href===url)?.querySelector('img.link-favicon')?.naturalWidth>0,site);
      assert.equal(await anchor(legacy).locator('.link-browser-fallback').count(),1);assert.ok(await anchor(legacy).locator('.link-browser-fallback').evaluate(image=>image.naturalWidth>0));result.iconDecoded=true;result.iconHTTP=iconRequests.slice(iconStart);assert.ok(result.iconHTTP.some(r=>r.url==='/favicon.ico'&&r.referer===null&&r.sha256===digest(iconBytes)));
      const pencil=section.locator('.link-create');
      result.reviewFailures=[];
      const reviewCheck=async(name,task)=>{try{await task();}catch(error){result.reviewFailures.push({name,error:error.stack});}};
      if(width===1280&&look==='bookends'&&colorScheme==='light')await reviewCheck('strict306 freshness consumer keeps receiving messages after a Link write',async()=>{
        const oldSource=execFileSync('git',['show','5ccd5432284200e823c123c5689383d13f1c8fb7:web/freshness.mjs']),oldPage=await context.newPage();let oldServed=null,leaving=false;
        result.rolloutPageErrors=[];result.rolloutLeaving=[];
        oldPage.on('pageerror',error=>{if(engine==='webkit'&&leaving&&error.stack?.split('\n')[0]===`Fetch API cannot load ${origin}/api/view due to access control checks.`)result.rolloutLeaving.push(error.stack);else result.rolloutPageErrors.push(error.stack);});
        await oldPage.route('**/freshness.mjs',route=>route.fulfill({status:200,contentType:'text/javascript',body:oldSource}));
        oldPage.on('response',response=>{if(new URL(response.url()).pathname.endsWith('/freshness.mjs'))jobs.push(response.body().then(bytes=>oldServed=digest(bytes)));});
        try{
          await oldPage.goto(`${origin}/?topic=${topic}`);await oldPage.locator('body[data-ready=true]').waitFor();
          await Promise.all(jobs);result.rolloutConsumer={base:'306',sha256:digest(oldSource),served_sha256:oldServed};assert.equal(oldServed,digest(oldSource));
          result.rolloutWrite=await set(workspace,`${origin}/rollout/${key}`,'Team Link after old consumer boot');
          result.rolloutMessage=await control({method:'agent_message',operation_id:`rollout-message-${key}`,sender:'person',whole_topic:true,topic_id:topic,body:'Message after a Link write under the strict306 consumer'});
          await oldPage.locator(`[data-id="${result.rolloutMessage.result.message_id}"]`).first().waitFor();
          await Promise.all(jobs);assert.equal(oldServed,digest(oldSource));assert.deepEqual(result.rolloutPageErrors,[]);
          result.rolloutConsumer={base:'306',sha256:digest(oldSource),served_sha256:oldServed,messageVisible:true};
        }finally{leaving=true;await oldPage.close();}
      });
      for(const choice of ['Open','Rename','Remove'])await reviewCheck(`menu ${choice} resolves a tile repainted while its sheet is open`,async()=>{
        const url=`${origin}/stale-menu/${key}/${choice.toLowerCase()}`;await set(workspace,url,'Before menu repaint');await anchor(url).waitFor();
        const old=await anchor(url).elementHandle(),sheet=await door(url);await set(workspace,url,'After menu repaint',1);await anchor(url).filter({hasText:'After menu repaint'}).waitFor();assert.equal(await old.evaluate(el=>el.isConnected),false);
        try{
          if(choice==='Open'){
            const waiting=page.waitForEvent('popup',{timeout:1800}).then(popup=>({popup}),error=>({error}));await press(sheet.getByRole('menuitem',{name:'Open',exact:true}));const opened=await waiting;
            if(opened.popup){assert.equal(opened.popup.url(),url);await opened.popup.close();}assert.ok(opened.popup,opened.error?.message);
          }else if(choice==='Rename'){
            await press(sheet.getByRole('menuitem',{name:'Rename',exact:true}));await form.waitFor();assert.equal(await form.getByRole('textbox',{name:'Link title',exact:true}).inputValue(),'After menu repaint');
          }else{
            await press(sheet.getByRole('menuitem',{name:'Remove',exact:true}));await anchor(url).waitFor({state:'detached'});const kept=(await api.view('workspace_links',{workspace_id:workspace})).items.find(row=>row.url===url);assert.equal(kept.removed,true);assert.equal(kept.revision,3);
          }
        }finally{if(await form.isVisible())await press(form.getByRole('button',{name:'Cancel',exact:true}));await page.keyboard.press('Escape');await openRail();}
      });
      await reviewCheck('Remove refusal survives another actual write and Live repaint',async()=>{
        const url=`${origin}/refusal/${key}`,next=`${origin}/after-refusal/${key}`;await set(workspace,url,'Refusal target');await anchor(url).waitFor();let conflicted=false;
        const route=async request=>{const envelope=request.request().postDataJSON();if(envelope.kind==='workspace.link_set'&&envelope.args.url===url&&envelope.args.removed&&!conflicted){conflicted=true;await set(workspace,url,'Other client wins',1);}await request.continue();};
        await page.route('**/api/command',route);
        const waiting=page.waitForResponse(response=>response.url().endsWith('/api/command')&&response.request().postDataJSON().args?.url===url).then(response=>response.json()).then(value=>({value}),error=>({error}));
        try{
          await menu(url,'Remove');const response=await waiting;assert.ifError(response.error);result.menuRefusal=response.value;assert.equal(result.menuRefusal.error.code,'REVISION_CONFLICT');await set(workspace,next,'Live after refusal');await anchor(next).waitFor();
          await section.locator('.notice').filter({hasText:'Writing changed'}).waitFor();result.refusalKeptAfterLive=true;
        }finally{await page.unroute('**/api/command',route);}
      });
      await reviewCheck('Copy failure survives a subsequent actual Live repaint',async()=>{
        await page.evaluate(()=>{window.savedCopy1021=navigator.clipboard.writeText;navigator.clipboard.writeText=async()=>{throw Error('isolated clipboard refusal');};});
        try{await menu(site,'Copy link');const url=`${origin}/copy-refusal/${key}`;await set(workspace,url,'Live after Copy refusal');await anchor(url).waitFor();await section.locator('.notice').filter({hasText:'Could not copy this link.'}).waitFor();result.copyRefusalKept=true;}
        finally{await page.evaluate(()=>{navigator.clipboard.writeText=window.savedCopy1021;});}
      });
      await reviewCheck('menu Rename cannot steal an in-flight Add refusal',async()=>{
        const url=`${origin}/pending-add/${key}`;let release,received,routeDone,routeFailure;const held=new Promise(resolve=>release=resolve),captured=new Promise(resolve=>received=resolve);
        const route=request=>{const envelope=request.request().postDataJSON();if(envelope.kind!=='workspace.link_set'||envelope.args.url!==url)return request.continue();routeDone=(async()=>{const response=await request.fetch();result.pendingAddReceipt=await response.json();received();await held;await request.fulfill({response});})().catch(error=>{routeFailure=error;received();});return routeDone;};
        await page.route('**/api/command',route);await press(pencil);await form.getByRole('textbox',{name:'Link URL',exact:true}).fill(url);await form.getByRole('textbox',{name:'Link title',exact:true}).fill('Pending\tAdd refusal');
        try{
          await press(form.getByRole('button',{name:'Add link',exact:true}));await Promise.race([captured,page.waitForTimeout(6000).then(()=>{throw Error('Add request did not reach isolated Core');})]);assert.equal(result.pendingAddReceipt.error.code,'INVALID_ARGUMENT');
          await menu(site,'Rename');assert.equal(await form.getByRole('textbox',{name:'Link URL',exact:true}).inputValue(),url);assert.equal(await form.getByRole('textbox',{name:'Link title',exact:true}).inputValue(),'Pending\tAdd refusal');
          release();await form.locator('.link-notice').filter({hasText:'control or invisible'}).waitFor();result.pendingAddRefusalKept=true;
        }finally{release();if(routeDone)await routeDone;await page.unroute('**/api/command',route);assert.ifError(routeFailure);if(await form.isVisible())await press(form.getByRole('button',{name:'Cancel',exact:true}));}
      });
      if(width<761)await reviewCheck('phone dots leave the browser icon visible and tappable',async()=>{
        await anchor(site).scrollIntoViewIfNeeded();
        result.iconMenuGeometry=await anchor(site).evaluate(a=>{
          const rect=el=>{const b=el.getBoundingClientRect();return{x:b.x,y:b.y,width:b.width,height:b.height,left:b.left,right:b.right,top:b.top,bottom:b.bottom};};
          const icon=rect(a.querySelector('.link-browser')),menu=rect(a.parentElement.querySelector('[data-link-menu]'));
          const overlap={left:Math.max(icon.left,menu.left),right:Math.min(icon.right,menu.right),top:Math.max(icon.top,menu.top),bottom:Math.min(icon.bottom,menu.bottom)};
          const area=Math.max(0,overlap.right-overlap.left)*Math.max(0,overlap.bottom-overlap.top);
          const hit=area?document.elementFromPoint((overlap.left+overlap.right)/2,(overlap.top+overlap.bottom)/2):null;
          return{icon,menu,overlapArea:area,overlapHitsMenu:!!hit?.closest('[data-link-menu]'),iconCenterHitsLink:document.elementFromPoint(icon.x+icon.width/2,icon.y+icon.height/2)?.closest('a')===a};
        });
        await page.screenshot({path:`${evidence}/${key}-icon-menu.png`});
        assert.ok(result.iconMenuGeometry.menu.width>=44&&result.iconMenuGeometry.menu.height>=44);
        assert.equal(result.iconMenuGeometry.overlapArea,0,JSON.stringify(result.iconMenuGeometry));
        assert.equal(result.iconMenuGeometry.iconCenterHitsLink,true);
      });
      await reviewCheck('pencil closes and retains unsent writing',async()=>{
        await press(pencil);await form.waitFor();await form.getByRole('textbox',{name:'Link URL',exact:true}).fill(`${origin}/unsent/a-very-long-path?ids[]=1`);await form.getByRole('textbox',{name:'Link title',exact:true}).fill('Unsent title');
        await press(pencil);assert.equal(await form.isVisible(),false,'second pencil press closes');
        assert.equal(await pencil.getAttribute('aria-expanded'),'false');await press(pencil);await form.waitFor();
        assert.equal(await form.getByRole('textbox',{name:'Link title',exact:true}).inputValue(),'Unsent title');assert.equal(await form.getByRole('textbox',{name:'Link URL',exact:true}).inputValue(),`${origin}/unsent/a-very-long-path?ids[]=1`);
      });
      if(await form.isVisible())await press(form.getByRole('button',{name:'Cancel',exact:true}));
      await reviewCheck('Rename over Add keeps the exact unsent Add writing',async()=>{
        const draftURL=`${origin}/unsent/under-rename?ids[]=7`,draftTitle='Add draft under a tile menu';
        await press(pencil);await form.waitFor();await form.getByRole('textbox',{name:'Link URL',exact:true}).fill(draftURL);await form.getByRole('textbox',{name:'Link title',exact:true}).fill(draftTitle);
        await menu(site,'Rename');await form.waitFor();assert.equal(await form.getByRole('textbox',{name:'Link URL',exact:true}).inputValue(),site);
        await press(form.getByRole('button',{name:'Cancel',exact:true}));await press(pencil);await form.waitFor();
        result.addDraftAfterRename={url:await form.getByRole('textbox',{name:'Link URL',exact:true}).inputValue(),title:await form.getByRole('textbox',{name:'Link title',exact:true}).inputValue()};
        assert.deepEqual(result.addDraftAfterRename,{url:draftURL,title:draftTitle});
      });
      if(await form.isVisible())await press(form.getByRole('button',{name:'Cancel',exact:true}));
      if(width<761&&engine==='chromium')for(const door of ['Open','Escape then Return'])await reviewCheck(`native hold then ${door} opens the link`,async()=>{
        await page.keyboard.press('Escape');await openRail();const a=anchor(site);await a.locator('.link-title').scrollIntoViewIfNeeded();
        const box=await a.locator('.link-title').boundingBox(),point={x:box.x+box.width/2,y:box.y+box.height/2};
        const cdp=await context.newCDPSession(page),sheet=page.getByRole('menu',{name:'Link',exact:true});
        await page.evaluate(()=>{
          window.linkDoorTrace1021=[];window.linkDoorPrevent1021=Event.prototype.preventDefault;
          Event.prototype.preventDefault=function(){if(this.type==='click'||this.type==='keydown')window.linkDoorTrace1021.push({prevent:this.type,key:this.key,stack:new Error().stack});return window.linkDoorPrevent1021.call(this);};
        });
        try{
          await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[point]});await sheet.waitFor();
          await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
          await page.waitForTimeout(350); // Let the native compatibility click finish before the next act.
          const pending=page.waitForEvent('popup',{timeout:1800}).then(popup=>({popup}),error=>({error}));
          if(door==='Open')await sheet.getByRole('menuitem',{name:'Open',exact:true}).tap();
          else{await page.keyboard.press('Escape');assert.equal(await sheet.isVisible(),false,'Escape closes the held sheet after native release');assert.equal(await a.evaluate(el=>el.ownerDocument.activeElement===el),true);await page.keyboard.press('Enter');}
          const opened=await pending;
          (result.holdOpenResults??=[]).push({door,point,opened:!!opened.popup,error:opened.error?.message,trace:await page.evaluate(()=>({prevents:window.linkDoorTrace1021,railOpen:document.querySelector('#things-open')?.getAttribute('aria-expanded'),focus:document.activeElement?.outerHTML?.slice(0,600)}))});
          if(opened.popup){assert.equal(opened.popup.url(),site);await opened.popup.close();}
          assert.ok(opened.popup,`${door}: ${opened.error?.message}`);
        }finally{await page.evaluate(()=>{Event.prototype.preventDefault=window.linkDoorPrevent1021;});await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]}).catch(()=>{});await cdp.detach();await page.keyboard.press('Escape');await openRail();}
      });
      if(width<761&&engine==='chromium')await reviewCheck('native hold release does not choose Remove under finger',async()=>{
        const holdURL=`${origin}/seed/${key}/0`;await page.setViewportSize({width,height:580});await openRail();
        await anchor(holdURL).locator('xpath=..').locator('[data-link-menu]').tap();
        const sheet=page.getByRole('menu',{name:'Link',exact:true}),remove=sheet.getByRole('menuitem',{name:'Remove',exact:true});
        const removeBox=await remove.boundingBox();await page.keyboard.press('Escape');
        await anchor(holdURL).scrollIntoViewIfNeeded();
        await anchor(holdURL).evaluate((el,y)=>{const b=el.getBoundingClientRect();let parent=el.parentElement;while(parent&&parent.scrollHeight<=parent.clientHeight)parent=parent.parentElement;if(parent)parent.scrollTop+=b.y+b.height/2-y;},removeBox.y+removeBox.height/2);
        const b=await anchor(holdURL).boundingBox(),point={x:b.x+b.width/2,y:removeBox.y+removeBox.height/2};
        result.holdGeometry={tile:b,remove:removeBox,point};assert.ok(point.y>=b.y&&point.y<=b.y+b.height,JSON.stringify(result.holdGeometry));
        await page.evaluate(()=>{window.holdTrace1021=[];for(const type of ['pointerdown','pointerup','pointercancel','click'])document.addEventListener(type,e=>window.holdTrace1021.push({type,trusted:e.isTrusted,target:e.target.textContent?.slice(0,80),pointer:e.pointerType,x:e.clientX,y:e.clientY}),true);});
        const before=(await api.view('workspace_links',{workspace_id:workspace})).items.find(row=>row.url===holdURL),cdp=await context.newCDPSession(page);
        await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[point]});await sheet.waitFor();
        result.holdUnderFinger=await page.evaluate(p=>document.elementFromPoint(p.x,p.y)?.closest('[role=menuitem]')?.textContent?.trim(),point);
        assert.equal(result.holdUnderFinger,'Remove');
        await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await page.waitForTimeout(350);
        result.holdTrace=await page.evaluate(()=>window.holdTrace1021);result.holdAfter=(await api.view('workspace_links',{workspace_id:workspace})).items.find(row=>row.url===holdURL);
        assert.equal(result.holdAfter.removed,false,'release must not remove the tile');assert.equal(result.holdAfter.revision,before.revision);
        assert.equal(await sheet.isVisible(),true);await remove.tap();await anchor(holdURL).waitFor({state:'detached'});
        result.deliberateRemove=(await api.view('workspace_links',{workspace_id:workspace})).items.find(row=>row.url===holdURL);assert.equal(result.deliberateRemove.removed,true);assert.equal(result.deliberateRemove.revision,before.revision+1);await page.waitForFunction(url=>document.activeElement?.getAttribute('data-outcome-link')===url,`${origin}/seed/${key}/1`);result.neighbourFocus=true;
        await cdp.detach();
      });
      await page.keyboard.press('Escape');await page.setViewportSize({width,height:950});await openRail();
      await press(pencil);await form.waitFor();
      const custom=`${origin}/added/${key}`;await form.getByRole('textbox',{name:'Link URL',exact:true}).fill(custom);await form.getByRole('textbox',{name:'Link title',exact:true}).fill('Added by native input');
      let lost=true;const attempts=[];
      await page.route('**/api/command',async route=>{const envelope=route.request().postDataJSON();if(envelope.kind!=='workspace.link_set')return route.continue();attempts.push(envelope.operation_id);
        if(lost){lost=false;const response=await route.fetch();result.lostReceipt=await response.json();assert.equal(result.lostReceipt.status,'committed');return route.abort('failed');}return route.continue();});
      await press(form.getByRole('button',{name:'Add link',exact:true}));await form.locator('.link-notice').filter({hasText:'unknown'}).waitFor();
      assert.equal(await form.getByRole('textbox',{name:'Link title',exact:true}).inputValue(),'Added by native input');
      await press(form.getByRole('button',{name:'Add link',exact:true}));await form.waitFor({state:'hidden'});await anchor(custom).waitFor();
      assert.equal(attempts.length,2);assert.equal(attempts[0],attempts[1]);result.exactRetry=attempts;
      result.confirmedOperation=await api.view('operation',{operation_id:attempts[0]});assert.equal(result.confirmedOperation.result.link.url,custom);
      await page.unroute('**/api/command');
      await menu(custom,'Rename');await form.getByRole('textbox',{name:'Link title',exact:true}).fill('Renamed native link');await press(form.getByRole('button',{name:'Save',exact:true}));await form.waitFor({state:'hidden'});
      await anchor(custom).filter({hasText:'Renamed native link'}).waitFor();
      await anchor(custom).focus();await page.keyboard.press('Shift+F10');await page.getByRole('menu',{name:'Link'}).getByRole('menuitem',{name:'Copy link',exact:true}).click();
      assert.deepEqual(await page.evaluate(()=>window.copied1021),[custom]);
      const feedbackURL=`${origin}/copy-feedback/${key}`;result.receipts.push(await set(workspace,feedbackURL,'Live repaint after Copy'));
      await anchor(feedbackURL).waitFor();await page.locator('#things').getByText('Link copied.',{exact:true}).waitFor();result.copyFeedback=true;
      await menu(legacy,'Remove');await anchor(legacy).waitFor({state:'detached'});
      phase='leaving';await page.reload();await page.locator('body[data-ready=true]').waitFor();phase='active';await openRail();await anchor(custom).waitFor();assert.equal(await anchor(legacy).count(),0);
      const geometry=async()=>section.locator('a[data-outcome-link]').evaluateAll(nodes=>nodes.map(n=>({url:n.href,box:(()=>{const b=n.getBoundingClientRect();return{left:b.left,right:b.right,top:b.top,bottom:b.bottom};})()})));
      result.geometry=await geometry();const first=result.geometry[0],sameRow=result.geometry.filter(r=>Math.abs(r.box.top-first.box.top)<1).sort((a,b)=>a.box.left-b.box.left);
      assert.ok(sameRow.length>=2);await anchor(sameRow[0].url).focus();await page.keyboard.press('ArrowRight');assert.equal(await page.evaluate(()=>document.activeElement.href),sameRow[1].url);await page.keyboard.press('ArrowLeft');assert.equal(await page.evaluate(()=>document.activeElement.href),sameRow[0].url);
      const below=result.geometry.filter(r=>r.box.top>=first.box.bottom-.5&&Math.abs(r.box.left-first.box.left)<1).sort((a,b)=>a.box.top-b.box.top)[0];
      assert.ok(below);await anchor(first.url).focus();await page.keyboard.press('ArrowDown');assert.equal(await page.evaluate(()=>document.activeElement.href),below.url);
      await page.keyboard.press('ArrowUp');assert.equal(await page.evaluate(()=>document.activeElement.href),first.url);
      if(width<761){
        await page.setViewportSize({width:320,height:950});result.resizedGeometry=await geometry();
        const top=result.resizedGeometry[0],next=result.resizedGeometry.filter(r=>r.box.top>=top.box.bottom-.5&&Math.abs(r.box.left-top.box.left)<1).sort((a,b)=>a.box.top-b.box.top)[0];
        assert.ok(next);await anchor(top.url).focus();await page.keyboard.press('ArrowDown');assert.equal(await page.evaluate(()=>document.activeElement.href),next.url);
        assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.screenshot({path:`${evidence}/${key}-320.png`});
        await page.setViewportSize({width,height:950});
      }
      await anchor(custom).focus();const popupWait=page.waitForEvent('popup');await page.keyboard.press('Enter');const popup=await popupWait;assert.equal(popup.url(),custom);await popup.close();await openRail();result.returnOpened=true;
      const menuPopup=page.waitForEvent('popup');await menu(custom,'Open');const opened=await menuPopup;assert.equal(opened.url(),custom);await opened.close();await openRail();result.menuOpened=true;
      await page.screenshot({path:`${evidence}/${key}-links.png`});
      // A real newer Core revision refuses the stale rename, preserving the typed attempt.
      await menu(custom,'Rename');const before=(await api.view('workspace_links',{workspace_id:workspace})).items.find(row=>row.url===custom);
      result.receipts.push(await set(workspace,custom,'Other device title',before.revision));
      await anchor(custom).filter({hasText:'Other device title'}).waitFor();result.liveLinkRepaint=true;
      await form.getByRole('textbox',{name:'Link title',exact:true}).fill('Stale local title');await press(form.getByRole('button',{name:'Save',exact:true}));
      await form.locator('.link-notice').filter({hasText:'Writing changed'}).waitFor();assert.equal(await form.getByRole('textbox',{name:'Link title',exact:true}).inputValue(),'Stale local title');result.realConflictKept=true;
      await press(form.getByRole('button',{name:'Cancel',exact:true}));
      result.core=await api.view('workspace_links',{workspace_id:workspace});assert.equal(result.core.items.filter(row=>row.url===custom).length,1);assert.equal(result.core.items.find(row=>row.url===custom).title,'Other device title');
      assert.equal(result.core.items.find(row=>row.url===legacy).removed,true);
      // Core can retain a spelling different from browser navigation. Real
      // preview/title/removal/add gestures must keep that one Core identity.
      const keptURL=`${origin}/kept/a/../work-${key}`,navigationURL=`${origin}/kept/work-${key}`;
      await control({method:'agent_message',operation_id:`kept-preview-${key}`,sender:'person',whole_topic:true,topic_id:topic,body:`[Kept preview](${navigationURL})`});
      result.receipts.push(await set(workspace,keptURL,'Core-spelled override'));await anchor(keptURL).waitFor();
      const equivalent=()=>section.locator('a[data-outcome-link]').evaluateAll((nodes,url)=>nodes.filter(n=>n.href===url).length,navigationURL);
      assert.equal(await equivalent(),1);await menu(keptURL,'Rename');
      await form.getByRole('textbox',{name:'Link title',exact:true}).fill('Renamed kept address');await press(form.getByRole('button',{name:'Save',exact:true}));await form.waitFor({state:'hidden'});
      await anchor(keptURL).filter({hasText:'Renamed kept address'}).waitFor();
      let keptCore=await api.view('workspace_links',{workspace_id:workspace});assert.equal(keptCore.items.find(row=>row.url===keptURL).revision,2);assert.equal(keptCore.items.find(row=>row.url===keptURL).title,'Renamed kept address');assert.ok(!keptCore.items.some(row=>row.url===navigationURL));
      await menu(keptURL,'Remove');await anchor(keptURL).waitFor({state:'detached'});assert.equal(await equivalent(),0);
      await press(section.getByRole('button',{name:'Add link',exact:true}));await form.getByRole('textbox',{name:'Link URL',exact:true}).fill(navigationURL);await form.getByRole('textbox',{name:'Link title',exact:true}).fill('Restored kept address');await press(form.getByRole('button',{name:'Add link',exact:true}));await form.waitFor({state:'hidden'});await anchor(keptURL).waitFor();
      result.keptIdentity=await api.view('workspace_links',{workspace_id:workspace});const kept=result.keptIdentity.items.find(row=>row.url===keptURL);assert.equal(kept.revision,4);assert.equal(kept.removed,false);assert.equal(kept.title,'Restored kept address');assert.ok(!result.keptIdentity.items.some(row=>row.url===navigationURL));assert.equal(await equivalent(),1);
      const queryURL=`${origin}/preview/query-${key}?ids[]=1&bits={}^|\``;
      await control({method:'agent_message',operation_id:`query-preview-${key}`,sender:'person',whole_topic:true,topic_id:topic,body:`[Query preview](${queryURL})`});await anchor(queryURL).waitFor();
      await menu(queryURL,'Rename');await form.getByRole('textbox',{name:'Link title',exact:true}).fill('Bracket query renamed');await press(form.getByRole('button',{name:'Save',exact:true}));await form.waitFor({state:'hidden'});await anchor(queryURL).filter({hasText:'Bracket query renamed'}).waitFor();
      await menu(queryURL,'Remove');await anchor(queryURL).waitFor({state:'detached'});
      await press(section.locator('.link-create'));await form.getByRole('textbox',{name:'Link URL',exact:true}).fill(queryURL);await form.getByRole('textbox',{name:'Link title',exact:true}).fill('Bracket query restored');await press(form.getByRole('button',{name:'Add link',exact:true}));await form.waitFor({state:'hidden'});await anchor(queryURL).waitFor();
      result.queryIdentity=await api.view('workspace_links',{workspace_id:workspace});const queryRows=result.queryIdentity.items.filter(row=>row.url===queryURL);assert.equal(queryRows.length,1);assert.equal(queryRows[0].revision,3);assert.equal(queryRows[0].removed,false);assert.equal(queryRows[0].title,'Bracket query restored');
      const rtlURL='http://xn--1-ymcl5hc.com/';
      await page.route(rtlURL+'favicon.ico',route=>route.abort('blockedbyclient')); // No dependency on the external site's network.
      await press(pencil);await form.getByRole('textbox',{name:'Link URL',exact:true}).fill('http://مثال1.com/');await form.getByRole('textbox',{name:'Link title',exact:true}).fill('RTL digit host');await press(form.getByRole('button',{name:'Add link',exact:true}));await form.waitFor({state:'hidden'});await anchor(rtlURL).waitFor();
      await menu(rtlURL,'Rename');await form.getByRole('textbox',{name:'Link title',exact:true}).fill('Renamed RTL digit host');await press(form.getByRole('button',{name:'Save',exact:true}));await form.waitFor({state:'hidden'});await anchor(rtlURL).filter({hasText:'Renamed RTL digit host'}).waitFor();
      await menu(rtlURL,'Remove');await anchor(rtlURL).waitFor({state:'detached'});
      result.rtlIdentity=(await api.view('workspace_links',{workspace_id:workspace})).items.find(row=>row.url===rtlURL);assert.equal(result.rtlIdentity.revision,3);assert.equal(result.rtlIdentity.removed,true);
      await press(section.locator('.link-create'));const bracketURL=`${origin}/docs/[slug]-${key}?#`;await form.getByRole('textbox',{name:'Link URL',exact:true}).fill(bracketURL);await form.getByRole('textbox',{name:'Link title',exact:true}).fill('Bracket path');await press(form.getByRole('button',{name:'Add link',exact:true}));await form.waitFor({state:'hidden'});await anchor(bracketURL).waitFor();
      result.bracketIdentity=(await api.view('workspace_links',{workspace_id:workspace})).items.find(row=>row.url===bracketURL);assert.equal(result.bracketIdentity.revision,1);
      if(width<761){const box=await anchor(bracketURL).locator('xpath=..').locator('[data-link-menu]').boundingBox();assert.ok(box.width>=44&&box.height>=44,JSON.stringify(box));result.menuTouchTarget=box;}
      // A real team writer becomes topic-only: existing shared Links disappear.
      const shared=await control({method:'agent_topic',operation_id:`shared-${key}`,team:true,title:'Team Links',body:'Independent topic participation'});
      phase='leaving';await page.goto(`${origin}/?topic=${shared.topic_id}`);await page.locator('body[data-ready=true]').waitFor();phase='active';await openRail();
      await press(section.getByRole('button',{name:'Add link',exact:true}));const sharedURL=`${origin}/shared/${key}`;
      await form.getByRole('textbox',{name:'Link URL',exact:true}).fill(sharedURL);await form.getByRole('textbox',{name:'Link title',exact:true}).fill('Shared before revocation');
      await press(form.getByRole('button',{name:'Add link',exact:true}));await anchor(sharedURL).waitFor();
      result.sharedBefore=await api.view('workspace_links',{workspace_id:shared.workspace_id});assert.equal(result.sharedBefore.items[0].url,sharedURL);
      await control({method:'outcome_change',operation_id:`revoke-${key}`,sender:facts.agent,workspace_id:shared.workspace_id,member:facts.actor,present:false});
      await anchor(sharedURL).waitFor({state:'detached'});await section.locator('.link-create').waitFor({state:'hidden'});
      result.topicOnly=await control({method:'agent_view',actor:facts.actor,name:'workspace_links',args:{workspace_id:shared.workspace_id}});assert.equal(result.topicOnly.error.code,'FORBIDDEN');
      assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'no horizontal viewport overflow');
      await Promise.all(jobs);result.served=served;for(const [name,sha] of Object.entries(hashes))if(name.startsWith('web/'))assert.equal(served[name],sha,`actual served ${name}`);
      assert.deepEqual(result.errors,[]);assert.deepEqual(result.reviewFailures,[]);
    } catch(error) {result.error=error.stack;result.iconEvents=await page.evaluate(()=>window.iconEvents1021);await page.screenshot({path:`${evidence}/${key}-failure.png`,fullPage:true});await writeFile(`${evidence}/${key}-failure.html`,await page.content());}
    results.push(result);await writeFile(`${evidence}/observations.json`,JSON.stringify(results,null,2));retain();phase='leaving';await context.close();
  }
} catch(error) {failure=error;}
finally {
  if(browser){retain();await browser.close();}cleanup.browserClosed=browser?!browser.isConnected():true;
  fixture.stdin.end();cleanup.fixtureExit=await exit;cleanup.fixtureErrors=errors();
  const list=ps();cleanup.ownedPids=[...owned];cleanup.remainingOwned=list.filter(p=>owned.has(p.pid));cleanup.fixtureAbsent=!list.some(p=>p.pid===fixture.pid);
  cleanup.profileProcesses=profile?list.filter(p=>p.command.includes(profile)):[];
  if(profile&&cleanup.browserClosed&&!cleanup.remainingOwned.length&&!cleanup.profileProcesses.length)await rm(profile,{recursive:true});
  cleanup.profileAbsent=profile?await access(profile).then(()=>false,()=>true):null;
  if(origin)cleanup.portClosed=await portClosed(origin);
  if(iconServer)await new Promise(resolve=>iconServer.close(resolve));cleanup.iconPortClosed=iconOrigin?await portClosed(iconOrigin):true;
  await writeFile(`${evidence}/results.json`,JSON.stringify({engine,results,cleanup,failure:failure?.stack??null},null,2));
}
assert.ok(cleanup.browserClosed&&cleanup.fixtureAbsent&&cleanup.profileAbsent&&cleanup.portClosed&&cleanup.iconPortClosed);assert.equal(cleanup.fixtureExit.code,0);assert.equal(cleanup.fixtureErrors,'');assert.deepEqual(cleanup.remainingOwned,[]);assert.deepEqual(cleanup.profileProcesses,[]);
for(const name of sourceFiles)assert.equal(digest(await readFile(name)),hashes[name],`${name} unchanged during run`);
if(failure)throw failure;assert.ok(results.length&&results.every(row=>!row.error),'inspect native results');console.log(JSON.stringify({passed:results.length,cleanup}));

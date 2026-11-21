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
  'aim_next/workspace_links.py','aim_next/store.py','aim_next/migrations.py','aim_next/validation.py','aim_next/contract.py','aim_next/server.py',
  'tests/fixtures/ui_http.py','tests/outcome_links_1021_native.mjs'];
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const hashes = Object.fromEntries(await Promise.all(sourceFiles.map(async path => [path, digest(await readFile(path))])));
await writeFile(`${evidence}/source.json`, JSON.stringify({base:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),hashes},null,2));
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
  const persistent = await engines[engine].launchPersistentContext(profile,{headless:true,...(engine==='chromium'?{executablePath:process.env.AIM_CHROME}:{})});
  browser = persistent.browser(); retain(); assert.ok(owned.size);
  const cells=process.env.AIM_1021_PREFLIGHT==='1'?[[1280,'bookends','light']]:[1280,390].flatMap(width=>['bookends','paper'].flatMap(look=>['light','dark'].map(theme=>[width,look,theme])));
  for(const [width,look,colorScheme] of cells) {
    const key=`${width}-${look}-${colorScheme}`, workspace=`links1021-${key}`, result={key,receipts:[],errors:[],iconRequests:[],console:[]};
    await control({method:'team_outcome',operation_id:workspace,workspace_id:workspace,title:`Links ${key}`,team:[facts.agent]});
    const conversation=await control({method:'agent_view',actor:facts.actor,name:'conversation',args:{workspace_id:workspace}}), topic=conversation.conversation.topic_id;
    const legacy=`${origin}/preview/legacy-${key}`;
    await control({method:'agent_message',operation_id:`legacy-${key}`,sender:'person',whole_topic:true,topic_id:topic,body:`[Existing preview](${legacy})`});
    for(let n=0;n<6;n++)result.receipts.push(await set(workspace,`${origin}/seed/${key}/${n}`,`Link ${n} ${n===2?'with a longer title':''}`));
    const iconStart=iconRequests.length,site=`${iconOrigin}/site/${key}`;result.receipts.push(await set(workspace,site,'Site icon fixture'));
    const context=await browser.newContext({viewport:{width,height:950},colorScheme,...(width<761?{isMobile:true,hasTouch:true}:{})});
    await context.addInitScript(look=>{localStorage.setItem('theseus-look',look);window.iconEvents1021=[];addEventListener('error',e=>{if(e.target?.tagName==='IMG')window.iconEvents1021.push({src:e.target.src,html:e.target.outerHTML});},true);window.copied1021=[];Object.defineProperty(navigator,'clipboard',{value:{writeText:async text=>window.copied1021.push(text)},configurable:true});},look);
    // Real independent HTTP icon origin. Playwright suppresses /favicon.ico
    // whenever interception is enabled, so no route interception before decode.
    const page=await context.newPage(); activePage=page; page.setDefaultTimeout(6000);let phase='active';result.leavingReadCancellations=[];page.on('pageerror',e=>{const detail={message:e.message,stack:e.stack,phase};const first=e.stack?.split('\n')[0]??'';if(engine==='webkit'&&phase==='leaving'&&first===`Fetch API cannot load ${origin}/api/view due to access control checks.`)result.leavingReadCancellations.push(detail);else result.errors.push(detail);});page.on('request',r=>{if(/favicon|icon-probe/.test(r.url()))result.iconRequests.push({url:r.url(),requested:true});});page.on('console',m=>result.console.push(m.text()));page.on('requestfailed',r=>result.iconRequests.push({url:r.url(),failure:r.failure()}));
    const served={},jobs=[];page.on('response',response=>{const name='web/'+new URL(response.url()).pathname.split('/').at(-1);if(Object.hasOwn(hashes,name))jobs.push(response.body().then(bytes=>served[name]=digest(bytes)));});
    const openRail=async()=>{if(width<1181&&!(await page.locator('html').getAttribute('data-things-open')))await page.locator('#things-open').click();};
    const section=page.locator('#things .things-sec[data-key=previews]'),form=section.locator('.link-form');
    const anchor=url=>section.locator(`a[data-outcome-link][href="${url}"]`);
    const press=target=>width<761?target.tap():target.click();
    const menu=async(url,name)=>{const a=anchor(url);if(width<761)await a.locator('..').getByRole('button',{name:`Menu for ${await a.getAttribute('aria-label')}`,exact:true}).tap();else await a.click({button:'right'});await press(page.getByRole('menu',{name:'Link',exact:true}).getByRole('menuitem',{name,exact:true}));};
    try {
      result.pageHeaders=await (await page.goto(`${origin}/?topic=${topic}`)).allHeaders();await page.locator('body[data-ready=true]').waitFor();await openRail();
      await anchor(legacy).waitFor();assert.equal((await section.locator('.things-section-name').textContent()).trim(),'Links');
      await page.waitForFunction(url=>[...document.querySelectorAll('a[data-outcome-link]')].find(a=>a.href===url)?.querySelector('img.link-favicon')?.naturalWidth>0,site);
      assert.equal(await anchor(legacy).locator('.link-browser-fallback').count(),1);assert.ok(await anchor(legacy).locator('.link-browser-fallback').evaluate(image=>image.naturalWidth>0));result.iconDecoded=true;result.iconHTTP=iconRequests.slice(iconStart);assert.ok(result.iconHTTP.some(r=>r.url==='/favicon.ico'&&r.referer===null&&r.sha256===digest(iconBytes)));
      const pencil=section.getByRole('button',{name:'Add link',exact:true});await press(pencil);await form.waitFor();
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
      await form.getByRole('textbox',{name:'Link title',exact:true}).fill('Stale local title');await press(form.getByRole('button',{name:'Save',exact:true}));
      await form.locator('.link-notice').filter({hasText:'Writing changed'}).waitFor();assert.equal(await form.getByRole('textbox',{name:'Link title',exact:true}).inputValue(),'Stale local title');result.realConflictKept=true;
      await press(form.getByRole('button',{name:'Cancel',exact:true}));
      result.core=await api.view('workspace_links',{workspace_id:workspace});assert.equal(result.core.items.filter(row=>row.url===custom).length,1);assert.equal(result.core.items.find(row=>row.url===custom).title,'Other device title');
      assert.equal(result.core.items.find(row=>row.url===legacy).removed,true);
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
      assert.deepEqual(result.errors,[]);
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

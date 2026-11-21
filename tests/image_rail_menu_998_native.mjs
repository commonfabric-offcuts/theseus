// Native image rail menu, clipboard, stable address and Core Archive/Undo (998).
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { mkdir, writeFile, readFile, mkdtemp, rm, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import net from 'node:net';
import { fixtureControl } from './fixture_control.mjs';

const playwright = await import(process.env.AIM_PLAYWRIGHT_CORE);
const evidence = process.argv[2], engine = process.argv.includes('--webkit') ? 'webkit' : 'chromium';
await mkdir(evidence, { recursive: true });
const results = [], cleanup = {}, hashes = {};
for (const file of ['web/things-rail.mjs','web/app.mjs','web/topic-navigation.mjs','web/links.mjs','web/index.html','web/image-rail-menu.mjs','web/image-page.mjs'])
  hashes[file] = createHash('sha256').update(await readFile(file)).digest('hex');
hashes.harness = createHash('sha256').update(await readFile(new URL(import.meta.url))).digest('hex');
const child = spawn('/usr/bin/python3', ['tests/fixtures/ui_http.py', '--freshness','--media']);
const { control, exit, errors: fixtureErrors } = fixtureControl(child);
cleanup.fixturePid = child.pid;
let browser, profile, origin, activePage, failure, release;
async function clipboardPicture(page) {
  if (engine === 'chromium') return page.evaluate(async () => {
    const items = await navigator.clipboard.read(), blob = await items[0].getType('image/png'), bitmap = await createImageBitmap(blob);
    const shape = { type: blob.type, width: bitmap.width, height: bitmap.height }; bitmap.close(); return shape;
  });
  await page.evaluate(() => {
    window.pastedImage = null;
    const field = document.createElement('div'); field.contentEditable = 'true'; field.id = 'image-paste-probe'; document.body.append(field); field.focus();
    field.addEventListener('paste', async event => {
      event.preventDefault();
      try {
        const blob = event.clipboardData.files[0] ?? [...event.clipboardData.items].map(item => item.getAsFile()).find(Boolean);
        if (!blob) throw Error('Native paste did not include an image; types=' + [...event.clipboardData.types].join(','));
        const bitmap = await createImageBitmap(blob); window.pastedImage = { type: blob.type, width: bitmap.width, height: bitmap.height }; bitmap.close();
      } catch (error) { window.pastedImage = { error: error.message }; }
    }, { once: true });
  });
  await page.keyboard.press('Meta+V'); await page.waitForFunction(() => window.pastedImage !== null);
  const shape = await page.evaluate(() => window.pastedImage); await page.locator('#image-paste-probe').evaluate(node => node.remove()); return shape;
}
const processRows = () => execFileSync('/bin/ps',['-axo','pid=,ppid=,command='],{encoding:'utf8'}).split('\n').map(line=>{
  const match=line.match(/^\s*(\d+)\s+(\d+)\s+(.+)$/);return match?{pid:Number(match[1]),parent:Number(match[2]),command:match[3]}:null;
}).filter(Boolean);
try {
  const facts = await control({ method: 'ready' }); origin = facts.origin;
  if(engine==='webkit'){
    profile=await mkdtemp(join(tmpdir(),'auditor-998-webkit-'));
    const context=await playwright.webkit.launchPersistentContext(profile,{headless:true,...(process.env.AIM_WEBKIT?{executablePath:process.env.AIM_WEBKIT}:{})});browser=context.browser();assert.ok(browser);
    const rows=processRows(),owned=new Set(rows.filter(row=>row.command.includes(profile)).map(row=>row.pid));assert.ok(owned.size,'WebKit owns its explicit profile process');
    for(let changed=true;changed;){changed=false;for(const row of rows)if(owned.has(row.parent)&&!owned.has(row.pid)){owned.add(row.pid);changed=true;}}
    cleanup.observedBrowserPids=[...owned];
  }else browser=await playwright.chromium.launch({executablePath:process.env.AIM_CHROME,headless:true,args:['--enable-automation']});
  if (engine === 'chromium') {
    const cdp = await browser.newBrowserCDPSession();
    profile = (await cdp.send('Browser.getBrowserCommandLine')).arguments.find(x => x.startsWith('--user-data-dir='))?.slice(16);
    cleanup.observedBrowserPids = (await cdp.send('SystemInfo.getProcessInfo')).processInfo.map(x => x.id);
    assert.ok(profile);
  }


  const baseline=process.argv.includes('--baseline');
  for(const width of (process.argv.includes('--phone')?[390]:process.argv.includes('--quick')?[1280]:[1280,390])) for(const look of ['bookends','paper']) for(const theme of (process.argv.includes('--quick')||process.argv.includes('--phone')?['dark']:['dark','light'])) {
    const result={width,look,theme};results.push(result);
    const context=await browser.newContext({viewport:{width,height:950},colorScheme:theme,hasTouch:width<760,isMobile:width<760});
    if(engine==='chromium')await context.grantPermissions(['clipboard-read','clipboard-write'],{origin});
    await context.addInitScript(look=>localStorage.setItem('theseus-look',look==='paper'?'paper':''),look);
    const page=await context.newPage();activePage=page;page.setDefaultTimeout(10000);const errors=[];page.on('pageerror',error=>errors.push(error.message));
    await page.goto(origin+'/?topic=t1');await page.locator('body[data-ready=true]').waitFor();
    if(width<760)await page.locator('#things-open').click();
    const thumb=page.locator('#things .things-thumbs .image-thumb').first();await thumb.waitFor();
    await thumb.click({button:'right'});
    const menu=page.getByRole('menu',{name:'Image'});
    if(baseline){await page.waitForTimeout(150);assert.equal(await menu.count(),0,'280 has no image context menu');result.missingMenu=true;}
    else {
      await menu.waitFor();
      assert.deepEqual(await menu.getByRole('menuitem').evaluateAll(nodes=>nodes.map(n=>n.querySelector('.menu-description')?.firstChild.textContent??n.childNodes[0].textContent)),['Copy link','Copy image','Download','Archive its message']);
      await page.screenshot({path:`${evidence}/${width}-${look}-${theme}-menu.png`});
      const box=await menu.boundingBox();assert.ok(box.x>=0&&box.x+box.width<=width+1,'menu fits viewport');
      await page.keyboard.press('Escape');await menu.waitFor({state:'hidden'});
      assert.equal(await thumb.evaluate(n=>document.activeElement===n),true,'Escape restores thumbnail focus');
      await page.keyboard.press('Shift+F10');await menu.waitFor();result.keyboard=true;
      await menu.getByRole('menuitem',{name:'Copy link',exact:true}).click();
      await page.getByText('Image link copied.',{exact:true}).waitFor();
      let copied;
      if(engine==='chromium')copied=await page.evaluate(()=>navigator.clipboard.readText());
      else {
        // A native paste reads only the fixture address just copied.
        await page.evaluate(()=>{const f=document.createElement('textarea');f.id='clipboard-probe';document.body.append(f);f.focus();});
        await page.keyboard.press('Meta+V');await page.waitForFunction(()=>document.querySelector('#clipboard-probe').value.length>0);
        copied=await page.locator('#clipboard-probe').inputValue();await page.locator('#clipboard-probe').evaluate(n=>n.remove());
      }
      const route=new URL(copied);assert.equal(route.searchParams.get('image'),'fixture-media-0');assert.equal(route.searchParams.get('message'),facts.sources[0].id);result.link=copied;
      const imagePage=await context.newPage();await imagePage.goto(copied);await imagePage.locator('#image-page img').waitFor();
      assert.equal(await imagePage.locator('#image-page img').getAttribute('alt'),'passive.png');
      await imagePage.reload();await imagePage.locator('#image-page img').waitFor();result.linkReload=true;
      await imagePage.goto(origin+'/?image=fixture-media-0&message=m-missing');await imagePage.getByText(/Image unavailable/).waitFor();assert.equal(await imagePage.locator('#image-page img').count(),0);await imagePage.close();
      await thumb.click({button:'right'});await menu.waitFor();
      const downloadEvent=page.waitForEvent('download');await menu.getByRole('menuitem',{name:'Download',exact:true}).click();
      const download=await downloadEvent;assert.equal(download.suggestedFilename(),'passive.png');
      assert.deepEqual(await readFile(await download.path()),await readFile('tests/fixtures/media/screen.png'));result.downloadExact=true;
      await thumb.click({button:'right'});await menu.waitFor();await menu.getByRole('menuitem',{name:'Copy image',exact:true}).click();
      await page.getByText('Image copied.',{exact:true}).waitFor();
      const picture=await clipboardPicture(page);assert.deepEqual(picture,{type:'image/png',width:48,height:32});result.clipboard=picture;
      if(width<760&&engine==='chromium'){
        await thumb.scrollIntoViewIfNeeded();
        await page.evaluate(()=>{window.touchTrace=[];for(const type of ['pointerdown','pointerup','pointercancel','contextmenu','scroll','click'])document.addEventListener(type,e=>window.touchTrace.push({type,target:e.target.className,pointer:e.pointerType,x:e.clientX,y:e.clientY,selection:document.getSelection()?.toString(),t:performance.now()}),true);});
        const cdp=await context.newCDPSession(page),box=await thumb.boundingBox(),point={x:box.x+box.width/2,y:box.y+box.height/2};result.touchPoint=point;result.viewport=await page.evaluate(()=>({width:innerWidth,height:innerHeight,scale:visualViewport.scale,offset:visualViewport.offsetTop}));
        await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[point]});await page.waitForTimeout(650);await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await menu.waitFor();result.nativeHold=true;
      }else{await thumb.click({button:'right'});await menu.waitFor();}
      const committed=page.waitForResponse(r=>{try{return r.request().postDataJSON()?.kind==='stack.aside';}catch{return false;}});
      await menu.getByRole('menuitem',{name:/^Archive its message/}).click();const receipt=await(await committed).json();assert.equal(receipt.status,'committed');
      const archived=await control({method:'agent_view',actor:facts.actor,name:'stack_positions',args:{topic_id:'t1',message_ids:[facts.sources[0].id]}});
      assert.equal(archived.items[0].stack_position.below,true);assert.ok(archived.items[0].stack_position.through>0);result.archived=archived.items[0].stack_position;
      await thumb.click({button:'right'});await menu.waitFor();await menu.getByRole('menuitem',{name:/^Bring back its message/}).waitFor();await page.keyboard.press('Escape');result.bringBackOffered=true;
      const undone=page.waitForResponse(r=>{try{return r.request().postDataJSON()?.kind==='stack.aside';}catch{return false;}});
      await page.locator('.image-menu-notice').getByRole('button',{name:'Undo'}).click();assert.equal((await(await undone).json()).status,'committed');
      const restored=await control({method:'agent_view',actor:facts.actor,name:'stack_positions',args:{topic_id:'t1',message_ids:[facts.sources[0].id]}});assert.equal(restored.items[0].stack_position.through,null);result.undo=true;
      const popupEvent=context.waitForEvent('page');await thumb.click();const popup=await popupEvent;await popup.waitForLoadState();assert.match(popup.url(),/^blob:/);await popup.close();result.plainOpen=true;
      await thumb.click({button:'right'});await menu.waitFor();await page.keyboard.press('Escape');const entered=context.waitForEvent('page');await page.keyboard.press('Enter');const opened=await entered;await opened.waitForLoadState();assert.match(opened.url(),/^blob:/);await opened.close();result.returnOpen=true;
    }
    await page.screenshot({path:`${evidence}/${width}-${look}-${theme}.png`});assert.deepEqual(errors,[]);result.pageErrors=errors;result.passed=true;
    await context.close();activePage=null;
  }
  if (!baseline && !process.argv.includes('--phone')) for (const format of ['jpg','gif','webp']) {
    const result={format};results.push(result);
    const operation='image-998-'+format;
    const sent=await control({method:'agent_message',operation_id:operation,source:'topic',divergence_reason:'A separate isolated image-format test case.',body:'Image format '+format,attachments:[{name:'one.'+format,image:'one.'+format}]});assert.equal(sent.status,'committed');
    const context=await browser.newContext({viewport:{width:1280,height:950}});
    if(engine==='chromium')await context.grantPermissions(['clipboard-read','clipboard-write'],{origin});
    const page=await context.newPage();activePage=page;page.setDefaultTimeout(10000);
    await page.goto(origin+'/?topic=t1');await page.locator('body[data-ready=true]').waitFor();
    const thumb=page.locator(`[data-rail-image="${operation}-media-0"] .image-thumb`);await thumb.waitFor();
    await thumb.click({button:'right'});const menu=page.getByRole('menu',{name:'Image'});await menu.waitFor();
    await menu.getByRole('menuitem',{name:'Copy image',exact:true}).click();await page.getByText('Image copied.',{exact:true}).waitFor();
    result.clipboard=await clipboardPicture(page);assert.deepEqual(result.clipboard,{type:'image/png',width:1,height:1});
    await thumb.click({button:'right'});await menu.waitFor();const downloading=page.waitForEvent('download');await menu.getByRole('menuitem',{name:'Download',exact:true}).click();
    const downloaded=await downloading;assert.equal(downloaded.suggestedFilename(),'one.'+format);assert.deepEqual(await readFile(await downloaded.path()),await readFile('tests/fixtures/media/one.'+format));result.downloadExact=true;result.passed=true;
    await context.close();activePage=null;
  }

} catch (error) {
  failure = error; if (results.length) { results.at(-1).passed = false; results.at(-1).error = error.stack; }
  if (activePage && !activePage.isClosed()) {
    await activePage.screenshot({ path: `${evidence}/failure.png`, fullPage: true });
    await writeFile(`${evidence}/failure.html`, await activePage.content());
    await writeFile(`${evidence}/touch-trace.json`,JSON.stringify(await activePage.evaluate(()=>window.touchTrace??[]),null,2));
  }
} finally {
  release?.();
  try { if (browser) { await browser.close(); cleanup.browserClosed = !browser.isConnected(); } }
  catch (error) { cleanup.browserError = error.message; failure ??= error; }
  child.stdin.end(); cleanup.fixtureExit = await exit; cleanup.fixtureErrors = fixtureErrors();
  const processes = execFileSync('/bin/ps', ['-axo', 'pid=,command='], { encoding: 'utf8' }).split('\n');
  cleanup.profile = profile;
  cleanup.profileProcesses = profile ? processes.filter(line => line.includes(profile)) : [];
  cleanup.remainingObservedPids = (cleanup.observedBrowserPids ?? []).filter(pid => processes.some(line => Number(line.trim().split(/\s/)[0]) === pid));
  cleanup.fixtureAbsent = !processes.some(line => Number(line.trim().split(/\s/)[0]) === child.pid);
  if(engine==='webkit'&&cleanup.browserClosed&&cleanup.profileProcesses.length===0&&cleanup.remainingObservedPids.length===0)await rm(profile,{recursive:true,force:true});
  cleanup.profileAbsent=profile?await access(profile).then(()=>false,()=>true):false;
  if (origin) cleanup.portClosed = await new Promise(resolve => {
    const url = new URL(origin), socket = net.createConnection({ host: url.hostname, port: Number(url.port) });
    socket.once('connect', () => { socket.destroy(); resolve(false); }); socket.once('error', () => resolve(true));
  });
  await writeFile(`${evidence}/results.json`, JSON.stringify({ engine, results, hashes, cleanup, failure: failure?.stack ?? null }, null, 2));
}
assert.deepEqual(cleanup.fixtureExit, { code: 0, signal: null }); assert.equal(cleanup.fixtureErrors, '');
assert.equal(cleanup.browserClosed, true); assert.deepEqual(cleanup.profileProcesses, []); assert.deepEqual(cleanup.remainingObservedPids, []);
assert.equal(cleanup.fixtureAbsent, true); assert.equal(cleanup.portClosed, true);
assert.equal(cleanup.profileAbsent,true);
if (failure) throw failure;

// Native Notebook right-click entry; existing menus and actions remain the owners.
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, writeFile, readFile, rm, access } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import net from 'node:net';
import { fixtureControl } from './fixture_control.mjs';
const engines = await import(process.env.AIM_PLAYWRIGHT_CORE), engine = process.env.AIM_BROWSER ?? 'chromium';
const evidence = process.argv[2]; await mkdir(evidence, { recursive: true });
const filter = new RegExp(process.argv[3] ?? '');
const sourceFiles = ['web/notebook-page.mjs', 'web/deck-page.mjs', 'web/message-menu.mjs', 'tests/notebook_context_menu_961_native.mjs'];
const hashes = Object.fromEntries(await Promise.all(sourceFiles.map(async path => [path, createHash('sha256').update(await readFile(path)).digest('hex')])));
await writeFile(`${evidence}/source.json`, JSON.stringify({ base: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(), hashes }, null, 2));
const child = spawn('/usr/bin/python3', ['-B', 'tests/fixtures/ui_http.py', '--freshness']);
const { control, exit, errors } = fixtureControl(child);
const results = [], cleanup = {}; let browser, origin, profile, activePage, failure;
const owned = new Set();
const processes = () => execFileSync('/bin/ps', ['-axo', 'pid=,ppid=,command='], { encoding: 'utf8' }).trim().split('\n').map(line => {
  const [, pid, ppid, command] = line.match(/^\s*(\d+)\s+(\d+)\s+(.*)$/); return { pid: +pid, ppid: +ppid, command };
});
function retainChildren() {
  const list = processes(); for (let changed = true; changed;) { changed = false;
    for (const p of list) if ((owned.has(p.ppid) || profile && p.command.includes(profile)) && !owned.has(p.pid)) { owned.add(p.pid); changed = true; }
  }
}
const snapshot = menu => menu.locator('button').evaluateAll(nodes => nodes.map(n => ({label:n.textContent, disabled:n.disabled, checked:n.getAttribute('aria-checked')})));
const point = async (node, x = 30, y = 16) => { await node.scrollIntoViewIfNeeded(); const r = await node.boundingBox(); assert.ok(r); return {x:r.x+x,y:r.y+y}; };
const secondary = async (page, node) => { const at=await point(node); await page.mouse.click(at.x,at.y,{button:'right'}); return at; };
try {
  const facts = await control({ method: 'ready' }); origin = facts.origin;
  profile = await mkdtemp(`${evidence}/${engine}-profile-`);
  const persistent = await engines[engine].launchPersistentContext(profile, { headless: true,
    ...(engine === 'chromium' ? { executablePath: process.env.AIM_CHROME } : {}) });
  browser = persistent.browser(); retainChildren(); assert.ok(owned.size);
  for(const surface of ['fullpage','modal','docked']) {
    if(!filter.test(surface))continue;
    const id='page961-'+surface,op=id+'-create';
    const body=`## First\n\nWords **kept** here.\n\n![Picture](attachment:${op}-media-0)\n\n## Second\n\nOther words remain.\n`;
    assert.equal((await control({method:'outcome_reference',operation_id:op,item_id:id,title:'Menu page',body,attachments:[{name:'Picture.png',png:[100,30]}]})).status,'committed');
    if(surface!=='fullpage')await control({method:'agent_message',operation_id:id+'-link',sender:'person',whole_topic:true,body:`[Open ${id}](?workspace=w1&page=${id})`});
    const context=await browser.newContext({viewport:{width:1400,height:1100}});
    await context.addInitScript(docked=>sessionStorage.setItem('notebook-docked',JSON.stringify(docked)),surface==='docked');
    const page=await context.newPage();activePage=page;page.setDefaultTimeout(6000);
    const pageErrors=[];page.on('pageerror',error=>pageErrors.push(error.message));
    await page.goto(origin+(surface==='fullpage'?'/?cards='+id+'&view=cards':'/?topic=t1'));
    await page.locator('body[data-ready=true]').waitFor();
    if(surface!=='fullpage')await page.getByRole('link',{name:'Open '+id,exact:true}).click();
    const host=page.locator(surface==='fullpage'?'#deck-page':'.notebook-sheet-page');
    if(surface!=='fullpage') {
      await host.waitFor();await page.waitForFunction(()=>document.querySelector('.notebook-sheet-page .notebook-text')?.value.includes('Words'));
      const pageMore=page.locator('.notebook-sheet .notebook-menu');await pageMore.click();
      await page.getByRole('menuitemcheckbox',{name:'Show as cards',exact:true}).click();
      assert.equal(await page.locator('body').evaluate(n=>n.classList.contains('notebook-docked')),surface==='docked');
    }
    await host.locator('.deck-card').nth(1).waitFor();
    await page.evaluate(()=>{window.contextEvents961=[];document.addEventListener('contextmenu',e=>window.contextEvents961.push({target:e.target.tagName,prevented:e.defaultPrevented,pointerType:e.pointerType,selected:String(getSelection()),x:e.clientX,y:e.clientY}));});
    const row=host.locator('.deck-card').nth(1),more=row.locator('.deck-menu'),menu=page.getByRole('menu',{name:'This card',exact:true});
    // Entering and leaving the actual editor also exposes its existing ⋯.
    await row.click({position:{x:30,y:16}});await more.click();await menu.waitFor();
    const ordinary=await snapshot(menu);await page.keyboard.press('Escape');
    const at=await secondary(page,row);await menu.waitFor();
    assert.deepEqual(await snapshot(menu),ordinary,'right-click shares card descriptors');
    const rect=await menu.boundingBox();assert.ok(Math.abs(rect.x-at.x)<=1 && Math.abs(rect.y-at.y)<=1,'menu opens at pointer');
    assert.equal((await page.evaluate(()=>window.contextEvents961.at(-1))).prevented,true);
    if(surface==='modal')assert.equal(await menu.evaluate(n=>n.parentElement.matches('dialog[open]')),true);
    await page.screenshot({path:`${evidence}/${surface}-card-menu.png`});
    await page.keyboard.press('Escape');assert.equal(await more.evaluate(n=>n===document.activeElement),true);
    const beforeControl=await page.evaluate(()=>window.contextEvents961.length);
    await row.click({position:{x:30,y:16},modifiers:['Control']});await menu.waitFor();
    assert.equal(await page.evaluate(()=>window.contextEvents961.length),beforeControl+1,'native macOS Control-click fires contextmenu');
    assert.deepEqual(await snapshot(menu),ordinary);assert.equal(await menu.evaluate(n=>n.contains(document.activeElement)),true,'Control-click keeps focus in its menu');await page.keyboard.press('Escape');
    // Native drag selection must remain native even when right-clicking within it.
    const words=host.locator('.deck-card').first().locator('.deck-words').first();
    const from=await point(words,2,10);await page.mouse.move(from.x,from.y);await page.mouse.down();await page.mouse.move(from.x+95,from.y,{steps:8});await page.mouse.up();
    const selected=await page.evaluate(()=>String(getSelection()));assert.ok(selected.length>0,'native drag selected card words');
    await page.mouse.click(from.x+20,from.y,{button:'right'});
    assert.equal(await menu.count(),0);const selectionEvent=await page.evaluate(()=>window.contextEvents961.at(-1));assert.equal(selectionEvent.prevented,false);assert.equal(selectionEvent.selected,selected);
    // Collapse with a real click on page chrome, then exercise an actual attachment image.
    const title=page.locator(surface==='fullpage'?'#topic-title':'.notebook-sheet-title > span');
    await title.click();assert.equal(await page.evaluate(()=>getSelection().isCollapsed),true);
    const img=host.locator('.deck-card img').first();await secondary(page,img);assert.equal(await menu.count(),0);
    const imageEvent=await page.evaluate(()=>window.contextEvents961.at(-1));assert.equal(imageEvent.target,'IMG');assert.equal(imageEvent.prevented,false);
    // Page title follows the page owner, including the title reparented into a sheet.
    const pageMore=page.locator(surface==='fullpage'?'#deck-page .notebook-menu':'.notebook-sheet .notebook-menu');
    const pageMenu=page.getByRole('menu',{name:'This page',exact:true});
    await pageMore.click();await pageMenu.waitFor();const pageItems=await snapshot(pageMenu);await page.keyboard.press('Escape');
    await secondary(page,title);await pageMenu.waitFor();assert.deepEqual(await snapshot(pageMenu),pageItems);
    await page.keyboard.press('Escape');assert.equal(await pageMore.evaluate(n=>n===document.activeElement),true);
    // Editable fields keep browser spelling/clipboard menus even without a selection.
    await host.locator('.deck-card').first().click({position:{x:30,y:16}});
    const field=host.locator('.deck-writing textarea');await field.waitFor();await secondary(page,field);
    const editingEvent=await page.evaluate(()=>window.contextEvents961.at(-1));assert.equal(editingEvent.prevented,false);assert.equal(await menu.count(),0);
    // Pick first with its ⋯, then remove second via right-click. Core must keep first.
    const firstMore=host.locator('.deck-card').first().locator('.deck-menu');await firstMore.click();await menu.waitFor();await page.keyboard.press('Escape');
    await secondary(page,host.locator('.deck-card').nth(1));await menu.waitFor();
    const saved=page.waitForResponse(r=>{try{return r.request().postDataJSON()?.kind==='memory.revise';}catch{return false;}});
    await menu.getByRole('menuitem',{name:'Delete',exact:true}).click();
    const receipt=await (await saved).json();assert.equal(receipt.status,'committed');
    const source=await control({method:'agent_view',actor:facts.actor,name:'memory_current',args:{item_id:id}});
    assert.match(source.body,/## First/);assert.doesNotMatch(source.body,/## Second/);assert.match(source.body,/Words \*\*kept\*\* here/);
    assert.deepEqual(pageErrors,[]);results.push({surface,at,rect,ordinary,pageItems,controlClick:true,selectionEvent,imageEvent,editingEvent,receipt,body:source.body});
    retainChildren();await context.close();
  }
  if(filter.test('phone')) {
    const id='page961-phone';assert.equal((await control({method:'outcome_reference',operation_id:id+'-create',item_id:id,title:'Phone menu',body:'## Phone card\n\nWords remain selectable.\n'})).status,'committed');
    const context=await browser.newContext({viewport:{width:390,height:844},hasTouch:true,isMobile:true});
    const page=await context.newPage();activePage=page;page.setDefaultTimeout(6000);
    await page.goto(origin+'/?cards='+id+'&view=cards');await page.locator('body[data-ready=true]').waitFor();
    const row=page.locator('#deck-page .deck-card').first();await row.waitFor();
    await page.evaluate(()=>{window.contextEvents961=[];for(const type of ['contextmenu','pointerdown','pointerup','touchstart','touchend'])document.addEventListener(type,e=>window.contextEvents961.push({type,prevented:e.defaultPrevented,pointerType:e.pointerType,trusted:e.isTrusted}));});
    let longPress='WebKit automation exposes tap only; touch MouseEvent fallback covered by owner check';
    if(engine==='chromium') {
      const at=await point(row,25,20),cdp=await context.newCDPSession(page);
      await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{...at,id:1}]});
      await new Promise(resolve=>setTimeout(resolve,900));
      await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
      const events=await page.evaluate(()=>window.contextEvents961);assert.ok(events.some(e=>e.type==='pointerdown'&&e.trusted&&e.pointerType==='touch'));
      assert.ok(events.some(e=>e.type==='touchend'&&e.trusted));assert.ok(events.filter(e=>e.type==='contextmenu').every(e=>!e.prevented));
      assert.equal(await page.getByRole('menu').count(),0);longPress={events,nativeContextMenuEmitted:events.some(e=>e.type==='contextmenu')};await cdp.detach();
    }
    // Ordinary touch ⋯ still invokes the existing phone sheet.
    await row.tap({position:{x:25,y:20}});const more=row.locator('.deck-menu');await more.tap();
    const menu=page.getByRole('menu',{name:'This card',exact:true});await menu.waitFor();
    assert.equal(await menu.evaluate(n=>n.classList.contains('menu-sheet')),true);
    assert.ok((await snapshot(menu)).some(n=>n.label.startsWith('Delete')));
    await page.screenshot({path:`${evidence}/phone-menu.png`});
    results.push({surface:'phone',longPress,tapOverflow:true});retainChildren();await context.close();
  }
} catch (error) {
  failure = error;
  if (activePage && !activePage.isClosed()) {
    await activePage.screenshot({ path: `${evidence}/failure.png`, fullPage: true });
    await writeFile(`${evidence}/failure.html`, await activePage.content());
    await writeFile(`${evidence}/events.json`, JSON.stringify(await activePage.evaluate(() => window.contextEvents961??[]), null, 2));
  }
} finally {
  if (browser) { retainChildren(); await browser.close(); cleanup.disconnected = !browser.isConnected(); }
  cleanup.browserStarted=Boolean(browser);cleanup.disconnected=browser?!browser.isConnected():true;
  child.stdin.end(); cleanup.fixtureExit = await exit; cleanup.fixtureErrors = errors();
  const ps = processes();
  cleanup.fixturePid = child.pid; cleanup.fixtureAbsent = !ps.some(p => p.pid === child.pid);
  cleanup.ownedPids = [...owned]; cleanup.remainingOwned = ps.filter(p => owned.has(p.pid));
  cleanup.profile = profile; cleanup.profileProcesses = profile ? ps.filter(p => p.command.includes(profile)) : [];
  if (profile && cleanup.disconnected && !cleanup.remainingOwned.length && !cleanup.profileProcesses.length) await rm(profile, { recursive: true });
  cleanup.profileAbsent = profile ? await access(profile).then(() => false, () => true) : null;
  if (origin) cleanup.portClosed = await new Promise(resolve => { const url = new URL(origin), socket = net.createConnection({ host: url.hostname, port: Number(url.port) });
    socket.once('connect', () => { socket.destroy(); resolve(false); }); socket.once('error', () => resolve(true)); });
  await writeFile(`${evidence}/results.json`, JSON.stringify({ engine, results, cleanup, failure: failure?.stack ?? null }, null, 2));
}
assert.equal(cleanup.disconnected, true); assert.equal(cleanup.fixtureExit.code, 0); assert.equal(cleanup.fixtureErrors, '');
assert.equal(cleanup.fixtureAbsent, true); assert.equal(cleanup.portClosed, true);
assert.deepEqual(cleanup.remainingOwned, []); assert.deepEqual(cleanup.profileProcesses, []); assert.equal(cleanup.profileAbsent, true);
if (failure) throw failure;
console.log(JSON.stringify({ passed: results.length, cleanup }));

// Native 967 pane handoff through actual browser keys and isolated Core.
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, writeFile, readFile, rm, access } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import net from 'node:net';
import { fixtureControl } from './fixture_control.mjs';
const engines = await import(process.env.AIM_PLAYWRIGHT_CORE), engine = process.env.AIM_BROWSER ?? 'chromium';
const evidence = process.argv[2]; await mkdir(evidence, { recursive: true });
const filter = new RegExp(process.argv[3] ?? '');
const sourceFiles = ['web/panes.mjs', 'web/notebook-sheet.mjs', 'web/deck-page.mjs', 'web/rails.mjs', 'web/notebook-page.mjs', 'tests/notebook_arrows_967_native.mjs'];
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
try {
  const facts = await control({ method: 'ready' }); origin = facts.origin;
  profile = await mkdtemp(`${evidence}/${engine}-profile-`);
  const persistent = await engines[engine].launchPersistentContext(profile, { headless: true,
    ...(engine === 'chromium' ? { executablePath: process.env.AIM_CHROME } : {}) });
  browser = persistent.browser(); assert.equal(browser.browserType().name(),engine); retainChildren(); assert.ok(owned.size);
  for (const width of [1280,1600,1100,390]) for (const look of ['bookends','paper']) {
    const key=`${width}-${look}`;if(!filter.test(key))continue;
    const docked=width>=1280,id='page967-'+key,topic='topic967-'+key;
    await control({method:'navigation_topics',topics:[{id:topic,title:'Arrow dossier'}]});
    const body='## First\n\nFirst card words.\n\n## Second\n\nSecond card words.\n\n## Parent\n\nParent words.\n\n### Child\n\nChild words.\n';
    assert.equal((await control({method:'outcome_reference',operation_id:id+'-create',item_id:id,title:'Arrow page',body})).status,'committed');
    await control({method:'agent_message',operation_id:id+'-link',topic_id:topic,sender:'person',whole_topic:true,body:`[Open ${id}](?workspace=w1&page=${id})`});
    const sent=await control({method:'agent_message',operation_id:id+'-plain',topic_id:topic,sender:'person',whole_topic:true,body:'Feed message kept here.'});
    const reply=await control({method:'agent_message',operation_id:id+'-reply',topic_id:topic,sender:'person',reply_to:sent.result.message_id,body:'Reply kept in the dossier.'});
    const context=await browser.newContext({viewport:{width,height:1000},colorScheme:look==='paper'?'light':'dark'});
    await context.addInitScript(look=>localStorage.setItem('theseus-look',look),look);
    const page=await context.newPage();activePage=page;page.setDefaultTimeout(6000);
    const pageErrors=[];page.on('pageerror',error=>pageErrors.push(error.message));
    await page.goto(origin+'/?topic='+topic);await page.locator('body[data-ready=true]').waitFor();
    await page.getByRole('link',{name:'Open '+id,exact:true}).click();
    const host=page.locator('.notebook-sheet-page'),dialog=page.locator('#notebook-sheet-dialog');await host.waitFor();
    await page.waitForFunction(()=>document.querySelector('.notebook-sheet-page .notebook-text')?.value.includes('First card'));
    const changeView=async name=>{await page.locator('.notebook-sheet .notebook-menu').click();await page.getByRole('menuitemcheckbox',{name:'Show as '+name,exact:true}).click();};
    await changeView('cards');
    assert.equal(await page.locator('body').evaluate(n=>n.classList.contains('notebook-docked')),docked);
    const feed=page.locator(`.message-card[data-id="${reply.result.message_id}"]`);
    const active=()=>page.evaluate(()=>({tag:document.activeElement.tagName,classes:document.activeElement.className,index:document.activeElement.dataset.index,inNotebook:!!document.activeElement.closest('.notebook-sheet')}));
    const index=async n=>assert.equal((await active()).index,String(n));
    const inSheet=async()=>assert.equal((await active()).inNotebook,true);
    if(docked) {
      // Focus setup identifies the source. Every asserted move is an actual key.
      await feed.focus();await page.keyboard.press('ArrowRight');
      assert.equal((await active()).inNotebook,true,'Right from the feed enters the docked Notebook');await index(0);
      assert.equal(await host.locator('.deck-writing').count(),0,'display navigation does not edit');
      await page.keyboard.press('ArrowDown');await index(1);
      await page.keyboard.press('ArrowLeft');assert.equal(await feed.evaluate(n=>n===document.activeElement),true,'outward Left returns to retained feed');
      await page.keyboard.press('ArrowRight');await index(1);
      await page.keyboard.press('ArrowUp');await index(0);await page.keyboard.press('ArrowDown');await index(1);
      // Tree actions still precede an outward handoff: child -> parent -> fold -> feed.
      await page.keyboard.press('ArrowDown');await index(2);await page.keyboard.press('ArrowDown');await index(3);
      await page.keyboard.press('ArrowLeft');await index(2);
      await page.keyboard.press('ArrowLeft');await index(2);assert.equal(await host.locator('.deck-card[data-index="3"]').isVisible(),false);
      await page.keyboard.press('ArrowLeft');assert.equal(await feed.evaluate(n=>n===document.activeElement),true);
      // Up/Down now belong to the feed, and the Notebook keeps its card.
      await page.keyboard.press('ArrowUp');assert.equal((await active()).inNotebook,false);
      await page.keyboard.press('ArrowDown');assert.equal(await feed.evaluate(n=>n===document.activeElement),true);
      await page.keyboard.press('ArrowRight');await index(2);
      await page.keyboard.press('ArrowRight');assert.equal(await host.locator('.deck-card[data-index="3"]').isVisible(),true);
      // Page controls also leave to the feed; vertical controls remain in the Notebook.
      const rename=page.locator('.notebook-sheet-head').getByRole('button',{name:'Rename',exact:true});
      await rename.focus();await page.keyboard.press('ArrowDown');await inSheet();
      await rename.focus();await page.keyboard.press('ArrowLeft');assert.equal(await feed.evaluate(n=>n===document.activeElement),true,'page-control Left leaves Notebook');
      await page.keyboard.press('ArrowRight');await index(2);
    } else {
      await host.locator('.deck-card').first().focus();
      await page.keyboard.press('ArrowLeft');await inSheet();
      await page.keyboard.press('ArrowDown');await index(1);
      assert.equal(await dialog.evaluate(n=>n.matches(':modal')),true,'narrow Notebook remains modal');
    }
    // Interior carets and nonempty selections keep ordinary writing arrows;
    // collapsed editing boundaries are the1058 display commands.
    await host.locator('.deck-card').first().click({position:{x:35,y:18}});
    const field=host.locator('.deck-writing textarea');await field.waitFor();
    await page.keyboard.press('Meta+Home');await page.keyboard.press('ArrowRight');
    assert.equal(await field.evaluate(n=>n===document.activeElement),true);
    for(const k of ['ArrowDown','ArrowUp','ArrowLeft','ArrowRight']){await page.keyboard.press('Meta+a');await page.keyboard.press('ArrowRight');await page.keyboard.press('ArrowLeft');await page.keyboard.press(k);assert.equal(await field.evaluate(n=>n===document.activeElement),true,'interior writing retains '+k);}
    const writing=await field.inputValue();
    if(docked) {
      const caret=await field.evaluate(n=>[n.selectionStart,n.selectionEnd]);
      await feed.focus();await page.keyboard.press('ArrowRight');
      assert.equal(await field.evaluate(n=>n===document.activeElement),true,'entering resumes an unfinished card');
      assert.deepEqual(await field.evaluate(n=>[n.selectionStart,n.selectionEnd]),caret);assert.equal(await field.inputValue(),writing);
    }
    for(const k of ['ArrowLeft','ArrowRight']){await page.keyboard.press('Meta+a');await page.keyboard.press(k);assert.equal(await field.evaluate(n=>n===document.activeElement),true,'a nonempty selection retains '+k);}
    assert.equal(await field.inputValue(),writing);await page.keyboard.press('Escape');await inSheet();
    await page.screenshot({path:`${evidence}/${key}-cards.png`});
    if(docked) {
      // Text view is an editor; entering resumes it and arrows do not leave it.
      await changeView('text');const text=host.locator('.notebook-text');
      await feed.focus();await page.keyboard.press('ArrowRight');assert.equal(await text.evaluate(n=>n===document.activeElement),true);
      const before=await text.inputValue();for(const k of ['ArrowLeft','ArrowRight','ArrowUp','ArrowDown']){await page.keyboard.press(k);assert.equal(await text.evaluate(n=>n===document.activeElement),true);}
      assert.equal(await text.inputValue(),before);
      // Width changes make the same page modal; outward keys cannot reach the feed.
      await changeView('cards');await page.setViewportSize({width:1100,height:1000});
      await page.waitForFunction(()=>document.querySelector('#notebook-sheet-dialog').matches(':modal'));
      await host.locator('.deck-card').first().focus();await page.keyboard.press('ArrowLeft');await inSheet();
      await page.setViewportSize({width,height:1000});await page.waitForFunction(()=>document.body.classList.contains('notebook-docked'));
    }
    await page.getByRole('button',{name:'Close, keeping your writing',exact:true}).click();
    assert.equal(await dialog.evaluate(n=>n.open),false);
    // The closed sheet is passed over; existing outline/right-rail routes remain.
    await feed.focus();await page.keyboard.press('ArrowRight');assert.equal((await active()).inNotebook,false);
    assert.equal(await page.evaluate(()=>!!document.activeElement.closest('#things')),width>=1280);
    await feed.focus();await page.keyboard.press('ArrowLeft');assert.equal((await active()).inNotebook,false);
    assert.equal(await feed.evaluate(n=>n===document.activeElement),true,'first Left preserves the existing dossier fold');
    await page.keyboard.press('ArrowLeft');
    assert.equal(await page.evaluate(()=>!!document.activeElement.closest('#outline')),width>760);
    assert.deepEqual(pageErrors,[]);results.push({width,look,docked,pass:true});
    retainChildren();await context.close();
  }

} catch (error) {
  failure = error;
  if (activePage && !activePage.isClosed()) {
    await activePage.screenshot({ path: `${evidence}/failure.png`, fullPage: true });
    await writeFile(`${evidence}/failure.html`, await activePage.content());
    await writeFile(`${evidence}/events.json`, JSON.stringify(await activePage.evaluate(() => window.events967??[]), null, 2));
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
  await writeFile(`${evidence}/results.json`, JSON.stringify({ engine, browserType: browser?.browserType().name() ?? null, results, cleanup, failure: failure?.stack ?? null }, null, 2));
}
assert.equal(cleanup.disconnected, true); assert.equal(cleanup.fixtureExit.code, 0); assert.equal(cleanup.fixtureErrors, '');
assert.equal(cleanup.fixtureAbsent, true); assert.equal(cleanup.portClosed, true);
assert.deepEqual(cleanup.remainingOwned, []); assert.deepEqual(cleanup.profileProcesses, []); assert.equal(cleanup.profileAbsent, true);
if (failure) throw failure;
console.log(JSON.stringify({ passed: results.length, cleanup }));

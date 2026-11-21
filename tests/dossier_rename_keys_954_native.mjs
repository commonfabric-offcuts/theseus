// Real dossier headers, native reading keys and preserved pointer/menu actions (954).
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
for (const file of ['web/reply-stacks.mjs','web/arrow-reach.mjs','web/stack-feed.mjs','web/message-menu.mjs'])
  hashes[file] = createHash('sha256').update(await readFile(file)).digest('hex');
hashes.harness = createHash('sha256').update(await readFile(new URL(import.meta.url))).digest('hex');
const child = spawn('/usr/bin/python3', ['tests/fixtures/ui_http.py', '--freshness']);
const { control, exit, errors: fixtureErrors } = fixtureControl(child);
cleanup.fixturePid = child.pid;
let browser, profile, origin, activePage, failure, release, observedEngine, observedVersion;
const processRows = () => execFileSync('/bin/ps',['-axo','pid=,ppid=,command='],{encoding:'utf8'}).split('\n').map(line=>{
  const match=line.match(/^\s*(\d+)\s+(\d+)\s+(.+)$/);return match?{pid:Number(match[1]),parent:Number(match[2]),command:match[3]}:null;
}).filter(Boolean);
try {
  const facts = await control({ method: 'ready' }); origin = facts.origin;
  if(engine==='webkit'){
    profile=await mkdtemp(join(tmpdir(),'page-lane6-954-webkit-'));
    const context=await playwright.webkit.launchPersistentContext(profile,{headless:true});browser=context.browser();assert.ok(browser);
    const rows=processRows(),owned=new Set(rows.filter(row=>row.command.includes(profile)).map(row=>row.pid));assert.ok(owned.size,'WebKit owns its explicit profile process');
    for(let changed=true;changed;){changed=false;for(const row of rows)if(owned.has(row.parent)&&!owned.has(row.pid)){owned.add(row.pid);changed=true;}}
    cleanup.observedBrowserPids=[...owned];
  }else browser=await playwright.chromium.launch({executablePath:process.env.AIM_CHROME,headless:true,args:['--enable-automation']});
  observedEngine=browser.browserType().name();observedVersion=browser.version();assert.equal(observedEngine,engine);
  if (engine === 'chromium') {
    const cdp = await browser.newBrowserCDPSession();
    profile = (await cdp.send('Browser.getBrowserCommandLine')).arguments.find(x => x.startsWith('--user-data-dir='))?.slice(16);
    cleanup.observedBrowserPids = (await cdp.send('SystemInfo.getProcessInfo')).processInfo.map(x => x.id);
    assert.ok(profile);
  }


  const cells=process.argv.includes('--quick')?[[1280,'light','bookends']]:[1280,900,390].flatMap(width=>['light','dark'].flatMap(theme=>['bookends','paper'].map(look=>[width,theme,look])));
  let serial=0;
  for(const [width,colorScheme,look] of cells){
    const key=`${width}-${colorScheme}-${look}`,result={key};results.push(result);
    const tid=`rename954-${engine}-${++serial}`;
    await control({method:'navigation_topics',topics:[{id:tid,title:'Rename keyboard954'}]});
    const say=async(name,reply_to)=>{
      const r=await control({method:'agent_message',sender:'person',topic_id:tid,source:'topic',whole_topic:true,read:true,body:`${name} ${key}`,post_args:{divergence_reason:'Isolated954 keyboard case',...(reply_to?{reply_to}:{})},operation_id:`954-${tid}-${name}`});
      assert.equal(r.status,'committed');return r.result.message_id;
    };
    const single=await say('Single dossier'),multi=await say('Dossier with replies');await say('Reply',multi);
    const context=await browser.newContext({viewport:{width,height:950},colorScheme,hasTouch:width===390});
    await context.addInitScript(look=>localStorage.setItem('theseus-look',look==='paper'?'paper':''),look);
    const page=await context.newPage();activePage=page;page.setDefaultTimeout(9000);const errors=[];page.on('pageerror',e=>errors.push(e.message));
    await page.goto(origin+'/?topic='+tid);await page.locator('body[data-ready=true]').waitFor();
    const section=page.locator(`.reply-stack[data-stack="${single}"]`),title=section.locator('.stack-name').first(),star=section.locator('.stack-star').first();
    await title.waitFor();await title.scrollIntoViewIfNeeded();
    const focused=()=>page.evaluate(()=>({className:document.activeElement.className,tag:document.activeElement.tagName,text:document.activeElement.textContent?.slice(0,90),rename:document.activeElement.matches('.stack-name')}));
    await star.focus();await page.keyboard.press('Shift+Tab');result.reverseTab=await focused();
    // A real scratch control isolates the app's spatial-arrow fallback above
    // the real rendered header. The key goes through the actual window owner.
    await title.scrollIntoViewIfNeeded();
    await title.evaluate(name=>{const b=name.getBoundingClientRect(),probe=document.createElement('button');probe.id='spatial-start954';probe.type='button';probe.textContent='·';probe.setAttribute('aria-label','Fixture spatial navigation start');probe.style.cssText=`position:fixed;left:${b.left}px;top:${b.top-24}px;width:20px;height:12px;min-width:0;min-height:0;padding:0;z-index:20`;document.querySelector('#main').append(probe);});
    await page.locator('#spatial-start954').focus();await page.keyboard.press('ArrowDown');result.arrow=await focused();
    assert.notEqual(await page.evaluate(()=>document.activeElement.id),'spatial-start954','the native spatial key actually moves focus');
    result.renameCandidate=await title.evaluate(async name=>{const {controls}=await import('/arrow-reach.mjs');return controls(document.querySelector('#messages')).includes(name);});
    await page.locator('#spatial-start954').evaluate(n=>n.remove());
    assert.equal(result.reverseTab.rename,false,'native reverse Tab skips the rename handle');
    assert.equal(result.arrow.rename,false,'native spatial arrow skips the rename handle');
    assert.equal(result.renameCandidate,false,'actual arrow owner excludes the rename handle');
    assert.equal(await title.evaluate(n=>n.tabIndex),-1);assert.equal(await star.evaluate(n=>n.tabIndex),0);
    await star.focus();const starResponse=page.waitForResponse(r=>{try{return r.request().postDataJSON()?.kind==='message.star';}catch{return false;}});
    await page.keyboard.press('Space');const starReceipt=await(await starResponse).json();assert.equal(starReceipt.status,'committed');
    await page.waitForFunction(id=>document.querySelector(`.reply-stack[data-stack="${id}"] .stack-star`)?.getAttribute('aria-pressed')==='true',single);
    assert.equal(await star.evaluate(n=>n===document.activeElement),true);assert.equal(await title.evaluate(n=>n.tabIndex),-1,'actual repaint keeps the skipped stop');
    const stored=await control({method:'agent_view',actor:facts.actor,name:'topic_messages',args:{topic_id:tid,message_ids:[single]}});assert.equal(stored.items[0].acts.starred,true);result.starKeyboard=true;
    const chevron=page.locator(`.reply-stack[data-stack="${multi}"]>.stack-toggle`);await chevron.waitFor();assert.equal(await chevron.evaluate(n=>n.tabIndex),0);
    await chevron.focus();const before=await chevron.getAttribute('data-state');await page.keyboard.press('Space');await page.waitForFunction(({id,before})=>document.querySelector(`.reply-stack[data-stack="${id}"]>.stack-toggle`)?.dataset.state!==before,{id:multi,before});
    assert.equal(await chevron.evaluate(n=>n===document.activeElement),true);result.chevronKeyboard=true;
    const pen=section.locator('.stack-pen');
    if(width===390){
      // The existing touch layout hides the decorative pencil; the title
      // itself is the native tap route to the same rename owner.
      assert.equal(await pen.evaluate(n=>getComputedStyle(n).display),'none');
      await title.tap();result.pointerRoute='title tap (touch pencil hidden)';
    }else{
      await section.locator('.stack-head').hover();await pen.click();result.pointerRoute='pencil click';
    }
    const input=section.locator('.stack-rename-input');await input.waitFor();await input.fill('Pointer words not saved954');await input.press('Escape');assert.equal(await input.isVisible(),false);result.pointerRename=true;
    const card=page.locator(`.message-card[data-id="${single}"]`);await card.focus();let more=false;
    for(let n=0;n<20;n++){more=await page.evaluate(()=>document.activeElement.matches('.message-bar [data-act=more]'));if(more)break;await page.keyboard.press('Tab');}
    assert.ok(more,'native Tab reaches the dossier menu button');await page.keyboard.press('Enter');await page.locator('.message-menu-list[role=menu]').waitFor();let rename=false;
    for(let n=0;n<35;n++){rename=await page.evaluate(()=>document.activeElement.matches('[role=menuitem]')&&document.activeElement.textContent.trim().startsWith('Rename'));if(rename)break;await page.keyboard.press('ArrowDown');}
    assert.ok(rename,'native menu arrows reach Rename');await page.keyboard.press('Enter');await input.waitFor();
    const name=`Saved menu rename954 ${key}`,renameResponse=page.waitForResponse(r=>{try{return r.request().postDataJSON()?.kind==='stack.name';}catch{return false;}});
    await input.fill(name);await input.press('Enter');const renamed=await(await renameResponse).json();assert.equal(renamed.status,'committed');
    await page.waitForFunction(({id,name})=>document.querySelector(`.reply-stack[data-stack="${id}"] .stack-name`)?.textContent===name,{id:single,name});
    const named=await control({method:'agent_view',actor:facts.actor,name:'topic_messages',args:{topic_id:tid,message_ids:[single]}});assert.equal(named.items[0].stack_position.name.text,name);result.menuRename=true;
    assert.deepEqual(errors,[]);result.errors=errors;result.passed=true;await page.screenshot({path:`${evidence}/${key}.png`,fullPage:true});console.log(JSON.stringify({key,passed:true}));await context.close();
  }
} catch (error) {
  failure = error; if (results.length) { results.at(-1).passed = false; results.at(-1).error = error.stack; }
  if (activePage && !activePage.isClosed()) {
    await activePage.screenshot({ path: `${evidence}/failure.png`, fullPage: true });
    await writeFile(`${evidence}/failure.html`, await activePage.content());
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
  await writeFile(`${evidence}/results.json`, JSON.stringify({ engine:observedEngine,requestedEngine:engine,version:observedVersion,argv:process.argv,results,hashes,cleanup,failure: failure?.stack ?? null }, null, 2));
}
assert.deepEqual(cleanup.fixtureExit, { code: 0, signal: null }); assert.equal(cleanup.fixtureErrors, '');
assert.equal(cleanup.browserClosed, true); assert.deepEqual(cleanup.profileProcesses, []); assert.deepEqual(cleanup.remainingObservedPids, []);
assert.equal(cleanup.fixtureAbsent, true); assert.equal(cleanup.portClosed, true);
assert.equal(cleanup.profileAbsent,true);
if (failure) throw failure;

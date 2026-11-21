// Actual topic-foot pencil grammar, unchanged sheet/phone controls and Core Send.
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
for (const file of ['web/sheet-dense.css','web/aim.css','web/inline-composer.mjs','web/compose-bar.mjs','web/index.html','web/reader-dense.css'])
  hashes[file] = createHash('sha256').update(await readFile(file)).digest('hex');
hashes.harness = createHash('sha256').update(await readFile(new URL(import.meta.url))).digest('hex');
const child = spawn('/usr/bin/python3', ['tests/fixtures/ui_http.py', '--freshness']);
const { control, exit, errors: fixtureErrors } = fixtureControl(child);
cleanup.fixturePid = child.pid;
let browser, profile, origin, activePage, failure, release;
const processRows = () => execFileSync('/bin/ps',['-axo','pid=,ppid=,command='],{encoding:'utf8'}).split('\n').map(line=>{
  const match=line.match(/^\s*(\d+)\s+(\d+)\s+(.+)$/);return match?{pid:Number(match[1]),parent:Number(match[2]),command:match[3]}:null;
}).filter(Boolean);
try {
  const facts = await control({ method: 'ready' }); origin = facts.origin;
  if(engine==='webkit'){
    profile=await mkdtemp(join(tmpdir(),'page-lane6-959-webkit-'));
    const context=await playwright.webkit.launchPersistentContext(profile,{headless:true});browser=context.browser();assert.ok(browser);
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

  const baselineCss=execFileSync('git',['show','3d8756b464971dd16b064591e4d6693564768fd5:web/sheet-dense.css'],{encoding:'utf8'});
  const matrix=[1280,900,390].flatMap(width=>['light','dark'].flatMap(scheme=>['bookends','paper'].map(look=>[width,scheme,look,width===390])));
  matrix.push(...['light','dark'].flatMap(scheme=>['bookends','paper'].map(look=>[1280,scheme,look,true])));
  const cells=process.argv.includes('--quick')?matrix.slice(0,1):matrix;
  for(const [width,colorScheme,look,hasTouch] of cells){
    const key=`${width}-${colorScheme}-${look}-${hasTouch?'coarse':'fine'}`,result={key};results.push(result);
    const context=await browser.newContext({viewport:{width,height:950},colorScheme,hasTouch});
    await context.addInitScript(look=>localStorage.setItem('theseus-look',look==='paper'?'paper':''),look);
    const page=await context.newPage();activePage=page;page.setDefaultTimeout(9000);const errors=[];page.on('pageerror',e=>errors.push(e.message));
    await page.goto(origin+'/?topic=t1');await page.locator('body[data-ready=true]').waitFor();
    const field=page.locator('#inline-writing-body'),composer=page.locator('#inline-composer');
    await field.waitFor();await field.scrollIntoViewIfNeeded();await field.click();
    const words=`Inline959 ${key}`;await page.keyboard.type(words);await field.press('Enter');await page.keyboard.type('Second line');
    const body=words+'\nSecond line';assert.equal(await field.inputValue(),body);
    await page.waitForFunction(()=>document.querySelector('#inline-save-state')?.dataset.save==='saved');
    const snapshot=()=>page.evaluate(()=>{
      const root=document.querySelector('#inline-composer');
      const specs=[['root',root,['gridTemplateAreas','borderRadius','borderWidth','paddingTop','paddingRight','paddingBottom','paddingLeft','backgroundColor']],
        ['head',root.querySelector('.compose-head'),['display']],['field',root.querySelector('textarea'),['borderWidth','borderRadius','paddingTop','paddingBottom','fontSize','lineHeight','backgroundColor']],
        ['who',root.querySelector('.who-chip'),['height','borderRadius','fontSize','paddingLeft','paddingRight']],['save',root.querySelector('.save-status>span'),['maxWidth','fontSize']],
        ['plus',root.querySelector('.plus-button'),['height','width','borderRadius','fontSize']],['send',root.querySelector('.compose-send'),['height','borderRadius','fontSize','marginLeft']]];
      return Object.fromEntries(specs.map(([key,node,names])=>{const s=getComputedStyle(node);return[key,Object.fromEntries(names.map(name=>[name,s[name]]))];}));
    });
    const baseline=async()=>page.evaluate(css=>{const link=document.querySelector('link[href*="sheet-dense.css"]');link.disabled=true;const style=document.createElement('style');style.id='baseline959';style.textContent=css;document.head.append(style);},baselineCss);
    const restore=async()=>page.evaluate(()=>{document.querySelector('#baseline959').remove();document.querySelector('link[href*="sheet-dense.css"]').disabled=false;});
    result.fine=await page.evaluate(()=>matchMedia('(pointer:fine) and (min-width:761px)').matches);
    result.inline=await snapshot();
    if(!result.fine){await baseline();assert.deepEqual(await snapshot(),result.inline,'phone/coarse inline keeps pristine252 styles');await restore();result.phoneCoarseUnchanged=true;}
    await page.screenshot({path:`${evidence}/${key}-inline.png`,fullPage:true});
    await page.locator('#inline-who-chip').click();await page.locator('#inline-who-panel').waitFor();await page.locator('#inline-who-done').click();
    assert.equal(await page.locator('#inline-who-panel').isVisible(),false);assert.equal(await field.inputValue(),body);
    await page.locator('#inline-plus-button').click();await page.locator('#inline-plus-panel').waitFor();await page.locator('#inline-plus-done').click();
    assert.equal(await page.locator('#inline-plus-panel').isVisible(),false);assert.equal(await field.inputValue(),body);
    await page.locator('#new-message').click();await page.locator('#new-message-sheet[open]').waitFor();assert.equal(await field.inputValue(),body);
    result.sheet=await snapshot();
    await baseline();assert.deepEqual(await snapshot(),result.sheet,'open pencil sheet keeps pristine252 styles');await restore();result.sheetUnchanged=true;
    if(result.fine)assert.deepEqual(result.inline,result.sheet,'active topic-foot composer uses the actual sheet grammar');
    await page.locator('#new-message-close').click();await page.locator('#new-message-sheet[open]').waitFor({state:'hidden'});assert.equal(await field.inputValue(),body);
    result.folded=await snapshot();await baseline();assert.deepEqual(await snapshot(),result.folded,'folded reading line keeps pristine252 styles');await restore();result.foldedUnchanged=true;
    await field.click();
    if(result.fine){
      const geometry=await page.evaluate(()=>{const r=n=>{const b=n.getBoundingClientRect();return{top:b.top,bottom:b.bottom,left:b.left,right:b.right};};const root=document.querySelector('#inline-composer');return{field:r(root.querySelector('textarea')),who:r(root.querySelector('.who-chip')),plus:r(root.querySelector('.plus-button')),send:r(root.querySelector('.compose-send'))};});
      assert.ok(geometry.who.bottom<=geometry.field.top+1,'who controls above the writing');assert.ok(geometry.plus.top>=geometry.field.bottom-1,'plus in footer below writing');assert.ok(geometry.send.top>=geometry.field.bottom-1,'Send in footer below writing');result.geometry=geometry;
      const expected=await composer.evaluate(root=>{const probe=document.createElement('span');probe.hidden=true;probe.style.color='color-mix(in srgb,var(--accent) 45%,var(--sheet-hair))';root.append(probe);const color=getComputedStyle(probe).color;probe.remove();return color;});
      await page.waitForFunction(expected=>getComputedStyle(document.querySelector('#inline-composer')).borderColor===expected,expected);result.focusEdge=expected;
    }
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'no horizontal page overflow');
    const response=page.waitForResponse(r=>{try{return r.request().postDataJSON()?.kind==='message.send';}catch{return false;}});
    await page.locator('#inline-send').click();const receipt=await(await response).json();assert.equal(receipt.status,'committed');
    const saved=await control({method:'agent_view',actor:facts.actor,name:'source',args:{source_ref:{kind:'message',id:receipt.result.message_id}}});assert.equal(saved.body,body);result.sentId=receipt.result.message_id;
    assert.deepEqual(errors,[]);result.errors=errors;result.passed=true;console.log(JSON.stringify({key,passed:true}));await context.close();
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
  await writeFile(`${evidence}/results.json`, JSON.stringify({ engine, results, hashes, cleanup, failure: failure?.stack ?? null }, null, 2));
}
assert.deepEqual(cleanup.fixtureExit, { code: 0, signal: null }); assert.equal(cleanup.fixtureErrors, '');
assert.equal(cleanup.browserClosed, true); assert.deepEqual(cleanup.profileProcesses, []); assert.deepEqual(cleanup.remainingObservedPids, []);
assert.equal(cleanup.fixtureAbsent, true); assert.equal(cleanup.portClosed, true);
assert.equal(cleanup.profileAbsent,true);
if (failure) throw failure;

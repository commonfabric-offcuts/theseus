// Native rest-to-writing style continuity for the topic-foot composer (995).
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
for (const file of ['web/sheet-dense.css','web/write-black.css','web/write-touch.css','web/aim.css','web/inline-composer.mjs','web/compose-bar.mjs','web/index.html','web/reader-dense.css'])
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
    profile=await mkdtemp(join(tmpdir(),'auditor-995-webkit-'));
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


  const baseline = process.argv.includes('--baseline');
  const originalCss = Object.fromEntries(['sheet-dense.css','write-black.css','write-touch.css'].map(file =>
    [file,execFileSync('git',['show',`f2f2e17fc19521958a32be868d8da2e4d5494b5d:web/${file}`],{encoding:'utf8'})]));
  const matrix = (baseline ? [1280,390] : [320,375,390,1280]).flatMap(width =>
    (baseline ? ['dark'] : ['light','dark']).flatMap(scheme =>
      (baseline ? ['bookends'] : ['bookends','paper']).map(look => [width,scheme,look])));
  for(const [width,colorScheme,look] of (process.argv.includes('--quick') ? matrix.filter(c=>c[0]===390&&c[1]==='dark'&&c[2]==='bookends') : matrix)){
    const key=`${width}-${colorScheme}-${look}`,result={key};results.push(result);
    const context=await browser.newContext({viewport:{width,height:950},colorScheme,hasTouch:width<=760,isMobile:width<=760});
    await context.addInitScript(look=>localStorage.setItem('theseus-look',look==='paper'?'paper':''),look);
    const page=await context.newPage();activePage=page;page.setDefaultTimeout(9000);
    const errors=[];page.on('pageerror',e=>errors.push(e.message));
    try{
      await page.goto(origin+'/?topic=t1');await page.locator('body[data-ready=true]').waitFor();
      const field=page.locator('#inline-writing-body'),composer=page.locator('#inline-composer');
      await field.waitFor();await field.scrollIntoViewIfNeeded();
      for(const file of ['sheet-dense.css','write-black.css','write-touch.css']){
        const url=await page.locator(`link[href*="${file}"]`).getAttribute('href');
        assert.deepEqual(await(await page.request.get(new URL(url,origin).href)).body(),await readFile('web/'+file));
      }
      const snapshot=()=>composer.evaluate(root=>{
        const pick=(node,names)=>{const s=getComputedStyle(node);return Object.fromEntries(names.map(name=>[name,s[name]]));};
        const box=node=>{const r=node.getBoundingClientRect();return{top:r.top,bottom:r.bottom,left:r.left,right:r.right,width:r.width,height:r.height};};
        return {state:root.dataset.compose,open:root.closest('dialog').open,
          style:{card:pick(root,['backgroundColor','borderRadius','paddingTop','paddingRight','paddingBottom','paddingLeft','gridTemplateAreas']),
          field:pick(root.querySelector('textarea'),['backgroundColor','color','borderWidth','borderRadius','fontSize','lineHeight','paddingTop','paddingBottom']),
          kinds:pick(root.querySelector('.pencil-kinds'),['justifySelf','borderRadius','backgroundColor']),
          plus:pick(root.querySelector('.plus-button'),['gridArea','height','width','fontSize','borderRadius']),
          send:pick(root.querySelector('.compose-send'),['display','gridArea','height','borderRadius','fontSize'])},
          geometry:{card:box(root),field:box(root.querySelector('textarea')),kinds:box(root.querySelector('.pencil-kinds')),plus:box(root.querySelector('.plus-button')),send:box(root.querySelector('.compose-send'))},
          footer:{disabled:root.querySelector('.compose-send').disabled,word:root.querySelector('.send-word').textContent},value:root.querySelector('textarea').value,focus:document.activeElement===root.querySelector('textarea'),overflow:document.documentElement.scrollWidth>innerWidth};
      });
      result.rest=await snapshot();await composer.screenshot({path:`${evidence}/${key}-rest.png`});
      await field.click();await page.waitForFunction(()=>document.querySelector('#inline-composer').dataset.compose==='writing');
      result.writing=await snapshot();await composer.screenshot({path:`${evidence}/${key}-writing.png`});
      result.same=JSON.stringify(result.rest.style)===JSON.stringify(result.writing.style);
      if(baseline){assert.equal(result.same,false,'278 reproduces different rest/writing grammar');result.reproduced=true;}
      else{
        assert.deepEqual(result.rest.style,result.writing.style,'the untouched card keeps its sheet grammar when focused');
        assert.equal(result.rest.style.card.backgroundColor,'rgb(0, 0, 0)','the resting writing surface is black');
        assert.equal(result.rest.overflow,false);assert.equal(result.writing.overflow,false);
        assert.ok(result.rest.geometry.plus.top>=result.rest.geometry.field.bottom-1,'+ sits in the footer at rest');
        assert.ok(result.rest.geometry.kinds.bottom<=result.rest.geometry.field.top+1,'Message/Note stays above the field');
        // Use the real pencil action and pristine release278 styles to guard the open sheet.
        await page.locator('#new-message').click();await page.locator('#new-message-sheet[open]').waitFor();
        result.openEmpty=await snapshot();
        assert.deepEqual(result.rest.footer,result.openEmpty.footer,'empty footer follows the pencil sheet empty state');
        assert.deepEqual(result.rest.style.send,result.openEmpty.style.send,'footer control wears the pencil styling');
        await page.evaluate(styles=>{
          for(const [file,css] of Object.entries(styles)){
            const link=document.querySelector(`link[href*="${file}"]`);link.disabled=true;
            const style=document.createElement('style');style.dataset.baseline995=file;style.textContent=css;link.after(style);
          }
        },originalCss);
        result.pristineOpen=await snapshot();
        assert.deepEqual(result.openEmpty.style,result.pristineOpen.style,'open 985 sheet styles remain identical to release278');
        assert.deepEqual(result.openEmpty.footer,result.pristineOpen.footer);
        await page.evaluate(()=>{for(const style of document.querySelectorAll('[data-baseline995]')){document.querySelector(`link[href*="${style.dataset.baseline995}"]`).disabled=false;style.remove();}});
        result.openUnchanged=true;
        await page.locator('#new-message-close').click();await page.locator('#new-message-sheet[open]').waitFor({state:'hidden'});
        await page.locator('#inline-kind-note-card').click();
        await page.waitForFunction(()=>document.querySelector('#inline-kind-note-card').getAttribute('aria-checked')==='true');
        await page.locator('#inline-kind-message').click();
        await page.waitForFunction(()=>document.querySelector('#inline-kind-message').getAttribute('aria-checked')==='true');
        await field.click();await page.keyboard.type(`995 ${engine} ${key}`);await field.press('Enter');await page.keyboard.type('Second line');
        const body=`995 ${engine} ${key}\nSecond line`;assert.equal(await field.inputValue(),body);
        await page.waitForFunction(()=>document.querySelector('#inline-save-state')?.dataset.save==='saved');
        await page.locator('#inline-plus-button').click();await page.locator('#inline-plus-panel').waitFor();
        await page.locator('#inline-plus-done').click();assert.equal(await page.locator('#inline-plus-panel').isVisible(),false);
        assert.equal(await field.inputValue(),body);
        assert.equal(await page.locator('#inline-send').isEnabled(),true);
        const response=page.waitForResponse(r=>{try{return r.request().postDataJSON()?.kind==='message.send';}catch{return false;}});
        await page.locator('#inline-send').click();const receipt=await(await response).json();assert.equal(receipt.status,'committed');
        const saved=await control({method:'agent_view',actor:facts.actor,name:'source',args:{source_ref:{kind:'message',id:receipt.result.message_id}}});
        assert.equal(saved.body,body);result.sentId=receipt.result.message_id;result.nativeControls=true;

      }
      assert.deepEqual(errors,[]);result.errors=errors;result.passed=true;
    }catch(error){result.error=error.stack;result.passed=false;await page.screenshot({path:`${evidence}/${key}-failure.png`,fullPage:true}).catch(()=>{});}
    await writeFile(`${evidence}/observations.json`,JSON.stringify(results,null,2));await context.close();
  }
  const failed=results.filter(r=>!r.passed);assert.equal(failed.length,0,JSON.stringify(failed.map(r=>({key:r.key,error:r.error}))));
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

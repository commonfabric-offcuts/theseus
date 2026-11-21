// Actual HTTP/Core app and native keys. No product body or handler substitution.
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, writeFile, readFile, rm, access } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import net from 'node:net';
import { fixtureControl } from './fixture_control.mjs';
const playwright = await import(process.env.AIM_PLAYWRIGHT_CORE), engine = process.env.AIM_ENGINE ?? 'chromium';
const evidence = process.argv[2], baseline = process.argv.includes('--red');
await mkdir(evidence, { recursive: true });
const hashes = {};
for (const file of ['inline-composer.mjs', 'pane-keys.mjs', 'interaction-guide.mjs', 'pencil-keys.mjs']) hashes[file] = createHash('sha256').update(await readFile('web/' + file)).digest('hex');
const load=Number(execFileSync('/usr/bin/uptime',{encoding:'utf8'}).match(/load averages?:\s*([0-9.]+)/)?.[1]); assert.ok(load<12, 'load below12/18: '+load);
console.log(JSON.stringify({load}));
const fixture = spawn('/usr/bin/python3', ['-B', 'tests/fixtures/ui_http.py', '--freshness']);
const { control, exit, errors } = fixtureControl(fixture);
const ps = () => execFileSync('/bin/ps', ['-axo', 'pid=,ppid=,command='], { encoding: 'utf8' }).split('\n').flatMap(line => {
  const m = line.match(/^\s*(\d+)\s+(\d+)\s+(.*)$/); return m ? [{ pid: +m[1], parent: +m[2], command: m[3] }] : [];
});
const results = [], cleanup = {}, owned = new Set(); let browser, browserVersion, profile, origin, facts, failure;
function children() {
  const rows = ps(); for (let more = true; more;) { more = false;
    for (const row of rows) if (owned.has(row.parent) && !owned.has(row.pid)) { owned.add(row.pid); more = true; }
  }
}
const snapshot = page => page.evaluate(() => {
  const f = document.querySelector('#inline-writing-body');
  return { body: f.value, start: f.selectionStart, end: f.selectionEnd, active: document.activeElement?.id,
    sheet: document.querySelector('#new-message-sheet').open,
    kind: document.querySelector('#inline-kind [aria-checked=true]')?.id,
    keys: window.observed1023 ?? [] };
});
try {
  facts = await control({ method: 'ready' }); origin = facts.origin;
  profile = await mkdtemp(evidence + '/' + engine + '-profile-');
  const persistent = await playwright[engine].launchPersistentContext(profile, { headless: true,
    ...(engine === 'chromium' ? { executablePath: process.env.AIM_CHROME } : {}) });
  browser = persistent.browser(); assert.ok(browser); browserVersion = browser.version();
  for (const row of ps()) if (row.command.includes(profile)) owned.add(row.pid);
  children(); assert.ok(owned.size);
  for (const look of baseline ? ['bookends'] : ['bookends', 'paper']) for (const colorScheme of baseline ? ['light'] : ['light', 'dark']) {
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, colorScheme });
    await context.addInitScript(look => { localStorage.setItem('theseus-look', look === 'paper' ? 'paper' : '');
      window.observed1023 = []; document.addEventListener('keydown', e => {
        if (e.altKey || e.key === 'Enter') window.observed1023.push({ key: e.key, code: e.code, alt: e.altKey, meta: e.metaKey, composing: e.isComposing });
      }, true);
    }, look);
    let page;
    async function check(name, act) {
      const result = { key: `${engine}-${look}-${colorScheme}-${name}`, envelopes: [] }; results.push(result);
      page = await context.newPage(); page.setDefaultTimeout(4000);
      const pageErrors = []; result.networkFailures = [];
      page.on('request', request => { try { const value = request.postDataJSON(); if (['message.send','memory.create'].includes(value?.kind)) result.envelopes.push(value); } catch {} });
      page.on('pageerror', e => pageErrors.push({ message: e.message, stack: e.stack }));
      page.on('requestfailed', r => result.networkFailures.push({ url: r.url(), method: r.method(), failure: r.failure() }));
      try {
        await page.goto(origin + '/?topic=t1'); await page.locator('body[data-ready=true]').waitFor();
        result.responses = {};
        {
          result.served = {};
          for (const [file, expected] of Object.entries(hashes)) {
            const url = await page.evaluate(file => performance.getEntriesByType('resource').find(e => new URL(e.name).pathname.endsWith('/' + file))?.name, file);
            assert.ok(url, 'actual module loaded: ' + file);
            const bytes = await (await page.request.get(url)).body();
            result.served[file] = createHash('sha256').update(bytes).digest('hex'); assert.equal(result.served[file], expected);
          }
        }
        const field = page.locator('#inline-writing-body'); await field.fill('1023 kept words');
        await field.press('Home'); await field.press('ArrowRight'); await field.press('ArrowRight');
        for (let i = 0; i < 4; i++) await field.press('Shift+ArrowRight');
        result.before = await snapshot(page);
        await act({ field, result, message: page.locator('#inline-kind-message'), note: page.locator('#inline-kind-note-card') });
        assert.deepEqual(pageErrors, []); result.passed = true;
      } catch (caught) { result.error = caught.stack; result.passed = false;
        await page.screenshot({ path: `${evidence}/${result.key}.png` }).catch(() => {});
      }
      result.after = await snapshot(page).catch(() => null);
      await page.close();
      await writeFile(evidence + '/observations.json', JSON.stringify(results, null, 2));
      console.log(JSON.stringify({ key: result.key, passed: result.passed, error: result.error?.split('\n')[0] }));
    }
    const selected = async (kind, before) => {
      const after = await snapshot(page); assert.equal(after.kind, 'inline-kind-' + kind);
      assert.equal(after.body, before.body); assert.equal(after.start, before.start); assert.equal(after.end, before.end);
    };
    const send = async (kind, act, result, body) => {
      // Handle rejection immediately, retaining an actual failed send rather
      // than letting a timer rejection abort owned cleanup.
      const pending = page.waitForResponse(r => { try { return r.request().postDataJSON()?.kind === kind; } catch { return false; } }, { timeout: 2500 })
        .then(response => ({ response }), error => ({ error }));
      await act(); const { response, error } = await pending; if (error) throw error;
      const receipt = await response.json(); assert.equal(receipt.status, 'committed'); result.receipt = receipt;
      const id = kind === 'message.send' ? receipt.result.message_id : receipt.result.item_id;
      const source = await control({ method: 'agent_view', actor: facts.actor, name: 'source', args: { source_ref: receipt.result.source_ref ?? { kind: 'message', id } } });
      assert.equal(source.error, undefined); result.source = source;
      if (kind === 'message.send') assert.equal(source.body, body);
      else { assert.equal(source.title, body.split('\n')[0]); assert.ok(source.body.includes('Second line')); }
      assert.equal(result.envelopes.filter(e => e.kind === kind).length, 1, 'one actual publication envelope');
    };
    for (const [name, target, shape] of [
      ['dead-229-modal','note-card',{key:'Dead',code:'KeyN',windowsVirtualKeyCode:229,nativeVirtualKeyCode:45}],
      ['micro-77-modal','message',{key:'µ',code:'KeyM',windowsVirtualKeyCode:77,nativeVirtualKeyCode:46}],
      ['micro-during-composition-modal','message',{key:'µ',code:'KeyM',windowsVirtualKeyCode:77,nativeVirtualKeyCode:46,composition:true}],
      ['driver-alt-n-modal','note-card',null],['driver-alt-m-modal','message',null],
    ]) await check(name, async ({field,result,message,note}) => {
      await page.evaluate(async () => {
        const url=performance.getEntriesByType('resource').find(e=>new URL(e.name).pathname.endsWith('/inline-composer.mjs')).name;
        const {InlineComposer}=await import(url), pop=InlineComposer.prototype.pop;
        InlineComposer.prototype.pop=function(...args){window.composer1032=this;return pop.apply(this,args);};
      });
      await page.locator('#new-message').click();
      if(target==='message')await note.click();
      await field.click();
      await page.evaluate(() => {
        window.trace1032=[];
        const record=(phase,event)=>{const row={phase,type:event.type,trusted:event.isTrusted,key:event.key,code:event.code,keyCode:event.keyCode,alt:event.altKey,isComposing:event.isComposing,data:event.data,inputType:event.inputType,prevented:event.defaultPrevented};trace1032.push(row);Object.defineProperty(row,'preventedAfter',{enumerable:true,get:()=>event.defaultPrevented});};
        for(const type of ['keydown','keyup','beforeinput','input','compositionstart','compositionupdate','compositionend']) {
          window.addEventListener(type,e=>record('window-capture',e),true);
          document.addEventListener(type,e=>record('document-bubble',e));
        }
      });
      result.owner=await page.evaluate(()=>{const c=composer1032;return{rootHidden:c.root.hidden,connected:c.root.isConnected,ownsField:c.root.contains(c.field),active:c.field===document.activeElement,sheet:c.sheet.open,admits:c.admits(),busy:c.pageBusy(),disposed:c.disposed??false,cardReply:c.cardReply,dialogs:[...document.querySelectorAll('dialog[open]')].map(e=>e.id)};});
      if(shape?.composition){const session=await context.newCDPSession(page);await session.send('Input.imeSetComposition',{text:'保',selectionStart:1,selectionEnd:1});}
      result.modalBefore=await snapshot(page);
      if(shape){const session=await context.newCDPSession(page);const {composition,...eventShape}=shape;await session.send('Input.dispatchKeyEvent',{type:'keyDown',modifiers:1,...eventShape,...(target==='message'?{text:'µ',unmodifiedText:'m'}:{})});result.afterKeyDown=await snapshot(page);result.afterKeyDownEvents=await page.evaluate(()=>trace1032);await session.send('Input.dispatchKeyEvent',{type:'keyUp',modifiers:1,...eventShape});}
      else await field.press(target==='message'?'Alt+KeyM':'Alt+KeyN');
      result.events=await page.evaluate(()=>trace1032);result.modalAfter=await snapshot(page);
      if(shape){assert.equal(result.afterKeyDown.kind,'inline-kind-'+target, 'keydown itself switches the mode before keyup');assert.equal(result.afterKeyDownEvents.find(e=>e.type==='keydown'&&e.code===shape.code)?.preventedAfter,true,'recognized keydown is consumed');}
      result.switchWorked=result.modalAfter.kind==='inline-kind-'+target;
      assert.equal(result.owner.sheet,true);assert.equal(result.owner.active,true);
      assert.equal(result.modalAfter.kind,'inline-kind-'+target, 'exact event in pencil-opened modal changes mode');
      assert.equal(result.modalAfter.body,result.modalBefore.body,'kept exact writing');
    });
    await check('closed-sheet-then-switch-then-composing-chords-sequence',async({field,result})=>{
      await page.locator('#people-heading').click();
      assert.equal(await page.evaluate(()=>Boolean(document.activeElement?.closest('input,textarea,select,[contenteditable]'))),false,'sequence begins outside writing, not in title Rename');
      await page.evaluate(()=>{window.sequence1032=[];window.addEventListener('keydown',e=>{const row={key:e.key,code:e.code,keyCode:e.keyCode,composing:e.isComposing,trusted:e.isTrusted};Object.defineProperty(row,'prevented',{enumerable:true,get:()=>e.defaultPrevented});sequence1032.push(row);},true);});
      const session=await context.newCDPSession(page);result.sequence=[];const original=(await snapshot(page)).body;
      for(const [step,code,key,keyCode,kind]of [[0,'KeyN','Dead',229,'note-card'],[1,'KeyM','µ',77,'message'],[2,'KeyN','Dead',229,'note-card'],[3,'KeyM','µ',77,'message']]){
        if(step===2)await session.send('Input.imeSetComposition',{text:'保',selectionStart:1,selectionEnd:1});
        const before=await snapshot(page),at=await page.evaluate(()=>sequence1032.length),shape={code,key,windowsVirtualKeyCode:keyCode,nativeVirtualKeyCode:code==='KeyN'?45:46,modifiers:1};
        await session.send('Input.dispatchKeyEvent',{type:'keyDown',...shape,...(code==='KeyM'?{text:'µ',unmodifiedText:'m'}:{})});
        const afterDown=await snapshot(page),events=await page.evaluate(at=>sequence1032.slice(at),at);
        await session.send('Input.dispatchKeyEvent',{type:'keyUp',...shape});result.sequence.push({step,before,afterDown,events,wanted:kind});
      }
      for(const row of result.sequence){assert.equal(row.events[0].prevented,true,'first physical keydown consumed at step '+row.step);assert.equal(row.afterDown.kind,'inline-kind-'+row.wanted);assert.equal(row.afterDown.body,row.before.body,'no key residue at step '+row.step);assert.equal(row.afterDown.sheet,true);}
      assert.equal(result.sequence[0].before.sheet,false,'real closed-sheet opening');assert.equal(result.sequence[0].before.body,original);assert.ok(result.sequence[2].events[0].composing,'later chord follows actual composition');
    });
    await check('unrelated-native-IME-stays-writing',async({field,result})=>{
      await page.locator('#new-message').click();await field.click();
      const session=await context.newCDPSession(page), before=await snapshot(page);
      await page.evaluate(()=>{window.ime1032=[];for(const type of ['compositionstart','compositionupdate','compositionend','beforeinput','input'])document.addEventListener(type,e=>ime1032.push({type:e.type,data:e.data,isComposing:e.isComposing,trusted:e.isTrusted}));});
      await session.send('Input.imeSetComposition',{text:'保',selectionStart:1,selectionEnd:1});
      await session.send('Input.insertText',{text:'保持'});
      result.ime=await page.evaluate(()=>ime1032);result.afterIME=await snapshot(page);
      assert.equal(result.afterIME.body,before.body+'保持');assert.equal(result.afterIME.kind,before.kind);
      assert.ok(result.ime.some(e=>e.type==='compositionstart'&&e.trusted));assert.ok(result.ime.some(e=>e.type==='compositionend'&&e.data==='保持'),'CDP commit reports the exact composed text');
      result.limit='CDP Input.insertText reports compositionend isTrusted=false here; native trust is asserted for compositionstart and input, not for that end event.';assert.ok(result.ime.some(e=>e.type==='input'&&e.isComposing&&e.trusted));
    });
    await context.close();
  }
} catch (caught) { failure = caught; }
finally {
  if (browser) { children(); await browser.close(); cleanup.browserClosed = !browser.isConnected(); }
  const after = ps(); cleanup.ownedPids = [...owned]; cleanup.remainingOwned = after.filter(row => owned.has(row.pid));
  cleanup.profileProcesses = profile ? after.filter(row => row.command.includes(profile)) : [];
  if (profile && cleanup.browserClosed && !cleanup.remainingOwned.length && !cleanup.profileProcesses.length) {
    await rm(profile, { recursive: true }); cleanup.profileRemoved = await access(profile).then(() => false, () => true);
  }
  fixture.stdin.end(); cleanup.fixtureExit = await exit; cleanup.fixtureErrors = errors(); cleanup.fixturePid = fixture.pid;
  cleanup.fixtureAbsent = !ps().some(row => row.pid === fixture.pid);
  if (origin) cleanup.portClosed = await new Promise(resolve => {
    const url = new URL(origin), socket = net.createConnection({ host: url.hostname, port: +url.port });
    socket.once('connect', () => { socket.destroy(); resolve(false); }); socket.once('error', () => resolve(true));
  });
  await writeFile(evidence + '/results.json', JSON.stringify({ engine, browserVersion, baseline, hashes, results, cleanup, failure: failure?.stack ?? null }, null, 2));
}
assert.equal(cleanup.fixtureExit.code, 0); assert.equal(cleanup.fixtureAbsent, true); assert.equal(cleanup.portClosed, true);
assert.equal(cleanup.browserClosed, true); assert.deepEqual(cleanup.remainingOwned, []); assert.deepEqual(cleanup.profileProcesses, []); assert.equal(cleanup.profileRemoved, true);
if (failure) throw failure;
assert.ok(results.length && results.every(r => r.passed), '1032 exact Mac event diagnostic; inspect retained evidence');

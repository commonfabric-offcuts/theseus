// Reply height and completion through isolated Core and real browser input.
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, writeFile, readFile, rm, access } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import net from 'node:net';
import { fixtureControl } from './fixture_control.mjs';
const engines = await import(process.env.AIM_PLAYWRIGHT_CORE), engine = process.env.AIM_BROWSER ?? 'chromium';
const evidence = process.argv[2]; await mkdir(evidence, { recursive: true });
const filter = new RegExp(process.argv[3] ?? '');
const sourceFiles = ['web/app.mjs', 'web/app-session.mjs', 'web/session.mjs', 'web/editor.mjs', 'web/writing-input.mjs', 'web/compose-bar.mjs', 'web/card-replies.mjs', 'web/inline-composer.mjs', 'web/upload-state.mjs', 'web/aim.css', 'tests/fixtures/ui_http.py', 'tests/inline_reply_975_979_native.mjs'];
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
  const facts = await control({ method: 'ready' }); origin = facts.origin;await writeFile(`${evidence}/fixture.json`,JSON.stringify({origin,pid:child.pid}));
  profile = await mkdtemp(`${evidence}/${engine}-profile-`);
  const persistent = await engines[engine].launchPersistentContext(profile, { headless: true,
    ...(engine === 'chromium' ? { executablePath: process.env.AIM_CHROME } : {}) });
  browser = persistent.browser(); retainChildren(); assert.ok(owned.size);
  for (const width of [1280,390]) for (const look of ['bookends','paper']) for (const scenario of ['height','no-quote','image-source','reader-no-quote','named-control','keyboard-send','quote-only-keyboard','quote-only-lost-answer','quote-only-lost-writing','quote-only-lost-reopened','quoted-lost-answer','quoted-inline','quoted-reader','refused-send','late-writing','live-arrival']) {
    const key = `${width}-${look}-${scenario}`; if(!filter.test(key))continue;
    const quoteOnly=scenario.startsWith('quote-only-'),lostAnswer=scenario.includes('-lost-');
    // Each case has its own dossier: recovery and later writing deliberately
    // retained by adverse cases must not fold another case's source card.
    const first=await control({method:'agent_message',operation_id:`975-root-${key}`,sender:facts.actor,whole_topic:true,post_args:{divergence_reason:'Independent native reply case'},body:`Writing surfaces ${key}`});
    assert.equal(first.status,'committed');const rootId=first.result.message_id;
    if((['named-control','keyboard-send'].includes(scenario)||quoteOnly))assert.equal((await control({method:'stack_act',kind:'stack.name',sender:facts.agent,message_id:rootId,args:{name:'Writing surfaces'},operation_id:`975-name-${key}`})).status,'committed');
    const sent = await control({method:'agent_message',operation_id:`975-parent-${key}`,sender:facts.agent,
      reply_to:rootId,reply_without_quote:'An independent reply without a quote',body:(scenario==='image-source'||quoteOnly)?'':(['named-control','keyboard-send'].includes(scenario)||quoteOnly)?'Reply without a quote:\n\n> answering the question in the message it replies to\n\n'+'A paragraph about writing surfaces. '.repeat(50):`Exact parent words ${key}.`,...(['image-source','named-control','keyboard-send'].includes(scenario)?{attachments:[{name:'image.png',png:[80,60]}]}:{})});
    assert.equal(sent.status,'committed');const id=sent.result.message_id;
    if((['named-control','keyboard-send'].includes(scenario)||quoteOnly)) for(let n=0;n<3;n++) {
      const sibling=await control({method:'agent_message',operation_id:`975-sibling-${key}-${n}`,sender:facts.agent,reply_to:rootId,reply_without_quote:'Sibling without a quote',body:`Other reply ${n}`});
      assert.equal(sibling.status,'committed');
    }
    const context=await browser.newContext({viewport:{width,height:900},hasTouch:width===390,isMobile:width===390,colorScheme:look==='paper'?'light':'dark'});
    await context.addInitScript(look=>localStorage.setItem('theseus-look',look),look);
    const page=await context.newPage();activePage=page;page.setDefaultTimeout(6000);
    const errors=[];page.on('pageerror',e=>errors.push(e.message));
    const served={},servedJobs=[];page.on('response',response=>{const path='web/'+new URL(response.url()).pathname.split('/').at(-1);if(Object.hasOwn(hashes,path))servedJobs.push(response.body().then(bytes=>{served[path]=createHash('sha256').update(bytes).digest('hex');}));});
    const result={key,errors};let releaseSend;
    if(quoteOnly)result.parentSource=await control({method:'agent_view',actor:facts.actor,name:'source',args:{source_ref:{kind:'message',id}}});
    try {
      await page.goto(origin+'/?topic=t1');await page.locator('body[data-ready=true]').waitFor();
      assert.equal(await page.locator('html').getAttribute('data-look'),look==='paper'?'paper':null);
      const card=page.locator(`.message-card[data-id="${id}"]`),words=card.locator(':scope > .message-preview');
      if((['named-control','keyboard-send'].includes(scenario)||quoteOnly)){await card.hover();await page.locator('.message-bar [data-act=reply]').click();}else await words.click();
      const root=page.locator(`[id="reply-${id}-composer"]`),field=root.locator('textarea'),taller=page.locator(`[id="reply-${id}-taller-field"]`);
      await field.waitFor();await field.fill(scenario==='height'?'Short reply':`Sent exact reply ${key}`);
      if(scenario==='height') {
        result.short={visible:await taller.isVisible(),height:await field.evaluate(n=>n.getBoundingClientRect().height)};
        assert.equal(result.short.visible,false,'short inline reply hides height control');
        await page.screenshot({path:`${evidence}/${key}-short.png`});
        const geometry=async()=>root.evaluate(n=>Object.fromEntries(['.reply-height','.field-box','[id$=plus-button]','[id$=send]'].map(selector=>{const e=n.querySelector(selector),r=e.getBoundingClientRect(),base=n.getBoundingClientRect();return [selector,{x:r.x-base.x,width:r.width}];})));
        const before=await geometry(),long=Array.from({length:16},(_,i)=>`Full line ${i}`).join('\n');
        await field.fill(long);assert.equal(await taller.isVisible(),true,'full field shows height control');
        assert.deepEqual(await geometry(),before,'visibility reserves the control column');
        await page.screenshot({path:`${evidence}/${key}-full.png`});
        const normal=await field.evaluate(n=>n.getBoundingClientRect().height);await taller.click();
        assert.ok(await field.evaluate(n=>n.getBoundingClientRect().height)>normal+10);assert.equal(await taller.getAttribute('aria-pressed'),'true');
        await field.fill('Short again');assert.equal(await taller.isVisible(),false);assert.equal(await root.getAttribute('data-tall'),'');
        await field.fill(long);assert.equal(await taller.isVisible(),true);await taller.click();assert.equal(await taller.getAttribute('aria-pressed'),'false');
        // Find writing just below the wide field's cap, then change width
        // without an input event. This must actually cross the threshold.
        await page.setViewportSize({width:width===390?700:1280,height:900});
        let low=1,high=128;
        while(low<high){const mid=Math.floor((low+high)/2);await field.fill('Wrapping words '.repeat(mid));if(await taller.isVisible())high=mid;else low=mid+1;}
        await field.fill('Wrapping words '.repeat(low-1));assert.equal(await taller.isVisible(),false);
        result.wideWidth=await field.evaluate(n=>n.clientWidth);
        await page.setViewportSize({width:width===390?390:900,height:900});
        await taller.waitFor({state:'visible'});result.narrowWidth=await field.evaluate(n=>n.clientWidth);
        assert.ok(result.narrowWidth<result.wideWidth,'resize changes actual wrapping width');
        await page.setViewportSize({width,height:900});await field.fill(long);
        await field.focus();await page.keyboard.press('Escape');await field.waitFor({state:'hidden'});await words.click();await field.waitFor();
        assert.equal(await field.inputValue(),long);assert.equal(await taller.isVisible(),true,'restored writing measures its height');
        await words.click();await page.locator('#reader[open]').waitFor();
        const rf=page.locator('#writing-body'),rt=page.locator('#taller-field');
        await rf.fill('Short Reader');assert.equal(await rt.isVisible(),false);
        await rf.fill(long);
        if(width===390){assert.equal(await rt.isVisible(),true);await rt.click();assert.equal(await rt.getAttribute('aria-pressed'),'true');await rf.fill('Short Reader again');assert.equal(await rt.isVisible(),false);
          await page.locator('#plus-button').click();await page.locator('#toggle-note').click();await rf.fill('Private note');
          assert.equal(await rt.isVisible(),true,'private note retains its existing height control');
          await page.locator('#note-chip').click();assert.equal(await rf.inputValue(),'Short Reader again');assert.equal(await rt.isVisible(),false);
        }
        else assert.equal(await rt.isVisible(),false,'wide Reader keeps its existing fixed-height layout');
        await page.screenshot({path:`${evidence}/${key}.png`});result.growShrinkToggleRestoreResize=true;
      } else {
        const readerSend=['reader-no-quote','quoted-reader'].includes(scenario),quoted=scenario.startsWith('quoted-');
        if(readerSend||quoted){await words.click();await page.locator('#reader[open]').waitFor();await page.locator('#writing-body').click();}
        if(quoted){
          await page.locator('#source-body [data-start]').filter({hasText:`Exact parent words ${key}.`}).last().click();await page.keyboard.press('Enter');
          assert.match(await page.locator('#writing-body').inputValue(),/> Exact parent words/);
          await page.locator('#writing-body').fill(`Sent exact reply ${key}`);
          if(!readerSend){await page.locator('#reader-close').click();await field.waitFor();}
        }
        let lostReceipt;let sendSeen;const seen=new Promise(resolve=>{sendSeen=resolve;});
        const held=new Promise(resolve=>{releaseSend=resolve;});
        if((['refused-send','late-writing','live-arrival'].includes(scenario)||lostAnswer))await page.route('**/api/command',async route=>{
          const envelope=route.request().postDataJSON();if(envelope?.kind!=='message.send')return route.continue();
          if(scenario==='refused-send')return route.fulfill({status:200,json:{v:1,instance_id:envelope.instance_id,operation_id:envelope.operation_id,kind:envelope.kind,recorded:true,status:'rejected',error:{code:'PUBLICATION_REFUSED',message:'Publication refused; writing kept.'}}});
          const response=await route.fetch();const answer=await response.json();assert.equal(answer.status,'committed');if(lostAnswer){lostReceipt=answer;sendSeen();return route.abort('failed');}sendSeen();await held;await route.fulfill({response});
        });
        if(quoteOnly||lostAnswer)await page.screenshot({path:`${evidence}/${key}-before.png`});
        const receipt=page.waitForResponse(r=>{try{return r.request().postDataJSON()?.kind==='message.send';}catch{return false;}});receipt.catch(()=>{});
        if(scenario==='keyboard-send'||quoteOnly||lostAnswer){await field.focus();await page.keyboard.press('Meta+Enter');}else await page.locator(readerSend?'#send-reply':`[id="reply-${id}-send"]`).click();
        if(['late-writing','live-arrival'].includes(scenario)){
          await Promise.race([seen,new Promise((_,reject)=>setTimeout(()=>reject(new Error('held send was not reached')),6000))]);
          assert.equal(await field.isVisible(),true);
          if(scenario==='late-writing')await field.fill('Keep this newer writing');
          else{
            const arrival=await control({method:'agent_message',operation_id:`975-arrival-${key}`,sender:facts.agent,reply_to:id,reply_without_quote:'Arriving while Send is confirmed',body:'A concurrent reply in the same dossier.'});
            assert.equal(arrival.status,'committed');await page.locator(`.message-card[data-id="${arrival.result.message_id}"]`).waitFor();result.liveArrival=arrival.result.message_id;
          }
          releaseSend();
        }
        if(lostAnswer){await seen;result.receipt=lostReceipt;result.responseLost=true;}else result.receipt=await(await receipt).json();
        if(scenario==='refused-send'){
          assert.equal(result.receipt.status,'rejected');assert.equal(await root.isVisible(),true);await page.locator(`#topic-pending [data-key*="${id}"] button`).click();await page.locator('#version-review[open]').waitFor();
          assert.ok((await page.locator('#review-content').innerText()).includes(`Sent exact reply ${key}`),'refused preparation retains exact writing');
          await page.locator('#review-close').click();assert.equal(await root.isVisible(),true);result.recoveryKept=true;
        }else{
        assert.equal(result.receipt.status,'committed');
        const sentId=result.receipt.result.message_id;
        await page.locator(`.message-card[data-id="${sentId}"]`).waitFor();
        result.source=await control({method:'agent_view',actor:facts.actor,name:'source',args:{source_ref:{kind:'message',id:sentId}}});
        assert.equal(result.source.body,`Sent exact reply ${key}`);assert.equal(result.source.reply_to,id);assert.equal(result.source.quotes.length>0,quoted);
        if(lostAnswer){
          assert.equal(await field.isVisible(),true,'unknown response retains the card controls');
          if(scenario==='quote-only-lost-writing')await field.fill('New writing after the lost answer');
          if(scenario==='quote-only-lost-reopened'){await field.focus();await page.keyboard.press('Escape');await field.waitFor({state:'hidden'});await card.hover();await page.locator('.message-bar [data-act=reply]').click();await field.waitFor();}
          await page.locator(`#topic-pending [data-key*="${id}"] button`).click();
          await page.locator('#version-review[open]').waitFor();
          await page.getByRole('button',{name:'Check confirmation',exact:true}).click();
          await page.getByRole('heading',{name:'Sent to Theseus',exact:true}).waitFor();
          result.clientConfirmed=true;result.operation=await control({method:'agent_view',actor:facts.actor,name:'operation',args:{operation_id:result.receipt.operation_id}});assert.equal(result.operation.status,'committed');assert.equal(result.operation.result.message_id,sentId);await page.screenshot({path:`${evidence}/${key}-confirmed.png`});await page.locator('#review-close').click();
        }
        if(['quote-only-lost-writing','quote-only-lost-reopened'].includes(scenario)){assert.equal(await field.isVisible(),true,'a later writing or opening keeps its field');assert.equal(await field.inputValue(),scenario==='quote-only-lost-writing'?'New writing after the lost answer':'');result.laterOwnerKept=true;}
        else if(scenario==='late-writing'){await page.waitForTimeout(500);assert.equal(await field.inputValue(),'Keep this newer writing');assert.equal(await field.isVisible(),true);assert.equal(await field.evaluate(n=>document.activeElement===n),true);result.newWritingKept=true;}
        else{await root.waitFor({state:'hidden'});await page.waitForTimeout(500);assert.equal(await root.isVisible(),false,'field stays closed after feed refresh');result.closed=true;}
        }
      }
      if(quoteOnly||lostAnswer)await page.screenshot({path:`${evidence}/${key}-after.png`});
      await Promise.all(servedJobs);result.served=served;for(const [path,sha]of Object.entries(hashes))if(path.startsWith('web/'))assert.equal(served[path],sha,`${path} actually served exact measured bytes`);
      assert.deepEqual(errors,[]);
    } catch(error) { result.error=error.stack;await page.screenshot({path:`${evidence}/${key}-failure.png`,fullPage:true});await writeFile(`${evidence}/${key}-failure.html`,await page.content()); }
    releaseSend?.();results.push(result);await writeFile(`${evidence}/observations.json`,JSON.stringify(results,null,2));retainChildren();await context.close();
  }
} catch (error) {
  failure = error;
  if (activePage && !activePage.isClosed()) {
    await activePage.screenshot({ path: `${evidence}/failure.png`, fullPage: true });
    await writeFile(`${evidence}/failure.html`, await activePage.content());
    await writeFile(`${evidence}/events.json`, JSON.stringify(await activePage.evaluate(() => window.events975??[]), null, 2));
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
for (const path of sourceFiles) assert.equal(createHash('sha256').update(await readFile(path)).digest('hex'),hashes[path],`${path} stayed fixed during the run`);
if (failure) throw failure;
assert.ok(results.length && results.every(r => !r.error), "975/979 native cases pass; inspect observations");
console.log(JSON.stringify({ passed: results.length, cleanup }));

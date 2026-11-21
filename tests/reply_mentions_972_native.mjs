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
const sourceFiles = ['web/mention-pick.mjs', 'web/writing-input.mjs', 'web/inline-composer.mjs', 'web/reader.mjs', 'web/aim.css', 'tests/reply_mentions_972_native.mjs'];
const hashes = Object.fromEntries(await Promise.all(sourceFiles.map(async path => [path, createHash('sha256').update(await readFile(path)).digest('hex')])));
await writeFile(`${evidence}/source.json`, JSON.stringify({ base: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(), hashes }, null, 2));
const child = spawn('/usr/bin/python3', ['-B', 'tests/fixtures/ui_http.py', '--freshness', '--other-person']);
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
  assert.equal((await control({method:'agent_message',operation_id:'972-human-member',sender:'fixture-other-person',join:true,whole_topic:true,post_args:{divergence_reason:'Picker human member fixture'},body:'A second person in this topic'})).status,'committed');
  await control({method:'actor_name',actor_id:facts.agent,name:'Mention Guide'});
  profile = await mkdtemp(`${evidence}/${engine}-profile-`);
  const persistent = await engines[engine].launchPersistentContext(profile, { headless: true,
    ...(engine === 'chromium' ? { executablePath: process.env.AIM_CHROME } : {}) });
  browser = persistent.browser(); retainChildren(); assert.ok(owned.size);
  for (const width of [1280,390]) for (const look of ['bookends','paper']) for (const surface of ['inline','reader','topic','pencil']) {
    const key=`${width}-${look}-${surface}`;if(!filter.test(key))continue;
    const made=await control({method:'agent_message',operation_id:`972-parent-${key}`,sender:facts.agent,whole_topic:true,post_args:{divergence_reason:'Independent native mention case'},body:`Mention parent ${key}`});
    assert.equal(made.status,'committed');const id=made.result.message_id;
    const context=await browser.newContext({viewport:{width,height:900},hasTouch:width===390,isMobile:width===390,colorScheme:look==='paper'?'light':'dark'});
    await context.addInitScript(look=>localStorage.setItem('theseus-look',look),look);
    const page=await context.newPage();activePage=page;page.setDefaultTimeout(6000);
    const errors=[],sends=[];page.on('pageerror',e=>errors.push(e.message));
    page.on('request',r=>{try{if(r.postDataJSON()?.kind==='message.send')sends.push(r.postDataJSON());}catch{}});
    const result={key,errors};
    try {
      await page.goto(origin+'/?topic=t1');await page.locator('body[data-ready=true]').waitFor();
      let field,send;
      if(surface==='inline'||surface==='reader') {
        const words=page.locator(`.message-card[data-id="${id}"] > .message-preview`);
        await words.click();await page.locator(`[id="reply-${id}-composer"] textarea`).waitFor();
        if(surface==='reader'){await words.click();await page.locator('#reader[open]').waitFor();field=page.locator('#writing-body');send=page.locator('#send-reply');}
        else{field=page.locator(`[id="reply-${id}-composer"] textarea`);send=page.locator(`[id="reply-${id}-send"]`);}
      }else{
        if(surface==='pencil')await page.locator('#new-message').click();
        field=page.locator('#inline-writing-body');send=page.locator('#inline-send');
      }
      await field.waitFor();await field.fill('');await field.pressSequentially('Please ask @');
      const list=page.getByRole('listbox',{name:'People to mention'});await list.waitFor();
      assert.equal(await list.getByRole('option').count(),2,'@ offers both the agent and the other person, excluding self and outsiders');
      assert.ok((await list.innerText()).includes('@fixture-other-person'));
      await page.keyboard.press('ArrowDown');assert.ok((await list.locator('[aria-selected=true]').innerText()).includes('@fixture-other-person'));await page.keyboard.press('ArrowUp');
      await page.screenshot({path:`${evidence}/${key}-picker.png`});
      assert.ok(await list.getByRole('option').evaluateAll(rows=>rows.every(n=>n.scrollWidth<=n.clientWidth+1)),'long member IDs wrap without clipping');
      const bounds=await list.boundingBox();assert.ok(bounds.x>=0 && bounds.x+bounds.width<=width+1,'picker fits viewport');
      const typed=facts.agent.slice(0,5);await field.pressSequentially(typed);await page.getByRole('option',{name:`@${facts.agent}`,exact:false}).waitFor();
      const narrowed=await list.getByRole('option').allTextContents();assert.ok(narrowed.every(s=>s.toLowerCase().includes(typed.toLowerCase())));
      result.beforePick=await field.evaluate(n=>({body:n.value,whiteSpace:getComputedStyle(n).whiteSpace,selection:[n.selectionStart,n.selectionEnd]}));
      await page.keyboard.press('Enter');assert.equal(await field.inputValue(),`Please ask @${facts.agent} `);assert.equal(await list.isVisible(),false);
      assert.equal(await field.evaluate(n=>document.activeElement===n),true);assert.equal(sends.length,0,'Return chooses without sending');
      const completed=await field.inputValue();await page.keyboard.press('Meta+z');result.undoBody=await field.inputValue();assert.notEqual(result.undoBody,completed,'completion participates in native Undo');
      await page.keyboard.press('Meta+Shift+z');assert.equal(await field.inputValue(),completed,'native Redo restores exact completed writing');
      await field.fill('Keep @');await list.waitFor();await page.keyboard.press('Escape');assert.equal(await field.inputValue(),'Keep @');assert.equal(await field.isVisible(),true);assert.equal(await list.isVisible(),false);
      await field.fill('mail');await field.pressSequentially(`@${facts.agent}`);assert.equal(await list.isVisible(),false,'email interior stays plain text');
      await field.fill('Ask @zz-no-member');assert.equal(await list.getByRole('option').count(),0);await page.keyboard.press('Enter');assert.equal(await field.inputValue(),'Ask @zz-no-member\n','no match does not swallow Return');
      await field.fill('Ask @Guide');await list.waitFor();assert.equal(await list.getByRole('option').count(),1,'filter also matches display name');
      await page.keyboard.press('Enter');assert.equal(await field.inputValue(),`Ask @${facts.agent} `);
      // Put the caret inside a partial token using actual keys; choosing must
      // replace its suffix too while keeping all surrounding writing.
      await field.fill('Before @zz after');await page.keyboard.press('ArrowLeft');await page.keyboard.press('ArrowLeft');await page.keyboard.press('ArrowLeft');await page.keyboard.press('ArrowLeft');await page.keyboard.press('ArrowLeft');await page.keyboard.press('ArrowLeft');await page.keyboard.press('ArrowLeft');await page.keyboard.press('ArrowLeft');
      await list.waitFor();const option=page.getByRole('option',{name:`@${facts.agent}`,exact:false});
      if(width===390)await option.tap();else await option.click();
      assert.equal(await field.inputValue(),`Before @${facts.agent} after`);assert.equal(await field.evaluate(n=>document.activeElement===n),true);
      // Preserve existing prefix routing when the picker is used at the start.
      await field.fill('@');await list.waitFor();if(width===390)await option.tap();else await option.click();
      await field.pressSequentially(`Exact mention send ${key}`);const body=await field.inputValue();
      await page.screenshot({path:`${evidence}/${key}.png`});
      const receipt=page.waitForResponse(r=>{try{return r.request().postDataJSON()?.kind==='message.send';}catch{return false;}});
      await send.click();result.receipt=await(await receipt).json();assert.equal(result.receipt.status,'committed');
      result.source=await control({method:'agent_view',actor:facts.actor,name:'source',args:{source_ref:{kind:'message',id:result.receipt.result.message_id}}});
      assert.equal(result.source.body,body);assert.equal(result.source.topic_id,'t1');
      assert.ok(result.source.addressees.some(x=>(typeof x==='string'?x:x.actor_id)===facts.agent),'leading @agent still routes through Core');
      if(surface==='inline'||surface==='reader')assert.equal(result.source.reply_to,id);
      assert.deepEqual(errors,[]);result.pass=true;
    }catch(error){result.error=error.stack;await page.screenshot({path:`${evidence}/${key}-failure.png`,fullPage:true});await writeFile(`${evidence}/${key}-failure.html`,await page.content());}
    results.push(result);await writeFile(`${evidence}/observations.json`,JSON.stringify(results,null,2));retainChildren();await context.close();
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
assert.ok(results.length && results.every(r => !r.error), "972 native cases pass; inspect observations");
console.log(JSON.stringify({ passed: results.length, cleanup }));

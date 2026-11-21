// Native display gestures; scratch HTTP/Core and owned browser cleanup.
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { access, mkdir, writeFile } from 'node:fs/promises';
import net from 'node:net';
import { fixtureControl } from './fixture_control.mjs';
const { chromium } = await import(process.env.AIM_PLAYWRIGHT_CORE);
const evidence = process.argv[2]; await mkdir(evidence, { recursive: true });
const child = spawn('/usr/bin/python3', ['tests/fixtures/ui_http.py', '--freshness'], {cwd:process.env.AIM_962_ROOT??process.cwd()});
const { control, exit } = fixtureControl(child);
const records=[],failures=[],errors=[],marker=`theseus-962-${process.pid}`;
let browser,page,facts,profile;
const check=async(name,act)=>{try{await act();records.push({name,pass:true});}catch(error){failures.push({name,error:error.stack});}};
const settle=()=>page.waitForFunction(()=>document.body.dataset.ready==='true');
const lit=()=>page.evaluate(()=>[...CSS.highlights.values()].flatMap(h=>[...h]).filter(r=>r.startContainer.parentElement.closest('.deck-card,.deck-opening,.page-here-body')).map(r=>r.toString()).join(''));
try {
 facts=await control({method:'ready'});
 assert.equal((await control({method:'memory_revise',operation_id:'962-source',item_id:'fixture-notebook',expected_revision:1,title:'Notebook quote source',body:'Opening words for a page. Another sentence.\n\n## First card\n\nChosen first sentence. A second sentence to extend.\n\n## Second card\n\nOther card words remain separate.'})).status,'committed');
 browser=await chromium.launch({executablePath:process.env.AIM_CHROME,headless:true,args:['--enable-automation',`--${marker}`]});
 const cdp=await browser.newBrowserCDPSession();profile=(await cdp.send('Browser.getBrowserCommandLine')).arguments.find(x=>x.startsWith('--user-data-dir='))?.slice(16);assert.ok(profile);await cdp.detach();
 for(const look of ['Bookends','Paper']) {
  const latest=await control({method:'agent_view',name:'memory_current',args:{item_id:'fixture-notebook'}});
  assert.equal((await control({method:'memory_revise',operation_id:'962-reset-'+look,item_id:'fixture-notebook',expected_revision:latest.source_ref.revision,title:'Notebook quote source',body:'Opening words for a page. Another sentence.\n\n## First card\n\nChosen first sentence. A second sentence to extend.\n\n## Second card\n\nOther card words remain separate.'})).status,'committed');
  const context=await browser.newContext({viewport:{width:1280,height:1000},colorScheme:'dark'});
  page=await context.newPage();page.setDefaultTimeout(8000);page.on('pageerror',e=>errors.push(e.message));
  await page.goto(facts.origin+'/?topic=t1');await settle();
  await page.getByRole('button',{name:look,exact:true}).click();
  await page.goto(facts.origin+'/?cards=fixture-notebook&view=cards');await settle();
  const words=page.locator('.deck-card:not(.deck-writing) .deck-words').first();await words.waitFor();await words.scrollIntoViewIfNeeded();
  const point=await words.evaluate(el=>{const walk=document.createTreeWalker(el,NodeFilter.SHOW_TEXT),text=walk.nextNode(),r=document.createRange();r.setStart(text,0);r.setEnd(text,1);const b=r.getBoundingClientRect();return {x:b.left+b.width/2,y:b.top+b.height/2};});
  records.push({look,point,hit:await page.evaluate(({x,y})=>({html:document.elementFromPoint(x,y)?.outerHTML.slice(0,500),height:innerHeight,scroll:scrollY}),point)});
  await page.mouse.move(point.x-15,point.y);await page.mouse.move(point.x+3,point.y);
  await check(look+' display hover lights the exact passage',async()=>{assert.equal(await lit(),'Chosen first sentence. ');});
  await page.screenshot({path:evidence+'/'+look+'-hover.png',fullPage:true});
  await page.keyboard.press('Enter');
  await check(look+' Return quotes display passage in composer',async()=>{
   await page.waitForFunction(()=>document.querySelector('#reader')?.open,null,{timeout:2500});
   const field=page.locator('#writing-body');assert.match(await field.inputValue(),/> Chosen first sentence\./);
  });
  // A blank card created by baseline Return is dismissed; a candidate Reader is closed.
  if(await page.locator('#reader').evaluate(el=>el.open))await page.locator('#reader-close').click();
  await page.keyboard.press('Escape');
  await page.goto(facts.origin+'/?cards=fixture-notebook&view=cards');await settle();
  await page.getByRole('button',{name:'Edit',exact:true}).click();
  const edit=page.locator('.deck-writing textarea');await edit.waitFor();
  await edit.fill('First card\nEditing stays literal.');await page.keyboard.press('Enter');
  await check(look+' editing Return remains a newline with no quote',async()=>{assert.equal(await edit.inputValue(),'First card\nEditing stays literal.\n');assert.equal(await page.locator('#reader').evaluate(el=>el.open),false);});
  await page.keyboard.press('Escape');
  await context.close();
 }
 assert.deepEqual(errors,[]);
} catch(error){failures.push({fatal:error.stack});if(page&&!page.isClosed())await page.screenshot({path:evidence+'/failure.png',fullPage:true}).catch(()=>{});}
finally {
  if (browser) {
    const rows = execFileSync('ps', ['-axo', 'pid=,ppid=,command='], { encoding: 'utf8' }).split('\n').map(line => { const m = /^\s*(\d+)\s+(\d+)\s+(.*)$/.exec(line); return m && { pid: +m[1], parent: +m[2], command: m[3] }; }).filter(Boolean);
    const owned = new Set(rows.filter(r => r.command.includes(marker) || profile && r.command.includes(profile)).map(r => r.pid));
    for (let n = 0; n < rows.length; n++) for (const r of rows) if (owned.has(r.parent)) owned.add(r.pid);
    await browser.close(); const live = new Set(execFileSync('ps', ['-axo', 'pid='], { encoding: 'utf8' }).trim().split(/\s+/).map(Number)); const remaining = [...owned].filter(pid => live.has(pid));
    const profileAbsent = await access(profile).then(() => false, error => { if (error.code === 'ENOENT') return true; throw error; });
    records.push({ browserClosed: !browser.isConnected(), profile, profileAbsent, ownedPids: [...owned], remaining }); assert.deepEqual(remaining, []); assert.equal(profileAbsent, true);
  }
  child.stdin.end(); const ended = await exit;
  let absent = false; try { process.kill(child.pid, 0); } catch (error) { absent = error.code === 'ESRCH'; }
  const portClosed = !facts || await new Promise(resolve => { const s = net.connect(new URL(facts.origin).port, '127.0.0.1'); s.on('connect', () => { s.destroy(); resolve(false); }); s.on('error', () => resolve(true)); s.setTimeout(1000, () => { s.destroy(); resolve(false); }); });
  records.push({ fixture: ended, fixturePid: child.pid, absent, port: facts && new URL(facts.origin).port, portClosed, errors, failures });
  await writeFile(`${evidence}/results.json`, JSON.stringify(records, null, 2)); assert.deepEqual(ended, { code: 0, signal: null }); assert.equal(absent, true); assert.equal(portClosed, true);
}
if (failures.length) { process.stderr.write(JSON.stringify(failures, null, 2) + '\n'); process.exitCode = 1; }
